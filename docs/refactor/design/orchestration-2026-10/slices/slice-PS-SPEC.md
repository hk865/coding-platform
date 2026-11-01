# 采用前停稳（PS）规格

状态：2026-11-02 冻结（Codex 审一轮 11 条、快速核对无新问题；lead 逐行审）。决定 102-4；另开小片，不在 DRV 里。
树：`6d91cf67`，行号按这棵树，施工时按合入树重指。
引用缩写：`DRV` = `refactor/design/orchestration-2026-10/slices/slice-DRV-SPEC.md`；`PL` = 同目录 `slice-PL-SPEC.md`；`SM` = `refactor/STATE-MACHINES-SPEC.md`；`6C` = 同目录 `slice-6-SPEC.md`。

---

## 0. 一页说明（给用户）

**一句话。** 你采用一个会改到在跑任务的新计划时，`plans/apply` 先照常试一次采用；被“还有 Run 没结束”挡住后，给受影响的每个在跑 Run 发一条取消（在下一个安全点生效），这一次返回 `busy`（原因就是 `stopping_affected_work`）、计划记录一个字不写（只写取消控制）；Run 结束后再调一次 `plans/apply`，采用照常提交；若同候选还有未消费的 yielded 等待，下一次仍按守卫 3 返回 `busy`（按 D14/守卫 3 处理）。停下来的 Run 记成“人停的”：指针的发起人是操作者，任务只能由人重新派。

**今天。** 采用只改处置的有痕任务时，只要该任务还有一个 Run 没结束，TASK-19 守卫 1 就返回 `busy`，零写入；平台不会去停那个 Run，要你先手动暂停或取消，再采用（`DRV:413`；守卫实现 `src/core/work-graph/state/plan-machine.ts:660-665`；读事实 `src/core/work-graph/tasks/plan-readers.ts:2147`）。

**改法。** 在 `plans` 端口外面包一层“采用前停”：人采用（操作者 actor）先照常调一次真 `applyPlanChange`；只有它被 TASK-19 的 `busy` 拒时，才读这次候选改到的所有只改处置任务和它们的 Run（§3.2），对每个 `starting`/`running` 的 Run 提交 `cancel`（请求号 `plan-change:<proposalId>:<taskId>:<runId>`，`SM:778`）并投递；有停的返回 `busy`（reason `stopping_affected_work`），没停的原样返回刚才的拒绝。下一次调用的真 apply 停稳了就采用。在 TASK-19 返回 busy 之前就失败的计划不会先停工作；守卫 5/6/7 排在这些 busy 守卫之后，见 L10。不新增记录、持久字段、状态、事件或索引；守卫本体和采用提交顺序保留。

**可见变化。** 一次采用变成两次调用，中间界面显示“采用中，等 X 停下”（`DRV:420`）；停下来的任务在人工停止围栏下，自动返工被拒；`tasks/requeue` 不是所有停下任务的通用下一步：只有 disposition 仍为 `active` 才可 requeue，草稿设成 `deferred` 的要先由后续计划把 disposition 改回 `active`，再由人 requeue（见 §3.11）；也可以由新计划的替代任务继续。自动采用本稿不先停（仍是今天的 `busy` 等待），见 §6 U1。

**不在这次。** 界面（E3）、6C 的受权变更编译器、改在跑任务的执行定义（仍 `revision_conflict`）、任何新持久状态。

---

## 1. 现在怎么走

### 1.1 `busy` 从哪来

- `busy` 不是持久位，是 `CoreError` 闭集成员（`src/contracts/core/results.ts:16`）；每次由事实重算。
- 102-4 点名的“今天仍是 `busy`”是 TASK-19 守卫 1：该任务的每个 Run（跨所有计划）都必须是 `ended`，否则 `{ code:'busy', detail:'task <id> still has an unfinished execution: run <id> is <status>' }`（`src/core/work-graph/state/plan-machine.ts:660-665`；纯函数入口 `:627`）。
- 守卫 1 只在 **只改处置** 的有痕任务上跑：`dispositionOnlyTaskIds` 由 `deriveFuturePlanDelta` 判出，冻结定义里只有 `disposition`、`replacedByTaskId` 不同（`src/core/work-graph/tasks/plan-validation.ts:348-410`，判定在 `:384-394`）；“有痕”= 有任一 Run、TaskLease 或 TaskReduction（`plan-machine.ts:650-652`）。
- 采用时先读这些任务的事实：每个 Task 的全部 Run、选中 Run、Lease、Reduction、指针 ControlIntent（`plan-readers.ts:2147-2152`）；返回 `TracedTaskFactsV1`（`:2141-2145`）。守卫按 taskId 排序跑 8→1→2→2b→3–7（`plan-machine.ts:621-643`）。
- 采用入口 `applyPlanChange`（`src/core/work-graph/tasks/plan-service.ts:1450`）没有内部重试；守卫拒绝经 `refusalOf`（`:2514`）原样变成 `{ status:'rejected', code:'busy', reason }`。路由 `plans/apply` 是 graph write（`src/app/core-routes.ts:484`、`:1334`），`busy` 映射 HTTP 409（`src/app/server.ts:150-168`、`:250`），计划零写入。
- **边界。** 如果计划要改的是在跑任务的 **执行定义**（不是只改处置），走的是另一条无痕规则，返回 `revision_conflict`，不是 `busy`（`plan-machine.ts:599-617`）。102-4 的 b 解决的是 `busy` 这一支；改执行定义仍由 6C 的受权变更编译器负责（`6C:248-253`）。本片不放开它。

### 1.2 谁重试

| 路径 | 今天 `busy` 时 | 重试节拍 | 入口 |
|---|---|---|---|
| PL 候选采用循环 | 保留候选、不写、不转卡；返回 `waiting` + 候选等待依据（含 `Run`） | 无定时；Run/等待事实变化后下一轮（`PL:1129`、`:1151`） | raw `planService.applyPlanChange`；目标级 `workflow/advance` |
| 人采用 | 409 上抛；没有后台循环读“人的采用意图” | 没有；要人再点 | `plans/apply` |
| 现有干预自动采用 | 原样上抛，消息留队列 | 下一趟 Host 心跳（`intervention.ts:325`、`host.ts:1868-1908`） | raw `planService.applyPlanChange` |
| 目标驱动 | 不调 `applyPlanChange`；推进被拒即 `failed` + 一次 `recheck` | 立即一次；之后等提交唤醒 | `workflow/advance`（`collaboration-driver.ts:847`、`:1258-1264`） |

树里没有 PL 的 `decidePlanCandidate` / `adopt_plan` / `plan_adoption_busy`（PL 未合入）；人采用也没有“已决定采用、等停稳”的持久意图：`PlanProposal` 没有 pending/adopting 状态，`DecisionSelectionV1` 没有 `adopt`（`plan-machine.ts:88-107`（状态在 `:95`）；`goal-decisions.ts:122-127`）。

