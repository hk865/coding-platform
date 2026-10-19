本区保留 **7 项结构发现：1 类 5 项，2 类 0 项，3 类 2 项**。优先处理注记读写依赖环、活动读窗口的重复控制流程、决定来源的扩展位置、邮箱内部职责，以及目录修订的事务组合边界。

有两处需要先纠正前提：

- 当前只有 **两个**尚未迁移的手写卡源；原清单中的第三个 `message_release` 尚未实现。
- 6B 首先需要的是 **goal／project 主体底座及现有来源的扩展**，不能把主对话中的目标草稿卡、换手“请知悉”，都算成新的 `DecisionCardSourcePort`。

本次没有写文件，没有运行测试或构建。以下结论来自静态查读；行号对应所提供的副本。源码路径省略共同前缀 `src/core/work-graph/`。规格简称：

- **S6**：[slice-6-SPEC.md](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:3)
- **S7**：[slice-7-SPEC.md](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:1)
- **S8**：[slice-8-SPEC.md](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:1)

估算均为**新增行数＋删除行数**，搬移计入两次；不包含剩余分片本身的功能实现及测试。

**结构发现**

| # | 问题（file:line，一两句） | 现在的代价（读、改、复用各难在哪；具体例子） | 剩下哪一片会碰到（spec 和章节；不碰写“无”） | 改法（一两句；只说结构） | 会不会动行为 | 估计改多少行（新增＋删除） | 归类 | 把握 |
|---|---|---|---|---|---|---|---|---|
| 1 | **注记底层读取和纯渲染的归属形成运行时依赖环。** [notes/note-read-model.ts:58](D:/cxt/d84-struct/src/core/work-graph/notes/note-read-model.ts:58) 导入写服务的渲染函数；[notes/note-service.ts:36](D:/cxt/d84-struct/src/core/work-graph/notes/note-service.ts:36) 又导入读模型的底层读取函数。 | **读：**理解写入前的事实读取，要进入 2,780 行的读模型。**改：**读侧、写侧和书记范围读取相互牵连。**复用：**`scribe-scope`、待办、卡事实都从上层读模型取 `readAllHeads`；读模型甚至明确因依赖方向复制 principal 投影，见 [note-read-model.ts:573](D:/cxt/d84-struct/src/core/work-graph/notes/note-read-model.ts:573)。 | **6A**：S6 顶部后注“记忆装配”、L8；**6B**：秘书写注记；**7D2**：S7 §6 查询工具与角色范围；**8C**：S8 §6 注记写入方扩展。 | 把 `readAllRecords`／`readAllHeads` 及其窄类型移入注记底层 reader；渲染函数移入纯函数模块。消费者直接依赖这些叶模块，错误映射直接取现有 `store-failures.ts`；不拆整套搜索、检查和记忆装配。 | **不会。**保留分页到底、失败映射、解码顺序和渲染字节；不顺手改变读取次数。 | **180–280**；约 +100–150／−80–130。 | **1：6A 前做。**先解开依赖，再加无目标记忆分支；6B、7D2、8C 继续受益。 | 高 |
| 2 | **活动族的稳定读取控制流程仍有四份。** [views/activity-read-model.ts:780](D:/cxt/d84-struct/src/core/work-graph/views/activity-read-model.ts:780)、[同文件:805](D:/cxt/d84-struct/src/core/work-graph/views/activity-read-model.ts:805)、[track-read-model.ts:1186](D:/cxt/d84-struct/src/core/work-graph/views/track-read-model.ts:1186)、[task-state-timeline.ts:556](D:/cxt/d84-struct/src/core/work-graph/views/task-state-timeline.ts:556) 都实现“新预算→前水位→读取→后水位→最多四次”。 | **读：**要对照四处才能确认重试和失败规则一致。**改：**预算重置、非 ready 提前返回等规则要四处维护。**复用：**6A 的查询活动批读若照当前入口写法，会自然出现第五份。C1 已合并的活动分类函数不在此项内。 | **6A**：S6 L16、§6，新增 `readQueryActivities`／`activity/queries`，扩展日历、轨道。 | 在活动族内部抽一个稳定窗口执行器，调用方提供窗口读取和错误映射；各自输入检查、游标、错误文字、track 的 `ForbiddenError` 继续留在调用方。 | **不会。**必须保持四次上限、每次新预算、`now()` 调用时机、失败立即返回及水位读取顺序。 | **120–200**；约 +50–90／−70–110。 | **1：6A 活动部分前做。**新查询活动入口直接复用。 | 高 |
| 3 | **决定来源的展示、来源事实和特例分发没有形成对称的内部边界。** [views/decision-read-model.ts:188](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:188) 起混放来源工厂与队列；[communication/decision-source-facts.ts:473](D:/cxt/d84-struct/src/core/work-graph/communication/decision-source-facts.ts:473) 集中维护各来源事实。 | **读：**一种来源要跨展示工厂、来源事实 switch、直接读取的 scope 分支及答复选择规则追踪。**改：**现有 **5 个注入源＋3 个内置源**，来源事实另有 **8 个实分支＋1 个 unsupported 分支**。**复用：**新增来源仍需编辑这些大文件；不是八份完全相同的业务代码，而是扩展登记和来源专属规则散落。 | **6B**：S6 顶部后注主体底座；**6C**：S6 §6；**7A**：S7 §1 `message_release`；**7C**：L17–L19；**7D2**：L32、§2 新卡源；**8C**：S8 L4/L6、§6。明确需要 **6 个新 kind＋补实现 `message_release`**，另有来源字面量未在相关条目指定的换手批准卡。 | 将现有展示来源移到分来源模块，通用 collection adapter 独立；将 `readSource` 的来源专属读取分成具名处理器，由一个有类型的表分发。保留各层公共校验及最终卡状态处理，参考已有 `note-decision-source` 的窄事实端口；不合并显示缓存和提交前事实读取。 | **不会。**先搬移现有规则；goal／project、新卡选项及授权规则仍由对应分片实现。不能借此改变失败映射、检查顺序或源的完整枚举。 | **1,800–2,400**；约 +950–1,250／−850–1,150。不含 #6 的旧协议兼容迁移。 | **1：6B 主体扩展前做；最迟在 7A 新来源前完成。**后续来源以模块和登记增加，减少修改队列协调器。 | 中 |
| 4 | **邮箱把多组独立变化的职责塞在同一闭包中。** [communication/mailbox-service.ts:1042](D:/cxt/d84-struct/src/core/work-graph/communication/mailbox-service.ts:1042) 的工厂同时包住历史读取、当前写授权、正文写入、消息动作、咨询答复和等待处置；共享写者本身又位于 [同文件:3640](D:/cxt/d84-struct/src/core/work-graph/communication/mailbox-service.ts:3640)。 | **读：**定位 Query 发信授权，会同时遇到历史 Run 身份读取和实时 Run 准入，两者不能互换。**改：**7A 消息状态、7B 等待、7C Query 发信都会修改这个 3,766 行文件。**复用：**决定服务依赖的共享写者仍连着整个邮箱实现的私有依赖。已有一个共享写者，问题不是缺第二个。 | **6B**：S6 顶部后注项目请知悉；**7A**：S7 L1–L3、§6；**7B**：L4–L14、§6；**7C**：L20；**7D1/7D2**：主体、角色线消息。 | 保留公开邮箱 facade，内部拆出正文持久化／回执重放写者、邮箱列表读取、调用者准入。消息动作和等待处置继续调用同一写者；各准入策略保留各自入口，避免用大量布尔参数混成一个授权器。 | **不会。**不改提交边界、原回执重放、正文来源、同步快照和历史／当前授权区别。 | **2,000–2,800**；约 +1,050–1,450／−950–1,350。 | **1：共享写者部分在 6B 前；其余在 7A 前。**7B、7C 不再把不同职责继续堆进同一闭包。 | 中 |
| 5 | **目录修订的记录构造与提交绑死，尚不能被另一业务事务组合。** [architecture/catalog-service.ts:697](D:/cxt/d84-struct/src/core/work-graph/architecture/catalog-service.ts:697) 构造 baseline、catalog、active pointer、事件和 guards，随后在 [同文件:730](D:/cxt/d84-struct/src/core/work-graph/architecture/catalog-service.ts:730) 直接提交。 | **读：**纯修订结果与身份重放、读取、提交混在一个流程。**改：**修补生效如果调用现有公开修订，会产生另一次提交。**复用：**8C 要把注记生效、目录／基线／指针、负责去向合成同一事务，目前只能搬出或复制这段构造。 | **8C**：S8 顶部“唯一修订规划器”后注，L4–L6、§6。三类调用是人工修订、修补生效、结构提议落实。 | 从现有修订提取纯规划／提交贡献构造；公开修订仍负责自己的读取、身份重放与提交。后续由 8C 的唯一规划器扩展，状态变更贡献放入 `state/`，不要再造第二个修订 owner。 | **不会。**预备提取保持当前拒绝删模块等限制；8C 放开哪些操作及新增批准门槛，是另算的功能变化。 | **300–460**；约 +180–260／−120–200。 | **1：8C 第一段前做，或作为其首个纯结构步骤。**不必抢在 6A 前。 | 高 |
| 6 | **两个旧卡源与通用 collection adapter 的协议不等价，强迁会引入兼容层。** [views/decision-read-model.ts:188](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:188)、[:206](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:206)、[:226](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:226)；跨区涉及 [tasks/planning-question-reader.ts:123](D:/cxt/d84-struct/src/core/work-graph/tasks/planning-question-reader.ts:123)。 | **读：**当前有两套老适配方式，直接卡读取走枚举回退。**改：**若统一，需要补水位、availability、分页策略及旧错误范围。**复用：**`planning_question` 已有 attempt 缓存，再套通用工厂容易形成双重组装；节省的只是很薄的适配器。 | **6A** 会扩展其下层 Query 数据；**6B/7A/7D2/8C** 会使用或扩展卡基础，但不要求这两个旧源改变读取协议。S4 §14.10 的清理待办即此项。 | 暂不强迁。若 lead 仍要迁，先显式保留来源页元数据和旧分页／定位协议，再改登记；不要把“迁移”和“新增真正按键读”混成一个无行为变化的清理。 | **直接替换会：**分页、水位、缓存和读取失败范围；下文列明。兼容迁移可以保持旧行为，但收益低。 | **400–660**，为保留旧协议的额外改动估算；不重复计算 #3 搬移。 | **3：只记下。**不作为 6B 或 7A 前置。 | 高 |
| 7 | **本区确有两份运行时等价的完整 Run 身份判断，但规模很小。** [sessions/session-directory.ts:111](D:/cxt/d84-struct/src/core/work-graph/sessions/session-directory.ts:111) 与 [communication/mailbox-service.ts:141](D:/cxt/d84-struct/src/core/work-graph/communication/mailbox-service.ts:141)。 | **读：**需比较两份才能确认都允许额外字段。**改：**完整 Run 身份字段若变，要改两处。**复用：**剩余分片主要新增 Query 身份，规格没有要求再复制这两份 Run 判断。 | 两文件会被 6／7 扩展，但**此判断没有已确认的新副本需求**；不是“文件被碰到”就应列 1 类。 | 若以后出现第三个同语义消费者，再抽具名的“具有完整 Run 身份字段”判断；保留 codec 的严格字段校验，不能用一个默认严格 helper 替换。 | **不会**，前提是保持额外字段容忍；换成严格 codec 检查则会改变行为。 | **24–40**。 | **3：只记下。**当前共享收益不足以单开工作。 | 高 |

