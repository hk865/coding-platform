/** M5 resume Composition：复用 Session 事实与 RecoveryCoordinator 继续未完成 Run。 */
import path from "node:path";
import { ApprovalCoordinator, StaticApprovalRequester, } from "../../policy/approval/approval-coordinator.js";
import { checksum, parseEffectiveRecoveryConstraints, StoreError, } from "../../core/ports/session_store/session-store-port.js";
import { parseContextBasis, readAllSessionRecords, restoreSessionHistory, } from "../../core/ports/session_store/session-history.js";
import { RecoveryCoordinator } from "../../core/runtime/recovery/recovery-coordinator.js";
import { CheckpointingEventSink } from "../../core/runtime/checkpointing/checkpointing-event-sink.js";
import { RuntimeRunner } from "../../core/runtime/loop/runtime-runner.js";
import { EmptyMemoryProvider } from "../../memory/providers/empty/empty-memory-provider.js";
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
import { createControlHookExecutor } from "./control-hooks.js";
import { requireEffectiveRecoveryConstraints, resolveRecoveryWorkspaceOptions, selectRecoveryTurn, } from "./recovery-contract.js";
import { CODING_AGENT_SYSTEM_PROMPT, CODING_AGENT_SYSTEM_PROMPT_VERSION, } from "../prompts/coding-agent-system-prompt.js";
/**
 * 公开恢复入口：没有显式目标时保持旧 CLI 的「最新 Turn」语义。
 */
export async function resumeCodingAgent(input) {
    return resumeCodingAgentInternal(input, null);
}
/**
 * 内部恢复入口：把稳定执行身份解析出的 `{runId, turnId}` 贯穿 Turn 选择与
 * `RecoveryCoordinator`，使旧身份重放不再退回「最新 Turn」。公开签名不变。
 */
