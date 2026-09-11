/** M5 resume Composition：复用 Session 事实与 RecoveryCoordinator 继续未完成 Run。 */
import path from "node:path";

import type { ApprovalRequester } from "../../policy/approval/approval-coordinator.js";
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import {
  ApprovalCoordinator,
  StaticApprovalRequester,
} from "../../policy/approval/approval-coordinator.js";
import {
  checksum,
  type RunConfigSnapshot,
  type SessionRecord,
} from "../../core/ports/session_store/session-store-port.js";
import { RecoveryCoordinator } from "../../core/runtime/recovery/recovery-coordinator.js";
import type { RecoveryAction } from "../../core/runtime/recovery/recovery-coordinator.js";
import { CheckpointingEventSink } from "../../core/runtime/checkpointing/checkpointing-event-sink.js";
import { RuntimeRunner } from "../../core/runtime/loop/runtime-runner.js";
import type { RunState } from "../../core/runtime/state/run-state.js";
import { EmptyMemoryProvider } from "../../memory/providers/empty/empty-memory-provider.js";
import { createBuiltinProviderRegistry } from "../../model/providers/registry/builtin-provider-registry.js";
import type { ProviderRegistry } from "../../model/providers/registry/provider-registry.js";
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
import type { AppRuntimeConfiguration, SecretSource } from "./composition-root.js";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  CODING_AGENT_SYSTEM_PROMPT_VERSION,
} from "../prompts/coding-agent-system-prompt.js";

