# ContextCompiler Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Data
module: ContextCompiler
code_dir: coding-platform/src/data/context-compiler/
contract_state: extension draft
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> **五类触发点的有界选材**（边界本稿收缩，见架构稿 §6.2）。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文。跨模块重复承载的切分见 [`../ownership-map.md`](../ownership-map.md)。

## 1. 职责

**负责**

内部按四类共用能力组织：`material-read` 统一精确引用读取与来源/授权结果保真，`reference-manifest` 统一 `selectedRefs`／`gaps`／freshness，`incremental-refresh` 依据触发原因与基线计算受影响片段，`budgeted-assembly` 统一容量核算和失败关闭。各用途 Port 组合这些能力，并保留自己的身份、独立性、格式和资格约束；不把不同用途包装成一个 mode 开关，也不按五个触发点机械合并接口。

- **五类触发点的有界选材**（架构稿 §6.2 表）：① 首次启动；② 恢复；③ 材料变化；④ 压缩后重建；⑤ 新 Session 接续。**"触发点"只表示可能需要调用，不等于发生一次就必须编译一次**——是否调用、调用到什么范围，按架构稿 §6.2.1 场景表执行（日常追问／工具返回／普通消息＝否；Kernel 成功恢复原 Session＝否；Kernel 已完成压缩并提供可继续的上下文＝否；新 Session 初始化或跨 Session 交接＝是；目标／规范发生变化＝是，但**只更新受影响部分**）。
- **触发点名称的口径差异（登记，不改写他人文档）**：接口契约 `dev_docs/interfaces/context-lifecycle.md` 的"生命周期事件"列的是 **8 行**触发（正常回复／工具结果／授权内返工、等待／暂停、恢复、容量压力／压缩／rollover、目标／计划／规范变化、故障／转交、完成／取消、后续相关新任务），其中**没有"首次启动"这一行，也没有"压缩后重建"的独立名称**。本模块以五类触发点为准，并要求在接口层把两者**显式对齐**（C-5，详见第 8 节）。
- 产出**有界 `ContextBundle`（稳定前缀 + 动态尾部）**＋ manifest（`selectedRefs`／`gaps`／`freshness`），结果三态 `ready`／`needs_material`／`rejected`；`needs_material` **在模型调用之前失败关闭**（架构稿 §7.4 交互 3）。
- 按**材料三个等级**（架构稿 §6.2.2）如实带上来源与版本：**L1 路径级**（路径 + 内容版本／摘要，如 `workspaceSnapshot`、stale 判定）／**L2 摘录级**（短摘录 + 链接 + 取用日期 + "未经验证"标注）／**L3 引用级**（`kind` + `refId` + `revision` + `digest`）。三级**不得互相冒充**：L1／L2 **不能提升授权级别**，完成归约、授权复核与审批必须基于 L3。
- **事实与证据的来源适用性检查与如实报缺**（架构稿 §6.2.3）：只做两件事——把材料的**来源、版本、适用性、缺口**如实带上；必要材料缺失时返回 `needs_material` 并在模型调用之前失败关闭。**材料被选入 Context 不等于材料中的判断被接受**——本模块**不裁决事实真假与完成状态**（Evidence 适用性与完成归约在 ControlEngine，验证结论由 VerificationEngine 组织）。
- **增量刷新**：输入增加触发原因与增量基线后，只刷新受影响部分；新增输入形状会使**旧形状答案的当前适用性保守失效**（旧正文与持久指导版本仍可读，但不能当作当前重新验证）。
- 消费 `RoleBinding`（I9 消费面）：绑定由 **ControlEngine 接受与撤销**，**StateLedger 保存事实**，**DispatchEngine 在启动与安全检查点核对有效性**；本模块只**消费**绑定，不签发、不撤销、不判定有效性。
- 材料正文归 **ArtifactVault**；本模块只选择、组装、引用与拒绝材料，不复制正文。
- 归属阶段（架构稿 §4.1）：**初始化**（项目认知初始化的必要材料编译）、**挂起·恢复**（恢复触发的选材）、**运行**（材料变化与压缩后重建）。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| **选人**（选角色／选 Agent／选 Session） | **AgentLifecycle** 决策 + **DispatchEngine** 签发 + **ControlEngine** 守卫（§6.2 移出清单） |
| **调度**（何时派发、顺序、租约、安全点） | **DispatchEngine**（唯一 `drive` 的目标口径）+ **ControlEngine** |
| **正式状态归约**（Task／Goal／义务／Evidence 适用性） | **ControlEngine**（归约路径与 `CompletionPolicy` 不变） |
| 「**何时该启动／该恢复哪个 Session／该不该重建材料**」三个问题 | 控制面：**AgentLifecycle** 决策，**ControlEngine** 归约（它们不是数据面的问题） |
| 启动模型 | **WorkerRuntime**（模型／工具循环与最终 `ModelRequest` 计量由它承载） |
| 写正式状态、裁决任务完成、重新计算完成资格、成为第二个完成归约器 | **ControlEngine**（`CompletionPolicy` 完成归约） |
| 把调查结果当 Evidence | **VerificationEngine** 组织验证结论，**ControlEngine** 归约 |
| 调用 Control、**被 Control 反向调用** | 缺口交调用方经 **Control 路径**补充；Control 不反向调用本模块 |
| 签授权 | **ControlEngine**（`grantMaterialAccess`／`revokeMaterialAccess`）+ **ArtifactVault** 的 `MaterialAccessResolver` 判定（`rejected/stale`、`rejected/invalid`、`unavailable`） |
| 自行启动 Agent（含材料缺口的追查） | 缺口由 **Control 路径**创建短生命周期工作（§6.2.1 末行） |
| 依赖 `PlanCompiler`／`DispatchEngine` | 依赖方向相反（两者依赖本模块）；避免"检索 → 启动 Agent → 再检索"的源码环（§6.3） |
| 决定复用范围 | **AgentLifecycle**（复用决策与推荐范围）；本模块只把推荐范围当**推荐线索**，`selectedRefs`／`gaps`／manifest 的**唯一生产者仍是本模块** |

