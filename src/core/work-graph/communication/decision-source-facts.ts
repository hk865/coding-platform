/**
 * Slice 5 §3.3 canonical decision-source facts (F41).
 *
 * The read-only seam that turns a `DecisionSourceV1` into its formal Goal,
 * objects, options, guards, `closed` flag and allowed reader Sessions, and that
 * proves one recorded application through its real receipt. It does not depend
 * on `views`; the source is re-derived from the lower-level records and the
 * shared `decisionSourceKey` contract, so a caller can never merely assert
 * "this card exists" (SPEC §4.2 line 790, S5-MSG-03).
 *
 * Every kind re-derives its identity, objects, pins, closure and allowed
 * readers from the formal records: a candidate is the real per-request head (or
 * the named proposal), a planning question is a real saved Answer question, a
 * goal cause names real affected objects (or a real missing active pointer) and
 * a goal conflict proves both Goals, both active Plan pointers and a real §4.3
 * overlap. The caller's `source.pins` are never trusted as authorization.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef, SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  DecisionSourceV1, GoalDecisionBasisV1, GoalFootprintV1 } from '../../../contracts/goal-decisions.js';
import { DEFAULT_GOAL_SETTINGS_V1, decisionSourceKey } from '../../../contracts/goal-decisions.js';
import { canonicalJson, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { DecodeResult, EncodedRecord, StoreFailure } from '../../record-store/ports.js';
import type { DecisionSourceFactsPort, NoteDecisionSourcePort, S5RecordPort } from '../model/decision-contracts.js';
import type { UnknownCallReviewReadPort } from '../model/unknown-call-review-contracts.js';
import type { CommandRerunRequestReadPort } from '../model/command-rerun-request-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { KernelCommandReader } from '../model/kernel-command-read-contracts.js';
import type { CommandRerunRequestV1 } from '../../../contracts/command-rerun-request.js';
import { commandRerunRequestCardFacts } from '../tasks/command-rerun-request-card.js';
import type { PlanProposal, PlanProposalRef, PlanTaskPort } from '../model/plan-contracts.js';
import { decodeQueryJobAnswerSnapshot, decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord } from '../queries/query-record-codecs.js';
import { decodeGoalPhaseSnapshot } from '../tasks/completion-record-codecs.js';
import { createGoalDecisionCauseReader } from '../tasks/goal-decision-reader.js';
import { parseInitialPlanningResponseV2 } from '../tasks/initial-plan.js';
import { readProposal, readRequestCandidateHead, readTaskClosure } from '../tasks/plan-readers.js';
import { decodePlanRevisionSnapshot } from '../persistence/plan-record-codecs.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX, unknownCallReviewCardFacts,
  unknownCallReviewTargetPaths } from '../tasks/unknown-call-review-card.js';
import { readReviewTargetDigests } from '../tasks/unknown-call-review-target-digests.js';
import type { WorkspaceToolsPort } from '../../workspace/ports.js';
import { goalConflictFacts } from '../state/goal-settings-machine.js';
import { decodeSessionMessageRecord } from '../sessions/message-record-codecs.js';
import { readApplicationReceiptFacts } from './decision-application.js';

/** The one Store seam this reader uses, the same instance every other WorkGraph reader shares. */
export type DecisionSourceFactsDependencies = {
  records: S5RecordPort;
  /**
   * §4.2 source 2: the formal Goal-cause reader seam (`queryGoalDisplay` and
   * `readInitialPlanAnswerFacts`). It is OPTIONAL so the frozen
   * `createDecisionSourceFacts({ records })` construction keeps compiling and
   * working; when present, a `goal_cause` source is proven to match one REAL
   * formal cause. Production wiring should pass the SAME Plan-service instance
   * the read model uses: `plans?: Pick<PlanTaskPort,
   * 'queryGoalDisplay' | 'readInitialPlanAnswerFacts'>`.
   */
  plans?: Pick<PlanTaskPort, 'queryGoalDisplay' | 'readInitialPlanAnswerFacts'>;
  /**
   * 4C-2 U6: the notes owner's note-review decision port. Optional; without it a
   * `note_review` source is explicitly `unavailable`, never an empty source.
   */
  noteDecisions?: Pick<NoteDecisionSourcePort, 'readNoteDecision'>;
  /**
   * K3 L18: the UnknownCallReview owner's direct read. Optional; without it a
   * `unknown_call_review` source is explicitly `unavailable`, never an empty
   * source. Only `readReview` is needed here (the card source reads the list).
   */
  unknownCallReviews?: Pick<UnknownCallReviewReadPort, 'readReview'>;
  /**
   * K3 L19a: the CommandRerunRequest owner's direct read. Optional; without it
   * (or the Kernel reader/execution read below) a `command_rerun_request`
   * source is explicitly `unavailable`, never an inferred open card.
   */
  commandRerunRequests?: Pick<CommandRerunRequestReadPort, 'listRequests' | 'readRequest'>;
  /** L19a: the original Run's Kernel command text (the card's blocked command). */
  readKernelCommandFacts?: KernelCommandReader;
  /** L19a: the original Run's Session, the Kernel reader's input. */
  commandRerunExecutions?: Pick<ExecutionReadPort, 'readExecution'>;
  /**
   * K3 L18: the workspace owner's read seam for each target path's current
   * digest. Optional so the frozen `{ records }` construction keeps compiling;
   * absent, every file object's digest is `null`.
   */
  workspace?: Pick<WorkspaceToolsPort, 'readWorkspace'>;
};

/**
 * §2.1/§3.3 line 629: a virtual/absence pin is not a stored aggregate. The
 * canonical `goal-decision-reader` emits `{aggregateType:'Task',…,revision:0}`
 * Task focus pins (a Task has no record schema); such a pin is satisfied by its
 * revision 0 and must never be read as a stored record. A non-zero revision, or
 * a revision-0 pin for a genuinely stored aggregate, is still read/CASed.
 */
const STORED_PIN_AGGREGATES: ReadonlySet<string> = new Set([
  'Goal', 'GoalPhase', 'Workspace', 'PlanRevision', 'PlanProposal', 'Run',
  'TaskAttempt', 'TaskLease', 'SessionMessage', 'QueryJob', 'QueryRun', 'QueryJobAnswer',
]);

function isAbsencePin(pin: VersionPin): boolean {
  if (!isRecord(pin.ref) || pin.revision !== 0) return false;
  const aggregateType = (pin.ref as { aggregateType?: unknown })['aggregateType'];
  if (typeof aggregateType !== 'string') return false;
  return aggregateType === 'Task' || !STORED_PIN_AGGREGATES.has(aggregateType);
}

