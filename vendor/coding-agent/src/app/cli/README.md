# CLI

CLI 是薄交互适配器，入口为 `main.ts`，主要实现位于 `cli.ts`。

## 调用路径

```text
argv → parseCliCommand → loadAppConfig
     → runCodingAgent / resumeCodingAgent
     → stdout/stderr + process exit code
```

`parseCliCommand()` 识别 `run`、`resume`、workspace、Provider、model、数据库和非交互选项。
`TerminalApprovalRequester` 把 `ApprovalRequester`
映射到终端；非交互环境默认拒绝需要人工确认的操作。SIGINT 通过 `CancellationController`
传入 Runtime，而不是直接杀死工具子进程。

CLI 不构造
`RunState`、不决定权限，也不直接创建 Provider。新增交互方式应复用 Composition 入口，而不是复制运行时装配。
