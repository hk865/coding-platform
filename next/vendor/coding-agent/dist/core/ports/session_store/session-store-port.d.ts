import { z } from "zod";
import type { RunLimits } from "../../runtime/limits/limit-guard.js";
export declare const workspaceReferenceSchema: z.ZodObject<{
    identity: z.ZodString;
    revision: z.ZodString;
    reference: z.ZodString;
}, z.core.$strict>;
export declare const runConfigSnapshotSchema: z.ZodObject<{
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
/**
 * R4a 有效恢复约束快照：写入 `turn.started` / checkpoint 正文的是解析后的**实际生效值**
 * （限额、实际 denied / snapshot-ignored prefixes、进程沙箱已规范化并过滤的选项、宿主
 * 非只读工具授权），不是调用者传入的可选覆盖。摘要（`baseConfigDigest`）不能证明调用者
 * 当时没有额外传入沙箱 / 授权选项，因此恢复继续执行只认这份字段。
 *
 * 该字段是可选兼容扩展：旧 `schemaVersion=1` 记录没有它，仍按原正文读取、校验与
 * terminal 回放；未知 version 由 `parseEffectiveRecoveryConstraints` 显式
 * `version_unsupported`（读取期不把整条记录判成损坏）。不要在这里保存 secret / API key。
 */
export declare const effectiveRecoveryConstraintsSchema: z.ZodObject<{
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
}, z.core.$strict>;
/**
 * 可重建的会话历史绑定：`throughPosition` 指向开始当前 Turn 前最后已完成轮次的稳定边界。
 *
 * schemaVersion=1 的旧记录没有该字段，含义固定为 `current_turn`。这里对版本/模式只做
 * 形状校验而不锁死字面量：遇到本读取器无法解释的契约变体，由 `session-history.ts` 显式
 * 报 `version_unsupported`，而不是把记录改写成「补字段」或静默当成缺省。
 */
export declare const contextBasisSchema: z.ZodObject<{
    version: z.ZodNumber;
    mode: z.ZodString;
    throughPosition: z.ZodNumber;
}, z.core.$strict>;
export declare const sessionRecordSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    recordType: z.ZodLiteral<"session.created">;
    payload: z.ZodObject<{
        sessionId: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strict>;
    recordId: z.ZodString;
    sessionId: z.ZodString;
    position: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    recordedAt: z.ZodString;
    checksum: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    recordType: z.ZodLiteral<"turn.started">;
    payload: z.ZodObject<{
        run: z.ZodObject<{
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
    }, z.core.$strict>;
    recordId: z.ZodString;
    sessionId: z.ZodString;
    position: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    recordedAt: z.ZodString;
    checksum: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    recordType: z.ZodLiteral<"agent.event">;
    payload: z.ZodObject<{
        event: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                    runtime: "runtime";
                    tool_executor: "tool_executor";
                    hook: "hook";
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
            }, z.core.$strict>;
        }, z.core.$strict>], "type">;
    }, z.core.$strict>;
    recordId: z.ZodString;
    sessionId: z.ZodString;
    position: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    recordedAt: z.ZodString;
    checksum: z.ZodString;
}, z.core.$strict>], "recordType">;
export declare const sessionRecordDraftSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    recordType: z.ZodLiteral<"turn.started">;
    payload: z.ZodObject<{
        run: z.ZodObject<{
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
    }, z.core.$strict>;
    recordId: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    recordedAt: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    recordType: z.ZodLiteral<"agent.event">;
    payload: z.ZodObject<{
        event: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
                    runtime: "runtime";
                    tool_executor: "tool_executor";
                    hook: "hook";
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
            }, z.core.$strict>;
        }, z.core.$strict>], "type">;
    }, z.core.$strict>;
    recordId: z.ZodString;
    schemaVersion: z.ZodLiteral<1>;
    recordedAt: z.ZodString;
}, z.core.$strict>], "recordType">;
export declare const sessionHeaderSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    sessionId: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    revision: z.ZodNumber;
    activeRunId: z.ZodNullable<z.ZodString>;
    activeTurnId: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export type WorkspaceReference = z.infer<typeof workspaceReferenceSchema>;
