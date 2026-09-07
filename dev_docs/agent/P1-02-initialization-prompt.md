# P1-02 初始化执行提示词（供另一个 session 使用）

> 用法：在**新会话**中粘贴下方 prompt 全文；该 session 充当 P1-02 的编排＋集成者。
> 依据：开发文档（`dev_docs/planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md`、`dev_docs/interfaces/completion-policy.md`、`dev_docs/planning/proposed/P1-foundation/DAG.md`）与产品代码根现状（P1-01 verified：SQLite Ledger/View Adapter + 持久化 harness，158 tests 全绿）。
> 生成日期：2026-09-05。

---

```text
你是 Agent Platform 的开发集成者，负责组织多个实现 Agent 并行编码，并亲自完成集成验收。你没有此前对话，请以本地文档为依据。

## 目录与授权

文档根：
/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform

产品代码根：
/home/han001/projects/agents/agent_platform

执行内核：
/home/han001/projects/agents/coding-agent

先核实实际路径及已有文件，保留现有改动（P1-00 与 P1-01 均已实现并验收，见产品代码根 IMPLEMENTATION-HANDOFF.md 与文档根 dev_docs/verification/p1-00-implementation-evidence.md、p1-01-implementation-evidence.md；共享契约套件与 InMemory+SQLite 双 Adapter、in-memory/persistent 双 harness 须复用，不得重写）。

本次明确授权开始 P1-02（PlanRevision accepted → Plan/Task View；completion-policy 与 architecture-baseline 首次消费）的并行实施。按项目流程记录本次有限授权；不把它记成整个 P1 已验收通过，也不自动推进 P1-03。

允许建立/修改产品工程、编写代码与测试，同步本票涉及的契约、验证记录和状态。执行内核默认只读。不部署、不推送、不做破坏性重置；需要扩大权限时询问。

## 第一阶段：你先准备共享基础

先读取：
1. 文档根 AGENTS.md（重点：P0-06 未结束时，按 AGENTS.md 要求核对 human-framework-role-review.md 对本票的影响并记录；完成边界：工作 Agent 不直接把 Ticket 标成完成）；
2. dev_docs/planning/proposed/P1-foundation/tickets/02-plan-revision-visible.md（本票，含 contracts_to_create 18 项与 Acceptance 19 项）；
3. dev_docs/planning/proposed/P1-foundation/DAG.md（相关边：01→02→03；Frontier 与 Exit gate 措辞）；
4. 本票直接引用的 Module 与 Interface：completion-policy.md（本票 guard 依据；status proposed、review_gate P0-06）、runtime-collaboration.md（本轮扩展依据）、state-ledger.md、read-model-index.md、command-event.md、goal-view.md，以及 modules/control/control-engine.md、modules/interaction/human-collaboration.md、modules/data/state-ledger.md、modules/data/read-model-index.md（注意各自的 P1-00/P1-01 扩展记录）；
5. 产品代码根现有基线：IMPLEMENTATION-HANDOFF.md、src/contracts/**、tests/contract-suite/**、src/control/**、src/interaction/**、src/ledger/**、src/sqlite-ledger/**、src/read-model/**、src/sqlite-read-model/**、src/harness/**、tests/integration/**。

然后直接实施准备工作，不停留在计划：
- 遵循现有工程配置（TS 6 + NodeNext + vitest，已冻结；SQLite 驱动 node:sqlite 选型延续；新增依赖只允许最小必要，且只能你本人安装并更新 lockfile）。
- 技术决策并记录（写入产品代码根 IMPLEMENTATION-HANDOFF.md“P1-02 契约与存储语义”，作为冻结语义清单）：
  - StateLedger/LedgerCommit 扩展方式：新增 commitKind（governance-install / governance-activate / plan-revision）还是新类型，随接口文档扩展记录（沿用 P1-00 先例，版本化记录、不改变既有 v1 语义）；
  - immutable governance revision 语义：content digest（JCS+SHA-256）、revision 不可覆写、ref 形式与解析（identity/revision/digest 三元匹配），沿 BootstrapManifest 先例；
  - activation 语义：只接受已安装的精确 target ref、以 expected Project revision 做 CAS；active ref 按 kind 独立持久化（CompletionPolicy 与 ArchitectureBaseline 各自独立；本票不要求或创建 ArchitectureEvolutionPolicy active ref）；install 不自动激活、fixture 不直写 canonical；
  - 缺省语义：fixture 缺失/无效拒绝安装且不用内置内容；没有默认 completion policy/architecture baseline；Plan 无法从 canonical active refs 解析完整匹配即零写入拒绝，不用内置 fallback；
  - PlanRevision 结构：Stage、Runtime Task（requirementLevel/taskKind/disposition/phase 四正交维度）、AcceptanceObligation、GateTask、TaskHierarchy（parent_of）、RuntimeExecutionDAG（depends_on，无环）、PlanRevisionSnapshot（固定精确 pin，含 effective CompletionPolicy/ArchitectureBaseline refs）、PlanValidationError；
  - guard 顺序：schema 校验→引用解析→全部非空约束（required executable Task、active required GoalGateTask、required AcceptanceObligation、Task↔obligation 映射、obligation→required VerificationRequirement）→环检测→原子提交；空集合、缺 GoalGateTask、悬空边、环、CAS 窗口变化一律零写入拒绝；
  - pin 不可变：Project default active ref 后续移动不改变既有 Plan pin；改变 pin 只能创建新 PlanRevision/PlanRebase；
  - View：PlanGraphView/TaskDetailView schema 与 freshness（沿用 opaque CommitCursor 语义；not_ready≠not_found）；
  - 重启等价：install/activation/applyPlan 全部经 SQLite 单事务；重启后 ref 解析、pin、Plan Graph/Task Detail、active revision 逐字段一致；
  - 边界：本票不派发 Task、不创建 Run/TaskAttempt、不产生 dispatch outbox、不做 Goal 归约；Stage 不自动生成依赖；completed 判定留给后续票。
- 建立/扩展代码结构（实现可未完成，导出签名冻结）：governance 契约与夹具入口、plan 契约与夹具入口、validation/错误模型扩展入口、Control 扩展入口（如 install/activate/plan-acceptance 各自独立文件，避免多 lane 冲突）、ReadModel 投影扩展入口（Plan/Task 视图）、持久化 harness 的 install/activate/applyPlan 扩展骨架、tests/restart 的 governance+plan 重启路径骨架、契约套件扩展（defineGovernanceContractSuite/definePlanContractSuite 或等价，参数化，每个 Adapter 都必须过）；
- 明确并固定：Governance/Plan 公共 schema、接口类型、共享 fixture 只由你维护；fixture 只能经 install contract 写入 canonical；install 不自动激活；activation 只接受精确 target ref+CAS；Plan 只接受从 canonical active refs 解析的精确 refs 并固定为 pin；Rejections 全部零写入；重复命令幂等；
- 给出可导入的接口与一致的测试替身；相关实现可以尚未完成，测试可以暂时失败，但不能宣称验收已通过。
- 记录本轮共享基线与精确引用（更新 IMPLEMENTATION-HANDOFF.md），再允许子 Agent 开始编码。

本票首次定义 Governance/Plan schema、guard 与 harness 扩展属于正常实施，不应当作缺少外部输入。若发现 completion-policy.md 或其它接口文档与票据 Acceptance 冲突：以票据 Acceptance 为准，把差异报告给你（你统一协调接口文档修订），不要在派发中复制另一套规范。

## 第二阶段：派发并行编码

你本人负责共享基础与最终集成，派发以下（建议）四路；具体目录由你按工程布局分配，写入范围必须互不重叠。若 Control 扩展与既有 src/control/control-engine.ts 冲突，在共享基础中已建独立入口文件后各 lane 写各自文件。

A: Governance install/activation（Control 面）
- 实现 install/activate 两个 command 的完全语义：local fixture→schema/digest 校验→install（immutable CompletionPolicyRevision/ArchitectureBaselineRevision 持久化、digest/revision 精确匹配、同一 identity/revision 不可覆写、重复命令幂等、重启后内容与 ref 仍可解析）→activate（只接受已安装精确 target ref、expected Project revision CAS；悬空/digest mismatch/竞争更新失败时 active ref 不动）；active ref 按 kind 独立；
- 不实现 Plan 接受；不自行改公共协议（缺口上报你，由你统一改基线并通知消费者）。

B: PlanRevision 接受（Control 面）
- 实现 ApplyPlanRevisionCommand：schema 校验→从 canonical Project active refs 解析 effective CompletionPolicy 与 ArchitectureBaseline（identity/revision/digest 完整匹配）→固定为不可变 pin→全部非空 guard（按 completion-policy.md 与票据）→TaskHierarchy（parent_of）与 RuntimeExecutionDAG（depends_on）结构与无环校验→原子接受 Stage/Runtime Task/AcceptanceObligation/GateTask/TaskHierarchy/RuntimeExecutionDAG/PlanRevisionSnapshot；
- parent_of 只进 TaskHierarchy，depends_on 只进 RuntimeExecutionDAG，Stage 不自动生成依赖；空 required、缺 active required GoalGateTask、悬空边、环、ref 缺失/悬空/内容不匹配/窗口内变化→零写入拒绝；重复命令幂等、旧 expected revision CAS 拒绝；
- 不创建 Run/TaskAttempt/dispatch outbox，不实现后续票（Task 领取、Run、CompletionClaim、Goal reducer）机制。

C: ReadModel 投影（Plan Graph / Task Detail / pins）
- 实现 PlanGraphView/TaskDetailView 查询与投影：cursor checkpoint、按 eventId 去重、整页先校验后应用（缺口/乱序/未知版本→ProjectionStallError）、重建等价（空投影重建与增量投影逐字段一致）、重启后重放一致、全键隔离（Project 复用本地 id 不串）、freshness（not_ready≠not_found）；
- 只依赖契约与套件（不依赖 A/B 的实现；依赖接口与测试替身并行开发）。

D: 持久化 harness 与重启证据路径
- 扩展文件库 harness：bootstrap→install×2→activate×2→CreateGoal→applyPlan→commit→close→reopen→canonical refs 解析一致、pin 不变、Plan Graph/Task Detail 重放一致；governance/plan 双路径 fixture 与断言；契约证据收集（可重复命令输出，仿照 P1-01 的 `pnpm vitest run tests/restart/evidence/...` 模式）与集成测试骨架（可暂红）；
- 依赖公共接口与测试替身，不等待 A/B 全部完成。

只实现 P1-02 所需部分，不创建 Plan 之外的 Run、CompletionClaim、Goal 归约或后续票据功能。

## 每次派发必须明确

给子 Agent 的消息包含：
- 你本人就是实现者，立即读取文件和编码，不等待派发者；
- ticket_id: P1-02；
- ticket_path：票据绝对路径；
- 分配的职责；
- 实际 workspace_root；
- 共享契约基线及引用（含 P1-00/P1-01 验收证据、契约套件路径、冻结语义清单、本票 contracts_to_create）；
- 精确 write_scope；
- 允许使用的测试命令（pnpm vitest run <scope>、pnpm typecheck 过滤自己路径）；
- 预期产物及交接格式（完成内容/设计要点/命令结果/未解问题）。

子 Agent 不再派发其它 Agent，不自行修改 Ticket 状态。需求正文从票据和接口读取，不在派发消息中另写一套规范。

## 并行写入规则

优先使用隔离 worktree；前提是仓库已经具备相应条件（当前已具备：git 仓库 + 多路 worktree 模式已验证，P1-01 的 p1-01-lane-* 可复用或另建）。
若使用同一工作区，必须严格划分互不重叠的文件写入范围。

以下文件只由你维护：
- package 配置、lockfile、构建及测试配置；
- 公共 schema、接口类型和共享 fixture（含本票新增的 Governance/Plan 契约与夹具）；
- 顶层入口、集成测试与实施交接；
- 需要跨模块同步的文档及状态记录。

不要让多个 Agent 同时安装依赖或修改同一个公共文件。子 Agent 发现协议缺口时，提交具体建议给你；你统一修改基线，通知受影响消费者同步。无关工作可以继续。

模块间存在调用依赖，不代表源码必须串行实现；使用同版本接口和测试替身并行开发。产品运行时“唯一 Writer”规则，不直接替代本次开发工作区的写入隔离规则。

## 第三阶段：集成与验收

持续检查实际工具输出、代码和测试，不以子 Agent 的“已完成”声明作为验收依据。

所有实现汇合后：
1. 用真实 SQLite Adapter 连接替换集成路径中的测试替身；
2. 执行完整 bootstrap → install CompletionPolicy/ArchitectureBaseline → activate（CAS）→ CreateGoal → applyPlan（含 pin 固定）→ SQLite commit → close → reopen → canonical refs/pins/Plan Graph/Task Detail/active revision 路径；
3. 按 P1-02 Acceptance（19 项）逐项检查并保存证据（重点：install 不自动激活、immutable 不可覆写、activation CAS 失败零写入、Plan 非空 guard 与环/悬空边拒绝零写入、pin 不随 default 漂移、重启后 Plan Graph/Task Detail/active revision 一致、无 dispatch outbox/TaskAttempt/AgentRun、重复命令幂等）；
4. 运行类型检查、单元、两套契约套件（InMemory + SQLite 双实现，含既有套件无回归）、集成测试及文档校验（node dev_docs/verification/validate-docs.mjs）；
5. 将失败交回对应负责人修复，涉及公共契约的修改由你协调；
6. 所有验收满足后，再按开发流程记录本票完成（status 保持 proposed 与阶段守卫一致，另记录 Implementation record 与证据链接到 dev_docs/verification/p1-02-implementation-evidence.md）。

不得通过削弱测试、删除验收、绕过正式接口或硬编码结果让检查通过。不能把集成测试仍依赖 fake 当作真实模块集成成功。SQLite Adapter 必须通过与 InMemory 相同的契约套件，不被“单独调参”放水。

## 交接与停止

在产品代码根维护 IMPLEMENTATION-HANDOFF.md，记录：
- 当前票据及共享契约基线；
- 每路 Agent 的写入范围与实际进度；
- 已执行命令及结果；
- 验收证据；
- 未解问题、设计理由（LedgerCommit 扩展、immutable/activation/pin 语义、guard 顺序、事务边界）和下一步。

P1-02 完成后停止，向我报告结果，不自动开始 P1-03（DAG 上 04 之后才有 05/06 并行窗口；如进度需要可单独申请授权）。
```
