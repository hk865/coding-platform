# S01 全范围行为—责任—公开接口审查

审查依据首先是[原始对话](../2026-09-14-post-c-architecture-conversation.md)，其次是权威 `ARCHITECTURE.md`、各 Module 规范和当前生产调用。静态结果见 [interface-audit.json](interface-audit.json)，文件归属见 [file-inventory-before.json](file-inventory-before.json)。静态导入只用于找线索；本表补充它不能回答的权限、失败、顺序、持久权威和恢复语义。

## 审查方法和结论口径

- 从生产行为出发，依次确认触发者、责任 Module、公开 Interface、调用方需要知道的输入／结果／失败、权限与顺序、持久权威、恢复入口和真实消费者。
- `src/contracts` 是跨 Module 协议，不是第十三个业务 Module；`src/app` 与 `src/composition` 是 Host／组合根；`src/storage` 只承载无业务裁决的存储原语；`src/ui` 只展示和发起请求。
- 测试、fixtures 和 testing 按用途分类，不据它们反推生产能力。vendor 是有来源记录的内置内核，遵守其 `AGENTS.md` 和 `INTEGRATION.md`，本轮没有无差别改写。
- “公开”表示真实跨 Module 消费者依赖的协议或确定性规则。组合根可以构造具体实现；业务 Module 不应因一次窄调用获得另一个 Module 的全部能力。
- 完成 S01 表示所有生产责任已归类并给出处理决定，不表示 S02–S05 已完成或源码已冻结。

## 十二个 Module 的责任和公开面

| Module | 共同维护的行为 | 对外 Interface | 调用方应知道 | 隐藏在实现内 | 审查决定 |
| --- | --- | --- | --- | --- | --- |
| HumanCollaboration | 目标／查询／架构协商／历史材料授权的人机入口 | `HumanCollaboration`、`InitialDesignPort`、`UnifiedStatusPort`、`HistoryMaterialPort` | 用户输入、公开回执、需人决定或不可用 | canonical 状态归约、调度和完成判断 | 保留为交互边界；不能自行裁决完成 |
| PlanCompiler | 初始计划、变更、执行反馈和返工的有界协调产物 | `PlanCompilerPort`、`OperatorPlanningPort` | 协调意图、材料缺口、提案结果与来源 | Control 准入、Ledger 提交、Runtime 生命周期 | 真实消费者通过端口；确定性草稿规则可被 Dispatch 复用 |
| ControlEngine | 命令准入、角色／权限／版本／义务、工作身份、协调和运行事实 | `ControlEngine`；协调子能力为 `CoordinationControl` | 命令、身份、期望版本、接受／拒绝及原因 | 事件和快照组装、事务复核实现 | 协调消费者收窄到具名能力；Control 准入与 Ledger 提交复核均保留 |
| DispatchEngine | 从持久待办选择、准备、领取、启动、事实消费和恢复 | `DispatchPort`、`RuntimeDispatchPort`、各业务 drive port | 触发范围、处理数量、拒绝／阻塞／恢复结果 | outbox 扫描、lease 细节、上下文组装顺序 | 普通、查询、审查、换手、返工保留各自权限；共享可靠启动机制 |
| VerificationEngine | 工具检查、独立 Reviewer、Evidence、失败义务和重验 | `VerificationServicePort`、`VerificationPort`、`ReviewerVerificationPort` | 精确材料、检查能力、verdict 来源与不可用 | Reviewer journal、检查组合、报告构造 | 不把局部 PASS 直接当任务完成；Control 保留正式归约 |
| ArchitectureReconciler | 基线与源码对账、Finding／Brief、迁移门 | `InspectionPort`、`ArchitectureDecisionPort`、`MigrationGatePort` | 来源绑定、版本、机械差异与待人判断 | 图读取、差异计算、逐项提交顺序 | 组合根构造实现；不能用未知来源生成确定业务结论 |
| WorkerRuntime | 一次模型／工具运行、取消／生命周期控制、公开观察 | `RunPort`、`ReadOnlyQueryPort`、`HandoffControlPort`、`LifecycleControlPort` | 能力、输入、运行 ref、结果／unknown／unsupported | 内核事件转换、进程管理、观察持久化 | 运行承载不取得规划或完成权威；产品必须显式提供能力 |
| StateLedger | canonical 快照、事件、幂等、CAS、outbox 与提交时不变量 | `StateLedger`、`ScopeCatalogPort` | load／events／commit 的版本与冲突 | SQLite／内存事务和各 commit-kind 校验 | 校验已按提交职责归组；统一 commit 入口和最终竞争复核保留 |
| ArtifactVault | 不可变正文、owner、来源、读取授权和运行公开观察 | `ArtifactPort`、材料／观察端口 | ref、摘要、owner、来源、拒绝原因 | 文件布局、原子写、观察 journal 格式 | WorkerRuntime 的 journal 是本 Module 的正式存储能力；不成为运行状态权威 |
| ReadModelIndex | 已提交事件的确定性投影、cursor、查询和重建 | `ReadModelIndex` 及各窄查询 port | freshness、来源、scan gap、公开 view | 内存结构或 SQLite SQL／事务／索引 | 共享相同事件解释；保留两种存储实现的查询优势 |
| ContextCompiler | 按角色／任务／scope／预算选材，返回 ready／缺料／拒绝 | 各 Context／Material port | 请求 ref、来源版本、材料缺口和预算结果 | 检索、过滤、manifest、正文组装 | 业务消费者依赖窄端口；WorkspaceReader 仍负责底层源码读取 |
| WorkspaceReader | 沙箱内源码、索引、来源身份、版本适用性和多语言读取 | `WorkspaceReadPort`、`RoleSourceIndexPort`、`SourceApplicabilityPort` | 路径／scope、来源 pin、stale／unsupported／rejected | 文件系统、语言索引、摘要计算 | 各语言索引是本 Module 的正式能力；不把存在一个实现写成全面语言支持 |

