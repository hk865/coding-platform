# @coding-platform/ 重构分阶段 Prompt 合集（可直接使用版）

```yaml
version: v2（可直接使用版）
date: 2026-09-19
supersedes: v1（含大量 <占位符>，不可直接使用）
status: 可用；但受 dev_docs/decision/README.md §0 的「未定稿」门禁约束——门禁解除前不要批量派发
intent_sources: 见 §3「意图文档集」（7 份 + 2 份外部参考）
workspace_root: /home/hyh001/projects/coding-platform
```

> **本版做了什么**：① 消除全部占位符，填入仓库里核实过的真实路径与命令；② 按今天讨论中的**重构意图**重写每条 prompt 的背景与要求；③ 把通用评审 prompt 实例化成 4 条可直接发送的具体 prompt。
>
> **唯一保留的运行时填空**：Prompt 8 的「本轮模块」一行（逐模块执行时每条必然不同，见该条说明）。

---

## §1 本版相对上一版的映射（占位符 → 真实值）

| 上一版的占位符 | 本版填入的真实值 | 依据 |
| --- | --- | --- |
| `<PROJECT_ROOT>` | `coding-platform/` | 工作区根下唯一的代码目录 |
| `<DOCS_ROOT>` | `my-coding-platform-docs/agent_platform/` | 文档根 `D/`，见 `dev_docs/decision/05-reference-resolution.md` R-09 |
| `<AGENT_DOC_PATH>` | `coding-platform/AGENTS.md`（另见 `my-coding-platform-docs/agent_platform/AGENTS.md`） | 前者是仓库级 agent 入口（372 行，含两仓库路径翻译规则） |
| `<PRODUCT_DOC_PATH>` | `my-coding-platform-docs/agent_platform/PRODUCT.md` | 同上权威顺序 |
| `<ARCH_DOC_PATH>` | `my-coding-platform-docs/agent_platform/ARCHITECTURE.md` | 同上 |
| `<MODULE_DOC_DIR>` | `my-coding-platform-docs/agent_platform/dev_docs/modules/` | 12 篇模块文档所在 |
| `<MODULE_INDEX_PATH>` | `my-coding-platform-docs/agent_platform/dev_docs/modules/README.md` | 新建（当前不存在） |
| `<ARCHIVE_DIR>` | `my-coding-platform-docs/agent_platform/dev_docs/archive/` | 既有归档目录 |
| `<MODULE_DAG_PATH>` | `my-coding-platform-docs/agent_platform/dev_docs/refactor/module-dag.md` | 新建 |
| `<SOURCE_ANALYSIS_PATH>` | `my-coding-platform-docs/agent_platform/dev_docs/refactor/source-analysis.md` | 新建 |
| `<REFACTOR_PLAN_PATH>` | `my-coding-platform-docs/agent_platform/dev_docs/refactor/refactor-plan.md` | 新建 |
| `<PRODUCT_DOC_DIFF_PATH>` | `my-coding-platform-docs/agent_platform/dev_docs/refactor/product-doc-diff.md` | 新建 |
| `<UI_VISUAL_SPEC_PATH>` | `my-coding-platform-docs/agent_platform/dev_docs/refactor/ui-visual-spec.md` | 新建 |
| `<FRONTEND_DIR>` | `coding-platform/src/ui/` | React 工作台，服务默认入口；`/legacy` 旧界面在 `coding-platform/src/app/public/` |
| `<PACKAGE_MANAGER>` | `pnpm` | 仓库根 `pnpm-lock.yaml` |
| `<BUILD_COMMAND>` | `pnpm build` | `coding-platform/package.json` scripts |
| `<TEST_COMMAND>` | `pnpm test` | 同上 |
| `<LINT_FORMAT_COMMAND>` | **未配置**（仓库根无 lint/format 脚本） | 同上 |
| `<DEV_RUN_COMMAND>` | `pnpm gui`（= `pnpm build && pnpm start`，服务 `http://localhost:4317`） | 同上 |
| `<NEW_DOC_1/2/3_PATH>` | 由 §3「意图文档集」的 7 份文件取代 | 见 §3 |
| `<PUBLIC_API_TO_KEEP>` | 见 §2.4「保留与演进清单」（已写实） | 代码核实 |
| `<REVIEW_TARGET>` / `<REVIEW_SCOPE>` | 已实例化为 Prompt 10-A/10-B/10-C/10-D | 见 §4 |
| `<MODULE_NAME>` | 保留为 Prompt 8 的运行时填空（唯一一处） | 逐模块执行必然不同 |

**产物落点**：本版把重构过程中产生的新文档统一放在 `my-coding-platform-docs/agent_platform/dev_docs/refactor/`（新建目录），与既有的 `decision/`、`design/` 平级，避免与它们混放。

---

## §2 重构意图摘要（每条 prompt 共用的背景）

### §2.1 一句话目标

把当前"每次 Run 重新装配上下文、Agent 一次性用完即弃"的实现，改成**有生命周期管理的多 Agent 编排**：主 Agent 面向人、子 Agent 面向执行，靠**架构图 + 任务图**做编排与检索，靠**角色复用**提高缓存命中、降低成本。

### §2.2 五条意图（来自今天的讨论）

1. **生命周期管理必须在本产品内自建**（B1 方向）。要回答：一个角色**如何产生、何时被拆解、何时压缩、何时归档**。角色**一定要复用**——复用后上下文会增长、项目会变多，因此必须有生命周期。
2. **两张图是能力，不只是显示**。架构图由 agent 探索已有项目后生成；任务图在人确定目标后生成；目标可变，图随之变。图应**可检索、版本化**，是 session 集合的投影，同时**反过来决定 agent 怎么编排**。记忆搜索从图入手：查某模块 → 推断候选模块 → 问负责该模块的 agent → 返回相关上下文与事实校验，**不做全量探索**。
3. **A（agent-team）只作参考，复用其中一部分**：通信模型按 **Roster / mailbox** 那套（支持异步并行）、以及**编辑机制**。范围限定这两处；A 作为外部项目的约束不进入本产品。A 的不足：主 Agent 超长上下文支持不好、子 agent 无法与 task graph／本项目架构图做可视化、本质只是任务安排。
4. **能力要参数化，不要写死**；用 **skill** 约束能力，允许出现超出编排范围的能力需求并按需扩展；但**首批必须把能力配上、配齐**，否则行为不可控。
5. **成本是硬约束**：DeepSeek 官方缓存命中与未命中约 **50 倍价差**（`deepseek-flash` 命中 0.02 元/百万 vs 未命中 1 元/百万）。它约束三件事：**缓存命中率目标、上下文装配方式、生命周期回收策略**。凡涉及"每次重新装配上下文"的做法，都要按这个价差算一遍并说明是否划算。

### §2.3 两个必须避免的毛病

- **死板**：人想了解一个关于项目的问题时，机制把用户拒绝掉，观感很差。
- **不符合持久化**：靠 context 不断组装，导致缓存命中率低 + 持久的 IO 消耗，性能差。

两者是同一个问题的两面——**没有可复用的 Agent 主体**。

### §2.4 保留与演进清单（取代 `<PUBLIC_API_TO_KEEP>`）

