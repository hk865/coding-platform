# R2c：TypeScript 冻结捕获注册表与真实架构读取

状态：2026-09-23 已由本地 dsh 实现，主 Agent 独立验收通过：16文件/110测试、类型/模块边界/应用构建通过；范围及未支持项见 reviews/implementation-batches.md。本页为本批实际施工与验收依据，不代表整个WorkspaceTools或R2已完成。生产根 C=`/home/hyh001/projects/coding-platform/coding-platform`；当前设计根 N=`/home/hyh001/projects/coding-platform/docs/refactor`。

你是本地 dsh，负责本批代码；主 Agent 负责骨架和独立验收。先读 C/AGENTS.md、N/tasks/R2b-frozen-source-query.md、N/modules/core/workspace.md。本任务收窄到下面的实际接口，不提前实现完整 WorkspaceToolsPort、WorkGraph、模型工具新协议、Python/C++ 或 UI。

## 1. 本批完成结果

实现 TypeScript 的临时 capture 注册、冻结查询、完整材料导出、当前性核验、释放；使用真正的 Host 根/身份/授权。`app/service.ts → SourceGraphContextCompiler → ProjectArchitectureSourceReader` 真实使用新捕获能力。

- 初始 capture：初读 → 在同份输入完整分析 imports 一次 → 最终来源核验 → 发布句柄，共两次来源扫描。
- 之后 query/export/图映射：从冻结材料读取；每次核对当前身份、根绑定与授权，不扫描源码。
- verify：调用者明确要求当前性时，再读取真实来源；单独计成本。
- 即时兼容图链是 capture → captureArchitectureSource → release。它返回本次 verifiedAt 对应的材料，不再机械增加第三次源码扫描，不承诺未来未变。
- 原 `ProjectSourceIndex.query/architectureMaterials` 及现有 `project_index` wire 不变。R2d 才将模型分页接入新 capture/cursor；不能把新增内部能力说成所有模型分页已优化。

## 2. 文件和所有权

新增或修改范围（路径相对 C）：

| 文件 | 唯一责任 |
|---|---|
| `src/contracts/core/source.ts` | 本批真实使用的 SourceCaptureRef；不引入 Session/WorkGraph 记录 |
| `src/contracts/core/call-context.ts` | 主 Agent 已校正的真实 CoreCallContext/CorePrincipal；不要求普通读取先建立 participation |
| `src/core/workspace/ports.ts` | 本批 WorkspaceCapturePort 六方法及精确 DTO；暂不导出假完整实现 |
| `src/core/workspace/access.ts` | Host bindings→每次请求的 WorkspaceReadAccess，Sandbox、拒绝前缀与路径交集 |
| `src/core/workspace/capture.ts` | registry、捕获/核验/导出/释放、容量/TTL/活动读者、provider 生命周期 |
| `src/core/workspace/source-query.ts` | 冻结查询和有界 cursor；转换 TS 结果，不重新实现 TS 解析 |
| `src/core/workspace/workspace-tools.ts` | createWorkspaceTools 组合上述能力，返回 tools+close |
| `src/core/workspace/architecture-source.ts` | 抽取现有完整材料→ArchitectureSourceSnapshotV1 的共同映射函数；原 helper 继续消费它 |
| `src/core/workspace/source-workspace-reader.ts` | ProjectArchitectureSourceReader 绑定可信 ctx+共享 tools，适配旧 ArchitectureSourceCapturePort |
| `src/app/source-capture-access.ts` | 实际 ledger/mount/role/read 授权桥；不把此逻辑搬进 core |
| `src/data/context-compiler/source-graph-context.ts` | 现有领域 guard 后选择由 Host 绑定的 reader；原 Plan/baseline/Vault 逻辑不动 |
| `src/app/service.ts`、`src/app/server.ts` | Host 共享捕获服务、真实 root/权限来源、关闭接线 |
| `src/app/workspace-tools.ts` | 从现有 mounts/privatePaths 暴露受信 sourcePolicyFor；保留文件/PTY 职责 |
| `tests/contracts/module-ownership.test.ts` | 仅按新增真实文件更新精确清单 |

