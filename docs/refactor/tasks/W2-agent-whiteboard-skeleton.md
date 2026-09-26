# W2：Agent 白板委托、Role/Skill 消费者骨架草案

状态：2026-09-26，Astra 只读源码审计后的**待主审草案**。尚未冻结接口、scope 或测试，未派发实现。目标为 `coding-platform/next`；原工程只读。执行顺序仍是架构/接口 → DSH 骨架与独立测试停止 → Astra 中审 → 冻结 → DSH 实现 → 独立验收。

## 1. 已确认范围与本批边界

依据：[PRODUCT §3、§6](../../PRODUCT.md)、[用户答复](../../agent-platform-user-replies-numbered.md)、[生命周期对齐](../../AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md)、[实施方案 §0](../IMPLEMENTATION-PLAN.md)、[WorkGraph](../modules/core/work-graph.md)、[AgentRuntime](../modules/core/agent-runtime.md)、[W1 验收](../reviews/next-b1-w1-2026-09-25.md)。

任务图是 monitor 与可编辑白板。Agent 可在授权内调整、取消、拆分**未来任务**，查看原任务执行及历史；关系边、可能影响与未知范围不是事前并行门禁。秘书、参谋、书记是可组合的 Role/Skill 职责，不是新服务、永久 Agent 身份或串行审批流水线。Session 承载具体上下文，同模板多个 Session 可以并行。

W2 接通真实 Run → 白板工具 → 现有 W1 正式受理 → 查询新计划这一消费者链，并提供秘书/参谋/书记 Skill 的真实装配。沿用 W1 的 future-only 边界：触及 Task 必须从未出现 Run/Lease/Reduction，已领取后即使释放也不得再按未来任务改写；取消/拆分保留原任务条目与义务覆盖。取消已运行工作走后续 R4 控制，不能把未来任务 disposition 当 Kernel cancel。完成、证据接受、完整授权变更、初始计划生成、Workflow 自动派发/等待另按已确认范围继续推进，本批结果不关闭 R3c/R3g/R5。

本批不新增 ContextManager、SkillManager、AgentDirectory、授权数据库、计划副本、第二编译器或调度器。Memory/知识库不是前置。所有操作在原授权范围内执行，不加每次人手确认。

## 2. 源码审计：复用与确切缺口

| 真实符号/文件（相对 next） | 当前行为 | W2 接缝 |
| --- | --- | --- |
| `tasks/plan-service.ts:createPlanService` | `proposePlan/applyPlanChange` 已拥有请求快照、回执、版本与提交；`boundWriteActor` 只准 Host | 在此同一服务增加窄委托 admission，禁止工具把 work_run 强转 Host 调公开方法 |
| `tasks/plan-validation.ts:deriveFuturePlanDelta/validateFutureObligationCoverage/validatePlanDraft/validatePlanAssignments/planPhaseGuardReasons` | 已定义 W1 准入与不变义务规则 | 原样复用，不另写“Agent 编辑规则” |
| `tasks/plan-readers.ts:readFutureChangeTaskFacts` | 对 touched Task 读取 Run 索引及 Lease/Reduction，保留缺席 guards | 与 sender 执行/角色 guards 合并，未来领取与编辑仍局部 CAS 竞争 |
| `tasks/plan-commit-compiler.ts:compileFuturePlanAdoption` | 单事务生成新 Plan、Goal 指针、accepted Proposal、事件；未变任务沿 `taskStateBasis` 保留来源 | 直接传额外 `priorGuards` 和真实 agent actor，禁止重建同义编译路径 |
| `tasks/plan-record-codecs.ts` | 现有 event actor 已支持 `{kind:'agent',id,runRef}`；候选尚无完整提交者绑定 | 复用 actor，不引入旧 WorkParticipation；候选增加严格、可选的 Agent 提交来源 |
| `plan-service.ts:planProposalIdFor` | proposal ID 只哈希 scope/goal/requestId，未含 actor | Agent 分支需按完整绑定身份/op/requestId 派生；Host 原 ID 与旧回执逐字保持 |
| WG11 `createRunStateReader` | 精确正式 Run/Attempt/outbox/Session/lease；读取不等于授权 | 复用 canonical facts；不得只见历史 Run 就放行。该 reader 当前 Host-only，内部受信读取接缝与公开委托身份需分开 |
| `configuration/role-memory-service.ts:resolveRoleBindingFacts` | 现行 Role matrix/pin/权限上界与逐项 Store guards；无 matrix 明确 absent | 同一 resolver，实际 grants 来自 Host/Run；不把 role 名或责任标签当授权 |
| `agent-runtime/observed-model-run.ts:runObservedModel` | 已有 skills、coordinationTools、hostAuthorizedTools 与真实 Kernel loop | 同一次 B2 执行注入工具、角色 Skill；工具 factory 不启动第二模型循环 |
| `business/workflow/{ports,workflow}.ts` | N0 unsupported | 本批不假装自动编排已就绪；独立后续任务消费同一正式 Runtime/白板入口 |

