# K 片规格：关闭悬空 Turn 后留在原 Session；只读命令

**后注（决定 49 第 29 项、决定 50）：** 约 4、284 行「接线包 2 在施工/施工中」已不成立：接线包 2 已合入 bb924854。正文原样保留，只加此注。

**后注（2C 合入，lead 2026-10-16）：** L8 的退路（另建接续 Session）对仍负责被中断任务的 RUN-19、RUN-23 Work 线走不到。2C 起复用的 Session 领取时也开负责关系；维护在 L7 关闭确定失败以后照今天的逻辑按退役归档（决定 42 第 2 条），重新领取走普通选择（决定 43）。Workflow 新建的线本来就是这样。暂停中重启、由人点继续的线照旧走 L8。§9 表里 A8-3n 那一行的断言随之改，见 [2C 规格 §16](slice-2C-SPEC.md)。L7、L8 的正文不改。

> **状态：已冻结（lead，2026-10-13）。** 测试入口已确认（决定 50）；按 Codex 两轮审查改过（`D:/cc-lead-notes/codex2/kspecrev.out.md` 16 条、`kspecrev2.out.md` 9 条）；U1 用户选丙（决定 51）。2026-10-14 加 §9 冻结后的修正（A 部分 M1–M9：写旧测试改动时核对出；B 部分 M10–M12：验收审查之后），以 §9 为准。
> - 代码基线：6c63f069（第 0、1、3、5 片和接线包 1 已合入；接线包 2 在施工，不碰本片的文件，除了 §0.3 列的几处）。
> - 依据：
>   - DESIGN 分片表 K 行和 §4.3“Kernel 补丁（K 片）”、§5.3；
>   - HANDOFF 决定 7、37、45、49（第 25、26 项）；
>   - STATE-MACHINES-SPEC 的 RUN-19/22/23/24、SES-06/07/09/10/13、TASK-27；
>   - 代码事实清单（Codex 只读，2026-10-13，`D:/cc-lead-notes/codex2/kfacts.out.md`）和 lead 对审查意见的逐条核对。
> - 两部分互不依赖，分开施工：
>   - **A：关闭悬空 Turn**，要第 1 片；
>   - **B：只读命令**，不依赖别的片。

## 0. 冻结说明（lead）

### 0.1 要用户定的

- **决定已全部有了。**
  - 决定 49 第 25 项选 (a)：中断后关闭悬空的 Turn，在原 Session 开新 Run；关不掉、读不到或不支持时，走今天的新 Session 退路。
  - 第 26 项选 (a)：只读命令，所有获授权的只读角色都能用（DESIGN §5.3 表：独立审阅、秘书回合、问一问、规划）。
- **测试入口用户 2026-10-13 已确认**（§5.1，决定 50）。
- **U1 已定（决定 51，用户 2026-10-13 选丙）：经人认定以后、Kernel Turn 还开着的线，维护关闭悬空 Turn，线回到可用，不归档。**
  - 背景：决定 45 说认定以后下一次维护归档这条线、写异常锚点、放下任务；今天的代码对 Turn 还开着的这种线却是跳过（`session-maintenance.ts` 的 `platformCleanInterruption`）。两者不一致，是本片之前就有的。
  - 决定 51 改掉决定 45 的“归档、写锚点、放下任务”这一部分，只对这种线：你的认定已经证明它停了，所以关闭是安全的；之后任务照常按规则接着做，多半回到这条线，接续说明列出结果未知的那几步。
  - 决定 45 的其余部分不变：认定之前，结果未知、仍占着 Session 的线零写入，等你认定。
  - Kernel 读不到的、关闭不支持或失败的，仍按今天归档（决定 45）。
- **lead 的两处取舍（用户已知）：**
  1. **人暂停的线（RUN-24）维护不碰。** 只有人点“继续”或人恢复目标（L4 第 2 条核对请求者）时才关闭。维护里自动关闭的是：RUN-19、带干净 Turn 的 RUN-23，以及决定 51 的经人认定的线（RUN-22）。
  2. **只读命令按“这次执行是只读的”来给，不按“是不是 Query”来给。** 包括 Query，和写范围为空的 Work（例如独立审阅）。第一稿写成“只给 Query”，和 DESIGN §5.3 的表不符，已改。
- **另开的一小片（决定 51）：** 重启后“结果未知”的自动收尾。方向是凭 Host 实例租约证明旧进程已不在，平台自动收尾、下一轮先核对；证明不了才等人认定。规格另写、先给用户看。本片不做；本片的结束方式表（L4 第 2 条）是它以后接入的地方。

### 0.2 lead 定的技术选择

**A 部分：**

- **L1 Kernel 新增一个明确的终态 `interrupted`**，不借用 `failed` 或 `cancelled`。
  - 新事件 `run.interrupted`，载荷 `{ reason: 'platform_closed', requestedBy: 'app' }`。
  - `runStatusSchema` 加 `interrupted` 并算终态；`runOutcomeSchema` 加 `{ kind: 'interrupted', reason: 'platform_closed' }`。
  - **能从哪些状态进入：** `created`（`turn.started` 已提交、`run.started` 还没有）、`running` 的任何阶段（含等模型、工具批未结算）、`paused`。已终态的 Turn 拒绝它，同所有终态。
  - **归约和别的终态一样**（`terminalState`）：清掉进行中的模型请求和暂停；待开始的工具调用记为 `abandoned`，已开始未完成的记为 `outcome_unknown`；不编造任何结果。
  - **身份重放：** 同一 runId/turnId 再次 `runCodingAgent` 或恢复，归约到终态后直接返回终态结果，不恢复执行、不跑工具、不写记录。旧检查点比关闭事件早，或者之后同一 Session 已有新 Turn，都一样。
  - `kernelSessionApiVersion` 从 2 改为 3。
  - **平台怎么读它：** `run.interrupted` 是“平台已经结束的 Run 留下的 Kernel 收尾”，不是平台 Run 的结果。
    - `execution-observation.ts:terminalEventOf` 对它返回 `null`，从不产生平台 Run 事件，从不改平台 Run 的结果。
    - 平台核对（`run-reconcile.ts:classifyRun`）、观察者遇到一个还没结束的平台 Run 的 Kernel Turn 是 `interrupted`：在 L4 的前提下不可能发生；真遇到了，什么都不写，只报告（`left`，原因 `kernel_closed_without_platform_end`），等人核对。
    - 各终态集合要认它：`run-state.ts:terminalStatuses`、`run-reconcile.ts:TERMINAL_STATUSES`、`context-assembler.ts:KERNEL_TERMINAL_EVENTS`、`kernel-turn-facts.ts`、`query-observation.ts:mapOutcome`（Query 线本片不关，遇到时同上报告，不当“已回答”）。
- **L2 关闭是追加一条记录，不改表。**
  - 新公开函数 `closeOpenTurn(store, { sessionId, kernelRunId, expectedRevision, at })`，从 `public-api.ts` 导出。
  - 期望版本用调用方给的 `expectedRevision`，不自己重读替换；Runtime 先探测读头，再把头的 revision 传进来。
  - 按下表**从上往下第一条命中的**返回。除了最后一行，都不写任何东西：

    | 顺序 | 情况 | 返回 |
    | --- | --- | --- |
    | 1 | 存储读不了、Session 不存在 | `unreadable { reason }` |
    | 2 | 这个 Session 里没有 runId 等于 `kernelRunId` 的 Turn | `not_found` |
    | 3 | 这个 Turn 已经是 `interrupted` | `already_closed { position, revision }`：position 是原来那条 `run.interrupted` 的位置，revision 是头现在的版本 |
    | 4 | 这个 Turn 是别的终态 | `already_terminal { status }` |
    | 5 | 这个 Turn 没结束，但头上的活动 Run 不是它 | `mismatch { activeRunId }` |
    | 6 | 头的 revision 不等于 `expectedRevision` | `conflict { currentRevision }` |
    | 7 | 其余 | 用 `SqliteStores.append` 追加一条 `run.interrupted`，返回 `closed { revision, position }` |

  - 追加的事件：顺序号接上一条；`occurredAt = at`；`elapsedMs` 等于这个 Turn 最后的 elapsed（不倒退）；事件 ID 和记录 ID 由 `(sessionId, kernelRunId, 'platform_closed')` 决定。
  - 追加时版本被别人改了，返回 `conflict`。正常的终态投影会在同一次提交里清掉头上的两个活动 ID。
  - **重做靠第 3 行：** 关闭已提交、回复丢了，再调一次就命中第 3 行，拿到原来的位置。确定性的记录 ID 只是第二道防重复，不承诺“返回原记录”。
  - 第 5 行是防御：合法的追加造不出“没结束的 Turn 不在头上”，正常的存储里遇不到。不要求测试，由代码审查核对。
  - **另一个公开的只读函数** `readTurnBounds(store, { sessionId, kernelRunId })`，按身份找这个 Turn：
    - 返回 `{ status: 'found', startPosition, endPosition, terminalStatus }`；
    - 没结束时 `endPosition`、`terminalStatus` 为 `null`；
    - 或 `not_found`、`unreadable`。
    - `closeOpenTurn` 的第 2–5 行用它判断；接续说明用它定事实窗口（L9）。