| 类别 | 内容 | 处理 |
| --- | --- | --- |
| **保留不变** | 命令入口 `pnpm build` / `pnpm start` / `pnpm test` / `pnpm typecheck` / `pnpm check:architecture`；本地服务监听 `127.0.0.1:4317`（`PORT` 可覆盖）与数据目录 `PLATFORM_GUI_DATA`（默认 `.local/gui`） | 不得破坏 |
| **允许演进** | 12 个 Module 的对外接口（见 `my-coding-platform-docs/agent_platform/dev_docs/decision/02-investigation-and-conclusion.md` §9 的 I1–I12）；HTTP 路由新增；契约新增字段；模块边界增删 | **预期会变，需在计划中列出迁移方式** |
| **需迁移或兼容** | 既有 SQLite 持久化数据（`src/data/state-ledger/sqlite-ledger.ts`、`src/data/read-model-index/sqlite-read-model-index.ts` 承载的 schema） | 变更需给迁移或兼容方案 |

### §2.5 待人答（不阻塞前 6 条，但阻塞涉及这两项的结论）

- **Q3**：超大上下文里**哪些现在做、哪些以后做**（`dev_docs/design/2026-09-19-agent-platform-lifecycle-orchestration-plan.md` §3.5 给了保守分档）。
- **Q4**：**哪些能力必须自建**的完整清单（同文件 §12.1；已确认只复用 A 的「编辑 + 编排通信」两处）。

---

## §3 意图文档集（每条 prompt 的必读输入）

**核心 5 份**（均在工作区，路径可直接用）：

1. `my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-requirements-dialogue.md` —— **用户原话（turn 17–20）**，意图的第一来源
2. `my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-agent-platform-lifecycle-orchestration-plan.md` —— 生命周期与编排方案 B1（498 行 / 14 节）
3. `my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-agent-lifecycle-management-investigation-R2.md` —— 生命周期现状调研 R2（750 行）
4. `my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-18-agent-lifecycle-session-reuse.md` —— 生命周期方向首版
5. `my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-18-performance-diagnosis.md` —— 性能诊断（77.48% 那组**不可复现**，见下）

**配套 2 份**：

6. `my-coding-platform-docs/agent_platform/ARCHITECTURE.md` —— 现行架构地图（12 Module、依赖 DAG、14 条全局不变量）
7. `my-coding-platform-docs/agent_platform/dev_docs/decision/README.md` + `01`–`05` —— 评估标准、控制面影响分析（§8）、接口变更清单（§9）

**外部参考 2 份**（在 `docs/`，**不在任何 git 仓库内**）：

8. `docs/agent-vs-agent-team.md` —— 模块架构可视化、模块 Agent、task graph ↔ 架构图联动
9. `docs/agent-team-dsh-research.md` —— agent-team 在 dsh 中的机制、测试程度、不得依赖的约束

> **成本口径的注意**：缓存命中率有**三组并存**数值——`89.99%`（`.toolchain/gui-user-data/real-runs`，本轮复算）、`89.10%`（`evidence/rat-03`，版本化证据）、`77.48%`（`2026-09-18-performance-diagnosis.md:13`，**本快照不可复现**）。一律**以可复现组为准**，引用 77.48% 时必须标注不可复现。

---

## §4 十条 Prompt

### 使用说明

| 序 | Prompt | 阶段 | 必须在前置之后 | 可否并行 | 这一轮你该拿到什么 |
| --- | --- | --- | --- | --- | --- |
| 1 | 产品文档更新 | 需求对齐 | 无（起点） | 可与 5 并行 | 产品文档（含生命周期/两张图/秘书回路）+ 差异清单 + 待确认问题 |
| 2 | 架构文档更新 | 架构设计 | Prompt 1 | 可与 5 并行 | 新架构文档：生命周期专章 + 两张图能力层 + 模块边界变更 + 接口演进 |
| 3 | 模块文档更新 | 模块设计 | Prompt 2 | 可与 5 并行 | 逐模块文档（五要素）+ 模块索引 |
| 4 | 模块分工与 DAG | 结构定案 | Prompt 2、3 | 可与 5 并行 | 目标模块划分 + 依赖 DAG + 断/增边表 |
| 5 | 基于源码的重构前分析 | 现状取证 | 无（建议与 2、3 并行） | 可与 1–4 任意并行 | 源码分析报告（含控制面影响面、接口变更面、成本相关重复装配点） |
| 6 | 重构计划 | 计划定案 | Prompt 4、5 | 否 | 分阶段计划 + 破坏性变更 + 回滚点 + **每步金额判据** |
| 7 | Agent 文档更新与归档 | 约定与归档 | Prompt 6 | 否 | 更新后的 AGENTS.md + 归档索引 + 引用重定向 |
| 8 | 重构执行（模板） | 实施 | Prompt 6、7 | 同层可并行 | 逐模块改动清单 + 验证结果 |
| 9 | 前端展示改版 | 实施（前端） | Prompt 6 | 可与 8 并行 | 前端改动 + 视觉规范 + 改前改后对比 |
| 10 | 跨 agent 评审（4 个实例） | 质检（叠加） | 任一产物完成 | 任意时点 | 挑错报告 |

**每一轮都通用的纪律**：中文回复；路径、命令、标识符原样；讨论类先复述再落笔，实施类先给影响面与验证方式；**禁止臆造代码里不存在的结构**；**禁止把文档当源码事实**（文档只用于对照"文档说的"与"代码实际做的"）；**禁止改动本轮范围外的文件**。

---

## Prompt 1：产品文档更新

````text
【阶段】第一阶段：产品文档更新
【一句话目的】把今天讨论确立的产品意图写进产品文档，并先与我确认产品定位再落笔。

【前置条件】
- 无需前置，这是起点。
- 需我先确认：是否保留现有产品文档的章节骨架（默认：保留，只改内容）。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 被重构项目：coding-platform/
- 文档根：my-coding-platform-docs/agent_platform/
- 本次重构的产品意图（来自今天讨论，详见下列文档）：
  1) 把"每次 Run 重新装配上下文、Agent 用完即弃"改成有生命周期管理的多 Agent 编排；
  2) 角色要能复用：一个角色如何产生、何时被拆解、何时压缩、何时归档；
  3) 主 Agent 面向人（类超长上下文），子 Agent 面向执行，靠"架构图 + 任务图"做编排与检索；
  4) 记忆搜索从图入手：查某模块 → 推断候选模块 → 问负责该模块的 agent → 返回上下文与事实校验，不做全量探索；
  5) 能力要参数化、用 skill 约束，首批能力必须配齐；
  6) 成本是硬约束：缓存命中与未命中约 50 倍价差，约束缓存命中率目标、上下文装配方式、生命周期回收策略。
- 必须避免的两个毛病：① 死板——人问项目相关问题被机制拒绝；② 不符合持久化——靠 context 反复组装导致缓存命中低、IO 消耗大。
- 必读（按顺序）：
  1. my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-requirements-dialogue.md（我的原话，意图第一来源）
  2. my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-agent-platform-lifecycle-orchestration-plan.md
  3. my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-agent-lifecycle-management-investigation-R2.md
  4. my-coding-platform-docs/agent_platform/PRODUCT.md（现行版，将被你更新）
- 占位符规则：本 prompt 不含任何占位符；若某个路径你打不开，先问我，不要猜。