### 1.3 97-1 有什么可以复用，不能直接用什么

- 可复用：96-1/97-1 的安全点判定与证明——`hostClosing` 进程内信号（`src/app/host.ts:714-716`，关闭时 `:2505` abort）、`RuntimeControlCoordinator.decide` 的 `pause` 分支（`src/core/agent-runtime/execution-control.ts:213-217`）、两个真实安全点 `before_model` 与工具组屏障（`src/core/agent-runtime/execution-driver.ts:826`、`:1001`）、`RuntimeControlProof`/`cleanProof`（`execution-control.ts:80-85`、`execution-observation.ts:609-612`）、启动核对的 W-11/W-12/W-20 与 `interrupted_clean`（`run-reconcile.ts:245`、`:412-425`；`run-reconcile-service.ts:856`）、`closeOpenTurn` / `requeueTask`（`ports.ts:113-125`；`requeue-service.ts:939`）。
- 不能直接用：97-1 的关 Host 暂停 **不写 ControlIntent**（`execution-control.ts:214-217` 注释 “no intent is recorded”），Run 仍是 `running`，重启按 W-11 结束为 `crashed`；有在途工具、结果未知则走 W-13（`ended/outcome_unknown`）。它既不是 `cancel`，也不满足守卫 1 的 `ended`，更不能算“人的停止”。本片要的是**持久 cancel 控制**，不是关 Host 暂停。
- 可复用的“停一个 Run”原语：`controls.submitControl`（`control-service.ts:601`）写 `ControlIntentSnapshot` + Run 的 `controlState` 指针（`control-service.ts:4-10`；`control-intent-machine.ts:176-185`）；`runtime.deliverControl` 把 queued 意图送到活句柄（`execution-control.ts:133-169`），对已在安全点停住的 Run 还负责 RUN-23 收尾（`runtime.ts:767-790`）。没有现成的“提交 cancel + 投递 + 等 ended”共享函数（`requestCancel` 是 `collaboration-driver.ts:1277` 的私有闭包；`stopPausedRunInProcess` 只覆盖 paused/live_clean，`run-reconcile.ts:707-722`）。
- **测试夹具正本**（直接用，不再写场景胶水）：`draftFrom`（`tests/scenarios/support/common.ts:532`）从已采用计划生成下一版草稿、`operatorRequeue`（`:198`）以 operator 身份走 `tasks/requeue`、`hostGraph`（`tests/scenarios/support/plan.ts:181`）读 `tasks/query` 的活动计划与任务行、`commitGate`（`tests/scenarios/harness.ts:939`）在每次 durable 提交后、路由继续前按住。采用 helper `hostAdopt`（`plan.ts:192`）要求一次 `committed`，不适合本片“先拒后采用”的两阶段主线；不复制它来绕过中间结果。

### 1.4 文档缺口

- “停稳”全仓只有两处用法（`HANDOFF.md:1722`、`DRV:420`），没有定义；本片自己给可判定条件（§3.5）。
- “人的停止”不是按 `ActorRef.kind` 判，而是按指针 intent 的 `requestedBy` 经 `stopRequesterOf` 派生：`GOAL_FAN_OUT_ACTOR` → `goal_fan_out`，`WORKFLOW_AUTOMATION_ACTOR` → `system`，其余（含 `kind:'system'` 的 Host 操作者）→ `human`（`src/core/work-graph/state/task-failure.ts:104-119`；`task-requeue.ts:35`、`:44-53`）。围栏 `reworkFenceOf` 用同一个派生（`task-failure.ts:148-154`）。

---

## 2. 范围

### 2.1 改动

| 文件 | 改什么 | 为什么 |
|---|---|---|
| `src/core/work-graph/tasks/plan-service.ts` | 新增只读 `readAdoptionStopTargets(ctx, proposalRef)`：读候选、source plan、`deriveFuturePlanDelta`、`readDispositionChangeTaskFacts`，返回只改处置任务及其 Run；挂到 `PlanServicePort` | 停之前要由平台算“哪些任务、哪些 Run 受影响”，不能只信候选里模型写的 `reason.affectedTaskIds` |
| `src/core/work-graph/model/plan-contracts.ts` | 加 `AdoptionStopTargetsV1` 与 `PlanServicePort` 上的只读方法 | 端口类型 |
| `src/composition/plan-adoption-stop.ts`（新） | `createPlanAdoptionStop({ readTargets, apply, controls, runtime })`：先 raw `apply`（不是包装后的 `plans.applyPlanChange`，避免递归）→ 只有 TASK-19 的 `busy` 且 actor 是 human 才读目标、停所有 `starting`/`running`；有停的返回 `busy`（reason 为 `stopping_affected_work`），没停的原样返回；投递被拒也原样返回该拒绝 | 人采用（`plans/apply`、Host 初始化采用）经包装后的 `plans`；Workflow 的自动采用绑 raw `planService`（`create-platform.ts:2654`），不经过本包装；包在端口上只改一处 |
| `src/composition/create-platform.ts` | 构造 `plans`（`:2065`）时直接装好：`adopt = createPlanAdoptionStop({ apply: planService.applyPlanChange, readTargets: planService.readAdoptionStopTargets, controls: rawControls, runtime: runtime.port })`；`applyPlanChange = (...a) => trackedCall(() => adopt(...a), unavailable)`，新增公开读同样过 `trackedCall`；删掉“之后替换 `plans.applyPlanChange` 属性”的写法 | `runtime.port` 在 `:1804` 已建、`:1892` 换入 Host 依赖，都早于 `:2065`；`trackedCall`（`:1750`）把整次调用（含 raw apply 与新增目标读取）计入 `pending`，`close`（`:3426`）关库前等完 |
| `tests/scenarios/PS-adopt-stop.test.ts`（新） | 业务流程行 PS-01…PS-07、PS-09（8 行；独立全 ended 行删除） | 公开入口 |

生产估计 210–290 行；测试估计 300–420 行。

### 2.2 不改

- TASK-19 守卫 1/2/2b/3/4/7 的本体与顺序（`plan-machine.ts:621-703`），以及 `applyFutureRevision` 的读取/提交逻辑（`plan-service.ts:2922-3120`）。
- PL 的 `decidePlanCandidate`、`adopt_plan`、`busy` 行和等待依据（PL 未合入；合入后不改也能用，见 §3.12）。
- DRV 的目标驱动、看守、`stop`/`close`（`DRV` §3.3–§3.5）；本片不调 `workflow/driver-stop`，不 abort 看守 pump。
- 6C 的受权变更编译器、`PlanAdoptionResultV1` 回执、改执行定义/替代任务的完整分类（`6C:248-253`、`SM:770-799`）。
- 界面（E3）、任何新路由、任何通知/卡类型。
- 记录、持久字段、状态值、事件、索引、`PlanTaskPort` 的写方法签名。

