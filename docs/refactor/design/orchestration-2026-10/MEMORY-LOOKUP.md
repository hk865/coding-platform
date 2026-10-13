# 双图记忆：语义结构与确定性查找

**方案已定（决定 49）；第 4 片的规格输入，接口待 lead 冻结。**
2026-10-10 按审阅修订：标明现状 / 待实现，与设计书的一致或冲突
2026-10-10 晚：用户已定 Q1、Q2、Q7、Q8、Q9 都选 A，见 [HANDOFF 决定 49](../../HANDOFF.md)；有出入以决定 49 为准。

源码基线 13d5616a（起草时是 11b3f3f2；两次提交之间 src/ 没有变化，只改了文档）。已核对 `git diff --stat 11b3f3f2 13d5616a -- src` 为空。
决定 49 已定 Q1、Q2、Q7、Q8、Q9 都选 A，相关规则标【已定（决定 49）】；仍标【提议】的是待 lead 核定的接口细节或可选补充，不重新打开已定选择。【待实现（第 N 片）】只说明施工归属，不表示已冻结或完成。本文由 lead 审核。下文 DESIGN.md、model/MODEL.md 均相对本目录；其他路径相对仓库根，冒号后为起草时的行号或源码符号。旧行号只作追溯；现行设计读 [DESIGN](DESIGN.md)，实施状态读 [STATUS](../../STATUS.md)。

## 1. 要求：做好意味着什么

用户原话（2026-10-10）：

> 我希望我们的双图的记忆，语义层一定要做好，可以被工具给快速查找得到。这个跟规范和工具选取有关，可以的话，工具本身尽量不要涉及模型要结构化。

【已定（决定 49）】【待实现（第 4 片）】记忆以架构图、任务图的锚点定位；模型在工作中写结论、指出冲突，工具按确定规则保存、查找、过滤和分页，内部不调用模型或 embedding。这延续 DESIGN.md:589–595 的归属与唯一写入口；决定 49 的 Q1(A) 已把关键词全文提前到第 4 片，调整了决定 23 的排期；DESIGN §3.7、§8.2 和附录 C 已同步。

【提议】【待实现（第 4 片）】以下是待落实的验收行为，不是已经通过的结果；第 4 片冻结时写入规格，第 9 片核对实际使用效果（DESIGN.md:694–702、1201）。

| 属性 | 拟验收规则 |
| --- | --- |
| 可达 | 已知锚点可分页取回有关注记；每个主、附加锚点都能反查。不是一次返回全部正文。 |
| 确定 | 同请求、权限、记录依据、来源观测和规则版本得到同一顺序；跨页依据变了明确报错。 |
| 无模型 | 查找及其下游不调用模型；咨询旧成员是另一项显式行为。 |
| 新鲜 | 按相关定义和文件摘要判断需复查；未核对、来源不可用不能冒充有效。 |
| 防污染 | 拒绝、撤下、已取代及未解决冲突项不进现行结论；历史保留处置和纠正入口。 |
| 可追溯 | 装配记下注记版本与来源；查到参与或负责事实不等于得到派工授权。 |

**性能尺子。**【提议】【待实现（第 9 片）】【没实测的数字】基准集：单项目 10,000 文件、2,000 任务、20,000 注记、100,000 注记历史版本、100,000 关系引用（O34 字段中的引用，不是独立关系记录），含 10,000 Session、50,000 Run；正文平均 1 KiB。测试机暂用本地 SSD、4 核、16 GiB，记录实际 Node 版本、数据分布及索引大小。这些规模、机器条件和下表数字已列入 DESIGN §9.3“没实测的数字”，仍待验证，不能写成性能承诺。

| 请求 | 【提议】【没实测的数字】暖缓存 p95 | 【提议】【没实测的数字】工作量 |
| --- | --- | --- |
| 按锚点、路径、状态查第一页 | ≤50 ms | 默认 20、最多 100 条，不读原历史正文 |
| 注记全文查找 | ≤150 ms | 最多 8 个词、100 条，不调相关性排名 |
| 关系引用、历史、冲突第一页 | ≤100 ms | 每次最多检查 1,000 个候选引用 |
| 当前性核对 | ≤250 ms | 每项最多 32 个文件，每次 256 个不同文件、合计 8 MiB |

【提议】【待实现（第 9 片）】【没实测的数字】冷启动首次查询 p95 ≤500 ms（不含建索引），全量重建 ≤60 s；分别测单读者与 4 个读者加 1 个写者，并记录 p50/p95、中文短词、热门锚点及最后一页。超额度标“未核对”，不省略核对来达标。这些数字也已登记在 DESIGN §9.3；内存后端的扫描成本单列，不能拿 SQLite 结果代表两个后端。

### 1.1 决定和本稿的边界

| 已有依据 | 本稿守住什么 |
| --- | --- |
| DESIGN.md:589–595、702；docs/refactor/HANDOFF.md:21–44 | WorkGraph 唯一写入，记忆不改执行状态；看、找、记保持简单；先读记忆，再读原历史，最后咨询。关键词搜索原在 MVP 后，决定 49 已提前到第 4 片。 |
| DESIGN.md:625、648、673–682 | 本目标先用，书记审后供全项目参考；工作线和成员不独立挂记忆；结构与矛盾由用户审。 |
| DESIGN.md:109–112、964 | 多秘书共用图上记忆；K2 暂不算 MVP 门槛，不能借检索设计提前压缩施工。 |
| DESIGN.md:570–579、689–692 | 版本检查与语义判断分开；注记读取核对依据，装配保留所用版本。 |

