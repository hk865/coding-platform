/**
 * RE1 rows RL-06, RL-07, RL-07b, RL-08, RL-08b, RL-09, RL-09b, RL-10, RL-10b,
 * RL-10c, RL-11: stop, timeout, Host death, no retry (spec §5.2).
 *
 * Round 2 (items 8, 9, SF1): the child Host warms its own probe and waits for a
 * `go` line; the marked command carries the marker as argv[0] (`exec -a`); the
 * unit and pid are read from the scope and the fake's log; a failed read never
 * becomes "absent"; and every pre-start cancel reports `not_started`.
 *
 * Written here; run by the lead in WSL (§5.4): in the DSH sandbox `execute`
 * throws `sandbox_unavailable`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RL_IDENTITY,
  RL_MIB,
  cgroupProcs,
  cmdlineOf,
  delay,
  fixedSource,
  identityMarker,
  installRLFakeSystemdRun,
  makeRLSandbox,
  makeRLWorkspace,
  markedSleep,
  pgrepMarked,
  procExists,
  ProcessSandboxError,
  readIfExists,
  readLines,
  removeRLWorkspace,
  requireRLCapabilities,
  runRL,
  systemctlUserShow,
  unitNameOf,
  waitForPath,
  waitForUnitNotFound,
  type RLFakeSystemd,
  type RLWorkspace,
} from "../helpers/RL-resource-caps-support.js";

const workspaces: RLWorkspace[] = [];
const fakes: RLFakeSystemd[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    try {
      await killAndReap(child);
    } catch {
      // The child is already gone.
    }
  }
  for (const fake of fakes.splice(0)) await fake.cleanup();
  for (const workspace of workspaces.splice(0)) await removeRLWorkspace(workspace);
});

async function workspace(): Promise<RLWorkspace> {
  const created = await makeRLWorkspace();
  workspaces.push(created);
  return created;
}

const caps = fixedSource({ memoryMaxBytes: 256 * RL_MIB, tasksMax: 64 });

function spawnChild(root: RLWorkspace, command: string): ChildProcess {
  const child = spawn(process.execPath, [path.resolve("tests/helpers/RL-child-node.mjs")], {
    env: {
      ...process.env,
      RL_CHILD_ROOT: root.root,
      RL_CHILD_COMMAND: command,
      RL_CHILD_TIMEOUT_MS: "60000",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

/** Read the first stdout line (the child's ready line), then drain the rest. */
function firstStdoutLine(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = child.stdout;
    if (stream === null) {
      reject(new Error("the child has no stdout pipe"));
      return;
    }
    let buffer = "";
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const index = buffer.indexOf("\n");
      if (index >= 0) {
        const line = buffer.slice(0, index);
        cleanup();
        stream.resume();
        resolve(line);
      }
    };
    const onEnd = (): void => {
      cleanup();
      reject(new Error("the child's stdout ended before the ready line"));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`the child ready line did not arrive within ${String(timeoutMs)} ms`));
    }, timeoutMs);
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

async function childReady(child: ChildProcess): Promise<unknown> {
  return JSON.parse(await firstStdoutLine(child, 20_000)) as unknown;
}

function childGo(child: ChildProcess): void {
  child.stdin?.write("go\n");
}

async function killAndReap(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}

async function unitFromIdentity(root: RLWorkspace): Promise<string> {
  const identity = (await readIfExists(path.join(root.root, RL_IDENTITY))) ?? "";
  return unitNameOf(identity);
}