旧 `src/execution/worker-runtime/coordination-tools.ts` 的 strict schema、实际平台副作用声明可参考；其 AgentInstance/WorkParticipation 身份链不迁入。旧工具在调用后检查 signal 并返回 cancelled 的模式**不能照搬**，提交成功后晚取消不能改成未提交。旧 `contracts/history/query-role-skills-v10.ts` 的事实/推断分离可作为 Skill 内容来源，但旧 query 工具名、回答 JSON 与已不存在的证据协议不直接复制。

## 3. 最小委托设计：同一 W1 服务，两种真实主体

保留 `PlanTaskPort` 方法与现有 Host 行为。`PlanServiceDependencies` 增加可选内部 `delegatedWrites` 依赖；没有依赖时现有 Host-only 行为不变。新增窄模块 `tasks/plan-write-admission.ts` 负责真实主体与新写许可，`plan-service.ts` 继续负责计划规则/回执/编译/一次提交，不创建第二“Agent Plan Service”。

分两步，避免终态原回执被当前权限掩盖：

1. `identifyPlanWriter(ctx, operation, scope)`：同步快照、完整身份/作用域/reader 一致性；Agent 沿正式 Run/outbox/Session 关联证明稳定身份。返回实际 actor、稳定 key、提交来源。此步不要求原 Run 仍运行。
2. 未命中原回执时 `authorizePlanWrite(ctx, identity, requestFacts)`：核新操作当前许可，返回 `ReadResult<{ provenance, guards }>`。它不是 boolean；`guards` 是刚核验的实际版本/缺席。方法仅内部可调用，模型不能提供或替换。

Agent actor 使用现有 `ActorRef`：`kind:'agent'`、可信服务派生的 scoped Session 归因 ID、完整 `runRef`。ID 只是归因，不是持久 Agent 主体或授权依据。稳定命令 key 至少含 operation、project/workspace、完整 RunRef、正式 SessionRef、requestId；同 callId 的不同 Run 不重放/争抢另一人的 proposal。不得伪造旧 `agentPrincipal.workId=sessionId`。

Agent 新写检查：

- 仅 `work_run`，目标 Goal 必须等于正式 Run.task.goalId，项目/工作区与 Run.workspaceSnapshot、ctx 和 materialReader 一致。Query 委托写本批 unsupported。
- B2 V2 授权 `phase:'entered'`，Run running、envelope 存在且引用/Role/权限一致；旧 V1、starting、entering、unknown、revoked、settled 不给新写许可。
- 正式 claim/Attempt/outbox 一致；Session active，occupancy.executionRef 指向此 Run、generation 等于 claim；TaskLease 仍为同 Run/Attempt 且未释放。entryGeneration 与 Session generation 分别核对，不能互换。
- 每次重新核对 B2 同一受信 Host configuration grant，所需具体工具名在 Host grant、Run envelope 与当前 Role 上界内。RoleSpec 的 `planning` 责任本身不授权 apply；Skill 文本同样不授权。
- 没有现行 matrix 时只允许 B2 已显式绑定、精确版本的可信 legacy template；absent 不是自动全权。角色事实仍返回并提交 absence guards。
- Agent `proposePlan` 仅允许基于当前已接受计划的 v2 未来修改；Agent `applyPlanChange` 仅接受其自己所提交的 W2 候选，`decisionRefs=[]`。既有 Host 仍可以采用正式候选。跨 Run 代为采用/完整 UserDecision 变更不隐式开放。

