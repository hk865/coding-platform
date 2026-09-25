/**
 * R4c.1 — atomic Task ownership admission.
 *
 * One `claimTask` call binds a trusted Host request to ONE atomic Store commit:
 * `TaskLease@1`, the claimed `TaskAttempt@1`, a `Run@1` still `starting`, the
 * pending `DispatchOutboxEntry@1` carrying the immutable `TaskClaim`, and the
 * Session revision+1 with `occupancy.execution`. It authorizes NOTHING beyond
 * ownership: no Kernel call, no prepare, no material consumption and no release.
 *
 * Order matters (frozen by behavior tests):
 *   1. isolate ctx/request synchronously, keeping the original AbortSignal;
 *   2. validate shape/scope/expected and compute identity+fingerprint;
 *   3. look up the original receipt — a replay is restored from the recorded
 *      `TaskClaimed` event and never re-reads current state, the clock or ids;
 *   4. on a miss, read the current Goal/accepted Plan/Workspace/Session, the
 *      directed canonical task facts and the current role facts;
 *   5. check eligibility/budget, compile ONE PreparedCommit, re-check cancel and
 *      commit. Every guard conflict leaves zero records and zero occupancy.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext, MaterialReader } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type {
  DispatchOutboxRef, RoleBindingRefV1, RunRef, RunSnapshot, TaskAttemptRef, TaskAttemptSnapshot,
  TaskBudgetV1, TaskLeaseSnapshot, TaskTriple,
} from '../../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import { revisionAssignments } from '../../../contracts/plan.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import { roleSpecContentDigest } from '../../../contracts/role-spec.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreFailure,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import {
  decodeSessionRecord, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  decodeDispatchOutboxEntry, dispatchOutboxRefKey, encodeDispatchOutboxEntry, encodeTaskAttemptSnapshot,
  encodeTaskClaimedEvent, taskClaimedEventFromEvent, taskAttemptRefKey, type TaskClaimedEvent,
} from './claim-record-codecs.js';
import type { ClaimTaskInput, TaskClaim, TaskClaimDependencies, TaskClaimOutbox, TaskClaimPort } from './claim-contracts.js';
import type { GraphWrite } from './contracts.js';
import { evaluateEligibility } from './eligibility.js';
import { readCanonicalTaskFacts, readGoal, readPlan, sameCursor, type Rejected } from './plan-readers.js';

const RUN_SCHEMA_ID = 'RunSnapshot@1';
const TASK_LEASE_SCHEMA_ID = 'TaskLeaseSnapshot@1';
const CLAIM_IDENTITY_PREFIX = 'task-claim:';

type Records = GoalRecordTransactionPort & RecordLookupPort;

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function busy(reason: string): CoreRejection { return reject('busy', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }

function sameHostActor(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && left['kind'] === right['kind'] && left['id'] === right['id']
    && (left['kind'] === 'human' || left['kind'] === 'system');
}
function refKeyOf(ref: unknown): string {
  return canonicalJson(ref as JsonValue);
}
function sameRef(left: unknown, right: unknown): boolean {
  try { return refKeyOf(left) === refKeyOf(right); } catch { return false; }
}
function pinsFromCurrent(current: readonly { refKey: string; revision: number | null }[]): VersionPin[] {
  const pins: VersionPin[] = [];
  for (const entry of current) {
    if (entry.revision === null) continue;
    try {
      const ref = JSON.parse(entry.refKey) as unknown;
      if (isRecord(ref)) pins.push({ ref: ref as VersionPin['ref'], revision: entry.revision });
    } catch { /* unreadable ref key is not a pin */ }
  }
  return pins;
}
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'revision_conflict': {
      const current = pinsFromCurrent(failure.current);
      return reject('revision_conflict', failure.reason, current.length > 0 ? current : undefined);
    }
    case 'unique_conflict':
      return reject('revision_conflict', `${failure.reason} (the unique slot is held by another owner)`);
    case 'idempotency_conflict': return reject('idempotency_conflict', failure.reason);
    case 'not_found': return reject('not_found', failure.reason);
    case 'invalid': return reject('invalid', failure.reason);
    case 'unsupported': return reject('unsupported', failure.reason);
    case 'corrupt': return unavailable(failure.reason);
    default: return unavailable(failure.reason);
  }
}
function mapReaderRejection(rejection: Rejected): CoreRejection {
  return reject(rejection.code, rejection.reason);
}