## 2. 现在有什么：代码事实

下表均为【现状】，仅证明列出的代码能力，不证明注记已实现。

| 概念 | 当前代码与位置 |
| --- | --- |
| 架构目录 | src/contracts/architecture-catalog.ts:ModuleDefinition 保存模块名、职责、路径和接口；不是独立文件或永久符号身份目录。 |
| 源码观测图 | src/core/work-graph/architecture/graph-index.ts:resolveAnchorNodes 是私有、未导出的函数；导出读取函数的真实名称是 buildObservedNeighborhood（L149）和 buildObservedImpact（L197），分别做邻域和影响读取。观测图锚点见 src/core/work-graph/architecture/contracts.ts:ObservedGraphAnchor。 |
| 任务图 | src/core/work-graph/model/plan-contracts.ts:TaskRow 没有顶层 stage；任务的可选阶段编号在 definition.stageId，阶段定义在 TaskGraph.plan.stages（src/contracts/plan.ts:RuntimeTask、PlanRevisionSnapshot）。src/core/work-graph/tasks/plan-service.ts:queryTaskGraph 投影计划与执行事实，保留未来任务。 |
| 图引用与来源 | src/contracts/graph-context.ts:GraphNodeRefV1 包含 goal/stage/task/module/session/run/round，stage/task 带 PlanRef；没有 file/symbol/message 分支。ContextSourceV1 预留 note 版本引用，但不负责存取注记。 |
| 文件与符号 | src/core/workspace/ports.ts:SourceLocation、SourceQuery、SourceCoverage 提供文件位置、符号查询和覆盖说明；文件摘要区分 raw_bytes 与 decoded_utf8，不是永久符号身份。 |
| 参与和负责 | src/contracts/core/session.ts:SessionWorkLink 记录 ref/revision/since/until；src/contracts/core/identity.ts:SessionWorkLinkRef、WorkLinkRelation 定义目标和 responsible/participates/investigated。转移与归档处置已有独立写入口，见 §3.3。 |
| 配置与记忆的区别 | src/core/work-graph/configuration/role-memory-service.ts:createRoleConfigurationService 管职责配置；文件名带 memory 不等于有注记存取。 |
| RecordStore | src/core/record-store/lookup-ports.ts:RecordLookupPort 只有预注册字段的精确标量 lookup，没有文本查询。src/core/record-store/sqlite-record-store.ts:createLookupIndexes、lookupInside 建 JSON 表达式索引、按记录键翻页。 |
| 两个后端 | src/core/record-store/in-memory-record-store.ts:createInMemoryRecordBackend 与 src/core/record-store/sqlite-record-store.ts:createSqliteRecordBackend 实现记录后端；加全文端口必须两边都做。 |

### 2.1 “看图 / 找图”现在查什么

【现状】工具入口是 src/core/agent-runtime/graph-tools.ts:createGraphTools；图读取在 src/core/work-graph/views/graph-context-reader.ts，具体如下。

| 符号（同上图读取文件） | 实际行为 |
| --- | --- |
| lookGraph、buildCard | 按节点或路径读卡片，下钻 children/neighbours/executions/checks；原历史和精确输入由 src/core/agent-runtime/graph-tools.ts:dispatchLook 转给相应 owner。 |
| modulesMatchingPath | “.”列模块；其他路径与 module.paths 完整相等匹配，不是目录前缀，也不搜接口路径。 |
| findGraph、presentationOf | 对名称、路径、说明做区分大小写的 includes；Goal 搜 objective，Stage 搜 title，Task 搜 title/instruction，Module 搜 name/paths/responsibility，Session/Run/Round 搜各自投影文字。 |
| loadUniverse、findGraph | 先读该 Goal 的当前图及相关事实，再过滤；不搜注记正文、消息正文、原历史或符号。没有全文、分词、相关性排名。 |
| parsePage、basisKeyOf | 有分页和依据检查；现有依据没有纳入未接线的注记版本，不能直接当作记忆分页契约。 |

【已定（决定 49 · Q2）】【待实现（第 4 片）】保留这些 v1 行为，在“看/找”中加明确的 memory 分支。全文是第 4 片新增的检索能力；现有“找”不搜注记文字是实际缺口，不能把名称查找写成全文已做。

### 2.2 上下文与尚缺的部分

【现状】src/core/agent-runtime/context-assembler.ts:renderContext、createContextAssembler 已统一装配，预算只裁足迹、注记、提醒和输入。src/core/work-graph/views/context-extensions.ts:createContextExtensionsReader 目前接了异常锚点；notes 仍返回 not_implemented 和空 rows。

【现状】两条路径都已存在：src/core/agent-runtime/context-assembler.ts:goalPayload（L416–427）把全部 notes.rows 放进不裁剪的 Goal 卡；optionalRowsFromExtensions（L534–545）又把全部 notes.rows 加进预算区。现在内容为空只是因为 notes 没接线，不是代码没有这两条路径。

