# Observability

可观测模块实现 Core 的 best-effort `EventSinkPort`，只读消费已提交事件。它不能推进
`RunState`、改变终态或成为恢复事实源。

- `logging/`：有界、脱敏的结构化事件日志。
- `trace/`：进程内精简时间线。
- `event_sink/`：通用 Adapter 扩展入口。
- `metrics/`：未来指标聚合的预留边界。

持久化正确性由 required Session/Checkpoint sinks 保证；可观测后端失败只产生诊断。
