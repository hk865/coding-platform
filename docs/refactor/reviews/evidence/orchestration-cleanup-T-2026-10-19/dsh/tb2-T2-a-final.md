已完成本段收尾，回复与 HANDOFF 已写入 `./.dsh-ref/t-reply-T2.md`。

**提交**：`26cde07 T T2 wave 2`（w2-base = `d4c4cea`），工作区除 `.dsh-ref/` 外干净。
**shortstat**：`92 files changed, 3246 insertions(+), 4752 deletions(-)`。
**检查**：`flock ./.typecheck.lock npm run typecheck` 通过；`npm run check:architecture` 通过。ledger：`257 lines to justify, plus 2 deleted files`，按文件逐项映射到条目，无未映射行。

**结果合计**：58 项 done，3 项 partial，1 项未开始。
- partial：T1-070（第二 Goal 被 `K3-35-runtime.ts:113` 的收窄授权挡住，unreachable）；T3-080（`K3_35_TASK_ID` 仍有外部 importer）；T3-103（stub 保留，3 个调用方不在白名单）。
- 未开始：T2-034。
- T3-105 的 TU07 尾段仅因本沙箱缺 `/usr/bin/bwrap` 失败，需在有 sandbox 的环境复跑。

**下一段第一件事**：本段暂停前未跑最终统一测试矩阵；请按书 §3.2 对 `git diff --name-only w2-base HEAD` 中全部 `.test.ts`（约 90 个，减 2 个已删）分批 `timeout 900 npx vitest run --maxWorkers=2` 复跑，重点为 `S5-user-message-tools`、`K3-48-2-...budget`、`unknown-call-review-list`、`WP2-wiring`；绿后再补提交并重跑 ledger。