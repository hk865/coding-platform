# ControlEngine Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Control
module: ControlEngine
code_dir: coding-platform/src/control/control-engine/
contract_state: first-slice draft（扩展面极宽）
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> canonical 状态的唯一推进者与守卫：一切正式事实都经它的守卫、CAS、幂等与归约，再作为一个原子提交交给 `StateLedger`。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文。

## 1. 职责

**负责**

**内部责任与共用实现。** 各命令族继续拥有自己的业务守卫、expected-version 集合与归约；模块内部新增/复用一套提交支持，统一 Ledger 回执映射、适用的快照类型守卫和机械事件构造。`initial-plan-admission`、角色绑定准入等政策仍由 ControlEngine 拥有并以窄公开面供合法消费者复用；纯函数形态不改变业务权威归属，也不下沉 Contracts。

- **canonical state 的唯一 transition authority**：命令 → schema／幂等／expected-version 守卫 → snapshot／Event 构造 → `StateLedger` 原子提交（见架构稿 §7.3「原子提交路径」；不变量 #1／#3）。`committed` 回执只在 Event 持久提交后返回。
- **五阶段的状态归约与守卫**（见架构稿 §4.1）：阶段 1 创建——需要时归约 `registerAgentInstance`（CAS@0）／`startWorkParticipation`，按当前生效矩阵 pin 的绑定**不代替守卫**；阶段 2 初始化——只做**接受**（候选结构与来源 pin 落正式状态），派发与执行不在此；阶段 3 运行——`RunSnapshot.status` 由纯函数 fold 归约、租约与幂等权威在此；阶段 4 挂起·恢复——归约控制意图与自身状态同步；阶段 5 销毁＝归档——归约归档事实、**不删除**任何模块或图节点。
- **四动作的受理与归约**（见架构稿 §4.2）：产生（需要时才登记）、拆解（受理任务集与指派、义务与 DAG 推导权威）、压缩（接受结果、归约正式状态）、归档（归约 `archived`）、重新启用（走既有 handoff／continuation 路径）。
- **Goal phase 与 TaskReduction phase 的唯一写者**：`reduceGoal` 只写 GoalPhase（`GoalCompletionGuard` 非空检查），`reduceTask` 只写 TaskReduction phase（`TaskSatisfied` 纯函数公式）；两者互不越界。
- **目标变更的受理与控制意图**：受理 PlanCompiler 的影响与**未知项**，确定**停派状态**、**控制意图**与**迟到结果守卫**；**影响范围无法确定时先暂停该 Goal 的新派发**（不把"暂时不知道"当作"没有影响"）；**无关 Run 继续**；迟到 Evidence 与旧 Run 结果**只有通过新版本适用性检查后才能推进当前状态**（`docs/PRODUCT.md` §5.5；控制交接的执行在 DispatchEngine／WorkerRuntime，本模块只受理、归约与守卫）。
- **归档的受理复核**：归档提案由 AgentLifecycle 携带**义务处置依据**提出，本模块受理时复核——**存在未完成交接则不能正式归档**（`docs/PRODUCT.md` §7.1 动作表「归档」行；#19）。
- **准入读取路径的成本改造（架构稿 §9.2「必须先改」第 6 项）**：本模块承担**准入读取路径**的改造——`run-facts` 的 Delivery 扫描、状态查询反复触发的 currentness 检查与全工作区快照；输出必须是**有界**的准入读取（不随事件数累计扫描）；运行日志的增量存储由 ArtifactVault 承担、写入与查询接线由 WorkerRuntime 承担，验收以真实连续任务的累计读取／扫描量观察，**不以文件数或代码量声称收益**。【设计新增】
- **治理写入的唯一命令族**：五种治理种类（CompletionPolicy／ArchitectureBaseline／CoordinationPolicy／ArchitectureEvolutionPolicy／**RoleSpecRevision**，第 5 个种类）只经 `install`／`activate` 的版本化 source + CAS 路径落账，无内置默认值（不变量 #11）。
- **租约权威**：`acquireWorkspaceReadLease`／`acquireWorkspaceWriteLease`／`releaseWorkspaceLease`；唯一 Writer = WorkspaceWriteLeaseIndex CAS（不变量 #7）；租约持有者是 **Run**（`TaskLeaseSnapshot.holderRunId`），后继 Run 重新获取。
- **控制意图的终态归约**：`submitControl`（desired state 先落盘、无副作用直到运行回执）／`reconcileControlIntent`（只消费已持久 Run 事实，保留 `applied`／`rejected`／`outcome_unknown`，未变化不写入）／`recordSafePointAck`。
- **协调面的正式写路径**：`registerAgentInstance`／`startWorkParticipation`／`endWorkParticipation`／`sendDirectedRequest`／`respondDirectedRequest`／`mailboxView`／`grantMaterialAccess`（经 `CoordinationControl` 暴露）；消息正文先入 ArtifactVault，本模块只校验并登记引用与路由事实，大正文不进 reducer。
- **工作身份权威**：`bindWorkContext`（唯一性由权威解析守卫 + Ledger 提交约束共同保证，不依赖调用方先查）、`linkWorkRun`、`resolveTaskWorkIdentity`（零写入的权威只读解析）。唯一键是**四元组 `(projectId, workspaceId, goalId, taskId)`**；`taskId` 取**返工替换链的起源任务标识**，链上任一承担者收敛到同一身份。**两个 Goal 下的同名 Task 不互相碰撞**（`src/contracts/task-work-identity.ts`；StateLedger 的 `identity_claims` 槽同键）。
- **返工受理与只读解释**：`acceptReworkProposal`（触发源是已提交结论／落在 `inScopeRework`／预算未耗尽／人未拒绝，四条同时满足才以 system 身份落账）；`ControlReworkDisposition.projectIssues` 是义务处置的只读解释入口，canonical 版本移动返回 unknown 且不提交状态。
- **两张图的写入侧那一小片**：结构归约与关联写入（任务图结构在 `applyPlan`／`applyPlanChange` 接受为正式 PlanRevision；架构结构经 `recordArchitectureInspection`／`recordArchitectureFinding`／`recordArchitectureDecisionBrief`／`recordCandidateBaselineProposal` 落账）。图查询投影不在此（见 `docs/refactor/modules/ownership-map.md`）。
- **四态的 canonical 归约侧**：归档＝显式操作、经既有记录落账（见架构稿 §4.6）；四态本身是 Session／工作卡片状态，不在本模块持久字段里（见 §5、§6）。
- **只读解释与能力受理的两个既有出口**：`PolicyExplanationPort`（由 `ControlPolicyExplanation` 实现：无 I/O、无 commit、不能授权执行）与 `ConfiguredWorkspaceCapabilityPolicy`（实现 `WorkspaceCapabilityPort`：显式支持配置 ∩ `envelope.permissions`，不回调活 Runtime，缺配置返回 `unsupported`）。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| **不自行选人**：用哪个角色配置、创建还是复用哪条 Session、关联哪些必要任务 | AgentLifecycle 决策 + 当前生效矩阵 pin；绑定由 DispatchEngine 的 `issueMatrixRoleBinding` 签发（架构稿 §4.1 阶段 1） |
| **不再承担 AgentLifecycle 的目标职责**（创建／复用／上下文处置的唯一决策落点） | AgentLifecycle（架构稿 §9.1 本模块「收窄」列）；本模块只归约其提案 |
| 不 fold 事件重建 canonical snapshot、不持久化、不管理版本与原子性 | 无模块以事件重放重建 canonical snapshot；`StateLedger` 只做持久化与原子提交：`load`／`commit`／`events` |
| 不投影、不做查询视图、不做工作卡片 | ReadModelIndex：`advance(page)`／`goal(query)`／`planGraph(query)` |
| 不选材、不做材料来源适用性检查、不产出 `selectedRefs`／`gaps`／manifest | ContextCompiler（五类触发点的有界选材，架构稿 §6.2） |
| 不规划 Task、不生成候选计划、不组织语义协调 | PlanCompiler：`request`／`requestInitial`／`accept` |
| 不派发、不启动 Run、不调用 Kernel、不管理 outbox 执行顺序 | DispatchEngine：`drive(trigger)` |
| 不验证完成、不组织检查轮次与 Reviewer 材料 | VerificationEngine：`verify(intent)`／生产入口 `VerificationService.verify` |
| 不运行工具、不探测／不声明运行期能力 | WorkerRuntime：`RunPort.capabilities`；本模块只记录**观测到的** `ContextContinuationResult` |
| 不裁决架构漂移、不计算图差分 | ArchitectureReconciler：`inspect(intent)` |
| 不解释自然语言、不渲染用户反馈、不接收人的直接输入 | HumanCollaboration：`createGoal(request)`／`amend` |
| 不写正文、不判定材料授权适用性 | ArtifactVault：`put(record)`／`open(ref, accessScope)`（授权由 Vault 判定） |
| 不读源码正文、不做路径边界读取 | WorkspaceReader（内容经 ContextCompiler 取材） |
| 不把资源不足或 Adapter 故障改写成业务失败 | 如实返回 `unavailable`／`unsupported` 并指名缺失项；不静默降级 |
| 不做跨项目复用判定 | AgentLifecycle（首版不做；跨项目请求**显式拒绝并说明原因**） |

