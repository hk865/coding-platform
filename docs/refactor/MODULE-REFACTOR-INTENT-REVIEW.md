# 从作者意图、复用与职责减负重新审阅模块设计

> 历史评审说明：本文保留对旧方案的评审结论，架构、DAG 和模块引用固定到 [2026-09-23 迁移前快照](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/README.md)；当前方案见 [架构入口](/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md)。

审查日期：2026-09-22。范围：当前 `docs/refactor/modules/` 的 13 篇模块文档及两份总表，连同上位架构、Prompt 3、人的原话、旧文档与关键源码。本文只交付审阅与修订建议，未改模块稿、架构稿或源码。

## 1. 判断

**你的担忧有依据，但问题主要不是“13 个模块划错了”，而是模块间接口设计与模块内部去冗余设计还没有充分接起来。** 当前稿对权限、状态权威、调用方向写得较细，也已经补进连续 Session 复用、按需编译及多项前轮修正；它并非完全脱离原功能。不过，若直接按现稿进入实施，仍可能出现“增加生命周期接口、拆开大文件，却继续维护两份同样规则”的结果。

本次结论分三层：

1. **Prompt 3 基本满足，接口可引用性与现状/目标标注部分不满足。** 不能因尚未提供完整字段、迁移排期和函数拆分方案，就判定它违反原 Prompt 3；那些有明确后续阶段。
2. **13 个模块可以继续作为当前设计基线。** 没有充分证据要求整体重划。应优先在现有模块内拆分变化原因不同的职责，给重复逻辑指定唯一实现，再判断哪些跨模块依赖确实需要调整。
3. **需要接口，也需要共用实现，两者不能互相替代。** 接口规定边界，共用实现减少重复；多个窄接口可以共用同一个规则实现。不能为了减少接口数把所有请求塞进一个万能入口，也不能为了复用把有业务权威的规则全部塞进 `Contracts` 或 `shared`。

本文列出 **3 类本阶段应直接修正的问题，以及 8 项有源码依据的减负/复用设计补充**。后者不是“新增 8 个运行故障”，也不全部属于原 Prompt 3 的硬性缺项，而是对你本次明确重构目标的具体承接。

## 2. 怎样理解作者意图

### 2.1 依据的层次

| 来源 | 对本次审阅的意义 |
| --- | --- |
| 本次用户委托 | 明确新增验收视角：去冗余、减轻职责、分析大文件是否过度集中、提高复用；不能只证明文档互相一致。 |
| [9 月 19 日需求对话](/home/hyh001/projects/coding-platform/my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-requirements-dialogue.md:292) | 能力通过配置/Skill 表达；角色连续工作、两图辅助编排检索；不是把软件模块职责当成角色永远不能做某事。 |
| [方案解释与确认原话](/home/hyh001/projects/coding-platform/my-coding-platform-docs/agent_platform/dev_docs/design/2026-09-19-requirements-dialogue.md:445) | 秘书提出方案，解释和修订原方案，人的确认后才改变目标/图并执行；不能追问一次就另生成一套方案。 |
| [较早的用户需求原文](/home/hyh001/projects/coding-platform/my-coding-platform-docs/agent_platform/dev_docs/product/用户需求原文.md:49) | 主动提醒、讨论、直接介入、多工作区和系统承担验证等原功能不能被新生命周期设计挤掉。 |
| [最新回复：不接受只打补丁](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-user-replies-numbered.md:52) | 新增 AgentLifecycle 必须伴随旧职责迁出或删除；包一层新入口不等于完成重构。 |
| [最新回复：身份与成本](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-user-replies-numbered.md:64) | 身份/Work ID 是否保留要看真实消费者和作用，不能把登记仪式本身当作目标。 |
| [最新回复原文全文](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-user-replies-numbered.md) | Kernel 恢复由平台适配；推荐材料不成为硬白名单；不要求独立的跨任务持久 Agent 主体；长期记忆当前仅预留。 |
| [Prompt 3](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:314) | 本阶段要求可供下阶段引用的模块契约与变化方向，不要求本阶段完成全部实现设计。 |

助手调查、建议和旧分析用于提供方案与线索，不能替代人的原话。Prompt 通用摘要 [第 81 行](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:81) 的“可复用 Agent 主体”有较早的术语背景，应依 Prompt 3 的最新裁决说明理解为角色配置及 Session 连续性，不能重新引入人已经撤回的长期主体要求。

### 2.2 功能保持与简化必须同时成立

