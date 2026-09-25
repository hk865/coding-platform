/** Migrated R2c/R2d guards. Reads accepted facts through WorkGraph; this component
 * does not create/dispatch Runs. Target lifecycle consumers are still to be wired. */
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { WorkspaceRef } from '../../contracts/ledger.js';
import type { SourceAuthorityReads, SourceSnapshotReads, SourceSnapshotResult } from '../work-graph/source-authority-ports.js';
import { seqOfCommitCursor } from '../../contracts/ledger.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ActorRef, CommitCursor } from '../../contracts/command-event.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskAttemptRef } from '../../contracts/dispatch.js';
import type { SourceRunSpec } from './source-binding-types.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { QueryExecutionRequest } from '../../contracts/query-execution-context.js';
import type { QueryJobIntentV1, QueryJobRef, QueryJobSnapshot, QueryRunRef, QueryRunSnapshot } from '../../contracts/query-job.js';
import { queryJobRefFor, validQueryExecution } from '../../contracts/query-job.js';
import type { ReviewerProfileV1 } from '../../contracts/reviewer-context.js';
import type { ReviewInputBinding, ReviewWorkBinding, ReviewWorkRef, ReviewWorkSnapshot } from '../../contracts/reviewer-work.js';
import { createWorkspaceAccessFactory, type WorkspaceAccessFactory } from '../workspace/access.js';
import { reviewerSourcePathAllowed } from '../workspace/reviewer-source-reader.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../workspace/workspace-tools.js';
import type { WorkspaceResult } from '../workspace/ports.js';
import type { RuntimeSourceCaptureAccess, RuntimeSourceCaptureFactory } from './source-tool-ports.js';

/** Trusted, narrow policy for one registered mount; never handed to the model. */
export type SourcePolicy = { root: string; permissionRevision: string; allowsRead(path: string): boolean };

const rejected = <T>(code: 'forbidden' | 'not_found' | 'cancelled' | 'unavailable' | 'unsupported' | 'invalid', reason: string): WorkspaceResult<T> => ({ status: 'rejected', code, reason });
const copyWorkspace = (workspace: WorkspaceRef): WorkspaceRef => ({ aggregateType: 'Workspace', projectId: workspace.projectId, workspaceId: workspace.workspaceId });

/** `unavailable`/`unsupported` keep their own name on every consumption path; a genuine
 * absence uses the consumer's existing code (`forbidden` for a subject, `not_found` for a
 * mount). An unreadable record must never be folded into "not found" or "no permission". */
function loadRejection(
  result: Extract<SourceSnapshotResult, { status: 'not_found' | 'unavailable' | 'unsupported' }>,
  missing: 'forbidden' | 'not_found',
  absentReason: string,
): WorkspaceResult<never> {
  if (result.status === 'not_found') return rejected(missing, absentReason);
  if (result.status === 'unavailable') return rejected('unavailable', result.reason);
  return rejected('unsupported', result.reason);
}

/** Leaf-field safety for the only `envelope.permissions` fields consumed here. This is not a
 * full TaskEnvelope validator: a null envelope is the existing "no grant" denial, while a
 * present-but-damaged permissions object is an unreadable fact. */
