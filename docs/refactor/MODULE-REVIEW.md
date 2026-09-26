# 模块分工详细审查报告

> 历史评审说明：本文保留对旧方案的评审结论，架构、DAG 和模块引用固定到 [2026-09-23 迁移前快照](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/README.md)；当前方案见 [架构入口](/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md)。

审查日期：2026-09-21。审查对象：`docs/refactor/modules/` 的 13 篇模块文档、README 与 ownership-map。本文是审查结果，不替代架构决策或接口契约；本次未修改被审查文档和源码。

## 1. 结论与阅读方式

**整体模块划分与架构方向相符，但现稿还不能直接作为无歧义的接口设计输入。** 模块数量、分层和依赖表基本对齐；主要缺陷在于同一规则在不同章节发生冲突、端口的提供者与消费者混写，以及产品要求没有完整分配到跨模块流程。

合并前两轮发现并经逐模块复核后，本文列出 **21 项实质问题（P1 两项、P2 十九项），另有 4 项 P3 文档修订**。这些是去重后的审查项，不是 25 个已证实的运行时故障。其中 F17–F21 是本轮继续核对确认的问题；前两轮部分表述已降级或收窄，见第 7 节。

- **P1**：遗漏产品硬约束，按当前分工继续实现可能造成未经确认的计划生效，或旧工作在目标变更后继续推进。
- **P2**：职责、接口、状态口径冲突，或明确要求未下沉到模块交接；应在接口定稿前修正。
- **P3**：局部事实、术语或统计错误；已有其他章节提供正确方向，暂不据此推断整条能力缺失。

每项都区分“文档写错”“责任交接不完整”和“实现欠账”。代码只用于核实文档声称的现状，不因代码尚未完成目标设计就直接判定分工错误。

## 2. 依据、优先级与核对范围

| 依据 | 本次使用方式 |
| --- | --- |
| [用户回复原文与编号](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-user-replies-numbered.md) | 优先理解人的明确意见；01–14 是原话段落编号。疑问和条件性意见不自动视为批准。 |
| [最新未决项建议与回应整理](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-open-decisions-recommendations.md) | 使用 2026-09-21 收口口径；结合原话判断，不能把所有建议都当作人的决定。 |
| [PRODUCT.md](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md) | 核对方案确认、目标变更、人类介入、任务责任和归档等产品约束。 |
| [ARCHITECTURE.md](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md) | 核对 13 模块、依赖图、生命周期、两张图、记录归属、接口演进和必须先改的成本链。 |
| [修订建议](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-decision-recommendations-revised.md)、[早期建议](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-decision-recommendations.md)、[早期架构审查](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-architecture-review.md) | 历史背景；已被较新回复撤回的要求不重新引入。 |
| [modules/ownership-map.md](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/ownership-map.md)、各模块文档及相关源码 | 检查总表与局部文档是否一致，抽查真实端口和身份约束。 |

同名“副本”不作为另一份并列权威。研究文件的建议也不自动升级为产品要求。本次没有要求新增长期 Agent 主体、逐轮历史材料准入、独立问答模块、技能市场或通用恢复治理平台。

核对方式：主审负责上位要求与跨模块闭合；三个子 agent 分别逐篇核对 Control 四模块、Data 五模块、其余四模块，再合并交叉复核。机械核对依赖表，语义核对接口方向、事实权威、正常与失败路径。未运行产品测试，未做全量源码行为审计。

## 3. 逐模块核对结果

表中“符合”仅指注明的分工原则，不表示对应能力已经实现。

