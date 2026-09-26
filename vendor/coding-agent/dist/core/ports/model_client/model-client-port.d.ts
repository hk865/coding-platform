/**
 * 模块职责：定义模型请求、流式事件、用量数据和模型客户端端口的完整协议。
 *
 * 设计边界：它不绑定任何模型供应商，也不负责把事件归并为最终文本和工具调用。
 * 关键流程：请求和事件先经 schema 校验，流结束后再检查 sequence、终止事件和调用配对。
 */
import { z } from "zod";
export declare const modelMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    role: z.ZodLiteral<"user">;
    messageId: z.ZodString;
    content: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    role: z.ZodLiteral<"assistant">;
    messageId: z.ZodString;
    content: z.ZodString;
    reasoningContent: z.ZodOptional<z.ZodString>;
    toolCalls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        callId: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
    }, z.core.$strict>>>;
}, z.core.$strict>, z.ZodObject<{
    role: z.ZodLiteral<"tool">;
    callId: z.ZodString;
    result: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
}, z.core.$strict>], "role">;
export declare const modelToolSpecSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodString;
    inputSchema: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
}, z.core.$strict>;
export declare const modelRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    runId: z.ZodString;
    systemPrompt: z.ZodString;
    messages: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        role: z.ZodLiteral<"user">;
        messageId: z.ZodString;
        content: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        role: z.ZodLiteral<"assistant">;
        messageId: z.ZodString;
        content: z.ZodString;
        reasoningContent: z.ZodOptional<z.ZodString>;
        toolCalls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            callId: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
        }, z.core.$strict>>>;
    }, z.core.$strict>, z.ZodObject<{
        role: z.ZodLiteral<"tool">;
        callId: z.ZodString;
        result: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "role">>>;
    tools: z.ZodReadonly<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        inputSchema: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
    }, z.core.$strict>>>;
    maxOutputTokens: z.ZodNullable<z.ZodNumber>;
    responseFormat: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"json_object">;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const modelUsageSchema: z.ZodObject<{
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    cachedInputTokens: z.ZodNumber;
    costUsdMicros: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
export declare const modelEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text_delta">;
    delta: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"reasoning_delta">;
    delta: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool_call_started">;
    callId: z.ZodString;
    name: z.ZodString;
    ordinal: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool_arguments_delta">;
    callId: z.ZodString;
    delta: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"usage_snapshot">;
    usage: z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        cachedInputTokens: z.ZodNumber;
        costUsdMicros: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"completed">;
    reason: z.ZodEnum<{
        final_answer: "final_answer";
        tool_calls: "tool_calls";
    }>;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"truncated">;
    reason: z.ZodEnum<{
        max_output_tokens: "max_output_tokens";
        content_filter: "content_filter";
        provider_limit: "provider_limit";
    }>;
    message: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    error: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
        retryable: z.ZodBoolean;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"cancelled">;
    reason: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    requestId: z.ZodString;
    sequence: z.ZodNumber;
}, z.core.$strict>], "type">;
export type ModelMessage = z.infer<typeof modelMessageSchema>;
export type ModelToolSpec = z.infer<typeof modelToolSpecSchema>;
export type ModelRequest = z.infer<typeof modelRequestSchema>;
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type ModelEvent = z.infer<typeof modelEventSchema>;
export interface ModelCallOptions {
    readonly signal: AbortSignal;
}
export interface ModelClientPort {
    stream(request: Readonly<ModelRequest>, options: Readonly<ModelCallOptions>): AsyncIterable<ModelEvent>;
}
export type ModelStreamProtocolViolationCode = "invalid_event" | "request_mismatch" | "sequence_mismatch" | "event_after_terminal" | "missing_terminal" | "duplicate_tool_call" | "unknown_tool_call" | "invalid_tool_arguments" | "usage_regression" | "completion_mismatch";
export type ModelStreamValidationResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly violation: {
        readonly code: ModelStreamProtocolViolationCode;
        readonly message: string;
        readonly eventIndex: number | null;
    };
};
export declare function validateModelEventSequence(events: readonly unknown[]): ModelStreamValidationResult;
//# sourceMappingURL=model-client-port.d.ts.map