## 2. 对外接口

**接口命名口径**：以真实方法名为主（`contracts/modules.ts` 的 `ControlEngine`／`CoordinationControl`）；架构名义名 `ControlEngine.submit(command)` 与真实入口 `submit(command: CreateGoalCommand)` 对照。**I4 待定**：命名命令端口 vs 统一命令入口的选择见 §7。

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `submit`／`bootstrap`（现状） | HumanCollaboration／宿主初始化 | Goal 创建或 workspace bootstrap 命令 → 结构化回执 | schema、幂等、CAS 与空库守卫；拒绝零写入 | 保留现状；`submit` 仍只是 CreateGoal first-slice，不冒称统一命令总线 |
| `install`／`activate`（现状） | 治理安装与基线演进适配 | 版本化治理 source/CAS 激活 → 回执 | #11/#13；revision 不可变、无内置默认 | 保留五类治理路径 |
| `applyPlan` 及计划变更/返工受理面（现状） | PlanCompiler／HumanCollaboration／DispatchEngine | 计划或决定 → PlanRevision/变更受理回执 | 固定 baseline/CompletionPolicy；不满足自动受理边界则 `needs_human_decision` | 保留；初始方案增加具体版本确认复核是目标，旧直应用路径迁出 |
| 派发/运行面 `dispatchReadiness`、`claimTask`、`startRun`、`runFact`（现状） | DispatchEngine | 资格、claim、envelope、运行事实 → 准入/运行回执 | claim+租约+attempt+run+outbox 原子；outbox started 后才允许副作用；no-regress | 保留并复用统一提交支持 |
| 验证与归约面 `submitEvidence`、`reduceTask`、`reduceGoal`、`recordPatch`（现状） | VerificationEngine／DispatchEngine | Evidence、reduction、patch → 提交回执 | Evidence 不可变；Task/Goal 唯一写者；冲突显式、body-first | 保留并复用统一提交支持 |
| Handoff、租约、控制与 continuation 面（现状） | DispatchEngine／Host 控制入口 | packet、租约请求、控制/安全点/接续观测 → 回执 | 迟到结果、holder-only、unknown 与 unsupported 如实保留 | 保留；Runtime 观察经 Dispatch 回交，Control 只归约，不生成 Kernel 事实 |
| 协调与工作身份面（现状） | DispatchEngine／PlanCompiler；AgentLifecycle【目标消费者】 | 参与、消息、授权、绑定/Run关联、身份查询 → 回执或权威解析 | 身份四元组唯一；读取不完整返回 unavailable；绑定签发不代替 guard | 重复选择决策迁入 AgentLifecycle，权威身份解析与归约保留在 Control |
| `ControlReworkDisposition.projectIssues`（现状公开入口） | VerificationEngine／DispatchEngine | 权威事实＋原始问题 → 问题处置解释 | 只读、不 commit；版本移动时保留未知 | 保留窄公共政策面，共用权威实现 |
| `PolicyExplanationPort`（现状公开入口） | ReadModelIndex／Host 解释适配 | 投影材料 → 证据适用性／有效集合与计划变更解释 | 只读解释不授权、不替代正式 reduction | 保留，业务政策不下沉 Contracts |
| `WorkspaceCapabilityPort.capabilitiesFor`（现状；实现 `ConfiguredWorkspaceCapabilityPolicy`） | Host 装配；本模块受理逻辑 | `TaskEnvelopeV1`＋支持配置 → 能力受理结果 | 缺配置 unsupported；不调用活 Runtime，不等于实际 Kernel/沙箱预检通过 | 保留 Control 政策归属；删除旧文档误列的 Runtime 提供关系 |
| 架构记录面（现状） | ArchitectureReconciler／基线演进适配 | inspection/finding/brief/candidate/review → 提交回执 | pin-only、CAS、不可变；不伪造 raw delta | 保留并复用统一提交支持 |
| QueryJob 面（现状） | PlanCompiler／DispatchEngine／HumanCollaboration | query intent、领取、回答、关闭 → 回执/视图 | 不写源 Run phase；stale/gap 如实标记 | 保留现有协调链 |
| 生命周期命令与 reducer 输入（目标候选，名称未冻结） | AgentLifecycle／HumanCollaboration 经既有 Control 受理链 | 创建/解析 Session、配置选择、任务关联、容量与归档提案 → 结构化回执 | #16；提案方不得写 canonical；最终提交重跑权威守卫 | 新增；旧的重复选择与身份推导迁往 AgentLifecycle 后删除 |

