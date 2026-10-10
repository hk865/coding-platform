# 双图记忆：语义结构与确定性查找

**草稿（Codex 起草，待 lead 审核与用户确认）**

2026-10-10；源码核对基线：11b3f3f2。本文只提出设计，不代表第 2、4、6、7 片已冻结或实现。
下文新增的数据、接口、数字与行为均标为【提议】；“已有”只按当前代码判断。本文不改既有决定。

## 1. 要求：做好意味着什么

用户原话（2026-10-10）：

> 我希望我们的双图的记忆，语义层一定要做好，可以被工具给快速查找得到。这个跟规范和工具选取有关，可以的话，工具本身尽量不要涉及模型要结构化。

**语义层：把“这是什么、为什么这样、现在还算不算数”写成可以核对的数据。**
【提议】模型可以在正常工作中写结论、提出冲突；保存、索引、过滤、分页、沿关系查找均由确定规则执行，查找工具内部零模型调用，包括零 embedding 调用。

**记忆：双图上的既有事实，加上挂在图上、有来源和状态的理解。**
沿用决定 23、35·Q9 和回复 01、06：记忆以架构图锚点和任务图锚点定位；注记是“指针 + 语义状态”，还要有简短文字串起含义。线名只是 UI 展示，不能用来认记忆或选 agent。

【提议】以下是可检查的交付条件，不是本次已经通过的测试：

| 属性及一句话解释 | 精确验收规则 |
| --- | --- |
| 可达：知道位置，就能找到有关记忆 | 每条持久注记必须有有效主锚点；主锚点及每个附加锚点各有反向索引。一次结构化 lookup 返回其可用结论、不可用项提示和分页入口，不要求先猜关键词或找原作者。条目过多可翻页；“一次”不是无限返回全部正文。 |
| 确定：相同依据得到相同结果 | 相同规范化请求、权限、记录快照、来源观测和索引版本，返回相同有序数据及游标；不随机、不使用墙钟参与排序、不按模型判断改写查询。跨页依据变了明确报错。 |
| 无模型：查资料不另开一次思考 | 六种查询操作及其下游不调用模型、向量服务或查询改写器；测试用会计数的假 provider，调用数必须为 0。咨询旧 agent 是另一项显式行为。 |
| 快：项目变大仍能用 | 在下述规模测 p50/p95、冷启动、并发写入、中文短词、热门锚点与最后一页；同时检查索引计划，不能先扫完整图/所有历史再截成一页。 |
| 新鲜：依据变了就不继续当真 | 对锚点定义、声明的文件依据、被依赖结论做版本/摘要比对；变了标 stale，未查到标 unchecked/unavailable，三者都不能算现行结论。 |
| 防污染：旧意见能查，但不会冒充当前结论 | superseded/rejected/withdrawn、未解决冲突双方及 stale 项不进入 current 结果。读历史也必须带状态、原因、替代者和冲突位置；不得因全文命中而去掉这些标记。 |
| 可追溯：知道这一轮用了什么 | 保存注记版本、来源版本、关系版本和装配输入摘要；重启后可以重放。找 agent 返回参与或负责的事实，不从某条注记推导派工授权。 |

**性能目标：先约定测量尺子，不能把目标写成实测结果。**
【提议】基准集为单项目 10,000 文件、2,000 任务、20,000 注记逻辑条目、100,000 注记历史版本、100,000 关系；含 10,000 Session/50,000 Run 的来源索引，正文平均 1 KiB。本地 SSD、4 核、16 GiB、仓库支持的 Node 24；记录实际机器、数据分布与索引大小。

| 请求 | 【提议】暖缓存 p95 目标 | 有界工作量 |
| --- | --- | --- |
| 按锚点、路径、符号、状态查第一页 | ≤ 50 ms | 默认 20 条、最多 100 条；不读原历史正文 |
| 注记关键词查找 | ≤ 150 ms | 最多 8 个词、100 条；无相关性调优 |
| 邻域 / 历史 / 冲突第一页 | ≤ 100 ms | 最多 2 跳；每次最多检查 1,000 条边 |
| 当前性核对 / stale 页 | ≤ 250 ms | 每项最多 32 个依据文件，每次最多 256 个不同文件、合计 8 MiB |

【提议】冷启动首次查询 p95 ≤ 500 ms（不含首次建索引）；全量重建目标 ≤ 60 s，放在维护流程。分别测单读者与 4 个读者加 1 个写者。超出哈希额度标“未核对”，不能为了达标省略核对。所有延迟与容量均待实测。

### 1.1 决定、答复与旧研究的边界

**权威：用户决定与设计建议要分开读。**
已读[回复全文](model/REVIEW-SLICES-2-4-6-7-USER-REPLIES.md)，其页首仍标“草稿，尚未成为决定”；本文承接用户的新要求，但不把其中 lead 的建议升级为已定。

| 来源 | 本文必须守住的边界 |
| --- | --- |
| [HANDOFF](../../HANDOFF.md) 决定 20–23 | WorkGraph 唯一写入；状态迁移经 state；语义修补随工作检查；看/找/记简单；记忆核心进 MVP，关键词搜索和排序调优原定 MVP 后。 |
| 决定 24、34、35 | 24 是原型获批，不是记忆决定；34 要统一设计/装配器；35 接受 Q6–Q10、Q23：先读记忆再读原历史最后咨询、本目标先用/书记审后全项目用、成员不独立挂记忆。 |
| 决定 37、39、42、46、47 | 多秘书共用锚点记忆；K2 暂非 MVP 门槛；异常锚点是事实，接受并行风险是目标设置中的决定；46 是施工/上下文经验，不是产品压缩阈值；47 按实际展示的 Goal 内容变化重新准备，不能用全局版本锁误挡无关任务。 |
| 回复 01、03、04–08 | 靠锚点找人；日志是正式来源，补算只是兜底；说清注记如何进上下文；更新中读哪版待定；指针与文字额度分开；结构/矛盾先用户，书记整理随后；保留并定位冲突旧结论。 |
| 回复 12、15、16、27 | 改目标要列旧产物影响清单、只重做受影响部分；干预是消息/处置事实；机械版本冲突与语义分歧分开；压缩要结合提示词、工具与记忆，不能丢掉来源。 |

