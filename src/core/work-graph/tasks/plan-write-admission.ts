/**
 * W2 Agent delegated plan-write admission.
 *
 * The ONE narrow seam that turns a formal `work_run` caller into a real Agent
 * plan writer and re-checks the current Host/Role/Run/Session/Lease facts before
 * the existing Plan service commits. It reuses the B2 entry primitives
 * (`ExecutionEntryDependencies` reads/roles/bodies/authorize configuration) and
 * the two reviewed B2 helpers (`readStoredManifest`, `recheckHostRoleAdmission`)
 * read-only; it never borrows the model-call material/budget admission from
 * `admitEnteredRun`, which would make unrelated materials a whiteboard
 * prerequisite.
 *
 * Two ordered steps, so a terminal/revoked exact replay can still restore its
 * original receipt:
 *   1. `identifyPlanWriter` proves a stable Agent identity from the formal
 *      Run/outbox/Session association. It does NOT require the Run to still be
 *      running or the Session to still be active, and it consults no current
 *      configuration, so replay never depends on present permission.
 *   2. `authorizePlanWrite` is reached only after an exact receipt miss. It
 *      re-reads WG11 (never the identify snapshot) and rechecks the current
 *      V2-entered binding, health/ownership/generations, the pinned manifest,
 *      the operation grant and the trusted Host/Role configuration. It returns
 *      the real provenance plus every Store guard that admission actually
 *      observed; the Plan service commits once with those guards.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreError, ReadResult } from '../../../contracts/core/results.js';
import type { RoleBindingRefV1, RunRef } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { RecordGuard } from '../../record-store/ports.js';
import {
  isExecutionAuthorizationV2,
  inputBindingProblem,
} from '../persistence/execution-entry-codecs.js';
import {
  plainSessionRefToAggregate,
  sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { dispatchOutboxRefKey, taskAttemptRefKey } from './claim-record-codecs.js';
import type { ExecutionEntryDependencies } from './execution-entry-contracts.js';
import {
  mergeGuards,
  readStoredManifest,
  recheckHostRoleAdmission,
  sameRef,
} from './execution-entry-service.js';
import { planRevisionRefKey } from './plan-record-codecs.js';
import type { PlanWriteProvenanceV1 } from './plan-contracts.js';

/**
 * The four B2-owned dependencies the Agent admission may read. `records` is
 * intentionally absent: the Plan service keeps the single `records.commit`
 * and no second provider/authority object is created.
 */
export type PlanDelegatedWriteDependencies = Pick<ExecutionEntryDependencies,
  'reads' | 'roles' | 'bodies' | 'authorizeConfiguration'>;

/** The fixed delegated tool operations (the two whiteboard write tools). */
export type PlanWriteOperation = 'propose_future_plan' | 'apply_future_plan';

/** The exact formal writer identity `identifyPlanWriter` proves. */
export type AgentPlanWriter = {
  actor: Extract<ActorRef, { kind: 'agent' }>;
  runRef: RunRef;
  sessionRef: SessionRef;
  goalRef: GoalRef;
  workspaceId: string;
  roleBinding: RoleBindingRefV1;
};

/** The current authorization decision plus the exact versions it observed. */
export type PlanWriteAdmission = {
  provenance: PlanWriteProvenanceV1;
  guards: readonly RecordGuard[];
};

/** The fixed platform attribution of the internal Host-only WG11 read. */
const INTERNAL_READ_ACTOR = { kind: 'system' as const, id: 'w2-plan-write-admission' };

type Rejection = { status: 'rejected'; code: CoreError; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function forbidden(reason: string): Rejection {
  return { status: 'rejected', code: 'forbidden', reason };
}
function busy(reason: string): Rejection {
  return { status: 'rejected', code: 'busy', reason };
}
function unavailable(reason: string): Rejection {
  return { status: 'rejected', code: 'unavailable', reason };
}
function incomplete(reason: string): Rejection {
  return { status: 'rejected', code: 'incomplete', reason };
}
function mapReadFailure(result: Exclude<ReadResult<unknown>, { status: 'ready' }>): Rejection {
  if (result.status === 'not_found') return { status: 'rejected', code: 'not_found', reason: 'the target Run does not exist' };
  if (result.status === 'not_ready') return incomplete('the target Run is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason };
}
function runRefFromValue(value: unknown): RunRef | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Run') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) return null;
  return { aggregateType: 'Run', projectId: value['projectId'], goalId: value['goalId'], runId: value['runId'] };
}
function roleBindingFromValue(value: unknown): RoleBindingRefV1 | null {
  if (!isRecord(value) || value['schemaVersion'] !== 1) return null;
  if (!nonEmpty(value['bindingId']) || !nonEmpty(value['templateId'])
    || !nonEmpty(value['templateRevision']) || !nonEmpty(value['policyRevision'])) return null;
  const bindingVersion = value['bindingVersion'];
  if (typeof bindingVersion !== 'number' || !Number.isSafeInteger(bindingVersion) || bindingVersion < 0) return null;
  return { schemaVersion: 1, bindingId: value['bindingId'], templateId: value['templateId'],
    templateRevision: value['templateRevision'], bindingVersion, policyRevision: value['policyRevision'] };
}

/**
 * WG11 is a Host-only reader. The admission builds a fixed trusted platform
 * read context for the exact scope (same project/workspace/original signal and
 * a consistent Host material reader); this internal context is never handed to
 * the public Plan write methods.
 */
function internalReadContext(ctx: CoreCallContext, projectId: string, workspaceId: string): CoreCallContext {
  const actor = { kind: 'system' as const, id: INTERNAL_READ_ACTOR.id };
  return {
    projectId,
    workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor },
    signal: ctx.signal,
  } as CoreCallContext;
}

