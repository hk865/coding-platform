# 目标驱动改造（DRV）规格 · 冻结版（v2.2）

lead，2026-10-31。代码、测试的行号按 `8fae469`（= lead 分支 `b1008be5` 的 src、tests）；文档的行号按 lead 分支 `b1008be5`（`8fae469` 的 docs 比它旧）。

状态：**已冻结（2026-10-31）**。Codex 完整审过一遍（26 条）、冻结核对一遍（12 条），都已改；lead 逐行审过（见文末“lead 审稿的改动”）；两轮实跑（§7）的结果已回写。下一步：DSH 施工。

---

## 0. 一页说明（给用户）

**一句话。** 现在目标范围的循环一次只推一个任务，被唤醒以后又只把下一步领下来、不真的开跑。这次改成：每个目标一个只做决定的循环，每个在跑的任务一个看守；回复、卡片的回答、新计划、干预、Run 结束，都只是叫决定循环重新看一次。

**要解决什么。**
- 照代码列出的六个问题（§18.7 的 P1–P6）：两个句柄抢同一个目标、停一个丢掉另一个的唤醒；停止后状态还会被泵写回“等回复”；唤醒多起一个循环；唤醒队列自己等自己；停止排空漏掉唤醒起的那次推进；异常退出后目标一直“忙”。
- 写规格时新查出的 F1、F2，和实跑新查出的 D-F3（§1.2）。按你定的标准——目标改了，模型要能很快转向——这些都算 bug。
- F1：单个目标范围的循环不会主动并行派工，同一目标里的任务一个接一个跑。
- F2：登记唤醒留下的后继只被领走（占着租约），没有另外一次被接受的无界启动就没人开跑。
- D-F3：自动确认的等待登记了错的提交种类，Host 的唤醒队列又漏了重新排队，所以人答卡、重新排队之后根本不会唤醒。

**怎么改。** 只改调度这一层（目标驱动），拆成两部分：
- **决定循环**：每个目标一条，只做决定，不守着 Run。
- **Run 看守**：每个在跑的任务一个，守着自己的 Run，有动静就叫决定循环重新看一次。
- 任何变化（回复、卡片的回答、新计划、干预、Run 结束）都只是“叫决定循环重新看一次”。

**范围变了什么。**
- 第一稿说“只改驱动、不碰 Workflow”，现在要动 Workflow 选择逻辑里的两处内部：目标范围的选择要知道哪些任务已经有看守在推，跳过它们；碰到一个在等的任务，不再停在那里，而是记下它的等待依据、接着看后面的任务（今天 A 在等时，B 的回复已经到了也看不到）。
- 这两处只走现有的内部参数和内部分支，不改 Workflow 的决定规则，也不改对外接口；HTTP 和公开路由不带这些参数。
- D-F3 是生产两行：自动确认等待的依据种类换成真实提交带的种类，Host 的唤醒订阅加上重新排队和未知调用复核（复核答完同样不醒，是同一类漏订阅）。

**不改什么。**
- Workflow 的决定规则（除了上面两处选择逻辑和 D-F3 的两行）。
- Runtime：怎么跑模型、安全点、消息怎么送进 context。
- 记录的格式。
- 三条对外路由（`workflow/driver-start`、`driver-read`、`driver-stop`）的输入和返回格式。

**改完以后你能看到的变化。**
1. 同一目标里互不重叠的任务真的并行跑。决定 49 和 7C 的 L16 本来就这么要求，现在的驱动做不到。
2. 卡片答了、阻塞解除了、已有目标采纳了新计划，或者 Host 重启后等的东西到了，任务会**被启动**。现在只会被领走，然后停住。（Run 自己让出等回复的那条主路今天是好的，不在此列，见 §1.2。）
3. 人干预一条空闲的线，不再另起第二个“经理”，也就不会和目标原来的循环打架。
4. 停止要等所有在跑的东西都收完，才显示“已停”。

**和 7C 的顺序。** 7C-1 也改 Workflow 挑任务的那段（挑执行者、L16 的重叠分段）。DRV 的这两处 Workflow 内部改动要在 7C-1 改这段的组开工前合入；DRV 合入后，7C-1 的开工裁定按新树重指。

**另有一件你已经定过、但不在这次代码里的事（§6）。** 新计划采用时，如果改到一个正在跑的任务，现在会被拒（`busy`），要你先手动停。你 2026-10-31 定了选 b：采用时先在安全点停下那个任务。它另开规格和小片，不在 DRV 的代码里。

---

## 1. 现在的毛病

### 1.1 §18.7 的六处

见 STATE-MACHINES-SPEC.md:5845 起的表。
- P1、P3、P4、P5：同一目标有两个句柄。
- P4：唤醒队列在等驱动，驱动又在等这条队列送下一次唤醒。
- P2、P6：一个句柄也会出。

### 1.2 新查出的三个（按需求算 bug）

**F1 单个 Goal 范围的循环不会主动并行派工。**
- 句柄在 `runWithPump` 里 `await workflow.advanceWork(perform:start)`（`src/app/collaboration-driver.ts:762`）。这一步调 Runtime 的 `start`（`src/core/agent-runtime/execution-driver.ts:311`）；正常的新执行会等模型调用（`:1042`）和观察收尾（`:1100`）才返回，期间句柄的循环一直停在这里；但返回不保证 Run 已经结束或让出——拒绝、已入场只观察（`:404-407`）和安全点暂停（`:904`）也会返回。
- Host 自己发起的驱动都按目标启动（启动重驱 `src/app/host.ts:1645`、唤醒 `:840` → `collaboration-driver.ts:1176`），不带 `taskId`。
- 按任务启动的第二个句柄来自 Host 的干预派发：人干预（`host.ts:1828`），以及已放行的 Work/秘书 `action_request`（`consumable-sessions.ts:85-87`），走 `consumeIdle` → `handleIntervention` → `start({taskId:B})`（`host.ts:1814-1833`）；人调路由时带 `taskId` 也按任务启动。这是消息派发的例外，不是 Goal 范围的选择在并行派工。
- 所以没有这些外部派发来源时，单个 Goal 范围的循环不会主动并行派工：一个目标里的任务一个接一个跑。
- 产品要的是并行：
  - DESIGN.md:601：“优先并行派文件、模块不重叠的任务”；
  - slice-7-SPEC.md:99、:200 L16：“要派第二个任务、而它声明的模块和正在跑的任务重叠时……”；
  - MVP-BEHAVIOR.md:267：“用户能看到实际并行与冲突处置”。

**F2 被唤醒后只领取、不开跑。**
- 登记等待的分支被唤醒后，把 `bounded` 设成 true（`collaboration-driver.ts:897`）。之后只往前走到“下一步要开 Run”为止，就把这一步存进 `current`、退出（`:821-825`、`:950-956`、`:973`）。退出前已经 `leave` 了登记（`:899`），所以之后再没有唤醒。
- 能启动驱动的调用方只有四个：路由、Host 启动重驱、Host 干预派发、首次计划采用（`initialization/adopt` 的 committed 回答 → `startGoalDriver`，`src/app/host.ts:2214-2220`）。这四个都不会接着这一步走；首次计划采用会另开一次无界 start（`select_work` + 采用答案），已有场景断言采用会启动、回放只产生一个 Run（`tests/scenarios/SMK-secretary-adoption.test.ts:51-59`）。这条现有接线保留，不新增补推入口；所以 F2 限定为“登记唤醒留下的后继，且没有另外接受的无界 start”。
- 现有测试 BW-basis 正好断言了这个行为：回复到了 → 唤醒 → 领取（committed claim）→ 后继输入停在 `current`，“because the entry never follows it”（`tests/business/S7B2-BW-wait-basis.test.ts:56-78`）。
- 哪些等待会走登记分支：凡是 Workflow 返回 `waiting` 并带等待依据的。例如：
  - L46 挡住、等自动返工卡；
  - 验证轮的检查还在跑；
  - 目标还没有采用的计划（`src/business/workflow/workflow.ts:1199-1225` 一带）；
  - Host 重启后，唤醒队列为在等的目标新建的句柄（`collaboration-driver.ts:1176`，一开始就是 `bounded`）。
