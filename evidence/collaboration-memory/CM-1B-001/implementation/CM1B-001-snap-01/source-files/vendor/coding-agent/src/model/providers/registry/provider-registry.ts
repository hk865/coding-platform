/** 显式 Provider 注册表：只按配置选择，不做自动路由或隐式回退。 */
import { z } from "zod";

import type { ModelClientPort } from "../../../core/ports/model_client/model-client-port.js";

export const providerIdSchema = z.enum(["openai", "deepseek"]);
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

export class ProviderRegistry {
  readonly #providers = new Map<ProviderId, ProviderDefinition>();

  register(definition: ProviderDefinition): this {
    if (this.#providers.has(definition.id)) {
      throw new Error(`Provider ${definition.id} 已注册`);
    }
    this.#providers.set(definition.id, definition);
    return this;
  }

  get(id: string): ProviderDefinition {
    const parsed = providerIdSchema.safeParse(id);
    if (!parsed.success) throw new Error(`不支持的 Provider: ${id}`);
    const provider = this.#providers.get(parsed.data);
    if (!provider) throw new Error(`Provider ${id} 未注册`);
    return provider;
  }

  list(): readonly ProviderDefinition[] {
    return [...this.#providers.values()];
  }

  create(id: string, context: Readonly<ProviderCreateContext>): ModelClientPort {
    if (context.apiKey.trim().length === 0) throw new Error(`${id} API key 不能为空`);
    if (context.model.trim().length === 0) throw new Error(`${id} model 不能为空`);
    return this.get(id).create(context);
  }
}
