# 生命周期承接与重复开销复核

> 历史评审说明：本文保留对旧方案的评审结论，架构、DAG 和模块引用固定到 [2026-09-23 迁移前快照](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/README.md)；当前方案见 [架构入口](/home/hyh001/projects/coding-platform/docs/refactor/ARCHITECTURE.md)。

日期：2026-09-22。下文源码行号和开销结论属于该次审阅快照；已迁移文件的链接指向现位置，当前状态见[逐批验收](implementation-batches.md)。范围：对四条人类批注的补充审阅；基于当前文档与源码，未修改产品代码，未执行延迟或金额基准测试。

本文补充 [Prompt 4 审阅](module-dag-review.md)，不替代其中的接口映射、S09 和机械检查清单问题。下述开销属于当前源码现状，不能当作 Prompt 4 已经实施这些目标代码的证据。

## 1. 四条批注的结论

### 1.1 不应先要求人选择性能或成本

此处已发现多项可同时减少 CPU、磁盘写入、等待与实现复杂度的改进。应先消除它们，再处理有具体证据的剩余冲突。没有必要把“性能优先还是成本优先”作为这轮架构的前置产品决定。

这不承诺所有指标在所有规模下必然同步改善；意思是当前问题尚未到必须牺牲一方的程度。增加索引可能增加少量存储和维护代码，但可删除各调用方的重复扫描逻辑，应比较整体职责与长期工作量。

### 1.2 生命周期方向已定，缺的是契约和生产接线

| 层次 | 证据与判断 |
| --- | --- |
| 人的要求 | [人类原话:88](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-user-replies-numbered.md:88)已提出两图发现相关工作即可复用；[讨论结论:126](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/agent-platform-open-decisions-recommendations.md:126)已有实现、修测试、按审查意见调整的连续实例。 |
| 产品 | [PRODUCT:126](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:126)规定同 Session 顺序执行、独立调查／审查使用子 Session；[PRODUCT:459](/home/hyh001/projects/coding-platform/docs/history/before-2026-09-22/PRODUCT.md:459)规定连续工作默认延续，不因 Run 结束重建。 |
| 架构 | [ARCHITECTURE:446](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:446)允许同角色多条独立 Session、相关工作顺序复用；[第 510 行](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:510)规定相关性和上下文状态的判据。 |
| 模块 | [AgentLifecycle:25](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:25)、第 29、36 行承接默认延续、优先恢复合适旧 Session、独立 Session 并行。总体没有改成“一项工作一个新 Session”。 |
| 契约缺口 | [AgentLifecycle:76](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/agent-lifecycle.md:76)及第 99–100 行尚未明确任务↔模块↔Session 关系、候选来源及其版本如何进入决策。应补充这条依据链，避免实现退化成只按角色、忙闲挑选。第 72、79、88 行已承认契约待冻结。 |
| 源码现状 | [runtime:124](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts:124)为新 Run 生成新 Session ID；[continuation:17](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/unconfigured-capabilities.ts:17)默认未配置；[Dispatch 模块稿:65](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/modules/control/dispatch-engine.md:65)明确直接续用／增量编译分支尚未实现。 |

结论是“产品已定→架构已承接→关键契约和实现待完成”。[Prompt 4:406](/home/hyh001/projects/coding-platform/docs/refactor-prompts.revised.md:406)交付模块分工与 DAG，本身不交付完整生命周期实现。不能把尚未实施说成重新需要人选择，也不能把设计已写下说成代码已完成。

应保留独立审查的隔离，[reviewer-dispatch:119](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/reviewer-dispatch.ts:119)已有不同 Session 守卫。普通消息不应每次重走生命周期决策；[ARCHITECTURE:753](/home/hyh001/projects/coding-platform/docs/refactor/archive/2026-09-23-before-core-design/ARCHITECTURE.md:753)已禁止每轮通用重组器。

### 1.3 本轮验收以结构、代码和 UI 为主

- **可读性**：同一决策是否只有一个 owner；正常路径是否能顺着读完；是否减少跨模块跳转、重复判断和无作用包装。
- **代码量与职责**：给出迁移前后代码量、重复实现删除量、旧入口及其消费者去向。跨文件搬迁、压缩格式或把逻辑藏进通用框架不算减少职责。
- **UI**：主对话、工作状态、相关工作与人的操作是否按已有产品要求收拢；运行记录是否按需展开；复用、等待、继续等结果是否能解释清楚。界面实际效果还需在实施后检查，本轮没有宣称已完成视觉验收。
- **对应性能项**：直接核对一次动作的账本扫描次数、日志写入量、返回正文量等。静态代码可确认重复工作被去掉；若要宣称具体加速倍数，再做相应测量即可。