- 不受影响的一条：Run 自己让出、等回复的那条主路。`start` 的让出结果不带依据（`workflow.ts:599-602` 的 `afterNotNormalEnd` 返回不带依据的 `waiting`），走的是轮询分支（`:911-945`），回复到了照常接着干。但这条主路上，回复到了以后的 `select_work` 如果又返回带依据的 `waiting`，就会进入上面的毛病。
- 结果：卡答了、阻塞解除，或者 Host 重启后等的东西到了，登记唤醒留下的后继都只被领走（占着租约）；没有另外一次被接受的无界 start 就没人启动，要等 Host 重启（`auto` 档）或人手动推一下。首次计划采用不在此列：它自己会开一次无界 start（见上一条）。
- 来历：7B 书 §3.8 第 4 条规定唤醒只做“one Workflow advance, no model call”（`D:/cc-lead-notes/impl/s7b/book-7b-frozen.md:579-583`）。原因是旧驱动会在唤醒里把整个 Run 跑完，堵住唤醒队列。§18.7 的 N1 把“留下的后继没有自己的唤醒”判为“不是问题”，那是只看状态机的结论；按需求看，这是 bug。本规格改掉它（§3.4）。

> **实跑结论（2026-10-31，详见 §7）：** F1-a、F1-b 成立——按住模型调用时，`advanceWork` 没有返回，目标循环也没有继续派下一个任务；F1-c（第一个 Run 结束后第二个接着开）因为实跑副本没有 `/usr/bin/bwrap` 没法跑，施工时在有 bwrap 的 post-run 里证。F2a 成立——后继只做到 `claim_task`，Run 停在 `starting`，三个心跳后没有启动者；F2c 成立——让出的 `start` 不带等待依据，回复后同一句柄起了新的后继 Run 并完成。F2b 不成立——L46 世界经 Host 的 `goal_waits` 两次 drain 都是 `progressed:0`，见下面的 D-F3。

**D-F3 自动确认的等待不会被它自己的提交唤醒。**
- 自动确认的等待（直接阻塞和 L46 阻塞用同一个结果，`src/business/workflow/task-gate.ts:489`）把等待依据的种类写成 `['UserDecision', 'Goal']`；但人答卡提交的是 `SessionMessage`（`src/core/work-graph/communication/decision-service.ts:754-758`），重新排队提交的是 `TaskRequeue`（`src/core/work-graph/state/task-machine.ts:733`），`UserDecision` 从不作为提交的聚合出现。
- Host 的唤醒队列只按 `GOAL_WAIT_WAKE_AGGREGATE_TYPES` 里的种类标记（`src/app/goal-wait-wakes.ts:31-34`），里面也没有 `TaskRequeue`。实跑 F2b：真实的答卡和重新排队之后，两次 drain 都是 `progressed:0`，目标一直停在等回复。
- 改法（生产两行）：依据的种类改成这两次提交实际带的 `['SessionMessage', 'TaskRequeue', 'Goal']`（`Goal` 保留：改设置也可能解除）；`GOAL_WAIT_WAKE_AGGREGATE_TYPES` 加 `'TaskRequeue'` 和 `'UnknownCallReview'`（后者见 §3.4）。验收行 D-F3 见 §5：L46 世界，真实的答卡和重新排队提交经真实的 `createGoalWaitQueue` + `createWakeLoop`（接线同 `host.ts:832-851`），不手调 `wake`，断言目标被唤醒且后继 Run 进入（和 D-F2 一起才完整）。改坏方式：把依据改回 `['UserDecision', 'Goal']`。

---

## 2. 范围

| 改 | 文件 |
|---|---|
| 目标驱动的结构：决定循环、Run 看守、唤醒、停、读 | `src/app/collaboration-driver.ts` |
| Workflow 选择逻辑的两处内部（01 推进归属；03 不在第一个等待处停下）：目标范围的选择跳过正由看守推进的任务；碰到在等的候选，记下依据继续看后面的，全都不能推进才返回合并后的等待依据 | `src/business/workflow/workflow.ts`；内部参数用现有的 `WorkflowAdvanceInternal`（`contracts.ts:238-249`），等待依据用 `goalWaitBasisOf`（`task-gate.ts:176-178`） |
| 自动确认等待的依据种类改成真实提交带的种类（D-F3，生产两行之一） | `src/business/workflow/task-gate.ts`：`:489` |
| 唤醒队列：机制不改，订阅加 `TaskRequeue`、`UnknownCallReview`（D-F3，生产两行之一）。`wake` 改成马上返回之后，`drain` 的 `await` 自然不再卡住 | `src/app/goal-wait-wakes.ts`：`:31-34` |
| 干预派发改成交给目标驱动开一个看守（入参不变） | `src/app/host.ts`：`:1820-1836` 那一段；驱动的构造 `src/app/host.ts:790-810` 只在需要时改 |
| 测试：§5 列的新行和要改的老行 | `tests/` |

这两处 Workflow 改动只走内部参数和内部分支，不改决定规则，对外接口不变：HTTP 和公开路由不带这些参数。

不改的层：
- `src/business/workflow/`：决定规则，除了上表的两处选择逻辑和 D-F3 的等待依据一行；
- `src/core/agent-runtime/`：执行、安全点、送达；
- `src/core/work-graph/`：记录和状态迁移；
- 提示词包；
- 三条路由的入参和返回类型（`src/app/core-http-types.ts:215-217`）。

---

## 3. 新模型

### 3.1 三样东西

| | 每个……一个 | 在内存里存什么 | 谁写 |
|---|---|---|---|
| 目标驱动 `GoalDriver` | (项目, 工作区, 目标) | 状态；`stopRequested`；`recheck`（要不要再看一次）；当前这一趟决定的 promise；交接前暂存的 `currentRun`；看守表（taskId → Lane）；`activeTaskIds`（正由看守推进的任务）；当前连续选择的 `failedCardRefs`；这个目标的一条等待登记；`profiles`、`context`、`flowId`、首次接受目标范围启动的种子；给 `read` 的 `current`/`last`/`reason` 和有界消息投影 | 只有它自己的决定循环和 stop/close（例外：唤醒和看守可以置 `recheck`、交回等待依据，只有决定循环读和清） |
| Run 看守 `Lane` | (目标, 任务) | 复用 `Handle` 的字段（`collaboration-driver.ts:264-302`）：状态；`current`/`last`/`reason`；`currentRun`；`failedCardRefs`；消息投影；`wakeWaiting`；pump 的 abort；`done`；种子、`flowId`、受信上下文、profiles 快照 | 只有它自己的循环和 stop/close |
| 记录 | — | 一切事实 | 各 owner（不变） |

驱动只存调度用的小状态。Host 重启后，驱动从记录重新推出该做什么，和今天一样（§3.6）。

消息投影只有一个正本：目标驱动保留今天 `Handle` 用的有界缓存（最多 50 条），去重、更新和上限都复用 `project`（`collaboration-driver.ts:397-408`）；看守读到消息时同步更新所属目标的投影；通知仍走既有的 `changed`/`tick` 边界（`:346-367`），由目标驱动的 `changed` 发出。不为目标和看守各写一套消息合并或通知规则。

驱动对象的建立不等于目标范围的启动。带 `taskId` 的 `start` 只建/开这个任务的看守（没有驱动就先建容器），不跑目标范围的决定、不安装目标范围的启动种子、不调 `onStarted`；每次**接受**目标范围的 `start`（装入启动状态，不含同种子回放和 `busy`）才安装种子并调 `onStarted`（今天只在无 `taskId` 的新句柄上执行，`collaboration-driver.ts:1155`，包括停等后换种子、终态后换种子和唤醒新建的句柄；模型服务出错后人重新启动要靠这一条清中断；干预代码依赖这个区分，`intervention.ts:88-93`）。

