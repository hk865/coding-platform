# coding-platform 重构分阶段 Prompt 合集

版本：v3.3，2026-09-24；已执行独立目标工程纠偏及 DSH 两阶段审核。适用于当前“数据结构与原子操作 → 行为与编排状态机 → 文件级骨架与模块划分 → 分批迁移”的设计。

**当前接手位置：在 `coding-platform/next` 按 Prompt 8 实施后续 R 子批，再按 Prompt 10-D 独立验收。** 当前已验收初始Plan/任务事实、Session创建/历史、角色与持久observed图、模型循环连续历史转发，以及任务关系/精确输入和[R4c.1 Task原子领取](refactor/reviews/next-r4c-claim-2026-09-24.md)，独立副本60文件/422项通过。完整R3c授权变更、R4执行链及R5/R6仍未完成，详见[HANDOFF](refactor/HANDOFF.md)。原工程报告只作历史参考。Prompt 5调查及Prompt 2/3/4/6设计继续复用，按本批真实缺口细化。当前分工为 **Astra架构/接口 → DSH 4.1F骨架与测试 → Astra审核冻结 → DSH实现 → Astra审阅 → 隔离测试**；第一次DSH调用交骨架/测试后必须停止，不能略过中间审核，见[DSH工作流](refactor/DSH-WORKFLOW.md)。

旧版全文已[原样归档](refactor/archive/2026-09-23-prompts-v2/refactor-prompts.revised.md)，[归档说明](refactor/archive/2026-09-23-prompts-v2/README.md)记录摘要校验。旧版用于追溯，不再作为可执行提示词。各条代码块可单独复制；它们都指定了读取本文件公共规则和本阶段设计的路径，不依赖接手者拥有聊天记忆。

## §1 文档依据、真实路径与当前状态

```text
W = /home/hyh001/projects/coding-platform
C = W/coding-platform                         # Git 仓；原源码只读参考
T = C/next                                    # 独立目标工程，后续默认施工/运行根
N = W/docs/refactor                           # 本轮当前目标设计与交接资料
D = W/my-coding-platform-docs/agent_platform   # 旧文档仓及兼容/历史资料
K = C/vendor/coding-agent                     # 内置 Kernel，独立工程
```

本文件下文文档路径相对 W；后续源码 `src/...` 和工程命令默认相对 T，旧 `C/src` 仅作来源对照。原路径写法若与本段冲突，以本次纠偏和当前任务书为准，不擅自把新实现接回旧服务。文档类别与历史位置见 docs/README.md；history/、archive/ 和原话记录只读溯源，不作为当前施工指令。N 中的文件是目标设计；真实实现位置、行为和完成状态必须查当前源码与运行证据。

| 要判断什么 | 当前依据 | 使用规则 |
| --- | --- | --- |
| 用户意图、已经决定的边界 | [HANDOFF](refactor/HANDOFF.md)、[INTENT-AND-DECISIONS](refactor/intent/INTENT-AND-DECISIONS.md) | 用户原话与工程选择分别列出；有冲突时追溯具体原话，不把早期助手意见当用户要求 |
| 产品行为 | [当前 PRODUCT](PRODUCT.md)、[当前意图与决定](refactor/intent/INTENT-AND-DECISIONS.md)、[原始对话](refactor/intent/ORIGINAL-DIALOGUE.md) | 共同核对产品、架构、相关模块与用户原话；历史原稿只读保留，后续明确纠正优先 |
| 原始对话与人类意见 | [本轮原话及草图](refactor/intent/ORIGINAL-DIALOGUE.md)、[此前 14 段原话](history/before-2026-09-22/agent-platform-user-replies-numbered.md)、[此前已决意见](history/before-2026-09-22/agent-platform-open-decisions-recommendations.md) | 按问题读取，不强制每轮全量装入；原话不因新设计而改写 |
| 数据结构及工具 | [CORE-DATA-OPERATIONS](refactor/CORE-DATA-OPERATIONS.md)、[静态结构与状态机图解](refactor/CORE-STRUCTURES-AND-ORCHESTRATION.md) | 身份、记录、邻接、索引、占用、读写集与原子边界 |
| 行为与状态转移 | [ORCHESTRATION-STATE-MACHINES](refactor/ORCHESTRATION-STATE-MACHINES.md) | 前置条件、实际操作、失败恢复及 A1–A12 场景 |
| 架构与源码依赖目标 | [ARCHITECTURE](refactor/ARCHITECTURE.md)、[module-dag](refactor/module-dag.md)、[module-target.json](refactor/module-target.json) | 当前推导为 5 模块、8 条边；数量不是优化指标或不可改变的门槛 |
| 主要接口、内部文件与旧代码去向 | [骨架总览](refactor/skeleton/README.md)、[共同契约](refactor/skeleton/CONTRACTS.md)、[模块索引](refactor/modules/README.md)、[ownership-map](refactor/modules/ownership-map.md) | 逐文件/操作施工依据；不是只给五要素的概述 |
| Host、Kernel、UI 贯通 | [END-TO-END](refactor/skeleton/END-TO-END.md) | 真实装配与返回路径，不以 Fake 或空门面代替 |
| 实施顺序与完成状态 | [IMPLEMENTATION-PLAN](refactor/IMPLEMENTATION-PLAN.md)、[refactor-plan](refactor/refactor-plan.md)、[逐批验收](refactor/reviews/implementation-batches.md) | R0–R6 的唯一阶段主线；Prompt 6 的详细计划只细化这些批次 |
| 当前源码、数据格式与依赖 | C 的实际文件、测试、`scripts/module-map.mjs`、真实运行记录 | 旧 source-analysis 是调查线索，必须复核；设计文档和旧 PASS 都不是当前实现证据 |
| 旧约定与兼容要求 | D 的 interfaces、human、decision、planning 及 N 的 archive | 保留仍适用的行为和数据约束；已被本轮用户决定取代的目标、门禁不重新引入 |
| 外部实现参考 | [agent 对比](history/before-2026-09-22/agent-vs-agent-team.md)、[deepseek-harness agent-team 调研](history/before-2026-09-22/agent-team-dsh-research.md) | 用于核对已选择的通信/编辑机制；参考项目的约束不自动成为本产品要求 |