`PlanProposal` candidate_v2 可增加 `submittedBy?: PlanWriteProvenanceV1`，仅 Agent 分支填；字段包含实际 RunRef、SessionRef、RoleBinding、Session generation、entryGeneration、authorizationRevision、Host configurationRevision。运行程序产生这些字段，输入 schema 不允许提供。候选/event codec 严格验证；旧候选无该字段仍可由 Host 按旧规则读取/采用，不能据此推导 Agent 作者。身份重放核原事件 actor 与该来源，不从当前 Plan 重建原回执。候选提交者和执行采用者均保留真实归因，不能被 system 身份覆盖。

具体 TS 签名在骨架前由主审与 B2 最终类型对齐；本文不会假设尚未落地的新接口已存在。

## 4. 原子性与授权决策点

新 proposal commit 与 apply commit 都纳入 sender Run、Attempt/outbox、Session、Lease 和 Role resolver guards；apply 再纳入原 W1 Goal/source Plan/proposal/touched Task/target-not-exists guards。相同键守卫必须一致；冲突拒绝，不取最大 revision 掩盖混合窗口。正式 Run 结果归约/占用释放与白板提交通过局部 CAS 竞争，因此不会出现“先检查旧授权、释放后再无守卫提交”。原任务未来领取竞争继续使用 W1 的 Lease 缺席 guard；不引入全账本/全工作区锁。

Host fresh configuration 回调是受信外部事实，其检查完成时是此次外部授权决策点；它不能与 RecordStore 做跨系统原子提交。按 B2 同一规则，每个新操作重核配置，并将持久 Run V2 绑定与 Role/Session guards 纳入本次事务，**不增加新的全局配置租约、不因缺少远期完整控制 writer 默认关闭 W2**。若 Host 要撤销已经运行中的持久授权，应先通过 R4 接点 CAS 撤销 Run binding，再切换外部权限配置；此处清楚报告两个系统的边界，不声称一次 callback 可同时锁定外部配置。提交后的新操作会看到最新外部配置。

W1 当前 `proposePlan` 使用 `ledgerHorizon`；Agent 高频白板提交不可把该全账本水位变成新全局锁。Agent proposal 分支按同一 scope/Goal/source/proposal 与执行角色实际 guards 提交，proposal 只是待采用材料，其诊断 issues 不是批准；apply 仍重新完成全部 W1 验证。Host 历史路径本批保持原行为。禁止为了复用而给 Agent 注入 Host ctx 绕过公开写者，禁止只在工具 factory 检查一次权限。

回执查询早于新许可；结束/撤权后的同身份精确重放返回原 value/cursor/replayed，不再产生动作；新 request 拒绝。相同身份改变 payload、expected、proposalRevision 冲突。预提交取消零正式写；实际 commit 成功后即使 signal 变更也必须返回 committed。Store 竞争只能恢复同 identity 的真实原回执。

## 5. 工具、Role 和 Skill 的真实生产者/消费者

首批固定四个工具：`query_task_graph`、`query_ready_tasks`、`propose_future_plan`、`apply_future_plan`。读取调用既有 PlanTaskPort；写入调用同一个已接委托 admission 的 PlanTaskPort。工具名须最终与 B2 envelope/Host grant/RoleSpec 配置一致，不另注册同名别义工具。

工厂 `createWhiteboardTools({ plans, context, goalRef, requestIdForCall })` 返回已有 `{names,create}`。goalRef/context 来自可信 B2 Run 绑定，模型不选作用域。工具 arguments 只含查询筛选/分页，或 v2 draft/basedOn/reason/精确用户版本 pins，或 proposalRef/expectedProposalRevision/精确 pins；不接受 sender、principal、RunRef、Role、generation、grant、configurationRevision、author、requestId。严格校验未知字段；requestId 来自真实 ToolCall.callId 加 operation/完整 Run 身份。不能按 args 哈希合并两次真实调用。

取消/拆分是 v2 target draft 的 disposition、任务、assignments、relations/inputRequirements/义务覆盖变更，复用 `deriveFuturePlanDelta`，不新增 deleteTask/splitTask 状态机。模型工具结果保留完整 typed rejection 与版本冲突；只有正式提交返回写成功。读为 read_only；写沿 Kernel 现有非只读类别及 hostAuthorizedTools 机制声明平台状态副作用，不授予 workspace write/shell。