R2b 的 snapshot/analyzer 为唯一读取/解析实现。可增加其必要有界结果/容量参数，必须在读取/收集过程中限制工作量而非无界收集后只裁剪响应；旧调用默认行为和原回执不变，不复制一套捕获或 TS AST 算法。核心不得 import Ledger、Control、ContextCompiler、未来 WorkGraph 或 Host。

## 3. 公共接口仅发布本批子集

`ports.ts` 导出 `WorkspaceCapturePort`，不是宣称已实现 readWorkspace/compareWorkspace 的完整 WorkspaceToolsPort。方法名和 DTO 字段沿用 N/modules/core/workspace.md；以后扩充同一实现，不另造第二套同义服务。

```ts
export interface WorkspaceCapturePort {
  captureSourceChanges(ctx: CoreCallContext, input: CaptureSourceRequest):
    Promise<WorkspaceResult<CaptureSummary>>;
  querySource(ctx: CoreCallContext, input: SourcePageRequest):
    Promise<WorkspaceResult<SourcePage>>;
  exportCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<SourceCaptureMaterial>>;
  verifyCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<{ capture: SourceCaptureRef; verifiedAt: string }>>;
  releaseCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<{ released: boolean }>>;
  captureArchitectureSource(ctx: CoreCallContext, input: {
    capture: SourceCaptureRef; mappings: ArchitectureSourceMapping[];
  }): Promise<WorkspaceResult<ArchitectureSourceSnapshotV1>>;
}
export type WorkspaceToolsHandle = {
  tools: WorkspaceCapturePort;
  close(): Promise<void>;
};
export function createWorkspaceTools(deps: WorkspaceToolsDependencies): WorkspaceToolsHandle;
```

本批的 CaptureSourceRequest 使用同一字段：workspace、workspaceRevision、provider、configPath?、prefix?、previous?、changedPaths?。仅支持 provider=typescript；其他 provider 返回 unsupported。prefix 是结果范围提示，不减少配置/允许依赖的读取；明确路径必须规范且符合权限。

querySource 首批支持 symbols/definitions/references/imports/calls；paths/text 返回 unsupported，不伪装空结果。所有结果、source位置、coverage、错误、取消类型用模块页精确字段，不引入 any/空 object/Promise<unknown>。保留一基行/UTF-16列。

SourceCaptureRef 是 `{projectId,workspaceId,captureId,workspaceRevision,sourceDigest,configDigest,indexVersion}`，无 ArtifactRef。captureId 使用不可猜测随机 ID；后续操作核对完整引用，不能仅按 captureId 忽略调用方改过的 digest/scope。capture 进程重启后失效，不落库，不自己产生历史 Artifact。

当前共同 work_run 身份使用真实 `runRef:RunRef`、`roleBinding:RoleBindingRefV1`，协作 `agentPrincipal` 只在已有真实参与关系时可选；不合成 ActorRef.agent/AgentInstance。具体共用类型以主 Agent 本批冻结的 CONTRACTS 修订为准，别复制旧“所有读取必须有 AgentPrincipal”的定义。

## 4. Host 与访问能力：每次请求重新取得，不缓存首次 ctx

以下可信 revision 与每请求 fresh access 字段已由主 Agent 确认；Host私有路径桥按同事的实际装配核对合并，不存在 system 无条件放行回退。

```ts
export type WorkspaceAuthorization = {
  subjectKey: string; permissionRevision: string;
  allowsRead(path: string): boolean;
};
export type WorkspaceHostBindings = {
  resolveRoot(workspace: WorkspaceRef): Promise<WorkspaceResult<{
    root: string; workspaceRevision: number;
  }>>;
  authorize(ctx: CoreCallContext, workspace: WorkspaceRef):
    Promise<WorkspaceResult<WorkspaceAuthorization>>;
};
export interface WorkspaceReadAccess {
  readonly workspace: WorkspaceRef;
  readonly workspaceRevision: number; // Host 从实际 Workspace 记录返回
  readonly workspaceIdentity: string; // 规范真实根/已绑定根身份
  readonly authorization: WorkspaceAuthorization;
  listFiles(limit: number): Promise<{ paths: string[]; truncated: boolean }>;
  read(path: string, maxBytes: number): Promise<{ content: string; revision: string }>;
  sourceIdentity(): Promise<{ workspace: string; commit: string | null }>;
  release(): Promise<void>;
}
export interface WorkspaceAccessFactory {
  open(ctx: CoreCallContext, workspace: WorkspaceRef):
    Promise<WorkspaceResult<WorkspaceReadAccess>>;
}
export function createWorkspaceAccessFactory(bindings: WorkspaceHostBindings): WorkspaceAccessFactory;
export type WorkspaceToolsDependencies = {
  access: WorkspaceAccessFactory; now: () => string; limits: WorkspaceCaptureLimits;
};
```