- **L3 历史还原跳过被中断那一步的内容，保留它的边界和身份。**
  - `restoreSessionHistory`：前缀里的 `interrupted` Turn，
    - 照常重放；重放失败、身份不符、最后一条不是它的 `run.interrupted`，都照常报错；
    - 照常记进 `turns`，所以“历史前缀包含当前 Turn”这类身份重叠检查继续有效；
    - 不调用 `projectTerminalTranscript`，不把它的用户消息、模型回复和工具过程放进 transcript；
    - 未决调用和 `outcome_unknown` 的检查不对它做，因为这正是被中断的内容。
  - 不是 `interrupted` 的 Turn，现有检查一条不放松：真正的终态里带未知工具结果，照旧拒绝。
  - `run.interrupted` 算终止事件（`TERMINAL_EVENT_TYPES`），可以作边界；`findLastCompletedTurnBoundary` 也认它。边界落在没结束的 Turn 里、前缀不连续，照旧拒绝。
  - 前缀里全是被中断的 Turn 时，`turns` 不空，不报“没有已完成轮次”，transcript 为空。
  - `projectTerminalTranscript` 被直接用在一个 `interrupted` 的状态上时报 `conflict`，原因是“被中断的 Turn 不进模型输入”。
  - **平台游标分两种情况：**
    - 关后第一次接续：平台 Session 的 `historyCursor` 不动，仍是被中断那一步之前最后一个已完成边界，Kernel 只还原到那里。
    - 之后的接续：游标越过关闭事件，按上面的规则跳过。
    - 两种都要测（KA-04）。
  - 原记录照常按位置读得到（`sessions/history`、`readSessionHistory` 不变）。
- **L4 Runtime 的关闭操作和它的前提。**
  - AgentRuntime 加 `closeOpenTurn(ctx, { sessionRef, afterRunRef, requeueRef })`，只有 Host 持有实例租约时可用。
  - 按顺序检查，任一条不成立就 `refused`，什么都不写：
    1. **Run：** `afterRunRef` 是一次 Work Run，`status === 'ended'`，结果已知（不是 `outcome_unknown`），它的领取 Session 就是 `sessionRef`。
    2. **结束方式和授权：**
       - RUN-19（`interrupted_clean`，`pausedIntentRef === null`）或 RUN-23（`cancelled`，`interrupted_clean`）：不要 TaskRequeue；
       - RUN-24（`isPausedInterrupted`）：必须带 `requeueRef`，这条 TaskRequeue 覆盖的正是 `afterRunRef`，而且请求者是人，或是带 `goal_resume` 触发的目标恢复（TASK-27 的两种合法请求者）；
       - RUN-22（`outcome: 'crashed'`，核对观察是 `human_attested`）：不要 TaskRequeue。你的认定本身就是授权（决定 51）；
       - RUN-24 没带、不覆盖或请求者不对：`refused('continuation_not_authorized')`；
       - 其它结束方式：`refused('not_closable_run')`。
       - 各结束方式在平台 Run 记录上的区分：RUN-19 是 `crashed` + `interrupted_clean` + 暂停意图为空；RUN-23 是 `cancelled` + `interrupted_clean` + 暂停意图为空；RUN-24 是 `crashed` + `interrupted_clean` + 暂停意图不为空；RUN-22 是 `crashed` + `human_attested`（`run-machine.ts`）。
    3. **Session：** `lifecycle === 'active'`，没有归档请求，`occupancy === null`，没有记录在案的接续 Session（来历指向它的）。否则分别 `refused('archived' | 'archive_requested' | 'occupied' | 'handed_over')`。
    4. **健康：**
       - `unavailable` 且结论 `kernel_turn_open`：继续往下；
       - 已经 `available`：说明以前关过并恢复了，再探测一次确认头上没有活动 Run，返回 `already_closed`、健康 `available`，不写；
       - 其它：`refused('health')`。
    5. **存储：** 经 `KernelStoreRegistry.withStore` 打开这个 Session 登记的存储。
       - 只有 legacy 读取器（`withLegacyReader`）、适配器不同、Kernel 没有 `closeOpenTurn`：`unsupported`；
       - 存储文件不在：`unreadable`。打开时沿用现有的“文件不存在不新建”的做法。
  - 然后探测读头，把头的 revision 和 Run 绑定的 Kernel runId 交给 L2。
  - Kernel 返回 `closed` 或 `already_closed` 后，再做一次真正的探测，交给健康的 owner `recordSessionHealth`。这和启动核对第 1 步用的是同一个方法：ready 且没有活动 Run 时，按 SES-13 回到 `available`。
  - 健康这一步由 Runtime 经新注入的依赖调用（组合里接到同一个 `sessionHealth`），Runtime 自己不写健康。
  - Kernel 已关，但这次探测不是 ready、或健康没写成：返回 `closed`（或 `already_closed`）、健康 `unavailable`。这是可以重试的结果，见 L7 的两张表。
  - Kernel 的结果对应到 Runtime 的结果：
    - `not_found`、`already_terminal`、`mismatch` → `mismatch`；
    - `conflict` → `conflict`；
    - `unreadable` → `unreadable`；
    - 探测是 `transient`、`cancelled` 或 `host_config` → `transient`。
  - 结果未知、仍占着 Session 的 Run（决定 45）被第 1、3 条挡住，不能靠“关掉 Kernel 头”变成可执行。
- **L5 健康走已有的 SES-13，不新加状态行。** 不拿关闭的返回值直接写健康。接线包 2 合入以后，SES-13 一并清除 `unavailableSince`。
- **L6 崩溃和竞争：两个存储不在同一次提交里，靠重做和已有的启动核对恢复。**

  | 窗口 | 恢复 |
  | --- | --- |
  | Kernel 已关、健康没写，Host 还在 | 再调一次：Kernel 命中 L2 第 3 行 `already_closed`，再探测，走 SES-13 |
  | 同上，Host 重启 | 启动核对第 1 步本来就探测每个不可用的 Session：ready 且没有活动 Run，走 SES-13（已有代码，不改） |
  | 健康已写，Workflow 的回执丢了 | 下一次推进重新选择：Session 已可用，直接复用领取，不再关、不建新 Session |
  | 退路已建新 Session，交接或领取没提交 | 原 Session 已有接续，L4 第 3 条拒绝关闭；照接线包 1 的 E15 从来历恢复交接，不复活前任 |
  | 归档请求已提交、回复丢了 | 维护先接着做归档（顺序第 1）；关闭被 L4 第 3 条拒绝 |
  | 关闭前检查之后，归档、占用、负责关系又变了 | Kernel 的版本挡不住这些平台事实，本操作也不另加围栏。健康 owner 写入时自己重读 Session、按自己的守卫判断（SES-13 的守卫：Session 未归档、Host 持有实例租约、探测 ready；结论是 `kernel_turn_open` 时还要头上没有活动 Run。它不看占用）；之后 Workflow 按新事实重新选择 |
  | 任务已由另一个 Session 接着做 | 去向优先（E16）选那个 Session；原 Session 有接续时不关；只是负责关系转走、没有接续的，关了也只是变成一条空闲可用的线，不拿回任务 |
