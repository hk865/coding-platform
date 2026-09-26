# DispatchEngine Module

```yaml
status: draft-for-review
updated: 2026-09-22
plane: Control
module: DispatchEngine
code_dir: coding-platform/src/control/dispatch-engine/
contract_state: extension draft
upstream: docs/refactor/ARCHITECTURE.md（2026-09-21）
```

> 派发与运行准入：把持久 outbox 意图落实成有权限、有预算、可恢复的 Run，并回交运行事实。分责与边界以 `docs/refactor/ARCHITECTURE.md`（2026-09-21）为准；实现现状见 `my-coding-platform-docs/agent_platform/human/module-status.md`；本页只写本模块的局部设计与跨模块契约，不复述架构文档或产品文档正文。

## 1. 职责

**负责**

**内部责任与共用实现。** `coordination-drive.ts` 目标在模块内分成四类责任：有界扫描/恢复输入、无副作用路由与 Wait 提案、持久 claim/settle/retry 协议、通信结果到执行准入的桥接。普通、并行、Reviewer 与 Handoff 保留各自选择和恢复语义，但共用不可绕过的准备、租约、`startRun` 与事实消费支持；不新增模块或依赖边。

- **一次 `drive` 的执行顺序（本模块最硬的不变量）**：**outbox-before-side-effect**——**未提交 `startRun` 不得产生任何外部副作用**（P1-03 冻结；`contracts/ports.ts` 的 `DispatchPort` 注释即此口径）。**需要编译的派发**按"加载 pending intent → 经 `TaskContextPort` 组装 → 提交 `startRun`（ControlEngine）→ **之后才**调用 `runtime.start`（`RunPort`）"执行；按触发原因分三个分支，**每个分支都保留正式准入与副作用顺序**：
  1. **直接续用**（Kernel 成功恢复原 Session／连续消息追加）：**不重新编译**，不重新取材；
  2. **增量编译**（目标、规范变化）：**只更新受影响部分**，不重装配整套上下文；
  3. **新建编译**（新 Session 初始化或跨 Session 交接）：**完整有界选材**（`TaskContextPort.assemble`）。
- **派发与运行准入**：canonical `dispatchReadiness` 求值 + `claimTask` 唯一领取（唯一领取 + 租约 + attempt + run + durable outbox 同原子提交）；**不用 UI 矩阵充当派发守卫**（架构稿 §4.1 阶段 3「进入条件：`capabilities()` 声明 + `preflight` 通过 + 唯一 Writer 租约可用」）。
- **持久 outbox 协议**：`dispatch-engine.ts` 保留 pending／started／consumed 的推进协议与持久退避；backlog 从持久 pending 计算，宿主 deadline timer 只触发扫描。
- **三条生产 `runtime.start` 路径的承载**（现状，非目标口径）：普通／协作（`dispatch-engine.ts` 的 `DispatchEngineImpl.drive`／`driveOrdinary`）、独立 Reviewer（`reviewer-dispatch.ts` 的 `ReviewerDispatch`）、换手（`handoff/handoff-drive.ts` 的 `HandoffDriveEngineImpl.driveHandoff`）。收敛方式见 §7（C-13，**待定项**）。
- **运行事实的消费与对账**：`consumeDispatchedRun`（`dispatch-engine.ts`）消费 `RunHandle.pollFreshEvents` 经 `runFact` 回交；`RuntimeDispatchPort.recover`（`runtime-dispatch.ts`）只处理完整 Project／Workspace 匹配的记录、按 canonical revision 接受尚未提交的事件。**已知／未知副作用必须区别处理，不自动重跑未知执行。**
- **运行期门控与容量**：`execution/` 共享本地容量（`execution-slots.ts`）、执行代际（`runtime-entry.ts`）、模型许可（`model-call-access.ts`）与持久退避（`dispatch-retry.ts`）；跨进程最终排他仍由 Control／Ledger 与 Workspace lease 确认。
- **换手资格与来源**：`handoff/` 独立维护换手资格与来源（`handoff-preparation.ts`、`handoff-request.ts`）；换手的正式事实由 ControlEngine 的 `recordHandoff`／`claimReplacement` 归约（架构稿 §4.1 阶段 4「恢复入口与后继 Run」）。
- **派发收口落实 Session 创建／打开与配置、任务关联，并启动执行**（架构稿 §7.4 交互 3「在派发收口落实 Session 的创建／打开与配置、任务关联」；架构稿 §9.1 本模块「替换」列：派发收口按 **Session** 组织，而不是每次重建工作身份）。
  - **Session 创建／打开的分工是「由 DAG 推导的结论」，本轮必须显式标注**：AgentLifecycle 决策 → **DispatchEngine 在派发收口经 WorkerRuntime 调 Kernel 适配接口创建／打开** → 平台只保存**引用与映射**。推导依据：`AgentLifecycle` 的三条出边是 `ControlEngine`／`StateLedger`／`ReadModelIndex`（架构稿 §3.2），**没有** `AgentLifecycle → WorkerRuntime` 边，本轮**不新增**该边，所以真正的创建／打开调用只能落在派发面。R-5 口径：**映射本身不是幂等**，"**创建请求重试不产生两份会话**"才是幂等问题。
