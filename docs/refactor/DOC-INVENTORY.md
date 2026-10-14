# 文档盘点（决定 58 草稿）

**这是什么。** 这是 DSH 按决定 58 做的 `docs/` 全量盘点草稿，一行一个文件或一个证据文件夹，标出它今天是什么、给谁用、和谁合读。lead 审、Codex 审以后再据它定现行文档集合。

**状态口径（只能选一个）。** 现状如下：

- **现行**：今天就是设计依据。判定看 `docs/README.md`、`docs/refactor/README.md`、设计目录首页、`model/README.md`、`slices/README.md` 有没有把它列为当前入口，以及文件自己的状态行；不因为文件看起来新就标现行。
- **参考**：仍然正确的背景，不是依据。
- **历史**：为保留当时记录而留下。
- **已被取代**：写明被谁取代。
- **证据**：某批或某片的验收证据。
- **待 lead 定**：不确定，后面写一行原因。

**链接口径。** 本文件在 `docs/refactor/DOC-INVENTORY.md`，所有链接都相对本文件；`docs/xxx` 写成 `../xxx`，`docs/refactor/xxx` 写成 `xxx`。

**状态小结（按表格行）。**

| 状态 | 行数 |
| --- | ---: |
| 现行 | 39 |
| 参考 | 23 |
| 历史 | 184 |
| 已被取代 | 6 |
| 证据 | 75 |
| 待 lead 定 | 0 |
| 合计 | 327 |

> `tasks/` 的 333 个文件按任务家族并入 101 行（一行一个任务书，同名 `-scope`/`-stage`/返修 json 并入该行）；`reviews/evidence/` 按文件夹一行；10 块 `*.dc.html` 画板合并为一行。除这三处，其余一行一个文件。
>
> **状态小结的变动（2026-10-14，按 lead 的盘点裁定）：** 5 篇模块页 `modules/business/workflow.md`、`modules/core/{agent-runtime,record-store,work-graph,workspace}.md` 由 **现行** 改 **历史**（原 `modules/README.md` 的“待 lead 定”随之定为 **参考**）；`model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md` 由 **参考** 改 **现行**，它依据的问题页与用户回复页改 **现行（只限决定 49 采用的条目）**，`ui-reference/agent-workbench.html` 改 **现行（只限 UI-WORKBENCH §0 没有替换的部分）**。据此行数由 40/24/181/6/75/1 变为 39/23/184/6/75/0。

> **规格落点补注。** 第 2B、2C 片、资源上限片和 K3 的规格在冻结前放在 lead 的笔记里，冻结时才提交进 `slices/`；仓库里的 `slice-K3-SPEC.md` 是旧稿（第五稿，决定 56 定的“审一次就停”，未冻结）。所以盘点对这几片只看 lead 笔记，不把旧稿当冻结规格；旧稿仍按草稿标 **参考**。

**本次按任务书第 3 条改掉的两处过期状态**（只改事实，不改设计）：

- `docs/README.md`：日期与状态行改为 2026-10-14、接线包 2 与 K 片 A、B 已合入、2A 冻结施工。
- `design/orchestration-2026-10/README.md`：当前状态行改为 2026-10-14、同一批已合入状态。

**冲突清单在文件末尾。** 只列现行/参考文件里和 HANDOFF 决定 1–58 不一致的地方。按 lead 的裁定，现行文档已经改到与决定一致、冻结规格只在标题后加注、历史与证据文件不改；每项标 **已改** 或 **待 lead 定**。剩下的 **待 lead 定** 只有第 66–69 项（冻结原型是否逐个补注）。

## docs/ 根（README、AGENTS、PRODUCT、MVP-BEHAVIOR、UI-WORKBENCH 等）

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [../README.md](../README.md) | 现行 | 文档总入口：先读 STATUS/HANDOFF 顶部，再按问题进入设计、分片、界面、产品与历史。 | 与 STATUS、HANDOFF 顶部、docs/AGENTS.md 合读。 |
| [../AGENTS.md](../AGENTS.md) | 现行 | 只约束 `docs/` 阅读与维护的规则：文档由 lead 逐行负责、历史保留原义、发现矛盾列出出处。 | 与根 AGENTS.md、HANDOFF 顶部合读；是 docs 维护的当前入口。 |
| [../MVP-BEHAVIOR.md](../MVP-BEHAVIOR.md) | 现行 | 当前产品目标的行为细化与端到端验收边界，声明“不是实现完成报告”。 | 与 PRODUCT、HANDOFF、STATUS、分片规格合读。 |
| [../PRODUCT.md](../PRODUCT.md) | 现行 | 当前产品目标与承诺（定位、职责、双图、MVP 范围），不表示能力已实现。 | 与 MVP-BEHAVIOR、STATUS、HANDOFF 顶部、编排设计书合读；历史 PRODUCT 是归档原稿。 |
| [../UI-WORKBENCH.md](../UI-WORKBENCH.md) | 现行 | 工作台交互规范；§0 汇总 2026-10-04 起界面决定与冻结后的修改，是界面权威之一。 | 与冻结原型目录、E3-UI-ITEMS 合读；`agent-workbench.html` 只补 §0 未替换的部分。 |
| [../AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md](../AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md) | 历史 | 2026-09-25 的双图/Agent/生命周期对齐记录；采用结论已回填到意图与决定和能力索引。 | 只在追溯来历时与 `refactor/intent/` 合读；不作为当前编排依据。 |
| [../agent-platform-user-replies-numbered.md](../agent-platform-user-replies-numbered.md) | 历史 | 2026-09-21 用户 14 段原话与未决项编号，按原字节保存用于追溯意图。 | 与 `history/before-2026-09-22/` 同名副本、PRODUCT 引用的“14 段用户原话”合读；不是当前施工指令。 |

## ../history/（含 before-2026-09-22 归档）

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [../history/README.md](../history/README.md) | 历史 | `history/` 历史索引，说明归档范围、原稿不在当前区以及“不作为当前施工指令”。 | 与 `before-2026-09-22/README.md`、`manifest.json`、`refactor/archive/` 合读。 |
| [../history/before-2026-09-22/README.md](../history/before-2026-09-22/README.md)（归档文件夹，整体一行） | 历史 | 2026-09-22 前 13 份原稿的归档索引；文件为 PRODUCT (副本).md、PRODUCT.md、agent-platform-architecture-review.md、agent-platform-decision-recommendations[-revised].md、agent-platform-open-decisions-recommendations.md、agent-platform-user-replies-numbered.md、agent-team-dsh-research.md、agent-vs-agent-team.md、refactor/ARCHITECTURE (副本).md、refactor/source-analysis.md、refactor-prompts.md、refactor-prompts.revised (副本).md，另有 manifest.json、validation.json。 | 与当前 PRODUCT、`refactor/intent/` 合读；需求来源仍可追溯，但旧路径、旧 13 模块和 Prompt 5 结论不作当前指令。 |

## ../ui-reference/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [../ui-reference/agent-workbench.html](../ui-reference/agent-workbench.html) | 现行（只限 UI-WORKBENCH §0 没有替换的部分） | 旧工作台单文件原型；UI-WORKBENCH §0 没有替换的交互仍作当前基线，被替换点以 §0 为准。 | 与 UI-WORKBENCH §0、冻结原型目录合读；被替换点由 `workbench-2026-10` 冻结画板取代，不得按旧原型纠正回去。 |
| [../ui-reference/agent-workbench.source.html](../ui-reference/agent-workbench.source.html) | 参考 | `agent-workbench.html` 的原型源码（未包装版），供核对旧原型的样式和交互实现。 | 与 `agent-workbench.html` 合读；范围同样限于 §0 未替换的交互。 |
| [../ui-reference/workbench-2026-10/](../ui-reference/workbench-2026-10/)（*.dc.html 十块画板，整体一行） | 现行 | 2026-10-07 冻结的新工作台原型第 16 版，10 块画板：ArchOverview、Chain、Decide、Done、Goals、Main、Member、Phone、Plan、TaskMap。 | 与 `workbench-2026-10/README.md`、UI-WORKBENCH §0 合读；冻结后的决定 37、38 改到的点以 §0 为准。 |
| [../ui-reference/workbench-2026-10/README.md](../ui-reference/workbench-2026-10/README.md) | 现行 | 冻结原型入口：批准/冻结经过、各文件用途、示例数据不是产品数据、以画板加 §0 为准。 | 与 UI-WORKBENCH §0、E3-UI-ITEMS 合读；是 E3 新界面的界面基线索引。 |
| [../ui-reference/workbench-2026-10/DESIGN.md](../ui-reference/workbench-2026-10/DESIGN.md) | 参考 | 原型的英文设计说明（状态词、方格、颜色、组件、改版记录和检查方法），解释第 16 版画板。 | 与十块画板、`data/`、UI-WORKBENCH §0 合读；不是产品接口规范。 |
| [../ui-reference/workbench-2026-10/canvas.json](../ui-reference/workbench-2026-10/canvas.json) | 参考 | Design 画布上 10 块画板的位置、标题和尺寸配置。 | 与十块画板文件合读；只影响画布排版。 |
| [../ui-reference/workbench-2026-10/SHA256SUMS](../ui-reference/workbench-2026-10/SHA256SUMS) | 参考 | 冻结第 16 版画板、`kit.css`、`canvas.json` 的 SHA-256 完整性清单。 | 与 `workbench-2026-10/README.md`（决定 35 的冻结说明）合读，用于核对复制件未变。 |
| [../ui-reference/workbench-2026-10/kit.css](../ui-reference/workbench-2026-10/kit.css) | 现行 | 冻结原型 10 块画板共用的样式表，是界面基线的组成部分。 | 与十块画板、UI-WORKBENCH §0 合读。 |
| [../ui-reference/workbench-2026-10/data/README.md](../ui-reference/workbench-2026-10/data/README.md) | 参考 | 说明 `data/` 每份共用代码/示例数据粘贴到哪块画板、依赖什么、哪些文件是生成的。 | 与 `DESIGN.md`、`data/` 源文件、`WORKLINES.md` 合读。 |
| [../ui-reference/workbench-2026-10/data/WORKLINES.md](../ui-reference/workbench-2026-10/data/WORKLINES.md) | 参考 | 原型的工作线模型与示例数字：一条线＝一个 Session 加接续、计数分开写、每块画板的替换清单。 | 与 `worklines.js`/`worklines-snap.js`、UI-WORKBENCH §0、决定 25/30 合读。 |
| [../ui-reference/workbench-2026-10/data/](../ui-reference/workbench-2026-10/data/)（其余源文件，整体一行） | 参考 | 画板里逐字粘贴的共用代码和示例数据源：arch-semantic.js、timeline.js、timeview.snippet.html/js、auxtabs.snippet.html/js、squares.js、worklines.js、worklines-long.js、worklines-snap.js、taskpanel.snippet.html/js、lineview.snippet.html/js（不含已单列的 README.md、WORKLINES.md）。 | 与 `data/README.md`、`DESIGN.md`、十块画板合读；示例数据不代表产品能力。 |

## docs/refactor/（根文件）

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [AGENT-BEHAVIOR-PLAN.md](AGENT-BEHAVIOR-PLAN.md) | 历史 | 2026-09-27 至 09-29 的 Agent 职责、行为与执行计划（含 AG1–AG6 导入与限定验收）。 | 仅追溯；当前职责与编排读 [HANDOFF.md](HANDOFF.md) 顶部与 [design/orchestration-2026-10/DESIGN.md](design/orchestration-2026-10/DESIGN.md)。 |
| [AGENT-ROLE-ACTIONS.md](AGENT-ROLE-ACTIONS.md) | 历史 | 展开 2026-09-27 的角色职责、通用行为与动作对账。 | 仅追溯；当前角色/编排见 [HANDOFF.md](HANDOFF.md) 与 [design/orchestration-2026-10/DESIGN.md](design/orchestration-2026-10/DESIGN.md)。 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 现行 | 目标架构、核心数据结构、五模块职责与边界（文档链的架构总纲）。 | 与 [module-dag.md](module-dag.md)、[module-target.json](module-target.json)、[modules/README.md](modules/README.md) 合读；正文的迁移状态行以 [STATUS.md](STATUS.md) 为准。 |
| [CODE-QUALITY-GUIDELINES.md](CODE-QUALITY-GUIDELINES.md) | 现行 | 本轮重构与实现审查的代码质量共同要求（CQ-01～CQ-12、RG-01～RG-06）。 | 与 [CODE-QUALITY-RESEARCH.md](CODE-QUALITY-RESEARCH.md)（历史）合读；落地进度与证据以 [STATUS.md](STATUS.md) 为准。 |
| [CODE-QUALITY-RESEARCH.md](CODE-QUALITY-RESEARCH.md) | 历史 | 2026-09-22 的代码质量外部调研与规范融入方案的过程记录。 | 仅追溯；要求以 [CODE-QUALITY-GUIDELINES.md](CODE-QUALITY-GUIDELINES.md) 为准。 |
| [CORE-DATA-OPERATIONS.md](CORE-DATA-OPERATIONS.md) | 参考 | 核心对象、字段与原子操作的接口/一致性参考。 | 与 [STATE-MACHINES-SPEC.md](STATE-MACHINES-SPEC.md)、[skeleton/CONTRACTS.md](skeleton/CONTRACTS.md) 合读；旧存储落点勿当现行模块（见 conf-2）。 |
| [CORE-STRUCTURES-AND-ORCHESTRATION.md](CORE-STRUCTURES-AND-ORCHESTRATION.md) | 历史 | 2026-09-23/24 的核心数据结构、原子操作与编排状态机静态图解。 | 仅追溯；当前状态机见 [STATE-MACHINES-SPEC.md](STATE-MACHINES-SPEC.md)。 |
| [DSH-EXECUTION-HARNESS.md](DSH-EXECUTION-HARNESS.md) | 已被取代 | 旧 `harness.py` lane 挂载与 hyh001 路径的 DSH 施工环境说明。 | 由 [DSH-WORKFLOW.md](DSH-WORKFLOW.md) §1、§6 取代（bubblewrap 运行器）。 |
| [DSH-WORKFLOW.md](DSH-WORKFLOW.md) | 现行 | 本地 DSH 的分批/两阶段施工、任务书写法与实测入口。 | 与 [HANDOFF.md](HANDOFF.md) 决定 36、43、46、56 及 [design/orchestration-2026-10/slices/README.md](design/orchestration-2026-10/slices/README.md) 合读。 |
| [HANDOFF.md](HANDOFF.md) | 现行 | 用户决定 1–58 与各批历史（只追加、不改写）。 | 与 [STATUS.md](STATUS.md) 合读；当前状态以 STATUS 为准。 |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | 历史 | 2026-09-23 至 09-29 从核心结构到源码的迁移实施与批次计划。 | 仅追溯；当前进度见 [STATUS.md](STATUS.md)，施工见 [design/orchestration-2026-10/slices/README.md](design/orchestration-2026-10/slices/README.md)。 |
| [IMPLEMENTED-CAPABILITIES.md](IMPLEMENTED-CAPABILITIES.md) | 现行 | 已实现原子能力、源码入口与复用前提的索引。 | 与 [STATUS.md](STATUS.md)、各片规格和源码/测试核对合读。 |
| [MODULE-REFACTOR-INTENT-REVIEW.md](MODULE-REFACTOR-INTENT-REVIEW.md) | 历史 | 2026-09-22 对旧 13 模块方案作者意图、复用与职责减负的评审。 | 仅追溯；当前模块见 [ARCHITECTURE.md](ARCHITECTURE.md)、[module-target.json](module-target.json)。 |
| [MODULE-REVIEW.md](MODULE-REVIEW.md) | 历史 | 2026-09-21 对旧 13 模块分工与接口的审查报告。 | 仅追溯；当前模块见 [ARCHITECTURE.md](ARCHITECTURE.md)、[module-target.json](module-target.json)。 |
| [ORCHESTRATION-STATE-MACHINES.md](ORCHESTRATION-STATE-MACHINES.md) | 参考 | 协作主图、Agent 状态/转换与编排执行协议的设计背景。 | 与 [STATE-MACHINES-SPEC.md](STATE-MACHINES-SPEC.md)、[design/orchestration-2026-10/DESIGN.md](design/orchestration-2026-10/DESIGN.md) 合读；状态机章节已由前者转写。 |
| [PARALLEL-COLLABORATION.md](PARALLEL-COLLABORATION.md) | 历史 | 2026-09-24 的并行协作接口审阅与结构图（旧范围预占协议已撤回）。 | 仅追溯；并行规则见 [HANDOFF.md](HANDOFF.md) 决定 49 与 DESIGN。 |
| [README.md](README.md) | 现行 | `docs/refactor/` 的阅读入口与当前文档索引。 | 与 [../README.md](../README.md)、[STATUS.md](STATUS.md)、[HANDOFF.md](HANDOFF.md) 合读。 |
| [STATE-MACHINES-SPEC.md](STATE-MACHINES-SPEC.md) | 现行 | 已确认的运行可靠性状态机规格（逐行可执行、带测试对照）。 | 与 [ORCHESTRATION-STATE-MACHINES.md](ORCHESTRATION-STATE-MACHINES.md)（来源）及各片规格合读。 |
| [STATUS.md](STATUS.md) | 现行 | 当前状态、已合入批次、缺口与下一步（直接改写、不追加）。 | 与 [HANDOFF.md](HANDOFF.md)、[IMPLEMENTED-CAPABILITIES.md](IMPLEMENTED-CAPABILITIES.md) 合读。 |
| [module-dag.md](module-dag.md) | 现行 | 目标 5 模块/8 边 DAG、旧依赖处置与 WorkGraph 子模块分层。 | 与 [ARCHITECTURE.md](ARCHITECTURE.md)、[module-target.json](module-target.json) 合读。 |
| [module-target.json](module-target.json) | 现行 | 模块/子模块路径与允许依赖的机器可读单一来源（`check-boundaries` 读它）。 | 与 [module-dag.md](module-dag.md)、[ARCHITECTURE.md](ARCHITECTURE.md) 合读。 |

