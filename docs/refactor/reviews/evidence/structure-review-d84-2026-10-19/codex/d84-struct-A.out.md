建议保留 **9 项结构发现：6 项片前做，1 项合拢后做，2 项只记下**。优先处理计划服务的职责混合、Run 编解码的归属、负责关系读取的扩展位置，以及检查轮与重新检查的边界。**不建议建立覆盖所有写 owner 的统一流水线。**

本次只读，未写文件，未运行测试或构建。以你说明的 `35b5f5b1` 后副本为审查基线；本区域共 81 个文件，按当前文本计约 38,691 行，其中 `tasks/` 为 65 个文件、31,877 行。读了指定决定、剩余分片规格及顶部后注、C1 裁定。副本中没有找到 `books/c1-book.md` 正文；look-alike 的判断依据是 [C1 裁定第 7 条](D:/cxt/d84-struct/.lead-ref/c1-lead-rulings.md:28)和当前代码。

下文 **S6、S7、S8** 分别指 [slice-6-SPEC.md](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:1)、[slice-7-SPEC.md](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:1)、[slice-8-SPEC.md](D:/cxt/d84-struct/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:1)。行数估计是结构改动的**新增＋删除量级**，包含迁移和必要接线，不包含后续功能实现；不以 Git 的 rename 显示方式抵扣迁移行数。

