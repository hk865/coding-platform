# M2–M4 实际数据流

```yaml
status: current
updated: 2026-08-24
scope: Runtime 正常闭环、工具安全链、持久化顺序与跨进程恢复
related_code:
  - /home/han001/projects/agents/coding-agent/src/core/runtime/
  - /home/han001/projects/agents/coding-agent/src/tools/
  - /home/han001/projects/agents/coding-agent/src/storage/
```

## 正常运行主链

```mermaid
sequenceDiagram
  participant App as Composition
  participant Runner as RuntimeRunner
  participant Sink as required SessionEventSink
  participant Reducer as Reducer
  participant Context as Selection + ContextBuilder
  participant Hook as HookExecutor
  participant Model as ModelClientPort
  participant Tool as ToolExecutorPort
  participant CP as Checkpoint/Observer sinks

  App->>Runner: run(input) / resume(state) / continueRecovered(state)
  Runner->>Sink: run.started（新 Run 才有）
  Sink-->>Runner: 已持久化 position/revision
  Runner->>Reducer: 提交同一 AgentEvent
  loop 直到唯一终态
    Runner->>Context: transcript + instructions + tools + tokenBudget
    Context-->>Runner: 预算内 ModelRequest
    Runner->>Hook: before_model
    Hook-->>Runner: continue/modify/block/pause/fail
    Note over Runner: modify 后重新估算 token，不能绕过预算
    Runner->>Sink: model.request_started
    Runner->>Model: stream(request, signal)
    Model-->>Runner: 有序 ModelEvent 流
    Runner->>Sink: usage / assistant.message_completed / failure
    alt 有 ToolCall
      Runner->>Hook: before_tool
      Runner->>Sink: tool.started
      Note over Runner,Sink: required ACK 后才允许启动副作用
      Runner->>Tool: execute(call, signal)
      Tool-->>Runner: ToolResult + effects
      Runner->>Hook: after_tool（只能改展示 output）
      alt 正常协作取消（父信号已中止）
        Runner->>Sink: tool.cancelled（真实 ToolResult：原因/输出/effects）
        Runner->>Sink: run.cancelled（tool.cancelled 落盘成功后才提交）
      else 强制中断（工具抛错且已 started）
        Runner->>Sink: tool.outcome_unknown（合成结果，禁止自动重试）
        Runner->>Sink: run.cancelled
      else 完成/失败
        Runner->>Sink: tool.completed / tool.failed
      end
    else final_answer
      Runner->>Sink: run.completed
    end
    Runner->>Reducer: 每个已提交 Event 推进 RunState
    Runner->>CP: required 成功后再投递 best-effort
  end
```

状态不会由 Model、Tool、Hook 或 Store 直接改写。Runner 先用同一 Event 计算候选状态，required
sink 全部成功后才接受 Reducer 结果；best-effort sink 超时或失败只记诊断。

## Context 裁剪

```text
输入候选
  → 删除低优先级 Memory
  → 删除低优先级 Skill
  → 删除低优先级附加 Instruction
  → 从最旧开始删除“assistant + 其完整 ToolResult”闭合组
  → 仍超预算则 ContextSelectionError
  → ContextBuilder 生成确定性 ModelRequest
  → before_model Hook 若修改请求，重新估算并再次执行硬预算
```

最新 user
message、未闭合 ToolCall 及其配对关系不会被单独裁掉。模型事件数与聚合字符数均有上限，防止零字符事件无限占用内存。

## M3 工具安全链

```mermaid
flowchart LR
  Call["ToolCall"] --> Common["通用 strict schema"]
  Common --> Registry["冻结 Registry 查找"]
  Registry --> Concrete["工具专用 schema"]
  Concrete --> Permission["PermissionPolicy"]
  Permission --> Approval["一次性 Approval（Ask 时）"]
  Approval --> Revision["重新读取 workspace revision"]
  Revision --> Capability["capability/profile 检查"]
  Capability --> Handler["read / edit / shell handler"]
  Handler --> WS["fd 锚定 WorkspaceSandbox"]
  Handler --> PS["bubblewrap ProcessSandbox"]
  WS --> Result["ToolResult + effects"]
  PS --> Result
```