截至本次进度同步，详细设计及 refactor-plan 已有产物；R1 完成捕获去重、R2a 完成 WorkspaceTools 所有权和消费者迁移，R2b/R2c/R2d.1/R2d.2/R2d.3 已验收、R2e.1 待主Agent验收，其余R2e待实施。完整 Session、真实连续 Context、统一执行及相关 UI 待实施；ui-visual-spec.md 仍是 UI 阶段待产出文件。以逐批验收的最新记录为准。

## §2 每条 Prompt 共用的设计边界

1. **先数据和行为，再模块。** 当前/历史 Session 与当前/历史文件是来源维度；D1–D8 是为查询和更新维护的专用结构，不等于八个顶层模块或八个数据库。图可以保存正式关系，也可以保存可重建索引，由用途决定。
2. **业务与核心分工明确。** Workflow 决定下一步；WorkGraph 维护领域结构、合法性和完整提交；AgentRuntime 适配真实执行与恢复；WorkspaceTools 维护文件/Git/解析/捕获；RecordStore 提供物理持久化。核心不是任意改状态的裸 CRUD，业务也不手工同步各张表。
3. **生命周期是能力，不强制独立包装。** 选择和处置策略、平台 Session 状态、实际 Kernel 操作分别落位。Role/Skill 是版本配置，Session 承载连续工作，Run/QueryRun 表示一次执行。多个 Session 可以并行，同一 Session 的执行与维护竞争同一占用槽。
4. **图定位与工具取事实。** 已知路径或引用可以直读。普通文件、图、材料和原始历史查询不需要 LLM、虚构 Run 或 baseline；只有实际语义推理才进入 QueryRun。Agent 回答、确定性观察、已采用决定和正式证据分别保存来源。
5. **状态循环与依赖图分开。** 任务前置、目标模块依赖保持 DAG；源码观测图保留真实环，通信可往返；业务可检查/返工循环，执行实例按因果引用向前追加。timeline 增长不自动表示进展。
6. **原子边界具体。** 必要记录、同步索引、唯一槽、事件、幂等回执共同提交；异步投影公开水位。数据库事务不包含 Kernel/命令/文件副作用；先受理，再执行，再核对观察。unknown 不等于未执行，不盲目重跑或释放占用。
7. **连续 Context 必须真实接通。** 按 Runtime 骨架实现 Kernel 最小公开扩展，历史选择、预算与检查点由 Kernel 承担；平台不再维护第二套原始会话日志/历史选择器。同 Session ID 不证明历史进入下一轮，native compact 未支持时如实返回 unsupported。
8. **结果反向维护结构。** 工具结果按版本和来源更新有关索引、任务及会话关联；保留必要使用点的来源/权限/并发核验。冻结捕获与持久来源不同，检查轮次分别绑定自己的来源和配置。
9. **复用实现、退役旧路径。** 先读[已实现能力索引](refactor/IMPLEMENTED-CAPABILITIES.md)及其相关源码/消费者/测试，复用适用解析器、事务、引用和执行机制；旧消费者逐类迁移，清零后删除旧实现。不得把所有旧模块完整包在新门面下，也不得为了模块数强行合并。
10. **保留产品与兼容行为。** 保留已有命令入口、`127.0.0.1:4317` 默认监听（PORT 可覆盖）及 `PLATFORM_GUI_DATA`。内部接口可以演进；持久 schema、真实调用方破坏和 Kernel API 变化要有兼容/迁移方案；路由新增、视觉改版本身不强加数据迁移。

11. **不恢复已撤回的额外流程。** 不新增永久 Agent 人格、每次工作的身份登记仪式、全历史复核、常驻监督模型或通用自动接管平台。保留具体执行所需的身份、权限、来源和恢复核验；通过核心操作承担这些必要复杂度。

## §3 执行纪律与验收口径

- 先读相关 `AGENTS.md`、本轮输入和真实消费者，再开始本阶段工作。源码开工先看 Git 工作区，保留用户未提交改动；修改 K 前再读其 AGENTS 与 INTEGRATION。不凭日期、旧 commit、目录是否存在的旧说明推断现状。
- 继承已有授权。已定的数据结构方向、普通文件拆分、索引和接口细化由实施者落实，不每阶段重新确认。只有新的产品范围、确有多种不可兼得结果且当前授权无法决定的取舍，才给出具体差异、推荐及需人决定的点；其他工作继续。
- 本阶段内允许同步修改保持一致所必需的调用方、契约、装配、文档和测试。改变产品语义或扩张无关范围不属于例行同步；不要用“只能改一个模块”阻断已授权的真实迁移。
- 区分“当前源码”“目标设计”“本批已实现”“待实施”。新结构可设计，但不可声称已经存在；文档检查、源码检查和真实运行证据分开报告。
- **直接审阅结果**：列出主路径调用跳转、同义规则副本、删除/保留的旧实现、生产代码及测试/生成文件分别统计的行数、关键逻辑可读性、UI 行为前后对比。不靠模块数或净减行数单独判断正确性与性能。
- **性能声明有对应证据**：对相同输入比较捕获/扫描次数、读取或写入字节、实际模型调用等相关工作量；只测相关路径。未测延迟、金额或命中率不编造收益；不把“大型真实任务对照/消融实验”新增为每批前置条件。
- 历史模型价格、缓存比例和费用样本仅属其原版本。确需金额测算时记录实际模型、价格来源/日期、token 与命中口径；未调用模型的结构迁移不强填“每步金额判据”。原报告中不可复现的 77.48% 不作当前基线。
- 按变化运行有意义的验证。纯文档修改检查链接、契约、图及引用一致性；代码修改运行相关行为测试、类型与依赖检查；入口/打包变化检查构建；UI 验证实际交互及视觉。不要以机械增测试或重复全量测试替代验收。
- 当前 C 的 Node 要求为 `>=24.15.0 <25`；可用工具链位置见 HANDOFF，执行前复核 package.json。已有 typecheck 与 check:architecture，不能写“无静态检查”；未配置 lint/format 则如实说明。依赖已存在时不因系统 Node 版本不符而重装。
- 路径失效先用路径规则和仓库搜索定位；仍缺失时说明具体影响，继续无关部分，不伪造来源。不得将旧文档的“未定稿”总门禁覆盖本轮已经明确的授权。

