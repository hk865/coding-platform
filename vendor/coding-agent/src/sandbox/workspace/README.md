# Workspace Sandbox

`WorkspaceSandbox`
把所有文件能力限制在启动时打开的 workspace 根目录。它使用目录句柄和文件身份复核抵抗
`..`、绝对路径、symlink 逃逸及检查后替换。

## 能力

- 有界读取文件/目录，以及 write、replace、delete、patch。
- 编辑前内容摘要与文件身份检查，避免覆盖并发变化。
- 记录本 Session 已观察/修改的路径覆盖树。
- Git workspace 使用受限 porcelain 生成 revision；非 Git 目录使用稀疏元数据快照。
- `session` / `workspace` / `strict` 三种一致性模式和显式 `checkConsistency()`。

文件副作用返回 changedPaths 和 workspace
revision，供 ToolResult、审批指纹和恢复使用。本模块不决定用户是否批准操作。
