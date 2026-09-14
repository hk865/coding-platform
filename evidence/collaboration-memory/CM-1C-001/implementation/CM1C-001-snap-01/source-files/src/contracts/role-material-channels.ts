/**
 * RW-17 契约：角色**必读材料**的取材通道端口。
 *
 * 背景（ADR 0003 D4-3「ContextCompiler 按规格取材，必读材料缺失返回 needs_material」）：
 * RW-15 如实 fail-closed 之后，规格里被真实派发的角色（executor／integrator）要求的
 * contract／code／evidence 三类材料在本入口**没有任何通道**，于是装了 executor 规格的项目里
 * 每一次普通运行都在模型调用之前失败（"可证明未启动"）。本票为这几类接上**真实、带来源与版本**的
 * 通道；本文件只定义其中唯一需要宿主能力的那个端口：**源码索引**。
 *
 * ── 为什么"源码索引"需要一个端口 ─────────────────────────────────────────────
 * 1. 读取真实工作区需要宿主才知道的信息（项目／工作区 → 检出根），ContextCompiler 不持有它；
 * 2. 路径边界、符号链接竞态、拒绝前缀与"哪些文件可读"的判定属于 WorkspaceReader 与内核的既有能力
 *    （`vendor/coding-agent` 的 WorkspaceSandbox，WorkspaceReader 的 query-workspace-source-reader.ts /
 *    source-workspace-reader.ts 与 WorkerRuntime 都经它读源码），ContextCompiler **不复制**这条路径，
 *    只消费端口返回的有界结果；
 * 3. 端口实现由组合根注入（`src/app/service.ts`），与 ControlEngine 角色受理判据的注入方式一致。
 *
 * ── 端口返回的是"索引"，不是整仓源码 ─────────────────────────────────────────
 * `entries` 是有界的路径清单（内核的 bounded inventory），`excerpts` 是**更小**的有界正文
 * （仅当任务作用域声明了模块路径前缀时才取该前缀下的文件）。超限一律如实报 `truncated`，
 * 由 ContextCompiler 写进 gaps，绝不静默裁剪成"看起来完整"的材料。
 *
 * ── 权限与版本由谁约束 ────────────────────────────────────────────────────
 * 端口本身**不授权**：它只接受调用方按 claim 时信封写下的 `declaredTools`／`workspaceRevision`，
 * 并在自己没有 read 能力时返回 `forbidden`。真正的判据在 ContextCompiler：
 *   - 信封工具集不含 `read` → 不读取，直接报缺口（不为了拿到材料而伪造权限）；
 *   - 信封自己的 workspaceSnapshot.revision 与 canonical Workspace 版本不一致 → stale，不读取；
 *   - 读到的每个文件都带内核给出的内容 revision，随材料一起进入 sourceRefs。
 */

/** 索引读取的有界上限；超限如实报 truncated。 */
export const ROLE_SOURCE_INDEX_MAX_ENTRIES = 512;
export const ROLE_SOURCE_EXCERPT_MAX_FILES = 8;
export const ROLE_SOURCE_EXCERPT_MAX_BYTES = 32 * 1024;

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

export type RoleSourceIndexEntryV1 = { path: string };

export type RoleSourceIndexExcerptV1 = {
  path: string;
  /** 内核对本次读取给出的内容 revision（内核自己算的，不是调用方声明）。 */
  revision: string;
  content: string;
};

export type RoleSourceIndexResultV1 =
  | {
      status: 'sourced';
      /** 内核工作区身份（不含宿主路径）。工作区版本以调用方的 claim 时信封为准（已与 canonical 核对）。 */
      provenance: { workspace: string };
      entries: RoleSourceIndexEntryV1[];
      entryCount: number;
      truncated: boolean;
      excerpts: RoleSourceIndexExcerptV1[];
      /** 正文按上限未取全时的原因（例如"前缀下文件数超过上限"）；供 gaps 使用。 */
      excerptNotes: string[];
    }
  /** 本 Run 没有被授予 read：不读取，也不返回任何路径。 */
  | { status: 'forbidden'; message: string }
  /** 工作区不可读（未登记、路径不存在、内核能力不可用）：显式失败，不静默返回空清单。 */
  | { status: 'unavailable'; message: string };

/** 宿主注入的有界源码索引能力。实现复用 WorkspaceReader／内核既有的工作区读取路径。 */
export interface RoleSourceIndexPort {
  readSourceIndex(request: RoleSourceIndexRequestV1): Promise<RoleSourceIndexResultV1>;
}