/**
 * Stable identity/admission step one. It synchronously snapshots the caller,
 * proves the work_run caller against the formal Run/outbox/Session association
 * and returns the actual actor, scoped Session ref and Role binding. It must not
 * require the Run to still be running or the Session to still be active, so a
 * finished or revoked exact replay can still restore its original receipt.
 */
export async function identifyPlanWriter(
  deps: Pick<PlanDelegatedWriteDependencies, 'reads'>,
  ctx: CoreCallContext,
  scope: { projectId: string; workspaceId: string },
): Promise<ReadResult<AgentPlanWriter>> {
  const raw = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown;
    materialReader?: unknown; signal?: unknown;
  } | null | undefined;
  if (raw === null || raw === undefined) return forbidden('a bound Agent work-run context is required');
  const projectId = raw.projectId;
  const workspaceId = raw.workspaceId;
  if (projectId !== scope.projectId) return forbidden('the Agent context is outside the requested project');
  if (!nonEmpty(workspaceId) || workspaceId !== scope.workspaceId) {
    return forbidden('the Agent context is outside the requested workspace');
  }
  const principal = raw.principal;
  if (!isRecord(principal) || principal['kind'] !== 'work_run') {
    return forbidden('Agent plan writes require a formal work-run principal');
  }
  const runRef = runRefFromValue(principal['runRef']);
  if (runRef === null || runRef.projectId !== projectId) {
    return forbidden('the work-run principal does not name a complete Run in this project');
  }
  const roleBinding = roleBindingFromValue(principal['roleBinding']);
  if (roleBinding === null) return forbidden('the work-run principal carries no complete Role binding');
  const materialReader = raw.materialReader;
  if (!isRecord(materialReader) || materialReader['kind'] !== 'run') {
    return forbidden('the Agent context does not carry a run material reader');
  }
  if (!sameRef(materialReader['requester'], runRef)) {
    return forbidden('the run material reader does not name this exact Run');
  }
  const signal = raw.signal;
  if (!isRecord(signal) || typeof signal['aborted'] !== 'boolean'
    || typeof signal['addEventListener'] !== 'function') {
    return forbidden('the Agent context does not carry the caller AbortSignal');
  }
  if (signal['aborted'] === true) return { status: 'rejected', code: 'cancelled', reason: 'the Agent identity read was cancelled' };

  const read = await deps.reads.readExecution(internalReadContext(ctx, projectId, workspaceId), runRef);
  if (read.status !== 'ready') return mapReadFailure(read);
  const facts = read.value;
  if (!sameRef(facts.run.ref, runRef) || !sameRef(facts.outbox.claim.runRef, runRef)) {
    return unavailable('the persisted Run/outbox association disagrees with the work-run principal');
  }
  if (facts.run.task.projectId !== projectId || facts.outbox.claim.workspaceId !== workspaceId) {
    return forbidden('the Run is scoped to another project or workspace');
  }
  if (!sameRef(facts.run.roleBinding, roleBinding)) {
    return forbidden('the work-run Role binding disagrees with the persisted Run');
  }
  const sessionRef = facts.outbox.claim.sessionRef;
  if (!sameRef(facts.session.ref, plainSessionRefToAggregate(sessionRef))) {
    return unavailable('the claim Session mapping changed');
  }
  const actor: Extract<ActorRef, { kind: 'agent' }> = {
    kind: 'agent',
    id: 'session:' + sha256Hex(canonicalJson(sessionRef as unknown as JsonValue)),
    runRef,
  };
  return { status: 'ready', value: {
    actor,
    runRef,
    sessionRef,
    goalRef: { aggregateType: 'Goal', projectId, goalId: facts.run.task.goalId },
    workspaceId,
    roleBinding,
  } };
}

