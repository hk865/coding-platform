/**
 * Copying a cancelled Goal: the two public entries over one pure decision (`state/goal-copy.ts`).
 *
 * - `readDraft`: a read of the source Goal, its understanding pin and, when the intervention reader is injected, every
 *   candidate; with no reader the preview answers `{ available: false }`.
 * - `confirm`: the single birth commit (`goal.copyConfirm`) — the new active Goal with `continuedFrom` /
 *   `copiedInterventions`, its `GoalCopied` event and the receipt. The source Goal is only CAS-guarded, never written.
 *   The same commit moves the source Goal's adviser and scribe lines onto the new Goal, and a copy that moved a line
 *   writes one project notice after it.
 *   A retraction failure after the commit is the owner's continuation: the Goal stays, and replaying the same confirm
 *   finishes the still-unfinished items; it never commits again.
 *
 * The commit's result event is `GoalCopied`: the event carries the complete birth data and `goal.since: null`, and the
 * projection fills the birth cursor.
 */
import type { ActorRef, CommitCursor, CreateGoalCommand } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, SessionRef, SessionWorkLinkRef, VersionPin } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { defineEvent, defineShape, f, type InferEvent } from '../../../contracts/data-format.js';
import {
  ActorRefField, GoalRefShape, PlanRevisionRefShape, SessionMessageRefShape, WorkspaceRefShape, id,
} from '../../../contracts/data-format-refs.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey, sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  GoalCopyConfirmInputV1, GoalCopyConfirmResultV1, GoalCopyDecisionV1, GoalCopyDraftInputV1,
  GoalCopyDraftResultV1, GoalCopyFactsV1, GoalUnderstandingPinV1,
} from '../../../contracts/goal-card.js';
import type { GoalRef, GoalSnapshot, PendingGoalSnapshot, WorkspaceRef } from '../../../contracts/ledger.js';
import type { LineRef } from '../../../contracts/line.js';
import type { NotifyProjectInputV1, ProjectNoticeV1, RoleLineDutyV1 } from '../../../contracts/role-lines.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type {
  CommitCursorBinding, EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, RecordBackendSchemas,
  RecordCommitIdentityPort, RecordGuard, UniqueClaimChange,
} from '../../record-store/ports.js';
import type { SessionMessageCommandPort } from '../model/communication-contracts.js';
import type { CopyInterventionReadPort, CopyInterventionRetractionPort } from '../model/goal-copy-contracts.js';
import type { GoalCopyPort, GoalUnderstandingReadPort } from '../model/goal-card-contracts.js';
import type { MessageForwardingPort } from '../model/communication-contracts.js';
import type { SessionResponsibilityBasisPort } from '../model/session-facts-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { FORWARD_DESTINATION_GONE } from '../state/message-machine.js';
import { compileGoalCreate } from '../persistence/commit-compiler.js';
import {
  commandIdentity, executeWriteCommand, type CommandResult, type CommitFragment, type Keys,
} from '../persistence/command-executor.js';
import { createEventCodec, formatSchemas } from '../persistence/field-table-codec.js';
import { lineForWrite } from '../persistence/line-record-codecs.js';
import { lookupCommittedReceiptByIdentity } from '../persistence/receipt-lookup.js';
import { GoalCopyFieldsShape, canonicalRefKey, goalSettingsProblem } from '../persistence/record-codecs.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { decideGoalCopy, planReanchorHook } from '../state/goal-copy.js';
import { newGoalSnapshot } from '../state/goal-machine.js';
import { encodeSessionResponsibilityChangedEvent } from '../sessions/lifecycle-record-codecs.js';
import { roleLineCommitContribution } from '../sessions/role-scope-commit.js';
import {
  decodeSessionRecord, encodeSessionRecord, plainSessionRef, plainSessionRefKey, sessionWorkLinkRefKey,
} from '../sessions/session-record-codecs.js';
import { responsibleLinkRef } from '../sessions/session-responsibility-service.js';
import { eventIdOf } from '../sessions/trusted-context.js';
import { bindTrustedContext } from './execution-entry-service.js';
import {
  GoalCopyRetractionShape, copyRetractionSettledCodec, settleCopyItem, type CopyRetractionSettleScopeV1,
} from './goal-copy-progress.js';
import { readOwnerRecord } from './owner-record-read.js';
import { asWriteRejection } from './plan-result-helpers.js';
import { readGoal, readGoalScope, readOpenResponsibilityLines } from './plan-readers.js';

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
  /** The Goal records, plus the source Goal's open responsible links and their Session records. */
  records: GoalRecordTransactionPort & RecordLookupPort;
  understanding: GoalUnderstandingReadPort;
  /** Optional, injected by the intervention reader's owner: a non-empty selection cannot be verified without it. */
  interventions?: CopyInterventionReadPort;
  /** Optional, injected alongside the intervention reader. */
  retractions?: CopyInterventionRetractionPort;
  /** Each source line's fixed duty: only an adviser or a scribe line moves with the copy. */
  duty: SessionDutyReadPort;
  /** The moved line's responsibility basis, carried by its `SessionResponsibilityChanged` event. */
  responsibility: Pick<SessionResponsibilityBasisPort, 'readResponsibilityBasis'>;
  /** The one project notice writer: the continuation notice after a birth commit that moved a line. */
  notices: { projectNoticeWriter(input: NotifyProjectInputV1): Promise<WriteResult<ProjectNoticeV1>> };
  /** A replay skips `build`, so it reads the original birth receipt by identity to learn whether a line moved. */
  commitIdentities: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>;
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
  /** The copy's line: the source Goal's, or the workspace's main line when the source has none (kls-design §2.3.1). */
  line: LineRef | null;
};