**决定循环只替接受过目标范围启动的驱动跑。** 显式任务不领无关的工作（`collaboration-driver.ts:862-869` 的规则）。只有任务看守、没有接受过目标范围启动的驱动：
- 看守结束不置 `recheck`，不起决定循环；任务启动也不置；
- 看守交回的 `{ basis, cursorAtRead }` 照样登记；
- `wake` 到了：驱动已请求停止就返回；否则目标驱动先 `leave` 一次旧登记，再对每个交回过依据而结束的看守，用它自己的种子、`flowId` 和 `taskId` 重开一个看守，走一次带 `taskId` 的 `select_work`（今天的 `wakeInput`，`:906-912`），不碰别的任务；各看守用自己读前的游标交回仍成立的依据；
- 之后接受了目标范围的 `start`，它就变成普通的目标驱动，在跑的看守不动。

已有目标范围的驱动时，任务启动才置 `recheck`。看守直接复用现有 `Handle` 的种子、`flowId`、受信上下文和 profiles 快照：显式任务启动取本次输入的快照，目标自动派出的看守取该目标已接受启动的快照；已有看守不随新启动扩大权限（`addProfiles` 的规则不变，`:117-122`）。

01、03 只动 Workflow 的两处内部，对外接口不变：
- **推进归属。** 决定循环调 `advanceWork` 时，用现有的内部第三参数 `WorkflowAdvanceInternal`（`src/business/workflow/contracts.ts:238-249`）带上 `activeTaskIds`（在这个内部类型上加这个字段，不新建调度端口）；Goal 范围的选择跳过这些任务。HTTP 和公开路由不带它，公开 DTO 不变。
- **不在第一个等待处停下。** Goal 范围的选择碰到一个在等的候选，记下它的等待依据、继续看后面的任务；有能推进的就推进，全部不能推进才返回合并后的等待依据。依据仍由 `goalWaitBasisOf`（`src/business/workflow/task-gate.ts:176-178`）构造，合并沿用 L46 跳过已有的做法（`workflow.ts:1806-1812`）。带 `taskId` 的调用保持原来的立即等待。

这两处的施工顺序见 §8：DRV 在 7C-1 改 `selectNext` 的组开工前合入。

### 3.2 决定循环（每个目标同一时刻最多一趟）

一趟决定：
1. `stopRequested` 为真，就结束这一趟。
2. 如果这是接受目标范围启动后的第一趟，先把本次接受的 `advance` 原样执行一次（请求本身不改；内部参数照第 3 步带。可能是 `select_work`，也可能是 `perform:start`，或带启动恢复的 `answers`）；第一趟从它的结果接着走，不另发一次选择。本次 `advance` 也先过第 5 步的长步骤分派：它本身是 `perform:start` 或 `run_check` 时，交看守原样执行一次，决定循环不等它。不同种子的停等重启也安装本次输入，不能只唤醒旧种子（§4.1）。
3. 走 `select_work`（不带 `taskId`）：可能来自上一步的 `next`，也可能是交出一个长步骤后回到目标范围时新发的一次。它照旧经过跨目标的排序安全点（`awaitAdvanceAdmission`，`collaboration-driver.ts:518`，§4.5 line 890，不改）。这一次调用带上 `activeTaskIds`（正由看守推进的任务）和当前连续选择的 `failedCardRefs`；两者都只走 `WorkflowAdvanceInternal`（`contracts.ts:238-249`），Goal 范围的选择跳过 `activeTaskIds` 里的任务。
4. 跟着 Workflow 的 `next` 往前走，**直到下一步是长步骤**。长步骤指 `perform` 的 `start`（会跑模型）和 `run_check`（会跑检查命令）。领取、建 Session、准备、完成任务这类短步骤都在决定循环里做完。**不能靠“领取后 Workflow 会跳过同一任务”**：选择会先重新准备未入场的 `starting` Run、继续已结束 Run 的验证链，然后才到 running/ended 跳过（`workflow.ts:1697-1717`）；所以推进归属由 `activeTaskIds` 明确交给选择。
5. 下一步是长步骤时：先把回执或下一步里的 Run 记在自己的 `currentRun` 上（今天用 `receiptRunRefOf(result) ?? startRunRefOf(result.value.next)`，先记真实回执和 Run 再检查 stop，`collaboration-driver.ts:847-851`），把这一步连同任务和 `failedCardRefs` 交给这个任务的新看守（§3.3），交给看守后才清掉暂存的 `currentRun`，**不等它**，然后回到第 3 步，再问一次 `select_work`。这样同一个目标可以开出几个看守，并行受 Workflow 的选择规则约束（L46，以及 7C 的 L16 重叠闸门；规则都在 Workflow 里，驱动不判断）。
6. Workflow 返回：
   - `waiting` 且带等待依据：把依据并进这个目标的唯一一条登记（`register` 本来就是合并语义，`goal-wait-wakes.ts:83-94`），结束这一趟；
   - `waiting` 且没有依据，或 `next === null`：结束这一趟；
   - `completed`：目标完成，驱动状态写 `completed`；
   - 拒绝或异常：这一趟结束，原因写进 `reason`，驱动状态写 `failed`；看守照常收尾。
7. 这一趟结束时如果 `recheck` 为真，清掉它，马上再来一趟。

登记的失效和重建：每一趟决定开始时，先 `leave` 掉这个目标的旧登记；旧登记不清掉，重新登记仍会被同一个已见提交再次标记。`observedCursor` 在事实读之前取（今天的位置是 `collaboration-driver.ts:830-832`），不能在读完后再取新游标。Workflow 返回 `waiting` 后，用这个游标登记这一趟仍成立的依据。看守交回的是 `{ basis, cursorAtRead }`，`cursorAtRead` 是它自己那次 Workflow 读之前采的游标（不是交回时再取），目标驱动用它登记；多个依据合并时，`register` 保留较早的游标（`goal-wait-wakes.ts:83-94`），所以同一批提交不会被重复标记。

**“再看一次”的来源**，全部只是把 `recheck` 置真；循环空闲就启动一趟，循环忙就等这一趟结束后再来：
- 唤醒队列的 `wake(goalRef)`（§3.4）；
- 某个看守结束（任务链回到目标范围，或者等待、失败、完成），且已有目标范围的驱动（§3.1）；
- 带 `taskId` 的 `start`（人干预、路由）开出看守之后，且已有目标范围的驱动（§3.1）；
- 目标范围的 `start` 碰到已有的驱动（§4.1）。

### 3.3 Run 看守

一个看守跟着一个任务的链往下走，直接复用今天 `Handle` 的字段（`collaboration-driver.ts:264-302`）：种子、`flowId`、受信上下文、profiles 快照、状态、`current`/`last`/`reason`、`currentRun`、`failedCardRefs`、消息投影、`wakeWaiting`、pump 的 abort、`done`。今天句柄做的事，看守全部原样保留：
- `runWithPump`：跑 `start` 的同时读发件箱、处理咨询（`collaboration-driver.ts:747-771`、`pump` `:648-700`）；
- 让出后轮询那条等待消息（`awaitWake`，`:703-745`）；
- 回复到了，用同一个 Session、同一个任务继续（`:936-945`）；
- `failedCardRefs` 跟着当前连续选择走：决定循环和看守都保存它，作为 `WorkflowAdvanceInternal.failedCardRefs` 传给下一次推进，并按结果里的 `failedCardRefs` 更新（`:826-846`）；不放进公开输入；
- `next` 一直跟到链结束。

每次推进返回后，按这个顺序判：
1. 有让出续作（`yieldedContinuationOf`，`:781-791`）：走原来的 `pump` + `awaitWake`，回复到了用同一个 Session、同一个任务继续（`:936-945`）。这是不带依据的 `waiting`，不能当成“结束看守”。
2. 没有让出续作、`waiting` 带依据：把 `{ basis, cursorAtRead }` 交给目标驱动去登记（看守自己不登记、也不 `leave`），然后结束。
3. `waiting` 不带依据、`next === null`：看守结束，写清原因。
4. `completed`：看守结束。已接受目标范围启动的驱动：把结果交回目标驱动并置 `recheck`，由决定循环写目标状态；今天目标句柄在这个结果后会转回目标范围的 `select_work`（`:858-873`），改后这段交还由决定循环做。只有任务看守的驱动：看守写 `completed`，不交还（今天显式任务句柄的规则）。
5. 拒绝或异常：看守结束，写清原因。
6. `next` 是不带 `taskId` 的 `select_work`：看守不跟着它去领取别的任务；已接受目标范围启动时置目标的 `recheck`，否则不置；然后结束。带 `taskId` 的后继继续沿原链处理。不能只等 `state === 'completed'`：`complete_task`、失败返工等路径会返回无任务限定的 `select_work`（`workflow.ts:453-459`、`:2441-2445`、`:2524-2526`），都走这一条。
7. 其余 `next` 继续跟着这条任务的链走。
8. 被停（§3.5）。