【你本轮要产出的文件与章节】
1. 更新 my-coding-platform-docs/agent_platform/PRODUCT.md，必须覆盖：
   - 产品陈述（一句话：这是什么、给谁用）
   - 问题来源（要解决什么现实问题；必须包含"死板"与"不符合持久化"这两个毛病）
   - 产品承诺（分条；必须包含：人可随时询问项目状态且不被拒绝、目标可修改、秘书给出方案并可解释、Agent 可复用）
   - 核心用户路径（逐步）：人提需求/目标 → 秘书出方案 → 人在对话框或侧边栏反馈 → 秘书修订 → 执行 → 状态回到主 Agent 面；另需覆盖"从零开始"（人提需求 + 参考项目 → 产品图 → 架构图）与"找 bug"（探索生成架构图 → 任务图）
   - 产品能力（按能力分组，不写模块清单）：生命周期管理、两张图（架构图/任务图）、记忆搜索、角色复用与压缩归档、秘书回路与解释交互、能力参数化与 skill 约束
   - 边界与非目标（明确写不做什么）
   - 成功标准（可观察；必须含成本口径：缓存命中率目标与"每次重新装配"的金额判据）
2. 差异清单落到 my-coding-platform-docs/agent_platform/dev_docs/refactor/product-doc-diff.md：
   逐条写「现行版怎么写的 → 改成什么 → 依据意图文档的哪一处（文件:节）→ 是否需要我决策」。

【交互方式（必须严格按顺序，不要跳步）】
1. 先只读上述必读文档与现行 PRODUCT.md，不要动笔。
2. 向我复述你理解的：产品定位、核心用户路径、边界、非目标、以及你认为被推翻的旧表述。
3. 列出你不确定或文档之间互相冲突的地方，逐条给出候选理解。
4. 给出章节结构方案（1–2 个选项）与取舍理由。
5. 等我确认后，再落笔。

【禁止事项】
- 不得臆造讨论中不存在的产品承诺或用户路径。
- 不得把架构设计、模块划分、接口契约写进产品文档（那是 Prompt 2/3 的事）。
- 不得改动 PRODUCT.md 与 product-doc-diff.md 以外的任何文件。
- 不得跳过"复述 → 确认"直接写文件。
- 不得把 2026-09-18-performance-diagnosis.md 的 77.48% 当作当前基线（该数字在本快照不可复现；可复现组是 89.99% 与 89.10%）。

【验收标准】
- 我确认了你的复述。
- PRODUCT.md 已更新，且能回答"生命周期怎么管、两张图用来干什么、秘书回路怎么走、成本怎么约束"。
- 差异清单每条都能指到具体文档与章节，需要我决策的点单独列出。
- 你明确列出了不确定项，没有编造填空。
````

---

## Prompt 2：架构文档更新

````text
【阶段】第二阶段：架构文档更新
【一句话目的】产出新架构文档：必须显式体现生命周期管理、把两张图立为能力层、并写明模块边界与接口的演进方向。

【前置条件】
- 必须在 Prompt 1 完成、产品定位经我确认之后进行。
- 需我先确认：§2.4 的「保留不变」清单是否作为硬约束。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 被重构项目：coding-platform/；文档根：my-coding-platform-docs/agent_platform/
- 已确认的产品文档：my-coding-platform-docs/agent_platform/PRODUCT.md
- 现行架构文档（将被你更新）：my-coding-platform-docs/agent_platform/ARCHITECTURE.md
  —— 现行内容：12 Module（HumanCollaboration、PlanCompiler、ControlEngine、DispatchEngine、VerificationEngine、ArchitectureReconciler、WorkerRuntime、StateLedger、ArtifactVault、ReadModelIndex、ContextCompiler、WorkspaceReader）、ModuleDependencyDAG、三类 DAG、14 条全局不变量。
- **本轮前提（已确定，不是可选项）**：模块边界会变；接口必然随之变化；出于优化，接口与抽象会被优化。
- 必读：my-coding-platform-docs/agent_platform/dev_docs/decision/02-investigation-and-conclusion.md 的 §8（控制面影响分析 C1–C10）与 §9（接口变更清单 I1–I12、抽象优化清单 A1–A6）。
- 占位符规则：本 prompt 不含任何占位符；路径打不开先问我。

【你本轮要产出的文件与章节】
更新 my-coding-platform-docs/agent_platform/ARCHITECTURE.md，至少包含：
1. Plane／分层划分与每层责任。
2. 模块注册表（模块名、一句话职责、对外接口摘要、契约状态），含**本次新增/变更的模块**。
3. 模块依赖 DAG（Mermaid + 文字），箭头表示调用者依赖被调用者接口，须说明无环。
4. **生命周期管理专章（硬要求）**：
   - 五阶段：创建 / 初始化 / 运行 / 挂起·恢复 / 销毁
   - 四动作：角色**如何产生 / 何时被拆解 / 何时压缩 / 何时归档**
   - 每格写清：哪些模块参与、谁负责、边界在哪、状态归谁、进入与退出条件
   - 某阶段若无归属，显式写"未定义/待决策"，不要补一个看似合理的答案
5. **两张图的能力层专章（硬要求）**：
   - 架构图（agent 探索已有项目后生成）与任务图（人确定目标后生成）的生成方、存在形式、版本化方式
   - 图作为**可检索索引**：记忆搜索链路（查模块 → 候选模块 → 负责该模块的 agent → 上下文与事实校验）
   - 图**反向决定 agent 编排**的机制
   - 说明它与三类 DAG（ModuleDependencyDAG / DevelopmentTicketDAG / RuntimeExecutionDAG）的关系，并核对全局不变量 #5（三类图不互为真相源）是否需要显式声明权威
6. **模块边界变更专章**：本次新增哪些模块、ContextCompiler 边界如何收缩（只做首次启动/恢复/材料变化/压缩后重建/新 Session 接续五类触发点的有界选材，不承担选人、调度与正式状态归约）、切断与新增哪些依赖边。
7. **接口演进专章**：逐条列出会变的接口与变化方向（引用 decision/02 §9 的 I1–I12），并列出**确认不变**的接口。
8. 全局不变量（编号稳定，后续环节会引用）。
9. 与现状架构的差异说明 + 文档路由。

【交互方式（必须严格按顺序）】
1. 先读全部必读材料，不要动笔。
2. 向我复述：新的分层、模块清单、生命周期五阶段与四动作的初步归属、两张图的落点。
3. 列出不确定项与冲突项（尤其"讨论没说清、但架构必须表态"的地方）。
4. 给 1–2 个架构方案选项，说明取舍与代价。
5. 等我确认后再落笔。

【禁止事项】
- 不得只写模块罗列而缺少生命周期专章与两张图专章。
- 不得臆造代码中不存在的模块、接口或数据结构。
- 不得把"不新增 Module""不改 Module DAG"当成约束——该前提已撤销（见 decision/01 维度 7 的 L1–L6）。
- 不得改动 ARCHITECTURE.md 以外的文件；本环节不碰源码。

【验收标准】
- 生命周期五阶段 + 四动作都有明确落点（或明确标注"待决策"）。
- 两张图既写了"是什么"，也写了"怎么被检索、怎么反向决定编排"。
- 模块边界变更与接口演进两章齐全，能看出哪些接口会变、哪些不变。
- 依赖 DAG 无环且与模块注册表一致。
````

---

## Prompt 3：模块文档更新

````text
【阶段】第三阶段：模块文档更新
【一句话目的】为每个模块（含新增模块）写一份文档，写清职责、对外接口、依赖、被依赖、状态归属。

