import type { FileHandle } from "node:fs/promises";
import type { ToolEffects } from "../../core/ports/tool_executor/tool-executor-port.js";
export type WorkspaceErrorCode = "invalid_path" | "permission_denied" | "not_found" | "not_file" | "binary_file" | "invalid_encoding" | "too_large" | "file_changed" | "already_exists" | "parent_missing" | "no_match" | "ambiguous_match" | "io_error";
export declare class WorkspaceSandboxError extends Error {
    readonly code: WorkspaceErrorCode;
    readonly effects: ToolEffects;
    constructor(code: WorkspaceErrorCode, message: string, effects?: ToolEffects);
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
    /** 只拒写的前缀：`replace`/`createFile` 在规范化之后拒绝落在其内的路径（比较不分大小写）；读、列举和快照不查。 */
    readonly writeDeniedPrefixes?: readonly string[];
    /** 不参与恢复 revision 的可再生/体积型目录。 */
    readonly snapshotIgnoredPrefixes?: readonly string[];
    readonly consistencyMode?: WorkspaceConsistencyMode;
    readonly maxFileBytes?: number;
}
export declare const DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PREFIXES: readonly [".git", ".tooling", "node_modules", "dist", "coverage", "test-results", ".cache"];
/**
 * 基于受信目录句柄的 workspace 文件能力。所有路径逐段 O_NOFOLLOW 打开，
 * 避免“先检查路径、后使用路径”的 symlink 竞态逃逸。
 */
export declare class WorkspaceSandbox {
    #private;
    private constructor();
    static create(root: string, options?: WorkspaceSandboxOptions): Promise<WorkspaceSandbox>;
    get identity(): string;
    get deniedPrefixes(): readonly string[];
    get snapshotIgnoredPrefixes(): readonly string[];
    get consistencyMode(): WorkspaceConsistencyMode;
    /** 恢复约束快照使用实例已解析的实际读取上限。 */
    get maxFileBytes(): number;
    /**
     * 仅供 ProcessSandbox 继承到 bwrap 的受信根目录句柄；调用方负责 close。
     * 公开值中不包含宿主路径，具体 ToolHandler 也拿不到该 capability。
     */
    acquireRootHandleForProcess(): Promise<FileHandle>;
    revision(): Promise<string>;
    captureBaseline(): Promise<WorkspaceSnapshot>;
    acceptAgentChanges(snapshot: WorkspaceSnapshot, changedPaths: readonly string[]): Promise<WorkspaceSnapshot>;
    checkConsistency(requestedScope?: "session" | "workspace"): Promise<WorkspaceConsistencyReport>;
    read(relativePath: string, maxBytes?: number): Promise<WorkspaceFile>;
    /**
     * 一次读多个文件。结果和 relativePaths 同序，每项就是 read(path, maxBytes) 的结果或它抛的错，
     * 一项失败不影响别的；只开一次根。工作区根在本地盘上（第一次调用时 statfs 一次，实例记下）
     * 用同步系统调用，否则同时异步读几个。via 只给测试强制选一种，生产不传。
     * 取消时不回部分结果，整个调用失败。
     */
    readMany(relativePaths: readonly string[], maxBytes?: number, options?: {
        signal?: AbortSignal;
        via?: "sync" | "async";
    }): Promise<({
        ok: true;
        file: WorkspaceFile;
    } | {
        ok: false;
        error: WorkspaceSandboxError;
    })[]>;
    replace(relativePath: string, oldText: string, newText: string, expectedRevision: string): Promise<WorkspaceWriteResult>;
    createFile(relativePath: string, content: string): Promise<WorkspaceWriteResult>;
    /** Bounded inventory for host analysis, independent of Git status/ignores. */
    listFiles(maxEntries?: number, options?: {
        prefix?: string;
        signal?: AbortSignal;
    }): Promise<{
        paths: string[];
        truncated: boolean;
    }>;
    snapshot(): Promise<WorkspaceSnapshot>;
    diff(before: WorkspaceSnapshot, after: WorkspaceSnapshot): readonly string[];
}
//# sourceMappingURL=workspace-sandbox.d.ts.map