- **L7 在哪里触发：维护和 Workflow 两处，同一个 Runtime 操作。**
  - **结果分三类**，两处都按这三类走：
    - **成功：** `closed` 或 `already_closed`，健康 `available`。
    - **可以重试：**
      - `closed` 或 `already_closed`，健康 `unavailable`（探测没 ready 或健康没写成）；
      - `conflict`、`transient`；
      - `refused('lease')`。
    - **确定失败：**
      - `unsupported`、`unreadable`、`mismatch`；
      - `refused('not_closable_run' | 'continuation_not_authorized')`。
    - 其余的 `refused`（`archived`、`archive_requested`、`occupied`、`handed_over`、`health`）说明平台事实已经变了：不推出任何结论，按新事实重新走。
  - **维护（`session-maintenance.ts:maintainSessions`）。** 今天的先后一条不动，只在一处插入：
    - 不动的部分：
      - 归档请求先接着做；
      - 结果未知的占用 `busy`、零写入（决定 45，IT34、HM03）；
      - 正式结束的负责关系先关；
      - 有占用跳过；
      - 有接续的线：做完交接的按 `handoff_complete` 归档（HM01、HM04），还有没做完的负责关系就零写入等着（HM02）。永不关闭。
    - **插入点：** 没有接续的退役线，在今天判断 `kernel_turn_open` 豁免的那一处（`platformCleanInterruption` 所在的条件）之前。下面四条都成立才调 `closeOpenTurn`（不带 `requeueRef`）：
      1. 结论是 `kernel_turn_open`；
      2. 最近一次工作执行是 Run；
      3. 最近那次 Run 的结束方式是：RUN-19，或带干净 Turn 的 RUN-23（即 `platformCleanInterruption` 为真，暂停意图为空），或经人认定的 RUN-22（核对观察 `human_attested`，决定 51）；
      4. 来历已核清：`facts.legacyPending` 为假，这条线自己的来历不为空。否则“没有接续”没法证明，不关。
    - 关闭的结果：
      - 成功：这条线本次不归档，跳过。
      - 可以重试：这条线本次也跳过，不落到归档。下一轮维护或 Workflow 再试。
      - 确定失败，或没满足上面四条：一字不改地走今天的逻辑。今天的逻辑是：
        - `kernel_turn_open` 豁免照旧；
        - 然后来历核不清的报 `incomplete`；
        - 然后按退役归档。
    - 人暂停的线、Query 线不满足第 3 条（或第 2 条），处理和今天一字不差。
    - 经人认定的线关闭成功以后不归档、不写异常锚点、不放下任务（决定 51）；关闭确定失败时，照今天的逻辑走（决定 45）。
  - **Workflow（`workflow.ts:claimRequeued`）：** 前面的顺序不变：转去的 Session 优先（E16）；被排除、已归档、职责不对、`missing/damaged` 的走普通选择。遇到 `occupancy === null`、`unavailable/kernel_turn_open` 时：
    - 原 Session 已有为这个任务建的接续 Session（退路已经开始）：照今天走 `create_session{requeue}` 的重放和 E15 交接恢复，不关；
    - 否则返回一步 `close_open_turn`，请求是 `{ sessionRef, afterRunRef, requeueRef }`。
  - **`close_open_turn` 回执之后怎么走：**

    | 回执 | 下一步 |
    | --- | --- |
    | 成功 | 按新事实重新选择；正常情况就是在原 Session 领取，开新 Run |
    | 可以重试 | `waiting`，写明原因，下次推进再来；不走退路 |
    | 确定失败 | 退路：`create_session{requeue}`，连同接线包 1 的交接 |
    | 其余的 `refused` | 按新事实重新选择，不从这张回执推出“走退路” |

  - `advanceWork` 执行完一步以后会跑维护。按上面的维护规则，可以重试的线不会在这时被归档；同一次推进里维护也可能已经关成功。不管是哪一处关成功的，下一次选择都在原 Session 领取。
  - **WorkflowCalls 新成员** `close_open_turn: NonNullable<RuntimeExecutionPort['closeOpenTurn']>`，请求和回执沿用 `WorkflowOperation` / `WorkflowStepReceipt` 的推导，不另写影子类型。
    - 这个操作本身幂等，不存回执。同一请求再执行一次，按当时的事实重新算：已关的命中 L2 第 3 行，返回 `already_closed`。
    - 所以“重放”就是再执行一次，不会把上一次的 `conflict` 或 `transient` 原样还回来。

- **L8 退路不变。** 下列情况照今天的做法另建接续 Session，负责关系照常交接，前任按规则归档：
  - Kernel 读不到；
  - 两个 Session 不在同一个 Kernel 适配器上；
  - 只有旧的只读 legacy 读取器（`withLegacyReader`）；
  - Kernel 头上是别的 Run（`mismatch`）。

  已归档的旧 Session（补丁之前的）不复活。发给退路前任的回复不自动转发（DESIGN §4.3）。
- **L9 留在原 Session 接续时，接续方式用已有的 `same_session_without_previous_turn`，不新加；但事实窗口按 Kernel 身份重新定。**
  - **接续方式。** 这几种结束都没有 Kernel 终点位置：RUN-19/23/24 的 `executionHistory.endPosition` 为空；RUN-22 沿用之前的位置记录，可能整个都没有。所以 `assembleContinuationBrief` 已经会归为“在同一 Session 中继续，但上一次执行的 Turn 不在模型历史中”，并列出已接受的消息、已生效的插话和工具事实。`src/contracts/continuation-brief.ts` 不改。
  - **为什么要改事实窗口。** 今天 `readPreviousTurn` 只读平台 Run 上记的窗口。有两种情况会漏：
    - 从 Entering 进入结果未知、后来经人认定的 Run（RUN-20(ii) → RUN-22），可能根本没有位置记录，今天会被读成“没进入过”，哪怕 Kernel 里确有一个开着的 Turn；
    - 正在跑的 Run 在核对时保留旧的位置记录，不往后推，之后才发现的记录不在窗口里。
  - **新规则。** 同一 Session 接续，而且 afterRun 绑定的 Kernel Turn 已经是 `interrupted` 时：
    - 接续说明用 L2 的 `readTurnBounds` 按 Kernel 身份找到这个 Turn；
    - 从它的 `turn.started` 读到它的 `run.interrupted`；
    - 平台 Run 上记的窗口不再决定事实范围。
    - 这只是读，不改平台 Run 的任何记录。
  - **读不全时如实标出**，用现有的 `omittedRecords`，或标成 `unavailable`：超出现有的条数上限、记录损坏、存储读不到。不能说“没进入过”。
  - 其它情况（跨 Session 接续、没关闭过的 Turn）照今天的 `readPreviousTurn`。
  - afterRun 没进入过 Kernel 的链，照现有的 `factsHop` 规则找事实来源；找到的那次 Run 如果符合上面的新规则，也按新规则读。
  - 要改的只有 `continuation-brief-assembly.ts` 的读取部分。

- **L10 只关 Work 的线。**
  - Query Session（秘书回合、只读副本）的 `kernel_turn_open`（SES-09、SES-10）本片不关，照今天的规则处理（A8 Q-01）。
  - 理由：DESIGN §4.3 说的是 Workflow 的接续；Query 的接续规则属于第 6 片。
  - 第 6 片要另定 Query 的身份和授权怎么接：本片的操作只收 `RunRef`，不收 `QueryRunRef`。
- **L11 能力上报改写。**
  - `continueHistory` 不再无条件写“换新 Session”，改成：Work 线中断后，能关闭悬空 Turn 的在原 Session 接续；Query 线照旧换新 Session；并列出 L8 的退路。
  - 仍从不报成“恢复原执行”。

**B 部分：**（代码事实经 lead 抽查：`process-sandbox.ts:#arguments`、`permission-policy.js:evaluate`、`shell-tool.js`、`tool-dispatcher.js`。）

- **L12 另做一个只读命令工具，不改现有的 `shell`。**
  - 工具名 `run_readonly_command`，平台扩展工具（新文件 `src/core/agent-runtime/readonly-command-tool.ts`）。
  - 入参（严格 schema）：`{ command: string（至少 1 个字符）, cwd?: string（工作区内的相对目录，默认 "."）, timeoutMs?: integer }`。`timeoutMs` 取 1000–120000，默认 30000；超出范围报 `invalid_arguments`，不悄悄截成上限。
  - 不给标准输入，不给交互终端。
  - 工具定义：`effectClass: 'process'`，`requiredCapabilities: ['workspace_read', 'isolated_process', 'network_isolated']`，`independentReadOnly: false`，`defaultTimeoutMs: 130000`，`outputLimitBytes: 131072`。
    - 不声明成 `read_only`：权限策略对“已注册只读工具”只看工具自报，不能拿来放行一个跑进程的工具。
    - 声明了沙箱能力，Kernel 探测不到 bubblewrap 时，分派器在调用处理器之前就以 `sandbox_unavailable` 拒绝。
  - 现有 `shell` 要求写权限，它的授权和行为都不变。
- **L13 进程沙箱加只读模式。**
  - `ProcessSandbox` 的构造选项加 `workspaceMode?: 'read_write' | 'read_only'`，默认 `read_write`，现有调用一个字节都不变。
  - `read_only` 时：
    - 工作区根用 `--ro-bind-fd 3 /workspace`。仍按 fd 挂载，保留“挂载后、exec 前关掉受信根 fd”的现有保护，不改成普通的 `/proc/self/fd/...` 绑定。
    - 受保护的目录（`.git` 以外）仍是空目录，但要只读：`--tmpfs` 之后 `--remount-ro`。受保护的文件照旧用只读的 `/dev/null` 盖住；`.git` 目录照旧只读绑定。
    - 受保护路径有包含关系时（例如 `secret` 和 `secret/nested`），只挂最上层的那个：下层已经被盖住，而且只读以后建不了下层的挂载点。挂载按路径从上到下的顺序。
    - `/tmp` 和临时 HOME 仍在 tmpfs 根上，可写，命令结束就没了；网络、环境变量清空、PID 命名空间都照旧。
  - 探测：只读模式第一次用之前，用**这次实际的受保护路径配置**跑一次只读的金丝雀。它确认 bwrap 支持 `--ro-bind-fd` 和 `--remount-ro`，并确认写工作区、写受保护目录都会失败。
    - 结果按（沙箱配置、受保护路径集合）在 Host 进程里缓存，不每次调用都探测。
    - 不支持就当沙箱不可用，绝不退回读写挂载，也绝不退回主机命令行。
  - `cwd`：先照现有的 `normalizeWorkspacePath` 做字面检查。再在主机侧对工作区根解析真实路径：解析后在工作区外、经过符号链接跳出、落在受保护路径里，都在启动前报 `invalid_arguments`。
