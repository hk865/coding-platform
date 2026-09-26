# R5b：无 Plan 的 Query 调查、真实回答与初始规划（顺序草案）

状态：2026-09-26，R5b.1 scope、5 个空占位文件和 `next-query-job` 检查入口已备，主审已派发第一阶段骨架/tests；本文不是已完成能力。实现位置为 `coding-platform/next`，旧 `coding-platform/src` 只读参考。每个小批单独经过 DSH 骨架/真实红测 → Astra 中审 → DSH 实现 → 独立验收；不得一次启动以下全部小批。当前只准备 R5b.1，其余在前批合入后刷新实际源码再定稿。R5a、W2（含未来意图）、C2 与 R4.1 已合入 main，R3e 组合根骨架已导入冻结。按用户 MVP 调度，公开 pending 受理是真实模型初始规划的前置，本批先于尚未开工且共享组合根的 R4.3，不等待 R4.3；执行本第一阶段后立即 STOP 中审；不自行进入第二阶段实现或后续子批。

## 1. 产品路径与边界

依据 PRODUCT 的 Run/QueryRun、两图与查询、校验边界，以及 AgentRuntime 模块 §3/§7：普通文件、图、Goal、材料与 Session 历史查询直接使用已有读口，不产生 QueryJob、不占 Session、不调用模型。用户明确要求解释、调查或规划且需要模型时，才提交 QueryJob。

目标链：公开 Project/Workspace/Goal → pending QueryJob+QueryRun → 选择原有或正式创建的 Session → 共用唯一 Session 占用 → 有界准备/真实 Kernel → 原历史与实际读取来源支撑的回答 → model_coordination Plan candidate → 原 Plan 正式采用路径。Goal 是长期目标锚点，focusTaskRefs 是已有 Task 的精确引用；不存在 Plan 时 focus 可为空，不造占位 Task、TaskAttempt 或 Run。Query 不改变其所咨询 Task 的 phase、lease、Attempt 或 Work Run。

无 Plan、缺初始 architecture baseline 和未安装 CompletionPolicy，均不阻止调查、回答或保存候选。正式采用仍在原 Plan 操作中核适用治理；不能自动生成空 baseline，也不能删除 model_coordination origin 或伪装人工来源绕过采用。候选不等于已采用，回答不等于完成证据。未来意图节点直接使用已合入 W2 的真实契约：显式 plan_only 可无 assignment/验收入图，request_execution 沿正式执行条件；本任务不恢复旧 parser 对完整任务的假设。

## 2. 实际源码对账与可复用点

以下路径除注明“旧”外均相对 next。

| 位置/符号 | 已有事实与本任务最小用法 |
| --- | --- |
| `contracts/query-job.ts` | 已有 QueryJob/QueryRun/Answer refs、Job/Run snapshots、QueryJobIntentV1、QueryExecutionBindingV1、QueryJobSubmittedEvent；没有正式 Job/Run producer，只有 AnswerRef、没有 Answer 正文 snapshot。不能据 DTO 存在宣布 Query 可运行。 |
| `contracts/core/identity.ts:ExecutionRef`，`contracts/core/session.ts:SessionOccupancy` | ExecutionRef 已是 RunRef 或 QueryRunRef；Session execution/maintenance 共用一个槽，codec 已接受 QueryRun 完整 ref。不得新建 Query 占用槽。 |
| `sessions/session-directory.ts`、Runtime `session-operations.ts`/`kernel-store-locator.ts` | 正式 Session 映射、创建、原 KernelStore 路由和历史读取已存在。使用原 Session/adapterId/kernelSessionId，不搬旧 Query 每次自建 sqlite 的实现。 |
| `materials/record-readers.ts` | 已注册 QueryRunSnapshot@1，MaterialAuthorityReads 能精确读取。注册只有一个 owner；新 Query producer 复用此 schema/validator，不重复注册 QueryRun。 |
| `materials/applicability.ts`、MaterialPort/M2 facts | query_run + materialReader.run(requester=QueryRunRef) 已有来源/访问语义；Query 的 current basis 可 planRef=null，不要求借一个 Work Run 的 Plan。M2 的实际 grant/reader/Goal/Workspace guards 可复用，不能复制 authority 算法。 |
| `materials/grant-contracts.ts`/`grant-service.ts`（M1） | 正式 grant writer 的 reader **目前只允许 RunRef**，从该 Run 的已接受 Plan 派生 basis；明确不支持 QueryRun。读侧认识 QueryRun 不等于有真实 grant 生产链。R5b.2 必须补这个窄分支，不能 seed grant 或以 Host reader 代替 Query。 |
| `source-authority-reader.ts` | Workspace/Run/QueryRun 有精确 provider，QueryJob 仍 unsupported；没有 events 能力。不得传空事件页或固定 platform actor。 |
| `agent-runtime/source-capture-access.ts` | createQuerySourceCaptureFactory、loadCurrentQueryState 与 query_run 来源访问实现已存在。现有原发起者解析扫描 QueryJobSubmitted 事件；需要正式 Job provider 与新 producer 的精确来源定位，复用当前资格/权限算法。 |
| `agent-runtime/ports.ts`/`execution-contracts.ts`/`execution-driver.ts` | 当前 prepareExecution/startRun/observeRun 及 Host configuration 入参是 Task/Run 专用。AgentRuntime 文档的 Query 联合类型仍是目标，不是已有 export；不能给这些方法强转 QueryRunRef。 |
| `agent-runtime/observed-model-run.ts:runObservedModel` | 真正共用 Kernel 循环、frozen source factory、read-only、工具生命周期、真实请求计量、历史和 observation 机制。Query 只添加身份分支与薄装配，不复制模型循环、不新建 QueryRuntime DB/manager/第二 engine。 |
| `agent-runtime/model-budget.ts:ModelBudget` | 已有最终请求容量计数、reserved/reported/unknown、真实持久化 callback；当前 entries 初始化为空，taskBudget 是 Task 命名的累计上限。不能创建一个新 meter 就声称跨轮/重启预算连续，也不能把 Query 转为 Task Run 以传预算。 |
| `contracts/initial-planning.ts`，`tasks/plan-service.ts` | InitialPlanOrigin 已有 answerRef/digest、Goal/Workspace revision、requestId、summary、assignments。proposePlan 可保存带 issues 的候选；initial apply 遇 origin 目前明确 unsupported。必须接真实 answer 校验，不把现有 Host 分支当绕过办法。 |
| 旧 `execution/worker-runtime/read-only-query-runtime.ts` | 可复用 readonly runObservedModel 调用、来源比较、answer 提取与未知恢复语义；其技术记录目录/单 Query sqlite 和第二套启动服务不迁入。 |
| 旧 `control/control-engine/policies/initial-plan-admission.ts`、`initial-plan-source.ts` | 有唯一规范化/校验思路：真实 initial_coordination answer → parser → 确定性 draft/origin，并由采用重新核来源。需小范围迁纯函数且适配当前 Plan 契约；不迁旧 Control/StateLedger/Dispatch/全量 context compiler。 |

## 3. 串行批次与各批公开结果

### R5b.1：正式提交与精确查询（首批）

只补 pending QueryJob+QueryRun 的真实生产者与读取，保存原 actor 的可定位来源。公开 `platform.queries.submitQueryJob/readQueryJob`；提交不选择 Session、不捕获源码、不准备 body、不启动模型。这样首批既能从公开生命周期受理无 Plan 初始规划，也不会制造尚无执行/释放消费者的 Session 占用。

### R5b.2：Query claim、材料/source 来源与 WG entry

在同一 Query owner 追加 claim/prepare admission 所需状态，Session CAS 写入原 occupancy 并使用原 generation 规则；共用正式 Session 映射与 claim key，不新 TaskLease。Task claim、Query claim 和 Session maintenance 并发只有一个取得原槽；不同 Session 可并行。历史读取无需重新申请占用。公开 claim/read 回执带真实 Session pin/generation，原请求重放不换 Session、不造新 QueryRun。

沿现有 QueryRun 外层 @1 增加 versioned execution binding（需要新增版本时 reader 同批接受），保存 Session/Kernel identity、entry generation/revision、prepared bundle ref/digest、原历史定位与阶段。不得把 pending/running 状态直接当作已进入 Kernel。claim/entry/terminal 的算法应复用现有小型身份、事务和 history 纯函数；不为共享函数让 Query 被迫拥有 TaskAttempt、Plan 或 ModelRequestPermitRef。

本批 source 必要扩展：QueryJob 精确 reader；精确 submission 来源读取；M1 grant reader 由 RunRef 扩至真实 QueryRunRef，Query 通过自己的 Job.goalId 确认 Goal/Workspace，basis.planRef 可 null，source pin 仍由真实 provider 捕获。owner 的材料来源继续核原 Run/QueryRun；不能因无 Plan 放弃真实 owner/scope。M1 旧 Run 路径不放松。Read current 用原 QueryRun reader + exact ref M2 facts，不以 Host 代读后的正文冒充 Query 已获授权。

current source factory 现要求 Job/Run running 且 execution.request 已写入。先以 QueryRun 自有来源保存 bounded bundle， WG 事务核 body 并提交真实 binding，再开放 Query source 工具；准备前只读取正式 Goal/Task 摘要及实际有权的材料。若准备必须读取源码，应使用明确的 pending Query 专用授权分支，不能把 pending 提早谎报 running 或用 historical_explanation 冒 current。首条最小正例可仅用 Goal 摘要准备，真实源码调查在已登记 binding 后发生。

### R5b.3：原 Kernel 执行、预算与 answer 事实

在同一 Runtime port/driver 增 Query 入口或带 kind 联合，沿 runObservedModel 执行。Host configuration 增加真实 Query 输入分支，来源为 QueryJob.execution 与 Session.role；保留 resolved/absent/inadmissible 与明确版本化 Host template，不构造 Work roleBinding 迎合 Task 接口。query_run principal 使用原提交 human/system actor；启动 dispatcher 不替换发起者。

prepare/authorize → fresh begin → entered → observation 仍分开；只有 fresh begin 的新提交允许一次真实 Kernel 进入。Query replays 只观察原 executionIdentity/Session/history，未知保留占用，不能重跑或新建 Run 假装恢复。结果写入确认原身份/来源，不重审 fresh 材料门禁；释放只在当前 Session occupancy 的 exact QueryRun+generation 仍匹配时进行。signal sent、关闭请求、无事件均不是已停止。

