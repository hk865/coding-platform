本轮已收尾。

**提交**：`8317081 TF rework 1`（相对 `d4140be`：22 files changed, 236 insertions(+), 162 deletions(-)）。

**结果**：TFR-01、02、03、05、06、07、09、11 和 TFR-12 全部完成；**TFR-04、08、10 为 BLOCKED**，均按“一行全有或全无”规则撤销并留下证据：
- TFR-04：两个 R4c 测试经 `task-claim-fixture.ts:471 overwriteSession` 手写 `unavailable` 且 null conclusion，被新 codec 拒绝；
- TFR-08：`executionAuthorization` 是可选的，RUN-23 真实路径缺少授权，删 fallback 会抛错/改行为；
- TFR-10：`controls` 必需化会让本行未点名的 `B2-runtime-execution.test.ts:383/:483` 变红，故撤销全部编辑并移除 TF1 加进两个 K3 helper 的 controls 接线。

**检查**：typecheck、`check:architecture`、`build` 均为 0；`--noUnusedLocals` 过滤 0 行。Close-out 跑了 164 个 importer 测试文件：3131 passed / 20 failed / 29 skipped，20 个失败全部是 `/usr/bin/bwrap` 缺失且文件 stem 都在 `env-failures.txt`，无新增环境失败。Ledger 21 行：7 条 REMOVED assertion + 2 条 REMOVED test，全部映射到 TFR-05；LOOSENED 0、删除文件 0、D3 hit 0。

详细逐行说明、TFR-05 的转换路径与红绿证、ledger 映射和三条疑似表格错误写在 `./.dsh-ref/out/tf-r1-reply.md`。`./.dsh-scratch/` 已删除，工作区干净。