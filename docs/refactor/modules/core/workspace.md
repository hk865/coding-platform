# WorkspaceTools：文件、Git 与源码索引实现骨架

> **2026-09-26 next当前实现：** 文件当前/捕获版本读取比较、正式来源与Runtime工具消费者已有；固定Git commit读取/比较已独审，git↔working_tree普通文本raw摘要与mode双向比较也已独审导入（15项/2文件与types，单次有界观察）。Git/capture、mixed binary、Git写版本、语言扩展与完整Host目录/保存/diff消费者仍待完成。以下带日期的旧工程实施记录保留历史含义；next当前证据以[能力索引](../../IMPLEMENTED-CAPABILITIES.md)为准。

状态：目标详细设计及分批实施，2026-09-23。R2a 已把 18 个 TS 实现与真实消费者迁至 `src/core/workspace/` 并独立验收。本文可单独作为 R2 施工入口；跨模块约定见[公共契约](../../skeleton/CONTRACTS.md)、[核心数据 D2](../../CORE-DATA-OPERATIONS.md)和[状态机](../../ORCHESTRATION-STATE-MACHINES.md)。§10 的 R1、R2a、R2b及R2c真实访问/捕获/游标/架构接线已独立验收。R2d.1模型协议及错误优先级补测已通过；R2d.2 Work/explore/Reviewer真实运行接线已验收，Query R2d.3也已验收。readWorkspace/compareWorkspace、Git历史以及非TS的统一冻结provider仍待实施，旧Python/C++工具已有真实能力。当前精确进度见[批次证据](../../reviews/implementation-batches.md)。

## 1. 业务目的和职责

让人和 Agent 按路径、文本、符号、关系定位真实工程材料，并知道来源版本与覆盖缺口。业务决定查什么；核心实现负责路径边界、捕获、解析、检索和结果整形。普通源码查询不以已有 Plan、Run 或正式 baseline 为前提。

本模块维护文件清单、来源摘要、解析器状态和临时查询索引。不决定架构职责是否合理，不修改任务图，不判断任务完成，不运行或修改 Session。

允许产品 Module 依赖：无。可调用 Node、解析器、共享 contracts 及现有 Kernel 的只读 WorkspaceSandbox 库能力，这不等于依赖 AgentRuntime。Host 注入真实根与权限，模型不能用参数指定任意绝对根。

消费者为 Workflow 的直接查询、WorkGraph 的来源/架构操作、AgentRuntime 的执行工具。需要持久材料时，WorkGraph 取得结果后交 RecordStore；本模块不获得 Store。Kernel 编辑、shell、补丁执行桥接属于 AgentRuntime；changed paths 只是失效提示，不能证明其他文件未改变。

## 2. 目标关键文件与逐文件职责

R2a 暂保留原文件基名与平铺用途 readers，后续有实际复用收益再归组到 purpose-readers。R2b 具体内部接口和退出条件见[任务书](../../tasks/R2b-frozen-source-query.md)。保留现有完整实现时不为了目录表机械拆碎。用途适配器迁入后继续保留不同范围约束，不合成一组越来越宽的 flags。

```text
src/core/workspace/
  ports.ts                         # 本页请求、结果和 WorkspaceToolsPort
  workspace-tools.ts               # 公开操作组合、能力路由
  access.ts                        # 根绑定、路径与每次读取资格
  denied-prefixes.ts               # 现有拒绝前缀唯一来源
  capture.ts                       # 捕获/核验、句柄保留和失效
  source-query.ts                  # 类型化查询、游标与结果页
  source-identity.ts               # 保留固定 Git HEAD 读取
  git-read.ts                      # 受限版本读取/比较适配
  project-source-index.ts          # 现有门面，捕获/分析/核验与兼容响应
  project-source-snapshot.ts       # R2b：完整允许源捕获、摘要及窄失败类型
  typescript-source-query.ts       # R2b：无 I/O 的冻结 TS 分析与服务复用
  source-index.ts                  # 显式文件集及 excerpt
  python-source-index.ts           # 复用实际 Jedi 能力
  cpp-source-index.ts              # 复用实际 libclang 能力
  architecture-source.ts           # 按显式映射折叠观测关系
  purpose-readers/                 # 原窄 Source Port，逐消费者迁入
    role-source-reader.ts
    query-workspace-source-reader.ts
    reviewer-source-reader.ts
    verification-workspace-reader.ts
    candidate-workspace-reader.ts
    exploration-source.ts
    readonly-read-witness-reader.ts
```

