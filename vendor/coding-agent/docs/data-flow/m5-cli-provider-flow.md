# M5 CLI、Provider 与工具闭环

```yaml
status: current
updated: 2026-08-26
scope: run/resume CLI 到 Provider、工具、安全链和 Session 的实际调用关系
```

```text
argv
 → strict CLI parse
 → file/env/CLI config merge
 → 显式 Provider Registry 选择并只读取所选 secret
 → Workspace/Process Sandbox probe
 → 固定 Tool Registry + Permission + Approval
 → SQLite Session + required SessionEventSink
 → Skill selection + Empty Memory recall
 → RuntimeRunner
    → Provider stream
    → ToolCall → Dispatcher → Policy → Approval → Sandbox → ToolResult
    → ToolResult 回填下一次 ModelRequest
    → completed/cancelled/limit/failed
 → 稳定 CLI exit code
```

`resume` 先由 `RecoveryCoordinator` 重放 Session/checkpoint 并消解 active model、pending/running
tool；只有稳定状态才能重新交给 Runtime。SIGINT/SIGTERM 通过 AbortSignal 进入 Runner，调用方取消优先于 Provider 中止竞态，最终只产生一个
`run.cancelled`。

真实密钥不进入 argv、配置文件、Session、checkpoint、trace 或测试 snapshot。未知 Provider、秘密缺失和 sandbox
capability 缺失均在副作用前 fail closed。
