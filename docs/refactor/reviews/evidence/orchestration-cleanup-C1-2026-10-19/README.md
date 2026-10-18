# C1 清理第一轮的执行证据（2026-10-19）

**是什么。** 决定 70 的第一轮：把 `src/core/work-graph` 里重复的小工具、同一处抄了几份的服务代码合并，删掉施工经过的注释。行为不变：错误码、错误文字、检查顺序、字段存在性、列表顺序、每次调用读存储的次数和存下的字节都不变；测试和断言一条没改，production-reach 允许清单只删了三条声明已不存在的条目（裁定 13）。五组：

- **G1 公共基础：** 字段检查原语、规范 JSON、四种拒绝结果、依赖边编号、事件外壳和事件校验、存储失败映射，放在 `src/contracts/` 和 `persistence/`。
- **G2 Session／通信／配置：** 三个 Session 服务的可信上下文和写请求隔离、Session 链接读取、两个工作区设置服务的公共读、邮箱分页、决定来源读取。
- **G4 task 服务和 Runtime 接线：** task 的可信上下文、TaskPhaseFacts、等待环检查、终态候选选择，接上 G1 的编号和失败映射。
- **G5 状态／类型／task codecs／K3 owner：** state 和 model 的类型只留一份声明、递归引用比较、注意力枚举、N12 的 owner 单条读取。
- **G3 视图／查询／注记／架构：** 活动读取的三个读取器共用一份辅助、注记失败映射、VW-5 的视图调用方、注记和查询的原语接线、架构图和文件图共用一个游标编码函数、注记和架构的事件编码器接上共用外壳。

新增 13 个共用模块：`contracts/core/rejections.ts`、`contracts/input-declaration-id.ts`、`persistence/event-envelope.ts`、`persistence/event-validation.ts`、`sessions/trusted-context.ts`、`sessions/session-links.ts`、`configuration/workspace-settings-reads.ts`、`tasks/trusted-context.ts`、`tasks/task-phase-facts.ts`、`tasks/owner-record-read.ts`、`views/activity-read-helpers.ts`、`notes/store-failures.ts`、`state/ref-equality.ts`。没有新增能力，没有新路由。

说明书 `books/c1-book.md`（v2，经 Codex 两次核对）；清单 `books/2026-10-16-cleanup-list.md`；逐组裁定和 lead 的修在 `books/c1-lead-rulings.md`；验收判断在 `lead-acceptance.md`。

**结果。** 已合入（2026-10-19，commit `35b5f5b1`）。合入时的全量：771 个测试文件全过，10,082 项过、5 项跳过（`checks/final-full-suite.txt`）。没有调用真实模型。

## 经过

用量按 `checks/dsh-runs.txt`（各次运行的 `run.json`）记：秒、token、上下文峰值；token 以百万计。“Codex”一列是这一轮的审查和它的会出错／不整洁条数；返工后的快速核对另写。

| 组 | 轮 | 说明书 | 报告 | 用时、token、峰值 | Codex | 返工 | lead 的修 | 要点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G1 | 施工 | `books/c1-run-g1.md` | `dsh/c1-g1-final.md` | 1,439 秒、8.69M、160,308 | `codex/c1-g1-review.out.md`：0 会出错／6 不整洁 | — | 3 文件 +10/−4（只注释；`checks/c1-g1-leadfix.diff`） | +686/−898（1,584）；没有拆 G1a/G1b（裁定 1） |
| G2 | 施工 | `books/c1-run-g2.md` | `dsh/c1-g2-final.md` | 2,630 秒、17.69M、250,696 | `codex/c1-g2-review.out.md`：1 会出错／3 不整洁 | 返工 1：`books/c1-g2-rework-1.md` → `dsh/c1-g2-rw1-final.md`，816 秒、3.90M、120,484；快速核对 `codex/c1-g2-recheck.out.md`：1 会出错（返工带进来的）、0 不整洁 | 2 文件 +8/−11（`checks/c1-g2-leadfix.diff`） | +1,272/−1,805（3,077）；纯改名保留（裁定 2） |
| G4 | 施工（第一次） | `books/c1-run-g4.md` | — | 没有 `run.json`；10-19 00:00–00:07 被杀 | — | — | — | 五个子 agent 同时跑 `tsc`，越过 8 GB（裁定 5）；部分改动留在 `checks/c1-g4-killed-partial.diff` |
| G4 | 施工（重跑） | 同上 | `dsh/c1-g4-final.md` | 2,061 秒、7.56M、144,359 | `codex/c1-g4-review.out.md`：1 会出错／3 不整洁 | 返工 1：`books/c1-g4-rework-1.md` → `dsh/c1-g4-rw1-final.md`，1,842 秒、8.52M、139,265；快速核对 `codex/c1-g4-recheck.out.md`：0 会出错、1 不整洁（只在回复里） | 3 文件 +4/−5（scope + R10 标签；`checks/c1-g4-leadfix.diff`） | +452/−682（1,134） |
| G5 | 施工 | `books/c1-run-g5.md` | `dsh/c1-g5-final.md` | 3,490 秒、15.66M、196,517 | `codex/c1-g5-review.out.md`：0 会出错／3 不整洁 | — | 5 文件 +18/−26（`checks/c1-g5-leadfix.diff`） | +419/−776（1,195；合并时改回 `TaskClaimOutbox` 后） |
| G3 | 施工 | `books/c1-run-g3.md` | `dsh/c1-g3-final.md` | 1,581 秒、5.96M、167,494 | `codex/c1-g3-review.out.md`：0 会出错／2 不整洁 | — | 3 文件 +5/−5（只注释；`checks/c1-g3-leadfix.diff`） | +1,162/−1,657（2,819） |
| 合并 | 五组合在一起，全量 | — | `checks/merge-check.txt`、`checks/final-full-suite-1.txt` | — | — | — | 2 处（`checks/c1-merge-fixes.diff`）：`TaskClaimOutbox` 改回 G5 的写法；允许清单删三条已不存在的条目 | 第一次全量 769/771 个文件过；修后重跑见 `checks/final-full-suite.txt`（验收裁定 12–14） |