**关于“三个手写卡源”的逐项核对**

原任务书确实列了 `goal_cause`、`planning_question`、`message_release`，但同一任务书的 lead 后续答复已纠正为“两份真实登记，第三个尚不存在”：[s4c2b-impl.md:54](D:/cxt/d84-struct/docs/refactor/reviews/evidence/orchestration-slice-4C2B-2026-10-17/books/s4c2b-impl.md:54)、[:191](D:/cxt/d84-struct/docs/refactor/reviews/evidence/orchestration-slice-4C2B-2026-10-17/books/s4c2b-impl.md:191)。S4 自己也在 [slice-4-SPEC.md:1083](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:1083) 说明第三个没有登记；[:1119](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:1119) 的“三个”是未同步的数量。

当前组合根的五个注入源为两份旧适配器，以及已经使用通用工厂的 `note_review`、`unknown_call_review`、`command_rerun_request`：[src/composition/create-platform.ts:971](D:/cxt/d84-struct/src/composition/create-platform.ts:971)、[:996](D:/cxt/d84-struct/src/composition/create-platform.ts:996)。`message_release` 在来源事实端仍明确返回 unsupported：[communication/decision-source-facts.ts:915](D:/cxt/d84-struct/src/core/work-graph/communication/decision-source-facts.ts:915)。

