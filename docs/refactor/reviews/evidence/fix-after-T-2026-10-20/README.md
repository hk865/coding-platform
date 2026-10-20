# T 后小修（决定 86，2026-10-20 夜到 10-21）

## 是什么

- 决定 86：用户逐项看了 T 验收“留给用户”的 10 项和覆盖率分拣，定了六件事（86-1…86-6）。
- **86-1 小修。** 用户选了三类：删分拣确认可删的代码（逐行定删还是留），补回 T 删错的测试，删 T 漏删的空来历链路，改一处过时的注释；AD08 改生产代码，不改规格；清掉 `--noUnusedLocals` 报出的没用的名字，单独一个提交。用户原话：“今晚可以dsh，如果没做完，或者返工较多，就你来吧。”
- **86-2 删老界面。** 用户问“是否可以全部删除？附带连带的一些其它未使用的函数？因为基本用不上”，之后选了“删，今晚和小修一起交 DSH”，单独一组、单独提交。
- **86-3 欠账并进以后的分片。** K3、L8 原定进 T 而 T 没做的，以及条目以外的手写状态；以后哪一片改到同一批文件，就顺带做掉，清单记在 STATUS。
- **86-4 其余照 lead 的建议。** 第 3 项（几处没有公开读口）和第 8 项（全量变慢）接受为带日期的已知限制；第 2 项（Agent 重新入队的工具入口）留给第 7 片（GAP-46）；第 10 项不改代码，规格补一句。
- **86-5 “有能力、没入口”的规矩。** 用户问：“是不是我们的分片有问题？也许之后实现的，施工的agent需要注意。” 规矩写进分片入口和 DSH-WORKFLOW。
- **86-6 测试的内存和规模测试。** 用户问：“也就是说，规模测试我们应该尽量减少，对吗？同时要在保证质量的同时”。lead 量一次全量，Codex 只读盘点最慢的 25 个文件，拆分方案交用户定。

五个组，各一个提交；两轮返工和 lead 在返工审查后的五处小改合成第六个提交：

- **TF1：** 按 triage 的 375 行，逐行定删、简化还是留；补删 T 漏删的空来历链路，改一处过时的注释。
- **TF2：** 恢复 T 删错的七个测试。
- **TF3：** AD08，先写失败测试，再改生产代码。
- **TF4：** 删掉旧浏览器工作台 `src/ui` 和只被它用的东西。
- **TF5：** 清掉 `tsc --noUnusedLocals` 报出的未使用本地名。

## lead 定的规则

- **D1、D2**（D1 生产没人调用，D2 有调用方但状态不会出现）：按提案删或简化。下面几种留：提案自己说留，或说规格给后面的分片留着；删了会收窄冻结的接口（`src/contracts` 的类型、HTTP 路由的请求或响应、允许清单的 `wire-format` 条目）；提案给了两条路但没选。
- **U**（只有篡改或旧格式的记录会到）：删“容忍旧形状”的分支；留“拒绝损坏或外来记录”的完整性检查。两种情况都不加测试（AGENTS 第 4 条）。
- **一行一个结果。** 只记 `deleted`、`simplified`、`kept`、`BLOCKED`；`kept` 和 `BLOCKED` 写原因和 `file:line`。删了会让测试变红的行，回退并记 `BLOCKED`——那一行本来就是错的。
- **AD08 先测。** 先把 AD08 改成真实的 `prepare`、真实的 Session pin @7→@8、真实的 entry，跑红；再用最小的生产改动跑绿。
- **TF4 给 E3 留。** 每条 HTTP 路由及请求/响应类型、Host 的静态外壳（没有网页时回 `unavailable`）、依赖和锁文件。
- **TF5 的边界。** 只删未使用的 import、局部变量、局部函数、私有成员、没人用的类型；不删导出声明、参数、`_` 开头的名字。

## 结果

