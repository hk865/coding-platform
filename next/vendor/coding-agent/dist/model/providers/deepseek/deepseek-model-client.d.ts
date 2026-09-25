import { type ModelCallOptions, type ModelClientPort, type ModelEvent, type ModelRequest } from "../../../core/ports/model_client/model-client-port.js";
export declare const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";
export interface DeepSeekChatTransport {
    create(body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<AsyncIterable<unknown>>;
}
export interface DeepSeekModelClientOptions {
    readonly model: string;
    readonly transport: DeepSeekChatTransport;
    readonly thinking?: "enabled" | "disabled";
    readonly reasoningEffort?: "low" | "high" | "max";
}
export declare class DeepSeekSdkChatTransport implements DeepSeekChatTransport {
    #private;
    constructor(options: {
        readonly apiKey: string;
        readonly baseUrl?: string;
    });
    create(body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<AsyncIterable<unknown>>;
}
export declare class DeepSeekModelClient implements ModelClientPort {
    #private;
    constructor(options: Readonly<DeepSeekModelClientOptions>);
    stream(candidate: Readonly<ModelRequest>, options: Readonly<ModelCallOptions>): AsyncIterable<ModelEvent>;
}
//# sourceMappingURL=deepseek-model-client.d.ts.map