**明确不经过本模块的路径**（架构稿 §6.2.1，这是"目前经过它的比较多"的正面回答）

| 场景 | 走哪条路 | 是否经本模块 |
| --- | --- | --- |
| 编排 agent → 执行 agent 的**任务下发与追问** | **定向通信（邮箱）**：消息正文先入 **ArtifactVault**，**ControlEngine** 校验并登记引用与路由事实；大正文不进 reducer | 否 |
| **连续工作的日常推进** | 在**既有 session 上追加消息 + 查询工具 + 补局部材料**；不因一次 Run 结束或一次派发就重建整套上下文 | 否 |
| **静态搜索与文件读取** | `rg`／文件读取**直接面向当前文件**；架构图只提供**路径范围与候选模块**（`WorkspaceReader`） | 否 |
| **按需读取事实** | 只读事实工具直接读：`read_query_fact`（≤24 条事实引用／run，合并来源 manifest ≤64） | 否 |
| **材料缺口的追查** | 缺料由 **Control 路径**创建短生命周期工作；本模块不自行启动 Agent | 否（不启动 Agent） |

**复用范围＝推荐线索，不是硬白名单（L-1 收口）**：Skill／prompt 指导阅读并**推荐材料与检索入口**，执行者能用工具自主查找、按需扩大阅读，**不被固定 `selectedRefs` 白名单卡住**。本轮**撤回**：① 不新增平台的**逐条材料授权系统**；② 不把"每轮继承历史复核"设为新增必经门禁，也**不为此新增 `WorkerRuntime → ControlEngine` 边**。**保留两条边界**：① 执行端真实权限不能由 prompt 绕过（沿用 Kernel／工具／沙箱与既有授权规则）；② 不同时承诺"只靠 Skill"与"形式化保证撤权材料永不再次进入模型"。既有 `MaterialAccessGrantV1` 判定沿用。**跨项目复用首版不做**：跨项目请求**显式拒绝并说明原因，不静默降级**。

