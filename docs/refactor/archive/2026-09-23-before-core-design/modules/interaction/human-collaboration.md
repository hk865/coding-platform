# HumanCollaboration Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Human Interaction
module: HumanCollaboration
code_dir: coding-platform/src/interaction/human-collaboration/
contract_state: first-slice draft
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> **面向人的统一入口**：目标／决定／查询／架构协商与接管**读**侧。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文。跨模块重复承载的切分见 [`../ownership-map.md`](../ownership-map.md)。

## 1. 职责

**负责**

- **面向人的统一入口**：把一次用户级请求转换为可审计 Command，并从 `ReadModelIndex` 返回可显示结果，让调用者不必理解 Command 构造、幂等重试或投影延迟（首切片：创建 Goal → 持久化 → 投影显示）。
- **人的确认是唯一生效点**：目标确认（§5.2 任务图生成方）、方案确认（§7.4.2）、决定受理，均以人的动作为生效点；本模块只提交命令并如实回执。
- **查询目标（未接）**：候选 `query(request) → fact／report／pending／unavailable／rejected` 复用已有 QueryRun／持久投影能力；**是否需要解释由请求指定，不强制先过参谋**；`unsupported`／`stale` 不自动伪装成最新回答。
- **交互会话**：保存人的请求／审阅与**重放 journal**（**实现态，非 canonical**）；**正文先入 ArtifactVault，成功仅以正式 Control 回执为准**。
- **两张图里本模块的那一片——图检索的读侧入口**：架构图检索／邻域查询／白板读取与统一侧栏读侧入口（D-6）。这是 `Interaction -.->|既有直连：图检索／邻域查询／白板读取| ReadModelIndex` 的**既有直连，不经 ContextCompiler**。
- **工作卡片与 Session 视图查询（I11 新增方向）**：角色名册、统一侧栏所需的 Session 与运行视图；**秘书恢复与方案解释的最小读接口先做薄实现**（§7.4.2）。
- **§7.4.2 秘书恢复、方案解释与确认的最小路径**：方案必须有**稳定引用与版本**（提案版本）并记录**所用来源与未决项**；解释与追问发生在**关联到该方案版本**的 Session 上；**解释 ≠ 修订**（解释不产生新提案，**不得再触发一次 `requestInitial`**；修订走 `request`／`accept` 的正式路径）；**确认必须绑定具体方案版本**，确认时版本已变化**不能静默接受旧内容**。
- **精简内部责任与共用实现**：人的请求统一经过同一套请求身份、错误映射、Control 回执解释与“已提交／已执行／失败或未知”呈现支持；各动作仍保留各自的正式命令、执行者和结果语义，不新建万能 Command 总线。现有 console 查询共用只读投影适配，方案解释复用既有 QueryRun／Session 派发能力。
- 归属阶段（架构稿 §4.1）：**创建**（人的确认是唯一生效点）、**运行**（人的决定与澄清回流）。

**问负责人不等于打断负责人（架构稿 §5.3，三条路径）**

| 场景 | 行为 | 是否动用该 Agent 的执行控制权 |
| --- | --- | --- |
| 查进度、阻塞、已接受决定 | **直接读持久状态与投影**（不调用模型：读已提交投影与 canonical 事实，返回来源与更新时间） | 否 |
| 需要解释，且负责人空闲 | **续用其 Session**，通过既有派发路径运行（经 `DispatchEngine.drive`）——**这是会调用模型的解释运行**，计入**该负责人 Session 的 Context 与预算**，等待方式为既有派发／等待机制 | 是（正常派发） |
| 需要解释，但负责人忙碌 | 用**已有只读查询能力／同一角色的新的独立 Session** 起一次**独立只读 QueryRun**（可调用模型；计入该 **QueryRun 自己的** 预算与 Context，不改变源 Worker 的预算／Context）；对原 Session 的咨询**异步等待** | 否（只读路径，不占用该 Agent 的执行控制权） |

**不可假装查询副本已经看到原 Worker 尚未落盘的内部状态**；未知信息仍可答"缺少什么、正在等谁"。**复用既有 QueryRun 即可，不新增问答模块。** 失败与降级必须显式：没有图能力时使用允许的源码／文本检索降级并**标明覆盖不足**；离线 Agent **不等于**该模块或图节点消失。

