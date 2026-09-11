/**
 * RC-02 ContextCompiler — 角色必读材料「code」的**窄端口消费**（本文件不含工作区访问实现）。
 *
 * ── 归属：读工作区是 WorkspaceReader 的事，取材是 ContextCompiler 的事 ─────────
 * 本文件曾经同时装着两件事：工作区列举/读取/路径边界适配（实现）与取材（消费）。RC-02 之后：
 *   - **实现**归位 WorkspaceReader：`data/workspace-reader/role-source-reader.ts`
 *     （复用本 Module 与内核既有的工作区读取能力与路径边界，见该 Module 的 README）；
 *   - **拒绝前缀**只有一个来源：`data/workspace-reader/denied-prefixes.ts`，本文件一个字面量都不写；
 *   - 留在本文件的是**消费**：向端口提交本 Run 已解析的候选范围（who／哪一份工作区版本／信封权限／
 *     上限／模块前缀），把端口返回的**有界条目与有界正文**变成角色材料条目。
 *
 * ── 本文件负责的三道判据（在调用端口之前完成）────────────────────────────────
 *   1. 权限：信封工具集不含 `read` → 不读取。不为了拿到材料而伪造权限声明；
 *   2. 版本：信封的 workspaceSnapshot.revision 必须等于 canonical Workspace 当前 revision，
 *      否则按 stale 处理（不用新版本冒充 claim 时的来源）；
 *   3. 来源：端口缺失（宿主未接线）→ 按**缺失**处理（fail-closed），不退回"没有源码也能开工"。
 * 端口只负责"读"，不负责"授权"——它拿不到 canonical Workspace，也就无法替代上面两条。
 *
 * ── 材料资格 ────────────────────────────────────────────────────────────────
 * 索引级材料：路径清单与（在有模块路径前缀时）少量文件正文。资格固定为 `reference`：
 * 不授予权限、不改变 manifest.permissions、不构成完成判据；逐文件全文仍由运行时的既有 `read`
 * 工具按当前源码读取。上限造成的未取全一律经 `notes` 交调用方写进 gaps，绝不静默裁剪。
 *
 * ── 兼容再导出（有明确退出条件）────────────────────────────────────────────
 * 实现只有一份，位于 WorkspaceReader；这里只是让既有调用方从旧路径仍能拿到它：
 * 组合根已改为直接引用新路径（`src/app/service.ts`），仍从旧路径引用的是
 * `tests/control/work-material-gate.test.ts` 与 `tests/control/role-material-completion.test.ts`
 * —— 它们不在本票的写入范围内。**退出条件**：那两处 import 改指
 * `src/data/workspace-reader/role-source-reader.js` 之后，删掉这一行。
 */
import type { TaskEnvelopeV1 } from '../../contracts/task-envelope.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { StateLedger } from '../../contracts/ledger.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { RuntimeRoleMaterialEntryV1 } from '../../contracts/runtime-context-materials.js';
import {
  ROLE_SOURCE_EXCERPT_MAX_BYTES,
  ROLE_SOURCE_EXCERPT_MAX_FILES,
  ROLE_SOURCE_INDEX_MAX_ENTRIES,
  type RoleSourceIndexPort,
} from '../../contracts/role-material-channels.js';
import { artifactBodyDigest } from '../../contracts/artifact.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { RoleMaterialSourceResult } from './role-material-sources.js';


/** 本入口消费「code」类材料时能看到的东西：已解析的 Run 范围、计划引用、信封权限与工作区版本。 */
export type CodeMaterialRequest = {
  scope: { projectId: string; workspaceId: string; goalId: string; taskId: string; runId: string };
  planRef: PlanRevisionRef;
  workspaceSnapshot: TaskEnvelopeV1['workspaceSnapshot'];
  permissions: TaskEnvelopeV1['permissions'];
};

export type CodeMaterialDeps = {
  /** 只读 canonical 事实：核对本 Run 声明的工作区版本。 */
  ledger: Pick<StateLedger, 'load'>;
  /** 宿主注入的 WorkspaceReader 窄端口；缺省表示宿主没有接线，按缺失处理。 */
  sourceIndex?: RoleSourceIndexPort;
};

/**
 * 取「code」类材料。正文只取任务作用域声明的**模块路径前缀**下的少量文件；没有前缀就只给索引——
 * 既让"当前源码入口"真的进入 ContextBundle，又不会把整仓源码塞进去。
 * 模块引用（任务作用域里的 `moduleRef`）到路径前缀的换算属于本 Module 对计划语义的理解，
 * 因此留在这里；端口只按给定前缀挑正文，不猜目录。
 */
