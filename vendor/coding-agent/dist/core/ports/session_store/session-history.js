import { isTerminalRunStatus } from "../../runtime/state/run-state.js";
import { contextBasisSchema, StoreError } from "./session-store-port.js";
import { replaySessionRecords } from "./session-projection.js";
/** 本读取器实现的会话历史绑定版本；其它版本显式 version_unsupported。 */
export const KERNEL_SESSION_HISTORY_VERSION = 1;
const SESSION_HISTORY_MODE = "session_history";
/** 只有这些 Run 事件构成「已完成轮次」的稳定边界。 */
const TERMINAL_EVENT_TYPES = new Set([
    "run.completed",
    "run.cancelled",
    "run.limit_exceeded",
    "run.failed",
    "run.yielded",
]);
/**
 * 解释记录中携带的 contextBasis。
 * 形状非法 → invalid_record；本读取器无法解释的版本/模式 → version_unsupported
 * （绝不改写成「补字段」后的记录，也绝不退化成 current_turn）。
 */
export function parseContextBasis(value) {
    const parsed = contextBasisSchema.safeParse(value);
    if (!parsed.success) {
        throw new StoreError("invalid_record", `contextBasis 形状非法：${parsed.error.issues[0]?.message ?? "unknown"}`);
    }
    const basis = parsed.data;
    if (basis.version !== KERNEL_SESSION_HISTORY_VERSION || basis.mode !== SESSION_HISTORY_MODE) {
        throw new StoreError("version_unsupported", `contextBasis version=${String(basis.version)} mode=${JSON.stringify(basis.mode)} 不受支持`);
    }
    return {
        version: KERNEL_SESSION_HISTORY_VERSION,
        mode: SESSION_HISTORY_MODE,
        throughPosition: basis.throughPosition,
        // A derived isolated basis must keep its real source Session through every
        // parse/compare/checkpoint/resume replay; dropping it silently restores the
        // wrong history.
        ...(basis.sourceSessionId === undefined ? {} : { sourceSessionId: basis.sourceSessionId }),
    };
}
/** 分页读取一个 Session 的全部记录；组合根共用，避免各自实现一套扫描。 */
export async function readAllSessionRecords(store, sessionId, signal) {
    const records = [];
    let position = 0;
    while (true) {
        const page = await store.read(sessionId, position, 256, { signal });
        records.push(...page.records);
        position = page.records.at(-1)?.position ?? position;
        if (page.nextPosition === null)
            return records;
    }
}
/**
 * 复核一段 transcript 的工具交换完整性：每个声明的 ToolCall 必须有唯一结果，
 * 每个 ToolResult 必须命中尚未结算的调用。缺失/孤儿结果都视为记录缺口，显式拒绝。
 */
export function assertTranscriptExchangeIntegrity(transcript, label) {
    const open = new Map();
    const settled = new Set();
    const fail = (message) => {
        throw new StoreError("corrupt", `${label}：${message}`);
    };
    for (const [index, entry] of transcript.entries()) {
        if (entry.kind === "user_message") {
            if (open.size > 0) {
                fail(`transcript[${index}] 的 user message 出现在未闭合工具调用之前`);
            }
            continue;
        }
        if (entry.kind === "assistant_message") {
            if (open.size > 0) {
                fail(`transcript[${index}] 的 assistant message 前仍有未结算工具调用`);
            }
            for (const call of entry.toolCalls) {
                if (open.has(call.callId) || settled.has(call.callId)) {
                    fail(`重复 ToolCall ${call.callId}`);
                }
                open.set(call.callId, entry.message.messageId);
            }
            continue;
        }
        if (settled.has(entry.callId))
            fail(`ToolResult ${entry.callId} 重复结算`);
        if (!open.has(entry.callId)) {
            fail(`ToolResult ${entry.callId} 没有唯一且未结算的 ToolCall`);
        }
        open.delete(entry.callId);
        settled.add(entry.callId);
    }
    if (open.size > 0) {
        const missing = [...open.keys()].sort().join(",");
        fail(`缺少工具结果（callId=${missing}）`);
    }
}
/**
 * R4.3b：把一个真实已终止 Turn 的原始 transcript 投影为「可供后继模型消费」的纯副本。
 *
 * 只读借用状态，不写回原对象。投影只省略由原 `run-state-reducer` 判为 abandoned、
 * 且确实没有结果的工具调用声明；实际已结算的结果与对应声明保留。若某个 assistant entry
 * 仅因移除这些声明而变成正文/推理/工具声明全空，则连该空壳一并省略，沿用原 assistant
 * entry schema 判据（content.length > 0 || toolCalls.length > 0 || reasoningContent.length > 0），
 * 不做 trim 或语义猜测。原 SessionRecord、归约 RunState、原文/原始推理/工具声明和结果
 * 全部保留，不伪造任何 ToolResult。
 *
 * 可消费性判据（任一不满足即 conflict，绝不静默放行）：
 *  - 必须是真实 terminal RunState，且没有进行中的模型请求；
 *  - toolBatch 中不得有 pending/running/outcome_unknown；
 *  - transcript 中不得有正式 outcome_unknown 工具结果；原 reducer 在拿不到结果时可能
 *    已把 running 标为 outcome_unknown 并清空 batch，因此不能以 batch 为空证明结果已知。
 * 缺失结果且没有 abandoned 事实的调用不在这里放宽，仍由原
 * `assertTranscriptExchangeIntegrity` 在消费端显式拒绝。
 */
