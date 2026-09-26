# PlanCompiler Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Control
module: PlanCompiler
code_dir: coding-platform/src/control/plan-compiler/
contract_state: extension draft
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> 有界协调：把人的意图、已接受的源计划与运行反馈组织成**有界的协调工作**与**可受理的计划提案**（初始协调、人工计划、修订提案、机械返工提案）。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文。

## 1. 职责

**负责**

**内部责任与共用实现。** 本模块统一拥有“意图/已接受源计划 → 提案”的编译流程；初始、修订、人工计划和返工保留各自的来源与受理差异。计划形状规范化由 ControlEngine 的窄公开政策实现拥有，本模块复用但不复制；工作身份材料解析由 `planning-work-materials.ts` 共用，初始确认校验则在目标链路中新增，不冒充现有实现。

- **四动作·拆解（工作分解与提案）**：把一个角色的职责**分解**为可指派给多个子 agent 的工作单元（**不是销毁**），产出可受理的计划提案；任务集与指派的**受理**、义务与 DAG 推导权威在 ControlEngine（见架构稿 §4.2）。
- **阶段 3 运行的目标变更链**：HumanCollaboration（人的确认是**唯一生效点**）→ 本模块提案并输出**影响与未知项** → ControlEngine 接受为新 PlanRevision，并确定**停派状态、控制意图与迟到结果守卫** → DispatchEngine 执行控制交接 → WorkerRuntime 向 Kernel 发请求并回传结果 → HumanCollaboration 展示未完成处置（架构稿 §7.4 交互 4）。判据逐条覆盖：已知影响、未知影响、**无关 Run 继续**、迟到 Evidence；**影响范围无法确定时先暂停该 Goal 的新派发**（`docs/PRODUCT.md` §5.5）；**本模块不直接取消 Runtime**。
- **初始协调**：`requestInitial(intent)` 提交**持久只读协调 QueryJob 意图**，解析已登记回答，保留 `needs_decision`／无效／过期结果；HumanCollaboration 接收**绑定方案引用与版本的确认**（人的确认是**唯一生效点**），本模块据此交付候选，ControlEngine 检查**确认与候选的一致性**后应用；`app/initial-planning.ts` 只组合处理器、派发器与 Data 视图。
  - **两种情形都不能沿旧路径直接应用**：**未确认**；以及**确认后版本已变化**（确认绑定的是具体提案版本，版本一移动即失效，必须对新的具体版本重新确认——见 §2、§5）。
