/**
 * G7 Goal desired state (docs/refactor/STATE-MACHINES-SPEC.md §2 GOAL-04…06,
 * D-9, LA-7): `setGoalControl{goalRef, control, reason}`, the trusted Host
 * entry registered on `GoalTaskPort`.
 *
 * Order: bind the Host context and isolate the request; check the input and
 * the pins (`meta.expected` = the Goal pin, optionally the GoalPhase pin, 0 =
 * none); look up the receipt and replay the ORIGINAL snapshot from the recorded
 * `GoalDesiredStateChanged` event; read the Goal and the GoalPhase; ask
 * `transitionGoal` (`state/goal-machine.ts`), which also builds the next Goal
 * (`nextGoalDesiredState`, §14.1); commit the Goal, the event and the
 * receipt ONCE, CASing the Goal and (pause/cancel) the GoalPhase as read.
 *
 * The commit stops new claims, entries and check processes at once (I-9,
 * VD-9). It does not touch any Run: the Host fan-out driver
 * (`src/app/goal-fan-out-driver.ts`) submits one control per affected Run
 * after it (§2.3 "扇出不是 GOAL-04…06 的同事务副作用").
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalPhaseRef } from '../../../contracts/goal-phase.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import { reworkActorClassOf } from '../../../contracts/task-requeue.js';
import type { GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt } from '../../record-store/ports.js';
import {
  GOAL_DESIRED_STATE_CHANGED_EVENT_SCHEMA_VERSION, GOAL_DESIRED_STATE_CHANGED_EVENT_TYPE,
  decodeGoalDesiredStateChangedEvent, encodeGoalDesiredStateChangedEvent, encodeGoalSnapshot,
  goalSnapshotFromDesiredStateChangedEvent, type GoalDesiredStateChangedEvent,
} from '../persistence/record-codecs.js';
import { goalStateOf, transitionGoal, type GoalControl } from '../state/goal-machine.js';
import { bindTrustedContext, isolateWrite, isRecord, loadReplayEvent, mapStoreFailure, mergeGuards, nonEmpty, sameRef } from './execution-entry-service.js';
import type { GraphWrite, SetGoalControlInput } from './contracts.js';
import { readGoal, readGoalPhase } from './plan-readers.js';

export type GoalControlDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
};

type HostActor = { kind: 'human' | 'system'; id: string };

const GOAL_CONTROL_IDENTITY_PREFIX = 'goal-control:';
const MAX_GOAL_CONTROL_REASON_BYTES = 2048;

function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function refKeyOf(value: unknown): string { return canonicalJson(value as JsonValue); }

function inputProblem(value: unknown, projectId: string): string | null {
  if (!isRecord(value)) return 'setGoalControl requires an input object';
  if (Object.keys(value).some((key) => key !== 'goalRef' && key !== 'control' && key !== 'reason')) {
    return 'the Goal control carries unknown fields';
  }
  const goalRef = value['goalRef'];
  if (!isRecord(goalRef) || goalRef['aggregateType'] !== 'Goal' || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])
    || Object.keys(goalRef).length !== 3) {
    return 'setGoalControl requires a complete GoalRef';
  }
  if (goalRef['projectId'] !== projectId) return 'the Goal belongs to another project';
  const control = value['control'];
  if (control !== 'pause' && control !== 'resume' && control !== 'cancel') return 'the Goal control must be pause, resume or cancel';
  const reason = value['reason'];
  if (reason === null) return null;
  if (typeof reason !== 'string' || reason.length === 0) return 'the Goal control reason must be null or a non-empty string';
  if (Buffer.byteLength(reason, 'utf8') > MAX_GOAL_CONTROL_REASON_BYTES) return 'the Goal control reason exceeds 2048 UTF-8 bytes';
  return null;
}

/** `meta.expected`: exactly the Goal pin, plus at most the GoalPhase pin (0 = none read). */
function checkPins(expected: readonly VersionPin[], goalRef: GoalRef, phaseRef: GoalPhaseRef):
{ goal: number; goalPhase: number | null } | CoreRejection {
  const goalPin = expected.find((pin) => isRecord(pin) && sameRef(pin.ref, goalRef));
  const phasePin = expected.find((pin) => isRecord(pin) && sameRef(pin.ref, phaseRef));
  if (goalPin === undefined || expected.length !== (phasePin === undefined ? 1 : 2)) {
    return invalid('meta.expected must pin the Goal and at most its GoalPhase');
  }
  if (!Number.isSafeInteger(goalPin.revision) || goalPin.revision < 1) return invalid('the Goal pin must be a positive safe revision');
  if (phasePin !== undefined && (!Number.isSafeInteger(phasePin.revision) || phasePin.revision < 0)) {
    return invalid('the GoalPhase pin must be revision 0 or higher');
  }
  return { goal: goalPin.revision, goalPhase: phasePin === undefined ? null : phasePin.revision };
}

