# Event Sink Adapters

`event-sink-adapters.ts` 是通用 best-effort
Sink 的扩展入口，当前仅重新导出/承载 Adapter 边界；具体实现位于 `logging/`、`trace/`，Web 投影位于
`src/app/web`。

新增 Sink 只能读取 `AgentEvent`，并应声明
`delivery: "best_effort"`。需要阻断提交的持久化职责属于 Storage 或 Checkpoint 模块，不放在这里。
