#!/usr/bin/env node
import path from "node:path";
import process from "node:process";

import {
  assertTaskRootsExist,
  preflightBenchmarkSuite,
  runReplayBaseline,
} from "./benchmark-harness.mjs";
import { runRealBaseline } from "./real-baseline.mjs";

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少值`);
  return value;
}

async function main(argv) {
  const command = argv[0];
  const projectRoot = path.resolve(option(argv, "--project", path.resolve(".")));
  const tasksRoot = path.resolve(
    option(argv, "--tasks", path.join(projectRoot, "benchmarks/tasks")),
  );
  await assertTaskRootsExist(tasksRoot);

  if (command === "preflight") {
    const reports = await preflightBenchmarkSuite(tasksRoot);
    process.stdout.write(`${JSON.stringify({ ok: true, tasks: reports }, null, 2)}\n`);
    return;
  }
  if (command === "baseline") {
    const mode = option(argv, "--mode", "oracle");
    if (!new Set(["base", "oracle", "near-miss", "agent"]).has(mode)) {
      throw new Error("--mode 必须是 base、oracle、near-miss 或 agent");
    }
    const outputRoot = path.resolve(
      option(argv, "--output", path.join(projectRoot, "benchmarks/results")),
    );
    const common = {
      projectRoot,
      tasksRoot,
      outputRoot,
      ...(option(argv, "--run-id", "") ? { runId: option(argv, "--run-id", "") } : {}),
    };
    const result =
      mode === "agent"
        ? await runRealBaseline({
            ...common,
            provider: option(argv, "--provider", ""),
            model: option(argv, "--model", ""),
          })
        : await runReplayBaseline({ ...common, mode });
    process.stdout.write(
      `${JSON.stringify({ outputRoot: result.outputRoot, summary: result.summary }, null, 2)}\n`,
    );
    return;
  }
  throw new Error("命令必须是 preflight 或 baseline");
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "benchmark failed"}\n`);
  process.exitCode = 1;
}
