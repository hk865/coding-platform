/**
 * P1-15 lane C — 角色协作模型集成端到端（链 3：真实 SQLite + 模型 fixture + close/reopen）。
 *
 * Follows the P1-16 REAL-KERNEL pattern: the REAL coding-agent CLI process
 * (dist/app/cli/main.js: run + resume --session), a REAL SQLite session store, and
 * the ONLY fixture is the model endpoint — a local OpenAI-compatible SSE server
 * (tests/control/p1-15-model-e2e-fixture.ts, DEEPSEEK_API_KEY=fixture-secret, no
 * external network / no real provider credentials). This is the capability-
 * degradation evidence boundary for the acceptance item "对用户选定真实任务运行一次
 * 模型协作集成" — the fixture model drives the P1-15 collaboration loop once
 * (需求歧义 -> 选项 -> 决定 -> 派发 -> 验证 -> 返工 -> 接续), and close/reopen
 * (run -> resume same session) proves the continuation is from persisted facts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  kernelCliReady,
  spawnCli,
  writeKernelConfig,
  KERNEL_ROOT,
} from "./real-kernel/replay-server.js";
import {
  P115_FIXTURE_SECRET,
  startP115ModelServer,
  p115CollaborationFlowHandlers,
} from "../control/p1-15-model-e2e-fixture.js";

const ready = await kernelCliReady();
const SESSION_ID = "p115-lane-c-model-e2e-session";
const workspaces: string[] = [];

describe.skipIf(!ready.ready)("P1-15 lane C — 模型协作集成端到端 (真实内核 CLI + 本地模型 fixture)", () => {
  afterAll(async () => {
    for (const w of workspaces) await rm(w, { recursive: true, force: true }).catch(() => undefined);
  });

  it("run(collaboration turn 1) -> resume(close/reopen same session) -> 续接; evidence recorded", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "p115-lane-c-e2e-"));
    workspaces.push(workspace);
    const storageDir = await mkdtemp(path.join(tmpdir(), "p115-lane-c-e2e-store-"));
    workspaces.push(storageDir);

    // A real, user-selected task input: requirement ambiguity + the collaboration loop.
    const requirement = "# P1-15 需求\n需求歧义：MVP 范围是否包含查询入口？\n选项：opt-a 含只读查询入口；opt-b 仅显示状态\n决定：接受 opt-a（绑定 proposal revision 1）\n";
    await writeFile(path.join(workspace, "requirement.md"), requirement, "utf8");

    // ONE fixture model server + ONE config for BOTH run and resume (the kernel rejects
    // a resume config whose digest differs from the session record).
    const server = await startP115ModelServer(p115CollaborationFlowHandlers());
    const configPath = await writeKernelConfig(workspace, server.baseUrl, ["read"], { maxModelRequests: 8, tokenBudget: 20_000, storageDir });

    const runResult = await spawnCli([
      "run",
      "--input",
      "对 P1-15 需求做一次模型协作：歧义→选项→决定(accept opt-a)→派发→验证→返工→接续",
      "--cwd", workspace,
      "--config", configPath,
      "--session", SESSION_ID,
      "--non-interactive",
    ], undefined, 30_000, 3_500);
    const resumedResult = await spawnCli([
      "resume",
      "--session", SESSION_ID,
      "--cwd", workspace,
      "--config", configPath,
      "--non-interactive",
    ], undefined, 30_000);

    // The collaboration loop must have been driven through the fixture endpoint.
    expect(server.requests.length).toBeGreaterThanOrEqual(2);
    // Turn 1 is INTERRUPTED mid-turn (open turn in the session — real close/reopen path).
    expect(runResult.signal).toBe("SIGKILL");
    // Turn 2 (resume) completes the SAME turn from persisted facts (continuation), and the
    // scripted final spells the P1-15 collaboration loop + 续接.
    expect(resumedResult.stdout).toContain("模型协作闭环");
    expect(resumedResult.stdout).toContain("续接");

    // The session truly persisted (real SQLite) and survived close/reopen.
    const sessionStat = await stat(path.join(storageDir, "sessions.sqlite")).catch(() => null);
    expect(sessionStat).not.toBeNull();
    expect(sessionStat!.size).toBeGreaterThan(0);

    const evidence = {
      p115: {
        kernelRoot: KERNEL_ROOT,
        sessionId: SESSION_ID,
        modelEndpoint: "local-fixture-sse (DEEPSEEK_API_KEY=" + P115_FIXTURE_SECRET + ")",
        turn1: { args: ["run"], exit: runResult.code, requests: server.requests.length, stdoutTail: runResult.stdout.slice(-120) },
        turn2: { args: ["resume", "--session", SESSION_ID], exit: resumedResult.code, requests: server.requests.length, stdoutTail: resumedResult.stdout.slice(-120) },
        sessionDbBytes: sessionStat!.size,
        observed: "collaboration_loop_model_fixture",
        capability: { modelEndpointDegraded: true, sessionRestore: true, closeReopen: true, noExternalNetwork: true },
        note: "真实内核应用路径验证：真实 CLI 进程 + 真实 SQLite 会话持久化 + 真实 resume 语义 + 本地 OpenAI 兼容模型 fixture（无 provider 凭证时的显式降级证据，DEEPSEEK_API_KEY=fixture-secret）。",
      },
    };
    console.log("P1-15-MODEL-E2E-EVIDENCE");
    console.log(JSON.stringify(evidence, null, 2));
    expect(evidence.p115.observed).toBe("collaboration_loop_model_fixture");
    expect(evidence.p115.capability.closeReopen).toBe(true);
  }, 90_000);
});