合计（`checks/dsh-runs.txt`）：**7 次有 `run.json` 的运行，13,859 秒（约 3 小时 51 分）、67,973,866 token，上下文峰值 250,696；另 1 次被杀，没有 `run.json`。** Codex 共 11 次：清单的刷新 1、delta 1、书检查 2、五组审查 5、返工后快速核对 2（10-16 清单本身的 6 路审查不计）。

## 规模

按 `checks/group-stat.txt`，对 `c1-base`（`5e83681b`）：**152 个 `src` 文件，+3,991/−5,818，改动 9,809 行，净减 1,827（含合并时的两处修复；另外允许清单删 18 行）。** 按组（最终）：

| 组 | 新增 | 删除 | 改动 | 净 |
| --- | ---: | ---: | ---: | ---: |
| G1 | 686 | 898 | 1,584 | −212 |
| G2 | 1,272 | 1,805 | 3,077 | −533 |
| G4 | 452 | 682 | 1,134 | −230 |
| G5 | 419 | 776 | 1,195 | −357 |
| G3 | 1,162 | 1,657 | 2,819 | −495 |
| **合计** | **3,991** | **5,818** | **9,809** | **−1,827** |

决定 70 估这一轮能减 1,800–2,600 行；实际净减 1,827 行，在估计的低端。改动行（新增＋删除）多，是因为搬到共用模块的代码在新位置算新增、在原处算删除，再加上纯调用点改名：G2 有 490 对（980 行），G3 的两个查询服务有 626 行，都只是改用共享导出的真名（裁定 2）。说明书里每组 600–1,200 个改动行的目标是一次运行的体量，不是上限；五组都一次做完，G2、G4 各返工一次，G4 的第一次运行被杀后重跑。测试和夹具没有改动，production-reach 允许清单只删了三条声明已不存在的条目（裁定 13）。

## 过程

- **决定 81 的返工数。** 按“最多三轮、只数 DSH 返工”算：G4 1 次、G2 1 次，G1、G3、G5 0 次，都没有超过。
- **G4 的内存被杀。** 10-19 00:00 G2、G4、G5 同时起跑；00:07 G4 被杀：五个子 agent 同时跑 `tsc`（每个约 1.8 GB），越过这次运行 8 GB 的上限。部分改动保留（`checks/c1-g4-killed-partial.diff`），副本重置到 G1，00:08 用 `c1-g4b` 重跑；run 文件加了绑定的内存段：只有协调者跑类型检查、只跑一次，子 agent 只跑自己那些文件的 `vitest --maxWorkers=2`，同时最多三个子 agent。这条写进 DSH-WORKFLOW §6.10；§7.1 按决定 81 改写。
- **Codex 的审查是只读的。** 每次都不跑测试、不写文件；结论和 DSH 的回复一样只是输入，由 lead 对着代码核实。
- **DSH 回复里的说法错误不返工。** G4 的 signal 说明、G4 接口表漏 `waitPredecessorWalk`、G3 的 `CapacityError` 消费者和 1,007／661 行的归因、G2 第一版接口表，都记在裁定 4 里；代码本身对，或者已在返工里改好。
