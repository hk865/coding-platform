本轮已完成，五个组各自提交，工作树干净，`.dsh-scratch/` 已删除。

**提交（tf-base=e99b385 → HEAD=d4140be）**

| 组 | 提交 | 文件 | +/− |
|---|---|---|---|
| TF1 | `d66c606 TF1 triage deletions` | 120 | +629 / −1057 |
| TF2 | `a127c23 TF2 restored tests` | 7 | +346 / −48 |
| TF3 | `54f4744 TF3 AD08` | 2 | +36 / −30 |
| TF4 | `92b7404 TF4 old workbench removed` | 123 | +412 / −16541 |
| TF5 | `d4140be TF5 unused names` | 158 | +171 / −346 |

总计：**372 files changed, +1594 / −18022**。

**结果摘要**
- **TF1**：375 行全部有结果——`deleted` 111、`simplified` 81、`kept` 178、`BLOCKED` 5（A1-026、A1-027、C2-039、C3-062、C3-063，均已回退/保留原状并写明证据）。
- **TF2**：7 个恢复全部落地；IN04、W1-race、W-05 pause、M05、T5x、A-07 symlink、non-wildcard include 均有红→绿证明。唯一例外是 tw-01 的 IN12，其红/绿被本机缺少 `/usr/bin/bwrap` 挡住（代码按 restore 写好，未放宽）。
- **TF3**：AD08 先红（真 prepare 后 `committed`，期望 `revision_conflict`），再加最小生产改动（`baseSources` 命名 Workspace record），后绿（14/14、60/60）。50 个 prepare/entry 回归文件中 44 通过，6 个失败全部是 bwrap 环境；**没有任何文件因 Workspace revision 移动而失败**。
- **TF4**：`src/ui/`（79 文件）、build 脚本、`tsconfig.ui.json` 删除；package.json 只改两行；34 个引用 `src/ui` 的测试/脚本已删/改并逐条说明。Phase 2 声明删除 0 个；48 个 HTTP DTO 作为 `wire-format`/`kept for E3` 保留，allowlist 212 条，production-reach 4/4。
- **TF5**：`--noUnusedLocals` 290 条 → **0 条**；158 文件 +171/−346。
- **检查**：`npm run typecheck` 0、`--noUnusedLocals` 0、`check:architecture` 0、`build` 0、架构三件套 52/52。Importer 测试 441 文件：411 通过，30 失败全部为 bwrap/沙箱环境；零个非环境失败。Ledger 66 行 + 11 个删除文件，D3 hits 0，无 LOOSENED，全部映射到 TF1 行/TF3 步骤/TF4 文件/TF5 名字。

**产出文件**
- `.dsh-ref/out/tf-reply.md`（完整中文回复）
- `.dsh-ref/out/tf1-rows.tsv`（375 行结果表）
- `.dsh-ref/out/tf5-before.txt`、`tf5-after.txt`（290 → 0）
- `.dsh-ref/out/ledger.txt`

**疑似任务书问题**（已在回复第 6 节列出）：NP 行目录过期 4 处；`graph-context-reader.ts` 实际有 C4-113 行；`src/ui` 引用文件是 34 不是 35；§5 “add nothing” 与 48 个 wire-format allowlist 条目的解读；`tsconfig.json`/`tsconfig.build.json` 的旧 `src/ui` exclude 顺手删除。