## 2. 对外接口

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `TaskContextPort.assemble`【代码，现状】 | DispatchEngine | 已接受工作、RoleBinding、版本、范围、预算 → `ready(bundleRef, manifest) \| needs_material \| rejected` | 必要材料缺失/超预算失败关闭；不得静默截断 | 保留现入口；当前全量调用不冒充增量编译 |
| `TaskContextPort.assemble` 的触发/增量扩展【目标，字段未冻结】 | DispatchEngine | 现有请求＋触发原因＋增量基线 → 局部刷新/新建编译的 ready／needs_material／rejected 结果 | 直接续用由 Dispatch 选择并绕过本 Port；Kernel 成功恢复原 Session 时不编译；局部刷新只更新受影响片段 | 沿原 Port 扩展；旧全量调用迁为无基线的新建分支，不另造统一门面 |
| `PlanningContextPort.assemblePlanningContext`【代码】 | Host/harness 的规划与补料消费者 | 规划范围与材料引用 → ready/needs_material/rejected | 不运行 Agent；保留范围、预算与拒绝原义；当前 PlanCompiler 主链消费下行 `PlanningMaterialPort` | 保留用途专用 Port；内部改用共同读取/manifest/预算能力 |
| `OperatorPlanningContextPort.goal/sourceDigest/activePlan`【代码】 | PlanCompiler 的人工计划入口 | `ExplorationScope` → GoalSnapshot、来源摘要、当前 PlanRevision 或 null | 只读精确范围；空计划不以标识前缀猜测；不自行受理计划 | 保留专用用途，复用共同读取/版本核对 |
| `PlanningMaterialPort`【代码】 | PlanCompiler；DispatchEngine 的 PlannedTaskDispatch（`acceptedInitialPlans`） | `amendment/initialRequest/initialResults/initialPlan/initialCurrentness/acceptedInitialPlans` → 规划材料或显式缺口/拒绝 | 只读选材；不提交计划、不运行 Agent；提交时仍由 Control 复核范围/版本 | 保留 canonical 材料读取面，与 PlanningContext 的 bundle 编译用途并行；共同读取/版本/缺口处理下沉内部 |
| `ExecutionFeedbackContext`【代码，当前公开实现】 | PlanCompiler 的 `ExecutionFeedbackCompiler` | `prepare/prepareFailure/prepareDecision/jobs/current/failureResolution` → 反馈材料、当前性或协调结果/缺口 | 只读事实与材料；QueryJob 提交由 PlanCompiler 经 Control 完成 | 保留真实消费面，复用读取/版本/缺口支持；不把反馈协调本身迁入 Context |
| `QueryContextPort.assembleQueryContext`【代码】 | DispatchEngine 的 Query 驱动；Host/harness | `QueryContextRequestV1` → `QueryContextResultV1` | 独立只读 Query 的材料与预算；不读取源 Run 隐藏上下文、不改变源 Run 租约 | 保留用途 Port，复用共同读取/引用/预算支持；区别于运行中的按需 `readFact` |
| `assembleRuntimeContext`【代码，当前公开实现】 | WorkerRuntime | 运行规格＋envelope＋材料访问能力 → 运行输入与 manifest，或 `RuntimeContextError` | 核对精确范围/版本/正文；Reviewer 保留独立性与原始见证要求；不是每轮消息重新选材入口 | 保留真实消费面；复用读取/引用/预算支持，不为迁移再包一层万能编译器 |
| `VerificationContextPort.resolveRound`／`RunOutputMaterialPort`【代码】 | VerificationEngine | 精确 Task/Run/Plan/Workspace/pin 与产出引用 → 验证材料或 unavailable | I/O 前后核对身份；不执行检查、不接纳 Evidence；未知前态不能快放 | 保留独立验证语义；只下沉共同读取、引用与缺口处理 |
| `ReviewerContextPort`【代码】 | VerificationEngine／DispatchEngine Reviewer 路径 | canonical Work、原 Run 配置和原始见证 → reviewer bundle | 保持 Reviewer 身份、独立性、原始见证与结论格式约束 | 与执行 Port 并行；不得因同为首次启动而合并 |
| `QueryExecutionMaterialPort.readFact`【代码，可选】 | WorkerRuntime 只读 Query | 捕获输入内 RFC6901 位置 → fact/unavailable/stale/too_large | 仅 `/material`、`/maintainedPreferences`；≤16 KiB，不裁剪；model 不能改 scope/owner/grant | 保留候选查询能力；不等同 ReadModel 的 `query` 实现 |
| `ExplorationSessionContextPort`／`HistoryMaterialContextPort`【代码】 | HumanCollaboration | 探索或历史请求 → 有界材料、来源、缺口 | 推荐范围不是白名单；跨项目首版显式拒绝 | 保留消费者专用入口；共同步骤下沉模块内部 |
| `ArchitectureContextPort.assemble`／`BaselineEvolutionContextPort.assemble`【代码】 | ArchitectureReconciler | 精确 inspection intent／proposalRef → ready 材料或失败关闭/拒绝 | 核对 plan pin、reader 范围和来源版本；不代替结构差分或基线激活 | 保留现有对账材料面；复用读取/引用/版本核对支持 |
| `SourceGraphContextCompiler`（实现 `WorkspaceReadPort`）【代码】 | Host 图读取装配；模块内图材料消费者 | 图读取 query → bounded graph context/bodyRef | 原生来源由 Reader 捕获，图正文在本模块绑定后保存 Vault；保留旧 bounded-bundle wire 形状 | 保留当前公开实现；不得和 Reader 的原生捕获接口或 Reconciler 材料 Port 混为一体 |
| `WorkRunMaterialCompiler`／`DeliveryMaterialCompiler`【代码】 | DispatchEngine | Work/Delivery 精确集合 → 有界正文引用与 manifest | Work 清单对应实际筛选；Delivery 只取 admission 固定集合，不扩成整邮箱 | 现入口保留；内部复用材料读取/引用/缺口 |
| `AlternativeReportObservationPort`（实现 `AlternativeReportMaterialCompiler`）【代码】 | DispatchEngine | 可替代报告精确引用、grant 与 source → observation/refused/unavailable | source 不可核对整轮 unavailable；撤销 grant 不由其他授权恢复；不决定 Wait/完成 | 现入口保留；内部复用授权结果保真与来源核对 |
| `CompletedWorkContextPort.assembleCompletedWorkContext`（`CompletedWorkContextCompilerImpl`）【代码】 | Host/harness；模块内 `WorkRunMaterialCompiler` | 相关主题与历史记录 → active 后继版本材料 | 逐条核授权；不继承工具权限、完成状态或验收结论 | 保留；Dispatch 通过工作材料编译间接使用，不写成直接调用此 Port |
| `ExplorationContextCompiler.prerequisites/select/assemble`【代码，当前公开实现】 | DispatchEngine 的探索驱动 | 探索 scope、报告清单与运行材料 → 前提、选材结果或有界 bundle | 不调用 Control、不签授权、不启动模型；选材后由 Dispatch 签发精确 grant，再调用 assemble | 保留公开实现；共同读取迁入内部。Human 调用的是 Dispatch 提供的 `ExplorationContextDrivePort.prerequisites`，不反写成本模块提供的 Drive Port |