旧研究已沿 docs/ 的“记忆、memory、注记、理解、note、anchor、锚点”检索追溯：
[STATE §2、§5](STATE.md)和[QUESTIONS Q6–Q10](QUESTIONS.md)保留早期记忆调研的现状与四问，后者由决定 35 承接；未找到它们所称独立“记忆调研”的原件。
[CORE-DATA-OPERATIONS §11](../../CORE-DATA-OPERATIONS.md)引用的是旧工程 MemoryLedgerPort，不能据此称本仓库已实现注记；其“放 configuration”的早期方向也已由 STATE 否定。
本稿以 [DESIGN §3、§5、§7](DESIGN.md)、[MODEL O34–O42/R43–R51](model/MODEL.md)、[DIAGRAMS 的 Note 图](model/DIAGRAMS.md)、[AMB-33–36、68–74](model/AMBIGUITIES.md)及[审查页 01–08、12、16、27](model/REVIEW-SLICES-2-4-6-7.md)交叉核对；模型图中的多个可选分支不是同时成立的产品规则。

## 2. 现在有什么：代码事实

以下路径均相对仓库根，冒号后是符号；设计文档中较早的“今天没有”不覆盖后续实现。

| 概念及一句话解释 | 现有记录/行为与源码定位 |
| --- | --- |
| 架构目录：人已采用的模块说明 | src/contracts/architecture-catalog.ts:ModuleDefinition 存 ref/name/responsibility/paths/interfaces（接口有 id/description/paths）；AdoptedArchitecture 存带 reason 的依赖及可选显式包含关系。当前没有独立 component/file/symbol 目录节点。 |
| 架构版本：当时采用哪份结构 | src/core/work-graph/architecture/catalog-contracts.ts:ArchitectureCatalogRecord；catalog-service.ts:adoptInitialArchitecture、reviseArchitectureCatalog、readArchitectureRevision 保存不可变目录修订并切换已有 baseline 当前指针，可读历史。 |
| 源码观测图：从源码捕获的关联证据 | src/core/work-graph/architecture/contracts.ts:ObservedGraphAnchor、ObservedArchitectureRecord 绑定 capture，以 nodeId/path 定位；graph-index.ts:resolveAnchorNodes、buildObservedNeighborhood、buildObservedImpact 支持路径映射、邻域和反向影响。观测不是采用结论，不应覆盖目录。 |
| 任务图：计划和实际执行事实的投影 | src/core/work-graph/model/plan-contracts.ts:TaskRow、TaskGraph 含定义、阶段、处置、Attempt/Run、关系、输入要求、失败/返工；tasks/plan-service.ts:queryTaskGraph 可选历史 Plan，保留未来任务。历史完成结果用 selectedPlanMatches 区分。 |
| 图引用：已经能准确点名的对象 | src/contracts/graph-context.ts:GraphNodeRefV1 有 goal/stage/task/module/session/run/round；stage/task 带 PlanRef；没有 file/symbol/message 的同名图引用分支。ContextSourceV1 另有记录、产物、原历史区段和预留 note 版本引用。 |
| 文件与符号：源码位置和内容证据 | src/core/workspace/ports.ts:SourceLocation、SourceQuery、SourceHit、WorkspaceFile 有 path、digest、坐标及 symbols/definitions/references 查询；不是永久符号身份。digestBasis 明确区分 raw_bytes 与 decoded_utf8，不能混比。 |
| 异常锚点：执行中断后留下的事实 | src/contracts/session-anomaly.ts:SessionAnomalyAnchorV1 关联 Task/Goal/Plan/Session/Run 等，记录改动与 resultVerification=not_checked；tasks/session-anomaly-codecs.ts:SESSION_ANOMALY_RECORD_SCHEMAS 有 Task/Goal 索引。它不是用户/agent 自写的经验注记。 |
| role-memory-service：文件名不能证明有记忆 | src/core/work-graph/configuration/role-memory-service.ts:createRoleConfigurationService 做 RoleSpec 安装、激活、版本读取和绑定解析，没有注记或经验检索。 |
| RecordStore：按完整键和索引读正式记录 | src/core/record-store/lookup-ports.ts:RecordLookupPort 只接受预注册字段的精确标量条件；sqlite-record-store.ts:createLookupIndexes、lookupInside 在 snapshots 上建 JSON 表达式索引，按 ref_key COLLATE BINARY 翻页。lookup-index.ts:decodeLookupRequest 限 1–200 条。没有全文查询接口。 |
| 持久写入：记录与状态变更共用事务 | src/core/work-graph/persistence/graph-repository.ts:createGoalGraphRepository 复用 RecordStore；src/core/record-store/sqlite-record-store.ts:createSqliteRecordBackend 使用 node:sqlite.DatabaseSync、幂等与版本守卫。migrations.ts:CORE_TABLE_DDL 是四个核心表；保留已有 memory_* 表的注释不证明创建了记忆表。 |
| 材料正文：已有原文存储可复用 | src/core/record-store/body-ports.ts:RawArtifactStorePort 提供 put/read；sqlite-body-store.ts:createSqliteRawArtifactStore 使用 artifacts(key,record)。它不提供注记状态或全文检索；四核心表不是全部物理表。 |

### 2.1 “看图 / 找图”究竟查什么

**图工具：当前是有边界的结构读取，不是注记检索器。**
入口 src/core/agent-runtime/graph-tools.ts:createGraphTools；Goal、工作区和身份由平台绑定，模型不能自报。下表图卡与查找实现在 src/core/work-graph/views/graph-context-reader.ts；原历史/输入由 graph-tools.ts:dispatchLook 转发至各 owner。

