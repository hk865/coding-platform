# Prompt 6 前：架构、模块与 DAG 漂移审阅

> 历史评审说明：本文保留对旧方案的评审结论，架构、DAG 和模块引用固定到 [2026-09-23 迁移前快照](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/README.md)；当前方案见 [架构入口](/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md)。

日期：2026-09-22。审阅范围：当前 `docs/refactor/ARCHITECTURE.md`、13 篇模块稿及 README／ownership-map／质量要求、`module-dag.md`，对照 `docs/history/before-2026-09-22/PRODUCT.md`、最新人类意见及 Prompt 6 的实际输入清单。

性质：文档审阅；未修改上位设计、模块稿、DAG、提示词或产品代码。本文不代表已经完成整改。

## 1. 判断

**存在局部职责、接口语义和阶段交接漂移，建议修订这些文档后再执行原 Prompt 6。整体模块划分与已定生命周期方向不需要推翻。**

机械核对结果：13 个模块，架构 Mermaid 38 条边、DAG Mermaid 38 条边、模块 §3 正向表 38 条边、模块 §4 反向表 38 条边，四组集合差异均为空，DFS 检查无环。这只能证明声明一致，不能证明某条边真的提供链路表所写的功能。

本次确认的主要问题如下。P2 表示会误导职责分配、依赖或迁移计划，应在 Prompt 6 输入收口时修正；不要求先完成相应源码实现。

| 编号 | 问题 | 位置 | 对 Prompt 6 的影响 |
| --- | --- | --- | --- |
| D01 | 新旧目标文档混用，旧决定可能重新进入计划 | Prompt 6 输入清单 | 可能恢复旧 Agent 身份模型、遗漏新模块和修订后的接口范围 |
| D02 | 把重复取材的替代职责交给 AgentLifecycle | 架构 U1 摘要 | 把材料编译迁入错误模块 |
| D03 | 把全工作区快照／查询 currentness 改造交给 Control | Control 模块职责 | 给只依赖 Ledger 的模块安排来源读取改造 |
| D04 | DAG 场景链使用了功能不符的边 | DAG §7.3／§7.4 | 图查询、关联写入、授权候选和事实权威混接 |
| D05 | S09 应在 Prompt 4 决定却被后置，验收又固定 38 条边 | ownership-map、DAG、Dispatch §9 | 合法共享方案无法成为明确的计划前提 |
| D06 | 已定 Control 政策 owner 被重新列成开放二选一 | ownership-map、Control、DAG U3 | 可能错误下移业务政策或删掉仍必要的依赖 |
| D07 | “不经过 Context 模块”与保留其按需读取接口冲突 | 架构 §6.2.1、Context 模块 | 将不重编译误解成迁出读取接口或切依赖 |
| D08 | 新模块机械同步清单不完整 | 架构、AgentLifecycle、DAG | 新模块可能未被依赖检查器识别，测试清单漏更新 |
| D09 | 已接入的独立审查／租约端口未列入双方对接表 | Control、Verification、Dispatch | 按表生成迁移清单可能遗漏正式审查与租约接线 |
| D10 | 两张图支撑生命周期决策的接口承接未完成 | AgentLifecycle、ReadModelIndex 及关联写入方 | Prompt 3 尚未把产品原则落实为提供／消费关系，不能推给 Prompt 6 补设计 |

## 2. 需要在 Prompt 6 前统一的事项

### D01 · P2 · Prompt 6 混用本轮目标与旧目标

**证据：** [提示词:600](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:600)把旧文档仓的架构和模块目录列为“已确认输入”；第 626–637 行再次逐篇列出旧 12 模块；第 616 行又列本轮架构，没有说明冲突时的优先级。第 604／619 行指定旧 `decision/02 §9` 为接口变更依据。

这不是单纯多给了背景资料：旧 [decision/02:298](/home/hyh001/projects/coding-platform/my-coding-platform-docs/agent_platform/dev_docs/decision/02-investigation-and-conclusion.md:298)、第 312 行要求稳定 Agent 身份和工作经历；本轮 [ARCHITECTURE:892](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:892)、第 1224 行已改为轻量运行实例、不要求首版跨任务长期主体。旧第 303 行声称 12 个模块接口无一可原样保留；新架构第 898 行已纠正覆盖范围并要求保留兼容接口。