**接口命名口径**：**契约中没有名为 `ContextCompiler` 的接口**（架构稿 §11.2 C-9 如实登记）。实际公共面是多个按消费者划分的 Port 与导出实现；普通派发使用 `TaskContextPort`，不能把其他用途都叫作该 Port 的别名。架构名义名 `ContextCompiler.assemble(request) → ready／needs_material／rejected` 只作对照。共享字段、拒绝与状态语义沿用现有契约，本页不复制 wire schema。

**内部映射**：上表和 §4 已被其他模块直接消费的 Port／导出类是**当前公开实现**，迁移完成前保留；对应文件内的材料读取、精确引用、缺口归一、预算与增量刷新步骤是目标内部共用实现，不构成新的跨模块接口。不能仅因实现文件被 export 就再提升一层永久公共门面。

**各 Port 的 owner／消费者／替换关系方向（I1 要求）**

| Port | owner | 消费者 | 替换关系方向 |
| --- | --- | --- | --- |
| `TaskContextPort` | ContextCompiler | DispatchEngine（派发收口） | 生产入口；**本次保留并增字段**，不新增统一门面 |
| `PlanningMaterialPort`／`PlanningContextPort` | ContextCompiler | 前者供 PlanCompiler 与 Dispatch 的计划任务路径；后者供 Host/harness 规划补料 | 保留材料读取与 bundle 编译两种用途，共用读取/版本/缺口处理，编译器不转给组合根 |
| `assembleRuntimeContext` | ContextCompiler | WorkerRuntime | 当前公开实现保留，内部共享读取/校验/预算支持 |
| `VerificationContextPort`／`RunOutputMaterialPort` | ContextCompiler | VerificationEngine | 按消费者保留；VR-01／VR-02 已按精确身份扩展 |
| `QueryExecutionMaterialPort` | ContextCompiler | WorkerRuntime（只读 Query） | 可选 `readFact`；I 阶段候选，**尚未独立接纳** |
| `ReviewerContextPort`（`reviewer-context.ts`） | ContextCompiler | VerificationEngine／DispatchEngine 的 Reviewer 路径 | 与 `TaskContextPort` **并行**，不按触发点合并 |
| `ExplorationSessionContextPort`／`HistoryMaterialContextPort` | ContextCompiler | HumanCollaboration | 由消费者专用端口替换，不引入通用门面 |
| `ArchitectureContextPort`／`BaselineEvolutionContextPort`；`SourceGraphContextCompiler`（实现 `WorkspaceReadPort`） | ContextCompiler | 前两者供 ArchitectureReconciler；SourceGraph 实现供 Host 装配与内部图取材 | 分开对账材料与旧 bounded-bundle 读取用途 |
| `WorkRunMaterialCompiler`／`DeliveryMaterialCompiler`／alternative-report 材料面；`CompletedWorkContextPort` | ContextCompiler | 前三者供 DispatchEngine；CompletedWork 供 Host 与模块内部工作材料编译 | 按实际重复情况共用内部步骤，不预先规定最终接口数量 |