| # | 问题（file:line，一两句） | 现在的代价（读、改、复用各难在哪；具体例子） | 剩下哪一片会碰到（spec 和章节） | 改法（一两句；只说结构） | 会不会动行为 | 估计改多少行（新增＋删除） | 归类 | 把握 |
|---|---|---|---|---|---|---|---|
| 1 | [tasks/plan-service.ts:1077](D:/cxt/d84-struct/src/core/work-graph/tasks/plan-service.ts:1077)、[1532](D:/cxt/d84-struct/src/core/work-graph/tasks/plan-service.ts:1532)、[1849](D:/cxt/d84-struct/src/core/work-graph/tasks/plan-service.ts:1849)、[2313](D:/cxt/d84-struct/src/core/work-graph/tasks/plan-service.ts:2313)：3,506 行同时承载初始回答取证、计划提议与采用、任务图及 Goal 展示读取、请求候选 owner。它们有不同的变更原因。 | **读：**找初始化绑定要跨回答读取、规范化、初始提议和采用复核。**改：**6B、8B、6C 都会改同一大文件的不同业务段。**复用：**planning-question reader 为读取回答事实依赖整个 Plan 服务装配；只读投影也依附拥有写事务依赖的工厂。 | **6B 前**。S6 顶部后注明确把无 Goal 初始化提议、采用、读取提前到 6B；§0.3 L8/L11、§2 `InitializationBindingV1`。之后还有 **8B**：S8 §0.3 L10、§6；**6C**：S6 L13、§3 S6-P-01/02。 | 保留现有公开门面，抽出“初始回答事实及消费”“计划查询及投影”“请求候选”三个内部模块。提议、采用继续使用现有 `plan-commit-compiler.ts`，不复制提交编译器。 | **不会**；保留 Host/Agent 两条入口的次序、原回执优先级及逐步状态机判断。 | 约 **+1,100 / −1,000＝2,100** | **1 片前做：6B 前** | 高 |
| 2 | [materials/record-readers.ts:150](D:/cxt/d84-struct/src/core/work-graph/materials/record-readers.ts:150)、[186](D:/cxt/d84-struct/src/core/work-graph/materials/record-readers.ts:186)、[280](D:/cxt/d84-struct/src/core/work-graph/materials/record-readers.ts:280)，以及 [materials/run-snapshot-decoder.ts:18](D:/cxt/d84-struct/src/core/work-graph/materials/run-snapshot-decoder.ts:18)：正式 Run、QueryRun 的持久化校验由 materials 注册，通用 Run decoder 再从 materials 的注册表里寻找 validator。 | **读：**追踪 Run 的 continuation、授权、控制、终态校验，要进入材料权限目录。**改：**执行协议变更会改到 material authority 的实现文件。**复用：**本区域有 8 个 task 文件使用这个 Run decoder，正式执行事实依赖材料读取实现。 | **7B 前**。S7 §0.3 L7、§2 的 `RunContinuationV1` / `ConsumedWaitV1`；当前 `record-readers.ts:153` 只接受 `wait_reply`，新增 `expiry`、`intervention` 必须经过这里。 | 把 Run/QueryRun 的正式 validator、decoder 和 schema 定义移到 `persistence/` 的相应协议模块；materials 只保留 `MaterialAuthorityReads` 的读取和权限事实适配。现有导出可暂作转发。 | **不会**；原 validator 整体迁移，不借机加强字段校验、改变缺字段处理或错误文本。 | 约 **+360 / −330＝690** | **1 片前做：7B 前** | 高 |
| 3 | [tasks/plan-readers.ts:2210](D:/cxt/d84-struct/src/core/work-graph/tasks/plan-readers.ts:2210)：`createSessionResponsibilityBasisReader` 埋在 2,323 行 Plan 读取集合末尾，把负责关系的依据读取绑定在 Task 分支上。 | **读：**负责关系入口与 Plan schema 注册、候选、证据、任务状态读取混在一起。**改：**新增 goal/project/module 目标时容易继续扩大这个综合文件。**复用：**生命周期 owner 已有窄端口，但实现没有独立边界；目前非 task 在 `:2231` 统一返回 incomplete。 | **7D1 前**。S7 §0.3 L23–L25、§6 明列 `plan-readers.ts` 的目标类型扩展；8C 的责任迁移随后复用这套基础。 | 抽出独立的 responsibility-basis reader 模块，继续注入现有 `SessionResponsibilityBasisPort`，复用 Plan 和 canonical task readers。它可以留在允许读取 task/query 事实的层，不必搬进 `sessions/`。 | **不会**；结构提交仍保持非 task 的原拒绝；支持新目标类型由 7D1 功能提交完成。 | 约 **+150 / −115＝265** | **1 片前做：7D1 前** | 高 |
| 4 | [evidence/evidence-service.ts:897](D:/cxt/d84-struct/src/core/work-graph/evidence/evidence-service.ts:897)、[1229](D:/cxt/d84-struct/src/core/work-graph/evidence/evidence-service.ts:1229)、[1618](D:/cxt/d84-struct/src/core/work-graph/evidence/evidence-service.ts:1618)、[1792](D:/cxt/d84-struct/src/core/work-graph/evidence/evidence-service.ts:1792)：2,036 行同时处理轮次开立材料、check 执行收束、检查定案和重新检查请求。 | **读：**一次 reverify 会穿过委托写授权、来源捕获、链头、返工覆盖、自动策略及新轮开立。**改：**7C 改重新检查的授权/待决定入口，8C 改开轮冻结的修补组，两者落在同一闭包。**复用：**开轮准备已在复用，但藏在服务闭包内，后续绑定材料容易继续向大依赖包加字段。 | **7C 前**处理 reverify 边界；S7 §0.3 L19、§1。**8C** 继续使用独立的开轮准备模块：S8 L3/L4、§3 S8-ROUND-01、§6。 | 分出“轮次开立准备”和“重新检查请求 owner”；原服务组合它们与 check 操作。保留唯一的提交贡献汇总位置，读取、状态机判断和 commit 次数不变。 | **不会**；特别保留来源读取与拒绝顺序。修补激活仍属于 note/catalog 的提交，不并入 `finalizeChecks`。 | 约 **+650 / −580＝1,230** | **1 片前做：7C 前** | 高 |
| 5 | [tasks/execution-entry-service.ts:137](D:/cxt/d84-struct/src/core/work-graph/tasks/execution-entry-service.ts:137)、[203](D:/cxt/d84-struct/src/core/work-graph/tasks/execution-entry-service.ts:203)、[1245](D:/cxt/d84-struct/src/core/work-graph/tasks/execution-entry-service.ts:1245)、[2080](D:/cxt/d84-struct/src/core/work-graph/tasks/execution-entry-service.ts:2080)：执行入口服务同时充当公共 owner 工具出口。本区域已有 **13 个文件**从它导入。 | **读：**Plan、Goal、K3、Evidence 的依赖表会指向一个 2,096 行执行 owner，才能取得 `mergeGuards`、隔离请求、回执读取等能力。**改：**拆分 Plan/Evidence 时容易把这个依赖继续复制到新模块。**复用：**公共机械能力与执行准入规则共用同一出口，难看出真实业务依赖。 | **6B 前**配合 #1；S6 顶部后注、L8/L11、§6 的 Plan 扩展。之后 8B/6C 的 Plan owner、7C/8C 的 Evidence owner也会继续使用这些能力。这里的影响点是**跨 owner 的依赖边界**。 | 把与执行语义无关的 owner 支持函数放到已有中立模块或小型 owner-support 模块；真正的 `readStoredManifest`、运行准入和执行效果编译仍归执行模块。原名可转发，逐个修正消费者 import。 | **不会**；尤其不能把严格的 `loadReplayEvent` 直接替换成另一种较宽松 replay helper。 | 约 **+150 / −90＝240** | **1 片前做：6B 前** | 高 |
| 6 | [tasks/run-activity-service.ts:151](D:/cxt/d84-struct/src/core/work-graph/tasks/run-activity-service.ts:151)：可用于 Work/Query 的活动替换规则，目前放在 Run 专用 owner 中，输入类型要求整个 `RunActivitySnapshot`，实际只读取 `facts`。 | **读：**纯规则与 Host 校验、补算、Run/Outbox 读取在同一文件。**改：**6A 增加 QueryActivity 时，容易复制这张替换表。**复用：**Query 记录没有 Run 的全部身份字段；为调用规则而构造假的 RunActivity 或照抄规则都增加成本。 | **6A 前**。S6 §0.3 L16，尤其终态写入、补算和替换规则；§6 查询活动改动表。当前规则 **1 份**，后续至少增加 **Query 这一类消费者**，不应变成第 2 份规则。 | 只抽出纯活动替换策略，参数缩到实际使用的已有 facts、incoming facts、终态提交标记；Run/Query 各自继续负责身份、快照字段和事务贡献。 | **不会**；保留七行决策表的先后及终态补全例外。 | 约 **+55 / −30＝85** | **1 片前做：6A 前** | 高 |
| 7 | [tasks/unknown-call-review-service.ts:158](D:/cxt/d84-struct/src/core/work-graph/tasks/unknown-call-review-service.ts:158)、[1378](D:/cxt/d84-struct/src/core/work-graph/tasks/unknown-call-review-service.ts:1378)，[tasks/command-rerun-request-service.ts:348](D:/cxt/d84-struct/src/core/work-graph/tasks/command-rerun-request-service.ts:348)、[434](D:/cxt/d84-struct/src/core/work-graph/tasks/command-rerun-request-service.ts:434)：K3 两个 owner 各自混入列表读取协议；UCR 还内嵌原始命令事实读取、展开和封顶。 | **读：**定位列表水位/分页问题，要穿过结论、提议、hold、批准写入。**改：**命令材料的构造规则和 review 状态写入在一个大依赖包中变化。**复用：**只读列表和 shell hook 的调用者需要面对拥有 commit 能力的服务装配。 | **无**。剩余规格复用 K3 结果，没有要求继续扩写这两个 owner 的核心协议。 | 在 K3 模块内分出 UCR/CRR readers，以及 blocked-command facts builder；写 owner 保留各自的状态机与 commit。保留两套现有分页语义，不用一次“通用分页”合并。 | **不会**；保留 UCR 的一致水位读取、CRR 的单物理页及 task-scoped closure 投影区别。 | 约 **+650 / −590＝1,240** | **2 合拢后做** | 高 |
| 8 | [configuration/project-bootstrap-service.ts:528](D:/cxt/d84-struct/src/core/work-graph/configuration/project-bootstrap-service.ts:528)、[699](D:/cxt/d84-struct/src/core/work-graph/configuration/project-bootstrap-service.ts:699)、[812](D:/cxt/d84-struct/src/core/work-graph/configuration/project-bootstrap-service.ts:812)：项目/工作区登记和完成标准安装/激活共用 1,145 行文件。 | **读：**生命周期登记与治理版本操作要在同一文件辨认。**改：**完成标准的证明字段改动会进入 bootstrap 文件。**复用：**不过当前已经暴露两个独立 port，并共用本地 admission/commit；边界问题尚未迫使调用者复制实现。 | **6C**：S6 §0.3 L14，为 `ProjectCompletionPolicyActivated` 增加来自卡回答的 acknowledgement。8A 的捕获接线已合入，不能再计为未来收益。 | 可分出 completion-policy configuration 服务，保留公共 admission/replay 支持。当前不为这次有限的证明字段扩展先搬动整块代码。 | **不会**；仅职责迁移。 | 约 **+520 / −480＝1,000** | **3 只记下：收益不足以作为 6C 前置** | 中 |
| 9 | [tasks/planning-question-reader.ts:137](D:/cxt/d84-struct/src/core/work-graph/tasks/planning-question-reader.ts:137)、[191](D:/cxt/d84-struct/src/core/work-graph/tasks/planning-question-reader.ts:191)、[215](D:/cxt/d84-struct/src/core/work-graph/tasks/planning-question-reader.ts:215)：正式规划问题读取同时构造完整卡片、维护 attempt cache 和 offset 分页；与区域外 [views/decision-read-model.ts:257](D:/cxt/d84-struct/src/core/work-graph/views/decision-read-model.ts:257) 的集合 source 有第二套分页外壳。 | **读：**回答取证和卡片协议交织。**改：**分页或窗口缓存规则需核对两处。**复用：**不能直接换成现有 generic source：这里返回真实 `sourceCursor`，generic 当前返回 null，limit 的解释也不同。 | **无明确的本 reader 新增任务**。6B、7D2 会增加卡源，但新增位置主要在 `views/`；这不能自动证明本 reader 必须片前迁移。 | 若后续统一卡源，保留回答事实读取，抽出卡片适配；先使公共适配器能保留当前 watermark、limit 和缓存语义，再迁移。 | **不会，限上述保留条件**；直接套用当前 generic source **会改变** `sourceCursor` 和部分分页参数行为。 | 约 **+120 / −100＝220** | **3 只记下** | 高 |