| 操作 / 符号 | 实际行为 |
| --- | --- |
| look_graph / lookGraph、buildCard | node/path 读卡片，关系有 card/children/neighbours/executions/checks；另有 history 读 Run 原历史、input 读精确输入正文。任务卡只带当前选中执行，完整执行列表要下钻。 |
| modulesMatchingPath | “.”列全部模块，其余仅 module.paths.includes(path) 完整相等；不是目录前缀归属查询，不搜接口路径。不能和源码观测图的路径解析混为一谈。 |
| find_graph / findGraph、presentationOf | needle 限 1–256 Unicode 码点，大小写敏感的 includes；Goal 搜 objective；Stage 搜 title；Task 搜 title/instruction；Module 搜 name/paths/responsibility；Session 搜 sessionId/role 的规范 JSON；Run 和 Round 搜 id/status/outcome。 |
| findGraph、loadUniverse | 先装入该 Goal 的当前图及相关事实再过滤；不搜注记正文、接口描述、依赖理由、消息正文、原历史、符号。没有分词、模糊匹配、相关性分数。 |
| compareNodes、dedupeSort | 按 Goal→Stage→Task→Module→Session→Run→Round，再按规范节点键排序。“不排序”在旧设计中应理解为不做相关性排名，并非结果无序。 |
| lookGraph/findGraph、parsePage、basisKeyOf | 图页最多 100，默认 20 来自 graph-tools.ts:DEFAULT_PAGE_LIMIT；游标绑定 scope、查询（含 limit）、事实依据和 offset，依据变报 revision_conflict；当前 basis 未覆盖注记扩展版本。每次 owner 列表遍历最多 50 页，超出 incomplete；loadRounds 是对每个 Task 分别限页。 |

src/core/agent-runtime/graph-tools.ts:createGraphTools 的原历史页默认 50、最多 200 条，输入正文默认 2,048、最多 4,096 bytes；finalize 把超过 48 KiB 的工具结果拒为 capacity，不静默截断 JSON。

### 2.2 上下文与尚缺的部分

**装配器：决定模型这一轮默认先看到什么。**
src/core/agent-runtime/context-assembler.ts:renderContext、createContextAssembler 已统一固定段落；足迹、注记、提醒、精确输入共用默认 4,096 UTF-8 bytes，固定顺序及 key 排序，省略有计数；来源和字节区间写入 ContextAssemblyBindingV1。
src/core/work-graph/views/context-extensions.ts:createContextExtensionsReader 目前只接未接手异常锚点；notes/footprint/goalSettings/decisions 仍返回 not_implemented，不能当成“确实没有”。

**接线缺口：填上预留数组还不够。**
context-assembler.ts:goalPayload 当前把全部 notes.rows 当“当前理解”放进不裁的 Goal 卡，optionalRowsFromExtensions 又放入预算区；notes 尚未接线，问题尚未实际显现。【提议】第 4 片接入前必须拆开当前理解指针与一般注记索引，防重复与绕过预算。

现有 GraphNodeRefV1、ContextSourceV1、ContextExtensionsV1 和 role-memory-service.ts:createRoleConfigurationService 只提供部分基础；未见注记 owner/codec、当前理解持久指针、状态/冲突过滤、陈旧判断或注记全文索引。不能据“有 note 来源类型”声称记忆已完成。

## 3. 语义层的结构：先把数据写对

### 3.1 锚点与指针

**锚点：记忆讲的是哪一处；指针：证明它的原材料在哪里。**
【提议】统一 AnchorKey={projectId, graph, kind, localId}；涉及工作区的定位另带 workspaceId。身份与版本分开，不能把可改的显示名当 id；引用固定版本时附 revision、contentHash 和摘要口径。

| 范围 | 【提议】允许的定位及规则 |
| --- | --- |
| 架构语义归属 | module 用已有 ModuleRef；component 只是 module 的受控分类/显示别名，不另建平行树。interface 用 moduleId+interfaceId；不存在的“组件”不能凭名称造锚点。 |
| 架构源码归属 | file 用工作区内规范路径；symbol 用文件锚点+语言+限定名+签名摘要+捕获位置，不能只用行号或短名。首版将 symbol 作为 file 下的版本化定位，不能声称已具备跨重命名永久身份。 |
| 任务语义归属 | goal/task 复用正式 id；stage 在 PlanRef 中定位，跨计划沿用须有明确映射，不能因 stageId 同字就当同一阶段。当前理解仅挂 goal/stage。 |
| 事实查找端点 | run/session/message/round、Attempt、Plan/目录修订、产物和原历史区段均可作固定来源指针；允许反查引用它们的注记，不把它们变成独立记忆账户。 |
| 项目归属 | project 放长期偏好、工具链和决定说明；仍区分来源与确认，不跨项目共享。 |
| 不允许的归属 | 工作线、成员卡、线名都不能成为注记的主/附加归属。查 Session 可沿参与关系到 Task/Module，再查记忆；这遵守决定 35·Q9。 |

【提议】每条注记必须有一个主归属、至多四个附加归属，全部被索引；来源指针至多 16 个。不复制任务图历史为第二套事实。
以 Run/Session/message 为起点的 lookup 返回“被哪些注记引用”及关联 Task/Goal；知道源版本即可一步结构化查到，仍不允许把理解存在成员身上。

### 3.2 注记、状态与谁能改

**注记：有明确适用位置、结论和依据的一条解释。**
【提议】字段如下；不是拟要求作者手填所有版本号。

