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
import { messageOf } from '../../contracts/error-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../contracts/validation/common.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { ModelCallAccess } from '../../contracts/dispatch.js';
import { queryExecutionBindingOf, type QueryModelUsageV1, type QueryRunRef } from '../../contracts/query-job.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type { HookPort, ToolCall } from '../../../vendor/coding-agent/dist/public-api.js';
import { canonicalJson, sameJson as sameRef, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import {
  decodePromptSetV1, promptSelectionOf, type ModelRequestPromptFactsV1, type PromptSetV1,
  type QueryRequestPromptFactsV1,
} from '../../contracts/prompts/prompt-set.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../../contracts/no-progress.js';
import { GRAPH_TOOL_NAMES } from './graph-tools.js';
import type { SourceToolOptions } from './exploration-tools.js';
import { ModelBudget, type MeterEntry, type ModelTokenBudget } from './model-budget.js';
import { RuntimeModelCallRejected } from './model-call-access.js';
import { runObservedModel } from './observed-model-run.js';
import { readPromptTexts } from './prompt-set-texts.js';
import { registerReadonlyCommandTool, READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import { createMailboxInputSupply } from './execution-inputs.js';
import { projectQueryConfiguration } from './query-preparation.js';
import { createQueryObservation } from './query-observation.js';
import { createQuerySourceCaptureFactory } from './source-capture-access.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';
import { createQueryGraphToolGroup, finalToolNamesOf, type ToolGroup } from './tool-group-assembly.js';
import { createNoteTools, NOTE_TOOL_NAMES, type NoteToolsHandle } from './note-tool.js';
import type { NoteCheckPort, NoteWritePort } from '../work-graph/model/note-contracts.js';
import type { QueryNoteAdmissionV1 } from '../work-graph/model/secretary-note-contracts.js';
import { secretaryNoteAdmission } from '../work-graph/state/secretary-note.js';
import { sessionHistoryDecision } from './context-history-facts.js';
import type { RuntimeSourceCaptureFactory } from './source-tool-ports.js';
import type {
  ResolvedRuntimeConfiguration, RuntimeExecutionDependencies, StartQueryExecutionRequest,
} from './execution-contracts.js';
import type {
  QueryEntryIdentity, QueryExecutionRecord,
} from '../work-graph/queries/contracts.js';
import { queryManifestProblem } from '../work-graph/queries/query-record-codecs.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { RawArtifactRecord } from '../record-store/body-ports.js';

export type QueryExecutionDriverPort = {
  start(ctx: CoreCallContext, request: StartQueryExecutionRequest): Promise<ReadResult<QueryExecutionRecord>>;
};

const BUILTIN_TOOL_NAMES = new Set<string>(['read', 'write', 'shell']);

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

/**
 * Ruling 16: the Host binding still names the prepared prompt selection and the
 * provider/model the set was frozen with. `promptSelectionOf` is the only reader
 * of `selection`; a BoundModel without one takes its documented fallback
 * (revision / `platform` / `current_run`) and is compared exactly like any other.
 */
function samePromptBinding(
  model: { configuration: { revision: string; provider: string; model: string };
    selection?: { modelId: string; promptPack: string; reasoningReplay: 'current_run' | 'none' } },
  set: PromptSetV1,
): boolean {
  const selection = promptSelectionOf(model);
  return selection.modelId === set.modelId && selection.promptPack === set.packId
    && selection.reasoningReplay === set.reasoningReplay
    && model.configuration.provider === set.provider && model.configuration.model === set.model;
}

/**
 * The real note owners a secretary Query's `record_note` needs. Absent, the
 * start is `unavailable`; it never builds the tool around a non-null assertion.
 */
function noteOwnersOf(notes: RuntimeExecutionDependencies['notes']):
{ write: NoteWritePort; check: Pick<NoteCheckPort, 'checkNotes'> } | null {
  if (notes?.write === undefined || notes.check === undefined) return null;
  return { write: notes.write, check: notes.check };
}

/**
 * The trusted command identity of one `record_note` call: the QueryRun
 * principal plus the Kernel call's own id and name, in the same shape the Work
 * tool commits use. It never reads model arguments, so a replay of the same
 * call derives the same id.
 */
function queryNoteRequestIdForCall(queryRunRef: QueryRunRef, call: Readonly<ToolCall>): string {
  if (!nonEmpty(call.callId) || !nonEmpty(call.name)) {
    throw new Error('the Kernel tool call carries no trusted identity');
  }
  return 'r5b-query-note:' + sha256Hex(canonicalJson({
    queryRunRef: {
      aggregateType: 'QueryRun', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId,
      queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId,
    },
    operation: call.name,
    callId: call.callId,
  }));
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
  const manifestProblem = queryManifestProblem(parsed);
  if (manifestProblem !== null) return rejected('invalid', manifestProblem);
  const manifest = parsed as unknown as PreparedQueryManifestV1;
  if (sha256Hex(manifest.input) !== manifest.inputDigest) return rejected('invalid', 'the Query manifest input digest is not the digest of its input');
  if (manifest.inputDigest !== prepared.inputDigest) return rejected('invalid', 'the Query manifest input digest disagrees with the Prepared value');
  // Ruling 16/22: the frozen prompt set is required and strictly decoded; an
  // absent or malformed one is `invalid`, never a silently empty set.
  if (decodePromptSetV1(parsed['promptSet']) === null) {
    return rejected('invalid', 'the Query manifest has no valid prompt set');
  }
  return { status: 'ready', value: { manifest, bundleRef } };
}

/** The exact shape the send wrapper writes into the shared map (ruling 24). */
type PromptFacts = ModelRequestPromptFactsV1 & { maxOutputTokens: number };

/** Ruling 27: the Query request record stores the send facts WITHOUT the output cap
 * (its existing `reservedOutput` is the cap). One projection serves the meter row
 * and the admission input. */
function queryRequestFacts(facts: PromptFacts): QueryRequestPromptFactsV1 {
  return {
    systemDigest: facts.systemDigest,
    toolsDigest: facts.toolsDigest,
    toolSpecsRef: { ...facts.toolSpecsRef },
    selection: { ...facts.selection, removed: { ...facts.selection.removed } },
  };
}

function projectMeterEntry(entry: MeterEntry, promptFacts: Map<string, PromptFacts>): QueryModelUsageV1 {
  if (!nonEmpty(entry.inputDigest)) throw new Error('the Query model request has no real input digest');
  // Ruling 27: no silent default. The facts are written by the send layer under
  // this exact requestId before the meter reserves, so a missing entry is a
  // wiring failure and throws before the usage write.
  const facts = promptFacts.get(entry.requestId);
  if (facts === undefined) {
    throw new Error(`the Query request prompt facts are missing for request ${entry.requestId}`);
  }
  return {
    requestId: entry.requestId,
    requestDigest: entry.inputDigest,
    reservedInput: entry.reservedInput,
    reservedOutput: entry.reservedOutput,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cachedInputTokens: entry.cachedInputTokens,
    usageStatus: entry.status,
    prompt: queryRequestFacts(facts),
  };
}

export function createQueryExecutionDriver(deps: RuntimeExecutionDependencies): QueryExecutionDriverPort {
  const observation = createQueryObservation(deps);
  return {
    async start(ctx: CoreCallContext, request: StartQueryExecutionRequest): Promise<ReadResult<QueryExecutionRecord>> {
      if (deps.queryExecution === undefined) return rejected('unsupported', 'startQuery requires the trusted QueryExecutionPort');
      const queryExecution = deps.queryExecution;
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
      // Ruling 22: the frozen prompt inputs are the ONLY base and Skills this
      // QueryRun sends; an unreadable text is this driver's `unavailable`.
      const promptTexts = await readPromptTexts(deps.bodies, manifest.promptSet);
      if (promptTexts.status !== 'ready') {
        return rejected('unavailable', `reading the prepared prompt texts failed: ${promptTexts.reason}`);
      }
      const frozenPrompt = {
        base: promptTexts.value.base,
        skills: promptTexts.value.skills,
        reasoningReplay: manifest.promptSet.reasoningReplay,
      };
      const toolTexts = promptTexts.value.tools;
      // The ONE reader of a Query's role binding and budget: a plain Query
      // reads its Job intent, a request round reads its own claimed attempt.
      const binding = queryExecutionBindingOf(record.job, record.run);
      const intentExecution = record.job.job.intent.execution;
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
      const projected = projectQueryConfiguration({ host: configured.value, requested: binding.runtimeBudget, roleResolution: state.roleResolution });
      if (projected.configurationRevision !== manifest.hostConfigurationRevision
        || !sameRef(projected.permissions, manifest.permissions)
        || !sameRef(projected.budget, manifest.runtimeBudget)
        || !sameRef({ template: projected.hostTemplate }, { template: manifest.hostTemplate })
        // Ruling 16: the pre-entry comparison also sees the Host's prompt
        // selection and bound provider/model. After entry only observation runs.
        || !samePromptBinding(configured.value.model, manifest.promptSet)) {
        return rejected('forbidden', 'the prepared Query permissions no longer fit the current Host and Role ceilings');
      }
      const hostConfig: ResolvedRuntimeConfiguration = configured.value;
      const workspace = { aggregateType: 'Workspace' as const, projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId };
      const builtinTools = manifest.permissions.tools.filter(tool => BUILTIN_TOOL_NAMES.has(tool));
      const hasFileRead = builtinTools.includes('read');
      const readonlyRequested = manifest.permissions.tools.includes(READONLY_COMMAND_TOOL_NAME);
      let currentAuthorization: Awaited<ReturnType<typeof deps.workspaceHost.authorize>> | undefined;
      if (hasFileRead || readonlyRequested) {
        try {
          currentAuthorization = await deps.workspaceHost.authorize(owned, workspace);
        } catch (error) {
          return rejected('unavailable', `the Host read policy could not be resolved: ${messageOf(error)}`);
        }
        if (currentAuthorization.status !== 'ready') return rejected('unavailable', currentAuthorization.reason);
      }
      // The frozen manifest's request facts decide the Query's note class: a
      // non-null request is exactly a secretary request round. The pure rule
      // decides the class from the request root, so preparation and this start
      // read the same frozen fact and cannot disagree.
      const noteAdmission: QueryNoteAdmissionV1 = manifest.request === null
        ? { class: 'none' }
        : secretaryNoteAdmission({
            requestRoot: manifest.request.requestRoot,
            effectiveGoalId: manifest.request.effectiveGoalId,
            grantedGoalIds: manifest.request.understandingGrants,
          });
      // A secretary round's `record_note` needs the real write and check owners.
      // A missing dependency is `unavailable`, never a tool built around a
      // non-null assertion.
      const noteOwners = noteOwnersOf(deps.notes);
      if (noteAdmission.class === 'secretary' && noteOwners === null) {
        return rejected('unavailable', 'the secretary Query round admits notes but no note write/check dependency is bound');
      }
      // Ruling 16: the one final tool list, compared with the frozen one before
      // any entry write. A difference is `forbidden`.
      const startToolNames = finalToolNamesOf({
        callKind: 'query',
        noteAdmission,
        selected: manifest.permissions.tools,
        readOnly: true,
        reviewPhase: null,
        hasBlockedCommands: false,
        reviewSource: false,
        frozenSource: hasFileRead && currentAuthorization?.status === 'ready',
        materialTools: false,
        owners: {
          mailbox: false, decisionMessages: false, applicationReceipt: false,
          sessions: false, plans: false,
          graph: deps.graphContext !== undefined && deps.taskInputs !== undefined,
          notes: noteAdmission.class === 'secretary', unknownCallReviews: false, commandRerunRequests: false,
        },
        // The read-only command is a Host-gated capability: the start reads the
        // real whole-workspace read policy again (the same fact preparation
        // froze), so a policy that moved between preparation and start changes
        // the current list and the comparison below answers `forbidden`.
        readonlyCommand: {
          requested: readonlyRequested,
          access: hostConfig.readonlyCommandAccess,
          allowsReadWholeWorkspace: currentAuthorization !== undefined
            && currentAuthorization.status === 'ready' && currentAuthorization.value.allowsRead('.'),
        },
      });
      if (!startToolNames.ok) return startToolNames.rejection;
      const frozenToolNames = manifest.promptSet.toolNames;
      const sameToolList = frozenToolNames.length === startToolNames.value.length
        && frozenToolNames.every((name, index) => name === startToolNames.value[index]);
      if (!sameToolList) return rejected('forbidden', 'the prepared tool list no longer fits this Run');

      // The Query grant may name the two read-only graph tools and, for a
      // secretary round, `record_note`. Those are the ONLY coordination tools a
      // Query ever injects; the effective final set is the Host grant ∩ Role
      // ceiling ∩ Query read ceiling already projected into
      // `manifest.permissions.tools` by `projectQueryConfiguration`. The note
      // group exposes only the note names the frozen list selected: the
      // admission alone never widens the Host grant.
      const grantedGraphNames = GRAPH_TOOL_NAMES.filter(name => manifest.permissions.tools.includes(name));
      const noteNames: readonly string[] = NOTE_TOOL_NAMES.filter(name => frozenToolNames.includes(name));
      const graphDeps = deps.graphContext === undefined || deps.taskInputs === undefined
        ? null
        : { graph: deps.graphContext, inputs: deps.taskInputs };
      if (grantedGraphNames.length > 0 && graphDeps === null) {
        return rejected('unsupported', `the Query grant selects graph read tools but no graph read dependency is bound: ${grantedGraphNames.join(', ')}`);
      }
      let coordinationTools: ToolGroup | null = null;
      if (grantedGraphNames.length > 0 || noteAdmission.class === 'secretary') {
        // The original query_run tool context (spec §4.1: tool inputs never
        // obtain the Host context/reader). The narrow history proxy separately
        // uses the ORIGINAL initiator's same-scope Host context for RT8 only.
        const facts = await queryExecution.readPreparationFacts(owned, queryRunRef);
        if (facts.status !== 'ready') return mapRead(facts);
        // A secretary round may have no goal yet: its tools then read the
        // project, and its current goal is the one frozen in the manifest's
        // request (never a model argument). Every other Query keeps today's
        // goal requirement and its principal shape.
        const secretary = manifest.contextAssembly.callKind === 'secretary';
        const frozenGoalId = manifest.request === null ? null : manifest.request.effectiveGoalId;
        const initiator = structuredClone(facts.value.initiator);
        const toolContext: CoreCallContext = {
          projectId: queryRunRef.projectId,
          workspaceId: queryRunRef.workspaceId,
          principal: {
            kind: 'query_run', queryRunRef: structuredClone(queryRunRef), initiator: structuredClone(initiator),
            ...(secretary ? { goalId: frozenGoalId } : {}),
          },
          materialReader: { kind: 'run', requester: structuredClone(queryRunRef) },
          signal,
        };
        let graphTools: ToolGroup | null = null;
        if (grantedGraphNames.length > 0 && graphDeps !== null) {
          let goalRef: GoalRef | null;
          if (secretary) {
            goalRef = frozenGoalId === null
              ? null
              : { aggregateType: 'Goal', projectId: queryRunRef.projectId, goalId: frozenGoalId };
          } else {
            if (facts.value.goal === null) return rejected('invalid', 'no goal');
            goalRef = facts.value.goal.ref;
          }
          const trustedHostContext: CoreCallContext = {
            projectId: queryRunRef.projectId,
            workspaceId: queryRunRef.workspaceId,
            principal: { kind: 'host', actor: structuredClone(initiator) },
            materialReader: { kind: 'host', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, actor: structuredClone(initiator) },
            signal,
          };
          graphTools = createQueryGraphToolGroup({
            names: grantedGraphNames,
            context: toolContext,
            goalRef,
            graph: graphDeps.graph,
            inputs: graphDeps.inputs,
            history: deps.graphHistory,
            hostContext: trustedHostContext,
            // The notes read port is bound only for a secretary round; a plain
            // Query keeps the memory branch's explicit refusal.
            ...(secretary && deps.notes?.memory !== undefined ? { notes: deps.notes.memory } : {}),
            texts: toolTexts,
          });
        }
        let noteTools: NoteToolsHandle | null = null;
        if (noteAdmission.class === 'secretary') {
          if (noteOwners === null) {
            return rejected('unavailable', 'the secretary Query round admits notes but no note write/check dependency is bound');
          }
          noteTools = createNoteTools({
            context: toolContext,
            notes: noteOwners.write,
            check: noteOwners.check,
            requestIdForCall: (call: Readonly<ToolCall>): string => queryNoteRequestIdForCall(queryRunRef, call),
            texts: toolTexts,
            kinds: noteAdmission.kinds,
            withdraw: noteAdmission.withdraw,
          });
        }
        const names = [...grantedGraphNames, ...noteNames];
        if (names.length > 0) {
          coordinationTools = {
            names,
            create: (workspace) => [
              ...(graphTools?.create(workspace) ?? []),
              ...(noteTools?.create(workspace) ?? []).filter(definition => noteNames.includes(definition.name)),
            ],
          };
        }
      }

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

      let rootResolved;
      try {
        rootResolved = await deps.workspaceHost.resolveRoot(workspace);
      } catch (error) {
        return rejected('unavailable', `resolving the Query workspace root failed: ${messageOf(error)}`);
      }
      // The QueryRun's binding always resolves; a non-ready result is fail-closed.
      if (rootResolved.status !== 'ready') return rejected('unavailable', rootResolved.reason);
      if (rootResolved.value.workspaceRevision !== manifest.workspace.revision) {
        return rejected('source_stale', 'the workspace revision moved since the QueryRun was prepared');
      }
      const location = deps.kernelStores.byAdapterId(record.session.kernel.adapterId);
      if (!location) return rejected('unsupported', 'the prepared Query Session is not mapped to a current Kernel store');
      if (!nonEmpty(location.databasePath)) return rejected('unsupported', 'the mapped Kernel store has no database path');

      let sourceTools: SourceToolOptions | undefined;
      let sourceFactory: RuntimeSourceCaptureFactory | undefined;
      if (hasFileRead && currentAuthorization !== undefined && currentAuthorization.status === 'ready') {
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
          ...(deps.sourceAnalyzers === undefined ? {} : { sourceAnalyzers: deps.sourceAnalyzers }),
        };
        const executionRequest = {
          runRef: { ...queryRunRef },
          bundleRef: structuredClone(prepared.bundleRef),
          question: record.job.job.intent.question,
          budget: { maxTokens: binding.budget.maxTokens },
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
      // L18: the read-only command tool is injected only when the Host grant
      // selected it, the explicit `readonlyCommandAccess` grant is present and
      // the current workspace read is the whole workspace. The handler re-reads
      // the same grant before every launch.
      // U5: the ONE shared read-only command construction; Query keeps its own
      // authorization choice (the same Host read re-check at every launch).
      const readonlyCommandTool = registerReadonlyCommandTool({
        requested: readonlyRequested,
        access: hostConfig.readonlyCommandAccess,
        authorization: currentAuthorization?.status === 'ready' ? currentAuthorization.value : undefined,
        workspaceRoot: rootResolved.value.root,
        processSandboxOptions: hostConfig.processSandboxOptions,
        ...(deps.resourceCaps === undefined ? {} : { resourceCaps: deps.resourceCaps }),
        authorizeCurrent: () => deps.workspaceHost.authorize(owned, workspace),
        texts: toolTexts,
      });

      const taskBudget: ModelTokenBudget = { tokenBudget: binding.budget.maxTokens, deadline: binding.budget.deadline };
      // Ruling 24/27: the send layer fills this map by requestId before the meter
      // reserves; the usage projection below reads the same entry.
      const promptFacts = new Map<string, PromptFacts>();
      const meter = new ModelBudget(manifest.runtimeBudget, async (entries) => {
        const projectedEntries = entries.map(entry => projectMeterEntry(entry, promptFacts));
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
                // Ruling 27: the send facts (without the output cap) ride the
                // admission; the existing reservation carries the cap.
                prompt: queryRequestFacts(input.prompt),
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

      // Ruling 14: the same pure rule runs at start. A Query with a formal basis
      // reads no boundary (C7); without one it reads the real completed boundary.
      let currentHistory;
      if (manifest.sessionBasis !== undefined) {
        currentHistory = sessionHistoryDecision({ callKind: 'query', sessionBasis: manifest.sessionBasis });
      } else {
        const cursorOwner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });
        let boundary;
        try {
          boundary = await cursorOwner.completedBoundary({ session: record.session, signal });
        } catch (error) {
          return rejected('unavailable', `reading the completed Query history boundary failed: ${messageOf(error)}`);
        }
        if (boundary.status === 'rejected') return boundary;
        currentHistory = sessionHistoryDecision({ callKind: 'query',
          sessionBasis: undefined, completedBoundary: { cursor: boundary.cursor, position: boundary.position } });
      }
      const historyDecision = !manifest.takesSessionHistory && currentHistory.takesSessionHistory
        ? { mode: 'current_turn' as const, takesSessionHistory: false as const }
        : currentHistory;
      const sessionContext = historyDecision.mode === 'session_history'
        ? { version: 1 as const, mode: 'session_history' as const, throughPosition: historyDecision.throughPosition,
          ...(historyDecision.sourceSessionId === null ? {} : { sourceSessionId: historyDecision.sourceSessionId }) }
        : { version: 1 as const, mode: 'current_turn' as const };

      try {
        await runObservedModel({
          kernel: deps.kernel,
          bound: hostConfig.model,
          meter,
          root: rootResolved.value.root,
          databasePath: location.databasePath,
          sessionId: record.session.kernel.kernelSessionId,
          input: manifest.input,
          ...(deps.messages === undefined || intentExecution.kind !== 'semantic_query' || intentExecution.consultation?.derivation !== undefined ? {} : {
            inputSupply: createMailboxInputSupply({ messages: deps.messages, context: () => owned,
              sessionRef: state.sessionRef, runRef: queryRunRef,
              texts: promptTexts.value, toolNames: manifest.promptSet.toolNames }),
          }),
          budget: manifest.runtimeBudget,
          readOnly: true,
          // Null removes only the cumulative token cap; the explicit deadline
          // still reaches Kernel to stop an in-flight model/tool.
          taskBudget,
          now: deps.now,
          sessionContext,
          executionIdentity: { runId: kernel.runId, turnId: kernel.turnId },
          signal,
          deniedPrefixes: hostConfig.deniedPrefixes,
          modelCalls,
          manifestDigest: prepared.bundleRef.digest,
          allowedTools: builtinTools,
          ...(coordinationTools === null ? {} : { coordinationTools }),
          ...(readonlyCommandTool === undefined ? {} : { readonlyCommandTool }),
          controlHooks: hasFileRead ? [enteredHook, toolPathHook] : [enteredHook],
          // Ruling 22: the frozen base (Host instruction merged), frozen Skills
          // and frozen replay; the Host options no longer exist here.
          prompt: frozenPrompt,
          texts: toolTexts,
          bodies: deps.bodies,
          origin: { kind: 'run', owner: queryRunRef },
          promptFacts,
          processSandboxOptions: hostConfig.processSandboxOptions,
          ...(deps.resourceCaps === undefined ? {} : { resourceCaps: deps.resourceCaps }),
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
