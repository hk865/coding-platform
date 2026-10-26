# 编排分片与接线：规格和任务书

**当前状态（2026-10-27）。** 第 0、1、3、5 片、接线包 1、接线包 2（bb924854）、K 片 B（9881a2ae）、K 片 A（cfe35550）已合入；2A、2B、2C、资源上限片、4A、4B、注记查找提速两轮、4C-1、8A、4C-2 A、B 两段、8D 和 §10 段、L8、K3（`d3146d69`，补做 `5e83681b`）、C1（`35b5f5b1`）、决定 85-5 的两处小修（`c54d00e0`）、T 轮（`0e381ce4`）、T 后小修（`aab1a8fd`…`4a8a1400`，五组加一个返工提交，删除 `src/ui` 79 个文件，标签 `old-ui-last`）、规模测试拆分（SC，`66582273`）、6A 之前的结构一轮（`563f14d7`…`eee7503f`，决定 85-1）、提示词和上下文 PC-1（`20f20ae2`）、PC-2（`fd4be391`，决定 83-4、83-5）、6A-1（`f32a9eeb`，决定 88）、6A-2（`b95e018c`，决定 88-5）、6A-3（`b4aef8f6`，决定 90-5）、6B-0（`7b9787ef`，决定 90-2、90-7）和 CL-1（`6627fca9`，决定 90-8）、决定 89 的小步（`01a53893`）和 CL-2（`a9419afd`，决定 90-8、90-12）、7B-0（`84b8cd6e`、`292e269e`，决定 85-1）、8B-1（`71281a9a`，决定 90-9、90-14）、6B-1（`62fe35f1`，决定 90-15）、6B-2（`12400fdd`，决定 92）、7A-1（`707cfb27`，决定 93）已合入。最后全量：决定 89 的小步和 CL-2 合入前 917 个测试文件全过，11,314 项过、3 项跳过（8 个并行，TMPDIR 在 WSL 的内存盘，480 秒）；规模批 13 个文件 40 项全过（4 个并行，595 秒）。7B-0 的两项各 917 个测试文件全过、11,314 项过、3 项跳过（A2 612 秒、D5 580 秒），规模批 13 个文件 40 项全过（624 秒、572 秒）。8B-1 合入前 919 个测试文件全过，11,381 项过、3 项跳过（6 个并行，TMPDIR 在 tmpfs，574 秒），规模批 13 个文件 40 项全过（4 个并行，556 秒）。6B-1 合入前 933 个测试文件全过，11,633 项过、3 项跳过（6 个并行，TMPDIR 在 tmpfs，514 秒），规模批 13 个文件 40 项全过（4 个并行，519 秒）。6B-2 合入时的全量 953 个测试文件里 1 个红（`S6A-secretary-selection-usage`，查明是整圈结束交接的有意改动、测试侧修好）、11,905 项过、3 项跳过（626 秒），规模批 13 个文件 40 项全过（612 秒）。7A-1 合入时的全量 974 个测试文件全过、12,167 项过、3 项跳过（568 秒），规模批 13 个文件 40 项全过（574 秒）。最新状态见 [STATUS](../../../STATUS.md)，决定 1–93 见 [HANDOFF 顶部](../../../HANDOFF.md)，分片依赖见 [设计目录](../README.md)和 [DESIGN §8.2](../DESIGN.md#82-分片表)。下一步：6B-3 的几波和 L（底在 `s96b3base`：`6b3-base` = `d3b9cf0`，P-3 的四个提交加胶水 `d567992`，夹具冻结成 `8ef60de` = 标签 `6b3-fx` = `6b3-p3`，1,144 行、37 个文件 515/515；C/K/J/G 几波等 10-27 15:00 重置之后开工，难组交 Opus（90-17），其余交 DSH，然后 6B-3 L；7A-1 的 L 这道依赖已满足）；7D1 的书 v5 10-27 已冻结（生产 4,710、测试 4,120，一次运行、在 7C 合入之后）。顺序：6B-3 的几波 → 6B-3 L → 7A-2 → 7B-1 → 7B-2 → 7B-3 → 7C → 7D1；8B-2 要 7D1（决定 90-9 ②）；8C、8E 的盘点已做、草稿暂缓（决定 56）。6A 的任务书 10-23 冻结（[slice-6-SPEC](slice-6-SPEC.md) 开头是 6B-0 合入后的读法）。新界面在后端之后做，基线是[冻结原型](../../../../ui-reference/workbench-2026-10/README.md)和 [UI-WORKBENCH §0](../../../../UI-WORKBENCH.md#ui-decisions-2026-10)。

## 2026-10-13 起怎样做

- lead 定规格、接口和要判断的规则，冻结、审查、验收，负责全部文档、和用户交互、维护协作和开发规范；规格第一稿由 lead 起草，之后照决定改稿、起草文档交给 DSH（不占 Claude 额度），lead 逐行审。Codex 写夹具，只读审查规格、测试、文档和实现并提意见（含代码怎么改），验收后推送。DSH 写测试用例和实现，施工前读任务书和规格、报看不懂的地方（决定 36、43、44、46、56）。
- 省用量（决定 56）：每份规格最多两轮完整审查加一次只看改动的快速核对；实现追上之前不开新规格；历次审查的处理记录放单独文件。
- 先和用户确认测试入口，再用 Matt Pocock 的 TDD skill（`mattpocock/skills` 的 `engineering/tdd`，MIT），一条一条先写失败测试、再写刚好通过的实现。通过公开接口测业务流程，不读数据库核对；期望值来自规格或手算例子。
- 夹具由 Codex 写、lead 核对后冻结；DSH 按上下文分组，第二段和返工新开 Session，说明书写明子任务没回报完之前不要结束回合。记录用量，Codex 只读审查，lead 验收；合入前在有 bwrap 的环境跑全量，另跑规模批（`npm run test:scale`，决定 86-6，SC 合入后；平时的局部测试和返工不跑它）。操作细节见 [DSH-WORKFLOW §6.10](../../../DSH-WORKFLOW.md#610-大片怎么交给-dsh决定-46)。
- 验收后按决定 44 由 Codex 推成远端新分支，不强推、不动远端 `next-main`，随后快进本地主目录。文档草稿由 lead 逐行审阅。
- **有能力、没入口（决定 86-5，2026-10-20）。** 分片先做后端、界面在 E3，能力常比它的入口（路由、工具、界面）早几片。入口出现之前，测这些能力只能手写状态或用替身。所以：
  - 规格列出本片做了、但还没有公开入口的能力，以及暂时替它们站岗的测试（文件和用例）；
  - 加入口的那一片，规格和任务书列出这些测试，改成走公开步骤；
  - 已知的这类账：Agent 的重新入队和重新检查两个工具（GAP-46，T 的 TP-124）挂第 7 片；T 验收“留给用户”第 3 项的几处没有公开读口，记成已知限制，哪一片加了对应的读口就一起改。

## 接下来做什么

**已合入（2026-10-15）：** 2A（决定队列只读要用的、不因数量多拒绝、能翻到底；RecordStore 加按顺序查找）。施工四轮，验收和限定见 2A 证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-2A-2026-10-14/README.md`）和 [2A 规格 §10](slice-2A-SPEC.md#10-施工和验收中的限定lead2026-10-15)。 2B（执行计数、补算、活动日历、按时间读任务状态）同日合入，施工三轮，验收和限定见 2B 证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-2B-2026-10-15/README.md`）和 [2B 规格 §11](slice-2B-SPEC.md#11-施工和验收中的限定lead2026-10-15)。

**已合入（2026-10-14）：** 接线包 2（I-2、I-4、I-5、I-6）bb924854；K 片 B（只读命令 `run_readonly_command`）9881a2ae；K 片 A（关闭悬空 Turn、留在原 Session）cfe35550。验收和限定见接线包 2 证据（已归档：`docs/refactor/reviews/evidence/orchestration-wiring-2-2026-10-13/README.md`）、K 片 B 验收（已归档：`docs/refactor/reviews/evidence/orchestration-slice-K-2026-10-13/partB/lead-acceptance.md`）、K 片 A 验收（已归档：`docs/refactor/reviews/evidence/orchestration-slice-K-2026-10-13/partA/lead-acceptance.md`）。

1. **2C、4A、4B 已合入（2026-10-16），4C-1 已合入（2026-10-17），4C-2 A、B 两段也已合入（2026-10-17，B 段 f4171d51）。** 施工和验收中的限定在 2C 规格 §16、第 4 片规格 §9、§10、§12（对 4C-2 同样有效）、§13（4C-2 A 段，对 B 段同样有效）、§14（4C-2 B 段施工和验收中的限定）。注记查找提速两轮（决定 66）也已合入，见第一轮（已归档：`docs/refactor/reviews/evidence/orchestration-note-speed-1-2026-10-16/README.md`）和第二轮（已归档：`docs/refactor/reviews/evidence/orchestration-note-speed-2-2026-10-16/README.md`）的证据。
2. **资源上限片已合入（2026-10-16）。** 施工和验收中的限定在 RL 规格 §9。实现追上之前不开新规格。
3. **K3 已合入（2026-10-18，`d3146d69`；补做 `5e83681b`）。** [K3 规格](slice-K3-SPEC.md)第八稿 2026-10-16 冻结（决定 57、68：拦下的原命令用确定的解析认出常见改写，认不出的由 agent 注明，允许只放行卡上那一种写法；lead 的 K8-1–K8-7，Codex 一次只看改动的核对）；四组施工，B3 先返工 8 轮，按决定 80 一次全审、冻结 F-001–F-102 的表，按决定 81 最多三轮返工（9a+9b 是第 1 轮，第 10 轮是第 2 轮），N-01 交 Codex 测试补丁；形式行进 T。读法见 [K3 规格 §10](slice-K3-SPEC.md#10-k3-施工和验收中的限定lead2026-10-18)，经过见证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md`）。8D 和 §10 段已合入（2026-10-18，规则在第 8 片规格 §11、§12，决定 77、78、79）；L8 已合入（2026-10-18，施工一轮、返工四轮，返工 2 前按决定 80 补全审，规则在第 8 片规格 §13）。最后全量：C1 合入时771 个测试文件全过，10,082 项过、5 项跳过（K3 合入时也是这个数）。
4. **第 4、6、7、8 片已冻结（2026-10-15 晚，决定 64）。** 施工顺序 4A → 4B → 4C → 6A → 6B → 7A → 7B → 7C → 7D1 → 8A → 8B → 8C → 8D → 7D2 → 6C；**决定 74 改为：** 4C-1 合入后 8A（不含 L8）→ 8D 另走一条线，和 4C-2、清理、6A 并行，其余照旧；2C、4A、4B、4C-1、8A、4C-2 A、B 两段、8D 和 §10 段、L8、K3 已合入（8A 的施工和验收中的限定在第 8 片规格 §9，8D 和 §10 段的在 §12，L8 的在 §13）；K3-07 和 K3-49 已补做；C1 已合入（2026-10-19，`35b5f5b1`）；T 轮已合入（2026-10-20，`0e381ce4`，决定 79-4；决定 84 的结构审查已做完，见决定 85）；接着由用户定 T 留下的事，然后第 6、7 片的“提示词和上下文”一节（决定 83），冻结后先做 6A 之前的结构一轮（决定 85-1），再开 6A。

## 这里有什么

| 片 | 规格 | 任务书 | 要用户定（OPEN） |
| --- | --- | --- | --- |
| 0 | [slice-0-SPEC.md](slice-0-SPEC.md) | 第一段（已归档：`docs/refactor/design/orchestration-2026-10/slices/slice-0-book-part1.md`）、第二段（已归档：`docs/refactor/design/orchestration-2026-10/slices/slice-0-book-part2.md`） | 无 |
| 1 | [slice-1-SPEC.md](slice-1-SPEC.md) | 第一段（已归档：`docs/refactor/design/orchestration-2026-10/slices/slice-1-book-part1.md`）、第二段（已归档：`docs/refactor/design/orchestration-2026-10/slices/slice-1-book-part2.md`） | 无（U1 已由决定 45 定为甲） |
| 3 | [slice-3-SPEC.md](slice-3-SPEC.md) | 第一段（已归档：`docs/refactor/design/orchestration-2026-10/slices/slice-3-book-part1.md`）、第二段（已归档：`docs/refactor/design/orchestration-2026-10/slices/slice-3-book-part2.md`） | 无 |
| 5 | [slice-5-SPEC.md](slice-5-SPEC.md) | 第一段（已归档：`docs/refactor/design/orchestration-2026-10/slices/slice-5-book-part1.md`）、第二段（已归档：`docs/refactor/design/orchestration-2026-10/slices/slice-5-book-part2.md`） | 无 |
| 接线包 1（2026-10-09 补） | [wiring-1-SPEC.md](wiring-1-SPEC.md) | 发给 DSH 的说明书在证据（已归档：`docs/refactor/reviews/evidence/orchestration-wiring-1-2026-10-09/README.md`）的 `books/` | 无（L13 由决定 48 确认） |
| 接线包 2（2026-10-14 合入 bb924854） | [wiring-2-SPEC.md](wiring-2-SPEC.md) | 验收和限定见证据（已归档：`docs/refactor/reviews/evidence/orchestration-wiring-2-2026-10-13/README.md`） | 无（U1 已由决定 49 第 29 项定为甲） |
| 2A（2026-10-15 合入） | [slice-2A-SPEC.md](slice-2A-SPEC.md)（§10 是施工和验收中的限定） | 说明书和验收见证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-2A-2026-10-14/README.md`） | 无 |
| 2B（2026-10-15 合入） | [slice-2B-SPEC.md](slice-2B-SPEC.md)（§10 冻结时的限定和实测，§11 施工和验收中的限定） | 说明书和验收见证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-2B-2026-10-15/README.md`） | 无 |
| 2C（2026-10-14 夜冻结，2026-10-16 合入） | [slice-2C-SPEC.md](slice-2C-SPEC.md)（§15 是冻结时的限定，§16 是施工和验收中的限定） | 证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-2C-2026-10-15/README.md`）的 `books/` | 无 |
| 资源上限（RL，2026-10-15 夜冻结，2026-10-16 合入） | [slice-RL-SPEC.md](slice-RL-SPEC.md)（L16 是冻结时 lead 定的读法，§9 是施工和验收中的限定） | 证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-RL-2026-10-16/README.md`）的 `books/` | 无（Q1 已由决定 55 定） |
| 4（2026-10-15 晚冻结；4A、4B、4C；4A、4B 2026-10-16 合入，4C-1、4C-2 A、B 两段 2026-10-17 合入） | [slice-4-SPEC.md](slice-4-SPEC.md)（§9、§10、§12、§13 是 4A、4B、4C-1、4C-2 A 段施工和验收中的限定；§14 是 4C-2 B 段施工和验收中的限定） | 4A：证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-4A-2026-10-16/README.md`）的 `books/`；4B：证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-4B-2026-10-16/README.md`）的 `books/`；4C-1：证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-4C1-2026-10-17/README.md`）的 `books/`；4C-2 A 段：证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-4C2A-2026-10-17/README.md`）的 `books/`；4C-2 B 段：证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-4C2B-2026-10-17/README.md`）的 `books/` | 无（§0.1 用户已定；2C 合入后 lead 重核过 §0.2、§6） |
| 6（2026-10-15 晚冻结；6A、6B、6C；6A-1、6A-2、6A-3、6B-0 2026-10-24 合入，6B-1 2026-10-25 合入 `62fe35f1`，6B-2 2026-10-27 合入 `12400fdd`） | [slice-6-SPEC.md](slice-6-SPEC.md)（开头是 6B-0 合入后的读法） | 6A-1、6A-2、6A-3、6B-0、6B-1、6B-2：任务书和经过见证据（已归档：`docs/refactor/reviews/slice6a1-2026-10-24/`、`docs/refactor/reviews/slice6a2-2026-10-24/`、`docs/refactor/reviews/slice6a3-2026-10-24/`、`docs/refactor/reviews/slice6b0-2026-10-24/`、`docs/refactor/reviews/slice6b1-2026-10-25/`、`docs/refactor/reviews/slice6b2-2026-10-27/`） | 无（§0.1 用户已定，决定 64） |
| 7（2026-10-15 晚冻结；7A、7B、7C、7D1、7D2） | [slice-7-SPEC.md](slice-7-SPEC.md) | 7A 已冻结，7A-1 2026-10-27 合入 `707cfb27`；7B 的书 v3 10-25 已冻结，7B-0 已合入（`84b8cd6e`、`292e269e`）；7C 的书 v5 10-25 已冻结，开工裁定等 7B 并重核 步骤种类；7D1 的书 v5 10-27 已冻结（一次运行，在 7C 合入之后；后注见规格开头） | 无（§0.1 用户已定，决定 64） |
| 6、7 补充：提示词和上下文（决定 83，2026-10-21 冻结；D3 已在结构一轮里做完（10-22），PC-1、PC-2 已合入（10-22、10-23）） | [slice-6-7-PROMPTS-SPEC.md](slice-6-7-PROMPTS-SPEC.md) | 施工时写 | 无（§0.1 用户 10-21 已定，测试入口 PE1–PE10 已确认） |
| 8（2026-10-15 晚冻结；8A、8B、8C、8D、L8；8A 2026-10-17 合入，8D 和 §10 段、L8 2026-10-18 合入） | [slice-8-SPEC.md](slice-8-SPEC.md)（§9 是 8A 施工和验收中的限定，§10 是观测规模的修正，§11 是轻型扫描，§12 是 8D 和 §10 段的限定，§13 是 L8 的限定） | 8A：证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-8A-2026-10-17/README.md`）的 `books/`；8D 和 §10 段：证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-8D-2026-10-18/README.md`）的 `books/`；L8：证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/README.md`）的 `books/`；8B 的书 10-24 已冻结；8B-1 已合入（`71281a9a`，决定 90-14：计划按架构目录的模块走，propose pin 当前 catalog、采用检查模块任务）；8B-2 在 7D1 之后；8C、8E 的盘点已做，草稿暂缓 | 无（§0.1 用户已定，决定 64） |
| 8E 语义联系（决定 87，2026-10-22 冻结；接在 8C 之后，分两段） | [slice-8E-SPEC.md](slice-8E-SPEC.md) | 施工时写 | 无（§0.1 用户 10-22 已定，测试入口已确认） |

## 历史：第 0、1、3、5 片的冻结与施工（2026-10-08 至 10-09）

以下是这些已完成批次的原安排和结果，包括当时的上限、骨架/测试批量冻结与接线预告；以后施工按上面的 2026-10-13 做法。旧 I-4 摘要预告已撤回。

2026-10-08，lead 冻结。按 [DESIGN §8.2](../DESIGN.md#82-分片表) 分片施工，先做第 0、1、3、5 片，实现都交给本地 DSH（HANDOFF 决定 36、43）。lead 写定规格行、接口和规则；DSH 按两段做：先写骨架和测试、停下，lead 审过冻结以后再实现（AGENTS.md 第 5 条，[DSH-WORKFLOW](../../../DSH-WORKFLOW.md) §1、§6）。代码基线 9b94fc55（可靠性批次做完；src 与 676a7a7b 相同，全量测试 215 个文件、5234 项全部通过）。

第 1、3、5 片的规格由 Codex（推理强度 xhigh）按 585f1ac0 起草，lead 核对设计和代码后冻结：每份规格的 §0 是 lead 的冻结说明（OPEN、lead 定的技术选择、对草稿的改动、和别的片的接缝、抽查的代码出处、精确数量），正文里改过的地方标【lead 改】、技术选择标【lead 定】。§0 与正文不一致时以 §0 为准。

**2026-10-08 已定：** 用户选甲（等人认定，HANDOFF 决定 45），和下面的冻结做法一致，规格和代码都不用改。原 OPEN 条目留作出处：

**OPEN（要用户定，只有一条）：** 第 1 片 U1，退役、没有接续的线手上的执行结果未知时，自动归档是等人“认定”（lead 建议），还是平台自动认定。两条已定的话（决定 38“马上归档”、决定 42“自动归档只走不需要人选的路”）在这一支上冲突。规格把这一支冻结为“不新增行为”（跳过，记在维护结果里），其余部分可以先施工；详见 [slice-1-SPEC §0.1](slice-1-SPEC.md#01-open要用户定施工到这一支之前停下问)。

### 顺序

1. **第 0 片**：在本分支的基线上做，DSH 两段完成（决定 43）：先写 3 个用例、看它们按预期失败后停下，lead 审过、冻结测试，再改那一行；检查通过、lead 审过后提交。它很小（改 1 行、加 3 个用例），但第 3 片要在它之上改同一个文件。
2. **B0（lead 做，一次提交）**：第 3、5 片都要在新的 `views` 子模块里建文件，第 5 片还要 `configuration → state`。这两处写进 `docs/refactor/module-target.json` 由 lead 一次做完，免得两片各写一份再合并冲突：
   - `configuration.dependencies` 改为 `["model", "state", "persistence"]`；
   - 在 `communication` 之后加子模块 `{"id": "views", "path": "views/", "dependencies": ["model", "state", "persistence", "configuration", "materials", "architecture", "sessions", "queries", "tasks", "evidence", "communication"], "note": "读模型（L7，DESIGN §7.2）：只读，不写记录。编排第 3 片（上下文与图读取）和第 5 片（决定队列、冲突提示、请知悉）在这里建文件。"}`，缩进照文件现有的两格；
   - WorkGraph 的 note 里“notes（L5.5）、views（L7）还没有文件，第一个文件落地时再声明”改为“notes（L5.5）还没有文件，第一个文件落地时再声明；views（L7）在编排第 3、5 片之前声明（design/orchestration-2026-10/slices/README.md 的 B0）”；
   - 建 `src/core/work-graph/views/README.md`（三行：这是读模型子模块、只读、第 3、5 片在这里建文件）。检查器要求声明的子模块目录存在（`scripts/check-boundaries.mjs:183`），没有源文件是允许的；非源文件不参与检查（同目录先例 `src/core/agent-runtime/README.md`）。
   - B0 之后跑一次 `npm run typecheck`、`npm run check:architecture`、`npx vitest run tests/architecture`，应当全过，数字和 B0 之前相同。
3. **第 1、3、5 片**：从 B0 之后的同一个提交各建一个副本（DSH-WORKFLOW §1 的做法：`git archive` + `node_modules` + `vendor/coding-agent/node_modules` 里的 zod 和 openai + `git init` 基线提交）。三片的 DSH 可以接连跑，也可以 2–3 个同时跑（决定 36）；但检查（测试）一次只跑一个，机器空闲时跑（DSH-WORKFLOW §1）。
4. **合入顺序 1 → 3 → 5。** 每片验收后，lead 把它在副本里的改动（相对副本基线提交的 diff）应用到本分支：第 1 片直接应用；第 3、5 片用三方合并（`git apply -3`），冲突由 lead 合并，两边新增的类型、字段、路由、注册项都保留。第 1 片先合，因为它改的是 Session、消息、接续说明这些底层记录，第 3、5 片在上面加接缝；第 5 片最后合，因为它和第 1 片同改的文件最多。

### 三片在哪些文件上碰头

三片都新建同一个共用文件 `src/contracts/platform-duty.ts`，内容逐字节相同（见下面“共用文件”），合并时不冲突。三片都改的：`src/app/core-http-types.ts`、`src/app/core-routes.ts`、`src/composition/create-platform.ts`、`src/core/work-graph/tasks/execution-entry-service.ts`。

| 两片 | 同改的文件 |
| --- | --- |
| 1 和 3 | 上面四个，加 `src/core/agent-runtime/` 下的 `execution-preparation.ts`、`ports.ts`、`runtime.ts`，`src/core/work-graph/queries/query-execution.ts` |
| 1 和 5 | 上面四个，加 `src/app/collaboration-driver.ts`；`src/business/workflow/` 下的 `consultation.ts`、`contracts.ts`、`ports.ts`、`workflow.ts`；`src/contracts/ledger.ts`；`src/core/agent-runtime/execution-inputs.ts`；`src/core/work-graph/` 下的 `communication/mailbox-service.ts`、`model/communication-contracts.ts`、`queries/query-record-codecs.ts`、`sessions/message-record-codecs.ts`、`state/message-machine.ts`、`tasks/claim-record-codecs.ts`、`tasks/claim-service.ts`、`tasks/plan-readers.ts`、`tasks/requeue-service.ts`；`tests/architecture/state-writes.test.ts` |
| 3 和 5 | 上面四个，加 `src/core/agent-runtime/execution-contracts.ts`、`execution-driver.ts`，`tests/architecture/production-reach-allowlist.json` |

合并时要看的语义交叉（不只是文本冲突）：
- 消息记录：第 1 片加 `replyHandler`、`archiveWaitDisposition` 和 `replyHandler` 索引；第 5 片加收信方“你”、`goalRef`、`decision`、`application`、新答复形状、3 个消息索引和创建位置 `since`。两边的 codec、状态机构造、类型等价测试、`state-writes` 的保护字段都要合成一份。
- 重新入队：第 1 片在 `TaskRequeueSnapshotV1` 加 `archiveOrigin` 和归档中断的豁免；第 5 片加自治检查和通知的创建位置 `since`。豁免和自治检查的先后照两份规格各自的检查顺序，合并后跑两片的 requeue 用例。
- 路由：第 1 片 11 个、第 3 片 2 个、第 5 片 12 个新 suffix，都加进 `core-http-types.ts` 的 `CoreRouteSuffix` 和 `core-routes.ts` 的表与分派。

### 合入以后的接线（lead 写一页任务书，交 DSH，照两段做）

这几处依赖两片都已合入，在各片里只留了如实的接缝（读作 `not_implemented` 或用过渡映射），不预先接：
- **I-1**（第 3 片合入后）：第 1 片的 `SessionDutyResolver` 改为读第 3 片的职责（`effectivePlatformDuty`）；读不到时仍是 `'unknown'`。
- **I-2**（第 5 片合入后）：第 5 片 `configuration/message-duties-adapter.ts` 的过渡映射改为读第 3 片的职责。
- **I-3**（第 3 片合入后）：第 3 片装配器的 `extensions.anomalies` 接第 1 片的 `listSessionAnomalies`（按目标、未被接手的锚点），提醒段用 `anomaly:<refkey>` 作行键。
- **I-4**（第 5 片合入后）：第 3 片装配器的 `extensions.goalSettings` 接第 5 片的 `readGoalSettings`（自治级别）。两片的取值相同（`'every_step' | 'after_plan_confirmation'`），原样转交。
- **I-5**（第 5 片合入后）：第 5 片“请知悉”的 `undelivered_reply` 类别接第 1 片的 `readUndeliveredReplies`（退役线上迟到、没送到的回复；DESIGN §1.4、§4.5，AMB-43），按 `messageRef + responseRef` 去重（第 1 片 §2.5）。接上之前，这一类如实读作 `not_available`。【已定（决定 49）】第 29 项选甲：早已保存的回复后来进入未送达也要新提醒，须保存进入未送达的持久位置；接线包 2 的 U1 已定，接口、状态行及数量先按 U1 改完再冻结；接线包 2 已合入 bb924854（决定 50）。
- **I-6**（第 5 片合入后）：第 3 片装配器的 `extensions.decisions` 接第 5 片的决定队列（这个目标、这个任务上还没答的卡；DESIGN §5.1 第 6 段“关于这个任务的待决事项”）。行的写法在接线任务书里由 lead 写定。

### 共用文件 `src/contracts/platform-duty.ts`

第 1、3、5 片各自新建，内容必须逐字节等于下面六行（只有 ASCII，LF 换行，末尾一个换行，318 字节，sha256 `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`）：

```ts
/**
 * The five platform duties (orchestration design, section 4.10; decision 37).
 * A Session's duty comes from its role configuration and is fixed when the
 * Session is created; it never changes while the Session runs.
 */
export type PlatformDutyV1 = 'executor' | 'secretary' | 'adviser' | 'scribe' | 'reviewer';
```

### 每片多大

| 片 | 文件（新建 / 修改） | 用例（运行次数） | 新测试文件 | 状态行 | 新路由 | 估计行数：生产 / 测试 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 2（1 / 1） | 3（3） | 1 | 0 | 0 | 1 / 60–90 |
| 1 | 87（38 / 49） | 151（212） | 23 | 19 | 11 | 2,600–4,100 / 2,100–3,200 |
| 3 | 42（21 / 21） | 116（168） | 11 | 3 行补充守卫 | 2 | 1,600–2,400 / 1,400–1,900 |
| 5 | 82（41 / 41） | 153（224） | 16（另 2 个支持文件） | 23 | 12 | 4,700–6,700 / 1,800–2,600 |

行数是估计，不是验收数字；文件数和用例数是冻结的精确数（各规格 §0.6）。第 1、3、5 片比分级测试做过的任何一级都大（L6 是 94 行的 owner 写入，任务 D 是 158 个文件的机械改动）。所以这几段运行的上限放宽到每段 60 分钟、3000 万 token（运行器默认 20 分钟、1000 万；在 `~/dsh-work/ladder/_common` 的副本里改常量，同修 `--patch` 参数顺序的做法）；碰到上限记 `stopped: limit`，由 lead 看进度再定是在同一 Session 继续还是拆小。

### 每片怎么核对

DSH 的报告只是输入。每段结束后：
1. **脚本核对**（DSH-WORKFLOW §6.6）：`git status --short` 的形状；`git diff --name-only` 等于规格 §6 的清单（第一段只多不少地落在清单内；第二段恰好等于清单）；第二段里冻结测试的 sha256 没变；`npm run typecheck`、`npm run check:architecture` 通过；点名的新测试和回归测试的数字和任务书一致；没有提交；`scan.json` 没有越界访问。
2. **第一段之后**：lead 审测试（每个用例对着规格的表核对给定和期望；RED 必须来自 `not implemented` 桩，不是编译错或夹具错），冻结测试文件的 sha256，再发第二段。第二段的“冻结测试”一节由 lead 在发送前填上文件和 sha256。
3. **第二段之后**，三件事同时开始（DSH-WORKFLOW §7）：脚本核对；Codex 只读审查（推理强度 xhigh，三片都改状态和逻辑；第 0 片用 high），在一次性副本上看 DSH 的结果，说明里附上规格和任务书；lead 读 diff，重点是规格 §8 的规则。lead 逐条核实 Codex 的问题，和自己的发现一起写成一轮返工说明（位置、思路、要重读的规则，不给答案），发给同一 Session。一般一轮就够；第二轮还不行，lead 用别的办法收尾。
4. **合入本分支后**：跑已合入各片的点名测试；最后一片合入后，跑一次全量测试（`npm test`，一次只跑一个、机器空闲时跑），加 `npm run build`。全量数字和 9b94fc55 的 215 个文件、5234 项相比，只多出各片新测试，原有的一个不少、没有新失败。
5. **用量**（决定 43）：每片、每段记 DSH 的时间、token、工具调用次数，lead 的工具调用次数和墙钟（等待单列），写进各片的证据。

### 验收以后 lead 同步的文档（不在 DSH 写范围）

STATE-MACHINES-SPEC（新行和 §15 的行→文件→用例对照）、`module-dag.md` §6（views、`configuration → state`）、能力索引、HANDOFF、STATUS、DESIGN §8.2 的状态。各片证据放在 `docs/refactor/reviews/evidence/` 下新目录。

### 冻结后的审查（2026-10-08）

冻结以后用 Codex（推理强度 xhigh，只读，在 736cea57 的一次性副本上）对着 DESIGN、HANDOFF 决定 20–43 和代码审了一遍规格和任务书；lead 逐条核实，改了真问题，正文改处标【审查改】：
- 第 0 片：S0-01 的假架构读取原来回 `rejected`，scan 会把图当“读不到”，这一条永远不过，改成 `{ status: 'not_found' }`；任务书分成两段（决定 43）。
- 第 1 片：加 IT34 锁住 §0.1 冻结的 U1 跳过；UT11、UT15 不再要求纯 state 给出提交游标；加纯函数 `deriveTaskArchiveState`（“中断，待核对”和下一步提示）；IT09 和 §2.8 去掉已没有的 module-maintainer 职责；几处草稿残句（codec 下移、用例数）。
- 第 3 片：自治取值改成和第 5 片一样（`every_step`）；注意力通知每种行的精确写法和行序。
- 第 5 片：补上 `response.decision.source`、`application.basisRebases` 两个字段；共享消息写入 `persist` 带上入口算好的身份；暂停后落实只比“答复时”和“现在”的内容（删掉要求读中间事件链的那句）；SC02 改成两边计划都有模块 M（本片没有执行改过的文件）；补四个纯函数的签名、消息和计划状态机成员的名字；冲突卡的三个选项照 UI-WORKBENCH §0 的措辞，别的非消息卡 `options: []`；Workflow 结果里放决定原因的字段；加 8 个用例（SS15、SS16、UM13、AP14–AP16、WF01、WF02）和 1 个测试文件。
- 接线加 I-5、I-6，接线任务书也照两段做。

### 施工结果（2026-10-09）

| 片 | 结果 | 提交 | 证据 |
| --- | --- | --- | --- |
| 0 | 做完，合入 | 21a99915（B0 是 48c8d473） | orchestration-slice-0-2026-10-08（已归档：`docs/refactor/reviews/evidence/orchestration-slice-0-2026-10-08/README.md`） |
| 1 | 做完，合入 | 327ec020 | orchestration-slice-1-2026-10-08（已归档：`docs/refactor/reviews/evidence/orchestration-slice-1-2026-10-08/README.md`） |
| 3 | 做完，合入；合入时 lead 修了两处第 3 片的回归 | ccecc016、e48218a5 | orchestration-slice-3-2026-10-08（已归档：`docs/refactor/reviews/evidence/orchestration-slice-3-2026-10-08/README.md`）（含第 1、3 片的合入） |
| 5 | 实现完、冻结测试全过，但唯一一轮返工之后审查仍有大的必改问题，**没有接受，没有合入**；结果留在副本里，下一步要用户或 lead 定 | 无 | orchestration-slice-5-2026-10-08（已归档：`docs/refactor/reviews/evidence/orchestration-slice-5-2026-10-08/README.md`） |

合入第 1、3 片后（e48218a5），类型检查、模块边界检查、构建通过，全量测试 250 个测试文件、5626 项全部通过，`verify:isolated` 通过。和 9b94fc55 的 215 个文件、5234 项比，只多了第 0 片 1 个文件 3 项、第 1 片 23 个文件 212 项（另有它改过的已有状态测试多 9 项）、第 3 片 11 个文件 168 项；原有的一个不少，没有新失败。没有调用真实模型。

**写范围比规格 §6 多出来的**（lead 逐条定的，都不改用户看到的行为，除了第 5 片的 L1）：
- 三片都多 `src/ui/api/routes.ts`：`ROUTE_LABELS` 按 `CoreRouteSuffix` 穷举，新后缀不加标签 `tsconfig.ui.json` 就不过；只加本片新后缀的标签。三份规格都漏了这个文件。（2026-10-21 补注：新路由后缀不再需要在那里加标签；这个文件已删除（决定 86-2）。）
- 第 1 片（最终 95 个路径，规格是 87 个）：`src/core/work-graph/queries/contracts.ts`（`QueryExecutionDependencies.sessionFacts?`，后来加 `legacyProvenance?`）；4 个新的测试辅助文件（Codex 写夹具时加的）；3 个已有测试按规格 §5.5 最后一段改期望（`A2-rework-contract-helpers`、`C1-session-mailbox`、`A2-step1-codecs`）；Workflow 的可选依赖 `records`、`now`、`responsibilityBasis`、`legacyProvenance`，`WorkflowAdvanceResult.value.maintenanceFailures?`，Host 用的 `readTaskRequeue`。`src/app/collaboration-driver.ts` 改过又改回，净不变。
- 第 3 片（42 个路径）：允许清单没改（第 3 片的 `kept-for` 条目一个也没用到），所以规格的 42 个去掉它、加 `routes.ts`。合入时 `tests/work-graph/S3-graph-context.test.ts` 的夹具补注册第 1 片新读的记录（5 行）。
- 第 5 片（副本里 93 个路径，没合入）：A1 接受 6 个类型逼出来的文件（`src/contracts/query-job.ts`、`queries/query-job-service.ts`、`src/ui/views/sessions/render.ts`、`routes.ts`、两个已有测试）；L1 让 `src/app/host.ts` 在已有的 `createTargetPlatform` 调用里加一行 `operatorActor: actor`（不加的话生产 Host 没有操作者，每个新的用户写入都是 `unsupported`）。

**合并时的语义交叉**，比上面“三片在哪些文件上碰头”列的多一处：第 3 片把接续说明的组装从 `execution-preparation.ts` 搬进了 `context-assembler.ts`，而第 1 片改的正是这段（归档来源不带历史种子、异常锚点一段、超大时拒为 `capacity`）。lead 把第 1 片的行为搬进装配器（第 3 片证据“合入”）。

**核对的教训：**
- 第 3 片的验收只跑了点名的回归集，两处回归（平台公开键、C6 的已领取 Run 卡住）到合入后的全量才发现。以后每片在合入前跑一次全量。
- 沙箱没有 bwrap 时，“逐文件数字和基线相同”会盖住失败原因的变化；lead 的核对也要比较失败信息，并在有 bwrap 的 WSL 槽位里复跑这些文件。
- 运行上限按决定 46 改了：token 只记不拦，单步上下文超过 36 万就停，每段最多 120 分钟。第二段和返工都用新 Session、只写关键信息的说明书、分组交给子任务。实测见 [DSH-WORKFLOW §6.10](../../../DSH-WORKFLOW.md#610-大片怎么交给-dsh决定-46)。

**合入以后的接线：** 第 1、3 片都已合入，I-1、I-3 现在可以做；I-2、I-4、I-5、I-6 要等第 5 片。接线任务书照决定 46 写。

### 施工结果（2026-10-09 晚：接线包 1，第 5 片决定 47 的一轮）

| 项 | 结果 | 提交 | 证据 |
| --- | --- | --- | --- |
| 接线包 1：I-1、I-3、改目标说明的检查、普通接续的交接（决定 47 第 2–4 条） | 做完，合入 | 规格 67dfee7a，实现 6180adfc | orchestration-wiring-1-2026-10-09（已归档：`docs/refactor/reviews/evidence/orchestration-wiring-1-2026-10-09/README.md`） |
| 第 5 片，决定 47 破例多给的一轮 | 四个区域都做完、全量全过，但仍有 6 处用户看得到的问题，**没有接受，没有合入**；决定 48 再给一轮，先补测试 | 无 | 第 5 片证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-5-2026-10-08/README.md`） |

合入接线包 1 后（6180adfc），类型检查、模块边界检查、构建通过，全量测试 258 个测试文件、5,689 项全部通过，`verify:isolated` 通过。和 e48218a5 的 250 个文件、5,626 项比，逐文件只多接线包的 8 个文件 63 项。没有调用真实模型。

**接线包 1 的写范围比规格 §6 多出来的**（lead 定的，不改用户看到的行为）：测试辅助文件 4 个（规格允许最多 3 个；夹具按 4 组分，一组一个）；`tests/architecture/production-reach-allowlist.json` 删 2 条 `kept-for`（`RoleReadOptions`、`RoleConfigurationPort.readRoleSpec`，现在被 I-1 走到了；lead 决定 W-I1）。共 25 个路径。

**现在的接线状态：** I-1、I-3 已接；I-2、I-4、I-5、I-6 等第 5 片合入。I-4 接自治级别时不改 Goal 内容摘要 G；接线包 2 规格 §0.3 已撤回接线包 1 L3 的这条预告（决定 49、56）。I-4、I-6 都在 `views/context-extensions.ts` 的提供方里接。第 5 片合入时要和接线包三方合并（两边都改了 Workflow 的 `workflow.ts`、`contracts.ts`、`ports.ts`，`create-platform.ts`、`context-assembler.ts`、`execution-entry-service.ts`、`context-input.ts`；接线包规格 §0.3）。

**第 5 片这一轮的情况：** 先换到合入第 0、1、3 片后的基线（18 个文件 53 处冲突，lead 按规则合并；合并后的 6 处问题 M1–M6 和两处第 5 片自己的回归 R1、R2 由 lead 修，R2 只有全量才跑出来），lead 改了决定 47 点名的 5 个小问题，再把大的分成四个区域（队列历史、决定来源和答复、排序的安全点、设置的重放）各交一个新的 DSH 会话，每个区域之后 Codex 复审、lead 修小的；B 区用了那一次破例多做一轮。合起来全量 266 个文件、5,850 项全过。剩下的 6 条（暂停后自动化确认卡消失、Agent 采纳计划记不下按谁的决定、重试读失败挡住重放、关闭历史没有先后、超量不报“容量不足”、初始化采纳后卡不关闭）和“这些地方都没有测试覆盖”见证据。

**核对的教训（补充）：**
- 第 5 片前几轮“冻结测试全过、问题靠审查找出来”的根本原因是测试没覆盖；每一轮修好一些，审查又找到一些。决定 48 改成先由 Codex 补测试、lead 冻结，再修。
- 换基线时只有全量才跑出一处回归（R2：格式不对的请求让第 5 片的闸门抛异常），点名集合没覆盖到。合入前跑全量这条规则照旧。
- 两条轨道同时做时，测试一次只跑一个成了瓶颈：接线包这边为等测试锁花了约 76 分钟（第 5 片那边的全量用 `--maxWorkers=1`，一次 26–31 分钟）。

### 施工结果（2026-10-09 夜：第 5 片决定 48 的一轮，合入）

| 项 | 结果 | 提交 | 证据 |
| --- | --- | --- | --- |
| 第 5 片，决定 48 再破例的一轮（先补测试） | 做完，验收，**合入** | a7cafccc（用例表 [slice-5-round2-TESTS](slice-5-round2-TESTS.md) 在同一个提交里） | 第 5 片证据（已归档：`docs/refactor/reviews/evidence/orchestration-slice-5-2026-10-08/README.md`） |

合入第 5 片后（a7cafccc），类型检查、模块边界检查（WorkGraph 135 个源码文件，子模块边 49 条）、构建通过，全量测试 279 个测试文件、5,974 项全部通过，`verify:isolated` 通过。和 6180adfc 的 258 个文件、5,689 项比，逐文件只多第 5 片的 21 个文件 285 项（规格里的 16 个文件 224 项，加补测的 5 个文件 61 项）。没有调用真实模型。

**第 5 片最终的写范围**（104 个路径，规格 §6 是 82 个）：决定 48 之前的 93 个（规格的 82 个，加 A1 的 6 个类型逼出来的文件、Codex 写夹具时加的 4 个测试辅助文件、L1 的 `src/app/host.ts`）；这一轮加补测的用例表、5 个测试文件、4 个辅助文件，以及区域 2 改的 `src/core/agent-runtime/whiteboard-tools.ts`（在区域 2 的范围里）。区域 2 改了范围外的 `src/contracts/plan.ts`、`tasks/plan-commit-compiler.ts`（只在带决定证明的计划采纳事件上加两个字段），这两个文件本来就在 93 个里，lead 接受为 T-R2-1b。

**这一轮怎么做的：** 先和接线包 1 三方合并（6 个文件两边都改了，都自动合好）；lead 写补测的用例表（37 行：RED 11 行、GREEN 26 行），4 个 Codex 并行写测试，测试找出一个新问题 N-R2-1（Workflow 发出的自动化确认卡，用它自己给的来源读不到答复），lead 冻结 9 个文件；冻结时全量正好 20 项失败。再分四个区域（自动化确认卡；Agent 采纳的出处和补记重试；冲突答复的重试；已关闭历史的先后和“容量不足”）各交一个新的 DSH 会话，一次做完，没用跟进说明书，上下文峰值 8.3 万–11.7 万；每个区域之后 Codex 复审，最后合起来再审一次；lead 修 5 处（LR1、LR1b、LR3、LR4、LR5），另 5 条定为技术选择（T-R2-1b、1c、2a、3a、3b）。

**留下的：**
- 原第 6 条（回答了“缺初始架构 / 缺完成标准”的卡在初始化采纳后关闭）移到第 6 片（决定 48）。
- LB-1、接线包 L13 照 lead 的做法，用户可改。
- 【已定（决定 49）】第 28 项把 5,000 条旧索引窗口的规模问题放进第 2 片：缩窄到相关决定、未解决来源并完整分页，旧执行按时间段读；待答、待落实不按年龄丢弃，局部结果和故障如实显示。
- 小的几处见证据“留下的、没做的”（例如 `readLookupKeys` 超量仍回“不完整”；LR1 的正好 5,000 项边界、LR4、LR5 没有测试）。

**现在的接线状态：** I-1、I-3 已接（接线包 1）；I-2、I-4、I-5、I-6 现在可以做，照决定 46 写说明书交 DSH。I-4 接自治级别时不改 Goal 内容摘要 G；接线包 2 规格 §0.3 已撤回 L3 的这条预告（决定 49、56）。I-4、I-6 在 `views/context-extensions.ts` 的提供方里接。

**核对的教训（补充）：**
- **先补测试再修，这次一轮就收住了。** 补的测试把审查找出的问题变成冻结时就失败的用例，DSH 照着改，四个区域都没用跟进说明书；冻结测试过了以后，Codex 复审只剩窄的几处（一处窗口边界、一处抛异常的读、一处超量时的返回码），lead 自己改了。之前两轮“冻结测试全过、问题靠审查找”的情况没有再出现。
- **写测试的过程本身会找出问题。** 原以为修好的 R2B01 一跑就失败，找出 N-R2-1；另外 3 处失败是测试自己的搭建错，冻结前改掉。用例表里写明“现在应当失败还是通过、失败在哪一步”，这两类才分得开。
- **说明书里的预期数字要按实际文件算。** 两份区域说明书写“做完后 `git status` 是 103 行”，但范围里有一个原来干净的文件，一改就是 104；区域 1 为了凑 103 改了放帮助函数的位置。以后预期数字由脚本从副本里算，不手数。
- **按路径提交会按 `core.autocrlf` 改换行。** 补丁里一个辅助文件有一个多余的回车，提交后被存成 LF，冻结 sha256 差一个字节（T-I-1）。以后冻结前先把冻结文件的换行统一。

### 怎么来的

Codex 三份草稿同时起草（第 1 片 65 分钟、第 3 片 72 分钟、第 5 片 39 分钟；见 lead 临时目录的 `slices/DRAFTS.md`）。lead 冻结时：在 9b94fc55 上抽查了约 110 个 `file:symbol` 引用（都存在），找到四处和当前代码不符（第 1 片漏了 `core-http-types.ts`；第 3 片要删的两个文件已在 7e0b7f56 删掉、`graphHistory` 已是必填依赖；第 5 片说的 `pureDirectories` 已退役），并统一了三片共用的东西（职责类型、`views` 的依赖、合入顺序）。冻结记录在 lead 临时目录的 `slices/FREEZE.md`。
