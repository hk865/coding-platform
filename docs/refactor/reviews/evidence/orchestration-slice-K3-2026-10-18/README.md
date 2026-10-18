# K3 的执行证据（2026-10-18）：结果未知的调用按种类核对、拦下的命令请求重跑、重启后收尾

**是什么。** [K3 片规格](../../../design/orchestration-2026-10/slices/slice-K3-SPEC.md)（第八稿，2026-10-16 冻结）：
- **按种类核对：** 只读不核对；平台工具按请求号查回执；改文件的附 git diff；跑程序的先开一轮只读核对轮。核对轮写已做／没做／做了一半／判断不了，并单独自查“这条命令会不会就是崩溃原因”。
- **要人确认：** 做了一半、判断不了、自查是可能或判断不了、同一任务连续第二次、目标是“每步确认”，都出“请你决定”。UCR 处置卡四个选项：照原样重跑、换稳妥跑法、跳过当作已做、我来处理。
- **重启后收尾：** 新 Host 凭实例租约证明旧进程不在，自动收尾；同一任务连续只一次，只限 git 工作区且改动采集得到。其余照今天等人认定。
- **拦下的命令可请求重跑（决定 57、68）：** 平台按静态解析认常见改写（`bash -c`、环境变量前缀、包脚本、`npx`、分隔符）；认不出的由 agent 用 `rewriteOf` 注明。跳过以后要再跑，先请求并得到允许；允许只放行卡上那一种写法。
- **记录和卡：** 核对记录 UCR 和请求重跑记录 CRR 各有状态机、编解码、卡来源和公开读。UCR 还有 hold/release；CRR 没有，答复选项是 `allow_rerun`／`deny`／`deny_final` 三个。创建和可选文字按序列化字节准入。
- 验收行 K3-01–K3-49、B2-01–B2-18，以及 §5.3 的旧测试改动；施工和返工中定下的读法见规格 §10。

**结果。** 已合入（2026-10-18，代码 `d3146d69`；补做 K3-07、K3-49 `5e83681b`）。合入时的全量：最终树（K3 代码 `d3146d69` 加补做 `5e83681b`；WSL、bubblewrap、systemd 用户会话、5 个并行、scope 6G）：771 个测试文件全过，10,082 项过、5 项跳过，2,787 秒，测试 scope 峰值 5.28 GB；类型检查、模块边界检查、构建都是 0（`checks/merge-full-suite-summary.txt`）。没有调用真实模型。

## 经过

用量只计 DSH 主会话，子 agent 的没有单独统计。秒、token、上下文峰值取自 `checks/dsh-runs.txt`；token 以百万计。“审查和核对”里，“必须改”按那份回复里标“必须改”的条数记；核对行写结论或行数，同一轮的多份审查看合并的要点。