【提议】【待实现（第 4 片）】第 4 片接入注记前，拆开这两条路径：Goal 卡仅放选中的当前理解索引行（指针、版本、短结论和可用性）；一般注记索引放预算区，排除 Goal 卡已放的同一项，正文按需读。每条注记在一次装配中只出现一次。采用后改装配契约、上述两个函数及相应校验。它与 DESIGN.md:984 的 Goal 卡当前理解索引行及 L987、991 的一般注记预算一致；两条路径分路、去重是接线细节，须写入规格。

【待实现（第 4 片）】注记 owner、O34 状态机、当前理解指针、当前性过滤都还要落地；当前只有扩展槽和来源类型（src/core/work-graph/views/context-extensions.ts:createContextExtensionsReader；src/contracts/graph-context.ts:ContextSourceV1）。不能因“有 note 类型”就称记忆完成。

## 3. 语义层：先把数据写对

### 3.1 锚点与指针

【已定（决定 49）】【待实现（第 4 片）】沿用 O34/O37，一个主锚点、至多四个附加锚点；版本在来源里固定，不把显示名当身份。与 DESIGN.md:618–648、model/MODEL.md:506、548 一致，采用后写入 notes 编解码和校验。

| 归属 | 【提议】定位规则 |
| --- | --- |
| 模块、接口、文件 | 复用模块 id、模块内接口 id、工作区内规范路径；component 只作显示别名，不造平行树。 |
| 目标、阶段、任务 | goal/task 复用正式 id；stage 带 PlanRef。读任务阶段用 definition.stageId 与 plan.stages；跨计划不能只凭 stageId 同字认同一阶段。 |
| 项目 | 放偏好、工具链和长期决定，仍区分来源与确认。 |
| 符号 | 【已定（决定 49 · Q7）】先作文件下的版本化定位：语言、限定名、签名摘要、捕获位置；不新增 O37 锚点种类，不承诺跨重命名稳定，见 Q7。 |
| Run/Session/消息/检查/原历史 | 是来源指针，不是记忆账户；先沿既有事实定位任务或模块，再按锚点取注记。 |

【提议】【待实现（第 4 片）】主、附加锚点都进入按锚点索引；不另加全局“来源→所有注记”索引。来源反查限于已定位锚点的候选，并报告覆盖范围。前者细化 DESIGN.md:633；后者收回初稿额外的反向引用索引，避免暗增附录 C 清单。

### 3.2 注记、状态与谁能改

【已定（决定 49）】【待实现（第 4 片）】数据以 O34 为准：anchor/extraAnchors、kind/topic、conclusion/body、facts/basis/source、goalId/runId、state、replaces/contradicts，不再加 tags、关系记录或平行 topicId（model/MODEL.md:499–511）。正文解释适用条件和理由，指针保留依据；版本保留方式还须在第 4 片落实为 notes 契约，不能把 RecordStore 的 revision 数字当作已有的通用历史查询。

| O34 存储状态 | 含义与处理（决定 49；具体状态行待冻结） |
| --- | --- |
| staged | 修补暂存；适用检查通过时随架构修订生效（第 8 片接生效入口）。 |
| accepted | 本目标收下，不表示内容已被证明正确。 |
| reviewed | 书记审过，项目可参考；不等于用户批准。 |
| pending_review | 结构或矛盾先交用户，额度整理交书记；两者都有先用户。 |
| rejected | 审查拒绝，保留原因；不永久阻止同话题新结论。 |
| superseded | 生效的新项点名旧项，由 notes 唯一写入口同次提交旧项状态，见 §3.3。 |
| withdrawn | 有权者撤下，保留原文、经过及来源，不自动恢复旧结论。 |

【已定（决定 49）】【待实现（第 4 片）】这些状态沿 DESIGN.md:626、671–680 和 model/MODEL.md:506；用户优先处理结构/矛盾、之后书记整理的顺序已由决定 49 第 07 项采用。状态迁移放 state，唯一写入口在 notes（DESIGN.md:1151；model/MODEL.md:509）。拒绝输入不先造 accepted 记录。

【已定（决定 49）】【待实现（第 4 片）】CurrentPointer 与新理解同次提交，写入带读过的指针版本；竞写失败重读合并。读取不等写者，只返回已提交版；撤下后显示“当前理解不可用”，不自动回退。前两项与 DESIGN.md:632、679、model/MODEL.md:520–525 一致；撤下不回退已按决定 49 第 05 项写入 DESIGN §3.6。

【提议】【待实现（第 4 片）】读取派生 freshness=fresh/stale/unchecked/source_unavailable、conflicting、invalid、updateDue，不存成 note.state。这里的 **invalid 是 O36 的“作废”**：暂存修补所属执行的任务已取消或被替代（DESIGN.md:630；model/MODEL.md:534），不是第八种存储状态。接口另有 code=invalid 的输入拒绝，含义是返回拒绝、不写 note；两者不可混用。

【已定（决定 49）】【待实现（第 4 片）】currentEligible 仅取 accepted/reviewed，范围可见、选择有效、fresh，且非 conflicting/invalid。accepted 限本目标，跨目标仅 reviewed；updateDue 提醒补理解，stale 则不能当现行结论。范围和失效与 DESIGN.md:625、652、682、686–692 一致；过滤规则已写入 DESIGN §3.6，具体 notes/views 接口在第 4 片冻结。

### 3.3 关系与冲突位置