| 用户要达到的效果 | 应减少的东西 | 不能随之删掉的功能 |
| --- | --- | --- |
| 连续处理相关工作，降低重复装配 | 每条消息全量编译、重复身份推导、重复读来源 | 明确目标、重要限制、未完成事项、必要权限和来源检查 |
| 问项目或模块负责人时自然回应 | 把普通问题升级成规划/派发/审批的整套流程 | 状态查询、独立只读解释、空闲 Session 续用各自的语义 |
| 模块易维护、代码可复用 | 同一投影规则、拒绝映射、流消费和路径政策多处实现 | Reviewer 独立性、普通执行、Handoff、人工计划之间真实差异 |
| 生命周期真正落地 | 包装旧入口后仍让旧代码继续选人、推身份、重复取材 | 正式受理、租约、失败保留、人的决定和恢复记录 |
| 角色能力可配置 | 用模块名称或角色名称写死能力 | 实际工具权限、工作区写入边界和执行端限制 |
| 图支撑编排和检索 | 每次全量探索、为图另建平行事实系统 | 图的正式结构、来源版本、任务责任与协作关系 |

例如 HumanCollaboration 不直接写正式状态，不意味着“秘书永远不能写文件”。前者是软件模块的写入边界；后者是角色能力，授权后可经 Dispatch/Runtime 执行。混淆这两个层次，才会脱离人的功能意图。

## 3. Prompt 3 符合性

依据为 [产物要求与验收条款](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:373)。

| 要求 | 判定 | 说明 |
| --- | --- | --- |
| 13 篇，plane、名称和目录对应正确 | 满足 | README 能导航，新增 AgentLifecycle 明确尚无源码。 |
| 职责和“不负责” | 满足 | 13 篇均有。保留合理旧功能，不必为了精简字数删掉必要边界。 |
| 对外接口有接口名、方向、传递内容 | **部分满足** | 部分新能力仍以功能描述代替候选接口名；提供面、消费面、内部实现混在同表，见 R01。 |
| 区分既有代码、目标候选与未接能力 | **部分满足** | 新增确认约束和直接续用行为嵌入标【代码】的旧接口行，见 R02。 |
| 依赖、被依赖写到具体接口 | **部分满足** | 表格形式完备；共享政策的合法消费边及少量端口归属仍未闭合，见 R01/R03。 |
| 状态、权威、生命周期阶段/动作 | 满足为主 | 当前稿已修复前轮多处 canonical 口径冲突，不复用旧问题计数。 |
| 对象与旧标识去向 | 满足 | 已说明保留、合并和兼容的原则；具体迁移仍应在后续契约/计划确定。 |
| I 项号及接口变化方向 | 满足 | 各篇与 README 齐全。 |
| 能直接支撑 Prompt 4 的边表 | **部分满足** | 多数可以；功能标题无法直接当作端口标识，提供者不清也不能直接冻结边。 |
| 信息缺口先引用上位，再列新增 | 满足 | 不是所有“待定”都是缺陷，当前多数已有明确承接位置。 |
| 不重新引入已撤回要求 | 满足为主 | 当前稿已明确不新建身份治理、逐材料准入和复杂恢复平台。 |
| 先复述/给选项/确认后落笔 | 无法由文件验证 | 需要原任务记录，不能用静态文档猜测过程是否合规。 |
| 未改上位文档与源码 | 无法仅由正文验证 | 不能把 README 的自述当成变更审计证据。本次审阅自身只新增本文。 |
| 完整目标 DAG 取舍、精确 schema、逐步迁移/删除/回滚、金额实测 | **后续阶段** | 不能据其尚未交付判 Prompt 3 失败；现在必须给足方向、责任和真实缺口。 |

因此，不建议“因接口写得不好而全部重写模块文档”。应修正可引用的目标接口，补充真正去重的责任。若要改变 13 模块或新增逻辑边，必须先同步架构依据，不能由模块稿单方面悄悄改变。

## 4. 本阶段应直接修正的三类问题

### R01 · P2 · 接口表混合了提供能力、消费依赖、实现文件和未命名功能

**证据。** [HumanCollaboration:74](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:74) 的“工作卡片与 Session 视图查询”、第 75 行的“秘书恢复与方案解释的最小读接口”仍是功能标题。[第 76 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:76) 把 Dispatch 的快照转发入口放进 Human 对外接口表。新增控制动作已经有 [职责交接表](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/interaction/human-collaboration.md:38)，但还不能从接口表定位本模块入口、请求和回执。部分其他模块也将具体类或文件名与公共 Port 并列。

**影响。** 调用方不知道自己该调用 Human、Dispatch，还是直接依赖某个实现类；Prompt 4 不能可靠地从中提取“调用者→接口提供者”。多个 `入/出` 也混用了“调用方向”和“返回数据方向”。

**修订。** 对外接口只列模块提供的稳定能力；消费接口移入依赖表；内部实现保留为映射说明。新能力可给候选名称并标“未冻结”，不必冻结完整字段。统一方向口径为“谁调用本模块的什么方法”，结果另列。已有接口若仅是内部复用，不应因被 `export` 就提升成永久公共承诺。