Skill 资源放 `next/resources/skills/<id>/{skill.json,content.md}`，不是 vendor。直接复用 Kernel `FileSkillLoader` 的普通文件、containment、大小、manifest、重复 ID 与摘要检查；不要新写 loader。清单格式按已交付 `vendor/coding-agent/resources/skills/coding-safety/skill.json`。三个职责资源建议 `platform-secretary`、`platform-adviser`、`platform-scribe`；版本与资源内容摘要随可信 Host configurationRevision 固定。

| 资产 | 内容与输出约束 | 真实消费 |
| --- | --- | --- |
| 秘书 | 从 Goal/局部任务图/可用 Session 查询事实、路由材料、解释权限缺口与具体待决；不汇入全部历史 | B2 Role/Host 配置显式选择该 Skill，真实模型请求可见；工具清单仍按实际 grants 交集 |
| 参谋 | 调查局部图与来源、给方案/拆分理由/假设/影响；未来计划先 propose，获既有委托后才 apply | 同一 Run 工具调用得到 proposal/accepted Plan 回执；没有 apply grant 时只形成建议 |
| 书记 | 按正式回执、来源与版本整理已决定/未决/分歧，清楚区分事实和推断；不得将消息/Run ended 当 Task completed | 读取同一图/回执，输出带来源的解释；不能靠 Skill 自动写完成、决策或证据 |

Host 用精确 RoleConfigurationRef/pin 选择受信资源根/启用 IDs/静态职责文本，传 B2 已有 resolveConfiguration；Role 名字符串或 responsibility 标签不自选文件路径。不同 Role 可组合这些职责，三个 Skill 不要求三个永远运行的 Session，也不要求消息逐层转发。现有 `skills` 只支持一个 resourceRoot：应用资源根需包含明确启用的安全规范资源，或通过受信静态 systemInstruction 提供既有安全文本；不能配置不存在的跨根 fallback、不能改 vendor、不能把多 Skill 等同多 provider 调用。具体资源组合由主审在骨架阶段冻结。

稳定部分是 Skill/工具说明；Task/Goal/Role pin 与精确引用为本次绑定；连续内容来自原 Kernel Session 历史。不每轮重装全量历史。C1 邮箱工具与白板工具由组合根合并，检查名字唯一；这里不占用 C1 文件写权。B2 的真实 driver/模型工具循环提供生产调用链；独立 handler 测试不等于集成已交付。

## 6. 独立测试：必须能击穿错误实现

1. 真实 claim→B2 prepare/entered→受信 Role/Skill 工具装配→Agent 修改未领取 sibling Task→新 Plan 正式查询；同时原 running Task 的历史/状态来源不变。领域测试允许明确种子，但至少一条组合根路径不得手工种 running/envelope。
2. Host W1 所有旧行为与回执保持；work_run 直接调用公开 W1 方法也不能绕过委托配置。Host grant 无此工具、Role 上界撤权、V1/entering/unknown、错 Run/Role/Session/generation、Lease successor、跨 Goal/工作区分别失败。
3. 读取完 Role/Session/Run 后，在真正 commit 前通过正式 recordRunResult 结束 Run 并释放占用，真实 Store 拒绝且零新 Plan；不同 Goal/Session 无关提交不使 Agent proposal 失败。外部 callback 在**下一新操作**返回撤权则拒绝，不写虚假的跨系统原子断言。
4. 实际 claim 与未来编辑同 touched Task 竞争只能一个赢；持久 released Lease 仍非 future。未改任务保留原 `taskStateBasis`、Run/Attempt/历史，拆分/取消不丢义务。复用 W1 既有规则测试，只补 Agent 独有组合，不再复制全部 Store/Plan 矩阵。
5. 两个 Run 相同 callId/requestId 生成不同 proposalRef；同 Run/op 精确重放含结束后重试返回原 receipt；改 expected/payload 冲突；不同 Run 不冒认旧作者。原 proposal 修改后不得从当前状态重建旧回执。
6. proposal 属于另一 Run、旧无作者候选、Host 初始候选、非空 decisionRefs 不可借工具 apply；Skill 写“有授权”不改变结果。真实 actor/event 能追溯原 Run，不能变成 system/固定 human。
7. 工具 strict 输入及首 await 前快照；模型额外权限/作者字段拒绝；trusted context 修改不串台；预提交取消无正式写，提交成功后晚取消仍报告 committed。
8. SQLite 关闭重开后原 Proposal/Plan/actor/回执与精确历史来源保留；并发同请求重放与不同请求 CAS 分开。
9. 真 Kernel 请求捕获：所选秘书/参谋/书记正文与真实启用白板工具出现，未授权工具不出现；模拟 provider 发实际 ToolCall 驱动正式服务，第二次请求看到真实 typed 结果。可替换 provider 但不能用 fake dispatcher/fake admission 替代消费者。
10. Skill scenario 检查具体效果：参谋不把关系边当必须整任务完成；书记不把 ended/mail replied 当 satisfied；秘书缺能力给具体待决。区分受控 provider 的接线证明与开放模型效果评估，不能把 JSON 合法或正文出现宣称角色智能已验收。

