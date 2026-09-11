/** M5 App、Provider 与扩展边界的稳定公共导出。 */
export { appConfigSchema, loadAppConfig } from "./app/composition/app-config.js";
export { runCodingAgent } from "./app/composition/composition-root.js";
export { parseCliCommand, runCli } from "./app/cli/cli.js";
export { resumeCodingAgent } from "./app/composition/resume-composition.js";
export {
  memoryRecallRequestSchema,
  memoryWriteRequestSchema,
  memoryWriteResultSchema,
} from "./core/ports/memory_provider/memory-provider-port.js";
export { skillSelectionRequestSchema } from "./core/ports/skill_provider/skill-provider-port.js";
export { EmptyMemoryProvider } from "./memory/providers/empty/empty-memory-provider.js";
export { DeepSeekModelClient } from "./model/providers/deepseek/deepseek-model-client.js";
export { OpenAIModelClient } from "./model/providers/openai/openai-model-client.js";
export { createBuiltinProviderRegistry } from "./model/providers/registry/builtin-provider-registry.js";
export { ProviderRegistry } from "./model/providers/registry/provider-registry.js";
export { FileSkillLoader } from "./skills/loader/file-skill-loader.js";
export { SkillRegistry } from "./skills/registry/skill-registry.js";

export type { AppConfig } from "./app/composition/app-config.js";
export type {
  RunAppInput,
  RunAppResult,
  SecretSource,
} from "./app/composition/composition-root.js";
export type { ResumeAppInput, ResumeAppResult } from "./app/composition/resume-composition.js";
export type { MemoryProviderPort } from "./core/ports/memory_provider/memory-provider-port.js";
export type { SkillProviderPort } from "./core/ports/skill_provider/skill-provider-port.js";
export type {
  ProviderDefinition,
  ProviderId,
} from "./model/providers/registry/provider-registry.js";
