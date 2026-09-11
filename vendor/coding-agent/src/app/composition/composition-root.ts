/** M5 生产 Composition Root：装配 Provider、工具、安全链、Session 与 Runtime。 */
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { ApprovalRequester } from "../../policy/approval/approval-coordinator.js";
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import type { ModelToolSpec } from "../../core/ports/model_client/model-client-port.js";
import type { SkillContext } from "../../core/context/types/context-types.js";
import {
  ApprovalCoordinator,
  StaticApprovalRequester,
} from "../../policy/approval/approval-coordinator.js";
import {
  checksum,
  type RunConfigSnapshot,
} from "../../core/ports/session_store/session-store-port.js";
import { RuntimeRunner } from "../../core/runtime/loop/runtime-runner.js";
import { CheckpointingEventSink } from "../../core/runtime/checkpointing/checkpointing-event-sink.js";
import { createInitialRunState } from "../../core/runtime/state/run-state.js";
import type { RunState } from "../../core/runtime/state/run-state.js";
import type { ProviderRegistry } from "../../model/providers/registry/provider-registry.js";
import { EmptyMemoryProvider } from "../../memory/providers/empty/empty-memory-provider.js";
import { MAX_MEMORY_QUERY_BYTES } from "../../core/ports/memory_provider/memory-provider-port.js";
import { createBuiltinProviderRegistry } from "../../model/providers/registry/builtin-provider-registry.js";
import { DefaultPermissionPolicy } from "../../policy/permissions/permission-policy.js";
import { ProcessSandbox } from "../../sandbox/process/process-sandbox.js";
import { WorkspaceSandbox } from "../../sandbox/workspace/workspace-sandbox.js";
import { FileSkillLoader } from "../../skills/loader/file-skill-loader.js";
import { SqliteStores } from "../../storage/adapters/sqlite/sqlite-stores.js";
import { SessionEventSink } from "../../storage/session_event_sink/session-event-sink.js";
import { createEditToolDefinition } from "../../tools/builtin/edit/edit-tool.js";
import { createCheckToolDefinition } from "../../tools/builtin/check/check-tool.js";
import { createReadToolDefinition } from "../../tools/builtin/read/read-tool.js";
import { createShellToolDefinition } from "../../tools/builtin/shell/shell-tool.js";
import { ToolDispatcher } from "../../tools/dispatcher/tool-dispatcher.js";
import { RegistryToolBatchPolicy, ToolRegistry } from "../../tools/registry/tool-registry.js";
import type { AppConfig } from "./app-config.js";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  CODING_AGENT_SYSTEM_PROMPT_VERSION,
} from "../prompts/coding-agent-system-prompt.js";

export interface SecretSource {
  get(name: string): string | undefined;
}

export interface AppRuntimeConfiguration {
  readonly systemPromptVersion: string;
  readonly systemPrompt: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking: unknown;
  readonly reasoningEffort: unknown;
  readonly tools: readonly ModelToolSpec[];
  readonly skills: readonly SkillContext[];
  readonly skillResourceRoot: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number | null;
  readonly maxModelRequests: number;
  readonly maxToolCalls: number;
  readonly workspaceConsistency: {
    readonly mode: "session" | "workspace" | "strict";
    readonly revisionStrategy: "git_status_v1" | "sparse_metadata_v1";
    readonly ignoredPrefixes: readonly string[];
  };
}

export interface RunAppInput {
  /** Host-provided tools still use registry validation, permissions and output limits. */
  readonly additionalTools?: (workspace: WorkspaceSandbox) => readonly import("../../tools/schemas/tool-schemas.js").ToolDefinition[];
  /** Host integration: additive controls, no changes to default CLI behavior. */
  readonly limits?: import("../../core/runtime/limits/limit-guard.js").RunLimits;
  readonly processSandboxOptions?: import("../../sandbox/process/process-sandbox.js").ProcessSandboxOptions;
  readonly workspaceOptions?: import("../../sandbox/workspace/workspace-sandbox.js").WorkspaceSandboxOptions;
  readonly config: AppConfig;
  readonly workspaceRoot: string;
  readonly input: string;
  readonly sessionId?: string;
  readonly secretSource?: SecretSource;
  readonly approvalRequester?: ApprovalRequester;
  readonly providerRegistry?: ProviderRegistry;
  readonly signal?: AbortSignal;
  readonly onTextDelta?: (delta: string, requestId: string) => void;
  readonly onReasoningDelta?: (delta: string, requestId: string) => void;
  readonly onConfiguration?: (configuration: Readonly<AppRuntimeConfiguration>) => void;
  /** 只读观察器；Session required sink 提交成功后才会收到事件。 */
  readonly observerEventSinks?: readonly (EventSinkPort & {
    readonly delivery: "best_effort";
  })[];
}

