# P1-09 Implementation Evidence

```yaml
ticket: P1-09
status: verified (limited authorization, 2026-09-06 continuous window)
product_revision: 最新主链（P1-09 实现提交）
verdict: PASS
```

## 结论
P1-09（非阻塞 QueryJob）已验收：**typecheck 0；全量 135 files / 965 tests PASS / 0 skip；契约套件双适配器 7+7；restart 1/1；真实 SQLite 集成 2/2（含双适配器视图一致性）。**

## 验收要点（映射）
- 独立 ID/Run/Context/预算/超时/只读：QueryRun 版本化聚合（P1-03 Run 未动）+ QueryJobDrivePort + ReadOnlyQueryPort；源 Worker run 不变（scenario 断言 runId 不同）。
- 多轮有界澄清（rounds≤4 + followsAnswerRef）；stale 标注（round2 stale=true，view.stale=true）。
- 机械查询走 ReadModel、语义新 QueryJob；快照 unsupported 显式（SnapshotPort/PublicSnapshotPort）。
- 不改源 Task/Goal phase（无 TaskLease/TaskAttempt 聚合写入；view 只读组合）。
- 集成裁决：runId 身份与 fold 对齐（QueryRunV1.runId 字段）；multi-round 的 run 状态（末轮后 answered，此前 running）；answer 守卫按 pending/running 接受；提交检查 intentId≠jobId 的解耦。

## 边界
不完成其他票；G4 等待 P1-11；P1-15 等待 09+14+17；Ticket 状态保持 proposed；本地 main 未推送（需用户授权）。