- **修订提案**：`request(intent: AmendGoalRequestV1)` 形成变更提案（`proposal`／`needs_material`／`rejected`），零写入。
- **人工计划**：`OperatorPlanCompiler`（实现 `OperatorPlanningPort`）处理**明确标识的人工来源**（`planOrigin: operator`），保留 pending plan journal；不声称模型自动规划。
- **机械返工提案**：`rework-plan-compiler.ts` 做输入校验／分组，`rework-proposal.ts` 做任务指令／影响／草稿组装；两者都是**同步纯函数、零写入**，从「源计划 + 问题」机械推导，复用 Control 的义务、任务集与 DAG 权威规则。
- **定向执行反馈的入口校验**：`execution-feedback-compiler.ts` 消费 Context 提供的公开反馈与来源，提交确定身份的 `execution_coordination` QueryJob；不直接运行模型、不写账本。
- **计划影响报告**：经 `planning-work-materials.ts`（`resolvePlanningWorkIdentities`／`planningWorkRef`／`planningWorkGaps`）读 Control 的权威工作身份（`resolveTaskWorkIdentity`）；**没有绑定时不虚构引用**，读取不可用或未供材料时**明确影响清单不完整**。
- **责任安排（跨模块工作包）**：拆解出的工作单元随提案输出**责任安排**——交付 owner、关联模块、协作角色、结果回流位置、负责人替换规则；**ControlEngine 受理其正式关联**，AgentLifecycle 提供参与／替换建议，ReadModelIndex 展示；**父任务继续承担汇总义务**（架构稿 §4.2；`docs/PRODUCT.md` §7.1 动作表「拆解」行）。不新增治理对象。
- **接受消费**：`accept(trigger)` 消费已持久化结果（`accepted`／`needsDecision`／`issues`），不遍历私有工作流状态。
- **计划形状的消费与规范化复用**：本模块复用 Control 的 `control-engine/policies/initial-plan-admission.ts`（`normalizeInitialPlanProposal`）把模型公开结果规范化；**该政策的 owner 是 ControlEngine**，Control 的来源 guard 不反调协调器。
- **`task → moduleId` 的声明侧**（U4 已定＝允许，**可选字段**）：探索类任务可为空，但必须**显式表达"尚未判定／不适用"**。**【设计新增】**，未落地。
- **"材料触发声明"**（I12 目标候选）：声明何时需要重组材料，而不是隐式全量取料。**【设计新增】**，未冻结。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| 不直接运行模型、不持有运行 | DispatchEngine（模型运行经**持久 intent** 交 Dispatch；`drive(trigger)`） |
| 不写账本、不直接读 Ledger | ControlEngine（`submitQueryJob`／`closeQueryJob`／`applyPlan`）；StateLedger（`load`／`commit`／`events`） |
| 不直接打开 Vault 正文；需要正文时经 Context 取材 | ContextCompiler（`PlanningMaterialPort`）；ArtifactVault（`open(ref, accessScope)`） |
| **不在此调用真实 Worker 启动** | DispatchEngine 的 `planned-task-dispatch`（消费已接受的 assignments，经 Control `claimTask` 与持久 outbox） |
| 不授予权限、不判定材料访问适用性 | ControlEngine（`grantMaterialAccess`）；ArtifactVault（`MaterialAccessResolver`／`material-access-policy`） |
| 不代替 Control 的受理守卫（scope／版本／义务／幂等） | ControlEngine（`applyPlan`／`applyPlanChange`／`acceptReworkProposal`） |
| 不拥有计划形状的确定性规范化与可受理形状校验 | ControlEngine 的 `control-engine/policies/initial-plan-admission.ts`（`normalizeInitialPlanProposal`）；本模块只复用 |
| 不裁决义务、任务集与 DAG 的权威规则 | ControlEngine（受理、义务与 DAG 推导权威）；本模块只做**返工提案的机械推导** |
| 不产出 canonical PlanRevision、不推进长期状态 | ControlEngine + StateLedger（不变量 #1／#3） |
| 不产出 `selectedRefs`／`gaps`／manifest | ContextCompiler（三者唯一生产者）；本模块只表达计划影响的**缺口** |
| 不做受影响材料的局部刷新或重建 | ContextCompiler（材料变化触发的局部刷新） |
| 不裁决验证结论、不接纳 Evidence、不判定完成 | VerificationEngine（`verify(intent)`／`VerificationService.verify`）+ ControlEngine |
| 不做架构漂移裁决、不生成 Finding | ArchitectureReconciler（`inspect(intent)`） |
| 不解释自然语言、不接收人的直接输入、不渲染反馈 | HumanCollaboration（`createGoal(request)`／`amend`／`goalView(query)`） |
| 不登记运行实例标识、不决策用哪个角色配置／哪条 Session | ControlEngine（`registerAgentInstance` 等归约）；AgentLifecycle（决策） |

## 2. 对外接口