这些是迁移量级估计，单项可能有约四成偏差。#1、#4 的主要收益是缩小修改所需的上下文；它们不承诺净减行数。

对你提出的四个问题，补充如下。

**`tasks/` 确实包含不同变化原因的模块，但没有必要先把 65 个文件整体搬一遍。** 应先建立下面的职责边界，物理目录随被批准的结构项形成：

| 职责组 | 当前入口和边界判断 | 剩余分片实际会加什么 |
|---|---|---|
| Claim | [claim-service.ts:886](D:/cxt/d84-struct/src/core/work-graph/tasks/claim-service.ts:886) 是复杂但集中于一次领取协议的 owner；不能仅因 1,318 行就拆成通用流水线。claim、Attempt/Outbox codec、领取事实适合成为一组。 | **7B**：S7 L7，回复/到期/干预的 continuation 与 consumed-wait 判别式；`claim-service.ts:343`、`:367` 是明确接点。 |
| 执行入口、执行历史、模型调用凭据 | [execution-entry-service.ts:1302](D:/cxt/d84-struct/src/core/work-graph/tasks/execution-entry-service.ts:1302)、[execution-history-binding.ts:92](D:/cxt/d84-struct/src/core/work-graph/tasks/execution-history-binding.ts:92)、`model-call-service.ts` 属于同一执行生命周期，但各有独立协议。历史的纯编译器已经是良好边界，应保留。 | 7B 会影响共享的等待/接续协议；不能把 **7D2 的 running-cap** 算成这几个 owner 必然新增业务，它的规格落点是共同 Runtime 启动路径，见 S7 §6。 |
| Run 状态读取、控制、reconcile | [run-state-service.ts:418](D:/cxt/d84-struct/src/core/work-graph/tasks/run-state-service.ts:418)、[run-reconcile-service.ts:808](D:/cxt/d84-struct/src/core/work-graph/tasks/run-reconcile-service.ts:808)、`control-service.ts` 适合在执行模块内分成读取、控制、恢复几部分。reconcile 已有自己的共享前段。 | 7B 影响共享事实形状；剩余规格没有要求把恢复协议再扩成一个统一业务 owner。 |
| Plans 和 plan readers | `plan-service.ts`、`plan-readers.ts` 已成为两个汇集点，应按 #1、#3 拆出边界。`initial-plan.ts`、`plan-validation.ts`、`plan-task-basis.ts`、`plan-commit-compiler.ts` 已有独立职责，不应重新并回服务。 | **6B** 初始化绑定；**7D1** 负责关系依据；**8B** catalog pin/模块成员校验；**6C** approvedPayload 授权、受影响任务处置及采用。 |
| Goal 创建、控制、设置、完成 | [task-service.ts:155](D:/cxt/d84-struct/src/core/work-graph/tasks/task-service.ts:155)、[goal-settings-service.ts:345](D:/cxt/d84-struct/src/core/work-graph/tasks/goal-settings-service.ts:345)、[goal-control.ts:125](D:/cxt/d84-struct/src/core/work-graph/tasks/goal-control.ts:125)、`completion.ts` 可以归入 Goal 模块，但创建、设置和完成判定应继续是不同 owner/规则。 | **6B** 在 Goal 创建侧增加确认、复制、`continuedFrom`、`copiedInterventions`、screening；**7D2** 接复制目标挪责任、参谋队列。不能据此把 `goal-settings-service.ts` 的全部 914 行列为片前重构对象。 |
| Session 综合事实 | [session-facts.ts:178](D:/cxt/d84-struct/src/core/work-graph/tasks/session-facts.ts:178) 的位置有依赖原因：它综合 Run、Outbox、Query 事实，再经窄 port 注入 Session owner。按名字搬进 `sessions/` 可能反而破坏依赖方向。 | **7B**：S7 L7、§6，等待来源改为消息事实，不能再由 latest claim 遮盖旧等待。 |
| K3 核对与命令重跑 | UCR、CRR、命令识别/展开/排序适合组成一个 K3 模块，其内部保留 **两个写 owner**。`command-recognition.ts`、`command-expansion.ts`、`blocked-command-order.ts` 已经提供公共规则，不能再复制到两个 owner。 | **无明确核心扩写**，所以 #7 归合拢后。 |
| 活动记录 | [run-activity-service.ts:151](D:/cxt/d84-struct/src/core/work-graph/tasks/run-activity-service.ts:151) 的纯替换规则可跨执行类型复用；Run 与 Query 的身份、终态来源、归线字段应分别装配。 | **6A**：S6 L16，QueryActivity、`querySince`、查询补算和查询活动读取，见 #6。 |

