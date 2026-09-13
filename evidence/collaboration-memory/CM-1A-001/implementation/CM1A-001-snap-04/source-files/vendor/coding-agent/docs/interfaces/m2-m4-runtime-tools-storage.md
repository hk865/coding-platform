# M2–M4 当前接口说明

```yaml
status: current
updated: 2026-08-24
scope: Runtime、工具安全链、Session/Checkpoint 与恢复的当前可执行接口
```

## M2 Runtime

`RuntimeRunner.run` 启动新 Run，`resume` 只接收 paused state，`continueRecovered` 只接收已经由
`RecoveryCoordinator` reconciliation 的稳定 state。恢复继续不会重复产生 `run.started`。

Runner 使用 strict `AgentEvent` +
Reducer 完成 model→tool→model 循环，支持请求重试、限制、取消、Hook、上下文裁剪、可信只读并行和 required/best-effort
EventSink。before_model Hook 修改后的 `ModelRequest`
会重新执行 token 硬预算；EventSink 有界超时，多个 required
sink 中单个失败不会让其余健康 sink 出现 sequence 缺口。

`SelectionPolicy` 先裁低优先级可选输入，再按“assistant
message + 对应的完整 ToolResult”删除最旧闭合 transcript 组。最新 user 和未闭合工具组受保护。模型流同时限制字符数和事件数。

## M3 Tools 与安全链

真实工具统一经 `ToolDispatcher`：通用 schema → frozen Registry → 具体 schema → Permission → Approval
→ workspace revision 复核 → capability → handler → ToolResult 协议校验。内置 `read`、`edit`、`shell`
分别提供有界 UTF-8 读取、带文件 revision 的原子单文件编辑，以及 bubblewrap 非交互命令。

Approval 是绑定 workspace identity/revision、policy 和 sandbox
profile 的一次性授权；审批期间 revision 变化会在 handler 前拒绝。`WorkspaceSandbox` 使用
`/proc/self/fd` 锚定的目录句柄逐段打开路径，避免 symlink TOCTOU。`ProcessSandbox`
不把宿主路径暴露给 bwrap 参数，敏感文件只读或隐藏；能力不可用时返回
`sandbox_unavailable`，不会退化为宿主执行。

`WorkspaceWriteResult.newRevision` 是目标文件内容 hash，供后续 `expectedRevision`
使用；`ToolEffects.workspaceRevision` 是全 workspace snapshot hash，供审批和恢复环境校验使用。

## M4 Session 与恢复

Session 保存 `session.created`、`turn.started` 和 `agent.event`
三类 append-only 事实；Checkpoint 是带事实游标、config、workspace、checksum 的派生快照。InMemory 与 SQLite 实现相同 Store
Port 语义，包括 revision conflict、幂等重试、批次原子性和最近 3 个 checkpoint。

`CheckpointStorePort.listCheckpointCandidates` 允许 Adapter 把单条损坏表示为
`{ checkpointId, checkpoint: null }`，恢复器据此删除坏记录并继续尝试更旧候选。`RecoveryCoordinator.recover`
对任何准备继续执行的状态要求当前 `RecoveryEnvironment`，并校验完整 config 与重放后最新 workspace
identity/reference/revision。

required `SessionEventSink` 保证 `tool.started`
持久化后才启动 handler。活动模型请求在恢复时只追加一次
`process_interrupted`；已开始但无结果的工具先追加结构化
`tool.outcome_unknown`（含模型可见合成结果）再追加 `run.failed`
终止原 Run，绝不自动重放副作用；稳定状态通过 `RuntimeRunner.continueRecovered` 回到正常闭环。

## M6 工具生命周期契约

AgentEvent 增加两个工具结算事件：

- `tool.cancelled`：payload `{ callId, result: CancelledToolResult }`。正常协作式取消（工具返回
  `cancelled` ToolResult 且父级 AbortSignal 已中止）时，Runner
  **先持久化本事件**（保存真实取消原因、已有输出和effects），成功后才提交
  `run.cancelled`。Reducer 将调用标为 `cancelled` 并把结果写回 transcript。
- `tool.outcome_unknown`：payload
  `{ callId, toolName, effectClass, reason: "process_interrupted"|"cancelled_while_running", retryPolicy: "never_automatic", recordedCallEventId, synthesizedResult }`。仅当工具已开始执行但 Runtime 因进程中断或强制取消未取得结果时记录（恢复器对 running 工具、Runner 对中断抛错的已 started 调用）。
  `synthesizedResult` 是模型可见合成 ToolResult（`error.code="outcome_unknown"`、`retryable=false`、
  `effects.sideEffect` 与 `effectClass`
  一致，均由 schema 强制），明确说明可能已产生副作用、禁止自动重试；有副作用工具不得自动重放。`recordedCallEventId`
  必须是真实已提交的 `tool.started` 事件 id（缺失视为损坏，不允许占位字符串）。

**执行协调与屏障**：

- 工具组收尾使用**有界 drain**（默认 5s，`toolDrainTimeoutMs`
  可配置），**只在取消信号发生后开始计时**：未取消的正常长工具遵从工具自身的超时；取消后忽略 AbortSignal 且永不返回的工具按「结果未知」处理，保证
  `run.cancelled`/`tool.outcome_unknown` 总能落盘（内置工具由执行器信号/进程组终止）。
- **启动屏障**：`tool.started` 的 required sink 失败时不得启动工具副作用；`recordedCallEventId`
  只在 required sink 全部成功后记录。
- **checkpoint 版本推进**：`tool.cancelled` 的 `workspaceRevision`（取消前部分写入）纳入 checkpoint
  workspace 版本，避免恢复误判外部并发修改；`CheckpointingEventSink` 已接入生产 composition。
- **恢复事件投递**：`RecoveryResult.reconciledEvents` 携带恢复追加的全部对账事件，resume
  composition 按 Session 顺序投递给 observer/Web
  Projection（best_effort），用户时间线能看到恢复的工具事实。

**可见性边界**：`side_effect_result_unknown`
后原 Run 已终态，生产路径（resume-composition）不再调用模型；合成结果作为 `tool_result`
写入 Session 事实（transcript），供审计视图与未来的 Context Projection/下一 Turn
handoff 消费。多组 ToolCall 下部分结算的批次，终态归约时由 Reducer 把已确定/合成结果冲刷进 transcript（不允许只停留在 toolBatch）。

工具调用状态矩阵（`run-state.ts`）：`pending / running(started) / completed / failed / cancelled / outcome_unknown / abandoned`。

- `pending`：模型已提出，尚未进入执行；
- `abandoned`：仅表示 Run 结束时尚未开始的调用被放弃（不伪造结果）；
- `outcome_unknown` 兜底：Run 因其他原因终结时仍 running 的调用由 Reducer 标记（无合成结果）；显式
  `tool.outcome_unknown` 事件路径带合成结果；
- 正常取消**不得**被标成 `outcome_unknown`/`result_unknown`（`result_unknown` 已移除）。

`ToolErrorCode` 增加
`outcome_unknown`；`ToolEffectClass`（`read_only / workspace_write / process`）从工具协议导出，Runner/Recovery 缺省按最保守的
`process` 处理，组合层按工具注册表注入真实类别。
