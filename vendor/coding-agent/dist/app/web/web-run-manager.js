/** Web UI 的单任务控制层：在内存中桥接浏览器事件、审批与现有 App Composition。 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_MAX_MODEL_REQUESTS, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_MAX_TOOL_CALLS, DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS, loadAppConfig, } from "../composition/app-config.js";
import { runCodingAgent } from "../composition/composition-root.js";
import { resumeCodingAgent } from "../composition/resume-composition.js";
import { WebEventProjectionSink } from "./web-event-projection.js";
const webRunRequestSchema = z
    .object({
    mode: z.enum(["run", "resume"]).default("run"),
    workspaceRoot: z.string().trim().min(1).max(4096),
    sessionId: z.string().trim().max(256).optional(),
    provider: z.enum(["openai", "deepseek"]),
    model: z.string().trim().min(1).max(256),
    apiKey: z.string().trim().min(1).max(16_384),
    input: z.string().max(200_000).default(""),
    thinking: z.enum(["enabled", "disabled"]).default("enabled"),
    reasoningEffort: z.enum(["low", "high", "max"]).optional(),
    maxOutputTokens: z.number().int().positive().max(131_072).default(DEFAULT_MAX_OUTPUT_TOKENS),
    maxModelRequests: z.number().int().positive().max(10_000).default(DEFAULT_MAX_MODEL_REQUESTS),
    maxToolCalls: z.number().int().positive().max(100_000).default(DEFAULT_MAX_TOOL_CALLS),
    consistencyMode: z.enum(["session", "workspace", "strict"]).default("session"),
})
    .strict()
    .superRefine((value, context) => {
    if (value.mode === "run" && value.input.trim().length === 0) {
        context.addIssue({ code: "custom", path: ["input"], message: "任务内容不能为空" });
    }
    if (value.mode === "resume" && !value.sessionId) {
        context.addIssue({ code: "custom", path: ["sessionId"], message: "恢复需要 Session ID" });
    }
    if (value.thinking === "disabled" && value.reasoningEffort) {
        context.addIssue({
            code: "custom",
            path: ["reasoningEffort"],
            message: "关闭推理时不能设置推理强度",
        });
    }
});
export class WebRunConflictError extends Error {
    constructor(message = "当前已有任务运行，请先等待完成或取消") {
        super(message);
        this.name = "WebRunConflictError";
    }
}
export class WebRunNotFoundError extends Error {
    constructor() {
        super("任务不存在");
        this.name = "WebRunNotFoundError";
    }
}
async function configForWeb(request) {
    const workspaceRoot = path.resolve(request.workspaceRoot);
    const loaded = await loadAppConfig({
        cwd: workspaceRoot,
        overrides: { cwd: workspaceRoot, provider: request.provider, model: request.model },
    });
    return {
        ...loaded,
        model: {
            ...loaded.model,
            maxOutputTokens: request.maxOutputTokens,
            options: request.provider === "deepseek"
                ? {
                    ...loaded.model.options,
                    thinking: request.thinking,
                    ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
                }
                : loaded.model.options,
        },
        runtime: {
            ...loaded.runtime,
            tokenBudget: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
            maxModelRequests: request.maxModelRequests,
            maxToolCalls: request.maxToolCalls,
        },
        workspace: { consistencyMode: request.consistencyMode },
        // 默认 Skill 属于 Agent 产品资源，不应被用户项目中同名目录意外遮蔽。
        skills: loaded.skills,
    };
}
export const executeWebRun = async (request, callbacks) => {
    const config = await configForWeb(request);
    const secretName = request.provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY";
    const shared = {
        config,
        workspaceRoot: path.resolve(request.workspaceRoot),
        sessionId: request.sessionId,
        secretSource: { get: (name) => (name === secretName ? request.apiKey : undefined) },
        approvalRequester: callbacks.approvalRequester,
        signal: callbacks.signal,
        onTextDelta: callbacks.onTextDelta,
        onReasoningDelta: callbacks.onReasoningDelta,
        onConfiguration: callbacks.onConfiguration,
        observerEventSinks: [callbacks.eventSink],
    };
    const result = request.mode === "resume"
        ? await resumeCodingAgent(shared)
        : await runCodingAgent({ ...shared, input: request.input });
    return { sessionId: result.sessionId, status: result.state.status };
};
export class WebRunManager {
    #tasks = new Map();
    #executor;
    #idFactory;
    #activeRunId = null;
    constructor(options = {}) {
        this.#executor = options.executor ?? executeWebRun;
        this.#idFactory = options.idFactory ?? randomUUID;
    }
    start(raw) {
        const request = webRunRequestSchema.parse(raw);
        if (this.#activeRunId)
            throw new WebRunConflictError();
        const runId = this.#idFactory();
        const sessionId = request.sessionId || this.#idFactory();
        const task = {
            runId,
            sessionId,
            controller: new AbortController(),
            events: [],
            subscribers: new Set(),
            approvals: new Map(),
            approvedTools: new Set(),
            deltaChunks: new Map(),
            startedAtMs: performance.now(),
            status: "starting",
            sequence: 0,
        };
        this.#tasks.set(runId, task);
        this.#activeRunId = runId;
        this.#emit(task, "run_started", { runId, sessionId, mode: request.mode });
        void this.#execute(task, { ...request, sessionId });
        return this.#snapshot(task);
    }
    snapshot(runId) {
        return this.#snapshot(this.#task(runId));
    }
    subscribe(runId, subscriber) {
        const task = this.#task(runId);
        for (const event of task.events)
            subscriber(event);
        task.subscribers.add(subscriber);
        return () => task.subscribers.delete(subscriber);
    }
    cancel(runId) {
        const task = this.#task(runId);
        if (!this.#isTerminal(task.status))
            task.controller.abort(new Error("web_user_cancelled"));
        return this.#snapshot(task);
    }
    answerApproval(runId, approvalId, decision) {
        const task = this.#task(runId);
        const pending = task.approvals.get(approvalId);
        if (!pending)
            throw new WebRunNotFoundError();
        task.approvals.delete(approvalId);
        task.status = "running";
        if (decision === "allow_for_run")
            task.approvedTools.add(pending.tool);
        pending.resolve({
            decision: decision === "deny" ? "deny" : "allow_once",
            reason: decision === "allow_for_run"
                ? "web_run_tool_grant"
                : decision === "allow_once"
                    ? "web_approved"
                    : "web_denied",
        });
        this.#emit(task, "approval_resolved", { approvalId, decision, tool: pending.tool });
        return this.#snapshot(task);
    }
    async #execute(task, request) {
        task.status = "running";
        const approvalRequester = {
            request: (approval, options) => this.#requestApproval(task, approval, options.signal),
        };
        const eventSink = new WebEventProjectionSink({
            sinkId: `web-runtime-${task.runId}`,
            contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
            maxModelRequests: request.maxModelRequests,
            maxToolCalls: request.maxToolCalls,
            emit: (projection) => this.#emit(task, "runtime_event", { ...projection }),
        });
        try {
            const result = await this.#executor(request, {
                signal: task.controller.signal,
                approvalRequester,
                onTextDelta: (delta, requestId) => this.#emitDelta(task, "text_delta", requestId, delta),
                onReasoningDelta: (delta, requestId) => this.#emitDelta(task, "reasoning_delta", requestId, delta),
                onConfiguration: (configuration) => this.#emit(task, "configuration", { ...configuration }),
                eventSink,
            });
            task.status = this.#normalizeFinalStatus(result.status);
            this.#emit(task, "run_finished", {
                runId: task.runId,
                sessionId: result.sessionId,
                status: task.status,
            });
        }
        catch (error) {
            task.status = task.controller.signal.aborted ? "cancelled" : "failed";
            const rawMessage = error instanceof Error ? error.message : "任务启动或执行失败";
            this.#emit(task, "run_failed", {
                status: task.status,
                message: rawMessage.split(request.apiKey).join("[REDACTED]"),
            });
        }
        finally {
            for (const pending of task.approvals.values())
                pending.reject(new Error("run_finished"));
            task.approvals.clear();
            if (this.#activeRunId === task.runId)
                this.#activeRunId = null;
        }
    }
    #requestApproval(task, approval, signal) {
        if (task.approvedTools.has(approval.tool)) {
            this.#emit(task, "approval_resolved", {
                approvalId: approval.requestId,
                decision: "allow_for_run",
                automatic: true,
                tool: approval.tool,
            });
            return Promise.resolve({ decision: "allow_once", reason: "web_run_tool_grant" });
        }
        task.status = "awaiting_approval";
        this.#emit(task, "approval_requested", {
            approvalId: approval.requestId,
            tool: approval.tool,
            effectClass: approval.effectClass,
            paths: approval.paths,
            cwd: approval.cwd,
            commandPreview: approval.commandPreview,
            argumentsPreview: approval.argumentsPreview,
            expiresAt: approval.expiresAt,
            policyReasonCode: approval.policyReasonCode,
            policyVersion: approval.policyVersion,
            workspaceRevision: approval.workspaceRevision,
        });
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                task.approvals.delete(approval.requestId);
                signal.removeEventListener("abort", onAbort);
            };
            const onAbort = () => {
                cleanup();
                reject(signal.reason);
            };
            task.approvals.set(approval.requestId, {
                tool: approval.tool,
                resolve: (response) => {
                    cleanup();
                    resolve(response);
                },
                reject: (reason) => {
                    cleanup();
                    reject(reason);
                },
            });
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted)
                onAbort();
        });
    }
    #emit(task, type, data) {
        const event = { sequence: (task.sequence += 1), type, data };
        task.events.push(event);
        if (task.events.length > 10_000)
            task.events.shift();
        for (const subscriber of task.subscribers)
            subscriber(event);
    }
    #emitDelta(task, type, requestId, delta) {
        const key = `${type}:${requestId}`;
        const chunkIndex = (task.deltaChunks.get(key) ?? 0) + 1;
        task.deltaChunks.set(key, chunkIndex);
        this.#emit(task, type, {
            requestId,
            delta,
            chunkIndex,
            elapsedMs: Math.max(0, Math.round(performance.now() - task.startedAtMs)),
        });
    }
    #task(runId) {
        const task = this.#tasks.get(runId);
        if (!task)
            throw new WebRunNotFoundError();
        return task;
    }
    #snapshot(task) {
        return { runId: task.runId, sessionId: task.sessionId, status: task.status };
    }
    #normalizeFinalStatus(status) {
        if (["completed", "cancelled", "limit_exceeded", "failed"].includes(status)) {
            return status;
        }
        return "failed";
    }
    #isTerminal(status) {
        return ["completed", "cancelled", "limit_exceeded", "failed"].includes(status);
    }
}
//# sourceMappingURL=web-run-manager.js.map