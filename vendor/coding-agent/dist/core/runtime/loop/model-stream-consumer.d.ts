import type { ModelClientPort, ModelRequest, ModelUsage } from "../../ports/model_client/model-client-port.js";
import type { ToolCall } from "../../ports/tool_executor/tool-executor-port.js";
export type ModelStreamResult = {
    readonly kind: "completed";
    readonly reason: "final_answer" | "tool_calls";
    readonly text: string;
    readonly reasoning: string;
    readonly toolCalls: readonly ToolCall[];
    readonly usage: ModelUsage | null;
} | {
    readonly kind: "truncated";
    readonly code: string;
    readonly message: string;
    readonly usage: ModelUsage | null;
} | {
    readonly kind: "error";
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly usage: ModelUsage | null;
} | {
    readonly kind: "cancelled";
    readonly message: string;
    readonly usage: ModelUsage | null;
} | {
    readonly kind: "protocol_error";
    readonly code: string;
    readonly message: string;
};
export interface ModelStreamConsumerOptions {
    readonly signal: AbortSignal;
    readonly maxBufferedCharacters?: number;
    readonly maxEvents?: number;
    readonly onTextDelta?: (delta: string) => void;
    readonly onReasoningDelta?: (delta: string) => void;
}
export declare function consumeModelStream(client: ModelClientPort, request: Readonly<ModelRequest>, options: Readonly<ModelStreamConsumerOptions>): Promise<ModelStreamResult>;
//# sourceMappingURL=model-stream-consumer.d.ts.map