/** The saved manifest must describe exactly the same formal claim/envelope/Session. */
function manifestAgainstRun(
  manifest: import('../../../contracts/core/prepared-execution.js').PreparedTaskManifestV1,
  facts: import('./execution-read-contracts.js').TaskExecutionRecord,
): Rejection | null {
  const { run, outbox, session } = facts;
  if (!sameRef(manifest.claim, outbox.claim)) return forbidden('the saved manifest claim disagrees with the persisted claim');
  if (!sameRef(manifest.roleBinding, run.roleBinding)) return forbidden('the saved manifest role binding disagrees with the Run');
  if (!sameRef(manifest.workspaceSnapshot, run.workspaceSnapshot)) {
    return forbidden('the saved manifest workspace snapshot disagrees with the Run');
  }
  if (!sameRef(manifest.budget, run.budget)) return forbidden('the saved manifest budget disagrees with the Run');
  if (run.envelope === null) return forbidden('the Run has no saved prepared envelope');
  if (!sameRef(manifest.permissions, run.envelope.permissions)) {
    return forbidden('the saved manifest permissions disagree with the Run envelope');
  }
  if (!sameRef(manifest.sessionRole, session.role)) {
    return forbidden('the saved manifest session role disagrees with the Session');
  }
  return null;
}

/**
 * Current-permission step two, reached only after an exact receipt lookup
 * misses. It re-reads the current WG11 facts (not the identify snapshot),
 * rechecks the pinned manifest through B2 `readStoredManifest` plus
 * `recheckHostRoleAdmission`, verifies the operation grant and derives all local
 * Store guards. It returns the real provenance and guards, never a boolean.
 */