本批通过每请求 `open(ctx,workspace)` 重新 resolveRoot+authorize；不调用无 ctx 的旧 revalidate，也不把首轮 ctx/signal/access 存入 registry。初始 capture 的最终核验再取得 fresh access，确保捕获途中 root/授权变化不会被旧闭包掩盖。一次请求最后释放该次 access；release 是本适配器资源释放，不声称 Kernel Sandbox 有同名方法。

Host 桥要求：

1. root 从当前 mount/project/workspace 登记查找；不存在、Host stopping、根变成越界/无效必须拒绝，不接受模型指定绝对根。
2. work_run 重读真实 Run，核对 project/workspace、精确 roleBinding、envelope 中 read 和实际来源读取政策。sourceForReader 接到的对象只提供身份，不直接充当许可。没有参与关系不是拒绝普通读取的理由。
3. subjectKey 来自完整真实身份；permissionRevision 来自规范化的当前权限/政策/角色/根授权域。不能用 sourceDigest、时间或模型参数当权限版本。
4. 保留 Host 当前 privatePaths/根约束以及 WorkspaceSandbox 拒绝前缀/链接边界；若需 server 传入专用只读授权能力就显式接线，不能凭旧 rootFor 已存在便绕过额外私有目录政策。
5. capture 请求的 workspaceRevision 与当次可信记录比较；后续 verify 同样核对。旧捕获历史查询不因文件内容/登记revision前进就换成新来源；它仍必须有相同主体、根绑定和读取权限。
6. 生产 R2c 桥只接入已有 work_run 图读取。host/query_run 仅在有本次真实授予适配时启用；未接线时明确 unsupported/forbidden，不根据 kind 分配权限。测试可以提供独立可信 bindings 来核对不同主体/撤权。

### 4.1 冻结的 Host 精确接线

- `src/app/workspace-tools.ts` 保留现有文件/PTY 服务，不迁入核心。为已有 mounts/privatePaths 增加窄的受信 `sourcePolicyFor(projectId,workspaceId)` 能力，返回真实 root、规范政策版本与相对路径允许判据；未知 scope/关闭拒绝。复用已 realpath 的私有路径和登记，不另读凭据文件，不返回全部私有配置给模型。链接仍由 Kernel Sandbox 严格拒绝。
- `src/app/server.ts` 将这一能力传入 `RealOptions`。它仅在绑定的服务生命周期内有效；现有 server 停止接收新 HTTP 的流程保持。不要重新建立一套 HTTP token 机制。
- `src/app/service.ts` 通过新 `source-capture-access.ts` 构造 Host bindings；该桥注入 `ledger:()=>h.ledger`、`sourcePolicyFor` 和停止信号。读取当前 Workspace/Run/envelope，核对 scope、role、read 授予；返回当前真实 Workspace revision，permissionRevision 由真实 role/read授予和规范mount/private政策内容共同计算，不包含文件digest或内容revision。
- 为原本只注入 rootFor 的非架构测试/嵌入消费者保持 RealOptions.sourcePolicyFor 可选，但缺少它时新的真实架构来源返回 unavailable，不能退回无身份rootFor路径。正式 server 必须注入它。迁移直接使用该reader的测试fixture到显式可信bindings，旧上下游行为断言保留。
- `SourceGraphContextCompiler` 支持 `source` 与 `sourceForReader` 排他联合；旧 source 只供尚未迁的明确测试/适配消费者，正式 Host 走新工厂，失败不能fallback。
- 初始化时新handle可以捕获lazy ledger闭包，但初始化失败必须close；关闭先拒绝新调用、取消并等待capture退场，再关闭ledger。保留旧Host其它关闭顺序及Runtime生命周期。

