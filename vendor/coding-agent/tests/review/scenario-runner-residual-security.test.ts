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
  readonly protocolError?: string;
  readonly acceptance?: unknown;
  readonly results?: readonly { readonly status: string }[];
}

function runRunner(
  runner: string,
  args: readonly string[],
): { readonly exitCode: number | null; readonly result: RunnerResult } {
  const spawned = spawnSync(process.execPath, [runner, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 5_000,
  });
  const stdout = (spawned.stdout ?? "").trim();
  return {
    exitCode: spawned.status,
    result: stdout ? (JSON.parse(stdout) as RunnerResult) : { status: "missing-output" },
  };
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
  acceptanceSource = 'process.stdout.write(JSON.stringify({status:"pass"}));',
): Promise<string> {
  const scenarioRoot = path.join(root, id);
  for (const directory of ["base", "acceptance", "oracle"]) {
    await mkdir(path.join(scenarioRoot, directory), { recursive: true });
  }
  await writeFile(path.join(scenarioRoot, "task.md"), "# residual review\n", "utf8");
  await writeFile(path.join(scenarioRoot, "environment.yaml"), environment, "utf8");
  await writeFile(path.join(scenarioRoot, "interruption-plan.md"), "# review\n", "utf8");
  await writeFile(path.join(scenarioRoot, "expected-artifacts.md"), "# review\n", "utf8");
  await writeFile(path.join(scenarioRoot, "acceptance", "check.mjs"), acceptanceSource, "utf8");
  return scenarioRoot;
}

async function isolatedRunnerRoot(): Promise<{ readonly root: string; readonly runner: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-isolated-runner-"));
  const runner = path.join(root, "runner.mjs");
  await writeFile(runner, await readFile(runnerPath, "utf8"), "utf8");
  await cp(path.join(scenariosRoot, "vendor"), path.join(root, "vendor"), { recursive: true });
  return { root, runner };
}

describe("scenario runner residual security and protocol review", () => {
  it("rejects check scenarioId traversal instead of executing an external acceptance script", async () => {
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "review-external-scenario-"));
    const scenarioRoot = await makeScenario(
      path.dirname(externalRoot),
      path.basename(externalRoot),
      "scenario: escaped\ntitle: escaped\nruntime: node\n",
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-external-workspace-"));
    const traversalId = path.relative(scenariosRoot, scenarioRoot);

    const run = runRunner(runnerPath, ["check", traversalId, "--workspace", workspace]);

    expect(run.exitCode).not.toBe(0);
    expect(run.result.status).toBe("runner_error");
  });

  it("rejects a structurally incomplete environment even when every line is valid key-value YAML", async () => {
    const isolated = await isolatedRunnerRoot();
    await makeScenario(isolated.root, "incomplete", "title: incomplete\n");

    const run = runRunner(isolated.runner, ["validate", "incomplete"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.result.status).toBe("invalid");
    expect(run.result.results?.[0]?.status).toBe("invalid");
  });

  it("rejects schema-invalid acceptance JSON instead of treating an empty object as pass", async () => {
    const isolated = await isolatedRunnerRoot();
    await makeScenario(
      isolated.root,
      "empty-result",
      validEnvironment("empty-result"),
      'process.stdout.write("{}");',
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-empty-result-workspace-"));

    const run = runRunner(isolated.runner, ["check", "empty-result", "--workspace", workspace]);

    expect(run.exitCode).not.toBe(0);
    expect(run.result.status).toBe("runner_error");
  });

  it("rejects status pass when a check reports failure", async () => {
    const isolated = await isolatedRunnerRoot();
    await makeScenario(
      isolated.root,
      "pass-with-failing-check",
      validEnvironment("pass-with-failing-check"),
      'process.stdout.write(JSON.stringify({status:"pass", failureClassification:"pass", checks:[{name:"actual failure", pass:false}]}));',
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-pass-failing-workspace-"));

    const run = runRunner(isolated.runner, [
      "check",
      "pass-with-failing-check",
      "--workspace",
      workspace,
    ]);

    expect(run.exitCode).not.toBe(0);
    expect(run.result.status).toBe("runner_error");
    expect(run.result.protocolError).toContain("status pass 与未通过的 checks 矛盾");
  });

  it("rejects status fail when every check passes", async () => {
    const isolated = await isolatedRunnerRoot();
    await makeScenario(
      isolated.root,
      "fail-with-all-checks-passing",
      validEnvironment("fail-with-all-checks-passing"),
      'process.stdout.write(JSON.stringify({status:"fail", failureClassification:"acceptance_failed", checks:[{name:"ok", pass:true}]})); process.exit(1);',
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-fail-all-pass-workspace-"));

    const run = runRunner(isolated.runner, [
      "check",
      "fail-with-all-checks-passing",
      "--workspace",
      workspace,
    ]);

    expect(run.exitCode).not.toBe(0);
    expect(run.result.status).toBe("runner_error");
    expect(run.result.protocolError).toContain("status fail 与全部通过的 checks 矛盾");
  });

  it("rejects non-JSON output with a nonzero exit as runner_error", async () => {
    const isolated = await isolatedRunnerRoot();
    await makeScenario(
      isolated.root,
      "non-json-nonzero-exit",
      validEnvironment("non-json-nonzero-exit"),
      'process.stdout.write("not-json"); process.exit(1);',
    );
    const workspace = await mkdtemp(path.join(os.tmpdir(), "review-non-json-workspace-"));

    const run = runRunner(isolated.runner, [
      "check",
      "non-json-nonzero-exit",
      "--workspace",
      workspace,
    ]);

    expect(run.exitCode).not.toBe(0);
    expect(run.result.status).toBe("runner_error");
    expect(run.result.protocolError).toContain("不是合法 JSON");
  });
});
