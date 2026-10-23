# 提示词和上下文：PC-1、PC-2（决定 83-4、83-5，2026-10-22 至 10-23）

**结论：** 两份都已合入：PC-1 `20f20ae2`（10-22 夜），PC-2 `fd4be391`（10-23）。规格是 10-21 冻结的
[slice-6-7-PROMPTS-SPEC](../../../design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md)，结构一轮的 D3 已先把
今天写死的文字原样搬进平台包第 1 版（[证据](../structure-round-2026-10-21/README.md)）。用户 10-22 夜说：“先合入 PC1，
……然后其他的先不做。”随后让 PC-2 一直跑：“从现在到明天早上8点钟开始跑吧，明天早上9点钟才开始考试。”10-23 考完试后说：
“合入 PC-2，然后更新文档”。

## 做了什么

| 提交 | 内容 | 文件，行数（加 / 删） |
| --- | --- | --- |
| PC-1 `20f20ae2` | **Kernel 受管补丁**（源在 `vendor/coding-agent/patches`，`scripts/build-kernel-patch.mjs` 生成 `dist`）：选上下文时，用这次执行的同一个预算计量去估最后发出的请求；行为说明和这次的任务输入不删；思考按模型只带这次执行的，或者都不带。**冻结**：准备时把整套提示词（模板、字符串表、基础提示词、Skill、工具说明，各带 digest）冻结进执行清单；平台 Skill 从 `resources/skills/platform-*` 搬进平台包的 `templates/`；入口只用冻结的文字重新渲染接续简报和审查。**发送**：预算预估和模型客户端共用一个“最终请求”的变换；开始时五个选包字段逐项比对。**记录**：Work 的许可和 Query 行带提示词事实，`readPromptRecord` 读冻结集、每次请求的记录和每份正文 | 154，12,180 / 1,124 |
| PC-2 `fd4be391` | **你的包**放在 Host 的数据目录：读盘、按继承解析、校验（`src/app/prompt-packs.ts`、`src/contracts/prompts/resolve-pack.ts`），六条只认人的设置路由（列包、建包、读写模板、读写工具说明；存时带读到的版本或 digest，对不上回 `revision_conflict`，平台包上回 `forbidden`）。**改平台工具的说明**（决定 83-5）：准备时冻结进提示词集，交给十个工具工厂，你的包没给的工具用平台的文字。**设置**：模型项的 `promptPack`、`reasoningReplay`。**平台包第 2 版**：`base` 去掉 `check` 一行，讲工具的句子放进工具块、按最终工具清单出现（校验 `mentionsTools`）；Skill、接续简报、审查和提案文字、两处重新渲染（K3 缩减、入口）用同一份冻结的工具清单；简报去掉“文件可能过时”那句。**段序**写在模板里、提醒最后，冻结进每个绑定，状态守卫（`state/context-input.ts`）核对段序和重新渲染的范围。**“文件可能过时”的提醒**在执行接 Session 历史时放在职责段末尾 | 141，18,675 / 899 |

按种类分：

| | 手写的生产代码（含平台包、脚本、Kernel 补丁源） | 生成的（平台包模块、Kernel `dist`） | 测试 |
| --- | --- | --- | --- |
| PC-1 | 3,275 / 781 | 563 / 160 | 8,342 / 183 |
| PC-2 | 3,305 / 649 | 89 / 27 | 15,281 / 223 |

比估的多。规格估 PC 一共 3,000–4,000 行；Codex 的盘点（含测试）估 PC-1 加 5,000、删 650，PC-2 加 5,090、删 1,030，
决定 83-5 再加约 650。实际手写的生产代码两份合计加 6,580 行，已经超过规格的估计；超出的大头是测试，加了 23,623 行：
每行测试都要走公开步骤、整段文字手写比对、做一次生产代码的变异（决定 80），还有联合行和冻结的夹具。DSH 在回复里也报了
各组超估（PC-1a 的 K 组约 1.85 倍，PC-1b 的 P 组约 2.3 倍）。

## 经过

时间是本地时间。每次 DSH 运行的用量见 `checks/dsh-runs.txt`。

**PC-1**