/** §2.8: only the Goal aggregate has the named control-rebase exception. */
function isGoalPin(pin: VersionPin): boolean {
  return isRecord(pin.ref) && (pin.ref as { aggregateType?: unknown })['aggregateType'] === 'Goal';
}

type Scope = { projectId: string; workspaceId: string };

function isUserRecipient(recipient: unknown): boolean {
  return isRecord(recipient) && recipient['kind'] === 'user';
}

function sameJson(left: unknown, right: unknown): boolean {
  const leftKey = canonicalOf(left);
  return leftKey !== null && leftKey === canonicalOf(right);
}

/** The CRR aggregate ref is a stored record; the frozen AggregateRef union predates it (see the card). */
function requestPinOf(request: CommandRerunRequestV1): VersionPin {
  return { ref: structuredClone(request.ref) as unknown as VersionPin['ref'], revision: request.revision };
}

function clonePins(pins: readonly VersionPin[]): VersionPin[] {
  return pins.map((pin) => structuredClone(pin));
}

/** Verifier §2: one order-insensitive set comparison over complete pins. */
function samePinSet(left: readonly VersionPin[], right: readonly VersionPin[]): boolean {
  if (left.length !== right.length) return false;
  const remaining = new Set<string>();
  for (const pin of left) {
    const key = canonicalOf(pin);
    if (key === null) return false;
    remaining.add(key);
  }
  for (const pin of right) {
    const key = canonicalOf(pin);
    if (key === null || !remaining.delete(key)) return false;
  }
  return remaining.size === 0;
}

function goalBasis(goal: GoalSnapshot): GoalDecisionBasisV1 {
  return {
    goalRef: structuredClone(goal.ref),
    workspaceRef: structuredClone(goal.workspaceRef),
    objective: goal.objective,
    activePlanRef: structuredClone(goal.activePlanRevision),
    settings: structuredClone(goal.settings ?? DEFAULT_GOAL_SETTINGS_V1),
  };
}

/** SPEC §4.3: the three fixed conflict options, in the fixed wait/order/parallel order. */
const CONFLICT_OPTIONS: readonly DecisionOptionV1[] = [
  { id: 'wait', label: '等前一个目标', effect: 'apply' },
  { id: 'order', label: '调整顺序', effect: 'apply' },
  { id: 'parallel', label: '接受风险并行', effect: 'apply' },
];

/** §4.2 source 2: the concrete persisted "must decide" codes the reader can yield. */
const KNOWN_CAUSE_CODES: ReadonlySet<string> = new Set([
  'initial_plan_pending', 'change_pending', 'required_task_deferred',
  'auto_rework_count', 'auto_rework_pending',
  'auto_rework_cap_reached', 'no_new_basis', 'verification_uncovered',
  'budget_exhausted', 'not_reworkable', 'unknown_outcome',
  'automation_confirmation_required',
  'missing_initial_architecture', 'missing_initial_completion_policy',
]);

/**
 * The one stored-record read protocol shared by the current-source reads and the
 * saved answer's historical reads: canonical key -> exactly one `readMany` ->
 * distinguish the Store's own `missing` report from an unaccounted omission ->
 * decode. The two callers keep their own exact error texts.
 */
type ReadRecordTemplates = {
  notCanonical: string;
  couldNotRead: string;
  doesNotExist: string;
  unaccounted: string;
  damaged: (label: string, reason: string) => string;
};

const DECISION_SOURCE_READ_TEMPLATES: ReadRecordTemplates = {
  notCanonical: 'the decision source ref is not canonicalizable JSON',
  couldNotRead: 'the decision source record could not be read',
  doesNotExist: 'the decision source record does not exist',
  unaccounted: 'the decision source read neither returned nor reported missing the record',
  damaged: (label, reason) => `the ${label} record is damaged: ${reason}`,
};

const SAVED_ANSWER_READ_TEMPLATES: ReadRecordTemplates = {
  notCanonical: 'a saved answer source ref is not canonicalizable JSON',
  couldNotRead: 'the saved answer source record could not be read',
  doesNotExist: 'the saved answer source record does not exist',
  unaccounted: 'the saved answer source read neither returned nor reported missing the record',
  damaged: (label, reason) => `the saved answer ${label} record is damaged: ${reason}`,
};

/** This owner's own store-failure mapping: reason unchanged, never a shared map. */
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'not_found': return rejectedWithCurrent('not_found', failure.reason);
    case 'revision_conflict': return rejectedWithCurrent('revision_conflict', failure.reason);
    case 'unsupported': return rejectedWithCurrent('unsupported', failure.reason);
    default: return rejectedWithCurrent('unavailable', failure.reason);
  }
}

type EncodedRecordOutcome = { ok: true; record: EncodedRecord } | { ok: false; rejection: CoreRejection };

async function readStoredRecord(records: S5RecordPort, ref: unknown,
  templates: ReadRecordTemplates): Promise<EncodedRecordOutcome> {
  const key = canonicalOf(ref);
  if (key === null) return { ok: false, rejection: rejectedWithCurrent('invalid', templates.notCanonical) };
  let read: Awaited<ReturnType<S5RecordPort['readMany']>>;
  try {
    read = await records.readMany([key]);
  } catch {
    return { ok: false, rejection: rejectedWithCurrent('unavailable', templates.couldNotRead) };
  }
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    // F5/§4.2 line 821/§8.2 line 1367: only the Store's own missing report is
    // `not_found`; an unaccounted omission is an unavailable read.
    return read.value.missing.includes(key)
      ? { ok: false, rejection: rejectedWithCurrent('not_found', templates.doesNotExist) }
      : { ok: false, rejection: rejectedWithCurrent('unavailable', templates.unaccounted) };
  }
  return { ok: true, record };
}

async function readStoredDecoded<T>(records: S5RecordPort, ref: unknown, templates: ReadRecordTemplates,
  decode: (record: EncodedRecord) => DecodeResult<T>, label: string): Promise<ReadResult<T>> {
  const loaded = await readStoredRecord(records, ref, templates);
  if (!loaded.ok) return loaded.rejection;
  const decoded = decode(loaded.record);
  if (decoded.status !== 'decoded') {
    return rejectedWithCurrent('unavailable', templates.damaged(label, decoded.reason));
  }
  return { status: 'ready', value: decoded.value };
}

