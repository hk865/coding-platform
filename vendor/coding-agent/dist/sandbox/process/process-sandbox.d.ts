import type { ToolEffects } from "../../core/ports/tool_executor/tool-executor-port.js";
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
export type ProcessWorkspaceMode = "read_write" | "read_only";
/** L15：read_only 时记录的只读执行副作用；快照看到的变化来自并发的别的写者。 */
export interface ProcessExecutionEffects extends ToolEffects {
    readonly externalChangedPaths?: readonly string[];
    readonly externalChangedPathsOmitted?: number;
}
export interface ProcessExecutionResult {
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly timedOut: boolean;
    readonly cancelled: boolean;
    readonly stdout: CapturedOutput;
    readonly stderr: CapturedOutput;
    readonly effects: ProcessExecutionEffects;
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
    /** L13：默认 read_write，现有调用行为不变。 */
    readonly workspaceMode?: ProcessWorkspaceMode;
    /**
     * D-IPC：socket/FIFO 遍历的总条目上限。默认 `IPC_WALK_MAX_ENTRIES`；
     * 测试可注入较小值来验证广度优先次序，生产不传。
     */
    readonly ipcWalkMaxEntries?: number;
}
export declare class ProcessSandboxError extends Error {
    readonly code: "sandbox_unavailable" | "launch_failed" | "invalid_arguments";
    constructor(code: "sandbox_unavailable" | "launch_failed" | "invalid_arguments", message: string);
}
/**
 * D-ONECHECK：一次执行开始时对 `.git` 和每条受保护路径各做一次 `lstat` 得到的分类。
 * 所有挂载决定与 IPC 跳过决定都只从这份快照推导；挂载循环不再重新 `lstat` 这些路径。
 */
export type ProtectedPathKind = "absent" | "directory" | "file" | "symlink" | "other";
export interface ProtectedPathState {
    readonly path: string;
    readonly kind: ProtectedPathKind;
}
export interface ProtectedPathSnapshot {
    readonly paths: readonly ProtectedPathState[];
}
/** D-ONECHECK：快照里一条受保护路径最终选定的挂载动作。 */
export type ReadonlyMountAction = "bind-readonly" | "mask-tmpfs" | "mask-devnull";
export interface ReadonlyMount {
    readonly path: string;
    readonly action: ReadonlyMountAction;
}
export interface ReadonlyMountPlan {
    /** 实际挂载动作，按路径深度升序（同层字节序）排列。 */
    readonly mounts: readonly ReadonlyMount[];
    /** 被遮蔽的受保护路径（空 tmpfs 或 `/dev/null`）；其整棵子树都不可见。 */
    readonly maskedSubtrees: readonly string[];
    /** 只读但内容仍可读的受保护路径（当前只有目录形态的 `.git`）；其下显式否认路径各自保留挂载。 */
    readonly readableSubtrees: readonly string[];
    /** 因最近的已选遮蔽祖先而丢弃、不再单独挂载的受保护路径。 */
    readonly dropped: readonly string[];
    /** 没有任何 `--remount-ro` 来源时为 true，D-PROBE 金丝雀需要私有 scratch tmpfs。 */
    readonly remountScratch: boolean;
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
export declare function planReadonlyMounts(snapshot: ProtectedPathSnapshot): ReadonlyMountPlan;
/** D-ONECHECK：IPC 遍历只跳过计划真正遮蔽的子树（起点本身或其后代）。 */
export declare function readonlyIpcSkips(plan: ReadonlyMountPlan, relative: string): boolean;
/**
 * bubblewrap 进程隔离适配器。workspace 通过已打开的 fd 绑定，敏感路径
 * 再以只读或空挂载覆盖；能力探测失败时绝不退化成宿主 shell。
 */
export declare class ProcessSandbox {
    #private;
    readonly profile: ProcessSandboxProfile;
    private readonly workspaceRoot;
    private readonly workspace;
    static readonly PROFILE_VERSION = "bwrap-m3-v4";
    constructor(profile: ProcessSandboxProfile, workspaceRoot: string, workspace: WorkspaceSandbox, options?: ProcessSandboxOptions);
    /** 恢复约束快照使用构造后已规范化、过滤的实际选项。模式按每次调用定，不进恢复约束（L14）。 */
    get effectiveOptions(): Required<Omit<ProcessSandboxOptions, "workspaceMode" | "ipcWalkMaxEntries">>;
    static probe(workspaceRoot: string, workspace: WorkspaceSandbox, options?: Readonly<{
        bwrapPath?: string;
        workspaceMode?: ProcessWorkspaceMode;
        /** D-PROBE：探测必须使用将运行的沙箱的实际受保护路径、只读运行时路径和可执行路径。 */
        protectedPaths?: readonly string[];
        readOnlyPaths?: readonly string[];
        executablePath?: string;
    }>): Promise<ProcessSandboxProfile>;
    execute(request: ProcessExecutionRequest): Promise<ProcessExecutionResult>;
}
//# sourceMappingURL=process-sandbox.d.ts.map