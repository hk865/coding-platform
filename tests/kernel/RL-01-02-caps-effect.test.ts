/**
 * RE1 rows RL-01, RL-02, RL-02b, RL-02c: the caps take effect and the capped
 * command is indistinguishable from the uncapped one (spec §5.2).
 *
 * Entry: real `ProcessSandbox.execute` with a fixed `ResourceCapSource` and a
 * real bubblewrap + systemd user session. Written here; run by the lead in WSL
 * (§5.4): in the DSH sandbox `execute` throws `sandbox_unavailable`.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RL_IDENTITY,
  RL_MIB,
  RL_RELEASE,
  backgroundWorker,
  cgroupValue,
  delay,
  fixedSource,
  identityAndWait,
  makeRLSandbox,
  makeRLWorkspace,
  readIfExists,
  readLines,
  removeRLWorkspace,
  requireRLCapabilities,
  runRL,
  systemctlUserShow,
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

const caps = fixedSource({ memoryMaxBytes: 256 * RL_MIB, tasksMax: 64 });

describe("RL-01..RL-02c capped execution", () => {
  it("RL-01 caps are in effect while the command waits, and the scope is gone after it ends", async () => {
    const root = await workspace();
    await requireRLCapabilities(root);
    const sandbox = await makeRLSandbox(root, caps);
    const running = runRL(sandbox, identityAndWait("printf 'done\\n'"));
    running.catch(() => undefined);
    const identityFile = path.join(root.root, RL_IDENTITY);
    expect(await waitForPath(identityFile, 10_000)).toBe(true);
    const identity = (await readIfExists(identityFile)) ?? "";
    const unit = unitNameOf(identity);
    expect(unit).toMatch(/^agent-next-cmd-.+\.scope$/);
    expect(systemctlUserShow(unit)).toMatch(/MemoryMax=268435456\b/);
    expect(systemctlUserShow(unit)).toMatch(/TasksMax=64\b/);
    expect(await cgroupValue(identity, "memory.max")).toBe("268435456");
    expect(await cgroupValue(identity, "pids.max")).toBe("64");
    expect(await cgroupValue(identity, "memory.swap.max")).toBe("0");
    await writeFile(path.join(root.root, RL_RELEASE), "");
    const result = await running;
    expect(result.resourceCaps).toEqual({
      status: "applied",
      memoryMaxBytes: 268435456,
      tasksMax: 64,
      memory: "none_observed",
      processes: "none_observed",
      observationComplete: true,
    });
    expect(await waitForUnitNotFound(unit, 2_000)).toBe(true);
  });

  it("RL-02 the capped and uncapped paths give identical output, exit code and signal", async () => {
    const root = await workspace();
    const capped = await makeRLSandbox(root, caps);
    const uncapped = await makeRLSandbox(root);
    const commands = [
      "printf '%s\\n' '${HOME}' '$$' '%h' \"$HOME\"",
      "exit 7",
      "echo a; )",
      "env | sort",
      "test ! -e /proc/self/fd/3 && test ! -e /proc/self/fd/4 && test ! -e /proc/self/fd/5 && echo ok",
      "ls /run/user /sys/fs/cgroup",
    ];
    for (const command of commands) {
      const cappedResult = await runRL(capped, command);
      const plain = await runRL(uncapped, command);
      expect(cappedResult.stdout.text, command).toBe(plain.stdout.text);
      expect(cappedResult.stderr.text, command).toBe(plain.stderr.text);
      expect(cappedResult.exitCode, command).toBe(plain.exitCode);
      expect(cappedResult.signal, command).toBe(plain.signal);
      expect(cappedResult.stderr.text, command).not.toContain("Running scope as unit");
      expect(cappedResult.resourceCaps, command).toMatchObject({ status: "applied", observationComplete: true });
    }
  });

  it("RL-02b signals and chosen exit codes are preserved on both paths", async () => {
    const root = await workspace();
    const capped = await makeRLSandbox(root, caps);
    const uncapped = await makeRLSandbox(root);
    const commands = [
      "kill -s USR1 $$",
      "kill -s TERM $$",
      "kill -s INT $$",
      "kill -s PIPE $$",
      "kill -9 $$",
      "exit 137",
      "exit 138",
      "exit 139",
    ];
    for (const command of commands) {
      const cappedResult = await runRL(capped, command);
      const plain = await runRL(uncapped, command);
      expect(cappedResult.stdout.text, command).toBe(plain.stdout.text);
      expect(cappedResult.stderr.text, command).toBe(plain.stderr.text);
      expect(cappedResult.stdout.totalBytes, command).toBe(plain.stdout.totalBytes);
      expect(cappedResult.stderr.totalBytes, command).toBe(plain.stderr.totalBytes);
      expect(cappedResult.exitCode, command).toBe(plain.exitCode);
      expect(cappedResult.signal, command).toBe(plain.signal);
      expect(cappedResult.resourceCaps, command).toEqual({
        status: "applied",
        memoryMaxBytes: 268435456,
        tasksMax: 64,
        memory: "none_observed",
        processes: "none_observed",
        observationComplete: true,
      });
    }
  });

  it("RL-02c a background descendant dies with the command on both paths", async () => {
    for (const capped of [true, false]) {
      const root = await workspace();
      await requireRLCapabilities(root);
      const sandbox = await makeRLSandbox(root, capped ? caps : undefined);
      const worker = path.join(root.root, ".rl-worker");
      const running = runRL(sandbox, backgroundWorker());
      running.catch(() => undefined);
      expect(await waitForPath(worker, 10_000)).toBe(true);
      const result = await running;
      if (capped) {
        expect(result.resourceCaps).toMatchObject({ status: "applied", observationComplete: true });
      }
      await writeFile(path.join(root.root, ".rl-continue"), "");
      await delay(3_000);
      expect(await readLines(worker), `capped=${String(capped)}`).toEqual(["started"]);
    }
  });
});
