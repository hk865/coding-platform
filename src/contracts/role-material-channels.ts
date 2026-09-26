
// Completed-capability migration: selected original declarations, no legacy service port.
export type RoleSourceIndexRequestV1 = {
    schemaVersion: 1;
    projectId: string;
    workspaceId: string;
    /** 本 Run 在信封上被授予的工具集（claim 时确定的那一份，不是"希望拥有"的）。 */
    declaredTools: readonly string[];
    /** 本 Run 的信封声明的 workspace 版本（调用方已与 canonical Workspace 核对过一致）。 */
    workspaceRevision: number;
    maxEntries: number;
    maxExcerptFiles: number;
    maxExcerptBytes: number;
    /** 任务作用域声明的模块路径前缀（可为空）：只用于**选取有界正文**，不改变可读范围。 */
    pathPrefix?: string;
};
export type RoleSourceIndexEntryV1 = {
    path: string;
};
export type RoleSourceIndexExcerptV1 = {
    path: string;
    /** 内核对本次读取给出的内容 revision（内核自己算的，不是调用方声明）。 */
    revision: string;
    content: string;
};
export type RoleSourceIndexResultV1 = {
    status: 'sourced';
    /** 内核工作区身份（不含宿主路径）。工作区版本以调用方的 claim 时信封为准（已与 canonical 核对）。 */
    provenance: {
        workspace: string;
    };
    entries: RoleSourceIndexEntryV1[];
    entryCount: number;
    truncated: boolean;
    excerpts: RoleSourceIndexExcerptV1[];
    /** 正文按上限未取全时的原因（例如"前缀下文件数超过上限"）；供 gaps 使用。 */
    excerptNotes: string[];
}
/** 本 Run 没有被授予 read：不读取，也不返回任何路径。 */
 | {
    status: 'forbidden';
    message: string;
}
/** 工作区不可读（未登记、路径不存在、内核能力不可用）：显式失败，不静默返回空清单。 */
 | {
    status: 'unavailable';
    message: string;
};
/** 宿主注入的有界源码索引能力。实现复用 WorkspaceReader／内核既有的工作区读取路径。 */
export interface RoleSourceIndexPort {
    readSourceIndex(request: RoleSourceIndexRequestV1): Promise<RoleSourceIndexResultV1>;
}
