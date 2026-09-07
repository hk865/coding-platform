# 执行 Agent 生命周期与"执行记忆"：完整对话记录与历次答复

    status: discussion-record
    updated: 2026-09-06
    scope: 用户在 P0-06 审阅期间提出的设计议题：执行任务 Agent 的生命周期、执行记忆、书记/秘书/参谋层、生命周期划分
    purpose: 供外部评审 Agent 阅读本对话的完整提出问题、用户理解与助手历次答复，给出独立意见与修改建议
    source_of_truth: false

> 使用说明：本文只记录讨论，不代表已接受的设计。产品状态仍是 P0-06 in_review、P1 全部 proposed（P1-00…06 已有实现证据）。评审时请以 PRODUCT.md / ARCHITECTURE.md / CONTEXT.md / dev_docs/ 正式文档为准，本文仅作为"议题上下文与推导过程"的载体。
>
> 记录方式：逐轮按「用户问题（原文）→ 助手答复（完整或结构保留的摘录）」记录；用户问题中自带的理解与立场一并保留。

---

## 0. 背景快照（供评审 Agent 校准）

- **产品**：Agent Platform，单用户、长期统一协作界面；框架维护状态与验证，语义协调（秘书/参谋/规划/集成）+ 执行者（Coder）+ 数据面（StateLedger/ReadModel/ArtifactVault/ContextCompiler/WorkspaceReader）三层结构。
- **关键已有裁决**：不建立独立 MemoryStore 或常驻 Memory Agent（记忆=Data Plane 三侧面：当前事实/开发轨迹/语义提示）；工作不属于某个模型 Context；"不是由一个持有全部历史的大型 Agent 串行运行全局 plan→act 循环"；秘书/参谋=Coordination Role 面向人的职责视角；产品承诺 6（与秘书/参谋共同确立需求、形成架构方案）、MVP 门禁（人能与秘书/参谋共同明确需求、参与架构建立或变更）。
- **已实现（有证据文档）**：P1-00…06——StateLedger（SQLite/InMemory，CAS/幂等/重启）、PlanRevision 持久化与 Plan/Task 投影、TaskEnvelope 有界 Context（≤64KiB、body-first、无 transcript）、Evidence/Review 契约（claim=INCONCLUSIVE）、Goal reducer、HandoffPacket（64KiB、无 transcript、stale/lease/after_terminal/outcome_unknown 语义）。76 files/641 tests。
- **未实现**：运行时"秘书/参谋、书记、统一图文界面、协调策略、QueryJob、执行级记忆与复原"（P1-09/11/15 等 proposed）。
- **开发流程现状**（构建产品的工作方式）：开发编排者（用户主会话）→ 每票"编排＋集成者"新会话 → 多路实现子 Agent（lane，隔离 worktree）→ 独立验收子 Agent；"文档即执行记忆"（Ticket+Interface+上游证据+Handoff+IMPLEMENTATION-HANDOFF+decisions/logs 构成每票的记忆，新会话据此重建上下文）。

---

## 1. 用户立场摘要（从问题中提炼，供快速参考）

1. **任务图不可能完美**：当下模型缺乏架构经验，不会产生完善的 task-graph，必然要修改；设计不能依赖"一次生成完美任务图"。
2. **分层决策**：秘书/书记/参谋层的 Agent 做**简单自动化决策**，**复杂人类决策**；需要取舍时给人说明。
3. **书记≠记忆 Agent**：书记要忠实反馈各 Agent 的结果，但不该定义为独立"记忆 Agent"（避免与记忆系统重复建设）；**记忆系统是基础设施，书记是基于它的"事实整理与汇报角色"**。
4. **秘书/参谋**：辅助人决策；派发调查 Agent；协调不同模块的 Agent。
5. **Agent 定义**：agent 本质 = 一段 Context + 调用；生命周期 = 该 Context 被使用、长期扩充的时间；生命周期**对应开发周期**。
6. **执行任务的 Agent 的生命周期是当前主要问题**：它涉及记忆/数据面的组成；记忆/数据面与"开发的项目/环境"相关，天然与执行任务的 Agent 相关——该 Agent **创造/记录模块的状态**，模块的记录/状态天然是它记忆的很大一部分；**加上状态变更的取舍，就近似复原了这个 Agent**。
7. **开发流程期望**：需求 → 自动化形成文档 → 拆成项目开发的粒度 → 自动执行任务 → 需要取舍时给人说明。
8. **ticket ↔ 模块**：每个 ticket 与程序中 DAG 的模块天然相关，说明**执行任务 Agent 记忆保留的必要性**。
9. **包工头**：不需要常驻巨型 Agent；生命周期 = 完成模块后保存在长期 session/记忆中，之后按需启用。

---

## 2. 逐轮问答记录

### 第 1 轮

**用户问题（原文）**：
> 对于它，针对人类参与架构设计的文档，我现在需要查询一些问题--关于秘书/参谋层面的，当下的设计是如何的？

**助手答复（摘要，完整结构保留）**：
秘书/参谋层面的当下设计：它是「协调角色」面向人的职责视角（CONTEXT：Coordination Role 承担目标澄清、任务分工、耦合与测试设计、结果集成和返工；秘书/参谋是其面向人的职责视角），归属 Control Plane 的 Semantic Coordination，与规划/集成者是同一协调角色的不同视角，不强制两个常驻进程。职责：意图与事实 → 澄清、方案、解释、决策简报；参与分工、耦合分析与测试策略、按需查询执行者报告；可以仅查询并返回，不强制再次审核。秘书主动性已裁决：可提醒、讨论、参谋和安全打断，但所有写入仍走 Command/Controller，不能直接改写状态。

人类参与架构设计的决策链：人与参谋明确需求 → 共同形成架构选项与影响 → 按已有授权或人的决定接受 → 版本化规格/Baseline/Plan → 执行与验证 → 回报变更与结果。初始设计：scoped design request → PlanCompiler 返回 clarification 或版本化 Proposal（选项与取舍、受影响规范、假设、来源）→ 人可修改/接受/拒绝/延后，沉默≠接受 → InitialDesignDecision 绑定精确 proposal revision。知情≠逐项审批：小变更矩阵四类情形；事件策略：先机械处理→授权内确定性→有界语义协调→只有新业务选择/外部事实/权限预算决定升级给人；策略模板部署须显式版本化。查询三路径（ReadModel/公开快照/QueryJob），用户可跳过参谋，参谋可只做工具路由。依赖资源：协调记忆（历史问题/备选方案/决定理由/scope/revision/实际结果，不自动构成授权）、协调 Skill（耦合检查/测试设计/上下文诊断/权衡方案，遵守当前策略）。成熟度：全部 draft/proposed，无代码；human-framework-role-review.md 为 source_of_truth: false、review_gate: P0-06；P0-06 仍 in_review，要求明确秘书/参谋与规划/集成者的职责关系。

