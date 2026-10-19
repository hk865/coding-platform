本次共提出 **12 项结构问题：第 1 类 10 项，第 2 类 2 项，第 3 类 0 项**。最需要提前处理的是上下文装配、Query 阶段驱动、工具装配和 Workflow 内部职责划分；不建议在下一片前整体重写 Host 或 composition root。

全程只读，未写文件，未运行测试或构建。下面的行号以当前副本为准。改动量均为**新增＋删除的粗估区间**，搬移计两次，不包括剩余分片的新功能实现。

为便于引用，下文的规格简称为：

- **S6**：`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md`
- **S7**：`docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md`
- **S8**：`docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`

**先回答扩展成本。**

这里要区分“增加一个入口所需的接线文件”和“实现这个业务本身的文件”。否则会把增加 owner 的成本重复算到每条路由、每个工具上。

| 扩展对象 | 当前接线成本 | 当前证据、最近例子 |
|---|---|---|
| 一条路由，目标 owner 方法已经存在 | **2 个已有文件**：`core-http-types.ts`、`core-routes.ts`。普通路由不需要改 `host.ts` 或 `server.ts` | K3 的 `unknown-call-reviews/read`：HTTP suffix、DTO 在 `src/app/core-http-types.ts:241`、`:616`、`:640`；binding 类型、元数据、绑定、dispatch 在 `src/app/core-routes.ts:201`、`:459`、`:813`、`:1132`。两个文件里有至少 **5 处同步表示**，K3 还多一张 DTO 映射表。当前 POST 路由表共 **120 条** |
| 一个新工具组，复用现有 owner，只供 Work 使用 | 最小通常 **2 个文件**：工具定义/工厂文件，以及 `execution-driver.ts` 的选择和装配。若也进入 Query，通常再涉及 `query-preparation.ts`、`query-execution.ts`，成为 **4 个**；默认 Host 授权、提交查证按需另计 | 当前有 **6 组 coordination 名称集合**，在 `src/core/agent-runtime/execution-driver.ts:102`、`:246`、`:268`、`:319` 分别汇总、筛选、构造、再汇总。不能把“工具注册”视为自动授予权限 |
| K3 的实际新工具 `request_command_rerun` | 本范围内可追到 **6 个生产文件**：`command-rerun-tools.ts`、`execution-driver.ts`、`observed-model-run.ts`、`execution-contracts.ts`、`create-platform.ts`、`tool-commit-lookup.ts` | 定义 `src/core/agent-runtime/command-rerun-tools.ts:134`；特殊装配 `execution-driver.ts:751`；专用参数和三处工具列表 `observed-model-run.ts:121`、`:298`、`:316`、`:336`；依赖 `execution-contracts.ts:350`；owner 注入 `src/composition/create-platform.ts:1246`；查证登记 `src/composition/tool-commit-lookup.ts:29`、`create-platform.ts:1957`。这 **6 个**不是所有普通工具的固定成本 |
| 一个 owner 接入 Host | 单纯创建并发布，**1 个 composition 文件**即可。若同时供 Runtime、Workflow、HTTP 使用，通常是 **4 个已有接线文件**：组合根、Runtime 依赖契约、Workflow 依赖契约、路由平台类型；owner 自身的契约/实现/codec 文件另计 | K3 `unknownCallReviews`：`src/composition/create-platform.ts:739` 创建，`:1242` 注入 Runtime，`:1907` 注入 Workflow，`:2240` 发布；对应类型在 `src/core/agent-runtime/execution-contracts.ts:328`、`src/business/workflow/ports.ts:205`、`src/app/core-routes.ts:311`。Host 不重新创建它 |
| 一个 Workflow step，owner 已接好 | **2 个已有文件**：`contracts.ts` 声明调用类型，`workflow.ts` 选择/执行/接续。若引入新 owner，再加 `ports.ts`、组合根，成为 **4 个接线文件** | K3 `settle_review`：`src/business/workflow/contracts.ts:111`，选择入口 `workflow.ts:1371`，执行分支 `:2538`。当前 `WorkflowCalls` 有 **18 种**；operation 和 receipt 已由映射类型派生，不需要为每一步再抄完整结果类型 |

新增运行入口才需要审视 Host 租约门，不能每加一条普通写路由都改一次。现有显式租约门在 `src/app/host.ts:1556`；通用 route binding 只创建一次，在 `:1576`。

剩余分片的增量如下。工具数按**规格已经给出的新名字**计，不把旧工具新增调用类授权算成新工具。

