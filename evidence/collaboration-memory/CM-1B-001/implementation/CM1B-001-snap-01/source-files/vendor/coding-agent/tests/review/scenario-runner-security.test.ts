import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const reviewDir = path.dirname(fileURLToPath(import.meta.url));
const scenariosRoot = path.resolve(reviewDir, "../scenarios");
const runnerPath = path.join(scenariosRoot, "runner.mjs");

interface RunnerResult {
  readonly status: string;
  readonly timedOut?: boolean;
  readonly workspacePath?: string;
  readonly results?: readonly { readonly status: string }[];
}

function runRunner(
  args: readonly string[],
  targetRunner = runnerPath,
): { readonly exitCode: number | null; readonly stdout: string; readonly result: RunnerResult } {
  const spawned = spawnSync(process.execPath, [targetRunner, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 5_000,
  });
  const stdout = (spawned.stdout ?? "").trim();
  return {
    exitCode: spawned.status,
    stdout,
    result: stdout ? (JSON.parse(stdout) as RunnerResult) : { status: "missing-output" },
  };
}

/** 复制 runner 与 vendored YAML parser 到临时根：runner 自测必须在隔离根中构造场景。 */
async function isolatedRunner(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-isolated-runner-"));
  const runner = path.join(root, "runner.mjs");
  await writeFile(runner, await readFile(runnerPath, "utf8"), "utf8");
  await cp(path.join(scenariosRoot, "vendor"), path.join(root, "vendor"), { recursive: true });
  return runner;
}

/** schema 完整的 environment.yaml：隔离场景只有通过结构校验才会真正执行验收器。 */
function validEnvironment(id: string): string {
  return [
    `scenario: ${id}`,
    `title: ${id}`,
    "runtime: node >= 24",
    "tools: read, edit, shell, check",
    "permissions:",
    "  sandbox_mode: workspace_only",
    "  approval_policy: on_request",
    "budget:",
    "  max_model_requests: 10",
    "  max_tool_calls: 20",
    "  max_input_tokens: 10000",
    "  deadline_minutes: 10",
    "evaluation:",
    "  layers: L2",
    "  metrics: total_time, tool_calls",
  ].join("\n");
}

async function makeScenario(
  root: string,
  id: string,
  environment: string,
  acceptanceSource: string,
): Promise<string> {
  const scenarioRoot = path.join(root, id);
  await mkdir(path.join(scenarioRoot, "base"), { recursive: true });
  await mkdir(path.join(scenarioRoot, "acceptance"), { recursive: true });
  await mkdir(path.join(scenarioRoot, "oracle"), { recursive: true });
  await writeFile(path.join(scenarioRoot, "task.md"), "# review scenario\n", "utf8");
  await writeFile(path.join(scenarioRoot, "environment.yaml"), environment, "utf8");
  await writeFile(path.join(scenarioRoot, "interruption-plan.md"), "# review\n", "utf8");
  await writeFile(path.join(scenarioRoot, "expected-artifacts.md"), "# review\n", "utf8");
  await writeFile(path.join(scenarioRoot, "acceptance", "check.mjs"), acceptanceSource, "utf8");
  return scenarioRoot;
}

async function escapedScenario(
  environment: string,
  acceptanceSource = 'process.stdout.write(JSON.stringify({status:"pass"}));',
): Promise<{ readonly id: string; readonly root: string; readonly workspace: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-runner-scenario-"));
  await makeScenario(path.dirname(root), path.basename(root), environment, acceptanceSource);
  const workspace = await mkdtemp(path.join(os.tmpdir(), "review-runner-workspace-"));
  return { id: path.relative(scenariosRoot, root), root, workspace };
}

describe("independent scenario runner security and classification review", () => {
  it("rejects scenarioId path traversal outside tests/scenarios", async () => {
    const scenario = await escapedScenario("title: escaped\nruntime: node\n");
    const run = runRunner(["validate", scenario.id]);

    expect(run.exitCode).not.toBe(0);
    expect(run.result.status).not.toBe("ok");
  });

  it("rejects a workspace that contains scenario packages and oracle directories", () => {
    const run = runRunner(["check", "bug-hunt", "--workspace", scenariosRoot]);

    expect(run.result.status).toBe("runner_error");
    expect(run.result.workspacePath).toBeUndefined();
  });

  it("marks malformed or structurally incomplete YAML as invalid", async () => {
    const scenario = await escapedScenario(
      ["title: broken", "permissions:", "  sandbox_mode: [", ": illegal", "budget: {"].join("\n"),
    );
    const run = runRunner(["validate", scenario.id]);

    expect(run.result.status).toBe("invalid");
    expect(run.result.results?.[0]?.status).toBe("invalid");
  });

  it("does not report pass when an exit-zero acceptance emits invalid JSON", async () => {
    const runner = await isolatedRunner();
    await makeScenario(
      path.dirname(runner),
      "invalid-json",
      validEnvironment("invalid-json"),
      'process.stdout.write("this is not JSON");',
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-invalid-json-workspace-"));

    const run = runRunner(["check", "invalid-json", "--workspace", workspace], runner);

    expect(run.result.status).toBe("runner_error");
    expect(run.exitCode).not.toBe(0);
  });

  it("preserves an explicit external_dependency_missing classification", async () => {
    const runner = await isolatedRunner();
    await makeScenario(
      path.dirname(runner),
      "external",
      validEnvironment("external"),
      'process.stdout.write(JSON.stringify({failureClassification:"external_dependency_missing"})); process.exit(1);',
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-external-workspace-"));

    const run = runRunner(["check", "external", "--workspace", workspace], runner);

    expect(run.result.status).toBe("external_dependency_missing");
  });

  it("does not call a self-SIGTERM acceptance a timeout", async () => {
    const runner = await isolatedRunner();
    await makeScenario(
      path.dirname(runner),
      "signal",
      validEnvironment("signal"),
      'process.kill(process.pid, "SIGTERM");',
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-signal-workspace-"));

    const run = runRunner(["check", "signal", "--workspace", workspace], runner);

    expect(run.result.timedOut).toBe(false);
    expect(run.result.status).toBe("runner_error");
  });

  it("classifies an unexpected signal crash as runner_error", async () => {
    const runner = await isolatedRunner();
    await makeScenario(
      path.dirname(runner),
      "crash",
      validEnvironment("crash"),
      'process.kill(process.pid, "SIGKILL");',
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-crash-workspace-"));

    const run = runRunner(["check", "crash", "--workspace", workspace], runner);

    expect(run.result.timedOut).toBe(false);
    expect(run.result.status).toBe("runner_error");
  });

  it("detects a real acceptance timeout in a short-timeout copy of the same runner", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "review-short-timeout-runner-"));
    const source = await readFile(runnerPath, "utf8");
    const shortRunner = path.join(root, "runner.mjs");
    await writeFile(shortRunner, source.replace("timeout: 300_000", "timeout: 50"), "utf8");
    await cp(path.join(scenariosRoot, "vendor"), path.join(root, "vendor"), { recursive: true });
    await makeScenario(
      root,
      "timeout-case",
      validEnvironment("timeout-case"),
      "setInterval(() => undefined, 1_000);",
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-timeout-workspace-"));

    const run = runRunner(["check", "timeout-case", "--workspace", workspace], shortRunner);

    expect(run.result.timedOut).toBe(true);
    expect(run.result.status).toBe("runner_error");
    expect(run.exitCode).not.toBe(0);
  });
});