- **L14 模式按每次调用定，不存进 Run 的恢复约束。**
  - 工具每次调用自己用公开接口建一个 `read_only` 的 `ProcessSandbox`：同一个 `WorkspaceSandbox`，同样的 `deniedPrefixes` 和 `executablePath`。现有平台代码已这样建过（`workbench-tools.ts`、`check-execution.ts`）。
  - 不改 `effectiveRecoveryConstraintsSchema`，恢复规则不变。
- **L15 执行后用现有快照再核对一次；它是第二道检查，第一道是只读挂载。**
  - `read_only` 时 `execute` 照常在前后各拍一次快照，但**从不调用 `acceptAgentChanges`**，不推进 Kernel 认可的基线。
  - 现有快照比较看到了变化：路径放进结果的 `externalChangedPaths`，`sideEffect` 仍是 `none`。这些变化只可能来自同时在写的别的写者，不算这次命令的效果。
    - 路径按字节序排序，最多给前 100 条，另给 `externalChangedPathsOmitted`（略去的条数）。
  - 没有变化：`sideEffect: 'none'`，不写 `possible`。
  - **快照看得到的范围如实写明：** git 忽略的文件、默认忽略的前缀（`node_modules`、`dist` 等）看不到。在 git 快照失败、退回目录遍历时，看的是元数据，跳过符号链接。所以这一条只承诺“现有快照比较能看到的变化”。
- **L16 结果、限额和失败的先后。** 分两层：处理器自己返回的结果；冻结的分派器在外面盖上的结果（`tool-dispatcher.js:#executeHandler`，不改）。
  - **限额：**
    - 子进程超时从启动后算（和现有一样）；超时先给进程组发 SIGTERM，250 ms 后 SIGKILL。
    - 分派器在 `defaultTimeoutMs`（130 秒）时发一个取消请求，这不是硬截止：快照等不能中断的步骤会做完才返回。
  - **输出：**
    - 标准输出、错误输出各保留前 32 KiB 文本，给出总字节数和是否截断。
    - 处理器保证结果序列化后不超过 `outputLimitBytes`（128 KiB）。顺序：先按 L15 把路径限在 100 条；还超就从尾部继续截输出文本，截过的标 `truncated`。
    - 不照抄 `shell` 的每路 64 KiB：那样两路加上 JSON 转义可能超过分派器的上限。
  - **给模型的结果**和 `shell` 同形：一段文本是标准输出；一段 JSON 是 `{ exitCode, signal, stdout: {totalBytes, truncated}, stderr: {text, totalBytes, truncated}, timedOut, externalChangedPaths, externalChangedPathsOmitted, timings }`。
  - **处理器自己返回时**，状态按这个顺序取第一条命中的：
    1. 入参不对、`cwd` 不合规：错误 `invalid_arguments`，不启动；
    2. 授权已不是当前的（L18 第 3 层）：错误 `forbidden`，不启动；
    3. 启动失败：错误 `execution_failed`；
    4. 有 `externalChangedPaths`：错误 `workspace_changed_during_readonly_command`，附路径和已捕获的输出；
    5. 子进程超时：错误 `timeout`，附已捕获的输出；
    6. 退出码不为 0：错误 `execution_failed`（“命令退出码 N”），附输出；
    7. 其余：成功。
  - **分派器盖在外面的，优先于上面所有各条：**
    - 沙箱能力缺失：在调用处理器之前就是 `sandbox_unavailable`，不启动；
    - 这次执行被取消（暂停、取消）：`cancelled`，输出是空的，这是冻结分派器的做法；
    - 到 130 秒：`timeout`，输出是空的。
    - 处理器的结果被盖掉时，捕获到的输出不保留。工具说明里如实写。
  - 每一种都是 `sideEffect: 'none'`。

- **L17 边界如实写进工具说明。**
  - **git：**
    - 普通仓库（`.git` 是目录）能看记录、看差异；
    - 要写 `.git` 的操作（会建 `index.lock` 的）失败，报的是 git 自己的错误；
    - 链接式工作树（`.git` 是文件，被盖成 `/dev/null`）里 git 用不了。
  - **能读到什么：** 只盖住工作区根上的受保护路径（`.env`、`credentials` 等和 Host 的隐藏前缀）。更深目录里的同名文件，命令读得到，这和 `shell` 一样。所以 L18 只在 Host 授权“整个工作区可读”时才给这个工具。
- **L18 谁能用、怎么授权。**
  - **哪些执行：** 只读的执行，即 Query（秘书回合、问一问的只读副本、规划），加上写范围为空的 Work（例如独立审阅）。这符合决定 37、决定 49 第 26 项和 DESIGN §5.3 的表。写范围不为空的 Work 有 `shell`，即使清单里有也不注册这个工具，交给模型的工具列表照实不含它。
  - **授权，三层取交集，缺一层就看不到：**
    1. **Host：**
       - 新设置 `allowReadonlyCommands`（默认开）；
       - 这个工作区的读权限是整个工作区（`readPrefixes` 含 `"."`）。只有一部分前缀可读时不给，因为只读挂载挡得住写、挡不住越范围的读。
       - `localWorkbenchGrant` 在两条都成立时，把工具名放进 `tools`，并加一个新字段 `readonlyCommandAccess: 'all_except_denied'`（和 `shellWorkspaceAccess` 并列）。
       - 工具清单变了，`configurationRevision` 自然变。
    2. **职责：** 解析出的 RoleSpec 的工具上限（`permissions.tools`）要列了这个工具。旧模板职责没有工具清单，Host 授权就是它的上限，照现有规则。
    3. **每次调用时还要是当前的：** 处理器调用前重新取一次授权，比对 `permissionRevision`，并确认仍是整个工作区可读。不对就报错 `forbidden`（“Host 的读权限已变”），不启动。
  - **接到执行里：**
    - Query：`projectQueryConfiguration` 照旧从 Host 清单里减去禁用名单、再和上限取交集；新工具不在禁用名单里。`query-execution.ts` 除了看、找，还要把它注入进去，今天对不认识的名字是静默忽略的。
    - 写范围为空的 Work：`execution-driver.ts` 认识这个名字（今天对不认识的名字直接拒绝）。
    - `runObservedModel` 加一个选项传这个工具，它的名字进 `enabledNames` 和 `hostAuthorizedTools`。“只读运行不能有改动类内置工具”的守卫照旧，只看内置工具。
    - 不改冻结的 `permission-policy.js`：它对 `process` 类、名字不是 `shell`、在 `hostAuthorizedTools` 里的扩展工具本来就放行。

### 0.3 和别的工作的接缝

- **接线包 2**（施工中）也改 `state/session-availability.ts`、`sessions/session-health.ts`：加 `unavailableSince`，SES-13 恢复时清除。
  - 本片 A 部分只走已有的 SES-13，不改这两个文件的规则，只经已有接口调用。
  - 合入时按接线包 2 先合、本片后合。
- **第 6 片**以后给 Query 的线接关闭（L10），要另定 Query 的身份和授权。
- **E3** 显示能力上报和“已退役”的新含义。

## 1. 范围

### 1.1 A 交付

1. Kernel 补丁：
   - `run.interrupted` 终态；
   - `closeOpenTurn`；
   - 历史还原跳过被中断 Turn 的内容。

   都写在 `vendor/coding-agent/patches/` 的源里，用 `scripts/build-kernel-patch.mjs --write` 重新生成。`dist` 不手改（AGENTS.md 第 6 条）。
2. AgentRuntime：
   - `closeOpenTurn` 操作，含探测和交健康 owner；
   - 终态消费者认 `interrupted`。
3. Workflow：
   - 维护第 6 步先关再判断归档；
   - `claimRequeued` 的新步 `close_open_turn` 和回执后的走法。
4. 能力上报改写。

### 1.2 B 交付

1. Kernel 补丁：`ProcessSandbox` 的只读模式。
2. 平台工具 `run_readonly_command`。
3. 只读执行的授权和工具注册。
4. Host 设置开关。

### 1.3 不在本片