| 模块 | 已确认符合的部分 | 需要修正 | 总评 |
| --- | --- | --- | --- |
| HumanCollaboration | 人的统一入口、正式回执、图检索直读投影、解释与修订分离、具体版本确认 | F01、F02、F10、F14、F15 | 产品入口方向正确；动作交接与查询副作用未完全闭合。 |
| PlanCompiler | 有界规划、提案与受理分离、材料不足显式返回 | F01、F02、F05 | 初始旧路径与新确认要求冲突；工作包责任需要落到输出约束。 |
| ControlEngine | 唯一正式事实归约、守卫、CAS、幂等与治理激活 | F02、F04、F06、F09、F12、F13、F17；M01 | 权威落点正确，但内部描述与跨模块守卫仍有冲突。 |
| DispatchEngine | outbox 与副作用顺序、运行准入、租约、运行事实回流 | F02、F03、F04、F09、F10、F15、F18、F19 | 主要问题是旧流程未限定适用范围，身份阶段和归档责任混写。 |
| VerificationEngine | 证据资格、完成归约分离、只读 reviewer、失败证据保留 | F04、F08、F20 | 验证职责成立；依赖说明授予了不应笼统归入的端口。 |
| ArchitectureReconciler | 初次建立与后续演进分开、无基线可工作、未知关系保留 | F09、F20、F21 | 生产候选与决策激活的边界需要写准；容量失败恢复不可按现文调用。 |
| AgentLifecycle | 决策与提案，不直接写正式状态，不直接调用 Runtime | F04、F12、F19 | 新模块必要性与位置成立；归档前提未完整承接。 |
| WorkerRuntime | Kernel 承担压缩和恢复，平台做适配；能力缺失显式返回 | F09、F13、F15（配合澄清） | 未发现独立于既有欠账的新增重大分工问题。 |
| StateLedger | 原子保存、CAS、幂等、不做业务归约、旧身份不删不选赢家 | F03、F07、F17（对端同步）；M02 | 核心边界正确；需修正局部 schema 表述并同步对端。 |
| ArtifactVault | 正文持久化、授权适用性复核、Kernel 内容保留引用 | F07、F09、F11、F13 | 错列提交接口；资产生命周期和日志成本责任需补齐。 |
| ReadModelIndex | 可重建、只读、游标、新旧查询面共存、普通关联不治理化 | F09、F16；M03 | 投影原则正确；任务图协作关系未落到扩展职责。 |
| ContextCompiler | 五类触发、连续消息可绕过、材料编译、三种记录分别归属 | F03、F09；F04 以本页正确口径同步他页 | 本页主要目标正确，不应因他页误写而扩大其职责。 |
| WorkspaceReader | 只读捕获、不反向依赖 Vault/Ledger、一次捕获多页读、新建目录不在本模块 | 无新增独立实质问题；F09 统一状态表口径时检查本页 | 已登记的真实图来源与映射欠账继续保留即可。 |
| README / ownership-map | 13 模块与总依赖图一致；三种记录总表方向正确 | F01–F05、F09–F13、F16、F19–F21 对应总表同步；M04 | 结构校验通过不代表端口和流程语义校验通过。 |

## 4. 实质问题

### F01 · P1 · 初始计划旧路径未承接“确认具体方案版本”

- **位置**：[PlanCompiler:21](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/plan-compiler.md:21)、[接口:59](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/plan-compiler.md:59)。旧 `requestInitial → accept → applyPlan` 被保留，但未写清生成后的方案版本确认守卫；HumanCollaboration 已要求确认绑定具体版本。
- **依据与证据**：[PRODUCT:185](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:185)、[PRODUCT:213](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:213)。抽查 [initial-plan-compiler.ts:73](/home/hyh001/projects/coding-platform/coding-platform/src/control/plan-compiler/initial-plan-compiler.ts:73)，currentness 检查后直接构造 human actor 并调用 `applyPlan`，本段没有具体方案确认步骤。这不是对所有 UI 路径的穷尽结论。
- **影响**：实现者可能继续把请求时的写入许可当成生成后对具体方案的认可，提前改图或启动执行。
- **建议与验收**：HumanCollaboration 接收绑定方案引用和版本的确认，PlanCompiler 交付候选，ControlEngine 检查确认与候选的一致性后应用。明确未确认、确认后版本已变化两种情况均不能沿旧路径直接应用；同步 ownership-map 的初始流程。

### F02 · P1 · 目标变更遗漏停派、旧运行处置与影响未知时的责任交接