**接口命名口径**：以真实 Port／实现名为主；契约权威是 `contracts/planning.ts`（`PlanCompilerPort`、`PlanningMaterialPort`、`InitialPlanningRequest`、`PlanningAcceptanceTrigger`、`PlanningAcceptanceReport`、`PlanProposalResult`、`PlanningTaskWorkMaterial`）；**计划字段权威类型 `PlanRevisionDraft` 定义在 `contracts/plan.ts`**，规划侧的公开形状统一经 `contracts/planning.ts` 暴露。架构名义名 `PlanCompiler.request/accept` 与下表真实签名对照。

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `PlanCompilerPort.request`（现状） | HumanCollaboration | `AmendGoalRequestV1` → `proposal`／`needs_material`／`rejected` | 零写入，不自行受理 | 保留；I12 材料触发声明作为请求/结果候选字段扩展，连同 `moduleId` 与责任安排后置精确 schema，不新增可调用服务 |
| `PlanCompilerPort.requestInitial`（现状） | HumanCollaboration／宿主适配 | `InitialPlanningRequest` → QueryJob 受理或拒绝 | `allowWrite`、大小与 Control 可用性守卫按现状；当前代码尚不接收“绑定提案版本的确认” | 保留为“请求协调”入口；旧实现中随后直接 `applyPlan` 的路径迁为“只产候选，等待确认” |
| `PlanCompilerPort.accept`（现状） | HumanCollaboration／初始规划处理器 | 已登记回答引用 → `processed`／`rejected` | 只消费已登记回答，不遍历私有状态；当前签名尚无具体版本确认参数 | 目标增加确认引用与候选版本核对；未确认或版本移动均拒绝，旧直应用调用迁到 ControlEngine 复核后的受理链 |
| `OperatorPlanningPort`（现状） | HumanCollaboration | 明确人工来源的计划 → pending/安装结果 | 不冒充模型规划；写入仍经 ControlEngine | 保留，人工计划语义不并入自动协调 |
| `ReworkPlanCompiler`／`resolvePlanningWorkIdentities`（现状公开实现入口） | DispatchEngine | 源计划＋问题、任务身份 → 返工提案、身份材料或缺口 | 不写 canonical；缺绑定不虚构；不代替 Control 受理 | 保留；目标按返工/材料职责定义窄 Port，调用迁移后再隐藏实现 |
| `ExecutionFeedbackCompiler`（现状公开实现入口） | DispatchEngine（`validate`）；宿主反馈协调流程 | `validate/failureResolution` 读取资格/解决结果；`request/requestDecision/requestFailure/requestFailures/renew` 请求或更新反馈协调 → QueryJob 引用或缺口 | 校验只读；协调请求通过 Control `submitQueryJob` 持久化，不能把整类描述为零写入；不直接推进 Task | 保留真实生产调用；共享材料/请求支持，按只读校验与请求协调收窄接口后迁移类调用 |

**内部映射（不是新增公共承诺）**

| 内部类／文件 | 责任与共用关系 |
| --- | --- |
| `PlanCompilerImpl` | 组合修订与初始协调；继续作为当前公开 Port 的实现。 |
| `rework-proposal.ts` | `ReworkPlanCompiler` 内部共用草稿组装，保留机械返工与交互规划差异。 |
| `ExecutionFeedbackCompiler`／`planning-work-materials.ts` | 当前被 DispatchEngine 与宿主流程消费；目标由上表窄 Port 承接全部真实调用后，类/文件本身退回内部实现。 |

**本次变化方向**：见 §7（此处只写一句指引，细节放第 7 节）。

## 3. 依赖

`allowedModuleDependencies[PlanCompiler] = { ContextCompiler, ControlEngine }`——**2 条边**。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| ContextCompiler | `PlanningMaterialPort`：`amendment/initialRequest/initialResults/initialPlan/initialCurrentness/acceptedInitialPlans`；`OperatorPlanningContextPort.goal/sourceDigest/activePlan`；反馈协调的 `ExecutionFeedbackContext` | 规划/人工计划/反馈材料、版本核对与显式缺口；不直接打开 Vault，也不把各种读取方法的结果都当作同一个 assemble 结果 | 既有 |
| ControlEngine | `InitialPlanningControl = Pick<ControlEngine,'submitQueryJob'\|'closeQueryJob'\|'applyPlan'>`；`Pick<ControlEngine,'resolveTaskWorkIdentity'>` | 持久只读 QueryJob 意图与关闭、计划受理请求；影响报告读权威工作身份；另复用 `control-engine/policies/initial-plan-admission.ts` 的规范化纯函数 | 既有（消费内容扩展：影响报告改读权威工作身份；`policies/**` 直引为 C-10 收窄项，见 §8） |

**边界**：Control 的来源 guard **不反调**本模块的协调器；初始协调请求与结果的持久化经 Control，本模块不直接读 Ledger。运行时的事件反馈**不是**反向源码依赖。

## 4. 被依赖