Query 不拿 Work ModelRequestPermit。复用现有真实请求计量和 source/material 再核边界，在 Query 自有 versioned binding/正式记录保存 request reservation/usage facts；需要共同纯 helper 时只提取无 Task 身份的容量/绝对 deadline 计算，保留旧接口兼容。上限来自 Query intent 与可信 Host/Role 容量的 min，deadline 是原绝对时间；不知道 usage 时保留 reservation。R5b.3 首个实现轮数为 1；maxRounds>1 的真正追加、累计预算和来源复核另以该批后续小增量实现，不 silently reset meter 或把 maxRounds 当 maxRequests。

只读 Kernel 仅授予真实只读文件/source、材料与确定性 Goal/Task/历史工具；readOnly=true 及 allowedTools 的实际限制保留，无 shell/edit/apply/W2/C1 写工具。source factory 统一持有/排空/关闭；工具返回实际 source witnesses，模型自报 sources 不成为事实。缺 source policy 返回真实失败，不 fallback legacy_live。Model 输出只读也不能豁免工具的项目/工作区与材料访问规则。

迁入已有 QueryJobAnswerV1/QueryJobAnswerSnapshot 的纯类型，正文仍是同一 Artifact store；实际 answer 从该 executionIdentity 的完整 Kernel Turn 提取，不复制 transcript/reducer、不扫描全部 Session。来源含本轮正式 Goal/Workspace pin、实际 focus Plan/Task pin、真正打开的材料/源码/历史 witnesses。source 变化时回答作为历史事实仍可记录，但明确 stale/gap，不能伪装 current。使用 Kernel 已导出的 transcript integrity validator 只证明交流配对完整，outcome_unknown 仍不能解读成副作用已知。

### R5b.4：有来源的初始 Plan candidate 与正式采用

公开薄入口拟为 `proposeInitialPlanFromAnswer(ctx, GraphWrite<{answerRef; reason}>)`，由正式 answer reader + 唯一纯 normalization 构造 draft；模型或调用者不能另传 origin/digest/assignments 来覆盖真实回答。也可复用已有 proposePlan 的受信适配，但最终采用必须重算 answer→draft 并核完整 origin，不能只凭 Host actor 接受任意 origin。实际 writer 仍为既有 Plan service，无第二候选库或另一个 active Plan writer。

新动作读取实际 Job/Run/Answer、body digest、initial_coordination、同 Goal/Workspace 与 Query 已持久化的 settled/observation 终态及原历史 locator，核原答复身份和候选一致；Plan 侧不调用 Runtime 重新扫描 Kernel 历史。生成建议时的源码观察保留为历史 provenance，不新增全量当前性门槛。历史 QueryRun 已结束是正常情况，不要求仍占 Session、不重核新动作 Role。candidate 保存实际 Goal 与 taskHierarchy/relations/来源，沿 Plan query 可见；needs_decision 是可读结果，不自动变成每次规划都要人工确认的硬流程。缺 baseline 时仍可保存带 issues 的候选，apply 才返回具体缺失治理。

初始采用复用原 resolveGovernance/validatePlanDraft/compileInitialPlanAdoption 的事务，替换该 origin 的 unsupported 分支为真实来源验证；局部 guards 覆盖实际消费的 Answer/Job/Run/Goal/Workspace/proposal 与治理，不引入全 workspace/source 锁。沿原 receipt 先恢复；后来 source/权限变化不能拒绝已有采用回执。已有 Host 无 origin 的合法轻量路径保持，不添加全局 accept+gate。后续 Plan 调整仍归 W2，不在本批迁 execution_coordination/feedback 整套协议。

## 4. R5b.1 精确 DTO 与依赖（待主审冻结）

直接导入 GraphWrite、CoreCallContext、ReadResult/WriteResult、既有 Query refs/snapshots，不建通用 QueryRuntime facade：

```ts
// src/core/work-graph/queries/contracts.ts
export type SubmitQueryJobInput = {
  queryJobId: string;
  runId: string;
  intent: QueryJobIntentV1;
};
export type QueryJobRecord = {
  job: QueryJobSnapshot;
  run: QueryRunSnapshot;
};
export interface QueryJobPort {
  submitQueryJob(ctx: CoreCallContext,
    request: GraphWrite<SubmitQueryJobInput>
  ): Promise<WriteResult<QueryJobRecord>>;
  readQueryJob(ctx: CoreCallContext,
    ref: QueryJobRef
  ): Promise<ReadResult<QueryJobRecord>>;
}
export type QueryJobDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
};
export function createQueryJobService(deps: QueryJobDependencies): QueryJobPort;
```

首批 goalId 非 null，允许 semantic_query（包含 execution 缺省的历史兼容提交）和 initial_coordination；execution_coordination 及 implementationAuthorization 暂 unsupported，不承诺交付反馈或代码实现授权。initial_coordination 必须显式 execution.kind；复用 validQueryExecution 检查已有执行配置形状，但提交配置只是请求，运行时仍须可信 Host/Session/Role 批准。首轮只支持 maxRounds=1；保留 DTO 旧范围，不全局改 schema 使历史多轮不可读。后续多轮不是另一个 engine。

queryJobId、runId、meta.requestId 各自有身份用途。intent.intentId 与 queryJobId 保持旧 initial planning 来源绑定要求；meta.requestId 不代替它。intent project/workspace/goal 与真实 ctx/Goal 一致；question 不擅自重写，非空且 UTF-8 上限 16 KiB；focusTaskRefs 有界至 64，完整 ref 去重，不能混项目/Goal。budget.maxTokens 为正安全整数，deadline 为 null 或有效时间；预算到期不阻止保存调查意图，fresh 执行才判断是否可发送模型请求。correlationId 保持真实输入。

当前公开 writer 只受理可信 Host 的 human/system，原 actor 来自 ctx，不来自 intent。`query_run`、`work_run` 不能自报 Host 来获取提交能力；更高层 Agent 发起后续查询另沿真实委托能力扩展，不用固定 system actor掩盖来源。readQueryJob 首批同样是 Host scope read；不要求 Goal 仍无 Plan、Session 当前 entered 或来源当前有效，不开启模型。

为了后续源授权精确找到原提交，`contracts/query-job.ts` 的 QueryJobSnapshot 新增可选、嵌套版本化 `submission?: QuerySubmissionBindingV1`：

```ts
export type QuerySubmissionBindingV1 = {
  schemaVersion: 1;
  identityKey: string;
  fingerprint: string;
  eventId: string;
};
```

这是原提交的 locator，不是新的授权/actor 副本；新 writer 必须写入，旧 snapshot 缺失保持可读，不推断已获执行权。字段全部由 writer 生成，submit 输入不接受该结构。利用当前 Store 的 `lookupCommit({identityKey,fingerprint})` 取得原 cursor，再 `eventAt(cursor)` 核 eventId/原 QueryJobSubmitted/immutable Job intent，取得真正 actor。eventAt 的参数是 cursor，**不是 eventId**；不设计不存在的 by-id API、不扩 Store cursor bindings、不扫描全部事件。后续 Query 专用 origin reader 复用该 locator；旧兼容 scan 可保留在旧调用者但新正式链不依赖它。

## 5. R5b.1 原子受理与编码

首 await 前隔离 ctx/input/meta，保留原 AbortSignal。结构/调用范围检查 → identity/fingerprint lookup → 命中恢复原事件回执 → miss 后精确读事实 → 单次局部提交。身份前缀 `query-job-submit:` 加现有 commandIdentityKey；fingerprint 包含 scope、实际 actor、完整 intent/两个目标 id、规范 caller expected；不包含 now、eventId 或新派生 submission locator。与其它操作的 identity 分开。同 identity 改 question、budget、focus 或有效 expected 是 idempotency_conflict。

caller expected 恰为 Project/Workspace/Goal 的当前 pin、目标 QueryJob@0、目标 QueryRun@0。0 编译为 Store 缺席 null；缺/重复/异 scope pin 是 invalid/forbidden，不接受无关整库 pin。fresh 读真实 Goal 归属；initial_coordination 要求 activePlanRevision=null，但 **不读 architecture/CompletionPolicy**。semantic_query 可咨询已有 Goal；focus 非空才沿 Goal 当前 Plan 精确读取 immutable Plan snapshot并核 taskId 成员，不检查 Task satisfied、未来依赖完成或所有权链。source Plan pin 在后续实际准备来源中记录；提交只保存精确 focus 引用，不能把当前 TaskRow 当永久快照。无 Plan + 空 focus 是合法首要正例。

guards 为 Project/Workspace/Goal、目标 Job/Run 缺席以及实际读取的 focus Plan revision；不写 Goal/Plan/Task/Session，不使用 ledgerHorizon。两个 fresh 同 Job/Run 身份至多一成功；其它 Goal/Session 的独立变化不冲突。

新 Job@1 为 pending、runRef 为本次完整 QueryRunRef、answerRefs=[]、closeReason=null；Run@1 为 pending、startedAt/endedAt/outcome=null、execution 缺省。一次 commit 同写 Job/Run，并写既有 QueryJobSubmitted@1 事件（payload.job 保持旧形状）。submission locator 在 Job snapshot，event actor 为真正 ctx actor。返回 pair 的原 Run 可由事件里固定 pending 提交语义和完整 runRef 还原；不能从后来 running/answered 的当前 Run 恢复初始回执。单事件 commit 的 cursor 就是 eventAt 地址。

新增 QueryJobSnapshot@1 codec/QueryJobSubmitted@1 event codec；材料 reader 已有 QueryRunSnapshot@1 的 EncodedRecord 校验函数和 schema，并非现成的 typed decode/encode。首批只作必要的 schema/校验窄导出，在查询组件内复用其校验并作纯编码/解码，仍一个注册 owner。新 codec 只管持久形状/身份；权限、无 Plan 或 focus 资格不塞进 codec。不得另造 QueryRun 表/SQL/Map。合法旧 snapshot 缺 submission 可读，但不能依赖不存在的提交事件授权真实执行。