### 2.3 术语

- **受影响任务**：本次采用的目标计划相对 source 只改 `disposition`/`replacedByTaskId` 的有痕任务，即 `dispositionOnlyTaskIds`（`plan-validation.ts:384-394`；`plan-machine.ts:650-652`）。
- **受影响 Run**：受影响任务下、`status` 为 `starting` 或 `running` 的 Run（`src/contracts/dispatch.ts:119-120`）。`ended` 的 Run（含 `yielded`、`crashed`、`cancelled`）不在此列。
- **采用调用**：一次 `applyPlanChange(ctx, request)`。人采用经 `plans/apply`（或 Host 初始化采用）到包装后的 `plans`；自动采用经 Workflow 依赖的 raw `planService`（`create-platform.ts:2654`），不经过本包装。
- **Run 停稳 / 采用前安定**：Run 停稳 = 受影响 Run 全部 `ended`（守卫 1 过）；采用前安定 = 再没有 `outcome_unknown`/未核对 Run、没有未消费的让出等待、Lease 已释放（守卫 2/2b/3/4 过，`SM:778` 的“已停下、未满足”行）。不新增判据。

### 2.4 边界

- **和 D14（PL §7.3.1）**：D14 取消的是 **已让出**（`ended/yielded`）的 Run，身份固定 `WORKFLOW_AUTOMATION_ACTOR`，条件限定“候选明确替代且等待消息=候选来源”，明确“不算人的停止”（`PL:1652-1697`、`:1690`）。本片取消的是 `starting/running` 的 Run，身份是采用者本人；两者不重叠。让出的等待本片不停，留给 D14/守卫 3。
- **和 97-1**：97-1 的关 Host 暂停无 intent、不结束 Run；本片用持久 cancel，重启时干净 Turn 的 queued cancel 走 W-12/RUN-23；有在途工具则 W-13、结果未知，等未知结果处理完。两者可以叠加：关 Host 时本片的 queued cancel 留在记录里，下次启动按 W-12/W-13 收尾。
- **和 DRV 看守**：看守只看到 Run 正常结束（`ended/cancelled`）并按 DRV §3.3 的出口结束；本片不碰看守的 pump、`done`、`stopped`，也不写驱动内存状态。
- **和 6C**：`SM:770-799` 的“替代与切换”表就是本片第 1 行（在跑）的完整版本；6C 合入后，本片的 `plan-change:` 请求号、`stopping_affected_work` 原因和“不服务端等待”规则原样复用。本片只实现“在跑→停”和“已停下→采用”，等待/未知两行仍由现有守卫 2/3 返回 `busy`。

---

## 3. 新走法（按真实运行顺序）

### 3.1 调用链

```
人:  plans/apply (HTTP, operator actor)
       -> platform.plans.applyPlanChange = adoptAfterStop(ctx, request)
自动: PL adopt_plan perform (automationContext)
       -> Workflow deps 的 raw planService.applyPlanChange（不经过本包装；仍 busy）
adoptAfterStop:
  1. 非人 actor -> raw apply（不读目标；保持今天 busy）
  2. 人: r = raw apply(ctx, request)
       不是 busy -> return r（committed / invalid / 其它拒绝）
  3. busy -> targets = plans.readAdoptionStopTargets(ctx, proposalRef)
       对 targets 里每个仍 starting/running 的 Run（不依赖哪个守卫先返回）:
         controls.submitControl(cancel) -> runtime.deliverControl(intentRef)
         deliver 返回拒绝 -> return 该拒绝（已提交控制保留）
       有停的（提交且投递成功） -> { rejected, code:'busy', reason:'stopping_affected_work' }
       没有停的 -> return r
  下一次调用回到 2；真 apply 不再被 TASK-19 的 busy 拒时，它自己提交采用。
```

**进入停止分支的条件。** 真 apply 返回 `code === 'busy'` 就读目标，不解析 `reason` 文字，不区分是哪个守卫。不管 `busy` 从哪来（TASK-19 的守卫在 `plan-machine.ts:663`、`:669`、`:675`、`:681`、`:689`），判定都在目标读：目标里没有在跑的 Run，就走“没有停的”，原样返回 `r`。为什么不能只认守卫 1：同一候选改到 A、B，A 已 yielded、等待未消费、B 仍 running，且 A 在 taskId 排序前（`plan-machine.ts:640`、`:643`），真 apply 先返回 A 的守卫 3 `busy`；只认守卫 1 会让 B 永远收不到取消。`SM:787` 规定一次采用里只要还有在跑的就先停。

### 3.2 谁判受影响

`readAdoptionStopTargets` 在 plan-service 内、只读，顺序与 `applyFutureRevision` 的前半一致：

1. `readPlanProposal(records, proposalRef)` 取候选；`basedOn === null`（首份/请求槽）直接返回 `{ tasks: [] }`。
2. `readPlan(records, proposal.basedOn)` 取 source；读失败原样返回 `ReadResult` 的拒绝。
3. `deriveFuturePlanDelta(source, proposal.draft)`；取 `dispositionOnlyTaskIds`（`plan-validation.ts:348-410`）。非 supported 原样返回。
4. `readDispositionChangeTaskFacts(records, proposal.goalRef, source, ids)`（`plan-readers.ts:2147`）取每个任务的 `runs`、`lease`、`reduction`。
5. 返回 `{ tasks: [{ taskId, runs }] }`，只保留 `runs` 非空的任务。

这里不读 `reason.affectedTaskIds` 做判据：它是模型写的、守卫 6 只要求“该列的必须列”，可能多列；平台的判据是 delta 的 `dispositionOnlyTaskIds`（和守卫 1 实际跑的那一组相同）。读本身失败（`not_found`/`stale`/`unavailable`）时，包装层不新增错误，把刚才的 `busy`（即 `r`）原样返回、不停任何 Run，下一次调用再试。

### 3.3 分类（每次调用重算）

| Run 的事实 | 本片动作 | 依据 |
|---|---|---|
| `status === 'ended'` | 不动作 | 守卫 1 已过 |
| `status ∈ {starting, running}` 且 `controlState.desiredState !== 'cancelled'` | 提交 `cancel` + 投递 | `SM:778` 在跑行 |
| 同上但指针已是 `cancelled` | 不重复提交；投递现有 `intentRef`（若还 queued） | 同一意图幂等；RUN-09/23 可能已收尾 |
| `status === 'ended'`、`outcome === 'yielded'`、等待未消费 | 不动作，交给守卫 3 返回 `busy` | `SM:779` 等待行 |
| `outcome === 'outcome_unknown'` 或 `runUnresolvedBlocker` 非空 | 不动作，交给守卫 2/2b | `SM:780` 未知行 |

### 3.4 请求停

对每个要停的 Run：

