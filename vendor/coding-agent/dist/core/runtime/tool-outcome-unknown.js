const REASON_TEXT = {
    process_interrupted: "工具已经开始执行，但 Runtime 进程中断，没有持久化的执行结果。该工具可能已经产生副作用；系统不能自动重试。请检查工作区或外部系统的实际状态，确认没有副作用或副作用已消除后，才能安全地重新执行。",
    cancelled_while_running: "工具已经开始执行，但在运行期间被强制取消，且没有返回可用的取消结果。该工具可能已经产生副作用；系统不能自动重试。请检查工作区或外部系统的实际状态，确认没有副作用或副作用已消除后，才能安全地重新执行。",
};
export function synthesizeOutcomeUnknownResult(call, reason, effectClass) {
    return {
        schemaVersion: 1,
        callId: call.callId,
        status: "error",
        error: {
            code: "outcome_unknown",
            message: `工具 ${call.name} 的结果未知（${reason}）`,
            retryable: false,
        },
        output: [
            {
                kind: "text",
                text: REASON_TEXT[reason],
            },
        ],
        effects: {
            sideEffect: effectClass === "read_only" ? "none" : "possible",
            changedPaths: [],
            workspaceRevision: null,
            artifactRefs: [],
        },
    };
}
export function outcomeUnknownPayload(call, reason, effectClass, recordedCallEventId) {
    return {
        callId: call.callId,
        toolName: call.name,
        effectClass,
        reason,
        retryPolicy: "never_automatic",
        recordedCallEventId,
        synthesizedResult: synthesizeOutcomeUnknownResult(call, reason, effectClass),
    };
}
//# sourceMappingURL=tool-outcome-unknown.js.map