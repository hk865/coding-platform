/**
 * B2 execution preparation.
 *
 * Reads the real WG11 claim/execution facts, resolves the original Role through
 * the WorkGraph role facts port, reads the exact Plan/Task contract, resolves
 * the trusted Host configuration, stores one bounded manifest body and returns
 * only verifiable references. Nothing is fabricated: a missing required
 * material, an inadmissible Role, a revoked Host grant or a manifest over the
 * Artifact capacity is an explicit rejection.
 */
import type { ArtifactRef } from '../../contracts/artifact.js';
import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { SourceRefV1, RuntimeInputBindingV1 } from '../../contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { SessionAnomalyAnchorRef } from '../../contracts/session-anomaly.js';
import { revisionAssignments } from '../../contracts/plan.js';
import { sha256Hex } from '../../contracts/fingerprint.js';
import { MANIFEST_CONTENT_TYPE } from '../../contracts/no-progress.js';
import { continuationBriefDigest, type ContinuationBriefV1 } from '../../contracts/continuation-brief.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import {
  briefWorkspaceFactsFor, createContextAssembler, type BriefWorkspaceFactsOutcome, type ContextAssembler,
  type ContextAssemblerDependencies,
} from './context-assembler.js';
import type { PrepareTaskExecutionRequest, ResolvedRuntimeConfiguration, RuntimeExecutionDependencies } from './execution-contracts.js';

/**
 * The default assembler consumes the preparation ports plus the optional
 * context/brief ports (including the L8 reminder reader), so the factory
 * declares exactly that instead of casting. A direct caller that passes its own
 * assembler need not supply the assembler-only ports.
 */
export type ExecutionPreparationDependencies = Pick<RuntimeExecutionDependencies,
  'executions' | 'roles' | 'bodies' | 'host' | 'now' | 'newId'>
  & Partial<Pick<RuntimeExecutionDependencies,
    'materials' | 'plans' | 'sessions' | 'kernelStores' | 'workspaceHost' | 'workspaceSource'
    | 'kernel' | 'graphContext' | 'taskInputs' | 'architectureReminders'>>;

// Slice 1 §4.1 (T10): the archive-origin rule lives with the brief assembly (slice 3 moved the brief into the
// context assembler); re-exported here, where slice 1 declared it.
export { archiveOriginSkipsHistorySeed } from './context-assembler.js';

/** The reads `briefWorkspaceFacts` needs: the clock and the workspace host/source. */
export type BriefWorkspaceFactsDependencies =
  Pick<RuntimeExecutionDependencies, 'now'> & Partial<Pick<RuntimeExecutionDependencies, 'workspaceHost' | 'workspaceSource'>>;

/**
 * The brief's own source checkpoint (digest-only, LA-5) and the uncommitted paths of the workspace. Slice 1
 * (§2.6) reads it for the archive changed-file snapshot; the one implementation is the context assembler's.
 */
export async function briefWorkspaceFacts(
  deps: BriefWorkspaceFactsDependencies, record: TaskExecutionRecord, signal: AbortSignal,
): Promise<BriefWorkspaceFactsOutcome> {
  return briefWorkspaceFactsFor(deps, () => deps.now(), record, signal);
}

export type ExecutionPreparationService = {
  prepare(ctx: CoreCallContext, request: PrepareTaskExecutionRequest): Promise<ReadResult<PreparedTaskExecution>>;
};

/** Exact manifest content type (declared once in contracts, ND-9); WorkGraph re-reads the body and requires this. */
export const PREPARED_MANIFEST_CONTENT_TYPE = MANIFEST_CONTENT_TYPE;
/** One prepared manifest is a bounded JSON body, never a transcript store. */
export const MAX_PREPARED_MANIFEST_BYTES = ARTIFACT_MAX_SIZE_BYTES;

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function sameRef(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function ownContext(ctx: CoreCallContext): CoreCallContext | null {
  try {
    return {
      projectId: ctx.projectId,
      principal: structuredClone(ctx.principal),
      materialReader: structuredClone(ctx.materialReader),
      signal: ctx.signal,
      ...(typeof ctx.workspaceId === 'string' ? { workspaceId: ctx.workspaceId } : {}),
    };
  } catch { return null; }
}
function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required prepared fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required prepared fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}