- **位置**：[PlanCompiler:20](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/plan-compiler.md:20)、[影响清单:26](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/plan-compiler.md:26)。流程只概括为提案、新 revision、新派发，并允许影响清单不完整，缺少对应的暂停与旧 Run 处置交接。
- **依据**：[PRODUCT:268](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:268) 要求范围无法确定时暂停 Goal 新派发，停止受影响工作、保留无关工作，旧结果通过适用性检查后才能推进。
- **影响**：新目标已经接受，旧目标下的任务仍可能继续执行或推进完成；也可能反向误停所有无关工作。
- **建议与验收**：PlanCompiler 输出影响及未知项；ControlEngine 受理变更并确定停派状态、控制意图和迟到结果守卫；DispatchEngine 执行控制交接，WorkerRuntime 向 Kernel 发请求并回传结果；HumanCollaboration 展示未完成处置。接口需逐一覆盖已知影响、未知影响、无关 Run 和迟到 Evidence，不让规划模块直接取消 Runtime。

### F03 · P2 · 无条件 assemble 的冻结顺序与连续 Session 复用冲突

- **位置**：[DispatchEngine:19](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:19)、[接口:59](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:59)、[ContextCompiler:123](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/context-compiler.md:123)、[StateLedger:79](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/state-ledger.md:79)。这些位置仍把 assemble 写成派发必经步骤；Dispatch 的目标变化又写了“直接续用 / 需要编译”的区别。
- **依据**：[ARCHITECTURE:933](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:933)、[必须分流:1106](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1106)。普通连续消息和恢复并非每次重新编译。
- **影响**：不同接口实现可能各选一条相反的规则，重复取材、破坏连续复用的成本目标。
- **建议与验收**：把旧顺序限定为“需要编译的派发”；分别写直接续用、增量编译、新建编译分支，并保留每个分支的正式准入与副作用顺序。因目标章节已经部分修正，本项为 P2，而非整个设计缺失。

### F04 · P2 · 多篇模块把三种记录全部归给 ContextCompiler

- **位置**：[Control:134](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:134)、[Dispatch:39](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:39)、[Dispatch:115](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:115)、[Lifecycle:130](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:130)、[Verification:114](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/verification-engine.md:114)。
- **依据**：[最新整理:169](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-open-decisions-recommendations.md:169)、[ContextCompiler:136](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/context-compiler.md:136)、[总表:182](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/ownership-map.md:182)：初始编译引用归编译面，运行实际读取留在 Kernel 日志，事后可查询材料由既有查询/索引承载。
- **影响**：会把运行日志和历史查询责任重新塞回 Compiler，迫使连续执行逐次回送编译层。
- **建议与验收**：以总表及 Context 本页的正确分工修订所有交叉引用。区分 `selectedRefs/gaps/manifest` 三项编译输出与“三种记录”；前者的唯一生产者归 Context 并没有错。

### F05 · P2 · 工作包只有任务拆解，没有完整承接责任分工

- **位置**：[PlanCompiler:19](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/plan-compiler.md:19)、[任务输出:70](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/plan-compiler.md:70)、[变化:106](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/plan-compiler.md:106)。主要落实拆解和 `moduleId`，没有完整承接跨模块工作包的唯一负责人、协作角色、结果回流和替换规则。
- **依据**：[ARCHITECTURE:610](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:610)、[PRODUCT:315](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:315)。父任务拆出子任务后仍保留汇总义务。
- **影响**：多模块任务可被拆出来，却没有唯一承担交付与汇总的对象；替换负责人后责任可能悬空。
- **建议与验收**：PlanCompiler 输出责任安排，Control 受理其正式关联，Lifecycle 提供参与/替换建议，ReadModel 展示。以跨两个模块、含子任务和一次替换的工作包检查责任、回流及父任务汇总是否始终明确；不要求新建治理对象。

### F06 · P2 · ControlEngine 被同时规定为归约者和“不 fold”

- **位置**：[ControlEngine:95](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:95) 笼统禁止 fold；同页职责与 [状态归属:118](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:118) 又要求其纯函数归约。
- **依据**：[ARCHITECTURE:1009](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1009)：Control 生成 snapshot/Event，Ledger 原子保存。
- **影响**：实现者难以判定 reducer 应放在哪里，可能错误推给 Ledger。
- **建议与验收**：改为“不以恢复重放方式另建正式事实，不直接访问存储；负责命令受理后的业务归约”。区分状态 transition 与历史恢复重放，保留 Ledger 不 fold 的边界。

### F07 · P2 · ArtifactVault 的只读依赖错误包含 Ledger.commit