| 组 | 轮 | 说明书 | 报告 | 用时、token、峰值 | 审查和核对 | lead 的检查 | 要点 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 通读 | `books/k3-g1-preread.md` | — | 195 秒、6.60M、180,128 | — |—| 4 个问题；U1–U8 的读法 |
| 1 | 施工 | `books/k3-g1-impl.md` | — | 1,158 秒、44.80M、364,137 | — |—| 契约、state、R5；在 360,000 的上下文上限停下，树未提交 |
| 1 | 施工续 | `books/k3-g1-impl-2.md` | — | 731 秒、6.69M、140,229 | — |—| 修 5 个类型错、允许清单、覆盖；3,867／3／29；打 tag `k3-g1` |
| 2 | 通读 | `books/k3-g2-preread.md` | — | 172 秒、4.76M、142,471 | — |—| Q1–Q6；候选、查找、草稿、连续、Session 事实、旧测试 |
| 2 | 施工 a | `books/k3-g2-impl.md` | `dsh/k3-g2a-final.md` | 2,596 秒、63.96M、339,414 | — |—| 编解码、草稿、采集、开始基准、查找、RUN-25；4,320／13／29；真实 Host 还走不通 |
| 2 | 施工 b | `books/k3-g2-impl-2.md` | `dsh/k3-g2b-final.md` | 2,379 秒、59.01M、338,142 | — | bwrap：122 过、2 跳过；WP1-handover 9/17 失败（夹具没注册 review schema） | 连续、G7、事件、Host 接线、K3-21–24、K3-48；+381；3 例未闭合 |
| 2 | 施工 c | `books/k3-g2-impl-3.md` | `dsh/k3-g2c-final.md` | 6,049 秒、20.76M、247,669 | `codex/k3g2-impl-review.out.md`：9 条 | bwrap：28 个文件，227 过，1 跳过（A2 的 review_round 留给第 3 组） | 接缝、R1、L6、收尾；+875；4,399／22／30、109 个文件 |
| 3 | 通读 | `books/k3-g3-preread.md` | `dsh/k3-g3-preread-final.md` | 249 秒、4.61M、130,620 | — |—| 工具、核对轮、卡和恢复的读法 |
| 3 | 施工 1 | `books/k3-g3-impl.md` | `dsh/k3-g3a-final.md` | 9,711 秒、21.70M、239,258 | `codex/k3g3a-review.out.md`：10 条 | bwrap：83 个文件，4,271 过，1 失败（K3-R1-second-cleanup） | 记录 owner、核对轮、结算；工具、准入、上下文 |
| 3 | 施工 2 | `books/k3-g3-impl-2.md` | `dsh/k3-g3b-final.md` | 5,967 秒、10.99M、214,751 | `codex/k3g3b-review.out.md`：5 条 | bwrap：90 个文件，4,344 过，0 失败 | R1–R5 的裁定；L4 查找、L5、L6、卡和恢复 |
| 3 | 施工 3 | `books/k3-g3-impl-3.md` | `dsh/k3-g3c-final.md` | 2,976 秒、8.33M、182,250 | `codex/k3g3c-review.out.md`：5 条 |—| 工具回执、绑定、核对轮只读 |
| 3 | 施工 4 | `books/k3-g3-impl-4.md` | `dsh/k3-g3d-final.md` | 2,484 秒、10.12M、200,831 | `codex/k3g3d-review.out.md`：2 条 | — | 多条目记录、双后端；两条必须改 |
| 3 | 施工 5 | `books/k3-g3-impl-5.md` | `dsh/k3-g3e-final.md` | 1,106 秒、2.08M、97,264 | `codex/k3g3e-review.out.md`：1 条 |—| K3-13、K3-42、K3-35、K3-19 的真实链 |
| 3 | 施工 6 | `books/k3-g3-impl-6.md` | `dsh/k3-g3f-final.md` | 256 秒、0.99M、56,205 | — |—| 收尾；K3-R1-second-cleanup |
| 4A | 通读 | `books/k3-g4a-preread.md` | — | 330 秒、5.50M、146,165 | — |—| L7 表、门槛、启动 2b／6b 的 1–2 种 |
| 4A | 施工 | `books/k3-g4a-impl.md` | `dsh/k3-g4a-final.md` | 6,775 秒、25.70M、322,978 | `codex/k3g4a-review.out.md`：8 条 | `checks/verify-k3g4a.md` | 每个领取入口都拦、hold/release、启动恢复；真实 Host |
| 4A | 返工 1 | `books/k3-g4a-rework.md` | `dsh/k3-g4a-rework1-final.md` | 4,387 秒、12.32M、177,867 | `codex/k3g4a-review2.out.md`：3 条 |—| 读失败算 `unreadable`、释放进 `finally`、旧断言 |
| 4A | 返工 2 | `books/k3-g4a-rework-2.md` | `dsh/k3-g4a-rework2-final.md` | 1,686 秒、6.85M、138,093 | `codex/k3g4a-review3.out.md`：0 条 |—| 修完；判可以合入 |
| 4B1 | 通读 | `books/k3-g4b1-preread.md` | — | 364 秒、17.06M、228,614 | — |—| 卡、处置、UR7／UR7b、启动 6b 的 3–4 种 |
| 4B1 | 施工 | `books/k3-g4b1-impl.md` | `dsh/k3-g4b1-final.md` | 4,820 秒、39.51M、353,778 | `codex/k3g4b1-review.out.md`：8 条必须改＋1 条建议 | bwrap：239 个文件，5,156 项过 | 卡、处置、落实、恢复 |
| 4B1 | 返工 1 | `books/k3-g4b1-rework-1.md` | `dsh/k3-g4b1-rework1-final.md` | 2,499 秒、11.81M、219,766 | `codex/k3g4b1-review2.out.md`：5 条 | bwrap：239 个文件，5,170 项过 | ② 的 Goal 守卫、失败集合、作用对象行 |
| 4B1 | 返工 2 | `books/k3-g4b1-rework-2.md` | `dsh/k3-g4b1-rework2-final.md` | 1,531 秒、6.47M、161,565 | `codex/k3g4b1-review3.out.md`：1 条 |—| 失败集合跨步保留 |
| 4B1 | 返工 3 | `books/k3-g4b1-rework-3.md` | `dsh/k3-g4b1-rework3-final.md` | 1,282 秒、4.12M、117,341 | `codex/k3g4b1-review4.out.md`：1 条 |—| 失败集合不能由调用方伪造 |
| 4B1 | 返工 4 | `books/k3-g4b1-rework-4.md` | `dsh/k3-g4b1-rework4-final.md` | 1,659 秒、4.72M、111,863 | `codex/k3g4b1-review5.out.md`：0 条 | bwrap：241 个文件，5,180 项过 | 公开边界、寿命、真实卡；判可以合入 |
| 4B2 | 通读 | `books/k3-g4b2-preread.md` | — | 391 秒、12.97M、173,804 | — |—| 方案轮、K3-16／35／46／48 |
| 4B2 | 施工 | `books/k3-g4b2-impl.md` | `dsh/k3-g4b2-final.md` | 2,864 秒、17.78M、233,327 | `codex/k3g4b2-review.out.md`：6 条 |—| 方案齐全不掩盖第二次未完成、命令来源；+547/−109，7/7 |
| 4B2 | 返工 1 | `books/k3-g4b2-rework-1.md` | `dsh/k3-g4b2-rework1-final.md` | 3,070 秒、12.59M、228,861 | `codex/k3g4b2-review2.out.md`：2 条 |—| 第二次未完成、5,120／5,121 边界 |
| 4B3 | 通读 | `books/k3-g4b3-preread.md` | `dsh/k3-g4b3-preread-final.md` | 402 秒、11.72M、189,296 | — |—| 拦命令、识别、请求、卡 |
| 4B3 | 施工 | `books/k3-g4b3-impl.md` | `dsh/k3-g4b3-final.md` | 3,384 秒、24.98M、307,945 | `codex/k3g4b3-review.out.md`：12 条 | bwrap：325 个文件，5,764 过（含两条 A8-3n） | B2 的剩余和 L19a；9/9，+4,155/−139，40 个测试文件（25 个新）；超软上限（1,400） |
| 4B3 | 返工 1 | `books/k3-g4b3-rework-1.md`、续 | `dsh/k3-g4b3-rework1-final.md` | 3,543 秒、16.92M、273,727（exit 1）＋804 秒、3.37M、285,514 | `codex/k3g4b3-review2.out.md`：6 条 |—| 绑定截断、识别排序、关闭事实、分页；+1,359/−828（净 +531） |
| 4B3 | 返工 2 | `books/k3-g4b3-rework-2.md`、续 | `dsh/k3-g4b3-rework2-final.md` | 1,475 秒、4.07M、209,915 | `codex/k3g4b3-review3.out.md`：7 条 | — | 一次调用读一次、B2-18、K3-35 |
| 4B3 | 返工 3 | `books/k3-g4b3-rework-3.md` | `dsh/k3-g4b3-rework3-final.md` | 3,847 秒、19.76M、267,697 | `codex/k3g4b3-review4.out.md`：5 条 | bwrap 检查：3 个 K3-35 钩子超时 | 共享入口、31 个 starts、closed 竞态 |
| 4B3 | 返工 4 | `books/k3-g4b3-rework-4.md` | `dsh/k3-g4b3-rework4-final.md` | 3,880 秒、19.03M、268,056 | `codex/k3g4b3-review5.out.md`：6 条 | bwrap 检查：3 个 K3-35 钩子超时 | 夹具仍自行开库、closed 分支、清理 |
| 4B3 | 返工 5 | `books/k3-g4b3-rework-5.md` | `dsh/k3-g4b3-rework5-final.md` | 3,700 秒、26.53M、287,019 | `codex/k3g4b3-review6.out.md`：6 条 | bwrap 全量（5 workers）：3 个 K3-35 钩子超时 | 内存世界接不上 Host；几条只跑 SQLite |
| 4B3 | 返工 6 | `books/k3-g4b3-rework-6.md`、两次续 | `dsh/k3-g4b3-rework6-final.md` | 216 秒、0.14M、26,401（exit 1）＋4,420 秒、7.78M、194,643（exit 1）＋2,205 秒、11.33M、249,663 | `codex/k3g4b3-review7.out.md`：4 条 | — | 真实草稿、真实认定、双后端 |
| 4B3 | 返工 7 | `books/k3-g4b3-rework-7.md`、续 | `dsh/k3-g4b3-rework7-final.md` | 154 秒、0、0（exit 1）＋2,425 秒、40.89M、292,694 | `codex/k3g4b3-review8.out.md`：5 条（含 UNSPECIFIED 2） | — | 台账、事实、Host 草稿；仍判不能合入 |
| 4B3 | 返工 8 | `books/k3-g4b3-rework-8.md`、三次续 | `dsh/k3-g4b3-rework8-final.md` | 213 秒、0.32M、51,077（exit 1）＋3,134 秒、17.32M、261,352（exit 1）＋89 秒、0、0（exit 1）＋1,680 秒、3.22M、273,304 | — | — | 第 8 轮；之后按决定 80 改全审 |
| 4B3 | 决定 80 全审 | `books/k3-b3-rulings-v1.md`、`checks/test-rule-sheet-v3.md` | `codex/k3-audit-*.out.md`、`codex/k3-merge.out.md` | — | 102 行（F-001–F-102） | — | 生产 26（6 行为、20 整洁）、测试 76（20 缺保护、56 写法）；合计 102 行；冻结后最多三轮 |
| 4B3 | 返工 9a | `books/k3-g4b3-rework-9.md` | `dsh/k3-g4b3-rework9a-final.md` | 2,159 秒、19.54M、252,132 | — | — | 业务行；台账、假守卫 |
| 4B3 | 返工 9b（返工 1） | `books/k3-g4b3-rework-9b.md` | `dsh/k3-g4b3-rework9b-final.md` | 4,532 秒、23.87M、296,634 | `codex/k3-verify9.out.md`：67 行（核 9a＋9b） | `checks/r9b-full-suite.txt`、`checks/k3-mutation-r9b.txt` | 45 修好、22 部分；范围内 17 条缺保护＋F-102；形式行进 T；全量 29/712 个文件、122 项失败 |
| 4B3 | 返工 10（返工 2） | `books/k3-g4b3-rework-10.md` | `dsh/k3-g4b3-rework10-final.md` | 2,773 秒、11.80M、232,858 | `codex/k3-final-list.out.md`、`k3-final-recheck.out.md` | `checks/r10-full-suite.txt`：716 个文件全过，9,559 过、5 跳过，2,834.25 秒，峰值 4,945,887,232 字节 | 回归修复；DSH 沙箱 375 文件子集：6,134 过、68 失败（全缺 bwrap）、29 跳过；最终表 1 条缺保护 N-01 |
| 4B3 | N-01 测试补丁 | `checks/k3-final-freeze.md` | `codex/k3-n01-patch.out.md`、`k3-n01-fix.out.md`、`checks/k3-n01-check.txt` | — | — | `checks/k3-n01-check.txt` | 第二次通过；4/4 过，变异 M1 在写明的两条断言上失败 |
| 合入 | 解冲突 | `books/k3-merge-book.md` | `dsh/k3-merge-final.md` | 934 秒、8.86M、186.61k | — | `checks/merge-stat.txt`、`checks/k3-merge-overlap.txt` | 355／359 个文件干净合入；4 个文件 13 块；typecheck、边界、build 0；非 bwrap 失败 12 项是 L8 的 `materials` 漂移 |
| 合入 | Codex 合入检查 | `codex/k3-merge-check.prompt.md` | `codex/k3-merge-check.out.md` | — | 13 块全对、11 个干净合入文件全对、启动顺序和租约（决定 82）全对、lead 的 materials 修复全对 | — | 1 条必须改 M1：三处 K3 prepare 读取把明确的 `cancelled` 变成“没有事实” |
| 合入 | lead 修复＋Codex 测试补丁 | `codex/k3-mfix-tests.prompt.md` | `codex/k3-mfix-tests.out.md` | — | `checks/k3-merge-fix.diff`：生产改动约 30 行；新例 T1／T2／T3／T3b，memory 和 SQLite；与 L8 的 `sessionBasisForContext`／`briefWorkspaceFactsFor` 同型 | `checks/k3-mfix-check.txt`：一次通过；未变异 24/24；M-F1／M-F2／M-F3／M-F3b 各只让自己的行在两种后端、写明的断言上失败；T3b `expected 1 to be +0`（基准写入数） | 新文件 `tests/runtime/K3-merge-cancel-propagation.test.ts`；非取消失败保留今天的兜底 |
| 合入 | 全量 | — | — | — | — | `checks/merge-full-suite-summary.txt` | 未加 M1 修复的合并树：769 个文件全过，10,067 项过、5 项跳过，2,670 秒，峰值 5.33 GB；最终树见下一行 |
| 补做 | K3-07、K3-49／L31b | `books/k3-x07-book.md` | `dsh/k3-x07-final.md` | 1,025 秒、6.78M、154,838 | — | `checks/merge-full-suite-summary.txt`、`checks/k3-makeup-check.txt` | 两行从没进任何一组的书（lead 的漏项）；最终树全量 771 个文件全过，10,082 项过、5 项跳过，2,787 秒，峰值 5.28 GB；lead 补一行（systemctl 退出 5 不记失败）后单跑 23/23，补做后新留的空单元 0 个 |
| 文档 | 起草、修正 | `books/k3-docs.md`、`books/k3-docs-fix.md` | `dsh/k3-docs-final.md`、`dsh/k3-docs-fix-final.md` | 420 秒、23.68M、329,631＋776 秒、38.54M、360,631 | `codex/k3-docs-facts.out.md`：40 条；`k3-docs-recheck.out.md`：另 6 条；`k3-docs-recheck2.out.md`：40 条全修 | lead 逐行审，改了另 6 条，填提交号和全量 | — |

