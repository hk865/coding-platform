/**
 * 模块职责：在模型调用前按 token 预算选择可保留的上下文，并记录被移除的内容。
 *
 * 设计边界：不可移除当前用户消息和未闭合工具调用；本模块不改变内容格式。
 * 关键流程：先估算总量，再依次裁剪记忆、技能引用、附加指令、技能指令和完整对话组。
 */
import type { ContextBuilderInput } from "../builder/context-builder.js";
import type { ModelRequest } from "../../ports/model_client/model-client-port.js";
export type TokenEstimateInput = ContextBuilderInput | ModelRequest;
export interface TokenEstimator {
    estimate(input: Readonly<TokenEstimateInput>): number;
}
export interface RemovedContextItem {
    readonly kind: "memory" | "skill_reference" | "additional_instruction" | "skill_instruction" | "transcript_group";
    readonly id: string;
    readonly source: string;
    readonly reason: "budget";
}
export interface ContextSelectionResult {
    readonly input: ContextBuilderInput;
    readonly estimatedTokens: number;
    readonly removed: readonly RemovedContextItem[];
}
export declare class ContextSelectionError extends Error {
    readonly code: "token_estimation_failed" | "required_content_over_budget";
    constructor(code: "token_estimation_failed" | "required_content_over_budget", message: string);
}
export declare class CharacterTokenEstimator implements TokenEstimator {
    estimate(input: Readonly<TokenEstimateInput>): number;
}
/** 统一校验估算器结果，避免 SelectionPolicy 和 Hook 后复核出现语义分叉。 */
export declare function estimateTokens(input: Readonly<TokenEstimateInput>, estimator: TokenEstimator): number;
export declare function selectContext(input: Readonly<ContextBuilderInput>, estimator: TokenEstimator): ContextSelectionResult;
//# sourceMappingURL=context-selection-policy.d.ts.map