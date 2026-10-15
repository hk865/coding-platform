/**
 * RE1 rows RL-12, RL-13, RL-14, RL-15: unsupported machines, real read-only
 * sandbox rows under caps, and the probe cache (spec §5.2).
 *
 * RL-14 ports the KB-01/KB-03/KB-04/KB-05 assertions of
 * `K-readonly-sandbox.test.ts` to read_only mode with caps.
 *
 * Written here; run by the lead in WSL (§5.4): in the DSH sandbox these fail
 * for the missing bubblewrap / systemd user session.
 */
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  probeResourceCaps,
  resourceCapStatus,
} from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";
import {
  ProcessSandbox,
  RL_BWRAP_DEFAULT,
  RL_MIB,
  executeRL,
  fixedSource,
  installRLFakeSystemdRun,
  makeRLSandbox,
  makeRLWorkspace,
  pgrepMarked,
  readIfExists,
  removeRLWorkspace,
  requireRLCapabilities,
  runRL,
  shellQuote,
  type RLFakeSystemd,
  type RLWorkspace,
} from "../helpers/RL-resource-caps-support.js";

/** The literal L10 table rows this file asserts (never read back from the product). */
const L10_NONE_TEXT: Readonly<Record<string, string>> = {
  no_systemd_run: "没有资源上限：找不到 systemd-run",
  no_user_session: "没有资源上限：没有 systemd 的用户会话",
  controllers_not_delegated: "没有资源上限：内存和进程数的控制没有下放给当前用户",
  probe_failed: "没有资源上限：探测失败",
};

const workspaces: RLWorkspace[] = [];
const fakes: RLFakeSystemd[] = [];
const savedEnv = new Map<string, string | undefined>();
function saveEnv(key: string): void {
  if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
  delete process.env[key];
}
afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  for (const fake of fakes.splice(0)) await fake.cleanup();
  for (const workspace of workspaces.splice(0)) await removeRLWorkspace(workspace);
});

async function workspace(): Promise<RLWorkspace> {
  const created = await makeRLWorkspace();
  workspaces.push(created);
  return created;
}

const caps = fixedSource({ memoryMaxBytes: 256 * RL_MIB, tasksMax: 64 });
const applied = { status: "applied" } as const;