export interface RunAppResult {
  readonly sessionId: string;
  readonly state: RunState;
  readonly enabledTools: readonly string[];
  readonly provider: string;
}

export async function runCodingAgent(input: Readonly<RunAppInput>): Promise<RunAppResult> {
  if (input.input.trim().length === 0) throw new Error("input 不能为空");
  const signal = input.signal ?? new AbortController().signal;
  const providerRegistry = input.providerRegistry ?? createBuiltinProviderRegistry();
  const provider = providerRegistry.get(input.config.model.provider);
  const source = input.secretSource ?? { get: (name: string) => process.env[name] };
  const apiKey = source.get(provider.secretEnvironmentVariable);
  if (!apiKey?.trim()) throw new Error(`${provider.secretEnvironmentVariable} 缺失或非法`);
  const modelClient = providerRegistry.create(provider.id, {
    apiKey,
    model: input.config.model.model,
    ...(input.config.model.baseUrl ? { baseUrl: input.config.model.baseUrl } : {}),
    options: input.config.model.options,
  });

  const workspaceRoot = path.resolve(input.workspaceRoot);
  const workspace = await WorkspaceSandbox.create(workspaceRoot, {
    ...input.workspaceOptions,
    consistencyMode: input.config.workspace.consistencyMode,
  });
  const processProfile = await ProcessSandbox.probe(workspaceRoot, workspace);
  const workspaceBaseline = await workspace.captureBaseline();
  const processSandbox = new ProcessSandbox(processProfile, workspaceRoot, workspace, input.processSandboxOptions);
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createReadToolDefinition(workspace));
  toolRegistry.register(createCheckToolDefinition(workspace));
  toolRegistry.register(createEditToolDefinition(workspace));
  toolRegistry.register(createShellToolDefinition(processSandbox));
  for (const tool of input.additionalTools?.(workspace) ?? []) toolRegistry.register(tool);
  const tools = toolRegistry.freeze(input.config.tools.enabledNames);
  const enabledTools = tools.list().map((tool) => tool.name);
  const capabilities = new Set([
    "workspace_read" as const,
    "workspace_write" as const,
    ...(processProfile.available
      ? (["isolated_process", "network_isolated"] as const)
      : ([] as const)),
  ]);

  const runId = randomUUID();
  const sessionId = input.sessionId ?? randomUUID();
  const now = new Date().toISOString();
  const run = {
    schemaVersion: 1 as const,
    runId,
    turn: {
      turnId: randomUUID(),
      userMessage: {
        schemaVersion: 1 as const,
        messageId: randomUUID(),
        role: "user" as const,
        content: input.input,
      },
    },
    createdAt: now,
  };
  const policy = new DefaultPermissionPolicy({ policyVersion: "m5-v1", hiddenPrefixes: workspace.deniedPrefixes, registeredReadOnlyTools: tools.list().filter(t => t.effectClass === "read_only" && t.requiredCapabilities.includes("workspace_read") && t.requiredCapabilities.every(c => c === "workspace_read")).map(t => t.name) });
  const baseDigest = checksum(input.config);
  const limits = input.limits ?? {
    maxModelRequests: input.config.runtime.maxModelRequests,
    maxToolCalls: input.config.runtime.maxToolCalls,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  };
  const snapshot: RunConfigSnapshot = {
    modelConfigId: `${provider.id}:${input.config.model.model}`,
    limits,
    enabledToolSchemaDigest: checksum(tools.modelToolSpecs()),
    policyVersion: policy.policyVersion,
    sandboxProfileVersion: processProfile.version,
    baseConfigDigest: baseDigest,
  };

  const store = await SqliteStores.open(path.resolve(input.config.storage.databasePath));
  try {
    let revision: number;
    try {
      const existing = await store.get(sessionId, { signal });
      if (existing.activeRunId) throw new Error(`Session ${sessionId} 仍有活动 Run`);
      revision = existing.revision;
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "not_found") {
        const created = await store.create(
          { sessionId, recordId: `session:${sessionId}`, createdAt: now },
          { signal },
        );
        revision = created.revision;
      } else throw error;
    }
    await store.append(
      sessionId,
      revision,
      [
        {
          recordId: `turn:${run.turn.turnId}`,
          recordType: "turn.started",
          schemaVersion: 1,
          recordedAt: now,
          payload: {
            run,
            config: snapshot,
            workspace: {
              identity: workspace.identity,
              revision: workspaceBaseline.revision,
              reference: "workspace:current",
            },
          },
        },
      ],
      { signal },
    );
    const sessionSink = await SessionEventSink.connect(store, sessionId, { signal });
    // 生产事件链：required Session 屏障 + best-effort checkpoint（工具边界派生快照，
    // 供崩溃恢复加速与「最新 checkpoint revision」承诺）+ observer sinks。
    const checkpointSink = new CheckpointingEventSink(
      createInitialRunState(run),
      store,
      sessionSink,
      snapshot,
      {
        identity: workspace.identity,
        revision: workspaceBaseline.revision,
        reference: "workspace:current",
      },
    );

    const skillLoader = await FileSkillLoader.create(
      path.resolve(input.config.skills.resourceRoot),
    );
    const skillProvider = await skillLoader.load(signal);
    const skills = await skillProvider.select(
      { schemaVersion: 1, requestedIds: input.config.skills.enabledIds },
      { signal },
    );
    input.onConfiguration?.({
      systemPromptVersion: CODING_AGENT_SYSTEM_PROMPT_VERSION,
      systemPrompt: CODING_AGENT_SYSTEM_PROMPT,
      provider: provider.id,
      model: input.config.model.model,
      thinking: input.config.model.options["thinking"] ?? "provider_default",
      reasoningEffort: input.config.model.options["reasoningEffort"] ?? "provider_default",
      tools: tools.modelToolSpecs(),
      skills,
      skillResourceRoot: input.config.skills.resourceRoot,
      contextWindowTokens: input.config.runtime.tokenBudget,
      maxOutputTokens: input.config.model.maxOutputTokens,
      maxModelRequests: input.config.runtime.maxModelRequests,
      maxToolCalls: input.config.runtime.maxToolCalls,
      workspaceConsistency: {
        mode: workspace.consistencyMode,
        revisionStrategy: workspaceBaseline.strategy,
        ignoredPrefixes: workspace.snapshotIgnoredPrefixes,
      },
    });
    const memory = new EmptyMemoryProvider();
    const memories = await memory.recall(
      {
        schemaVersion: 1,
        query: boundedMemoryQuery(input.input),
        workspaceIdentity: workspace.identity,
        limit: 20,
      },
      { signal },
    );
    const approval = new ApprovalCoordinator(
      input.approvalRequester ??
        new StaticApprovalRequester({ decision: "deny", reason: "interaction_unavailable" }),
    );
    const dispatcher = new ToolDispatcher({
      registry: tools,
      permissionPolicy: policy,
      approval,
      capabilities,
      runId,
      workspaceIdentity: workspace.identity,
      workspaceRevision: () => workspace.revision(),
      ...(workspace.consistencyMode === "strict"
        ? {
            reconcileBeforeApproval: async () => {
              const report = await workspace.checkConsistency("workspace");
              return { changedPaths: report.changedPaths };
            },
          }
        : {}),
      sandboxProfileVersion: processProfile.version,
    });
    const runner = new RuntimeRunner({
      modelClient,
      toolExecutor: dispatcher,
      eventSinks: [checkpointSink, sessionSink, ...(input.observerEventSinks ?? [])],
      limits,
      toolBatchPolicy: new RegistryToolBatchPolicy(tools),
      maxModelRetries: 0,
      toolEffectClass: (call) => tools.resolve(call.name)?.effectClass ?? "process",
      ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
      ...(input.onReasoningDelta ? { onReasoningDelta: input.onReasoningDelta } : {}),
    });
    const state = await runner.run(
      {
        run,
        baseSystemPrompt: CODING_AGENT_SYSTEM_PROMPT,
        tools: tools.modelToolSpecs(),
        skills,
        memories,
        tokenBudget: input.config.runtime.tokenBudget,
        maxOutputTokens: input.config.model.maxOutputTokens,
      },
      { signal },
    );
    return { sessionId, state, enabledTools, provider: provider.id };
  } finally {
    await store.close();
  }
}

/** 辅助召回查询有自己的字节边界；模型输入仍使用完整 input.input。 */
function boundedMemoryQuery(input: string): string {
  const text = input.trim();
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > MAX_MEMORY_QUERY_BYTES) break;
    bytes += size;
    end += character.length;
  }
  return text.slice(0, end);
}