| 分片 | 新路由 | 新工具名 | owner／流程方面实际增加什么 |
|---|---:|---|---|
| 6A | **7**：六条 requests/main 路由，加 `activity/queries` | **0 个已明确命名的新工具** | `RequestSubmitPort`、真实 `RequestFactsPort`、主对话读模型；共用建线入口；秘书轮驱动及提交唤醒、排空、启动重建；Query 活动记录。依据 S6:6、:7、:13、:182、:209、:265、:270、:396 |
| 6B | **5** | **0**；给秘书注册已有 `record_note` | 共用换手阶段、秘书 routing、目标确认/复制、`InitializationBinding`、秘书归档，以及 goal/project 卡与通知主体基础。依据 S6:8、:10、:11、:138、:210、:397 |
| 6C | **0 个列明的新路由**；扩展现有提议/采用入口 | **0 个列明的新名字** | 扩展规划回答、批准载荷及采用核对，继续使用现有 initial-planning 桥。无 Goal 初始化绑定的提议/采用已由顶部后注提前到 6B。依据 S6:10、:211、:398 |
| 7A | **3** | **0** | 消息放行、撤回、落实；DispatchCounter；接已有落实证明登记表。依据 S7:12、:102、:361、:700 |
| 7B | **2** | **0** | 派生等待、回复/到期/干预接续；扩展 TaskGate；咨询的 `platform_facts` 派生。**没有新的等待记录 owner**。依据 S7:118、:126、:162、:362 |
| 7C | **0 个列明的新路由** | **5**：`create_member`、`hand_off`、`request_rework`、`request_recheck`、`withdraw_session_message` | 建成员、换手审批、返工适配器；选择执行者；通知；秘书 Query 的邮箱权限。删除 `apply_future_plan`，不算新增。依据 S7:166、:168、:173、:180、:181、:183、:363 |
| 7D1 | **3** | **0** | 角色事实、范围、项目上限、保留名额、负责关系迁移、跨工作区项目卡身份。依据 S7:364、:460、:471、:476、:706 |
| 7D2 | **11** | **1**：`propose_role_split`；复用 `create_member` 和 8C 的架构提议工具 | 角色线操作、参谋队列、自治规则、容量 episode、共同运行准入、探索 Query 和冷启动。依据 S7:365、:484、:487、:497、:509、:524 |
| 8B | **1**：`modules/assign-maintainer` | **0 个列明的新名字** | 扩展已有负责关系写入方和规划回答，不是另建一套维护者记录。依据 S8:149、:153、:165、:457 |
| 8C | **2**：`architecture/revise`、`architecture/proposals/read` | **1**：`propose_architecture_revision` | 架构提议及冻结批次；扩展目录修订和 notes 的 `activateRepair`；Workflow 两个触发点及启动补做。依据 S8:114、:116、:119、:132、:133、:252、:259、:458 |

因此，当前冻结规格明确列出 **34 条新路由、7 个新工具名**。

规格没有把这些业务都冻结成新的 `WorkflowStepKind`，也没有冻结最终 owner 工厂的数量。尤其：

- 6A 的 Query 阶段驱动，不是向现有 18 种 Work step 机械增加一套副本。
- 6B 的 handoff、7D2 的 role-line 阶段存于 `SessionOperation`，不能直接按阶段数量算成 `WorkflowCalls` 数量。
- 8C 要求在“检查定案后、答复落实后、启动恢复”触发生效，但没有要求新增一个特定名字的 Workflow step。

可以确数的新增记录族是 **12 种**：6 的 `QueryActivity`、`InitializationBinding`；7 的 `DispatchCounter`、`SessionRoleFacts`、`ProjectRoleLimits`、`RoleLineAllocation`、`GoalAdviserQueue`、`AutonomyRule`、`AutonomyRuleSet`、`RoleCapacityEpisode`；8 的 `ArchitectureProposal`、`ArchitectureProposalBatch`。`GoalScreening` 是队列项中的内容，handoff/role_line 是已有操作记录的分支，不能再重复计数。依据 S6:133、:184，S7:102、:460–:524，S8:252、:259。

**结构发现如下。**

