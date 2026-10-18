/**
 * §3.3 Goal-settings owner.
 *
 * The owner of one Goal's settings, the workspace Goal order and the conflict
 * resolution. It follows the §3.3 check order exactly: input isolation / ctx /
 * cancel signal → operator → pin shape → identity/fingerprint → original receipt
 * lookup → the one scope/Goal/settings read (and the predecessor Goal/GoalPhase
 * or the ordered Goal set) → `transitionGoalSettings` → ONE commit whose guards
 * are the versions read in this call.
 *
 * Every write proves the exact configured operator; the operator never comes
 * from the request body. Reading changes nothing.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import {
  type DecisionSelectionV1,
  type DecisionSourceV1,
  type GoalAutonomyV1,
  type GoalControlRebaseV1,
  type GoalDecisionBasisV1,
  type GoalSettingsV1,
} from '../../../contracts/goal-decisions.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalPhaseRef } from '../../../contracts/goal-phase.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type {
  GoalRecordTransactionPort,
  PreparedCommit,
  RecordGuard,
} from '../../record-store/ports.js';
import {
  decodeGoalSettingsChangedEvent,
  encodeGoalSettingsChangedEvent,
} from '../persistence/decision-record-codecs.js';
import type { GoalSettingsChangedEventV1 } from '../model/decision-contracts.js';
import { decodeGoalSnapshot, encodeGoalSnapshot, readGoalSettings as goalSettingsOf } from '../persistence/record-codecs.js';
import {
  goalDecisionBasisMatches,
  transitionGoalSettings,
  type GoalSettingsGuardV1,
} from '../state/goal-settings-machine.js';
import {
  bindTrustedContext,
  isolateWrite,
  isRecord,
  loadReplayEvent,
  mapStoreFailure,
  mergeGuards,
  nonEmpty,
  sameRef,
} from './execution-entry-service.js';
import {
  GOAL_BY_WORKSPACE_INDEX,
  readGoal,
  readGoalPhase,
} from './plan-readers.js';
import { pinRevision } from './revision-guard.js';
import type {
  GoalSettingsPort,
  GoalSettingsServiceDependencies,
} from '../model/decision-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';

const GOAL_SETTINGS_IDENTITY_PREFIX = 'goal-settings:';
const GOAL_REORDER_IDENTITY_PREFIX = 'goal-reorder:';
const GOAL_CONFLICT_IDENTITY_PREFIX = 'goal-conflict:';
const LOOKUP_PAGE_LIMIT = 200;
const LOOKUP_MAX_PAGES = 25;

type SettingsValue = GoalSnapshot | { goals: GoalSnapshot[] };

function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return rejectedWithCurrent(code, reason, current);
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function refKeyOf(value: unknown): string { return canonicalJson(value as JsonValue); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** §2.2: the saved Goal settings, or the exact default for an old record. */
function settingsOf(goal: GoalSnapshot): GoalSettingsV1 {
  return goalSettingsOf(goal);
}
function phaseRefOf(goalRef: GoalRef): GoalPhaseRef {
  return { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId };
}
function actorsAgree(left: { kind: string; id: string }, right: { kind: string; id: string }): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/**
 * S5-GS-03: the bounded wait-predecessor walk. `startRef` is the entrance's
 * own Goal (already in `seen`) and `start` its first read predecessor. A failed
 * successor read is returned (never read as "no cycle"); a revisited ref is a
 * cycle; a walk that does not finish inside the 64-link bound is refused, never
 * assumed acyclic.
 */
async function waitPredecessorWalk(
  records: GoalRecordTransactionPort,
  startRef: GoalRef,
  start: GoalSnapshot,
): Promise<{ waitingCycle: boolean } | CoreRejection> {
  const seen = new Set<string>([refKeyOf(startRef)]);
  let cursor: GoalSnapshot | null = start;
  let walkFinished = false;
  let waitingCycle = false;
  for (let depth = 0; cursor !== null && depth < 64; depth += 1) {
    const key = refKeyOf(cursor.ref);
    if (seen.has(key)) { waitingCycle = true; walkFinished = true; break; }
    seen.add(key);
    const next = goalSettingsOf(cursor).waitForGoalRef;
    if (next === null) { walkFinished = true; break; }
    const nextRead = await readGoal(records, next);
    if (nextRead.status !== 'ready') return nextRead;
    cursor = nextRead.goal;
  }
  if (!walkFinished) {
    return reject('capacity', 'the wait-predecessor chain exceeds the 64-link read window');
  }
  return { waitingCycle };
}

/**
 * `meta.expected` must be EXACTLY the allowed refs (one pin each, no extras,
 * no duplicates, non-negative safe revisions). Returns the revisions in the
 * allowed order.
 */
function exactPins(expected: readonly VersionPin[], refs: readonly unknown[]): { revisions: number[] } | CoreRejection {
  if (expected.length !== refs.length) {
    return invalid('meta.expected does not carry exactly the required version pins');
  }
  const revisions: number[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!isRecord(ref)) return invalid('meta.expected names an incomplete ref');
    const key = refKeyOf(ref);
    if (seen.has(key)) return invalid('meta.expected carries a duplicate version pin');
    seen.add(key);
    const revision = pinRevision(expected, ref);
    if (revision === null) return invalid('meta.expected does not carry exactly one pin for every required ref');
    revisions.push(revision);
  }
  return { revisions };
}

/** An injected id/clock must produce a non-empty value (the same rule as goal-control). */
function nonEmptyGenerated(value: unknown): value is string {
  return nonEmpty(value);
}

/** The pure settings facts read by this call; unused facts are neutral. */
function guardFacts(input: {
  operator: boolean; goal: GoalSnapshot; pinMatches: boolean; sameWorkspace: boolean;
  predecessorExists: boolean; waitingCycle: boolean; pairPlanPointersMatch: boolean;
}): GoalSettingsGuardV1 {
  return {
    operator: input.operator,
    goalExists: true,
    desiredState: input.goal.desiredState,
    pinMatches: input.pinMatches,
    sameWorkspace: input.sameWorkspace,
    predecessorExists: input.predecessorExists,
    waitingCycle: input.waitingCycle,
    pairPlanPointersMatch: input.pairPlanPointersMatch,
  };
}

