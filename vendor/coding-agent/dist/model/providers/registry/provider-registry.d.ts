/** 显式 Provider 注册表：只按配置选择，不做自动路由或隐式回退。 */
import { z } from "zod";
import type { ModelClientPort } from "../../../core/ports/model_client/model-client-port.js";
export declare const providerIdSchema: z.ZodEnum<{
    openai: "openai";
    deepseek: "deepseek";
}>;
export type ProviderId = z.infer<typeof providerIdSchema>;
export interface ProviderCapabilities {
    readonly streaming: true;
    readonly toolCalls: true;
    readonly usage: true;
}
export interface ProviderCreateContext {
    readonly apiKey: string;
    readonly model: string;
    readonly baseUrl?: string;
    readonly options?: Readonly<Record<string, unknown>>;
}
export interface ProviderDefinition {
    readonly id: ProviderId;
    readonly secretEnvironmentVariable: string;
    readonly defaultBaseUrl: string;
    readonly capabilities: ProviderCapabilities;
    create(context: Readonly<ProviderCreateContext>): ModelClientPort;
}
export declare class ProviderRegistry {
    #private;
    register(definition: ProviderDefinition): this;
    get(id: string): ProviderDefinition;
    list(): readonly ProviderDefinition[];
    create(id: string, context: Readonly<ProviderCreateContext>): ModelClientPort;
}
//# sourceMappingURL=provider-registry.d.ts.map