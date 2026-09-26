继续本lane的第一阶段骨架与测试，仅此阶段，交付后停止。

主审已检查实际失败：你写的是 scope 外的 src/contracts/core/execution-history.ts，又在只读父目录创建 .write-probe；这些拒绝是正确的范围约束，不是批准文件不可写。主审已通过 harness exec 对已批准 src/contracts/core/task-claim.ts 完成 read_text/write_text 原地写回，成功。不得改权限模式、请求更宽sandbox、创建临时探针或重命名。所有新文件都已经预建，你只需用 bash 中 Python Path(path).write_text(content) 或 Node writeFileSync 原地写批准的现有文件。不用 write/edit 原子rename工具。

不要修改 src/contracts/core/execution-history.ts。KernelExecutionBinding 在你的新 contracts中可用 `type KernelExecutionBinding = RunExecutionHistoryV1['kernel']`，只import已存在共享类型，避免重复结构或扩大scope。

重新按 docs/refactor/tasks/B2-execution-state-skeleton.md 和同名scope冻结的接口交付。复用你上一轮工具调用中已写出的草稿，但只写允许列表。可先对 src/contracts/core/task-claim.ts 原地写回原内容验证，然后落盘草稿；不要再把父目录不可写当文件不可写。先查 next-types，新增红测要因unsupported而非坏夹具；服务生产算法仍不实现。报告保存后的文件、独立可复现检查、明确缺口。