- 已合入 lead 分支，六个提交：TF1 `aab1a8fd`、TF2 `df0282c6`、TF3 `7a5273f0`、TF4 `0ecba599`、TF5 `c95d741c`，两轮返工和 lead 的小改 `4a8a1400`；标签 `old-ui-last` 在 `4679c7e3`。按对象合入（工作区的 `core.autocrlf=true`）：副本打包，逐组拣选，合入后的代码和副本逐字相同（[merge.txt](checks/merge.txt)）。合计 379 个文件 +1,809/−18,161：`src/ui` 79 个文件 −12,883；其余 `src` 121 个文件 +707/−1,230；测试 172 个文件 +1,071/−3,893；测试文件 766 → 755。
- 副本里的提交：五个组 `d66c606` TF1、`a127c23` TF2、`54f4744` TF3、`92b7404` TF4、`d4140be` TF5，合计 372 个文件 +1,594/−18,022；返工 1 `8317081`，22 个文件 +236/−162；返工 2 `bd58f4a`，5 个文件 +17/−14；lead 的小改 `20afbfa`，5 个文件 +13/−14（[lead-fix.txt](checks/lead-fix.txt)、[lead-fix.diff](checks/lead-fix.diff)）。

**TF1**

- 375 行，返工后的最终结果（[tf1-rows-final.tsv](dsh/tf1-rows-final.tsv)）：删 112、简化 83、留 177、BLOCKED 3。TF1 提交 120 个文件 +629/−1,057。
- BLOCKED 是“一行全有或全无”：删了会让测试变红，或前提（新的生产行为）还没有，整行回退，不转换测试。剩下三行：
  - `C2-039`：把 `controls` 改为必需，要动四个测试：两个手写 observer、不带 `controls` 的 S2B-36、S2B-38(b)，以及 `B2-runtime-execution` :383、:483；它们是 T 留下的。
  - `C3-062`、`C3-063`：要先有第 1 片 §2.2 的 readonly_copy 创建检查（新的生产行为），才能删那两个分支。
- 空来历链路删干净了：`legacyPending`、任务书点名的几个读者里 `provenance === null` 的分支（来历仍可为 null 的类型收窄，别处的判断照留）、`provenance_unchecked` 标记及其契约成员。行列表里的 `legacyUnchecked` 恒为精确 0（字段保留）。

**TF2**

- 恢复七个测试（`tw-01`…`tw-07`；IN04 和 IN12 在同一个文件），每个都先红后绿；7 个文件 +346/−48。
- 七份：IN04、IN12（`S3-context-inputs`）；W1-future-plan 的 scenario 9；A2-reconcile-runtime 的 W-05（重启时排着的暂停）；WP2-undelivered-notices 的 M05；S2C-lines-failure 的 2C-14/T5x；S8E-A07-git-inventory 的 A-07（符号链接）；typescript-source-query 的非通配 tsconfig include。
- IN12 的红绿是 lead 做的：`context-input-service.ts:592` 的守护条件关掉 → 2 条失败（memory 和 SQLite，期望 `state: 'missing'`）；恢复 → 2 条通过（[in12-proof.txt](checks/in12-proof.txt)）。
- 第 8 处（显示偏好的空状态）在老界面里，随 `src/ui` 删掉，不补。

**TF3**

- 先测：真实 `prepare`、真实 Session pin @7→@8、真实 entry。红是 `committed`，期望 `rejected` / `revision_conflict`。
- 生产改动最小：Work context binding 记上 Workspace 记录（`graph-context-reader.ts` 的 `baseSources`），entry guard 和同提交 guard 就比较它的 revision。2 个文件 +36/−30。
- 行为变化：Task 的 prepare 和 entry 之间有人写 Workspace，entry 现在回 `revision_conflict`。
- Workspace 的写入方是首次注册、Session pin 和 notice 读取位置；正常的串行 Workflow 准备之后直接开始，中间不夹这些写入（Codex P6）。但如果你正好在这段时间里改置顶或标通知已读，进入会被拒并转为等待；现有的自动重新准备只处理目标变了的情况（`context_goal_changed:`），不会自己恢复（Codex P6，记在 STATUS 已知限制）。

**TF4**