- **真实 Run 工作身份在派发收口建立**：**组装成功之后、`startRun` 之前**，经 ControlEngine 的权威解析面（`resolveTaskWorkIdentity`）解析；按解析结果分阶段处理，**可写的身份准入阶段与只读的材料消费阶段规则不同**（`work-identity.ts`／`work-material-drive.ts` 文件头即此口径）——见 §2 的处理表。
- **按矩阵 pin 签发角色绑定**：`issueMatrixRoleBinding`（`role-spec-read.ts`）——只读签发、结果自带来源；**签发不代替守卫**（见 §2、§6）。
- **目标变更的控制交接执行**：ControlEngine 受理变更并确定**停派状态与控制意图**后，由本模块执行控制交接——按停派范围停止受影响 Run 的后续派发、对新 Run 维持守卫、把控制请求交给 WorkerRuntime、**由 WorkerRuntime 向 Kernel 发请求并回传结果**，回传结果由 Control 归约；**无关 Run 继续**，迟到结果交 Control 的迟到结果守卫（`docs/PRODUCT.md` §5.5）。
- **返工驱动**：`rework-drive.ts` 接收**组合根提供**的 `issueMaterials`，缺问题材料明确返回 `unavailable`；不得把来源 Plan 失效等同于义务已处置。
- **不持有 canonical**：所有正式状态仍经 Control 命令提交（`claimTask`／`startRun`／`runFact`／`submitControl` 一类）；本模块持有的是**运行侧协议与门控**（持久 outbox 协议、容量／执行代际／模型许可／持久退避、换手资格与来源）。

**不负责**

| 不负责什么 | 归属 |
| --- | --- |
| **不自行选人**：用哪个角色配置、创建还是复用哪条 Session、关联哪些必要任务 | AgentLifecycle：`decide(request) → reuse_deferred／reuse_selected／needs_material／rejected`（架构稿 §3.2 第 1 条；本模块只消费决策并在派发收口落实） |
| 不写 canonical 状态、不生成 snapshot／Event | ControlEngine（`claimTask`／`startRun`／`runFact`／`submitControl`）+ StateLedger 原子提交（不变量 #1／#3） |
| 不取材、不组装 `ContextBundle`、不产出 `selectedRefs`／`gaps`／manifest | ContextCompiler（`TaskContextPort`／`QueryContextPort`／`ReviewerContextPort`／`WorkRunMaterialCompiler` 等；`selectedRefs`／`gaps`／manifest 的唯一生产者） |
| 不执行模型与工具、不探测运行能力、不持有 `RuntimeRecord` | WorkerRuntime：`RunPort.capabilities/start` 与 `RunHandle` 事件、`RuntimePreparationPort`、`HandoffControlPort.snapshot` |
| **不回调 VerificationEngine**、不查询验证 journal、不持有未处置问题清单 | 组合根捕获问题材料后经 `issueMaterials` 传入（`harness/rework-composition.ts`）；只读出口在 VerificationEngine（`/api/real/rework/issues`） |
| 不自动重跑未知执行、不把未完成上传伪装成已完成 | 未知执行保持待对账（ControlEngine 的 `reconcileControlIntent` 路径）；Host 关闭先停止 HTTP 受理、排空 Runtime，失败如实返回 |
| 不用 UI 矩阵或展示层材料充当派发守卫 | 准入判据只有 canonical `dispatchReadiness` + `claimTask`（ControlEngine） |
| 不自造身份、不发明 `workId`、不按推导 id 硬写 | ControlEngine：`bindWorkContext`／`linkWorkRun`／`resolveTaskWorkIdentity` |
| 不持有正文存储、不判定材料授权适用性 | ArtifactVault：`put(record)`／`open(ref, accessScope)`（授权由 Vault 判定；本模块只在 admission 前准备精确授权并把结果交 Vault 复核） |
| 不规划、不生成候选计划、不编译返工提案 | PlanCompiler：`request`／`requestInitial`／`accept`；返工纯编译 `ReworkPlanCompiler`（`plan-compiler/rework-plan-compiler.ts`，零写入） |
| 不裁决完成、不制造 Evidence、不组织检查轮次 | VerificationEngine（检查／审阅 journal）+ ControlEngine（`submitEvidence`／`reduceTask`／`reduceGoal`） |
| 不做跨项目复用判定 | AgentLifecycle（首版不做；跨项目请求**显式拒绝并说明原因，不静默降级**） |
| 不激活 baseline、不写治理 | ControlEngine：`install`／`activate`（CAS 激活） |

