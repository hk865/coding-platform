报告：`t-P2a.md`（459 行，含表格、JSON、合计、覆盖说明与决定 79-1 的选项）。

- old-data：24 条（22 条待删/改 + 2 条 keep）
- legacy：4 条（3 条待改 + 1 条 keep）
- 合计 28 条，估计约 1,334 行生产代码（其中 Session legacy-provenance 链约 850 行）

未能完成：`isFinalizedNonPass` 的 PASS+gaps 可达性未逐条走完；evidence `options.checks` 是否保留待产品决定；删 Session provenance 后测试侧手写 `SessionRecord` 的迁移面未系统扫；`replyMode` 的 app/business/ui 迁移面与片外 13 处 V1 auth 收窄未逐文件审；work-graph 的 3 条 wire-format 允许清单条目归 P2b。