第 4 组整体是四段：g4a，以及 g4b 里的 g4b1、g4b2、g4b3。g4b 由最初的两段改为三段（`books/k3-g4b-rulings.md:3–9`）。

合计（`checks/dsh-runs.txt`，不含规格改稿的 4 次）：**48 次运行，113,656 秒（约 31.6 小时）、714,241,236 token，上下文峰值 364,137。** 另有补做 1 次（1,025 秒）和写文档 2 次（1,196 秒），不计入这个合计。 第 1 组第一次运行在 360,000 的上下文上限停下。

## 规模

按 `checks/merge-stat.txt`（对 lead 分支）：**生产 117 个文件 +17,935/−704；测试 242 个文件 +50,467/−147；全部 359 个文件 +68,402/−851。** 合入提交 `d3146d69` 是 360 个文件 +68,670/−851（多出的是 M1 的修复和 Codex 的新测试文件）；补做提交 `5e83681b` 是 10 个文件 +1,042/−6（其中 Kernel 生成物 4 个，只由 `scripts/build-kernel-patch.mjs` 生成）。

分轮回报不是同一口径：第 1 组、第 2 组按施工时的软行数报（第 2 组约 3,695 行，软上限 2,000）；第 4 组 B3 的生产代码约 4,155 行，对施工书的 1,400 行软上限。最终数按合入的树重算。没有为凑预算删必需逻辑；多出来的是核对轮、卡和恢复、L19a 的解析和请求、双后端和真实 Host 的验收带来的。

