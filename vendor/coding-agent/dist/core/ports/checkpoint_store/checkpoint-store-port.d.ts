/**
 * 模块职责：定义 checkpoint 的结构、完整性校验、恢复模式和持久化端口。
 *
 * 设计边界：Core 只依赖该抽象，不关心 checkpoint 保存到内存、SQLite 还是其他介质。
 * 关键流程：由稳定状态生成草稿和校验和，适配器保存；恢复时先验签再选择候选。
 */
import { z } from "zod";
import type { RunState } from "../../runtime/state/run-state.js";
import type { ContextBasis, EffectiveRecoveryConstraintsRecord, RunConfigSnapshot, StoreCallOptions, WorkspaceReference } from "../session_store/session-store-port.js";
export declare const checkpointResumeModeSchema: z.ZodEnum<{
    paused: "paused";
    before_model: "before_model";
    before_tools: "before_tools";
    ready_to_complete: "ready_to_complete";
    terminal: "terminal";
}>;
export declare const checkpointSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    checkpointId: z.ZodString;
    sessionId: z.ZodString;
    runId: z.ZodString;
    turnId: z.ZodString;
    recordPosition: z.ZodNumber;
    lastEventSequence: z.ZodNumber;
    lastEventId: z.ZodNullable<z.ZodString>;
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
    resumeMode: z.ZodEnum<{
        paused: "paused";
        before_model: "before_model";
        before_tools: "before_tools";
        ready_to_complete: "ready_to_complete";
        terminal: "terminal";
    }>;
    config: z.ZodObject<{
        modelConfigId: z.ZodString;
        limits: z.ZodObject<{
            maxModelRequests: z.ZodNullable<z.ZodNumber>;
            maxToolCalls: z.ZodNullable<z.ZodNumber>;
            maxInputTokens: z.ZodNullable<z.ZodNumber>;
            maxOutputTokens: z.ZodNullable<z.ZodNumber>;
            maxTotalTokens: z.ZodNullable<z.ZodNumber>;
            maxCostUsdMicros: z.ZodNullable<z.ZodNumber>;
            deadlineMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        enabledToolSchemaDigest: z.ZodString;
        policyVersion: z.ZodString;
        sandboxProfileVersion: z.ZodString;
        baseConfigDigest: z.ZodString;
    }, z.core.$strict>;
    workspace: z.ZodObject<{
        identity: z.ZodString;
        revision: z.ZodString;
        reference: z.ZodString;
    }, z.core.$strict>;
    contextBasis: z.ZodOptional<z.ZodObject<{
        version: z.ZodNumber;
        mode: z.ZodString;
        throughPosition: z.ZodNumber;
    }, z.core.$strict>>;
    recoveryConstraints: z.ZodOptional<z.ZodObject<{
        version: z.ZodNumber;
        limits: z.ZodObject<{
            maxModelRequests: z.ZodNullable<z.ZodNumber>;
            maxToolCalls: z.ZodNullable<z.ZodNumber>;
            maxInputTokens: z.ZodNullable<z.ZodNumber>;
            maxOutputTokens: z.ZodNullable<z.ZodNumber>;
            maxTotalTokens: z.ZodNullable<z.ZodNumber>;
            maxCostUsdMicros: z.ZodNullable<z.ZodNumber>;
            deadlineMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        workspace: z.ZodObject<{
            deniedPrefixes: z.ZodReadonly<z.ZodArray<z.ZodString>>;
            snapshotIgnoredPrefixes: z.ZodReadonly<z.ZodArray<z.ZodString>>;
            consistencyMode: z.ZodEnum<{
                session: "session";
                workspace: "workspace";
                strict: "strict";
            }>;
            maxFileBytes: z.ZodNumber;
        }, z.core.$strict>;
        process: z.ZodObject<{
            protectedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
            readOnlyPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
            executablePath: z.ZodString;
        }, z.core.$strict>;
        hostAuthorizedTools: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    createdAt: z.ZodString;
    checksum: z.ZodString;
}, z.core.$strict>;
export declare const checkpointDraftSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    checkpointId: z.ZodString;
    sessionId: z.ZodString;
    recordPosition: z.ZodNumber;
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
    config: z.ZodObject<{
        modelConfigId: z.ZodString;
        limits: z.ZodObject<{
            maxModelRequests: z.ZodNullable<z.ZodNumber>;
            maxToolCalls: z.ZodNullable<z.ZodNumber>;
            maxInputTokens: z.ZodNullable<z.ZodNumber>;
            maxOutputTokens: z.ZodNullable<z.ZodNumber>;
            maxTotalTokens: z.ZodNullable<z.ZodNumber>;
            maxCostUsdMicros: z.ZodNullable<z.ZodNumber>;
            deadlineMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        enabledToolSchemaDigest: z.ZodString;
        policyVersion: z.ZodString;
        sandboxProfileVersion: z.ZodString;
        baseConfigDigest: z.ZodString;
    }, z.core.$strict>;
    workspace: z.ZodObject<{
        identity: z.ZodString;
        revision: z.ZodString;
        reference: z.ZodString;
    }, z.core.$strict>;
    contextBasis: z.ZodOptional<z.ZodObject<{
        version: z.ZodNumber;
        mode: z.ZodString;
        throughPosition: z.ZodNumber;
    }, z.core.$strict>>;
    recoveryConstraints: z.ZodOptional<z.ZodObject<{
        version: z.ZodNumber;
        limits: z.ZodObject<{
            maxModelRequests: z.ZodNullable<z.ZodNumber>;
            maxToolCalls: z.ZodNullable<z.ZodNumber>;
            maxInputTokens: z.ZodNullable<z.ZodNumber>;
            maxOutputTokens: z.ZodNullable<z.ZodNumber>;
            maxTotalTokens: z.ZodNullable<z.ZodNumber>;
            maxCostUsdMicros: z.ZodNullable<z.ZodNumber>;
            deadlineMs: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strict>;
        workspace: z.ZodObject<{
            deniedPrefixes: z.ZodReadonly<z.ZodArray<z.ZodString>>;
            snapshotIgnoredPrefixes: z.ZodReadonly<z.ZodArray<z.ZodString>>;
            consistencyMode: z.ZodEnum<{
                session: "session";
                workspace: "workspace";
                strict: "strict";
            }>;
            maxFileBytes: z.ZodNumber;
        }, z.core.$strict>;
        process: z.ZodObject<{
            protectedPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
            readOnlyPaths: z.ZodReadonly<z.ZodArray<z.ZodString>>;
            executablePath: z.ZodString;
        }, z.core.$strict>;
        hostAuthorizedTools: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    createdAt: z.ZodString;
}, z.core.$strict>;
export type CheckpointResumeMode = z.infer<typeof checkpointResumeModeSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type CheckpointDraft = z.infer<typeof checkpointDraftSchema>;
export interface CheckpointCandidate {
    readonly checkpointId: string;
    readonly checkpoint: Checkpoint | null;
}
export interface CheckpointStorePort {
    save(checkpoint: Readonly<CheckpointDraft>, options: Readonly<StoreCallOptions>): Promise<Checkpoint>;
    loadLatest(runId: string, options: Readonly<StoreCallOptions>): Promise<Checkpoint | null>;
    listCheckpoints(runId: string, options: Readonly<StoreCallOptions>): Promise<readonly Checkpoint[]>;
    /**
     * 恢复专用候选读取：单条损坏以 checkpoint=null 表示，不能阻断更旧 checkpoint 回退。
     */
    listCheckpointCandidates?(runId: string, options: Readonly<StoreCallOptions>): Promise<readonly CheckpointCandidate[]>;
    deleteInvalid(checkpointIds: readonly string[], options: Readonly<StoreCallOptions>): Promise<number>;
    close(): Promise<void>;
}
export declare function deriveCheckpointResumeMode(state: RunState): CheckpointResumeMode;
export declare function createCheckpoint(draftInput: Readonly<CheckpointDraft>): Checkpoint;
export declare function assertCheckpointChecksum(checkpoint: Checkpoint): void;
export declare function checkpointDraft(checkpointId: string, sessionId: string, recordPosition: number, state: RunState, config: RunConfigSnapshot, workspace: WorkspaceReference, createdAt: string, contextBasis?: ContextBasis, recoveryConstraints?: EffectiveRecoveryConstraintsRecord): CheckpointDraft;
//# sourceMappingURL=checkpoint-store-port.d.ts.map