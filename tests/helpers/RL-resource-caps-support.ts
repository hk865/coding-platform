/**
 * Shared fixtures and helpers for the RE1 rows (spec §5.2 RE1 conventions, §7).
 *
 * Builds: temp workspaces, `ProcessSandbox` instances with a `ResourceCapSource`,
 * the identity/release marker command fragments, the fake `systemd-run` and fake
 * `bwrap` installers, and scope query helpers (`systemctl --user show`, cgroup
 * files, anchored `pgrep`).
 * Rows: RL-01 … RL-15.
 *
 * Round 2 (items 7, 9): a failed read never becomes "absent" — `readIfExists`
 * only returns null for ENOENT, `pgrepMarked` only returns [] for pgrep's exit 1
 * and rethrows anything else, and `systemctlUserShow` throws on failure.
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ProcessSandbox,
  ProcessSandboxError,
} from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";
import type {
  ProcessExecutionResult,
  ResourceCapRequest,
  ResourceCapSource,
} from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";
import { WorkspaceSandbox } from "../../vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js";

export { ProcessSandbox, ProcessSandboxError };

export const RL_MIB = 1_048_576;
export const RL_SYSTEMD_RUN_DEFAULT = "/usr/bin/systemd-run";
export const RL_BWRAP_DEFAULT = "/usr/bin/bwrap";

export interface RLWorkspace {
  readonly root: string;
  readonly workspace: WorkspaceSandbox;
}

export async function makeRLWorkspace(): Promise<RLWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), "rl-ws-"));
  const workspace = await WorkspaceSandbox.create(root);
  return { root, workspace };
}

export async function removeRLWorkspace(workspace: RLWorkspace): Promise<void> {
  await rm(workspace.root, { recursive: true, force: true });
}

/**
 * RE1 tests need real bubblewrap (and the machine-condition tests need a systemd
 * user session). This is not a skip: in the DSH sandbox the test fails at once
 * with the environment reason, which is what §5.4 records.
 */
export async function requireRLCapabilities(workspace: RLWorkspace): Promise<void> {
  const profile = await ProcessSandbox.probe(workspace.root, workspace.workspace);
  if (!profile.available) {
    throw new Error(
      `RL RE1 environment unavailable (no bubblewrap / systemd user session): ${profile.reason ?? "bubblewrap probe failed"}`,
    );
  }
}

export function fixedSource(request: ResourceCapRequest): ResourceCapSource {
  return { current: () => request };
}

export async function makeRLSandbox(
  workspace: RLWorkspace,
  source?: ResourceCapSource,
  options: { readonly workspaceMode?: "read_write" | "read_only" } = {},
): Promise<ProcessSandbox> {
  // Item 7: the workspace mode must reach both the probe and the constructor.
  // `ProcessSandbox.probe(..., { workspaceMode })` runs the read-only canary, and
  // the constructor defaults to read_write when it is not passed, so a single
  // `mode` object is spread into both calls.
  const mode = options.workspaceMode === undefined ? {} : { workspaceMode: options.workspaceMode };
  const profile = await ProcessSandbox.probe(workspace.root, workspace.workspace, { ...mode });
  return new ProcessSandbox(profile, workspace.root, workspace.workspace, {
    ...mode,
    ...(source === undefined ? {} : { resourceCaps: source }),
  });
}

export async function runRL(
  sandbox: ProcessSandbox,
  command: string,
  timeoutMs = 30_000,
): Promise<ProcessExecutionResult> {
  return sandbox.execute({
    command,
    cwd: ".",
    timeoutMs,
    outputLimitBytes: 64 * 1024,
    signal: new AbortController().signal,
  });
}

