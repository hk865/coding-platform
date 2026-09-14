/**
 * 场景任务包 CI：runner 必须能发现全部场景、通过结构校验，执行隔离/防呆，
 * 并运行受控完成 fixture 的真实业务验收（防 near-miss 实现与分类漏洞）。
 */
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const runnerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "runner.mjs");
const scenariosRoot = path.dirname(runnerPath);
const reviewFixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "review",
  "fixtures",
);

interface ScenarioMeta {
  readonly scenarioId: string;
}

interface ValidationResult {
  readonly scenarioId: string;
  readonly status: "valid" | "invalid";
  readonly errors: readonly unknown[];
}

interface RunnerSpawn {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runRunnerSync(args: readonly string[]): RunnerSpawn {
  const spawned = spawnSync(process.execPath, [runnerPath, ...args], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    status: spawned.status,
    stdout: (spawned.stdout ?? "").trim(),
    stderr: (spawned.stderr ?? "").trim(),
  };
}

/** 从场景 base + 可选的 src 覆盖构建隔离工作区。 */
async function buildWorkspace(scenarioId: string, fixtureDir: string | null): Promise<string> {
  const target = await mkdtemp(path.join(os.tmpdir(), `scenario-ci-${scenarioId}-`));
  await cp(path.join(scenariosRoot, scenarioId, "base"), target, { recursive: true });
  if (fixtureDir) {
    await cp(path.join(reviewFixturesRoot, fixtureDir), path.join(target, "src"), {
      recursive: true,
    });
  }
  return target;
}

function runRunner(args: readonly string[]): unknown {
  const spawned = runRunnerSync(args);
  if (spawned.status !== 0 || spawned.stdout.length === 0) {
    throw new Error(
      `runner ${args.join(" ")} 失败（exit=${String(spawned.status)}）：${spawned.stderr.slice(0, 1_000)}`,
    );
  }
  return JSON.parse(spawned.stdout);
}

describe("tests/scenarios runner", () => {
  it("发现 bug-hunt 与 web-game 两个场景任务包", () => {
    const result = runRunner(["list"]) as { status: string; scenarios: readonly ScenarioMeta[] };
    expect(result.status).toBe("ok");
    const ids = result.scenarios.map((scenario) => scenario.scenarioId);
    expect(ids).toContain("bug-hunt");
    expect(ids).toContain("web-game");
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("全部场景任务包通过结构校验（必需文件、YAML 解析、验收器存在）", () => {
    const result = runRunner(["validate"]) as {
      status: string;
      results: readonly ValidationResult[];
    };
    expect(result.status).toBe("ok");
    expect(result.results.length).toBeGreaterThanOrEqual(2);
    for (const item of result.results) {
      expect(item.status, `${item.scenarioId} 任务包应 valid`).toBe("valid");
      expect(item.errors).toHaveLength(0);
    }
  });

  it("check 拒绝把场景目录或 base/ 直接作为 workspace（oracle 隔离防呆）", () => {
    for (const forbidden of [
      path.join(scenariosRoot, "bug-hunt"),
      path.join(scenariosRoot, "bug-hunt", "base"),
    ]) {
      const spawned = runRunnerSync(["check", "bug-hunt", "--workspace", forbidden]);
      expect(spawned.status, `workspace=${forbidden}`).not.toBe(0);
      const result = JSON.parse(spawned.stdout) as { status: string; detail: string };
      expect(result.status, `workspace=${forbidden}`).toBe("runner_error");
      expect(result.detail, `workspace=${forbidden}`).toContain(
        "不允许直接以场景目录或 base/ 作为 workspace",
      );
    }
  });

  it("check --from-base 生成隔离工作区并如实返回未修复基线的验收结果", async () => {
    const spawned = runRunnerSync(["check", "bug-hunt", "--from-base"]);
    expect(spawned.status).not.toBe(0); // acceptance_failed 时 runner 退出码非 0
    const result = JSON.parse(spawned.stdout) as {
      status: string;
      prepared: boolean;
      workspacePath: string;
    };
    expect(result.prepared).toBe(true);
    // 隔离工作区位于系统临时目录，不包含任务包（oracle 不可见）
    expect(result.workspacePath).not.toContain("tests/scenarios");
    // 未修复基线必须如实失败（不得降低验收标准），失败分类明确
    expect(result.status).toBe("acceptance_failed");
    await rm(result.workspacePath, { recursive: true, force: true });
  });

  it("受控完成 fixture 通过业务验收：bug-hunt minimart-fixed 与 web-game-complete", async () => {
    const bugHuntWorkspace = await buildWorkspace("bug-hunt", "minimart-fixed");
    const bugHunt = runRunnerSync(["check", "bug-hunt", "--workspace", bugHuntWorkspace]);
    expect(bugHunt.status, bugHunt.stderr).toBe(0);
    expect((JSON.parse(bugHunt.stdout) as { status: string }).status).toBe("pass");
    await rm(bugHuntWorkspace, { recursive: true, force: true });

    const webGameWorkspace = await buildWorkspace("web-game", null);
    await cp(path.join(reviewFixturesRoot, "web-game-complete"), webGameWorkspace, {
      recursive: true,
    });
    const webGame = runRunnerSync(["check", "web-game", "--workspace", webGameWorkspace]);
    expect(webGame.status, webGame.stderr).toBe(0);
    expect((JSON.parse(webGame.stdout) as { status: string }).status).toBe("pass");
    await rm(webGameWorkspace, { recursive: true, force: true });
  });

  it("near-miss 实现被官方 acceptance 的业务边界黑盒抓住（非法数量/幂等）", async () => {
    const workspace = await buildWorkspace("bug-hunt", "minimart-official-near-miss");
    const spawned = runRunnerSync(["check", "bug-hunt", "--workspace", workspace]);
    expect(spawned.status).not.toBe(0);
    const result = JSON.parse(spawned.stdout) as {
      status: string;
      acceptance: { checks: readonly { name: string; pass: boolean }[] };
    };
    expect(result.status).toBe("acceptance_failed");
    const failedNames = result.acceptance.checks
      .filter((item) => !item.pass)
      .map((item) => item.name);
    expect(failedNames).toContain("allocateStock 拒绝零/负数量且不改变库存");
    expect(failedNames).toContain("零/负数量订单行失败且不预留");
    expect(failedNames).toContain("同一订单重复调用不重复预留");
    await rm(workspace, { recursive: true, force: true });
  });
});
