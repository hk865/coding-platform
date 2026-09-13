import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  benchmarkRunSummarySchema,
  benchmarkStatusSchema,
  benchmarkTaskSchema,
  benchmarkTrialResultSchema,
} from "../schemas/benchmark-schema.mjs";

const MAX_CAPTURE_BYTES = 1024 * 1024;
const ALL_STATUSES = benchmarkStatusSchema.options;

function elapsedWallClockMs(started) {
  return Math.max(0, Math.round(performance.now() - started));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function listFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.posix.join(relative.split(path.sep).join("/"), entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function digestDirectory(root) {
  const hash = createHash("sha256");
  for (const relative of await listFiles(root)) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relative)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function copyDirectoryContents(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    await cp(path.join(source, entry.name), path.join(destination, entry.name), {
      recursive: true,
      force: true,
      preserveTimestamps: false,
    });
  }
}

export async function snapshot(root) {
  const values = new Map();
  for (const relative of await listFiles(root)) {
    if (relative === ".git" || relative.startsWith(".git/")) continue;
    const contents = await readFile(path.join(root, relative));
    values.set(relative, sha256(contents));
  }
  return values;
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((relative) => before.get(relative) !== after.get(relative))
    .sort();
}

function pathAllowed(relative, allowed) {
  return allowed.some((rule) => {
    if (rule.endsWith("/**")) {
      const prefix = rule.slice(0, -3);
      return relative === prefix || relative.startsWith(`${prefix}/`);
    }
    return relative === rule;
  });
}

function expandArgument(value, context) {
  return value
    .replaceAll("{workspace}", context.workspace)
    .replaceAll("{taskRoot}", context.taskRoot);
}

async function runCommand(command, args, options) {
  const executable = command === "{node}" ? process.execPath : command;
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.environment ?? process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (target, chunk, retained) => {
      const remaining = Math.max(0, MAX_CAPTURE_BYTES - retained);
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
    };
    child.stdout.on("data", (chunk) => {
      append(stdout, chunk, stdoutBytes);
      stdoutBytes += chunk.byteLength;
    });
    child.stderr.on("data", (chunk) => {
      append(stderr, chunk, stderrBytes);
      stderrBytes += chunk.byteLength;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // 进程已经结束。
      }
    }, options.timeoutMs);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        timedOut,
        launchError: error instanceof Error ? error.message : "launch failed",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        wallClockMs: elapsedWallClockMs(started),
      });
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        launchError: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        wallClockMs: elapsedWallClockMs(started),
      });
    });
  });
}

export async function loadBenchmarkTasks(tasksRoot) {
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  const tasks = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const taskRoot = path.join(tasksRoot, entry.name);
    try {
      const raw = JSON.parse(await readFile(path.join(taskRoot, "task.yaml"), "utf8"));
      const task = benchmarkTaskSchema.parse(raw);
      if (task.taskId !== entry.name) throw new Error("taskId 必须与目录名一致");
      tasks.push({ task, taskRoot, digest: await digestDirectory(taskRoot) });
    } catch (error) {
      throw new Error(
        `无法加载 benchmark 任务 ${entry.name}: ${error instanceof Error ? error.message : "unknown"}`,
        { cause: error },
      );
    }
  }
  if (tasks.length < 3 || tasks.length > 5) {
    throw new Error(`MVP canary 必须为 3–5 个，当前为 ${String(tasks.length)} 个`);
  }
  return tasks;
}

export async function prepareWorkspace(loaded, variant) {
  const root = await mkdtemp(path.join(tmpdir(), `coding-agent-bench-${loaded.task.taskId}-`));
  const workspace = path.join(root, "workspace");
  const base = path.join(loaded.taskRoot, loaded.task.variants.base);
  await copyDirectoryContents(base, workspace);
  const before = await snapshot(workspace);
  if (variant !== "base") {
    const overlayKey = variant === "oracle" ? "oracle" : "nearMiss";
    await copyDirectoryContents(
      path.join(loaded.taskRoot, loaded.task.variants[overlayKey]),
      workspace,
    );
  }
  return { root, workspace, before };
}