---

### 第 2 轮

**用户问题（原文）**：
> 事实上，task-graph必然不可能，因为当下模型依然缺乏架构经验，并不会有完善的task-graph，必然要改，我的主要的设计是通过秘书/书记/参谋这一层的agent，进行简单的自动化决策，复杂的人类决策
> 书记很重要，它需要忠实的反馈各个agent的结果，秘书/参谋是辅助人进行决策，以及派发进行调查的agent以及进行协调不同模块的agent。
> 目前的模块中有这一点吗？这会对哪些文档有影响？

**助手答复（状态说明）**：
该轮在调研中被后续消息打断，未形成完整书面答复。调研结论已并入后续各轮：搜索"书记"全库仅 dev_docs/logs/README.md 一处（"为书记/秘书/参谋层提供可记忆搜索的标记载体"）；"调查"相关能力存在于 QueryJob/短生命周期模板/协调者派发路径；"task-graph"（TaskHierarchy、PlanRevision、RuntimeExecutionDAG）在 CONTEXT/ARCHITECTURE/completion-policy/P1-02/05/06 多处以"任务图与完成判定"为主线。对"目前模块中是否有这一点/影响哪些文档"的完整回答，见第 3、4、5、6 轮的逐步收敛（特别是"书记"缺失、"执行记忆"缺口的结论）。

---

### 第 3 轮

**用户问题（原文）**：
> 不过书记的职能似乎和记忆系统重合了。
> 更准确地说，书记不应该再被定义成一个独立的"记忆 Agent"，否则很容易和 Memory System 重复建设。
> 可以这么拆吗？
> Memory System 是基础设施，书记是基于这套基础设施的"事实整理与汇报角色"。

**助手答复（完整保留）**：

可以这么拆——而且当前设计本来就是这个方向，甚至更彻底：现有架构里并没有一个"记忆 Agent"，记忆从来不是独立系统。

**一、与现状的对应**

1. 当前设计直接拒绝"独立记忆 Agent"：ARCHITECTURE L102"不要求建立独立 MemoryStore 或常驻 Memory Agent"；runtime-collaboration L44"不统一复制到 MemoryStore"。记忆只是 Data Plane 的三个侧面：当前事实（源码/Git/规范/证据）、开发轨迹（Session/Handoff/失败重试/Decision）、语义提示（要点/偏好/待解问题，带来源与不确定性）。
2. "整理、去重、分析冲突"当前已描述为角色行为：ARCHITECTURE L112"知识产生者可在工作或交接时记录要点和来源；临时 Agent 按需整理、去重、分析冲突"；复核稿 L133"按需由短生命周期 Agent 整理"。
3. "忠实反馈各 Agent 结果"的机制底座已存在：报告标明作者/时效/版本/未验证性质（L120）；消息分 assignment/question/report/proposal/handoff/discussion（L50）；"Report 只证明某 Agent 报告了某事，不证明其业务结论"（L54）。logs/README.md 的 scope 已定位"为书记/秘书/参谋层提供可记忆搜索的标记载体"。

**二、拆分后必须守住的四条边界**

| 边界 | 表述 | 现有依据 |
|---|---|---|
| 书记不是事实源 | 产出"报告/语义提示"层：有来源、版本、不确定性；正式状态/完成判定仍由框架归约；不自证、不改状态 | CONTEXT CompletionClaim/Evidence；ARCHITECTURE L108 |
| 书记≠ContextCompiler | 后者是机械材料组装（Data 基础设施）；书记是语义整理/去重/冲突分析/汇报（Control 语义职责） | runtime-collaboration assemble |
| 书记无独立进程/Module | 用 CoordinationJob+短生命周期模板按需实例化；不新增 registry 项 | short-lived-agent.md；RoleBinding |
| 书记产出走正式写入路径 | 正文先入 ArtifactVault、Control 校验登记；约束性变化走正式受理 | runtime-collaboration L52 |

"忠实"拆两层：机械事实的忠实（ReadModel/状态图，不需要书记）；跨 Agent 结果的语义汇总与汇报（去重、冲突识别、人类可读的"发生了什么"——这才是书记）。若追求"零信息损失"就回到"无限长秘书对话"陷阱（S-001"秘书不必翻 80 万 token"），所以书记=有界摘要+来源引用+未验证标识。

**三、影响文档**：CONTEXT.md（Coordination Role 定义并列加书记＝事实整理与汇报视角，可加 _Avoid_: Memory Agent）；ARCHITECTURE.md（角色与记忆段落补齐秘书/参谋/书记/规划/集成）；human-framework-role-review.md（角色收敛表加一行：输入=各 Agent Report/事件/证据 → 输出=去重整理的事实摘要、来源标注、未解项；只整理与汇报，不裁决）；runtime-collaboration.md（消息/报告登记明确"事实汇报"kind）；human-design-status.md（文本：语义解释层补书记产出归属）；P0-06/P1-15（P0-06 Acceptance L41 补"书记与记忆系统、书记与秘书/参谋的关系"；P1-15 作为书记汇报第一消费者）；short-lived-agent.md（role_label 示例，无需结构改动）。另：CONTEXT L15 产品边界 _Avoid_: Secretary Agent——书记同样应"职责视角+按需实例"。

---

### 第 4 轮

**用户问题（原文）**：
> 现在我需要知道，当下的记忆模块是如何搭建的

**助手答复（完整保留）**：

结论：当前设计里没有一个独立的"记忆模块"——记忆不是 Module registry 里的任何一项（显式裁决"不要求建立独立 MemoryStore 或常驻 Memory Agent"）。记忆被搭建成"一个组织视角+四条机械承载线+两个语义角色性机制"。

**组织视角三侧面**：当前事实（源码/Git、规范与架构、测试/Evidence、Task/Run/Artifact；各留权威来源/scope/revision，索引不取代原始对象）；开发轨迹（Session、Handoff、变更、失败/重试、Decision；记录做过什么及原因，历史报告不等于当前事实）；语义提示（要点、经验、偏好、待解问题；带来源与不确定性，帮助发现材料，不自动产生约束）。

**机械承载（Data Module）**：StateLedger（canonical 事件/snapshot 源头：append-only、CAS、幂等、全局 cursor；不 fold、不裁决）；ReadModelIndex（事实查询投影：goal/plan/task/run/timeline，cursor freshness；派生状态可重建，不接 Command）；ArtifactVault（正文存储：报告/交接/ContextBundle/语义提示正文，内容寻址+来源元数据；校验来源≠验证结论）；ContextCompiler（按角色/任务/scope/版本/预算组装有界材料；不分工、不启 Agent，缺材料返回缺口）；WorkspaceReader（源码/Git/索引带来源读取，provenance/stale；不建 Task、不写 checkout）。

