function sanitize(value, maxStringLength, sensitiveKeyPattern, seen) {
    if (typeof value === "string") {
        return value.length <= maxStringLength ? value : `${value.slice(0, maxStringLength)}…`;
    }
    if (value === null || typeof value !== "object")
        return value;
    if (seen.has(value))
        return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => sanitize(item, maxStringLength, sensitiveKeyPattern, seen));
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        output[key] = sensitiveKeyPattern.test(key)
            ? "[redacted]"
            : sanitize(item, maxStringLength, sensitiveKeyPattern, seen);
        sensitiveKeyPattern.lastIndex = 0;
    }
    return output;
}
export class StructuredEventLogger {
    writeLine;
    sinkId;
    delivery = "best_effort";
    #maxStringLength;
    #sensitiveKeyPattern;
    constructor(writeLine, options = {}) {
        this.writeLine = writeLine;
        this.sinkId = options.sinkId ?? "structured-event-logger";
        this.#maxStringLength = options.maxStringLength ?? 2_048;
        this.#sensitiveKeyPattern =
            options.sensitiveKeyPattern ??
                /api[_-]?key|authorization|cookie|credential|password|secret|token/i;
    }
    async publish(event, options) {
        if (options.signal.aborted)
            throw options.signal.reason;
        const safe = sanitize(event, this.#maxStringLength, this.#sensitiveKeyPattern, new WeakSet());
        await this.writeLine(JSON.stringify(safe));
    }
}
//# sourceMappingURL=structured-event-logger.js.map