/**
 * R5b.2 one-fresh-Query-run driver.
 *
 * This is the thin driver around the ONE existing `runObservedModel`: it
 * re-reads the persisted bounded manifest, fixes the Kernel identity, requires a
 * fresh `beginQueryEntry` before it may call the model, persists the real
 * reservation before the awaited admission, records the real entered fact in the
 * awaited `before_model` barrier and then reconciles the original history. An
 * already begun/entered/settled QueryRun is only observed. It never invents a
 * second model loop and never copies ModelBudget/meter logic.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { ModelCallAccess, TaskBudgetV1 } from '../../contracts/dispatch.js';
import type { QueryModelUsageV1, QueryRunRef } from '../../contracts/query-job.js';
import type { HookPort } from '../../../vendor/coding-agent/dist/public-api.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import type { SourceToolOptions } from './exploration-tools.js';
import { ModelBudget, type MeterEntry } from './model-budget.js';
import { RuntimeModelCallRejected } from './model-call-access.js';
import { runObservedModel } from './observed-model-run.js';
import { projectQueryConfiguration } from './query-preparation.js';
import { createQueryObservation } from './query-observation.js';
import { createQuerySourceCaptureFactory } from './source-capture-access.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';
import type { RuntimeSourceCaptureFactory } from './source-tool-ports.js';
import type {
  ResolvedRuntimeConfiguration, RuntimeExecutionDependencies, StartQueryExecutionRequest,
} from './execution-contracts.js';
import type {
  QueryEntryIdentity, QueryExecutionRecord,
} from '../work-graph/queries/contracts.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { RawArtifactRecord } from '../record-store/body-ports.js';

export type QueryExecutionDriverPort = {
  start(ctx: CoreCallContext, request: StartQueryExecutionRequest): Promise<ReadResult<QueryExecutionRecord>>;
};

const QUERY_MANIFEST_CONTENT_TYPE = 'application/vnd.coding-platform.query-execution-manifest+json;version=1';
const BUILTIN_TOOL_NAMES = new Set<string>(['read', 'write', 'shell']);
const CORE_ERROR_CODES = new Set<string>(['invalid', 'forbidden', 'not_found', 'source_stale', 'capacity', 'unsupported', 'unavailable', 'cancelled']);

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
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
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
function mapWorkspace(result: { status: 'rejected'; code: string; reason: string }): CoreRejection {
  return rejected((CORE_ERROR_CODES.has(result.code) ? result.code : 'unavailable') as CoreRejection['code'], result.reason);
}

async function loadManifest(
  bodies: RuntimeExecutionDependencies['bodies'],
  prepared: PreparedQueryExecution,
): Promise<ReadResult<{ manifest: PreparedQueryManifestV1; bundleRef: ArtifactRef }>> {
  const bundleRef = prepared?.bundleRef;
  if (!isRecord(prepared) || !isRecord(bundleRef) || bundleRef.contentType !== QUERY_MANIFEST_CONTENT_TYPE
    || !nonEmpty(bundleRef.digest) || !Number.isSafeInteger(bundleRef.sizeBytes) || bundleRef.sizeBytes < 0) {
    return rejected('invalid', 'the Prepared Query value is incomplete');
  }
  let stored;
  try {
    stored = await bodies.read(bundleRef);
  } catch (error) {
    return rejected('unavailable', `reading the Query manifest failed: ${messageOf(error)}`);
  }
  if (stored.status !== 'ready') return rejected('invalid', 'the Query manifest body is not readable');
  const record: RawArtifactRecord = stored.value;
  if (record.ref.contentType !== bundleRef.contentType || record.ref.digest !== bundleRef.digest || record.ref.sizeBytes !== bundleRef.sizeBytes) {
    return rejected('invalid', 'the stored Query manifest reference disagrees with the Prepared envelope');
  }
  if (sha256Hex(record.body) !== bundleRef.digest || Buffer.byteLength(record.body, 'utf8') !== bundleRef.sizeBytes) {
    return rejected('invalid', 'the stored Query manifest bytes do not match their content digest');
  }
  if (record.origin.kind !== 'run' || !sameRef(record.origin.owner, prepared.queryRunRef)) {
    return rejected('forbidden', 'the stored Query manifest is not owned by this QueryRun');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(record.body); } catch { return rejected('invalid', 'the Query manifest is not valid JSON'); }
  if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'query_execution'
    || !sameRef(parsed['queryRunRef'], prepared.queryRunRef) || typeof parsed['input'] !== 'string' || !nonEmpty(parsed['inputDigest'])) {
    return rejected('invalid', 'the Query manifest is not a complete query-execution manifest');
  }
  const manifest = parsed as unknown as PreparedQueryManifestV1;
  if (sha256Hex(manifest.input) !== manifest.inputDigest) return rejected('invalid', 'the Query manifest input digest is not the digest of its input');
  if (manifest.inputDigest !== prepared.inputDigest) return rejected('invalid', 'the Query manifest input digest disagrees with the Prepared value');
  return { status: 'ready', value: { manifest, bundleRef } };
}

function projectMeterEntry(entry: MeterEntry): QueryModelUsageV1 {
  if (!nonEmpty(entry.inputDigest)) throw new Error('the Query model request has no real input digest');
  return {
    requestId: entry.requestId,
    requestDigest: entry.inputDigest,
    reservedInput: entry.reservedInput,
    reservedOutput: entry.reservedOutput,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cachedInputTokens: entry.cachedInputTokens,
    usageStatus: entry.status,
  };
}

export function createQueryExecutionDriver(deps: RuntimeExecutionDependencies): QueryExecutionDriverPort {
  const observation = createQueryObservation(deps);
  return {
    async start(ctx: CoreCallContext, request: StartQueryExecutionRequest): Promise<ReadResult<QueryExecutionRecord>> {
      if (deps.queryExecution === undefined) return rejected('unsupported', 'startQuery requires the trusted QueryExecutionPort');
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      if (owned.principal.kind !== 'host') return rejected('forbidden', 'startQuery requires a trusted Host call context');
      const signal = owned.signal;
      if (signal.aborted) return rejected('cancelled', 'the Query start was cancelled before the prepared body was re-read');
      const rawPrepared = request?.prepared;
      const rawRef = rawPrepared?.queryRunRef;
      if (!isRecord(rawPrepared) || !isRecord(rawRef) || rawRef.aggregateType !== 'QueryRun'
        || !nonEmpty(rawRef.projectId) || !nonEmpty(rawRef.workspaceId) || !nonEmpty(rawRef.queryJobId) || !nonEmpty(rawRef.runId)) {
        return rejected('invalid', 'startQuery requires a prepared Query execution with a complete QueryRunRef');
      }
      if (!nonEmpty(request.consumerId) || !nonEmpty(request.requestId)) return rejected('invalid', 'startQuery requires a consumerId and a requestId');
      let prepared: PreparedQueryExecution;
      let queryRunRef: QueryRunRef;
      const consumerId: string = request.consumerId;
      const requestId: string = request.requestId;
      try {
        prepared = structuredClone(rawPrepared);
        queryRunRef = structuredClone(rawRef) as QueryRunRef;
      } catch { return rejected('invalid', 'the start request cannot be isolated from the caller'); }
      if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
        return rejected('forbidden', 'the QueryRun is outside the Host call scope');
      }

      const loaded = await loadManifest(deps.bodies, prepared);
      if (loaded.status !== 'ready') return loaded;
      const manifest = loaded.value.manifest;

      const read = await deps.queryExecution.readQueryExecution(owned, queryRunRef);
      if (read.status !== 'ready') return read;
      const record = read.value;
      const state = record.run.run.executionState;
      if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
      if (!sameRef(manifest.queryRunRef, queryRunRef) || !sameRef(manifest.sessionRef, state.sessionRef)
        || manifest.sessionGeneration !== state.sessionGeneration || manifest.inputDigest !== prepared.inputDigest) {
        return rejected('invalid', 'the persisted Query manifest disagrees with the claimed execution state');
      }
      if (state.phase !== 'claimed' && state.phase !== 'prepared') {
        // Already begun/entered/settled: observe the original execution instead
        // of authorizing a second Kernel call.
        return observation.observe(owned, { queryRunRef });
      }
      if (state.phase !== 'prepared') return rejected('incomplete', 'the QueryRun has not been prepared');
      const execution = record.job.job.intent.execution;
      if (execution === undefined) return rejected('unsupported', 'startQuery requires an explicit read-only execution binding');
      if (signal.aborted) return rejected('cancelled', 'the Query start was cancelled before the Host configuration read');

      if (deps.host.resolveQueryConfiguration === undefined) {
        return rejected('unsupported', 'startQuery requires the trusted Query Host configuration binding');
      }
      let configured;
      try {
        configured = await deps.host.resolveQueryConfiguration(owned, {
          queryRunRef, sessionRef: state.sessionRef, role: state.role, roleResolution: state.roleResolution,
        });
      } catch (error) {
        return rejected('unavailable', `Host Query configuration resolution failed: ${messageOf(error)}`);
      }
      if (configured.status !== 'ready') return mapRead(configured);
      const projected = projectQueryConfiguration({ host: configured.value, requested: execution.runtimeBudget, roleResolution: state.roleResolution });
      if (projected.configurationRevision !== manifest.hostConfigurationRevision
        || !sameRef(projected.permissions, manifest.permissions)
        || !sameRef(projected.budget, manifest.runtimeBudget)
        || !sameRef({ template: projected.hostTemplate }, { template: manifest.hostTemplate })) {
        return rejected('forbidden', 'the prepared Query permissions no longer fit the current Host and Role ceilings');
      }
      const hostConfig: ResolvedRuntimeConfiguration = configured.value;
      const builtinTools = manifest.permissions.tools.filter(tool => BUILTIN_TOOL_NAMES.has(tool));
      const hasFileRead = builtinTools.includes('read');

      const kernel: QueryEntryIdentity['kernel'] = {
        adapterId: record.session.kernel.adapterId,
        kernelSessionId: record.session.kernel.kernelSessionId,
        runId: 'krun-' + sha256Hex(canonicalJson(queryRunRef)),
        turnId: 'kturn-' + sha256Hex(canonicalJson({ queryRunRef, entryGeneration: 1, consumerId } as unknown as JsonValue)),
      };
      const sessionRef = { aggregateType: 'Session' as const, projectId: queryRunRef.projectId, sessionId: state.sessionRef.sessionId };
      let begun;
      try {
        begun = await deps.queryExecution.beginQueryEntry(owned, {
          input: { prepared, consumerId, kernel },
          meta: {
            requestId: `r5b-query-begin:${requestId}`,
            expected: [
              { ref: { aggregateType: 'QueryJob', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId }, revision: record.job.revision },
              { ref: queryRunRef, revision: record.run.revision },
              { ref: sessionRef, revision: record.session.revision },
            ],
          },
        });
      } catch (error) {
        return rejected('unavailable', `beginning the Query entry failed: ${messageOf(error)}`);
      }
      if (begun.status !== 'committed') return begun;
      if (begun.replayed) return observation.observe(owned, { queryRunRef });
      const ticket = begun.value;
      if (ticket.consumerId !== consumerId || !sameRef(ticket.kernel, kernel)) {
        return rejected('unavailable', 'the committed Query entry ticket disagrees with the fresh begin');
      }
      const entry: QueryEntryIdentity = {
        queryRunRef,
        sessionRef: ticket.sessionRef,
        sessionGeneration: ticket.sessionGeneration,
        entryGeneration: ticket.entryGeneration,
        consumerId: ticket.consumerId,
        kernel: { ...ticket.kernel },
      };

      const workspace = { aggregateType: 'Workspace' as const, projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId };
      let rootResolved;
      try {
        rootResolved = await deps.workspaceHost.resolveRoot(workspace);
      } catch (error) {
        return rejected('unavailable', `resolving the Query workspace root failed: ${messageOf(error)}`);
      }
      if (rootResolved.status !== 'ready') return mapWorkspace(rootResolved);
      if (rootResolved.value.workspaceRevision !== manifest.workspace.revision) {
        return rejected('source_stale', 'the workspace revision moved since the QueryRun was prepared');
      }
      const location = deps.kernelStores.byAdapterId(record.session.kernel.adapterId);
      if (!location || 'expectedSessionId' in location) return rejected('unsupported', 'the prepared Query Session is not mapped to a current Kernel store');
      if (!nonEmpty(location.databasePath)) return rejected('unsupported', 'the mapped Kernel store has no database path');

      let sourceTools: SourceToolOptions | undefined;
      let sourceFactory: RuntimeSourceCaptureFactory | undefined;
      if (hasFileRead) {
        let currentAuthorization;
        try {
          currentAuthorization = await deps.workspaceHost.authorize(owned, workspace);
        } catch (error) {
          return rejected('unavailable', `the Host read policy could not be resolved: ${messageOf(error)}`);
        }
        if (currentAuthorization.status !== 'ready') return mapWorkspace(currentAuthorization);
        const permissionRevision = currentAuthorization.value.permissionRevision;
        const granted = currentAuthorization.value;
        sourceTools = {
          allowedPath: (path: string) => granted.allowsRead(path),
          assertCurrent: async () => {
            const current = await deps.workspaceHost.authorize(owned, workspace);
            if (current.status !== 'ready' || current.value.permissionRevision !== permissionRevision) {
              throw new Error('the Host read policy is no longer current for this QueryRun');
            }
          },
        };
        const executionRequest = {
          runRef: { ...queryRunRef },
          bundleRef: structuredClone(prepared.bundleRef),
          question: record.job.job.intent.question,
          budget: { maxTokens: record.job.job.intent.budget.maxTokens },
        };
        sourceFactory = createQuerySourceCaptureFactory(
          {
            authority: deps.sourceAuthority,
            ...(deps.sourcePolicyFor === undefined ? {} : { sourcePolicyFor: deps.sourcePolicyFor }),
            hostSignal: signal,
            now: deps.now,
          },
          executionRequest,
          rootResolved.value.root,
        );
      }

      const taskBudget: TaskBudgetV1 = { tokenBudget: record.job.job.intent.budget.maxTokens, deadline: record.job.job.intent.budget.deadline };
      const meter = new ModelBudget(manifest.runtimeBudget, async (entries) => {
        const projectedEntries = entries.map(projectMeterEntry);
        const usageRequestId = `r5b-query-usage:${queryRunRef.runId}:${sha256Hex(canonicalJson(projectedEntries as unknown as JsonValue))}`;
        let lastReason = 'unknown';
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = await deps.queryExecution!.readQueryExecution(owned, queryRunRef);
          if (current.status !== 'ready') throw new Error('the QueryRun version could not be read before the usage write');
          const write = await deps.queryExecution!.recordQueryUsage(owned, {
            input: { entry, entries: projectedEntries },
            meta: { requestId: usageRequestId, expected: [{ ref: queryRunRef, revision: current.value.run.revision }] },
          });
          if (write.status === 'committed') return;
          lastReason = write.reason;
          if (write.code !== 'revision_conflict') break;
        }
        throw new Error('persisting the Query usage failed: ' + lastReason);
      }, hostConfig.model.inputCounter, taskBudget, deps.now);

      const modelCalls: ModelCallAccess = {
        async bind(input) {
          if (input.inputDigest !== manifest.inputDigest || input.manifestDigest !== prepared.bundleRef.digest) {
            throw new RuntimeModelCallRejected('invalid', 'the Query input binding disagrees with the persisted manifest');
          }
        },
        async beforeCall(input) {
          let lastReason = 'unknown';
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const current = await deps.queryExecution!.readQueryExecution(owned, queryRunRef);
            if (current.status !== 'ready') {
              throw new RuntimeModelCallRejected('unavailable', 'the QueryRun version could not be read before the model admission');
            }
            const write = await deps.queryExecution!.admitQueryModelRequest(owned, {
              input: {
                entry, requestId: input.requestId, requestDigest: input.requestDigest,
                contextInputDigest: input.contextInputDigest, manifestDigest: input.manifestDigest,
              },
              meta: { requestId: `r5b-query-admit:${input.requestId}`, expected: [{ ref: queryRunRef, revision: current.value.run.revision }] },
            });
            if (write.status === 'committed') {
              if (write.replayed) throw new RuntimeModelCallRejected('forbidden', 'the Query model request was already admitted');
              return;
            }
            lastReason = write.reason;
            if (write.code !== 'revision_conflict') throw new RuntimeModelCallRejected(write.code, write.reason);
          }
          throw new RuntimeModelCallRejected('revision_conflict', lastReason);
        },
      };
      try {
        await modelCalls.bind({
          inputDigest: manifest.inputDigest,
          manifestDigest: prepared.bundleRef.digest,
        });
      } catch (error) {
        if (error instanceof RuntimeModelCallRejected) return rejected(error.code, error.message);
        return rejected('unavailable', `binding the Query input failed: ${messageOf(error)}`);
      }

      let enteredFailure: CoreRejection | undefined;
      let enteredDone = false;
      const shouldPause = (reason: string): { point: 'before_model'; kind: 'pause'; reason: string } => ({ point: 'before_model', kind: 'pause', reason });
      const enteredHook: HookPort = {
        hookId: 'r5b-query-entered', point: 'before_model', priority: 1_000_000,
        async execute(): Promise<{ point: 'before_model'; kind: 'continue' } | { point: 'before_model'; kind: 'pause'; reason: string }> {
          if (!enteredDone) {
            let entered;
            try {
              entered = await observation.onEntered(owned, { entry, occurredAt: deps.now() });
            } catch (error) {
              enteredFailure = rejected('unavailable', `recording the Query entry failed: ${messageOf(error)}`);
              return shouldPause('entered write failed');
            }
            if (entered.status !== 'ready') {
              enteredFailure = entered.status === 'not_found' || entered.status === 'not_ready'
                ? rejected('incomplete', 'the entered Query observation was not ready')
                : entered;
              return shouldPause('entered rejected');
            }
            enteredDone = true;
          }
          if (taskBudget.deadline !== null) {
            const nowMs = Date.parse(deps.now());
            const deadlineMs = Date.parse(taskBudget.deadline);
            if (!Number.isFinite(nowMs) || !Number.isFinite(deadlineMs) || nowMs >= deadlineMs) {
              enteredFailure = rejected('capacity', 'the persistent Query deadline passed before the provider request');
              return shouldPause('deadline passed');
            }
          }
          return { point: 'before_model', kind: 'continue' };
        },
      };
      const toolPathHook: HookPort = {
        hookId: 'r5b-query-tool-path', point: 'before_tool', priority: 0,
        async execute(invocation): Promise<{ point: 'before_tool'; kind: 'continue' } | { point: 'before_tool'; kind: 'block'; reason: string }> {
          if (invocation.call.name !== 'read') return { point: 'before_tool', kind: 'continue' };
          const path = isRecord(invocation.call.arguments) ? invocation.call.arguments['path'] : undefined;
          if (typeof path !== 'string' || path.length === 0) return { point: 'before_tool', kind: 'block', reason: 'read requires a workspace-relative path' };
          let authorized;
          try {
            authorized = await deps.workspaceHost.authorize(owned, workspace);
          } catch (error) {
            return { point: 'before_tool', kind: 'block', reason: `the Host read policy could not be verified: ${messageOf(error)}` };
          }
          if (authorized.status !== 'ready' || !authorized.value.allowsRead(path)) {
            return { point: 'before_tool', kind: 'block', reason: 'the Host read policy does not allow this path' };
          }
          return { point: 'before_tool', kind: 'continue' };
        },
      };

      const cursorOwner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });
      let boundary;
      try {
        boundary = await cursorOwner.completedBoundary({ session: record.session, signal });
      } catch (error) {
        return rejected('unavailable', `reading the completed Query history boundary failed: ${messageOf(error)}`);
      }
      if (boundary.status === 'rejected') return boundary;
      const sessionContext = boundary.cursor === null
        ? { version: 1 as const, mode: 'current_turn' as const }
        : { version: 1 as const, mode: 'session_history' as const, throughPosition: boundary.position };

      try {
        await runObservedModel({
          kernel: deps.kernel,
          bound: hostConfig.model,
          meter,
          root: rootResolved.value.root,
          databasePath: location.databasePath,
          sessionId: record.session.kernel.kernelSessionId,
          input: manifest.input,
          budget: manifest.runtimeBudget,
          readOnly: true,
          taskBudget,
          now: deps.now,
          sessionContext,
          executionIdentity: { runId: kernel.runId, turnId: kernel.turnId },
          signal,
          deniedPrefixes: hostConfig.deniedPrefixes,
          modelCalls,
          manifestDigest: prepared.bundleRef.digest,
          allowedTools: builtinTools,
          controlHooks: hasFileRead ? [enteredHook, toolPathHook] : [enteredHook],
          skills: hostConfig.skills,
          ...(hostConfig.systemInstruction === null ? {} : { systemInstruction: hostConfig.systemInstruction }),
          processSandboxOptions: hostConfig.processSandboxOptions,
          ...(sourceTools === undefined ? {} : { sourceTools }),
          ...(sourceFactory === undefined ? {} : { projectSource: { mode: 'frozen' as const, open: sourceFactory, openOn: 'first_use' as const } }),
          publish: async () => { /* best-effort live events are never terminal evidence */ },
        });
      } catch (error) {
        if (error instanceof RuntimeModelCallRejected) enteredFailure ??= rejected(error.code, error.message);
      }
      if (enteredFailure !== undefined) return enteredFailure;
      const reconcileSignal = new AbortController().signal;
      return observation.observe({ ...owned, signal: reconcileSignal }, { queryRunRef });
    },
  };
}
