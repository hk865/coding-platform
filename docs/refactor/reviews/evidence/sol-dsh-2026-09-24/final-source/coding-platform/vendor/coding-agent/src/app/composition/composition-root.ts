/** M5 生产 Composition Root：装配 Provider、工具、安全链、Session 与 Runtime。 */
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { ApprovalRequester } from "../../policy/approval/approval-coordinator.js";
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import type { HookPort } from "../../core/hooks/protocol/hook-protocol.js";
import {
  ApprovalCoordinator,
  StaticApprovalRequester,
} from "../../policy/approval/approval-coordinator.js";
import {
  checksum,
  type ContextBasis,
  type RunConfigSnapshot,
  type SessionRecord,
} from "../../core/ports/session_store/session-store-port.js";
import {
  parseContextBasis,
  readAllSessionRecords,
  restoreSessionHistory,
} from "../../core/ports/session_store/session-history.js";
import { StoreError } from "../../core/ports/session_store/session-store-port.js";
import { RuntimeRunner } from "../../core/runtime/loop/runtime-runner.js";
import { CheckpointingEventSink } from "../../core/runtime/checkpointing/checkpointing-event-sink.js";
import { createInitialRunState } from "../../core/runtime/state/run-state.js";
import type { RunState, TranscriptEntry } from "../../core/runtime/state/run-state.js";
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
  kernelSessionApiVersion,
  type AppRuntimeConfiguration,
  type ExecutionIdentity,
  type SecretSource,
  type SessionContextMode,
} from "./composition-contracts.js";
import { createControlHookExecutor } from "./control-hooks.js";
import {
  resolveRecoveryWorkspaceOptions,
  type EffectiveRecoveryConstraints,
} from "./recovery-contract.js";
import { resumeCodingAgentInternal } from "./resume-composition.js";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  CODING_AGENT_SYSTEM_PROMPT_VERSION,
} from "../prompts/coding-agent-system-prompt.js";

/**
 * 共享类型继续从本文件可达，`m5-public-api` 的既有导出路径不变。
 * 定义在 composition-contracts.ts，避免与 resume-composition 形成循环导入。
 */
export type { AppRuntimeConfiguration, SecretSource } from "./composition-contracts.js";
export { kernelSessionApiVersion };
export type { ExecutionIdentity, SessionContextMode };