> 上表按真实 Module 调用者或 Host 适配列出；Host 装配不计逻辑边。纯函数政策有真实外部消费者时仍是当前公开入口，消费其他模块的端口只保留在 §3。

**本次变化方向**：见 §7（此处只写一句指引，细节放第 7 节）。

## 3. 依赖

`allowedModuleDependencies[ControlEngine] = { StateLedger }`——**只有 1 条边**。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| StateLedger | `load`／`commit`／`events`（契约类型 `StateLedger`） | 读 canonical snapshot 与 EventPage；提交 snapshot + Event + 幂等回执 + outbox intents 的**原子** commit，并构造 expected-version 集合（CAS） | 既有 |

**不变量与边界**：本模块负责**命令受理后的业务归约（状态 transition）**——`RunSnapshot.status` 一类 canonical 状态由本模块的纯函数 fold 归约，再作为一个原子提交交给 `StateLedger`；本模块**不以恢复重放方式另建正式事实**（不从 Event Log 重放重建 canonical snapshot）、**不直接访问存储**（Adapter 由调用方注入）；`CommitCursor` 是 opaque，只有 ledger Adapter 与 ReadModelIndex 可经 `compareCommitCursor` 使用。本模块不依赖 Human Interaction、Read Model 或具体数据库，也不反向依赖宿主与 Contracts 之外的实现。