同一个任务同时只有一个看守；看守结束时只从目标的 `activeTaskIds` 里去掉自己，看守表保留它的末次快照和启动身份（种子、`flowId`、`taskId`、上下文、profiles），直到同任务的新看守替换；看守自己不登记、不 `leave` 目标的等待。带 `taskId` 的 `start` 碰到这个任务已有在跑的看守，返回 `busy`，和今天按任务的句柄一致（`:1132-1134`）。

### 3.4 唤醒

`wake(ctx, goalRef)`：
- 有目标范围的驱动：置 `recheck`，循环空闲就启动一趟，**马上返回**。不碰任何看守，不解锁任何东西，不 `await` 推进。被人停下的驱动 `stopRequested` 还是真，这一趟在 §3.2 第 1 步就结束，迟到的唤醒拉不起它。
- 只有任务看守的驱动：驱动已请求停止就返回；否则按 §3.1 重开交回过依据的看守，马上返回。
- 没有驱动：建一个（`flowId: goal-wait:<goalId>`，和今天一样，`:1176`），算一次接受的目标范围启动，启动一趟，马上返回。

这一节修掉：
- P3：唤醒不会在任何看守上再起一个循环；
- P4：队列的 `drain` 不再等推进；
- F2：唤醒后的那一趟是正常的决定，碰到长步骤就开看守，任务会真的跑起来。

这条改了 7B 书 §3.8 第 4 条“唤醒只推进一步、不调模型”的规则。改后的规则是：唤醒本身不推进、不调模型，马上返回；推进由目标的决定循环正常去做。唤醒队列里仍然从不跑模型，这是原规则要保护的东西。

97-9 的规则不变：`ask`/`off` 档下有待处理重启中断的目标，Host 重建时不登记（`goal-wait-wakes.ts:175`、`:190`），也就收不到唤醒。

**等待依据要和真实提交对得上（D-F3）。** 自动确认的等待（直接阻塞和 L46 阻塞用同一个结果，`task-gate.ts:489`）今天把依据写成 `['UserDecision', 'Goal']`，但人答卡提交的聚合是 `SessionMessage`（`src/core/work-graph/communication/decision-service.ts:754-758`），重新排队提交的是 `TaskRequeue`（`src/core/work-graph/state/task-machine.ts:733`）；`UserDecision` 不作为提交的聚合出现，Host 订阅的 `GOAL_WAIT_WAKE_AGGREGATE_TYPES` 也没有 `TaskRequeue`（`goal-wait-wakes.ts:31-34`，接线在 `host.ts:850`）。所以生产只改两行：
- `task-gate.ts:489` 的依据改成 `['SessionMessage', 'TaskRequeue', 'Goal']`（`Goal` 保留：改设置也可能解除等待）；
- `goal-wait-wakes.ts:31-34` 加 `'TaskRequeue'` 和 `'UnknownCallReview'`。后者是同一类漏订阅：未知调用复核的五处等待依据（`workflow.ts:1641`，`task-gate.ts:574`、`:579`、`:583`、`:587`）写的是 `UnknownCallReview`，复核提交也确实写这个聚合（`src/core/work-graph/tasks/unknown-call-review-service.ts:459`、`:471`），但订阅里没有，复核答完目标同样不醒。

两行够：登记只按 `recordKinds` 和读之前的游标标记（`goal-wait-wakes.ts:102-111`），队列只转发订阅到的聚合类型；把这两个真实提交类型写进依据、把这两种聚合写进订阅，就覆盖了“答卡”“重新排队”和“复核”三条路，不需要改登记、队列或驱动。验收行见 §5 的 D-F3。

### 3.5 停和关

`stop({ goalRef })`：
- 停目标驱动和它所有的看守；
- 置 `stopRequested`，离开这个目标的登记；
- 中止每个看守的 pump，放行安全点等待；
- 对每个看守的 Run 走今天的取消（`requestCancel`，`:983-1051`，两遍：开始一遍，看守收完后一遍）；决定循环交接前暂存的 `currentRun` 由末次取消一并处理，复用同一个实现；
- **公开调用不等排空**：照今天立即返回第一个目标的快照，状态是 `stopping`（`:1207-1226`）；后台的 stop 排空等决定循环和所有看守的 `done` 都结束，**最后由排空写一次 `stopped`**。

`stop({ goalRef, taskId })`：
- 只停这一个看守，走同样的取消和排空；
- 目标驱动继续。被人停下的任务不会被自动再派，这由 Workflow 的人工停止围栏保证（C2，规则在 Workflow，驱动不判断）。

`close()`：和今天一样，不发取消，在安全点暂停，排空（SMK2，`:1229-1246`），对象换成驱动和看守。它等全部决定、看守和已经开始的 stop 排空；它不是人的 stop，不调用取消。

这一节修掉：
- P2：`stopRequested` 之后，循环、看守、pump 都不再写状态，状态只由 stop 的收尾写；
- P5：stop 等的是全部看守和决定循环，没有漏等的推进；决定循环交接前暂存的 `currentRun` 也在取消范围里；
- P6：看守和决定循环各自的 `finally` 清掉自己的 `wakeWaiting` 和占用；`busy` 只按“有没有在跑的看守或一趟决定”判断，不看残留的标记；停的时候也不跳过“已失败但还有残留”的对象。

P1 的修法：等待登记只在目标驱动上，一个目标一条；停一个看守不会碰它。

### 3.6 重启

驱动只在内存里，和今天一样：
- Host 启动时的重驱（`host.ts:1641-1652`，`auto` 档）照旧调 `start`，建出目标驱动；
- 唤醒队列的重建照旧登记，`queueAll` 之后唤醒；
- 不新加持久状态。

---

## 4. 对外入口：入参和返回格式不变，行为对照

### 4.1 `start(ctx, { advance, queryProfileIds })`

| 情况 | 今天 | 改后 |
|---|---|---|
| 不带 `taskId`，没有驱动 | 建目标句柄，跑 | 建目标驱动，跑一趟 |
| 不带 `taskId`，驱动只有任务看守 | 另建目标句柄，跑 | 同一个驱动装入启动状态，跑一趟；在跑的看守不动 |
| 不带 `taskId`，同种子 | 回放原快照 | 不变 |
| 不带 `taskId`，不同种子，驱动在跑 | `busy` | 不变（`busy`） |
| 不带 `taskId`，不同种子，驱动停在等待 | 新句柄顶替旧句柄（`:1126-1131`） | 同一个驱动，装入本次输入，置 `recheck`，返回它的快照；不新建 |
| 不带 `taskId`，不同种子，原驱动已 `stopped`/`completed`/`failed` | 新种子替换终态对象；同种子仍回放（`:1119-1147`） | 同种子回放；仍在推进或排空返回 `busy`；否则装入新的启动状态 |
| 带 `taskId`，这个任务没有在跑的看守 | 建任务句柄，跑 | 在目标驱动上开这个任务的看守（没有驱动就先建，不跑目标范围的决定），返回看守的快照 |
| 带 `taskId`，同种子 | 回放 | 不变 |
| 带 `taskId`，已有在跑的看守 | `busy` | 不变 |
| `onStarted` | 每个不带 `taskId` 的新句柄都调（`:1155`） | 每次接受目标范围的启动都调，回放和 `busy` 不调；97-9 的“人启动后清中断记录”不变 |

