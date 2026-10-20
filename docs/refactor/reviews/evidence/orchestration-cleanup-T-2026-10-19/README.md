# T 轮的执行证据（2026-10-19/20）

**是什么。** T 是 HANDOFF 决定 79-4：把整套测试和只为旧数据、旧接口留的生产代码清一遍；决定 79 定了不兼容旧数据。

- **盘点。** Codex 和 DSH 各查 11 个区（测试 8 个、生产代码 3 个），Claude 子 agent 逐批核对，lead 裁定。结果 721 行：要动的 529 行，不动的 192 行（`books/t-final-summary.txt`）。
  - 测试 368 行：删 142、并 124、改公开步骤 88、其他 14。
  - 生产代码 161 行。
- **测试。**
  - 过时、重复、琐碎的测试删掉或并进别的测试，每条写明理由：被哪条业务测试覆盖了，或者测的行为已经不存在。
  - 手写事实的测试改走公开步骤。wave 1 施工（TP、TQ）按测试规则表 v1。从 wave 1 返工 1 起用 v2（`books/test-rule-sheet-v2.md`，10-19 22:55 冻结）：wave 1 的返工里只用于问题表点名的行（R-1），wave 2 整体按 v2。
- **生产代码。**
  - 删了四个文件：`src/contracts/role-material-channels.ts`、`src/core/work-graph/tasks/session-provenance-facts.ts`、`src/core/workspace/project-source-index.ts`、`src/core/workspace/role-source-reader.ts`。
  - 各处按版本分派的旧分支、旧形状记录的解码、旧游标的容忍都删了。
  - C1 转来的五项也做了：N0 来源行、旧游标容忍、`TaskClaimOutbox` 的重复形状和 `TaskDispatchStateV1`、RL-15b 的下界、`N0GoalInput`。
- **允许清单。** production-reach 允许清单 182 → 164 条：pre-batch 62 → 0，wire-format 49 → 109，kept-for 71 → 55。pre-batch 的 62 条是 60 个 `core-http-types` 别名和 2 个 `main.ts` CLI 类型，用户 10-19 定了留着，改记 wire-format。
- **覆盖率。** T 前后各跑一次全量覆盖率。T 之后没执行到的代码里分拣了 795 行（T 删了最后一个测试的、T 新写的、`src/ui` 以外从没执行到的函数）：D1 55、D2 156、U 157、F 161、G 265、N 1；T 删错测试的有 8 处。细节见验收的“覆盖率”。
- **为什么分两波。** 原定五组并行；书检查后有 99 个要新加的文件落在别组的白名单上，改成两波：
  - wave 1：生产代码连同钉住它的测试（TP 173 项、TQ 115 项）；
  - wave 2：其余测试（T1、T2、T3），在合并好的 wave 1 上做。
- **基线和结果。** 基线 `t-base` = `3a9f6d94`；T 的结果 `w2r3` = `9a69bdb`，`t-base..9a69bdb` 37 个提交（DSH 11、Claude Code 26）。

**结果。** 已合入（2026-10-20，`0e381ce4`）。没有调用真实模型。

- 合并副本 `s9tmerge` 是工作树的 `47cc63e8`（覆盖率的开发依赖）加上 `t-base..9a69bdb`，得 `e99b385`。它和 T 的结果只差 `package.json`、`package-lock.json`、`scripts/check-boundaries.mjs` 三个文件。`0e381ce4` 的树就是 `e99b385` 的树。
- 合入时的全量（bubblewrap，5 个并行）：766 个测试文件全过，9,774 项过、3 项跳过，3,592 秒；构建、类型检查、模块边界检查都是 0（`checks/full-TMERGE.txt`）。
- 验收和逐项判断见 `lead-acceptance.md`；lead 的时间线、裁定和检查见 `books/t-lead-summary.md`；留给用户定的见 `books/t-end-list.md`。

## 经过