| 字段 | 精确规则 |
| --- | --- |
| id/revision/schemaVersion | id 不变，内容修订不可变；状态事件另留版本。旧正文不覆盖；索引可重建。 |
| anchor/extraAnchors/kind/topicId/tags | kind=note/understanding/repair；noteKind=convention/pitfall/tradeoff/open_question/preference/decision。topicId 是登记的话题 id，显示词可中文；同一归属同一话题做重复检查。 |
| conclusion/body | 结论是一行，正文解释适用条件、理由和未决点；没有文字的指针集合不构成理解。正文按需读，不默认全部进上下文。 |
| facts/basis | 固定来源引用；写时 Plan/目录版本，相关 task/module 定义摘要，至多 32 个文件摘要及 digestBasis。引用旧 PASS 只是当时的证据。 |
| source/scope | 平台补可信 actor、Session、Run/Query、来源种类、所属目标、提交序号；用户话要带用户确认回执，模型不能自报 human。 |
| relations/review | 关联边、待审原因、所需审查者、审查/撤下原因与回执。要用户定的结构或矛盾不能被“书记已审”跳过。 |

**状态：先区分“收不收下”，再区分“现在还能不能用”。**
【提议】沿用 MODEL O34 的存储词汇，不再加一个与暂存/待审重叠的 proposed 状态；“提议中”由 staged 或 pending_review 加原因表示。

| 存储状态 | 人话及允许的迁移 |
| --- | --- |
| staged | 暂存修补：工作 agent 提交；由 WorkGraph 在适用检查通过、目录同次生效且所需授权齐全时转 accepted，不能由查找工具转。 |
| accepted | 本目标收下：普通合法写入由平台机械受理；只在所属目标可用。格式合法不等于观点正确。 |
| reviewed | 书记已审：书记把 accepted 审成项目可参考；结构/矛盾先取得用户决定。已审不等于用户确认，不给新授权。 |
| pending_review | 待审：结构/矛盾交用户，额度/整理交书记；两种同时发生先用户。全部理由保留，未完成所有条件不进入 current。 |
| rejected | 审查拒绝：相应审查者拒绝，保留版本和原因；新写同话题不被它永久阻挡。schema 拒绝输入则不造一条 accepted 记录。 |
| superseded | 已取代：有权写者显式点名替代对象，WorkGraph 在一事务中受理新项、更新旧项状态与当前指针。新项仍待审时不能提前把旧项宣布已取代。 |
| withdrawn | 已撤下：作者、书记或用户依权限撤下，留原文与原因；不能靠编辑恢复为 accepted，须另写新版。用户话的撤下也留用户原始确认引用。 |

迁移权限的既定依据是决定 20、21、22、35·Q7/Q23；上表具体状态边沿用 DESIGN §3.6、审查页 07/08 的建议，仍为【提议】。写入口在 WorkGraph notes，纯迁移规则在 state；独立审阅轮和只读副本没有“记”权限。

**当前理解：这个目标或阶段现在采用哪一版解释。**
【提议】每个归属一个 CurrentPointer，{noteId, revision, pointerVersion}；更新带读到的 pointerVersion，CAS（版本一致才写）成功后一次提交新版本和指针。竞写失败返回 revision_conflict 与现版引用，保留调用者草稿。
读不等模型写完，只读已提交版本；指针被撤下/拒绝/失效时返回“当前理解不可用”，不自动回退旧版。全局指针指向本目标新 accepted 后，其他目标不能偷偷回退到已取代的 reviewed 老版。

**可用性：曾经收下，并不保证今天仍成立。**
【提议】freshness=fresh/stale/unchecked/source_unavailable，另有 conflicting、invalid、updateDue；这些是读时派生值，不混进审批状态。
currentEligible = 状态为 accepted 或 reviewed ∧ 范围可见 ∧ 当前指针/话题选择有效 ∧ freshness=fresh ∧ 非 conflicting ∧ 非 invalid。
accepted 必须同目标；跨目标仅 reviewed。updateDue 提醒该补理解；代码/计划依据变化另按 stale 排除，不能只挂一个轻提示。

### 3.3 关系与冲突位置

**关系：明说两条记录之间是什么联系，不能靠模型临时猜。**
【提议】边含 id/type/fromRef/toRef/固定版本/来源/提交序号；双向邻接索引由同一条边派生，不维护两份可矛盾的正文。

| 类型 | 精确含义 |
| --- | --- |
| about | 注记讲这个归属；主/附加归属必须有此边。 |
| derived_from | 新理解依据哪条旧结论、计划或消息；不自动继承它的状态/权限。 |
| evidence_of | 一个固定事实支持某条结论；事实仍从原 owner 读取。 |
| supersedes | 新结论取代旧结论；禁止自环和循环，旧项反查必须显示“被谁取代”。 |
| conflicts_with | 两条结论在重叠条件下矛盾；一条无向冲突事实，双边可查；附未解决/已解决状态与决定引用。 |
| participates_in / responsible_for | 从 Task/Module 找参与过或当前负责的 Session；前者由执行事实投影，后者来自正式负责关系，不能从“曾写过注记”猜负责人。 |

**冲突位置：告诉读者旧结论的哪一句不能再用。**
【提议】冲突必须指出双方 itemId@revision、anchor、topic、字段/段落 id 和 UTF-8 字节区间、片段 hash、原因及适用范围；只有整条冲突时显式用 whole_item。新关系不能把旧版区间套到新版文字上。
例：N1@2 的 conclusion“只能单线程”与 N2@1 的 body 第 2 段“允许并发”冲突；双方 currentEligible=false，默认返回冲突提示和链接，不把两句一起当现行规则。
用户选取代后，N1 读作 superseded→N2；选择并存必须写清互不冲突的适用条件。未解决的互斥说法不能以“并存”绕过过滤。

【提议】平台只机械发现同话题重写、版本不一致、已声明冲突、互斥的结构化选择；它不能识别所有自然语言矛盾。作者/书记/用户负责提出和处理语义分歧。目标足迹相交只是风险建议，不能推导两条记忆语义相反。
【提议】冲突关系与失用状态在读取旧正文之前一起查询。已 rejected/withdrawn 的旧项若被新项引用为替代对象，保留原终态，只增加关系，不把“曾被拒绝”改写成“曾经有效”。

### 3.4 版本、新鲜度与写入规范