## 2. 对外接口

**接口命名口径**：以真实 Port／实现名为主；架构名义名用括号对照，例如 `DispatchPort.drive`（架构名义名「唯一派发入口 `drive(trigger)`」）。

**「唯一派发入口」必须读成目标口径，不是现状**：源码存在**普通／协作、Reviewer、Handoff 三条生产 `runtime.start` 路径**（`dispatch-engine.ts`、`reviewer-dispatch.ts`、`handoff/handoff-drive.ts`），C-13 已登记；两种收敛选择与迁移要求见 §7，**属待定项**。

| 提供接口（现状/目标） | 调用者 | 输入 → 输出 | 必要约束与错误 | 本次变化/旧调用去向 |
| --- | --- | --- | --- | --- |
| `DispatchPort.drive(trigger: DispatchDriveTrigger) → DispatchDriveResult`（现状） | 宿主／协调驱动 | 持久 outbox 的一次推进 → 扫描、启动、完成与失败统计 | `outbox-before-side-effect`；现有 P1-03 流程仍对需运行项装配材料，不具备按 Session 直接续用/增量编译分支 | 保留入口；目标结果新增 `direct_reuse`／`compile_required` 一类决策与理由（名称未冻结），旧调用者继续调 `drive`，不得把目标行为冒称现状 |
| `WorkspaceDrivePort.driveParallel`（现状） | 宿主工作区扫描器 | 作用域触发 → `DispatchDriveResult` | 只推进指定 Project/Goal；与普通入口共用额度、准备、准入与事实消费 | 保留当前公开入口；目标可保留多入口但不得保留两套准入语义 |
| `HandoffPort.driveHandoff`（现状） | HumanCollaboration／宿主换手流程 | 换手触发 → 后继 Run 驱动结果 | 旧 Run 不得覆盖新状态；普通扫描跳过 ReplacementAttempt | 保留换手语义；共用准备/准入支持 |
| `ReviewerDispatch.drive/recover`（现状公开类入口） | Verification/Human 流程的宿主适配 | 独立审阅工作 → 驱动或恢复结果 | 普通派发不领取 ReviewWork；unknown 不默重跑 | 保留 Reviewer 独立性；共用执行支持但不合并业务语义 |
| `RuntimeDispatchPort.drive/recover`（现状） | 宿主恢复与对账扫描 | 精确 Run/作用域 → 运行或恢复结果 | scope 必须完整匹配；无法证明完成时待对账，不重执行 | 保留恢复面 |
| `PlannedTaskDispatch`／`OperatorDispatchPort`（现状公开类/Port） | 宿主计划任务与人工任务入口 | assignment/人工请求 → claim、派发或取消结果 | 计划 revision 一致；取消绑定完整 RunRef；能力缺失返回 unsupported | 保留真实入口；内部复用统一 claim/start/事实消费 |
| `ExplorationContextDrivePort.prerequisites`（现状公开面） | HumanCollaboration | 探索请求 → 前置条件/材料缺口 | 只读前置检查；实际选材仍经 ContextCompiler；不授予写权限 | 保留真实被依赖入口；`assembleRun` 留作内部派发实现 |
| `SnapshotPort.snapshot`（契约已有，真实 provider 未接） | 宿主公开快照入口；HumanCollaboration【目标消费】 | `PublicSnapshotQueryV1` → `PublicSnapshotResultV1`（report／unsupported／stale／rejected） | 本模块目标适配 Runtime 公开事实，不读取隐藏上下文、不裁决 Task 完成；与 `HandoffControlPort.snapshot` 的请求/结果形状不同 | 沿用 `contracts/query-job.ts` 的既有契约；当前组合根默认 stub 返回 unsupported，目标补真实 provider 与转发接线，不新增平行契约 |