## 7. 拟议文件 scope 与分派

下列均相对 `coding-platform/next`。主审中间审核后才冻结；本草案不授权实现。

**W2 领域 lane（可避开当前 C1/B2/M1 写权）：**

- `src/core/work-graph/tasks/plan-write-admission.ts`（新，身份与当前委托 guards）
- `src/core/work-graph/tasks/plan-service.ts`（同服务接 admission、Agent identity/replay、本地 guards）
- `src/core/work-graph/tasks/plan-contracts.ts`（可选提交来源 DTO）
- `src/core/work-graph/tasks/plan-record-codecs.ts`（来源校验；旧事件兼容）
- `src/core/work-graph/tasks/plan-commit-compiler.ts`（必要 provenance 透传；复用已有 compiler）
- `tests/work-graph/W2-agent-whiteboard.test.ts`
- `tests/helpers/W2-whiteboard-fixture.ts`（复用已有可注入 schema 的 task-claim-fixture，不复制账本）

不默认修改 `plan-readers.ts`、`plan-validation.ts`；现有导出足够，应优先使用。B2 正在修改前者时本 lane 只读验收后快照。若 admission 所需共享 facts 能从 B2/C1 收敛共用，由主审在双方完成后单独提取，不在 lane 偷改对方文件。

**W2 工具/角色资源 lane（独立）：**

- `src/core/agent-runtime/whiteboard-tools.ts`（新）
- `resources/skills/platform-secretary/skill.json`、`resources/skills/platform-secretary/content.md`
- `resources/skills/platform-adviser/skill.json`、`resources/skills/platform-adviser/content.md`
- `resources/skills/platform-scribe/skill.json`、`resources/skills/platform-scribe/content.md`
- `tests/runtime/W2-whiteboard-tools.test.ts`
- `tests/runtime/W2-role-skills.test.ts`

不改 `communication-tools.ts`、`observed-model-run.ts`、`execution-driver.ts`、`execution-entry-*`、material-grants 或 vendor；按现有 public-api 构造工具与资源。

**主审单独集成保留：** `src/composition/create-platform.ts`、必要 `composition` 导出/Host 配置文件、B2 真实 driver 调用点、构建资源打包清单，以及 `tests/composition/W2-agent-whiteboard-platform.test.ts`。精确实际文件在 B2 与本批骨架落地后列入单独 scope。`tools/dsh-refactor/check.py` 新专项注册由主审完成。Workflow N0 不在本草案伪开 capability。

骨架类型可编译、行为在 unsupported 处红；中审确认反例非坏 fixture 后冻结测试。实现后跑 W2 专项、受影响 W1/Role/B2/C1 回归，再完成 `node --run verify:isolated` 与受保护旧文件 hash 核对。只有真实生产者、调用者、事务状态、历史读取和 Skill 接线均通过才更新能力索引；继续后续 Workflow/控制/证据/Host/UI 范围。

## 8. 主审待冻结签名建议

2026-09-26 补充；本节是供主审冻结的最小方案，不授权实现，不修改前文范围结论。源码基准：[现有 Plan 服务](../../../coding-platform/next/src/core/work-graph/tasks/plan-service.ts)、[Plan 契约](../../../coding-platform/next/src/core/work-graph/tasks/plan-contracts.ts)、[WG11](../../../coding-platform/next/src/core/work-graph/tasks/run-state-service.ts)、[B2 依赖](../../../coding-platform/next/src/core/work-graph/tasks/execution-entry-contracts.ts)、[Prepared 清单](../../../coding-platform/next/src/contracts/core/prepared-execution.ts)、[B2 实现任务](B2-execution-state-implementation.md)。B2 已经独立返修审核并合入主工程，导出 `readStoredManifest`、`recheckHostRoleAdmission`；W2 派发使用该审核版本的只读快照。

