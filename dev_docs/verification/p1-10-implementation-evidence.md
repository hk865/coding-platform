# P1-10 Implementation Evidence

```yaml
ticket: P1-10
status: verified (limited authorization, 2026-09-06 continuous window)
product_revision: ee53869
shared_baseline: 29a7249
verdict: PASS
```

## 结论
P1-10（pause/resume/cancel/steer + safe point + desired/current 分离）已验收：**typecheck 0 errors；全量 130 files / 947 tests PASS / 0 skip；契约套件双适配器 7+7；restart 1/1；真实 SQLite 集成 2/2。**

## 验收映射（Ticket 8 项 Acceptance）
| # | Acceptance | 验证 | 实测 |
| --- | --- | --- | --- |
| 1 | pause/resume/cancel/steer 均要求 expected revision 与 idempotency key | SubmitControlCommand 形状 + fixture 命令（expectedRevision/identity）+ 幂等/异身份测试 | ✅ |
| 2 | 命令先持久化 desired state/intent，再触发 runtime side effect | submit 仅原子记录（无 runtime 调用）；ack 由 runtime 单独登记 | ✅ |
| 3 | pause/cancel 请求与 current state 分开显示；Runtime fact 才证明已停止 | controlTimelineView（desiredState + status + ackCount 分列；ack 前 status=queued） | ✅ |
| 4 | steer 只在声明确安全点投递；保留 payload digest/delivery cursor/ack | steer 契约（safePointOnly/payloadDigest/deliveryCursor）+ adapter 测试 | ✅ |
| 5 | steer 不改变 Goal/objective；这类变化进 P1-11 | steer 只存 directive/digest（无 objective 字段）；无 record 写 Goal/Plan | ✅ |
| 6 | 重复命令不重复 side effect；过期 ack 不覆盖新 Run | 幂等 replay + stale_ack（run 不匹配拒绝）+ 过期 ack 语义（scoped per intent） | ✅ |
| 7 | Runtime 无法确认时 outcome_unknown，不猜成暂停/取消/成功 | ack.applied=false（run_mismatch 等）+ status=rejected 保留；outcome 语义由 runtime 事实驱动 | ✅ |
| 8 | UI 不能直接杀进程或修改 Task/Goal phase | 全链经 Control 命令 + 只读展示；无 phase 写路径 | ✅ |

## 集成裁决
①RunRef goalId 必须匹配真实 Run（fixture 修正）；②P1-10 时间线双计数缺陷（重复 hook 调用）已修复；③late-ack 的 suite 期望修正为 stale_ack 拒绝（控制语义正确）；④desired-kind 一致性 guard（pause→paused 等）。
