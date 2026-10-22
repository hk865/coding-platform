import { createHash } from 'node:crypto';
import type { ModelCallAccess } from '../../contracts/dispatch.js';
import { resolve } from 'node:path';
import type { AgentEvent, ContextSelectionReport, ExecutionIdentity, HookPort, ModelClientPort, ModelRequest, SessionContextMode, ToolDefinition, ToolGroupBarrier, WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';
import type { BoundModel } from './source-tool-ports.js';
import type { ModelBudget, RuntimeBudget } from './model-budget.js';
import type { ModelTokenBudget } from './model-budget.js';
import type { ModelRequestPromptFactsV1 } from '../../contracts/prompts/prompt-set.js';
import { PROMPT_TOOL_SPECS_CONTENT_TYPE } from '../../contracts/prompts/prompt-set.js';
import type { PromptSkillV1 } from './prompt-set-texts.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { MaterialOrigin, RawArtifactStorePort } from '../record-store/body-ports.js';
import { sha256Hex } from '../../contracts/fingerprint.js';
import { RuntimeModelCallRejected } from './model-call-access.js';
import { kernelRunLimits } from './run-limits.js';
import { createExplorationTools, type ExplorationToolsHandle, type SourceToolOptions } from './exploration-tools.js';
import { readSourceIdentity } from '../../core/workspace/source-identity.js';
import type { RuntimeSourceCaptureAccess, RuntimeSourceCaptureFactory } from './source-tool-ports.js';
import { assembleObservedExtensions, kernelEnabledToolNames } from './tool-group-assembly.js';

/** The internal result of the ONE existing finally cleanup. It is a local
 * proof for the Trusted Host's live handle, never a public control ack. */
export type RuntimeResourceCloseResult =
  | { status: 'completed' }
  | { status: 'failed'; reason: string };

export type ObservedModelRunOptions = {
  kernel: typeof import('../../../vendor/coding-agent/dist/public-api.js'); bound: BoundModel; meter: ModelBudget;
  root: string; databasePath: string; sessionId: string; input: string; budget: RuntimeBudget; readOnly: boolean;
  /** Persistent Run cumulative constraint; the formal driver always supplies it. */
  taskBudget: ModelTokenBudget;
  /** Trusted clock: the persistent task deadline and the tool-specs body's `requestedAt`. */
  now?: () => string;
  /** Frozen public Kernel inputs; the caller supplies a real completed history boundary. */
  sessionContext?: SessionContextMode;
  /** Host-supplied applicable inputs, pulled at a drained before_model boundary. */
  inputSupply?: import('./execution-inputs.js').InputSupply;
  executionIdentity?: ExecutionIdentity;
  signal: AbortSignal; deniedPrefixes: string[];
  modelCalls?: ModelCallAccess; manifestDigest?: string; assertMaterialsCurrent?: () => Promise<void>;
  allowedTools?: string[];
  /**
   * Trusted Host control hooks for this model loop. The array is snapshotted before the first
   * await and the Hook `execute` functions are forwarded to the Kernel verbatim (never JSON
   * cloned). Absent keeps the existing no-control-hook behavior.
   */
  controlHooks?: readonly HookPort[];
  /**
   * R4.3a optional Kernel tool-group safe point. Captured before the first
   * await and forwarded verbatim to the SAME `runCodingAgent` call; absent keeps
   * the existing no-barrier behavior. It only pauses/continues at a real tool
   * group boundary and never rewrites a tool call or result.
   */
  toolGroupBarrier?: ToolGroupBarrier;
  /**
   * R4.3a internal, synchronous notification fired from the ONE existing
   * `finally` cleanup after every owned resource was attempted and awaited. It
   * is captured before the first await and consumed only by the Trusted Host's
   * live handle; it is never a public ack and is never forwarded to the model or
   * Kernel. Absent keeps the old cleanup error priority unchanged.
   */
  onResourcesClosed?: (result: RuntimeResourceCloseResult) => void;
  /**
   * R4.3a internal, synchronous notification fired the moment the ONE
   * `runCodingAgent` call actually returns or throws, BEFORE the outer finally
   * attempts or awaits any owned-resource cleanup. It is captured before the
   * first await and consumed only by the Trusted Host's live handle; it is
   * never a public ack and is never forwarded to the model or Kernel. Absent
   * keeps the existing behavior, and an initialization failure that never
   * reached the Kernel call never fires it.
   */
  onKernelExited?: () => void;
  /**
   * PC-1b ruling 22: the frozen prompt inputs prepared for this Run. `base` is
   * the merged base text, `skills` the selected Skill contexts and
   * `reasoningReplay` the frozen thinking policy. Mutable fields are snapshotted
   * before the first await. The base and the Skills are both required, so this
   * call never silently falls back to the Kernel's fixed text or Skill files.
   */
  prompt: {
    base: { templateId: string; version: number; text: string };
    skills: PromptSkillV1[];
    reasoningReplay: 'current_run' | 'none';
  };
  /** 显式结构化报告请求；必须在容量计量和模型调用授权前进入真实请求。 */
  responseFormat?: { type: 'json_object' };
  /**
   * PC-1b ruling 25: store and check the exact model tool specs this Run sends.
   * `origin` is the real Run/QueryRun owner and the trusted `now` supplies the
   * put's `requestedAt`.
   */
  bodies: Pick<RawArtifactStorePort, 'put'>;
  origin: MaterialOrigin;
  /**
   * PC-1b ruling 24: the request prompt facts joined by `requestId`. This run
   * writes them before the meter reserves; a Query meter-persist closure reads
   * the same map to build its reservation rows. Work passes an empty map.
   */
  promptFacts: Map<string, ModelRequestPromptFactsV1 & { maxOutputTokens: number }>;
  sourceTools?: SourceToolOptions;
  /**
   * 本次模型循环的源码捕获模式。显式 `frozen` 必须提供可信工厂，**不会**回落成任何实时索引。
   * 工厂返回的访问能力由本函数独占并在 finally 关闭；工具组不能关闭它。
   *
   * `openOn` 决定可信工厂何时被调用：缺省或 `before_run` 保持既有 eager 语义，此时工厂失败
   * 原样结束本次调用；`first_use` 先注册 `project_source` 而不调用工厂，在第一次真实工具
   * 执行时才打开，同一 Run 至多一个共享 open Promise，其失败由工具作为 error 结果交回模型，
   * Kernel 可继续该 Run（不要求整次 Run 抛异常）。
   */
  projectSource?: { mode: 'frozen'; open: RuntimeSourceCaptureFactory; openOn?: 'before_run' | 'first_use' };
  materialTools?: (workspace: WorkspaceSandbox) => ToolDefinition[];
  /**
   * 协调 Host 工具（协作通信）。它们是**平台级**入口：身份由宿主绑定，
   * 副作用经 Host Adapter 的正式受理路径落在平台的 canonical 状态上，不改动模型的工作区。
   * `names` 必须与 `create()` 实际返回的工具名一致（本次请求的启用清单在 workspace 存在之前
   * 就要定下来，因此由调用方显式给出，而不是在这里猜）。
   */
  coordinationTools?: { names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] };
  /**
   * L12/L18: one read-only process extension tool for this Run. When present its
   * name joins the enabled set and the Host-authorized extension list (so the
   * frozen permission policy admits the `process` effect) and its definition is
   * registered through `additionalTools`; absent keeps the existing tool set.
   */
  readonlyCommandTool?: (workspace: WorkspaceSandbox) => ToolDefinition;
  /**
   * K3 L14/L20: the review-purpose round's one write tool
   * (`record_unknown_call_review` in the review phase, `propose_safer_method`
   * in the proposal phase). Present only on such a Run; its trusted name joins
   * the enabled set and the Host-authorized extension list and its definition is
   * registered through `additionalTools` (the same seam the read-only command
   * uses).
   */
  unknownCallReviewTool?: (workspace: WorkspaceSandbox) => ToolDefinition;
  /** The trusted name of `unknownCallReviewTool`; never read from model input. */
  unknownCallReviewToolName?: string;
  /**
   * L19a: the blocked Work Run's `request_command_rerun` tool. Present only
   * when the prepared manifest carries blocked commands; its trusted name joins
   * the enabled set, the Host-authorized extension list and `additionalTools`
   * (the same seam the review tool uses). Absent keeps the tool set unchanged.
   */
  commandRerunTool?: (workspace: WorkspaceSandbox) => ToolDefinition;
  /** The trusted name of `commandRerunTool`; never read from model input. */
  commandRerunToolName?: string;
  processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
  /** L13: merged into the Kernel input at this last hop only; never into any
   * authorization, configuration version, prepared execution or digest. */
  resourceCaps?: import('../../../vendor/coding-agent/dist/public-api.js').ResourceCapSource;
  publish: (event: { type: string; sequence: number; at: string; data: unknown }) => Promise<void>;
};

const exactMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Capture trusted control Hook metadata and the exact `execute` function before the first await,
 * so a caller mutating the array, a Hook object or its `execute` property afterwards cannot change
 * this run's seam. `bind` forwards the original function with its original receiver; functions are
 * never JSON-cloned, and mutability inside a Hook's own closure is outside this seam's guarantee.
 */
function snapshotControlHooks(hooks: readonly HookPort[]): HookPort[] {
  return hooks.map((hook): HookPort => {
    if (hook.point === 'before_model') {
      const execute = hook.execute.bind(hook);
      return { hookId: hook.hookId, point: 'before_model', priority: hook.priority, execute };
    }
    if (hook.point === 'before_tool') {
      const execute = hook.execute.bind(hook);
      return { hookId: hook.hookId, point: 'before_tool', priority: hook.priority, execute };
    }
    const execute = hook.execute.bind(hook);
    return { hookId: hook.hookId, point: 'after_tool', priority: hook.priority, execute };
  });
}

/** Attempt every close and wait for each one; one failure never prevents the rest. */
async function closeOwnedResources(groups: readonly ExplorationToolsHandle[], closeSource?: () => Promise<void>): Promise<unknown> {
  const failures: unknown[] = [];
  for (const group of groups) {
    try { await group.close(); } catch (error) { failures.push(error); }
  }
  if (closeSource) {
    try { await closeSource(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 0) return undefined;
  if (failures.length === 1) return failures[0];
  return new AggregateError(failures, 'Model run resource cleanup failed: ' + failures.map(exactMessage).join('; '));
}

/** Shared model/tool loop for execution, query and semantic role work. All use
 * the same provider binding, final-request capacity guard and public event seam. */

/**
 * Every possible exploration tool name (K3 L3 row 1, spec §1 note). The
 * conditional subsets below are picked from this list; exporting it lets the
 * K3 table check stay in sync with the real registration behavior.
 */
export { EXPLORATION_TOOL_NAMES } from './tool-group-assembly.js';

export async function runObservedModel(o: ObservedModelRunOptions) {
  // Capture the trusted Host configuration synchronously, before the first await, so later
  // mutation of the caller's array/object cannot change this run. Hook functions are forwarded
  // with their original receiver instead of being JSON-cloned.
  const controlHooks = o.controlHooks === undefined ? undefined : snapshotControlHooks(o.controlHooks);
  // R4.3a: capture the optional tool-group barrier and the internal cleanup
  // notification before the first await, so a caller mutating the options object
  // afterwards cannot select or drop a new control behavior mid-run.
  const toolGroupBarrier = o.toolGroupBarrier;
  const onResourcesClosed = o.onResourcesClosed;
  const onKernelExited = o.onKernelExited;
  // Ruling 22: own the frozen prompt inputs and the final-request transform
  // before the first await, so later mutation cannot change what this run sends.
  const prompt = {
    base: { ...o.prompt.base },
    skills: o.prompt.skills.map((skill): PromptSkillV1 => ({ ...skill })),
    reasoningReplay: o.prompt.reasoningReplay,
  };
  // Ruling 20: the ONE outgoing transform (responseFormat only; the Host
  // instruction is already inside the frozen base). Both the preview and the
  // real client wrapper use it.
  const responseFormat = o.responseFormat === undefined ? undefined : { ...o.responseFormat };
  const finalRequest = (request: Readonly<ModelRequest>): ModelRequest =>
    responseFormat === undefined ? { ...request } : { ...request, responseFormat: { ...responseFormat } };
  // Ruling 24: reports and facts are joined by `requestId`, never "the last
  // report". Ruling 25 owns the one tool-specs put promise for this Run.
  const selections = new Map<string, ContextSelectionReport>();
  const requestFacts = new Map<string, ModelRequestPromptFactsV1 & { maxOutputTokens: number }>();
  let toolSpecsPromise: Promise<ArtifactRef> | undefined;
  let toolSpecsRejection: string | undefined;
  // The trusted clock is captured before the first await; it is the put's
  // `requestedAt`. The formal drivers always pass it; a direct caller that does
  // not gets a real timestamp for this provenance field only.
  const now = o.now;
  const requestedAt = (): string => (now === undefined ? new Date().toISOString() : now());
  // Ruling 25: the first request, and every later request of this Run, measure
  // against the stored body's digest. A failure records the rejection; after the
  // Kernel returns (`unavailable`) it is raised as the driver-visible rejection.
  const storedToolSpecs = async (): Promise<ArtifactRef> => {
    if (toolSpecsRejection !== undefined) throw new RuntimeModelCallRejected('unavailable', toolSpecsRejection);
    if (toolSpecsPromise === undefined) {
      toolSpecsRejection = 'the Kernel reported no model tool specs before the first request';
      throw new RuntimeModelCallRejected('unavailable', toolSpecsRejection);
    }
    try {
      return await toolSpecsPromise;
    } catch (error) {
      toolSpecsRejection ??= 'the request tool specs body could not be stored: ' + exactMessage(error);
      throw new RuntimeModelCallRejected('unavailable', toolSpecsRejection);
    }
  };
  // Own the optional object fields before the first await and forward these
  // snapshots to Kernel; never assemble a platform transcript here.
  const sessionContext = o.sessionContext === undefined ? undefined : { ...o.sessionContext };
  const inputSupply = o.inputSupply;
  const executionIdentity = o.executionIdentity === undefined ? undefined : { ...o.executionIdentity };
  // This call exclusively owns the resources it creates: the exploration tool groups and the
  // frozen source capture capability. The Kernel closes its own store but never disposes platform
  // extension tools, so every exit path below goes through one awaited cleanup. A `first_use`
  // frozen source opens at most once and its one shared promise (including a cached rejection) is
  // drained and closed by this call, never by a tool.
  const frozen = o.projectSource?.mode === 'frozen' ? o.projectSource : undefined;
  const lazyFrozen = frozen?.openOn === 'first_use';
  // Capture the trusted factory reference before the first await; a later mutation of the
  // caller's projectSource object must not change this run's factory. `.call(frozen, ...)` keeps
  // the original receiver.
  const frozenOpen = frozen?.open;
  const owned: ExplorationToolsHandle[] = [];
  let source: RuntimeSourceCaptureAccess | undefined;
  let sourcePending: Promise<RuntimeSourceCaptureAccess> | undefined;
  let sourceClosing = false;
  const openSharedSource = (): Promise<RuntimeSourceCaptureAccess> => {
    if (sourceClosing) throw Error('Frozen project source is closing; refusing to reopen it');
    if (sourcePending === undefined) {
      // Cache the single attempt before running the factory, so a synchronous throw is observed
      // as the same rejected promise as an async rejection and a later call never retries it.
      const pending = Promise.resolve().then(() => frozenOpen!.call(frozen, o.signal));
      sourcePending = pending;
      void pending.then(access => { source = access; }, () => { /* cached failure; the tool reports it */ });
    }
    return sourcePending;
  };
  const closeSource = async (): Promise<void> => {
    // Runs after the exploration tool groups have drained, so no handler can reopen the source.
    sourceClosing = true;
    if (sourcePending) {
      try { await sourcePending; } catch { return; } // a failed lazy open owns no access to close
    }
    if (source) {
      const ownedAccess = source;
      source = undefined; // exactly-once even if a caller closes twice
      await ownedAccess.close();
    }
  };
  let failed = false;
  let completed = false;
  /** The Kernel reached a clean non-failure stop; at the R4.3a control seam a
   * real cleanup failure on such a stop must not be silently dropped. */
  let stopped = false;
  try {
    const definition = o.kernel.createBuiltinProviderRegistry().get(o.bound.configuration.provider);
    const provider: ModelClientPort = o.modelCalls ? {
      async *stream(request, options) {
        if (o.signal.aborted) throw Error('Run cancelled before model call');
        if (!o.manifestDigest) throw Error('Actual Context manifest is not bound');
        await o.assertMaterialsCurrent?.();
        // Ruling 24: the shared beforeCall carries the facts computed for this
        // exact requestId; the meter's reservation is already accounted for.
        const facts = requestFacts.get(request.requestId);
        if (facts === undefined) throw new RuntimeModelCallRejected('unavailable', 'the request prompt facts were not computed');
        await o.modelCalls!.beforeCall({ requestId: request.requestId,
          requestDigest: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
          contextInputDigest: createHash('sha256').update(o.input).digest('hex'), manifestDigest: o.manifestDigest,
          prompt: facts });
        if (o.signal.aborted) throw Error('Run cancelled before provider boundary');
        yield* o.bound.client.stream(request, options);
      },
    } : o.bound.client;
    // The meter applies the final output limit before authorization hashes the request.
    // Ruling 24: the facts are built from the SAME measurement the meter reserves
    // from (ruling 21's one measuring result), before the entry is pushed and
    // before the provider sees the request; Query's persist closure reads the
    // same map entry while it writes the reservation.
    let pendingToolSpecsRef: ArtifactRef | undefined;
    const metered = o.meter.wrap(provider, measured => {
      const request = measured.outgoing;
      const selection = selections.get(request.requestId);
      if (selection === undefined) throw new RuntimeModelCallRejected('unavailable', `the context selection report for request ${request.requestId} is missing`);
      if (pendingToolSpecsRef === undefined) throw new RuntimeModelCallRejected('unavailable', 'the request tool specs body is not available');
      const facts: ModelRequestPromptFactsV1 & { maxOutputTokens: number } = {
        systemDigest: sha256Hex(request.systemPrompt),
        toolsDigest: sha256Hex(JSON.stringify(request.tools)),
        toolSpecsRef: pendingToolSpecsRef,
        maxOutputTokens: measured.output,
        selection: { inputTokens: selection.inputTokens, budget: selection.budget, removed: { ...selection.removed } },
      };
      requestFacts.set(request.requestId, facts);
      o.promptFacts.set(request.requestId, facts);
    });
    const client: ModelClientPort = {
      async *stream(request, options) {
        await o.sourceTools?.assertCurrent?.();
        // Ruling 25: await the one tool-specs put before the meter reserves and
        // refuse a request whose tools are not byte-equal to the stored body.
        const toolSpecsRef = await storedToolSpecs();
        if (sha256Hex(JSON.stringify(request.tools)) !== toolSpecsRef.digest) {
          toolSpecsRejection = 'the Kernel-reported tool specs do not equal the request tools';
          throw new RuntimeModelCallRejected('unavailable', toolSpecsRejection);
        }
        pendingToolSpecsRef = toolSpecsRef;
        yield* metered.stream(finalRequest(request), options);
        await o.sourceTools?.assertCurrent?.();
      },
    };
    const providerRegistry = new o.kernel.ProviderRegistry().register({ ...definition, create: () => client });
    const base = await o.kernel.loadAppConfig({ cwd: o.root, environment: {} });
    const reviewSource = o.sourceTools?.includeReadSource === true;
    if (reviewSource && !o.readOnly) throw Error('Pinned source tools require a read-only runtime');
    const allowed = o.allowedTools ?? (o.readOnly ? ['read'] : ['read', 'write', 'shell']);
    if (o.readOnly && allowed.some(tool => tool !== 'read')) throw Error('Read-only runtime cannot expose mutation tools');
    const hasRead = allowed.includes('read');
    // No read permission: the factory is never opened and no exploration/source tool group is
    // created at all (including the pinned Reviewer read tool). An explicit frozen mode never
    // falls back to the legacy live index when the factory fails. `first_use` defers the open to
    // the first real project_source execution; `before_run` (the default) keeps the eager open.
    if (hasRead && frozenOpen && !lazyFrozen) source = await frozenOpen.call(frozen, o.signal);
    const extensions = assembleObservedExtensions(o);
    const enabledNames = kernelEnabledToolNames({
      allowed,
      hasRead,
      reviewSource,
      hasFrozenSource: frozen !== undefined,
      hasMaterialTools: hasRead && reviewSource && !!o.materialTools,
      extensionNames: extensions.names,
    });
    const needsExploration = hasRead;
    let result!: Awaited<ReturnType<typeof o.kernel.runCodingAgent>>;
    try {
      result = await o.kernel.runCodingAgent({
        config: { ...base, model: { ...base.model, provider: definition.id, model: o.bound.configuration.model, baseUrl: o.bound.configuration.baseUrl, maxOutputTokens: o.budget.perResponseTokens },
          runtime: { tokenBudget: o.budget.contextWindowTokens, maxModelRequests: o.budget.maxRequests ?? base.runtime.maxModelRequests, maxToolCalls: o.budget.maxToolCalls ?? base.runtime.maxToolCalls },
          tools: { enabledNames },
          storage: { databasePath: o.databasePath },
          // The Host always provides both the base and the Skills, so the
          // Kernel's fixed text and Skill-file fallback are never read.
          skills: { resourceRoot: resolve(import.meta.dirname, '../../../vendor/coding-agent/resources/skills'), enabledIds: ['coding-safety'] } },
        // 裁定 22：冻结的提示词输入是本 Run 唯一的 base 与 Skills 来源。
        baseSystemPrompt: prompt.base,
        skills: prompt.skills,
        reasoningReplay: prompt.reasoningReplay,
        previewRequest: request => o.meter.preview(finalRequest(request)),
        onContextSelected: report => {
          selections.set(report.requestId, report);
        },
        // 裁定 25：同步回报时立刻复制、排序并开始写工具说明正文；拒绝处理器
        // 同时挂上，首个请求进入 meter 之前会 await 这个 Promise。
        onConfiguration: configuration => {
          const specs = [...configuration.tools].sort((left, right) => left.name.localeCompare(right.name, 'en'));
          const body = JSON.stringify(specs);
          let pending: Promise<ArtifactRef>;
          try {
            pending = o.bodies.put({
              body, contentType: PROMPT_TOOL_SPECS_CONTENT_TYPE,
              sourceRefs: [{ kind: 'governance', refId: 'runtime-model-configuration', revision: o.bound.configuration.revision }],
              origin: o.origin, requestedAt: requestedAt(),
            }).then(stored => {
              if (stored.status !== 'ready') throw new Error(stored.reason);
              return stored.value.ref;
            });
          } catch (error) {
            pending = Promise.reject(error);
          }
          pending.catch(error => { toolSpecsRejection ??= 'the request tool specs body could not be stored: ' + exactMessage(error); });
          toolSpecsPromise = pending;
        },
        // 宿主对**非只读**扩展工具的显式授权：只有这里列出、且确实被 additionalTools 注册、
        // 且 effectClass 不是 read_only 的名字才会被内核的权限策略采纳（协议约束 2.3）。
        // 缺席时协调工具会被内核按"未授权的未知操作"拒绝——这是刻意的 fail-closed。
        hostAuthorizedTools: [...extensions.names],
        additionalTools: workspace => {
          const tools: ToolDefinition[] = [];
          if (needsExploration) {
            // Register the created handle before the material/coordination factories can throw, so a
            // later initialization failure still closes this group. The run-level projectSource is
            // authoritative; a caller-supplied access in `sourceTools` cannot be used unowned here.
            const explorationOptions: SourceToolOptions = {
              sourceIdentity: () => readSourceIdentity(o.root, workspace.identity), ...o.sourceTools,
              ...(frozen === undefined ? {} : { projectSource: lazyFrozen ? { mode: 'frozen' as const, access: openSharedSource } : { mode: 'frozen' as const, access: source! } }),
            };
            if (frozen === undefined) delete explorationOptions.projectSource;
            const handle = createExplorationTools(workspace, explorationOptions);
            owned.push(handle);
            tools.push(...handle.tools);
          }
          tools.push(...(o.materialTools?.(workspace) ?? []));
          tools.push(...extensions.create(workspace));
          return tools;
        },
        workspaceRoot: o.root, input: o.input, sessionId: o.sessionId, signal: o.signal,
        // 冻结的公共 Kernel 会话参数：缺省不传，保持 current_turn 与随机执行身份。
        ...(sessionContext !== undefined ? { sessionContext } : {}),
        ...(executionIdentity !== undefined ? { executionIdentity } : {}),
        ...(inputSupply === undefined ? {} : { inputSupply }),
        // 宿主可信控制 Hook：缺省保持旧行为；元数据与 execute 已在首次 await 前快照。
        ...(controlHooks !== undefined ? { controlHooks } : {}),
        // R4.3a 可选工具组安全点：缺省不调用任何新逻辑。
        ...(toolGroupBarrier !== undefined ? { toolGroupBarrier } : {}),
        secretSource: { get: () => 'platform-bound-client' }, providerRegistry,
        workspaceOptions: { deniedPrefixes: o.deniedPrefixes },
        // L13: the resource-cap source is merged in at this last hop only; the
        // Kernel reads `current()` once per command, so a settings change reached
        // the holder is used by the next command of this same Run.
        processSandboxOptions: o.resourceCaps === undefined
          ? o.processSandboxOptions
          : { ...o.processSandboxOptions, resourceCaps: o.resourceCaps },
        limits: kernelRunLimits(o.budget, o.taskBudget, o.now),
        approvalRequester: new o.kernel.StaticApprovalRequester({ decision: 'allow_once', reason: o.readOnly ? 'explicit_read_only_role_work' : 'explicit_gui_task_in_isolated_workspace' }),
        observerEventSinks: [{ sinkId: 'platform-live-events', delivery: 'best_effort', publish: async (event: AgentEvent) => {
          const data = JSON.parse(JSON.stringify(event.payload)) as Record<string, unknown>;
          await o.publish({ type: event.type, sequence: event.meta.sequence, at: event.meta.occurredAt, data });
        } }],
      });
    } finally {
      // The real Kernel call has returned or thrown: publish the exit fact
      // immediately, before the outer finally attempts and awaits the owned
      // resource cleanup. The two proofs (Kernel exit vs resources closed)
      // stay separate, and an initialization failure that never reached the
      // Kernel call never fires this.
      onKernelExited?.();
    }
    completed = result.state.status === 'completed';
    stopped = result.state.status === 'paused' || result.state.status === 'cancelled';
    // Ruling 25: the Kernel turns the thrown stream error into a failed run and
    // returns; only here can the driver keep the `unavailable` rejection code.
    if (toolSpecsRejection !== undefined) throw new RuntimeModelCallRejected('unavailable', toolSpecsRejection);
    return result;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // Normal completion, model failure, initialization failure, timeout, cancellation and host
    // close all leave through here: every resource is attempted and awaited. The tool groups are
    // drained first (a suspended first_use open is awaited there through its in-flight handler),
    // then the source that actually resolved is closed exactly once. A cleanup failure is reported
    // only when the Kernel result would otherwise be a successful run; it never replaces an
    // initialization/model error or a Kernel-recorded failure, and never turns a failed cleanup
    // into a successful run.
    const cleanupFailure = await closeOwnedResources(owned, closeSource);
    // R4.3a: the internal cleanup proof is published only after every owned
    // resource was attempted and awaited. It is not a public ack and it never
    // changes the existing outcome/error priority below.
    onResourcesClosed?.(cleanupFailure === undefined
      ? { status: 'completed' }
      : { status: 'failed', reason: exactMessage(cleanupFailure) });
    // Callers without the internal notification keep the original priority: a
    // cleanup failure only replaces an otherwise completed run. At the R4.3a
    // control seam (`onResourcesClosed` present) a real paused/cancelled stop
    // must preserve the cleanup failure instead of reporting a clean stop.
    const propagateCleanupFailure = onResourcesClosed === undefined ? completed : (completed || stopped);
    if (cleanupFailure !== undefined && propagateCleanupFailure && !failed) throw cleanupFailure;
  }
}
