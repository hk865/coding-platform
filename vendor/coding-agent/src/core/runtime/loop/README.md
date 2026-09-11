# Runtime Loop

`RuntimeRunner` 编排一次 Run 的 `start`、`resume` 或 `continue`，同一实例拒绝并发执行。

## 单轮路径

```text
选择 Context → before_model Hook → ModelClientPort stream
  → text/final 或 ToolCall batch
  → before_tool Hook → ToolBatchPolicy → ToolExecutorPort
  → after_tool Hook → transcript → 下一轮模型请求
```

每个步骤都先检查 Limits/Cancellation，并通过 `EventDeliveryCoordinator` 提交 AgentEvent。
`consumeModelStream()` 校验并归并流式 delta、reasoning、ToolCall、usage 和终止事件。

Runner 只依赖 Port；持久化由 required sinks 接入，恢复前的 Session/Checkpoint 对账由
`RecoveryCoordinator` 完成。