## 5. 捕获、摘要、完整材料与图兼容

captureSourceChanges：

1. 校验 scope/provider/config/prefix/expected workspaceRevision，fresh open；无权限前不得枚举源文件。
2. 使用 R2b captureProjectSource 得到所有允许的输入及 manifest；完整性/容量/二进制失败不发布句柄。
3. 使用 R2b TypeScriptSourceAnalyzer 对完整配置分析 imports 一次。保留完整 indexedSources/imports 与诊断；不从显示 sources 前200项建图，不调用 query() 的分页循环。
4. fresh open 核对主体/权限版本、规范根和登记版本没有变；再 captureProjectSource，manifest/身份不一致返回 source_stale。
5. 在最后取消检查后原子登记 entry；尚未登记失败须释放 provider/access/临时内存，不留半成品 capture。

SourceCaptureRef.sourceDigest 保留 R2b capture.snapshot，即原 provenance.manifestDigest；indexVersion 保留原 `typescript-language-service@<ts.version>`。旧 ProjectSourceIndex 的 query snapshot hash（requested config/prefix）保持原样，不改成 captureId。

新的 configDigest 固定为 canonicalJson 后的SHA256：requestedConfigPath（null表示默认）、resolvedConfigPath、捕获内全部 JSON配置/依赖声明的有序 path+digest、provider/indexVersion、规范 capture prefix。它用于绑定捕获的配置范围，不替代 sourceDigest 或 permissionRevision。

CaptureSummary.changes：有 previous 时比较两个仍有效、同 scope/主体/授权域且兼容 provider 的冻结文件清单；没有 previous 时 added 为当前文件清单、modified/deleted 为空。previous 已过期则明确 capture_expired，不偷偷以“当前 provider 上次恰好分析过的项目”当基准。changedPaths 只是提示，本批不能省掉完整来源核验。

exportCapture 返回冻结文件 manifest、imports 关系和诊断，不读取磁盘；不声称包含源码完整正文或完整运行时调用图。R2b 若只保留前30条diagnostics，则必须保留明确 diagnosticsTruncated 标记（在新 SourceCaptureMaterial 做加法字段），不能称全量诊断。文件/关系的容量超限明确 capacity，不能用第一页假装完整。

architecture-source.ts 抽出共同纯映射函数供旧 helper 与新 Port 使用。新 Port 从 registry 完整 material 取 indexedSources/imports，维持旧映射、节点/边排序、unresolved、sourceDigest、commitHash、configPath、indexVersion、schemaVersion=1 以及容量；不把 captureId/TTL 塞进旧图导致 digest 改变。实际源码环照实保存。

captureArchitectureSource 只 fresh authorize + 冻结映射，不再扫描源码、不再次分析imports。它是“该已核验捕获的图”，不是一个未来仍当前的保证。

## 6. registry、TTL、容量与 cursor

Entry 最少保存：完整ref、subjectKey、permissionRevision、规范root identity、冻结snapshot、一次imports分析材料、查询缓存、创建/核验时间、lastUsedAt/到期时间、逻辑字节计费、活动读者计数与released状态。不保存请求ctx/signal/活动ReadAccess。

WorkspaceToolsDependencies：access、可注入ISO时间函数now、limits；WorkspaceCaptureLimits在本模块定义。包含模块页 maxFileBytes/maxCaptureBytes/maxInventoryFiles/maxQueryResults/maxRetainedCaptures/maxRetainedBytes/idleExpiryMs，另有 maxQueriesPerCapture/maxCursorsPerCapture。默认值依次为 2 MiB、128 MiB、60000、10000、8、256 MiB、300000 ms、16、1024。所有配置需正有限安全整数且不高于既有来源硬上限（2 MiB/128 MiB/60000）。测试可注入更小值；配置由 Host 决定，模型不可改。

