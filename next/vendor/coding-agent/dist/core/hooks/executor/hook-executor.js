import { validateHookDecision } from "../protocol/hook-protocol.js";
import { HookRegistry } from "../registry/hook-registry.js";
export class HookExecutionError extends Error {
    code;
    hookId;
    constructor(code, message, hookId) {
        super(message);
        this.code = code;
        this.hookId = hookId;
        this.name = "HookExecutionError";
    }
}
async function invokeWithTimeout(hook, signal, timeoutMs, invoke) {
    if (signal.aborted)
        throw signal.reason;
    if (timeoutMs === null)
        return invoke(signal);
    const timeoutController = new AbortController();
    const combined = AbortSignal.any([signal, timeoutController.signal]);
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            timeoutController.abort();
            reject(new HookExecutionError("hook_timeout", `Hook ${hook.hookId} 超时`, hook.hookId));
        }, timeoutMs);
        timer.unref();
    });
    try {
        return await Promise.race([invoke(combined), timeout]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function assertDecision(hook, invocation, decision) {
    const validation = validateHookDecision(invocation, decision);
    if (!validation.ok) {
        throw new HookExecutionError("hook_invalid_result", `${validation.violation.code}: ${validation.violation.message}`, hook.hookId);
    }
}
export class HookExecutor {
    #registry;
    #timeoutMs;
    constructor(registry = new HookRegistry(), timeoutMs = null) {
        if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)) {
            throw new RangeError("Hook timeout 必须是正安全整数或 null");
        }
        this.#registry = registry.freeze();
        this.#timeoutMs = timeoutMs;
    }
    async beforeModel(state, request, signal) {
        let value = structuredClone(request);
        let modified = false;
        for (const hook of this.#registry.list("before_model")) {
            const invocation = {
                schemaVersion: 1,
                point: "before_model",
                state,
                request: value,
            };
            let decision;
            try {
                decision = await invokeWithTimeout(hook, signal, this.#timeoutMs, (hookSignal) => hook.execute(invocation, { signal: hookSignal }));
            }
            catch (error) {
                if (error instanceof HookExecutionError)
                    throw error;
                throw new HookExecutionError("hook_failed", error instanceof Error ? error.message : "Hook 执行失败", hook.hookId);
            }
            assertDecision(hook, invocation, decision);
            const typed = decision;
            if (typed.kind === "modify") {
                value = structuredClone(typed.value);
                modified = true;
            }
            else if (typed.kind !== "continue")
                return typed;
        }
        return modified
            ? { point: "before_model", kind: "modify", value }
            : { point: "before_model", kind: "continue" };
    }
    async beforeTool(state, call, signal) {
        let value = structuredClone(call);
        let modified = false;
        for (const hook of this.#registry.list("before_tool")) {
            const invocation = {
                schemaVersion: 1,
                point: "before_tool",
                state,
                call: value,
            };
            let decision;
            try {
                decision = await invokeWithTimeout(hook, signal, this.#timeoutMs, (hookSignal) => hook.execute(invocation, { signal: hookSignal }));
            }
            catch (error) {
                if (error instanceof HookExecutionError)
                    throw error;
                throw new HookExecutionError("hook_failed", error instanceof Error ? error.message : "Hook 执行失败", hook.hookId);
            }
            assertDecision(hook, invocation, decision);
            const typed = decision;
            if (typed.kind === "modify") {
                value = structuredClone(typed.value);
                modified = true;
            }
            else if (typed.kind !== "continue")
                return typed;
        }
        return modified
            ? { point: "before_tool", kind: "modify", value }
            : { point: "before_tool", kind: "continue" };
    }
    async afterTool(state, result, signal) {
        let presentation = { output: structuredClone(result.output) };
        let modified = false;
        for (const hook of this.#registry.list("after_tool")) {
            const currentResult = { ...result, output: presentation.output };
            const invocation = {
                schemaVersion: 1,
                point: "after_tool",
                state,
                result: currentResult,
            };
            let decision;
            try {
                decision = await invokeWithTimeout(hook, signal, this.#timeoutMs, (hookSignal) => hook.execute(invocation, { signal: hookSignal }));
            }
            catch (error) {
                if (error instanceof HookExecutionError)
                    throw error;
                throw new HookExecutionError("hook_failed", error instanceof Error ? error.message : "Hook 执行失败", hook.hookId);
            }
            assertDecision(hook, invocation, decision);
            const typed = decision;
            if (typed.kind === "modify") {
                presentation = structuredClone(typed.value);
                modified = true;
            }
            else if (typed.kind !== "continue")
                return typed;
        }
        return modified
            ? { point: "after_tool", kind: "modify", value: presentation }
            : { point: "after_tool", kind: "continue" };
    }
}
//# sourceMappingURL=hook-executor.js.map