/** `runRL` with per-call options (RL-14 ports KB-04/KB-05). */
export async function executeRL(
  sandbox: ProcessSandbox,
  command: string,
  options: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly outputLimitBytes?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<ProcessExecutionResult> {
  return sandbox.execute({
    command,
    cwd: options.cwd ?? ".",
    timeoutMs: options.timeoutMs ?? 10_000,
    outputLimitBytes: options.outputLimitBytes ?? 32 * 1024,
    signal: options.signal ?? new AbortController().signal,
  });
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export const RL_IDENTITY = ".rl-identity";
export const RL_RELEASE = ".rl-release";

/** Writes the scope's `/proc/self/cgroup` into the identity marker file. */
export function identityMarker(): string {
  return `cat /proc/self/cgroup > /workspace/${RL_IDENTITY}`;
}

/** Identity marker first, then wait for the release marker (spec §5.2 RE1). */
export function identityAndWait(payload: string): string {
  return `${identityMarker()}; `
    + `while [ ! -e /workspace/${RL_RELEASE} ]; do sleep 0.02; done; ${payload}`;
}

/**
 * Item 9: the sleep carries the marker as its own argv[0] (`exec -a`), so the
 * anchored `pgrepMarked` finds the command process and not the bwrap/keeper
 * argv that merely contains the marker text. The touch is a separate step.
 */
export function markedSleep(marker: string): string {
  return `exec -a ${marker} sleep 600`;
}

/** Background worker that appends `late` only after `.rl-continue` appears. */
export function backgroundWorker(): string {
  return "( while [ ! -e /workspace/.rl-continue ]; do sleep 0.02; done; "
    + "printf 'late\\n' >> /workspace/.rl-worker ) & "
    + "printf 'started\\n' >> /workspace/.rl-worker";
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export async function waitForPath(file: string, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      await readFile(file);
      return true;
    } catch {
      await delay(20);
    }
  }
  return false;
}

/** Item 9: only a genuine ENOENT is "absent"; every other read failure throws. */
export async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readLines(file: string): Promise<string[]> {
  const text = await readIfExists(file);
  return text === null ? [] : text.split("\n").filter(line => line.length > 0);
}

/** True while a pid still exists (used for the stuck-launcher RL-09 check). */
export function procExists(pid: number): boolean {
  return existsSync(`/proc/${String(pid)}`);
}

export function cgroupPathOf(text: string): string {
  for (const line of text.split("\n")) {
    if (line.startsWith("0::")) return line.slice(3).trim();
  }
  return "";
}

export function unitNameOf(text: string): string {
  const parts = cgroupPathOf(text).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function scopeDirOf(text: string): string {
  return `/sys/fs/cgroup${cgroupPathOf(text)}`;
}

export async function cgroupValue(text: string, file: string): Promise<string> {
  return (await readFile(`${scopeDirOf(text)}/${file}`, "utf8")).trim();
}

/** The pids in the scope named by an identity file's cgroup text. */
export async function cgroupProcs(text: string): Promise<number[]> {
  const procs = await readFile(`${scopeDirOf(text)}/cgroup.procs`, "utf8");
  return procs.split(/\s+/).filter(Boolean).map(Number).filter(value => Number.isSafeInteger(value));
}

export async function cmdlineOf(pid: number): Promise<string> {
  try {
    return await readFile(`/proc/${String(pid)}/cmdline`, "utf8");
  } catch {
    return "";
  }
}

/** Item 9: a failed `systemctl show` is an error, never an absent unit. */
export function systemctlUserShow(unit: string): string {
  return execFileSync("systemctl", ["--user", "show", unit], { encoding: "utf8" });
}

function systemctlErrorText(error: unknown): string {
  const value = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
  const stdout = typeof value.stdout === "string" ? value.stdout : value.stdout?.toString("utf8") ?? "";
  const stderr = typeof value.stderr === "string" ? value.stderr : value.stderr?.toString("utf8") ?? "";
  return `${stdout}${stderr}${value.message ?? ""}`;
}

export async function waitForUnitNotFound(unit: string, timeoutMs: number): Promise<boolean> {
  const explicitMessage = `Unit ${unit} could not be found.`;
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      if (/^LoadState=not-found$/m.test(systemctlUserShow(unit))) return true;
    } catch (error) {
      // Some systemd versions fail `show` for a unit that no longer exists
      // (sometimes printing LoadState=not-found on stdout). Only that explicit
      // not-found evidence counts: a parsed `LoadState=not-found`, or systemd's
      // exact message `Unit <unit> could not be found.`. Every other failure is
      // rethrown so a failed read can never be reported as "unit gone".
      const text = systemctlErrorText(error);
      if (/^LoadState=not-found$/m.test(text) || text.trim() === explicitMessage) return true;
      throw error;
    }
    await delay(50);
  }
  return false;
}

/**
 * Item 9: anchored so only a process whose argv[0] is the marker matches (the
 * marker survives in bwrap/keeper/launcher argv as text, see Codex #9b).
 * `pgrep` exits 1 for "no match" and 2/3 for errors; only exit 1 is [].
 */