/** Restore the ORIGINAL snapshot from the recorded event (LA-7: the original `desiredStateRequestedBy`). */
async function replayGoalControl(
  records: GoalRecordTransactionPort, receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
  identity: string, fingerprint: string, actor: HostActor,
): Promise<WriteResult<GoalSnapshot>> {
  const loaded = await loadReplayEvent(records, receipt);
  if (!loaded.ok) return loaded.rejection;
  const decoded = decodeGoalDesiredStateChangedEvent(loaded.event);
  if (decoded.status !== 'decoded') return unavailable(`the recorded Goal control is not decodable: ${decoded.reason}`);
  const event = decoded.value;
  if (event.identityKey !== identity || event.fingerprint !== fingerprint) {
    return unavailable('the recorded Goal control disagrees with the request identity');
  }
  if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) return unavailable('the recorded Goal control belongs to another actor');
  return { status: 'committed', value: goalSnapshotFromDesiredStateChangedEvent(event), replayed: true, cursor: receipt.cursor };
}

async function lookupGoalControl(
  records: GoalRecordTransactionPort, identity: string, fingerprint: string, actor: HostActor,
): Promise<{ status: 'found'; result: WriteResult<GoalSnapshot> } | { status: 'absent' } | { status: 'failed'; rejection: CoreRejection }> {
  try {
    const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
    if (lookup.status === 'ready') return { status: 'found', result: await replayGoalControl(records, lookup.value, identity, fingerprint, actor) };
    if (lookup.code === 'not_found') return { status: 'absent' };
    return { status: 'failed', rejection: mapStoreFailure(lookup) };
  } catch (error) {
    return { status: 'failed', rejection: unavailable(`the original Goal control receipt could not be read: ${messageOf(error)}`) };
  }
}