**人的直接控制与主动提醒：动作交接表（`docs/PRODUCT.md` §5.6、§7.12、§7.13）**

**动作与结果必须逐项交接，不能只靠统一 Command 入口**；下表逐动作写清谁接请求、谁受理、谁执行、谁提供提案与状态、谁呈现，以及**已提交／已执行／失败或未知**三态如何区分——**不要求先重做 UI**。

| 人的动作 | 1 接请求 | 2 正式受理 | 3 执行 | 4 提案／状态来源 | 5 呈现与提醒 | 三态区分 |
| --- | --- | --- | --- | --- | --- | --- |
| **暂停** | HumanCollaboration | ControlEngine（`submitControl`：desired state 先落盘） | DispatchEngine 停新派发 → WorkerRuntime 向 Kernel 提控制请求并回传结果 | 状态＝ReadModelIndex 投影；归约＝ControlEngine（`reconcileControlIntent`） | HumanCollaboration／Host 回执与提醒 | **已提交**＝Control 回执 `committed`；**已执行**＝运行回执被归约（`applied`）；**失败或未知**＝`rejected`／`outcome_unknown`，如实显示并继续核对 |
| **取消** | HumanCollaboration | ControlEngine（同一控制意图路径） | DispatchEngine／WorkerRuntime（`unsupported` 时如实返回，不伪造） | 同上；未完成处置由 HumanCollaboration 展示 | 同上 | 同上；`unsupported` 不得显示为已取消 |
| **换人** | HumanCollaboration | ControlEngine（`recordUserDecision`／`claimReplacement` 一类既有命令） | DispatchEngine 派发后继 Run；WorkerRuntime 承接执行 | **AgentLifecycle 提供替换提案**（参与／替换建议）；ReadModelIndex 提供状态 | HumanCollaboration／Host 展示责任关联变化与交接来源 | 提案／受理／执行分开；**已交接**与**仍悬空**必须可辨 |
| **追加要求** | HumanCollaboration | ControlEngine（受理为正式事实或计划修订请求） | 视范围经 PlanCompiler 修订提案／DispatchEngine 的既有派发路径 | ReadModelIndex 提供当前计划与状态 | HumanCollaboration／Host 回执 | 已受理／需重新确认／被拒绝分别显示 |
| **主动提醒** | HumanCollaboration（含 Host 转发） | ControlEngine（正式事实归约；提醒请求本身不是状态） | DispatchEngine／WorkerRuntime（需要执行时才触发） | **ReadModelIndex 提供状态**（提醒只引用正式事实，不推测） | **HumanCollaboration／Host 呈现提醒**（如阻塞、未决决定、失败与未知） | 已提交／已送达／失败或未知分别标注；**提醒不代替完成判定** |

**本次变化方向**：见第 7 节。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| 拥有 Goal／Task／Plan 状态 | **ControlEngine**（canonical 归约）+ **StateLedger**（原子提交）；投影在 **ReadModelIndex** |
| 执行产品级规划、调度、验证或 Agent 通信 | **PlanCompiler**（规划）／**DispatchEngine**（派发）／**VerificationEngine**（验证编排）／**ControlEngine**（受理与路由） |
| 决定 revision guard，生成 Domain Event | **ControlEngine**（守卫与 snapshot／Event 生成）+ **StateLedger**（提交） |
| 渲染具体 Web／桌面 UI | **Host**（`src/app/**`、`src/ui/**`）；本模块只给读接口与结果形状 |
| **治理显示读取** | **已移入 ReadModelIndex**（`GovernanceViewPort`／`PolicyExplanationPort`）；本模块不新增治理读取实现 |
| 直接写 canonical 或 Read Model | **ControlEngine** 命令 + **StateLedger**；UI／Todo／Plan Matrix／Timeline 都是 ReadModel，不接受直接状态写入（#4） |
| 裁决完成 | **ControlEngine**（`CompletionPolicy`）；Run 终态不等于 Task／Goal 完成 |
| 需要解释时先过参谋 | **不需要**：是否需要解释由请求指定；参谋只转交工具结果也可 |
| 把报告文字当正式状态 | 正式状态只能来自 ReadModel；报告与解释另行标识来源（`unverified_report`／`observed_fact`） |

