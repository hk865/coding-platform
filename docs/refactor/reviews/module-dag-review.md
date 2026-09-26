# Prompt 4 模块分工与 DAG 一致性审查

> 历史评审说明：本文保留对旧方案的评审结论，架构、DAG 和模块引用固定到 [2026-09-23 迁移前快照](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/README.md)；当前方案见 [架构入口](/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md)。

审查日期：2026-09-22。对象：`docs/refactor/module-dag.md` 当前 571 行版本。

**结论：需修订，不需重做。** 模块划分、38 条依赖的方向与无环性符合本轮架构稿；连续 Session 复用、ContextCompiler 收缩、Kernel 分工等主要方向符合产品和最新人类意见。但存在 **3 项 P2 问题**，影响目标依赖的定案、产品查询链路的正确接线和新增模块的边界检查。另有 2 项较小的事实／措辞修正。修正前宜保留“候选 DAG”地位，不宜作为已完成边界定案的实施输入。

本次只新增本报告，未修改被审查产物、产品文档、架构稿、模块稿或源码。没有联网。结论针对当前文件，不追认原任务是否履行了“先讨论、确认后落盘”的过程。

## 1. 依据与优先级

| 依据 | 本次采用的口径 |
| --- | --- |
| [用户回复原文](../../history/before-2026-09-22/agent-platform-user-replies-numbered.md)及[09-21 澄清后修订结论](../../history/before-2026-09-22/agent-platform-open-decisions-recommendations.md) | 核对人的实际意图，优先于较早、后来已撤回的助手建议。原话中的疑问与条件性意见不自动视作批准。 |
| [PRODUCT](../../history/before-2026-09-22/PRODUCT.md) | 产品路径、两图查询、责任关联和能力范围。 |
| [本轮 ARCHITECTURE](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md) | 13 模块、38 边、权威归属、生命周期和已关闭决定。 |
| [模块承载总表](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/ownership-map.md)及 13 篇模块文档 | 接口提供者／消费者、共享责任和明确移交给 Prompt 4 的取舍。 |
| [Prompt 4](../../refactor-prompts.revised.md)第 406–486 行 | 本阶段应交付模块划分、带理由的边表、差异、图与记忆查询承载、无环说明。 |
| 源码与 [source-analysis](../../history/before-2026-09-22/refactor/source-analysis.md) | 源码决定现状，旧分析提供定位线索；涉及检查器、装配和接口的结论已回查当前源码。 |

同时参考了 `agent-platform-architecture-review.md`、两版 `agent-platform-decision-recommendations*.md` 和 `agent-vs-agent-team.md`。没有把旧审查要求的“每轮继承历史准入”、独立跨任务 Agent 主体或新增 Runtime→Control 边重新当成必需项；这些已被后续人类意见和架构稿撤回。

## 2. 主要问题

### R01 · P2 · 记忆搜索和责任关联链路引用了不提供对应能力的边

**产物位置：** [module-dag.md:440](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:440)，以及第 441、443、449、450 行。

| 产物写法 | 实际接口／归属 | 问题 |
| --- | --- | --- |
| 架构图检索包含 `#35（Vault 候选发现）` | #35 是 Vault→ReadModel 的 `materialAccessCandidates`／`materialAccessGrants` | 授权候选不是候选模块，不能用它完成图邻域检索。 |
| 模块→负责人路由、agent 索引读取使用 #38 | #38 是 `PolicyExplanationPort` 与 `dedupeTaskWorks`，提供证据／计划解释和身份纯归并 | 不提供模块、角色和 Session 的关联查询。 |
| 返回校验使用 `#35（授权适用性）` | ReadModel 只发现候选；Vault 再核对 canonical 授权、撤销与来源适用性 | 候选发现被写成授权判定，遗漏真正的校验责任。 |
| 关联写入经 #21／#2 | #21 是 ArchitectureReconciler→Control 的 inspection／finding／brief 命令 | Reconciler 文档明确不写、不读该关联，也不产生正式关联。 |
| 事实索引使用 `#22（事实权威）` | #22 是 ArchitectureReconciler→ContextCompiler 的对账材料请求 | 不是账本与 Session 记录的事实权威读取路径。 |