**两个维度必须分开表达（触发点不是分组键，架构稿 §6.2）**

| 维度 | 回答的问题 | 取值 |
| --- | --- | --- |
| **触发点**（trigger） | 为什么**现在**需要处理 | 首次启动／恢复／材料变化／压缩后重建／新 Session 接续 |
| **消费用途**（consumer） | 选出的材料**给谁、怎么用** | 执行者开工、Reviewer 独立审查、规划提案、查询回答、对账取材…… |

**不得按触发点把接口合并成五个**：执行者首次启动与 **Reviewer 首次启动**触发原因相同（首次启动），但材料要求不同——后者需要被审对象的**原始见证**、独立性与来源资格要求、结论格式约束；执行者恢复工作则是**触发原因不同**、消费用途相同。按五类触发点直接合并会**丢掉 Reviewer 这类消费者的必要要求**。正确做法：复用共同的材料读取／引用／增量处理逻辑；**请求分别表达触发原因与消费用途**；按实际重复情况合并端口。

**本次变化方向**：见第 7 节。

## 3. 依赖

覆盖 `allowedModuleDependencies[ContextCompiler]` 的全部 4 条边（架构稿 §3）。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| **StateLedger** | `load`／`events` 的只读面（canonical 记录、来源版本、适用性事实） | 精确 canonical 记录、`TaskReduction`／effective Evidence、GoalPhase 等来源事实 | 既有 |
| **ArtifactVault** | `open(ref, accessScope)`（含可选 `currentBasis` 与 `MaterialAccessResolver`）、`put(record)`；`RuntimeObservationJournal` 的独立读对象 | 材料正文与摘要；授权与适用性**由 Vault 判定**（`rejected/stale`、`rejected/invalid`、`unavailable`），本模块不自建授权判定 | 既有 |
| **ReadModelIndex** | 既有 `goal(query)`／`planGraph(query)`／架构审查视图；目标候选 `ArchitectureGraphQueryPort.neighborhood` | 公开投影与图查询结果；不重新实现状态归约；新图查询候选未实现 | 既有（§3.2 语义收紧） |
| **WorkspaceReader** | `read(query) → sourced／unsupported／stale／rejected`；`ArchitectureSourceCapturePort`；role `code` 通道与 `denied-prefixes` | 路径边界内的源码、Git 差异、可用代码／测试索引与图来源；**源码取材一律交 WorkspaceReader** | 既有 |

**明确没有的边**：`ContextCompiler → PlanCompiler`／`→ DispatchEngine`（§6.3"不新增（有意为之）"），也**没有** `ContextCompiler → 角色目录／AgentLifecycle` 的边——选人不经 Context，避免"检索 → 选人 → 再检索"的环。

## 4. 被依赖