/** Intersect the Host's real tool grant with the Role ceiling. Absent Role spec
 * keeps the legacy semantics (Host grant is the only ceiling). */
function intersectTools(hostTools: readonly string[], roleResolution: RoleSpecResolutionV1): string[] {
  if (roleResolution.status !== 'resolved') return [...hostTools];
  const ceiling = new Set(roleResolution.spec.permissions.tools);
  return hostTools.filter(tool => ceiling.has(tool));
}

/** This batch supports exactly two write shapes: no writes, or an explicit Host
 * whole-workspace grant. A narrower path scope is unsupported, never widened. */
function validateWriteScope(hostWriteScope: readonly string[], roleResolution: RoleSpecResolutionV1, hostShell: 'all_except_denied' | undefined): { ok: true; writeScope: string[] } | { ok: false; rejection: CoreRejection } {
  const writeScope = [...hostWriteScope];
  const wholeWorkspace = writeScope.length === 1 && writeScope[0] === '.';
  if (writeScope.length !== 0 && !wholeWorkspace) {
    return { ok: false, rejection: rejected('unsupported', 'a narrower write scope than the whole workspace is not supported by this runtime batch') };
  }
  if (roleResolution.status === 'resolved' && roleResolution.spec.permissions.writeScope === 'none' && writeScope.length !== 0) {
    return { ok: false, rejection: rejected('forbidden', 'the Role spec is read-only but the Host grant allows writes') };
  }
  if (hostShell !== undefined && !wholeWorkspace) {
    return { ok: false, rejection: rejected('unsupported', 'shell requires an explicit whole-workspace write grant') };
  }
  return { ok: true, writeScope };
}

/**
 * C3 / §6.1 contract (e): the Prepared value of a Run whose input is already
 * bound (Authorized, Entering or Revoked are all `starting`). Nothing is
 * assembled again: the claim, envelope and inputBinding are the Run's own, so a
 * re-drive or a re-authorization (RUN-03) never changes the continuation brief
 * (§11 I-19).
 */
export function rehydratePreparedExecution(record: Pick<TaskExecutionRecord, 'run' | 'outbox'>): PreparedTaskExecution | null {
  const { run, outbox } = record;
  if (run.inputBinding === undefined || run.envelope === null) return null;
  return { kind: 'task', claim: structuredClone(outbox.claim), envelope: structuredClone(run.envelope),
    inputBinding: structuredClone(run.inputBinding) };
}

/** The default assembler genuinely needs `materials`; a missing one is an
 * explicit setup error, never a cast that hides it. */
function defaultContextAssemblerDependencies(
  deps: ExecutionPreparationDependencies,
): ContextAssemblerDependencies {
  const materials = deps.materials;
  if (materials === undefined) {
    throw new Error('the default context assembler requires the materials port');
  }
  return { ...deps, materials };
}

