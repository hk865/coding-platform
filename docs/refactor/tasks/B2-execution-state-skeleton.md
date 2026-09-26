# B2 WorkGraph 执行状态骨架草案

状态：**主 Agent 已审定架构/接口方向，批准第一阶段骨架与测试；尚未实现。** 2026-09-26。本文只定义 WG 状态 lane 的拟议骨架、契约与测试；Prepared 字段和 Runtime 装配由主审与 Runtime lane 联合核定。阶段一只交类型、明确 unsupported 的生产骨架及行为测试，主审中审通过后才进入实现阶段。

W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。WG lane 拥有本批共享 dispatch、Prepared 契约及 WG schema；Runtime lane 不并行改这些文件，主审冻结后向 Runtime lane 刷新只读副本与 manifest。真实组合根接线由主审分配唯一 owner。禁止修改原工程、冻结 Kernel 或直接写 dist；禁止独立模型、另起入口数据库、另造完整日志。

## 1. 必读与明确复用

先读 docs/AGENTS.md、PRODUCT.md、refactor/{ARCHITECTURE,IMPLEMENTED-CAPABILITIES,DSH-WORKFLOW}.md、modules/core/work-graph.md §6.3、modules/core/agent-runtime.md §7.1、IMPLEMENTATION-PLAN.md 的 B 路径，以及本批 Runtime 草案。沿以下提供者实现及测试核对，不能仅引用函数名：

| 现有能力 | 实际符号与文件 | 本批用途 |
| --- | --- | --- |
| Claim 与完整身份 | tasks/claim-service.ts:createTaskClaimService；claim-record-codecs.ts:taskClaimProblem、taskAttemptRefKey、dispatchOutboxRefKey | 复用原 Claim 与 Session generation，不重新 claim |
| 精确执行事实 | tasks/run-state-service.ts:createRunStateReader | 复用 Run/Attempt/outbox/Plan/Session/Lease 同窗口核验；查询不授执行权 |
| WG12 历史定位 | tasks/execution-history-service.ts:createExecutionHistoryService；persistence/execution-history-codecs.ts:isRunExecutionHistoryV1 | 固定 Kernel 身份/start、单调水位、一次确定 end、唯一身份槽、原事件重放 |
| 角色事实 | configuration/contracts.ts:RoleBindingFactsPort；role-memory-service.ts:resolveRoleBindingFacts | 复用角色解析及其精确 read/absence guards，不复制解析器 |
| 当前任务输入 | tasks/plan-service.ts:readTaskInput；materials/material-service.ts:openArtifact；materials/applicability.ts | 固定 accepted Plan 输入 ref，当前 grant/source 校验，不把 Host current 拒绝改成允许 |
| 正文完整性 | contracts/artifact.ts:artifactBodyDigest/artifactBodySize；record-store/body-ports.ts:RawArtifactStorePort | 验证本 Run 装配正文，复用现有 body store，不公开裸读端口 |
| 原子事务 | record-store/ports.ts:PreparedCommit/RecordGuard/UniqueClaimChange；lookupCommit/commit/eventAt | 局部 CAS、唯一身份、原事件重放；不锁全账本水位 |
| Session 目录 | sessions/session-record-codecs.ts:encodeSessionRecord；session-directory.ts:availabilityOf | 同代次释放后按 health 派生 idle；保留 active 与架构关联 |
| 图状态 | tasks/plan-readers.ts:readCanonicalTaskFacts/projectLease/readFutureTaskMutationFacts | 释放与 W1 历史痕迹兼容；Run 完成不等于 Task satisfied |
| 既有模型调用接缝 | contracts/dispatch.ts:ModelCallAccess/RuntimeInputBindingV1；agent-runtime/observed-model-run.ts | 保持 bind/beforeCall，真实 stream 请求先许可再消费 |

源码中的 sessions/session-state.ts、tasks/execution-guards.ts 目前只是目标布局文档路径，不是已有可调用实现。旧 src/contracts/execution-authorization.ts 也没有 next 对应文件；不得写成已复用 next 实现。

## 2. 共享 Prepared 正文与返回值

共享新类型拟放 T/src/contracts/core/prepared-execution.ts。正文是一份 bounded JSON Artifact，`envelope.bundleRef` 是唯一引用，不再增加同义 manifestRef。正文不嵌自身 ArtifactRef/digest，避免循环摘要。完整 Session 原历史不拼进 input；历史装配仍由 Kernel 负责。