覆盖全部反向边（架构稿 §3 依赖 DAG 的反向推导：6 条）。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| **HumanCollaboration** | `ExplorationSessionContextPort`（`exploration-session.ts` 路径）、`HistoryMaterialContextPort`（`history-materials.ts` 路径）；查询材料 | 有界材料与来源清单；历史入口取得公开报告目录后交本模块解析来源与精确授权依据 | 架构稿 §3 依赖 DAG 的反向推导 |
| **PlanCompiler** | `PlanningMaterialPort`；人工计划的 `OperatorPlanningContextPort`；`ExecutionFeedbackContext` | canonical 规划/人工计划/反馈材料与缺口；`PlanningContextPort` 是另行暴露给 Host 的 bundle 编译面 | 架构稿 §3 依赖 DAG 的反向推导；I12 的材料侧 |
| **DispatchEngine** | `TaskContextPort`／`QueryContextPort`／`ReviewerContextPort`；PlanningMaterial 的 `acceptedInitialPlans`；WorkRun/Delivery/Feedback/OrdinaryPredecessor/AlternativeReport 与 Exploration 材料实现 | 当前普通派发装配有界材料后经 startRun 受理才启动；**目标**分开直接续用（绕过编译）、增量刷新与新建编译；缺料不进入模型 | 架构稿 §3 依赖 DAG 的反向推导、§7.4 交互 3；具体调用见 Dispatch §3 |
| **VerificationEngine** | `VerificationContextPort.resolveRound`、`RunOutputMaterialPort` | 完整身份与来源核对、运行产出材料（ReviewWork 输出／PatchRecord／IntegrationResult／`ExecutionNote`） | 架构稿 §3 依赖 DAG 的反向推导；VR-01／VR-02 |
| **ArchitectureReconciler** | `ArchitectureContextPort.assemble`／`BaselineEvolutionContextPort.assemble` | 同版本规范/图来源/证据与精确候选提案材料 | 架构稿 §3.2：既有边，语义收紧 |
| **WorkerRuntime** | `assembleRuntimeContext`；只读 Query 的 `QueryExecutionMaterialPort.readFact` | 本次运行输入与 manifest；按需读取事实位置和来源清单（≤24 条事实引用／QueryRun） | 架构稿 §3 依赖 DAG 的反向推导；`coding-agent-runtime.ts`、`read-only-query-runtime.ts` |

> **宿主边（不计入 38 条）**：`src/app/**`／`src/harness/**`／`src/composition/**`（`owner()` 记为 Host）与契约测试**直接消费既有编译器对象**（如 `planning-context-compiler.ts`）；harness 也可调用图材料编译。宿主与组合根负责接线，不承接模块权威。

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| `ContextBundle`（稳定前缀 + 动态尾部） | 否（有界材料集合，派生） | 本模块编译产出；**正文归 ArtifactVault** | 初始化／运行／挂起·恢复 |
| manifest（`selectedRefs`／`gaps`／`freshness`） | 否（**该表不是新权威**） | 本模块（唯一生产者） | 初始化／运行（随本次编译产生） |
| **初始化选材清单**（`selectedRefs`／`gaps`／manifest 的承载） | 否（实现态） | 本模块；承载＝本次初始消息／编译结果中的引用，必要时记录配置版本 | 创建／运行 |
| **运行中实际读取记录** | 否 | **Kernel／WorkerRuntime 记录，平台只保存引用**（Kernel 已有会话与工具日志）；**平台不重复抄一份** | 运行 |
| **当前可用历史材料索引** | 否（**可重建视图**） | 由**已发生读取与失效信息**形成：Git、文档索引、两张图、Session 查询入口；优先使用现有检索能力 | 运行／挂起·恢复 |
| `WorkContext` 清单与来源 | 否 | 本模块生成（"WorkContext 清单对应实际筛选结果"）；**本模块不拥有 Work 身份** | 创建／运行 |
| `RoleBinding` | 是（**正式关联**；本模块只消费，不因只消费而降级） | ControlEngine 接受与撤销；StateLedger 保存事实；DispatchEngine 在启动与安全检查点核对有效性 | 创建／运行 |

**本模块拥有的对象**：编译产物与其清单（`ContextBundle` 引用、`selectedRefs`／`gaps`／`freshness` manifest）、`WorkContext` 的清单与来源、材料三级判定所需的来源／版本／适用性记录（L3 形状）。**三种记录必须分开**（架构稿 §6.2.3），且**复用既有承载，不新增三个数据库**。

**本模块不拥有的**：Task／Goal 状态与完成资格；Evidence 的适用性；授权判定；Run 身份与租约；Session 身份；Agent 身份；模型输入（最终 `ModelRequest` 由 **WorkerRuntime** 的 `ModelBudget` 再次计量并预留响应空间）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化（项目认知初始化）／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**，不是本模块的对象。

## 6. 旧标识去向

本模块**不持有 `agentId`／`workId`**，因此不承担这两个标识的迁移动作。但属于本模块的那一部分必须表态：