export function createExecutionPreparation(deps: ExecutionPreparationDependencies, contextAssembler?: ContextAssembler): ExecutionPreparationService {
  // §4.2/G5.7: a missing second argument constructs the same one assembler once;
  // the legacy text builder is unreachable and gone.
  const assembler = contextAssembler ?? createContextAssembler(defaultContextAssemblerDependencies(deps));
  return {
    async prepare(ctx: CoreCallContext, request: PrepareTaskExecutionRequest): Promise<ReadResult<PreparedTaskExecution>> {
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      const signal = owned.signal;
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled before the execution read');
      const rawRunRef = request?.runRef;
      if (!isRecord(rawRunRef) || rawRunRef['aggregateType'] !== 'Run' || !nonEmpty(rawRunRef['projectId'])
        || !nonEmpty(rawRunRef['goalId']) || !nonEmpty(rawRunRef['runId'])) {
        return rejected('invalid', 'prepareExecution requires a complete RunRef');
      }
      let runRef;
      try { runRef = structuredClone(rawRunRef); } catch { return rejected('invalid', 'the prepare request cannot be isolated from the caller'); }
      if (runRef.projectId !== owned.projectId) return rejected('forbidden', 'the Run belongs to another project');

      let record;
      try {
        record = await deps.executions.readExecution(owned, runRef);
      } catch (error) {
        return rejected('unavailable', `the execution read failed: ${messageOf(error)}`);
      }
      if (record.status !== 'ready') return mapRead(record);
      const { run, outbox, plan, session } = record.value;
      const claim = outbox.claim;
      if (!sameRef(run.ref, runRef) || !sameRef(claim.runRef, runRef)) return rejected('unavailable', 'the claim facts do not name the requested Run');
      if (!sameRef(claim.task, run.task)) return rejected('unavailable', 'the claim task disagrees with the Run task');
      if (!sameRef(claim.planRef, run.planRef)) return rejected('unavailable', 'the claim plan disagrees with the Run plan');
      if (session.ref.projectId !== runRef.projectId || session.ref.sessionId !== claim.sessionRef.sessionId) {
        return rejected('unavailable', 'the claim Session mapping is inconsistent');
      }
      if (run.status !== 'starting') return rejected('busy', 'the Run is not awaiting a fresh entry');
      if (run.workspaceSnapshot.workspaceId !== session.workspaceId) {
        return rejected('unavailable', 'the Run workspace disagrees with the Session workspace');
      }
      // §6.1 (e), I-19: a Run whose input is already bound is never prepared
      // again; its own claim, envelope and binding are the Prepared value.
      if (run.inputBinding !== undefined) {
        const rehydrated = rehydratePreparedExecution(record.value);
        if (rehydrated === null) return rejected('unavailable', 'the bound Run has no saved prepared envelope');
        return { status: 'ready', value: rehydrated };
      }
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled after the execution read');

      // 1. Original Role resolution (same WorkGraph resolver the claim used).
      let roleFacts;
      try {
        roleFacts = await deps.roles.resolveRoleBindingFacts(owned, { roleBinding: run.roleBinding, declaredPermissions: { tools: [], writeScope: [] } });
      } catch (error) {
        return rejected('unavailable', `Role resolution failed: ${messageOf(error)}`);
      }
      if (roleFacts.result.status !== 'ready') return mapRead(roleFacts.result);
      let roleResolution;
      try { roleResolution = structuredClone(roleFacts.result.value); } catch { return rejected('invalid', 'the resolved Role cannot be isolated from the caller'); }
      if (roleResolution.status === 'inadmissible') return rejected('forbidden', 'the current Role binding is inadmissible');
      if (roleResolution.status === 'resolved') {
        if (session.role.kind !== 'role_spec'
          || session.role.pin.ref.projectId !== roleResolution.revision.projectId
          || session.role.pin.ref.roleId !== roleResolution.revision.roleId
          || session.role.pin.ref.revision !== roleResolution.revision.revision) {
          return rejected('forbidden', 'the resolved Role does not match the Session Role pin');
        }
      }
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled after Role resolution');

      // 2. Trusted Host configuration for this exact Run.
      let configured;
      try {
        configured = await deps.host.resolveConfiguration(owned, { runRef, role: session.role, roleResolution });
      } catch (error) {
        return rejected('unavailable', `Host configuration resolution failed: ${messageOf(error)}`);
      }
      if (configured.status !== 'ready') return mapRead(configured);
      const hostConfig = snapshotRuntimeConfiguration(configured.value);
      if (roleResolution.status === 'absent') {
        if (hostConfig.hostTemplate === null) {
          return rejected('unsupported', 'an absent Role spec requires a trusted Host legacy template');
        }
        if (session.role.kind !== 'legacy_template'
          || session.role.templateId !== hostConfig.hostTemplate.templateId
          || session.role.templateRevision !== hostConfig.hostTemplate.revision) {
          return rejected('forbidden', 'the Host legacy template does not match the Session legacy template');
        }
      }
      const writeScopeResult = validateWriteScope(hostConfig.writeScope, roleResolution, hostConfig.shellWorkspaceAccess);
      if (!writeScopeResult.ok) return writeScopeResult.rejection;
      const permissions: TaskEnvelopeV1['permissions'] = {
        policyRevision: run.roleBinding.policyRevision,
        tools: intersectTools(hostConfig.tools, roleResolution),
        writeScope: writeScopeResult.writeScope,
      };
      const hasShell = permissions.tools.includes('shell');
      if (hasShell && (hostConfig.shellWorkspaceAccess !== 'all_except_denied' || permissions.writeScope.length !== 1 || permissions.writeScope[0] !== '.')) {
        return rejected('unsupported', 'shell requires Host shellWorkspaceAccess=all_except_denied, a shell grant and an explicit whole-workspace write scope');
      }
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled after the Host configuration read');

      // 3. Exact Plan/Task contract: the assignment instruction is the formal
      //    task input; a required material kind this batch cannot source is a
      //    real gap, never replaced by a summary. The claim Plan's declarations
      //    (legacy inputRequirements + edges) are read by the assembler below.
      const assignments = revisionAssignments(plan);
      const assignment = assignments.find(candidate => candidate.taskId === claim.task.taskId);
      if (assignment === undefined) return rejected('incomplete', 'the accepted Plan has no assignment for this Task');
      const unsourceable = roleResolution.status === 'resolved'
        ? roleResolution.spec.requiredMaterials.filter(material => material.kind !== 'contract')
        : [];
      if (unsourceable.length > 0) {
        return rejected('unsupported', `required Role materials of kinds ${unsourceable.map(material => material.kind).join(', ')} have no exact producer in this runtime batch`);
      }

      const sourceRefs: SourceRefV1[] = [
        { kind: 'plan-revision', refId: plan.ref.planId, revision: String(plan.revision) },
        { kind: 'workspace', refId: session.workspaceId, revision: String(run.workspaceSnapshot.revision) },
      ];
      const additionalMaterialRefs: ArtifactRef[] = [];
      // Slice 3 (§4.2/§4.3, C7): the ONE context assembler owns the eight
      // sections and the byte budget. Its rejection (in particular a failing
      // `graphContext` read) is propagated unchanged; the manifest is built from
      // the assembled input/binding/brief/sessionBasis/inputs.
      let input: string;
      let inputDigest: string;
      let brief: ContinuationBriefV1 | null;
      let sessionBasis: PreparedTaskManifestV1['sessionBasis'];
      let selectedTaskInputs: PreparedTaskManifestV1['selectedTaskInputs'];
      let contextAssembly: PreparedTaskManifestV1['contextAssembly'];
      let assembled;
      try {
        assembled = await assembler.assembleTask(owned, {
          execution: record.value, role: roleResolution, configuration: hostConfig, permissions,
        });
      } catch (error) {
        if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled while the context was assembled');
        return rejected('unavailable', `the context assembly failed: ${messageOf(error)}`);
      }
      // Cancellation wins over both a ready and a rejected assembly result.
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled while the context was assembled');
      if (assembled.status !== 'ready') return assembled;
      input = assembled.value.input;
      inputDigest = sha256Hex(input);
      brief = assembled.value.continuationBrief;
      sessionBasis = assembled.value.sessionBasis;
      selectedTaskInputs = assembled.value.selectedTaskInputs;
      contextAssembly = assembled.value.binding;
      // Slice 1 §2.7: the anchors the brief's anomaly section names are bound with the input.
      const anomalyAnchorRefs: SessionAnomalyAnchorRef[] | null = assembled.value.anomalyAnchorRefs ?? null;
      const briefDigest = brief === null ? null : continuationBriefDigest(brief);
      const manifest: PreparedTaskManifestV1 = {
        schemaVersion: 1, kind: 'task_execution', claim, role: roleResolution,
        hostTemplate: roleResolution.status === 'resolved' ? null : hostConfig.hostTemplate,
        roleBinding: run.roleBinding, hostConfigurationRevision: hostConfig.configurationRevision, sessionRole: session.role,
        workspaceSnapshot: { workspaceId: session.workspaceId, revision: run.workspaceSnapshot.revision },
        permissions, budget: run.budget, selectedTaskInputs, materialBasis: hostConfig.materialBasis,
        materialAccessRefs: [], additionalMaterialRefs, deliveryRefs: [], sourceRefs,
        ...(contextAssembly === undefined ? {} : { contextAssembly }),
        ...(brief === null ? {} : { continuationBrief: brief }),
        ...(sessionBasis === undefined ? {} : { sessionBasis }),
        input, inputDigest,
      };
      const manifestJson = JSON.stringify(manifest);
      if (Buffer.byteLength(manifestJson, 'utf8') > MAX_PREPARED_MANIFEST_BYTES) {
        return rejected('capacity', `the bounded prepared manifest exceeds ${String(MAX_PREPARED_MANIFEST_BYTES)} bytes`);
      }
      // A cancellation that happened before the put must not write anything; a
      // put already started cannot be rolled back (an unreachable body may stay).
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled before the prepared manifest was stored');
      let stored;
      try {
        stored = await deps.bodies.put({
          body: manifestJson, contentType: PREPARED_MANIFEST_CONTENT_TYPE, sourceRefs,
          origin: { kind: 'run', owner: runRef }, requestedAt: deps.now(),
        });
      } catch (error) {
        if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled while the prepared manifest was stored');
        return rejected('unavailable', `storing the prepared manifest failed: ${messageOf(error)}`);
      }
      // The put already completed, but a cancellation while it waited wins: the
      // preparation is not reported ready (the unreachable body is not rolled back).
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled while the prepared manifest was stored');
      if (stored.status !== 'ready') {
        const code = stored.reason !== undefined && stored.reason.includes('size') ? 'capacity' : 'unavailable';
        return rejected(code, `storing the prepared manifest failed: ${stored.reason}`);
      }
      const bundleRef = stored.value.ref;
      const envelope: TaskEnvelopeV1 = {
        schemaVersion: 1, envelopeId: deps.newId(), projectId: claim.task.projectId, workspaceId: session.workspaceId,
        goalId: claim.task.goalId, taskId: claim.task.taskId, runRef, attemptRef: claim.attemptRef, planRef: claim.planRef,
        roleBinding: run.roleBinding, workspaceSnapshot: manifest.workspaceSnapshot, permissions, budget: run.budget,
        sourceRefs, bundleRef,
      };
      const inputBinding: RuntimeInputBindingV1 = {
        schemaVersion: 1, inputDigest, manifestDigest: bundleRef.digest,
        materialAccessRefs: [], additionalMaterialRefs, deliveryRefs: [],
        ...(briefDigest === null ? {} : { continuationBriefDigest: briefDigest }),
        ...(anomalyAnchorRefs === null || anomalyAnchorRefs.length === 0 ? {} : { anomalyAnchorRefs }),
      };
      return { status: 'ready', value: { kind: 'task', claim, envelope, inputBinding } };
    },
  };
}

