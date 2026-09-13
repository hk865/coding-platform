/** M5 内建 Provider 的静态注册入口。 */
import { z } from "zod";

import {
  DeepSeekModelClient,
  DeepSeekSdkChatTransport,
  DEEPSEEK_DEFAULT_BASE_URL,
} from "../deepseek/deepseek-model-client.js";
import { OpenAIModelClient, OpenAISdkResponsesTransport } from "../openai/openai-model-client.js";
import { ProviderRegistry } from "./provider-registry.js";

const openAIOptionsSchema = z
  .object({ organization: z.string().min(1).optional(), project: z.string().min(1).optional() })
  .strict();
const deepSeekOptionsSchema = z
  .object({
    thinking: z.enum(["enabled", "disabled"]).optional(),
    reasoningEffort: z.enum(["low", "high", "max"]).optional(),
  })
  .strict();

export function createBuiltinProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register({
      id: "openai",
      secretEnvironmentVariable: "OPENAI_API_KEY",
      defaultBaseUrl: "https://api.openai.com/v1",
      capabilities: { streaming: true, toolCalls: true, usage: true },
      create(context) {
        const options = openAIOptionsSchema.parse(context.options ?? {});
        return new OpenAIModelClient({
          model: context.model,
          transport: new OpenAISdkResponsesTransport({
            apiKey: context.apiKey,
            ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
            ...(options.organization ? { organization: options.organization } : {}),
            ...(options.project ? { project: options.project } : {}),
          }),
        });
      },
    })
    .register({
      id: "deepseek",
      secretEnvironmentVariable: "DEEPSEEK_API_KEY",
      defaultBaseUrl: DEEPSEEK_DEFAULT_BASE_URL,
      capabilities: { streaming: true, toolCalls: true, usage: true },
      create(context) {
        const options = deepSeekOptionsSchema.parse(context.options ?? {});
        return new DeepSeekModelClient({
          model: context.model,
          transport: new DeepSeekSdkChatTransport({
            apiKey: context.apiKey,
            ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
          }),
          ...(options.thinking ? { thinking: options.thinking } : {}),
          ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
        });
      },
    });
}
