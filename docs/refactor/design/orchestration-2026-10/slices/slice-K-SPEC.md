# K 片规格：关闭悬空 Turn 后留在原 Session；只读命令

> **状态：lead 起草，2026-10-13；测试入口已确认（决定 50）；按 Codex 审查（`D:/cc-lead-notes/codex2/kspecrev.out.md`，结论“不能冻结”，16 条）改过一轮，待复审后冻结。**
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
- **审查后 lead 的两处取舍，都不改用户已定的事：**
  1. **决定 45 和人的暂停照旧。** 经人认定结束的线（RUN-22）和人暂停后被中断的线（RUN-24），维护照今天一样不碰。只有人或目标发起“继续”（有覆盖这次 Run 的 TaskRequeue）时才关闭。维护里自动关闭的，只有平台自己证明的干净中断：RUN-19，以及带干净 Turn 的排队取消 RUN-23。
  2. **只读命令按“这次执行是只读的”来给，不按“是不是 Query”来给。** 包括 Query，和写范围为空的 Work（例如独立审阅）。第一稿写成“只给 Query”，和 DESIGN §5.3 的表不符，已改。

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
       - RUN-24（`isPausedInterrupted`）或 RUN-22（经人认定）：必须带 `requeueRef`，而且这条 TaskRequeue 覆盖的正是 `afterRunRef`（TASK-27/TASK-16 的守卫已经保证只有人或目标恢复能写它）；没带或不对，`refused('continuation_not_authorized')`；
       - 其它结束方式：`refused('not_closable_run')`。
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
  | 关闭前检查之后，归档、占用、负责关系又变了 | Kernel 的版本挡不住平台事实。健康写入照旧带 Session 版本，对不上就失败；之后 Workflow 按新事实重新选择 |
  | 任务已由另一个 Session 接着做 | 去向优先（E16）选那个 Session；原 Session 有接续时不关；只是负责关系转走、没有接续的，关了也只是变成一条空闲可用的线，不拿回任务 |
- **L7 在哪里触发：维护和 Workflow 两处，同一个 Runtime 操作。**
  - **维护（`session-maintenance.ts`），每个 Session 按这个顺序，只在第 6 步插入关闭：**
    1. 有归档请求：接着做归档（不变）；
    2. 退役且被结果未知的 Run 占着：`busy`，零写入（决定 45，IT34、HM03，不变）；
    3. 正式结束的负责关系先关掉（不变）；
    4. 退役且有占用：跳过；有接续：按 `handoff_complete` 归档或等交接做完（HM01、HM02、HM04，不变，永不关闭）；
    5. 旧来历还没核清：`incomplete`（E14，不变，不关闭）；
    6. **新：** 结论是 `kernel_turn_open`，最近一次工作执行是 Run，`platformCleanInterruption` 为真（RUN-19，或带干净 Turn 的 RUN-23；暂停意图为空），就调 `closeOpenTurn`（不带 `requeueRef`）。
       - 返回 `closed` 或 `already_closed`，健康回到 `available`：这条线本次不归档。
       - 其余任何结果：落到今天的规则（有负责关系或在等回复就归档，否则跳过）。
    - 经人认定的线、人暂停的线、Query 线，维护的处理和今天一字不差。
  - **Workflow（`workflow.ts:claimRequeued`）：** 前面的顺序不变：转去的 Session 优先（E16）；被排除、已归档、职责不对、`missing/damaged` 的走普通选择。遇到 `occupancy === null`、`unavailable/kernel_turn_open` 时：
    - 原 Session 已有为这个任务建的接续 Session（退路已经开始）：照今天走 `create_session{requeue}` 的重放和 E15 交接恢复，不关；
    - 否则返回一步 `close_open_turn`，请求是 `{ sessionRef, afterRunRef, requeueRef }`。
  - **`close_open_turn` 回执之后怎么走：**

    | 回执 | 下一步 |
    | --- | --- |
    | `closed` / `already_closed`，健康 `available` | 按新事实重新选择；正常情况就是在原 Session 领取，开新 Run |
    | `already_closed`，健康没回到 `available` | `waiting`，下次推进再来 |
    | `conflict`、`transient` | `waiting`，下次推进再来；不走退路 |
    | `refused` | 按新事实重新选择，不从这张回执推出“走退路”。`continuation_not_authorized` 在这条路上不该出现，出现就 `waiting` 并写明原因 |
    | `unsupported`、`unreadable`、`mismatch` | 退路：`create_session{requeue}`，连同接线包 1 的交接 |

  - `advanceWork` 在执行完一步以后会跑维护；关闭失败以后，维护可能先按今天的规则把线归档。这是今天就有的先后，接受；之后 `claimRequeued` 见到已归档，走普通选择。
  - **WorkflowCalls 新成员** `close_open_turn: NonNullable<RuntimeExecutionPort['closeOpenTurn']>`，请求和回执沿用 `WorkflowOperation` / `WorkflowStepReceipt` 的推导，不另写影子类型；请求 ID 确定（`wf-auto:` 前缀），重放同一步得到同一结果。
