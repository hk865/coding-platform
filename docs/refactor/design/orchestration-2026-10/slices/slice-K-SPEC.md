# K 片规格：关闭悬空 Turn 后留在原 Session；只读命令

> **状态：lead 起草，2026-10-13；测试入口已确认（决定 50），Codex 审查后冻结。**
> - 代码基线：6c63f069（第 0、1、3、5 片和接线包 1 已合入；接线包 2 在施工，不碰本片的文件，除了 §0.3 列的几处）。
> - 依据：
>   - DESIGN 分片表 K 行和 §4.3“Kernel 补丁（K 片）”、§5.3；
>   - HANDOFF 决定 7、37、45、49（第 25、26 项）；
>   - 代码事实清单（Codex 只读，2026-10-13，`D:/cc-lead-notes/codex2/kfacts.out.md`，lead 抽查过关键几处）。
> - 两部分互不依赖，分开施工：
>   - **A：关闭悬空 Turn**，要第 1 片；
>   - **B：只读命令**，不依赖别的片。

## 0. 冻结说明（lead）

### 0.1 要用户定的

- **决定已全部有了。** 决定 49 第 25 项选 (a)：中断后关闭悬空的 Turn，在原 Session 开新 Run；关不掉、读不到或不支持时，走今天的新 Session 退路。第 26 项选 (a)：只读命令，所有获授权的只读职责都能用。
- **测试入口用户 2026-10-13 已确认**（§5.1，决定 50）。

### 0.2 lead 定的技术选择

**A 部分：**

- **L1 Kernel 新增一个明确的终态 `interrupted`**，不借用 `failed` 或 `cancelled`。
  - 新事件 `run.interrupted`，载荷 `{ reason: 'platform_closed', requestedBy: 'app' }`。
  - `runStatusSchema` 加 `interrupted` 并算终态；`runOutcomeSchema` 加 `{ kind: 'interrupted', reason: 'platform_closed' }`。
  - 理由：语义清楚；历史还原只认这一个状态来跳过；平台按“失败”或“取消”处理的地方不会误读它。
  - 现有的终态集合（`run-state.ts:terminalStatuses`、平台的 `run-reconcile.ts:TERMINAL_STATUSES`、`context-assembler.ts:KERNEL_TERMINAL_EVENTS` 等，见 §6）都要认它。
  - `kernelSessionApiVersion` 加 1。
- **L2 关闭是追加一条记录，不改表。**
  - 新公开函数 `closeOpenTurn(store, input)`，从 `public-api.ts` 导出。它读 Session 头，核对 `activeRunId === input.kernelRunId`，再用 `SqliteStores.append` 追加一条 `run.interrupted` 事件：顺序号接着上一条，`occurredAt` 是现在，elapsed 不倒退。期望版本是头的 revision。
  - 记录 ID 由 `(sessionId, kernelRunId, 'platform_closed')` 决定，重放同一个请求返回原记录。
  - 正常的终态投影会清掉头上的两个活动 ID。
  - 不跑模型，不跑工具，不给没做完的调用编结果：归约器照旧把待开始的调用记为 `abandoned`，已开始未完成的记为 `outcome_unknown`，原记录一字不改。
- **L3 返回值。** 下面这些结果都不抛异常：
  - `{ status: 'closed', revision, position }`；
  - `{ status: 'already_closed' }`：头上没有活动 Run，或该 Run 已有终态；
  - `{ status: 'mismatch' }`：头上的活动 Run 不是要关的那个；
  - `{ status: 'conflict' }`：版本被别人改了；
  - `{ status: 'unreadable', reason }`。
- **L4 历史还原永远跳过被中断的那一步。**
  - `restoreSessionHistory`、`projectTerminalTranscript`、`findLastCompletedTurnBoundary` 把 `interrupted` 的 Turn 当成已结算的边界，但不把它的用户消息和过程放进模型输入。之后每一次还原都一样，不只是关后的第一次。
  - Session 里此前没有已完成 Turn 的情况也要成立。
  - 原记录照常按位置读得到（`sessions/history`、`readSessionHistory` 不变）。