**最小修订：** 把本轮 PRODUCT、ARCHITECTURE、13 篇模块、ownership-map、质量要求和修正后的 DAG 明确列为目标输入；旧文档仓仅作现状、历史与迁移对照。接口 I／A 项采用本轮架构 §7.1／§7.2 的修订。源码分析按日期作为线索，允许当前源码与后续复核修正旧现状结论。同步删除[第 655 行](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:655)“DAG 尚不存在”的过时声明。

无需提前回填旧文档仓，也不需要重新征询已经明确的产品决定。

### D02 · P2 · 架构 U1 把取材迁移错误指向生命周期模块

**冲突双方：** [ARCHITECTURE:1214](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1214)写“旧的重复选择、重复身份推导与重复取材路径由它替代”，“它”指 AgentLifecycle；但同文[第 658 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:658)明确 AgentLifecycle 不取材、不组装 ContextBundle、不产出 selectedRefs／gaps／manifest。

[最新已决意见:79](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-open-decisions-recommendations.md:79)要求重复路径迁出或删除，没有要求全部迁进 AgentLifecycle；同文第 175 行仍把有界整理交给 ContextCompiler。AgentLifecycle 模块稿[第 20 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:20)已经更准确地区分生命周期选择和正式守卫。

**最小修订：** 生命周期选择归 AgentLifecycle；重复取材在 ContextCompiler 内共用并退役旧副本；正式身份登记、角色绑定守卫与最终提交复核保留原 owner。不能把“重构要去掉重复”改写成“重复都交新模块”。

### D03 · P2 · Control 被安排了自己禁止承担的来源读取改造

**冲突双方：** [control-engine:27](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:27)把 `run-facts` Delivery 扫描、状态查询 currentness 和全工作区快照一起列为“本模块承担”。同文第 46／54 行又明确不做材料来源适用性检查、不读源码，第 84 行只允许 Control→StateLedger。

上位 [ARCHITECTURE:1111](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1111)列的是跨模块成本链，没有把三项都交给 Control。[WorkspaceReader:115](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/workspace-reader.md:115)已有来源捕获优化方向；当前 `QuerySourceContextCompiler.currentness`、`QueryWorkspaceSourceReader` 也各有真实 owner。

**最小修订：** Control 负责准入关联与 canonical 事实的精确读取；Context 负责查询材料适用性编排；Reader 负责源码捕获／多页复用；ReadModel 与 Host 负责展示查询和触发方式；Vault／Runtime 分担必要观察的存储与接线。以真实调用链分配改造，不为错误分工新增 Control→Reader 边。

另需沿用最近源码复核的频率：日常 overview 已跳过工作区 currentness，仍有账本视图重建和运行正文复制。详见[性能补充审阅](lifecycle-performance-followup.md)。不要将旧现状措辞当成每轮必然发生的验收基线。

### D04 · P2 · DAG 数学正确，场景链的边语义仍错位

**错误位置：** [module-dag:440](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:440)至第 450 行。

| 场景表当前写法 | 实际端口语义／模块约束 | 应改方向 |
| --- | --- | --- |
| 图检索使用 #35 | #35 是 Vault→ReadModel 的材料授权候选发现 | 图邻域读取经 Human／Context→ReadModel 的图查询面 |
| 模块负责人查询使用 #38 | #38 是 ReadModel→Control 的政策解释与身份纯归并 | 负责人关联经 ReadModel 对应投影查询；不能把政策解释当角色目录 |
| 关联写入经 #21 | #21 是 Reconciler→Control；[Reconciler:105](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/architecture-reconciler.md:105)明确不写、不读此类关联 | 按普通 Control 记录路径登记实际调用者，不交给 Reconciler |
| #22 标“事实权威”，#35 标“授权适用性” | #22 是 Reconciler→Context 取材；#35 只发现候选，最终授权判定在 Vault | 分开事实来源、材料组织、候选发现和权威判定 |

对照：[ReadModel:57](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:57)、[第 73 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:73)、[Vault:69](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:69)。这延续了上次审阅 R01，当前仍未修正。

### D05 · P2 · S09 延期与固定边数验收互相锁死

**阶段交接冲突：** [ownership-map:337](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/ownership-map.md:337)要求 Prompt 4 在 Reader 公共政策面与共享协议值之间作取舍，允许后置的是精确类型、装配和删除顺序；[DAG:510](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:510)、第 519 行却明确“本轮不定，保持 38 条”。

