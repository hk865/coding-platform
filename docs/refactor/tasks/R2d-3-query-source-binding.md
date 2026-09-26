# R2d.3：QueryRun 的真实源码能力绑定与生产入口收口

状态：2026-09-23 已经主 Agent 独立验收。最终3文件17项通过；相关固定版本6文件25项及另8文件54项通过，类型、模块边界和app构建通过。详见批次记录。代码根 C=`/home/hyh001/projects/coding-platform/coding-platform`，设计根 N=`/home/hyh001/projects/coding-platform/docs/refactor`。

读 [R2d整体](R2d-model-source-tools.md)、[R2d.2](R2d-2-work-source-binding.md)。只增加真实Query绑定；R2c registry/AST/权限重核及R2d.1工具/关闭、R2d.2 owned handle直接复用。不开第二套缓存，不修改Query持久格式、Kernel、UI或普通Run状态。

## 1. 精确接口与改动范围

只改 `app/source-capture-access.ts`、`app/service.ts`、`execution/worker-runtime/read-only-query-runtime.ts`，除非主Agent据实扩任务。没有新模块或依赖边。

```ts
// QueryExecutionRequest 来自 contracts/query-execution-context.ts。
export function createQuerySourceCaptureFactory(
  deps: {
    ledger: () => StateLedger;
    sourcePolicyFor?: (projectId: string, workspaceId: string) => Promise<SourcePolicy | null>;
    hostSignal: AbortSignal;
    now: () => string;
  },
  request: QueryExecutionRequest,
  root: string,
): RuntimeSourceCaptureFactory;

// ReadOnlyQueryRuntime constructor deps 增加可信内部回调：
sourceCapture?: (request: QueryExecutionRequest, root: string) => RuntimeSourceCaptureFactory;
```

工厂同步核对结构/复制完整request和root，仅返回闭包；第一次open异步解析原actor及当前资格，随后才创建独占registry。root是本轮Runtime已经选定、实际交给Kernel的同一个根；每次fresh policy.root精确相等，不在Host重新调用rootFor猜测。

`ReadOnlyQueryRuntime.execute` 在原materials.assemble成功、durable replay分流以后，用该root取得闭包，传 `projectSource:{mode:'frozen',open}`。正式service永远注入sourceCapture；sourcePolicyFor缺席时open unavailable，不能省略回调默默legacy。旧direct-runtime嵌入兼容仍明确保留。`startQuery` wire不改，不把能力写入record/input/trace。

Host内部可信live binding扩为明确Work/Query联合；无Query绑定的R2c架构共享reader仍拒绝query_run。复用同一次当前QueryRun/Job读取进行所有核对，不外层读一遍内层再一遍。共享机械owned handle/组合signal/短期access释放；Work与Query各自保留清楚的领域判定。

## 2. 原始发起者只解析一次

真实来源是 `QueryJobSubmitted.actor`，不是 `QueryRunStarted.actor`。后者可能是调度者，且pending创建和实际启动有同名事件。现有Job/Runtime record不保存原actor，不能填固定local-gui/system，也不能从unknown的record.roleBinding强转。

从完整request.runRef用queryJobRefFor派生expectedJobRef，核对当前Run.run.queryJobRef和loadedJob.ref均与之相等；不把它们彼此自洽当作请求身份的证明。先读当前Run/Job确认第3节资格，冻结完整Job ref、runRef、intent、goalId、submittedAt。然后经现有 `StateLedger.events({afterCursor,limit:256})` 顺序扫描：仅接受顶层project/workspace、aggregateType=QueryJob、aggregateId=queryJobId、aggregateRevision=1完全一致的QueryJobSubmitted；payload.job的完整scope、runRef、goalId、submittedAt及immutable intent也须相等，初始pending/空answerRefs/null closeReason须合法。当前running/updatedAt不能与初始事件整对象比较。

必须唯一且无冲突；不存在/不可读→unavailable，冲突/不支持actor→forbidden。只保留一个候选和冲突标记/饱和计数，不收集候选数组或复制全历史；每页检查Host+Run取消，用现有seqOfCommitCursor核对hasMore的throughCursor严格前进（回退/相等/空或非法均拒绝），不能无限循环。命中后仍检查剩余事件以识别冲突。actor仅接受原human/system并复制；agent原actor不在当前CorePrincipal支持集，明确拒绝，不能改归因为system。

解析后再次fresh核对资格，避免扫描期间已关闭仍open资源。同一工厂可single-flight原actor解析；后续capture/query/verify/release不得再调用events，仍重查当前资格。失败/取消的初始化不能留下后台扫描。

真实入口包括human语义Query、initial_coordination和system execution_coordination；三种已支持execution.kind都保留。Actor是归因，许可仍来自当前真实Job execution和只读政策。

**成本明确：** 当前events无aggregate查询，本子批每个实际模型循环多一次O(ledger历史)启动扫描、O(1)额外保留空间；不是每页扫描，也不是已消除所有历史扫描。后续正式索引/受理能力贯通再去掉此过渡成本，不能为本批编造actor或新增持久索引。

## 3. 每个请求的当前资格

