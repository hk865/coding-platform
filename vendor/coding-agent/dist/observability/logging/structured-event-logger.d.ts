/**
 * 模块职责：把 AgentEvent 脱敏、截断并序列化为单行结构化日志。
 *
 * 设计边界：它是 best_effort 可观测性输出，失败不应改变 Agent 业务状态。
 * 关键流程：递归清理敏感键、循环引用和超长字符串，再把安全 JSON 交给注入的写入函数。
 */
import type { EventSinkPort } from "../../core/ports/event_sink/event-sink-port.js";
export interface StructuredLoggerOptions {
    readonly sinkId?: string;
    readonly maxStringLength?: number;
    readonly sensitiveKeyPattern?: RegExp;
}
export declare class StructuredEventLogger implements EventSinkPort {
    #private;
    private readonly writeLine;
    readonly sinkId: string;
    readonly delivery: "best_effort";
    constructor(writeLine: (line: string) => void | Promise<void>, options?: StructuredLoggerOptions);
    publish(event: Parameters<EventSinkPort["publish"]>[0], options: Parameters<EventSinkPort["publish"]>[1]): Promise<void>;
}
//# sourceMappingURL=structured-event-logger.d.ts.map