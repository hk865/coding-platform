/**
 * The initialization-adoption owner. Every write is one `executeWriteCommand` with one record and one last
 * event, built only by the state constructors. R2 order: receipt replay, then the record read, then `decide`;
 * a stage write whose generation is not the accepted generation is `revision_conflict`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  INITIALIZATION_ADOPT_STAGES,
  initializationAdoptionOperationId,
  type AdoptionParentFingerprintInputV1,
  type AdoptionSaveAfterInputV1,
  type AdoptionSaveBeforeInputV1,
  type AdoptionStageWriteResultV1,
  type AdoptionWriteIdentityV1,
  type InitializationAdoptInputV1,
  type InitializationAdoptResultV1,
  type InitializationAdoptionReadV1,
  type InitializationAdoptionRecordV1,
  type InitializationAdoptionRef,
} from '../../../contracts/initialization-adoption.js';
import { InitializationSourceShape } from '../../../contracts/initial-planning.js';
import { GoalRefShape } from '../../../contracts/data-format-refs.js';
import { parseInitialPlanningResponseV2 } from '../../../contracts/initial-planning-parse.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { isInt, isRecord, isSha256Hex, nonEmpty } from '../../../contracts/validation/common.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { CompletionPolicyReadPort } from '../model/completion-policy-contracts.js';
import type { InitializationBindingReadPort } from '../model/goal-card-contracts.js';
import type { InitializationAdoptionPort, ServedRolesPort } from '../model/initialization-adoption-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import { trustedContext } from '../sessions/trusted-context.js';
import {
  executeWriteCommand, type CommandResult, type CommitFragment, type Keys,
} from '../persistence/command-executor.js';
import { canonicalRefKey } from '../persistence/record-codecs.js';
import { initializationAdoptionAcceptedCodec, initializationAdoptionAdvancedCodec, initializationAdoptionCodec }
  from '../persistence/initialization-adoption-codecs.js';
import { mapStoreReadFailure, type Rejection } from './plan-result-helpers.js';
import {
  acceptExistingInitializationAdoption, advanceInitializationAdoption, committedAdoptionRecord,
  completeInitializationAdoption, newInitializationAdoptionRecord, nextAdoptionStage,
  stopInitializationAdoption,
} from '../state/initialization-adoption.js';

export type InitializationAdoptionServiceDependencies = {
  records: GoalRecordTransactionPort;
  /** The binding read; `accept` compares the source-resolved Goal with `input.expectedGoal`. */
  bindings: Pick<InitializationBindingReadPort, 'readBindingByAnswerDraft'>;
  sources: Required<Pick<PlanTaskPort, 'readInitialPlanAnswerFacts'>>;
  architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  /** The shared completion-policy read: the active pointer plus the immutable policy revision it pins. */
  policies: CompletionPolicyReadPort;
  /** The roles the in-memory Workflow configuration serves for the workspace an assignment names. */
  roles: ServedRolesPort;
  now: () => string;
  eventId: () => string;
};

/** The roles `assignments` name that `served` does not serve, in assignment order. `accept` and the submit composer share it. */
export function unservedRoles(
  assignments: readonly { role: string }[] | undefined,
  served: readonly string[],
): string[] {
  return (assignments ?? [])
    .filter(assignment => !served.includes(assignment.role))
    .map(assignment => assignment.role);
}

const ACCEPT_OPERATION = 'initialization.adoptAccept';
const ADVANCE_OPERATION = 'initialization.adoptAdvance';

type AcceptedDecoded = Extract<ReturnType<typeof initializationAdoptionAcceptedCodec.decode>,
  { status: 'decoded' }>['value'];
type AdvancedDecoded = Extract<ReturnType<typeof initializationAdoptionAdvancedCodec.decode>,
  { status: 'decoded' }>['value'];