- Query 线的关闭（第 6 片）。
- 原 Turn 的“恢复执行”：永不做。
- 压缩（K2）。
- 界面（E3）。
- 自动转发发给退路前任的回复。
- 重启后“结果未知”的自动收尾（决定 51 另开的一小片）。
- 给有写范围的 Work 加只读命令（它们已有 `shell`）。

## 2. 接口（新名字以此为准）

```ts
// vendor/coding-agent/patches/public-api.ts（新导出）
export type CloseOpenTurnInput = { sessionId: string; kernelRunId: string; expectedRevision: number; at: string };
export type CloseOpenTurnResult =
  | { status: 'closed'; revision: number; position: number }
  | { status: 'already_closed'; revision: number; position: number }
  | { status: 'already_terminal'; terminalStatus: string }
  | { status: 'not_found' }
  | { status: 'mismatch'; activeRunId: string | null }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'unreadable'; reason: string };
export function closeOpenTurn(store: SqliteStores, input: CloseOpenTurnInput): Promise<CloseOpenTurnResult>;
export type TurnBounds =
  | { status: 'found'; startPosition: number; endPosition: number | null; terminalStatus: string | null }
  | { status: 'not_found' }
  | { status: 'unreadable'; reason: string };
export function readTurnBounds(store: SqliteStores, input: { sessionId: string; kernelRunId: string }): Promise<TurnBounds>;

// src/core/agent-runtime/ports.ts（RuntimeExecutionPort 新增，可选；没装就是 unsupported）
closeOpenTurn?(ctx: CoreCallContext, input: { sessionRef: SessionRef; afterRunRef: RunRef; requeueRef: TaskRequeueRef | null }):
  Promise<
    | { status: 'closed' | 'already_closed'; health: 'available' | 'unavailable' }
    | { status: 'refused'; reason: 'lease' | 'not_closable_run' | 'continuation_not_authorized' | 'archived'
        | 'archive_requested' | 'occupied' | 'handed_over' | 'health' }
    | { status: 'unsupported' | 'unreadable' | 'mismatch' | 'conflict' | 'transient'; reason: string }>;

// src/business/workflow/contracts.ts（WorkflowCalls 新增一个成员；请求和回执照 WorkflowOperation 推导）
close_open_turn: NonNullable<RuntimeExecutionPort['closeOpenTurn']>;
```

```ts
// vendor/coding-agent/patches/sandbox/process/process-sandbox.ts（构造选项新增）
type ProcessSandboxOptions = { /* 原有 */ workspaceMode?: 'read_write' | 'read_only' };
// read_only 时 ProcessExecutionResult.effects 另带 externalChangedPaths: string[]，sideEffect 恒为 'none'（L15）

// 新平台工具 src/core/agent-runtime/readonly-command-tool.ts
run_readonly_command: { command: string; cwd?: string; timeoutMs?: number }   // L12
  // 结果同 shell 的形状，状态和先后见 L16

// Host 授权结构（和 shellWorkspaceAccess 并列）
readonlyCommandAccess?: 'all_except_denied';   // L18
// WorkbenchWorkspaceConfig
allowReadonlyCommands?: boolean;               // 默认 true，L18
```

## 3. 流程行（不新增平台状态行）

| 行 | 何时 | 做什么 | 结果 |
| --- | --- | --- | --- |
| KA1 | 维护（L7 的插入点）：退役的 Work 线，`kernel_turn_open`，RUN-19、干净 Turn 的 RUN-23 或经人认定的 RUN-22（决定 51），前面的步骤都没命中 | `closeOpenTurn`（不带 TaskRequeue） | 成功：SES-13 回到 available，本次不归档。否则落到今天的退役规则 |
| KA2 | `claimRequeued` 遇到 `kernel_turn_open`，原 Session 还没有接续 | 返回步 `close_open_turn`（带 TaskRequeue） | 按 L7 的回执表：成功后在原 Session 领取、开新 Run；`unsupported/unreadable/mismatch` 走退路；`conflict/transient` 等下次 |
| KA3 | 人点“继续”一条人暂停的线（TASK-27），或目标恢复带动（GOAL-29） | 走 KA2，TaskRequeue 就是授权 | 同上 |
| KA4 | 关闭已提交、健康没写，Host 还在或已重启 | 可以重试：维护和 Workflow 都不归档、不走退路；再调一次，或启动核对第 1 步 | `already_closed`，探测，SES-13 |
| KA5 | 关闭不支持、读不到、头上是别的 Run | 退路 | 新 Session 接续，交接照接线包 1 |
| KB1 | 只读执行调用 `run_readonly_command` | 只读沙箱执行 | 见 B 部分 |

## 4. 规则

1. 关闭从不重跑、不续跑原 Turn，从不给未完成的工具调用编结果。
2. 关闭只能作用在平台已证明结束、并且按 L4 有权关的那次 Run 的 Kernel Turn 上。其它情况什么也不写。
3. 被中断 Turn 的原始过程（transcript）永远不进模型历史；它的边界和身份照常参与校验；原记录永远可读。其中已接受的输入和工具事实，经接续说明给出（L9）。
4. 健康只经已有的探测和 SES-13 恢复（L5）；不新加状态行；`state/` 以外不写健康。
5. 维护原有的先后不变，关闭只插在 L7 写明的那一处；人的暂停、结果未知的占用、已有接续、归档请求，都在关闭之前按今天的规则处理。经人认定的线按决定 51 关闭。
6. 退路的行为、交接和异常锚点与今天完全一样（L8）；只有确定的失败（不支持、读不到、头上是别的 Run）才走退路。
7. 只读命令不能改工作区，不能联网，不能退回主机命令行；只在 Host 授权整个工作区可读时给，根目录以外的同名敏感文件读得到（L17，和 `shell` 一样）；没授权就看不到这个工具。
8. 读取和探测不调用模型。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同接线包 2 §5：用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败测试，再写实现。规则：
- 不读数据库核对；
- 期望值来自规格或手算例子，不从被测系统读回来；
- 测试名以行号开头；
- 一行里列了几种情况的，每种情况都要有断言。

### 5.1 测试入口（用户 2026-10-13 已确认，决定 50）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| KE1 | Kernel 公开函数 `closeOpenTurn`，用公开的 `SqliteStores.get/read/append` 造前提、看结果 | 结果先后表、各起始状态、追加的记录、重做、原历史保留 | 平台授权、Workflow 选择；“同一次提交”本身（由 `append` 现有的测试保证，本片不重测） |
| KE2 | Kernel 公开的 `runCodingAgent`，脚本模型；关前、关后、再一轮 | 关前进不去；关后同一 Session 能开新 Turn；之前已完成的部分保留；被中断那一步在第二、第三轮都看不到；各种边界；身份重放；关闭本身零模型调用 | Host 的恢复策略 |
| KE3 | 业务流程：Host 重启 → 人或目标“继续”，或维护 → `workflow.advanceWork`（场景框架；Kernel 存储是系统边界，故障可以在这里注入） | 同一 Session、新 Run；中断期间发来的回复送到；接续说明；维护的先后；崩溃窗口；不多建 Session、不交接、不归档 | 没跑到的并发 |
| KE4 | 同一流程，Kernel 读不到、适配器不支持、只有 legacy 读取器、头上是别的 Run | 退回新 Session；负责关系交接；退路开始后崩溃也不复活前任 | 关闭成功的内部细节 |
| KE5 | `ProcessSandbox.probe/execute`，真实的 `WorkspaceSandbox`，`read_only`（**要 bwrap**） | 写不了、临时目录、网络、git、cwd、环境、超时、取消、截断、快照看到的外部变化 | 模型工具的授权和结果映射 |
| KE6 | 脚本模型的只读执行：Query（`prepareQueryExecution/startQueryExecution/observeQueryExecution`）和写范围为空的 Work（同一 Runtime 的 prepare/start/observe）；沙箱可用与否经 Kernel 的能力探测替身控制 | 有授权时工具可见、可用；各层没授权时看不见；内置写工具照旧被排除；结果映射和保存 | 系统层的强制（沙箱是替身时） |

**说明：** KE6 原写作“脚本模型的 Query 执行”。L18 按 DESIGN §5.3 把写范围为空的 Work 也算作只读执行，所以 KE6 同时覆盖两种只读执行。它测的仍是用户确认的那件事：只读成员用工具查资料，没授权的用不了。

### 5.2 验收行为

