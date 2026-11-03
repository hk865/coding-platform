/**
 * 模块职责：保存 run/resume 两个组合入口共享的宿主契约与会话公共扩展类型。
 *
 * 设计边界：这里只有类型/常量，不做装配。独立成文件是为了避免
 * composition-root 与 resume-composition 互相 import 形成循环依赖
 * （architecture check 会把类型导入也算作一条边）。
 */
import type { SkillContext } from "../../core/context/types/context-types.js";
import type { BaseSystemPromptInput, ContextPreview, ContextSelectionReport, ReasoningReplay } from "../../core/context/selection_policy/context-selection-policy.js";
import type { ModelToolSpec } from "../../core/ports/model_client/model-client-port.js";
export interface SecretSource {
    get(name: string): string | undefined;
}
export interface AppRuntimeConfiguration {
    readonly systemPromptVersion: string;
    readonly systemPrompt: string;
    readonly provider: string;
    readonly model: string;
    readonly thinking: unknown;
    readonly reasoningEffort: unknown;
    readonly tools: readonly ModelToolSpec[];
    readonly skills: readonly SkillContext[];
    readonly skillResourceRoot: string;
    readonly contextWindowTokens: number;
    readonly maxOutputTokens: number | null;
    readonly maxModelRequests: number;
    readonly maxToolCalls: number;
    readonly workspaceConsistency: {
        readonly mode: "session" | "workspace" | "strict";
        readonly revisionStrategy: "git_status_v1" | "sparse_metadata_v1";
        readonly ignoredPrefixes: readonly string[];
    };
}
/**
 * Kernel 会话公共扩展的契约版本；3 增加 `run.interrupted` 终态与关闭悬空 Turn 的公开收尾；
 * 4 增加 `context.compacted` 压缩记录、`appendCompactionRecord` 和按最新压缩记录恢复的视图。
 */
export declare const kernelSessionApiVersion: 4;
/**
 * 会话上下文模式：
 *  - `current_turn`（缺省）：只把当前 Turn 交给模型，旧 CLI 语义不变；
 *  - `session_history`：`throughPosition` 是开始当前 Turn 前最后已完成轮次的稳定边界，
 *    由 Kernel 校验并逐 Turn 重建前缀后与当前 Turn 合并做一次预算选择。
 */
export type SessionContextMode = {
    version: 1;
    mode: "current_turn";
} | {
    version: 1;
    mode: "session_history";
    throughPosition: number;
    /**
     * 派生隔离基线：前缀从该源 Session 的 throughPosition 边界重建，而新 Turn 仍写入
     * 目标 sessionId。缺省表示前缀就是目标 Session 自身（普通连续会话）。
     */
    sourceSessionId?: string;
    /**
     * 选压缩记录的位置：用它及以前最新的一条 `compacted` 记录拼视图；缺省等于
     * throughPosition。截前缀仍按 throughPosition。
     */
    viewPosition?: number;
};
/**
 * Host-supplied applicable inputs read at a real Kernel safe point. It only
 * reports candidate identities/texts; acceptance is the Kernel event commit.
 */
export type AppInputSupply = (point: {
    readonly sessionId: string | null;
    readonly runId: string;
    readonly turnId: string;
    readonly afterEventSequence: number;
    readonly acceptedInputIds: readonly string[];
}, options: Readonly<{
    signal: AbortSignal;
}>) => Promise<readonly {
    readonly inputId: string;
    readonly text: string;
    readonly sourceRef: unknown;
}[]>;
/** 稳定执行身份：宿主派生并持久化，重试先按原身份查记录，不生成第二个 Turn。 */
export type ExecutionIdentity = {
    runId: string;
    turnId: string;
};
/**
 * Host-supplied run inputs shared by the new run and the same-identity resume.
 *
 * Every field is optional. Absent fields keep the Kernel's configured sources:
 * without `baseSystemPrompt` and `skills` the fixed base text and the Skill
 * files are used, without `reasoningReplay` no thinking is filtered, and
 * without `previewRequest` the runner's configured estimator measures the
 * request. `skills` and `baseSystemPrompt` are independent; when `skills` is
 * given, `skillResourceRoot` reports `provided-by-host` and no Skill file is
 * read.
 */
export interface HostContextInputs {
    readonly baseSystemPrompt?: BaseSystemPromptInput;
    readonly skills?: readonly SkillContext[];
    readonly reasoningReplay?: ReasoningReplay;
    readonly previewRequest?: ContextPreview;
    readonly onContextSelected?: (report: ContextSelectionReport) => void;
    /**
     * MR (lead ruling 2026-11-02): the Runner's optional retry wait. Absent keeps
     * the real 2/4/8/16 s waits; tests inject a no-op so a real-Host row does not
     * sit out 30 s.
     */
    readonly retryDelay?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}
//# sourceMappingURL=composition-contracts.d.ts.map