小而清楚的 Module 没有被强制增加目录层级。目录只在一组规则共同修改且当前平铺会迫使读者理解无关行为时拆分。

## 生产行为和接口契约

| 行为与触发者 | 责任与公开操作 | 输入／结果／失败、权限和顺序 | 持久权威、重复与恢复 | 真实消费者及处理决定 |
| --- | --- | --- | --- | --- |
| 创建目标；用户／HTTP | HumanCollaboration `createGoal` → Control | 身份、workspace、目标正文；返回接受或用户可读拒绝；先准入再提交 | Goal snapshot／event；幂等键和 CAS；重试复读正式回执 | app service；保留现有入口 |
| 初始需求和架构协商；用户 | HumanCollaboration／PlanCompiler `requestInitial`，Control 正式受理 | 有界材料和来源；缺料、需人决定、拒绝分开；提案不能直接写状态 | Plan／Baseline／Decision 事件；按 correlation 恢复 | app service、初始规划 drive；保留责任分离 |
| 计划变更与返工；执行反馈／验证失败／用户决定 | PlanCompiler 产提案，Control `recordPlanChangeProposal`／decision／apply | 当前 plan、义务和来源；权限、草稿一致性、人的拒绝逐步复核 | proposal／decision／PlanRevision；断点从已提交步骤继续 | ReworkDrive、service；不得由内存 queue 保存唯一待办 |
| 普通或计划任务启动；操作员／规划 wake | Dispatch `drive`／OperatorDispatchPort | scope、任务、角色绑定、材料和 workspace 能力；blocked／rejected／started 分开 | Plan、TaskLease、Attempt、Run、outbox；Control claim + Ledger CAS 唯一启动 | service、DurableWake；共享启动机制，保留 ordinary 权限 |
| 只读 Query；用户／协调者 | QueryJobDrivePort + ReadOnlyQueryPort | 来源、轮次、只读能力；unavailable／stale／quarantined 明示 | QueryJob／QueryRun／Answer + runtime observation；重启先对账结果 | service；不注入 writer Context，不盲目重跑 unknown |
| 独立 Reviewer；验证流程／用户 | Reviewer dispatch + ReviewerVerificationPort | reviewer 资格、精确输入输出和来源；撤权、材料不适用即拒绝 | ReviewWork／Run／授权／报告绑定；恢复先查观察和正式 output | service／Verification；不与普通完成合并 |
| 工作换手；用户／运行故障 | HandoffPort + HandoffControlPort + dispatch handoff drive | predecessor、replacement、材料和能力；请求、接受、unsupported、unknown 分开 | HandoffPacket／ReplacementAttempt／lease／Run；旧运行与替代者不并发持有权 | service；共享 lease／事实消费，保留换手资格 |
| 取消运行；用户／Control | ControlCommandPort／LifecycleControlPort | 先持久化 desired state，再调用 runtime；requested／acknowledged／unknown 分开 | ControlIntent、runtime facts；重启对账而非把 abort 调用当完成 | operator、query、review、handoff 驱动；M05 机制保留 |
| 注册 Agent 与参与工作；Control／runtime | `CoordinationControl.registerAgentInstance/startParticipation/endParticipation` | 模板、work、run、role binding；身份、权限、当前参与状态校验 | AgentInstance／Participation／WorkContextBinding；Ledger 在提交时复核引用和版本 | CoordinationDrive／tool access；已收窄公开依赖并按 participation 归组 |
| 定向请求与回应；参与者工具 | `sendDirectedRequest/respondDirectedRequest/cancelCommunication` | 已登记参与者、接收者、用途、预算和 correlation；非法关系零写入 | DirectedRequest／Delivery／CommunicationIntent；重放按幂等和当前状态 | Worker coordination tools → Dispatch coordination access；按 directed-request 归组 |
| 订阅与分页路由；参与者／事件 wake | `createSubscription` + intent claim／settle | scope、event filters、page cursor；只允许策略内来源，分页必须持久 intent | Subscription／Delivery／route intent；重启按 pending intent 继续 | CoordinationDrive；内存 wake 只唤醒，不保存 cursor 或启动权 |
| 等待、deadline 与后继；参与者／timer／delivery | `registerWait`、intent lifecycle、`admitWaitSuccessor` | 条件、策略、材料和 successor 权限；wait 满足与 successor claim 原子关联 | WaitCondition／Admission／lease／Run／outbox；Ledger CAS 防竞争 | CoordinationDrive；按 waiting／successor 归组，保留最终复核 |
| 工作材料补充和历史；worker／协调者 | ContextCompiler material ports + ArtifactVault | 精确 work/run/source、读取授权、摘要和预算；missing／revoked／stale 明示 | artifact、grant／revocation、binding；重编译复读当前来源 | Dispatch、PlanCompiler、HumanCollaboration；不把工作区权限等同历史读取权 |
| 架构检查与决定；用户／source wake | InspectionPort → Control architecture decision | baseline 与 sourceBinding；机械差异、有待语义判断、过期和拒绝分开 | Finding／Brief／Decision／Baseline revision；逐回执恢复 | service／composition；组合根只装配，不自行决定 |
| Agent 报告跨 Work 架构冲突→人决定→决定投递及受影响 Work 接续；持有精确 principal 的运行／本地用户／dispatch wake | Worker coordination `reportArchitecture` → HumanCollaboration `ArchitectureReviewEntry.report/decide` → Control `recordArchitectureReview`；决定投递复用 `CoordinationControl.claimCommunicationIntent/settleCommunicationIntent` | 报告必须绑定真实 Run、当前 Plan／baseline／workspace、来源 finding／brief／proposal/candidate 和完整 Work directory；至少两个受影响 Work。只有人可 accept／reject／defer／modify，且必须提交界面所见精确 revision 与 proposal digest。未受影响 Work 为 `notify`，受影响 Work 为 `resume`；决定落账后才产生逐 Work intent，dispatch claim 后才投递；候选基线不会因回执自行激活 | `ArchitectureReview`／`ArchitectureChangeDecision`、逐目标 `CommunicationIntent`／`Delivery`，受影响项另建 `WaitCondition`，后继由 admission／Run input binding／ModelRequest evidence证明采用。重复报告按 Run+key 和 command idempotency 复读；重启由 pending intent、wait 与已提交 delivery 继续，lease generation 与 Ledger CAS 防重复；unknown／已结束但无采用证据不得伪装完成 | 生产工具接线在 `persistent-platform`，人的 view／decide 在 app service，`CoordinationDrive` 投递并由 architecture review view 汇总 delivered／waiting／bound／attempted／failed。保留一条端到端职责链，不让 UI、组合根或内存 wake 取得决定或接续权威 |
| 投影推进和查询；Host／UI | ReadModelIndex `advance` 和窄 view ports | event page、cursor、scope；gap／freshness 可见；查询不得写 canonical | cursor 与投影表；重启从 cursor 重放 | service／UI／Context；共同事件解释共享，SQL 事务保留 |
| 来源读取和索引；Context／Runtime／Vault | WorkspaceReader ports | root、path、language、source pin；unsupported／stale／rejected 明示 | 文件／Git 来源是权威，索引可重建 | ContextCompiler、WorkerRuntime、ArtifactVault；实现类是正式模块能力而非任意内部 helper |
| Runtime 公开观察；WorkerRuntime | ArtifactVault `RuntimeObservationJournal` | 仅公开、可引用观察；写失败不能伪造业务成功 | 原子 journal 文件 + run facts；重启用于对账，Control 仍裁决状态 | CodingAgentRuntime、ReadOnlyQueryRuntime；保留跨模块能力并在 README 明示 |

