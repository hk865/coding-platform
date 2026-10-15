/**
 * MF3 (R3) and the MF4 optional smoke: the Host's end of the gate pipe (fd 4)
 * must survive a stream error, and an exit after `r` but before release must
 * settle as `launcher_exited` (or as the real result if release won the race).
 *
 * Both rows use the new fake `bwrap` (`tests/helpers/RL-fake-bwrap.sh`) through
 * CODING_AGENT_BWRAP_PATH; its `forward` mode still execs /usr/bin/bwrap, so a
 * real bwrap and systemd user session are required. The child Host
 * (`RL-bwrap-child.mjs`) warms the capability probe in forward mode, then
 * switches the fake's mode and runs one capped command.
 *
 * Written here; run by the lead in WSL (§5.4). In the DSH sandbox the child
 * exits 3 with `{probed:{status:'unavailable',...}}` — it never skip-passes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installRLFakeBwrap,
  installRLFakeSystemdRun,
  makeRLWorkspace,
  removeRLWorkspace,
  requireRLCapabilities,
  type RLFakeBwrap,
  type RLFakeSystemd,
  type RLWorkspace,
} from "../helpers/RL-resource-caps-support.js";

const workspaces: RLWorkspace[] = [];
const fakes: RLFakeSystemd[] = [];
const bwraps: RLFakeBwrap[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    } catch {
      // already gone
    }
  }
  for (const fake of fakes.splice(0)) await fake.cleanup();
  for (const bwrap of bwraps.splice(0)) await bwrap.cleanup();
  for (const workspace of workspaces.splice(0)) await removeRLWorkspace(workspace);
});

async function workspace(): Promise<RLWorkspace> {
  const created = await makeRLWorkspace();
  workspaces.push(created);
  return created;
}

interface ChildOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function spawnGateChild(
  root: RLWorkspace,
  command: string,
  timeoutMs: number,
  bwrapMode: string,
): ChildProcess {
  const child = spawn(process.execPath, [path.resolve("tests/helpers/RL-bwrap-child.mjs")], {
    env: {
      ...process.env,
      RL_CHILD_ROOT: root.root,
      RL_CHILD_COMMAND: command,
      RL_CHILD_TIMEOUT_MS: String(timeoutMs),
      RL_CHILD_BWRAP_MODE: bwrapMode,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

function runChildToEnd(child: ChildProcess, timeoutMs: number): Promise<ChildOutput> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`the child did not finish within ${String(timeoutMs)} ms`));
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: code, stdout, stderr }); });
  });
}

function lastLine(text: string): string {
  const lines = text.split("\n").filter(line => line.length > 0);
  return lines[lines.length - 1] ?? "{}";
}

describe("RL-15c/RL-15d gate stream errors", () => {
  it("RL-15c a gate fd-4 stream error after release does not crash the Host", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const bwrap = await installRLFakeBwrap("forward");
    bwraps.push(bwrap);
    const root = await workspace();
    await requireRLCapabilities(root);
    const child = spawnGateChild(root, "printf 'hi'", 30_000, "gate-reset");
    const output = await runChildToEnd(child, 30_000);
    expect(output.exitCode, `child failed: ${output.stdout}${output.stderr}`).toBe(0);
    const payload = JSON.parse(lastLine(output.stdout)) as {
      readonly launchesBefore: number;
      readonly launchesAfter: number;
      readonly result?: unknown;
      readonly error?: unknown;
    };
    expect(payload.error).toBeUndefined();
    // The execute (not the warm probe) launched exactly one scope.
    expect(payload.launchesAfter - payload.launchesBefore).toBe(1);
    expect(payload.result).toEqual({
      exitCode: 7,
      signal: null,
      timedOut: false,
      cancelled: false,
      resourceCaps: {
        status: "applied",
        memoryMaxBytes: 268435456,
        tasksMax: 64,
        memory: "none_observed",
        processes: "none_observed",
        observationComplete: true,
      },
    });
  });

  it("RL-15d an exit after r but before release settles within 5 s and is never cancelled", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const bwrap = await installRLFakeBwrap("forward");
    bwraps.push(bwrap);
    const root = await workspace();
    await requireRLCapabilities(root);
    const child = spawnGateChild(root, "printf 'hi'", 60_000, "exit-after-r");
    const output = await runChildToEnd(child, 30_000);
    expect(output.exitCode, `child failed: ${output.stdout}${output.stderr}`).toBe(0);
    const payload = JSON.parse(lastLine(output.stdout)) as {
      readonly elapsedMs: number;
      readonly result?: {
        readonly exitCode: number | null;
        readonly cancelled: boolean;
        readonly resourceCaps: { readonly status: string };
      };
      readonly error?: { readonly code: string | null; readonly message: string };
    };
    // MF4 part 1: settlement must arrive well before the 60 s timeout.
    expect(payload.elapsedMs).toBeLessThan(5_000);
    if (payload.error !== undefined) {
      expect(payload.error.code).toBe("launch_failed");
      expect(payload.error.message.startsWith("launcher_exited:")).toBe(true);
      expect(payload.error.message.startsWith("deadline_before_start")).toBe(false);
    } else {
      expect(payload.result?.exitCode).toBe(9);
      expect(payload.result?.cancelled).toBe(false);
      expect(payload.result?.resourceCaps).toMatchObject({ status: "applied" });
    }
  });
});
