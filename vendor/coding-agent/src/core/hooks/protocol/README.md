# Hook Protocol

`hook-protocol.ts` 是 Hook 的版本化数据契约，定义三个 invocation、对应 decision、失败信息和
`HookPort` 接口。

`before_model` 可有限修改 `ModelRequest`；`before_tool` 可修改或阻断 `ToolCall`； `after_tool`
只可修改 `ToolResultPresentation`。`validateHookDecision()` 根据调用点拒绝越权字段和不匹配的决策。

协议只引用 Core 的 State、Model 与 Tool 值，不包含插件框架、权限实现或 UI 类型。