决定 83 要增加模板、模型策略、实际提示词版本记录和历史组合规则，但它的补充规格尚待冻结。[HANDOFF:658](D:/cxt/d84-struct/docs/refactor/HANDOFF.md:658)没有把这些正式记录指定给 `configuration/role-memory-service.ts` 或某个 task owner。因此，我没有用“将来要配置提示词”作为拆分现有 configuration 服务的片前理由，也没有把尚未确定的 prompt 记录计入下面的新增数量。

**写 owner 的数量与“相同骨架”需要分开计。**

以本区域“实现 RecordStore 事务写入的生产文件”为可复核口径，当前是 **21 个 owner 实现文件、35 个实际 `.commit(...)` 调用位置**。排除了注释中的调用示例；`material-service.ts` 的材料存储写入口不属于这套 RecordStore owner 流程，未混入计数。一个文件可能有多个公开写入口，也可能多个入口共用一个 commit helper，所以 21 和 35 都不是公开写操作数。

| 分组 | owner 实现文件数 | 文件 |
|---|---:|---|
| Claim | 1 | `tasks/claim-service.ts` |
| 执行入口、历史、模型凭据 | 3 | `tasks/execution-entry-service.ts`、`tasks/execution-history-service.ts`、`tasks/model-call-service.ts` |
| 控制、reconcile | 2 | `tasks/control-service.ts`、`tasks/run-reconcile-service.ts` |
| Goal 创建、控制、设置、完成 | 4 | `tasks/task-service.ts`、`tasks/goal-control.ts`、`tasks/goal-settings-service.ts`、`tasks/completion.ts` |
| Plan / 请求候选 | 1 | `tasks/plan-service.ts` |
| 返工、检查 | 2 | `tasks/requeue-service.ts`、`evidence/evidence-service.ts` |
| K3 | 2 | `tasks/unknown-call-review-service.ts`、`tasks/command-rerun-request-service.ts` |
| Session anomaly | 1 | `tasks/session-anomaly-service.ts` |
| 活动 | 1 | `tasks/run-activity-service.ts` |
| Workspace 设置 | 2 | `configuration/decision-settings-service.ts`、`configuration/line-settings-service.ts` |
| Bootstrap、Role 配置 | 2 | `configuration/project-bootstrap-service.ts`、`configuration/role-memory-service.ts` |
| **合计** | **21** | |

这 21 个文件反复承担相似的协议责任，但**不存在 21 段可以保持原语义、整段互换的八步代码**。可共享部分的实际大小，以下几组最能说明：