【前置条件】
- 必须在 Prompt 2 完成之后进行。
- 需我先确认：模块清单以新 ARCHITECTURE.md 的模块注册表为准。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 文档根：my-coding-platform-docs/agent_platform/
- 已确认的架构文档：my-coding-platform-docs/agent_platform/ARCHITECTURE.md（含模块注册表、生命周期专章、两张图专章、模块边界变更、接口演进）
- 模块文档目录：my-coding-platform-docs/agent_platform/dev_docs/modules/（现行 12 篇：control/ 5 篇、data/ 5 篇、execution/ 1 篇、interaction/ 1 篇）
- 接口变更清单：my-coding-platform-docs/agent_platform/dev_docs/decision/02-investigation-and-conclusion.md §9
- 代码侧模块归属：coding-platform/scripts/module-map.mjs（owner() 按路径前缀判定）
- 占位符规则：本 prompt 不含任何占位符；路径打不开先问我。

【你本轮要产出的文件与章节】
1. 每个模块一份文档，放在 my-coding-platform-docs/agent_platform/dev_docs/modules/ 下对应的 plane 子目录（control/、data/、execution/、interaction/），**文件名与代码目录同名**（kebab-case，例如 data/state-ledger.md）。每份必须且只需包含五要素：
   - 职责：负责什么、**不负责什么**（"不负责"必须写）
   - 对外接口：调用者必须知道的契约（输入、输出、不变量、错误、必要约束）；若该接口本次会变，写明**变化方向**
   - 依赖：依赖哪些模块、依赖哪个接口
   - 被依赖：谁依赖它、消费哪个接口
   - 状态归属：拥有哪些状态、权威来源是谁、**归属生命周期哪一阶段/哪一动作**（对应架构文档的生命周期专章）
2. 模块索引落到 my-coding-platform-docs/agent_platform/dev_docs/modules/README.md：模块名 → 文档路径 → 一句话职责 → 代码目录。
3. 新增模块按同一模板产出文档；被拆解/合并/归档的模块，在旧文档位置留一行指向新位置。
4. 信息缺口清单：哪些字段在意图文档与现行文档里都找不到依据。

【交互方式（必须严格按顺序）】
1. 先读架构文档与现行模块文档，不要动笔。
2. 向我复述模块清单与字段模板，指出哪些模块信息不足。
3. 对边界不清、被多个模块重复描述的模块给出选项。
4. 等我确认后逐个模块落笔。

【禁止事项】
- 不得在没有依据的情况下替模块新增或删除职责、接口。
- 不得把架构文档或产品文档整段复制进模块文档。
- 不得改动架构文档、产品文档或源码。
- 不得因信息不足跳过模块——必须写文档并标注缺口。

【验收标准】
- 每个模块五要素齐全，"不负责什么"与"状态归属"都写到了。
- 接口会变的模块，其文档写明了变化方向。
- 模块索引可直接导航；信息缺口清单明确。
````

---

## Prompt 4：模块分工与 DAG

````text
【阶段】第四阶段：模块分工与 DAG
【一句话目的】给出重构后的模块划分与依赖 DAG，标出本次要切断/新增的边，并说明新增模块的落点。

【前置条件】
- 必须在 Prompt 2、Prompt 3 完成之后进行。
- 需我先确认：新增模块的数量与命名（默认：允许新增，但每个都要给理由与代价）。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 文档根：my-coding-platform-docs/agent_platform/
- 已确认：架构文档 my-coding-platform-docs/agent_platform/ARCHITECTURE.md；模块文档 my-coding-platform-docs/agent_platform/dev_docs/modules/
- **本轮前提**：模块边界会变；接口必然随之变化。已知 ContextCompiler 要收缩边界；lifecycle 相关可能需要新增模块（承载角色产生/拆解/压缩/归档与 Session 复用）。
- 控制面影响：my-coding-platform-docs/agent_platform/dev_docs/decision/02-investigation-and-conclusion.md §8（C1–C10，涉及 ControlEngine、PlanCompiler、DispatchEngine、VerificationEngine、ArchitectureReconciler）。
- 代码侧依赖表：coding-platform/scripts/module-map.mjs 的 allowedModuleDependencies（判断新增模块是否被现有 DAG 允许）。
- 占位符规则：本 prompt 不含任何占位符；路径打不开先问我。

【你本轮要产出的文件与章节】
落盘到 my-coding-platform-docs/agent_platform/dev_docs/refactor/module-dag.md：
1. 重构后的模块划分：模块名、一句话职责、代码目录；标明新增/保留/合并/拆分/删除。
2. 依赖 DAG：Mermaid 图 + 等价文本边表；明确箭头方向（调用者 → 被调用者）并说明无环。
3. 边表每行至少含：调用者 → 被调用者 | 传递内容 | 本次动作（保留/切断/新增）| 理由 | 对应不变量编号（如适用）。
4. **本次要切断的边**：切断什么、为什么、原功能由谁承接。
5. **本次要新增的边**：为什么必须新增、不新增会怎样、有无更小的替代方案。
6. **新增模块的落点**：新增模块叫什么、放在哪个 plane、需要哪些新边、是否成环；若现有 allowedModuleDependencies 不允许，给出改法。
7. **两张图与记忆搜索的承载**：架构图/任务图的检索能力落在哪个模块、依赖哪些边。
8. 与现状 DAG 的差异汇总（新增 N 条、切断 M 条）+ 拓扑序列表。

【交互方式（必须严格按顺序）】
1. 先读架构文档与模块文档，不要动笔。
2. 向我复述「现状 DAG」与「目标 DAG」的差异清单（只讲差异）。
3. 列出不确定的边，给出两种选择的后果。
4. 给方案选项（如"激进切断"vs"分步切断"），说明代价。
5. 等我确认后落盘。

【禁止事项】
- 不得产出带环的 DAG；确需双向交互必须改用事件/产物传递并说明。
- 不得无理由新增依赖边，不得把"顺手整理"当切断理由。
- 不得臆造模块或接口。
- 不得改源码，不得改动本轮产物以外的文件。

【验收标准】
- 边表完整，每条断/增边都有理由与替代方案。
- 新增模块有明确落点与依赖边，且能给出拓扑序。
- 我能只读这张图与边表，就判断出这次重构会动到哪些依赖关系。
````

---

## Prompt 5：基于源码的重构前分析

````text
【阶段】第五阶段：基于源码的重构前分析（只读）
【一句话目的】读实际源码，拿出重构前的现状事实；文档只用来对照差异，不作为事实来源。

【前置条件】
- 无强制前置：本环节只读源码，可与 Prompt 1–4 任一条并行。
- 需我先确认：分析范围是否覆盖全部源码，还是先覆盖控制面 + 生命周期相关模块。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 被重构项目：coding-platform/（当前 HEAD：58c9ada73966711437c5fcd3d8f8fb92f3dca210）
- 文档根：my-coding-platform-docs/agent_platform/（文档仅用于对照，不作为事实来源）
- 环境（仅用于理解项目怎么跑，不要求你执行）：包管理器 pnpm；构建 `pnpm build`；测试 `pnpm test`；静态检查未配置；本地启动 `pnpm gui`（服务 http://localhost:4317）
- 已知环境事实（请自行复核）：本快照 coding-platform/ 下 node_modules、.local、dist、vendor/coding-agent/dist、src/ui/node_modules **均不存在**，因此不能真正构建或跑测试。
- 意图要点：生命周期要自建（角色产生/拆解/压缩/归档、角色复用）、两张图要可检索、要减少重复装配上下文以提缓存命中、能力要参数化。
- 占位符规则：本 prompt 不含任何占位符；路径打不开先问我。

