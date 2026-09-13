# 入口迁移清单（M01–M06 制票依据）

来源：本批第 2 次有界只读调查（产品根全仓 grep，排除 node_modules/.local/dist）。
用途：M01–M06 制票时引用**真实文件与行号**，不重新全量调查。**本文件不是 Ticket，也不是完成声明。**

## 0. 三条直接影响制票的结论

1. `WorkspaceDrive.driveParallel` 与 `HandoffDrive.driveHandoff` 当前**生产调用点为 0**（唯一调用者在 `tests/`）；
   ordinary drive 与 `driveParallel` 扫描**同一个** `pendingDispatchIntents({workKind:'ordinary'})`。
2. 生产取消**只有一条**路径：`/api/real/cancel` → `OperatorTaskDispatch.cancel` → `real.runtime.cancel`；
   **直连 Runtime、不写 desired state**。desired-state 面（`submitControl`）在 `src/app` 内 **0 调用点**，目前纯 harness。
3. 三个进程内 queue 全部私有且只承担本地互斥：`planningQueue`、`semanticReworkQueue`、`RuntimeDispatch.queue`。
   它们是 M05 要逐个撤掉**状态责任**的精确定位。

## 1. 入口主表

| # | 入口 | 定义位置 | 正式组合根调用者 | 仅 harness | 消费的 pending | 进程内并发控制 | 可用性 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | `DispatchEngineImpl.drive` | `src/control/dispatch-engine/dispatch-engine.ts:31/:34` | 经 `RuntimeDispatch`（`src/app/service.ts:186`）；`/api/tasks/run` 直连 `service.ts:719`（夹具） | 否 | `DispatchOutboxEntry`（ordinary） | 无 queue，单次 `maxIntents` 默认 8 | 生产 + 仅夹具 |
| E2 | `WorkspaceDriveEngineImpl.driveParallel` | `src/control/dispatch-engine/workspace-drive.ts:31/:34` | **无**（`src/app` 无引用） | **是** | `DispatchOutboxEntry`（先按 `(projectId,goalId)` 切片） | 单次调用内 `Promise.all`，无跨调用 queue | **仅 harness**（M01） |
| E3 | `HandoffDriveEngineImpl.driveHandoff` | `src/control/dispatch-engine/handoff-drive.ts:46/:49` | **无** | **是** | `DispatchOutboxEntry` + `ReplacementAttempt` | 无 queue | **仅 harness**（M03） |
| E4 | `ReviewerDispatch.drive` | `src/control/dispatch-engine/reviewer-dispatch.ts:26/:29` | `service.ts:456`；恢复 `service.ts:747-748` | 否 | `ReviewWork` | `active: Map` 去重 | 生产可调用 |
| E5 | `QueryJobDriveEngineImpl.driveQuery` | `src/control/dispatch-engine/query-drive.ts:16/:21` | `service.ts:257/384/418/550/576/733` | 否 | `QueryJob`/`QueryRun` | 实例私有 `refs` + `cursor`；**无 queue** | 生产可调用（M02） |
| E6 | `ReworkDriveEngine.driveRework` | `src/control/dispatch-engine/rework-drive.ts:36/:44` | `service.ts:425`（在 `semanticReworkQueue` 内） | 否 | 不扫 pending（材料注入） | 内建 queue + 外层 `semanticReworkQueue` | 生产可调用（M04） |
| E7 | `PlannedTaskDispatch.drivePending`/`.drive` | `src/control/dispatch-engine/planned-task-dispatch.ts:53/:58/:91` | `service.ts:257` → `InitialPlanning.advance()` | 否 | 不扫 outbox（读 `acceptedInitialPlans()` + `Goal.activePlanRevision`） | 依赖外层 `planningQueue` | 生产可调用（M01/M04） |
| E8 | `OperatorTaskDispatch.dispatch`/`.cancel` | `src/control/dispatch-engine/operator-task-dispatch.ts:75/:85/:116` | `service.ts:220`，路由 `service.ts:698`/`:700-705` | 否 | 不扫 pending（请求驱动） | 无 queue | 生产可调用；**cancel 是 M05 对象** |
| E9 | `RuntimeDispatch.drive`/`.recover` | `src/control/dispatch-engine/runtime-dispatch.ts:10/:21/:47` | `service.ts:186`（构造）、`:187`（启动 recover）、`:372`（drive） | 否 | `drive` 全量委托 E1；`recover` 扫 `runtime.all()` | **`private queue`**（`:11`）串行所有 drive | ordinary 的**唯一生产入口** |
| E10 | desired-state 取消面 `submitControl`/`recordSafePointAck` | 契约 `src/contracts/control-intent.ts:130-143/:285-295`；实现 `src/control/control-engine/control-intent.ts` | **`src/app` 内 0 调用点** | **是** | `ControlIntent` | 无（由 Runtime safe point 串行） | **仅 harness**（M05） |

辅助驱动（不扫 pending，登记以免制票时误判）：`ExplorationContextDrive`（`service.ts:222`）、`WorkMaterialDrive`（`service.ts:226`）。

## 2. 三个进程内队列

| 队列 | 定义 | 调用点 | 作用域 |
| --- | --- | --- | --- |
| `planningQueue` | `src/app/service.ts:258` | `:263`、`:264` | `advancePlanning()`（`:260-267`）内串行所有规划推进 |
| `semanticReworkQueue` | `src/app/service.ts:408` | `:411`、`:445` | `triggerRework()`（`:409-449`）内；叠在 `ReworkDriveEngine.queue` 之外（**两层串行**） |
| `RuntimeDispatch.queue` | `src/control/dispatch-engine/runtime-dispatch.ts:11` | `:22`、`:43` | 实例私有；所有真实 Run 的 ordinary drive 经它串行 |

