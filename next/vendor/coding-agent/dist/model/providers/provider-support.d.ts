/** Provider 适配器共享的安全错误分类、事件构造与窄化工具。 */
import type { ModelEvent, ModelUsage } from "../../core/ports/model_client/model-client-port.js";
export interface ProviderFailure {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
}
export declare function asRecord(value: unknown): Record<string, unknown> | null;
export declare function stringField(record: Record<string, unknown>, key: string): string | null;
export declare function numberField(record: Record<string, unknown>, key: string): number | null;
export declare function classifyProviderError(providerId: string, error: unknown): ProviderFailure;
export declare function zeroCostUsage(inputTokens: number, outputTokens: number, cachedInputTokens?: number): ModelUsage;
type ModelEventPayload = ModelEvent extends infer Event ? Event extends ModelEvent ? Omit<Event, "schemaVersion" | "requestId" | "sequence"> : never : never;
export declare function createEventFactory(requestId: string): (event: ModelEventPayload) => ModelEvent;
export {};
//# sourceMappingURL=provider-support.d.ts.map