**依据：** [PRODUCT:398](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:398)区分 agent 索引与事实索引，[PRODUCT:559](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:559)要求图→模块→负责人→咨询→上下文与事实校验。[ReadModel:57](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:57)给出真正的图查询候选接口；[Vault:69](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:69)限定授权候选用途；[Reconciler:105](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/architecture-reconciler.md:105)明确关联边界。源码 [material-access-policy.ts:22](/home/hyh001/projects/coding-platform/coding-platform/src/data/artifact-vault/material-access-policy.ts:22)也明确投影只找候选，随后读取 Ledger 复核。

**影响：** 按该表实施，会向不提供相应信息的端口查询，或扩大 Reconciler 的职责、把投影候选当成授权依据。这不是等精确字段冻结后才能判断的问题，当前 owner 和端口用途已经明确。

**建议：** 重写 §7.3／§7.4 的“依赖哪些边”列。图和责任关联读取明确经 #3 的 ReadModel 查询；关联写入明确普通 Control 记录命令的实际调用者与内容，不借 #21 的架构检查命令代替；授权明确区分 Vault 入口、#35 候选发现、#34 canonical 复核和 #36 来源检查；事实索引明确账本和 Session 来源读取路径。

**替代方案与代价：** 保持 38 条模块边，只修正这组能力到接口的映射即可；若确实要扩展某条边的接口能力，必须同步提供模块的公开契约和职责依据，不能仅改边号解释。前者改动更小，且与当前模块分工一致。

### R02 · P2 · 明确要求在 Prompt 4 决定的共享依赖仍未定案

**产物位置：** [module-dag.md:509](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:509)的 U1，及第 519 行“本轮不定”。

[ownership-map.md:337](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/ownership-map.md:337)明确要求：S09 路径拒绝政策的两个候选必须在 **Prompt 4 作取舍**，再同步上位架构与模块边表。第 344 行允许后置的是精确类型、装配和旧数组删除顺序。当前 DAG 仅重复候选及条件，没有决定共同值／政策的 owner；两种方案会直接影响是否新增 `VerificationEngine → WorkspaceReader`，即目标是 38 条还是 39 条。

**影响：** 这使“目标 DAG 已确定”的结论不完整，下游仍需重新决定跨模块分工。不能因为边数与架构旧稿一致，就视为该移交项完成；[ARCHITECTURE:847](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:847)明确 38 不是必须守住的数字。

**建议：** 在依赖定稿前按真实语义完成 S09 选择并登记理由：若 Verification 必须随 Reader 的访问政策演进，公开窄接口并承认新增逻辑边；若仅共享经核实同义的稳定协议值，明确其共享归属并保持既有边。数组的精确类型、消费者切换与删除步骤可以继续交给 Prompt 6。

**替代方案与代价：** A 增加一条指向汇节点的边，无环，但增加政策接口和消费关系；B 不增加 Module 边，但必须证明共同值确实同义，不能把路径解析、沙箱算法或索引忽略规则顺手下移 Contracts。若有原任务中明确批准延期的记录，则应补上该例外依据，并相应标注 DAG 尚待这一决定。

**相关一致性问题：** [module-dag.md:537](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:537)仍把“下移纯计算后删除 ReadModel→Control”作为未定选择；[ownership-map.md:317](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/ownership-map.md:317)的 S02 已指定 Control 公共窄面，消费者包括 ReadModel。应承接该目标，或明确何种重新分析足以改动它，不能在未处理全部权威政策消费者时只因 helper 下移就删除整条边。这与 S09 一起属于边界决定的衔接问题，不是新增产品待决。

### R03 · P2 · 新模块的机械同步清单不完整，照单实施会漏检依赖

**产物位置：** [module-dag.md:365](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:365)的改法和[第 397 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:397)的机械同步清单。

产物要求修改 `moduleDirs`、`allowedModuleDependencies` 和测试的 `MODULE_DIRS`，遗漏了以下现有消费点：