**A 部分**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| KA-01 | KE1 | 关闭一个开着的 Turn：在下一个位置追加一条 `run.interrupted`；头上两个活动 ID 清空；revision 加 1；之前的记录逐条不变（记录 ID、位置、校验和） | L2 第 7 行；手写的记录序列 |
| KA-02 | KE1 | L2 表第 1–4、6 行各一个例子，返回对应结果，记录条数和 revision 都不变（第 5 行是防御，不测）；关闭提交后再调一次，返回 `already_closed`，位置是原来那条；`readTurnBounds` 对开着的、已关的、别的终态的、不存在的 Turn 各返回对应结果 | L2 表 |
| KA-03 | KE1 | 从 `created`、`running`（等模型；工具批里有待开始和已开始的调用）、`paused` 都能关；关后待开始的是 `abandoned`、已开始的是 `outcome_unknown`，没有编造的结果。再关一次已关的 Turn 返回 `already_closed`；别的终态（完成、失败、取消、超限、让出）返回 `already_terminal` | L1、L2 |
| KA-04 | KE2 | 关之前开新 Turn 被拒；关之后同一 Session 开新 Turn 成功。第二轮（游标还在被中断那一步之前）和第三轮（前缀越过关闭事件）的模型输入：含之前已完成的 Turn，顺序和条数与手写的一致，不含被中断那一步的用户消息和过程 | L3；手写的 Turn 序列和期望输入 |
| KA-05 | KE2 | 历史边界，每种一个例子：Session 第一个 Turn 就被中断（新 Turn 只有新内容）；连续两个被中断；完成→中断→完成→中断；边界正好在关闭事件上。另有三种照旧拒绝：不是被中断的终态里带未知工具结果；边界落在没结束的 Turn 里；当前 Turn 和一个被跳过的 Turn 身份重叠 | L3 |
| KA-06 | KE2 | 被中断的身份再跑一次：直接是终态，零模型调用、零工具执行、不加记录；旧检查点比关闭早、之后已有新 Turn，两种都一样 | L1、规则 1 |
| KA-07 | KE3 | 人暂停、Host 重启、人点“继续”（RUN-24 → TASK-27）：同一 Session、新 Run；步骤里没有 `create_session`、交接和归档；领取前 Session 已回到 available，领取后被新 Run 占用 | L4、L7、DESIGN §4.3 |
| KA-08 | KE3 | 中断期间发给原 Session 的回复，在新 Run 的安全点作为新输入送达；被中断那一步已经接受的消息不重复送，只出现在接续说明里 | DESIGN §4.3、L9 |
| KA-09 | KE3 | 接续说明：接续方式是 `same_session_without_previous_turn`，按已知的消息 ID、工具调用 ID 列出被中断那一步已接受的消息、已生效的插话和工具事实。另有三种情况，每种一个例子：关闭和领取之间 Host 重启一次，结果相同；平台 Run 上的位置记录落后于 Kernel 里的记录，后面的事实也列出；从 Entering 进入结果未知、经人认定、没有位置记录的 Run，按 Kernel 身份读到它的 Turn，不说“没进入过”。afterRun 没进入过 Kernel 的链，事实来源照现有规则 | L9 |
| KA-10 | KE3 | 维护，每种一个例子，结果逐条写明：RUN-19 的线关闭、回到 available、不归档；带干净 Turn 的 RUN-23 的线同上；人暂停的线（RUN-24）不关闭、不归档、零写入；经人认定、Turn 还开着的线（RUN-22）关闭、回到 available、不归档、不写异常锚点、负责关系不放下（决定 51）；有接续且交接做完的线按 `handoff_complete` 归档，不关闭；有接续、交接没做完的线零写入；有归档请求的线接着归档，不关闭；来历核不清的线不关闭，照今天报 `incomplete` | L7 |
| KA-11 | KE3 | 崩溃和回执丢失，故障点逐条固定：(a) 关闭的追加提交后，紧接着的那次 Kernel 存储读取失败一次（探测不 ready），本次 `waiting`，这条线没被归档，下一次推进完成恢复；(b) 同 (a)，然后重建 Host 再推进，启动核对第 1 步走 SES-13；(c) 关闭步返回成功、健康已写之后重建 Host，下一次推进直接复用，不再关、不建新 Session。三种最后都在原 Session 领取 | L6、L7 |
| KA-12 | KE4 | 只有 legacy 读取器、适配器不同、存储读不到、头上是别的 Run，四种都退回新 Session，交接和归档与今天一样。原历史：存储可读时照常读得到；读不到时如实报读不到，引用保留 | L8；现有 WP1 交接规则 |
| KA-13 | KE4 | 退路的新 Session 已建、交接还没提交时 Host 重启：不关闭前任，照 E15 恢复交接，最后只有一个接续 Session | L6、L4 第 3 条 |
| KA-14 | KE3 | 结果未知、仍占着 Session 的线：零写入（不关、不改健康、不建归档请求，决定 45）。你认定以后的下一次维护：关闭，回到 available，之后系统自动重排的任务在原 Session 领取，接续说明列出结果未知的那几步（决定 51） | L4、L7、决定 45、51 |
| KA-15 | KE3 | 关闭时 Kernel 版本被别人改了（在 Kernel 存储边界注入一次并发追加）：本次 `waiting`，不走退路，线没被归档；之后关闭成功（可能在同一次推进的维护里，也可能在下一次推进），最后在原 Session 领取 | L7 |
| KA-16 | KE3 | Query 线（SES-09、SES-10）：不关闭，和今天一样 | L10 |
| KA-17 | 能力上报的公开读取（`A2-runtime-capabilities` 用的同一入口） | `continueHistory` 写明：Work 线关闭后在原 Session 接续；Query 线换新 Session；列出 L8 的退路；不出现“恢复原执行” | L11 |

**B 部分**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| KB-01 | KE5 | 只读模式下这些都失败，主机工作区里的哨兵文件内容逐字不变：写根目录的文件、写子目录的文件、建新文件、改名、删除、改权限、往受保护目录里写 | L13 |
| KB-02 | KE5 | `/tmp` 和 HOME 里写能成功；下一次调用看不到；主机工作区里也没有 | L13 |
| KB-03 | KE5 | 连主机上一个确实能连通的本地端口失败（主机侧先证明能连）；普通仓库准备好身份和一处暂存改动，`git log`、`git diff --cached` 成功，`git commit` 因写不了而失败；链接式工作树里 git 失败 | L13、L17 |
| KB-04 | KE5 | `cwd`：`..`、绝对路径、指向工作区外的相对符号链接、落在受保护路径里，都在启动前拒绝；父进程环境里的哨兵变量在命令里看不到；命令用不了继承的根 fd | L13 |
| KB-05 | KE5 | 看 `ProcessSandbox.execute` 的原始结果：子进程超时（`timedOut`）、经 AbortSignal 取消（`cancelled`）、输出超过 32 KiB（`truncated`、总字节数），已捕获的输出都在 | L16 |
| KB-06 | KE5 | bwrap 不在或不支持只读挂载时，探测为不可用，`execute` 抛 `sandbox_unavailable`；要跑的命令没有在任何地方启动（沙箱里、主机上都没有；探测本身启动 bwrap 不算） | L13 |
| KB-07 | KE6 | 有授权的 Query 和写范围为空的 Work，各自能看到并调用工具、拿到输出，结果存进这次执行的历史 | L18 |
| KB-08 | KE6 | 下列每一种都看不到这个工具：Host 开关关；只有部分前缀可读；RoleSpec 的上限没列它；写范围不为空的 Work。执行中 Host 读权限变了，下一次调用报 `forbidden`，不启动 | L18 |
| KB-09 | KE6 | 加了新工具以后，Query 和只读 Work 照旧看不到 `shell`、`edit`、`write` | L18 |
| KB-10 | KE6 | 结果映射，每种一个例子：退出码不为 0、子进程超时（附输出）、`timeoutMs` 超出范围、授权已变；分派器盖在外面的：沙箱不可用（能力探测替身说没有）、执行被取消（空输出）。外部变化路径超过 100 条时，结果里是 100 条加略去数；任何结果序列化后都不超过 128 KiB | L12、L15、L16 |
| KB-11 | KE5、KE6 | 命令执行期间，别的写者改了一个快照看得到的文件：KE5 报出这条路径，Kernel 认可的基线不变；KE6 结果是 `workspace_changed_during_readonly_command`，不算这次命令的效果 | L15 |

### 5.3 bwrap 的限制

KE5 的行要真实的 bubblewrap。DSH 的沙箱里没有 bwrap，这些测试在那里会失败。DSH 照样按 TDD 写；能在沙箱里先跑的部分，用 KE6 先做通。KE5 的行由 lead 在有 bwrap 的 WSL 里跑并验收。

## 6. 文件（影响面；施工时以实际为准，超出要报）

**A 部分：**

- **Kernel 补丁源**（都在 `scripts/build-kernel-patch.mjs:relativeSources` 里）：
  - `core/runtime/state/run-state.ts`；
  - `core/runtime/events/agent-events.ts`；
  - `core/runtime/reducer/run-state-reducer.ts`；
  - `storage/adapters/sqlite/sqlite-stores.ts`；
  - `core/ports/session_store/session-store-port.ts`；
  - `core/ports/session_store/session-history.ts`；
  - `app/composition/composition-root.ts`；
  - `app/composition/composition-contracts.ts`；
  - `public-api.ts`；
  - 以及它们生成的产物。
  - 如要改 `core/ports/session_store/session-projection.ts`，它不在清单里，先加进 `relativeSources`。