以下为主审冻结字段方向；公开类型在骨架中落地后仍须中审。不能由 WG lane 自行改变提示词、Host 配置或预算算法。共享文件不得 import WorkGraph：将已有 TaskClaim 声明原样移至 contracts/core/task-claim.ts，并由 claim-contracts.ts 兼容 type re-export，所有消费者只保留一个声明。KernelExecutionBinding 复用 core/execution-history.ts 中的 kernel 形状，不从 dispatch 反向 import tasks。

```ts
type PreparedTaskManifestV1 = {
  schemaVersion: 1;
  kind: 'task_execution';
  claim: TaskClaim;
  role: RoleSpecResolutionV1;
  // absent 兼容只能来自可信 Host 已配置的版本化模板。
  hostTemplate: { templateId: string; revision: string; digest: string } | null;
  roleBinding: RoleBindingRefV1;
  hostConfigurationRevision: string;
  sessionRole: RoleConfigurationRef;
  workspaceSnapshot: { workspaceId: string; revision: number };
  permissions: TaskEnvelopeV1['permissions'];
  budget: TaskBudgetV1;
  selectedTaskInputs: Array<{ requirementId: string; ref: ArtifactRef }>;
  // 来自可信 Host 已核 source pin；不得由模型传入或默认猜值。
  materialBasis: MaterialBasisV1 | null;
  materialAccessRefs: MaterialAccessGrantRef[];
  additionalMaterialRefs: ArtifactRef[];
  deliveryRefs: ModelRequestMaterialPinV1[];
  sourceRefs: SourceRefV1[];
  input: string;
  inputDigest: string;
};

type PreparedTaskExecution = {
  kind: 'task';
  claim: TaskClaim;
  envelope: TaskEnvelopeV1;
  inputBinding: RuntimeInputBindingV1;
};
```

`inputDigest = sha256(UTF8(input))` 与现有 runObservedModel 的 contextInputDigest 一致；`manifestDigest = artifactBodyDigest(原始已保存正文)`，不 parse 后重排 JSON 再算。envelope.bundleRef.digest 必须等于该正文摘要，body 字节数/contentType/ref 全部核对。正文带全部授权声明不意味着声明自动可信：WG 重读当前正式事实与可信 Host 配置才能接受。

Runtime 给调用者的 prepare 结果可只返回 runRef、bundleRef、inputDigest/manifestDigest 和 Claim Session 绑定；公开 start 不接受调用者另传 permissions、输入正文或替换 role。WG 的 Prepared 参数是 Runtime 内部窄接缝，不向模型暴露“自己填权限”的入口。authorize 提交后 Run.envelope/inputBinding 固定；同内容重放恢复原结果，改正文/引用或权限必须拒绝，不静默更新。

角色必须保留 resolved/absent/inadmissible 真实结果。inadmissible 拒绝；absent 不是完全授权，只能使用可信 Host 显式登记且与 claim.roleBinding 对应的版本化模板，否则 unsupported/缺材料。角色上限与 Host 能力取交集，不能调用者声明 tools 后自行获得。预算从正式 Run.budget 继承；Runtime 把 Host 单次容量和既有预算限制合并，不另造隐藏累计总量、不补默认数字。

### 2.1 不制造 starting→envelope 的材料循环

真实 `materials/applicability.ts:createMaterialAccessResolver` 对 Run 读取 workspaceSnapshot/planRef，`currentBasisValid` 不要求 Run running/envelope；`material-service.ts:canonicalRunScopeMatches` 也只核正式 Run scope。因此 Claim 已持久的 starting Run 可由可信 Runtime 绑定 `work_run` principal、真实 runRef/roleBinding 和匹配的 `MaterialReader(kind:run)`，调用 `plans.readTaskInput(current)`。读选中输入不要求提前写 running/envelope。

仍须真实 exact grant 和 source pin；没有授权就拒绝，不能给 starting Run 造空材料结果、伪造 grant 或改 historical_explanation。Host current 现有 source_stale 保留。source capture 则不同：现有源码授权要求真正 entered，继续使用 B1 first_use 消除其执行时序环。

