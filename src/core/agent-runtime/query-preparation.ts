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
import { isRequestRound, queryExecutionBindingOf } from '../../contracts/query-job.js';
import type { RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import { sha256Hex } from '../../contracts/fingerprint.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../../contracts/no-progress.js';
import type { PromptPackSourcePort, ResolvedPromptPackV1 } from '../../contracts/prompts/prompt-pack.js';
import { promptSelectionOf } from '../../contracts/prompts/prompt-set.js';
import { renderTemplate } from '../../contracts/prompts/render-template.js';
import { plainSessionRefToAggregate } from '../work-graph/sessions/session-record-codecs.js';
import { SESSION_MAILBOX_TOOL_NAMES } from './communication-tools.js';
import { WHITEBOARD_TOOL_NAMES } from './whiteboard-tools.js';
import type { ContextAssembler } from './context-assembler.js';
import { createContextAssembler } from './context-assembler.js';
import { queryPreparedSectionOrder } from './context-rendering.js';
import { finalToolNamesOf, BUILTIN_TOOL_NAMES, RUNTIME_TOOL_NAMES } from './tool-group-assembly.js';
import { READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import type { ContextQueryHistoryInputV1 } from './context-types.js';
import {
  promptDeclarationProblem, promptRenderProblem, resolvePromptPack, selectPromptSkills,
  storePromptTexts, trackPromptTexts, type PromptPartsV1,
} from './prompt-set-texts.js';
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

/** One used template's pack identity and exact text (ruling 14 item 6). */
function promptTemplatePart(pack: ResolvedPromptPackV1, id: string) {
  const text = pack.templates[id];
  if (text === undefined) throw new Error(`the resolved prompt pack has no template ${id}`);
  return { id, version: promptTemplateVersion(pack, id), packId: pack.origins[id]?.packId ?? pack.manifest.packId, text };
}

function promptTemplateVersion(pack: ResolvedPromptPackV1, id: string): number {
  return pack.origins[id]?.version ?? pack.manifest.templates[id]?.version ?? 1;
}

export type QueryPreparationDependencies = RuntimeExecutionDependencies & {
  /**
   * Ruling 14: the ONE prompt-pack source of this preparation. Absent installs
   * the ruling-30 platform default (the generated pack), never `unavailable`;
   * production always wires the source.
   */
  promptPacks?: PromptPackSourcePort;
};

export function createQueryPreparation(deps: QueryPreparationDependencies, contextAssembler?: ContextAssembler): QueryPreparationPort {
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
      const requestRound = isRequestRound(record.job);
      // A no-goal request round prepares from the secretary facts; every other
      // Query still requires its Goal, so a null goal is refused before any use.
      if (goal === null && !requestRound) return rejected('invalid', 'no goal');
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
      // A request round's binding and budget come from its own attempt; a
      // claimed request round without one is an invariant break in the contract.
      const binding = queryExecutionBindingOf(record.job, record.run);

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
      // Ruling 14 item 1: Query has no snapshot, so take the selection and the
      // bound provider/model at once, before the pack await.
      const selection = promptSelectionOf(configured.value.model);
      const boundProvider = configured.value.model.configuration.provider;
      const boundModel = configured.value.model.configuration.model;
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled after the Host configuration read');
      // Ruling 14 item 2: resolve the pack ONCE; a rejection names the pack.
      const resolved = await resolvePromptPack(deps.promptPacks, selection.promptPack, signal);
      if (resolved.status !== 'ready') return resolved;
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled while the prompt pack was resolved');
      const pack = resolved.value;
      const tracked = trackPromptTexts(pack);
      const projected = projectQueryConfiguration({
        host: configured.value,
        requested: binding.runtimeBudget,
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

      const workspaceRevision = workspace.revision;
      const sourceRefs: SourceRefV1[] = [
        { kind: 'workspace', refId: workspace.ref.workspaceId, revision: String(workspaceRevision) },
      ];
      if (focusPlan !== null) {
        sourceRefs.push({ kind: 'plan-revision', refId: focusPlan.ref.planId, revision: String(focusPlan.planRevision) });
      }
      // The final tool list is computed once here and frozen as
      // `PromptSetV1.toolNames`. Query builds only the graph group and the
      // read-only command; every other coordination family fails closed.
      const builtinTools = projected.permissions.tools.filter(tool => BUILTIN_TOOL_NAMES.has(tool));
      const readonlyRequested = projected.permissions.tools.includes(READONLY_COMMAND_TOOL_NAME);
      // The whole-workspace read gate is the real Host authorization, exactly
      // as the Work preparation reads it. A failed or denied authorization
      // leaves the read-only command out of the frozen list; the start reads
      // the same fact again and its comparison answers `forbidden` if it moved.
      let readonlyAllowsWholeWorkspace = false;
      if (readonlyRequested) {
        try {
          const authorized = await deps.workspaceHost.authorize(owned, {
            aggregateType: 'Workspace', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId,
          });
          readonlyAllowsWholeWorkspace = authorized.status === 'ready' && authorized.value.allowsRead('.');
        } catch { readonlyAllowsWholeWorkspace = false; }
      }
      const finalNames = finalToolNamesOf({
        callKind: 'query',
        // Preparation freezes only the names this Runtime knows; the start
        // checks the real selection and rejects an unknown name first.
        selected: projected.permissions.tools.filter(tool => RUNTIME_TOOL_NAMES.has(tool)),
        readOnly: true,
        reviewPhase: null,
        hasBlockedCommands: false,
        reviewSource: false,
        frozenSource: builtinTools.includes('read'),
        materialTools: false,
        // Preparation freezes the CAPABILITY set; the actual owner wiring is
        // re-checked by the same function at start. Query builds only the graph
        // group and the read-only command; every other family fails closed there.
        owners: {
          mailbox: true, decisionMessages: true, applicationReceipt: true,
          sessions: true, plans: true, graph: true, notes: true,
          unknownCallReviews: true, commandRerunRequests: true,
        },
        readonlyCommand: {
          requested: readonlyRequested,
          access: configured.value.readonlyCommandAccess,
          allowsReadWholeWorkspace: readonlyAllowsWholeWorkspace,
        },
      });
      if (!finalNames.ok) return finalNames.rejection;
      const toolNames = finalNames.value;
      // The initial-planning guide belongs only to an initial coordination
      // Query: render it now with the frozen final tool list so its tool blocks
      // expand like every other template, then append it to the question. A
      // semantic Query never reads it, so an unused declaration stays unused.
      // A secretary round renders its own answer format in the input, so the
      // guide is never appended a second time there.
      let question = record.job.job.intent.question;
      if (!requestRound && execution.kind === 'initial_coordination') {
        if (tracked.texts.templates['initial-planning-answer'] === undefined) {
          return rejected('invalid', 'the resolved prompt pack has no initial-planning-answer template');
        }
        let planningGuide: string;
        try {
          planningGuide = renderTemplate(tracked.texts, 'initial-planning-answer', {}, toolNames).text;
        } catch (error) {
          const renderProblem = promptRenderProblem(error, pack.manifest.packId);
          if (renderProblem !== null) return renderProblem;
          throw error;
        }
        question = `${question}\n\n${planningGuide}`;
      }
      // Ruling 14: the formal isolated derivation decides the Kernel session
      // basis; without one preparation passes the stored cursor's presence (C7).
      const consultationDerivation = execution.kind === 'semantic_query' ? execution.consultation?.derivation : undefined;
      const sessionBasis = consultationDerivation === undefined ? undefined : {
        sourceKernelSessionId: consultationDerivation.sourceKernel.kernelSessionId,
        throughPosition: consultationDerivation.throughPosition,
      };
      let history: ContextQueryHistoryInputV1;
      if (sessionBasis !== undefined) {
        history = { callKind: 'query', sessionBasis };
      } else {
        history = { callKind: 'query', hasCompletedCursor: record.session.historyCursor !== null };
      }
      // Slice 3 C7 (§4.2/§4.3): the ONE assembler owns the Query text and its
      // binding. A non-ready assembler result is propagated unchanged; its
      // rejection (in particular a failing `graphContext` read) is passed back as-is.
      // A secretary round's recipe reads its facts and returns them here, so the
      // manifest is frozen from the SAME value the input rendered from.
      const assemblyInput = {
        facts: facts.value,
        role: executionState.roleResolution,
        configuration: configured.value,
        permissions: projected.permissions,
        question,
        texts: tracked.texts, toolNames, history,
      };
      let assembled;
      try {
        assembled = await assembler.assembleQuery(owned, assemblyInput);
      } catch (error) {
        const renderProblem = promptRenderProblem(error, pack.manifest.packId);
        if (renderProblem !== null) return renderProblem;
        return rejected('unavailable', `the Query context assembly failed: ${messageOf(error)}`);
      }
      if (assembled.status !== 'ready') return assembled;
      const input = assembled.value.input;
      const secretaryFacts = assembled.value.secretaryFacts ?? null;
      if (requestRound && secretaryFacts === null) {
        return rejected('unavailable', 'the secretary assembly returned no preparation facts');
      }
      const contextAssembly = assembled.value.binding;
      const inputDigest = sha256Hex(input);
      const takesSessionHistory = assembled.value.takesSessionHistory;
      // Ruling 14 items 4-6: base + Host instruction, Skills from the same pack,
      // then the frozen texts and the set.
      let baseText: string;
      try {
        baseText = renderTemplate(tracked.texts, 'base', {}, toolNames).text;
      } catch (error) {
        const renderProblem = promptRenderProblem(error, pack.manifest.packId);
        if (renderProblem !== null) return renderProblem;
        throw error;
      }
      const mergedBase = baseText + (configured.value.systemInstruction ? '\n\n' + configured.value.systemInstruction : '');
      const selectedSkills = await selectPromptSkills(configured.value.skills, tracked.texts, {
        signal, ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }), toolNames,
      });
      if (selectedSkills.status !== 'ready') return selectedSkills;
      if (signal.aborted) return rejected('cancelled', 'the Query preparation was cancelled while the Skills were selected');
      const usedTemplates = tracked.usedTemplates();
      const declarationProblem = promptDeclarationProblem(pack, usedTemplates, toolNames);
      if (declarationProblem !== null) return declarationProblem;
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
        sectionOrder: queryPreparedSectionOrder(tracked.texts),
        templates: usedTemplates.map(id => promptTemplatePart(pack, id)),
        strings: pack.strings,
        base: { templateId: 'base', version: promptTemplateVersion(pack, 'base'), text: mergedBase },
        skills: selectedSkills.value,
        toolNames: [...toolNames],
        tools: toolParts,
      };
      const storedPrompts = await storePromptTexts(deps.bodies, { kind: 'run', owner: queryRunRef }, promptParts, deps.now());
      if (storedPrompts.status !== 'ready') {
        return rejected('unavailable', `storing the Query prompt texts failed: ${storedPrompts.reason}`);
      }
      const manifest: PreparedQueryManifestV1 = {
        schemaVersion: 1,
        kind: 'query_execution',
        queryRunRef,
        sessionRef: executionState.sessionRef,
        sessionGeneration: executionState.sessionGeneration,
        roleBinding: binding.roleBinding,
        sessionRole: executionState.role,
        role: executionState.roleResolution,
        hostTemplate,
        hostConfigurationRevision: projected.configurationRevision,
        goal: goal === null ? null : { ref: goal.ref, revision: goal.revision },
        request: secretaryFacts === null ? null : {
          requestRoot: secretaryFacts.request.requestRoot,
          round: secretaryFacts.request.round,
          batch: secretaryFacts.request.batch,
          preparationCursor: secretaryFacts.request.preparationCursor,
          effectiveGoalId: secretaryFacts.request.effectiveGoalId,
          executionKind: secretaryFacts.executionKind,
        },
        workspace: { ref: workspace.ref, revision: workspaceRevision },
        focusPlan: focusPlan === null ? null : { ref: focusPlan.ref, revision: focusPlan.planRevision },
        permissions: projected.permissions,
        runtimeBudget: projected.budget,
        budget: { tokenBudget: binding.budget.maxTokens, deadline: binding.budget.deadline },
        sourceRefs,
        ...(sessionBasis === undefined ? {} : { sessionBasis }),
        contextAssembly,
        takesSessionHistory,
        promptSet: storedPrompts.value,
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