## 决定 75、80、80-6、81 怎样改变了轮次

- **决定 75（返工标准）：** 做完、整洁、可读、不出错；返工不设固定轮数，直到复核没有必须改。B3 因此先返工 8 轮，第 8 轮仍不能合入。
- **决定 80（一次全审）：** 起因是 B3 的 8 轮：必须改 75 条，生产 17 条都在返工 2 之前，测试 58 条每轮 5–9 条一直不降。改成 Codex 一次读完、lead 冻结 F-001–F-102 的表、每轮跑 D1 账本和纯测试守卫、最多三轮返工。B3 的全审分 9 路，范围是 B3 改过的 91 个测试文件、24 个 helper，加上调用违规 helper 的文件；第 1–3 组 B3 没动的文件进 T。
- **决定 80-6（只做业务行）：** 把 102 行按业务后果分成会出错、缺保护、只是写法、没有可见后果。K3 生产 26 行里 6 行有行为后果（含后加的 F-102），20 行整洁；测试 76 行里 20 行缺保护、56 行只是写法。用户两次选“只做业务相关的”：返工 9b 只做 17 条缺保护加 F-102，写法行进 T。
- **决定 81（三轮上限）：** 从决定 80 的冻结起算，DSH 最多返工三轮；返工 2 之后 Codex 全列一次，lead 冻结为最终表。9a+9b 是返工 1，第 10 轮是返工 2；最终表只有 1 条缺保护 N-01、没有“会出错”行，所以不开返工 3，N-01 交 Codex 写测试补丁。第二次补丁通过，冻结变异 M1 让新例在 `waiting`／`next: null` 和准确原因上失败；D1 本轮 0 条。