- ctx完整scope、principal.queryRunRef、materialReader.kind=run/requester=QueryRun与copied request.runRef相等；initiator必须等于已核验原actor。
- 当前QueryRun/Job都found、完整返回ref及run.queryJobRef/runId/job.runRef相符；两者status=running，Run.outcome=null。pending/answered/closed均不能新读。
- `run.execution.request` 与复制的完整request规范JSON相等，包括完整bundleRef、question、budget、完整runRef。不能只对digest或actor。当前QueryExecutionContext.assemble仅在published分支核对完整request，assemble=ready不能替代本检查。
- Job.intent.execution存在且通过现有validQueryExecution，kind属于semantic_query/initial_coordination/execution_coordination，完整roleBinding和绑定值仍一致。question/scope符合当前intent。只赋现有read家族；initial_coordination中的后续implementationAuthorization不变成本Query的write/shell许可。
- 每次Host mount/private政策有效且policy.root===copiedRoot；底层Sandbox denied prefixes、路径和链接校验保持，capture间接依赖也受限。
- Host/Run/当次tool任一取消均拒绝；不缓存首次tool signal。capture前读取真实Workspace revision，正常Workspace/Job/Run revision前进不是撤权。

subjectKey取完整QueryRunRef、原actor、完整请求与完整role的规范JSON摘要；permissionRevision取真实role、execution kind、稳定只读政策版本和Host政策，不含源码digest/普通业务revision。角色在初始绑定时核对完整身份，外部调用方身份与原绑定不匹配则拒绝；不构造运行中角色改变场景。完整请求不匹配、真实根或Host许可变化仍拒绝旧页；同一合法冻结捕获不因普通revision推进失效。

## 4. 生命周期和原有业务守卫

owned source由ObservedModel唯一close，QueryRuntime不再关闭它；factory返回前失败自行清理。共享架构handle、其他Query的handle不受本轮close影响。读取前open的短期access总是finally.release。

现有exact terminal replay/active single-flight/outcome_unknown不新执行、不解析actor、不open；materials拒绝/准备时取消同样不创建资源。QueryRuntime.close/cancelQuery原abort+等待done保持；Host关闭等runtime退出后再关共享读者和ledger，不建后台registry池。

保持sourceBefore/sourceAfter、独立answer review后的核验、最终事实发布selectedSources/引用适用性与stale处理。冻结页可以继续读取旧材料且标captured_source/not_rechecked；不能因此把旧来源答案发布为当前。Kernel模型/工具失败、证据写失败、deadline和取消仍走原真实结束路径。

## 5. 独立验收与生产退出

主Agent冻结测试后派发，dsh不能改。覆盖：

1. 真实受理Query经QueryExecutionContext/Runtime/Kernel/本地ModelClient执行capture→多页→release，实际工具有project_source无project_index，真实来源/身份/关闭。至少有真实service装配证据，不能只mockObservedModel参数。
2. 原human/system actor来自精确提交；其他scope同名Job、相同actor其他Query不能混用；缺失/冲突/agent来源明确拒绝。origin扫描仅open时一次，多页不增加，当前load仍执行。
3. 初始完整身份或外部调用方与原绑定不匹配拒绝；完整request不匹配、真实执行状态/根/Host权限变化仍拒绝，正常业务revision推进不误拒；no participation不受影响。不以直接改写持久Role pin制造运行中换绑验收。
4. 在途取消/Host close等待释放；terminal replay及材料阶段取消不绑定/open；两个Query/共享架构互不关闭。
5. 来源变化后旧页仍可查，而最后sourceBefore/sourceAfter阻止发布当前答案；单独记录原baseline成本，不能删除守卫通过计数。
6. 正式工厂失败/缺政策不能降级旧工具；旧显式嵌入调用保持原协议。

结束时逐条列出ordinary/explore/Reviewer/Query四种实际生产清单与调用链。检查旧ProjectSourceIndex剩余消费者，只能是明确兼容/低层兼容helper/测试；有未迁正式消费者则R2d不算完成。类型、模块边界、app构建及相关源码/Query/Reviewer回归通过；不全仓/外部模型/安装/自动提交。

主审补充第15项：真实事件页返回回退游标时，必须在请求下一页之前拒绝；不能只判断相等而在两个游标间反复读取。此测试由主Agent加入/更新保护hash，dsh不能修改。

主审补充第16项：events最后一页await期间取消，返回页后立即检查取消，失败初始化不得缓存origin；沿同一factory重试必须重新解析历史。该点不构成已知源码越权，现有probe会阻断取消后的读取；补测落实初始化生命周期。

主审收口：初始化前和每请求的同一Query当前资格判据应在本文件一个私有loadCurrentQueryState(ledger,request)中实现，只做一组Run/Job读取与完整request/ref/status/validExecution检查，返回typed结果；origin负责一次历史归因，authorize负责ctx/binding执行版本及Host政策。两者调用同一判据，不能复制两套running/request/role规则；也不能缓存资格省掉新时点读取。


### 最后独立边界复核补充（第17项）

真实Host允许同一物理root登记不同Workspace。Query端口除核对完整principal/queryRunRef/materialReader之外，还必须核对ctx.projectId/workspaceId等于binding.workspace；外层只保证ctx与本次requested workspace相同，不能替代原始binding匹配。直接在Query资格入口拒绝该scope漂移。模型wire本来没有身份覆写参数，此处补底层Port边界，不表述成模型可自行选scope。主Agent追加同root双真实Workspace负例并验证RED；dsh仅修这一判断，保持公共loadCurrentQueryState和所有既有守卫。