**完成条件。** 从任一目标能力行能直接得到 owner、consumer、输入、结果及必要约束；不需要再猜功能标题对应哪个可调用入口。

### R02 · P2 · 修正目标行为时，没有同步修正“现状”标签

**证据。** [PlanCompiler:61](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/plan-compiler.md:61) 和第 62 行已加入具体版本确认，方向正确，但整行仍标【代码】。[当前初始计划实现:73](/home/hyh001/projects/coding-platform/coding-platform/src/control/plan-compiler/initial-plan-compiler.ts:73) 仍在来源检查后构造 human actor 并调用 `applyPlan`，这段没有新的版本确认输入。[Dispatch:63](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:63) 也把直接续用、增量编译等目标分支和旧 P1-03 接口放在同一【代码】行。

**影响。** 上一轮“规则缺失”被文字补上后，可能又变成“看起来规则已经实现”。下游会保留旧实现而只增加新端口，或者把未完成迁移漏出计划。

**修订。** 每个变化接口分别写“当前签名/行为”“本次目标差异”“旧调用方去向”。具体版本确认是必须迁移的行为，不是给旧行补注释就已经具备。反过来，稳定旧方法不必只因 I 项号覆盖本模块就改名。

**完成条件。** 读者能明确区分哪些语义已有代码证据、哪些需要改实现、哪些只是候选名称。与上轮报告相比，本项针对的是修订后的标签和迁移表达，不重复认定当前文档仍然没有确认要求。

### R03 · P2 · 拒绝路径清单要求去重，但其跨模块复用位置仍未解决

**证据。** 架构 [第 1079 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1079) 已要求三处字面量收敛为一处；[唯一现有定义](/home/hyh001/projects/coding-platform/coding-platform/src/core/workspace/denied-prefixes.ts:31) 在 WorkspaceReader，副本仍在 [普通 Runtime:258](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts:258)、[只读 Runtime:140](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/read-only-query-runtime.ts:140) 和 [Verification:58](/home/hyh001/projects/coding-platform/coding-platform/src/control/verification-engine/command-check-provider.ts:58)。Runtime→Reader 已有逻辑边，Verification→Reader 没有。

**影响。** 写“复用共同清单”还不够：一方能直接复用，另一方按现有规则会越界。Host 注入只改变装配位置，**不会消除政策消费的逻辑依赖**。

**可评审选择。**

- 政策归 WorkspaceReader：通过其窄公开面复用，并在上位架构明确 Verification 的逻辑依赖；不能在现稿“除既定四条不新增边”的限制下偷偷加。
- 若七项值确为跨模块共同协议：明确它们的语义 owner，将稳定值放在有归属的共享契约中；路径规范化、符号链接/越界判定及真实沙箱执行仍留在对应实现内。

本报告倾向先按第二种核定“稳定共享值”的范围；若其行为必须随 Reader 的访问政策演进，就应选择第一种并修改架构。不能为保持漂亮 DAG 将整个文件访问算法下沉 Contracts。索引扫描的 `node_modules/.venv` 忽略规则也不能和执行权限拒绝清单强行合并。

**完成条件。** 文档给出唯一 owner、全部消费者和合法依赖方向；代码迁移可以后置，职责归属不能一直写成“以后去重”。

## 5. 对重构目标还需补齐的八项设计

以下按优先价值排列。它们有的已被文档登记为债务，本次给出可执行的共享边界；不把“已有欠账”重新包装为首次发现。

### D01 · ReadModel：两后端共用领域投影规则，而非复制成两组小文件

当前稿 [第 127 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/read-model-index.md:127) 已承认重复并要求拆分。但 [内存版 GoalPhaseUpdated:1399](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/read-model-index.ts:1399) 与 [SQLite 版:1434](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/sqlite-read-model-index.ts:1434) 各自维护同一事件到状态行/时间线的映射；[SQLite:1472](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/sqlite-read-model-index.ts:1472) 甚至标注与 InMemory fold 镜像。

**建议落点。** 仍在 ReadModelIndex 内，按 Goal/任务运行/审查/通信等责任族共用无存储副作用的“事件+必要前态→投影变化”。两 Adapter 分别负责加载、写入、页原子性和 cursor。已有 [reviewer-projection.ts](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/reviewer-projection.ts:1) 可作局部样板，不必新造一套万能投影框架。

复用还要避免多读：当前 [SQLite:2065](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/sqlite-read-model-index.ts:2065) 无条件先求 `reviewRecords()` 再交共享函数判断事件，可能使无关事件也读取审查集合。应先辨别事件及引用，再加载必要前态。