describe("RL-06..RL-11 stop and death", () => {
  it("RL-06 a cancel after release stops the whole command and removes the scope", async () => {
    const root = await workspace();
    await requireRLCapabilities(root);
    const sandbox = await makeRLSandbox(root, caps);
    const controller = new AbortController();
    const running = sandbox.execute({
      command: `${identityMarker()}; touch /workspace/.rl-marked; ${markedSleep("rl-06-marker")}`,
      cwd: ".",
      timeoutMs: 30_000,
      outputLimitBytes: 64 * 1024,
      signal: controller.signal,
    });
    running.catch(() => undefined);
    expect(await waitForPath(path.join(root.root, ".rl-marked"), 10_000)).toBe(true);
    const unit = await unitFromIdentity(root);
    expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
    expect(pgrepMarked("rl-06-marker").length).toBe(1);
    controller.abort();
    const result = await running;
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.resourceCaps).toMatchObject({
      status: "applied",
      memoryMaxBytes: 268435456,
      tasksMax: 64,
      observationComplete: true,
    });
    const deadline = performance.now() + 2_000;
    while (performance.now() < deadline && pgrepMarked("rl-06-marker").length > 0) await delay(50);
    expect(pgrepMarked("rl-06-marker")).toEqual([]);
    expect(await waitForUnitNotFound(unit, 2_000)).toBe(true);
  });

  it("RL-07 a timeout after release stops the whole command and removes the scope", async () => {
    const root = await workspace();
    await requireRLCapabilities(root);
    const sandbox = await makeRLSandbox(root, caps);
    const running = runRL(
      sandbox,
      `${identityMarker()}; touch /workspace/.rl-marked; ${markedSleep("rl-07-marker")}`,
      2_000,
    );
    running.catch(() => undefined);
    expect(await waitForPath(path.join(root.root, ".rl-marked"), 10_000)).toBe(true);
    const unit = await unitFromIdentity(root);
    expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
    expect(pgrepMarked("rl-07-marker").length).toBe(1);
    const result = await running;
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.resourceCaps).toMatchObject({
      status: "applied",
      memoryMaxBytes: 268435456,
      tasksMax: 64,
      observationComplete: true,
    });
    const deadline = performance.now() + 2_000;
    while (performance.now() < deadline && pgrepMarked("rl-07-marker").length > 0) await delay(50);
    expect(pgrepMarked("rl-07-marker")).toEqual([]);
    expect(await waitForUnitNotFound(unit, 2_000)).toBe(true);
  });

  it("RL-07b a slow launch with a short deadline fails as deadline_before_start and does not re-probe", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const hot = await makeRLSandbox(root, caps);
    expect((await runRL(hot, "true", 20_000)).exitCode).toBe(0);
    fake.setMode("sleep", { RL_FAKE_SYSTEMD_SLEEP: "2" });
    const sandbox = await makeRLSandbox(root, caps);
    let deadlineError: unknown;
    try {
      await runRL(sandbox, "touch /workspace/.rl-early", 1_000);
    } catch (error) {
      deadlineError = error;
    }
    expect(deadlineError).toBeInstanceOf(ProcessSandboxError);
    expect((deadlineError as ProcessSandboxError).code).toBe("launch_failed");
    expect((deadlineError as Error).message.startsWith("deadline_before_start")).toBe(true);
    // A launch failure is not a timed-out result: the error carries no timedOut.
    expect(Object.prototype.hasOwnProperty.call(deadlineError as object, "timedOut")).toBe(false);
    const before = await fake.invocations();
    fake.setMode("forward");
    await runRL(await makeRLSandbox(root, caps), "true", 20_000);
    const after = await fake.invocations();
    expect(await readIfExists(path.join(root.root, ".rl-early"))).toBeNull();
    expect(after.filter(line => line.includes("cap_literal")).length)
      .toBe(before.filter(line => line.includes("cap_literal")).length);
  });

  it("RL-08 the command does not outlive a Host killed after release", async () => {
    const root = await workspace();
    await requireRLCapabilities(root);
    const child = spawnChild(
      root,
      `${identityMarker()}; touch /workspace/.rl-marked; ${markedSleep("rl-08-marker")}`,
    );
    expect(await childReady(child)).toEqual({ probed: { status: "available" } });
    childGo(child);
    expect(await waitForPath(path.join(root.root, ".rl-marked"), 10_000)).toBe(true);
    const unit = await unitFromIdentity(root);
    expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
    expect(pgrepMarked("rl-08-marker").length).toBe(1);
    await killAndReap(child);
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline && pgrepMarked("rl-08-marker").length > 0) await delay(100);
    expect(pgrepMarked("rl-08-marker")).toEqual([]);
    expect(await waitForUnitNotFound(unit, 5_000)).toBe(true);
  });

  it("RL-08b a Host killed between bwrap exit and the final read still drains the keeper", async () => {
    const root = await workspace();
    await requireRLCapabilities(root);
    const lines = path.join(root.root, ".rl-lines");
    const child = spawnChild(
      root,
      `${identityMarker()}; printf 'one\\n' >> /workspace/.rl-lines; sleep 0.5; exit 0`,
    );
    expect(await childReady(child)).toEqual({ probed: { status: "available" } });
    childGo(child);
    expect(await waitForPath(lines, 10_000)).toBe(true);
    const unit = await unitFromIdentity(root);
    expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
    child.kill("SIGSTOP");
    await delay(1_000);
    expect(await readLines(lines)).toEqual(["one"]);
    expect(systemctlUserShow(unit)).toMatch(/ActiveState=active/);
    const identityText = (await readIfExists(path.join(root.root, RL_IDENTITY))) ?? "";
    const keepers = await Promise.all(
      (await cgroupProcs(identityText)).map(async pid => (await cmdlineOf(pid)).includes("agent-keeper")),
    );
    expect(keepers.some(Boolean), "the keeper must still hold the scope").toBe(true);
    expect(await waitForUnitNotFound(unit, 1_000)).toBe(false);
    await killAndReap(child);
    expect(await waitForUnitNotFound(unit, 5_000)).toBe(true);
    expect(await readLines(lines)).toEqual(["one"]);
  });

  it("RL-09 a Host killed while the launcher is stuck cannot start the command", { timeout: 60_000 }, async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const external = path.join(root.root, "rl-09-external");
    const child = spawnChild(root, "touch /workspace/.rl-09");
    expect(await childReady(child)).toEqual({ probed: { status: "available" } });
    fake.setMode("wait-external", { RL_FAKE_SYSTEMD_EXTERNAL: external });
    childGo(child);
    try {
      const deadline = performance.now() + 10_000;
      let launch = "";
      while (performance.now() < deadline) {
        launch = (await fake.invocations()).find(line => line.includes(".rl-09")) ?? "";
        if (launch !== "") break;
        await delay(50);
      }
      expect(launch).toContain(".rl-09");
      const unit = /--unit=([^\s]+)/.exec(launch)?.[1] ?? "";
      const pid = /pid=(\d+)/.exec(launch)?.[1] ?? "";
      expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
      expect(pid).not.toBe("");
      await killAndReap(child);
      await writeFile(external, "");
      const goneDeadline = performance.now() + 10_000;
      while (performance.now() < goneDeadline && procExists(Number(pid))) await delay(100);
      expect(procExists(Number(pid)), "the stuck launcher/gate must have exited").toBe(false);
      expect(await waitForUnitNotFound(unit, 10_000)).toBe(true);
    } finally {
      await writeFile(external, "").catch(() => undefined);
    }
    expect(await readIfExists(path.join(root.root, ".rl-09"))).toBeNull();
  });

  it("RL-09b a Host killed while the gate waits for g cannot start the command", { timeout: 60_000 }, async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const started = path.join(root.root, "rl-09b-started");
    const child = spawnChild(root, "touch /workspace/.rl-09b");
    expect(await childReady(child)).toEqual({ probed: { status: "available" } });
    fake.setMode("write-started", { RL_FAKE_SYSTEMD_STARTED: started });
    childGo(child);
    expect(await waitForPath(started, 10_000)).toBe(true);
    child.kill("SIGSTOP");
    const deadline = performance.now() + 10_000;
    let launch = "";
    while (performance.now() < deadline) {
      launch = (await fake.invocations()).find(line => line.includes(".rl-09b")) ?? "";
      if (launch !== "") break;
      await delay(50);
    }
    expect(launch).toContain(".rl-09b");
    const unit = /--unit=([^\s]+)/.exec(launch)?.[1] ?? "";
    expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
    const activeDeadline = performance.now() + 5_000;
    let active = false;
    while (performance.now() < activeDeadline && !active) {
      try {
        active = /ActiveState=active/.test(systemctlUserShow(unit));
      } catch {
        // The fake still sleeps before exec'ing the real launcher, so the unit
        // may not exist yet. A persistent failure still fails the final assert.
      }
      if (!active) await delay(100);
    }
    expect(active, "the gate must be waiting in an active scope").toBe(true);
    expect(systemctlUserShow(unit)).toMatch(/ActiveState=active/);
    expect(await readIfExists(path.join(root.root, ".rl-09b"))).toBeNull();
    await killAndReap(child);
    expect(await waitForUnitNotFound(unit, 5_000)).toBe(true);
    expect(await readIfExists(path.join(root.root, ".rl-09b"))).toBeNull();
  });

  it("RL-10 (a) a launcher failure reports launch_failed without running the command, then re-probes", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const hot = await makeRLSandbox(root, caps);
    expect((await runRL(hot, "true", 20_000)).exitCode).toBe(0);
    fake.setMode("fail-start");
    await expect(runRL(await makeRLSandbox(root, caps), "printf 'x\\n' >> /workspace/.rl-lines"))
      .rejects.toBeInstanceOf(ProcessSandboxError);
    expect(await readLines(path.join(root.root, ".rl-lines"))).toEqual([]);
    const before = await fake.invocations();
    fake.setMode("forward");
    await runRL(await makeRLSandbox(root, caps), "true", 20_000);
    const after = await fake.invocations();
    expect(after.filter(line => line.includes("cap_literal")).length)
      .toBeGreaterThan(before.filter(line => line.includes("cap_literal")).length);
  });

  it("RL-10 (b) a launcher that skips the scope fails the identity check without running the command", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const hot = await makeRLSandbox(root, caps);
    expect((await runRL(hot, "true", 20_000)).exitCode).toBe(0);
    fake.setMode("no-scope");
    await expect(runRL(await makeRLSandbox(root, caps), "printf 'x\\n' >> /workspace/.rl-lines"))
      .rejects.toMatchObject({ code: "launch_failed" });
    expect(await readLines(path.join(root.root, ".rl-lines"))).toEqual([]);
  });

  it("RL-10 (c) a released command that exits 3 reports the exit code and one line", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const hot = await makeRLSandbox(root, caps);
    expect((await runRL(hot, "true", 20_000)).exitCode).toBe(0);
    const result = await runRL(
      await makeRLSandbox(root, caps),
      "printf 'x\\n' >> /workspace/.rl-lines; exit 3",
    );
    expect(result.exitCode).toBe(3);
    expect(result.resourceCaps).toMatchObject({ status: "applied" });
    expect(await readLines(path.join(root.root, ".rl-lines"))).toEqual(["x"]);
  });

  it("RL-10 (d) a command killed after release is reported as it is and never re-run", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const hot = await makeRLSandbox(root, caps);
    expect((await runRL(hot, "true", 20_000)).exitCode).toBe(0);
    const launches = async (): Promise<number> =>
      (await fake.invocations()).filter(line => line.includes("agent-keeper")).length;
    const before = await launches();
    const sandbox = await makeRLSandbox(root, caps);
    const running = runRL(
      sandbox,
      `printf 'x\\n' >> /workspace/.rl-lines; ${markedSleep("rl-10d-marker")}`,
      20_000,
    );
    running.catch(() => undefined);
    expect(await waitForPath(path.join(root.root, ".rl-lines"), 10_000)).toBe(true);
    await delay(200);
    const pids = pgrepMarked("rl-10d-marker");
    expect(pids.length).toBe(1);
    process.kill(pids[0]!, "SIGKILL");
    await running;
    expect(await readLines(path.join(root.root, ".rl-lines"))).toEqual(["x"]);
    // Exactly one launch for this execute; the hot canary/command are in `before`.
    expect(await launches()).toBe(before + 1);
  });

  it("RL-10b a cancel while waiting for r is a not-started cancel and does not re-probe", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const hot = await makeRLSandbox(root, caps);
    expect((await runRL(hot, "true", 20_000)).exitCode).toBe(0);
    fake.setMode("sleep", { RL_FAKE_SYSTEMD_SLEEP: "2" });
    const sandbox = await makeRLSandbox(root, caps);
    const controller = new AbortController();
    const running = sandbox.execute({
      command: "touch /workspace/.rl-early",
      cwd: ".",
      timeoutMs: 30_000,
      outputLimitBytes: 64 * 1024,
      signal: controller.signal,
    });
    running.catch(() => undefined);
    await delay(500);
    controller.abort();
    const result = await running;
    expect(result).toMatchObject({ cancelled: true, exitCode: null, resourceCaps: { status: "not_started" } });
    expect(await readIfExists(path.join(root.root, ".rl-early"))).toBeNull();
    const invocationText = (await fake.invocations()).join("\n");
    const units = [...invocationText.matchAll(/--unit=([^\s]+)/g)].map(match => match[1] ?? "");
    const unit = units[units.length - 1] ?? "";
    expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
    expect(await waitForUnitNotFound(unit, 5_000)).toBe(true);
    // A cancel before release must not invalidate the capability cache.
    const before = await fake.invocations();
    fake.setMode("forward");
    expect((await runRL(await makeRLSandbox(root, caps), "true", 20_000)).exitCode).toBe(0);
    const after = await fake.invocations();
    expect(after.filter(line => line.includes("cap_literal")).length)
      .toBe(before.filter(line => line.includes("cap_literal")).length);
  });

  it("RL-10b (2) a pre-start cancel without usable caps is not_started and runs nothing", async () => {
    const root = await workspace();
    await requireRLCapabilities(root);

    // (a) the caller did not wire resourceCaps (`not_configured`).
    const noCaps = await makeRLSandbox(root);
    const noCapsController = new AbortController();
    noCapsController.abort();
    const noCapsResult = await noCaps.execute({
      command: "touch /workspace/.rl-pre",
      cwd: ".",
      timeoutMs: 30_000,
      outputLimitBytes: 64 * 1024,
      signal: noCapsController.signal,
    });
    expect(noCapsResult).toMatchObject({
      cancelled: true,
      timedOut: false,
      exitCode: null,
      resourceCaps: { status: "not_started" },
    });

    // (b) caps are wired but systemd-run is missing (`no_systemd_run`).
    const previous = process.env["CODING_AGENT_SYSTEMD_RUN_PATH"];
    process.env["CODING_AGENT_SYSTEMD_RUN_PATH"] = "/nonexistent/rl-systemd-run";
    try {
      const noSystemd = await makeRLSandbox(root, caps);
      const controller = new AbortController();
      controller.abort();
      const result = await noSystemd.execute({
        command: "touch /workspace/.rl-pre",
        cwd: ".",
        timeoutMs: 30_000,
        outputLimitBytes: 64 * 1024,
        signal: controller.signal,
      });
      expect(result).toMatchObject({
        cancelled: true,
        timedOut: false,
        exitCode: null,
        resourceCaps: { status: "not_started" },
      });
    } finally {
      if (previous === undefined) delete process.env["CODING_AGENT_SYSTEMD_RUN_PATH"];
      else process.env["CODING_AGENT_SYSTEMD_RUN_PATH"] = previous;
    }
    expect(await readIfExists(path.join(root.root, ".rl-pre"))).toBeNull();
  });

  it("RL-10b (3) a capped pre-start cancel is not_started and launches nothing", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const hot = await makeRLSandbox(root, caps);
    expect((await runRL(hot, "true", 20_000)).exitCode).toBe(0);
    const launches = async (): Promise<number> =>
      (await fake.invocations()).filter(line => line.includes("agent-keeper")).length;
    const before = await launches();
    const sandbox = await makeRLSandbox(root, caps);
    const controller = new AbortController();
    controller.abort();
    const result = await sandbox.execute({
      command: "touch /workspace/.rl-pre",
      cwd: ".",
      timeoutMs: 30_000,
      outputLimitBytes: 64 * 1024,
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      cancelled: true,
      timedOut: false,
      exitCode: null,
      resourceCaps: { status: "not_started" },
    });
    expect(await readIfExists(path.join(root.root, ".rl-pre"))).toBeNull();
    await delay(100);
    expect(await launches(), "an abort before start must spawn nothing").toBe(before);
  });

  it("RL-10c cancel racing release never runs the command twice and never leaks a line", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    const hot = await makeRLSandbox(root, caps);
    expect((await runRL(hot, "true", 20_000)).exitCode).toBe(0);
    const launches = async (): Promise<number> =>
      (await fake.invocations()).filter(line => line.includes("agent-keeper")).length;
    for (let index = 0; index < 50; index += 1) {
      // Each iteration starts from an empty race file; the old test accumulated lines.
      await writeFile(path.join(root.root, ".rl-race"), "");
      const before = await launches();
      const sandbox = await makeRLSandbox(root, caps);
      const controller = new AbortController();
      const running = sandbox.execute({
        command: "printf 'x\\n' >> /workspace/.rl-race",
        cwd: ".",
        timeoutMs: 30_000,
        outputLimitBytes: 64 * 1024,
        signal: controller.signal,
      });
      running.catch(() => undefined);
      await delay(Math.floor(Math.random() * 30));
      controller.abort();
      const result = await running;
      const lines = await readLines(path.join(root.root, ".rl-race"));
      if (result.resourceCaps.status === "not_started") {
        expect(lines.length, `iteration ${String(index)}`).toBe(0);
      } else {
        expect(result.cancelled || result.exitCode === 0, `iteration ${String(index)}`).toBe(true);
        expect(lines.length, `iteration ${String(index)}`).toBeLessThanOrEqual(1);
      }
      // One execute = never more than one launcher invocation (the probe cache
      // is warm). An abort during preparation legitimately yields 0 launches
      // (SF1 fix 3). Give a killed launcher a moment to flush its own log line.
      await delay(50);
      if (result.resourceCaps.status === "applied") {
        expect(await launches(), `iteration ${String(index)}`).toBe(before + 1);
      } else {
        expect(await launches(), `iteration ${String(index)}`).toBeLessThanOrEqual(before + 1);
      }
    }
  });

  it("RL-11 a command killed from outside still reads complete counters and matches the uncapped exit", async () => {
    const root = await workspace();
    await requireRLCapabilities(root);
    const killMarked = async (
      sandbox: Awaited<ReturnType<typeof makeRLSandbox>>,
      marker: string,
    ) => {
      const running = runRL(sandbox, markedSleep(marker), 20_000);
      running.catch(() => undefined);
      const deadline = performance.now() + 10_000;
      let pids: number[] = [];
      while (performance.now() < deadline && pids.length === 0) {
        pids = pgrepMarked(marker);
        if (pids.length === 0) await delay(100);
      }
      expect(pids.length, marker).toBe(1);
      process.kill(pids[0]!, "SIGKILL");
      return running;
    };
    const capped = await killMarked(await makeRLSandbox(root, caps), "rl-11-capped");
    expect(capped.resourceCaps).toMatchObject({
      status: "applied",
      memory: "none_observed",
      processes: "none_observed",
      observationComplete: true,
    });
    const uncapped = await killMarked(await makeRLSandbox(root), "rl-11-uncapped");
    expect(capped.exitCode).toBe(uncapped.exitCode);
    expect(capped.signal).toBe(uncapped.signal);
  });
});