| 来源 | 当前分页、缓存、水位、按键读和关闭行为 | 迁移代价及判断 |
|---|---|---|
| `goal_cause` | 适配器一次返回整个集合，忽略来源页的 limit/cursor，`nextCursor`、`sourceCursor` 都为 null；转发 `atLeastCursor`；适配器本身没有 attempt 缓存和 `readByKey`。[decision-read-model.ts:188](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:188) | 现有工厂会改成数字偏移分页和 attempt 缓存，而且 `readCollection` 参数没有 `atLeastCursor`。保留旧协议约 **100–180 行**；不能只换函数名。新增真正按键读取还会改变“枚举别的原因时出错也使本次读取失败”的范围，应单独判断。 |
| `planning_question` | 适配器原样转交整页参数；下层已按 attempt 组装一次、数字偏移分页，并返回 lookup 的 `readThrough`；未接 planning reader 时返回 `not_available`。[planning-question-reader.ts:133](D:/cxt/d84-struct/src/core/work-graph/tasks/planning-question-reader.ts:133)、[:139](D:/cxt/d84-struct/src/core/work-graph/tasks/planning-question-reader.ts:139)、[:216](D:/cxt/d84-struct/src/core/work-graph/tasks/planning-question-reader.ts:216) | 需把“收集规划问题”与“分页投影”拆开，否则先分页再汇总再分页；还须保留 availability 和水位。约 **220–360 行**。当前工厂固定成功页为 `available`、`sourceCursor:null`，直接套用不等价。 |
| `message_release` | 没有当前实现可迁。 | **迁移成本为 0。**7A 新建来源时，在其原生事实读取上登记通用卡源；不能把 7A 功能成本记为 C1 遗漏清理。 |

两份旧源都没有自己的独立关闭回调。卡的已答、落实及目标取消处理仍在公共终结步骤：[decision-read-model.ts:1454](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:1454)。当前单卡读取对没有 `readByKey` 的 provider 会完整枚举来源：[同文件:1356](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:1356)。迁移时不能把这种回退直接替换成新的局部读取，再称为同一行为。

