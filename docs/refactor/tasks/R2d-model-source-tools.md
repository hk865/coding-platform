# R2d：模型工具冻结分页与资源归属

状态：2026-09-23 主 Agent 已选定方案 A，并分成下列三个串行子批。R2c与R2d.1已独立验收；R2d.2已派发实施，R2d.3尚未实施。本页是整体骨架；每个子批的独立测试和变动清单冻结后再给 dsh，不能一次自由实施全页。

C=`/home/hyh001/projects/coding-platform/coding-platform`；N=`/home/hyh001/projects/coding-platform/docs/refactor`。下列源码路径相对 C。前置任务为 N/tasks/R2c-capture-registry.md。

## 0. 已确定的选择与串行拆分

- 新协议采用方案 A：`project_source` 四动作。旧 `project_index` 的实时语义保持；新旧工具不同时出现在正式模型清单中。
- Query 发起者在本次执行绑定时从精确匹配的 `QueryJobSubmitted` 事件读取一次；后续页仅重核当前 Query/Job 及政策。若未来有同等可信的原受理能力可直接注入，必须另有精确绑定测试，不能填固定 system 身份。
- 旧 wire 本批保留为明确兼容入口；所有正式 Work/explore/Reviewer/Query 入口都要退出旧工具后才能称 R2d 完成。最后受支持的兼容调用迁走时删除，不因为历史日志存在而永久加载旧注册器。
- **R2d.1 工具协议与释放骨架：** 新模型工具、精确 schema、ExplorationToolsHandle、ObservedModel 的资源 try/finally。此时允许尚未迁的正式装配显式仍选旧模式，不宣称生产切换完成。缺新工厂/工厂失败不能自动回落；已有旧调用用法的兼容是调用者主动配置。
- **R2d.2 Work/explore/Reviewer 正式接线：** 用真实 Run、角色和 Reviewer 范围绑定捕获服务，实际 enabledNames 退出旧工具；保持现行守卫，并记录其额外来源读取。
- **[R2d.3 Query 接线与退出核对](R2d-3-query-source-binding.md)：** 真 QueryRun、原发起者、精确执行请求及当前意图授权；同批完成四种执行路径的消费者清单与旧资源退出核对。

这三个子批共用一套端口/协议，不是三个并行实现。R2d.1 的临时状态必须被 R2d.2/3 明确消除，不发布“新增工具即可算全部完成”的结论。

## 1. 结论与最小范围

新增一个 `project_source` 工具，明确提供 capture/query/verify/release 四类动作；显式兼容入口保留 `project_index` 原协议。正式 Host 的正常 Work、explore、Reviewer、真实 Query 模型工具清单改用新工具，并移除旧 project_index 的启用，不让生产模型长期自行在两套分页间选择。未提供可信工厂的嵌入消费者只能使用明确标注的旧兼容模式；正式 Host 不能因绑定失败自动回退。

本批的性能成果是：同一次 TS 捕获初读、最终核验共两次来源观察；其后多页 query 只切冻结结果，权限检查仍每次执行；显式 verify 另计一次当前来源读取。Reviewer 原有当前材料守卫仍可能每页扫描来源，必须分开报告，不能声称所有模型链零重复 I/O。

不改 Session/WorkGraph/Kernel、不新建模型日志或持久捕获表、不改 Python/Cpp wire/算法、不修改正式验收语义。模型工具只暴露上述四动作，exportCapture 和 captureArchitectureSource 继续给可信内部调用者；不要把整份源码材料默认输出给模型。

## 2. 已核对的真实入口与身份