- **L8 退路不变。** 下列情况照今天的做法另建接续 Session，负责关系照常交接，前任按规则归档：
  - Kernel 读不到；
  - 两个 Session 不在同一个 Kernel 适配器上；
  - 只有旧的只读 legacy 读取器（`withLegacyReader`）；
  - Kernel 头上是别的 Run（`mismatch`）。

  已归档的旧 Session（补丁之前的）不复活。发给退路前任的回复不自动转发（DESIGN §4.3）。
- **L9 留在原 Session 接续时，接续说明用已有的 `same_session_without_previous_turn`，不新加接续方式。**
  - 这几种结束（RUN-19/22/23/24）都没有 Kernel 终点位置（`executionHistory.endPosition === null`），所以 `assembleContinuationBrief` 已经会把它归为“在同一 Session 中继续，但上一次执行的 Turn 不在模型历史中”。
  - 这时它已经会列出已接受的消息、已生效的插话和工具事实，正好是 L3 移出模型输入的那部分。
  - 来源：`readPreviousTurn` 读那次 Run 自己的窗口，到 `observedThroughPosition` 为止。关闭事件在窗口之后，不读，也不需要。这是平台已存的事实，崩溃重启后照样算得出来。
  - afterRun 没进入过 Kernel 的链，照现有的 `factsHop` 规则找事实来源。
  - 不改 `src/contracts/continuation-brief.ts`。施工时如发现某种结束的 `endPosition` 不为空，停下报 lead。
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
    - `/tmp` 和临时 HOME 仍在 tmpfs 根上，可写，命令结束就没了；网络、环境变量清空、PID 命名空间都照旧。
  - 探测：只读模式第一次用之前，跑一次只读的金丝雀，确认 bwrap 支持 `--ro-bind-fd`，并确认写工作区会失败。不支持就当沙箱不可用，绝不退回读写挂载，也绝不退回主机命令行。
  - `cwd`：先照现有的 `normalizeWorkspacePath` 做字面检查。再在主机侧对工作区根解析真实路径：解析后在工作区外、经过符号链接跳出、落在受保护路径里，都在启动前报 `invalid_arguments`。
- **L14 模式按每次调用定，不存进 Run 的恢复约束。**
  - 工具每次调用自己用公开接口建一个 `read_only` 的 `ProcessSandbox`：同一个 `WorkspaceSandbox`，同样的 `deniedPrefixes` 和 `executablePath`。现有平台代码已这样建过（`workbench-tools.ts`、`check-execution.ts`）。
  - 不改 `effectiveRecoveryConstraintsSchema`，恢复规则不变。
- **L15 执行后用现有快照再核对一次；它是第二道检查，第一道是只读挂载。**
  - `read_only` 时 `execute` 照常在前后各拍一次快照，但**从不调用 `acceptAgentChanges`**，不推进 Kernel 认可的基线。
  - 现有快照比较看到了变化：路径放进结果的 `externalChangedPaths`，`sideEffect` 仍是 `none`。这些变化只可能来自同时在写的别的写者，不算这次命令的效果。
  - 没有变化：`sideEffect: 'none'`，不写 `possible`。
  - **快照看得到的范围如实写明：** git 忽略的文件、默认忽略的前缀（`node_modules`、`dist` 等）看不到。在 git 快照失败、退回目录遍历时，看的是元数据，跳过符号链接。所以这一条只承诺“现有快照比较能看到的变化”。
