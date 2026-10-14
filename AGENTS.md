# 独立仓库工作入口

**当前状态（2026-10-13）。** 可靠性批次已完成；编排第 0、1、3、5 片和接线包 1 已合入，接线包 2 正在准备。到 `6c63f069` 为止已由 Codex 推到远端新分支 `feat/orchestration-slices`，远端 `next-main` 不动，本地主检出目录已快进。最后一次全量 279 个测试文件、5,974 项通过，`verify:isolated` 通过；这些批次之后还没有用真实模型重跑，整个 MVP 没有完成。当前状态和下一步见 [STATUS](docs/refactor/STATUS.md)，决定 1–56 见 [HANDOFF 顶部](docs/refactor/HANDOFF.md)，设计与分片见 [design/orchestration-2026-10](docs/refactor/design/orchestration-2026-10/README.md)。

*界面基线。* 新原型在 [Design 画布](https://claude.ai/artifact/3e5ynF3rwtMQfvJuim9mL2)上，只有用户本人能打开。
- 用户 2026-10-05 批准了原型（画布第 9 版）。2026-10-06 按 HANDOFF 决定 25–30 改版，发布为画布第 14 版；2026-10-07 按决定 33 改了左栏工作线的点击，发布为画布第 16 版。用户确认后冻结（决定 35），画板文件和设计说明复制进 [docs/ui-reference/workbench-2026-10](docs/ui-reference/workbench-2026-10/README.md)。
- 界面以这些画板和 [UI-WORKBENCH §0](docs/UI-WORKBENCH.md#ui-decisions-2026-10) 为准。`docs/ui-reference/agent-workbench.html` 只管决定没有替换的部分。

已被替换或新增的点，分组与 UI-WORKBENCH §0 一致。

替换旧原型的条目：
- 悬停：短预览改为信息卡，只读已加载的数据；
- 双图：画成小方格加连线，方格里不放符号，状态用颜色和填充表示，还没开始的任务一律空心；
- 任务图：整页是 DAG + 大纲 + 轨道，主画面右栏是最多 3 层的方格树缩略；
- 架构图：分成聚焦视图和完整架构图页，按探索出的语义分组；
- 时间视图：纵向连续放大镜改为「轨道 + 活动日历」，一条轨道是一条工作线（一个 Session 加上接续它的 Session）。

旧原型没有、新增的条目（举例，完整列表见 §0“新增”）：
- 主对话：给 2–3 个方案，在对话中迭代后采用；
- 目标：每个目标一条线，有顺序和冲突提示，冲突只做建议；
- 成员：成员卡片，「问一问（只读派生）」和「直接干预」分开；
- 「需要你决定」队列。

*不要改回旧原型。* 后来的 agent 不得因为旧原型还是基线，就在这些被替换或新增的点上把界面“纠正”回旧原型。没被替换的点照旧保留，例如：多页签辅助区（文件、命令、Diff）、可拖动的分隔、把文件或选区引用进草稿、未来节点留在图上、原历史按需可读。

**冻结之后的决定。** 上面的界面基线文字保留原样；其中“每个目标一条线”已由决定 37 改为“主对话是交互面”，目标栏切换显示内容，秘书可以有多个 Session。冻结后的修改按 [UI-WORKBENCH §0](docs/UI-WORKBENCH.md#ui-decisions-2026-10)和 [HANDOFF 顶部](docs/refactor/HANDOFF.md)的决定 37–49 读取，E3 待办见 [E3-UI-ITEMS](docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md)。

## 通用仓库约束

1. 必要上下文：先读 [README](README.md) → [STATUS](docs/refactor/STATUS.md)（当前状态）→ [HANDOFF 顶部](docs/refactor/HANDOFF.md)（决定 1–56）→ [编排设计目录](docs/refactor/design/orchestration-2026-10/README.md)。施工时读相关分片规格、[MVP 行为](docs/MVP-BEHAVIOR.md)和[能力索引](docs/refactor/IMPLEMENTED-CAPABILITIES.md)，沿代码与证据核对；界面工作读[冻结原型](docs/ui-reference/workbench-2026-10/README.md)和 [UI-WORKBENCH §0](docs/UI-WORKBENCH.md#ui-decisions-2026-10)。
2. 原 W/coding-platform/next 相当于本根；原 W/docs 相当于本根/docs。历史 C/src、C/tests 不是本仓库 src/tests；不得把本仓库源码当旧目录删除。历史绝对路径、scope、harness 命令都要先重新映射。当前文件优先于被复制文档里的旧目录说明。
3. 2026-09-27 的有界 MVP completion audit 已完成，不因接手而重跑。按 STATUS 的下一步和已确认的分片范围推进；不新增需求、不补非阻塞测试、不做顺手重构，也不得自动把既定必需项移出 MVP。不把原语、受控模型 E2E 或某一子链等同完整产品验收。规格、规则和整套文档由 lead 负责并逐行审阅（决定 36、43、46；2026-10-13 做法）；用户做产品决定，并挑交互和行为验看。
4. 五模块职责与已确认产品边界继续有效。Task Graph 保留无验收条件的未来意图；Run结束不等于Task/Goal完成；事实与当前动作授权分开；没有运行中 Role 热切换生命周期，不恢复篡改数据库才能触发的防御校验/测试。原历史默认折叠并能按需查看实际保存记录。
5. 新生产代码按决定 36、43、44、46、56 和 2026-10-13 的做法：lead 定规格、接口和要判断的规则，冻结、审查、验收，和用户交互，维护协作和开发规范；规格第一稿由 lead 起草，之后照决定改稿交给便宜模型的子任务，lead 逐行审（决定 56）。Codex 写测试夹具，lead 核对后冻结；Codex 只读审查规格、测试、文档和实现，提意见（含代码怎么改），并做验收后的推送。DSH 写测试用例和实现，施工前读任务书和规格、报看不懂的地方（决定 56）。每份规格最多两轮完整审查加一次快速核对；实现追上之前不开新规格（决定 56）。先和用户确认测试入口，再用 Matt Pocock 的 TDD skill（`mattpocock/skills` 的 `engineering/tdd`）逐条先写失败测试、再写刚好通过的实现；通过公开接口测业务行为，不读数据库核对，期望值来自规格或手算例子。DSH 按上下文分组，允许子任务；第二段和返工用新 Session，说明书带关键信息及“子任务没回报完之前不要结束回合”，只在 18:00 以后跑。每片记录 DSH 和 lead 用量，合入前在有 bwrap 的环境跑全量；具体操作见 [DSH-WORKFLOW §6.10](docs/refactor/DSH-WORKFLOW.md#610-大片怎么交给-dsh决定-46)和[分片入口](docs/refactor/design/orchestration-2026-10/slices/README.md)，旧骨架/测试批量冻结流程只说明当时批次。验收后由 Codex 推成远端新分支，不强推、不动远端 `next-main`，随后快进本地主目录，除非用户另说。历史 runner 和 scope 先适配当前根；凭据和 DSH 状态不入库。
6. 独立构建和检查用根 package.json；两个npm锁文件一起维护。vendor/coding-agent/dist 是冻结运行依赖，必须保留；补丁更新沿 scripts/build-kernel-patch.mjs 与既有证据，不手改生成物。不要引回父目录源码或依赖回退。
7. 测试只运行改动所需范围；通过后不要反复扩大局部测试，合入前的全量按第 5 条。每批验收后由 lead 更新 STATUS、相关能力和证据；整套文档由 lead 长期负责审核，Codex 的文字是待审草稿。保留历史报告原义，不另建重复事实体系。
8. 提交只涵盖本次任务相关文件；保留用户改动。推送按第 5 条和决定 44；没有授权不要发布、删除旧工程或访问候选测试工作区写入。
9. 2026-10-02 起，状态迁移必须经过 `src/core/work-graph/state/`（状态写入限制检查强制）。

## 历史

2026-09-27 至 09-29 的授权、验收、临时进程和提交状态见 [HANDOFF 历史记录](docs/refactor/HANDOFF.md)；旧停止记录、恢复提示和当时的边界不作为当前施工指令。