1. **`WorkContext`／`WorkContextBinding` 的清单与来源在本模块生成**（"WorkContext 清单对应实际筛选结果"），**但本模块不拥有 Work 身份**——`WorkContextBinding` 是 canonical，归 **ControlEngine** 归约 + **StateLedger** 原子提交；`workId` 是否与 `taskId` 合并按架构稿 §4.5 的标识取舍表处理，**本模块不先宣布 `workId` 必需**。
2. **新增输入形状（触发原因／增量基线）会使旧形状答案的当前适用性保守失效**：旧正文与持久指导版本仍可读，但**不能把旧答案当当前重新验证**（Q01 复验增量口径）。
3. **不要求每次读取都回送 ContextCompiler 更新清单**（L-1 撤回）。旧标识不因清单维护产生新的回写义务；初始化清单**不能冒充**整个 Session 的消费历史。
4. `AgentInstanceStatus`（含 `retired`／`retiredAt`）与四态**都不在本模块**：本模块只消费 `RoleBinding` 的当前有效性，而有效性核对在 **DispatchEngine**（启动与安全检查点）与 **ControlEngine**（接受／撤销）。
5. 旧记录兼容：`CompletedWork` 的 notes 新增兼容旧正文的可选 `reason`／`alternatives`／`sourceRefs`／`applicableVersions`；旧材料可省略 `kind` 以兼容原契约。**未带新字段的旧持久输入保持原语义，不补造。**

## 7. 本次接口变化方向

**共用与去向**：共同部分具体落在模块内部的材料读取、精确引用与 manifest、缺口保真、预算核算、增量刷新；保留执行、规划、Reviewer、Query、图和历史继承的用途差异。旧全量 `TaskContextPort` 调用按情形迁为直接续用、增量刷新或新建编译；现有用途 Port 在消费者迁移前继续提供，不先造统一总入口，也不要求本阶段冻结全部字段/schema。

`对应项号：I1（含边界收缩 §6.2 与 I9 消费面）｜ 接口：架构名义 ContextCompiler.assemble 与各用途 Port（普通派发走 TaskContextPort）——输入增加触发原因与增量基线，输出增加复用／增量语义，新增"稳定前缀 vs 动态尾部"分离契约，公共面继续是多 Port 且**不预先规定最终接口数量** ｜ 边动作：保留（4 条依赖 + 6 条被依赖全部不变；语义上**切断**"每次 compile 全量取料"与"选人／调度／正式状态归约"两类承载）｜ 理由：前缀复用（A1／A3）＋ 边界收缩（§6.2；架构稿 §9.2 三条判据判定收窄成立）｜ 不变量：#17（复用范围＝推荐线索，历史授权不继承、执行端权限不由 prompt 绕过）、#25（重新装配需金额判据、不得绕过 currentness）、#28（三级材料不得互相冒充）、#18（Kernel 已完成的有效压缩直接使用，不再二次编译）`

## 8. 信息缺口

**对齐架构稿 §11.4.3（引用，不重新推导）**

- **② 各 Port 的精确形状／字段命名／装配点** → 架构稿 §9.2 第 2／4 份契约。本模块既有用途端口的取舍口径是"按实际重复情况合并"，**合并结果本身仍是接口参数**。
- **③ 工作卡片与三种记录的查询接口、筛选字段** → 架构稿 §9.2 第 3 份契约。
- **⑥ 度量口径的具体采集实现**（前缀度量、扫描次数）→ 按 U12 指标表，**标"待测"**，不得以文件数证明收益。
- **⑦ 生产 `lifecycleControl`／continuation 能力开关的放开与 Kernel 接线验证** → §11.4.2 第一行、真实连续任务验收。它决定第 2 类触发点（恢复）与第 4 类触发点（压缩后重建）**是否真的成立**——谎报会让平台跳过必要编译（架构稿 §9.2"必须先改"第 4 项）。

**本模块新增缺口**（§11.4.3 未覆盖）