export async function evaluateWorkspace(loaded, prepared) {
  const after = await snapshot(prepared.workspace);
  const changes = changedPaths(prepared.before, after);
  const disallowed = changes.filter(
    (relative) => !pathAllowed(relative, loaded.task.allowedChangedPaths),
  );
  if (disallowed.length > 0) {
    return {
      status: "policy_violation",
      changedPaths: changes,
      command: { exitCode: null, stdout: "", stderr: `越权修改: ${disallowed.join(", ")}` },
      wallClockMs: 0,
    };
  }

  const command = await runCommand(
    loaded.task.evaluator.command,
    loaded.task.evaluator.args.map((argument) =>
      expandArgument(argument, { workspace: prepared.workspace, taskRoot: loaded.taskRoot }),
    ),
    {
      cwd: loaded.taskRoot,
      timeoutMs: loaded.task.timeoutSeconds * 1_000,
    },
  );
  let status;
  if (command.launchError) status = "environment_error";
  else if (command.timedOut) status = "timeout";
  else if (command.exitCode === 0) status = "resolved";
  else if (command.exitCode === 1) status = "unresolved";
  else status = "evaluator_error";
  return {
    status,
    changedPaths: changes,
    command: {
      exitCode: command.exitCode,
      stdout: command.stdout,
      stderr: command.launchError
        ? `${command.stderr}\n${command.launchError}`.trim()
        : command.stderr,
    },
    wallClockMs: command.wallClockMs,
  };
}

async function runVariant(loaded, variant) {
  const prepared = await prepareWorkspace(loaded, variant);
  try {
    const evaluation = await evaluateWorkspace(loaded, prepared);
    return { ...evaluation, before: prepared.before, after: await snapshot(prepared.workspace) };
  } finally {
    await rm(prepared.root, { recursive: true, force: true });
  }
}

export async function preflightBenchmarkSuite(tasksRoot) {
  const loadedTasks = await loadBenchmarkTasks(tasksRoot);
  const reports = [];
  for (const loaded of loadedTasks) {
    const instruction = (
      await readFile(path.join(loaded.taskRoot, "instruction.md"), "utf8")
    ).trim();
    if (!instruction) throw new Error(`${loaded.task.taskId} instruction.md 不能为空`);
    const base = await runVariant(loaded, "base");
    const oracle = await runVariant(loaded, "oracle");
    const nearMiss = await runVariant(loaded, "near-miss");
    const repeatedOracle = await runVariant(loaded, "oracle");
    if (base.status !== "unresolved") {
      throw new Error(`${loaded.task.taskId} base 应为 unresolved，实际为 ${base.status}`);
    }
    if (oracle.status !== "resolved" || repeatedOracle.status !== "resolved") {
      throw new Error(`${loaded.task.taskId} oracle 必须重复 resolved`);
    }
    if (nearMiss.status !== "unresolved") {
      throw new Error(`${loaded.task.taskId} near-miss 应为 unresolved，实际为 ${nearMiss.status}`);
    }
    if (oracle.command.stdout !== repeatedOracle.command.stdout) {
      throw new Error(`${loaded.task.taskId} evaluator 重复输出不稳定`);
    }
    reports.push({
      taskId: loaded.task.taskId,
      digest: loaded.digest,
      base: base.status,
      oracle: oracle.status,
      nearMiss: nearMiss.status,
      repeatStable: true,
    });
  }
  return reports;
}

export async function currentRevision(projectRoot) {
  const status = await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
    cwd: projectRoot,
    timeoutMs: 5_000,
  });
  if (status.exitCode !== 0 || status.stdout.trim().length > 0) return "uncommitted";
  const command = await runCommand("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    timeoutMs: 5_000,
  });
  const revision = command.stdout.trim();
  return command.exitCode === 0 && /^[a-f0-9]{40}$/.test(revision) ? revision : "uncommitted";
}

