# ARCHITECTURE 作为 Prompt 2 产物的复核

> 历史评审说明：本文保留对旧方案的评审结论，架构、DAG 和模块引用固定到 [2026-09-23 迁移前快照](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/README.md)；当前方案见 [架构入口](/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md)。

审阅日期：2026-09-22；已按随后四条用户批注修订。范围：当前架构稿与 Prompt 2 的交付要求、PRODUCT 及最新人类意见的对应关系。此次只维护审阅记录，不修改架构、模块文档或源码。

## 结论与阶段边界

架构稿的章节与主体方向基本齐全，但仍需修正生命周期条件和内部口径。下文保留 A01–A05 编号以便追溯，不再把五项全部视为同等的 Prompt 2 缺项：A02 指当前职责表述没有一致表达选定方案，不代表禁止 Lifecycle 消费或内聚上下文能力；A04 的具体接口清单归 Prompt 3；A05 按用户最新意见保留当前 13 模块、38 条边方案，具体依赖按实际需要核对。

[Prompt 2:277](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:277)要求生命周期的进入／退出条件、两图的高层机制、模块边界及接口演进方向；[Prompt 3:375](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:375)再将其落实为接口名、方向、传递内容和双方依赖。这两层不能互相代替，也不应推给 Prompt 6 的实施计划。

“没有待人决定的产品问题”不等于“架构没有未完成的工程设计”。下面的问题不需要把已经确认的产品方向重新交给人表决。

## A01 · 生命周期动作条件弱化了已确认的产品规则

**证据：**

- [架构:382](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:382)把拆解的进入条件写为“目标确认且任务图生成后”，并把缺少数值阈值归为接口参数。但[产品:315](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:315)已经规定：存在可独立调查或交付的子任务，接口和完成依据可说明；父任务继续承担汇总义务，子任务有负责人、依赖和结果回流路径。
- [架构:372](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:372)及第 384 行的归档条件只有退出日常使用与显式操作，漏掉[产品:317](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:317)的“没有未交接的活跃义务”。

**影响：** 目标已经确认，并不意味着应当拆解；显式点归档，也不能替代对未交接义务的处理。下游若只根据矩阵设计，会得到不同的许可条件。

**Prompt 2 应修正：** 将产品已有的语义条件写回动作矩阵，明确 PlanCompiler／AgentLifecycle／ControlEngine 各自提案、选择和守卫的责任。这里不需要发明数值阈值，也不需要等待精确字段设计。

此前跨文档审阅将归档条件列为非阻塞摘要问题，是因为 AgentLifecycle／Control 模块已承接该条件；这不等于架构矩阵自身已满足 Prompt 2 的逐格要求，也不代表现有模块允许带未交接义务归档。

## A02 · AgentLifecycle 被同时要求“不取材”和“替代取材路径”

[架构:658](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:658)明确生命周期模块不取材、不组装 ContextBundle、不产生 selectedRefs／gaps／manifest；但[U1:1214](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1214)又要求旧的重复选择、身份推导与重复取材“由它替代”。

[最新意见:79](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-open-decisions-recommendations.md:79)要求迁出或删除重复职责，没有要求把这些职责全部装入同一个模块。

**影响：** 一个下游实现可以据 §6 保持边界，另一个可以据“已关闭决定”把材料编译搬入 Lifecycle；架构无法提供唯一答案。

**按用户批注修正判断：** 如果目标设计由 AgentLifecycle 消费 ContextCompiler，把“何时准备、为哪个 Session 准备、如何使用编译结果”的流程迁入 Lifecycle 是可行方案。调用下游编译能力不等于在 Lifecycle 内复制编译实现；若相关能力最终只服务生命周期且没有独立职责边界，也可以评估将相应实现内聚，而不是把当前模块切分当成永久约束。

当前[ContextCompiler 消费者表](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/context-compiler.md:125)仍包含 HumanCollaboration、PlanCompiler、DispatchEngine、WorkerRuntime、VerificationEngine、ArchitectureReconciler；[Lifecycle 依赖表](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:92)没有 ContextCompiler。因此“Lifecycle 已是统一消费者”不是当前文档事实。应在架构层一致表达最终责任与调用方向，由 Prompt 3 落实具体消费面及迁移；本次批注是对可行方案的说明，不自动视为已经批准整体合并模块。

## A03 · 将“不重复编译”写成“不经过 ContextCompiler 模块”

[架构:746](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:746)把按需事实读取列为不经过 ContextCompiler 的路径，第 755 行还以现有 `read_query_fact` 为代码依据。

实际调用是 [WorkerRuntime:151](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/read-only-query-runtime.ts:151)调用材料端口的 `readFact`；实现属于 ContextCompiler，并在[第 31 行](/home/hyh001/projects/coding-platform/coding-platform/src/data/context-compiler/query-execution-context.ts:31)再次调用 `assemble(request)`。它重读 QueryRun／QueryJob、打开已捕获 bundle、读取适用偏好并组装查询输入；这不等于重新捕获整个工作区或重新执行上游全部选材。