## 2. 对外接口

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `createGoal(request)`（现状） | Host／UI | `CreateGoalRequest` → `persisted(goalId, commitCursor)`／`rejected` | 只有 Control `committed` 才是 `persisted`；固定错误映射；幂等重试复用原 `CommandIdentity` | 保留真实接口；旧调用不迁移 |
| `goalView(query)`（现状） | Host／UI | 带 `projectId` 的查询、可选 `atLeastCursor` → `GoalViewResult` | 未达游标返回 `not_ready`；不得旁路回填或把提交当成已投影 | 保留真实接口；旧调用不迁移 |
| `query(request)`（目标契约未接；复用已有 QueryRun 机制） | Host／UI | ① 持久状态查询 → `fact`；② 独立只读 QueryRun → `report/pending`；③ 原 Session 解释运行 → `report/pending`；共同可返回 `unavailable/rejected` | ①不调用模型且无预算/Context 副作用；②只改变独立 QueryRun 的预算/Context；③向**原 Session**追加解释消息并计入该 Session 预算/Context。三类都不得向一个正在执行的**源 Run**注入消息或改变其 lease／任务义务；report 带来源、版本、时间和未验证标识 | 当前无同名生产接口；目标复用现有 QueryRun/派发机制，不新增查询总线 |
| `WorkSessionViewPort.query`（目标候选，未冻结、未实现） | Host／UI | 项目/工作范围、筛选、游标 → 角色卡片、Session/Run 视图、更新时间或未就绪 | 只读、不调用模型；归档默认隐藏且只读保留；派发仍以 canonical 事实复核 | 给 I11 可引用候选名；现有 `goalView`/`console*` 保持可用，逐步转向该聚合视图而非复制存储 |
| `PlanExplanationPort.explain`（目标候选，未冻结、未实现；也可复用已区分语义的 `query`） | Host／UI | 方案引用与**具体版本**、追问 → 带所用来源/未决项的回答或异步运行引用 | 解释不生成新提案、不重触发 `requestInitial`；解释留在关联 Session、产生消息与预算；确认继续走既有 `accept`/Control 路径并必须绑定具体版本，版本变化即拒绝静默接受 | 复用既有 QueryRun／Session 派发，不新建模型循环或万能门面 |
| `SessionControlPort.request`（目标候选，未冻结、未实现） | Host／UI | 暂停／取消／换人／追加要求 + 目标引用/请求身份 → 正式受理 receipt + 可查询的执行状态引用 | 本模块只接请求与呈现；Control 正式受理/归约，Dispatch/Runtime 执行，AgentLifecycle 提替换建议；受理回执与执行结果分开呈现，精确状态沿用后续契约 | 四类动作获得可引用入口；旧命名命令和既有 `drive` 路径继续使用，迁移时不得合并各动作语义 |
| `amend(request)`（现状） | Host／UI | `AmendGoalRequestV1` → `accepted/needs_material/rejected` | 提案不原地改写；旧材料授权不得自动沿用 | 保留；修订走既有 PlanCompiler/Control 路径 |
| `ExplorationSessionPort`（现状） | Host | 探索会话查询 → 会话视图与已持久材料 | Dispatch 在执行侧直接读持久材料，**不回调此 Human 提供面** | 保留 Host 入口；不新增 Dispatch→Human 反向边 |
| `HistoryMaterialPort.view/grant/revoke/read`（现状） | Host | 人的材料查看/授权/撤销/读取 → 材料、正式 receipt 或读取结果 | 列出/选择不授予权限；授权适用性由 Vault/Control 既有路径判定 | 保留 Host 入口；`HistoryMaterialContextPort` 是本模块消费的 Context 端口，归 §3 |
| `ArchitectureReviewEntry.report/decide`（现状实现类，公共 Port 尚未命名） | Host | exact Brief/Proposal/Candidate、人的四种选择 → 正式回执/视图 | 修改另建提案；重放绑定请求身份；接受不激活基线 | 保留真实 Host 调用；待后续契约为实现类补窄 Port，不在本轮伪造名称 |
| `ArchitectureDecisionPort.decide/recordGate/recordActivation`（契约已命名，**尚未接线**） | 基线演进集成者／Host | 一条不可变的架构变更决定、迁移门禁结果、基线激活请求 → 正式回执 | 人的决定绑定精确候选与目标；拒绝／延后／越权或目标不匹配**不得激活**；签发记录与 CAS 激活仍归 Control | 【契约未接】（`src/contracts/baseline-evolution.ts`）；与 `ArchitectureReviewEntry` 的审阅入口是两条不同流 |
| `console*` 只读查询族（现状） | Host／UI | 查询 → portfolio/summary/plan matrix/agents/evidence/timeline | 只消费 ReadModelIndex；无模型调用、不刷新租约 | 保留；后续可作为 `WorkSessionViewPort.query` 的薄适配，不强制立即改名 |