export function emptyMetrics(wallClockMs) {
  return {
    modelRequestCount: 0,
    toolCallCount: 0,
    shellCommandCount: 0,
    testRunCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalCostUsdMicros: null,
    timeToFirstActionMs: null,
    timeToFirstTestMs: null,
    wallClockMs: Math.max(0, Math.round(wallClockMs)),
  };
}

export async function writeTrialArtifacts(outputRoot, trialId, evaluation) {
  const trialRoot = path.join(outputRoot, trialId);
  await mkdir(trialRoot, { recursive: true });
  const trace = path.join(trialRoot, "trace.jsonl");
  const diff = path.join(trialRoot, "diff.json");
  const evaluatorLog = path.join(trialRoot, "evaluator.log");
  await writeFile(
    trace,
    [
      JSON.stringify({ type: "task.prepared", trialId }),
      JSON.stringify({ type: "workspace.changed", paths: evaluation.changedPaths }),
      JSON.stringify({ type: "evaluator.completed", status: evaluation.status }),
    ].join("\n") + "\n",
    "utf8",
  );
  await writeFile(
    diff,
    JSON.stringify(
      {
        changedPaths: evaluation.changedPaths,
        before: Object.fromEntries(evaluation.before),
        after: Object.fromEntries(evaluation.after),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    evaluatorLog,
    `stdout:\n${evaluation.command.stdout}\n\nstderr:\n${evaluation.command.stderr}\n`,
    "utf8",
  );
  return {
    trace: path.relative(outputRoot, trace).split(path.sep).join("/"),
    diff: path.relative(outputRoot, diff).split(path.sep).join("/"),
    evaluatorLog: path.relative(outputRoot, evaluatorLog).split(path.sep).join("/"),
  };
}

export async function runReplayBaseline(options) {
  const startedAt = new Date().toISOString();
  const loadedTasks = await loadBenchmarkTasks(options.tasksRoot);
  const runId = options.runId ?? `replay-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  const outputRoot = path.resolve(options.outputRoot, runId);
  await mkdir(outputRoot, { recursive: true });
  const revision = await currentRevision(options.projectRoot);
  const results = [];
  for (const loaded of loadedTasks) {
    const trialId = `${loaded.task.taskId}-trial-1`;
    const trialStartedAt = new Date().toISOString();
    const evaluation = await runVariant(loaded, options.mode);
    const artifacts = await writeTrialArtifacts(outputRoot, trialId, evaluation);
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
              message: evaluation.command.stderr || evaluation.status,
            },
      agent: { revision, runnerMode: options.mode },
      model: { provider: "deterministic-replay", model: options.mode, options: {} },
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
        isolation: loaded.task.requireBubblewrap ? "bubblewrap-required" : "process",
      },
      changedPaths: evaluation.changedPaths,
      evaluator: evaluation.command,
      metrics: emptyMetrics(evaluation.wallClockMs),
      artifacts,
    });
    await writeFile(
      path.join(outputRoot, trialId, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
      "utf8",
    );
    results.push(result);
  }

  const counts = Object.fromEntries(ALL_STATUSES.map((status) => [status, 0]));
  for (const result of results) counts[result.status] += 1;
  const summary = benchmarkRunSummarySchema.parse({
    schemaVersion: 1,
    runId,
    dataset: loadedTasks[0]?.task.dataset ?? "internal-mvp",
    datasetVersion: loadedTasks[0]?.task.datasetVersion ?? "0.1.0",
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

export function createRunId(prefix = "benchmark") {
  return `${prefix}-${randomUUID()}`;
}

export async function assertTaskRootsExist(tasksRoot) {
  const metadata = await stat(tasksRoot);
  if (!metadata.isDirectory()) throw new Error(`${tasksRoot} 不是目录`);
}
