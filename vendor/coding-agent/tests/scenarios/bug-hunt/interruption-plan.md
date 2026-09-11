# Bug 排查场景：取消与异常中断注入点

本场景用于验证状态语义（`tool.cancelled` / `tool.outcome_unknown` /
`abandoned`）在真实业务任务中的表现。

## 注入点

| 注入时机                                           | 方式                               | 期望行为                                                                                                          |
| -------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 工具执行中（如 `shell` 运行测试、`edit` 修改文件） | 用户取消（Web 取消 / AbortSignal） | 先持久化 `tool.cancelled`（含真实 ToolResult、已有输出、effects），再 `run.cancelled`；不得标成 `outcome_unknown` |
| 工具已 `tool.started` 后进程崩溃/强杀              | 杀掉 Agent 进程                    | 恢复时先追加结构化 `tool.outcome_unknown`（含合成 ToolResult），再终止原 Run；有副作用工具不得自动重放            |
| 并行只读组中一个调用未开始                         | 在组执行中取消                     | 未开始的调用标 `abandoned`；已开始的调用要么 `cancelled`（协作取消）要么 `outcome_unknown`（强制中断）            |
| `tool.cancelled` 落盘失败                          | required sink 注入失败             | `run.failed(required_sink)`，不得假装取消成功                                                                     |

## 验证方式

1. 无中断基线：Agent 完成全部修复，`node test/run-tests.mjs` 全绿；
2. 中断恢复：在 `edit`/`shell` 执行中取消或杀进程，恢复后检查 Session 事件顺序与终态；
3. 记录 trace：事件序列、终态、合成 ToolResult 内容、是否发生自动重试（应否）。

## 本 runner 覆盖范围

`runner.mjs check` 只执行验收器（确定性）；取消/崩溃注入属于 L3 执行层，由场景执行报告如实记录。