/** Builds the canonical source/application facts reader. */
export function createDecisionSourceFacts(
  deps: DecisionSourceFactsDependencies,
): DecisionSourceFactsPort {
  const records = deps.records;
  // §4.2 source 2: when the composition injects the formal Goal-cause reader,
  // every `goal_cause` source is verified against the real derived cause. When
  // it is absent (the frozen `{ records }` construction), only the named-code
  // check plus the affected-object reads below apply.
  const goalCauses = deps.plans === undefined
    ? null : createGoalDecisionCauseReader({ records, plans: deps.plans });

  /** §3.3 line 625 / §8.2: a foreign Workspace is refused before any foreign object is read. */
  function scopeProblem(ref: unknown, scope: Scope): ReadResult<never> | null {
    if (!isRecord(ref)) return rejectedWithCurrent('invalid', 'the decision source object ref is not a JSON object');
    const projectId = ref['projectId'];
    if (typeof projectId === 'string' && projectId.length > 0 && projectId !== scope.projectId) {
      return rejectedWithCurrent('forbidden', 'a decision source object belongs to another project');
    }
    const workspaceId = ref['workspaceId'];
    if (typeof workspaceId === 'string' && workspaceId.length > 0 && workspaceId !== scope.workspaceId) {
      return rejectedWithCurrent('forbidden', 'a decision source object belongs to another workspace');
    }
    return null;
  }

  async function readEncoded(ref: unknown): Promise<EncodedRecordOutcome> {
    return readStoredRecord(records, ref, DECISION_SOURCE_READ_TEMPLATES);
  }

  async function readDecoded<T>(
    ref: unknown,
    decode: (record: EncodedRecord) => DecodeResult<T>,
    label: string,
  ): Promise<ReadResult<T>> {
    return readStoredDecoded(records, ref, DECISION_SOURCE_READ_TEMPLATES, decode, label);
  }

  async function readGoal(ref: GoalRef): Promise<ReadResult<GoalSnapshot>> {
    return readDecoded(ref, decodeGoalSnapshot, 'Goal');
  }

  /**
   * §2.8 / §3.3 line 625 / S5-MSG-03: only the Goal aggregate's CONTROL
   * revision may be refreshed (the named control-rebase exception). Every other
   * source object keeps its captured revision; `verifyPins` then proves it
   * still reads at that version, so a moved object is `revision_conflict`.
   */
  async function refreshPins(pins: readonly VersionPin[], scope: Scope): Promise<ReadResult<VersionPin[]>> {
    const refreshed: VersionPin[] = [];
    for (const pin of pins) {
      const problem = scopeProblem(pin.ref, scope);
      if (problem !== null) return problem;
      if (!isGoalPin(pin)) {
        refreshed.push(structuredClone(pin));
        continue;
      }
      const loaded = await readEncoded(pin.ref);
      if (!loaded.ok) return loaded.rejection;
      refreshed.push({ ref: structuredClone(pin.ref), revision: loaded.record.revision });
    }
    return { status: 'ready', value: refreshed };
  }

  /** §4.3: the active Plan's planned module scopes (work Tasks only). */
  async function plannedModules(goal: GoalSnapshot): Promise<ReadResult<ModuleRef[]>> {
    if (goal.activePlanRevision === null) return { status: 'ready', value: [] };
    const read = await readDecoded(goal.activePlanRevision, decodePlanRevisionSnapshot, 'PlanRevision');
    if (read.status !== 'ready') return read;
    const modules: ModuleRef[] = [];
    const seen = new Set<string>();
    for (const task of read.value.tasks) {
      if (task.taskKind !== 'work' || task.disposition === 'cancelled' || task.disposition === 'superseded'
        || task.scope.kind !== 'module') continue;
      const module = { projectId: goal.ref.projectId, moduleId: task.scope.moduleRef };
      const key = canonicalOf(module) ?? '';
      if (seen.has(key)) continue;
      seen.add(key);
      modules.push(module);
    }
    return { status: 'ready', value: modules };
  }

  async function footprintOf(goal: GoalSnapshot): Promise<ReadResult<GoalFootprintV1>> {
    const modules = await plannedModules(goal);
    if (modules.status !== 'ready') return modules;
    return { status: 'ready', value: {
      goalRef: structuredClone(goal.ref),
      planRef: structuredClone(goal.activePlanRevision),
      plannedModules: modules.value,
      executedFiles: [],
      executedFilesAvailable: false,
      possiblyIncomplete: true,
    } };
  }

  async function goalTerminal(goal: GoalSnapshot): Promise<{ cancelled: boolean; completed: boolean } | ReadResult<never>> {
    if (goal.desiredState === 'cancelled') return { cancelled: true, completed: false };
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: goal.ref.projectId, goalId: goal.ref.goalId };
    const decoded = await readDecoded(phaseRef, decodeGoalPhaseSnapshot, 'GoalPhase');
    if (decoded.status === 'ready') {
      // §4.3 line 829: only a completion of the CURRENT active Plan is terminal.
      const completedPlanIsActive = goal.activePlanRevision !== null
        && canonicalJson(decoded.value.planRef as unknown as JsonValue) === canonicalJson(goal.activePlanRevision as unknown as JsonValue);
      return { cancelled: false, completed: decoded.value.phase === 'COMPLETED' && completedPlanIsActive };
    }
    // §8.2 data row: only an absent GoalPhase means no recorded completion.
    if (decoded.status === 'not_found' || (decoded.status === 'rejected' && decoded.code === 'not_found')) {
      return { cancelled: false, completed: false };
    }
    return decoded.status === 'rejected' ? decoded : rejectedWithCurrent('unavailable', 'the GoalPhase is not readable');
  }

  /** §3.3 line 625: every pinned object must still read at the captured version. */
  async function verifyPins(pins: readonly VersionPin[]): Promise<ReadResult<never> | null> {
    for (const pin of pins) {
      const key = canonicalOf(pin.ref);
      if (key === null) return rejectedWithCurrent('invalid', 'a decision source pin ref is not canonicalizable JSON');
      // A virtual Task/absence pin has no record schema: revision 0 is its fact.
      if (isAbsencePin(pin)) continue;
      const loaded = await readEncoded(pin.ref);
      if (!loaded.ok) return loaded.rejection;
      if (loaded.record.revision !== pin.revision) {
        return rejectedWithCurrent('revision_conflict', 'a decision source pin no longer reads at its captured version',
          [{ ref: structuredClone(pin.ref), revision: loaded.record.revision }]);
      }
    }
    return null;
  }

  /**
   * §4.2 source 2 / S5-MSG-03: prove a `goal_cause` source against the formal
   * reader. A cause that is absent is `not_found`; a read failure is returned
   * (`unavailable`/`forbidden`), never turned into "no such cause".
   */
  async function verifyRealCause(
    ctx: CoreCallContext,
    identity: Extract<DecisionSourceIdentityV1, { kind: 'goal_cause' }>,
  ): Promise<ReadResult<never> | null> {
    if (goalCauses === null) return null;
    let read: Awaited<ReturnType<typeof goalCauses.readGoalDecisionCauses>>;
    try {
      read = await goalCauses.readGoalDecisionCauses(ctx, { goalRef: identity.goalRef });
    } catch {
      return rejectedWithCurrent('unavailable', 'the formal Goal causes could not be read');
    }
    if (read.status !== 'ready') {
      return read.status === 'rejected' ? read : rejectedWithCurrent('unavailable', 'the formal Goal causes are not readable');
    }
    const match = read.value.some((cause) => cause.source.key === decisionSourceKey(identity));
    if (!match) return rejectedWithCurrent('not_found', 'the named Goal cause does not exist');
    return null;
  }

  /**
   * §4.6 line 915: the QueryRun's formal Session is the planning question's
   * reader fact, when saved. The saved answer's `runRef` is a REQUIRED formal
   * fact (the QueryJobAnswer codec refuses a missing one), so a missing or
   * damaged QueryRun is a read failure returned to the caller
   * (`unavailable`/`incomplete`) — never silently folded into an empty reader
   * set, which would make the asking Session `forbidden` instead of
   * `unavailable`. A readable QueryRun that genuinely carries no
   * Session stays an empty reader list.
   */
  async function questionReaderSessions(runRef: unknown): Promise<ReadResult<SessionRef[]>> {
    if (!isRecord(runRef)) {
      return rejectedWithCurrent('unavailable', 'the planning QueryJobAnswer names no formal QueryRun');
    }
    const read = await readDecoded(runRef, decodeQueryRunSnapshotRecord, 'QueryRun');
    if (read.status !== 'ready') {
      return read.status === 'rejected' && read.code === 'not_found'
        ? rejectedWithCurrent('unavailable', 'the planning question QueryRun record does not exist')
        : read;
    }
    const sessionRef = read.value.run.executionState?.sessionRef;
    return { status: 'ready', value: sessionRef === undefined
      ? [] : [{ projectId: sessionRef.projectId, sessionId: sessionRef.sessionId }] };
  }

  return {
    async readSource(ctx: CoreCallContext, source: DecisionSourceV1): Promise<ReadResult<{
      source: DecisionSourceV1; goal: GoalSnapshot;
      objects: DecisionObjectV1[]; options: DecisionOptionV1[];
      guards: readonly import('../../record-store/ports.js').RecordGuard[]; closed: boolean;
      allowedReaderSessionRefs: SessionRef[];
    }>> {
      if (!isRecord(source) || typeof source.key !== 'string' || source.key.length === 0) {
        return rejectedWithCurrent('invalid', 'readSource requires a decision source with its canonical key');
      }
      if (typeof ctx.projectId !== 'string' || ctx.projectId.length === 0
        || typeof ctx.workspaceId !== 'string' || ctx.workspaceId.length === 0) {
        return rejectedWithCurrent('forbidden', 'readSource requires a trusted bound project/workspace scope');
      }
      const scope: Scope = { projectId: ctx.projectId, workspaceId: ctx.workspaceId };
      let parsed: unknown;
      try {
        parsed = JSON.parse(source.key);
      } catch {
        return rejectedWithCurrent('invalid', 'the decision source key is not parseable JSON');
      }
      if (!isRecord(parsed) || parsed['kind'] !== source.kind) {
        return rejectedWithCurrent('invalid', 'the decision source key does not match its declared kind');
      }
      const identity = parsed as unknown as DecisionSourceIdentityV1;
      if (decisionSourceKey(identity) !== source.key) {
        return rejectedWithCurrent('invalid', 'the decision source key is not the canonical natural identity');
      }

      let goal: GoalSnapshot;
      let objects: DecisionObjectV1[] = [];
      let options: DecisionOptionV1[] = [];
      let pins: VersionPin[] = [];
      let goalBases: GoalDecisionBasisV1[] = [];
      let closed = false;
      let allowedReaderSessionRefs: SessionRef[] = [];

      switch (identity.kind) {
        case 'message': {
          const messageProblem = scopeProblem(identity.messageRef, scope);
          if (messageProblem !== null) return messageProblem;
          const loaded = await readEncoded(identity.messageRef);
          if (!loaded.ok) return loaded.rejection;
          const decoded = decodeSessionMessageRecord(loaded.record);
          if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the message record is damaged: ${decoded.reason}`);
          const message = decoded.value;
          if (!isUserRecipient(message.recipient) || message.decision === undefined
            || message.decision.syntheticAnswer || message.intent !== 'decision_request') {
            return rejectedWithCurrent('invalid', 'the decision source message is not an answerable user decision card');
          }
          const goalRead = await readGoal(message.goalRef ?? message.decision.source.goalRef);
          if (goalRead.status !== 'ready') return goalRead;
          goal = goalRead.value;
          if (goal.ref.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return rejectedWithCurrent('forbidden', 'the decision source Goal is outside the bound scope');
          }
          // §2.3 line 224: the answer source is generated in the current window;
          // the Goal pin follows the current Goal revision and the basis is the
          // formal Goal. The message's own pin stays out of `source.pins`.
          const refreshed = await refreshPins(message.decision.source.pins, scope);
          if (refreshed.status !== 'ready') return refreshed;
          pins = refreshed.value.filter((pin) => !sameJson(pin.ref, message.ref));
          objects = message.decision.objects.map((object) => structuredClone(object));
          options = message.decision.options.map((option) => structuredClone(option));
          goalBases = [goalBasis(goal)];
          closed = goal.desiredState === 'cancelled';
          allowedReaderSessionRefs = message.sender.kind === 'work_run'
            ? [{ projectId: message.sender.sessionRef.projectId, sessionId: message.sender.sessionRef.sessionId }] : [];
          break;
        }
        case 'goal_cause': {
          const goalProblem = scopeProblem(identity.goalRef, scope);
          if (goalProblem !== null) return goalProblem;
          if (!KNOWN_CAUSE_CODES.has(identity.code)) {
            return rejectedWithCurrent('not_found', 'the named Goal cause does not exist');
          }
          const goalRead = await readGoal(identity.goalRef);
          if (goalRead.status !== 'ready') return goalRead;
          goal = goalRead.value;
          if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return rejectedWithCurrent('forbidden', 'the decision source Goal is outside the bound scope');
          }
          // §4.2 source 2: with the formal reader injected, the (goalRef, code,
          // affected) identity must match one real derived cause.
          const realCause = await verifyRealCause(ctx, identity);
          if (realCause !== null) return realCause;
          for (const pin of identity.affected) {
            const pinProblem = scopeProblem(pin.ref, scope);
            if (pinProblem !== null) return pinProblem;
            // §2.1: a revision-0 Task/virtual focus pin is not a stored record.
            if (isAbsencePin(pin)) continue;
            const pinRead = await readEncoded(pin.ref);
            if (!pinRead.ok) return pinRead.rejection;
            if (pinRead.record.revision !== pin.revision) {
              return rejectedWithCurrent('revision_conflict', 'a Goal cause affected object moved since the cause was read',
                [{ ref: structuredClone(pin.ref), revision: pinRead.record.revision }]);
            }
          }
          if (identity.code === 'missing_initial_architecture' || identity.code === 'missing_initial_completion_policy') {
            const active = identity.code === 'missing_initial_architecture'
              ? { aggregateType: 'ProjectArchitectureBaselineActive', projectId: scope.projectId }
              : { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId };
            const read = await readEncoded(active);
            // Present = the cause has been resolved; a genuine read failure is
            // returned, never folded into "absent".
            if (read.ok) return rejectedWithCurrent('not_found', 'the named Goal cause has already been resolved');
            if (read.rejection.code !== 'not_found') return read.rejection;
          }
          if (identity.code === 'change_pending' || identity.code === 'initial_plan_pending') {
            // These causes are the real pending proposal; an affected proposal
            // that is absent or already resolved is not a live cause. A read
            // failure (`unavailable`) is returned unchanged.
            if (identity.affected.length !== 1) return rejectedWithCurrent('not_found', 'the pending Goal cause names no live proposal');
            const proposalRef = identity.affected[0]!.ref;
            if (!isRecord(proposalRef) || proposalRef['aggregateType'] !== 'PlanProposal') {
              return rejectedWithCurrent('not_found', 'the pending Goal cause does not name a proposal');
            }
            const proposal = await readProposal(records, proposalRef as unknown as PlanProposalRef);
            if (proposal.status !== 'ready') return proposal;
            if (proposal.proposal.status === 'accepted' || proposal.proposal.status === 'rejected') {
              return rejectedWithCurrent('not_found', 'the pending Goal cause proposal is already resolved');
            }
            if (proposal.proposal.goalRef.projectId !== goal.ref.projectId
              || proposal.proposal.goalRef.goalId !== goal.ref.goalId) {
              return rejectedWithCurrent('not_found', 'the pending Goal cause proposal belongs to another Goal');
            }
          }
          pins = [{ ref: structuredClone(goal.ref), revision: goal.revision },
            ...identity.affected.map((pin) => structuredClone(pin))];
          objects = identity.affected.map((pin) => ({
            kind: 'aggregate' as const, pin: structuredClone(pin), label: identity.code,
          }));
          options = [];
          goalBases = [goalBasis(goal)];
          closed = goal.desiredState === 'cancelled';
          break;
        }
        case 'candidate': {
          const goalProblem = scopeProblem(identity.goalRef, scope);
          if (goalProblem !== null) return goalProblem;
          const goalRead = await readGoal(identity.goalRef);
          if (goalRead.status !== 'ready') return goalRead;
          goal = goalRead.value;
          if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return rejectedWithCurrent('forbidden', 'the decision source Goal is outside the bound scope');
          }
          let proposal: PlanProposal | null;
          if ('requestRef' in identity) {
            if (identity.requestRef.projectId !== goal.ref.projectId
              || identity.requestRef.workspaceId !== goal.workspaceRef.workspaceId) {
              return rejectedWithCurrent('forbidden', 'the candidate request belongs to another Goal scope');
            }
            const head = await readRequestCandidateHead(records, { goalRef: goal.ref, requestRef: identity.requestRef });
            if (head.status !== 'ready') return head;
            proposal = head.head;
          } else {
            const named = await readProposal(records, identity.proposalRef);
            if (named.status !== 'ready') return named;
            proposal = named.proposal;
          }
          if (proposal === null || proposal.kind !== 'candidate_v2'
            || proposal.status === 'accepted' || proposal.status === 'rejected') {
            return rejectedWithCurrent('not_found', 'the candidate decision source no longer exists');
          }
          if (proposal.goalRef.projectId !== goal.ref.projectId || proposal.goalRef.goalId !== goal.ref.goalId) {
            return rejectedWithCurrent('not_found', 'the candidate decision source belongs to another Goal');
          }
          pins = [{ ref: structuredClone(goal.ref), revision: goal.revision },
            { ref: structuredClone(proposal.ref), revision: proposal.revision }];
          if (proposal.basedOn !== null) {
            pins.push({ ref: structuredClone(proposal.basedOn), revision: 1 });
          }
          objects = pins.map((pin) => ({ kind: 'aggregate' as const, pin: structuredClone(pin), label: 'candidate' }));
          options = [];
          goalBases = [goalBasis(goal)];
          closed = goal.desiredState === 'cancelled' || proposal.status === 'not_adopted';
          // §4.6 line 915: the candidate's formal saved proposer is the Agent
          // work_run that submitted it; without one there is no reader Session.
          const submittedBy = proposal.submittedBy;
          allowedReaderSessionRefs = submittedBy === undefined ? [] : [{
            projectId: submittedBy.sessionRef.projectId, sessionId: submittedBy.sessionRef.sessionId,
          }];
          break;
        }
        case 'planning_question': {
          const answerProblem = scopeProblem(identity.answerRef, scope);
          if (answerProblem !== null) return answerProblem;
          const answerRead = await readDecoded(identity.answerRef, decodeQueryJobAnswerSnapshot, 'QueryJobAnswer');
          if (answerRead.status !== 'ready') return answerRead;
          const answer = answerRead.value;
          const jobRead = await readDecoded(answer.answer.queryJobRef, decodeQueryJobSnapshot, 'QueryJob');
          if (jobRead.status !== 'ready') return jobRead;
          const job = jobRead.value;
          const jobGoalId = job.job.goalId;
          if (jobGoalId === null || jobGoalId.length === 0) return rejectedWithCurrent('incomplete', 'the planning QueryJob names no Goal');
          if (source.goalRef.goalId !== jobGoalId || source.goalRef.projectId !== scope.projectId) {
            return rejectedWithCurrent('invalid', 'the planning question does not belong to the named Goal');
          }
          const goalRead = await readGoal(source.goalRef);
          if (goalRead.status !== 'ready') return goalRead;
          goal = goalRead.value;
          if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return rejectedWithCurrent('forbidden', 'the planning question Goal is outside the bound scope');
          }
          if (job.job.status !== 'answered'
            || !job.job.answerRefs.some((ref) => sameJson(ref, identity.answerRef))) {
            return rejectedWithCurrent('not_found', 'the planning question has no saved formal answer');
          }
          const parsed = parseInitialPlanningResponseV2(answer.answer.answer);
          if (parsed.status !== 'parsed' || parsed.response.kind !== 'needs_decision'
            || !Number.isSafeInteger(identity.questionIndex) || identity.questionIndex < 0
            || identity.questionIndex >= parsed.response.questions.length) {
            return rejectedWithCurrent('not_found', 'the named planning question does not exist');
          }
          pins = [{ ref: structuredClone(goal.ref), revision: goal.revision },
            { ref: structuredClone(identity.answerRef), revision: 1 },
            { ref: structuredClone(job.ref), revision: job.revision }];
          objects = [];
          options = [];
          goalBases = [goalBasis(goal)];
          closed = goal.desiredState === 'cancelled';
          const readerSessions = await questionReaderSessions(answer.answer.runRef);
          if (readerSessions.status !== 'ready') return readerSessions;
          allowedReaderSessionRefs = readerSessions.value;
          break;
        }
        case 'goal_conflict': {
          // §8.2: both Goals are scope-checked BEFORE either record is read.
          for (const member of identity.pair) {
            const memberProblem = scopeProblem(member.goalRef, scope);
            if (memberProblem !== null) return memberProblem;
          }
          const goals: GoalSnapshot[] = [];
          for (const member of identity.pair) {
            const goalRead = await readGoal(member.goalRef);
            if (goalRead.status !== 'ready') return goalRead;
            const memberGoal = goalRead.value;
            if (memberGoal.workspaceRef.projectId !== scope.projectId || memberGoal.workspaceRef.workspaceId !== scope.workspaceId) {
              return rejectedWithCurrent('forbidden', 'a conflict Goal is outside the bound scope');
            }
            if (!sameJson(memberGoal.activePlanRevision, member.activePlanRef)) {
              return rejectedWithCurrent('revision_conflict', 'a conflict Goal active Plan pointer moved since the pair was read',
                [{ ref: structuredClone(memberGoal.ref), revision: memberGoal.revision }]);
            }
            goals.push(memberGoal);
          }
          if (goals.length !== 2 || sameJson(goals[0]!.ref, goals[1]!.ref)) {
            return rejectedWithCurrent('invalid', 'a goal conflict names two distinct Goals');
          }
          const leftFootprint = await footprintOf(goals[0]!);
          if (leftFootprint.status !== 'ready') return leftFootprint;
          const rightFootprint = await footprintOf(goals[1]!);
          if (rightFootprint.status !== 'ready') return rightFootprint;
          if (!goalConflictFacts(leftFootprint.value, rightFootprint.value).overlaps) {
            return rejectedWithCurrent('not_found', 'the two Goals have no §4.3 footprint conflict');
          }
          const named = goals.find((candidate) => sameJson(candidate.ref, source.goalRef));
          if (named === undefined) return rejectedWithCurrent('invalid', 'the conflict source does not name one of its Goals');
          goal = named;
          pins = goals.map((member) => ({ ref: structuredClone(member.ref), revision: member.revision }));
          for (const member of goals) {
            if (member.activePlanRevision !== null) {
              pins.push({ ref: structuredClone(member.activePlanRevision), revision: 1 });
            }
          }
          objects = [];
          options = CONFLICT_OPTIONS.map((option) => ({ ...option }));
          goalBases = goals.map(goalBasis);
          const terminals = await Promise.all(goals.map(goalTerminal));
          const unreadable = terminals.find((terminal) => 'status' in terminal);
          if (unreadable !== undefined && 'status' in unreadable) return unreadable;
          closed = terminals.some((terminal) => !('status' in terminal) && (terminal.cancelled || terminal.completed));
          break;
        }
        case 'note_review': {
          // 4C-2: the source key pins the note head; the card facts come from the
          // notes owner's port. An absent port/stale read is never an empty source.
          const rawNoteRef: unknown = identity.note.ref;
          const noteProblem = scopeProblem(rawNoteRef, scope);
          if (noteProblem !== null) return noteProblem;
          if (!isRecord(rawNoteRef)) return rejectedWithCurrent('invalid', 'the note_review source pin names no note');
          const noteId = rawNoteRef['noteId'];
          if (typeof noteId !== 'string' || noteId.length === 0) {
            return rejectedWithCurrent('invalid', 'the note_review source pin names no note');
          }
          const goalProblem = scopeProblem(source.goalRef, scope);
          if (goalProblem !== null) return goalProblem;
          const goalRead = await readGoal(source.goalRef);
          if (goalRead.status !== 'ready') return goalRead;
          goal = goalRead.value;
          if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return rejectedWithCurrent('forbidden', 'the note_review source Goal is outside the bound scope');
          }
          if (deps.noteDecisions === undefined) {
            return rejectedWithCurrent('unavailable', 'no note-decision reader is bound for a note_review source');
          }
          const noteRead = await deps.noteDecisions.readNoteDecision(ctx, {
            pin: { noteId, version: identity.note.revision },
          });
          if (noteRead.status !== 'ready') {
            return rejectedWithCurrent('unavailable', noteRead.status === 'rejected'
              ? noteRead.reason : 'the note decision is not readable');
          }
          const card = noteRead.value.card;
          const closedReason = noteRead.value.closedReason;
          if (card === null && closedReason === null) {
            // §slice-4/L17: the note moved after the card was read; nothing
            // recorded. The code is the CoreRejection `source_stale`.
            return rejectedWithCurrent('source_stale', 'source_stale');
          }
          if (card !== null) {
            // M1: the card's Goal is the note's Goal; a request that names
            // another Goal of the same workspace must not answer it there.
            if (card.goalId !== source.goalRef.goalId) {
              return rejectedWithCurrent('invalid', 'the note decision card belongs to another Goal');
            }
            // Verifier §2: compare the REQUEST's captured pins (the head and,
            // for an understanding, the CurrentPointer) with the fresh card;
            // one set comparison catches a moved head, a moved pointer and a
            // new pointer. A mismatch is `source_stale`, never a silent
            // replacement of the request pins.
            if (!samePinSet(source.pins, card.pins)) {
              return rejectedWithCurrent('source_stale', 'source_stale');
            }
          }
          closed = closedReason !== null;
          if (card !== null) {
            pins = clonePins(card.pins);
            objects = card.objects.map((object) => structuredClone(object));
            options = card.options.map((option) => structuredClone(option));
          }
          break;
        }
        case 'unknown_call_review': {
          // K3 L18: re-derive the whole card from the real record, the original
          // Run snapshot and the Goal's current plan window. The caller's pins
          // are never trusted.
          const reviewProblem = scopeProblem(identity.reviewRef, scope);
          if (reviewProblem !== null) return reviewProblem;
          const goalProblem = scopeProblem(source.goalRef, scope);
          if (goalProblem !== null) return goalProblem;
          const goalRead = await readGoal(source.goalRef);
          if (goalRead.status !== 'ready') return goalRead;
          goal = goalRead.value;
          if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return rejectedWithCurrent('forbidden', 'the review source Goal is outside the bound scope');
          }
          if (deps.unknownCallReviews === undefined) {
            return rejectedWithCurrent('unavailable', 'no UnknownCallReview reader is bound for an unknown_call_review source');
          }
          const reviewRead = await deps.unknownCallReviews.readReview(ctx, { ref: identity.reviewRef });
          if (reviewRead.status === 'not_found') return rejectedWithCurrent('not_found', 'the review record does not exist');
          if (reviewRead.status !== 'ready') return reviewRead;
          const record = reviewRead.value;
          if (record.revision !== identity.revision) {
            return rejectedWithCurrent('revision_conflict', 'the review record moved since the card was read',
              [{ ref: structuredClone(record.ref), revision: record.revision }]);
          }
          if (record.task.goalId !== goal.ref.goalId) {
            return rejectedWithCurrent('invalid', 'the review record belongs to another Goal');
          }
          const runRead = await readEncoded(record.runRef);
          if (!runRead.ok) return runRead.rejection;
          const decodedRun = decodeRun(runRead.record);
          if (!decodedRun.ok) {
            return rejectedWithCurrent('unavailable', `the original Run snapshot is damaged: ${decodedRun.reason}`);
          }
          // Ruling 4: the ONE canonical Task closure (satisfied/cancelled/
          // superseded), not the Plan disposition. A read failure is rejected.
          const closure = await readTaskClosure(records, goal.ref, record.task.taskId);
          if (closure.status !== 'ready') return closure;
          const fileDigests = await readReviewTargetDigests(ctx, deps.workspace,
            unknownCallReviewTargetPaths(record).slice(0, UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX));
          const facts = unknownCallReviewCardFacts({ record, goal, run: decodedRun.value,
            taskActive: !closure.value.closed, fileDigests });
          pins = clonePins(facts.source.pins);
          objects = facts.objects.map((object) => structuredClone(object));
          options = facts.closedReason === null ? facts.options.map((option) => structuredClone(option)) : [];
          goalBases = (facts.source.goalBases ?? []).map((basis) => structuredClone(basis));
          closed = facts.closedReason !== null;
          break;
        }
        case 'command_rerun_request': {
          // K3 L19a: re-derive the whole card from the real request, its review
          // record, the original Run's Kernel command and the Goal window. The
          // caller's pins are never trusted.
          const requestProblem = scopeProblem(identity.requestRef, scope);
          if (requestProblem !== null) return requestProblem;
          const goalProblem = scopeProblem(source.goalRef, scope);
          if (goalProblem !== null) return goalProblem;
          const goalRead = await readGoal(source.goalRef);
          if (goalRead.status !== 'ready') return goalRead;
          goal = goalRead.value;
          if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
            return rejectedWithCurrent('forbidden', 'the request source Goal is outside the bound scope');
          }
          if (deps.commandRerunRequests === undefined || deps.unknownCallReviews === undefined
            || deps.readKernelCommandFacts === undefined || deps.commandRerunExecutions === undefined) {
            return rejectedWithCurrent('unavailable', 'the CommandRerunRequest readers are not bound for a command_rerun_request source');
          }
          const requestRead = await deps.commandRerunRequests.readRequest(ctx, { ref: identity.requestRef });
          if (requestRead.status === 'not_found') return rejectedWithCurrent('not_found', 'the rerun request does not exist');
          if (requestRead.status !== 'ready') return requestRead;
          const request = requestRead.value;
          if (request.revision !== identity.revision) {
            return rejectedWithCurrent('revision_conflict', 'the rerun request moved since the card was read',
              [requestPinOf(request)]);
          }
          if (request.ref.goalId !== goal.ref.goalId) {
            return rejectedWithCurrent('invalid', 'the rerun request belongs to another Goal');
          }
          const reviewRead = await deps.unknownCallReviews.readReview(ctx, { ref: request.reviewRef });
          if (reviewRead.status === 'not_found') return rejectedWithCurrent('not_found', 'the request review record does not exist');
          if (reviewRead.status !== 'ready') return reviewRead;
          const record = reviewRead.value;
          if (record.task.goalId !== goal.ref.goalId) {
            return rejectedWithCurrent('invalid', 'the request review record belongs to another Goal');
          }
          // Ruling 4: the ONE canonical Task closure, not the Plan disposition.
          const closure = await readTaskClosure(records, goal.ref, request.ref.taskId);
          if (closure.status !== 'ready') return closure;
          const taskActive = !closure.value.closed;
          const blocked = record.blockedCommands.find(entry =>
            entry.reviewRunId === request.reviewRef.runId && entry.alias === request.alias);
          if (blocked === undefined) {
            return rejectedWithCurrent('unavailable',
              `the blocked command #${String(request.alias)} of ${request.reviewRef.runId} is not recorded`);
          }
          let execution;
          try {
            execution = await deps.commandRerunExecutions.readExecution(ctx, record.runRef);
          } catch (error) {
            const failure = error as { status?: unknown; code?: unknown } | null;
            if (failure !== null && typeof failure === 'object' && failure.status === 'rejected'
              && typeof failure.code === 'string') {
              return failure as unknown as CoreRejection;
            }
            return rejectedWithCurrent('unavailable', 'the original Run is not readable for the blocked command');
          }
          if (execution.status !== 'ready') {
            return execution.status === 'rejected' ? execution
              : rejectedWithCurrent('unavailable', 'the original Run is not readable for the blocked command');
          }
          const factsRead = await deps.readKernelCommandFacts(ctx, { session: execution.value.session,
            calls: [blocked.kernelCallRef],
            ...(ctx.signal === undefined ? {} : { signal: ctx.signal }) });
          if (factsRead.status !== 'ready') {
            return factsRead.status === 'rejected' ? factsRead
              : rejectedWithCurrent('unavailable', 'the blocked command text is not readable from the Kernel');
          }
          const blockedText = factsRead.value.get(blocked.kernelCallRef.callId)?.command ?? null;
          if (blockedText === null) {
            return rejectedWithCurrent('unavailable', 'the blocked command text is not readable from the Kernel');
          }
          const siblings: CommandRerunRequestV1[] = [];
          let siblingCursor: string | undefined;
          for (;;) {
            const page = await deps.commandRerunRequests.listRequests(ctx, {
              workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId },
              filter: { goalId: request.ref.goalId, taskId: request.ref.taskId },
              page: { limit: 200, ...(siblingCursor === undefined ? {} : { cursor: siblingCursor }) },
            });
            if (page.status !== 'ready') {
              return page.status === 'rejected' ? page
                : rejectedWithCurrent('unavailable', 'the alias rerun requests are not readable');
            }
            siblings.push(...page.value.items);
            if (page.value.nextCursor === null) break;
            siblingCursor = page.value.nextCursor;
          }
          const facts = commandRerunRequestCardFacts({ request, review: record, goal,
            blockedCommandText: blockedText, aliasRequests: siblings, taskActive });
          pins = clonePins(facts.source.pins);
          objects = facts.objects.map((object) => structuredClone(object));
          options = facts.closedReason === null ? facts.options.map((option) => structuredClone(option)) : [];
          goalBases = (facts.source.goalBases ?? []).map((basis) => structuredClone(basis));
          closed = facts.closedReason !== null;
          break;
        }
        case 'message_release':
          return rejectedWithCurrent('unsupported', 'this decision source is not available in this slice');
        default:
          return rejectedWithCurrent('invalid', 'the decision source kind is not recognized');
      }

      if (pins.length > 0) {
        const pinProblem = await verifyPins(pins);
        if (pinProblem !== null) return pinProblem;
      }
      const canonicalSource: DecisionSourceV1 = {
        kind: source.kind,
        key: source.key,
        goalRef: structuredClone(goal.ref),
        pins: clonePins(pins),
        goalBases: goalBases.map((basis) => structuredClone(basis)),
      };
      // §2.1/§3.3: a virtual absence pin (Task@0) is part of the source
      // identity and the accepted pin set, but it has no stored record schema,
      // so it must never become a Store commit guard.
      const guards = pins.filter((pin) => !isAbsencePin(pin)).map((pin) => {
        const refKey = canonicalOf(pin.ref);
        if (refKey === null) throw new Error('a verified decision source pin ref must canonicalize');
        return { refKey, expectedRevision: pin.revision };
      });
      return {
        status: 'ready',
        value: { source: canonicalSource, goal, objects, options, guards, closed, allowedReaderSessionRefs },
      };
    },
    readApplication: readApplicationReceiptFacts(records),
  };
}