| # | 问题（file:line，一两句） | 现在的代价（读、改、复用各难在哪；具体例子） | 剩下哪一片会碰到（spec 和章节；不碰写“无”） | 改法（一两句；只说结构） | 会不会动行为 | 估计改多少行（新增＋删除） | 归类 | 把握 |
|---|---|---|---|---|---|---:|---|---|
| 1 | 路由信息在两大文件中反复登记。见 [core-http-types.ts:145](D:/cxt/d84-struct/src/app/core-http-types.ts:145)、[core-routes.ts:91](D:/cxt/d84-struct/src/app/core-routes.ts:91)、`:367`、`:626`、`:1012` | 读一条路由要跨 suffix、binding 类型、元数据、绑定和 switch；K3 还维护独立 DTO 表。今天 120 条，剩余明确增加 34 条，重复维护随每条路由增长 | S6 §1.1（:209）；S7 §1（:361）；S8 L9/L6（:153、:132） | 按业务域拆 route/DTO 登记，统一从类型化请求响应映射派生 suffix、binding 等可派生信息；保留显式命名的 owner 调用。通用解析和错误映射留在路由内核，不用 `platform[group][method]` 反射 | 不会；须保留原 URL、body 容器、错误映射及 owner 方法 | 650–950 | **1；6A 前**建立新路由使用的登记方式 | 中 |
| 2 | 工具的“可选名称、所需依赖、工厂、最终注册列表”散在 Work/Query 两条装配路径。见 [execution-driver.ts:207](D:/cxt/d84-struct/src/core/agent-runtime/execution-driver.ts:207)、[query-execution.ts:218](D:/cxt/d84-struct/src/core/agent-runtime/query-execution.ts:218)、[observed-model-run.ts:96](D:/cxt/d84-struct/src/core/agent-runtime/observed-model-run.ts:96) | Work 有 6 组手动筛选/装配；graph 工厂在 Work 和 Query 各装一次；模型循环又有只读命令、核对、命令重跑 **3 个专用工具槽**。新调用类要同时理解资格判断与装配细节，容易照已有路径复制整段 | 6A L5/L8 的记忆读取；6B L9；7C L17–L20；7D2 `role_exploration`；8C L6。S6:123、:132、:138；S7:168、:181；S8:133 | 提取工具组装配模块，统一输出已有的 `{names, create}` 形状，模型循环接组合结果；**调用类资格策略独立且显式**，不把权限判断藏进通用工厂 | 不会；结构调整阶段保持 Work、copy、review 各自原白名单和失败方式 | 500–750 | **1；6A 的 Query 工具扩展前**，最迟不能拖到 6B 再复制一套 | 高 |
| 3 | `context-assembler.ts` 的 2,039 行混合渲染、事实读取、Kernel 历史、工作区材料和调用类配方。见 [context-assembler.ts:266](D:/cxt/d84-struct/src/core/agent-runtime/context-assembler.ts:266)、`:973`、`:1129`、`:1256`、`:1672` | 改提示模板会进入历史与文件 I/O 文件；`readKernelCommandFacts` 还被组合根的核对卡/查证路径调用，非提示消费者也依赖“装配器”。同时初始化回答说明在 `query-preparation.ts:50`，增加一次角色动作需找多个文本入口 | 决定 83；6A L8、6C 回答格式；8B L11。HANDOFF:659–:665；S6:131、:398；S8:165、:457 | 分成纯渲染/模板、历史与工作区事实读取、Work/Query 调用配方三部分；把初始化回答 guide 一并归入模板资源。保留 assembler 作为薄编排入口，详见下表 | 不会；先原样搬文本、顺序、裁剪和拒绝结果；83 的新策略另实现 | 1,900–2,600 | **1；决定 83 专节和 6A 实现前** | 高 |
| 4 | 唯一服务端 Query 阶段驱动嵌在咨询消费者闭包里，而且直接推导咨询专用身份。见 [consultation.ts:207](D:/cxt/d84-struct/src/business/workflow/consultation.ts:207) | `driveAccepted` 同时做 phase dispatch、准备/开始/观察、咨询结果包装和答案关联。秘书轮或探索 Query 不能直接复用，必须复制阶段规则或伪装成消息咨询 | S6 顶部后注（:6）、L5（:118）；S7 后注（:13）、7D2 探索路径 | 提取接受明确 Job/Run 身份、request ID 和 consumer 的有限阶段驱动；把消息答案关联、咨询状态措辞留在 consultation。新请求重试身份由上层提供 | 不会；保持未知结果不重跑、已保存答案优先、各 request ID 不变 | 140–220 | **1；6A 前** | 高 |
| 5 | `workflow.ts` 的 2,945 行闭包承载规划桥、挑人、任务门、返工、接续和 18 种步骤执行。见 [workflow.ts:812](D:/cxt/d84-struct/src/business/workflow/workflow.ts:812)、`:877`、`:1371`、`:1721`、`:2289` | 新任务门要穿过挑人和步骤构造辅助函数；改规划回答也进入派工主文件。K3 的 TaskGate 已有有限结果，但实现和私有辅助仍困在闭包，7B 难以独立扩展它 | 6B 初始化桥及换手；6C；7B L46；7C L15–L19；8C L4。S6:10、:398；S7:16、:166、:330；S8:119 | 先提取 initial-planning 桥、执行者选择、任务门/自动化判定三个内聚模块，给窄依赖；保留当前 `select_work/perform` 协议及显式步骤分派，不建通用工作流引擎 | 不会；选择顺序、失败卡排除、request ID、回执和继续位置原样保留 | 1,500–2,000 | **1；规划桥在 6B 前，任务门在 7B 前，挑人在 7C 前** | 高 |
| 6 | schema bundle 在组合根分别展开 records/events/lookups 三次。见 [create-platform.ts:628](D:/cxt/d84-struct/src/composition/create-platform.ts:628) | 当前 **24 个 bundle 各列三次**，另有 execution-history 的 events-only 登记，共 73 次成员展开。新增 bundle 要记住三个相距位置；看不出它是完整 bundle 还是有意只接 events | 剩余记录增量涉及 6A/6B、7A/7D1/7D2、8C；新派工 codec 明列于 S7 §6（:700），其他新记录见 S7:706、S8:458 | 一份有序 bundle 清单统一展开三个集合；events-only 情况显式声明。保留既有索引完整性检查，不改各 codec 协议 | 不会；保留登记顺序和 events-only 例外 | 90–140 | **1；首次新增 bundle 前做，建议随 6A 接线准备，最迟 7A 前** | 中 |
| 7 | 注记答复落实的业务适配器写在 composition root。见 [create-platform.ts:1660](D:/cxt/d84-struct/src/composition/create-platform.ts:1660)、`:1885` | 这里判断选项、解析卡身份、重读已保存答复、生成重放 ID、处理 pointer pin、转换 `source_stale`。同表的 CRR 已有业务层工厂，注记却要求读组合根才能理解落实规则 | 8C L4/L6 的修补批准与结构提议落实；6B 的主体扩展也经过这一组契约。S8:114、:122、:133；S6:11 | 把注记 application 及其专用解析函数移到 `business/workflow` 的适配器模块，组合根只构造并登记；新 repair/structural 适配器沿同一入口组织 | 不会；尤其保持读不到答复时仍待落实，不能当作空条件 | 140–220 | **1；8C 前**；6B 若先改这组契约，可先完成搬移 | 高 |
| 8 | `readCompletedBoundary` 在 Runtime 和组合根各实现一次。见 [runtime.ts:524](D:/cxt/d84-struct/src/core/agent-runtime/runtime.ts:524)、[create-platform.ts:1485](D:/cxt/d84-struct/src/composition/create-platform.ts:1485) | 两份都检查 Host、项目、读 Session、解释 completed boundary；组合根覆盖公开方法，内部 raw Runtime 保留另一份。历史读取规则变化时必须追两条路径，组合根还自行创建历史 owner | 7B L14 的退役线咨询及历史不可读分支，S7:162；决定 83 历史边界若扩展，也会经过此处 | 留一个 Runtime 边界读取实现，组合根只加关闭准入包装；若无完整 Runtime 时仍需提供此能力，抽出共同工厂供两处使用 | 不会；保留关闭时拒绝、Host 检查、失败结果和注入能力 | 70–110 | **1；7B 前**；83 若先扩此端口，则在该扩展前 | 高 |
| 9 | Query observer 又实现一份 Kernel 记录解码和 Turn 事实判断。见 [query-observation.ts:77](D:/cxt/d84-struct/src/core/agent-runtime/query-observation.ts:77)、`:88`、`:98`、`:109`、`:119` | 解码、定位 turn.started、事件归约分别重复 `kernel-turn-facts.ts:28`、`:39`、`:62`；完整性和 outcome_unknown 又对应 `execution-observation.ts:122`、`:172`。今天已有两份，6A 再接活动计数时需同时确认它们读的是同一事实 | 6A L16，特别是终态记录和恢复，S6:182、:185、:396 | 把相同的 Kernel 事实操作集中在 `kernel-turn-facts`；需要的 start position 一并返回。Work/Query 各自的终态、Answer、平台事件映射继续分开 | 不会；不统一两类平台执行的终态业务规则 | 100–160 | **1；6A 查询活动接入前** | 高 |
| 10 | 可复用的提醒投递机制仍是 `host.ts` 内的书记专用闭包。见 [host.ts:1255](D:/cxt/d84-struct/src/app/host.ts:1255)、`:1320`、`:1361`、`:1376`；收件人规则在 [create-platform.ts:1762](D:/cxt/d84-struct/src/composition/create-platform.ts:1762) | 当前书记提醒和注意力投递各维护一套发送后状态。书记壳有同 ID 重试、游标改变丢弃旧请求、按收件人恢复、三态完成判断；7C 要复用时只能继续扩 Host 或复制闭包。正式收件范围还要到组合根找 | S7 顶部后注明确要求复用此壳（:15）；7C L21（:182）、7D L35；8C stale 修补进入书记待办（S8:120） | 抽出提醒投递服务，显式注入身份、收件人、完成判断和发送；书记阈值、正文、注意力的序列确认分别保留为策略。收件人解析成为独立窄端口 | 不会；不能顺带把两个提醒机制现有的确认/节流语义改成同一种 | 460–650 | **1；7C 前**；正式范围解析由 7D 接入 | 高 |
| 11 | K3“释放 hold 后按人工围栏重排”的业务组合落在 HTTP 路由层。见 [core-routes.ts:822](D:/cxt/d84-struct/src/app/core-routes.ts:822)、`:922` | 路由层负责重放查找、读 Run/control/Goal、判断 `reworkFenceOf`、构造 CAS pins 和重排 ID。非 HTTP 调用方无法复用完整动作；读路由文件必须理解业务恢复顺序 | **无**。7C 的返工工具不是这条 release-hold 组合；其他片增加同文件路由不等于扩展此分支 | 移入业务层的有限组合动作，路由只调用并保留当前响应包装；不把两个提交合并成一个新事务 | 不会；必须保持“先查重放再读新 pins”的次序 | 210–280 | **2；合拢后做** | 高 |
| 12 | CaptureRegistry 同时管理 capture 生命周期和组装完整文件图。见 [capture.ts:111](D:/cxt/d84-struct/src/core/workspace/capture.ts:111)、`:309` | `captureFileGraph` 约 160 行实际组装，加前后适配，负责语言 provider、冻结输入、覆盖率、索引状态、边去重和未解析项归并；这些规则的修改会进入负责授权、过期、容量和释放的 registry | **无**。S8 §6 的 8B/8C（:457、:458）扩展正式目录、负责人、修补；此处的 8A/8D/L8 已合入 | 提取只接收冻结 observation、scan、provider 与限额的文件图组装器；registry 保留授权、版本检查、生命周期和调用包装 | 不会；保持冻结材料、排序、覆盖率、容量及取消语义 | 500–620 | **2；合拢后做** | 高 |