- **谁调**：`adoptAfterStop`（`src/composition/plan-adoption-stop.ts`）调 `controls.submitControl`；随后 `runtime.deliverControl`。`submitControl` 只落 durable queued 意图，不投递（`control-contracts.ts:7-8`）；`deliverControl` 才把意图送到活句柄，并对已在安全点停住的 Run 触发 RUN-23（`runtime.ts:767-790`）。
- **写什么**：一条 `ControlIntentSnapshot@1`（`kind:'cancel'`）、Run 的 `controlState = { intentRef, desiredState:'cancelled' }`、`ControlIntentSubmitted` 事件；进入过的 Run 只排队（RUN-12/13），未进入的由平台自己结束（RUN-09）。这些都在同一次 `submitControl` 提交里（`control-service.ts:4-10`、`:719-720`）。
- **请求号**：`plan-change:<proposalId>:<taskId>:<runId>`（`SM:778`）。同一候选版本、同一 operator actor 的重试/崩溃重放都用同一个号；号里不含 Run 的 revision，所以同一身份换新 pin 重交会得到 `idempotency_conflict`（`control-service.ts:155`、`:625`），冲突时必须先按现成的 `controlIntentRefFor(actor, scope, requestId)` 读既有意图、复用该身份（§3.4.1），不另造身份算法。`submitControl` 按 `(actor, scope, requestId)` 幂等（换一个操作者会生成第二条意图，旧意图被新指针取代，Run 仍只会被停一次）。
- **pin**：`expected: [{ ref: run.ref, revision: run.revision }]`，用本次读到的那一版（`control-service.ts:174-189` 的 pin 规则）。读到之后 Run 又变了就返回 `revision_conflict`，按 §3.4.1 处理。
- **actor**：`ctx.principal.actor`（`control-service.ts:719-720`）；人采用是 Host 启动的 operator actor（`server.ts:246`；`plan-service.ts:1506`、`:3443-3460`），`reworkActorClassOf` 判 `human`（`task-requeue.ts:75-94`）。
- **reason**：`stopping_affected_work`（`SM:778`、`6C:252`）。
- **投递**：`runtime.deliverControl(ctx, { intentRef })`。活句柄会收到 abort，Kernel 在下一个安全点应用（`execution-control.ts:260-268`；A7 用例 `tests/scenarios/A7-control.test.ts:321`）；已停在安全点的 Run 由 RUN-23 收尾。**不调** `workflow/driver-stop`，不 abort 看守。

#### 3.4.1 提交/投递的出口

| 结果 | 动作 |
|---|---|
| `committed` / `replayed` | 投递，继续下一个 Run |
| `busy` | 不把它当成“已有取消指针”。按 `controlIntentRefFor` 读既有意图（读失败原样返回该拒绝）：`queued` 就投递它，其它状态继续；`not_found` 就重读该 Run——`ended` 继续，指针已 `cancelled` 投递该指针，否则原样返回这个 `busy`。`busy` 是实际拒绝，不按 `revision_conflict` 重试。 |
| `revision_conflict` / `idempotency_conflict` | 两者都不能只换 pin 重交；先按本轮分类，必要时再用同一 `requestId`、新 pin 提交。每轮先按 `controlIntentRefFor` 读既有意图（读本身失败原样返回该拒绝）：`queued` 就投递它，其它状态继续；`not_found` 才重读该 Run——`ended` 继续，指针已 `cancelled` 投递该指针，否则用同一 `requestId`、新 pin 提交；提交再冲突就回到本轮开头，按原限额重试；耗尽原样返回最后一次的拒绝。 |
| `forbidden` / `not_found` / `unavailable` / 其它 | 原样返回该拒绝。已提交的控制保留，下次调用幂等重放 |

投递本身返回拒绝（`deliverControl` 的拒绝）时原样返回该拒绝，已提交的控制保留；调用方可以直接重试同一个 `plans/apply`，不必等 Run 结束。不新增后台重试，也不把投递拒绝折成停止中；`deliverControl` 对拒绝就是这样原样上抛（`runtime.ts:768`、`:770`）。`deliver` 返回 `ready` 不等于 Run 已 ended（意图已非 `queued`、无活句柄或句柄不活都会原样返回 `ready`，`execution-control.ts:148`、`:152`、`:156`）。

### 3.5 停稳的信号

包装把“真 `applyPlanChange` 不再以守卫 1 拒绝”当作 **Run 停稳** 的信号；采用还要真 apply 自己过守卫 2/2b/3/4。没有单独的停稳再读、记录或通知。

- 第一次 apply 先跑完守卫 1 之前的前置检查（source/target/delta/policy/draft/assignments 等，`plan-service.ts:2922-3035`）；它若以 TASK-19 `busy` 拒（含 yielded 等待的守卫 3），说明这些检查已过，才允许停——在这一步之前就失败的计划不会先停工作。守卫 5/6/7 仍在守卫 1 之后，见 L10。
- 包装停完返回 `busy`；下一次调用再跑真 apply：守卫 1 过了就继续 2/2b/3/4 并提交（`plan-machine.ts:666-690`）；还 `running` 就再以守卫 1 拒，包装再停（幂等）。
- **不需要**读 ControlIntent 的 `applied` 状态；Run 自然结束、或 `terminal_without_cancel`，只要 `ended` 且无未结事实，守卫 1 就过（`SM:781`）。
- 本片不写“停稳”记录、不发通知；可读的只有 Run 的状态/指针和 `ControlIntent` 记录（§3.10）。界面要显示“等 X 停下”，读 `executions/read` / `tasks/query` 即可（§6 U3）。

### 3.6 采用

采用由真 `applyPlanChange` 自己完成；包装只在它被 TASK-19 `busy` 拒时停（含 yielded 等待的守卫 3）。

- 每次调用都先跑真 apply；它重新读 proposal/source/target/facts，pin 是最新的，所以不会因为上一次的 cancel 而 `revision_conflict`（被 TASK-19 `busy` 拒时没有提交，下一次重新读）。
- TASK-19 的各 busy 守卫都过后（含 1/2/2b/3/4），采用提交照旧：新 `PlanRevision`、Goal 指针、`TaskDispositionChange`；旧任务 `disposition` 改为草稿里的值，替代任务进新计划（`plan-service.ts:3083-3114`；`SM:781-785`）。
- `starting` 的 Run 可能由 `submitControl` 自己结束（RUN-09），`deliverControl` 对已结束的意图原样返回；但这一次仍返回 `busy`，不在同一次调用里用旧的 pins 提交，下一次 apply 才采用。
- 转给真 `applyPlanChange` 的 request 原样不动（含 `decisionRefs`、`acknowledgementRef`、`decisionSource`）；包装只决定“这一次停不停”。
- 本片不改变采用的写入、事件、回执。

### 3.7 重试