目标驱动每次接受启动时，先把本次接受的 `advance` 原样执行一次（可能是 `perform`，也可能带启动恢复的 `answers`；长步骤交看守，§3.2 第 2 步），再进入普通的目标范围选择；不同种子的停等重启也安装本次输入。

### 4.2 `read(ctx, { goalRef, taskId? })`

快照类型 `CollaborationSnapshot` 不变（`:74-86`）。

- 不带 `taskId`：保持今天的选择顺序，返回首个公开推进对象的快照；`siblings` 列出同一目标下其他看守的 `{ taskId, state, reason }`（§18.7 W4）。内部父对象的建立不改变这个顺序。
- 带 `taskId`：返回这个任务的看守的快照。看守结束后，最后的快照一直留着，直到同一任务开出新的看守（今天句柄结束后也留在表里）。没有就返回 `not_found`。

真正的 Goal 范围快照的 `state`，按这个顺序取第一个成立的：

| 条件 | 状态 |
|---|---|
| stop 已收尾 | `stopped` |
| stop 进行中 | `stopping` |
| Workflow 返回过 `completed` | `completed` |
| 最近一趟决定失败，且没有在跑的看守 | `failed` |
| 一趟决定正在跑，或有看守在 `running` | `running` |
| 有看守在等回复，或目标有登记的等待 | `waiting_for_reply` |
| 其他 | `waiting` |

看守的 `state` 和今天按任务的句柄一样。

### 4.3 `stop`、`wake`、`close`

见 §3.4、§3.5。返回格式不变：`stop` 返回目标驱动或看守的快照。

---

## 5. 测试

### 5.1 新行（验收）

每行一个具体的事件序列，经公开入口（路由、Host、驱动的 `start`/`wake`/`read`/`stop`）；先写失败测试，再改实现；每行配一个能让它变红的具体改坏方式。D-P3、D-P5 今天已近似绿（实跑：`starts=1`；`stop` 已等循环），是护栏行：写成后不要求先红，改完用具名变异证明它能红。

| # | 行 | 证明什么 | 让它变红的改坏方式 |
|---|---|---|---|
| D-P1 | 目标里 A、B 两个任务都在等；停 B | A 等的回复到了以后，A 照样往下走 | stop 时 `leave` 掉目标的登记 |
| D-P2 | 一个 `start` 的发件箱页在 stop 的 abort 之前返回；在真实 outbox 页的延迟返回处释放，stop 后读 `{ goalRef, taskId: A }` 的快照并记下状态通知序列 | 被停任务的快照只有 `stopping` → `stopped`，通知序列里没有 `waiting_for_reply` | 让 pump 在 stop 后仍写状态 |
| D-P3 | 模型闸门按住 A 的同一 `perform:start`，一次唤醒命中目标 | 这个相同输入的调用次数仍是 1，A 不出现第二个循环；claim、prepare 等正常步骤不计 | 让 `wake` 给没在等的看守再起循环 |
| D-P4 | 唤醒后的一趟又停在等待；先 hold 住真实推进，再调 `drain` | `drain` 立刻返回；同一工作区里另一个目标的唤醒照常送到；之后才释放被 hold 的推进 | 让 `wake` 等推进做完 |
| D-P5 | 唤醒起的一趟正在领取时，人停驱动 | `stopped` 出现在领取结果记录之后；新的不同种子 `start` 拿到 `busy`，直到 stop 收尾 | 让 stop 不等决定循环 |
| D-P6 | 等待中读执行记录抛异常，释放故障后同一任务用新种子再 `start` | 新种子不是 `busy`，并进入真实推进；`stop` 能停 | 删掉异常出口的推进占用清理 |
| D-F1 | 目标里两个互不依赖、模块不重叠的任务 | 两个 Run 都进入了，然后才有一个结束 | 让决定循环等看守 |
| D-F2 | 目标停在登记的等待上：用 BW 世界，驱动在 Run 已让出之后才启动，和 Host 重启后的情形一样。回复到了，经 Host 的唤醒队列 | 后继 Run 被启动（不只领取），不需要人推 | 恢复 `bounded` 的后继停放 |
| D-F3 | L46 世界：真实的答卡 `SessionMessage` 和重新排队 `TaskRequeue` 提交经真实 `createGoalWaitQueue` + `createWakeLoop`（接线同 `host.ts:832-851`），不手调 `wake` | 目标被唤醒，后继 Run 进入（和 D-F2 一起才完整） | 把 `task-gate.ts:489` 的依据改回 `['UserDecision', 'Goal']` |
| D-F3b | 未知调用复核的等待：真实复核提交 `UnknownCallReview` 经同一接线，不手调 `wake` | 目标被唤醒 | 从订阅里删掉 `UnknownCallReview` |
| D-R1 | A 在跑时采用一份加了任务 B 的新计划 | B 不等 A 结束就被启动 | 同 D-F1 |
| D-R2 | A 在跑时，人干预空闲线上的 B（经 Host 的消费） | B 的那一轮被推进；A 的推进不受影响；目标只有一个驱动（`read` 不带 `taskId` 的主快照加 `siblings` 列出 A、B 两个看守） | 恢复干预派发另起目标外的句柄 |
| D-T | 目标没有目标范围的驱动，人按 `taskId` 启动 A；A 在带依据的等待上结束，等的提交到了，经 Host 的唤醒队列；A 做完时 B 已可开工 | A 继续并做完；B 没有 Run，驱动快照里没有 B 的看守 | 让看守结束和唤醒都走目标范围的决定 |
| D-I | 模型服务出错把 Goal 记成 `interrupted`，驱动还在；人先真实 `tasks/requeue`，再用新种子不带 `taskId` 的 `driver-start` | 中断原因消失，目标继续（第二个 Run） | `onStarted` 只在驱动第一次启动时调 |

D-P1…D-P6 的事件序列照 §18.7 表里的“例子”一列写。每行的世界和入口如下（Codex 核过；代码行号按本树）。业务版本用 memory，只有实际重启的版本才用 SQLite。Host 触发的行为要经 Host 测（7B 的教训）。