| 入口 | 当前真实身份与范围 | 工具与资源事实 |
|---|---|---|
| `execution/worker-runtime/observed-model-run.ts:36–99` | 当前 Options 只有 root/sessionId，不含平台 RunRef。是共享执行循环，不能假定所有调用是普通 Run | :68 定义允许的读工具名；:85 是唯一生产 createExplorationTools 调用；目前直接 return Kernel promise，没有扩展工具 finally |
| `execution/worker-runtime/coding-agent-runtime.ts:128–157,287–308` | 已验证 TaskEnvelope 的真 `runRef`、project/workspace、roleBinding、permissions、workspaceSnapshot；普通 Work 和 explore 都有真实 Run | `RuntimeContextAccess` 已通过正式租约适配器传入；:304 Reviewer 附加路径政策和当前性断言 |
| `control/dispatch-engine/leased-worker-runtime.ts:35–86` | 使用 spec+envelope，先领取读/写租约，再组装材料/Reviewer/协调能力，最后 runtime.start | 最小的 Work 工厂传递位置；不能在这里提前分配长期 registry 后忘记处理 start 拒绝 |
| `execution/worker-runtime/read-only-query-runtime.ts:97–130,135–203` | startQuery 的 request.runRef 是真 QueryRunRef；材料来自已持久化 running 的 QueryJob/QueryRun；执行 role 在 QueryJob.intent.execution 中 | :155 调 runObservedModel；:74 close 取消 active 并等待 starting；:78 cancelQuery 等待对应 active。持久 record.roleBinding 类型是 unknown，不能当可信角色强转 |
| `data/context-compiler/query-execution-context.ts:61–96` | 读取 QueryRun、QueryJob，验证 running、问题与 exact Run，再读取被授权 bundle；意图 execution 提供真实 RoleBinding | 新捕获授权应复用这些事实，不能从任意 input JSON 读出身份；普通无 execution 的旧 Query 当前真实材料入口已拒绝，不应本批伪造角色补齐 |
| `app/service.ts:141–160` | Host 有 lazy ledger、真实 root/policy、LeasedWorkerRuntime 与 ReadOnlyQueryRuntime 构造点 | 注入 R2c Host bridge 构造的工厂；WorkerRuntime 和 core 不读取 Host 私有配置 |
| `vendor/coding-agent/src/app/composition/composition-root.ts:123–137,327–329` | Kernel 自身 ID 不等于平台 RunRef | additionalTools 同步调用，当前每轮一次；其创建在 Kernel 自身 Store try/finally 之前。Kernel finally 只关闭自身 Store，不会 dispose 平台额外工具 |

`RuntimeRecord.sessionId`、QueryRuntimeRecord.sessionId、Kernel tool call.runId 均不能用来合成平台 RunRef/QueryRunRef。Reviewer 的主体是 reviewerRunRef，不是 producerRunRef；不要求协作 AgentPrincipal 才能读取。

## 3. 为什么不能直接把原 offset 分页改成缓存

原 `ProjectSourceIndex.query` 的语义保持：

1. 每次查询重新 capture 当前清单/源码/HEAD、分析、capture 核验；expectedSnapshot 不是缓存定位 token。
2. snapshot 仍是 `sha256({sources:manifestDigest,config:requestedConfigPath|null,prefix:null|prefix})`。同 snapshot 表示本次重读仍匹配，不代表保留着某个捕获。
3. offset 可任意非负整数；limit 1–200；每次 changes 相对该 index 上次 installed 输入，失败配置等已有基线行为也属于兼容语义。
4. 页间源码改变会返回 stale（传了 expectedSnapshot），而新的冻结 query 允许继续读取被授权的旧材料并标 not_rechecked。

因此不能把 expectedSnapshot 当 captureId、把 offset 偷换成 cursor，不能返回旧捕获却继续宣称本次当前源码核验成功。只在旧入口中缓存 AST/query 并每页 verify 可以减少分析，仍需当前来源扫描，达不到本批真正消除分页重复捕获的目标。

## 4. 协议选择依据（已采用 A）

| 方案 | 行为 | 取舍 |
|---|---|---|
| A：独立 `project_source`（推荐） | 旧 `project_index` schema/响应完整保留；新名字下严格 action 联合，使用 R2c refs/cursor/coverage | 新增一个工具名，协议最清楚，历史调用回放与测试隔离直接；工具说明明确分页优先新入口 |
| B：扩展 `project_index` 为版本联合 | 无 protocol 字段精确保留旧 schema；显式 `protocol:2` 才进入 capture/query/verify/release；v2 用新 DTO | 工具名字不增加，但 schema 更大，容易混传 offset/expectedSnapshot 与 cursor，测试和工具说明须覆盖两个分支；不允许“未写版本默认冻结” |

两者都必须更新 enabledNames/实际注册工具保持一致；两者都不能把旧 changes 直接替换成新 CaptureSummary.changes。推荐 A 的新 changes 是“相对显式 previous 捕获”；未提供 previous 时全部当前输入是 added。不要人为让后续页变化数清零，也不要用 analyzer 恰好上次处理的项目当新工具基线。