| 步骤 | 谁 | 结果 | 材料 |
| --- | --- | --- | --- |
| 盘点 | Codex 只读 | 估加 5,000、删 650（含测试） | `codex/inventories/inv-pc1.*` |
| 任务书 | lead 起草；Codex 两轮完整审查（16 条、8 条）和一次快速核对（3 条） | 都照改，冻结 | `books/pc1-book.md`、`codex/books/chk1…3.*` |
| 通读、夹具 | DSH 通读（10-22 06:32）；Codex 写 Kernel 和平台夹具，lead 核对后冻结 | | `dsh/pc1-preread-final.md`、`codex/fixtures/fx-k.*`、`fx-p.*` |
| PC-1a | DSH 三次（08:26–08:46）：k1 从冻结的 map 逐字节恢复选上下文策略的源；c1 平台包的清单；K 组（Kernel 补丁）和 C 组（契约、平台 Skill、Host 选包） | 完成 | `books/run-pc1a*.md`、`dsh/pc1a*-reply.md` |
| 审查 | Codex 三部分 | 违规 12、不整洁 5，没有会出错 | `codex/pc1a-audit1/`、`books/pc1a-findings.md` |
| 返工 1 | DSH，20 分钟（12:00–12:20） | 16 行照改，1 行驳回 | `books/run-pc1a-r1.md`、`dsh/pc1a-r1-reply.md` |
| 复核 | Codex 快速核对 | 通过 | `codex/pc1a-recheck/` |
| PC-1b | DSH，58 分钟（12:28–13:26）：P 准备和入口，S 发送，R 请求记录，最后联合步 | 完成，报了 5 个疑问 | `books/run-pc1b.md`、`dsh/pc1b-reply.md` |
| 全量 | lead（bubblewrap，5 个并行） | 789 个文件 3 个没过（5 项）；Claude 子 agent 在单独副本里查（决定 65），写成表里的 L 行 | `checks/full-pc1b.txt` |
| 审查 | Codex 四部分，另问 PC-15 的夹具够不够 | 会出错 10、违规 36、不整洁 2、建议 1；夹具够用 | `codex/pc1b-audit1/`、`books/pc1b-findings.md` |
| 返工 1 | DSH，75 分钟（18:00–19:15） | 完成；J-07 部分完成 | `books/run-pc1b-r1.md`、`dsh/pc1b-r1-reply.md` |
| 全量 | lead | 792 个文件 16 个没过（32 项），都来自 S-01：开始时逐项比对选包字段，而场景的 Work 替身没有带 Host 定的模型 id | `checks/full-pc1b-r1.txt`、`checks/lead/pc1b-r1-*-probe.*` |
| 审查 | Codex 四部分，另问 S-01 怎么修（X） | 违规 16、不整洁 7，没有会出错；X：S-01 保持严格，改场景替身 | `codex/pc1b-audit2/`、`books/pc1b-r2-findings.md` |
| 返工 2 | DSH，17 分钟（20:39–20:56） | 判 fix 的行都做了，J-07 补完 | `books/run-pc1b-r2.md`、`dsh/pc1b-r2-reply.md` |
| 审查 | Codex 一部分 | 0 条 | `codex/pc1b-audit3/` |
| 全量和规模批 | lead | 792 个文件全过，9,820 项过、3 项跳过，1,437 秒；规模批 12 个文件 38 项全过，3,287 秒 | `checks/full-pc1b-r2.txt`、`checks/scale-pc1b-r2.txt` |
| 合入 | lead | `20f20ae2`（10-22 22:20） | `checks/merge/pc1-*` |

**PC-2**