- **位置**：[ArtifactVault:65](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:65) 同时列 `load/commit/events` 与“不写 canonical”；[StateLedger:81](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/state-ledger.md:81) 反向表只给 Vault `load(ref)`。
- **依据**：[ARCHITECTURE:406](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:406) 的正式提交分工。
- **影响**：接口分配留下绕过 Control 的第二提交入口，尤其容易误用于授权撤销或状态更新。
- **建议与验收**：删掉 Vault 的 `commit` 消费声明，仅保留实际需要的只读面；正反表及注入类型一致。正文持久化不等于写正式业务状态。

### F08 · P2 · Verification 文内凭空增加 Dispatch → Verification 依赖

- **位置**：[VerificationEngine:84](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/verification-engine.md:84)，与同页禁止反向依赖的说明、反向表及架构 DAG 冲突。
- **依据**：[ARCHITECTURE 的 DAG](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:185) 中不存在该边；模块自身 [边界:133](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/verification-engine.md:133) 也禁止这一调用方向。
- **影响**：按正文接线会增加未获设计支持的模块依赖，混淆 reviewer 派发与验证编排。
- **建议与验收**：删除错误依赖叙述，说明验证请求如何形成既有正式任务/派发事实，由既有入口执行。不要为迁就这一句话擅自扩 DAG。

### F09 · P2 · canonical 列混用了“对象是否正式”与“本模块是否拥有”

- **位置**：[Dispatch:107](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:107) 与 [Lifecycle:121](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:121) 对 Session 引用标注相反；[Vault:89](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:89)、[Context:140](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/context-compiler.md:140)、[Reconciler:102](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/architecture-reconciler.md:102) 也把消费他人事实或“不治理”写成非正式。
- **依据**：[Control:132](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:132) 给出了相应正式关联的权威；普通正式事实与治理对象不是同一个分类维度。
- **影响**：正式关联可能被误当作可丢弃的运行时引用或可任意重建的投影，绕开受理与一致性约束。
- **建议与验收**：统一拆成“对象性质 / 权威写入者 / 本模块持有形态”。区分 Runtime 暂时返回的 Kernel 引用与已受理的平台映射；派生副本也应明确来源，不因 owner 在别处改变原事实性质。

### F10 · P2 · 人的直接控制和主动提醒缺少完整动作交接

- **位置**：[HumanCollaboration 接口表:51](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:51)、[变化方向:126](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:126)。已有统一 Command 入口，但新增方向主要集中于读取和解释，没有逐项分配暂停、取消、换人、追加要求及主动提醒的动作和结果回流。
- **依据**：[PRODUCT:272](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:272)、[PRODUCT:621](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:621)。
- **影响**：可以展示侧栏，却无法保证每种人的介入都通过正确路径执行、回执及主动报告。
- **建议与验收**：补动作表：Human 接请求，Control 受理，Dispatch/Runtime 执行相关控制，Lifecycle 提供替换提案，ReadModel 提供状态，Human/Host 呈现提醒。明确已提交、已执行、失败或未知的区别。这里缺的是交接，不是完全没有命令入口，也不要求先重做整个 UI。

### F11 · P2 · Skill/prompt 版本化资产责任未下沉到 Vault

- **位置**：[ArtifactVault 职责:19](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:19)、[接口:46](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:46)、[变化:110](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:110)。通用正文存储没有明确承接资产的版本、来源、适用性与使用关联。
- **依据**：[ARCHITECTURE:856](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:856) 明确资产本体与版本归 Vault，并要求真实任务验证、失败例、运行版本反查和显式失效。
- **影响**：能存一段 skill 文本，仍不能追溯某个 Run 使用了哪个版本、该版本的适用范围或失效状态。
- **建议与验收**：Vault 声明正文、版本和元信息责任；与 RoleSpec、Run 的正式引用关系及失效受理分工对齐。完成一次“资产版本 → 使用运行 → 验证结果/失败例”的可追溯设计；不扩成技能市场。记忆接口已有留白安排，不算本项缺失。

### F12 · P2 · 归档缺少“无未交接活跃义务”的前置守卫