| 比较对象 | 相似部分有多大 | 必须保留的差别 |
|---|---|---|
| 两个 Workspace settings owner | notice 的前段 [decision-settings-service.ts:66](D:/cxt/d84-struct/src/core/work-graph/configuration/decision-settings-service.ts:66)至原回执分支约 **46 行**；line 的对应前段 [line-settings-service.ts:89](D:/cxt/d84-struct/src/core/work-graph/configuration/line-settings-service.ts:89)约 **47 行**。commit/恢复尾段分别约 **26、25 行**。这是相似流程块的长度，不能全部算重复行。 | payload 校验、notice token、Session 读取、状态机、时钟读取位置不同；notice 在比较时再次读取 `expected[0]`，line 使用第一次拿到的 pin。C1 已明确恢复这个差别，见 [裁定:41](D:/cxt/d84-struct/.lead-ref/c1-lead-rulings.md:41)。 |
| UCR / CRR | [unknown-call-review-service.ts:448](D:/cxt/d84-struct/src/core/work-graph/tasks/unknown-call-review-service.ts:448) 的 commit helper 约 **32 行**；[command-rerun-request-service.ts:251](D:/cxt/d84-struct/src/core/work-graph/tasks/command-rerun-request-service.ts:251)约 **32 行**。其中可互换的主要是 commit、失败映射、replay/fresh 分派尾段，约 **6–12 行**；事件体、编码、proof、文本仍归各 owner。 | 共用整个 helper 要引入 records/event 编译、replay、错误文本等回调。对两个 owner 而言，减少的代码很少。 |
| Reconcile 三个写操作 | [run-reconcile-service.ts:779](D:/cxt/d84-struct/src/core/work-graph/tasks/run-reconcile-service.ts:779) 的 `identify` 和 `:808` 的 `begin` 已共用约 **51 行前段**。 | 它们同属恢复协议，适合这种局部骨架。没有理由为了统一全仓，再把这段改成更泛的框架。 |
| Claim 与 UCR | 两者都有 context、shape、identity、receipt 等步骤。 | [claim-service.ts:886](D:/cxt/d84-struct/src/core/work-graph/tasks/claim-service.ts:886) 在 replay 前校验 expected；[unknown-call-review-service.ts:532](D:/cxt/d84-struct/src/core/work-graph/tasks/unknown-call-review-service.ts:532) 命中 replay 后，不再进入后面的可选 pin 校验。统一成固定顺序会改变结果。 |
| Plan、Claim、Evidence | 共用的是“读取事实—询问纯机器—继续读取”的编排原则。 | Plan 在 [plan-service.ts:1678](D:/cxt/d84-struct/src/core/work-graph/tasks/plan-service.ts:1678)以后逐次取得 origin、governance、draft、assignment 判断；Claim 同样分阶段判断。提前一次读齐所有事实，会改变先返回哪个拒绝，以及是否发生后续读取。 |
| RunActivity | 同样有 identity、fingerprint、receipt、commit。 | [run-activity-service.ts:358](D:/cxt/d84-struct/src/core/work-graph/tasks/run-activity-service.ts:358) **先读 Run**，其 revision 参与 fingerprint，之后才查 receipt；`:439` 的 epoch 创建也先读现有记录。不能套用“所有事实读取必须在 receipt 后”的骨架。 |
| 提交异常恢复 | 多个 owner 都检查 commit 结果。 | [goal-settings-service.ts:324](D:/cxt/d84-struct/src/core/work-graph/tasks/goal-settings-service.ts:324) 遇异常会重新查回执；[command-rerun-request-service.ts:275](D:/cxt/d84-struct/src/core/work-graph/tasks/command-rerun-request-service.ts:275) 返回其原有 unavailable；两个 Workspace settings owner连非 committed 结果也重查。统一恢复策略是行为变化。 |

因此，“每份相同多少”的结论是：

- **最接近整段复制的是两个 Workspace settings owner，约七十行量级的相似外壳；其中仍夹有必须参数化或保留原位的行为。**
- K3 两个 owner 的共享潜力主要是个位数到十余行的事务尾段。
- Plan、Claim、Evidence 的主要体积是各自事实与规则的编排，抽走固定骨架不会把这些 owner 显著变小。
- `trusted-context.ts`、`receipt-replay.ts`、`owner-record-read.ts` 和已有的局部 commit helper 已经承担了一部分公共机械工作。继续复用这些小接口，比增加 `runOwner({ validate, identify, read, transition, admit, commit, recover… })` 更清楚。

一个全局骨架若要真正保留所有 owner 的 codes、texts、字段存在性、getter 读取次数、检查顺序和异常恢复策略，必须把这些差别都变成配置或回调。这样会把直接可读的控制流藏起来。**我不建议把它列为片前结构项。**

剩余片新增多少 owner，冻结规格没有给出统一的“服务文件数”；它给出了新增记录、接口和同事务约束。可以确定的是下面 **12 类新增持久化记录/事实**，不能据此宣称要复制 12 个事务 owner：

| 分片 | 新增持久化类型/事实 | 数量 | 写入归属 |
|---|---|---:|---|
| 6A、6B | `QueryActivity`、`InitializationBindingV1` | **2** | QueryActivity 正常路径加入现有 Query 终态提交，另有补算；初始化绑定随确认目标的协议保存。S6 L8/L11/L16、§2。 |
| 7A | `DispatchCounter` | **1** | S7 L2 明确与消息可派的那次提交原子写入，不能成为第二次独立提交。 |
| 7D1 | `SessionRoleFactsV1`、`ProjectRoleLimitsV1`、`RoleLineAllocationV1` | **3** | SessionRoleFacts 随登记平台 Session 提交；allocation 随保留/登记等操作贡献记录与守卫；role limits 有配置写入口。S7 L31/L34、§1、§2、§6。 |
| 7D2 | `GoalAdviserQueueV1`、`AutonomyRuleV1`、`AutonomyRuleSetV1`、`RoleCapacityEpisodeV1` | **4** | 队列、自治规则、容量事件分别有不同的写职责；Rule 与 RuleSet 必须联动。S7 L32/L33/L36/L37、§2。 |
| 8C | `ArchitectureProposalV1`、`ArchitectureProposalBatchV1` | **2** | 提议及冻结批次；批准后的正式目录修订复用修订写入方。S8 L6、§3 S8-PROP-01。 |
| **合计** | | **12** | |

