# Limits

`limit-guard.ts` 定义 `RunLimits`、无限制默认值、违规分类和
`LimitGuard`。可限制模型请求数、工具调用数、运行时长以及输入、输出和总 token。

Runtime 在发起模型或工具副作用之前检查相应预算，并把超限转换成稳定失败事件。LimitGuard 只读取
`RunState` 和时钟值，不负责定时器、取消来源或 UI。
