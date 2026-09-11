# Check Tool

`check` 显式对账 Agent 维护的 workspace 基线，不修改文件。

- `scope=session`：只复核本次运行已观察或影响过的路径。
- `scope=workspace`：Git 目录使用受限 porcelain；非 Git 目录使用稀疏元数据快照。

结果包含模式、scope、状态、检查路径、变化路径、revision 和策略，并推进“已观察”基线。strict 一致性模式还会在风险操作审批前调用同一对账能力。
