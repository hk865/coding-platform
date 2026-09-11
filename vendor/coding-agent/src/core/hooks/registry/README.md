# Hook Registry

`HookRegistry` 负责注册 `HookPort`、拒绝重复 ID，并按 hook
point、priority 和稳定注册顺序建立快照。`freeze()` 后不再允许修改，避免运行中扩展集合漂移。

Registry 不执行 Hook，也不解释决策；这些职责属于
`HookExecutor`。新增 Hook 必须在 Runtime 启动前完成注册。
