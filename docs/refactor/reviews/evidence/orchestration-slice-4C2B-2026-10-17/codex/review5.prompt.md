只读快速核对（不要改文件、不要跑测试或构建）。用中文回答，600 字以内。

当前目录是 4C-2 B 段返工 4 之后的代码。`.lead-ref/` 里有：返工书 `s4c2b-rework-4.md`（三项读次数修正和两条 lead 裁定：A `symbol_missing` 算文件原因；B 同一项目另一个工作区的目标在“用户原因”这条读路径上按计划窗口判断，不再 `forbidden`），依据 `measure-4c2-investigation.md`、你上次的复核 `s4c2b-measure-recheck.out.md`、四个核实者的结论 `verify-measure-fixes.md`，DSH 的回复 `s4c2b-rework4-final.md`，源码改动 `rework4-src.diff` 和统计 `rework4-stat.txt`。

请核对：
1. 三项是否都按返工书做到（书记待办改用 `userReasonFacts`、去掉 `check` 依赖和只为它服务的代码；任务目标在原因路径上复用本次调用的计划窗口，写路径不变；项目锚点集合每次调用读一次、和核对共用），有没有改出行为退化（特别是：不在计数桶里的目标、已取消的目标、没有现行计划的目标、`not_found` 窗口的回退、另一个工作区、分段“找”的第二页）。
2. 新测试是否经公开入口、双后端、期望值手算，能在旧代码上失败；`S4C-find-read-bounds` 的 25→20、37→32 是否算得对。
3. DSH 的 4 条 UNSPECIFIED 是否可以接受。

每条“必须改”的按决定 75 给修改思路。最后一句写“可以合入”或列出必须改的。