export async function authorizePlanWrite(
  deps: PlanDelegatedWriteDependencies,
  ctx: CoreCallContext,
  input: { writer: AgentPlanWriter; operation: PlanWriteOperation },
): Promise<ReadResult<PlanWriteAdmission>> {
  let writer: AgentPlanWriter;
  try {
    writer = structuredClone(input.writer);
  } catch {
    return { status: 'rejected', code: 'invalid', reason: 'the Agent writer identity cannot be isolated from the caller' };
  }
  const projectId = writer.runRef.projectId;
  const workspaceId = writer.workspaceId;
  if (projectId !== ctx.projectId || workspaceId !== ctx.workspaceId) {
    return forbidden('the Agent writer scope disagrees with the call context');
  }
  const readCtx = internalReadContext(ctx, projectId, workspaceId);
  const read = await deps.reads.readExecution(readCtx, writer.runRef);
  if (read.status !== 'ready') return mapReadFailure(read);
  const facts = read.value;
  const { run, attempt, outbox, plan, session, lease } = facts;

  // The stable mapping identify proved must still hold on this fresh read.
  if (!sameRef(run.ref, writer.runRef) || !sameRef(outbox.claim.runRef, writer.runRef)) {
    return unavailable('the persisted Run/outbox association changed');
  }
  if (!sameRef(outbox.claim.sessionRef, writer.sessionRef)
    || !sameRef(session.ref, plainSessionRefToAggregate(writer.sessionRef))) {
    return forbidden('the persisted claim Session no longer matches the Agent writer');
  }
  if (!sameRef(run.roleBinding, writer.roleBinding)) {
    return forbidden('the persisted Role binding no longer matches the Agent writer');
  }
  if (run.task.projectId !== projectId || run.task.goalId !== writer.goalRef.goalId
    || outbox.claim.workspaceId !== workspaceId) {
    return forbidden('the Run is no longer scoped to the Agent writer goal/workspace');
  }

  // Current new-write permit: a real V2 entered binding on a running Run.
  const auth = run.executionAuthorization;
  if (!isExecutionAuthorizationV2(auth)) return forbidden('the Run has no formal V2 entry authorization');
  if (auth.phase !== 'entered') return forbidden('the Run entry is not in the entered phase');
  if (run.status !== 'running') return busy('the Run is not running');

  // Exact Attempt/outbox/claim generation agreement.
  if (attempt.runId !== run.ref.runId || attempt.ref.taskId !== run.task.taskId) {
    return unavailable('the claim-linked Attempt no longer belongs to this Run');
  }
  if (outbox.status !== 'entered') return busy('the claim outbox is not entered');
  const dispatch = outbox.dispatchState;
  if (dispatch === undefined || dispatch.phase !== 'entered') return busy('the claim outbox carries no entered dispatch state');
  if (dispatch.consumerId !== auth.consumerId || dispatch.entryGeneration !== auth.generation
    || dispatch.sessionGeneration !== auth.sessionGeneration) {
    return forbidden('the entered dispatch generation disagrees with the V2 entry binding');
  }
  if (auth.sessionGeneration !== outbox.claim.generation) {
    return forbidden('the V2 entry session generation disagrees with the claim');
  }

  // Healthy Session still occupied by this exact Run generation.
  if (session.lifecycle !== 'active') return busy('the claim Session is archived');
  if (session.health !== 'available') return busy('the claim Session is not available');
  const occupancy = session.occupancy;
  if (occupancy === null || occupancy.kind !== 'execution'
    || !sameRef(occupancy.executionRef, run.ref) || occupancy.generation !== outbox.claim.generation) {
    return busy('the claim Session is no longer occupied by this Run generation');
  }

  // Exact present, unreleased Lease held by this Run/Attempt/Task.
  if (lease === null) return busy('the claim TaskLease is missing; a missing lease is not free');
  if (lease.release !== undefined) return busy('the claim TaskLease was already released');
  if (lease.ref.projectId !== run.task.projectId || lease.ref.goalId !== run.task.goalId
    || lease.ref.taskId !== run.task.taskId) {
    return busy('the claim TaskLease names another Task');
  }
  if (lease.holderRunId !== run.ref.runId || lease.attemptId !== attempt.ref.attemptId) {
    return busy('the claim TaskLease is held by another attempt');
  }

  // The pinned manifest body/input digests must still be the Run's exact binding.
  const inputBinding = run.inputBinding;
  if (inputBinding === undefined) return forbidden('the Run has no persisted input binding');
  const bindingProblem = inputBindingProblem(inputBinding);
  if (bindingProblem !== null) return unavailable(`the Run input binding is damaged: ${bindingProblem}`);
  const stored = await readStoredManifest({ bodies: deps.bodies }, run);
  if (!stored.ok) return { status: 'rejected', code: stored.rejection.code, reason: stored.rejection.reason };
  const manifest = stored.value.manifest;
  const manifestProblem = manifestAgainstRun(manifest, facts);
  if (manifestProblem !== null) return manifestProblem;
  if (stored.value.bodyDigest !== inputBinding.manifestDigest) {
    return forbidden('the saved manifest body digest disagrees with the Run input binding');
  }
  if (manifest.inputDigest !== inputBinding.inputDigest || manifest.inputDigest !== auth.inputDigest) {
    return forbidden('the saved manifest input digest disagrees with the Run entry binding');
  }

  // The concrete operation must be inside the current Host/envelope grant and
  // the current role ceiling (the resolver checks declared permissions).
  if (!manifest.permissions.tools.includes(input.operation)) {
    return forbidden(`the current Host/Role grant does not include ${input.operation}`);
  }
  const hostRole = await recheckHostRoleAdmission(
    { roles: deps.roles, authorizeConfiguration: deps.authorizeConfiguration },
    readCtx,
    {
      run,
      manifestRole: manifest.role,
      sessionRole: session.role,
      roleBinding: run.roleBinding,
      permissions: manifest.permissions,
      hostTemplate: manifest.hostTemplate,
      configurationRevision: manifest.hostConfigurationRevision,
    },
  );
  if (!hostRole.ok) return { status: 'rejected', code: hostRole.rejection.code, reason: hostRole.rejection.reason };

  const provenance: PlanWriteProvenanceV1 = {
    schemaVersion: 1,
    runRef: writer.runRef,
    sessionRef: writer.sessionRef,
    roleBinding: writer.roleBinding,
    sessionGeneration: auth.sessionGeneration,
    entryGeneration: auth.generation,
    authorizationRevision: auth.revision,
    configurationRevision: manifest.hostConfigurationRevision,
  };
  const merged = mergeGuards([
    { refKey: canonicalJson(run.ref as unknown as JsonValue), expectedRevision: run.revision },
    { refKey: taskAttemptRefKey(attempt.ref), expectedRevision: attempt.revision },
    { refKey: dispatchOutboxRefKey(outbox.ref), expectedRevision: outbox.revision },
    { refKey: planRevisionRefKey(plan.ref), expectedRevision: plan.revision },
    { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(writer.sessionRef)), expectedRevision: session.revision },
    { refKey: canonicalJson(lease.ref as unknown as JsonValue), expectedRevision: lease.revision },
    ...hostRole.value.roleFacts.guards,
  ]);
  if (!merged.ok) return { status: 'rejected', code: merged.rejection.code, reason: merged.rejection.reason };
  return { status: 'ready', value: { provenance, guards: merged.guards } };
}
