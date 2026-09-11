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

function sanitize(
  value: unknown,
  maxStringLength: number,
  sensitiveKeyPattern: RegExp,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return value.length <= maxStringLength ? value : `${value.slice(0, maxStringLength)}…`;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, maxStringLength, sensitiveKeyPattern, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = sensitiveKeyPattern.test(key)
      ? "[redacted]"
      : sanitize(item, maxStringLength, sensitiveKeyPattern, seen);
    sensitiveKeyPattern.lastIndex = 0;
  }
  return output;
}

export class StructuredEventLogger implements EventSinkPort {
  readonly sinkId: string;
  readonly delivery = "best_effort" as const;
  readonly #maxStringLength: number;
  readonly #sensitiveKeyPattern: RegExp;

  constructor(
    private readonly writeLine: (line: string) => void | Promise<void>,
    options: StructuredLoggerOptions = {},
  ) {
    this.sinkId = options.sinkId ?? "structured-event-logger";
    this.#maxStringLength = options.maxStringLength ?? 2_048;
    this.#sensitiveKeyPattern =
      options.sensitiveKeyPattern ??
      /api[_-]?key|authorization|cookie|credential|password|secret|token/i;
  }

  async publish(
    event: Parameters<EventSinkPort["publish"]>[0],
    options: Parameters<EventSinkPort["publish"]>[1],
  ): Promise<void> {
    if (options.signal.aborted) throw options.signal.reason;
    const safe = sanitize(event, this.#maxStringLength, this.#sensitiveKeyPattern, new WeakSet());
    await this.writeLine(JSON.stringify(safe));
  }
}
