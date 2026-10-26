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
import { messageOf } from '../../contracts/error-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../contracts/validation/common.js';
import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import {
  renderUnknownCallReviewZh,
  type PreparedTaskExecution, type PreparedTaskManifestV1, type UnknownCallReviewInputV1,
} from '../../contracts/core/prepared-execution.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { SourceRefV1, RuntimeInputBindingV1 } from '../../contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { SessionAnomalyAnchorRef } from '../../contracts/session-anomaly.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { PromptPackSourcePort, ResolvedPromptPackV1 } from '../../contracts/prompts/prompt-pack.js';
import { decodePromptSetV1, promptSelectionOf, type PromptSetV1 } from '../../contracts/prompts/prompt-set.js';
import { renderTemplate } from '../../contracts/prompts/render-template.js';
import { sha256Hex } from '../../contracts/fingerprint.js';
import { MANIFEST_CONTENT_TYPE } from '../../contracts/no-progress.js';
import { continuationBriefDigest, type ContinuationBriefV1 } from '../../contracts/continuation-brief.js';
import type { UnknownCallReviewV1 } from '../../contracts/unknown-call-review.js';
import {
  UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES, UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES,
} from '../../contracts/review-admission.js';
import { readWorkspaceBaseline } from '../workspace/workspace-change-capture.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import {
  briefWorkspaceFactsFor, createContextAssembler, trimUnknownCallReviewInput,
  type BriefWorkspaceFactsOutcome, type ContextAssembler, type ContextAssemblerDependencies,
} from './context-assembler.js';
import { rerenderContextV1, workPreparedSectionOrder } from './context-rendering.js';
import { finalToolNamesOf, RUNTIME_TOOL_NAMES } from './tool-group-assembly.js';
import { READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import type { ContextWorkHistoryInputV1 } from './context-types.js';
import {
  promptDeclarationProblem, promptRenderProblem, resolvePromptPack, selectPromptSkills,
  storePromptTexts, trackPromptTexts, type PromptPartsV1,
} from './prompt-set-texts.js';
import { readTaskReviews } from '../work-graph/tasks/task-review-reader.js';
import { orderBlockedCommands } from '../work-graph/tasks/blocked-command-order.js';
import { unknownCallReviewRefKey } from '../work-graph/tasks/unknown-call-review-codecs.js';
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
    | 'kernel' | 'graphContext' | 'taskInputs' | 'architectureReminders' | 'unknownCallReviews'>>
  & {
    /**
     * Ruling 14: the ONE prompt-pack source of this preparation. Absent installs
     * the ruling-30 platform default (the generated pack), never `unavailable`;
     * production always wires the source.
     */
    promptPacks?: PromptPackSourcePort;
    /**
     * Rework 1 item 4 / rework 2 item 2: the ONE canonical Task-closure read
     * (`readTaskClosure`). REQUIRED: `createAgentRuntime` passes the trusted
     * dependency straight through, so the composition root wires the real
     * `plan-readers.readTaskClosure` to the same records and an absent reader
     * can never mean "open".
     */
    readTaskClosure: (
      ctx: CoreCallContext,
      task: { projectId: string; goalId: string; taskId: string },
    ) => Promise<ReadResult<{ closed: boolean; cause: 'satisfied' | 'cancelled' | 'superseded' | null }>>;
  };

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
/** L5: the run-start baseline is its own immutable Artifact; the manifest carries only its reference. */
export const WORKSPACE_BASELINE_CONTENT_TYPE = 'application/vnd.platform.workspace-baseline+json';
const BASELINE_DETAIL_MAX = 500;

/** K3 L13/D8: the rendered review instruction is limited to this many UTF-8 bytes before the manifest measure. */
export const REVIEW_INSTRUCTION_MAX_BYTES = 64 * 1024;

/**
 * K3 L13/D8: fit the review instruction into the two budgets. The rendered text
 * is first held to `instructionMaxBytes`; then the whole manifest is measured by
 * the caller's `measure`, and while it is over `manifestMaxBytes` the instruction
 * is trimmed from the back in the fixed order. If even the floor does not fit,
 * the caller's other sections filled the manifest: `capacity`, never a blamed
 * review instruction.
 */
export function fitUnknownCallReviewForManifest(input: {
  review: UnknownCallReviewInputV1;
  render: (review: UnknownCallReviewInputV1) => string;
  measure: (review: UnknownCallReviewInputV1, rendered: string) => number;
  instructionMaxBytes?: number;
  manifestMaxBytes?: number;
}): { ok: true; review: UnknownCallReviewInputV1; rendered: string } | { ok: false; reason: 'capacity' } {
  const instructionMax = input.instructionMaxBytes ?? REVIEW_INSTRUCTION_MAX_BYTES;
  const manifestMax = input.manifestMaxBytes ?? MAX_PREPARED_MANIFEST_BYTES;
  let review = input.review;
  let rendered = input.render(review);
  while (Buffer.byteLength(rendered, 'utf8') > instructionMax) {
    const next = trimUnknownCallReviewInput(review);
    if (next === null) break;
    review = next;
    rendered = input.render(review);
  }
  while (input.measure(review, rendered) > manifestMax) {
    const next = trimUnknownCallReviewInput(review);
    if (next === null) return { ok: false, reason: 'capacity' };
    review = next;
    rendered = input.render(review);
  }
  return { ok: true, review, rendered };
}

/**
 * L5: record the run-start baseline as its own immutable Artifact and return
 * the reference+digest the manifest carries. `prepare` NEVER fails because of
 * the baseline: a non-git root, too many changes, a read failure or a store
 * failure all become `unavailable` and preparation continues.
 */
async function recordWorkspaceBaseline(
  deps: ExecutionPreparationDependencies,
  ctx: CoreCallContext,
  workspaceId: string,
  runRef: PreparedTaskManifestV1['claim']['runRef'],
  deniedPrefixes: readonly string[],
  sourceRefs: SourceRefV1[],
): Promise<PreparedTaskManifestV1['workspaceBaseline'] | 'cancelled'> {
  const unavailable = (reason: 'not_git' | 'too_many_changes' | 'read_failed', detail: string) => ({
    status: 'unavailable' as const, reason, detail: detail.length > BASELINE_DETAIL_MAX ? detail.slice(0, BASELINE_DETAIL_MAX) : detail,
  });
  if (deps.workspaceHost === undefined) return undefined;
  if (ctx.signal.aborted) return 'cancelled';
  let root: string;
  try {
    const resolved = await deps.workspaceHost.resolveRoot({ aggregateType: 'Workspace', projectId: ctx.projectId, workspaceId });
    // Slice 8 §13.8: a dependency that names cancellation is never a read failure.
    if (resolved.status === 'rejected' && resolved.code === 'cancelled') return 'cancelled';
    if (ctx.signal.aborted) return 'cancelled';
    if (resolved.status !== 'ready') return unavailable('read_failed', `the workspace root could not be resolved: ${resolved.reason}`);
    root = resolved.value.root;
  } catch (error) {
    if (ctx.signal.aborted) return 'cancelled';
    return unavailable('read_failed', `the workspace root could not be resolved: ${messageOf(error)}`);
  }
  let read;
  try {
    read = await readWorkspaceBaseline({ root, deniedPrefixes });
  } catch (error) {
    if (ctx.signal.aborted) return 'cancelled';
    return unavailable('read_failed', messageOf(error));
  }
  // The baseline read has no cancelled result: judge it by the signal, and never put after a cancellation.
  if (ctx.signal.aborted) return 'cancelled';
  if (read.status === 'unavailable') return unavailable(read.reason, read.detail);
  let stored;
  try {
    stored = await deps.bodies.put({
      body: JSON.stringify(read.baseline), contentType: WORKSPACE_BASELINE_CONTENT_TYPE, sourceRefs,
      origin: { kind: 'run', owner: runRef }, requestedAt: deps.now(),
    });
  } catch (error) {
    return unavailable('read_failed', `storing the workspace baseline failed: ${messageOf(error)}`);
  }
  if (stored.status !== 'ready') return unavailable('read_failed', `storing the workspace baseline failed: ${stored.reason}`);
  return { status: 'captured', ref: stored.value.ref, digest: stored.value.ref.digest };
}

/** Key-order-sensitive `JSON.stringify` comparison: two `undefined` values are equal and `undefined` properties are omitted. */
function sameJsonText(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
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

/** F-075: the ONE Task-review paging read, shared with the brief and the CRR
 * owner. `prepare` still reads the records ONCE and uses that one result for
 * the binding and the continuation's blocked lines. */
/**
 * L19a rework 1 item 1: every blocked command of the task's records, in
 * (record createdAt, alias) order. There is NO cap: 32 was one record's
 * boundary, never the task-history total.
 */
function blockedBindingOf(
  reviews: readonly UnknownCallReviewV1[], taskId: string,
): NonNullable<PreparedTaskManifestV1['blockedCommands']> {
  // F-074: the ONE global flatten + order (record createdAt, alias, ref-key
  // tie-break), the SAME rule the recognizer and the brief use. Sorting each
  // record in isolation would let an earlier record's alias 2 beat a later
  // record's alias 1 when createdAt ties.
  return orderBlockedCommands(reviews
    .filter(record => record.task.taskId === taskId)
    .map(record => ({
      createdAt: record.createdAt,
      refKey: unknownCallReviewRefKey(record.ref),
      commands: record.blockedCommands.map(entry => ({ alias: entry.alias,
        value: { reviewRunId: record.ref.runId, alias: entry.alias, commandSha256: entry.commandSha256 } })),
    })));
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
      // K3 L13/L20: a review-purpose Run's tools and empty write scope are fixed
      // by purpose (either phase), not by the Role/Host intersection.
      const reviewPurpose = run.purpose?.kind === 'unknown_call_review' ? run.purpose : undefined;
      if (!sameJsonText(run.ref, runRef) || !sameJsonText(claim.runRef, runRef)) return rejected('unavailable', 'the claim facts do not name the requested Run');
      if (!sameJsonText(claim.task, run.task)) return rejected('unavailable', 'the claim task disagrees with the Run task');
      if (!sameJsonText(claim.planRef, run.planRef)) return rejected('unavailable', 'the claim plan disagrees with the Run plan');
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
      // Ruling 14 item 1: the selection and the bound provider/model are read
      // BEFORE the first await that follows the configuration read.
      const selection = promptSelectionOf(configured.value.model);
      const boundProvider = configured.value.model.configuration.provider;
      const boundModel = configured.value.model.configuration.model;
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
      const writeScopeResult = reviewPurpose !== undefined
        ? { ok: true as const, writeScope: [] as string[] }
        : validateWriteScope(hostConfig.writeScope, roleResolution, hostConfig.shellWorkspaceAccess);
      if (!writeScopeResult.ok) return writeScopeResult.rejection;
      // L20: the proposal phase swaps only the one write tool.
      const reviewToolNames = reviewPurpose?.phase === 'proposal'
        ? UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES : UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES;
      const permissions: TaskEnvelopeV1['permissions'] = {
        policyRevision: run.roleBinding.policyRevision,
        tools: reviewPurpose !== undefined ? [...reviewToolNames] : intersectTools(hostConfig.tools, roleResolution),
        writeScope: writeScopeResult.writeScope,
      };
      const hasShell = permissions.tools.includes('shell');
      if (hasShell && (hostConfig.shellWorkspaceAccess !== 'all_except_denied' || permissions.writeScope.length !== 1 || permissions.writeScope[0] !== '.')) {
        return rejected('unsupported', 'shell requires Host shellWorkspaceAccess=all_except_denied, a shell grant and an explicit whole-workspace write scope');
      }
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled after the Host configuration read');

      // Ruling 14 item 2: resolve the pack ONCE, before anything renders. A
      // rejection names the pack and its reason; it never falls back to
      // `platform`.
      const resolved = await resolvePromptPack(deps.promptPacks, selection.promptPack, signal);
      if (resolved.status !== 'ready') return resolved;
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled while the prompt pack was resolved');
      const pack = resolved.value;
      const tracked = trackPromptTexts(pack);

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
      // Rework 1 items 1 and 4: read the Task closure ONCE and, when open, the
      // Task's review records ONCE. The SAME result builds the binding and feeds
      // the assembler's blocked lines. A closed Task carries neither, and a read
      // failure is `unavailable`, never "still valid".
      let taskReviews: UnknownCallReviewV1[] | undefined;
      let blockedBinding: PreparedTaskManifestV1['blockedCommands'];
      if (run.purpose === undefined) {
        // Today's one read of the Task's records stays; the closure is read only
        // when a binding/blocked line could exist, so a Run with no blocked
        // commands pays no extra read.
        const read = await readTaskReviews(owned, deps.unknownCallReviews,
          { goalRef: { aggregateType: 'Goal', projectId: claim.task.projectId, goalId: claim.task.goalId },
            taskId: claim.task.taskId,
            workspace: { projectId: claim.task.projectId, workspaceId: session.workspaceId } });
        if (read.status !== 'ready') return read;
        taskReviews = read.value;
        const binding = blockedBindingOf(taskReviews, claim.task.taskId);
        if (binding.length > 0) {
          // Rework 2 item 2: the reader is REQUIRED; a thrown read or any
          // non-ready result is `unavailable`, never "the Task is still open".
          let closure;
          try {
            closure = await deps.readTaskClosure(owned, claim.task);
          } catch (error) {
            // F-076: a cancelled read keeps its cancellation; only a genuine
            // failure becomes `unavailable`, and it keeps its message.
            if (signal.aborted) return rejected('cancelled', 'the Task closure read was cancelled');
            return rejected('unavailable', `the Task closure could not be read: ${messageOf(error)}`);
          }
          if (closure.status !== 'ready') {
            // F-076: `cancelled` and the original rejection survive this layer;
            // a missing watermark stays its own failure, never "still open".
            if (closure.status === 'rejected') return closure;
            return rejected('unavailable', closure.status === 'not_found' ? 'the Task is not in the active Plan'
              : 'the Task closure is not readable at the required watermark');
          }
          if (closure.value.closed) {
            // A closed Task carries no binding and no blocked lines.
            taskReviews = [];
          } else {
            blockedBinding = binding;
          }
        }
      }
      // The final tool list is computed ONCE here, after the
      // permissions, frozen-source and material facts are fixed, and frozen as
      // `PromptSetV1.toolNames`. The read-only command gate is the one fact that
      // needs the Host workspace authorization; a failure leaves the tool out
      // and the start decides its own unavailable/forbidden answer.
      const readOnly = writeScopeResult.writeScope.length === 0;
      const readonlyRequested = readOnly && permissions.tools.includes(READONLY_COMMAND_TOOL_NAME);
      // The production Runtime always wires the workspace host; a direct
      // preparation without one cannot read the read policy, so it freezes the
      // capability and the start (which requires the host) re-checks the gate.
      let readonlyAllowsWholeWorkspace = deps.workspaceHost === undefined;
      if (readonlyRequested && deps.workspaceHost !== undefined) {
        try {
          const authorized = await deps.workspaceHost.authorize(owned, {
            aggregateType: 'Workspace', projectId: claim.task.projectId, workspaceId: session.workspaceId,
          });
          readonlyAllowsWholeWorkspace = authorized.status === 'ready' && authorized.value.allowsRead('.');
        } catch { readonlyAllowsWholeWorkspace = false; }
      }
      const finalNames = finalToolNamesOf({
        callKind: 'work',
        noteAdmission: { class: 'none' },
        // Preparation freezes only the names this Runtime knows; an unknown
        // selected name (a rework tool with no registration here) is left to
        // the start, where the real selection and owners are still checked.
        selected: permissions.tools.filter(name => RUNTIME_TOOL_NAMES.has(name)),
        readOnly,
        reviewPhase: reviewPurpose?.phase ?? null,
        hasBlockedCommands: (blockedBinding ?? []).length > 0,
        reviewSource: false,
        frozenSource: permissions.tools.includes('read'),
        materialTools: false,
        // Preparation freezes the CAPABILITY set: the actual owner wiring is
        // re-checked by the same function at start (ruling 16's comparison), so
        // a missing owner there is still `unsupported`. This call site does not
        // hold the Runtime's owner bindings.
        owners: {
          mailbox: true, decisionMessages: true, applicationReceipt: true,
          sessions: true, plans: true, graph: true, notes: true,
          unknownCallReviews: true, commandRerunRequests: true,
        },
        readonlyCommand: {
          requested: readonlyRequested,
          access: hostConfig.readonlyCommandAccess,
          allowsReadWholeWorkspace: readonlyAllowsWholeWorkspace,
        },
      });
      if (!finalNames.ok) return finalNames.rejection;
      const toolNames = finalNames.value;
      // Preparation reads no Kernel history. The Session record
      // already says whether it holds a completed cursor; the recipe only needs
      // that presence, never the cursor's position.
      const history: ContextWorkHistoryInputV1 = {
        callKind: 'work', hasCompletedCursor: session.historyCursor !== null,
      };
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
          texts: tracked.texts, toolNames, history,
          ...(taskReviews === undefined ? {} : { taskReviews }),
        });
      } catch (error) {
        if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled while the context was assembled');
        const renderProblem = promptRenderProblem(error, pack.manifest.packId);
        if (renderProblem !== null) return renderProblem;
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
      // Ruling 14 items 4-6: render the base, merge the Host instruction, select
      // the Skills through the same resolved pack, and store the frozen texts.
      let baseText: string;
      try {
        baseText = renderTemplate(tracked.texts, 'base', {}, toolNames).text;
      } catch (error) {
        const renderProblem = promptRenderProblem(error, pack.manifest.packId);
        if (renderProblem !== null) return renderProblem;
        throw error;
      }
      const mergedBase = baseText + (hostConfig.systemInstruction ? '\n\n' + hostConfig.systemInstruction : '');
      const selectedSkills = await selectPromptSkills(hostConfig.skills, tracked.texts, {
        signal, ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }), toolNames,
      });
      if (selectedSkills.status !== 'ready') return selectedSkills;
      if (signal.aborted) return rejected('cancelled', 'the preparation was cancelled while the Skills were selected');
      // Every used template's declarations must fit the frozen list.
      const usedTemplates = tracked.usedTemplates();
      const declarationProblem = promptDeclarationProblem(pack, usedTemplates, toolNames);
      if (declarationProblem !== null) return declarationProblem;
      // The tool entries the resolved pack supplies for the
      // frozen names only; the raw entries are stored by `storePromptTexts`.
      const toolParts = toolNames.flatMap((name) => {
        const entry = pack.tools[name];
        if (entry === undefined) return [];
        const packId = pack.toolOrigins[name];
        if (packId === undefined) throw new Error(`the resolved prompt pack has no origin for tool ${name}`);
        return [{ name, packId, entry }];
      });
      const promptParts: PromptPartsV1 = {
        selection: { modelId: selection.modelId, provider: boundProvider, model: boundModel,
          packId: pack.manifest.packId, reasoningReplay: selection.reasoningReplay },
        sectionOrder: workPreparedSectionOrder(tracked.texts),
        templates: usedTemplates.map(id => promptTemplatePart(pack, id)),
        strings: pack.strings,
        base: { templateId: 'base', version: promptTemplateVersion(pack, 'base'), text: mergedBase },
        skills: selectedSkills.value,
        toolNames: [...toolNames],
        tools: toolParts,
      };
      const storedPrompts = await storePromptTexts(deps.bodies, { kind: 'run', owner: runRef }, promptParts, deps.now());
      if (storedPrompts.status !== 'ready') {
        return rejected('unavailable', `storing the prepared prompt texts failed: ${storedPrompts.reason}`);
      }
      const promptSet: PromptSetV1 = storedPrompts.value;
      const reviewInput = assembled.value.unknownCallReview;
      // The frozen value comes from the assembly's decision,
      // never recomputed here.
      const takesSessionHistory = assembled.value.takesSessionHistory;
      // Slice 1 §2.7: the anchors the brief's anomaly section names are bound with the input.
      const anomalyAnchorRefs: SessionAnomalyAnchorRef[] | null = assembled.value.anomalyAnchorRefs ?? null;
      const briefDigest = brief === null ? null : continuationBriefDigest(brief);
      // L5: only a Run with a non-empty write scope records a run-start baseline,
      // and only when the workspace root is the git work-tree top level (the same
      // test `VerificationWorkspaceReader.capture` makes). A missing workspace
      // host or any baseline failure leaves the field absent/unavailable and
      // NEVER fails preparation; a cancellation still ends it (slice 8 §13.8).
      const workspaceBaseline = writeScopeResult.writeScope.length === 0
        ? undefined
        : await recordWorkspaceBaseline(deps, owned, session.workspaceId, runRef, hostConfig.deniedPrefixes, sourceRefs);
      if (workspaceBaseline === 'cancelled') {
        return rejected('cancelled', 'the preparation was cancelled during the workspace baseline capture');
      }
      // K3 D8: the review instruction is carried twice in the manifest (the
      // structured field and the rendered `input`), so the whole manifest is
      // measured and the instruction trimmed from the back while over budget.
      const buildManifest = (
        review: UnknownCallReviewInputV1 | undefined,
        inputText: string,
        rerendered?: ReturnType<typeof rerenderContextV1>,
      ): PreparedTaskManifestV1 => {
        // Ruling 13: the shrink replaces the input, every range and the manifest
        // measure from the re-render; omission metadata and the billed
        // `residentBytes` stay the material's.
        const assembly = rerendered === undefined
          ? contextAssembly
          : { ...contextAssembly, totalBytes: rerendered.totalBytes, sections: rerendered.sections };
        return {
          schemaVersion: 1, kind: 'task_execution', claim, role: roleResolution,
          hostTemplate: roleResolution.status === 'resolved' ? null : hostConfig.hostTemplate,
          roleBinding: run.roleBinding, hostConfigurationRevision: hostConfig.configurationRevision, sessionRole: session.role,
          workspaceSnapshot: { workspaceId: session.workspaceId, revision: run.workspaceSnapshot.revision },
          permissions, budget: run.budget, selectedTaskInputs, materialBasis: hostConfig.materialBasis,
          materialAccessRefs: [], additionalMaterialRefs, deliveryRefs: [], sourceRefs,
          contextAssembly: assembly,
          takesSessionHistory,
          promptSet,
          ...(brief === null ? {} : { continuationBrief: brief }),
          ...(sessionBasis === undefined ? {} : { sessionBasis }),
          ...(workspaceBaseline === undefined ? {} : { workspaceBaseline }),
          ...(review === undefined ? {} : { unknownCallReview: review }),
          ...(blockedBinding === undefined ? {} : { blockedCommands: blockedBinding }),
          input: inputText, inputDigest: sha256Hex(inputText),
        };
      };
      let manifest: PreparedTaskManifestV1;
      if (reviewInput === undefined) {
        manifest = buildManifest(undefined, input);
      } else {
        // Ruling 13: each candidate re-renders the whole input from the frozen
        // material with only the review slot replaced; no prefix cut remains.
        const material = assembled.value.renderMaterial;
        try {
          const fit = fitUnknownCallReviewForManifest({
            review: reviewInput,
            render: review => renderUnknownCallReviewZh(review, tracked.texts, toolNames),
            measure: (review, rendered) => {
              const candidate = rerenderContextV1(material, rendered);
              return Buffer.byteLength(JSON.stringify(buildManifest(review, candidate.input, candidate)), 'utf8');
            },
          });
          if (!fit.ok) {
            return rejected('capacity', `the bounded prepared manifest exceeds ${String(MAX_PREPARED_MANIFEST_BYTES)} bytes`);
          }
          const rerendered = rerenderContextV1(material, fit.rendered);
          input = rerendered.input;
          inputDigest = sha256Hex(input);
          manifest = buildManifest(fit.review, input, rerendered);
        } catch (error) {
          const renderProblem = promptRenderProblem(error, pack.manifest.packId);
          if (renderProblem !== null) return renderProblem;
          throw error;
        }
      }
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