**实现映射（不提升为新公共承诺）**：`contracts/modules.ts` 承载 `createGoal`／`goalView`／`amend`，`contracts/exploration-session.ts` 承载探索会话，`history-materials.ts` 承载历史材料端口，`architecture-review.ts` 承载架构审阅流程，`contracts/console-views.ts` 承载 console 查询族。上述入口供 Host/UI 使用；Dispatch 读取已持久材料，Context 是本模块消费的依赖，二者均不反向调用 Human。目标候选名只为下阶段引用，不能据此宣称已有实现。

**本次变化方向**：见第 7 节。

## 3. 依赖

覆盖 `allowedModuleDependencies[HumanCollaboration]` 的全部 7 条边（架构稿 §3）。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| **PlanCompiler** | `request(intent)`／`requestInitial(intent)`／`accept(resultRef)`；`amend` 经其产生有界提案与影响 | 计划／修订提案、所用来源与未决项；**解释不得再触发一次 `requestInitial`** | 既有 |
| **ControlEngine** | `submit(command)` 与命名命令族（`applyPlanChange`／`recordUserDecision`／`grantMaterialAccess` …）；`CommandReceipt` | 正式受理与回执；**成功仅以正式 Control 回执为准**；人的决定经此落账 | 既有 |
| **ReadModelIndex** | 既有 `goal(query)`／`planGraph(query)`／`mailboxView()`／`console*`；目标候选 `WorkSessionProjectionPort.query`／`ArchitectureGraphQueryPort.neighborhood` | 工作卡片／角色名册／统一侧栏所需的 Session 与运行视图；**单列消费阻塞、未决决定、失败/未知等结果/通知投影，主动提醒不是 `SessionControlPort.request` 控制动作**；图检索也走投影。治理显示读取已移入 ReadModelIndex，由 Host 消费 | **既有边，消费内容扩展**（I6／§3.2）；新查询候选未实现 |
| **DispatchEngine** | `SnapshotPort.snapshot`（已有契约，默认 Host stub，真实转发未接）；`ExplorationContextDrivePort.prerequisites`；人的控制请求经既有 `drive` 路径执行 | `PublicSnapshotQueryV1` → `PublicSnapshotResultV1`；目标由 Dispatch 适配 Runtime 的 `HandoffControlPort.snapshot`，两端 wire 形状不同；探索前提与解释/控制执行交接 | 既有 Human→Dispatch 边；快照契约已有，不能写成转发已实现或另造同用途 Port |
| **ContextCompiler** | 有界材料端口：`ExplorationSessionContextPort`、`HistoryMaterialContextPort`；查询材料 | 材料与来源清单；本模块把候选数据交它解析来源与精确授权依据 | 既有（**图检索不经它**） |
| **VerificationEngine** | `ExplorationReportPort`／`RecordedVerificationPort`；其他问题展示由 Host 适配 | 报告是否具备正式资格；本模块**不裁决完成** | 既有 |
| **ArtifactVault** | `put(record)`；`open(ref, accessScope)` | 交互正文先入 Vault（人的请求／审阅）；授权与适用性由 Vault 判定 | 既有 |

## 4. 被依赖

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| **（无 Module）** | — | 本模块**不被任何 Module 依赖**：DAG 反向表中该行为空 | 架构稿 §3 依赖 DAG 的反向推导 |