提交抛错、返回失联或明确冲突后，以原 identity/fingerprint 精确查 receipt；found 才恢复 committed。Store 已明确拒绝且回查为 not_found 时，保留原拒绝码及事务内观察到的 current，不把确定的 revision_conflict/idempotency_conflict 改成未知结果。提交抛错或返回失联且回查不能确认结果时返回 unavailable；回查本身不可用时明确回执恢复受阻，不宣称已提交或确定未提交。取消若发生 commit 前零写；真实提交成功的晚取消仍返回 committed。原 receipt 恢复不依赖后来 Goal active Plan/目录/材料权限。readQueryJob 精确读 Job 及其 runRef，未找到 Job 为 not_found；Job 已在而其应有 Run 不可取得是 incomplete/unavailable，不能假装空正常结果；旧无提交来源不影响纯历史读取。

## 6. R5b.1 精确写 scope

仅以下 **6 个生产文件 + 2 个测试文件**；3 个既有生产文件在本次准备中保持不变，**5 个新文件（3 生产 + 2 测试）已按主审授权预建为 `export {};` 空占位**，未实现领域逻辑或测试。范围见 [R5b-query-job-skeleton-scope.json](R5b-query-job-skeleton-scope.json)。路径相对 next：

1. `src/contracts/query-job.ts`：新增 submission locator 纯类型/可选字段；修现状注释，不预增 Runtime/Answer/多轮接口。
2. `src/core/work-graph/queries/contracts.ts`（新）：§4 ports/deps。
3. `src/core/work-graph/queries/query-job-service.ts`（新）：pending submit/read 与私有 receipt/提交编译；复用 Goal/Plan 纯解码和 Store，无第二 repository 框架。
4. `src/core/work-graph/queries/query-record-codecs.ts`（新）：Job snapshot、原 Submitted event codecs；保持已有 wire shape。
5. `src/core/work-graph/materials/record-readers.ts`：只做既有 QueryRun EncodedRecord 校验/schema 的必要窄导出，行为不变，不改 M1/M2/authority 算法。
6. `src/composition/create-platform.ts`：同 backend.records 构造公开 `queries`，合并新 schema 一次；两方法 trackedCall，close 等待在途操作并拒新调用。无 runtime Host 配置仍可提交/读取 pending。
7. `tests/work-graph/R5b-query-job.test.ts`（新）。
8. `tests/composition/R5b-query-job-platform.test.ts`（新）。

不修改 Runtime、Session、source provider、Plan service/validation、M1 grant、Workflow、Kernel vendor 或原工程。R5a 正式注册服务已合入，首批空库验收直接调用 platform.projects.createProject/registerWorkspace 和 goals.createGoal；不 seed Project/Workspace/Goal 宣称端到端完成。无需新大 fixture；复用公开 bootstrap/Goal 操作与现有真实 backend。

阶段一上述两个新方法明确 unsupported，codec 的新分支也是清楚占位；不得借纯函数名提前写领域实现。既有 QueryRun 校验/schema 的窄导出可正常复用，不破坏其已有绿测。阶段一必须区分已到新方法的红与前置 producer 未到位的红；主审冻结后实现者不能改测试期望来变绿。

首轮派工仅授权上述骨架和 §7 既定真实测试，完成后 **STOP** 等待 Astra 中审；不得在同轮实现 pending writer，更不得提前实现 Query 执行、Session claim、模型调用或后续 R5b.2–4。固定 `next-query-job` 只选择上述两个新测试；当前占位没有测试用例，不能将其当作验收通过。

## 7. 首批少量独有验收

1. **公开无 Plan 路径。** 空 SQLite 经 R5a 注册 Project/Workspace、createGoal；不安装 baseline/CompletionPolicy、不建 Task/Session，公开 submit initial_coordination → readQueryJob 得到同一 pending pair及完整 Goal 锚点；模型/Kernel/源码捕获调用数为 0。重开同目录仍可读。
2. **实际来源与原回执。** 两个不同可信 human/system 在不同 Query 身份提交，真实事件各保留原 actor；利用实际 receipt→eventAt 读原事件，不能仅断 snapshot 自报 actor。重复提交返回原 pair/cursor/replayed，Job/Run 不增；合法同身份输入变化冲突。SQLite commit 已成功但返回失联的包装仅用于窗口注入，lookup found 恢复原receipt；不伪造 committed。
3. **TaskGraph 锚点。** 使用正式已采用 Plan 创建 semantic_query 的 focus，读回完整 task refs；无 Plan 空 focus合法，非空未知 Task或异 Goal拒绝，查询不改变原 Task/Run。W2 future intent 已合入，本例可直接复用其公开 writer 产生的 future node 作为 focus，证明节点可查询与是否可执行正交；沿这一现有 case 验收，不增加矩阵或 seed 字段。
4. **局部并发。** 两个 fresh同完整 Job ref不同请求仅一提交，失败不留孤立 Run；同 identity并发恢复同回执。实际在最后读取后提交前写另一个已存在 Goal的合法变更不应阻挡，不依赖全账本 horizon；用公开 writer且只覆盖一个关键窗口。
5. **受信边界/close。** 异 scope、work_run/query_run submit拒绝；原signal在真实读取窗口取消零写。普通 queryGoal/queryTaskGraph/readSessionHistory/readQueryJob不调用模型。close等待一个在途 submit，随后拒新方法；不重复 Store通用矩阵。

建议验收 next-types +两个目标测试+受影响 QueryRun材料 reader邻接测试；不跑/改无关 Kernel矩阵，不引入 Role热换或持久记录篡改反例。首批 PASS只表示正式 pending producer/read，不表示 Query执行/answer/规划采用完成。

## 8. 后续真正执行链必须出现的独有证据

R5b.2：真实 Task claim 与 Query claim 竞争同 Session，maintenance 也受同槽约束；Query不同 Session能并行；原 claim回执不取新generation。真实 M1 Query grant及source capture，无Plan current材料可读，撤销/合法source变化在实际消费边界失败；没有grant时明确拒绝，不seed。

R5b.3：真实 Kernel/原 SQLite Session 运行，使用受控 ModelClient 模拟 provider 输出而非替换 Kernel；首轮实际调用只读 project_source/material工具，工具source进入回答证据。重复 start不新增Turn；原 Session历史及 executionIdentity可定位。完整请求（system/tool/history）容量与绝对deadline越界零provider调用；未知usage保留reservation。若历史不完整/工具 outcome_unknown，保留占用并标未知；完整终态才能释放匹配generation。源变更不抹掉历史answer，但不得将其标当前。没有源码授权时不偷偷落回live index。多轮与冷恢复在未交付之前公开说明限制，不自动新建Session/QueryRun补跑。

R5b.4：无baseline调查获得真正 initial_coordination answer后，公开导出model_coordination candidate；Plan query保留Goal、原回答body/digest和TaskGraph。尚无治理时candidate可见但apply明确缺失；正式补齐已有初始化/架构途径后沿实际当前 caller pins 采用，原origin完整保留。手工改draft却借旧answer伪装原方案、另Goal回答拒绝正式采用；来源历史标记照实展示，不能仅因源码后来变化而否决整个候选/Plan，已有采用原receipt不受后来撤权影响。沿旧 parser迁移必须对齐当时已合入W2，不把旧全任务完整性作为调查受理或未来意图保存的前置。

## 9. 并发编辑与后续任务冲突

R5b.1 的主要共享编辑仅 create-platform.ts 和 QueryRun reader窄导出。R5a/W2/C2/R4.1 已合入；保留其现有 bootstrap、Plan、消息与 controls 接线，不编辑 Plan 工具或 Runtime 工具清单。R3e 组合根骨架已导入冻结；按用户 MVP 顺序先派 R5b.1，尚未开工的 R4.3 等本批共享组合根变更合入后再刷新快照，不让两个 lane 同时修改 create-platform.ts。派发使用当前 main，不能从旧组合根快照覆盖这些实例或 trackedCall。R5b.2会与M1/M2材料、Session claim及source-capture-access接缝相遇，须以合入后的真实版本重新冻结小scope。R5b.3与R4控制/恢复共享Runtime driver/observed-model-run/预算，不能两lane同时重写这些owner；Query控制须接真实durable intent与观察，不借R4 Work专用字段强转。

公开Host调用即本批真实消费者；GUI/自动Workflow继续属于后续消费者，不因公开Port存在宣称用户完整路径已交付。待上批独审后再列下一批精确文件和少量目标测试，不预先铺空接口、全局授权框架或新的QueryRuntime存储。

## 10. R5b.2 下一批精确候选：Query Session → Kernel → 正式回答

2026-09-26实码定向预检；R5b.1 pending 两文件实现已合入。当前只冻结下一批骨架设计，不预建源码占位或派工。本节收敛§3的批次顺序：**R5b.2首个交付必须包含单轮真实回答，不能以claim/entry状态子集代替MVP。** 原R5b.3的单轮Kernel/预算/answer部分纳入这条正常链；其多轮、冷恢复继续后续。外部材料grant的Query分支列为明确下一窄接点，首条Goal摘要+真实源码调查不假借该能力。§8既有材料、来源与后续消费者范围继续保留，不据本批省略就关闭。

### 10.1 实际复用与不可省的缺口

