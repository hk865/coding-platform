# Reducer

`reduceRunState(state, event)` 是 `RunState` 的唯一推进器。它先解析 State/Event
schema，调用转换校验，再以纯函数返回新快照并复核全部状态不变量。

Reducer 负责累积 transcript、usage、模型/工具计数、ToolBatch、pause/failure/outcome 和事件 sequence。它不访问时间、随机数、网络、文件系统或 Store；所有非确定值必须已经写入 Event。