## 4. 被依赖

反向表（架构稿 §3 依赖 DAG 的反向推导）共 **7 条**边，逐条列出消费的接口。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| HumanCollaboration | `ControlEngine`（`submit`／`bootstrap`／`install`／`activate`／`applyPlanChange`／`recordUserDecision`）；`Pick<ControlEngine,'grantMaterialAccess'\|'revokeMaterialAccess'>`（`history-materials.ts`）；`recordArchitectureReview`（`architecture-review.ts`） | 人的目标／决定／授权请求落账；架构协商读侧的决定回流 | 【代码】`interaction/human-collaboration/human-collaboration.ts`；架构稿 §2 |
| PlanCompiler | `InitialPlanningControl = Pick<ControlEngine,'submitQueryJob'\|'closeQueryJob'\|'applyPlan'>`；`Pick<ControlEngine,'resolveTaskWorkIdentity'>`（`planning-work-materials.ts`） | 初始协调的持久只读 QueryJob 意图、结果关闭、计划受理请求；影响报告读权威工作身份 | 【代码】`control/plan-compiler/initial-plan-compiler.ts`、`planning-work-materials.ts` |
| DispatchEngine | `Pick<ControlEngine,'claimTask'\|'dispatchReadiness'\|'closeQueryJob'>`、`'startRun'\|'runFact'\|'authorizeModelRequest'`、`'submitControl'\|'reconcileControlIntent'\|'reconcileRun'`、`'bindWorkContext'\|'linkWorkRun'\|'resolveTaskWorkIdentity'`、`'acceptReworkProposal'` | 派发准入与领取、运行事实归约、意图对账、工作身份、返工受理 | 【代码】`planned-task-dispatch.ts`／`operator-task-dispatch.ts`／`reviewer-dispatch.ts`／`runtime-dispatch.ts`／`work-identity.ts`／`rework-drive.ts` |
| VerificationEngine | `VerificationControlPort = Pick<ControlEngine,'submitEvidence'\|'reduceTask'\|'reduceGoal'\|'recordPatch'>` | 正式 Evidence 请求与归约请求（Verification 不直接完成 Task） | 【代码】`control/verification-engine/verification-deps.ts` |
| ArchitectureReconciler | `Pick<ControlEngine,'recordArchitectureInspection'\|'recordArchitectureFinding'\|'recordArchitectureDecisionBrief'>` | 检查、Finding 与 DecisionBrief 的逐次落账回执 | 【代码】`control/architecture-reconciler/architecture-reconciler.ts` |
| ReadModelIndex | `PolicyExplanationPort`（构造注入同一实现）；纯函数 `dedupeTaskWorks`（`work-identity-resolution.ts`） | 证据适用性／计划变更解释；完成工作视图复用同一份任务级工作身份选择规则（不做第二份实现） | 【代码】`plan-change-projection.ts`、`read-model-index.ts`、`completed-work-merge.ts` |
| **AgentLifecycle**（新增 Module） | 【设计新增】生命周期提案受理命令面（精确方法名待 I4 冻结） | 接受 AgentLifecycle 产出的产生／拆解／压缩／归档／重新启用提案，重跑守卫后归约；区别于 AgentLifecycle 提供的 `propose(action)` | 架构稿 §3.2、§6.1；不变量 #16 |
| 宿主边（**不计入 38 条**） | `src/app/**`、`src/composition/**` 注入 Adapter 与只读解释实现（如 `app/service.ts`、`composition/rework-composition.ts` 构造 `ControlReworkDisposition`） | 装配与 HTTP 适配；不承接模块权威 | 架构稿 §3.1「三种边必须分开」 |

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| `GoalSnapshot`／`GoalPhaseUpdated` | 是 | `reduceGoal`（唯一写者）+ StateLedger 原子提交 | 运行 |
| TaskReduction phase（`TaskSatisfied` 公式） | 是 | `reduceTask`（唯一写者） | 运行 |
| `RunSnapshot.status`（running／ended）与五种终态 | 是 | 本模块纯函数 fold；幂等／CAS／事件由 StateLedger 提交 | 运行 |
| `TaskLeaseSnapshot.holderRunId`、读／写租约索引 | 是 | `acquireWorkspace*Lease`／`releaseWorkspaceLease`（#7 唯一 Writer） | 运行 |
| ControlIntent 与 `ControlIntentReconciled` | 是 | `submitControl`／`reconcileControlIntent`（applied／rejected／`outcome_unknown`） | 挂起·恢复 |
| Evidence 适用性与绑定锚 | 是 | `submitEvidence`（#2／#6） | 运行 |
| PlanRevision／义务／`TaskHierarchy.parentOf`／`RuntimeExecutionDAG` | 是（**结构接受**权威） | `applyPlan`／`applyPlanChange`／`acceptReworkProposal` | 四动作·**拆解**（受理；分解与提案在 PlanCompiler） |
| `AgentInstanceV1`／`WorkParticipationV1`／`RoleBindingRefV1` | 是（**需要时才登记**） | `registerAgentInstance`（CAS@0）／`startWorkParticipation`／`endWorkParticipation` | 创建／四动作·产生 |
| `RoleSpecRevision`／`ProjectRoleSpecActive`／矩阵 pin | 是 | `install`／`activate`（`role-spec-install`／`role-spec-activate`）；规格内容是版本化 source | 创建／治理激活 |
| `WorkContextBinding`／`workId`／`HandoffPacketV1`／`HandoffRecorded`／`ReplacementClaimed` | 是 | `bindWorkContext`／`linkWorkRun`／`recordHandoff`／`claimReplacement` | 运行／挂起·恢复／重新启用 |
| 压缩结果（正式事实）与 `ExecutionNote` 记录 | 正式事实：是；正文：否 | 本模块**接受结果并归约**；执行＝WorkerRuntime／Kernel；正文＝ArtifactVault（不可变、有界、body-first） | 四动作·**压缩** |
| 四态 `working`／`standby`／`paused`／`archived` | 否（Session／工作卡片状态） | **canonical 归约侧在本模块**（归档为显式操作、经既有记录落账）；投影＝ReadModelIndex | 销毁＝归档／四动作·归档；不写入持久 `AgentInstanceStatus` |
| 控制意图／停派范围／人员处置动作（暂停、取消、换人、追加要求） | 是 | 本模块受理：`submitControl`／`reconcileControlIntent`／`recordUserDecision`／`claimReplacement` 一类既有命令归约；执行在 DispatchEngine／WorkerRuntime；替换提案在 AgentLifecycle | 运行／挂起·恢复；目标变更时**受理停派状态与控制意图**（`docs/PRODUCT.md` §5.5） |
| 归档事实（`archived`）与归档受理前的**义务复核** | 是 | 本模块受理并归约；**存在未完成交接时不予受理**（归档提案由 AgentLifecycle 携带义务处置依据提出）；StateLedger 提交、ReadModelIndex 投影 | 销毁＝归档／四动作·归档 |
| 角色绑定（`RoleBindingRefV1`） | 是（binding 实体） | DispatchEngine 的 `issueMatrixRoleBinding` **签发**；本模块的 claim 守卫**受理** | 创建／四动作·产生 |
| `RuntimeRecord`／执行态与能力声明 | 否 | WorkerRuntime | 运行／挂起·恢复 |
| `ContextBundle`／`selectedRefs`／`gaps`／manifest | 否 | ContextCompiler（唯一生产者） | 初始化／运行 |
| 任务图、架构图与工作卡片的查询投影 | 否（投影） | ReadModelIndex | 全阶段 |

