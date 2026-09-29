/**
 * 模块职责：把 Session 记录重建为「已完成轮次」的对话前缀，并校验 contextBasis 边界。
 *
 * 设计边界：本模块只读记录并做纯函数重放/校验；不写存储、不决定新 Turn 的身份、
 * 不把「最后看到的位置」当成完成证据。缺失的工具结果与损坏记录必须显式拒绝。
 * 关键流程：先校验边界位置属于该 Session 且落在已终止轮次的稳定边界上，再逐 Turn
 * 用既有 replaySessionRecords 还原 RunState，拼接 transcript 并复核工具调用配对。
 */
import type { RunState, TranscriptEntry } from "../../runtime/state/run-state.js";
import type { ContextBasis, SessionRecord, SessionStorePort } from "./session-store-port.js";
/** 本读取器实现的会话历史绑定版本；其它版本显式 version_unsupported。 */
export declare const KERNEL_SESSION_HISTORY_VERSION = 1;
export interface SessionHistoryTurnIdentity {
    readonly runId: string;
    readonly turnId: string;
    /** 当前 Turn 的输入 messageId；提供时前缀中不得出现同一输入。 */
    readonly userMessageId?: string;
}
export interface SessionHistoryTurnBoundary extends SessionHistoryTurnIdentity {
    readonly startPosition: number;
    readonly endPosition: number;
}
export interface SessionHistoryRestoreInput {
    readonly sessionId: string;
    /** 开始当前 Turn 前最后已完成轮次的边界（Session 记录 position）。 */
    readonly throughPosition: number;
    /** 派生隔离基线的真实源 Session；缺省表示前缀就是当前 Session 自身。 */
    readonly sourceSessionId?: string;
    /** 当前 Turn 身份：前缀绝不允许包含它，避免把当前输入重复喂给模型。 */
    readonly currentTurn?: SessionHistoryTurnIdentity;
}
export interface SessionHistoryRestore {
    readonly contextBasis: ContextBasis;
    readonly sessionId: string;
    readonly throughPosition: number;
    readonly transcript: readonly TranscriptEntry[];
    readonly turns: readonly SessionHistoryTurnBoundary[];
}
/**
 * 解释记录中携带的 contextBasis。
 * 形状非法 → invalid_record；本读取器无法解释的版本/模式 → version_unsupported
 * （绝不改写成「补字段」后的记录，也绝不退化成 current_turn）。
 */
export declare function parseContextBasis(value: unknown): ContextBasis;
/** 分页读取一个 Session 的全部记录；组合根共用，避免各自实现一套扫描。 */
export declare function readAllSessionRecords(store: SessionStorePort, sessionId: string, signal: AbortSignal): Promise<readonly SessionRecord[]>;
/**
 * 复核一段 transcript 的工具交换完整性：每个声明的 ToolCall 必须有唯一结果，
 * 每个 ToolResult 必须命中尚未结算的调用。缺失/孤儿结果都视为记录缺口，显式拒绝。
 */
export declare function assertTranscriptExchangeIntegrity(transcript: readonly TranscriptEntry[], label: string): void;
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
export declare function projectTerminalTranscript(state: Readonly<RunState>): TranscriptEntry[];
/** 从真实终止事件推导「最后已完成轮次」的边界；没有已完成轮次时返回 null。 */
export declare function findLastCompletedTurnBoundary(records: readonly SessionRecord[]): number | null;
/**
 * 从 `throughPosition` 指向的已完成轮次边界重建对话前缀。
 *
 * 拒绝条件（全部显式报错，不静默降级）：
 *  - 位置不属于该 Session 或超出记录范围（invalid_record/conflict）；
 *  - 边界不是终止事件、对应轮次仍有未决执行（conflict）；
 *  - 重放失败、轮次重叠、工具调用缺少结果（corrupt）；
 *  - 前缀包含当前 Turn（conflict）。
 */
export declare function restoreSessionHistory(records: readonly SessionRecord[], input: Readonly<SessionHistoryRestoreInput>): SessionHistoryRestore;
//# sourceMappingURL=session-history.d.ts.map