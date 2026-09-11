# Data Flow

本目录从时序角度补充模块地图：

- [Core 契约流](m1-contract-flow.md)：State/Event、Model、Tool、Context 与 Fake 的数据方向。
- [Runtime、工具、Session 与恢复](m2-m4-runtime-flow.md)：事件提交、Reducer、Checkpoint 和重放。
- [CLI、Provider 与工具闭环](m5-cli-provider-flow.md)：App Composition 到真实 Adapter。
- [下一阶段 Agent 数据流](next-agent-data-flow.md)：Inbox、投影、压缩和多 Agent 提案。

主链不变量是：外部结果先归一为 AgentEvent，required
sink 提交成功后 Reducer 才推进 State；恢复以 append-only Session 为事实源。静态依赖关系见
[模块地图](../architecture/module-map.md)。
