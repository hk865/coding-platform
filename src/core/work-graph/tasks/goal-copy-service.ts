/**
 * Copying a cancelled Goal: the two public entries over one pure decision (`state/goal-copy.ts`).
 *
 * - `readDraft`: a read of the source Goal, its understanding pin and, when the intervention reader is injected, every
 *   candidate; with no reader the preview answers `{ available: false }`.
 * - `confirm`: the single birth commit (`goal.copyConfirm`) — the new active Goal with `continuedFrom` /
 *   `copiedInterventions`, its `GoalCopied` event and the receipt. The source Goal is only CAS-guarded, never written.
 *   A retraction failure after the commit is the owner's continuation: the Goal stays, and replaying the same confirm
 *   finishes the still-unfinished items; it never commits again.
 *
 * The commit's result event is `GoalCopied`: the event carries the complete birth data and `goal.since: null`, and the
 * projection fills the birth cursor.
 */
import type { CommitCursor, CreateGoalCommand } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { defineEvent, defineShape, f, type InferEvent } from '../../../contracts/data-format.js';
import {
  GoalRefShape, PlanRevisionRefShape, SessionMessageRefShape, WorkspaceRefShape, id,
} from '../../../contracts/data-format-refs.js';
import { messageOf } from '../../../contracts/error-message.js';
import { sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  GoalCopyConfirmInputV1, GoalCopyConfirmResultV1, GoalCopyDecisionV1, GoalCopyDraftInputV1,
  GoalCopyDraftResultV1, GoalCopyFactsV1, GoalUnderstandingPinV1,
} from '../../../contracts/goal-card.js';
import type { GoalRef, GoalSnapshot, PendingGoalSnapshot, WorkspaceRef } from '../../../contracts/ledger.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  EncodedDomainEvent, GoalRecordTransactionPort, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { CopyInterventionReadPort, CopyInterventionRetractionPort } from '../model/goal-copy-contracts.js';
import type { GoalCopyPort, GoalUnderstandingReadPort } from '../model/goal-card-contracts.js';
import { ActorRefField } from '../model/session-operation-arms.js';
import { compileGoalCreate } from '../persistence/commit-compiler.js';
import {
  commandIdentity, executeWriteCommand, type CommandResult, type Keys,
} from '../persistence/command-executor.js';
import { createEventCodec, formatSchemas } from '../persistence/field-table-codec.js';
import { GoalCopyFieldsShape, canonicalRefKey, goalSettingsProblem } from '../persistence/record-codecs.js';
import { decideGoalCopy, planReanchorHook } from '../state/goal-copy.js';
import { newGoalSnapshot } from '../state/goal-machine.js';
import { bindTrustedContext } from './execution-entry-service.js';
import {
  GoalCopyRetractionShape, copyRetractionSettledCodec, settleCopyItem, type CopyRetractionSettleScopeV1,
} from './goal-copy-progress.js';
import { asWriteRejection } from './plan-result-helpers.js';
import { readGoal, readGoalScope } from './plan-readers.js';

const GOAL_COPIED_EVENT_TYPE = 'GoalCopied' as const;
const GOAL_COPIED_EVENT_SCHEMA_VERSION = 1 as const;
const OPERATION = 'goal.copyConfirm';

/** One page of the intervention read; the port's own contract caps it at 200. */
const INTERVENTION_PAGE_LIMIT = 200;

function invalid(reason: string): CoreRejection { return rejected('invalid', reason); }
function forbiddenCopy(reason: string): CoreRejection { return rejected('forbidden', reason); }

// --------------------------------------------------------------------------
// The `GoalCopied` event (R1 field table)
// --------------------------------------------------------------------------

const GoalParallelRiskShape = defineShape({
  name: 'GoalParallelRisk',
  fields: { otherGoalRef: f.ref(GoalRefShape), selfPlanRef: f.nullable(f.ref(PlanRevisionRefShape)),
    otherPlanRef: f.nullable(f.ref(PlanRevisionRefShape)) },
});

const GoalSettingsShape = defineShape({
  name: 'GoalSettings',
  fields: { schemaVersion: f.literal(1), autonomy: f.enumOf(['every_step', 'after_plan_confirmation']),
    order: f.integer({ min: 0 }), waitForGoalRef: f.nullable(f.ref(GoalRefShape)),
    parallelRisks: f.array(f.ref(GoalParallelRiskShape)) },
});

