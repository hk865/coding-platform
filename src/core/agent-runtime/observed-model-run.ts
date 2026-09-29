import { createHash } from 'node:crypto';
import type { ModelCallAccess } from '../../contracts/dispatch.js';
import { resolve } from 'node:path';
import type { AgentEvent, ExecutionIdentity, HookPort, ModelClientPort, SessionContextMode, ToolDefinition, ToolGroupBarrier, WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';
import type { BoundModel } from './source-tool-ports.js';
import type { ModelBudget, RuntimeBudget } from './model-budget.js';
import type { ModelTokenBudget } from './model-budget.js';
import { kernelRunLimits } from './run-limits.js';
import { createExplorationTools, type ExplorationToolsHandle, type SourceToolOptions } from './exploration-tools.js';
import { readSourceIdentity } from '../../core/workspace/source-identity.js';
import type { RuntimeSourceCaptureAccess, RuntimeSourceCaptureFactory } from './source-tool-ports.js';

/** The internal result of the ONE existing finally cleanup. It is a local
 * proof for the Trusted Host's live handle, never a public control ack. */
export type RuntimeResourceCloseResult =
  | { status: 'completed' }
  | { status: 'failed'; reason: string };

export type ObservedModelRunOptions = {
  kernel: typeof import('../../../vendor/coding-agent/dist/public-api.js'); bound: BoundModel; meter: ModelBudget;
  root: string; databasePath: string; sessionId: string; input: string; budget: RuntimeBudget; readOnly: boolean;
  /** Persistent Run cumulative constraint; the formal driver always supplies it. */
  taskBudget?: ModelTokenBudget;
  /** Trusted clock used to evaluate the persistent absolute task deadline. */
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
   * Trusted Host Skill resource configuration for this model loop. When present it is the only
   * source of skills, including an explicit empty `enabledIds`; when absent the existing
   * coding-safety behavior is preserved. Mutable fields are snapshotted before the first await.
   * This is an internal Host seam, not a place for caller-supplied model JSON.
   */
  skills?: { resourceRoot: string; enabledIds: string[] };
  /** 显式结构化报告请求；必须在容量计量和模型调用授权前进入真实请求。 */
  responseFormat?: { type: 'json_object' };
  /** Static host-owned role guidance only; never interpolate source or memory content. */
  systemInstruction?: string;
  sourceTools?: SourceToolOptions;
  /**
   * 本次模型循环的源码捕获模式。未指定（或显式 `legacy_live`）保持原调用方兼容语义，
   * 仍是旧 `project_index` 实时路径；显式 `frozen` 必须提供可信工厂，**不会**回落成旧工具。
   * 工厂返回的访问能力由本函数独占并在 finally 关闭；工具组不能关闭它。
   *
   * `openOn` 决定可信工厂何时被调用：缺省或 `before_run` 保持既有 eager 语义，此时工厂失败
   * 原样结束本次调用；`first_use` 先注册 `project_source` 而不调用工厂、也不回落 `project_index`，
   * 在第一次真实工具执行时才打开，同一 Run 至多一个共享 open Promise，其失败由工具作为 error
   * 结果交回模型，Kernel 可继续该 Run（不要求整次 Run 抛异常）。
   */
  projectSource?: { mode: 'legacy_live' } | { mode: 'frozen'; open: RuntimeSourceCaptureFactory; openOn?: 'before_run' | 'first_use' };
  materialTools?: (workspace: WorkspaceSandbox) => ToolDefinition[];
  /**
   * 协调 Host 工具（协作通信）。它们是**平台级**入口：身份由宿主绑定，
   * 副作用经 Host Adapter 的正式受理路径落在平台的 canonical 状态上，不改动模型的工作区。
   * `names` 必须与 `create()` 实际返回的工具名一致（本次请求的启用清单在 workspace 存在之前
   * 就要定下来，因此由调用方显式给出，而不是在这里猜）。
   */
  coordinationTools?: { names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] };
  processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
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
export async function runObservedModel(o: ObservedModelRunOptions) {
  // Capture the trusted Host configuration synchronously, before the first await, so later
  // mutation of the caller's array/object cannot change this run. Hook functions are forwarded
  // with their original receiver instead of being JSON-cloned; an explicit empty `enabledIds`
  // stays empty and never secretly falls back to coding-safety.
  const controlHooks = o.controlHooks === undefined ? undefined : snapshotControlHooks(o.controlHooks);
  // R4.3a: capture the optional tool-group barrier and the internal cleanup
  // notification before the first await, so a caller mutating the options object
  // afterwards cannot select or drop a new control behavior mid-run.
  const toolGroupBarrier = o.toolGroupBarrier;
  const onResourcesClosed = o.onResourcesClosed;
  const onKernelExited = o.onKernelExited;
  const skills = o.skills === undefined ? undefined : { resourceRoot: o.skills.resourceRoot, enabledIds: [...o.skills.enabledIds] };
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
        await o.modelCalls!.beforeCall({ requestId: request.requestId,
          requestDigest: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
          contextInputDigest: createHash('sha256').update(o.input).digest('hex'), manifestDigest: o.manifestDigest });
        if (o.signal.aborted) throw Error('Run cancelled before provider boundary');
        yield* o.bound.client.stream(request, options);
      },
    } : o.bound.client;
    // The meter applies the final output limit before authorization hashes the request.
    const metered = o.meter.wrap(provider);
    const client: ModelClientPort = {
      async *stream(request, options) {
        await o.sourceTools?.assertCurrent?.();
        const outgoing = { ...request,
          ...(o.responseFormat ? { responseFormat: { ...o.responseFormat } } : {}),
          ...(o.systemInstruction ? { systemPrompt: request.systemPrompt + '\n\n' + o.systemInstruction } : {}) };
        yield* metered.stream(outgoing, options);
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
    const readTools = hasRead ? ['list_files', 'search', 'symbols', 'code_index', frozen ? 'project_source' : 'project_index', 'python_index', 'cpp_index', 'source_excerpt'] : [];
    // 协调工具只有在宿主**确实**注入了访问面时才装配；注入时它们和内置工具一样出现在
    // 本次请求的工具清单里（模型只能看见被启用的工具名）。
    const coordinationNames = [...(o.coordinationTools?.names ?? [])];
    const enabledNames = hasRead && reviewSource
      ? ['read_source', ...(o.materialTools ? ['read_material'] : []), ...readTools, ...coordinationNames]
      : [...allowed.map(tool => tool === 'write' ? 'edit' : tool), ...readTools, ...coordinationNames];
    const needsExploration = hasRead;
    let result!: Awaited<ReturnType<typeof o.kernel.runCodingAgent>>;
    try {
      result = await o.kernel.runCodingAgent({
        config: { ...base, model: { ...base.model, provider: definition.id, model: o.bound.configuration.model, baseUrl: o.bound.configuration.baseUrl, maxOutputTokens: o.budget.perResponseTokens },
          runtime: { tokenBudget: o.budget.contextWindowTokens, maxModelRequests: o.budget.maxRequests ?? base.runtime.maxModelRequests, maxToolCalls: o.budget.maxToolCalls ?? base.runtime.maxToolCalls },
          tools: { enabledNames },
          storage: { databasePath: o.databasePath },
          skills: skills ?? { resourceRoot: resolve(import.meta.dirname, '../../../vendor/coding-agent/resources/skills'), enabledIds: ['coding-safety'] } },
        // 宿主对**非只读**扩展工具的显式授权：只有这里列出、且确实被 additionalTools 注册、
        // 且 effectClass 不是 read_only 的名字才会被内核的权限策略采纳（协议约束 2.3）。
        // 缺席时协调工具会被内核按"未授权的未知操作"拒绝——这是刻意的 fail-closed。
        hostAuthorizedTools: coordinationNames,
        additionalTools: workspace => {
          const tools: ToolDefinition[] = [];
          if (needsExploration) {
            // Register the created handle before the material/coordination factories can throw, so a
            // later initialization failure still closes this group. The run-level projectSource is
            // authoritative; a caller-supplied access in `sourceTools` cannot be used unowned here.
            const handle = createExplorationTools(workspace, {
              sourceIdentity: () => readSourceIdentity(o.root, workspace.identity), ...o.sourceTools,
              projectSource: frozen
                ? (lazyFrozen ? { mode: 'frozen', access: openSharedSource } : { mode: 'frozen', access: source! })
                : { mode: 'legacy_live' },
            });
            owned.push(handle);
            tools.push(...handle.tools);
          }
          tools.push(...(o.materialTools?.(workspace) ?? []));
          tools.push(...(o.coordinationTools?.create(workspace) ?? []));
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
        workspaceOptions: { deniedPrefixes: o.deniedPrefixes }, processSandboxOptions: o.processSandboxOptions,
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