export interface RunAppInput {
  /** Host-provided tools still use registry validation, permissions and output limits. */
  readonly additionalTools?: (
    workspace: WorkspaceSandbox,
  ) => readonly import("../../tools/schemas/tool-schemas.js").ToolDefinition[];
  /**
   * 宿主对**非只读**扩展能力的显式授权（工具名）。
   *
   * 只有同时出现在 `additionalTools`（本轮确实注册）且 effectClass 不是 read_only 的名字
   * 才会被采纳；内置 read/check/edit/shell 的规则与路径/敏感资源检查不受影响。
   * 这是"宿主必须明确授权"的唯一入口：工具自身不能把自己的能力声明成只读来换取放行。
   */
  readonly hostAuthorizedTools?: readonly string[];
  /** Host integration: additive controls, no changes to default CLI behavior. */
  readonly limits?: import("../../core/runtime/limits/limit-guard.js").RunLimits;
  readonly processSandboxOptions?: import("../../sandbox/process/process-sandbox.js").ProcessSandboxOptions;
  readonly workspaceOptions?: import("../../sandbox/workspace/workspace-sandbox.js").WorkspaceSandboxOptions;
  /**
   * 会话上下文模式；缺省 `current_turn`，即与旧 CLI 完全相同的单轮输入。
   * `session_history` 要求 Session 已存在，且 `throughPosition` 是真实已完成轮次的边界。
   */
  readonly sessionContext?: SessionContextMode;
  /** 稳定执行身份；缺省随机生成。提供时同一身份+相同内容进入恢复/回放，不追加第二个 Turn。 */
  readonly executionIdentity?: ExecutionIdentity;
  /**
   * 宿主控制 Hook；只接入 `before_model`/`before_tool` 的 `pause`/`continue`。
   * `after_tool` 与 block/modify/fail 显式 unsupported，不假装已接通。
   */
  readonly controlHooks?: readonly HookPort[];
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
  const sessionContext = resolveSessionContextMode(input.sessionContext);
  const executionIdentity = resolveExecutionIdentity(input.executionIdentity);
  const controlHookExecutor = createControlHookExecutor(input.controlHooks);
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
  // run/resume 共用同一解析：只把配置的 SQLite 文件（含 -wal/-shm/-journal）排除出
  // revision 快照，避免内核自身存储写入把暂停视为环境漂移；读写权限与同目录普通文件
  // 的核对不变。consistencyMode 仍按 config 装配顺序覆盖。
  const workspaceOptions = resolveRecoveryWorkspaceOptions(
    workspaceRoot,
    input.config.storage.databasePath,
    input.workspaceOptions,
  );
  const workspace = await WorkspaceSandbox.create(workspaceRoot, {
    ...workspaceOptions,
    consistencyMode: input.config.workspace.consistencyMode,
  });
  const processProfile = await ProcessSandbox.probe(workspaceRoot, workspace);
  const workspaceBaseline = await workspace.captureBaseline();
  const processSandbox = new ProcessSandbox(
    processProfile,
    workspaceRoot,
    workspace,
    input.processSandboxOptions,
  );
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createReadToolDefinition(workspace));
  toolRegistry.register(createCheckToolDefinition(workspace));
  toolRegistry.register(createEditToolDefinition(workspace));
  toolRegistry.register(createShellToolDefinition(processSandbox));
  const additionalTools = [...(input.additionalTools?.(workspace) ?? [])];
  for (const tool of additionalTools) toolRegistry.register(tool);
  const tools = toolRegistry.freeze(input.config.tools.enabledNames);
  const enabledTools = tools.list().map((tool) => tool.name);
  const capabilities = new Set([
    "workspace_read" as const,
    "workspace_write" as const,
    ...(processProfile.available
      ? (["isolated_process", "network_isolated"] as const)
      : ([] as const)),
  ]);

  const runId = executionIdentity?.runId ?? randomUUID();
  const sessionId = input.sessionId ?? randomUUID();
  const now = new Date().toISOString();
  const run = {
    schemaVersion: 1 as const,
    runId,
    turn: {
      turnId: executionIdentity?.turnId ?? randomUUID(),
      userMessage: {
        schemaVersion: 1 as const,
        messageId: randomUUID(),
        role: "user" as const,
        content: input.input,
      },
    },
    createdAt: now,
  };
  // 宿主显式授权的非只读扩展：只认本轮确实注册过、且 effectClass 不是 read_only 的扩展工具名。
  // 名单里出现内置工具名或未注册的名字都不产生任何权限（在这里被过滤掉）。
  const authorizedHostTools = new Set(input.hostAuthorizedTools ?? []);
  const hostAuthorizedTools = additionalTools
    .filter((t) => t.effectClass !== "read_only" && authorizedHostTools.has(t.name))
    .map((t) => t.name);
  const policy = new DefaultPermissionPolicy({
    policyVersion: "m5-v1",
    hiddenPrefixes: workspace.deniedPrefixes,
    registeredReadOnlyTools: tools
      .list()
      .filter(
        (t) =>
          t.effectClass === "read_only" &&
          t.requiredCapabilities.includes("workspace_read") &&
          t.requiredCapabilities.every((c) => c === "workspace_read"),
      )
      .map((t) => t.name),
    hostAuthorizedTools,
  });
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

  // R4a：把本次新执行解析后的**实际生效约束**随 turn.started / checkpoint 落盘。恢复时只认
  // 这份记录；`baseConfigDigest` 等摘要不能证明调用者当时没有额外传入沙箱 / 授权选项。
  // 直接从构造后的实例读取（getter 已解析默认、规范化并过滤），不复制沙箱默认常量。
  const recoveryConstraints: EffectiveRecoveryConstraints = {
    version: 1,
    limits,
    workspace: {
      deniedPrefixes: workspace.deniedPrefixes,
      snapshotIgnoredPrefixes: workspace.snapshotIgnoredPrefixes,
      consistencyMode: workspace.consistencyMode,
      maxFileBytes: workspace.maxFileBytes,
    },
    process: {
      protectedPaths: processSandbox.effectiveOptions.protectedPaths,
      readOnlyPaths: processSandbox.effectiveOptions.readOnlyPaths,
      executablePath: processSandbox.effectiveOptions.executablePath,
    },
    hostAuthorizedTools,
  };

  const store = await SqliteStores.open(path.resolve(input.config.storage.databasePath));
  try {
    let revision: number;
    let records: readonly SessionRecord[] | null = null;
    if (sessionContext.mode === "session_history") {
      // 历史边界必须属于已存在的 Session；不为它新建空会话，也不把「最后位置」当完成证据。
      const existing = await store.get(sessionId, { signal });
      if (existing.activeRunId && existing.activeRunId !== executionIdentity?.runId) {
        throw new Error(`Session ${sessionId} 仍有活动 Run`);
      }
      revision = existing.revision;
      records = await readAllSessionRecords(store, sessionId, signal);
    } else {
      try {
        const existing = await store.get(sessionId, { signal });
        if (existing.activeRunId && existing.activeRunId !== executionIdentity?.runId) {
          throw new Error(`Session ${sessionId} 仍有活动 Run`);
        }
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
    }
    const contextBasis: ContextBasis | undefined =
      sessionContext.mode === "session_history"
        ? {
            version: 1,
            mode: "session_history",
            throughPosition: sessionContext.throughPosition,
          }
        : undefined;
    // 已完成轮次重建出的前缀：只与当前 Turn 合并做一次预算选择，且绝不含当前 Turn。
    let historyTranscript: readonly TranscriptEntry[] = [];
    if (sessionContext.mode === "session_history" && contextBasis) {
      const restored = restoreSessionHistory(records ?? [], {
        sessionId,
        throughPosition: contextBasis.throughPosition,
        currentTurn: {
          runId,
          turnId: run.turn.turnId,
          userMessageId: run.turn.userMessage.messageId,
        },
      });
      historyTranscript = restored.transcript;
    }
    // 稳定执行身份重试：先按原身份查记录。同一 Turn 已存在时进入恢复/回放，
    // 绝不追加第二个 turn.started；身份相同但内容不同则显式拒绝。
    if (executionIdentity) {
      records ??= await readAllSessionRecords(store, sessionId, signal);
      const existingTurn = records.find(
        (record) => record.recordType === "turn.started" && record.payload.run.runId === runId,
      );
      if (existingTurn && existingTurn.recordType === "turn.started") {
        assertSameExecutionContent(existingTurn, run, contextBasis);
        await store.close();
        // 精确目标：该 runId/turnId 已确定，恢复不得退回「最新 Turn」。
        const resumed = await resumeCodingAgentInternal(
          {
            ...(input.additionalTools ? { additionalTools: input.additionalTools } : {}),
            ...(input.hostAuthorizedTools
              ? { hostAuthorizedTools: input.hostAuthorizedTools }
              : {}),
            ...(input.limits ? { limits: input.limits } : {}),
            ...(input.workspaceOptions ? { workspaceOptions: input.workspaceOptions } : {}),
            ...(input.processSandboxOptions
              ? { processSandboxOptions: input.processSandboxOptions }
              : {}),
            ...(input.controlHooks ? { controlHooks: input.controlHooks } : {}),
            config: input.config,
            workspaceRoot: input.workspaceRoot,
            sessionId,
            ...(input.secretSource ? { secretSource: input.secretSource } : {}),
            ...(input.approvalRequester ? { approvalRequester: input.approvalRequester } : {}),
            ...(input.providerRegistry ? { providerRegistry: input.providerRegistry } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
            ...(input.onTextDelta ? { onTextDelta: input.onTextDelta } : {}),
            ...(input.onReasoningDelta ? { onReasoningDelta: input.onReasoningDelta } : {}),
            ...(input.onConfiguration ? { onConfiguration: input.onConfiguration } : {}),
            ...(input.observerEventSinks ? { observerEventSinks: input.observerEventSinks } : {}),
          },
          {
            runId: existingTurn.payload.run.runId,
            turnId: existingTurn.payload.run.turn.turnId,
          },
        );
        return {
          sessionId,
          state: resumed.state,
          enabledTools: resumed.enabledTools,
          provider: resumed.provider,
        };
      }
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
            ...(contextBasis ? { contextBasis } : {}),
            recoveryConstraints,
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
      "99-checkpoint-store",
      contextBasis,
      recoveryConstraints,
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
      ...(controlHookExecutor ? { hookExecutor: controlHookExecutor } : {}),
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
        ...(historyTranscript.length > 0 ? { historyTranscript } : {}),
      },
      { signal },
    );
    return { sessionId, state, enabledTools, provider: provider.id };
  } finally {
    await store.close();
  }
}