- **L16 结果、限额和失败的先后。**
  - 子进程超时从启动后算（和现有一样）；超时先给进程组发 SIGTERM，250 ms 后 SIGKILL。整个工具调用（含快照和建沙箱）另由分派器按 `defaultTimeoutMs` 的 130 秒兜底。
  - 输出：标准输出、错误输出各保留前 32 KiB 文本，给出总字节数和是否截断。处理器保证结果序列化后不超过 `outputLimitBytes`（128 KiB）；超了就继续从尾部截，截过的标 `truncated`。
    - 不照抄 `shell` 的每路 64 KiB：那样两路加上 JSON 转义可能超过分派器的上限。
  - 给模型的结果和 `shell` 同形：一段文本是标准输出；一段 JSON 是 `{ exitCode, signal, stdout: {totalBytes, truncated}, stderr: {text, totalBytes, truncated}, timedOut, externalChangedPaths, timings }`。
  - 状态按这个顺序取第一条命中的：
    1. 入参不对、`cwd` 不合规：错误 `invalid_arguments`，不启动；
    2. 沙箱不可用：错误 `sandbox_unavailable`，不启动；
    3. 启动失败：错误 `execution_failed`；
    4. 有 `externalChangedPaths`：错误 `workspace_changed_during_readonly_command`，附路径和已捕获的输出；
    5. 被取消：`cancelled`，附已捕获的输出；
    6. 超时：错误 `timeout`，附已捕获的输出；
    7. 退出码不为 0：错误 `execution_failed`（“命令退出码 N”），附输出；
    8. 其余：成功。
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
- 改决定 45 对经人认定的线的处理。
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
| KA1 | 维护第 6 步：退役的 Work 线，`kernel_turn_open`，RUN-19 或干净 Turn 的 RUN-23，前 5 步都没命中 | `closeOpenTurn`（不带 TaskRequeue） | 成功：SES-13 回到 available，本次不归档。否则落到今天的退役规则 |
| KA2 | `claimRequeued` 遇到 `kernel_turn_open`，原 Session 还没有接续 | 返回步 `close_open_turn`（带 TaskRequeue） | 按 L7 的回执表：成功后在原 Session 领取、开新 Run；`unsupported/unreadable/mismatch` 走退路；`conflict/transient` 等下次 |
| KA3 | 人点“继续”一条人暂停的线（TASK-27），或目标恢复带动（GOAL-29）；人对经人认定的线重新入队 | 走 KA2，TaskRequeue 就是授权 | 同上 |
| KA4 | 关闭已提交、健康没写，Host 还在或已重启 | 再调一次，或启动核对第 1 步 | `already_closed`，探测，SES-13 |
| KA5 | 关闭不支持、读不到、头上是别的 Run | 退路 | 新 Session 接续，交接照接线包 1 |
| KB1 | 只读执行调用 `run_readonly_command` | 只读沙箱执行 | 见 B 部分 |

## 4. 规则

1. 关闭从不重跑、不续跑原 Turn，从不给未完成的工具调用编结果。
2. 关闭只能作用在平台已证明结束、并且按 L4 有权关的那次 Run 的 Kernel Turn 上。其它情况什么也不写。
3. 被中断 Turn 的内容永远不进模型输入；它的边界和身份照常参与校验；原记录永远可读。被移出的那部分由接续说明补上（L9）。
4. 健康只经已有的探测和 SES-13 恢复（L5）；不新加状态行；`state/` 以外不写健康。
5. 维护的先后顺序（L7）不变，关闭只插在第 6 步；人的暂停、经人认定、结果未知、已有接续、归档请求，都在关闭之前按今天的规则处理。
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
| KA-02 | KE1 | L2 表第 1–6 行各一个例子，返回对应结果，记录条数和 revision 都不变；关闭提交后再调一次，返回 `already_closed`，位置是原来那条 | L2 表 |
| KA-03 | KE1 | 从 `created`、`running`（等模型；工具批里有待开始和已开始的调用）、`paused` 都能关；关后待开始的是 `abandoned`、已开始的是 `outcome_unknown`，没有编造的结果；已终态的 Turn 返回 `already_terminal` | L1 |
| KA-04 | KE2 | 关之前开新 Turn 被拒；关之后同一 Session 开新 Turn 成功。第二轮（游标还在被中断那一步之前）和第三轮（前缀越过关闭事件）的模型输入：含之前已完成的 Turn，顺序和条数与手写的一致，不含被中断那一步的用户消息和过程 | L3；手写的 Turn 序列和期望输入 |
| KA-05 | KE2 | 历史边界，每种一个例子：Session 第一个 Turn 就被中断（新 Turn 只有新内容）；连续两个被中断；完成→中断→完成→中断；边界正好在关闭事件上。另有三种照旧拒绝：不是被中断的终态里带未知工具结果；边界落在没结束的 Turn 里；当前 Turn 和一个被跳过的 Turn 身份重叠 | L3 |
| KA-06 | KE2 | 被中断的身份再跑一次：直接是终态，零模型调用、零工具执行、不加记录；旧检查点比关闭早、之后已有新 Turn，两种都一样 | L1、规则 1 |
| KA-07 | KE3 | 人暂停、Host 重启、人点“继续”（RUN-24 → TASK-27）：同一 Session、新 Run；步骤里没有 `create_session`、交接和归档；领取前 Session 已回到 available，领取后被新 Run 占用 | L4、L7、DESIGN §4.3 |
| KA-08 | KE3 | 中断期间发给原 Session 的回复，在新 Run 的安全点作为新输入送达；被中断那一步已经接受的消息不重复送，只出现在接续说明里 | DESIGN §4.3、L9 |
| KA-09 | KE3 | 接续说明：接续方式是 `same_session_without_previous_turn`，列出被中断那一步已接受的消息、已生效的插话和工具事实。关闭和领取之间 Host 重启一次，结果相同；afterRun 没进入过 Kernel 的链，事实来源照现有规则 | L9 |
| KA-10 | KE3 | 维护，每种一个例子：RUN-19 的线关闭、回到 available、不归档；带干净 Turn 的 RUN-23 的线同上；人暂停的线（RUN-24）和经人认定的线（RUN-22）不关闭，处理和今天一样；已有接续的线照旧 `handoff_complete`，不关闭；有归档请求的线接着归档，不关闭 | L7 |
| KA-11 | KE3 | 崩溃和回执丢失：(a) Kernel 已关、健康没写，Host 没重启，下一次推进完成恢复；(b) 同样情况下 Host 重启，启动核对第 1 步走 SES-13；(c) 健康已写、回执丢了，下一次推进直接复用，不再关、不建新 Session。三种都留在原 Session | L6 |
| KA-12 | KE4 | 只有 legacy 读取器、适配器不同、存储读不到、头上是别的 Run，四种都退回新 Session，交接和归档与今天一样。原历史：存储可读时照常读得到；读不到时如实报读不到，引用保留 | L8；现有 WP1 交接规则 |
| KA-13 | KE4 | 退路的新 Session 已建、交接还没提交时 Host 重启：不关闭前任，照 E15 恢复交接，最后只有一个接续 Session | L6、L4 第 3 条 |
| KA-14 | KE3 | 结果未知、仍占着 Session 的线：零写入（不关、不改健康、不建归档请求，决定 45）。经人认定、但没人“继续”的线：不关闭 | L4、决定 45 |
| KA-15 | KE3 | 关闭时 Kernel 版本被别人改了（在 Kernel 存储边界注入一次并发追加）：本次 `waiting`，不走退路；下一次推进关闭成功，留在原 Session | L7 回执表 |
| KA-16 | KE3 | Query 线（SES-09、SES-10）：不关闭，和今天一样 | L10 |
| KA-17 | 能力上报的公开读取（`A2-runtime-capabilities` 用的同一入口） | `continueHistory` 写明：Work 线关闭后在原 Session 接续；Query 线换新 Session；列出 L8 的退路；不出现“恢复原执行” | L11 |