**语义侧**：整理/去重/分析冲突由短生命周期 Agent 按需承担（role_label 自由组合），不是常驻记忆进程；"需要新语义检索 → Control 派发有界工作 → 以结果引用重新 assemble"。logs/README.md 标签体系（id/kind/tickets/conflict_files/resolution/state）是给书记/秘书/参谋层的可记忆搜索标记载体——目前唯一把"书记"写进设计的地方。

**写入与读取**：知识产生者记录要点 → 权限/格式/来源检查后保存（普通记录不逐条审批）；改变规范/授权/验收/约束性偏好的走正式接纳/替代（→版本化 Decision）。读取：ReadModel 直达 → 已有报告/角色绑定 → QueryJob；语义索引按需。策略归属：Context 规划（谁需要哪些信息）归 Control；Context 编译（检索/过滤/组装）归 Data；"不把两者混为一个拥有全部状态的大 Agent"。

**实现状态**：StateLedger ✅P1-00/01；PlanRevision+Plan/Task 投影 ✅P1-02；TaskEnvelope 有界 Context（64KiB、body-first、无 transcript）+ArtifactPort/TaskContextPort 冻结 ✅P1-03（44 files/395 tests）；Evidence/Review 契约（ReviewPacket 有界、claim=INCONCLUSIVE）✅P1-04；Goal reducer+goalStatus/goalTimeline ✅P1-05（64 files/539 tests）；HandoffPacket（64KiB、无 transcript、stale_source、lease CAS、outcome_unknown 保留）✅P1-06（76 files/641 tests，文档未提交）；角色/RoleBinding 运行时、秘书/参谋/书记、协调策略、QueryJob、统一界面图文、语义提示主动整理 ❌（extension draft/proposed，P1-09/15 未动工）。

一句话：当下记忆=事件事实层（StateLedger/ReadModel）+正文层（ArtifactVault）+有界组装层（ContextCompiler）+时序轨迹（HandoffPacket/开发轨迹）；前四层已有实现证据；"语义提示"侧面（书记/秘书/参谋消费的整理与汇报层）基本空白。

---

### 第 5 轮

**用户问题（原文）**：
> 那么书记的角色，完全是属于多余的吗？还是并不多余？

**助手答复（完整保留）**：

不是多余的——但按当下设计推演，它有一半职能是多余的，另一半是真实空白。判据一句话：书记处理的是"跨 Agent 报告之间"的语义关系（去重、冲突、归并、未解项），不是"报告内部"的事实。

**多余的部分（剥离给机械层）**：①事实的忠实镜像（ReadModel+状态图已做且更可靠；"确定性状态摘要无需模型"human-design-status L33）；②报告的机械登记（作者/时效/版本/未验证标识、ArtifactVault、Control 登记——P1-06 HandoffPacket 已做）；③任何状态/完成判定权（Report 只证明报告了某事；完成归约是 ControlEngine 的事）。

**不多余的部分（真实缺位）**：①跨 Agent 结果的语义归并（多报告口径不一、可能矛盾；"哪个证据覆盖哪个决定、A 的失败和 B 的重试是什么关系"——ReadModel 明确不做；现在以"临时 Agent 按需整理"存在但没有角色归属、没人负责——P1-15 缺的那块）；②面向人的有界叙事（人看 64KiB HandoffPacket 原文还是"发生了什么"摘要？答案后者，但"谁负责生成"没写）；③矛盾与未解项的显式化（事件矩阵定义了升级条件，但"谁去发现并向人汇报"没有指派——书记给了它一个主人）。

**可证伪验收问题**：若"忠实反馈"只意味着看到正确状态/证据/时间线 → 书记多余；若意味着"讲清楚、标出矛盾、指出未解项" → 书记必要，且正是当前"有事实层、无叙事层"的缺口。建议定义：只读、有界、带来源与不确定性标注的"事实简报"角色，运行时用 CoordinationJob 按需实例化，不拥有状态、不建存储、不改写任何结论。

---

### 第 6 轮

**用户问题（原文）**：
> 除了书记这一层，控制面的分工是怎么分的，按照当下的文档来进行说明。参谋/秘书层，人类如何与之互动？控制面有没有主agent-子agent的展示，控制面是根据什么来进行控制的？

**助手答复（完整保留）**：

**① 控制面分工（三层能力分置）**：语义协调（模型承担：秘书/参谋面向人+规划/集成执行组织；PlanCompiler.request/accept，有界协调工作，不持有全局模型循环、不持有永久对话）；确定性控制（框架承担：ControlEngine 唯一转换权威，reducer 内不调模型；DispatchEngine drive/accept/snapshot，所有角色复用该路径，公开快照）；验证编排（VerificationEngine verify+ArchitectureReconciler inspect；组合证据返回 verificationRef，不自行完成 Task）。三条硬规则：模型语义职责在 Control 但不在 reducer 执行；模型 Run 经 DispatchEngine 正式启动、结果经 Control 提交后再驱动后续；控制面不反向调用 Module。角色归属与运行承载分开；RoleBinding（模板版本/Agent/Task/QueryJob/CoordinationJob/职责/授权策略版本/工具读写范围/预算/终止条件）由 Control 管理。

**② 人与秘书/参谋互动**：统一界面三条通道——直接查询（可跳过参谋；事实=ReadModel→快照=DispatchEngine→新语义=QueryJob；参谋可只做工具路由）；需求/架构协商（scoped design request→clarification/版本化 Proposal→人修改/接受/拒绝/延后，沉默≠接受→InitialDesignDecision 绑定精确 revision→接受并产出规范引用+安装意图）；控制与授权命令（暂停/继续/取消/安全修改走 Control；任何点击只经 Command 生效；秘书可主动提醒/讨论/安全打断，但不拥有真实状态）。原则：人看"状态图+解释+结果+需决策事项"；解释带 source manifest/revision、过期标 stale；事实视图不因解释未就绪而阻塞；仅新业务选择/外部事实/权限预算决定升级给人。

**③ 有没有主 Agent-子 Agent 展示——没有，且是有意的**：运行时没有主 Agent 概念（L126"不是由一个持有全部历史的大型 Agent 串行运行全局 plan→act 循环"；S-001 结论"控制面核心不是主 Agent，而是 Desired State + Reconciliation"）；展示的是角色/Run 关系视图（Goal/Task/角色/Run 关系、阻塞、Evidence、Decision），不是层级树；有委托关系但非父子生命周期（"协调者 rollover 后从事实及 Handoff 接续，独立 Worker 不随之停止"；无限自主 spawn 是明确非目标）。注意区分：开发流程里确实有"开发编排者→开发子 Agent"（AGENTS.md、P1-02 prompt）——那是构建本产品的工作流，不是产品运行时的主-子结构。TaskHierarchy（parent_of）是任务工作分解层级，不产生执行依赖或完成豁免。