**本模块拥有的对象**：Task／Goal 的 canonical 结构与状态；Run／TaskAttempt／outbox；Evidence 绑定与适用性；租约索引；ControlIntent；`WorkContextBinding` 与 handoff 记录；**正式事实归约**——`AgentInstanceV1`／`WorkParticipationV1`／`RoleBindingRefV1` 这类普通正式关联的归约；**治理归约**——五种治理种类中本模块承担的第 5 个种类 `RoleSpecRevision`（经 `install`／`activate` 的版本化 source + CAS 路径，`CoordinationPolicy`／`ArchitectureBaseline`／`ArchitectureEvolutionPolicy`／`CompletionPolicy` 同族）；**Session 的关联引用与 Kernel 映射**（平台只保存引用，不复制 Kernel 正文）。

**本模块不拥有的**：Session 正文、执行记录、检查点与压缩日志（Kernel）；Context 材料与其编译输出 `selectedRefs`／`gaps`／manifest（ContextCompiler）；工作卡片与图查询投影（ReadModelIndex）；正文持久化（ArtifactVault）；选人／复用／上下文处置决策（AgentLifecycle）；源码正文（WorkspaceReader）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化（项目认知初始化）／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另 §4.2 列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**。

## 6. 旧标识去向

按架构稿 §9.3（七条最小迁移规则）与 §4.5（R-1、标识取舍表）表态，属于本模块的部分如下。

