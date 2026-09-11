/**
 * 模块职责：定义 AgentEvent 向外投递的统一端口，以及 required 与 best_effort 两种等级。
 *
 * 设计边界：这里只规定投递语义，不安排顺序、超时或失败恢复。
 * 关键流程：实现声明 sinkId 和 delivery，协调器据此决定失败是否阻断状态提交。
 */
import { z } from "zod";

import type { AgentEvent } from "../../runtime/events/agent-events.js";

export const eventSinkDeliverySchema = z.enum(["best_effort", "required"]);

export type EventSinkDelivery = z.infer<typeof eventSinkDeliverySchema>;

export interface EventSinkPublishOptions {
  readonly signal: AbortSignal;
}

export interface EventSinkPort {
  readonly sinkId: string;
  readonly delivery: EventSinkDelivery;
  publish(event: Readonly<AgentEvent>, options: Readonly<EventSinkPublishOptions>): Promise<void>;
}

export function isRequiredEventSink(sink: Pick<EventSinkPort, "delivery">): boolean {
  return sink.delivery === "required";
}