【本轮性质】
- **只读**：只允许读取文件、列目录、查看 git 状态与历史、搜索文件内容。
- 不得创建、修改、删除任何文件（最后写出报告除外）；不得安装依赖、不得构建、不得运行测试、不得联网。

【要读的目录与文件】
- coding-platform/src/app/（service.ts、server.ts）
- coding-platform/src/composition/（persistent-platform.ts）
- coding-platform/src/control/control-engine/、plan-compiler/、dispatch-engine/、verification-engine/、architecture-reconciler/
- coding-platform/src/data/context-compiler/、state-ledger/、read-model-index/、artifact-vault/、workspace-reader/
- coding-platform/src/execution/worker-runtime/
- coding-platform/src/interaction/human-collaboration/
- coding-platform/src/contracts/（144 文件）
- coding-platform/scripts/module-map.mjs、check-module-boundaries.mjs
- coding-platform/package.json、vitest.config.ts、scripts/test-wsl.sh

【你本轮要产出的文件与章节】
落盘到 my-coding-platform-docs/agent_platform/dev_docs/refactor/source-analysis.md，至少九节。**每条结论必须指到文件路径 + 符号名（函数/类/类型/常量），不允许没有出处的判断。**

1. 真实目录树（到模块/目录级，标注生成物与依赖目录，不展开）。
2. 模块间实际依赖与调用关系：实际 import/调用边（附文件与符号）+ 与文档 DAG 的差异表。
3. 重复/冗余实现清单：文件 + 符号 + 重复了什么 + 有哪几份副本 + 合并建议。（已知线索：`src/data/workspace-reader/denied-prefixes.ts` 声明为唯一权威，但 `src/execution/worker-runtime/coding-agent-runtime.ts`、`read-only-query-runtime.ts`、`src/control/verification-engine/command-check-provider.ts` 各有一份字面复制——请核实并补全。）
4. **生命周期管理现状与缺失点**：按"角色的产生/拆解/压缩/归档"四动作 + "创建/初始化/运行/挂起恢复/销毁"五阶段，逐项对齐到实际代码位置；明确指出哪些**在代码里没有对应实现**。（已知线索：`src/execution/worker-runtime/unconfigured-capabilities.ts` 把能力写死为 unsupported；`coding-agent-runtime.ts` 每次 Run `randomUUID()` 新建 sessionId——请核实。）
5. **控制面逻辑影响面**：对照 decision/02 §8 的 C1–C10，逐条核实并补全——`文件:行号 + 函数名 + 现状职责 + 变化后职责 + 变化类型`；并单列"不需要改、可保留的控制面逻辑"。
6. **接口与抽象变更面**：对照 decision/02 §9 的 I1–I12，逐个核实每个 Module 接口的现状签名、是否变、变化方向、受影响调用方；并单列**确认不变**的接口。
7. **成本相关的重复装配点**：找出"每次重新装配上下文"的具体位置（文件 + 函数），说明每处的重复程度与它在 50 倍价差下的代价量级。
8. 性能瓶颈点：文件 + 函数 + 现象 + 原因 + 支撑证据；区分"已实测"与"仅代码推断"。
9. 可读性与扩展性问题的具体点：文件 + 符号 + 具体现象（函数过长给实际行数、职责过多、命名名实不符、注释与代码矛盾、硬编码常量/路径/阈值、错误处理不统一）。

另附「文档与代码不一致清单」：文档说 X、代码实际 Y，各自位置。

【交互方式（必须严格按顺序）】
1. 先不写结论，先给我分析计划：按什么顺序读、覆盖哪些目录、预计哪些读不完。
2. 等我确认范围后再开始。
3. 遇到读不了的文件（权限、二进制、编码异常）跳过并列出来，不要中断。
4. 体量太大时：先输出模块清单与建议顺序，按模块分批，每批结束给小结，最后合并总评。

【禁止事项】
- 不得把现有文档当源码事实；文档只能出现在"对照差异"里。
- 不得臆造不存在的模块、函数、字段或行为；不确定写"不确定"，找不到写"未找到"。
- 不得修改任何文件（报告除外），不得生成补丁或建议性代码改动。
- 不得运行会改变仓库状态的命令，不得联网。

【验收标准】
- 九节齐全，每条结论能指到文件路径 + 符号名。
- 有独立的"文档说的 vs 代码实际做的"差异表。
- 生命周期四动作/五阶段的现状与缺失点写清楚了。
- 控制面影响面与接口变更面两节，能直接支撑 Prompt 4/6。
- 覆盖范围与未覆盖部分明确，跳过的文件与原因列出。
````

---

## Prompt 6：重构计划

````text
【阶段】第六阶段：重构计划
【一句话目的】把前面的结论整理成一份我不需要懂实现细节也能判断对不对的重构计划，并用成本口径约束每一步。

【前置条件】
- 必须在 Prompt 4（模块分工与 DAG）与 Prompt 5（基于源码的重构前分析）都完成之后进行。
- 需我先确认：本轮范围偏好（一次做完，还是允许分多次发布）。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 文档根：my-coding-platform-docs/agent_platform/
- 已确认的输入：
  - 产品文档 my-coding-platform-docs/agent_platform/PRODUCT.md
  - 架构文档 my-coding-platform-docs/agent_platform/ARCHITECTURE.md
  - 模块文档 my-coding-platform-docs/agent_platform/dev_docs/modules/
  - 模块分工与 DAG my-coding-platform-docs/agent_platform/dev_docs/refactor/module-dag.md
  - 源码分析报告 my-coding-platform-docs/agent_platform/dev_docs/refactor/source-analysis.md
  - 接口变更清单与抽象优化清单：my-coding-platform-docs/agent_platform/dev_docs/decision/02-investigation-and-conclusion.md §9（I1–I12、A1–A6）
- 环境：包管理器 pnpm；构建 `pnpm build`；测试 `pnpm test`；本地启动 `pnpm gui`（http://localhost:4317）
- **成本硬约束（必须贯穿全篇）**：DeepSeek 官方缓存命中与未命中约 **50 倍价差**（deepseek-flash：命中 0.02 元/百万 vs 未命中 1 元/百万）。它约束三件事——缓存命中率目标、上下文装配方式、生命周期回收策略。**凡涉及"每次重新装配上下文"的做法，都要按这个价差算一遍并说明是否划算**；命中率从 99% 掉到 75% 这类波动要能折算成具体金额并说明是否可接受。
- 保留与演进清单：
  - 保留不变：`pnpm build` / `pnpm start` / `pnpm test` / `pnpm typecheck` / `pnpm check:architecture`；服务监听 127.0.0.1:4317；数据目录 PLATFORM_GUI_DATA。
  - 允许演进：12 个 Module 的对外接口（I1–I12）、HTTP 路由新增、契约新增字段、模块边界增删。
  - 需迁移或兼容：既有 SQLite schema（src/data/state-ledger/sqlite-ledger.ts、src/data/read-model-index/sqlite-read-model-index.ts）。
- 占位符规则：本 prompt 不含任何占位符；路径打不开先问我。

【你本轮要产出的文件与章节】
计划落盘到 my-coding-platform-docs/agent_platform/dev_docs/refactor/refactor-plan.md，至少包含：
1. 目标与范围：逐条对应五条意图（生命周期自建、两张图作为能力、复用 A 的两处机制、能力参数化、成本约束），说明本次分别做到什么程度。
2. **阶段划分**：拆成若干阶段（编号 P0、P1…）。每阶段写清：输入、输出、完成判据（**可观察现象**）、涉及模块。
   建议顺序：先改文档 → 再定边界 → 再改接口 → 再改实现（与 Prompt 1–8 的顺序一致）。