**当前真实装配缺口：** create-platform.ts 的 `createMaterialAccessResolver(reads.authority, reads.index)` 尚未传第三个 sourceApplicability provider，next 也没有正式 grant 生产 writer。B2 不得以测试 seed grant 声称材料生产与当前来源链已经接通。保留 source_stale/forbidden 等真实拒绝；Runtime 正例可使用无外部 selectedTaskInputs 的合法任务，并以正式 Plan/Task 摘要满足经角色规则确认的 contract 材料。角色要求真实外部材料时必须拒绝缺料，不能把任意摘要冒充该要求。currentBasis 只能从 Host 配置的已核 source pin 绑定到可信 work_run reader；模型不得传入。若本批决定接 grant/source provider，主审必须明确新增 scope、生产者/消费者及真实集成测试，否则列为后续缺口。

WG 可信 `deps.bodies.read(envelope.bundleRef)` 仅用于核本 Run 装配正文及 provenance/ref/摘要；不能用此权限读取所有 Task 输入。选中输入必须沿 existing material current 判据核验；材料候选只发现记录，不能用索引存在代替 canonical grant。若准入需要 grant CAS 证据，在原 materials owner 提供最小内部事实/guards 接缝，不复制判据，不假设一次异步读取即无撤销竞争。

## 3. 拟议 WG 窄接口及 expected pins

下列类型置 tasks/execution-entry-contracts.ts，复用现有结果类型。首版只处理 TaskClaim；Query/ReviewWork 缺 provider 明确 unsupported，不强转成 Run。

```ts
type KernelExecutionBinding = {
  adapterId: string; kernelSessionId: string; runId: string; turnId: string;
};
type KernelObservationSource = KernelExecutionBinding & { position: number };
type CompletedHistoryBoundary = { source: KernelObservationSource; cursor: string };
type TaskEntryPermit = {
  claim: TaskClaim;
  consumerId: string;
  entryGeneration: number;
  authorizationRevision: number;
  inputDigest: string;
};
type RuntimeEntryRecord = {
  runRef: RunRef;
  runRevision: number;
  authorization: ExecutionAuthorizationV2;
};
type ObservedExecutionHistory = Omit<RecordExecutionHistoryInput, 'runRef'>;
type TaskResultObservation = {
  claim: TaskClaim;
  entry: Pick<TaskEntryPermit, 'consumerId' | 'entryGeneration'>;
  event: RuntimeEventV1;
  kernelSource: KernelObservationSource | null;
  completedHistoryBoundary: CompletedHistoryBoundary | null;
  history: ObservedExecutionHistory | null;
};
interface ExecutionEntryPort {
  authorizeRuntimeEntry(ctx: CoreCallContext, request: GraphWrite<{
    prepared: PreparedTaskExecution; consumerId: string;
  }>): Promise<WriteResult<TaskEntryPermit>>;
  beginRuntimeEntry(ctx: CoreCallContext, request: GraphWrite<{
    permit: TaskEntryPermit; kernel: KernelExecutionBinding;
  }>): Promise<WriteResult<RuntimeEntryRecord>>;
  recordExecutionEntered(ctx: CoreCallContext, request: GraphWrite<{
    permit: TaskEntryPermit; enteredAt: string;
    kernelSource: KernelObservationSource; history: ObservedExecutionHistory;
  }>): Promise<WriteResult<RunSnapshot>>;
  recordRunResult(ctx: CoreCallContext,
    request: GraphWrite<TaskResultObservation>): Promise<WriteResult<RunSnapshot>>;
}
```

四个写方法的 `meta.expected` **恰为目标 Run 的一个正安全整数 revision pin**；空、重复、额外 pin 或另一 Run 拒绝，不能以刚读到的新 revision 偷换。permit.authorizationRevision 是 entry binding 自身版本，与 Run revision 分离；WG12/模型计量推进 Run revision 不自动改变授权代次。Runtime 需要新的 Run pin 时沿 WG11 明确重读，重试只重提交事实，不重跑模型。

WG 在 commit 中加入所有实际用于判定的局部 guards：Run（调用方 pin）、Attempt/outbox/Plan/Session/当前 Lease，以及 Goal/Workspace/角色指针与规格/材料 grant 等本操作使用的正式版本；无全账本 horizon。读取显式 missing 可作 null guard，未交代或损坏不能当 missing。write context 与输入在首次 await 前快照，保留 AbortSignal。

### 3.1 授权、fresh begin 与 entered