- **`AgentInstanceV1.agentInstanceId`：保留为平台侧标识**（R-1，已定）；**不要求**为守旧写法继续由 `(work, run)` 派生，**也不把"迁移到稳定新主体"当作强制方向**。本模块是它的 canonical 归约方（`registerAgentInstance` CAS@0），承载字段属接口参数。
- **`AgentInstanceStatus = "active" | "retired"`**：字段存在，但 **`retired`／`retiredAt` 没有任何命令／事件写入**（架构稿 §4.0「明确缺失」）。**撤回"把 `working`／`paused` 等四态强塞进持久 `AgentInstanceStatus`"**：四态描述 Session／工作卡片，由 ReadModelIndex 用现有记录与查询生成；本模块只负责归档这类事实的 canonical 归约侧。
- **`agentId`**：有消费者时保留**轻量运行实例／通信参与者标识**；不为它扩建跨任务长期身份体系。
- **`workId` 与 `WorkContextBinding`**：`workId` **不先宣布必需**——若仅重复 `taskId` 就合并；合并前必须确认跨 Run／换手后的连续性已移到任务图或等效既有记录。本模块持有其写入（`bindWorkContext`／`linkWorkRun`）与权威解析（`resolveTaskWorkIdentity`）；现有 `bindWorkContext` 扫描账本（上限 200,000 条）应重构为**直接键查询、必要索引与稳定关联**。历史重复绑定保留可追溯，不据新规则删除或改名；旧库提交兼容见 StateLedger。
- **旧事件语义不变**：既有事件不可原地改变 v1 含义，演进必须新增 `schemaVersion` 与兼容策略，未知版本继续拒绝（架构稿 §7.3）。
- **映射关系记录来源**：需要映射的历史关系也要落成可追溯事实（架构稿 §9.3 规则 3）；老 Session 缺可恢复记录时只支持查询或有界交接，不假装可恢复。
- **Kernel 原始记录与平台正式状态不是同一事务**：先有可定位的 Kernel 结果，再**幂等**接纳为平台事实；创建请求重试以"不产生两份会话"为幂等判据（R-5）；中断按事件 ID／游标对账，副作用未知就核对、**不自动重跑**。

