第二段完成。工作树已提交，第一段文字保留，`§9. 第二段` 已写入 `./.dsh-ref/t-reply-W1R1.md`。

## 结果

- **夹具（W1-13/17/18/35/36/37/44）**：全部 done。C1 改为真实 prepare/start + A3 gate；S5 删掉 fixture-only duty 映射、改用生产 `platform-adviser/s3.1`；S1-requeue 48 passed；S2C 两个 helper 的死导入清完（128 passed）。
- **W1-15 BLOCKED**：真实 finish 写 terminal RunActivity（`execution-entry-service.ts:1921-1931`），L8 backfill 不替换 current-rule counted 记录（`run-activity-service.ts:159-163`），手算 activity 值无法保留。`S2B-track` 已回退 `w1-merged`，只留 W1-37 注释。
- **W1-10 BLOCKED**：Goal 创建后无公开路由/owner 改 objective/workspaceId，WF01 `context_goal_changed` 没有公开原因（`core-routes.ts:377,440,473-474`、`goal-settings-machine.ts:233-235`、`goal-control.ts:186-210`）；WF02 原因存在，但按 R-5 整行保留 R-2 形态。
- **W1-20 / B-02 / B-03 / B-04 / B-08 / B-09 / B-10 / B-11**：done（B-04、B-08(a) 各一项 BLOCKED，证据见 §9.2）。
- **B-12 / B-13 partial**：IN04、IN12 按 R-4 删除；IN14、IN11 与 3 个手写 Run seed 按 R-5 保留（`mailbox-service.ts`、`evidence-service.ts`、`run-state-service.ts` 证据见 §9.2）。

## 检查

- `flock ./.typecheck.lock npm run typecheck`：通过。
- `npm run check:architecture`：通过。
- 43 个 changed tests + 150 个 helper importer + 116 个 source importer + S2C 10 个 importer：除在 `w1-merged` 基线同样失败的测试外全过。bwrap 环境失败已列出（`orchestration-mechanism`、`R3e-command-check-platform`、`R3e-completion-platform`、`A7-control` 的 5 项）。
- 顺手补了第一段漏掉的三处：`platform.test.ts` 的 `describe` 导入、R4b 的 governance/catalog schema 注册、S2B-runtime-steps 默认 prepare host（避免 timeline/fold 挂起）。
- commit：`ed26c44 T W1 rework 1`。
- 两个 ledger：`.dsh-ref/ledger-W1R1-w1merged.txt`（19 removed tests / 73 assertions / 0 deleted files，92 行全部映射，未映射 0）与 `.dsh-ref/ledger-W1R1-tbase.txt`（702 行 + 3 个 wave-1 删除文件；返工部分同上）。
- shortstat：`t-base..HEAD` 394 files, +5399/−13432；`w1-merged..HEAD` 79 files, +1006/−963。

工作树只剩未跟踪的 `.typecheck.lock`。