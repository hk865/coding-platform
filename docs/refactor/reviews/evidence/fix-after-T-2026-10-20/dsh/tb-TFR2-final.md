DONE — TFR-04 已按表重做并提交。

**提交**：`bd58f4a TF rework 2`（`8317081..HEAD` = 5 files, +17/−14）

**改动**
- `session-record-codecs.ts`：`health: 'unavailable'` 现在必须有 `SESSION_HEALTH_CONCLUSIONS` 成员，否则拒绝；`available` 的合法 `null` 保留。
- `line-status.ts:287/:351/:601/:817`：去掉 `?? null`、`'unrecorded'` 文案和 `retired_unrecorded` 分支，`retiredReason` 收窄为穷尽 switch。
- `work-line-reader.ts`：`toSegment` 不再产生 `retired_unrecorded`，并删掉因此空出的 `LineReasonV1` import。
- `R4c-task-claim-boundaries.test.ts:96` 与 `R4c-task-claim.test.ts` 的 `unavailable` mutation：只加 `healthConclusion: 'missing'`（`missing` 是 `SESSION_HEALTH_CONCLUSIONS` 成员）。
- 契约成员 `retired_unrecorded`、helper、断言均未动。

**检查**
- typecheck / check:architecture / build：全部 0；`--noUnusedLocals` 过滤：0 行。
- Importer 测试：214 个测试文件、22 批（每批 ≤10、`--maxWorkers=2`、`timeout 900`）→ **2325 passed / 41 failed / 0 skipped**；202 文件过、12 文件有失败。
- 41 项失败中 37 项在 `env-failures.txt` 覆盖内（bwrap）；另 4 项在 `S1-archive-restart`、`WP1-wiring`，在干净 `8317081` worktree 中同样 4 项失败、报错与行号一致，确认非本行引入（worktree 已删）。
- Ledger：0 条 REMOVED/LOOSENED、0 删除文件、D3 0 hits，无需映射（两处测试改动均记 TFR-04）。

回复已写入 `./.dsh-ref/out/tf-r2-reply.md`；`.dsh-scratch/` 不存在，工作区干净。