/**
 * 模块职责：在受控工作目录和环境中启动子进程，并限制时间、输出和取消行为。
 *
 * 设计边界：审批由上层完成；本模块只执行已获准请求并返回结构化结果与副作用摘要。
 * 关键流程：校验 profile 与路径，构造最小环境，启动进程，捕获输出，超时或取消时清理进程树。
 */
import { spawn } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import { access, lstat } from "node:fs/promises";
import path from "node:path";

import type { ToolEffects } from "../../core/ports/tool_executor/tool-executor-port.js";
import { normalizeWorkspacePath } from "../../policy/permissions/permission-policy.js";
import type { WorkspaceSandbox } from "../workspace/workspace-sandbox.js";

export interface ProcessSandboxProfile {
  readonly available: boolean;
  readonly version: string;
  readonly bwrapPath: string | null;
  readonly reason: string | null;
}

export interface ProcessExecutionRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly signal: AbortSignal;
  /** 探针等已知零业务副作用的命令可跳过工作区前后快照。 */
  readonly captureWorkspaceEffects?: boolean;
}

export interface CapturedOutput {
  readonly text: string;
  readonly totalBytes: number;
  readonly truncated: boolean;
}

export interface ProcessExecutionResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly stdout: CapturedOutput;
  readonly stderr: CapturedOutput;
  readonly effects: ToolEffects;
  readonly sandboxProfileVersion: string;
  readonly timings: {
    readonly snapshotBeforeMs: number;
    readonly executionMs: number;
    readonly snapshotAfterMs: number;
  };
}

export interface ProcessSandboxOptions {
  readonly protectedPaths?: readonly string[];
  /** Host-prepared runtime directories, mounted read-only; no permission to host paths. */
  readonly readOnlyPaths?: readonly string[];
  readonly executablePath?: string;
}

export class ProcessSandboxError extends Error {
  constructor(
    readonly code: "sandbox_unavailable" | "launch_failed",
    message: string,
  ) {
    super(message);
    this.name = "ProcessSandboxError";
  }
}

const DEFAULT_PROTECTED_PATHS = [
  ".git",
  ".env",
  ".env.local",
  "credentials",
  "credentials.json",
] as const;

async function commandOutput(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString("utf8").trim());
      else reject(new Error(`process exited ${String(code)}`));
    });
  });
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  retained: { bytes: number },
  limit: number,
): void {
  const remaining = Math.max(0, limit - retained.bytes);
  if (remaining > 0) {
    const selected = chunk.subarray(0, remaining);
    chunks.push(selected);
    retained.bytes += selected.byteLength;
  }
}

function captured(chunks: readonly Buffer[], totalBytes: number, limit: number): CapturedOutput {
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)),
    totalBytes,
    truncated: totalBytes > limit,
  };
}

/**
 * bubblewrap 进程隔离适配器。workspace 通过已打开的 fd 绑定，敏感路径
 * 再以只读或空挂载覆盖；能力探测失败时绝不退化成宿主 shell。
 */
export class ProcessSandbox {
  static readonly PROFILE_VERSION = "bwrap-m3-v4";
  readonly #protectedPaths: readonly string[];
  readonly #readOnlyPaths: readonly string[];
  readonly #executablePath: string;

  constructor(
    readonly profile: ProcessSandboxProfile,
    private readonly workspaceRoot: string,
    private readonly workspace: WorkspaceSandbox,
    options: ProcessSandboxOptions = {},
  ) {
    if (!path.isAbsolute(this.workspaceRoot)) {
      throw new RangeError("ProcessSandbox workspace root 必须是绝对路径");
    }
    this.#readOnlyPaths = options.readOnlyPaths ?? [];
    for (const relative of this.#readOnlyPaths) {
      if (!/^[A-Za-z0-9._-]+$/.test(relative) || !relative || relative.startsWith("/") || relative.split("/").some(p => p === ".." || p === "." || !p) || relative.includes("\\")) throw new Error("Invalid read-only runtime path");
    }
    this.#executablePath = options.executablePath ?? "/usr/bin:/bin";
    this.#protectedPaths = [
      ...new Set([
        ...this.workspace.deniedPrefixes,
        ...DEFAULT_PROTECTED_PATHS,
        ...(options.protectedPaths ?? []),
      ]),
    ]
      .map((value) => normalizeWorkspacePath(value))
      .filter(value => !this.#readOnlyPaths.includes(value) || (DEFAULT_PROTECTED_PATHS as readonly string[]).includes(value))
      .sort();
  }