- **位置**：[AgentLifecycle:23](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:23)、[归档接口:72](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:72)，只引用归档后只读与显式启用要求。
- **依据**：[PRODUCT:317](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:317)。架构 #19 规定的是归档后的行为，不能替代此前提。
- **影响**：对象被隐藏和停止普通派发，但原任务的活跃义务没有接收方。
- **建议与验收**：Lifecycle 提案携带义务处置依据，Control 受理时复核；存在未完成交接则不能正式归档。覆盖仍有活跃义务、已交接、无义务三种情况，不把归档等同于删除记录。

### F13 · P2 · 强制成本链改造未分配到实际持有者

- **位置**：[ControlEngine 变化:150](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:150)、[ArtifactVault 变化:110](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:110)。前者只明确部分身份扫描改造，后者持有 RuntimeObservationJournal 却没承接累计重写改造。
- **依据**：[ARCHITECTURE:1111](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1111) 将 run-facts Delivery 扫描和 runtime-observation-journal 每事件累计重写列为必须先改。
- **影响**：模块按现有变化清单完成，长 Run 仍会重复扫描和累计重写；仅写指标“待测”不能替代改造任务。
- **建议与验收**：Control 承担准入读取路径改造，Vault 承担日志增量存储，Runtime 承担写入与查询接线。验收观察事件数增长时的累计读取/写入量与准入扫描次数，以真实连续任务验证，不以文件数或代码量声称收益。

### F14 · P2 · query 混合了三种副作用不同的操作

- **位置**：[HumanCollaboration:33](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:33) 允许空闲负责人续用原 Session 解释；[query:58](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:58) 又统一承诺不改变源 Context、租约或预算。
- **影响**：原 Session 正常解释运行会产生消息与成本，无法履行独立只读查询的全部承诺。
- **建议与验收**：分别定义持久状态读取、独立只读 QueryRun、原 Session 解释运行。保留允许复用的产品选择，但声明各自是否调用模型、影响谁的预算/Context、如何等待；不能以“查询”一词掩盖实际副作用。

### F15 · P2 · 快照端口的提供者与转发者没有对齐

- **位置**：[HumanCollaboration:80](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:80) 将 `HandoffControlPort.snapshot` 列作 Dispatch 公开面；WorkerRuntime 才承载实际快照能力，Dispatch 没有配套声明向 Human 暴露这一转发契约。
- **影响**：依赖箭头虽然合法，调用双方却不能据此完成接口装配；实现者可能直接越过 Dispatch 接 Runtime。
- **建议与验收**：保留既有依赖方向，明确 Dispatch 的只读快照转发入口、Runtime provider、作用域与错误映射；或明确已有其他间接读取方案并同步两端。核对 `report/unsupported/stale/rejected` 能由真实 provider 返回，且读取不向源 Run 注入消息。

### F16 · P2 · 任务图扩展遗漏协作关系的投影与展示

- **位置**：[ReadModelIndex:27](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:27)、[查询:52](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:52)、[变化:114](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:114)。已列架构关联和工作卡片，但未明确把协作关系纳入任务图。
- **依据**：[ARCHITECTURE:557](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:557) 要求咨询、反馈、讨论可往返，复用既有事实进行投影展示。
- **影响**：独立通信查询虽存在，任务图依然只能显示计划关系，无法体现跨 Agent 协作。
- **建议与验收**：ReadModel 明确消费 CoordinationIssue、Mailbox/communication-view 的既有事实，Human/Host 展示协作边；与阻塞依赖 DAG 分开，允许来回讨论而不把任务依赖制造成环。

### F17 · P2 · Control 的工作身份唯一键漏掉 goalId（本轮新增）

- **位置**：[ControlEngine:76](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:76) 写 `(projectId, workspaceId, taskId)`；[StateLedger:26](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/state-ledger.md:26) 明确包含 `goalId`。
- **源码证据**：[task-work-identity.ts:75](/home/hyh001/projects/coding-platform/coding-platform/src/contracts/task-work-identity.ts:75) 的作用域为四元组。
- **影响**：同项目、工作区下，不同 Goal 的同名 Task 可能被错误拒绝或复用身份；Control 与 Ledger 约束不一致。
- **建议与验收**：恢复四元组，说明 taskId 采用返工替换链的起源任务标识。用两个 Goal 下同名 Task 核对不会互相碰撞。