- **C-5：五类触发点与 8 行触发表尚未对齐**。接口契约 `dev_docs/interfaces/context-lifecycle.md` 的"生命周期事件"列的是 **8 行触发**（正常回复／工具结果／授权内返工、等待／暂停、恢复、容量压力／压缩／rollover、目标／计划／规范变化、故障／转交、完成／取消、后续相关新任务），**没有"首次启动"这一行，也没有"压缩后重建"这个名称**。接口层须把五类触发点与该 8 行表**显式对齐**，并把对齐结果写回接口契约；对齐时**必须保留**"触发点表示可能需要调用，不等于发生一次就必须编译一次"的口径。
- **A1 未落地**：`ContextBundle` 作为唯一材料载体拆为**稳定前缀／动态尾部**尚未实现（当前仍是单一有界材料集合）。
- **角色自动选材／补料未接通**：角色排序定义存在，但秘书／规划／Reviewer 等真实角色的选材与补料闭环仍未完成；"全部角色消费已具备"不能由接口存在推出。
- **真实 provider tokenizer 未配置**：默认值为 `conservative_utf8_estimate`，**与 provider 实际上报用量必须分开**，**不把字节估算称为准确 Token**。
- **L3 的现状限定**：源码中存在 `digest` 被填成 `planId` 或 `digest` 缺失的情况，因此进入接口设计前必须先定义 **`digest` 与 `revision` 各自是什么含义**（内容摘要 vs 版本标识）、**旧数据的兼容规则**、**校验失败时的拒绝规则**——**缺 digest 不是"匹配"**。
- **I-补：精确字段在首个消费者冻结**。本页只给端口名、方向与语义边界，**不冻结 wire schema**（`context-lifecycle.md`："精确字段在首个消费者冻结"）；`TaskContextPort`（P1-03）、`VerificationContextPort`（P1-04／VR 系列）已冻结的签名不得被追溯改写，扩展须版本化。
- **N-3（本目录 `README.md` §5.2）**：AgentLifecycle 候选结果集不完整，其中"复用范围作为推荐线索如何交给 ContextCompiler"与"返回 `needs_material` 后由谁解除等待"**没有唯一落点**。本模块按"推荐线索 + `needs_material` 在模型调用前失败关闭"写，接口协议仍需在第 2／3 份契约中确定。

## 9. 重构目标与质量验收

> 通用依据：[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。本节已纳入本轮模块文档要求；以下均为重构目标与验收条件，**不表示源码已经达成或验收通过**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| 多个消费者编译器重复读取、引用、缺口与预算步骤，但 Reviewer 等用途有独立来源资格和材料要求（§1／§2；S06） | 共用材料读取、引用校验、预算与增量组装；请求同时表达触发原因和消费用途，**不按五类触发点机械合成五个 Port 或一个万能 Port** | 保留普通执行、Reviewer、验证、Query 等真实业务差异；共同步骤收敛后删除各路径的等价副本，旧公开用途端口在迁移期保持兼容 | 关键消费者以相同输入获得等价公共字段，同时 Reviewer 独立性、来源资格和缺料语义不丢失；列出真实消费者与退役副本（RG-01／RG-02／RG-03／RG-04；CQ-01／CQ-02／CQ-03／CQ-04／CQ-08） |
| 现有路径可能每次重新扫描或重建材料，且新增触发原因／增量基线的精确协议尚未冻结（§2／§7／§8） | 成功续用 Session 时默认追加消息并绕过全量 Context 编译；需要刷新时只处理受影响材料，失败或能力不足如实返回 | 复用现有消费路径的共同增量支持；旧全量路径仅在明确条件下保留，不能以新增缓存类或接口减少代替收益 | 同一连续任务记录扫描、读取、token／材料量与准备时间；验证成功续用未进入全量编译，恢复、缺料或基线变化走正确分支（RG-01／RG-06；CQ-06／CQ-08／CQ-09） |
| L1/L2/L3、`selectedRefs`／`gaps`／manifest 有唯一生产与来源边界，选人、派发和正式归约已明确不属于本模块（§1／§5） | 保持材料等级、来源与失败副作用可区分；`needs_material` 必须在模型调用前失败关闭，不新增状态写者或依赖边 | 共同引用与缺口处理替代同义拼装。若当前源码核实存在越界的选人、调度、身份推导或归约副本，待消费者迁移及等价验证后删除；否则只验证本模块未新增这些职责，不把材料选择／来源事实读取误删 | 缺失、stale、越权和等级不足场景均不启动模型；manifest 可回到精确来源；依赖仍与架构目标一致（RG-01／RG-02／RG-03／RG-04；CQ-01／CQ-03／CQ-05／CQ-06／CQ-08／CQ-12） |

**专项验收场景**：成功 Session 续用只追加消息而不做全量 Context 编译；增量基线变化只刷新受影响材料；Reviewer 缺少合格原始见证时在模型调用前返回 `needs_material`，且 L1/L2 不被提升为 L3。

**当前状态**：现有用途编译器、材料等级与部分来源校验已经存在；统一增量协议、成功续用绕过全量编译、旧重复路径退役及成本收益仍待实现或验证。