authorize 重读正式 Claim 的全部身份、当前 Session occupancy owner/generation、当前 active/health、Task lease holder/attempt，核 Prepared 正文、Claim role、Plan 输入与 Host 限制。原子保存 envelope/inputBinding 与唯一当前 consumer 绑定。另一个 consumer 不因读到同 outbox 获得第二份授权；本批不自行加入接管、过期自动换代或重入队。

begin 核对当前输入摘要、Session generation、entryGeneration、consumer、authorizationRevision 和控制/角色/材料/资源限制，固定真实 Session adapter/kernelSessionId 与 Runtime 预分配 runId/turnId，authorized→entering。只允许本进程收到 committed 且 replayed=false 后调用 Kernel。重放返回历史回执供解释，但绝不再启动；entering/unknown 不能通过新 requestId 或到期重置。

begin 的 Kernel 身份与 WG12 使用相同唯一 slot 格式。若 begin 先占槽，WG12 不能仍按“executionHistory 缺失→expectedOwner:null”提交；共享 helper 必须辨认已经由同 Run 的新版 begin 绑定持有，使用 owner→owner CAS。不同 Run 永不共占。授权、history 与 slot 不建两套真相。

entered 必须来自 Runtime 已 await 的 before_model：Kernel 原日志已持久 turn.started/run.started，Runtime 取得精确来源后提交。WG核其与 begin 绑定、start/observed range 一致，才将 Run running、Attempt started、授权 entered 与 outbox dispatch 状态同事务写入。starting 可有历史 locator，但不等于 entered。WG 不导入 Kernel，不把 best_effort publish 或未 await 的 onConfiguration 当屏障。

### 3.2 结果、去重与释放

结果 event.runRef、claim、consumer/entryGeneration、Session generation、kernelSource 必须对应完整已绑定身份；eventType/payload 配对、eventId/sequence 冲突与 after_terminal 明确拒绝。事件指纹含 kernelSource/completedHistoryBoundary/history，不能只比较平台事件 ID。GraphWrite 重放恢复原提交结果，不返回后来当前 Run。

Run/Attempt 真实终态与同代次释放同事务：当前 Session occupancy 的完整 RunRef 和 generation 一致才清占用；当前 Lease 的 holderRunId/attemptId 与正式 Run/Claim 一致才写释放痕迹；outbox 原 claim 不改。迟到旧代次可补旧 Run 历史，但不能释放新占用、覆盖新 Session.historyCursor/lastExecutionRef 或当前入口期望。完整终态证据缺失保持 unknown/busy；不能在 finally 自动清占用。

只有 Runtime 核对完整已结束 Turn 生成 completedHistoryBoundary 才更新 Session.historyCursor；其 source 必须匹配固定 Kernel binding/endPosition，opaque cursor 原样保存。observedThroughPosition、平台 commit cursor、墙钟、run.completed 单事件都不能代替完整 Turn 边界。Session 保持 active 及全部有效 links，health=available 时目录派生 idle，不自动 archive。Run ended 不调用 completeTask、不直接写 TaskReduction.satisfied。

## 4. 外层 @1 保留，嵌套明确版本化

`record-store/record-codec.ts:createRecordSchemaRegistry` 拒绝同 aggregateType 的两个 schema。此批**不新增外层 RunSnapshot@2/TaskLeaseSnapshot@2/DispatchOutboxEntrySnapshot@2，不改 Store 注册算法**。原 owner 在现有 @1 codec 内验证可区分新版绑定，旧形状仍可读取。

```ts
type ExecutionAuthorizationV2 = {
  schemaVersion: 2;
  generation: number; // 保留旧字段名；对应公开 entryGeneration
  sessionGeneration: number;
  revision: number;
  consumerId: string;
  inputDigest: string;
  phase: 'authorized' | 'entering' | 'entered' | 'unknown' | 'revoked' | 'settled';
  kernel: KernelExecutionBinding | null;
};
// RunSnapshot.executionAuthorization?: ExecutionAuthorizationV1 | ExecutionAuthorizationV2
// 不另建 RuntimeEntry 记录；公开 RuntimeEntryRecord 仅是该事实的投影。

type TaskLeaseReleaseV1 = {
  schemaVersion: 1;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  sessionRef: SessionRef;
  generation: number;
  releasedAt: string;
  eventId: string;
};
// TaskLeaseSnapshot@1 增加 release?: TaskLeaseReleaseV1；原 holder/attempt 保留。

type TaskDispatchStateV1 = {
  schemaVersion: 1;
  phase: 'entered' | 'settled';
  consumerId: string;
  entryGeneration: number;
  sessionGeneration: number;
  eventId: string;
};
// TaskClaimOutbox@1 增加 dispatchState?: TaskDispatchStateV1。
// status 扩为 pending | entered | settled；后两值必须与 dispatchState.phase 一致。
// 老 pending 无 dispatchState 仍可读，不保留 status=pending 但实际已settled的歧义。
```