另外：

- `RoleLineOperationV1` 是已有 `SessionOperation` 的新分支，**不再计一个新记录 owner**。
- `GoalScreeningV1`、`DecisionSubjectV1` 是值/判别式，不能各算一个 owner。
- QueryJob 的 request 字段、SessionMessage 的放行/送达/等待字段、RoundSnapshot 的 `stagedRepairs`、Plan 的 `catalogPin` 都是**已有记录的扩展**。
- 6C 的计划写入、7C 的返工/重新检查、8C 的 repair 激活，主要扩展既有 owner。

若为施工量估算，按“新增承写职责”可以分成 **7 组**：请求轮写入、Query 活动补算、角色上限、参谋队列、自治规则、容量 episode、架构提议/批次。其中一些可以放入现有服务，**这不是规格冻结的 7 个新 service 文件**。派工计数、初始化绑定、SessionRoleFacts、allocation 等同事务贡献不应再机械增加独立 commit 骨架。

决定 70 的 codec 生成试点，我倾向于**在 6A 前完成原定两类事件的有界试点并判收**，因为后面确实有上述新增类型；不把试点扩大成全区域 codec 重写。试点要证明现有协议的错误结果和顺序能够保持，再决定新 owner 是否采用。它是已有待办，不另计本报告发现。

**Store-failure mappings 应保留命名明确的策略入口，不建议收成一个带许多开关的通用 mapping。**

[持久化失败映射文件](D:/cxt/d84-struct/src/core/work-graph/persistence/read-result-failures.ts:66)已经把这些相似实现放在同一处。它们的差异可见于返回协议：

| 映射 | `unique_conflict` | `revision_conflict.current` | `unsupported` / `corrupt` |
|---|---|---|---|
| `sessionStoreFailureToRejection`，`:66` | `revision_conflict`，追加 unique slot 被占文本 | 解码 pin，只在非空时附带 | unsupported 保留；corrupt 变 unavailable，追加 damage 前缀 |
| `executionStoreFailureToRejection`，`:88` | `busy`，追加 **Kernel identity slot** 文本 | 解码 pin，只在非空时附带 | 两者都变 unavailable，保留原 reason |
| `ownerWriteStoreFailureToRejection`，`:110` | `busy`，原 reason | 不附 current | 两者都变 unavailable |
| `ownerReadStoreFailureToRejection`，`:124` | unavailable | 不附 current | unsupported 保留；corrupt 变 unavailable |
| 本区域 Claim 的局部映射，[claim-service.ts:127](D:/cxt/d84-struct/src/core/work-graph/tasks/claim-service.ts:127) | 与 Session 一样映射为 revision_conflict 并追加 slot 文本 | 解码非空 pin | unsupported 保留；corrupt **不加** Session 的 damage 前缀 |

这些差别不只是措辞。`busy` 和 `revision_conflict` 会影响调用者如何处理；有无 current、是否保留 unsupported 也是接口的一部分。

可以用显式 policy object 表达这些差别，但目前会把约百行直接可读的分支换成解释 policy 的实现和多份配置，收益很小。新 owner 应选择与自身协议一致的命名策略；例如角色名额冲突不能仅因同样使用 unique claim，就继承“Kernel identity slot 被另一 Run 占用”的文本。**不新增这一项重构发现，也不把差异抹平。**

**C1 裁定第 7 条的 look-alikes，逐项判断如下。**