| 行 | 复用的真实世界和入口 |
|---|---|
| D-P1 | `openS7BWorld`、`adoptS6BPlan`、`sendS7BWaitingInquiry` 搭同一个 Goal 的两个登记等待；由真实提交触发 Host 唤醒，不手调 `wake`（`tests/helpers/S7B-fixture.ts:38-43`、`:277-297`，`tests/helpers/S6B1-fixture.ts:71-84`） |
| D-P2 | 真实平台端口装配驱动，透传包装 outbox 读取并延迟真实结果（`src/app/collaboration-driver.ts:624-643`） |
| D-P3 | Host 的模型闸门（`tests/helpers/S6A-host-fixture.ts:373`） |
| D-P4 | 两个真实 Goal 加真实推进闸门（`deferred` 按住 `advanceWork`）；用 `queueAll`（`src/app/goal-wait-wakes.ts:124-126`）把登记标进 drain 批，不手调 `wake`；不用 WK 夹具手写的 G01–G20 当业务 Goal（`tests/helpers/S7B2-WK-wake-world.ts:53-59`）。改坏点是 `src/app/collaboration-driver.ts:1167-1169` 那样的 `await` |
| D-P5 | 真实 claim 的提交回答闸门，`CommitBarrier.holdAfter`，经驱动的 `stop`/`read` 查排空顺序，不读 store（`tests/helpers/S6A-commit-barrier.ts:137-152`） |
| D-P6 | 真实让出的等待，在执行读取处用 `failReads` 注入抛错，再释放（`tests/helpers/S6A-commit-barrier.ts:155-162`、`src/core/work-graph/tasks/plan-readers.ts:370-374`） |
| D-F1 | `openS7BWorld` 里采用两个工作任务、建两条线，分别按住模型请求；第二个请求先到、第一个没放就是并行的证据，不靠墙钟（`tests/helpers/S6B1-fixture.ts:71-90`、`tests/helpers/S6A-host-fixture.ts:373`） |
| D-F2 | 用 `openS7B2BasisGoal` 的前置，经 **Host 路由**启动；不用 `startS7B2BasisDriver`，它另建注册表、没接 Host 队列（`tests/helpers/S7B2-wake-basis.ts:39-47`、`:60-72`） |
| D-F3 | `openS7BL46World`、`applyL46Card`（`tests/helpers/S7B-L46-fixture.ts:68-113`、`:144-164`），经 Host 自己的 `goal_waits` 队列 |
| D-F3b | `openK3ReviewCardWorld`（`tests/helpers/K3-review-card-fixture.ts:141`），带 `shellSeam`（`tests/helpers/K3-tool-seams.ts:107`，否则 `createRecord` 搭不起）；K3 夹具不暴露提交观察，用 `observeRecordCommits`（`src/composition/commit-observer.ts:68`）取真实提交通知；接线同 `host.ts:832-851`：`createGoalWaitWakes`（`src/app/goal-wait-wakes.ts:53`）、`createGoalWaitQueue`（`:210`）、`GOAL_WAITS_QUEUE`（`:26`）、`createWakeLoop`（`src/app/wake-loop.ts:218`） |
| D-R1 | 保留 A 的任务定义，用 `refinementPlan`（`tests/helpers/S7B-V-fixture.ts:115-117`）走真实 `plans/propose` → `plans/apply` 加 B；不用只采用首份计划的 `adoptS6BPlan`（另见 `tests/helpers/S7A-fixture.ts:324-336`）。这一行还覆盖计划提交触发，不和 D-F1 重复 |
| D-R2 | `openS7B2ConsumeWorld`（`tests/helpers/S7B2-consumable-sessions.ts:218-287`，含 `:238-244` 的两次 `consumeBarrier` 预热和真实 consumer 期），由真实消费派发 B；只用 `openConsumeHostWorld` 不够（实跑：消费批没有把 B 交给干预派发），只调 `handleIntervention` 不覆盖 Host 接线（`tests/helpers/S6A-host-fixture.ts:382-383`） |
| D-T | `openS7BWorld`，经路由带 `taskId` 启动；唤醒用真实提交 |
| D-I | `tests/scenarios/SMK3B-model-service.test.ts` 的 memory Host 世界；`tasks/requeue` 的写法照 `:96-110`（那里用的是带 `taskId` 的启动，不走 `onStarted`，所以这一行不重复） |

等待和闸门都不新造：`deferred`（`tests/helpers/A2-restart-fixture.ts:201-207`）、`limitHold`（`tests/helpers/hold-limit.ts:8`，决定 100-4）、`CommitBarrier.hold`/`holdAfter`/`failReads`（`tests/helpers/S6A-commit-barrier.ts:133-162`）、Host 的模型闸门（`tests/helpers/S6A-host-fixture.ts:369-375`）。

### 5.2 要改的老行（有意的行为变化）

| 文件:行 | 今天断言 | 改后 | 依据 |
|---|---|---|---|
| `tests/business/S7B2-BW-wait-basis.test.ts:66-78` | committed claim 后停在 `current`：等 `'waiting'`、要求最后回执是 claim、后继停在 `current` | 后继 Run 被启动；不再断言这三项 | F2 |

除了这张表上的，所有老测试都必须原样通过，一行不改。直接或经一个现成 helper 用到驱动的测试文件（`grep` 结果，21 个；`wc -l` 逐个核过，共 7,471 行）：

```
tests/app/AG2b-collaboration.test.ts              tests/scenarios/A8-host-restart-lease.test.ts
tests/app/change-emitters.test.ts                  tests/scenarios/C8-human-stop-respected.test.ts
tests/app/S5R2-driver-safe-point.test.ts           tests/scenarios/K3-29-disposition-recovery.test.ts
tests/business/K3-46-review-advance-failures.test.ts  tests/scenarios/K3-44-crr-kind4.test.ts
tests/business/K3-UR7-crr-failed-set.test.ts       tests/scenarios/K3-44-recovery-answers.test.ts
tests/business/S7B1-B-continuation.test.ts         tests/scenarios/S2C-K-retired.test.ts
tests/business/S7B2-BW-wait-basis.test.ts          tests/scenarios/S7B-V-intervention.test.ts
tests/runtime/K-readonly-command.test.ts           tests/scenarios/S7B-V-restart.test.ts
tests/runtime/S5-user-message-tools.test.ts        tests/scenarios/SMK-secretary-adoption.test.ts
tests/scenarios/SMK2-host-close.test.ts            tests/scenarios/SMK3B-interrupted.test.ts
tests/scenarios/SMK3B-model-service.test.ts
helpers（5 个，共 1,580 行）: AG2b-collaboration-fixture.ts, K-readonly-host-support.ts, S5R2-d-support.ts, S7B2-wake-basis.ts, K3-review-card-fixture.ts
```

经 Host 间接用到驱动的测试更多。合入前照常跑全量和规模批（bubblewrap）。

### 5.3 预算

口径：**每处按删除 + 新增合计**（整段重写 N 行按“删 N + 增 N 左右”计）；先在本树用 `wc -l` 和函数边界数出今天的函数，再按复用程度给上下限，最后逐项加总。v1 的 700–1,000 是“整段 `:794-1247` 重写”的粗估，v2 不沿用：意见 14 明确不改 `read` 的目标选择，Workflow 两处是内部小改，D-F3 只有两行生产改动，主体仍复用今天的 Handle、pump、`requestCancel`、`snapshot`、`goalHandles`。

生产（加删合计）：

| 处 | 今天的位置 | 怎么改 | 加删 |
|---|---|---|---|
| 驱动类型 | `src/app/collaboration-driver.ts:264-302`（Handle）、`:74-123`（快照与端口） | 新增 `GoalDriver`/`Lane` 两个类型；Handle 的 seed、context、profiles、currentRun 等字段原样复用（§9 A） | 40–55 |
| 目标循环 | `:794-980`（`runHandle`，187 行） | 拆成目标驱动循环 + 看守循环；复用 `runWithPump`/`pump`/`advanceWorkNow` | 330–370 |
| 启动表 | `:1091-1157`（`startHandle`，67 行） | 同种子回放、终态、新装启动状态三路；每次接受目标范围才调 `onStarted`，回放和 `busy` 除外 | 105–125 |
| 唤醒 | `:1160-1178`（`wake`，19 行） | 置 `recheck`、空闲时起一趟、马上返回；只有任务看守时按 `taskId` 重开看守 | 38–50 |
| 停 | `:1064-1085`（`stopHandle`，22 行） | 驱动/看守的排空与 `stopped` 落点；`leaveGoalWait` 原样复用 | 30–37 |
| 取消 | `:983-1051`（`requestCancel`，69 行） | 只加交接前 `currentRun` 的末次取消，复用原实现 | 8 |
| 离开登记 | `:1057-1062`（`leaveGoalWait`，6 行） | 复用，最多补 Goal/Lane 的查找 | 0–3 |
| 公开 `read` | `:1192-1206`（15 行） | 按意见 14 不改目标选择，保持首个对象加兄弟 | 0–5 |
| 公开 `stop`/`close` | `:1207-1246`（40 行） | 适配驱动与看守；`close` 仍等全部、不取消 | 45–55 |
| Workflow 01 | `src/business/workflow/contracts.ts:238-250`；`workflow.ts:88-108`（Base）、`:708-746`（`baseFromInput`）、`:1610-1717`（选任务循环） | `WorkflowAdvanceInternal` 加 `activeTaskIds`，经 Base 传到选择循环并跳过这些任务；HTTP/公开路由不带 | 15–26 |
| Workflow 03 | `workflow.ts:1610-1845`（`selectNext` 的 Goal 范围循环） | 等待候选记下依据继续看；全不能推进才返回 `goalWaitBasisOf` 合并后的等待；`taskId` 调用保持立即等待 | 26–37 |
| D-F3 | `src/business/workflow/task-gate.ts:489`；`src/app/goal-wait-wakes.ts:31-34` | 依据改成 `['SessionMessage', 'TaskRequeue', 'Goal']`；订阅类型加 `'TaskRequeue'`、`'UnknownCallReview'`（两行生产改动，按加删计为 3） | 3 |