export function pgrepMarked(marker: string): number[] {
  let output: string;
  try {
    output = execFileSync("pgrep", ["-f", `^${marker}( |$)`], { encoding: "utf8" });
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
  return output.split("\n").filter(Boolean).map(Number).filter(value => Number.isSafeInteger(value));
}

export interface RLFakeSystemd {
  readonly dir: string;
  readonly script: string;
  readonly log: string;
  setMode(mode: string, extra?: Readonly<Record<string, string>>): void;
  invocations(): Promise<string[]>;
  cleanup(): Promise<void>;
}

/** The `extra` keys earlier tests passed map to sibling files the script reads. */
const RL_FAKE_SIBLING_FILES: Readonly<Record<string, string>> = {
  RL_FAKE_SYSTEMD_SLEEP: ".sleep",
  RL_FAKE_SYSTEMD_EXTERNAL: ".external",
  RL_FAKE_SYSTEMD_STARTED: ".started",
  RL_FAKE_SYSTEMD_HANG_MARKER: ".hang-marker",
};

/**
 * Install a private fake `systemd-run` (one per test, so the probe cache key
 * differs) and point `CODING_AGENT_SYSTEMD_RUN_PATH` at it. The mode, real path
 * and invocation log are sibling files, because production spawns the launcher
 * with only PATH and XDG_RUNTIME_DIR (spec L3, §7).
 */
export async function installRLFakeSystemdRun(mode = "forward"): Promise<RLFakeSystemd> {
  const dir = await mkdtemp(path.join(tmpdir(), "rl-fake-systemd-"));
  const script = path.join(dir, "systemd-run");
  await copyFile(path.resolve("tests/helpers/RL-fake-systemd-run.sh"), script);
  await chmod(script, 0o755);
  const log = path.join(dir, ".log");
  await writeFile(log, "");
  await writeFile(path.join(dir, ".mode"), mode);
  // Forward to the real launcher the caller configured, if any; the default is
  // /usr/bin/systemd-run (spec L5 step 3).
  const previous = process.env["CODING_AGENT_SYSTEMD_RUN_PATH"];
  const real = previous === undefined || previous === "" ? RL_SYSTEMD_RUN_DEFAULT : previous;
  await writeFile(path.join(dir, ".real"), real);
  process.env["CODING_AGENT_SYSTEMD_RUN_PATH"] = script;
  return {
    dir,
    script,
    log,
    setMode(next, extra = {}) {
      writeFileSync(path.join(dir, ".mode"), next);
      for (const [key, value] of Object.entries(extra)) {
        const file = RL_FAKE_SIBLING_FILES[key];
        if (file !== undefined) writeFileSync(path.join(dir, file), value);
      }
    },
    async invocations() {
      return readLines(log);
    },
    async cleanup() {
      if (previous === undefined) delete process.env["CODING_AGENT_SYSTEMD_RUN_PATH"];
      else process.env["CODING_AGENT_SYSTEMD_RUN_PATH"] = previous;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface RLFakeBwrap {
  readonly dir: string;
  readonly script: string;
  readonly log: string;
  setMode(mode: string): void;
  invocations(): Promise<string[]>;
  cleanup(): Promise<void>;
}

/**
 * Install the round-2 fake `bwrap` (R3) and point `CODING_AGENT_BWRAP_PATH` at
 * it. Forward mode still execs the real bubblewrap (the path the caller had in
 * CODING_AGENT_BWRAP_PATH, default /usr/bin/bwrap); only `gate-reset` and
 * `exit-after-r` replace its behaviour, so this is a dependency replacement,
 * not a fake sandbox (spec §5 head).
 */
export async function installRLFakeBwrap(mode = "forward"): Promise<RLFakeBwrap> {
  const dir = await mkdtemp(path.join(tmpdir(), "rl-fake-bwrap-"));
  const script = path.join(dir, "bwrap");
  await copyFile(path.resolve("tests/helpers/RL-fake-bwrap.sh"), script);
  await chmod(script, 0o755);
  const log = path.join(dir, ".bwrap-log");
  await writeFile(log, "");
  await writeFile(path.join(dir, ".bwrap-mode"), mode);
  // `forward` must still run the real bubblewrap. If the caller points
  // CODING_AGENT_BWRAP_PATH at a real bwrap elsewhere (spec §5.4/§7: the lead
  // machine may not have /usr/bin/bwrap), forward to that instead.
  const previous = process.env["CODING_AGENT_BWRAP_PATH"];
  const real = previous === undefined || previous === "" ? RL_BWRAP_DEFAULT : previous;
  await writeFile(path.join(dir, ".bwrap-real"), real);
  process.env["CODING_AGENT_BWRAP_PATH"] = script;
  return {
    dir,
    script,
    log,
    setMode(next) {
      writeFileSync(path.join(dir, ".bwrap-mode"), next);
    },
    async invocations() {
      return readLines(log);
    },
    async cleanup() {
      if (previous === undefined) delete process.env["CODING_AGENT_BWRAP_PATH"];
      else process.env["CODING_AGENT_BWRAP_PATH"] = previous;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