describe("RL-12..RL-15 machine conditions", () => {
  it("RL-12 an unavailable sandbox is refused, never launches the launcher, and runs nothing", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    await requireRLCapabilities(root);
    saveEnv("CODING_AGENT_BWRAP_PATH");
    process.env["CODING_AGENT_BWRAP_PATH"] = "/nonexistent/rl-bwrap";
    for (const systemdRun of [fake.script, "/nonexistent/rl-systemd-run"]) {
      process.env["CODING_AGENT_SYSTEMD_RUN_PATH"] = systemdRun;
      const sandbox = await makeRLSandbox(root, caps);
      await expect(runRL(sandbox, "touch /workspace/.rl-12")).rejects.toMatchObject({ code: "sandbox_unavailable" });
    }
    expect(await fake.invocations()).toEqual([]);
    expect(await readIfExists(path.join(root.root, ".rl-12"))).toBeNull();
  });

  it("RL-13 an unsupported machine runs as today and reports the literal L10 reason and text", async () => {
    const cases: ReadonlyArray<{ readonly mode: string; readonly reason: string }> = [
      { mode: "fail-bus", reason: "no_user_session" },
      { mode: "strip-p", reason: "controllers_not_delegated" },
      // RL L5 step 6 / RL-13: argv rewriting is caught by keeper identification first.
      { mode: "rewrite-dollar", reason: "probe_failed" },
    ];
    for (const item of cases) {
      // Each case gets its own fake script (and probe-cache key) in the failing mode.
      const fake = await installRLFakeSystemdRun(item.mode);
      try {
        const root = await workspace();
        const capability = await probeResourceCaps();
        expect(capability.status, item.mode).toBe("unavailable");
        if (capability.status === "unavailable") {
          expect(capability.reason, item.mode).toBe(item.reason);
          if (item.mode === "fail-bus") {
            // MF1/item 9: with L5 step 4 fixed (systemd/private is a socket), this
            // case must fail at step 6 with the fake's bus message, not at step 4.
            expect(capability.detail, item.mode).toContain("Failed to connect to bus");
          }
          if (item.mode === "rewrite-dollar") {
            // The rewritten argv also changes the keeper's cmdline (L2), so the
            // canary ends as launch_failed keeper_not_identified before release.
            expect(capability.detail, item.mode).toContain("keeper_not_identified");
          }
        }
        // MF1: the probe reached L5 step 6 — the fake saw a real scope launch.
        const invocations = await fake.invocations();
        expect(invocations.some(line => line.includes("--user --scope")), item.mode).toBe(true);
        // MF1/R1: the probe's own capped canary must not invalidate the cache it is
        // filling, so the status is the capability, never `unknown`.
        expect(resourceCapStatus(), item.mode).toEqual(capability);
        const sandbox = await makeRLSandbox(root, caps);
        const result = await runRL(sandbox, "printf 'hi'");
        expect(result.stdout.text).toBe("hi");
        expect(result.resourceCaps, item.mode).toEqual({
          status: "none",
          reason: item.reason,
          text: L10_NONE_TEXT[item.reason],
        });
        // item 9: exactly one canary per case — the `printf` execute reused the
        // failed probe cache instead of probing (and launching a canary) again.
        const canaries = (await fake.invocations()).filter(line => line.includes("cap_literal"));
        expect(canaries, item.mode).toHaveLength(1);
      } finally {
        // Clean up after each case: chained fakes would otherwise leave a
        // deleted systemd-run path in the environment for the later rows.
        await fake.cleanup();
      }
    }
  });

  it("RL-13b a missing systemd-run is no_systemd_run and the command still runs", async () => {
    const root = await workspace();
    saveEnv("CODING_AGENT_SYSTEMD_RUN_PATH");
    process.env["CODING_AGENT_SYSTEMD_RUN_PATH"] = "/nonexistent/rl-systemd-run";
    const sandbox = await makeRLSandbox(root, caps);
    const result = await runRL(sandbox, "printf 'hi'");
    expect(result.stdout.text).toBe("hi");
    expect(result.resourceCaps).toEqual({
      status: "none",
      reason: "no_systemd_run",
      text: L10_NONE_TEXT["no_systemd_run"],
    });
    // Spec RL-13 asks all four unsupported-machine cases for the capability
    // status too: `resourceCapStatus()` is this reason, not `unknown`. Spec §2:
    // an unavailable capability always carries a `detail` string (no literal).
    expect(resourceCapStatus()).toEqual({
      status: "unavailable",
      reason: "no_systemd_run",
      detail: expect.any(String),
    });
  });

  it("RL-14 KB-01 read_only refuses every workspace write under caps and leaves the sentinel byte-identical", async () => {
    const root = await workspace();
    await mkdir(path.join(root.root, "sub"), { recursive: true });
    await mkdir(path.join(root.root, ".evaluator"), { recursive: true });
    await writeFile(path.join(root.root, "sentinel.txt"), "SENTINEL-KB01");
    await writeFile(path.join(root.root, "sub", "keep.txt"), "KEEP");
    await requireRLCapabilities(root);
    const sandbox = await makeRLSandbox(root, caps, { workspaceMode: "read_only" });
    const attempts: ReadonlyArray<readonly [string, string]> = [
      ["write a root file", "printf written > /workspace/root-write.txt"],
      ["write a subdirectory file", "printf written > /workspace/sub/sub-write.txt"],
      ["create a new file", "touch /workspace/created.txt"],
      ["rename a file", "mv /workspace/sentinel.txt /workspace/renamed.txt"],
      ["delete a file", "rm -f /workspace/sentinel.txt"],
      ["change permissions", "chmod 700 /workspace/sentinel.txt"],
      ["write into a protected directory", "touch /workspace/.evaluator/protected-write.txt"],
    ];
    for (const [label, command] of attempts) {
      const result = await executeRL(sandbox, command);
      expect(result.exitCode, `${label} (${command}) must fail`).not.toBe(0);
      expect(result.resourceCaps, label).toMatchObject(applied);
    }
    expect(await readFile(path.join(root.root, "sentinel.txt"), "utf8")).toBe("SENTINEL-KB01");
    expect(await readFile(path.join(root.root, "sub", "keep.txt"), "utf8")).toBe("KEEP");
    for (const absent of [
      "root-write.txt",
      "sub/sub-write.txt",
      "created.txt",
      "renamed.txt",
      ".evaluator/protected-write.txt",
    ]) {
      expect(await readIfExists(path.join(root.root, absent)), `${absent} must not exist`).toBeNull();
    }
    expect(await readdir(path.join(root.root, ".evaluator"))).toEqual([]);
  });

  it("RL-14 KB-03 read_only blocks the local port and refuses git writes under caps", async () => {
    const root = await workspace();
    await writeFile(path.join(root.root, "tracked.txt"), "one\n");
    execFileSync("git", ["init", "-q"], { cwd: root.root });
    execFileSync("git", ["-C", root.root, "config", "user.email", "rl14@example.invalid"]);
    execFileSync("git", ["-C", root.root, "config", "user.name", "RL 14"]);
    execFileSync("git", ["-C", root.root, "add", "-A"]);
    execFileSync("git", ["-C", root.root, "commit", "-q", "-m", "initial"]);
    await requireRLCapabilities(root);
    const sandbox = await makeRLSandbox(root, caps, { workspaceMode: "read_only" });
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("the local server has no port");
    const port = address.port;
    try {
      const network = await executeRL(
        sandbox,
        `if timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/${String(port)}'; then printf connected; exit 0; else printf blocked; exit 4; fi`,
      );
      expect(network.exitCode, "the sandbox must not reach the host's local port").toBe(4);
      expect(network.resourceCaps).toMatchObject(applied);

      const log = await executeRL(sandbox, "git --no-optional-locks -c safe.directory='*' -C /workspace log --oneline");
      expect(log.exitCode, log.stderr.text).toBe(0);
      expect(log.resourceCaps).toMatchObject(applied);

      await writeFile(path.join(root.root, "tracked.txt"), "two\n");
      execFileSync("git", ["-C", root.root, "add", "tracked.txt"]);
      const diff = await executeRL(sandbox, "git --no-optional-locks -c safe.directory='*' -C /workspace diff --cached");
      expect(diff.exitCode, diff.stderr.text).toBe(0);
      expect(diff.stdout.text).toContain("two");
      expect(diff.resourceCaps).toMatchObject(applied);

      const commit = await executeRL(sandbox, "git --no-optional-locks -c safe.directory='*' -C /workspace commit -m blocked");
      expect(commit.exitCode, "commit writes .git and must fail").not.toBe(0);
      expect(commit.resourceCaps).toMatchObject(applied);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("RL-14 KB-04 read_only rejects escaping cwd and hides the parent environment and the inherited fd under caps", async () => {
    const root = await workspace();
    await mkdir(path.join(root.root, ".evaluator"), { recursive: true });
    await writeFile(path.join(root.root, "sentinel.txt"), "SENTINEL-KB04");
    await requireRLCapabilities(root);
    const sandbox = await makeRLSandbox(root, caps, { workspaceMode: "read_only" });
    for (const cwd of ["..", "/etc", ".evaluator"]) {
      await expect(executeRL(sandbox, "printf started", { cwd }), cwd).rejects.toMatchObject({ code: "invalid_arguments" });
    }

    const name = "RL14_PARENT_SENTINEL";
    const previous = process.env[name];
    process.env[name] = "rl14-secret";
    try {
      const environment = await executeRL(
        sandbox,
        `if [ -n "\${${name}:-}" ]; then printf leaked; exit 5; fi; printf unset`,
      );
      expect(environment.exitCode).toBe(0);
      expect(environment.stdout.text).toBe("unset");
      expect(environment.resourceCaps).toMatchObject(applied);
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }

    const rootFd = await executeRL(sandbox, "if [ -e /proc/self/fd/3 ]; then printf leaked; exit 6; fi; printf closed");
    expect(rootFd.exitCode).toBe(0);
    expect(rootFd.stdout.text).toBe("closed");
    expect(rootFd.resourceCaps).toMatchObject(applied);
  });

  it("RL-14 KB-05 read_only keeps pre-timeout/cancel output and reports truncation under caps", async () => {
    const root = await workspace();
    await requireRLCapabilities(root);
    const sandbox = await makeRLSandbox(root, caps, { workspaceMode: "read_only" });

    const timedOut = await executeRL(sandbox, "printf 'before-timeout\\n'; sleep 30", { timeoutMs: 500 });
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.cancelled).toBe(false);
    expect(timedOut.stdout.text).toContain("before-timeout");
    expect(timedOut.resourceCaps).toMatchObject(applied);

    const controller = new AbortController();
    const pending = executeRL(sandbox, "printf 'before-cancel\\n'; sleep 30; printf done", {
      timeoutMs: 20_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 500);
    const cancelled = await pending;
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.timedOut).toBe(false);
    expect(cancelled.stdout.text).toContain("before-cancel");
    expect(cancelled.stdout.text).not.toContain("done");
    expect(cancelled.resourceCaps).toMatchObject(applied);

    const totalBytes = 40_000;
    const limit = 32 * 1024;
    const stdout = await executeRL(sandbox, `head -c ${String(totalBytes)} /dev/zero | tr '\\0' a`, {
      outputLimitBytes: limit,
    });
    expect(stdout.exitCode, stdout.stderr.text).toBe(0);
    expect(stdout.stdout.truncated).toBe(true);
    expect(stdout.stdout.totalBytes).toBe(totalBytes);
    expect(stdout.stdout.text.length).toBe(limit);
    expect(stdout.stdout.text).toBe("a".repeat(limit));
    expect(stdout.resourceCaps).toMatchObject(applied);

    const stderr = await executeRL(sandbox, `head -c ${String(totalBytes)} /dev/zero | tr '\\0' b >&2`, {
      outputLimitBytes: limit,
    });
    expect(stderr.exitCode, stderr.stderr.text).toBe(0);
    expect(stderr.stderr.truncated).toBe(true);
    expect(stderr.stderr.totalBytes).toBe(totalBytes);
    expect(stderr.stderr.text).toBe("b".repeat(limit));
    expect(stderr.resourceCaps).toMatchObject(applied);
  });

  it("RL-15 the probe is cached, single-flight, and carries the version options", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const first = await probeResourceCaps();
    const second = await probeResourceCaps();
    expect(first).toEqual({ status: "available" });
    expect(second).toEqual({ status: "available" });
    expect(resourceCapStatus()).toEqual({ status: "available" });
    const canaries = (await fake.invocations()).filter(line => line.includes("cap_literal"));
    expect(canaries).toHaveLength(1);
    const versionText = execFileSync(fake.script, ["--version"], { encoding: "utf8" });
    const match = /\d+/.exec(versionText.split("\n")[0] ?? "");
    const version = match === null ? null : Number(match[0]);
    // The fake always answers `--version`, so an unparseable answer must fail the
    // row instead of silently skipping the version-conditional checks.
    expect(version, `unparseable --version output: ${JSON.stringify(versionText)}`).not.toBeNull();
    if (version !== null && version >= 253) expect(canaries[0]).toContain("-p OOMPolicy=continue");
    if (version !== null && version >= 254) expect(canaries[0]).toContain("--expand-environment=no");
  });

  it(
    "RL-15b (a) a hanging systemd-run --version stops at the 10 s deadline and reports probe_failed",
    { timeout: 30_000 },
    async () => {
      const marker = "rl-hang-systemd-version";
      const fake = await installRLFakeSystemdRun("hang-version");
      fakes.push(fake);
      fake.setMode("hang-version", { RL_FAKE_SYSTEMD_HANG_MARKER: marker });
      // Elapsed time is measured on the monotonic clock: the WSL wall clock is
      // stepped every ~30 s, so `Date.now()` differences are not durations.
      const startedAt = performance.now();
      const capability = await probeResourceCaps();
      const elapsed = performance.now() - startedAt;
      // MF2/R2: the 10 s deadline wins; the detail literal is fixed.
      expect(capability).toEqual({
        status: "unavailable",
        reason: "probe_failed",
        detail: "探测超过 10 秒",
      });
      expect(elapsed).toBeGreaterThanOrEqual(10_000);
      expect(elapsed).toBeLessThanOrEqual(12_000);
      expect(resourceCapStatus()).toEqual(capability);
      // The hung `--version` child must be reaped; `pgrepMarked` returns [] only
      // for a definite no-match (item 9), never for a failed pgrep.
      expect(pgrepMarked(marker)).toEqual([]);
      const root = await workspace();
      const sandbox = await makeRLSandbox(root, caps);
      const result = await runRL(sandbox, "printf 'hi'");
      expect(result.stdout.text).toBe("hi");
      expect(result.resourceCaps).toEqual({
        status: "none",
        reason: "probe_failed",
        text: "没有资源上限：探测失败",
      });
      // Exactly one `--version` call: the execute reused the cached failure.
      const versions = (await fake.invocations()).filter(line => line.includes("--version"));
      expect(versions).toHaveLength(1);
    },
  );

  it(
    "RL-15b (b) a bwrap whose --version hangs ends as probe_failed, not sandbox_unavailable",
    { timeout: 30_000 },
    async () => {
      const marker = "rl-hang-bwrap-version";
      const fake = await installRLFakeSystemdRun("forward");
      fakes.push(fake);
      const root = await workspace();
      // MF2(b): GT-A's `RL-fake-bwrap.sh` has no hanging mode and the helper
      // files are off-limits, so the hanging wrapper is written into this
      // test's own temp workspace. systemd-run stays the forwarding fake.
      const wrapper = path.join(root.root, "rl-hang-bwrap.sh");
      await writeFile(wrapper, `#!/usr/bin/env bash\nset -u\nexec -a ${shellQuote(marker)} sleep 600\n`);
      await chmod(wrapper, 0o755);
      saveEnv("CODING_AGENT_BWRAP_PATH");
      process.env["CODING_AGENT_BWRAP_PATH"] = wrapper;
      const startedAt = performance.now();
      const capability = await probeResourceCaps();
      const elapsed = performance.now() - startedAt;
      // R2: past the deadline in step 5 is probe_failed, not sandbox_unavailable.
      expect(capability.status, JSON.stringify(capability)).toBe("unavailable");
      if (capability.status === "unavailable") expect(capability.reason).toBe("probe_failed");
      expect(elapsed).toBeGreaterThanOrEqual(10_000);
      expect(elapsed).toBeLessThanOrEqual(12_000);
      expect(resourceCapStatus()).toEqual(capability);
      expect(pgrepMarked(marker)).toEqual([]);
    },
  );

  it("RL-15 the capability probe uses the executing profile's bwrap path, not the environment default", async () => {
    const fake = await installRLFakeSystemdRun("forward");
    fakes.push(fake);
    const root = await workspace();
    const realBwrap = process.env["CODING_AGENT_BWRAP_PATH"] ?? RL_BWRAP_DEFAULT;
    // SF3: the environment default stays `/usr/bin/bwrap` while the profile's
    // bwrap path is the passthrough wrapper; the probe must key on the profile.
    saveEnv("CODING_AGENT_BWRAP_PATH");
    const wrapper = path.join(root.root, "rl-bwrap-passthrough.sh");
    await writeFile(wrapper, `#!/bin/sh\nexec ${shellQuote(realBwrap)} "$@"\n`);
    await chmod(wrapper, 0o755);
    const profile = await ProcessSandbox.probe(root.root, root.workspace, { bwrapPath: wrapper });
    expect(profile.available, profile.reason ?? "bubblewrap must be available").toBe(true);
    const sandbox = new ProcessSandbox(profile, root.root, root.workspace, { resourceCaps: caps });
    const result = await runRL(sandbox, "true");
    expect(result.exitCode).toBe(0);
    expect(result.resourceCaps).toMatchObject({ status: "applied" });
    // Every capped launch (probe canary and command) is followed by the
    // wrapper's absolute path and none by the environment default.
    const launches = (await fake.invocations()).filter(line => line.includes("agent-keeper"));
    expect(launches).toHaveLength(2);
    for (const line of launches) {
      expect(line).toContain(wrapper);
      expect(line).not.toContain(RL_BWRAP_DEFAULT);
    }
  });
});
