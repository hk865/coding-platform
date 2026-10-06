/**
 * R3e.3 formal Task/Goal completion admission (implementation).
 *
 * `completeTaskFromHost` / `completeGoalFromHost` are the trusted Host entries
 * over the ONE `backend.records` instance passed in by `createGoalService`. Each
 * one:
 *   1. binds the real Host actor/scope and isolates the request;
 *   2. restores the ORIGINAL receipt (identity/fingerprint lookup) BEFORE any
 *      current-state read, so a replay returns the original value/cursor;
 *   3. reads only the exact Goal/Plan/round/Evidence/index/facts/policy the
 *      completion actually consumes;
 *   4. folds the ONE effective-evidence set and calls the pure completion policy,
 *      which answers the facts the machines judge;
 *   5. asks the state machine (§4 TASK-14/15/24 `transitionTask`, §2 GOAL-07/08
 *      `transitionGoal`), whose record constructors build the TaskReduction /
 *      GoalPhase (§14.1);
 *   6. commits the formal reduction/phase + one replay event + receipt ONCE with
 *      the local guards covering the whole read set.
 * The machines' guards also run after each read through their exported
 * problem functions, so a refusal stops the reads where it always stopped.
 *
 * It is not a second RecordStore, manager or evidence fold: applicability and
 * coverage come from `evidence/coverage.ts`, the decoders come from
 * `evidence/evidence-record-codecs.ts`, and the reduced Task/Goal truth comes
 * from `completion-policy.ts`.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type {
  EffectivityAnchorV1, EvidenceBindingV1, EvidenceRef, EvidenceSnapshot, TaskEvidenceIndexSnapshot,
} from '../../../contracts/evidence.js';
import type { GoalPhaseRef, GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../../contracts/plan.js';
import type { TaskReductionRef, TaskReductionSnapshot } from '../../../contracts/reduction.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import { reworkActorClassOf } from '../../../contracts/task-requeue.js';
import type { VerificationRoundRef, RoundSnapshot } from '../../../contracts/verification.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  DecodeResult, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { goalCompletionProblem, goalStateOf, transitionGoal, type GoalGuardContext } from '../state/goal-machine.js';
import {
  taskCompletionFoldProblem, taskCompletionProjectionProblem, taskCompletionRoundProblem, taskMachineStateOf, transitionTask,
  type TaskPhaseFacts,
} from '../state/task-machine.js';
import { evidenceSupersededByRequeue } from '../state/verification-machine.js';
import {
  readBatch, readCanonicalTaskFacts, readGoal, readGoalPhase, readPinnedCompletionPolicy, readPlan,
  type CanonicalTaskFacts, type CanonicalTaskState, type Rejected,
} from './plan-readers.js';
import { decodePlanRevisionSnapshot, planRevisionRefKey } from './plan-record-codecs.js';
import {
  decodeEvidenceSnapshot, decodeTaskEvidenceIndexSnapshot, decodeVerificationRoundSnapshot,
} from '../evidence/evidence-record-codecs.js';
import { evidenceApplicabilityWithBasis, evidenceBindingFor, selectEffectiveEvidenceSet } from '../evidence/coverage.js';
import {
  bindTrustedContext, isolateWrite, isRecord, loadReplayEvent, mapStoreFailure, mergeGuards, nonEmpty, sameRef,
} from './execution-entry-service.js';
import { decodeRun } from './run-state-service.js';
import { evaluateGoalCompletion, evaluateTaskCompletion } from './completion-policy.js';
import {
  GOAL_COMPLETED_EVENT_TYPE, TASK_COMPLETED_EVENT_TYPE, completionEventFromEvent, encodeCompletionEvent,
  encodeGoalPhaseSnapshot, encodeTaskReductionSnapshot,
  type CompletionEvent, type GoalCompletedEvent, type TaskCompletedEvent,
} from './completion-record-codecs.js';
import type { GoalTaskPort } from './contracts.js';

type Records = GoalRecordTransactionPort & RecordLookupPort;
type HostActor = { kind: 'human' | 'system'; id: string };

/** The internal, narrowed dependency set of the completion pipeline. */
export type CompletionDependencies = {
  records: Records;
  now(): string;
  eventId(): string;
};

const TASK_IDENTITY_PREFIX = 'r3e-complete-task:';
const GOAL_IDENTITY_PREFIX = 'r3e-complete-goal:';

// -------------------------------------------------------------------------- //
// Small pure helpers                                                          //
// -------------------------------------------------------------------------- //

