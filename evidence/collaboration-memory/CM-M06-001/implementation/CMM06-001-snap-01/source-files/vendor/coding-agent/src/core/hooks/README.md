# Hooks

Hooks 为 Runtime 提供三个受控扩展点：`before_model`、`before_tool` 和
`after_tool`。它们可以继续、有限修改、阻断、暂停或失败，但不能替代 Event、Reducer、Permission、Approval、Limit 或 Sandbox。

`protocol/` 定义输入和决策，`registry/` 管理稳定顺序与冻结，`executor/`
负责超时、取消、异常归一化和短路。RuntimeRunner 在明确边界调用 Executor；具体 Hook 实现通过 Port 注入，Core 不依赖外层插件类型。
