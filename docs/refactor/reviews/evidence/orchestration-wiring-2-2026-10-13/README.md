# 接线包 2 的执行证据（2026-10-13 至 10-14）

**是什么。** [wiring-2-SPEC](../../../design/orchestration-2026-10/slices/wiring-2-SPEC.md)：把第 5 片留下的四处接上——自动推进（I-2）、自治级别和请知悉进入准备好的上下文（I-4、I-5）、未送达回复的提醒和通知（I-6），并给 Session 加 `unavailableSince`、给回复加 `responseSince` 两个位置（R、P），未送达回复的通知按 `max(R, P)` 排序。规格 §9.1 记了合入时 lead 的更正和限定。

**结果。** 验收通过，按决定 44 合入本分支（提交见本目录所在的提交）。在 WSL 里用真 bwrap 跑全量全部通过（第 5 轮之后的数见 `checks/`）；类型检查、模块边界、构建通过。没有调用真实模型。

## 经过

DSH 五个新 Session；Codex 审规格一次、分类旧测试一次、审实现三次。

| 轮 | 说明书 | DSH 报告 | 之后的 Codex | 要点 |
| --- | --- | --- | --- | --- |
| 1 | `books/w2-impl.md` | 没有（跑满 120 分钟被停下，lead 当场核了状态：28 个路径、WP2 71 项通过） | — | 测试和实现的第一版 |
| 2 | `books/w2-impl-2.md` | `dsh/final-2.md` | `codex/w2implrev.out.md`（不能合入，6 处生产缺陷） | 全部 29 行；lead 翻转两处旧断言（RT08 用第二次到期；`decision_answered` 的 `responseSince`） |
| 3 | `books/w2-impl-3.md` | `dsh/final-3.md` | `codex/w2implrev2.out.md`（改完测试再合入） | 6 处生产缺陷修好（lead 先用工作流逐条核实）；lead 重新冻结 4 个旧测试和场景框架的补充 |
| 4 | `books/w2-impl-4.md` | `dsh/final-4.md` | `codex/w2implrev3.out.md`（改完测试再合入） | 测试证据 6 条；唯一的生产改动：DTO 的来源 Session 和目录推出的来源不一致时拒绝（规格 §9.1 第 1 条） |
| 5 | `books/w2-impl-5.md` | `dsh/final-5.md` | lead 验收（最后一轮，只改测试） | 生产代码和第 4 轮逐字节相同（`git diff slice-base -- src` 的 sha256 相同）；WP2 100 项通过 |

`books/TEST-RUBRIC.md` 是审测试的口径；`codex/w2specrev.*` 是冻结前的规格审查，`codex/w2classify.*` 是旧测试的分类；`checks/frozen.sha256` 是冻结的测试侧文件。

## lead 的验收判断

第 5 轮的说明（`dsh/final-5.md` UNSPECIFIED）都接受，写进规格 §9.1：Query 回答的写入方没有公开入口能走到它的回执重放；Query 恢复的正例要先起 Query、执行中再存回复；F11 用测试辅助里的确定 id 来源（生产不变，测试断言命令返回的就是写死的 id）；F07 第一页的候选经冻结夹具的真实编解码和存储写入（`proposePlan` 的 id 是哈希，排不出写死的顺序）。临时的 5,000 条、50 页上限不再加测试：2A 撤掉它们（2A 规格 §0.4），对应边界由 2A 翻转。
