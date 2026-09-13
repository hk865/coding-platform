/** Provider 适配器共享的安全错误分类、事件构造与窄化工具。 */
import type { ModelEvent, ModelUsage } from "../../core/ports/model_client/model-client-port.js";

export interface ProviderFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function classifyProviderError(providerId: string, error: unknown): ProviderFailure {
  const record = asRecord(error);
  const status = record ? numberField(record, "status") : null;
  const name = error instanceof Error ? error.name : record ? stringField(record, "name") : null;

  if (name === "AbortError") {
    return { code: "request_cancelled", message: "模型请求已取消", retryable: false };
  }
  if (status === 401) {
    return { code: "authentication_failed", message: `${providerId} 鉴权失败`, retryable: false };
  }
  if (status === 403) {
    return { code: "permission_denied", message: `${providerId} 拒绝了请求`, retryable: false };
  }
  if (status === 429) {
    return { code: "rate_limited", message: `${providerId} 请求受到限流`, retryable: true };
  }
  if (status !== null && status >= 500) {
    return {
      code: "provider_unavailable",
      message: `${providerId} 服务暂时不可用`,
      retryable: true,
    };
  }
  return { code: "provider_request_failed", message: `${providerId} 请求失败`, retryable: false };
}

export function zeroCostUsage(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): ModelUsage {
  return {
    inputTokens: Math.max(0, Math.trunc(inputTokens)),
    outputTokens: Math.max(0, Math.trunc(outputTokens)),
    cachedInputTokens: Math.min(
      Math.max(0, Math.trunc(inputTokens)),
      Math.max(0, Math.trunc(cachedInputTokens)),
    ),
    costUsdMicros: null,
  };
}

type ModelEventPayload = ModelEvent extends infer Event
  ? Event extends ModelEvent
    ? Omit<Event, "schemaVersion" | "requestId" | "sequence">
    : never
  : never;

export function createEventFactory(requestId: string): (event: ModelEventPayload) => ModelEvent {
  let sequence = 0;
  return (event) =>
    ({
      schemaVersion: 1,
      requestId,
      sequence: ++sequence,
      ...event,
    }) as ModelEvent;
}