export type RunConfigSnapshot = z.infer<typeof runConfigSnapshotSchema>;
export type RawContextBasis = z.infer<typeof contextBasisSchema>;
/**
 * 本读取器唯一支持的有效约束版本（version=1）。字段形状与冻结的
 * `EffectiveRecoveryConstraints` 一致，可直接互相赋值。
 */
export interface EffectiveRecoveryConstraintsRecord {
    readonly version: 1;
    readonly limits: RunLimits;
    readonly workspace: {
        readonly deniedPrefixes: readonly string[];
        readonly snapshotIgnoredPrefixes: readonly string[];
        readonly consistencyMode: "session" | "workspace" | "strict";
        readonly maxFileBytes: number;
    };
    readonly process: {
        readonly protectedPaths: readonly string[];
        readonly readOnlyPaths: readonly string[];
        readonly executablePath: string;
    };
    readonly hostAuthorizedTools: readonly string[];
}
/** 本读取器唯一支持的会话历史绑定（version=1 且 mode=session_history）。 */
export type ContextBasis = {
    readonly version: 1;
    readonly mode: "session_history";
    readonly throughPosition: number;
};
export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type SessionRecordDraft = z.infer<typeof sessionRecordDraftSchema>;
export type SessionHeader = z.infer<typeof sessionHeaderSchema>;
export type StoreErrorCode = "not_found" | "already_exists" | "conflict" | "idempotency_conflict" | "invalid_record" | "version_unsupported" | "corrupt" | "busy" | "cancelled" | "closed" | "internal";
export declare class StoreError extends Error {
    readonly code: StoreErrorCode;
    readonly lastTrustedPosition: number | null;
    constructor(code: StoreErrorCode, message: string, lastTrustedPosition?: number | null);
}
export interface StoreCallOptions {
    readonly signal: AbortSignal;
}
export interface CreateSessionInput {
    readonly sessionId: string;
    readonly recordId: string;
    readonly createdAt: string;
}
export interface AppendSessionResult {
    readonly revision: number;
    readonly positions: readonly number[];
    readonly records: readonly SessionRecord[];
}
export interface ReadSessionPage {
    readonly revision: number;
    readonly records: readonly SessionRecord[];
    readonly nextPosition: number | null;
}
export interface SessionListPage {
    readonly sessions: readonly SessionHeader[];
    readonly nextCursor: string | null;
}
export interface SessionStorePort {
    create(input: Readonly<CreateSessionInput>, options: Readonly<StoreCallOptions>): Promise<SessionHeader>;
    append(sessionId: string, expectedRevision: number, records: readonly Readonly<SessionRecordDraft>[], options: Readonly<StoreCallOptions>): Promise<AppendSessionResult>;
    read(sessionId: string, afterPosition: number, limit: number, options: Readonly<StoreCallOptions>): Promise<ReadSessionPage>;
    get(sessionId: string, options: Readonly<StoreCallOptions>): Promise<SessionHeader>;
    list(cursor: string | null, limit: number, options: Readonly<StoreCallOptions>): Promise<SessionListPage>;
    close(): Promise<void>;
}
export declare function canonicalJson(value: unknown): string;
export declare function checksum(value: unknown): string;
export declare function computeSessionRecordChecksum(record: Omit<SessionRecord, "checksum">): string;
export declare function assertSessionRecordChecksum(record: SessionRecord): void;
/**
 * 解析并校验一份有效恢复约束：未知 version 显式 `version_unsupported`，形状不合法报
 * `invalid_record`。调用方在继续执行前必须先用原记录（turn.started）的这份字段做核对，
 * 不得用调用者本次参数或摘要替代。
 */
export declare function parseEffectiveRecoveryConstraints(value: unknown): EffectiveRecoveryConstraintsRecord;
//# sourceMappingURL=session-store-port.d.ts.map