> **宿主边（不计入 38 条）**：`src/app/**`／`src/harness/**`／`src/composition/**`（`owner()` 记为 Host）与 UI（`src/ui/**`）调用本模块；工作台经服务消费正式模块结果。**宿主与 UI 的调用不是 Module 间依赖边**，因此"被依赖：无 Module"与"存在真实消费者"并不矛盾。

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| Goal／Task／Plan 状态 | **是（canonical）** | **ControlEngine** 归约 + **StateLedger** 原子提交；**本模块不拥有** | 创建／运行 |
| `GoalViewResult` | 否（**投影**） | **ReadModelIndex**；正式状态只能来自 ReadModel，**不能从成功文案、模型记忆或本地表单状态推断** | 创建／运行 |
| 人的决定（`RecordUserDecision`） | 是（canonical） | **ControlEngine** 归约；本模块只提交命令并返回回执 | 创建／运行 |
| 暂停／取消／换人／追加要求的控制意图与结果 | 是（canonical：ControlIntent 与 `ControlIntentReconciled`） | **ControlEngine** 受理与归约；执行＝DispatchEngine／WorkerRuntime；替换提案＝AgentLifecycle；本模块只接请求、提交命令并如实呈现**已提交／已执行／失败或未知** | 运行／挂起·恢复 |
| **交互会话**（人的请求／审阅与**重放 journal**） | 否（**实现态，非 canonical**） | **本模块**（`interaction/human-collaboration/**`） | 运行 |
| 方案（提案）版本、所用来源与未决项 | 是（提案事实） | **PlanCompiler** 产出、**ControlEngine** 记录；本模块只读、展示、关联 Session | 创建／运行 |
| **人的确认** | 是（**唯一生效点**） | 人的动作；**必须绑定具体方案版本**，版本已变化不能静默接受旧内容 | 创建／运行 |
| 交互正文 | 否（正文） | **先入 ArtifactVault**；成功仅以正式 Control 回执为准；保存正文后提交失败只留下未被采纳的 Artifact | 运行 |
| `commitCursor` | 否（**回执**） | **StateLedger** 的提交回执；`CommitCursor` 为 opaque | 创建 |
| 架构图检索／邻域查询结果 | 否（**投影**） | **ReadModelIndex**；图上的摘要不是事实本身，必须能回到来源核验（#22） | 运行 |

**本模块拥有的对象**：交互会话（人的请求／审阅与重放 journal，实现态）；面向人的入口与读侧结果形状。**不拥有 Role／Session／Run／Work 的任何 canonical 状态。**

**本模块不拥有的**：Goal／Task／Plan 状态；revision guard；Domain Event；完成裁决；材料授权判定；Session／Run 身份；UI 渲染。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**——本模块只**读投影**呈现，不写四态。

## 6. 旧标识去向

**本模块不持有旧 Agent／Work 标识**（`agentId`／`workId`／`WorkContextBinding`／`AgentInstanceStatus` 及 `retired` 字段），无需迁移动作。理由：这些标识的**写路径**在 **ControlEngine**（`registerAgentInstance`／`startWorkParticipation`／`bindWorkContext`）与 **StateLedger**，**读路径**经 **ReadModelIndex** 投影；本模块只做"人的入口 + 读侧呈现"，不写也不持有它们。

但属于本模块的那一部分必须表态：

1. **`agentId` 有消费者时保留轻量标识**——**工作卡片／角色名册读侧就是这样的消费者**；不为它扩建跨任务长期身份体系。
2. **`workId` 不先宣布必需**：工作卡片按"**负责哪个模块 + 当下状态**"的 JD 式逻辑呈现（用户原话 12），不把 `workId` 当卡片主键；若后续出现明确消费者再保留，是否与 `taskId` 合并按架构稿 §4.5 处理。
3. **四态不进 `AgentInstanceStatus`**：`working`／`standby`／`paused`／`archived` 由 Session 元数据与工作卡片**用现有记录与查询生成**；本模块的卡片是只读投影，**不写四态**，也不扩写 `AgentInstanceStatus`。
4. **`workId`／`agentId` 的展示不引入新权威**：卡片上的"当前关联哪些 Session"是**日常事实**（结构入治理、关联不入治理），本模块只消费 **ReadModelIndex** 的查询结果，不新增审批或注册仪式。