**④ 控制面根据什么控制（六类）**：①canonical 状态与版本（guard 用 canonical state，过期查询结果不能授权写入）；②授权与策略（RoleBinding/CoordinationPolicy/记录权限/CompletionPolicy，版本化显式安装，模型不能自行解释成更宽授权）；③完成与证据（Evidence+EvidenceBinding+EffectiveEvidenceSet；Claim/verdict 只是"报告了"，claim 强制 INCONCLUSIVE，证据不能互相冒充）；④真实依赖与适用性（RuntimeExecutionDAG、scope/revision、Workspace/CodeGraph digest，stale 显式拒绝/重投影）；⑤预算与生命周期（token/deadline/retry、安全点、取消、唯一写者 lease CAS N→N+1；outbox intent 先持久化再启动；迟到结果 after_terminal 拒绝）；⑥事件与人工决定（去重/乱序/时序；InitialDesignDecision/UserDecision；未委托变化升级）。一句话：控制面根据"已提交状态+版本化授权策略+有效证据+真实依赖+预算生命周期+显式人工决定"做确定性校验与推进；模型只提提案和解释，永远不拥有转换权。

---

### 第 7 轮

**用户问题（原文）**：
> 我指的其实就是开发编排者 → 开发子 Agent

**助手答复（完整保留）**：

开发控制面是"主 Agent（开发编排者）→ 子 Agent（实现/评审/集成）"的明文两跳结构。

**两跳结构**（agent-entry-and-system-map.md L16-43）：开发编排者（主）→ AGENTS.md（子 Agent 入口）→ 当前 Development Ticket（唯一工作入口）→ Module/Interface/已验收上游 Artifact（精确 ref+revision）→ 有界 ContextBundle → 开发 Worker/Reviewer/Integrator → Artifact+Evidence+Handoff → Ticket 验收/Controller。

实际项目里：开发编排者（用户侧主 Agent）分票（ticket_id/ticket_path/role(worker|reviewer|integrator)/workspace_root/upstream_artifact_refs/write_scope）→ 每票"编排＋集成者"新会话（准备共享基线、派发并行 lane、独家维护公共文件、亲自集成验收、维护 IMPLEMENTATION-HANDOFF）→ 实现子 Agent（lane A/B/C/D，隔离 worktree，不再派发其它 Agent、不修改 Ticket 状态）→ 独立验收子 Agent（只读复跑）。P1-05 证据：三路并行，B 因基础设施中断由 integrator 接管；"三方独立验收（子 Agent 复跑，仅只读+运行测试）"。关键约束（AGENTS.md）：子 Agent 没有 Ticket ID 时先报告缺入口，不自行选 backlog。

**主-子结构的"展示"**：无图形面板，是文档式控制台——施工图（DevelopmentTicketDAG：票/blocking edges/Frontier/G1-G5/MVP 门禁）；每票状态（status(proposed)+blocked_by+输入输出 artifacts+Acceptance/Verification）；每路进度（IMPLEMENTATION-HANDOFF：当前票据、共享契约基线、每路 Agent 写入范围与实际进度、命令结果、验收证据、未解问题——只由编排/集成者维护）；结果与事件（verification/p1-0X-implementation-evidence.md 验收对照表；logs/conflict-reports 标签化日志）。

**开发控制面根据什么控制（8 条）**：①Ticket 是唯一入口，需求/输出/验收只从票读，派发消息不复制规范；②DAG 边=已验收上游 Artifact，精确 ref+revision；③最小派发信封（role/workspace_root/write_scope/允许命令）；④写入隔离（隔离 worktree 或互不重叠文件范围；公共文件只由编排/集成者独占维护——"主"最硬的控制点）；⑤协议缺口走"子 Agent 建议→编排者统一改基线→通知消费者"；⑥验收凭据=实际工具输出/代码/测试，不以"已完成"声明为准（typecheck/vitest/InMemory+SQLite 同一契约套件/集成/重启证据/validate-docs；不得削弱测试、删除验收、硬编码结果）；⑦阶段守卫（P0-06 未接受前 P1 保持 proposed；limited_authorization 逐票记录；子 Agent 不把票标完成；完成后停止，向用户报告，不自动开始下一票）；⑧并行协议（同版本接口+测试替身并行；冲突教训写成机械合并规则+未来并行窗口约束）。

一句话：开发控制面=人（最终授权）→开发编排者（主，分票/信封/公共基线/验收）→开发子 Agent（只实现、不派单、不写公共面、不自判完成）；依据"票据+DAG 依赖+写范围+共享基线+实际命令证据+阶段授权"控制；与产品运行时"框架确定性控制（无主-子）"是两套控制面，交叉点只有一处：运行时读写隔离规则不替代开发工作区写入隔离（P1-02 L109 特意写明）。

---

### 第 8 轮

**用户问题（原文）**：
> 我想要知道它们和秘书/参谋，人，可能的记忆系统的关系

**助手答复（状态说明）**：
该轮未及形成答复即被下一轮问题打断；主题（两大控制面×秘书/参谋×人×记忆系统）由第 9、10、11、13 轮的回答覆盖，尤其是"产品文档要求秘书/参谋（第 9 轮）"与"执行记忆与生命周期（第 11-13 轮）"。

---

### 第 9 轮

**用户问题（原文）**：
> 我记得产品本身的文档里面有说需要它们，不是开发的时候，是产品本身

**助手答复（完整保留）**：

你说得对——秘书/参谋是产品（运行时）本身的必备能力，产品文档有明确要求。"开发流程没有秘书/参谋"是另一层意思（开发流程确实没有，但产品有）。

**① 产品文档明确要求的位置（证据表）**

| 文档 | 位置 | 原文要点 |
|---|---|---|
| PRODUCT.md | 承诺 #6（L47） | 与秘书／参谋 Agent 共同确立需求、形成架构方案并讨论变动，理解关键选项、影响与已接受决定 |
| PRODUCT.md | 角色协作（L70） | 秘书／参谋参与人与 Agent 的协作，并与规划／集成职责共同承担分工、耦合分析、测试设计和结果协调 |
| PRODUCT.md | Human Collaboration（L84-86） | 主对话、状态图、面板、提醒、查询、参谋和控制入口同一界面；人和 Agent 共同明确需求、参与架构生成与变更讨论；呈现选项、影响、决定和执行反馈，确保人知情 |
| PRODUCT.md | 架构治理（L90-92） | 秘书／参谋协助人形成需求和架构方案，已接受决定进入版本化规范与 ArchitectureBaseline |
| PRODUCT.md | MVP 必须证明（L104） | 人能与秘书／参谋共同明确需求、参与架构建立或变更，并获知决定及执行影响 |
| ARCHITECTURE.md | Plane 图（L23） | Control Plane = Semantic Coordination：秘书／参谋／规划／集成 |
| ARCHITECTURE.md | 决策链（L73-74） | 人与参谋确立需求和选项→适用决定→版本化规范/Baseline/Plan→执行→事实与解释回报；需要新业务选择或授权时先由参谋提交选项和影响供人决定 |
| ARCHITECTURE.md | 查询（L118） | 用户可跳过秘书/参谋；参谋可只做工具路由 |
| ARCHITECTURE.md | 角色协作（L138、L142） | 秘书/参谋参与面向人需求/架构讨论，协同规划/集成；否则由参谋升级具体取舍；初始需求与架构由人参与形成 |
| CONTEXT.md | 术语（L139-140） | 秘书／参谋是 Coordination Role 面向人的职责视角 |
| mvp-scenario.md | Step 0（L64-66） | 人与参谋确立初始设计：需求歧义→≥2 个有实质差别的选项、验收、架构关系与影响→人选择或修订→绑定版本决定 |
| P0-06 | Acceptance（L41-42） | 明确秘书/参谋与规划/集成者的职责关系；明确需求确立、架构建立/变更、人类知情和适用决策进入执行的完整路径（未 accept 前 P1 不转 active） |
| P1-15 | 完整场景 | 人（界面）→参谋（方案/决定）→协调者（派发/返工）→统一图文回报；接口 InitialDesignPort 待冻结 |