## §4 阶段、输入与下一步

| Prompt | 本阶段任务 | 前置与可并行性 | 产物/完成含义 |
| --- | --- | --- | --- |
| 1 | 产品意图增量对齐 | 仅有新产品要求或真实冲突时执行；可与 5 并行 | 当前 PRODUCT 与差异说明，不重新询问已定定位 |
| 2 | 数据结构、操作、状态机与总体架构 | 依据当前产品/用户决定；可与 5 并行 | 数据/行为设计链收敛，不先固定旧模块名字 |
| 3 | 文件级模块骨架 | 基于 2；独立内部组件可并行，共同接口统一核对 | 关键文件、完整主要接口、算法、事务、失败与迁移 |
| 4 | 模块归属与目标 DAG 对账 | 核对 2/3；可与 5 并行 | 模块页、ownership-map、DAG、JSON 一致，源码现状另列 |
| 5 | 相关源码事实与迁移差距 | 可独立增量执行 | 具体入口、消费者、重复工作及实际能力证据 |
| 6 | 可执行批次计划 | 2/3/4 当前设计齐备，5 的本批事实已复核 | 按 R2–R6 细化真实路径、契约/迁移/删除/验证；不改源码 |
| 7 | 接手入口与文档路由整理 | 依据 6；与无冲突的实施准备可并行 | 入口指向当前设计，历史保留；不以回填 D 作为源码实施前提 |
| 8 | 批次实施 | 本批计划与前置实际满足，接手规则可定位 | 真实路径及调用者迁移、旧代码退役、验证和证据 |
| 9 | UI 与用户路径 | 依赖本批真实 API/状态契约；可与不冲突的 8 并行 | 实际可用交互、视觉规范、前后对比 |
| 10 | 独立评审 A/B/C/D | 相应产物完成即可 | 具体缺陷、影响、依据、建议；不为评审再建业务审核层 |

现有 R0/R0b/R1 与 R2a/R2b/R2c 分别按其验收证据认定完成。后续不从 Prompt 1 全部重跑，也不将 Prompt 编号当运行状态机。目标模块 DAG 描述源码依赖，不直接等于开发批次 DAG；共享契约、同一提交边界及真实消费者决定能否并行。

## Prompt 1：产品文档增量对齐

````text
请检查并增量修订当前产品文档，不重做已经明确的产品定位。

工作区：/home/hyh001/projects/coding-platform；代码仓为 coding-platform/。
先读 docs/refactor-prompts.revised.md §1–4 的公共规则，不执行其中其他 Prompt。
必读：docs/PRODUCT.md、docs/refactor/HANDOFF.md、docs/refactor/intent/INTENT-AND-DECISIONS.md。
涉及原话争议时，定位 intent/ORIGINAL-DIALOGUE.md 与 docs/history/before-2026-09-22/agent-platform-user-replies-numbered.md 的相应段落。

任务：
1. 核对新要求是否已包含；已包含就保留，不为完成本 Prompt 再改写一遍。
2. 产品按用户行为表达：询问项目、提出/修订目标、查看两图及历史、解释方案、连续或并行工作、处理真实需人取舍的决定。
3. 保留人已授权范围内的推进；不得把每次提问转成新计划、每个细化都转成人工确认。
4. 区分角色配置、Session、执行与当前可用能力。长期知识库、原生压缩等未实现能力不写成已具备。
5. 实质新产品取舍给出具体前后行为和推荐；既有决定无需重问。未决定处明确标注，不推断为已批准。

当前 PRODUCT 已由本次用户委托完成意图审阅，差异见 docs/refactor/reviews/product-intent-review.md。存在新的产品要求或真实冲突时更新当前 PRODUCT，并同步架构、相关模块及意图记录；历史 PRODUCT 仍只读。实施前共同查看 docs/refactor/intent/ORIGINAL-DIALOGUE.md 中的相关用户发言与最新补充，不以工程摘要代替原话。
不把模块清单、SQL 或源码目录写成产品流程；不改源码，不改原话。
交付：逐项“原表述→新表述→用户依据→是否还有取舍”，以及仍未实现的承诺。
验证：产品行为与当前意图一致，链接有效，历史成本样本没有被当作当前性能事实。
````

## Prompt 2：核心数据、行为、状态机与总体架构对齐

````text
请按已经确定的方向核对并补齐系统设计，不重新恢复旧 13 模块方案。

工作区：/home/hyh001/projects/coding-platform。
先读 docs/refactor-prompts.revised.md §1–4 的公共规则，不执行其他 Prompt。
必读：docs/PRODUCT.md；docs/refactor/ 下的 HANDOFF.md、intent/INTENT-AND-DECISIONS.md、
CORE-DATA-OPERATIONS.md、ORCHESTRATION-STATE-MACHINES.md、
CORE-STRUCTURES-AND-ORCHESTRATION.md、ARCHITECTURE.md、skeleton/CONTRACTS.md。