/** Shared ReadResult -> CoreRejection mapping for a resolved domain read. */
function mapReadResult<T>(result: Exclude<ReadResult<T>, { status: 'ready' }>): CoreRejection {
  if (result.status === 'not_found') return reject('not_found', 'the requested record does not exist');
  if (result.status === 'not_ready') return reject('incomplete', 'the read is not ready at the required watermark');
  return result;
}

// --------------------------------------------------------------------------
// Synchronous input isolation
// --------------------------------------------------------------------------

type OwnedCtx = { ok: true; ctx: CoreCallContext; actor: Extract<ActorRef, { kind: 'human' | 'system' }> }
  | { ok: false; rejection: CoreRejection };

/** Bind the trusted Host scope and identity before the first await; the
 * AbortSignal is preserved by reference so cancellation is never lost. */
function ownCallContext(ctx: CoreCallContext): OwnedCtx {
  const raw = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown; materialReader?: unknown; signal?: unknown;
  } | null | undefined;
  if (raw === null || raw === undefined) return { ok: false, rejection: reject('invalid', 'a Task claim requires a bound call context') };
  const projectId = raw.projectId;
  const workspaceId = raw.workspaceId;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return { ok: false, rejection: forbidden('a Task claim requires a bound project/workspace context') };
  }
  const signal = raw.signal;
  if (typeof signal !== 'object' || signal === null
    || typeof (signal as { aborted?: unknown }).aborted !== 'boolean'
    || typeof (signal as { addEventListener?: unknown }).addEventListener !== 'function') {
    return { ok: false, rejection: forbidden('a Task claim requires the bound AbortSignal') };
  }
  let principal: unknown;
  let materialReader: unknown;
  try {
    principal = structuredClone(raw.principal);
    materialReader = structuredClone(raw.materialReader);
  } catch {
    return { ok: false, rejection: reject('invalid', 'the call context identity cannot be isolated from the caller') };
  }
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: forbidden('a Task claim requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: forbidden('a Task claim requires a trusted Host actor') };
  }
  if (!isRecord(materialReader) || materialReader['kind'] !== 'host'
    || materialReader['projectId'] !== projectId
    || (materialReader['workspaceId'] !== undefined && materialReader['workspaceId'] !== workspaceId)
    || !sameHostActor(materialReader['actor'], actor)) {
    return { ok: false, rejection: forbidden('the material reader is not the same trusted Host scope') };
  }
  return { ok: true,
    ctx: { projectId, workspaceId, principal: principal as CoreCallContext['principal'],
      materialReader: materialReader as MaterialReader, signal: signal as AbortSignal },
    actor: { kind: actor['kind'], id: actor['id'] } };
}

type OwnedRequest = { ok: true; input: ClaimTaskInput; requestId: string; expected: readonly VersionPin[] }
  | { ok: false; rejection: CoreRejection };

function ownRequest(request: GraphWrite<ClaimTaskInput>): OwnedRequest {
  const raw = request as unknown as { input?: unknown; meta?: unknown } | null | undefined;
  if (raw === null || raw === undefined || !isRecord(raw.input)) {
    return { ok: false, rejection: reject('invalid', 'a Task claim requires a request input object') };
  }
  const meta = raw.meta;
  if (!isRecord(meta) || !nonEmpty(meta['requestId'])) {
    return { ok: false, rejection: reject('invalid', 'a Task claim requires meta.requestId') };
  }
  if (!Array.isArray(meta['expected'])) {
    return { ok: false, rejection: reject('invalid', 'meta.expected must be an array of version pins') };
  }
  let input: ClaimTaskInput;
  let expected: readonly VersionPin[];
  try {
    input = structuredClone(raw.input) as ClaimTaskInput;
    expected = structuredClone(meta['expected']) as VersionPin[];
  } catch {
    return { ok: false, rejection: reject('invalid', 'the Task claim request cannot be isolated from the caller') };
  }
  return { ok: true, input, requestId: meta['requestId'], expected };
}

// --------------------------------------------------------------------------
// Shape validation
// --------------------------------------------------------------------------

