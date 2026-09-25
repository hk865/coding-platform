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
    const { sessionId, throughPosition } = input;
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
        assertTranscriptExchangeIntegrity(state.transcript, `Turn ${record.payload.run.turn.turnId} transcript`);
        turns.push({
            runId: state.runId,
            turnId: state.turn.turnId,
            startPosition: record.position,
            endPosition: slice.at(-1).position,
        });
        transcript.push(...state.transcript);
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
        },
        sessionId,
        throughPosition,
        transcript,
        turns,
    };
}
//# sourceMappingURL=session-history.js.map