/** The birth form of a Goal: active, no plan, revision 1 and the pre-commit `since` placeholder. */
const PendingGoalSnapshotShape = defineShape({
  name: 'PendingGoalSnapshot',
  fields: {
    ref: f.ref(GoalRefShape),
    workspaceRef: f.ref(WorkspaceRefShape),
    objective: f.string(),
    desiredState: f.enumOf(['active', 'paused', 'cancelled']),
    desiredStateRevision: f.integer({ min: 1 }),
    desiredStateRequestedBy: f.nullable(ActorRefField),
    activePlanRevision: f.nullable(f.ref(PlanRevisionRefShape)),
    revision: f.integer({ min: 1 }),
    settings: f.ref(GoalSettingsShape),
    ...GoalCopyFieldsShape.fields,
    since: f.nullable(f.cursor('ledger')),
  },
  rules: [
    value => isRecord(value) && value['since'] === null
      ? null : 'GoalCopied.goal.since must be null before the birth commit',
    value => isRecord(value) && value['desiredState'] === 'active'
      ? null : 'GoalCopied.goal.desiredState must be active',
    value => isRecord(value) && value['activePlanRevision'] === null
      ? null : 'GoalCopied.goal.activePlanRevision must be null',
    value => isRecord(value) && value['revision'] === 1 ? null : 'GoalCopied.goal.revision must be 1',
    value => isRecord(value) && value['desiredStateRevision'] === 1
      ? null : 'GoalCopied.goal.desiredStateRevision must be 1',
    value => isRecord(value) && value['desiredStateRequestedBy'] === null
      ? null : 'GoalCopied.goal.desiredStateRequestedBy must be null',
    // The one settings check: the table checks the field shapes; the existing pure check adds the refs' project
    // agreement (the wait predecessor and every parallel risk belong to this Goal's project).
    value => isRecord(value) && isRecord(value['ref']) && typeof value['ref']['projectId'] === 'string'
      ? goalSettingsProblem(value['settings'], value['ref']['projectId'])
      : 'GoalCopied.goal must carry its ref and settings',
  ],
});

const GoalCopiedPayloadShape = defineShape({
  name: 'GoalCopiedPayload',
  fields: {
    sourceGoalRef: f.ref(GoalRefShape), goal: f.ref(PendingGoalSnapshotShape),
    // The copy always continues from a source, so the payload takes the continuation's non-nullable inner fields.
    continuedFrom: GoalCopyFieldsShape.fields.continuedFrom.field,
    copiedInterventions: GoalCopyFieldsShape.fields.copiedInterventions,
    selection: f.enumOf(['selection_only', 'retraction_pending']),
    retractions: f.array(f.ref(GoalCopyRetractionShape)),
  },
});

const GOAL_COPIED_FORMAT = defineEvent({
  name: 'GoalCopied', eventType: GOAL_COPIED_EVENT_TYPE, schemaVersion: GOAL_COPIED_EVENT_SCHEMA_VERSION,
  fields: {
    projectId: id, workspaceId: id, aggregateType: f.literal('Goal'), aggregateId: id, aggregateRevision: f.literal(1),
    causationId: f.string({ min: 1, unit: 'codePoints' }),
    correlationId: f.string({ min: 1, unit: 'codePoints' }),
    idempotencyKey: f.string({ min: 1, unit: 'codePoints' }),
    actor: ActorRefField,
    payload: f.ref(GoalCopiedPayloadShape),
  },
});

type GoalCopiedEvent = InferEvent<typeof GOAL_COPIED_EVENT_TYPE, typeof GOAL_COPIED_FORMAT.fields>;
const goalCopiedCodec = createEventCodec(GOAL_COPIED_FORMAT);

/** 注册 Goal 复制出生事件与逐项结算事件的 schema。 */
export const GOAL_COPY_RECORD_SCHEMAS: RecordBackendSchemas =
  formatSchemas([goalCopiedCodec, copyRetractionSettledCodec]);

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export type GoalCopyServiceDependencies = {
  records: GoalRecordTransactionPort;
  understanding: GoalUnderstandingReadPort;
  /** Optional, injected by the intervention reader's owner: a non-empty selection cannot be verified without it. */
  interventions?: CopyInterventionReadPort;
  /** Optional, injected alongside the intervention reader. */
  retractions?: CopyInterventionRetractionPort;
  now(): string;
  eventId(): string;
};