- **L5 平台由谁来关、凭什么能关。**
  - AgentRuntime 加 `closeOpenTurn(ctx, { sessionRef, afterRunRef })`，只有 Host 持有租约时可用。它按 `afterRunRef` 读平台 Run，取它绑定的 Kernel Session 和 Kernel runId，经 `KernelStoreRegistry` 找到这个 Session 登记的存储，再调 L2。
  - 能关的前提，全部由平台事实证明，缺一不关：
    1. 平台 Run 已经结束：结果是 `crashed/host_interrupted`（RUN-19）、`cancelled`（RUN-23）、暂停中断（RUN-24），或经人认定（SES-07）；
    2. Session `occupancy === null`；
    3. `health === 'unavailable'` 且 `healthConclusion === 'kernel_turn_open'`；
    4. `lifecycle === 'active'`，没有归档请求；
    5. Kernel 头上的活动 Run 正是这个平台 Run 绑定的那个。
  - 结果未知、仍占着 Session 的 Run（决定 45）不能靠“关掉 Kernel 头”变成可执行。
- **L6 关完以后，平台健康走已有的 SES-13，不新加状态行。**
  - 关闭返回 `closed` 或 `already_closed` 以后，由 Host 侧对这个 Session 做一次真正的探测，探测结果交原健康 owner `recordSessionHealth`：`ready` 且 `activeRunId === null` 时按 SES-13 回到 `available`，同时清除 `healthConclusion`。接线包 2 合入以后，也一并清除 `unavailableSince`。
  - 不拿关闭的返回值直接写健康。
- **L7 两个存储之间崩溃时，靠重做恢复。**
  - Kernel 已关、平台健康还没写时崩溃：下次再走到这个 Session，关闭返回 `already_closed`，探测再走 SES-13。
  - 不需要两边同一次提交，也不新加记录。
- **L8 在哪里触发。** 维护和 Workflow 两处，同一个函数。
  - **维护：** `session-maintenance.ts` 的退役分支，在决定归档一条 `kernel_turn_open` 线之前，先尝试关闭：
    - 关闭并恢复成功：这条线不再退役，本次不归档。
    - 返回 `unsupported`、`unreadable` 或失败：按今天的规则处理，可能归档。
    - 只在没有人的暂停意图时才在维护里关（`platformCleanInterruption` 为真，或经人认定）。有人的暂停意图（A8-3o/3q）的线，留到人点“继续”时再关。
  - **Workflow：** `claimRequeued` 遇到 `kernel_turn_open`（今天第 1030 行那一支）时，先返回一步新的 `close_open_turn`。
    - 关闭并恢复成功：下一次推进复用原 Session，开新 Run。
    - 否则返回 `create_session{requeue}`，即今天的退路，连同接线包 1 的交接。
- **L9 退路不变。** 下列情况照今天的做法另建接续 Session，负责关系照常交接，前任按规则归档：
  - Kernel 读不到；
  - 两个 Session 不在同一个 Kernel 适配器上；
  - 只有旧的只读 legacy 读取器（`withLegacyReader`）；
  - 关闭失败。

  已归档的旧 Session（补丁之前的）不复活。发给退路前任的回复不自动转发（DESIGN §4.3）。
- **L10 留在原 Session 接续时，接续说明要补上被中断那一步。**
  - 因为 L4 把那一步移出了模型输入，接续说明（`continuation-brief-assembly.ts`）在这种情况下，要像跨 Session 接续那样列出被中断那一步已接受的输入和工具事实。
  - 新的接续方式值 `same_session_after_interruption`；普通的 `same_session_history` 不变。
- **L11 只做 Work 的线。**
  - Query Session（秘书回合、只读副本）的 `kernel_turn_open` 本片不关，照今天的规则处理（A8 Q-01）。
  - 理由：DESIGN §4.3 说的是 Workflow 的接续；Query 的接续规则属于第 6 片，到时按同一个函数接上。
- **L12 能力上报改写。** `continueHistory` 不再无条件写“换新 Session”，改成：支持关闭后在原 Session 接续，并列出退路的几种情况。仍从不报成“恢复原执行”。

**B 部分：**

- **L13 另做一个只读命令工具，不改现有的 `shell`。**
  - 工具名 `run_readonly_command`。
  - 入参 `{ command: string, cwd?: string（工作区内的相对目录）, timeoutSeconds?: number }`。
  - 不给标准输入，不给交互终端。
  - 现有 `shell` 要求写权限，其授权和行为都不变。