3. 阶段依赖图（Mermaid 或文本），标明可并行的阶段。
4. **破坏性变更清单**：逐条列出被破坏的对外接口/数据格式/调用方（具体到名字）、影响范围、迁移方式、是否可逆。**接口变更必须与之一并列为一级内容**（引用 I1–I12）。
5. 保留清单：§2.4「保留不变」的每一条对应到计划中哪个阶段、由什么保证不被破坏。
6. 回滚点：哪些阶段之间可回滚、回滚步骤、回滚后需重建哪些数据/状态。
7. **每阶段的成本判据**：该阶段做完后，缓存命中率预计怎么变、折算成金额是多少、为什么划算或不划算。
8. 每阶段的通过现象：用我能观察到的现象描述（如"某命令输出某结果""某页面出现某状态""某接口返回某结构"），不要写"代码更干净""结构更清晰"。
9. 风险与缓解：触发条件、影响、缓解手段。
10. 与源码分析报告的对应：每条计划动作指向报告中的哪一条现状证据。

【交互方式（必须严格按顺序）】
1. 先读全部输入产物，不要动笔。
2. 向我复述：要解决的现状问题、目标状态、你认为最危险的三处变更。
3. 给 2–3 个整体计划选项（如"一次性大爆炸"vs"分阶段可发布"），列出代价、风险与回滚难度。
4. 列出所有需要我拍板的选择点。
5. 等我确认后再落盘。

【禁止事项】
- 禁止"优化代码结构""提升可维护性"这类没有落点的表述。
- 不得把源码分析报告里没有确认的代码事实写进计划。
- 不得直接开始改代码；本轮只出计划。
- 不得为了计划好看而隐瞒破坏性变更。
- 不得改动输入产物。

【验收标准】
- 我能逐阶段判断"这一步做什么、做完该看到什么"。
- 破坏性变更清单完整且具体到名字；接口变更在其中占一级位置，每条有迁移方式。
- 回滚点明确；保留项都有对应保障。
- 每阶段都有金额判据，没有泛泛而谈的句子。
````

---

## Prompt 7：Agent 文档更新与旧文档归档

````text
【阶段】第七阶段：Agent 文档更新与旧文档归档
【一句话目的】更新 agent 实际会读到的那份约定文档，并把被取代的旧文档归档，保证引用不断链。

【前置条件】
- 必须在 Prompt 6 完成、计划经我确认之后进行。
- 需我先确认：哪些旧文档确实被取代（我会在你的清单上勾选）。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 文档根：my-coding-platform-docs/agent_platform/
- **agent 约定文档（本次要更新的那一份）**：coding-platform/AGENTS.md（372 行，仓库级 agent 入口，含两仓库路径翻译规则）
  —— 另有一份工作入口 my-coding-platform-docs/agent_platform/AGENTS.md（34 行），只作参照，不在本次改写范围（如你要改它也请先问我）。
- 归档目录：my-coding-platform-docs/agent_platform/dev_docs/archive/
- 已确认的输入：PRODUCT.md、ARCHITECTURE.md、dev_docs/modules/、dev_docs/refactor/module-dag.md、dev_docs/refactor/refactor-plan.md
- 环境：包管理器 pnpm；构建 `pnpm build`；测试 `pnpm test`；静态检查**未配置**；本地启动 `pnpm gui`
- 占位符规则：本 prompt 不含任何占位符；路径打不开先问我。

【你本轮要产出的文件与章节】
1. 更新 coding-platform/AGENTS.md，写入：
   - 本次重构的约定与不变量（含：模块边界会变、接口会变、接口与抽象会被优化）
   - 目录规范：代码（coding-platform/src/…）、文档（my-coding-platform-docs/agent_platform/…）、重构产物（my-coding-platform-docs/agent_platform/dev_docs/refactor/…）分别放哪
   - 命令：`pnpm build`、`pnpm start`、`pnpm test`、`pnpm typecheck`、`pnpm check:architecture`、`pnpm gui`（静态检查未配置，如实写）
   - 禁止事项：不得臆造结构、不得把文档当源码事实、不得越界改动、不得跳过验证
   - 阅读顺序：进入仓库后先读什么、再读什么
   - 当前阶段 + 到哪份计划/文档查后续
2. 把被取代的旧文档移动到 my-coding-platform-docs/agent_platform/dev_docs/archive/（冲突时先问我）。
3. 归档索引：逐条列出「被归档文件 → 归档后路径 → 取代它的新文档 → 原因 → 日期」。
4. 引用重定向说明：全仓搜索对已归档文件的引用，逐条给出「引用所在文件:行号 → 原来指向 → 现在应指向 → 是否已更新」。

【交互方式（必须严格按顺序）】
1. 先只读，不要改任何文件。
2. 向我提交两份清单：①建议被取代的旧文档清单 ②当前对它们的引用关系（谁引用、在哪一行）。
3. 列出不确定项（某份文档是部分取代还是整体取代）。
4. 等我确认归档清单与命名后，再执行移动与更新。
5. 执行完给改动文件清单与验证结果。

【禁止事项】
- 不得未经我确认就移动、重命名或删除任何文档。
- 不得留下指向已归档文件的死链；所有引用必须同步更新或显式列入待处理。
- 不得改动源码。
- 不得新建第二份用途重复的 agent 约定文档（并入 coding-platform/AGENTS.md）。

【验收标准】
- AGENTS.md 自洽：命令真实、目录规范与仓库一致、禁止事项明确。
- 归档索引列出每个被归档文件及其新位置与取代者。
- 引用检查结果完整：要么已更新，要么在待处理清单里，没有静默断链。
````

---

## Prompt 8：重构执行（模板，逐模块实例化）

````text
【阶段】第八阶段：重构执行（模板）
【本轮模块】（唯一需要填空的一行——按 my-coding-platform-docs/agent_platform/dev_docs/refactor/module-dag.md 的拓扑序，填当前要做的模块名）：
本轮模块：______

【一句话目的】按 DAG 逐模块执行重构，每次只做一个模块，动手前先确认边界与影响面。

【前置条件】
- 必须在 Prompt 6、Prompt 7 完成之后进行。
- 按 module-dag.md 的拓扑序逐个实例化：同一层级可并行，跨层必须等上游验收通过。
- 需我先提供：该模块在计划中的阶段编号、代码目录、以及它本次要变的接口。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 文档根：my-coding-platform-docs/agent_platform/
- 已确认的输入：
  - 架构文档 my-coding-platform-docs/agent_platform/ARCHITECTURE.md（含生命周期专章、两张图专章、模块边界变更、接口演进）
  - 该模块文档：my-coding-platform-docs/agent_platform/dev_docs/modules/ 下对应的 plane 子目录中、与代码目录同名的文件
  - DAG：my-coding-platform-docs/agent_platform/dev_docs/refactor/module-dag.md
  - 源码分析：my-coding-platform-docs/agent_platform/dev_docs/refactor/source-analysis.md
  - 计划：my-coding-platform-docs/agent_platform/dev_docs/refactor/refactor-plan.md