**影响：** 将提供方模块、上下文编译操作、局部事实读取混为一谈，既会误判现状已经消除了重复工作，也可能诱导下游为“绕过模块”而错误迁移职责。

**Prompt 2 应修正：** 明确目标是日常消息不触发重新选材，按需事实读取可经既有窄接口消费已捕获材料；把当前重复组装列为待优化的调用路径。保留必要的授权、状态和版本核对，不因优化取消它们。不需要仅为此删除 Runtime→ContextCompiler 的依赖。

## A04 · 架构保留方向，具体不变接口清单归 Prompt 3

[架构:29](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:29)称 12 个既有 Module 接口无一可原样保留；[第 898 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:898)已经纠正为 I1–I12 覆盖 11 个模块加领域类型，通用存储方法和兼容查询接口应保留；但[第 915 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:915)又把所有模块接口签名排除在不变清单之外。

原 [Prompt 2:288](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:288)确实写了列出不变接口，但用户本轮进一步明确：各模块具体接口是否保留、扩展或替换，应由 Prompt 3 完成。以本次阶段划分为准，撤回将缺少逐项接口清单作为 Prompt 2 实质未交付项的判断。

**阶段分工：** Prompt 2 写职责边界、演进与兼容方向，消除“所有模块接口无一可原样保留”等过强表述；Prompt 3 在各模块中按真实接口列“原样保留／兼容扩展／替换或删除”、消费者及迁移方向。不需要架构稿再维护一份同粒度的方法清单。

## A05 · 局部最小改动范围被写成了模块与边数限制

[架构:1114](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1114)将除 AgentLifecycle 之外新增模块、除四条之外新增依赖列为“明确不做”；但[第 847 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:847)又要求按真实消费者重新检查边界，并声明 38 条不是目标。[Prompt 2:302](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:302)明确撤销“不新增 Module／不改 Module DAG”的前提。

**影响：** §9.2 本来讨论 ContextCompiler 收窄的最小范围，却容易被后续模块设计读成全局禁令，使真实依赖为既定图形让路。

**用户本轮收口：** 当前 13 个模块、38 条边方案可以继续采用，具体依赖看实际需要。此项只需澄清“本节交互无需额外依赖”与全局禁令的区别，不据此另起一轮模块重划，也不要求为了重构而增删边。Prompt 3 写清实际消费者，Prompt 4 核对依赖并在必要时同步架构；撤回的材料准入机制不因此恢复。

## 两处建议一并清理

1. [架构:561](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:561)以“单独立模块会把投影升级成真相源”论证不设任务图模块，推理不成立。现有 ReadModelIndex 就是独立模块，却只提供已提交事实的投影与查询。独立图模块也可以读 PlanRevision／ArchitectureBaseline／账本并保留来源版本，变更仍经既有接受流程。只有图自行改变正式任务依赖供调度执行、覆盖有效架构规范，或把展示标签直接当成完成事实，才会制造冲突权威；有独立目录、接口、索引表或持久关联本身不会。当前仍保留首版不新建图模块的决定，以已有职责足以承接、避免重复建设作为依据。
2. [架构:1278](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1278)之后的验收表把有关项目全部标为通过，但仍有上述文内冲突。应区分章节覆盖、责任一致、接口已对接、代码已实现，而不是以“已关闭产品决定”代表每层都已完成。[产品:326](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:326)的首版显式压缩约束也应在动作表中补明；这只是补全限制，不据此断言架构已经设计了后台自动调优器。

## 不应误报为 Prompt 2 失败的部分

- 两张图已有生成与版本化（§5.1–5.2）、检索链（§5.3）、反向编排规则（§5.4）、权威划分（§5.5）；[第 451 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:451)、第 515／521／647 行已经将图上的工作相关性与 Session 选择联系起来。不能说架构完全没有建立这种联系。
- 两图关系通过哪个查询接口进入 Lifecycle、双方传递内容及不可用分支仍未对接，是[既有审阅 D10](/home/hyh001/projects/coding-platform/docs/refactor/reviews/pre-prompt6-drift-review.md:115)指出的 Prompt 3 遗漏。Prompt 4 核对依赖，Prompt 6 安排实施。
- 当前文档 DAG 的 13 个模块、38 条边无环；这证明拓扑合法，不证明接口语义完整，也不是要求维持的数量指标。
- Kernel 负责实际执行、暂停、日志、压缩与恢复；平台负责自身调度、关系与正式事实。这条分工不需推翻。
- 精确字段、存储 schema、Kernel 接线和源码尚未实现，不直接构成 Prompt 2 违约。

修订顺序：先在架构稿中消除规则与职责表述冲突；具体保留或变化的接口、双向消费表由 Prompt 3 完成，Prompt 4 核对实际依赖。保持当前 13 模块、38 条边作为方案起点，必要依赖按情况处理；Prompt 6 使用已明确的设计安排迁移。