第 6 项有一个计数边界：**新增记录不一定新增 schema bundle**。如果新记录放进已有 bundle，组合根不需要增加三处展开；因此不能把上面的 12 种记录直接算成 36 处组合根修改。该项针对的是 bundle 登记结构，和决定 70 的 codec 生成试点不是同一项。

**决定 83 应如何落位。**

目前既有入口足够支撑拆分，不需要先建立新的“大 Context 系统”。关键是把“取事实、选模板、装配材料、最终发出的模型请求”分开。

| 决定 83 的内容 | 当前结构中的落点 | 应先划出的边界 |
|---|---|---|
| 按角色动作的模板、变量、覆盖和版本 | 角色说明当前在 `src/core/agent-runtime/role-profiles.ts:19`；渲染在 `context-assembler.ts:266`；初始化长说明在 `query-preparation.ts:50`，于 `:312` 拼接 | 模板内容及版本独立于事实读取；调用配方选择模板、传入类型化变量。先原样搬出已有文本，避免 6A 再往 assembler 中加入秘书整段提示 |
| 按 provider/model 选择模板及布局 | 模型配置和解析已在 `src/app/runtime-configuration.ts:46`、`:391`、`:417`；Runtime 配置契约在 `src/core/agent-runtime/execution-contracts.ts:129` | Host 解析出可信模板/策略选择；prepare 将选中的版本身份固定下来。assembler 消费选择结果，不自行读取 settings 或猜 provider |
| thinking 回传的模型表 | provider/model 身份由上述配置链提供；最终模型桥在 `src/core/agent-runtime/observed-model-run.ts:243` | 模型能力/兼容策略与提示正文分开；最终协议转换由 provider/Kernel 边界落实。不能仅在 assembler 拼一段说明就认为完成了 thinking 策略 |
| 裁剪保留当前任务和角色指令 | `context-assembler.ts:266` 当前裁的是平台装配段；Kernel 还会组装和裁剪历史消息 | 先给材料明确的角色指令、当前任务、旧文件/工具结果等类别。最终历史裁剪属于受管 Kernel 补丁路径；**不能把现有装配器的字节预算当作决定 83 的完整预算裁剪** |
| 秘书请求历史 | `context-assembler.ts:1955` 当前是 Query 配方；历史边界能力在 `session-operations.ts:882`；请求归属/轮次读口由 S6 §2 的 `RequestFactsPort`（S6:265）提供 | 请求轮次事实读取、Session 历史读取和去重装配分别负责。6A 的最多 10 轮、每回答 2 KiB 是请求历史规则，不能套用现有 continuation 历史窗口后便视为完成；来源边界应随材料保留 |
| 完整的实际发送提示记录 | `observed-model-run.ts:261` 合入 responseFormat/systemInstruction，meter 再处理请求，`:249` 在真正调用 provider 前只记录 request digest | 在最终模型调用边界记录完整请求及模板版本关联，不能只保存 `manifest.input`。若 provider 适配器继续转换消息或 thinking，必须把记录口径明确到“完整 ModelRequest”或“最终 provider payload”，不能混称 |
| 新任务的旧文件提醒 | Work prepare 在 `execution-preparation.ts:299`，Query prepare 在 `query-preparation.ts:222`；已有文件/历史事实现在散在 `context-assembler.ts:973`、`:1158` | 提取事实读取后，由新调用配方使用任务边界和文件来源生成提醒。提醒属于材料策略；不在结构调整中擅自清空历史或改写旧 tool result |