**内部映射与消费面**

| 内部类／端口 | 责任与去向 |
| --- | --- |
| `issueMatrixRoleBinding` | 当前模块内签发支持；签发不代替 Control 权威 guard。 |
| `coordination-drive.ts` 及 rework/successor/work-material/alternative/leased-runtime seams | 按扫描、纯提案、持久协议和准入桥接拆责并共用支持，不提升为公共 Port。 |
| `RuntimePreparationPort`／`HandoffControlPort.snapshot` | WorkerRuntime 提供、本模块消费，归 §3。对人的快照沿用已有 `SnapshotPort`；目标适配 Runtime 的公开结果，不直接混用两套请求/结果类型。 |
| `ExplorationContextDrivePort.assembleRun` | 模块内部派发实现；`prerequisites` 因 HumanCollaboration 真实消费而保留在公共表。 |

**工作身份的两阶段处理（`resolveTaskWorkIdentity` 的结果分派，逐字照抄源码取值）**

| 阶段 | `resolved` | `absent` | `unavailable` |
| --- | --- | --- | --- |
| **可写的身份准入阶段**（`work-identity.ts`；组装成功之后、`startRun` 之前） | **直接使用**该身份 | **建立**身份（按推导规则兜底，只是兜底、不是身份的唯一来源） | **拒绝派发**（`work_identity_unavailable`），不硬写新身份 |
| **只读的材料消费阶段**（`work-material-drive.ts`） | **可用** | **不可用**：报错，**不得自行建立身份** | **不可用**：报错，**不得自行建立身份** |

**两种情况必须能区分**：① **首次建立成功**（准入阶段 `absent` → 建立 + 提交，材料阶段随后读到 `resolved`）；② **存储不可用时零创建**（准入阶段 `unavailable` → 拒绝，全程不产生任何身份）。材料消费是只读阶段，**两种失败都不能自行建身份**。

**本次变化方向**：见 §7（此处只写一句指引，细节放第 7 节）。

## 3. 依赖

`allowedModuleDependencies[DispatchEngine] = { ControlEngine, ContextCompiler, WorkerRuntime, ArtifactVault, StateLedger, PlanCompiler, AgentLifecycle }`——**7 条边**，其中 `DispatchEngine → AgentLifecycle` 为本轮**唯一新增**边。

