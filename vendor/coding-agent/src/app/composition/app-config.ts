/** CLI/App 的版本化非敏感配置及四层合并。 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { providerIdSchema } from "../../model/providers/registry/provider-registry.js";

const uniqueNames = (message: string) =>
  z
    .array(z.string().trim().min(1))
    .refine((items) => new Set(items).size === items.length, message);

export const appConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    model: z
      .object({
        provider: providerIdSchema,
        model: z.string().trim().min(1),
        baseUrl: z.string().url().optional(),
        options: z.record(z.string(), z.unknown()).default({}),
        maxOutputTokens: z.number().int().positive().nullable(),
      })
      .strict(),
    runtime: z
      .object({
        tokenBudget: z.number().int().positive(),
        maxModelRequests: z.number().int().positive(),
        maxToolCalls: z.number().int().positive(),
      })
      .strict(),
    tools: z.object({ enabledNames: uniqueNames("工具名称不能重复") }).strict(),
    workspace: z
      .object({ consistencyMode: z.enum(["session", "workspace", "strict"]) })
      .strict()
      .default({ consistencyMode: "session" }),
    storage: z.object({ databasePath: z.string().trim().min(1) }).strict(),
    skills: z
      .object({
        resourceRoot: z.string().trim().min(1),
        enabledIds: uniqueNames("Skill ID 不能重复"),
      })
      .strict(),
    memory: z.object({ provider: z.literal("empty") }).strict(),
  })
  .strict();

export type AppConfig = z.infer<typeof appConfigSchema>;
/** 当前内置模型路由的默认最大上下文窗口；配置文件仍可按模型覆盖。 */
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 1_000_000;
export const DEFAULT_MAX_MODEL_REQUESTS = 64;
export const DEFAULT_MAX_TOOL_CALLS = 128;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
export const BUILTIN_SKILL_ROOT = fileURLToPath(
  new URL("../../../resources/skills", import.meta.url),
);
export interface AppConfigOverrides {
  readonly provider?: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly databasePath?: string;
}

function defaults(): AppConfig {
  return appConfigSchema.parse({
    schemaVersion: 1,
    model: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      options: {},
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    },
    runtime: {
      tokenBudget: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      maxModelRequests: DEFAULT_MAX_MODEL_REQUESTS,
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
    },
    tools: { enabledNames: ["read", "check", "edit", "shell"] },
    workspace: { consistencyMode: "session" },
    storage: {
      databasePath: path.join(os.homedir(), ".local", "share", "coding-agent", "sessions.sqlite"),
    },
    skills: {
      resourceRoot: BUILTIN_SKILL_ROOT,
      enabledIds: ["coding-safety", "project-conventions"],
    },
    memory: { provider: "empty" },
  });
}

function merge(base: AppConfig, overlay: unknown): AppConfig {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) return base;
  const value = overlay as Record<string, unknown>;
  return appConfigSchema.parse({
    ...base,
    ...value,
    model: { ...base.model, ...(value["model"] as object | undefined) },
    runtime: { ...base.runtime, ...(value["runtime"] as object | undefined) },
    tools: { ...base.tools, ...(value["tools"] as object | undefined) },
    workspace: { ...base.workspace, ...(value["workspace"] as object | undefined) },
    storage: { ...base.storage, ...(value["storage"] as object | undefined) },
    skills: { ...base.skills, ...(value["skills"] as object | undefined) },
    memory: { ...base.memory, ...(value["memory"] as object | undefined) },
  });
}

export async function loadAppConfig(input: {
  readonly cwd: string;
  readonly configPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly overrides?: AppConfigOverrides;
}): Promise<AppConfig> {
  const cwd = path.resolve(input.overrides?.cwd ?? input.cwd);
  let config = defaults();
  if (input.configPath) {
    const text = await readFile(path.resolve(cwd, input.configPath), "utf8");
    config = merge(config, JSON.parse(text) as unknown);
  }
  const environment = input.environment ?? process.env;
  const envOverlay: Record<string, unknown> = {};
  if (environment["CODING_AGENT_PROVIDER"] || environment["CODING_AGENT_MODEL"]) {
    envOverlay["model"] = {
      ...(environment["CODING_AGENT_PROVIDER"]
        ? { provider: environment["CODING_AGENT_PROVIDER"] }
        : {}),
      ...(environment["CODING_AGENT_MODEL"] ? { model: environment["CODING_AGENT_MODEL"] } : {}),
    };
  }
  if (environment["CODING_AGENT_DATABASE_PATH"]) {
    envOverlay["storage"] = { databasePath: environment["CODING_AGENT_DATABASE_PATH"] };
  }
  if (environment["CODING_AGENT_WORKSPACE_CONSISTENCY"]) {
    envOverlay["workspace"] = {
      consistencyMode: environment["CODING_AGENT_WORKSPACE_CONSISTENCY"],
    };
  }
  config = merge(config, envOverlay);
  return merge(config, {
    model: {
      ...(input.overrides?.provider ? { provider: input.overrides.provider } : {}),
      ...(input.overrides?.model ? { model: input.overrides.model } : {}),
    },
    storage: input.overrides?.databasePath
      ? { databasePath: input.overrides.databasePath }
      : config.storage,
  });
}