- **人采用**：每次因 TASK-19 `busy` 进入停止分支、至少停了一个 Run 且这些 Run 都提交并投递成功时（含 yielded 等待的守卫 3），`plans/apply` 返回 409 `busy`、`reason` 就是 `stopping_affected_work`；调用方在受影响 Run 结束后**再调一次同一个 `plans/apply`**（同一 `proposalRef`、同一 `expectedProposalRevision`）；若同候选还有未消费的 yielded 等待，下一次仍按守卫 3 返回 `busy`，按 D14/守卫 3 处理。若 `deliverControl` 返回拒绝，`plans/apply` 原样返回该拒绝，不折成 `busy`；调用方直接重试同一个操作，不必等 Run 结束。`SM:778` 明说“Run 结束后调用方再调”；`SM:799` 明说平台不在服务端等待。没有服务端定时器，没有新的“待采用”记录（人采用今天也没有这种记录，`PlanProposal` 无 pending/adopting 状态）。
- **自动采用**：本稿不自停；Workflow 依赖绑的是 raw `planService`（`create-platform.ts:2654`），自动采用不经过本包装，真 apply 仍返回 TASK-19 的 `busy`（最常见是守卫 1），PL 的 `busy` 行保留候选、按 `Run` 等事实下一轮重试（`PL:1129`、`:1151`），不转卡、不写计划。U1 已定为自动采用不先停，见 §3.12、§6 U1。
- **叫醒**：`Run` 已在 `GOAL_WAIT_WAKE_AGGREGATE_TYPES` 里（`src/app/goal-wait-wakes.ts:31-37`），目标等待登记在 `:86-128`；Run 结束的提交叫醒目标，下一轮重试。人采用没有这个叫醒，靠调用方再调。

### 3.8 停不下来

- 没有超时、没有强制结束、没有第二次不同请求号的取消。只要 Run 没到安全点且投递被接受，`plans/apply` 返回 `busy` `stopping_affected_work`；界面停留在“采用中，等 X 停下”。投递被拒时原样返回该拒绝（§3.4.1），调用方重试同一操作。
- 可用的出口只有已有的：Run 自己到安全点结束（§3.5）；人直接对那个 Run 发 `controls/submit`（cancel/pause，`core-routes.ts:463`）或 `workflow/driver-stop`；关 Host（97-1 在安全点暂停，重启 W-12 把 queued cancel 收成 `ended/cancelled`；有在途工具、结果未知则 W-13，等未知结果处理完）；`outcome_unknown` 由人按未知结果处理（守卫 2）。
- 不因“等太久”转卡、不降级为“先采用后停”、不写“失败”记录。

### 3.9 重启后怎么接上

- 控制意图是持久记录（`ControlIntentSnapshot@1`），Run 的 `controlState` 指针也是持久的；本片没有内存状态。
- 重启时 `runStartupReconcile` 扫 `starting`/`running` 和未知结束（`src/app/startup-reconcile.ts:320`、`:401-404`），`classifyRun` 对“queued cancel + 干净 Turn”走 W-12（`run-reconcile.ts:412-424`），按 RUN-23 把 Run 结束为 `ended/cancelled`、释放 Lease/Session（`run-machine.ts:2118-2172`；`run-reconcile-service.ts:856`）。W-12 只用于干净 queued cancel；有在途工具则 W-13（`run-reconcile.ts:403`、`:408`），Run 结束为 `ended/outcome_unknown`，结果未知不算了结。即便 Run 已 `ended`，守卫 2（`outcome_unknown`，`plan-machine.ts:668`）与 2b（`runUnresolvedBlocker`，`:674`）仍拒绝采用（`SM:780`），要等未知结果处理完。
- 采用本身不会自动续：崩溃时“控制写了、采用没写”，再调一次 `plans/apply` 即可（W-13 的未知结果要先处理完，守卫 2/2b 才放行）；控制身份让重复提交幂等（`SM:797`）。人采用由人/界面再调；自动采用由 PL 的目标循环下一轮再调（如果 Goal 还被登记）。
- 冷启动/第一次采用：没有控制、没有内存；先真 apply，无在跑 Run 就一次提交，有就按 §3.1 停。
- 没有新的恢复记录、启动扫描或索引。

### 3.10 记录和状态（“算人的停止”落在哪）

| 记录/状态 | 这次写成什么 | 谁读 |
|---|---|---|
| `ControlIntentSnapshotV1` | `kind:'cancel'`、`requestedBy: <operator actor>`、`reason:'stopping_affected_work'`、`ref` 由 `plan-change:...` 定；进入过的 Run 是 `queued@1`，未进入的是 `applied@2` | `controls/read`、驱动/观察器 |
| `RunSnapshot.controlState` | `{ intentRef, desiredState:'cancelled' }` | 守卫 3、Runtime、读模型 |
| `RunSnapshot` 终态 | 通常 `status:'ended'`、`outcome:'cancelled'`（RUN-09/07/23）；重启收尾是 RUN-23（W-12）；有在途工具时走 W-13、Run 为 `ended/outcome_unknown`，守卫 2 仍拒，不能列为可立即采用 | `executions/read`、Task 投影 |
| `stopRequesterOf` | 由 `requestedBy` 派生 `human`（不是两个 automation 常量） | `reworkFenceOf`、`TaskRequeue`、读模型 |
| `reworkFenceOf` | `human_only` | TASK-19 守卫 7、自动返工、requeue 准入 |
| `TaskRequeueSnapshotV1`（人后来 requeue 时） | `stopIntentRef` 指向这条 cancel、`stopRequester:'human'`、`failureClass`/`interruption` 按现有派生 | `tasks/requeue`、读模型 |
| Task 投影 | Run 取消后 P6 `failed/run_failed`（`outcome='cancelled'`）；采用后 `disposition` 改为草稿值；`deferred` 要先由后续计划把 disposition 改回 `active`，之后才可 requeue | `tasks/query`、`goals/read` |

没有新字段、没有 `humanStopped` 标记、没有“采用中”记录；`PlanRevisionAccepted.actor` 只记采用者，不被 `stopRequesterOf` 读，不能用它代替指针。

### 3.11 Run 和 Task 之后怎么继续

