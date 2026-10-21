/**
 * R5b.2 bounded Query input preparation.
 *
 * Reads the real Goal/Workspace and the optional accepted focus Plan from the
 * SAME records the claim already bound, resolves the trusted Host Query
 * configuration, intersects it with the stable Role ceiling and the read-only
 * Query ceiling, stores one bounded manifest body through the existing raw body
 * store under the Query's own owner, and asks the internal Query writer to bind
 * it. Nothing is fabricated: a missing fact, an inadmissible Role, a revoked
 * Host grant or a manifest over the Artifact capacity is an explicit rejection.
 */
import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import { sha256Hex } from '../../contracts/fingerprint.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../../contracts/no-progress.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import { plainSessionRefToAggregate } from '../work-graph/sessions/session-record-codecs.js';
import { SESSION_MAILBOX_TOOL_NAMES } from './communication-tools.js';
import { WHITEBOARD_TOOL_NAMES } from './whiteboard-tools.js';
import type { ContextAssembler } from './context-assembler.js';
import { createContextAssembler } from './context-assembler.js';
import type {
  PrepareQueryExecutionRequest, ResolvedRuntimeConfiguration, RuntimeExecutionDependencies,
} from './execution-contracts.js';

export type QueryPreparationPort = {
  prepare(ctx: CoreCallContext, request: PrepareQueryExecutionRequest): Promise<ReadResult<PreparedQueryExecution>>;
};

/** Exact manifest content type (declared once in contracts, ND-9); the Query writer re-reads the body and requires this. */
export { QUERY_MANIFEST_CONTENT_TYPE };
export const MAX_QUERY_MANIFEST_BYTES = ARTIFACT_MAX_SIZE_BYTES;

/**
 * R5b.4 §11.3 initial_coordination response guide seam.
 *
 * The ONE response contract for a verified `initial_coordination` Query. It
 * upgrades the legacy reply to the v2 protocol: plan identity is derived by the
 * platform, a `plan_only` task may omit assignment/acceptance, and the model
 * never invents a gate, dependency, assignment or Role binding. Stage one
 * declares the seam only; ordinary Query preparation is unchanged and does not
 * inject it. Stage two appends it to the bounded Query input for exactly the
 * verified `initial_coordination` request, using the same trusted Role/Skill/
 * Host configuration, and adds no write-tool grant.
 */
export const INITIAL_COORDINATION_RESPONSE_GUIDE = PLATFORM_PROMPT_PACK_V1.templates['initial-planning-answer'];

/**
 * The read-only Query ceiling: no file mutation, no shell and no platform
 * communication/whiteboard writers, regardless of what the Host grant or the
 * Role ceiling declare. Declaring a name here grants nothing; it is the outer
 * intersection applied AFTER the Host grant and Role ceiling.
 */