按以下顺序检查，已有完整设计复用，仅修缺口：
1. 四类来源与 D1–D8：保存哪些事实、稳定身份/版本是什么、正式记录与可重建索引如何区分。
2. 每类管理结构：逻辑键、正反邻接/集合/排序索引、分区、游标、水位、失效及重建边界。
3. 原子操作：输入/输出、读集、前置与范围约束、同事务写集、幂等回执、失败分类；更新后哪些关联必须同步维护。
4. 外部执行：受理、实际执行和观察分别是什么，崩溃/响应丢失/unknown 如何恢复；不要画跨 Kernel、文件和数据库的大事务。
5. 行为与编排：普通读取、语义查询、计划变化、领取/执行、Session 延续/维护、通信、检查/返工、完成、取消的触发条件和停止条件。
6. 明确持久字段、派生状态、业务步骤和 UI 展示的区别；状态可循环但实例历史保留，源码观测环不套用任务 DAG 规则。
7. 最后核对模块职责与依赖；当前 Workflow、WorkGraph、AgentRuntime、WorkspaceTools、RecordStore 的划分已有依据，不为数量改设计。

产物：在上述 N 内设计文件对应章节增量修订；静态 Mermaid/文本图同步到 CORE-STRUCTURES-AND-ORCHESTRATION.md。
架构页写系统责任与跨边界约束；完整接口、内部文件和旧实现去向由 Prompt 3 对应文档落实。
若改变共同字段或依赖，同步列出受影响模块页与 DAG；不能留下互相矛盾的上位设计。
禁止：只添加 AgentLifecycle 包装；强迫普通读经过 ContextCompiler；把所有图压成一个万能图表；将设计写成已实现。
交付：具体设计缺口、所改章节、用户依据与工程选择分别说明、涉及模块与后续施工影响。
验证：操作能从来源和结构追到状态转移，现有 A1–A12 有承接，设计/图/共同类型一致；不改源码。
````

## Prompt 3：详细模块骨架与文件级设计

````text
请使目标模块文档达到“无本次聊天记忆的 Agent 能直接接手”的程度，不止五要素概述。

工作区：/home/hyh001/projects/coding-platform。
先读 docs/refactor-prompts.revised.md §1–4、docs/refactor/HANDOFF.md。
必读 docs/refactor/ 下的 ARCHITECTURE.md、CORE-DATA-OPERATIONS.md、ORCHESTRATION-STATE-MACHINES.md、
skeleton/README.md、skeleton/CONTRACTS.md、skeleton/END-TO-END.md、modules/ownership-map.md。
当前五篇模块页：
- docs/refactor/modules/business/workflow.md
- docs/refactor/modules/core/work-graph.md
- docs/refactor/modules/core/agent-runtime.md
- docs/refactor/modules/core/workspace.md
- docs/refactor/modules/core/record-store.md

逐模块检查并补齐：
1. 产品行为、职责、非职责、输入来源、正式状态归属及真实消费者。
2. 目标目录树和关键小文件：每个文件的职责、主要函数/类型、局部依赖与调用顺序；无需把每个函数拆一个文件。
3. 完整主要接口签名：作用域/身份、引用/版本、分页/取消、成功结果、冲突/缺失/过期/未知/不支持等必要失败语义。
4. 内部关键逻辑：检索/选择/比较/归约算法、必须维护的索引及增量范围；不使用“交给底层”省略实现责任。
5. 操作读写集、并发与幂等、唯一占用、事务边界、外部副作用与恢复；业务策略和机制分别落位。
6. 接口处置表：原样保留、适配/扩展、替换、删除；每项有旧签名/消费者、目标入口及退役条件。
7. 旧文件/函数到目标文件映射、兼容窗口和删除条件；数据迁移只针对实际旧数据，不制造不存在的旧 Session 表。
8. 验证例子：一条正常路径和相关失败/竞争/恢复路径，标明 Host、Kernel 或 UI 接线位置。

共同类型以 CONTRACTS 为准，模块页直接解释本模块使用方式；发现冲突同步改定义及消费者，不能出现各自版本。
Kernel 连续 Context 必须包含真实历史输入、稳定存储/run/turn 身份及旧调用兼容；未实现能力标记待实施/unsupported。
生命周期与旧 ContextCompiler 的用途逐类移交，不因删除模块名丢失功能，也不原样搬入新的总门面。

修改范围：N 的五模块页、模块索引、ownership-map、skeleton；确需上位调整时同步相关架构/数据/状态/DAG 并说明原因。
不改源码、不创建只有接口名的空实现。交付文件级缺口与修订、接口迁移表、真实实现待办。
验证：模块间签名和消费关系一致，每个旧职责有去向；新 Agent 不需临场猜关键结构、字段或恢复规则。
````

## Prompt 4：模块归属与 DAG 一致性核对

````text
请核对目标模块划分及依赖，不把“无环”当作职责合理的全部证明。

工作区：/home/hyh001/projects/coding-platform。
先读 docs/refactor-prompts.revised.md §1–4、docs/refactor/HANDOFF.md。
输入均在 docs/refactor/：ARCHITECTURE.md、module-dag.md、module-target.json、modules/README.md、
modules/ownership-map.md、五篇目标模块页、skeleton/CONTRACTS.md、skeleton/END-TO-END.md；
源码现状另读 coding-platform/scripts/module-map.mjs 与真实 import/注入消费者。

任务：
1. 从数据/操作/执行责任核对目录归属，不依据旧 plane 或模块数反推设计。
2. 当前目标 8 边：Workflow→WorkGraph/AgentRuntime/WorkspaceTools；
   AgentRuntime→WorkGraph/WorkspaceTools/RecordStore；WorkGraph→WorkspaceTools/RecordStore。