因此，**片前必须先动的是表中 #3；#2、#8、#9 分别解决工具、边界端口、Kernel 事实复用问题**。不建议先把全部 83 功能塞进 `context-assembler.ts`，等 6A 做完后再搬。

上述结构搬移本身不改变行为；决定 83 的新模板、裁剪顺序、thinking 规则和记录内容是其已决定的新功能，应由该专节明确实现和验收。

**N0 的归属很明确：交 T，保留真实规划桥。**

`N0GoalInput` 在 `src/business/workflow/contracts.ts:62`，仍从 `index.ts:4` 导出；`ports.ts:226` 把它和真实 `InitialPlanningGoalInput` 放在同一个签名里。实现于 `workflow.ts:816` 对非 `planning_answer`／`adopt_initial_plan` 直接回 unsupported。

- **6A 不建立在 N0 goal input 上。**它使用新的 request-round 提交和 Query 驱动；S6 §0.2 F6（:73）、顶部后注（:6）、L5（:118）都指向这条链。
- **6B、6C 会使用真实规划桥及其下层 owner。**现有 `planning_answer` 调 `proposeInitialPlanFromAnswer`，见 `workflow.ts:829`；`adopt_initial_plan` 调 `applyPlanChange`，见 `:860`。S6 §0.2 F7（:74）、顶部后注（:10）及 §6（:398）支持这一判断。
- 所以应交 T 的是 **N0 类型、导出和无实现的旧输入形状**；不能因清理 N0 删除整个 `handleGoalInput`。表中 #5 只提取仍在使用的规划桥，不包含这项清理。