审批绑定 operation fingerprint 和审批前 revision；用户等待期间 workspace 变化会拒绝执行。`edit` 的
`newRevision` 是单文件内容版本，`effects.workspaceRevision`
是整个 workspace 快照版本，两者用途不同。ProcessSandbox 通过已打开根目录 fd 绑定 workspace，并覆盖
`.git`、`.env`、凭据和 evaluator/oracle 路径；bubblewrap 能力不足时 shell fail closed。

## M4 持久化与恢复链

```mermaid
flowchart TD
  Facts["SQLite append-only Session facts"] --> Open["RecoveryCoordinator 打开 Session"]
  Checkpoints["最近 checkpoint candidates"] --> Select["逐个校验 schema/checksum/cursor/state"]
  Select -->|损坏| Older["删除坏候选并回退旧 checkpoint"]
  Older --> Select
  Select --> Replay["从 cursor+1 重放同一个 Reducer"]
  Open --> Replay
  Replay --> Env["按重放后最新 config/workspace revision 校验当前环境"]
  Env --> Phase{"恢复阶段"}
  Phase -->|active model| Interrupted["追加 process_interrupted，生成新 requestId"]
  Phase -->|pending tool| FirstRun["首次执行工具"]
  Phase -->|running tool| Unknown["为每个 running 调用追加 tool.outcome_unknown<br/>（含模型可见合成结果），再追加 run.failed<br/>→ 终止原 Run，不自动重放"]
  Phase -->|stable| Continue["RuntimeRunner.continueRecovered"]
  Phase -->|paused| Paused["等待显式 resume"]
  Phase -->|terminal| Terminal["只读返回"]
  Interrupted --> Continue
  FirstRun --> Continue
  Continue --> Final["继续 model/tool loop 至唯一 final"]
```

`SessionEventSink` 是 required 持久化屏障；`CheckpointingEventSink`
只在稳定边界保存派生快照。工具返回新的 workspace
revision 时，后续 checkpoint 会同步该版本，因此 Agent 自己已经确认的 edit 不会在重启时被误判成外部修改。Checkpoint 可丢弃；Session
facts 才是真相来源。

## 工具生命周期最小矩阵（M6）

```text
pending ──tool.started──▶ running ──tool.completed──▶ completed
  │                        │
  │                        ├─tool.failed────────────▶ failed（确定失败）
  │                        ├─tool.cancelled─────────▶ cancelled（正常协作取消，先落盘真实 ToolResult）
  │                        └─tool.outcome_unknown───▶ outcome_unknown（崩溃/强制中断，带合成结果）
  └─Run 结束──────────────▶ abandoned（未开始即放弃，无结果）
```

- 正常取消：先持久化 `tool.cancelled`（payload 含真实 `cancelled`
  ToolResult：取消原因、已有输出、effects），成功后才提交 `run.cancelled`；绝不把正常取消标成
  `outcome_unknown`。
- `tool.outcome_unknown`：仅当工具已开始执行但 Runtime 因进程中断或强制取消未取得结果时记录；至少包含
  `callId / toolName / effectClass / reason / retryPolicy:"never_automatic" / recordedCallEventId`，并携带模型可见的合成 ToolResult（说明可能已产生副作用、禁止自动重试）。并行组用
  `Promise.allSettled` 等待所有工具停止：已返回的真实结果照常结算，只有确实无结果的调用记 unknown。
- `abandoned`：仅表示 Run 结束时尚未开始的调用被放弃，不伪造结果。
- 有副作用工具发生 `outcome_unknown` 后不自动重放；恢复器只追加一次对账事件（幂等）。
- 终态冲刷：部分结算的批次（多组 ToolCall 下恢复器只结算当前组）在 Run 终结时由 Reducer 把已确定/合成结果写回 transcript，保证状态层可见；`side_effect_result_unknown`
  后原 Run 不再调用模型，合成结果供审计视图与未来 Context Projection/下一 Turn handoff 消费。