**② 产品内关系**：人↔秘书/参谋（决策支持交互层）：人不直接改状态，一切写入经 Command；秘书可主动提醒/讨论/安全打断。决策链：意图/歧义→选项+取舍+影响→人修改/接受/拒绝/延后→InitialDesignDecision 绑定 proposal revision→版本化规格/Baseline/Plan。带宽规则：知情≠逐项审批；仅新业务选择/外部事实/权限预算升级给人；查询三路径可绕过参谋。秘书/参谋↔记忆系统（消费关系）：记忆=基础设施；秘书/参谋消费不拥有；ReadModel 查事实、ContextCompiler 编译材料、ArtifactVault 存提案/报告正文；检索到历史经验≠当前有效约束；升级/决定回写记忆（Decision）；普通记录不逐条审批。秘书/参谋↔框架（建议权与执行权分离）：只有提案/解释/升级；校验/派发/验证/状态推进在确定性框架；语义 Run 经 DispatchEngine 正式启动。

**③ 与开发流程的边界（一句话）**：开发流程的"控制面"（编排者→子 Agent、票据/DAG/证据）不是秘书/参谋的运行时；产品运行时未来调度的用户工作叫 Runtime Task（Development Ticket 明确 _Avoid_ 之），两者在 AGENTS.md 和 CONTEXT.md 里被显式禁止混用。（另：书记目前产品文档没有词条，唯一出现是 logs/README.md 的 scope 行，属开发侧对象说明；若把"瘦身版书记"作为产品角色，需补进 CONTEXT 术语+PRODUCT 承诺+复核稿角色表+P1-15 呈现契约。）

---

### 第 10 轮

**用户问题（原文）**：
> 我指的是工作的agent里面有没有专门长期存在的包工头，它们能不能分子agent

**助手答复（完整保留）**：

分两个世界——开发流程有"包工头"，产品运行时没有"长期存在的包工头"，但保留"包工头职能"，且允许有序分子 Agent。

**① 开发流程：有长期包工头，能分子 Agent。** 开发编排者（主会话）+每票"编排＋集成者"session；能分（P1-02 四路 A/B/C/D；P1-03/05 三路并行，隔离 worktree）；子 Agent 不能再分子（"子 Agent 不再派发其它 Agent，不自行修改 Ticket 状态"）；包工头控制=分票（信封）、独占公共文件、集成验收、证据与停止。P1-05 证据：integrator 接管中断的 B，"三方独立验收（子 Agent 复跑，只读）"。

**② 产品运行时：没有常驻包工头，只有包工头职能。** 文档明确否定常驻——L70"角色职责归属与运行承载分开"；复核稿 L36"不强制成为两个常驻进程"；L126"不是由一个持有全部历史的大型 Agent 串行运行全局 plan→act 循环"；L110"ContextCompiler 不能自启 Agent，需要语义判断由 Control 路径创建短生命周期工作"；PlanCompiler"有界协调工作……不持有全局模型循环"；复核稿 L98"协调 Run 结束或失败后，其余独立工作仍可推进，新 Run 从状态与有界交接恢复协调"。

**能分子 Agent（有规则）**：协调者填写任务内容→框架核对引用/权限/预算/输出要求→RoleBinding 绑定 Run（短生命周期模板：调查/检索/测试分析/实现自由组合；已授权任务无需每次请人批准）。不许无界：模板 L40"不自行扩大范围或启动无界子 Agent"；PRODUCT 非目标"无限自主 spawn"；分裂权在框架不在 agent。非父子生命周期：P1-15"协调者 rollover 后从事实及 Handoff 接续，独立 Worker 不随之停止"。

**③ 为什么产品要这么设计**：常驻包工头必然要一个无限/巨型 Context（管全部子 Agent 状态）→文档直接否决；但完全无头也不行（Agent 倾向做容易的小任务、没有责任主体）→保留协调角色职能+版本化角色规格+短期实例；解决办法=协调职能+确定性框架（Desired State + Reconciliation）：包工头的脑力由语义角色按需提供，记忆和状态由框架持久化，子 Agent 派发/绑定/验收由框架机械完成。

直接回答：开发世界有专门长期存在的包工头、能分子 Agent、子 Agent 不能再分；产品世界没有专门长期存在的包工头（无常驻进程、无全局循环）、有包工头职能（按需实例化 CoordinationJob、可换手）、能分子 Agent（经 RoleBinding/Dispatch 正式绑定、有界、带预算与退出条件）、不允许子再分子与无限 spawn、无父子生命周期。

---

### 第 11 轮

**用户问题（原文）**：
> 我指的是产品中如果形成了当下开发这个产品的文档之后（即秘书与人讨论确定好架构，task-graph之后），会不会存在这样的包工头，我知道它们的生命周期是完成模块之后保存在长期session/记忆中，之后可能的按需启用。那有没有这样的包工头

**助手答复（完整保留）**：

有——但形态不是"一个长期活着的 Agent"，而是"长期存在的职责+持久化的状态/记忆+按需新启用的运行实例"。你描述的生命周期（完成一段→存进长期记忆→之后按需启用）恰恰就是当前设计里这个"包工头"的定义方式，只是"长期记忆"不是 Agent 的 session，而是框架的状态与记忆三侧面。

**① 产品里包工头在哪**：L74"Planning→Control 是日常指挥入口：已授权分工、契约内设计与返工可直接提案并由框架接受；需要新业务选择或授权时，先由参谋提交选项和影响供人决定"。任务图/架构确定后，"规划/集成"就是日常包工头：提分工提案→框架校验接受→派发执行者→收反馈→集成/返工/重规划；新业务取舍升级参谋→人。MVP 场景 L46"协调者据已接受计划组织上述工作"。