| 依赖的模块 | 依赖哪个接口 | 传递内容 | 边状态 |
| --- | --- | --- | --- |
| ControlEngine | `Pick<ControlEngine,'dispatchReadiness'\|'claimTask'\|'closeQueryJob'>`、`'startRun'\|'runFact'`、`'submitControl'\|'reconcileControlIntent'`、`'bindWorkContext'\|'linkWorkRun'\|'resolveTaskWorkIdentity'`、`'acceptReworkProposal'`、`'grantMaterialAccess'`、`'authorizeModelRequest'` | 派发准入与唯一领取、运行启动与事实回交、控制意图对账、工作身份权威解析、返工受理、材料授权记录、模型调用许可 | 既有 |
| ContextCompiler | `TaskContextPort`（`dispatch-engine.ts`）；`PlanningMaterialPort.acceptedInitialPlans`（计划任务）；`QueryContextPort`（`query-drive.ts`）；`ReviewerContextPort`（`reviewer-dispatch.ts`）；`WorkRunMaterialCompiler`／`FeedbackMaterialCompiler`／`DeliveryMaterialCompiler`／`OrdinaryPredecessorMaterialCompiler`（`work-material-drive.ts`）；`ExplorationContextCompiler.prerequisites／select／assemble`（`exploration-context-drive.ts`）；`RuntimeContextMaterials`（`leased-worker-runtime.ts`） | 当前普通派发装配材料；目标只在需编译分支取得有界材料与三态结果，直接续用普通消息绕过编译；缺口作为持久退避原因回传 | 既有 |
| WorkerRuntime | `RunPort.capabilities/start` 与 `RunHandle.pollFreshEvents/pollModelRequestEvidence`；`RuntimePreparationPort.all/preflight/prepare`；`RuntimeReconciliationPort.cancel?/all/markUnknown`；`ReadOnlyQueryPort`；`HandoffControlPort`；`LifecycleControlPort`／`ContextContinuationPort`（生产接线待完成） | 真实启动与事件/调用证据、准备与对账、只读 Query、控制/快照、接续能力与结果 | 既有（**不新增**反向边；没有 `WorkerRuntime → ControlEngine` 准入边） |
| ArtifactVault | `ArtifactPort.put(record)`／`open(ref, accessScope)` | 消息／报告／delta 一类正文的持久化与按授权读取；admission 前的精确验读 | 既有 |
| StateLedger | `load`／`events`／`pendingDispatchIntents`；`consumeDispatchedRun` 的可选 `ledger` 用于完整 scope 与恢复校验 | canonical 记录、pending outbox 与协调扫描页；正式提交一律经 ControlEngine，**本模块不 `commit`** | 既有 |
| PlanCompiler | `ReworkPlanCompiler`；`resolvePlanningWorkIdentities`；`ExecutionFeedbackCompiler.validate` | 从源计划与问题机械推导返工提案；按权威身份取材；校验执行反馈资格 | 既有 |
| **AgentLifecycle**（新增 Module） | 【设计新增】`decide(request) → reuse_deferred／reuse_selected／needs_material／rejected`（候选接口） | 派发前取"用哪个角色配置、创建还是复用哪条 Session、关联哪些必要任务"的决策与**推荐范围**；本模块据此在派发收口落实并把复用决策与其排除理由记入派发结果 | **本次新增**（架构稿 §3.2 第 1 条） |

## 4. 被依赖

反向表（架构稿 §3 依赖 DAG 的反向推导）共 **1 条 Module 边**。

| 谁依赖它 | 消费哪个接口 | 传递内容 | 依据 |
| --- | --- | --- | --- |
| HumanCollaboration | 现有 `ExplorationContextDrivePort.prerequisites`；`DispatchPort.drive(trigger)`（经宿主装配触达）；`SnapshotPort.snapshot`（目标消费，真实转发未接） | 探索前提与运行触达、公开快照；控制请求经 canonical 准入执行 | 【代码】`interaction/human-collaboration/exploration-session.ts`；目标快照沿用现有契约；架构稿 §3 依赖 DAG 的反向推导 |
| 宿主边（**不计入 38 条**） | `src/app/service.ts`、`src/composition/persistent-platform.ts` 构造 `DispatchEngineImpl`／`RuntimeDispatch`／`PlannedTaskDispatch`／`OperatorTaskDispatch`／`ReviewerDispatch`／`HandoffDriveEngineImpl`／`WorkspaceDriveEngineImpl`／`LeasedWorkerRuntime`／`ReworkDriveEngine`，并在 `continueEndedRun` 等宿主扫描里触发同一职责 | 装配、HTTP 适配、扫描唤醒、关闭排空；**不承接模块权威**，也不构成 Module 间依赖边 | 架构稿 §3.1「三种边必须分开」 |

## 5. 状态归属