这些嵌套字段是草案：主审可调整命名，但必须保持明确版本与唯一解释。旧没有 release 表示旧 active lease，不能通过 expiresAt 猜释放；旧没有新版 entry 绑定不允许 fresh begin。legacy authorization 仅用于历史解释，不自动升级启动许可。不得把缺 schemaVersion 的旧 authorized 当 V2。

`materials/record-readers.ts:validateRunSnapshot` 目前不验证 executionAuthorization/inputBinding，envelope 仅检查对象，本批须补新形状严格校验与关联一致性。claim outbox codec 当前只允许 status pending，扩展 status 时须验证 dispatchState 并保留完整 claim；Attempt codec 已支持 claimed/started/ended，复用它。

Lease release 同步 `plan-readers.ts:validateTaskLeaseSnapshot/parseLease/projectLease/readFutureTaskMutationFacts` 和 WG11 decodeLease。released 当前 lease 派生 free，但 W1 仍把持久 Lease/Run 视为执行过的痕迹，不允许 absent→claimed→absent 的 ABA。不要删除 Lease 后把任务重新解释为 future。

## 5. WG12 内部 compile 复用

从 execution-history-service.ts 当前身份/start/monotone/end 验证及 unique claim 构造提取 `compileExecutionHistoryBinding`（建议文件 tasks/execution-history-binding.ts），这是 WG 内部纯 helper，不是新 Port。输入正式 Run、Claim SessionRef、Session mapping、本次 history 和已核对的 V2 begin binding；输出 next history/Run 字段与 unique claim 变更，或原 rejection。共享 `isRunExecutionHistoryV1`，不再造另一份定位 parser。

原 WG12 writer、entered、result 可复用 helper 形成各自单次 PreparedCommit；禁止在结果事务内嵌调用公开 WG12 writer 导致半提交。WG12 原重放事件保持，新增写操作用自己的严格事件 codec 重放。原 WG12 历史补写仍不要求当前 occupancy 属于旧 Run，也不 guard 当前 Lease；entered/result 的 owner/代次规则属于其各自写操作，不能回归原历史能力。

## 6. model-call 许可复用与新增窄 Port

next 已有 ModelCallAccess.bind/beforeCall 与 RuntimeInputBindingV1；next 没有完整 ModelRequestPermitV1/Snapshot、AuthorizeModelRequestCommand/Receipt、RunFactCommand/Receipt。旧 `coding-platform/src/contracts/dispatch.ts:632–852` 与 `src/control/dispatch-engine/execution/model-call-access.ts` 只读对照，择取纯 DTO、稳定 permit ID 和单次消费语义迁入 next；禁止 import 旧 Ledger/Control 服务。

建议在本 lane 的 model-call-contracts.ts 冻结窄 next Port：

```ts
type ActualModelRequest = {
  permit: TaskEntryPermit;
  requestId: string;
  requestDigest: string;
  contextInputDigest: string;
  manifestDigest: string;
};
type IssuedModelRequest = {
  permitRef: ModelRequestPermitRef;
  permit: ModelRequestPermitV1;
  runRevision: number;
};
interface ModelRequestPort {
  authorizeModelRequest(ctx: CoreCallContext,
    request: GraphWrite<ActualModelRequest>): Promise<WriteResult<IssuedModelRequest>>;
  recordModelRequestAttempt(ctx: CoreCallContext, request: GraphWrite<{
    request: ActualModelRequest;
    permitRef: ModelRequestPermitRef;
    attemptId: string;
    observedAt: string;
  }>): Promise<WriteResult<IssuedModelRequest>>;
}
```