**② 生命周期对应表**：完成一段工作=协调 Run 结束，产物/报告/决定/Handoff 落库（复核稿 L98）；保存在长期记忆=持久状态+有界 HandoffPacket+决定+语义提示（PRODUCT"工作不属于某个模型 Context。新 Run 或新 Agent 可以从持久状态和有界 HandoffPacket 接续"，P1-06 已实现）；之后按需启用=新的 CoordinationJob，Control 路径派发→ContextCompiler 从状态/轨迹/提示编译有界材料→RoleBinding 绑定 Run（复核稿 L98"新 Run 从状态与有界交接恢复协调"）；启用后管子工作=派发 Coder/调查/短生命周期角色，全部经框架绑定、有界、有预算、有退出条件；协调者换手不影响已派发独立 Worker（P1-15）。

**③ 与"长期 session/记忆"的一处对齐差异**："长期 session"容易滑向"无限长对话的包工头"，产品明确反对（L126；非目标"完整 transcript/Memory/RAG 独立承担进度与完成判定"；S-001"秘书不必翻 80 万 token"）。产品等价物：长期"记忆"=框架持久状态+开发轨迹+语义提示；每次召回 ContextCompiler 只编译这次需要的有界材料。

**④ 现状与缺口**：设计上有（PlanCompiler.request/accept、RoleBinding/CoordinationJob、P1-15）；实现未开工（P1-09/11/15 proposed，P0-06 未 accept；已落地只有 P1-06 HandoffPacket+持久状态/lease/stale 的换手恢复底层）。可微调点：当前文档没有明确"每个 Goal/Project 绑定一个长期协调职责"，协调人按工作轮询、按需实例化；若意图是"包工头与 Project/Goal 同生命周期绑定、事件驱动唤醒、把该目标全部协调记忆挂在职责上"，这是对 RoleBinding 的自然扩展（协调绑定到 Goal 而非单次 CoordinationJob），与现有设计不冲突，但需在复核稿/P1-15 加一句明确。

---

### 第 12 轮

**用户问题（原文）**：
> 我认为我们缺少生命周期的确认与划分。
> 首先，什么是agent？agent本质就是一段contxt+调用，所以这里的生命周期指的是这一段context被使用，长期扩充的时间，其中生命周期是对应开发周期的，因此，按照这个定义来看，目前的各个llm调用的分类与生命周期

**助手答复（完整保留）**：

（按此定义，先梳理现状——当前没有显式的"生命周期分类"，只有隐含的散落规则。）

**① 运行时 LLM 调用分类×生命周期**：执行者 Worker Run（有界 ContextBundle，≤64KiB、无 transcript；单任务周期：领取到终端；结束后 Run 事实+Claim+Artifact，Context 不存活；换手=新 Run+持久状态+HandoffPacket，不回放 transcript）；协调 Run（有界协调 Context，讨论有轮次/时间/Token 上限；单工作包周期：一次请求→方案/提案/解释/未解项；不持有全局循环；结束后提案/决定/报告/Handoff→状态+开发轨迹；"新 Run 从状态与有界交接恢复"）；Reviewer 语义复核（有界 ReviewPacket；单次验证周期；Evidence 绑 revision 过时失效）；调查/QueryJob（独立只读、问题/任务专用；单次或单任务周期；"静态查询已够就不创建 Run"；报告/答案带来源与未验证标识）；架构对账/演进评估（事件驱动单次周期；Finding/决策简报/迁移要求）；人对话框中的秘书语义（每次语义请求的有界 Run，"秘书层像 Intent Compiler"；UI 对话看起来长期，底层每次新且不携带全量历史）。明确不是 LLM 调用：ControlEngine/DispatchEngine/ReadModel/ContextCompiler/StateLedger/ArtifactVault/静态运行工具——"静态查询、确定性调度和正常事件处理可以不调用模型"。

**② 开发流程分类×生命周期**：开发编排者会话（整个项目开发周期级——当前唯一真正"长期扩充"的 Context；文档仓库外置记忆；靠 compaction/换手）；编排＋集成者 session（单票开发周期；票内记录+HANDOFF+evidence）；实现子 Agent lane（单 lane 周期；无此前对话读文档）；验收子 Agent（单次只读复跑）；文档维护 Agent（单任务周期）。开发侧长期记忆=文档仓库+IMPLEMENTATION-HANDOFF+git——持久层，不是任何 Agent 的 Context。

**③ 关键结论**：当前设计里"长期存在"的实体是状态与记忆，不是 Context。所有 LLM 调用 Context 生命周期被限制为有界（单次/单任务/单工作包）；跨周期延续（包工头、秘书、执行者换手）通过"职责+持久状态+按需新 Run"。"生命周期对应开发周期"两种解读：A（当前设计）生命周期=一个开发周期内的每次调用，周期间靠状态/记忆衔接；B（对包工头的描述）一段 Context 跨模块开发周期生长、完成后整段归档、之后整段复活——当前明确不做（"长期大型 Agent 全局循环"被否决；"完整 transcript/Memory/RAG 独立承担进度"是 MVP 非目标）。

**④ 缺口**：文档有 TaskPhase/Run/TaskAttempt（任务级）、CoordinationJob/QueryJob（工作级）、RoleBinding（职责级）、短生命周期模板退出条件、压缩/rollover 监控（只作诊断信号）——但没有以"Context 生命周期"为主轴的分类表，也没定义"开发周期↔上下文生命周期"对应关系。

**建议层级模型（草案）**：

    L0 单次调用（QueryJob/一次确认）        —— 用完即弃，只留结果引用
    L1 单任务周期（Worker Run/TaskAttempt）  —— 结束→状态+Artifact+Handoff；复活=新 Run
    L2 单工作包周期（协调/评审/调查/对账）  —— 结束→提案/决定/证据/未解项；复活=新 Run
    L3 职责周期（协调角色/RoleBinding）     —— 不拥有 Context；跨 Run 的"长期"在状态+记忆
    L4 持久层（三侧面记忆+已接受规范/Baseline）—— 唯一真正"长期存在"；按需编译进 L0-L2

要你拍板的一题：包工头生命周期按 L2（每次新 Run、状态衔接）还是 B（Context 跨模块生长、归档、整段复活）？选 L2：与现有约束兼容，实现=P1-15 加"Goal 级协调职责绑定"；选 B：需放宽"有界 Context"核心不变量，把"归档-复活"定义为第一等机制（快照/restore/恢复校验/过期失效），冲击 ARCHITECTURE 查询/Context 章节、PRODUCT 非目标、P1-06 等已验收语义，动静大一个量级，需单独影响清单。

---

### 第 13 轮