| 已核源码 | 直接复用及准确缺口 |
| --- | --- |
| `SessionOccupancy.executionRef: ExecutionRef`；`claim-service.ts` generation规则 | 本来支持QueryRun完整ref；Query取得原Session CAS槽，generation同样来自Session.revision+1。不新增Task、TaskAttempt、TaskLease或Query专用槽。 |
| `session-operations.ts`、`kernel-store-locator.ts`、`execution-history-contracts.ts` | 正式创建/映射/原KernelStore与按runId+turnId分页的history已有；Kernel ExecutionIdentity只有runId/turnId，不需TaskAttempt。`RunExecutionHistoryV1`本身不含Work RunRef，可直接作为Query原历史定位值。 |
| `configuration/contracts.ts::RoleBindingFactsPort` | resolveRoleBindingFacts输入是roleBinding和声明权限，并不要求Task/Plan；复用真实resolved/absent/inadmissible与guards。Session.role在创建后稳定，查询不引入Role热切换生命周期。 |
| `runtime.ts`、`ports.ts`、`execution-contracts.ts` | 当前三执行方法、Host configuration input和dependencies均Task专用。需要同一Runtime port的Query薄分支，不能把QueryRunRef强转RunRef或伪造Claim/permissions。 |
| `observed-model-run.ts::runObservedModel` | 唯一模型循环、readOnly、Skill、awaited before_model、ModelCallAccess、frozen source、资源finally与真实Kernel历史可直接用。旧read-only-query-runtime的单Query sqlite、journal、内存records/starting/active管理器均不迁入。 |
| `model-budget.ts`、`run-limits.ts` | 最终请求计数、reservation/reported/unknown、绝对deadline与持久化callback已有。TaskBudgetV1实际只有tokenBudget/deadline两个数值字段；Query可用自身intent映射这两个值，不伪造Task身份、不需为改名字新建meter。首批只有新进入的一轮可建meter；重放/重启只能观察，不以空entries重启模型。 |
| `source-capture-access.ts::createQuerySourceCaptureFactory` | 实际要求Job/Run running、execution.request匹配；origin仍扫描QueryJobSubmitted。新正式链须消费R5b.1 submission locator的精确receipt/eventAt，不能给snapshot provider伪造events空页。 |
| `source-authority-reader.ts` | 当前能读Workspace/Run/QueryRun，QueryJob仍unsupported。须沿现Query codec和同一records补Job精读及原submission读取；不是新增通用来源服务。 |
| MaterialPort/M2、M1 | Query reader、own provenance形状已有；M1 grant writer的reader目前只有RunRef。即便Query自己拥有材料，`usage:'current'`仍需正式grant，不能借historical_explanation当current。首批prepared bundle是内部可信manifest按B2同样方式读raw body核owner/ref/digest，不是开放给模型的任意材料读口。 |

### 10.2 最小正常路径与依赖边界

真实入口：公开Project/Workspace/Goal（无Plan、无CompletionPolicy/architecture也合法）→submitQueryJob(initial_coordination或显式semantic_query)→正式createSession或选择空闲原Session→claimQuery→prepareQuery→startQuery→readonly Kernel project_source工具→正式answer+匹配释放→readQueryJob/readQueryAnswer及原Session历史。配置未显式execution的旧semantic_query仍可读/提交，首批实际启动返回明确unsupported，不能猜Role。

本轮是Query的一轮，不是只允许一次provider请求；工具往返可产生多个受同一累计预算约束的模型请求。maxRounds=1，原绝对deadline不重置。初始输入只含已正式读取的Goal/Workspace pin、question、稳定Role/Skill指导和可选精确focus摘要；没有Plan时focus为空。源码实际调查在entry绑定后通过已有Query source factory进行，不提前把pending改为running以便读取，也不制造验收政策。model_coordination候选的规范化和正式采用仍归R5b.4，回答可先供Host读取。

**不能藏进“只补一个Runtime调用”的三组必要改动：**①Query owner的claim/entry/模型请求事实/terminal/answer原子写与既有Session槽；②同Runtime的prepare/start/observe薄适配；③正式QueryJob/submission来源provider。三组共同组成下述首批scope，可在同一骨架冻结后按owner实现，不分别宣称正常链已完成。R5b.1必须先合入、共享composition由root串行刷新；若该producer尚未落地，不能以修改其在途lane或seed pending绕过。

**另列而不阻塞本条正例的依赖：**Query读取其它Run材料需要M1 `GrantMaterialAccessInput.reader`扩QueryRun、Job→Goal/Workspace basis(planRef可null)及真实source pin producer，涉及grant-contracts/grant-service等另冻窄scope；在完成前不向本条Query注入通用read_material工具或声称current材料可读。只读Goal/Task/history额外模型工具、独立reviewer、高级Query控制/冷恢复、多轮、answer→Plan候选与Workflow自动推进继续后续，不能由源码工具回答关闭。

### 10.3 共同接口候选（已对齐 fresh main，待主审冻结）

不改Task执行方法的参数；在同一RuntimeExecutionPort添加：

```ts
prepareQuery(ctx: CoreCallContext, request: {
  queryRunRef: QueryRunRef; requestId: string;
}): Promise<ReadResult<PreparedQueryExecution>>;
startQuery(ctx: CoreCallContext, request: {
  prepared: PreparedQueryExecution; consumerId: string; requestId: string;
}): Promise<ReadResult<QueryExecutionRecord>>;
observeQuery(ctx: CoreCallContext, request: {
  queryRunRef: QueryRunRef;
}): Promise<ReadResult<QueryExecutionRecord>>;

type PreparedQueryExecution = {
  queryRunRef: QueryRunRef;
  bundleRef: ArtifactRef;
  inputDigest: string;
};
type QueryExecutionRecord = {
  job: QueryJobSnapshot;
  run: QueryRunSnapshot;
  session: SessionRecord;
  answer: QueryJobAnswerSnapshot | null;
};
```

在原QueryJobPort追加`claimQuery(ctx, GraphWrite<{queryRunRef:QueryRunRef;sessionRef:SessionRef}>): Promise<WriteResult<QueryExecutionRecord>>`与`readQueryAnswer(ctx, ref:QueryJobAnswerRef): Promise<ReadResult<QueryJobAnswerSnapshot>>`。只有claim是显式Session选择；prepare/start输入不能另塞Role、root、工具或model。原Query owner内部另发布实际entry/观察及预算写接缝给Runtime，接口必须区分 fresh begin提交与replayed结果；不得把public Host提供的一段“真实终态”JSON直接当Kernel完成证据。

QueryJobDependencies 保留 pending 提交所需 records/clock，追加可选 `execution?:Pick<QueryExecutionPort,'claimQuery'|'readQueryAnswer'>`；未注入仅新增方法 unsupported，原 submit/read 不变。组合根先创建唯一 QueryExecutionPort，再同时注入 QueryJob service 和 Runtime。Query 执行部分明确依赖同一个`GoalRecordTransactionPort & RecordLookupPort`、`RoleBindingFactsPort`、`Pick<RawArtifactStorePort,'read'>`和受信Host配置准入函数。不依赖TaskClaimPort、Work ModelRequestPort或TaskInput。Runtime Query依赖直接取既有sessions/sessionOperations/kernelStores/activity/materials/bodies/workspaceHost/sourceAuthority/now/newId/kernel，外加这一个Query执行port；不复制第二套生命周期服务。

RuntimeHostBindings增加可选`resolveQueryConfiguration(ctx, {queryRunRef,sessionRef,role:RoleConfigurationRef,roleResolution:RoleSpecResolutionV1}): Promise<ReadResult<ResolvedRuntimeConfiguration>>`，返回沿用真实模型、工具、预算、Skill、Host template及配置revision。未注入时仅Query启动unsupported，Work路径保持。Query实际权限是Host grant、Role上限与readonly ceiling的交集：零writeScope、零shell/edit/C1/W2写工具。Role absent只接受版本化Host template；Job.intent.execution.roleBinding与Session.role映射必须核实，不能固定system替换原initiator。

### 10.3.1 主审冻结用的具体内部 DTO（2026-09-26，R5b.1 已合入）

下面是本批拟新增声明，符号沿现 owner 导入；不是已实现 API。只在 §10.6 的 17 个生产文件内落位。`RoleConfigurationRef`、`SessionRef`/`SessionRecord`、`RoleBindingRefV1`、`RoleSpecResolutionV1`、`RunExecutionHistoryV1`、`RuntimeBudget`、`ArtifactRef`、`GoalSnapshot`、`WorkspaceSnapshot`、`PlanRevisionSnapshot` 和 `GraphWrite` 均复用原类型。QueryRun@1 的外层编码/schema owner 不迁移。`QueryExecutionRecord.session` 在 claim 前没有值，因此内部执行 reader 只接受已 claim 的 Query；pending 仍用现 `readQueryJob`。

`contracts/query-job.ts` 增加以下具体值类型及 `QueryRunV1.executionState?: QueryExecutionStateV1`。不另建 entry aggregate；Run snapshot.revision 就是 entry/usage/观察的 CAS 版本，首批 entryGeneration 固定为 1，不宣称支持第二轮或重新启动：

```ts
type QueryModelUsageV1 = {
  requestId: string; requestDigest: string;
  reservedInput: number; reservedOutput: number;
  inputTokens: number | null; outputTokens: number | null;
  cachedInputTokens: number | null;
  usageStatus: 'reserved' | 'reported' | 'unknown';
};
type QueryModelRequestV1 = QueryModelUsageV1 & { admitted: boolean };
type QueryExecutionStateV1 = {
  schemaVersion: 1;
  phase: 'claimed' | 'prepared' | 'entering' | 'entered' | 'unknown' | 'settled';
  sessionRef: SessionRef; sessionGeneration: number;
  role: RoleConfigurationRef;
  roleBinding: RoleBindingRefV1;
  roleResolution: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
  /** Session 原已完成 boundary；不是本轮最新事件位置。 */
  priorHistoryCursor: string | null;
  prepared: { bundleRef: ArtifactRef; inputDigest: string } | null;
  entry: {
    generation: 1; consumerId: string;
    hostConfigurationRevision: string;
    permissions: { tools: string[]; writeScope: [] };
    budget: RuntimeBudget;
    kernel: RunExecutionHistoryV1['kernel'];
  } | null;
  history: RunExecutionHistoryV1 | null;
  requests: QueryModelRequestV1[];
};
```

claim 写 `claimed`、空 prepared/entry/history/requests，并保存同一个 Session 的 generation/稳定 role 和原 historyCursor；bind 写 `prepared`；fresh begin 写 `entering` 和确定 entry/kernel，并同时设置现 `run.execution` 原 V1 request（question、bundleRef、maxTokens 来自正式 Job/manifest，roundIndex=0）。entered 只来自真实 `turn.started`。unknown 表示已有进入/观察但尚不能证明完整收束，不能转成 pending、重新建 meter 或再次调用 Kernel。settled 与 Job/Run answered/closed 及 Session 释放同时提交；缺字段的旧 QueryRun 可以历史读，不能启动。

`PreparedQueryExecution` 保持 §10.3 三字段，manifest 放 `contracts/core/prepared-execution.ts`，不带客户端、root 或 callback：