**模块稿应补的约束。** 新事件的投影语义只实现一份；内存与 SQLite 不各写一遍。后续验证比较相同事件序列、重复推进、游标和缺失前态行为，不能只比较最后一行显示文本。

### D02 · Verification：保留两类业务，收敛重复准备与执行步骤

[模块稿:143](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/verification-engine.md:143) 称 `VerificationEngineImpl.verify` 不是生产入口，表述过头。[CommandCheckLifecycle:196](/home/hyh001/projects/coding-platform/coding-platform/src/control/verification-engine/command-check-lifecycle.ts:196) 在生产单项检查路径仍构造它：有轮次绑定时执行计划检查，无绑定时调用 `engine.verify`。

[旧引擎:53](/home/hyh001/projects/coding-platform/coding-platform/src/control/verification-engine/verification-engine.ts:53) 与 [VerificationRounds:271](/home/hyh001/projects/coding-platform/coding-platform/src/control/verification-engine/verification-rounds.ts:271) 各自准备材料和能力，再调用已经共用的 `compileVerificationPlan`。因此，不能说完全两套算法，也不能直接删旧类。

**建议落点。** 模块内部共用计划准备、能力规范化和已选检查执行；轮次服务保留全检查覆盖、配置冻结、恢复和聚合；单项检查保留执行 checkpoint、租约和副作用状态。旧入口明确成为兼容适配还是继续保留独立语义。

**完成条件。** 修改来源/Session 绑定或检查选择时，不必维护两套准备过程；同时保留单项与轮次的区别。准确改写为“不是顶层服务入口，但仍被生产路径内部调用”。

### D03 · Control：共用提交支持，保留领域权威和事务守卫

[role-spec:153](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/role-spec.ts:153)、[human-role-collaboration:271](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/human-role-collaboration.ts:271)、[baseline-evolution:407](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/baseline-evolution.ts:407) 的 Ledger 回执映射近逐字相同；这不是三个不同业务决策。当前 [变化清单:158](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/control-engine.md:158) 主要说明命令扩容，没把这些共用基础实现作为新命令的复用要求。

**建议落点。** Control 内部提交支持负责共用拒绝映射、适用的快照类型守卫和机械构造；各命令族保留自己的业务守卫、expected-version 集合及归约。不同拒绝码变体核实语义后再合并，不新建通用命令总线。

跨模块 C-10 也不能仅凭“纯函数”下移。例如 [normalizeInitialPlanProposal:6](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/policies/initial-plan-admission.ts:6) 校验来源、Goal 版本及尚无 active plan；[角色准入政策:36](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/policies/role-binding-admission.ts:36) 检查规格、矩阵 pin 和权限子集。二者均有业务权威，应保留 Control owner，通过窄公共导出或只读政策端口复用。公开面不意味着一定要远程调用；最终提交仍复核。

**完成条件。** 新增生命周期命令复用提交支持；同一业务判据只有一个权威实现，预检不被当作最终授权。

### D04 · Dispatch：唯一入口不足以解决通信驱动的内部集中

[coordination-drive.ts](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/coordination-drive.ts:369) 共 1241 行，同时承担扫描采集、路由提案、Wait 转换、结算、退避、隔离、deadline 和执行准入。具体责任可定位到 [提案:635](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/coordination-drive.ts:635)、[结算:762](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/coordination-drive.ts:762)、[准入:957](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/coordination-drive.ts:957)。现稿 C-13 重点是三条 `runtime.start` 路径的收敛，尚未回答这个文件内如何分责。

**建议落点。** 不增 Module，在 Dispatch 内区分：有界扫描/恢复输入；无副作用路由与 Wait 提案；持久 claim/settle/retry 协议；通信结果到执行准入的桥接。已有普通与并行入口的共用准备可保留，并推广到必要消费者。

**完成条件。** 路由计算可单独检查，恢复协议不混入纯计算；Control 仍最终校验并提交提案。不能只是把 1241 行平均切成四个文件，也不能为了唯一 `drive` 抹掉 Reviewer、Query、Handoff 的真实约束。

### D05 · Runtime/Vault：先减掉重复正文承载，再做增量写入

当前稿已经明确日志增量化，见 [Vault:117](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/artifact-vault.md:117)，不能再报告“日志成本无人负责”。但 [observed-model-run:94](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/observed-model-run.ts:94) 复制 Kernel 事件 payload 后仅删除推理字段；[Runtime:307](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts:307) 将事件推入平台 `trace` 并保存；[journal:52](/home/hyh001/projects/coding-platform/coding-platform/src/data/artifact-vault/runtime-observation-journal.ts:52) 整体序列化替换。

**建议落点。** Runtime 清点 trace 的真实消费者：平台状态、预算与公开观察保留必要投影；Kernel 原始消息、工具记录、恢复材料走 Kernel 引用/游标；Vault 只对必要平台观察增量落盘。消费者迁移完成后移除相应旧正文副本。

