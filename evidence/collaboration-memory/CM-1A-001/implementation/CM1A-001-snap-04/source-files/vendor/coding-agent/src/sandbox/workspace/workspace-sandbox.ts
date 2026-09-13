/**
 * 模块职责：提供受 workspace 根目录约束的读、写、创建、删除和补丁文件操作。
 *
 * 设计边界：禁止目录逃逸、符号链接穿透和非预期覆盖；不负责用户审批。
 * 关键流程：解析并验证相对路径，执行带并发保护的原子操作，再更新 workspace revision。
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { link, lstat, open, readdir, realpath, rename, stat, unlink } from "node:fs/promises";

import type { ToolEffects } from "../../core/ports/tool_executor/tool-executor-port.js";
import { normalizeWorkspacePath } from "../../policy/permissions/permission-policy.js";

export type WorkspaceErrorCode =
  | "invalid_path"
  | "permission_denied"
  | "not_found"
  | "not_file"
  | "binary_file"
  | "invalid_encoding"
  | "too_large"
  | "file_changed"
  | "already_exists"
  | "parent_missing"
  | "no_match"
  | "ambiguous_match"
  | "io_error";

export class WorkspaceSandboxError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
    readonly effects: ToolEffects = {
      sideEffect: "none",
      changedPaths: [],
      workspaceRevision: null,
      artifactRefs: [],
    },
  ) {
    super(message);
    this.name = "WorkspaceSandboxError";
  }
}

export interface WorkspaceFile {
  readonly path: string;
  readonly content: string;
  readonly byteLength: number;
  readonly revision: string;
  readonly mode: number;
  readonly identity: string;
}

export interface WorkspaceWriteResult {
  readonly path: string;
  readonly oldRevision: string | null;
  readonly newRevision: string;
  readonly changedBytes: number;
  readonly effects: ToolEffects;
}

export interface WorkspaceSnapshot {
  readonly revision: string;
  readonly rootRevision: string;
  readonly files: ReadonlyMap<string, string>;
  readonly strategy: "git_status_v1" | "sparse_metadata_v1";
}

export type WorkspaceConsistencyMode = "session" | "workspace" | "strict";

export interface WorkspaceConsistencyReport {
  readonly mode: WorkspaceConsistencyMode;
  readonly scope: "session" | "workspace";
  readonly status: "clean" | "drift_detected";
  readonly checkedPaths: number;
  readonly changedPaths: readonly string[];
  readonly revision: string;
  readonly revisionStrategy: WorkspaceSnapshot["strategy"] | "session_overlay_v1";
}

export interface WorkspaceSandboxOptions {
  readonly deniedPrefixes?: readonly string[];
  /** 不参与恢复 revision 的可再生/体积型目录。 */
  readonly snapshotIgnoredPrefixes?: readonly string[];
  readonly consistencyMode?: WorkspaceConsistencyMode;
  readonly maxFileBytes?: number;
}

export const DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PREFIXES = [
  ".git",
  ".tooling",
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  ".cache",
] as const;

function hash(buffer: Uint8Array | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function workspaceSnapshot(
  strategy: WorkspaceSnapshot["strategy"],
  rootRevision: string,
  filesInput: ReadonlyMap<string, string>,
): WorkspaceSnapshot {
  const files = new Map(filesInput);
  const canonical = [
    `${strategy}\0${rootRevision}\n`,
    ...[...files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, revision]) => `${name}\0${revision}\n`),
  ].join("");
  return { files, rootRevision, revision: hash(canonical), strategy };
}

