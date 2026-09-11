# ADR-0005：工具生命周期状态矩阵与取消/中断语义

状态：Accepted 日期：2026-08-28 替代关系：补充 ADR-0002/0004 中未明确的工具结算语义；`result_unknown`
状态更名为 `outcome_unknown`。

## 背景

M6 基线（`beaeaff`）存在两个状态语义缺陷：

1. **正常取消丢结果**：工具返回 `cancelled`
   ToolResult（含原因、已有输出、effects，shell 甚至已杀进程组并收集 stdout/stderr），Runner 看到父级 AbortSignal 已中止后直接提交
   `run.cancelled`，`cancelled` ToolResult 被丢弃；Reducer 把运行中的调用标为
   `result_unknown`，与「Runtime 崩溃」无法区分。
2. **中断语义不清**：恢复器对已 `tool.started` 但无结果的调用直接
   `run.failed(side_effect_result_unknown)`，没有工具级事件、没有模型可见的合成结果，模型无法得知工具可能已产生副作用。

## 决策

### 事件

新增两个 AgentEvent：

- `tool.cancelled { callId, result: CancelledToolResult }`：正常协作式取消的事实记录。
  **先持久化本事件，成功后才提交 `run.cancelled`**；`tool.cancelled` 的 required sink 失败时以
  `run.failed(required_sink)` 结束，不得假装取消成功。
- `tool.outcome_unknown { callId, toolName, effectClass, reason: "process_interrupted"|"cancelled_while_running", retryPolicy: "never_automatic", recordedCallEventId, synthesizedResult }`：工具已开始执行但未取得结果的结构化记录。`synthesizedResult`
  是模型可见合成 ToolResult（`error.code="outcome_unknown"`、`retryable=false`、说明副作用可能已发生且禁止自动重试）。

### 状态矩阵

```text
pending → running(started) → completed / failed / cancelled / outcome_unknown
pending → abandoned（Run 结束时尚未开始）
```

- `cancelled`：协作式停止，取得真实取消结果并持久化；
- `outcome_unknown`：已开始但结果未知。显式事件路径携带合成结果；Run 因其他原因终结时的 running 调用由 Reducer 兜底标记（无合成结果）；
- `abandoned`：只表示未开始就放弃，不伪造结果；
- 原 `result_unknown` 移除，其语义由 `outcome_unknown` 承担。

### 写入与恢复顺序

- Runner（正常取消）：`tool.started` → 工具返回 cancelled → `tool.cancelled` → `run.cancelled`。
- Runner（强制中断）：组内执行使用**有界 drain**
  协调。**drain 只在取消信号发生后开始计时**：未取消的正常长工具遵从工具自身的超时（由执行器负责），不会被 Runner 提前判定失败；取消发生后，忽略 AbortSignal 且永不返回的工具在
  `toolDrainTimeoutMs`（默认 5s，可配置）超时后按「结果未知」处理，保证取消能落盘。已返回的真实结果（completed/failed/cancelled）照常结算持久化，
  **只有确实没有结果的调用**才记录 `tool.outcome_unknown(cancelled_while_running)` →
  `run.cancelled`；不自动重试。
- **启动屏障**：`tool.started` 的 required sink 失败时（降级为 `run.failed`）不得启动工具副作用；
  `recordedCallEventId` 只在 required sink 全部成功后记录，失败路径不残留未提交的 eventId。
- Recovery（进程中断）：对每个 running 调用 `tool.outcome_unknown(process_interrupted)` →
  `run.failed(side_effect_result_unknown)`；只追加一次（幂等），绝不重放副作用。
- **恢复事件投递**：恢复追加的全部对账事件（`process_interrupted` / `tool.outcome_unknown` /
  `run.failed` / `run.completed`）由 `RecoveryResult.reconciledEvents` 携带，resume
  composition 在返回前按 Session 落盘顺序投递给 observer/Web
  Projection（best_effort），用户时间线能看到恢复的工具事实。