| 项目 | 本区域现状与 file:line | 判断 |
|---|---|---|
| inline safe-integer | 本区域共有 **47 行**出现 `Number.isSafeInteger`，这不是 47 个相同谓词。例如 [claim-record-codecs.ts:130](D:/cxt/d84-struct/src/core/work-graph/tasks/claim-record-codecs.ts:130)允许 0；[plan-readers.ts:232](D:/cxt/d84-struct/src/core/work-graph/tasks/plan-readers.ts:232)要求正数；[plan-readers.ts:376](D:/cxt/d84-struct/src/core/work-graph/tasks/plan-readers.ts:376)只判断 safe integer；[planning-question-reader.ts:217](D:/cxt/d84-struct/src/core/work-graph/tasks/planning-question-reader.ts:217)是分页 offset。 | **部分数学谓词相同，使用场景并不相同。**可以复用已有 `isInt` / `isNonNeg` / `isPos`；不建议再做一个 `min`/`allowZero` 参数化万能谓词。整段替换还要保留属性读取次数和判断顺序，不能把 47 行当成批量替换清单。 |
| compound `isRunRef` | 找到 **6 个同名定义**。control `:116`、execution-history `:94`、run-state `:157`、evidence `:173`、materials/record-readers `:62` 都要求 project/goal/run，允许额外字段；[run-reconcile-service.ts:142](D:/cxt/d84-struct/src/core/work-graph/tasks/run-reconcile-service.ts:142)只检查 project/run。 | 前 **5 个可以使用一个明确允许额外字段的完整 RunRef predicate**。reconcile 的弱检查行为不同；本轮未从冻结规格确认其意图，不能顺手强化。若一定参数化，必须使“是否要求 goal”及返回类型明确，但两个命名谓词比隐藏布尔参数更易读。收益小，不作为片前工作。 |
| throwing `refKeyOf` | 同名函数 **17 个**：13 个直接调用 `canonicalJson`，4 个返回 `canonicalOf` 的可空结果。例：[claim-service.ts:121](D:/cxt/d84-struct/src/core/work-graph/tasks/claim-service.ts:121)、[completion.ts:107](D:/cxt/d84-struct/src/core/work-graph/tasks/completion.ts:107)。 | **失败语义不同，应保留区分。**可直接使用现有 throwing `canonicalJson` 与 nullable `canonicalOf`；不需要再加 `onError: throw/null` 的公共包装器。把抛错改成 null 会改变外围 catch 和拒绝路径。 |
| catch 后返回布尔的 `sameRef` | 本区域 **6 个同名定义**：claim `:124`、entry `:137`、history `:87`、reconcile-intents `:86`、session-anomaly `:93`、session-provenance `:64`。均是 canonical equality，失败返回 false。 | **这 6 个语义相同**，可以用现有 [contracts/fingerprint.ts:51](D:/cxt/d84-struct/src/contracts/fingerprint.ts:51) 的 `sameJson`，无需参数。不能改成两个 nullable key 直接比较，否则两个失败值可能相等。此处是小规模归并收益；#5 关注的是跨 owner 出口位置，不把这几个一行函数另算发现。 |
| execution-entry 允许额外字段的 ref/binding 检查 | [execution-entry-service.ts:166](D:/cxt/d84-struct/src/core/work-graph/tasks/execution-entry-service.ts:166)、`:173`、`:178` 等按需要的字段检查，不要求 exact keys。 | **宽松形状检查与严格 wire decoder 是不同职责。**共享时应显式保留允许额外字段的契约；不能直接换成 exact-shape codec。也不宜给每个 helper 都加 `strict` 开关，让调用者决定协议宽严。 |
| `sameTask` / `sameTaskTriple` | [claim-record-codecs.ts:387](D:/cxt/d84-struct/src/core/work-graph/tasks/claim-record-codecs.ts:387)、[context-input-service.ts:197](D:/cxt/d84-struct/src/core/work-graph/tasks/context-input-service.ts:197)比较 project/goal/task 三字段。跨区比较：[state/command-rerun-request.ts:249](D:/cxt/d84-struct/src/core/work-graph/state/command-rerun-request.ts:249)。 | **是在比较领域身份，故意忽略其他字段。**同一身份的实现可共享有类型的 `sameTaskIdentity`，不宜换成 canonical 全对象比较，也不宜抽成 `sameFields(value, fields)`。 |
| K3 的 `sameReviewRef` / `sameRunRef` | 当前本区域没有这两个函数定义；相关定义在区域外，例如 [state/command-rerun-request.ts:253](D:/cxt/d84-struct/src/core/work-graph/state/command-rerun-request.ts:253)、[state/review-lease.ts:67](D:/cxt/d84-struct/src/core/work-graph/state/review-lease.ts:67)。前者比较 project/goal/run，与相应 Run 身份共享字段。 | **字段碰巧相同，不代表领域身份可以混用。**保留 review/run 的类型语义；不建议为省三次比较增加带字段参数的公共 helper。此处只跟依赖比较，没有把区域外实现列为本区域发现。 |
| codec parsers 自有协议 | 例如 [command-rerun-request-codecs.ts:230](D:/cxt/d84-struct/src/core/work-graph/tasks/command-rerun-request-codecs.ts:230)、[unknown-call-review-codecs.ts:556](D:/cxt/d84-struct/src/core/work-graph/tasks/unknown-call-review-codecs.ts:556)、[project-bootstrap-record-codecs.ts:350](D:/cxt/d84-struct/src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:350)。 | 共同的 envelope 机械部分可以复用；记录内交叉引用、事件内外身份、proof 和失败协议仍属于各自 codec。交给原定生成试点验证，不从“都 parse JSON”推导出可统一的完整 decoder。 |

对 C1 裁定第 6 条，我的本区域结论是：**K3 两种卡片不属于“还没接通用集合 source”的遗漏。**区域外 `views/decision-read-model.ts:417`、`:648` 已分别用通用 source 接 UCR、CRR；本区域的 [unknown-call-review-card.ts](D:/cxt/d84-struct/src/core/work-graph/tasks/unknown-call-review-card.ts:1)和 [command-rerun-request-card.ts](D:/cxt/d84-struct/src/core/work-graph/tasks/command-rerun-request-card.ts:1)是纯投影，应继续共享给读模型和答复资格检查。

本区域仍存在的边界问题是 #9。整个“三个手写 source 迁移”以及 generic source 的 project 主体扩展，主要落在 `views/`，应由该区域的审查统一裁定，不能用它替本区域制造三份未迁移计数。

最终计数与估计如下：

| 归类 | 发现数 | 新增估计 | 删除估计 | 新增＋删除 |
|---|---:|---:|---:|---:|
| **1 片前做**：#1–#6 | **6** | 2,465 | 2,145 | **4,610** |
| **2 合拢后做**：#7 | **1** | 650 | 590 | **1,240** |
| **3 只记下**：#8–#9 | **2** | 640 | 580 | **1,220** |
| **合计** | **9** | **3,755** | **3,315** | **7,070** |

行为问题单列：

- **已知、非本轮新增：**[tasks/goal-decision-reader.ts:425](D:/cxt/d84-struct/src/core/work-graph/tasks/goal-decision-reader.ts:425)接收 `atLeastCursor`，实际读取路径未使用；C1 裁定第 9 条已交给独立修复，不计入结构发现。
- 本轮未确认其他新的行为 bug。

以下是本区域文件阅读记录。`read` 表示通读；`skimmed` 表示检查了结构、接口、依赖及相关实现路径，没有声称逐行完成行为审计。

