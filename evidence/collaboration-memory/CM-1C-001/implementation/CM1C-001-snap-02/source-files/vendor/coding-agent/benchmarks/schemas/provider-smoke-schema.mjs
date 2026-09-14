import { z } from "zod";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    costUsdMicros: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const providerSmokeScenarioResultSchema = z
  .object({
    scenario: z.enum(["text", "tool_call"]),
    status: z.literal("passed"),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    latencyMs: z.number().int().nonnegative(),
    eventCount: z.number().int().positive(),
    eventTypes: z.array(z.string().min(1)).min(1),
    textDeltaCount: z.number().int().nonnegative(),
    textDigest: sha256Schema.nullable(),
    toolCalls: z.array(
      z
        .object({
          name: z.string().min(1),
          argumentsDigest: sha256Schema,
        })
        .strict(),
    ),
    usage: usageSchema.nullable(),
    terminalReason: z.enum(["final_answer", "tool_calls"]),
  })
  .strict();

export const providerSmokeRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    status: z.literal("passed"),
    provider: z.enum(["openai", "deepseek"]),
    model: z.string().trim().min(1),
    endpointOrigin: z.string().url(),
    credentialSource: z.enum(["OPENAI_API_KEY", "DEEPSEEK_API_KEY"]),
    providerOptions: z.union([
      z.object({}).strict(),
      z.object({ thinking: z.literal("disabled") }).strict(),
    ]),
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    promptVersion: z.literal("m6-provider-smoke-v1"),
    maxOutputTokens: z.literal(64),
    timeoutMs: z.number().int().positive().max(120_000),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    environment: z
      .object({
        platform: z.string().min(1),
        node: z.string().min(1),
      })
      .strict(),
    results: z.array(providerSmokeScenarioResultSchema).length(2),
  })
  .strict()
  .superRefine((value, context) => {
    const scenarios = new Set(value.results.map((result) => result.scenario));
    if (scenarios.size !== 2 || !scenarios.has("text") || !scenarios.has("tool_call")) {
      context.addIssue({
        code: "custom",
        message: "Provider smoke 必须同时包含 text 与 tool_call",
        path: ["results"],
      });
    }
  });