另一个易漏点是：通用工厂的列表路径执行 `closedReasonOf`，而按键路径由 `readByKey` 返回 `{closed}` 或 item，随后投影；不能假设列表的关闭回调会自动再执行一次：[同文件:281](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:281)、[:299](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:299)。

上表两项迁移，加公共适配器保留页元数据／旧协议的约 **80–120 行**，即发现 #6 的 **400–660 行**。

剩余分片的卡来源增量应按以下口径计数：

| 分片 | 确认的增量 | 规格位置 |
|---|---|---|
| 6A | 主对话、请求和思路展示；不能据此增加 `DecisionCardSourcePort` 种类数。 | S6 L6–L7，[S6:125](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:125)。 |
| 6B | goal／project 主体底座；已有 `note_review` 扩到不挂目标的注记，项目理解改写和秘书换手通知。没有在该后注明确新增一种命名卡源。 | S6 顶部后注，[S6:11](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:11)。 |
| 7A | 补实现已预留的 `message_release`。 | S7 L3、§1，[S7:361](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:361)。 |
| 7C | 新增 `member_creation`、`rework_request`；另有换手批准卡。相关条目没有给换手卡指定独立的 source kind 字面量，不能提前把它算成一个确定的新 kind。 | S7 L17–L19，[S7:168](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:168)。 |
| 7D2 | 新增 `role_capacity`、`role_line_change`。 | S7 L32、§2，[S7:246](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:246)、[:530](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:530)。 |
| 8C | 新增 `repair_approval`、`structural_proposal`；后者按冻结 batch 出卡。 | S8 L4、L6、§6，[S8:122](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:122)、[:258](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:258)、[:458](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:458)。 |

因此，**应先做 #3 的来源模块边界，不应先强迁两个旧适配器**。7A 的新 collection 来源可以从第一版直接使用通用工厂；项目主体支持由 6B 按冻结后注实现。

**分页、游标和容量：已经共享什么，仍复制什么**

这里不存在一个应当覆盖所有读取的统一分页器。

| 读取族 | 当前共享情况和必须保留的差异 | 剩余分片是否会继续复制 |
|---|---|---|
| activity／track／timeline | `Budget`、有序扫描、等值扫描、按键读取及活动投影已经共享：[activity-read-helpers.ts:37](D:/cxt/d84-struct/src/core/work-graph/views/activity-read-helpers.ts:37)、[:56](D:/cxt/d84-struct/src/core/work-graph/views/activity-read-helpers.ts:56)。剩下的是 #2 的四份稳定窗口流程。track 是多类活动合并游标；timeline 游标绑定计划和位置，计划变化会失效，不能换成普通 offset。 | 6A 明确增加一个查询活动批读入口，并修改现有日历和轨道。可确定避免的是**第五份稳定窗口流程**；不是再造一套活动分类。 |
| decision cards／queue | 三个 collection 来源共享组装、缓存和 offset 分页；两份旧来源保留自己的协议。队列完整读取来源、维护每 attempt 缓存及自己的窗口移动信号：[decision-read-model.ts:782](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:782)、[:814](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:814)。内部 200 条一页不是整个队列的容量上限。 | 新的七个命名来源可以复用来源端口和集合适配器；不应每个来源复制完整队列。6B/7D1 改主体和跨工作区身份，不等于新增一种分页算法。 |
| notices | 位置比较、合页、分组和“只推进实际展示过的成员”已有公共模块：[notice-position.ts:43](D:/cxt/d84-struct/src/core/work-graph/views/notice-position.ts:43)、[notice-grouping.ts:90](D:/cxt/d84-struct/src/core/work-graph/views/notice-grouping.ts:90)。来源内部仍有不同扫描／缓存；未送达回复还带自己的稳定性及损坏判定。显示 token 是签名证明，不能与普通页游标合并。 | 6A 主对话复用汇总投影；6B 扩主体；7D2 加主体和时间窗口分组。应扩分组策略与输入，不能再建一套“汇总通知记录”。 |
| work-line／node-detail | 工作线预算按请求键数及 lookup/event 调用计费，并有按线、共享读取、部分结果的区别：[work-line-reader.ts:124](D:/cxt/d84-struct/src/core/work-graph/views/work-line-reader.ts:124)、[:269](D:/cxt/d84-struct/src/core/work-graph/views/work-line-reader.ts:269)。节点详情已经复用工作线 brief 和 continuation 解析：[node-detail-reader.ts:55](D:/cxt/d84-struct/src/core/work-graph/views/node-detail-reader.ts:55)。 | 7B 改消息／等待投影，7D 扩职责、范围、creator、名额，8B 补维护者。可沿现有公共装配继续扩；不应套用活动族按索引行计数的预算。 |
| note reads／memory | 读模型内已有请求绑定游标、检索分段、结果字节限制及独立正文分页；版本列表内部又共用另一套请求绑定游标：[note-read-model.ts:589](D:/cxt/d84-struct/src/core/work-graph/notes/note-read-model.ts:589)、[note-version-lists.ts:46](D:/cxt/d84-struct/src/core/work-graph/notes/note-version-lists.ts:46)。这些不是 activity 的时间窗口。 | 6A/7D2 是现有记忆材料的调用种类／范围扩展，没有规格要求再复制一套 memory 游标。应复用现有检查与批读。 |
| queries | 当前 `query-job-service` 和 `query-execution` 主要是提交、执行阶段、按引用读取；它们不是两个已经实现请求列表分页的查询服务：[query-job-service.ts:886](D:/cxt/d84-struct/src/core/work-graph/queries/query-job-service.ts:886)、[query-execution.ts:1767](D:/cxt/d84-struct/src/core/work-graph/queries/query-execution.ts:1767)。 | 6A 才新增请求列表／主对话读取，按 request、归属和时间索引读取。应复用存储扫描能力，单独定义请求游标；不能直接拿 memory 或 track 游标。7D2 探索 Query 复用执行驱动，不进入请求模型。 |