- **Runtime：**
  - `ports.ts`、`runtime.ts`、`execution-contracts.ts`、`kernel-store-locator.ts`、`session-operations.ts`；
  - 终态消费者：`kernel-turn-facts.ts`、`run-reconcile.ts`、`execution-observation.ts`、`query-observation.ts`、`context-assembler.ts`。
  - `continuation-brief-assembly.ts` 只改读取事实窗口的部分；`src/contracts/continuation-brief.ts` 不改（L9）。
- **Workflow：** `workflow.ts`、`session-maintenance.ts`、`contracts.ts`、`ports.ts`。
- **其它：** `src/composition/create-platform.ts`（Runtime 的健康依赖；能力上报 `workspaceRuntimeCapabilities`）。
- **要改断言的旧测试。** lead 写出逐条的前后断言并冻结，DSH 不自行翻转。

  | 测试 | 怎么改 |
  | --- | --- |
  | `tests/scenarios/A8-host-restart-paused.test.ts` A8-3l/A8-3p | “继续”以后改为同一 Session，后面的 Run 看得到更早的历史。RUN-24 的结果、暂停意图、游标和继续之前的退役断言保留 |
  | 同文件第 433 行“a Run paused at a safe point …” | 第 527 行的“新 Session”在“继续”之后翻转；第二次启动零写入、暂停中退役的断言保留 |
  | 同文件 A8-3n/A8-3r | 保留退路和没进入过的链：改用关闭不支持的夹具；另加关闭成功的情形 |
  | `tests/scenarios/A7-control-goal29.test.ts` A7-G4 | 目标恢复后的 Session 选择和接续说明翻转；暂停和扇出的授权保留 |
  | `tests/scenarios/A8-host-restart.test.ts` W-11/CTL-08(b) | 启动维护会关闭并恢复健康（`resumeOnStartup:false` 也一样），列出这处变化；插话已生效、原 Run 结果、零模型调用保留 |
  | 同文件 W-12（A8-3d） | 排队取消（RUN-23）的线启动后的“不可用”断言翻转；取消结果和控制断言不变 |
  | `tests/scenarios/A8-host-restart-entry.test.ts` A8-2d | 整段历史相等的断言：启动时的关闭多出一条记录；原记录和平台核对证据不变 |
  | `tests/kernel/R4a-frozen-public.test.ts` 第 814 行 | `kernelSessionApiVersion` 2 → 3；关闭之前拒绝新 Turn 的断言保留 |
  | `tests/business/S1-session-maintenance.test.ts` IT10 | 保留“退役即归档”，改用关闭不支持的夹具；另加关闭成功的情形 |
  | `tests/business/WP1-continuation-handover.test.ts` HO01/HO02 及共用夹具的其它例子 | E15 断言放在关闭不支持或失败的夹具下；逐个检查共用夹具的例子 |
  | 同文件 HM01、HM04 | **不翻转**：交接做完的线照旧按 `handoff_complete` 归档 |
  | 同文件 HM02 | **不翻转**：还有没做完的负责关系，零写入 |
  | HM03、IT34 等结果未知占用的例子 | **不翻转**：零提交，`busy` |
  | `tests/scenarios/A8-host-restart-lease.test.ts` Q-01/Q-04 等 Query 例子 | **不翻转**；另加“不关闭”的断言（KA-16） |
  | `tests/scenarios/WP1-wiring.test.ts` SC01 | 关闭成功的序列改变；原序列留作关闭不支持时的退路场景 |
  | `tests/app/A2-runtime-capabilities.test.ts` | `continueHistory` 的文字按 L11 |

**B 部分：**

- **Kernel：** `sandbox/process/process-sandbox.ts`，以及生成产物。`shell-tool.js`、`tool-dispatcher.js`、`permission-policy.js` 不改。
- **Runtime：**
  - 新建 `readonly-command-tool.ts`；
  - 改 `observed-model-run.ts`、`query-preparation.ts`、`query-execution.ts`、`execution-driver.ts`、`execution-preparation.ts`、`execution-contracts.ts`。
- **Host：** `src/app/host.ts`（`WorkbenchWorkspaceConfig.allowReadonlyCommands`、`localWorkbenchGrant`、设置打开工作区时的默认值）、`src/app/runtime-configuration.ts`。
- **契约：** 授权结构里的 `readonlyCommandAccess` 所在的契约文件。
- **测试：** 新测试文件由 DSH 写；`tests/runtime/R5b-query-session-loop.test.ts`、`tests/runtime/source-text-loop-migration.test.ts` 的排除断言保持。

## 7. 施工

- A、B 两部分各用一个副本、各开一个新的 DSH Session，可以并行。
- **旧测试的翻转（§6 表）：** 先由 lead 写出逐条的前后断言，冻结后交 DSH。DSH 不自行改旧测试。
- **其余做法同接线包 2 §7：** 先冻结规格和夹具；DSH 按 TDD 写测试和实现；每组派一个只读复查子任务；之后 lead 核对、Codex 审；在有 bwrap 的环境跑全量；最后合入。
- **A 部分合入前：**
  - 跑 `node scripts/build-kernel-patch.mjs --check`，产物和源要一致；
  - 跑 `tests/kernel` 全部。
- **合入顺序：** 接线包 2 先合。

## 8. 不做的事

- 不做原 Turn 的“恢复执行”；
- 不改 `shell`，不改冻结的分派器和权限策略；
- 不给写范围不为空的 Work 加只读命令；
- 不在本片关 Query 的线；
- 不改人暂停的线的维护处理；经人认定的线只按决定 51 改；
- 不复活已归档的 Session；
- 不手改 `dist`；
- 不调用真实模型。

## 9. 冻结后的修正（lead，2026-10-14）

写 A 部分要改的旧测试时，核对出几处规格没写死的地方。下面这些修正和 §0–§8 同等有效；有冲突时以本节为准。旧测试改动的逐条处理见证据目录里的 `kA-flip-decisions.md`。

**A 部分**

- **M1 Runtime 没装关闭依赖时。**
  - `createAgentRuntime` 只加一个可选依赖 `turnClosure`，字段由施工方定：健康 owner 的 `recordSessionHealth`，以及这个 Host 实例的租约。`create-platform.ts` 总是接上。
  - 没有 `turnClosure` 时，Runtime 端口不装 `closeOpenTurn`（§2：“没装就是 unsupported”）。
  - 这时 Workflow 的 `claimRequeued` 不返回 `close_open_turn` 这一步，直接走今天的退路（`create_session{requeue}` 和接线包 1 的交接）；维护按确定失败处理，照今天的逻辑走。
  - 所以 `tests/business/S1-session-maintenance.test.ts`、`tests/business/WP1-continuation-handover.test.ts` 的夹具不接 `turnClosure`，它们就是 §6 说的“关闭不支持”的夹具，两份测试一字不改。关闭成功的情形由 KE3 的新测试覆盖（KA-07、KA-10、KA-14）。
- **M2 Kernel 不支持关闭时（场景测试）。**
  - Runtime 每次调用时，从注入的 `kernel` 依赖读 `closeOpenTurn` 和 `readTurnBounds`，不在构造时缓存。读不到就是 L4 第 5 条的 `unsupported`。
  - 场景测试用 `vi.hoisted` 加 `vi.mock`，把 Kernel 公开接口里的 `closeOpenTurn` 换成可开关的 getter。先例是 `tests/composition/R4-control-runtime-platform.test.ts`。
  - Workflow 遇到没有接续的 `kernel_turn_open` 线时，照样返回 `close_open_turn` 这一步，回执是 `{ status: 'unsupported' }`，下一步是今天的 `create_session{requeue}`。
- **M3 健康这一步的调用身份。**
  - `turnClosure` 调 `recordSessionHealth` 时，用 Host 自己的调用身份，也就是启动核对第 1 步用的那一种。
  - 这样 SES-13 现有的守卫（调用方是核对，主体是 Host）照常成立，不改状态机。
- **M4 Kernel 会话接口版本。** `src/core/agent-runtime/contracts.ts` 的 `kernelSessionApiVersion` 改为 `1 | 2 | 3`。这个文件不在 §6 的清单里，这次补上。
- **M5 接续说明里的 Turn 状态。**
  - `ContinuationBriefV1.stoppedAt.turnStatus` 加一个值 `'interrupted'`；`src/contracts/continuation-brief.ts` 和 `continuation-brief-assembly.ts` 的 `TURN_STATUSES` 都加上。§6 说 `continuation-brief.ts` 不改，只为这一个值破例。
  - 已关闭的被中断 Turn 报 `'interrupted'`，不再落到兜底的 `'running'`。KA-09 断言这一点。
