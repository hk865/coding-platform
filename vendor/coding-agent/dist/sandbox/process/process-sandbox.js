var _a;
/**
 * 模块职责：在受控工作目录和环境中启动子进程，并限制时间、输出和取消行为。
 *
 * 设计边界：审批由上层完成；本模块只执行已获准请求并返回结构化结果与副作用摘要。
 * 关键流程：校验 profile 与路径，构造最小环境，启动进程，捕获输出，超时或取消时清理进程树。
 * 只读模式（`workspaceMode: 'read_only'`）：工作区根以只读方式挂载，受保护目录空挂载后再
 * 只读重挂；执行后仍比较快照，但只把变化记为外部写者的 `externalChangedPaths`，绝不推进
 * Kernel 认可的基线（L13、L15）。能力探测失败时绝不退回读写挂载或主机命令行。
 */
import { spawn } from "node:child_process";
import { access, lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeWorkspacePath } from "../../policy/permissions/permission-policy.js";
export class ProcessSandboxError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ProcessSandboxError";
    }
}
const DEFAULT_PROTECTED_PATHS = [
    ".git",
    ".env",
    ".env.local",
    "credentials",
    "credentials.json",
];
/** L15：外部变化路径最多报前 100 条。 */
const EXTERNAL_CHANGED_PATHS_LIMIT = 100;
/** D-IPC：工作区里既有的 Unix socket / FIFO 也要遮蔽；遍历有界。 */
const IPC_WALK_MAX_DEPTH = 64;
const IPC_WALK_MAX_ENTRIES = 20_000;
/**
 * D-PROBE：只读金丝雀必须真正执行一次 `--remount-ro`。没有受保护目录可重挂时，
 * 在一个私有 scratch tmpfs 上重挂，使探测仍能证明该选项可用。
 */
const READONLY_REMOUNT_SCRATCH = "/codex-readonly-canary";
/** D-CWD：沙箱内的 cwd 包含性守卫失败时写出的标记，父进程据此判 invalid_arguments。 */
const READONLY_CWD_GUARD_MARKER = "__codex_readonly_cwd_guard__";
const READONLY_CWD_GUARD = `case "$(pwd -P)" in /workspace|/workspace/*) ;; *) `
    + `printf '%s' '${READONLY_CWD_GUARD_MARKER}' >&2; exit 126 ;; esac`;
