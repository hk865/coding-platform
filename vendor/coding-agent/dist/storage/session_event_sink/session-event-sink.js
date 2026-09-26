/**
 * required 持久化屏障：只有事件成功追加到 Session 后，Runner 才会推进状态
 * 或启动后续副作用；revision/position 同时作为 checkpoint 的已提交游标。
 */
export class SessionEventSink {
    store;
    sessionId;
    sinkId;
    delivery = "required";
    #revision;
    #lastPosition;
    constructor(store, sessionId, revision, lastPosition, sinkId) {
        this.store = store;
        this.sessionId = sessionId;
        this.#revision = revision;
        this.#lastPosition = lastPosition;
        this.sinkId = sinkId;
    }
    static async connect(store, sessionId, options) {
        const header = await store.get(sessionId, options);
        let position = 0;
        while (true) {
            const page = await store.read(sessionId, position, 256, options);
            position = page.records.at(-1)?.position ?? position;
            if (page.nextPosition === null)
                break;
        }
        return new SessionEventSink(store, sessionId, header.revision, position, options.sinkId ?? "00-session-store");
    }
    get revision() {
        return this.#revision;
    }
    get lastPosition() {
        return this.#lastPosition;
    }
    async publish(event, options) {
        const result = await this.store.append(this.sessionId, this.#revision, [
            {
                recordId: `agent-event:${event.meta.eventId}`,
                recordType: "agent.event",
                schemaVersion: 1,
                recordedAt: event.meta.occurredAt,
                payload: { event },
            },
        ], options);
        this.#revision = result.revision;
        this.#lastPosition = result.positions[0];
    }
}
//# sourceMappingURL=session-event-sink.js.map