- 保留与演进：`pnpm build`/`start`/`test`/`typecheck`/`check:architecture` 与服务端口 127.0.0.1:4317 必须保留；模块接口按接口变更清单演进。
- 成本硬约束：缓存命中与未命中约 50 倍价差；本模块改动若影响上下文装配方式，须说明对命中率的影响量级。
- 环境：包管理器 pnpm；构建 `pnpm build`；测试 `pnpm test`；静态检查未配置。
- 占位符规则：除上面「本轮模块」一行外，本 prompt 不含其它占位符。

【交互方式（实施类，必须严格按顺序）】
**动手之前**，先提交三样，等我确认后才开始改代码：
1. 本模块的边界复述：负责什么、**本次明确不动的部分**是什么（若"无不动部分"，明说）。
2. 破坏性影响清单：本次会破坏哪些对外接口/数据格式/调用方（具体到名字），影响谁，调用方要做什么。**接口变化必须列在第一条。**
3. 验证方式：改完用什么证明没改坏（具体命令 + 预期输出 + 需新增或修改的测试）。
**动手之后**，提交：
4. 改动的文件清单（逐个文件说明改了什么）。
5. 验证结果：实际执行的命令与输出摘要（不要只写"测试通过"）。
6. 与计划的偏差：偏离了什么、为什么。

【禁止事项】
- 不得改动本轮模块范围之外的文件或模块；确有必要先停下来问我。
- 不得臆造代码里不存在的结构；不确定先问。
- 不得跳过验证，不得把"应该没问题"当验证结果。
- 不得改动意图文档、架构文档、DAG、重构计划等输入产物。
- 不得在未确认边界与影响面之前开始改代码。

【验收标准】
- 我确认了边界复述、破坏性影响清单与验证方式之后，才发生代码改动。
- 改动文件清单完整，每个文件能对应到计划里的某一步。
- 验证命令与结果可见、可复核；无越界改动。
- 与计划的偏差被显式说明。
````

---

## Prompt 9：前端展示改版

````text
【阶段】第九阶段：前端展示改版
【一句话目的】把"好看"落成可执行的视觉标准，并补齐主 Agent 面、秘书解释交互与角色卡片。

【前置条件】
- 必须在 Prompt 6 完成之后进行；可与 Prompt 8 并行。
- 需我先确认：是否做深色主题、是否有必须沿用的设计系统或品牌色。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 前端代码目录：coding-platform/src/ui/（React 工作台，80 文件，独立 pnpm workspace，服务默认入口）
  —— 旧界面在 coding-platform/src/app/public/（`/legacy`，17 文件），本次是否一并处理请先问我。
- 文档根：my-coding-platform-docs/agent_platform/
- 已确认的输入：产品文档 my-coding-platform-docs/agent_platform/PRODUCT.md、架构文档 my-coding-platform-docs/agent_platform/ARCHITECTURE.md、计划 my-coding-platform-docs/agent_platform/dev_docs/refactor/refactor-plan.md
- 环境：包管理器 pnpm；构建 `pnpm build`；前端类型检查 `pnpm ui:typecheck`；本地启动 `pnpm gui`（服务 http://localhost:4317，React 工作台在 `/`）
- **本次要补齐的界面能力（来自意图）**：
  1. 主 Agent 面（类超长上下文）：人在这里给目标范围、提问、看项目状态；
  2. 秘书回路：秘书出方案 → 人在对话框或侧边栏反馈（哪些地方不对劲、哪些值得思考）→ 秘书修订；**方案须经人确认后才生效，不落实际执行、不改目标、不改两张图**；
  3. 秘书解释交互：人可追问"为什么这么定""依据是什么""还有哪些备选"，秘书**基于已产出的那份方案与它依据的材料**解释，**不得另起一份新方案**；界面在对话框或侧边栏就能问、就能看到；
  4. 角色卡片：展示 Agent 的负责范围、当前工作、忙闲/等待、最近探索版本、关联 session、待处理事项；
  5. 两张图视图：架构图视图当前为 UnavailableState，需要变为可用。
- 保留不变：服务端口 127.0.0.1:4317 与既有入口路径不得破坏。
- 占位符规则：本 prompt 不含任何占位符；路径打不开先问我。

【"好看"必须落到的具体标准（逐条给方案，不接受"整体更美观"）】
1. 布局对齐方式：用什么对齐体系（栅格/对齐基线/流式规则），页面区块如何对齐。
2. 间距与字号体系：给出具体间距阶梯与字号层级（数值 + 用途），并说明现有页面如何映射。
3. 颜色与主题：颜色 token（命名 + 用途）；是否支持深色主题；若支持，说明切换方式与对比度要求。
4. 窄窗口/移动端：给出断点数值与每个断点下的布局降级规则（如侧栏收起、表格转卡片）。
5. 三态显示：**加载中 / 空数据 / 出错**各自的视觉与文案规范，三者必须明显区分，不能只留"加载中"。

【你本轮要产出的内容】
1. 改动后的前端代码（在 coding-platform/src/ui/ 内）。
2. 视觉规范落到 my-coding-platform-docs/agent_platform/dev_docs/refactor/ui-visual-spec.md：把五类标准的**实际采用值**写清（数值、token 名、断点、状态文案）。
3. 改前改后对比说明：逐项对照五类标准 + 上面 5 项界面能力，说明改前是什么、改后是什么；能截图就截图，不能就用可核对的逐项描述（组件名 + 样式属性 + 前后值）。

【交互方式（必须严格按顺序）】
1. 先读现有前端代码与布局，不要动笔。
2. 向我复述当前视觉问题，并给出五类标准 + 5 项界面能力的**提案与选项**（如"紧凑型/宽松型"两套间距阶梯）。
3. 列出不确定项（是否深色、是否沿用现有设计系统、字体来源、`/legacy` 是否处理）。
4. 等我确认后再改代码，并产出视觉规范与对比说明。

【禁止事项】
- 不得只调颜色而忽略布局、间距、断点与三态。
- 不得引入我未确认的设计系统、组件库或外部字体资源。
- 不得改动 coding-platform/src/ui/ 以外的文件（除非我先批准）。
- 不得在没有任何对比证据的情况下声称"更好看"。
- 不得让秘书方案在未确认前进入执行路径（这是意图里的硬要求）。

【验收标准】
- 五类标准逐条有落点，且都给到具体数值或 token 名。
- 5 项界面能力可复现：主 Agent 面可提问、秘书可解释且不另起方案、角色卡片有内容、两张图视图不再是 UnavailableState。
- 三态可复现且视觉可区分；改前改后对比可逐项核对。
````

---

## Prompt 10：跨 agent 评审（4 个实例）

> 原来是一条带 `<REVIEW_TARGET>` 的通用 prompt；本版实例化为 4 条，可直接发送。

### Prompt 10-A：评审架构文档

````text
【阶段】质检：评审架构文档
【一句话目的】以挑错为目标，评审 my-coding-platform-docs/agent_platform/ARCHITECTURE.md 的新版本。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 待评审产物：my-coding-platform-docs/agent_platform/ARCHITECTURE.md
- 关注范围：生命周期专章（角色产生/拆解/压缩/归档 + 创建/初始化/运行/挂起恢复/销毁）是否真有落点；两张图是否既写了"是什么"也写了"怎么被检索、怎么反向决定编排"；模块边界变更与接口演进是否完整；依赖 DAG 是否无环。
- 相关输入：my-coding-platform-docs/agent_platform/dev_docs/decision/02-investigation-and-conclusion.md（§8 控制面影响、§9 接口清单）、my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-agent-platform-lifecycle-orchestration-plan.md
- 代码仓：coding-platform/（HEAD 58c9ada）
- 本环节**只读**：不得修改任何文件（评审报告除外）；不得联网；不得安装依赖或构建。