- 合成结果随 transcript 的 `tool_result`
  条目写入 Session 事实。**可见性边界**：`side_effect_result_unknown`
  后原 Run 已终态，当前生产路径（resume-composition）不再调用模型；合成结果供审计视图与未来的 Context
  Projection / 下一 Turn
  handoff 消费。多组 ToolCall 下部分结算的批次，在终态归约时由 Reducer 把已确定/合成结果冲刷进 transcript（不能只停留在 toolBatch）。
- **checkpoint 版本推进**：`tool.cancelled` 可能携带取消前部分写入的
  `workspaceRevision`，checkpoint 必须纳入该版本（与 completed/failed 一致），否则恢复会把 Agent 自己的部分修改误判为外部并发变更。
- **生产接线**：`CheckpointingEventSink`
  已接入生产 composition（run 与 resume 两条路径），工具边界派生快照覆盖整个生命周期。

### 效果类别

`ToolEffectClass`（`read_only / workspace_write / process`）移入工具协议端口；Runner/Recovery 缺省按最保守的
`process`（可能产生副作用、禁止自动重试）处理，组合层按工具注册表注入真实类别。合成结果的
`effects.sideEffect` 依据类别取值，并由事件 schema 强制：
`retryable === false`、`sideEffect === (effectClass === "read_only" ? "none" : "possible")`、
`recordedCallEventId` 必须是真实已提交的 `tool.started`
事件 id（缺失视为日志损坏/内部不变量错误，不允许占位字符串）。

## 后果

- 正常取消与异常中断在 Session 中产生不同事件（`tool.cancelled` vs
  `tool.outcome_unknown`）与不同终态（`cancelled` vs `failed`）。
- Web Timeline 区分 `cancelled`（携带真实原因/输出）与 `outcome_unknown`（明确禁止自动重试）。
- 合成结果进入 Session 事实（transcript 的 `tool_result`），可从恢复后的状态投影为模型输入（Context
  Projection 路径就绪）；「恢复后同一 Turn 自动看到」不是当前生产行为。
- 引入两个事件类型与一个状态枚举变更；旧 checkpoint 中的 `result_unknown`
  状态在恢复校验时视为非法并回退重放（checkpoint 是可丢弃缓存，Session 事实是真相）。
- `recordedCallEventId` 关联对应 `tool.started` 事件，便于审计追踪。

## 验证

- `tests/integration/runtime-tool-states.test.ts`（13 用例）：正常取消、并行组整体取消、并行组混合中断（协作取消保留真实结果、只有无结果调用标 unknown）、强制中断、abandoned/outcome_unknown 兜底、进程中断恢复（结构化字段 + 合成结果 + 幂等）、多组崩溃恢复（终态冲刷合成结果进 transcript）、Context
  Projection 可见性、sink 失败、**tool.started 落盘失败不执行工具**、**永不返回工具不阻塞取消**
  （有界 drain）、**取消结果 revision 进入 checkpoint**。
- `tests/contract/state-events.contract.test.ts`：`tool.cancelled` / `tool.outcome_unknown`
  schema 硬约束（错误码、retryable、sideEffect 与 effectClass 一致）。
- `tests/integration/m4-storage.test.ts`、`tests/e2e/m4-cross-process.test.ts`：恢复只追加一次对账事件、跨进程不重放副作用。
- `tests/unit/web-event-projection.test.ts`：cancelled 与 outcome_unknown 的 Timeline 区分。
- `tests/review/independent-runtime-lifecycle.test.ts`（5 用例）：独立复现 started 屏障、cancelled
  revision checkpoint、并行三分结算、永不返回工具取消、跨进程恢复 + 生产模型调用数 0 +
  **observer 收到恢复对账事件**。
- `tests/review/runtime-drain-regression.test.ts`：未取消的正常长工具不被 drain 截断（drain 只在取消后启动）。
- `tests/review/scenario-runner-security.test.ts`（8 用例）：runner 路径 containment、YAML 严格解析、无效 JSON、信号 vs
  timeout、external_dependency_missing 分类。