**Host 的 owner 接线是“一处创建，多处接入”，问题在组合根夹带了规则。**

创建链很清楚：`src/app/host.ts:509` 调一次 `createTargetPlatform`，`:1576` 用同一个 platform 建路由。没有发现 Host 与 composition 各建一套 work-graph owner 的结构。

组合根中的一个 owner 会依次接入 schema、其他 owner、Runtime、Workflow、读模型、公开 platform；这些不同用途本身合理。K3 的创建与消费点上面已列出。新 owner 的额外成本主要是：

1. 新的依赖必须进入对应的窄端口，而不是让 Runtime/Workflow 取整个 platform。
2. 新卡源要接卡读取，新落实动作要接 application adapter；二者不是同一职责，不能为少写一行而合成一个万能注册表。
3. 需要后台推进的功能才进入 Host 生命周期。6A 要接提交唤醒和启动重建；7B/7D2 按顶部后注复用这个循环；8C 在启动核对加修补补做。
4. 公共调用需要沿既有关闭/排空机制接入，见 `src/composition/create-platform.ts:1152`、`:1925`、`:2308`；不能为了减少包装改变原来同步取快照和关闭等待的行为。

真正应该迁出的，是 #7 的业务适配、#8 的重复 Runtime 规则，以及 #10 的收件人/提醒机制。**仅因为组合根有 2,343 行而拆成若干“第几部分接线”文件，不能解决这些成本。**已有 `architecture-reminder-facts.ts:17`、`session-duty.ts:57` 这样的窄适配器更适合作为局部拆分方式。

另外，7D2 的共同运行准入不能随手放到 `runObservedModel` 最后一步：规格要求被挡时仍是“已准备、未开始”，见 S7:484。应接在 Work/Query 的真实启动路径、持久化开始之前，共享准入 owner；保持两种执行各自的状态迁移入口。这属于 7D2 功能施工，不另计本次结构发现。

