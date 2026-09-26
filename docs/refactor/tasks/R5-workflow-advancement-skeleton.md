# R5c.1 已有 Plan 的 Workflow 推进：首批骨架

状态：2026-09-26，主审已冻结七文件 scope 并准备占位与 next-workflow-advancement。R3e.3 骨架已导入，现从最新 main prepare/派发；它的五文件实现独立并行。设计依据为 [Workflow §11](../modules/business/workflow.md#11-r5c1-候选已有正式-plan-的首条推进闭环2026-09-26)。第一阶段只做有限接口、依赖装配和最终行为测试，明确 unsupported 后 STOP；另行授权第二阶段，不能直接实现循环或领域事务。

## 1. 前提与唯一职责

R3e.1 注册检查五文件与 R5b.1 pending Query 两文件已独审导入；[R3e.3完成骨架](R3e-task-goal-completion-skeleton.md)已中审导入，接口以 [R3e主任务§9](R3e-completion-skeleton.md#9-r3e3-首批派工冻结机械证据到正式-taskgoal-完成) 为准。root 决定共享 composition 串行顺序；本批准备 fresh lane 前须导入完成骨架，不覆盖 Query/controls/evidence 等已有实例。正常完成测试须消费真实完成实现，前态若 unsupported 如实报告；不以 seed PASS 或假的 completed 补足。

已有正式 Plan 的执行不依赖 Query 后续、初始规划或 R6 页面。Workflow 选择下一步并组合已有 Port；核心 owner 继续决定受理、权限、局部 CAS、来源、真实执行、证据与完成。不开第二 engine/数据库，不读写 Store，不在业务中复制 model loop、Task eligibility、Role resolver、材料授权或 Evidence fold。首批只支持可信 Host 的 human/system ctx；不发布模型工具，不让 continuation 携带权限。

## 2. 有限接口与原请求 continuation

以下名称在 business/workflow/contracts.ts/ports.ts 定义；实体类型直接导入现 owner。`GoalTaskPort.completeTask/completeGoal` 须来自合入的 R3e.3 接口，不在 Workflow 另声明影子方法。

```ts
type WorkflowCalls = {
  create_session: RuntimeExecutionPort['createSession'];
  claim_task: TaskClaimPort['claimTask'];
  prepare: RuntimeExecutionPort['prepareExecution'];
  start: RuntimeExecutionPort['startRun'];
  observe: RuntimeExecutionPort['observeRun'];
  open_checks: EvidencePort['openVerification'];
  run_check: RegisteredCheckRunner['runRegisteredCheck'];
  finalize_checks: EvidencePort['finalizeChecks'];
  complete_task: GoalTaskPort['completeTask'];
  complete_goal: GoalTaskPort['completeGoal'];
};
type WorkflowStepKind = keyof WorkflowCalls;
type WorkflowOperation = {
  [K in WorkflowStepKind]: { kind: K; request: Parameters<WorkflowCalls[K]>[1] }
    & (K extends 'create_session' ? { taskRef: TaskTriple; planRef: PlanRevisionRef } : {})
}[WorkflowStepKind];
type WorkflowStepReceipt = {
  [K in WorkflowStepKind]: { kind: K; result: Awaited<ReturnType<WorkflowCalls[K]>> }
}[WorkflowStepKind];
type WorkflowAdvanceBase = {
  schemaVersion: 1;
  goalRef: GoalRef;
  flowId: string;
  sessionHint: SessionRef | null;
};
type WorkflowAdvanceInput = WorkflowAdvanceBase & (
  | { kind: 'select_work' }
  | { kind: 'perform'; operation: WorkflowOperation }
);
type WorkflowAdvanceResult = CoreRejection | {
  status: 'ready';
  value: {
    state: 'advance' | 'waiting' | 'completed';
    receipt: WorkflowStepReceipt | null;
    next: WorkflowAdvanceInput | null;
    reason: string | null;
  };
};
interface WorkflowPort {
  handleGoalInput(ctx: CoreCallContext, input: N0GoalInput): Promise<CoreRejection>;
  advanceWork(ctx: CoreCallContext, input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult>;
}
```

`select_work` 只读，receipt=null；`perform` 用显式 switch 调**一次**对应 owner。步骤被拒绝、Session创建仅 accepted、执行/检查 unknown 或需要新依据时，保留完整原 result，state=waiting、next=null，不能紧循环重发；Host 可以在明确的新观察时以原操作重试。接口/读错误可直接返回原 CoreRejection。操作成功才返回下一完整请求；正式 GoalPhase/completeGoal 成功才 state=completed。`advance + next` 供 Host 立即继续，不引入每步用户确认，也不后台运行不受追踪的 Promise。

首 await 前隔离 ctx 的纯字段、input/operation，保留原 signal；core仍做自己的操作校验，不因此给普通读加全ownership链。所有 delegated command 保留真实原 actor/scope，Runtime 自己构造 work_run 身份；不暴露 ctx/principal 覆盖参数。

### 原身份与版本

下一请求在发送前确定完整 request。requestId 为 `wf:` + 既有 canonicalJson/sha256Hex 对 `{schemaVersion:1, flowId, actor, goalRef, kind, requestWithoutRequestId}` 的摘要；包含实际 input/expected，排除尚未生成的 requestId。start 使用固定可信 consumerId，保留原 Prepared；Runtime 请求中 requestId 是顶层，GraphWrite 是 meta.requestId，Session 创建沿自身 meta，不新造通用命令封套。

失联重发的是**同一 perform 输入**，不改 requestId/expected/Session、不重选 Task；恢复原核心回执后，下一步骤是尚未提交的新请求。新版本基准改变 key，不把同 key 的 expected 刷新。core原回执优先，本层不能先按当前 Role/Plan/配置拒绝原请求。没有 Workflow 事务、完成表、去重 Map或独立持久 continuation；Host保留正在发出的完整请求，回执事实继续由core保存。冷启动丢失原请求/轮次引用的全自动恢复不在首批，明确返回缺口，不新开 Run/检查冒充恢复。

## 3. 可信配置和依赖

```ts
type WorkflowHostConfiguration = {
  consumerId: string;
  bindings: readonly {
    workspace: WorkspaceScope;
    sessionRole: RoleConfigurationRef;
    roleBinding: RoleBindingRefV1;
    budget: TaskBudgetV1;
  }[];
};
type WorkflowDependencies = {
  tasks: GoalTaskPort;
  plans: PlanTaskPort;
  sessions: SessionDirectoryPort;
  claims: TaskClaimPort;
  executions: ExecutionReadPort;
  runtime: RuntimeExecutionPort;
  evidence: EvidencePort;
  checks: RegisteredCheckRunner;
  sourceAuthority: SourceSnapshotReads;
  configuration?: WorkflowHostConfiguration;
};
```

配置仅来自 `TargetPlatformOptions.workflow?`，构造时隔离纯数据；同 workspace/templateId 匹配唯一 binding，重复或缺失不猜。Task assignment.role 对应 roleBinding.templateId，Session 用明确 sessionRole；不能从字符串拼 bindingId、角色修订或 policyRevision，也不能造默认 Token预算/deadline。配置只是策略选择，不授模型/工具/文件能力，原 claim Role resolver 和 B2 Host grant交集仍生效；已有 Run 的预算不重置。缺配置使 fresh选择返回unsupported，不破坏原平台其他入口或原步骤回执恢复。

组合根复用已有 `sourceAuthority` 精确读取 Workspace.revision；它不接收Host root或模型能力。本层先核真实Host scope，读返回ref一致；原claim再核正式Workspace并CAS。Goal pin来自queryGoal，Session pin来自directory/创建回执。**不能直接将queryReadyTasks.expected传claim**：现值只有Goal+Plan，而claim要求Goal+Workspace+Session；Plan由claim内部读取guard。Session创建的可选caller expected可使用已知Workspace pin，Project/Workspace正式守卫继续由原创建owner读取，不新增Project查询端口。

原 `N0WorkflowPort/N0WorkflowDependencies` 可保留 type alias 指向窄新类型，`N0GoalInput` 不变。composition在原factory处注入同一 raw owners，原 runtime.port加已有sessionOperations组成所需Session方法，不创建第二Runtime。公开advanceWork以原trackedCall包装；内部不再次绕public trackedCall，否则close开始后可能误拒已受理的一步。close沿现promise排空，Workflow不私有开后台工作。

## 4. 确定性首批选择与后继

1. select_work读取queryGoal和当前TaskGraph，确认Goal/Workspace当前scope；无adopted Plan返回waiting，不发Query或创建空Plan。若图已有与当前Plan匹配的正式GoalPhase COMPLETED，返回completed；不靠任务计数推断。
2. 使用本次TaskRow.eligibility/effectivePhase原投影。优先required、再Plan.tasks原顺序；只选择eligible且execution=null的active work。V2 plan_only保留不执行，V1沿现eligibility；不能用纯Task DAG额外阻止独立工作。已有Run的未完成Task不创建第二Run；本批没有requeue producer，返回原execution引用/原因，已知continuation继续原步骤。
3. Session策略：先readSession核sessionHint（提示而非权限）；同workspace/明确role配置、未归档、可用且occupancy=null时复用。相关hint忙则waiting，不复制Session绕过。同hint不兼容则用findSessions的真实role筛选、task关联优先，再workspace候选；每页limit=50，opaque nextCursor原样续页，不自己造游标。无候选才正式createSession，initialLinks为真实Task负责关联，recommendedRefs首批为空即可，不开材料。Session角色是否真可执行仍归claim。
4. 不对多个候选尝试写入碰运气。成功创建回执有SessionRecord才组claim；claim按Goal/Workspace/Session实际pins，得到TaskClaim后prepare；prepare成功才start。每一跳用原DTO，不能自造Prepared body/Kernel身份/Run角色。start完成的原正式TaskExecutionRecord决定下一步；running/paused/unknown/quarantined或非正常终态等待，不能以signal sent、Promise结束或run status单字段推断成功。
5. 正常ended/completed的work进入openVerification（准确task/plan/producer），沿正式round.checks顺序runRegisteredCheck；其expected只用实际Round ref/revision。finished不重复执行；executing/unknown不自动run。每次真实结果刷新Round后才构造下一check请求，最后finalize。不调用recordCheckResult造观察，不自己拼PASS/sourceProof或执行命令。
6. finalize成功提供正式FinalizedChecks；只有其可采用结论才提出completeTask，最终core核Evidence/reviewer/未知副作用。首次TaskReduction pin=0；如已存在适用satisfied则从图跳过，其他版本冲突保留原current，不同key盲重试。completeTask成功后返回select_work，将原SessionRef作为hint，选择下一普通工作；新Turn沿B2继承原Session，不调用不存在的continueSession。
7. 没有普通工作可推进时，先保留required plan_only/缺分配/缺验收/未知执行等实际缺项，不为结束而升级未来节点。可进入goal gate时，选择同Goal正式ended的普通Run作producer，gate是自身subject、gateSubject='goal'；按独立Round/检查/Evidence完成gate，不claim gate、不造gate Run。completeGoal最后提交；required reviewer缺producer须incomplete，政策没要求的不额外阻塞；optional未来节点仍在图。Goal完成后没有同Goal下一任务。

现`Runtime.capabilities.continueHistory`仍是宽目标false，不以它否定B2已经接通的同Session新Turn；本批不改该接口或承诺native compact/recover。实际B2记录/Kernel历史和模型输入才是连续性的证据。失败、source变化、拒绝、空候选均返回实际原因，不无限poll或偷偷增加累计预算。

## 5. 精确范围、最终行为测试与停止

机器范围见 [scope](R5-workflow-advancement-skeleton-scope.json)，恰5个既有生产文件、2个新测试：

- `src/business/workflow/contracts.ts`、`ports.ts`、`workflow.ts`、`index.ts`：上述类型/显式unsupported骨架、兼容导出；不预建本模块目标文件树。
- `src/composition/create-platform.ts`：可选可信配置、同原子owner依赖、公开trackedCall；不修改任何core算法/schema/Kernel或原工程。
- `tests/business/R5c-workflow.test.ts`：小型正式Plan、公开writer与真实core，检查正常选择→一个具体操作原请求重试→沿回执生成next；覆盖一处required future/reviewer无法推进的真实结果即可，不新增全排列。
- `tests/composition/R5c-workflow-platform.test.ts`：真实SQLite和公开初始化/采用Plan，受控ModelClient但真实Kernel/Session；两个work顺次执行与真实ProcessSandbox注册检查、Task完成；第二work延续原Session且原历史有新Turn；goal gate独立subject证据→Goal正式完成。Host驱动已返回的next，不fake领域结果。阶段一首个Workflow unsupported后段诚实未达；待完整producer实现后真实到达，不能写expected unsupported作为永久通过。

类型/必要边界及这两目标文件足够作为本批gate；next-workflow-advancement 和占位已由 root 准备，本文件不改 tools、不自行创建 lane。禁止扩测试矩阵、生产helper文件、Session/材料/Role热换反例。第一阶段新增业务advanceWork明确unsupported，不提前写选择算法、continuation生成或副作用；原handleGoalInput保持现状。DSH提交精确hash/首红及真实前态后 STOP，中审通过再另开实现scope。第二阶段通常只需workflow.ts，若中审确认必要类型变化应先冻结，不开放测试随实现修改。

Query后续、R3e.3、R4/R6组合顺序由root指定；不得自行派发。公开platform.workflow为首批可信Host消费者，R6/UI自动接入与完整自动Workflow仍后续；不要从这条串行链宣称完整并行编排/返工/冷恢复/规划产品已交付。