## 7. 本次接口变化方向

**新增/复用/迁出或删除。** 目标新增生命周期命令与归约输入，并让它们复用统一提交支持；复用而不复制 Control 拥有的初始计划与角色绑定政策；旧的重复选择、重复身份推导和重复取材职责迁给 AgentLifecycle／ContextCompiler 后删除旧分支。上述均是目标改造，当前源码尚未完成；只包一层生命周期入口而保留旧职责不算完成。

对应项号：**I4（主）／I5／I9** ｜ 接口名：`ControlEngine` 命令面（真实面为 `submit`／`bootstrap`／`install`／`activate`／`applyPlan`／协调面等大量命名方法）｜ 方向：**必须明确选择**采用命名命令端口，还是迁移到统一命令入口，**不得由生成模型自行补一条命令总线**；与之配套，本模块作为新事实的归约方接受新增的 commitKind 与事件类型（Agent／Session 生命周期、复用、压缩、归档）后交 `StateLedger` 提交，并在 `RoleSpec`／`RoleBinding` 领域类型（I9）上分开承担两种落点——**普通正式关联走正式事实归约**，**`RoleSpecRevision` 走单列的治理路径**（第 5 个治理种类，`install`／`activate` + CAS）｜ 边动作：**保留**（`ControlEngine → StateLedger` 语义不变、仍只有这一条出边；不新增依赖边）｜ 理由：C3／C10 与审阅 §4.6——命令面形状不统一会让生成模型各自发明总线，新事实又必须走同一原子提交路径｜ 不变量：**#1／#3／#16**（治理种类另涉 #11）。

## 8. 信息缺口