用量的记法：
- DSH 按 `checks/dsh-runs.txt`：秒、token、上下文峰值，token 以百万计；
- Claude 工作流按 `checks/claude-workflows.txt`：agent 数、子 agent token、分钟；
- 审查一列是 Codex 的 会出错／违规／不整洁，Claude 审查的确认／否决数写在材料一列；
- 提交一列写这一轮自己的提交，合并另起一行。

| 轮 | 谁 | 材料 | 用时、token、峰值 | 审查 | 问题表 | 提交 | 全量 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 盘点 | Codex（只读） | `codex/t-inv-*`，11 个区，526 条 | — | — | — | — | — |
| 盘点 | DSH | `dsh/inventory/`，11 个区，590 条 | 9,212 秒（每次 592–1,311 秒）、155.1M、285,899 | — | — | — | — |
| 盘点核对 | Claude 子 agent | 两个工作流：Codex 的每批配一个怀疑者；DSH 的逐区对照 Codex，再核新的和冲突的（对照时同 262、冲突 133、新 195）。结果 `books/t-final-summary.txt`、`books/t-final.json` | 60 个 agent、10.41M、52.7 分钟；53 个 agent、8.47M、29.0 分钟 | — | lead 的裁定见 `books/t-lead-summary.md` §2 | — | — |
| T 前覆盖率 | Claude 子 agent | `coverage/before-*`；副本 `s9tcov`，13:29–15:25，跑了两次 | 一次约 62 分钟 | — | — | 依赖提交 `47cc63e8` | 773 个文件，13 项失败，都在 `boundaries.test.ts`（当时还没批准新依赖） |
| 书检查 | Codex | `codex/t-bk-*` 6 次，都判“先修再施工”，共 213 处；快速复核 `codex/t-bk2-W1` 又 2 处 | — | — | — | — | — |
| wave 1 TP | DSH | `books/t-run-TP.md`、`books/t-items-TP.md` | 13,258 秒、39.98M、334,336 | — | — | `efa65cd` | — |
| wave 1 TQ | DSH | `books/t-run-TQ.md`、`books/t-items-TQ.md` | 963 秒、51.42M、360,740（越过交接线） | — | — | —（由 TQ2 提交） | — |
| wave 1 TQ2 | DSH | `books/t-run-TQ2.md`，只提交 | 176 秒、1.33M、79,338 | — | — | `5057649` | — |
| wave 1 合并 | lead | `books/t-audit-merge-notes.md` | — | — | — | `11d46d5`（TQ 的改动三方应用到 TP 上），`5daea2e`（lead 的修） | W1 `5daea2e`：767/772 个文件，24 项失败（8 项是 BLOCKED 的预期，16 项是两处合并回归），9,913 过，5 跳过，2,542 秒 |
| wave 1 审查 | Codex | `codex/t-aud-G1..G7`，7 组 | — | 5／35／20 | `books/t-w1-findings.md`：W1-01..W1-44、B-01..B-15、R-1..R-6 | — | — |
| 规则表 v2 | lead、Codex | `books/test-rule-sheet-v2.md`；Codex 的第一份实例清单 `codex/t-v2-list`、第二遍 `codex/t-v2-full` | — | — | — | — | — |
| W1R1 | DSH | `books/t-run-W1R1.md`、`books/t-run-W1R1b.md` | 分段 1：1,023 秒、63.78M、360,573（越过交接线，没提交）；分段 2：8,448 秒、28.23M、233,193 | — | — | `ed26c44` | 773/773，9,929 过，5 跳过，2,457 秒 |
| W1R1 审查 | Codex | `codex/t-r1-R1`、`t-r1-R2`；B-14 的逐条评估 `codex/t-r1-B14` | — | 1／7／6 | `books/t-w1r1-findings.md`：W2-01..W2-25、R-7..R-9 | — | — |
| W1R2 | DSH | `books/t-run-W1R2.md` | 4,348 秒、65.45M、367,721（越过交接线时已全部提交） | — | — | `1c31c27` | 773/773，9,929 过，5 跳过，3,072 秒 |
| W1R2 审查 | Codex | `codex/t-r2-Q1`、`t-r2-Q2` | — | 1／9／2 | `books/t-w1r2-findings.md`：W3-01..W3-12、R-10..R-12 | — | — |
| W1R3 | DSH | `books/t-run-W1R3.md` | 849 秒、11.89M、191,676 | — | — | `254617d` | 772/773，2 项失败（IN05），9,927 过，5 跳过，3,052 秒；lead 带 bubblewrap 单跑见 `checks/r3-in05.txt` |
| W1R3 审查和补丁 | Codex、lead | `codex/t-r3-P1`；`checks/t-lead-fix-P1.patch`、`checks/t-lead-fix-W1R3.diff` | — | 1／1／0 | 不再开表（决定 81：Codex 给补丁，lead 落地） | `67d547d`、`d4c4cea`；wave 1 收在 `d4c4cea` | — |
| v2 实例清单 | Codex | 第一遍 7 组 `codex/t-v2g-*`，卡在列举普通公开输入（6 组答“枚举不完整”）；第二遍只列 v2 改动的部分 `codex/t-v2n-*`，L7 不完整后拆成 L7a、L7b，共 9 份答复，最后 8 组都完整 | — | — | `books/t-v2-instances.md`：F1 312 处、记录存储的 F3 0、A7 越界 4（8 份最终答复的计数；索引合成 148 行） | — | — |
| wave 2 刷新 | Codex | `codex/t-w2r-T1..T3`：OK 214、CHANGED 14（8＋5＋1）、DONE 7、GONE 1、BLOCK 2 | — | — | DONE 和 GONE 共 8 条从条目里去掉（`books/t-w2-dropped.md`）；BLOCK 2 条由 lead 推翻：其余照转，事件子部分保留 | — | — |
| wave 2 T1 | DSH | `books/t-run-T1-w2.md`、`books/t-items-T1-w2.md` | 5,529 秒、37.32M、299,850 | — | — | `43532e3`、`4c160fa`、`5ec8f5e` | — |
| wave 2 T2 | DSH | `books/t-run-T2-w2.md`、`books/t-items-T2-w2.md` | 5,704 秒、14.94M、199,078（到时间上限） | — | — | `6e4e474`、`426fa37`、`26cde07` | — |
| wave 2 T3 | DSH | `books/t-run-T3-w2.md`、`books/t-items-T3-w2.md`；lead 带 bubblewrap 补跑的沙箱测试 `checks/w2-env-T3.txt` | 3,204 秒、32.13M、349,944 | — | — | `54380f7` | — |
| wave 2 合并 | lead | — | — | — | — | `b1a2f5b`、`4807e64`（一处冲突，取 T1＋T2 一侧） | W2a `4807e64`：760/766，8 项失败（一个共用 helper 移动了 id；规模行 30 秒超时），9,724 过，3 跳过，2,797 秒 |
| wave 2 审查 | Codex、Claude | `codex/t-w2a-*` 6 份；Claude 预审 `claude/w2-preaudit-dump.md`（40 确认／4 否决）；账本覆盖 `claude/w2-ledger-cover-dump.md`（15 确认／4 否决） | Claude 预审 12 个 agent、2.30M、26.8 分钟；账本覆盖 20 个 agent、3.41M、12.7 分钟 | 15／47／8 | `books/t-w2b-findings.md`：W2b-01..W2b-57、R-13..R-22 | — | — |
| W2R1 | Claude 子 agent（用户 14:41 的决定），lead 的几行 | `claude/t-reply-W2R1-agents.md` | 三个工作流：5 个 agent 0.59M 27.3 分钟，8 个 agent 1.39M 15.8 分钟，5 个 agent 1.03M 161.1 分钟；另 3 个单 agent（W2b-36、W2b-09、W2b-20） | — | — | 各副本提交后合成 `722ddf3`；W2b-20 `03b9cfd` | 765/766，2 项失败（store page 30 秒超时，`03b9cfd` 修），9,773 过，3 跳过，3,017 秒 |
| W2R1 审查 | Codex、Claude | `codex/t-w2r1a-*` 3 份；Claude `claude/w2r1-claude-audit.md`（19 条，13 确认） | Claude 8 个 agent、1.26M、29.7 分钟 | 3／0／1 | `books/t-w2r2-findings.md`：W2c-01..W2c-14、R-23、R-24 | — | — |
| W2R2 | Claude 子 agent（用户 18:14 的决定） | `claude/t-reply-W2R2-agents.md` | 4 个 agent、0.54M、7.5 分钟 | — | — | `222cd58`、`fc63710`、`36fa14b`、`9aef728`，合成 `c05c7d7` | 766/766，9,774 过，3 跳过，3,476 秒 |
| W2R2 审查 | Codex、Claude | `codex/t-w2r2a-P1`、`-P2`；Claude `claude/w2r2-claude-audit.md`（5 条，5 确认） | Claude 4 个 agent、0.72M、11.1 分钟 | 0／0／0 | `books/t-w2r3-findings.md`：W2d-01..W2d-05 | — | — |
| W2R3 | lead | `books/t-w2r3-findings.md` | — | 快速核对 `codex/t-w2r3q`：0／0／0 | — | `9a69bdb` | 见合入全量 |
| 合入 | lead | 合并副本 `s9tmerge` | — | — | — | `e99b385`，合入为 `0e381ce4` | 766/766，9,774 过，3 跳过，3,592 秒 |
| T 后覆盖率 | lead 的脚本 | `coverage/after-*`、`coverage/compare-summary.txt`、`coverage/mapped-summary.txt` | 4,727 秒（4 个并行），内存峰值 4,447 MiB | — | — | — | 766/766，9,774 过，3 跳过 |
| 覆盖率分拣 | Codex、Claude，DSH 裁定 | Codex `codex/t-cov-*`（8 组）；Claude 独立分拣和两边对照 `coverage/triage/triage-merged.tsv`；DSH 裁定 `books/t-cov-judge.md` → `dsh/tb-Tjudge-final.md`、`coverage/triage/judge-out/` | Claude 35 个 agent、9.93M、50.3 分钟；DSH 4,019 秒、3.24M、105,541 | — | `coverage/triage/triage-final.tsv`、`triage-final-summary.md` | — | — |
| 文档 | DSH，lead 改 | `books/t-docs.md` → `dsh/tb-Tdocs-final.md`；核对 `codex/t-docs-facts`、`claude/docs-claude-check.md` | DSH 545 秒、26.06M、335,061；Claude 核对 79 个 agent、7.78M、34.3 分钟 | Codex 17 条；Claude 57 条成立、13 条驳回，查漏 21 条 | — | 本文档提交 | — |

