# Sandbox

Sandbox 层强制执行文件与进程边界，是 Permission 之后的独立安全层。

- `workspace/`：以打开的 workspace 目录为锚，提供 symlink-safe 文件操作、一致性基线和 Git/fallback
  revision。
- `process/`：使用 Linux bubblewrap 建立挂载、环境与网络隔离，并管理进程树。

Permission 回答“是否允许”，Sandbox 回答“即使上层出错，操作最多能触及哪里”。隔离能力缺失时进程工具 fail
closed，不退化为普通子进程。