反向表（架构稿 §3 依赖 DAG 的反向推导）共 **2 条**边。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| HumanCollaboration | `Pick<PlanCompilerPort,'request'>`（`human-collaboration.ts` 的 `planProposal`）；`OperatorPlanningPort`（探索／人工计划安装，由 `OperatorPlanCompiler` 实现） | 人的变更意图转成有界提案；人工探索计划的安装与校验 | 【代码】`interaction/human-collaboration/human-collaboration.ts`、`exploration-session.ts`；module-boundaries「入口与隐藏职责」 |
| DispatchEngine | `ReworkPlanCompiler`（`rework-drive.ts`）；`resolvePlanningWorkIdentities`（`planning-work-materials.ts`）；`ExecutionFeedbackCompiler.validate`（coordination 端口） | 由「源计划 + 问题」机械推导的返工提案；工作身份材料解析；执行反馈入口校验 | 【代码】`control/dispatch-engine/rework-drive.ts`；module-boundaries「自动返工与角色规格」 |
| 宿主边（**不计入 38 条**） | `app/initial-planning.ts` 组合处理器/派发器/Data 视图；`app/service.ts`、`app/scheduling/rework-continuation.ts` 调用 `ExecutionFeedbackCompiler.requestDecision/requestFailures/renew/failureResolution` | 装配、HTTP 适配与反馈协调；这些真实调用纳入迁移面，宿主不承接模块权威 | 架构稿 §3.1「三种边必须分开」 |

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| 计划提案（`PlanProposalV1`／`PlanPatchV1`／`ChangeImpactAnalysisV1`） | 否（提案） | 本模块构造（`request`） | 四动作·**拆解** |
| `PlanRevisionDraft`（计划字段权威类型，定义在 `contracts/plan.ts`） | 否（草稿／提案侧） | 本模块组装草稿（含返工的完整任务与指派）；canonical PlanRevision 由 ControlEngine 接受 | 拆解 |
| 初始协调 QueryJob 意图与其结果解析 | 意图：是（经 `submitQueryJob`）；解析结果：否 | ControlEngine 保存；本模块解析已登记回答并保留 `needs_decision`／无效／过期 | 运行（目标变更链） |
| 初始方案版本与**绑定具体版本的确认** | 确认：是（**唯一生效点**） | HumanCollaboration 接收并记录绑定方案引用与版本的确认；ControlEngine 核对确认与候选一致后应用；本模块只交付候选 | 创建（初始协调） |
| 人工计划 journal／pending plan journal（`planOrigin: operator`） | 否 | 本模块（`operator-plan-compiler.ts`） | 拆解 |
| 返工提案（机械推导结果） | 否 | 本模块（`rework-plan-compiler.ts`／`rework-proposal.ts`，同步纯函数、零写入） | 拆解 |
| 影响报告与 `PlanningTaskWorkMaterial` | 否 | 本模块；工作身份读 ControlEngine 权威（`resolveTaskWorkIdentity`）；**影响清单必须单列未知项**，未知时不冒充"无影响" | 拆解 |
| 材料缺口（影响清单的不完整表达） | 否 | 本模块只表达缺口；`selectedRefs`／`gaps`／manifest 的唯一生产者是 ContextCompiler | 拆解 |
| `moduleId` 声明（【设计新增】可选字段） | 否（声明） | **声明＝本模块**；受理＝ControlEngine；投影＝ReadModelIndex（见 `docs/refactor/modules/ownership-map.md`） | 拆解；探索类任务显式"尚未判定／不适用" |
| 责任安排（【设计新增】交付 owner／协作角色／结果回流位置／负责人替换规则） | 否（提案） | **输出＝本模块**；正式关联受理＝ControlEngine；参与／替换建议＝AgentLifecycle；展示＝ReadModelIndex；**父任务的汇总义务不因拆解消失** | 拆解 |
| 材料触发声明（【设计新增】） | 否 | 本模块声明；实际取材与刷新在 ContextCompiler | 拆解／运行 |
| 受影响材料的局部刷新或重建 | 否 | ContextCompiler（只更新受影响部分） | 运行 |
| canonical PlanRevision／义务／`TaskHierarchy.parentOf`／`RuntimeExecutionDAG` | 是 | ControlEngine（`applyPlan`／`applyPlanChange`／`acceptReworkProposal`） | 拆解（**受理**） |
| Run／outbox／租约／派发事实 | 是 | ControlEngine + StateLedger；执行经 DispatchEngine | 运行 |

