/**
 * 模块职责：定义工具调用、输出、副作用、失败和取消结果，以及统一执行端口。
 *
 * 设计边界：这里只规定 Core 与工具系统的边界，不包含注册、审批或沙箱实现。
 * 关键流程：调用和结果都经 schema 校验，并通过 callId 与 toolName 进行严格关联检查。
 */
import { z } from "zod";
export declare const toolCallSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    callId: z.ZodString;
    name: z.ZodString;
    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
}, z.core.$strict>;
export declare const toolOutputPartSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"text">;
    text: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"json">;
    value: z.ZodType<import("../../context/types/context-types.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonValue, unknown>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"artifact_ref">;
    uri: z.ZodString;
    summary: z.ZodString;
}, z.core.$strict>], "kind">;
export declare const toolEffectsSchema: z.ZodObject<{
    sideEffect: z.ZodEnum<{
        none: "none";
        possible: "possible";
        confirmed: "confirmed";
    }>;
    changedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    workspaceRevision: z.ZodNullable<z.ZodString>;
    artifactRefs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
/** 工具副作用类别：read_only 只读、workspace_write 写工作区、process 运行外部进程/系统操作。 */
export declare const toolEffectClassSchema: z.ZodEnum<{
    read_only: "read_only";
    workspace_write: "workspace_write";
    process: "process";
}>;
export type ToolEffectClass = z.infer<typeof toolEffectClassSchema>;
export declare const toolErrorCodeSchema: z.ZodEnum<{
    unknown_tool: "unknown_tool";
    invalid_arguments: "invalid_arguments";
    permission_denied: "permission_denied";
    approval_denied: "approval_denied";
    sandbox_unavailable: "sandbox_unavailable";
    execution_failed: "execution_failed";
    timeout: "timeout";
    protocol_error: "protocol_error";
    hook_blocked: "hook_blocked";
    outcome_unknown: "outcome_unknown";
}>;
export declare const toolErrorSchema: z.ZodObject<{
    code: z.ZodEnum<{
        unknown_tool: "unknown_tool";
        invalid_arguments: "invalid_arguments";
        permission_denied: "permission_denied";
        approval_denied: "approval_denied";
        sandbox_unavailable: "sandbox_unavailable";
        execution_failed: "execution_failed";
        timeout: "timeout";
        protocol_error: "protocol_error";
        hook_blocked: "hook_blocked";
        outcome_unknown: "outcome_unknown";
    }>;
    message: z.ZodString;
    retryable: z.ZodBoolean;
}, z.core.$strict>;
export declare const successfulToolResultSchema: z.ZodObject<{
    status: z.ZodLiteral<"success">;
    schemaVersion: z.ZodLiteral<1>;
    callId: z.ZodString;
    output: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"json">;
        value: z.ZodType<import("../../context/types/context-types.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonValue, unknown>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact_ref">;
        uri: z.ZodString;
        summary: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    effects: z.ZodObject<{
        sideEffect: z.ZodEnum<{
            none: "none";
            possible: "possible";
            confirmed: "confirmed";
        }>;
        changedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        workspaceRevision: z.ZodNullable<z.ZodString>;
        artifactRefs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const failedToolResultSchema: z.ZodObject<{
    status: z.ZodLiteral<"error">;
    error: z.ZodObject<{
        code: z.ZodEnum<{
            unknown_tool: "unknown_tool";
            invalid_arguments: "invalid_arguments";
            permission_denied: "permission_denied";
            approval_denied: "approval_denied";
            sandbox_unavailable: "sandbox_unavailable";
            execution_failed: "execution_failed";
            timeout: "timeout";
            protocol_error: "protocol_error";
            hook_blocked: "hook_blocked";
            outcome_unknown: "outcome_unknown";
        }>;
        message: z.ZodString;
        retryable: z.ZodBoolean;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    callId: z.ZodString;
    output: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"json">;
        value: z.ZodType<import("../../context/types/context-types.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonValue, unknown>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact_ref">;
        uri: z.ZodString;
        summary: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    effects: z.ZodObject<{
        sideEffect: z.ZodEnum<{
            none: "none";
            possible: "possible";
            confirmed: "confirmed";
        }>;
        changedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        workspaceRevision: z.ZodNullable<z.ZodString>;
        artifactRefs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const cancelledToolResultSchema: z.ZodObject<{
    status: z.ZodLiteral<"cancelled">;
    reason: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    callId: z.ZodString;
    output: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"json">;
        value: z.ZodType<import("../../context/types/context-types.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonValue, unknown>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact_ref">;
        uri: z.ZodString;
        summary: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    effects: z.ZodObject<{
        sideEffect: z.ZodEnum<{
            none: "none";
            possible: "possible";
            confirmed: "confirmed";
        }>;
        changedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        workspaceRevision: z.ZodNullable<z.ZodString>;
        artifactRefs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const toolResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"success">;
    schemaVersion: z.ZodLiteral<1>;
    callId: z.ZodString;
    output: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"json">;
        value: z.ZodType<import("../../context/types/context-types.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonValue, unknown>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact_ref">;
        uri: z.ZodString;
        summary: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    effects: z.ZodObject<{
        sideEffect: z.ZodEnum<{
            none: "none";
            possible: "possible";
            confirmed: "confirmed";
        }>;
        changedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        workspaceRevision: z.ZodNullable<z.ZodString>;
        artifactRefs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"error">;
    error: z.ZodObject<{
        code: z.ZodEnum<{
            unknown_tool: "unknown_tool";
            invalid_arguments: "invalid_arguments";
            permission_denied: "permission_denied";
            approval_denied: "approval_denied";
            sandbox_unavailable: "sandbox_unavailable";
            execution_failed: "execution_failed";
            timeout: "timeout";
            protocol_error: "protocol_error";
            hook_blocked: "hook_blocked";
            outcome_unknown: "outcome_unknown";
        }>;
        message: z.ZodString;
        retryable: z.ZodBoolean;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    callId: z.ZodString;
    output: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"json">;
        value: z.ZodType<import("../../context/types/context-types.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonValue, unknown>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact_ref">;
        uri: z.ZodString;
        summary: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    effects: z.ZodObject<{
        sideEffect: z.ZodEnum<{
            none: "none";
            possible: "possible";
            confirmed: "confirmed";
        }>;
        changedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        workspaceRevision: z.ZodNullable<z.ZodString>;
        artifactRefs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"cancelled">;
    reason: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    callId: z.ZodString;
    output: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"json">;
        value: z.ZodType<import("../../context/types/context-types.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonValue, unknown>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact_ref">;
        uri: z.ZodString;
        summary: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    effects: z.ZodObject<{
        sideEffect: z.ZodEnum<{
            none: "none";
            possible: "possible";
            confirmed: "confirmed";
        }>;
        changedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        workspaceRevision: z.ZodNullable<z.ZodString>;
        artifactRefs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>], "status">;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolOutputPart = z.infer<typeof toolOutputPartSchema>;
export type ToolEffects = z.infer<typeof toolEffectsSchema>;
export type ToolError = z.infer<typeof toolErrorSchema>;
export type SuccessfulToolResult = z.infer<typeof successfulToolResultSchema>;
export type FailedToolResult = z.infer<typeof failedToolResultSchema>;
export type CancelledToolResult = z.infer<typeof cancelledToolResultSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export interface ToolExecutionOptions {
    readonly signal: AbortSignal;
}
export interface ToolExecutorPort {
    execute(call: Readonly<ToolCall>, options: Readonly<ToolExecutionOptions>): Promise<ToolResult>;
}
export declare function assertToolResultMatchesCall(call: ToolCall, result: ToolResult): void;
export type ToolProtocolErrorCode = "call_id_mismatch" | "invalid_call" | "invalid_result";
export declare class ToolProtocolError extends Error {
    readonly code: ToolProtocolErrorCode;
    constructor(code: ToolProtocolErrorCode, message: string);
}
//# sourceMappingURL=tool-executor-port.d.ts.map