// -------------------------------------------------------------------------- //
// §4.6 line 915 / N6: the SAVED answer's historical reader facts             //
// -------------------------------------------------------------------------- //

function readerScopeProblem(ref: unknown, scope: { projectId: string; workspaceId: string }): CoreRejection | null {
  if (!isRecord(ref)) {
    return { status: 'rejected', code: 'invalid', reason: 'a saved answer source ref is not a JSON object' };
  }
  const projectId = ref['projectId'];
  if (typeof projectId === 'string' && projectId.length > 0 && projectId !== scope.projectId) {
    return { status: 'rejected', code: 'forbidden', reason: 'a saved answer source object belongs to another project' };
  }
  const workspaceId = ref['workspaceId'];
  if (typeof workspaceId === 'string' && workspaceId.length > 0 && workspaceId !== scope.workspaceId) {
    return { status: 'rejected', code: 'forbidden', reason: 'a saved answer source object belongs to another workspace' };
  }
  return null;
}

/**
 * §4.6 line 915 / N6: derive the formal allowed reader Sessions of a SAVED
 * answer from the historical source captured with it, independent of whether
 * that source is still answerable. `readSource` is the answerability seam and
 * refuses a resolved candidate; this reader only re-derives the saved formal
 * proposer / request Session facts so the asking Session can read back the
 * answer it acted on. A read failure is returned (`unavailable`/`forbidden`),
 * never folded into "no reader".
 */