### 4.1 旧生产路径退出，不保留两套同时启用的分页

R2d 的完成条件不是“工具列表多一个名字”。Host 正式装配的 runObservedModel 在 read 权限下启用 project_source，**不再启用 project_index**；createExplorationTools 在该模式也不构造旧 ProjectSourceIndex，避免只有名字隐藏而旧资源仍占用。旧直接工具 fixture/明确嵌入兼容调用使用单独的受信 legacy 模式，模型参数不能切换模式。正式模式缺可信工厂返回配置 unavailable，不能自动开启legacy工具。其他 code_index/python_index/cpp_index 不受这次 TS project 分页退出影响。

现有日志中的 project_index 调用和旧持久报告继续按原格式读，不重新执行；历史工具定义不必为了读日志常驻于新模型清单。模型系统说明/工具说明中关于 expectedSnapshot 分页的默认指引随生产入口一起换成新流程。

验收必须列出四类真实路径（ordinary/explore/review/query）各自的 enabledNames，证明均已退出旧 project_index，并通过源码调用清单确认旧 ProjectSourceIndex 的剩余消费者仅为明确兼容/独立测试以及 R2c 尚保留的低层兼容 helper。不得把“仍有真实消费者”改写成“兼容所以不处理”。若某个实际生产消费尚不能迁，记录准确消费者和阻断条件，该子路径不计R2d完成。

旧wire定义删除的条件：受支持的嵌入调用方完成新协议迁移、原wire对照样本归档、没有真实执行消费者；随后删除runtime旧注册分支和仅服务旧wire的说明。保留代码类作独立对照测试与长期同时开放两种生产编排无关，不能拿前者作为后者的理由。本批必须完成生产退出；完整删除兼容API须由主Agent按已有兼容承诺另行确认，不伪称删类是本批性能收益。

## 5. 已选方案 A 的精确模型输入/输出

新 `project_source` 为 read_only、requiredCapabilities=[workspace_read]，超时/输出上限沿现有 project_index 60s/64KiB；工具适配器继续执行 <=60KiB 的结果检查。不得放入 root、principal、role、workspaceRevision 或身份覆盖字段。

```ts
type ProjectSourceToolInput =
  | { action: 'capture'; configPath?: string; prefix?: string;
      previous?: SourceCaptureRef }
  | { action: 'query'; capture: SourceCaptureRef;
      query: Extract<SourceQuery, { kind: 'symbols' | 'definitions' | 'references' | 'imports' | 'calls' }>;
      cursor: string | null; limit: number }
  | { action: 'verify'; capture: SourceCaptureRef }
  | { action: 'release'; capture: SourceCaptureRef };
```

每个 action 用严格 schema；ref 每个字段校验；query.limit=1..200，默认100。definitions/references 保留一基 UTF-16 坐标且 path 必填；`symbols/imports/calls` 的 path/prefix 仍只缩显示查询范围。capture.provider 固定 typescript。配置变化必须新 capture，不在 query 重新选择 config。

适配输出保留 `WorkspaceResult` 对应成功/拒绝分支，不伪装成 ProjectSourcePage。capture/query的模型元数据按[R2d.1精确骨架](R2d-1-tool-protocol.md)映射：changes三种清单与coverage.unresolved均返回精确count、最多5项/每项160Unicode码点的sample和明确truncated；核心完整材料不变，真实items不裁剪。capture 返回 ref+capturedAt+verifiedAt+expiresAt+coverage+显式 changes；query 返回完整 ref、items、nextCursor、complete、captured_source/not_rechecked；verify 只说明 verifiedAt 时匹配，不把后续 query 变成永久 current；release 幂等语义来自 R2c。

完整 ref 中的 scope 可显示并回传，但不授权；必须与 Host 绑定主体/scope、entry 身份和完整引用逐项相符。query 与 capture 的路径须经核心授权过滤，不只依赖旧 wrapper 检查顶层 path——新 query.path 是嵌套字段。

