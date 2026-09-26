/**
 * 模块职责：从 Session 事件日志和可选 checkpoint 恢复 Run，并消解进程中断窗口。
 *
 * 设计边界：Session 记录是事实来源；checkpoint 只能加速，不能覆盖较新的已提交事件。
 * 关键流程：选择并验签 checkpoint，重放后续事件，核对环境，再生成必要的对账事件和恢复动作。
 */
import { randomUUID } from "node:crypto";
import { assertCheckpointChecksum } from "../../ports/checkpoint_store/checkpoint-store-port.js";
import { canonicalJson, parseEffectiveRecoveryConstraints, StoreError, } from "../../ports/session_store/session-store-port.js";
import { reduceRunState } from "../reducer/run-state-reducer.js";
import { outcomeUnknownPayload } from "../tool-outcome-unknown.js";
import { createInitialRunState, deriveRunPhase, isTerminalRunStatus, validateRunStateInvariants, } from "../state/run-state.js";
/**
 * R4a 唯一的 Turn 选择算法（Core 命名导出纯函数；app 的 `selectRecoveryTurn` 薄委托）。
 *
 * 返回目标 Turn 的**独占**记录范围：从它的 `turn.started` 起，止于下一条 `turn.started`，
 * 绝不把后续 Turn 的事件或 checkpoint 归入目标状态。`target=null` 保持旧 CLI 的
 * 「最新 Turn」语义；精确目标必须同时匹配 runId 与 turnId，不按最新 Turn 代替。
 */
export function selectRecoveryTurnRecords(records, target) {
    const start = target === null
        ? records.findLastIndex((record) => record.recordType === "turn.started")
        : records.findIndex((record) => record.recordType === "turn.started" &&
            record.payload.run.runId === target.runId &&
            record.payload.run.turn.turnId === target.turnId);
    if (start < 0) {
        throw new StoreError("not_found", target === null
            ? "Session 尚无可恢复 Turn"
            : `Session 中不存在 runId=${target.runId}/turnId=${target.turnId} 的 Turn`);
    }
    const next = records.findIndex((record, index) => index > start && record.recordType === "turn.started");
    return next < 0 ? records.slice(start) : records.slice(start, next);
}
/**
 * 以 append-only Session 事实为真相恢复状态；checkpoint 只用于加速。
 * 恢复器先消解进程中断窗口，再把稳定状态交给 RuntimeRunner 继续。
 */
