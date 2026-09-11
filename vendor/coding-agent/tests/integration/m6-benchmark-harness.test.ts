import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

const execFileAsync = promisify(execFile);
const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => workspace.cleanup()));
});

async function runHarness(args: readonly string[]) {
  return execFileAsync(process.execPath, [path.resolve("benchmarks/harness/cli.mjs"), ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

describe("M6 benchmark harness", () => {
  it("4 个 canary 的 base/oracle/near-miss 与重复 evaluator 预检稳定", async () => {
    const { stdout, stderr } = await runHarness(["preflight"]);
    const report = JSON.parse(stdout) as {
      readonly ok: boolean;
      readonly tasks: readonly {
        readonly base: string;
        readonly oracle: string;
        readonly nearMiss: string;
        readonly repeatStable: boolean;
      }[];
    };
    expect(stderr).toBe("");
    expect(report.ok).toBe(true);
    expect(report.tasks).toHaveLength(4);
    expect(report.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          base: "unresolved",
          oracle: "resolved",
          nearMiss: "unresolved",
          repeatStable: true,
        }),
      ]),
    );
  }, 15_000);

  it("固定 replay baseline 保存 summary、逐 trial 结果、trace、diff 和 evaluator log", async () => {
    const output = await createTempWorkspace("m6-results-");
    workspaces.push(output);
    const runId = "m6-integration-replay";
    const { stdout, stderr } = await runHarness([
      "baseline",
      "--mode",
      "oracle",
      "--output",
      output.root,
      "--run-id",
      runId,
    ]);
    const commandResult = JSON.parse(stdout) as {
      readonly summary: { readonly trialCount: number; readonly resolvedAt1: number };
    };
    expect(stderr).toBe("");
    expect(commandResult.summary).toMatchObject({ trialCount: 4, resolvedAt1: 1 });

    const resultRoot = output.resolve(runId);
    const summary = JSON.parse(await readFile(path.join(resultRoot, "summary.json"), "utf8")) as {
      readonly counts: Readonly<Record<string, number>>;
    };
    expect(summary.counts).toMatchObject({ resolved: 4, unresolved: 0 });
    const trialRoot = path.join(resultRoot, "node-bearer-auth-trial-1");
    const trial = JSON.parse(await readFile(path.join(trialRoot, "result.json"), "utf8")) as {
      readonly taskDigest: string;
      readonly status: string;
      readonly changedPaths: readonly string[];
    };
    expect(trial).toMatchObject({
      status: "resolved",
      changedPaths: ["src/auth.mjs"],
    });
    expect(trial.taskDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(readFile(path.join(trialRoot, "trace.jsonl"), "utf8")).resolves.toContain(
      "evaluator.completed",
    );
    await expect(readFile(path.join(trialRoot, "diff.json"), "utf8")).resolves.toContain(
      "src/auth.mjs",
    );
    await expect(readFile(path.join(trialRoot, "evaluator.log"), "utf8")).resolves.toContain(
      '"resolved":true',
    );
  });

  it("base replay 被稳定分类为 unresolved，不污染 environment/evaluator 失败率", async () => {
    const output = await createTempWorkspace("m6-base-results-");
    workspaces.push(output);
    const { stdout } = await runHarness([
      "baseline",
      "--mode",
      "base",
      "--output",
      output.root,
      "--run-id",
      "m6-integration-base",
    ]);
    const result = JSON.parse(stdout) as {
      readonly summary: {
        readonly resolvedAt1: number;
        readonly counts: Readonly<Record<string, number>>;
      };
    };
    expect(result.summary.resolvedAt1).toBe(0);
    expect(result.summary.counts).toMatchObject({
      resolved: 0,
      unresolved: 4,
      environment_error: 0,
      evaluator_error: 0,
      policy_violation: 0,
    });
  });
});