/** 校验 `SessionContextMode`；无法解释的版本显式 version_unsupported，不静默降级。 */
function resolveSessionContextMode(input: SessionContextMode | undefined): SessionContextMode {
  if (input === undefined) return { version: 1, mode: "current_turn" };
  const candidate = input as { readonly version?: unknown; readonly mode?: unknown };
  if (candidate.version !== 1) {
    throw new StoreError(
      "version_unsupported",
      `sessionContext version=${String(candidate.version)} 不受支持`,
    );
  }
  if (candidate.mode === "current_turn") return { version: 1, mode: "current_turn" };
  if (candidate.mode === "session_history") {
    const throughPosition = (input as { readonly throughPosition?: unknown }).throughPosition;
    if (!Number.isSafeInteger(throughPosition) || (throughPosition as number) < 1) {
      throw new StoreError("invalid_record", "session_history 需要正的 throughPosition");
    }
    return { version: 1, mode: "session_history", throughPosition: throughPosition as number };
  }
  throw new StoreError(
    "version_unsupported",
    `sessionContext mode=${JSON.stringify(candidate.mode)} 不受支持`,
  );
}

/** 校验稳定执行身份；缺省返回 undefined（随机 id，旧语义不变）。 */
function resolveExecutionIdentity(
  input: ExecutionIdentity | undefined,
): ExecutionIdentity | undefined {
  if (input === undefined) return undefined;
  if (input.runId.trim().length === 0 || input.turnId.trim().length === 0) {
    throw new StoreError("invalid_record", "executionIdentity 的 runId/turnId 不能为空");
  }
  return { runId: input.runId, turnId: input.turnId };
}