/** What the birth commit adds for the source Goal's moved lines. */
type CopyLineContributionV1 =
  | { ok: true; guards: readonly RecordGuard[]; records: readonly EncodedRecord[];
      claims: readonly UniqueClaimChange[]; events: readonly EncodedDomainEvent[];
      commitCursorBindings: readonly CommitCursorBinding[] }
  | { ok: false; rejection: CoreRejection };

/** The two duties whose lines follow a continued Goal; a goal-scope secretary link stays on the source. */
const MOVED_DUTIES: readonly RoleLineDutyV1[] = ['adviser', 'scribe'];

/** A moved line's responsibility event id: a replay recognizes the original move by it in the birth receipt. */
function moveEventIdOf(identityKey: string, duty: RoleLineDutyV1, index: number): string {
  return eventIdOf(identityKey, `goal-copy:${duty}:${index}`);
}

/**
 * The source Goal's open responsible goal links whose line has the adviser or scribe duty, each moved onto the new
 * Goal by one plan per duty and merged into the birth commit. The moved Session, its source link and the new link
 * are guarded at the revisions read here, so a concurrent scope change or archive conflicts with the birth instead of
 * being repaired after it. A refused plan moves nothing and is not a copy failure: the copy is left unassigned and
 * re-resolves its lines on its next advance. A read failure refuses the copy, never reads as "no line".
 */