### 8.1 同一 Plan 服务的窄依赖和身份

建议只新增以下内部类型/函数；`PlanTaskPort` 的公开方法和输入不变。示例中的类型全部从现有声明导入，不复制 Session、Run、Role 或 Store DTO。

```ts
// plan-write-admission.ts；ExecutionEntryDependencies 仅 type-only 引用。
export type PlanDelegatedWriteDependencies = Pick<ExecutionEntryDependencies,
  'reads' | 'roles' | 'bodies' | 'authorizeConfiguration'>;
export type PlanWriteOperation = 'propose_future_plan' | 'apply_future_plan';
export type AgentPlanWriter = {
  actor: Extract<ActorRef, { kind: 'agent' }>;
  runRef: RunRef;
  sessionRef: SessionRef;
  goalRef: GoalRef;
  workspaceId: string;
  roleBinding: RoleBindingRefV1;
};
export type PlanWriteAdmission = {
  provenance: PlanWriteProvenanceV1;
  guards: readonly RecordGuard[];
};
export function identifyPlanWriter(
  deps: Pick<PlanDelegatedWriteDependencies, 'reads'>,
  ctx: CoreCallContext,
  scope: { projectId: string; workspaceId: string },
): Promise<ReadResult<AgentPlanWriter>>;
export function authorizePlanWrite(
  deps: PlanDelegatedWriteDependencies,
  ctx: CoreCallContext,
  input: { writer: AgentPlanWriter; operation: PlanWriteOperation },
): Promise<ReadResult<PlanWriteAdmission>>;

// plan-contracts.ts；candidate_v2 增加 submittedBy?: PlanWriteProvenanceV1。
export type PlanWriteProvenanceV1 = {
  schemaVersion: 1;
  runRef: RunRef;
  sessionRef: SessionRef;
  roleBinding: RoleBindingRefV1;
  sessionGeneration: number;
  entryGeneration: number;
  authorizationRevision: number;
  configurationRevision: string;
};

// 原 PlanServiceDependencies 仅追加：
// delegatedWrites?: PlanDelegatedWriteDependencies;
```

`identifyPlanWriter` 只服务 Agent 分支；Host 继续原 `boundWriteActor`。Plan 服务在首 await 前隔离完整请求与 ctx，保留原 AbortSignal；`identify` 对已隔离的 work_run 核 materialReader.kind=run、完整 requester、ctx.roleBinding 与正式 Run 一致，再经 WG11 验证 Run/outbox.claim 的持久关联。`actor.id = 'session:' + sha256Hex(canonicalJson(sessionRef))`，`actor.runRef` 为完整正式 RunRef。旧 `agentPrincipal` 不参与授权或新 identity，不制造 workId。`identify` 不要求 Session 仍 active/occupied、Run 仍 running，不调用当前配置，以便结束/撤权后的原回执重放；它返回的身份不是执行许可。当前 Session.role 可变，不拿它重建历史 actor。

WG11 是 Host-only 读取；admission 内只为精确 `ctx.principal.runRef` 构造固定 system 平台服务读取 ctx（相同 project/workspace/signal、Host reader actor 一致），不把这个 ctx 传入公开 Plan 写方法。业务事件始终使用上述 Agent actor。`authorize` 重新读 WG11，不直接复用 identify 阶段的旧快照；校验其稳定映射仍与 writer 相同。所有 Store guards 从这次事实和同次 RoleFacts 派生，仍由 Plan 服务唯一的 `records.commit` 提交，无第二 records/provider/authority 对象。

### 8.2 配置来源、共享准入与局部 CAS

