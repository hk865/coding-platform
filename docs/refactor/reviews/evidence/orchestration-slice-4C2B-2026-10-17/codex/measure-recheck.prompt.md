只读复核（不要改任何文件，不要跑测试或构建）。用中文回答，800 字以内。

当前目录是 4C-2 B 段返工 3 之后的代码（等于合入树）。`.lead-ref/measure-4c2-investigation.md` 是一个 Claude 子 agent 在 2 万条注记的数据上实测后写的报告：每次调用读了几次存储、和第 4 片规格 §11.7 的读次数预算（`docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` 约 900–918 行；§11.5 约 840–880 行，§11.4 约 825–840 行，§11.6，§12、§13）比，多出来的读在哪里、怎么改。

请逐条核对，每条给结论（成立 / 部分成立 / 不成立）和代码依据（文件:行）：
1. 心跳一次检查（`readScribeTodos`）多出的约 1,644 次读，是否都来自 `note-scribe-todos.ts` 对关系目标调 `deps.check.checkHeads`；规则（§11.5、§11.6 的 `userReasonsOf`）是否只需要状态、用户标记和主锚点的非文件退役。改成 B 段的 `userReasonFacts`（`note-service.ts` 约 917 行）并去掉 `check` 依赖是否保持行为：特别核对报告说的退役判断的分歧（待办把除 `file_deleted` 以外的原因都当非文件退役，B 段把文件锚点的每个原因都当文件）——按规格哪一个对；`pendingUnderstandingOverridden`、`immediate`、`updateDue` 等是否还需要 `check`。
2. `readAnchorGoalFacts`（`note-anchor-facts.ts`）对每个挂任务的目标都重读 Goal、Goal、PlanRevision、不用已读的计划窗口：是否属实；加一个由 `planWindowOf(call)` 供数的 `goalFacts` 钩子（同 `catalogModuleFacts` 的做法）在写入路径、书记处置路径、卡源路径上是否都安全（版本钉、已取消的目标、阶段锚点）。
3. `selectProjectHeader`（`note-read-model.ts` 约 1338 行）读项目锚点 5 个槽、之后核对的 `conflictingOf` 又读一遍：让它用同一次调用的 `anchorSets` 是否正确（分段“找”的有联系集合里已有 `project` 时内容是否相同）；§11.7 “项目锚点一次扫描”的写法应怎么改。
4. “找”第一页超过 100 毫秒：报告说剩下的主要是 4B 的核对派生读（每项的锚点集合、状态桶）和 4C-1 的项目部分，以及数据里项目锚点有 130 条现行一般注记（软配额 5）。这个归因是否成立；4C-2 范围内是否还有必须改的。

每条“必须改”的，按决定 75 给修改思路（改哪里、复用什么、大约多少行）和该加的测试（经公开入口，用计数包装手算期望值）。最后一句写“可以据此返工”或列出还需要先查清的。