  static async probe(
    workspaceRoot: string,
    workspace: WorkspaceSandbox,
    options: Readonly<{ bwrapPath?: string }> = {},
  ): Promise<ProcessSandboxProfile> {
    try {
      const bwrapPath =
        options.bwrapPath ?? process.env["CODING_AGENT_BWRAP_PATH"] ?? "/usr/bin/bwrap";
      if (!path.isAbsolute(bwrapPath)) {
        throw new Error("bubblewrap 路径必须是绝对路径");
      }
      await access(bwrapPath);
      const versionText = await commandOutput(bwrapPath, ["--version"]);
      const sandbox = new ProcessSandbox(
        {
          available: true,
          version: `${ProcessSandbox.PROFILE_VERSION}:${versionText}`,
          bwrapPath,
          reason: null,
        },
        workspaceRoot,
        workspace,
      );
      const canary = await sandbox.execute({
        command:
          'test "$HOME" = /home/agent && ' +
          "test ! -e /etc/shadow && " +
          "test ! -e /proc/self/fd/3 && " +
          'test -z "$(awk -F: \'NR > 2 { gsub(/ /, "", $1); if ($1 != "lo") print $1 }\' /proc/net/dev)" && ' +
          "for item in .evaluator .oracle hidden-tests; do " +
          'test ! -e "/workspace/$item" || test -z "$(ls -A "/workspace/$item" 2>/dev/null)"; ' +
          "done && " +
          "if test -d /workspace/.git; then ! touch /workspace/.git/.codex-write-canary; fi",
        cwd: ".",
        timeoutMs: 5_000,
        outputLimitBytes: 1_024,
        signal: new AbortController().signal,
        captureWorkspaceEffects: false,
      });
      if (canary.exitCode !== 0 || canary.timedOut) {
        const detail = canary.stderr.text.trim().slice(0, 256);
        throw new Error(
          `sandbox canary failed (exit=${String(canary.exitCode)}, signal=${String(canary.signal)}, timedOut=${String(canary.timedOut)})${detail ? `: ${detail}` : ""}`,
        );
      }
      return sandbox.profile;
    } catch (error) {
      return {
        available: false,
        version: ProcessSandbox.PROFILE_VERSION,
        bwrapPath: null,
        reason: error instanceof Error ? error.message : "bubblewrap probe failed",
      };
    }
  }

