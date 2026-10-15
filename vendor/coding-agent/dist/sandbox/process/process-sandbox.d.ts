import type { ToolEffects } from "../../core/ports/tool_executor/tool-executor-port.js";
import { WorkspaceSandbox } from "../workspace/workspace-sandbox.js";
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
    /** L10：原始报告总有。没接上设置的调用方写 `none`／`not_configured`。 */
    readonly resourceCaps: ResourceCapsReport;
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
    /**
     * L13：每次 `execute` 现读 `current()`；不进 `effectiveOptions`、授权、配置版本、
     * 准备好的执行、摘要和恢复约束。缺了照今天跑，结果写 `none`／`not_configured`。
     */
    readonly resourceCaps?: ResourceCapSource;
}
export interface ResourceCapRequest {
    readonly memoryMaxBytes: number;
    readonly tasksMax: number;
}
/** 每次 execute 读一次；Host 持有，设置改了就变（L13）。 */
export interface ResourceCapSource {
    current(): ResourceCapRequest;
}
export type ResourceCapUnavailableReason = "not_linux" | "no_cgroup_v2" | "no_systemd_run" | "no_user_session" | "controllers_not_delegated" | "literal_arguments_not_preserved" | "sandbox_unavailable" | "probe_failed" | "not_configured";
export type ResourceCapCapability = {
    readonly status: "available";
} | {
    readonly status: "unavailable";
    readonly reason: ResourceCapUnavailableReason;
    readonly detail: string;
};
export type ResourceCapsReport = {
    readonly status: "applied";
    readonly memoryMaxBytes: number;
    readonly tasksMax: number;
    readonly memory: "cap_hit" | "none_observed" | "uncertain";
    readonly processes: "cap_hit" | "none_observed" | "unknown";
    readonly observationComplete: boolean;
} | {
    readonly status: "none";
    readonly reason: ResourceCapUnavailableReason;
    readonly text: string;
} | {
    readonly status: "not_started";
};
/** L10 的固定表：没有资源上限时的原因文本。 */
export declare const RESOURCE_CAP_NONE_TEXT: Readonly<Record<ResourceCapUnavailableReason, string>>;
export interface ResourceCapCounters {
    readonly memory: {
        readonly max: number;
        readonly oom: number;
        readonly oomKill: number;
        readonly oomGroupKill: number;
    };
    readonly pids: {
        readonly max: number;
    };
}
export type SettlementPhase = "starting" | "released" | "settled";
export type StopReason = "timeout" | "cancel" | "host_oom_kill";
export type StartupFailure = "launcher_exited" | "ready_timeout" | "deadline_before_start" | "identity_mismatch" | "keeper_not_identified" | "limits_not_effective" | "baseline_unreadable";
export type FinalizeStep = "none" | "waiting_quiescence" | "reading" | "rechecking" | "done";
export interface SettlementState {
    readonly phase: SettlementPhase;
    readonly hasPid: boolean;
    readonly keeperPid: number | null;
    readonly stopReason: StopReason | null;
    readonly startupFailure: StartupFailure | "spawn_failed" | null;
    readonly bwrapExited: boolean;
    readonly finalize: FinalizeStep;
    readonly observationComplete: boolean;
    readonly keeperClosed: boolean;
    readonly streamsClosed: boolean;
    readonly escalationPending: boolean;
}
export type SettlementEvent = {
    readonly kind: "spawned";
} | {
    readonly kind: "keeper_recorded";
    readonly pid: number;
} | {
    readonly kind: "spawn_failed";
} | {
    readonly kind: "startup_failed";
    readonly reason: StartupFailure;
} | {
    readonly kind: "release";
} | {
    readonly kind: "stop";
    readonly reason: StopReason;
} | {
    readonly kind: "escalation_due";
} | {
    readonly kind: "bwrap_exited";
} | {
    readonly kind: "quiescent";
} | {
    readonly kind: "quiescence_failed";
    readonly reason: "timeout" | "keeper_not_identified";
} | {
    readonly kind: "final_read_done";
    readonly ok: boolean;
} | {
    readonly kind: "recheck_done";
    readonly unchanged: boolean;
} | {
    readonly kind: "streams_closed";
};
export type SettlementAction = {
    readonly kind: "kill_group";
} | {
    readonly kind: "signal_bwrap";
    readonly signal: "SIGTERM" | "SIGKILL";
} | {
    readonly kind: "start_escalation";
} | {
    readonly kind: "clear_escalation";
} | {
    readonly kind: "wait_quiescence";
} | {
    readonly kind: "read_final";
} | {
    readonly kind: "recheck_procs";
} | {
    readonly kind: "close_keeper";
} | {
    readonly kind: "finish";
    readonly outcome: {
        readonly kind: "result";
    } | {
        readonly kind: "not_started_cancelled";
    } | {
        readonly kind: "launch_failed";
        readonly reason: StartupFailure | "spawn_failed";
    };
};
export declare class ProcessSandboxError extends Error {
    readonly code: "sandbox_unavailable" | "launch_failed" | "invalid_arguments";
    constructor(code: "sandbox_unavailable" | "launch_failed" | "invalid_arguments", message: string);
}
/** L9：只从本模块导出；读取的原始文本 → 计数。缺的项按 0（RL-20 (14)）。 */
export declare function parseResourceCapCounters(memoryEvents: string, pidsEvents: string): ResourceCapCounters;
/** L7：逐项取大；读成功才并入，旧读晚到也只会往上推（RL-20 (16)）。 */
export declare function mergeResourceCapCounters(seen: ResourceCapCounters, read: ResourceCapCounters): ResourceCapCounters;
/** L9 的纯归因规则（RL-20）。只看 Δ 和读全了没有，不看退出码和信号。 */
export declare function attributeResourceCapEvents(input: {
    readonly baseline: ResourceCapCounters;
    readonly maxSeen: ResourceCapCounters;
    readonly observationComplete: boolean;
}): {
    memory: "cap_hit" | "none_observed" | "uncertain";
    processes: "cap_hit" | "none_observed" | "unknown";
};
/**
 * L4 的结算纯函数：一次执行一个状态，输入一件事，给出新状态和要做的动作。
 * `#run` 只照它给的动作去做；RE0 用各种先后测它（RL-22）。
 */