从正式 `run.envelope.bundleRef` 调用 B2 `readStoredManifest({bodies}, run)`；只读这一 pinned manifest。`configurationRevision` 只能取其 `hostConfigurationRevision`，不能从 roleId、Session revision、caller metadata 或工具 JSON 推测。核实际 body digest=`bundleRef.digest`=`run.inputBinding.manifestDigest`；实际 input digest=`manifest.inputDigest`=`inputBinding.inputDigest`=`auth.inputDigest`，并核 manifest.claim/roleBinding/sessionRole/workspaceSnapshot/permissions/budget 与同一正式 claim、Run envelope、Session 对齐。完整性、contentType/界限与 manifest codec 规则归 B2 同一 helper；如共享 helper 缺必要校验先报主审修 B2，不在 W2 复制第二 parser。

复用 B2 `recheckHostRoleAdmission({roles,authorizeConfiguration}, internalReadCtx, {run, manifestRole: manifest.role, sessionRole: session.role, roleBinding: run.roleBinding, permissions: manifest.permissions, hostTemplate: manifest.hostTemplate, configurationRevision: manifest.hostConfigurationRevision})`。它已经复用 `resolveRoleBindingFacts`、当前 matrix/pin 上界、可信 legacy template 和实际 Host callback；W2 仅再核所需 `operation` 在已通过复核的 envelope/manifest tools 中。不能直接复用 `admitEnteredRun`：其 `plans/materials` 和 selected TaskInput 重开属于模型调用准入，会造成 Plan 自依赖及无关材料成为白板门槛；W2 不获取新的模型调用 permit。

W2 自有约束只包含：V2 entered+Run running；outbox entered 及其 dispatchState.consumerId/entryGeneration/sessionGeneration 与当前授权和 claim 一致；Session active 且 health=available、execution occupancy 精确指向 Run 且 generation=claim.generation=auth.sessionGeneration；Lease 非 null、无 release 且 holderRunId/attemptId/完整 Task ref 一致；正式 Attempt 属于此 Run。`entryGeneration=auth.generation`，`authorizationRevision=auth.revision`，都不是 Run.revision。新写 provenance 来自这次结果。Session/Run/Attempt/outbox/Lease 实际 record revision（以及被依赖的 immutable source Plan）加 RoleFacts guards，与 W1 guards 逐键严格合并；同 key 不同 revision/null 直接 revision_conflict，不能取较大版本。

业务限制留在原 Plan 服务：propose 必须 draft.schemaVersion=2、basedOn 非 null 且为目标 Goal 当前 activePlan；apply 必须 candidate_v2、submittedBy 的完整 RunRef/SessionRef/RoleBinding 等于 writer、decisionRefs 为空，再走原 W1 future 编译规则。不能把提交时 authorizationRevision 等于当前值当作者证明（授权状态推进可能合法改变它）；当前许可另由 authorize 判定。Host 可采用 Agent 候选。目标 Goal 必须等于 writer.goalRef，apply 从候选正文核 goalRef，不能从不含 goalId 的 proposalRef 推测。原 Run/claim.planRef 是原执行定义，不能要求它等于编辑时当前 activePlan；basedOn 必须当前，同一 Run 可连续修改两版未来计划。Agent proposal 使用 scope/Goal/source/proposal/Role/执行 guards，不使用 ledgerHorizon；apply 继续原局部触及任务守卫。两者都在 commit 前检查原 signal，commit 成功后直接保留真实 committed。

Agent 命令 identity 使用原 `commandIdentityKey`（该函数实际序列化完整 actor，已包含 runRef），operation 前缀隔离；proposalId 的新 Agent 分支哈希 `{operation,projectId,workspaceId,goalRef,actor,sessionRef,requestId}`。Agent fingerprint 额外包含经过合法性检查、按完整 ref canonical key 稳定排序的全部 `meta.expected`（五类 pins 及 revision 均保留）；不能对 `normalizeCallerPlanPins` 的投影结果哈希，该结果会丢 PlanRevision/PlanProposal pins。当前 Host fingerprint 不包含 expected，必须原样保留 Host 兼容。身份/输入验证后先 lookup 原 receipt，再作当前许可；回执恢复沿原事件和历史 candidate，不从当前 accepted candidate 伪造。Agent propose replay 核原事件 actor 和 candidate.submittedBy 的稳定身份；apply replay 从原 receipt fingerprint + accepted 事件 actor（含完整 RunRef）和 goalRef 恢复，不为读取 submittedBy 再依赖当前 proposal。不能要求提交时授权 revision 等于现在。旧候选无 submittedBy 只能走 Host 行为。首次查回执为空后，若 fresh 权限/Session/版本等检查失败，再查同 identity+fingerprint 的正式回执：允许同键并发提交随后撤权的已发生结果恢复，不能把重放变成新动作。沿用 apply 的既有恢复顺序，Agent propose 也覆盖此窗口。普通图/候选查询继续原读取授权，不接委托写的完整准入链。