- **L14 沙箱用整个工作区只读挂载。**
  - `ProcessSandbox` 加选项 `workspaceMode: 'read_write' | 'read_only'`，默认 `read_write`，不影响现有调用。
  - `read_only` 时整个工作区只读挂载，原有的受保护文件覆盖照旧；`/tmp` 和临时 HOME 可写；网络隔离照旧。
  - 沙箱不可用时，工具直接失败，绝不退回主机命令行。
- **L15 模式按每次调用定，不存进 Run 的恢复约束。** 只读工具每次调用自己用 `read_only` 建沙箱，不改 `effectiveRecoveryConstraintsSchema`，恢复规则不变。
- **L16 执行后仍做快照对比。**
  - 只读模式下工作区若有变化（只可能是同时有别的写者），结果标为失败，原因 `workspace_changed_during_readonly_command`，列出变化的路径。不当作这次命令的效果，也不调 `acceptAgentChanges`。
  - 没有变化时，结果的副作用写 `none`，不写 `possible`。
- **L17 限额沿用现有命令工具。**
  - 默认 30 秒，最多 120 秒。
  - 标准输出和错误输出各保留 64 KiB，并给出总字节数和是否截断。
  - 超时先发进程组 SIGTERM，250 ms 后 SIGKILL。
- **L18 git 的边界如实写进工具说明。**
  - 普通仓库（`.git` 是目录）能看记录、看差异。
  - 要写 `.git` 的操作（会建 `index.lock` 的）失败，报的是 git 自己的错误。
  - 链接式工作树（`.git` 是文件）看不到仓库元数据，工具说明里写明。
- **L19 谁能用。**
  - 决定 37 和决定 49 第 26 项：获授权的只读职责，即 Query 执行（秘书回合、问一问的只读副本、审阅轮）。
  - 授权要两层都有：Host 设置里新开关 `allowReadonlyCommands`（默认开），加上职责模板里列了这个工具。
  - Query 的工具集合从“只给读文件和 8 个探索工具”扩到再加这一个。`runObservedModel` 的只读守卫仍拒绝 `read` 以外的内置工具，新工具作为注册的扩展工具加入，不是内置工具。
  - Work 执行已经有 `shell`，不加。

### 0.3 和别的工作的接缝

- **接线包 2**（施工中）也改 `state/session-availability.ts`、`sessions/session-health.ts`：加 `unavailableSince`，SES-13 恢复时清除。
  - 本片 A 部分只走已有的 SES-13，不改这两个文件的规则，只经已有接口调用。
  - 合入时按接线包 2 先合、本片后合。
- **第 6 片**以后给 Query 的线接同一个关闭函数（L11）。
- **E3** 显示能力上报和“已退役”的新含义。

## 1. 范围

### 1.1 A 交付

1. Kernel 补丁：
   - `run.interrupted` 终态；
   - `closeOpenTurn`；
   - 历史还原跳过被中断的 Turn。

   都写在 `vendor/coding-agent/patches/` 的源里，用 `scripts/build-kernel-patch.mjs --write` 重新生成。`dist` 不手改（AGENTS.md 第 6 条）。
2. AgentRuntime：
   - `closeOpenTurn` 操作；
   - 终态消费者认 `interrupted`；
   - 接续说明的新接续方式。
3. Workflow：
   - 维护里先关再判断归档；
   - `claimRequeued` 的新步 `close_open_turn`；
   - 之后由 Host 探测，走 SES-13。
4. 能力上报改写。

### 1.2 B 交付

1. Kernel 补丁：`ProcessSandbox` 的 `workspaceMode`。
2. 平台工具 `run_readonly_command`。
3. Query 的授权和工具注册。
4. Host 设置开关。

### 1.3 不在本片

- Query 线的关闭（第 6 片）。
- 原 Turn 的“恢复执行”：永不做。
- 压缩（K2）。
- 界面（E3）。
- 自动转发发给退路前任的回复。
- Work 执行的只读命令。

## 2. 接口（新名字以此为准）