同属 M05 观察面但不是队列的进程内状态：`projectionQueue`（`service.ts:114-115`）、`background: Set<Promise>`（`:113`）、
`reviewDrives: Map`（`:450-463`）、`lastReworkDrives: Map`（`:396`，自述非权威、重启即空）。

## 3. 宿主启动恢复扫描（`src/app/service.ts`）

| 阶段 | 位置 | 做什么 | 幂等／未知语义 |
| --- | --- | --- | --- |
| 运行对账 | `:187-189` | `runtimeDispatch.recover(scopes)`；`rejected` 非空即 throw | `prepared`/`running` → `outcome_unknown` 事实，**不重跑** |
| 探索对账 | `:249`→`:251` | `ExplorationStartupReconciler` + `explorations.init()` | 由 ExplorationSession 自持 |
| 审阅恢复 | `:737-756` | 遍历 observations → `reviews` → 过滤 settled → `resumeReview` → `launchReview` → `triggerRework` | `restored: Set` + `reviewDrives` Map 双重去重 |
| 运行后工作重建 | `:759-779` | `recordedChoices` → `choose` → `requestDecision`；再遍历 observations（跳过 `mode` 与 `prepared/running/outcome_unknown`）→ `continueEndedRun`；再逐 Goal `triggerRework`；最后 `project()` + `advancePlanning()` | 每个 Run／决定各自 try-catch，失败只 `console.error`，不阻塞启动 |

注意：`service.ts:614-620` 的 `path.endsWith('/recover')` 是**验证审阅的 HTTP 恢复路由**，不是宿主启动扫描，制票时勿混用。

## 4. 两条取消路径

| 路径 | 链路 | 现状 |
| --- | --- | --- |
| A 直连 Runtime（生产唯一） | UI → `POST /api/real/cancel`（`service.ts:700-705`）→ `OperatorTaskDispatch.cancel`（`operator-task-dispatch.ts:116-121`）→ `CodingAgentRuntime.cancel`（`coding-agent-runtime.ts:163-167`，置 `cancelRequested` + `abort('user_cancel')`） | **不是** desired-state-first；不写 ControlIntent；`RunPort` 本身只暴露 `capabilities/start`，无 cancel |
| B ControlIntent desired-state | `h.submitControl` → `control-engine.ts:411` → `control-intent.ts`（`desiredState:'cancelled'`）→ `lifecycle-control-adapter.ts:16` `apply` + `recordSafePointAck` | **仅 harness**；`src/app` 零调用点 |

## 5. 只在 harness 的暴露面（生产未用）

```text
h.workspaceDrive.driveParallel      persistent-harness.ts:644    src/app 无引用
h.handoffDrive.driveHandoff         persistent-harness.ts:641    src/app 无引用
h.submitControl / recordSafePointAck / controlTimelineView  :719-721  src/app 无引用
h.lifecycleCapabilities             persistent-harness.ts:722    src/app 无引用
h.reworkDrive / driveRework / reworkView  :657-659              app 用自建 composeReworkDrive
h.publicSnapshot                    in-memory-harness.ts:605    仅内存宿主
h.drive                             :748                        生产仅经 RuntimeDispatch 间接使用；直连仅夹具路由
```

## 6. 对照 M01–M06 的判断点

- **M01**：E2 已实现但 0 生产调用，且与 E1 扫**同一个** pending 面。接生产时必须证明「旧入口与新循环同时触发仍唯一启动」；
  在 M05 之前两者对同一 outbox 存在**竞争窗口**（需 owner 裁决：共存或先退役其一）。
- **M02**：E5 的 `refs`/`cursor` 是**实例私有**，in-memory 宿主每次 drive 新建实例（`in-memory-harness.ts:600`），
  persistent 宿主单实例（`:569`）。制票需明确以哪个为生产语义（**需 owner 裁决**）。
- **M03**：E3 与 E4 互不重叠；`reviewer-dispatch.ts:14` 复用 `consumeDispatchedRun`。
  「replacement 与 ordinary 不抢同一工作」的证据由 E1 `:52-57` 的前向跳过 + E3 `:73-84` 的反向守卫共同给出。
- **M04**：E6 不扫 pending，只在验证归约后被组合根触发（`service.ts:425/750/775/577/389` 共 5 个触发点），写入只走 `acceptReworkProposal`。
  「唯一 scheduler 消费」应点名 E7 + E9。
- **M05**：三个 queue（§2）+ E10 未被生产使用，是撤除状态责任与取消统一的精确定位。
- **M06**：当前**无 any-wait 入口**；`RuntimeDispatch.queue` 是唯一把所有 ordinary 运行串行的地方，
  引入 any/all 语义前必须先说明它与该 queue 的关系。

## 7. 未决项（需 owner 裁决，不是新需求）

1. `driveParallel` 接入生产后，E1 与 E2 是否共存（M05 之前对同一 outbox 有竞争窗口）？
2. desired-state 取消（E10）是否新增生产 HTTP 入口，还是把 `/api/real/cancel` 内部改写为 desired-state-first？
3. in-memory 与 persistent 宿主在 E5 上的实例生命周期差异，是否算「生产语义分叉」？

**状态：只读调查结论，未实施、未验证。**