/** The retryable core failures: only a `failed` mark may carry `true`, and only for one of these codes. */
export const RETRYABLE_CODES: ReadonlySet<CoreError> = new Set<CoreError>([
  'unavailable', 'busy', 'dependency_blocked', 'cycle', 'capacity', 'cancelled',
]);

/** The first stage whose mark is not part of the completed prefix; `apply` once all eight are complete. */
function nextStage(record: InitializationAdoptionRecordV1): (typeof INITIALIZATION_ADOPT_STAGES)[number] {
  return INITIALIZATION_ADOPT_STAGES[record.completedSteps.length] ?? 'apply';
}

type RecordRead =
  | { status: 'present'; record: InitializationAdoptionRecordV1 }
  | { status: 'absent' }
  | { status: 'rejected'; rejection: Rejection };

/** The record's own read: the key is the canonical JSON of its full ref, and absence is a real result. */
async function readAdoptionRecord(records: GoalRecordTransactionPort, refKey: string): Promise<RecordRead> {
  let read: Awaited<ReturnType<GoalRecordTransactionPort['readMany']>>;
  try {
    read = await records.readMany([refKey]);
  } catch (error) {
    return { status: 'rejected', rejection: rejected('unavailable', `the adoption operation could not be read: ${messageOf(error)}`) };
  }
  if (read.status === 'rejected') {
    return { status: 'rejected', rejection: mapStoreReadFailure(read, 'the adoption operation could not be read') };
  }
  const encoded = read.value.records.find(record => record.refKey === refKey);
  if (encoded === undefined) return { status: 'absent' };
  const decoded = initializationAdoptionCodec.decode(encoded);
  if (decoded.status !== 'decoded') {
    return { status: 'rejected', rejection: rejected('unavailable', `the adoption operation record is damaged: ${decoded.reason}`) };
  }
  return { status: 'present', record: decoded.value };
}

function readOnlyRejection(read: Exclude<RecordRead, { status: 'present' }>): CoreRejection {
  if (read.status === 'rejected') return read.rejection;
  return rejected('not_found', 'the adoption operation was not found');
}

type AcceptFacts = { record: InitializationAdoptionRecordV1 | null };

type AcceptDecision = { kind: 'birth' } | { kind: 'existing'; record: InitializationAdoptionRecordV1 };

type AcceptValue = { operationRef: InitializationAdoptionRef; generation: number };

type StageRefusal =
  | { kind: 'unchanged'; value: InitializationAdoptionRecordV1 }
  | CoreRejection;

/** A stage write's decision: the next record and the revision this call read, which the commit guard needs. */
type StageDecision = { next: InitializationAdoptionRecordV1; expectedRevision: number };

function mapAccept(result: CommandResult<AcceptValue, CoreRejection>):
  { status: 'accepted'; operationRef: InitializationAdoptionRef; replayed: boolean; generation: number;
    cursor: import('../../../contracts/command-event.js').CommitCursor } | CoreRejection {
  if (result.status === 'committed') {
    return { status: 'accepted', operationRef: result.value.operationRef, replayed: result.replayed,
      generation: result.value.generation, cursor: result.cursor };
  }
  if (result.status === 'refused') return result.refusal;
  return rejectedWithCurrent(result.code, result.reason, result.current);
}

function mapStageWrite(result: CommandResult<InitializationAdoptionRecordV1, StageRefusal>):
  AdoptionStageWriteResultV1 | CoreRejection {
  if (result.status === 'committed') {
    return { status: 'committed', value: result.value, replayed: result.replayed, cursor: result.cursor };
  }
  if (result.status === 'refused') {
    return 'kind' in result.refusal
      ? { status: 'unchanged', value: result.refusal.value }
      : result.refusal;
  }
  return rejectedWithCurrent(result.code, result.reason, result.current);
}

