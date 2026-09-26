# W1：未来任务白板修订的骨架与测试

状态：2026-09-25 **本任务已完成骨架中审、DSH 实现、独立返修与物理隔离验收。** 见 [B1/W1 报告](../reviews/next-b1-w1-2026-09-25.md)。只关闭 Host future-only 修订及读侧状态保留，不关闭完整 R3c 或 Workflow。下文保留当时 Stage 1 的分工和冻结要求用于审阅，不能按旧阶段重新派发，也不能跳过下一批的骨架中审。

下文 §2–6 定义目标和不变量；当时 Stage 1 仅授权类型、函数签名、职责注释和明确 unsupported 接点，之后经中审才进入实现。精确原文件白名单见 [W1 Stage 1 scope](W1-future-plan-skeleton-scope.json)，实现与主审修正见 [实现任务](W1-future-plan-implementation.md)、[返修要求](W1-future-plan-review-fixes.md)。

## 1. 阅读依据与交付目标

按以下顺序定点阅读，不新建另一套产品或架构文档：

1. [PRODUCT §3](../../PRODUCT.md)：任务图是可编辑白板、监测和历史索引，预期依赖不自动变成启动闸门。
2. [原话 DLG-037](../intent/ORIGINAL-DIALOGUE.md#dlg-037-用户)、[编号原话 01/12/14](../../agent-platform-user-replies-numbered.md)：Session 承载工作；复用角色/Context、图和原子能力；不要求本批交付完整知识库。
3. [WorkGraph §5.1](../modules/core/work-graph.md#51-w1未来任务白板的窄修订已验收2026-09-25)、[Workflow](../modules/business/workflow.md)：领域变更与业务推进分开。
4. [能力索引](../IMPLEMENTED-CAPABILITIES.md) WG Plan/Claim 条目，再读下文准确源码。

目标行为：A 正在执行、C 已有正式完成事实时，用户可以在相同 Goal 修改未来 B，或在既有授权与验收义务内新增/拆分未来工作；采用后新计划展示 A/C 的真实状态和 B 的新定义。A/C 的 Run、Reduction、Session、历史和材料不被改写，不要求停止无关执行。旧 Plan 可显式查询；同请求重放返回原采用结果。

## 2. 已有实现与本批缺口

代码根 `T = /home/hyh001/projects/coding-platform/coding-platform/next`。旧 `coding-platform/src` 仅只读参考。

| 已有能力 | 直接复用位置 | W1 增量 |
| --- | --- | --- |
| propose/read/apply/queryGoal/queryTaskGraph/queryReadyTasks | `src/core/work-graph/tasks/plan-contracts.ts`、`plan-service.ts` | 保留公开方法与外层形状；补 basedOn 非空且 source 为 active 的窄采用分支 |
| 候选 v2、不可变 Plan、采用事件和原回执恢复 | `plan-record-codecs.ts`、`plan-commit-compiler.ts` | 新版本化 basis 字段；纯 future-change fold；原事件保存完整新快照供重放 |
| 结构、指派、义务、层级与关系校验 | `plan-validation.ts`、`task-index.ts` | 从 source/draft 得到差异，约束 future-only 和验收覆盖，禁止 caller 填进度 |
| Run-by-task、Lease、Reduction、精确记录与状态投影 | `plan-readers.ts` | 受改任务的定向事实；跨 Plan basis 解析；不把旧结果误读为 pending |
| Task 首次领取与 Session 占用 | `claim-service.ts` | 只读验证原子竞争协议；本批不改领取、B1 或 Kernel |
| Store 局部 record CAS / 幂等 / lookup | `src/core/record-store/ports.ts`、`lookup-ports.ts` | 不扩 Store，不用其仍为空元组的 indexGuards/indexChanges，不新增表 |

施工前 `applyPlanChange` 对 basedOn 非空返回 incomplete/unsupported；W1 已实现 active source + v2 候选的 Host future-only 分支，超出此范围仍明确拒绝。`Workflow.advanceWork` 仍为 never/unsupported，不代表 Agent 已能操作白板、自动推进或实际执行。

## 3. 保持现有公开接口，收窄采用含义

继续调用：

```text
proposePlan({ goalRef, basedOn: activePlanRef, draft, reason }, meta)
→ readPlanProposal / 用户检查候选
→ applyPlanChange({ proposalRef, expectedProposalRevision, decisionRefs }, meta)
```

不新建 FutureTaskManager、白板数据库、平行 TaskPort 或只转发的服务。候选仍是完整 draft，**采用结果由 source + 校验过的差异确定性构造**，不得直接把 caller draft 当正式记录覆盖旧任务。新 planId 必须是未使用引用，planRevision 必须恰为 source.planRevision+1；source 必须仍是 Goal.activePlanRevision。陈旧源返回 revision_conflict，不自行 rebase 后采用。

W1 新候选使用 schemaVersion=2；source 可以是已有 v1 或 v2，升级时保留其原任务/验收含义。v1 的标签型 executionDag 仍是 legacy_unverifiable，不能在升级时虚构成已验证的具体输入。W1 不引入或更换 model_coordination origin；角色模型规划输出的真实来源绑定另批交付。

沿用本批现有 Host-only 写边界。已授权的 future-only 编辑不因为历史分支要求 `UserDecision` 就强制另造一轮审批：通过机械差异校验后，本窄分支接受空 decisionRefs；非空 decisionRefs 不被当作万能授权，对 W1 明确 unsupported。改变目标、治理、验收语义、角色或预算授权继续走未迁的完整变更协议，不靠此分支绕过。Host 自身必须来自真实调用上下文；模型工具不准伪装为 host/system。Agent 委托接线另批。

候选可保留结构 issues；apply 必须零写拒绝无效或越界候选。首次计划采用的既有语义不改。旧 legacy_v1 proposal 仍只读兼容，不借 W1 顺手迁完。

## 4. future-only 差异与覆盖规则

future 的含义是**精确事实证实从未领取/执行且没有正式归约**，不是 UI 显示 pending，也不是查询没接 provider。对受改/新增 taskId 定向读 Run、TaskLease、TaskReduction；任一已存在执行痕迹即不可作为可改未来任务。unknown、损坏、不可读分别沿现有 typed failure 返回，不能默认 absent。

**差异集合按执行定义计算。** `RuntimeTask` 自身字段、该 task 的 assignment、inputRequirements 和所承担的义务语义属于定义差异，进入 future-only 检查与 basis 变更集合。`taskRelations` 和只用于展示的 `taskHierarchy.parentOf` 不进入这个集合：纯提示边/展示层级可以连接正在运行的 A，修改这种关系不要求 A 从未执行，也不重置其 basis。比较某 task 的义务语义时，保留其义务身份/内容/强度及自身承担关系，但排除其他 taskIds 成员的变化；为未来 B 添加替代承担者不能误判为 A 的执行定义变化。全局结构和原义务覆盖仍由相应校验负责。

| 候选变化 | 本批处理 |
| --- | --- |
| 未领取任务的标题/指令、精确输入 | 在既有授权范围内允许；闭合执行定义受影响 task 集，不对其他任务做语义安全证明 |
| taskRelations 提示关系、展示 parentOf | 允许关联运行中任务；只做相应结构校验，不进入 future-only/basis 变更集合 |
| 已领取/执行/归约任务 | 定义全部字段、assignment、inputs、所承担义务及其验收语义保持不变；禁止把 phase 填成 running/satisfied 等伪造进度 |
| 未来任务延后/取消 | 用 disposition 记录，保留原 taskId 与历史，不物理删除；取消不能留下无人承担的验收义务 |
| 已授权新增/拆分 | 新 taskId 不得与 source 中任何任务（含 cancelled/superseded）重用；新增 work 必有且只有一条 assignment，新任务 phase=pending；使用已有角色配置，保留 required 覆盖；被拆未来任务保留取消/取代记录 |
| 现有任务角色重分配，新增角色/Skill 配置，工具/预算授权扩大 | unsupported；不由白板操作产生新许可或编造预算值 |
| Goal objective、governance pins、义务正文/要求强度/verificationRequirements 变化 | unsupported；不得默默削弱验收或自动重置旧证据 |
| gate 的新增、删除、角色化或验收关系变化 | 本窄切片 unsupported；保留 source gate，避免把 gate 变成普通执行任务 |

source obligations 的 obligationId、title、requirementLevel、verificationRequirements 逐项保留；仅为未来工作增删/拆分确定性调整 taskIds。已有执行任务的义务集合不变。每项原义务仍有有效承担者；原 required 承担关系不能只剩 optional/cancelled。取消唯一承担者必须在同一变更指定能承担原义务的 active replacement。先执行已有 `validatePlanDraft/validatePlanAssignments`，再检查 source→target 覆盖；“目标仍有一个 required task”不等于每项原义务都保留。

预算不是现有 RuntimeTask 的字段。W1 不引入 per-task budget 字段、默认数字或修改 Goal/Role 预算授权；新增任务以后 claim 必须给出现行许可范围内的真实预算。未来新增/拆分能安全采用的前提是它只调整已授权工作与承担映射；若既有要求需要表达新的验收或预算授权，本轮保存候选并返回明确 unsupported，不伪造正式许可。本任务不承诺自动执行这些新增任务。

## 5. 最小跨版字段：taskStateBasis

只对 accepted schemaVersion=2 Plan 新增可选、内部版本化字段；Draft/Proposal 输入不得携带或控制它：

```ts
type TaskStateBasisV1 = {
  schemaVersion: 1;
  entries: { taskId: string; planRef: PlanRevisionRef }[];
};
// PlanRevisionSnapshot 的 v2 分支：taskStateBasis?: TaskStateBasisV1
```

含义：这个任务当前执行定义的来源 Plan。无字段的旧 Plan 等价于各 task 指向自身；不修改旧数据、不改旧 schemaId `PlanRevisionSnapshot@1`。W1 输出完整 entries，严格唯一、覆盖每个 taskId、稳定排序、同项目；无未知版本降级或跨 Goal fallback。

compiler 规则：

1. 未改任务继承 source 的有效 basis，不根据本次是否看见 Run 来决定；这样未改 A 在读取后新领取也不会失去关联。
2. 通过 future-only 校验的修改任务、新任务指向 target Plan 自身。
3. basis 指向定义来源的绝对 PlanRef，不形成需要逐级遍历的链；旧 source 无字段则来源为 source 本身。
4. 候选自带 taskStateBasis、伪造目标 basis、缺失条目或重复 taskId 均在采用前拒绝；不能用 spread draft 携带 caller 字段。

reader 不再仅用 `run.planRef === selectedPlan.ref` 判断继承。对同一 Goal/task 的实际 Run/Reduction，读取它所引用的不可变 origin Plan，比较该 task 在 origin 与 selected 的有效 basis；相同且 origin.planRevision <= selected.planRevision 才可用于 selected 的当前状态。严格 source=active 且 target revision=source+1 的接受规则保证同 Goal 的 W1 采用线性；不允许同内容 revision 的并行正式分支。旧 v1/v2 未带 basis 的历史读取保留原定义语义，不推测不存在的谱系。

必要 origin Plan 按不同完整 ref 批量读取，复用只读窗口和 codec；不逐 task 重读同一 Plan，也不扫 Session/事件。除键/Goal/版本外，核对同 basis 对应任务的冻结执行定义、assignment、inputs 与验收语义一致；遇到损坏返回 unavailable。Run/Reduction 保持原 planRef/planRevision/来源，不复制“继承后的”新 Run 或 Reduction。

显式 `queryTaskGraph({goalRef, planRef: old})` 返回 old 定义；不得吸入后来 Plan 才领取的 Run，也不能因为 Goal.activePlan 已变化而隐藏旧图。这里不是新增按墙钟时间冻结所有状态的 time-travel API：同一旧 Run 后来产生的事实仍按已有正式读语义呈现。

`TaskLease` 是按 Task 而非 Plan 存储，历史过滤不能只处理 Run。只有 selected Plan 根据上述 basis/版本规则接受的 holderRun，才能投影为该 Plan 的租约、runId 或 leased 原因；P2 新 Run 的全局 Lease 不得泄漏到 P1 的行或 eligibility reason。该 Lease **不适用于历史图**不等于当前真实资源 free；历史图只是读取结果，`queryReadyTasks` 与 `claimTask` 仍必须核对 active Plan，不能从旧图产生新执行许可。复用 `plan-readers.ts` 与 `eligibility.ts` 现有投影含义，在 reader 收窄输入，不另造历史 Lease 表。

## 6. 局部 CAS 与领取竞争

Store 当前没有可用 indexGuards；不要为 W1 扩 Store 或用全局 ledgerHorizon 代替本设计。

纯差异先决定受改 task 集。读当前 Goal/source/proposal；对受改任务通过现有 RUN_BY_TASK 定向查询，加精确 Lease/Reduction 读取。新任务也检查同完整 TaskTriple 的遗留事实。接受时 guard：

- Goal 当前 revision 与 active source；proposal exact revision；target Plan 不存在。
- source 的不可变记录及必要 scope 记录。
- 每个受改/新增任务的 TaskLease 和 TaskReduction 确证缺失。

一个 commit 写 target Plan、Goal.activePlanRevision/revision、accepted proposal 和现有 PlanRevisionAccepted event；不写 Run、Reduction、Session、Workspace 或 governance active pointers。不提交 ledgerHorizon；A 的无关历史追加不使编辑 B 失败。

W1 的受改任务读取也不能要求每次 lookup/readMany 的**全账本** readThrough 相等；复用已有定向索引、codec 和局部 record 版本，以末次 commit 的上述条件封闭竞争。读取期间如本 Task 已留下 Run/Lease/Reduction 就明确拒绝；不存在判定由正式 Claim 必写的精确 Lease guard 支撑。不要原样调用带全局水位重试的完整 readCanonicalTaskFacts 来证明未来 B 可编辑，然后把其他任务的持续事件误报成 B 的冲突。当前图查询原有一致读策略不在 W1 顺手重做。

竞争证明：正式 `claimTask` 原本同时 guard Goal revision、创建 TaskLease。若 claim(B) 先提交，W1 的 Lease 缺失 guard 失败；若 W1 先提交，旧 Plan claim 的 Goal guard 失败。新调用重新查询当前计划即可，不能拿旧请求重放结果授予新启动许可。两个不同计划修订竞争同 Goal 指针是必要 CAS，不是全工作区/全账本锁。

这个证明依赖已有 writer 不变量：首次 Claim 必须原子写 Lease，首次领取痕迹不能物理删除后变回“从未领取”。当前 Claim 仅创建 Lease@1，尚无 release writer；后续释放必须保留 versioned released/tombstone 或等价既有事实标记，防止 absent→claimed→absent ABA。B1 不在本任务写范围。若真实代码出现能绕开或删除痕迹的 writer，向主审报告具体来源与最小修正，不能假装无冲突或偷偷恢复全局水位门槛。

候选记录不推进 active Plan。W1 候选写入也只依赖精确 scope/Goal/proposal guards；可选 policy read 只生成可重新检查的 issues，不作为最终采用授权。初始计划采用的既有逻辑不在本轮顺带大改。

**同身份并发重放有实际接缝。** 当前 `applyPlanChange` 在 lookup miss 后读取 proposal/Goal；若同 identity 的 peer 此时先提交，本次会看到 accepted proposal 或已推进 Goal，被普通校验错报 invalid/revision_conflict。W1 复用 A1 已有处理模式：post-lookup 的拒绝返回前，对同 identity 精确回查一次 receipt/fingerprint；已提交且正文指纹相同就恢复原结果，不同正文明确幂等冲突，仍无 receipt 才返回原拒绝。一次精确回查不变成无限重试、自动重新采用或新 Manager，不能用读取当前 Plan 替代原 receipt。测试控制 lookup miss 与 peer commit 的时序，不只做顺序 replay。

## 7. 文件范围、骨架职责与复用

以下 7 个生产文件和 2 个测试文件是 Stage 1 的完整写范围；路径相对 T。表内职责描述最终实现归属，Stage 1 只给出这些职责的可编译骨架，不填业务。已预创建唯一新增 helper 和两个测试占位，供隔离 harness 绑定；占位不代表骨架或测试已经交付。

| 路径（相对 T） | 唯一职责 |
| --- | --- |
| `src/contracts/plan.ts` | accepted v2 的 `TaskStateBasisV1` 可选字段；保留 v1/v2 原结构，Draft 不加此字段 |
| `src/core/work-graph/tasks/plan-validation.ts` | 纯 source/draft 差异、未来任务集合及义务覆盖校验；不读 Store、不查模型 |
| `src/core/work-graph/tasks/plan-task-basis.ts`（唯一新增生产文件） | 纯有效 basis 解析/生成与一致性比较，共享给 compiler/reader；不拥有状态或 Port |
| `src/core/work-graph/tasks/plan-record-codecs.ts` | 窄版本校验、拒绝 caller basis、accepted/event 编解码；不嵌业务查询 |
| `src/core/work-graph/tasks/plan-readers.ts` | 受改 Task 精确事实；按批次读取 origin Plan、统一当前/历史状态解释 |
| `src/core/work-graph/tasks/plan-commit-compiler.ts` | `compileFuturePlanAdoption`：source+验证差异→新快照/原事件/局部 guards；不改原初始 fold |
| `src/core/work-graph/tasks/plan-service.ts` | Host/幂等/source绑定→reader→validator→compiler→一次commit；共享原 replay |
| `tests/work-graph/W1-future-plan.test.ts`（新增） | 下节行为验收；复用已有 fixture helpers，不复制全套历史测试 |
| `tests/composition/W1-future-plan-platform.test.ts`（新增） | 一条真实 SQLite public composition 路径及重启/历史读取；不重复所有内存断言 |

现有公开方法不变，`plan-contracts.ts` 不新增平行 Port。组合根已注入 plans；测试应直接用它，默认无需改 composition。若 codec/fixture 类型引入真实编译必需的相邻修改，先报告主审再冻结范围，不扩大至 B1 Runtime、Kernel、Workflow、Store backend、旧源码或配置依赖。

旧 `src/control/control-engine/policies/goal-change-consistency.ts` 的 `checkTaskSetDelta/deriveTaskAssignments/deriveTaskSet/deriveObligationSet` 可只读参考和提取适用纯规则；不搬旧 Control/AgentInstance/WorkContext 服务，也不照搬整项前驱完成门槛。已有 `task-index.ts` 的 plan-local 图算法、Store replay 和 directed Task read 必须复用。

### 7.1 Stage 1 的生产改动限制

- `TaskStateBasisV1` 可以先落类型；纯 helper 可以先落参数/结果类型及显式 unsupported stub。不实现 basis 生成、继承、定义比较或“默认成功”的空结果。Draft 不新增 caller 可写的 basis 字段。
- reader、validator、compiler 只增加必要的内部签名、职责注释与明确 unsupported 接点；当前初始采用、读取、重放、claim 语义保留。不为新测试提前实现跨 Plan 查询、差异 fold、局部 CAS 或业务校验。
- service 最多辨认本批新 v2 修订并接到明确 unsupported 分支；不得采用候选、写新 Plan 或提前绕过既有授权。旧 v1 修订继续拒绝，初始采用继续沿原实现。
- accepted codec 对新 basis 的完整校验属于实现阶段；骨架中不得静默丢弃不认识的新字段再当旧记录成功解码。如新增类型必须触及 decoder，只允许明确拒绝未实现形状，不能假造有效 basis。
- 不改旧测试、fixture、Store/Kernel、组合根或配置。`tests/work-graph/R3c-plan-adoption.test.ts` 的 `validDraft()` 明确返回 schemaVersion=1；`changedDraft` 仅覆盖 planId/planRevision，仍是 v1，其非初始采用拒绝断言与 W1 v2 窄分支没有冲突。
- 若出现范围内无法解决的真实类型/协议冲突，报告准确符号、调用链和最小需要的修改，不通过扩大 scope、修改旧测试或实现业务绕过中审。

## 8. 最少验收场景与中间审核

用一个可复用 fixture 覆盖下表，每类验证不同不变量；不逐字段复制大量镜像测试，不用新增测试数量代替行为证明。Memory 覆盖纯领域分支；真实 SQLite 重点验证原子竞争、重启和 public composition，必要时参数化，不把整套用例机械翻倍。

| 场景 | 必须断言 |
| --- | --- |
| 1. A 运行时编辑未来 B | A 全部执行定义/assignment/inputs/basis、Run/Lease/Session 字节不变；B 新定义生效；新增连接 A 的提示边/展示 parentOf 可采用且不重置 A basis，调整 B 的义务承担者不误判 A 已改变；A 同时追加无关历史不会导致 W1 全局冲突；ready 不把 A 当新任务 |
| 2. 历史完成 C 保留 | 新 Plan 仍显示 C 的原正式归约与执行引用，不回 pending，不复制/改写 Reduction；篡改 C 定义或输入被零写拒绝 |
| 3. 编辑 B 与 claim(B) 竞争 | 分别控制两种提交顺序；只有一方按旧 source成功，另一方返回具体版本冲突；没有孤立 Run/Plan/占用，不扩到全工作区锁 |
| 4. 旧 source / 旧 proposal | source 不再 active 或 proposal revision 不符时零写拒绝；不得自动重算并采用用户未审候选 |
| 5. 同身份重放 | 原请求在后续又一次计划变更、重启后仍返回原采用快照/receipt；控制本次 lookup miss 后 peer 同 identity 提交，使本次读到 accepted proposal/新 Goal，仍经一次精确 receipt 回查返回原结果；同 requestId 不同正文冲突，不回放最新 Plan、不无限重试 |
| 6. 历史图显式查询 | 指定旧 Plan 可读原定义/原事实，排除后续 Plan 新领取的 Run 及其全局 TaskLease 的 runId/leased 原因；历史图不适用的 Lease 不提供当前 free/claim 许可；ready/claim 仍检查 active Plan；当前图继承未改 task 的 basis；旧 v1/v2 无字段仍可读 |
| 7. 新增/拆分与验收覆盖 | 已授权未来工作可新增/拆分并保留原义务；取消唯一承担者、仅 optional 替代 required、改验收正文、引入角色/预算授权均零写拒绝 |
| 8. codec 与跨版关联损坏 | caller basis、重复/缺项、跨 Goal、未知版本、相同 basis 但定义不符明确拒绝；不是默认空集/pending |

同场景可以包含多个必要断言，不要求为每条拒绝消息单独建测试。用于 C 的正式 Reduction 可由受信 fixture 建立：本批不假装已完成结果归约 writer；测试报告必须区分该读侧 fixture 与真实 public Plan/Claim 调用。

中间主审查看类型可编译、明确 unsupported 骨架、失败测试对应真实缺口、局部 CAS 证明、历史继承和复用位置，再给 DSH 极窄实现 scope。骨架阶段不得填业务实现让测试提前变绿；没有经主审冻结不得开始实现。

### 8.1 Stage 1 检查与交付

将两个 `export {}` 测试占位替换为上表所需行为测试。W1 新行为测试可以因明确 unsupported 而红，不能因错误导入、类型错误、缺 fixture 或测试文件为空而红；不使用 skip/todo 或只断言 unsupported 来伪装已覆盖目标。测试尽量走既有 public Plan/Claim 入口，受信 fixture 的限制见上文。

使用既有工具链，在 T 运行：

```sh
source /home/hyh001/projects/coding-platform/.toolchain/env.sh
cd /home/hyh001/projects/coding-platform/coding-platform/next
node ../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node ../node_modules/vitest/vitest.mjs run tests/work-graph/W1-future-plan.test.ts tests/composition/W1-future-plan-platform.test.ts --maxWorkers=1 --no-cache --configLoader=native
node ../node_modules/vitest/vitest.mjs run tests/work-graph/R3c-plan-adoption.test.ts --maxWorkers=1 --no-cache --configLoader=native
```

类型检查与既有 R3c 回归应通过；逐项报告 W1 红测对应的未实现能力和实际结果，然后停止等待中审。报告至少包含“需求 → 复用符号 → 新接点 → 对应测试”，不以测试总数代替覆盖。只在 scope 文件中原地修改，禁止 rename 替换、安装依赖、提交、额外模型和测试临时目录以外的额外写入。相邻模块与全仓均可只读查阅。

实现阶段完成后再运行相关 W1/R3c/Claim 回归、typecheck、边界和 build，由主审执行物理隔离验收。没有实际运行前不填写 PASS 数量。最终声明只限未来白板 Host 接线；Agent 角色工具、Workflow 自动推进、Kernel 执行/释放、UI、记忆/知识库均单独跟踪。
