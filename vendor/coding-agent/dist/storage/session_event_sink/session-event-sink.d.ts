/**
 * 模块职责：把每个 AgentEvent 作为 append-only Session 记录持久化，形成 required 提交屏障。
 *
 * 设计边界：它不计算下一状态；只有存储追加成功后 EventDeliveryCoordinator 才会提交状态。
 * 关键流程：连接时读取当前 revision 和 position，发布时带 expectedRevision 追加并更新本地游标。
 */
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
import type { SessionStorePort } from "../../core/ports/session_store/session-store-port.js";
type PersistedEvent = Parameters<EventSinkPort["publish"]>[0];
type PublishOptions = Parameters<EventSinkPort["publish"]>[1];
/**
 * required 持久化屏障：只有事件成功追加到 Session 后，Runner 才会推进状态
 * 或启动后续副作用；revision/position 同时作为 checkpoint 的已提交游标。
 */
export declare class SessionEventSink implements EventSinkPort {
    #private;
    private readonly store;
    readonly sessionId: string;
    readonly sinkId: string;
    readonly delivery: "required";
    private constructor();
    static connect(store: SessionStorePort, sessionId: string, options: Readonly<{
        signal: AbortSignal;
        sinkId?: string;
    }>): Promise<SessionEventSink>;
    get revision(): number;
    get lastPosition(): number;
    publish(event: PersistedEvent, options: PublishOptions): Promise<void>;
}
export {};
//# sourceMappingURL=session-event-sink.d.ts.map