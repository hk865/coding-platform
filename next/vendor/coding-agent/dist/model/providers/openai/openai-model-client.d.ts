import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { type ModelCallOptions, type ModelClientPort, type ModelEvent, type ModelRequest } from "../../../core/ports/model_client/model-client-port.js";
export interface OpenAIResponsesTransport {
    create(body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<AsyncIterable<unknown>>;
}
export interface OpenAIModelClientOptions {
    readonly model: string;
    readonly transport: OpenAIResponsesTransport;
}
export declare class OpenAISdkResponsesTransport implements OpenAIResponsesTransport {
    #private;
    constructor(options: {
        readonly apiKey: string;
        readonly baseUrl?: string;
        readonly organization?: string;
        readonly project?: string;
    });
    create(body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<AsyncIterable<ResponseStreamEvent>>;
}
export declare class OpenAIModelClient implements ModelClientPort {
    #private;
    constructor(options: Readonly<OpenAIModelClientOptions>);
    stream(candidate: Readonly<ModelRequest>, options: Readonly<ModelCallOptions>): AsyncIterable<ModelEvent>;
}
//# sourceMappingURL=openai-model-client.d.ts.map