【已定（决定 49 · Q8）】【待实现（第 4 片）】**不新增独立关系记录。** 初稿给关系单列 id、类型、端点、版本、来源和提交序号，会把 DESIGN 附录 C 的四种新记录变成五种，和 DESIGN.md:1489、model/MODEL.md:506 不一致。决定 49 选 A，关系只用 O34 现有字段：

| 关系叫法 | O34 字段与查法 |
| --- | --- |
| about | anchor + extraAnchors；按锚点读。 |
| evidence_of | facts: Source[]；事实正文仍由原 owner 读取。 |
| derived_from | 也用 facts。model/MODEL.md:58 的 Ref.kind 包含 note，L72 的 Source 持有 Ref，因此可引用固定版 note，不需新字段。 |
| supersedes | replaces；被点名的旧项可反查同锚点候选中谁替代它。 |
| conflicts_with | contradicts；双方位置由 note id、版本和各自正文/来源定位，不另存冲突边。 |

【已定（决定 49 · Q8）】【待实现（第 4 片）】新增一条规则：**replaces 和 contradicts 只能指向至少共享一个锚点的注记**，主锚点、extraAnchors 都算。两条相冲突的结论讲的是同一件事，因此要有共同锚点。想链接另一锚点上的注记，写者先把那个锚点加进自己的 extraAnchors。反查“谁取代或反对我”时，合并各锚点索引的候选，去重后检查这两个字段即可，不需要邻接索引。该规则已写入 DESIGN §3.3 和 MODEL O34，**不加字段**。字段须像 AST 一样有明确类型、可校验；读工具可从 A 无损推导关系图。B（独立关系记录）是升级版，只在实测证明 A 不够时采用；必要时可先加能从注记重建的反查索引，本期不另存关系记录。

【已定（决定 49）】【待实现（第 4 片）】新项受理生效、旧项变 superseded，以及涉及的当前理解指针，都由 notes 唯一写入口在同次提交完成；不是读工具改状态，也不是另起关系服务写。与 DESIGN.md:676、679、model/MODEL.md:509、523 一致。仍待审的新项不能提前取代旧项；已拒绝/撤下的旧项保留原终态，关系留在新项 replaces 中。这两项边界已写入 DESIGN §3.6，状态规则在第 4 片落实。

【已定（决定 49）】【待实现（第 4 片）】工具核对被明确点名的冲突及同话题重写，不能识别全部自然语言矛盾。未解决的互斥说法返回警示和双方位置，不一起装作有效；用户决定取代或附清楚条件并存，书记随后整理。双向读取和上下文过滤已按决定 49 写入 DESIGN §3.6；不再另加边的片段/处置字段。

【现状】participates_in、responsible_for 不是记忆关系：参与从任务图、执行和已有 SessionWorkLink 读，负责从正式 link 读（src/core/work-graph/model/plan-contracts.ts:TaskGraph；src/core/work-graph/model/execution-read-contracts.ts:TaskExecutionRecord；src/contracts/core/session.ts:SessionWorkLink）。转移由 src/core/work-graph/sessions/session-responsibility-service.ts:transferSessionResponsibility、disposeArchiveResponsibility 写；归档由 src/core/work-graph/sessions/session-lifecycle.ts:archiveSession 写。【提议】【待实现（第 2 片）】图查找汇总这些事实；模块维护负责关系仍按第 8 片接，不由注记推导（DESIGN.md:1194、1200）。

### 3.4 版本、新鲜度与写入规范

【提议】【待实现（第 4 片）】需复查在读取时算，不保存 stale 状态，也不建失效依赖索引或传播闭包。比较所声明文件摘要、相关 task/module 定义；目标理解在采用新方案后需复查。对 facts 中的 note 引用读取其固定版和当前处置，不能因旧结论被替代仍当现行依据。文件/定义核对一致于 DESIGN.md:657、689–692，“该更新了”也明确读时计算（L652）；note 依据核对是补充，采用后写读取规则并限深、防环。

【提议】【待实现（第 4 片）】readBasis={recordCursor,indexGeneration,sourceObservation,ruleVersion} 绑定本次读取。sourceObservation 是本次有界核对得到的文件摘要、捕获引用及覆盖说明，不新增第五种正式记录；装配保留实际使用的观测依据。缺覆盖、超额度、读时发现变化，返回 unchecked/source_stale；不把 watcher 没事件当作文件未变。跨页依据变了要求重读。此契约超出 DESIGN.md:689–692，采用后补读取/装配契约；现有依据工具见 src/core/workspace/ports.ts:SourceCoverage，图页依据见 src/core/work-graph/views/graph-context-reader.ts:basisKeyOf。

