T1 wave 2 已完成并提交，回复写入 `./.dsh-ref/t-reply-T1.md`（中文，含 69 项逐项表、证据、检查与 HANDOFF）。

结果概览：
- **65 项 done**，**3 项 partial**（T1-025、T1-068、T3-106），**1 项 BLOCKED**（T1-036）。
- 提交：`5ec8f5e`（另有检查点 `43532e3`、`4c160fa`），工作树干净。
- 最终 shortstat：`76 files changed, 3633 insertions(+), 4589 deletions(-)`。
- `npm run typecheck`、`npm run check:architecture` 均绿；63 个改动测试文件 + 92 个 helper importer 全部按 `--maxWorkers=2` 分批跑过，除本机缺 `/usr/bin/bwrap` 的 26 个环境失败外无失败。
- Ledger 已生成到 `./.dsh-ref/ledger-T1.txt`：263 条 REMOVED assertion、67 条 REMOVED test/describe、2 个删除文件，已逐文件映射到条目；无未映射删除。3 条 added-constant 命中是测试内固定时钟字面量，非 F8。

T1-036 因白名单外的 `tests/work-graph/S2B-r2-r5-not-entered.test.ts:52-74` 手造旧形状 Run 会必然变红，改动已回退以保持提交可绿；具体证据与重做顺序见回复 §2/§6。