```text
src/core/work-graph/tasks/blocked-command-order.ts — skimmed
src/core/work-graph/tasks/claim-record-codecs.ts — skimmed
src/core/work-graph/tasks/claim-service.ts — skimmed
src/core/work-graph/tasks/codec-fields.ts — read
src/core/work-graph/tasks/codec-shape-checks.ts — read
src/core/work-graph/tasks/command-expansion.ts — skimmed
src/core/work-graph/tasks/command-recognition.ts — skimmed
src/core/work-graph/tasks/command-rerun-request-card.ts — read
src/core/work-graph/tasks/command-rerun-request-codecs.ts — skimmed
src/core/work-graph/tasks/command-rerun-request-service.ts — skimmed
src/core/work-graph/tasks/completion-policy.ts — skimmed
src/core/work-graph/tasks/completion-record-codecs.ts — skimmed
src/core/work-graph/tasks/completion.ts — skimmed
src/core/work-graph/tasks/context-input-service.ts — skimmed
src/core/work-graph/tasks/control-contracts.ts — skimmed
src/core/work-graph/tasks/control-service.ts — skimmed
src/core/work-graph/tasks/decision-answer-lookup.ts — skimmed
src/core/work-graph/tasks/decision-source-identity.ts — read
src/core/work-graph/tasks/eligibility.ts — skimmed
src/core/work-graph/tasks/entry-plan-reader.ts — read
src/core/work-graph/tasks/evidence-coverage.ts — skimmed
src/core/work-graph/tasks/execution-entry-service.ts — skimmed
src/core/work-graph/tasks/execution-history-binding.ts — skimmed
src/core/work-graph/tasks/execution-history-service.ts — skimmed
src/core/work-graph/tasks/goal-basis.ts — skimmed
src/core/work-graph/tasks/goal-control.ts — skimmed
src/core/work-graph/tasks/goal-decision-reader.ts — skimmed
src/core/work-graph/tasks/goal-executed-files-reader.ts — skimmed
src/core/work-graph/tasks/goal-settings-service.ts — skimmed
src/core/work-graph/tasks/initial-plan.ts — read
src/core/work-graph/tasks/model-call-contracts.ts — skimmed
src/core/work-graph/tasks/model-call-service.ts — skimmed
src/core/work-graph/tasks/model-request-codecs.ts — skimmed
src/core/work-graph/tasks/owner-record-read.ts — read
src/core/work-graph/tasks/plan-commit-compiler.ts — skimmed
src/core/work-graph/tasks/plan-readers.ts — skimmed
src/core/work-graph/tasks/plan-service.ts — skimmed
src/core/work-graph/tasks/plan-task-basis.ts — skimmed
src/core/work-graph/tasks/plan-validation.ts — skimmed
src/core/work-graph/tasks/plan-write-admission.ts — skimmed
src/core/work-graph/tasks/planning-question-reader.ts — read
src/core/work-graph/tasks/receipt-replay.ts — read
src/core/work-graph/tasks/reconcile-intents.ts — skimmed
src/core/work-graph/tasks/reconcile-reads.ts — skimmed
src/core/work-graph/tasks/request-facts-reader.ts — read
src/core/work-graph/tasks/requeue-service.ts — skimmed
src/core/work-graph/tasks/revision-guard.ts — read
src/core/work-graph/tasks/run-activity-codecs.ts — read
src/core/work-graph/tasks/run-activity-service.ts — skimmed
src/core/work-graph/tasks/run-reconcile-contracts.ts — skimmed
src/core/work-graph/tasks/run-reconcile-service.ts — skimmed
src/core/work-graph/tasks/run-state-service.ts — skimmed
src/core/work-graph/tasks/session-anomaly-codecs.ts — skimmed
src/core/work-graph/tasks/session-anomaly-service.ts — skimmed
src/core/work-graph/tasks/session-facts.ts — skimmed
src/core/work-graph/tasks/session-provenance-facts.ts — skimmed
src/core/work-graph/tasks/task-phase-facts.ts — skimmed
src/core/work-graph/tasks/task-review-reader.ts — skimmed
src/core/work-graph/tasks/task-service.ts — skimmed
src/core/work-graph/tasks/trusted-context.ts — read
src/core/work-graph/tasks/unknown-call-review-answers.ts — skimmed
src/core/work-graph/tasks/unknown-call-review-card.ts — read
src/core/work-graph/tasks/unknown-call-review-codecs.ts — skimmed
src/core/work-graph/tasks/unknown-call-review-service.ts — skimmed
src/core/work-graph/tasks/unknown-call-review-target-digests.ts — skimmed
src/core/work-graph/evidence/evidence-service.ts — skimmed
src/core/work-graph/evidence/verification-plan.ts — skimmed
src/core/work-graph/materials/applicability.ts — read
src/core/work-graph/materials/material-service.ts — skimmed
src/core/work-graph/materials/record-ports.ts — read
src/core/work-graph/materials/record-readers.ts — read
src/core/work-graph/materials/run-snapshot-decoder.ts — read
src/core/work-graph/configuration/decision-settings-service.ts — read
src/core/work-graph/configuration/line-settings-service.ts — read
src/core/work-graph/configuration/message-duties-adapter.ts — skimmed
src/core/work-graph/configuration/project-bootstrap-contracts.ts — skimmed
src/core/work-graph/configuration/project-bootstrap-record-codecs.ts — skimmed
src/core/work-graph/configuration/project-bootstrap-service.ts — skimmed
src/core/work-graph/configuration/role-memory-service.ts — skimmed
src/core/work-graph/configuration/role-record-codecs.ts — skimmed
src/core/work-graph/configuration/workspace-settings-reads.ts — skimmed
```