export declare function settleExecution(state: SettlementState, event: SettlementEvent): {
    readonly state: SettlementState;
    readonly actions: readonly SettlementAction[];
};
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
    get effectiveOptions(): Required<Omit<ProcessSandboxOptions, "workspaceMode" | "ipcWalkMaxEntries" | "resourceCaps">>;
    static probe(workspaceRoot: string, workspace: WorkspaceSandbox, options?: Readonly<{
        bwrapPath?: string;
        workspaceMode?: ProcessWorkspaceMode;
        /** D-PROBE：探测必须使用将运行的沙箱的实际受保护路径、只读运行时路径和可执行路径。 */
        protectedPaths?: readonly string[];
        readOnlyPaths?: readonly string[];
        executablePath?: string;
    }>): Promise<ProcessSandboxProfile>;
    /**
     * L5 第 6 步的金丝雀：在 Host 私有的空临时目录上用同一段起跑代码跑一条命令。
     * 只由 `probeResourceCaps` 调用，不属于公开接口。
     */
    static probeResourceCapsCanary(systemdRunPath: string, bwrapPath: string, options: {
        readonly oomPolicy: boolean;
        readonly expandEnvironment: boolean;
    }, signal?: AbortSignal, remaining?: () => number): Promise<ResourceCapCapability>;
    execute(request: ProcessExecutionRequest): Promise<ProcessExecutionResult>;
}
/** L5：按（systemd-run 路径、bwrap 路径、uid）缓存；同时只跑一个。 */
export declare function probeResourceCaps(): Promise<ResourceCapCapability>;
/** L5：只读缓存，不探测；没探测过是 `unknown`。 */
export declare function resourceCapStatus(): ResourceCapCapability | {
    readonly status: "unknown";
};
//# sourceMappingURL=process-sandbox.d.ts.map