export function projectTerminalTranscript(state) {
    if (!isTerminalRunStatus(state.status)) {
        throw new StoreError("conflict", `projectTerminalTranscript：Turn 尚未终止（status=${state.status}）`);
    }
    if (state.activeModelRequest !== null) {
        throw new StoreError("conflict", `projectTerminalTranscript：Turn 仍有进行中的模型请求（requestId=${state.activeModelRequest.requestId}）`);
    }
    const unsettled = state.toolBatch?.calls.find((call) => call.status === "pending" ||
        call.status === "running" ||
        call.status === "outcome_unknown");
    if (unsettled !== undefined) {
        throw new StoreError("conflict", `projectTerminalTranscript：工具调用 ${unsettled.requestedCall.callId} 状态为 ${unsettled.status}，不是已知结果`);
    }
    const hasUnknownResult = state.transcript.some((entry) => entry.kind === "tool_result" &&
        entry.result.status === "error" &&
        entry.result.error.code === "outcome_unknown");
    if (hasUnknownResult) {
        throw new StoreError("conflict", `projectTerminalTranscript：transcript 含正式 outcome_unknown 工具结果`);
    }
    const abandonedCallIds = new Set((state.toolBatch?.calls ?? [])
        .filter((call) => call.status === "abandoned" && call.result === null)
        .map((call) => call.requestedCall.callId));
    if (abandonedCallIds.size === 0)
        return [...state.transcript];
    const projected = [];
    for (const entry of state.transcript) {
        if (entry.kind !== "assistant_message") {
            projected.push(entry);
            continue;
        }
        const toolCalls = entry.toolCalls.filter((call) => !abandonedCallIds.has(call.callId));
        if (toolCalls.length === entry.toolCalls.length) {
            projected.push(entry);
            continue;
        }
        const hasContent = entry.message.content.length > 0;
        const hasReasoning = (entry.message.reasoningContent?.length ?? 0) > 0;
        if (toolCalls.length === 0 && !hasContent && !hasReasoning)
            continue;
        projected.push({ ...entry, toolCalls });
    }
    return projected;
}
/** 从真实终止事件推导「最后已完成轮次」的边界；没有已完成轮次时返回 null。 */
export function findLastCompletedTurnBoundary(records) {
    let boundary = null;
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record.recordType !== "turn.started")
            continue;
        const end = nextTurnStart(records, index) ?? records.length;
        const slice = records.slice(index, end);
        let state;
        try {
            state = replaySessionRecords(slice);
        }
        catch {
            continue;
        }
        if (state && isTerminalRunStatus(state.status)) {
            const last = slice.at(-1);
            if (last.recordType !== "agent.event" || !TERMINAL_EVENT_TYPES.has(last.payload.event.type)) {
                continue;
            }
            boundary = last.position;
        }
    }
    return boundary;
}
function nextTurnStart(records, from) {
    for (let index = from + 1; index < records.length; index += 1) {
        if (records[index].recordType === "turn.started")
            return index;
    }
    return null;
}
/**
 * 从 `throughPosition` 指向的已完成轮次边界重建对话前缀。
 *
 * 拒绝条件（全部显式报错，不静默降级）：
 *  - 位置不属于该 Session 或超出记录范围（invalid_record/conflict）；
 *  - 边界不是终止事件、对应轮次仍有未决执行（conflict）；
 *  - 重放失败、轮次重叠、工具调用缺少结果（corrupt）；
 *  - 前缀包含当前 Turn（conflict）。
 */
