/**
 * K 片 B 部分 KE5：`ProcessSandbox` 只读模式（Kernel 补丁）的公开行为测试。
 *
 * 入口：冻结公开入口 `vendor/coding-agent/dist/public-api.js` 的
 * `ProcessSandbox.probe/execute`，配真实的 `WorkspaceSandbox` 和
 * `workspaceMode: 'read_only'`。不导入 Kernel 私有路径，不 mock 沙箱，
 * 不读数据库；期望值来自规格 §5.2 KB-01..KB-06、KB-11 和 §0.2 L13、L15、L16、L17。
 *
 * 修复轮补充（review finding 1/2/5/6）：`D-IPC`（遮蔽工作区里既有的 Unix socket/FIFO）、
 * `D-GIT`（`.git` 只读可读，其下显式否认路径仍要各自遮蔽）、`D-PROBE`（探测必须真正
 * 走一次 `--ro-bind-fd` 和 `--remount-ro`）、`D-CWD`（cwd 必须是目录，进入沙箱后用
 * `pwd -P` 确认仍在 /workspace 下）。
 *
 * 这些用例需要真实 bubblewrap。DSH 沙箱没有 bwrap，因此 KE5 行在这里以
 * 沙箱不可用（probe available=false 或 execute sandbox_unavailable）失败；
 * 由 lead 在有 bwrap 的环境运行验收。
 */
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProcessSandbox,
  ProcessSandboxError,
  WorkspaceSandbox,
} from "../../vendor/coding-agent/dist/public-api.js";
import {
  planReadonlyMounts,
  readonlyIpcSkips,
} from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";

const tempRoots: string[] = [];
/** Probe wrappers live under ./.dsh-scratch/ and are removed after each case. */
const scratchFiles: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
  for (const file of scratchFiles.splice(0)) await rm(file, { force: true });
});

type Profile = Awaited<ReturnType<typeof ProcessSandbox.probe>>;

type Fixture = {
  readonly root: string;
  readonly workspace: WorkspaceSandbox;
  readonly profile: Profile;
};

async function createReadOnlyFixture(options: {
  readonly files?: Readonly<Record<string, string>>;
  readonly directories?: readonly string[];
  readonly git?: boolean;
  readonly deniedPrefixes?: readonly string[];
  /** Runs after the workspace files exist but before the read-only probe, so a
   * Host-denied subtree can contain IPC endpoints while the canary runs. */
  readonly setup?: (root: string) => Promise<void>;
} = {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "k-readonly-sandbox-"));
  tempRoots.push(root);
  for (const directory of options.directories ?? []) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  if (options.git === true) {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["-C", root, "config", "user.email", "k-readonly@example.invalid"]);
    execFileSync("git", ["-C", root, "config", "user.name", "K Readonly"]);
    execFileSync("git", ["-C", root, "add", "-A"]);
    execFileSync("git", ["-C", root, "commit", "-q", "-m", "initial"]);
  }
  if (options.setup !== undefined) await options.setup(root);
  const workspace = await WorkspaceSandbox.create(
    root,
    options.deniedPrefixes === undefined ? {} : { deniedPrefixes: [...options.deniedPrefixes] },
  );
  const profile = await ProcessSandbox.probe(root, workspace, { workspaceMode: "read_only" });
  return { root, workspace, profile };
}

/** A sandbox-local attempt to connect to a pathname Unix socket; prints connected/refused. */
function unixSocketAttempt(target: string): string {
  return (
    "python3 -c \"import socket\n"
    + "s = socket.socket(socket.AF_UNIX)\n"
    + "s.settimeout(2)\n"
    + "try:\n"
    + `    s.connect('${target}')\n`
    + "    print('connected')\n"
    + "except OSError:\n"
    + "    print('refused')\n\""
  );
}

function requireAvailable(profile: Profile): void {
  expect(profile.available, `read-only sandbox unavailable: ${profile.reason ?? "unknown"}`).toBe(true);
}

function readOnlySandbox(fixture: Fixture): ProcessSandbox {
  return new ProcessSandbox(fixture.profile, fixture.root, fixture.workspace, {
    workspaceMode: "read_only",
  });
}

/**
 * D-ONECHECK test seam (boundary double, not a production hook): a delegating
 * `WorkspaceSandbox` that replaces the regular `.git` file with a directory
 * holding `private/secret.txt` during the first `snapshot()` call. The mount
 * snapshot is taken at the top of `#run`, before `workspace.snapshot()`, so the
 * plan still sees the file while the mount sees the directory.
 */
