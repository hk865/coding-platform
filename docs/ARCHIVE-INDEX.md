# 历史文档存档索引

`docs/` 只保留现行文档。历史文档（旧任务书、旧设计、旧审查和全部验收证据）已移到仓库外的存档：

- **存档位置：** `D:\1.project\Software\agent-next-archive\`，目录结构与仓库相同，仓库内原路径照搬。
- **移走前最后包含这些文件的提交：** `ef4f8de1`。
- **取回方法：** `git show ef4f8de1:<仓库内原路径>`。例如 `git show ef4f8de1:docs/refactor/tasks/R4-control-recovery-skeleton.md`。
- 本索引只记存档位置和一句话用途，不复制原文，也不改变原文结论。

## 整个文件夹移走

| 路径 | 文件数 | 是什么 |
| --- | ---: | --- |
| `docs/history/` | 17 | 2026-09-22 前的历史产品稿、架构审阅、决定建议与旧索引。 |
| `docs/refactor/archive/` | 29 | 2026-09-23 前的旧设计/模块稿、旧提示词和旧入口。 |
| `docs/refactor/references/` | 14 | 代码质量规范引用的上游原文（Airbnb、Google、Sentry）。 |
| `docs/refactor/reviews/` | 4,077 | 历次任务与分片的审查报告、验收证据、日志、截图和探针。 |
| `docs/refactor/skeleton/` | 3 | 旧共同契约、五模块骨架总览与端到端贯通流程。 |
| `docs/refactor/tasks/` | 333 | 旧任务书、范围 JSON、派工与返工记录。 |

以上合计 4,473 个文件；与下面逐文件列出的 70 个文件相加，等于本次移走的 4,543 个文件。

## 部分移走：逐文件

### `docs/`（根）

| 路径 | 是什么 |
| --- | --- |
| `docs/AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md` | 2026-09-25 的双图、Agent、生命周期与编排对齐记录。 |
| `docs/agent-platform-user-replies-numbered.md` | 架构未决项目的用户回复原文与编号对应。 |

### `docs/refactor/`（根）

| 路径 | 是什么 |
| --- | --- |
| `docs/refactor/AGENT-BEHAVIOR-PLAN.md` | Agent 职责、行为与执行计划。 |
| `docs/refactor/AGENT-ROLE-ACTIONS.md` | Agent 通用行为与按需分工。 |
| `docs/refactor/CODE-QUALITY-RESEARCH.md` | 代码质量规范调研与模块文档融入方案。 |
| `docs/refactor/CORE-STRUCTURES-AND-ORCHESTRATION.md` | 核心数据结构、原子操作与编排状态机图解。 |
| `docs/refactor/DOC-INVENTORY.md` | 旧文档盘点草稿（决定 58）；现行文档清单以 `docs/README.md` 为准。 |
| `docs/refactor/DSH-EXECUTION-HARNESS.md` | 分阶段骨架、冻结契约与 dsh 实现环境。 |
| `docs/refactor/IMPLEMENTATION-PLAN.md` | 从核心结构到实际源码的重构实施方案（历史）。 |
| `docs/refactor/MODULE-REFACTOR-INTENT-REVIEW.md` | 从作者意图、复用与职责减负重审模块设计。 |
| `docs/refactor/MODULE-REVIEW.md` | 模块分工详细审查报告。 |
| `docs/refactor/ORCHESTRATION-STATE-MACHINES.md` | 编排状态机与执行协议；可执行表格在现行的 `STATE-MACHINES-SPEC.md`。 |
| `docs/refactor/PARALLEL-COLLABORATION.md` | 并行协作接口审阅与结构图。 |

### `docs/refactor/design/orchestration-2026-10/`（设计目录）

| 路径 | 是什么 |
| --- | --- |
| `docs/refactor/design/orchestration-2026-10/D-PLACEMENT.md` | 任务 D 重算用：新东西放在 WorkGraph 的哪一层。 |
| `docs/refactor/design/orchestration-2026-10/LEAD-NOTES.md` | 设计第 34 轮的 lead 裁定（2026-10-07）。 |
| `docs/refactor/design/orchestration-2026-10/QUESTIONS.md` | 设计第一轮需要用户决定的问题。 |
| `docs/refactor/design/orchestration-2026-10/STATE.md` | 设计第一轮的现状：编排、记忆、生命周期。 |
| `docs/refactor/design/orchestration-2026-10/STRUCTURE-DRAFT.md` | 设计第一轮的结构草案。 |
| `docs/refactor/design/orchestration-2026-10/model/REVIEW-SLICES-1-3-5.md` | 冻结第 1、3、5 片之前的一页审阅。 |
| `docs/refactor/design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-OPINIONS.md` | 第 2、4、6、7 片的意见与结论合并稿。 |
| `docs/refactor/design/orchestration-2026-10/model/SCENARIOS.md` | 合并后的场景稿。 |
| `docs/refactor/design/orchestration-2026-10/model/readers/` | 六组读者场景（R1–R6）的动作、矩阵、覆盖与说明（15 个文件）。 |
| `docs/refactor/design/orchestration-2026-10/slices/slice-0-book-part1.md` | 第 0 片任务书上半：测试后停。 |
| `docs/refactor/design/orchestration-2026-10/slices/slice-0-book-part2.md` | 第 0 片任务书下半：实施一行改动。 |
| `docs/refactor/design/orchestration-2026-10/slices/slice-1-book-part1.md` | 第 1 片任务书上半：类型、桩与测试后停。 |
| `docs/refactor/design/orchestration-2026-10/slices/slice-1-book-part2.md` | 第 1 片任务书下半：实施。 |
| `docs/refactor/design/orchestration-2026-10/slices/slice-3-book-part1.md` | 第 3 片任务书上半：类型、桩与测试后停。 |
| `docs/refactor/design/orchestration-2026-10/slices/slice-3-book-part2.md` | 第 3 片任务书下半：实施。 |
| `docs/refactor/design/orchestration-2026-10/slices/slice-5-book-part1.md` | 第 5 片任务书上半：类型、桩与测试后停。 |
| `docs/refactor/design/orchestration-2026-10/slices/slice-5-book-part2.md` | 第 5 片任务书下半：实施。 |

### `docs/refactor/intent/`

| 路径 | 是什么 |
| --- | --- |
| `docs/refactor/intent/2026-09-23-PARALLEL-AND-PRODUCT.md` | 并行协作与 PRODUCT 的用户补充原话。 |
| `docs/refactor/intent/2026-09-24-DSH-HARNESS.md` | Sol 骨架、独立测试与 dsh 实现约束。 |
| `docs/refactor/intent/2026-09-24-TARGET-PROJECT.md` | 独立目标工程的用户澄清与实施纠偏。 |
| `docs/refactor/intent/ORIGINAL-DIALOGUE.md` | 本轮架构讨论的原始对话。 |
| `docs/refactor/intent/assets/gimg.jpeg` | 原对话中的附图。 |
| `docs/refactor/intent/original-dialogue.json` | 原对话的结构化记录。 |

### `docs/refactor/modules/`（模块文档）

| 路径 | 文件数 | 是什么 |
| --- | ---: | --- |
| `docs/refactor/modules/ownership-map.md` | 1 | 共同实现、旧消费者与迁移归属。 |
| `docs/refactor/modules/business/` | 1 | Workflow 业务流程与策略的实现骨架。 |
| `docs/refactor/modules/control/` | 6 | 旧控制层模块（生命周期、架构协调、控制、派发、计划编译、检查）迁移入口。 |
| `docs/refactor/modules/core/` | 4 | AgentRuntime、RecordStore、WorkGraph、WorkspaceTools 的实现骨架。 |
| `docs/refactor/modules/data/` | 5 | 旧数据层模块（产物库、上下文编译、读模型、状态账本、工作区读取）迁移入口。 |
| `docs/refactor/modules/execution/` | 1 | WorkerRuntime 旧模块迁移入口。 |
| `docs/refactor/modules/interaction/` | 1 | HumanCollaboration 旧模块迁移入口。 |

### `docs/ui-reference/`

| 路径 | 是什么 |
| --- | --- |
| `docs/ui-reference/agent-workbench.source.html` | 旧工作台原型的可编辑源文件；渲染后的页面仍在 `docs/ui-reference/agent-workbench.html`。 |

## 移走之后新加的证据

移走（`ef4f8de1`）之后新产生的证据直接写进同一个存档，不在仓库里另建一套。

| 路径 | 是什么 |
| --- | --- |
| `docs/refactor/reviews/slice6a1-2026-10-24/` | 6A-1 的任务书、findings 表、Codex 审查和复核、DSH 回复、检查日志（全量、规模批、合并检查）。lead 2026-10-24 复制进存档，不在上面 4,543 个文件的清单里。 |
| `docs/refactor/reviews/slice6a2-2026-10-24/` | 6A-2 的任务书、findings 表、Codex 审查和复核、DSH 回复、变异证据、检查日志（全量、规模批、合并检查）。lead 2026-10-24 复制进存档，不在上面 4,543 个文件的清单里。 |