**完成条件。** “不复制 Kernel 正文”有明确旧字段去向与消费者替换。仅把全量副本改成分条副本，解决不了重复承载。也不能反过来删除全部 trace，使平台丢失必要运行事实。

### D06 · Runtime：共用受限模型调用与结构检查，保留复核/审计语义差异

[自动复核:53](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/query-answer-review.ts:53) 与 [用户审计:18](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/query-answer-audit.ts:18) 重复校验 block 覆盖、重复 index、quote 子串、marker 引用；[前者流消费:91](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/query-answer-review.ts:91) 与 [后者:107](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/query-answer-audit.ts:107) 重复取消、终止、禁止工具调用及容量检查，错误原因保留方式已出现差异。

**建议落点。** WorkerRuntime 内部共用结构校验原语与受限单次模型调用消费器；自动发布前复核仍使用原查询预算和其判词，用户事后审计仍保留独立请求、记录和不同结论集合。不要合成一个含大量 mode 开关的统一审计系统。

另将 [execute:219](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts:219) 中的环境准备、Kernel Session 调用适配、公开观察和平台结果翻译分开。复用已有 `runObservedModel`，不在平台新建推理循环；环境缓存也不能缓存过期权限或来源有效性。

**完成条件。** 同类边界检查只维护一处，业务结果保持原含义；Session 能力扩展不再继续堆进一次 `execute`。

### D07 · Context：已经有正确的分流原则，还需落实共同材料处理的边界

现稿 [owner/consumer/替换表:78](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/context-compiler.md:78) 已较前轮改善，[第 98 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/data/context-compiler.md:98) 正确区分触发点与消费用途。**不应再要求把 12 个端口按五类触发机械合成五个。**

进一步应明确同一模块内部哪些读取、引用规范化、缺口表达、增量基线处理可以共用，哪些需求必须留在消费者专用适配：Reviewer 的原始见证/独立性、规划材料、Query 事实位置、Architecture 同版本图材料不能互相替代。

**建议落点。** 以现有 [WorkRunMaterialCompiler](/home/hyh001/projects/coding-platform/coding-platform/src/data/context-compiler/work-run-materials.ts:1) 等实际调用链为依据，列共同步骤、消费者差异、绕过编译的路径，以及旧重复步骤的替换方向。不额外发明一个包住所有现有端口的门面。某个小公共步骤是否值得抽取，先看是否存在两个真正相同的消费者。

**完成条件。** 接口可以仍有多个，但相同材料处理不再重复实现；普通消息和 Kernel 已成功恢复的路径确实不再做同一轮全量读取。详细字段和拆文件仍可后置。

### D08 · Host 与共享面不能因为“不属于 13 个 Module”而漏出减负设计

[createScopedGuiService:123](/home/hyh001/projects/coding-platform/coding-platform/src/app/service.ts:123) 到第 984 行共 862 行，包含装配、后台唤醒、投影队列、状态聚合、请求分派和关闭编排，另有 [persistent-platform.ts](/home/hyh001/projects/coding-platform/coding-platform/src/composition/persistent-platform.ts:1) 的装配。架构 [跨模块清理:1079](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:1079) 已点名该函数；13 篇模块文档本身不会自动覆盖它。

**建议落点。** 在总表增加非 Module 的责任：Host 内部分开 transport 路由、模块装配、后台生命周期和视图聚合；公共协议在 Contracts；机械原子文件操作在 Storage。它们不新增领域 Module，不拥有新的业务权威。模块端口应足够窄，使 Host 不必知道内部算法、私有状态和持久表。

**完成条件。** 原有用户入口/错误/请求身份仍在，业务规则不复制到路由；关闭和恢复顺序有单一负责人。不要把“重构 createScopedGuiService”直接解释成删除服务入口。

## 6. 接口之外，哪些东西应共用

### 6.1 选择共用方式的规则

| 逻辑性质 | 建议位置 | 不应采用的方式 |
| --- | --- | --- |
| 同一模块内、不同入口重复的机械步骤 | 模块私有公共实现，消费者共用 | 为一个 helper 增加 Module/Port/服务 |
| 具有明确业务权威的跨模块判据 | owner 的窄公开函数或端口；最终受理仍校验 | 因为无 I/O 就一律下沉 Contracts |
| 共同协议值、规范编码、结构校验 | 已有 Contracts 的有归属单元 | 把业务政策、数据库读取、调度塞进 Contracts |
| 同一领域规则适配多个存储后端 | 领域模块内部的公共规则＋薄 Adapter | 内存和 SQLite 分别维护一套规则 |
| 无业务语义的底层 I/O 原语 | 已有 Storage 等内部共享基础 | 用一个通用 Repository 抹平所有持久语义 |
| Kernel 已有的会话/循环/恢复机制 | Runtime 薄适配、引用和必要平台投影 | 平台复制一套 Kernel 记录或执行循环 |
| 外观相似但业务含义不同 | 保留独立语义，最多复用原语 | 强行统一 enum、预算、错误、身份、授权范围 |