/** Freeze the mutable data fields of a trusted Host configuration into a
 * per-call snapshot. Capability fields (model client, input counter) stay by
 * reference: they are handles, not data a later caller mutation can retarget,
 * and structuredClone would break them. */
export function snapshotRuntimeConfiguration(config: ResolvedRuntimeConfiguration): ResolvedRuntimeConfiguration {
  const processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string } = {};
  if (config.processSandboxOptions.readOnlyPaths !== undefined) processSandboxOptions.readOnlyPaths = [...config.processSandboxOptions.readOnlyPaths];
  if (config.processSandboxOptions.executablePath !== undefined) processSandboxOptions.executablePath = config.processSandboxOptions.executablePath;
  const model: ResolvedRuntimeConfiguration['model'] = {
    configuration: { ...config.model.configuration },
    client: config.model.client,
    ...(config.model.inputCounter === undefined ? {} : { inputCounter: config.model.inputCounter }),
  };
  return {
    configurationRevision: config.configurationRevision,
    model,
    budget: { ...config.budget },
    hostTemplate: config.hostTemplate === null ? null : { ...config.hostTemplate },
    tools: [...config.tools],
    writeScope: [...config.writeScope],
    ...(config.shellWorkspaceAccess === undefined ? {} : { shellWorkspaceAccess: config.shellWorkspaceAccess }),
    ...(config.readonlyCommandAccess === undefined ? {} : { readonlyCommandAccess: config.readonlyCommandAccess }),
    skills: { resourceRoot: config.skills.resourceRoot, enabledIds: [...config.skills.enabledIds] },
    systemInstruction: config.systemInstruction,
    deniedPrefixes: [...config.deniedPrefixes],
    processSandboxOptions,
    materialBasis: config.materialBasis === null ? null : structuredClone(config.materialBasis),
    // Slice 3 (§2.4 item 3): the Host's explicit duty and resident budget reach the assembler.
    ...(config.platformDuty === undefined ? {} : { platformDuty: config.platformDuty }),
    ...(config.contextResidentBytes === undefined ? {} : { contextResidentBytes: config.contextResidentBytes }),
  };
}