/** The one record + one last event fragment every stage write uses. The event never carries this write's `since`. */
function stageFragment(next: InitializationAdoptionRecordV1, refKey: string, expectedRevision: number,
  eventId: string, occurredAt: string): CommitFragment {
  // The event carries the full next record minus `since`; the Store fills that field from this commit.
  const { since: _since, ...fields } = next;
  return {
    guards: [{ refKey, expectedRevision }],
    records: [initializationAdoptionCodec.encode(next)],
    claims: [],
    // The record type declares readonly arrays; the field table infers mutable ones. This is a type-level
    // cast only: the event keeps every field of the next record and nothing is copied or reshaped.
    events: [initializationAdoptionAdvancedCodec.encode({
      eventId, eventType: 'InitializationAdoptionAdvanced', schemaVersion: 1, occurredAt, ...fields,
    } as unknown as Parameters<typeof initializationAdoptionAdvancedCodec.encode>[0])],
    commitCursorBindings: [{ refKey, field: 'since' }],
  };
}

function stageEventValidate(event: { ref: InitializationAdoptionRef; stages: readonly { stage: string }[] },
  ref: InitializationAdoptionRef, stage: string): string | null {
  if (event.ref.projectId !== ref.projectId || event.ref.operationId !== ref.operationId) {
    return 'the event records another operation';
  }
  return event.stages.some(mark => mark.stage === stage) ? null : 'the event does not record this stage';
}

