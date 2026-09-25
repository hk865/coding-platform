/**
 * 模块职责：定义 Hook 调用、注册信息、失败结果和决策结果的版本化协议。
 *
 * 设计边界：协议只描述合法输入输出，不执行 Hook，也不决定具体 Hook 的先后顺序。
 * 关键流程：调用端按 Hook 点构造 invocation，执行后用配对规则校验 decision。
 */
import { z } from "zod";
export declare const hookPointSchema: z.ZodEnum<{
    before_model: "before_model";
    before_tool: "before_tool";
    after_tool: "after_tool";
}>;
export declare const hookRegistrationSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    hookId: z.ZodString;
    point: z.ZodEnum<{
        before_model: "before_model";
        before_tool: "before_tool";
        after_tool: "after_tool";
    }>;
    priority: z.ZodNumber;
}, z.core.$strict>;
export declare const beforeModelHookInvocationSchema: z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    request: z.ZodObject<{
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
    schemaVersion: z.ZodLiteral<1>;
    state: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        runId: z.ZodString;
        turn: z.ZodObject<{
            turnId: z.ZodString;
            userMessage: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            completed: "completed";
            failed: "failed";
            created: "created";
            running: "running";
            paused: "paused";
            limit_exceeded: "limit_exceeded";
        }>;
        transcript: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"user_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"assistant_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"assistant">;
                content: z.ZodString;
                reasoningContent: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            toolCalls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                callId: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"tool_result">;
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
        }, z.core.$strict>], "kind">>>;
        activeModelRequest: z.ZodNullable<z.ZodObject<{
            requestId: z.ZodString;
            retryOfRequestId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodString;
        }, z.core.$strict>>;
        toolBatch: z.ZodNullable<z.ZodObject<{
            sourceMessageId: z.ZodString;
            calls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                ordinal: z.ZodNumber;
                requestedCall: z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>;
                effectiveCall: z.ZodNullable<z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>>;
                status: z.ZodEnum<{
                    outcome_unknown: "outcome_unknown";
                    cancelled: "cancelled";
                    completed: "completed";
                    failed: "failed";
                    running: "running";
                    pending: "pending";
                    abandoned: "abandoned";
                }>;
                result: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                }, z.core.$strict>], "status">>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
        pause: z.ZodNullable<z.ZodObject<{
            reason: z.ZodEnum<{
                operator_requested: "operator_requested";
                hook_requested: "hook_requested";
                approval_required: "approval_required";
                external_input_required: "external_input_required";
            }>;
            requestedBy: z.ZodEnum<{
                runtime: "runtime";
                tool_executor: "tool_executor";
                hook: "hook";
                app: "app";
            }>;
            pausedAt: z.ZodString;
            pendingToolCallId: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        outcome: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"completed">;
            reason: z.ZodLiteral<"final_answer">;
            finalMessageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"cancelled">;
            reason: z.ZodEnum<{
                caller_requested: "caller_requested";
                user_interrupt: "user_interrupt";
                process_signal: "process_signal";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"limit_exceeded">;
            limit: z.ZodEnum<{
                tool_calls: "tool_calls";
                model_requests: "model_requests";
                input_tokens: "input_tokens";
                output_tokens: "output_tokens";
                total_tokens: "total_tokens";
                cost: "cost";
                deadline: "deadline";
            }>;
            observed: z.ZodNumber;
            allowed: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"failed">;
            failure: z.ZodObject<{
                category: z.ZodEnum<{
                    model: "model";
                    context: "context";
                    model_protocol: "model_protocol";
                    tool_executor: "tool_executor";
                    hook: "hook";
                    required_sink: "required_sink";
                    invariant: "invariant";
                    internal: "internal";
                }>;
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
                operationId: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>], "kind">>;
        usage: z.ZodObject<{
            modelRequestCount: z.ZodNumber;
            toolCallCount: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            costUsdMicros: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        createdAt: z.ZodString;
        startedAt: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
        endedAt: z.ZodNullable<z.ZodString>;
        elapsedMs: z.ZodNumber;
        lastEventSequence: z.ZodNumber;
        lastEventId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const beforeToolHookInvocationSchema: z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    call: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        callId: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    state: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        runId: z.ZodString;
        turn: z.ZodObject<{
            turnId: z.ZodString;
            userMessage: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            completed: "completed";
            failed: "failed";
            created: "created";
            running: "running";
            paused: "paused";
            limit_exceeded: "limit_exceeded";
        }>;
        transcript: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"user_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"assistant_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"assistant">;
                content: z.ZodString;
                reasoningContent: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            toolCalls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                callId: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"tool_result">;
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
        }, z.core.$strict>], "kind">>>;
        activeModelRequest: z.ZodNullable<z.ZodObject<{
            requestId: z.ZodString;
            retryOfRequestId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodString;
        }, z.core.$strict>>;
        toolBatch: z.ZodNullable<z.ZodObject<{
            sourceMessageId: z.ZodString;
            calls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                ordinal: z.ZodNumber;
                requestedCall: z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>;
                effectiveCall: z.ZodNullable<z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>>;
                status: z.ZodEnum<{
                    outcome_unknown: "outcome_unknown";
                    cancelled: "cancelled";
                    completed: "completed";
                    failed: "failed";
                    running: "running";
                    pending: "pending";
                    abandoned: "abandoned";
                }>;
                result: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                }, z.core.$strict>], "status">>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
        pause: z.ZodNullable<z.ZodObject<{
            reason: z.ZodEnum<{
                operator_requested: "operator_requested";
                hook_requested: "hook_requested";
                approval_required: "approval_required";
                external_input_required: "external_input_required";
            }>;
            requestedBy: z.ZodEnum<{
                runtime: "runtime";
                tool_executor: "tool_executor";
                hook: "hook";
                app: "app";
            }>;
            pausedAt: z.ZodString;
            pendingToolCallId: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        outcome: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"completed">;
            reason: z.ZodLiteral<"final_answer">;
            finalMessageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"cancelled">;
            reason: z.ZodEnum<{
                caller_requested: "caller_requested";
                user_interrupt: "user_interrupt";
                process_signal: "process_signal";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"limit_exceeded">;
            limit: z.ZodEnum<{
                tool_calls: "tool_calls";
                model_requests: "model_requests";
                input_tokens: "input_tokens";
                output_tokens: "output_tokens";
                total_tokens: "total_tokens";
                cost: "cost";
                deadline: "deadline";
            }>;
            observed: z.ZodNumber;
            allowed: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"failed">;
            failure: z.ZodObject<{
                category: z.ZodEnum<{
                    model: "model";
                    context: "context";
                    model_protocol: "model_protocol";
                    tool_executor: "tool_executor";
                    hook: "hook";
                    required_sink: "required_sink";
                    invariant: "invariant";
                    internal: "internal";
                }>;
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
                operationId: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>], "kind">>;
        usage: z.ZodObject<{
            modelRequestCount: z.ZodNumber;
            toolCallCount: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            costUsdMicros: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        createdAt: z.ZodString;
        startedAt: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
        endedAt: z.ZodNullable<z.ZodString>;
        elapsedMs: z.ZodNumber;
        lastEventSequence: z.ZodNumber;
        lastEventId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const afterToolHookInvocationSchema: z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
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
    schemaVersion: z.ZodLiteral<1>;
    state: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        runId: z.ZodString;
        turn: z.ZodObject<{
            turnId: z.ZodString;
            userMessage: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            completed: "completed";
            failed: "failed";
            created: "created";
            running: "running";
            paused: "paused";
            limit_exceeded: "limit_exceeded";
        }>;
        transcript: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"user_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"assistant_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"assistant">;
                content: z.ZodString;
                reasoningContent: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            toolCalls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                callId: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"tool_result">;
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
        }, z.core.$strict>], "kind">>>;
        activeModelRequest: z.ZodNullable<z.ZodObject<{
            requestId: z.ZodString;
            retryOfRequestId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodString;
        }, z.core.$strict>>;
        toolBatch: z.ZodNullable<z.ZodObject<{
            sourceMessageId: z.ZodString;
            calls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                ordinal: z.ZodNumber;
                requestedCall: z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>;
                effectiveCall: z.ZodNullable<z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>>;
                status: z.ZodEnum<{
                    outcome_unknown: "outcome_unknown";
                    cancelled: "cancelled";
                    completed: "completed";
                    failed: "failed";
                    running: "running";
                    pending: "pending";
                    abandoned: "abandoned";
                }>;
                result: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                }, z.core.$strict>], "status">>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
        pause: z.ZodNullable<z.ZodObject<{
            reason: z.ZodEnum<{
                operator_requested: "operator_requested";
                hook_requested: "hook_requested";
                approval_required: "approval_required";
                external_input_required: "external_input_required";
            }>;
            requestedBy: z.ZodEnum<{
                runtime: "runtime";
                tool_executor: "tool_executor";
                hook: "hook";
                app: "app";
            }>;
            pausedAt: z.ZodString;
            pendingToolCallId: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        outcome: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"completed">;
            reason: z.ZodLiteral<"final_answer">;
            finalMessageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"cancelled">;
            reason: z.ZodEnum<{
                caller_requested: "caller_requested";
                user_interrupt: "user_interrupt";
                process_signal: "process_signal";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"limit_exceeded">;
            limit: z.ZodEnum<{
                tool_calls: "tool_calls";
                model_requests: "model_requests";
                input_tokens: "input_tokens";
                output_tokens: "output_tokens";
                total_tokens: "total_tokens";
                cost: "cost";
                deadline: "deadline";
            }>;
            observed: z.ZodNumber;
            allowed: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"failed">;
            failure: z.ZodObject<{
                category: z.ZodEnum<{
                    model: "model";
                    context: "context";
                    model_protocol: "model_protocol";
                    tool_executor: "tool_executor";
                    hook: "hook";
                    required_sink: "required_sink";
                    invariant: "invariant";
                    internal: "internal";
                }>;
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
                operationId: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>], "kind">>;
        usage: z.ZodObject<{
            modelRequestCount: z.ZodNumber;
            toolCallCount: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            costUsdMicros: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        createdAt: z.ZodString;
        startedAt: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
        endedAt: z.ZodNullable<z.ZodString>;
        elapsedMs: z.ZodNumber;
        lastEventSequence: z.ZodNumber;
        lastEventId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const hookInvocationSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    request: z.ZodObject<{
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
    schemaVersion: z.ZodLiteral<1>;
    state: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        runId: z.ZodString;
        turn: z.ZodObject<{
            turnId: z.ZodString;
            userMessage: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            completed: "completed";
            failed: "failed";
            created: "created";
            running: "running";
            paused: "paused";
            limit_exceeded: "limit_exceeded";
        }>;
        transcript: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"user_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"assistant_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"assistant">;
                content: z.ZodString;
                reasoningContent: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            toolCalls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                callId: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"tool_result">;
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
        }, z.core.$strict>], "kind">>>;
        activeModelRequest: z.ZodNullable<z.ZodObject<{
            requestId: z.ZodString;
            retryOfRequestId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodString;
        }, z.core.$strict>>;
        toolBatch: z.ZodNullable<z.ZodObject<{
            sourceMessageId: z.ZodString;
            calls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                ordinal: z.ZodNumber;
                requestedCall: z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>;
                effectiveCall: z.ZodNullable<z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>>;
                status: z.ZodEnum<{
                    outcome_unknown: "outcome_unknown";
                    cancelled: "cancelled";
                    completed: "completed";
                    failed: "failed";
                    running: "running";
                    pending: "pending";
                    abandoned: "abandoned";
                }>;
                result: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                }, z.core.$strict>], "status">>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
        pause: z.ZodNullable<z.ZodObject<{
            reason: z.ZodEnum<{
                operator_requested: "operator_requested";
                hook_requested: "hook_requested";
                approval_required: "approval_required";
                external_input_required: "external_input_required";
            }>;
            requestedBy: z.ZodEnum<{
                runtime: "runtime";
                tool_executor: "tool_executor";
                hook: "hook";
                app: "app";
            }>;
            pausedAt: z.ZodString;
            pendingToolCallId: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        outcome: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"completed">;
            reason: z.ZodLiteral<"final_answer">;
            finalMessageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"cancelled">;
            reason: z.ZodEnum<{
                caller_requested: "caller_requested";
                user_interrupt: "user_interrupt";
                process_signal: "process_signal";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"limit_exceeded">;
            limit: z.ZodEnum<{
                tool_calls: "tool_calls";
                model_requests: "model_requests";
                input_tokens: "input_tokens";
                output_tokens: "output_tokens";
                total_tokens: "total_tokens";
                cost: "cost";
                deadline: "deadline";
            }>;
            observed: z.ZodNumber;
            allowed: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"failed">;
            failure: z.ZodObject<{
                category: z.ZodEnum<{
                    model: "model";
                    context: "context";
                    model_protocol: "model_protocol";
                    tool_executor: "tool_executor";
                    hook: "hook";
                    required_sink: "required_sink";
                    invariant: "invariant";
                    internal: "internal";
                }>;
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
                operationId: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>], "kind">>;
        usage: z.ZodObject<{
            modelRequestCount: z.ZodNumber;
            toolCallCount: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            costUsdMicros: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        createdAt: z.ZodString;
        startedAt: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
        endedAt: z.ZodNullable<z.ZodString>;
        elapsedMs: z.ZodNumber;
        lastEventSequence: z.ZodNumber;
        lastEventId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    call: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        callId: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<1>;
    state: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        runId: z.ZodString;
        turn: z.ZodObject<{
            turnId: z.ZodString;
            userMessage: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            completed: "completed";
            failed: "failed";
            created: "created";
            running: "running";
            paused: "paused";
            limit_exceeded: "limit_exceeded";
        }>;
        transcript: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"user_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"assistant_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"assistant">;
                content: z.ZodString;
                reasoningContent: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            toolCalls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                callId: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"tool_result">;
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
        }, z.core.$strict>], "kind">>>;
        activeModelRequest: z.ZodNullable<z.ZodObject<{
            requestId: z.ZodString;
            retryOfRequestId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodString;
        }, z.core.$strict>>;
        toolBatch: z.ZodNullable<z.ZodObject<{
            sourceMessageId: z.ZodString;
            calls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                ordinal: z.ZodNumber;
                requestedCall: z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>;
                effectiveCall: z.ZodNullable<z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>>;
                status: z.ZodEnum<{
                    outcome_unknown: "outcome_unknown";
                    cancelled: "cancelled";
                    completed: "completed";
                    failed: "failed";
                    running: "running";
                    pending: "pending";
                    abandoned: "abandoned";
                }>;
                result: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                }, z.core.$strict>], "status">>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
        pause: z.ZodNullable<z.ZodObject<{
            reason: z.ZodEnum<{
                operator_requested: "operator_requested";
                hook_requested: "hook_requested";
                approval_required: "approval_required";
                external_input_required: "external_input_required";
            }>;
            requestedBy: z.ZodEnum<{
                runtime: "runtime";
                tool_executor: "tool_executor";
                hook: "hook";
                app: "app";
            }>;
            pausedAt: z.ZodString;
            pendingToolCallId: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        outcome: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"completed">;
            reason: z.ZodLiteral<"final_answer">;
            finalMessageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"cancelled">;
            reason: z.ZodEnum<{
                caller_requested: "caller_requested";
                user_interrupt: "user_interrupt";
                process_signal: "process_signal";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"limit_exceeded">;
            limit: z.ZodEnum<{
                tool_calls: "tool_calls";
                model_requests: "model_requests";
                input_tokens: "input_tokens";
                output_tokens: "output_tokens";
                total_tokens: "total_tokens";
                cost: "cost";
                deadline: "deadline";
            }>;
            observed: z.ZodNumber;
            allowed: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"failed">;
            failure: z.ZodObject<{
                category: z.ZodEnum<{
                    model: "model";
                    context: "context";
                    model_protocol: "model_protocol";
                    tool_executor: "tool_executor";
                    hook: "hook";
                    required_sink: "required_sink";
                    invariant: "invariant";
                    internal: "internal";
                }>;
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
                operationId: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>], "kind">>;
        usage: z.ZodObject<{
            modelRequestCount: z.ZodNumber;
            toolCallCount: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            costUsdMicros: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        createdAt: z.ZodString;
        startedAt: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
        endedAt: z.ZodNullable<z.ZodString>;
        elapsedMs: z.ZodNumber;
        lastEventSequence: z.ZodNumber;
        lastEventId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
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
    schemaVersion: z.ZodLiteral<1>;
    state: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        runId: z.ZodString;
        turn: z.ZodObject<{
            turnId: z.ZodString;
            userMessage: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            completed: "completed";
            failed: "failed";
            created: "created";
            running: "running";
            paused: "paused";
            limit_exceeded: "limit_exceeded";
        }>;
        transcript: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"user_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"user">;
                content: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"assistant_message">;
            message: z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                messageId: z.ZodString;
                role: z.ZodLiteral<"assistant">;
                content: z.ZodString;
                reasoningContent: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            toolCalls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                schemaVersion: z.ZodLiteral<1>;
                callId: z.ZodString;
                name: z.ZodString;
                arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
            }, z.core.$strict>>>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"tool_result">;
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
        }, z.core.$strict>], "kind">>>;
        activeModelRequest: z.ZodNullable<z.ZodObject<{
            requestId: z.ZodString;
            retryOfRequestId: z.ZodNullable<z.ZodString>;
            startedAt: z.ZodString;
        }, z.core.$strict>>;
        toolBatch: z.ZodNullable<z.ZodObject<{
            sourceMessageId: z.ZodString;
            calls: z.ZodReadonly<z.ZodArray<z.ZodObject<{
                ordinal: z.ZodNumber;
                requestedCall: z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>;
                effectiveCall: z.ZodNullable<z.ZodObject<{
                    schemaVersion: z.ZodLiteral<1>;
                    callId: z.ZodString;
                    name: z.ZodString;
                    arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
                }, z.core.$strict>>;
                status: z.ZodEnum<{
                    outcome_unknown: "outcome_unknown";
                    cancelled: "cancelled";
                    completed: "completed";
                    failed: "failed";
                    running: "running";
                    pending: "pending";
                    abandoned: "abandoned";
                }>;
                result: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                }, z.core.$strict>], "status">>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>;
        pause: z.ZodNullable<z.ZodObject<{
            reason: z.ZodEnum<{
                operator_requested: "operator_requested";
                hook_requested: "hook_requested";
                approval_required: "approval_required";
                external_input_required: "external_input_required";
            }>;
            requestedBy: z.ZodEnum<{
                runtime: "runtime";
                tool_executor: "tool_executor";
                hook: "hook";
                app: "app";
            }>;
            pausedAt: z.ZodString;
            pendingToolCallId: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        outcome: z.ZodNullable<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"completed">;
            reason: z.ZodLiteral<"final_answer">;
            finalMessageId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"cancelled">;
            reason: z.ZodEnum<{
                caller_requested: "caller_requested";
                user_interrupt: "user_interrupt";
                process_signal: "process_signal";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"limit_exceeded">;
            limit: z.ZodEnum<{
                tool_calls: "tool_calls";
                model_requests: "model_requests";
                input_tokens: "input_tokens";
                output_tokens: "output_tokens";
                total_tokens: "total_tokens";
                cost: "cost";
                deadline: "deadline";
            }>;
            observed: z.ZodNumber;
            allowed: z.ZodNumber;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"failed">;
            failure: z.ZodObject<{
                category: z.ZodEnum<{
                    model: "model";
                    context: "context";
                    model_protocol: "model_protocol";
                    tool_executor: "tool_executor";
                    hook: "hook";
                    required_sink: "required_sink";
                    invariant: "invariant";
                    internal: "internal";
                }>;
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
                operationId: z.ZodNullable<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>], "kind">>;
        usage: z.ZodObject<{
            modelRequestCount: z.ZodNumber;
            toolCallCount: z.ZodNumber;
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            costUsdMicros: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        createdAt: z.ZodString;
        startedAt: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodString;
        endedAt: z.ZodNullable<z.ZodString>;
        elapsedMs: z.ZodNumber;
        lastEventSequence: z.ZodNumber;
        lastEventId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "point">;
export declare const hookFailureSchema: z.ZodObject<{
    category: z.ZodLiteral<"hook">;
    code: z.ZodString;
    message: z.ZodString;
    retryable: z.ZodBoolean;
    operationId: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const toolResultPresentationSchema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const beforeModelHookDecisionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"continue">;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"modify">;
    value: z.ZodObject<{
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
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"block">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"pause">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"fail">;
    failure: z.ZodObject<{
        category: z.ZodLiteral<"hook">;
        code: z.ZodString;
        message: z.ZodString;
        retryable: z.ZodBoolean;
        operationId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">;
export declare const beforeToolHookDecisionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"continue">;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"modify">;
    value: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        callId: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"block">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"pause">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"fail">;
    failure: z.ZodObject<{
        category: z.ZodLiteral<"hook">;
        code: z.ZodString;
        message: z.ZodString;
        retryable: z.ZodBoolean;
        operationId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">;
export declare const afterToolHookDecisionSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
    kind: z.ZodLiteral<"continue">;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
    kind: z.ZodLiteral<"modify">;
    value: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
    kind: z.ZodLiteral<"pause">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
    kind: z.ZodLiteral<"fail">;
    failure: z.ZodObject<{
        category: z.ZodLiteral<"hook">;
        code: z.ZodString;
        message: z.ZodString;
        retryable: z.ZodBoolean;
        operationId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">;
export declare const hookDecisionSchema: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"continue">;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"modify">;
    value: z.ZodObject<{
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
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"block">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"pause">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_model">;
    kind: z.ZodLiteral<"fail">;
    failure: z.ZodObject<{
        category: z.ZodLiteral<"hook">;
        code: z.ZodString;
        message: z.ZodString;
        retryable: z.ZodBoolean;
        operationId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">, z.ZodDiscriminatedUnion<[z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"continue">;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"modify">;
    value: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        callId: z.ZodString;
        name: z.ZodString;
        arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"block">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"pause">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"before_tool">;
    kind: z.ZodLiteral<"fail">;
    failure: z.ZodObject<{
        category: z.ZodLiteral<"hook">;
        code: z.ZodString;
        message: z.ZodString;
        retryable: z.ZodBoolean;
        operationId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">, z.ZodDiscriminatedUnion<[z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
    kind: z.ZodLiteral<"continue">;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
    kind: z.ZodLiteral<"modify">;
    value: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
    kind: z.ZodLiteral<"pause">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    point: z.ZodLiteral<"after_tool">;
    kind: z.ZodLiteral<"fail">;
    failure: z.ZodObject<{
        category: z.ZodLiteral<"hook">;
        code: z.ZodString;
        message: z.ZodString;
        retryable: z.ZodBoolean;
        operationId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">]>;
export type HookPoint = z.infer<typeof hookPointSchema>;
export type HookRegistration = z.infer<typeof hookRegistrationSchema>;
export type BeforeModelHookInvocation = z.infer<typeof beforeModelHookInvocationSchema>;
export type BeforeToolHookInvocation = z.infer<typeof beforeToolHookInvocationSchema>;
export type AfterToolHookInvocation = z.infer<typeof afterToolHookInvocationSchema>;
export type HookInvocation = z.infer<typeof hookInvocationSchema>;
export type HookFailure = z.infer<typeof hookFailureSchema>;
export type ToolResultPresentation = z.infer<typeof toolResultPresentationSchema>;
export type BeforeModelHookDecision = z.infer<typeof beforeModelHookDecisionSchema>;
export type BeforeToolHookDecision = z.infer<typeof beforeToolHookDecisionSchema>;
export type AfterToolHookDecision = z.infer<typeof afterToolHookDecisionSchema>;
export type HookDecision = z.infer<typeof hookDecisionSchema>;
export interface HookExecutionOptions {
    readonly signal: AbortSignal;
}
interface HookPortBase<TPoint extends HookPoint> {
    readonly hookId: string;
    readonly point: TPoint;
    readonly priority: number;
}
export interface BeforeModelHookPort extends HookPortBase<"before_model"> {
    execute(invocation: Readonly<BeforeModelHookInvocation>, options: Readonly<HookExecutionOptions>): Promise<BeforeModelHookDecision>;
}
export interface BeforeToolHookPort extends HookPortBase<"before_tool"> {
    execute(invocation: Readonly<BeforeToolHookInvocation>, options: Readonly<HookExecutionOptions>): Promise<BeforeToolHookDecision>;
}
export interface AfterToolHookPort extends HookPortBase<"after_tool"> {
    execute(invocation: Readonly<AfterToolHookInvocation>, options: Readonly<HookExecutionOptions>): Promise<AfterToolHookDecision>;
}
export type HookPort = BeforeModelHookPort | BeforeToolHookPort | AfterToolHookPort;
export type HookDecisionViolationCode = "invalid_invocation" | "invalid_decision" | "point_mismatch" | "identity_modified";
export type HookDecisionValidationResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly violation: {
        readonly code: HookDecisionViolationCode;
        readonly message: string;
    };
};
export declare function validateHookDecision(invocationInput: unknown, decisionInput: unknown): HookDecisionValidationResult;
export {};
//# sourceMappingURL=hook-protocol.d.ts.map