export async function readSavedAnswerReaderSessions(
  records: S5RecordPort,
  captured: DecisionSourceV1,
  scope: { projectId: string; workspaceId: string },
): Promise<ReadResult<SessionRef[]>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.key);
  } catch {
    return { status: 'rejected', code: 'invalid', reason: 'the saved answer source key is not parseable JSON' };
  }
  if (!isRecord(parsed) || parsed['kind'] !== captured.kind) {
    return { status: 'rejected', code: 'invalid', reason: 'the saved answer source key does not match its declared kind' };
  }
  const identity = parsed as unknown as DecisionSourceIdentityV1;
  if (decisionSourceKey(identity) !== captured.key) {
    return { status: 'rejected', code: 'invalid', reason: 'the saved answer source key is not the canonical natural identity' };
  }
  switch (identity.kind) {
    case 'message': {
      const problem = readerScopeProblem(identity.messageRef, scope);
      if (problem !== null) return problem;
      const read = await readStoredDecoded(records, identity.messageRef, SAVED_ANSWER_READ_TEMPLATES,
        decodeSessionMessageRecord, 'SessionMessage');
      if (read.status !== 'ready') return read;
      const sender = read.value.sender;
      return { status: 'ready', value: sender.kind === 'work_run'
        ? [{ projectId: sender.sessionRef.projectId, sessionId: sender.sessionRef.sessionId }] : [] };
    }
    case 'candidate': {
      // The captured answer's proposal pin proves the formal proposer even after
      // the head stopped being live (an accepted candidate is still stored).
      const proposalPin = captured.pins.find((pin) => isRecord(pin.ref) && pin.ref['aggregateType'] === 'PlanProposal');
      if (proposalPin === undefined) return { status: 'ready', value: [] };
      const problem = readerScopeProblem(proposalPin.ref, scope);
      if (problem !== null) return problem;
      const proposal = await readProposal(records, proposalPin.ref as unknown as PlanProposalRef);
      if (proposal.status !== 'ready') return proposal;
      if (proposal.proposal.kind !== 'candidate_v2') return { status: 'ready', value: [] };
      const submittedBy = proposal.proposal.submittedBy;
      return { status: 'ready', value: submittedBy === undefined ? [] : [{
        projectId: submittedBy.sessionRef.projectId, sessionId: submittedBy.sessionRef.sessionId,
      }] };
    }
    case 'planning_question': {
      const problem = readerScopeProblem(identity.answerRef, scope);
      if (problem !== null) return problem;
      const answer = await readStoredDecoded(records, identity.answerRef, SAVED_ANSWER_READ_TEMPLATES,
        decodeQueryJobAnswerSnapshot, 'QueryJobAnswer');
      if (answer.status !== 'ready') return answer;
      const runRef = answer.value.answer.runRef;
      if (!isRecord(runRef)) return { status: 'ready', value: [] };
      const run = await readStoredDecoded(records, runRef, SAVED_ANSWER_READ_TEMPLATES,
        decodeQueryRunSnapshotRecord, 'QueryRun');
      if (run.status !== 'ready') return run;
      const sessionRef = run.value.run.executionState?.sessionRef;
      return { status: 'ready', value: sessionRef === undefined ? [] : [{
        projectId: sessionRef.projectId, sessionId: sessionRef.sessionId,
      }] };
    }
    case 'goal_cause':
    case 'goal_conflict':
      return { status: 'ready', value: [] };
    default:
      return { status: 'ready', value: [] };
  }
}