## 7. 本次接口变化方向

对应项号：**I11（＋I6 消费面扩展）** ｜ 接口名：候选 `WorkSessionViewPort.query`／`PlanExplanationPort.explain`／`SessionControlPort.request`（均未冻结、未实现）｜ 方向：向 Host／UI 提供工作卡片与 Session 查询、绑定具体方案引用与版本的解释、指定范围与动作的控制请求及正式受理回执；读侧扩展消费 ReadModelIndex，解释复用已有 QueryRun／Session 派发，解释与修订／确认分离，控制受理与实际执行结果分开 ｜ 边动作：**保留**本模块 7 条依赖，目标 DAG 仍为 38 条逻辑边；`HumanCollaboration → ReadModelIndex` 只扩展消费内容，不新增总线或 `HumanCollaboration → WorkerRuntime` 直连 ｜ 理由：秘书恢复、统一侧栏与具体方案解释需要可引用的读侧入口；解释不能重新生成或应用方案，控制受理不能冒充执行成功 ｜ 不变量：**#4／#22／#19**（正式显示来自投影；摘要可回到来源核验；归档默认隐藏且只读保留，解除归档后重新检查权限与材料有效性）。

**实现与迁移补充（不替代上述交接行）**：共用请求身份、错误映射、正式回执解释与只读投影适配；保留三类 query 的模型、预算、Context 与等待副作用，以及暂停／取消／换人／追加要求四类控制动作的受理、执行和结果差异。主动提醒单列为 ReadModel 结果／通知投影消费。

**旧路径去向**：`createGoal/goalView/amend`、`console*`、`ExplorationSessionPort`、`HistoryMaterialPort` 和 `ArchitectureReviewEntry` 继续可用；具体版本确认继续走 accept／Control。Dispatch 的 `SnapshotPort` 沿用既有 query-job 契约，待接的是 Dispatch→Runtime 适配；它属于 §3 消费面，不成为 Human 公共接口。

## 8. 信息缺口

**对齐架构稿 §11.4.3（引用，不重新推导）**

- **① 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、旧标识兼容映射）** → 架构稿 §9.2 第 1 份契约：决定工作卡片能引用哪些标识。
- **② 各 Port 的精确形状、字段命名、装配点** → 架构稿 §9.2 第 2／4 份契约：`query(request)` 与工作卡片／Session 视图查询端口尚未冻结。
- **③ 工作卡片与三种记录的查询接口、筛选字段** → 架构稿 §9.2 第 3 份契约（**本模块主要相关项**）：角色名册、统一侧栏、卡片筛选字段都在这里定。
- **⑤ 草案承载形态与转换门禁判定者；探索计划的 UI 入口是否开** → 架构稿 §9.2 第 1／4 份契约：影响探索会话面与"原地替换"入口。

**本模块新增缺口**（§11.4.3 未覆盖）

