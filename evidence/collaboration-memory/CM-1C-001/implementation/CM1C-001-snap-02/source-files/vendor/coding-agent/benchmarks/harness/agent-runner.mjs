#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadAppConfig, runCodingAgent, StaticApprovalRequester } from "../../dist/public-api.js";

function requiredOption(args, name) {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少值`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正整数`);
  return parsed;
}

async function main(args) {
  const projectRoot = path.resolve(requiredOption(args, "--project"));
  const workspaceRoot = path.resolve(requiredOption(args, "--workspace"));
  const instruction = await readFile(path.resolve(requiredOption(args, "--instruction")), "utf8");
  const provider = requiredOption(args, "--provider");
  const model = requiredOption(args, "--model");
  const databasePath = path.resolve(requiredOption(args, "--database"));
  const maxModelRequests = positiveInteger(
    requiredOption(args, "--max-model-requests"),
    "--max-model-requests",
  );
  const maxToolCalls = positiveInteger(
    requiredOption(args, "--max-tool-calls"),
    "--max-tool-calls",
  );
  const base = await loadAppConfig({
    cwd: workspaceRoot,
    environment: {},
    overrides: { cwd: workspaceRoot, provider, model, databasePath },
  });
  const config = {
    ...base,
    model: { ...base.model, provider, model, maxOutputTokens: 2_048 },
    runtime: { ...base.runtime, maxModelRequests, maxToolCalls },
    tools: { enabledNames: ["read", "edit", "shell"] },
    storage: { databasePath },
    skills: {
      resourceRoot: path.join(projectRoot, "resources", "skills"),
      enabledIds: ["coding-safety"],
    },
  };
  const result = await runCodingAgent({
    config,
    workspaceRoot,
    input: instruction,
    approvalRequester: new StaticApprovalRequester({
      decision: "allow_once",
      reason: "isolated_benchmark_policy",
    }),
  });
  process.stdout.write(
    `${JSON.stringify({
      sessionId: result.sessionId,
      status: result.state.status,
      usage: result.state.usage,
      outcome: result.state.outcome,
      lastEventSequence: result.state.lastEventSequence,
    })}\n`,
  );
  process.exitCode = result.state.status === "completed" ? 0 : 2;
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "agent runner failed"}\n`);
  process.exitCode = 2;
}