**用户问题（原文）**：
> 目前的问题还是在##执行任务##的agent的生命周期是什么，事实上，这涉及到记忆/数据面的组成，记忆/数据面是与开发的项目/环境有关，正好可以和这个##执行任务#的agent天然相关，这个agent创造/记录模块的状态，模块的记录/状态天然是这个agent的很大一部分，如果加上状态变更的取舍，其实就是近似复原了这个agent。
> 再回到我们开发这个项目的流程事实上，我期望的就是自动化的把需求形成文档后，拆成这个项目开发的粒度，之后自动化的执行任务，需要取舍时给人进行说明。那么，从这个开发的粒度来看，每一个ticket和程序中的DAG模块天然相关，这也说明了#执行任务#的agent记忆保留的必要性。
> 你先理解我说的是什么之后再给出你的对于目前开发文档的建议，目前文档中是否有这个思想，具体的任务设计，代码设计是否有这个思想

**助手答复（完整保留）**：

先复述理解（确认未跑偏）：①执行任务 Agent 的生命周期=一个开发粒度（模块/票对应的工作）的周期，领取时创建/绑定，完成后结束。②它的记忆=它自己创造的模块状态+它做的状态变更取舍；记录天然与项目/环境绑定，也天然属于它；不需要另造"记忆 Agent/存储"，按它归属聚合就是它的记忆。③"状态+取舍"拼起来≈复原该 Agent：下次相关工作时用这些材料重建 Context，近似还原（不是 100%，原始思维链本就不保留）。④开发流程期望：需求→文档→按项目开发粒度拆分（ticket↔模块/DAG 天然对应）→自动执行→需要取舍时给人说明；每个粒度的执行 Agent 记忆保留是必要的。⑤这也回答包工头：不需要巨型常驻包工头；持久的是"每个工作粒度的执行记忆"，协调可按需从记忆复原。一句话：生命周期属于"工作"（模块粒度），记忆属于"执行它的 Agent"（=状态+取舍），通过"工作"绑定；记忆留在数据面，Agent 结束时 Context 消亡，需要时从记忆近似复原。

**① 目前文档有没有这个思想——一半有，而且是"形似神异"**。

有的部分：记忆三侧面恰好=状态（当前事实）+取舍（开发轨迹：做过什么及原因/失败重试/Decision）+未尽事项（语义提示）；记忆按 Project/Workspace 组织、天然来源=源码/Git/规范/证据/Session/Handoff；执行者产 Artifact+观察+Claim、Control 落状态（产物与状态=事实侧）；P1-06 HandoffPacket 保留工程轨迹、当前事实版本与语义提示来源、"B 不读 A 的隐藏思维链或完整 transcript"＝有界复原雏形；CONTEXT AgentInstance=有连续身份的逻辑执行者、Execution Role"角色身份不同于某一次 Run"（身份与 Run 分离）；Decision 存在但只在架构/授权级；开发流程"文档即执行记忆"每票新会话从 Ticket+Interface+上游证据+Handoff+HANDOFF+decisions/logs 重建——开发流程已经在手工执行你的思想，只是靠"读文档"而非机制。

没有的部分（关键缺口）：①记忆按"执行工作/Agent"聚合的维度不存在（按 Project 组织、按任务检索；无 per-work 记忆引用/索引）；②执行级取舍留痕没有义务化（只有架构级 Decision；授权内"为什么选 A 不选 B、放弃项、近似判断"散落在 Handoff/报告里，不是契约）；③"复原"不是设计目标（有任务接续=Handoff，无 Agent 身份复原；ContextCompiler 按任务/角色编译，不是按"复原某个 working agent"编译）；④显式冲突表述：文档写"不要求建立独立 MemoryStore/常驻记忆 Agent"——你的想法要求"归属与聚合"增加工作维度（不建新存储），需写清边界，否则易被误读为要建 MemoryStore 而否决。

**② 具体任务设计（P1 票）**：没有，但有最近亲——P1-06 HandoffPacket（64KiB、无 transcript、保留工程轨迹+当前事实版本+语义提示来源、stale 检测）是全项目最接近"记忆包"的构件，但是任务接续包：字段只有 completed/unresolved/Evidence/Artifact refs/Workspace revision/来源，没有"取舍与理由"字段——正好缺你加的那一块。P1-03 TaskEnvelope 确立"Context 有界、transcript 不保存"，与"记忆=状态+取舍、非 transcript"完全一致，你的思路不碰这个不变量。P0/P1 没有任何"执行记忆归属/复原"契约；P1-15（角色协作整合）是收进它的第一个机会。

**③ 代码设计**：没有。Run/Attempt=单次尝试级生命周期（per-run sequence、after_terminal、lease）；Task/Attempt/Run 状态由 ReadModel 投影（P1-03/05 已实现）——有工作粒度的状态，但没有工作粒度的"执行记忆"（无 per-work 记忆对象、无取舍留痕写入、无复原接口）。已实现的记忆基础其实齐全（StateLedger 事件、ReadModel 视图、ArtifactVault 正文、HandoffPacket 接续）——缺的只是：按工作聚合的维度+取舍留痕写入义务+复原组装语义。

**④ 建议（对开发文档，最小改动顺序）**：
1. CONTEXT.md 加两个词条：Work Agent（绑定工作粒度、连续身份；生命周期=绑定到验收/归档；期间可多次 Run/Attempt、安全点换手与压缩）与 Work Memory（执行记忆）（工作范围内"当前事实+变更轨迹与取舍理由+未解项/经验"，按工作聚合、版本化、带来源；不新建存储；写入=普通记录路径，约束性变化走正式决定）。
2. ARCHITECTURE.md 记忆段：维度"项目"→"项目×工作"；语义提示从"知识产生者可记录要点"升级为"执行工作的取舍留痕（有界、带 scope/revision、非 Approval）"；明确"复原=ContextCompiler 按工作聚合状态+轨迹+取舍组装 Context；近似性为设计性质"。
3. runtime-collaboration/P1-06 扩展记录：HandoffPacket 增加"取舍/理由"引用（或多个 Decision 引用）的版本化扩展——"近似复原"的最小落点；assemble 增加 restore(workRef) 请求模式。
4. P1-15（或新 P1-16）：验收含"执行记忆（状态+取舍）在 Run 结束时必然留痕；协调者/新执行者可按工作复原"。
5. 开发流程：现在"文档即执行记忆"的手工事实写成显式规则——每票完成=状态记录（evidence）+取舍记录（decision-note/理由）+未解项（handoff）归档，即"该票 Agent 的执行记忆"；"新会话从票+证据+handoff 重建"就是"复原"的现行版本；"需求→文档→拆粒度→自动执行→取舍给人"整体上是产品（运行时）承诺的第一次 dogfooding——建议在 P0-06 里明确"开发流程=产品首个真实工作负载"，让产品 Task 设计以"开发粒度（ticket↔模块）"为真实输入。
6. 边界话（防误解）：执行记忆不是 MemoryStore、不是 transcript、不是常驻 Agent——它是"数据面按工作维度的归属+取舍留痕+有界复原"，与"不建立独立 MemoryStore/常驻记忆 Agent"完全不冲突。