authorize 的 expected 恰为 Run pin；record attempt 的 expected 恰为 Run pin 和该 ModelRequestPermit revision=1 pin，两者均不自动替换。签发时守 permit 不存在；消费同事务 CAS permit 1→2、更新正式运行事实与事件，绑定 exact Run/entry/请求摘要/固定材料与权限。permitId 复用 `modelRequestPermitIdFor(runRef, requestId)`；调用者不能指定不同身份绕过请求唯一性。ModelRequestPermit 是既有调用证据聚合，不是新增 execution 真相表。

ModelCallAccess.bind 只接受与已保存 Run.inputBinding 完全相同的真实绑定；不由任意调用方第一次 bind 获得新权限。beforeCall 在现有实际 stream 边界收到最终请求摘要，先授权，再记录实际尝试；仅 attempt committed 且 replayed=false 允许 provider。已消费重放、同请求改摘要、consumer 换代、已结束 Run、撤销材料或控制拒绝均 provider=0。

若中审决定同时保留旧 RunFact 兼容端口，其 RunFactReceipt 必须仍 replayed:false，以 duplicate/stale/conflict_event 拒绝重复；不能修改旧语义使重放可调用 provider。上述新 GraphWrite Port 即使允许恢复原 receipt，也明确不授再次外部调用。没有 provider ack 字段，meter reported 不是 provider 已接收的证明。累计预算仍用现有 ModelBudget，不在 permit 层造第二个计量器。

## 7. 骨架测试与独立验收证据

测试须复用真实 Claim、RecordStore（memory/SQLite）、Session、Plan、role/material owner；Runtime lane 负责真实 Kernel/脚本模型与组合根整链，WG 不能用 fixture 已 seed entered 证明入口成立。每个测试对应新增时序或身份风险，不重写旧全矩阵。

1. authorize 两 consumer 竞争、相同 request lookup miss 后 commit 重放；仅一当前入口，原回执恢复不读后来状态。
2. begin 相同/不同 request 竞争、回包丢失、重开后 replay：只有一 fresh commit；missing Kernel 不是未执行证明。
3. Prepared bundleRef/body/digest、Claim project/goal/attempt/Session 交叉替换、role inadmissible/absent 无显式模板、grant 在 commit 前撤销均拒绝；starting 下有合法 current grant 的选中输入可读，Host current 拒绝保留。
4. entered 无 begin/错 Kernel Session/run/turn/position、单有 WG12 locator 均不能获得权限；真实 hook 入账失败由 Runtime 测 provider=0/capture=0。
5. Run authorization V1 可读但不得 begin；损坏 V2/inputBinding/envelope/release/dispatchState codec 拒绝；旧 schema 不删除。
6. begin 持有同 Run Kernel slot 后 WG12/entered 可继续；不同 Run 抢同 slot 原子失败、无孤立记录。
7. result event 重复/倒序/同序改 payload 或 source、完整 Turn boundary 缺失、未知错误不误释放；同 owner/generation 终态一次更新所有正式记录。
8. 旧代次终态补历史不释放新 Session/Lease、不推进新 cursor；释放后 readSession/findSessions 真实 idle/links 保留，TaskGraph 未自动 satisfied，W1 不能改已执行定义。
9. model permit request 摘要不匹配、并发消费、消费回包丢失/重开、已消费 replay 均不产生第二调用；拒绝和中途存储失败完整回滚。
10. 历史补写保持已有 ownership 移动/Lease 改变也可写；定向读规模不随无关任务/事件增长，不增全账本 horizon。

已有必须保持的反例：tests/work-graph/R4c-execution-history-index.test.ts 的原回执/唯一槽/starting locator/旧 owner 补写/Lease 无关变更/回滚/重开；R4c-execution-read.test.ts 的当前 owner 已转移仍可历史读；R4c-task-claim-concurrency.test.ts 的相同请求并发只保留赢家 IDs；W1-future-plan.test.ts 的跨 Plan basis 与执行痕迹。现有测试通过 raw fixture 改写 Session/Lease 是历史读取反例，不能当正式 release writer 的行为证据。

## 8. 拟议精确写范围与 lane 边界

以下均为 T 相对路径，主审据骨架决定最终 scope JSON；本文不授权超范围改动。

既有文件：