**新鲜度：核对这条理解所依靠的东西是否还是原样。**
【提议】记录 version 管并发，contentHash 管内容；文件摘要保留算法和 digestBasis，Git blob OID 不冒充 SHA-256。内容哈希用固定规范序列化，不能用更新时间代替。
目标理解在采用新方案后一律需复查（AMB-34 已由正文定）；task/module 注记仅按相关定义与声明文件判断，不把无关计划变化扩大成全项目失效。
derived_from 的结论被取代、拒绝或撤下时，依赖它的 current 候选降为需复查；按反向边传播到闭包，分批未完成时标 unchecked，不能留旧“有效”缓存。

**来源观测：文件不在数据库事务里，必须说明核对到了哪一刻。**
【提议】每次查询绑定 readBasis={recordCursor,indexGeneration,sourceObservationRef,ruleVersion}；sourceObservation 固定有关文件/源码捕获的摘要及完整性，属于完整输入。仅固定 SQLite 而放任文件改变，不满足“同输入同存储”。
平台在准备 current 读取时用 WorkspaceTools 有界取得/核对来源观测；查询算法只消费这份观测，不内部写库、不建索引、不调用模型。回放旧依据明确 historical，不声称此刻仍新鲜。
正常编辑、工具写入、导入及执行结束触发更新；外部编辑在下次 current 读取前核对相关文件。文件观察非原子，检测到读取期间变化、缺覆盖或超额度就 unchecked/source_stale，不能把 watcher 的“没事件”当正确证明。
核对只保证观测时的情况；实际派工/消费仍按正式记录再检查相关版本。翻页沿用同一来源观测，失效则返回重读提示。

**规范：作者提供含义，平台补足能够机械确定的事实。**
【提议】最少填写归属、kind/topic、结论、适用条件和来源指针；从 UI/工具上下文能唯一确定的归属、身份、版本由平台补，歧义则列候选，不让模型猜 id。

| 项目 | 【提议】校验与拒绝 |
| --- | --- |
| 名称与词表 | id/topicId/tag 用已登记值；分类表有 vocabularyVersion。未知 kind/tag 拒 invalid 并列允许值；新话题/别名经书记登记，登记词不等于批准结论。显示名可改，检索别名保留来源。 |
| 路径与符号 | 工作区相对路径，统一“/”，拒绝绝对路径、越界、“..”、空段；大小写按工作区规则，不能全小写合并不同文件。符号同名返回消歧候选；解析失败退到文件定位并标未解析。 |
| 数量与文字 | 结论 ≤200 Unicode 码点且 ≤800 bytes；正文 ≤3,072 bytes，理解 ≤6,144 bytes；最多 8 tags、16 facts、32 basis files、1+4 归属。超限给字段、当前/允许值及保留草稿提示，不截字保存。 |
| 额度 | 暂定每归属 5 条活跃一般注记 + 1 条当前理解，每目标 200 条本目标活跃注记；历史/拒绝/撤下不占活跃额度。修补计入活跃一般条目；超额待书记合并，不自动淘汰用户信息。 |
| 身份与依据 | 不存在/越权归属、伪造作者、只有可变“latest”的事实指针、错误摘要口径、非法关系端点均拒绝。未知数据不是空结果。 |
| 重复与并发 | 同归属同话题活跃项已存在，须明确 replace/coexist；coexist 附条件且不得保留已知互斥 current。写入核查旧 revision；已完成操作幂等重放，不重复改状态。 |

【提议】拒绝顺序固定：请求形状/枚举 → 身份与范围 → 归属/来源存在性 → 文字和数量上限 → 版本/重复/关系 → 额度与待审去向。权限检查之前不返回其他目标的存在性；错误不能靠截断输入“修好”。

## 4. 索引与查找工具：结构化输入，结构化结果

### 4.1 存储与索引选型

**索引：保存“到哪里找”的目录，不成为第二份权威事实。**
【提议】WorkGraph 维护注记/关系规则，RecordStore 提供通用持久与查询能力；views 合成来源状态，AgentRuntime 包装工具。不把记忆放回 configuration，不增加五模块依赖边。

| 索引 | 【提议】键与用途 |
| --- | --- |
| 归属/反向引用 | scope+anchorKind+anchorId→itemId；主/附加归属、事实引用都登记 role，支持一步 lookup，返回为什么匹配。 |
| 路径/符号 | scope+规范路径→file；file+限定名+签名→symbol 候选；目录前缀单独查询。路径迁移建明确映射；旧路径仍能查历史，不静默移挂。 |
| 当前/状态/话题 | scope+anchor+topic 与 currentPointer；scope+goal+status+kind+itemId。生效过滤后再分页，不先截出一页无效项。 |
| 分类/标签 | scope+kind/tag→itemId；多值 tags 展开关联索引，不能指望现有精确标量 JSON 索引自动索引数组元素。 |
| 时间/版本 | scope+itemId+revision；scope+提交序号+itemId。时间只作过滤/显示，提交序号和 id 解决同毫秒并列。 |
| 关系邻接/失效依赖 | from/to+type+relationId；basis 文件/节点/被依赖结论→注记，供邻域、反向取代、冲突和增量复查。 |
| 全文 | 【提议，排期待用户定】注记 conclusion/body/topic 显示词与已审别名的 FTS5 倒排索引；不把全部源码/聊天复制进注记全文库。 |

