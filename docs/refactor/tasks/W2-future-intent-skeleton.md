# W2：未来意图节点与逐步细化骨架任务

状态：2026-09-26，Astra 接口设计，供主审冻结后派发 DSH 骨架与独立测试；本文不授权生产实现。只施工 `coding-platform/next`。阶段顺序：本设计 → DSH 骨架/测试后停止 → Astra 中审真实反例与红因 → 冻结 scope/测试 → DSH 实现 → 独立验收。

## 1. 用户要求与本批边界

未来任务可以先只有基础意图，没有完整验收条件、依赖或分配，用于长程计划防遗漏。任务节点存在、成为候选、领取、执行和正式完成是不同事实。规划语义由 Agent/Skill 判断；工具在实际副作用边界保留必要结构、权限、版本和所有权约束。不得把旧助手建议的 maturity 枚举当用户强制，也不建立第二个规划数据库或调度器。

依据：[产品](../../PRODUCT.md)、[核心操作 §6](../CORE-DATA-OPERATIONS.md#6-d3任务白板状态关系与候选查询)、[WorkGraph §5](../modules/core/work-graph.md#5-taskport目标计划领取完成)、[W1](W1-future-plan-skeleton.md)、[Agent 白板委托任务](W2-agent-whiteboard-skeleton.md)。后续明确用户纠正优先于旧文档“所有 Task 都是可执行工作”“接受计划必须完整分配/验收”的限制。此处新增执行意图字段是最小工程选择，不是新的用户产品对象。

本批贯通可信 Host 的初始意图 Plan、未来意图增补/细化、查询解释和正式 claim 边界。Agent 使用同一个 PlanTaskPort；真实 Agent 委托、工具/Skill 接线复用既有 W2-agent-whiteboard；本批同步既有白板工具的 v2 字段说明与最小真实透传验证，不重做工具权限或模型循环。完整 evidence/completeTask/completeGoal writer 尚未实现，本批不得伪造完成 API 或宣称 Goal 已可完成；只提供准确的待完成解释并冻结后续完成入口必须遵守的约束。

## 2. 已有实现与确切缺口

- `plan.ts:RuntimeTask/PlanRevisionDraft`、既有 TaskTriple/PlanRevisionRef 继续作为唯一身份。Task 的标题可承载初始基础意图，不要求新 description、独立 Intent 聚合或新成熟度状态。
- `plan-record-codecs.ts` 已允许 assignments 缺省、obligations/关系/精确输入集合为空；结构合法不等于当前 apply 接受。`plan-validation.ts:validatePlanDraft` 的 required work/gate/obligation/verification 完整性和 `validatePlanAssignments` 的每 work 恰一分配，仍被初始与未来 apply 统一用作拒绝门槛。
- `queryTaskGraph` 已枚举全部已采用任务；`plan-readers.ts` 从 Run/Reduction/Lease 派生 effectivePhase。`eligibility.ts` 不再等待前驱整个任务 satisfied，但 pending/free 的空定义可能成为候选，所以不能仅删除完整性校验而不修改资格。
- W1 已拥有 future delta、Task basis、局部 Lease/Reduction 缺席 guards、正式计划编译、CAS、重放、SQLite。`FrozenTaskDefinition.assignment` 已可为 null；不需要新的状态库。
- W1 目前拒绝已有无 assignment 节点的首次分配，新增任务还受 source 已有角色集合限制，并拒绝所有新增 gate。仅允许保存空节点却不能后补分配/完成定义，会产生无法推进的死端。
- future apply 目前用 `tryPolicyContent(project)` 读当前激活政策，失败可返回 null；future compiler 却保留 `source.effectiveCompletionPolicy`。本批首次追加义务时必须按源 Plan 精确政策 pin 验证，不能按另一激活版本验收或静默跳过。
- `whiteboard-tools.ts` 的 draft 实际为 `z.record(z.string(), z.unknown())`，已经透传 v2 对象；工具说明仍列旧 RuntimeTask 字段及完整 work/gate/obligation 要求。需要同步说明，不需要新 strict draft schema 或第二套领域校验。

## 3. 最小字段与兼容规则

在 `src/contracts/plan.ts:RuntimeTask` 增加一个可选字段：

```ts
executionIntent?: 'plan_only' | 'request_execution';
```

该字段只表达此次采用的编排意图。它不是角色授权、资源许可、实际 ready、Run 状态或完成判定。phase/disposition/requirementLevel/taskKind 的含义保持正交；不得以 optional 表示“不知道验收”，不得以 blocked 代替“先记意图”。

| 定义 | 保存/采用 | 候选与 claim | 完成解释 |
| --- | --- | --- | --- |
| work + `plan_only` | 允许仅标题/现有机械字段；assignment、义务/验收、依赖、精确输入可缺省 | 即使已经填写 assignment 也不成为可领取候选；claim 明确 incomplete，零占用/Run | 未细化；没有验收定义时另报该缺口 |
| work + `request_execution` | 必须已有且仅有一条合法 role/instruction assignment；验收、依赖、精确输入不强制齐全 | 参与既有 task_state 资格检查，随后 claim/Runtime 核真实权限/绑定/预算 | 调查等任务可执行但未可完成；缺验收不能空通过 |
| work 未带字段 | 保留原完整执行定义语义与历史兼容，不替所有现存 v1/v2 draft 加字段 | 按原逻辑及本次通用 assignment 完整性核验 | 不借新功能豁免原已采用验收要求 |
| gate | 不接受 executionIntent；仍不被 claim | 只由将来 evidence/reduction 处理 | 采用 gate 不产生 gate 结果 |

`plan_only`/`request_execution` 只在 v2 新能力中允许；历史 v1 字节兼容，v1 带新字段返回 invalid。v2 旧快照缺字段继续可读，不回写历史，不新增 Plan 版本号。codec 严格拒绝其它值及 gate 上的字段。`runtimeTaskIssues` 当前没有父 Plan 的 schemaVersion，v1 禁止新字段须由 `structuralPlanIssues` 的父版本分支落实，不能只校验枚举值。

**兼容必须具体实现，不能变成所有新 draft 必填。** 新字段缺省的工作节点继续满足旧单节点分配与 required 义务映射规则；若存在这类 active required work，保留旧初始完整计划所要求的 required Goal gate/required obligation。显式意图节点不参与这些旧“完整工作定义”数量/覆盖要求。全部为显式 plan_only、或显式 request_execution 调查节点的初始 Plan，不再要求人为补一个 work/gate/验收模板才能记录。已经提供的正式义务仍验证真实字段/引用及适用政策，不把错误条件当缺省条件。

新豁免分支必须以 v2 draft **实际含有显式 executionIntent 的 work 节点**为前提，不能仅看 legacy required work 数量是否为零。完全没有新字段的 v1/v2 继续原规则，原本不合法的空 Plan、无 required work 的 optional-only 旧形状不能借此变合法。混合计划中未标字段的节点继续旧分配/义务规则，存在 legacy active required work 时保留旧 required Goal gate/required obligation；显式节点的存在不能整体关闭 legacy 校验。

现有 source 节点为 plan_only 时，target 必须显式保留 plan_only 或显式改为 request_execution；省略字段返回 `invalid`，说明不能靠省略激活。source 明确 request_execution 的字段也不能被省略成 legacy 语义。source 缺字段的旧 Task 允许保持缺省；要改为 plan_only 或显式 request_execution 属于未来执行定义变更，走同一 future/CAS 检查。新增节点的工具说明/范例须明确填写执行意图；不把 assignment 自动推导为激活意图。

完整 initial-only 示例仍使用普通 v2 draft：`tasks:[{taskId,title,scope:{kind:'goal'},requirementLevel:'required',taskKind:'work',disposition:'active',phase:'pending',executionIntent:'plan_only'}]`，`assignments:[]`、`obligations:[]`、`stages:[]`、`taskHierarchy:{parentOf:[]}`、`executionDag:{dependsOn:[]}`。这不是特殊计划种类。初始节点必须有稳定 ID、有界基础文本和已知 Goal/Workspace；复用现有 bootstrap/governance pin 读取，不伪造不存在的治理记录。本批不重写治理 pin 的历史结构。

## 4. 结构校验、执行条件与规划诊断

保持现有 `proposePlan/applyPlanChange`，不新增 saveIntent/promoteTask 方法。proposal 的 issue 是候选反馈，不是执行许可；apply 重核当前源及相应局部条件。

### 4.1 写入的必要约束

- 拒绝格式/非法字段、重复身份、越作用域、悬空引用、非法硬边/层级环、gate 的实现分配、同任务重复 assignment、伪造进度/结果。提示 taskRelations 可循环，不判断语义合理性。assignment 若提供，role/instruction 仍须合法非空；未知不能写成空字符串假装已定义。
- 保留新 Task phase=pending、同源当前 Plan、连续 planRevision、请求身份、CAS、旧 taskId 不物理删除、历史 basis 正确性。拒绝已领取/执行/归约的 Task 执行定义变化。
- plan_only 缺分配/验收/关系只产生诊断；不会令合法节点写入失败。request_execution 缺唯一合法分配是该显式执行意图尚不可受理，apply 返回 `incomplete`，可先采用 plan_only 保存；非空但非法形状仍是 `invalid`。
- 未提供依赖/精确输入不是错误；提供后核引用/结构，真正读取时沿 readTaskInput→MaterialPort 核适用性。不能提前打开全部材料以证明计划可接受。
- 不新增模型评价、全范围证明或全账本锁。编排是否合理、调查是否充分及未知后继怎样拆分，留给 Agent/Skill。

### 4.2 只读诊断的具体契约

在现有 `tasks/plan-contracts.ts` 定义小型 DTO；诊断不写入 Task/Goal 的运行状态，也不创建另一套持久 completeness 表：

```ts
type TaskPlanningDiagnostic = {
  code: 'planning_only' | 'acceptance_not_defined';
  taskId: string;
  message: string;
};
type GoalPlanningDiagnostic = TaskPlanningDiagnostic | {
  code: 'required_task_unfinished'; taskId: string; message: string;
} | {
  code: 'goal_acceptance_not_defined' | 'goal_gate_not_defined';
  message: string;
};
type GoalPlanningView = {
  completionEvaluation: 'not_evaluated';
  diagnostics: GoalPlanningDiagnostic[];
};
// TaskRow 兼容增加 planningDiagnostics?: TaskPlanningDiagnostic[];
// TaskGraph 兼容增加 planning?: GoalPlanningView;
```

可选字段用于旧消费者类型/骨架兼容，缺省表示该生产者尚未提供此投影，不等于无缺口。第二阶段本目标查询必须实际返回它们，测试须断言真实存在；不能靠接口可选省略生产接线。`planning_only` 按明示意图派生；`acceptance_not_defined` 表示该 task 没有关联任何带明确 verificationRequirements 的义务，不表示已有验收已满足。已经声明的验收由采用时结构/政策验证保证其声明合法；图查询不执行验证工具、不打开材料、不模拟 evidence reduction，也不为这些诊断重新读取治理政策。

TaskGraph 的 Goal 解释基于同一次已读 Plan+canonical tasks：所有 required 且 active/deferred 的 task，只要 effectivePhase 不是正式 satisfied，均列 `required_task_unfinished`，**包括无 assignment、无 obligation、无 Run 的 plan_only 节点**。没有 required obligation 报 `goal_acceptance_not_defined`；没有 active required Goal gate 报 `goal_gate_not_defined`。复用 `readCanonicalTaskFacts` 的既有归约：没有 Run/Reduction 时为 pending，Run ended 但无正式完成归约时仍为 blocked；不为新意图节点增加完成推断。这些缺口不会阻止记录/调查。Task 行显示所有节点自身诊断；Goal 聚合仅把 applicable required 节点的诊断列为未完成解释，optional 意图仍可在 Task 行看到，不升级成新增必做义务。

返回次序按 taskId/code 稳定排序，重复诊断去重。复用已有图查询结果在内存完成投影，不额外全扫事件、读 Session 或重新捕获源。`queryGoal` 保持轻量原接口，Goal 的全任务未完成解释由已有 `queryTaskGraph(goalRef)` 给出；不为一个新 DTO 再创建查询服务。

`completionEvaluation:'not_evaluated'` 是能力边界字面值，不是新 Goal 状态。即使 diagnostics 为空，也不返回 canComplete=true/completed，不证明证据、来源、reviewer 或正式归约已经满足。后续 R3e completeTask/completeGoal 必须检查正式验收与证据；没有定义就返回 `incomplete`，不能对空集合使用 every()==true 完成任务或 Goal。该 writer 本批不存在、不得造空实现。

### 4.3 就绪及领取

在现有 `dispatch.ts:TaskIneligibilityReason` 增加 `task_planning_only` 与 `task_assignment_missing`，均带 taskId/message；不新增 CoreError。`evaluateEligibility` 复用 `revisionAssignments` 核正式定义：plan_only 返回不可领取；缺 assignment 返回不可领取。assignment 是结构条件而非角色许可，保持 `eligibilityScope:'task_state'` 的查询承诺，不在查询时调用 Host/Role 授权服务。

`queryReadyTasks(includeBlocked:false)` 不返回上述不可领取节点；`includeBlocked:true` 可返回并带明确原因。TaskGraph 始终展示它们。`claimTask` 在创建任何 Lease/Run/Attempt/outbox 前用同一规则拒绝 plan_only/缺分配，顶层 `incomplete`；真实 Role 不匹配仍 `forbidden`、Session/Task 占用仍 `busy`、CAS 仍 `revision_conflict`。不能只隐藏列表却让直接 claim 绕过。完整的 request_execution 调查任务不因 acceptance_not_defined 被拦；真正工具调用仍走 B2 当前权限和局部副作用约束。

## 5. 逐步细化与已有义务保护

全部使用现有 v2 target draft、`deriveFuturePlanDelta`、`validateFutureObligationCoverage`、`readFutureChangeTaskFacts` 和编译器；新增 executionIntent 进入 FrozenTaskDefinition 的 RuntimeTask 部分，随实际变更更新 taskStateBasis，未改节点沿原 basis 继承。禁止把诊断结果放进冻结执行定义。

1. **先存意图。** 初始仅意图 Plan 可采用；既有 Plan 可新增任意数量有界 plan_only 节点，不需要给每个节点编造 assignment/验收。新节点保留 required/optional 的真实范围语义。
2. **补分配/执行说明。** 原 assignment=null 的未来 Task 可以首次添加 assignment；这不是把原角色改派。已有非空 assignment 的角色不得利用此分支被替换。首次声明的 role 是计划中的期望承担者，不构成 Role/工具权限授予；即使初始计划全是意图、source.assignments=[]，也不能因“source 无角色集合”永远不能细化。此规则同时覆盖本次新增的显式 plan_only/request_execution work 节点：其首次 assignment 不要求 role 已在 source.assignments 出现，允许一步新增带合法分配的调查节点。新节点未标 executionIntent 的 legacy 分支保持原约束；已有非空 assignment 的角色不能经删除再补回或此新增分支改派。claim 使用真实 Session/Role 配置和 guards，Runtime 使用真实 Host grant。既有已分配任务的角色改派继续不属于本窄批。
3. **显式激活。** plan_only→request_execution 必须显式字段变化、唯一合法 assignment，仍须证明该节点从未领取/执行/归约。补入 assignment 本身不自动移除 plan_only。request_execution 也可以只调查一个具体问题；无完整验收作为可见诊断保留。
4. **补新验收。** 允许追加全新 obligationId，其 taskIds 仅引用本次可细化的未来任务或本次新增 gate；新增义务的完整声明按 **source.effectiveCompletionPolicy 的精确 ref+digest** 验证 kind/最低要求；不是项目当前激活的另一政策。不要求预先造空 obligation 占位；尚未确定条件就省略并诊断。一旦成为正式义务，后续改变其语义走完整授权计划变更，不伪装“首次补全”。新增义务不得为已执行任务追溯改变验收；映射变化参与 affected Task delta/CAS。
5. **补 gate。** 允许新增 phase=pending 的 gate，仅承担此次新增验收义务，禁止实现 assignment/执行意图；否则 initial-only-intent 没有 gate 将永远无法补完整完成定义。原 gate 的执行定义与验收关系仍按 W1 不变规则保护。若要改写旧 gate/治理政策，明确 unsupported，留完整授权变更。
6. **保护既有要求。** source 每个 obligation 的 ID、标题、requirementLevel、verificationRequirements 原样保留，合法承担覆盖仍保留；不得删除或弱化来换取接受。既有 Run/归约 task 的义务集合不变。取消/拆分唯一承担者仍需同次修订提供有效替代，任务条目用 disposition 留档。新增验收只附加当前 scope 内要求，不赋予新预算、Role/工具或工作区权限。

**新增义务的政策读取。** 仅当 future target 出现 source 中不存在的 obligationId 时，由 `plan-service.ts` 在 apply 路径调用 `plan-readers.ts` 的窄 pinned-policy reader。复用现有 policy ref/正文解析、`completionPolicyDigest` 与 RecordStore 定向读取，核完整 ref、内容 revision 和原 pin digest，返回实际 content 及本次局部版本 guards，合入原提交；不要复制治理算法、引入新 service/manager 或重新读取 active 指针来替换源 pin。缺记录、不可用或 pin 不符沿既有精确拒绝语义处理，不退为 null 后跳过验证。初始 adoption 继续原 `resolveGovernance`；普通图查询、原 receipt 恢复、仅补分配/意图/关系而未新增义务的 future apply，不因本批增加政策读取。原候选 issue 的机会性政策读取不能作为新增义务 apply 的授权依据，结构/意图/覆盖应用规则仍由现有共享 validator 承担。future compiler 继续原样继承 source 政策 pin；本批不切换政策、不改写旧义务。

原“从未领取”检查使用 TaskLease 缺席与历史 Run/Reduction，同正式 claim 的一次事务竞争；released Lease 也不能恢复 future。不要用整个账本水位锁代替此局部事实。生成新 Plan、Goal 指针、Proposal 接受及事件仍只有原编译/commit 路径。相同 request 精确重放返回原 receipt；当前任务后续已运行也不能使原 receipt 变成新失败；新 request 则重新检查当前事实。

## 6. 失败语义与骨架停止点

| 场景 | 结果 |
| --- | --- |
| 非法 executionIntent、v1 带字段、gate 带字段、悬空/重复/非法结构、省略 source 明示意图 | `rejected/invalid`；proposal 不存损坏形状，apply 不提交新 Plan |
| plan_only 缺分配/验收/依赖 | 合法持久 proposal/采用；返回图上诊断；不是 `incomplete` 写失败 |
| request_execution 缺唯一合法 assignment | proposal 可保留候选并给 issue；apply `incomplete`；不误称非法 Task 身份 |
| 直接 claim plan_only/缺 assignment | `incomplete`，零正式 claim 副作用 |
| request_execution 有分配但尚无验收 | 可通过采用及 task_state 候选，claim 继续核其他正式前置；完成未被证明 |
| 修改 source 已存验收/旧角色/gate、越窄范围授权 | 使用既有 `invalid`/`unsupported` 精确分支，reason 指向对象，不降格成可忽略规划提示 |
| 新增义务时源 Plan 的精确政策 pin 无法读取/核实 | 沿既有缺失/不可用/source_stale 语义拒绝；不得 null 放行或切换当前激活政策 |
| 细化与 claim/版本改变竞争 | `revision_conflict`；保留赢家真实结果和全部无关任务历史 |
| 没有正式完成定义/证据时要求完成 | 后续正式 completion 契约必须 `incomplete`；本批不暴露完成 writer |

新增 assignment 缺省的 candidate issue 复用 `PlanValidationError` 已有 `unsupported_execution_change` 太泛，不应混用：在该类型闭合 code 集合最小加入 `missing_task_assignment`，消息只诊断显式请求执行缺少什么。plan_only 的正常缺口放只读 planningDiagnostics，不污染现有阻断 issues。合法候选含 incomplete issue 不等于可 apply。主审须检查 validatePlanDraft 输出在所有消费者中的使用，不能只改一处 if 让另一入口继续旧门禁。

第一阶段保留旧 Host/W1 行为；新 executionIntent 分支和新增查询投影可先明确 unsupported，新的风险测试按真实 boundary 保持红色。不得把返回假 ready/空诊断当骨架，不得在此阶段实现完整判断算法。旧 codecs 的新字段 shape 支持与纯类型是骨架允许内容。Astra 中审后才冻结实现测试及精确 scope。

## 7. 拟议 scope 与写权顺序

以下路径相对 `coding-platform/next`，是本批唯一候选集合；主审检查骨架后冻结，不授权触碰其它源码。

生产候选 **10 文件**：

1. `src/contracts/plan.ts`：executionIntent、最小缺 assignment issue code、纠正 all tasks executable 注释。
2. `src/contracts/dispatch.ts`：两个资格 reason。
3. `src/core/work-graph/tasks/plan-contracts.ts`：只读诊断 DTO、TaskRow/TaskGraph 字段。
4. `src/core/work-graph/tasks/plan-record-codecs.ts`：新字段/issue code 的严格 shape，旧记录/事件兼容。
5. `src/core/work-graph/tasks/plan-validation.ts`：三种声明分支、结构与缺省诊断、首次分配/新义务/新 gate、明示激活。
6. `src/core/work-graph/tasks/plan-service.ts`：初始/未来采用使用同一规则；仅新增义务的 future apply 调精确政策 pin reader 并合并局部 guards；原读结果附诊断；不另写编译器。
7. `src/core/work-graph/tasks/eligibility.ts`：共享 plan_only/assignment 判据，继续无前驱完成门禁。
8. `src/core/work-graph/tasks/claim-service.ts`：复用资格结果并保留既有权限/CAS/幂等，修改顺序避免先分配角色失败掩盖 plan_only 原因。
9. `src/core/work-graph/tasks/plan-readers.ts`：仅抽取/复用现有政策解析与 digest 增加源 Plan 精确政策 pin reader，不改普通任务事实/图读取与 source basis 算法。
10. `src/core/agent-runtime/whiteboard-tools.ts`：仅同步 v2 RuntimeTask 的 executionIntent、显式保留/激活与 plan_only 示例说明；保留现有 draft record 透传和严格外层身份/pins schema，不增加领域语义校验。

测试候选仍为 **2 文件**：`tests/work-graph/W2-future-intent.test.ts`、`tests/composition/W2-future-intent-platform.test.ts`。复用 `task-claim-fixture` 的真实 SQLite/Memory、正式 Goal/Plan/Session/claim；可在测试文件内创建第二个真实 Goal 验证初始仅意图。没有新 helper 写权。默认用真实公开 writer 产生 Goal/Plan/Session/claim 及采用义务，项目/工作区/治理初始事实复用既有可信夹具；不种运行/义务/归约记录冒充 writer，不新增正文损坏或持久数据篡改矩阵。

`plan-task-basis.ts`、`plan-commit-compiler.ts` 保持只读：现有 RuntimeTask 完整冻结/复制、绝对 basis 和 future guards 足够。若实际发现字段被投影丢失，向主审给具体符号与反例后再单文件扩 scope，不能预先复制逻辑。旧 W1/Claim 测试预期原则上保持；确因新字段查询投影需要修改夹具，由主审核真实语义后单列刷新，DSH 不改冻结测试。

**与既有 W2-agent-whiteboard 不可并写。** `plan-service.ts`、`plan-contracts.ts`、`plan-record-codecs.ts` 与其领域 lane 重叠；本批等该领域 lane 中审/合入后，以同一快照开工，或主审暂停其写权后统一单 lane，不逐文件混入过期版本。`claim-service.ts` 同理先确认 B2 当前写权释放。`whiteboard-tools.ts` 的说明修改同样等原工具 lane 释放写权后串行，不能覆盖 C2/工具接线。本任务不触碰 plan-write-admission、Role/Skill 资源、C1/M1/B2 文件、composition 实现或 vendor。

Agent工具/resources lane 若并行，只读本次冻结 DTO。当前工具 draft 是 record 透传，新字段 shape 由同一个 Plan codec/validator 检查；本批更新模型可见说明并用真实 factory→PlanTaskPort 验证字段不丢失、采用和查询诊断，不能声称 scripted 测试证明模型会自主细化。现有 adviser/scribe Skill 已要求保留未来意图及区分执行与完成，不为此再改资源或增加成熟度系统。组合根已有 PlanTaskPort 转发可直接消费，本批测试只使用真实平台；如需入口接线，另由主审拥有 create-platform 写权。`check.py` 的新专项注册和既有文档更新归主审，不在本 scope。

## 8. 少量有区分力的风险测试

1. **初始仅意图、持久可见。** 真实 createGoal→propose/apply 只有 required plan_only、无 assignment/gate/obligation/依赖→SQLite 重开 queryTaskGraph 仍有节点，Goal 解释包含该 task 与验收/gate 缺口；ready 默认不返回、includeBlocked 给原因、直接 claim 零副作用。给 plan_only 加合法 assignment 仍不能领取。
2. **同节点逐步细化。** 真实 source.assignments=[]；给原 Task 首次分配并保持 plan_only 不激活；省略字段拒绝；显式 request_execution+具体调查指令采用并可正式 claim，即使无验收。图仍解释未完成与待定义验收；没有满意度/完成假状态。同次新增显式 request_execution 节点也可首次声明 source 未出现的 role；真实 claim 再核该角色配置，已有非空 assignment 不可改派。旧完整 v1/v2 无字段用例保持成功，完全未标字段的空 Plan/optional-only 旧非法形状仍被拒绝；v1 带新字段拒绝。
3. **未来验收补充与保护。** 新增 obligation/gate 到仍未领取的节点可成功；旧义务的标题/强度/验证项被削弱、旧 gate 被改、为已运行节点追溯附新义务均拒绝。取消/拆分不得丢原义务唯一承担覆盖。政策例复用既有可信治理夹具，通过公开 Plan writer 采用源 Plan，再分别提交满足/不满足其 kind、最低要求的新义务；只读记录实际读取键，确认新增验收按 source 的精确 pin 读取并继承该 pin。现工程没有公开 CompletionPolicy 激活 writer，不把政策切换、raw 改 active 指针或正文损坏作为本批测试前置；仅检查新增 pinned reader 不依赖另一 active 指针，原既有候选诊断读取不混算为本次新增读取。只测本批新允许/拒绝组合，不复制 W1 全矩阵或制造政策正文损坏。
4. **局部并发和历史。** 使用已经是 request_execution、带合法 assignment、仍未领取的源节点，让其未来定义细化与首次 claim 在真实局部 CAS 处竞争，只一个成功；不能拿本来不可 claim 的 plan_only 节点来证明双合法操作竞争。plan_only 直接 claim 的 incomplete/零副作用由第 1 项单独覆盖；运行 A 与编辑未来 B 可共存。未改 A 的 basis/Run/原历史保持，B 原意图旧 Plan 可读。相同请求重放返回原回执，不再次激活/创建 Run。
5. **真实消费者。** 至少一条使用 createTargetPlatform 的上述链；同一批两个测试文件内，经真实 whiteboard factory→正式 PlanTaskPort 提交带 executionIntent 的 v2 future draft，采用后查询仍保留字段和诊断，不用 mock port 成功替代。Goal 图解释不漏无义务/无 Run 的 required 节点；正式 Run 结束也不自动满足 Task。断言 policy/结构错误不能因放开计划而被吞掉；读诊断不调用模型/打开材料/增加政策读取，不用 raw satisfied 或正文损坏注入。无需重复 RecordStore/Kernel 全矩阵。

中审必须区分：fixture 是否真正建成、红点是否新 unsupported 入口、后续行为是否真的执行到。实现后检查新专项、W1/R3c Plan/TaskGraph/Claim 及依赖 W2 工具消费者，再由主审完成物理隔离验收。此批成功只表示基础意图与逐步细化的正式数据路径可用，不关闭 Workflow 自动生成/推进、完整授权验收修改、R3e 完成归约或 Host/UI 产品路径。

## 主审本次骨架派发

前置B2/C1/M1/M2/W2及组合根已合入并通过94文件/948项物理隔离验收。本次正式派发**第一阶段**，仅做新增签名/DTO、明确unsupported的新增行为接点与真实目标测试，交付后停止等待Astra中审，不实现业务算法/完整接线。严格按 `W2-future-intent-skeleton-scope.json` 精确写范围，所有新文件已经预建；使用当前工作树快照。原有路径保持，禁止改其他批次测试、原工程或vendor。只原地写获准文件，不做会越scope的同级临时文件/rename；不读取或修改全局DSH配置、不输出凭据。

先读本文、CODE-QUALITY-GUIDELINES、DSH-WORKFLOW及DSH-EXECUTION-HARNESS。专项检查 `python3 tools/dsh-refactor/check.py next-future-intent`，`next-types`单独跑；仅本批风险的既有检查作回归，不跑全仓通用矩阵。快照中并行批次尚空的测试文件属于其它owner，不能修改或据此判定本批失败。明确报告真实夹具前置、首次红点与未执行到的后续断言，不能catch失败后return冒充成功。只有公开输入/合法生命周期可达行为才作为新增门槛，不制造运行中角色切换或直接内部篡改反例。

## 9. Astra 中审返修要求（2026-09-26，Stage 1）

中审对象为 `w2-future-intent-skeleton-20260926` 的已停止交付。独立 `next-types` 通过，`next-future-intent` 为 **4 passed / 4 failed**；当前骨架和测试**不予冻结**。三个失败到达 initial/future apply 的 unsupported，另一个失败仅为 raw-seeded Plan 查询缺少诊断字段。这个结果不能证明已覆盖逐步细化、政策应用或真实 claim/CAS。

### 9.1 恢复骨架边界，保留原行为

- 保留新 DTO/字段/reason code、获准的 codec shape 和工具说明。`plan-validation.ts`/`plan-service.ts` 可保留识别新 executionIntent 后的明确 unsupported 接点，不能在 Stage 1 完成业务算法。
- 撤回 `eligibility.ts` 新增的 plan_only/assignment 业务判据及 `claim-service.ts` 已实施的判断顺序/业务拒绝。原 legacy 路径保持原实现；新显式意图的可达写入口停在明确 unsupported，后续资格、claim 与诊断只由目标测试规定，不借 raw accepted Plan 预先实现。`TaskEligibility` 原返回类型不支持 CoreRejection，不为骨架伪造新 union、假 eligible 或假 busy；采用入口的 unsupported 已能形成真实停止点。
- `readPinnedCompletionPolicy` 只保留本次最小签名/结果类型，函数体返回 `rejected/unsupported`；撤回已完成的精读/digest/guards 算法，等待测试冻结后实施。future apply 的共享接缝仍按 §5 设计，不建立新层。
- 删除为迎合旧 `R3c-task-graph` 局部 fixture 而新增的 `declaresAssignments` 豁免。正式规则是同一 `revisionAssignments` 判断，不以“字段未声明”制造可领取特例。旧 partial fixture 与完整正式 Plan 的语义争议交主审，在第二阶段前按实际语义最小刷新；DSH 不改旧测试或更改生产规则以使其绿。

### 9.2 替换坏夹具与永不可能变绿的断言

- 删除同一测试同时要求 `unsupported` 和 `committed` 的断言，以及永久要求 `unsupported_execution_change` issue 的成功用例。冻结测试只断言最终目标行为；Stage 1 的首次 unsupported 红因写在报告中，不写成必须长期成立的测试期望。成功前置用硬断言，失败即明确停止；不以条件分支或 catch/return 跳过后续验收并当作通过。
- 当前 work-graph 初始正例同时含未分配的 `request_execution`，按契约应 incomplete，不能要求采用成功。初始成功草案仅含合法 plan_only；缺分配的显式执行请求作为同流程的一次拒绝断言即可，不扩拒绝矩阵。
- 删除 `seedIntentPlan` 及其 raw Goal/accepted Plan 提交。它不仅绕过真实采用，还继承了指向已删除任务的旧义务，不能作为图/ready/claim 的生产事实。新的初始/未来 Plan、assignment、义务均由真实 propose/apply 产生；可信 Project/Workspace/治理 fixture 按原约定复用。
- future target 从真实 source draft 字段复制并保留原 tasks、assignments、obligations、关系、输入及必要协议，再做此次局部修改。不得用 `draftV2`/`intentDraft` 的空 obligations 或仅一个新 task 覆盖旧定义；当前 future refinement 与 factory 用例都需修正。
- factory 用例不能只证明候选保存了新字段、仍带 unsupported issue 就结束。沿真实 factory→PlanTaskPort propose/apply/query 证明 executionIntent 与诊断保留；不 mock port 成功。若上下文为 Host，明确其只证明 adapter 透传，不能报告为已验证 Agent 委托；Agent 委托复用已验收的 W2 真实 fixture/身份，不伪造 entered 事实。

### 9.3 两文件内的最小真实行为链

仍只使用已冻结的两个新增测试文件；修正并补齐以下独有场景，不新增正文损坏、政策切换或全量权限矩阵。

1. **初始保存与同节点细化。** 真实 createGoal→仅 required plan_only 的初始 propose/apply→SQLite 重开后图中仍有该节点；无 assignment/验收/gate 不妨碍保存。图包含该 required 节点未完成及缺验收解释，ready 默认隐藏、includeBlocked 给原因，直接 claim incomplete 且零提交。首次补合法 assignment 后仍保持 plan_only、仍不可 claim；省略原显式字段拒绝；显式 request_execution 后，即使还无 acceptance，也能经真实 Session/Role 前置完成正式首次 claim。不得把 Run/claim 成功解释成 Task 完成。
2. **合法 future 扩展及政策应用。** 保留源 Plan 已有任务/义务，新增或细化一个尚未领取节点；覆盖 source.assignments=[] 的首次分配，并在同流程确认同次新增显式节点可首次声明角色。另一尚未领取节点通过真实 apply 追加 obligation/gate，满足源 pin 的 kind/最低要求成功，不满足时拒绝。记录实际调用读取键，证明源精确政策 pin 参与此新增验收读取与局部 guards；不能用仅直接调用 pinned reader 的测试替代 apply 消费者。未新增义务的普通查询/细化不因本批增加政策读取。既有义务不得被删除/弱化；只保留一组有区分力的正反例。
3. **可达的局部竞争。** 用已正式采用的 request_execution、合法 assignment、仍未领取的节点，对其未来执行定义细化与首次 claim 设置真实提交屏障，使两方在读完各自合法前置后竞争同一局部事实；只一方提交，另一方 revision_conflict，赢家事实和无关运行节点历史保留。不能用不可 claim 的 plan_only 节点充当双合法竞争，也不能因骨架尚 unsupported 就把该目标测试留到实施阶段才写。Stage 1 可以红在它前面的真实采用接点，报告后段尚未执行即可。
4. **兼容与实际消费者。** 原完整 v1/v2 无字段正例保持，完全未标字段的空/optional-only 旧非法形状仍拒绝；codec 覆盖 v1/gate/非法 enum 的现有少量 shape 例即可。至少一条上述链经 createTargetPlatform；factory 对合法 future draft 完成 propose/apply/query，避免重复另建图/材料/内核服务。

### 9.4 预期红点与停止要求

骨架检查仍只运行类型、新专项及必要旧回归。真实旧基础 fixture、可信治理、Goal/Session/完整 legacy Plan 应先成功；初始纯意图、未来意图采用及首次细化目标在新 apply unsupported 接点红，后续图/claim/政策/CAS/factory apply 断言可尚未执行，但必须已经写成最终可通过的目标测试并逐项报告可达深度。codec/类型/旧路径绿是允许的；不能凭 raw seed、提前实现或固定 unsupported 的“成功断言”制造新功能绿。

返修仍是 **Stage 1 骨架与测试**，不得开始实现资格、细化、政策读取、规划诊断或完整消费者业务。完成后立即停止，报告实际 check 结果、每个首次红因、尚未运行到的后段及 12 个 scope 文件哈希；等待 Astra 再中审冻结后才派第二阶段。主审持有旧 partial fixture、组合根及 check selector 的写权，遇真实共享前置缺口先给出精确位置，不越界修生产或旧测试。


### 9.5 主审明确 future apply 的政策读取精简

future apply 现有 `tryPolicyContent` 会重新读项目当前默认政策，并未固定源 Plan 的采用依据。本批替换这一读取：只有新增 obligationId 时读 source.effectiveCompletionPolicy 精确 pin 并合入 guards；未新增义务时只做结构与既有义务保护，不重读政策。propose 阶段原机会性政策诊断保留。测试读取观察从 propose 完成后开始，仅覆盖 apply，因此不能把原候选诊断读取混算为新的硬门槛。此调整既去掉不必要读取，也避免当前默认政策影响既有 Plan 的正式承诺。

原 R3c-task-graph 的纯资格测试已由主审补齐三个合法assignment，保留两条前驱非门禁断言且已通过；第二阶段快照必须携带该修正，不恢复declaresAssignments豁免。