**“纯函数”说明计算方式，不说明业务归属；“用了同一个接口”也不说明实现已经共用。** 可以让多个消费者直接调用 owner 的纯政策实现，不必为复用增加运行时服务。

### 6.2 建议纳入模块总表的共用实现清单

| 共用内容 | 唯一 owner / 实现范围 | 消费者 | 必须保留的差异 / 旧路径去向 |
| --- | --- | --- | --- |
| Ledger 回执的共通拒绝映射 | Control 内部提交支持 | 各命令族 | 业务拒码各自保留；替换核实为等价的副本。 |
| 角色准入与初始候选来源规范化 | Control 公共政策面 | Dispatch、PlanCompiler、读侧解释 | 最终提交仍按当前事实复核；停止跨模块直引私有 policies。 |
| 领域事件→投影变化 | ReadModel 各领域投影单元 | 内存/SQLite Adapter | 存储与游标/原子边界不同；业务映射不再两份。 |
| 验证计划准备与执行 | Verification 内部 | 单项检查、轮次检查 | 轮次恢复、覆盖与聚合不能丢；旧入口按消费者迁移。 |
| 准入/材料准备公共步骤 | Dispatch 内部 | ordinary、parallel、Reviewer、Handoff 的适用步骤 | 运行类型及隔离要求保留，不求一条完全相同的流水线。 |
| 受限流消费与回答结构检查 | WorkerRuntime 内部 | 回答复核、用户审计等确认同构路径 | verdict、预算归属、审计持久化保持不同。 |
| 工作区拒绝路径协议值 | 按 R03 在 Reader 公共面/有归属 Contracts 中定一处 | Runtime、Verification、Reader | 安全边界与索引忽略不同；DI 不隐藏逻辑边。 |
| 材料读取/引用/增量处理 | ContextCompiler 内部 | 执行、规划、Query、Reviewer、图材料 | 触发点与用途分离；不预设端口数量。 |
| 结构编码/摘要/类型守卫 | 已有 Contracts，或仅模块内部 | 实际需要同协议的消费者 | `undefined`、编码、错误路径不同先核对；优先用已有 `sha256Hex`。 |
| commitKind 的共通结构校验 | StateLedger 已有 validation 单元 | 两 Adapter | CAS、身份槽与事务内检查仍在提交边界。 |
| 正文 put/open 与授权/完整性 | ArtifactVault 已有核心 | 内存/SQLite 后端 | 不与可变 journal、正式 Ledger 合并语义。 |
| 原子文件替换 | 已有 Storage | 需要这种持久语义的实现 | 不由它拥有记录模型、授权或恢复业务。 |
| Host 装配与后台关闭 | Host/Composition | 启动、HTTP/UI 入口 | 不承接规划、验证或完成权威。 |

已有正面样板应保留：[Contracts validation 的分层说明](/home/hyh001/projects/coding-platform/coding-platform/src/contracts/validation/README.md:3)、[Ledger 共用校验](/home/hyh001/projects/coding-platform/coding-platform/src/data/state-ledger/ledger-validation.ts:1)、[Vault 核心](/home/hyh001/projects/coding-platform/coding-platform/src/data/artifact-vault/artifact-vault.ts:68) 与 [SQLite 薄适配](/home/hyh001/projects/coding-platform/coding-platform/src/data/artifact-vault/sqlite-artifact-vault.ts:5)。它们证明现有代码并非毫无复用基础，无需推倒重建。

## 7. 大文件与模块划分的判断

本次按当前源码实际行数统计。数字只定位调查对象，不是拆分阈值，也不是性能收益证据。