function validateInputShape(input: ClaimTaskInput, scope: WorkspaceScope): CoreRejection | null {
  const goalRef = input.goalRef;
  if (!isRecord(goalRef) || goalRef['aggregateType'] !== 'Goal' || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])) {
    return reject('invalid', 'claimTask requires a complete GoalRef');
  }
  if (goalRef['projectId'] !== scope.projectId) return forbidden('the Goal belongs to another project');
  const planRef = input.planRef;
  if (!isRecord(planRef) || planRef['aggregateType'] !== 'PlanRevision' || !nonEmpty(planRef['projectId']) || !nonEmpty(planRef['planId'])) {
    return reject('invalid', 'claimTask requires a complete PlanRevisionRef');
  }
  if (planRef['projectId'] !== scope.projectId) return forbidden('the Plan belongs to another project');
  if (!nonEmpty(input.taskId)) return reject('invalid', 'claimTask requires a taskId');
  const sessionRef = input.sessionRef;
  if (!isRecord(sessionRef) || !nonEmpty(sessionRef['projectId']) || !nonEmpty(sessionRef['sessionId'])) {
    return reject('invalid', 'claimTask requires a complete SessionRef');
  }
  if (sessionRef['projectId'] !== scope.projectId) return forbidden('the Session belongs to another project');
  const binding = input.roleBinding;
  if (!isRecord(binding) || binding['schemaVersion'] !== 1 || !nonEmpty(binding['bindingId'])
    || !nonEmpty(binding['templateId']) || !nonEmpty(binding['templateRevision']) || !nonEmpty(binding['policyRevision'])
    || typeof binding['bindingVersion'] !== 'number' || !Number.isSafeInteger(binding['bindingVersion'])
    || binding['bindingVersion'] < 1) {
    return reject('invalid', 'claimTask requires a complete RoleBindingRefV1');
  }
  const budget = input.budget;
  if (!isRecord(budget) || !isPositiveBudget(budget['tokenBudget'])) {
    return reject('invalid', 'budget.tokenBudget must be a positive safe integer');
  }
  const deadline = budget['deadline'];
  if (!(deadline === null || (typeof deadline === 'string' && deadline.length > 0 && Number.isFinite(Date.parse(deadline))))) {
    return reject('invalid', 'budget.deadline must be null or a legal instant');
  }
  return null;
}

type ExpectedPins = { goal: VersionPin; workspace: VersionPin; session: VersionPin };

function validateExpected(
  expected: readonly VersionPin[],
  goalRef: GoalRef,
  workspaceRef: { aggregateType: 'Workspace'; projectId: string; workspaceId: string },
  sessionRef: { projectId: string; sessionId: string },
): { ok: true; pins: ExpectedPins } | { ok: false; rejection: CoreRejection } {
  if (expected.length !== 3) return { ok: false, rejection: reject('invalid', 'meta.expected must contain exactly Goal, Workspace and Session') };
  for (const pin of expected as readonly unknown[]) {
    if (!isRecord(pin) || !isRecord(pin['ref']) || !isSafeRevision(pin['revision'])) {
      return { ok: false, rejection: reject('invalid', 'every expected pin needs a ref and a safe non-negative revision') };
    }
  }
  const goalKey = refKeyOf(goalRef);
  const workspaceKey = refKeyOf(workspaceRef);
  const sessionKey = refKeyOf(plainSessionRefToAggregate(sessionRef));
  const goalIndex = expected.findIndex(pin => refKeyOf(pin.ref) === goalKey);
  const workspaceIndex = expected.findIndex(pin => refKeyOf(pin.ref) === workspaceKey);
  const sessionIndex = expected.findIndex(pin => refKeyOf(pin.ref) === sessionKey);
  if (goalIndex < 0 || workspaceIndex < 0 || sessionIndex < 0
    || new Set([goalIndex, workspaceIndex, sessionIndex]).size !== 3) {
    return { ok: false, rejection: reject('invalid', 'meta.expected must be the Goal, Workspace and Session pins without duplicates or extras') };
  }
  return { ok: true, pins: { goal: expected[goalIndex]!, workspace: expected[workspaceIndex]!, session: expected[sessionIndex]! } };
}