新增／扩展读口的范围如下，不能把每条路由都算成一份确定的分页复制：

- **6A**：`main/read`、`requests/read`；请求按目标、请求根及时间读取，主对话倒序每页 20 条；`activity/queries` 是 1–200 个查询活动的批读，同时扩日历和轨道。见 [S6 L6:125](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:125)、[L16:182](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:182)、[§6:396](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:396)。
- **7D1**：角色上限和 allocation 读口；**7D2**：`role-lines/read`、`role-lines/operations`、目标参谋队列、自治规则读取，并扩现有工作线投影。相关接口没有把这些都定义成同一种分页协议，不能先发明统一上限。见 [S7:534](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:534)。
- **8B**：现有节点详情的维护者投影；**8C**：结构提议／批次读取和两种决定来源。文件图、邻接和影响读取属于已合入的 8A/8D，不应算进剩余新增量。见 [S8 §6:457](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:457)。

**sessions／communication 对 6A、6B、7 的承接**

现有结构已经有能继续使用的 owner 和端口。**跨这些 owner 修改多个文件，本身不是结构缺陷。**需要避免的是新分片各写一套建线、换手或消息提交流程。

| 分片 | 已有位置，以及今天需要触及的文件 |
|---|---|
| **6A 请求轮次** | 新 `queries/request-service.ts` 和 `views/main-surface-read-model.ts` 是规格明确的新文件。现有 `queries/contracts.ts`、`query-job-service.ts`、`query-record-codecs.ts`、`query-execution.ts` 要扩请求字段、索引及执行种类；当前准备函数直接要求 Goal，见 [query-execution.ts:366](D:/cxt/d84-struct/src/core/work-graph/queries/query-execution.ts:366)，调用种类约束集中在 [:116](D:/cxt/d84-struct/src/core/work-graph/queries/query-execution.ts:116)。跨区依赖是 `state/query-run-recovery.ts`、`tasks/request-facts-reader.ts`、Runtime preparation／observation、Host 驱动及路由。应由一个请求入口复用这些阶段，不另造秘书执行机。依据 [S6 顶部后注:6](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:6)、[§6:396](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:396)。 |
| **6A 共用建线** | Runtime 已有两段创建：[src/core/agent-runtime/session-operations.ts:559](D:/cxt/d84-struct/src/core/agent-runtime/session-operations.ts:559)；WorkGraph 已有准入及登记：[sessions/session-directory.ts:678](D:/cxt/d84-struct/src/core/work-graph/sessions/session-directory.ts:678)、[:843](D:/cxt/d84-struct/src/core/work-graph/sessions/session-directory.ts:843)。6A 可以在其外包统一建线入口，无须先拆目录读取半部；角色事实和预留接入时扩登记贡献。入口的具体文件位置不在后注中定死，不应在本次审查擅定。 |
| **6B 共用换手** | `sessions/session-record-codecs.ts` 的 operation 当前只接受 create，见 [:631](D:/cxt/d84-struct/src/core/work-graph/sessions/session-record-codecs.ts:631)；要扩通用 handoff 表示、相关 model 契约及状态迁移。可继续调用 `session-responsibility-service.ts` 的转移入口、`session-lifecycle.ts` 的归档入口及目录操作读取。跨区是新增共享换手驱动、`workflow/secretary-handoff.ts`、`session-maintenance.ts`、`session-archive.ts`。父 handoff operation 与子创建 operation 必须分开，不能拿新 Session 的创建身份充当整个换手身份。依据 [S6 后注:8](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:8)。 |
| **7A 消息放行／落实** | `sessions/message-record-codecs.ts`、`communication/mailbox-service.ts`、来源事实／展示登记及 `decision-application.ts`；跨区 `state/message-machine.ts`、消息契约、DispatchCounter、新路由。消息正文解码已有独立 `message-body-envelope.ts`；提交已有共享 `createMessageWriteOwner`，都应复用。依据 [S7 §6:700](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:700)。 |
| **7B 等待／回复／到期** | 邮箱已有消费输入记录和等待处置：[mailbox-service.ts:2722](D:/cxt/d84-struct/src/core/work-graph/communication/mailbox-service.ts:2722)、[:2845](D:/cxt/d84-struct/src/core/work-graph/communication/mailbox-service.ts:2845)。需扩这些动作、消息 codec、6A 请求入口及 `views/work-line-reader.ts` 消息／等待投影；跨区是消费、唤醒和 Workflow。按规格由已有消息派生等待，不加一张新的 Wait 表，也不另写请求轮驱动。依据 [S7 §6:701](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:701)。 |
| **7C 工具和秘书消息** | 建成员调用 6A 建线，`hand_off` 调用 6B 换手，再加批准卡适配器。秘书 Query 发信需要扩 mailbox 的可信调用者入口、消息 sender codec、Query 执行及 preparation。不能把现有 `authorizeNewWorkRunAction` 当作 Query 授权，也不能借历史身份读取跳过当前归属检查。现有实时授权入口见 [mailbox-service.ts:1302](D:/cxt/d84-struct/src/core/work-graph/communication/mailbox-service.ts:1302)，规格见 [S7 L20:181](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:181)。 |
| **7D1 共享基础** | `session-record-codecs.ts`、`lifecycle-record-codecs.ts`、`session-directory.ts`、`session-targets.ts`、`session-lifecycle.ts`、`session-responsibility-service.ts` 都需要认识 goal/project target。共同的目标存在性校验已在 [session-targets.ts:129](D:/cxt/d84-struct/src/core/work-graph/sessions/session-targets.ts:129)，不应复制到每个 writer。新角色事实、上限、allocation、scope claims 和 `planReanchor` 是功能增量。跨区接线清单已明确，见 [S7 §6:706](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:706)、[:708](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:708)。 |
| **7D2 角色线编排** | 新角色线操作、目标队列、自治规则；复用建线、换手、下层 Query 驱动。现有 `query-execution.ts`、`views/graph-context-reader.ts`、`views/context-extensions.ts`、注记 caller／scope／memory、决定和通知投影、工作线读取均要接新事实。角色探索 Query 的可信来源绑定 role-line operation 与系统消息，不能伪装成 consultation。依据 [S7 §6:703](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:703)、[:707](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:707)。 |