完成上述有界元数据映射后，若 capture 摘要或页仍超出模型输出上限，返回明确 capacity/输出过大，不能成功截掉引用、诊断完整性标记或部分 items 却保留原 nextCursor。capture 成功但输出失败时应 best-effort release 该次尚未交给模型的引用，避免占满直到 TTL；cursor 非消耗式，页过大后可同cursor用较小limit重试。

模型工具说明应给出固定用法：capture一次→以返回ref query(cursor=null)→原ref/同query传nextCursor→需要当前决定时verify，stale则重新capture→不再需要时release。旧 project_index 说明补“兼容实时查询，每页重读；多页 TS 检索优先 project_source”，保留旧行为。没有将来源验证等同于代码正确/验收通过。

## 6. 可信绑定与最小新增类型

推荐将下列运行期 capability 类型与当前 RuntimeContextAccess 相邻定义（或主 Agent 冻结的现有共享契约位置），只允许现有合法 ContextCompiler→WorkspaceTools 类型依赖；不要让 ContextCompiler import WorkerRuntime 实现，也不要为此让 core 反向依赖 Host。

```ts
type RuntimeSourceCaptureAccess = {
  port: WorkspaceCapturePort;
  workspace: WorkspaceRef;
  // 只组合已绑定的主体、scope、materialReader与当次signal；不充当授权。
  context(signal: AbortSignal): CoreCallContext;
  // 仅capture时读取当前真实Workspace记录，不能取Kernel字符串revision。
  currentWorkspaceRevision(signal: AbortSignal): Promise<WorkspaceResult<number>>;
  close(): Promise<void>;
};
type RuntimeSourceCaptureFactory =
  (runSignal: AbortSignal) => Promise<RuntimeSourceCaptureAccess>;
```

open 工厂返回**此模型循环独占**的 R2c createWorkspaceTools handle，复用同一 Host accessFactory/政策桥但不共享 registry 关闭权。Host 现有架构图共享handle仍由 service.close持有，不能被模型运行finally关闭。

绑定工厂与创建资源分离：LeasedWorkerRuntime 准备阶段只获得闭包，真实进入 runObservedModel 时才创建 handle；启动被拒绝/只回放已完成结果不会分配 registry。工厂若部分初始化失败必须自清理。

### 6.1 普通 Work / explore / Reviewer

- `LeasedWorkerRuntime.deps` 增可选 `sourceCapture(spec,envelope):RuntimeSourceCaptureFactory`；Host服务实际路径必须配置。准备成功后把闭包放进 RuntimeContextAccess.sourceCapture，再由 CodingAgentRuntime 传入 `ObservedModelRunOptions.projectSource={mode:'frozen',open:sourceCapture}`。
- 工厂绑定复制后的 envelope.runRef、roleBinding、project/workspace、真实 spec.root；R2c authorize 每请求重读 Run/envelope/read 授予、root/private policy；不能把复制的信封当永久许可。运行已结束/取消/Host关闭拒绝新页。
- context.principal={kind:work_run,runRef,roleBinding}；materialReader={kind:run,requester:runRef}；scope使用实际project/workspace。可选agentPrincipal只有真实现有授予才附，不把未参与当失败。
- currentWorkspaceRevision 每次 capture 从 Host 当前 Workspace记录读数值revision；工具请求不提供它。旧envelope revision继续由现有执行领域守卫处理；不是用 Kernel workspace.captureBaseline().revision 字符串强转。
- Reviewer 使用 reviewerRunRef/ReviewWork/profile的真实绑定。R2c authorization.allowsRead 还必须与 `reviewerSourcePathAllowed` 求交，permissionRevision包括这项受信政策和相应固定角色/审阅绑定；不能仅在模型参数外层做路径过滤，因为 imports解析会读取间接依赖。
- 保留 sourceTools.includeReadSource、allowedPath、assertReviewCurrent；原 read_source/material/模型前后守卫不移动。不以同一个producerRun有权读为理由扩大Reviewer范围。

### 6.2 QueryRun

`ReadOnlyQueryRuntime.deps` 增 `sourceCapture(request, root):RuntimeSourceCaptureFactory`（可异步绑定也可由工厂第一次open完成）。root 是本次实际交给 Kernel 的根，由 Runtime 可信回调传入并复制；每次 fresh policy.root 必须与之精确相等，不能另行解析两个当前根便假定同一工作树。由 app/service.ts 使用R2c Host桥组装，不改 startQuery wire。必须在 materials.assemble 返回 ready、当前请求对应真实执行绑定后使用；不能从 record.roleBinding:unknown 强转出许可。当前 assemble=ready 也不替代下面完整 run.execution.request 的重核。