| 项目 | 已定规则与待冻结细节（均待第 4 片实现） |
| --- | --- |
| 词表与别名 | 继续用 kind/topic，不加多值 tags。受控别名和版本化词表只是可选补充，不自动引入登记服务；超出 DESIGN.md:619–620、model/MODEL.md:506，采用前要定配置归属和维护者，未采用就只查原词。 |
| 路径与符号 | 工作区相对路径，拒绝越界；大小写按工作区规则。同名符号列候选，解析失败退到文件并标未知。文件下的版本化定位已由决定 49 的 Q7(A) 定下，具体定位契约待第 4 片冻结。 |
| 结论 | 【没实测的数字】结论 ≤200 个字符（按 Unicode 码点算；200 个码点在 UTF-8 下最多 800 字节，所以不另设字节上限）。把 DESIGN.md:621 的“约 200 字”明确为统一校验规则，与答复页 06 一致。 |
| 正文和数量 | 【没实测的数字】正文 ≤3,072 字节、当前理解 ≤6,144 字节；16 个事实指针、32 个依据文件、1+4 个归属。决定 49 已采用这些初值，并写入 DESIGN §3.3、§9.3，仍待实测。 |
| 活跃额度 | 【没实测的数字】每锚点 5 条收下的注记，目标、阶段各另有 1 条当前理解；每目标 200 条活跃注记。历史、拒绝、撤下不占；超额交书记，不静默淘汰。这些初值已按决定 49 进入 DESIGN §9.3“没实测的数字”表。 |
| 写入拒绝 | 不存在/越权锚点、假身份、无固定来源、超长、错误版本、未共享锚点的取代/冲突均返回拒绝，保留草稿，不截断保存。前几项沿 DESIGN.md:671–679，共享锚点规则已由决定 49 采用；第 4 片落实 notes 校验。 |

## 4. 索引与查找工具

### 4.1 存储与索引选型

【已定（决定 49）】【待实现（第 4 片）】按 DESIGN.md:633、1543–1545，注记先用三类既定索引：**按锚点、按审查状态、按暂存它的 Run**。按锚点索引覆盖主、附加锚点；结果按版本、提交序号和 id 稳定整理，历史从第 4 片保存的 note 固定版本读，不增另一套时间索引。决定 49 的 Q9(A) 只再加一个全文索引，DESIGN 附录 C 的总清单已从 14 个变成 15 个；这是设计清单，不是已实现数量。

【现状】src/core/record-store/ports.ts:GoalRecordTransactionPort 提供 readMany、lookupCommit、commit、eventAt，没有按任意记录列出全部历史版本的通用接口。【提议】【待实现（第 4 片）】notes 应把固定版本及处置依据保存成可按键读取的注记内容，并用既定按锚点索引列候选；这属于 O34 的版本保留实现（MODEL 见 model/MODEL.md:506–511），不是新增时间/版本索引。具体物理键在第 4 片冻结时定，不能声称今天已经能读 note 历史。

| 初稿额外四类索引 | 已定范围（决定 49 · Q9） |
| --- | --- |
| 分类/多值标签 | 删除；O34 只有 kind/topic（model/MODEL.md:506），不加 tags 或数组展开索引。 |
| 时间/版本 | 删除；按锚点所得条目按版本和提交序号整理，详情历史按第 4 片的 note 固定版本读。 |
| 关系邻接/失效依赖 | 删除；取代与冲突用共享锚点规则反查；需复查按读时核对（DESIGN.md:689），该更新了同样不存（L652）。 |
| 全文 | 唯一保留的新增类：已列为附录 C **第 15 个索引**，第 4 片做；索引注记 conclusion/body/topic，端口和两个后端一起改。 |

【现状】src/core/record-store/lookup-ports.ts:RecordLookupPort 没有文本搜索；两个后端见 §2。【已定（决定 49 · Q1、Q9）】【待实现（第 4 片）】给 RecordStore 窄端口加**一个文本查找操作**：内存后端按相同规范做子串扫描；SQLite 后端用 FTS5 加 2-gram 预处理及命中校验。两个后端给出相同文本候选语义和顺序；WorkGraph 统一复核权限、正式状态和可用性，RecordStore 不承担业务授权。这确实改动共享基础层，不是填 notes 的预留数组；需要后端一致性验证，内存扫描也不承诺索引性能。

**lead 提供的环境实测（本次没有复测）：**
lead 2026-10-10 在 WSL（Node v24.18.0）的 node:sqlite 实测：FTS5 可用；trigram 分词能查到 ≥3 个字的中文（如“架构图”）和代码路径（如“graph-context”）；2 个字的中文（如“锚点”）用 trigram 和 unicode61 都查不到，LIKE 能查到。所以中文要先切成 2 字片段再建索引。

【提议】【待实现（第 4 片）】据上述样本，连续中文生成 2 字片段后编码为 ASCII token，写入 FTS5；查询同样切分、AND 匹配，再核对原文的规范化子串，避免分散片段误中。英文标识符保留整词并拆 camelCase/下划线；全文做 NFC 和 ASCII 大小写折叠，路径精确查找不沿用。它是超出 DESIGN.md:1034 的新文本规范；不能从样本推出唯一可行算法或所有部署已验证。

【提议】【待实现（第 4 片）】部署时用 node:sqlite 建临时 FTS5 表并查询中英文样本，记录版本；失败明确 unsupported，不静默把 SQLite 退成全库扫描。首版不引向量库或独立搜索进程。端口不暴露 SQL/MATCH 表达式；全文只是候选，返回前仍读正式 note 状态。采用后改共享端口、两个后端及 notes 投影维护。

【提议】【待实现（第 4 片）】全文是可重建投影，记录与索引同事务更新；重建未完成明确 index_not_ready。需要按词查历史时索引固定版本，不能只索引最新正文却声称历史全文完整。与原记录和单次提交方向一致，索引代及历史全文是超出 DESIGN.md:676、1538–1552 的细节，采用后纳入该一个文本操作的契约。

### 4.2 读取契约：六种操作、两个入口