### F18 · P2 · absent 的规则混淆了身份建立和只读取材（本轮新增）

- **位置**：[Dispatch:28](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:28) 允许不存在时建立身份；[Dispatch:125](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:125) 又把 `absent/unavailable` 一并规定为拒绝。
- **源码证据**：[work-identity.ts:164](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/work-identity.ts:164) 对 unavailable 拒绝、absent 才建立；[work-material-drive.ts:77](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/work-material-drive.ts:77) 处于只读取材阶段，两种失败都不能自行建身份。
- **影响**：首次派发可能永远不能建立身份，或反方向误改导致材料消费侧创建身份。
- **建议与验收**：分阶段写出 resolved、absent、unavailable 的处理表；先完成可写的身份准入，再只读消费材料。首次建立成功与存储不可用时零创建两种情况必须能区分。

### F19 · P2 · Dispatch 将平台归档错误归给 Kernel（本轮新增）

- **位置**：[DispatchEngine:119](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:119) 把“归档与压缩的执行”一起指向 Kernel/WorkerRuntime。
- **依据**：[ARCHITECTURE:368](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:368)、[最新整理:193](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-open-decisions-recommendations.md:193)：归档控制平台默认视图和调度，走 Lifecycle 提案、Control 归约、Ledger 保存、ReadModel 投影。
- **影响**：实现者可能等待不存在的 Kernel archive 能力，遗漏平台停派与默认隐藏；关闭内核 Session 也不能替代平台归档。
- **建议与验收**：仅把压缩执行归 Runtime/Kernel；平台归档由上述链路负责，Dispatch 消费正式归档状态阻止普通派发。与 F12 分别解决“谁执行”和“何时可执行”。

### F20 · P2 · 候选生成与检查模块被误配基线决策/激活端口（本轮新增）

- **位置**：[ArchitectureReconciler:76](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/architecture-reconciler.md:76) 列入 `ArchitectureDecisionPort` 与候选登记/物化；[VerificationEngine:80](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/verification-engine.md:80) 列入 `recordMigrationGate/recordBaselineActivation`，均当作本模块既有消费面。
- **源码证据**：[Reconciler 依赖:11](/home/hyh001/projects/coding-platform/coding-platform/src/control/architecture-reconciler/architecture-reconciler.ts:11) 只取 inspection/finding/brief 三个记录接口；[BaselineEvolutionPort:34](/home/hyh001/projects/coding-platform/coding-platform/src/control/architecture-reconciler/baseline-evolution-port.ts:34) 只有 context/now；[MigrationGatePort:12](/home/hyh001/projects/coding-platform/coding-platform/src/control/verification-engine/migration-gate-port.ts:12) 明确只读；[共享契约:5](/home/hyh001/projects/coding-platform/coding-platform/src/contracts/baseline-evolution.ts:5) 将 ArchitectureDecisionPort 归于 HumanCollaboration。
- **依据与影响**：[ARCHITECTURE:1021](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1021) 区分人的显式决定、门禁和 CAS 激活。现表容易使候选生产者或验证者承担决定/激活请求，扩大接口权力。这里确认的是文档误配，不是代码已经越权激活。
- **建议与验收**：分别列候选生产、门禁检查、人的决定、正式登记/激活的提供者和消费者；仅保留各模块实际需要的窄接口。共享契约文件包含某端口，不等于该文件的所有消费者都调用该端口。

### F21 · P2 · 超容量后的“拆分 inspection 范围”没有可调用恢复契约（本轮新增）

- **位置**：[ArchitectureReconciler:28](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/architecture-reconciler.md:28)、[容量契约:66](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/architecture-reconciler.md:66)。超过 256 条差分时拒绝并要求拆分检查范围，但未规定范围表达、分片者和覆盖汇合。
- **源码证据**：[ArchitectureInspectionIntentV1:351](/home/hyh001/projects/coding-platform/coding-platform/src/contracts/architecture-inspection.ts:351) 无机械检查范围/分片字段；reportInput.affectedRefs 属报告输入。[Context:59](/home/hyh001/projects/coding-platform/coding-platform/src/data/context-compiler/architecture-context-compiler.ts:59) 比较完整 baseline 与 current source；[拒绝消息:50](/home/hyh001/projects/coding-platform/coding-platform/src/control/architecture-reconciler/architecture-reconciler.ts:50) 确实要求拆分。
- **依据与影响**：[ARCHITECTURE:900](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:900) 要求容量和失败/重试契约。调用者没有所述恢复路径；只缩小当前图读取范围，还可能把未读取节点误判成删除。
- **建议与验收**：当前先如实标明只能拒绝、尚无拆分能力，并登记契约欠账；若要提供恢复路径，再分配同版本分片、跨片边界和完整覆盖汇合职责。不能截断结果伪装完整，也不能仅提高上限当作解决。本项独立于“真实图 producer 未接”的既有欠账。

