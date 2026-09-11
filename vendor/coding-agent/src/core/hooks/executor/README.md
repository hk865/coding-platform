# Hook Executor

`HookExecutor` 从冻结的 `HookRegistry`
取出同一 point 的 Hook，按优先级和注册顺序串行执行。每次调用继承父 `AbortSignal`，并应用独立超时。

Executor 校验返回决策与当前 hook point 是否兼容，合并连续 `modify`，遇到 `block`、 `pause` 或 `fail`
立即短路；异常、超时和非法协议统一为 `HookExecutionError`。

`after_tool`
只能修改展示给模型的 output，不能改写 callId、执行状态或 effects，因此 Hook 无法掩盖真实副作用。