有两个现成边界值得保留：

1. **职责转移已经有独立服务和状态层。**当前 [session-responsibility-service.ts:355](D:/cxt/d84-struct/src/core/work-graph/sessions/session-responsibility-service.ts:355) 读取／核 pin 后取责任依据，再调用状态转换及构造提交。7D1 扩非任务目标和 claims 时沿此扩展；不要把这些规则放进邮箱或秘书驱动。
2. **落实证明已经使用公共解码登记表。**[communication/decision-application.ts:57](D:/cxt/d84-struct/src/core/work-graph/communication/decision-application.ts:57) 是现有共享入口；6C、7A、8C 增加证明种类应加登记，不各建一套回执验证器。这不是一个尚待重构的重复点。

提示词部分还有明确的规格边界：[S6 顶部:3](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:3) 要求决定 83 的模板、模型版本选择及实际发送记录由 lead 补稿冻结后再开 6A。因此本次不根据旧正文建议把秘书／等待／转交提示词写进 `query-execution` 或某个 view。

**notes／architecture 在 4C 和提速之后还剩什么**

注记不需要再来一次整体拆分。以下部分已经有可复用的结构：

- 指针／头批读：[notes/note-batch-reader.ts:1](D:/cxt/d84-struct/src/core/work-graph/notes/note-batch-reader.ts:1)。
- 阶段连续性的一份纯判断：[notes/note-continuity.ts:18](D:/cxt/d84-struct/src/core/work-graph/notes/note-continuity.ts:18)。
- 当前理解触发折叠和共同读取：[notes/note-update-due.ts:57](D:/cxt/d84-struct/src/core/work-graph/notes/note-update-due.ts:57)、[:140](D:/cxt/d84-struct/src/core/work-graph/notes/note-update-due.ts:140)。
- 相关范围的事实读取与纯集合构造已经分开：[notes/note-related-scope.ts:104](D:/cxt/d84-struct/src/core/work-graph/notes/note-related-scope.ts:104)、[:429](D:/cxt/d84-struct/src/core/work-graph/notes/note-related-scope.ts:429)。
- 卡源及书记待办复用写侧的 user-reason facts，没有再推导一套处置规则：[notes/note-decision-source.ts:139](D:/cxt/d84-struct/src/core/work-graph/notes/note-decision-source.ts:139)、[note-scribe-todos.ts:49](D:/cxt/d84-struct/src/core/work-graph/notes/note-scribe-todos.ts:49)。

剩余分片要扩的是以下位置：