| 文件 / 当前行数 | 判断 | 推荐动作 |
| --- | --- | --- |
| `sqlite-read-model-index.ts` 4231；`read-model-index.ts` 3262 | 同一业务映射跨后端重复，且规则与存储交织 | 优先共享领域投影、薄化后端，再按责任族拆文件。 |
| `coordination-drive.ts` 1241 | 扫描、计算、持久协议、准入集中 | 在 Dispatch 内按上述四类职责拆，不新增 Module。 |
| `contracts/coordination.ts` 1869；`contracts/ledger.ts` 1063 | 类型/协议密集，长度本身不证明业务过重 | 按协议家族拆定义、保持稳定导出；不把类型文件等同运行热点。 |
| `sqlite-ledger.ts` 1200；`in-memory-ledger.ts` 1034 | 已有共享 validation，仍有后端分派重复 | 共用机械分派，事务行为留 Adapter；无需新验证框架。 |
| `app/service.ts` 1047，其中服务工厂 862 | 装配、路由、后台生命周期、聚合集中 | 明确 Host 内部责任，不能漏出模块重构范围。 |
| `work-run-materials.ts` 929 | 已有领域步骤，不能凭长度宣称未分责 | 对实际读取/引用重复继续调查，保持消费者语义。 |
| `control-engine.ts` 918 | 已有多个子引擎委托，门面长不等于全部业务挤在一类 | 公开窄能力组与内部支持；不要再复制一个上层总门面。 |
| `persistent-platform.ts` 883 | 组合根较大，主要评估装配耦合 | 按业务能力组合装配，避免掌握内部策略或状态。 |
| `coding-agent-runtime.ts` 324，其中 execute 集中约百行 | 行数较少也可能职责过多 | 环境准备、Kernel 调用、公开观察和结果适配分开。 |

模块划分是否合理，应看是否有独立权威、独立变化原因和清晰消费者，而不是看目录是不是大于某个行数。当前分层仍有合理依据：Control 决定正式推进，Ledger 原子保存；Dispatch 安排执行，Runtime 适配 Kernel；Context 编译材料，Reader 捕获来源，Vault 管正文；Verification 组织检查，Reconciler 处理架构差异。拆成更多 Module 会增加契约和依赖成本，现有证据首先支持内部拆分与共享实现。

## 8. 13 个模块的定向结论

| 模块 | 建议保留的边界 | 本轮具体修订方向 |
| --- | --- | --- |
| HumanCollaboration | 面向人接请求、解释、返回正式回执 | R01：目标能力命名、提供/消费分开；保留主动提醒与直接介入，软件模块不替角色写死能力。 |
| PlanCompiler | 候选/草稿生成，初始/人工/变更/返工的真实消费者 | R02：确认要求区分目标与代码；D03：来源规范化复用 Control 权威；不把各类规划都压成一个 mode 开关。 |
| ControlEngine | 正式归约、权限/版本/义务/租约守卫 | D03：内部提交支持共用、政策窄公开；现有子引擎保留，不能因门面长拆散权威。 |
| DispatchEngine | outbox、准入、占用/租约和运行事实回流 | R02、D04：目标分支单列，通信驱动内部分责，多入口共用必要机制。 |
| VerificationEngine | 检查、审阅、证据组织；完成归约交 Control | R03、D02：路径政策合法共用；检查准备/执行共享；纠正旧入口完全不生产的表述。 |
| ArchitectureReconciler | 差异/Finding/Brief/候选，人的决定与激活在其他边界 | 暂无足够证据要求拆模块或加共用层；继续落实已登记真实图来源和容量契约。 |
| AgentLifecycle | 复用/产生/拆解/压缩/归档的决策与提案 | 保持小，明确接管后旧选择/身份推导路径去向；不再承担材料装配、执行或通用恢复。 |
| WorkerRuntime | Kernel 能力适配、运行环境、必要公开事实 | R03、D05、D06：政策/流消费复用，减少事件正文副本，分离环境与 Session 调用。 |
| StateLedger | 原子事务、CAS、幂等与正式事实存储 | 保留已有 validation 复用；机械分派可收敛，事务检查不能移到事务外。 |
| ArtifactVault | 正文、来源、完整性、授权适用性及必要 journal | 保留共用核心/薄存储适配；配合 D05 先定保留范围，再增量化。 |
| ReadModelIndex | 已提交事实的可重建查询投影 | D01：一份领域投影规则供两后端；图/卡片扩展不再复制新事件处理。 |
| ContextCompiler | 按需有界编译，触发与消费用途分离 | D07：共同步骤有明确内部落点；保留用途专用契约，不堆统一包装层。 |
| WorkspaceReader | 只读来源捕获、工作区边界、图来源 | R03：共享政策的 owner/消费者定清；一次捕获多页读取方向保留。 |

## 9. 建议的最小文档修订包

不需要给每个模块新增长篇实现方案。建议在现有五要素内完成以下改动，并用总表集中记录共用关系。

1. **修正公共接口表。** 分清当前接口、目标变化、消费端口和内部实现；为尚未命名的关键候选面给可引用标识；修正 R01/R02。
2. **在职责内加一小段“内部责任与共用实现”。** 每模块只写真正需要迁移的部分，允许“无新增内部拆分”。不要求所有模块为了模板而多造一层。
3. **在 ownership-map 增加“共用实现与旧路径去向”表。** 字段为：共同逻辑、唯一 owner、消费者、保留差异、旧路径去向、等价/成本检查。采用第 6 节具体条目作为候选。
4. **架构只补必须的承接。** 明确 Module、模块内部责任单元、共享协议和 Host 的区别；R03 若需新逻辑边，先修改架构决定。不能用“共享”规避依赖规则。
5. **Prompt 4 确定边与公开面的取舍，Prompt 6 给实施迁移。** 把已证实的重复列为有 owner 的改造项，再给删除点、数据/调用方兼容及回滚。后续验收必须看到旧路径退役，不能只验新路径能跑。

