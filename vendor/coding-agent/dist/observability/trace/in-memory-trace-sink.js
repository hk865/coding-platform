export class InMemoryTraceSink {
    sinkId;
    delivery = "best_effort";
    #records = [];
    constructor(sinkId = "in-memory-trace") {
        this.sinkId = sinkId;
    }
    get records() {
        return structuredClone(this.#records);
    }
    async publish(event, options) {
        if (options.signal.aborted)
            throw options.signal.reason;
        this.#records.push({
            schemaVersion: 1,
            eventId: event.meta.eventId,
            runId: event.meta.runId,
            turnId: event.meta.turnId,
            sequence: event.meta.sequence,
            type: event.type,
            occurredAt: event.meta.occurredAt,
            elapsedMs: event.meta.elapsedMs,
        });
    }
}
//# sourceMappingURL=in-memory-trace-sink.js.map