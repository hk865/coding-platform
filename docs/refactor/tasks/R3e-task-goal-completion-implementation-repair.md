# R3e.3 实现：Goal 已读副作用窄返修

2026-09-26，沿原 lane `r3e-task-goal-completion-implementation-20260926`、Session `session-4c8afd7e-cae6-4ce2-b0c2-adc181df9dbf`，针对 STOP `attempt-1790406138181025177` 做一次限定修正。真源仍为 [原实施任务](R3e-task-goal-completion-implementation.md)与[主任务 §9](R3e-completion-skeleton.md#9-r3e3-首批派工冻结机械证据到正式-taskgoal-完成)。不重启设计、不增加测试矩阵。

仅允许修改 `coding-platform/next/src/core/work-graph/tasks/completion-policy.ts`。当前 `evaluateGoalCompletion` 只检查 required Task 的正式 reduction 和 obligation 覆盖，没有消费传入 `taskFacts.runsByTaskId` / Task state.lease。真实公开可达场景：required work 与 Goal gate 已完成，但同 Goal 另一个 optional work 仍有合法 starting/running Run、有效 Lease，或已经发生但未对账的副作用；现实现仍会写 `COMPLETED`。optional 尚未执行/仅意图不阻塞，与已启动的副作用必须收束是不同条件。

在该现有纯函数内，复用本文件 `runBlocker` 检查 canonical reader **已经返回**的实际 Run，消费已返回 Task lease 判断有效占用；存在活动执行、unknown/quarantined/unresolved 或有效 Lease 时 `completed:false`，reasons 定位实际 Task/Run/Lease。继续保留 required work/gate/义务规则；不把 optional pending/plan_only 本身加成门禁，不增加 executionIntent 成熟度校验，不另造 side-effect manager、数据库查询、全账本扫描或强制检查。`completeGoalFromHost` 已将这些 facts.guards 放入同一事务，沿用其局部 CAS，无需修改 service/reader。

其余四生产文件必须保持以下 SHA-256，全部 tests/helpers、contracts、composition、检查脚本与 Kernel 只读：

| 文件（tasks/ 下） | SHA-256 |
| --- | --- |
| completion.ts | `8bc35b93ddde8fe86f5ec2228888f1e134a5bbbc54450a936ffe7bfa80619929` |
| completion-record-codecs.ts | `01fba890502ba7509d283434479f05db4dffa9fed847d56db70cd1841ee46689` |
| plan-readers.ts | `c4e48489d095be10b5a378bd2ab27df022072283c60bfa4aa04ef89151c5c530` |
| plan-service.ts | `fe05d6fb6ca9be3858ca0bf672e8e5bcec37b98fe855374752de63439cdd6f6d` |

只运行现有 `next-completion`（三项正常链）与 `next-types`；不新增 case、不修改断言、不追加邻接/全矩阵。报告唯一改动文件及五生产最终 hash、检查结果，随后 **STOP** 等主审核入；不自行导入 main。