function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function notFound(reason: string): CoreRejection { return reject('not_found', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function cancelled(reason: string): CoreRejection { return reject('cancelled', reason); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function mapRejected(rejection: Rejected): CoreRejection {
  return reject(rejection.code, rejection.reason);
}
function refKeyOf(value: unknown): string | null {
  try { return canonicalJson(value as JsonValue); } catch { return null; }
}
function fingerprintOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }
function identityKeyOf(prefix: string, actor: HostActor, projectId: string, workspaceId: string, requestId: string): string {
  return prefix + sha256Hex(canonicalJson({ actor: { kind: actor.kind, id: actor.id }, projectId, workspaceId, requestId } as unknown as JsonValue));
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function planRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'PlanRevision' || !nonEmpty(value['projectId']) || !nonEmpty(value['planId'])) {
    return 'the plan ref must be a complete PlanRevisionRef';
  }
  return null;
}
function taskTripleProblem(value: unknown): string | null {
  if (!isRecord(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
    return 'the task ref must be a complete TaskTriple';
  }
  return null;
}
function roundRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'VerificationRound' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])
    || !nonEmpty(value['runId']) || !nonEmpty(value['roundId'])) {
    return 'the round ref must be a complete VerificationRoundRef';
  }
  return null;
}

/**
 * The projection inputs (§4.1) of the completed Task from its directed
 * canonical read (`plan-readers.ts` `readCanonicalTaskFacts`): the selected
 * Run, the applicable Reduction, the selected Run's round-chain signal, and an
 * unresolvable origin, which that read shows only as a `blocked` Task with
 * neither Run nor Reduction, and the TaskRequeue covering the selected Run
 * (P4). The same read always returns the Run or Reduction it selected; keep this in step
 * with `claimPhaseFacts` (`claim-service.ts`), which answers null for a missing
 * one.
 */
function completionPhaseFacts(task: RuntimeTask, state: CanonicalTaskState, read: CanonicalTaskFacts): TaskPhaseFacts {
  const execution = state.execution;
  const selectedRun = execution === null ? null
    : (read.runsByTaskId.get(task.taskId) ?? []).find(run => sameRef(run.ref, execution)) ?? null;
  const applicableReduction = state.reductionRevision === null ? null : read.reductionsByTaskId.get(task.taskId) ?? null;
  return {
    taskKind: task.taskKind,
    applicableReduction,
    selectedRun,
    originUnresolvable: selectedRun === null && applicableReduction === null && state.effectivePhase === 'blocked',
    round: read.roundsByTaskId.get(task.taskId) ?? { kind: 'none' },
    coveringRequeue: state.requeueRef,
  };
}

/** TASK-14 (C5): the head the projection read for the selected Run's chain; null without a valid chain. */
function chainHeadOf(signal: TaskPhaseFacts['round']): VerificationRoundRef | null {
  return signal.kind === 'none' || signal.kind === 'invalid' ? null : signal.head.ref;
}

// -------------------------------------------------------------------------- //
// Receipt lookup / replay                                                     //
// -------------------------------------------------------------------------- //

type LookupOutcome =
  | { status: 'found'; receipt: Extract<StoreCommitReceipt, { status: 'committed' }> }
  | { status: 'absent' }
  | { status: 'failed'; rejection: CoreRejection };

async function lookupReceipt(records: Records, identity: string, fingerprint: string): Promise<LookupOutcome> {
  try {
    const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (lookup.status === 'ready') return { status: 'found', receipt: lookup.value };
    if (lookup.code === 'not_found') return { status: 'absent' };
    return { status: 'failed', rejection: mapStoreFailure(lookup) };
  } catch (error) {
    return { status: 'failed', rejection: unavailable(`the original receipt could not be read: ${messageOf(error)}`) };
  }
}

async function replayEvent(
  records: Records, receipt: Extract<StoreCommitReceipt, { status: 'committed' }>, identity: string, fingerprint: string,
): Promise<{ status: 'committed'; value: CompletionEvent['result']; replayed: true; cursor: CommitCursor } | CoreRejection> {
  const loaded = await loadReplayEvent(records, receipt);
  if (!loaded.ok) return loaded.rejection;
  const decoded = completionEventFromEvent(loaded.event);
  if (decoded.status !== 'decoded') return unavailable(`the recorded completion event is not decodable: ${decoded.reason}`);
  const event = decoded.value;
  if (event.identityKey !== identity || event.fingerprint !== fingerprint) {
    return unavailable('the recorded completion event disagrees with the request identity');
  }
  return { status: 'committed', value: event.result, replayed: true, cursor: receipt.cursor };
}

async function commitOrRecover(
  records: Records, prepared: PreparedCommit, identity: string, fingerprint: string, cause: unknown,
): Promise<{ status: 'committed'; value: CompletionEvent['result']; replayed: true; cursor: CommitCursor } | CoreRejection> {
  const outcome = await lookupReceipt(records, identity, fingerprint);
  if (outcome.status === 'found') return await replayEvent(records, outcome.receipt, identity, fingerprint);
  if (outcome.status === 'failed') return outcome.rejection;
  return unavailable(`the completion commit result is unknown: ${messageOf(cause)}`);
}

// -------------------------------------------------------------------------- //
// Exact single-record read                                                    //
// -------------------------------------------------------------------------- //

