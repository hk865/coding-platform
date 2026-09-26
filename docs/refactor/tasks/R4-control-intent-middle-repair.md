# R4.1 骨架中审返修：仅目标测试，完成即 STOP

2026-09-26。接续 r4-control-intent-skeleton-20260926 / session-136629ed-8264-46da-9156-f0cfd2497163。原 §9、dispatch 与九文件 scope 有效，本轮实际仅改 `tests/work-graph/R4-control-intent.test.ts`。其它八文件包括 composition test 保持现中审 hash。不得开始实现。

主审独立检查当前 7 文件 49 项：19 红 30 绿，类型通过。真实 domain writer 前态、commit 前竞争及 SQLite close/reopen 接缝成立；测试不代表实际 Kernel pause/cancel 已接通。

## 必要修正

1. 最后 lost commit acknowledgement case 先真实 commit 再 throw，但原 lookup/eventAt 仍可读。此时按 §9.3 可恢复真实 receipt，首次应 committed/replayed；不允许硬断 unavailable 逼实现放弃恢复。该同一 case 可使用两个 request/两个实际 Run（复用 secondClaim）覆盖两个区别窗口：
   - commit 成功+响应丢失，回执可读：首次恢复 committed，原键重放结果一致且不重提新 commit。
   - commit 成功+响应丢失，**本次恢复读取也实际受阻**：wrapper 在真实提交完成后令本次 lookupCommit 读取 unavailable/抛错（不要影响最初 lookup miss），首次只能 unavailable 未确认；解除读故障后原键重试恢复同一个真实 receipt，不再新写。不能把 unavailable 文案说成提交前失败、安全重试或肯定未提交。
   不改 Store、不伪造 receipt/event、不 raw 写 Run。helper 只包本测试真实 Store。
2. fresh authorize 和 begin 测试将 executionAuthorization 不变断言移到被拒动作**之后**，以验证被拒操作没留下副作用。
3. 同 Run 同 pin 的 race loser 明确断 `revision_conflict`，不能任意 rejected 即通过。
4. 第一条 queued pause 持久化 case 同时对比 before/after 的原 Session/Lease，确认请求不释放占用。已有自然 completed case 在真实 recordRunResult 后核原 Session/Lease 按原正式结果逻辑释放；只复用 fixture.read 的事实，不新增 lifecycle fixture 或矩阵。

不增加其它 replay/cancel/Role 状态矩阵，不扩主线产物。保留 real observation DTO fixture 的精确定位，避免称其实际 Kernel 执行结果。

## 检查

仅 `next-control-intent next-execution-state next-b2-composition`，types 单跑；不重复全量 next-tests。平台 keys 中新增 controls 的一行同步由主审合入骨架时完成，你不改范围外测试。报告真实首红与后段未达、精确 hash，然后 STOP 等待最终中审冻结。