**新增验收冲突：** [Dispatch:179](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:179)要求“保持 13 模块／38 边目标”；但 [ARCHITECTURE:847](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:847)、第 1138 行及[最新已决意见:85](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-open-decisions-recommendations.md:85)都说明计数不是优化目标。DAG 第 515 行自身就列出合法的第 39 条边候选。

**最小修订：** 完成 S09 的工程分工选择并说明语义依据，再同步架构、Reader／Verification／Runtime 模块及 DAG。将验收改为“符合最终确定的依赖集合、接口与 owner，全部图表和检查清单同步”，不是强保 38。架构第 1114 行等“除四条之外一概不新增”的表述也需限定范围，避免覆盖经理由成立的共享政策调整。

不能用 Host 注入掩盖逻辑依赖，不能为省一条边把整个访问政策塞进 Contracts。此项需要工程裁定，不自动等于需要人重新选择产品方向。

### D06 · P2 · DAG U3 重新悬置已经明确的政策 owner

**冲突双方：** [ownership-map:317](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/ownership-map.md:317)的 S02 已指定 Control 公共窄面，业务政策不得因是纯函数就下移；[Control:72](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:72)亦保留该 owner。但 [DAG:537](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:537)仍把“下移纯计算后删除 ReadModel→Control”列为开放选择。

**最小修订：** 承接 S02 的政策归属，Prompt 6 安排公开窄面与消费者迁移。无业务权威的机械原语可以另行共用，但单个 helper 下移不能成为删除整条政策依赖的依据；若确需改变 owner，须重新分析该边的全部消费者并同步各文档。

### D07 · P2 · “绕过重编译”被写成“绕过整个模块”

**冲突双方：** [ARCHITECTURE:746](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:746)／第 755／761 行，以及 [Context:48](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/context-compiler.md:48)／第 55 行，把 `read_query_fact` 写成“不经过 ContextCompiler”；同模块[第 74 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/context-compiler.md:74)、第 95／136 行却明确保留 owner=ContextCompiler 的 `QueryExecutionMaterialPort.readFact` 供 Runtime 调用。

当前源码也确实保留这条模块调用：[Query 编译器:26](/home/hyh001/projects/coding-platform/coding-platform/src/data/context-compiler/query-execution-context.ts:26)提供 readFact，[只读运行:150](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/read-only-query-runtime.ts:150)调用它。进一步沿实现核对：readFact 第 31 行每次调用自身 assemble，重读 QueryRun／QueryJob、重开已捕获 bundle 并复核授权、读取当前偏好、重组完整查询输入，再核对摘要与提取位置。因此不能把窄读取接口的用途描述成“内部没有重新组装”。它没有调用上游 assembleQueryContext，也不因此重新扫描源码或重捕获工作区；应准确区分重新组装查询输入与重新发现／选取全套来源材料。

**最小修订：** 目标边界明确“不因读取一个事实而重新发现来源、选择整套材料或重建 Session 上下文”，允许经已有窄读接口取事实；普通消息和成功恢复不应进入全量编译。计划同时登记 readFact 内部重复组装查询输入的现状，将必要的身份、授权、偏好版本与输入摘要检查和可复用的已解析捕获材料分开；不以跳过检查换取缓存命中。不能只改标题就声称实现已经轻量化，也不应据此切 Runtime→Context 边或迁出既定读取 owner。

### D08 · P2 · 机械检查同步清单在三层文档均有漏项

[ARCHITECTURE:694](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:694)、[AgentLifecycle:171](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:171)、[DAG:397](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/module-dag.md:397)没有完整列出新模块注册要求。

除 moduleDirs、allowedModuleDependencies、测试 MODULE_DIRS 外，还必须包含：

- [module-map.mjs:3](/home/hyh001/projects/coding-platform/coding-platform/scripts/module-map.mjs:3)的 `modules`；检查器[第 23 行](/home/hyh001/projects/coding-platform/coding-platform/scripts/check-module-boundaries.mjs:23)依赖它识别两端模块，漏更新会过滤新模块的越界依赖。
- [module-ownership.test.ts:86](/home/hyh001/projects/coding-platform/coding-platform/tests/contracts/module-ownership.test.ts:86)的模块数量断言。
- 同测试[第 154 行](/home/hyh001/projects/coding-platform/coding-platform/tests/contracts/module-ownership.test.ts:154)的 `MODULE_FILE_INVENTORY` 键与实际文件清单。