### 9.1 一个接口行应该怎样写

以下只是文档写法示意，名称为本报告提出的候选，不表示已经存在或批准新的 API。

| 候选能力 | owner → consumer | 输入/结果 | 约束与现状 |
| --- | --- | --- | --- |
| `WorkSessionViewPort.query` | HumanCollaboration 提供给 Host；内部消费 ReadModel | 项目/工作范围、游标 → 卡片/Session 视图、更新时间或未就绪 | 只读、不调用模型；目标候选。不能把 ReadModel provider 当成人机模块自己的存储。 |
| `PlanExplanationPort.explain` | HumanCollaboration 提供给 Host，内部经既有派发 | 具体方案引用/版本、追问 → 回答或异步运行引用 | 不生成新方案、不隐式应用；若续用 Session 则明确产生消息与预算。候选也可并入已区分语义的 query。 |
| `SessionControlPort.request` | HumanCollaboration 提供给 Host，内部提交 Control | Session/Run 范围、动作、请求身份 → 正式受理回执/拒绝 | 受理不等于执行成功；沿已有执行结果回流。候选名称不意味着另造命令总线。 |
| 角色准入解释的窄公共面 | Control 提供，Dispatch/读侧消费 | 精确配置及事实输入 → 允许/拒绝/未知与依据 | 可为纯公共函数，无须新增服务；最终 claim/提交重新校验。 |

文档应能表达这些关系，但无需提前决定所有 HTTP 路由或持久字段。

### 9.2 怎样证明这次确实减少复杂度

| 目标 | 应检查的证据 | 不足以证明的东西 |
| --- | --- | --- |
| 去重复 | 一处规则实现、明确消费者、等价旧副本已移除/仅薄适配 | 文件数变多、接口名变少 |
| 减职责集中 | 内部单元按变化原因独立，纯计算不依赖存储/Runtime | 把大文件平均切块 |
| 提升复用 | 新增场景主要组合既有机制，保留业务差异 | 万能入口携带大量 mode/optional 字段 |
| 降低成本 | 连续消息绕过编译、读取/捕获/写入次数及实际用量对比 | 缓存存在、代码行数下降 |
| 保持原功能 | 初始确认、目标变更、Query、Reviewer、Handoff、失败/恢复等真实路径保持 | 只验证新增 Lifecycle 的演示路径 |
| 减少重复记录 | Kernel 原始材料改走引用；必要平台事实有独立用途 | 仅把重复正文改成增量副本 |

不要求为机械小改写大量镜像测试；对投影共享、事务边界、准入路径和记录迁移，应保留有意义的行为与恢复验证。本文未运行这些测试，也不声称已获得性能或金额收益。

## 10. 与前轮报告、历史分析的关系及验证范围

- [前轮报告](/home/hyh001/projects/coding-platform/docs/refactor/MODULE-REVIEW.md) 是 9 月 21 日时点的审查。当前模块稿已补初始确认、归档义务、三种记录、协作边、成本责任等多项修订，不能把前轮 21 项直接当作当前剩余问题。本次不覆盖其历史内容，也不声称逐条完成代码验收。
- [根目录源码分析](/home/hyh001/projects/coding-platform/source-analysis.md:290) 用于定位重复实现；[大文件/职责集中分析](/home/hyh001/projects/coding-platform/source-analysis.md:789) 用于确定抽查对象。关键主张再回到当前源码核实，历史行数、状态和推论不直接搬作当前事实。
- [旧文档清单与 Prompt 建议](/home/hyh001/projects/coding-platform/docs-inventory-and-prompt-suggestions.md:1456) 用作原话、规范和接口的导航；没有把其旧结论当成当前目标权威。
- 三个子 agent 分别核对 Control、Data/Runtime、作者意图与 Prompt 3，主审交叉核对共享边界、Host 和关键代码证据。审查覆盖全部 13 篇模块稿，源码为定向抽查，非全量形式证明。
- 机械核对当前 13 模块、38 条正向/反向依赖表与架构一致且无环；它无法证明公共端口正确、DI 没隐藏逻辑边或重复实现已消除。
- 本文是设计审阅与可落地的修订输入，不是已批准的新接口契约。未修改原模块、架构、旧文档仓和代码，未运行产品测试。输出前检查了本地引用存在、行号有效及读取基线未变化。