**FTS5：SQLite 自带的文字查找组件，不是模型。**
核对结果：package.json:engines 要求 Node >=24.15.0 <25；[Node v24.15.0 官方 sqlite.gyp](https://raw.githubusercontent.com/nodejs/node/v24.15.0/deps/sqlite/sqlite.gyp)明确设置 SQLITE_ENABLE_FTS5。因此【提议】支持的官方构建采用 FTS5，不默认引进向量库或另一个搜索进程。
本机 node 不在 PATH，常见安装位置未找到可运行程序，WSL 返回 E_ACCESSDENIED，未完成 node:sqlite 实例验证；不能把上游构建配置写成所有部署环境均已验证。
**lead 实测（2026-10-10，WSL，Node v24.18.0 的 node:sqlite）：** `CREATE VIRTUAL TABLE ... USING fts5(x, tokenize="trigram")` 可用；trigram 能查到 3 字以上的中文（“架构图”）和代码路径（“graph-context”）；2 字中文（“锚点”）trigram 查不到、默认 unicode61 也查不到，`LIKE '%锚点%'` 能查到（逐行扫描）。所以上一段“连续汉字生成 2-gram 再交给 FTS5”的做法是必要的。上面“未完成实例验证”一句以此为准。

【提议】部署自检在 :memory: 中 CREATE VIRTUAL TABLE ... USING fts5、插入/查询中英文样本，并记录 Node/SQLite 版本；不可用则显式 unsupported。若要支持定制无 FTS5 构建，用同一规范分词的 token→item 倒排表替代，须另测一致性，不能静默退成全库扫描。

**中文查找：不能假定默认分词会懂中文词义。**
[SQLite FTS5 文档](https://www.sqlite.org/fts5.html#tokenizers)说明 unicode61 按字符类别划词，trigram 按连续三个字符匹配；不足三字符的全文 trigram 查询不会匹配。
【提议】不直接选默认 unicode61 或 trigram 作为中文体验：由平台版本化预处理，英文标识符拆 camelCase/下划线并保留完整词，连续汉字生成 2-gram；编码成 ASCII token 后交 FTS5。全文用 NFC、ASCII 英文字母忽略大小写，原文保留；path/symbol 的精确匹配不沿用全文折叠。查询按同一规则做 AND，并对命中正文做对应规范化片段校验，防二元组散落造成误中。
【提议】首版关键词最短 2 个汉字或 2 个字母/数字，过短报 query_too_short 并提示改用 anchor/path/symbol；精确 id 不受此限制。短词、全角、大小写、中文无空格均列验收。不给调用者原始 SQL/MATCH 表达式。

**一致性：结果可以少，但不能把过时索引说成全貌。**
【提议】记录、current 指针、状态和关系在原事务内提交；派生索引同事务更新，重建时保留旧代直到新代完整可切换。FTS 是可重建投影，索引不可用不影响原始历史保存。
【提议】全文行以 itemId+revision 为键保留历史版本；current 查询通过当前选择与状态过滤，history 查询明确检索历史。不能只索引最新正文，却声称被取代的旧说法仍能按词找回。
现有 RecordLookupPort 不支持全文、多值展开、范围或任意排序；实现时须扩 RecordStore 的窄端口和两个 backend，不能在 views 直接写 SQL。
查找返回前复核正式记录和权限；索引落后返回 index_not_ready/readThrough，不能返回 ready 空页。分页以过滤后的稳定键推进，不使用不断变大的 offset；一页只读必要投影与有界正文。

### 4.2 工具契约

**工具外观：操作可以细分，agent 不必记六套入口。**
【提议】下表 memory_* 是六个逻辑操作名。推荐将 lookup/neighbors/history/conflicts 挂到“看”的 memory 分支，将 find/stale 挂到“找”的 memory 分支；与既有 graph 分支用明确 schema 判别。公开名字取舍见 Q2。
这是未来 v2 的参数/返回契约；不能直接向第 3 片 v1 严格 schema 塞新字段。旧 look_graph/find_graph 的匹配规则、授权、历史/输入读取及已绑定调用保持原义。

**共同结果：每项都说明“是什么、还能不能用、从哪里来”。**
【提议】返回 {readBasis,items,warnings,nextCursor,complete,coverage}；item 含 id@revision、归属、kind/topic、结论或摘要、storedState、freshness、currentEligible、来源/关系引用、matchedBy。正文只在明确 body 请求中返回。
lookup/find 默认 view=current，只列 currentEligible；另列冲突/陈旧/不可用提示及查询入口。view=history 才列旧结论；权限仍受限。history/conflicts/stale 属核对视图，显式允许列不可用项，但每项保留 currentEligible=false，不能混入当前结论。neighbors 默认返回带状态的端点/边，正文须显式下钻。“source 读不到”保留历史/核对行并标不可用；正式记录/权限服务故障则整次 unavailable。
默认 limit=20，范围 1–100，整个 JSON ≤48 KiB；body 页默认 2 KiB、最大 4 KiB，按 UTF-8 字符边界分页。已有“看历史”仍遵守其自身上限。
当前性扫描默认检查 200 个候选、最多 1,000 个；不足一页可返回空 items 加 nextCursor、complete=false，明确还未查完，不能误称无匹配。
【提议】keywords 每词最多 64 码点，总计最多 512 码点且 2,048 bytes；path 最多 4,096 bytes，symbol 限定名最多 512 码点；未知筛选值拒 invalid。排序字符串采用规范 UTF-8 键的二进制顺序，不用随系统语言变化的排序。

| 逻辑操作与一句话解释 | 【提议】输入 → 输出 | 顺序、分页、特有失败 |
| --- | --- | --- |
| memory_lookup：按已知锚点取记忆 | anchor、view、可选 kind/topic、limit/cursor；详情另给 item@revision、bodyCursor → 当前理解引用、直挂/反向引用的条目、冲突提示 | 当前理解优先，其余 topicId/itemId 升序；一调用联读附加锚点索引，不默认扩邻居。不存在 not_found，多候选 ambiguous_anchor。 |
| memory_find：按条件找记忆 | keywords[≤8]、path（exact/prefix）、symbol（限定名/签名）、kind/tags/status、view、limit/cursor；条件 AND，至少一项 → 命中项、原文片段、命中字段 | 默认 anchorKind/anchorId/topicId/itemId 升序，无相关性分数；可显式 recent 按 commitSeq 倒序、itemId 升序。词长不足 query_too_short，未知词表 invalid，全文未装 unsupported。 |
| memory_neighbors：沿指定关系找相邻对象 | anchor 或 item@revision、relations、direction=in/out/both、depth=1/2、limit/cursor → 端点与边及到起点的路径 | 广度优先：距离、relationType、端点键、边 id；去重防环。每次 ≤1,000 边，游标续前沿；深度越界 invalid，不能裁掉尾部还声称 complete。 |
| memory_history：看一条记忆怎样变来 | itemId、可选 revision、limit/cursor/bodyCursor → 内容版本与审查、取代、撤下事件，带操作人/原因 | revision 倒序、commitSeq 倒序、事件 id 升序；固定版正文按字节页。缺项 not_found，来源缺失为项内标志，不删除历史。 |
| memory_conflicts：看已知矛盾及位置 | anchor 或 itemId、resolved=false/true/all、limit/cursor → 双方版本/片段位置、原因、当前处理人、决定/替代引用 | 未解决优先，然后 commitSeq/id 升序；零项只代表没有已登记冲突。越权端点不暴露正文，返回受限标志；不能让工具判谁正确。 |
| memory_stale：列范围内需要复查的项 | scope 选择 project/goal/anchor、可选 changedPaths、states、limit/cursor → changed/unchecked/source_unavailable、具体变化与依赖链 | anchorKey/itemId 升序；分批核对 ≤256 文件/8 MiB；余项继续游标。无来源观测 source_unavailable，明确 partial；只报告，不自动撤下或重写。 |

【提议】scope 的身份/可见范围、readBasis 由平台绑定；模型只能缩小范围，不能通过 source 指针越权。项目已审记忆可按决定 35 跨目标参考，其事实正文仍要走原 owner 授权。
统一失败：invalid、forbidden、not_found、ambiguous_anchor、cursor_mismatch、revision_conflict、index_not_ready、source_stale、unsupported、capacity、unavailable、cancelled；均含原因和“重读/缩小范围/用固定版查看”等出口。
游标绑定权限摘要、完整查询/排序/limit、ruleVersion、索引代、事实/注记/关系依据及最后键。依据变了返回 revision_conflict，参数变了 cursor_mismatch；不静默接到新一代结果。若单项连摘要都超输出预算则 capacity，不吐半个 JSON。

### 4.3 装配器怎样使用

**默认上下文：先给可用结论的目录，需要时再读正文。**
【提议】只选本任务、所在阶段/目标、足迹架构节点和已审项目偏好的 currentEligible 项；去重后按固定的归属优先级、用户确认优先、topicId/itemId 排列。不按词相似度把别处经验自动塞入。
每行写 id@revision、锚点、简短结论、来源种类、复查状态；跨目标 agent 条目写“书记已审·未经用户确认”。用户确认影响来源与显示，不能压过新的正式事实。
保留既有约 4 KiB 动态总预算，记忆不占新的无限区；Goal 卡只带 current 指针及可用性，正文和一般索引只放预算区一次。角色、目标要求、验收、接续说明照既定规则不裁。
冲突/失效提示先从提醒预算预留空间；若连完整提示都放不下，则不装该结论，输出“记忆不完整，请查冲突/复查项”。不能只裁警告却保留受影响结论。省略计数只在确知总数时填数字，否则写“还有结果，继续翻页”。
装配来源含实际入选注记、current 指针、冲突关系、规则版本与来源观测；已绑定 Run 不重拼。准备后相关依据变了，下一次动作核对并重准备；不能仅因无关 Goal/Plan 变化让其他任务失败。
如需读旧条目，工具输出/压缩桩都带 historical 和当前处置链接；已有 Run 历史无法抹掉，下一轮/安全点须给变更提示，正式授权与版本守卫仍负责阻止旧依据的动作。

## 5. 规范与工具选取

**比较原则：代码位置、文字命中与结论效力是三种不同能力。**
【提议】以下是设计比较，没有在本仓库做同规模基准测试。

| 方法 | 能解决什么；本稿取舍 |
| --- | --- |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | 按字面/正则找文件内容，适合找源码证据；不理解注记状态和关系。保留为代码调查方式，不每次扫描仓库替代记忆索引。 |
| [Universal Ctags](https://docs.ctags.io/en/latest/) | 建符号标签，便于按名称跳到定义；标签本身不能证明模块职责或结论仍有效。若已有解析器够用，不增加第二套符号身份。 |
| [tree-sitter](https://tree-sitter.github.io/tree-sitter/) | 增量语法树便于结构定位，但语法匹配不能证明跨文件类型/运行时关系。新语言支持可单独评估，首版不为记忆再引入。 |
| 现有语言索引 | src/core/agent-runtime/exploration-tools.ts:createExplorationTools 已接 SourceIndex/ProjectSourceIndex/PythonSourceIndex/CppSourceIndex；src/core/workspace/ports.ts:SourceCoverage 明示 coverage、unresolved、filesystemAtomic=false。优先复用，缺覆盖明确返回。 |
| 精确索引 + FTS5 | 身份/状态/关系查准，文字用于补找；确定、可解释、能分页。推荐组合；FTS 不负责决定有效性，先做权限与状态过滤，再输出。 |
| embeddings / 模型检索 | 可找不同措辞表达的近义内容，但向量生成涉及模型，检索版本和近似召回也更复杂。本稿核心工具禁用；同义词靠有来源的受控别名。 |

**不用模型的代价：不会自动理解“说法不同但意思一样”。**
【提议】接受近义表达、跨语言问法和隐含语义的召回损失；由准确归属、话题词表、命名规范和显式关系补足。也不保证自动发现所有语义冲突。
可选语义搜索现在不做；未来若放在核心工具之外，须另由用户决定成本、权限和验证规则。其候选仍须回到固定 id/版本，由相同 currentEligible 规则过滤，不能替代权威记录。

## 6. 和各片的关系、要用户定什么

**分片：把记忆的保存、读取和使用分清，避免每片各造一套。**

| 片 | 【提议】职责与现有冻结接口的影响 |
| --- | --- |
| 2：双图读取 | 节点/路径/符号定位、图→参与 Session 与 Session→节点的双向读取、来源/覆盖率、可分页事实；正常记录活动事实，旧数据补算保留未知。负责关系的生产仍按第 8 片，不能靠读取发明负责人。 |
| 4：注记与理解 | notes owner/codec/state、版本指针、关系/冲突位置、词表、索引、当前性及六种读取操作；按用户决定确定全文是否提前。接入注记详情、书记整理和用户审查来源。 |
| 6：秘书/目标使用 | 新秘书从目标/架构锚点取理解与注记；改目标给出产物影响清单，保留旧证据，受影响项需复查。不借记忆引入 worktree 或自动撤销代码。 |
| 7：派工/干预/换手 | 找人沿负责/参与事实，结合职责、空闲等既定条件；是否建人由编排决定，查找工具不建人。派工核对计划/理解/派工序号；干预仍是消息与提醒，不塞进图名匹配。 |
| K2：压缩 | 桩保留 anchor/source/version/hash 与可回读位置；摘要不代替注记。先缩旧工具结果，再考虑模型摘要；模型摘要是单独流程，不在检索内。原记录保留，失效/冲突标志不可被摘要洗掉。 |
| 已做 3：上下文/工具 | 保留 v1 行为，新增版本化 memory 分支；修正 goalPayload 与 notes 的重复注入，补注记/关系版本到分页与装配依据、失效提示预算。须 lead 明确冻结增量，不能称“原预留接口已全部支持”。 |
| 已做 5：设置/决定 | 第 4 片通过已有扩展位置补注记待审来源，不重写目标设置或决定队列。src/core/work-graph/views/decision-read-model.ts:createDecisionReadModel 是复用点；接受并行风险仍是目标设置事实，注记只引用决定。 |

【提议】K2 研究另行核对 Claude Code/Codex/DSH 的当期公开机制，本文没有验证其实现，也不采用“某模型 30%–40% 就压缩”作产品常量。决定 39 的 MVP 边界不变；决定 46 的实测只说明该批 DSH 长上下文风险。
【提议】施工验收须覆盖：每个主/附加/来源端点可达；翻页无漏重且变更明确失败；竞写与取代原子；已知冲突双向定位；中文短词；外部文件变动及缺来源；跨目标权限；压缩后旧结论仍标旧；检索零模型；目标规模性能。此轮只写稿，未执行这些验收。

### 要用户定（均为【提议】，本稿不代答）

| 问题 | 选项与推荐 |
| --- | --- |
| Q1 最小关键词全文是否提前？ | A：第 4 片加入有上限的注记关键词查找；B：先锚点/路径/状态/关系，全文仍在 MVP 后。推荐 A，响应此次快速查找要求；这是对决定 23 排期的明确调整，排序调优仍在以后。 |
| Q2 agent 看见几个检索工具？ | A：“看/找”各加明确 memory 分支，内部六操作；B：公开六个 memory_* 工具。推荐 A，守住决定 22 的简单外观，内部结构化同样严格。 |
| Q3 更新中与撤下后读什么？ | A：读已提交版、版本冲突重读，撤下后无当前版且不回退；B：等待更新并允许回退仍有效旧版。推荐 A，回应回复 05；保留草稿和缺理解提示。 |
| Q4 跨目标来源怎样显示？ | A：书记已审明确标“未经用户确认”，其他成员可起草用户话但只由用户点“记下”认证；B：仅秘书可提供这种用户话草稿。推荐 A；两者都保留已定的书记审后跨目标使用，不重问逐条人工审批。 |
| Q5 文字与额度用哪组起始值？ | A：采用 §3.4 的 200 码点、3/6 KiB、5+1/200 活跃项；B：保持 DESIGN 的正文约 1 KiB、理解约 2 KiB，目标额度另定。推荐 A，实测后可调，超额不丢字。 |
| Q6 没有当前理解可否首次派工？ | A：所有派工者都核对版本，理解可明确为空；B：必须先有可用理解。推荐 A，避免冷启动等待；不绕过计划/授权。回复 16 的“也许 C”仍需确认。 |
| Q7 本期如何支持符号锚点？ | A：先文件归属 + 可验证的版本化符号定位，改名需明确映射；B：本期做独立且跨重构稳定的符号身份。推荐 A，定位能力先可用，不承诺尚无证据支持的永久身份。 |

## 7. 一页图

**读图方法：上面是记忆归属，中间是状态与证据，下面是工具和消费者。**
【提议】实线表示结构化引用/读取；整条检索链没有模型调用。

~~~mermaid
flowchart TB
  A["架构归属：模块 / 接口 / 文件（符号定位）"]
  T["任务归属：目标 / 阶段 / 任务"]
  P["项目：偏好 / 工具链"]
  N["注记版本：指针 + 结论 + 状态 + 适用条件"]
  C["当前理解指针：每目标或阶段一个，CAS 更新"]
  E["固定事实来源：Plan / 目录 / 文件摘要 / Run / Session / 消息 / 检查 / 原历史"]
  R["关系：about / derived_from / evidence_of / supersedes / conflicts_with"]
  I["精确与邻接索引；可选 FTS5；均可重建"]
  V["读取规则：权限 + 版本 + 新鲜度 + 冲突过滤"]
  Q["看 / 找：lookup、find、neighbors、history、conflicts、stale"]
  X["装配器：可用结论索引 + 异常提示 + 来源版本 + 预算"]
  U["UI / 书记 / agent；编排沿参与和负责关系找人"]
  A --> N
  T --> N
  P --> N
  C --> N
  N --> E
  N --> R
  N --> I
  R --> I
  I --> V
  E --> V
  V --> Q
  V --> X
  Q --> U
  X --> U
~~~

**本次核对边界。** 代码与文档只读核对；未运行产品测试、真实模型、浏览器或性能测试。FTS5 仅确认上游构建启用，待部署运行探针；旧独立记忆调研原件未找到。所有实施与性能承诺须在用户决定、lead 冻结后验收。
