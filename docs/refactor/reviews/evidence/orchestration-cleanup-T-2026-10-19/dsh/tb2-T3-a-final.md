T3 组第二波已完成并提交。

**结果**
- 99 条：**97 done，2 partial**（T2-025 有 1 个 BLOCKED 子例；T3-064 有一处书核对字面不可达），0 条整项 BLOCKED。
- 提交：`54380f7 T T3 wave 2`；`84 files changed, 1680 insertions(+), 3232 deletions(-)`。
- 完整逐条表、ledger 映射、BLOCKED 证据和 HANDOFF 已写入 **`./.dsh-ref/t-reply-T3.md`**（plain Chinese），ledger 在 `./.dsh-ref/ledger-T3.txt`。

**检查**
- `flock ./.typecheck.lock npm run typecheck`：绿。
- `npm run check:architecture`：绿。
- 138 个测试文件（54 个改动文件 + 全部 helper importer），14 批：**1116 passed / 50 failed**。
  - 47 个为本机无 bwrap/systemd 的环境失败（RL 6 件、K3-07、orchestration-mechanism、S8A-L8-pass-capture、C8 两例）。
  - 3 个为 `WP1-wiring` 的基线已有失败（干净 `w2-base` worktree 同样复现）。
- ledger：`MOVED 37 / REMOVED assertion 233 / REMOVED test-or-describe 69 / DELETED files 6`；无 LOOSENED、skip/todo/only、加超时、单后端或 ALL_CAPS 期望；D3 hits 0；302 行 + 6 个删除文件全部按文件映射到编号，无未映射行。

**两个 partial**
- **T2-025**：新 helper `R4-history-turn-support.ts` 已把真实 Session/claim/start-finish 封装好，8 行中 7 行走真实 Runtime；剩余 observer-down 行因 `src/core/agent-runtime/execution-driver.ts:1253` 把 `publish` 固定为 no-op（missing entry point）保留原直调，标 BLOCKED。
- **T3-064**：书核对“所有 language issues 合并为空”在 A08 不可达——保留的 `dist/z.ts` 会被 TS 扫描合法报 skipped（`typescript-source-query.ts:112`）；已改为断言三个保留路径不出现在任何 language issue。

**HANDOFF**
全部单元无半完成；下一 Session 只需在有 bwrap 的环境重跑 47 个环境失败文件，并请 lead 裁定 T2-025/T3-064 两处，再按 book §3 做合入前全量。