【要回答的问题】
1. 产物引用的每个文件路径是否存在？逐个核对。
2. 产物引用的每个"文件:行号"是否真的对应它声称的内容？逐个抽查。
3. 是否有把"文档说法"当作"代码事实"的地方？
4. 遗漏项：按目标应覆盖却未覆盖的内容（尤其控制面 5 个模块的连带改动）。
5. 与源码不符之处：产物声称 X → 代码实际 Y（附文件路径 + 符号名）。
6. 每条你认为是问题的点，给至少一个替代做法及代价。
7. 总体判断：可接受 / 需修订 / 需重做，附依据与置信度。

【输出格式】
- 每条问题：问题 | 产物位置 | 源码证据(文件:行号) | 严重程度 | 建议 | 替代方案代价
- 必含一节「产物引用的路径存在性核对表」与一节「需澄清的问题」

【报告落盘】my-coding-platform-docs/agent_platform/dev_docs/refactor/reviews/architecture-review.md

【禁止事项】不得修改任何文件（报告除外）；不得只给泛泛评价；不得在没有读源码的情况下断言"与代码不符"；不得把风格偏好写成事实错误。
````

### Prompt 10-B：评审模块分工与 DAG

````text
【阶段】质检：评审模块分工与 DAG
【一句话目的】以挑错为目标，评审 my-coding-platform-docs/agent_platform/dev_docs/refactor/module-dag.md。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 待评审产物：my-coding-platform-docs/agent_platform/dev_docs/refactor/module-dag.md
- 关注范围：新增模块的落点与理由；切断/新增边是否都有依据；是否成环；ContextCompiler 收缩造成的边变化是否覆盖；两张图与记忆搜索的承载是否落在模块上。
- 对照物：coding-platform/scripts/module-map.mjs 的 allowedModuleDependencies（现状依赖表）；my-coding-platform-docs/agent_platform/ARCHITECTURE.md 的 ModuleDependencyDAG。
- 本环节**只读**：不得修改任何文件（评审报告除外）；不得联网。

【要回答的问题】
1. 边表是否完整？有无遗漏的现状边或凭空新增的边？
2. 用 module-map.mjs 的依赖表核对：新增模块/新边是否与既有声明冲突？冲突处给出两种改法。
3. 拓扑序是否可验证？是否成环？
4. 每个新增模块：职责是否与既有 12 Module 重叠？能否用更小的改动（如并入既有模块）替代？
5. 与源码不符之处（附文件路径 + 符号名）。
6. 总体判断：可接受 / 需修订 / 需重做。

【输出格式】同 10-A 的格式要求。

【报告落盘】my-coding-platform-docs/agent_platform/dev_docs/refactor/reviews/module-dag-review.md

【禁止事项】同 10-A。
````

### Prompt 10-C：评审重构计划

````text
【阶段】质检：评审重构计划
【一句话目的】以挑错为目标，评审 my-coding-platform-docs/agent_platform/dev_docs/refactor/refactor-plan.md。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 待评审产物：my-coding-platform-docs/agent_platform/dev_docs/refactor/refactor-plan.md
- 关注范围：阶段划分是否可执行；破坏性变更（尤其接口变更 I1–I12）是否完整且给了迁移方式；回滚点是否真实可用；**每阶段的金额判据是否成立**（缓存命中与未命中约 50 倍价差：deepseek-flash 命中 0.02 元/百万 vs 未命中 1 元/百万）；保留不变项是否有对应保障。
- 对照物：my-coding-platform-docs/agent_platform/dev_docs/decision/02-investigation-and-conclusion.md §9；my-coding-platform-docs/agent_platform/dev_docs/refactor/source-analysis.md
- 本环节**只读**：不得修改任何文件（评审报告除外）；不得联网。

【要回答的问题】
1. 每个阶段的"通过现象"是否真的可观察？不可观察的逐条指出。
2. 破坏性变更是否有遗漏？接口变更是否与之一并列为一级内容？
3. 回滚点：回滚后需要重建的数据/状态是否写明？有无实际上不可回滚的步骤被标成可回滚？
4. 金额判据：数字是否基于可复现的命中率（89.99% 或 89.10%），有没有误用不可复现的 77.48%？
5. 是否有"优化代码结构"这类无落点表述？
6. 总体判断：可接受 / 需修订 / 需重做。

【输出格式】同 10-A 的格式要求。

【报告落盘】my-coding-platform-docs/agent_platform/dev_docs/refactor/reviews/refactor-plan-review.md

【禁止事项】同 10-A。
````

### Prompt 10-D：评审某个模块的改动

````text
【阶段】质检：评审某一模块的改动
【一句话目的】以挑错为目标，评审某个模块本轮的实际代码改动。

【背景自述（本 prompt 单条复制即可用，不依赖上文）】
- 工作区根：/home/hyh001/projects/coding-platform
- 待评审对象：本轮模块的代码改动（把你从这里开始新起的一行改成实际模块名与代码目录）：
  待评审模块：______（对应代码目录：coding-platform/src/______）
- 关注范围：是否越界改了模块外的文件；接口变化是否与 architecture 文档中的接口演进清单一致；是否有臆造结构；生命周期相关改动是否与架构文档的生命周期专章一致；缓存装配方式变化是否给了金额判据。
- 对照物：my-coding-platform-docs/agent_platform/ARCHITECTURE.md；my-coding-platform-docs/agent_platform/dev_docs/refactor/module-dag.md；my-coding-platform-docs/agent_platform/dev_docs/refactor/refactor-plan.md；coding-platform/scripts/module-map.mjs
- 获取改动的方式：用 `git -C coding-platform status`、`git -C coding-platform diff` 只读查看；**不得修改、不得提交、不得检出**。
- 本环节**只读**：不得修改任何文件（评审报告除外）；不得联网；不得构建或跑测试。

【要回答的问题】
1. 改动文件清单是否与声明一致？有无越界？
2. 每个改动的文件：实际改了什么？是否有臆造的结构或未声明的接口变化？
3. 破坏性影响是否与声明一致？有无遗漏调用方？
4. 与 module-map.mjs 的依赖表核对：有无引入未声明的模块依赖？
5. 验证方式是否成立？（注意：本快照无 node_modules，若报告声称跑过测试，要求它给出可复现的证据）
6. 总体判断：可接受 / 需修订 / 需重做。

【输出格式】同 10-A 的格式要求。

【报告落盘】my-coding-platform-docs/agent_platform/dev_docs/refactor/reviews/module-<模块名>-review.md

【禁止事项】不得修改、提交或检出任何代码；不得只给泛泛评价；不得在没有读源码的情况下断言"与代码不符"。
````

---

## 附：发送前自查

- [ ] 本轮要发的是哪一条？它需要的输入产物是否已经存在（前序 prompt 是否已完成）？
- [ ] 若发 Prompt 8 或 10-D，**「本轮模块」一行是否已填**（这是全篇唯一的运行时填空）？
- [ ] Prompt 1/2/3/4 属讨论类：确认自己准备好了「复述 → 选项 → 确认」这一轮往返。
- [ ] Prompt 5/8/10 属只读或先确认后动手：确认 agent 没有越过确认环节。
- [ ] 受 `dev_docs/decision/README.md` §0 门禁约束时，先不要批量派发。
