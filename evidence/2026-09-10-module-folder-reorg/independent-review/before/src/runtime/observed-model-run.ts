import { resolve } from 'node:path';
import type { AgentEvent, ModelClientPort, ToolDefinition, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import type { BoundModel } from './coding-agent-runtime.js';
import type { ModelBudget, RuntimeBudget } from './model-budget.js';
import { kernelRunLimits } from './run-limits.js';
import { createExplorationTools, type SourceToolOptions } from './exploration-tools.js';
import { readSourceIdentity } from '../data/source-identity.js';

export type ObservedModelRunOptions = {
  kernel: typeof import('../../vendor/coding-agent/dist/public-api.js'); bound: BoundModel; meter: ModelBudget;
  root: string; databasePath: string; sessionId: string; input: string; budget: RuntimeBudget; readOnly: boolean;
  signal: AbortSignal; deniedPrefixes: string[];
  sourceTools?: SourceToolOptions;
  materialTools?: (workspace: WorkspaceSandbox) => ToolDefinition[];
  processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
  publish: (event: { type: string; sequence: number; at: string; data: unknown }) => Promise<void>;
};

/** Shared model/tool loop for execution, query and semantic role work. All use
 * the same provider binding, final-request capacity guard and public event seam. */
export async function runObservedModel(o: ObservedModelRunOptions) {
  const definition = o.kernel.createBuiltinProviderRegistry().get(o.bound.configuration.provider);
  const metered = o.meter.wrap(o.bound.client);
  const client: ModelClientPort = o.sourceTools?.assertCurrent ? {
    async *stream(request, options) {
      await o.sourceTools!.assertCurrent!();
      yield* metered.stream(request, options);
      await o.sourceTools!.assertCurrent!();
    },
  } : metered;
  const providerRegistry = new o.kernel.ProviderRegistry().register({ ...definition, create: () => client });
  const base = await o.kernel.loadAppConfig({ cwd: o.root, environment: {} });
  const reviewSource = o.sourceTools?.includeReadSource === true;
  if (reviewSource && !o.readOnly) throw Error('Pinned source tools require a read-only runtime');
  return o.kernel.runCodingAgent({
    config: { ...base, model: { ...base.model, provider: definition.id, model: o.bound.configuration.model, baseUrl: o.bound.configuration.baseUrl, maxOutputTokens: o.budget.perResponseTokens },
      runtime: { tokenBudget: o.budget.contextWindowTokens, maxModelRequests: o.budget.maxRequests ?? base.runtime.maxModelRequests, maxToolCalls: o.budget.maxToolCalls ?? base.runtime.maxToolCalls },
      tools: { enabledNames: [...(reviewSource ? ['read_source', ...(o.materialTools ? ['read_material'] : [])] : o.readOnly ? ['read'] : ['read', 'edit', 'shell']), 'list_files', 'search', 'symbols', 'code_index', 'project_index', 'python_index', 'cpp_index', 'source_excerpt'] },
      storage: { databasePath: o.databasePath }, skills: { resourceRoot: resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills'), enabledIds: ['coding-safety'] } },
    additionalTools: workspace => [
      ...createExplorationTools(workspace, { sourceIdentity: () => readSourceIdentity(o.root, workspace.identity), ...o.sourceTools }),
      ...(o.materialTools?.(workspace) ?? []),
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
