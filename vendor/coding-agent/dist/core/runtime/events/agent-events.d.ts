/**
 * 模块职责：定义驱动 RunState 的 AgentEvent 联合类型、元数据和状态转换校验规则。
 *
 * 设计边界：事件只描述已经发生的事实，不直接修改状态，也不执行外部副作用。
 * 关键流程：生产者构造并校验事件，delivery 提交事实，reducer 根据事件得到下一状态。
 */
import { z } from "zod";
import type { RunState } from "../state/run-state.js";
export declare const eventMetaSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    eventId: z.ZodString;
    runId: z.ZodString;
    turnId: z.ZodString;
    sequence: z.ZodNumber;
    occurredAt: z.ZodString;
    elapsedMs: z.ZodNumber;
}, z.core.$strict>;
export declare const agentEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"run.started">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{}, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"model.request_started">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        requestId: z.ZodString;
        retryOfRequestId: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"model.usage_recorded">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        requestId: z.ZodString;
        delta: z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cachedInputTokens: z.ZodNumber;
            costUsdMicros: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"model.request_failed">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        requestId: z.ZodString;
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"assistant.message_completed">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        requestId: z.ZodString;
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool.started">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        call: z.ZodObject<{
            schemaVersion: z.ZodLiteral<1>;
            callId: z.ZodString;
            name: z.ZodString;
            arguments: z.ZodType<import("../../context/types/context-types.js").JsonObject, unknown, z.core.$ZodTypeInternals<import("../../context/types/context-types.js").JsonObject, unknown>>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool.completed">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool.failed">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        callId: z.ZodString;
        phase: z.ZodEnum<{
            pre_execution: "pre_execution";
            execution: "execution";
        }>;
        result: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool.cancelled">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        callId: z.ZodString;
        result: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"tool.outcome_unknown">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        callId: z.ZodString;
        toolName: z.ZodString;
        effectClass: z.ZodEnum<{
            read_only: "read_only";
            workspace_write: "workspace_write";
            process: "process";
        }>;
        reason: z.ZodEnum<{
            process_interrupted: "process_interrupted";
            cancelled_while_running: "cancelled_while_running";
        }>;
        retryPolicy: z.ZodLiteral<"never_automatic">;
        recordedCallEventId: z.ZodString;
        synthesizedResult: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"run.paused">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        pause: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"run.yielded">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"run.input_accepted">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        input: z.ZodObject<{
            inputId: z.ZodString;
            messageId: z.ZodString;
            text: z.ZodString;
            sourceRef: z.ZodUnknown;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"run.resumed">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        resumedBy: z.ZodEnum<{
            tool_executor: "tool_executor";
            hook: "hook";
            runtime: "runtime";
            app: "app";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"run.completed">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        finalMessageId: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"run.cancelled">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
        reason: z.ZodEnum<{
            caller_requested: "caller_requested";
            user_interrupt: "user_interrupt";
            process_signal: "process_signal";
        }>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"run.limit_exceeded">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"run.failed">;
    meta: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        eventId: z.ZodString;
        runId: z.ZodString;
        turnId: z.ZodString;
        sequence: z.ZodNumber;
        occurredAt: z.ZodString;
        elapsedMs: z.ZodNumber;
    }, z.core.$strict>;
    payload: z.ZodObject<{
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
    }, z.core.$strict>;
}, z.core.$strict>], "type">;
export type EventMeta = z.infer<typeof eventMetaSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type ExtractAgentEventPayload<TType extends AgentEvent["type"]> = Extract<AgentEvent, {
    type: TType;
}>["payload"];
export type TransitionViolationCode = "schema_invalid" | "identity_mismatch" | "sequence_mismatch" | "elapsed_time_regression" | "status_disallows_event" | "phase_disallows_event" | "operation_mismatch" | "duplicate_id" | "invariant_violation";
export type TransitionValidationResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly violation: {
        readonly code: TransitionViolationCode;
        readonly message: string;
    };
};
export declare function validateTransition(stateInput: Readonly<RunState>, eventInput: unknown): TransitionValidationResult;
//# sourceMappingURL=agent-events.d.ts.map