/** True only for values the JCS `canonicalJson` serializes faithfully. It
 * rejects bigint/undefined/function/symbol and non-plain objects, which the
 * serializer would otherwise render as `{}` instead of failing.
 *
 * `path` is the WeakSet of objects on the CURRENT recursion path only: it is
 * removed on the way out so a repeated shared reference is not mistaken for a
 * cycle, while a genuine cycle stops recursion instead of overflowing. */
function isCanonicalJsonValue(value: unknown, path: WeakSet<object> = new WeakSet()): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }
  const object = value as object;
  if (path.has(object)) return false;
  path.add(object);
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isCanonicalJsonValue(item, path)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const item of Object.values(value as Record<string, unknown>)) {
      if (!isCanonicalJsonValue(item, path)) return false;
    }
    return true;
  } finally {
    path.delete(object);
  }
}

/** Reject a request whose isolated payload is not canonicalizable JSON (e.g. a
 * bigint smuggled into a nested ref, or a cycle / unsupported depth) instead of
 * letting a canonicalization error (or a silent `{}`) escape the port. Only
 * this JSON boundary is guarded; Store or other failures are never swallowed. */
function canonicalizeRequest(input: ClaimTaskInput, expected: readonly VersionPin[]): CoreRejection | null {
  try {
    if (!isCanonicalJsonValue(input) || !isCanonicalJsonValue(expected)) {
      return reject('invalid', 'the Task claim request is not canonicalizable JSON');
    }
    canonicalJson(input as unknown as JsonValue);
    canonicalJson(expected as unknown as JsonValue);
    return null;
  } catch {
    return reject('invalid', 'the Task claim request is not canonicalizable JSON');
  }
}

// --------------------------------------------------------------------------
// Role identity match
// --------------------------------------------------------------------------