async function commandOutput(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        const output = [];
        child.stdout.on("data", (chunk) => output.push(chunk));
        child.once("error", reject);
        child.once("close", (code) => {
            if (code === 0)
                resolve(Buffer.concat(output).toString("utf8").trim());
            else
                reject(new Error(`process exited ${String(code)}`));
        });
    });
}
function appendBounded(chunks, chunk, retained, limit) {
    const remaining = Math.max(0, limit - retained.bytes);
    if (remaining > 0) {
        const selected = chunk.subarray(0, remaining);
        chunks.push(selected);
        retained.bytes += selected.byteLength;
    }
}
function captured(chunks, totalBytes, limit) {
    return {
        text: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)),
        totalBytes,
        truncated: totalBytes > limit,
    };
}
function shellSingleQuote(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
/**
 * D-ONECHECK/D-GIT/D-GITFILE：纯函数，从一次 `lstat` 快照推导只读挂载计划。
 *
 * - 目录形态的 `.git` 是唯一的“只读但可读”绑定，其下显式否认路径各自保留挂载；
 * - 普通目录用空 tmpfs 遮蔽，普通文件用 `/dev/null` 遮蔽，两者都让整棵子树不可见；
 * - 只有当最近的上层**已选遮蔽挂载**存在时才丢弃后代（“never expose a directory
 *   after discarding its denials”）；读取型祖先不遮蔽；
 * - 不存在的路径（ENOENT/ENOTDIR）没有挂载，也不构成遮蔽祖先；
 * - symlink 或特殊类型不安全，fail closed。
 */
export function planReadonlyMounts(snapshot) {
    const ordered = [...snapshot.paths].sort((left, right) => {
        const depth = left.path.split("/").length - right.path.split("/").length;
        if (depth !== 0)
            return depth;
        return byteOrder(left.path, right.path);
    });
    const mounts = [];
    const maskedSubtrees = [];
    const readableSubtrees = [];
    const dropped = [];
    for (const state of ordered) {
        const maskedByAncestor = mounts.some((mount) => mount.action !== "bind-readonly" &&
            (state.path === mount.path || state.path.startsWith(`${mount.path}/`)));
        if (maskedByAncestor) {
            dropped.push(state.path);
            continue;
        }
        if (state.kind === "absent")
            continue;
        if (state.kind === "symlink") {
            throw new ProcessSandboxError("launch_failed", `受保护路径 ${state.path} 不能是 symlink`);
        }
        if (state.kind === "directory") {
            if (state.path === ".git") {
                mounts.push({ path: state.path, action: "bind-readonly" });
                readableSubtrees.push(state.path);
            }
            else {
                mounts.push({ path: state.path, action: "mask-tmpfs" });
                maskedSubtrees.push(state.path);
            }
            continue;
        }
        if (state.kind === "file") {
            mounts.push({ path: state.path, action: "mask-devnull" });
            maskedSubtrees.push(state.path);
            continue;
        }
        throw new ProcessSandboxError("launch_failed", `受保护路径 ${state.path} 类型不安全`);
    }
    return {
        mounts,
        maskedSubtrees,
        readableSubtrees,
        dropped,
        remountScratch: !mounts.some((mount) => mount.action === "mask-tmpfs"),
    };
}
/** D-ONECHECK：IPC 遍历只跳过计划真正遮蔽的子树（起点本身或其后代）。 */
export function readonlyIpcSkips(plan, relative) {
    return plan.maskedSubtrees.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}
function byteOrder(left, right) {
    return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
/**
 * bubblewrap 进程隔离适配器。workspace 通过已打开的 fd 绑定，敏感路径
 * 再以只读或空挂载覆盖；能力探测失败时绝不退化成宿主 shell。
 */
export class ProcessSandbox {
    profile;
    workspaceRoot;
    workspace;
    static PROFILE_VERSION = "bwrap-m3-v4";
    /** L13：只读金丝雀结果按（沙箱配置、受保护路径集合）在 Host 进程里缓存。 */
    static #readOnlyCanaries = new Map();
    #protectedPaths;
    #readOnlyPaths;
    #executablePath;
    #workspaceMode;
    #ipcWalkMaxEntries;
    constructor(profile, workspaceRoot, workspace, options = {}) {
        this.profile = profile;
        this.workspaceRoot = workspaceRoot;
        this.workspace = workspace;
        if (!path.isAbsolute(this.workspaceRoot)) {
            throw new RangeError("ProcessSandbox workspace root 必须是绝对路径");
        }
        this.#workspaceMode = options.workspaceMode ?? "read_write";
        const ipcWalkMaxEntries = options.ipcWalkMaxEntries ?? IPC_WALK_MAX_ENTRIES;
        if (!Number.isSafeInteger(ipcWalkMaxEntries) || ipcWalkMaxEntries < 1) {
            throw new RangeError("ipcWalkMaxEntries 必须是正整数");
        }
        this.#ipcWalkMaxEntries = ipcWalkMaxEntries;
        this.#readOnlyPaths = options.readOnlyPaths ?? [];
        for (const relative of this.#readOnlyPaths) {
            if (!/^[A-Za-z0-9._-]+$/.test(relative) || !relative || relative.startsWith("/") || relative.split("/").some(p => p === ".." || p === "." || !p) || relative.includes("\\"))
                throw new Error("Invalid read-only runtime path");
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
            .filter(value => !this.#readOnlyPaths.includes(value) || DEFAULT_PROTECTED_PATHS.includes(value))
            .sort();
    }
    /** 恢复约束快照使用构造后已规范化、过滤的实际选项。模式按每次调用定，不进恢复约束（L14）。 */
    get effectiveOptions() {
        return {
            protectedPaths: [...this.#protectedPaths],
            readOnlyPaths: [...this.#readOnlyPaths],
            executablePath: this.#executablePath,
        };
    }
    static async probe(workspaceRoot, workspace, options = {}) {
        try {
            const bwrapPath = options.bwrapPath ?? process.env["CODING_AGENT_BWRAP_PATH"] ?? "/usr/bin/bwrap";
            if (!path.isAbsolute(bwrapPath)) {
                throw new Error("bubblewrap 路径必须是绝对路径");
            }
            await access(bwrapPath);
            const versionText = await commandOutput(bwrapPath, ["--version"]);
            const workspaceMode = options.workspaceMode ?? "read_write";
            const sandbox = new _a({
                available: true,
                version: `${_a.PROFILE_VERSION}:${versionText}`,
                bwrapPath,
                reason: null,
            }, workspaceRoot, workspace, {
                workspaceMode,
                ...(options.protectedPaths === undefined
                    ? {}
                    : { protectedPaths: options.protectedPaths }),
                ...(options.readOnlyPaths === undefined
                    ? {}
                    : { readOnlyPaths: options.readOnlyPaths }),
                ...(options.executablePath === undefined
                    ? {}
                    : { executablePath: options.executablePath }),
            });
            if (workspaceMode === "read_only") {
                // L13：只读金丝雀确认 --ro-bind-fd 与 --remount-ro 可用，且写工作区、
                // 写受保护目录都失败。结果经实例缓存，不每次调用都探测。
                await sandbox.#ensureReadOnlyReady();
                return sandbox.profile;
            }
            const canary = await sandbox.execute({
                command: 'test "$HOME" = /home/agent && ' +
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
                throw new Error(`sandbox canary failed (exit=${String(canary.exitCode)}, signal=${String(canary.signal)}, timedOut=${String(canary.timedOut)})${detail ? `: ${detail}` : ""}`);
            }
            return sandbox.profile;
        }
        catch (error) {
            return {
                available: false,
                version: _a.PROFILE_VERSION,
                bwrapPath: null,
                reason: error instanceof Error ? error.message : "bubblewrap probe failed",
            };
        }
    }
    async execute(request) {
        if (!this.profile.available || !this.profile.bwrapPath) {
            throw new ProcessSandboxError("sandbox_unavailable", "隔离进程能力不可用");
        }
        if (request.signal.aborted) {
            return this.#notStartedResult(true, false, request.outputLimitBytes);
        }
        let cwd;
        if (this.#workspaceMode === "read_only") {
            cwd = await this.#resolveReadOnlyCwd(request.cwd);
            await this.#ensureReadOnlyReady();
        }
        else {
            cwd = normalizeWorkspacePath(request.cwd, true);
        }
        return this.#run(request, cwd);
    }
    /**
     * L13/D-CWD：只读模式下 cwd 先做字面检查，再在主机侧解析真实路径。
     * 解析一次后要求它是目录，并把已验证的相对路径交给 bwrap；沙箱内再用
     * `pwd -P` 守卫确认进程确实落在 /workspace 下，避免 check/use 竞态。
     */
    async #resolveReadOnlyCwd(value) {
        let cwd;
        try {
            cwd = normalizeWorkspacePath(value, true);
        }
        catch {
            throw new ProcessSandboxError("invalid_arguments", "cwd 不是工作区内的相对目录");
        }
        let rootReal;
        try {
            rootReal = await realpath(this.workspaceRoot);
        }
        catch {
            throw new ProcessSandboxError("invalid_arguments", "工作区根无法解析");
        }
        const target = cwd === "." ? rootReal : path.resolve(rootReal, cwd);
        let resolved;
        try {
            resolved = await realpath(target);
        }
        catch {
            throw new ProcessSandboxError("invalid_arguments", `cwd 不存在: ${cwd}`);
        }
        if (resolved !== rootReal && !resolved.startsWith(`${rootReal}${path.sep}`)) {
            throw new ProcessSandboxError("invalid_arguments", `cwd 不在工作区内: ${cwd}`);
        }
        let metadata;
        try {
            metadata = await stat(resolved);
        }
        catch {
            throw new ProcessSandboxError("invalid_arguments", `cwd 不存在: ${cwd}`);
        }
        if (!metadata.isDirectory()) {
            throw new ProcessSandboxError("invalid_arguments", `cwd 不是目录: ${cwd}`);
        }
        const relative = resolved === rootReal ? "." : path.relative(rootReal, resolved);
        if (relative !== "." &&
            this.#protectedPaths.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))) {
            throw new ProcessSandboxError("invalid_arguments", `cwd 落在受保护路径内: ${cwd}`);
        }
        return relative;
    }
    #readOnlyCanaryKey() {
        return JSON.stringify([
            this.profile.bwrapPath,
            this.profile.version,
            this.#executablePath,
            this.#readOnlyPaths,
            this.#protectedPaths,
        ]);
    }
    #readOnlyCanaryCommand() {
        const checks = [
            "set -e",
            "test ! -e /proc/self/fd/3",
            "if touch /workspace/.codex-readonly-canary 2>/dev/null; then rm -f /workspace/.codex-readonly-canary 2>/dev/null; exit 1; fi",
            // D-PROBE：受保护目录为空时，`--remount-ro` 用私有 scratch 挂载来证明。
            `if touch ${READONLY_REMOUNT_SCRATCH}/.codex-readonly-canary 2>/dev/null; then rm -f ${READONLY_REMOUNT_SCRATCH}/.codex-readonly-canary 2>/dev/null; exit 1; fi`,
        ];
        for (const relative of this.#protectedPaths) {
            const path = shellSingleQuote(`/workspace/${relative}`);
            checks.push(`if [ -d ${path} ]; then if touch ${path}/.codex-readonly-canary 2>/dev/null; then rm -f ${path}/.codex-readonly-canary 2>/dev/null; exit 1; fi; fi`);
        }
        return checks.join("; ");
    }
    async #ensureReadOnlyReady() {
        const key = this.#readOnlyCanaryKey();
        const cached = _a.#readOnlyCanaries.get(key);
        if (cached !== undefined) {
            if (!cached.available) {
                throw new ProcessSandboxError("sandbox_unavailable", cached.reason ?? "只读沙箱不可用");
            }
            return;
        }
        let outcome;
        try {
            const canary = await this.#run({
                command: this.#readOnlyCanaryCommand(),
                cwd: ".",
                timeoutMs: 5_000,
                outputLimitBytes: 1_024,
                signal: new AbortController().signal,
                captureWorkspaceEffects: false,
            }, ".");
            if (canary.exitCode === 0 && !canary.timedOut && !canary.cancelled) {
                outcome = { available: true, reason: null };
            }
            else {
                const detail = canary.stderr.text.trim().slice(0, 256);
                outcome = {
                    available: false,
                    reason: `read-only canary failed (exit=${String(canary.exitCode)}, signal=${String(canary.signal)}, timedOut=${String(canary.timedOut)})${detail ? `: ${detail}` : ""}`,
                };
            }
        }
        catch (error) {
            outcome = {
                available: false,
                reason: error instanceof Error ? error.message : "read-only canary failed",
            };
        }
        _a.#readOnlyCanaries.set(key, outcome);
        if (!outcome.available) {
            throw new ProcessSandboxError("sandbox_unavailable", outcome.reason ?? "只读沙箱不可用");
        }
    }
    async #run(request, cwd) {
        const captureWorkspaceEffects = request.captureWorkspaceEffects ?? true;
        // D-ONECHECK：在任何其他工作区调用和参数构造之前，只做一次受保护路径分类；
        // 挂载计划与 IPC 跳过决定都只来自这份快照。
        const mountSnapshot = this.#workspaceMode === "read_only" ? await this.#classifyProtectedPaths() : null;
        const beforeStartedAt = performance.now();
        const before = captureWorkspaceEffects ? await this.workspace.snapshot() : null;
        const snapshotBeforeMs = Math.max(0, performance.now() - beforeStartedAt);
        const rootCapability = await this.workspace.acquireRootHandleForProcess();
        const stdoutChunks = [];
        const stderrChunks = [];
        const stdoutRetained = { bytes: 0 };
        const stderrRetained = { bytes: 0 };
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let timedOut = false;
        let cancelled = false;
        let result;
        const executionStartedAt = performance.now();
        try {
            const mountPlan = mountSnapshot === null ? null : planReadonlyMounts(mountSnapshot);
            const args = await this.#arguments(request.command, cwd, rootCapability, mountPlan);
            // Preparation awaits may outlive an accepted stop. No child exists yet.
            if (request.signal.aborted) {
                return this.#notStartedResult(true, false, request.outputLimitBytes);
            }
            result = await new Promise((resolve, reject) => {
                const child = spawn(this.profile.bwrapPath, args, {
                    detached: true,
                    // fd 3 是只读继承的 workspace 根句柄；bwrap 完成挂载后必须在 exec 前关闭它。
                    stdio: ["ignore", "pipe", "pipe", rootCapability.fd],
                    env: { PATH: "/usr/bin:/bin" },
                });
                const terminate = (reason) => {
                    if (reason === "timeout")
                        timedOut = true;
                    else
                        cancelled = true;
                    if (child.pid) {
                        try {
                            process.kill(-child.pid, "SIGTERM");
                        }
                        catch {
                            // 进程组可能已经退出。
                        }
                        const killTimer = setTimeout(() => {
                            try {
                                process.kill(-child.pid, "SIGKILL");
                            }
                            catch {
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
                // AbortSignal does not replay an abort that preceded registration.
                // Once spawned, termination still settles from the real child close.
                if (request.signal.aborted)
                    onAbort();
                child.stdout.on("data", (chunk) => {
                    stdoutBytes += chunk.byteLength;
                    appendBounded(stdoutChunks, chunk, stdoutRetained, request.outputLimitBytes);
                });
                child.stderr.on("data", (chunk) => {
                    stderrBytes += chunk.byteLength;
                    appendBounded(stderrChunks, chunk, stderrRetained, request.outputLimitBytes);
                });
                child.once("error", reject);
                child.once("close", (exitCode, signal) => {
                    clearTimeout(timeout);
                    request.signal.removeEventListener("abort", onAbort);
                    resolve({ exitCode, signal });
                });
            });
        }
        catch (error) {
            throw new ProcessSandboxError("launch_failed", error instanceof Error ? error.message : "隔离进程启动失败");
        }
        finally {
            await rootCapability.close();
        }
        if (this.#workspaceMode === "read_only" &&
            result.exitCode === 126 &&
            Buffer.concat(stderrChunks).toString("utf8").includes(READONLY_CWD_GUARD_MARKER)) {
            // D-CWD：沙箱内的 `pwd -P` 守卫发现进程不在 /workspace 下，命令本身没有运行。
            throw new ProcessSandboxError("invalid_arguments", "cwd 在沙箱内不在 /workspace 下");
        }
        const executionMs = Math.max(0, performance.now() - executionStartedAt);
        const afterStartedAt = performance.now();
        const after = captureWorkspaceEffects ? await this.workspace.snapshot() : null;
        const snapshotAfterMs = Math.max(0, performance.now() - afterStartedAt);
        const changedPaths = before && after ? this.workspace.diff(before, after) : [];
        let effects;
        if (this.#workspaceMode === "read_only") {
            // L15：只读执行从不 acceptAgentChanges，绝不推进 Kernel 认可的基线。
            const ordered = [...changedPaths].sort(byteOrder);
            const externalChangedPaths = ordered.slice(0, EXTERNAL_CHANGED_PATHS_LIMIT);
            effects = {
                sideEffect: "none",
                changedPaths: [],
                workspaceRevision: null,
                artifactRefs: [],
                externalChangedPaths,
                externalChangedPathsOmitted: Math.max(0, ordered.length - externalChangedPaths.length),
            };
        }
        else {
            const accepted = after ? await this.workspace.acceptAgentChanges(after, changedPaths) : null;
            effects =
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
        }
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
    /**
     * D-ONECHECK：对 `.git` 和每条受保护路径各做一次 `lstat`，形成唯一的分类快照。
     * 在 `#run` 顶部、任何工作区快照或根句柄获取之前调用；之后不再重新分类。
     */
    async #classifyProtectedPaths() {
        const paths = [...new Set([".git", ...this.#protectedPaths])].sort(byteOrder);
        const states = [];
        for (const relative of paths) {
            let kind;
            try {
                const metadata = await lstat(path.join(this.workspaceRoot, relative));
                if (metadata.isSymbolicLink())
                    kind = "symlink";
                else if (metadata.isDirectory())
                    kind = "directory";
                else if (metadata.isFile())
                    kind = "file";
                else
                    kind = "other";
            }
            catch (error) {
                const code = error.code;
                if (code === "ENOENT" || code === "ENOTDIR") {
                    kind = "absent";
                }
                else {
                    throw new ProcessSandboxError("launch_failed", error instanceof Error ? error.message : `受保护路径 ${relative} 无法分类`);
                }
            }
            states.push({ path: relative, kind });
        }
        return { paths: states };
    }
    /**
     * D-IPC：受保护挂载只挡住普通文件；工作区里既有的 Unix socket 和 FIFO 仍是可用的
     * 宿主 IPC 端点。启动前做一次有界的 **广度优先** lstat 遍历，把找到的 socket/FIFO
     * 用只读 `/dev/null` 盖住（和受保护文件同一种遮蔽）。广度优先保证浅层（尤其根目录）
     * 的端点一定先于巨大深层子树被看到，不会被遍历上限挤掉。
     *
     * D-ONECHECK：只跳过计划真正遮蔽的子树（`readonlyIpcSkips`，来自顶部那次快照）；
     * 读取型祖先（目录形态的 `.git`）仍然进入。遍历本身仍可 readdir/lstat 发现端点。
     * 命令运行期间新出现的端点不在本次覆盖内（与现有 `shell` 沙箱相同的残留）。
     */
    async #ipcPaths(plan) {
        const found = [];
        let scanned = 0;
        let level = [
            { directory: this.workspaceRoot, relative: "." },
        ];
        for (let depth = 0; level.length > 0 && depth <= IPC_WALK_MAX_DEPTH; depth += 1) {
            const nextLevel = [];
            for (const current of level) {
                if (scanned >= this.#ipcWalkMaxEntries)
                    break;
                const entries = await readdir(current.directory, { withFileTypes: true }).catch(() => null);
                if (entries === null)
                    continue;
                entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
                for (const entry of entries) {
                    if (scanned >= this.#ipcWalkMaxEntries)
                        break;
                    scanned += 1;
                    const relative = current.relative === "." ? entry.name : `${current.relative}/${entry.name}`;
                    if (readonlyIpcSkips(plan, relative))
                        continue;
                    const metadata = await lstat(path.join(current.directory, entry.name)).catch(() => null);
                    if (metadata === null || metadata.isSymbolicLink())
                        continue;
                    if (metadata.isDirectory()) {
                        nextLevel.push({ directory: path.join(current.directory, entry.name), relative });
                    }
                    else if (metadata.isSocket() || metadata.isFIFO()) {
                        found.push(relative);
                    }
                }
            }
            if (scanned >= this.#ipcWalkMaxEntries)
                break;
            level = nextLevel;
        }
        return found.sort(byteOrder);
    }
    async #arguments(command, cwd, rootCapability, mountPlan) {
        const readOnly = this.#workspaceMode === "read_only";
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
            }
            catch {
                // 该可选运行时目录在当前发行版不存在。
            }
        }
        const parentRoot = `/proc/self/fd/${String(rootCapability.fd)}`;
        const childRoot = "/proc/self/fd/3";
        // 使用 bwrap 的 fd 专用参数，使受信根在挂载后、exec 前关闭；若把
        // /proc/self/fd/3 当普通路径 bind，命令可能通过继承 fd 绕过受保护覆盖。
        // L13：只读模式改用 --ro-bind-fd，工作区根从挂载起就是只读。
        args.push(readOnly ? "--ro-bind-fd" : "--bind-fd", "3", "/workspace");
        for (const relative of this.#readOnlyPaths) {
            const metadata = await lstat(`${parentRoot}/${relative}`);
            if (!metadata.isDirectory() || metadata.isSymbolicLink())
                throw new ProcessSandboxError("launch_failed", "Runtime directory must be a real directory");
            args.push("--ro-bind", `${childRoot}/${relative}`, `/workspace/${relative}`);
        }
        if (readOnly) {
            // D-ONECHECK：只读挂载动作全部来自顶部快照推导的 plan，这里不再 lstat
            // 受保护路径；`.git` 是文件还是目录、哪些后代被丢弃，都已在 plan 里定死。
            if (mountPlan === null) {
                throw new ProcessSandboxError("launch_failed", "只读模式缺少受保护路径挂载计划");
            }
            for (const mount of mountPlan.mounts) {
                const destination = `/workspace/${mount.path}`;
                if (mount.action === "bind-readonly") {
                    args.push("--ro-bind", `${childRoot}/${mount.path}`, destination);
                }
                else if (mount.action === "mask-tmpfs") {
                    // 隐藏目录以空的临时文件系统覆盖，宿主内容不会进入 sandbox，
                    // 再重挂为只读（L13）。
                    args.push("--tmpfs", destination, "--remount-ro", destination);
                }
                else {
                    // 隐藏文件以只读空设备覆盖，既不泄露内容也不允许修改宿主文件。
                    args.push("--ro-bind", "/dev/null", destination);
                }
            }
            if (mountPlan.remountScratch) {
                // D-PROBE：没有任何受保护目录可重挂时，金丝雀仍要用私有 scratch tmpfs
                // 真正走一次 `--remount-ro`，否则缺该选项的 bwrap 会被误判为可用。
                args.push("--tmpfs", READONLY_REMOUNT_SCRATCH, "--remount-ro", READONLY_REMOUNT_SCRATCH);
            }
            // D-IPC：只读挂载挡不住既有的 Unix socket / FIFO，用只读 /dev/null 逐个盖住；
            // 跳过哪些子树完全由同一个 plan 决定。
            for (const relative of await this.#ipcPaths(mountPlan)) {
                args.push("--ro-bind", "/dev/null", `/workspace/${relative}`);
            }
        }
        else {
            // read_write 行为保持不变：逐路径 lstat，目录用空 tmpfs，文件用 /dev/null，
            // 目录形态的 `.git` 仍只读可读。
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
                    }
                    else if (metadata.isDirectory()) {
                        args.push("--tmpfs", destination);
                    }
                    else if (metadata.isFile()) {
                        args.push("--ro-bind", "/dev/null", destination);
                    }
                    else {
                        throw new ProcessSandboxError("launch_failed", `受保护路径 ${relative} 类型不安全`);
                    }
                }
                catch (error) {
                    const code = error.code;
                    if (code === "ENOENT" || code === "ENOTDIR")
                        continue;
                    throw error;
                }
            }
        }
        args.push("--chdir", cwd === "." ? "/workspace" : `/workspace/${cwd}`, "--", "/bin/bash", "--noprofile", "--norc", "-lc", 
        // D-CWD：主机侧解析过的目录仍可能在 --chdir 前被换掉；进入沙箱后先用
        // `pwd -P` 确认进程落在 /workspace 下，再运行用户命令。
        readOnly ? `${READONLY_CWD_GUARD}; ${command}` : command);
        return args;
    }
    #noneEffects() {
        const base = {
            sideEffect: "none",
            changedPaths: [],
            workspaceRevision: null,
            artifactRefs: [],
        };
        return this.#workspaceMode === "read_only"
            ? { ...base, externalChangedPaths: [], externalChangedPathsOmitted: 0 }
            : base;
    }
    #notStartedResult(cancelled, timedOut, limit) {
        return {
            exitCode: null,
            signal: null,
            timedOut,
            cancelled,
            stdout: captured([], 0, limit),
            stderr: captured([], 0, limit),
            effects: this.#noneEffects(),
            sandboxProfileVersion: this.profile.version,
            timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
        };
    }
}
_a = ProcessSandbox;
//# sourceMappingURL=process-sandbox.js.map