3. 每条边写调用者消费的具体 Port/操作、必要性、参数/结果和状态写者；注入接口也算依赖。
4. 检查缺边、反向边、未声明共享写者、跨模块万能门面；消息回流不等于反向 import。
5. 正式模块 DAG 与任务前置 DAG、源码观测图、状态机/时间线分别说明；不得以 DAG 为理由删掉合法反馈行为。
6. 校验旧职责 M01–M13 去向；其中旧目标 AgentLifecycle 不等于实际存在的第 13 个源码模块。
7. 分别列出现状边、目标边和迁移期临时边；临时边写真实消费者及退出批次，不伪造不存在的目标目录已迁移。

修改范围：N 的 module-dag.md、module-target.json、ownership-map、模块索引和必要的关联设计页。
本阶段只检查源码，不提前修改实际 module-map；该 map 随 Prompt 8 的真实迁移更新。
验证：ID/目录唯一、依赖存在、目标无环、机器声明与 Markdown 一致、职责和旧消费者都有明确归属。
交付：发现的具体漂移、采用的修复、仍属于迁移期的差距；不为凑 5/8 而牺牲边界。
````

## Prompt 5：基于当前源码的增量调查

````text
请为接下来的重构批次核对真实源码，更新差距报告；本阶段不改生产代码。

工作区：/home/hyh001/projects/coding-platform；代码仓 coding-platform/。
先读 docs/refactor-prompts.revised.md §1–4、docs/refactor/HANDOFF.md、coding-platform/AGENTS.md。
设计对照：docs/refactor/IMPLEMENTATION-PLAN.md、相关目标模块页及 docs/refactor/skeleton/CONTRACTS.md。
历史线索：docs/history/before-2026-09-22/refactor/source-analysis.md、docs/refactor/reviews/core-design-implementation-evidence.md。

若用户未指定调查范围，从当前 IMPLEMENTATION-PLAN 的实际状态选择最早未完成且前置满足的批次及其直接前置（本版修订时为 R2）；需要安排 Prompt 6 的其他批次时，补齐该批关键入口与风险证据。
1. 核对当前 Git 状态、源码布局、package.json、实际 module-map 和待调查路径；保护已有改动。
2. 对每项列“真实文件/函数/行号→入口和消费者→当前行为→目标操作/文件→保留/迁移/删除/待查”。
3. 区分无效重复与必要核验：同次分页重复捕获、累计平台日志重写、重复材料装配、全范围扫描；说明触发条件、次数、数据量及正确性目的。
4. 已有 R1 优化重新按相关源码核对，不能继续声称该旧重复尚未修复；未实现的 Session 选择器也不能被写成现有性能问题。
5. 查实际 Kernel 公共能力与上下文路径；涉及它时读 coding-platform/vendor/coding-agent/AGENTS.md 与同目录 INTEGRATION.md。Fake、同 Session ID、接口名、文档声明均不证明真实连续执行。
6. 核对当前持久表、完整引用、旧结果/历史可读性、真实调用方及控制/证据语义，避免迁移丢功能。
7. 问题缺证据就标记待查；确需运行相关测试/只读诊断时记录命令、输入和输出，不重复无关全仓调查。

产物：新建或更新 docs/refactor/reviews/source-gap-review.md，标明本次核查范围/版本，并从 HANDOFF/相关任务书链接。对照归档的 source-analysis 记录已修项和当前证据，不修改历史调查原稿。
交付：已证实差距、可复用实现、真实重复成本、下一批入口、尚未核实项。金额/延迟未测不作结论。
验证：每项源码结论有当前锚点；不把旧报告或目标文档直接当作现状事实。
````

## Prompt 6：细化可执行重构批次

````text
请将已完成的设计细化为可执行的迁移批次计划。本轮只写计划，不开始源码实施。

工作区：/home/hyh001/projects/coding-platform。
先读 docs/refactor-prompts.revised.md §1–4、docs/refactor/HANDOFF.md、docs/PRODUCT.md。
当前设计输入全部来自 docs/refactor/：IMPLEMENTATION-PLAN.md、ARCHITECTURE.md、module-dag.md、
CORE-STRUCTURES-AND-ORCHESTRATION.md、skeleton/CONTRACTS.md、skeleton/END-TO-END.md、
相关目标模块页和 modules/ownership-map.md。
现状输入：已产出的 docs/history/before-2026-09-22/refactor/source-analysis.md（Prompt 5，2026-09-20 基线）、docs/refactor/reviews/core-design-implementation-evidence.md（后续 R1 改动）及相关实际源码。直接消费已有报告；仅在具体变化或证据缺口影响本批计划时定点核对，不重新执行 Prompt 5，也不因其历史 draft 标记否认已有调查产物。不能拿 D 的旧模块页当目标。

已有阶段为 R0/R0b 设计与骨架、R1 架构读取优化、R2 工作区、R3 结构/存储、R4 Session/Kernel、R5 业务、R6 UI/退役。
先核验实际状态；不重跑已完成设计，也不重新要求用户选择“一次大改还是分批”。当前采用可验证、能退役旧路径的分批迁移。

每批或子批必须写：
1. 用户可观察行为、对应数据结构/原子操作/状态转移及源码问题依据。
2. 真实入口、旧消费者和目标文件；允许为该路径同时改契约、调用方、Host、存储及相关测试。
3. 具体接口处置：保留/扩展/替换/删除，输入/返回变化及受影响调用者。
4. 记录、索引、占用和幂等边界；旧数据兼容、迁移/回滚条件；临时适配入口的消费者与删除条件。
5. 前置、可并行部分和共享文件/接口的冲突点；模块依赖 DAG 不是唯一施工顺序。
6. 完成判据和命令：相关行为、类型/边界、必要构建、UI；真实 Kernel 验证单列。
7. 可读性与代码量对比方式、重复调用/扫描/写入的消除位置；不强填无依据的命中率或金额预测。
8. 本批完成后实际删除哪些旧路径；仍保留的功能和调用者如何继续工作。