## 合计

- DSH：23 次运行（施工、返工、文档和分拣裁定），57,278 秒（15.91 小时），530,829,074 token，上下文峰值 367,721（`checks/dsh-runs.txt`）。
- Codex：施工到合入 64 份只读回答（`checks/codex-calls.txt`），另有文档核对 1 份、覆盖率分拣 8 份。
- Claude 工作流（10-19 起）：到 W2R2 的审查为止 10 个、179 个 agent、30.12M 子 agent token；文档核对 1 个（79 个 agent、7.78M）；覆盖率分拣 1 个（35 个 agent、9.93M）。另有两次分拣裁定的启动没有结果：一次参数写错，当即失败；一次按用户的要求停下（16 个 agent 已开工，没有交回结果），裁定改由 DSH 做（`checks/claude-workflows.txt`）。不含工作流外的单个 agent（W2R1 的 3 个、T 前覆盖率的 1 个）和 lead 自己的轮次。

## 规模

`t-base..9a69bdb`：`src` 169 个文件 +783/−3,300；测试 431 个文件 +16,450/−24,083；另 2 个文件 +2/−2。

| 段 | src | 测试 |
| --- | --- | --- |
| wave 1（`t-base..d4c4cea`） | 168 个文件 +775/−3,297 | 226 个文件 +6,399/−11,087 |
| wave 2 施工（`d4c4cea..4807e64`） | — | 251 个文件 +8,558/−12,572 |
| wave 2 返工（`4807e64..9a69bdb`） | 1 个文件 +8/−3 | 102 个文件 +2,279/−1,210 |