**C1 交来的两类开放问题，我在本范围内的判断如下。**

卡源问题不是“没有通用卡源”。实际已经存在 `src/core/work-graph/views/decision-read-model.ts:257` 的 `createCollectionCardSource`，注记、核对、命令重跑分别在 `:325`、`:417`、`:648` 使用它。组合根当前注入 **5 个来源**，见 `src/composition/create-platform.ts:971`、`:980`、`:984`、`:989`、`:996`。

队列内仍有 message、candidate、goal_conflict 的专用段，分别在上述范围外文件 `:886`、`:899`、`:966`。它们的迁移是 `.lead-ref/c1-lead-rulings.md:27` 所交问题的实际所在；**不应在本报告中伪报成 composition 里又有三套卡算法**。本范围的配合是保持卡源工厂注入和落实适配器分离，并在 #7 移出具体业务判断。

后续至少有 **7 个具名卡源实现要新接入**：7A 的 `message_release`，7C 的 `member_creation`、`rework_request`，7D2 的 `role_capacity`、`role_line_change`，8C 的 `repair_approval`、`structural_proposal`。其中 `message_release` 名字已经声明，新增的是实现；换手审批卡、6B 目标草稿也不能据此擅自另造一个规格未命名的 source kind。依据 S7:170、:180、:361、:365、:426，S8:122、:133。

C1 留下的相似 helper，**没有理由在此批量归并**：

- `src/core/agent-runtime/execution-control.ts:137` 用 canonical JSON 比较并捕获失败；`execution-preparation.ts:199` 用 `JSON.stringify`。改成同一个默认比较器会改变键顺序等比较语义。
- `src/business/workflow/decision-actions.ts:207` 的 `refKeyOf` 失败返回 `null`；它不等于 throwing key 函数，也不等于返回布尔值的 `sameRef`。
- `src/core/agent-runtime/graph-execution-history.ts:84` 检查完整 Run 身份但允许额外字段；`:89` 比较身份字段。不能用严格 codec 校验替代。
- `src/composition/session-duty.ts:63` 的失败转 `unknown` 是现有规则；S7 顶部后注（:5）明确把是否改成 `unavailable` 留给 7D1 裁定。把它与 assembler 的职责解析强行合并，会提前改变规则。

这些是有意保留的语义边界，不列为“只记下”的结构缺陷。与之不同，#8、#9 是可以明确指出相同事实操作的重复。

**数量和改动量汇总：**

| 归类 | 项数 | 估计新增＋删除 |
|---|---:|---:|
| 1 片前做 | **10** | **5,550–7,800 行** |
| 2 合拢后做 | **2** | **710–900 行** |
| 3 只记下 | **0** | **0 行** |
| 合计 | **12** | **6,260–8,700 行** |

各项估计不包含新功能；#1 不包含 #11 的业务搬移，#3 不包含 #8/#9，避免重复计量。第 1 类应分别放在表列分片前完成，不表示全部都要阻塞 6A。

**行为问题：本次未发现有足够证据单列的行为 bug。**

以下是本范围阅读清单，共 **107 个文件、44,404 行**。`read` 表示阅读了实现正文及相关调用链；`skimmed` 表示浏览接口、结构和局部实现，不表示逐行覆盖。

