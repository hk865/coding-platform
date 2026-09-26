# R3e：检查记录、正式证据与完成归约的最小施工设计

状态：2026-09-26，Astra 只读审计后待主审草案。仅新增本文；未实现接口或修改共享状态。目标为 `coding-platform/next`，原工程仅提供行为、类型与纯算法参考，不能反向 import 旧服务。每个窄批均按接口 → DSH 骨架/测试停止 → Astra 中审冻结 → 实现 → 独立验收推进。

## 1. 范围与明确不变量

依据：[PRODUCT](../../PRODUCT.md)、[数据操作 §6、§9](../CORE-DATA-OPERATIONS.md)、[WorkGraph §8、事务与复用](../modules/core/work-graph.md)、[R3e 既定范围](../refactor-plan.md#r3e--正式证据检查轮次与完成归约)、[未来意图节点任务](W2-future-intent-skeleton.md)。现有 Check、VerificationRound、Evidence、AcceptanceObligation/VerificationRequirement、TaskReduction 和 Gate 的语义继续使用，不新增 validation manager、完成状态数据库、全图证明器或固定审批角色流水线。

- 基础意图可以先入图；没有 assignment/验收的 plan_only 节点是合法规划事实。调查工作具备执行说明/分配时可先执行，缺验收不自动禁止调查。完成是后续另一副作用边界。
- Run ended/completed/exit=0、模型自报完成、工具返回 PASS、材料已存、消息已回复均不等于 Task satisfied；Task satisfied 也不自动等于 Goal COMPLETED。
- 验收义务、required requirement 或完成所需有效证据为空时，不能利用 `every([])` 得到完成。缺定义的正式完成请求返回 `incomplete` 并定位具体 Task/义务，不能以删除图节点、强造 gate/验收或退回执行入口来掩盖。
- 只机械检查这次正式提交的身份、引用、既定覆盖规则、结果来源、owner 和局部版本。规划语义、是否值得调查、预期依赖和全工作区“未来无冲突”不构成门禁。
- gate 是证据归约节点，不领取 work Run、不假造 shell 执行；requiredOutputs 仍为 Role 的审计性产出期望，缺少它不扣留归约。只有已采用要求包含 reviewer 时才要求真实独立审阅证据，不为每次检查自动增加 Reviewer/人类确认。

## 2. 源码对账：已有原语与缺口

以下位置相对 `coding-platform/`；行号为本次只读审计定位。

| 生产者 → 消费者 | 已有真实能力 | 缺口与复用方向 |
| --- | --- | --- |
| `next/src/contracts/plan.ts` → W1/查询/领取 | 完整 Task 四维、义务/requirement、gate、pins；W1 维护不可变 Plan 和 taskStateBasis | R3e 读已采用条件，不能再建验收定义或重跑规划编译 |
| `next/src/core/work-graph/tasks/eligibility.ts:41` → claim | 明确 gate 不派发；`plan-readers.ts:1010` 将无正式 reduction 的 ended Run 保守显示 blocked | 完成 writer 尚缺，不能把这个 blocked 改成 completed 来“接通” |
| `next/src/contracts/{evidence,reduction,goal-phase}.ts` | EvidenceRef/anchor、TaskReductionSnapshot、GoalPhaseRef 已迁入 | EvidenceSnapshot/Index、正式轮次、GoalPhaseSnapshot 和纯 reducer 尚未迁入；类型存在不等于已实现 |
| `next/src/core/work-graph/tasks/plan-readers.ts:109,211,990` | 已有 TaskReduction schema、按 taskStateBasis 读取正式归约 | 扩展该 owner 的 codec/消费者，不注册同名第二 schema |
| B2 实际 Runtime → WG12/原历史/M2 | 正式 Run/Attempt、entered、终态及结果引用可定位，Run 完成不调用 Task completion | 用作实际 producer 身份与报告来源；不依赖临时内存 Runtime table |
| `next/src/core/work-graph/materials/{material-service,material-facts-service}.ts` | body-first 正文、owner/grant/source/current/history，读结果与同次 guards | 直接用于报告正文，存入不等于 Evidence admission；不另建 Vault |
| `next/src/core/workspace/verification-workspace-reader.ts`、`verification-source-applicability.ts` | 候选源码真实 digest、Git HEAD 对当前工作区的明示比较；完整 source set | 已有源码 producer，不重写文件扫描；`runBaselineKnown:false` 不能证明 Run 前后无语义变化 |
| `next/src/contracts/verification-context.ts`、reviewer 相关 DTO | ReadonlyReadWitnessPort、sourceProof/material identity、ReviewWork/input/output 绑定已有 | 真实检查执行器、见证消费者、独立审阅受理/轮次服务缺失；不能以声明代替见证 |
| 旧 `src/control/verification-engine/{verification-plan-compiler,verification-rounds,readonly-report-check,command-check-provider}.ts` | 固定注册检查、内容寻址 VerificationPlan、逐 requirement 汇合、真实 ProcessSandbox/只读观察 | 提取纯编译/汇合；实际执行迁 Runtime，WG 不执行 shell；不迁整个 VerificationEngine/Journal 单例 |
| 旧 `src/control/control-engine/policies/{evidence,task-reduction,goal-phase}.ts` | 适用性、claim 中立、PASS/FAIL 覆盖、非空完成 guard、确定性解释 | 作为唯一纯规则迁移来源，按最新意图修窄，不复制第二套 reducer |
| `next/src/core/work-graph/tasks/contracts.ts` / `task-service.ts` | GoalTaskPort 当前只发布 createGoal | completeTask/completeGoal 及真实消费接口不存在；不能提前宣称正式完成可用 |

旧代码不能原样迁移的具体问题：旧 task-reducer 将 Workspace 缺读默认 revision=1、部分损坏 Evidence 静默略过，只从当前 Lease 找一项 Run 信号；旧 round.finalize 会继续自动触发 task/goal reduction；旧 evidence 适用性对不同 PlanRef 一律 OUT_OF_SCOPE。next 应使用准确缺失/损坏结果、相关正式索引、显式完成调用，以及 W1 的 Task 定义沿袭证明。旧 `requiredOutputs/reduction.withheld` 只能历史读取，不恢复门禁。旧 reducer 的 fulfilled obligation 列表应只列确实覆盖的义务，不能无条件把全部 required IDs 放入 satisfiedObligationIds。

## 3. 分三次窄派发，下一批先做 R3e.1

1. **R3e.1 正式轮次/证据与第一条机械检查闭环**：恢复必要 DTO、纯编译与覆盖，接同一 RecordStore 的轮次、受信 Host 检查写入口、证据/index、finalize 和定向读取；同批增加一个薄 command runner 消费这组入口并使用真实 ProcessSandbox。可以验收真实机械检查，但不能称只读见证、Reviewer 或 Task 完成已接通。
2. **R3e.2 其余检查 producer 接线**：复用 Runtime/Workspace/Material，接只读报告见证；独立 reviewer 只按已经采用的 requirement 接入现存协议。不重新实现 R3e.1 command runner/结果库。它属于已有 R4 检查消费者范围，WG 无 shell 依赖。
3. **R3e.3 Task/Gate/Goal 完成**：复用纯归约，接正式完成提交与解释读取，扩展既有 GoalTaskPort 和组合根；用真实 R3e.2→R3e.1 结果证明端到端。不得为了第 1 批“全绿”seed 被接受的 PASS/TaskReduction 然后宣称整条完成链通过。

未来意图批须在 R3e.3 之前合入，冻结 plan_only/request_execution、首次补 assignment/义务的语义。W1/W2 仍保护已经执行的任务定义；执行完后才发现需要新验收、又触及被冻结定义时，沿已授权计划/决定演进的后续入口，不能由 R3e 偷补新义务。R3e.1 类型/纯规则可先准备，写 W1/未来意图同文件必须串行；B2/M1/M2 正式 provider 是 R3e.2 的运行前置。C2 不是领域原语前置，后续 Agent 工具消费者复用同一 EvidencePort，不再造协议。

## 4. 收敛后的首批接口与来源 owner

**本节替代上一稿的两个 resolve 回调。** 不存在 `resolveVerificationInput`、`resolveCheckProducer` 或 `valid:true` 接缝。WorkGraph 自己定向读正式 Goal/Plan/subject Run、取实际 source capture、编译 coverage、核正文并产生结果记录；受信 Host 的检查写入口就是唯一原子 producer。没有第二份 Runtime Check 数据库或需要预先存在的 producer reader。

### 4.1 最小数据形状

以下是拟冻结的可直接放入 TS 文件的声明。`ActorRef/RunRef/TaskTriple/WorkspaceRef/PlanRevisionRef/ArtifactRef` 都复用现有类型；`VerificationPlanV1/EvidenceSnapshot/EvidenceOutcome` 从旧声明选择性恢复。新 Check DTO 放入现有 `contracts/verification.ts`，不迁完整 `verification-round.ts`、`verification-service.ts` 或 VerificationJournal 类型树。这里的 `RoundSnapshot` 是 next 正式记录外壳，不冒充旧 journal 格式；旧 journal 兼容另批只读迁移。

```ts
// contracts/verification.ts；下列引用均由对应现有 contracts 文件 type import。
export type CheckHostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;
export type RegisteredCommandCheck = {
  checkId: string; kind: 'static' | 'dynamic';
  command: string; cwd: string; timeoutMs: number;
  taskIds: 'all' | readonly string[];
};
export type TrustedCheckConfiguration = {
  configurationRevision: string;
  workspace: WorkspaceRef;
  executor: CheckHostActor;
  permissionRevision: string;
  sourceAccess: 'verification_workspace';
  processAccess: 'all_except_denied';
  deniedPrefixes: readonly string[];
  checks: readonly RegisteredCommandCheck[];
};
export type VerificationRoundRef = {
  aggregateType: 'VerificationRound'; projectId: string; workspaceId: string;
  goalId: string; taskId: string; runId: string; roundId: string;
};
export type CheckProcessObservation =
  | { kind: 'not_started'; reason: 'sandbox_unavailable' | 'launch_failed';
      startedAt: string; finishedAt: string }
  | { kind: 'executed'; startedAt: string; finishedAt: string;
      exitCode: number | null; signal: string | null;
      timedOut: boolean; cancelled: boolean;
      stdout: { text: string; totalBytes: number; truncated: boolean };
      stderr: { text: string; totalBytes: number; truncated: boolean };
      effects: { workspaceRevision: string | null; changedPaths: string[] };
      sandboxProfileVersion: string };
export type CheckExecutionTicket = {
  roundRef: VerificationRoundRef; checkId: string; invocationId: string;
  configurationRevision: string; configurationDigest: string;
  executor: CheckHostActor; workspace: WorkspaceRef; workspaceRoot: string;
  permissionRevision: string; sourceDigest: string;
  processAccess: 'all_except_denied'; deniedPrefixes: readonly string[];
  definition: RegisteredCommandCheck;
};
export type RoundCheckSnapshot = {
  checkId: string; definition: RegisteredCommandCheck;
  coverage: EvidenceCoverageV1[];
  phase: 'pending' | 'executing' | 'finished' | 'interrupted';
  invocationId: string | null; outcome: EvidenceOutcome | null;
  reportRef: ArtifactRef | null;
  sourceStatus: 'matched' | 'changed' | 'unavailable' | 'permission_changed' | null;
};
export type RoundSnapshot = {
  ref: VerificationRoundRef; revision: number; schemaVersion: 1;
  subject: TaskTriple; subjectRunRef: RunRef;
  adoptedPlanRef: PlanRevisionRef; taskBasisRef: PlanRevisionRef;
  executor: CheckHostActor;
  configuration: TrustedCheckConfiguration; configurationDigest: string;
  identity: VerificationRoundMaterialIdentity;
  sourceProof: VerificationRoundSourceProof;
  verificationPlan: VerificationPlanV1;
  checks: RoundCheckSnapshot[];
  status: 'open' | 'finalized';
  outcome: EvidenceOutcome | null;
  gaps: { code: string; message: string; coverage?: EvidenceCoverageV1 }[];
  evidenceRefs: EvidenceRef[];
};
```

`configuration` 是工厂创建时隔离的可信配置，**不在 open 或模型参数中**。明确的完整候选源码读取授权与 processAccess 是该 Host 对该 workspace 的实际授予；不能从任意 allowsRead 函数推导 shell/全树权限。 `sourceAccess:verification_workspace` 必须确实代表现有 CandidateWorkspaceReader 原 ignore 规则所定义的完整候选集合授权；该 reader 不按 allowsRead 或命令沙箱 deniedPrefixes 筛选文件，二者不是同一来源集合。若 Host 只授路径子集，WG/runner 入口在调用 capture 前返回 unsupported/forbidden，不改变 VerificationRoundSourceResult 的既有联合类型，不先扫描再冒称授权，不扩大到全树。保持既有 VerificationWorkspaceReader.capture(root)，不另写扫描器或 DTO 层。`workspaceHost.authorize` 仍须返回此配置绑定的 permissionRevision；权限变化的新检查不能使用旧票。这里没有引入全局配置租约。检查命令/工作目录/超时由 `checkId` 查冻结配置取得，unknown/重复 ID、非法路径或未配置 executor 在副作用前拒绝。未提供 `checks` 配置的旧平台仍可正常启动，新检查入口明确 unsupported。

CheckProcessObservation 是真实 ProcessSandbox 输出的有界投影，**没有调用者填写的 PASS、coverage、sourceDigest、owner 或 ArtifactRef**；状态由 WG 根据原始观察和自身 source 复核计算。大 stdout/stderr 只进正文，Round 不内联它们。ProcessSandbox.execute 的必填 outputLimitBytes 固定为 32 * 1024，即 stdout/stderr 各最多保留 32 KiB，复用旧 provider 上限；保留真实 totalBytes/truncated，不能把截断输出冒称完整。captureWorkspaceEffects 保持默认 true（不得设 false）；观察中的 workspaceRevision/changedPaths 必须取真实 effects，不以空数组或虚构 revision 代替未知副作用。

### 4.2 方法与具体依赖

```ts
// core/work-graph/evidence/contracts.ts；仅 type import 上述 contracts DTO。
export type FinalizedChecks = {
  snapshot: RoundSnapshot; outcome: EvidenceOutcome;
  evidence: EvidenceSnapshot[]; applicable: boolean; gaps: RoundSnapshot['gaps'];
};
export interface EvidencePort {
  openVerification(ctx: CoreCallContext, request: GraphWrite<{
    subjectRunRef: RunRef; subject: TaskTriple; planRef: PlanRevisionRef;
    gateSubject?: 'goal';
  }>): Promise<WriteResult<RoundSnapshot>>;
  readVerification(ctx: CoreCallContext, ref: VerificationRoundRef):
    Promise<ReadResult<RoundSnapshot>>;
  beginCheck(ctx: CoreCallContext, request: GraphWrite<{
    roundRef: VerificationRoundRef; checkId: string;
  }>): Promise<WriteResult<CheckExecutionTicket>>;
  recordCheckResult(ctx: CoreCallContext, request: GraphWrite<{
    roundRef: VerificationRoundRef; checkId: string; invocationId: string;
    observation: CheckProcessObservation;
  }>): Promise<WriteResult<RoundSnapshot>>;
  submitEvidence(ctx: CoreCallContext, request: GraphWrite<{
    roundRef: VerificationRoundRef; claim: string;
  }>): Promise<WriteResult<EvidenceSnapshot>>;
  finalizeChecks(ctx: CoreCallContext, request: GraphWrite<{
    roundRef: VerificationRoundRef; reviewerEvidence?: readonly EvidenceRef[];
  }>): Promise<WriteResult<FinalizedChecks>>;
}
export type EvidenceServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  materials: MaterialPort; materialFacts: MaterialReadFactsPort;
  executions: ExecutionReadPort;
  workspaceHost: WorkspaceHostBindings;
  source: VerificationRoundSourcePort;
  configuration?: TrustedCheckConfiguration;
  now(): string; newId(): string;
};
export function createEvidenceService(deps: EvidenceServiceDependencies): EvidencePort;
```

`beginCheck` 是首批唯一必要新增操作名：open 只登记 pending 子项，begin 才以 Round revision CAS 从 pending 改为 executing 并产生固定 invocationId。同一 begin request 重放原 ticket，但 `replayed:true` **不授权再执行**；另一 request 不能取走 executing 子项。record 仅接受已经执行该 begin 的原 executor、invocationId、checkId，先原 receipt 后当前条件；结束后同票不能换观察。首条产品路径选择真实已结束的 subject Run；open/完成前的核验不把它重新变成执行者，begin 不核原 subject Session 仍 occupied，不创建新 Run/Attempt/Lease。

open/fresh begin 的 Host writer 必须同时匹配**当前配置**中 executor 的完整 kind/id、workspace，以及 ctx.materialReader 的同一 Host actor/scope。record 的作者匹配**原 round/ticket 已持久绑定**的 executor，不能要求后来仍有相同当前配置；下面 §4.5 规定事实受理。不是看到 `principal.kind='host'` 就放行，也不把模型调用提升成 Host。配置缺省时仍装配历史读取/原 receipt 路径，只有新 open/begin unsupported。`submitEvidence` 首批只记录中立 claim，由服务固定 kind=claim/outcome=INCONCLUSIVE 和 round 来源；没有任意 observation/verdict 上传入口。work_run 直接写检查结果、readonly-report 配置、非空 reviewerEvidence 的首批调用明确 unsupported；缺必需 reviewer 的 finalize 可保留 gap/INCONCLUSIVE，绝不能生成覆盖 reviewer requirement 的 PASS。

### 4.3 每个持久字段从哪里来

| 字段/判断 | 真实读取和派生位置 |
| --- | --- |
| Goal/workspace、当前采用 planRef | WG 调已有 `readGoal`/`readPlan`；精确读 Workspace codec。请求 planRef 必须等于该 Goal 当前指针，query/current-reader 不替它授权 |
| subject、subjectRunRef、原 plan/attempt/Session 关联 | `executions.readExecution` 取得真实记录，核 Run 完整 ref、Run.task、workspace。普通 Task 必须是该 Run.task；Gate 仅显式 goal gate 分支允许同 Goal 的普通 producer Run |
| taskBasisRef、taskDigest | 已采用 Plan 的 `taskStateBasis` 和现有 FrozenTaskDefinition 比较；WG 自己构建，不从 Host/模型 JSON 接收 |
| policyPin/baselinePin、policy 内容 | 读取**已采用 Plan 固定 pin**的确切记录；复用现有治理 schema/digest 算法核对。不能调用追踪 Project 默认 active 指针的 `resolveGovernance/tryPolicyContent` 代替固定版本 |
| identity 中 Run/Goal/Plan/Workspace revision/digest | 以上实际编码记录的版本、canonical JSON 和既有 hash；最终定向 readMany 窗口确认派生引用未变，由 WG 汇成局部 guards，不使用 ledgerHorizon |
| workspaceRoot/sourceDigest/sourceProof/changeScope | `workspaceHost.resolveRoot(goal.workspaceRef)` 与 authorize 核真实根/版本/固定 grant，再直接调用注入的真实 `VerificationWorkspaceReader.capture(root)`；capture 无 signal 参数时前后检查原 signal，取消后不提交 |
| configurationDigest/VerificationPlan/coverage | 隔离后的固定 config + 真实 Plan/政策/source；WG 内纯 compiler 计算，不接受外部 digest/coverage/PASS |
| invocationId/executor/check definition | beginCheck 原子写入，executor 来自匹配的可信 ctx，definition 来自 round 固定目录；Kernel/ProcessSandbox 不拥有领域写权 |
| observation/reportRef/Evidence source | record 参数仅来自绑定 Host runner 的实际过程观察；WG 生成含 round/invocation/actor/subject/definition/source 的 canonical 正文，MaterialPort.storeArtifact 的 origin 是该 Host 的 platform_operation，而非借已结束 Run 冒充执行作者 |
| body、sourceRefs 和正文真实性 | 同一 MaterialReadFactsPort.openArtifactFacts(historical_explanation) 读回完整 ref/正文/sourceRefs；其 guards 随正式提交。Host historical 模式不声称 current，当前源码来自前述真实 source capture 的独立比较 |

证据报告的 `source.actor` 为实际检查 Host，`source.runRef=null`（既有协议允许机械检查）；报告包含真正 subjectRunRef 作为被验证对象。不会为了拥有正文而启动第二个 Agent Run。源文件 capture 与 Store 不能跨系统原子；报告明确前后取样及固定 source，落账只保证持久 guards 的原子性，不增加全局文件锁或虚假完整证明。

CompletionPolicy 直接复用 `plan-readers.ts` 已公开的 `readPinnedCompletionPolicy(records, pin)`：它读取已采用 Plan 的同一固定 pin，完成正式 codec、内容 revision/digest 校验并返回局部 guards，随证据提交合并；不再导出 `completionPolicyDigest` 后复制政策读取/校验链。ArchitectureBaseline 直接复用 A1 owner `src/core/work-graph/architecture/catalog-record-codecs.ts` 已公开的 `readArchitectureBaselineSnapshot` 与 `architectureBaselineDigest`：沿 adopted Plan 固定 ref 读取实际 record/body，复用 validator/digest 比较 adopted pin 的 ref/content revision/digest，核 outer record revision 与 snapshot.revision 并以实际 record revision 建立局部 guard；不跟随 active pointer，不额外导出 plan-readers 的 private 副本，不重写现有 Plan reader 或建立 GovernanceValidator。缺少/损坏已采用 pin 不能默认使用最新政策或 revision=1。

### 4.4 第一条真实机械检查闭环

同批新增一个薄 Runtime `runRegisteredCheck`，签名为 `(ctx:CoreCallContext, request:GraphWrite<{roundRef:VerificationRoundRef;checkId:string}>) => Promise<ReadResult<RoundSnapshot>>`，工厂依赖仅 `EvidencePort`、已有 workspaceHost、真实 Kernel public API、now；不拥有 records/material store。它返回真实轮次当前视图，原子写的 cursor/replay 由 EvidencePort 所有，不能给一次过程调用伪造 commit receipt。组合根以同一个服务实例暴露 `platform.evidence` 与受信 Host `platform.checks.runRegisteredCheck`，不注册模型工具。配置从 `TargetPlatformOptions.checks?:TrustedCheckConfiguration` 注入，固定 actor 和 source/process grant 由真实应用 Host 提供，不默认为全权。

产品第一条路径：真实 Plan/claim/已结束 subject Run → Host openVerification → runRegisteredCheck → beginCheck 新提交 → 核票中 root/permissionRevision → 真实 WorkspaceSandbox/ProcessSandbox 执行票中注册命令（原 signal）→ recordCheckResult → finalizeChecks 产生机械 Evidence。之后 R3e.3 才能正式完成 Task。runner 先读取正式 round；已经 executing/finished/interrupted 的原窗口只返回持久视图，不先重核当前 root/权限或 probe，也不再次 execute。原 begin/record 请求回执仍由 EvidencePort 优先恢复，不依赖后来环境。只有 pending 的 fresh 路径才核当前 root/授权并在 begin 前探测 sandbox；不可用返回 unsupported，零注册检查命令执行。ProcessSandbox.probe 本身会运行 bwrap 版本查询和 canary 探针进程，不能宣称零进程。begin 后崩溃/响应丢失留 executing，只有真实保存的结果能继续 record/finalize；无记录不能推断未执行，也不能靠新 requestId 自动重跑。

WG 在 begin 前核 source 与 round 固定值，record 时重新 capture；变化则保存该实际检查事实但结果为 INCONCLUSIVE/source_stale，不丢失已发生的副作用。exit=0 只有未超时/取消、exit/signal 完整、effects 已知且 source 仍匹配时才映射为该 predicate 的 PASS。command runner 不执行完成归约、不改 Task/Run/Session 占用。不在此迁旧 VerificationEngine、生成虚拟 reviewer、或读取另一份尚不存在的 check journal。

真实调用直接复用 Kernel public API 的 WorkspaceSandbox.create(root,{deniedPrefixes})、ProcessSandbox.probe(root,workspace)、new ProcessSandbox(profile,root,workspace).execute(request)。这两个类均无 close/release 方法；进程根句柄由 ProcessSandbox 内部 finally 关闭，runner 不编造清理 API。VerificationWorkspaceReader.capture(root) 也无 signal 参数，沿既定调用前后取消检查；不得改为假可取消 capture。本批不是新 Kernel patch，§8 scope 不变。

### 4.5 已发生事实与 fresh 执行许可分开

recordCheckResult 的顺序为：隔离/严格结构与可信作用域 → 匹配原 round/ticket/executor/subject/check/invocation 身份 → **lookup 原 identity/fingerprint receipt** → 未命中才受理此次真实过程观察。原 receipt 始终在当前配置、源码检查之前恢复；不得因 subject 已结束、后来 Host 撤权/更换配置或当前源码不可读而丢掉合法原 ticket 的已发生事实。新 begin 才核 fresh grant；record 不再次准入进程，也不暗中授予重新执行权限。

原始 observation 不因后续核验失败而改写。当前 source capture 失败、授权版本已改变或来源发生变化时，仍按原 ticket 的历史身份保存真实 exit/signal/stdout/stderr/effects/时间和 reportRef；分别记录 sourceStatus=unavailable/permission_changed/changed、具体 gap，适用结果 INCONCLUSIVE。**不能把实际 executed 改成 not_started，也不能仅因无法重读源码就返回拒绝而省略事实。** not_started 只能来自明确证明未启动的 sandbox/launch 错误（核实际 ProcessSandboxError 的 sandbox_unavailable/launch_failed，不泛捕获后改类）。ProcessSandbox 在子进程 close 后仍会关闭根句柄、读取后快照并 acceptAgentChanges；这些步骤抛错时可能已执行但没有完整 ProcessExecutionResult，其它 execute 抛错必须保持 executing/未知并返回 unavailable，不能伪造 exit/stdout 或 not_started。原 signal 已取消时 execute 也可能返回 cancelled、effects.sideEffect=none、workspaceRevision=null 的普通结果，不能据此声称命令已经启动或副作用已知；runner 在实际 execute 前检查原 signal，未取得完整结果仍保留原窗口。持久库不可用等确实不能落账的故障仍诚实返回 unavailable，不能伪造 committed。

报告正文沿原 Host actor/platform_operation 和既有 Material 历史读取路径读回；不借用新 grant、不改成 subject Run 的执行产物。源码不可读时不强行读取以“补证”；报告使用 round 已固定的来源作为历史出处，并明确当前不可判定。finalize 可以汇合该实际事实，但当前来源/权限无法核定的检查不能贡献 PASS；历史 receipt 仍保持原值，不反向篡改原执行结果。

真实 runner 已拿到过程结果后，若调用者 signal 随后取消，沿 B2 已有的受信清理信号模式提交事实/对账，不能再触发过程；晚取消不把已提交结果翻成 cancelled。没有拿到原结果的执行窗口仍保持未知，不能构造 observation 来“收尾”。测试新增：begin 后撤权/删除当前 source，再返回真实 exit=0，报告必须保存 executed 和实际输出、sourceStatus 明示、无 PASS；原 receipt 在相同故障下重放且无第二次进程/源码读取。

## 5. R3e.1 的最小正式语义

### 5.1 open / record / finalize

open 从可信配置取得已注册 checkId/definition、scope、当前确切 source 与已采用 obligation，服务重算 configurationDigest/VerificationPlan digest；不信输入中的 digest、工具名或 coverage。调用者可选择已有检查方案，不能提交任意 command 变成授权。缺实际验收定义返回 incomplete，未修改合法意图 Plan。已定义但尚无 checker/reviewer 的 requirement 保留明确 gap，不能静默删除后生成 PASS。

每个 child check 的身份由 roundRef+checkId+冻结 definition/配置绑定派生，执行前记录 intent。recordCheckResult 只能追加/推进这一实际检查的合法 lifecycle，核原 subject/producer、完整 Run/Task/Plan/sourceProof/配置 digest、报告引用和实际状态；同 request 同结果重放，同身份异内容冲突。finished 的原结果不可覆盖，“重测”是新的 check attempt/round，不能改旧 FAIL 为 PASS。interrupted/unknown 在事实未对账前不能重执行同身份。

finalize 只汇合冻结 required coverage：适用的全部必要检查和按政策要求的 reviewer，保留 FAIL/INCONCLUSIVE/missing/stale；单项 PASS 不是全部 PASS。fresh finalize 发现任一 executing 或执行结果尚未对账的未知窗口时返回 `incomplete`，不把 round 置为 finalized；record 与 finalize 均以同一 Round revision 作 CAS，不能通过并发收口丢弃已 begin 的实际结果。允许保留 pending 缺项形成 INCONCLUSIVE 的收口，但 round finalized 后 fresh begin 必须拒绝；原 begin/record/finalize receipt 仍优先恢复。requiredOutputs 缺项仅审计。聚合正文先由同一个 MaterialPort 保存并核验，随后 round finalization、Evidence@1、TaskEvidenceIndex、事件和 request receipt **一次 records.commit**；中途失败可有未引用正文，不能有 accepted PASS。finalize 不调用 completeTask/completeGoal、不推进后继。

晚到旧来源报告可作为真实历史事实保存，适用性明示 stale/out_of_scope；历史事实受理不等于当前有效 PASS。sourceProof 当前工作区比较不证明 Run 前态，不能据此启用 semantic no-change fast path。Gate subject 与 producer 分开：既有 `gateSubject:'goal'` 必须指向真实 goal gate；实际 producer 可以是同 Goal 的普通 Run 或受信机械检查，不能假称该 gate 曾被 claim。普通 Task evidence 必须核自己的 subject，不能沿 gate 兼容分支为另一 Task 认领 PASS。

### 5.2 证据集、非空与跨计划复用

Evidence 保留不可变 kind/outcome/source/subject/coverage/anchor/verificationPlanRef/ArtifactRef；TaskEvidenceIndex 由 admission 同事务维护，消费者定向读索引中的确切 refs，不扫全事件。引用缺失/损坏不静默跳过，损坏为 unavailable；真正不存在的必需项为 incomplete。coverage 的 obligation+requirement 使用复合 key，不因相同 requirementId 合并不同义务。

复用旧纯适用性/覆盖机制，claim 中立；适用性先由真实原 Plan/current Plan 的 basis、固定政策和实际来源判定，转换成逐条 EvidenceBinding 后交唯一 selectEffectiveEvidenceSet，fold 不再重算旧 anchor 适用性。当前 CompletionPolicy/VerificationPlan 没有已定义并持久化的 supersession 规则，因此 R3e.1 保守保留同一 subject/obligation/requirement 的所有 APPLICABLE FAIL/INCONCLUSIVE；后来的 PASS（同 check 或不同 check、新 round）不能抹掉 blocker。无 blocker 时由适用 PASS 提供覆盖，effectiveEvidenceIds 保留全部贡献项及稳定 admission 顺序，coverageByRequirement 仅选稳定代表，不赋予替代权。Round finalize 必须逐项核其固定 VerificationPlan.checkId 与 coverage，不能用另一项 PASS 填掉缺失检查。精确 versioned supersession 是 R3e 后续正式完成前必须补齐的范围；本批不添加猜测规则或新增人审流程。

W1 无关未来修改后，原任务与已接受证据的 PlanRef 可能不同。使用现成 taskStateBasis 和 FrozenTaskDefinition 证明同一执行/验收定义，再比较该证据实际依赖的政策/基线/来源；不重写 Evidence.anchor、不自动提升旧证据到新定义。确实改变该任务要求或明确来源条件时重新判断，不能因 Goal 的无关字段版本变动否定全部证据。VerificationSourceApplicability 的既有 source set 是完整候选 workspace；检查确实消费该完整集合时保留它的版本语义，不谎称可以按一个文件缩小。

## 6. R3e.2：只读见证与独立审阅的后续接线

R3e.1 已复用旧 CommandCheckProvider 的 ProcessSandbox 调用和类别判断；R3e.2 只续接 ReadonlyReportCheck 的见证与独立审阅，不重造命令检查服务。Host 的真实 root/授权/注册命令来自可信配置；shell 满足 B2 已定显式全工作区授权/denied prefixes，不从任意 allowsRead 函数推导全权。原 signal 贯穿实际执行，不能照搬旧 provider 的全新、永不取消 AbortController。

执行前持久记录准确 command/check 身份与 intent，执行后保存报告，再提交结果。崩溃于执行窗口后若没有真实结果只能 interrupted/reconciliation_required，重启不得因为暂时查不到结果再次执行同副作用。报告不能只凭 exitCode=0：超时/取消/未知副作用/来源在使用时变化须保留真实类别和 INCONCLUSIVE。它仍只证明该 check 的既定 predicate，不证明全部 Task。

只读报告通过真实 Kernel history/read witness 证明读取路径与范围、原报告和 workspace effects；不调用 shell、不造 lease。独立 reviewer 绑定原 producer、实际 reviewer Run/Role、packet/grants、报告及终态引用，不能把任意 worker 最终文本当 verdict。现存 next DTO 不等于这些 producer 已接通；缺 adapter 时目标红测必须停在明确 unsupported，不能以假 ReviewResult 或 fake elapsed log 宣称验证完成。

## 7. R3e.3：正式完成、局部 CAS 与终态

扩展现有 GoalTaskPort：`completeTask(ctx,GraphWrite<{taskRef,planRef,roundRef}>)` 与 `completeGoal(ctx,GraphWrite<{goalRef}>)`；返回现有 TaskCompletion/GoalPhaseSnapshot 方向，必要 DTO 从旧声明恢复。只读完成评估复用同一纯 reducer 返回具体 causes/refs，可挂在既有查询结果的独立 completion 字段；不把 planningDiagnostics 清空解释为 completed。

completeTask 在合法 identity/原 receipt 之后读取目标 current Plan 和 Task basis、该 round 与所需 Evidence/index、既定 review 结果、目标相关 Run/Lease/未知副作用；复用纯 reducer，非空验收/覆盖是显式条件。无完成定义返回 incomplete、零完成写入；已定义但检查 missing/failed/stale 保留真实未完成解释，不能写 satisfied。只有真正满足时编译 TaskReduction/event/receipt，同事务守住实际读集。非成功的验证事实由 round/Evidence 表达；若主审要求持久 blocked/failed reduction，应明确为“归约成功、任务未完成”的结果，不能把 committed 混写成完成成功。

一次 Task 提交只读目标及确切相关事实，不做全 DAG/全 Goal/全 ledger 证明。Run 候选从既有 task lookup 定向取，不能只看最新 lease holder 而漏掉该任务尚未对账的历史副作用；也不能把同 Goal 无关 Run 加进本 Task guard。新 claim 与 completion 通过该 TaskLease/TaskReduction 的准确版本（含缺席）竞争。当前 Plan 切换通过 Goal.activePlan revision 竞争；Evidence/index、round、review 等实际依赖版本由同次读集进入 CAS。无关 ledger append 不导致冲突。

completeGoal 必须枚举**当前采用 Plan 的适用完成集合**，这是真正 Goal 操作所需集合，不是要求每次普通 Task 操作扫描全图：required active/deferred 的未来意图也须解释；deferred 不是已完成。optional 不阻止 Goal 完成但仍展示。cancelled/superseded 不被伪装 satisfied，其退出当前承担集合必须来自正式已采用处置且义务仍有合法承担/授权处理；不能仅过滤 disposition 让 required obligation 消失。至少一个适用 required work、正式 required Goal gate 和非空 required obligation/requirement 的已有完成政策继续在这个边界核验；初始只有意图的 Plan 仍合法，只是尚不满足完成。

Goal 提交核所采用 Task/Gate reduction 的完整身份/定义来源与明确未决副作用，按当前 Plan 的义务汇合，不数 UI 百分比/缓存 satisfied 数量。Plan 指针、采用的 reduction/义务事实和必要缺席 guard 保证读集完整；不把全账本 watermark 当 CAS。后继只复用 TaskAdjacency 的直接受影响集合/现有查询投影，不恢复“前驱 Task 必须整体完成才可调查/领取”的旧门禁。

### 7.1 已采用完成不因普通读或新材料自动回退

已核旧 `dev_docs/interfaces/completion-policy.md:207`：terminal phase 不能靠普通 Command 回退，恢复/扩展/范围改变需要有权限的新 revision/Decision。旧 Evidence 协议是 revision=1 不可变；目前不存在 Evidence revoke/update writer。故**不增加“任意 EvidenceIndex/Run/Workspace 变化自动使全部 satisfied 失效”的 inputBasis 机制**，也不让 queryTaskGraph 打开材料、跑完整权限/证据链。

完成提交保存实际采用的 EvidenceRef、round/检查 fingerprint、Task 定义 basis、政策 pins 与当次来源 anchor，作为有界审计依据；不可变 Evidence/已终结 check/采用 Plan/政策正文无需每次图读取重新证明。普通追加 claim、新轮次尚未采纳结果、无关 Run 或源码变化不暗中改写已经采用的完成。

可复现边界：原 checkId/request 的 PASS 被替换 FAIL，应原位更新拒绝 idempotency_conflict，原 completion 不变；后来独立复测产生 FAIL，是新事实，保留并说明需重新评估，不能在普通读中悄悄回退。若以后实现“撤销某条已采纳证据”或“重新开启完成 Task”，必须有明确授权的目标记录/事件并引用原 Evidence/Reduction revision，最小 CAS 是该目标声明和目标 reduction；之后显式重新归约。当前无这类 writer，不虚构已有反例、不为它提前建全局 invalidation 表。新 Plan/Decision 合法开启新完成上下文后才按其具体条件评估，旧完成历史保持；现有 W1 不允许改已执行定义的限制也不由 R3e 绕过。

同 request 同 fingerprint 的完成 replay 恢复原事件/receipt，不用“现在的世界”重算原结论；普通新命令不能把 terminal reduction 降级。Runtime settle 仍只改 Run，不调用 completeTask。Goal 已完成后的重开/范围演进不是本批暗含动作。

## 8. 下一批 R3e.1 精确拟 scope 与测试

scope 以 `coding-platform/next/` 为根，以下仅供中审，接口/文件增删需主审冻结。生产 **11 文件**：移除上一稿两个完整旧 DTO 文件，增加真实消费者与组合根，避免只扩协议不接产品。

1. `src/contracts/evidence.ts`：恢复 Evidence/index/coverage 必要类型与稳定身份，不迁旧 service。
2. `src/contracts/verification.ts`：恢复 VerificationPlan 等被本批实际引用的类型，加入 §4 的有界 command/round DTO，不搬旧 journal 状态树。
3. `src/contracts/ledger.ts`：仅补新的 Round 引用到现有 AggregateRef，不引入另一 Ledger。
4. `src/core/work-graph/evidence/contracts.ts`（新）：EvidencePort 和确切依赖，不含泛化 valid/resolve 回调。
5. `src/core/work-graph/evidence/evidence-service.ts`（新）：open/begin/record/submit/finalize/定向读、来源判定和单次提交。
6. `src/core/work-graph/evidence/evidence-record-codecs.ts`（新）：轮次/Evidence/index/event 的严格 codecs/schema。
7. `src/core/work-graph/evidence/verification-plan.ts`（新）：从旧 compiler 提取唯一纯编译。
8. `src/core/work-graph/evidence/coverage.ts`（新）：冻结覆盖汇合/适用性与 W1 basis 复用，不含完成 writer。
9. `src/core/work-graph/tasks/plan-readers.ts`：保持只读，CompletionPolicy 复用已公开的 `readPinnedCompletionPolicy` 及其同 pin/digest 校验和局部 guards；ArchitectureBaseline 复用 A1 `architecture/catalog-record-codecs.ts` 的两个公开 helper，不另导出或复制治理链。第二阶段不将本文件加入实现 scope。
10. `src/core/agent-runtime/check-execution.ts`（新）：唯一薄受信 Host command runner，真实 ProcessSandbox，零第二结果存储。
11. `src/composition/create-platform.ts`：注册新增 schema、同实例 Evidence/runner 和可选固定 checks 配置，不添加默认 command/授权。

测试 **4 文件**：`tests/work-graph/R3e-evidence.test.ts`、`tests/work-graph/R3e-evidence-coverage.test.ts`、`tests/composition/R3e-command-check-platform.test.ts`、`tests/helpers/R3e-evidence-fixture.ts`（新）。共用已有 TaskClaim fixture/schema 注入、真实 body/record backend，不复制 Store。除上列窄导出/组合根外，B2/W2/M1/C2 源文件全只读；组合根派发必须待并发 owner 合入后串行。若恢复原 DTO 实际需要额外契约文件，报告准确 type dependency，由主审选择迁入最小声明或修订 scope，禁止动态绕过类型。

首批约 6 组独有场景：真实 body-first 受理及原 receipt 重启；subject/owner/ticket 身份不符拒绝，fresh open/begin 的配置或来源不符拒绝，但原 ticket 的真实 record 不因后来配置撤销、源码不可读或变化而丢弃，仍保存 observation 并标 INCONCLUSIVE；同 check 改结果冲突和中断保留；两个 PASS 一个缺失及空义务不 PASS；finalize 与另一结果/index 修改 CAS，执行中或未知窗口返回 incomplete 而不 finalized，收口后 fresh begin 拒绝（无关 Goal 写不冲突）；W1 无关未来修改沿 basis 保留适用、真正定义不符不冒认。另加 2 个组合场景：真实已结束 subject Run → 注册命令实际进程 → 正文/结果/Evidence，Task 仍未完成；同 begin 并发/重开只有一个真实进程，执行窗口无结果重启明确保留未知且不重跑。测试必须验证真实 sandbox 可用，否则该成功链未验收，不能自动 skip 后称已通过。真实进程 PASS 正例用 stdout 留下可核输出，避免为了计数而写入候选源码集合、触发正确的 source_stale；进程调用次数可由转发真实执行的观察包装记录。领域 fixture 可注入明确过程观察验证规则，但不能当真实 shell/Reviewer producer 测试。

R3e.2 后续只冻结 readonly witness/ReviewWork adapter 与真实审阅 producer 测试；R3e.3 后续冻结 `contracts/{reduction,goal-phase}.ts`、`tasks/{contracts,completion,completion-policy,completion-record-codecs}.ts`、既有 `plan-readers.ts` 的 schema owner/查询解释与组合根。这些后续行为不属于下一次 DSH 写权限；首批出现对应请求精确 unsupported，不以泛化 callback 提前冒充已支持。

后续消费者最少覆盖：真实命令结果→round→Evidence；只读真实 read witness 且无 shell；formal completed Run 仍不能在缺验收时完成；纯意图 Goal 明确列出未完成 future 节点；work 与 gate 的实际证据分别归约再完成 Goal；新证据不隐式回退已采用 completion；新 claim/Plan 更新与正式完成局部竞争；SQLite 重开原完成 receipt。独立 reviewer、旧 journal 读取/迁移标记若未接通，必须分别报告未覆盖，不能以普通机械检查全绿关闭整个 R3e。

骨架阶段 next-types 必须通过，新增实现入口明确 unsupported；检查 fixture 成功建立，再确认预期红点。中审审测试是否真正到目标入口，拒绝 catch unsupported 后提前返回的“绿测”。生产者接通后再用真实闭环验收，旧 journal 只读兼容另立精确迁移 scope，不连接旧业务 writer。完成这一批不关闭 Workflow 自动推进、控制重开或人用 UI。

## 派发前真实环境预检（2026-09-26）

已调用next公共ProcessSandbox的真实probe/canary并执行有界命令，Node24.21.0 / bubblewrap0.9.0退出0、效果记录revision且changedPaths为空，临时workspace/脚本清理通过。另在既有harness外层bubblewrap内重复同一canary与命令，嵌套隔离也通过，未降级无隔离执行、未修改lane源码/测试。证据见[预检](../reviews/evidence/next-b2-2026-09-26/r3e-process-sandbox-preflight.json)及[嵌套预检](../reviews/evidence/next-b2-2026-09-26/r3e-process-sandbox-nested-preflight.json)。这只确认当前执行环境可用，不证明R3e业务writer/consumer已实现；正式run still以当时probe及实际权限为准。

## 9. R3e.3 首批派工冻结：机械证据到正式 Task/Goal 完成

本节承接 §7/§7.1，仅冻结首条正常产品链，不重述全量完成设计。依据[本次架构与验收纠偏](../intent/INTENT-AND-DECISIONS.md#2026-09-26-补充架构结论与完整产品路径优先)：骨架不带偏、正常公开路径可跑、真实权限和副作用边界正确。首批不等待政策未要求的 reviewer；required reviewer 尚无正式 producer 时返回 `incomplete`，不造 PASS。§5.2 的精确 supersession 后续继续；本批无 blocker 的正常链可先完成，存在适用 FAIL/INCONCLUSIVE 时仍保留 blocker，不用猜测替代规则赶进度。

**时序：**目前只冻结文档，不预建占位、不派工。R3e.1 五生产文件实现可独立并行；本批共享 `create-platform.ts`、Task/Goal 查询接线须等 Query 骨架冻结后由主审按最新主树安排。保留骨架/最终行为测试→STOP中审→实现/独审两阶段，不能以局部测试更漂亮追加返修轮次。R3e.2 witness/reviewer、Workflow 自动推进、正式重开、维护/冷恢复与高级控制均不在本节写范围。

### 9.1 已核 owner 与精确范围

源码基线已核：`tasks/contracts.ts::GoalTaskPort` 只有 `createGoal`；`task-service.ts::createGoalService` 是 `platform.goals` 与 Workflow 共用的唯一服务。`contracts/reduction.ts` 已有完整 TaskReductionSnapshot，`plan-readers.ts::PLAN_STATE_RECORD_SCHEMAS` 已注册 `TaskReductionSnapshot@1`；`readCanonicalTaskFacts(records, goalRef, plan, taskId?)` 已定向/整图读取 Run、Lease、Reduction并按 taskStateBasis 投影 satisfied。`contracts/goal-phase.ts` 只有 GoalPhaseRef；没有正式 GoalPhase writer。`evidence/contracts.ts::finalizeChecks` 已有 FinalizedChecks，须等待其实际 producer 交付，不能以种子替代。

生产写范围固定 **11 文件**，均相对 `coding-platform/next/`：

| 文件 | 本批唯一职责 |
| --- | --- |
| `src/contracts/reduction.ts` | 保留原 Snapshot/phase/cause；加可选版本化 completion 审计字段及本批窄纯计算 DTO |
| `src/contracts/goal-phase.ts` | 保留原 Ref；加下述首批正式 COMPLETED Snapshot |
| `src/core/work-graph/tasks/contracts.ts` | 扩展同一 GoalTaskPort 两方法与兼容的依赖类型 |
| `src/core/work-graph/tasks/task-service.ts` | 原服务发布完成方法，复用同一 Store/时间/id；createGoal 行为不改 |
| `src/core/work-graph/tasks/plan-readers.ts` | 原 TaskReduction schema owner 校验新增可选审计；返回已读原始 facts、提供精确 GoalPhase 读，不加全局扫描 |
| `src/core/work-graph/tasks/plan-contracts.ts` | TaskGraph 增加独立正式 Goal completion 只读投影，planning 保持 advisory |
| `src/core/work-graph/tasks/plan-service.ts` | 原 queryTaskGraph 拼接 GoalPhase 定向投影；Task phase 继续原 canonical reader |
| `src/core/work-graph/tasks/completion.ts`（新） | completeTask/completeGoal 受理、receipt、实际局部读集、纯归约调用与一次提交；不是新 manager/Port |
| `src/core/work-graph/tasks/completion-policy.ts`（新） | 迁入所需 TaskSatisfied/Goal completion guard 纯规则，消费唯一 R3e fold 的结果 |
| `src/core/work-graph/tasks/completion-record-codecs.ts`（新） | TaskReduction 编码、GoalPhase codec、两类完成事件及回执结果；不得第二次注册 TaskReduction schema |
| `src/composition/create-platform.ts` | 原 schema 数组补 GoalPhase/完成事件；原 goals 服务复用唯一 backend.records，不创建第二完成服务或数据库 |

测试固定 **2 文件**：`tests/work-graph/R3e-completion.test.ts`、`tests/composition/R3e-completion-platform.test.ts`。不新增 helper 文件、不扩 R3e.1 五文件实现范围、不改共享 B2/R3e fixture。check selector 的登记与实际派发归主审，本节不授权改 tools/check。

### 9.2 公开接口、依赖与持久字段

以下类型按当前实际名称引用，不另定义 Task/Run/Plan/round/Evidence 身份。`TaskTriple` 来自 dispatch，`VerificationRoundRef` 来自 verification，`VerificationPlanRefV1`/`EvidenceRef` 来自 evidence。目标方法返回原 `WriteResult`（含 cursor/replayed/原失败码），不能只返回布尔值。

```ts
// tasks/contracts.ts：在原 GoalTaskPort 上追加
completeTask(ctx: CoreCallContext, request: GraphWrite<{
  taskRef: TaskTriple;
  planRef: PlanRevisionRef;
  roundRef: VerificationRoundRef;
}>): Promise<WriteResult<TaskReductionSnapshot>>;
completeGoal(ctx: CoreCallContext, request: GraphWrite<{
  goalRef: GoalRef;
}>): Promise<WriteResult<GoalPhaseSnapshot>>;

// 保持既有 create-only 薄 Store 包装夹具可用；没有新 resolve/valid 回调。
type GoalServiceDependencies = {
  records: GoalRecordTransactionPort & Partial<RecordLookupPort>;
  now(): string;
  eventId(): string;
};
// completion.ts 的实际依赖（内部收窄，不创建另一 Store）
type CompletionDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  now(): string;
  eventId(): string;
};
function completeTaskFromHost(deps: CompletionDependencies,
  ctx: CoreCallContext, request: Parameters<GoalTaskPort['completeTask']>[1]
): ReturnType<GoalTaskPort['completeTask']>;
function completeGoalFromHost(deps: CompletionDependencies,
  ctx: CoreCallContext, request: Parameters<GoalTaskPort['completeGoal']>[1]
): ReturnType<GoalTaskPort['completeGoal']>;
```

已核旧 Goal 测试存在只含 `readMany/lookupCommit/commit/eventAt` 的真实薄包装，故不强制旧 createGoal 调用者补 lookup。原服务捕获依赖一次，完成方法确认 `typeof records.lookup === 'function'` 后收窄并传同一对象；缺能力返回明确 unsupported，createGoal 不新增 lookup/read。生产组合根真实 backend.records 原本含 lookup，禁止以假 lookup 或扫描 fallback 替代。完成只消费已持久化正式 round/Evidence/Run/Plan/政策；不引入 Kernel、ProcessSandbox、WorkspaceSource 全仓再捕获或新的 Material 正文读依赖。来源可用性由 R3e.1 在 check/finalize 时正式判定，完成采用该具体检查快照，不宣称重新证明此刻磁盘未变。

`TaskReductionSnapshot@1` 原字段全部保持（包括 `currentAnchor`、四种证据 ID 集合、causes、reducedAt）；仅加下述可选字段，历史未携带者仍可按原 reader 读取，本批新 writer 必须填写：

```ts
type TaskCompletionAuditV1 = {
  schemaVersion: 1;
  roundRef: VerificationRoundRef;
  roundRevision: number;
  taskBasisRef: PlanRevisionRef;
  verificationPlanRef: VerificationPlanRefV1;
  configurationDigest: string;
  evidenceRefs: EvidenceRef[];
};
// TaskReductionSnapshot: completion?: TaskCompletionAuditV1

type GoalPhaseSnapshot = {
  ref: GoalPhaseRef;
  revision: number;
  schemaVersion: 1;
  planRef: PlanRevisionRef;
  planRevision: number;
  phase: 'COMPLETED';
  adoptedTaskReductions: { ref: TaskReductionRef; revision: number }[];
  satisfiedObligationIds: string[];
  reducedAt: string;
};
```

当前没有 GoalPhase Snapshot writer，首批只发布真正完成结果；不恢复旧十态 reducer 的未接 Decision/paused/maintenance 输入，不伪造它们的默认事实。TaskReduction 的 `currentAnchor` 已含采用 Plan、政策/架构 pin、workspace revision，completion 不再复制同一组 pins；round ref+revision、VerificationPlan digest 与 configurationDigest 定址原检查定义。完成事件分别为 `TaskCompleted@1`、`GoalCompleted@1`，保存真实 actor/identityKey/fingerprint及对应完整 result，供原 receipt 精确重放。`COMPLETION_RECORD_SCHEMAS` 只注册 GoalPhaseSnapshot@1 和这两个事件；TaskReductionSnapshot@1 仍只在 PLAN_STATE_RECORD_SCHEMAS 注册。

### 9.3 原 reader、纯算法与只读投影接缝

在现 `CanonicalTaskFacts` 中追加下列**内部返回数据**，从本轮已解析记录填充，不新增数据库读取，也不把它们暴露给模型：

```ts
runsByTaskId: ReadonlyMap<string, readonly RunSnapshot[]>;
reductionsByTaskId: ReadonlyMap<string, TaskReductionSnapshot>;
```

Run map 保留所选 task 的全部实际候选（按 full TaskTriple 精确核验），不能只返回 preferRun 选中的一条，也不能先按当前 basis 排除旧的未知副作用。任务定向模式仅该 Task；Goal 完成使用当前 Plan 全集合模式。现有 `guards` 随同完整事实返回，Lease/Reduction缺席仍有准确 guard；Task/Goal服务复用原 basis/origin reader证明哪些 reduction适用。图查询仍只投影 `byTaskId`，无需重新读取这些事实。

`completion-policy.ts` 保留两项纯函数，内部 DTO 在本文件定义；不由 caller/Agent提供 evidence verdict或 completion boolean：

```ts
type TaskCompletionEvaluation = {
  satisfied: boolean;
  phase: TaskReductionPhase;
  causes: TaskReductionCause[];
  satisfiedObligationIds: string[];
};
function evaluateTaskCompletion(input: {
  plan: PlanRevisionSnapshot;
  taskId: string;
  effectiveSet: EffectiveEvidenceSet;
  runs: readonly RunSnapshot[];
  lease: CanonicalTaskState['lease'];
  requiredReviewerMissing: boolean;
}): TaskCompletionEvaluation;
function evaluateGoalCompletion(input: {
  plan: PlanRevisionSnapshot;
  taskFacts: CanonicalTaskFacts;
}): {
  completed: boolean;
  unfinishedTaskIds: string[];
  unsatisfiedObligationIds: string[];
  reasons: string[];
};
```

TaskSatisfied 从旧 `policies/task-reduction.ts` 提取条件，**消费**原 `evidence/coverage.ts::selectEffectiveEvidenceSet` 已算出的唯一集合，不再调用旧 `selectEffectiveEvidenceSet(evidence,plan,anchor)`；适用性继续现 `evidenceApplicabilityWithBasis/evidenceBindingFor`。requirement key 必须 obligationId+requirementId，修正旧纯代码仅用 requirementId 建 Map 的局部身份不足。Run 使用当前 `RunSnapshot.status/outcome/executionAuthorization/reconciliation`；不照搬旧 reducer 对 Run exitCode 的假设，不伪造 exit=0。starting/running、unknown/quarantined、明确未对账事实或有效 lease 都阻止完成；普通 completed Run 自身不贡献 PASS。required reviewer 从采用的 requirement/固定 VerificationPlan读取，未接即 missing，未要求则不增加该前提。

Goal guard 复用旧 `policies/goal-phase.ts::evaluateGoalCompletionGuard` 的非空、required work/goal gate/义务完整覆盖与副作用规则；从已经核适用性的 canonical phases 和正式 reduction audit 建输入，不引入旧 ControlEngine/StateLedger writer。required plan_only/deferred保留未完成原因；optional不阻塞但不从图移除。无正式授权承担变更不能以过滤 cancelled/superseded 抹掉 required 义务。本批只写 satisfied/COMPLETED；任何未满足结果为 incomplete（reason定位Task/义务/requirement），不持久化新 blocked/failed reduction。

`TaskGraph` 增加可选 `completion`，不替换 `planning`：

```ts
type GoalCompletionView =
  | { status: 'not_recorded' }
  | { status: 'recorded'; snapshot: GoalPhaseSnapshot;
      selectedPlanMatches: boolean };
// TaskGraph: completion?: GoalCompletionView
```

`plan-readers.ts` 增加同文件精确 helper `readGoalPhase(records: GoalRecordTransactionPort, ref: GoalPhaseRef): Promise<{ status: 'ready'; snapshot: GoalPhaseSnapshot | null; readThrough: CommitCursor | null; guard: RecordGuard } | CoreRejection>`；只有注册读取确认缺席才返回snapshot:null，解码失败返回unavailable。该helper直接消费completion-record-codecs的唯一GoalPhase decoder。

在原 `queryTaskGraph` 的授权/Goal存在性检查之后，按精确 GoalPhaseRef 点读一次；snapshot按原记录返回，selectedPlanMatches只比较所选Plan完整ref。缺记录不推断可完成，历史Plan不冒领另一Plan的完成。该读进入sourceCursor/atLeastCursor的现有窗口处理；只读不打开正文、不重新跑权限准入/政策/证据fold。Task的effectivePhase继续现有canonical reader，不另建投影库。

### 9.4 受理、读集与原回执

Host身份采用已有 CoreCallContext 的真实 host actor/Workspace scope；输入只有正式refs和meta，不接受授权字段。先固定输入及actor、查同identity/fingerprint原receipt；fresh再核Goal所属Workspace、当前Plan/task身份。`completeTask.meta.expected` 必须精确包含 Goal、目标 TaskReduction（首次0）；`completeGoal.meta.expected` 包含 Goal、GoalPhase（首次0）。其余真实读集由服务加guard，不要求用户预测内部所有version。Plan/round引用全scope对齐；§7/§7.1的原回执及terminal不可降级规则不变。

Task fresh定向读取已finalized且PASS/no gaps的指定round、该Task的TaskEvidenceIndex及确切Evidence refs、各Evidence/round实际引用的原Plan及政策pin；调用同一fold，不能只相信round.outcome，也不能借另一Task的PASS。以round固定来源anchor作本次已完成检查的采用基准，未重新采集源码；不同source/政策的旧报告不因subject相同升格。当前Plan非同ref时仅按既有basis规则证明定义延续，不改Evidence.anchor。required reviewer未完成直接incomplete。Gate引用自身subject的独立round/evidence；§5已允许同Goal真实ended普通producer Run，仍核producer身份及实际终态，不造gate Run。

Task写TaskReduction/event/receipt一次commit，guard包括Goal指针、TaskLease/Reduction准确版本或缺席、round/index/Evidence、所读原Plan/政策及相关Run。新claim用既有Lease/Reduction guard与完成竞争。Goal只枚举其适用required集合和已读相关事实，读取正式reduction audit；一次写GoalPhase/event/receipt，不把全账本cursor当CAS。未知提交恢复lookupCommit/eventAt原回执；无法确认仍unavailable未知，不猜未提交。复用已存在Store协议，不为本批重新铺失联/并发全矩阵。

### 9.5 两组验收与停止点

只使用上述两测试文件，不另铺异常矩阵：

1. **领域公开正常链与必要未完成解释**：复用既有R3e真实静态policy→Goal→Plan→claim/ended的公开前态；用正式round begin/record/finalize产生work与Goal gate各自的Evidence，依次completeTask、completeGoal，queryTaskGraph读回两个satisfied及正式COMPLETED。原完成请求重放仍返回原值/cursor。沿已有公开Plan构建路径，在同组保留optional未来plan_only节点并确认仍显示；required未来节点/缺验收保持incomplete不删除；已采用required reviewer且缺producer时incomplete，不伪造ReviewResult。这些是当前用户语义断言，不扩成交叉矩阵。
2. **真实SQLite/组合根端到端**：复用现R3e公开static fixture与真实平台，`checks.runRegisteredCheck → finalizeChecks → goals.completeTask(work)`；再以 `gateSubject:'goal'`、该gate subject及同Goal真实ended普通Run执行独立注册检查round/finalize→completeTask(gate)→completeGoal→plans.queryTaskGraph。确认真实检查正文/持久Evidence被采用、gate没有新增Run、optional意图仍在图上；关闭重开同SQLite后读正式完成及重放原完成receipt。无fake ProcessSandbox、rawseed PASS/Reduction或跳过不可用环境称成功。

阶段一正常前态必须到新增完成入口的明确unsupported；这个首红之后的完成/重开步骤尚未执行，如实标待验证，不能catch后算绿。两组最终行为测试写好并typecheck后STOP，主审确认骨架无跑偏即可进入实现；不为更多覆盖补新返修轮次。实现后优先跑这两组真实路径及受本次修改影响的必要邻接，整合后按既定流程隔离验收，不以局部PASS关闭reviewer、Workflow或完整R3e。