export function restoreSessionHistory(records, input) {
    const { sessionId, throughPosition, sourceSessionId } = input;
    const lastPosition = records.at(-1)?.position ?? 0;
    if (!Number.isSafeInteger(throughPosition) || throughPosition < 1) {
        throw new StoreError("invalid_record", `throughPosition 必须是正的安全整数`);
    }
    if (throughPosition > lastPosition) {
        throw new StoreError("invalid_record", `throughPosition ${String(throughPosition)} 超出 Session ${sessionId} 的记录范围 1..${String(lastPosition)}`);
    }
    const prefix = records.filter((record) => record.position <= throughPosition);
    if (prefix.length !== throughPosition) {
        throw new StoreError("corrupt", `Session ${sessionId} 前缀记录不连续`);
    }
    for (const record of prefix) {
        if (record.sessionId !== sessionId) {
            throw new StoreError("conflict", `记录 ${String(record.position)} 不属于 Session ${sessionId}`);
        }
    }
    const boundary = prefix.at(-1);
    if (boundary.recordType !== "agent.event" ||
        !TERMINAL_EVENT_TYPES.has(boundary.payload.event.type)) {
        throw new StoreError("conflict", `throughPosition ${String(throughPosition)} 不是已完成轮次的稳定边界（记录类型 ${boundary.recordType}）`);
    }
    const turns = [];
    const transcript = [];
    for (let index = 0; index < prefix.length; index += 1) {
        const record = prefix[index];
        if (record.recordType !== "turn.started")
            continue;
        const end = Math.min(nextTurnStart(prefix, index) ?? prefix.length, prefix.length);
        const slice = prefix.slice(index, end);
        let state;
        try {
            state = replaySessionRecords(slice);
        }
        catch (error) {
            throw new StoreError("corrupt", `Turn ${record.payload.run.turn.turnId} 无法重放：${error instanceof Error ? error.message : "unknown"}`);
        }
        if (!state || !isTerminalRunStatus(state.status)) {
            throw new StoreError("conflict", `边界处的 Turn ${record.payload.run.turn.turnId} 尚未终止（status=${state?.status ?? "unknown"}）`);
        }
        if (state.activeModelRequest !== null ||
            (state.toolBatch?.calls.some((call) => call.status === "pending" || call.status === "running") ??
                false)) {
            throw new StoreError("conflict", `边界处的 Turn ${record.payload.run.turn.turnId} 仍有未决执行`);
        }
        // R4.3b：每个真实终止 Turn 都消费同一纯投影。投影移除 reducer 判定的 abandoned
        // 声明，并统一拒绝 active request、未决工具与正式 outcome_unknown；没有 abandoned
        // 的已知终态也走同一判据，避免绕过 projector 的真实 unknown 检查。
        const turnTranscript = projectTerminalTranscript(state);
        assertTranscriptExchangeIntegrity(turnTranscript, `Turn ${record.payload.run.turn.turnId} transcript`);
        turns.push({
            runId: state.runId,
            turnId: state.turn.turnId,
            startPosition: record.position,
            endPosition: slice.at(-1).position,
        });
        transcript.push(...turnTranscript);
    }
    if (turns.length === 0) {
        throw new StoreError("not_found", `throughPosition ${String(throughPosition)} 之前没有已完成轮次`);
    }
    const currentTurn = input.currentTurn;
    if (currentTurn) {
        const overlap = turns.find((turn) => turn.runId === currentTurn.runId || turn.turnId === currentTurn.turnId);
        if (overlap) {
            throw new StoreError("conflict", `历史前缀包含当前 Turn（runId=${overlap.runId} turnId=${overlap.turnId}）`);
        }
        if (transcript.some((entry) => entry.kind === "user_message" && entry.message.messageId === currentTurn.userMessageId)) {
            throw new StoreError("conflict", "历史前缀包含当前 Turn 的输入");
        }
    }
    assertTranscriptExchangeIntegrity(transcript, "Session 历史前缀");
    return {
        contextBasis: {
            version: KERNEL_SESSION_HISTORY_VERSION,
            mode: SESSION_HISTORY_MODE,
            throughPosition,
            ...(sourceSessionId === undefined ? {} : { sourceSessionId }),
        },
        sessionId,
        throughPosition,
        transcript,
        turns,
    };
}
//# sourceMappingURL=session-history.js.map