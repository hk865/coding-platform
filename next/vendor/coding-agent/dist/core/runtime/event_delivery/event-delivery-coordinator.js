import { reduceRunState } from "../reducer/run-state-reducer.js";
export class RequiredSinkError extends Error {
    sinkId;
    cause;
    failedSinkIds;
    constructor(sinkId, cause, failedSinkIds = [sinkId]) {
        super(`Required EventSink ${failedSinkIds.join(", ")} 投递失败`);
        this.sinkId = sinkId;
        this.cause = cause;
        this.failedSinkIds = failedSinkIds;
        this.name = "RequiredSinkError";
    }
}
export class EventDeliveryCoordinator {
    #sinks;
    #onDiagnostic;
    #publishTimeoutMs;
    constructor(sinks = [], onDiagnostic, publishTimeoutMs = 30_000) {
        const ids = sinks.map((sink) => sink.sinkId);
        if (new Set(ids).size !== ids.length)
            throw new Error("EventSink sinkId 必须唯一");
        if (!Number.isSafeInteger(publishTimeoutMs) || publishTimeoutMs <= 0) {
            throw new RangeError("EventSink timeout 必须为正安全整数");
        }
        this.#sinks = [...sinks].sort((left, right) => left.sinkId.localeCompare(right.sinkId));
        this.#onDiagnostic = onDiagnostic;
        this.#publishTimeoutMs = publishTimeoutMs;
    }
    async #publish(sink, event, signal) {
        if (signal.aborted)
            throw signal.reason ?? new Error("EventSink 投递已取消");
        const timeoutController = new AbortController();
        const combined = AbortSignal.any([signal, timeoutController.signal]);
        let timer;
        const interrupted = new Promise((_, reject) => {
            const rejectOnAbort = () => reject(combined.reason ?? new Error("EventSink 投递已取消"));
            combined.addEventListener("abort", rejectOnAbort, { once: true });
            timer = setTimeout(() => timeoutController.abort(new Error(`EventSink ${sink.sinkId} 投递超时`)), this.#publishTimeoutMs);
            timer.unref?.();
        });
        try {
            await Promise.race([sink.publish(event, { signal: combined }), interrupted]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async commit(state, event, signal, excludedSinkIds = new Set()) {
        const candidate = reduceRunState(state, event);
        const requiredFailures = [];
        // 即使一个 required sink 失败，也继续把同一候选事实投递给其余 required sink，
        // 这样健康 sink 后续接收 run.failed 时不会出现事件 sequence 缺口。
        for (const sink of this.#sinks) {
            if (sink.delivery !== "required" || excludedSinkIds.has(sink.sinkId))
                continue;
            try {
                await this.#publish(sink, event, signal);
            }
            catch (error) {
                requiredFailures.push({ sinkId: sink.sinkId, cause: error });
            }
        }
        if (requiredFailures.length > 0) {
            const first = requiredFailures[0];
            throw new RequiredSinkError(first.sinkId, first.cause, requiredFailures.map((failure) => failure.sinkId));
        }
        for (const sink of this.#sinks) {
            if (sink.delivery !== "best_effort" || excludedSinkIds.has(sink.sinkId))
                continue;
            try {
                await this.#publish(sink, event, signal);
            }
            catch (error) {
                this.#onDiagnostic?.({
                    sinkId: sink.sinkId,
                    eventId: event.meta.eventId,
                    message: error instanceof Error ? error.message : "Best-effort sink 失败",
                });
            }
        }
        return candidate;
    }
}
//# sourceMappingURL=event-delivery-coordinator.js.map