- 删了 `src/ui/`（79 个文件）、`scripts/build-workbench.mjs`、`tsconfig.ui.json`、11 个只测老界面的测试文件。123 个文件 +412/−16,541。
- `package.json` 的 `build`、`typecheck` 各少一步；`scripts/check-boundaries.mjs` 和 `tests/architecture/*` 里的 UI 规则删掉。
- 借过 `src/ui` 的测试保留后端断言；Host 测试用 `tests/helpers/host-page.ts` 自己写页面。`scripts/verify-isolated.mjs` 的 Host 冒烟也自己写页面（TFR-11）。
- 给 E3 留下的：每条 HTTP 路由及请求/响应类型；48 个只有 `src/ui` 会到的类型转成 `wire-format` 允许清单条目（164 → 212，R-TF-1）；Host 的静态外壳；依赖和锁文件。
- 删之前最后一个带老界面的提交打了标签 `old-ui-last`（`4679c7e3`）。

**TF5**

- `tsc --noUnusedLocals` 的诊断 290 条 → 0（一条诊断可以是整条 import，另有清单外的连带删除；158 个文件 +171/−346）。
- 没删导出声明、参数或 `_` 开头的名字；删了一个带 `expect` 的死测试 helper（`archiveLine`）。

**全量**

- `d4140be` 上 755 个测试文件全过，9,668 项过、3 项跳过，1,711 秒；构建、类型检查、模块边界检查都是 0（[full-tf1.txt](checks/full-tf1.txt)）。
- 最终全量（lead 小改后的 `20afbfa`，代码和合入的 `4a8a1400` 逐字相同；8 个并行）：755 个测试文件全过，9,668 项过、3 项跳过，vitest 1,678 秒；构建、类型检查、模块边界检查都是 0（[full-final.txt](checks/full-final.txt)）。返工 2 之后（`bd58f4a`）也一样（[full-tfr2.txt](checks/full-tfr2.txt)）。`20afbfa` 上 `verify:isolated` 冒烟通过（[verify-isolated-smoke-final.txt](checks/verify-isolated-smoke-final.txt)）。
- 没有调用真实模型。

## 经过

