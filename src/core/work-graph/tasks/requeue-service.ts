/**
 * A.2 step 5.4 — `requeueTask` (docs/refactor/STATE-MACHINES-SPEC.md §4
 * TASK-16/17/28, §4.3 "处理步骤", §13; decisions D-3, C1, C2, C8, LA-5).
 *
 * The one entry that lets a Task whose selected Run ended open a new Attempt:
 * it commits either the immutable `TaskRequeue@1` (the Task projects P4,
 * `pending/requeued`, and the next claim must name it, TASK-03) or the
 * versioned policy refusal `TaskReworkRefusal@k` (TASK-28), never both. A
 * committed refusal is the `refused` value of the write, not a CoreError
 * (§1.2); every permission, state and transient problem is a 0-commit
 * rejection.
 *
 * The unified order (§4.3, §13.2 point 3), each step before the next IO:
 *   1. receipt lookup (a replay restores the original `requeued`/`refused`);
 *   2. principal admission and the actor class (`reworkActorClassOf`); an
 *      Agent through `authorizeDelegatedWrite(…, 'requeue_task')` (no
 *      production Role grants the tool before its Agent entry, GAP-46);
 *   3. one directed read window (Goal, active Plan, `readCanonicalTaskFacts`
 *      for this Task with its TaskRequeues and refusals, the selected Run's
 *      round chain) and the state preconditions (`taskRequeueStateProblem`),
 *      then the expected pins, the claim Lease and Session of the afterRun;
 *   4. the Goal `active`;
 *   5. the class (`deriveReworkClass`) and the actor × class matrix with the
 *      human-stop fence (`reworkPermission`), then every new input
 *      (`newBasisInputProblem`, ND-9);
 *   6. G-BUDGET, 7. G-CAP — refused without a source capture;
 *   8. `countEndedGoalRuns` over the Goal's raw Runs (unguarded, before 9);
 *   9. the digest-only source capture (LA-5); a human `note` is then stored
 *      as an Artifact and joins the new inputs;
 *  11. the §13.1 key (`noProgressKey`) against every earlier TaskRequeue of the
 *      Task unless the class skips it (ND-5, ND-6) — `no_new_basis`;
 *  12. one commit through `transitionTask` (and VR-09 on the chain head).
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { ControlIntentRef } from '../../../contracts/control-intent.js';
import type { CoreCallContext, CorePrincipal, MaterialReader } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { EffectWriteResultV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { SessionArchiveRequestV1 } from '../../../contracts/core/session-archive.js';
import type { DelegatedWriteProvenanceV1 } from '../../../contracts/delegated-write.js';
import type { RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, sameJson as sameRef, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef } from '../../../contracts/ledger.js';
import {
  MAX_NEW_BASIS_INPUT_REFS, newBasisInputProblem, type NewBasisInputObservationV1, type NewBasisInputRefV1,
  type SourceStampV1,
} from '../../../contracts/no-progress.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../../contracts/plan.js';
import type { ArchiveRequeueOriginV1, SessionAnomalyAnchorV1 } from '../../../contracts/session-anomaly.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, GOAL_FAN_OUT_ACTOR, TASK_REWORK_REASON_MAX_CHARS, reworkActorClassOf,
  type ReworkActorClass, type TaskAutomationPolicyV1, type TaskRequeueOutcomeV1, type TaskRequeueTriggerV1,
  type TaskReworkRefusalCode, type TaskReworkRefusalRef, type TaskReworkRefusalSnapshotV1,
} from '../../../contracts/task-requeue.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type {
  GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt, UniqueClaimChange,
} from '../../record-store/ports.js';
import type { WorkspaceHostBindings } from '../../workspace/access.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import type { MaterialPort } from '../model/material-contracts.js';
import {
  newBasisInputRefsProblem, runRefProblem, taskBudgetProblem, taskTripleProblem,
} from '../persistence/rework-codecs.js';
import { readGoalSettings as goalSettingsOf } from '../persistence/record-codecs.js';
import { sessionAggregateRefKey, decodeSessionRecord, plainSessionRefToAggregate } from '../sessions/session-record-codecs.js';
import { decodeSessionMessageRecord, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import { sessionArchiveChangedEventFromEvent } from '../sessions/lifecycle-record-codecs.js';
import { noProgressKey } from '../state/no-progress.js';
import { decisionActionPolicy } from '../state/decision-policy.js';
import {
  countEndedGoalRuns, deriveReworkClass, nextRequeueAutoCount, permissionInterruptionOf, requeueConfirmedByReview,
  reworkFenceOf, reworkPermission,
  taskReworkRefusalEffects, type StopIntentV1, type VerifiedArchiveInterruptionV1,
} from '../state/task-failure.js';
import {
  requeueBasisCompared, requeueBudgetIncreased, taskMachineStateOf, taskRequeueStateProblem, transitionTask,
  type TaskPhaseFacts, type TaskReworkFacts, type TaskState,
} from '../state/task-machine.js';
import type { Rejected as MachineRefusal } from '../state/transition.js';
import { isFinalizedNonPass, roundChainHead, transitionRound, type RoundChainHeadV1 } from '../state/verification-machine.js';
import { leaseReleasedForContinuation } from '../state/review-lease.js';
import { goalFanOutRequestId } from '../state/goal-machine.js';
import { controlIntentRefFor } from './control-service.js';
import {
  TASK_REQUEUED_EVENT_TYPE, TASK_REWORK_EVENT_SCHEMA_VERSION, TASK_REWORK_REFUSED_EVENT_TYPE,
  encodeTaskRequeueSnapshot, encodeTaskRequeuedEvent, encodeTaskReworkRefusalSnapshot, encodeTaskReworkRefusedEvent,
  taskRequeuedEventFromEvent, taskRequeueRefKey, taskReworkRefusalRefKey, taskReworkRefusedEventFromEvent,
  type TaskRequeuedEvent, type TaskReworkRefusedEvent,
} from './claim-record-codecs.js';
import { sessionMessageRefProblem } from './codec-shape-checks.js';
import type {
  ReadTaskRequeueByIdentityInputV1, RequeueTaskInput, TaskClaimPort, TaskRequeueReadV1,
} from '../model/claim-contracts.js';
import type { GoalSettingsPort } from '../model/decision-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import { loadReplayEvent, mapStoreFailure, mergeGuards } from './execution-entry-service.js';
import {
  readCanonicalTaskFacts, readGoal, readGoalRunsForCount, readPlan, readPointerIntents, readRunRoundChain, sameCursor,
  type CanonicalTaskFacts, type CanonicalTaskState,
} from './plan-readers.js';
import { buildEffectiveTaskBasis, isBasisUnsupported } from './plan-task-basis.js';
import { planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import {
  decodeSessionAnomalyAnchor, sessionAnomalyRefKey,
} from './session-anomaly-codecs.js';
import {
  authorizeDelegatedWrite, identifyDelegatedWriter, type AgentPlanWriter, type PlanDelegatedWriteDependencies,
} from './plan-write-admission.js';

/** Digest-only capture of a whole workspace root (LA-5): the snapshot digest `capture` also uses. */
export type SourceDigestResult = { status: 'ready'; sourceDigest: string } | { status: 'unavailable'; reason: string };
export type RequeueSourceDigestPort = { captureDigest(root: string): Promise<SourceDigestResult> };

export type TaskRequeueDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  /** WG11 reader: the afterRun's claim Session as it is now. */
  reads: ExecutionReadPort;
  /** The SAME Host workspace bindings the evidence owner resolves roots with (ND-2). */
  workspaceHost: Pick<WorkspaceHostBindings, 'resolveRoot'>;
  /** Digest-only source capture, the same reader instance as the evidence owner's (LA-5). */
  source: RequeueSourceDigestPort;
  /** Reads a referenced Artifact (ND-9) and stores a human `note` (§13.1). */
  materials: Pick<MaterialPort, 'storeArtifact' | 'openArtifact'>;
  /**
   * ND-9: a referenced session message is read through the mailbox owner, so
   * its scope and reader rules apply (a work-run caller reads only a message
   * addressed to or sent by its own Session).
   */
  messages: Pick<SessionMailboxPort, 'readMessage'>;
  /** C8 policy; absent is `DEFAULT_TASK_AUTOMATION_POLICY` (Host settings wire it in step 5.6). */
  automationPolicy?(): TaskAutomationPolicyV1;
  /**
   * Slice 5 §3.2/§4.4: the Goal-settings read seam for the automatic-rework
   * autonomy policy and the notice origin. Absent keeps the existing requeue
   * behaviour.
   */
  goalSettings?: GoalSettingsPort;
  /** W2/TD-6: the delegated-write admission an Agent requeue goes through; absent refuses an Agent. */
  delegatedWrites?: PlanDelegatedWriteDependencies;
  now(): string;
  eventId(): string;
};

const REQUEUE_IDENTITY_PREFIX = 'task-requeue:';
/** The content type a human `note` is stored with (§13.1 `newInputDigest`). */
export const REWORK_NOTE_CONTENT_TYPE = 'text/plain; charset=utf-8';
/** Read-window retries before a moved watermark is reported `revision_conflict`. */
const WINDOW_MAX_ATTEMPTS = 3;
/** The fixed platform attribution of the internal Host-only WG11 read. */
const INTERNAL_READ_ACTOR = Object.freeze({ kind: 'system' as const, id: 'task-requeue-reader' });

type Rejection = CoreRejection;
type Rejected = { ok: false; rejection: Rejection };

/**
 * The plain `{projectId,sessionId}` of an archive-origin Session, whether the
 * caller held a plain `SessionRef` or a full `SessionAggregateRef`
 * (`aggregateType:'Session'`); other aggregate types and missing ids are null
 * (mirrors `sessions/session-lifecycle.ts:normalizeSessionRef`).
 */