**B 部分**

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| KB-01 | KE5 | 只读模式下这些都失败，主机工作区里的哨兵文件内容逐字不变：写根目录的文件、写子目录的文件、建新文件、改名、删除、改权限、往受保护目录里写 | L13 |
| KB-02 | KE5 | `/tmp` 和 HOME 里写能成功；下一次调用看不到；主机工作区里也没有 | L13 |
| KB-03 | KE5 | 连主机上一个确实能连通的本地端口失败（主机侧先证明能连）；普通仓库准备好身份和一处暂存改动，`git log`、`git diff --cached` 成功，`git commit` 因写不了而失败；链接式工作树里 git 失败 | L13、L17 |
| KB-04 | KE5 | `cwd`：`..`、绝对路径、指向工作区外的相对符号链接、落在受保护路径里，都在启动前拒绝；父进程环境里的哨兵变量在命令里看不到；命令用不了继承的根 fd | L13 |
| KB-05 | KE5 | 子进程超时、经 AbortSignal 取消、输出超过 32 KiB：按 L16 的字面值返回，已捕获的输出和总字节数都在 | L16 |
| KB-06 | KE5 | bwrap 不在或不支持只读挂载时，探测为不可用，`execute` 抛 `sandbox_unavailable`，主机上没有启动任何进程 | L13 |
| KB-07 | KE6 | 有授权的 Query 和写范围为空的 Work，各自能看到并调用工具、拿到输出，结果存进这次执行的历史 | L18 |
| KB-08 | KE6 | 下列每一种都看不到这个工具：Host 开关关；只有部分前缀可读；RoleSpec 的上限没列它；写范围不为空的 Work。执行中 Host 读权限变了，下一次调用报 `forbidden`，不启动 | L18 |
| KB-09 | KE6 | 加了新工具以后，Query 和只读 Work 照旧看不到 `shell`、`edit`、`write` | L18 |
| KB-10 | KE6 | 结果映射，每种一个例子：退出码不为 0、超时、取消、沙箱不可用（能力探测替身说没有）、`timeoutMs` 超出范围；任何结果序列化后都不超过 128 KiB | L12、L16 |
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
  - `continuation-brief-assembly.ts` 和 `src/contracts/continuation-brief.ts` 不改（L9）。
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
  | 同文件 HM01、HM02、HM04 | **不翻转**：已交接的线照旧 `handoff_complete` |
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
- 不改决定 45 对经人认定的线、和人暂停的线的维护处理；
- 不复活已归档的 Session；
- 不手改 `dist`；
- 不调用真实模型。