| 扩展 | 当前落点及处理判断 |
|---|---|
| **6A 无目标记忆材料** | 薄 adapter 在 [note-memory-material.ts:21](D:/cxt/d84-struct/src/core/work-graph/notes/note-memory-material.ts:21) 拒绝 null goal，实际装配在 [note-read-model.ts:1907](D:/cxt/d84-struct/src/core/work-graph/notes/note-read-model.ts:1907) 也有相同分支。6A 要同时接通；保留一份实际装配，复用其 pointer/head batch、检查缓存和项目规范读取。不能只去掉外层拒绝，也不需要复制整个 2,780 行读模型。 |
| **6B／7D2 Query 写注记与范围** | 当前 [note-service.ts:135](D:/cxt/d84-struct/src/core/work-graph/notes/note-service.ts:135) 将 Query 调用统一视为不可写。新可信 Query 调用类、来源证明和 role scope 是冻结规格中的功能扩展；在 caller resolver、`scribe-scope.ts` 及相关契约接入。旧拒绝不是现阶段行为 bug。先做 #1，避免继续通过读写环复用基础函数。 |
| **不挂目标的通知和待审卡** | 基础责任已由后注前移到 **6B**，不是全部等 7D2。当前 note 通知投影跳过无目标头，见 [note-review-notices.ts:122](D:/cxt/d84-struct/src/core/work-graph/views/note-review-notices.ts:122)；collection adapter 也在 [:269](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:269) 要求 goal。另需扩 `note-decision-source.ts`、`decision-source-facts.ts`、`decision-service.ts`、消息 codec 和通知契约。6B 实现主体底座；7D1 加项目来源跨工作区答复身份；7D2 加范围与时间汇总。不要用空 goalId 代替项目主体。 |
| **7D2 汇总通知** | `notice-grouping.ts` 已保留原始成员和已看见前缀，适合作为扩展位置。新增主体／时间窗口分组不能丢原始成员，更不能把汇总结果作为新的通知事实存回去。 |
| **8B 模块维护者／区域** | `node-detail-reader.ts` 当前在 [同文件:814](D:/cxt/d84-struct/src/core/work-graph/views/node-detail-reader.ts:814) 返回 `maintainer: none`；负责关系写入沿现有建、挂、转移、接续 owner 增加唯一 claim，区域读取沿 containment。已有 `readCatalogModuleFacts` 和统一目标校验可继续使用，没必要从观测文件图反推正式责任。 |
| **8C 修补和结构提议** | 主要缺口是 #5 的目录提交贡献。修补 payload 进入现有注记 writer／codec；两种新卡源进入 #3 的来源模块；人工修订、修补和冻结批次最终复用同一个目录规划器。8C 的批准、PASS、足迹和负责去向要求属于功能规则，不能伪装成结构清理。 |

`architecture-service.ts` 虽有 1,749 行，但当前文件图查询、比较、图索引已经有独立模块，自动抓取状态也有自己的入口。剩余 8B／8C 的重点是正式目录和负责关系，并不要求重写这一整套观测服务；7D2 读取其现有事实端口，也不构成“会继续往同一实现处加代码”。因此没有仅因文件大而列一项合拢后拆分。

**C1 第 7 项 look-alikes 的裁定**

除发现 #7 的两份小判断外，没有足够收益支持把这些差异收进一个带很多开关的通用 helper：

| 类别 | 本区证据与结论 |
|---|---|
| safe-integer 检查 | 有的接受零，有的要求正数；有的拒绝越界，有的回退默认值，有的按配置截断。例如 [decision-read-model.ts:289](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:289) 与 [note-version-lists.ts:41](D:/cxt/d84-struct/src/core/work-graph/notes/note-version-lists.ts:41)。把它们改成统一 `min/max/default` helper，仍要显式保留错误和分支，收益很小；不建议本轮合并。 |
| throwing ref key 与 boolean equality | [work-line-reader.ts:607](D:/cxt/d84-struct/src/core/work-graph/views/work-line-reader.ts:607) 直接抛出 canonicalization 错误；[query-execution.ts:91](D:/cxt/d84-struct/src/core/work-graph/queries/query-execution.ts:91) 捕获后返回 false。两者的失败语义不同，应保留具名入口，不能都替换为返回 null 的 helper。 |
| 入口身份检查与持久化 codec | [session-directory.ts:111](D:/cxt/d84-struct/src/core/work-graph/sessions/session-directory.ts:111) 检查必要身份字段；[message-record-codecs.ts:256](D:/cxt/d84-struct/src/core/work-graph/sessions/message-record-codecs.ts:256) 拒绝未知字段；[query-record-codecs.ts:169](D:/cxt/d84-struct/src/core/work-graph/queries/query-record-codecs.ts:169) 还会构造规范化结果。直接共享严格 validator 会改变输入接受范围，不能按“看起来一样”替换。 |
| 各种游标 parser | track 的多来源位置、timeline 的计划 pin、memory 的请求／调用者／分段绑定、file graph 的 capture/query 绑定各不相同。底层编码可以共享；协议验证应留在各 owner。C1 已共享的编码不再重复列项。 |
| K3 的 `sameTask`／`sameReviewRef`／`sameRunRef` | 对照位置主要在本区之外的 `state/command-rerun-request.ts:249`、`:253`、`state/review-lease.ts:67`。这些是已知类型的领域键比较，不等于本区对未知输入作 canonical JSON 比较；未发现本区需要复制它们的新结构问题，不跨区另开发现。 |