- **替代**（草稿把旧任务设 `superseded` 并给 `replacedByTaskId`）：采用提交后旧任务留 `superseded`，旧 Run/证据/Lease 记录保留；替代任务 `pending`，按新计划正常调度（`SM:782`、`:785`）。
- **取消**（`cancelled`）：义务撤掉，任务留 `taskId` 和 disposition；不物理删（`SM:785`）。
- **延后**（`deferred`）：采用后任务暂停；直接 `tasks/requeue` 会被 `invalid task_not_active` 拒（`task-machine.ts:1221`；`requeue-service.ts:1091`）。先采用后续计划，把 disposition 改回 `active`（`C7-defer-reactivate.test.ts:137-145`），再由人 `tasks/requeue`（`core-routes.ts:543`；`requeue-service.ts:939`）、新 Run 按 `TaskRequeue` 续作（`C7-defer-reactivate.test.ts:206-209`、`:236-240`）。自动 requeue 因 `human_only` 被拒 `forbidden`（`task-failure.ts:403-460`）。
- **采用没成功**（停完了但 apply 被 `revision_conflict`/`not_found` 拒）：任务停在 `failed/run_failed`（cancelled），围栏 `human_only`；人可以重试采用、`tasks/requeue`、或让替代任务继续。不自动回滚已停的 Run（`SM:797` 的崩溃窗口同此）。
- **被停的正是提议的 Run**：采用仍提交，候选来源消息的回复仍写在原消息上（PL 的 committed 行），不另开 Run；任务由新计划的处置/替代任务接手。
- **没有自动返工**：`stopRequester` 是 `human`，Workflow 的自动 requeue 被人工停止围栏挡住（`SM:1078`；`task-failure.ts:147-154`）。这是 102-4 b 写明的代价（`DRV:420`）。

### 3.12 自动采用（本稿：不自停）

- 路径：PL 的 `adopt_plan` perform 调 Workflow 依赖里的 raw `planService.applyPlanChange(automationContext(owned), ...)`（`create-platform.ts:2654`；`PL:1109`；身份 `WORKFLOW_AUTOMATION_ACTOR`，`workflow.ts:670-675`），不经过本片包装。
- 因此自动路径没有 `adoptAfterStop`：raw apply 直接返回 TASK-19 的 `busy`（最常见是守卫 1），PL 的 `busy` 行等 Run 结束再试。今天的行为不变。Workflow 的外层调用已在 `trackedCall` 里（`create-platform.ts:2857-2860`），raw apply 仍在同一个 drain 内。包装的 actor gate 只覆盖走到 `plans` 的非 human；它也只直接转真 apply，不读目标、不提交控制。
- 这样做的理由：自动采用没有“你”，没有可归属的人；若用 automation 身份停，`stopRequester` 是 `system`、围栏 `none`，被停任务可能被自动返工重新拉起，和“采用前停稳”打架；若伪造 operator actor，又是把自动动作记成人。两条都不选。见 §6 U1。

### 3.13 人采用（本稿：一次点击，两次调用）

- 第一次：停 + `busy`；第二次（Run 结束后）：采用。界面按 `DRV:420` 显示“采用中，等 X 停下”，并在 Run 结束后自动再调一次，才真正是“一次操作完成转向”。
- 服务端不保存“人已点采用”的意图（今天没有这种记录），本片也不新增。重启后不自动续，人再点一次同一 `plans/apply` 即可，候选还在。见 §6 U3。

---

## 4. 对外入口行为对照

| 入口/情形 | 今天 | 本片 |
|---|---|---|
| `plans/apply`，受影响任务有 `starting/running` Run，人 actor | 409 `busy`，reason `task X still has an unfinished execution...`，零写 | 先真 apply（零写、TASK-19 的 busy 拒）→ 再写每个 Run 一条 cancel + 指针 → 409 `busy`，reason `stopping_affected_work`；计划仍零写 |
| 同上，第二次调用（Run 已 ended） | 采用提交 | 采用提交（同今天） |
| `plans/apply`，Run 是 `yielded` 等待 | 409 `busy`（守卫 3），零写 | 409 `busy`（守卫 3），零写（本片不停等待） |
| `plans/apply`，Run `outcome_unknown` | 409 `busy`（守卫 2），零写 | 409 `busy`（守卫 2），零写 |
| `plans/apply`，受影响 Run 已全 ended | 采用提交 | 采用提交；不发控制 |
| `plans/apply`，无关任务在跑 | 不受影响 | 不受影响；不发控制（C6 场景，`tests/scenarios/C6-unrelated-adoption.test.ts:55`） |
| `plans/apply`，首份/请求槽候选（`basedOn === null`） | 走原采用 | 原样；没有在跑 Run，不会进停的支路 |
| 自动采用（`adopt_plan`） | TASK-19 的 `busy`；PL 等待 | 不变（本稿不自停） |
| `controls/submit` / `workflow/driver-stop` | 不变 | 不变；本片只多出由采用流程提交的 cancel |
| `tasks/requeue` | 人可；`deferred` 被 `invalid task_not_active` 拒；automation 被 `human_only` 拒 | 不变；本片让围栏真的落到 `human_only`；`deferred` 仍要先由后续计划改回 `active` |
| 读（`executions/read`、`tasks/query`、`goals/read`） | 无“采用中” | 仍无新字段；能看到 `controlState=cancelled`、Run `ended/cancelled`、Task `failed/run_failed` |

---

## 5. 测试

### 5.1 新行（业务流程；入口公开；不读库）

新增 `tests/scenarios/PS-adopt-stop.test.ts`，用 `openHostScenario`（`tests/scenarios/harness.ts:1234`）、`h.advance(h.select(...))`（`:658`）、`h.holdReply(i)`（`:627`）造在跑 Run；夹具直接用正本：`draftFrom`（`tests/scenarios/support/common.ts:532`）、`operatorRequeue`（`tests/scenarios/support/common.ts:198`）、`hostGraph`（`tests/scenarios/support/plan.ts:181`）、`commitGate`（`tests/scenarios/harness.ts:939`，`openHostScenario` 的选项）；采用走 `plans/apply`，读走 `executions/read`/`controls/read`/`tasks/query`/`goals/read`，继续走 `tasks/requeue`；不读 RecordStore。`hostAdopt`（`tests/scenarios/support/plan.ts:192`）要求一次 `committed`，不适合本片两阶段拒绝主线，不复制它绕过中间结果。先写 PS-01/PS-02 两条失败测试（RED 来自“没有停/没有第二次采用”，不是编译错），再实现；其余行随后补。

