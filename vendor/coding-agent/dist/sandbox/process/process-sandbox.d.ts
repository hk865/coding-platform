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
export declare class ProcessSandboxError extends Error {
    readonly code: "sandbox_unavailable" | "launch_failed";
    constructor(code: "sandbox_unavailable" | "launch_failed", message: string);
}
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
    /** 恢复约束快照使用构造后已规范化、过滤的实际选项。 */
    get effectiveOptions(): Required<ProcessSandboxOptions>;
    static probe(workspaceRoot: string, workspace: WorkspaceSandbox, options?: Readonly<{
        bwrapPath?: string;
    }>): Promise<ProcessSandboxProfile>;
    execute(request: ProcessExecutionRequest): Promise<ProcessExecutionResult>;
}
//# sourceMappingURL=process-sandbox.d.ts.map