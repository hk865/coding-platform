/**
 * 模块职责：把系统提示、指令、技能、记忆、对话记录和工具定义组装成确定性的模型请求。
 *
 * 设计边界：这里只校验并格式化已选中的上下文，不负责预算裁剪，也不调用模型。
 * 关键流程：校验输入与唯一性，按稳定顺序拼接系统提示，转换对话记录，最后通过请求 schema。
 */
import type { ContextFragment, MemoryItem, SkillContext } from "../types/context-types.js";
import type { ModelRequest, ModelToolSpec } from "../../ports/model_client/model-client-port.js";
import type { TranscriptEntry } from "../../runtime/state/run-state.js";
export interface ContextBuilderInput {
    readonly requestId: string;
    readonly runId: string;
    readonly baseSystemPrompt: string;
    readonly additionalInstructions: readonly ContextFragment[];
    readonly transcript: readonly TranscriptEntry[];
    readonly tools: readonly ModelToolSpec[];
    readonly skills: readonly SkillContext[];
    readonly memories: readonly MemoryItem[];
    /** 模型最大上下文窗口；真正的超窗裁剪由 M2 SelectionPolicy 负责。 */
    readonly tokenBudget: number;
    readonly maxOutputTokens: number | null;
}
export interface ContextBuilderPort {
    build(input: Readonly<ContextBuilderInput>): ModelRequest;
}
export type ContextBuildErrorCode = "invalid_input" | "duplicate_id" | "duplicate_tool" | "invalid_transcript";
export declare class ContextBuildError extends Error {
    readonly code: ContextBuildErrorCode;
    constructor(code: ContextBuildErrorCode, message: string);
}
export declare function buildModelRequest(input: Readonly<ContextBuilderInput>): ModelRequest;
export declare class DeterministicContextBuilder implements ContextBuilderPort {
    build(input: Readonly<ContextBuilderInput>): ModelRequest;
}
//# sourceMappingURL=context-builder.d.ts.map