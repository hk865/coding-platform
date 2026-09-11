import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  benchmarkRunSummarySchema,
  benchmarkStatusSchema,
  benchmarkTrialResultSchema,
} from "../schemas/benchmark-schema.mjs";
import {
  currentRevision,
  emptyMetrics,
  evaluateWorkspace,
  loadBenchmarkTasks,
  prepareWorkspace,
  snapshot,
  writeTrialArtifacts,
} from "./benchmark-harness.mjs";

const MAX_CAPTURE_BYTES = 1024 * 1024;

function elapsedWallClockMs(started) {
  return Math.max(0, Math.round(performance.now() - started));
}

export async function resolveBubblewrapPath(environment = process.env) {
  const candidate = environment.CODING_AGENT_BWRAP_PATH ?? "/usr/bin/bwrap";
  if (!path.isAbsolute(candidate)) return null;
  try {
    await access(candidate, constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

async function runAgentProcess(loaded, prepared, options) {
  const args = [
    path.join(options.projectRoot, "benchmarks/harness/agent-runner.mjs"),
    "--project",
    options.projectRoot,
    "--workspace",
    prepared.workspace,
    "--instruction",
    path.join(loaded.taskRoot, "instruction.md"),
    "--provider",
    options.provider,
    "--model",
    options.model,
    "--database",
    path.join(prepared.root, "agent-session.sqlite"),
    "--max-model-requests",
    String(loaded.task.maxModelRequests),
    "--max-tool-calls",
    String(loaded.task.maxToolCalls),
  ];
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: options.projectRoot,
      env: process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const retain = (target, chunk, retained) => {
      const remaining = Math.max(0, MAX_CAPTURE_BYTES - retained);
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
    };
    child.stdout.on("data", (chunk) => {
      retain(stdout, chunk, stdoutBytes);
      stdoutBytes += chunk.byteLength;
    });
    child.stderr.on("data", (chunk) => {
      retain(stderr, chunk, stderrBytes);
      stderrBytes += chunk.byteLength;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // 进程组已经退出。
      }
    }, loaded.task.timeoutSeconds * 1_000);
    timer.unref?.();
    const finish = (exitCode, signal, launchError) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        launchError,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        wallClockMs: elapsedWallClockMs(started),
      });
    };
    child.once("error", (error) => finish(null, null, error.message));
    child.once("close", (exitCode, signal) => finish(exitCode, signal, null));
  });
}