export async function resumeCodingAgentInternal(input, target) {
    const signal = input.signal ?? new AbortController().signal;
    const controlHookExecutor = createControlHookExecutor(input.controlHooks);
    const providerRegistry = input.providerRegistry ?? createBuiltinProviderRegistry();
    const provider = providerRegistry.get(input.config.model.provider);
    const source = input.secretSource ?? { get: (name) => process.env[name] };
    const apiKey = source.get(provider.secretEnvironmentVariable);
    if (!apiKey?.trim())
        throw new Error(`${provider.secretEnvironmentVariable} 缺失或非法`);
    const modelClient = providerRegistry.create(provider.id, {
        apiKey,
        model: input.config.model.model,
        ...(input.config.model.baseUrl ? { baseUrl: input.config.model.baseUrl } : {}),
        options: input.config.model.options,
    });
    const workspaceRoot = path.resolve(input.workspaceRoot);
    // 与 runCodingAgent 共用同一解析：新 turn/checkpoint 记录的实际 ignore 值在 run 与
    // resume 之间必须一致；只排除配置的 SQLite 文件，不改变读写权限。
    const workspaceOptions = resolveRecoveryWorkspaceOptions(workspaceRoot, input.config.storage.databasePath, input.workspaceOptions);
    const workspace = await WorkspaceSandbox.create(workspaceRoot, {
        ...workspaceOptions,
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
    const additionalTools = [...(input.additionalTools?.(workspace) ?? [])];
    for (const tool of additionalTools)
        toolRegistry.register(tool);
    const tools = toolRegistry.freeze(input.config.tools.enabledNames);
    const enabledTools = tools.list().map((tool) => tool.name);
    const authorizedHostTools = new Set(input.hostAuthorizedTools ?? []);
    const hostAuthorizedTools = additionalTools
        .filter((t) => t.effectClass !== "read_only" && authorizedHostTools.has(t.name))
        .map((t) => t.name);
    const policy = new DefaultPermissionPolicy({
        policyVersion: "m5-v1",
        hiddenPrefixes: workspace.deniedPrefixes,
        registeredReadOnlyTools: tools
            .list()
            .filter((t) => t.effectClass === "read_only" &&
            t.requiredCapabilities.includes("workspace_read") &&
            t.requiredCapabilities.every((c) => c === "workspace_read"))
            .map((t) => t.name),
        hostAuthorizedTools,
    });
    const limits = input.limits ?? {
        maxModelRequests: input.config.runtime.maxModelRequests,
        maxToolCalls: input.config.runtime.maxToolCalls,
        maxInputTokens: null,
        maxOutputTokens: null,
        maxTotalTokens: null,
        maxCostUsdMicros: null,
        deadlineMs: null,
    };
    const snapshot = {
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
        const records = await readAllSessionRecords(store, input.sessionId, signal);
        // 与 RecoveryCoordinator.recover 共用同一 Turn 选择算法：精确目标不会被最新 Turn 取代，
        // 目标范围的 contextBasis / 原约束也只从这个 turn.started 读取。
        const targetRecords = selectRecoveryTurn(records, target);
        const turnRecord = targetRecords[0];
        if (!turnRecord || turnRecord.recordType !== "turn.started") {
            throw new StoreError("corrupt", "Turn record 非法");
        }
        // 重启绑定：只从 turn.started 持久化的 contextBasis 边界重建前缀，绝不改成
        // 恢复时的「最新历史」；没有该字段的旧记录保持 current_turn 语义。
        const recordedBasis = turnRecord.payload.contextBasis;
        const contextBasis = recordedBasis ? parseContextBasis(recordedBasis) : null;
        const historyTranscript = contextBasis
            ? restoreSessionHistory(records, {
                sessionId: input.sessionId,
                throughPosition: contextBasis.throughPosition,
                currentTurn: {
                    runId: turnRecord.payload.run.runId,
                    turnId: turnRecord.payload.run.turn.turnId,
                    userMessageId: turnRecord.payload.run.turn.userMessage.messageId,
                },
            }).transcript
            : [];
        // 本次调用的实际生效约束：直接读构造后的沙箱实例值（getter 已解析默认、规范化并过滤），
        // 不在组合层复制沙箱默认常量，也不只保存调用者的可选覆盖。
        const suppliedConstraints = {
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
        // turn.started 的原记录是唯一证据；旧记录没有该字段时 recorded=null，继续执行一律拒绝。
        // 未知 version 在这里显式 version_unsupported，不改写历史正文。
        const recordedConstraints = turnRecord.payload.recoveryConstraints === undefined
            ? null
            : parseEffectiveRecoveryConstraints(turnRecord.payload.recoveryConstraints);
        const verifyConstraints = () => requireEffectiveRecoveryConstraints({
            recorded: recordedConstraints,
            supplied: suppliedConstraints,
        });
        const recovery = await new RecoveryCoordinator({
            sessions: store,
            checkpoints: store,
            toolEffectClass: (name) => tools.resolve(name)?.effectClass ?? "process",
        }).recover(input.sessionId, { signal }, {
            config: snapshot,
            workspace: currentWorkspace,
            // Coordinator 保证在 paused 恢复与任何对账写入之前先调用这里。
            assertEffectiveConstraints: verifyConstraints,
        }, target);
        // 恢复追加的对账事实（process_interrupted / tool.outcome_unknown / run.failed / run.completed）
        // 必须与 Session 落盘一致地投递给 observer/Web Projection，用户时间线才能看到
        // 副作用未知、取消或放弃的工具事实；best_effort 失败只记诊断，不影响恢复结果。
        for (const event of recovery.reconciledEvents) {
            for (const observer of input.observerEventSinks ?? []) {
                await observer.publish(event, { signal }).catch((error) => {
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
        // 继续执行：核对已在 recover 内、任何对账写入之前完成；这里取同一结果作为实际约束，
        // 已用计数与旧 deadline 由 RunState/limits 继续生效，不清零。
        const effectiveConstraints = verifyConstraints();
        const skillProvider = await (await FileSkillLoader.create(path.resolve(input.config.skills.resourceRoot))).load(signal);
        const skills = await skillProvider.select({ schemaVersion: 1, requestedIds: input.config.skills.enabledIds }, { signal });
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
        const memories = await memory.recall({
            schemaVersion: 1,
            query: turnRecord.payload.run.turn.userMessage.content,
            workspaceIdentity: workspace.identity,
            limit: 20,
        }, { signal });
        const capabilities = new Set([
            "workspace_read",
            "workspace_write",
            ...(processProfile.available
                ? ["isolated_process", "network_isolated"]
                : []),
        ]);
        const dispatcher = new ToolDispatcher({
            registry: tools,
            permissionPolicy: policy,
            approval: new ApprovalCoordinator(input.approvalRequester ??
                new StaticApprovalRequester({ decision: "deny", reason: "interaction_unavailable" })),
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
        // 恢复续跑同样接入 checkpoint sink，使工具边界派生快照覆盖整个生命周期；
        // checkpoint 继续携带同一 contextBasis，重启后仍从原边界重建而不是「最新历史」。
        const checkpointSink = new CheckpointingEventSink(recovery.state, store, sessionSink, snapshot, currentWorkspace, "99-checkpoint-store", contextBasis ?? undefined, 
        // 新 checkpoint 继续携带 turn.started 的原有效约束，重启后仍以原记录为证据。
        recordedConstraints ?? undefined);
        const runner = new RuntimeRunner({
            modelClient,
            toolExecutor: dispatcher,
            eventSinks: [checkpointSink, sessionSink, ...(input.observerEventSinks ?? [])],
            limits: effectiveConstraints.limits,
            toolBatchPolicy: new RegistryToolBatchPolicy(tools),
            maxModelRetries: 0,
            ...(controlHookExecutor ? { hookExecutor: controlHookExecutor } : {}),
            ...(input.toolGroupBarrier ? { toolGroupBarrier: input.toolGroupBarrier } : {}),
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
            ...(historyTranscript.length > 0 ? { historyTranscript } : {}),
        };
        const state = recovery.action === "paused"
            ? await runner.resume(recovery.state, context, { signal })
            : await runner.continueRecovered(recovery.state, context, { signal });
        return {
            sessionId: input.sessionId,
            state,
            action: recovery.action,
            enabledTools,
            provider: provider.id,
        };
    }
    finally {
        await store.close();
    }
}
//# sourceMappingURL=resume-composition.js.map