每次核心 authorize 新增精确 query_run 分支：

1. 当前 QueryRun/QueryJob 都存在且 running、scope及job.runRef完全匹配；run.execution.request 与绑定的完整 request（runRef/bundleRef/question/budget）匹配，不用相同actor代替请求绑定。
2. 意图 execution 是现有已支持类型，使用其真实roleBinding与已经存在的只读工作区能力。新工具只属于既有read工具族，不授予协调写或Task权限。
3. 当前workspace登记/private policy有效；Host/运行取消信号未停止。permissionRevision绑定真实意图角色/只读政策、mount/private policy；不包含源码digest。
4. context.principal={kind:query_run,queryRunRef,initiator}，materialReader={kind:run,requester:queryRunRef}。QueryRunRef本来受ArtifactOwnerRunRef支持，不造普通Run/Task。

**发起者现状缺口要实际接线：** QueryJobSnapshot/QueryExecutionMaterial/QueryRuntimeRecord目前不保存发起actor；只有 QueryJobSubmittedEvent.actor。不能填固定local-gui，也不能把任意system常量当原始发起者。最小可行做法是Host在绑定此request时经现有StateLedger.events找一次完全匹配的QueryJobSubmitted事件，取真实human/system actor并复制保存到本次工厂；不存在/冲突/actor不受当前CorePrincipal支持则明确unavailable/forbidden。当前events只有afterCursor/limit，不支持aggregate筛选，因此该成本是一次启动时历史读取，必须报告；不得每页或每次authorize重扫。无需本批新增持久索引/改QueryJob磁盘格式。若主线程提供已核验的原受理actor能力，优先注入它并省掉这个查找；必须保留与canonical提交的精确对应，不扩大输入schema。

首次绑定只缓存immutable来源身份；每个新工具请求仍按上述四项load当前QueryRun/Job和政策，不能缓存running结果。历史持久结果直接重放时不创建新工具资源。Query sourceBefore/sourceAfter及答案发布stale检查保持，不因为冻结分页而省掉最终来源确认。

## 7. 资源生命周期：一个循环拥有并关闭自己的handle

把 createExplorationTools 返回值升级为 `ExplorationToolsHandle={tools:ToolDefinition[];close():Promise<void>}`。生产调用只有 observed-model-run.ts；直接fixture逐一改为使用handle.tools并在finally close。不要保留丢弃close的新生产包装器。

close 最少释放旧 ProjectSourceIndex.dispose、PythonSourceIndex.dispose、轻量syntax cache；SourceIndex目前每次查询内部finally dispose；CppSourceIndex目前只有前态Map，没有常驻句柄/close接口，不虚构其dispose。捕获服务由下面外层唯一关闭。关闭后旧tool handler也应拒绝新调用；在途请求结束或被本轮信号取消后才dispose。

建议 runObservedModel 的结构：

```ts
let source: RuntimeSourceCaptureAccess | undefined;
const owned: ExplorationToolsHandle[] = [];
try {
  // 保留原read权限判定；无read不调用source工厂，不注册新工具。
  if (hasRead && o.projectSource?.mode === 'frozen')
    source = await o.projectSource.open(o.signal);
  // 配置、工具注册、Kernel初始化均在该try覆盖内。
  return await o.kernel.runCodingAgent({
    ...existingOptions,
    additionalTools: workspace => {
      const h = createExplorationTools(workspace, {
        ...existingSourceOptions,
        projectSource: source ? { mode: 'frozen', access: source } : { mode: 'legacy_live' },
      });
      owned.push(h); // 必须在materialTools/coordinationTools可能抛错之前登记
      return [...h.tools, ...existingMaterialTools(), ...existingCoordinationTools()];
    },
  });
} finally {
  // 每个资源都尝试清理，某个失败不得阻止其他close。
  await closeAllOwned(owned, source);
}
```