function isWithin(candidate: string, prefix: string): boolean {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function identity(value: { dev: number | bigint; ino: number | bigint }): string {
  return `${String(value.dev)}:${String(value.ino)}`;
}

function decodeUtf8(buffer: Buffer, relativePath: string): string {
  if (buffer.subarray(0, 8_192).includes(0)) {
    throw new WorkspaceSandboxError("binary_file", `${relativePath} 不是文本文件`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new WorkspaceSandboxError("invalid_encoding", `${relativePath} 不是有效 UTF-8`);
  }
}

function mapIoError(error: unknown, relativePath: string): WorkspaceSandboxError {
  if (error instanceof WorkspaceSandboxError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return new WorkspaceSandboxError("not_found", `${relativePath} 不存在`);
  if (code === "EEXIST") {
    return new WorkspaceSandboxError("already_exists", `${relativePath} 已存在`);
  }
  if (code === "ELOOP" || code === "EACCES" || code === "EPERM") {
    return new WorkspaceSandboxError("permission_denied", "路径不允许访问");
  }
  if (code === "ENOTDIR") {
    // O_NOFOLLOW 打开中间 symlink 在部分 Linux 文件系统返回 ENOTDIR；统一按越界拒绝处理。
    return new WorkspaceSandboxError("permission_denied", "路径不允许访问");
  }
  return new WorkspaceSandboxError("io_error", `${relativePath} 文件操作失败`);
}

/**
 * Linux /proc/self/fd 路径始终锚定到已经打开的目录句柄。
 * 即使原目录名随后被替换，也不会重新从可变的 workspace 字符串路径解析。
 */
function handlePath(handle: FileHandle, child?: string): string {
  const base = `/proc/self/fd/${String(handle.fd)}`;
  return child === undefined ? base : `${base}/${child}`;
}

/**
 * 基于受信目录句柄的 workspace 文件能力。所有路径逐段 O_NOFOLLOW 打开，
 * 避免“先检查路径、后使用路径”的 symlink 竞态逃逸。
 */
export class WorkspaceSandbox {
  readonly #root: string;
  readonly #rootIdentity: string;
  readonly #deniedPrefixes: readonly string[];
  readonly #snapshotIgnoredPrefixes: readonly string[];
  readonly #consistencyMode: WorkspaceConsistencyMode;
  readonly #maxFileBytes: number;
  readonly #sessionExpected = new Map<
    string,
    { readonly kind: "content" | "metadata"; readonly revision: string }
  >();
  #acceptedWorkspaceSnapshot: WorkspaceSnapshot | null = null;
  #gitStatusAvailable: boolean | null = null;

  private constructor(
    root: string,
    rootIdentity: string,
    deniedPrefixes: readonly string[],
    snapshotIgnoredPrefixes: readonly string[],
    consistencyMode: WorkspaceConsistencyMode,
    maxFileBytes: number,
  ) {
    this.#root = root;
    this.#rootIdentity = rootIdentity;
    this.#deniedPrefixes = deniedPrefixes;
    this.#snapshotIgnoredPrefixes = snapshotIgnoredPrefixes;
    this.#consistencyMode = consistencyMode;
    this.#maxFileBytes = maxFileBytes;
  }

  static async create(
    root: string,
    options: WorkspaceSandboxOptions = {},
  ): Promise<WorkspaceSandbox> {
    const resolved = await realpath(root);
    const rootStat = await stat(resolved);
    if (!rootStat.isDirectory()) throw new Error("workspace root 必须是目录");
    const maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
      throw new RangeError("maxFileBytes 必须是正整数");
    }
    const denied = (options.deniedPrefixes ?? [".evaluator", ".oracle", "hidden-tests"])
      .map((value) => normalizeWorkspacePath(value))
      .sort();
    const snapshotIgnored = (
      options.snapshotIgnoredPrefixes ?? DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PREFIXES
    )
      .map((value) => normalizeWorkspacePath(value))
      .sort();
    const sandbox = new WorkspaceSandbox(
      resolved,
      identity(rootStat),
      denied,
      snapshotIgnored,
      options.consistencyMode ?? "session",
      maxFileBytes,
    );
    // 创建时立即验证目录句柄与 /proc/self/fd 原语可用；失败时不授予 capability。
    const rootHandle = await sandbox.#openRoot();
    await rootHandle.close();
    return sandbox;
  }

  get identity(): string {
    return this.#rootIdentity;
  }

  get deniedPrefixes(): readonly string[] {
    return [...this.#deniedPrefixes];
  }

  get snapshotIgnoredPrefixes(): readonly string[] {
    return [...this.#snapshotIgnoredPrefixes];
  }

  get consistencyMode(): WorkspaceConsistencyMode {
    return this.#consistencyMode;
  }

  /**
   * 仅供 ProcessSandbox 继承到 bwrap 的受信根目录句柄；调用方负责 close。
   * 公开值中不包含宿主路径，具体 ToolHandler 也拿不到该 capability。
   */
  async acquireRootHandleForProcess(): Promise<FileHandle> {
    return this.#openRoot();
  }

  async revision(): Promise<string> {
    return (await this.snapshot()).revision;
  }

  async captureBaseline(): Promise<WorkspaceSnapshot> {
    const snapshot = await this.snapshot();
    this.#acceptedWorkspaceSnapshot = snapshot;
    return snapshot;
  }

  async acceptAgentChanges(
    snapshot: WorkspaceSnapshot,
    changedPaths: readonly string[],
  ): Promise<WorkspaceSnapshot> {
    const accepted = this.#acceptWorkspaceChanges(snapshot, changedPaths);
    for (const relative of changedPaths) {
      if (relative === ".") continue;
      this.#sessionExpected.set(relative, {
        kind: "metadata",
        revision: await this.#pathMetadataRevision(relative),
      });
    }
    return accepted;
  }

  async checkConsistency(
    requestedScope?: "session" | "workspace",
  ): Promise<WorkspaceConsistencyReport> {
    const scope = requestedScope ?? (this.#consistencyMode === "session" ? "session" : "workspace");
    if (scope === "workspace") {
      const current = await this.snapshot();
      const before = this.#acceptedWorkspaceSnapshot;
      const changedPaths = before ? this.diff(before, current) : [];
      this.#acceptedWorkspaceSnapshot = current;
      for (const relative of changedPaths) {
        if (relative === ".") continue;
        this.#sessionExpected.set(relative, {
          kind: "metadata",
          revision: await this.#pathMetadataRevision(relative),
        });
      }
      return {
        mode: this.#consistencyMode,
        scope,
        status: changedPaths.length > 0 ? "drift_detected" : "clean",
        checkedPaths: new Set([...(before?.files.keys() ?? []), ...current.files.keys()]).size,
        changedPaths,
        revision: current.revision,
        revisionStrategy: current.strategy,
      };
    }

    const changedPaths: string[] = [];
    for (const [relative, expected] of this.#sessionExpected) {
      const current =
        expected.kind === "content"
          ? await this.#pathContentRevision(relative)
          : await this.#pathMetadataRevision(relative);
      if (current !== expected.revision) changedPaths.push(relative);
      this.#sessionExpected.set(relative, { ...expected, revision: current });
    }
    const canonical = [...this.#sessionExpected.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relative, expected]) => `${relative}\0${expected.kind}\0${expected.revision}\n`)
      .join("");
    return {
      mode: this.#consistencyMode,
      scope,
      status: changedPaths.length > 0 ? "drift_detected" : "clean",
      checkedPaths: this.#sessionExpected.size,
      changedPaths: changedPaths.sort(),
      revision: hash(`session-overlay-v1\n${canonical}`),
      revisionStrategy: "session_overlay_v1",
    };
  }

  async read(relativePath: string, maxBytes = this.#maxFileBytes): Promise<WorkspaceFile> {
    const normalized = this.#normalize(relativePath);
    const limit = Math.min(maxBytes, this.#maxFileBytes);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new WorkspaceSandboxError("too_large", "读取上限非法");
    }
    const capability = await this.#openParent(normalized);
    try {
      const file = await this.#readAt(capability.parent, capability.name, normalized, limit);
      this.#sessionExpected.set(normalized, { kind: "content", revision: file.revision });
      return file;
    } finally {
      await capability.parent.close();
    }
  }

  async replace(
    relativePath: string,
    oldText: string,
    newText: string,
    expectedRevision: string,
  ): Promise<WorkspaceWriteResult> {
    const normalized = this.#normalize(relativePath);
    const capability = await this.#openParent(normalized);
    try {
      const current = await this.#readAt(
        capability.parent,
        capability.name,
        normalized,
        this.#maxFileBytes,
      );
      if (current.revision !== expectedRevision) {
        throw new WorkspaceSandboxError("file_changed", `${normalized} 已被其他操作修改`);
      }
      const first = current.content.indexOf(oldText);
      if (first < 0) {
        throw new WorkspaceSandboxError("no_match", `${normalized} 中未找到待替换文本`);
      }
      if (current.content.indexOf(oldText, first + oldText.length) >= 0) {
        throw new WorkspaceSandboxError("ambiguous_match", `${normalized} 中待替换文本不唯一`);
      }
      const nextContent =
        current.content.slice(0, first) + newText + current.content.slice(first + oldText.length);
      return await this.#atomicReplace(
        capability.parent,
        capability.name,
        normalized,
        current,
        nextContent,
      );
    } finally {
      await capability.parent.close();
    }
  }

  async createFile(relativePath: string, content: string): Promise<WorkspaceWriteResult> {
    const normalized = this.#normalize(relativePath);
    const capability = await this.#openParent(normalized);
    const temporaryName = `.codex-edit-${randomUUID()}.tmp`;
    const temporary = handlePath(capability.parent, temporaryName);
    const target = handlePath(capability.parent, capability.name);
    let published = false;
    try {
      const bytes = Buffer.from(content, "utf8");
      if (bytes.byteLength > this.#maxFileBytes) {
        throw new WorkspaceSandboxError("too_large", "新文件超过上限");
      }
      const handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o644,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // hard-link 发布是排他的：目标已存在或是 symlink 时都不会被覆盖。
      await link(temporary, target);
      published = true;
      await unlink(temporary);
      const fileRevision = hash(bytes);
      this.#sessionExpected.set(normalized, { kind: "content", revision: fileRevision });
      const snapshot = await this.snapshot();
      const workspaceRevision = this.#acceptWorkspaceChanges(snapshot, [normalized]).revision;
      return {
        path: normalized,
        oldRevision: null,
        newRevision: fileRevision,
        changedBytes: bytes.byteLength,
        effects: this.#confirmed(normalized, workspaceRevision),
      };
    } catch (error) {
      if (published) {
        const workspaceRevision = await this.revision().catch(() => null);
        throw new WorkspaceSandboxError(
          "io_error",
          `${normalized} 已创建但后续确认失败`,
          this.#confirmed(normalized, workspaceRevision),
        );
      }
      throw mapIoError(error, normalized);
    } finally {
      await unlink(temporary).catch(() => undefined);
      await capability.parent.close();
    }
  }

  /** Bounded inventory for host analysis, independent of Git status/ignores. */
  async listFiles(maxEntries = 20_000, options: { prefix?: string; signal?: AbortSignal } = {}): Promise<{ paths: string[]; truncated: boolean }> {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 60_000) throw new WorkspaceSandboxError("too_large", "文件枚举上限非法");
    const prefix = options.prefix ? this.#normalize(options.prefix) : "";
    const root = await this.#openRoot(), paths: string[] = [];
    let scanned = 0, truncated = false, start = root;
    const cancelled = () => { if (options.signal?.aborted) throw new Error("文件枚举已取消"); };
    const visit = async (directory: FileHandle, relativeDirectory: string, depth: number): Promise<void> => {
      cancelled();
      if (depth > 64) { truncated = true; return; }
      for (const entry of (await readdir(handlePath(directory), { withFileTypes: true })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        cancelled();
        if (++scanned > maxEntries) { truncated = true; return; }
        const relative = relativeDirectory ? relativeDirectory + "/" + entry.name : entry.name;
        if (this.#deniedPrefixes.some(p => isWithin(relative, p))) continue;
        let child: FileHandle | undefined;
        try {
          const metadata = await lstat(handlePath(directory, entry.name));
          if (metadata.isSymbolicLink()) continue;
          if (metadata.isDirectory()) {
            child = await open(handlePath(directory, entry.name), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            await visit(child, relative, depth + 1);
          } else if (metadata.isFile()) paths.push(relative);
        } catch { cancelled(); truncated = true; }
        finally { await child?.close(); }
        if (scanned > maxEntries) return;
      }
    };
    try {
      for (const part of prefix ? prefix.split("/") : []) {
        cancelled();
        const next = await open(handlePath(start, part), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        if (start !== root) await start.close();
        start = next;
      }
      await visit(start, prefix, 0);
      return { paths: paths.sort(), truncated };
    } finally { if (start !== root) await start.close(); await root.close(); }
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const gitSnapshot = await this.#gitSnapshot();
    if (gitSnapshot) return gitSnapshot;
    const root = await this.#openRoot();
    try {
      const files = new Map<string, string>();
      await this.#walk(root, ".", files);
      return workspaceSnapshot(
        "sparse_metadata_v1",
        hash(`sparse-metadata-v1\0${this.#rootIdentity}`),
        files,
      );
    } finally {
      await root.close();
    }
  }

  async #gitSnapshot(): Promise<WorkspaceSnapshot | null> {
    if (this.#gitStatusAvailable === false) return null;
    const status = await this.#gitStatus().catch(() => null);
    if (!status) {
      this.#gitStatusAvailable = false;
      return null;
    }
    this.#gitStatusAvailable = true;
    const tokens = status.toString("utf8").split("\0");
    const headers: string[] = [];
    const candidates = new Map<string, string>();
    for (let index = 0; index < tokens.length; index += 1) {
      const record = tokens[index]!;
      if (!record) continue;
      if (record.startsWith("# ")) {
        headers.push(record);
        continue;
      }
      const kind = record[0];
      const fieldCount = kind === "1" ? 8 : kind === "2" ? 9 : kind === "u" ? 10 : 1;
      const relative = this.#gitRecordPath(record, fieldCount);
      if (!relative) return null;
      const original = kind === "2" ? tokens[(index += 1)] : undefined;
      let normalized: string;
      try {
        normalized = normalizeWorkspacePath(relative);
      } catch {
        return null;
      }
      const ignored = [...this.#deniedPrefixes, ...this.#snapshotIgnoredPrefixes].some((prefix) =>
        isWithin(normalized, prefix),
      );
      if (ignored) continue;
      const recordRevision = hash(original ? `${record}\0${original}` : record);
      candidates.set(normalized, recordRevision);
      if (original) {
        try {
          const normalizedOriginal = normalizeWorkspacePath(original);
          if (
            ![...this.#deniedPrefixes, ...this.#snapshotIgnoredPrefixes].some((prefix) =>
              isWithin(normalizedOriginal, prefix),
            )
          ) {
            candidates.set(normalizedOriginal, recordRevision);
          }
        } catch {
          return null;
        }
      }
    }
    const files = new Map<string, string>();
    for (const [relative, recordRevision] of [...candidates].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      files.set(relative, hash(`${recordRevision}\0${await this.#pathMetadataRevision(relative)}`));
    }
    return workspaceSnapshot("git_status_v1", hash(headers.join("\0")), files);
  }

  #gitRecordPath(record: string, fieldCount: number): string | null {
    let cursor = 0;
    for (let field = 0; field < fieldCount; field += 1) {
      cursor = record.indexOf(" ", cursor);
      if (cursor < 0) return null;
      cursor += 1;
    }
    return record.slice(cursor);
  }

  async #gitStatus(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/git",
        [
          "--no-optional-locks",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "status.relativePaths=true",
          "-C",
          this.#root,
          "status",
          "--porcelain=v2",
          "--branch",
          "-z",
          "--untracked-files=all",
          "--ignored=no",
          "--",
          ".",
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: "/usr/bin:/bin",
            HOME: "/nonexistent",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_OPTIONAL_LOCKS: "0",
          },
        },
      );
      const chunks: Buffer[] = [];
      let bytes = 0;
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      timeout.unref?.();
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes <= 16 * 1024 * 1024) chunks.push(chunk);
        else child.kill("SIGKILL");
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code === 0 && bytes <= 16 * 1024 * 1024) resolve(Buffer.concat(chunks));
        else reject(new Error("git status unavailable"));
      });
    });
  }

  async #pathMetadataRevision(relative: string): Promise<string> {
    const capability = await this.#openParent(relative).catch(() => null);
    if (!capability) return hash("missing");
    try {
      const metadata = await lstat(handlePath(capability.parent, capability.name), {
        bigint: true,
      });
      if (metadata.isSymbolicLink()) return hash("symlink");
      return hash(
        [
          identity(metadata),
          String(metadata.mode),
          String(metadata.size),
          String(metadata.mtimeNs),
          String(metadata.ctimeNs),
        ].join(":"),
      );
    } catch {
      return hash("missing");
    } finally {
      await capability.parent.close();
    }
  }

  async #pathContentRevision(relative: string): Promise<string> {
    const capability = await this.#openParent(relative).catch(() => null);
    if (!capability) return hash("missing");
    try {
      const file = await this.#readAt(
        capability.parent,
        capability.name,
        relative,
        this.#maxFileBytes,
      );
      return file.revision;
    } catch {
      return this.#pathMetadataRevision(relative);
    } finally {
      await capability.parent.close();
    }
  }

  diff(before: WorkspaceSnapshot, after: WorkspaceSnapshot): readonly string[] {
    const changedPaths = [...new Set([...before.files.keys(), ...after.files.keys()])]
      .filter((name) => before.files.get(name) !== after.files.get(name))
      .sort();
    return before.rootRevision !== after.rootRevision ? [".", ...changedPaths] : changedPaths;
  }

  #acceptWorkspaceChanges(
    observed: WorkspaceSnapshot,
    changedPaths: readonly string[],
  ): WorkspaceSnapshot {
    const baseline = this.#acceptedWorkspaceSnapshot;
    if (!baseline || baseline.strategy !== observed.strategy) {
      this.#acceptedWorkspaceSnapshot = observed;
      return observed;
    }
    const files = new Map(baseline.files);
    for (const relative of changedPaths) {
      if (relative === ".") continue;
      const revision = observed.files.get(relative);
      if (revision === undefined) files.delete(relative);
      else files.set(relative, revision);
    }
    const accepted = workspaceSnapshot(
      observed.strategy,
      changedPaths.includes(".") ? observed.rootRevision : baseline.rootRevision,
      files,
    );
    this.#acceptedWorkspaceSnapshot = accepted;
    return accepted;
  }

  async #atomicReplace(
    parent: FileHandle,
    name: string,
    normalized: string,
    current: WorkspaceFile,
    nextContent: string,
  ): Promise<WorkspaceWriteResult> {
    const temporaryName = `.codex-edit-${randomUUID()}.tmp`;
    const temporary = handlePath(parent, temporaryName);
    const target = handlePath(parent, name);
    let renamed = false;
    try {
      const bytes = Buffer.from(nextContent, "utf8");
      if (bytes.byteLength > this.#maxFileBytes) {
        throw new WorkspaceSandboxError("too_large", "修改后文件超过上限");
      }
      const handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        current.mode,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.chmod(current.mode);
      } finally {
        await handle.close();
      }
      const latest = await this.#readAt(parent, name, normalized, this.#maxFileBytes);
      if (latest.identity !== current.identity || latest.revision !== current.revision) {
        throw new WorkspaceSandboxError("file_changed", `${normalized} 已被其他操作修改`);
      }
      await rename(temporary, target);
      renamed = true;
      const next = await this.#readAt(parent, name, normalized, this.#maxFileBytes);
      const expected = hash(bytes);
      if (next.revision !== expected) {
        throw new WorkspaceSandboxError("file_changed", `${normalized} 写入后校验失败`, {
          sideEffect: "possible",
          changedPaths: [normalized],
          workspaceRevision: null,
          artifactRefs: [],
        });
      }
      this.#sessionExpected.set(normalized, { kind: "content", revision: next.revision });
      const snapshot = await this.snapshot();
      const workspaceRevision = this.#acceptWorkspaceChanges(snapshot, [normalized]).revision;
      return {
        path: normalized,
        oldRevision: current.revision,
        newRevision: next.revision,
        changedBytes: Math.abs(bytes.byteLength - current.byteLength),
        effects: this.#confirmed(normalized, workspaceRevision),
      };
    } catch (error) {
      if (
        renamed &&
        !(error instanceof WorkspaceSandboxError && error.effects.sideEffect !== "none")
      ) {
        throw new WorkspaceSandboxError("io_error", `${normalized} 写入结果无法确认`, {
          sideEffect: "possible",
          changedPaths: [normalized],
          workspaceRevision: null,
          artifactRefs: [],
        });
      }
      throw mapIoError(error, normalized);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  #normalize(value: string): string {
    let normalized: string;
    try {
      normalized = normalizeWorkspacePath(value);
    } catch {
      throw new WorkspaceSandboxError("invalid_path", "路径不在允许的 workspace 范围内");
    }
    if (this.#deniedPrefixes.some((prefix) => isWithin(normalized, prefix))) {
      throw new WorkspaceSandboxError("permission_denied", "路径不允许访问");
    }
    return normalized;
  }

  async #openRoot(): Promise<FileHandle> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(
        this.#root,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const opened = await handle.stat();
      if (!opened.isDirectory() || identity(opened) !== this.#rootIdentity) {
        throw new WorkspaceSandboxError("permission_denied", "workspace capability 已失效");
      }
      return handle;
    } catch (error) {
      await handle?.close();
      throw mapIoError(error, ".");
    }
  }

  async #openParent(
    normalized: string,
  ): Promise<{ readonly parent: FileHandle; readonly name: string }> {
    const segments = normalized.split("/");
    const name = segments.pop()!;
    let current = await this.#openRoot();
    try {
      for (const segment of segments) {
        const next = await open(
          handlePath(current, segment),
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        const opened = await next.stat();
        if (!opened.isDirectory()) {
          await next.close();
          throw new WorkspaceSandboxError("parent_missing", "父目录不存在");
        }
        await current.close();
        current = next;
      }
      return { parent: current, name };
    } catch (error) {
      await current.close();
      throw mapIoError(error, normalized);
    }
  }

  async #readAt(
    parent: FileHandle,
    name: string,
    normalized: string,
    limit: number,
  ): Promise<WorkspaceFile> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(
        handlePath(parent, name),
        constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
      );
      const before = await handle.stat();
      if (!before.isFile()) {
        throw new WorkspaceSandboxError("not_file", `${normalized} 不是普通文件`);
      }
      if (before.size > limit) {
        throw new WorkspaceSandboxError("too_large", `${normalized} 超过读取上限`);
      }
      const allocated = Buffer.alloc(Math.min(limit + 1, before.size + 1));
      const { bytesRead } = await handle.read(allocated, 0, allocated.byteLength, 0);
      if (bytesRead > limit) {
        throw new WorkspaceSandboxError("too_large", `${normalized} 超过读取上限`);
      }
      const buffer = allocated.subarray(0, bytesRead);
      const after = await handle.stat();
      if (
        identity(before) !== identity(after) ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        throw new WorkspaceSandboxError("file_changed", `${normalized} 在读取期间发生变化`);
      }
      return {
        path: normalized,
        content: decodeUtf8(buffer, normalized),
        byteLength: buffer.byteLength,
        revision: hash(buffer),
        mode: before.mode & 0o777,
        identity: identity(before),
      };
    } catch (error) {
      throw mapIoError(error, normalized);
    } finally {
      await handle?.close();
    }
  }

  async #walk(
    directory: FileHandle,
    relativeDirectory: string,
    output: Map<string, string>,
  ): Promise<void> {
    const entries = await readdir(handlePath(directory), { withFileTypes: true });
    for (const entry of entries) {
      const relative =
        relativeDirectory === "." ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (this.#deniedPrefixes.some((prefix) => isWithin(relative, prefix))) continue;
      if (this.#snapshotIgnoredPrefixes.some((prefix) => isWithin(relative, prefix))) continue;
      let child: FileHandle | undefined;
      try {
        // revision 只记录不可伪造的 inode/ctime/mtime/size 元数据；单文件 read/edit
        // 仍使用内容 SHA-256。这样恢复快照不再为每次工具调用读取全部文件内容。
        const metadata = await lstat(handlePath(directory, entry.name), { bigint: true });
        if (metadata.isSymbolicLink()) continue;
        if (metadata.isDirectory()) {
          child = await open(
            handlePath(directory, entry.name),
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
          );
          await this.#walk(child, relative, output);
        } else if (metadata.isFile()) {
          output.set(
            relative,
            hash(
              [
                identity(metadata),
                String(metadata.mode),
                String(metadata.size),
                String(metadata.mtimeNs),
                String(metadata.ctimeNs),
              ].join(":"),
            ),
          );
        }
      } catch (error) {
        throw mapIoError(error, relative);
      } finally {
        await child?.close();
      }
    }
  }

  #confirmed(normalized: string, workspaceRevision: string | null): ToolEffects {
    return {
      sideEffect: "confirmed",
      changedPaths: [normalized],
      workspaceRevision,
      artifactRefs: [],
    };
  }
}