| 步 | 谁 | 文件 | 结果 |
| --- | --- | --- | --- |
| 10-20 22:5x | lead | 任务书 [tf-book.md](books/tf-book.md)；副本 `s9tfix`（T 合入树的克隆，`e99b385`，标签 `tf-base`） | 375 行 TF1 表（`dsh/tf1-rows.tsv`：368 条 D1/D2/U + NP-1…NP-6 + CP-1）；7 份恢复材料（`tw/`） |
| 22:59–01:19 | DSH `tb-TF-1020` | 任务书 → 回复 [tf-reply.md](dsh/tf-reply.md)；五个组 | 五个提交 `d66c606` TF1、`a127c23` TF2、`54f4744` TF3、`92b7404` TF4、`d4140be` TF5；372 个文件 +1,594/−18,022；8,416 秒、44,407,120 token、上下文峰值 305,837 |
| 01:20–01:49 | lead | [full-tf1.txt](checks/full-tf1.txt) | `d4140be` 上 755/755 文件、9,668 项过、3 项跳过、1,711 秒；构建、类型检查、模块边界都是 0 |
| 01:26–01:39 | Codex（只读） | `codex/P1`…`P8` | 会出错 2、违规 25、不整洁 10、建议 27 |
| 01:45 | lead | [tf-findings.md](books/tf-findings.md) | R-TF-1…R-TF-5；12 行 TFR-01…TFR-12；其余不采纳，逐条写理由 |
| 01:46–02:32 | DSH `tb-TFR1-1021` | 任务书 [tf-r1-book.md](books/tf-r1-book.md) → 回复 [tf-r1-reply.md](dsh/tf-r1-reply.md) | `8317081`（22 个文件 +236/−162）；9 行完成，TFR-04、TFR-08、TFR-10 BLOCKED；2,779 秒、10,734,105 token、峰值 203,338 |
| 01:50 | lead | [in12-proof.txt](checks/in12-proof.txt) | `context-input-service.ts:592` 关掉 → 2 条失败；恢复 → 2 条通过 |
| 02:34 | lead | [tf-r2-book.md](books/tf-r2-book.md) §1 | TFR-08 记 `kept`（前提为假）；TFR-10 保持 BLOCKED（四个测试是 T 留下的）；TFR-04 重做，补合法 `healthConclusion` |
| 02:35 | lead | [verify-isolated-smoke-d4140be.txt](checks/verify-isolated-smoke-d4140be.txt)、[verify-isolated-smoke-r1.txt](checks/verify-isolated-smoke-r1.txt) | `d4140be` 上失败（`isolated workbench smoke failed`）；`8317081` 上通过（`workbench smoke ok`） |
| 02:34–02:57 | DSH `tb-TFR2-1021` | 任务书 [tf-r2-book.md](books/tf-r2-book.md) → 回复 [tf-r2-reply.md](dsh/tf-r2-reply.md) | `bd58f4a`（5 个文件 +17/−14）；TFR-04 完成（`healthConclusion: 'missing'`）；1,418 秒、5,755,710 token、峰值 109,561 |
| 02:58–03:07 | Codex（只读） | [R.prompt.md](codex/R.prompt.md) → [R.out.md](codex/R.out.md) | 会出错 1、违规 3、不整洁 3、建议 0 |
| 02:59–03:28 | lead | 全量 `bd58f4a`（8 个并行，[full-tfr2.txt](checks/full-tfr2.txt)） | 755/755 文件、9,668 项过、3 项跳过，vitest 1,689 秒；构建、类型检查、模块边界都是 0 |
| 03:03–03:12 | DSH `tb-TFdocs-1021` | 任务书 [tf-docs.md](books/tf-docs.md) → 回复 [tf-docs-reply.md](dsh/tf-docs-reply.md)；副本 `s9tfdocs` | 文档草稿：改 13 个文件、新建本说明；508 秒、12,334,353 token、峰值 244,041 |
| 03:10 | lead | [tf-findings.md](books/tf-findings.md) §4 | R-01、R-02、R-04、R-05、R-06 由 lead 改；R-03 不采纳（R-TF-6）；R-07 改证据说明 |
| 03:28–03:29 | lead | [lead-fix.py](checks/lead-fix.py) → `20afbfa`（[lead-fix.txt](checks/lead-fix.txt)） | 类型检查 0、`--noUnusedLocals` 0、模块边界 0；`A2-step1-codecs` 29 项过 |
| 03:29 | lead | `verify:isolated` 冒烟（[verify-isolated-smoke-final.txt](checks/verify-isolated-smoke-final.txt)） | `20afbfa` 上通过（`workbench smoke ok`） |
| 03:30 | lead | 标签 `old-ui-last`（`4679c7e3`）；按对象合入 lead 分支（[merge.txt](checks/merge.txt)） | 六个提交 `aab1a8fd`…`4a8a1400`；代码和副本逐字相同 |
| 03:29–03:58 | lead | 最终全量 `20afbfa`（8 个并行，[full-final.txt](checks/full-final.txt)） | 755/755 文件、9,668 项过、3 项跳过，vitest 1,678 秒；构建、类型检查、模块边界都是 0 |
| 03:34–03:42 | Codex（只读） | 文档核对（[docs-check.out.md](codex/docs-check.out.md)，副本 `D:/cxt/t-tfdocs`） | 错 5、误导 2、漏 5、不一致 2 |
| 03:43–03:50 | lead | 按核对改文档 | 14 条全部采纳（见“审查和裁定”） |

时间线、数字和裁定见 [tf-lead-summary.md](books/tf-lead-summary.md)。

**用量。**

- **DSH：** 四次运行（[dsh-runs.txt](checks/dsh-runs.txt)），共 73,231,288 token、13,121 秒。`tb-TF-1020` 44,407,120 token（8,416 秒，峰值 305,837）；`tb-TFR1-1021` 10,734,105（2,779 秒，峰值 203,338）；`tb-TFR2-1021` 5,755,710（1,418 秒，峰值 109,561）；文档稿 `tb-TFdocs-1021` 12,334,353（508 秒，峰值 244,041）。
- **Codex**（只读，[codex-calls.txt](checks/codex-calls.txt)）：规模盘点 00:06–00:35；审查 8 个部分 01:26–01:39；返工审查 02:58–03:07；文档核对 03:34–03:42（[docs-check.prompt.md](codex/docs-check.prompt.md) → [docs-check.out.md](codex/docs-check.out.md)）。
- **Claude：** 只有 lead 本人；没有子 agent 或 workflow（用户 10-20 要省 Claude 额度）。