```ts
// vendor/coding-agent/patches/public-api.ts（新导出）
export type CloseOpenTurnInput = { sessionId: string; kernelRunId: string; expectedRevision: number; at: string };
export type CloseOpenTurnResult =
  | { status: 'closed'; revision: number; position: number }
  | { status: 'already_closed' }
  | { status: 'mismatch'; activeRunId: string | null }
  | { status: 'conflict' }
  | { status: 'unreadable'; reason: string };
export function closeOpenTurn(store: SqliteStores, input: CloseOpenTurnInput): Promise<CloseOpenTurnResult>;

// src/core/agent-runtime/ports.ts（RuntimeExecutionPort 新增）
closeOpenTurn(ctx: CoreCallContext, input: { sessionRef: SessionRef; afterRunRef: RunRef }):
  Promise<{ status: 'closed' | 'already_closed' } | { status: 'unsupported' | 'unreadable' | 'mismatch' | 'conflict' | 'refused'; reason: string }>;
// 'refused'：L5 的平台前提有一条不成立。

// src/business/workflow/contracts.ts（WorkflowOperation 新增一种）
{ kind: 'close_open_turn'; sessionRef: SessionRef; afterRunRef: RunRef }

// vendor/coding-agent/patches/sandbox/process/process-sandbox.ts
type ProcessSandboxOptions = { /* 原有 */ workspaceMode?: 'read_write' | 'read_only' };

// 新平台工具（src/core/agent-runtime/readonly-command-tool.ts，新建）
run_readonly_command: { command: string; cwd?: string; timeoutSeconds?: number }
  → { exitCode: number | null; signal: string | null; stdout: string; stderr: string;
      stdoutBytes: number; stderrBytes: number; truncated: boolean; timedOut: boolean; sideEffect: 'none' }
  | 失败（沙箱不可用、超出工作区的 cwd、workspace_changed_during_readonly_command）
```

## 3. 流程行（不新增平台状态行）

| 行 | 何时 | 做什么 | 结果 |
| --- | --- | --- | --- |
| KA1 | 维护遇到退役的 `kernel_turn_open` 线，没有人的暂停意图，L5 前提都成立 | `closeOpenTurn`，再探测，再 `recordSessionHealth` | 成功：SES-13 回到 available，本次不归档。否则按今天的退役规则 |
| KA2 | `claimRequeued` 遇到 `kernel_turn_open` | 返回步 `close_open_turn` | 成功后下一次推进复用原 Session，开新 Run；否则 `create_session{requeue}` |
| KA3 | 人点“继续”一条有人暂停意图的线 | 走 KA2 | 同上 |
| KA4 | 关闭已提交，健康还没写，Host 崩溃 | 再走到时重做 | `already_closed`，探测，SES-13 |
| KA5 | 关闭失败、不支持、读不到 | 退路 | 新 Session 接续，交接照接线包 1 |
| KB1 | Query 执行调用 `run_readonly_command` | 只读沙箱执行 | 成功给输出；写工作区失败；沙箱不可用失败 |

## 4. 规则

1. 关闭从不重跑、不续跑原 Turn，从不给未完成的工具调用编结果。
2. 关闭只能作用在平台已证明结束的那次 Run 的 Kernel Run 上（L5）。头上是别的 Run 时返回 `mismatch`，什么也不写。
3. 被中断的 Turn 永远不进模型输入；原记录永远可读。
4. 健康只经已有的探测和 SES-13 恢复（L6）；不新加状态行；`state/` 以外不写健康。
5. 退路的行为、交接和异常锚点与今天完全一样（L9）。
6. 只读命令不能改工作区，不能联网，不能退回主机命令行；没授权就看不到这个工具。
7. 读取和探测不调用模型。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同接线包 2 §5：用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败测试，再写实现；不读数据库核对；期望值来自规格或手算例子；测试名以行号开头。