应先补齐文档迁移清单，实际源码更新随实施阶段执行。当前 12 模块检查通过不能验证尚不存在的新模块。这延续上次 R03，并确认了上游同样缺项。

### D09 · P2 · 独立审查与租约的真实契约清单不完整

[Control:68](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:68)及其第 100–101 行、[Verification:85](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/verification-engine.md:85)、[Dispatch:100](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:100)的提供／消费表没有列出 `ReviewLifecycleControlPort`、`ReviewDispatchControlPort`；Verification 的 Control 消费面也漏记了 `WorkspaceLeasePort`，尽管模块正文已有独占租约要求。

这些不是待设计的名称：[reviewer-work 契约:63](/home/hyh001/projects/coding-platform/coding-platform/src/contracts/reviewer-work.ts:63)定义创建／替换 ReviewWork、受理正式结果以及绑定输出；[service:245](/home/hyh001/projects/coding-platform/coding-platform/src/app/service.ts:245)将两组端口分别接到 Dispatch 和 Verification；[persistent-platform:611](/home/hyh001/projects/coding-platform/coding-platform/src/composition/persistent-platform.ts:611)将租约端口转给 Control。

**最小修订：** 在三模块的双向表补齐已接端口、消费者和输入输出；DAG 对应 Control 边的传递内容同步引用。此项属于现状契约覆盖缺口，不代表要新增功能或依赖边，但应在按表拆迁移任务前补齐。

### D10 · P2 · 两图与生命周期的联系属于 Prompt 3 未完成项

**阶段归属更正：** 本审阅此前将这项归为“后续契约承接”，并建议在 Prompt 6 中安排接线，范围划分不准确。[Prompt 3:375](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:375)已要求对外接口写清“接口名＋方向＋传递内容”，依赖与被依赖双方明确所消费的接口；两图如何支持生命周期选择属于这一阶段必须完成的模块设计。

**当前缺口：** [AgentLifecycle:25](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:25)要求两图显示相关时默认延续，但第 76／100 行仅概括候选 Session、忙闲、任务与角色视图，没有明确两图关系如何进入选择请求或查询结果。[ReadModelIndex:57](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:57)的图邻域候选接口只列 Human／Context 消费；第 58 行供 Lifecycle 的卡片接口也没有写出任务↔模块↔Session 关联及其来源。因此原则已存在，提供方和消费方尚未把同一条能力对接清楚。

**Prompt 3 应补齐：** 两图分别提供哪些相关性／未完成工作依据；这些内容由哪个已有或目标接口交给 Lifecycle；Lifecycle 输出哪些选择及理由给 Dispatch；正式关联由谁登记、由谁查询展示；关系缺失、过期或不可用时怎样返回并影响决策。可以由图查询面提供，也可以由 Session 候选查询聚合必要关系，但模块稿必须选定并在双方表中一致表达，不能留给计划生成者自行猜测。

本项不要求现在实现源码，也不要求借机增加模块或依赖边。精确 wire 字段与类型的后续细化，不能成为推迟上述职责和接口内容的理由。Prompt 4 随后检查相应边的语义，Prompt 6 只安排已经明确的设计如何实施。

## 3. 非阻塞的摘要残留与表述歧义

| 项目 | 对照与问题 | 最小清理 |
| --- | --- | --- |
| 接口变更范围被摘要夸大 | [ARCHITECTURE:29](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:29)仍写“12 个既有 Module 接口全部需要变化，无一可原样保留”；同文[第 898 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:898)已解释 I1–I12 是 11 个模块＋领域类型，并保留兼容方法、用 I-补覆盖 Reader | 摘要改成各模块均有演进项，不等于每个方法都改签名；本轮模块 README 已有正确口径 |
| 按需正文读取是否更新初始化 manifest | [ARCHITECTURE:821](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:821)要求按需读取与缺口写 manifest；第 823–828 行又区分初始化清单和 Kernel 实际读取记录；[Verification:142](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/verification-engine.md:142)也沿用了旧句 | 两处一起消歧：仅本次初始化编译的消费写初始化 manifest；运行中读取走 Kernel 记录及引用，不新增逐次 Compiler 回调 |
| 归档条件的架构摘要不全 | [ARCHITECTURE:372](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:372)／第 384 行未带入 [PRODUCT:317](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:317)的“无未交接活跃义务”；AL 与 Control 模块第 26 行已经完整承接 | 上位摘要补齐即可；不能据此说模块允许带未交接义务归档 |
| 显式压缩的产品限制未在摘要醒目标注 | 架构第 383／511／1221 行只列容量与历史价值判据；[PRODUCT:326](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:326)、第 659／804 行规定首版显式压缩、不做自动压缩调优 | 区分平台显式处置与直接使用 Kernel 已有有效压缩；目前没有证据说明已经设计了后台自动调优器 |
| 现状调用者与计划接线混写 | [Human:94](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:94)及 DAG 第 159 行写 requestInitial／accept(resultRef)；当前 Human 只消费 request，另两项由 Host 调用；真实 accept 接收 trigger | 分开现状调用方和目标扩展，恢复真实签名；具体证据见上次 [R01–R03 审阅](module-dag-review.md)的较小修正部分 |