- **M6 能力上报的原文**（L11 当时没写死措辞）。
  - **`continueHistory.reason`**，全文：

    ```
    a continuation is a new Run, never a resume of the original Turn. A Run created by a requeue starts with a continuation brief of the previous Run's durable facts and is labelled a continuation, not a resumed execution. When the previous Turn has a Kernel terminal, a new Run in the same Session continues its history, including the successor Run after a yielded wait. When the previous Turn has no Kernel terminal (for example a Run interrupted by a Host restart, including one paused then, a Run stopped at restart by a queued cancel, or one a person attested while its Kernel Turn was still open), the Kernel refuses a new Turn in that Session and the original Session is unavailable (kernel_turn_open, its history stays readable) until the platform closes the dangling Turn. For a Work line the platform closes it as interrupted: the Session maintenance does so after a clean interruption, a stop by a queued cancel or a person's attestation, and the Workflow does so when a person, or the Goal, continues a paused-interrupted Run. The closure never resumes the interrupted Turn and never invents a result for an unfinished tool call; the Session becomes available again and the continuation is a new Run in the same Session, whose model history holds the completed Turns before the interrupted one, while what the interrupted Turn had accepted reaches it only through the continuation brief. When the closure is not possible (only the legacy Kernel reader, another Kernel adapter, a Kernel that cannot close a Turn, an unreadable Kernel store, or another Run at the Kernel head), and for a Query line, whose open Turn is not closed, the continuation is a new Run in a new Session that continues the original Session's last completed history (same Kernel adapter only; otherwise the brief alone). After a Host restart a waiting continuation is rebuilt only when its Turn has exactly one waiting message; otherwise its outcome is recorded as unknown (continuation_unrebuildable), keeping its Session and Lease until a person attests it
    ```

  - **`recoverRun.reason`**：只把 `The continuation of an interrupted Run is a new Run with a continuation brief, in a new Session that continues the original Session's last completed history.` 换成 `The continuation of an interrupted Run is a new Run with a continuation brief: for a Work line, after the platform closes its dangling Kernel Turn as interrupted, in the same Session; when that closure is not possible, in a new Session that continues the original Session's last completed history (see continueHistory).`
  - **`safePointPause.reason`**：只把 `(a new continuation Run in a new Session)` 换成 `(a new continuation Run, in the same Session once the platform has closed the dangling Kernel Turn, otherwise in a new Session)`。
  - 旧 A2 测试断言的 `continueHistory` 短语在新文字里都还在，所以那些断言不改；KA-17 断言新加的句子。
- **M7 测试不读数据库（用户的规矩）。**
  - 改过或新加的断言不读 `kernel.sqlite`、`ledger.sqlite`。
  - 旧断言读 Kernel 数据库、在 K 之后不再成立的，删掉，或者换成公开读取。
  - `run.interrupted` 这条记录本身只在 KA-01（KE1）断言。
- **M8 被丢下的旧 Host 晚到的追加。** 关闭以后 Session 头的 revision 变了，崩溃的旧 Host 手上那次 Kernel 调用再追加终态时，会因 revision 冲突失败（`sqlite-stores.ts` 的 `Session revision 冲突`）。这是预期的，测试不断言。
- **M9 §6 以外也要改的旧测试**（核对时发现，已列入冻结的改动）：
  - `A7-control.test.ts` 的 G-04/GOAL-29 和 A7-G4b（G-05）；
  - `A8-host-restart.test.ts` 的 A8-3d 计数、W-15 认定线、启动重新驱动的同一 Session；
  - `A8-host-restart-entry.test.ts` 的 A8-2d 健康；
  - `B2-history-public-export.test.ts` 的导出清单；
  - `A2-runtime-capabilities.test.ts` 第 121、158 行；
  - `R3c-R4b-platform.test.ts` 第 170 行；
  - `A4-duplicate-receipts.test.ts`、`C3-paused-continue-brief.test.ts`、`harness.test.ts`。
  - A7-G4 另拆出“关闭不支持”的一份，保留 GOAL-29 的退路覆盖。

**B 部分**（Codex 验收审查 `D:/cc-lead-notes/codex2/kBimplrev.out.md` 之后，lead 2026-10-14 定；返工交新的 DSH 会话）

- **M10 错误码。** 冻结的 Kernel 工具错误枚举里没有 `forbidden`，也没有 `workspace_changed_during_readonly_command`；写进去会被分派器当作 `invalid_result` 拒掉。所以：
  - 执行中 Host 读权限变了：`code: 'permission_denied'`，消息以 `forbidden:` 开头；
  - 命令期间工作区被别的写者改了：`code: 'execution_failed'`，`retryable: false`，消息固定为 `workspace_changed_during_readonly_command: the workspace was changed by another writer during the command; the changed paths are in the output`，输出里另有一个 JSON 项，`reason: 'workspace_changed_during_readonly_command'`，带 `externalChangedPaths`、`externalChangedPathsOmitted`。
  - L16、L18、KB-08、KB-10、KB-11 里的这两个名字按此读。
- **M11 结果上限按整个结果算。**
  - 128 KiB 的上限管序列化后的整个结果，不只是 `output`；消息里不再列路径。
  - 外部变化路径最多列 100 条，按字节序取最前面的；放不下 128 KiB 时少列几条，其余算进 `externalChangedPathsOmitted`。先截输出，再减路径；固定的消息不截。所有结果（包括启动前的拒绝）都经同一个限长处理。调用 ID 来自模型提供方，不算在工具产出的 128 KiB 之内（2026-10-14 第二轮审查后补）。L15 的“100 条”按此读。
- **M12 只读命令的几处加固**：
  - 工作区里的 Unix socket 和 FIFO 在启动前用 `/dev/null` 盖住。查找是有界的广度优先遍历（最多 2 万个条目、64 层），跳过已盖空的受保护子树。已知限制，和现有的 `shell` 一样：超出界限没扫到的、命令运行期间新建的，都不在此列。
  - 受保护路径只在祖先被盖住时才省略：`.git` 是目录（只读可见）时，它下面各自的遮盖照留，Host 禁读的 `.git/...` 读不到；`.git` 是文件（链接式工作树）时它整个被盖住，下面的受保护路径省略；查不到的受保护路径（`ENOENT`、`ENOTDIR`）不用遮盖。
  - Host 开关 `allowReadonlyCommands: false` 在 Host 的统一解析处收窄每一个运行时绑定，启动和设置重建时都生效。
  - 探测和金丝雀用实际的沙箱选项，并且总要实际做一次 `--ro-bind-fd` 和 `--remount-ro`。
  - cwd 按沙箱实际用的路径校验；不是目录的在启动前拒绝。
  - 工具说明写明：子进程超时保留已捕获的输出，取消或分派器的超时会替换它；`.git` 可读不可写。

### 施工中的限定（K 片 A、B 合入时，lead 2026-10-14）

A、B 施工中定下、规格原文没写到的读法和限定；证据文件是各部分的 `lead-acceptance.md`。

- **D7（A）：** 接续说明读上一轮的身份读不出时回“重试”或“不可用”，从不退回更早的事实拼一份降级的说明；读不出就一直等，归档或人的认定把它了结。
- **D8（A）：** 上一个执行已经有结束位置时，不再调 `readTurnBounds`。
- **D11（A）：** 只有同一 Session 里的接续，才按 Kernel 身份把读取窗口扩到被中断那一轮；跨 Session 的接续读执行记下的窗口。
- **D12（A）：** 事实来源从最近的祖先往外找，选第一个进入过 Kernel 的执行（没存位置、但经认定的也算进入过），不跳过近的去找远的。
- **D15（A）：** 来历为 `null` 的那一种排除，今天的建法造不出（建 Session 时会把来历规范化，明写 `null` 直接拒绝，`session-directory.ts:789`），所以没有测试，只作规格限定。
- **A 的另外几处：** Session 不见了算“读不出”；接续的 Session 用不了算暂时性的故障；保留 `lastToolGroup`。
- **D-ONECHECK（B）：** 一次执行只判断一次 `.git` 和受保护路径，挂载和 IPC 扫描都用这一个快照；类型对不上的绑定都会失败，所以是失败即关闭。
- **Codex 第四次审查第 1 条（B，lead 判定不返工）：** 快照时 `.git` 是目录、挂载前被别的写者换成普通文件时，bwrap 照路径把这个文件绑上；能读到的只是那个写者自己写进 `.git` 位置的内容，没有 Host 禁读的路径露出。

两部分的验收结论、写进 STATUS“缺口”的已知限制见 [partA/lead-acceptance.md](../../../reviews/evidence/orchestration-slice-K-2026-10-13/partA/lead-acceptance.md) 和 [partB/lead-acceptance.md](../../../reviews/evidence/orchestration-slice-K-2026-10-13/partB/lead-acceptance.md)。