```ts
type PreparedQueryManifestV1 = {
  schemaVersion: 1; kind: 'query_execution';
  queryRunRef: QueryRunRef;
  sessionRef: SessionRef; sessionGeneration: number;
  roleBinding: RoleBindingRefV1; sessionRole: RoleConfigurationRef;
  role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
  hostTemplate: { templateId: string; revision: string; digest: string } | null;
  hostConfigurationRevision: string;
  goal: { ref: GoalSnapshot['ref']; revision: number };
  workspace: { ref: WorkspaceSnapshot['ref']; revision: number };
  focusPlan: { ref: PlanRevisionSnapshot['ref']; revision: number } | null;
  permissions: { tools: string[]; writeScope: [] };
  runtimeBudget: RuntimeBudget;
  budget: { tokenBudget: number; deadline: string | null };
  sourceRefs: SourceRefV1[];
  input: string; inputDigest: string;
};
```

manifest contentType 固定 `application/vnd.coding-platform.query-execution-manifest+json;version=1`，UTF-8 上限沿现 `ARTIFACT_MAX_SIZE_BYTES`；inputDigest 为 input 原 UTF-8 SHA-256，manifestDigest 就是保存 body 的 ArtifactRef.digest，不自嵌 ref。Goal/Workspace 和非空 focus 对应的 Plan 由 Query owner 精确读取并核 pin，input 仅有界摘要/问题，不嵌全图或历史。预算 tokenBudget=Job.intent.budget.maxTokens，deadline 保留原绝对值；RuntimeBudget 是 intent.execution.runtimeBudget 与可信 Host budget 的不扩权交集，沿已有字段语义逐项收紧，不复制 ModelBudget 算法。

**复用实码的重要顺序：**`ModelBudget.wrap` 先给最终请求算 `MeterEntry.inputDigest=sha256(JSON.stringify(outgoing))` 并 await persist，再进入 `ModelCallAccess.beforeCall`；后者在 `runObservedModel` 算的是同一最终 requestDigest。因此 usage 投影直接取这一个真实 inputDigest（缺失就明确失败，不能猜），reservation 先落账 `admitted:false`，beforeCall 在同 Run CAS 上只消费一次为 true。persist 只合并计量字段，不能清掉已写 admitted。reported/unknown 用 cleanup signal 保存已发生计量事实，不再检查 fresh Host grant；未知用量保留 reservation。

### 10.3.2 内部 QueryExecutionPort、生产者与局部 expected

以下接口只注入 Runtime 和 QueryJob 的 claim/read 适配，**不作为 platform 对外 writer 发布**。公开入口仍是 claimQuery/readQueryAnswer 与 prepareQuery/startQuery/observeQuery；Host 请求不能提交 terminal JSON。只用一个 `createQueryExecution` owner（`work-graph/queries/query-execution.ts`），同 QueryJob service 转发 claim；不另建 manager、状态库或 Run permit aggregate。

```ts
type QueryEntryIdentity = {
  queryRunRef: QueryRunRef; sessionRef: SessionRef;
  sessionGeneration: number; entryGeneration: 1;
  consumerId: string; kernel: RunExecutionHistoryV1['kernel'];
};
type QueryPreparationFacts = {
  record: QueryExecutionRecord;
  goal: GoalSnapshot; workspace: WorkspaceSnapshot;
  focusPlan: PlanRevisionSnapshot | null;
  initiator: Extract<ActorRef, { kind: 'human' | 'system' }>;
};
type QueryEntryTicket = QueryEntryIdentity & {
  bundleRef: ArtifactRef; inputDigest: string;
};
type QueryHistoryObservation = {
  entry: QueryEntryIdentity;
  history: RunExecutionHistoryV1;
  /** 本轮原记录的位置与 cursor，均由 Session history owner 给出。 */
  source: { position: number; cursor: string };
  observation:
    | { kind: 'entered'; occurredAt: string }
    | { kind: 'progress' }
    | { kind: 'unknown'; reason: string }
    | { kind: 'terminal'; occurredAt: string;
        outcome: 'answered' | 'timeout' | 'gap' | 'failed' | 'cancelled';
        answer: QueryJobAnswerV1 | null; reason: string | null };
};
interface QueryExecutionPort {
  readQueryExecution(ctx: CoreCallContext, ref: QueryRunRef): Promise<ReadResult<QueryExecutionRecord>>;
  readPreparationFacts(ctx: CoreCallContext, ref: QueryRunRef): Promise<ReadResult<QueryPreparationFacts>>;
  claimQuery(ctx: CoreCallContext, request: GraphWrite<{
    queryRunRef: QueryRunRef; sessionRef: SessionRef;
  }>): Promise<WriteResult<QueryExecutionRecord>>;
  bindPreparedQuery(ctx: CoreCallContext, request: GraphWrite<{
    prepared: PreparedQueryExecution;
  }>): Promise<WriteResult<QueryExecutionRecord>>;
  beginQueryEntry(ctx: CoreCallContext, request: GraphWrite<{
    prepared: PreparedQueryExecution; consumerId: string;
    kernel: RunExecutionHistoryV1['kernel'];
  }>): Promise<WriteResult<QueryEntryTicket>>;
  recordQueryUsage(ctx: CoreCallContext, request: GraphWrite<{
    entry: QueryEntryIdentity; entries: QueryModelUsageV1[];
  }>): Promise<WriteResult<QueryRunSnapshot>>;
  admitQueryModelRequest(ctx: CoreCallContext, request: GraphWrite<{
    entry: QueryEntryIdentity; requestId: string; requestDigest: string;
    contextInputDigest: string; manifestDigest: string;
  }>): Promise<WriteResult<QueryRunSnapshot>>;
  recordQueryObservation(ctx: CoreCallContext,
    request: GraphWrite<QueryHistoryObservation>): Promise<WriteResult<QueryExecutionRecord>>;
  readQueryAnswer(ctx: CoreCallContext, ref: QueryJobAnswerRef): Promise<ReadResult<QueryJobAnswerSnapshot>>;
}
```

同 owner 的 `QueryExecutionDependencies` 明确为 `{records: GoalRecordTransactionPort & RecordLookupPort; roles: RoleBindingFactsPort; bodies: Pick<RawArtifactStorePort,'read'>; authorizeConfiguration: AuthorizeQueryConfiguration; now():string; eventId():string}`。`readPreparationFacts` 直接消费本 records 的原 Goal/Workspace/Plan codec，以及下节精确 submission reader；不新增“有效来源”布尔回调。Role facts 仅 claim 时解析并与 Session.role/Job.intent.execution.roleBinding 匹配后随同 guards 保存；后续使用该稳定 pin 与已核 Role 内容，不把当前矩阵变动变成不存在的运行中 Role rebind。

`AuthorizeQueryConfiguration(ctx, input:{job:QueryJobSnapshot;run:QueryRunSnapshot;sessionRole:RoleConfigurationRef;roleResolution:QueryExecutionStateV1['roleResolution']})` 返回 `Promise<ReadResult<{configurationRevision:string; permissions:{tools:string[];writeScope:[]}; hostTemplate:PreparedQueryManifestV1['hostTemplate']; budget:RuntimeBudget}>>`。组合根投影同一 `resolveQueryConfiguration` 的真实返回、既定 Role 上限和 readonly ceiling，不能 echo manifest 声明或恒真。fresh bind/begin/model admit 核当前 Host、原 Session occupancy/generation 及固定 input binding；不是每次调用重读全 Goal/Plan/政策。claim 的 Role 绑定以及首次准备消费的 Goal/Workspace/focus Plan 使用局部 guard。

| 写操作 | caller expected 的确切集合 | 正常消费者/事务事实 |
| --- | --- | --- |
| claimQuery | QueryJob、QueryRun、Session 当前 revision | 公开 Host；内部 guard 正式 Goal/Workspace 与首次 Role facts；Job 仍 pending，Run+Session 同提交。 |
| bindPreparedQuery | QueryRun、Session 当前 revision | prepare 保存真实 body 后调用；raw read 核 Query owner/ref/contentType/digest、scope/generation、既有事实 pin 与 Host 交集；Run 写 prepared，不占模型调用。 |
| beginQueryEntry | QueryJob、QueryRun、Session 当前 revision | start 派生固定 kernel identity；原 receipt 先恢复；fresh 才核 Host/占用及已保存 manifest；Job+Run running/entering 同提交，不把进入事实提前写出。 |
| recordQueryUsage / admitQueryModelRequest | QueryRun 当前 revision | 同一 meter persist / ModelCallAccess；admit 额外 guard 当前匹配 Session；只有 fresh admit committed 可调用 provider，replay 只能停止/观察。 |
| recordQueryObservation | QueryRun 当前 revision | Runtime 原历史 observer；writer 本地读取并 guard 实际 Job/Session，entered/progress/unknown 不释放，terminal 一次写 Job/Run/Answer/Session。不因后来 Host 变化拒掉原 entered/result。 |

所有 write 复用 Store identity/fingerprint/原 event.result 精确重放；事件采用本操作 discriminant/result，不从后来当前 snapshot 重建旧票据。方法自己的 requestId 必须区分操作；entered/terminal 使用原 Run+entry+历史 position 派生稳定键，计量使用原 requestId+usage阶段；CAS 冲突后读当前版本重编同一事实，不能重发 provider。原 expected 与请求必须整份保留作 receipt retry；不得刷新 expected 后继续使用已提交命令的同键。内部 read/历史观察不要求重新满足 fresh admission。

### 10.3.3 answer、原历史与 source 接线

恢复旧纯值形状到 `contracts/query-job.ts`，无需导入旧业务服务：

```ts
type QueryJobAnswerV1 = {
  schemaVersion: 1; answerId: string;
  queryJobRef: QueryJobRef; runRef: QueryRunRef; roundIndex: number;
  answer: string;
  sources: { kind: string; refKey: string; version: string | null; label: string | null }[];
  followsAnswerRef: QueryJobAnswerRef | null;
  stale: boolean; staleReason: string | null;
  answeredAt: string; bodyRef: ArtifactRef;
};
type QueryJobAnswerSnapshot = {
  ref: QueryJobAnswerRef; revision: 1; schemaVersion: 1; answer: QueryJobAnswerV1;
};
```