上一轮提出的完整任务／消融对照不应扩大成本轮重构的前置门槛。必要的边界、类型与功能检查仍按实际改动执行。

## 2. 当前仍存在的重复开销

优先级表示建议处理顺序，不是线上耗时排名。E 为账本历史事件数，N 为公开运行事件数，P 为查询页数；复杂度依据调用结构推导。

### F01 · 优先 · 协调派发一轮多次从头扫描账本

**触发与证据：** [Dispatch.drive:85](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/dispatch-engine.ts:85)先执行 coordination.drive；[coordination-drive:181](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/coordination-drive.ts:181)、[第 257 行](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/coordination-drive.ts:257)、第 267 行的正常成功路径分别执行一次 scan 和两次 scanIntents。两个扫描函数都以 cursor=null 开始（第 380、422 行），然后加载历史引用的当前快照。即使没有可推进任务，也会发生发现扫描。

Host [dispatch-wake:29](/home/hyh001/projects/coding-platform/coding-platform/src/app/scheduling/dispatch-wake.ts:29)一次唤醒最多推进四轮，活动路径可累计 12 趟上述扫描；还有条件触发的额外扫描。maxIntents 限制推进数量，没有限制发现阶段的历史工作量。

**功能必需：** 推进后看见新 intent、当前待办、正确顺序、租约与提交版本检查。**重复可消除：** 反复定位所有旧引用。用 Ledger 的完整范围索引、已处理游标和变化引用读取代替；推进后仍刷新，但只补读新增／变化。不能把落后的展示投影当成派发授权。

### F02 · 优先 · 每个公开事件重写累计运行日志

**触发与证据：** [runtime:307](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts:307)每个公开 AgentEvent 追加到 trace 后等待 save；[journal:52](/home/hyh001/projects/coding-platform/coding-platform/src/data/artifact-vault/runtime-observation-journal.ts:52)把整条记录序列化、解析，再写整份文件；[atomic-file:10](/home/hyh001/projects/coding-platform/coding-platform/src/storage/atomic-file.ts:10)每次执行全文写和 fsync。

因此第 1 次写第 1 份历史，第 2 次写前 2 份，直到第 N 次写前 N 份；事件大小相近时累计写入和序列化约 O(N²)，初始 context 也重复保存。这是每个公开事件，不是每个流式 token。

Kernel 已通过 [SessionEventSink:64](/home/hyh001/projects/coding-platform/coding-platform/vendor/coding-agent/src/storage/session_event_sink/session-event-sink.ts:64)追加记录事件；[EventDeliveryCoordinator:100](/home/hyh001/projects/coding-platform/coding-platform/vendor/coding-agent/src/core/runtime/event_delivery/event-delivery-coordinator.ts:100)也等待 best-effort 观察者。因此平台的第二次持久化会延长事件链等待。两层记录有公开脱敏与观察用途差异，不能直接把它们当作可互换正文删除。

**功能必需：** 已持久后公开、有序记录、取消和不确定终态、预算、可追溯。**重复可消除：** 用追加日志和小型元数据更新替换累计全文写；后续经 Kernel 公共记录接口引用正文。先迁移审阅、报告等消费者，避免删掉它们仍需的 trace。

### F03 · 优先 · UI 概览仍按历史规模做全量工作

**触发与证据：** [UI hooks:31](/home/hyh001/projects/coding-platform/coding-platform/src/ui/src/api/hooks.ts:31)前台每 2.5 秒请求 overview。

1. [service:414](/home/hyh001/projects/coding-platform/coding-platform/src/app/service.ts:414)每次新建 CommunicationViewIndex；[communication-view:22](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/communication-view.ts:22)从账本头部扫描完整历史，范围过滤在读取事件后进行。时间线只展示 80 条并没有使扫描变成 80 条。
2. [service:436](/home/hyh001/projects/coding-platform/coding-platform/src/app/service.ts:436)调用 runtime.all() 后才筛选目标。[runtime:103](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/coding-agent-runtime.ts:103)通过 journal.read 深克隆所有运行记录，包括 context、trace、usage。匹配运行又以整个对象返回。每轮内存复制随全部历史正文增长，响应量随匹配运行正文增长；不是每次从磁盘重读。
3. [service:391](/home/hyh001/projects/coding-platform/coding-platform/src/app/service.ts:391)和第 920、966 行表明状态读取与命令使用同一串行队列，长状态查询还会让人的操作排队。

**功能必需：** 展示当前状态、精确作用域、持久观察与正式状态区分、可展开记录。**重复可消除：** 通信视图按游标增量推进；概览按 scope 读取摘要；trace 按需、按游标取页；在明确快照边界后缩短纯读取占用命令队列的时间。单纯把轮询间隔拉长不能修复上述增长方式。