/** Re-read the persisted bounded manifest referenced by a Prepared value. A
 * tampered digest, a wrong content type, a size/digest disagreement or a
 * mismatch between the body and the Prepared references is `invalid`; the
 * caller never trusts the Prepared object by itself. */
export async function loadPreparedManifest(
  bodies: Pick<import('../record-store/body-ports.js').RawArtifactStorePort, 'read'>,
  prepared: PreparedTaskExecution,
): Promise<ReadResult<{ manifest: PreparedTaskManifestV1; bundleRef: ArtifactRef }>> {
  const envelope = prepared?.envelope;
  const binding = prepared?.inputBinding;
  if (!isRecord(envelope) || !isRecord(envelope['bundleRef']) || !isRecord(binding)) {
    return rejected('invalid', 'the Prepared value is incomplete');
  }
  const bundleRef = envelope['bundleRef'] as ArtifactRef;
  if (bundleRef.contentType !== PREPARED_MANIFEST_CONTENT_TYPE
    || !nonEmpty(bundleRef.digest) || !Number.isSafeInteger(bundleRef.sizeBytes) || bundleRef.sizeBytes < 0) {
    return rejected('invalid', 'the Prepared envelope does not reference a bounded task-execution manifest body');
  }
  let stored;
  try {
    stored = await bodies.read(bundleRef);
  } catch (error) {
    return rejected('unavailable', `reading the prepared manifest failed: ${messageOf(error)}`);
  }
  if (stored.status !== 'ready') return rejected('invalid', 'the prepared manifest body is not readable');
  const record = stored.value;
  if (record.ref.contentType !== bundleRef.contentType || record.ref.digest !== bundleRef.digest || record.ref.sizeBytes !== bundleRef.sizeBytes) {
    return rejected('invalid', 'the stored manifest reference disagrees with the Prepared envelope');
  }
  if (sha256Hex(record.body) !== bundleRef.digest || Buffer.byteLength(record.body, 'utf8') !== bundleRef.sizeBytes) {
    return rejected('invalid', 'the stored manifest bytes do not match their content digest');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(record.body); } catch { return rejected('invalid', 'the prepared manifest is not valid JSON'); }
  if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'task_execution'
    || typeof parsed['input'] !== 'string' || !nonEmpty(parsed['inputDigest'])) {
    return rejected('invalid', 'the prepared manifest is not a complete task-execution manifest');
  }
  const manifest = parsed as unknown as PreparedTaskManifestV1;
  if (!sameRef(manifest.claim, prepared.claim)) return rejected('invalid', 'the prepared manifest claim disagrees with the returned claim');
  if (sha256Hex(manifest.input) !== manifest.inputDigest) return rejected('invalid', 'the prepared manifest input digest is not the digest of its input');
  if (manifest.inputDigest !== (binding as RuntimeInputBindingV1).inputDigest
    || (binding as RuntimeInputBindingV1).manifestDigest !== bundleRef.digest) {
    return rejected('invalid', 'the input binding disagrees with the persisted manifest');
  }
  const envelopeFields: Array<[unknown, unknown]> = [
    [envelope['runRef'], manifest.claim.runRef],
    [envelope['attemptRef'], manifest.claim.attemptRef],
    [envelope['planRef'], manifest.claim.planRef],
    [envelope['roleBinding'], manifest.roleBinding],
    [envelope['workspaceSnapshot'], manifest.workspaceSnapshot],
    [envelope['permissions'], manifest.permissions],
    [envelope['budget'], manifest.budget],
  ];
  for (const [left, right] of envelopeFields) {
    if (!sameRef(left, right)) return rejected('invalid', 'the Prepared envelope disagrees with the persisted manifest');
  }
  return { status: 'ready', value: { manifest, bundleRef } };
}