R4 必须先落实 Runtime 骨架所定 Kernel 最小公开扩展及真实验证，再接平台连续执行；不另造平台历史拼接器。
普通 Run、QueryRun、维护操作共用 Session 排他；unknown、工作区租约、原始观察回放、证据/任务完成分别验收。
R6 将后端结构转为实际 UI 路径；不能等最后才发现接口无法提供历史、来源、关联或实际控制状态。

产物：docs/refactor/refactor-plan.md，按 R2a/R2b 等子批编号细化；IMPLEMENTATION-PLAN.md 保持阶段主线及状态，需要修订时同步，勿产生两套相互竞争的计划。
默认选择最小完整真实路径作为下一批；工程拆分自主完成。只有确有新产品取舍时列出具体选项和推荐。
交付：下一批可直接开工的文件/接口/消费者清单、依赖、删除条件、验证与回退，以及余下批次顺序。
验收：接手 Agent 无需再由用户提供模块目录和接口清单；不能用“待实现时设计”省略关键前置。
````

## Prompt 7：接手入口、文档路由与归档整理

````text
请整理本轮重构的 Agent 接手入口和文档路由，防止旧规则重新覆盖新设计。

工作区：/home/hyh001/projects/coding-platform。
先读 docs/refactor-prompts.revised.md §1–4、docs/refactor/HANDOFF.md、intent/INTENT-AND-DECISIONS.md、
IMPLEMENTATION-PLAN.md、refactor-plan.md，以及 coding-platform/AGENTS.md 中现行入口/路径规则。
上述 intent/计划相对 docs/refactor/；先检查文件是否已存在及适用阶段。

任务：
1. 保留有效的路径翻译、命令、用户改动保护和验证规则；入口指向当前 N 设计与实际源码，而非旧 12/13 模块目标。
2. HANDOFF 写本批已完成、未完成、下一真实入口、最小阅读包；实际状态以当下源码和证据为准。
3. docs/refactor/README.md、模块索引、骨架总览与本提示词入口互相可定位，不建立第二套用途重复的约定。
4. 对需要归档的文档先核对适用版本、替代者与引用；优先保留原件并建立明确历史/路由说明，归档原样复制且校验摘要。
5. 已有原话、草图、历史评审和 archive 不因新目标被改写；不要批量搬动 D 或把目标设计覆盖成已实现文档。
6. N 是当前目标设计入口，D 是历史/兼容来源。只有任务明确要求同步 D 时才执行对应同步，并保留迁移状态和引用；本轮源码实施不以回填 D 为前置。

修改范围：本轮必要的 coding-platform/AGENTS.md、N 中交接/索引/归档路由及对应引用；不改生产源码。
按当前已授权整理范围直接执行；若涉及原件删除、实质改变旧文档用途等未授权操作，先给具体对象和影响，其他整理继续。
验证：入口不再要求重走已取代的门禁；链接/归档摘要有效；命令核对 package.json；目标与源码状态没有混写。
交付：来源→当前入口/归档→替代者→原因，以及本批接手阅读路径。
````

## Prompt 8：按真实调用路径实施一批重构

````text
请实施已定计划中下一批满足前置的真实迁移，完成验证和旧实现退役。

工作区：/home/hyh001/projects/coding-platform；实际代码仓 coding-platform/。
先读 docs/refactor-prompts.revised.md §1–4、coding-platform/AGENTS.md、docs/refactor/HANDOFF.md。
输入：docs/refactor/refactor-plan.md、IMPLEMENTATION-PLAN.md、module-dag.md、module-target.json、
modules/ownership-map.md、该批相关目标模块页、skeleton/CONTRACTS.md 和 skeleton/END-TO-END.md。
除第一个完整路径外，上述设计路径相对 docs/refactor/。源码调查查当前代码及本批相关 source-analysis/评审。

批次选择：用户指定批次就采用；未指定则从计划选最早且前置实际满足的一批，开工说明批次、影响面和验证方式后继续，不要求用户填模块名/目录/接口。
若计划或关键契约尚未具备，先完成本批必要的调查和具体计划，明确阶段切换；不边猜关键语义边大范围搬代码。

施工分工必须分阶段：Astra先定本批接口/语义；DSH 4.1F只交骨架和行为测试并停止；Astra审核正反例和红测原因、冻结后，另起调用让DSH在精确生产文件范围实现，测试/接口只读。实现再经Astra审阅和物理隔离测试。已有Sol产物复用；独立文件范围可并行，各批中间审核不可省略。完整环境规范读docs/refactor/DSH-EXECUTION-HARNESS.md。