### 8.3 工具签名、资源与精确派发 scope

```ts
export const WHITEBOARD_TOOL_NAMES = [
  'query_task_graph', 'query_ready_tasks',
  'propose_future_plan', 'apply_future_plan',
] as const;
export type WhiteboardToolsConfig = {
  plans: PlanTaskPort;
  context: CoreCallContext;
  goalRef: GoalRef;
  requestIdForCall: (call: Readonly<ToolCall>) => string;
};
export function createWhiteboardTools(config: WhiteboardToolsConfig): {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};
```

沿用 C1 工具签名/public-api。factory 隔离可信 ctx/goal，handler 首 await 前隔离 args；writes 的 expected 是用户看到的 W1 pins，仍由原 normalizer 校验，不自动补新 revision 或增加工具可写 Run pin。模型不能提供 requestId/context/permissions/provenance。工具绑定固定 goalRef，query 不能另填 Goal，apply 对候选必须核目标 Goal。requestIdForCall 由 Host 用实际 callId+完整 Run+operation 生成，空 callId 拒绝；同 call 重试稳定，不用参数哈希或随机数。names 为完整目录，实际注册仍由 B2 的 Host grant/Role 交集过滤，不能因为工厂声明 names 就补授权。

建议最小领域 lane 写 scope 为 **4 个生产文件+2 个测试文件**：`tasks/plan-write-admission.ts`、`tasks/plan-service.ts`、`tasks/plan-contracts.ts`、`tasks/plan-record-codecs.ts`、`tests/work-graph/W2-agent-whiteboard.test.ts`、`tests/helpers/W2-whiteboard-fixture.ts`（路径前缀同 §7）。`plan-commit-compiler.ts` 当前已经 `{...candidate, revision, status}` 保留来源且接受 `priorGuards/actor`，从默认写 scope 移除；发现实际缺口再向主审申请。工具/resources lane 沿 §7 精确 9 文件，不改任何 B2/C1 接线。Skill 不新增 loader；主审冻结资源组合采用应用 resourceRoot 的三个 Skill，并通过可信静态 systemInstruction 提供现有安全规范；本 lane 不复制或改写 vendor 安全正文。

骨架阶段新增函数/Agent 分支在真实 fixture 初始化后明确 unsupported；旧 Host 方法必须仍可运行。领域约 10 个独有场景按 §6.2—8 合组（真实 Agent成功链、逐项许可拒绝、manifest绑定错配、Session/Role/Run CAS、无关并发、两Run同callId、终态replay与改pins、他人candidate、late cancel、SQLite重启）；工具约 5 个场景（strict未知权限字段、固定作用域、callId身份、typed结果/晚取消、四工具声明），Skill约 3 个场景（真实loader清单/摘要、启用子集入真实模型请求、三职责具体行为约束）。至少一条真实 prepare→entered→工具→Plan 链由主审持有的组合根测试完成；领域测试不能用恒真 admission 掩盖缺失 B2 接点。

**主审需最终冻结的四项：** B2 两个共享 helper 的可读快照与完整校验责任；本节四字段 delegatedWrites 和只读系统 ctx；Agent 专属 ID/fingerprint/provenance 兼容分支；应用资源根+可信安全 systemInstruction 的组合根策略。冻结后先派骨架/测试并停止，中审前不得提交生产行为实现。

### 2026-09-26 测试范围纠正

已删除本批直接改写 Run/Session 内部状态的 7 个测试 case 和专用辅助代码；新写拒绝及提交竞争用正式 recordRunResult 产生，保留真实 Host 撤权与公开输入反例。Session 无运行中换 Role 生命周期，不补该类测试。原共享 B2 当前身份/所有权检查仍复用；不因字段类型存在就为白板扩张控制/维护产品行为。最新冻结测试以 W2-agent-whiteboard-implementation.md 与本次中审哈希为准。