| 行 | 世界/步骤 | 证明什么 | 让它变红的具名改坏方式 |
|---|---|---|---|
| PS-01 | 同一候选（`draftFrom` 改两个任务的处置）改到两个任务：提议者自己的 Run 仍 `running`（held），另一个受影响任务的 Run 是未进入的 `starting`（`stopBefore: performs('start')`）；人 `plans/apply` | 409 `busy`，reason 是 `stopping_affected_work`；两条停止提交（`starting` 的那条由平台按 RUN-09 直接收尾，`running` 的那条保持 queued）、`requestedBy` 都是 operator；两个 Run 都是 `controlState=cancelled`；活动计划不变、候选仍 `candidate`（计划零写） | 只处理第一个 Run（拿到一个目标就返回/只停一个） |
| PS-02 | 接 PS-01：放开 `running` 的 held，等两个 Run 都 `ended/cancelled`；用同一 `proposalRef`/`expectedProposalRevision` 再 `plans/apply` | 第二次 `committed`；`hostGraph` 读回新计划版本、两个旧任务的 disposition、替代任务（一次统一采用） | 第二次仍返回 `busy`（没走真 apply） |
| PS-03 | 一个 `running` Run（held）；在第一次模型回复的 `duringReply(0)` 里连打两次 `plans/apply`：第一次提交 cancel 后 Run 仍未结束，第二次命中已有 `cancelled` 指针 | 只有一条 ControlIntent（同一 `plan-change:` 号）；两次都 `busy`；计划零写 | 删除“已有 `cancelled` 指针则跳过提交”的分支，第二次再提交 |
| PS-04 | 同一候选改到两个任务：Task Y 的 Run 已 `ended/yielded`、等待未消费，Task B 的 Run `running`（held），且 Y 的 taskId 排在 B 前（守卫 3 先返回）；人 `plans/apply` | 409 `busy` `stopping_affected_work`（进入停止分支）；只给 B 一条 cancel；Y 没有新 ControlIntent、仍是 `ended/yielded` 且等待未消费；计划不变 | 把 yielded 也当在跑，给 Y 提交 cancel |
| PS-05 | Run 被人 pause（`human_only`）；人再 `plans/apply` | 允许 cancel；Run `ended/cancelled`；采用提交；`stopRequester=human`；automation 的 `tasks/requeue` 被拒 `forbidden`，operator 可以 | 把 pause 当“已停稳”直接采用 |
| PS-06 | 人 `plans/apply`（不 await；内部真 apply 先 `busy`）→ 包装提交 cancel；用 `commitGate` 包一个带 armed 标志的门，匹配到该 `ControlIntent` 的 durable commit 后按住回执（`holdReply` 固定干净 Turn）：控制已落库、尚未投递；`await reached` 后 `h.dropCommitGate()`（旧 route 仍等在 gate），再 `restart({ crash: true })`，新 Host 启动不再被 gate 包住；finally 释放 gate、`drainAbandoned` | 启动核对走 W-12/RUN-23：Run `ended/cancelled`，cancel 的 `requestedBy` 是 operator（人工停止归属）；再 apply `committed` | 重启后把 Run 留 `running`，或崩溃前不提交 cancel（Run 收成 `crashed` 而非 `cancelled`） |
| PS-07 | 同一候选只改 Task B；Task B 的 Run `running`（held），另有无关 Task U 的 Run 也 `running`（held）；人 `plans/apply` 先 `busy`（进入停止分支），放开 B 后再 apply | 第一次只给 B 提交 cancel，U 没有新 control、仍 `running`；第二次 `committed`，U 仍不受影响、继续跑 | 把无关任务的 Run 也停 |
| PS-09 | 草稿把在跑任务设 `deferred`；人 apply → `busy` 停稳 → 再 apply 采用，任务 `deferred`；随后先采用一份把 disposition 改回 `active` 的后续计划，再由人 `operatorRequeue` 并用 `h.advance` 推进 | 采用提交、任务 `deferred`；`deferred` 上直接 requeue 被拒 `invalid task_not_active`；改回 `active` 后 requeue 提交，Workflow 按 `TaskRequeue` 继续 | defer 被当成“不用停”，第一次采用仍 `busy` |

### 5.2 要改的老行

- `tests/work-graph/A2-disposition-change.test.ts:579-...` 的 `a running Run (guard 1)` 用裸 `base.plans`（`tests/helpers/task-claim-fixture.ts:298`），不经 `platform.plans` 包装，本片不改；纯守卫文字仍由 `tests/state/plan-machine.test.ts:1050` 锁定。
- `C7-defer-reactivate.test.ts:411`/`:483`（守卫 3、指针窗口）不变：yielded 等待本片不停。
- `C8-human-stop-respected.test.ts:94`/`:158` 不变：那是人直接停，不是采用路径。
- `SMK2-host-close.test.ts:23`、`A8-host-restart-paused.test.ts:582` 不变：97-1 路径不写 intent。
- 6C 合入后，`S6-P-02` 的“在跑→停”行改用本片请求号/原因；那时再补它的验收行（不在本片）。

### 5.3 估计、入口、命令

- 生产 210–290 行：`plan-service` 读 90–120、`plan-adoption-stop` 90–120、装配/类型 30–50。
- 测试 300–420 行：8 行 + 夹具复用；新文件 1 个，老行 0 处。
- 命令：`npx vitest run tests/scenarios/PS-adopt-stop.test.ts tests/work-graph/A2-disposition-change.test.ts --maxWorkers=2`；收尾 `npm run typecheck`、`npm run check:architecture`；合入前按规矩跑 `npm test`（`test=vitest run --maxWorkers=1`）。
- 夹具优先复用 `openHostScenario`；缺公开步骤时报 lead，不在测试里手写记录。

---

## 6. 产品决定（已定，2026-11-02）

**U1. 自动采用（没有人在场）不先停，保持 `busy`，等 Run 自己结束。**
- 102-4 的 b 原文是“**你**采用时”（`DRV:420`），“算人的停止”只覆盖人采用；自动采用没有人可归属，今天的行为不变。
- 自动采用若用 automation 身份停，`stopRequester` 是 `system`、围栏 `none`，被停任务可能被自动返工重新拉起；若伪造 operator actor，又是把自动动作记成人。两条都不选。
- 因此本片不改 `create-platform.ts:2654` 的绑定：自动路径仍是 raw apply 直接 `busy`；走到包装 `plans` 的非 human 仍由 actor gate 直接转真 apply，不读目标、不提交控制。

**U2. 人采用时，受影响 Run 已被（同一个人或另一个）人暂停，可以直接取消它。**
- 守卫 7 对 `human` 放行（`SM:1078`）；这也让“一次点击”成立。否则人要先恢复/取消那个 Run，再采用。

**U3. E3 的卡收到 `stopping_affected_work` 后保留“采用中”，Run 结束后自动再调一次 `plans/apply`；服务端不加记录，重启后人再点一次。**
- 今天没有“人已点采用”的持久意图（`PlanProposal` 无 pending/adopting；`DecisionSelectionV1` 无 adopt）。
- 本片不新增采用意图记录。重启后内存里的“采用中”丢失，人重新点一次同一 `plans/apply` 即可，候选还在。

**U4. 把在跑任务设 `deferred` 算“改到在跑的任务”，先停。**
- 它和 `superseded`/`cancelled` 同属只改处置的 `dispositionOnlyTaskIds`；不停就仍是今天的 `busy`。

---

## 7. 技术选择（已定）