function plainOriginSessionRef(value: unknown): SessionRef | null {
  if (!isRecord(value) || (value['aggregateType'] !== undefined && value['aggregateType'] !== 'Session')
    || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) return null;
  return { projectId: value['projectId'], sessionId: value['sessionId'] };
}
/** C4a: the `archiveOrigin` refs are shape-checked before any canonical key or store read. */
function originAnchorRefProblem(value: unknown): string | null {
  if (!isRecord(value)
    || !Object.keys(value).every((key) => ['aggregateType', 'projectId', 'goalId', 'runId'].includes(key))
    || value['aggregateType'] !== 'SessionAnomalyAnchor'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'the archive origin anchorRef must be a complete SessionAnomalyAnchorRef';
  }
  return null;
}
function originMessageRefProblem(value: unknown): string | null {
  if (!isRecord(value)
    || !Object.keys(value).every((key) => ['aggregateType', 'projectId', 'workspaceId', 'messageId'].includes(key))
    || value['aggregateType'] !== 'SessionMessage'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) {
    return 'the archive origin messageRef must be a complete SessionMessageRef';
  }
  return null;
}
function reject(code: CoreError, reason: string, current?: VersionPin[]): Rejection {
  return rejectedWithNonEmptyCurrent(code, reason, current);
}
function refusalOf(refused: MachineRefusal | null): Rejection | null {
  return refused === null || refused.ok ? null : reject(refused.code, refused.detail);
}
function refKeyOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

// --------------------------------------------------------------------------
// Caller and request isolation
// --------------------------------------------------------------------------

/** The caller as the requeue sees it: a Host operator/automation actor, or an Agent's formal writer. */
type Caller =
  | { kind: 'host'; actor: Extract<ActorRef, { kind: 'human' | 'system' }> }
  | { kind: 'agent'; writer: AgentPlanWriter };

type OwnedCall = { ctx: CoreCallContext; scope: { projectId: string; workspaceId: string }; signal: AbortSignal;
  principal: CorePrincipal };

/** Bind the trusted scope synchronously, before the first await; the AbortSignal is kept by reference. */
function ownCall(ctx: CoreCallContext): { ok: true; value: OwnedCall } | Rejected {
  const raw = ctx as unknown as { projectId?: unknown; workspaceId?: unknown; principal?: unknown;
    materialReader?: unknown; signal?: unknown } | null | undefined;
  if (raw === null || raw === undefined) return { ok: false, rejection: reject('invalid', 'a requeue requires a bound call context') };
  const projectId = raw.projectId;
  const workspaceId = raw.workspaceId;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return { ok: false, rejection: reject('forbidden', 'a requeue requires a bound project/workspace context') };
  }
  const signal = raw.signal;
  if (!isRecord(signal) || typeof signal['aborted'] !== 'boolean' || typeof signal['addEventListener'] !== 'function') {
    return { ok: false, rejection: reject('forbidden', 'a requeue requires the bound AbortSignal') };
  }
  let principal: unknown;
  let materialReader: unknown;
  try {
    principal = structuredClone(raw.principal);
    materialReader = structuredClone(raw.materialReader);
  } catch {
    return { ok: false, rejection: reject('invalid', 'the call context identity cannot be isolated from the caller') };
  }
  if (!isRecord(principal) || (principal['kind'] !== 'host' && principal['kind'] !== 'work_run')) {
    return { ok: false, rejection: reject('forbidden', 'a requeue requires a Host or work-run principal') };
  }
  return { ok: true, value: {
    ctx: { projectId, workspaceId, principal: principal as CorePrincipal,
      materialReader: materialReader as MaterialReader, signal: signal as unknown as AbortSignal },
    scope: { projectId, workspaceId }, signal: signal as unknown as AbortSignal, principal: principal as CorePrincipal,
  } };
}

/** A Host caller's actor, checked against its material reader as every Host write does. */
function hostActorOf(owned: OwnedCall): { ok: true; actor: Extract<ActorRef, { kind: 'human' | 'system' }> } | Rejected {
  const principal = owned.principal;
  if (principal.kind !== 'host') return { ok: false, rejection: reject('forbidden', 'not a Host principal') };
  const actor = principal.actor as unknown;
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: reject('forbidden', 'a requeue requires a trusted Host actor') };
  }
  const reader = owned.ctx.materialReader as unknown;
  if (!isRecord(reader) || reader['kind'] !== 'host' || reader['projectId'] !== owned.scope.projectId
    || (reader['workspaceId'] !== undefined && reader['workspaceId'] !== owned.scope.workspaceId)
    || !isRecord(reader['actor']) || reader['actor']['kind'] !== actor['kind'] || reader['actor']['id'] !== actor['id']) {
    return { ok: false, rejection: reject('forbidden', 'the material reader is not the same trusted Host scope') };
  }
  return { ok: true, actor: { kind: actor['kind'], id: actor['id'] } as Extract<ActorRef, { kind: 'human' | 'system' }> };
}

type OwnedRequest = { input: RequeueTaskInput; requestId: string; expected: readonly VersionPin[] };

function ownRequest(request: GraphWrite<RequeueTaskInput>): { ok: true; value: OwnedRequest } | Rejected {
  const raw = request as unknown as { input?: unknown; meta?: unknown } | null | undefined;
  if (raw === null || raw === undefined || !isRecord(raw.input)) {
    return { ok: false, rejection: reject('invalid', 'a requeue requires a request input object') };
  }
  const meta = raw.meta;
  if (!isRecord(meta) || !nonEmpty(meta['requestId'])) return { ok: false, rejection: reject('invalid', 'a requeue requires meta.requestId') };
  if (!Array.isArray(meta['expected'])) return { ok: false, rejection: reject('invalid', 'meta.expected must be an array of version pins') };
  try {
    return { ok: true, value: { input: structuredClone(raw.input) as RequeueTaskInput, requestId: meta['requestId'],
      expected: structuredClone(meta['expected']) as VersionPin[] } };
  } catch {
    return { ok: false, rejection: reject('invalid', 'the requeue request cannot be isolated from the caller') };
  }
}

const INPUT_KEYS = ['taskRef', 'afterRunRef', 'reason', 'newInputRefs', 'budget', 'trigger', 'note', 'archiveOrigin',
  'acknowledgement'];

/** The request shape (§4.1 `RequeueTaskInput`); the actor-dependent fields are judged by the matrix (step 5). */
function inputProblem(input: RequeueTaskInput, scope: { projectId: string }): Rejection | null {
  const raw = input as unknown as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => INPUT_KEYS.includes(key))) return reject('invalid', 'the requeue input carries unknown fields');
  // 7A §3.5: the acknowledgement is shape-checked only; the owner reads no
  // message and compares no scope. It joins the fingerprint only when present.
  if (input.acknowledgement !== undefined) {
    const acknowledgementProblem = sessionMessageRefProblem(input.acknowledgement, 'requeueTask acknowledgement');
    if (acknowledgementProblem !== null) return reject('invalid', acknowledgementProblem);
  }
  const taskProblem = taskTripleProblem(raw['taskRef'], 'requeue taskRef');
  if (taskProblem !== null) return reject('invalid', taskProblem);
  const runProblem = runRefProblem(raw['afterRunRef'], 'requeue afterRunRef');
  if (runProblem !== null) return reject('invalid', runProblem);
  const task = input.taskRef;
  if (task.projectId !== scope.projectId) return reject('forbidden', 'the requeued Task belongs to another project');
  if (input.afterRunRef.projectId !== task.projectId || input.afterRunRef.goalId !== task.goalId) {
    return reject('invalid', 'the afterRun belongs to another Goal');
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0
    || input.reason.length > TASK_REWORK_REASON_MAX_CHARS) {
    return reject('invalid', `the requeue reason must be non-empty and at most ${TASK_REWORK_REASON_MAX_CHARS} characters`);
  }
  if (input.newInputRefs !== undefined) {
    const inputsProblem = newBasisInputRefsProblem(input.newInputRefs, 'requeue newInputRefs');
    if (inputsProblem !== null) return reject('invalid', inputsProblem);
  }
  if (input.budget !== undefined) {
    const budgetProblem = taskBudgetProblem(input.budget, 'requeue budget');
    if (budgetProblem !== null) return reject('invalid', budgetProblem);
  }
  if (input.trigger !== undefined) {
    const trigger = input.trigger as unknown;
    if (!isRecord(trigger) || trigger['kind'] !== 'goal_resume' || !isRecord(trigger['goalRef'])
      || !Number.isSafeInteger(trigger['resumedEpoch']) || !Number.isSafeInteger(trigger['pausedEpoch'])) {
      return reject('invalid', 'the requeue trigger must be a goal_resume trigger');
    }
  }
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.trim().length === 0)) {
    return reject('invalid', 'the requeue note must be non-empty text');
  }
  if (input.archiveOrigin !== undefined && input.archiveOrigin !== null) {
    const origin = input.archiveOrigin as unknown;
    if (!isRecord(origin) || (origin['kind'] !== 'execution' && origin['kind'] !== 'wait')) {
      return reject('invalid', 'archive_input_invalid: the requeue archiveOrigin must be an execution or wait origin');
    }
    if (!nonEmpty(origin['archiveRequestId'])) {
      return reject('invalid', 'archive_input_invalid: the archive origin requires an archiveRequestId');
    }
    if (plainOriginSessionRef(origin['archiveSessionRef']) === null) {
      return reject('invalid', 'archive_input_invalid: the archive origin requires a complete SessionRef');
    }
    if (origin['kind'] === 'execution') {
      const anchorProblem = originAnchorRefProblem(origin['anchorRef']);
      if (anchorProblem !== null) return reject('invalid', `archive_input_invalid: ${anchorProblem}`);
    } else {
      const originRunProblem = runRefProblem(origin['runRef'], 'archive origin runRef');
      if (originRunProblem !== null) return reject('invalid', `archive_input_invalid: ${originRunProblem}`);
      const messageProblem = originMessageRefProblem(origin['messageRef']);
      if (messageProblem !== null) return reject('invalid', `archive_input_invalid: ${messageProblem}`);
    }
  }
  return null;
}

type ExpectedPins = { goal: VersionPin; afterRun: VersionPin; refusal: VersionPin | null };

