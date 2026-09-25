export class CancellationController {
    #controller = new AbortController();
    #reason = null;
    get signal() {
        return this.#controller.signal;
    }
    get reason() {
        return this.#reason;
    }
    cancel(reason) {
        if (this.#reason !== null)
            return;
        this.#reason = reason;
        this.#controller.abort(reason);
    }
    link(signal, reason = "caller_requested") {
        if (!signal)
            return () => undefined;
        const onAbort = () => this.cancel(reason);
        if (signal.aborted)
            onAbort();
        else
            signal.addEventListener("abort", onAbort, { once: true });
        return () => signal.removeEventListener("abort", onAbort);
    }
}
export function isAbortError(error) {
    return error instanceof Error && error.name === "AbortError";
}
//# sourceMappingURL=cancellation-controller.js.map