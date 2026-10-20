本轮返工 3 已完成并收尾。回复写在 `./.dsh-ref/t-reply-W1R3.md`（纯中文）。

**提交**：`254617d T W1 rework 3`，只含 `tests/` 下 5 个文件；`w1r2 HEAD` shortstat 为 `5 files changed, 357 insertions(+), 168 deletions(-)`。

**结果**：
- W3-01 至 W3-12 全部 `done`；无 `BLOCKED`/`partial`，无行外文件，无共享 helper 改动。
- W3-09 的两条删除断言、W3-04 的 `DECISION_MESSAGE_ID` 期望均已按 ledger 映射；0 个删除文件，D3 hits 0。
- W3-12 更正已写入回复：LOOSENED 行在 `tests/work-graph/S3-graph-context.test.ts:917`（W2-24），不在 `R4c-graph-history.test.ts`（W2-17）。

**检查**：
- `flock ./.typecheck.lock npm run typecheck`：通过。
- `npm run check:architecture`：通过，`next source boundaries: OK`。
- 5 个改动测试文件：144 项，140 过、4 失败；4 项均是 R-10 环境失败（本机两个 bwrap 路径都不存在，`IN05`/`IN11` 的 memory+sqlite 报 `ENOENT ... /usr/bin/bwrap` 类错误）。四个非沙箱文件提交后重跑 112/112 通过。
- 待 lead 在有 bwrap 的全量环境确认 `tests/work-graph/S3-context-inputs.test.ts` 的 IN05/IN11（W3-01、W3-05、W3-06）。