| 步骤 | 谁 | 结果 | 材料 |
| --- | --- | --- | --- |
| 盘点 | Codex 只读 | 估加 5,090、删 1,030（含测试） | `codex/inventories/inv-pc2.*` |
| 任务书 | lead 起草 v1；Codex 第一轮完整审查 17 条（7 条必须改），DSH 照 lead 的裁定改成 v2（10-22 12:00）；第二轮 9 条新的（6 条必须改），DSH 改成 v3（12:31）；快速核对后 lead 改成 v4。lead 逐行审每一版。写任务书时用户定了决定 83-5 | v4 冻结 | `books/pc2-book.md`、`books/pc2-chk*-rulings.md`、`codex/books/pc2chk*.*`、`dsh/pc2-book*-reply.md` |
| 通读、W、夹具 | DSH 通读（06:32）；W：十个工具工厂收 `texts?`（08:35）；Codex 写包和 Host 的夹具，lead 核对后冻结（`0124b54`） | | `dsh/pc2-preread-final.md`、`dsh/pc2w-reply.md`、`codex/fixtures/fx-p2.*`、`checks/lead/pc2-fixture-tc.*` |
| PC-2 | DSH 一次运行，82 分钟（22:56–00:18）：A 包的解析，H Host 的读包、路由和设置，T 文字和渲染，G 段序守卫，Q 从准备到请求，W 返工，最后联合步 | 都做完；上下文到 36 万时按交接线停下，回复已写；报了 4 个疑问 | `books/run-pc2.md`、`dsh/pc2-reply.md` |
| 全量 | lead | 821 个文件 21 个没过（69 项）。两个主要原因是任务书写错的：准备时新读了 Kernel 的历史边界，许多旧测试手写 Session 游标、没有 Kernel 存储；准备时就拒绝 Runtime 不认识的工具名，旧测试期望开始时才拒绝。lead 裁定 F1、F2，另把任务书漏列的旧测试写成 F3 | `checks/full-pc2.txt`、`books/pc2-findings.md` §1 |
| 审查 1 | Codex 七部分 | 会出错 24、违规 41、不整洁 7；lead 的表 72 行：55 改、3 驳回、8 同另一行、5 留到返工 2（要先冻结夹具）、1 拆开 | `codex/pc2-audit1/`、`books/pc2-findings.md` |
| 返工 1 | DSH，58 分钟（00:51–01:49） | 完成 | `books/run-pc2-r1.md`、`dsh/pc2-r1-reply.md` |
| 全量 | lead | 825 个文件 2 个没过（3 项）：只读命令的读次数（F4） | `checks/full-pc2-r1.txt` |
| 审查 2 | Codex 七部分；另为留下的 J-04、J-06、J-08、J-09 写四个夹具补丁 | 会出错 11、违规 17、不整洁 6；lead 落地夹具补丁（`197b4ad`），冻结表 | `codex/pc2-audit2/`、`codex/fixtures/FX*`、`books/pc2-r2-findings.md`、`checks/lead/pc2-fx-apply.*` |
| 返工 2 | DSH，41 分钟（02:16–02:57） | 完成；J2-03 和 J-06 照规则报阻塞，J-08 做了一半 | `books/run-pc2-r2.md`、`dsh/pc2-r2-reply.md` |
| 全量 | lead | 828 个文件全过，10,081 项过、3 项跳过 | `checks/full-pc2-r2.txt` |
| 审查 3 | Codex 一部分 | 生产代码没有问题；测试 5 条（会出错 1：J-06 的夹具在重新入队前没结算验证轮，工作区版本也对不上）；给了 J-06 的夹具补丁、J2-03 的确切改法、J-08 输入段的公开步骤 | `codex/pc2-audit3/` |
| J-06 夹具 | lead 落地 Codex 的补丁（`8f8a2f0`），临时冒烟测试确认“先跑完一轮再复核”能走通，连同冒烟测试和 7 个调用方文件共 117 项过（bubblewrap） | | `checks/lead/pc2-fx-j06.*`、`checks/lead/PC2-zz-lead-smoke-j06.test.ts` |
| 返工 3（最后一轮） | DSH，18 分钟（03:23–03:41） | 5 行都做了，每行一次生产变异 RED、GREEN；补记了 J-09、T2-03 的变异位置 | `books/pc2-r3-findings.md`、`books/run-pc2-r3.md`、`dsh/pc2-r3-reply.md` |
| 全量 | lead | 829 个文件全过，10,082 项过、3 项跳过，1,555 秒 | `checks/full-pc2-r3.txt` |
| 审查 4 | Codex 一部分 | 违规 1（J-06 用例用内部函数读执行清单）、不整洁 1（注释）；给补丁 | `codex/pc2-audit4/` |
| 补丁 | lead 落地（决定 81：三轮返工之后由 Codex 给补丁、lead 落地），`993dd07` | 类型检查过；两个文件带 bubblewrap 过；A3-01 的生产变异重做一遍，RED、GREEN | `codex/fixtures/FX-A4-0*.diff`、`checks/lead/pc2-fx-a4.*` |
| 规模批 | lead | 12 个文件 38 项全过，3,365 秒 | `checks/scale-pc2-a4.txt` |
| 合入 | lead | `fd4be391`（10-23） | `checks/merge/pc2-*` |