## 审查和裁定

- **审查。** Codex 把 `tf-base..d4140be` 分成 8 个部分只读审查（[P1](codex/P1.out.md)…[P8](codex/P8.out.md)，01:26–01:39）：会出错 2、违规 25、不整洁 10、建议 27。
- **采纳的 12 行**（[tf-findings.md](books/tf-findings.md) §1，一行全有或全无）：
  - TFR-01：删掉两个 null-kind 计数，`legacyUnchecked` 恒为精确 0。
  - TFR-02：提案链要求 `since`，S5 fixture seed 写当前形状。
  - TFR-03：删掉 `?? null`（`readThrough = watermarks[0]!`）。
  - TFR-04：codec 要求 `unavailable` 带结论，`retired_unrecorded` 不再产生。
  - TFR-05：被中断的检查改走公开步骤，codec 拒绝缺 cause 的记录。
  - TFR-06：`switch` 后保留穷尽检查（`unreachable()`）。
  - TFR-07：恢复 `tf-base` 的 Workspace 失败映射（提案前提为假）。
  - TFR-08：保留 fallback。那个调用点上 `executionAuthorization` 的类型是可选的，提案假设的收窄在那里不成立；收窄随结构一轮（85-1）。DSH 给的理由“RUN-23 没有授权”不对（返工审查 R-07）。
  - TFR-09：删掉最后两处 provenance null 检查。
  - TFR-10：保持 BLOCKED（四个测试是 T 留下的，86-3）。
  - TFR-11：`verify:isolated` 冒烟自己写页面。
  - TFR-12：注释和遗留。
- **裁定：**
  - R-TF-1：48 个 HTTP 请求/响应类型留作 `wire-format` 允许清单条目（164 → 212）；“then add nothing”指不加生产代码。
  - R-TF-2：恢复的测试可以用同文件的 fixture、后端和等待方式；这些 fixture 的手写状态是 T 留下的，随 86-3 走。
  - R-TF-3：只被删掉的未使用名用到的局部名，跟着一起删（TF5 第二轮为空）。
  - R-TF-4：提案给两条路或留给 lead 的 D1/D2 行，这一轮先留：挂在被跟踪或 fire-and-forget promise 上的 `catch`；规格、冻结契约或后面的分片要用的；留给结构轮 85-1 的收窄（`C3-011`、`C3-012`、`C4-127`、`C4-128`、`C3-057`）；没有成本的完整性映射和 tie-break。
  - R-TF-5：`src/contracts` 的成员即使代码不再产生也留（`retired_unrecorded`、`legacyUnchecked`）；只删产生或容忍旧形状的代码。
- **不采纳的**（§3，每条一句）：
  - P1-07：R-TF-4，Delivery 字段留给它那一片。
  - P2-05：`slice-2B-SPEC.md:171` 的 L17 还说旧执行可以没有 Session；契约类型冻结，句子在决定 79 下过时，等 2B 的文件下次改时删。
  - P2-10…P2-13、P3-03…P3-05、P4-07…P4-18、P5-05…P5-11：R-TF-4。
  - P4-01、P4-02：提案说留；删了会收窄 `src/contracts` 的 `ContinuationBriefV1`。
  - P5-01（`C3-011`）：R-TF-4（决定 85-1）。
  - P5-03：两个被删的测试侧检查在依赖类型变必需后就是死代码，没有丢断言（ledger 没有对应行）。
  - P6-01…P6-07：R-TF-2；TF3 的规格核对成立（`slice-3-SPEC.md:356`、`:743`），正常的串行 Workflow 不在 prepare 和 entry 之间写 Workspace（同时改置顶或标已读仍会触发拒绝，见上面 TF3）。
  - P7-02：R-TF-1。
  - P8-01：R-TF-3。