- 测试文件 773 → 766：删 9 个、加 2 个；辅助文件删 5 个，加 8 个 helper 和 support 文件（`checks/t-files-deleted-added.txt`）。
- 全量的测试项：10,089 过、5 跳过 → 9,774 过、3 跳过。
- 全量的时间：T 前约 2,520 秒（决定 85-5 合入时那次）→ 3,476 秒（W2R2）、3,592 秒（合入时）；后两次是和覆盖率同时跑的。真实世界换掉了手写状态，见验收的“留给用户”。

## 过程

- **和约定分工不同的地方**（决定 56、81 把返工交给 DSH）：
  - wave 2 返工 1 交 Claude 子 agent（用户 10-20 14:41：“你可以现在自己就干了，不必等到 DSh。”），只管这一轮；
  - 在这之前，lead 已应用户 14:31、14:40 “用完重置前的额度”的话，用两个工作流做了返工 1 的一部分行（5 个、8 个 agent），这些行同样过审、过账本、过审查；
  - wave 2 返工 2 也交 Claude 子 agent（用户 10-20 18:14，问“第二轮返工交给谁做？”，答“Claude 子 agent”）；
  - wave 2 返工 3 是五处一两行的小改，lead 自己改（决定 80-4）；
  - 覆盖率分拣（决定 79-4 写“Codex 只读审查并给出改法，lead 核实”）：lead 为了核实，另让 Claude 子 agent 独立分拣了同样的 795 行；裁定原本也要用 Claude 工作流，用户 10-20 晚上说“你能否停一下，让 DSH 去跑吧”，改由 DSH 做。