- **完整秘书／参谋对话与跨工作包协调仍缺**（`module-status.md` 的 12 Module 审查行）：现有实现是 Goal 创建／查询、探索审阅与历史授权入口，**不能把首切片类型当作完整产品入口**。
- **工作卡片与 Session 视图查询尚未实现**（I11 新增面）：目前无对应的生产查询端口；`goalView` 仍**只返回已定义的 Goal 投影**，不混入未验证的执行者报告。
- **扩展查询需分别声明回答种类、来源、时效和权限**：`query` 的 `fact／report／pending／unavailable／rejected` 结果集与"未验证标识"字段仍在候选状态。
- **自然语言 Intent 编译与 Advisory 留给后续**：首切片只接收**已经提取出的结构化 objective**。
- **交付顺序（§7.4.2）**：**秘书恢复入口与 Agent 侧栏读接口可以先做薄实现，不应一并后置到 UI 完整改版**；本页按此把最小读接口与完整 UI 改版分开登记。
- **动作交接的端口与生产路径尚未冻结**：§1 已给出暂停、取消、换人、追加要求、主动提醒五段归属（接请求／受理／执行／提案与状态／呈现）与三态（已提交／已执行／失败或未知）口径，对应端口形状与生产实现仍待落地。
- **`query` 三类副作用的端口形状尚未冻结**：§2 已分别声明持久状态读取、独立只读 QueryRun、原 Session 解释运行的模型调用、预算与 Context 影响与等待方式，精确端口形状与实现属后续契约。
- **快照转发的装配未明确**：本模块消费既有 `SnapshotPort.snapshot`（query-job 契约），Host 当前默认 unsupported；目标由 DispatchEngine 适配 WorkerRuntime 的 `HandoffControlPort.snapshot`，两者形状不相同，真实转发未接。作用域与错误映射属架构 §9.2 第 2／4 份契约。
- **目标变更的未完成处置展示未实现**：受影响工作、已停／待停 Run、迟到结果的展示面尚无实现；本模块不代行停派与控制。
- **N-7（本目录 `README.md` §5.2）**：`module-status.md` 没有统一状态标签体系，本页只能用架构稿 §2 的 `契约状态` 列 ＋【代码】／【契约未接】标记，无法引用机器可读的模块状态。

## 9. 重构目标与质量验收

通用依据：[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。本轮已把职责、接口与旧路径要求写入本文；源码是否完成收敛及成本改善仍须按真实 Host 接线与用户路径验证。目标仍为 13 Module／38 条逻辑边；当前源码基线 12 Module／34 条边不因本章改变。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| `query` 尚无同名生产接口；§1 三类查询的模型、预算与 Context 副作用不同 | 复用既有 QueryRun、ReadModel 与 Session 派发，候选 `WorkSessionViewPort.query`／`PlanExplanationPort.explain` 不冻结 schema；解释不重新提交计划 | `goalView`／`console*` 继续服务现有调用；后续只抽取请求身份、错误映射与结果呈现，三类副作用保持可区分 | 三类场景分别证明模型调用、预算/Context、等待和错误结果；当前为**待实现／待验证**（RG-01、RG-04；CQ-01、CQ-03、CQ-06、CQ-08） |
| 暂停、取消、换人、追加要求涉及 Human、Control、Dispatch、Runtime；§1 已列动作交接 | `SessionControlPort.request` 仅为未冻结候选；受理 receipt、执行状态与失败/未知必须分开，主动提醒单列读投影消费 | 共用请求身份与回执解释；旧命名命令及 `drive` 保持可用，迁移后才能退役重复适配，不建万能 Command 门面 | 每个动作从 Host 入口追到正式受理和执行结果，`unsupported/outcome_unknown` 不显示成功；当前**待实现／待验证**（RG-02～RG-05；CQ-02～CQ-04、CQ-06～CQ-08、CQ-12） |
| §3 `SnapshotPort.snapshot` 已是 query-job 契约，但 Host 默认 unsupported，Dispatch→Runtime 转发未接；Handoff wire 不同 | 保留现有 `SnapshotPort` 输入输出与失败语义；目标只在 Dispatch 内适配 `HandoffControlPort.snapshot`，不新增 Human→Runtime 边 | Host stub 在真实转发接通前继续诚实返回 unsupported；不得把 Handoff Port 政名为 Human 公共面或并存为第二权威 | Host stub、Dispatch 适配及 Runtime provider 的契约/接线证据分别核对；当前转发**待实现／待验证**（RG-01、RG-03、RG-04；CQ-01、CQ-03、CQ-04、CQ-08、CQ-12） |
| `ArchitectureReviewEntry` 目前由 Host 直接消费实现类，尚无命名窄 Port；工作卡片／方案解释候选面仍待接入（§2／§8） | 保留真实 `createGoal/goalView/amend`、console、探索、历史材料与架构审阅行为；只在有真实消费需要与迁移方案时收窄实现类 | 现有消费者不迁移即不删除；候选工作卡片面只聚合 ReadModel，不复制状态；知识/记忆仍是未交付方向 | 入口→调用链→用户可见结果清单、消费者迁移表及无新增反向边检查；接口收窄**待设计**（RG-01、RG-04、RG-05；CQ-01、CQ-03、CQ-11、CQ-12） |