首批 roundIndex=0、followsAnswerRef=null；answer 为本轮最后一条非空 assistant 文本，UTF-8 至多 16 KiB，超限/无文本按可解释 gap 关闭，不静默截成成功。最多 64 条实际 source witness；不能复制模型 JSON 的 sources。初始 Goal/Workspace/可选 focus Plan 来源只取本轮原 prepared manifest 已保存的 pin（Plan 业务版本取 PlanRevisionSnapshot.planRevision，不取 immutable row.revision；PlanRevisionRef 本身不含业务版本）；终态不得用后来当前事实替换原来源，当前变化仅标 stale/staleReason，不阻止既成回答落账。源码 witness 来自本轮成功 `project_source` 结果（capture ref、query 所引用 capture、read 的 version/path/digest）。refKey 使用实际返回 ref/定位值的 canonical JSON，version 使用实际 digest/version，保留捕获范围，不把 read 过一个文件说成验证整个仓库。`stale:false` 只描述本回答记录时的观察，并非未来有效承诺；没有重新核来源就不声称 current applicability，未来 Plan 采用仍有自己的判断。工具 error 不产生成功 source witness。

query-observation 用 `createSessionHistoryCursorOwner.completedBoundary/readPositionWindow` 解原 historyCursor 和按位置分页；用公开 Kernel `sessionRecordSchema/createInitialRunState/reduceRunState/validateRunStateInvariants/assertTranscriptExchangeIntegrity`，不另写 reducer。start 的 awaited before_model 从原 `turn.started` 取得 startPosition 并调用 recordQueryObservation(entered)，记录后才放行 ModelCallAccess。before_model 可执行多次，entered 已提交时只读确认，不重复造 entered。terminal 必须来自本轮真实 run.completed/failed/cancelled/limit_exceeded，结合原 Kernel reducer/invariants、所有工具收束及 transcript 完整交换判据确认，无 outcome_unknown/未配对 exchange；冻结 Kernel 没有 turn.finished 事件，不新增该事件或校验。最后边界 cursor 由同 owner 返回。未知/缺页保留占用，observe 不重跑模型。尚未 settled 的 query 必须保留 entry/kernel，即便 entered 写响应失联，observe 仍能从已固定 identity 和 priorHistoryCursor 找回事实。

答案 body 用现 MaterialPort，以绑定原 submission initiator 的 `query_run` ctx / 同 QueryRun materialReader，`origin:{kind:'execution',ref:queryRunRef}` 保存；不能用 Host ctx 冒充 execution origin（现 Material writer 会拒绝）。内部准备 body 可沿已有 raw put `origin:{kind:'run',owner:queryRunRef}`，正式 bind 再核；两者均用原同一 body store，不开放 grantless current read 工具。terminal 观察用 cleanup signal 保留晚取消后的真实结果；原循环 finally 返回/资源已排空才尝试最终释放。进程重开无法证明未收束时只返回 unknown，不伪造 close 成功。

在 `source-authority-ports.ts` 增加可选 `readQuerySubmission(ref:QueryJobRef):Promise<ReadResult<QueryJobSubmittedEvent>>` 到 SourceSnapshotReads；正式组合根实现并注入，旧 Work 调用者不用 events。reader 依赖增量 `records?:GoalRecordTransactionPort`，正式 Query 必須同一 records；未注入保持 Query 明确 unsupported。Job load 和 submission 使用已合入 query codec，submission 走 Job.locator→lookupCommit→eventAt，不扫事件。`createQuerySourceCaptureFactory` 接受 `SourceSnapshotReads & Partial<Pick<SourceAuthorityReads,'events'>>`：有新 locator 就仅用 exact 方法；只有明确无 locator 的旧调用者可以走已有实际 events 兼容分支，不制造空页。

### 10.3.4 Runtime 接口实际落位与 scope 足够性

RuntimeExecutionDependencies 增加可选 `queryExecution?:QueryExecutionPort`（保持旧 Work 调用者类型兼容）；QueryPreparation/Driver/Observation 的依赖通过 Pick 此字段和现有 bodies/materials/kernelStores/workspaceHost/sourceAuthority/sourcePolicyFor/host/kernel/clock，内部构造的 observer 同时给 start 与 observe 使用。RuntimeHostBindings 新增可选 `resolveQueryConfiguration`，不改 Work resolveConfiguration；Query method 在缺依赖时明确 unsupported。三条 Query Runtime 方法在 createAgentRuntime 和 createTargetPlatform 的 tracked wrapper 上真实存在，close 沿同一个在途计数等待。

唯一必要的 ModelCallAccess 适配放新 `agent-runtime/query-execution.ts`，不改现 Work `model-call-access.ts`；bind 核正式 prepared，beforeCall 调 admitQueryModelRequest。`new ModelBudget` 的 persist callback 调 recordQueryUsage，映射上述实际 digest/计量；同一次 fresh start 的整轮工具往返共用它。Kernel runObservedModel / meter / 原 Session owner / source tools 无需改接口或构建产物，故仍恰为 17 prod+2 tests。没有新的 public Kernel 方法需求；源工厂参数的窄兼容扩展落在原已列文件。所有新能力仅 stage1 声明、接线与 unsupported，不能靠提前实现状态推进让骨架测试变绿。

中审冻结补充（2026-09-26）：`QueryExecutionRecorded` 事件同时持久原 `identityKey/fingerprint` 和 `payload.result: QueryExecutionRecord | QueryEntryTicket | QueryRunSnapshot`。`lookupCommit→eventAt` 恢复该次原值，不能从后来 Session/Run/Job 的当前状态拼旧回执。该字段归原 Query codec，不另造 receipt owner。

真实 source 消费者另复用既有 `RuntimeExecutionDependencies.sourcePolicyFor`：`TargetPlatformOptions` 只增加同型可选配置并原样透传到 Runtime；受信 Host/fixture 提供，缺失时原源码工具保持不可用，不暗造全量授权。Query Host 投影在实现阶段消费 claim 时已解析的稳定 Role 内容、当前 Host grant 与 readonly ceiling；不得加入 Role 热换重读。

### 10.4 持久状态与一次真正执行

QueryRunSnapshot外层@1及唯一materials/record-readers注册保持；`run.execution`保留现V1 request形状供source factory使用。另加可选版本化`run.executionState`承载以下已有语义值，不把历史缺字段解释为可启动：

- SessionRef、Session generation、原 RoleConfigurationRef；entryGeneration 及 phase（claimed/prepared/entering/entered/unknown/settled）。
- prepared ArtifactRef/inputDigest、Host configurationRevision、实际只读工具/预算、原完成历史 boundary。entry 的 CAS 版本直接使用 QueryRunSnapshot.revision，不另加重复 revision 字段。
- Kernel adapterId/kernelSessionId/runId/turnId和复用RunExecutionHistoryV1的定位；Kernel身份由可信writer/Runtime派生固定，不由模型输入。
- 同轮ModelBudget reservation/reported/unknown条目与已实际准入请求身份，采用原requestId/digest；不使用Work ModelRequestPermitRef、不额外新建模型许可数据库。

预算持久字段在`contracts/query-job.ts`定义为Query领域事实投影：`{requestId, requestDigest, reservedInput, reservedOutput, inputTokens:number|null, outputTokens:number|null, cachedInputTokens:number|null, usageStatus:'reserved'|'reported'|'unknown', admitted:boolean}`。Runtime把实际MeterEntry映射进该记录，不让WorkGraph/contract反向import `agent-runtime/model-budget.ts`，也不复制计量算法；admitted只由Query正式请求准入提交设置，不把usage reported当成获准进入。首批不从旧记录恢复meter重跑，故无需引入未有的通用budget hydrate生命周期。


claim一次提交QueryRun+Session occupancy，Job仍pending，不触发Kernel；按原Session active/health/empty occupancy、Role facts和同Goal/Workspace局部guards受理。准备按Query自身Goal/question生成有界manifest，经已有raw body `origin:{kind:'run',owner:QueryRunRef}`保存；内部准入精确核contentType/ref/digest/owner，不能读取任意Artifact。pending自己的manifest不冒用current材料授权。新prepare可保存不可执行的body，只有正式binding受理才获得后续依据。

fresh begin核当前实际 Host、已绑定稳定 Role 上限、Session 占用和已存 manifest（不重解析当前矩阵或引入 Role 热切换），CAS使entry进入entering，Job/Run running；**只有replayed:false的fresh begin获准调用一次runObservedModel**。运行前的原receipt/已有entering、entered、unknown或terminal路径只观察，不先按现在的Host重新准入，也不启动第二provider。before_model awaited hook读取原Kernel turn.started事实并记录entered后才continue；缺真实历史则停留未知。每个真正provider请求在ModelBudget保存reservation后，沿现ModelCallAccess的beforeCall接口由Query writer确认原entry、Host授权/来源和该request准入；usage未知保留reservation，后来的记录不因撤权丢弃。初始问题/工具往返共用一个meter与deadline，不重置上下文预算。

当前runObservedModel把`allowedTools:['read']`同时展开builtin read和exploration工具；**不能只保护project_source而漏掉builtin read/search/source_excerpt**。Query薄driver通过已有SourcePolicy/WorkspaceHost获得同一allowsRead和根身份，给sourceTools.allowedPath/assertCurrent以及现有awaited before_tool边界传递同一资格判断；复用Kernel权限策略，不把readOnly标记当文件授权。frozen first_use保留，工厂失败不fallback legacy_live，所有句柄由原循环finally实际排空。

终态来自原Session的本次完整Turn：复用ExecutionHistoryPort原区间分页及Kernel transcript integrity检查，提取本轮最后assistant message与实际成功工具输出中的source witness；不扫描全Session、不采信模型自报sources，不使用旧Query的trace内存副本。完整terminal+工具收束后，回答正文先用同一MaterialPort保存（真实Query execution origin），然后QueryJob/Run/Answer/Session匹配释放+事件/回执一次Store提交。Answer类型按旧QueryJobAnswerV1/QueryJobAnswerSnapshot必要字段恢复，正文有界16KiB，bodyRef指向同一Artifact store；source/gap/stale明确保留。answered/closed不能从signal sent或无事件推断；未知保留occupancy，原历史事实入账不重走fresh权限链。按Runtime close实际排空与原Generation释放，不实现自动冷恢复。

