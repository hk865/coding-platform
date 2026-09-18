import { createHash } from 'node:crypto';
import type { ModelCallAccess } from '../../contracts/dispatch.js';
import { resolve } from 'node:path';
import type { AgentEvent, ModelClientPort, ToolDefinition, WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';
import type { BoundModel } from './coding-agent-runtime.js';
import type { ModelBudget, RuntimeBudget } from './model-budget.js';
import { kernelRunLimits } from './run-limits.js';
import { createExplorationTools, type SourceToolOptions } from './exploration-tools.js';
import { readSourceIdentity } from '../../data/workspace-reader/source-identity.js';

export type ObservedModelRunOptions = {
  kernel: typeof import('../../../vendor/coding-agent/dist/public-api.js'); bound: BoundModel; meter: ModelBudget;
  root: string; databasePath: string; sessionId: string; input: string; budget: RuntimeBudget; readOnly: boolean;
  signal: AbortSignal; deniedPrefixes: string[];
  modelCalls?: ModelCallAccess; manifestDigest?: string; assertMaterialsCurrent?: () => Promise<void>;
  allowedTools?: string[];
  /** 显式结构化报告请求；必须在容量计量和模型调用授权前进入真实请求。 */
  responseFormat?: { type: 'json_object' };
  /** Static host-owned role guidance only; never interpolate source or memory content. */
  systemInstruction?: string;
  sourceTools?: SourceToolOptions;
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

/** Shared model/tool loop for execution, query and semantic role work. All use
 * the same provider binding, final-request capacity guard and public event seam. */
export async function runObservedModel(o: ObservedModelRunOptions) {
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
  const readTools = allowed.includes('read') ? ['list_files', 'search', 'symbols', 'code_index', 'project_index', 'python_index', 'cpp_index', 'source_excerpt'] : [];
  // 协调工具只有在宿主**确实**注入了访问面时才装配；注入时它们和内置工具一样出现在
  // 本次请求的工具清单里（模型只能看见被启用的工具名）。
  const coordinationNames = [...(o.coordinationTools?.names ?? [])];
  const enabledNames = reviewSource
    ? ['read_source', ...(o.materialTools ? ['read_material'] : []), ...readTools, ...coordinationNames]
    : [...allowed.map(tool => tool === 'write' ? 'edit' : tool), ...readTools, ...coordinationNames];
  return o.kernel.runCodingAgent({
    config: { ...base, model: { ...base.model, provider: definition.id, model: o.bound.configuration.model, baseUrl: o.bound.configuration.baseUrl, maxOutputTokens: o.budget.perResponseTokens },
      runtime: { tokenBudget: o.budget.contextWindowTokens, maxModelRequests: o.budget.maxRequests ?? base.runtime.maxModelRequests, maxToolCalls: o.budget.maxToolCalls ?? base.runtime.maxToolCalls },
      tools: { enabledNames },
      storage: { databasePath: o.databasePath }, skills: { resourceRoot: resolve(import.meta.dirname, '../../../vendor/coding-agent/resources/skills'), enabledIds: ['coding-safety'] } },
    // 宿主对**非只读**扩展工具的显式授权：只有这里列出、且确实被 additionalTools 注册、
    // 且 effectClass 不是 read_only 的名字才会被内核的权限策略采纳（协议约束 2.3）。
    // 缺席时协调工具会被内核按"未授权的未知操作"拒绝——这是刻意的 fail-closed。
    hostAuthorizedTools: coordinationNames,
    additionalTools: workspace => [
      ...createExplorationTools(workspace, { sourceIdentity: () => readSourceIdentity(o.root, workspace.identity), ...o.sourceTools }),
      ...(o.materialTools?.(workspace) ?? []),
      ...(o.coordinationTools?.create(workspace) ?? []),
    ],
    workspaceRoot: o.root, input: o.input, sessionId: o.sessionId, signal: o.signal,
    secretSource: { get: () => 'platform-bound-client' }, providerRegistry,
    workspaceOptions: { deniedPrefixes: o.deniedPrefixes }, processSandboxOptions: o.processSandboxOptions,
    limits: kernelRunLimits(o.budget),
    approvalRequester: new o.kernel.StaticApprovalRequester({ decision: 'allow_once', reason: o.readOnly ? 'explicit_read_only_role_work' : 'explicit_gui_task_in_isolated_workspace' }),
    observerEventSinks: [{ sinkId: 'platform-live-events', delivery: 'best_effort', publish: async (event: AgentEvent) => {
      const data = JSON.parse(JSON.stringify(event.payload)) as Record<string, unknown>;
      if (data['message'] && typeof data['message'] === 'object') delete (data['message'] as Record<string, unknown>)['reasoningContent'];
      await o.publish({ type: event.type, sequence: event.meta.sequence, at: event.meta.occurredAt, data });
    } }],
  });
}