- retained bytes 至少计冻结正文UTF-8字节、manifest、所有已缓存结果/诊断和cursor元数据；说明这是保留材料的逻辑计费，不宣称精确 JS 堆内存。缓存新项超过容量返回 capacity；不要先无限缓存再只限制输出页。
- 新capture先回收已过期且无活动读者的entry；非过期数据不被静默改写或以新来源替换。容量仍不足就拒绝，允许调用方明确release。
- 每次成功使用更新 idle 到期时间；CaptureSummary.expiresAt 是返回该摘要时的当前到期时间，不是永久固定租约。失败/越权请求不续期。时间通过注入 now 验证，不在测试里长sleep。
- release 标记句柄不再接受新读；已有在途读结束后物理回收。跨主体不能释放；已合法释放的同ref在有界 tombstone 仍存在时重放返回 released=false，进程重启/未知句柄是capture_expired。tombstone 只保留完整ref、授权域与原到期时间，数量最多 2×maxRetainedCaptures，计入逻辑字节上限；超期/最旧淘汰后按未知句柄处理，不无限累积释放历史，不占有效capture数量。释放墓碑仅在原到期时间和有界容量内保留，用于区分重放；不无限保存已释放句柄。
- query/export/图映射每次fresh open后核对原主体、权限revision、规范根；权限变了整份拒绝，不能只过滤结果路径继续暴露旧语义推导。
- 文件页间改变时仍可读原冻结历史；SourcePage必须标 captured_source/not_rechecked。verify失败不把原capture改成新内容。
- provider 的复用范围限工作区+授权域；捕获/操作都不再引用该provider时可dispose。关闭/过期回收不能留下无限积累的各工作区service。

cursor 是registry内随机、不透明token；记录captureId、完整查询规范摘要、subject/permission版本、稳定排序版本、下一offset、到期。不得接受用户猜的offset直接定位别人的capture。绑定限当前entry，不跨capture/config/主体。

首次query(cursor=null)产生规范查询的完整有界结果并缓存；imports从初次capture的完整imports筛选，不能重新遍历。definitions/references/symbols/calls使用同份冻结snapshot的R2b analyzer；配置固定为capture配置，返回前不读磁盘。相同查询后续页只切缓存。超过maxQueryResults返回capacity，不能成功截断后声称complete。paths/text等未支持操作返回unsupported。

同cursor+同limit重放同一页；limit仅改页大小，不改变来源或排序。nextCursor=null 与 complete=true一致。替换query、capture或主体返回cursor_mismatch/forbidden；坏limit/非法路径返回invalid。固定查询/offset的下一token复用，不因重放无限创建cursor；cursor有效期从所属entry当前idle期限解释，不维护一个与entry续期矛盾的独立旧期限。异常不消耗旧cursor。

关闭：先标stopping拒绝新操作，触发本服务生命周期取消、等待在途操作退场，然后清理registry/provider。与每次ctx.signal组合而不覆盖调用者signal；不能借全局共享controller让取消一个请求打断其他请求。

## 7. 真实架构读取接线

保留 ArchitectureSourceCapturePort.capture 的旧请求/响应；改变真实实现的构造方式，不给仅有scope的请求自动套system许可。

```ts
export type ArchitectureReaderIdentity = {
  runRef: RunRef; roleBinding: RoleBindingRefV1; workspace: WorkspaceRef;
};
// SourceGraph deps 可短期保留旧 source 或新 sourceForReader 的排他联合，不能两者同时有值。
sourceForReader(reader: ArchitectureReaderIdentity): ArchitectureSourceCapturePort;

// core/workspace 的reader只见可信上下文和窄Port，不见ledger。
new ProjectArchitectureSourceReader({ tools: workspaceHandle.tools, context: trustedContext });
```

SourceGraphContextCompiler.read 完成原 Run/envelope/read、Plan/baseline/sourceBinding、Workspace revision guard 后，由已加载 run.ref/run.roleBinding 和实际 WorkspaceRef 调用 sourceForReader。原请求不允许再传一个更宽的读者身份。Host工厂构造ctx：project/workspace、work_run真实身份、materialReader为同一个run、当前Host生命周期signal。没有每HTTP请求signal的旧链路不要谎称已接取消；新Port独立支持真实ctx.signal。