export class RecoveryCoordinator {
    #sessions;
    #checkpoints;
    #idFactory;
    #now;
    #toolEffectClass;
    #reconciliationCount = 0;
    constructor(dependencies) {
        this.#sessions = dependencies.sessions;
        this.#checkpoints = dependencies.checkpoints;
        this.#idFactory = dependencies.idFactory ?? randomUUID;
        this.#now = dependencies.now ?? (() => new Date());
        this.#toolEffectClass = dependencies.toolEffectClass ?? (() => "process");
    }
    async recover(sessionId, options, environment, target) {
        const header = await this.#sessions.get(sessionId, options);
        // 精确目标只投影它自己的 Turn 范围：后续 Turn 的事件、checkpoint 与返回值都不读入。
        const records = selectRecoveryTurnRecords(await this.#readAll(sessionId, options), target ?? null);
        const turnRecord = records[0];
        if (!turnRecord || turnRecord.recordType !== "turn.started")
            throw new StoreError("corrupt", "Turn record 非法");
        const runId = turnRecord.payload.run.runId;
        const runRecords = records;
        const { checkpoint, state: checkpointState } = await this.#selectCheckpoint(turnRecord, runRecords, options);
        let state = checkpointState ?? createInitialRunState(turnRecord.payload.run);
        const cursor = checkpoint?.recordPosition ?? turnRecord.position;
        // 重放范围内已提交的 tool.started 事件 eventId，供 outcome_unknown 审计追踪。
        // running tool 不可能来自 checkpoint（checkpoint 只在稳定边界保存），因此必然在重放中可见。
        const toolStartedEventIds = new Map();
        for (const record of runRecords) {
            if (record.position <= cursor || record.recordType !== "agent.event")
                continue;
            if (record.payload.event.meta.runId !== runId)
                break;
            if (record.payload.event.type === "tool.started") {
                toolStartedEventIds.set(record.payload.event.payload.call.callId, record.payload.event.meta.eventId);
            }
            state = reduceRunState(state, record.payload.event);
        }
        let revision = header.revision;
        let lastPosition = records.at(-1)?.position ?? 0;
        const reconciledEvents = [];
        let action;
        const runningTool = state.toolBatch?.calls.some((call) => call.status === "running") ?? false;
        const recoveredPhase = deriveRunPhase(state);
        const willContinue = !isTerminalRunStatus(state.status) &&
            state.status !== "paused" &&
            !runningTool &&
            recoveredPhase !== "ready_to_complete";
        // paused 也会实际进入 runner.resume：只要调用方提供了 environment（生产恢复组合根总是提供），
        // 就必须与继续执行一样在任何对账写入与任何继续动作之前核对原 config 与 workspace
        // （identity/reference/revision 全部相等），不存在为旧用例放宽的 revision 例外。
        // 未提供 environment 的既有直接调用只做投影、不执行 runner，保持既有检查用法。
        if (willContinue || (state.status === "paused" && environment !== undefined)) {
            this.#assertCompatibleEnvironment(turnRecord.payload.config, this.#workspaceAtState(checkpoint?.workspace ?? turnRecord.payload.workspace, state), environment);
        }
        // 原有效约束核对：paused 同样覆盖；terminal / 仅终止化的对账（ready_to_complete、
        // running tool 的 outcome_unknown）不需要新字段证据。
        if (willContinue || state.status === "paused") {
            environment?.assertEffectiveConstraints?.();
        }
        if (isTerminalRunStatus(state.status))
            action = "terminal";
        else if (state.status === "paused")
            action = "paused";
        else if (state.activeModelRequest) {
            const interrupted = this.#event(state, "model.request_failed", {
                requestId: state.activeModelRequest.requestId,
                failure: {
                    category: "model",
                    code: "process_interrupted",
                    message: "模型请求因进程中断，允许以新 requestId 重试",
                    retryable: true,
                    operationId: state.activeModelRequest.requestId,
                },
            });
            reconciledEvents.push(interrupted);
            ({ state, revision, lastPosition } = await this.#appendReconciliation(sessionId, revision, state, interrupted, options));
            action = "continue_before_model";
        }
        else if (state.toolBatch?.calls.some((call) => call.status === "running")) {
            // 先为每个已开始但无结果的调用追加结构化 tool.outcome_unknown（含模型可见合成结果），
            // 再终止原 Run；有副作用工具绝不自动重放。
            const running = state.toolBatch.calls.filter((call) => call.status === "running");
            for (const call of running) {
                // running 调用必然有已提交的 tool.started（执行前屏障）；缺失说明日志损坏。
                const recordedCallEventId = toolStartedEventIds.get(call.requestedCall.callId);
                if (!recordedCallEventId) {
                    throw new StoreError("corrupt", `running 调用 ${call.requestedCall.callId} 缺少 tool.started 事件`);
                }
                const unknownEvent = this.#event(state, "tool.outcome_unknown", {
                    ...outcomeUnknownPayload(call.requestedCall, "process_interrupted", this.#toolEffectClass(call.requestedCall.name), recordedCallEventId),
                });
                reconciledEvents.push(unknownEvent);
                // 循环内只推进 state/revision；lastPosition 在最终 run.failed 对账时统一读取。
                ({ state, revision } = await this.#appendReconciliation(sessionId, revision, state, unknownEvent, options));
            }
            const failedEvent = this.#event(state, "run.failed", {
                failure: {
                    category: "tool_executor",
                    code: "side_effect_result_unknown",
                    message: `工具结果未知（已记录 tool.outcome_unknown）；原 Run 不会自动重放`,
                    retryable: false,
                    operationId: running[0].requestedCall.callId,
                },
            });
            reconciledEvents.push(failedEvent);
            ({ state, revision, lastPosition } = await this.#appendReconciliation(sessionId, revision, state, failedEvent, options));
            action = "side_effect_result_unknown";
        }
        else {
            const phase = deriveRunPhase(state);
            if (phase === "ready_to_complete") {
                const last = state.transcript.at(-1);
                if (last?.kind !== "assistant_message")
                    throw new StoreError("corrupt", "最终消息缺失");
                const completed = this.#event(state, "run.completed", {
                    finalMessageId: last.message.messageId,
                });
                reconciledEvents.push(completed);
                ({ state, revision, lastPosition } = await this.#appendReconciliation(sessionId, revision, state, completed, options));
                action = "terminal";
            }
            else if (phase === "before_tools")
                action = "continue_before_tools";
            else if (phase === "created")
                action = "start_run";
            else
                action = "continue_before_model";
        }
        return {
            sessionId,
            revision,
            lastPosition,
            state,
            action,
            checkpointId: checkpoint?.checkpointId ?? null,
            reconciledEvent: reconciledEvents[0] ?? null,
            reconciledEvents,
        };
    }
    async #readAll(sessionId, options) {
        const records = [];
        let position = 0;
        while (true) {
            const page = await this.#sessions.read(sessionId, position, 256, options);
            records.push(...page.records);
            position = page.records.at(-1)?.position ?? position;
            if (page.nextPosition === null)
                return records;
        }
    }
    async #selectCheckpoint(turnRecord, records, options) {
        if (!this.#checkpoints)
            return { checkpoint: null, state: null };
        const candidates = this.#checkpoints.listCheckpointCandidates
            ? await this.#checkpoints.listCheckpointCandidates(turnRecord.payload.run.runId, options)
            : (await this.#checkpoints.listCheckpoints(turnRecord.payload.run.runId, options)).map((checkpoint) => ({ checkpointId: checkpoint.checkpointId, checkpoint }));
        const invalid = [];
        for (const candidate of candidates) {
            const checkpoint = candidate.checkpoint;
            if (!checkpoint) {
                invalid.push(candidate.checkpointId);
                continue;
            }
            try {
                assertCheckpointChecksum(checkpoint);
                if (checkpoint.sessionId !== turnRecord.sessionId ||
                    checkpoint.turnId !== turnRecord.payload.run.turn.turnId ||
                    checkpoint.recordPosition < turnRecord.position ||
                    canonicalJson(checkpoint.config) !== canonicalJson(turnRecord.payload.config) ||
                    checkpoint.workspace.identity !== turnRecord.payload.workspace.identity ||
                    checkpoint.workspace.reference !== turnRecord.payload.workspace.reference) {
                    throw new Error("checkpoint identity mismatch");
                }
                // Turn 记录是原约束的唯一权威证据：新 checkpoint 带 recoveryConstraints 时，
                // 用同一 parser 解析并逐值核对；不一致或未知 version 按坏 checkpoint 跳过，
                // 继续尝试更早候选或从正式事件回放。旧 checkpoint 缺该字段保持兼容，不要求补写。
                const checkpointConstraints = checkpoint.recoveryConstraints;
                if (checkpointConstraints !== undefined) {
                    const recordedConstraints = turnRecord.payload.recoveryConstraints;
                    if (recordedConstraints === undefined) {
                        throw new Error("checkpoint 携带 recoveryConstraints 但 Turn 没有原约束证据");
                    }
                    if (canonicalJson(parseEffectiveRecoveryConstraints(checkpointConstraints)) !==
                        canonicalJson(parseEffectiveRecoveryConstraints(recordedConstraints))) {
                        throw new Error("checkpoint recoveryConstraints 与 Turn 原约束不一致");
                    }
                }
                const cursorRecord = records.find((record) => record.position === checkpoint.recordPosition);
                if (checkpoint.lastEventSequence > 0 &&
                    (cursorRecord?.recordType !== "agent.event" ||
                        cursorRecord.payload.event.meta.eventId !== checkpoint.lastEventId)) {
                    throw new Error("checkpoint cursor mismatch");
                }
                const invariant = validateRunStateInvariants(checkpoint.state);
                if (!invariant.ok)
                    throw new Error(invariant.message);
                if (invalid.length > 0) {
                    await this.#checkpoints.deleteInvalid(invalid, options).catch(() => 0);
                }
                return { checkpoint, state: structuredClone(checkpoint.state) };
            }
            catch {
                invalid.push(checkpoint.checkpointId);
            }
        }
        if (invalid.length > 0)
            await this.#checkpoints.deleteInvalid(invalid, options).catch(() => 0);
        return { checkpoint: null, state: null };
    }
    #workspaceAtState(base, state) {
        let revision = base.revision;
        for (const entry of state.transcript) {
            if (entry.kind === "tool_result" && entry.result.effects.workspaceRevision) {
                revision = entry.result.effects.workspaceRevision;
            }
        }
        return revision === base.revision ? base : { ...base, revision };
    }
    #assertCompatibleEnvironment(recordedConfig, recordedWorkspace, environment) {
        if (!environment) {
            throw new StoreError("conflict", "继续恢复需要提供当前 workspace 与运行配置");
        }
        if (canonicalJson(environment.config) !== canonicalJson(recordedConfig)) {
            throw new StoreError("conflict", "当前运行配置与 Session 记录不兼容");
        }
        if (environment.workspace.identity !== recordedWorkspace.identity ||
            environment.workspace.revision !== recordedWorkspace.revision ||
            environment.workspace.reference !== recordedWorkspace.reference) {
            throw new StoreError("conflict", "当前 workspace 与 Session 记录不兼容");
        }
    }
    #event(state, type, payload) {
        // 同一次 recover 可能追加多个对账事件，eventId 必须唯一（eventId 不能与最后事件重复）。
        this.#reconciliationCount += 1;
        return {
            type,
            meta: {
                schemaVersion: 1,
                eventId: `recovery:${this.#idFactory()}#${this.#reconciliationCount}`,
                runId: state.runId,
                turnId: state.turn.turnId,
                sequence: state.lastEventSequence + 1,
                occurredAt: this.#now().toISOString(),
                elapsedMs: state.elapsedMs,
            },
            payload,
        };
    }
    async #appendReconciliation(sessionId, revision, state, event, options) {
        const next = reduceRunState(state, event);
        const result = await this.#sessions.append(sessionId, revision, [
            {
                recordId: `agent-event:${event.meta.eventId}`,
                recordType: "agent.event",
                schemaVersion: 1,
                recordedAt: event.meta.occurredAt,
                payload: { event },
            },
        ], options);
        return { state: next, revision: result.revision, lastPosition: result.positions[0] };
    }
}
//# sourceMappingURL=recovery-coordinator.js.map