| 状态／对象 | 是否 canonical | 权威来源 | 归属生命周期阶段／动作 |
| --- | --- | --- | --- |
| 持久 outbox intent（pending／started／consumed）与其推进协议 | intent 本身是 canonical；**协议**属本模块 | ControlEngine 的 `claimTask`／`startRun` 原子提交（StateLedger）；本模块只持有执行协议与顺序 | 创建（执行侧）／运行 |
| 本地容量、执行代际、模型许可、持久退避（`execution/`） | 否（门控与观测） | 本模块内部状态；跨进程最终排他由 Control／Ledger 与 Workspace lease 确认 | 运行 |
| 换手资格与来源（`handoff/`） | 否（资格判定） | 本模块独立维护；正式换手事实由 ControlEngine 的 `recordHandoff`／`claimReplacement` 归约 | 挂起·恢复／重新启用 |
| `RunSnapshot.status`（running／ended 与五种终态） | 是 | ControlEngine 纯函数 fold；本模块只回交 `runFact` | 运行 |
| `TaskLeaseSnapshot.holderRunId` 与读／写租约 | 是 | ControlEngine（`acquireWorkspaceReadLease`／`acquireWorkspaceWriteLease`／`releaseWorkspaceLease`）；本模块在启动前核对，失败即回交 known failure | 运行 |
| `RuntimeRecord`／执行事件与公开快照 | 否（观测） | WorkerRuntime（`RunHandle.pollFreshEvents`／`HandoffControlPort.snapshot`） | 运行 |
| Session 引用与其 Kernel 映射（创建／打开结果） | 是（**正式关联**）；Runtime 暂时返回的 Kernel 引用在受理前只是观测 | ControlEngine 归约平台侧映射（正式关联）；Kernel 拥有正文，平台只保存引用与映射（R-5） | 创建（执行侧） |
| 复用决策与推荐范围（含排除理由） | 否（决策） | AgentLifecycle：`decide(request)`；本模块消费并记入派发结果 | 创建／重新启用 |
| 角色绑定（`RoleBindingRefV1`） | 是（binding 实体） | 本模块**签发**（`issueMatrixRoleBinding`，只读）；ControlEngine 的 claim 守卫**受理** | 创建／四动作·产生 |
| `ContextBundle`／`selectedRefs`／`gaps`／manifest | 否 | ContextCompiler（唯一生产者） | 初始化／运行 |
| 两图与工作卡片的查询投影 | 否（投影） | ReadModelIndex | 全阶段 |

**本模块拥有的对象**：Run 的**执行协议**（outbox 顺序、并发额度、执行代际、模型许可、持久退避）；`DispatchIntentV1` 与 `RunRef` 的关联；换手资格与来源；运行准备的观察面；角色绑定的**签发结果**。

**本模块不拥有的**：Task／Goal／Run／Evidence 的 canonical 状态（ControlEngine + StateLedger）；Session 正文、执行记录、检查点与压缩日志（Kernel，经 WorkerRuntime 适配）；材料与其编译输出 `selectedRefs`／`gaps`／manifest（ContextCompiler）；正文持久化（ArtifactVault）；选人与复用决策（AgentLifecycle）；任务结构与义务（PlanCompiler 提案 + ControlEngine 受理）。

> 生命周期口径（架构稿 §4）：**五阶段**＝创建／初始化（项目认知初始化）／运行／挂起·恢复／销毁＝归档；**四动作**＝产生／拆解／压缩／归档（另 §4.2 列"重新启用"）。四态 `working`／`standby`／`paused`／`archived` 描述 **Session／工作卡片**。
>
> **本模块的归属阶段**：**创建的执行侧**（派发收口落实 Session 创建／打开与配置、任务关联）、**运行**（唯一 `drive` 的目标口径与顺序）、**挂起·恢复**（恢复入口与后继 Run）。**压缩的执行**归 WorkerRuntime／Kernel；**平台归档**按 `AgentLifecycle 提案 → ControlEngine 归约 → StateLedger → ReadModelIndex 投影` 链路执行，本模块**消费正式归档状态以阻止普通派发**。

## 6. 旧标识去向

按架构稿 §9.3（七条最小迁移规则）与 §4.5（R-1、标识取舍表）表态，属于本模块的部分如下。

- **`workId` 相关：真实 Run 工作身份在派发收口建立**——**组装成功之后、`startRun` 之前**，经 ControlEngine 的权威解析面解析；按 §2 的**两阶段处理表**分派：准入阶段 `resolved` 直接用、`absent` 建立身份、`unavailable` 拒绝派发；材料消费阶段只有 `resolved` 可用，**两种失败都不自行建身份**，绝不静默退回"没有材料"（`work-identity.ts`／`work-material-drive.ts` 文件头）。本模块不发明身份、不按推导 id 硬写。
- **`bindWorkContext` 的重构方向**：现有实现扫描账本（上限 200,000 条）应重构为**直接键查询、必要索引与稳定关联**（架构稿 §4.5 末注）；本模块是它的消费方，重构不改变"身份权威在 Control"的前提。
- **`WorkContext` 与历史材料在派发时编译进既有 ContextBundle**：选材理由、来源版本与资格写入 manifest；历史材料的资格在类型层面只有 `historical_explanation` 一个取值，材料侧不写也不改 `manifest.permissions`。
- **撤回"每条消息先做身份登记／绑定签发"**：普通工作按"**创建／解析 Session → 选择配置 → 关联必要任务 → 启动执行**"进行，轻量实例标识只服务于收件、运行与记录区分（架构稿 §4.1 阶段 1「边界」、架构稿 §9.1 本模块「收窄」列）。本模块不为普通派发补一道身份仪式。
- **`agentId`**：本模块不持有、不签发；有消费者时的轻量运行实例／通信参与者标识由 ControlEngine 的 `registerAgentInstance`（CAS@0）在有需要时登记。
- **旧事件语义不变**：既有事件不可原地改变 v1 含义，演进必须新增 `schemaVersion` 与兼容策略，未知版本继续拒绝（架构稿 §7.3）。
- **Kernel 原始记录与平台正式状态不是同一事务**：先有可定位的 Kernel 结果，再**幂等**接纳为平台事实；**创建请求重试以"不产生两份会话"为幂等判据**（R-5）；中断按事件 ID／游标对账，副作用未知就核对、**不自动重跑**（不新增第二套事件框架、不新增跨系统事务框架）。
- **映射本身不是幂等**：平台保存的是 Session 引用与映射；本模块只负责"重试不产生两份会话"，不承担映射的幂等判定（R-5）。