- **返工 1 的三行 BLOCKED 和 lead 的裁定：**
  - TFR-04：两个测试用手写 mutation 造 `unavailable` Session、不带结论，codec 收紧后变红；DSH 整行撤销。lead 裁定重做：只给两处 mutation 补合法的 `healthConclusion: 'missing'`，别的都不动。
  - TFR-08：DSH 说前提不成立（`executionAuthorization` 可选，RUN-23 真的没有）。lead 裁定 B-023 记 `kept`。返工审查（R-07）指出 RUN-23 其实带 V2 授权（`run-machine.ts:2126`、`:1166`，结束记录照样写入授权 `:1025`），所以 DSH 的这条理由不对；留下的理由是：那个调用点上类型可选，提案假设的收窄在那里不成立，收窄随结构一轮（85-1）。
  - TFR-10：`controls` 改必需可行，但会红 `B2-runtime-execution.test.ts:383`、`:483`。这两条和 S2B-36、S2B-38(b) 是 T 留下的。lead 裁定保持 BLOCKED，什么都不改。
- **返工审查**（Codex 只读，[R.prompt.md](codex/R.prompt.md) → [R.out.md](codex/R.out.md)，看 `d4140be..bd58f4a` 和 12 行逐行）：会出错 1、违规 3、不整洁 3、建议 0；TFR-01、-03、-06、-07、-09、-10、-12 没问题。lead 的处理（[tf-findings.md](books/tf-findings.md) §4）：
  - lead 直接改了五处（返工已两轮，这些是几行的小改，照决定 81 和 C1 的先例由 lead 落地），合在第六个提交里：
    - R-01（会出错）：`verify-isolated.mjs` 的临时页面原来写在 `try` 之前，写失败时不会删临时目录；挪进那个 `try`。
    - R-02：`decodePlanProposalOrigin` 多透传了 `noticeAutomationCap`，TFR-02 没授权；方案记录的写入从不写这个字段，改回只返回 `since`。
    - R-04：后继轮的 `supersededEvidenceIds` 期望原来调用生产函数 `chainEvidenceIds` 算，生产代码也用它，漏算时两边同错；改成按场景手算：根轮自己不取代任何证据，它唯一跑完的检查留下一条证据，所以后继轮恰好取代那一条。
    - R-05、R-06：两处注释改得和代码一致（Session 编解码；检查的 cause 可以缺也可以是 null，读的时候不补）。
  - 不采纳 R-03（TFR-05 的转换还调用了 Host 会调用的写入：带构造观测的 `recordCheckResult`、`interruptCheck(host_restart)`，以及 R3e 夹具的 Run 种子）。裁定 R-TF-6：`A2-step1-codecs` 测的是存下来的轮次和它的查找；原来那条错在用了一条没有写入方会产生的记录（被中断却没有原因的检查）。现在轮次由证据 owner 自己的写入产生，形状天然是当前的，满足这一行的目的；为一个编解码测试换成真实 Runtime、真实检查进程和 Host 重启不相称；R3e 夹具的种子是这个文件的夹具（R-TF-2）。
  - R-07 只改证据说明（见上面 TFR-08）。
- **文档核对**（Codex 只读，[docs-check.out.md](codex/docs-check.out.md)，看整份文档改动和本说明，以及还把旧界面当成存在的现行文档）：错 5、误导 2、漏 5、不一致 2，lead 全部采纳：
  - 改正的说法：最终全量的提交（`20afbfa`）；“T 轮的全量”实为本轮五组的全量；`provenance === null` 只删了任务书点名的读者里的；290 是诊断条数；规模提案的接缝是 A–H（H 待定）；1,155 MB 和 796 MB 是每个文件跑完时的堆；AD08 只在串行流程里不会被打断（同时改置顶或标已读会让进入被拒，记进 STATUS 已知限制）。
  - 补上的：STATUS 的 86-3 清单加了留给结构一轮的五行和 `B-023`；最终结果表 B-023 的 lead 注记改成正确的理由（DSH 的原回复照原样保留）。
  - 旧界面已删的带日期注记：`docs/UI-WORKBENCH.md`、`DESIGN.md`、第 6、7、8 片规格开头。第 6 片那条记下一件要定的事：旧界面的“人工采用入口”其实是浏览器把八条后端路由串起来，路由都在，串它们的代码随旧界面删了；由谁来串，lead 在 6A 冻结前定。