## 5. 次要修订项

| 编号 | 位置与问题 | 修订建议 |
| --- | --- | --- |
| M01 · P3 | [Control:132](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:132)、[Control:152](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:152) 把普通 RoleBinding 等关联笼统称为治理写入。 | 改称“正式事实归约”，单列 RoleSpecRevision 的治理路径。不据这一措辞断言已经新增审批系统。 |
| M02 · P3 | [StateLedger:43](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/state-ledger.md:43) 写不负责数据库 schema，却拥有内部 SQLite Adapter；[实现:281](/home/hyh001/projects/coding-platform/coding-platform/src/data/state-ledger/sqlite-ledger.ts:281) 直接定义表。 | 区分外部传输协议与内部存储 schema；内部 Adapter 负责后者，Host 仅装配配置。 |
| M03 · P3 | [ReadModelIndex:106](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:106) 声称不持有旧标识；[内存实现:342](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/read-model-index.ts:342) 持有绑定快照，[SQLite:430](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/sqlite-read-model-index.ts:430) 有对应表。 | 改为“不拥有标识的正式权威，但派生行包含旧标识”。同页已经安排兼容迁移，不能据此说迁移完全遗漏。 |
| M04 · P3 | [README:102](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/README.md:102)、[README:140](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/README.md:140) 写新增 7 项，实际列到 N-8。 | 更新数量或避免手写重复计数；不计为架构缺陷。 |

## 6. 必须闭合的跨模块流程

下表是建议修订后的责任链，用于检查接口输入是否完整，不是新增一套模块或命令系统。精确字段和端口名称仍在后续接口契约中确定。

| 流程 | 责任链与必须保留的判据 | 相关问题 |
| --- | --- | --- |
| 初始方案 | PlanCompiler 产候选 → Human 收具体版本确认 → Control 校验并应用 → Ledger → 投影/派发 | F01 |
| 目标变更 | 规划给影响与未知项 → Control 决定停派及控制意图 → Dispatch/Runtime 执行回报 → Control 归约；迟到结果重新检查 | F02 |
| 连续执行 | Lifecycle 给复用决策 → Dispatch 区分直接续用/需编译 → 必要时 Context 编译 → 正式准入 → Runtime | F03、F04、F18 |
| 跨模块工作包 | 规划给唯一负责人、协作者、回流和替换规则 → Control 正式受理 → 投影展示；父任务保留汇总 | F05 |
| 人的介入 | Human 收动作 → Control 受理 → 对应执行者执行 → 正式结果回流 → Human/Host 呈现与提醒 | F10、F14、F15 |
| 平台归档 | Lifecycle 检查义务与提出归档 → Control 复核受理 → Ledger → ReadModel；Dispatch 停止普通派发 | F12、F19 |
| 基线演进 | Reconciler 生产候选 → Verification 检查 → 人的决定入口/演进集成者提交 → Control 守卫与 CAS 激活 | F20；具体先后依上位基线契约，不混同检查与决定 |
| 图读取与超容量 | Reader 捕获 → Context 提供完整可说明的来源 → Reconciler 有界检查；失败不冒充完整成功 | F21 |
| Skill/prompt 追溯 | Vault 本体与版本 → RoleSpec/Run 的精确引用 → 查询反查验证、失败和失效情况 | F11 |
| 任务协作图 | 既有协调/通信事实 → ReadModel 协作投影 → Human/Host 展示；不并入阻塞 DAG | F16 |
| 长 Run 成本 | Control 准入读取、Vault 增量日志、Runtime 接线分别负责 → 真实连续任务测量 | F13 |