## 7. 本次接口变化方向

**新增/复用/迁出或删除。** 目标扩展 `drive` 的决策结果并接入 AgentLifecycle；复用普通/并行路径已有的准备、租约、准入与事实消费支持到 Reviewer/Handoff 的适用部分；把 `coordination-drive.ts` 的扫描、纯提案、持久协议和准入桥接拆为内部责任。旧的每次重建工作身份与材料、以及绕过共用准入的启动分支在迁移完成后删除。当前源码尚未实现直接续用或该内部拆分。

对应项号：**I2（主）／I9 的签发面** ｜ 接口名：`DispatchPort.drive(trigger) → DispatchDriveResult`、`issueMatrixRoleBinding` ｜ 方向：`drive` 的结果在保持 outbox-before-side-effect 顺序不变的前提下**包含角色配置／Session 复用决策与推荐范围**（用了哪个配置、延续还是新建 Session、为什么、推荐哪些来源入口），**trigger 语义扩展**（区分"直接续用"与"需要编译"的触发原因），**并声明多入口的收敛方式**——(a) 统一公开 `drive`，内部按运行类型分派；或 (b) 保留多入口，但共用不可绕过的准入、Session 占用、授权与租约逻辑（C-13，**待定项**，需附真实生产调用点的迁移清单，不能只改普通 Worker 而让 Reviewer／Handoff 留在旧语义）；`issueMatrixRoleBinding` 的签发面按 I9 保持"取自 pin、`policyRevision` 记录签发依据、`source: 'matrix' \| 'static-fallback'`、**签发不代替守卫**"的现形状不变 ｜ 边动作：**新增** `DispatchEngine → AgentLifecycle`（§3.2 第 1 条，7 条依赖中的唯一新边）；其余 6 条依赖边**保留**，**不新增** `DispatchEngine → VerificationEngine`、也不新增任何别的边 ｜ 理由：C1 与审阅 §4.5——派发前必须能取到复用决策，否则"连续复用为默认"没有落点；而 C-13 说明"唯一入口"当前只是目标口径，不声明收敛方式就会留下两套语义 ｜ 不变量：**#1／#3／#15／#17**（顺序与准入另涉 #7；派发结果承载复用决策另涉 #6 的来源绑定）。

## 8. 信息缺口

