/** 显式 Provider 注册表：只按配置选择，不做自动路由或隐式回退。 */
import { z } from "zod";
export const providerIdSchema = z.enum(["openai", "deepseek"]);
export class ProviderRegistry {
    #providers = new Map();
    register(definition) {
        if (this.#providers.has(definition.id)) {
            throw new Error(`Provider ${definition.id} 已注册`);
        }
        this.#providers.set(definition.id, definition);
        return this;
    }
    get(id) {
        const parsed = providerIdSchema.safeParse(id);
        if (!parsed.success)
            throw new Error(`不支持的 Provider: ${id}`);
        const provider = this.#providers.get(parsed.data);
        if (!provider)
            throw new Error(`Provider ${id} 未注册`);
        return provider;
    }
    list() {
        return [...this.#providers.values()];
    }
    create(id, context) {
        if (context.apiKey.trim().length === 0)
            throw new Error(`${id} API key 不能为空`);
        if (context.model.trim().length === 0)
            throw new Error(`${id} model 不能为空`);
        return this.get(id).create(context);
    }
}
//# sourceMappingURL=provider-registry.js.map