**本模块拥有的对象**：计划提案与草稿（提案侧）、人工计划 journal、返工提案、影响报告与工作身份材料、责任安排（设计新增）、`moduleId` 声明（设计新增）、材料触发声明（设计新增）。

**本模块不拥有的**：canonical PlanRevision／义务／任务集与 DAG 权威（ControlEngine）；canonical 工作身份（ControlEngine）；ContextBundle／`selectedRefs`／`gaps`／manifest（ContextCompiler）；Run／outbox／租约（DispatchEngine／ControlEngine）；`AgentInstanceV1`／Session 引用（决策在 AgentLifecycle、归约在 ControlEngine）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**，与本模块无关。

## 6. 旧标识去向

- **本模块不持有 `agentId`／`AgentInstance` 标识**：不登记、不推导、不修改运行实例标识，因此**没有实例标识的迁移动作**；命中的"产生"由 AgentLifecycle 决策、ControlEngine（`registerAgentInstance`）归约。
- **`resolveTaskWorkIdentity` 是 Control 的接口，本模块只消费**（`plan-compiler.ts` 的 `workIdentity` 依赖、`planning-work-materials.ts` 的 `authority` 参数）：计划影响报告**改读 Control 权威工作身份，不再猜 work-taskId**；解析不可用时如实报缺，调用方必须失败而不是硬写。
- **`workId` 不先宣布必需**（架构稿 §4.5）：本模块**不用 taskId 拼造 workId**；`planning-work-materials.ts` 只为已接受源计划的任务取材，两种提案编译器只消费显式材料。
- **显式身份与已有推导身份均原样保留**：派发与影响报告共用 `taskWorkOrigin` 的同一返工起源链规则；不据新规则删除或改名历史绑定，没有绑定时不虚构引用。
- **`moduleId`（U4）**：可选字段的**声明侧在本模块**【设计新增】；探索类任务可为空但必须显式表达"尚未判定／不适用"，不能把缺字段当成"不受任何模块影响"；落地连带 `PlanTaskSetDeltaV1`（`contracts/goal-change.ts`）与 ReadModelIndex 投影。
- 旧事件语义不变、映射关系记录来源、`schemaVersion` 与切换点写在接口／重构计划中（架构稿 §9.3 规则 1／3／6）——适用于本模块新增字段的演进。

## 7. 本次接口变化方向

**新增/复用/迁出或删除。** 目标新增材料触发声明、`moduleId` 与责任安排字段，并给初始方案受理增加绑定具体候选版本的确认；复用 ControlEngine 拥有的计划规范化政策和模块内工作身份材料解析。旧的 `requestInitial` 结果直接 `applyPlan` 路径迁到“候选 → 人确认 → ControlEngine 复核”后删除，解释请求不得借旧路径再生成方案。当前确认参数与迁移尚未在源码完成。

对应项号：**I12（主）／I9 关联面／U4 声明侧** ｜ 接口名：`PlanCompilerPort.request`／`requestInitial`／`accept` ｜ 方向：**新增"材料触发声明"**（何时需要重组材料），并明确 **解释 ≠ 重新提案——解释不得再触发一次 `requestInitial`**；角色矩阵按 `CoordinationPolicyContentV1.roles`（**可选字段**；没有矩阵时**不编造默认目录**）；`moduleId` 的声明侧落在本模块（可选字段，探索类任务显式"尚未判定／不适用"）｜ 边动作：**保留**（`PlanCompiler → ContextCompiler`、`PlanCompiler → ControlEngine` 两条出边语义不变，不新增依赖边；方案解释走 HumanCollaboration 的读侧，不经本模块重新提案）｜ 理由：C5 与审阅 §3.5——解释若触发重新生成，人看到的就不是原方案；材料触发声明把"何时重组材料"从隐式全量取料改为显式声明 ｜ 不变量：**#1／#25**（角色矩阵与绑定另涉 #11；材料等级与 manifest 另涉 #28）。

## 8. 信息缺口