以上可以随主要修订一起清理，不必单独增加一轮产品决定或实现工作。

## 4. 没有发现方向漂移、可以继续承接的部分

- **生命周期复用方向**：产品→架构→AgentLifecycle 一致要求相关工作默认延续、同角色可以有独立 Session；没有重新要求一工作一新 Session。
- **轻量身份**：不要求跨任务长期 Agent 主体；workId 是否保留按连续性与消费者判断；四态属于 Session／工作卡片，不强塞旧 AgentInstanceStatus。
- **Kernel 分工**：执行、停止、日志、检查点、压缩和恢复由 Kernel 实现；平台维护自己的关联、正式状态和展示。没有实质恢复通用外部副作用对账或逐工具停机复查系统。
- **日志去重目标**：[WorkerRuntime:161](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/execution/worker-runtime.md:161)与 ownership-map S08 已要求先迁移 Kernel 正文消费者，再增量保存必要的平台观察，并禁止把整段副本改成分条副本；不能仅凭 Vault 的“增量落盘”措辞判为要求继续双份正文。
- **材料边界**：推荐阅读范围不是硬白名单；未恢复逐条材料授权新系统，也未恢复每轮继承历史复核门禁。D07 是调用范围表述需要精确，不是这条产品方向改变。
- **两张图**：结构权威、日常关联、可重建查询投影总体分开；讨论关系未混成阻塞依赖环。D04 是具体链路登记错误。
- **审查与正式事实**：Reviewer 隔离、Control 唯一归约、Ledger 原子提交、Vault 授权判定的主分工保持一致。
- **模块 §9 的多数质量要求**：职责减负、同义规则共用、旧路径退役、可读性与功能保真都有承接。D05 的固定数字条款是局部例外，不需要撤销整套质量要求。

## 5. 不应误报成漂移的待办

候选 Port 的字段、Session 物理承载、迁移步骤、Kernel 接线、新查询与 UI 尚未实现，均已有明确待设计／待实现标记。它们应成为 Prompt 6 的工作与依赖，不能因为现在没代码就判定设计违约。

两图与生命周期之间尚未写清的提供／消费关系另列为 D10，属于 Prompt 3 的设计缺口，不再归入本节的合法后续待办。具体字段编码与源码接线可以后续完成，接口的方向、必要内容与 owner 必须先在模块文档中说明。

先前确认的日志、账本扫描和分页开销多数属于“已识别目标尚未落实”；文档审阅中真正要先处理的是 D03 的错误归属及旧事实频率。最新性能清单可作为计划线索，不必先解决全部性能代码才能制定计划。

## 6. 进入 Prompt 6 的建议顺序

1. 修正 D02／D03／D07 的职责和调用边界，补齐 D10 的两图与生命周期接口承接，清理相应摘要残留。
2. 完成 S09 的分工选择，承接 S02，修正 DAG 场景链及固定边数要求。
3. 补齐新增模块机械同步清单，重新核对所有模块的正反向依赖、DAG 与拓扑。
4. 更新 Prompt 6 的目标输入与冲突优先级，旧规范明确降为现状／历史参考。
5. 再由 Prompt 6 产出分阶段计划、接口前置任务、消费者迁移、旧路径删除点及验收安排。

这些是已确认方向下的文档与工程收口；无需重跑全部 Prompt 2–4，也无需把已关闭的产品事项重新交给人决策。验收以可读性、重复职责及有效代码量变化、UI 前后行为为主；性能相关项按读写／扫描工作量核验，未测项如实标明，不扩大成无关的模型评测工程。