### F04 · 优先 · 任务身份与输入绑定定位依赖历史全扫

**任务身份：** [work-identity-resolution:169](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/work-identity-resolution.ts:169)每次从头查身份。普通首次派发由 [work-identity:164](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/work-identity.ts:164)解析后，Control 的 [work-record:100](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/work-record.ts:100)再次解析。[planning-work-materials:15](/home/hyh001/projects/coding-platform/coding-platform/src/control/plan-compiler/planning-work-materials.ts:15)对 T 个不同 originTaskId 分别调用，约 O(T×E)。

**运行输入绑定：** Dispatch 的 [model-call-access:32](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/execution/model-call-access.ts:32)经 [coordination-admission-read:72](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/coordination-admission-read.ts:72)扫描接续受理事件；Control 在 [run-facts:253](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/run-facts.ts:253)又经第 639 行的读取扫描同类关联。发生在 Run 输入绑定阶段，不能说成每次模型调用都全扫。

**功能必需：** 唯一身份、完整关联、Control 独立复核与并发约束。**重复可消除：** 为身份及 runRef→admissionRef 提供精确、随提交更新的 Ledger 查询。已有 [identity_claims:342](/home/hyh001/projects/coding-platform/coding-platform/src/data/state-ledger/sqlite-ledger.ts:342)服务提交约束，但旧数据仍须按现有身份赢家规则重建；不能假定旧索引直接等于完整历史查询结果。

### F05 · 优先 · 项目源码分页重复捕获和计算整个结果

**触发与证据：** [ProjectSourceIndex 的现位置](/home/hyh001/projects/coding-platform/coding-platform/src/core/workspace/project-source-index.ts)（原审阅版本第45行）的 architectureMaterials 每 200 条调用一次 query。每次 query 在第 135 行捕获可读源码，在第 165–189 行遍历／计算结果和诊断，在第 190 行再次捕获，第 195 行最后才切分页。

捕获过程重新读文件与计算摘要（第 61–78 行）。P 页对应 2P 次捕获及 P 次完整 imports 结果遍历。例如恰好 1,000 条结果、每页 200 条，对应 5 次 query、10 次捕获；这是调用次数示例，不是耗时测量。语言服务的增量缓存没有消除外部的这些读取。

**功能必需：** 权限过滤、来源版本、页间一致性、文件变化时不得冒充当前材料。**重复可消除：** 冻结快照与分页有效性契约，在固定捕获上计算一次、多页读取，并在采用材料的适当边界复核当前性。当前文件可变，两次捕获的前后验证有用途；不能只删第二次捕获，也不能未经契约允许就把旧快照说成当前源码。

### F06 · 中 · 自动返工反复读取预算、决定与提案

[rework-drive:217](/home/hyh001/projects/coding-platform/coding-platform/src/control/dispatch-engine/rework-drive.ts:217)进入真实受理；[autonomous-rework:264](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/autonomous-rework.ts:264)全扫预算与人工决定，已接受请求重放也在第 191 行为预算再次扫描。第 319、622 行按每个问题遍历决定并重复加载相关提案，约 O(E＋I×D)。

按 Goal 建立可重建且随正式提交更新的预算／决定查询，同次受理共用提案读取结果。保留人工 reject/defer、已成功应用次数口径、版本与政策检查。

### F07 · 中 · 为取得末游标而遍历整个账本

[humanActionCaptureCursor:29](/home/hyh001/projects/coding-platform/coding-platform/src/data/read-model-index/query-human-actions.ts:29)从头翻页，只为取得账本末端；后续 queryHumanActions 第 60 行又从头读事件。这条链由 [service:161](/home/hyh001/projects/coding-platform/coding-platform/src/app/service.ts:161)的人工待决事实读取触发，不能泛化成每轮概览必然调用。

保留外部投影读取前后的游标与版本一致性见证，提供可靠末游标／固定读取快照与范围查询，避免用全遍历模拟“读取当前版本号”。

### F08 · 中 · Goal 归约重复读取同一批证据

[goal-reducer:180](/home/hyh001/projects/coding-platform/coding-platform/src/control/control-engine/goal-reducer.ts:180)先按 Task 读取 Evidence；第 253 行再按 obligation 读取同样的索引和 Evidence 以寻找历史 FAIL。同一 Task 属于多个 obligation 时会进一步重复。

在同一次一致性读取中，首遍记录每 Task 的历史 FAIL 标志，后续组合即可。保留证据适用版本、Reviewer 有效性和提交守卫，无需先引入跨请求缓存。

### F09 · 中 · 独立只读查询共用一个日志写入队列