export async function selectCodeMaterial(
  deps: CodeMaterialDeps,
  request: CodeMaterialRequest,
  plan: PlanRevisionSnapshot | null,
): Promise<RoleMaterialSourceResult> {
  const scope = request.scope;
  if (!request.permissions.tools.includes('read')) {
    return { status: 'unavailable', message: '本 Run 的信封工具集不含 read：不读取当前源码（也不伪造权限声明去读取）' };
  }
  const port = deps.sourceIndex;
  if (port === undefined) {
    return { status: 'unavailable', message: '宿主未接线 RoleSourceIndexPort（WorkspaceReader 的有界源码索引）：无法按信封权限与工作区版本取材当前源码' };
  }
  const workspaceLoad = await deps.ledger.load({ aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId });
  if (workspaceLoad.status !== 'found' || workspaceLoad.snapshot.ref.aggregateType !== 'Workspace') {
    return { status: 'unavailable', message: 'canonical Workspace 读不到：无法核对本 Run 的工作区版本' };
  }
  if (workspaceLoad.snapshot.revision !== request.workspaceSnapshot.revision) {
    return {
      status: 'unavailable',
      message: '工作区版本已前进（canonical=' + workspaceLoad.snapshot.revision + '，本 Run 信封=' + request.workspaceSnapshot.revision +
        '）：按 stale 处理，不用新版本冒充 claim 时的来源',
    };
  }
  const task = plan === null ? undefined : plan.tasks.find((candidate) => candidate.taskId === scope.taskId);
  const moduleRef = task?.scope.kind === 'module' ? task.scope.moduleRef : undefined;
  // 任务作用域声明的模块引用：只有**形如目录路径**的取值才当作前缀（模块标识例如 "m-goal-105"
  // 不是路径，不能拿来猜目录）。前缀只是把正文范围收得更小；索引本身始终是完整的（有界）清单。
  // 前缀在索引里匹配不到任何路径时，端口会如实记一条说明，不假装取了正文。
  const pathPrefix = moduleRef !== undefined && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(moduleRef) ? moduleRef : undefined;
  const read = await port.readSourceIndex({
    schemaVersion: 1,
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    declaredTools: [...request.permissions.tools],
    workspaceRevision: request.workspaceSnapshot.revision,
    maxEntries: ROLE_SOURCE_INDEX_MAX_ENTRIES,
    maxExcerptFiles: ROLE_SOURCE_EXCERPT_MAX_FILES,
    maxExcerptBytes: ROLE_SOURCE_EXCERPT_MAX_BYTES,
    ...(pathPrefix ? { pathPrefix } : {}),
  });
  if (read.status === 'forbidden') return { status: 'unavailable', message: read.message };
  if (read.status === 'unavailable') return { status: 'unavailable', message: read.message };
  const after = await deps.ledger.load({ aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId });
  if (after.status !== 'found' || after.snapshot.ref.aggregateType !== 'Workspace' || after.snapshot.revision !== request.workspaceSnapshot.revision) {
    return { status: 'unavailable', message: 'stale：源码读取期间 canonical Workspace 版本已改变或不可读取，不组装旧版本材料' };
  }
  if (read.entryCount === 0) {
    return { status: 'unavailable', message: '工作区索引里没有任何可读条目：没有可以供应的当前源码索引' };
  }
  const sourceRefs: SourceRefV1[] = [
    { kind: 'workspace', refId: scope.workspaceId, revision: String(request.workspaceSnapshot.revision) },
    ...read.excerpts.map((excerpt) => ({ kind: 'artifact' as const, refId: 'source-file:' + excerpt.path, revision: excerpt.revision })),
  ];
  const content = canonicalJson({
    schemaVersion: 1,
    kind: 'code',
    workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId, revision: request.workspaceSnapshot.revision },
    kernelWorkspaceIdentity: read.provenance.workspace,
    index: { entryCount: read.entryCount, truncated: read.truncated, entries: read.entries.map((entry) => entry.path) },
    excerpts: read.excerpts.map((excerpt) => ({ path: excerpt.path, contentRevision: excerpt.revision, content: excerpt.content })),
    note: '索引级材料：路径清单与（在有模块路径前缀时）少量文件正文。逐文件全文由运行时的既有 read 工具按当前源码读取；'
      + '本材料不装整仓源码，也不把索引当作当前验收。',
    qualification: '当前工作区在 claim 时版本下的源码索引（参考）：不授予权限，也不满足验收',
  } as JsonValue);
  const materialId = 'source-index:' + scope.workspaceId;
  const entry: RuntimeRoleMaterialEntryV1 = {
    kind: 'code',
    materialId,
    content,
    digest: artifactBodyDigest(content),
    sourceRefs,
    selectedBecause: '角色规格必读材料「code」：在本 Run 的信封权限（工具 ' + request.permissions.tools.join('/') + '）与 claim 时工作区版本 ' +
      request.workspaceSnapshot.revision + ' 下，经既有工作区读取能力取回的有界源码索引（' + read.entryCount + ' 条' +
      (read.truncated ? '，已达上限' : '') + '）' +
      (read.excerpts.length > 0 ? '，并取回模块前缀 ' + pathPrefix + ' 下 ' + read.excerpts.length + ' 个文件的正文' : '') +
      '；既有证据不足以据此判断实现是否正确，源码仍以运行时读到的当前版本为准。',
    selection: 'selected',
    qualification: 'reference',
    versions: { workspaceRevision: request.workspaceSnapshot.revision, planRevision: plan?.planRevision ?? null },
  };
  return {
    status: 'supplied',
    selection: 'selected',
    rules: [],
    entries: [entry],
    evidenceRefs: [],
    sourceRefs,
    detail: '既有 WorkspaceReader／内核工作区读取（有界索引 ' + read.entryCount + ' 条' +
      (read.excerpts.length > 0 ? '，正文 ' + read.excerpts.length + ' 个文件' : '，无模块前缀故只给索引') + '）',
    materialIds: [materialId],
    ...(read.excerptNotes.length > 0 ? { notes: read.excerptNotes } : {}),
  };
}