实施：
1. 检查 Git 工作区，保留既有改动。读 docs/refactor/IMPLEMENTED-CAPABILITIES.md 总览及本批条目，沿实际接口→实现/依赖→组合根消费者→测试确认已有能力和本批缺口；不是只读接口名。第一阶段交付同时列需求→复用符号→最小新增接线→测试，由 Astra 在骨架/测试冻结前审核，不能用新增同义实现绕过复用。
2. 以一条完整路径迁移接口、实现、调用方、Host/存储接线及相关测试；可以跨模块，但仅涉及本批所需范围。
3. 复用现有解析/事务/引用/执行能力。共享字段、scope、版本、失败结果使用共同契约，不建立近似的第二份类型。
4. 涉及领域提交时，正式规则经 WorkGraph 编译，RecordStore 只执行物理提交；旧 Ledger 按 command kind 的必要校验在迁完前保留，不为去依赖而提前删除。
5. 本批涉及 Session/执行时，创建/映射、领取、入口授权、实际进入、结果观察分别接通；continue 消费已有领取；QueryRun/维护同槽；工作区租约不由 Session 槽代替。
6. 本批涉及 Kernel 时，先读其 AGENTS/INTEGRATION，按既定公开扩展接真实输入与恢复；R4 子批先完成扩展的独立验证，再接平台。其他批次不顺带实施 R4；不把 Fake、同 Session ID 或平台摘要当作连续 Context。
7. 本批涉及材料、历史或捕获时，读取走真实 host/执行身份与权限，不伪造 Run；捕获复用保留版本/权限/失效与最终核验。
8. 真实文件移动时同步 scripts/module-map.mjs、允许边、Host 和边界测试。迁移期保留的旧模块/临时边要有消费者和退出条件。
9. 本批消费者清零后删除旧副本/兼容导出；不得只新增目录、门面和无调用者接口来宣称完成。
10. 同步本批设计、实施计划、交接状态及 IMPLEMENTED-CAPABILITIES.md 中受影响的状态/符号/前提/证据；偏离设计写具体原因，涉及新产品取舍则先提出实际影响。

验证按本批风险选择：相关测试、pnpm typecheck、pnpm check:architecture；入口/构建变更加 pnpm build；UI 走对应检查。
重点覆盖本批真实边界：旧数据可读、并发领取/维护互斥、幂等原回执、unknown 恢复、来源失效、检查适用性等。无需每批重复所有场景。

交付：可观察结果、真实调用链、修改/复用/删除文件、旧消费者迁移、生产代码与测试代码分别对比、实际命令结果及未接通项。
证据写入 docs/refactor/reviews/implementation-batches.md，按实际批次追加；保留历史结果的原范围。
完成意味着该批路径与旧入口退出条件满足；不能把局部 PASS 写成整个重构已完成。
````

## Prompt 9：UI 与真实工作路径改版

````text
请按当前重构计划实现 UI，使人能读懂两图、Session 工作及真实状态，并给出可审阅的前后对比。

工作区：/home/hyh001/projects/coding-platform；代码仓 coding-platform/。
先读 docs/refactor-prompts.revised.md §1–4、docs/PRODUCT.md、docs/refactor/HANDOFF.md、
skeleton/END-TO-END.md、modules/business/workflow.md、当前批次计划；后两项设计路径相对 docs/refactor/。
读真实 src/ui、Host 路由、查询/控制契约与已有 UI 测试；不按旧说明认定页面或视觉规范一定不存在。

必须落到真实用户路径：
1. 普通提问能读取项目/文件/历史，不自动进入完整计划或模型执行；需要语义判断才按 Query 协议工作。
2. 架构图支持当前/历史版本、模块→文件/来源/工作关联；任务图支持计划/当前/历史、依赖、责任及检查结果。
3. 角色配置、Session、Run 分开展示；能定位实际会话历史和相关任务/模块，不把角色卡片当唯一永久 Agent。
4. 展示控制期望与实际确认、busy/unknown/unsupported、来源/投影水位；暂停请求不显示成已暂停。
5. 方案解释和已有授权内修订不重复提交同义方案；真正新增取舍绑定具体候选版本，人能看到差异再决定。
6. 后端未接通时明确缺口，不伪造可用按钮、成功态或图数据；将必要 API 接线纳入本批关联修改。

视觉要求：布局对齐、间距/字号层级、颜色 token、窄窗口降级、加载/空数据/错误三态；复用现有组件体系，键盘/焦点和可读性随实际流程核对。
已有视觉决定直接采用，工程细化自主完成；新增组件库/外部字体/实质产品交互取舍先说明必要性，按现有授权处理。
产物：相关 UI/Host/契约代码；docs/refactor/ui-visual-spec.md 的实际采用值；
docs/refactor/reviews/ui-review.md 中的前后截图或可核对组件/属性/行为对照。
本阶段通常涉及 src/ui；为真实路径所需的接口和接线可以同步，禁止无关业务扩张。

验证：相关 UI 测试、pnpm ui:typecheck、pnpm ui:build，必要时 verify:ui-build/实际页面；按项目现有配置执行。
交付：上述路径哪些真实可用、哪些受后端能力限制、视觉值及前后证据；不只用“更好看”作结论。
````

## Prompt 10：独立评审（四个可单独使用的实例）

评审任务以找具体问题为主，默认只写报告，不自动执行全部修复。问题要有位置、触发条件、影响、依据和建议；设计缺口、源码缺陷、历史迁移差距分别报告。没有相关证据就写未核实，不为评审凑问题。

### Prompt 10-A：数据、状态机、架构与骨架评审

````text
请独立评审当前核心设计是否承接用户意图、能否直接施工。
工作区 /home/hyh001/projects/coding-platform；先读 docs/refactor-prompts.revised.md §1–4、docs/refactor/HANDOFF.md。
目标：docs/refactor/ 的 CORE-DATA-OPERATIONS.md、CORE-STRUCTURES-AND-ORCHESTRATION.md、
ORCHESTRATION-STATE-MACHINES.md、ARCHITECTURE.md、skeleton/CONTRACTS.md、相关目标模块页。
上游：docs/PRODUCT.md、docs/refactor/intent/INTENT-AND-DECISIONS.md；有争议定位原话。
逐项核对：数据身份/版本、正式记录与索引、操作读写/原子边界、状态字段/派生状态、循环/时间线、
Session/Run/QueryRun/维护占用、普通读取、Kernel 真实边界、关键小文件/完整接口/旧消费者去向。
重点找重复状态写者、把业务判断塞存储、每次读取强迫模型、用空门面替代迁移、隐藏 unknown 或来源失效。
声称“与源码不符”前读对应源码；目标未实现本身不是设计错误，但必须清楚标记。
报告写 docs/refactor/reviews/architecture-review.md；已有旧评审保留其版本范围，以新节或新版本报告区分。
每项：严重程度、文件/行号、具体触发与影响、依据、最小修复建议；没有问题的关键边界也简述核查范围。
不修改被评审设计或源码，不把风格偏好和未实现状态都列为阻断项。
````