/** One used template's pack identity and exact text (ruling 14 item 6). */
function promptTemplatePart(pack: ResolvedPromptPackV1, id: string) {
  const text = pack.templates[id];
  if (text === undefined) throw new Error(`the resolved prompt pack has no template ${id}`);
  return { id, version: promptTemplateVersion(pack, id), packId: pack.origins[id]?.packId ?? pack.manifest.packId, text };
}

function promptTemplateVersion(pack: ResolvedPromptPackV1, id: string): number {
  return pack.origins[id]?.version ?? pack.manifest.templates[id]?.version ?? 1;
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
    // Ruling 14 item 1: a field-by-field rebuild must not drop the selection.
    ...(config.model.selection === undefined ? {} : { selection: { ...config.model.selection } }),
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
  if (decodePromptSetV1(parsed['promptSet']) === null) {
    return rejected('invalid', 'the prepared manifest has no valid prompt set');
  }
  const manifest = parsed as unknown as PreparedTaskManifestV1;
  if (!sameJsonText(manifest.claim, prepared.claim)) return rejected('invalid', 'the prepared manifest claim disagrees with the returned claim');
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
    if (!sameJsonText(left, right)) return rejected('invalid', 'the Prepared envelope disagrees with the persisted manifest');
  }
  return { status: 'ready', value: { manifest, bundleRef } };
}