function roleMatchRejection(
  sessionRole: RoleConfigurationRef,
  binding: RoleBindingRefV1,
  resolution: RoleSpecResolutionV1,
): CoreRejection | null {
  if (resolution.status === 'inadmissible') {
    const details = resolution.reasons.map(reason => reason.code).join(',');
    return forbidden(`the role binding is not admissible: ${details}`);
  }
  if (resolution.status === 'resolved') {
    if (sessionRole.kind !== 'role_spec') {
      return forbidden('the resolved role spec does not match a legacy Session template');
    }
    if (resolution.roleId !== binding.templateId) return forbidden('the resolved role id does not match the binding');
    if (refKeyOf(resolution.revision) !== refKeyOf(sessionRole.pin.ref)) {
      return forbidden('the resolved role spec revision is not the Session pin');
    }
    const digest = roleSpecContentDigest(resolution.spec, resolution.roleId, resolution.revision.revision);
    if (digest !== sessionRole.pin.digest) {
      return forbidden('the resolved role spec digest does not match the Session pin');
    }
    return null;
  }
  // Verified absence of a matrix: only a matching legacy template is acceptable.
  if (sessionRole.kind !== 'legacy_template') return forbidden('a role_spec Session cannot resolve to absent');
  if (sessionRole.templateId !== binding.templateId || sessionRole.templateRevision !== binding.templateRevision) {
    return forbidden('the legacy Session template does not match the binding');
  }
  return null;
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createTaskClaimService(deps: TaskClaimDependencies): TaskClaimPort {
  const records: Records = deps.records;

  function identityAndFingerprint(
    actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
    scope: WorkspaceScope,
    requestId: string,
    input: ClaimTaskInput,
    expected: readonly VersionPin[],
  ): { identityKey: string; fingerprint: string } {
    const identityKey = CLAIM_IDENTITY_PREFIX + sha256Hex(canonicalJson({
      actor: { kind: actor.kind, id: actor.id }, projectId: scope.projectId, workspaceId: scope.workspaceId, requestId,
    } as unknown as JsonValue));
    const expectedCanonical = [...expected].map(pin => ({ ref: pin.ref, revision: pin.revision }))
      .sort((left, right) => {
        const leftKey = refKeyOf(left.ref);
        const rightKey = refKeyOf(right.ref);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
    const fingerprint = sha256Hex(canonicalJson({
      kind: 'task-claim-request',
      actor: { kind: actor.kind, id: actor.id },
      projectId: scope.projectId, workspaceId: scope.workspaceId,
      goalRef: input.goalRef, planRef: input.planRef, taskId: input.taskId,
      sessionRef: input.sessionRef, roleBinding: input.roleBinding, budget: input.budget,
      expected: expectedCanonical,
    } as unknown as JsonValue));
    return { identityKey, fingerprint };
  }

  async function readReplay(
    receipt: Extract<Awaited<ReturnType<Records['lookupCommit']>>, { status: 'ready' }>['value'],
    actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
    scope: WorkspaceScope,
    identityKey: string,
    fingerprint: string,
    input: ClaimTaskInput,
  ): Promise<WriteResult<TaskClaim>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return unavailable('the recorded claim receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (!sameCursor(at.value.cursor, receipt.cursor)) {
      return unavailable('the returned event cursor disagrees with the claim receipt');
    }
    const decoded = taskClaimedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded claim event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) return unavailable('the recorded event id disagrees with the claim receipt');
    if (event.identityKey !== identityKey || event.fingerprint !== fingerprint) {
      return unavailable('the recorded claim identity/fingerprint disagrees with the idempotency receipt');
    }
    if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) {
      return unavailable('the recorded claim event belongs to another actor');
    }
    const claim = event.claim;
    if (claim.task.projectId !== scope.projectId || claim.task.goalId !== input.goalRef.goalId
      || claim.task.taskId !== input.taskId) {
      return unavailable('the recorded claim task disagrees with the request');
    }
    if (refKeyOf(claim.planRef) !== refKeyOf(input.planRef)) return unavailable('the recorded claim Plan disagrees with the request');
    if (!sameRef(claim.sessionRef, input.sessionRef)) return unavailable('the recorded claim Session disagrees with the request');
    if (claim.workspaceId !== scope.workspaceId) return unavailable('the recorded claim workspace disagrees with the Host scope');
    return { status: 'committed', value: claim, replayed: true, cursor: receipt.cursor };
  }

  async function claimTask(ctx: CoreCallContext, request: GraphWrite<ClaimTaskInput>): Promise<WriteResult<TaskClaim>> {
    const ownedCtx = ownCallContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { ctx: scopeCtx, actor } = ownedCtx;
    const ownedRequest = ownRequest(request);
    if (!ownedRequest.ok) return ownedRequest.rejection;
    const { input, requestId, expected } = ownedRequest;

    const scope: WorkspaceScope = { projectId: scopeCtx.projectId, workspaceId: scopeCtx.workspaceId! };
    const shape = validateInputShape(input, scope);
    if (shape !== null) return shape;
    const canonicalInput = canonicalizeRequest(input, expected);
    if (canonicalInput !== null) return canonicalInput;
    const workspaceRef = { aggregateType: 'Workspace' as const, projectId: scope.projectId, workspaceId: scope.workspaceId };
    const checkedExpected = validateExpected(expected, input.goalRef, workspaceRef, input.sessionRef);
    if (!checkedExpected.ok) return checkedExpected.rejection;
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled before lookup');

    const { identityKey, fingerprint } = identityAndFingerprint(actor, scope, requestId, input, expected);

    // 1. Original receipt first: a replay must not consult the current world.
    const lookup = await records.lookupCommit({ identityKey, fingerprint });
    if (lookup.status === 'ready') {
      return readReplay(lookup.value, actor, scope, identityKey, fingerprint, input);
    }
    if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during lookup');

    // 2. Current Goal / accepted Plan / Workspace / Session.
    const goalRead = await readGoal(records, input.goalRef);
    if (goalRead.status !== 'ready') return mapReaderRejection(goalRead);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during the goal read');
    const goal: GoalSnapshot = goalRead.goal;
    if (goal.workspaceRef.workspaceId !== scope.workspaceId) return forbidden('the Goal belongs to another workspace');
    if (goal.desiredState !== 'active') return busy('the Goal is not active');
    if (goal.activePlanRevision === null || refKeyOf(goal.activePlanRevision) !== refKeyOf(input.planRef)) {
      return reject('revision_conflict', 'the requested Plan is not the Goal current pin');
    }

    const planRead = await readPlan(records, input.planRef);
    if (planRead.status !== 'ready') return mapReaderRejection(planRead);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during the plan read');
    const plan: PlanRevisionSnapshot = planRead.plan;
    if (plan.goalRef.goalId !== input.goalRef.goalId || plan.goalRef.projectId !== scope.projectId) {
      return reject('not_found', 'the accepted Plan does not belong to the requested Goal');
    }

    const workspaceKey = refKeyOf(goal.workspaceRef);
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
    const stateRead = await records.readMany([workspaceKey, sessionKey]);
    if (stateRead.status !== 'ready') return mapStoreFailure(stateRead);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during the Session read');
    const workspaceRecord = stateRead.value.records.find(record => record.refKey === workspaceKey);
    const sessionRecord = stateRead.value.records.find(record => record.refKey === sessionKey);
    if (workspaceRecord === undefined) return incomplete('the Goal Workspace record is missing');
    if (sessionRecord === undefined) return reject('not_found', 'the target Session does not exist');
    const decodedSession = decodeSessionRecord(sessionRecord);
    if (decodedSession.status !== 'decoded') return unavailable(`the target Session is damaged: ${decodedSession.reason}`);
    const session: SessionRecord = decodedSession.value;
    if (session.ref.projectId !== scope.projectId) return forbidden('the target Session belongs to another project');
    if (session.workspaceId !== scope.workspaceId) return forbidden('the target Session belongs to another workspace');
    if (session.lifecycle !== 'active') return busy('the target Session is archived');
    if (session.health !== 'available') return busy(`the target Session health is ${session.health}`);
    if (session.occupancy !== null) return busy('the target Session is already occupied');
    if (!isSafeRevision(session.revision) || session.revision < 1) return unavailable('the target Session revision is not readable');
    const generation = session.revision + 1;
    if (!Number.isSafeInteger(generation)) return reject('invalid', 'the Session generation would not be a safe integer');
    // 3. Expected pins must match the current values exactly.
    if (checkedExpected.pins.goal.revision !== goal.revision) return reject('revision_conflict', 'the Goal changed since the caller read it');
    if (checkedExpected.pins.workspace.revision !== workspaceRecord.revision) return reject('revision_conflict', 'the Workspace changed since the caller read it');
    if (checkedExpected.pins.session.revision !== session.revision) return reject('revision_conflict', 'the Session changed since the caller read it');

    // 4. Task identity + canonical state (directed, this Task only).
    const task = plan.tasks.find(candidate => candidate.taskId === input.taskId);
    if (task === undefined) return reject('not_found', 'the Task is not part of the accepted Plan');
    if (task.taskKind !== 'work') return reject('invalid', 'only a work task can be claimed');
    if (task.disposition !== 'active') return reject('invalid', 'the Task disposition is not active');
    const assignments = revisionAssignments(plan).filter(assignment => assignment.taskId === input.taskId);
    if (assignments.length !== 1) return forbidden('the Task must carry exactly one assignment');
    if (assignments[0]!.role !== input.roleBinding.templateId) {
      return forbidden('the Task assignment role does not match the role binding');
    }

    const factsRead = await readCanonicalTaskFacts(records, input.goalRef, plan, input.taskId);
    if (factsRead.status !== 'ready') return mapReaderRejection(factsRead);
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during the task-state read');
    const facts = factsRead.value;
    if (facts.taskHasRun === true) return busy('this Task already has a Run and cannot be claimed for the first time');
    const state = facts.byTaskId.get(input.taskId);
    if (state === undefined) return incomplete('the directed task state was not read');
    const eligibility = evaluateEligibility({
      plan, goalDesiredState: 'active', taskId: input.taskId,
      effectivePhases: new Map([[input.taskId, state.effectivePhase]]), lease: state.lease,
    });
    if (!eligibility.eligible) {
      const first = eligibility.reasons[0]!;
      switch (first.code) {
        case 'task_state_incomplete': return incomplete(first.message);
        case 'goal_not_active': return busy(first.message);
        case 'task_not_found': return reject('not_found', first.message);
        case 'task_kind_not_work': return reject('invalid', first.message);
        case 'task_not_active': return reject('invalid', first.message);
        case 'task_phase_not_dispatchable': return busy(first.message);
        case 'resource_unavailable': return busy(first.message);
        default: return busy(first.message);
      }
    }

    // 5. Current role facts (same resolver, exact read window guards).
    const roleFacts = await deps.roles.resolveRoleBindingFacts(scopeCtx, {
      roleBinding: input.roleBinding, declaredPermissions: { tools: [], writeScope: [] },
    });
    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled during role resolution');
    if (roleFacts.result.status !== 'ready') return mapReadResult(roleFacts.result);
    const roleRejection = roleMatchRejection(session.role, input.roleBinding, roleFacts.result.value);
    if (roleRejection !== null) return roleRejection;

    // 6. Deadline (new requests only) and the immutable result identity.
    const nowIso = deps.now();
    const nowMs = Date.parse(nowIso);
    if (!nonEmpty(nowIso) || !Number.isFinite(nowMs)) return reject('invalid', 'the injected clock is not a legal instant');
    if (input.budget.deadline !== null) {
      const deadlineMs = Date.parse(input.budget.deadline);
      if (!Number.isFinite(deadlineMs)) return reject('invalid', 'budget.deadline is not a legal instant');
      if (!(deadlineMs > nowMs)) return reject('capacity', 'budget.deadline has passed');
    }
    const claimedAt = nowIso;

    const runId = deps.newId();
    const attemptId = deps.newId();
    const eventId = deps.newId();
    if (!nonEmpty(runId) || !nonEmpty(attemptId) || !nonEmpty(eventId)) {
      return reject('unsupported', 'the injected id source produced an empty identity');
    }

    const taskTriple: TaskTriple = { projectId: scope.projectId, goalId: input.goalRef.goalId, taskId: input.taskId };
    const runRef: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: taskTriple.goalId, runId };
    const attemptRef: TaskAttemptRef = { aggregateType: 'TaskAttempt', projectId: scope.projectId,
      goalId: taskTriple.goalId, taskId: input.taskId, attemptId };
    const outboxRef: DispatchOutboxRef = { aggregateType: 'DispatchOutboxEntry', projectId: scope.projectId,
      goalId: taskTriple.goalId, taskId: input.taskId, attemptId };
    const claim: TaskClaim = {
      task: taskTriple, planRef: input.planRef, workspaceId: scope.workspaceId, sessionRef: input.sessionRef,
      sessionRevision: generation,
      generation, runRef, attemptRef, outboxRef, claimedAt,
    };
    const outbox: TaskClaimOutbox = { ref: outboxRef, revision: 1, schemaVersion: 1, status: 'pending', claim };
    const leaseRef = { aggregateType: 'TaskLease' as const, projectId: scope.projectId,
      goalId: taskTriple.goalId, taskId: input.taskId };
    const lease: TaskLeaseSnapshot = { ref: leaseRef, revision: 1, schemaVersion: 1,
      holderRunId: runId, attemptId, grantedAt: claimedAt, expiresAt: null };
    const run: RunSnapshot = { ref: runRef, revision: 1, schemaVersion: 1, task: taskTriple, attemptId,
      planRef: input.planRef, roleBinding: input.roleBinding, budget: input.budget,
      workspaceSnapshot: { workspaceId: scope.workspaceId, revision: workspaceRecord.revision },
      status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0,
      lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null };
    const attempt: TaskAttemptSnapshot = { ref: attemptRef, revision: 1, schemaVersion: 1, runId,
      planRef: input.planRef, status: 'claimed', startedAt: null, endedAt: null, endOutcome: null };
    const nextSession: SessionRecord = { ...session, revision: generation,
      lastExecutionRef: runRef, occupancy: { kind: 'execution', executionRef: runRef, generation } };
    const event: TaskClaimedEvent = { eventId, eventType: 'TaskClaimed', schemaVersion: 1, occurredAt: claimedAt,
      identityKey, actor, fingerprint, claim };

    const leaseRecord: EncodedRecord = { refKey: refKeyOf(leaseRef), schemaId: TASK_LEASE_SCHEMA_ID,
      revision: 1, json: JSON.stringify(lease) };
    const runRecord: EncodedRecord = { refKey: refKeyOf(runRef), schemaId: RUN_SCHEMA_ID,
      revision: 1, json: JSON.stringify(run) };
    const attemptRecord = encodeTaskAttemptSnapshot(attempt);
    const outboxRecord = encodeDispatchOutboxEntry(outbox);
    const sessionEncoded = encodeSessionRecord(nextSession);

    // 7. One guard per distinct key; a later non-null version wins.
    const guardMap = new Map<string, number | null>();
    const addGuard = (refKey: string, expectedRevision: number | null): void => {
      const existing = guardMap.get(refKey);
      if (existing === undefined || (existing === null && expectedRevision !== null)) guardMap.set(refKey, expectedRevision);
    };
    addGuard(refKeyOf(input.goalRef), goal.revision);
    addGuard(workspaceKey, workspaceRecord.revision);
    addGuard(refKeyOf(input.planRef), plan.revision);
    addGuard(sessionKey, session.revision);
    for (const guard of facts.guards) addGuard(guard.refKey, guard.expectedRevision);
    for (const guard of roleFacts.guards) addGuard(guard.refKey, guard.expectedRevision);
    addGuard(refKeyOf(leaseRef), null);
    addGuard(taskAttemptRefKey(attemptRef), null);
    addGuard(refKeyOf(runRef), null);
    addGuard(dispatchOutboxRefKey(outboxRef), null);
    const guards: RecordGuard[] = [...guardMap].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision }));

    const prepared: PreparedCommit = { identityKey, fingerprint, guards,
      records: [leaseRecord, attemptRecord, runRecord, outboxRecord, sessionEncoded],
      claims: [], indexGuards: [], indexChanges: [], events: [encodeTaskClaimedEvent(event)] };

    if (scopeCtx.signal.aborted) return reject('cancelled', 'the Task claim was cancelled before commit');
    const receipt = await records.commit(prepared);
    if (receipt.status !== 'committed') return mapStoreFailure(receipt);
    // A concurrent identical request win makes the Store replay the original
    // event; the local freshly-minted ids must NEVER be returned in that case.
    if (receipt.replayed) return readReplay(receipt, actor, scope, identityKey, fingerprint, input);
    return { status: 'committed', value: claim, replayed: false, cursor: receipt.cursor };
  }

  async function readTaskClaim(ctx: CoreCallContext, ref: DispatchOutboxRef): Promise<ReadResult<TaskClaim>> {
    const ownedCtx = ownCallContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const scope = ownedCtx.ctx;
    if (!isRecord(ref) || ref.aggregateType !== 'DispatchOutboxEntry' || !nonEmpty(ref.projectId)
      || !nonEmpty(ref.goalId) || !nonEmpty(ref.taskId) || !nonEmpty(ref.attemptId)) {
      return reject('invalid', 'readTaskClaim requires a complete DispatchOutboxRef');
    }
    if (ref.projectId !== scope.projectId) return forbidden('the outbox entry belongs to another project');
    if (scope.signal.aborted) return reject('cancelled', 'the Task claim read was cancelled before the store read');
    let key: string;
    try {
      // Cycle / unsupported depth / non-JSON values are rejected here; only
      // this JSON boundary is guarded, never the Store read below.
      if (!isCanonicalJsonValue(ref)) return reject('invalid', 'the outbox ref is not canonicalizable JSON');
      key = dispatchOutboxRefKey(ref);
    } catch {
      return reject('invalid', 'the outbox ref is not canonicalizable JSON');
    }
    const read = await records.readMany([key]);
    if (read.status !== 'ready') return mapStoreFailure(read);
    if (scope.signal.aborted) return reject('cancelled', 'the Task claim read was cancelled during the store read');
    const record = read.value.records.find(candidate => candidate.refKey === key);
    if (record === undefined) return { status: 'not_found' };
    const decoded = decodeDispatchOutboxEntry(record);
    if (decoded.status !== 'decoded') return unavailable(`the outbox entry is damaged: ${decoded.reason}`);
    const outbox = decoded.value;
    if (outbox.ref.projectId !== scope.projectId) return forbidden('the outbox entry belongs to another project');
    if (outbox.claim.workspaceId !== scope.workspaceId) return forbidden('the outbox entry belongs to another workspace');
    return { status: 'ready', value: outbox.claim };
  }

  return { claimTask, readTaskClaim };
}