## 跨 Module 实现导入逐项归类

静态扫描发现 118 个被跨归属静态导入的 Module 实现文件。[interface-audit.json](interface-audit.json) 已在每一项上写入 `dispositionClass` 和具体 `disposition`，不再有 `pending`：27 项是正式 Module interface，84 项是 Host composition，7 项是测试／样例替身。下表解释这些逐项结论采用的判断规则。

| 类别 | 具体入口 | 决定与依据 |
| --- | --- | --- |
| StateLedger 的权威只读规则 | `governance-records` 被 Control／Context 使用 | 保留为 StateLedger 正式读取能力；它只从 Ledger 解析已提交治理版本，不复制状态。后续 README 公开该入口 |
| Control 的确定性政策 | role-binding、coordination-policy／rules、goal-change consistency、initial-plan normalization、work identity dedupe | 保留并视为声明的确定性规则 Interface；消费者必须用同一规则才可避免签发／展示漂移。它们不替代 Control 的提交准入 |
| PlanCompiler 的有界协调规则 | rework compiler、planning work identity | 保留；Dispatch 只调用提案／材料规则，不获得 Control 提交权 |
| ContextCompiler 的窄材料能力 | alternative report、delivery、feedback、work-run、exploration、runtime context | 类型依赖改为窄 port 时不新增 adapter；`assembleRuntimeContext` 是真实共享装配规则，调用方无需重排材料步骤 |
| WorkspaceReader 的来源能力 | exploration/source applicability、reviewer source、各语言 source index、source identity | 保留为 Module Interface；多个语言实现体现真实策略差异，不强塞进布尔开关万能索引 |
| ArtifactVault 的观察存储 | `RuntimeObservationJournal` 被两个 Runtime 使用 | 保留为正式存储能力；它序列化可恢复公开观察，不决定 Run 是否成功。增加模块说明，不建立只有一个实现的假 adapter 层 |
| 具体实现类型只用于装配 | `ControlEngineImpl`、`PlanCompilerImpl`、Context compilers、ArchitectureReconcilerImpl、CodingAgentRuntime | 仅 Host／composition 构造；允许组合根依赖具体实现，业务模块的运行依赖均用 port 或窄类型 |
| 测试／演示替身 | Fake runtime／query／lifecycle／workspace reader | 只允许测试或明确演示装配使用；真实产品路径必须显式提供能力。S04 完成类型隔离和生产入口收口 |