## design/orchestration-2026-10/（根）

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [design/orchestration-2026-10/D-PLACEMENT.md](design/orchestration-2026-10/D-PLACEMENT.md) | 历史 | 任务 D 重算前的放置输入：WorkGraph 新东西的分层、要加的边和必须一直禁止的方向。 | 当前子模块声明由 [module-target.json](module-target.json) 取代；任务 D 已完成，只追溯时与 [DESIGN §7](design/orchestration-2026-10/DESIGN.md) 合读。 |
| [design/orchestration-2026-10/DESIGN.md](design/orchestration-2026-10/DESIGN.md) | 现行 | 合并后的设计书：你看到和做的事、编排、记忆、生命周期、上下文与工具、放置与分片依赖。 | 设计总依据；与 [HANDOFF 决定 1–58](HANDOFF.md) 合读，冲突按决定。 |
| [design/orchestration-2026-10/E3-UI-ITEMS.md](design/orchestration-2026-10/E3-UI-ITEMS.md) | 现行 | A.2 第 5 步与后续决定留下的界面待办清单，随新界面（E3）交付。 | 与 [DESIGN.md](design/orchestration-2026-10/DESIGN.md)、[UI-WORKBENCH §0](../UI-WORKBENCH.md#ui-decisions-2026-10)、[冻结原型](../ui-reference/workbench-2026-10/README.md) 合读；状态段已过期（见 conf-3）。 |
| [design/orchestration-2026-10/LEAD-NOTES.md](design/orchestration-2026-10/LEAD-NOTES.md) | 历史 | 2026-10-07 lead 对第一轮交付的取舍、简化删除项和要问用户的问题（18 行）。 | 采纳结果已并入 [DESIGN.md](design/orchestration-2026-10/DESIGN.md) 和 [HANDOFF 决定 34/35](HANDOFF.md)。 |
| [design/orchestration-2026-10/MEMORY-LOOKUP.md](design/orchestration-2026-10/MEMORY-LOOKUP.md) | 现行 | 决定 49 采用的双图记忆查找方案，第 4 片的输入（具体接口待冻结）。 | 与 [DESIGN §3.7/§8.2](design/orchestration-2026-10/DESIGN.md)、[MODEL](design/orchestration-2026-10/model/MODEL.md)、[AMBIGUITIES](design/orchestration-2026-10/model/AMBIGUITIES.md) 合读。 |
| [design/orchestration-2026-10/QUESTIONS.md](design/orchestration-2026-10/QUESTIONS.md) | 历史 | 第一轮 23 个要用户定的问题及建议，并按挡住哪一片排序。 | 决定 35 已全部答复；答案并入 [DESIGN 附录 B](design/orchestration-2026-10/DESIGN.md)。 |
| [design/orchestration-2026-10/README.md](design/orchestration-2026-10/README.md) | 现行 | 设计目录的入口与索引，标出仍在用和已答复/历史的文件。 | 与 [STATUS](STATUS.md)、[HANDOFF](HANDOFF.md) 合读；第 5 行的状态段已过期（见 conf-3）。 |
| [design/orchestration-2026-10/STATE.md](design/orchestration-2026-10/STATE.md) | 历史 | 2026-10-06 在 HEAD `42604b3` 上的现状调查：已有、缺什么。 | 当前状态看 [STATUS](STATUS.md)，设计看 [DESIGN.md](design/orchestration-2026-10/DESIGN.md)。 |
| [design/orchestration-2026-10/STRUCTURE-DRAFT.md](design/orchestration-2026-10/STRUCTURE-DRAFT.md) | 历史 | 第一轮结构草案：子模块分层、边和 0–9 片施工顺序。 | 结构结论已并入 [DESIGN §7–§8](design/orchestration-2026-10/DESIGN.md)；当前子模块看 [module-target.json](module-target.json)。 |

## design/orchestration-2026-10/model/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [design/orchestration-2026-10/model/AMBIGUITIES.md](design/orchestration-2026-10/model/AMBIGUITIES.md) | 现行 | 74 项模糊点及每项顶部的已定答复（决定 42、49 等），读模型的一项索引。 | 与 [DESIGN.md](design/orchestration-2026-10/DESIGN.md)、[HANDOFF 决定](HANDOFF.md) 合读；各项顶部为准。 |
| [design/orchestration-2026-10/model/DIAGRAMS.md](design/orchestration-2026-10/model/DIAGRAMS.md) | 现行 | 多视角 Mermaid 图：对象关系、状态图、组合时序；按决定 42–49 和接线包 2 L10–L12 更新。 | 与 [DESIGN.md](design/orchestration-2026-10/DESIGN.md)、[MODEL](design/orchestration-2026-10/model/MODEL.md) 合读；第 139 行未对齐决定 43/54（见 conf-3）。 |
| [design/orchestration-2026-10/model/MODEL.md](design/orchestration-2026-10/model/MODEL.md) | 现行 | 54 个对象、59 条行为规则、不变量的读法模型，按决定 49 修订。 | 与 [DESIGN.md](design/orchestration-2026-10/DESIGN.md)、[AMBIGUITIES](design/orchestration-2026-10/model/AMBIGUITIES.md) 合读；不是接口冻结。 |
| [design/orchestration-2026-10/model/README.md](design/orchestration-2026-10/model/README.md) | 现行 | 读法模型的说明、决定 41 的来历和 model/ 文件索引。 | 与 [DESIGN.md](design/orchestration-2026-10/DESIGN.md)、[STATUS](STATUS.md) 合读；只索引，行为以决定和设计书为准。 |
| [design/orchestration-2026-10/model/REVIEW-SLICES-1-3-5.md](design/orchestration-2026-10/model/REVIEW-SLICES-1-3-5.md) | 历史 | 第 1、3、5 片冻结前的 11 条问题与 7 个技术问题。 | 决定 42 已答复；答案并入 [DESIGN.md](design/orchestration-2026-10/DESIGN.md)，各项在 [AMBIGUITIES](design/orchestration-2026-10/model/AMBIGUITIES.md) 标已定。 |
| [design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7.md](design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7.md) | 现行（只限决定 49 采用的条目） | 第 2、4、6、7、K、K2 片的 29 条问题和 K、K2 做法；决定 49 采用的那些条目是第 4、6、7 片的当前依据。 | 与 [HANDOFF 决定 49](HANDOFF.md:218)、[LEAD-ANSWERS](design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md)、[DESIGN.md](design/orchestration-2026-10/DESIGN.md) 合读；未采用的备选只作背景。 |
| [design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md](design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md) | 现行 | 对用户回复的解释和写进规格的规则；[HANDOFF 决定 49](HANDOFF.md:218) 采用其选定范围，是第 4、6、7 片的当前依据。 | 未采用的备选只作背景；有出入以 [HANDOFF 决定 49](HANDOFF.md) 为准，与 [DESIGN.md](design/orchestration-2026-10/DESIGN.md) 合读。 |
| [design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-OPINIONS.md](design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-OPINIONS.md) | 已被取代 | 决定前的意见合并稿：29 条结论表和三条待确认。 | 由 [HANDOFF 决定 49](HANDOFF.md)（[DESIGN.md](design/orchestration-2026-10/DESIGN.md)、[LEAD-ANSWERS](design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md)）取代；只作记录。 |
| [design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-USER-REPLIES.md](design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-USER-REPLIES.md) | 现行（只限决定 49 采用的条目） | 用户对 29 条的逐条原话回复（含错别字，未改写）；决定 49 采用的那些条目是当前依据。 | 与 [LEAD-ANSWERS](design/orchestration-2026-10/model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md) 合读；未采用的备选只作背景，原话不改写。 |
| [design/orchestration-2026-10/model/SCENARIOS.md](design/orchestration-2026-10/model/SCENARIOS.md) | 历史 | 2026-10-07/08 合并的 400 条场景分析，状态按当时口径。 | 与 [DESIGN.md](design/orchestration-2026-10/DESIGN.md)、[AMBIGUITIES](design/orchestration-2026-10/model/AMBIGUITIES.md) 合读；“未定/靠推断”不代表今天仍未定。 |

## model/readers/（R1–R6）

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [R1/R1.md](design/orchestration-2026-10/model/readers/R1/R1.md)（另有 R1-coverage.md、R1-actions.md） | 证据 | 读者 R1「你的动作和你看到的」的逐场景原始输出（含覆盖表与 25 动作表），六个读者分析的原样证据 | 由 [SCENARIOS.md](design/orchestration-2026-10/model/SCENARIOS.md) / [MODEL.md](design/orchestration-2026-10/model/MODEL.md) / [AMBIGUITIES.md](design/orchestration-2026-10/model/AMBIGUITIES.md) 合并；状态以决定 42/49 为准 |
| [R2/R2.md](design/orchestration-2026-10/model/readers/R2/R2.md)（另有 R2-coverage.md、R2-matrix.md） | 证据 | 读者 R2「Session 和工作线的生命周期」的原始输出（含 12 状态×13 事件矩阵） | 同上，合入 SCENARIOS/MODEL；矩阵原样保留 |
| [R3/R3.md](design/orchestration-2026-10/model/readers/R3/R3.md)（另有 R3-matrix.md） | 证据 | 读者 R3「各职责的编排」的原始输出（含 28 能力×5 职责矩阵） | 同上，合入 SCENARIOS/MODEL；矩阵原样保留 |
| [R4/R4.md](design/orchestration-2026-10/model/readers/R4/R4.md)（另有 R4-coverage.md、R4-matrix.md） | 证据 | 读者 R4「消息、等待与决定队列」的原始输出（R4 第 1 轮越界返工后的干净版） | 同上，合入 SCENARIOS/MODEL；与决定 49 第 29 项对读 |
| [R5/R5.md](design/orchestration-2026-10/model/readers/R5/R5.md)（另有 R5-coverage.md、R5-matrix.md） | 证据 | 读者 R5「记忆与上下文」的原始输出（R5 第 1 轮返工后的干净版） | 同上，合入 SCENARIOS/MODEL；与 MEMORY-LOOKUP.md 合读 |
| [R6/R6.md](design/orchestration-2026-10/model/readers/R6/R6.md) | 证据 | 读者 R6 把 Codex 的 80 个场景逐个重推的原始输出（含 5 处不一致） | 由 SCENARIOS.md 合并裁定；S01–S80 给定和动作只在这里保留 |

## slices/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [slices/README.md](design/orchestration-2026-10/slices/README.md) | 现行 | 分片与接线入口：2026-10-13 起做法（决定 56）、下一步 2A→2B→2C→资源上限、已合入状态和“这里有什么” | 与 [STATUS](STATUS.md)、[DESIGN §8.2](design/orchestration-2026-10/DESIGN.md#82-分片表) 及各规格合读；后半为 2026-10-08/09 历史 |
| [slice-0-SPEC.md](design/orchestration-2026-10/slices/slice-0-SPEC.md) | 现行 | 第 0 片冻结规格（注意力依赖边写成“种类:标签”），已合入 21a99915 | 与 slice-0-book-part1/2 合读；证据 [orchestration-slice-0-2026-10-08](reviews/evidence/orchestration-slice-0-2026-10-08/README.md) |
| [slice-0-book-part1.md](design/orchestration-2026-10/slices/slice-0-book-part1.md) | 历史 | 第 0 片 DSH 两段任务书第一段（只写 3 个失败用例后停） | 与 slice-0-SPEC 合读；第二段见 slice-0-book-part2 |
| [slice-0-book-part2.md](design/orchestration-2026-10/slices/slice-0-book-part2.md) | 历史 | 第 0 片任务书第二段（改 attention-observer 一行） | 与 slice-0-SPEC、part1 合读 |
| [slice-1-SPEC.md](design/orchestration-2026-10/slices/slice-1-SPEC.md) | 现行 | 第 1 片冻结规格（Session 事实、纠错与归档），已合入 327ec020；U1 的认定后分支由决定 51/K 片改写 | 与 slice-1-book-part1/2 合读；认定后行为与 slice-K-SPEC §0.1/§9 合读 |
| [slice-1-book-part1.md](design/orchestration-2026-10/slices/slice-1-book-part1.md) | 历史 | 第 1 片 DSH 两段任务书第一段（类型/桩/151 行用例） | 与 slice-1-SPEC 合读；第二段见 slice-1-book-part2 |
| [slice-1-book-part2.md](design/orchestration-2026-10/slices/slice-1-book-part2.md) | 历史 | 第 1 片任务书第二段（按 6 个层次实现） | 与 slice-1-SPEC、part1 合读 |
| [slice-2A-SPEC.md](design/orchestration-2026-10/slices/slice-2A-SPEC.md) | 现行 | 2A 冻结规格（决定队列缩窄到相关条目、不再整个拒绝、完整分页），2026-10-14 冻结、施工中 | 撤 wiring-2-SPEC L6/L7 的两处临时上限；与 2B/2C（待写）及 [决定 50/51](HANDOFF.md) 合读 |
| [slice-3-SPEC.md](design/orchestration-2026-10/slices/slice-3-SPEC.md) | 现行 | 第 3 片冻结规格（上下文装配器、“看/找”图工具、职责配置），已合入 ccecc016、e48218a5 | 与 slice-3-book-part1/2 合读；I-1、I-3 接缝见 wiring-1-SPEC |
| [slice-3-book-part1.md](design/orchestration-2026-10/slices/slice-3-book-part1.md) | 历史 | 第 3 片 DSH 两段任务书第一段（类型/桩/116 行用例） | 与 slice-3-SPEC 合读；第二段见 slice-3-book-part2 |
| [slice-3-book-part2.md](design/orchestration-2026-10/slices/slice-3-book-part2.md) | 历史 | 第 3 片任务书第二段（按 8 个层次实现） | 与 slice-3-SPEC、part1 合读 |
| [slice-5-SPEC.md](design/orchestration-2026-10/slices/slice-5-SPEC.md) | 现行 | 第 5 片冻结规格（目标设置与决定，含决定 48 的补测），已合入 a7cafccc | 与 slice-5-book-part1/2、slice-5-round2-TESTS 合读；I-4/I-5/I-6 见 wiring-2-SPEC |
| [slice-5-book-part1.md](design/orchestration-2026-10/slices/slice-5-book-part1.md) | 历史 | 第 5 片 DSH 两段任务书第一段（类型/桩/153 行用例） | 与 slice-5-SPEC 合读；第二段见 slice-5-book-part2 |
| [slice-5-book-part2.md](design/orchestration-2026-10/slices/slice-5-book-part2.md) | 历史 | 第 5 片任务书第二段（按 6 个层次实现） | 与 slice-5-SPEC、part1 合读 |
| [slice-5-round2-TESTS.md](design/orchestration-2026-10/slices/slice-5-round2-TESTS.md) | 参考 | 决定 48 的补测用例表，第 5 片规格的补充（随 a7cafccc 提交，37 行 RED/GREEN） | 与 slice-5-SPEC 合读；其中 5,000 超界期望由 slice-2A-SPEC 翻转 |
| [slice-K-SPEC.md](design/orchestration-2026-10/slices/slice-K-SPEC.md) | 现行 | K 片冻结规格（A 关闭悬空 Turn 留在原 Session、B 只读命令），A cfe35550、B 9881a2ae 已合入 | 与 slice-K3-SPEC 合读；§9 为冻结后修正，以 §9 为准 |
| [slice-K3-SPEC.md](design/orchestration-2026-10/slices/slice-K3-SPEC.md) | 参考 | K3 草稿第二版（结果未知工具按种类核对、重启后自动收尾），方向由决定 52/53/57，未冻结、暂停待资源上限片（决定 56） | 与 slice-K-SPEC 合读；B2 机制待 lead 写进规格（决定 57） |
| [wiring-1-SPEC.md](design/orchestration-2026-10/slices/wiring-1-SPEC.md) | 现行 | 接线包 1 冻结规格（I-1、I-3、目标内容核对、普通接续交接），已合入 6180adfc | 与 wiring-2-SPEC 合读；L3 的 contentVersion 预告已由 wiring-2 §0.3 撤回 |
| [wiring-2-SPEC.md](design/orchestration-2026-10/slices/wiring-2-SPEC.md) | 现行 | 接线包 2 冻结规格（I-2、I-4、I-5、I-6），已合入 bb924854 | 与 slice-2A-SPEC 合读（2A 撤其 L6/L7 临时上限）；G 不改见 §0.3 |

## modules/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [modules/README.md](modules/README.md) | 参考 | 5 模块目标的总索引，也导航旧 13 模块的去向。 | 导航用：5 个目标模块看 [module-target.json](module-target.json) 与 [ARCHITECTURE.md](ARCHITECTURE.md)，旧 13 模块去向看本页和 [ownership-map.md](modules/ownership-map.md)；不作实现依据。 |
| [modules/ownership-map.md](modules/ownership-map.md) | 历史 | 2026-09-23 旧 13 模块（M01–M13）承载与迁移归属表。 | 被 5 模块目标取代；全文存 [archive/2026-09-23-before-core-design/modules/ownership-map.md](archive/2026-09-23-before-core-design/modules/ownership-map.md)。 |
| [modules/control/agent-lifecycle.md](modules/control/agent-lifecycle.md) | 历史 | 旧 AgentLifecycle（旧稿新增、未实现）迁移导航，自标 2026-10-13 历史。 | 被 Workflow / WorkGraph / AgentRuntime 取代；全文见 archive 同名文件。 |
| [modules/control/architecture-reconciler.md](modules/control/architecture-reconciler.md) | 历史 | 旧 ArchitectureReconciler 迁移导航，自标历史。 | 被 WorkGraph 取代。 |
| [modules/control/control-engine.md](modules/control/control-engine.md) | 历史 | 旧 ControlEngine 迁移导航，自标历史。 | 被 WorkGraph 取代。 |
| [modules/control/dispatch-engine.md](modules/control/dispatch-engine.md) | 历史 | 旧 DispatchEngine 迁移导航，自标历史。 | 被 AgentRuntime / Workflow 取代。 |
| [modules/control/plan-compiler.md](modules/control/plan-compiler.md) | 历史 | 旧 PlanCompiler 迁移导航，自标历史。 | 被 Workflow / WorkGraph 取代。 |
| [modules/control/verification-engine.md](modules/control/verification-engine.md) | 历史 | 旧 VerificationEngine 迁移导航，自标历史。 | 被 Workflow / WorkGraph / AgentRuntime 取代。 |
| [modules/data/artifact-vault.md](modules/data/artifact-vault.md) | 历史 | 旧 ArtifactVault 迁移导航，自标历史。 | 被 RecordStore / WorkGraph 取代。 |
| [modules/data/context-compiler.md](modules/data/context-compiler.md) | 历史 | 旧 ContextCompiler 迁移导航，自标历史。 | 被 WorkGraph / Workflow / AgentRuntime 取代。 |
| [modules/data/read-model-index.md](modules/data/read-model-index.md) | 历史 | 旧 ReadModelIndex 迁移导航，自标历史。 | 被 WorkGraph / RecordStore 取代。 |
| [modules/data/state-ledger.md](modules/data/state-ledger.md) | 历史 | 旧 StateLedger 迁移导航，自标历史。 | 被 RecordStore / WorkGraph 取代。 |
| [modules/data/workspace-reader.md](modules/data/workspace-reader.md) | 历史 | 旧 WorkspaceReader 迁移导航，自标历史。 | 被 WorkspaceTools 取代。 |
| [modules/execution/worker-runtime.md](modules/execution/worker-runtime.md) | 历史 | 旧 WorkerRuntime 迁移导航，自标历史。 | 被 AgentRuntime 取代。 |
| [modules/interaction/human-collaboration.md](modules/interaction/human-collaboration.md) | 历史 | 旧 HumanCollaboration 迁移导航，自标历史。 | 被 Workflow 取代。 |
| [modules/business/workflow.md](modules/business/workflow.md) | 历史 | Workflow 模块的文件级实现骨架（目标文件树、Port、迁移表）。 | 被源码、[module-target.json](module-target.json)、[ARCHITECTURE.md](ARCHITECTURE.md) 和各片冻结规格取代；文件级骨架与今天的代码不符，只追溯时与 CORE-DATA-OPERATIONS、ORCHESTRATION-STATE-MACHINES 合读。 |
| [modules/core/agent-runtime.md](modules/core/agent-runtime.md) | 历史 | AgentRuntime 模块的执行与 Session 操作实现骨架。 | 被源码、[module-target.json](module-target.json)、[ARCHITECTURE.md](ARCHITECTURE.md) 和各片冻结规格取代；文件级骨架与今天的代码不符。 |
| [modules/core/record-store.md](modules/core/record-store.md) | 历史 | RecordStore 事务、正文与持久索引实现骨架。 | 被源码、[module-target.json](module-target.json)、[ARCHITECTURE.md](ARCHITECTURE.md) 和各片冻结规格取代；文件级骨架与今天的代码不符。 |
| [modules/core/work-graph.md](modules/core/work-graph.md) | 历史 | WorkGraph 工作结构、原子变更与查询实现骨架。 | 被源码、[module-target.json](module-target.json)、[ARCHITECTURE.md](ARCHITECTURE.md) 和各片冻结规格取代；文件级骨架与今天的代码不符；13 子模块以 [module-dag §6](module-dag.md#6-workgraph-的子模块2026-10-07决定-40) 为准。 |
| [modules/core/workspace.md](modules/core/workspace.md) | 历史 | WorkspaceTools 文件、Git 与源码索引实现骨架。 | 被源码、[module-target.json](module-target.json)、[ARCHITECTURE.md](ARCHITECTURE.md) 和各片冻结规格取代；文件级骨架与今天的代码不符。 |

## archive/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [archive/2026-09-23-before-core-design/README.md](archive/2026-09-23-before-core-design/README.md) | 历史 | 快照说明：重构前架构、模块 DAG 与 15 篇模块/承载文档（17 个内容文件）。 | 正文为历史，不作当前指令；当前入口 [ARCHITECTURE.md](ARCHITECTURE.md)。 |
| [archive/2026-09-23-before-core-design/ARCHITECTURE.md](archive/2026-09-23-before-core-design/ARCHITECTURE.md) | 历史 | 2026-09-21 核心设计重构前的总体架构。 | 被 [ARCHITECTURE.md](ARCHITECTURE.md) 的后续设计链取代。 |
| [archive/2026-09-23-before-core-design/module-dag.md](archive/2026-09-23-before-core-design/module-dag.md) | 历史 | 重构前 13 模块 / 38 边 DAG 草稿（Prompt 4 产物）。 | 被 [module-dag.md](module-dag.md) 与 module-target.json 取代。 |
| [archive/2026-09-23-before-core-design/manifest.json](archive/2026-09-23-before-core-design/manifest.json) | 历史 | 快照 17 个文件的 SHA-256 与行数清单。 | 随快照归档，仅溯源。 |
| [archive/2026-09-23-before-core-design/modules/README.md](archive/2026-09-23-before-core-design/modules/README.md) | 历史 | 旧 13 模块文档索引（第三阶段产物）。 | 被 [modules/README.md](modules/README.md) + module-target.json 取代。 |
| [archive/2026-09-23-before-core-design/modules/control/](archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md)（agent-lifecycle、architecture-reconciler、control-engine、dispatch-engine、plan-compiler、verification-engine 六篇全文） | 历史 | 旧 control 六模块（含 AgentLifecycle）的原稿全文。 | 被 WorkGraph / Workflow / AgentRuntime 取代。 |
| [archive/2026-09-23-before-core-design/modules/data/](archive/2026-09-23-before-core-design/modules/data/artifact-vault.md)（artifact-vault、context-compiler、read-model-index、state-ledger、workspace-reader 五篇全文） | 历史 | 旧 data 五模块的原稿全文。 | 被 RecordStore / WorkGraph / WorkspaceTools 取代。 |
| [archive/2026-09-23-before-core-design/modules/execution/worker-runtime.md](archive/2026-09-23-before-core-design/modules/execution/worker-runtime.md) | 历史 | 旧 WorkerRuntime 原稿全文。 | 被 AgentRuntime 取代。 |
| [archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md](archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md) | 历史 | 旧 HumanCollaboration 原稿全文。 | 被 Workflow 取代。 |
| [archive/2026-09-23-before-core-design/modules/ownership-map.md](archive/2026-09-23-before-core-design/modules/ownership-map.md) | 历史 | 旧 13 模块跨模块承载与迁移总表全文。 | 被 [modules/ownership-map.md](modules/ownership-map.md) 取代。 |
| [archive/2026-09-23-prompts-v2/README.md](archive/2026-09-23-prompts-v2/README.md) | 历史 | v2 提示词归档说明（含 SHA-256 与替换原因）。 | 归档；其链接的当前可执行版 `docs/refactor-prompts.revised.md` 已不在仓库。 |
| [archive/2026-09-23-prompts-v2/refactor-prompts.revised.md](archive/2026-09-23-prompts-v2/refactor-prompts.revised.md) | 历史 | 2026-09-19 v2 分阶段重构提示词全文。 | 不再执行；旧 13 模块、门禁与实施规则已废。 |
| [archive/2026-09-27-workspace-tooling/README.md](archive/2026-09-27-workspace-tooling/README.md) | 历史 | 原工作区施工工具快照说明（保留旧绝对路径）。 | 不是本仓库可直接执行的工具。 |
| [archive/2026-09-27-workspace-tooling/check.py](archive/2026-09-27-workspace-tooling/check.py) | 历史 | 只读固定测试入口脚本（内嵌旧 `/home/hyh001/...` 路径）。 | 不直接执行；恢复施工前须重核路径与 scope。 |
| [archive/2026-09-27-workspace-tooling/harness.py](archive/2026-09-27-workspace-tooling/harness.py) | 历史 | R3a/R4a 本地 runner（dirty-tree 快照、写范围、受管导入）。 | 不直接执行。 |
| [archive/2026-09-27-workspace-tooling/next-README.md](archive/2026-09-27-workspace-tooling/next-README.md) | 历史 | 独立目标工程旧 README（2026-09-27 冻结时点）。 | 被根 [README.md](README.md) 取代。 |
| [archive/2026-10-13-old-entry/README.md](archive/2026-10-13-old-entry/README.md) | 历史 | 旧入口归档说明（CONTINUE、提示词、计划三件）。 | 三件均已由编排分片与后续决定取代。 |
| [archive/2026-10-13-old-entry/CONTINUE.md](archive/2026-10-13-old-entry/CONTINUE.md) | 历史 | 2026-09-28/29 的恢复提示。 | 路径、分支与下一步已过时。 |
| [archive/2026-10-13-old-entry/refactor-prompts.revised.md](archive/2026-10-13-old-entry/refactor-prompts.revised.md) | 历史 | 2026-09-24 v3.3 分阶段重构提示词合集。 | 旧 R 批次由编排分片与决定取代。 |
| [archive/2026-10-13-old-entry/refactor-plan.md](archive/2026-10-13-old-entry/refactor-plan.md) | 历史 | 旧 R0–R6 迁移批次计划。 | 原工程路径、排期与完成状态不再是当前依据。 |

## references/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [references/code-quality/README.md](references/code-quality/README.md) | 参考 | 外部代码规范与审查原文的整理说明、出处与许可。 | 支撑 CODE-QUALITY-RESEARCH / GUIDELINES；不是本项目生效规则。 |
| [references/code-quality/manifest.json](references/code-quality/manifest.json) | 参考 | 12 个 vendored 原文的固定提交、SHA-256、字节与许可清单。 | 与同目录 README 合读，仅溯源。 |
| [references/code-quality/upstream/](references/code-quality/upstream/google/eng-practices/README.md)（airbnb/javascript、getsentry/skills、google/eng-practices、google/styleguide） | 参考 | 12 个 vendored 上游原文（4 份许可证 + 8 份规范/Skill 正文）。 | 只读快照，未安装未激活；上游变动不自动改本项目规范。 |

## reviews/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [reviews/R2e-1-sol-dsh-acceptance.md](reviews/R2e-1-sol-dsh-acceptance.md) | 证据 | R2e.1 文本捕获、读取与比较子批的独立验收记录（16+2 项冻结测试）。 | 作为旧批验收证据，与 [STATUS](STATUS.md) 和各 next-* 验收页合读。 |
| [reviews/R3a-R4a-independent-acceptance.md](reviews/R3a-R4a-independent-acceptance.md) | 已被取代 | 2026-09-23 R3a/R4a 未通过独立验收的失败快照（F1–F4、6 个失败用例）。 | 被 [reviews/R3a-R4a-sol-dsh-acceptance.md](reviews/R3a-R4a-sol-dsh-acceptance.md) 取代（缺陷已修复并重新验收）。 |
| [reviews/R3a-R4a-sol-dsh-acceptance.md](reviews/R3a-R4a-sol-dsh-acceptance.md) | 证据 | R3a/R4a 由 Sol 骨架 + dsh 返修后通过独立验收的记录。 | 与 [reviews/R3a-R4a-independent-acceptance.md](reviews/R3a-R4a-independent-acceptance.md) 合读（前一轮失败对照）。 |
| [reviews/R3b-material-consumer-inventory.md](reviews/R3b-material-consumer-inventory.md) | 历史 | R3b 材料读消费者、真实前置与退役基线的定位清单。 | 与 [reviews/R3b-sol-dsh-acceptance.md](reviews/R3b-sol-dsh-acceptance.md) 合读；页首已标 2026-10-13 历史。 |
| [reviews/R3b-sol-dsh-acceptance.md](reviews/R3b-sol-dsh-acceptance.md) | 证据 | R3b 材料迁移（Sol 骨架 + 两路 dsh 并行 + 集成）的独立验收。 | 与 [reviews/R3b-material-consumer-inventory.md](reviews/R3b-material-consumer-inventory.md) 合读。 |
| [reviews/code-size-and-complexity-2026-09-24-final.evidence.json](reviews/code-size-and-complexity-2026-09-24-final.evidence.json) | 证据 | 08:34 最终代码规模/近似复杂度测量的机器可读证据（逐文件哈希与行数）。 | 与同批 [reviews/code-size-and-complexity-2026-09-24-final.md](reviews/code-size-and-complexity-2026-09-24-final.md) 合读。 |
| [reviews/code-size-and-complexity-2026-09-24-final.md](reviews/code-size-and-complexity-2026-09-24-final.md) | 证据 | 08:34 最终源码规模、复杂度与剩余迁移的快照报告。 | 与 final.evidence.json 及 [STATUS](STATUS.md)“简化后的行数”合读。 |
| [reviews/code-size-and-complexity-2026-09-24.evidence.json](reviews/code-size-and-complexity-2026-09-24.evidence.json) | 证据 | 07:33 代码规模/复杂度快照的机器可读证据。 | 与同批 [reviews/code-size-and-complexity-2026-09-24.md](reviews/code-size-and-complexity-2026-09-24.md) 合读。 |
| [reviews/code-size-and-complexity-2026-09-24.md](reviews/code-size-and-complexity-2026-09-24.md) | 已被取代 | 2026-09-24 07:33 的早间规模与 R 系列状态报告。 | 被 [reviews/code-size-and-complexity-2026-09-24-final.md](reviews/code-size-and-complexity-2026-09-24-final.md) 取代（最新统计）。 |
| [reviews/completion-audit-2026-09-27.md](reviews/completion-audit-2026-09-27.md) | 证据 | 独立 main 的有界 MVP completion audit（基线 5bd93abc，结论：有真实 blocker）。 | 与 [STATUS](STATUS.md)、[MVP-BEHAVIOR](../MVP-BEHAVIOR.md) 合读；按约束不因接手重跑。 |
| [reviews/core-design-implementation-evidence.md](reviews/core-design-implementation-evidence.md) | 证据 | R1 首批核心设计与实现（ProjectSourceIndex 优化）的证据记录。 | 与 [reviews/implementation-batches.md](reviews/implementation-batches.md) 合读。 |
| [reviews/current-module-map-2026-09-27.md](reviews/current-module-map-2026-09-27.md) | 历史 | d0dc9d6c 时点的模块关系、代码规模与装配概览。 | 与 [reviews/new-code-and-logic-2026-09-27.md](reviews/new-code-and-logic-2026-09-27.md) 合读；页首已标历史。 |
| [reviews/dsh-long-context-review-2026-09-27.md](reviews/dsh-long-context-review-2026-09-27.md) | 历史 | DSH 长上下文冗余对照审查与主审对候选报告的取舍。 | 与 [reviews/structure-and-validation-audit-2026-09-27.md](reviews/structure-and-validation-audit-2026-09-27.md) 合读；页首已标历史。 |
| [reviews/dsh-parallel-readiness-validation.json](reviews/dsh-parallel-readiness-validation.json) | 证据 | 2026-09-23 对 65 份 markdown 的本地链接、目标模块/DAG、dsh 前置条件的机器校验结果。 | 与 [reviews/parallel-interface-validation.json](reviews/parallel-interface-validation.json)、[reviews/skeleton-validation.json](reviews/skeleton-validation.json) 合读。 |
| [reviews/implementation-batches.md](reviews/implementation-batches.md) | 历史 | 2026-09-23 起各 dsh 实施批次与独立验收的汇总。 | 与各 next-* 验收页、[STATUS](STATUS.md) 合读；页首已标历史。 |
| [reviews/lifecycle-performance-followup.md](reviews/lifecycle-performance-followup.md) | 历史 | 生命周期承接与重复开销的补充审阅（2026-09-22，四条人类批注）。 | 与 [reviews/module-dag-review.md](reviews/module-dag-review.md) 合读；页首已标历史评审说明。 |
| [reviews/module-dag-review.md](reviews/module-dag-review.md) | 历史 | Prompt 4 模块分工与 DAG 一致性审查（旧 13 模块/38 边稿）。 | 与 [reviews/module-necessity-review.md](reviews/module-necessity-review.md) 合读；页首已标历史评审说明。 |
| [reviews/module-necessity-review.md](reviews/module-necessity-review.md) | 历史 | 现有模块存在理由与合并可行性审阅（导向模块收敛）。 | 与 [ARCHITECTURE](ARCHITECTURE.md)、[module-target.json](module-target.json) 合读；页首已标历史评审说明。 |
| [reviews/new-code-and-logic-2026-09-27.md](reviews/new-code-and-logic-2026-09-27.md) | 历史 | B1/W1 之后新增生产/测试代码与逻辑的逐文件清单（30,464→63,625 行）。 | 与 [reviews/current-module-map-2026-09-27.md](reviews/current-module-map-2026-09-27.md) 合读；页首已标历史。 |
| [reviews/next-a1-graph-session-2026-09-25.md](reviews/next-a1-graph-session-2026-09-25.md) | 证据 | A1 正式架构目录与 Session 图关联子集的独立验收（75 文件/719 项）。 | 与 [reviews/implementation-batches.md](reviews/implementation-batches.md) 合读。 |
| [reviews/next-b1-w1-2026-09-25.md](reviews/next-b1-w1-2026-09-25.md) | 证据 | B1 装配接缝与 W1 未来任务白板子集验收（78 文件/726 项）。 | 与 [reviews/next-b2-c1-middle-review-2026-09-26.md](reviews/next-b2-c1-middle-review-2026-09-26.md) 合读。 |
| [reviews/next-b2-c1-middle-review-2026-09-26.md](reviews/next-b2-c1-middle-review-2026-09-26.md) | 历史 | B2/C1/M1 骨架、测试语义与接口冻结的中间审核（非产品验收）。 | 与 [reviews/next-b1-w1-2026-09-25.md](reviews/next-b1-w1-2026-09-25.md) 合读；页首已标历史。 |
| [reviews/next-clean-migration-2026-09-24.md](reviews/next-clean-migration-2026-09-24.md) | 证据 | N0 干净迁移到 coding-platform/next 并完成 R3c reader/index 子项的验收。 | 与 [reviews/next-completed-migration-2026-09-24.md](reviews/next-completed-migration-2026-09-24.md) 合读。 |
| [reviews/next-completed-migration-2026-09-24.md](reviews/next-completed-migration-2026-09-24.md) | 证据 | 已完成能力补迁与 R 系列对账（36 文件/250 项）。 | 与 [reviews/next-clean-migration-2026-09-24.md](reviews/next-clean-migration-2026-09-24.md) 合读。 |
| [reviews/next-r3c-r4b-2026-09-24.md](reviews/next-r3c-r4b-2026-09-24.md) | 证据 | R3c/R4b 实施与独立验收（48 文件/321 项）。 | 与 [reviews/next-r3c-relations-2026-09-24.md](reviews/next-r3c-relations-2026-09-24.md)、[reviews/next-r3d-r3g-2026-09-24.md](reviews/next-r3d-r3g-2026-09-24.md) 合读。 |
| [reviews/next-r3c-relations-2026-09-24.md](reviews/next-r3c-relations-2026-09-24.md) | 证据 | R3c 任务关系与精确输入验收（57 文件/383 项）。 | 与 [reviews/next-r4c-continuity-2026-09-24.md](reviews/next-r4c-continuity-2026-09-24.md)（前序）合读。 |
| [reviews/next-r3d-r3g-2026-09-24.md](reviews/next-r3d-r3g-2026-09-24.md) | 证据 | R3d 源码观测与 R3g 角色规格子批验收（53 文件/372 项）。 | 与 [reviews/next-r3c-r4b-2026-09-24.md](reviews/next-r3c-r4b-2026-09-24.md)（前序）合读。 |
| [reviews/next-r4-control-git-read-2026-09-26.md](reviews/next-r4-control-git-read-2026-09-26.md) | 历史 | R4.1 持久控制、R2e.2 Git 读取与 R3e 的在途独立审阅。 | 与 [reviews/next-r5a-r4-tool-group-2026-09-26.md](reviews/next-r5a-r4-tool-group-2026-09-26.md)（前序基线）合读；页首已标历史。 |
| [reviews/next-r4c-claim-2026-09-24.md](reviews/next-r4c-claim-2026-09-24.md) | 证据 | R4c.1 Task 原子领取独立验收（60 文件/422 项）。 | 与 [reviews/next-r4c-execution-reads-2026-09-25.md](reviews/next-r4c-execution-reads-2026-09-25.md) 合读。 |
| [reviews/next-r4c-continuity-2026-09-24.md](reviews/next-r4c-continuity-2026-09-24.md) | 证据 | R4c 连续 Session 转发子集验收（54 文件/376 项）。 | 与 [reviews/next-r3d-r3g-2026-09-24.md](reviews/next-r3d-r3g-2026-09-24.md)（前序）合读。 |
| [reviews/next-r4c-execution-reads-2026-09-25.md](reviews/next-r4c-execution-reads-2026-09-25.md) | 证据 | R4c.2a 精确执行事实与定向历史读取验收。 | 与 [reviews/next-r4c-claim-2026-09-24.md](reviews/next-r4c-claim-2026-09-24.md)（前序基线）合读。 |
| [reviews/next-r4c-history-and-source-2026-09-25.md](reviews/next-r4c-history-and-source-2026-09-25.md) | 证据 | R4c.2b 图定位历史修复与 R4c.2c 源码事实接线验收（68 文件/620 项）。 | 与 [reviews/next-r4c-execution-reads-2026-09-25.md](reviews/next-r4c-execution-reads-2026-09-25.md) 合读。 |
| [reviews/next-r5a-r4-tool-group-2026-09-26.md](reviews/next-r5a-r4-tool-group-2026-09-26.md) | 证据 | R5a 初始化与 R4.2 工具组安全点中审/验收（102 文件/1,007 项）。 | 与 [reviews/next-r4-control-git-read-2026-09-26.md](reviews/next-r4-control-git-read-2026-09-26.md) 合读。 |
| [reviews/parallel-interface-validation.json](reviews/parallel-interface-validation.json) | 证据 | 2026-09-23 当前文档与目标 DAG（5 模块/8 边）的链接与一致性校验结果。 | 与 [reviews/dsh-parallel-readiness-validation.json](reviews/dsh-parallel-readiness-validation.json)、[reviews/skeleton-validation.json](reviews/skeleton-validation.json) 合读。 |
| [reviews/pre-prompt6-drift-review.md](reviews/pre-prompt6-drift-review.md) | 历史 | Prompt 6 前架构、模块与 DAG 漂移审阅（2026-09-22）。 | 与 [reviews/prompt2-architecture-review.md](reviews/prompt2-architecture-review.md) 合读；页首已标历史评审说明。 |
| [reviews/product-intent-review.md](reviews/product-intent-review.md) | 历史 | 历史 PRODUCT 稿与当前用户意图的对照审阅，产出当前 PRODUCT.md。 | 与 [PRODUCT](../PRODUCT.md)、[intent/INTENT-AND-DECISIONS.md](intent/INTENT-AND-DECISIONS.md) 合读。 |
| [reviews/prompt2-architecture-review.md](reviews/prompt2-architecture-review.md) | 历史 | ARCHITECTURE 作为 Prompt 2 产物的复核（A01–A05，2026-09-22）。 | 与 [reviews/pre-prompt6-drift-review.md](reviews/pre-prompt6-drift-review.md) 合读；页首已标历史评审说明。 |
| [reviews/skeleton-handoff-review.md](reviews/skeleton-handoff-review.md) | 历史 | 详细骨架与无对话记忆交接文档的核对记录（2026-09-23）。 | 与 [skeleton/README.md](skeleton/README.md)、[HANDOFF](HANDOFF.md) 合读。 |
| [reviews/skeleton-validation.json](reviews/skeleton-validation.json) | 证据 | 2026-09-23 骨架文档与来源（非源码类型检查）的校验结果。 | 与 [reviews/skeleton-handoff-review.md](reviews/skeleton-handoff-review.md) 合读。 |
| [reviews/structure-and-validation-audit-2026-09-27.md](reviews/structure-and-validation-audit-2026-09-27.md) | 历史 | 结构图符合度、往返步骤与校验边界审查（含简化候选）。 | 与 [reviews/dsh-long-context-review-2026-09-27.md](reviews/dsh-long-context-review-2026-09-27.md) 合读；页首已标历史。 |
| [reviews/task-graph-orchestration-intent-2026-09-24.md](reviews/task-graph-orchestration-intent-2026-09-24.md) | 历史 | 任务图与并行准入的意图核对（白板定位、撤销全量预占）。 | 与 [intent/INTENT-AND-DECISIONS.md](intent/INTENT-AND-DECISIONS.md) §6 合读。 |
| [reviews/workspace-remaining-capabilities.md](reviews/workspace-remaining-capabilities.md) | 历史 | R2e 剩余工作区能力与源码证据的只读调查（2026-09-23）。 | 与 [reviews/R2e-1-sol-dsh-acceptance.md](reviews/R2e-1-sol-dsh-acceptance.md) 合读。 |

## intent/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [intent/2026-09-23-PARALLEL-AND-PRODUCT.md](intent/2026-09-23-PARALLEL-AND-PRODUCT.md) | 参考 | 逐字保存用户关于同工作区多 Agent 并行与任务图定位的补充原话。 | 与 [PRODUCT](../PRODUCT.md)、[intent/INTENT-AND-DECISIONS.md](intent/INTENT-AND-DECISIONS.md) 合读；仅在追溯原话时读。 |
| [intent/2026-09-24-DSH-HARNESS.md](intent/2026-09-24-DSH-HARNESS.md) | 历史 | 2026-09-24 的 Sol 骨架、独立测试与 dsh 实现约束的工作模式记录。 | 被 [DSH-WORKFLOW](DSH-WORKFLOW.md) 及 [HANDOFF](HANDOFF.md) 决定 36/43/46/50/56 取代（做法已更新）。 |
| [intent/2026-09-24-TARGET-PROJECT.md](intent/2026-09-24-TARGET-PROJECT.md) | 历史 | 独立目标工程（coding-platform/next）的用户澄清与实施纠偏记录。 | 与 [reviews/next-clean-migration-2026-09-24.md](reviews/next-clean-migration-2026-09-24.md)、根 [README](../../README.md) 合读；方向已执行。 |
| [intent/INTENT-AND-DECISIONS.md](intent/INTENT-AND-DECISIONS.md) | 参考 | 用户意图（U）、工程决定（E）与已撤回推断的归纳，供追溯“为什么这样设计”。 | 与 [HANDOFF](HANDOFF.md)、[PRODUCT](../PRODUCT.md) 合读；现行决定以 HANDOFF 顶部为准。 |
| [intent/ORIGINAL-DIALOGUE.md](intent/ORIGINAL-DIALOGUE.md) | 参考 | 本轮架构讨论的用户原话与助手旧回答存档（含原始草图与批注）。 | 与 [intent/original-dialogue.json](intent/original-dialogue.json)、[intent/INTENT-AND-DECISIONS.md](intent/INTENT-AND-DECISIONS.md) 合读；只在追溯原话时读。 |
| [intent/original-dialogue.json](intent/original-dialogue.json) | 参考 | ORIGINAL-DIALOGUE 的原始 JSON（含 rawText 与批注元数据）。 | 与 [intent/ORIGINAL-DIALOGUE.md](intent/ORIGINAL-DIALOGUE.md) 合读。 |
| [intent/assets/gimg.jpeg](intent/assets/gimg.jpeg) | 参考 | 用户原始数据与编排草图（原文件复制，SHA256 记于 ORIGINAL-DIALOGUE）。 | 与 [intent/ORIGINAL-DIALOGUE.md](intent/ORIGINAL-DIALOGUE.md) 合读。 |

## reviews/evidence/（按文件夹一行）

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [reviews/evidence/agent-behavior-2026-09-27/ag1/README.md](reviews/evidence/agent-behavior-2026-09-27/ag1/README.md) | 证据 | AG1 验收：新增按开放关联发现 Session、读卡片的只读工具并消费原邮箱，6 文件/42 项通过，另有 4 次真实 DeepSeek、3 次成功工具调用。 | 后续 AG2a/AG2b 接续；支持 IMPLEMENTED-CAPABILITIES 与 AGENT-ROLE-ACTIONS 的 AG1 条目（无编号决定）。 |
| [reviews/evidence/agent-behavior-2026-09-28/ag2/README.md](reviews/evidence/agent-behavior-2026-09-28/ag2/README.md) | 证据 | 同日三批：AG2a 显式咨询接收与正式回复、AG2b 存活 Host 内原 Run 持续通信、AG6 行为装配与真实模型样本。 | ag2 由 ag2b 接续；三者合读；支持 IMPLEMENTED-CAPABILITIES 的 AG2a/AG2b/AG6 条目（无编号决定）。 |
| [reviews/evidence/batch-wrapup-2026-10-08/README.md](reviews/evidence/batch-wrapup-2026-10-08/README.md) | 证据 | 可靠性批次收尾的独立审查：Codex 58 条发现的逐条去向、删除/合并/挪位置清单，以及决定 31 的行数核对与脚本输出。 | 支持决定 31；与 STATUS「收尾：独立审查」及「简化后的行数」合读。 |
| [reviews/evidence/cc-baseline-2026-10-02/README.md](reviews/evidence/cc-baseline-2026-10-02/README.md) | 证据 | 可靠性批次开工前在未修改基线 790d970 上的首次完整 Linux 运行（137 文件、1192/1199 通过、7 项稳定失败）。 | 之后任何失败先与本页对照；支持 STATUS「可靠性批次」起点（无编号决定）。 |
| [reviews/evidence/cleanup-2026-09-27/role-admission/verification.json](reviews/evidence/cleanup-2026-09-27/role-admission/verification.json) | 证据 | 有界清理首批：角色准入解析复用，组合根重复解析 4→0，4 文件/41 项、类型/边界/构建通过。 | 支持 HANDOFF/IMPLEMENTED-CAPABILITIES 的「有界清理」增量条目（无编号决定）。 |
| [reviews/evidence/code-growth-2026-09-27/inventory.json](reviews/evidence/code-growth-2026-09-27/inventory.json) | 证据 | 359 个生产/测试 TS 文件的基线/当前哈希、行数与增删区间机器清单，用于代码增长与改动定位。 | 与 reviews/new-code-and-logic-2026-09-27.md、current-module-map-2026-09-27.md 合读。 |
| [reviews/evidence/codex-review-trial-2026-10-07/README.md](reviews/evidence/codex-review-trial-2026-10-07/README.md) | 证据 | Codex 只读审查试验：3 个用例（含决定 29、状态机合并）加审设计书，验证换模型审查可放进决定 36 的循环。 | 做法写进 DSH-WORKFLOW §7；支持决定 39（设计书先让 Codex 审）。 |
| [reviews/evidence/dsh-ladder-2026-10-07/README.md](reviews/evidence/dsh-ladder-2026-10-07/README.md) | 证据 | DSH 分级测试 57 次运行，未找到规模/难度上限，定下任务书与失败反馈的写法（最大级约 6 分钟做完任务 D）。 | 支持决定 32；与 STATUS「DSH 分级测试（决定 32）」合读。 |
| [reviews/evidence/goal-cold-start-2026-09-29/README.md](reviews/evidence/goal-cold-start-2026-09-29/README.md) | 证据 | 正常 UI 冷启动接线与双图纠偏：真实新目标从设置选目录、对话、调查、形成/采用方案到推进的限定验收。 | 与 goal-conversation-start、session-rendering 等旧 UI 批合读；支持 MVP-BEHAVIOR 的 09-29 真实模型限定证据。 |
| [reviews/evidence/goal-conversation-start-2026-09-29/README.md](reviews/evidence/goal-conversation-start-2026-09-29/README.md) | 证据 | 目标创建与主对话启动：首次对话、缺模型提示、claimed 未 prepare 的原 Query 恢复，受控浏览器 3 次模型调用验收。 | 与 goal-cold-start 合读；旧界面 MVP 限定批（无编号决定）。 |
| [reviews/evidence/host-settings-2026-09-29/README.md](reviews/evidence/host-settings-2026-09-29/README.md) | 证据 | 本机工作区与模型设置：目录选择/新增工作区、模型 catalog、权限默认关闭、私有文件权限与重启恢复的浏览器验收。 | 与旧界面 MVP 批合读；支持 MVP-BEHAVIOR 的工作区/设置行为。 |
| [reviews/evidence/mvp-ui-2026-09-28/README.md](reviews/evidence/mvp-ui-2026-09-28/README.md) | 证据 | MVP UI 接线工程验证：Host 文件保存/命令执行、stage gate 修复、执行分页，以及限定浏览器与真实模型链。 | 信息架构被 ui-prototype-correction-2026-09-28 取代；实际消费者与工程验收仍按原范围保留。 |
| [reviews/evidence/next-a1-graph-session-2026-09-25/](reviews/evidence/next-a1-graph-session-2026-09-25/) | 证据 | A1 子集：正式架构目录、Module/Task 关联开闭、定向发现与显式归档/重新启用，75 文件/719 项通过。 | 报告 reviews/next-a1-graph-session-2026-09-25.md；后续 B1/W1 接续（旧 next 迁移批，无编号决定）。 |
| [reviews/evidence/next-b1-w1-2026-09-25/](reviews/evidence/next-b1-w1-2026-09-25/) | 证据 | B1 装配接缝（真实 Kernel Hook/按需开来源）与 W1 未来任务白板子集，78 文件/726 项通过。 | 报告 reviews/next-b1-w1-2026-09-25.md；后续 B2/C1 接续。 |
| [reviews/evidence/next-b2-2026-09-26/](reviews/evidence/next-b2-2026-09-26/) | 证据 | B2 许可/租约、C1 邮箱、M1 组合根与 Kernel 最小导出的骨架/测试中审，另含 R6 执行/历史/Session 浏览器证据。 | 报告 reviews/next-b2-c1-middle-review-2026-09-26.md；R6 浏览器证据被 reviews/completion-audit-2026-09-27.md 引用。 |
| [reviews/evidence/next-clean-migration-2026-09-24/](reviews/evidence/next-clean-migration-2026-09-24/) | 证据 | N0 干净迁移与 R3c reader/index 首批：新目标工程不 import 旧 src，1313 文件零变动，隔离构建通过。 | 报告 reviews/next-clean-migration-2026-09-24.md；与 next-completed-migration 合读。 |
| [reviews/evidence/next-completed-migration-2026-09-24/README.md](reviews/evidence/next-completed-migration-2026-09-24/README.md) | 证据 | 已完成能力补迁：43 个直接补迁文件的来源/目标哈希、契约声明闭包提取、独立只读差异审阅。 | 与 next-clean-migration 合读；报告 reviews/next-completed-migration-2026-09-24.md。 |
| [reviews/evidence/next-r3c-r4b-2026-09-24/](reviews/evidence/next-r3c-r4b-2026-09-24/) | 证据 | R3c/R4b 子集：唯一槽 CAS/水位、初始计划候选/采用、Session 映射、无模型创建与故障恢复，48 文件/321 项。 | 报告 reviews/next-r3c-r4b-2026-09-24.md。 |
| [reviews/evidence/next-r3c-relations-2026-09-24/](reviews/evidence/next-r3c-relations-2026-09-24/) | 证据 | R3c 任务关系与精确输入：Plan schemaVersion 2、关系/输入持久化与唯一读取入口，57 文件/383 项。 | 报告 reviews/next-r3c-relations-2026-09-24.md；后续 next-r4c-claim 接续。 |
| [reviews/evidence/next-r3d-r3g-2026-09-24/](reviews/evidence/next-r3d-r3g-2026-09-24/) | 证据 | R3d 源码观测与 R3g 角色规格子批：安装/激活/历史 pin、真实环与影响，53 文件/372 项。 | 报告 reviews/next-r3d-r3g-2026-09-24.md。 |
| [reviews/evidence/next-r4c-claim-2026-09-24/](reviews/evidence/next-r4c-claim-2026-09-24/) | 证据 | R4c.1 Task 原子领取：claimTask 一事务写 TaskLease/Attempt/Run/Session 占用，60 文件/422 项。 | 报告 reviews/next-r4c-claim-2026-09-24.md；后续 next-r4c-execution-reads。 |
| [reviews/evidence/next-r4c-continuity-2026-09-24/](reviews/evidence/next-r4c-continuity-2026-09-24/) | 证据 | R4c 连续 Session 转发窄子集：observed-model-run 复用冻结 Kernel 的历史边界与执行身份，54 文件/376 项。 | 报告 reviews/next-r4c-continuity-2026-09-24.md。 |
| [reviews/evidence/next-r4c-execution-reads-2026-09-25/](reviews/evidence/next-r4c-execution-reads-2026-09-25/) | 证据 | R4c.2a 精确执行事实与定向历史读取：WorkGraph readExecution + Runtime readExecutionHistory 两个读取子集。 | 报告 reviews/next-r4c-execution-reads-2026-09-25.md；后续 next-r4c-history-locators。 |
| [reviews/evidence/next-r4c-history-locators-2026-09-25/](reviews/evidence/next-r4c-history-locators-2026-09-25/) | 证据 | R4c.2b 图定位历史修复：Run 保存 SessionRef/身份/起止位置，按 Kernel 位置范围读而不是全量物化。 | 与 next-r4c-source-authority 合读同一报告 reviews/next-r4c-history-and-source-2026-09-25.md。 |
| [reviews/evidence/next-r4c-source-authority-2026-09-25/](reviews/evidence/next-r4c-source-authority-2026-09-25/) | 证据 | R4c.2c 源码事实接线：recordExecutionHistory/readTaskExecutionHistory 接组合根，68 文件/620 项通过。 | 同上报告 reviews/next-r4c-history-and-source-2026-09-25.md；两部分合为一个验收。 |
| [reviews/evidence/orchestration-2026-09-28/README.md](reviews/evidence/orchestration-2026-09-28/README.md) | 证据 | 共同编排机制实现与验收：问询/原执行分离、等待让出、迟到回复、通知消费、控制、独立并行、机械注意力、生命周期/UI。 | 支持 IMPLEMENTED-CAPABILITIES/ORCHESTRATION-STATE-MACHINES 的共同机制条目；明确不等于整个 MVP。 |
| [reviews/evidence/orchestration-slice-0-2026-10-08/README.md](reviews/evidence/orchestration-slice-0-2026-10-08/README.md) | 证据 | 编排第 0 片：注意力观察依赖条件写成「种类:标签」，加 3 个用例；同目录含 B0 的 views 子模块与 configuration→state 声明。 | 支持 STATUS 第 0 片/B0 与「[object Object]」缺口关闭；B0 是第 1/3/5 片共同基线。 |
| [reviews/evidence/orchestration-slice-1-2026-10-08/README.md](reviews/evidence/orchestration-slice-1-2026-10-08/README.md) | 证据 | 编排第 1 片：Session 来历与事实、负责关系转移/放下、归档组合动作、异常锚点、等待处置、按依赖软排序（327ec020）。 | 支持决定 45、46 与 STATUS「编排第 1 片」；普通接续交接缺口由接线包 1 补。 |
| [reviews/evidence/orchestration-slice-3-2026-10-08/README.md](reviews/evidence/orchestration-slice-3-2026-10-08/README.md) | 证据 | 编排第 3 片：上下文装配器、看/找图工具与路由、五种职责角色配置、精确输入消费时检查、注意力改读图（ccecc016）；含与第 1 片合入及回归修正 e48218a5。 | 支持 STATUS「编排第 3 片」；与第 1 片三方合并合读。 |
| [reviews/evidence/orchestration-slice-5-2026-10-08/README.md](reviews/evidence/orchestration-slice-5-2026-10-08/README.md) | 证据 | 编排第 5 片：目标自治级别/顺序/等前一个/冲突提示、「需要你决定」队列、决定卡与答复落实；经决定 47、48 两轮破例后合入 a7cafccc。 | 支持决定 47、48 与 STATUS「编排第 5 片」；遗留项转第 2/6 片（决定 49）。 |
| [reviews/evidence/orchestration-slice-K-2026-10-13/partA/README.md](reviews/evidence/orchestration-slice-K-2026-10-13/partA/README.md) | 证据 | K 片 A/B 一个文件夹两半：partA 是 Kernel closeOpenTurn/readTurnBounds 与 Runtime/Workflow 原 Session 关悬空 Turn 再接续（cfe35550）；partB 是只读命令 run_readonly_command 的只读沙箱、授权与 Host 开关，结果 ≤128 KiB（9881a2ae）。 | 目录无顶层 README；partA/README.md 与 partB/README.md（另 lead-acceptance.md）分别记验收和限制。支持决定 49/50 的 K 片条目与决定 51 的丙（K 片据此冻结）；K3/决定 52 是后续片。 |
| [reviews/evidence/orchestration-wiring-1-2026-10-09/README.md](reviews/evidence/orchestration-wiring-1-2026-10-09/README.md) | 证据 | 接线包 1：I-1 职责解析（session-duty.ts）、I-3 装配器异常锚点、改目标说明的检查、普通接续交接（transfer_responsibility/archive_predecessor），提交 6180adfc。 | 支持决定 47 与 STATUS「接线包 1」；遗留的 I-2/I-4/I-5/I-6 由接线包 2 接续。 |
| [reviews/evidence/orchestration-wiring-2-2026-10-13/README.md](reviews/evidence/orchestration-wiring-2-2026-10-13/README.md) | 证据 | 接线包 2：I-2 正式职责 adapter、I-4 自治级别、I-5 未送达回复、I-6 待决事项进上下文，并加 unavailableSince/responseSince，提交 bb924854。 | 支持决定 49 第 29 项与 STATUS「接线包 2」；两处临时上限由 2A 规格 §0.4 撤掉。 |
| [reviews/evidence/r2e1-sol-dsh-2026-09-24/](reviews/evidence/r2e1-sol-dsh-2026-09-24/) | 证据 | R2e.1 文本捕获/精确读取/同范围比较：Sol 骨架 + 受限 dsh 独立验收，新增 2 项并 18 项全过、56 项相关回归。 | 报告 reviews/R2e-1-sol-dsh-acceptance.md（旧 next 迁移批，无编号决定）。 |
| [reviews/evidence/r3a-r4a-2026-09-23/README.md](reviews/evidence/r3a-r4a-2026-09-23/README.md) | 证据 | R3a/R4a 首轮独立验收的失败与反例证据：事务内身份守卫、程序化输入隔离、旧 Run 身份/预算/沙箱限制等未通过项。 | 报告 reviews/R3a-R4a-independent-acceptance.md；后续 sol-dsh 批次修复后取代其失败状态。 |
| [reviews/evidence/r3b-sol-dsh-2026-09-24/](reviews/evidence/r3b-sol-dsh-2026-09-24/) | 证据 | R3b 材料迁移：Sol 窄接口与冻结测试 + Raw/WorkGraph 两 lane dsh 并行实现 + 集成装配，功能验收 31 项/回归 68 项。 | 报告 reviews/R3b-sol-dsh-acceptance.md；消费者盘点见 reviews/R3b-material-consumer-inventory.md。 |
| [reviews/evidence/session-rendering-2026-09-29/README.md](reviews/evidence/session-rendering-2026-09-29/README.md) | 证据 | 既有 Session 历史的正常会话展示：Markdown/工具输出/折叠、原始记录可展开，3 文件 28 项 + 浏览器验收。 | 与 ui-progressive-session 合读；旧界面 MVP 限定批。 |
| [reviews/evidence/sol-dsh-2026-09-24/README.md](reviews/evidence/sol-dsh-2026-09-24/README.md) | 证据 | R3a/R4a 的 Sol 骨架 + 受限 dsh 返修最终验收：契约 24/17 全过、Kernel 207 项过、真实旧库与构建通过。 | 报告 reviews/R3a-R4a-sol-dsh-acceptance.md；取代 r3a-r4a-2026-09-23 的失败结果。 |
| [reviews/evidence/standalone-2026-09-27/verification.json](reviews/evidence/standalone-2026-09-27/verification.json) | 证据 | 独立仓库验收 124 文件/1102 项通过（含最终 graph/history UI）；同目录含受控 coding 与真实 DeepSeek R5b 限定验收。 | 支持 STATUS/IMPLEMENTED-CAPABILITIES 的 09-27 独立验收与真实模型接入引用；不覆盖整个 MVP。 |
| [reviews/evidence/ui-directory-inventory-2026-09-29/README.md](reviews/evidence/ui-directory-inventory-2026-09-29/README.md) | 证据 | 文件资源管理器目录列表修复：files/list 复用 Host/Kernel WorkspaceSandbox.listFiles，只列路径不放宽读取限制，2 文件 13 项 + 浏览器验收。 | 与 session-rendering 等旧 UI 批合读；旧界面 MVP 限定批。 |
| [reviews/evidence/ui-progressive-session-2026-09-29/README.md](reviews/evidence/ui-progressive-session-2026-09-29/README.md) | 证据 | Session 渐进展示：活动分组/摘要、稳定展开键、思考展示，纯读两次模型计数差值为 0，五文件 UI 候选验收。 | 与 session-rendering 合读；旧界面 MVP 限定批。 |
| [reviews/evidence/ui-prototype-correction-2026-09-28/README.md](reviews/evidence/ui-prototype-correction-2026-09-28/README.md) | 证据 | 按用户否决对 MVP UI 的信息架构与交互纠偏：项目/成员、中心、页签、图交互、草稿等逐项浏览器核对。 | 取代 mvp-ui-2026-09-28 的信息架构结论；用户对最终视觉的批准仍未完成。 |
| [reviews/evidence/ui-split-sse-2026-10-04/README.md](reviews/evidence/ui-split-sse-2026-10-04/README.md) | 证据 | 任务 E：阶段 1 拆分 src/ui（不改行为）、阶段 2 SSE 替代轮询，重构前后 23 张截图逐像素一致。 | 支持 STATUS「E 前端拆分与 SSE」条目（提交 759e6a2/cdf6e4d/9523ea8）。 |
| [reviews/evidence/workgraph-move-2026-10-07/README.md](reviews/evidence/workgraph-move-2026-10-07/README.md) | 证据 | 任务 D WorkGraph 纯搬移执行：两段任务书、DSH 用量、与参考搬移逐字节一致、X1/X2 与子模块声明。 | 支持决定 32、34、40 与 STATUS「D WorkGraph 拆分」；与 workgraph-split-2026-10-07 方案合读。 |
| [reviews/evidence/workgraph-split-2026-10-02/TARGET-DAG.md](reviews/evidence/workgraph-split-2026-10-02/TARGET-DAG.md) | 证据 | 任务 D 前期：WorkGraph import 图证据与 10-02 目标子模块 DAG 提案（13 子模块、17 文件搬移、55 环断开）。 | 被 workgraph-split-2026-10-07 的方案重算取代；支持 STATUS「D 的准备」a22ad30。 |
| [reviews/evidence/workgraph-split-2026-10-07/README.md](reviews/evidence/workgraph-split-2026-10-07/README.md) | 证据 | 在简化后代码上重算的 WorkGraph 拆分方案：13 子模块、18 文件搬移（含 M18）、X1/X2 与 module-target.json 声明，经 Codex 审后用户确认。 | 支持决定 34、40；由 workgraph-move-2026-10-07 执行，方案文本保留为提案记录。 |

## skeleton/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [skeleton/README.md](skeleton/README.md) | 参考 | 五模块/8 边与 13 子模块的骨架总览（实现前详细设计） | 与 [CONTRACTS](skeleton/CONTRACTS.md)、[END-TO-END](skeleton/END-TO-END.md)、[ARCHITECTURE](ARCHITECTURE.md) 合读；实现范围沿源码 |
| [skeleton/CONTRACTS.md](skeleton/CONTRACTS.md) | 参考 | 五模块共享身份、调用上下文、读写结果、来源与 Session 占用的共同契约 | [refactor/README](README.md) 列为“数据与接口参考”；与 [CORE-DATA-OPERATIONS](CORE-DATA-OPERATIONS.md) 合读 |
| [skeleton/END-TO-END.md](skeleton/END-TO-END.md) | 参考 | Host/组合根、真实任务路径与 UI/路由接线的贯通设计 | 与 [ARCHITECTURE](ARCHITECTURE.md)、[STATUS](STATUS.md) 合读；顶部 09-26/09-27 状态段按历史处理 |

## tasks/

| 文件 | 状态 | 用途（一句话） | 被谁取代 / 与谁合读 |
| --- | --- | --- | --- |
| [README.md](tasks/README.md) | 历史 | 旧批次任务书目录说明，声明这里没有当前施工指令 | 旧批次目录索引；同类：（无） |
| [A1-catalog-implementation-prompt.md](tasks/A1-catalog-implementation-prompt.md) | 历史 | A1 正式 Catalog 实现与独立审阅返修 | 旧 A1 批次；同类：`A1-catalog-implementation-scope.json`、[A1-catalog-review-fixes.md](tasks/A1-catalog-review-fixes.md) |
| [A1-ended-work-link-discovery-skeleton.md](tasks/A1-ended-work-link-discovery-skeleton.md) | 历史 | A1 已结束 WorkLink 定向发现（已停止的旧 lane） | tasks/README 点名不得照原文派发；同类：`A1-ended-work-link-discovery-skeleton-scope.json` |
| [A1-graph-session-skeleton-prompt.md](tasks/A1-graph-session-skeleton-prompt.md) | 历史 | A1/R3d+R4b 沿架构图发现工作 Session | 旧 A1 批次；同类：`A1-graph-session-skeleton-scope.json` |
| [A1-middle-review.md](tasks/A1-middle-review.md) | 历史 | A1 骨架与测试中审记录 | 旧 A1 批次；同类：（无） |
| [A1-session-replay-completion.md](tasks/A1-session-replay-completion.md) | 历史 | A1 幂等恢复必须覆盖整个当前状态判定 | 旧 A1 批次；同类：（无） |
| [A1-session-implementation-prompt.md](tasks/A1-session-implementation-prompt.md) | 历史 | A1 Session 关联、生命周期与定向发现实现及审阅返修 | 旧 A1 批次；同类：`A1-session-implementation-scope.json`、[A1-session-review-fixes.md](tasks/A1-session-review-fixes.md) |
| [AG1-session-discovery-2026-09-27.md](tasks/AG1-session-discovery-2026-09-27.md) | 历史 | Agent 发现关联 Session 并发出咨询 | 旧 AG 批次；同类：`AG1-session-discovery-stage1-2026-09-27.json`、`AG1-session-discovery-stage2-2026-09-27.json` |
| [AG2-consultation-2026-09-28.md](tasks/AG2-consultation-2026-09-28.md) | 历史 | 显式咨询到原收件 Session、正式 Answer 与原消息回复 | 旧 AG 批次；同类：`AG2-consultation-stage1-2026-09-28.json`、`AG2-consultation-stage2-2026-09-28.json` |
| [AG2b-continuous-communication-2026-09-28.md](tasks/AG2b-continuous-communication-2026-09-28.md) | 历史 | 持续通信与工程闭环 | 旧 AG 批次；同类：`AG2b-continuous-stage1-2026-09-28.json`、`AG2b-continuous-stage2-2026-09-28.json` |
| [AG6-behavior-assembly-2026-09-28.md](tasks/AG6-behavior-assembly-2026-09-28.md) | 历史 | 面向人的行为指令与显式装配 | 旧 AG 批次；同类：`AG6-behavior-assembly-stage1-2026-09-28.json`、`AG6-behavior-assembly-stage2-2026-09-28.json` |
| [B1-kernel-assembly-skeleton.md](tasks/B1-kernel-assembly-skeleton.md) | 历史 | 复用现有模型循环的角色配置与实际进入接缝 | 旧 B1 批次；同类：`B1-kernel-assembly-implementation-scope.json`、[B1-kernel-assembly-implementation.md](tasks/B1-kernel-assembly-implementation.md)、[B1-kernel-assembly-middle-fixes.md](tasks/B1-kernel-assembly-middle-fixes.md)、[B1-kernel-assembly-review-fixes.md](tasks/B1-kernel-assembly-review-fixes.md)、`B1-kernel-assembly-skeleton-scope.json` |
| [B2-C1-M1-composition-implementation.md](tasks/B2-C1-M1-composition-implementation.md) | 历史 | 平台组合根接线实施 | 旧 B2/C1/M1 交叉批次；同类：`B2-C1-M1-composition-implementation-scope.json` |
| [B2-execution-state-skeleton.md](tasks/B2-execution-state-skeleton.md) | 历史 | WorkGraph 执行状态骨架、重试、实现与返修 | 旧 B2 批次；同类：`B2-execution-state-implementation-scope.json`、[B2-execution-state-implementation.md](tasks/B2-execution-state-implementation.md)、[B2-execution-state-repair.md](tasks/B2-execution-state-repair.md)、[B2-execution-state-skeleton-retry.md](tasks/B2-execution-state-skeleton-retry.md)、`B2-execution-state-skeleton-scope.json` |
| [B2-kernel-history-export-skeleton.md](tasks/B2-kernel-history-export-skeleton.md) | 历史 | Kernel 历史配对校验/完整性 validator 公开导出 | 旧 B2 批次；同类：`B2-kernel-history-export-implementation-scope.json`、[B2-kernel-history-export-implementation.md](tasks/B2-kernel-history-export-implementation.md)、`B2-kernel-history-export-skeleton-scope.json` |
| [B2-material-facts-skeleton.md](tasks/B2-material-facts-skeleton.md) | 历史 | 外部材料准入接入 M2 局部事实 | 旧 B2 批次；同类：`B2-material-facts-implementation-scope.json`、[B2-material-facts-implementation.md](tasks/B2-material-facts-implementation.md)、`B2-material-facts-skeleton-scope.json` |
| [B2-runtime-skeleton.md](tasks/B2-runtime-skeleton.md) | 历史 | Runtime 正式装配、fresh 执行、原历史观察与临时缓存释放 | 旧 B2 批次；同类：[B2-runtime-cache-cleanup.md](tasks/B2-runtime-cache-cleanup.md)、`B2-runtime-implementation-scope.json`、[B2-runtime-implementation.md](tasks/B2-runtime-implementation.md)、[B2-runtime-independent-repair.md](tasks/B2-runtime-independent-repair.md)、`B2-runtime-skeleton-scope.json` |
| [C1-session-mailbox-skeleton.md](tasks/C1-session-mailbox-skeleton.md) | 历史 | Session 定向邮箱骨架与实现及返修 | 旧 C1 批次；同类：`C1-session-mailbox-implementation-scope.json`、[C1-session-mailbox-implementation.md](tasks/C1-session-mailbox-implementation.md)、[C1-session-mailbox-repair.md](tasks/C1-session-mailbox-repair.md)、`C1-session-mailbox-skeleton-scope.json` |
| [C2-runtime-platform-tools-skeleton.md](tasks/C2-runtime-platform-tools-skeleton.md) | 历史 | Runtime 通信、白板与职责资源消费者接线 | 旧 C2 批次；同类：`C2-runtime-platform-tools-implementation-scope.json`、[C2-runtime-platform-tools-implementation.md](tasks/C2-runtime-platform-tools-implementation.md)、`C2-runtime-platform-tools-skeleton-scope.json` |
| [CLEANUP-role-admission-2026-09-27.md](tasks/CLEANUP-role-admission-2026-09-27.md) | 历史 | 同次准入复用角色解析 | 旧清理批次；同类：`CLEANUP-role-admission-stage1-2026-09-27.json`、`CLEANUP-role-admission-stage2-2026-09-27.json` |
| [DSH-PARALLEL-IMPLEMENTATION.md](tasks/DSH-PARALLEL-IMPLEMENTATION.md) | 历史 | R3a Goal 贯通与 R4a Kernel 扩展的 DSH 并行任务 | 旧 DSH 派发；同类：（无） |
| [DSH-redundancy-review-2026-09-27.md](tasks/DSH-redundancy-review-2026-09-27.md) | 历史 | DSH 长上下文只读对照审查 | 旧 DSH 审查；同类：`DSH-redundancy-review-2026-09-27.json` |
| [GOAL-cold-start-2026-09-29.md](tasks/GOAL-cold-start-2026-09-29.md) | 历史 | 新目录 Goal 冷启动接线 | 09-29 旧批次；同类：`GOAL-cold-start-scope.json` |
| [HOST-settings-backend-2026-09-29.md](tasks/HOST-settings-backend-2026-09-29.md) | 历史 | Host 真实目录与模型设置后端（含 profile availability scope） | 09-29 旧批次；同类：`HOST-profile-availability-scope.json`、`HOST-settings-backend-scope.json` |
| [M1-material-grant-skeleton.md](tasks/M1-material-grant-skeleton.md) | 历史 | 正式材料授权与 current 来源接线及返修 | 旧 M1 批次；同类：`M1-material-grant-implementation-scope.json`、[M1-material-grant-implementation.md](tasks/M1-material-grant-implementation.md)、[M1-material-grant-repair.md](tasks/M1-material-grant-repair.md)、`M1-material-grant-skeleton-scope.json` |
| [M1-validation-simplification.md](tasks/M1-validation-simplification.md) | 历史 | M1 已审核实现的局部去重 | 旧 M1 批次；同类：`M1-validation-simplification-scope.json` |
| [M2-material-read-facts-skeleton.md](tasks/M2-material-read-facts-skeleton.md) | 历史 | 材料读取事实与局部事务 guard | 旧 M2 批次；同类：`M2-material-read-facts-implementation-scope.json`、[M2-material-read-facts-implementation.md](tasks/M2-material-read-facts-implementation.md)、`M2-material-read-facts-skeleton-scope.json` |
| [MVP-ui-connection-2026-09-28.md](tasks/MVP-ui-connection-2026-09-28.md) | 历史 | MVP 原型接线；backend/ui scope 并入 | 09-28 旧批次；同类：`MVP-ui-backend-scope.json`、`MVP-ui-connection-scope.json`、`MVP-ui-ui-scope.json` |
| [MVP-ui-prototype-correction-2026-09-28.md](tasks/MVP-ui-prototype-correction-2026-09-28.md) | 历史 | 恢复已确认 MVP 原型的界面与交互 | 09-28 旧批次；同类：（无） |
| [N0-material-readers-dsh-execution.md](tasks/N0-material-readers-dsh-execution.md) | 历史 | 由目标 RecordStore 提供材料事实与候选读取 | 旧 N0/R3c 批次；同类：`N0-material-readers-dsh-write-scope.json` |
| [N0-store-dsh-execution.md](tasks/N0-store-dsh-execution.md) | 历史 | 独立目标 Store 的精确索引与旧后门退出 | 旧 N0/R3c 批次；同类：`N0-store-dsh-write-scope.json` |
| [ORCHESTRATION-common-mechanism-2026-09-28.md](tasks/ORCHESTRATION-common-mechanism-2026-09-28.md) | 历史 | 共同编排机制整体实现与统一验收 | 09-28 旧共同机制；同类：`ORCHESTRATION-common-scope-2026-09-28.json` |
| [QUERY-null-budget-scope.json](tasks/QUERY-null-budget-scope.json) | 历史 | Query 空/终态预算的 scope 记录 | 旧 Query 批次；无 md 任务书；同类：`QUERY-terminal-budget-scope.json` |
| [R2a-workspace-ownership.md](tasks/R2a-workspace-ownership.md) | 历史 | WorkspaceTools 的真实所有权与消费者迁移 | 旧 R2 批次；同类：（无） |
| [R2b-frozen-source-query.md](tasks/R2b-frozen-source-query.md) | 历史 | 冻结源码材料与 TypeScript 查询实现 | 旧 R2 批次；同类：（无） |
| [R2c-capture-registry.md](tasks/R2c-capture-registry.md) | 历史 | TypeScript 冻结捕获注册表与真实架构读取 | 旧 R2 批次；同类：（无） |
| [R2d-1-tool-protocol.md](tasks/R2d-1-tool-protocol.md) | 历史 | 冻结源码工具协议与工具资源归属 | 旧 R2 批次；同类：（无） |
| [R2d-2-work-source-binding.md](tasks/R2d-2-work-source-binding.md) | 历史 | 普通 Work、探索与 Reviewer 的真实源码能力绑定 | 旧 R2 批次；同类：（无） |
| [R2d-3-query-source-binding.md](tasks/R2d-3-query-source-binding.md) | 历史 | QueryRun 的真实源码能力绑定与生产入口收口 | 旧 R2 批次；同类：（无） |
| [R2d-model-source-tools.md](tasks/R2d-model-source-tools.md) | 历史 | 模型工具冻结分页与资源归属 | 旧 R2 批次；同类：（无） |
| [R2e-1-text-read-compare.md](tasks/R2e-1-text-read-compare.md) | 历史 | 严格文本捕获、文件读取与同范围内容比较，含 DSH/定点返修 | 旧 R2e 批次；同类：[R2e-1-dsh-execution.md](tasks/R2e-1-dsh-execution.md)、`R2e-1-dsh-write-scope.json`、[R2e-1-sol-followup.md](tasks/R2e-1-sol-followup.md) |
| [R2e-2-git-read-compare-skeleton.md](tasks/R2e-2-git-read-compare-skeleton.md) | 历史 | next Git 固定版本读取、比较与 project_source 消费者 | 旧 R2e 批次；同类：[R2e-2-git-read-compare-dispatch.md](tasks/R2e-2-git-read-compare-dispatch.md)、[R2e-2-git-read-compare-implementation-repair.md](tasks/R2e-2-git-read-compare-implementation-repair.md)、`R2e-2-git-read-compare-implementation-scope.json`、[R2e-2-git-read-compare-implementation.md](tasks/R2e-2-git-read-compare-implementation.md)、[R2e-2-git-read-compare-middle-repair.md](tasks/R2e-2-git-read-compare-middle-repair.md)、`R2e-2-git-read-compare-skeleton-scope.json` |
| [R2e-mixed-comparison-skeleton.md](tasks/R2e-mixed-comparison-skeleton.md) | 历史 | Git 与当前工作树文本的混合比较 | 旧 R2e 批次；同类：`R2e-mixed-comparison-implementation-scope.json`、[R2e-mixed-comparison-implementation.md](tasks/R2e-mixed-comparison-implementation.md)、`R2e-mixed-comparison-skeleton-scope.json` |
| [R3-next-store-extensions.md](tasks/R3-next-store-extensions.md) | 历史 | 目标 Store 与 RecordStore 最小事务扩展 | 旧 R3 批次；同类：[R3-next-store-dsh-prompt.md](tasks/R3-next-store-dsh-prompt.md)、`R3-next-store-dsh-scope.json` |
| [R3a-goal-record-store.md](tasks/R3a-goal-record-store.md) | 历史 | Goal 创建贯穿 WorkGraph 与 RecordStore，含 raw batch 隔离与验收修复 | 旧 R3a 批次；R3a-R4a 交叉返修并入；同类：[R3a-R4a-acceptance-fixes.md](tasks/R3a-R4a-acceptance-fixes.md)、[R3a-dsh-continue.md](tasks/R3a-dsh-continue.md)、[R3a-dsh-execution.md](tasks/R3a-dsh-execution.md)、`R3a-dsh-write-scope.json`、[R3a-sol-skeleton.md](tasks/R3a-sol-skeleton.md) |
| [R3b-integration-dsh-execution.md](tasks/R3b-integration-dsh-execution.md) | 历史 | 真实调用链集成（含 Host 历史授权返修） | 旧 R3b 批次；同类：[R3b-integration-dsh-issuer-repair.md](tasks/R3b-integration-dsh-issuer-repair.md)、[R3b-integration-dsh-repair.md](tasks/R3b-integration-dsh-repair.md)、`R3b-integration-dsh-write-scope.json` |
| [R3b-raw-dsh-execution.md](tasks/R3b-raw-dsh-execution.md) | 历史 | Raw 材料正文受限并行实现与首轮返修 | 旧 R3b 批次；同类：[R3b-raw-dsh-repair.md](tasks/R3b-raw-dsh-repair.md)、`R3b-raw-dsh-write-scope.json` |
| [R3b-sol-skeleton.md](tasks/R3b-sol-skeleton.md) | 历史 | R3b Sol 材料正文骨架与独立测试 | 旧 R3b 批次；同类：（无） |
| [R3b-work-graph-dsh-execution.md](tasks/R3b-work-graph-dsh-execution.md) | 历史 | WorkGraph 受限并行实现与审阅返修 | 旧 R3b 批次；同类：[R3b-work-graph-dsh-await-repair.md](tasks/R3b-work-graph-dsh-await-repair.md)、[R3b-work-graph-dsh-repair.md](tasks/R3b-work-graph-dsh-repair.md)、`R3b-work-graph-dsh-write-scope.json` |
| [R3c-next-plan-skeleton.md](tasks/R3c-next-plan-skeleton.md) | 历史 | 计划采用与任务读取骨架 | 旧 R3c 批次；同类：[R3c-next-plan-dsh-prompt.md](tasks/R3c-next-plan-dsh-prompt.md)、[R3c-next-plan-dsh-revision.md](tasks/R3c-next-plan-dsh-revision.md)、`R3c-next-plan-dsh-scope.json` |
| [R3c-next-relations-skeleton-prompt.md](tasks/R3c-next-relations-skeleton-prompt.md) | 历史 | 任务关系与精确输入的骨架/实现及对齐纠偏 | 旧 R3c 批次；同类：[R3c-next-relations-dsh-prompt.md](tasks/R3c-next-relations-dsh-prompt.md)、`R3c-next-relations-dsh-scope.json`、`R3c-next-relations-skeleton-scope.json`、[R3c-next-task-relations-alignment-prompt.md](tasks/R3c-next-task-relations-alignment-prompt.md) |
| [R3d-R3g-next-skeleton.md](tasks/R3d-R3g-next-skeleton.md) | 历史 | 角色规格与持久源码观测（R3g/R3d 子集） | 旧 R3d/R3g 批次；同类：（无） |
| [R3d-architecture-evolution-skeleton.md](tasks/R3d-architecture-evolution-skeleton.md) | 历史 | 正式包含关系与已授权目录修订（Stage1/2） | 旧 R3d 批次；同类：`R3d-architecture-evolution-implementation-scope.json`、[R3d-architecture-evolution-implementation.md](tasks/R3d-architecture-evolution-implementation.md)、`R3d-architecture-evolution-skeleton-scope.json` |
| [R3d-next-observed-dsh-prompt.md](tasks/R3d-next-observed-dsh-prompt.md) | 历史 | 持久源码观测与索引来源修订 | 旧 R3d 批次；同类：[R3d-next-observed-dsh-final-revision.md](tasks/R3d-next-observed-dsh-final-revision.md)、[R3d-next-observed-dsh-revision.md](tasks/R3d-next-observed-dsh-revision.md)、`R3d-next-observed-dsh-scope.json`、[R3d-next-observed-indexed-source-revision.md](tasks/R3d-next-observed-indexed-source-revision.md) |
| [R3e-completion-skeleton.md](tasks/R3e-completion-skeleton.md) | 历史 | 检查记录、正式证据与完成归约的最小施工设计与实现 | 旧 R3e 批次；同类：[R3e-completion-dispatch.md](tasks/R3e-completion-dispatch.md)、[R3e-completion-gate-entry-repair.md](tasks/R3e-completion-gate-entry-repair.md)、[R3e-completion-implementation-repair.md](tasks/R3e-completion-implementation-repair.md)、`R3e-completion-implementation-scope.json`、[R3e-completion-implementation.md](tasks/R3e-completion-implementation.md)、[R3e-completion-middle-repair.md](tasks/R3e-completion-middle-repair.md)、`R3e-completion-skeleton-scope.json` |
| [R3e-readonly-report-skeleton.md](tasks/R3e-readonly-report-skeleton.md) | 已被取代 | R3e.2a 只读报告的真实来源见证与原 Evidence 消费（已作废） | 2026-10-07 按决定 34 作废，由简化批次与现行编排设计取代（tasks/README 点名不再恢复施工）；同类：（无） |
| [R3e-task-goal-completion-skeleton.md](tasks/R3e-task-goal-completion-skeleton.md) | 历史 | Task/Goal 正式完成的首批骨架与实现 | 旧 R3e 批次；同类：[R3e-task-goal-completion-implementation-repair.md](tasks/R3e-task-goal-completion-implementation-repair.md)、`R3e-task-goal-completion-implementation-scope.json`、[R3e-task-goal-completion-implementation.md](tasks/R3e-task-goal-completion-implementation.md)、`R3e-task-goal-completion-skeleton-scope.json` |
| [R3g-coordination-policy-skeleton.md](tasks/R3g-coordination-policy-skeleton.md) | 历史 | 协调政策正式安装与启用（Stage1，待主审） | tasks/README 点名不得照原文派发；同类：`R3g-coordination-policy-skeleton-scope.json` |
| [R3g-next-role-dsh-prompt.md](tasks/R3g-next-role-dsh-prompt.md) | 历史 | 角色规格与固定 Kernel 映射（next） | 旧 R3g 批次；同类：[R3g-next-role-dsh-revision.md](tasks/R3g-next-role-dsh-revision.md)、`R3g-next-role-dsh-scope.json` |
| [R4-control-intent-implementation.md](tasks/R4-control-intent-implementation.md) | 历史 | 持久控制意图的骨架/实现与并发回执返修 | 旧 R4 批次；同类：[R4-control-intent-dispatch.md](tasks/R4-control-intent-dispatch.md)、[R4-control-intent-implementation-repair.md](tasks/R4-control-intent-implementation-repair.md)、`R4-control-intent-implementation-scope.json`、[R4-control-intent-middle-repair.md](tasks/R4-control-intent-middle-repair.md)、`R4-control-intent-skeleton-scope.json` |
| [R4-control-recovery-skeleton.md](tasks/R4-control-recovery-skeleton.md) | 历史 | 持久控制、安全点确认与原 Run 恢复 | 旧 R4 批次；同类：（无） |
| [R4-control-runtime-implementation.md](tasks/R4-control-runtime-implementation.md) | 历史 | 本地控制投递与原历史确认（R4.3a） | 旧 R4 批次；同类：[R4-control-runtime-dispatch.md](tasks/R4-control-runtime-dispatch.md)、`R4-control-runtime-implementation-scope.json`、[R4-control-runtime-middle-repair.md](tasks/R4-control-runtime-middle-repair.md)、`R4-control-runtime-skeleton-scope.json` |
| [R4-terminal-history-skeleton.md](tasks/R4-terminal-history-skeleton.md) | 历史 | 取消后的原历史与后继上下文（R4.3b） | 旧 R4 批次；同类：`R4-terminal-history-implementation-scope.json`、[R4-terminal-history-implementation.md](tasks/R4-terminal-history-implementation.md)、`R4-terminal-history-skeleton-scope.json` |
| [R4-tool-group-barrier-implementation.md](tasks/R4-tool-group-barrier-implementation.md) | 历史 | Kernel 工具组安全点屏障（R4.2） | 旧 R4 批次；同类：[R4-tool-group-barrier-dispatch.md](tasks/R4-tool-group-barrier-dispatch.md)、`R4-tool-group-barrier-implementation-scope.json`、`R4-tool-group-barrier-skeleton-scope.json` |
| [R4a-sol-skeleton.md](tasks/R4a-sol-skeleton.md) | 历史 | Kernel 扩展骨架、原 Session 执行与最终返修 | 旧 R4a 批次；同类：[R4a-dsh-continue.md](tasks/R4a-dsh-continue.md)、[R4a-dsh-execution.md](tasks/R4a-dsh-execution.md)、[R4a-dsh-review-fixes.md](tasks/R4a-dsh-review-fixes.md)、[R4a-dsh-revision-fix.md](tasks/R4a-dsh-revision-fix.md)、`R4a-dsh-write-scope.json` |
| [R4b-next-runtime-dsh-prompt.md](tasks/R4b-next-runtime-dsh-prompt.md) | 历史 | next Runtime 装配与执行 | 旧 R4b 批次；同类：[R4b-next-runtime-dsh-revision.md](tasks/R4b-next-runtime-dsh-revision.md)、`R4b-next-runtime-dsh-scope.json` |
| [R4b-next-session-skeleton.md](tasks/R4b-next-session-skeleton.md) | 历史 | next Session 目录、固定 Kernel 映射与原历史读取 | 旧 R4b 批次；同类：（无） |
| [R4b-next-wg-dsh-prompt.md](tasks/R4b-next-wg-dsh-prompt.md) | 历史 | next WorkGraph 骨架与实现 | 旧 R4b 批次；同类：[R4b-next-wg-dsh-revision.md](tasks/R4b-next-wg-dsh-revision.md)、`R4b-next-wg-dsh-scope.json` |
| [R4c-next-claim-skeleton-prompt.md](tasks/R4c-next-claim-skeleton-prompt.md) | 历史 | 原子 Task 领取的骨架与实现 | 旧 R4c 批次；同类：[R4c-next-claim-implementation-prompt.md](tasks/R4c-next-claim-implementation-prompt.md)、`R4c-next-claim-implementation-scope.json`、[R4c-next-claim-json-repair.md](tasks/R4c-next-claim-json-repair.md)、[R4c-next-claim-review-repair.md](tasks/R4c-next-claim-review-repair.md)、`R4c-next-claim-skeleton-scope.json` |
| [R4c-next-continuity-dsh-prompt.md](tasks/R4c-next-continuity-dsh-prompt.md) | 历史 | 连续性/接续相关 next 任务书 | 旧 R4c 批次；同类：`R4c-next-continuity-dsh-scope.json` |
| [R4c2a-history-skeleton-prompt.md](tasks/R4c2a-history-skeleton-prompt.md) | 历史 | R4c.2a history 骨架与实现 | 旧 R4c2a 批次；同类：[R4c2a-history-implementation-prompt.md](tasks/R4c2a-history-implementation-prompt.md)、`R4c2a-history-implementation-scope.json`、[R4c2a-history-review-repair.md](tasks/R4c2a-history-review-repair.md)、`R4c2a-history-skeleton-scope.json` |
| [R4c2a-reads-skeleton-prompt.md](tasks/R4c2a-reads-skeleton-prompt.md) | 历史 | R4c.2a reads 骨架与实现及游标返修 | 旧 R4c2a 批次；同类：[R4c2a-reads-cursor-repair.md](tasks/R4c2a-reads-cursor-repair.md)、[R4c2a-reads-implementation-prompt.md](tasks/R4c2a-reads-implementation-prompt.md)、`R4c2a-reads-implementation-scope.json`、[R4c2a-reads-review-repair.md](tasks/R4c2a-reads-review-repair.md)、`R4c2a-reads-skeleton-scope.json` |
| [R4c2b-graph-history-skeleton-prompt.md](tasks/R4c2b-graph-history-skeleton-prompt.md) | 历史 | R4c.2b 图历史骨架/实现/修订 | 旧 R4c2b 批次；同类：[R4c2b-graph-history-implementation-prompt.md](tasks/R4c2b-graph-history-implementation-prompt.md)、`R4c2b-graph-history-implementation-scope.json`、[R4c2b-graph-history-revision-prompt.md](tasks/R4c2b-graph-history-revision-prompt.md)、`R4c2b-graph-history-skeleton-scope.json` |
| [R4c2b-index-skeleton-prompt.md](tasks/R4c2b-index-skeleton-prompt.md) | 历史 | R4c.2b 索引骨架/实现与审阅修订 | 旧 R4c2b 批次；同类：[R4c2b-index-implementation-prompt.md](tasks/R4c2b-index-implementation-prompt.md)、`R4c2b-index-implementation-scope.json`、[R4c2b-index-review-revision.md](tasks/R4c2b-index-review-revision.md)、`R4c2b-index-skeleton-scope.json` |
| [R4c2b-range-skeleton-prompt.md](tasks/R4c2b-range-skeleton-prompt.md) | 历史 | R4c.2b 范围读取骨架/实现与审阅修订 | 旧 R4c2b 批次；同类：[R4c2b-range-implementation-prompt.md](tasks/R4c2b-range-implementation-prompt.md)、`R4c2b-range-implementation-scope.json`、[R4c2b-range-review-revision.md](tasks/R4c2b-range-review-revision.md)、`R4c2b-range-skeleton-scope.json` |
| [R4c2c-source-authority-skeleton-prompt.md](tasks/R4c2c-source-authority-skeleton-prompt.md) | 历史 | R4c.2c SourceAuthority 精确事实读取与消费边界 | 旧 R4c2c 批次；同类：[R4c2c-source-authority-implementation-prompt.md](tasks/R4c2c-source-authority-implementation-prompt.md)、`R4c2c-source-authority-implementation-scope.json`、[R4c2c-source-authority-revision-prompt.md](tasks/R4c2c-source-authority-revision-prompt.md)、`R4c2c-source-authority-skeleton-scope.json` |
| [R5-workflow-advancement-skeleton.md](tasks/R5-workflow-advancement-skeleton.md) | 历史 | 已有 Plan 的 Workflow 推进（R5c.1） | 旧 R5 批次；同类：`R5-workflow-advancement-implementation-scope.json`、[R5-workflow-advancement-implementation.md](tasks/R5-workflow-advancement-implementation.md)、`R5-workflow-advancement-skeleton-scope.json` |
| [R5a-project-bootstrap-skeleton.md](tasks/R5a-project-bootstrap-skeleton.md) | 历史 | Project/Workspace 与 CompletionPolicy 正式初始化 | 旧 R5a 批次；同类：`R5a-project-bootstrap-implementation-scope.json`、[R5a-project-bootstrap-implementation.md](tasks/R5a-project-bootstrap-implementation.md)、`R5a-project-bootstrap-skeleton-scope.json` |
| [R5b-initial-plan-skeleton.md](tasks/R5b-initial-plan-skeleton.md) | 历史 | 正式回答到初始 Plan（R5b.4） | 旧 R5b 批次；同类：`R5b-initial-plan-implementation-scope.json`、[R5b-initial-plan-implementation.md](tasks/R5b-initial-plan-implementation.md)、`R5b-initial-plan-skeleton-scope.json` |
| [R5b-live-model-response-contract.md](tasks/R5b-live-model-response-contract.md) | 历史 | 真实模型初始规划输出契约补全 | 旧 R5b 批次；同类：`R5b-live-model-response-contract-scope.json` |
| [R5b-query-execution-skeleton.md](tasks/R5b-query-execution-skeleton.md) | 历史 | Query 单轮真实回答（R5b.2） | 旧 R5b 批次；同类：`R5b-query-execution-implementation-scope.json`、[R5b-query-execution-implementation.md](tasks/R5b-query-execution-implementation.md)、`R5b-query-execution-skeleton-scope.json` |
| [R5b-query-job-implementation.md](tasks/R5b-query-job-implementation.md) | 历史 | Query pending 受理（R5b.1） | 旧 R5b 批次；同类：`R5b-query-job-implementation-scope.json`、`R5b-query-job-skeleton-scope.json` |
| [R5b-query-planning-skeleton.md](tasks/R5b-query-planning-skeleton.md) | 历史 | 无 Plan 的 Query 调查、真实回答与初始规划顺序草案 | 旧 R5b 批次；同类：（无） |
| [R6-execution-entry-skeleton.md](tasks/R6-execution-entry-skeleton.md) | 历史 | 可信启动配置与 Query/Workflow 消费者 | 旧 R6 批次；同类：`R6-execution-entry-implementation-scope.json`、[R6-execution-entry-implementation.md](tasks/R6-execution-entry-implementation.md)、`R6-execution-entry-skeleton-scope.json` |
| [R6-graph-history-consumer-skeleton.md](tasks/R6-graph-history-consumer-skeleton.md) | 历史 | Task 本次执行到原 Session / 原历史消费者 | 旧 R6 批次；同类：`R6-graph-history-consumer-implementation-scope.json`、[R6-graph-history-consumer-implementation.md](tasks/R6-graph-history-consumer-implementation.md)、`R6-graph-history-consumer-skeleton-scope.json` |
| [R6-host-workbench-skeleton.md](tasks/R6-host-workbench-skeleton.md) | 历史 | 本地 Host 与薄工作台（R6.1a） | 旧 R6 批次；同类：[R6-host-workbench-implementation-repair.md](tasks/R6-host-workbench-implementation-repair.md)、`R6-host-workbench-implementation-scope.json`、[R6-host-workbench-implementation.md](tasks/R6-host-workbench-implementation.md)、[R6-host-workbench-middle-repair.md](tasks/R6-host-workbench-middle-repair.md)、`R6-host-workbench-skeleton-scope.json` |
| [R6-session-mailbox-skeleton.md](tasks/R6-session-mailbox-skeleton.md) | 历史 | 会话、消息与原历史（R6.1b） | 旧 R6 批次；同类：`R6-session-mailbox-implementation-scope.json`、[R6-session-mailbox-implementation.md](tasks/R6-session-mailbox-implementation.md)、`R6-session-mailbox-skeleton-scope.json` |
| [R6-ui-browser-repair.md](tasks/R6-ui-browser-repair.md) | 历史 | R6 真实浏览器问题的窄修，含 session UI selection repair scope | 旧 R6 批次；同类：`R6-session-ui-selection-repair-scope.json`、`R6-ui-browser-repair-scope.json` |
| [R6-ui-layout-skeleton.md](tasks/R6-ui-layout-skeleton.md) | 历史 | R6 UI 布局与已有事实 | 旧 R6 批次；同类：`R6-ui-layout-implementation-scope.json`、[R6-ui-layout-implementation.md](tasks/R6-ui-layout-implementation.md)、`R6-ui-layout-skeleton-scope.json` |
| [R6-work-control-consumer-skeleton.md](tasks/R6-work-control-consumer-skeleton.md) | 已被取代 | 本地 Work Run 的暂停/取消消费者骨架 | 已被 2026-09-28 共同编排机制与可靠性批次的控制工作取代，不再导入（tasks/README 点名）；同类：`R6-work-control-consumer-skeleton-scope.json` |
| [SESSION-rendering-2026-09-29.md](tasks/SESSION-rendering-2026-09-29.md) | 历史 | Session 正常会话渲染 | 09-29 旧批次；同类：`SESSION-rendering-scope.json` |
| [UI-directory-inventory-2026-09-29.md](tasks/UI-directory-inventory-2026-09-29.md) | 历史 | 文件目录浏览与文本快照解耦 | 09-29 旧批次；同类：`UI-directory-inventory-scope.json` |
| [UI-graph-prototype-2026-09-29.md](tasks/UI-graph-prototype-2026-09-29.md) | 历史 | 双图原型展示窄修 | 09-29 旧批次；同类：`UI-graph-prototype-scope.json` |
| [UI-progressive-session-2026-09-29.md](tasks/UI-progressive-session-2026-09-29.md) | 历史 | Session 信息层级收敛 | 09-29 旧批次；同类：`UI-progressive-session-scope.json` |
| [UI-scope-preference-2026-09-29.md](tasks/UI-scope-preference-2026-09-29.md) | 历史 | 按工作区恢复已选显示身份 | 09-29 旧批次；同类：`UI-scope-preference-scope.json` |
| [W1-future-plan-skeleton.md](tasks/W1-future-plan-skeleton.md) | 历史 | 现有 Plan 白板的未来任务修订 | 旧 W1 批次；同类：`W1-future-plan-implementation-scope.json`、[W1-future-plan-implementation.md](tasks/W1-future-plan-implementation.md)、[W1-future-plan-middle-fixes.md](tasks/W1-future-plan-middle-fixes.md)、[W1-future-plan-review-fixes.md](tasks/W1-future-plan-review-fixes.md)、`W1-future-plan-skeleton-scope.json` |
| [W2-agent-whiteboard-skeleton.md](tasks/W2-agent-whiteboard-skeleton.md) | 历史 | Agent 白板委托、Role/Skill 消费者 | 旧 W2 批次；同类：`W2-agent-whiteboard-implementation-scope.json`、[W2-agent-whiteboard-implementation.md](tasks/W2-agent-whiteboard-implementation.md)、[W2-agent-whiteboard-skeleton-dispatch.md](tasks/W2-agent-whiteboard-skeleton-dispatch.md)、`W2-agent-whiteboard-skeleton-scope.json` |
| [W2-future-intent-skeleton.md](tasks/W2-future-intent-skeleton.md) | 历史 | 未来意图节点与逐步细化 | 旧 W2 批次；同类：`W2-future-intent-implementation-scope.json`、[W2-future-intent-implementation.md](tasks/W2-future-intent-implementation.md)、`W2-future-intent-skeleton-scope.json` |
| [W2-whiteboard-tools-skeleton.md](tasks/W2-whiteboard-tools-skeleton.md) | 历史 | 白板工具与职责资源 | 旧 W2 批次；同类：[W2-whiteboard-tools-audit-repair.md](tasks/W2-whiteboard-tools-audit-repair.md)、`W2-whiteboard-tools-implementation-scope.json`、[W2-whiteboard-tools-implementation.md](tasks/W2-whiteboard-tools-implementation.md)、`W2-whiteboard-tools-skeleton-scope.json` |
| [WORK-check-resume-2026-09-29.md](tasks/WORK-check-resume-2026-09-29.md) | 历史 | 完成 Work 后跨 flow 续原检查轮 | 09-29 旧批次；同类：`WORK-check-resume-scope.json` |
| [WORK-unprepared-resume-2026-09-29.md](tasks/WORK-unprepared-resume-2026-09-29.md) | 历史 | 原 Work Run 未准入时恢复 prepare | 09-29 旧批次；同类：`WORK-unprepared-resume-scope.json` |

## 冲突清单（现行 / 参考文件 vs HANDOFF 决定 1–58）

只列标成 **现行** 或 **参考** 的文件；每项给出 `文件:行 — “短引” — 决定 N：决定说什么`。历史、已被取代、证据文件不在此列。**每项末尾标 `已改（改了哪个文件）` 或 `待 lead 定`。**

**lead 裁定后从清单移出的：**
- 原第 12、85 项：不是矛盾（K 片同 Session 新 Run $\neq$ fresh resume；测试通过不推翻“功能仍是子集”）。
- 记“当时”的事实（基线提交、实测数、迁移映射），标“历史事实，不改”：原第 13–15 项（旧存储落点/迁移映射）、原第 28–29 项（2A 规格起草时的基线）、原第 57 项（R5a/R4.2 的 102 文件/1,007 项）、原第 73–74 项（用户原话，按原字节保存）。**现行文件若要写物理隔离验收数，用 STATUS 的 279 文件 / 5,974 项（隔离验收），不要用 300 文件 / 6,190 项——后者是 K 片 A 合入后的全量测试，且那一轮没有重跑 `verify:isolated`。**
- 原第 37–60 项：所在 5 篇模块页已按 lead 裁定改标 **历史**（被源码、`module-target.json`、ARCHITECTURE 和各片冻结规格取代；文件级骨架与今天的代码不符），历史文件不改。

**已核对但对不上原提示的一处。** 任务书说 `DESIGN.md` §4.5 约 881 行有“归档后『继续』回到同一条线”。核对当前文件：§4.5:861 已写“接手的一定是别的 Session；这是一次新的领取，不是那条线的接续”（对齐决定 43），§4.5:882 是暂停中断例外、对齐决定 54。**§4.5 未发现该冲突**；真正未对齐的是 `DESIGN.md:253`（§1.5）和 `model/DIAGRAMS.md:139`，即下面第 1、2 项。

### 设计书与读法模型

1. `design/orchestration-2026-10/DESIGN.md:253` — “为接着做同一个任务而新建的 Session 都算同一条线，不论为什么新建：中断、旧的已归档、坏了，或角色不对。” — **决定 43**（HANDOFF:175）：被归档的线不再被派活，接手的一定是别的 Session，是一次新的领取，不是那条线的接续。**已改（DESIGN.md）**。
2. `design/orchestration-2026-10/model/DIAGRAMS.md:139` — `ArchivedRetired --> SameLineNewHead: 用户继续旧任务 / 另Session` — **决定 43、54**（HANDOFF:175、330–334）：归档退役线不再被派活；只有 Host 重启时暂停着、未归档的线才点“继续”在原线接着做。**按决定 43 重画这条边**：归档退役线指向新的“另一个 Session 新领取（另一条线）”状态（`AnotherLineNewClaim`），标签“（决定 43）”；**不再保留通向 `SameLineNewHead` 的边**（同图的 `Retired --> SameLineNewHead` 只留给 R03 的 continuation）。**撤回对同图 :175 的指控**：区分“健康恢复”与“已归档退役线重新启用”本身与决定 38 一致。**已改（DIAGRAMS.md）**。
3. `design/orchestration-2026-10/model/AMBIGUITIES.md:1095` — “内存取本机一半和 4 GB 中较小的” — **决定 55**（HANDOFF:336）：默认内存上限改为本机内存的一半和 **6 GiB** 中较小的。该行自己写了“决定 55 把 4 GB 改为 6 GB”，仍留 4 GB。**已改（AMBIGUITIES.md）**。
4. `design/orchestration-2026-10/README.md:5` — “当前状态（2026-10-13）……接线包 2（I-2、I-4、I-5、I-6）在准备” — **决定 58**（HANDOFF:358）点名要改掉这处过期状态；STATUS 2026-10-14：接线包 2、K 片 A/B 已合入，2A 已冻结施工。**已改（design/orchestration-2026-10/README.md）**。
5. `design/orchestration-2026-10/E3-UI-ITEMS.md:11` — “I-2、I-4、I-5、I-6 是准备中的接线包 2；第 2、4、6、7、K 等片仍待施工” — **决定 58**；STATUS：接线包 2、K 片已合入，2A 施工中。**已改（E3-UI-ITEMS.md）**。

### docs/refactor/ 根

（原第 12 项不是矛盾；原第 13–15 项是当时的迁移映射，属“历史事实，不改”，均已移出。）

6. `docs/refactor/README.md:3` — “接线包 2 在准备” — **决定 58**；STATUS：已合入 `bb924854`，K 片 A/B 也已合入。**已改（docs/refactor/README.md）**。
7. `STATE-MACHINES-SPEC.md:27` — “约束（本批不改）：冻结的 Kernel 不在未结束的 Turn 之后开新 Turn” — **决定 51**：K 片补了关闭接口；**“不在未结束的 Turn 之后开新 Turn”这条禁令保留**——K 是先关掉旧 Turn（`closeOpenTurn`），再回到可用、在原 Session 开新 Turn，不是绕过禁令。**已改（STATE-MACHINES-SPEC.md）**。
8. `STATE-MACHINES-SPEC.md:45` — “接续在新 Session 中运行” — **决定 51、54**：K 片后关闭成功就留在原 Session；只有 Kernel 读不到、适配器不同或关闭失败才退新 Session。**已改（STATE-MACHINES-SPEC.md）**。
9. `ORCHESTRATION-STATE-MACHINES.md:228` — “给 Kernel 打补丁关闭悬空 Turn、从而留在原 Session，是以后的选项” — **决定 51、54**：已按此施工并合入（`cfe35550`）。**已改（ORCHESTRATION-STATE-MACHINES.md）**。
10. `ARCHITECTURE.md:10` — “正式 Runtime/Workflow 入口仍明确拒绝未实现操作，UI 未迁入” — **决定 1、43**：任务 E 前端拆分/SSE 与编排第 0、1、3、5 片和接线包 1/2、K 片 A/B 已合入。**已改（ARCHITECTURE.md）**。
11. `DSH-WORKFLOW.md:121` — “正式 Workflow/Runtime 入口仍 unsupported，UI 未迁” — **决定 1、43**：同上。**已改（DSH-WORKFLOW.md）**。
16. `CODE-QUALITY-GUIDELINES.md:18` — “实际进展与证据集中到[实施方案](IMPLEMENTATION-PLAN.md)” — **决定 58**：IMPLEMENTATION-PLAN 已标历史，进展与证据以 STATUS 为准。**已改（CODE-QUALITY-GUIDELINES.md）**。
17. `CODE-QUALITY-GUIDELINES.md:23` — 同一处把迁移与验证交给 IMPLEMENTATION-PLAN — **决定 58**：同上。**已改（CODE-QUALITY-GUIDELINES.md）**。
18. `STATUS.md:7` — 写远端只推到 `bb924854`、“决定 55、56 和 K 片 A 等更后的提交等下次推送” — **决定 44、55–57**；同页 `STATUS.md:203` 与根 `AGENTS.md` 记已推到 `cbe2be2d`（含 K 片 A 和决定 55–57）。按根 `AGENTS.md`（当前入口）与同页后文为准，改成已推到 `cbe2be2d`。**已改（STATUS.md）**。

### 分片规格（slices/）

（原第 28–29 项是 2A 规格起草时的基线提交事实，属“历史事实，不改”，已移出。）

19. `slices/slice-1-SPEC.md:14` — “你用已有的‘认定’确认以后，下一次维护马上把它归档（写锚点、放下任务）” — **决定 51**：经人认定、Kernel Turn 还开着的线改为关闭悬空 Turn、留在原 Session，不归档、不写异常锚点、不放下任务。**已改（slice-1-SPEC.md 标题后补注）**。
20. `slices/slice-1-SPEC.md:88` — “已停止、结果未知的 Work 经明确人工认定后也走此路”（写不可变异常锚点） — **决定 51**：Turn 还开着时认定后是关闭而非写锚点。**已改（slice-1-SPEC.md 标题后补注）**。
21. `slices/slice-1-SPEC.md:89` — “退役、无接续的线在下次 Workflow 步立即归档” — **决定 54**：Host 重启时人暂停着的同类线不归档，显示“已暂停 · 主机重启时已暂停，可继续”。**已改（slice-1-SPEC.md 标题后补注）**。
22. `slices/wiring-1-SPEC.md:21` — “I-4 的自治级别就是第一项……必须同时把它加进这个函数并把 `contentVersion` 升到 2” — **决定 49、56**；`wiring-2-SPEC.md` §0.3 已撤回：I-4 不改 Goal 内容摘要 G。**已改（wiring-1-SPEC.md 标题后补注）**。
23. `slices/README.md:164` — “I-4 接自治级别时，要按接线包规格 L3 把它加进 Goal 内容摘要（`contentVersion` 升到 2）” — **决定 49、56**：同上。**已改（slices/README.md）**。
24. `slices/README.md:191` — “I-4 接自治级别时按接线包规格 L3 把它加进 Goal 内容摘要（`contentVersion` 升到 2）” — **决定 49、56**：同上。**已改（slices/README.md）**。
25. `slices/wiring-2-SPEC.md:18` — “L10/L11 已由 lead 定，整份规格待冻结” — **决定 49 第 29 项、决定 50**：接线包 2 已冻结并合入 `bb924854`。**已改（wiring-2-SPEC.md 标题后补注）**。
26. `slices/wiring-2-SPEC.md:44` — “整份清单和夹具仍待冻结” — **决定 49 第 29 项、决定 50**：同上。**已改（wiring-2-SPEC.md 标题后补注）**。
27. `slices/wiring-2-SPEC.md:444` — “B按lead已定L10/L11，整份待冻结” — **决定 49 第 29 项、决定 50**：同上。**已改（wiring-2-SPEC.md 标题后补注）**。
28–29. 移出（2A 规格起草时的基线提交事实，历史事实，不改）。
30. `slices/slice-K-SPEC.md:4` — “接线包 2 在施工” — **决定 49 第 29 项、决定 50**：已合入，不再是施工中。**已改（slice-K-SPEC.md 标题后补注）**。
31. `slices/slice-K-SPEC.md:284` — “接线包 2（施工中）也改 …” — **决定 49 第 29 项、决定 50**：同上。**已改（slice-K-SPEC.md 标题后补注）**。
32. `slices/slice-5-SPEC.md:772` — “单次窗口≤25页/5000项……超界回 `capacity`” — **决定 49 第 28 项**：后端缩窄索引并完整分页；2A 撤掉“到上限就整个拒绝”（`slice-2A-SPEC` §0.2/§0.4）。**已改（slice-5-SPEC.md 标题后补注）**。
33. `slices/slice-5-round2-TESTS.md:19` — “任一来源的窗口超过 25 页 / 5000 项回 `capacity`” — **决定 49 第 28 项**：该超界期望由 2A 翻转。**已改（slice-5-round2-TESTS.md 标题后补注）**。
34. `slices/slice-K3-SPEC.md:3` — “下一步：交 Codex 审查，冻结” — **决定 56**：K3 第五稿审一次就停，等资源上限片做完再收尾，现在不冻结；本文件是旧稿，冻结前在 lead 笔记里。**已改（slice-K3-SPEC.md 标题后补注）**。
35. `slices/slice-K3-SPEC.md:222` — “默认内存上限取本机内存的一半和 4 GB 中较小的，进程数 512” — **决定 55**：内存改为本机一半和 6 GiB 中较小的（进程数 512 不变）。**已改（slice-K3-SPEC.md 标题后补注）**。
36. `slices/slice-K3-SPEC.md:227` — “默认值要用户定。例如内存上限取‘本机内存的一半和 4 GB 中较小的’” — **决定 53、55**：用户已定（6 GiB、512）。**已改（slice-K3-SPEC.md 标题后补注）**。

### modules/ 旧模块页（原第 37–60 项，已移出）

原来列在这里的第 37–60 项都在 5 篇模块页里。按 lead 裁定，这 5 篇（`modules/business/workflow.md`、`modules/core/{agent-runtime,record-store,work-graph,workspace}.md`）改标 **历史**：被源码、[module-target.json](module-target.json)、[ARCHITECTURE.md](ARCHITECTURE.md) 和各片冻结规格取代，文件级骨架与今天的代码不符。历史文件不改，所以这 24 项不再是现行文档的冲突；它们指出的旧模块名、旧路径、旧计数随“改标历史”一并处理。

> **不算冲突的旧模块名。** `modules/README.md:25–37`（表头“旧模块去向”）、`modules/ownership-map.md:24–36`（表头“旧模块逐项移交”）、`module-dag.md:58–62、77–114`（迁移映射）都在“旧→新”导航口径下，符合 docs/AGENTS 的允许用法。13 篇旧模块导航页第 3 行已标历史。

### docs/ 根现行文件

61. `docs/AGENTS.md:7` — “Codex 起草后交 lead 核对” — **决定 56**：规格第一稿由 lead 起草，改稿和起草文档交便宜模型（DSH）的子任务，Codex 负责审查并写测试夹具，lead 逐行审。**已改（docs/AGENTS.md）**。
62. `docs/PRODUCT.md:195` — “足迹、注记、自治级别、待决事项四段今天还是空的” — **决定 49、56**：I-4（自治级别）和 I-6（待决事项）属接线包 2，已合入 `bb924854`。**已改（PRODUCT.md）**。
63. `docs/UI-WORKBENCH.md:66` — “主对话就是‘秘书（主对话）’” — **决定 37**：主对话是一个交互面，不是一个 Session；同节 :113 已按决定 37 更正，原句按历史保留。**已改（UI-WORKBENCH.md 加指向 §0 的句子）**。
64. `docs/UI-WORKBENCH.md:70` — “每个目标一条对话线” — **决定 37**：目标栏仍按目标切换主对话显示的内容；同节 :113 已更正。**已改（UI-WORKBENCH.md 加指向 §0 的句子）**。
65. `docs/UI-WORKBENCH.md:108` — “已归档或已结束的工作线只读” — **决定 38**：左栏拆成“已做完/已退役”，已做完的线可以直接干预；同节 :119、:124 已更正。**已改（UI-WORKBENCH.md 加指向 §0 的句子）**。
66. `docs/ui-reference/workbench-2026-10/*.dc.html`（Chain:1191、Main:6708/6372 等） — 单行“秘书（主对话）”、“工作已结束……只能问一问（只读）”、“任务已满足，工作已结束” — **决定 37、38**：秘书可以多个 Session，已做完的线可直接干预。画板按**决定 35** 冻结不改，`UI-WORKBENCH §0` 已声明这些点以 §0 为准。**不改（lead 2026-10-14）**：冻结原型按决定 35 原样保留；冻结原型目录的 README 和 UI-WORKBENCH §0 已写明这些点以 §0 和后来的决定为准。
67. `docs/ui-reference/workbench-2026-10/DESIGN.md:1072` — “秘书（主对话）……one line each” — **决定 37**：同上（画板设计说明，按冻结原样保留）。**不改（lead 2026-10-14）**：冻结原型按决定 35 原样保留；冻结原型目录的 README 和 UI-WORKBENCH §0 已写明这些点以 §0 和后来的决定为准。
68. `docs/ui-reference/workbench-2026-10/DESIGN.md:1540、1655` — “直接干预 off”“已做完 lines: read-only …?” — **决定 38**：已做完的线可以直接干预（内容作为新的小任务，不重开已验收任务）。**不改（lead 2026-10-14）**：冻结原型按决定 35 原样保留；冻结原型目录的 README 和 UI-WORKBENCH §0 已写明这些点以 §0 和后来的决定为准。
69. `docs/ui-reference/workbench-2026-10/data/WORKLINES.md:15`、`data/README.md:539`、`data/lineview.snippet.js:179/215/476` — 长期角色一条线、已做完只读、工作已结束不再送达 — **决定 37、38**：同上，`UI-WORKBENCH §0` 覆盖。**不改（lead 2026-10-14）**：冻结原型按决定 35 原样保留；冻结原型目录的 README 和 UI-WORKBENCH §0 已写明这些点以 §0 和后来的决定为准。

### intent/ 参考文件

（原第 73–74 项是用户原话，按原字节保留，属“历史事实，不改”，已移出。）

70. `intent/INTENT-AND-DECISIONS.md:142` — “材料 grant/revoke、占用释放/接管等是现有可达行为” — **决定 6、34**：材料授权的写入部分和只为授权存在的读取分支已删除。**已改（intent/INTENT-AND-DECISIONS.md）**。
71. `intent/INTENT-AND-DECISIONS.md:116` — “记忆与知识库不是本批要完成的能力” — **决定 23**：节点注记、目标和阶段上的“当前理解”、大小上限、按代码版本失效作为记忆核心进 MVP。**已改（intent/INTENT-AND-DECISIONS.md）**。
72. `intent/INTENT-AND-DECISIONS.md:118` — “有限 Memory 也不作为本批完成门禁” — **决定 23**：记忆核心是 MVP 项。**已改（intent/INTENT-AND-DECISIONS.md）**。

### skeleton/ 参考文件

75. `skeleton/README.md:3` — “本层是实现前的详细设计，不是源代码已迁移声明” — **决定 40**：任务 D 已完成，五模块与 13 子模块已落地。**已改（skeleton/README.md 标题后补注）**。
76. `skeleton/README.md:42` — “旧模块目录……按批次迁移，最后消费者迁走时删除” — **决定 31、40**：旧模块目录已随简化和任务 D 迁完/删除。**已改（skeleton/README.md）**。
77. `skeleton/README.md:86` — “R2a后当前实际源码为WorkspaceTools与11个旧模块” — **决定 40**：13 子模块已是 `module-target.json` 的正式声明，旧模块计数过期。**已改（skeleton/README.md）**。
78. `skeleton/CONTRACTS.md:3` — “下文尚含该旧方案的 scope/reservationRef 必填代码块……不得直接冻结施工” — **决定 11、17**：依赖不是领取条件、不预占资源。**已改（skeleton/CONTRACTS.md 标题后补注）**。
79. `skeleton/CONTRACTS.md:93` — “`currentBasis?: MaterialBasisV1`” — **决定 34**：材料授权写入和只为授权存在的读取已删除，代码里的 MaterialReader 已无此字段。**已改（skeleton/CONTRACTS.md）**。
80. `skeleton/CONTRACTS.md:139` — `ReadBasis` — **决定 34**：该类型从没被用过，已删除。**已改（skeleton/CONTRACTS.md）**。
81. `skeleton/CONTRACTS.md:226` — “并行执行的资源 reservation 与此 Session 对话占用不同” — **决定 11、17**：预占资源的要求已取消。**已改（skeleton/CONTRACTS.md）**。
82. `skeleton/CONTRACTS.md:235` — `RoleMemoryPort` — **决定 49 Q8/Q9**：记忆 = 锚点 + 注记、关系写在注记上、注记只加一个全文索引；该端口在当前代码中已不存在。**已改（skeleton/CONTRACTS.md）**。
83. `skeleton/END-TO-END.md:11` — “候选仍只在独立 lane，未导入、未进入 Stage2……保持 STOP” — **决定 43、47、48、58**：编排各片与接线持续施工，STOP 段已过期。**已改（skeleton/END-TO-END.md 标题后补注）**。
84. `skeleton/END-TO-END.md:122` — “中心为传统 Session……不用常驻卡片” — **决定 33、37、38**：点工作线切到其对话、主对话是交互面。**已改（skeleton/END-TO-END.md）**。

### 按 lead 裁定新增的冲突（M3、M4、M5，以及同类进一步排查）

86. `design/orchestration-2026-10/DESIGN.md:760` — “凡是为接着做某个任务新建 Session，而这个任务以前由别的 Session 做过，都写‘接续’，并写明原因：中断、旧的已归档、坏了、角色不对。” — **决定 43**（HANDOFF:175）：被归档的线不再被派活，接手的是别的 Session 的一次新领取，不是那条线的接续；`旧的已归档` 不再作为接续原因。**已改（DESIGN.md）**。
87. `design/orchestration-2026-10/model/MODEL.md:860` — `reason:'interrupted'|'archived'|'damaged'|'role_mismatch'` — **决定 43**：同上，去掉 `'archived'`；`MODEL.md:102` 的 `Provenance.reason` 同改。**已改（MODEL.md）**。
88. `slices/slice-1-SPEC.md:163` — `reason: 'interrupted' | 'archived' | 'damaged' | 'role_mismatch'` — **决定 43**：同上。**已改（slice-1-SPEC.md 标题后补注）**。
89. `design/orchestration-2026-10/model/DIAGRAMS.md:551` — 正式认定后经写锚点、放任务、archive 直接归档 — **决定 51、54**：Turn 还开着时认定后是关闭悬空 Turn、回到可用，不写锚点、不放下、不归档；只有读不到/关不掉/失败才归档，且 Host 重启时暂停着的线不归档。**已改（DIAGRAMS.md）**。
90. `docs/MVP-BEHAVIOR.md:239` — “退役、没有接续且执行结果未知时，自动维护先保留待核对，用户认定后才归档” — **决定 51**：Turn 还开着时认定后是关闭、留在原 Session，不归档。**已改（MVP-BEHAVIOR.md）**。
91. `docs/PRODUCT.md:153` — “归档除了你手动做，平台也按规则自动做，例如执行者线做完满一天、退役的线、空闲满一天的秘书线” — **决定 51、54**：退役线里“Turn 还开着、经人认定”和“Host 重启时暂停着”的两种不归档。**已改（PRODUCT.md）**。
92. `docs/PRODUCT.md:413` — “已做完的执行者线还能接新任务，已退役的线只能查历史或「问一问」” — **决定 51、54**：退役线不都马上归档；暂停中断的线可继续、认定后关 Turn 回到可用。**已改（PRODUCT.md）**。
93. `docs/UI-WORKBENCH.md:121` — “平台马上归档它”（已退役） — **决定 51、54**：同上两种例外不归档。**已改（UI-WORKBENCH.md）**。
94. `design/orchestration-2026-10/model/MODEL.md:867` — “K 补丁不复活之前已退役 Session，执行结果未知仍先按正式规则核对” — **决定 38、51、54**：补一句例外——成功关闭悬空 Turn 时线回可用、留在原 Session；Host 重启暂停线点“继续”后关 Turn 在原线领取；只有读不到/关不掉/失败才退新 Session 或归档。**已改（MODEL.md）**。
95. `design/orchestration-2026-10/E3-UI-ITEMS.md:144`（5.6-8） — “平台马上归档它”“不给重新启用” — **决定 51、54**：认定后关 Turn 的线不归档、可回可用；暂停中断线显示“已暂停 · 可继续”。**已改（E3-UI-ITEMS.md）**。
96. `design/orchestration-2026-10/E3-UI-ITEMS.md:286`（D45-1） — “用户认定后，下一次维护才写异常锚点、放下任务并归档” — **决定 51**：Turn 还开着时改为关闭、回可用，不写锚点、不放下、不归档。**已改（E3-UI-ITEMS.md）**。
97. `STATE-MACHINES-SPEC.md:5287`（S1-AUTO-02） — “退役线……没有接续则放下未完 Task、写锚点、马上归档；执行结果未知且没人认定时跳过（决定 45）” — **决定 51、54**：认定后 Turn 还开着的线关 Turn 回可用；Host 重启暂停线不归档。**已改（STATE-MACHINES-SPEC.md）**。
98. `STATE-MACHINES-SPEC.md:2611`（SES-14） — “lifecycle=archived（不核对 Kernel 能力，见缺口 SG-2）” — **决定 38**、第 1 片 S1-SES-05：重新启用必须拒绝退役（`unavailable`）的 Session，不能只改 lifecycle。**已改（STATE-MACHINES-SPEC.md）**。
99. `STATE-MACHINES-SPEC.md:2721`（SG-2） — “重新启用不核对真实恢复能力（S7）……不修，列为已知缺口” — **决定 38**：第 1 片已按 SES-14 加守卫、拒绝退役 Session；这一行改为“已按决定 38 修”。**已改（STATE-MACHINES-SPEC.md）**。
100. `STATE-MACHINES-SPEC.md:5147`（GAP-50 正文） — “打开的 Kernel Turn 之后不能在同一 Session 接续……接续在新 Session 中运行” — **决定 51、54**：K 片补了关闭接口，认定后/暂停重启后的线先关旧 Turn 再在原 Session 接续；禁令（不在未结束的 Turn 后开新 Turn）保留，只有读不到/关不掉/失败才退新 Session。正文多处（§0.2、§0.3、§4、§7.7、§12、§16 GAP-05/GAP-50 等）同改。**已改（STATE-MACHINES-SPEC.md）**。

**共 67 项（原 85 项，移出 33 项、新增 15 项）。** 其中第 66–69 项 lead 定为**不改**（冻结原型按决定 35 不改，`UI-WORKBENCH §0` 已声明这些点以 §0 为准，是否逐个补注交 lead）；其余列出的各项均 **已改**（改的文件见每项末尾）。