async function goalContinuationContribution(
  deps: GoalCopyServiceDependencies, ctx: CoreCallContext, keys: Keys,
  input: { projectRef: ProjectScope; actor: ActorRef; source: GoalSnapshot;
    next: { ref: GoalRef; snapshot: PendingGoalSnapshot; version: VersionPin }; occurredAt: string },
): Promise<CopyLineContributionV1> {
  const { projectRef, actor, source, next, occurredAt } = input;
  // The source Goal's open responsible lines and their duties: the one L-8 read; a failure is never "no line".
  const open = await readOpenResponsibilityLines(deps.records, ctx, { goalRef: source.ref }, deps.duty);
  if (open.status !== 'ready') {
    return { ok: false, rejection: asWriteRejection(open, "the source Goal's open lines could not be read") };
  }
  const lines: { link: SessionWorkLink; session: SessionRecord; sessionKey: string; duty: RoleLineDutyV1 }[] = [];
  for (const line of open.value) {
    if (!MOVED_DUTIES.includes(line.duty)) continue;
    const sessionKey = plainSessionRefKey(line.session);
    const session = await readOwnerRecord({ store: deps.records, refKey: sessionKey, decode: decodeSessionRecord,
      readError: (message) => rejected('unavailable', `the source Goal line Session could not be read: ${message}`) });
    if (!session.ok) {
      return { ok: false, rejection: 'rejection' in session ? session.rejection
        : rejected('unavailable', 'the source Goal line has no Session record') };
    }
    lines.push({ link: line.link, session: session.value, sessionKey, duty: line.duty });
  }
  const sessions = new Map(lines.map((line) => [line.session.ref.sessionId, line.session] as const));
  const links = new Map(lines.map((line) => [canonicalKey(line.link.ref), line.link] as const));
  const goals = new Map([[source.ref.goalId, { state: 'present' as const, ref: source.ref, snapshot: source,
    version: { ref: source.ref, revision: source.revision } }]]);
  const fragments: CommitFragment[] = [];
  for (const duty of MOVED_DUTIES) {
    // One open responsible link per (duty, Goal): the role-scope claim admits a single owner.
    const line = lines.find((entry) => entry.duty === duty);
    if (line === undefined) continue;
    const sourceLink = line.link;
    const destination = responsibleLinkRef(plainSessionRef(sourceLink.ref), { kind: 'goal', ref: next.ref });
    const plan = planReanchorHook({
      projectRef, duty,
      moves: [{ duty, source: sourceLink.ref,
        destinations: [{ link: destination, target: { kind: 'goal', ref: next.ref } }] }],
      facts: { sessions, links, goals, catalog: { state: 'none', revision: 0 } },
      authorization: { actor, scope: [{ kind: 'project' }] },
      proposed: { goal: next },
    });
    if (!plan.ok) continue;
    // The read's pins: the moved Session and its source link at the revisions read above, the new link at null.
    const sourceGuards: RecordGuard[] = [
      { refKey: line.sessionKey, expectedRevision: line.session.revision },
      { refKey: sessionWorkLinkRefKey(sourceLink.ref), expectedRevision: sourceLink.revision },
      { refKey: sessionWorkLinkRefKey(destination), expectedRevision: null },
    ];
    const pending = (ref: SessionWorkLinkRef) =>
      plan.plan.links.find((entry) => canonicalKey(entry.link) === canonicalKey(ref))?.next ?? null;
    const moved = plan.plan.sessions[0]!;
    const basisRead = await deps.responsibility.readResponsibilityBasis(ctx,
      { sessionRef: plainSessionRef(moved.ref), target: sourceLink.ref.target });
    if (basisRead.status !== 'ready') {
      return { ok: false, rejection: asWriteRejection(basisRead, 'the moved line responsibility basis could not be read') };
    }
    const contribution = roleLineCommitContribution({
      projectRef,
      records: plan.plan.sessions.map(encodeSessionRecord),
      guards: sourceGuards,
      links: plan.plan.links,
      claimChanges: plan.plan.claimChanges,
      bindings: plan.plan.bindings,
      // The moved Session's own workspace: the event's Session record must agree with the event scope, and the
      // line may live in another workspace than the copied Goal.
      events: plan.plan.events.map((material, index) => encodeSessionResponsibilityChangedEvent({
        eventId: moveEventIdOf(keys.identityKey, duty, index),
        eventType: 'SessionResponsibilityChanged', schemaVersion: 1, occurredAt,
        projectId: projectRef.projectId, workspaceId: moved.workspaceId,
        mode: material.opened === null ? 'drop' : 'transfer',
        source: moved, destination: moved,
        closed: pending(material.closed)!,
        opened: material.opened === null ? null : pending(material.opened),
        openedBound: material.openedBound, archiveStep: null, basis: basisRead.value.basis,
      })),
      allocation: null,
    }, null);
    if (!contribution.ok) return contribution;
    fragments.push(contribution.fragment);
  }
  const merged = mergeGuards(fragments.flatMap((fragment) => fragment.guards));
  if (!merged.ok) return merged;
  return {
    ok: true, guards: merged.guards,
    records: fragments.flatMap((fragment) => fragment.records),
    claims: fragments.flatMap((fragment) => fragment.claims),
    events: fragments.flatMap((fragment) => fragment.events),
    commitCursorBindings: fragments.flatMap((fragment) => fragment.commitCursorBindings ?? []),
  };
}

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
    // Set by the `build` that committed: whether this birth moved a line. A replay skips `build` and reads the receipt.
    let movedLine = false;
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
        const line = scopeRead.goal.lineRef !== null ? { status: 'ready' as const, value: scopeRead.goal.lineRef }
          : await lineForWrite(deps.records, scope, undefined);
        if (line.status !== 'ready') return line;
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
          line: line.value,
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
      async build(decision: CopyCreateDecision, keys: Keys) {
        const goalId = copiedGoalId(keys);
        const at = deps.now();
        const eventId = deps.eventId();
        const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
        const workspaceRef: WorkspaceRef = {
          aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId,
        };
        const goal: PendingGoalSnapshot = newGoalSnapshot({
          ref: goalRef, workspaceRef, lineRef: basis.line, objective: decision.objective, settings: decision.settings,
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
        // One commit, one time: the moved lines' events take the birth's `at`.
        const move = await goalContinuationContribution(deps, ownedCtx, keys, {
          projectRef: { projectId: scope.projectId }, actor, source: basis.goal,
          next: { ref: goalRef, snapshot: goal, version: { ref: goalRef, revision: 1 } }, occurredAt: at,
        });
        if (!move.ok) return move.rejection;
        movedLine = move.events.length > 0;
        const merged = mergeGuards([...compiled.guards, ...move.guards]);
        if (!merged.ok) return merged.rejection;
        return {
          guards: merged.guards,
          records: [...compiled.records, ...move.records],
          claims: [...compiled.claims, ...move.claims],
          events: [...move.events, goalCopiedCodec.encode(event)],
          ...(compiled.commitCursorBindings === undefined && move.commitCursorBindings.length === 0
            ? {} : { commitCursorBindings: [...(compiled.commitCursorBindings ?? []), ...move.commitCursorBindings] }),
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
      // The continuation notice, only when the copy moved a line. A replay's `build` did not run here, so the
      // original birth receipt decides: the copy moved a line when the receipt holds a move event's id.
      let moved = movedLine;
      if (result.replayed) {
        const original = await lookupCommittedReceiptByIdentity(deps.commitIdentities, confirmIdentity);
        moved = original.status === 'found' && MOVED_DUTIES.some((duty) =>
          original.receipt.eventIds.includes(moveEventIdOf(confirmIdentity, duty, 0)));
      }
      // The notice identity (subject, kind, operation) writes no second notice on a replay; a refused notice leaves
      // the committed copy as it is.
      if (moved) {
        await deps.notices.projectNoticeWriter({
          projectRef: { projectId: scope.projectId },
          subject: { kind: 'project', projectRef: { projectId: scope.projectId } },
          kind: 'automatic_adjustment',
          summary: `目标已延续：${sourceGoalRef.goalId} → ${result.value.goal.ref.goalId}；顾问与记录员已随目标迁移（可归档或重排）`,
          operation: { aggregateType: 'CoreOperation', projectId: scope.projectId, operationId: commandId },
        });
      }
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

/** L13/W-08: after the new Goal's first Plan is adopted, forward every ticked intervention to the line it was
 *  originally addressed to (even if alive), with `copyGoalRef` (`book-7b.md:816`–`:826`). One deterministic command
 *  id per (Goal, message): a repeat is F's receipt replay — no scan, no progress record (90-8; `:819`–`:822`). */
export type CopiedInterventionForwardingPort = {
  forwardCopiedInterventions(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef },
  ): Promise<CoreRejection | null>;      // null = the pass finished; per-item outcomes are F's records and N's read
};

export type CopiedInterventionForwardingDependencies = {
  /** The Goal owner's read (`plan-readers.ts:392`), not a second record decode. */
  records: GoalRecordTransactionPort;
  /** The one message view (`mailbox-service.ts:4879`; `SessionMessageCommandPort.readMessageView`
   *  `communication-contracts.ts:410`): the recipient only; delivery stays F's and the copy owner's. */
  mailbox: Pick<SessionMessageCommandPort, 'readMessageView'>;
  /** F's one trusted entry (`book-7b.md:983`; `10-f.md:76`): the ordinary person entry refuses a non-Host principal,
   *  and the trusted entry is the copy branch. P reads only the arm it classifies. */
  forwardCopiedIntervention: MessageForwardingPort['forwardCopiedIntervention'];
};

export function createCopiedInterventionForwarding(
  deps: CopiedInterventionForwardingDependencies,
): CopiedInterventionForwardingPort {
  const forwardCopiedInterventions: CopiedInterventionForwardingPort['forwardCopiedInterventions'] =
    async (ctx, input) => {
      const read = await readGoal(deps.records, input.goalRef);
      if (read.status !== 'ready') return read;              // Rejected is a CoreRejection
      const goal = read.goal;
      if (goal.continuedFrom === null) return null;          // not born as a copy (`ledger.ts:100`–`:103`)
      if (goal.activePlanRevision === null) return null;     // first adoption not committed yet (`ledger.ts:95`)
      for (const messageRef of goal.copiedInterventions) {   // the frozen ticked set; never re-derived
        const view = await deps.mailbox.readMessageView(ctx, messageRef);
        if (view.status !== 'ready') return asWriteRejection(view, 'the copied intervention could not be read');
        // Every person-send input types `recipient: SessionRef` (`communication-contracts.ts:263`), so a
        // copy candidate always has a line; no user-addressed branch exists.
        const to = view.value.message.recipient as SessionRef;
        const result = await deps.forwardCopiedIntervention(ctx, {
          commandId: `copy-forward:${canonicalRefKey(goal.ref)}:${canonicalRefKey(messageRef)}`,
          messageRef, to, copyGoalRef: goal.ref,
        });
        if (result.status === 'forwarded' || result.status === 'existing') continue;         // first send or its replay
        if (result.code === 'invalid' && result.reason === FORWARD_DESTINATION_GONE) continue;  // stays unforwarded
        if (result.code === 'busy') continue;                                              // the person's forward won
        return result;
      }
      return null;
    };
  return { forwardCopiedInterventions };
}