/** GOAL-04…06 through `transitionGoal`; one commit of the Goal and its `GoalDesiredStateChanged` event. */
export async function setGoalControlFromHost(
  deps: GoalControlDependencies,
  ctx: CoreCallContext,
  request: GraphWrite<SetGoalControlInput>,
): Promise<WriteResult<GoalSnapshot>> {
  const ownedCtx = bindTrustedContext(ctx);
  if (!ownedCtx.ok) return ownedCtx.rejection;
  const { scope, actor, signal } = ownedCtx;
  const owned = isolateWrite(request);
  if (!owned.ok) return owned.rejection;
  const problem = inputProblem(owned.input, scope.projectId);
  if (problem !== null) return invalid(problem);
  const input = owned.input;
  const control: GoalControl = input.control;
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: input.goalRef.projectId, goalId: input.goalRef.goalId };
  const phaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId };
  const pins = checkPins(owned.expected, goalRef, phaseRef);
  if ('status' in pins) return pins;

  let identity: string;
  let fingerprint: string;
  try {
    identity = GOAL_CONTROL_IDENTITY_PREFIX + sha256Hex(canonicalJson({ actor: { kind: actor.kind, id: actor.id },
      projectId: scope.projectId, workspaceId: scope.workspaceId, requestId: owned.requestId } as unknown as JsonValue));
    fingerprint = sha256Hex(canonicalJson({ kind: 'goal-control', actor: { kind: actor.kind, id: actor.id }, goalRef, control,
      reason: input.reason, expected: owned.expected } as unknown as JsonValue));
  } catch {
    return invalid('the Goal control request is not canonicalizable JSON');
  }
  const lookup = await lookupGoalControl(deps.records, identity, fingerprint, actor);
  if (lookup.status === 'found') return lookup.result;
  if (lookup.status === 'failed') return lookup.rejection;
  if (signal.aborted) return reject('cancelled', 'the Goal control was cancelled before reading');

  const goalRead = await readGoal(deps.records, goalRef);
  if (goalRead.status !== 'ready') return reject(goalRead.code, goalRead.reason);
  const goal = goalRead.goal;
  if (goal.workspaceRef.workspaceId !== scope.workspaceId) return reject('forbidden', 'the Goal belongs to another workspace');
  const phaseRead = await readGoalPhase(deps.records, phaseRef);
  if (phaseRead.status !== 'ready') return reject(phaseRead.code, phaseRead.reason);
  const state = goalStateOf(goal, phaseRead.snapshot);
  const decided = transitionGoal(state, {
    type: control === 'pause' ? 'goal_pause_requested' : control === 'resume' ? 'goal_resume_requested' : 'goal_cancel_requested',
    expectedGoalRevision: pins.goal,
    // No GoalPhase pin: the commit guards the GoalPhase as read.
    expectedGoalPhaseRevision: pins.goalPhase ?? phaseRead.snapshot?.revision ?? 0,
    reason: input.reason,
    requestedBy: actor,
  }, { callerClass: reworkActorClassOf(ownedCtx.ctx.principal, actor), scopePinsAgree: true, goalInWorkspace: true,
    completion: null });
  if (!decided.ok) {
    // A stale refusal names the record whose pin lost: the Goal first, then the GoalPhase (0 = none stored).
    const current: VersionPin[] | undefined = decided.reason !== 'stale' ? undefined
      : pins.goal !== goal.revision ? [{ ref: goalRef, revision: goal.revision }]
        : [{ ref: phaseRef, revision: phaseRead.snapshot?.revision ?? 0 }];
    return reject(decided.code, decided.detail, current);
  }
  const next = decided.next.goal;
  if (next === null) throw new Error('a Goal control must write the Goal');
  const guards: RecordGuard[] = [];
  for (const effect of decided.effects) {
    if (effect.kind === 'write_goal' || effect.kind === 'append_event') continue;
    if (effect.kind !== 'guard') throw new Error(`a Goal control has no ${effect.kind} effect`);
    const target = effect.guard;
    if (target.target === 'goal') guards.push({ refKey: refKeyOf(goalRef), expectedRevision: target.expectedRevision });
    else if (target.target === 'goal_phase') guards.push({ refKey: phaseRead.guard.refKey, expectedRevision: target.expectedRevision });
    else throw new Error(`a Goal control has no ${target.target} guard`);
  }
  const merged = mergeGuards(guards);
  if (!merged.ok) return merged.rejection;
  const nowIso = deps.now();
  const eventId = deps.eventId();
  if (!nonEmpty(nowIso) || !nonEmpty(eventId)) return reject('unsupported', 'the injected id/clock source produced an empty value');
  const event: GoalDesiredStateChangedEvent = {
    eventId, eventType: GOAL_DESIRED_STATE_CHANGED_EVENT_TYPE, schemaVersion: GOAL_DESIRED_STATE_CHANGED_EVENT_SCHEMA_VERSION,
    occurredAt: nowIso, identityKey: identity, actor, fingerprint, control, from: goal.desiredState, to: next.desiredState,
    desiredStateRevision: next.revision,
    // GOAL-05: the epoch of the pause this resume ends (GOAL-14/29 find its fan-out intents by it).
    pausedEpoch: control === 'resume' ? state.desiredStateRevision : null,
    reason: input.reason, goal: next,
  };
  const prepared: PreparedCommit = { identityKey: identity, fingerprint, guards: merged.guards,
    records: [encodeGoalSnapshot(next)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeGoalDesiredStateChangedEvent(event)] };
  try {
    if (signal.aborted) return reject('cancelled', 'the Goal control was cancelled before commit');
    const receipt = await deps.records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    if (receipt.replayed) return await replayGoalControl(deps.records, receipt, identity, fingerprint, actor);
    return { status: 'committed', value: next, replayed: false, cursor: receipt.cursor };
  } catch (error) {
    // The commit result is unknown: only a real receipt read recovers it.
    const recovered = await lookupGoalControl(deps.records, identity, fingerprint, actor);
    if (recovered.status === 'found') return recovered.result;
    if (recovered.status === 'failed') return recovered.rejection;
    return unavailable(`the Goal control commit result is unknown: ${messageOf(error)}`);
  }
}