- **对齐架构稿 §11.4.3**（引用，不重新推导）：① 持久字段、主键与基数约束（Session 承载形态、Agent 实例标识、旧标识兼容映射）→ 架构稿 §9.2 第 1 份契约；② 各 Port 的精确形状、字段命名、装配点（含 Kernel 适配面"创建／打开、消息、执行、控制、状态、增量事件"的划分）→ 架构稿 §9.2 第 2／4 份契约；④ 迁移切换点、删除顺序与回滚方式（**含普通／Reviewer／Handoff 调用点**）→ 架构稿 §9.2 第 4 份契约与 Prompt 6（重构计划）；⑥ 度量口径的具体采集实现（扫描次数、前缀度量）→ 按 U12 指标表，标"待测"；⑦ 生产 `lifecycleControl`／continuation 能力开关的放开与 Kernel 接线验证 → §11.4.2 第一行，真实连续任务验收。
- **本模块新增缺口**：
  1. **C-13 收敛方式待定**：三条生产 `runtime.start` 路径的取舍 (a)／(b) 未定，迁移清单与删除点属 架构稿 §9.2 第 4 份契约；本模块文档只写"目标口径 vs 现状"，不预先替接口设计作选择。
  2. **问题材料缺失返回 `unavailable`**：`rework-drive.ts` 的 `issueMaterials` 由组合根提供（`harness/rework-composition.ts` → 只读出口 `/api/real/rework/issues`），组合根提供链路与 `issueMaterials` 的精确形状属接口参数。
  3. **取消能力缺失返回 `unsupported`、unknown 保持 unknown**：真实 `lifecycleControl.capabilities()` = `{safePointDelivery:false, pause:false, cancel:false, steer:false, maxSteerPayloadBytes:0}` 且无配置入口；本模块只如实转达，不伪造结果。
  4. **同 Run 暂停／热恢复仍缺**（`human/module-status.md` 本模块条目：「新 Run 换手及完整宿主恢复已在 M 系列限定范围独立验收；同 Run 暂停／热恢复仍缺」）；恢复入口与 `ContextContinuationResult` 观测路径的绑定属 架构稿 §9.2 第 2 份契约。
  5. **C-10**：`control-engine/policies/**` 被本模块（与 PlanCompiler）直接 import（控制面内部策略，非声明接口）→ 按 架构稿 §9.1 收窄列／§11.4.2 C-10 处理：**有权威业务含义的内部策略改为窄接口，共用纯计算下移到合适归属**，不堆进 Contracts。
  6. **C-9**：契约中无名为 `WorkerRuntime` 的接口，能力面分散在 `RunPort`／`RuntimePreparationPort`／`RuntimeReconciliationPort`／`HandoffControlPort`；本模块消费的是这组分散端口，端口与装配位置表属 架构稿 §9.2 第 4 份契约。
  7. **宿主扫描与关闭语义已实现但不在本页展开**：`DurableWake` 只合并同一作用域的扫描唤醒，关闭先停止 HTTP 受理、排空 Runtime 再关资源；这些是宿主行为，不计入 38 条依赖边。

## 9. 重构目标与质量验收

本节已纳入本轮模块文档要求；通用依据见[代码规范、重构目标与质量验收](../../CODE-QUALITY-GUIDELINES.md)。以下均为目标，**源码达成待验证**。

| 当前问题／依据 | 本次目标与改动边界 | 共同实现与旧路径去向 | 验收证据（关联规则） |
| --- | --- | --- | --- |
| §1/§8 有普通、Reviewer、Handoff 三条生产 `runtime.start`，`coordination-drive.ts` 混合四类责任 | 分开扫描/恢复输入、纯路由/Wait、claim/settle/retry、准入桥接；不新增模块或边 | S05 共用适用路径的 Session 占用、授权、租约、`startRun` 和事实消费；审阅隔离、换手来源、恢复差异保留 | 三条路径逐条验证准入顺序、拒绝、恢复和副作用，不能只测 helper 被调用（RG-01、RG-02、RG-05；CQ-01、CQ-02、CQ-07、CQ-08；S05） |
| §2 的目标唯一 `drive` 与现状多入口尚未二选一 | 可统一公开入口或保留多入口，但均须写清触发、结果、等待/重试和启动副作用，不先造万能 Port | 统一时迁移并删除旧调用；保留时共同消费 S05，不能形成第二准入权威 | 迁移表覆盖真实调用者、兼容期、切换和回滚；保持 13 模块/38 边目标（RG-03、RG-04；CQ-03、CQ-04、CQ-12；S05） |
| §1/§8 要求 Lifecycle 先决策，绑定/目标变更/迟到结果仍复核；重复准备收益未测 | 只消费 Lifecycle 决策并执行已受理控制意图；不替其决策、不替 Control 归约、不沿用旧授权 | 旧选人/Session 推导在接线后退役；角色政策经 S02，最终守卫与同义准备归 S05 | 覆盖无 Session、绑定失效、Session 已占用、停派迟到、`unsupported`；测扫描页数、读写和启动/恢复成本（RG-01、RG-03、RG-06；CQ-04、CQ-06、CQ-09；S02、S05） |

专项关注：三条生产启动路径须逐条迁移，均不可绕过准入、Session 占用和写租约。状态：入口取舍、迁移顺序和成本待验证。
