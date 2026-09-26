/**
 * 模块职责：协调 AgentEvent 向多个 sink 的有序投递，并决定状态何时可以提交。
 *
 * 设计边界：它不生成事件，也不执行 reducer 之外的业务副作用。
 * 关键流程：先计算候选状态并投递 required sink；全部成功后再提交状态并投递 best_effort sink。
 */
import type { EventSinkPort } from "../../ports/event_sink/event-sink-port.js";
import type { AgentEvent } from "../events/agent-events.js";
import type { RunState } from "../state/run-state.js";
export declare class RequiredSinkError extends Error {
    readonly sinkId: string;
    readonly cause: unknown;
    readonly failedSinkIds: readonly string[];
    constructor(sinkId: string, cause: unknown, failedSinkIds?: readonly string[]);
}
export interface EventDeliveryDiagnostic {
    readonly sinkId: string;
    readonly eventId: string;
    readonly message: string;
}
export declare class EventDeliveryCoordinator {
    #private;
    constructor(sinks?: readonly EventSinkPort[], onDiagnostic?: (diagnostic: EventDeliveryDiagnostic) => void, publishTimeoutMs?: number);
    commit(state: Readonly<RunState>, event: Readonly<AgentEvent>, signal: AbortSignal, excludedSinkIds?: ReadonlySet<string>): Promise<RunState>;
}
//# sourceMappingURL=event-delivery-coordinator.d.ts.map