- src/contracts/dispatch.ts
- src/core/work-graph/materials/record-readers.ts
- src/core/work-graph/tasks/claim-contracts.ts
- src/core/work-graph/tasks/claim-record-codecs.ts
- src/core/work-graph/tasks/plan-readers.ts
- src/core/work-graph/tasks/run-state-service.ts
- src/core/work-graph/tasks/execution-read-contracts.ts
- src/core/work-graph/tasks/execution-history-service.ts
- src/core/work-graph/persistence/execution-history-codecs.ts（仅共享身份/shape helper 确需调整时）

新文件：

- src/contracts/core/task-claim.ts（原 TaskClaim 唯一声明）
- src/contracts/core/prepared-execution.ts
- src/core/work-graph/tasks/execution-entry-contracts.ts
- src/core/work-graph/tasks/execution-entry-service.ts
- src/core/work-graph/tasks/execution-history-binding.ts
- src/core/work-graph/tasks/model-call-contracts.ts
- src/core/work-graph/tasks/model-call-service.ts
- src/core/work-graph/persistence/execution-entry-codecs.ts
- src/core/work-graph/persistence/model-request-codecs.ts
- tests/work-graph/B2-execution-entry.test.ts
- tests/work-graph/B2-execution-result.test.ts
- tests/work-graph/B2-model-request.test.ts
- tests/helpers/B2-execution-fixture.ts（仅真实 owner 组合的共用 fixture）

材料 commit guards 接缝如确有必要，由 DSH 骨架说明原 provider 的准确缺口及最小变更，主审再将 materials/applicability.ts、record-ports.ts 或对应 owner 文件加入 scope；不能默默在新 service 复制材料判据。现有 grants reader 与 body integrity 只读复用。

src/composition/create-platform.ts、Runtime 文件及 tests/composition/B2-* 由主审/Runtime lane 的明确单一 owner 写，不在 WG lane 并发改。WG 交付需要注册的 records/events 列表与 factory dependencies；Runtime 冻结后更新这些共享文件的只读快照再实现。close/trackedCall 排空列入组合根测试，不能因新方法已返回便忽略在途清理。

## 9. 阶段一交付规则

阶段一生产代码仅必要类型、依赖/职责与明确 unsupported 骨架，原能力保持；新增行为测试应因未实现而失败，不能跳过、todo、放宽断言或 mock 自己写的服务使全绿。报告包含“需求→实际复用符号→新增接缝/缺口→测试结果”，特别列出 Prepared 正文协议、授权 V2、同 Run unique slot、Lease release 和模型消费语义。类型/导入应正常。

主审核对真实提供者与反例后再发阶段二实现；DSH 不自行把自检通过写成验收。最终仍由主审物理隔离运行适当专项与 verify:isolated，更新当前能力索引和批次报告；这份草案不是新架构决策来源。

## 10. 主审补充冻结与检查入口

WG dependencies 增加窄的受信 `authorizeConfiguration(ctx, {run, sessionRole, configurationRevision, permissions, hostTemplate}) -> Promise<ReadResult<{configurationRevision:string; permissions:TaskEnvelopeV1['permissions']; hostTemplate:PreparedTaskManifestV1['hostTemplate']}>>`。其类型在本 WG execution-entry-contracts.ts；由组合根把同一 Runtime Host 配置提供者的可信字段投影注入，WG 不依赖 Runtime 类型/实现。每次 authorize/begin/model-call 核当前 Host grant，不能把回传 manifest 的 permissions 当 grant。Host回调不可用明确 unsupported/unavailable；任何差异 source_stale/forbidden，不能使用恒真实现。此函数只核本次角色配置，不做 Context 总管、不引入策略数据库。

Manifest.permissions、budget、roleBinding、workspace、claim 必须与 envelope、Run、Session、现行角色、可信配置交叉核对。外部 selectedTaskInputs 在 B2 已有 grant/source provider 缺口下仍拒绝，测试必须区分生产正例与授权规则fixture；不要为赶进度放宽材料守卫。

骨架只声明新增codec/接口及unsupported实现，原有函数的运行行为不得重构；WG12 helper提取与codec启用在实现阶段做。新增codec可先明确unsupported，但必须类型正确且已有schema注册不受影响。Ledger.ts 由 C1 独占，本 lane 不改；ModelRequestPermitRef 已在 AggregateRef 无需再加。

类型：`python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py next-types`；专项：`python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py next-execution-state`。scope只列本批文件；使用Python/Node原地写，不能rename替换文件级bind。禁止提交、安装依赖、修改全局DSH配置、读凭据。交付骨架和红测报告后停止。