type CopyCreateDecision = Extract<GoalCopyDecisionV1, { outcome: 'create' }>;

/** The new Goal's id, derived from the command identity: a replay recovers the same Goal, never a second one. */
function copiedGoalId(keys: Keys): string {
  return `goal-copy-${sha256Hex(keys.identityKey).slice(0, 32)}`;
}

/** The source facts the confirm read; `build` reads the guards from here, never from a second read. */
type CopyBasis = {
  goal: GoalSnapshot;
  projectKey: string;
  workspaceKey: string;
  projectRevision: number;
  workspaceRevision: number;
  pin: GoalUnderstandingPinV1;
};

export function createGoalCopyService(deps: GoalCopyServiceDependencies): GoalCopyPort {
  async function readInterventionCandidates(ctx: CoreCallContext, goalRef: GoalRef,
  ): Promise<{ ok: true; value: GoalCopyFactsV1['selected'] } | { ok: false; rejection: CoreRejection }> {
    const port = deps.interventions;
    if (port === undefined) return { ok: true, value: [] };
    const candidates: GoalCopyFactsV1['selected'][number][] = [];
    let cursor: string | undefined;
    for (;;) {
      const read = await port.readCopyInterventions(ctx, {
        sourceGoalRef: goalRef,
        page: cursor === undefined ? { limit: INTERVENTION_PAGE_LIMIT } : { limit: INTERVENTION_PAGE_LIMIT, cursor },
      });
      if (read.status !== 'ready') {
        return { ok: false, rejection: asWriteRejection(read, 'the copy intervention candidates could not be read') };
      }
      candidates.push(...read.value.candidates);
      if (read.value.nextCursor === null) return { ok: true, value: candidates };
      cursor = read.value.nextCursor;
    }
  }

  async function readDraft(ctx: CoreCallContext, rawInput: GoalCopyDraftInputV1): Promise<ReadResult<GoalCopyDraftResultV1>> {
    const trusted = bindTrustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope } = trusted;
    const given: unknown = rawInput;
    const input: Record<string, unknown> = isRecord(given) ? given : {};
    const problem = checkShape(GoalRefShape, input['goalRef'], 'stored');
    if (problem !== null) return invalid(problem);
    // The validated ref is copied once: a caller mutating its object cannot change any later read or guard.
    const goalRef = { ...(input['goalRef'] as GoalRef) };
    if (goalRef.projectId !== scope.projectId) return forbiddenCopy('the Goal belongs to another project');
    const read = await readGoal(deps.records, goalRef);
    if (read.status !== 'ready') return read;
    const source = read.goal;
    if (source.workspaceRef.workspaceId !== scope.workspaceId) return forbiddenCopy('the Goal belongs to another workspace');
    const understanding = await deps.understanding.readGoalUnderstanding(trusted.ctx, { goalRef });
    if (understanding.status !== 'ready') return understanding;
    const pin = understanding.value;
    const decided = decideGoalCopy({ source, understanding: pin, selected: [] }, { goalRef });
    if (decided.outcome === 'refuse') return rejected(decided.code, decided.reason);
    // With the reader the preview lifts every candidate; a failed read fails the draft, never `{ available: false }`.
    let interventions: GoalCopyDraftResultV1['interventions'] = { available: false };
    if (deps.interventions !== undefined) {
      const candidates = await readInterventionCandidates(trusted.ctx, goalRef);
      if (!candidates.ok) return candidates.rejection;
      interventions = { available: true, candidates: candidates.value };
    }
    return {
      status: 'ready',
      value: {
        source: { goal: source.ref, revision: source.revision },
        objective: source.objective,
        autonomy: source.settings.autonomy,
        order: source.settings.order,
        // The wait/risk settings are shown as "to re-confirm"; the copy drops them.
        toReconfirm: {
          waitForGoalRef: source.settings.waitForGoalRef,
          parallelRisks: source.settings.parallelRisks.map(risk => risk.otherGoalRef),
        },
        understanding: pin.note === null ? null : { noteId: pin.note.noteId, version: pin.note.version },
        interventions,
      },
    };
  }

  /**
   * The continuation after a committed confirm, first call or replay, in the birth event's `retractions` order: a
   * replay's saved settle, then one retraction call, then the settle. A failure leaves the item `unfinished` with
   * this call's reason; only a replay of the same confirm retries it.
   */
  async function finishRetractions(ctx: CoreCallContext, result: GoalCopyConfirmResultV1,
    settle: CopyRetractionSettleScopeV1, replayed: boolean): Promise<GoalCopyConfirmResultV1> {
    const port = deps.retractions;
    if (port === undefined) return result;
    const retractions: GoalCopyConfirmResultV1['retractions'][number][] = [];
    for (const item of result.retractions) {
      const { messageRef } = item;
      // Only a replay can find a settle: the settle identity hangs on this confirm, which on a first commit has
      // just come into existence.
      if (replayed) {
        const saved = await settleCopyItem(deps.records, settle, messageRef, null);
        if (saved.status === 'settled') { retractions.push(saved.item); continue; }
        if (saved.status === 'rejected') {
          retractions.push({ messageRef, status: 'unfinished', reason: saved.reason });
          continue;
        }
      }
      const commandId = `${settle.confirmIdentity}:retract:${canonicalRefKey(messageRef)}`;
      let outcome: { status: 'retracted' | 'not_retractable'; reason: string | null };
      try {
        const retracted = await port.retractCopiedIntervention(ctx, {
          commandId, sourceGoalRef: settle.sourceGoalRef, messageRef,
        });
        if (retracted.status !== 'retracted' && retracted.status !== 'not_retractable') {
          retractions.push({ messageRef, status: 'unfinished', reason: retracted.reason });
          continue;
        }
        outcome = retracted;
      } catch (error) {
        retractions.push({ messageRef, status: 'unfinished', reason: messageOf(error) });
        continue;
      }
      // The settle's `missing` arm is the null lookup's; a definite outcome cannot reach it, so the call's wide
      // return type is narrowed instead of inventing a result for an unreachable case.
      const settled = (await settleCopyItem(deps.records, settle, messageRef, outcome)) as
        | { status: 'settled'; item: GoalCopyConfirmResultV1['retractions'][number]; replayed: boolean }
        | CoreRejection;
      retractions.push(settled.status === 'settled' ? settled.item
        : { messageRef, status: 'unfinished', reason: settled.reason });
    }
    return { ...result, retractions };
  }

  async function confirm(ctx: CoreCallContext, rawInput: GoalCopyConfirmInputV1): Promise<WriteResult<GoalCopyConfirmResultV1>> {
    const trusted = bindTrustedContext(ctx);
    if (!trusted.ok) return trusted.rejection;
    const { scope, actor, ctx: ownedCtx, signal } = trusted;
    // The Host route also guards the person; the owner keeps its own rule.
    if (actor.kind !== 'human') return forbiddenCopy('only the person may confirm a Goal copy');

    const given: unknown = rawInput;
    if (!isRecord(given)) return invalid('the Goal copy confirm requires a command input');
    const commandId = given['commandId'];
    if (!nonEmpty(commandId)) return invalid('the Goal copy confirm requires a non-empty commandId');
    const expectedSourceRevision = given['expectedSourceRevision'];
    if (typeof expectedSourceRevision !== 'number' || !Number.isSafeInteger(expectedSourceRevision)
      || expectedSourceRevision < 1) {
      return invalid('the expected source revision must be a positive safe integer');
    }
    const sourceProblem = checkShape(GoalRefShape, given['sourceGoalRef'], 'stored');
    if (sourceProblem !== null) return invalid(sourceProblem);
    const sourceGoalRef = { ...(given['sourceGoalRef'] as GoalRef) };
    if (sourceGoalRef.projectId !== scope.projectId) return forbiddenCopy('the Goal belongs to another project');
    const rawSelected = given['selectedInterventions'];
    if (!Array.isArray(rawSelected)) return invalid('the selected interventions must be an array of SessionMessageRefs');
    const selectedInterventions: SessionMessageRef[] = [];
    for (const candidate of rawSelected) {
      const selectedProblem = checkShape(SessionMessageRefShape, candidate, 'stored');
      if (selectedProblem !== null) return invalid(selectedProblem);
      selectedInterventions.push({ ...(candidate as SessionMessageRef) });
    }
    const copiedInput: GoalCopyConfirmInputV1 = {
      commandId, sourceGoalRef, expectedSourceRevision,
      selectedInterventions,
    };
    const principal = ownedCtx.principal as unknown as JsonValue;
    const confirmIdentity = commandIdentity({
      operation: OPERATION,
      scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      principal, commandId,
    });

    let basis!: CopyBasis;
    const command = {
      operation: OPERATION,
      scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      principal,
      commandId,
      fingerprintInput: {
        sourceGoalRef: copiedInput.sourceGoalRef,
        expectedSourceRevision,
        selectedInterventions,
      } as unknown as JsonValue,
      async read(): Promise<{ status: 'ready'; facts: GoalCopyFactsV1 } | CoreRejection> {
        // The receipt lookup has had its say before this read: a replay answers the original success even when the
        // replay's signal is already aborted.
        if (signal.aborted) return rejected('cancelled', 'the Goal copy was cancelled before reading');
        const scopeRead = await readGoalScope(deps.records, sourceGoalRef);
        if (scopeRead.status !== 'ready') return scopeRead;
        if (scopeRead.goal.ref.projectId !== scope.projectId) return forbiddenCopy('the Goal belongs to another project');
        if (scopeRead.goal.workspaceRef.workspaceId !== scope.workspaceId) {
          return forbiddenCopy('the Goal belongs to another workspace');
        }
        const understanding = await deps.understanding.readGoalUnderstanding(ownedCtx, { goalRef: sourceGoalRef });
        if (understanding.status !== 'ready') {
          return asWriteRejection(understanding, 'the source Goal understanding could not be read');
        }
        // With the reader, read every page whatever the selection: the unchecked set is frozen from the complete
        // candidates. Without one the set is empty, so a non-empty selection is refused below (the owner cannot
        // verify ownership or state).
        const candidates = await readInterventionCandidates(ownedCtx, sourceGoalRef);
        if (!candidates.ok) return candidates.rejection;
        const pin = understanding.value;
        basis = {
          goal: scopeRead.goal, projectKey: scopeRead.projectKey, workspaceKey: scopeRead.workspaceKey,
          projectRevision: scopeRead.projectRevision, workspaceRevision: scopeRead.workspaceRevision, pin,
        };
        // The facts carry the complete candidate set: the selection is verified against it, and the unselected
        // remainder is frozen into the birth event.
        return { status: 'ready', facts: {
          source: scopeRead.goal, understanding: pin, selected: candidates.value,
        } };
      },
      decide(facts: GoalCopyFactsV1) {
        const decided = decideGoalCopy(facts, copiedInput);
        return decided.outcome === 'refuse'
          ? { refuse: rejected(decided.code, decided.reason) }
          : { decision: decided };
      },
      build(decision: CopyCreateDecision, keys: Keys) {
        const goalId = copiedGoalId(keys);
        const at = deps.now();
        const eventId = deps.eventId();
        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
        const workspaceRef: WorkspaceRef = {
          aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId,
        };
        const goal: PendingGoalSnapshot = newGoalSnapshot({
          ref: goalRef, workspaceRef, objective: decision.objective, settings: decision.settings,
          continuedFrom: decision.continuedFrom, copiedInterventions: [...decision.copiedInterventions],
        });
        const create: CreateGoalCommand = {
          commandId, commandType: 'CreateGoal', schemaVersion: 1,
          identity: { projectId: scope.projectId, actor, idempotencyKey: commandId },
          aggregateId: goalId, expectedRevision: 0, correlationId: `goal-copy:${keys.identityKey}`,
          submittedAt: at,
          payload: { workspaceId: scope.workspaceId, objective: decision.objective },
        };
        const pin = basis.pin;
        const compiled = compileGoalCreate({
          command: create, goal,
          guards: [
            // The birth record's own non-existence guard: a copy always creates this Goal.
            { refKey: canonicalRefKey(goalRef), expectedRevision: null },
            { refKey: canonicalRefKey(basis.goal.ref), expectedRevision: basis.goal.revision },
            { refKey: basis.projectKey, expectedRevision: basis.projectRevision },
            { refKey: basis.workspaceKey, expectedRevision: basis.workspaceRevision },
            // A missing pointer is a create (`null`); a numeric revision requires a real record.
            { refKey: pin.pointer.refKey, expectedRevision: pin.pointer.revision },
            ...(pin.head === null ? [] : [{ refKey: pin.head.refKey, expectedRevision: pin.head.version }]),
          ],
          birthEvent: 'none',
        });
        const event: GoalCopiedEvent = {
          eventId, eventType: GOAL_COPIED_EVENT_TYPE, schemaVersion: GOAL_COPIED_EVENT_SCHEMA_VERSION,
          occurredAt: at,
          projectId: scope.projectId, workspaceId: scope.workspaceId,
          aggregateType: 'Goal', aggregateId: goalId, aggregateRevision: 1,
          causationId: commandId, correlationId: create.correlationId, idempotencyKey: commandId,
          actor,
          payload: {
            sourceGoalRef: copiedInput.sourceGoalRef,
            goal,
            continuedFrom: decision.continuedFrom,
            copiedInterventions: [...decision.copiedInterventions],
            selection: decision.selection,
            // Every candidate the decision did not select, in candidate order; the birth event freezes it unfinished.
            retractions: decision.retract.map(ref => ({ messageRef: { ...ref },
              status: 'unfinished', reason: null })),
          },
        };
        return {
          guards: compiled.guards, records: compiled.records, claims: compiled.claims,
          ...(compiled.commitCursorBindings === undefined
            ? {} : { commitCursorBindings: compiled.commitCursorBindings }),
          events: [goalCopiedCodec.encode(event)],
        };
      },
      result: {
        eventType: GOAL_COPIED_EVENT_TYPE,
        schemaVersion: GOAL_COPIED_EVENT_SCHEMA_VERSION,
        decode: (event: EncodedDomainEvent) => goalCopiedCodec.decode(event),
        validate(event: GoalCopiedEvent, _receipt: unknown, keys: Keys): string | null {
          if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
            return 'the event records another scope';
          }
          if (event.aggregateId !== copiedGoalId(keys)) return 'the event records another Goal';
          if (!sameJson(event.payload.sourceGoalRef, copiedInput.sourceGoalRef)) {
            return 'the event records another source Goal';
          }
          const goal = event.payload.goal;
          if (goal.ref.projectId !== scope.projectId || goal.ref.goalId !== event.aggregateId) {
            return 'the event Goal ref disagrees with the command';
          }
          if (goal.workspaceRef.projectId !== scope.projectId
            || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return 'the event Goal workspace disagrees with the scope';
          }
          return null;
        },
        project(event: GoalCopiedEvent, cursor: CommitCursor): GoalCopyConfirmResultV1 {
          return {
            goal: { ...event.payload.goal, since: cursor },
            receipt: {
              sourceGoalRef: event.payload.sourceGoalRef,
              continuedFrom: event.payload.continuedFrom,
              selection: event.payload.selection,
            },
            retractions: event.payload.retractions,
            cursor,
          };
        },
      },
    };
    const result: CommandResult<GoalCopyConfirmResultV1, CoreRejection> =
      await executeWriteCommand<GoalCopyFactsV1, CopyCreateDecision, CoreRejection, GoalCopiedEvent,
        GoalCopyConfirmResultV1>(deps.records, command);
    if (result.status === 'committed') {
      // The hook is where the real re-anchor lands; it returns no receipt and changes no fact, and a replay
      // recovers the original copy without a second effect.
      if (!result.replayed) planReanchorHook();
      const value = await finishRetractions(ownedCtx, result.value, {
        scope,
        principal,
        confirmIdentity,
        copyGoalRef: result.value.goal.ref,
        sourceGoalRef,
        now: deps.now,
        eventId: deps.eventId,
      }, result.replayed);
      return { status: 'committed', value, replayed: result.replayed, cursor: result.cursor };
    }
    if (result.status === 'refused') return result.refusal;
    return result;
  }

  return { readDraft, confirm };
}