【已定（决定 49 · Q2）】【待实现（第 4 片）】下表是六种**逻辑读取操作**，不是六个正式记录或六个公开工具。lookup/neighbors/history/conflicts 进“看”的 memory 分支，find/stale 进“找”的 memory 分支。与 DESIGN.md:592、1033–1035 的简单外观一致；六操作已写入设计书；版本化 memory schema 在第 4 片冻结，不能往 v1 严格参数中直接塞字段。

| 操作 | 【提议】输入、结果及边界 |
| --- | --- |
| memory_lookup | anchor、kind/topic、current/history → 当前指针和直挂注记；主、附加锚点合并去重。 |
| memory_find | keywords、anchor/path、kind/topic、state → 命中项、片段、matchedBy。全文已由决定 49 的 Q1(A) 定为第 4 片做；不提供 tags/recent 排序选项。 |
| memory_neighbors | note/anchor、关系字段、方向 → 从 O34 引用和同锚点候选读邻项，不做全项目任意多跳遍历，不建邻接索引。 |
| memory_history | noteId、可选 version → 正文版本、审查、取代、撤下经过；读取第 4 片保存的 note 版本及处置依据，不新建时间/版本索引。 |
| memory_conflicts | noteId/anchor → contradicts 双方、版本、状态、来源及取代/决定引用；无结果只表示没有已登记冲突。 |
| memory_stale | goal/anchor 范围 → 分批核对候选的需复查、未核对、来源不可用项及原因；不依赖持久 stale 表。 |

【提议】【待实现（第 4 片）】共同返回 readBasis、items、warnings、nextCursor、complete、coverage；每项带 id/version、锚点、kind/topic、结论、storedState、freshness、currentEligible、来源和关系字段。current 默认只给有效结论，同时给失效提示入口；历史和核对视图可返回不可用项，但不得去掉状态。采用后补 DESIGN.md:665、689–692 对应读取规格。

【提议】【待实现（第 4 片）】【没实测的数字】默认 20 条、最多 100 条，完整 JSON ≤48 KiB；正文默认 2 KiB、最多 4 KiB，按 UTF-8 字符边界分页；当前性扫描默认 200、最多 1,000 个候选；词最短 2 个汉字或字母/数字。数字已登记在 DESIGN §9.3，仍须验证，不把测试上限当作已满足的容量。

【提议】【待实现（第 4 片）】游标绑定权限、完整请求、规则、索引代和记录/来源依据；变更返回 revision_conflict，参数不符返回 cursor_mismatch。扫描未完可返回空 items 加游标和 complete=false；未知不是空结果。错误对象中的 code=invalid 仅表示非法请求；与 §3.2 的派生作废标志分开。错误带重读、缩小范围或固定版查看出口；不吐半个 JSON。与图页现状可复用的部分见 §2.1，新增 note 依据和过滤须第 4 片实现。

### 4.3 装配器怎样使用

【提议】【待实现（第 4 片）】从本任务、definition.stageId 对应的 plan.stages、目标及涉及的架构节点取可用索引，去重后按固定归属、用户确认、topic/id 排列。Goal 卡只放选中的当前理解索引行；预算区放一般注记索引，按 §2.2 去重，正文按需读。与 DESIGN.md:665、984–994 的常驻索引方向一致，选择次序和拆分为补充，采用后改装配器。

【提议】【待实现（第 4 片）】保留约 4 KiB 动态总预算（【没实测的数字】是适用性未实测的设计初值，见 DESIGN.md:1331；代码默认值见 src/core/agent-runtime/context-assembler.ts:770–772），角色、目标要求、验收和接续说明不裁；冲突/失效提示放不下，就不装受影响结论并说明不完整。每行带 note 版本、锚点、来源和复查状态，跨目标标“书记已审·未经用户确认”（DESIGN.md:682、984–994）。已绑定输入不暗中重拼；以后主动查到新版须标明。不能把现有 Goal 内容核对扩大称为“任何记忆更新都已拦住旧执行”（src/core/agent-runtime/context-assembler.ts:createContextAssembler）。

## 5. 规范与工具选取

【提议】【待实现（第 4 片）】优先复用现有源码定位工具，记忆工具负责有效性、来源和固定引用；全文只补文字命中。现有语言查询及覆盖说明在 src/core/workspace/ports.ts:SourceQuery、SourceCoverage；不为记忆再造永久符号系统。它延续 DESIGN.md:643、689 的文件定位，符号扩展见 Q7。

【已定（决定 49）】【待实现（第 4 片）】核心检索不使用模型、embedding 或查询改写器，接受近义词、跨语言问法的召回损失。受控别名只有明确采用、定好维护规则后才加入；不声称确定规则能识别所有语义冲突。它细化 DESIGN.md:592 的工具分工，超出原书的别名部分仍需定范围。

### 5.1 和设计书的关系、采用要改什么

下表区分决定 49 已采用的范围和仍待冻结的细节；“一致”不表示代码完成。代码事实是 §2 的基线快照，当前实现状态见 STATUS。