type RunPermissionLeaves = { policyRevision: string; tools: string[]; writeScope: string[] };
function readEnvelopePermissions(envelope: TaskEnvelopeV1 | null): WorkspaceResult<RunPermissionLeaves> {
  if (!envelope) return rejected('forbidden', 'the bound Run has no recorded envelope');
  const permissions = (envelope as { permissions?: unknown }).permissions;
  if (permissions === null || typeof permissions !== 'object' || Array.isArray(permissions))
    return rejected('unavailable', 'the recorded envelope permissions are unavailable');
  const record = permissions as Record<string, unknown>;
  const policyRevision = record['policyRevision'];
  if (typeof policyRevision !== 'string' || policyRevision.length === 0)
    return rejected('unavailable', 'the recorded envelope policy revision is unavailable');
  const tools = record['tools'];
  if (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string'))
    return rejected('unavailable', 'the recorded envelope tool grant is unavailable');
  const writeScope = record['writeScope'];
  if (!Array.isArray(writeScope) || writeScope.some(entry => typeof entry !== 'string'))
    return rejected('unavailable', 'the recorded envelope write scope is unavailable');
  return { status: 'ready', value: { policyRevision, tools: tools as string[], writeScope: writeScope as string[] } };
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Narrow completeness checks for exactly the envelope identity leaves the runtime consumes.
 * This is not a TaskEnvelope codec: a damaged leaf is an unreadable fact (`unavailable`), while
 * a complete leaf that differs from the prepared binding keeps the existing `forbidden` path. */
function isCompleteRunRef(value: unknown): value is RunRef {
  if (!isPlainObject(value)) return false;
  return value['aggregateType'] === 'Run' && isNonEmptyString(value['projectId'])
    && isNonEmptyString(value['goalId']) && isNonEmptyString(value['runId']);
}
function isCompleteAttemptRef(value: unknown): value is TaskAttemptRef {
  if (!isPlainObject(value)) return false;
  return value['aggregateType'] === 'TaskAttempt' && isNonEmptyString(value['projectId'])
    && isNonEmptyString(value['goalId']) && isNonEmptyString(value['taskId']) && isNonEmptyString(value['attemptId']);
}
function isCompleteRoleBinding(value: unknown): value is RoleBindingRefV1 {
  if (!isPlainObject(value)) return false;
  return value['schemaVersion'] === 1 && isNonEmptyString(value['bindingId'])
    && isNonEmptyString(value['templateId']) && isNonEmptyString(value['templateRevision'])
    && Number.isSafeInteger(value['bindingVersion']) && (value['bindingVersion'] as number) > 0
    && isNonEmptyString(value['policyRevision']);
}

type RunEnvelopeIdentity = { runRef: RunRef; attemptRef: TaskAttemptRef; roleBinding: RoleBindingRefV1 };
function readEnvelopeIdentity(envelope: TaskEnvelopeV1): WorkspaceResult<RunEnvelopeIdentity> {
  const record = envelope as unknown as Record<string, unknown>;
  const runRef = record['runRef'];
  const attemptRef = record['attemptRef'];
  const roleBinding = record['roleBinding'];
  if (!isCompleteRunRef(runRef) || !isCompleteAttemptRef(attemptRef) || !isCompleteRoleBinding(roleBinding))
    return rejected('unavailable', 'the recorded envelope identity is unavailable');
  return { status: 'ready', value: { runRef, attemptRef, roleBinding } };
}

/** Trusted live binding copied once from a prepared Work RunSpec/TaskEnvelope (R2d.2). */
type WorkSourceBinding = {
  kind: 'work';
  mode?: 'explore' | 'review';
  /** Exact root copied from the prepared spec; never re-derived from the request. */
  root: string;
  workspace: WorkspaceRef;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  roleBinding: RoleBindingRefV1;
  review?: {
    workRef: ReviewWorkRef;
    profile: ReviewerProfileV1;
    work: ReviewWorkBinding;
    input: ReviewInputBinding;
  };
};

/** Trusted live binding for one accepted QueryRun (R2d.3). The original initiator is resolved
 * once from the canonical QueryJobSubmitted event, never from a dispatcher or a fixed actor. */
type QuerySourceBinding = {
  kind: 'query';
  root: string;
  workspace: WorkspaceRef;
  queryRunRef: QueryRunRef;
  jobRef: QueryJobRef;
  request: QueryExecutionRequest;
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  execution: NonNullable<QueryJobIntentV1['execution']>;
};

/**
 * Trusted live binding for one model loop. Only the two runtime factories supply it. Without it
 * the R2c architecture reader keeps its original semantics, including reading material from a
 * Run that has already ended.
 */
type RuntimeSourceBinding = WorkSourceBinding | QuerySourceBinding;

/**
 * Production Host bridge for WorkspaceTools: resolves the real mount root and the current
 * Workspace revision from the ledger, and authorizes each caller from its real identity —
 * host actor, or a work Run whose exact RoleBinding and `read` grant are re-read from the
 * ledger. There is no unconditional `system` path and no rootFor-only fallback.
 *
 * With `runtime`, the same single Run load is also held to the live eligibility and Reviewer
 * binding rules; a different (even legitimate) registered root cannot replace the prepared one.
 */
export function createSourceCaptureAccess(deps: {
  authority: () => SourceSnapshotReads;
  sourcePolicyFor: (projectId: string, workspaceId: string) => Promise<SourcePolicy | null>;
  /** Host lifecycle signal: stopping rejects new opens. */
  signal: AbortSignal;
  /** Trusted live binding for one model loop; absent keeps the R2c architecture-reader path. */
  runtime?: RuntimeSourceBinding;
}): WorkspaceAccessFactory {
  const stopping = () => deps.signal.aborted;
  return createWorkspaceAccessFactory({
    async resolveRoot(workspace: WorkspaceRef) {
      if (stopping()) return rejected('cancelled', 'host is stopping');
      const policy = await deps.sourcePolicyFor(workspace.projectId, workspace.workspaceId);
      if (!policy) return rejected('not_found', 'workspace mount is not registered');
      // The prepared run is bound to the exact root that was registered for it. Another
      // otherwise-legitimate mount, or a link rebound after preparation, must not stand in.
      if (deps.runtime && policy.root !== deps.runtime.root)
        return rejected('forbidden', 'registered workspace root changed since the run was prepared');
      const current = await deps.authority().load(workspace);
      if (current.status !== 'found') return loadRejection(current, 'not_found', 'workspace record not found');
      if (current.snapshot.ref.aggregateType !== 'Workspace') return rejected('not_found', 'workspace record not found');
      return { status: 'ready', value: { root: policy.root, workspaceRevision: current.snapshot.revision } };
    },
    async authorize(ctx: CoreCallContext, workspace: WorkspaceRef) {
      if (stopping()) return rejected('cancelled', 'host is stopping');
      if (ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId)
        return rejected('forbidden', 'call context scope does not match the requested workspace');
      const policy = await deps.sourcePolicyFor(workspace.projectId, workspace.workspaceId);
      if (!policy) return rejected('not_found', 'workspace mount is not registered');
      // The exact prepared root holds for the fresh authorization read too: a policy that
      // switched to another (even legitimate) mount between resolveRoot and here must not
      // authorize the previously resolved root.
      const runtime = deps.runtime;
      if (runtime && policy.root !== runtime.root)
        return rejected('forbidden', 'registered workspace root changed since the run was prepared');
      const ledger = deps.authority();
      // A Query binding has its own complete identity/qualification path; it must never be run
      // through the work-only Run authorization below.
      if (runtime?.kind === 'query') {
        const live = await authorizeQuerySubject(ledger, runtime, ctx, policy);
        if (live.status !== 'ready') return live;
        return { status: 'ready', value: live.value };
      }
      const subject = await authorizeSubject(ledger, ctx, workspace);
      if (subject.status !== 'ready') return subject;
      if (!runtime) {
        return { status: 'ready', value: {
          subjectKey: subject.value.subjectKey,
          // Normed from the real mount/private policy and the caller's real read grant; never from content digests.
          permissionRevision: sha256Hex(canonicalJson([policy.permissionRevision, subject.value.grantRevision])),
          allowsRead: policy.allowsRead,
        } };
      }
      // Reuse the Run snapshot loaded above for the common identity/read checks; the live
      // policy rules never trigger a second Run load in the same request.
      const live = await authorizeRuntimeSubject(ledger, runtime, subject.value.run, policy, workspace);
      if (live.status !== 'ready') return live;
      return { status: 'ready', value: live.value };
    },
  });
}

/**
 * One prepared model loop's own capture capability. The factory only validates and copies the
 * trusted binding; `open(runSignal)` re-checks the current eligibility, takes a fresh short-lived
 * access for that check, releases it, and then creates a registry owned exclusively by this loop.
 */
export function createRuntimeSourceCaptureFactory(
  deps: {
    authority: () => SourceSnapshotReads;
    sourcePolicyFor?: (projectId: string, workspaceId: string) => Promise<SourcePolicy | null>;
    hostSignal: AbortSignal;
    now: () => string;
  },
  spec: SourceRunSpec,
  envelope: TaskEnvelopeV1,
): RuntimeSourceCaptureFactory {
  const binding = copyRuntimeSourceBinding(spec, envelope);
  const sourcePolicyFor = deps.sourcePolicyFor;
  const hostSignal = deps.hostSignal;
  return async runSignal => {
    runSignal.throwIfAborted();
    if (hostSignal.aborted) throw Error('host is stopping; source capture is unavailable');
    // A missing trusted policy fails explicitly; it never falls back to the legacy live index.
    if (!sourcePolicyFor) throw Error('trusted workspace source policy is unavailable for this run');
    const access = createSourceCaptureAccess({ authority: deps.authority, sourcePolicyFor, signal: hostSignal, runtime: binding });
    return openOwnedSourceAccess({ access, workspace: binding.workspace, runSignal, now: deps.now,
      context: workSourceContext(binding, runSignal, hostSignal) });
  };
}

/** Every returned DTO is a fresh copy: a caller mutating what it received can never rewrite
 * the loop's private binding or affect another request. Host + run + tool signals combine so
 * cancelling one tool never cancels the loop. */
function workSourceContext(binding: WorkSourceBinding, runSignal: AbortSignal, hostSignal: AbortSignal) {
  return (signal: AbortSignal): CoreCallContext => ({
    projectId: binding.workspace.projectId,
    workspaceId: binding.workspace.workspaceId,
    principal: { kind: 'work_run', runRef: structuredClone(binding.runRef), roleBinding: structuredClone(binding.roleBinding) },
    materialReader: { kind: 'run', requester: structuredClone(binding.runRef) },
    signal: AbortSignal.any([signal, runSignal, hostSignal]),
  });
}

/**
 * One accepted QueryRun's own capture capability (R2d.3). The factory validates and copies the
 * complete execution request synchronously; the original initiator is resolved once from the
 * canonical QueryJobSubmitted event on the first open, then every request re-checks the current
 * QueryRun/QueryJob, role, execution request, root and Host policy.
 */
export function createQuerySourceCaptureFactory(
  deps: {
    authority: () => SourceAuthorityReads;
    sourcePolicyFor?: (projectId: string, workspaceId: string) => Promise<SourcePolicy | null>;
    hostSignal: AbortSignal;
    now: () => string;
  },
  request: QueryExecutionRequest,
  root: string,
): RuntimeSourceCaptureFactory {
  const copied = copyQueryExecutionRequest(request);
  if (typeof root !== 'string' || root.length === 0)
    throw Error('query source binding requires the Kernel workspace root');
  const sourcePolicyFor = deps.sourcePolicyFor;
  const hostSignal = deps.hostSignal;
  // Single-flight origin resolution for this factory. The resolution is cached only while the
  // initialization that uses it succeeds; a failed or cancelled initialization clears it so the
  // next open re-resolves instead of reusing a scan that never produced a usable capability.
  let origin: Promise<QueryOrigin> | undefined;
  return async runSignal => {
    runSignal.throwIfAborted();
    if (hostSignal.aborted) throw Error('host is stopping; source capture is unavailable');
    // A missing trusted policy fails explicitly; it never falls back to the legacy live index.
    if (!sourcePolicyFor) throw Error('trusted workspace source policy is unavailable for this query');
    try {
      if (!origin) origin = resolveQueryOrigin(deps.authority(), copied, hostSignal, runSignal);
      const resolved = await origin;
      const binding: QuerySourceBinding = {
        kind: 'query', root,
        workspace: { aggregateType: 'Workspace', projectId: copied.runRef.projectId, workspaceId: copied.runRef.workspaceId },
        queryRunRef: structuredClone(copied.runRef), jobRef: structuredClone(resolved.jobRef), request: copied,
        actor: structuredClone(resolved.actor), execution: structuredClone(resolved.execution),
      };
      const access = createSourceCaptureAccess({ authority: deps.authority, sourcePolicyFor, signal: hostSignal, runtime: binding });
      return await openOwnedSourceAccess({ access, workspace: binding.workspace, runSignal, now: deps.now,
        context: querySourceContext(binding, runSignal, hostSignal) });
    } catch (error) {
      origin = undefined;
      throw error;
    }
  };
}

function querySourceContext(binding: QuerySourceBinding, runSignal: AbortSignal, hostSignal: AbortSignal) {
  return (signal: AbortSignal): CoreCallContext => ({
    projectId: binding.workspace.projectId,
    workspaceId: binding.workspace.workspaceId,
    principal: { kind: 'query_run', queryRunRef: structuredClone(binding.queryRunRef), initiator: structuredClone(binding.actor) },
    materialReader: { kind: 'run', requester: structuredClone(binding.queryRunRef) },
    signal: AbortSignal.any([signal, runSignal, hostSignal]),
  });
}

/**
 * Shared mechanical lifecycle for one loop-owned capture capability: a fresh short-lived
 * qualification access (always released), the loop's own registry, copied DTOs, combined
 * signals and an idempotent close. Closing never touches a shared architecture handle or
 * another loop's registry.
 */
async function openOwnedSourceAccess(params: {
  access: WorkspaceAccessFactory;
  workspace: WorkspaceRef;
  context: (signal: AbortSignal) => CoreCallContext;
  runSignal: AbortSignal;
  now: () => string;
}): Promise<RuntimeSourceCaptureAccess> {
  const { access, workspace, context, runSignal, now } = params;
  const probe = await access.open(context(runSignal), workspace);
  if (probe.status !== 'ready') throw Error('source capture is unavailable: ' + probe.code + ': ' + probe.reason);
  try { /* qualification only; the loop gets its own registry below */ }
  finally { await probe.value.release(); }
  const handle = createWorkspaceTools({ access, now, limits: DEFAULT_WORKSPACE_LIMITS });
  try {
    return {
      port: handle.tools,
      // A copy, not the private binding: returned DTOs stay caller-owned.
      workspace: copyWorkspace(workspace),
      context,
      async currentWorkspaceRevision(signal: AbortSignal): Promise<WorkspaceResult<number>> {
        const opened = await access.open(context(signal), workspace);
        if (opened.status !== 'ready') return opened;
        try { return { status: 'ready', value: opened.value.workspaceRevision }; }
        finally { await opened.value.release(); }
      },
      close: () => handle.close(),
    };
  } catch (error) {
    // The factory failed after creating the registry: close it first, keep the original error.
    await handle.close().catch(() => {});
    throw error;
  }
}

function copyQueryExecutionRequest(request: QueryExecutionRequest): QueryExecutionRequest {
  if (!request || typeof request !== 'object') throw Error('query source binding requires the accepted execution request');
  const runRef = request.runRef;
  if (!runRef || runRef.aggregateType !== 'QueryRun' || typeof runRef.projectId !== 'string' || !runRef.projectId
      || typeof runRef.workspaceId !== 'string' || !runRef.workspaceId
      || typeof runRef.queryJobId !== 'string' || !runRef.queryJobId || typeof runRef.runId !== 'string' || !runRef.runId)
    throw Error('query source binding requires a real QueryRun reference');
  if (typeof request.question !== 'string' || !request.question) throw Error('query source binding requires the recorded question');
  if (!request.budget || !Number.isSafeInteger(request.budget.maxTokens) || request.budget.maxTokens < 1)
    throw Error('query source binding requires the recorded budget');
  const bundle = request.bundleRef;
  if (!bundle || bundle.kind !== 'artifact' || typeof bundle.digest !== 'string' || !bundle.digest
      || !Number.isSafeInteger(bundle.sizeBytes) || typeof bundle.contentType !== 'string' || !bundle.contentType || !bundle.source)
    throw Error('query source binding requires the recorded context bundle reference');
  // Deep copy: later caller mutation cannot rewrite the bound request.
  return structuredClone(request);
}

function copyRuntimeSourceBinding(spec: SourceRunSpec, envelope: TaskEnvelopeV1): WorkSourceBinding {
  if (typeof spec.root !== 'string' || spec.root.length === 0)
    throw Error('runtime source binding requires the prepared workspace root');
  if (envelope.runRef.aggregateType !== 'Run')
    throw Error('runtime source binding requires a real Run reference');
  if (envelope.runRef.projectId !== envelope.projectId || envelope.runRef.goalId !== envelope.goalId)
    throw Error('runtime source binding Run reference does not match the envelope scope');
  if (spec.projectId !== envelope.projectId || spec.workspaceId !== envelope.workspaceId
      || spec.goalId !== envelope.goalId || spec.taskId !== envelope.taskId || spec.runId !== envelope.runRef.runId)
    throw Error('runtime source binding does not match the prepared RunSpec');
  if (envelope.attemptRef.projectId !== envelope.projectId || envelope.attemptRef.goalId !== envelope.goalId
      || envelope.attemptRef.taskId !== envelope.taskId)
    throw Error('runtime source binding attempt does not match the envelope scope');
  if (envelope.workspaceSnapshot.workspaceId !== spec.workspaceId)
    throw Error('runtime source binding workspace snapshot does not match the prepared scope');
  const binding: WorkSourceBinding = {
    kind: 'work',
    ...(spec.mode ? { mode: spec.mode } : {}),
    root: spec.root,
    workspace: { aggregateType: 'Workspace', projectId: spec.projectId, workspaceId: spec.workspaceId },
    // Deep copies: later mutation of the caller's spec/envelope cannot change this binding.
    runRef: structuredClone(envelope.runRef),
    attemptRef: structuredClone(envelope.attemptRef),
    roleBinding: structuredClone(envelope.roleBinding),
  };
  if (spec.mode !== 'review' && (spec.review !== undefined || envelope.work !== undefined || envelope.reviewInput !== undefined))
    throw Error('runtime source binding carries review material for a non-review RunSpec');
  if (spec.mode === 'review') {
    const review = spec.review;
    if (!review || review.workRef.aggregateType !== 'ReviewWork'
        || review.workRef.projectId !== spec.projectId || review.workRef.workspaceId !== spec.workspaceId || review.workRef.goalId !== spec.goalId)
      throw Error('review source binding requires the accepted ReviewWork in the prepared scope');
    if (!envelope.work || envelope.work.kind !== 'review' || canonicalJson(envelope.work.reviewWorkRef) !== canonicalJson(review.workRef))
      throw Error('review source binding envelope work does not match the prepared ReviewWork');
    if (!envelope.reviewInput)
      throw Error('review source binding requires the recorded review input');
    binding.review = {
      workRef: structuredClone(review.workRef),
      profile: structuredClone(review.profile),
      work: structuredClone(envelope.work),
      input: structuredClone(envelope.reviewInput),
    };
  }
  return binding;
}

type RuntimeSubject = { subjectKey: string; permissionRevision: string; allowsRead: (path: string) => boolean };

async function authorizeRuntimeSubject(
  ledger: SourceSnapshotReads,
  binding: WorkSourceBinding,
  run: RunSnapshot,
  policy: SourcePolicy,
  workspace: WorkspaceRef,
): Promise<WorkspaceResult<RuntimeSubject>> {
  const denied = (reason: string): WorkspaceResult<never> => rejected('forbidden', reason);
  // The live record must still be exactly the prepared Run and eligible to be read.
  if (canonicalJson(run.ref) !== canonicalJson(binding.runRef)) return denied('the bound Run identity changed since preparation');
  if (run.status !== 'running' || (run.outcome ?? null) !== null) return denied('the bound Run is not running without an outcome');
  const desired = run.controlState?.desiredState;
  if (desired !== undefined && desired !== 'running' && desired !== 'steered') return denied('the bound Run desired state is ' + desired);
  const phase = run.executionAuthorization?.phase;
  if (phase !== undefined && phase !== 'entered') return denied('the bound Run execution authorization is ' + phase);
  const envelope = run.envelope;
  if (!envelope) return denied('the bound Run has no recorded envelope');
  // A real stored Run may keep an object envelope whose consumed identity leaves are absent
  // (the record codec only proves envelope is an object). Leaf-check them before canonicalJson
  // so a damaged identity is `unavailable`, while a complete but different one stays forbidden.
  const identity = readEnvelopeIdentity(envelope);
  if (identity.status !== 'ready') return identity;
  if (canonicalJson(identity.value.runRef) !== canonicalJson(binding.runRef)) return denied('the recorded envelope Run does not match the prepared binding');
  if (canonicalJson(identity.value.attemptRef) !== canonicalJson(binding.attemptRef)) return denied('the recorded envelope attempt does not match the prepared binding');
  if (canonicalJson(identity.value.roleBinding) !== canonicalJson(binding.roleBinding)) return denied('the recorded envelope role does not match the prepared binding');
  // Leaf-check the permissions actually consumed below; a damaged grant object is an
  // unreadable fact, never a TypeError and never an expanded permission.
  const permissions = readEnvelopePermissions(envelope);
  if (permissions.status !== 'ready') return permissions;
  if (run.attemptId !== binding.attemptRef.attemptId) return denied('the bound Run attempt changed since preparation');
  if (run.ref.projectId !== workspace.projectId || run.workspaceSnapshot.workspaceId !== workspace.workspaceId)
    return denied('the bound Run scope does not match the requested workspace');
  if (!permissions.value.tools.includes('read')) return denied('the bound Run has no current read grant');
  if (binding.mode !== 'review' && (run.work !== undefined || envelope.work !== undefined || envelope.reviewInput !== undefined))
    return denied('the bound Run carries review material outside a review binding');
  let review: { workRef: ReviewWorkRef; role: RoleBindingRefV1; profile: ReviewerProfileV1; inputDigest: string } | undefined;
  if (binding.mode === 'review') {
    const checked = await authorizeReviewWork(ledger, binding, run, envelope);
    if (checked.status !== 'ready') return checked;
    review = checked.value;
  }
  return { status: 'ready', value: {
    // Complete real RunRef + RoleBinding; never the Run/Workspace revision or content digests.
    subjectKey: 'work_run:' + sha256Hex(canonicalJson([run.ref, run.roleBinding])),
    permissionRevision: sha256Hex(canonicalJson({
      policy: 'runtime-source-live-v1',
      role: run.roleBinding,
      permissions: permissions.value,
      mount: policy.permissionRevision,
      ...(review ? { review: { workRef: review.workRef, role: review.role, profile: review.profile, input: review.inputDigest, range: 'reviewer-candidate-v1' } } : {}),
    })),
    // Reviewer reads intersect the Host path policy with the candidate exclusions at every
    // path segment, so indirect TS imports, inventory and reads share one range.
    allowsRead: review ? (path: string) => policy.allowsRead(path) && reviewerSourcePathAllowed(path) : policy.allowsRead,
  } };
}

async function authorizeReviewWork(
  ledger: SourceSnapshotReads,
  binding: WorkSourceBinding,
  run: RunSnapshot,
  envelope: TaskEnvelopeV1,
): Promise<WorkspaceResult<{ workRef: ReviewWorkRef; role: RoleBindingRefV1; profile: ReviewerProfileV1; inputDigest: string }>> {
  const review = binding.review;
  if (!review) return rejected('forbidden', 'the review source binding is incomplete');
  if (canonicalJson(review.profile.permissions) !== canonicalJson({ tools: ['read'], writeScope: [] }))
    return rejected('forbidden', 'the Reviewer profile is not read-only');
  // The current recorded envelope must still carry the same review input and read-only grant.
  if (canonicalJson(envelope.reviewInput ?? null) !== canonicalJson(review.input))
    return rejected('forbidden', 'the recorded envelope review input does not match the prepared review input');
  const permissions = readEnvelopePermissions(envelope);
  if (permissions.status !== 'ready') return permissions;
  if (permissions.value.tools.length === 0 || permissions.value.tools.some(tool => tool !== 'read') || permissions.value.writeScope.length !== 0)
    return rejected('forbidden', 'the Reviewer run permissions are not read-only');
  if (run.work?.kind !== 'review' || canonicalJson(run.work.reviewWorkRef) !== canonicalJson(review.workRef))
    return rejected('forbidden', 'the bound Run work does not match the prepared ReviewWork');
  if (envelope.work?.kind !== 'review' || canonicalJson(envelope.work.reviewWorkRef) !== canonicalJson(review.workRef))
    return rejected('forbidden', 'the recorded envelope work does not match the prepared ReviewWork');
  const loaded = await ledger.load(review.workRef);
  if (loaded.status !== 'found') return loadRejection(loaded, 'forbidden', 'the accepted ReviewWork is not retained');
  if (loaded.snapshot.ref.aggregateType !== 'ReviewWork')
    return rejected('forbidden', 'the accepted ReviewWork is not retained');
  const work = loaded.snapshot as ReviewWorkSnapshot;
  if (canonicalJson(work.ref) !== canonicalJson(review.workRef)) return rejected('forbidden', 'the ReviewWork identity changed');
  // The Reviewer's own Run/attempt, never the producer in the profile subject scope.
  if (canonicalJson(work.reviewerRunRef) !== canonicalJson(binding.runRef)
      || canonicalJson(work.reviewerAttemptRef) !== canonicalJson(binding.attemptRef))
    return rejected('forbidden', 'the ReviewWork is bound to another Reviewer Run');
  if (canonicalJson(work.roleBinding) !== canonicalJson(binding.roleBinding))
    return rejected('forbidden', 'the ReviewWork role does not match the bound Reviewer Run');
  if (canonicalJson(work.reviewerProfile) !== canonicalJson(review.profile))
    return rejected('forbidden', 'the ReviewWork profile does not match the prepared Reviewer profile');
  if (!work.input || canonicalJson(work.input) !== canonicalJson(review.input))
    return rejected('forbidden', 'the ReviewWork input does not match the recorded review input');
  if (work.descriptor.materialIdentity.workspaceRoot !== binding.root)
    return rejected('forbidden', 'the ReviewWork candidate root does not match the prepared workspace root');
  return { status: 'ready', value: { workRef: work.ref, role: work.roleBinding, profile: work.reviewerProfile, inputDigest: work.input.inputDigest } };
}

async function authorizeSubject(ledger: SourceSnapshotReads, ctx: CoreCallContext, workspace: WorkspaceRef): Promise<WorkspaceResult<{ subjectKey: string; grantRevision: string; run: RunSnapshot }>> {
  const principal = ctx.principal;
  // Positively require the one identity kind this bridge authorizes. An unrecognized kind must
  // not be admitted by elimination of the other known variants, and it must never reach sandbox
  // creation. Host/query_run keep their existing explicit rejection.
  if (principal.kind !== 'work_run') return rejected('forbidden', 'source reads require an accepted work_run principal');
  const loaded = await ledger.load(principal.runRef);
  if (loaded.status !== 'found') return loadRejection(loaded, 'forbidden', 'reader Run not found');
  if (loaded.snapshot.ref.aggregateType !== 'Run') return rejected('forbidden', 'reader Run not found');
  const run = loaded.snapshot as RunSnapshot;
  if (run.ref.projectId !== workspace.projectId || run.workspaceSnapshot.workspaceId !== workspace.workspaceId)
    return rejected('forbidden', 'reader Run belongs to another workspace');
  if (canonicalJson(run.roleBinding) !== canonicalJson(principal.roleBinding))
    return rejected('forbidden', 'reader Run role binding does not match the trusted context');
  const permissions = readEnvelopePermissions(run.envelope);
  if (permissions.status !== 'ready') return permissions;
  if (!permissions.value.tools.includes('read')) return rejected('forbidden', 'reader Run has no read grant');
  if (ctx.materialReader.kind !== 'run' || ctx.materialReader.requester.aggregateType !== 'Run' ||
      ctx.materialReader.requester.projectId !== run.ref.projectId || ctx.materialReader.requester.goalId !== run.ref.goalId || ctx.materialReader.requester.runId !== run.ref.runId)
    return rejected('forbidden', 'material reader must be the same reader Run');
  const binding = principal.roleBinding;
  return { status: 'ready', value: {
    // Length-framed (canonical JSON) so opaque identifiers containing separators cannot collide.
    subjectKey: 'work_run:' + sha256Hex(canonicalJson([run.ref.projectId, run.ref.goalId, run.ref.runId, binding.bindingId, binding.bindingVersion])),
    // The current canonical role binding plus the Run's real read grant/policy — not the
    // ctx-declared fields alone and never a content digest.
    grantRevision: canonicalJson({
      roleBinding: { bindingId: binding.bindingId, bindingVersion: binding.bindingVersion, policyRevision: binding.policyRevision },
      readPolicyRevision: permissions.value.policyRevision,
      tools: [...permissions.value.tools].sort(),
      writeScope: [...permissions.value.writeScope].sort(),
    }),
    run,
  } };
}

type QueryOrigin = {
  jobRef: QueryJobRef;
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  execution: NonNullable<QueryJobIntentV1['execution']>;
};

const QUERY_ORIGIN_PAGE_SIZE = 256;

/** Current canonical Query qualification; the single implementation of these checks. */
type CurrentQueryState = {
  /** Derived from the complete request.runRef, never from a loaded record. */
  jobRef: QueryJobRef;
  run: QueryRunSnapshot;
  job: QueryJobSnapshot;
  execution: NonNullable<QueryJobIntentV1['execution']>;
};

/**
 * The one implementation of current Query qualification: exactly one QueryRun read and one
 * QueryJob read per call, the request-derived job identity, running state, the complete
 * execution request, ref/intent scope and execution validity. Callers layer their own checks
 * (ctx identity, bound-execution equality, history attribution) on top; no caller re-reads the
 * same records or re-implements these rules.
 */
async function loadCurrentQueryState(
  ledger: SourceSnapshotReads,
  request: QueryExecutionRequest,
): Promise<WorkspaceResult<CurrentQueryState>> {
  const denied = (reason: string): WorkspaceResult<never> => rejected('forbidden', reason);
  // The canonical job identity is derived from the complete request.runRef, never taken from the
  // records themselves: two mutually consistent but cross-identity records must not be able to
  // redefine the bound job.
  const jobRef = queryJobRefFor(request.runRef.projectId, request.runRef.workspaceId, request.runRef.queryJobId);
  const loadedRun = await ledger.load(request.runRef);
  if (loadedRun.status !== 'found') return loadRejection(loadedRun, 'forbidden', 'the bound QueryRun is not retained');
  if (loadedRun.snapshot.ref.aggregateType !== 'QueryRun')
    return denied('the bound QueryRun is not retained');
  const run = loadedRun.snapshot as QueryRunSnapshot;
  if (canonicalJson(run.ref) !== canonicalJson(request.runRef)) return denied('the QueryRun identity changed');
  if (run.run.status !== 'running' || (run.run.outcome ?? null) !== null) return denied('the bound QueryRun is not running');
  if (run.run.runId !== request.runRef.runId) return denied('the QueryRun run id changed');
  if (!run.run.queryJobRef || canonicalJson(run.run.queryJobRef) !== canonicalJson(jobRef))
    return denied('the QueryRun is bound to another QueryJob');
  if (!run.run.execution || canonicalJson(run.run.execution.request) !== canonicalJson(request))
    return denied('the recorded execution request does not match');
  const loadedJob = await ledger.load(jobRef);
  if (loadedJob.status !== 'found') return loadRejection(loadedJob, 'forbidden', 'the bound QueryJob is not retained');
  if (loadedJob.snapshot.ref.aggregateType !== 'QueryJob'
      || canonicalJson(loadedJob.snapshot.ref) !== canonicalJson(jobRef))
    return denied('the bound QueryJob is not retained');
  const job = loadedJob.snapshot as QueryJobSnapshot;
  if (job.job.status !== 'running') return denied('the bound QueryJob is not running');
  if (!job.job.runRef || canonicalJson(job.job.runRef) !== canonicalJson(request.runRef))
    return denied('the QueryJob is bound to another QueryRun');
  const intent = job.job.intent;
  if (intent.projectId !== jobRef.projectId || intent.workspaceId !== jobRef.workspaceId)
    return denied('the recorded QueryJob scope changed');
  if (intent.question !== request.question) return denied('the recorded QueryJob question changed');
  const execution = intent.execution;
  if (!execution || !validQueryExecution(execution))
    return denied('the recorded query execution is missing or invalid');
  return { status: 'ready', value: { jobRef, run, job, execution } };
}

/**
 * Resolve the original initiator of one accepted QueryJob exactly once per factory. The
 * canonical source is the QueryJobSubmitted event, not QueryRunStarted (which may be a
 * dispatcher), and never a fixed local/system actor. Only a bounded candidate and a conflict
 * flag are retained; the scan stops at the end of the append-only history and checks Host/Run
 * cancellation on every page.
 */
async function resolveQueryOrigin(
  ledger: SourceAuthorityReads,
  request: QueryExecutionRequest,
  hostSignal: AbortSignal,
  runSignal: AbortSignal,
): Promise<QueryOrigin> {
  // Current qualification is implemented once; a rejected current state fails this
  // initialization with the original error semantics.
  const current = await loadCurrentQueryState(ledger, request);
  if (current.status !== 'ready') throw Error('query source capture: ' + current.reason);
  const { jobRef, job, execution } = current.value;
  // O(1) extra state: one candidate plus conflict/unsupported flags. The full history is
  // never retained, and a second match is rejected instead of collected.
  let candidate: Extract<ActorRef, { kind: 'human' | 'system' }> | undefined;
  let conflict = false;
  let unsupported = false;
  let cursor: CommitCursor | null = null;
  for (;;) {
    if (hostSignal.aborted || runSignal.aborted)
      throw Error('query source capture: cancelled while resolving the original initiator');
    const page = await ledger.events({ afterCursor: cursor, limit: QUERY_ORIGIN_PAGE_SIZE });
    // Check cancellation immediately after the await, before consuming the page: a request that
    // was cancelled while the page was in flight must not keep scanning or resolve an origin.
    if (hostSignal.aborted || runSignal.aborted)
      throw Error('query source capture: cancelled while resolving the original initiator');
    // Reject malformed pages instead of looping: the page must echo the requested cursor and
    // its rows must be strictly increasing after it.
    if (page.afterCursor !== cursor) throw Error('query source capture: the event page does not start at the requested cursor');
    let previous = cursor === null ? 0 : seqOfCommitCursor(cursor);
    for (const row of page.events) {
      const rowSeq = seqOfCommitCursor(row.cursor);
      if (rowSeq <= previous) throw Error('query source capture: the event page is not strictly increasing');
      previous = rowSeq;
      const event = row.event;
      if (event.eventType !== 'QueryJobSubmitted') continue;
      if (event.projectId !== jobRef.projectId || event.workspaceId !== jobRef.workspaceId) continue;
      if (event.aggregateType !== 'QueryJob' || event.aggregateId !== jobRef.queryJobId || event.aggregateRevision !== 1) continue;
      const submitted = event.payload.job;
      const initial = submitted.queryJobId === jobRef.queryJobId
        && submitted.projectId === job.job.projectId && submitted.workspaceId === job.job.workspaceId
        && submitted.goalId === job.job.goalId
        && canonicalJson(submitted.runRef ?? null) === canonicalJson(job.job.runRef)
        && submitted.submittedAt === job.job.submittedAt
        && canonicalJson(submitted.intent) === canonicalJson(job.job.intent)
        && submitted.status === 'pending' && submitted.answerRefs.length === 0 && submitted.closeReason === null;
      if (!initial) { conflict = true; continue; }
      // The current CorePrincipal supports human/system initiators; an agent origin must be
      // refused, never relabelled as system.
      if (event.actor.kind === 'agent') { unsupported = true; continue; }
      if (candidate !== undefined) { conflict = true; continue; }
      candidate = { kind: event.actor.kind, id: event.actor.id };
    }
    const through = page.throughCursor;
    if (page.events.length > 0) {
      if (through === null || seqOfCommitCursor(through) !== previous)
        throw Error('query source capture: the event page cursor does not match its last event');
    } else if (through !== cursor) {
      throw Error('query source capture: an empty event page moved the cursor');
    }
    if (!page.hasMore) break;
    if (through === null || seqOfCommitCursor(through) <= (cursor === null ? 0 : seqOfCommitCursor(cursor)))
      throw Error('query source capture: the event scan did not advance');
    cursor = through;
  }
  if (conflict || unsupported) throw Error('query source capture: the original initiator is conflicting or unsupported');
  if (candidate === undefined) throw Error('query source capture: the original initiator is unavailable');
  // The bound job identity is the reference derived from the request, never the loaded record's.
  return { jobRef: structuredClone(jobRef), actor: structuredClone(candidate), execution: structuredClone(execution) };
}

/**
 * Per-request Query qualification: ctx identity is checked against the bound QueryRun, then the
 * shared current-state rule is re-read (one Run + one Job read), the immutable execution must
 * still equal the bound one, and the subject/policy revision is minted.
 * Ordinary aggregate revision progression is not a permission change.
 */
async function authorizeQuerySubject(
  ledger: SourceSnapshotReads,
  binding: QuerySourceBinding,
  ctx: CoreCallContext,
  policy: SourcePolicy,
): Promise<WorkspaceResult<RuntimeSubject>> {
  const denied = (reason: string): WorkspaceResult<never> => rejected('forbidden', reason);
  // The bound Query workspace is authoritative: the outer bridge only compares ctx against the
  // requested workspace, so a caller that swaps both ctx and the capture input to another
  // workspace (even one registered on the same root) must be refused here before any identity
  // or current-state check can pass.
  if (ctx.projectId !== binding.workspace.projectId || ctx.workspaceId !== binding.workspace.workspaceId)
    return denied('the call context scope does not match the bound QueryRun workspace');
  const principal = ctx.principal;
  if (principal.kind !== 'query_run') return denied('query source reads require the bound QueryRun principal');
  if (canonicalJson(principal.queryRunRef) !== canonicalJson(binding.queryRunRef)) return denied('the call context belongs to another QueryRun');
  if (canonicalJson(principal.initiator) !== canonicalJson(binding.actor)) return denied('the call context initiator is not the recorded original actor');
  if (ctx.materialReader.kind !== 'run' || ctx.materialReader.requester.aggregateType !== 'QueryRun'
      || canonicalJson(ctx.materialReader.requester) !== canonicalJson(binding.queryRunRef))
    return denied('material reader must be the same bound QueryRun');
  const current = await loadCurrentQueryState(ledger, binding.request);
  if (current.status !== 'ready') return current;
  const { run, execution } = current.value;
  if (canonicalJson(execution) !== canonicalJson(binding.execution))
    return denied('the recorded query execution changed since the source binding');
  return { status: 'ready', value: {
    // Complete QueryRunRef, original actor, complete request and complete role.
    subjectKey: 'query_run:' + sha256Hex(canonicalJson([run.ref, binding.actor, binding.request, binding.execution.roleBinding])),
    // Real role, execution kind, a stable read-only policy version and the Host mount policy.
    // Never a source digest or an ordinary business revision.
    permissionRevision: sha256Hex(canonicalJson({
      policy: 'query-source-live-v1',
      role: binding.execution.roleBinding,
      kind: binding.execution.kind,
      mount: policy.permissionRevision,
    })),
    allowsRead: policy.allowsRead,
  } };
}
