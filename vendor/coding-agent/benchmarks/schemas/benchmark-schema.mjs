import { z } from "zod";

const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split("/").includes("..") &&
      !value.includes("\\"),
    "路径必须是不能向上逃逸的 POSIX 相对路径",
  );

export const benchmarkStatusSchema = z.enum([
  "resolved",
  "unresolved",
  "agent_error",
  "timeout",
  "environment_error",
  "evaluator_error",
  "policy_violation",
]);

export const benchmarkTaskSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    dataset: z.string().min(1),
    datasetVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    language: z.enum(["typescript", "javascript", "python"]),
    domain: z.enum(["frontend", "backend", "tooling", "security-recovery"]),
    taskType: z.enum(["bugfix", "refactor", "security-fix", "recovery-fix"]),
    difficulty: z.enum(["easy", "medium", "hard"]),
    baseRevision: z.string().min(1),
    environmentDigest: z.string().min(1),
    timeoutSeconds: z.number().int().positive().max(3_600),
    maxModelRequests: z.number().int().positive(),
    maxToolCalls: z.number().int().positive(),
    network: z.literal("disabled"),
    requireBubblewrap: z.boolean(),
    allowedChangedPaths: z.array(relativePathSchema).min(1),
    evaluator: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()),
      })
      .strict(),
    variants: z
      .object({
        base: relativePathSchema,
        oracle: relativePathSchema,
        nearMiss: relativePathSchema,
      })
      .strict(),
  })
  .strict();

const benchmarkMetricsSchema = z
  .object({
    modelRequestCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    shellCommandCount: z.number().int().nonnegative(),
    testRunCount: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    totalCostUsdMicros: z.number().int().nonnegative().nullable(),
    timeToFirstActionMs: z.number().int().nonnegative().nullable(),
    timeToFirstTestMs: z.number().int().nonnegative().nullable(),
    wallClockMs: z.number().int().nonnegative(),
  })
  .strict();

export const benchmarkTrialResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    trialId: z.string().min(1),
    taskId: z.string().min(1),
    taskDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    dataset: z.string().min(1),
    datasetVersion: z.string().min(1),
    status: benchmarkStatusSchema,
    failure: z
      .object({ category: benchmarkStatusSchema, message: z.string().min(1) })
      .strict()
      .nullable(),
    agent: z
      .object({
        revision: z.string().min(1),
        runnerMode: z.enum(["base", "oracle", "near-miss", "agent"]),
      })
      .strict(),
    model: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        options: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
      })
      .strict(),
    promptVersion: z.string().min(1),
    taskLimits: z
      .object({
        timeoutSeconds: z.number().int().positive(),
        maxModelRequests: z.number().int().positive(),
        maxToolCalls: z.number().int().positive(),
        network: z.literal("disabled"),
      })
      .strict(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    environment: z
      .object({
        platform: z.string().min(1),
        node: z.string().min(1),
        isolation: z.string().min(1),
      })
      .strict(),
    changedPaths: z.array(relativePathSchema),
    evaluator: z
      .object({ exitCode: z.number().int().nullable(), stdout: z.string(), stderr: z.string() })
      .strict(),
    metrics: benchmarkMetricsSchema,
    artifacts: z
      .object({
        trace: relativePathSchema,
        diff: relativePathSchema,
        evaluatorLog: relativePathSchema,
      })
      .strict(),
  })
  .strict();

export const benchmarkRunSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    dataset: z.string().min(1),
    datasetVersion: z.string().min(1),
    trialCount: z.number().int().nonnegative(),
    counts: z.record(benchmarkStatusSchema, z.number().int().nonnegative()),
    resolvedAt1: z.number().min(0).max(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
  })
  .strict();