type Loaded<T> = { ok: true; value: T; readThrough: CommitCursor | null } | { ok: false; rejection: CoreRejection };

async function readRecord<T>(
  records: Records, key: string, decode: (record: EncodedRecord) => DecodeResult<T>, what: string,
): Promise<Loaded<T>> {
  let read;
  try { read = await records.readMany([key]); }
  catch (error) { return { ok: false, rejection: unavailable(`the ${what} read failed: ${messageOf(error)}`) }; }
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find(candidate => candidate.refKey === key);
  if (record === undefined) {
    if (read.value.missing.includes(key)) return { ok: false, rejection: notFound(`the ${what} does not exist`) };
    return { ok: false, rejection: unavailable(`the ${what} key was neither returned nor reported missing`) };
  }
  const decoded = decode(record);
  if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the ${what} is damaged: ${decoded.reason}`) };
  return { ok: true, value: decoded.value, readThrough: read.value.readThrough };
}

// -------------------------------------------------------------------------- //
// meta.expected pin checks                                                    //
// -------------------------------------------------------------------------- //

type CheckedTargetPins = { goalPin: VersionPin; targetPin: VersionPin } | CoreRejection;

function checkTargetPins(
  expected: readonly VersionPin[], goalRef: GoalRef, targetRef: TaskReductionRef | GoalPhaseRef, targetLabel: string,
): CheckedTargetPins {
  if (expected.length !== 2) {
    return invalid(`completion meta.expected must contain exactly the Goal pin and the ${targetLabel} pin`);
  }
  const goalPin = expected.find(pin => isRecord(pin) && sameRef(pin.ref, goalRef));
  const targetPin = expected.find(pin => isRecord(pin) && sameRef(pin.ref, targetRef));
  if (goalPin === undefined || targetPin === undefined || goalPin === targetPin) {
    return invalid(`completion meta.expected must be exactly the Goal and ${targetLabel} pins`);
  }
  if (!isPositiveSafeInteger(goalPin.revision)) return invalid('the Goal pin must be a positive safe revision');
  if (!isNonNegativeSafeInteger(targetPin.revision)) return invalid(`the ${targetLabel} pin must be revision 0 or higher`);
  return { goalPin, targetPin };
}

// -------------------------------------------------------------------------- //
// The trusted Host Task completion entry                                      //
// -------------------------------------------------------------------------- //

/**
 * Trusted Host Task-completion entry. The real admission/receipt/local read-set/
 * pure-fold/one-commit pipeline. `meta.expected` must pin exactly the Goal and
 * the target `TaskReduction` (revision 0 on the first completion).
 */
export async function completeTaskFromHost(
  deps: CompletionDependencies,
  ctx: CoreCallContext,
  request: Parameters<GoalTaskPort['completeTask']>[1],
): ReturnType<GoalTaskPort['completeTask']> {
  const ownedCtx = bindTrustedContext(ctx);
  if (!ownedCtx.ok) return ownedCtx.rejection;
  const { scope, actor, signal } = ownedCtx;
  const owned = isolateWrite(request);
  if (!owned.ok) return owned.rejection;
  const raw = owned.input as unknown;
  if (!isRecord(raw)) return invalid('completeTask requires an input object');
  const taskRef = raw['taskRef'];
  const planRef = raw['planRef'];
  const roundRef = raw['roundRef'];
  const taskProblem = taskTripleProblem(taskRef);
  if (taskProblem !== null) return invalid(taskProblem);
  const planProblem = planRefProblem(planRef);
  if (planProblem !== null) return invalid(planProblem);
  const roundProblem = roundRefProblem(roundRef);
  if (roundProblem !== null) return invalid(roundProblem);
  const task = taskRef as TaskTriple;
  const planRevision = planRef as PlanRevisionRef;
  const round = roundRef as VerificationRoundRef;
  if (task.projectId !== scope.projectId || planRevision.projectId !== scope.projectId
    || round.projectId !== scope.projectId) {
    return forbidden('the completion request is outside the trusted Host project scope');
  }
  if (round.workspaceId !== scope.workspaceId) return forbidden('the completion request is outside the trusted Host workspace scope');
  if (task.goalId !== round.goalId) return invalid('the round does not belong to the requested Goal');
  if (task.taskId !== round.taskId) return invalid('the round subject disagrees with the requested task');
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
  const reductionRef: TaskReductionRef = { aggregateType: 'TaskReduction',
    projectId: task.projectId, goalId: task.goalId, taskId: task.taskId };

  let identity: string;
  let fingerprint: string;
  try {
    identity = identityKeyOf(TASK_IDENTITY_PREFIX, actor, scope.projectId, scope.workspaceId, owned.requestId);
    fingerprint = fingerprintOf({ kind: 'r3e-complete-task', taskRef: task, planRef: planRevision,
      roundRef: round, expected: owned.expected });
  } catch { return invalid('the completeTask request is not canonicalizable JSON'); }

  const lookup = await lookupReceipt(deps.records, identity, fingerprint);
  if (lookup.status === 'failed') return lookup.rejection;
  if (lookup.status === 'found') {
    const replayed = await replayEvent(deps.records, lookup.receipt, identity, fingerprint);
    if (replayed.status !== 'committed') return replayed;
    return { status: 'committed', value: replayed.value as TaskReductionSnapshot, replayed: true, cursor: replayed.cursor };
  }

  const pins = checkTargetPins(owned.expected, goalRef, reductionRef, 'TaskReduction');
  if ('status' in pins) return pins;
  if (signal.aborted) return cancelled('the completeTask request was cancelled before reading');

  const goalRead = await readGoal(deps.records, goalRef);
  if (goalRead.status !== 'ready') return mapRejected(goalRead);
  const goal = goalRead.goal;
  if (goal.workspaceRef.workspaceId !== scope.workspaceId) return forbidden('the Goal belongs to another workspace');
  if (goal.revision !== pins.goalPin.revision) {
    return reject('revision_conflict', 'the Goal changed since the caller read it', [{ ref: goalRef, revision: goal.revision }]);
  }
  const activeRef = goal.activePlanRevision;
  if (activeRef === null || planRevisionRefKey(activeRef) !== planRevisionRefKey(planRevision)) {
    return reject('revision_conflict', 'the selected Plan is not the Goal active Plan');
  }
  const planRead = await readPlan(deps.records, planRevision);
  if (planRead.status !== 'ready') return mapRejected(planRead);
  const plan = planRead.plan;
  if (plan.goalRef.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
    return notFound('the selected Plan belongs to another Goal');
  }
  const taskDefinition = plan.tasks.find(candidate => candidate.taskId === task.taskId);
  // TASK-14/15/24 answer a Task outside the selected Plan (∅) with the same refusal.
  if (taskDefinition === undefined) return incomplete('the selected Plan does not define the requested task');

  const factsRead = await readCanonicalTaskFacts(deps.records, goalRef, plan, task.taskId);
  if (factsRead.status !== 'ready') return mapRejected(factsRead);
  const facts = factsRead.value;
  const state = facts.byTaskId.get(task.taskId);
  if (state === undefined) return incomplete('the canonical task state is not readable');

  const reductionKey = refKeyOf(reductionRef);
  if (reductionKey === null) return invalid('the TaskReduction ref is not canonical JSON');
  const persistedReductionRevision = facts.guards.find(guard => guard.refKey === reductionKey)?.expectedRevision ?? null;
  const expectedReductionRevision = pins.targetPin.revision === 0 ? null : pins.targetPin.revision;
  if (persistedReductionRevision !== expectedReductionRevision) {
    return reject('revision_conflict', 'the TaskReduction changed since the caller read it',
      persistedReductionRevision === null ? undefined : [{ ref: reductionRef, revision: persistedReductionRevision }]);
  }
  // TASK-14/24 judge the projection and the selected Run's chain head before the round is read (§4.4, C5).
  const phaseFacts = completionPhaseFacts(taskDefinition, state, facts);
  const chainHead = chainHeadOf(phaseFacts.round);
  const projectionRefusal = taskCompletionProjectionProblem({ taskKind: taskDefinition.taskKind, phase: state.effectivePhase },
    round, chainHead);
  if (projectionRefusal?.ok === false) return reject(projectionRefusal.code, projectionRefusal.detail);

  const roundRead = await readRecord(deps.records, refKeyOf(round) as string, decodeVerificationRoundSnapshot, 'VerificationRound');
  if (!roundRead.ok) return roundRead.rejection;
  const snapshot = roundRead.value as RoundSnapshot;
  // TASK-14/15/24 judge the round before its producer Run is read (a producer not read yet holds).
  const roundRefusal = taskCompletionRoundProblem({ task, taskKind: taskDefinition.taskKind, round: snapshot,
    producerRun: null, producerTaskKind: null });
  if (roundRefusal !== null) return roundRefusal;

  // The round's producer Run is a real identity: for a work round it is the
  // task's own Run; for a gate round it must be a same-Goal ordinary work Run,
  // never a fabricated gate Run.
  const producerKey = refKeyOf(snapshot.subjectRunRef);
  if (producerKey === null) return invalid('the round subject Run ref is not canonical JSON');
  const producerRead = await readRecord(deps.records, producerKey, (record) => {
    const decoded = decodeRun(record);
    return decoded.ok ? { status: 'decoded', value: decoded.value } : { status: 'invalid', reason: decoded.reason };
  }, 'subject Run');
  if (!producerRead.ok) return producerRead.rejection;
  const producerRun = producerRead.value as RunSnapshot;
  const producerTaskKind = plan.tasks.find(candidate => candidate.taskId === producerRun.task.taskId)?.taskKind ?? null;
  const producerRefusal = taskCompletionRoundProblem({ task, taskKind: taskDefinition.taskKind, round: snapshot,
    producerRun, producerTaskKind });
  if (producerRefusal !== null) return producerRefusal;

  // Read the task's formal Evidence index and the exact admitted Evidence.
  const indexRef = { aggregateType: 'TaskEvidenceIndex' as const, projectId: goalRef.projectId,
    goalId: goalRef.goalId, taskId: task.taskId };
  const indexKey = refKeyOf(indexRef) as string;
  // TD-2 (L-3, VD-5): the evidence every TaskRequeue of the Task stored and the
  // completion round's own chain superseded leaves the fold before it.
  const superseded = new Set([...evidenceSupersededByRequeue(facts.requeuesByTaskId.get(task.taskId) ?? []),
    ...(snapshot.chain?.supersededEvidenceIds ?? [])]);
  const evidenceKeys = await collectEvidenceKeys(deps.records, indexKey, goalRef.projectId, snapshot.evidenceRefs, superseded);
  if ('rejection' in evidenceKeys) return evidenceKeys.rejection;
  const evidenceSnapshots = evidenceKeys.evidence;

  // Applicability from the real evidence anchors and the selected Plan; the
  // fold is the SINGLE `selectEffectiveEvidenceSet`.
  const evidencePlans = await readEvidencePlans(deps.records, evidenceSnapshots, plan);
  if ('rejection' in evidencePlans) return evidencePlans.rejection;
  const evidenceList = evidenceSnapshots.map(entry => entry.evidence);
  const bindings: EvidenceBindingV1[] = [];
  for (const entry of evidenceSnapshots) {
    const evidence = entry.evidence;
    const evidencePlan = evidencePlans.plans.get(planRevisionRefKey(evidence.anchor.planRef));
    if (evidencePlan === undefined) return unavailable('an admitted Evidence origin Plan is not readable');
    const currentAnchor: EffectivityAnchorV1 = { schemaVersion: 1, planRef: plan.ref, planRevision: plan.planRevision,
      workspaceRevision: evidence.anchor.workspaceRevision,
      pinnedCompletionPolicy: plan.effectiveCompletionPolicy,
      pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline };
    const decision = evidenceApplicabilityWithBasis({ evidence, adoptedPlan: plan, evidencePlan, currentAnchor });
    bindings.push(evidenceBindingFor(evidence, decision.applicability));
  }
  const effectiveSet = selectEffectiveEvidenceSet(evidenceList, bindings);

  const evaluation = evaluateTaskCompletion({
    plan, task: taskDefinition, effectiveSet, runs: facts.runsByTaskId.get(task.taskId) ?? [], lease: state.lease,
  });
  // TASK-14/15/24 refuse an unsatisfied fold before the pinned policy is read.
  const foldRefusal = taskCompletionFoldProblem(task.taskId, evaluation);
  if (foldRefusal !== null) return foldRefusal;

  // The policy pinned by the adopted Plan is re-read and its local guard is
  // merged into this commit; the project active pointer is never consulted.
  const policyRead = await readPinnedCompletionPolicy(deps.records, plan.effectiveCompletionPolicy);
  if (policyRead.status !== 'resolved') return mapRejected(policyRead);

  const policyGuards = policyRead.guards;
  // TASK-14 (work), TASK-15 (gate), TASK-24 (already satisfied, new identity):
  // the machine re-judges the round, its producer and the fold, and its record
  // constructor builds the TaskReduction@revision+1 (§14.1).
  const completed = transitionTask(taskMachineStateOf(taskDefinition, phaseFacts), {
    kind: 'task_completed', task, round: snapshot,
    reduction: {
      ref: reductionRef,
      previousRevision: persistedReductionRevision,
      plan,
      definition: taskDefinition,
      effectiveEvidenceIds: effectiveSet.effectiveEvidenceIds,
      blockingEvidenceIds: flattenBlocking(effectiveSet.blockingByRequirement),
      staleEvidenceIds: effectiveSet.staleEvidenceIds,
      outOfScopeEvidenceIds: effectiveSet.outOfScopeEvidenceIds,
      evidenceRefs: evidenceSnapshots.map(entry => entry.ref),
      reducedAt: deps.now(),
    },
  }, { taskId: task.taskId, claim: null, completion: { producerRun, producerTaskKind, evaluation, chainHead }, disposition: null });
  if (!completed.ok) return reject(completed.code, completed.detail);
  const [written, ...others] = completed.effects;
  if (written?.kind !== 'write_task_reduction' || others.length > 0) throw new Error('task_completed writes exactly the TaskReduction');
  const reduction = written.reduction;

  const guards = mergeGuards([
    { refKey: refKeyOf(goalRef) as string, expectedRevision: goal.revision },
    { refKey: refKeyOf(plan.ref) as string, expectedRevision: plan.revision },
    { refKey: refKeyOf(round) as string, expectedRevision: snapshot.revision },
    { refKey: producerKey, expectedRevision: producerRun.revision },
    { refKey: indexKey, expectedRevision: evidenceKeys.indexRevision },
    ...evidenceSnapshots.map(entry => ({ refKey: refKeyOf(entry.ref) as string, expectedRevision: entry.revision })),
    ...[...evidencePlans.plans.entries()].map(([key, originPlan]) => ({ refKey: key, expectedRevision: originPlan.revision })),
    ...policyGuards,
    ...facts.guards,
    // §4.3 completion guards: every TaskRequeue read @1, the selected Run's key at null.
    ...facts.reworkGuards,
  ]);
  if (!guards.ok) return guards.rejection;

  const occurredAt = deps.now();
  const event: TaskCompletedEvent = { eventId: deps.eventId(), eventType: TASK_COMPLETED_EVENT_TYPE,
    schemaVersion: 1, occurredAt, identityKey: identity, actor, fingerprint, goalRef, taskRef: task, result: reduction };
  const prepared: PreparedCommit = { identityKey: identity, fingerprint, guards: guards.guards,
    records: [encodeTaskReductionSnapshot(reduction)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeCompletionEvent(event)] };
  try {
    if (signal.aborted) return cancelled('the completeTask request was cancelled before commit');
    const receipt = await deps.records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    if (receipt.replayed) {
      const replayed = await replayEvent(deps.records, receipt, identity, fingerprint);
      if (replayed.status !== 'committed') return replayed;
      return { status: 'committed', value: replayed.value as TaskReductionSnapshot, replayed: true, cursor: replayed.cursor };
    }
    return { status: 'committed', value: reduction, replayed: false, cursor: receipt.cursor };
  } catch (error) {
    const recovered = await commitOrRecover(deps.records, prepared, identity, fingerprint, error);
    if (recovered.status !== 'committed') return recovered;
    return { status: 'committed', value: recovered.value as TaskReductionSnapshot, replayed: true, cursor: recovered.cursor };
  }
}

// -------------------------------------------------------------------------- //
// The trusted Host Goal completion entry                                      //
// -------------------------------------------------------------------------- //

/**
 * Trusted Host Goal-completion entry. `meta.expected` must pin exactly the Goal
 * and the target `GoalPhase` (revision 0 on the first completion).
 */
export async function completeGoalFromHost(
  deps: CompletionDependencies,
  ctx: CoreCallContext,
  request: Parameters<GoalTaskPort['completeGoal']>[1],
): ReturnType<GoalTaskPort['completeGoal']> {
  const ownedCtx = bindTrustedContext(ctx);
  if (!ownedCtx.ok) return ownedCtx.rejection;
  const { scope, actor, signal } = ownedCtx;
  const owned = isolateWrite(request);
  if (!owned.ok) return owned.rejection;
  const raw = owned.input as unknown;
  if (!isRecord(raw) || !isRecord(raw['goalRef']) || raw['goalRef']['aggregateType'] !== 'Goal'
    || !nonEmpty(raw['goalRef']['projectId']) || !nonEmpty(raw['goalRef']['goalId'])) {
    return invalid('completeGoal requires a complete GoalRef');
  }
  const goalRef = raw['goalRef'] as unknown as GoalRef;
  if (goalRef.projectId !== scope.projectId) return forbidden('the completion request is outside the trusted Host project scope');
  const goalPhaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId };

  let identity: string;
  let fingerprint: string;
  try {
    identity = identityKeyOf(GOAL_IDENTITY_PREFIX, actor, scope.projectId, scope.workspaceId, owned.requestId);
    fingerprint = fingerprintOf({ kind: 'r3e-complete-goal', goalRef, expected: owned.expected });
  } catch { return invalid('the completeGoal request is not canonicalizable JSON'); }

  const lookup = await lookupReceipt(deps.records, identity, fingerprint);
  if (lookup.status === 'failed') return lookup.rejection;
  if (lookup.status === 'found') {
    const replayed = await replayEvent(deps.records, lookup.receipt, identity, fingerprint);
    if (replayed.status !== 'committed') return replayed;
    return { status: 'committed', value: replayed.value as GoalPhaseSnapshot, replayed: true, cursor: replayed.cursor };
  }

  const pins = checkTargetPins(owned.expected, goalRef, goalPhaseRef, 'GoalPhase');
  if ('status' in pins) return pins;
  if (signal.aborted) return cancelled('the completeGoal request was cancelled before reading');

  const goalRead = await readGoal(deps.records, goalRef);
  if (goalRead.status !== 'ready') return mapRejected(goalRead);
  const goal = goalRead.goal;
  // GOAL-07/08: workspace, Goal pin and pointer before the Plan is read (the
  // facts, the GoalPhase and the reduction are not read yet and hold).
  const pinned = { expectedGoalRevision: pins.goalPin.revision, expectedGoalPhaseRevision: pins.targetPin.revision };
  const goalInWorkspace = goal.workspaceRef.workspaceId === scope.workspaceId;
  const admitted = goalCompletionProblem(goalStateOf(goal, null), pinned, { goalInWorkspace, completion: null });
  if (admitted?.ok === false) {
    return reject(admitted.code, admitted.detail,
      admitted.reason === 'stale' ? [{ ref: goalRef, revision: goal.revision }] : undefined);
  }
  // GOAL-07/08 refused a Goal without an adopted Plan above.
  const activeRef = goal.activePlanRevision!;
  const planRead = await readPlan(deps.records, activeRef);
  if (planRead.status !== 'ready') return mapRejected(planRead);
  const plan = planRead.plan;
  if (plan.goalRef.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
    return notFound('the active Plan belongs to another Goal');
  }

  const factsRead = await readCanonicalTaskFacts(deps.records, goalRef, plan);
  if (factsRead.status !== 'ready') return mapRejected(factsRead);
  const facts = factsRead.value;

  const phaseRead = await readGoalPhase(deps.records, goalPhaseRef);
  if (phaseRead.status !== 'ready') return mapRejected(phaseRead);

  const goalState = goalStateOf(goal, phaseRead.snapshot);
  const goalCtx: GoalGuardContext = { callerClass: reworkActorClassOf(ownedCtx.ctx.principal, actor),
    scopePinsAgree: true, goalInWorkspace, completion: evaluateGoalCompletion({ plan, taskFacts: facts }) };
  // GOAL-07/08 judge the GoalPhase pin, then the reduction, before the pinned
  // policy is read; the Goal pin held above, so a stale refusal is the GoalPhase's.
  const decided = goalCompletionProblem(goalState, pinned, goalCtx);
  if (decided?.ok === false) {
    const stored = goalState.goalPhase;
    return reject(decided.code, decided.detail, decided.reason === 'stale' && stored !== null
      ? [{ ref: goalPhaseRef, revision: stored.revision }] : undefined);
  }

  const policyRead = await readPinnedCompletionPolicy(deps.records, plan.effectiveCompletionPolicy);
  if (policyRead.status !== 'resolved') return mapRejected(policyRead);

  // GOAL-07 (no GoalPhase) / GOAL-08 (one for an older plan): the machine
  // builds GoalPhase COMPLETED@revision+1 (§14.1) and names the commit's guards.
  const completed = transitionGoal(goalState, { type: 'goal_completed', ...pinned, reducedAt: deps.now() }, goalCtx);
  if (!completed.ok) return reject(completed.code, completed.detail);
  const goalPhase = completed.next.goalPhase;
  if (goalPhase === null) throw new Error('goal_completed must write the GoalPhase');
  // The record is `next.goalPhase` and the GoalCompleted event is built below;
  // each guard effect names one CAS guard of the read set.
  const guards = mergeGuards(completed.effects.flatMap((effect): readonly RecordGuard[] => {
    if (effect.kind === 'write_goal_phase' || effect.kind === 'append_event') return [];
    if (effect.kind !== 'guard') throw new Error(`goal_completed has no ${effect.kind} effect`);
    const guard = effect.guard;
    switch (guard.target) {
      case 'goal': return [{ refKey: refKeyOf(goalRef) as string, expectedRevision: guard.expectedRevision }];
      case 'plan_revision': return [{ refKey: refKeyOf(guard.ref) as string, expectedRevision: plan.revision }];
      case 'goal_phase': return [{ refKey: phaseRead.guard.refKey, expectedRevision: guard.expectedRevision }];
      case 'pinned_policy': return policyRead.guards;
      case 'task_facts': return facts.guards;
      default: throw new Error(`goal_completed has no ${guard.target} guard`);
    }
  }));
  if (!guards.ok) return guards.rejection;

  const occurredAt = deps.now();
  const event: GoalCompletedEvent = { eventId: deps.eventId(), eventType: GOAL_COMPLETED_EVENT_TYPE,
    schemaVersion: 1, occurredAt, identityKey: identity, actor, fingerprint, goalRef, result: goalPhase };
  const prepared: PreparedCommit = { identityKey: identity, fingerprint, guards: guards.guards,
    records: [encodeGoalPhaseSnapshot(goalPhase)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeCompletionEvent(event)] };
  try {
    if (signal.aborted) return cancelled('the completeGoal request was cancelled before commit');
    const receipt = await deps.records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    if (receipt.replayed) {
      const replayed = await replayEvent(deps.records, receipt, identity, fingerprint);
      if (replayed.status !== 'committed') return replayed;
      return { status: 'committed', value: replayed.value as GoalPhaseSnapshot, replayed: true, cursor: replayed.cursor };
    }
    return { status: 'committed', value: goalPhase, replayed: false, cursor: receipt.cursor };
  } catch (error) {
    const recovered = await commitOrRecover(deps.records, prepared, identity, fingerprint, error);
    if (recovered.status !== 'committed') return recovered;
    return { status: 'committed', value: recovered.value as GoalPhaseSnapshot, replayed: true, cursor: recovered.cursor };
  }
}

// -------------------------------------------------------------------------- //
// Evidence read helpers                                                       //
// -------------------------------------------------------------------------- //

type CollectedEvidence = { indexRevision: number | null; evidence: EvidenceSnapshot[] } | { rejection: CoreRejection };

async function collectEvidenceKeys(
  records: Records, indexKey: string, projectId: string, roundEvidenceRefs: readonly EvidenceRef[],
  superseded: ReadonlySet<string>,
): Promise<CollectedEvidence> {
  const read = await readBatch(records, [indexKey]);
  if (read.status !== 'ready') return { rejection: mapRejected(read) };
  const indexRecord = read.batch.present.get(indexKey);
  let indexIds: string[] = [];
  let indexRevision: number | null = null;
  if (indexRecord !== undefined) {
    const decoded = decodeTaskEvidenceIndexSnapshot(indexRecord);
    if (decoded.status !== 'decoded') return { rejection: unavailable(`the TaskEvidenceIndex is damaged: ${decoded.reason}`) };
    indexIds = decoded.value.evidenceIds;
    indexRevision = indexRecord.revision;
  } else if (!read.batch.missing.has(indexKey)) {
    return { rejection: unavailable('the TaskEvidenceIndex key was neither returned nor reported missing') };
  }
  // Never empty: TASK-14/15/24 refused a round that admitted no Evidence, and
  // the chain head's own evidence is never superseded.
  const evidenceIds = [...new Set([...indexIds, ...roundEvidenceRefs.map(ref => ref.evidenceId)])]
    .filter(evidenceId => !superseded.has(evidenceId));
  const refs: EvidenceRef[] = evidenceIds.map(evidenceId => ({ aggregateType: 'Evidence', projectId, evidenceId }));
  const evidenceRead = await readBatch(records, refs.map(ref => refKeyOf(ref) as string));
  if (evidenceRead.status !== 'ready') return { rejection: mapRejected(evidenceRead) };
  const snapshots: EvidenceSnapshot[] = [];
  for (const ref of refs) {
    const key = refKeyOf(ref) as string;
    const record = evidenceRead.batch.present.get(key);
    if (record === undefined) {
      if (evidenceRead.batch.missing.has(key)) return { rejection: incomplete(`the required Evidence ${ref.evidenceId} is absent`) };
      return { rejection: unavailable(`the Evidence key ${key} was neither returned nor reported missing`) };
    }
    const decoded = decodeEvidenceSnapshot(record);
    if (decoded.status !== 'decoded') return { rejection: unavailable(`Evidence ${ref.evidenceId} is damaged: ${decoded.reason}`) };
    snapshots.push(decoded.value);
  }
  return { indexRevision, evidence: snapshots };
}

type EvidencePlanRead = { plans: ReadonlyMap<string, PlanRevisionSnapshot> } | { rejection: CoreRejection };

async function readEvidencePlans(
  records: Records, snapshots: readonly EvidenceSnapshot[], selected: PlanRevisionSnapshot,
): Promise<EvidencePlanRead> {
  const byKey = new Map<string, PlanRevisionRef>();
  byKey.set(planRevisionRefKey(selected.ref), selected.ref);
  for (const snapshot of snapshots) byKey.set(planRevisionRefKey(snapshot.evidence.anchor.planRef), snapshot.evidence.anchor.planRef);
  const refs = [...byKey.values()].filter(ref => planRevisionRefKey(ref) !== planRevisionRefKey(selected.ref));
  const plans = new Map<string, PlanRevisionSnapshot>([[planRevisionRefKey(selected.ref), selected]]);
  if (refs.length === 0) return { plans };
  const read = await readBatch(records, refs.map(ref => planRevisionRefKey(ref)));
  if (read.status !== 'ready') return { rejection: mapRejected(read) };
  for (const ref of refs) {
    const key = planRevisionRefKey(ref);
    const record = read.batch.present.get(key);
    if (record === undefined) return { rejection: unavailable(`an admitted Evidence origin Plan ${ref.planId} is not readable`) };
    const decoded = decodePlanRevisionSnapshot(record);
    if (decoded.status !== 'decoded') return { rejection: unavailable(`an admitted Evidence origin Plan ${ref.planId} is corrupt: ${decoded.reason}`) };
    plans.set(key, decoded.value);
  }
  return { plans };
}

function flattenBlocking(blockingByRequirement: Record<string, string[]>): string[] {
  const ids: string[] = [];
  for (const list of Object.values(blockingByRequirement)) ids.push(...list);
  return [...new Set(ids)];
}
