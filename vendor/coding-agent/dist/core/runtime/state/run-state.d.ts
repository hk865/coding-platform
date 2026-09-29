/**
 * 模块职责：定义 Run、Turn、对话记录、工具批次、终态结果和 RunState 不变量。
 *
 * 设计边界：本模块表达状态结构与派生判断，不负责事件投递或状态推进。
 * 关键流程：边界值先经 schema 校验；创建初始状态后，只应通过 reducer 演进。
 */
import { z } from "zod";
export declare const runStatusSchema: z.ZodEnum<{
    created: "created";
    running: "running";
    paused: "paused";
    yielded: "yielded";
    completed: "completed";
    cancelled: "cancelled";
    limit_exceeded: "limit_exceeded";
    failed: "failed";
}>;
export declare const runFailureSchema: z.ZodObject<{
    category: z.ZodEnum<{
        context: "context";
        model: "model";
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
/**
 * 明确让出执行的外部等待事实。它与 completed/cancelled/failed 一样构成一次执行的终止，
 * 但语义是「本 Turn 在真实工具组排空后主动退出活动执行，等待外部输入」；它不同于
 * paused（paused 可在原 Kernel 身份上 resume），也不同于 Run 完成。pendingToolCallId
 * 指向让出时仍未开始的调用；让出只发生在已结算的工具组边界，因此通常为 null。
 */
export declare const yieldStateSchema: z.ZodObject<{
    reason: z.ZodEnum<{
        reply_required: "reply_required";
        external_input_required: "external_input_required";
        operator_requested: "operator_requested";
    }>;
    requestedBy: z.ZodEnum<{
        runtime: "runtime";
        app: "app";
    }>;
    yieldedAt: z.ZodString;
    pendingToolCallId: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const runOutcomeSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
        model_requests: "model_requests";
        tool_calls: "tool_calls";
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
            context: "context";
            model: "model";
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
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"yielded">;
    yield: z.ZodObject<{
        reason: z.ZodEnum<{
            reply_required: "reply_required";
            external_input_required: "external_input_required";
            operator_requested: "operator_requested";
        }>;
        requestedBy: z.ZodEnum<{
            runtime: "runtime";
            app: "app";
        }>;
        yieldedAt: z.ZodString;
        pendingToolCallId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>], "kind">;
export declare const pauseStateSchema: z.ZodObject<{
    reason: z.ZodEnum<{
        external_input_required: "external_input_required";
        operator_requested: "operator_requested";
        hook_requested: "hook_requested";
        approval_required: "approval_required";
    }>;
    requestedBy: z.ZodEnum<{
        tool_executor: "tool_executor";
        hook: "hook";
        runtime: "runtime";
        app: "app";
    }>;
    pausedAt: z.ZodString;
    pendingToolCallId: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const turnSchema: z.ZodObject<{
    turnId: z.ZodString;
    userMessage: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        messageId: z.ZodString;
        role: z.ZodLiteral<"user">;
        content: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const runSchema: z.ZodObject<{
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
    createdAt: z.ZodString;
}, z.core.$strict>;
export declare const transcriptEntrySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
}, z.core.$strict>], "kind">;
export declare const activeModelRequestSchema: z.ZodObject<{
    requestId: z.ZodString;
    retryOfRequestId: z.ZodNullable<z.ZodString>;
    startedAt: z.ZodString;
}, z.core.$strict>;
/**
 * 工具生命周期最小矩阵：
 *  - pending：模型已提出，尚未进入执行（Run 结束未启动则 abandoned）；
 *  - running：tool.started 已持久化，副作用已允许开始（矩阵中的 started）；
 *  - completed / failed / cancelled：取得确定结果（success / error / cancelled）并持久化；
 *  - outcome_unknown：已开始执行但 Runtime 因崩溃或强制中断未取得结果；
 *     显式路径由 tool.outcome_unknown 事件携带合成结果；Run 终结兜底时不携带结果；
 *  - abandoned：Run 结束时尚未开始的调用被放弃，不允许伪造结果。
 */
export declare const toolExecutionStateSchema: z.ZodObject<{
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
        running: "running";
        completed: "completed";
        cancelled: "cancelled";
        failed: "failed";
        pending: "pending";
        outcome_unknown: "outcome_unknown";
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
}, z.core.$strict>;
export declare const toolBatchStateSchema: z.ZodObject<{
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
            running: "running";
            completed: "completed";
            cancelled: "cancelled";
            failed: "failed";
            pending: "pending";
            outcome_unknown: "outcome_unknown";
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
}, z.core.$strict>;
export declare const runUsageSchema: z.ZodObject<{
    modelRequestCount: z.ZodNumber;
    toolCallCount: z.ZodNumber;
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    cachedInputTokens: z.ZodNumber;
    costUsdMicros: z.ZodNullable<z.ZodNumber>;
}, z.core.$strict>;
/**
 * One input that was really accepted into the execution context. The inputId is
 * the stable identity of its ORIGINAL persisted source (message ref + part), the
 * digest covers the exact accepted text, and eventSequence is the required
 * run.input_accepted event that carried it. It never claims the model understood
 * it or that any business work was processed.
 */
export declare const acceptedInputSchema: z.ZodObject<{
    inputId: z.ZodString;
    messageId: z.ZodString;
    digest: z.ZodString;
    eventSequence: z.ZodNumber;
}, z.core.$strict>;
export declare const runStateSchema: z.ZodObject<{
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
        created: "created";
        running: "running";
        paused: "paused";
        yielded: "yielded";
        completed: "completed";
        cancelled: "cancelled";
        limit_exceeded: "limit_exceeded";
        failed: "failed";
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
                running: "running";
                completed: "completed";
                cancelled: "cancelled";
                failed: "failed";
                pending: "pending";
                outcome_unknown: "outcome_unknown";
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
            external_input_required: "external_input_required";
            operator_requested: "operator_requested";
            hook_requested: "hook_requested";
            approval_required: "approval_required";
        }>;
        requestedBy: z.ZodEnum<{
            tool_executor: "tool_executor";
            hook: "hook";
            runtime: "runtime";
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
            model_requests: "model_requests";
            tool_calls: "tool_calls";
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
                context: "context";
                model: "model";
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
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"yielded">;
        yield: z.ZodObject<{
            reason: z.ZodEnum<{
                reply_required: "reply_required";
                external_input_required: "external_input_required";
                operator_requested: "operator_requested";
            }>;
            requestedBy: z.ZodEnum<{
                runtime: "runtime";
                app: "app";
            }>;
            yieldedAt: z.ZodString;
            pendingToolCallId: z.ZodNullable<z.ZodString>;
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
    acceptedInputs: z.ZodDefault<z.ZodReadonly<z.ZodArray<z.ZodObject<{
        inputId: z.ZodString;
        messageId: z.ZodString;
        digest: z.ZodString;
        eventSequence: z.ZodNumber;
    }, z.core.$strict>>>>;
}, z.core.$strict>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunFailure = z.infer<typeof runFailureSchema>;
export type RunOutcome = z.infer<typeof runOutcomeSchema>;
export type PauseState = z.infer<typeof pauseStateSchema>;
export type YieldState = z.infer<typeof yieldStateSchema>;
export type YieldReason = YieldState["reason"];
export type Turn = z.infer<typeof turnSchema>;
export type Run = z.infer<typeof runSchema>;
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;
export type ActiveModelRequest = z.infer<typeof activeModelRequestSchema>;
export type ToolExecutionState = z.infer<typeof toolExecutionStateSchema>;
export type ToolBatchState = z.infer<typeof toolBatchStateSchema>;
export type RunUsage = z.infer<typeof runUsageSchema>;
export type RunState = z.infer<typeof runStateSchema>;
export type AcceptedInput = z.infer<typeof acceptedInputSchema>;
export type DerivedRunPhase = "created" | "before_model" | "awaiting_model" | "before_tools" | "ready_to_complete" | "paused" | "terminal";
export type RunStateInvariantResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly message: string;
};
export declare function isTerminalRunStatus(status: RunStatus): boolean;
export declare function createInitialRunState(runInput: Run): RunState;
export declare function validateRunStateInvariants(input: unknown): RunStateInvariantResult;
export declare function deriveRunPhase(state: RunState): DerivedRunPhase;
//# sourceMappingURL=run-state.d.ts.map