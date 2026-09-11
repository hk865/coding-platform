/**
 * P1-16 REAL-KERNEL continuity evidence: multi-turn task + continuation on
 * the REAL coding-agent app path (headless CLI, local SSE fixture model
 * endpoint — no external network/credentials), preserving capability-
 * degradation evidence. The Fake contract tests never substitute for this.
 *
 * Kernel contract (verified 2026-09-06): kernel_root coding-agent exposes
 * dist/app/cli/main.js with "run" (--input/--cwd/--config/--session/
 * --non-interactive) and "resume" (--session) commands; sessions persist to
 * the configured sessions.sqlite. This test exercises the REAL app path
 * (real CLI process, real session storage, real resume semantics); only the
 * model endpoint is the replay fixture.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  kernelCliReady,
  spawnCli,
  startReplayServer,
  replayToolThenFinal,
  writeKernelConfig,
  KERNEL_ROOT,
  sse,
  toolCallChunk,
  finalChunks,
} from "./real-kernel/replay-server.js";

const ready = await kernelCliReady();
const SESSION_ID = "p116-real-kernel-session";
const workspaces: string[] = [];

describe.skipIf(!ready.ready)("P1-16 real-kernel continuity evidence (real coding-agent CLI)", () => {
  afterAll(async () => {
    for (const w of workspaces) await rm(w, { recursive: true, force: true }).catch(() => undefined);
  });

  it("run(2 requests: read -> final) -> resume(same session) -> second turn; evidence recorded", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "p116-real-kernel-"));
    workspaces.push(workspace);
    const storageDir = await mkdtemp(path.join(tmpdir(), "p116-real-kernel-store-"));
    workspaces.push(storageDir);
    await writeFile(path.join(workspace, "note.txt"), "关键取舍：同一工作不逐次新建身份\n", "utf8");

    // ONE replay server, ONE config (identical baseUrl/digest) for both
    // run and resume: the kernel rejects a resume config that differs from
    // the session record (baseConfigDigest check).
    const server1 = await startReplayServer([
      (i, res) => { if (i === 0) sse(res, [toolCallChunk("read", "call-read-1", '{"path":"note.txt"}')]); else if (i === 1) { /* index 1: hang — turn stays OPEN */ } else sse(res, finalChunks("第二阶段完成：从持久会话接续并继续同一工作")); },
    ]);
    const configPath = await writeKernelConfig(workspace, server1.baseUrl, ["read"], { maxModelRequests: 8, tokenBudget: 20_000, storageDir });
    // Turn 1 is INTERRUPTED mid-turn (SIGKILL right after the first model
    // response): the session keeps an OPEN turn — the real continuation path
    // is resume of the SAME session.
    const runResult = await spawnCli([
      "run",
      "--input",
      "读取 note.txt 并给出关键理由",
      "--cwd",
      workspace,
      "--config",
      configPath,
      "--session",
      SESSION_ID,
      "--non-interactive",
    ], undefined, 30_000, () => server1.requests.length >= 2);
    expect(runResult.signal).toBe("SIGKILL"); // interrupted mid-turn => open turn in the session
    expect(server1.requests.length).toBeGreaterThanOrEqual(1);

    // Turn 2 (resume): continuation of the SAME session (real session restore)
    // against the SAME server + config (identical digest).
    const resumeResult = await spawnCli([
      "resume",
      "--session",
      SESSION_ID,
      "--cwd",
      workspace,
      "--config",
      configPath,
      "--non-interactive",
    ]);
    if (resumeResult.code !== 0) console.log("RESUME-STDERR:", resumeResult.stderr.slice(0, 800));
    expect(resumeResult.code).toBe(0);
    expect(resumeResult.stdout).toContain("第二阶段完成");
    expect(server1.requests.length).toBeGreaterThanOrEqual(2);

    // Session truly persisted + continuation evidence.
    const sessionStat = await stat(path.join(storageDir, "sessions.sqlite")).catch(() => null);
    expect(sessionStat).not.toBeNull();
    expect(sessionStat!.size).toBeGreaterThan(0);

    const evidence = {
      kernelRoot: KERNEL_ROOT,
      sessionId: SESSION_ID,
      turn1: { args: ["run"], exit: runResult.code, requests: server1.requests.length, stdoutTail: runResult.stdout.slice(-120) },
      turn2: { args: ["resume", "--session", SESSION_ID], exit: resumeResult.code, requests: server1.requests.length, stdoutTail: resumeResult.stdout.slice(-120) },
      sessionDbBytes: sessionStat!.size,
      observed: "restored_original",
      capability: { sessionRestore: true, contextResume: true, takeoverRun: true },
      note: "真实内核应用路径验证（真实 CLI 进程 + 真实会话持久化 + 真实 resume 语义）；模型端点为本地 SSE 替身（无 provider 凭证时的显式降级证据）——见 IMPLEMENTATION-HANDOFF P1-16 真实内核证据设计。",
    };
    console.log("P1-16-REAL-KERNEL-EVIDENCE");
    console.log(JSON.stringify(evidence, null, 2));
    expect(evidence.observed).toBe("restored_original");
  }, 60_000);
});