[read-only-query-runtime:63](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/read-only-query-runtime.ts:63)配置 writeOrder:global；[journal:57](/home/hyh001/projects/coding-platform/coding-platform/src/data/artifact-vault/runtime-observation-journal.ts:57)把不同 QueryRun 的保存串起来。一个查询的大日志或慢持久化会阻塞另一查询。

可用逐记录写队列，保留同一记录的顺序与原子公开；这不需要新增消息中间件。与 F02 的全文写问题应一并处理。

### F10 · 较低 · 缓存命中发生在全部取料和检查之后

[memory-context:18](/home/hyh001/projects/coding-platform/coding-platform/src/data/context-compiler/memory-context.ts:18)读取记忆，随后排序、筛选、逐条校验，第 41–43 行才计算摘要并判断缓存命中。命中没有省去前面的工作，还会深克隆返回；来源检查也可能重复加载同一 Workspace、Goal 和治理版本。

先考虑同一有效读取范围内复用公共事实，或移除没有实际收益的结果缓存以简化代码。若做跨请求复用，必须覆盖来源、版本、过期时间与治理变化；不能简单把缓存读取前移并跳过有效性检查。

### F11 · 较低 · 同一最终请求多次序列化和计算摘要

[model-budget:29](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/model-budget.ts:29)为字节数序列化，第 34 行为摘要再次序列化；启用 modelCalls 时，[observed-model-run:43](/home/hyh001/projects/coding-platform/coding-platform/src/execution/worker-runtime/observed-model-run.ts:43)再次测量同一最终请求，并重算运行输入摘要。

在最终 outgoing 请求确定后，一次产生字节数和摘要供预算与已有准入使用；不变输入摘要在绑定时复用。必须计量最终请求及完整工具 schema 等内容；不能复用改写前的摘要，也不应借此增加新准入系统。收益小于前面的全历史扫描与累计写入，应后处理。

## 3. 需要纠正或保留的边界

1. **日常 UI 轮询已不触发工作区 currentness 扫描。** [service:429](/home/hyh001/projects/coding-platform/coding-platform/src/app/service.ts:429)对 overview 跳过它；[hooks:39](/home/hyh001/projects/coding-platform/coding-platform/src/ui/src/api/hooks.ts:39)的单回答适用性检查由用户触发。仍存在的是 F03 的账本扫描和正文复制，不能沿用“每 2.5 秒扫描工作区”的旧说法。
2. **完整状态／显式适用性检查仍可能读取全源码。** [currentness:142](/home/hyh001/projects/coding-platform/coding-platform/src/data/context-compiler/query-execution-context.ts:142)有相关已完成记录时，第 146 行才读取 sourceRevision；[query-workspace-source-reader:17](/home/hyh001/projects/coding-platform/coding-platform/src/core/workspace/query-workspace-source-reader.ts:17)捕获基线。可优先排除正式版本已失效的记录，再按需读源码。已有第 147–150 行的同 scope 请求内缓存，不应重复报告为完全未复用。
3. **异步操作前后读版本不一定冗余。** currentness 第 177、192 行分别防止已过期材料继续昂贵重算、以及异步期间版本改变；不能删除后一次只为少一次读取。同理，可变工作区前后快照不应直接合并成没有失效见证的缓存。
4. **分页上限不是完整范围查询的替代品。** 多个扫描读面只有 200×1000 的上限，全账本达到容量边界后，即使本目标事实很少也可能 unavailable。正确优化应保留完整性，不能截断后声称没有关联。
5. **仓库已有增量推进的例子。** [LedgerScopeCatalog:19](/home/hyh001/projects/coding-platform/coding-platform/src/data/state-ledger/ledger-scope-catalog.ts:19)保留 cursor，只追赶新增事件。不能把所有 events 查询都统称为全量扫描，也无须为修复上述问题发明新的通用框架。

## 4. 建议落实顺序与是否需要人决定

先处理 F01–F05：它们直接影响连续运行、随时查看状态和两图取源。将精确读取能力放回 Ledger／ReadModel／Vault／WorkspaceReader 各自职责内，同时删除调用方旧扫描与全文读取路径；不要在旧路径外再包一层后两套长期并存。

F06–F11 可随相关模块收缩一并处理。两图相关性如何进入生命周期决策的职责、提供／消费接口及必要内容，应先补入 Prompt 3 模块文档；直接续用分支、增量输入和真实接线再由后续计划安排实施。UI 概览摘要、按需详情与这些后端读取接口同时修改。不能把尚未完成的模块接口设计一概推给 Prompt 6。

以上主要是已定产品要求下的工程责任，不需要重新交给人选择。只有提出新的用户可感知变更，例如降低状态新鲜度、删减可追溯历史、改变独立审查要求，才属于新的产品取舍；本文的改进方向不以这些变化为前提。