上下限怎么来：下限按“只改决定点、其余原样复用”取每处的最小改法；上限按“循环拆成两层、启动/停止各多一段终态分支和注释”取。两处 Workflow 的上下限差在等待依据的收集/合并要不要抽一段小函数；不新增同名 helper，只按控制流计。

生产合计 **640–775 行**（逐项 640–774，取整）。

测试（加删合计）：

| 项 | 算法 | 加删 |
|---|---|---|
| §5.1 十四行 | 每行 25–40 行（世界见 §5.1 的表）；D-F2、D-R2 走 Host，D-F3、D-F3b、D-T 用 Host 同款队列接线，取每行上限 | 350–560 |
| §5.2 改动 | 第一行三处断言与等待条件，10–20 行 | 10–20 |
| 共用夹具 | 只为新入口补的接线，不新造夹具；30–60 行 | 30–60 |

测试合计 **390–640 行**。

| | 下限 | 上限 |
|---|---|---|
| 生产 | 640 | 775 |
| 测试 | 390 | 640 |
| 总数 | 1,030 | 1,415 |

测试上限 640 不超过生产下限 640，满足“测试不超过生产”。

不把“削掉规定场景”或“少写后端”当节支；上面每一行都对应 §5.1/§5.2 的具名行。

---

## 6. 要你定的产品问题（不在这次代码里）

**新计划改到正在跑的任务。**

现在的规则：跑过的任务只能改处置，比如被替换或取消；而且前提是它所有的 Run 都已结束，否则采用被拒，返回 `busy`（`src/core/work-graph/state/plan-machine.ts:673-677`，TASK-19 守卫 1）。平台不会自己去停那个 Run，要你先手动暂停或取消，再采用。

可选：

| | 做法 | 好处 | 代价 |
|---|---|---|---|
| a | 保持现在 | 不改 | 你采用新计划时要先手动停；转向慢 |
| b | 你采用时，平台先在安全点停下受影响的 Run，停稳了再采用；界面显示“采用中，等 X 停下” | 一次操作完成转向 | 要改计划采用这条流程，单独一小片；“停下”算人的停止，被停的任务按人工停止围栏只能由人重新派 |
| c | 只对“取消/替换”自动停，对“延后”不停 | 介于两者之间 | 规则多一层 |

lead 建议 b。“目标改了快速转向”是你定的需求，而采用本身就是人的决定，停下符合人的意图。

**用户定（2026-10-31）：选 b。** 另开规格和小片，不在 DRV 的代码里。

---

## 7. 冻结前实跑核对（已跑，2026-10-31）

实跑报告：`./.dsh-ref/probe/drv-probe.md`。副本 `/tmp/drvp-probe` 从本树（HEAD `8fae469`）复制，2026-10-31 13:45–14:12 CST；书、源码、仓库测试均未改。10 条接缝：8 条成立、1 条不成立（F2b 的 Host 唤醒这一步）、1 条没法跑（F1-c，环境）。

1. **F1-a、F1-b 成立。** 经真实 Host 的 `workflow/driver-start`（不带 `taskId`）起一个有两个独立任务的目标，按住第一个模型调用：第二个任务没有 Run，目标句柄仍停在 `perform:start`；`advanceWork` 那时还没返回（`last` 仍是 `prepare` 回执，`src/app/collaboration-driver.ts:762`），释放后第一个 Run 才 `ended/completed`。这里只记正常新执行下看到的事实，不推广成“返回时 Run 一定已经结束或让出”。
2. **F2 分三种世界。**
   - F2a 成立：BW-basis 世界，回复到了 → 真实 `goal_waits` 唤醒（`src/app/goal-wait-wakes.ts:236`）→ 后继只领取：`claim_task` committed、Run 的 `status` 是 `starting`、`outcome=null`、`current` 停在 `prepare`（`src/app/collaboration-driver.ts:897`、`:821-825`、`:950-956`、`:973`），三个心跳后没有启动者。
   - F2b 的“经 Host 唤醒队列”这一步**不成立**：L46 世界，人答自动返工卡并重新排队后，真实 `goal_waits` 的两次 `drain` 都是 `progressed:0`，驱动一直停在等回复；强制调一次 `driver.wake` 之后才只领取。原因是自动确认等待的依据只写 `['UserDecision','Goal']`（`src/business/workflow/task-gate.ts:489`），而实际提交是 `SessionMessage` 的 response（`src/core/work-graph/communication/decision-service.ts:754-758`）和 `TaskRequeue`（`src/core/work-graph/state/task-machine.ts:733`），Host 的订阅表也没有 `TaskRequeue`（`src/app/goal-wait-wakes.ts:31-34`）。修法见 §5.1 的 D-F3。
   - F2c 成立：Run 自己让出的 `start` 结果不带 `waitBasis`，走轮询；回复到了以后同一句柄启动了一个不同的后继 Run 并跑完。
3. **§5.2 第二行没有老断言。** 全仓没有测试断言不带 `taskId` 的第二次 `start` 顶替停着的目标句柄；`tests/app/AG2b-collaboration.test.ts:295-297` 是同种子回放，`tests/app/S5R2-driver-safe-point.test.ts:62-63` 是两个不同目标。§5.2 按裁定删掉这一行，见 §5.2。
4. **今天的 Run 数上限：没有。** 资源上限片只给每条命令套内存和进程上限（`src/contracts/resource-caps.ts:12-35`、`src/app/host.ts:568-573`）；D-F1 的两个 Run 不会被挡；不新加上限，也不为不存在的上限加守卫或测试（见 §9 列表 B）。7D2 才计划同时运行上限（`slice-7-SPEC.md:42`、`:271`）。
5. **F1-c 没法跑（环境）。** 副本没有 `/usr/bin/bwrap`，第一个 Task 的登记检查返回 `rejected/unsupported`，看不到第二个任务接着开。这不是书或代码的结论。D-F1 的断言是第二个 Run 在第一个放开之前进入，不需要第一个跑完，所以不受这条影响；第一个跑完后第二个接着开，施工时在有 bwrap 的 post-run 里顺带看。
6. **7C 的顺序。** 7C-1 也在 `selectNext` 里改（L15/L16）；DRV 要在 7C-1 改 `selectNext` 的组开工前合入，7C-1 的开工裁定在 DRV 合入后按新树重指，见 §8。
7. **§5.1 各行的世界组合（第二轮实跑，`drv-probe2.md`，15:11–15:42）。** 十四行全部搭到触发之前再触发一次：12 行世界成立；D-R2、D-I 各改一处（已回写 §5.1：D-R2 要 `openS7B2ConsumeWorld`，D-I 要先 `tasks/requeue`）；0 行搭不出来。178 处 `file:line` 里只有 `workflow.ts:442-453` 指错，已改。D-F2 这一轮是 Host 路由加 Host 队列的真世界，补上了第一轮另装驱动的缺口。

---

## 8. 和 7C 的顺序

- 7C-1 的 L15/L16（挑人、重叠闸门）都在 Workflow 的 `selectNext` 里，DRV 不改这两条规则。
- L16 的前提是“同一目标有任务在跑时再派第二个”，生产里要等 DRV 合入才会发生。
- 但 DRV 在 Workflow 里也有两处内部改动，都在选择器附近：
  1. **01 推进归属。** 决定循环调 Workflow 时，通过现有的内部第三参数 `WorkflowAdvanceInternal`（`src/business/workflow/contracts.ts:238-249`）带上“正由看守推进的任务”`activeTaskIds`；Goal 范围的选择跳过这些任务。HTTP 和公开路由不带它。
  2. **03 不在第一个等待处停下。** Goal 范围的选择（不带 `taskId`）碰到一个在等的候选（今天在 `src/business/workflow/workflow.ts:1752-1756` 直接返回 `waiting`），改成记下它的等待依据、接着看后面的任务；有能推进的就推进，全都不能推进时才返回合并后的等待依据。等待依据复用 `goalWaitBasisOf`（`src/business/workflow/task-gate.ts:176-178`）。带 `taskId` 的调用保持原来的“立即等待”。