| 项目 | 起草时的设计出处 | 与现行设计的关系 | 实现状态 | 后续工作 |
| --- | --- | --- | --- | --- |
| O34 字段表达关系；共享锚点 | DESIGN.md:1489、676；model/MODEL.md:506、509 | 【已定（决定 49 · Q8）】字段和共享锚点规则已并入设计；初稿独立边已收回 | 【待实现（第 4 片）】 | DESIGN §3.3、MODEL O34 已同步；第 4 片落实 notes 同次提交，不加字段或关系记录 |
| 分类/多值标签索引 | DESIGN.md:633；model/MODEL.md:506 | 初稿超出，删除后一致 | 【待实现（第 4 片）】既定注记索引 | 不做 tags，只用 kind/topic |
| 时间/版本索引 | DESIGN.md:633、1538–1552 | 初稿超出，删除后一致 | 【待实现（第 4 片）】 | 锚点结果排序；notes 落实固定版本保存/读取 |
| 关系邻接/失效依赖索引 | DESIGN.md:652、689、1538–1552 | 初稿超出，删除后一致 | 【待实现（第 4 片）】 | 同锚点反查，失效读时算 |
| 全文索引 | DESIGN.md:1034、1538–1552 | 【已定（决定 49 · Q1、Q9）】提前到第 4 片，设计已同步 | 【现状】src/core/work-graph/views/graph-context-reader.ts:findGraph 不搜注记；【待实现（第 4 片）】 | 附录 C 已加第 15 索引；第 4 片改 RecordStore 及两个后端 |
| views→notes，evidence→notes | DESIGN.md:1153–1154；docs/refactor/reviews/evidence/workgraph-split-2026-10-07/target.json:19 | 一致，不是新取舍 | 【待实现（第 4 片）】 | 首个 notes 文件落地时登记模块和依赖 |
| readBasis/sourceObservation | DESIGN.md:689–692；model/MODEL.md:534–539 | 超出：观测契约和跨页一致性更具体 | 【现状】src/core/work-graph/views/graph-context-reader.ts:basisKeyOf 只有图依据；【待实现（第 4 片）】 | 扩读取及装配依据，不新增正式观测记录 |
| 词表/别名 | DESIGN.md:619–620；model/MODEL.md:506 | 超出，仍可选 | 【待实现（第 4 片）】采用后才纳入 | 先定配置归属和维护规则，不顺带加登记服务 |
| 符号锚点 | DESIGN.md:643；model/MODEL.md:548 | 【已定（决定 49 · Q7）】文件下的版本化符号位置，设计已同步 | 【现状】src/core/workspace/ports.ts:SourceQuery 有定位；【待实现（第 4 片）】 | 按 Q7(A) 冻结定位接口，不新增锚点种类 |
| 六读取操作／两个入口 | DESIGN.md:592、1033–1035 | 【已定（决定 49 · Q2）】两入口、六操作，设计已同步 | 【现状】src/core/agent-runtime/graph-tools.ts:createGraphTools 有两入口；【待实现（第 4 片）】 | 按 Q2(A) 冻结 memory 分支的 schema 和路由 |
| 文字、额度与性能基线 | DESIGN.md:621、680、1325–1343 | 文字限额已由决定 49 第 06 项采用；新增性能数字仍未实测 | 【待实现（第 4 片）】限额；【待实现（第 9 片）】性能测量 | 数字均记“没实测”，更新 §3.3、§9.3 及规格 |
| goalPayload 拆分 | DESIGN.md:665、984–994 | 一致；落实 L984 的当前理解索引行和一般注记分路 | 【现状】src/core/agent-runtime/context-assembler.ts:goalPayload、optionalRowsFromExtensions 两条路径已在；【待实现（第 4 片）】拆分 | 改 goalPayload、optionalRowsFromExtensions 及装配契约 |

**views 读 notes 不需要再问用户。** 设计已把“来源不可用”放在 views（L7），因为要读更高层的消息和检查结果（DESIGN.md:1154）。预留方案明确 notes 依赖 model、state、persistence、architecture、sessions、tasks，usedBy 为 evidence、views（docs/refactor/reviews/evidence/workgraph-split-2026-10-07/target.json:19）。
当前 docs/refactor/module-target.json:26 说明 notes 尚无文件，首文件落地才声明；docs/refactor/module-dag.md:149 的“除 notes 以外”是这一时点的清单。检查器要求声明路径存在（scripts/check-boundaries.mjs:183），不是撤销设计中的依赖。
【提议】【待实现（第 4 片）】首个 notes 文件落地时按预留方案声明 notes，同时给 views、evidence 加 notes 依赖；这是落实既定放置，不是新增用户决定。

**决定 49 之后的落地清单：**

- 【已定（决定 49）】DESIGN 附录 C、§3.3、§3.7 等已同步全文第 15 索引、共享锚点、文字限额和读取规则；第 4 片按这些范围冻结规格。
- 【已定（决定 49）】MODEL O34 已补 replaces/contradicts 共享锚点规则，不加字段；读取契约另写第 4 片规格。
- 【提议】【待实现（第 4 片）】docs/refactor/module-target.json、docs/refactor/module-dag.md：声明 notes、views/evidence 依赖。
- 【提议】【待实现（第 4 片）】src/core/record-store/lookup-ports.ts（并接到 ports.ts）、in-memory-record-store.ts、sqlite-record-store.ts：一个文本查找操作和两个后端；notes 接可重建全文投影。
- 【提议】【待实现（第 4 片）】src/core/agent-runtime/context-assembler.ts、graph-tools.ts，src/contracts/graph-context.ts 及 WorkGraph 的 notes、state、views：存取、过滤、memory 分支、装配拆分；词表/符号只做已选范围。
- 【未实测】DESIGN §9.3 已登记记忆方案的规模、限额、延迟和机器条件；实现与性能结果等相应分片验证。

