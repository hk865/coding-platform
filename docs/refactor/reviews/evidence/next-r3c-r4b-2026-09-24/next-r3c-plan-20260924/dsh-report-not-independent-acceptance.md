第四轮精确返修完成。核心问题（`queryGoal` 拼接 fresh Goal 与旧 basedOn 候选）已消除；**未独立验收**。

## 修复内容

**`findPendingProposal` 同批核对 Goal（`plan-readers.ts`）**
- 签名改为接收 `goalRef` + 期望 `{ revision, activePlanRevision }`（内部函数，未改任何冻结 Port/契约）。
- 在同一 canonical batch 中读取 `[goalKey, ...candidateKeys]` 并**实际解码 Goal**：Goal key 恒存在，因此 0 候选时也能确定水位；候选与 Goal 来自同一 batch、同一 `readThrough`。
- 若 `goal.revision` 或 `activePlanRevision` 与调用方读到的期望不符 → 返回 `rejected source_stale`（主审允许"明确读冲突，不强求并发成功循环"），绝不返回 fresh Goal + 旧候选。
- 候选集/水位不稳定仍按第 3 轮策略整窗重试（≤4），耗尽 `revision_conflict`。

**`queryGoal` 去拼接（`plan-service.ts`）**
- 删除"水位不同只复读 Goal"的尾部逻辑；直接返回 `{ goal: pending.goal, pendingPlan: pending.proposal }`——二者由同一 batch 解码，天然一致。
- 第一次 `readGoal` 仅用于授权与实际 scope 判定，并作为传给 `findPendingProposal` 的期望 revision/pointer。

修复前会：首次读旧 Goal(rev1, active=null) → `findPendingProposal` 用旧 active=null 选中 `stale-pending-plan` → 尾部复读得到新 Goal(rev2, active=adopted) → 返回 fresh Goal + 旧候选。修复后：同批解码出 rev2 ≠ 期望 rev1 → `source_stale` rejected（测试 else 分支 `status==='rejected'` 通过）。

## 实测（真实 Memory+SQLite，仅要求的检查）

| 检查 | 结果 |
| --- | --- |
| `next-plan` | **4 files / 8 tests passed**（含新冻结的 `goal-3` 双候选 + 查询期采用指针竞态反例，memory+sqlite） |
| `next-types` | exit 0 |
| `next-architecture` | OK，0 issues，5/8 allowed edges |

未重跑无关全量套件；未改测试/契约/ports/Store；本轮仅动 `plan-readers.ts`、`plan-service.ts`，写范围仍是原 7 个生产文件。

## 真余项（未变）
- v2 受权 delta / `origin=model_coordination` 仍 `unsupported`；R3c 整体未关闭。
- `PLAN_GOVERNANCE_RECORD_SCHEMAS`/`PLAN_STATE_RECORD_SCHEMAS` 需生产工厂连同 `materialRecordSchemas()`(Run) 注册。
- 无 requeue，ended Run 保守 `blocked`；R4c 领取准入未实现。
- `plan-service.ts` 约 950 行，如需再拆请主 Agent 预建骨架后放行。

本候选仍需主审独立验收，不自行宣告通过。