- 两处都只走内部参数和内部分支，对外接口不变，所以 DRV 的改动不给 7C-1 的 `selectNext` 组增加接口改动，也不阻塞它按新树开工；顺序只有一条：**DRV 要在 7C-1 改 `selectNext` 的组开工前合入**，7C-1 的开工裁定在 DRV 合入后按新树重指。
- 规格、审查、实跑可以和 7C 的开工裁定并行。
- **DRV 的底是 S1（`d15fa87`，`8fae469` 上挪走 Session 选择器），和 7C-1 的 F1 并行**：两边没有共用文件。本规格的 `workflow.ts` 行号按 `8fae469`，施工任务书按 S1 重指。

## 9. 列表 A（复用）和列表 B（不处理的错误）

**A，复用今天的代码，原样搬进看守或决定循环，不重写：**
- 跨目标的排序安全点：`awaitAdvanceAdmission`/`runRendezvous`（`src/app/collaboration-driver.ts:518-620`）；
- `runWithPump`、`pump`、`readAllOutbox`、`consultOne`、`consultFor`、`freshStart`（`src/app/collaboration-driver.ts:426-771`）；
- `awaitWake`（`src/app/collaboration-driver.ts:703-745`）；
- `requestCancel`（`src/app/collaboration-driver.ts:983-1051`）；
- `receiptRunRefOf`、`startRunRefOf`、`yieldedContinuationOf`（`src/app/collaboration-driver.ts:228-262`、`:781-792`）；
- `changed`/`tick` 的变更通知（`src/app/collaboration-driver.ts:346-367`）；
- 等待登记和唤醒队列（`src/app/goal-wait-wakes.ts`；机制不改，订阅加 `TaskRequeue`、`UnknownCallReview`，见 §3.4）；
- `goalHandles`（`src/app/collaboration-driver.ts:393-396`）：目标范围内活句柄的唯一查找；新 `read`/`stop`/`wake` 仍靠它，不另写“按目标找句柄”；
- `snapshot`/`handleSiblings`（`src/app/collaboration-driver.ts:369-391`）：`CollaborationSnapshot` 与 `siblings` 的投影；见 §4.2，它保留“首个匹配加兄弟”，形状和兄弟投影照原样复用；
- `handleKey`（`src/app/collaboration-driver.ts:215-217`）：`(project, workspace, goal, task)` 的句柄键；新的看守表必须用同一键规则，否则“同一任务只有一个看守”会出现第二把键；
- `isActive`/`isTerminal`（`src/app/collaboration-driver.ts:209-214`）：busy/stop 的判定；见 §3.5 的 P6，不在看守里重写；
- `stopHandle`/`leaveGoalWait`（`src/app/collaboration-driver.ts:1057-1085`）：停的 drain、离开等待、放行 gate；见 §3.5，走的就是这两段，不只 `requestCancel`；
- 调用身份：`Handle`、`snapshotContext`、`contextWith`、`selectProfiles`、`CollaborationSnapshot`（`src/app/collaboration-driver.ts:74-86`、`:189-202`、`:264-302`、`:419-423`），看守不重造；
- 推进包装 `advanceWorkNow` 和“完成 Task 后的观察步骤不参加排序”的规则（`src/app/collaboration-driver.ts:774-777`、`:803-819`、`:959-960`），决定循环不能只搬 `awaitAdvanceAdmission`；
- 推进归属没有现成字段：`taskId` 是单任务选择，`failedCardRefs` 是失败卡排除，都不能代替，所以加在现有内部参数上，不另建调度端口（`src/business/workflow/contracts.ts:218-222`、`:238-249`）；
- 消息、通知、取消各一个正本：`project`、`changed`/`tick`、`requestCancel`、`stopDrain`（`src/app/collaboration-driver.ts:346-367`、`:397-408`、`:983-1084`），目标和看守不各写一套；
- 调用上下文隔离和每个句柄的安全点放行表：`snapshotContext`/`contextWith`/`independentContext`/`loopContext`（`src/app/collaboration-driver.ts:189-207`、`:410-418`）与 `admissionWaits`（`src/app/collaboration-driver.ts:337`、`:560-567`）；新驱动/看守另建上下文或另一张放行表会破坏既有的隔离与 P5 的等齐。

**B，不为这些情况加防御：**
- 同一任务在两个驱动上：驱动按目标唯一，看守按任务唯一，不会发生。
- 决定循环同一时刻有两趟：单一 promise 加 `recheck`，不会发生。
- 唤醒到达时驱动已关：`closed` 时 `start` 已拒（`src/app/collaboration-driver.ts:1095`），`wake` 走同一入口。
- 没有同时在跑的 Run 数上限：资源上限片只给每条命令套内存和进程上限（`src/contracts/resource-caps.ts:12-35`、`src/app/host.ts:568-573`）；7D2 才计划同时运行上限（`slice-7-SPEC.md:42`、`:271`）。D-F1 的两个 Run 不会被挡；不为不存在的上限加守卫或测试。
- 两个持租约 Host 同时派工：Host 按实例租约建唤醒循环、封锁执行入口（`src/app/host.ts:831-840`、`:2180-2190`），不加防御或测试。
- 为同一 claim、Session 或租约再建驱动锁：claim 已把这些放进同一提交守卫（`src/core/work-graph/tasks/claim-service.ts:1304-1344`），检查 begin 的回放也不会再跑命令（`src/core/agent-runtime/check-execution.ts:172-176`）；要修的是推进归属，不复制 owner 的排他规则。
- 直接调用 `wake` 绕过 held 的 Goal：Host 重建和干预已拦这条路（`src/app/host.ts:842-847`、`src/business/workflow/intervention.ts:88-93`），不加第二层校验。
- 数据库篡改造成的缺字段、伪造 claim 或回执：不搭世界、不加行。
- 全局并发上限、持久调度表、定时补推、第二套等待队列：本规格没有要求，都不加。

---

## lead 审稿的改动（2026-10-31）

1. **显式任务不领无关的工作（§3.1、§3.2、§3.4、§4.1，新行 D-T）。** 第二稿让每个看守结束和每次唤醒都走目标范围的决定，只有任务看守的驱动也一样，这违反 `collaboration-driver.ts:862-869` 的规则：人按任务启动一个任务，做完后别的任务不该跟着被派。今天的唤醒在任务句柄上也只重查同一任务（`:906-912`）。
2. **`onStarted`（§3.1、§4.1，新行 D-I）。** 裁定 08 写的“首次接受”太窄：今天每个不带 `taskId` 的新句柄都调（`:1155`）。模型服务出错把 Goal 记成 `interrupted` 时驱动还在，人换种子重启要靠它清中断（97-9）。改成每次接受目标范围的启动都调。
3. **迟到的唤醒（§3.4）。** 写明被人停下的驱动 `stopRequested` 还是真，唤醒拉不起它。`wake` 新建的驱动算一次接受的目标范围启动。
4. **小改。** §0 的 7C 顺序、§3.1 写入者的例外、D-R2 的 `read` 写法（主快照加 `siblings`）、§5.3 的唤醒行和预算。
5. **Codex 冻结核对（12 条，都收）。** 改坏 2 条：看守结束时删了看守表，和重开、读末次快照冲突（§3.3）；首个接受的输入本身是长步骤时决定循环会被堵（§3.2 第 2 步）。其余：只有任务看守时谁 `leave`、停了以后的唤醒（§3.1、§3.4）；`recheck` 的条件（§3.3）；`UnknownCallReview` 同样漏订阅（§3.4，新行 D-F3b）；§5.1 的世界表和 §9 的两张列表按裁定第 51 行并入；D-P3 的计数范围；§5.3 的 `onStarted` 措辞和预算。`changes-v2.md` 和 DSH 回复里的行号、预算以本稿为准。
6. **第二轮实跑的回写（v2.2，冻结）。** D-R2、D-I 的世界，D-F3b 的 `shellSeam` 和 `observeRecordCommits`，D-P4 的 `queueAll`，D-R1 的 `refinementPlan`，D-P3、D-P5 标成护栏行，一处行号。