**第 4 片原范围。** DESIGN.md:1196 的施工内容原文：

> 记忆核心：注记、当前理解指针（写新的一版核对版本）、注记状态机、失效判断；“记”；装配器的注记和提醒段；书记的触发；你的注记接口；两个版本列表；队列加上“等你审的注记”这一来源；节点详情的注记一栏里列出异常锚点（锚点本身第 1 片做）

【待实现（第 4 片）】决定 49 已定共享锚点反查、全文及 RecordStore 两个后端改造（Q1/Q9）、两入口内的六种读取操作（Q2）、文件下的符号定位（Q7）和文字限额。来源观测/游标、版本化 schema、装配两路径拆分等接口细节由 lead 冻结；词表/别名仍是可选补充，不自动纳入。模块声明是在落实原放置，不是新功能。**选择已定，第 4 片的施工规模仍须在规格冻结前重估**。

## 6. 和各片的关系、已定选择

| 片 | 【提议】落点（均须按已选范围冻结） |
| --- | --- |
| 2 | 【待实现（第 2 片）】双图读取、参与事实、正常活动计数及旧记录补算（DESIGN.md:383、1194）；记忆关系不承担这些事实。 |
| 4 | 【待实现（第 4 片）】原记忆核心及 §5.1 明列的增量；全文已由决定 49 的 Q1/Q9 定为本片做，原范围见 DESIGN.md:1196。 |
| 6 | 【待实现（第 6 片）】秘书按目标取记忆、完整交接、改目标的影响清单（DESIGN.md:109–112、1198）。 |
| 7、8 | 【待实现（第 7 片）】派工、干预和换手使用版本及既有负责事实；【待实现（第 8 片）】修补生效与模块负责关系（DESIGN.md:1199–1200）。 |
| K2 | 【待实现（第 K2 片）】压缩保留来源和注记链接，检索内不调用模型；MVP 边界不变（DESIGN.md:937、954–964）。阈值调整在答复页 27 说明。 |
| 3、5 的接线 | 【现状】createContextExtensionsReader 留有 notes 槽，createDecisionReadModel 有来源扩展入口；【待实现（第 4 片）】接注记、提醒及待审来源，勿称全部已支持（src/core/work-graph/views/context-extensions.ts:createContextExtensionsReader；src/core/work-graph/views/decision-read-model.ts:createDecisionReadModel；DESIGN.md:1196）。 |

### 已定选择（决定 49，2026-10-10）

原 Q3–Q6 与答复页 05、04、06、16 重合，也已按决定 49 采用的答复处理，不再重复提问。

| 问题 | 已定结果 |
| --- | --- |
| Q1 关键词全文 | A：提前到第 4 片，加有界全文和两个后端改造；决定 23 的原排期据此调整。 |
| Q2 工具入口 | A：“看”“找”各加 memory 分支，内部六种操作；接口 schema 待第 4 片冻结。 |
| Q7 符号定位 | A：文件归属 + 可核对的版本化符号位置；不承诺跨重命名的永久身份。 |
| Q8 关系保存 | A：O34 字段 + 共享锚点规则，严格定型、校验，读工具可推出关系图。B 是实测不足后才采用的升级版，A 可无损生成 B 的记录。 |
| Q9 额外索引 | A：只加全文，附录 C 从 14 个变成 15 个；不加标签、时间/版本、关系邻接索引。 |

## 7. 一页图

【已定（决定 49）】【待实现（第 4 片）】图按 §3.3、§4.1 的已定范围画，全文在第 4 片做；具体读取和装配接口仍待冻结。与 DESIGN.md:633、1154、1489 及 model/MODEL.md:506 的关系见 §5.1。

~~~mermaid
flowchart TB
  A["架构 / 任务 / 项目锚点"]
  N["O34 Note：anchor / extraAnchors / facts / replaces / contradicts"]
  C["O35 当前理解指针"]
  E["固定来源：文件 / 计划 / 消息 / 检查 / 历史 / note"]
  I["既定三索引：按锚点 / 审查状态 / 暂存 Run"]
  F["第 15 索引：全文（决定 49，待实现）"]
  R["共享锚点候选：反查取代与冲突；无独立关系记录"]
  V["notes：读时算需复查；views：算来源不可用"]
  Q["看 / 找的 memory 分支：六种逻辑读取"]
  X["装配：Goal 卡当前理解索引；预算区一般注记；去重"]
  W["任务图 / 执行 / SessionWorkLink：参与与负责"]
  U["UI / agent / 书记；编排另核对派工条件"]
  A --> N
  C --> N
  N --> E
  N --> I
  N --> F
  I --> R
  R --> V
  F --> V
  E --> V
  V --> Q
  V --> X
  W --> U
  Q --> U
  X --> U
~~~

**起草时的核对边界（2026-10-10）。** 当时只改两份草稿，源码与设计只读核对；未运行产品模型、浏览器或性能测试。FTS 结论来自用户给出的 lead 实测记录，本次未独立复测；它不是部署验收。旧历史每小时计数的可补全性、注记额度、规模与延迟、K2 实现和效果仍待各片验证，不能写成现状。