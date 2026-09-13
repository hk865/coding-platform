# Edit Tool

`EditToolHandler` 将 write、replace、delete 和 patch 参数映射到
`WorkspaceSandbox`。输入通过模式判别 schema 校验，操作摘要提供路径供 Permission 与审批指纹使用。

所有文件副作用由 WorkspaceSandbox 执行，并返回 changedPaths 与 workspace
revision。并发内容/身份变化、路径逃逸和非法 patch 映射为稳定 ToolError；本工具不执行 shell。