### 5.1 测试入口（用户 2026-10-13 已确认，决定 50）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| KE1 | Kernel 公开函数 `closeOpenTurn`，用公开的 `SqliteStores.get/read` 观察 | 终态和头同一次提交、身份、并发、重放、原历史保留 | 平台授权、Workflow 选择 |
| KE2 | Kernel 公开的 `runCodingAgent`，脚本模型；关前、关后、再一轮 | 关前进不去；关后同一 Session 能开新 Turn；之前已完成的部分保留；被中断那一步在第二、第三轮都看不到；关闭本身零模型调用 | Host 的恢复策略 |
| KE3 | 业务流程：Host 重启 → 人或目标“继续” → `workflow.advanceWork`（场景框架） | 同一 Session、新 Run；中断期间发来的回复送到；接续说明列出被中断那一步；不多建 Session、不交接、不归档 | 没跑到的并发 |
| KE4 | 同一流程，Kernel 读不到、适配器不支持或关闭失败 | 退回新 Session；负责关系交接；原历史可读 | 关闭成功的内部细节 |
| KE5 | `ProcessSandbox.probe/execute`，真实的 `WorkspaceSandbox`，`read_only`（**要 bwrap**） | 写工作区根和子目录都失败；临时目录可写；不联网；git 读得了、写不了；取消和截断 | 模型工具的授权 |
| KE6 | 脚本模型的 Query 执行（`prepareQueryExecution/startQueryExecution/observeQueryExecution`） | 有授权时工具可见、可用；没授权时看不见；内置写工具照旧被排除；结果存下 | 系统层的强制（沙箱是替身时） |

### 5.2 验收行为

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| KA-01 | KE1 | 关闭一个开着的 Turn：追加一条 `run.interrupted` 记录；头上两个活动 ID 清空；revision 加 1；之前的记录字节不变 | L2、L3 字面值；手写的记录序列 |
| KA-02 | KE1 | 重放同一个关闭请求返回同一条记录；对已结束的 Turn 返回 `already_closed`；头上是别的 Run 返回 `mismatch`；版本过期返回 `conflict`；这些都不写 | L3 字面值 |
| KA-03 | KE2 | 关之前开新 Turn 被拒；关之后同一 Session 开新 Turn 成功 | 现有拒绝规则；L1 |
| KA-04 | KE2 | 关之后第二轮、第三轮的模型输入，都不含被中断那一步的用户消息和过程，含之前已完成的 Turn | 手写的 Turn 序列和期望输入 |
| KA-05 | KE2 | Session 里第一个 Turn 就被中断时，关后新 Turn 的模型输入只有新内容 | L4 |
| KA-06 | KE2 | 被中断的身份重放仍是终态，不会恢复执行或重跑工具 | L1、规则 1 |
| KA-07 | KE3 | Host 重启后点“继续”：同一 Session、新 Run；没有 `create_session`、交接和归档步；Session 回到 available | L8、DESIGN §4.3 |
| KA-08 | KE3 | 中断期间发给原 Session 的回复，在新 Run 的安全点送达 | DESIGN §4.3 |
| KA-09 | KE3 | 接续说明列出被中断那一步已接受的输入和工具事实，接续方式是 `same_session_after_interruption` | L10 |
| KA-10 | KE3 | 维护遇到没有人暂停意图的退役线：先关，恢复后不归档；有人暂停意图的线不关、不归档，等人“继续” | L8 |
| KA-11 | KE3 | 关闭已提交、健康没写时 Host 崩溃，下一次推进完成恢复，仍在原 Session | L7 |
| KA-12 | KE4 | 读不到、不支持、关闭失败三种情况都退回新 Session，交接和归档与今天一样 | L9；现有 WP1 交接规则 |
| KA-13 | KE3 | 结果未知、仍占着 Session 的 Run 的线：不关、不恢复，等人认定（决定 45） | L5 |
| KA-14 | KE6 或能力路由 | 能力上报写明“支持关闭后在原 Session 接续”，并列出退路 | L12 |
| KB-01 | KE5 | 只读模式下写工作区根目录的文件、写子目录、建新文件都失败；工作区不变 | L14 |
| KB-02 | KE5 | 在 `/tmp` 和 HOME 里写能成功，命令结束后不留下 | L14 |
| KB-03 | KE5 | 联网失败；普通仓库的 `git log`、`git diff` 成功，`git commit` 失败 | L14、L18 |
| KB-04 | KE5 | 超时、取消、输出截断按 L17 的字面值返回 | L17 |
| KB-05 | KE5 | 沙箱不可用时工具失败，不在主机上执行 | L14 |
| KB-06 | KE6 | 有授权的 Query 执行能看到并调用工具，得到输出；没授权（Host 开关关、或职责模板没列）看不到 | L19 |
| KB-07 | KE6 | 加了新工具以后，Query 照旧看不到 `shell`、`edit`、`write` | L19 |
| KB-08 | KE6 或 KE5 | 命令执行期间工作区被别人改了：结果失败，原因 `workspace_changed_during_readonly_command`，不记成这次命令的效果 | L16 |