function flipGitFileToDirectoryOnSnapshot(
  workspace: WorkspaceSandbox,
  root: string,
): WorkspaceSandbox {
  let flipped = false;
  const flip = async (): Promise<void> => {
    if (flipped) return;
    flipped = true;
    await rm(path.join(root, ".git"), { force: true });
    await mkdir(path.join(root, ".git", "private"), { recursive: true });
    await writeFile(path.join(root, ".git", "private", "secret.txt"), "INTERLEAVE-SECRET");
  };
  return new Proxy(workspace, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "snapshot") {
        return async (...args: unknown[]) => {
          await flip();
          return (value as (...innerArgs: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === "function"
        ? (value as (...innerArgs: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as WorkspaceSandbox;
}

/**
 * A probe wrapper that behaves like bubblewrap but exits non-zero on one option.
 * It delegates every other invocation to the real bwrap, so the test proves the
 * probe result changed because of the rejected option, not because bwrap was missing.
 */
async function writeBwrapWrapper(name: string, rejectOptions: readonly string[]): Promise<string> {
  const directory = path.resolve(process.cwd(), ".dsh-scratch");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  const realBwrap = process.env["CODING_AGENT_BWRAP_PATH"] ?? "/usr/bin/bwrap";
  const lines = [
    "#!/bin/sh",
    `REAL="\${CODING_AGENT_BWRAP_PATH:-${realBwrap}}"`,
    'for arg in "$@"; do',
    "  :",
    ...rejectOptions.map(
      (option) =>
        `  if [ "$arg" = ${JSON.stringify(option)} ]; then echo "bwrap: unrecognized option" >&2; exit 1; fi`,
    ),
    "done",
    'exec "$REAL" "$@"',
    "",
  ];
  await writeFile(file, lines.join("\n"));
  await chmod(file, 0o755);
  scratchFiles.push(file);
  return file;
}

function execute(
  sandbox: ProcessSandbox,
  command: string,
  options: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly outputLimitBytes?: number;
    readonly signal?: AbortSignal;
  } = {},
): ReturnType<ProcessSandbox["execute"]> {
  return sandbox.execute({
    command,
    cwd: options.cwd ?? ".",
    timeoutMs: options.timeoutMs ?? 10_000,
    outputLimitBytes: options.outputLimitBytes ?? 32 * 1024,
    signal: options.signal ?? new AbortController().signal,
  });
}

describe("K read-only ProcessSandbox (KE5)", () => {
  it("KB-01 read_only refuses every workspace write and leaves the sentinel byte-identical", async () => {
    const fixture = await createReadOnlyFixture({
      directories: ["sub", ".evaluator"],
      files: { "sentinel.txt": "SENTINEL-KB01", "sub/keep.txt": "KEEP" },
    });
    requireAvailable(fixture.profile);
    const sandbox = readOnlySandbox(fixture);
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
      const result = await execute(sandbox, command);
      expect(result.exitCode, `${label} (${command}) must fail`).not.toBe(0);
    }
    expect(await readFile(path.join(fixture.root, "sentinel.txt"), "utf8")).toBe("SENTINEL-KB01");
    expect(await readFile(path.join(fixture.root, "sub", "keep.txt"), "utf8")).toBe("KEEP");
    for (const absent of [
      "root-write.txt",
      "sub/sub-write.txt",
      "created.txt",
      "renamed.txt",
      ".evaluator/protected-write.txt",
    ]) {
      await expect(access(path.join(fixture.root, absent)), `${absent} must not exist`).rejects.toThrow();
    }
    expect(await readdir(path.join(fixture.root, ".evaluator"))).toEqual([]);
  });

  it("KB-02 read_only lets /tmp and HOME be written, forgets them next call, and never touches the host workspace", async () => {
    const fixture = await createReadOnlyFixture({ files: { "sentinel.txt": "SENTINEL-KB02" } });
    requireAvailable(fixture.profile);
    const sandbox = readOnlySandbox(fixture);
    const token = `kb02-${process.pid.toString(36)}`;
    const first = await execute(
      sandbox,
      `printf ${token} > /tmp/${token}.txt && printf ${token} > "$HOME/${token}.txt" && cat /tmp/${token}.txt "$HOME/${token}.txt"`,
    );
    expect(first.exitCode, first.stderr.text).toBe(0);
    expect(first.stdout.text).toContain(token);
    const second = await execute(
      sandbox,
      `test ! -e /tmp/${token}.txt && test ! -e "$HOME/${token}.txt" && printf gone`,
    );
    expect(second.exitCode).toBe(0);
    expect(second.stdout.text).toBe("gone");
    await expect(access(path.join(fixture.root, `${token}.txt`))).rejects.toThrow();
    await expect(access(path.join("/tmp", `${token}.txt`))).rejects.toThrow();
  });

  it("KB-03 read_only blocks the network, reads git, refuses git writes, and cannot use a linked worktree", async () => {
    const fixture = await createReadOnlyFixture({ git: true, files: { "tracked.txt": "one\n" } });
    requireAvailable(fixture.profile);
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("the local server has no port");
    const port = address.port;
    // Host-side proof: this exact address really accepts a connection.
    await new Promise<void>((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve();
      });
      socket.once("error", reject);
    });
    try {
      const sandbox = readOnlySandbox(fixture);
      await writeFile(path.join(fixture.root, "tracked.txt"), "two\n");
      execFileSync("git", ["-C", fixture.root, "add", "tracked.txt"]);
      const network = await execute(
        sandbox,
        `if timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}'; then printf connected; exit 0; else printf blocked; exit 4; fi`,
      );
      expect(network.exitCode, "the sandbox must not reach the host's local port").toBe(4);
      const log = await execute(sandbox, "git --no-optional-locks -c safe.directory='*' -C /workspace log --oneline");
      expect(log.exitCode, log.stderr.text).toBe(0);
      const diff = await execute(sandbox, "git --no-optional-locks -c safe.directory='*' -C /workspace diff --cached");
      expect(diff.exitCode, diff.stderr.text).toBe(0);
      expect(diff.stdout.text).toContain("two");
      const commit = await execute(sandbox, "git --no-optional-locks -c safe.directory='*' -C /workspace commit -m blocked");
      expect(commit.exitCode, "commit writes .git and must fail").not.toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const base = await mkdtemp(path.join(tmpdir(), "k-readonly-worktree-"));
    tempRoots.push(base);
    const main = path.join(base, "main");
    const linked = path.join(base, "linked");
    await mkdir(main);
    execFileSync("git", ["init", "-q"], { cwd: main });
    execFileSync("git", ["-C", main, "config", "user.email", "k-readonly@example.invalid"]);
    execFileSync("git", ["-C", main, "config", "user.name", "K Readonly"]);
    await writeFile(path.join(main, "file.txt"), "one\n");
    execFileSync("git", ["-C", main, "add", "-A"]);
    execFileSync("git", ["-C", main, "commit", "-q", "-m", "initial"]);
    execFileSync("git", ["-C", main, "worktree", "add", linked, "-b", "wt"]);
    const linkedWorkspace = await WorkspaceSandbox.create(linked);
    const linkedProfile = await ProcessSandbox.probe(linked, linkedWorkspace, {
      workspaceMode: "read_only",
    });
    requireAvailable(linkedProfile);
    const linkedSandbox = new ProcessSandbox(linkedProfile, linked, linkedWorkspace, {
      workspaceMode: "read_only",
    });
    const linkedLog = await execute(linkedSandbox, "git --no-optional-locks -c safe.directory='*' -C /workspace log --oneline");
    expect(linkedLog.exitCode, "a linked worktree's .git file is masked and git must fail").not.toBe(0);
  });

  it("KB-04 read_only rejects escaping cwd, hides the parent environment, and closes the inherited root fd", async () => {
    const fixture = await createReadOnlyFixture({
      directories: [".evaluator"],
      files: { "sentinel.txt": "SENTINEL-KB04" },
    });
    requireAvailable(fixture.profile);
    const sandbox = readOnlySandbox(fixture);
    const badCwds: ReadonlyArray<readonly [string, string]> = [
      ["parent escape", ".."],
      ["absolute path", "/etc"],
      ["protected path", ".evaluator"],
    ];
    for (const [label, cwd] of badCwds) {
      const rejection = execute(sandbox, "printf started", { cwd });
      await expect(rejection, label).rejects.toBeInstanceOf(ProcessSandboxError);
      await expect(rejection, label).rejects.toMatchObject({ code: "invalid_arguments" });
    }
    const outside = await mkdtemp(path.join(tmpdir(), "k-readonly-outside-"));
    tempRoots.push(outside);
    await symlink(outside, path.join(fixture.root, "escape"));
    const escape = execute(sandbox, "printf started", { cwd: "escape" });
    await expect(escape, "relative symlink escape").rejects.toBeInstanceOf(ProcessSandboxError);
    await expect(escape, "relative symlink escape").rejects.toMatchObject({ code: "invalid_arguments" });

    const name = "KB04_PARENT_SENTINEL";
    const previous = process.env[name];
    process.env[name] = "kb04-secret";
    try {
      const environment = await execute(
        sandbox,
        `if [ -n "\${${name}:-}" ]; then printf leaked; exit 5; fi; printf unset`,
      );
      expect(environment.exitCode).toBe(0);
      expect(environment.stdout.text).toBe("unset");
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }

    const rootFd = await execute(sandbox, "if [ -e /proc/self/fd/3 ]; then printf leaked; exit 6; fi; printf closed");
    expect(rootFd.exitCode).toBe(0);
    expect(rootFd.stdout.text).toBe("closed");
  });

  it("KB-05 read_only retains output emitted before timeout and cancellation, and reports 32 KiB truncation", async () => {
    const fixture = await createReadOnlyFixture({ files: { "sentinel.txt": "SENTINEL-KB05" } });
    requireAvailable(fixture.profile);
    const sandbox = readOnlySandbox(fixture);
    const timedOut = await execute(sandbox, "printf 'before-timeout\\n'; sleep 30", {
      timeoutMs: 500,
    });
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.cancelled).toBe(false);
    expect(timedOut.stdout.text, "output captured before the timeout must be retained").toContain(
      "before-timeout",
    );

    const controller = new AbortController();
    const pending = execute(sandbox, "printf 'before-cancel\\n'; sleep 30; printf done", {
      timeoutMs: 20_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 500);
    const cancelled = await pending;
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.timedOut).toBe(false);
    expect(cancelled.stdout.text, "output captured before the cancellation must be retained").toContain(
      "before-cancel",
    );
    expect(cancelled.stdout.text).not.toContain("done");

    const totalBytes = 40_000;
    const limit = 32 * 1024;
    const stdout = await execute(
      sandbox,
      `head -c ${totalBytes} /dev/zero | tr '\\0' a`,
      { outputLimitBytes: limit },
    );
    expect(stdout.exitCode, stdout.stderr.text).toBe(0);
    expect(stdout.stdout.truncated).toBe(true);
    expect(stdout.stdout.totalBytes).toBe(totalBytes);
    expect(stdout.stdout.text.length).toBe(limit);
    expect(stdout.stdout.text).toBe("a".repeat(limit));

    const stderr = await execute(
      sandbox,
      `head -c ${totalBytes} /dev/zero | tr '\\0' b >&2`,
      { outputLimitBytes: limit },
    );
    expect(stderr.exitCode, stderr.stderr.text).toBe(0);
    expect(stderr.stderr.truncated).toBe(true);
    expect(stderr.stderr.totalBytes).toBe(totalBytes);
    expect(stderr.stderr.text).toBe("b".repeat(limit));
  });

  it("KB-06 read_only probe reports unavailable and execute refuses to start the command anywhere", async () => {
    const fixture = await createReadOnlyFixture({ files: { "sentinel.txt": "SENTINEL-KB06" } });
    const profile = await ProcessSandbox.probe(fixture.root, fixture.workspace, {
      bwrapPath: path.join(fixture.root, "no-such-bwrap"),
      workspaceMode: "read_only",
    });
    expect(profile.available).toBe(false);
    expect(profile.bwrapPath).toBeNull();
    const sandbox = new ProcessSandbox(profile, fixture.root, fixture.workspace, {
      workspaceMode: "read_only",
    });
    const hostMarker = path.join(fixture.root, "kb06-host-marker.txt");
    const rejection = sandbox.execute({
      command: `printf sandbox > /workspace/kb06-sandbox-marker.txt; printf host > ${hostMarker}`,
      cwd: ".",
      timeoutMs: 5_000,
      outputLimitBytes: 32 * 1024,
      signal: new AbortController().signal,
    });
    await expect(rejection).rejects.toBeInstanceOf(ProcessSandboxError);
    await expect(rejection).rejects.toMatchObject({ code: "sandbox_unavailable" });
    await expect(access(hostMarker), "the command must not start on the host").rejects.toThrow();
    await expect(
      access(path.join(fixture.root, "kb06-sandbox-marker.txt")),
      "the command must not start in the sandbox",
    ).rejects.toThrow();
  });

  it("KB-11 read_only reports another writer's snapshot-visible change and never advances the Kernel baseline", async () => {
    const fixture = await createReadOnlyFixture({ git: true, files: { "watched.txt": "before\n" } });
    requireAvailable(fixture.profile);
    const sandbox = readOnlySandbox(fixture);
    await fixture.workspace.captureBaseline();
    const pending = execute(sandbox, "sleep 3; printf done", { timeoutMs: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await writeFile(path.join(fixture.root, "watched.txt"), "after\n");
    const result = await pending;
    expect(result.exitCode, result.stderr.text).toBe(0);
    expect(result.effects.sideEffect).toBe("none");
    expect(result.effects.externalChangedPaths).toContain("watched.txt");
    expect(result.effects.externalChangedPathsOmitted).toBe(0);
    const consistency = await fixture.workspace.checkConsistency("workspace");
    expect(consistency.status).toBe("drift_detected");
    expect(consistency.changedPaths).toContain("watched.txt");
  });

  it("KB-03 D-IPC masks a workspace FIFO and Unix socket so the sandbox cannot reach the host endpoints", async () => {
    const fixture = await createReadOnlyFixture({ files: { "sentinel.txt": "SENTINEL-DIPC" } });
    requireAvailable(fixture.profile);
    const fifoPath = path.join(fixture.root, "ipc.fifo");
    execFileSync("mkfifo", [fifoPath]);
    const socketPath = path.join(fixture.root, "service.sock");
    const hostSockets: string[] = [];
    let hostConnections = 0;
    const server = createServer((socket) => {
      hostConnections += 1;
      socket.on("data", (chunk: Buffer) => hostSockets.push(chunk.toString("utf8")));
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    // O_RDWR|O_NONBLOCK opens the FIFO without waiting for a writer, so the host
    // can read afterwards whatever (if anything) reached the real FIFO.
    const fifoHost = await open(fifoPath, constants.O_RDWR | constants.O_NONBLOCK);
    try {
      const sandbox = readOnlySandbox(fixture);
      const endpoints = await execute(
        sandbox,
        "if [ -p /workspace/ipc.fifo ]; then printf fifo-present; else printf fifo-masked; fi; "
          + "if [ -S /workspace/service.sock ]; then printf socket-present; else printf socket-masked; fi",
      );
      expect(endpoints.exitCode, endpoints.stderr.text).toBe(0);
      expect(endpoints.stdout.text).toBe("fifo-maskedsocket-masked");

      const fifoWrite = await execute(
        sandbox,
        "if timeout 3 bash -c 'printf ipc-escape > /workspace/ipc.fifo'; then printf wrote; else printf blocked; fi",
      );
      expect(fifoWrite.timedOut).toBe(false);
      // The mask is a read-only bind of /dev/null: depending on the kernel the
      // write is discarded or refused. Either way nothing reaches the host reader
      // (asserted below). (Lead 2026-10-14, run with real bubblewrap: "blocked".)
      expect(["wrote", "blocked"]).toContain(fifoWrite.stdout.text);

      const socketAttempt = await execute(sandbox, unixSocketAttempt("/workspace/service.sock"));
      expect(socketAttempt.exitCode, socketAttempt.stderr.text).toBe(0);
      expect(socketAttempt.stdout.text.trim()).toBe("refused");

      const buffer = Buffer.alloc(64);
      let hostBytes = 0;
      try {
        hostBytes = (await fifoHost.read(buffer, 0, buffer.length, null)).bytesRead;
      } catch {
        hostBytes = 0;
      }
      expect(hostBytes, "the host FIFO reader must receive nothing").toBe(0);
      expect(hostConnections, "the host Unix socket must receive no connection").toBe(0);
      expect(hostSockets).toEqual([]);
    } finally {
      await fifoHost.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("KB-03 D-IPC skips masked protected subtrees so an endpoint there cannot break the launch", async () => {
    let server: ReturnType<typeof createServer> | undefined;
    const fixture = await createReadOnlyFixture({
      git: true,
      files: { "tracked.txt": "one\n" },
      deniedPrefixes: [".git/private"],
      setup: async (root) => {
        const privateDir = path.join(root, ".git", "private");
        await mkdir(privateDir, { recursive: true });
        await writeFile(path.join(privateDir, "secret.txt"), "GIT-PRIVATE-SECRET");
        execFileSync("mkfifo", [path.join(privateDir, "ipc.fifo")]);
        server = createServer();
        await new Promise<void>((resolve) =>
          server!.listen(path.join(privateDir, "service.sock"), resolve),
        );
      },
    });
    try {
      // Before the fix the walk descended into the empty read-only tmpfs and the
      // socket mask made bubblewrap die EROFS, so the probe itself was unavailable.
      requireAvailable(fixture.profile);
      const sandbox = readOnlySandbox(fixture);
      const ran = await execute(sandbox, "printf ran");
      expect(ran.exitCode, ran.stderr.text).toBe(0);
      expect(ran.stdout.text).toBe("ran");
      const leaked = await execute(sandbox, "cat /workspace/.git/private/secret.txt");
      expect(leaked.exitCode, "the Host-denied .git/private content must stay hidden").not.toBe(0);
      expect(leaked.stdout.text).not.toContain("GIT-PRIVATE-SECRET");
    } finally {
      if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  it("KB-03 D-IPC finds a root-level socket before a deep sibling tree exhausts the walk bound", async () => {
    let server: ReturnType<typeof createServer> | undefined;
    const fixture = await createReadOnlyFixture({
      directories: Array.from({ length: 8 }, (_, index) => `aaa-huge/dir-${index}`),
      files: { "sentinel.txt": "SENTINEL-DIPC-BFS" },
      setup: async (root) => {
        server = createServer();
        await new Promise<void>((resolve) =>
          server!.listen(path.join(root, "service.sock"), resolve),
        );
      },
    });
    try {
      requireAvailable(fixture.profile);
      // A tiny bound makes the depth-first defect deterministic: `aaa-huge` sorts
      // first and alone exceeds it, so a depth-first walk never sees the socket.
      const sandbox = new ProcessSandbox(fixture.profile, fixture.root, fixture.workspace, {
        workspaceMode: "read_only",
        ipcWalkMaxEntries: 4,
      });
      const endpoints = await execute(
        sandbox,
        "if [ -S /workspace/service.sock ]; then printf socket-present; else printf socket-masked; fi",
      );
      expect(endpoints.exitCode, endpoints.stderr.text).toBe(0);
      expect(endpoints.stdout.text).toBe("socket-masked");
    } finally {
      if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  it("KB-03 D-IPC masks a socket and FIFO inside the readable .git mount", async () => {
    let server: ReturnType<typeof createServer> | undefined;
    let hostConnections = 0;
    const fixture = await createReadOnlyFixture({
      git: true,
      files: { "tracked.txt": "one\n" },
      setup: async (root) => {
        execFileSync("mkfifo", [path.join(root, ".git", "ipc.fifo")]);
        server = createServer(() => {
          hostConnections += 1;
        });
        await new Promise<void>((resolve) =>
          server!.listen(path.join(root, ".git", "service.sock"), resolve),
        );
      },
    });
    try {
      requireAvailable(fixture.profile);
      const sandbox = readOnlySandbox(fixture);
      const endpoints = await execute(
        sandbox,
        "if [ -p /workspace/.git/ipc.fifo ]; then printf fifo-present; else printf fifo-masked; fi; "
          + "if [ -S /workspace/.git/service.sock ]; then printf socket-present; else printf socket-masked; fi",
      );
      expect(endpoints.exitCode, endpoints.stderr.text).toBe(0);
      expect(endpoints.stdout.text).toBe("fifo-maskedsocket-masked");
      const attempt = await execute(sandbox, unixSocketAttempt("/workspace/.git/service.sock"));
      expect(attempt.exitCode, attempt.stderr.text).toBe(0);
      expect(attempt.stdout.text.trim()).toBe("refused");
      expect(hostConnections).toBe(0);
    } finally {
      if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });

  it("KB-03 D-GIT keeps a Host-denied .git subtree hidden while git still reads history", async () => {
    const fixture = await createReadOnlyFixture({
      git: true,
      files: { "tracked.txt": "one\n" },
      deniedPrefixes: [".git/private", ".git/private/secret.txt"],
    });
    requireAvailable(fixture.profile);
    await mkdir(path.join(fixture.root, ".git", "private"), { recursive: true });
    await writeFile(path.join(fixture.root, ".git", "private", "secret.txt"), "GIT-PRIVATE-SECRET");
    const sandbox = readOnlySandbox(fixture);
    const leaked = await execute(sandbox, "cat /workspace/.git/private/secret.txt");
    expect(leaked.exitCode, "a Host-denied .git file must stay hidden").not.toBe(0);
    expect(leaked.stdout.text).not.toContain("GIT-PRIVATE-SECRET");
    const history = await execute(
      sandbox,
      "git --no-optional-locks -c safe.directory='*' -C /workspace log --oneline",
    );
    expect(history.exitCode, history.stderr.text).toBe(0);
    expect(history.stdout.text.length).toBeGreaterThan(0);
  });

  it("KB-03 D-GITFILE keeps ordinary commands working when a linked worktree's .git is a file with a denied descendant", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "k-readonly-gitfile-"));
    tempRoots.push(base);
    const main = path.join(base, "main");
    const linked = path.join(base, "linked");
    await mkdir(main);
    execFileSync("git", ["init", "-q"], { cwd: main });
    execFileSync("git", ["-C", main, "config", "user.email", "k-readonly@example.invalid"]);
    execFileSync("git", ["-C", main, "config", "user.name", "K Readonly"]);
    await writeFile(path.join(main, "file.txt"), "one\n");
    execFileSync("git", ["-C", main, "add", "-A"]);
    execFileSync("git", ["-C", main, "commit", "-q", "-m", "initial"]);
    execFileSync("git", ["-C", main, "worktree", "add", linked, "-b", "wt"]);
    // A linked worktree's `.git` is a regular file (a gitdir pointer), not a
    // directory; `.git/private` need not exist on the host. Before D-GITFILE the
    // denied descendant survived pruning, lstat failed with ENOTDIR and every
    // read-only command was refused.
    expect((await lstat(path.join(linked, ".git"))).isFile()).toBe(true);
    const workspace = await WorkspaceSandbox.create(linked, {
      deniedPrefixes: [".git/private"],
    });
    const profile = await ProcessSandbox.probe(linked, workspace, { workspaceMode: "read_only" });
    requireAvailable(profile);
    const sandbox = new ProcessSandbox(profile, linked, workspace, { workspaceMode: "read_only" });
    const ordinary = await execute(sandbox, "printf hello");
    expect(ordinary.exitCode, ordinary.stderr.text).toBe(0);
    expect(ordinary.stdout.text).toBe("hello");
    const gitLog = await execute(
      sandbox,
      "git --no-optional-locks -c safe.directory='*' -C /workspace log --oneline",
    );
    expect(gitLog.exitCode, "a linked worktree's .git file is masked and git must fail").not.toBe(0);
  });

  it("KB-03 D-ONECHECK plans a file .git as masked and drops every protected descendant", () => {
    const plan = planReadonlyMounts({
      paths: [
        { path: ".git", kind: "file" },
        { path: ".git/private", kind: "directory" },
        { path: ".git/private/secret.txt", kind: "file" },
      ],
    });
    expect(plan.mounts).toEqual([{ path: ".git", action: "mask-devnull" }]);
    expect(plan.maskedSubtrees).toEqual([".git"]);
    expect(plan.readableSubtrees).toEqual([]);
    expect(plan.dropped).toEqual([".git/private", ".git/private/secret.txt"]);
    expect(plan.remountScratch).toBe(true);
    expect(readonlyIpcSkips(plan, ".git")).toBe(true);
    expect(readonlyIpcSkips(plan, ".git/private")).toBe(true);
    expect(readonlyIpcSkips(plan, ".git/private/secret.txt")).toBe(true);
    expect(readonlyIpcSkips(plan, "tracked.txt")).toBe(false);
  });

  it("KB-03 D-ONECHECK keeps directory .git descendant overlays and skips exactly the masked subtrees", () => {
    const plan = planReadonlyMounts({
      paths: [
        { path: ".git", kind: "directory" },
        { path: ".git/private", kind: "directory" },
      ],
    });
    expect(plan.mounts).toEqual([
      { path: ".git", action: "bind-readonly" },
      { path: ".git/private", action: "mask-tmpfs" },
    ]);
    expect(plan.readableSubtrees).toEqual([".git"]);
    expect(plan.maskedSubtrees).toEqual([".git/private"]);
    expect(plan.dropped).toEqual([]);
    expect(plan.remountScratch).toBe(false);
    // The derived IPC skip decision, one hand-written expectation per path:
    // exactly `.git/private` and its descendants, no more and no fewer. `.git`
    // stays readable, and `.github` is not inside `.git/`.
    const decisions: ReadonlyArray<readonly [string, boolean]> = [
      [".git", false],
      [".git/objects", false],
      [".git/ipc.fifo", false],
      [".git/service.sock", false],
      [".git/private", true],
      [".git/private/secret.txt", true],
      [".git/private/ipc.fifo", true],
      [".github", false],
      ["plain.txt", false],
    ];
    for (const [relative, expected] of decisions) {
      expect(readonlyIpcSkips(plan, relative), relative).toBe(expected);
    }
  });

  it("KB-03 D-ONECHECK gives a missing protected path no overlay", () => {
    const plan = planReadonlyMounts({
      paths: [
        { path: ".git", kind: "directory" },
        { path: "credentials", kind: "absent" },
        { path: "credentials/token.txt", kind: "absent" },
      ],
    });
    expect(plan.mounts).toEqual([{ path: ".git", action: "bind-readonly" }]);
    expect(plan.maskedSubtrees).toEqual([]);
    expect(plan.readableSubtrees).toEqual([".git"]);
    expect(plan.dropped).toEqual([]);
    expect(readonlyIpcSkips(plan, "credentials")).toBe(false);
    expect(readonlyIpcSkips(plan, "credentials/token.txt")).toBe(false);
  });

  it("KB-03 D-ONECHECK drops a protected descendant under a masked non-.git ancestor", () => {
    const plan = planReadonlyMounts({
      paths: [
        { path: "secret", kind: "directory" },
        { path: "secret/inner", kind: "directory" },
        { path: "secret/inner/key.txt", kind: "file" },
      ],
    });
    expect(plan.mounts).toEqual([{ path: "secret", action: "mask-tmpfs" }]);
    expect(plan.maskedSubtrees).toEqual(["secret"]);
    expect(plan.readableSubtrees).toEqual([]);
    expect(plan.dropped).toEqual(["secret/inner", "secret/inner/key.txt"]);
    expect(plan.remountScratch).toBe(false);
    expect(readonlyIpcSkips(plan, "secret/inner/key.txt")).toBe(true);
    expect(readonlyIpcSkips(plan, "secrets")).toBe(false);
  });

  it("KB-03 D-ONECHECK fails closed when .git is replaced by a directory after the mount snapshot", async () => {
    const fixture = await createReadOnlyFixture({
      files: { "tracked.txt": "one\n", ".git": "gitdir: elsewhere\n" },
      deniedPrefixes: [".git/private"],
    });
    requireAvailable(fixture.profile);
    expect((await lstat(path.join(fixture.root, ".git"))).isFile()).toBe(true);
    const sandbox = new ProcessSandbox(
      fixture.profile,
      fixture.root,
      flipGitFileToDirectoryOnSnapshot(fixture.workspace, fixture.root),
      { workspaceMode: "read_only" },
    );
    const result = await execute(
      sandbox,
      "if [ -f /workspace/.git/private/secret.txt ]; then cat /workspace/.git/private/secret.txt; fi",
    );
    // The plan masked `.git` with /dev/null while it was a file; bubblewrap must
    // refuse that bind against the directory that appeared afterwards.
    expect(result.exitCode, `the mount must fail closed: ${result.stderr.text}`).not.toBe(0);
    expect(result.stdout.text).not.toContain("INTERLEAVE-SECRET");
    expect(await readFile(path.join(fixture.root, ".git", "private", "secret.txt"), "utf8")).toBe(
      "INTERLEAVE-SECRET",
    );
  });

  it("KB-06 D-PROBE rejects bubblewrap without --ro-bind-fd or --remount-ro and starts nothing", async () => {
    // A workspace with no protected directory: the only --remount-ro in the
    // canary must come from the scratch tmpfs, so a bwrap missing that option is caught too.
    const fixture = await createReadOnlyFixture({ files: { "plain.txt": "plain" } });
    const passthrough = await writeBwrapWrapper("k-readonly-bwrap-passthrough.sh", []);
    const control = await ProcessSandbox.probe(fixture.root, fixture.workspace, {
      bwrapPath: passthrough,
      workspaceMode: "read_only",
    });
    expect(
      control.available,
      `the wrapper must delegate to a real bubblewrap: ${control.reason ?? "unknown"}`,
    ).toBe(true);

    for (const option of ["--ro-bind-fd", "--remount-ro"] as const) {
      const suffix = option.replaceAll("-", "");
      const wrapper = await writeBwrapWrapper(`k-readonly-bwrap-no-${suffix}.sh`, [option]);
      const profile = await ProcessSandbox.probe(fixture.root, fixture.workspace, {
        bwrapPath: wrapper,
        workspaceMode: "read_only",
      });
      expect(profile.available, `a bubblewrap without ${option} must be unavailable`).toBe(false);
      expect(profile.bwrapPath).toBeNull();
      const sandbox = new ProcessSandbox(profile, fixture.root, fixture.workspace, {
        workspaceMode: "read_only",
      });
      const hostMarker = path.join(fixture.root, `dprobe-host-${suffix}.txt`);
      const rejection = sandbox.execute({
        command: `printf sandbox > /workspace/dprobe-sandbox-${suffix}.txt; printf host > ${hostMarker}`,
        cwd: ".",
        timeoutMs: 5_000,
        outputLimitBytes: 32 * 1024,
        signal: new AbortController().signal,
      });
      await expect(rejection).rejects.toBeInstanceOf(ProcessSandboxError);
      await expect(rejection).rejects.toMatchObject({ code: "sandbox_unavailable" });
      await expect(access(hostMarker), "the command must not start on the host").rejects.toThrow();
      await expect(
        access(path.join(fixture.root, `dprobe-sandbox-${suffix}.txt`)),
        "the command must not start in the sandbox",
      ).rejects.toThrow();
    }
  });

  it("KB-04 D-CWD rejects a cwd that is a regular file before launch", async () => {
    const fixture = await createReadOnlyFixture({ files: { "regular.txt": "not a directory" } });
    requireAvailable(fixture.profile);
    const sandbox = readOnlySandbox(fixture);
    const rejection = execute(sandbox, "printf started > /workspace/d-cwd-marker.txt", {
      cwd: "regular.txt",
    });
    await expect(rejection).rejects.toBeInstanceOf(ProcessSandboxError);
    await expect(rejection).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(
      access(path.join(fixture.root, "d-cwd-marker.txt")),
      "a regular-file cwd must be rejected before the command starts",
    ).rejects.toThrow();
  });
});