## 材料里的更正

本节每一条都留两份原始来源，再写采用的读法；只保留 Codex 的 #4 和 #10 两条。

- **K3-35 的 T=600 不是同一个总数：** 材料里早先的 16,385（`dsh/k3-g4b2-rework1-final.md:21`）和 16,393（`dsh/k3-g4b2-final.md:17`）是不同轮次的口径；纯极值测试的必需段是 16,396＝16,384＋12（`tests/runtime/K3-35-renderer-boundary-pure.test.ts:291–304`）；真实单条路径的 T=600 是 12,764（`tests/runtime/K3-35-T-by-hand.test.ts:25–45`）。两个口径分开记，不取一个历史值当统一最终总数。
- **B3 第 9b 轮的全量：** book 10 §2 写 122 项失败来自 20 个 K3 文件加 9 个外部文件（`books/k3-g4b3-rework-10.md:25–29`）；第 10 轮回复写“外面 20 个、41/41”，但没给名单，口径不明（`dsh/k3-g4b3-rework10-final.md:24`）。保留这个差异，不声称两者是不同集合；验收看两份原始全量：9b 的 712 个文件里 29 个失败（`checks/r9b-full-suite.txt`），第 10 轮 716 个文件全过（`checks/r10-full-suite.txt`）。

## lead 的验收判断和已知限制

见 `lead-acceptance.md`。
