import { z } from "zod";
export declare const appConfigSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    model: z.ZodObject<{
        provider: z.ZodEnum<{
            openai: "openai";
            deepseek: "deepseek";
        }>;
        model: z.ZodString;
        baseUrl: z.ZodOptional<z.ZodString>;
        options: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        maxOutputTokens: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strict>;
    runtime: z.ZodObject<{
        tokenBudget: z.ZodNumber;
        maxModelRequests: z.ZodNumber;
        maxToolCalls: z.ZodNumber;
    }, z.core.$strict>;
    tools: z.ZodObject<{
        enabledNames: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    workspace: z.ZodDefault<z.ZodObject<{
        consistencyMode: z.ZodEnum<{
            session: "session";
            workspace: "workspace";
            strict: "strict";
        }>;
    }, z.core.$strict>>;
    storage: z.ZodObject<{
        databasePath: z.ZodString;
    }, z.core.$strict>;
    skills: z.ZodObject<{
        resourceRoot: z.ZodString;
        enabledIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    memory: z.ZodObject<{
        provider: z.ZodLiteral<"empty">;
    }, z.core.$strict>;
}, z.core.$strict>;
export type AppConfig = z.infer<typeof appConfigSchema>;
/** 当前内置模型路由的默认最大上下文窗口；配置文件仍可按模型覆盖。 */
export declare const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 1000000;
export declare const DEFAULT_MAX_MODEL_REQUESTS = 64;
export declare const DEFAULT_MAX_TOOL_CALLS = 128;
export declare const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export declare const BUILTIN_SKILL_ROOT: string;
export interface AppConfigOverrides {
    readonly provider?: string;
    readonly model?: string;
    readonly cwd?: string;
    readonly databasePath?: string;
}
export declare function loadAppConfig(input: {
    readonly cwd: string;
    readonly configPath?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly overrides?: AppConfigOverrides;
}): Promise<AppConfig>;
//# sourceMappingURL=app-config.d.ts.map