/**
 * 同一执行身份的「内容一致」判定：身份 + 用户输入 + 会话历史绑定。
 * messageId 每次调用重新生成，不参与判定；身份相同而输入或绑定不同必须显式拒绝。
 */
function assertSameExecutionContent(
  record: Extract<SessionRecord, { recordType: "turn.started" }>,
  run: {
    readonly turn: { readonly turnId: string; readonly userMessage: { readonly content: string } };
  },
  contextBasis: ContextBasis | undefined,
): void {
  if (record.payload.run.turn.turnId !== run.turn.turnId) {
    throw new StoreError("idempotency_conflict", "相同 runId 已存在不同的 turnId");
  }
  if (record.payload.run.turn.userMessage.content !== run.turn.userMessage.content) {
    throw new StoreError("idempotency_conflict", "相同执行身份的用户输入不同");
  }
  const recorded = record.payload.contextBasis;
  const recordedBasis = recorded ? parseContextBasis(recorded) : null;
  if (
    (recordedBasis?.throughPosition ?? null) !== (contextBasis?.throughPosition ?? null) ||
    (recordedBasis?.mode ?? null) !== (contextBasis?.mode ?? null)
  ) {
    throw new StoreError("idempotency_conflict", "相同执行身份的会话历史绑定不同");
  }
}

/** 辅助召回查询有自己的字节边界；模型输入仍使用完整 input.input。 */
function boundedMemoryQuery(input: string): string {
  const text = input.trim();
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > MAX_MEMORY_QUERY_BYTES) break;
    bytes += size;
    end += character.length;
  }
  return text.slice(0, end);
}
