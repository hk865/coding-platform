/**
 * 模块职责：在内存中收集精简的事件时间线，便于测试、诊断和流程展示。
 *
 * 设计边界：只保留身份、序号、类型和耗时等元数据，不保存完整事件载荷。
 * 关键流程：收到事件后复制必要字段追加记录；读取时返回深拷贝，避免外部修改内部状态。
 */
import type {
  EventSinkPublishOptions,
  EventSinkPort,
} from "../../core/ports/event_sink/event-sink-port.js";
type SinkEvent = Parameters<EventSinkPort["publish"]>[0];

export interface TraceRecord {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly type: SinkEvent["type"];
  readonly occurredAt: string;
  readonly elapsedMs: number;
}

export class InMemoryTraceSink implements EventSinkPort {
  readonly sinkId: string;
  readonly delivery = "best_effort" as const;
  readonly #records: TraceRecord[] = [];

  constructor(sinkId = "in-memory-trace") {
    this.sinkId = sinkId;
  }

  get records(): readonly TraceRecord[] {
    return structuredClone(this.#records);
  }

  async publish(event: SinkEvent, options: Readonly<EventSinkPublishOptions>): Promise<void> {
    if (options.signal.aborted) throw options.signal.reason;
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
