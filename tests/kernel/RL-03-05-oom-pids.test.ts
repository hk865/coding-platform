/**
 * RE1 rows RL-03, RL-03b, RL-03c, RL-04, RL-05: memory and task-count pressure
 * (spec §5.2). The python fixtures under tests/helpers are copied into the
 * workspace because the sandbox mounts only /workspace.
 *
 * Written here; run by the lead in WSL (§5.4): in the DSH sandbox `execute`
 * throws `sandbox_unavailable`.
 */
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RL_IDENTITY,
  RL_MIB,
  delay,
  fixedSource,
  identityMarker,
  makeRLSandbox,
  makeRLWorkspace,
  markedSleep,
  pgrepMarked,
  readIfExists,
  removeRLWorkspace,
  runRL,
  unitNameOf,
  waitForPath,
  waitForUnitNotFound,
  type RLWorkspace,
} from "../helpers/RL-resource-caps-support.js";

const workspaces: RLWorkspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await removeRLWorkspace(workspace);
});

async function workspace(): Promise<RLWorkspace> {
  const created = await makeRLWorkspace();
  workspaces.push(created);
  return created;
}

/** Reads the scope unit the command wrote into the identity marker (spec §5.2 RE1). */
async function unitFromIdentity(root: RLWorkspace): Promise<string> {
  const identity = (await readIfExists(path.join(root.root, RL_IDENTITY))) ?? "";
  return unitNameOf(identity);
}

const caps = fixedSource({ memoryMaxBytes: 256 * RL_MIB, tasksMax: 64 });

async function installFixture(workspace: RLWorkspace, name: string): Promise<void> {
  await copyFile(path.resolve(`tests/helpers/${name}`), path.join(workspace.root, name));
}

describe("RL-03..RL-05 memory and task caps", () => {
  it("RL-03 a memory-cap OOM ends the whole command and removes the marked process and scope", async () => {
    const root = await workspace();
    await installFixture(root, "RL-memory.py");
    const sandbox = await makeRLSandbox(root, caps);
    const marker = "rl-after-oom-marker";
    const startedAt = performance.now();
    // Item 9/R7: the command writes its own cgroup first (spec §5.2 RE1), so the
    // unit can be checked from outside after the OOM. The marked sleep carries
    // the marker as argv[0] (`markedSleep`), and the touch stays its own step.
    const running = runRL(
      sandbox,
      `${identityMarker()}; python3 /workspace/RL-memory.py; `
        + `touch /workspace/.rl-after-oom; ${markedSleep(marker)}`,
      20_000,
    );
    running.catch(() => undefined);
    expect(await waitForPath(path.join(root.root, RL_IDENTITY), 10_000)).toBe(true);
    const result = await running;
    expect(result.resourceCaps).toMatchObject({ status: "applied", memory: "cap_hit" });
    expect(performance.now() - startedAt).toBeLessThan(10_000);
    // R7: read the unit only after settlement. Reading it before the result
    // needs an extra await, which lets the Host observe Δoom and SIGKILL bwrap
    // before bash reaches the marked `exec -a`; that makes a pre-result "the
    // marked pid must have existed" check racy, so R7 keeps only the retained
    // marker (the definite `[]` below) and the unit-not-found check.
    const unit = await unitFromIdentity(root);
    expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
    const goneDeadline = performance.now() + 2_000;
    while (performance.now() < goneDeadline && pgrepMarked(marker).length > 0) await delay(50);
    // `pgrepMarked` returns [] only for a definite no-match (item 9), never for
    // a failed pgrep.
    expect(pgrepMarked(marker)).toEqual([]);
    expect(await waitForUnitNotFound(unit, 2_000)).toBe(true);
    expect(await runRL(await makeRLSandbox(root, caps), "true")).toMatchObject({
      resourceCaps: { status: "applied", memory: "none_observed" },
    });
  });

  it("RL-03b when the OOM kills the main process, a seen Δoom is still cap_hit", async () => {
    const root = await workspace();
    await installFixture(root, "RL-memory.py");
    const sandbox = await makeRLSandbox(root, caps);
    const result = await runRL(sandbox, "python3 /workspace/RL-memory.py", 20_000);
    expect(result.resourceCaps).toMatchObject({ status: "applied", memory: "cap_hit" });
  });

  it("RL-03c a command that handles the OOM and exits 0 is still cap_hit", async () => {
    const root = await workspace();
    await installFixture(root, "RL-memory.py");
    const sandbox = await makeRLSandbox(root, caps);
    const result = await runRL(
      sandbox,
      "python3 /workspace/RL-memory.py & wait || true; exit 0",
      20_000,
    );
    expect(result.resourceCaps).toMatchObject({ status: "applied", memory: "cap_hit" });
    expect(result.exitCode === 0 || result.signal === "SIGKILL").toBe(true);
  });

  it("RL-04 fork rejection is reported as processes cap_hit and memory none_observed", async () => {
    const root = await workspace();
    await installFixture(root, "RL-fork.py");
    const sandbox = await makeRLSandbox(root, caps);
    const result = await runRL(sandbox, "python3 /workspace/RL-fork.py", 20_000);
    expect(result.exitCode).toBe(0);
    expect(result.resourceCaps).toEqual({
      status: "applied",
      memoryMaxBytes: 268435456,
      tasksMax: 64,
      memory: "none_observed",
      processes: "cap_hit",
      observationComplete: true,
    });
    const created = Number(result.stdout.text.trim().split("\n").pop());
    expect(Number.isSafeInteger(created)).toBe(true);
    expect(created).toBeLessThan(64);
  });

  it("RL-05 thread rejection is processes cap_hit with a tiny peak RSS", async () => {
    const root = await workspace();
    await installFixture(root, "RL-thread.py");
    const sandbox = await makeRLSandbox(root, caps);
    const result = await runRL(sandbox, "python3 /workspace/RL-thread.py", 20_000);
    expect(result.exitCode).toBe(0);
    expect(result.resourceCaps).toMatchObject({ status: "applied", processes: "cap_hit", observationComplete: true });
    const [, peakKib] = result.stdout.text.trim().split("\n").pop()?.split(/\s+/) ?? [];
    expect(Number(peakKib) / 1024).toBeLessThan(64);
  });
});