### Prompt 10-B：模块、源码依赖与迁移归属评审

````text
请独立核对当前目标模块、实际源码依赖和迁移去向。
工作区 /home/hyh001/projects/coding-platform；先读 docs/refactor-prompts.revised.md §1–4、docs/refactor/HANDOFF.md。
目标均在 docs/refactor/：module-dag.md、module-target.json、modules/ownership-map.md、五模块页；
现状：coding-platform/scripts/module-map.mjs、真实 import/注入/Host 装配及本批迁移代码。
核对目标边与具体 Port、状态所有者、旧职责 M01–M13 去向；5/8 是当前设计结果，不是评价指标。
分别验证目标无环和当前允许边，列出临时边、消费者及退出条件；别把未迁目录当已迁，也别把消息反馈当源码环。
找反向依赖、Contracts 导入实现、无消费者新门面、重复规则与双写、被误删的仍用旧入口。
报告写 docs/refactor/reviews/module-dag-review.md，保留历史评审的版本范围。
每项给位置、真实消费路径、影响和最小修复；无证据不推断。只改评审报告。
````

### Prompt 10-C：实施批次与迁移计划评审

````text
请独立评审重构计划是否可以实际执行并退役旧路径。
工作区 /home/hyh001/projects/coding-platform；先读 docs/refactor-prompts.revised.md §1–4、docs/refactor/HANDOFF.md。
当前设计输入在 docs/refactor/：refactor-plan.md、IMPLEMENTATION-PLAN.md、相关模块页；源码线索另读 docs/history/before-2026-09-22/refactor/source-analysis.md 和已有增量调查。其余输入：
modules/ownership-map.md、相关模块骨架、skeleton/CONTRACTS.md、skeleton/END-TO-END.md。
检查每批是否有真实入口/消费者、具体接口和文件、数据兼容、必要跨模块接线、删除条件、前置/并行冲突、验证/回退。
重点看 R4 Kernel 公开扩展与真实连续输入前置、Run/QueryRun/维护互斥、unknown、来源和证据、R6 UI 接线。
检查代码量/可读性/重复工作与 UI 是否可直接对照；不要要求每批预测金额或新增大型消融实验。
检查完成状态是否有源码/运行依据，是否误把旧文档门禁、回填 D 或单模块限制变成总前置。
报告写 docs/refactor/reviews/refactor-plan-review.md；每项给遗漏影响、所在批次和可执行修订建议。只改报告。
````

### Prompt 10-D：本批源码、行为与 UI 评审

````text
请独立评审本批实际改动，不把文档完成和局部测试 PASS 当作全部功能完成。
工作区 /home/hyh001/projects/coding-platform；先读 docs/refactor-prompts.revised.md §1–4、coding-platform/AGENTS.md、docs/refactor/HANDOFF.md。
从用户指定批次或当前计划/证据定位真实变更；核对 Git 差异，区分已有用户改动，不能凭整个工作区 diff 认领范围。
设计依据为 docs/refactor/ 中的 refactor-plan.md、IMPLEMENTATION-PLAN.md、对应目标模块页/共同契约；核对实际测试和运行记录。
涉及 UI 时加 docs/PRODUCT.md、docs/refactor/ui-visual-spec.md 及真实页面/截图。
检查真实消费者/Host 接通、旧实现退役、同步索引与提交、幂等/并发/unknown、旧数据/引用兼容、必要来源核验。
涉及 Session 时检查实际 Kernel 输入/历史/存储映射与原身份恢复，Fake 或同 ID 不足以证明连续工作。
涉及 UI 时检查两图/历史/Session 关联及真实控制状态，空/加载/错误与 unsupported 不混写。
对照调用跳转、规则副本、生产代码与测试代码变化；性能收益只认实际同输入证据，不从少模块少行数推断。
报告写 docs/refactor/reviews/implementation-review.md，按批次保留历史范围；每项附位置、触发条件、影响和修复建议。
需要验证时只运行相关检查并报告限制；只改报告，不擅自修复或覆盖用户改动。
````

## §5 v2 → v3 修订说明

| 旧版问题 | 本版处理 |
| --- | --- |
| 顶部宣布新基线，单条 Prompt 仍要求旧 13 模块、AgentLifecycle 包装和 ContextCompiler 固定边界 | 正文按当前数据/行为设计改写；五模块是当前工程选择，生命周期功能保留并按责任落位 |
| Prompt 3 “必须且只需五要素”，缺内部关键文件/完整主要接口 | 改为文件级骨架、读写/算法/事务/恢复/消费者迁移与接口处置表 |
| Prompt 6/8 从旧文档仓取目标；阶段状态和“文件尚不存在”说明过时 | 当前目标统一指 N；D 作历史/兼容来源；状态需按实际文件/源码复核 |
| 逐模块、同层即可并行、跨模块一律停下；实施者等用户提供目录/接口 | 按真实路径和批次迁移，允许必要调用方/契约/装配同步，按实际前置选批次 |
| 每步固定按旧模型价格预测金额，重复确认已定产品与实施方式 | 以可读性、代码量、UI 及真实重复工作对比验收；金额仅在相关且有数据时测算；继承已有授权 |
| 每个读者全量阅读旧材料；回填旧文档仓成为总门禁 | 分层最小阅读包；只在明确任务范围内同步旧仓，接手入口直接使用当前设计 |

修订只改变后续提示词与其历史留存，不意味着本次已经执行 Prompt 6、迁移源码或完成 UI。