export function createInitializationAdoptionService(
  deps: InitializationAdoptionServiceDependencies,
): InitializationAdoptionPort {
  async function acceptAdoption(ctx: CoreCallContext, rawInput: InitializationAdoptInputV1) {
    const trusted = trustedContext(ctx, 'initialization adoption');
    if (!trusted.ok) return trusted.rejection;
    if (!isRecord(rawInput)) return rejected('invalid', 'the initialization adoption input must be an object');
    const input = rawInput;
    // The shape checks run before any read: the commandId, the source, the digest and the expected Goal.
    if (!nonEmpty(input.commandId)) return rejected('invalid', 'the commandId is required');
    const sourceProblem = checkShape(InitializationSourceShape, { source: input.source }, 'stored');
    if (sourceProblem !== null) return rejected('invalid', `the initialization source is invalid: ${sourceProblem}`);
    if (!isSha256Hex(input.expectedAnswerDigest)) {
      return rejected('invalid', 'the expected answer digest must be a sha256 hex digest');
    }
    if (!isRecord(input.expectedGoal) || !isRecord(input.expectedGoal.ref)) {
      return rejected('invalid', 'the expected Goal is required');
    }
    const goalProblem = checkShape(GoalRefShape, input.expectedGoal.ref, 'stored');
    if (goalProblem !== null) return rejected('invalid', `the expected Goal is invalid: ${goalProblem}`);
    if (!isInt(input.expectedGoal.revision) || input.expectedGoal.revision < 1) {
      return rejected('invalid', 'the expected Goal revision must be a positive safe integer');
    }

    const operationId = initializationAdoptionOperationId({
      projectId: trusted.scope.projectId, workspaceId: trusted.scope.workspaceId,
      source: input.source, expectedGoal: input.expectedGoal,
    });
    const operationRef: InitializationAdoptionRef = {
      aggregateType: 'InitializationAdoption', projectId: trusted.scope.projectId, operationId,
    };
    const refKey = canonicalRefKey(operationRef);
    const principal = principalIdentity(ctx.principal);
    const scope = { projectId: trusted.scope.projectId, workspaceId: trusted.scope.workspaceId };
    const fingerprintInput = {
      source: input.source, expectedAnswerDigest: input.expectedAnswerDigest, expectedGoal: input.expectedGoal,
    } as unknown as JsonValue;

    async function readAdoptionAcceptFacts(): Promise<{ status: 'ready'; facts: AcceptFacts } | CoreRejection> {
      const read = await readAdoptionRecord(deps.records, refKey);
      if (read.status === 'rejected') return read.rejection;
      if (read.status === 'present') return { status: 'ready', facts: { record: read.record } };

      // The birth branch reads the source only when the operation is genuinely absent.
      const factsRead = await deps.sources.readInitialPlanAnswerFacts(ctx, input.source.answerRef, input.source);
      if (factsRead.status === 'rejected') return factsRead;
      if (factsRead.status === 'not_found') return rejected('not_found', 'the initial plan answer was not found');
      if (factsRead.status === 'not_ready') return rejected('unavailable', 'the initial plan answer is not ready');
      const facts = factsRead.value;

      const source = input.source;
      if (source.answerRef.projectId !== ctx.projectId
        || source.answerRef.workspaceId !== ctx.workspaceId) {
        return rejected('invalid', 'the initialization source is outside this scope');
      }

      let resolved: InitializationAdoptInputV1['expectedGoal'];
      if (source.kind === 'binding') {
        const read = await deps.bindings.readBindingByAnswerDraft(ctx, {
          answerRef: source.answerRef,
          draftIndex: source.draftIndex,
        });
        if (read.status !== 'ready') {
          if (read.status === 'rejected') return read;
          return rejected(
            read.status === 'not_found' ? 'not_found' : 'unavailable',
            'the initialization binding could not be read',
          );
        }
        const binding = read.value;
        if (!sameJson(binding.answerRef, source.answerRef)
          || binding.draftIndex !== source.draftIndex
          || binding.goalRef.projectId !== ctx.projectId) {
          return rejected('invalid', 'the initialization binding is outside this source');
        }
        resolved = { ref: binding.goalRef, revision: binding.goalRevision };
      } else {
        if (facts.manifest.goal === null) {
          return rejected('invalid', 'the prepared source has no Goal');
        }
        resolved = facts.manifest.goal;
      }
      if (!sameJson(resolved, input.expectedGoal)) {
        return rejected('revision_conflict', 'the expected Goal does not match the source');
      }

      const parsed = parseInitialPlanningResponseV2(facts.answerText);
      if (parsed.status === 'rejected') return parsed;
      if (parsed.response.kind === 'needs_decision') {
        return rejected('invalid', 'the initial-planning answer needs a decision');
      }
      const answerDigest = sha256Hex(facts.answerText);
      if (input.expectedAnswerDigest !== answerDigest) {
        return rejected('source_stale', 'the initial plan answer does not match the expected digest');
      }
      const served = deps.roles.readServedRoles({
        projectId: ctx.projectId, workspaceId: source.answerRef.workspaceId,
      });
      const unserved = unservedRoles(parsed.response.plan.assignments, served);
      if (unserved.length > 0) {
        const role = unserved[0]!;
        return rejected('invalid',
          `the plan assigns role ${role}, which no execution binding of this workspace serves (served: ${served.length === 0 ? '(none)' : served.join(', ')})`);
      }
      const setup = parsed.response.setup ?? null;
      if (setup === null) {
        // With no setup, the two governance reads decide whether the project is already complete. Only an explicit
        // `not_found` counts as missing; a bare `not_ready` is the named unavailable answer.
        const architecture = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
        if (architecture.status === 'rejected') return architecture;
        if (architecture.status === 'not_ready') {
          return rejected('unavailable', 'the architecture baseline is not ready');
        }
        const policy = await deps.policies.readCurrentCompletionPolicy(ctx, { projectId: ctx.projectId });
        // The owner answers no active policy with its explicit `not_found` rejection (project-bootstrap-service.ts).
        if (policy.status === 'rejected' && policy.code !== 'not_found') return policy;
        if (policy.status === 'not_ready') {
          return rejected('unavailable', 'the completion policy is not ready');
        }
        if (architecture.status === 'not_found' || policy.status !== 'ready') {
          return rejected('incomplete', 'the initialization governance is incomplete');
        }
      }
      return { status: 'ready', facts: { record: null } };
    }

    const result = await executeWriteCommand<AcceptFacts, AcceptDecision, CoreRejection, AcceptedDecoded,
      AcceptValue>(deps.records, {
      operation: ACCEPT_OPERATION,
      scope,
      principal,
      commandId: input.commandId,
      fingerprintInput,
      read: readAdoptionAcceptFacts,
      decide(facts): { refuse: CoreRejection } | { decision: AcceptDecision } {
        if (facts.record === null) return { decision: { kind: 'birth' } };
        const record = facts.record;
        // An accept identity includes its principal, so the same command under another principal missed R2's
        // receipt lookup: it is another principal's command, never a replay of this record.
        if (record.commandId === input.commandId && !sameJson(record.principal, principal)) {
          return { refuse: rejected('idempotency_conflict', 'the command belongs to another principal') };
        }
        const sameBasis = sameJson(record.source, input.source)
          && record.expectedAnswerDigest === input.expectedAnswerDigest
          && sameJson(record.expectedGoal, input.expectedGoal);
        if (!sameBasis) {
          return { refuse: rejected('revision_conflict', 'the adoption operation has another basis') };
        }
        return { decision: { kind: 'existing', record } };
      },
      build(decision: AcceptDecision, keys: Keys): CommitFragment {
        const record = decision.kind === 'birth'
          ? newInitializationAdoptionRecord({
            ref: operationRef, scope, principal, commandId: input.commandId, fingerprint: keys.fingerprint,
            generation: 1, source: input.source, expectedAnswerDigest: input.expectedAnswerDigest,
            expectedGoal: input.expectedGoal,
          })
          : acceptExistingInitializationAdoption(decision.record, {
            commandId: input.commandId, fingerprint: keys.fingerprint, principal,
            source: input.source, expectedAnswerDigest: input.expectedAnswerDigest,
            expectedGoal: input.expectedGoal,
          });
        return {
          guards: [{ refKey, expectedRevision: decision.kind === 'birth' ? null : decision.record.revision }],
          records: [initializationAdoptionCodec.encode(record)],
          claims: [],
          events: [initializationAdoptionAcceptedCodec.encode({
            eventId: deps.eventId(), eventType: 'InitializationAdoptionAccepted', schemaVersion: 1,
            occurredAt: deps.now(), ref: record.ref, scope: record.scope, principal: record.principal,
            commandId: record.commandId, fingerprint: record.fingerprint, generation: record.generation,
            source: record.source, expectedAnswerDigest: record.expectedAnswerDigest,
            expectedGoal: record.expectedGoal,
          })],
          commitCursorBindings: [{ refKey, field: 'since' }],
        };
      },
      result: {
        eventType: 'InitializationAdoptionAccepted',
        schemaVersion: 1,
        decode: event => initializationAdoptionAcceptedCodec.decode(event),
        validate(event, _receipt, keys) {
          if (event.ref.projectId !== operationRef.projectId || event.ref.operationId !== operationId) {
            return 'the event records another operation';
          }
          if (event.commandId !== input.commandId) return 'the event records another command';
          return event.fingerprint === keys.fingerprint ? null : 'the event records another input';
        },
        project: event => ({ operationRef: event.ref as InitializationAdoptionRef, generation: event.generation }),
      },
    });
    return mapAccept(result);
  }

  async function read(ctx: CoreCallContext, input: { operationRef: InitializationAdoptionRef }):
    Promise<ReadResult<InitializationAdoptionReadV1>> {
    const recordRead = await readAdoptionRecord(deps.records, canonicalRefKey(input.operationRef));
    if (recordRead.status === 'rejected') {
      return rejected('unavailable', `the adoption operation is unavailable: ${recordRead.rejection.reason}`);
    }
    if (recordRead.status === 'absent') return { status: 'not_found' };
    const record = recordRead.record;
    return {
      status: 'ready',
      value: {
        operationRef: record.ref,
        revision: record.revision,
        generation: record.generation,
        stage: nextStage(record),
        completedSteps: [...record.completedSteps],
        stages: [...record.stages],
        result: record.result,
      },
    };
  }

  async function resume(_ctx: CoreCallContext, input: import('../../../contracts/initialization-adoption.js').AdoptionContinueInputV1):
    Promise<InitializationAdoptResultV1> {
    const read = await readAdoptionRecord(deps.records, canonicalRefKey(input.operationRef));
    if (read.status !== 'present') return readOnlyRejection(read);
    const record = read.record;
    if (record.revision !== input.expected.revision || record.generation !== input.expected.generation) {
      return rejected('revision_conflict', 'the adoption operation moved');
    }
    if (record.result !== null) return record.result;
    // No stored stop and no committed result: one unpersisted acknowledgement, never a write.
    return {
      status: 'pending', operationRef: record.ref, stage: nextStage(record),
      completedSteps: [...record.completedSteps], retryable: false,
      failure: { code: 'incomplete', reason: 'the stage has not stopped; continue with this stage' },
    };
  }

  /** One stage write. R2 replays the receipt before the `read`, so a committed identity never touches the current
   * record; the parent identity is the continuing accept's context, never a fresh read, and `decide` proves both. */
  async function stageWrite(
    ctx: CoreCallContext,
    input: AdoptionWriteIdentityV1,
    fingerprintInput: AdoptionParentFingerprintInputV1,
    businessDecide: (current: InitializationAdoptionRecordV1) =>
      { refuse: StageRefusal } | { decision: InitializationAdoptionRecordV1 },
  ): Promise<AdoptionStageWriteResultV1> {
    const refKey = canonicalRefKey(input.operationRef);
    const principal = principalIdentity(ctx.principal);
    const result = await executeWriteCommand<InitializationAdoptionRecordV1, StageDecision,
      StageRefusal, AdvancedDecoded, InitializationAdoptionRecordV1>(deps.records, {
      operation: ADVANCE_OPERATION,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal,
      commandId: input.commandId,
      fingerprintInput: fingerprintInput as unknown as JsonValue,
      read: async () => {
        const read = await readAdoptionRecord(deps.records, refKey);
        if (read.status !== 'present') return readOnlyRejection(read);
        return { status: 'ready', facts: read.record };
      },
      decide(current): { refuse: StageRefusal } | { decision: StageDecision } {
        if (input.generation !== current.generation) {
          return { refuse: rejected('revision_conflict', 'the adoption operation has another generation') };
        }
        if (!sameJson(current.principal, principal)) {
          return { refuse: rejected('idempotency_conflict', 'the command belongs to another principal') };
        }
        const decided = businessDecide(current);
        return 'refuse' in decided
          ? decided
          : { decision: { next: decided.decision, expectedRevision: current.revision } };
      },
      build(decision) {
        return stageFragment(decision.next, refKey, decision.expectedRevision, deps.eventId(), deps.now());
      },
      result: {
        eventType: 'InitializationAdoptionAdvanced',
        schemaVersion: 1,
        decode: event => initializationAdoptionAdvancedCodec.decode(event),
        validate: (event, _receipt) => stageEventValidate(event, input.operationRef, input.stage),
        // The event carries its four envelope keys plus the record fields; the projection is the only conversion.
        project: (event, cursor) => committedAdoptionRecord(
          event as unknown as Parameters<typeof committedAdoptionRecord>[0], cursor),
      },
    });
    return mapStageWrite(result);
  }

  async function saveBefore(ctx: CoreCallContext, input: AdoptionSaveBeforeInputV1): Promise<AdoptionStageWriteResultV1> {
    const fingerprintInput: AdoptionParentFingerprintInputV1 = {
      operationRef: input.operationRef, stage: input.stage, generation: input.generation, phase: 'before',
      child: input.child, savedInput: input.savedInput, pins: input.pins,
    };
    return stageWrite(ctx, input, fingerprintInput, current => {
      const index = INITIALIZATION_ADOPT_STAGES.indexOf(input.stage);
      if (index < 0) return { refuse: rejected('invalid', 'the stage is not an adoption stage') };
      if (current.completedSteps.includes(input.stage)) {
        const mark = current.stages[index];
        if (mark !== undefined && mark.stage === input.stage
          && sameJson(mark.child, input.child) && sameJson(mark.savedInput, input.savedInput)) {
          return { refuse: { kind: 'unchanged', value: current } };
        }
        return { refuse: rejected('revision_conflict', 'the completed stage has another frozen input') };
      }
      if (nextStage(current) !== input.stage) {
        return { refuse: rejected('revision_conflict', 'the stage is not the first not-completed stage') };
      }
      const mark = current.stages[index];
      if (mark !== undefined && mark.stage === input.stage) {
        if (mark.outcome === null) {
          const same = sameJson(mark.child, input.child) && sameJson(mark.savedInput, input.savedInput)
            && sameJson(mark.pins, input.pins);
          return same
            ? { refuse: { kind: 'unchanged', value: current } }
            : { refuse: rejected('revision_conflict', 'the before-mark has another frozen input') };
        }
        if (mark.generation < input.generation) {
          // A stopped mark is replaced only by a new generation, with its own frozen child/input/pins.
          return { decision: nextAdoptionStage(current, {
            commandId: input.commandId, operationRef: input.operationRef, stage: input.stage,
            generation: input.generation, child: mark.child, savedInput: mark.savedInput, pins: mark.pins,
          }) };
        }
        return { refuse: { kind: 'unchanged', value: current } };
      }
      return { decision: nextAdoptionStage(current, input) };
    });
  }

  async function saveAfter(ctx: CoreCallContext, input: AdoptionSaveAfterInputV1): Promise<AdoptionStageWriteResultV1> {
    const fingerprintInput: AdoptionParentFingerprintInputV1 = input.branch === 'advance'
      ? { operationRef: input.operationRef, stage: input.stage, generation: input.generation, phase: 'after',
          branch: 'advance', outcome: input.outcome, result: input.result }
      : input.branch === 'stop'
        ? { operationRef: input.operationRef, stage: input.stage, generation: input.generation, phase: 'after',
            branch: 'stop', outcome: input.outcome, result: input.result, failure: input.failure,
            retryable: input.retryable }
        : { operationRef: input.operationRef, stage: input.stage, generation: input.generation, phase: 'after',
            branch: 'complete', outcome: input.outcome, result: input.result, receipt: input.receipt };
    return stageWrite(ctx, input, fingerprintInput, current => {
      const index = INITIALIZATION_ADOPT_STAGES.indexOf(input.stage);
      if (index < 0) return { refuse: rejected('invalid', 'the stage is not an adoption stage') };
      if (nextStage(current) !== input.stage) {
        return { refuse: rejected('revision_conflict', 'the stage is not the current stage') };
      }
      const mark = current.stages[index];
      if (mark === undefined || mark.stage !== input.stage || mark.outcome !== null) {
        return { refuse: rejected('revision_conflict', 'the stage has no open before-mark') };
      }
      if (input.branch === 'stop') {
        const retryable = input.outcome === 'failed' && RETRYABLE_CODES.has(input.failure.code);
        if (input.outcome !== 'failed' && input.retryable !== false) {
          return { refuse: rejected('invalid', 'only a failed stop may be retryable') };
        }
        if (input.outcome === 'failed' && input.retryable && !retryable) {
          return { refuse: rejected('invalid', 'the failure code is not retryable') };
        }
      }
      if (input.branch === 'complete' && input.stage !== 'apply') {
        return { refuse: rejected('invalid', 'only the apply stage completes the operation') };
      }
      const next = input.branch === 'advance'
        ? advanceInitializationAdoption(current, input)
        : input.branch === 'stop'
          ? stopInitializationAdoption(current, input)
          : completeInitializationAdoption(current, input);
      return { decision: next };
    });
  }

  return { accept: acceptAdoption, read, resume, saveBefore, saveAfter };
}