## 留下的

- **还 BLOCKED 的三行：** `C2-039`、`C3-062`、`C3-063`。在哪：STATUS 的 86-3 并账清单（C2-039 连同 TFR-10 的四个测试）、`dsh/tf1-rows-final.tsv` 的 BLOCKED 说明、T 验收。
- **T 留下的手写状态**（R-TF-2 点名）：W1-future-plan 只走内存的 set-up、WP2 默认的内存后端、A2-reconcile-runtime 的轮询、`S1-archive-service-fixture`、`S2C-L-line-support`、`S2C-L-runs-support`、`B2-runtime-fixture` 的 governance seed、S3-prepared-context-admission 的 set-up。在哪：STATUS 86-3。
- **L17 那句**（`slice-2B-SPEC.md:171`）：说旧执行可以没有 Session，在决定 79 下过时。在哪：STATUS 86-3。
- **TFR-10 留下的四个测试：** S2B-36、S2B-38(b)、`B2-runtime-execution` :383、:483。在哪：STATUS 86-3。
- **86-1 的另外 55 行 A 组测试缺口：** T 删的测试本身不合规，但行为会发生；不补，记成测试缺口。在哪：T 验收 / triage（[triage-final.tsv](../orchestration-cleanup-T-2026-10-19/coverage/triage/triage-final.tsv)）。
- **R-TF-4 留给结构轮（85-1）的行：** `C3-011`、`C3-012`、`C4-127`、`C4-128`、`C3-057`，连同 TFR-08 的 `B-023`；在哪：STATUS 的 86-3 清单。
- **用户接受的已知限制：** 第 3 项（几处没有公开读口）、第 8 项（全量变慢）；细节在 T 验收“留给用户”（[lead-acceptance.md](../orchestration-cleanup-T-2026-10-19/lead-acceptance.md)）。

## 测试的内存和规模测试（决定 86-6）

- **测到的**（[mem/summary.txt](mem/summary.txt)，T 合入树，5 个并行，24 个处理器）：scope 内存峰值 5,884 MiB（每个并行约 1.2 GB）；墙钟 2,857 秒；各文件时长加起来 13,520 秒；最慢的 5 个文件占 33%。
- 最慢的五个都是规模测试，多半慢在 SQLite 那一遍：`S2A-notices-overbound` 1,381 秒、`S2A-queue-derived-cards` 1,101 秒、`S2C-lines-scale` 961 秒、`S2A-queue-bounds` 582 秒、`B2-401-world` 499 秒。
- 每个文件跑完时记下的 JS 堆最大的两个（不是运行中的峰值）：`production-reach` 1,155 MB、`state-writes` 796 MB。
- 8 个并行时全量约 9.5 GB；`d4140be` 上实测 1,711 秒。最长的单个文件就是下限。
- **Codex 的盘点**（[t-scale.out.md](scale/t-scale.out.md)，只读，最慢的 25 个文件）：
  - 很多规模测试是在证明一个旧上限已经删掉。
  - 冻结的规格要求两个后端真的跨过 5,001 和 201（`slice-2A-SPEC.md:310`、`:329-342`；`slice-2C-SPEC.md:1289`、`:1323`；`slice-K3-SPEC.md:1500` B2-16(iii)；R-22 的 205 个 blocked Run）。
  - 提案：每个用例做一个日常的小版本，两个后端都跑，断言不变（内部页宽由组合根传入，接缝 A–H，默认值就是规格值；H（规范任务事实的 Run 查找页宽）要穿过几层签名，加不加还待定）；另在选定节点跑规模验收批。
  - 估计日常工作量少 41%–42%（5 个并行时约 28–31 分钟）。
  - 要规格补注说明规模批多久跑一次，还要用户定。
  - B2-401 是一个 Task 的 401 次重跑请求，不是 401 个 Task。有些规模 fixture 还留着手写种子（T 留下的）。
- 拆分方案在等用户决定。