### 5.3 bwrap 的限制

KE5 的行要真实的 bubblewrap。DSH 的沙箱里没有 bwrap，这些测试在那里会失败。DSH 照样按 TDD 写；能在沙箱里先跑的部分，用 KE6 的工具层先做通。KE5 的行由 lead 在有 bwrap 的 WSL 里跑并验收。

## 6. 文件（影响面；以事实清单 §5、§6 为准，施工时以实际为准，超出要报）

**A 部分：**

- Kernel 补丁源：
  - `core/runtime/state/run-state.ts`；
  - `core/runtime/events/agent-events.ts`；
  - `core/runtime/reducer/run-state-reducer.ts`；
  - `storage/adapters/sqlite/sqlite-stores.ts`；
  - `core/ports/session_store/session-store-port.ts`；
  - `core/ports/session_store/session-history.ts`；
  - `core/ports/session_store/session-projection.ts`（目前不在构建清单里，要加进 `scripts/build-kernel-patch.mjs:relativeSources`）；
  - `app/composition/composition-root.ts`；
  - `app/composition/composition-contracts.ts`；
  - `public-api.ts`；
  - 以及它们生成的产物。
- Runtime：
  - `ports.ts`、`runtime.ts`、`execution-contracts.ts`、`kernel-store-locator.ts`、`session-operations.ts`；
  - 终态消费者：`kernel-turn-facts.ts`、`run-reconcile.ts`、`execution-observation.ts`、`query-observation.ts`、`context-assembler.ts`；
  - `continuation-brief-assembly.ts`。
- Workflow：`workflow.ts`、`session-maintenance.ts`、`contracts.ts`、`ports.ts`。
- 其它：组合 `create-platform.ts`；能力上报所在文件。
- 要改断言的旧测试（成功关闭的情形）：
  - `tests/scenarios/A8-host-restart-paused.test.ts` 的 A8-3l/A8-3p，以及 A8-3n、A8-3r 拆出退路；
  - `tests/scenarios/A7-control-goal29.test.ts` 的 A7-G4；
  - `tests/scenarios/A8-host-restart.test.ts` 的 W-11/RUN-19；
  - `tests/scenarios/WP1-wiring.test.ts` 的 SC01（原序列留作退路）；
  - `tests/app/A2-runtime-capabilities.test.ts`；
  - 复核 `tests/business/S1-session-maintenance.test.ts` IT10、`tests/business/WP1-continuation-handover.test.ts` HO01/HO02/HM01。

  这些改动由 lead 列出前后断言并冻结，DSH 不自行翻转。

**B 部分：**

- Kernel：`sandbox/process/process-sandbox.ts`，以及生成产物。
- Runtime：新建 `readonly-command-tool.ts`；`observed-model-run.ts`、`query-preparation.ts`、`query-execution.ts`、`execution-contracts.ts`、`role-profiles.ts`。
- Host：`src/app/runtime-configuration.ts`。
- 测试：新测试文件由 DSH 写；`tests/runtime/R5b-query-session-loop.test.ts`、`tests/runtime/source-text-loop-migration.test.ts` 的排除断言保持。

## 7. 施工

- A、B 两部分各用一个副本、各开一个新的 DSH Session，可以并行。
- **旧测试的翻转（§6）：** 先由 lead 写出逐条的前后断言，冻结后交 DSH。DSH 不自行改旧测试。
- **其余做法同接线包 2 §7：** 先冻结规格和夹具；DSH 按 TDD 写测试和实现；每组派一个只读复查子任务；之后 lead 核对、Codex 审；在有 bwrap 的环境跑全量；最后合入。
- **A 部分合入前：**
  - 跑 `node scripts/build-kernel-patch.mjs --check`，产物和源要一致；
  - 跑 `tests/kernel` 全部。
- **合入顺序：** 接线包 2 先合。

## 8. 不做的事

- 不做原 Turn 的“恢复执行”；
- 不改 `shell`；
- 不给 Work 加只读命令；
- 不在本片关 Query 的线；
- 不复活已归档的 Session；
- 不手改 `dist`；
- 不调用真实模型。