- 必须 `return await`，不能 `return promise` 后finally先关闭仍运行的工具。
- factory/additionalTools/注册重复名/loadAppConfig/Kernel建库失败也覆盖；工厂自己抛错之前分配的资源由工厂清理。
- 工具ctx使用当次executionOptions.signal与runSignal、Host生命周期信号组合；registry不保存首次工具的signal。取消某个工具不关闭整轮source handle，运行取消才最终关闭。
- closeAllOwned尝试所有close并等待，幂等；主异常不能被首个清理异常覆盖或导致其余资源泄漏，清理异常走现有运行失败诊断而非发布额外业务成功。
- close registry使用R2c内部所有者close，可停止新操作、取消/等待在途、清理provider。它不是模型可调用的force-release，不需要绕授权逐一release已撤权capture。
- CodingAgentRuntime.close原有abort+等待active.done，以及Query close/cancel等待其done，可自然覆盖finally；不要另建后台不受等待控制的provider池。
- 正常结束、模型失败、工具错误致终止、超时、取消、证据保存失败、Host关闭、初始化中断都要走同一释放路径。仅单个工具失败而模型继续时保留本轮registry。

## 8. 扫描成本与当前性分别验收

| 链路 | 本批真实结果 |
|---|---|
| 普通Work/explore `project_source` | capture两次来源观察+imports一次；后续query/export内部零源码读取（只有权限/根检查）；新查询可分析冻结输入，但同查询分页不重复分析 |
| Query `project_source` | 同上；Query入口/出口的workspace.captureBaseline以及最终事实发布检查仍存在，不声称整轮仅两次读 |
| Reviewer `project_source` | project分页本身不重捕获，但exploration wrapper每次操作前后assertCurrent仍会进入ReviewerContextCompiler.current:64的source.capture，且前后resolveReviewRound；模型前后也有守卫 |
| 兼容 `project_index` | 保持每次capture→analyze→verify；不会因为新名字上线就自动加速历史调用 |

Reviewer守卫是否拆成“每页资格”和“正式发布当前性”是单独的业务语义变化，本批不执行。不能仅删除assertCurrent或用TTL当当前事实证明来让性能计数好看。验收分别记录core捕获次数、完整imports分析次数、Reviewer守卫capture次数、Query最终baseline次数。

### 8.1 Reviewer 重复成本的具体后续收敛条件

这里要区分**必要业务事实**和**重复获取实现**。必要的是：Reviewer确实读取被审阅轮次指定的来源；角色/材料授予未撤销；正式发布时本轮仍适用。并非天然要求同一页前后、模型前后、多层current调用都各自重新构建一套相同来源材料。

可按一个审阅轮次维护本地只读 `ReviewReadBasis`（不新增正式聚合），固定 workRef/workRevision、reviewerRunRef、producerRunRef/attempt、protocol绑定、profile配置、packet/input摘要、原grantRefs、materialIdentity、**原Reviewer sourcePin及其完整范围**、root身份、捕获时间。TypeScript SourceCaptureRef的范围/摘要与verification_workspace的sourcePin不同，不能相互代替。

允许局部复用的具体条件：

1. 本轮所有源码工具（read_source、search、symbols及新project_source，而非仅imports页）读取同一个已核验的不可变候选来源副本/材料；该副本覆盖Reviewer声明的全部可读范围和所需非TS文件、路径/符号链接排除规则。只冻结TS imports结果不足以证明整轮来源固定。
2. 每次读取仍轻量重查ReviewWork/protocol/profile/精确grant的现行资格、真实root/私有政策和取消；授权变化整份拒绝。相同grantRev只是授权依据，不证明live文件未改。
3. 同一scope/basis的在途重复来源获取可single-flight，同一正式检查内部的消费者传递其已核验结果；key包含完整basis/授权域，不能跨轮或跨主体命中。不能把一个长时间运行的旧promise当永久current缓存。
4. 若原业务仍要求“每次工具操作时live工作区也当前”，就必须保留该边界的真实来源核验；没有可信文件版本证明时，TTL、ledger workspaceRevision、读租约或文件watch都不能保证外部写入未发生。此时能省的是重复解析/构图和同一检查内重复capture，不能宣称零扫描。
5. 若业务明确把模型读取定义为“该固定审阅轮次的候选来源”，可在页上标清captured/pinned，轮内复用副本；在模型继续采用新的正式事实以及最终review结果受理前，统一核验live候选sourcePin与领域basis。变化则结果stale/拒绝，不能将对旧候选的结论自动授予新工作区。这个时点变化须单独冻结语义和对应验收，不能由R2d开发者顺手实施。