没有为每个跨文件函数增加转发接口：只有真实跨 Module 消费、隐藏规则或保证单一解释的入口才保留公开。JSON 中每一项同时保留 destination、consumer、symbol 与声明导出，可由具体 import 反查裁决；重新执行 `interface-audit.mjs` 会重算导入并重新应用同一裁决规则，避免人工编辑的 disposition 被扫描覆盖。

## 非 Module 目录的责任

| 目录 | 责任 | 公开边界与处理 |
| --- | --- | --- |
| `src/contracts` | 版本化跨 Module 协议、值对象与确定性结构校验 | 保留真实消费者需要的导出；内部 helper 回所属 Module；持久字段不机械改名 |
| `src/app` | HTTP／桌面 Host、生命周期和用户请求适配 | 只组合流程、发 wake 和呈现回执；真实产品改走显式能力装配 |
| `src/composition` | 产品／持久测试对象图装配 | S04 分离产品必需能力与测试默认替身；不做业务判断 |
| `src/storage` | 原子文件等无业务语义原语 | 保持小而平；不升级为第十三 Module |
| `src/ui` | 展示视图并发起公开请求 | 不读取 Ledger 或 Runtime 内部结构裁决状态 |
| `src/fixtures` | 宿主实际使用的确定性样例 | 名称和消费者明确；不得作为真实模型效果证据 |
| `src/testing`、`tests` | 测试替身、契约／集成／恢复／浏览器验证 | 历史票号可作为夹具追溯保留；当前说明不能声称超出覆盖范围 |
| `scripts` | 结构、构建和证据检查 | 输出是检查证据，不成为产品状态权威 |
| `vendor/coding-agent` | 有来源的内置执行内核 | 只按本地适配需要修改并维护 provenance；本轮结构整理不搬迁上游内部目录 |

## S01 收口和后续约束

S01 的行为与责任已覆盖生产入口，跨 Module 实现导入已逐类给出处置。独立检查在 snap-03 指出首轮表格把“架构检查与决定”概括得过宽，遗漏了独立的 ArchitectureReview 报告→人决定→逐 Work 投递／等待／采用链；上表已按真实接口、权限、顺序、持久权威和恢复语义补齐，而不是把它并回基线检查一句话。S02 的协调归组、S03 的读模型收敛和测量、S04 的生产装配／队列／命名审查均已有各自证据，当前统一等待 snap-04 独立复验。任何新增公开入口都必须补充真实消费者、失败和恢复语义；不能用文件移动、转发层或测试通过替代上述行为证据。
