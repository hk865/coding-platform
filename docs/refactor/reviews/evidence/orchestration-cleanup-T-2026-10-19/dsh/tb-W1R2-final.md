本回合已完成并提交，完整的中文逐行回复在 `./.dsh-ref/t-reply-W1R2.md`（含 §9 HANDOFF）。

## 结论

- **提交**：`1c31c27 T W1 rework 2`，仅 18 个 `tests/` 文件，`+1803 / −1168`；未提交 `.dsh-ref/`、`.typecheck.lock`；未改 `src/`、`docs/`、`vendor/coding-agent/dist`、`package.json` 或 lock。
- **行结果**：W2-01..W2-25 全部处理；`W2-08` partial（Host probe 一步 R-5 BLOCKED）、`W2-11` BLOCKED（无公开 claim 读，已回退 base 快照）、`W2-17` partial（later-Turn 子例按 R-4 删除）；`W2-14`/`W2-22` 为无测试改动项。没有 `未施工（R-6 事实不符）`。
- **共享 helper**：`tests/helpers/S2B-runtime-steps-fixture.ts` 新增可选 `beforeBegin`、`workspaceRevision`、`kernelStores`，默认路径不变。
- **检查**：
  - `flock ./.typecheck.lock npm run typecheck`：绿。
  - `npm run check:architecture`：绿（`next source boundaries: OK`，D3 hits 0）。
  - 改过的 14 个测试文件：276 passed / 0 failed（分两批）。
  - 改过 helper 的 115 个 importer 测试文件：12 批，1,037 项中 1,036 passed / 1 failed；唯一失败是 `tests/app/orchestration-mechanism.test.ts` 的 `ENOENT /usr/bin/bwrap` 环境失败。
  - ledger `./.dsh-ref/ledger-W1R2.txt`：45 REMOVED assertion、4 REMOVED test/describe、1 LOOSENED（脚本 hunk 配对误报，严格断言仍在）、0 删除文件；53 行全部映射到 W2 编号。
  - shortstat：`18 files changed, 1803 insertions(+), 1168 deletions(-)`。

## HANDOFF

- **done**：所有行、检查、提交、ledger、shortstat；暂停后复核 `git status` 只有会话开始前就存在的 `?? .typecheck.lock`，`git diff --stat` 为空。
- **half done**：无。
- **not started**：无。
- **下一位需要知道**：
  - S5 fixture 的公开 seed 链使用独立 `publicSeedSeq`/`seedEventId`/`seedNewId`；不要接回主 `newId`/`eventId`，否则 `K3-48-2` 的 156,720 字节字面量会偏 2（本回合踩过，已修）。
  - W2-08 probe 步、W2-11 是 R-5 回退；W2-17 later-Turn 子例是 R-4 删除，证据见回复 §2。
  - 环境失败只有 `orchestration-mechanism` 的 bwrap；带 bwrap 的全量由 lead 跑。
  - 本环境没有 `rg`，本次全部用 `grep` 代替。