  async execute(request: ProcessExecutionRequest): Promise<ProcessExecutionResult> {
    if (!this.profile.available || !this.profile.bwrapPath) {
      throw new ProcessSandboxError("sandbox_unavailable", "隔离进程能力不可用");
    }
    if (request.signal.aborted) {
      return this.#notStartedResult(true, false, request.outputLimitBytes);
    }
    const cwd = normalizeWorkspacePath(request.cwd, true);
    const captureWorkspaceEffects = request.captureWorkspaceEffects ?? true;
    const beforeStartedAt = performance.now();
    const before = captureWorkspaceEffects ? await this.workspace.snapshot() : null;
    const snapshotBeforeMs = Math.max(0, performance.now() - beforeStartedAt);
    const rootCapability = await this.workspace.acquireRootHandleForProcess();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutRetained = { bytes: 0 };
    const stderrRetained = { bytes: 0 };
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let cancelled = false;

    let result: { exitCode: number | null; signal: NodeJS.Signals | null };
    const executionStartedAt = performance.now();
    try {
      const args = await this.#arguments(request.command, cwd, rootCapability);
      result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          const child = spawn(this.profile.bwrapPath!, args, {
            detached: true,
            // fd 3 是只读继承的 workspace 根句柄；bwrap 完成挂载后必须在 exec 前关闭它。
            stdio: ["ignore", "pipe", "pipe", rootCapability.fd],
            env: { PATH: "/usr/bin:/bin" },
          });
          const terminate = (reason: "timeout" | "cancel") => {
            if (reason === "timeout") timedOut = true;
            else cancelled = true;
            if (child.pid) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                // 进程组可能已经退出。
              }
              const killTimer = setTimeout(() => {
                try {
                  process.kill(-child.pid!, "SIGKILL");
                } catch {
                  // 进程组可能已经退出。
                }
              }, 250);
              killTimer.unref?.();
            }
          };
          const timeout = setTimeout(() => terminate("timeout"), request.timeoutMs);
          timeout.unref?.();
          const onAbort = () => terminate("cancel");
          request.signal.addEventListener("abort", onAbort, { once: true });
          child.stdout!.on("data", (chunk: Buffer) => {
            stdoutBytes += chunk.byteLength;
            appendBounded(stdoutChunks, chunk, stdoutRetained, request.outputLimitBytes);
          });
          child.stderr!.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.byteLength;
            appendBounded(stderrChunks, chunk, stderrRetained, request.outputLimitBytes);
          });
          child.once("error", reject);
          child.once("close", (exitCode, signal) => {
            clearTimeout(timeout);
            request.signal.removeEventListener("abort", onAbort);
            resolve({ exitCode, signal });
          });
        },
      );
    } catch (error) {
      throw new ProcessSandboxError(
        "launch_failed",
        error instanceof Error ? error.message : "隔离进程启动失败",
      );
    } finally {
      await rootCapability.close();
    }
    const executionMs = Math.max(0, performance.now() - executionStartedAt);

    const afterStartedAt = performance.now();
    const after = captureWorkspaceEffects ? await this.workspace.snapshot() : null;
    const snapshotAfterMs = Math.max(0, performance.now() - afterStartedAt);
    const changedPaths = before && after ? this.workspace.diff(before, after) : [];
    const accepted = after ? await this.workspace.acceptAgentChanges(after, changedPaths) : null;
    const effects: ToolEffects =
      changedPaths.length > 0
        ? {
            sideEffect: "confirmed",
            changedPaths,
            workspaceRevision: accepted?.revision ?? null,
            artifactRefs: [],
          }
        : {
            sideEffect: "possible",
            changedPaths: [],
            workspaceRevision: accepted?.revision ?? null,
            artifactRefs: [],
          };
    return {
      ...result,
      timedOut,
      cancelled,
      stdout: captured(stdoutChunks, stdoutBytes, request.outputLimitBytes),
      stderr: captured(stderrChunks, stderrBytes, request.outputLimitBytes),
      effects,
      sandboxProfileVersion: this.profile.version,
      timings: { snapshotBeforeMs, executionMs, snapshotAfterMs },
    };
  }

  async #arguments(command: string, cwd: string, rootCapability: FileHandle): Promise<string[]> {
    const args = [
      "--die-with-parent",
      "--new-session",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-net",
      "--unshare-ipc",
      "--unshare-uts",
      "--clearenv",
      "--setenv",
      "PATH",
      this.#executablePath,
      "--setenv",
      "LANG",
      "C.UTF-8",
      "--setenv",
      "LC_ALL",
      "C.UTF-8",
      "--setenv",
      "HOME",
      "/home/agent",
      "--setenv",
      "PYTHONDONTWRITEBYTECODE",
      "1",
      "--tmpfs",
      "/",
      "--dir",
      "/workspace",
      "--dir",
      "/home",
      "--dir",
      "/home/agent",
      "--dir",
      "/tmp",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
    ];
    for (const runtimePath of ["/usr", "/bin", "/lib", "/lib64"]) {
      try {
        await access(runtimePath);
        args.push("--ro-bind", runtimePath, runtimePath);
      } catch {
        // 该可选运行时目录在当前发行版不存在。
      }
    }

    const parentRoot = `/proc/self/fd/${String(rootCapability.fd)}`;
    const childRoot = "/proc/self/fd/3";
    // 使用 bwrap 的 fd 专用参数，使受信根在挂载后、exec 前关闭；若把
    // /proc/self/fd/3 当普通路径 bind，命令可能通过继承 fd 绕过受保护覆盖。
    args.push("--bind-fd", "3", "/workspace");
    for (const relative of this.#readOnlyPaths) {
      const metadata = await lstat(`${parentRoot}/${relative}`);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ProcessSandboxError("launch_failed", "Runtime directory must be a real directory");
      args.push("--ro-bind", `${childRoot}/${relative}`, `/workspace/${relative}`);
    }
    for (const relative of this.#protectedPaths) {
      const parentSource = `${parentRoot}/${relative}`;
      const childSource = `${childRoot}/${relative}`;
      const destination = `/workspace/${relative}`;
      try {
        const metadata = await lstat(parentSource);
        if (metadata.isSymbolicLink()) {
          throw new ProcessSandboxError("launch_failed", `受保护路径 ${relative} 不能是 symlink`);
        }
        if (relative === ".git" && metadata.isDirectory()) {
          args.push("--ro-bind", childSource, destination);
        } else if (metadata.isDirectory()) {
          // 隐藏目录以空的临时文件系统覆盖，宿主内容不会进入 sandbox。
          args.push("--tmpfs", destination);
        } else if (metadata.isFile()) {
          // 隐藏文件以只读空设备覆盖，既不泄露内容也不允许修改宿主文件。
          args.push("--ro-bind", "/dev/null", destination);
        } else {
          throw new ProcessSandboxError("launch_failed", `受保护路径 ${relative} 类型不安全`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }

    args.push(
      "--chdir",
      cwd === "." ? "/workspace" : `/workspace/${cwd}`,
      "--",
      "/bin/bash",
      "--noprofile",
      "--norc",
      "-lc",
      command,
    );
    return args;
  }

  #notStartedResult(cancelled: boolean, timedOut: boolean, limit: number): ProcessExecutionResult {
    return {
      exitCode: null,
      signal: null,
      timedOut,
      cancelled,
      stdout: captured([], 0, limit),
      stderr: captured([], 0, limit),
      effects: { sideEffect: "none", changedPaths: [], workspaceRevision: null, artifactRefs: [] },
      sandboxProfileVersion: this.profile.version,
      timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
    };
  }
}