## 7. 已知欠账、前轮修正与不计入项

以下并非已经解决，而是文档已经明确登记或前轮判断需要收窄，不能反复计成新的分工缺陷。

| 项目 | 本次处置 |
| --- | --- |
| C-9 端口分散、C-10 跨模块引用内部策略、C-13 多派发入口、C-14 检查器盲区 | 保留已有迁移任务，不再次计数。F20 是特定端口错误归属，不等同于泛称“端口分散”。 |
| N-2 paused 正式事实落点、N-3 Lifecycle 候选结果与 decide/propose 协议 | 已登记接口设计欠账，不要求再次由用户拍板；后续契约仍必须解决。 |
| 生产 Kernel 恢复/压缩开关、safe-point ack、默认 Fake、真实图 producer、inspect 产品入口 | 已登记实现前提；模块设计未实现不自动构成新的分工错误。 |
| 首次架构建立与新项目目录 | Reconciler 已写无旧 baseline 的首次路径，Reader 已明确不负责写目录。不报“完全遗漏首次建立”。 |
| 记忆/知识库 | [Lifecycle:168](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:168) 已指向后续对象与关系契约。撤回“完全没有 owner/落点”的强说法，保留 F11 的技能资产明确遗漏。 |
| 无条件 assemble | 本页目标已部分分流，按 F03 定为 P2 文字/契约冲突，避免继续认定为整套目标设计完全不支持续用。 |
| 归档前提 | F12 定为 P2；与 F19 的执行 owner 错误分开。 |
| 工作包责任 | 唯一 owner、回流、替换及父任务汇总合并为 F05，不拆成多个数字。 |
| 三种记录 | 以 F04 去重。Verification 的“实际读入写进 manifest”单句不足以证明所有工具读取必须回送 Compiler。 |
| Human 查询 | F14 要求分类，不禁止产品允许的空闲 Session 续用；F10 不声称人机模块没有写入入口。 |
| Runtime unsupported | 缺配置与不支持需要原因区分，但可由 reason/capabilities 表达；现有证据不足以单列新 P2。 |
| 依赖边数 | 38 是当前设计的校验结果，不是永久目标；没有消费者的边可以删除，但本次没有证明某条允许边已完全无用。 |

## 8. 建议修订顺序与完成标准

1. **先闭合 P1 流程**：把具体版本确认及目标变更处置写进 owner、consumer 和总表，避免后续接口沿旧路径冻结。
2. **修正明确矛盾**：F03、F04、F06–F09、F14、F15、F17–F20 同时修改两端说明；不能只修一篇后留下反向表继续冲突。
3. **补齐责任分配**：工作包、人的控制与提醒、技能资产、归档前提、成本链、协作图，分别写入职责、变化方向和验收场景。
4. **如实登记容量恢复欠账**：F21 不要求先造完整分片系统，但当前不应声称存在不可调用的恢复路径。
5. **同步总表与索引**：统一 canonical 表头，修订 M01–M04，机械检查之后再做端口语义和流程检查。

完成标准不是“每篇有五个章节”，而是每项产品动作都能回答：谁提出、谁决定、谁执行、谁保存正式事实、谁展示、失败或未知时由谁继续处理。对尚未实现者可保留明确欠账，但不得在另一章节写成既有已接能力。

## 9. 验证记录与限制

- 13 篇模块文档覆盖完整；正向依赖表与架构图一致，反向表对称，当前设计为 38 条模块依赖，DFS 未发现环。
- 上述检查只证明表格集合一致。F08 的正文反向依赖、F07/F15/F20 的接口方向或提供者错误不会被单纯边数检查发现。
- 抽查了工作身份、初始计划受理、只读取材、基线演进、迁移门禁、架构检查输入及 ReadModel/Ledger 存储实现，用于核实本文具体主张。没有把目标架构新增 AgentLifecycle 与旧源码尚未迁移的差异直接当成缺陷。
- 没有运行代码测试或宣称实现通过；“验收”条目是建议的后续检查场景。本报告是截至本日期的文档一致性审查，不保证覆盖全系统实现缺陷。
- 定位行号对应本次读取版本；修订原文后行号可能移动。报告生成后检查了本地链接目标和行号范围。