export interface ResumeAppInput {
  /** Host-provided tools still use registry validation, permissions and output limits. */
  readonly additionalTools?: (workspace: WorkspaceSandbox) => readonly import("../../tools/schemas/tool-schemas.js").ToolDefinition[];
  readonly config: AppConfig;
  readonly workspaceRoot: string;
  readonly sessionId: string;
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

export interface ResumeAppResult {
  readonly sessionId: string;
  readonly state: RunState;
  readonly action: RecoveryAction;
  readonly enabledTools: readonly string[];
  readonly provider: string;
}

async function readRecords(
  store: SqliteStores,
  sessionId: string,
  signal: AbortSignal,
): Promise<readonly SessionRecord[]> {
  const records: SessionRecord[] = [];
  let position = 0;
  while (true) {
    const page = await store.read(sessionId, position, 256, { signal });
    records.push(...page.records);
    position = page.records.at(-1)?.position ?? position;
    if (page.nextPosition === null) return records;
  }
}

export async function resumeCodingAgent(input: Readonly<ResumeAppInput>): Promise<ResumeAppResult> {
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
    consistencyMode: input.config.workspace.consistencyMode,
  });
  const processProfile = await ProcessSandbox.probe(workspaceRoot, workspace);
  const workspaceBaseline = await workspace.captureBaseline();
  const processSandbox = new ProcessSandbox(processProfile, workspaceRoot, workspace);
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createReadToolDefinition(workspace));
  toolRegistry.register(createCheckToolDefinition(workspace));
  toolRegistry.register(createEditToolDefinition(workspace));
  toolRegistry.register(createShellToolDefinition(processSandbox));
  for (const tool of input.additionalTools?.(workspace) ?? []) toolRegistry.register(tool);
  const tools = toolRegistry.freeze(input.config.tools.enabledNames);
  const enabledTools = tools.list().map((tool) => tool.name);
  const policy = new DefaultPermissionPolicy({ policyVersion: "m5-v1", hiddenPrefixes: workspace.deniedPrefixes, registeredReadOnlyTools: tools.list().filter(t => t.effectClass === "read_only" && t.requiredCapabilities.includes("workspace_read") && t.requiredCapabilities.every(c => c === "workspace_read")).map(t => t.name) });
  const limits = {
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
    baseConfigDigest: checksum(input.config),
  };
  const currentWorkspace = {
    identity: workspace.identity,
    revision: workspaceBaseline.revision,
    reference: "workspace:current",
  };
  const store = await SqliteStores.open(path.resolve(input.config.storage.databasePath));
  try {
    const records = await readRecords(store, input.sessionId, signal);
    const turnRecord = records.findLast((record) => record.recordType === "turn.started");
    if (!turnRecord || turnRecord.recordType !== "turn.started") {
      throw new Error(`Session ${input.sessionId} 没有可恢复 Turn`);
    }
    const recovery = await new RecoveryCoordinator({
      sessions: store,
      checkpoints: store,
      toolEffectClass: (name) => tools.resolve(name)?.effectClass ?? "process",
    }).recover(input.sessionId, { signal }, { config: snapshot, workspace: currentWorkspace });
    // 恢复追加的对账事实（process_interrupted / tool.outcome_unknown / run.failed / run.completed）
    // 必须与 Session 落盘一致地投递给 observer/Web Projection，用户时间线才能看到
    // 副作用未知、取消或放弃的工具事实；best_effort 失败只记诊断，不影响恢复结果。
    for (const event of recovery.reconciledEvents) {
      for (const observer of input.observerEventSinks ?? []) {
        await observer.publish(event, { signal }).catch((error: unknown) => {
          console.warn(`恢复事件投递失败（${observer.sinkId}）：${String(error)}`);
        });
      }
    }
    // terminal 与 side_effect_result_unknown 都是唯一终态：原 Run 已结束，
    // 当前生产路径不会再调用模型。合成 ToolResult 已作为 tool_result 写入 Session
    // 事实（transcript），供审计视图与未来的 Context Projection/下一 Turn handoff 消费；
    // 这是「结果对模型可见」的实际边界，不要声称恢复后同一 Turn 会自动看到。
    if (recovery.action === "terminal" || recovery.action === "side_effect_result_unknown") {
      return {
        sessionId: input.sessionId,
        state: recovery.state,
        action: recovery.action,
        enabledTools,
        provider: provider.id,
      };
    }

    const skillProvider = await (
      await FileSkillLoader.create(path.resolve(input.config.skills.resourceRoot))
    ).load(signal);
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
        query: turnRecord.payload.run.turn.userMessage.content,
        workspaceIdentity: workspace.identity,
        limit: 20,
      },
      { signal },
    );
    const capabilities = new Set([
      "workspace_read" as const,
      "workspace_write" as const,
      ...(processProfile.available
        ? (["isolated_process", "network_isolated"] as const)
        : ([] as const)),
    ]);
    const dispatcher = new ToolDispatcher({
      registry: tools,
      permissionPolicy: policy,
      approval: new ApprovalCoordinator(
        input.approvalRequester ??
          new StaticApprovalRequester({ decision: "deny", reason: "interaction_unavailable" }),
      ),
      capabilities,
      runId: recovery.state.runId,
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
    const sessionSink = await SessionEventSink.connect(store, input.sessionId, { signal });
    // 恢复续跑同样接入 checkpoint sink，使工具边界派生快照覆盖整个生命周期。
    const checkpointSink = new CheckpointingEventSink(
      recovery.state,
      store,
      sessionSink,
      snapshot,
      currentWorkspace,
    );
    const runner = new RuntimeRunner({
      modelClient,
      toolExecutor: dispatcher,
      eventSinks: [checkpointSink, sessionSink, ...(input.observerEventSinks ?? [])],
      limits,
      toolBatchPolicy: new RegistryToolBatchPolicy(tools),
      maxModelRetries: 0,
      ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
      ...(input.onReasoningDelta ? { onReasoningDelta: input.onReasoningDelta } : {}),
    });
    const context = {
      run: turnRecord.payload.run,
      baseSystemPrompt: CODING_AGENT_SYSTEM_PROMPT,
      tools: tools.modelToolSpecs(),
      skills,
      memories,
      tokenBudget: input.config.runtime.tokenBudget,
      maxOutputTokens: input.config.model.maxOutputTokens,
    };
    const state =
      recovery.action === "paused"
        ? await runner.resume(recovery.state, context, { signal })
        : await runner.continueRecovered(recovery.state, context, { signal });
    return {
      sessionId: input.sessionId,
      state,
      action: recovery.action,
      enabledTools,
      provider: provider.id,
    };
  } finally {
    await store.close();
  }
}