改动集中四条线：CONTEXT（词条）→ ARCHITECTURE（记忆段）→ runtime-collaboration/HandoffPacket 扩展 → P1-15 验收，P0-06 审阅后动工。

---

### 第 14 轮

**用户问题（原文）**：
> 给我一个完整的包含我的输入的体现思考过程的回复，我要让另外一个agent去给出意见，给出修改建议

**助手答复（说明）**：
该轮给出了自包含评审材料《执行 Agent 生命周期与"执行记忆"（候选设计征求意见稿）》，含：用户立场摘要、思考过程推导链（包工头问题→问题转移→持久本体=状态+取舍→与现有不变量相容性检查→缺口分析（文档/任务/代码三层）→开发流程=手工版→任务图回应）、候选设计（Work/Work Agent/Work Memory/复原定义、L0-L4 生命周期分层、与秘书/参谋/书记/人/包工头/任务图的关系、落地映射表）、9 个开放问题（Q1-Q9）。

---

### 第 15 轮（本记录）

**用户问题（原文）**：
> 我的意思不是这样的，是把我的完整的问题，理解，以及你的历次回答形成一个md

说明：即本文件——《执行 Agent 生命周期与"执行记忆"：完整对话记录与历次答复》。

---

## 3. 讨论收敛出的候选设计要点（供评审快速定位）

1. Work（工作粒度）＝执行任务 Agent 生命周期与执行记忆的边界；产品侧≈Runtime Task（或强相关任务组），开发侧≈Ticket 覆盖的模块面。
2. Work Agent 生命周期：绑定→多次 Run/Attempt（暂停/换手/压缩）→验收/归档；结束时 Context 消亡、记忆留存。
3. Work Memory（执行记忆）＝当前事实+变更轨迹与取舍理由+未解项/经验，按工作聚合、版本化、带来源；不新建存储（数据面三侧面的工作视图+取舍留痕义务）。
4. 复原（Restore）＝新 Run 按工作聚合记忆+当前状态组装有界 Context；声明"近似复原"；不恢复授权/状态/完成权。
5. 生命周期分层（草案）：L0 单次调用→L1 Run/Attempt→L2 Work 周期（执行记忆的家）→L3 职责/RoleBinding 周期→L4 持久层（唯一真正长期）。
6. 书记＝执行记忆整理与汇报的职责视角（不命名新 Agent、不建存储）；秘书/参谋＝消费执行记忆做选项/影响/升级、派发调查与协调；人＝知情≠逐审批、复杂取舍升级、决定回写；包工头＝无常驻，按需实例化+从记忆复原；任务图＝允许不完美的可演进实体。
7. 兼容面：与"有界 Context/无 transcript/不建 MemoryStore/Claim 不构成完成/角色身份≠Run"均不冲突；需明确"工作维度聚合"≠"新 MemoryStore"，否则易被误读。
8. 缺口：文档有（三侧面、HandoffPacket 带轨迹/版本/提示来源、AgentInstance 身份），缺（工作维度聚合、执行级取舍留痕义务、复原组装语义、执行 Agent 生命周期显式模型、HandoffPacket"取舍/理由"字段）。

## 4. 遗留开放问题（供评审给出意见/修改建议）

- Q1 粒度：Work=Runtime Task？任务组？还是契约/模块变更单元？ticket↔模块一一对应是否必要（现票=穿过少量 Module 的纵向切片）？产品粒度与开发粒度如何对齐？
- Q2 留痕范围：哪些取舍必须留痕（升级给人的？授权内自治的？近似判断）？粒度（一句理由/对比项/放弃项/不确定度）？与"普通记录不逐条审批"如何划界？记录预算/上限？
- Q3 复原语义：谁触发（执行者/协调者/书记/人查询）？显式模式还是默认行为？近似度如何声明（时间+版本+缺什么）？是否也适用于秘书/参谋与包工头（跨 Work 汇总）？
- Q4 生命周期状态机：L0-L4 是否合理？Work Agent 状态机显式化到何种程度？与 TaskPhase（现有）/Attempt/Run（per-run sequence）的关系与冲突？
- Q5 与已验收语义：HandoffPacket 扩字段 vs 新契约？与"无 transcript/stale/lease/outcome_unknown 保留"的兼容推演？与"知识产生者主动记录要点"（L112）如何整合？
- Q6 组织与顺序：P1-15 vs 新 P1-16？P0-06 追加哪些接受项？概念（CONTEXT/ARCHITECTURE）与契约（接口/票）先后？
- Q7 dogfood："需求→文档→粒度→自动执行→升级"是否作为产品首个可运行场景（替代/增强现行手工编排者流程）？是否影响 P1 优先级与 G3 定义？
- Q8 风险：取舍留痕会否变成"记录负担"或"伪精确历史"？错误取舍会否污染未来复原？（缓解建议：保留原始证据引用、标不确定度、版本校验、复原仅为材料非事实/授权——是否足够？）
- Q9 命名：Work Memory/执行记忆/复原（Restore）与现有术语（ContextBundle、HandoffPacket、开发轨迹、语义提示）是否有歧义？有无更贴合词汇？

---

## 5. 主要引用位置（供核对）

- 产品：PRODUCT.md（承诺 6/角色协作/Human Collaboration/架构治理/MVP 门禁 L104/非目标 L115-116）
- 架构：ARCHITECTURE.md（L16 数据面、L23 语义协调、L69-70 PlanCompiler 与角色承载分离、L73-74 决策链、L100-114 记忆三侧面、L118 查询、L126 非大 Agent 循环、L136-144 协调与知情）
- 术语：CONTEXT.md（AgentInstance、Coordination Role、Execution Role、TaskHierarchy、Runtime Task）
- 设计与契约：dev_docs/design/human-framework-role-review.md（L26-40 角色收敛、L86 决策链、L94-98 交流与恢复、L100-112 小变更、L113-129 事件策略）；dev_docs/interfaces/runtime-collaboration.md（L17-19 角色绑定、L50-54 消息与记录、L56-62 查询反馈）；dev_docs/interfaces/human-design-status.md（初始设计/统一展示）
- 已验收实现：dev_docs/verification/p1-03/04/05/06-implementation-evidence.md（HandoffPacket 字段与语义、TaskEnvelope 64KiB 无 transcript、stale/lease/after_terminal/outcome_unknown）
- 开发流程：AGENTS.md、dev_docs/design/agent-entry-and-system-map.md、dev_docs/agent/P1-02-initialization-prompt.md（编排+集成者、lane 派发、子 Agent 不再派发其它 Agent）、dev_docs/logs/README.md（书记/秘书/参谋层标记载体）
- 规划：dev_docs/planning/proposed/P1-foundation/DAG.md（P1-15）、dev_docs/evaluation/mvp-scenario.md（Step 0 人与参谋确立初始设计；协调者据已接受计划组织工作）