/** §13.2 point 5: exactly Goal@rev and afterRun@rev, and optionally `TaskReworkRefusal(requeue, afterRun)@k` (0 = absent). */
function expectedPinsOf(expected: readonly VersionPin[], goalRef: GoalRef, afterRunRef: RunRef,
  refusalRef: TaskReworkRefusalRef): { ok: true; value: ExpectedPins } | Rejected {
  let goal: VersionPin | null = null;
  let afterRun: VersionPin | null = null;
  let refusal: VersionPin | null = null;
  for (const pin of expected as readonly unknown[]) {
    if (!isRecord(pin) || !isRecord(pin['ref']) || !Number.isSafeInteger(pin['revision']) || (pin['revision'] as number) < 0) {
      return { ok: false, rejection: reject('invalid', 'every expected pin needs a ref and a safe non-negative revision') };
    }
    const typed = pin as unknown as VersionPin;
    if (sameRef(typed.ref, goalRef) && goal === null) goal = typed;
    else if (sameRef(typed.ref, afterRunRef) && afterRun === null) afterRun = typed;
    else if (sameRef(typed.ref, refusalRef) && refusal === null) refusal = typed;
    else return { ok: false, rejection: reject('invalid', 'meta.expected must be the Goal, afterRun and optional refusal pins without extras') };
  }
  if (goal === null || afterRun === null) {
    return { ok: false, rejection: reject('invalid', 'meta.expected must pin the Goal and the afterRun') };
  }
  return { ok: true, value: { goal, afterRun, refusal } };
}