| 必须同步的位置 | 当前用途／不改的后果 |
| --- | --- |
| [module-map.mjs:3](../../../coding-platform/scripts/module-map.mjs) 的 `export const modules` | [check-module-boundaries.mjs:23](/home/hyh001/projects/coding-platform/coding-platform/scripts/check-module-boundaries.mjs:23)只有在两端都被 `modules.includes` 识别时才检查未声明的 Module 依赖；只加目录和允许边会使 AgentLifecycle 的越界实现依赖被过滤掉。 |
| [module-ownership.test.ts:86](/home/hyh001/projects/coding-platform/coding-platform/tests/contracts/module-ownership.test.ts:86) | 测试硬编码 12，且比较 `MODULE_DIRS` 与 `modules`；新增第 13 个模块后会失败。 |
| [module-ownership.test.ts:154](/home/hyh001/projects/coding-platform/coding-platform/tests/contracts/module-ownership.test.ts:154) | `MODULE_FILE_INVENTORY` 的键要与注册表一致，文件清单也要与实际目录一致；只改 `MODULE_DIRS` 不够。 |

**影响：** “目录能识别、声明 DAG 无环”和“新模块的所有实现依赖受到检查”是不同事情。现有代码尚无 AgentLifecycle，因此当前检查通过不能暴露这项遗漏。

**建议：** 在 §6.1／§6.2 补齐 `modules`、测试模块数和文件清单的同步要求。实现阶段检查应覆盖新模块参与的越界依赖，不能只检查允许 DAG 是否无环。

**替代方案与代价：** 可以保留当前独立注册表与测试清单并同步更新，改动最小；也可另行把重复注册事实归一，但那是额外的实现重构，不是修正文档清单的前提。本次无需写实现或改测试。

## 3. 较小的事实与措辞修正

- **P3，现状与目标消费混写。** [module-dag.md:159](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:159)把 `requestInitial`／`accept(resultRef)`与 Human→Plan 的现状 DI 写在同一行。当前 Human 仅有 [human-collaboration.ts:39](/home/hyh001/projects/coding-platform/coding-platform/src/interaction/human-collaboration/human-collaboration.ts:39)的 `Pick<PlanCompilerPort, 'request'>`，另两者由 Host 的 [initial-planning.ts:8](/home/hyh001/projects/coding-platform/coding-platform/src/app/initial-planning.ts:8)、第 15 行调用。真实签名为 [planning.ts:37](/home/hyh001/projects/coding-platform/coding-platform/src/contracts/planning.ts:37)的 `accept(trigger)`，`reason` 必填、`resultRef` 可选。应分别标注当前调用方和目标消费扩展，恢复准确签名。这一混写也见于上游 Human 模块稿第 94 行，不宜只修 DAG 后继续把上游当成现状证据。
- **P3，授权候选限制过宽。** [module-dag.md:238](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:238)的“投影……也不得成为授权候选”与同一行 `materialAccessCandidates` 冲突。应限定为“有界展示接口 `materialAccessGrants` 不得当作授权候选来源”，保留完整候选查询的正确职责。

## 4. 已通过的核验

| 核验 | 结果 |
| --- | --- |
| 模块划分 | 13 个，与架构稿一致；新增 AgentLifecycle 位于 Control，既有 12 个名称／目录保留。 |
| 图表一致性 | Mermaid、38 行详细边表、正向邻接表、反向表均为 38 条唯一边，集合差异为空。 |
| 与架构稿 DAG 比较 | 38 条 Module 边完全一致；Host 边未计入。 |
| 与源码允许表比较 | 基线 34 条；新增恰好 DE→AL、AL→Control／Ledger／ReadModel 四条，删除 0 条。 |
| 无环与分层 | 38 条边均指向产物列出的更低依赖层；无环；StateLedger、WorkspaceReader 为两个出度 0 的汇。此处列的是依赖先行的构建顺序。 |
| 当前源码机械检查 | 实跑 `node scripts/check-module-boundaries.mjs`，退出码 0；541 个解析源文件，542 个归属文件，`issues: []`。 |
| 实际 import 边 | 14 对，其中 12 对含非 type-only import、2 对仅 type-only，均在基线允许集合内。 |
| DI 抽查 | Vault→Ledger／ReadModel 确有真实装配：`persistent-platform.ts:557` 调用 `createMaterialAccessResolver(ledger, readModel, sourceApplicability)`；未把“无 import”误判为“无依赖”。 |
| 生命周期分责 | Lifecycle 决策／提案，Dispatch 派发，Runtime／Kernel 执行，Control 归约，Ledger 提交；没有新增 Lifecycle→Runtime 或 Runtime→Control。 |
| ContextCompiler 收缩 | 以触发方式和职责收缩为主；保留材料来源依赖不自动违反重构目标。普通消息和有效恢复不被要求重新全量编译。 |
| 人的最新方向 | 未重新要求独立跨任务 Agent 主体、逐条继承历史门禁或第二套 Kernel 恢复系统；长期领域专家仍是扩展预留。 |
| 产品确认与图权威 | 绑定具体方案版本的确认、解释不等于重新提案、结构与日常关联分开、图不成为第二权威等原则已写入。R01 是具体映射没有正确承接这些原则。 |