- **返工数。** wave 1：DSH 三轮，之后剩的两处由 Codex 给补丁、lead 落地（决定 81）。wave 2：按冻结表数也是三轮，但都不是 DSH 做的；按 81-1 只数 DSH 返工的口径，wave 2 是 0 轮。
- **越过交接线**（`--handoff-at 360000`）：TQ、W1R1 的分段 1、W1R2。TQ2 和 W1R1 的分段 2 接着做；W1R2 越线时已全部提交。
- **施工中发现的说明书错误**（都不另开返工）：
  - wave 1 书里的机器级类型检查锁在 DSH 沙箱外，建不了：TP 自己改用副本里的 `./.typecheck.lock`，TQ 没加锁；从 wave 1 返工 1 起各书都写副本里的锁；
  - wave 1 有一个子 agent 用了 `--maxWorkers=6`；
  - 书检查漏了 TQ-091 的下游夹具，合并时由 lead 的 `5daea2e` 补；
  - DSH 的沙箱里没有 bubblewrap，沙箱测试由 lead 跑（R-10）；
  - `tests/scenarios/K3-19-review-unavailable.test.ts` 被漏在 T2 的白名单外，T2-040、T2-042 改了它，作为接受的适配。
- **T 后的覆盖率第一次没构建就起跑**（两个测试要 `dist`）。lead 33 秒后按 PID 停掉，带构建重跑。
- **材料里改过的说法**（lead 核对后，以这里为准）：
  - TP 按回复的逐项表是 157 done、7 partial、9 BLOCKED，最终说明写的 147／11／15 重算不出；
  - TQ 是 107 done，回复里“100 done”是加错了（100＋3＋5＝108，不是 115）；
  - 用户第二次决定的时间是 18:14；
  - 保留的别名是 60 个，不是 61 个；
  - W2R1 是 18 个 agent 加 3 个单 agent，不是 31 加 4。