function sortedPins(expected: readonly VersionPin[]): { ref: VersionPin['ref']; revision: number }[] {
  return [...expected].map((pin) => ({ ref: pin.ref, revision: pin.revision }))
    .sort((left, right) => {
      const leftKey = refKeyOf(left.ref);
      const rightKey = refKeyOf(right.ref);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

// --------------------------------------------------------------------------
// The read window (§4.3 step 3)
// --------------------------------------------------------------------------

export type RequeueWindow = {
  goal: GoalSnapshot;
  plan: PlanRevisionSnapshot;
  definition: RuntimeTask;
  facts: CanonicalTaskFacts;
  canonical: CanonicalTaskState;
  state: TaskState;
  rework: TaskReworkFacts;
};

/**
 * The directed facts of the requeued Task in one window: the Goal, its active
 * Plan, `readCanonicalTaskFacts` for this Task (Runs, Lease, Reduction, every
 * ended Run's TaskRequeue and requeue refusal) and the selected Run's round
 * chain whatever its outcome (I-12 clause 2). A watermark that moved between
 * the reads reads the whole window again.
 *
 * Exported (spec §2) so the read-only views share this canonical window
 * instead of duplicating a reduced copy.
 */
export async function readRequeueWindow(
  records: GoalRecordTransactionPort & RecordLookupPort, goalRef: GoalRef, taskId: string, afterRunRef: RunRef,
): Promise<{ ok: true; value: RequeueWindow } | Rejected> {
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return { ok: false, rejection: reject(goalRead.code, goalRead.reason) };
    const goal = goalRead.goal;
    const activePlan = goal.activePlanRevision;
    if (activePlan === null) return { ok: false, rejection: reject('incomplete', 'the Goal has no adopted Plan') };
    const planRead = await readPlan(records, activePlan);
    if (planRead.status !== 'ready') return { ok: false, rejection: reject(planRead.code, planRead.reason) };
    const plan = planRead.plan;
    const definition = plan.tasks.find((task) => task.taskId === taskId);
    if (definition === undefined) return { ok: false, rejection: reject('not_found', 'the Task is not part of the active Plan') };
    const factsRead = await readCanonicalTaskFacts(records, goalRef, plan, taskId);
    if (factsRead.status !== 'ready') return { ok: false, rejection: reject(factsRead.code, factsRead.reason) };
    const facts = factsRead.value;
    const canonical = facts.byTaskId.get(taskId);
    if (canonical === undefined) return { ok: false, rejection: reject('incomplete', 'the directed task state was not read') };
    const execution = canonical.execution;
    const runs = facts.runsByTaskId.get(taskId) ?? [];
    const selectedRun = execution === null ? null : runs.find((run) => sameRef(run.ref, execution)) ?? null;
    if (execution !== null && selectedRun === null) return { ok: false, rejection: reject('incomplete', 'the selected Run was not read') };
    // The selected Run's chain whatever its outcome; a completed Run's was read with the facts.
    let chain: RoundChainHeadV1 = facts.chainsByTaskId.get(taskId) ?? { kind: 'none' };
    if (selectedRun !== null && !facts.chainsByTaskId.has(taskId)) {
      const chainRead = await readRunRoundChain(records, selectedRun);
      if (chainRead.status !== 'ready') return { ok: false, rejection: reject(chainRead.code, chainRead.reason) };
      if (chainRead.readThrough !== undefined && !sameCursor(chainRead.readThrough, facts.readThrough)) continue;
      chain = roundChainHead(chainRead.rounds);
    }
    const phaseFacts: TaskPhaseFacts = {
      taskKind: definition.taskKind,
      applicableReduction: canonical.reductionRevision === null ? null : facts.reductionsByTaskId.get(taskId) ?? null,
      selectedRun,
      originUnresolvable: selectedRun === null && canonical.reductionRevision === null && canonical.effectivePhase === 'blocked',
      round: facts.roundsByTaskId.get(taskId) ?? { kind: 'none' },
      coveringRequeue: canonical.requeueRef,
    };
    const state = taskMachineStateOf(definition, phaseFacts);
    if (state === null) return { ok: false, rejection: reject('not_found', 'the Task is not part of the active Plan') };
    const basis = buildEffectiveTaskBasis(plan).get(taskId);
    return { ok: true, value: { goal, plan, definition, facts, canonical, state, rework: {
      selectedRun,
      afterRunIsSelected: selectedRun !== null && sameRef(selectedRun.ref, afterRunRef),
      chain,
      basisResolved: basis !== undefined && !isBasisUnsupported(basis),
      goalDesiredState: goal.desiredState,
      priorBasisDigests: (facts.requeuesByTaskId.get(taskId) ?? []).map((requeue) => requeue.basis.digest),
    } } };
  }
  return { ok: false, rejection: reject('revision_conflict', 'the requeue read window changed while it was being read') };
}

/**
 * The selected Run's review fact as the requeue owner reads it, from
 * the ONE canonical window (`readCanonicalTaskFacts`). `null` is only the
 * authoritative `not_found` (a K3-before Run) and no blocker; `held` wins over
 * the status; any non-`resolved` status is `pending`; every failed read is the
 * shared `unreadable` (fail-closed), never absence.
 */
function selectedReviewBlockerOf(
  review: CanonicalTaskState['unknownCallReview'],
): 'pending' | 'held' | 'unreadable' | undefined {
  if (review === null) return undefined;
  if (review.status === 'unreadable') return 'unreadable';
  if (review.hold === 'held') return 'held';
  return review.status === 'resolved' ? undefined : 'pending';
}

/**
 * ND-9 (§13.1, §13.7 point 1): each requested new input as the owner reads it,
 * judged by `newBasisInputProblem`: an Artifact through `openArtifact`, a
 * session message through the mailbox owner, under its reader rules (one of
 * another project or workspace is `forbidden` before any read; without the
 * mailbox owner it is `unsupported`). Shared by the requeue and the reverify
 * owner (`evidence-service.ts` `reverifyRound`).
 */
export async function newBasisInputsProblem(
  reads: { materials: Pick<MaterialPort, 'openArtifact'>; messages: Pick<SessionMailboxPort, 'readMessage'> | undefined },
  ctx: CoreCallContext,
  scope: { projectId: string; workspaceId: string },
  inputs: readonly NewBasisInputRefV1[],
): Promise<Rejection | null> {
  for (const input of inputs) {
    let observed: NewBasisInputObservationV1;
    switch (input.kind) {
      case 'artifact': {
        const opened = await reads.materials.openArtifact(ctx, { ref: input.ref, usage: 'historical_explanation' });
        if (opened.status === 'ready') observed = { kind: 'artifact' };
        else if (opened.status === 'not_found') observed = { kind: 'not_found' };
        else if (opened.status === 'rejected' && opened.code !== 'not_found') return reject(opened.code, opened.reason);
        else observed = { kind: 'not_found' };
        break;
      }
      case 'session_message': {
        // A message of another project or workspace is never a new input here (refused before any read).
        if (input.ref.projectId !== scope.projectId || input.ref.workspaceId !== scope.workspaceId) {
          return reject('forbidden', 'a new input message belongs to another project or workspace');
        }
        if (reads.messages === undefined) return reject('unsupported', 'a session-message new input needs the mailbox owner');
        const read = await reads.messages.readMessage(ctx, input.ref);
        if (read.status === 'ready') observed = { kind: 'session_message', status: read.value.status };
        else if (read.status === 'not_found') observed = { kind: 'not_found' };
        else if (read.status === 'rejected') return reject(read.code, read.reason, read.current);
        else return reject('incomplete', 'the session message is not readable at the required watermark');
        break;
      }
      default: {
        const unknownInput: never = input;
        return reject('invalid', `unknown new input kind ${String((unknownInput as { kind?: unknown }).kind)}`);
      }
    }
    const problem = newBasisInputProblem(input, observed);
    if (problem !== null) return reject('invalid', problem);
  }
  return null;
}

/**
 * S1-TASK-01 / §3.4: the verified archive interruption a `requeueTask` with an
 * `archiveOrigin` may pass to `deriveReworkClass`. `anchor` is the anchor the
 * caller read for an `execution` origin (an anchor that does not belong to this
 * archive request or run verifies nothing); a `wait` origin verifies from the
 * message's recorded disposal and cancel intent instead, never from a fabricated
 * anchor. Returns `null` when the requeue is not archive-caused or its durable
 * evidence does not verify, in which case the original FC-1/FC-2/paused fences
 * still decide.
 */
export function verifiedArchiveInterruptionOf(
  input: RequeueTaskInput,
  anchor: SessionAnomalyAnchorV1 | null,
): VerifiedArchiveInterruptionV1 | null {
  const origin = input.archiveOrigin;
  if (origin === undefined || origin === null) return null;
  if (origin.kind === 'execution') {
    // The durable request and the anchor are verified by the owner before this
    // pure match; an anchor of another request, Run or line verifies nothing.
    if (anchor === null) return null;
    const originSession = plainOriginSessionRef(origin.archiveSessionRef);
    if (originSession === null) return null;
    if (!sameRef(anchor.ref, origin.anchorRef)) return null;
    if (!sameRef(anchor.runRef, input.afterRunRef)) return null;
    if (!sameRef(anchor.sessionRef, originSession)) return null;
    if (anchor.archiveRequestId !== origin.archiveRequestId) return null;
    if (!sameRef(anchor.task, input.taskRef)) return null;
    return { kind: 'execution', anchorRef: anchor.ref, runRef: input.afterRunRef,
      cause: anchor.cause === 'retired_archive' ? 'retired_interruption' : 'archive_cancel' };
  }
  // kind === 'wait'
  if (!sameRef(origin.runRef, input.afterRunRef)) return null;
  return { kind: 'wait', runRef: input.afterRunRef, messageRef: origin.messageRef, cause: 'archive_wait_cancel' };
}

/**
 * §2.3/rule 10: the exact `s1-archive-control:` cancel intent the archive
 * Workflow mints for this durable request and Run. A different cancel (or an
 * earlier operator stop) never makes the Run an archive-caused stop.
 */
function archiveCancelIntentRef(
  request: SessionArchiveRequestV1, scope: { projectId: string; workspaceId: string }, runRef: RunRef,
): ControlIntentRef {
  const archiveControlId = 's1-archive-control:' + sha256Hex(canonicalJson({
    requestReceipt: request.receipt, runRef, action: 'cancel' } as unknown as JsonValue));
  return controlIntentRefFor(request.requestedBy, scope, archiveControlId);
}

/** Whether the Run's pointer is exactly this request's archive cancel intent. */
function isArchiveCancelIntent(
  pointerIntent: StopIntentV1 | null, request: SessionArchiveRequestV1,
  scope: { projectId: string; workspaceId: string }, runRef: RunRef,
): boolean {
  return pointerIntent !== null && pointerIntent.kind === 'cancel'
    && sameRef(pointerIntent.requestedBy, request.requestedBy)
    && sameRef(pointerIntent.ref, archiveCancelIntentRef(request, scope, runRef));
}

/** The §4.4 refusal with the version pins §13.3 names: the selected Run, or the TaskRequeue@1 already covering it. */
function stateRefusal(refused: MachineRefusal, window: RequeueWindow): Rejection {
  if (refused.ok) throw new Error('stateRefusal needs a refusal');
  const run = window.rework.selectedRun;
  if (refused.code === 'revision_conflict') {
    if (window.state.row === 'P4' && window.canonical.requeueRef !== null) {
      return reject(refused.code, refused.detail, [{ ref: window.canonical.requeueRef, revision: 1 }]);
    }
    if (run !== null) return reject(refused.code, refused.detail, [{ ref: run.ref, revision: run.revision }]);
  }
  return reject(refused.code, refused.detail);
}

/**
 * Whether the person's applied review-card disposition already
 * confirmed the ONE system requeue after `afterRunId`. The full record is in
 * the same canonical window (`reviewsByTaskId`); a missing record is not a
 * confirmation. `handle_myself` counts only after its release.
 */
function requeueConfirmedByCardOf(window: RequeueWindow, taskId: string, afterRunId: string): boolean {
  const review = (window.facts.reviewsByTaskId.get(taskId) ?? [])
    .find(candidate => candidate.runRef.runId === afterRunId);
  return review !== undefined && requeueConfirmedByReview(review);
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createTaskRequeueService(
  deps: TaskRequeueDependencies,
): Required<Pick<TaskClaimPort, 'requeueTask' | 'readTaskRequeue' | 'readTaskRequeueByIdentity'>> {
  const records = deps.records;
  const policyOf = (): TaskAutomationPolicyV1 => deps.automationPolicy?.() ?? DEFAULT_TASK_AUTOMATION_POLICY;

  function identityOf(actor: ActorRef, scope: { projectId: string; workspaceId: string }, requestId: string): string {
    return REQUEUE_IDENTITY_PREFIX + sha256Hex(canonicalJson({ actor: { kind: actor.kind, id: actor.id },
      projectId: scope.projectId, workspaceId: scope.workspaceId, requestId } as unknown as JsonValue));
  }

  /** Receipt replay: the recorded `TaskRequeued` or `TaskReworkRefused` restores the original value. */
  async function replay(
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>, identity: string, fingerprint: string, actor: ActorRef,
    acknowledgement: SessionMessageRef | null,
  ): Promise<EffectWriteResultV1<TaskRequeueOutcomeV1>> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const event = loaded.event;
    let decoded: { identityKey: string; fingerprint: string; actor: ActorRef; value: TaskRequeueOutcomeV1 };
    if (event.eventType === TASK_REQUEUED_EVENT_TYPE) {
      const requeued = taskRequeuedEventFromEvent(event);
      if (requeued.status !== 'decoded') return reject('unavailable', `the recorded requeue event is not decodable: ${requeued.reason}`);
      decoded = { ...requeued.value, value: { kind: 'requeued', requeue: requeued.value.requeue } };
    } else if (event.eventType === TASK_REWORK_REFUSED_EVENT_TYPE) {
      const refused = taskReworkRefusedEventFromEvent(event);
      if (refused.status !== 'decoded') return reject('unavailable', `the recorded refusal event is not decodable: ${refused.reason}`);
      decoded = { ...refused.value, value: { kind: 'refused', refusal: refused.value.refusal } };
    } else {
      return reject('unavailable', `the recorded requeue receipt names a ${event.eventType} event`);
    }
    if (decoded.identityKey !== identity || decoded.fingerprint !== fingerprint) {
      return reject('unavailable', 'the recorded requeue disagrees with the request identity');
    }
    if (!sameRef({ kind: decoded.actor.kind, id: decoded.actor.id }, { kind: actor.kind, id: actor.id })) {
      return reject('unavailable', 'the recorded requeue belongs to another actor');
    }
    return { status: 'committed', value: decoded.value, replayed: true, cursor: receipt.cursor,
      // 7A §3.5 rule 5: the receipt of this effect's own commit, present only
      // when the call carried an acknowledgement; a refusal never returns one.
      ...(acknowledgement === null || decoded.value.kind !== 'requeued' ? {}
        : { proofReceipt: { identityKey: identity, fingerprint, cursor: receipt.cursor } }) };
  }

  /** The internal Host-only WG11 read context (the afterRun's claim Session is read through it). */
  function internalReadContext(owned: OwnedCall): CoreCallContext {
    const actor = { ...INTERNAL_READ_ACTOR };
    return { projectId: owned.scope.projectId, workspaceId: owned.scope.workspaceId,
      principal: { kind: 'host', actor }, materialReader: { kind: 'host', projectId: owned.scope.projectId,
        workspaceId: owned.scope.workspaceId, actor }, signal: owned.signal };
  }

  /** ND-9: what the owner read for each requested new input; `newBasisInputProblem` judges. */
  async function newInputProblem(owned: OwnedCall, inputs: readonly NewBasisInputRefV1[]): Promise<Rejection | null> {
    return newBasisInputsProblem({ materials: deps.materials, messages: deps.messages }, owned.ctx, owned.scope, inputs);
  }

  /** TASK-16 guards Workspace@rev: the key's source stamp names this revision's root. */
  async function readWorkspaceGuard(workspaceRef: WorkspaceRef): Promise<{ ok: true; guard: RecordGuard } | Rejected> {
    const key = refKeyOf(workspaceRef);
    const read = await records.readMany([key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) return { ok: false, rejection: reject('incomplete', 'the Goal Workspace record is missing') };
    return { ok: true, guard: { refKey: key, expectedRevision: record.revision } };
  }

  /** Step 9 (LA-5): the whole workspace's digest, without the change scope. */
  async function captureSource(goal: GoalSnapshot): Promise<{ ok: true; stamp: SourceStampV1 } | Rejected> {
    // Both seams report their own failures as a result (the Host root lookup and
    // the one VerificationWorkspaceReader convert every error), so neither call
    // throws and the status checks below report every real failure.
    const resolved = await deps.workspaceHost.resolveRoot(goal.workspaceRef);
    if (resolved.status !== 'ready') return { ok: false, rejection: reject('unavailable', `the workspace source is not readable: ${resolved.reason}`) };
    const captured = await deps.source.captureDigest(resolved.value.root);
    if (captured.status !== 'ready') return { ok: false, rejection: reject('unavailable', `the workspace source is not readable: ${captured.reason}`) };
    return { ok: true, stamp: { workspaceRevision: resolved.value.workspaceRevision, sourceDigest: captured.sourceDigest } };
  }

  /**
   * §3.4 `requeueTask(archiveOrigin)`: the durable request plus the exact
   * anchor (kind `execution`) or the recorded wait disposal and the old Run's
   * cancel intent (kind `wait`). A missing, foreign or unmatched origin is
   * `forbidden` with zero writes; the anchor never authorizes bypassing an
   * unknown Run outcome.
   */
  async function verifyArchiveOrigin(
    input: RequeueTaskInput, afterRun: RunSnapshot, pointerIntent: StopIntentV1 | null,
    scope: { projectId: string; workspaceId: string },
  ): Promise<{ ok: true; value: VerifiedArchiveInterruptionV1 | null } | Rejected> {
    const origin = input.archiveOrigin as ArchiveRequeueOriginV1;
    const originSession = plainOriginSessionRef(origin.archiveSessionRef);
    if (originSession === null) {
      return { ok: false, rejection: reject('invalid', 'the archive origin sessionRef must be a Session reference') };
    }
    if (origin.kind === 'execution') {
      const anchorKey = sessionAnomalyRefKey(origin.anchorRef);
      const read = await records.readMany([anchorKey]);
      if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
      const record = read.value.records.find((candidate) => candidate.refKey === anchorKey);
      if (record === undefined) return { ok: false, rejection: reject('forbidden', 'the archive origin anchor does not exist') };
      const decoded = decodeSessionAnomalyAnchor(record);
      if (decoded.status !== 'decoded') {
        return { ok: false, rejection: reject('unavailable', `the archive origin anchor is damaged: ${decoded.reason}`) };
      }
      const anchor = decoded.value;
      // The anchor's recorded receipt locates the durable archive request; the
      // current Session may already have cleared it (final archive).
      const requestLookup = await records.lookupCommit({ identityKey: anchor.archiveRequestReceipt.identityKey,
        fingerprint: anchor.archiveRequestReceipt.fingerprint });
      if (requestLookup.status !== 'ready') {
        return { ok: false, rejection: requestLookup.code === 'not_found'
          ? reject('forbidden', 'the archive origin names no durable request') : mapStoreFailure(requestLookup) };
      }
      const at = await records.eventAt(requestLookup.value.cursor);
      if (at.status !== 'ready') return { ok: false, rejection: mapStoreFailure(at) };
      const event = sessionArchiveChangedEventFromEvent(at.value.event);
      if (event.status !== 'decoded') {
        return { ok: false, rejection: reject('unavailable', `the durable archive request is not decodable: ${event.reason}`) };
      }
      const request = event.value.session.archiveRequest ?? null;
      const executionMatches = request !== null && (request.execution.kind === 'work'
        ? sameRef(request.execution.runRef, anchor.runRef)
          && request.execution.attemptRef.attemptId === anchor.attemptRef.attemptId
        : request.execution.kind === 'none');
      if (request === null || request.requestId !== origin.archiveRequestId || !executionMatches
        || !sameRef(anchor.sessionRef, originSession)) {
        return { ok: false, rejection: reject('forbidden', 'the archive origin does not match its durable request and anchor') };
      }
      const matched = verifiedArchiveInterruptionOf(input, anchor);
      if (matched === null) {
        return { ok: false, rejection: reject('forbidden', 'the archive origin anchor does not authorize this Run') };
      }
      // §3.4/rule 10: `archive_cancel` exempts a cancelled Run only when the
      // stop was THIS request's derived `s1-archive-control:` cancel intent. A
      // real anchor whose Run another cancel stopped keeps the ordinary class:
      // it hands over no verified interruption (the wait branch does the same).
      if (matched.cause === 'archive_cancel' && afterRun.outcome === 'cancelled'
        && !isArchiveCancelIntent(pointerIntent, request, scope, anchor.runRef)) {
        return { ok: true, value: null };
      }
      return { ok: true, value: matched };
    }

    // kind === 'wait': durable request + the message's recorded cancel disposal + the old Run's cancel intent.
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(originSession));
    const sessionRead = await records.readMany([sessionKey]);
    if (sessionRead.status !== 'ready') return { ok: false, rejection: mapStoreFailure(sessionRead) };
    const sessionRecord = sessionRead.value.records.find((candidate) => candidate.refKey === sessionKey);
    if (sessionRecord === undefined) return { ok: false, rejection: reject('forbidden', 'the archive origin Session does not exist') };
    const sessionDecoded = decodeSessionRecord(sessionRecord);
    if (sessionDecoded.status !== 'decoded') {
      return { ok: false, rejection: reject('unavailable', `the archive origin Session is damaged: ${sessionDecoded.reason}`) };
    }
    const request = sessionDecoded.value.archiveRequest ?? null;
    const waitChoice = request?.wait ?? null;
    // §4.1 step 7: an ordinary cancel request, or a transfer whose following
    // wait_cancel step records the cancel disposition on the message, both
    // authorize this wait-origin requeue.
    if (request === null || request.requestId !== origin.archiveRequestId
      || waitChoice === null
      || !sameRef(waitChoice.runRef, origin.runRef) || !sameRef(waitChoice.messageRef, origin.messageRef)) {
      return { ok: false, rejection: reject('forbidden', 'the archive origin does not match its durable wait request') };
    }
    const messageKey = sessionMessageRefKey(origin.messageRef);
    const messageRead = await records.readMany([messageKey]);
    if (messageRead.status !== 'ready') return { ok: false, rejection: mapStoreFailure(messageRead) };
    const messageRecord = messageRead.value.records.find((candidate) => candidate.refKey === messageKey);
    if (messageRecord === undefined) return { ok: false, rejection: reject('forbidden', 'the archive wait message does not exist') };
    const messageDecoded = decodeSessionMessageRecord(messageRecord);
    if (messageDecoded.status !== 'decoded') {
      return { ok: false, rejection: reject('unavailable', `the archive wait message is damaged: ${messageDecoded.reason}`) };
    }
    const disposition = messageDecoded.value.archiveWaitDisposition ?? null;
    if (disposition === null || disposition.kind !== 'cancel' || !sameRef(disposition.runRef, origin.runRef)
      || disposition.archiveRequestId !== request.requestId
      || !sameRef(disposition.archiveSessionRef, originSession)) {
      return { ok: false, rejection: reject('forbidden', 'the archive wait message carries no matching disposal') };
    }
    // §3.4/rule 10: the exemption needs the wait cancel of THIS request — the
    // exact `s1-archive-control:` intent its step 7 submits for the wait Run.
    // A forged/mismatched Run is still forbidden; a genuine wait whose pointer
    // is another intent keeps the ordinary class (no exemption).
    const matched = verifiedArchiveInterruptionOf(input, null);
    if (matched === null) {
      return { ok: false, rejection: reject('forbidden', 'the archive wait origin does not authorize this Run') };
    }
    if (!isArchiveCancelIntent(pointerIntent, request, scope, waitChoice.runRef)) {
      return { ok: true, value: null };
    }
    return { ok: true, value: matched };
  }

  async function requeueTask(ctx: CoreCallContext, request: GraphWrite<RequeueTaskInput>):
  Promise<EffectWriteResultV1<TaskRequeueOutcomeV1>> {
    const ownedCall = ownCall(ctx);
    if (!ownedCall.ok) return ownedCall.rejection;
    const owned = ownedCall.value;
    const ownedRequest = ownRequest(request);
    if (!ownedRequest.ok) return ownedRequest.rejection;
    const { input, requestId, expected } = ownedRequest.value;
    const shape = inputProblem(input, owned.scope);
    if (shape !== null) return shape;
    const task: TaskTriple = { projectId: input.taskRef.projectId, goalId: input.taskRef.goalId, taskId: input.taskRef.taskId };
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
    const afterRunRef: RunRef = { aggregateType: 'Run', projectId: input.afterRunRef.projectId,
      goalId: input.afterRunRef.goalId, runId: input.afterRunRef.runId };
    const refusalRef: TaskReworkRefusalRef = { aggregateType: 'TaskReworkRefusal', projectId: task.projectId,
      goalId: task.goalId, taskId: task.taskId, operation: 'requeue', subjectId: afterRunRef.runId };
    const pins = expectedPinsOf(expected, goalRef, afterRunRef, refusalRef);
    if (!pins.ok) return pins.rejection;
    if (owned.signal.aborted) return reject('cancelled', 'the requeue was cancelled before lookup');

    // 1-2. The caller and the receipt. An Agent's identity is the formal writer (W2).
    let caller: Caller;
    if (owned.principal.kind === 'host') {
      const host = hostActorOf(owned);
      if (!host.ok) return host.rejection;
      caller = { kind: 'host', actor: host.actor };
    } else {
      if (deps.delegatedWrites === undefined) return reject('forbidden', 'Agent requeues are not admitted by this Host');
      const writer = await identifyDelegatedWriter(deps.delegatedWrites, owned.ctx, owned.scope);
      if (writer.status !== 'ready') {
        return writer.status === 'rejected' ? writer : reject('forbidden', 'the Agent writer identity is not readable');
      }
      caller = { kind: 'agent', writer: writer.value };
    }
    const actor: ActorRef = caller.kind === 'host' ? caller.actor : caller.writer.actor;
    let identity: string;
    let fingerprint: string;
    try {
      identity = identityOf(actor, owned.scope, requestId);
      fingerprint = sha256Hex(canonicalJson({ kind: 'task-requeue', actor, projectId: owned.scope.projectId,
        workspaceId: owned.scope.workspaceId, input, expected: sortedPins(expected) } as unknown as JsonValue));
    } catch { return reject('invalid', 'the requeue request is not canonicalizable JSON'); }
    const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (lookup.status === 'ready') return replay(lookup.value, identity, fingerprint, actor, input.acknowledgement ?? null);
    if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
    if (owned.signal.aborted) return reject('cancelled', 'the requeue was cancelled during lookup');
    const actorClass: ReworkActorClass | null = reworkActorClassOf(owned.principal, actor);
    if (actorClass === null) return reject('forbidden', 'the caller cannot rework this Task');
    let agentProvenance: DelegatedWriteProvenanceV1 | null = null;
    let admissionGuards: readonly RecordGuard[] = [];
    if (caller.kind === 'agent') {
      // TD-6: the same Goal, then the current delegated-write admission (Run entered and running, Session,
      // Lease, the manifest's `requeue_task` grant, Host/Role recheck).
      if (caller.writer.goalRef.goalId !== task.goalId) return reject('forbidden', 'an Agent reworks only Tasks of its own Goal');
      const admitted = await authorizeDelegatedWrite(deps.delegatedWrites as PlanDelegatedWriteDependencies, owned.ctx,
        { writer: caller.writer, operation: 'requeue_task' });
      if (admitted.status !== 'ready') {
        return admitted.status === 'rejected' ? admitted : reject('forbidden', 'the Agent requeue admission is not readable');
      }
      agentProvenance = admitted.value.provenance;
      admissionGuards = admitted.value.guards;
    }

    // 3. The read window and the state preconditions.
    const windowRead = await readRequeueWindow(records, goalRef, task.taskId, afterRunRef);
    if (!windowRead.ok) return windowRead.rejection;
    const window = windowRead.value;
    const goal = window.goal;
    if (goal.workspaceRef.workspaceId !== owned.scope.workspaceId) return reject('forbidden', 'the Goal belongs to another workspace');
    if (owned.signal.aborted) return reject('cancelled', 'the requeue was cancelled during the read');
    const afterRun = window.rework.selectedRun as RunSnapshot;
    // §3.4: with an archive origin the Task machine runs only after the origin
    // is verified (below), because a verified wait-cancel is what makes the
    // ordinary yielded row requeueable. Without one the old early check stays.
    const hasArchiveOrigin = input.archiveOrigin !== undefined && input.archiveOrigin !== null;
    if (!hasArchiveOrigin) {
      const stateProblem = taskRequeueStateProblem(window.state, window.rework);
      if (stateProblem !== null) return stateRefusal(stateProblem, window);
    }
    if (pins.value.goal.revision !== goal.revision) {
      return reject('revision_conflict', 'the Goal changed since the caller read it', [{ ref: goalRef, revision: goal.revision }]);
    }
    if (pins.value.afterRun.revision !== afterRun.revision) {
      return reject('revision_conflict', 'the afterRun changed since the caller read it', [{ ref: afterRun.ref, revision: afterRun.revision }]);
    }
    const currentRefusal = window.facts.requeueRefusalsByRunId.get(afterRun.ref.runId) ?? null;
    if (pins.value.refusal !== null && pins.value.refusal.revision !== (currentRefusal?.revision ?? 0)) {
      return reject('revision_conflict', 'the requeue refusal changed since the caller read it',
        currentRefusal === null ? undefined : [{ ref: refusalRef, revision: currentRefusal.revision }]);
    }
    // The Lease was released by the afterRun (or by one of the afterRun's
    // review rounds) and its claim Session is no longer held by it. The
    // releasing Run's purpose is read in this same window.
    const lease = window.facts.leasesByTaskId.get(task.taskId) ?? null;
    const release = lease?.release;
    const releasing = release === undefined ? undefined
      : (window.facts.runsByTaskId.get(task.taskId) ?? []).find(run => run.ref.runId === release.runRef.runId);
    if (release === undefined || !leaseReleasedForContinuation({
      release: { runRef: release.runRef }, releasingRunPurpose: releasing?.purpose ?? null,
    }, afterRun.ref)) {
      return reject('busy', 'the Task lease is not released by the afterRun');
    }
    // The selected Run's review record gates every requeue. A system or
    // agent requeue is refused while it is unsettled or held; a human requeue is
    // accepted while merely unsettled (its claim still waits), but a held
    // record without an archive origin is refused — release-hold is the only
    // "continue". The record comes from the ONE canonical window above.
    const reviewBlocker = selectedReviewBlockerOf(window.canonical.unknownCallReview);
    if (reviewBlocker === 'unreadable') return reject('unavailable', 'unknown_call_review_unreadable');
    if (reviewBlocker !== undefined && actorClass !== 'human') {
      return reject('busy', reviewBlocker === 'held' ? 'unknown_call_review_held' : 'unknown_call_review_pending');
    }
    if (reviewBlocker === 'held' && !hasArchiveOrigin) {
      return reject('busy', 'unknown_call_review_held: 点“继续”（release-hold）接着做');
    }
    const execution = await deps.reads.readExecution(internalReadContext(owned), afterRun.ref);
    if (execution.status !== 'ready') {
      return execution.status === 'rejected' ? reject(execution.code, execution.reason)
        : reject('incomplete', 'the afterRun claim facts are not readable');
    }
    const claimSession = execution.value.session;
    const occupancy = claimSession.occupancy;
    if (occupancy !== null && occupancy.kind === 'execution' && sameRef(occupancy.executionRef, afterRun.ref)) {
      return reject('busy', 'the afterRun still occupies its claim Session');
    }
    const workspace = await readWorkspaceGuard(goal.workspaceRef);
    if (!workspace.ok) return workspace.rejection;
    const pointers = await readPointerIntents(records, [afterRun]);
    if (pointers.status !== 'ready') return reject(pointers.code, pointers.reason);
    const pointerIntent = pointers.intents.get(afterRun.ref.runId) ?? null;

    // 4-5. The Goal, the class and the actor × class matrix with the fence; then the new inputs.
    // §3.4: an archive origin is verified against its durable request and its
    // anchor (or the recorded wait disposal and old Run cancel intent) BEFORE
    // the class is derived; a forged/unmatched origin is forbidden with zero writes.
    let archive: VerifiedArchiveInterruptionV1 | null = null;
    if (input.archiveOrigin !== undefined && input.archiveOrigin !== null) {
      const verifiedArchive = await verifyArchiveOrigin(input, afterRun, pointerIntent, owned.scope);
      if (!verifiedArchive.ok) return verifiedArchive.rejection;
      archive = verifiedArchive.value;
      window.rework.archive = archive;
    }
    if (hasArchiveOrigin) {
      const stateProblem = taskRequeueStateProblem(window.state, window.rework);
      if (stateProblem !== null) return stateRefusal(stateProblem, window);
    }
    const derivation = deriveReworkClass(afterRun, pointerIntent, window.rework.chain, archive);
    if (derivation.kind !== 'class') return reject('invalid', `the selected Run has nothing to rework (${derivation.row})`);
    const goalFanOut = actor.kind === GOAL_FAN_OUT_ACTOR.kind && actor.id === GOAL_FAN_OUT_ACTOR.id;
    const permission = refusalOf(reworkPermission({ operation: 'requeue', goalDesiredState: goal.desiredState,
      failureClass: derivation.failureClass, interruption: permissionInterruptionOf(derivation),
      fence: reworkFenceOf(afterRun, pointerIntent), actorClass, goalFanOut,
      trigger: input.trigger !== undefined, budget: input.budget !== undefined, note: input.note !== undefined }));
    if (permission !== null) return permission;
    // TASK-27 / GOAL-29 (A.2 step 5.6), after the actor × class matrix (which refuses a trigger from any actor but
    // the Goal fan-out, §4.4): a goal_resume trigger names this Goal's current resume epoch and the earlier
    // fan-out pause that the afterRun's pointer still is. A moved Goal revision is already refused above.
    if (input.trigger !== undefined) {
      const trigger = input.trigger;
      if (!sameRef(trigger.goalRef, goalRef)) return reject('invalid', 'the goal_resume trigger names another Goal');
      if (trigger.pausedEpoch < 1 || trigger.pausedEpoch >= trigger.resumedEpoch) {
        return reject('invalid', 'the goal_resume trigger pause epoch must precede its resume epoch');
      }
      const fanOutPause = controlIntentRefFor(GOAL_FAN_OUT_ACTOR, owned.scope,
        goalFanOutRequestId(goalRef, trigger.pausedEpoch, afterRun.ref, 'pause'));
      if (pointerIntent === null || !sameRef(pointerIntent.ref, fanOutPause)
        || pointerIntent.requestedBy.kind !== GOAL_FAN_OUT_ACTOR.kind || pointerIntent.requestedBy.id !== GOAL_FAN_OUT_ACTOR.id) {
        return reject('invalid', 'the afterRun was not paused by this Goal\'s fan-out at the trigger\'s pause epoch');
      }
    }
    const requestedInputs = input.newInputRefs ?? [];
    const inputProblemFound = await newInputProblem(owned, requestedInputs);
    if (inputProblemFound !== null) return inputProblemFound;
    if (owned.signal.aborted) return reject('cancelled', 'the requeue was cancelled after the input checks');

    // 6-8. Budget, cap, then the Goal-wide ended-Run count (before any capture).
    const budget: TaskBudgetV1 | null = input.budget ?? null;
    const policy = policyOf();
    const runs = window.facts.runsByTaskId.get(task.taskId) ?? [];
    const requeues = window.facts.requeuesByTaskId.get(task.taskId) ?? [];
    const interrupted = derivation.failureClass === 'interrupted';
    const automation = nextRequeueAutoCount({ actorClass, failureClass: derivation.failureClass, afterRun, runs, requeues, policy });
    let policyCode: Extract<TaskReworkRefusalCode, 'budget_not_increased' | 'auto_rework_cap_reached'> | null = null;
    if (!interrupted && !requeueBudgetIncreased(afterRun, budget, requestedInputs.length + (input.note === undefined ? 0 : 1))) {
      policyCode = 'budget_not_increased';
    } else if (automation.counted && automation.cap !== null && automation.autoCount > automation.cap) {
      policyCode = 'auto_rework_cap_reached';
    }
    // Slice 5 §3.2/S5-AU-03: an automatic (agent/system) requeue consults the
    // current Goal autonomy; `needs_decision` refuses with `forbidden` and
    // writes nothing. A person's explicit requeue keeps its existing rights, and
    // the existing budget/cap fences stay first. The injected settings owner is
    // read when present; otherwise the Goal already read (and guarded) here is
    // the current settings source.
    // An applied review-card disposition (rerun_as_is/skip_as_done, an
    // approved safer method, or a released "I'll handle it") IS the person's
    // confirmation of this ONE system requeue, so every_step does not ask again.
    // GOAL-29's goal_resume continuation is the person's resume, not an orchestration choice
    // (`STATE-MACHINES-SPEC.md:398`, `:400`), so a trigger validated above is not asked again.
    const requeueConfirmedByCard = actorClass === 'system'
      && requeueConfirmedByCardOf(window, task.taskId, afterRun.ref.runId);
    if (policyCode === null && actorClass !== 'human' && !requeueConfirmedByCard
      && input.trigger === undefined) {
      let autonomy = goalSettingsOf(goal).autonomy;
      if (deps.goalSettings !== undefined) {
        const settingsRead = await deps.goalSettings.readGoalSettings(owned.ctx, { goalRef });
        if (settingsRead.status !== 'ready') {
          return settingsRead.status === 'rejected'
            ? reject(settingsRead.code, settingsRead.reason)
            : reject('unavailable', 'the Goal settings are unavailable');
        }
        autonomy = settingsRead.value.settings.autonomy;
      }
      const verdict = decisionActionPolicy({
        autonomy,
        action: actorClass === 'agent' ? 'agent_requeue' : 'system_requeue',
        actorClass,
        countedNext: automation.counted ? automation.autoCount : null,
        cap: automation.cap ?? Number.MAX_SAFE_INTEGER,
      });
      if (verdict === 'needs_decision' || verdict === 'user_only') {
        return reject('forbidden', 'the Goal autonomy requires a user decision before an automatic requeue');
      }
    }
    const ended = await readGoalRunsForCount(records, goalRef);
    if (ended.status !== 'ready') return reject(ended.code, ended.reason);
    const goalEndedRunsAtRefusal = countEndedGoalRuns(ended.runs);
    const head = window.rework.chain.kind === 'head' ? window.rework.chain.head : null;
    // VR-09 on the chain head, for the requeue and for a refusal alike (TASK-28 reuses the TASK-16 read
    // set): the head is guarded as read and its successor slot claimed by the same owner, because a
    // successor round (§9 VR-14) never rewrites its predecessor.
    const roundGuards: RecordGuard[] = [];
    const roundClaims: UniqueClaimChange[] = [];
    if (head !== null) {
      // The requeue is not the round's executor and pins no round revision.
      const covered = transitionRound(head, { kind: 'task_requeued', actorClass },
        { callerIsExecutor: false, expectedRevision: null, instanceLeaseHeld: false });
      if (!covered.ok) return reject(covered.code, covered.detail);
      for (const effect of covered.effects) {
        if (effect.kind === 'guard_round_unchanged') roundGuards.push({ refKey: refKeyOf(head.ref), expectedRevision: effect.revision });
        else if (effect.kind === 'claim_round_slot') roundClaims.push({ ...effect.claim });
        else throw new Error(`task_requeued has no ${effect.kind} effect on the chain head`);
      }
      // §13.2 point 5 (§9 VR-14): a reverify refusal of this head holds its slot with the same owner, so the
      // requeue guards the head's reverify refusal record as the window read it (absent: null) and a concurrent
      // refusal and requeue commit at most once; a refusal committed before the read does not stop the requeue.
      if (isFinalizedNonPass(head)) {
        roundGuards.push({ refKey: taskReworkRefusalRefKey({ aggregateType: 'TaskReworkRefusal', projectId: task.projectId,
          goalId: task.goalId, taskId: task.taskId, operation: 'reverify', subjectId: head.ref.roundId }),
        expectedRevision: window.facts.reverifyRefusalsByRoundId.get(head.ref.roundId)?.revision ?? null });
      }
    }
    const refusalBase = { current: currentRefusal, ref: refusalRef, task, afterRunRef: afterRun.ref,
      subjectRoundRef: head === null ? null : head.ref, failureClass: derivation.failureClass,
      requestedBy: actor, goalEndedRunsAtRefusal, configurationRevision: null };
    const commitBase: CommitBase = { owned, identity, fingerprint, actor, goalRef, window, afterRun, admissionGuards,
      pointerIntent, roundGuards, roundClaims, workspaceGuard: workspace.guard,
      sessionGuard: { refKey: sessionAggregateRefKey(claimSession.ref), expectedRevision: claimSession.revision },
      acknowledgement: input.acknowledgement ?? null };
    if (policyCode !== null) {
      return commitRefusal(commitBase, { ...refusalBase, code: policyCode, basisDigest: null, source: null,
        matchedRequeueRef: null, reason: policyCode === 'budget_not_increased'
          ? `budget not increased: Run ${afterRun.ref.runId} exhausted its token budget ${afterRun.budget.tokenBudget}; `
            + 'give a larger budget or a new input'
          : `auto rework cap reached: automatic requeue ${automation.autoCount} exceeds the cap ${String(automation.cap)}` });
    }

    // 9. The source digest; a human note is stored after it and joins the new inputs.
    const captured = await captureSource(goal);
    if (!captured.ok) return captured.rejection;
    if (owned.signal.aborted) return reject('cancelled', 'the requeue was cancelled during the source capture');
    const newInputRefs: NewBasisInputRefV1[] = [...requestedInputs];
    if (input.note !== undefined) {
      if (owned.principal.kind !== 'host') return reject('invalid', 'only an operator may attach a note');
      const stored = await deps.materials.storeArtifact(owned.ctx, { contentType: REWORK_NOTE_CONTENT_TYPE, body: input.note,
        sources: [{ kind: 'workspace', refId: owned.scope.workspaceId, revision: String(captured.stamp.workspaceRevision) }],
        origin: { kind: 'platform_operation', projectId: owned.scope.projectId, workspaceId: owned.scope.workspaceId,
          requestId, actor: caller.kind === 'host' ? caller.actor : INTERNAL_READ_ACTOR } });
      if (stored.status !== 'stored') {
        return reject(stored.code === 'size_exceeded' ? 'capacity' : stored.code === 'missing_source' ? 'invalid' : stored.code,
          `the note could not be stored: ${stored.reason}`);
      }
      if (newInputRefs.length >= MAX_NEW_BASIS_INPUT_REFS) {
        return reject('invalid', `a requeue carries at most ${MAX_NEW_BASIS_INPUT_REFS} new inputs including its note`);
      }
      newInputRefs.push({ kind: 'artifact', ref: stored.ref });
    }

    // 11. The §13.1 key against every earlier TaskRequeue of the Task (ND-3), unless the class skips it.
    const key = noProgressKey({ taskRef: task, afterRun, head, source: captured.stamp,
      basisPlan: buildEffectiveTaskBasis(window.plan).get(task.taskId), newInputRefs });
    if (!key.ok) return reject(key.code, key.detail);
    const basis = key.next;
    if (requeueBasisCompared(derivation.failureClass, actorClass)) {
      const matched = requeues.find((requeue) => requeue.basis.digest === basis.digest) ?? null;
      if (matched !== null) {
        return commitRefusal(commitBase, { ...refusalBase, code: 'no_new_basis', basisDigest: basis.digest,
          source: captured.stamp, matchedRequeueRef: matched.ref,
          reason: `no new basis: same failure, source, plan as TaskRequeue ${matched.ref.afterRunId}; `
            + 'supply new input or change the method' });
      }
    }

    // 12. TaskRequeue@1 (TASK-16/17) and VR-09 on the chain head, in one commit. The record derives
    // its class, stop fact, count and history source itself (§14.1).
    const trigger: TaskRequeueTriggerV1 | null = input.trigger ?? null;
    const requeued = transitionTask(window.state, { kind: 'task_requeued', requeue: {
      task, planRef: window.plan.ref, afterRun, pointerIntent, chain: window.rework.chain, requestedBy: actor,
      requestedAt: deps.now(), reason: input.reason, basis, newInputRefs, budget, trigger, agentProvenance,
      runs, requeues, policy, archiveOrigin: input.archiveOrigin ?? null, archive,
    } }, { taskId: task.taskId, claim: null, completion: null, disposition: null, rework: window.rework });
    if (!requeued.ok) return reject(requeued.code, requeued.detail);
    const [written, ...others] = requeued.effects;
    if (written?.kind !== 'write_task_requeue' || others.length > 0) throw new Error('task_requeued writes exactly the TaskRequeue');
    const requeue = written.requeue;
    const event: TaskRequeuedEvent = { eventId: deps.eventId(), eventType: TASK_REQUEUED_EVENT_TYPE,
      schemaVersion: TASK_REWORK_EVENT_SCHEMA_VERSION, occurredAt: requeue.requestedAt, identityKey: identity, actor,
      fingerprint, requeue,
      // 7A §3.5 rule 3: the effect event carries the key only when the input did.
      ...(input.acknowledgement === undefined ? {} : { acknowledgement: input.acknowledgement }) };
    return commit(commitBase, {
      records: [encodeTaskRequeueSnapshot(requeue, { since: null })],
      extraGuards: [{ refKey: taskRequeueRefKey(requeue.ref), expectedRevision: null }],
      event: encodeTaskRequeuedEvent(event),
      value: { kind: 'requeued', requeue },
      // Slice 5 §2.5: the Store binds this creation commit cursor to the wire
      // `since`; a later update never rebinds it.
      commitCursorBindings: [{ refKey: taskRequeueRefKey(requeue.ref), field: 'since' }],
    });
  }

  /**
   * E5 (§2.3 S:622, L-d): a no-write read that restores the existing
   * `TaskRequeue` of `(Task, afterRun)` with the cursor of its original
   * `TaskRequeued` event. It recomputes the request identity exactly as
   * `requeueTask` does and uses `lookupCommit`/`eventAt`; a missing or
   * mismatched identity is `not_found`/the store failure, never a new write.
   */
  async function readTaskRequeue(ctx: CoreCallContext, request: GraphWrite<RequeueTaskInput>): Promise<ReadResult<TaskRequeueReadV1>> {
    const ownedCall = ownCall(ctx);
    if (!ownedCall.ok) return ownedCall.rejection;
    const owned = ownedCall.value;
    const ownedRequest = ownRequest(request);
    if (!ownedRequest.ok) return ownedRequest.rejection;
    const { input, requestId, expected } = ownedRequest.value;
    const shape = inputProblem(input, owned.scope);
    if (shape !== null) return shape;
    const task: TaskTriple = { projectId: input.taskRef.projectId, goalId: input.taskRef.goalId, taskId: input.taskRef.taskId };
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
    const afterRunRef: RunRef = { aggregateType: 'Run', projectId: input.afterRunRef.projectId,
      goalId: input.afterRunRef.goalId, runId: input.afterRunRef.runId };
    const refusalRef: TaskReworkRefusalRef = { aggregateType: 'TaskReworkRefusal', projectId: task.projectId,
      goalId: task.goalId, taskId: task.taskId, operation: 'requeue', subjectId: afterRunRef.runId };
    const pins = expectedPinsOf(expected, goalRef, afterRunRef, refusalRef);
    if (!pins.ok) return pins.rejection;
    // The archive requeue is written by the Host; an Agent identity is not a
    // supported reader of an automation receipt (the same rule as the write).
    if (owned.principal.kind !== 'host') return reject('forbidden', 'only a Host can read a committed requeue receipt');
    const host = hostActorOf(owned);
    if (!host.ok) return host.rejection;
    const actor = host.actor;
    let identity: string;
    let fingerprint: string;
    try {
      identity = identityOf(actor, owned.scope, requestId);
      fingerprint = sha256Hex(canonicalJson({ kind: 'task-requeue', actor, projectId: owned.scope.projectId,
        workspaceId: owned.scope.workspaceId, input, expected: sortedPins(expected) } as unknown as JsonValue));
    } catch { return reject('invalid', 'the requeue request is not canonicalizable JSON'); }
    const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (lookup.status !== 'ready') {
      if (lookup.code === 'not_found') return { status: 'not_found' };
      return mapStoreFailure(lookup);
    }
    const loaded = await loadReplayEvent(records, lookup.value);
    if (!loaded.ok) return loaded.rejection;
    if (loaded.event.eventType !== TASK_REQUEUED_EVENT_TYPE) {
      return reject('unavailable', `the committed requeue identity names a ${loaded.event.eventType} event`);
    }
    const decoded = taskRequeuedEventFromEvent(loaded.event);
    if (decoded.status !== 'decoded') return reject('unavailable', `the recorded requeue event is not decodable: ${decoded.reason}`);
    const requeue = decoded.value.requeue;
    if (requeue.task.projectId !== task.projectId || requeue.task.goalId !== task.goalId
      || requeue.task.taskId !== task.taskId || requeue.ref.afterRunId !== afterRunRef.runId) {
      return reject('unavailable', 'the recorded requeue does not cover the requested Task and afterRun');
    }
    return { status: 'ready', value: { requeue, cursor: lookup.value.cursor } };
  }

  /**
   * Ruling 4: the no-write read of the derived
   * release-hold requeue. A `TaskRequeue(task, R)` is immutable and its `since`
   * commit cursor names the one `TaskRequeued` event; that event's
   * `identityKey` is compared with `identityOf(actor, scope, requestId)` — the
   * same identity the write used, with no fingerprint and no fresh pins. A hit
   * answers `{requeue, cursor: since}`; a missing record, another identity,
   * another Task/afterRun, an undecodable record/event or a mismatched cursor
   * is `not_found`; only a store read failure is that failure. Never writes.
   */
  async function readTaskRequeueByIdentity(
    ctx: CoreCallContext, input: ReadTaskRequeueByIdentityInputV1,
  ): Promise<ReadResult<TaskRequeueReadV1>> {
    const ownedCall = ownCall(ctx);
    if (!ownedCall.ok) return ownedCall.rejection;
    const owned = ownedCall.value;
    if (owned.principal.kind !== 'host') return reject('forbidden', 'only a Host can read a committed requeue receipt');
    const host = hostActorOf(owned);
    if (!host.ok) return host.rejection;
    const task = input.taskRef;
    const afterRunRef = input.afterRunRef;
    if (!nonEmpty(task.projectId) || !nonEmpty(task.goalId) || !nonEmpty(task.taskId)
      || !nonEmpty(afterRunRef.projectId) || !nonEmpty(afterRunRef.goalId) || !nonEmpty(afterRunRef.runId)
      || !nonEmpty(input.requestId)) {
      return reject('invalid', 'the requeue replay read requires the Task, afterRun and requestId');
    }
    const key = taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: task.projectId, goalId: task.goalId,
      taskId: task.taskId, afterRunId: afterRunRef.runId });
    const recordRead = await records.readMany([key]);
    if (recordRead.status !== 'ready') return mapStoreFailure(recordRead);
    const record = recordRead.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) return { status: 'not_found' };
    let since: unknown;
    try {
      since = (JSON.parse(record.json) as Record<string, unknown>)['since'];
    } catch {
      return { status: 'not_found' };
    }
    if (!nonEmpty(since)) return { status: 'not_found' };
    // The record's own Store-bound `since` field; a damaged value is absence, not a read.
    const sinceCursor = since as CommitCursor;
    const at = await records.eventAt(sinceCursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (!sameCursor(at.value.cursor, sinceCursor)) return { status: 'not_found' };
    const decoded = taskRequeuedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') return { status: 'not_found' };
    const requeue = decoded.value.requeue;
    if (requeue.task.projectId !== task.projectId || requeue.task.goalId !== task.goalId
      || requeue.task.taskId !== task.taskId || requeue.ref.afterRunId !== afterRunRef.runId) {
      return { status: 'not_found' };
    }
    let identity: string;
    try {
      identity = identityOf(host.actor, owned.scope, input.requestId);
    } catch {
      return reject('invalid', 'the requeue replay request is not canonicalizable JSON');
    }
    if (decoded.value.identityKey !== identity) return { status: 'not_found' };
    return { status: 'ready', value: { requeue, cursor: sinceCursor } };
  }

  type CommitBase = {
    owned: OwnedCall; identity: string; fingerprint: string; actor: ActorRef; goalRef: GoalRef; window: RequeueWindow;
    afterRun: RunSnapshot; admissionGuards: readonly RecordGuard[];
    /** The afterRun's pointer intent, read after the window (TASK-28 re-judges the fence with it). */
    pointerIntent: StopIntentV1 | null;
    /** VR-09: the chain head as read and its same-owner successor slot claim; the head's reverify refusal as read. */
    roundGuards: readonly RecordGuard[];
    roundClaims: readonly UniqueClaimChange[];
    /** The Goal's Workspace as read (TASK-16 guards Workspace@rev). */
    workspaceGuard: RecordGuard;
    /** The afterRun's claim Session as read (TASK-16 guards it). */
    sessionGuard: RecordGuard;
    /** 7A §3.5: the acknowledged message, null when the call carried none (a refusal returns no proof). */
    acknowledgement: SessionMessageRef | null;
  };

  /** TASK-28 (ND-8): the policy refusal @k+1 through the machine, committed with the same read set. */
  async function commitRefusal(
    base: CommitBase,
    input: Omit<Parameters<typeof taskReworkRefusalEffects>[0], 'refusedAt'>,
  ): Promise<EffectWriteResultV1<TaskRequeueOutcomeV1>> {
    const refusedAt = deps.now();
    const [written] = taskReworkRefusalEffects({ ...input, refusedAt });
    if (written?.kind !== 'write_task_rework_refusal') throw new Error('a policy refusal writes its TaskReworkRefusal');
    const refusal: TaskReworkRefusalSnapshotV1 = written.refusal;
    const refused = transitionTask(base.window.state, { kind: 'task_rework_refused', refusal, pointerIntent: base.pointerIntent },
      { taskId: refusal.task.taskId, claim: null, completion: null, disposition: null, rework: base.window.rework });
    if (!refused.ok) return reject(refused.code, refused.detail);
    const event: TaskReworkRefusedEvent = { eventId: deps.eventId(), eventType: TASK_REWORK_REFUSED_EVENT_TYPE,
      schemaVersion: TASK_REWORK_EVENT_SCHEMA_VERSION, occurredAt: refusedAt, identityKey: base.identity, actor: base.actor,
      fingerprint: base.fingerprint, refusal };
    return commit(base, {
      records: [encodeTaskReworkRefusalSnapshot(refusal)],
      extraGuards: [{ refKey: taskReworkRefusalRefKey(refusal.ref), expectedRevision: written.expectedRevision }],
      event: encodeTaskReworkRefusedEvent(event),
      value: { kind: 'refused', refusal },
    });
  }

  /**
   * The one commit of a requeue or a refusal (TASK-16, and TASK-28 with the
   * same read set): the Goal@rev, the active Plan@1, the directed task facts
   * (every Run, Lease, Reduction) and the rework records read (TaskRequeue@1,
   * refusal@k, and the absent keys at null), VR-09's chain-head guard and
   * same-owner slot claim, the head's reverify refusal as read (§13.2
   * point 5), the afterRun's claim Session@rev, the
   * Workspace@rev, the Agent admission guards, plus the written record's own
   * CAS. A losing concurrent requeue or refusal is the store's
   * `revision_conflict`, whose `current` names the record that won.
   */
  async function commit(base: CommitBase, write: {
    records: PreparedCommit['records']; extraGuards: readonly RecordGuard[];
    event: PreparedCommit['events'][number]; value: TaskRequeueOutcomeV1;
    /** Slice 5 §2.5: the wire origin bindings of the records this commit creates. */
    commitCursorBindings?: PreparedCommit['commitCursorBindings'];
  }): Promise<EffectWriteResultV1<TaskRequeueOutcomeV1>> {
    const { window } = base;
    const writtenKeys = new Set(write.extraGuards.map((guard) => guard.refKey));
    const merged = mergeGuards([
      { refKey: refKeyOf(base.goalRef), expectedRevision: window.goal.revision },
      { refKey: planRevisionRefKey(window.plan.ref), expectedRevision: window.plan.revision },
      ...window.facts.guards,
      ...window.facts.reworkGuards.filter((guard) => !writtenKeys.has(guard.refKey)),
      ...base.roundGuards,
      base.sessionGuard,
      base.workspaceGuard,
      ...base.admissionGuards.filter((guard) => guard.refKey !== base.sessionGuard.refKey),
      ...write.extraGuards,
    ]);
    if (!merged.ok) return merged.rejection;
    const prepared: PreparedCommit = { identityKey: base.identity, fingerprint: base.fingerprint, guards: merged.guards,
      records: write.records, claims: base.roundClaims.map((claim) => ({ ...claim })), indexGuards: [], indexChanges: [],
      events: [write.event],
      ...(write.commitCursorBindings === undefined ? {} : { commitCursorBindings: write.commitCursorBindings }) };
    if (base.owned.signal.aborted) return reject('cancelled', 'the requeue was cancelled before commit');
    const receipt = await records.commit(prepared);
    if (receipt.status !== 'committed') {
      // A concurrent successor round moved the head slot (VR-09): the same answer as a stale read.
      if (receipt.code === 'unique_conflict') {
        return reject('revision_conflict', `${receipt.reason} (a successor round of the chain head committed first)`);
      }
      return mapStoreFailure(receipt);
    }
    if (receipt.replayed) return replay(receipt, base.identity, base.fingerprint, base.actor, base.acknowledgement);
    return { status: 'committed', value: write.value, replayed: false, cursor: receipt.cursor,
      // 7A §3.5 rule 5: the receipt of this effect's own commit, present only
      // when the call carried an acknowledgement; a refusal never returns one.
      ...(base.acknowledgement === null || write.value.kind !== 'requeued' ? {}
        : { proofReceipt: { identityKey: base.identity, fingerprint: base.fingerprint, cursor: receipt.cursor } }) };
  }

  return { requeueTask, readTaskRequeue, readTaskRequeueByIdentity };
}