**数量、估算和覆盖范围**

| 归类 | 数量 | 新增＋删除总估算 |
|---|---:|---:|
| **1 片前做** | **5** | **4,400–6,140 行** |
| **2 合拢后做** | **0** | **0 行** |
| **3 只记下** | **2** | **424–700 行** |

1 类中，6A 前是 #1、#2；6B／7A 前是 #3、#4；8C 前是 #5。#3、#4 的行数主要来自搬移，不能当成净增代码量。

**行为 bug：未发现本区内有足够证据另列的新行为 bug。**已交接的 `atLeastCursor` 问题、T 的旧数据容忍项，以及尚未到片实现的无目标／秘书能力，均未重复计入。

以下 `read` 表示通读文件；`skimmed` 表示查读导入、接口、函数结构和与本次问题有关的实现段，不表示逐行验收全部实现。

```text
src/core/work-graph/views/activity-read-helpers.ts — skimmed
src/core/work-graph/views/activity-read-model.ts — skimmed
src/core/work-graph/views/automatic-rework-notices.ts — skimmed
src/core/work-graph/views/context-extensions.ts — skimmed
src/core/work-graph/views/decision-read-model.ts — skimmed
src/core/work-graph/views/goal-conflicts.ts — skimmed
src/core/work-graph/views/graph-context-reader.ts — skimmed
src/core/work-graph/views/node-detail-reader.ts — skimmed
src/core/work-graph/views/note-review-notices.ts — read
src/core/work-graph/views/note-views.ts — skimmed
src/core/work-graph/views/notice-display-token.ts — read
src/core/work-graph/views/notice-grouping.ts — read
src/core/work-graph/views/notice-position.ts — read
src/core/work-graph/views/README.md — read
src/core/work-graph/views/task-state-timeline.ts — skimmed
src/core/work-graph/views/track-read-model.ts — skimmed
src/core/work-graph/views/undelivered-reply-notices.ts — skimmed
src/core/work-graph/views/work-line-reader.ts — skimmed
src/core/work-graph/queries/contracts.ts — skimmed
src/core/work-graph/queries/query-execution.ts — skimmed
src/core/work-graph/queries/query-job-service.ts — skimmed
src/core/work-graph/queries/query-record-codecs.ts — skimmed
src/core/work-graph/notes/note-anchor-facts.ts — read
src/core/work-graph/notes/note-anchors.ts — skimmed
src/core/work-graph/notes/note-batch-reader.ts — read
src/core/work-graph/notes/note-continuity.ts — read
src/core/work-graph/notes/note-decision-source.ts — read
src/core/work-graph/notes/note-memory-material.ts — read
src/core/work-graph/notes/note-path-ownership.ts — read
src/core/work-graph/notes/note-read-model.ts — skimmed
src/core/work-graph/notes/note-related-scope.ts — skimmed
src/core/work-graph/notes/note-scribe-todos.ts — skimmed
src/core/work-graph/notes/note-service.ts — skimmed
src/core/work-graph/notes/note-update-due.ts — skimmed
src/core/work-graph/notes/note-version-lists.ts — read
src/core/work-graph/notes/scribe-scope.ts — skimmed
src/core/work-graph/notes/store-failures.ts — read
src/core/work-graph/architecture/architecture-delta.ts — skimmed
src/core/work-graph/architecture/architecture-record-codecs.ts — skimmed
src/core/work-graph/architecture/architecture-service.ts — skimmed
src/core/work-graph/architecture/catalog-contracts.ts — read
src/core/work-graph/architecture/catalog-record-codecs.ts — skimmed
src/core/work-graph/architecture/catalog-service.ts — skimmed
src/core/work-graph/architecture/contracts.ts — read
src/core/work-graph/architecture/file-graph-index.ts — skimmed
src/core/work-graph/architecture/formal-comparison.ts — skimmed
src/core/work-graph/architecture/graph-index.ts — skimmed
src/core/work-graph/sessions/lifecycle-contracts.ts — read
src/core/work-graph/sessions/lifecycle-record-codecs.ts — skimmed
src/core/work-graph/sessions/message-body-envelope.ts — skimmed
src/core/work-graph/sessions/message-record-codecs.ts — skimmed
src/core/work-graph/sessions/session-directory.ts — skimmed
src/core/work-graph/sessions/session-health.ts — skimmed
src/core/work-graph/sessions/session-lifecycle.ts — skimmed
src/core/work-graph/sessions/session-links.ts — read
src/core/work-graph/sessions/session-record-codecs.ts — skimmed
src/core/work-graph/sessions/session-responsibility-service.ts — skimmed
src/core/work-graph/sessions/session-targets.ts — skimmed
src/core/work-graph/sessions/trusted-context.ts — read
src/core/work-graph/communication/decision-application.ts — read
src/core/work-graph/communication/decision-service.ts — skimmed
src/core/work-graph/communication/decision-source-facts.ts — skimmed
src/core/work-graph/communication/mailbox-service.ts — skimmed
```