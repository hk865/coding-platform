# 编排第 0 片和 B0 的执行证据（2026-10-08）

**是什么。** 第 0 片修注意力观察里的 `[object Object]`：依赖条件按“种类:标签”写进边的字符串（`src/app/attention-observer.ts` 第 504 行，一个表达式），加 3 个用例。规格和任务书：[slice-0-SPEC](../../../design/orchestration-2026-10/slices/slice-0-SPEC.md)、[第一段](../../../design/orchestration-2026-10/slices/slice-0-book-part1.md)、[第二段](../../../design/orchestration-2026-10/slices/slice-0-book-part2.md)。B0 是 lead 自己做的一次声明：`module-target.json` 加 `views` 子模块和 `configuration → state`，建 `src/core/work-graph/views/README.md`（[slices/README](../../../design/orchestration-2026-10/slices/README.md)“顺序”第 2 条）。

**提交**（`feat/reliability-and-structure`，没有推送）：

| 步 | 提交 | 内容 |
| --- | --- | --- |
| 第 0 片 | 21a99915 | `attention-observer.ts` 改 1 行；新测试 `tests/app/S0-attention-edge-label.test.ts`（3 个用例） |
| B0 | 48c8d473 | `module-target.json` +20/−1；`views/README.md` 3 行。它是第 1、3、5 片副本的共同基线（HB） |

## 结论

- DSH 两段都一次过：第一段写 3 个用例，按规格的理由失败（S0-01 拿到 `depends:t1->t2:[object Object]`，S0-02、S0-03 拿到 `changedElements: 0`）后停下；lead 对着规格 §5 的表逐行核过，没有要改的，冻结（sha256 `c25de89d…1899`）。第二段同一 Session，diff 恰好是第 504 行那一个表达式。没用到带指导的返工轮，没碰到上限。
- Codex（推理强度 high，只读）审了结果：0 条问题。lead 核了它引用的事实（`requires` 必填、codec 校验种类和标签、只有比较字符串的地方受影响、`git grep` 里 `depends:` 只在这一行）。
- 本分支上（WSL 槽位 s1）：类型检查、模块边界检查通过；S0 和 orchestration-mechanism 两个文件 18 项全过。B0 前后模块边界检查的数字只多了 `WorkGraph/views: sourceFiles=0`，`tests/architecture` 3 个文件 52 项前后都过。
- 没有调用真实模型（DSH 用 headless 的 deepseek-flash，审查用 Codex）。

## DSH 的两次运行

| 运行 | 墙钟 | token（主 Session） | 工具调用 / 步数 | 上下文：开始 → 峰值 | 子任务 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| p1（写测试后停） | 89 秒 | 447,303 | 20 / 13 | 1.2 万 → 4.8 万 | 无 | 正常结束 |
| p2（实现，同一 Session） | 50 秒 | 482,562 | 8 / 9 | 5.1 万 → 5.6 万 | 无 | 正常结束 |
| 合计 | 139 秒 | 929,865 | 28 | — | — | — |

上下文 = 每一步的输入 + 读缓存 + 写缓存，从运行事件里算（运行器当时还不记 `peakContext`）。p1 的 `scan.json` 标了 `attempted-outside`，唯一的命中是测试文件里的 import 字符串 `'../../src/app/attention-observer.js'`，是已知的误报（DSH-WORKFLOW §6.6 第 7 条）。

## lead 的用量（决定 43）

| 谁 | 墙钟 | token | 工具调用 |
| --- | --- | --- | --- |
| DSH | 139 秒 | 93 万 | 28 |
| Codex 审查（high） | 226 秒 | 输入 117 万（其中 108 万走缓存），输出 6,587 | — |
| lead（含 B0 和一次性的运行器副本、建副本脚本） | 约 22 分钟（15:04–15:26） | 约 1,173 万（会话记录累计，绝大部分是读缓存） | 78 |

lead 的 22 分钟里约 10 分钟在等（DSH 2.5 分钟、Codex 4 分钟、检查 4 分钟）。第 0 片太小，按设计书 §8.2，用它比 DSH 和 lead 的分工不够有代表性。

## 本目录

- `books/`：发给 DSH 的两段任务书（`s0-p1.md` 和仓库里的第一段相同；`s0-p2.md` 填好了冻结 sha256 和“没有更正”）。
- `dsh/p1/`、`dsh/p2/`：运行器的 `run.json`、`scan.json`、`git-status.txt` 和 DSH 的回复 `final.md`。
- `codex/`：审查说明和结果。
- `checks/`：副本的 `DSH-BASELINE.md`（沙箱里没有 `/usr/bin/bwrap`，orchestration-mechanism 有 1 项已知环境失败）、两段之后 lead 的测试输出。
- `notes/s0.md`：lead 的笔记原文（运行器副本、建副本的做法、B0 的检查）。