因此R2d保留现有guard，是本批范围边界；不把现有每层全量重捕获宣称为不可优化的架构必需行为。上述条件成立后，可把“来源材料采集”和“资格/正式适用性检查”分开，避免同一份材料多次生成，又保留明确的核验边界。

## 9. 最小文件/调用者清单

必改：

- `execution/worker-runtime/exploration-tools.ts`：handle返回、project_source严格schema与R2c调用；旧project_index语义保留。
- `execution/worker-runtime/observed-model-run.ts`：新增可信open工厂、读工具enabledNames同步、await/finally所有权。
- `execution/worker-runtime/coding-agent-runtime.ts`：传递已绑定工厂，保留Reviewer currentness/权限/协调关系。
- `execution/worker-runtime/read-only-query-runtime.ts`：deps工厂、Query真实请求传入、保持query终止和发布检查。
- `control/dispatch-engine/leased-worker-runtime.ts`、`data/context-compiler/runtime-context.ts`：传递可信闭包；不在Context正文持久化工厂，不在租约准备阶段创建registry。
- `app/source-capture-access.ts`（R2c落地文件）：支持query真实身份和Reviewer政策交集、创建每循环owned handle。`app/service.ts`真实注入两条链。
- 模块归属精确清单仅按真实新增文件更新；不扩大allowlist。

直接工厂消费者：`tests/app/exploration-tools.test.ts`、`tests/app/reviewer-source-tools.test.ts`、`tests/data/cpp-source-index.test.ts`。ObservedModel测试现有：`tests/runtime/query-response-guidance.test.ts`、`tests/runtime/reviewer-json-authorization.test.ts`、`tests/data/cpp-source-index.test.ts`。只迁返回handle用法/关闭，不删旧响应断言。

如果为schema内聚新增 `execution/worker-runtime/project-source-tool.ts` 可行，专门负责模型wire转换，不能复制registry/分页状态/AST算法。

## 10. 独立验收清单

1. 通过真实Kernel model stub连续调用capture、imports三页、verify、release：401+关系齐全。两次初始捕获，三页零额外provider读取/分析；verify单独增加来源核验。不能只直调core端口宣称wire已接。
2. 同一捕获同query/cursor重放稳定，其他capture/query/主体误用拒绝；输出太大缩小limit后可重试。未知action/混入旧expectedSnapshot/offset/身份字段严格拒绝。
3. 旧project_index全部JSON响应对照保留（除已独立确认的旧缓存bug修复）；页间源码变化时旧入口stale，新入口仍返回not_rechecked的旧页，verify stale；changes按两个协议分别断言。
4. 工具read权限缺席时既不创建handle也不注册新工具；假Run、scope不符、read撤销、root重绑定、私有路径政策改变拒绝并且不泄露缓存。
5. 普通无AgentPrincipal的真实Run可读；Reviewer使用自身Run且间接依赖也遵守candidate排除；Query使用真QueryRun、原始actor、exact执行request，不能以同一human身份跨query引用捕获。
6. Reviewer前后assertCurrent与Query最终sourceBefore/sourceAfter不被绕过；source changed仍按原规则阻止报告/答案当前发布。分别计数其必要扫描。
7. 正常完成/模型异常/注册工具后初始化异常/超时/取消/证据保存失败/Host关闭均使本轮registry和TS service关闭一次；不存在未await后台资源。单工具取消不影响同轮后续另一个合法signal。
8. 当前工具执行中cancel/close：先拒绝新请求，等待在途退出再dispose，不能把正在返回的页替换成空成功；其他独立Run的registry继续工作。
9. 持久结果replay和开始前被拒绝不创建source handle；Queryactor解析只发生一次，不在每页扫描events；每页仍load现行许可。
10. 旧Python/Cpp/read_source/coordination/material工具注册与JSON guard回归保持。完成typecheck、边界检查及相关app/runtime测试；不做真实外部模型或全仓成本基准。

本稿未引入任何“Run即Session”的新假设；捕获只属于这次实际模型循环。将来会话延续如何复用capture是后续独立设计，不能靠遗留闭包本批偷偷跨运行共享。