```text
src/app/attention-observer.ts — skimmed
src/app/auto-capture-driver.ts — skimmed
src/app/change-feed.ts — skimmed
src/app/collaboration-driver.ts — skimmed
src/app/core-call-context.ts — skimmed
src/app/core-http-types.ts — read
src/app/core-routes.ts — read
src/app/goal-fan-out-driver.ts — skimmed
src/app/host-instance-lease.ts — skimmed
src/app/host-settings-types.ts — skimmed
src/app/host-settings.ts — skimmed
src/app/host.ts — read
src/app/main.ts — skimmed
src/app/runtime-configuration.ts — read
src/app/server.ts — skimmed
src/app/startup-reconcile.ts — skimmed
src/app/workbench-tools.ts — skimmed
src/business/workflow/activity-backfill.ts — skimmed
src/business/workflow/consultation.ts — read
src/business/workflow/contracts.ts — read
src/business/workflow/decision-actions.ts — read
src/business/workflow/index.ts — read
src/business/workflow/ports.ts — read
src/business/workflow/session-archive.ts — skimmed
src/business/workflow/session-maintenance.ts — skimmed
src/business/workflow/task-order.ts — skimmed
src/business/workflow/workflow.ts — read
src/composition/architecture-reminder-facts.ts — read
src/composition/commit-observer.ts — skimmed
src/composition/create-platform.ts — read
src/composition/session-duty.ts — read
src/composition/tool-commit-lookup.ts — read
src/composition/work-line-conversation.ts — skimmed
src/core/agent-runtime/architecture-reminders.ts — skimmed
src/core/agent-runtime/check-execution.ts — skimmed
src/core/agent-runtime/command-rerun-tools.ts — read
src/core/agent-runtime/communication-tools.ts — skimmed
src/core/agent-runtime/context-assembler.ts — read
src/core/agent-runtime/continuation-brief-assembly.ts — skimmed
src/core/agent-runtime/contracts.ts — skimmed
src/core/agent-runtime/execution-contracts.ts — read
src/core/agent-runtime/execution-control.ts — skimmed
src/core/agent-runtime/execution-driver.ts — read
src/core/agent-runtime/execution-history-contracts.ts — skimmed
src/core/agent-runtime/execution-inputs.ts — skimmed
src/core/agent-runtime/execution-observation.ts — skimmed
src/core/agent-runtime/execution-preparation.ts — read
src/core/agent-runtime/exploration-tools.ts — skimmed
src/core/agent-runtime/graph-execution-history.ts — skimmed
src/core/agent-runtime/graph-tools.ts — skimmed
src/core/agent-runtime/index.ts — read
src/core/agent-runtime/kernel-store-locator.ts — skimmed
src/core/agent-runtime/kernel-turn-facts.ts — read
src/core/agent-runtime/model-budget.ts — skimmed
src/core/agent-runtime/model-call-access.ts — skimmed
src/core/agent-runtime/note-tool.ts — skimmed
src/core/agent-runtime/observation-recovery.ts — skimmed
src/core/agent-runtime/observed-model-run.ts — read
src/core/agent-runtime/ports.ts — read
src/core/agent-runtime/project-source-tool.ts — skimmed
src/core/agent-runtime/query-execution.ts — read
src/core/agent-runtime/query-observation.ts — read
src/core/agent-runtime/query-preparation.ts — read
src/core/agent-runtime/README.md — skimmed
src/core/agent-runtime/readonly-command-tool.ts — skimmed
src/core/agent-runtime/role-profiles.ts — read
src/core/agent-runtime/run-activity-reader.ts — skimmed
src/core/agent-runtime/run-activity-tally.ts — skimmed
src/core/agent-runtime/run-limits.ts — skimmed
src/core/agent-runtime/run-reconcile.ts — skimmed
src/core/agent-runtime/runtime.ts — read
src/core/agent-runtime/session-anomaly-facts.ts — skimmed
src/core/agent-runtime/session-discovery-tools.ts — skimmed
src/core/agent-runtime/session-operations.ts — read
src/core/agent-runtime/source-binding-types.ts — skimmed
src/core/agent-runtime/source-capture-access.ts — skimmed
src/core/agent-runtime/source-tool-ports.ts — skimmed
src/core/agent-runtime/unknown-call-draft.ts — skimmed
src/core/agent-runtime/unknown-call-review-tools.ts — read
src/core/agent-runtime/whiteboard-tools.ts — skimmed
src/core/workspace/access.ts — skimmed
src/core/workspace/analysis-runner.ts — skimmed
src/core/workspace/architecture-language-provider.ts — skimmed
src/core/workspace/architecture-source.ts — skimmed
src/core/workspace/candidate-workspace-reader.ts — skimmed
src/core/workspace/capture.ts — read
src/core/workspace/continuation-diff-reads.ts — skimmed
src/core/workspace/cpp-source-index.ts — skimmed
src/core/workspace/denied-prefixes.ts — read
src/core/workspace/git-read.ts — skimmed
src/core/workspace/ports.ts — skimmed
src/core/workspace/project-source-index.ts — skimmed
src/core/workspace/project-source-snapshot.ts — skimmed
src/core/workspace/python-source-index.ts — skimmed
src/core/workspace/reviewer-source-reader.ts — read
src/core/workspace/role-source-reader.ts — skimmed
src/core/workspace/source-identity.ts — skimmed
src/core/workspace/source-index.ts — skimmed
src/core/workspace/source-query.ts — skimmed
src/core/workspace/text-source-snapshot.ts — skimmed
src/core/workspace/typescript-light-scan.ts — skimmed
src/core/workspace/typescript-source-query.ts — skimmed
src/core/workspace/verification-workspace-reader.ts — skimmed
src/core/workspace/workspace-baseline-artifact.ts — skimmed
src/core/workspace/workspace-change-capture.ts — skimmed
src/core/workspace/workspace-read.ts — skimmed
src/core/workspace/workspace-tools.ts — skimmed
```