export function createGoalSettingsService(deps: GoalSettingsServiceDependencies): GoalSettingsPort {
  const { records } = deps;

  function operatorActor(): { kind: 'human' | 'system'; id: string } | CoreRejection {
    const configured = deps.operatorActor;
    if (configured === undefined) return reject('unsupported', 'no configured operator exists for new Goal-setting writes');
    return { kind: configured.kind, id: configured.id };
  }

  function identityKey(prefix: string, actor: { kind: string; id: string },
    scope: { projectId: string; workspaceId: string }, requestId: string): string {
    return prefix + sha256Hex(canonicalJson({ actor: { kind: actor.kind, id: actor.id },
      projectId: scope.projectId, workspaceId: scope.workspaceId, requestId } as unknown as JsonValue));
  }
  function fingerprintOf(value: unknown): string {
    return sha256Hex(canonicalJson(value as JsonValue));
  }
  function expectedCanonical(expected: readonly VersionPin[]): Array<{ ref: unknown; revision: number }> {
    return [...expected].map((pin) => ({ ref: pin.ref, revision: pin.revision }))
      .sort((left, right) => {
        const a = refKeyOf(left.ref);
        const b = refKeyOf(right.ref);
        return a < b ? -1 : a > b ? 1 : 0;
      });
  }

  async function replaySettings(
    receipt: Extract<Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>, { status: 'ready' }>['value'],
    expected: { identityKey: string; fingerprint: string; actor: { kind: string; id: string } },
  ): Promise<{ ok: true; value: SettingsValue } | CoreRejection> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const decoded = decodeGoalSettingsChangedEvent(loaded.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded Goal settings event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.identityKey !== expected.identityKey || event.fingerprint !== expected.fingerprint) {
      return unavailable('the recorded Goal settings identity disagrees with the request identity');
    }
    if (!actorsAgree(event.actor, expected.actor)) return unavailable('the recorded Goal settings belong to another actor');
    return { ok: true, value: event.payload.value };
  }

  async function lookupReplay(
    expected: { identityKey: string; fingerprint: string; actor: { kind: string; id: string } },
  ): Promise<{ status: 'found'; value: SettingsValue; cursor: Extract<Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>, { status: 'ready' }>['value']['cursor'] } | { status: 'absent' } | { status: 'failed'; rejection: CoreRejection }> {
    let lookup: Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>;
    try {
      lookup = await records.lookupCommit({ identityKey: expected.identityKey, fingerprint: expected.fingerprint });
    } catch (error) {
      return { status: 'failed', rejection: unavailable(`the original Goal settings receipt could not be read: ${messageOf(error)}`) };
    }
    if (lookup.status === 'ready') {
      const replayed = await replaySettings(lookup.value, expected);
      if ('status' in replayed) return { status: 'failed', rejection: replayed };
      return { status: 'found', value: replayed.value, cursor: lookup.value.cursor };
    }
    if (lookup.code === 'not_found') return { status: 'absent' };
    return { status: 'failed', rejection: mapStoreFailure(lookup) };
  }

  /** The workspace Goal enumeration for the order write, paged to the end. */
  async function allWorkspaceGoals(projectId: string, workspaceId: string):
    Promise<{ goals: GoalSnapshot[]; readThrough: import('../../../contracts/command-event.js').CommitCursor | null } | CoreRejection> {
    const refKeys: string[] = [];
    let after: string | undefined;
    // §3.3/§4.1: the FIRST read of the window is the ledger horizon; later pages
    // and the record read never move it.
    let horizon: import('../../../contracts/command-event.js').CommitCursor | null = null;
    let finished = false;
    for (let page = 0; page < LOOKUP_MAX_PAGES; page += 1) {
      let result: Awaited<ReturnType<GoalRecordTransactionPort & import('../../record-store/lookup-ports.js').RecordLookupPort['lookup']>>;
      try {
        result = await records.lookup(after === undefined
          ? { index: GOAL_BY_WORKSPACE_INDEX, values: [projectId, workspaceId], limit: LOOKUP_PAGE_LIMIT }
          : { index: GOAL_BY_WORKSPACE_INDEX, values: [projectId, workspaceId], after, limit: LOOKUP_PAGE_LIMIT });
      } catch (error) {
        return unavailable(`the workspace Goal list could not be read: ${messageOf(error)}`);
      }
      if (result.status !== 'ready') return unavailable(`the workspace Goal list is unavailable: ${result.code}`);
      if (page === 0) horizon = result.value.readThrough ?? null;
      for (const record of result.value.records) refKeys.push(record.refKey);
      if (result.value.next === null) { finished = true; break; }
      after = result.value.next;
    }
    // §4.1 limits: a listing that did not finish inside the read window is refused
    // `capacity`, never written as a partial (or extended) order table.
    if (!finished) {
      return reject('capacity',
        `the workspace Goal list exceeds the ${LOOKUP_MAX_PAGES * LOOKUP_PAGE_LIMIT} record read window`);
    }
    const goals: GoalSnapshot[] = [];
    if (refKeys.length > 0) {
      let read: Awaited<ReturnType<GoalRecordTransactionPort['readMany']>>;
      try {
        read = await records.readMany(refKeys);
      } catch (error) {
        return unavailable(`the workspace Goals could not be read: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return unavailable(`the workspace Goals are unavailable: ${read.code}`);
      for (const key of refKeys) {
        const record = read.value.records.find((candidate) => candidate.refKey === key);
        if (record === undefined) continue;
        const decoded = decodeGoalSnapshot(record);
        if (decoded.status !== 'decoded') return unavailable(`a workspace Goal is corrupt: ${decoded.reason}`);
        goals.push(decoded.value);
      }
    }
    return { goals, readThrough: horizon };
  }

  /** The single commit of one `GoalSettingsChanged` event plus the exact records it wrote. */
  async function commitSettings(input: {
    scope: { projectId: string; workspaceId: string };
    actor: { kind: 'human' | 'system'; id: string };
    identityKey: string;
    fingerprint: string;
    requestId: string;
    guards: readonly RecordGuard[];
    records: readonly import('../../record-store/ports.js').EncodedRecord[];
    value: SettingsValue;
    proof: import('../../../contracts/goal-decisions.js').DecisionChangeProofV1 | null;
    horizon: import('../../../contracts/command-event.js').CommitCursor | null;
  }): Promise<WriteResult<SettingsValue>> {
    const merged = mergeGuards(input.guards);
    if (!merged.ok) return merged.rejection;
    if (input.horizon === null) return reject('incomplete', 'the ledger has no readable watermark for the Goal settings write');
    const nowIso = deps.now();
    const eventId = deps.newId();
    if (!nonEmptyGenerated(nowIso) || !nonEmptyGenerated(eventId)) {
      return reject('unsupported', 'the injected id/clock source produced an empty value');
    }
    const event: GoalSettingsChangedEventV1 = {
      eventId, eventType: 'GoalSettingsChanged', schemaVersion: 1, occurredAt: nowIso,
      identityKey: input.identityKey, fingerprint: input.fingerprint,
      projectId: input.scope.projectId, workspaceId: input.scope.workspaceId,
      actor: input.actor, requestId: input.requestId,
      payload: { value: input.value, proof: input.proof },
    };
    const prepared: PreparedCommit = { identityKey: input.identityKey, fingerprint: input.fingerprint,
      guards: merged.guards, records: [...input.records], claims: [], indexGuards: [], indexChanges: [],
      events: [encodeGoalSettingsChangedEvent(event)], ledgerHorizon: input.horizon };
    try {
      const receipt = await records.commit(prepared);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (!receipt.replayed) return { status: 'committed', value: input.value, replayed: false, cursor: receipt.cursor };
      const replayed = await replaySettings(receipt,
        { identityKey: input.identityKey, fingerprint: input.fingerprint, actor: input.actor });
      if ('status' in replayed) return replayed;
      return { status: 'committed', value: replayed.value, replayed: true, cursor: receipt.cursor };
    } catch (error) {
      const recovered = await lookupReplay({ identityKey: input.identityKey, fingerprint: input.fingerprint, actor: input.actor });
      if (recovered.status === 'found') return { status: 'committed', value: recovered.value, replayed: true, cursor: recovered.cursor };
      if (recovered.status === 'failed') return recovered.rejection;
      return unavailable(`the Goal settings commit result is unknown: ${messageOf(error)}`);
    }
  }

  async function readGoalSettings(_ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<{ goal: GoalSnapshot; settings: GoalSettingsV1 }>> {
    const ctx = _ctx as unknown as { projectId?: unknown; workspaceId?: unknown } | null | undefined;
    if (ctx === null || ctx === undefined || !nonEmpty(ctx.projectId)) return forbidden('a project-bound call context is required');
    if (!isRecord(input) || !isRecord(input.goalRef) || !nonEmpty(input.goalRef.projectId) || !nonEmpty(input.goalRef.goalId)) {
      return invalid('readGoalSettings requires a complete GoalRef');
    }
    if (input.goalRef.projectId !== ctx.projectId) return forbidden('the Goal belongs to another project');
    const read = await readGoal(records, input.goalRef);
    if (read.status !== 'ready') return read;
    if (read.goal.workspaceRef.workspaceId !== ctx.workspaceId) return forbidden('the Goal belongs to another workspace');
    return { status: 'ready', value: { goal: read.goal, settings: settingsOf(read.goal) } };
  }

  async function setGoalSettings(ctx: CoreCallContext, request: GraphWrite<{ goalRef: GoalRef; autonomy: GoalAutonomyV1; waitForGoalRef: GoalRef | null }>): Promise<WriteResult<GoalSnapshot>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    if (!isRecord(input.goalRef) || input.goalRef.aggregateType !== 'Goal'
      || !nonEmpty(input.goalRef.projectId) || !nonEmpty(input.goalRef.goalId)) {
      return invalid('setGoalSettings requires a complete GoalRef');
    }
    if (input.goalRef.projectId !== scope.projectId) return forbidden('the Goal belongs to another project');
    if (input.autonomy !== 'every_step' && input.autonomy !== 'after_plan_confirmation') {
      return invalid('the Goal autonomy must be every_step or after_plan_confirmation');
    }
    const wait = input.waitForGoalRef;
    if (wait !== null && (!isRecord(wait) || wait.aggregateType !== 'Goal'
      || !nonEmpty(wait.projectId) || !nonEmpty(wait.goalId))) {
      return invalid('waitForGoalRef must be null or a complete GoalRef');
    }
    if (wait !== null && wait.projectId !== scope.projectId) return invalid('the wait predecessor belongs to another project');

    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: input.goalRef.projectId, goalId: input.goalRef.goalId };
    const refs: unknown[] = wait === null ? [goalRef] : [goalRef, wait, phaseRefOf(wait)];
    const pins = exactPins(owned.expected, refs);
    if ('status' in pins) return pins;
    const configured = operatorActor();
    if ('status' in configured) return configured;
    if (!actorsAgree(actor, configured)) return forbidden('only the configured operator may change Goal settings');
    if (isAutomationActor(actor)) return forbidden('a platform automation actor may not change Goal settings');

    const receiptIdentity = identityKey(GOAL_SETTINGS_IDENTITY_PREFIX, actor, scope, owned.requestId);
    const fingerprint = fingerprintOf({ schemaVersion: 1, commandType: 'GoalSettingsSet', goalRef,
      autonomy: input.autonomy, waitForGoalRef: wait, expected: expectedCanonical(owned.expected) });
    const replay = await lookupReplay({ identityKey: receiptIdentity, fingerprint, actor });
    if (replay.status === 'found') return { status: 'committed', value: replay.value as GoalSnapshot, replayed: true, cursor: replay.cursor };
    if (replay.status === 'failed') return replay.rejection;
    if (signal.aborted) return reject('cancelled', 'the Goal settings write was cancelled before reading');

    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return goalRead;
    const goal = goalRead.goal;
    if (goal.workspaceRef.workspaceId !== scope.workspaceId) return forbidden('the Goal belongs to another workspace');
    const leadPin = pins.revisions[0]!;
    if (goal.revision !== leadPin) return reject('revision_conflict', 'the Goal revision changed since it was read',
      [{ ref: goalRef, revision: goal.revision }]);

    let predecessor: GoalSnapshot | null = null;
    let phaseRevision = 0;
    let phaseGuard: RecordGuard | null = null;
    let waitingCycle = false;
    if (wait !== null) {
      const predecessorRead = await readGoal(records, wait);
      if (predecessorRead.status !== 'ready') return predecessorRead;
      predecessor = predecessorRead.goal;
      if (predecessor.workspaceRef.workspaceId !== scope.workspaceId) return invalid('the wait predecessor belongs to another workspace');
      const phaseRead = await readGoalPhase(records, phaseRefOf(wait));
      if (phaseRead.status !== 'ready') return phaseRead;
      phaseRevision = phaseRead.snapshot?.revision ?? 0;
      phaseGuard = phaseRead.guard;
      if (phaseRevision !== pins.revisions[2]) {
        return reject('revision_conflict', 'the predecessor GoalPhase changed since it was read',
          [{ ref: phaseRefOf(wait), revision: phaseRevision }]);
      }
      if (predecessor.revision !== pins.revisions[1]) {
        return reject('revision_conflict', 'the predecessor Goal changed since it was read',
          [{ ref: wait, revision: predecessor.revision }]);
      }
      // A bounded predecessor walk refuses a cycle before the state call. A
      // failed successor read is returned (never read as "no cycle"), and a walk
      // that does not finish inside the bound is refused, never assumed acyclic.
      const walk = await waitPredecessorWalk(records, goalRef, predecessor);
      if ('status' in walk) return walk;
      waitingCycle = walk.waitingCycle;
    }

    const settings: GoalSettingsV1 = { ...settingsOf(goal), autonomy: input.autonomy, waitForGoalRef: wait };
    const facts = guardFacts({ operator: true, goal, pinMatches: true, sameWorkspace: true,
      predecessorExists: predecessor !== null || wait === null, waitingCycle, pairPlanPointersMatch: true });
    const decided = transitionGoalSettings(goal, { type: 'settings_set', settings }, facts);
    if (!decided.ok) return { status: 'rejected', code: decided.code, reason: decided.detail };
    const next = decided.next;
    const guards: RecordGuard[] = [{ refKey: refKeyOf(goalRef), expectedRevision: goal.revision }];
    if (predecessor !== null && wait !== null) {
      guards.push({ refKey: refKeyOf(wait), expectedRevision: predecessor.revision });
      if (phaseGuard !== null) guards.push(phaseGuard);
    }
    const committed = await commitSettings({ scope, actor, identityKey: receiptIdentity, fingerprint, requestId: owned.requestId,
      guards, records: [encodeGoalSnapshot(next)], value: next, proof: null, horizon: goalRead.readThrough });
    if (committed.status !== 'committed') return committed;
    return { status: 'committed', value: committed.value as GoalSnapshot, replayed: committed.replayed, cursor: committed.cursor };
  }

  async function reorderGoals(ctx: CoreCallContext, request: GraphWrite<{ workspace: { projectId: string; workspaceId: string }; goalOrder: GoalRef[]; decisionMessageRef?: SessionMessageRef }>): Promise<WriteResult<{ goals: GoalSnapshot[] }>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    if (!isRecord(input.workspace) || input.workspace.projectId !== scope.projectId
      || input.workspace.workspaceId !== scope.workspaceId) {
      return forbidden('reorderGoals requires the bound workspace');
    }
    // §8.2 scope row (lead, accept review NEW-3): an attributed answer must be in the bound Workspace.
    const reorderAck: unknown = input.decisionMessageRef;
    if (reorderAck !== undefined && reorderAck !== null) {
      if (!isRecord(reorderAck)) return invalid('decisionMessageRef must be a SessionMessageRef');
      if (reorderAck['projectId'] !== scope.projectId || reorderAck['workspaceId'] !== scope.workspaceId) {
        return forbidden('the decision message belongs to another workspace');
      }
    }
    if (!Array.isArray(input.goalOrder) || input.goalOrder.length === 0) return invalid('goalOrder must be a non-empty array');
    for (const ref of input.goalOrder) {
      if (!isRecord(ref) || ref.aggregateType !== 'Goal' || ref.projectId !== scope.projectId || !nonEmpty(ref.goalId)) {
        return invalid('every goalOrder entry must be a complete GoalRef in this project');
      }
    }
    const configured = operatorActor();
    if ('status' in configured) return configured;
    if (!actorsAgree(actor, configured)) return forbidden('only the configured operator may reorder Goals');
    if (isAutomationActor(actor)) return forbidden('a platform automation actor may not reorder Goals');

    const receiptIdentity = identityKey(GOAL_REORDER_IDENTITY_PREFIX, actor, scope, owned.requestId);
    const fingerprint = fingerprintOf({ schemaVersion: 1, commandType: 'GoalReorder', workspace: input.workspace,
      goalOrder: input.goalOrder, expected: expectedCanonical(owned.expected) });
    const replay = await lookupReplay({ identityKey: receiptIdentity, fingerprint, actor });
    if (replay.status === 'found') return { status: 'committed', value: replay.value as { goals: GoalSnapshot[] }, replayed: true, cursor: replay.cursor };
    if (replay.status === 'failed') return replay.rejection;
    if (signal.aborted) return reject('cancelled', 'the Goal reorder was cancelled before reading');

    const listed = await allWorkspaceGoals(scope.projectId, scope.workspaceId);
    if ('status' in listed) return listed;
    const allGoals = listed.goals;
    const byKey = new Map(allGoals.map((goal) => [refKeyOf(goal.ref), goal]));
    if (input.goalOrder.length !== allGoals.length) return invalid('goalOrder must list exactly the workspace Goals');
    const ordered: GoalSnapshot[] = [];
    const seen = new Set<string>();
    for (const ref of input.goalOrder) {
      const key = refKeyOf(ref);
      if (seen.has(key)) return invalid('goalOrder must not repeat a Goal');
      seen.add(key);
      const goal = byKey.get(key);
      if (goal === undefined) return invalid('goalOrder names a Goal that is not in this workspace');
      ordered.push(goal);
    }
    for (const goal of allGoals) {
      if (!seen.has(refKeyOf(goal.ref))) return invalid('goalOrder must list exactly the workspace Goals');
    }
    const pins = exactPins(owned.expected, ordered.map((goal) => goal.ref));
    if ('status' in pins) return pins;
    for (const [index, goal] of ordered.entries()) {
      if (goal.revision !== pins.revisions[index]) {
        return reject('revision_conflict', `the Goal ${goal.ref.goalId} changed since it was read`,
          [{ ref: goal.ref, revision: goal.revision }]);
      }
    }

    const nextGoals: GoalSnapshot[] = [];
    const changedGoals: GoalSnapshot[] = [];
    const changes: { before: VersionPin; after: VersionPin }[] = [];
    for (const [index, goal] of ordered.entries()) {
      // An unchanged order writes no record: the Goal keeps its revision and DTO
      // (AP06: C stays @7 while A and B move to @8). S5-GS-02/05: a cancelled
      // historical Goal still appears in the pure reorder list but is never
      // rewritten (its settings can no longer change).
      if (goal.desiredState === 'cancelled' || goalSettingsOf(goal).order === index) {
        nextGoals.push(goal);
        continue;
      }
      const facts = guardFacts({ operator: true, goal, pinMatches: true, sameWorkspace: true,
        predecessorExists: true, waitingCycle: false, pairPlanPointersMatch: true });
      const decided = transitionGoalSettings(goal, { type: 'order_set', order: index }, facts);
      if (!decided.ok) return { status: 'rejected', code: decided.code, reason: decided.detail };
      nextGoals.push(decided.next);
      changedGoals.push(decided.next);
      changes.push({ before: { ref: goal.ref, revision: goal.revision },
        after: { ref: goal.ref, revision: decided.next.revision } });
    }
    const guards: RecordGuard[] = ordered.map((goal, index) => ({ refKey: refKeyOf(goal.ref), expectedRevision: pins.revisions[index]! }));
    const decisionMessageRef = input.decisionMessageRef;
    const proof = decisionMessageRef === undefined ? null
      : { acknowledgementRef: decisionMessageRef, capturedPins: [], changes, basisRebases: [] };
    const value = { goals: nextGoals };
    const committed = await commitSettings({ scope, actor, identityKey: receiptIdentity, fingerprint, requestId: owned.requestId,
      guards, records: changedGoals.map(encodeGoalSnapshot), value, proof, horizon: listed.readThrough });
    if (committed.status !== 'committed') return committed;
    return { status: 'committed', value: committed.value as { goals: GoalSnapshot[] }, replayed: committed.replayed, cursor: committed.cursor };
  }

  /**
   * §4.5 line 884: the exact conflict fingerprint. It keeps the answered
   * source's captured pin revisions and nulls the revision of every
   * supplementary pin (the earlier GoalPhase of a wait, the uncaptured Goals of
   * an order), so a retry of the same requestId restores the original receipt
   * even after those objects moved. `resolveGoalConflict` and the read-only
   * `readGoalConflictReplay` below both build it here, so their identity can
   * never drift.
   */
  function conflictFingerprint(source: DecisionSourceV1, selection: DecisionSelectionV1,
    decisionMessageRef: SessionMessageRef, expected: readonly VersionPin[]): string {
    const capturedRefKeys = new Set((Array.isArray(source.pins) ? source.pins : [])
      .map((pin) => refKeyOf(pin.ref)));
    const fingerprintPins = expected.map((pin) => (capturedRefKeys.has(refKeyOf(pin.ref))
      ? pin : { ref: pin.ref, revision: null as unknown as number }));
    return fingerprintOf({ schemaVersion: 1, commandType: 'GoalConflictResolve', source,
      selection, decisionMessageRef, expected: expectedCanonical(fingerprintPins) });
  }

  /**
   * §8.2 line 1366 / §4.5 line 884: the read-only replay entry the finite
   * coordinator asks BEFORE reading any current fact for a conflict settings
   * command. It rebuilds the exact identity/fingerprint of
   * `resolveGoalConflict` from the request alone (captured source, selection,
   * decision message and the caller-supplied expected pin REFS) and returns the
   * original committed receipt when one exists. It never writes and never reads
   * a current Goal.
   */
  async function readGoalConflictReplay(ctx: CoreCallContext, request: GraphWrite<{
    source: DecisionSourceV1;
    selection: Extract<DecisionSelectionV1, { kind: 'conflict_wait' | 'conflict_order' | 'conflict_parallel' }>;
    decisionMessageRef: SessionMessageRef;
  }>): Promise<
    | { status: 'found'; value: { goals: GoalSnapshot[] }; cursor: CommitCursor }
    | { status: 'absent' }
    | CoreRejection
  > {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { scope, actor } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    if (!isRecord(input.source) || input.source.kind !== 'goal_conflict' || !isRecord(input.selection)) {
      return invalid('the conflict replay requires a goal_conflict source and a structured selection');
    }
    if (!nonEmpty(input.decisionMessageRef?.messageId)) return invalid('the conflict replay requires the decision message ref');
    const receiptIdentity = identityKey(GOAL_CONFLICT_IDENTITY_PREFIX, actor, scope, owned.requestId);
    const fingerprint = conflictFingerprint(input.source, input.selection, input.decisionMessageRef, owned.expected);
    const replay = await lookupReplay({ identityKey: receiptIdentity, fingerprint, actor });
    if (replay.status === 'found') {
      return { status: 'found', value: replay.value as { goals: GoalSnapshot[] }, cursor: replay.cursor };
    }
    if (replay.status === 'failed') return replay.rejection;
    return { status: 'absent' };
  }

  async function resolveGoalConflict(ctx: CoreCallContext, request: GraphWrite<{
    source: DecisionSourceV1;
    selection: Extract<DecisionSelectionV1, { kind: 'conflict_wait' | 'conflict_order' | 'conflict_parallel' }>;
    decisionMessageRef: SessionMessageRef;
  }>): Promise<WriteResult<{ goals: GoalSnapshot[] }>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const input = owned.input;
    if (!isRecord(input.source) || input.source.kind !== 'goal_conflict' || !isRecord(input.selection)) {
      return invalid('resolveGoalConflict requires a goal_conflict source and a structured selection');
    }
    if (!nonEmpty(input.decisionMessageRef?.messageId)) return invalid('resolveGoalConflict requires the decision message ref');
    // §8.2 scope row (lead, accept review NEW-3): the answer must be in the bound Workspace.
    if (input.decisionMessageRef.projectId !== scope.projectId || input.decisionMessageRef.workspaceId !== scope.workspaceId) {
      return forbidden('the decision message belongs to another workspace');
    }
    const selection = input.selection;
    const configured = operatorActor();
    if ('status' in configured) return configured;
    if (!actorsAgree(actor, configured)) return forbidden('only the configured operator may resolve a Goal conflict');
    if (isAutomationActor(actor)) return forbidden('a platform automation actor may not resolve a Goal conflict');

    const receiptIdentity = identityKey(GOAL_CONFLICT_IDENTITY_PREFIX, actor, scope, owned.requestId);
    // §4.5 line 884 (lead, D1): the fingerprint keeps the answer's captured source pins only. The supplementary
    // pins a first execution reads current (the earlier GoalPhase of a wait, the uncaptured Goals of an order)
    // are CAS guards of that execution and never part of the fingerprint, so a retry of the same requestId after
    // those objects moved replays the original receipt instead of answering idempotency_conflict.
    if (owned.expected.some((pin) => !Number.isSafeInteger(pin.revision) || pin.revision < 0)) {
      return invalid('every expected pin needs a non-negative integer revision');
    }
    const fingerprint = conflictFingerprint(input.source, selection, input.decisionMessageRef, owned.expected);
    const replay = await lookupReplay({ identityKey: receiptIdentity, fingerprint, actor });
    if (replay.status === 'found') return { status: 'committed', value: replay.value as { goals: GoalSnapshot[] }, replayed: true, cursor: replay.cursor };
    if (replay.status === 'failed') return replay.rejection;
    if (signal.aborted) return reject('cancelled', 'the Goal conflict resolution was cancelled before reading');

    const capturedPins = input.source.pins.map((pin) => ({ ref: pin.ref, revision: pin.revision }));
    const basisFor = (goalRef: GoalRef): GoalDecisionBasisV1 | null => {
      const key = refKeyOf(goalRef);
      return (input.source.goalBases ?? []).find((basis) => refKeyOf(basis.goalRef) === key) ?? null;
    };

    if (selection.kind === 'conflict_order') {
      // Reuse the reorder write with the source's captured plan pointers.
      const order = selection.goalOrder;
      if (!Array.isArray(order) || order.length === 0) return invalid('conflict_order requires a goalOrder');
      const listed = await allWorkspaceGoals(scope.projectId, scope.workspaceId);
      if ('status' in listed) return listed;
      const byKey = new Map(listed.goals.map((goal) => [refKeyOf(goal.ref), goal]));
      const ordered: GoalSnapshot[] = [];
      const seen = new Set<string>();
      for (const ref of order) {
        const key = refKeyOf(ref);
        if (seen.has(key)) return invalid('conflict_order must not repeat a Goal');
        seen.add(key);
        const goal = byKey.get(key);
        if (goal === undefined) return invalid('conflict_order names a Goal outside this workspace');
        ordered.push(goal);
      }
      if (ordered.length !== listed.goals.length) return invalid('conflict_order must list exactly the workspace Goals');
      // S5-GS-06/§3.1: a conflict application waits for the resume of a paused
      // member (`busy`); S5-GS-02: it is applied only while every member is not
      // cancelled; a cancelled historical Goal may still appear in a pure
      // `reorderGoals` list, never in a conflict application.
      if (ordered.some((goal) => goal.desiredState === 'paused')) {
        return reject('busy', 'a paused Goal; the conflict application waits for its resume');
      }
      if (ordered.some((goal) => goal.desiredState === 'cancelled')) {
        return invalid('a cancelled Goal cannot be part of a conflict order application');
      }
      const pins = exactPins(owned.expected, ordered.map((goal) => goal.ref));
      if ('status' in pins) return pins;
      // §4.5 line 884 / S5-GS-06 / §2.8: `meta.expected` keeps the answer's
      // captured pins for the conflict Goals, so a Goal this command MODIFIES may
      // be pinned OLDER than current only through the named control rebase: the
      // answer's captured basis still matches the current content and the Goal is
      // active. A Goal the command only reads (an unchanged order slot) must still
      // equal its pin, and every other difference is `revision_conflict`.
      for (const [index, goal] of ordered.entries()) {
        const pin = pins.revisions[index]!;
        if (goal.revision === pin) continue;
        // The named rebase needs BOTH captured facts: the answer's pin for this
        // Goal and its captured content basis.
        const captured = capturedPins.some((candidate) => refKeyOf(candidate.ref) === refKeyOf(goal.ref));
        // Lead (accept review NEW-1, §2.8 line 402): the named control rebase holds for a read-only slot too.
        const basis = basisFor(goal.ref);
        if (captured && basis !== null && goal.revision > pin && goal.desiredState === 'active'
          && goalDecisionBasisMatches(basis, goal)) {
          continue;
        }
        return reject('revision_conflict', `the Goal ${goal.ref.goalId} changed since it was read`,
          [{ ref: goal.ref, revision: goal.revision }]);
      }
      const changes: { before: VersionPin; after: VersionPin }[] = [];
      const basisRebases: GoalControlRebaseV1[] = [];
      const nextGoals: GoalSnapshot[] = [];
      const changedGoals: GoalSnapshot[] = [];
      for (const [index, goal] of ordered.entries()) {
        if (goalSettingsOf(goal).order === index) {
          nextGoals.push(goal);
          continue;
        }
        const proofProblem = captureGoalChange({ goal, capturedPins, basis: basisFor(goal.ref), changes, basisRebases });
        if (proofProblem !== null) return proofProblem;
        const decided = transitionGoalSettings(goal, { type: 'order_set', order: index },
          guardFacts({ operator: true, goal, pinMatches: true, sameWorkspace: true,
            predecessorExists: true, waitingCycle: false, pairPlanPointersMatch: true }));
        if (!decided.ok) return { status: 'rejected', code: decided.code, reason: decided.detail };
        nextGoals.push(decided.next);
        changedGoals.push(decided.next);
      }
      // §4.5 line 884: the record guards CAS the version read in THIS call (a
      // named control rebase uses the current Goal pin), never the captured pin.
      const guards = ordered.map((goal) => ({ refKey: refKeyOf(goal.ref), expectedRevision: goal.revision }));
      const proof = { acknowledgementRef: input.decisionMessageRef, capturedPins, changes, basisRebases };
      const value = { goals: nextGoals };
      const committed = await commitSettings({ scope, actor, identityKey: receiptIdentity, fingerprint, requestId: owned.requestId,
        guards, records: changedGoals.map(encodeGoalSnapshot), value, proof, horizon: listed.readThrough });
      if (committed.status !== 'committed') return committed;
      return { status: 'committed', value: committed.value as { goals: GoalSnapshot[] }, replayed: committed.replayed, cursor: committed.cursor };
    }

    // wait / parallel: both Goals are read and CASed; only the later Goal is written.
    const earlierRef: GoalRef = selection.earlier;
    const laterRef: GoalRef = selection.later;
    if (!isRecord(earlierRef) || !isRecord(laterRef) || earlierRef.goalId === laterRef.goalId) {
      return invalid('the conflict selection must name two different Goals');
    }
    if (earlierRef.projectId !== scope.projectId || laterRef.projectId !== scope.projectId) {
      return invalid('the conflict selection names a Goal in another project');
    }
    // S5-GS-03/04 + §3.3 line 625: both Goals are pinned, and `conflict_wait`
    // additionally pins the earlier Goal's GoalPhase (absent phase = revision 0).
    const phaseRef = phaseRefOf(earlierRef);
    const refs: unknown[] = selection.kind === 'conflict_wait'
      ? [earlierRef, laterRef, phaseRef] : [earlierRef, laterRef];
    const pins = exactPins(owned.expected, refs);
    if ('status' in pins) return pins;
    const earlierRead = await readGoal(records, earlierRef);
    if (earlierRead.status !== 'ready') return earlierRead;
    const laterRead = await readGoal(records, laterRef);
    if (laterRead.status !== 'ready') return laterRead;
    if (earlierRead.goal.workspaceRef.workspaceId !== scope.workspaceId
      || laterRead.goal.workspaceRef.workspaceId !== scope.workspaceId) {
      return forbidden('a conflict Goal belongs to another workspace');
    }
    // S5-GS-06/S5-GS-02 (#12, lead): like `conflict_order`, the application
    // waits for the resume of either paused member and is refused while either
    // member is cancelled.
    if (laterRead.goal.desiredState === 'paused' || earlierRead.goal.desiredState === 'paused') {
      return reject('busy', 'a conflict Goal is paused; the conflict application waits for its resume');
    }
    if (laterRead.goal.desiredState === 'cancelled' || earlierRead.goal.desiredState === 'cancelled') {
      return invalid('a cancelled Goal can no longer change its settings');
    }
    // §3.3 line 625: both Goals are pinned by the caller. The modified (`later`)
    // Goal may be pinned OLDER than current only through the §2.8/§4.5 named
    // control rebase: the answer captured exactly this content and the Goal is
    // active. Every other difference is `revision_conflict`.
    // Lead (accept review NEW-1, §0 T02 / §2.8 line 402): the earlier Goal is only read, but it is a captured Goal
    // aggregate too: a control-only change (pause/resume) with the same content basis is the named rebase.
    const earlierPin = pins.revisions[0]!;
    if (earlierRead.goal.revision !== earlierPin) {
      const basis = basisFor(earlierRef);
      const older = earlierPin < earlierRead.goal.revision;
      if (!older || basis === null || !goalDecisionBasisMatches(basis, earlierRead.goal)) {
        return reject('revision_conflict', 'the earlier conflict Goal changed since it was read',
          [{ ref: earlierRef, revision: earlierRead.goal.revision }]);
      }
    }
    const laterPin = pins.revisions[1]!;
    if (laterRead.goal.revision !== laterPin) {
      const basis = basisFor(laterRef);
      const older = laterPin < laterRead.goal.revision;
      if (!older || basis === null || !goalDecisionBasisMatches(basis, laterRead.goal)) {
        return reject('revision_conflict', 'the later conflict Goal changed since it was read',
          [{ ref: laterRef, revision: laterRead.goal.revision }]);
      }
    }

    // S5-GS-03: `wait_selected` also reads and CASes the earlier GoalPhase, and
    // refuses a wait cycle that would lead from the earlier Goal back to the later.
    let phaseGuard: RecordGuard | null = null;
    let waitingCycle = false;
    if (selection.kind === 'conflict_wait') {
      const phaseRead = await readGoalPhase(records, phaseRef);
      if (phaseRead.status !== 'ready') return phaseRead;
      const phaseRevision = phaseRead.snapshot?.revision ?? 0;
      if (phaseRevision !== pins.revisions[2]) {
        return reject('revision_conflict', 'the earlier GoalPhase changed since it was read',
          [{ ref: phaseRef, revision: phaseRevision }]);
      }
      phaseGuard = phaseRead.guard;
      // S5-GS-03: a failed successor read is returned and an unfinished walk is
      // refused, never read as "no cycle".
      const walk = await waitPredecessorWalk(records, laterRef, earlierRead.goal);
      if ('status' in walk) return walk;
      waitingCycle = walk.waitingCycle;
    }

    // S5-GS-03/04: the answer captured both Goals' Plan pointers; a later Plan
    // change must refuse `revision_conflict` instead of silently re-pairing them.
    const pairPlanPointersMatch = [earlierRef, laterRef].every((ref, index) => {
      const goal = index === 0 ? earlierRead.goal : laterRead.goal;
      const basis = basisFor(ref);
      if (basis === null) return false;
      const current = goal.activePlanRevision;
      const captured = basis.activePlanRef;
      return current === null || captured === null ? current === captured : refKeyOf(current) === refKeyOf(captured);
    });

    // S5-GS-03/§4.3/§2.2 line 149: the selection names the pair's earlier/later
    // Goals as the answered card captured them (a later reorder never renames
    // the pair). "Earlier" is order ascending, with equal orders broken by the
    // full Goal key ascending. An old answer without a captured basis keeps the
    // existing missing-basis refusal (`pairPlanPointersMatch` below).
    const earlierBasis = basisFor(earlierRef);
    const laterBasis = basisFor(laterRef);
    if (earlierBasis !== null && laterBasis !== null) {
      const earlierOrder = earlierBasis.settings.order;
      const laterOrder = laterBasis.settings.order;
      const outOfOrder = earlierOrder > laterOrder
        || (earlierOrder === laterOrder && refKeyOf(earlierRef) >= refKeyOf(laterRef));
      if (outOfOrder) {
        return invalid('the conflict selection is not the earlier/later pair of the answered conflict');
      }
    }

    // S5-GS-04 idempotency: the same pair at the same Plan versions under a NEW
    // identity is a receipt-only no-op — one `GoalSettingsChanged` event, no
    // record revision and `proof.changes=[]` — never a second revision bump.
    if (selection.kind === 'conflict_parallel' && pairPlanPointersMatch) {
      const existing = goalSettingsOf(laterRead.goal).parallelRisks
        .find((risk) => refKeyOf(risk.otherGoalRef) === refKeyOf(earlierRef));
      const samePointer = (saved: { projectId: string } | null, current: { projectId: string } | null): boolean =>
        saved === null || current === null ? saved === current : refKeyOf(saved) === refKeyOf(current);
      if (existing !== undefined && samePointer(existing.selfPlanRef, laterRead.goal.activePlanRevision)
        && samePointer(existing.otherPlanRef, earlierRead.goal.activePlanRevision)) {
        const guards: RecordGuard[] = [
          { refKey: refKeyOf(earlierRef), expectedRevision: earlierRead.goal.revision },
          { refKey: refKeyOf(laterRef), expectedRevision: laterRead.goal.revision },
        ];
        if (phaseGuard !== null) guards.push(phaseGuard);
        const proof = { acknowledgementRef: input.decisionMessageRef, capturedPins, changes: [], basisRebases: [] };
        const value = { goals: [laterRead.goal] };
        const horizon = earlierRead.readThrough ?? laterRead.readThrough;
        const committed = await commitSettings({ scope, actor, identityKey: receiptIdentity, fingerprint, requestId: owned.requestId,
          guards, records: [], value, proof, horizon });
        if (committed.status !== 'committed') return committed;
        return { status: 'committed', value: committed.value as { goals: GoalSnapshot[] }, replayed: committed.replayed, cursor: committed.cursor };
      }
    }

    const changes: { before: VersionPin; after: VersionPin }[] = [];
    const basisRebases: GoalControlRebaseV1[] = [];
    const proofProblem = captureGoalChange({ goal: laterRead.goal, capturedPins, basis: basisFor(laterRef), changes, basisRebases });
    if (proofProblem !== null) return proofProblem;

    let decided;
    if (selection.kind === 'conflict_wait') {
      decided = transitionGoalSettings(laterRead.goal, { type: 'wait_selected', predecessor: earlierRef },
        guardFacts({ operator: true, goal: laterRead.goal, pinMatches: true, sameWorkspace: true,
          predecessorExists: true, waitingCycle, pairPlanPointersMatch }));
    } else {
      const risk = { otherGoalRef: earlierRef, selfPlanRef: laterRead.goal.activePlanRevision,
        otherPlanRef: earlierRead.goal.activePlanRevision };
      decided = transitionGoalSettings(laterRead.goal, { type: 'risk_accepted', risk },
        guardFacts({ operator: true, goal: laterRead.goal, pinMatches: true, sameWorkspace: true,
          predecessorExists: true, waitingCycle, pairPlanPointersMatch }));
    }
    if (!decided.ok) return { status: 'rejected', code: decided.code, reason: decided.detail };
    const nextLater = decided.next;
    const guards: RecordGuard[] = [
      { refKey: refKeyOf(earlierRef), expectedRevision: earlierRead.goal.revision },
      { refKey: refKeyOf(laterRef), expectedRevision: laterRead.goal.revision },
    ];
    if (phaseGuard !== null) guards.push(phaseGuard);
    const proof = { acknowledgementRef: input.decisionMessageRef, capturedPins, changes, basisRebases };
    const value = { goals: [nextLater] };
    const horizon = earlierRead.readThrough ?? laterRead.readThrough;
    const committed = await commitSettings({ scope, actor, identityKey: receiptIdentity, fingerprint, requestId: owned.requestId,
      guards, records: [encodeGoalSnapshot(nextLater)], value, proof, horizon });
    if (committed.status !== 'committed') return committed;
    return { status: 'committed', value: committed.value as { goals: GoalSnapshot[] }, replayed: committed.replayed, cursor: committed.cursor };
  }

  /** §2.8 T02-A/D8: the exact before/after of every changed Goal plus its control rebase. */
  function captureGoalChange(input: {
    goal: GoalSnapshot; capturedPins: readonly VersionPin[]; basis: GoalDecisionBasisV1 | null;
    changes: { before: VersionPin; after: VersionPin }[]; basisRebases: GoalControlRebaseV1[];
  }): CoreRejection | null {
    const key = refKeyOf(input.goal.ref);
    const captured = input.capturedPins.find((pin) => refKeyOf(pin.ref) === key);
    const before = { ref: input.goal.ref, revision: input.goal.revision };
    const after = { ref: input.goal.ref, revision: input.goal.revision + 1 };
    if (captured === undefined) {
      // D8/§3.3 line 621-623: `changes` lists every Goal the commit writes. A
      // Goal the answer did not capture (a third Goal of a conflict order) has no
      // captured pin to check; the revision read in this call is its exact before.
      input.changes.push({ before, after });
      return null;
    }
    if (captured.revision === input.goal.revision) {
      input.changes.push({ before, after });
      return null;
    }
    if (captured.revision > input.goal.revision) {
      return reject('revision_conflict', 'the Goal is older than the captured answer');
    }
    if (input.basis === null || !goalDecisionBasisMatches(input.basis, input.goal) || input.goal.desiredState !== 'active') {
      return reject('revision_conflict', 'the Goal content changed since the answer captured it');
    }
    input.basisRebases.push({ captured, actualBefore: before, basis: input.basis });
    input.changes.push({ before, after });
    return null;
  }

  const service = { readGoalSettings, setGoalSettings, reorderGoals, resolveGoalConflict, readGoalConflictReplay };
  return service;
}