function parseAgentSummary(command) {
  try {
    const line = command.stdout.trim().split("\n").at(-1);
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}

function metrics(evaluation, agentSummary, wallClockMs) {
  const base = emptyMetrics(wallClockMs);
  const usage = agentSummary?.usage;
  if (!usage || typeof usage !== "object") return base;
  return {
    ...base,
    modelRequestCount: usage.modelRequestCount ?? 0,
    toolCallCount: usage.toolCallCount ?? 0,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    totalCostUsdMicros: usage.costUsdMicros ?? null,
    wallClockMs,
    testRunCount: evaluation.command.stdout.includes("tests passed") ? 1 : 0,
  };
}

async function environmentFailure(loaded, prepared, message) {
  return {
    status: "environment_error",
    changedPaths: [],
    command: { exitCode: null, stdout: "", stderr: message },
    wallClockMs: 0,
    before: prepared.before,
    after: await snapshot(prepared.workspace),
    agentCommand: { exitCode: null, stdout: "", stderr: message },
    agentSummary: null,
  };
}

async function runTask(loaded, options) {
  const prepared = await prepareWorkspace(loaded, "base");
  try {
    if (loaded.task.requireBubblewrap) {
      const bwrapPath = await resolveBubblewrapPath();
      if (!bwrapPath) {
        return environmentFailure(
          loaded,
          prepared,
          "bubblewrap unavailable: set CODING_AGENT_BWRAP_PATH to an absolute executable path",
        );
      }
    }
    const agentCommand = await runAgentProcess(loaded, prepared, options);
    const agentSummary = parseAgentSummary(agentCommand);
    const evaluation = await evaluateWorkspace(loaded, prepared);
    const status = agentCommand.launchError
      ? "environment_error"
      : agentCommand.timedOut
        ? "timeout"
        : agentCommand.exitCode !== 0 || !agentSummary
          ? "agent_error"
          : evaluation.status;
    return {
      ...evaluation,
      status,
      wallClockMs: agentCommand.wallClockMs + evaluation.wallClockMs,
      before: prepared.before,
      after: await snapshot(prepared.workspace),
      agentCommand: {
        exitCode: agentCommand.exitCode,
        stdout: agentCommand.stdout,
        stderr: agentCommand.launchError
          ? `${agentCommand.stderr}\n${agentCommand.launchError}`.trim()
          : agentCommand.stderr,
      },
      agentSummary,
    };
  } finally {
    await rm(prepared.root, { recursive: true, force: true });
  }
}

export async function runRealBaseline(options) {
  if (!options.provider || !options.model)
    throw new Error("真实 baseline 需要 --provider 和 --model");
  const revision = await currentRevision(options.projectRoot);
  if (revision === "uncommitted") throw new Error("真实 baseline 要求可追溯的 Agent commit");
  const tasks = await loadBenchmarkTasks(options.tasksRoot);
  const startedAt = new Date().toISOString();
  const runId = options.runId ?? `agent-${startedAt.replaceAll(/[:.]/g, "-")}`;
  const outputRoot = path.resolve(options.outputRoot, runId);
  await mkdir(outputRoot, { recursive: true });
  const results = [];

  for (const loaded of tasks) {
    const trialId = `${loaded.task.taskId}-trial-1`;
    const trialStartedAt = new Date().toISOString();
    const evaluation = await runTask(loaded, options);
    const artifacts = await writeTrialArtifacts(outputRoot, trialId, evaluation);
    await appendFile(
      path.join(outputRoot, artifacts.trace),
      `${JSON.stringify({
        type: "agent.process",
        exitCode: evaluation.agentCommand.exitCode,
        summary: evaluation.agentSummary,
      })}\n`,
    );
    const result = benchmarkTrialResultSchema.parse({
      schemaVersion: 1,
      runId,
      trialId,
      taskId: loaded.task.taskId,
      taskDigest: loaded.digest,
      dataset: loaded.task.dataset,
      datasetVersion: loaded.task.datasetVersion,
      status: evaluation.status,
      failure:
        evaluation.status === "resolved"
          ? null
          : {
              category: evaluation.status,
              message:
                evaluation.agentCommand.stderr || evaluation.command.stderr || evaluation.status,
            },
      agent: { revision, runnerMode: "agent" },
      model: {
        provider: options.provider,
        model: options.model,
        options: options.provider === "deepseek" ? { thinking: "disabled" } : {},
      },
      promptVersion: "m6-canary-v1",
      taskLimits: {
        timeoutSeconds: loaded.task.timeoutSeconds,
        maxModelRequests: loaded.task.maxModelRequests,
        maxToolCalls: loaded.task.maxToolCalls,
        network: loaded.task.network,
      },
      startedAt: trialStartedAt,
      endedAt: new Date().toISOString(),
      environment: {
        platform: `${process.platform}-${process.arch}`,
        node: process.version,
        isolation: "bubblewrap-required",
      },
      changedPaths: evaluation.changedPaths,
      evaluator: evaluation.command,
      metrics: metrics(evaluation, evaluation.agentSummary, evaluation.wallClockMs),
      artifacts,
    });
    await writeFile(
      path.join(outputRoot, trialId, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    results.push(result);
  }

  const counts = Object.fromEntries(benchmarkStatusSchema.options.map((status) => [status, 0]));
  for (const result of results) counts[result.status] += 1;
  const summary = benchmarkRunSummarySchema.parse({
    schemaVersion: 1,
    runId,
    dataset: tasks[0]?.task.dataset ?? "internal-mvp",
    datasetVersion: tasks[0]?.task.datasetVersion ?? "0.1.0",
    trialCount: results.length,
    counts,
    resolvedAt1:
      results.length === 0
        ? 0
        : results.filter((result) => result.status === "resolved").length / results.length,
    startedAt,
    endedAt: new Date().toISOString(),
  });
  await writeFile(path.join(outputRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return { outputRoot, summary, results };
}