const FORBIDDEN_QUERY_TOOL_NAMES = new Set<string>([
  'write', 'edit', 'shell', ...SESSION_MAILBOX_TOOL_NAMES, ...WHITEBOARD_TOOL_NAMES,
]);

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
  if (result.status === 'not_found') return rejected('not_found', 'the required Query fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required Query fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}

/** Per-field intersection of two runtime budgets: null means "no limit", so a
 * value in either side is the tighter bound and both-null stays null. */
function tightenRuntimeBudget(requested: RuntimeBudget, host: RuntimeBudget): RuntimeBudget {
  const tighten = (left: number | null, right: number | null): number | null => {
    if (left === null) return right;
    if (right === null) return left;
    return Math.min(left, right);
  };
  return {
    contextWindowTokens: Math.min(requested.contextWindowTokens, host.contextWindowTokens),
    inputTokens: tighten(requested.inputTokens, host.inputTokens),
    outputTokens: tighten(requested.outputTokens, host.outputTokens),
    maxRequests: tighten(requested.maxRequests, host.maxRequests),
    maxToolCalls: tighten(requested.maxToolCalls, host.maxToolCalls),
    timeoutMs: tighten(requested.timeoutMs, host.timeoutMs),
    perResponseTokens: Math.min(requested.perResponseTokens, host.perResponseTokens),
  };
}

/**
 * The ONE trusted Query Host projection: the real Host resolution intersected
 * with the stable Role ceiling and the read-only Query ceiling. It never echoes
 * a manifest declaration and never widens the Host grant.
 */
export function projectQueryConfiguration(input: {
  host: ResolvedRuntimeConfiguration;
  requested: RuntimeBudget;
  roleResolution: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
}): {
  configurationRevision: string;
  permissions: { tools: string[]; writeScope: [] };
  hostTemplate: PreparedQueryManifestV1['hostTemplate'];
  budget: RuntimeBudget;
} {
  const ceiling = input.roleResolution.status === 'resolved'
    ? new Set(input.roleResolution.spec.permissions.tools)
    : null;
  const tools = input.host.tools.filter(tool => !FORBIDDEN_QUERY_TOOL_NAMES.has(tool)
    && (ceiling === null || ceiling.has(tool)));
  return {
    configurationRevision: input.host.configurationRevision,
    permissions: { tools, writeScope: [] },
    hostTemplate: input.host.hostTemplate === null ? null : { ...input.host.hostTemplate },
    budget: tightenRuntimeBudget(input.requested, input.host.budget),
  };
}

export function createQueryPreparation(deps: RuntimeExecutionDependencies, contextAssembler?: ContextAssembler): QueryPreparationPort {
  // §4.2/G5.7: a missing second argument constructs the same one assembler once.
  const assembler = contextAssembler ?? createContextAssembler(deps);
  return {
    async prepare(ctx: CoreCallContext, request: PrepareQueryExecutionRequest): Promise<ReadResult<PreparedQueryExecution>> {
      if (deps.queryExecution === undefined) {
        return rejected('unsupported', 'prepareQuery requires the trusted QueryExecutionPort');
      }
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      if (owned.principal.kind !== 'host') return rejected('forbidden', 'prepareQuery requires a trusted Host call context');
      const signal = owned.signal;
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled before the execution read');
      const rawRef = request?.queryRunRef;
      if (!isRecord(rawRef) || rawRef['aggregateType'] !== 'QueryRun' || !nonEmpty(rawRef['projectId'])
        || !nonEmpty(rawRef['workspaceId']) || !nonEmpty(rawRef['queryJobId']) || !nonEmpty(rawRef['runId'])) {
        return rejected('invalid', 'prepareQuery requires a complete QueryRunRef');
      }
      let queryRunRef;
      try { queryRunRef = structuredClone(rawRef); } catch { return rejected('invalid', 'the prepare request cannot be isolated from the caller'); }
      if (!nonEmpty(request.requestId)) return rejected('invalid', 'prepareQuery requires a requestId');
      if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
        return rejected('forbidden', 'the QueryRun is outside the Host call scope');
      }
      const requestId: string = request.requestId;

      let facts;
      try {
        facts = await deps.queryExecution.readPreparationFacts(owned, queryRunRef);
      } catch (error) {
        return rejected('unavailable', `the Query preparation facts read failed: ${messageOf(error)}`);
      }
      if (facts.status !== 'ready') return mapRead(facts);
      const { record, goal, workspace, focusPlan } = facts.value;
      const executionState = record.run.run.executionState;
      if (executionState === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
      if (executionState.phase !== 'claimed' && executionState.phase !== 'prepared') {
        return rejected('busy', `the QueryRun is not awaiting preparation (phase ${executionState.phase})`);
      }
      const execution = record.job.job.intent.execution;
      // Idempotent prepare: a run already bound to a manifest returns the exact
      // persisted references instead of storing a second manifest.
      if (executionState.phase === 'prepared') {
        if (executionState.prepared === null) return rejected('incomplete', 'the prepared QueryRun has no persisted manifest reference');
        return { status: 'ready', value: { queryRunRef, bundleRef: structuredClone(executionState.prepared.bundleRef), inputDigest: executionState.prepared.inputDigest } };
      }
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled after the facts read');

      if (deps.host.resolveQueryConfiguration === undefined) {
        return rejected('unsupported', 'prepareQuery requires the trusted Query Host configuration binding');
      }
      let configured;
      try {
        configured = await deps.host.resolveQueryConfiguration(owned, {
          queryRunRef,
          sessionRef: executionState.sessionRef,
          role: executionState.role,
          roleResolution: executionState.roleResolution,
        });
      } catch (error) {
        return rejected('unavailable', `Host Query configuration resolution failed: ${messageOf(error)}`);
      }
      if (configured.status !== 'ready') return mapRead(configured);
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled after the Host configuration read');
      const projected = projectQueryConfiguration({
        host: configured.value,
        requested: execution.runtimeBudget,
        roleResolution: executionState.roleResolution,
      });
      const hostTemplate = executionState.roleResolution.status === 'resolved' ? null : projected.hostTemplate;
      if (executionState.roleResolution.status === 'absent') {
        if (hostTemplate === null) return rejected('unsupported', 'an absent Role spec requires a trusted Host legacy template');
        if (executionState.role.kind !== 'legacy_template'
          || executionState.role.templateId !== hostTemplate.templateId
          || executionState.role.templateRevision !== hostTemplate.revision) {
          return rejected('forbidden', 'the Host legacy template does not match the Session legacy template');
        }
      }

      const goalRevision = goal.revision;
      const workspaceRevision = workspace.revision;
      const sourceRefs: SourceRefV1[] = [
        { kind: 'workspace', refId: workspace.ref.workspaceId, revision: String(workspaceRevision) },
      ];
      if (focusPlan !== null) {
        sourceRefs.push({ kind: 'plan-revision', refId: focusPlan.ref.planId, revision: String(focusPlan.planRevision) });
      }
      const question = execution.kind === 'initial_coordination'
        ? `${record.job.job.intent.question}\n\n${INITIAL_COORDINATION_RESPONSE_GUIDE}`
        : record.job.job.intent.question;
      // Slice 3 C7 (§4.2/§4.3): the ONE assembler owns the Query text and its
      // binding. A non-ready assembler result is propagated unchanged; its
      // rejection (in particular a failing `graphContext` read) is passed back as-is.
      let assembled;
      try {
        assembled = await assembler.assembleQuery(owned, {
          facts: facts.value,
          role: executionState.roleResolution,
          configuration: configured.value,
          permissions: projected.permissions,
          question,
        });
      } catch (error) {
        return rejected('unavailable', `the Query context assembly failed: ${messageOf(error)}`);
      }
      if (assembled.status !== 'ready') return assembled;
      const input = assembled.value.input;
      const contextAssembly = assembled.value.binding;
      const inputDigest = sha256Hex(input);
      // The query's formal isolated derivation decides the Kernel session basis.
      const consultationDerivation = execution.kind === 'semantic_query' ? execution.consultation?.derivation : undefined;
      const sessionBasis = consultationDerivation === undefined ? undefined : {
        sourceKernelSessionId: consultationDerivation.sourceKernel.kernelSessionId,
        throughPosition: consultationDerivation.throughPosition,
      };
      const manifest: PreparedQueryManifestV1 = {
        schemaVersion: 1,
        kind: 'query_execution',
        queryRunRef,
        sessionRef: executionState.sessionRef,
        sessionGeneration: executionState.sessionGeneration,
        roleBinding: executionState.roleBinding,
        sessionRole: executionState.role,
        role: executionState.roleResolution,
        hostTemplate,
        hostConfigurationRevision: projected.configurationRevision,
        goal: { ref: goal.ref, revision: goalRevision },
        workspace: { ref: workspace.ref, revision: workspaceRevision },
        focusPlan: focusPlan === null ? null : { ref: focusPlan.ref, revision: focusPlan.planRevision },
        permissions: projected.permissions,
        runtimeBudget: projected.budget,
        budget: { tokenBudget: record.job.job.intent.budget.maxTokens, deadline: record.job.job.intent.budget.deadline },
        sourceRefs,
        ...(sessionBasis === undefined ? {} : { sessionBasis }),
        contextAssembly,
        input,
        inputDigest,
      };
      const manifestJson = JSON.stringify(manifest);
      if (Buffer.byteLength(manifestJson, 'utf8') > MAX_QUERY_MANIFEST_BYTES) {
        return rejected('capacity', `the bounded Query manifest exceeds ${String(MAX_QUERY_MANIFEST_BYTES)} bytes`);
      }
      let stored;
      try {
        stored = await deps.bodies.put({
          body: manifestJson,
          contentType: QUERY_MANIFEST_CONTENT_TYPE,
          sourceRefs,
          origin: { kind: 'run', owner: queryRunRef },
          requestedAt: deps.now(),
        });
      } catch (error) {
        return rejected('unavailable', `storing the Query manifest failed: ${messageOf(error)}`);
      }
      if (stored.status !== 'ready') {
        const code = stored.reason !== undefined && stored.reason.includes('size') ? 'capacity' : 'unavailable';
        return rejected(code, `storing the Query manifest failed: ${stored.reason}`);
      }
      const prepared: PreparedQueryExecution = {
        queryRunRef,
        bundleRef: stored.value.ref,
        inputDigest,
      };
      let bound;
      try {
        bound = await deps.queryExecution.bindPreparedQuery(owned, {
          input: { prepared },
          meta: {
            requestId: `r5b-query-bind:${requestId}`,
            expected: [
              { ref: queryRunRef, revision: record.run.revision },
              { ref: plainSessionRefToAggregate(executionState.sessionRef), revision: record.session.revision },
            ],
          },
        });
      } catch (error) {
        return rejected('unavailable', `binding the prepared Query manifest failed: ${messageOf(error)}`);
      }
      if (bound.status !== 'committed') return bound;
      return { status: 'ready', value: prepared };
    },
  };
}