PC-1 返工两轮，PC-2 返工三轮（决定 80 的上限），之后的两处由 Codex 给补丁、lead 落地。

## 施工中定下的读法

以后的片照这些读，规格正文不改（规格加了后注）：

1. `promptSelectionOf` 收一个结构类型的参数（契约层不能引用 Core），每个 `BoundModel` 都满足；Kernel 输入的 `skills`
   是 `readonly SkillContext[]`。
2. **S-01 保持严格**：开始时五个选包字段逐项比对，准备和开始要用同一个模型绑定。生产里没有 `selection` 也能走到这个比对
   （程序化的 Host、平台注入），所以它也保护生产；场景的 Work 替身改成带 Host 定的模型 id。
3. **F1**：准备时不读 Kernel 历史。要不要接 Session 历史，只看 Session 是否存有已完成的游标，规则只有一条
   （`context-history-facts.ts` 的 `takesSessionHistoryOf`；Work：有 `sessionBasis` 的位置或有已完成的游标；Query：有
   `sessionBasis` 看它的位置，没有就看游标）。开始时照旧读真实边界，冻结的 `false` 仍然只发这一轮。
4. **F2**：Runtime 不认识的工具名、缺负责方的工具，仍在开始时拒绝（`unsupported`，在任何模型调用之前）；准备时只用
   Runtime 认识的名字算最终工具清单。
5. 足迹段在生产里仍然为空（`[]`，是以后的段）；预算省略的测试只覆盖到注记、输入等能走到的段。
6. Kernel 自带工具（read、shell 等）的说明这一轮不能改，只由每次请求的 `toolSpecsRef` 记下（决定 83-5）。

## 怎么合入

- 两份都在 DSH 副本里取 `git diff --binary`（PC-1：`pc-base..68dfb10`；PC-2：`pc1-final..993dd07`），在本工作树
  `git apply --cached`，再把文件写出、按路径提交。PC-2 逐个比对 1,797 个文件的内容，和测过的 `993dd07` 相同。
- 四个测试夹具在 DSH 副本里是 100755（lead 从 `/mnt/d` 拷进副本时带上的执行位），本仓库提交为 100644：PC-1 的
  `PC-kernel-fixture.ts`、`PC-platform-fixture.ts`，PC-2 的 `PC2-host-fixture.ts`、`PC2-pack-fixture.ts`。所以 `tests`
  的树和 DSH 副本的不一样，只差这四个权限位。**更正：** PC-1 的提交说明写“every code path's tree equals the tested DSH
  commit 68dfb10”，其中 `tests` 的树其实是内容相同、这两个权限位不同（lead 10-23 用 `ls-tree` 核过）。

## 留下的

- 副本和日志留在 WSL（`~/dsh-work/slices/s9pc1a`、`s9pc1b`、`s9pc2`、`s9pc2w`、`s9pc1b-full` 及它们的 `.dsh-ref/`、
  `.dsh-scratch/`）；Codex 的审查树在 `D:/cxt/`（`pc1a` … `pc2-r3`）。这里只收任务书、表、报告、回复、检查结果和小脚本。
- Codex 审查 4 逐行列了变异的覆盖边界（同一条规则下，哪种变异这条用例抓不到），只记下，不据此加测试
  （`codex/pc2-audit4/A.out.md` 第 2 节）。
- DSH 没有 bubblewrap，回复里报的场景失败是环境失败；lead 每次都带 bubblewrap 跑全量。
- 用量：DSH 的 PC-1 八次运行 11,470 秒、约 8,230 万 token；PC-2 八次运行（含两次任务书改稿）13,431 秒、约 1.8 亿
  token，绝大部分是缓存读取（`checks/dsh-runs.txt`）。Codex 只读：盘点两份、任务书检查六次、夹具三份加审查里的补丁、
  审查九次（PC-1a 两次、PC-1b 三次、PC-2 四次）。lead：一个 Session，中间压缩过几次；10-23 12:25 时本周额度用了 24%
  （10-22 01:20 结构一轮合入前是 21%，10-27 重置）。
