# Core Runtime

Runtime 是 Agent 的状态推进与副作用编排层。它依赖 Core
Context、Hooks 和 Ports，通过事件提交屏障把外部结果转成新的
`RunState`，但不知道具体 Provider、工具或数据库实现。

## 组件

- `state/`、`events/`、`reducer/`：状态、事实与唯一纯函数转换。
- `loop/`：模型请求、ToolCall 批次和终止条件的主循环。
- `limits/`、`cancellation/`：副作用前预算检查与统一取消信号。
- `event_delivery/`：required/best-effort Sink 的提交顺序。
- `checkpointing/`：在稳定事件边界生成恢复快照。
- `recovery/`：Session 重放、Checkpoint 对账和未知工具结果处理。
- `tool-outcome-unknown.ts`：中断时合成“副作用可能发生”的保守结果。

关键不变量是：外部结果先形成 `AgentEvent`，required
sink 成功后才由 Reducer 接受；Reducer 是推进 State 的唯一入口。