| 文件 | 导出/责任 | 读写与内部依赖 |
| --- | --- | --- |
| ports.ts | WorkspaceToolsPort、本页类型 | 只依赖共享 contracts |
| workspace-tools.ts | createWorkspaceTools(deps) | 组合 access/capture/query/Git/architecture，无领域提交 |
| access.ts | WorkspaceAccessFactory、WorkspaceReadAccess | 包装 Sandbox，绑定根及权限；不接受模型授予能力 |
| denied-prefixes.ts | WORKSPACE_DENIED_PREFIXES | 原常量迁移，其他文件不复制前缀表 |
| capture.ts | CaptureRegistry：capture/query/export/verify/release/architectureSource及close | 读清单/正文，管理有界冻结材料；依赖 providers/identity |
| source-query.ts | querySource，供同一个CaptureRegistry调用 | 核对调用资格，从同一捕获切页，不调用公开 query 拼页 |
| source-identity.ts | readSourceIdentity | 固定只读 HEAD 命令，非 Git 保持 commit=null |
| git-read.ts | readGitVersion、compareGitVersions | 固定 argv、版本/路径校验，无 shell/hooks/提交操作 |
| project-source-index.ts | ProjectSourceIndex | 兼容现有公开调用；参数/当前资格、capture→analyze→verify、结果整形 |
| project-source-snapshot.ts | captureProjectSource、ProjectSourceSnapshot | 唯一 live 清单/正文/身份捕获和原摘要；类型由旧入口兼容导出 |
| typescript-source-query.ts | TypeScriptSourceAnalyzer | 同步冻结查询；按脚本 digest/config 复用 Language Service，不持有磁盘入口 |
| source-index.ts | SourceIndex | 复用小范围文件集查询，不把一次 excerpt 升级为全仓扫描 |
| Python/C++ providers | PythonSourceIndex、CppSourceIndex | 固定 helper/隔离输入，保留版本、配置、未知项与能力差异 |
| architecture-source.ts | captureArchitectureSource | 同一捕获的完整 imports/indexed sources → 现有 ArchitectureSourceSnapshotV1 |
| purpose-readers/* | 原有窄 Port 实现 | 共用底座，保留各用途额外范围；不得通过另一用途适配器借更宽权限 |

内部方向为 facade → access/capture/query/Git/architecture → providers/identity；provider 不反调 facade。共享底座不意味着把 SourceGraph 的正式计划资格、Vault 保存等领域流程一起迁入。

## 3. 身份、请求与完整 Port

R2e.1已具体确定text/read/compare的下一步接口：[精确任务书](../../tasks/R2e-1-text-read-compare.md)。下列scope/digestBasis/Comparison仍是尚未实现的目标扩展；现有R2c/d端口以当前源码和批次证据为准。Git比较最终DTO将在R2e.2实现前扩展，不能把capture-only响应用于Git或全工作树。

现有 WorkspaceRef 来自 `src/contracts/ledger.ts`；ArchitectureSourceMapping/ArchitectureSourceSnapshotV1 来自 `src/contracts/architecture-source.ts`。新增 CoreCallContext/SourceCaptureRef 来自目标 `src/contracts/core/call-context.ts`、`source.ts`，定义见公共契约。

SourceCaptureRef 固定为平铺 `{projectId,workspaceId,captureId,sourceDigest,configDigest,indexVersion,workspaceRevision}`。摘要由工具生成。它是临时句柄；`PersistedSourceCaptureRef={capture,material:ArtifactRef}` 由 WorkGraph 在正文持久成功后构造，本模块不向临时引用塞入 ArtifactRef。

```ts
import type { WorkspaceRef } from '../../contracts/ledger.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SourceCaptureRef } from '../../contracts/core/source.js';
import type { ArchitectureSourceMapping, ArchitectureSourceSnapshotV1 }
  from '../../contracts/architecture-source.js';

export type WorkspaceError = 'invalid' | 'forbidden' | 'not_found'
  | 'source_stale' | 'capture_expired' | 'cursor_mismatch' | 'capacity'
  | 'unsupported' | 'unavailable' | 'cancelled';
export type WorkspaceResult<T> = { status: 'ready'; value: T }
  | { status: 'rejected'; code: WorkspaceError; reason: string };
export type SourceProvider = 'text' | 'typescript' | 'python' | 'cpp';
export type SourceLocation = {
  path: string; digest: string;
  start: { line: number; column: number }; end: { line: number; column: number };
};
export type SourceFileEntry = {
  path: string; digest: string; sizeBytes: number;
  kind: 'source' | 'configuration' | 'dependency_manifest' | 'text';
};
export type SourceRelation = {
  kind: 'import' | 'reference' | 'call'; from: SourceLocation;
  expression: string; targets: SourceLocation[];
  resolution: 'resolved' | 'static_candidate' | 'unknown';
};
export type SourceDiagnostic = { path: string | null; code: string; message: string };
// R2e.1确定的内容域，语义complete不表示整个工作树完整。
export type CaptureContentScope =
  | { kind: 'typescript_project_inputs'; selectionVersion: 'ts-js-json-v1';
      prefix: null; digestBasis: 'decoded_utf8' }
  | { kind: 'text_files'; selectionVersion: 'readable-regular-utf8-no-nul-v1';
      prefix: string | null; digestBasis: 'raw_bytes' };
export type SourceCoverage = {
  scope: CaptureContentScope;
  provider: SourceProvider; engine: string; engineVersion: string;
  projectConfiguration: string | null; sourceCount: number;
  indexedSourceCount: number; permissionFiltered: true;
  complete: boolean; unresolved: string[];
  filesystemAtomic: false; fullRuntimeCallGraph: false;
};
export type CaptureSummary = {
  ref: SourceCaptureRef; capturedAt: string; verifiedAt: string;
  commitHash: string | null; expiresAt: string; coverage: SourceCoverage;
  changes: { added: string[]; modified: string[]; deleted: string[] };
};
export type SourceCaptureMaterial = {
  summary: CaptureSummary; files: SourceFileEntry[];
  relations: SourceRelation[]; diagnostics: SourceDiagnostic[]; diagnosticsTruncated: boolean;
};
export type ReadWorkspaceRequest = {
  workspace: WorkspaceRef; path: string; maxBytes: number;
  version: { kind: 'working_tree' } | { kind: 'git'; commit: string }
    | { kind: 'capture'; capture: SourceCaptureRef };
};
export type WorkspaceFile = {
  path: string; content: string; digest: string; sizeBytes: number;
  digestBasis: 'raw_bytes' | 'decoded_utf8';
  version: ReadWorkspaceRequest['version']; readAt: string;
};
export type CaptureSourceRequest = {
  workspace: WorkspaceRef; workspaceRevision: number;
  provider: SourceProvider; configPath?: string; prefix?: string;
  previous?: SourceCaptureRef; changedPaths?: readonly string[];
};
export type SourceQuery =
  | { kind: 'paths'; prefix?: string }
  | { kind: 'text'; text: string; caseSensitive: boolean; prefix?: string }
  | { kind: 'symbols'; path?: string; prefix?: string }
  | { kind: 'definitions' | 'references'; path: string; line: number; column: number }
  | { kind: 'imports' | 'calls'; path?: string; prefix?: string };
export type SourceHit =
  | { kind: 'file'; file: SourceFileEntry }
  | { kind: 'text'; location: SourceLocation; excerpt: string }
  | { kind: 'symbol'; location: SourceLocation; name: string; symbolKind: string }
  | { kind: 'location'; location: SourceLocation }
  | { kind: 'relation'; relation: SourceRelation };
export type SourcePageRequest = {
  capture: SourceCaptureRef; query: SourceQuery; cursor: string | null; limit: number;
};
export type SourcePage = {
  capture: SourceCaptureRef; items: SourceHit[]; nextCursor: string | null;
  complete: boolean; coverage: SourceCoverage;
  observation: 'captured_source'; currentness: 'not_rechecked';
};
export type WorkspaceComparisonRequest = {
  workspace: WorkspaceRef;
  before: { kind: 'git'; commit: string } | { kind: 'capture'; capture: SourceCaptureRef };
  after: { kind: 'git'; commit: string } | { kind: 'capture'; capture: SourceCaptureRef };
};
export type WorkspaceChange =
  | { kind: 'added'; path: string; digest: string }
  | { kind: 'deleted'; path: string; digest: string }
  | { kind: 'modified'; path: string; beforeDigest: string; afterDigest: string }
  | { kind: 'renamed'; beforePath: string; afterPath: string;
      digest: string; evidence: 'identical_content' };
export type WorkspaceComparison = {
  before: SourceCaptureRef; after: SourceCaptureRef;
  scope: CaptureContentScope;
  comparison: 'captured_content_only'; complete: true;
  changes: WorkspaceChange[];
};
export interface WorkspaceToolsPort {
  readWorkspace(ctx: CoreCallContext, input: ReadWorkspaceRequest):
    Promise<WorkspaceResult<WorkspaceFile>>;
  captureSourceChanges(ctx: CoreCallContext, input: CaptureSourceRequest):
    Promise<WorkspaceResult<CaptureSummary>>;
  querySource(ctx: CoreCallContext, input: SourcePageRequest):
    Promise<WorkspaceResult<SourcePage>>;
  exportCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<SourceCaptureMaterial>>;
  compareWorkspace(ctx: CoreCallContext, input: WorkspaceComparisonRequest):
    Promise<WorkspaceResult<WorkspaceComparison>>;
  verifyCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<{capture:SourceCaptureRef;verifiedAt:string}>>;
  releaseCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<{released:boolean}>>;
  captureArchitectureSource(ctx: CoreCallContext,
    input: {capture:SourceCaptureRef;mappings:ArchitectureSourceMapping[]}):
    Promise<WorkspaceResult<ArchitectureSourceSnapshotV1>>;
}
```

所有公开操作只使用ctx.signal作为取消来源；不另收第二个可能不同的AbortSignal。内部异步解析、读取和子进程调用从ctx.signal传递取消，旧底层API不能即时中断时在返回后再次核对，不能发布取消后的成功结果。

坐标是一基行号、一基 UTF-16 列。text 首版是文字搜索，不接受任意脚本。coverage.complete 表示声明范围的处理完整性，不代表完整运行时调用图；SourcePage.complete表示本次查询已到末页，与nextCursor=null一致。未解析关系保留；不支持的 provider/query 返回 unsupported，不能成功返回空图。

旧 sourced/stale/rejected/cancelled 通过薄适配保留原 reason/覆盖字段，迁移期间不批量改模型工具 wire 格式。capture_expired 是材料释放，source_stale 是来源变化，两者不能混淆。

## 4. 捕获、游标与版本生命周期

### 4.1 一次操作内的一对捕获和核验

1. 检查 ctx 调用者、workspace 真实根和读取能力；规范化范围，拒绝越界/链接逃逸，不靠裸 startsWith 判断绝对根包含。
2. 捕获 HEAD/工作区身份、完整权限过滤清单与必要正文，计算内容、配置、依赖清单、索引版本摘要。发现不完整则拒绝，不能把前 N 项称全仓。
3. 在同份材料上解析，保存未知关系及诊断。结果绑定输入 Map，不在 await 后借用另一查询改过的 language service 来源。
4. 再读同范围清单、内容、来源身份及资格，变化返回 source_stale，不发布成功句柄。
5. 成功发布不可变材料和 CaptureSummary。filesystemAtomic=false：前后复核不是操作系统多文件原子快照，也不保证发现改后又改回的瞬时变化。

这不是只读一次文件。workspaceRevision 不足以证明没有外部编辑；changedPaths 不代替完整性检查。权限过滤、两次一致性验证与一次关系分析分别计量。

### 4.2 句柄所有权和释放

CaptureRegistry 条目保存 captureRef、冻结输入/结果、创建/到期时间、主体/权限版本、内存占用与活动读者计数。权限版本由 Host 给出，不允许模型自报一个未失效版本。

Host 配置 maxRetainedCaptures/maxRetainedBytes/idleExpiryMs，属于材料保留容量，不是模型累计预算。回收过期无活动读者的条目；正在读取的条目延迟释放。不能回收后以当前文件重新填充原 captureId。

显式释放、超期、进程关闭后临时句柄失效，重启返回 capture_expired。持久图材料由 WorkGraph 保存后作为历史读取；没有保存源码正文的 Artifact 不能重建当时全部代码。需要保留未提交正文时，由调用方明确保存必要 blob/patch。

### 4.3 续读与最终核验

cursor 是 registry 内不可猜测 token，绑定主体、权限版本、captureId、查询规范摘要、排序版本、下一位置与到期时间。修改 query、跨 capture/主体复用返回 cursor_mismatch。重放同一 cursor 返回同页，不消耗 cursor；limit 只改变页大小，不改变来源。

querySource 从冻结材料切页，不每页重新读取磁盘；每次仍检查当前调用资格。捕获来源权限撤销后整份拒绝，不能仅过滤显示路径却泄露已利用禁止材料推导出的语义结果。

SourcePage 明确 captured_source/not_rechecked。页间文件改变时可以继续读仍被授权的历史材料；要用于“当前架构/执行决定”，WorkGraph 必须在正式使用前 verifyCapture，并核对自己的领域版本。失败重新捕获，不混接新旧页。

verifyCapture 按原范围检查实际清单/摘要/身份/权限，没有可靠文件版本证明时可以全量核验。回执表示核验时点，不提供未来未变保证。普通历史展示不强求 current，因此不必重扫。

exportCapture/captureArchitectureSource 使用同份完整材料；超过导出容量明确拒绝或走显式分块导出，不能用第一页代替全图。映射输出继续遵守现有 ArchitectureSourceSnapshotV1 的节点、边、字节及 unresolved 上限。

## 5. 查询、对比与增量解析

路径表按规范相对路径排序，以路径边界匹配前缀；已知 ref/文件直接定位。文本检索首版扫描捕获的目标文本，附实际位置和摘要，没有真实查询需要时不预建全文服务。

TS/JS 保留 Language Service、脚本 digest 和 config/rootNames 重建条件。架构 imports 在一个 program 中遍历一次；同名路径不能跨工作区复用。多类查询共享同 capture 的输入/provider program，结果按查询类型缓存于该 capture 内。

必须先分离 provider 的 live 捕获与基于冻结输入的查询，再开放新 capture Port。若 querySource 每页仍调用现有 ProjectSourceIndex.query，就没有实现本页契约；旧公开工具保持独立入口直到新路径接通。

增量能力按实际 provider 声明：

- TS/JS 复用既有脚本版本；文件增删、配置、依赖声明、路径映射、解析器版本变化扩大失效范围。改导出可能影响反向依赖，不假定只解析被编辑文件即可。
- Python 保留现有 Jedi/固定 helper 和实际响应复用，不冒称 TS 同等持久增量语义图。
- C/C++ 保留 compilation database、受限 libclang 和未知 flags/外部头文件缺口，不执行工程编译命令来补图。
- 未支持语言只提供文本/路径能力，标明没有语义解析。AST 节点不自动等于业务模块依赖。

两个 capture 按 path 合并清单并比较 digest；缺基准返回 capture_expired。相同内容可提供重命名证据，不能证明语义身份连续；正式映射归 WorkGraph。Git 使用固定 argv、不执行 hooks/shell；完整任意版本比较是待接线能力，现有 HEAD 身份函数不代表它已实现。

P 页冻结结果只做 O(返回条目) 切页，初始捕获及最终核验仍按实际读取范围计成本。局部失效也可能扩大到全仓；不能把索引存在等同于没有 I/O。

## 6. 失败和恢复

| 场景 | 回执/状态 | 后续 |
| --- | --- | --- |
| 无权限/路径非法 | forbidden/invalid，不暴露清单 | 修正真实授权或输入 |
| 捕获中内容/清单/HEAD改变 | source_stale，不发布新句柄 | 重新捕获；旧历史句柄不被原地改写 |
| 文件/总量/关系超限 | capacity，说明范围 | 显式缩小范围，不静默裁剪全图 |
| 引擎不可用/不支持 | unavailable/unsupported | 文本降级是独立能力，覆盖如实说明 |
| 取消 | cancelled，释放未发布材料 | 不误删另一请求使用的捕获 |
| 页间权限撤销/跨主体 | forbidden/cursor_mismatch | 不继续读旧缓存，不延长原授权 |
| 过期/释放/重启 | capture_expired | 重捕获或读取已持久历史材料 |
| compare/verify失败 | 无领域状态写入 | 保留旧基准，不把失败解释为无变化 |

## 7. 旧符号 → 新位置和删除条件

| 现有源码/符号 | 目标/复用方式 | 旧路径退出条件 |
| --- | --- | --- |
| source-workspace-reader.ts::workspaceProjectIndex | access.ts + provider工厂，复用Sandbox/policy | 图/宿主消费者切换且路径测试通过 |
| ProjectArchitectureSourceReader | facade捕获适配，暂保留 ArchitectureSourceCapturePort | SourceGraph/WorkGraph全部切新Port |
| architecture-source.ts::captureArchitectureSource | 同名文件，保留映射/unresolved/容量/digest | 旧imports清零，不重编码历史snapshot |
| ProjectSourceIndex / SourceIndex | 同名目标文件，先迁移再分离冻结查询 | runtime工具/架构/测试全部迁移 |
| PythonSourceIndex / CppSourceIndex | 同名文件，固定helper路径按新目录修正 | 引擎身份/能力/隔离验证通过 |
| WorkspaceSourceIndexReader | purpose-readers/role-source-reader.ts | role消费者切换且有限正文语义保持 |
| query/reviewer/verification/candidate readers | 同名用途适配器，共同底座接access/capture | 每个真实消费者迁完、额外范围仍有效 |
| ExplorationSourceApplicability | purpose-readers/exploration-source.ts | 保留原完整探索摘要、链接/二进制语义 |
| source-applicability/verification-source-applicability | 对应用途适配器内部，来源捕获归本模块 | 与WorkGraph领域版本绑定分离后 |
| WORKSPACE_DENIED_PREFIXES/readSourceIdentity | 同名常量/函数 | 所有读取路径迁完，不留并行副本 |

SourceGraphContextCompiler 的 Run/Plan/baseline 资格及 Vault 保存归 WorkGraph，不随纯源读取迁入。exploration-tools.ts 的模型注册、Kernel 生命周期归 AgentRuntime，其源读取改调本 Port。

## 8. 真实装配与施工顺序

普通工作读取使用真实 RunRef/RoleBinding，不以邮箱参与关系为前置。来源当前性与权限版本不同：后者取自可信 Host 的实际 mount、私有路径及运行读取授予，不取源码 digest。Host 授权必须检查当前登记/停机状态；rootFor 只解析根，不能单独证明读取权限。

以下构造类型在access.ts与workspace-tools.ts导出，补足Host实际接线。WorkspaceReadAccess是本模块内部受限I/O能力，不是模型工具；其release释放适配器自己取得的资源，不声称Kernel Sandbox已有同名方法。

```ts
export type WorkspaceAuthorization = {
  subjectKey:string; permissionRevision:string;
  allowsRead(path:string):boolean;
};
export type WorkspaceHostBindings = {
  resolveRoot(workspace:WorkspaceRef):Promise<WorkspaceResult<{root:string;workspaceRevision:number}>>;
  authorize(ctx:CoreCallContext, workspace:WorkspaceRef):
    Promise<WorkspaceResult<WorkspaceAuthorization>>;
};
export interface WorkspaceReadAccess {
  readonly workspace:WorkspaceRef;
  readonly workspaceRevision:number;
  readonly workspaceIdentity:string;
  readonly authorization:WorkspaceAuthorization;
  listFiles(limit:number):Promise<{paths:string[];truncated:boolean}>;
  read(path:string,maxBytes:number):Promise<{content:string;revision:string;byteLength:number}>;
  sourceIdentity():Promise<{workspace:string;commit:string|null}>;
  release():Promise<void>;
}
// byteLength是原文件实际字节数，不是截断后content的UTF-8长度；按R2e.1冻结契约。
export interface WorkspaceAccessFactory {
  open(ctx:CoreCallContext,workspace:WorkspaceRef):
    Promise<WorkspaceResult<WorkspaceReadAccess>>;
}
export type WorkspaceLimits = {
  maxFileBytes:number;maxCaptureBytes:number;maxInventoryFiles:number;
  maxQueryResults:number;maxRetainedCaptures:number;
  maxRetainedBytes:number;idleExpiryMs:number;
  maxQueriesPerCapture:number;maxCursorsPerCapture:number;
};
export type WorkspaceToolsDependencies = {
  access:WorkspaceAccessFactory;now:()=>string;limits:WorkspaceLimits;
};
export type WorkspaceToolsHandle = {
  tools:WorkspaceToolsPort;
  close():Promise<void>;
};
export function createWorkspaceAccessFactory(bindings:WorkspaceHostBindings):WorkspaceAccessFactory;
export function createWorkspaceTools(deps:WorkspaceToolsDependencies):WorkspaceToolsHandle;
```

Host的resolveRoot查实际项目/工作区登记，不接受模型传来的绝对路径。authorize核对ctx.projectId、workspace及真实principal；work_run/query_run使用当前实际授予和用途，host使用真实用户/系统操作授权，不能仅凭kind=system放行。授权先于文件I/O；Sandbox仍执行拒绝前缀、路径/符号链接边界。allowsRead是该授权域的额外限制，与Sandbox取交集。

subjectKey由完整主体身份生成；permissionRevision来自实际政策版本或规范化实际授权内容，不能来自调用者任意字符串。每个请求与捕获最终核验重新open，重新resolveRoot和authorize，而非比较缓存ctx字段；registry不保存首轮ctx、signal或活动ReadAccess。ctx.signal只绑定本次open所得能力，不能让首次请求取消影响以后合法续页。Workspace revision取自可信Host记录，不信任调用方填写的数字。具体R2c子集、默认上限与Host真实接线见[任务书](../../tasks/R2c-capture-registry.md)。

Host只把handle.tools注入Workflow/WorkGraph/Runtime；handle.close只由组合根持有。关闭先停止新操作，再等在途操作结束或取消，释放捕获、provider和内部ReadAccess；业务调用者不能关闭共享资源。按工作区/授权域保留provider，不跨根合并同名路径。现有语言provider的可用性仍由真实安装/探测决定，缺失返回unsupported，不由配置声明伪造可用。

| 当前真实入口 | 新接线 | 验收 |
| --- | --- | --- |
| app/service.ts→SourceGraphContextCompiler→ProjectArchitectureSourceReader | WorkGraph捕获/映射→保存精确材料→使用前verify | 正式差异仍区分unknown与真实依赖 |
| worker-runtime/exploration-tools.ts的project_index/code_index/source_excerpt | AgentRuntime工具adapter→WorkspaceTools，旧响应先保留 | 真正模型工具能读源，不额外开Run/LLM |
| role/query/reviewer/verification的Source Port | 逐一换实现及路径，保留用途限制 | 原真实场景继续通过 |

顺序：R2a 迁所有权和消费者→R2b 分离 frozen provider→R2c 接真实 access/capture 与即时架构读取→R2d 模型冻结续页→后续 WorkGraph 持久材料与兼容退役。移动代码时同步实际 module-map；不把目标空目录提前当已实现。

## 9. 接手验收

现有测试入口包括 tests/data/{project-source-index,source-index,python-source-index,cpp-source-index,workspace-path-boundary}.test.ts、tests/control/source-architecture.test.ts、tests/app/exploration-tools.test.ts。按所改provider运行，不因文档变化跑全仓。

新增契约覆盖：捕获中变化、401+关系完整续读、同cursor重放、跨主体/query/config误用、过期/释放/重启、页间撤权、页间变更仍读同一历史材料且最终verify拒绝current、并发配置不串来源、局部失效和全量结果一致。

另核对未提交修改、HEAD/配置/依赖清单变化、链接竞态、容量及不支持语言。失败不生成空架构、不创建任务；业务不手工维护AST索引。

记录读取字节、捕获/关系提取次数、输出量，分清初始和最终核验。记录真实消费者退役清单，不以模块数证明端到端速度。

## 10. 已落地切片和未落地范围

现有 ProjectSourceIndex.architectureMaterials 已从逐页完整query改为一次inspect，公开query对完整结果展示分页。401条imports原三页产生6次捕获/3次关系提取，现为初始读取与核验两次捕获/1次提取。TS Language Service 原已复用未变脚本，不能说每页重建解析器。

结果在await核验前绑定来源，另一请求切config不污染sources。22项定向测试、类型和模块边界通过，见[实施证据](../../reviews/core-design-implementation-evidence.md)。生产代码净增4行，不声称全仓LOC下降。

后续已完成R2a目录与真实消费者迁移、R2b冻结分析与单服务复用、R2c真实Host授权/有界capture/游标/完整架构映射。R2c独立16文件/110项通过；R2d.1新project_source协议三页已验证2次捕获/1次imports，正式模型切换沿R2d.2/3串行实施。精确验收和后续补测状态见[批次证据](../../reviews/implementation-batches.md)。

完整target Port尚未交付：readWorkspace/compareWorkspace、paths/text新分支、Git历史、Python/C++冻结provider仍是后续范围；现有python_index/cpp_index是真实旧能力，不能当缺失算法重写。现有兼容project_index仍逐次核验。捕获是临时数据，持久材料由后续WorkGraph/RecordStore承担，不能宣称已建完整历史库。剩余差异与准确来源见[R2e能力调查](../../reviews/workspace-remaining-capabilities.md)。