- **对齐架构稿 §11.4.3**（引用，不重新推导）：① 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、旧标识兼容映射）→ 架构稿 §9.2 第 1 份契约；② 各 Port 的精确形状、字段命名、装配点（含 Kernel 适配面划分）→ 架构稿 §9.2 第 2／4 份契约；④ 迁移切换点、删除顺序与回滚方式（含普通／Reviewer／Handoff 调用点）→ 架构稿 §9.2 第 4 份契约与 Prompt 6；⑤ 草案承载形态与转换门禁判定者 → 架构稿 §9.2 第 1／4 份契约（本模块是候选结构的**接受**方）；⑥ 度量口径的具体采集实现 → 按 U12 指标表，标"待测"；⑦ 生产 `lifecycleControl`／continuation 能力开关的放开与 Kernel 接线验证 → §11.4.2 第一行，真实连续任务验收。
- **本模块新增缺口**：
  1. **`retired` 写路径缺失**：`retired`／`retiredAt` 没有命令与事件写入，阶段 5 的归档事实目前只能经既有记录与查询落账（架构稿 §4.0／§4.6）；补哪条命令属 架构稿 §9.2 第 1／4 份契约。
  2. **I4 未定**：命名命令端口 vs 统一命令入口尚未选择，新增的生命周期命令如何与既有大量命名方法共存属接口参数，由 架构稿 §9.2 第 4 份契约定。
  3. **C-10**：`control-engine/policies/**` 被 PlanCompiler（`policies/initial-plan-admission.ts` 的 `normalizeInitialPlanProposal`、`policies/goal-change-consistency.ts` 的 `derive*`）与 DispatchEngine 直接 import → 按 架构稿 §9.1 收窄列／§11.4.2 C-10 处理：**有权威业务含义的内部策略改为窄接口，共用纯计算下移到合适归属**，不堆进 Contracts。
  4. **Session 在平台侧尚无持久承载**（`SessionV1` 与 session 聚合不存在，`sessionId` 只出现在 `RuntimeRecord.sessionId` 等裸字段），本模块阶段 1 的归约对象与其引用／映射的承载字段属接口参数（架构稿 §9.2 第 1 份契约）。

## 9. 重构目标与质量验收

本节已纳入本轮模块文档要求；通用依据见[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。以下均为目标，**源码达成待验证**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| §1/§8 的真实命令面约 93 个方法，守卫、归约和提交集中 | 按命令族分开守卫、expected-version、归约和提交编排；不建通用命令总线或第二状态机 | S01 仅收敛等价回执、适用类型守卫和机械事件构造，保留领域拒码/CAS/政策 | 代表命令可追踪“解析→当前事实复核→单次 commit→回执”，按现有 R2 阈值报告（RG-02、RG-05；CQ-02、CQ-06、CQ-07、CQ-10；S01） |
| §2 的 `submit` 只接 CreateGoal，目标统一入口尚未决定 | 按真实消费者暴露窄能力；生命周期 schema 留给契约阶段，不把草案写成现状 | 命名入口在迁移前保留；不得长期叠加泛化 wrapper 与双权威 | 每个接口列调用者、输入输出、拒绝、canonical 副作用和兼容期；删除前有迁移证据（RG-01、RG-04；CQ-01、CQ-03、CQ-12） |
| §1/§8 的 `policies/**` 被 Plan/Dispatch 私有直引，同时 canonical 只能由本模块归约 | 有业务权威的政策以窄面提供，提交前仍按当前事实复核；不增加身份治理或授权门禁 | S02 逐符号替换私有 import，不整目录搬 Contracts；新命令复用 S01，旧事件 v1 不改写 | 静态边界检查加实际调用审查，覆盖过期预检、CAS、重复命令、迟到结果，确认无旁路写入（RG-03、RG-04；CQ-04、CQ-06、CQ-08；S01、S02） |

专项关注：减负不能移动 canonical 归约权或弱化提交前复核。状态：命令族拆分、S01/S02 收敛及消费者行为待验证。