### 10.5 精确原始来源与schema复用

沿R5b.1新Job.submission的identityKey/fingerprint查lookupCommit，再以原cursor调用eventAt，核eventId、QueryJobSubmitted、immutable intent和完整Job/Run ref，取得真实human/system actor。`source-authority-reader.ts`复用同一records和query-record-codecs补QueryJob load及这个窄submission reader；源码工厂新链走精读，不提供假events、全事件扫描或默认actor。旧未有locator的兼容调用者保留旧明确边界，不把它提升为正式可执行Query。

该精确reader通过`SourceSnapshotReads`的Query专用窄扩展提供，现Work读取接口不强制events；createQuerySourceCaptureFactory在正式locator路径消费它，原events兼容分支不作为新生产路径。原loadCurrentQueryState仍负责running/job/run/request/role身份一致性，不在工具组各复制一份。QueryRun schema仍materials/record-readers唯一owner；QueryJob/Answer及执行事件归现queries/query-record-codecs，不另注册第二份QueryRun。

### 10.6 首批精确文件候选与交付

在R5b.1导入后重新冻结以下 **17生产文件**（相对next）；当前不写源码、不自动扩大成整个Runtime重构：

1. `src/contracts/query-job.ts`：Query执行binding/answer最小DTO；旧pending/历史兼容。
2. `src/contracts/core/prepared-execution.ts`：PreparedQueryExecution与有界manifest类型，不强转TaskManifest。
3. `src/core/work-graph/queries/contracts.ts`：同Query port追加claim/answer，内部entry/预算/观察类型。
4. `src/core/work-graph/queries/query-job-service.ts`：现pending服务发布执行接缝，原submit/read保持。
5. `src/core/work-graph/queries/query-record-codecs.ts`：Query执行/Answer事件codec和schema；复用已合入pending。
6. `src/core/work-graph/queries/query-execution.ts`（新）：Query自己的claim/entry/request事实/answer/terminal写，复用同一Store和Session记录。
7. `src/core/work-graph/materials/record-readers.ts`：唯一QueryRun schema接受新增versioned binding，旧记录兼容。
8. `src/core/work-graph/source-authority-ports.ts`：QueryJob/submission精确读接缝。
9. `src/core/work-graph/source-authority-reader.ts`：精确Job/原actor provider，复用既有reader/codec。
10. `src/core/agent-runtime/ports.ts`：同Runtime新增prepareQuery/startQuery/observeQuery。
11. `src/core/agent-runtime/execution-contracts.ts`：Query真实Host配置分支与实际依赖形状。
12. `src/core/agent-runtime/runtime.ts`：装配Query薄路径，Work不受缺Query Host影响。
13. `src/core/agent-runtime/query-preparation.ts`（新）：Goal/Role有限准备与自己manifest。
14. `src/core/agent-runtime/query-execution.ts`（新）：一次fresh调用、awaited entry/model边界、唯一runObservedModel与原资源清理。
15. `src/core/agent-runtime/query-observation.ts`（新）：原Kernel本轮分页/答案/来源观察与终态提交，无第二transcript。
16. `src/core/agent-runtime/source-capture-access.ts`：原Query工厂接正式submission locator及已接受binding。
17. `src/composition/create-platform.ts`：同instances/schema/trackedCall/close与可信Host注入，root持有共享写权。

现ModelBudget/Kernel/runObservedModel可直接复用，本候选不为纯TaskBudget名字扩大scope；如准备时发现实际API缺失，列具体符号让主审收敛，不偷偷复制循环。现 Task driver/Work entry/model permit、M1 grant writer 及共享 helper 均只读；已合入 R5b.1 的原 submit/read 行为保持。

建议只 **2测试文件**：`tests/work-graph/R5b-query-execution.test.ts`、`tests/runtime/R5b-query-session-loop.test.ts`。前者用公开pending/Session链核claim→binding→正式观察及同槽释放；后者是真SQLite/原Kernel/受控provider的正常端到端，至少真实project_source工具往返、正式answer、原Session历史和重复start无新Turn，且无Plan/CompletionPolicy。必要权限与unknown边界在同组关键断言中表达，不铺交叉矩阵、Role热换或维护/冷恢复场景。骨架测试断最终行为，在新增入口unsupported首红后诚实报告未达；真实producer尚未导入导致前置红也必须分开。两阶段、最小必要邻接、完整正常E2E优先，不能再把局部状态PASS当MVP已经执行。

## 11. 下一实际消费者：正式回答 → 初始候选 → 采用 → Workflow

2026-09-26，Query execution 与 Workflow advanceWork 实现已独审导入；现在按12路径 scope从最终main准备初始 Plan 第一阶段。本节承接 §10 的真实单轮 Query answer 和 [已有 Plan 推进](R5-workflow-advancement-skeleton.md)，不新建 planner manager、候选库或业务事实 owner。先交付已有真实答复的消费链；用户目标的前段继续用正式 createGoal → submitQueryJob(initial_coordination) → Session/Query claim/prepare/start/observe，不能以临时模型请求或假 Task 得到答案。Query 执行实现、Workflow advanceWork 与本节共享文件由主审串行刷新；当前按已验收最终main派发初始 Plan 骨架，不修改其余在途 lane。

### 11.1 已核真实复用与三处必要缺口

1. PlanTaskPort.proposePlan 已是唯一候选 writer，applyPlanChange 已有原回执、治理、编译及一次提交；初始分支对 `draft.origin` 仍 unsupported。本批替换这一具体缺口，原 Host 无 origin 的合法路径与 W2 已接受 Plan 的 future-only 写入保持。
2. `InitialPlanOrigin` 已有 answerRef/answerDigest/goalRevision/workspaceRevision/requestId/summary/assignments；不要建第二来源记录。旧 `normalizeInitialPlanProposal` 的确定性身份/来源核验思路可复用，但旧 parser 强制 schema v1、2–16 个全 required 任务、每个 work 都有 assignment，并猜 `answer.sources.goal.version` 是嵌入的 Goal JSON，不能直接迁入。当前 Query 的正式 Goal/Workspace pin 在 PreparedQueryManifestV1，v2 未来意图已允许 plan_only 无分配/验收。
3. 当前 Workflow `handleGoalInput` 仍 N0 unsupported，`advanceWork` 已单独冻结“已有 Plan”的有限推进。不把两者换成第二控制循环；只加消费答复、采用后的薄 handoff，后继沿现 advanceWork。秘书/参谋/书记三个真实 FileSkillLoader 资源已存在，参谋内容目前仅讲已采用 Plan 的 future tools，没有初始规划答复协议。

### 11.2 同一 Plan owner 的两个窄消费步骤

在现 PlanTaskPort 添加一个入口，输入不接受调用者 draft/origin/assignments/digest；计划来自正式答案的唯一转换：

```ts
type InitialPlanDecision = {
  status: 'needs_decision';
  answerRef: QueryJobAnswerRef;
  summary: string;
  questions: string[];
};
type InitialPlanProposalResult = WriteResult<PlanProposal> | InitialPlanDecision;
proposeInitialPlanFromAnswer(ctx: CoreCallContext, request: GraphWrite<{
  answerRef: QueryJobAnswerRef;
  reason: PlanChangeReason;
}>): Promise<InitialPlanProposalResult>;
```

这是 Plan service 内的薄适配：读取并解释原回答，计划分支调用既有 proposePlan 路径，仍产生同一个 candidate_v2 和 PlanProposalRecorded；needs_decision 分支只返回原答复的问题，无 candidate、无写入、不编造 Decision。在适配第一次 await 前隔离输入与可信 ctx。原 proposal identity 由相同完整 GraphWrite/actor 产生，恢复原回执优先；已提交候选的重放不能因后来来源变化失败。必要时在同一 plan-service 内抽现 propose 的局部共同函数，不能新建第二提交算法。

正式采用仍只调用原 `applyPlanChange(ctx,{input:{proposalRef,expectedProposalRevision,decisionRefs:[]},meta})`。对 model_coordination origin，从真实答复重算完整 normalized draft 并精确比较，随后继续原 resolveGovernance/validatePlanDraft/validatePlanAssignments/compileInitialPlanAdoption。origin 不删除、不改成人工来源；模型没有治理/工具/执行授权。缺初始架构/CompletionPolicy 仍允许回答、候选与查看，apply 返回真实缺口。既有治理由原正式配置入口补齐，不能自动创建空治理或强加独立审批流程。

### 11.3 唯一 v2 normalization 与角色/Skill

在现 `contracts/initial-planning.ts` 声明版本化 `InitialPlanningResponseV2`，在同 Plan 模块一个纯 normalization 文件实现 JSON 解析和确定性转换：

```ts
type InitialPlanningResponseV2 =
  | { schemaVersion: 2; kind: 'needs_decision'; summary: string; questions: string[] }
  | { schemaVersion: 2; kind: 'plan'; summary: string;
      plan: Omit<Extract<PlanRevisionDraft, {schemaVersion: 2}>,
        'planId' | 'planRevision' | 'goalId' | 'origin'> };
```

Plan 身份按已保存 Job intent 的 project/goal/intentId 和既有 canonicalJson/SHA-256 确定，planRevision=1；任务语义不由 parser 决策。assignments 使用 `response.plan.assignments` 的唯一位置，origin.assignments 复制该规范结果，不出现两套可冲突的模型字段。InitialPlanOrigin.answerDigest 为实际答案文本 UTF-8 SHA-256；requestId 保持旧语义的 intent.intentId，**不是**本次 GraphWrite meta.requestId。Goal/Workspace revision 取真实原 manifest。原 answer/body 和 origin 均保留。

这里明确升级旧回复协议，不沿旧 parser 的“全部 required / 每 work 分配 / 固定至少两个任务”附加产品条件。结构大小沿已有有界 answer 与 Plan DTO/原 validator；显式 plan_only 可以只有基础意图、无 assignment/验收；request_execution、义务、DAG 等继续同一个 W2/Plan 规则裁决。parser 不替模型补 gate、依赖、验收、分配或把可选变必需，也不把所有缺项改成 needs_decision。needs_decision 只表示模型明确提出的真实产品/授权问题，不是每份计划的必经人工确认。