- **L1. 放端口包装，不改进 `applyFutureRevision`。** 构造 `plans` 时（`create-platform.ts:2065`）直接装好：`const adopt = createPlanAdoptionStop({apply: planService.applyPlanChange, readTargets: planService.readAdoptionStopTargets, controls: rawControls, runtime: runtime.port})`；`plans.applyPlanChange = (...a) => trackedCall(() => adopt(...a), unavailable)`。新增的公开读 `readAdoptionStopTargets` 也经 `trackedCall`。raw apply、目标读、controls 和 `runtime.port` 都作为参数传入包装，整次调用落在同一个 drain 里，关闭时不会漏掉其中任一步。`runtime.port` 在 `:2065` 之前已就绪（`createAgentRuntime` 在 `:1804`/`:1892`），不需要晚绑定的 holder。删掉原稿在 `runtimePort` 之后（`:2229`）的属性替换，以及“为等 `runtimePort` 晚替换”的做法。顺序是“先真 apply，TASK-19 的 `busy` 拒后才停，停完就返回”，所以下一次 apply 重新读 facts/pin，不会出现“读完 facts 再 cancel 提交”的 `revision_conflict`（`plan-service.ts:3039`→`:3154`）。代价：组合根多一段业务包装。
- **L2. 新增只读 `readAdoptionStopTargets`，不新增持久读模型。** 复用 `deriveFuturePlanDelta` + `readDispositionChangeTaskFacts`；没有新索引。
- **L3. 停稳 = 真 apply 不再以守卫 1 拒**（随后它自己过 2/2b/3/4，即 `SM:778` 的已停下行），不新增判据、不读 intent 的 `applied`。
- **L4. 只停 `starting/running`；yielded/unknown 不停**，留给守卫 3/2 和 D14（`SM:779-780`）。
- **L5. 请求号与原因照 `SM:778`**：`plan-change:<proposalId>:<taskId>:<runId>`、`stopping_affected_work`；不新造字符串。
- **L6. 控制失败出口按 §3.4.1。** 每次冲突都重新分类，不能只换 pin：读既有确定性 intent，存在就复用（现成的 `controlIntentRefFor`，不另造身份算法）；重读 Run；`ended` 继续，`cancelled` 投递新读到的指针，否则按原限额重试，耗尽返回实际拒绝。投递被拒原样返回该拒绝，保留已提交的控制，不后台重试；调用方可重试原操作。
- **L7. 返回形状仍是 `busy`**（不新增错误码），reason 就是 `stopping_affected_work`（`SM:778`）；要显示“等 X 停下”由界面读 `executions/read`，不把 runId 塞进 reason。PL 的 `busy` 行无需改。
- **L8. 人采用 gate 用 `reworkActorClassOf` 判 human**，不用 `ActorRef.kind === 'human'`（`task-requeue.ts:75-94`）；Host 的 operator actor 不能是 `PLATFORM_AUTOMATION_ACTORS` 成员。
- **L9. 排期**：排在 **PL-1 之后、6C 之前**（只动 plan-service/composition）；PL 合入后自动采用才有真实的 `busy` 重试；6C 合入后复用同一行。见 §9。
- **L10. 守卫 6 在守卫 1 之后**：受影响任务列表缺项的计划，会先停 Run、下一次 apply 才被 `invalid` 拒（守卫顺序如此）。本稿不加预检：停是人的采用动作的一部分。`deferred` 任务不能直接 `tasks/requeue`：采用成功后要先由后续计划把 disposition 改回 `active`，再由人 `tasks/requeue`、推进（`task-machine.ts:1221`；`requeue-service.ts:1091`）。

---

## 8. 冻结前要核对的接缝（起草时未跑）

1. `plans/apply` 人路线的 ctx actor 确实是 Host 启动的 operator actor（`server.ts:246`；`plan-service.ts:1506`、`:3443-3460`），且 `reworkActorClassOf` 判 `human`。
2. `deliverControl` 对“已停在安全点”的 Run 能走 RUN-23（`runtime.ts:767-790` 的 `kernelExited` + `resourcesClosed` 证明），对活句柄的 abort 在下一安全点生效（A7）。
3. 第一次 apply 已先过 source/stale 检查；`readAdoptionStopTargets` 与它之间若候选被别处采用，下一轮 apply 会返回 `revision_conflict`/`source_stale`，已停的 Run 不回滚（与 `SM:797` 的崩溃窗口同一条）。
4. `plans/apply` 409 body 的 `reason` 在真实 HTTP 上原样保留（`server.ts:250`）。

---

## 9. 顺序、复用、不加防御

- **依赖**：不依赖 PL/6C 就能施工（只动 core plan-service 和 composition 包装）。自动采用的 `busy` 重试要等 PL 合入才是真实路径；人采用今天就能验收。E3 的“采用中”卡决定“一次操作”的体验，但不阻塞服务端。
- **顺序**：**PL-1 之后、6C 之前**（自动路径和 PL 的 `busy` 行要 PL-1；让 6C 的 §3.9 直接引用本片）。与 DRV 无共用改动（DRV 已合入，只在文档边界）。
- **复用的**：`deriveFuturePlanDelta`、`readDispositionChangeTaskFacts`、`submitControl`、`deliverControl`、`reworkFenceOf`/`stopRequesterOf`、W-12/RUN-23、`TaskRequeue`、goal wait 的 `Run` 唤醒、§1.3 的测试夹具正本（`draftFrom`/`operatorRequeue`/`hostGraph`/`commitGate`）、`trackedCall`（`src/composition/create-platform.ts:1750`；PS-06：新包装整次调用走同一关闭 drain）。
- **不做的防御**：不加超时、不加“第 N 次转卡”、不加采用专用等待读模型、不加“停稳”通知、不加“采用中”记录、不给自动采用伪造 human 身份、不动 Kernel/Runtime 安全点。

---

## 10. 偏差（文档 vs 代码 / 文档互相对不上）

1. `DRV:413` 引 TASK-19 守卫 1 在 `plan-machine.ts:673-677`；实际守卫 1 在 `:660-665`，`:673-677` 是守卫 2b。
2. 全仓“停稳”只有 `HANDOFF.md:1722`、`DRV:420` 两处用法，无定义；本片 §2.3/§3.5 自己定义。
3. `SM:770-799` 的 §3.9 表只写“带批准的改动”（`decisionRefs` 非空、批准载荷核对通过，`SM:774`）；102-4 的一般采用没有批准载荷。本片把第 1 行（在跑）和第 4 行（已停下）用于一般采用，属于对表的扩展，按 L3/L9 采用。
4. 树里没有 `stopping_affected_work` 字符串、没有“采用中/待采用”读模型；`plans/apply` 的 `busy` 只是 409 失败体（`server.ts:150-168`、`:250`）。
5. 人采用没有“已决定采用、未提交”的持久记录（`PlanProposal` 无 pending/adopting，`DecisionSelectionV1` 无 adopt）；`SM:778/:797` 的“调用方再调”是唯一现状可行的接法，“一次操作”要靠 E3。
6. PL 规格的 `busy` 等待依据含 `Run`，但树里没有 `plan_adoption_busy`/`decidePlanCandidate`/`adopt_plan`（PL 未合入）；本片只保证返回 `busy`，重试由 PL 合入后的行负责。
7. `DRV:420` 的“算人的停止”对自动采用没有可归属的人；本稿按“你采用”只覆盖人采用（U1）。