- **对齐架构稿 §11.4.3**（引用，不重新推导）：① 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、旧标识兼容映射）→ 架构稿 §9.2 第 1 份契约（本模块受影响面：`moduleId` 与任务图关联的承载字段）；② 各 Port 的精确形状、字段命名、装配点 → 架构稿 §9.2 第 2／4 份契约（`PlanningMaterialPort` 与 ContextCompiler 多端口之间的对应与合并关系）；④ 迁移切换点、删除顺序与回滚方式 → 架构稿 §9.2 第 4 份契约与 Prompt 6；⑤ 草案承载形态与转换门禁判定者、探索计划的 UI 入口是否开 → 架构稿 §9.2 第 1／4 份契约；⑥ 度量口径的具体采集实现 → 按 U12 指标表，标"待测"。
- **本模块新增缺口**：
  1. **完整语义协调与角色反馈仍缺**：现有入口（初始协调、修订提案、人工计划、机械返工）存在，**不等于**持续角色收敛与完整语义重规划已具备；不据入口存在推定能力。
  2. **影响清单在缺材料时必须显式不完整**：无绑定时不虚构引用、读取不可用诚实报缺；"受影响 Context 的实际刷新已全部接通"仍不成立（刷新归 ContextCompiler）。
  3. **C-10**：本模块直接 import `control-engine/policies/**`（`initial-plan-admission.ts` 的 `normalizeInitialPlanProposal`、`goal-change-consistency.ts` 的 `deriveExpectedTaskGraph`／`deriveObligationSet`／`deriveTaskAssignments`／`deriveTaskSet`）→ 按 架构稿 §9.1 收窄列／§11.4.2 C-10 处理：**改为窄接口，或把共用纯计算下移到合适归属**。
  4. **`moduleId` 与材料触发声明尚未落地**：两者均为【设计新增】；`moduleId` 落地连带 `PlanTaskSetDeltaV1` 与投影（架构稿 §5.2 缺口①），字段演进属接口参数。
  5. **初始模型规划的通用语义资格政策仍需单独定义和验收**：现有对 `OperatorPlanCompiler` 新普通开发计划的修正（required dynamic 与 reviewer 同在工作／目标门禁）**不能外推**到全部规划路径。

## 9. 重构目标与质量验收

本节已纳入本轮模块文档要求；通用依据见[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。以下均为目标，**源码达成待验证**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| §1/§8 的初始、修订、人工作业、返工来源不同，`ReworkPlanCompiler.compile` 约 252 行 | 按输入归一、问题→任务、依赖构造、输出校验分责；返工编译保持同步无 I/O，不为缩行增 Port | 仅共用同义编译步骤，各入口来源、拒绝和接受差异保留 | 各入口有效/无效来源与依赖场景行为不变，并按 R2 函数阈值报告（RG-01、RG-02、RG-05；CQ-01、CQ-02、CQ-07、CQ-10） |
| §2 的真实 `request/requestInitial/accept` 与架构摘要不同，材料触发仍是目标 | 如实保留调用者、三态/回执和副作用；触发声明只表达何时及为何需材料，字段后置 | 不新增万能 Compiler；现有消费者迁移后才删除旧入口 | 覆盖 Human、initial-planning、composition/harness 调用点与拒绝、不完整、Control 接受副作用（RG-01、RG-04；CQ-01、CQ-03、CQ-06、CQ-12） |
| §1/§8 有 Control 私有政策直引，且多入口无条件完整取料、未知影响易被误判 | 通过窄面复用 Control 权威；由本模块声明有界材料触发，未知影响不冒充无影响 | S02 替换私有 import；S06 在 Context 内共用读取/缺口步骤，规划触发与用途保留；被增量路径替代的重复全量取料退役，真正需要完整初始材料的路径保留 | 边界检查加实际 import／调用核对；过期预检仍被 Control 拒绝；测读取/组装次数、输入量和耗时（RG-03、RG-04、RG-06；CQ-04、CQ-06、CQ-08、CQ-09；S02、S06） |

专项关注：减负不能把纯返工编译改成 I/O 编排，也不能迁走 Control 的规范化权威。状态：内部拆分、S02/S06 接线和成本待验证。