更新现 platform-adviser/content.md，区分“无采用 Plan 的 initial_coordination：按此 v2 协议作只读答复”与“已有 Plan 的未来修订：原 W2 tools”。Query preparation 只在已核 initial_coordination 的该请求中注入同一响应 guide；真实 FileSkillLoader 按原 Role/Host 配置装配参谋 Skill，不据用户文字关键词切角色、不制造新 Role grant。Query readOnly 工具上限保持，不给初始 Query 注入 apply/propose 写工具。秘书/书记无需改；普通实施 Task 的 role 字符串必须能映射现 WorkflowHostConfiguration 的正式 binding，否则 Workflow waiting，不由 normalization 自造 bindingId/Role pin。

### 11.4 原答复身份与历史 provenance，沿原采用规则

Plan service 的现 records/materials 已能复用：用现 Query codecs 精确读 Answer/Job/Run；核同 project/workspace/Goal、Job.execution.kind=initial_coordination、answer 与 Job.answerRefs/Run 身份一致、真实 settled answered 与 Query owner 已持久化的 observation 终态及其原历史 locator。这里的“完整 history”只指 Query producer 已根据原执行观察确认并保存的事实：完整性与终态由原 Query/Runtime 观察链负责，Plan 消费其正式记录与精确定位；Plan 不调用 Runtime、打开 Kernel Store 或重新扫描 transcript 来再次证明结束，不引入反向依赖。读取原 answer body 使用已存在 MaterialPort 的 Host historical_explanation 资格，并核完整 ref/digest/原内容；该读取不构成任何模型 current grant。读原 prepared bundle 仅沿已核 QueryRun.executionState.prepared.bundleRef：复用 RawArtifactStorePort.read 核 contentType/digest/owner=该 QueryRun，解析 frozen PreparedQueryManifestV1。由其中原 Goal/Workspace pin 填 origin 的历史版本，不信任 sources label 或模型自报 Goal JSON，不重新要求已结束 Query 占 Session 或满足当前 Role 准入。

PlanServiceDependencies 只需窄增可选 `initialPlanning:{bodies:Pick<RawArtifactStorePort,'read'>}`，由组合根注入同一 bodies；材料正文复用现 materials。缺依赖仅使新 model-origin 消费明确不可用，旧 Plan 路径不新增 I/O。没有新的 source provider、当前源码 pin、SourceApplicabilityPort 注入或 Query DTO/producer 扩围。

正式采用沿原 owner 的结构、真实 Host 权限、同 Goal/Workspace、当前 Goal 尚无 adopted Plan、proposal revision、正式治理及局部 CAS。model_coordination 分支增加的校验只证明实际 Answer/Job/Run/正文身份与唯一 normalization 所得 draft/origin 一致，禁止借别人的答复、伪造正文 digest 或手改 draft 却冒充原模型方案。实际读到的 Answer/Job/Run/Goal/Workspace/proposal/治理版本进入原局部 guard；origin 中历史 Goal/Workspace revision 用于 provenance，不自动变成对当前版本的额外相等门槛。caller 的实际 expected 仍由原 owner 核对。既有 apply receipt 始终优先恢复。

代码 capture、文件 digest、来源选择和答案 stale/gap 标记说明模型产生建议时观察了什么及其限制。后来源码改变、capture 随 Runtime 关闭释放、历史来源现在不可重开，均不因这一个事实自动否决整个候选或 Plan；保留原 witness，不抹掉来源、不重新标为 current，也不为了规划采用扫描全库重新证明它们。future plan_only 本来可以无完整验收、分配和来源材料。若某个后续 input/执行/检查动作已有明确 current 材料要求，在那个实际消费点继续由原 Material/Task/B2/Evidence owner 核验，不将其提升成白板入图前提。普通候选/图读取不重跑完整来源链。

### 11.5 Workflow.handleGoalInput 的有限接线候选

先在现方法增加“已有正式答复”的窄判别输入，不重写在途 advanceWork，不强行一次迁入模块设计里全部解释/重写/维护协议：

```ts
type InitialPlanningGoalInput = {
  schemaVersion: 1;
  goalRef: GoalRef;
  flowId: string;
  sessionHint: SessionRef | null;
  executeWithinRequest: boolean;
} & (
  | { kind: 'planning_answer';
      request: Parameters<PlanTaskPort['proposeInitialPlanFromAnswer']>[1] }
  | { kind: 'adopt_initial_plan';
      request: Parameters<PlanTaskPort['applyPlanChange']>[1] }
);
// handleGoalInput input: N0GoalInput | InitialPlanningGoalInput
// return: CoreRejection | {status:'ready';value:{
//   state:'proposed'|'needs_decision'|'advance'|'waiting';
//   receipt: InitialPlanProposalResult | WriteResult<PlanRevisionSnapshot>;
//   next: {kind:'goal_input';input:InitialPlanningGoalInput}
//       | {kind:'work';input:WorkflowAdvanceInput} | null;
// }}
```

每次 handle 调**一个**原 owner。planning_answer 委托新 Plan 薄入口，needs_decision 原样返回问题；candidate 回执后，executeWithinRequest=false 时 proposed/next=null，用户仍可查看、解释与随后明确采用。已有请求授权允许继续时生成包含实际 proposalRef/revision 的 adopt_initial_plan 下一请求，不强加确认；采用成功且允许执行时返回现 `advanceWork` 的 select_work 输入，复用同 flowId/sessionHint。缺治理、原答复记录或正文不可核、Role配置不匹配等返回 waiting/原 receipt，不启动补偿循环。原 request/expected 固定保存，身份生成沿 R5c.1 的既有规则；同 key 不刷新 pins。

`executeWithinRequest` 只是本次用户指令是否要求推进，不是绕过 Core 的执行权限字段；Host/Role/claim/B2 的真实授权保持。Workflow 不读 Store、不重算 draft/source、不制造 PASS/Query答复；Plan service 决定来源与采用，之后 Workflow 的原十种 owner 步骤决定执行。此新增输入不假装实现旧 N0 request_work 的“从零自动规划”全部协议；用户输入前段的最小缺口是可信 planning Role/Session/预算配置以及把 createGoal/submit/claim/prepare/start 的原结果传给此入口。后续 Host 用已经冻结的公共入口驱动该前段，不新建 planner manager；不能将尚 unsupported 的 N0 分支展示为已接通。

### 11.6 最小落位、并行边界与正常链验收

正文设计已收敛为 **10 生产路径**，对应 [初始计划第一阶段任务](R5b-initial-plan-skeleton.md) 与 [12 路径 scope](R5b-initial-plan-skeleton-scope.json)。Query 执行与 Workflow 实现现已独审导入，已核对 fresh main 并建立3个占位和固定selector，现派发第一阶段：

1. `src/contracts/initial-planning.ts`：v2 回复/规范化结果值类型，保留原 origin。
2. `src/core/work-graph/tasks/plan-contracts.ts`：新薄入口与结果联合。
3. `src/core/work-graph/tasks/initial-plan.ts`（新）：唯一纯 normalization 与窄来源读函数，运行依赖单向；不创建服务实例/端口/库。
4. `src/core/work-graph/tasks/plan-service.ts`：适配原 propose/初始 apply、实际 Answer/Job/Run/正文身份核验及实际读集的局部 CAS。
5. `src/business/workflow/contracts.ts`：窄 GoalInput/result union。
6. `src/business/workflow/ports.ts`：现 handleGoalInput 输入/返回增量，仍用同 plans。
7. `src/business/workflow/workflow.ts`：两个有限 handle 分支与现 advanceWork handoff。
8. `src/composition/create-platform.ts`：同 bodies 窄依赖注入 Plan 及 tracked 方法发布；records/materials 沿现实例，保留 Query/Workflow 在途最终实例，不新增 source 注入。
9. `src/core/agent-runtime/query-preparation.ts`：initial_coordination 的同一响应 guide 注入，普通 Query 不变。
10. `resources/skills/platform-adviser/content.md`：初始只读答复与原未来写工具职责区分。

`next/runtime-assets.json` 已锁定 `resources/skills/platform-adviser/content.md` 的 SHA-256，属于主审集成所有权，**DSH 只读、12 路径 scope 不扩大**。中审冻结参谋 Skill 后，主审只更新该资源条目的 SHA，刷新 lane 内只读 runtime-assets manifest 及相应只读快照 hash，不改冻结写入基线；再运行 architecture 边界与 import 检查后集成。DSH 若在冻结前遇到此条旧 SHA 不匹配，报告实际内容 hash 与检查结果，不越界改 manifest，也不能跳过更新后的最终边界验证。阶段一仅 DSH 按 scope 修改参谋 Skill；manifest 实际值在中审冻结时由主审单项同步。

以上十路径以 R5b.2 的正式 Answer/Job/Run/原 manifest producer 和现 Workflow 推进入口验收为准备条件，不追加 Query 来源 DTO 或实时源码门禁。不得同时与在途 Query execution/Workflow implementation 写相同文件；R6 Session/mailbox 仅 app/UI，可继续并行。

验收只准备两组正常产品链，待统一接口冻结后再落测试，不先铺失败矩阵：真实无 Plan Goal + 正式 initial_coordination Query answer → candidate（保留 optional plan_only）→公开补齐必要治理→原 apply → queryTaskGraph；以及相同来源采用后 handleGoalInput 返回现 Workflow.select_work，沿已经验收的真实执行/检查/完成链推进。回答来自真正 Kernel/受控 provider，不能 seed Answer；源码调查使用实际工具结果留下的历史 witness，不伪造来源，也不将它们当作当前源码合格证明。required reviewer 未接仍 incomplete，required future 仍等待，已有正常政策不被额外条件挡住。needs_decision 与治理缺口保留为链内真实可见分支，不新增成全排列矩阵。

补齐治理之后沿原 apply 使用实际当前 caller pins；不因历史来源版本不同机械要求再跑 Query。只有原 owner 的具体结构/权限/CAS/身份要求不满足时，才按该真实结果处理。主审先确认骨架不带偏、必要 producer 可达，再一次进入实现；完整 E2E 优先，不以局部测试更漂亮增加返修轮次。R5b.2 执行、初始候选/采用、原 N0 从零输入消费及 Host 自动续传各自已达/未达状态要诚实，不把本节规划写成现成产品能力。