ProjectArchitectureSourceReader.capture 顺序：检查request与已绑定context scope一致 → captureSourceChanges(provider=typescript) → captureArchitectureSource(完整ref,mappings) → 返回旧graph。finally best-effort release；原signal已取消时，释放使用相同principal/scope的独立cleanup signal，仍fresh authorize，不扩大权限。Host已stopping/授权撤销时不继续读取，release失败交TTL/Host close清理。

共享workspaceHandle在createScopedGuiService中创建，由该Host持有；正常close及初始化失败关闭它，在ledger关闭前取消/清理相关capture请求。模型/业务调用者只得到tools，不能关闭共享服务。

不要把原 SourceGraph 的正式领域guard或Vault保存迁入core。旧 `workspaceProjectIndex(root)` 是低层只读工厂，保留给现有明确消费者；真实Host的ProjectArchitectureSourceReader不得保留 rootFor-only 无身份回退。更新涉及该reader构造的真实测试fixture，不改变原graph行为断言。

## 8. 失败与外部验收测点

错误按WorkspaceResult分类：invalid/forbidden/not_found/source_stale/capture_expired/cursor_mismatch/capacity/unsupported/unavailable/cancelled。保留内部具体reason。无解析器/取消/读取失败不得变成成功空图。

主 Agent 独立测试（dsh 不得修改主 Agent 指定的新增测试）：

1. 401+imports：capture两次源码观察、imports一次分析；三页query、export与架构图不增加源读取，完整末项存在。真实reader链也保持两次，不通过公开query拼图。
2. 已知目标scope但无真实授权：authorize拒绝且源read/inventory次数为0；造system/假的RunRef不获得能力；无participation的真实普通Run能按实际read授予读取。
3. cursor同页重放、不同limit、末页complete；跨query/capture/project/workspace/主体误用拒绝；完整ref被改digest/config/version不能混用。
4. 捕获时变动内容/清单/HEAD/config/授权/root/登记revision均不发布成功；读取故障和容量保留区别。
5. 页间外部内容变化：旧冻结页保持不变；显式verify返回source_stale；新capture得到新结果。页间撤权或root重绑定：旧捕获query/export/map全部拒绝，不泄露旧缓存。
6. 首次ctx取消后，使用另一合法未取消ctx读取已经成功创建的capture不受旧signal影响；取消一个请求不影响同域另一请求。未成功发布的取消不占永久容量。
7. TTL使用注入时钟；成功读延长idle，越权不延长；release重放、活动读者延迟回收、过期/重启失效、count/bytes/query/cursor容量均有清楚结果。
8. S1/S2/config并发不串来源；不同工作区同名文件不共享材料；TS service复用不把撤权输入留在可读缓存。
9. 新图snapshot与旧helper同输入逐字段/字节摘要一致；unresolved、映射容量、真实环不改变。旧ProjectSourceIndex与source-architecture回归全部通过。
10. 真实Host sourceForReader已接线；使用真实ledger/Run/Workspace夹具核对read撤销/role不符/停止/root非法；不能只测试一个手写始终allow的factory。
11. service.close后拒绝新请求并清理捕获；初始化失败也清理；无core→Host/Ledger/WG依赖。

最小验证：新增capture/access/Host桥测试、原snapshot/analyzer/project-source-index/source-architecture/实际exploration-tools、模块归属、typecheck、check:architecture、app编译。按本批变动执行，不跑全仓/UI/真实模型调用。记录捕获次数、关系分析次数和读取字节，公开分页尚未接线要明确。

## 9. 完成报告与禁止范围

报告实际文件、捕获/授权/图调用链、已有算法复用位置、旧路径处置、独立检查命令与结果、资源上限及未支持能力。SourceCaptureRef是临时材料；不创建Artifact/Task/Session，不改旧磁盘格式，不新增依赖/下载，不修改Python/Cpp/Kernel/模型wire/UI。保留所有用户和前批改动，不reset/restore/clean/stash/commit/push。

共享 CoreCallContext 已同步正式 CONTRACTS，以下 Host 桥也已冻结；源码与设计存在具体矛盾时回报，不得伪造授权通过。
