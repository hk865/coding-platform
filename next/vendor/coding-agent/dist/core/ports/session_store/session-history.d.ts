/**
 * 模块职责：把 Session 记录重建为「已完成轮次」的对话前缀，并校验 contextBasis 边界。
 *
 * 设计边界：本模块只读记录并做纯函数重放/校验；不写存储、不决定新 Turn 的身份、
 * 不把「最后看到的位置」当成完成证据。缺失的工具结果与损坏记录必须显式拒绝。
 * 关键流程：先校验边界位置属于该 Session 且落在已终止轮次的稳定边界上，再逐 Turn
 * 用既有 replaySessionRecords 还原 RunState，拼接 transcript 并复核工具调用配对。
 */
import type { TranscriptEntry } from "../../runtime/state/run-state.js";
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