**检查范围限制：** 本次源码机械检查仍只覆盖现状 12 模块／34 条允许边；目标 13 模块／38 边的无环结论来自文档集合核验，不是新增实现已经通过。未运行产品测试、全量测试或类型检查，因为没有实现改动；不据此宣称生命周期或图能力已交付。

## 5. Prompt 4 交付符合性

| 要求 | 判断 |
| --- | --- |
| 模块名、职责、目录、新增／保留处置 | 满足。 |
| Mermaid、文本边表、方向、拓扑与无环说明 | 满足。 |
| 逐边传递内容、动作、理由、不变量 | 形式齐全；具体链路映射需修 R01，现状标签需补正。 |
| 切断／新增理由、承接和替代方案 | 主要满足；没有理由要求为了体现重构而机械删边。S09 的真实取舍尚未完成，见 R02。 |
| 新增模块落点和允许表改法 | 分责满足；机械同步方案需补 R03。 |
| 两图与记忆搜索落点 | 有章节，但记忆与关联链路不完全满足，见 R01。 |
| 仅凭图表判断本次依赖变化 | 部分满足；38／39 条的 S09 取舍仍开放。 |
| 先讨论、确认后落盘；原轮次是否只改获准文件 | 无法仅由当前产物核实。没有据此认定过程违规。 |

AgentLifecycle 尚无代码、候选接口尚未冻结、`needs_material` 后续协议尚待接口设计、迁移／删除／回滚留给 Prompt 6、金额效果尚待测量，都有明确的后续阶段。本报告没有把这些正常的阶段边界计作缺陷。R02 特指已被模块文档明确交给 Prompt 4 的依赖决定。

## 6. 产物引用的路径存在性核对

以下为本次结论使用的关键路径核验，不声称逐一验证了全文所有简写和历史行号。

| 路径组 | 状态 |
| --- | --- |
| `docs/refactor/module-dag.md`、`docs/refactor/ARCHITECTURE.md`、`docs/history/before-2026-09-22/PRODUCT.md` | 存在，已读取。 |
| `docs/refactor/modules/ownership-map.md` 及 13 篇模块稿 | 存在，已交叉核对相关责任和接口。 |
| `docs/history/before-2026-09-22/agent-platform-user-replies-numbered.md`、`docs/history/before-2026-09-22/agent-platform-open-decisions-recommendations.md` | 存在；用以确认最新人类意见。 |
| `docs/history/before-2026-09-22/agent-platform-architecture-review.md`、两版 `agent-platform-decision-recommendations*.md`、`docs/history/before-2026-09-22/agent-vs-agent-team.md` | 存在；按日期和是否被采纳区分证据地位。 |
| `coding-platform/scripts/module-map.mjs`、`check-module-boundaries.mjs`、`tests/contracts/module-ownership.test.ts` | 存在，已读实际检查逻辑。 |
| `coding-platform/src/control/agent-lifecycle/` | 不存在；产物已正确标为规划目录，不作为失效引用报错。 |
| `contracts/agent-lifecycle.ts` 候选路径 | 尚无对应实现；产物已标设计新增、未冻结。 |

## 7. 需要明确的事项与修订顺序

1. 先明确 S09 的 owner 和是否新增边，承接 S02 的 Control 公共窄面；这是目标分工的完成条件，不是重新征询已关闭的产品决定。
2. 修正图查询、责任关联、事实读取与授权链路的接口映射，确保每项都能追到实际提供模块。
3. 补齐新增模块注册和测试清单，再修正现状调用方、签名与授权候选措辞。
4. 复核修改后的图、正反向表、允许依赖变化和拓扑一致性。无需推倒 13 模块设计。

如果原 Prompt 4 任务有明确批准“仅交候选稿并延期 S09”的记录，R02 应改记为获准延期项；当前文件本身未提供该依据。其余两项由当前产物与接口／源码直接对照即可确认。
