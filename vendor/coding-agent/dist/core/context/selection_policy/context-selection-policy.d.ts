/**
 * 模块职责：在模型调用前按预算选择可保留的上下文，返回被选中的输入、真正发送的请求和选择报告。
 *
 * 设计边界：删除单位按固定顺序排列；base 提示词、instruction Skill、本次任务输入、最新 user
 * 消息和未闭合调用永不删除。本模块只复制出站副本，不改 RunState、已存事件或历史读取。
 * 关键流程：历史/当前分界 → 思考过滤 → 固定删除单位序列 → 前缀预览 → 报告。
 */
import type { ContextBuilderInput } from "../builder/context-builder.js";
import type { ModelRequest } from "../../ports/model_client/model-client-port.js";
export type TokenEstimateInput = ContextBuilderInput | ModelRequest;
export interface TokenEstimator {
    estimate(input: Readonly<TokenEstimateInput>): number;
}
export type ReasoningReplay = "current_run" | "none";
export type BaseSystemPromptInput = {
    templateId: string;
    version: number;
    text: string;
};
export type ContextPreviewResult = {
    outgoing: ModelRequest;
    inputTokens: number;
    outputReserve: number;
    fits: boolean;
};
export type ContextPreview = (request: ModelRequest) => Promise<ContextPreviewResult>;
export type ContextSelectionRemoved = {
    memory: number;
    skillReference: number;
    additionalInstruction: number;
    toolResultBody: number;
    historyExchange: number;
    historyConclusion: number;
    currentExchange: number;
};
export type ContextSelectionReport = {
    requestId: string;
    inputTokens: number;
    budget: number;
    removed: ContextSelectionRemoved;
};
export type ContextSelectionOptions = {
    /** input.transcript 的前 n 条是历史，其余属于当前执行。 */
    historyEntryCount: number;
    taskInputMessageId: string | null;
    build: (input: ContextBuilderInput) => ModelRequest;
    previewRequest: ContextPreview;
    /** 缺席时不做出站思考过滤。 */
    reasoningReplay?: ReasoningReplay;
};
export declare class ContextSelectionError extends Error {
    readonly code: "token_estimation_failed" | "required_content_over_budget";
    constructor(code: "token_estimation_failed" | "required_content_over_budget", message: string);
}
export declare class CharacterTokenEstimator implements TokenEstimator {
    estimate(input: Readonly<TokenEstimateInput>): number;
}
/** 统一校验估算器结果，避免 SelectionPolicy 和 Hook 后复核出现语义分叉。 */
export declare function estimateTokens(input: Readonly<TokenEstimateInput>, estimator: TokenEstimator): number;
/**
 * 先 k=0；再 k=N；否则在 (0, N] 二分最小的可行前缀。
 * 只使用自身预览返回 fits 的前缀；返回的是该次预览的 outgoing 请求。
 */
export declare function selectContext(input: Readonly<ContextBuilderInput>, options: ContextSelectionOptions): Promise<{
    selected: ContextBuilderInput;
    request: ModelRequest;
    report: ContextSelectionReport;
}>;
//# sourceMappingURL=context-selection-policy.d.ts.map