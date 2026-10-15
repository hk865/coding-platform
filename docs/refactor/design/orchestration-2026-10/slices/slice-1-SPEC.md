# 第 1 片冻结规格：Session 事实、纠错与归档

**后注（决定 43、51、54、60）：** 后来的决定改写了本规格的这几处：
- §0.1（约 14 行）与 §4 第 4、5 点（约 88、89 行）：决定 51 改写了「认定后马上归档」这一支——经人认定、Kernel Turn 还开着的线，改为关闭悬空 Turn、回可用、留在原 Session，不归档、不写异常锚点、不放下任务；决定 54 改写了退役无接续线——Host 重启时暂停着的不马上归档，显示「已暂停 · 主机重启时已暂停，可继续」，点继续后关 Turn 在原线领取。
- 约 163 行（`SessionProvenanceV1` 的 continuation `reason`，即 `createContinuation` 输入）`reason: 'interrupted' | 'archived' | ...`：按决定 43 去掉 `'archived'`；被归档线的接手是别的 Session 的新领取，不是那条线的接续。
- L4（约 41 行）、§2.8（约 377 行）、S1-LINK-01/02（约 477、478 行）：决定 60-5、60-6、60-7、60-8 在 `WorkLinkTarget` 加 `goal`、`project` 两种负责目标，加角色范围、唯一占位、`reanchorSessionResponsibility`/`planReanchor` 和待命 `unassigned`，并把参谋、书记按闲满 `ROLE_LINE_IDLE_ARCHIVE_MS` 归档；这些由第 7 片 7D 改，本规格正文原样保留。
- 原文照留，只加此注。

> **状态：** lead 冻结，2026-10-08。代码基线 9b94fc55（src 与 676a7a7b 相同；收尾的全量测试在 676a7a7b 上是 215 个测试文件、5234 项全部通过）。§0 是 lead 的冻结说明；§1–§8 是 Codex（推理强度 xhigh）按 585f1ac0 写的草稿正文，lead 按 §0 改过：改过的地方标【lead 改】，lead 定的技术选择标【lead 定】。585f1ac0 到 9b94fc55 之间的 src 改动（7e0b7f56、60d946ff 等收尾小改）不碰本片用到的符号，lead 抽查过（§0.5）。**§0 与正文不一致时以 §0 为准。** 依据：[DESIGN §8.2](../DESIGN.md#82-分片表) 第 1 行、§4.2–4.9、附录 C；HANDOFF 决定 38、42、43；[分片总说明](README.md)。

## 0. 冻结说明（lead）

### 0.1 OPEN：要用户定（施工到这一支之前停下问）

**2026-10-08 已定：用户选 (a)（HANDOFF 决定 45）。** 下面冻结的“不新增行为”就是 (a) 的做法，规格和用例不改。标题里的锚点保留，别处的链接仍指向这里。

**U1 退役、没有接续的线，手上的执行结果未知（Run 是 outcome_unknown，Session 仍被占用）。**
- 设计原文：决定 38【已定】“退役、没有接续的线马上归档”（DESIGN §4.5“马上归档退役、没有接续的线”）；决定 42 第 1 条【已定】“平台自动归档时没人在场，只走不需要人选的路”；§4.5 lead 的做法：“结果待核对的（停没停下证明不了）：平台自己放不开它的 Session……你确认，就走已有的‘认定’”。
- 两条已定的话在这一支上不能同时成立：自动维护不能替人“认定已停下”，Session 不放开就归档不了。
- 选项：(a) 等人：这条线保持“已退役”（不归档），它的执行照今天显示“待核对”；你用已有的“认定”确认以后，下一次维护马上把它归档（写锚点、放下任务）。(b) 平台自动认定：Session 已退役、Kernel 读不到、没有接续时，平台把这次执行认定为“已停下”再归档；要新加一行状态规则，认定人记“平台”。
- lead 的建议：(a)。理由：认定是“停没停下”的事实判断，今天只有人能做；(b) 让平台在证据不全时下结论。
- **本规格对这一支冻结为“不新增行为”**：自动维护遇到它就跳过，在 `SessionMaintenanceResultV1.failures` 里记 `busy` / `archive_unknown_confirmation_required:`（今天被占用的 Session 本来就不能归档）。跳过是指对这个 Session 零提交：不登记归档请求、不写锚点、不放下负责关系、不碰那个 Run（IT34 锁住）。选 (a) 不用再改；选 (b) 要加一行 S1-AUTO-04 和 2 个用例，并改 IT34。其余各支不受影响，可以先施工。

### 0.2 lead 定的技术选择（一行一项，理由在括号里）

草稿 §7.1 的 10 项，全部选草稿推荐的 A：
- **T1** 执行开始时不存工作区基线：Kernel 记录 → 当前 HEAD 的未提交改动（全部算“可能改过”，并写明可能混有别的执行的改动）→“改动未知”。（设计 §4.5 已按这三步写；存基线是新能力，要加 Run 字段、存储、并发和重启规则，第 1 片不需要它也能如实显示。）
- **T2** 按 Session 找执行：给已有的 Outbox 记录的 `claim` 注册索引，不在 Run 上加冗余字段。（旧数据不用回填。）不搬 codec，见 L1。
- **T3** 归档各步的提交身份：从不可变的归档请求派生，内部恢复时的读 guard 不进身份；公开 GraphWrite 照旧把 expected 算进指纹。（崩溃后重读到新版本也不会撞 idempotency_conflict。）
- **T4** 旧 Session 的来历：一次性按可靠事实补写（事件记依据），没有可靠证据记“新建”，证据冲突报 incomplete。（AMB-1、2 已定读法；补写后索引直接可用，K 片和第 2 片不用再扫旧数据。）
- **T5** 软排序：稳定的 Kahn 拓扑排序，就绪集合里按（必需优先、计划里的位置、taskId）挑。（依赖先后完整；不加领取门。）
- **T6** 自动归档的时限：Host 注入 `SessionArchivePolicyV1`，默认 1 天，不建项目设置表。（项目设置的存储归第 5、6、7 片。）
- **T7** 锚点“已被接手”：读的时候从后续执行的 `inputBinding.anomalyAnchorRefs` 加“真实进入”算出来，锚点本身不改。（不维护第二份状态。）
- **T8** 转走的回复：加 `replyHandler` 索引（第 6 个索引）。（每个安全点不用遍历全部 Session。）
- **T9** 归档请求清掉以后的回放：请求里存回执定位，按原 `SessionArchiveRequested` 事件还原。（沿 queries 的 submission locator 样板。）
- **T10** 锚点后的普通领取不带旧线的完整历史：`archiveOrigin` 不为空时不 seed 旧 Session 的 Kernel 历史，只带任务事实链和锚点段。（决定 43：这是一次新的领取，不是旧线的接续。）

lead 另定的 6 项（草稿没列，或和设计不一致）：
- **L1 Session 事实的读者放 `tasks`，不放 `sessions`，不搬 codec。** 设计 §7.2 写的是“按 Session 找执行的索引……：`tasks`”。草稿把读者放在 `sessions/session-facts.ts`，为此要把 Outbox 的 codec 搬到 `persistence`。改为：读者是 `src/core/work-graph/tasks/session-facts.ts`（tasks 可以依赖 sessions、queries、materials），接口 `SessionFactsPort` 仍声明在 `model/session-facts-contracts.ts`；`sessions` 的归档入口和 `queries` 的 Query 领取经依赖注入拿到它（composition 装同一个实例），不 import tasks。删掉草稿的 `persistence/claim-outbox-codec.ts`。缺注入时：sessions 的新入口（`requestSessionArchive`、`finishSessionArchive`、`releaseSessionArchiveRequest`）回 `unsupported`，旧入口不变；queries 的领取维持旧行为（只为旧的窄测试替身；生产装配必须注入，SV40 用注入了它的夹具）。
- **L2 本片不加 `replyDeadline`。** 答复期限是第 7 片的消息新字段（附录 C 第 6 个）。“转走时问题和期限不变”在本片自然成立（还没有期限字段）。正文里涉及它的字段和断言已删。
- **L3 草稿的 U2（任务有负责人，但这个 Session 从没为它跑过执行）：不写锚点。** 锚点是“一条锚点一个执行”（附录 C），记的是被中断的那次执行改了什么；没有执行就没有可记的改动。负责关系照常放下（或按选择交出），任务回到等待派工，读出来没有“中断，待核对”。这是 lead 对自己的做法（决定 42 的锚点，用户可改）的细化，不是新的用户行为。正文 S1-ANCHOR-02 已改，新加用例 IT33。
- **L4 职责只分“执行者 / 别的 / 不知道”。** `SessionDutyResolver` 返回 `ReadResult<PlatformDutyV1 | 'unknown'>`，`PlatformDutyV1` 来自共用文件 `src/contracts/platform-duty.ts`（第 1、3、5 片各自按 [README](README.md)“共用文件”给的原文逐字节新建，sha256 `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`，合并时不冲突），去掉草稿的 `module_maintainer`（设计 §4.10 只有五种职责）。执行者满一天自动归档另加一个条件：没有开放的 `module` 负责关系（设计 §4.5“模块维护的线不自动归档”；模块负责人第 8 片才写，今天恒为空）。
- **L5 路由的联合类型在 `src/app/core-http-types.ts`。** 草稿文件清单漏了它：`CoreRouteSuffix` 只在这里声明（`core-http-types.ts:110`），11 个新 suffix 加在这里，`core-routes.ts` 不另造联合。已加进 §6（F87）。
- **L6** U1 按 §0.1 冻结为“不新增行为”。

### 0.3 对草稿的改动清单

| # | 位置 | 改动 |
| --- | --- | --- |
| 1 | §2.5、§2.9 默认表、§5 的 UT23/SV01/SV09/SV30/IT20/IT28、§8 规则 3 | 删 `replyDeadline`（L2）；§1.3、§3.4 里“问题/期限不变”的说法保留（本片还没有期限字段，自然不变） |
| 2 | §2.8 索引表下一段、§3.3 签名注释与依赖段、§6 F18/F19/F20、§8 规则 4 | Session 事实读者改到 `tasks/session-facts.ts`，不搬 codec（L1） |
| 3 | §3.2 S1-ANCHOR-02、§5.4 新加 IT33、§7.2 | 没有执行不写锚点（L3） |
| 3b | §5.2 新加 UT56 | 执行者自动归档的模块负责关系条件（L4） |
| 4 | §2.8 `SessionDutyResolver`、§3.5 `executorArchiveDue` | 职责类型和模块负责关系条件（L4） |
| 5 | §6 | 加 F87 `src/app/core-http-types.ts`（L5） |
| 6 | §7.1 | 每行标【lead 定】 |
| 7 | §7.2 | U1 移到 §0.1；U2 改为 lead 定（L3） |
| 8 | §8 | 数量按 §0.6 |

### 0.4 和第 3、5 片的接缝

三片从同一个基线（第 0 片合入、B0 提交之后）各开一个副本并行施工，按 1 → 3 → 5 的顺序合入（[README](README.md)）。本片要知道的：
- **共用类型。** `PlatformDutyV1` 用 `src/contracts/platform-duty.ts`：本片按 README“共用文件”的原文逐字节新建（第 3、5 片也建同一个文件，内容相同，合并时不冲突），不另定义别的职责类型。
- **和第 5 片同改的文件**（合入第 5 片时由 lead 合并，两边的新增都保留）：`state/message-machine.ts`、`model/communication-contracts.ts`、`sessions/message-record-codecs.ts`、`communication/mailbox-service.ts`、`agent-runtime/execution-inputs.ts`、`tasks/claim-record-codecs.ts`、`tasks/claim-service.ts`、`tasks/requeue-service.ts`、`tasks/plan-readers.ts`、`tasks/execution-entry-service.ts`、`queries/query-record-codecs.ts`、`contracts/ledger.ts`、`business/workflow/` 下的 `workflow.ts`、`ports.ts`、`contracts.ts`、`consultation.ts`，`app/` 下的 `core-routes.ts`、`core-http-types.ts`、`collaboration-driver.ts`，`composition/create-platform.ts`，`tests/architecture/state-writes.test.ts`。本片在消息上只加 `replyHandler`、`archiveWaitDisposition` 两个可选字段和一个索引；第 5 片加收信方“你”、决定元数据、落实等。两边互不改对方的字段。
- **和第 3 片同改的文件：** `agent-runtime/` 下的 `execution-preparation.ts`、`ports.ts`、`runtime.ts`，`queries/query-execution.ts`，`tasks/execution-entry-service.ts`，`app/core-routes.ts`、`app/core-http-types.ts`，`composition/create-platform.ts`。本片在接续说明（`ContinuationBriefV1`）上加 `anomalies` 段；第 3 片的装配器把接续说明原样放在最后一段，不改它的内容。
- **合入后的接线（README 的 I-1、I-3、I-5）：** 第 3 片合入后，`SessionDutyResolver` 改为读第 3 片的职责（I-1）；第 3 片装配器的 `extensions.anomalies` 接本片的 `listSessionAnomalies`（I-3）；第 5 片合入后，它“请知悉”的 `undelivered_reply` 类别接本片的 `readUndeliveredReplies`（I-5，【审查改】原来没有这一项）。本片不预先接，也不为它们留假实现。

### 0.5 lead 抽查的代码出处

在 9b94fc55 上用 `grep` 核对了草稿引用的 55 个 `file:symbol`（样板、codec、状态机、Workflow、路由、测试夹具），全部存在。例：`sessions/session-record-codecs.ts:613 SESSION_RECORD_SCHEMAS`、`:693 encodeSessionRecord`、`:743 decodeSessionRecord`；`tasks/claim-record-codecs.ts:76 TaskRequeuedEvent`、`:607 decodeTaskRequeueSnapshot`、`:724 TASK_CLAIM_RECORD_SCHEMAS`；`state/session-availability.ts:267 createSessionRecord`、`:313 releaseSessionRecord`；`state/task-failure.ts:446 nextRequeueAutoCount`（`automatic = actorClass !== 'human'`，agent 发起的已经计数）。发现的问题只有一处：文件清单漏了 `src/app/core-http-types.ts`（L5）。另改了一处位置：Session 事实读者（L1）。

### 0.6 精确数量（冻结）

- 状态行 19 行：S1-SES-01…06、S1-LINK-01/02、S1-DISPATCH-01/02、S1-MSG-01/02、S1-ANCHOR-01/02、S1-TASK-01/02、S1-AUTO-01…03。
- 新索引 6 个；新正式记录 1 种（`SessionAnomalyAnchor`）；新事件类型 6 个（§2.9）；新路由 11 个。
- 文件 87 个：新建 38、修改 49。其中源码 60（新建 15、修改 45；新建里含共用文件 `src/contracts/platform-duty.ts`，§6 F88），新测试文件 23，改动的已有测试文件和测试工具 4（`tests/architecture/state-writes.test.ts`、`tests/state/invariants.ts`、`tests/state/session-availability.test.ts`、`tests/state/message-machine.test.ts`）。逐个文件见 §6。
- 用例 151 个：单元 56（UT01–UT56）、服务 61（SV01–SV61）、集成和场景 34（IT01–IT34）。服务用例在 memory 和 SQLite 各跑一次，共 212 次。已有状态测试的穷尽矩阵扩展不计入这 151 个（§5.2 末段）。【审查改】加了 IT34（§0.1 冻结的 U1 跳过，原来没有用例锁住）。
- 估计行数（不是验收数字）：生产代码新增约 2,600–4,100 行，测试约 2,100–3,200 行。
- 任务书：[slice-1-book-part1.md](slice-1-book-part1.md)（骨架和测试，然后停）、[slice-1-book-part2.md](slice-1-book-part2.md)（实现）。

---

以下是草稿正文（Codex，基线 585f1ac0），已按 §0 改过。

## 1. 范围与依据

### 1.1 本片交付

以 `DESIGN.md` §8.2 第 1 行为边界，实现：

1. 创建时记录 Session 来历；建立按前任找 Session、按 Session 找 Work 执行、按 Session 找 Query 的三个索引。旧 Session 只凭可靠事实恢复关系，不按角色、名字、相近时间猜前任。
2. 负责关系转移在一次 RecordStore 提交里关闭旧关系、打开新关系；终结任务的关系自动关闭。接续后转走本任务责任，归档旧 Session；部分交出保留旧 Session。
3. Workflow 唯一的归档组合动作：先登记请求、停止执行，再处理任务、等待，最后归档。普通等待必须选取消或转走；退役 Session 不论有没有接续都免这一选择。一步一提交，可从持久事实恢复；失败不回滚已完成处置。
4. 归档中断 Work 时留下不可变异常锚点，同一条记录可以从任务和目标读取；已停止、结果未知的 Work 经明确人工认定后也走此路。改动不撤销、不验收。接手执行的接续说明包含锚点。
5. 执行者短期线做完满 `86_400_000` ms 自动归档；退役、无接续的线在下次 Workflow 步立即归档；只读副本的正式回答保存后归档。
6. 排除只读副本、退役、归档中、等回复的 Session，保留合法的原等待接续领取。等待中的原 Session 不开 Query，询问走已有的隔离副本路径。
7. Workflow 在现有可执行候选中按 `executionDag.dependsOn` 软排序，不新增依赖完成守卫。
8. 归档/退役中断不增加自动返工次数；归档后的任务由普通派工选别的 Session，有合适的复用，没有才创建。它是新领取，不自动算原线接续。

用户可见结果：完成任务后原来被 `responsible` 卡住的 Session 能归档；未完成任务的接口明确要求“交给/放下”；运行中归档可先受理，能读到“归档中”以及异常锚点；退役的 Session 不能重新启用；等待、副本不被派别的活。新界面的按钮、词、计数和节点详情在后片落地，旧界面暂时仍通过现有端口工作。

### 1.2 后片增加的内容

| 片 | 本片提供的接缝 | 本片不做的行为 |
| --- | --- | --- |
| 0 | 已完成的状态/codec/回执机制 | 不重跑可靠性批次或重构 WorkGraph |
| 2 | 来历、三索引、归档请求、锚点只读端口 | 完整工作线列表、左栏词与计数、节点详情、时间回放、活动计数、通用执行足迹 |
| 3 | 不可裁掉的异常锚点接续段、按目标读锚点端口、职责解析接缝 | 通用上下文装配器、精确输入恢复、角色配置、看/找/记和提醒装配 |
| 4 | 平台锚点事实 | 注记、当前理解、书记补写机制；归档不等书记写完（AMB-6） |
| 5 | 归档中断的返工豁免及待派事实 | 目标设置、自治判定、决定卡、通用请知悉队列、返工通知与上限扩展 |
| 6 | Query 索引和 Session 排除函数 | 请求归属、多秘书、秘书等待和秘书归档的请求处置；不能把 Work 等待定义套到秘书 |
| 7 | `replyHandler`、未送达派生读法、原等待关闭的事实 | 通用消息到期、干预、成员消息消费、手动转交已到回复、含义排序、自动提交唤醒、完整换手工具、退役线询问的历史缺失退路 |
| K/K2 | 保留 `kernel_turn_open` 退路 | 不关闭悬空 Turn、不复活退役 Session、不改 Kernel、不做 compact |
| E3 | 路由和精确返回值 | 不改冻结原型或 UI；D42-2 的所有新界面在 E3 接线 |

第 1 片包含**归档时转走等待**及其回复处理的最小闭环，因为这由决定 42 纳入本片；不因此把第 7 片的全部消息机制提前。退休未送达的“请知悉”在本片输出只读来源项，第 5/6 片把它装成队列/主对话；不能声称本片已经显示新界面。

### 1.3 裁决表与阅读优先级

| 依据 ID | 本片落实 |
| --- | --- |
| 决定 7、8；DESIGN §4.3 | 冻结 Kernel 的 `kernel_turn_open` 退路；已完成历史和被中断步骤分别处理 |
| 决定 11；决定 26；DESIGN §2.4 | 依赖只是排序，不等上游整个任务完成，不成为领取门 |
| 决定 20、22、23 | WorkGraph 唯一写事实；锚点不授权、不写 satisfied/COMPLETED，不冒充注记 |
| 决定 25、30、33、38 | continuation 同线，handoff 新线，copy 附原线；做完/退役/归档不同维度；一天归档、退役拒启用 |
| 决定 35：Q1、Q2、Q3、Q4、Q19、Q20、推出 2 | 交给/放下、副本答完归档、工作线、停止中、候选排除、Work 等待、终结责任关闭 |
| 决定 40；module-dag §6 | 13 子模块方向；`sessions` 不依赖 tasks/queries；`state` 只能导入 contracts 和同目录 |
| 决定 42 第 1、2 条 | 活执行可归档，异常可见；退役等待豁免；等待转走保留问题/期限；改动留存 |
| 决定 43 | DSH 两阶段；锚点后普通派工、别的 Session；中断不占返工上限（lead 做法） |
| AMB-1、2 | 旧可信来历恢复；允许分叉，每个接续各有线头，前任历史可重复读到 |
| AMB-3、4、5、27、43 | 分步失败保留事实；所有退役等待豁免；受理归档请求；回复处理方转移；退休未送达来源 |
| AMB-6（正文已定） | 当前理解补写不是归档前置 |
| MODEL O05/O08/O09/O10；R01–R10、R38；I01–I07/I16/I19 | 作为对象/行为交叉核对，不把分析用 `number` 时间、`Role='copy'` 或模型内嵌正文搬进生产 |

必读设计段：§1.5、1.6、1.8、1.9、2.4、4.1–4.9、5.1 的接续段、6 的工作线/归档接口、7.1–7.2、8.1–8.2、9.2–9.3、附录 B Q1/Q2/Q3/Q19/Q20/推出 2、附录 C、附录 E 决定 42。`REVIEW-SLICES-1-3-5.md` 是答复前的原提议；尤其丙 (a) 的“不让归档”已被决定 42 替换。MODEL 的 R05/R38 和片归属早于该决定，不照抄“transfer 可撤原等待重发问题”。

事实/行为以 HANDOFF 决定 42、43和修订后的 DESIGN 为先；AMB 的已定答案次之；MODEL 用于核对。不把 HANDOFF 中仍标“lead 做法，用户可改”的锚点实现和豁免说成用户逐字段批准。本文把这些作为待 lead 冻结的实施方案。【lead 改】§0.1 的 U1 不得让 DSH 自选；草稿的 U2 已由 lead 定（§0.2 L3）。

## 2. 数据与兼容

### 2.1 共同编码规则

生产时间一律沿用 ISO UTC `string`，版本叫 `revision`。完整引用携带项目；Workspace 由 Session/Run/消息核对，`SessionRef` 本身没有 workspaceId。Task 用现有 `TaskTriple`，不要给它加不存在的 `aggregateType` 或 planId；计划另用 `PlanRevisionRef`。

复制样板：

| 内容 | 必须读并照此写的 `file:symbol` |
| --- | --- |
| Session 编码、selector、schema 注册 | `src/core/work-graph/sessions/session-record-codecs.ts:SESSION_RECORD_SCHEMAS`、`encodeSessionRecord`、`decodeSessionRecord` |
| 不可变记录和带原结果的回放事件 | `src/core/work-graph/tasks/claim-record-codecs.ts:TaskRequeuedEvent`、`decodeTaskRequeueSnapshot`、`TASK_CLAIM_RECORD_SCHEMAS` |
| Session 组合字段由纯构造函数产生 | `src/core/work-graph/state/session-availability.ts:createSessionRecord`、`archiveSessionRecord`、`releaseSessionRecord` |
| 链接提交游标绑定 | `src/core/work-graph/sessions/session-lifecycle.ts:runLinkAttempt`、`PendingSessionWorkLink` |
| lookup 注册，不写 SQL | `src/core/work-graph/sessions/session-record-codecs.ts:SESSION_RECORD_SCHEMAS.lookups`；`src/core/record-store/lookup-ports.ts:RecordLookupIndex` |
| 消息结构性纯副本 | `src/core/work-graph/state/message-machine.ts:SessionMessageRecord` 与 `model/communication-contracts.ts:SessionMessage` 的类型等价测试 |
| brief 的 shape/digest/marker | `src/contracts/continuation-brief.ts:continuationBriefShapeProblem`、`continuationBriefDigest`、`renderContinuationBriefZh` |

`tasks/claim-record-codecs.ts:TASK_CLAIM_RECORD_SCHEMAS` 是当前已有的准确导出；不额外注册 Run、QueryRun、Session 或 Outbox codec。Run/QueryRun 的正式 selector 当前由 `materials/record-readers.ts:materialRecordSchemas` 注册，Query codec 不能再注册一个。

所有 optional 新字段：缺省合法，解码返回下表默认；现有 selector 的 `@1` 不升级。存在但类型错误的字段拒解码，owner 映射 `unavailable`，不能用默认吞掉损坏。旧 JSON、旧事件、旧 manifest 的 hash 和原回执不重写。解码加默认属于允许名单；正常写入只能由 state 构造函数生成。

### 2.2 Session 来历（shared 类型；owner sessions）

在 `src/contracts/core/session.ts` 增加：

```ts
export type SessionProvenanceV1 =
  | { schemaVersion: 1; kind: 'new' }
  | { schemaVersion: 1; kind: 'continuation'; from: SessionRef;
      reason: 'interrupted' | 'archived' | 'damaged' | 'role_mismatch'; task: TaskTriple }
  | { schemaVersion: 1; kind: 'handoff'; from: SessionRef }
  | { schemaVersion: 1; kind: 'readonly_copy'; from: SessionRef;
      messageRef: SessionMessageRef };
// 加到 SessionRecord；解码缺省均为 null。
provenance?: SessionProvenanceV1 | null;
archiveRequest?: SessionArchiveRequestV1 | null;
```

`SessionCreationInput`、`CreateSessionRequest` 和 Runtime 内部隔离请求快照增加 `provenance?: SessionProvenanceV1`；新调用不传等价 `{schemaVersion:1,kind:'new'}`。新admission的CoreOperation.action保存规范化值，`recordSessionCreated` 从accepted operation读来历，不接受第二份调用方来历。旧accepted operation没字段时照旧完成，但Session写provenance=null，留给同一旧数据取证；不能把旧pending copy创建误定为new。旧completed事件没有来历也解码为null。身份fingerprint对旧调用保持原来的键集合，不能给不传来历的旧请求补字段后改变其历史fingerprint。

创建检查：前任存在、同项目/工作区，不能等于 planned Session；copy 的消息必须存在且 `consultationDerivation.childSessionRef` 或本次固定派生选择吻合；continuation 的 Task 是同 scope 已采用任务。允许同一前任两个 continuation，不设唯一锁；不得把已有 Session 再写成 continuation 或 handoff。

来历写一次。唯一例外是**旧数据一次性补齐**：`provenance==null` 时从完整可靠事实补写；已有值绝不覆盖。记录 `SessionProvenanceBackfilled` 事件，事件含 `basis`，不新增永久迁移表：

```ts
export type LegacyProvenanceBasisV1 =
  | { kind: 'consultation'; messageRef: SessionMessageRef }
  | { kind: 'requeue_creation'; operationRef: OperationRef; creationCursor: CommitCursor; requeueRef: TaskRequeueRef;
      firstClaimRef: DispatchOutboxRef }
  | { kind: 'manifest_seed'; operationRef: OperationRef; creationCursor: CommitCursor; runRef: RunRef;
      manifestRef: ArtifactRef }
  | { kind: 'no_reliable_predecessor' };
```

可靠恢复算法：先经 Query 索引读 QueryJob.intent.execution.consultation.derivation，与原消息保存的固定 consultation derivation 交叉核对；其次是第一笔 claim 的 TaskRequeue.historySource 加“这次创建就是为此任务”的 completed CoreOperation（initialLinks 精确匹配任务、创建先于该首次 claim，child 不在 requeue 之前存在）；有 manifest 时核对 pinned digest、seededFrom、同一个 creation operation。首次 claim 按本 Session 的 `claim.generation` 最小值认，不按 runId 排序。两份可靠证据冲突返回 `incomplete/legacy_provenance_ambiguous`，保持 null并报告；没有可靠证据就是 `new`，事件 basis 为 `no_reliable_predecessor`。仅相同任务历史、historySource 指向别的 Session、时间接近，都不够证明一次复用是“新建接续”。

创建 operation 的可查定位必须明确：现有初始 `SessionWorkLink.since` 是 SessionCreated 提交的真实 cursor；以它作候选 `creationCursor` 调用 `records.eventAt`，只接受 `SessionCreatedEvent.session.ref` 正好为该 child、事件含 operationRef、completed operation 的 plannedSessionRef/initialLinks 全匹配的证据。重新打开的 link.since 若不指向 SessionCreated，不能当创建时间；没有可靠定位则不采纳 requeue/manifest 推断。`GoalRecordTransactionPort` 没有事件扫描接口，不得虚构 listEvents 或另加来历取证lookup。读取失败报告 incomplete/unavailable，不直接补 new。LegacyProvenanceBasisV1与SessionProvenanceV1同放contracts/core/session.ts。

Workflow 启动/维护分页执行补齐，已有引用索引自动更新。当前页补齐后再列线；工作区尚有provenance=null的历史Session未检查完时，读取给 `legacyPending:true`，不把“没查完”说成没有后继；“无continuation”的退休自动处置不能把这个标记吞掉。多个continuation各有线头；沿continuation回溯，遇handoff/new停止，copy附在from；最多显示32个，遗漏数单独返回。读法本片给事实端口，完整线投影在第2片。

### 2.3 Session 上的归档请求（owner sessions）

新 shared 文件 `src/contracts/core/session-archive.ts`：

```ts
export type ArchiveTaskChoiceV1 = {
  target: Extract<WorkLinkTarget, { kind: 'task' | 'work' }>;
  disposition: { kind: 'drop' } | { kind: 'transfer'; to: SessionRef };
};
export type ArchiveWaitChoiceV1 =
  | { kind: 'cancel'; runRef: RunRef; messageRef: SessionMessageRef }
  | { kind: 'transfer'; runRef: RunRef; messageRef: SessionMessageRef; to: SessionRef };
export type ArchiveExecutionV1 =
  | { kind: 'none' }
  | { kind: 'work'; runRef: RunRef; attemptRef: TaskAttemptRef }
  | { kind: 'query'; queryRunRef: QueryRunRef };
export type SessionArchiveRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  requestedBy: Extract<ActorRef, { kind: 'human' | 'system' }>;
  requestedAt: string;
  reason: string;
  mode: 'operator' | 'executor_idle' | 'retired' | 'answered_copy' | 'handoff_complete';
  tasks: ArchiveTaskChoiceV1[];
  wait: ArchiveWaitChoiceV1 | null;
  execution: ArchiveExecutionV1;
  executionPins: VersionPin[];
  confirmUnknownStopped: boolean;
  receipt: { identityKey: string; fingerprint: string };
};
export type ArchiveStepRefV1 = {
  sessionRef: SessionRef; archiveRequestId: string;
  requestReceipt: SessionArchiveRequestV1['receipt'];
  step: 'stop' | 'anchor' | 'requeue' | 'responsibility' | 'reply_handler' | 'wait_cancel' | 'archive';
  subjectKey: string;
};
export type RequestSessionArchiveInput = {
  sessionRef: SessionRef; reason: string;
  tasks: ArchiveTaskChoiceV1[]; wait: ArchiveWaitChoiceV1 | null;
  confirmUnknownStopped?: boolean;
  mode?: SessionArchiveRequestV1['mode']; // 默认operator，其他mode仅可信Workflow可选。
};
```

没有单独 ArchiveOperation/Wait/HandoffPackage 表；请求的 choices、execution 和原操作者不可变，只有 request 从 null→值→null。`confirmUnknownStopped` 只能来自该次人工 API 明确确认，自动维护永远 false。请求写入 `revision+1`，即使 Session 有占用也可登记；occupancy.generation 保持原值，不能把这次 revision bump 当成一次新领取。final archive 同次写 archivedAt 并清 request。任何 acquisition、sessionHint、秘书未来挑选都检查 request；观察、提交已有结果、释放占用不被挡。

`executionPins` 由owner在受理读窗生成，保存execution以及原wait涉及的Run/QueryRun完整VersionPin，按canonical ref排序、去重、最多2项；none且没有wait时=[]。和这些pins相同的RecordGuard纳入R提交。它不是调用方meta.expected，也不是文件/Kernel开始基线。用于调用既有public控制/认定服务时重建**首次**GraphWrite的expected，原runRevision不能随重试变。旧Session的R默认null；新R有execution却缺匹配pin拒解码，不能从当前Run补一份假原pin。

任务 choices 上限 100，reason 1–2000 UTF-16 code units；重复 target、transfer 给自己、超限均 `invalid`。任务已终结的旧选择允许忽略，记录实际已关闭结果；新出现的未完责任没有选择时要报告 `invalid/archive_disposal_required`，不能默认放下。因为中断可能新产生 yield，wait 是原先看到的确切 Run/message；新等待不符合原选择时拒归档，要求新的处置，不套用旧选择。

`ArchiveStepRefV1` 是持久 request 所派生的提交身份，不是新记录。内部步签名不接受动态 GraphWrite.meta：fingerprint 只含 scope、step、subjectKey、原 request 的不可变选择；CAS guards 来自步的实际读窗，不进内部身份 fingerprint。先查该身份回执，再读新事实。这样崩溃后不能因为重新读取了新 revision 而产生 `idempotency_conflict`。这条只用于内部归档步骤；所有公开 GraphWrite 继续把原 expected 纳入 fingerprint。

统一派生函数放 `contracts/core/session-archive.ts`：`deriveArchiveStepCommitIdentityV1(scope:WorkspaceScope, request:SessionArchiveRequestV1, step:ArchiveStepRefV1): {identityKey:string;fingerprint:string;eventId:string}`。沿 `sessions/session-lifecycle.ts:identityKeyOf/fingerprintOf/eventIdOf` 的canonicalJson/sha256Hex写法，先核step.requestReceipt/requestId与R一致。identity material精确为 `{schemaVersion:1, actor:R.requestedBy, projectId:scope.projectId, workspaceId:scope.workspaceId, sessionRef:step.sessionRef, archiveRequestId:R.requestId, step:step.step, subjectKey:step.subjectKey}`；identityKey=`'s1-archive-step:'+sha256Hex(canonicalJson(material))`；fingerprint=sha256Hex(canonicalJson(`{...material, requestReceipt:R.receipt, reason:R.reason, mode:R.mode, tasks:R.tasks, wait:R.wait, execution:R.execution, executionPins:R.executionPins, confirmUnknownStopped:R.confirmUnknownStopped}`))；eventId=sha256Hex(identityKey+'|'+step.step)。函数没有I/O、时间、状态构造或新授权，state只type-import其数据类型，不调用身份helper。

subjectKey固定：stop/anchor/requeue/wait_cancel用canonical完整RunRef；Query认定的stop用canonical QueryRunRef；responsibility用canonical WorkLinkTarget；reply_handler用canonical SessionMessageRef；archive用canonical SessionRef。既有submitControl的requestId=`'s1-archive-control:'+sha256Hex(canonicalJson({requestReceipt:R.receipt,runRef,action:'cancel'}))`，input={runRef,kind:'cancel',reason:R.reason}，expected=[R.executionPins中该Run的原pin]；未知认定用独立prefix `s1-archive-attest:`及action=`attest_work`/`attest_query`，reason=R.reason，同样固定原pin。这些仍走既有public owner的actor/expected fingerprint，不能拿内部helper替换它。当前可信调用以已核R.requestedBy授权，当前Host lease仍核。原回执命中后deliver原intent，不另交新控制；停止之后没有提交过cancel的自然终态照当前正式事实处理。固定pin已过期且原回执确实未命中时返回partial/revision_conflict，不能换pin复用相同requestId。

R.receipt是已存在Store回执的定位符，不另存回执：沿 `queries/query-record-codecs.ts` 保存submission locator的模式，由owner在提交前按原输入/meta计算。fingerprint含稳定输入、mode和原expected；requestedAt、观察出的execution和receipt是owner产出的记录字段，不能倒灌进请求fingerprint。owner先查回执，再取时间/执行事实；重试先还原原SessionArchiveRequested完整记录。Step的requestReceipt经lookupCommit→eventAt严格验证，哪怕final已清R仍能拿到原权限/选择；当前Host scope/lease仍检查。外部不能选执行或操作者，也不能构造receipt替换归档授权。

`readSessionArchiveRequestReceipt` 查不到该身份返回 `not_found/archive_request_receipt_not_found:`，Workflow只把这个确切分支当首次受理，其他invalid/forbidden/unavailable/idempotency_conflict都直接返回；不能把所有非ready读结果当回执未命中。原受理和原final都存在时，公开原GraphWrite重放归档组合取原final值/cursor，即使Session后来已重新启用；plain恢复入口仍按§4.2读当前状态。

### 2.4 负责关系（不新增记录；owner sessions，跨任务检查在 tasks）

沿用 `SessionWorkLink`。从 S 转到 D：同次 guards 两个 Session、旧 link、新 link、所涉 Task 当前采用定义以及停止证明；旧 `until=commitCursor`、新 `since=同一 commitCursor`、新 `until=null`；旧 link rev+1，新 link absent→1/closed→rev+1，两个 Session 各 bump 一次。目标 Session 已有该开放责任时只关闭旧 link，保留目标 link 的原 since/revision，仍 guard 它。历史 link 不删除。模块链接不因任务完成而关闭，也不挡 archive。

`task` 终结条件严格是当前 Task 投影 `effectivePhase==='satisfied'`，或 disposition cancelled/superseded；Run completed/exitCode 0 不是条件。`work` 链接须经现有 WorkContext 找到对应 Task 才可自动清理；不能解析时 `incomplete/work_responsibility_unresolved`，不盲目放下。

### 2.5 等待处置的消息字段（owner communication）

在 `model/communication-contracts.ts:SessionMessage` 及 `state/message-machine.ts:SessionMessageRecord` 同步增加：

```ts
// 【lead 改：L2】不加 replyDeadline（答复期限是第 7 片的字段）。
replyHandler?: {
  sessionRef: SessionRef;
  archiveSessionRef: SessionRef;
  archiveRequestId: string;
  changedAt: string;
} | null; // 旧值缺省 null，即仍由原 sender.sessionRef 接。
archiveWaitDisposition?: {
  kind: 'cancel' | 'transfer';
  runRef: RunRef;
  archiveSessionRef: SessionRef;
  archiveRequestId: string;
  recordedAt: string;
} | null; // 旧值缺省 null。
```

消息 sender/recipient、正文、createdAt、既有 response 和 status 不因转走改变。不复制提问、不让收件人重答。replyHandler/处置由消息机器写，消息 rev+1；同次 guard 归档 request、原等待 Run、源 Session、目标 Session，源 Session bump 一次，保证“不在等”读窗之后的处置变化也参与 CAS。转走和取消原 yielded wait 是两个可恢复提交；既有 `submitControl(kind:'cancel')` 只关闭旧 Run 的接续窗口，不撤问题、不删未来回答。

原等待的 cancel 用 archive 原操作者的授权。取消等待在消息事实里记作不再等（语义上“当作到期”）；本片没有新建一个缺 responseRef 的 `ConsumedWaitV1`，不能假造回复或运行已归档的源 Session。“到期没答复”的通用 continuation union 由第 7 片加。回复已在 slot 里时也可以转走：相同 inputId、part=response 的既有 acceptance 防重复。

回复转走的最小消费：目标正在执行→供其第一个安全点接受；目标空闲且负责该Task→普通requeue/claim后的第一个安全点带入response；目标空闲且不负责该Task→保留普通输入，到它下一次合法Work/Query的安全点送达。按DESIGN §4.5的“否则作为普通输入在它下一个安全点送达”，不因为这一条输入专门创建Query或小任务。如果目标后来等回复/归档/退役，保留未送达，不自动换人。Host旧的自动response consultation发现器跳过replyHandler非null的消息，避免把它再次交回原sender。

读取/确认全链使用同一个有效处理方：replyHandler非null取它，否则原work_run sender.sessionRef。`mailbox-service.ts:canReadMessage` 允许handler读原消息/response正文；不扩大ack/respond权限，原recipient仍是答复者。`recordInputAccepted` 的response执行Session检查改用有效处理方，仍核execution/kernel/generation/inputId和CAS Message；转走后原sender不能抢先确认。Runtime供给先合并原readOutbox与新readRoutedReplies，按同一 `deriveSessionInputId(messageRef,'response')` 去重，不能另造messageRef/inputId。这个路径不用ConsumedWait把已取消的旧wait伪装成在D等待。

只读派生项：

```ts
export type UndeliveredReplyV1 = {
  kind: 'retired_reply'; messageRef: SessionMessageRef; sourceSessionRef: SessionRef;
  responseRef: ArtifactRef; respondedAt: string; hasContinuation: boolean;
  requiresUserRecipient: boolean; // 无 continuation 为 true。
};
```

读取既有 sender-session 消息索引，在回复未被 `acceptedInputs(part:'response')` 使用且源退役时返回。不给“已转交”伪状态，不存第二份 notice；第 5 片以 messageRef+responseRef 去重。现有同线有接续的也不自动送过去。缺历史的副本退路归第 7 片。

### 2.6 异常锚点（唯一新正式 aggregate；owner tasks）

新 `src/contracts/session-anomaly.ts`，加入 `ledger.ts:AggregateRef`：

```ts
export type SessionAnomalyAnchorRef = {
  aggregateType: 'SessionAnomalyAnchor'; projectId: string; goalId: string; runId: string;
};
export type ArchiveChangedFilesV1 = {
  source: 'kernel' | 'worktree' | 'unknown';
  status: 'known' | 'partial' | 'not_entered' | 'unavailable';
  confirmed: string[]; possible: string[]; omitted: number;
  baseCommit: string | null;
  runBaselineKnown: false;
  reason: string | null;
};
export type SessionAnomalyAnchorV1 = {
  ref: SessionAnomalyAnchorRef; revision: 1; schemaVersion: 1;
  workspaceId: string; task: TaskTriple; planRef: PlanRevisionRef;
  lineHead: SessionRef; sessionRef: SessionRef; role: RoleConfigurationRef;
  runRef: RunRef; attemptRef: TaskAttemptRef;
  cause: 'archive_interrupted' | 'retired_archive';
  archiveRequestId: string;
  archiveRequestReceipt: SessionArchiveRequestV1['receipt'];
  archivedBy: Extract<ActorRef, { kind: 'human' | 'system' }>;
  recordedAt: string;
  changedFiles: ArchiveChangedFilesV1;
  resultVerification: 'not_checked';
};
export type SessionAnomalyViewV1 = {
  anchor: SessionAnomalyAnchorV1;
  pickedUpBy: RunRef | null;
};
export type ArchiveRequeueOriginV1 =
  | { kind: 'execution'; anchorRef: SessionAnomalyAnchorRef;
      archiveSessionRef: SessionRef; archiveRequestId: string }
  | { kind: 'wait'; runRef: RunRef; messageRef: SessionMessageRef;
      archiveSessionRef: SessionRef; archiveRequestId: string };
```

schemaId `SessionAnomalyAnchor@1`；一次执行最多一条，key 为**完整 RunRef 身份**（project+goal+run），不是 taskId，也不是 requestId。编码 body 的 outer ref/revision/schema 与 JSON 一致；task/plan/session/attempt 全交叉核对。new record guard expectedRevision=null，构造器在 `state/session-anomaly.ts`。已有同 Run 锚点重放原记录；另一原因/操作者不能覆盖第一条，也不能仅因另一个 requestId 再写第二条。Query 没锚点。

`archiveRequestReceipt` 固定为第一次写此锚点时的R.receipt。已有anchor但当前调用换了request时，以anchor里的原sessionRef/requestId/receipt还原原R，再按§2.3的`step='anchor'`、subjectKey=canonical完整RunRef推导原内部步身份，lookupCommit/eventAt回放原SessionAnomalyRecorded和原cursor；不能返回当前读水位冒充WriteResult.cursor。第一条anchor归属原R，后来的归档可引用它作为同Run异常事实，但必须另核自己R的权限/停止证据；不是任意新R都能借用第一条的中断豁免。没有可信回执定位返回unavailable，不新写第二条。新aggregate没有旧缺字段的合法版本，故该locator必填。

`lineHead` 是当时的头，事实不是永久 Line id。记录全量 RoleConfigurationRef；第 3 片从它解析职责显示，不在本片发明 `Role='copy'`。只保留路径，绝不保存文件正文。confirmed/possible 合计最多 64，去重、正斜线相对路径、字典序稳定；confirmed 优先，之后 possible 截断；剩余数在 omitted，reason 最多 2000 字符。无法覆盖整个 Kernel 读窗必须 partial；命令执行的效果不能自动升为 confirmed。

本草案采用 §7 T1 的推荐：**不存执行开始基线**。AgentRuntime 先复用 `continuation-brief-assembly.ts:readPreviousTurn` 和相同 selfChanged 提取；Kernel 不可读时复用 `execution-preparation.ts:briefWorkspaceFacts` 的当前 HEAD→worktree capture。第二路所有路径放 possible，confirmed=[]，`source='worktree'`、`runBaselineKnown=false`；显示固定说明“工作区里还没提交的改动，可能混有别的执行的改动，不一定是这次执行改的”。两路都拿不到→unknown/unavailable、两数组空、reason 非空，显示“改动未知”。正常无改动的已核 Kernel 窗口可以 known+空数组；unknown+空数组不能显示“没改文件”。正式证据已经证明not_entered时返回source=kernel/status=not_entered/confirmed=[]/possible=[]/omitted=0，不再用工作区其他改动污染这次执行。

`ArchiveRequeueOriginV1` 加为 `RequeueTaskInput.archiveOrigin?` 和 `TaskRequeueSnapshotV1.archiveOrigin?`，旧值 null。execution分支从durable request+anchor核验；wait分支从durable request+archiveWaitDisposition+精确旧Run的cancel intent核验，不需要伪造anchor。手动归档用原操作人的授权重新入队；平台自动归档用专用自动actor（见§3.4）。豁免只适用于这次归档导致的停止，或已有真实retired/interrupted证据。先前人工暂停/取消的工作不因此被自动继续。

### 2.7 接续说明及接手读法

```ts
export type ContinuationAnomalySectionV1 = {
  anchors: SessionAnomalyAnchorV1[]; omitted: number;
  instructionVersion: 1;
};
// ContinuationBriefV1 的可选新字段，缺省视为无该段；不补进旧 digest。
anomalies?: ContinuationAnomalySectionV1;
// RuntimeInputBindingV1 的可选新字段；新授权只在带段时保存实际装入的引用。
anomalyAnchorRefs?: SessionAnomalyAnchorRef[];
// ContinuationBasis 的可选新字段；真实生产 reader 始终返回。
pendingAnomalies?: SessionAnomalyAnchorV1[];
```

最多装入 8 条，按 recordedAt、canonical ref 升序；omitted=尚未装入的条数。brief 正文多 `### 异常锚点` 段，逐条列谁/Task/Run/原因/时间/路径/结果没核对；固定末句：“这些改动在工作区里，没撤销，也没核对；先看清它们再接着做。”现有 `renderedBytes=16384` 约束仍有效，至少保留每条装入锚点的 ref、原因、未知/混合归属警示和固定末句，可裁路径列表并加 omitted；保不住必需段就 `capacity`，不默默删段。

旧 brief 字节、marker、digest 不变；新 digest 包含 anomalies。shape checker 明确 optional key，存在则严校验。manifest rehydration 优先，重试不重新取锚点或工作区；授权校验 brief 内 refs 与 inputBinding 一致。尚无 `requeueRef` 的 Run 不被包装成假的 ContinuationBrief；锚点正常分支经真实 TaskRequeue 进入该段。【lead 改：L3】这个 Session 从没为该 Task 跑过执行时不写锚点（§0.2 L3）。

接手**派生**：Task 上查后续 Run，`inputBinding.anomalyAnchorRefs` 包含锚点、并有真实 `executionHistory`/entered 证明，且是别的 Session，则 pickedUpBy=最早实际进入的那个 Run（entered 时刻，平局 canonical ref）。claim、prepare、authorization、未进入取消都不算接手；omitted 的锚点不算接手。锚点记录永不改、不删。待接锚点>0时只读输出 `label='中断，待核对'`；继续提示由现有 phaseCause 判断：paused-interrupted→`等你点‘继续’`，可领取→`等待派工`，目标暂停/取消→现有目标停止原因。Task phase 不新增枚举。

### 2.8 六个索引和设置

本片推荐 **6 个新 lookup**：设计要求的3个Session相关索引、2个anchor索引，加1个replyHandler的技术索引（§7 T8）。不另存waiting、latestWork、lineId、pickedUpBy。Query的正式session在executionState内；Work claim从已有Outbox读取，不引入Run冗余locator和旧数据回填。

| ID / 常量 / name | aggregateType / paths（精确顺序） | 注册/业务 owner |
| --- | --- | --- |
| IDX-S1 / `SESSION_BY_PROVENANCE_LOOKUP` / `session-by-provenance` | Session / `['ref.projectId','workspaceId','provenance.from.sessionId']` | sessions/session-record-codecs |
| IDX-S2 / `WORK_EXECUTION_BY_SESSION_LOOKUP` / `work-execution-by-session` | DispatchOutboxEntry / `['claim.task.projectId','claim.workspaceId','claim.sessionRef.sessionId']` | tasks/claim-record-codecs；返回 claim.runRef |
| IDX-S3 / `QUERY_RUN_BY_SESSION_LOOKUP` / `query-run-by-session` | QueryRun / `['ref.projectId','ref.workspaceId','run.executionState.sessionRef.sessionId']` | queries/query-record-codecs 的 lookups；不再注册 QueryRun codec |
| IDX-S4 / `SESSION_ANOMALY_BY_TASK_LOOKUP` / `session-anomaly-by-task` | SessionAnomalyAnchor / `['ref.projectId','workspaceId','task.goalId','task.taskId']` | tasks/session-anomaly-codecs |
| IDX-S5 / `SESSION_ANOMALY_BY_GOAL_LOOKUP` / `session-anomaly-by-goal` | SessionAnomalyAnchor / `['ref.projectId','workspaceId','task.goalId']` | 同上 |
| IDX-S6 / `SESSION_REPLY_BY_HANDLER_LOOKUP` / `session-reply-by-handler` | SessionMessage / `['ref.projectId','ref.workspaceId','replyHandler.sessionRef.sessionId']` | sessions/message-record-codecs；communication读owner |

索引常量只在 `model/session-facts-contracts.ts` 声明一份供低层读取。SQLite注册expression index自动覆盖已有JSON；不写SQL migration。Outbox已有claim不用回填；Query无executionState不能猜Session。若Session.lastExecutionRef直接指向旧Query，这个既存精确关联可作为补充locator，与lookup结果按完整ref合并；更早无法定位的Query不虚构。零项只说明“没有可定位到这个Session的Query”，不是“从未有查询”。Work waiting只依完整Work claim/Run/消费事实判断，不能因Query缺字段把查实的Work等待吞掉或凭空阻塞整个facts读取。

Store lookup 是 canonical key 顺序，**不是时间倒序**；latest Work 取 max claim.generation，不取一页最后一条。内部事实读取每页100、最多25页；未读完返回 `incomplete/session_facts_page_limit`，不能返回 notWaiting。所有 lookup 候选用 canonical readMany 重核字段/水位。外部页 limit 1..100，opaque cursor 绑定 scope+过滤条件+查询类型，换条件用旧 cursor 返回 invalid。

新增可信配置（不是正式 aggregate，不增加 Host 设置 UI）：`SessionArchivePolicyV1`、`DEFAULT_SESSION_ARCHIVE_POLICY` 和下述 `SessionDutyResolver` 放 `src/business/workflow/ports.ts`，Workflow拥有行为、composition负责注入；`TargetPlatformOptions` 的两项放既有 `src/composition/create-platform.ts`。

```ts
export type SessionArchivePolicyV1 = {
  schemaVersion: 1;
  executorArchiveAfterMs: number;
  maintenancePageSize: number;
};
// DEFAULT_SESSION_ARCHIVE_POLICY =
// { schemaVersion: 1, executorArchiveAfterMs: 86_400_000, maintenancePageSize: 100 }
// TargetPlatformOptions.sessionArchivePolicy?: SessionArchivePolicyV1
```

数值必须 positive safe integer；pageSize 1..100。缺省沿用上述值；这是 Host 启动注入的数据，同 Host 已有 automation 配置模式，重启未配置仍为一天。以后项目设置写入口可注入同一 getter，不在第 1 片增设项目表或通用设置系统。secretary/adviser/scribe/reviewer、职责 unknown 的线，以及有开放 `module` 负责关系的线，不按这个阈值归档（【审查改】L4 之后没有 module-maintainer 职责）。

`SessionDutyResolver = (role: RoleConfigurationRef) => Promise<ReadResult<PlatformDutyV1 | 'unknown'>>`（【lead 改：L4】`PlatformDutyV1` 从 `src/contracts/platform-duty.ts` import，取值 `'executor' | 'secretary' | 'adviser' | 'scribe' | 'reviewer'`，没有 `module_maintainer`）是可信 Host/第 3 片接缝，不是模型输入、不存 Session 热切换字段。当前 Host 的普通 Work binding 明确标 executor；没有可信映射→unknown→不做一天自动归档，退役和 copy 规则照做。不能把所有同角色 Session 当 executor。

准确配置位置：`TargetPlatformOptions.sessionDutyResolver?: SessionDutyResolver`；生产装配传给 Workflow。没有显式resolver时，仅从 `WorkflowHostConfiguration.bindings[].sessionRole` 的完整canonical引用建立 executor 映射（这个 binding 的现有用途就是普通 Task Work），其他role返回unknown；有resolver时以它为准。解析成其他职责的role不能被普通binding覆盖。隔离配置时保留callback为可信函数，不JSON clone函数；policy作为纯数据复制并校验。

### 2.9 新事件、兼容默认和游标绑定

以下每个eventType以 `schemaVersion:1` 独立注册一次，没有新事件表；encode/decode沿 `sessions/lifecycle-record-codecs.ts:SessionLifecycleChangedEventV1` 的严格keys、outer selector与完整回放结果规则。没有这些eventType的老库无需迁移。已有 SessionCreated/Archived、TaskRequeued、消息事件的可选新增字段按§2.1兼容，老事件回放不被要求补一份新事件。

```ts
// sessions/lifecycle-record-codecs.ts
type Slice1EventHeaderV1 = {
  eventId: string; schemaVersion: 1; occurredAt: string;
  projectId: string; workspaceId: string;
};
export type SessionArchiveChangedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionArchiveRequested' | 'SessionArchiveRequestReleased';
  session: SessionRecord; archiveRequestId: string; reason: string;
};
export type SessionProvenanceBackfilledEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionProvenanceBackfilled'; session: SessionRecord;
  basis: LegacyProvenanceBasisV1;
};
export type SessionResponsibilityChangedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionResponsibilityChanged';
  mode: 'transfer' | 'drop' | 'terminal';
  source: SessionRecord; destination: SessionRecord | null;
  closed: PendingSessionWorkLink; opened: PendingSessionWorkLink | null;
  openedBound: 'since' | null;
  archiveStep: ArchiveStepRefV1 | null;
  taskBasis: { task: TaskTriple; planRef: PlanRevisionRef;
    terminalCause: 'satisfied' | 'cancelled' | 'superseded' | null;
    finishedAt: string | null };
};
// tasks/session-anomaly-codecs.ts；Header结构复制，不import sessions事件文件。
export type SessionAnomalyRecordedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'SessionAnomalyRecorded'; anchor: SessionAnomalyAnchorV1;
};
// sessions/message-record-codecs.ts注册；communication/mailbox-service.ts写入。
export type ArchiveWaitDisposedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'ArchiveWaitDisposed'; message: SessionMessage;
  source: SessionRecord; archiveStep: ArchiveStepRefV1;
};
```

责任事件的 closed.until 在payload中为null，回放只从原receipt.cursor绑定；新opened.since为null且openedBound=since，目标已经开放则保存原since、openedBound=null。除to-be-bound字段外，完整原值都在事件中。转移、drop、terminal各一次提交只发一个该事件，保证 `eventAt(cursor)` 能按现有方式读到完整结果。消息处置同次保存改变后的source Session，让source revision参与实际guard；source没有额外伪生命周期变化。

默认表：Session.provenance/archiveRequest→null；新创建输入缺provenance→不加fingerprint键、action规范化new；旧accepted action缺provenance→创建Record为null再取证；Message.replyHandler/archiveWaitDisposition→null；Requeue.archiveOrigin→null；旧ContinuationBasis.pendingAnomalies→[]（仅内存读取结果）；旧brief.anomalies/inputBinding.anomalyAnchorRefs→保持缺省键（读取视为无段/[]，不改旧hash）；policy缺省→一天/100；旧machine窄夹具的新上下文字段→未读取，不推断守卫成功。

## 3. 状态行、owner 和提交规则

### 3.1 状态位置与纯度

所有下列迁移/构造、派工排除和锚点标签归 `src/core/work-graph/state/`，接口沿用 `state/transition.ts:Transition` 的 `{ok,next,effects}`/`{ok:false,reason,code,detail}`。state 不取 now、不生成 id、不读 Store/Kernel/路径，不导入 model/persistence/sessions。shared 数据形状放 contracts；消息沿现有结构性副本，增加类型等价断言。

现有 `SES-* / TASK-* / MSG-* / RUN-*` ID 不重编号，新 ID 用 `S1-*`，以本文件为规则来源；迁移表列与 STATE-MACHINES-SPEC §1.4 一致。服务将失败映射 `CoreRejection`，拒绝无写；公开 metadata 校验先于回执，正常状态守卫在回执未命中后。

### 3.2 迁移表

表内 `CAS` 指相关实际记录的 RecordGuard；`R` 是 SessionArchiveRequest；`U` 只代表操作者类别，不能用 ActorRef.kind 判断。

| # | from | event | guard | to | effects | 幂等/重复事件 | 原文编号 | 现状 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1-SES-01 | absent | session_created(provenance) | accepted@1、映射唯一、合法 scope/前任；不允许 self/cycle | active/available/null @1 | createSessionRecord 写来历，完成 operation、初始 links同次提交 | 原创建回执 | Q3、§4.2 | 改造 sessions/session-directory.ts:recordSessionCreated |
| S1-SES-02 | provenance=null | legacy_provenance_backfilled | 旧数据且唯一可靠 basis；CAS Session；已有非null→revision_conflict；冲突证据→incomplete | 三维不变，rev+1 | 纯构造写一次 provenance；事件含 basis | 同Session/证据重放；不改已有事实 | AMB-1/2 | 新增 |
| S1-SES-03 | active，R=null，occupancy任意 | archive_requested | 合法 choices/原操作者；pin相等；已有不同R→busy；archived→invalid | 维度/occupancy不变，R非null，rev+1 | 记录完整请求及 SessionArchiveRequested | 同request重放受理结果，异内容 idempotency_conflict | 决定42、§4.5 | 新增 |
| S1-SES-04 | active，occupancy=null | session_archived | 先无占用→无开放task/work责任→不在等；退役免等待；CAS；未读取等待→incomplete | archived，R=null，rev+1 | archivedAt=now，SessionArchived，清R同次 | 原 final 回执；不得只返回当前记录 | AMB-3/4、§4.2 | 改造 state/session-availability.ts:archived |
| S1-SES-05 | archived | session_reactivated | 先已归档→health≠unavailable→无占用→pin；retired→unavailable，不改生命周期 | active，rev+1 | reactivateSessionRecord；健康保持原事实 | 原回执先于新守卫 | 决定38 | 改造 state/session-availability.ts:reactivated |
| S1-SES-06 | active，R非null | archive_request_released | 只能处置失败后显式重选；源执行已停、没有queued stop；id匹配/CAS；不能取消正在执行的归档 | R=null，rev+1，其余不变 | 清请求，不恢复已处置责任或已停止Run | 同身份回执 | AMB-3、§4.5 | 新增；失败修正入口 |
| S1-LINK-01 | 源开放负责link，目标link absent/closed/open | responsibility_transferred | 源对应任务旧写者已停止；跨scope forbidden；退役/copy/archiving目标 unavailable；合法target；CAS双方Sessions/links/Task basis | 源closed；目标open | state/session-responsibility 构造两link、两Session；since/until绑定同cursor | 原结果含双方；source已closed且无receipt→invalid | §4.4、Q1 | 新增 |
| S1-LINK-02 | 开放负责link | responsibility_released | mode=drop 或 trusted terminal proof；在跑旧写者→busy；未知任务→incomplete；CAS | closed | until=cursor、Session rev+1；不改Task disposition/phase | 原关闭回执；与旧link方法保持closed拒绝语义 | 推出2、Q1 | 新增（原linkSessionWork可复用关闭） |
| S1-DISPATCH-01 | active/available/null | work_selected/work_claimed | provenance不是copy、R=null、不在等；只允许确切同Task/Run/message的 consumedWait 例外；不满足→busy；copy→forbidden | 原选择/正常SES-02 | 不存可派工状态；claim同次guard Session和等待Run | claim原回执优先 | Q19/Q20、决定42 | 改造 workflow:chooseSession / tasks/claim-service |
| S1-DISPATCH-02 | active/available/null | query_claimed | R=null、不在Work等待；copy仅允许自己固定的consultation Query，其他forbidden；pins仍先按现有Query顺序核 | 正常SES-03 | 原claim记录/占用 | 原Query回执 | §4.7、Q20 | 改造 queries/query-execution.ts:claim |
| S1-MSG-01 | 原等待消息任意未消费状态 | reply_handler_transferred | R匹配、原wait精确、目标同scope非copy/retired/archived/archiving；message pin、两个Session及Run CAS；已接受response→busy | status/response不变，handler非null | 消息rev+1、源Session bump；事件保存完整消息 | 原事件结果；同原wait已有同handler不再改 | AMB-27、决定42乙(a) | 新增 |
| S1-MSG-02 | 未被处置的原等待消息 | archive_wait_cancelled | R匹配、原wait未消费；message+Run+Session CAS | archiveWaitDisposition=cancel；status不变 | 消息rev+1、源Session bump；随后既有submitControl cancel | 处置回执；不生成假response | §4.5/4.6 | 新增 |
| S1-ANCHOR-01 | absent | archive_anomaly_recorded | Work有停止/认定证明；Task未终结；R对应Run/attempt；CAS Run/Session/request与anchor absent | anchor@1 immutable | newSessionAnomalyAnchorRecord + SessionAnomalyRecorded | 同Run返回原anchor；不能改内容 | 决定42、§4.5 | 新增 |
| S1-ANCHOR-02 | absent | retired_anomaly_recorded | Session退役、无同线continuation、所负责Task未完、有真实该Session的Run；占用已释放；CAS事实 | 同上，cause=retired_archive | 同上；原paused围栏不变 | 同Run至多一条 | 决定42第2条 | 新增；【lead 改：L3】这个Session从没为该Task跑过执行时不写锚点，只放下负责关系（IT33） |
| S1-TASK-01 | 归档停止后可重新入队的Task | archive_task_requeued | 先known/reconciled/lease已释放→原Task当前且Goal可行动→持久R及anchor或精确wait处置授权→现有permission/no-progress；原paused继续仍需人 | 现有TASK-16/17/27结果 | 真实TaskRequeue；archiveOrigin；failureClass=interrupted；不增加自动次数 | 原TaskRequeue按afterRun唯一；已被覆盖就复用原事实 | 决定43、硬限制3 | 改造 requeue-service、task-failure/task-machine |
| S1-TASK-02 | 有pending anchor的Task | read_anomaly_view | 纯读已核状态和实际entered消费ref | 不存phase；label=中断，待核对 | 无写；pickedUpBy从后续Run派生 | 读取不启模型、不写anchor | §4.5、E3 D42-2 | 新增 state/session-anomaly.ts |
| S1-AUTO-01 | executor active/空闲/无未完责任/不在等 | executor_archive_due | 有末次终结Task时间、now≥finishedAt+阈值；unknown职责/无任务/占用→no_op | 经S1-SES-03/04 archived | 组合动作；不新增timer | 同Session+该finishedAt身份；新Task使CAS失败/重新计时 | 决定38、§4.5 | 新增 Workflow维护；纯due函数 |
| S1-AUTO-02 | active/退役/null | retired_archive_due | 有continuation→仅处理已转走责任；无continuation→未完Task放下、anchor、原paused不requeue；等回复免处置 | archived/retired | 组合动作；原消息不改/不自动转交 | 一步一回执 | 决定38/42、AMB-4/43 | 新增；占用未知见§0.1 U1（冻结为跳过，记入failures） |
| S1-AUTO-03 | copy，Query answered，occupancy=null | copy_archive_due | 正式Answer已保存且附回原消息，输入接受已确认；仍occupancy/未答→busy | archived | 组合动作；source不变 | response关联、final archive均独立回执 | Q2、§4.7 | 新增 consultation末步 |

补充拒绝表（每项 0 提交）：

| 检查 | CoreRejection.code / reason 前缀 |
| --- | --- |
| 错误引用/选择缺项/非法limit/假确认 | invalid / `archive_disposal_required:`、`archive_input_invalid:` |
| 主体/项目/工作区不符，Agent调用归档接口 | forbidden / `archive_scope:`、`archive_host_only:` |
| readMany/codec/Kernel技术读取损坏 | unavailable / 保留原细节；文件读取失败仅落unknown，不阻止anchor |
| 事实没有读全、无法证明未等待/Task关联 | incomplete / `session_facts_page_limit:`、`work_responsibility_unresolved:` |
| 仍占用/仍等待/缺unknown人工确认/旧写者未停 | busy / `archive_execution_pending:`、`archive_wait_disposal_required:`、`archive_unknown_confirmation_required:` |
| CAS失败 | revision_conflict / current含真正冲突记录；不写泛化“归档成功” |
| 同身份异内容 | idempotency_conflict / 沿原Store映射 |
| predecessor循环 | cycle / `session_provenance_cycle:`；缺前任 not_found；不是busy |

### 3.3 精确 owner 签名及依赖归属

以下是新增/扩展签名；实现可有 private helper，不能另造门面或让 Host 持有 Store 更新事实。`GraphWrite` 用现有类型，`PageRequest=SessionPageRequest`、`Page<T>=SessionPage<T>`；接口类型放 model/shared，状态类型仍在 state。

```ts
// model/session-facts-contracts.ts，实现 tasks/session-facts.ts（【lead 改：L1】）
export type SessionWorkWaitV1 = { runRef: RunRef; messageRef: SessionMessageRef; task: TaskTriple };
export type SessionFactsV1 = {
  session: SessionRecord; latestWork: TaskClaim | null; wait: SessionWorkWaitV1 | null;
  predecessor: SessionProvenanceV1 | null; continuations: SessionRef[];
  legacyPending: boolean; sourceCursor: CommitCursor;
};
export interface SessionFactsPort {
  readSessionFacts(ctx: CoreCallContext, sessionRef: SessionRef): Promise<ReadResult<SessionFactsV1>>;
  listSessionExecutions(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<TaskClaim>>>;
  listSessionQueries(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<QueryRunSnapshot>>>;
  findSessionSuccessors(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
    Promise<ReadResult<SessionPage<SessionRecord>>>;
}
// sessions/lifecycle-contracts.ts，实现 session-lifecycle.ts
requestSessionArchive(ctx: CoreCallContext, request: GraphWrite<RequestSessionArchiveInput>):
  Promise<WriteResult<SessionRecord>>;
readSessionArchiveRequestReceipt(ctx: CoreCallContext, request: GraphWrite<RequestSessionArchiveInput>):
  Promise<ReadResult<{ session: SessionRecord; cursor: CommitCursor }>>;
finishSessionArchive(ctx: CoreCallContext, step: ArchiveStepRefV1): Promise<WriteResult<SessionRecord>>;
releaseSessionArchiveRequest(ctx: CoreCallContext, request: GraphWrite<{
  sessionRef: SessionRef; archiveRequestId: string; reason: string;
}>): Promise<WriteResult<SessionRecord>>;
// sessions/session-directory.ts，Host-only旧数据补齐
backfillSessionProvenance(ctx: CoreCallContext, request: GraphWrite<{
  sessionRef: SessionRef; provenance: SessionProvenanceV1; basis: LegacyProvenanceBasisV1;
}>): Promise<WriteResult<SessionRecord>>;
// sessions/session-responsibility-service.ts，负责关系写owner仍为sessions。
transferSessionResponsibility(ctx: CoreCallContext, request: GraphWrite<{
  from: SessionRef; to: SessionRef; target: WorkLinkTarget;
}>): Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>>;
disposeArchiveResponsibility(ctx: CoreCallContext, step: ArchiveStepRefV1):
  Promise<WriteResult<{ closed: SessionWorkLink; opened: SessionWorkLink | null }>>;
closeTerminalResponsibility(ctx: CoreCallContext, request: GraphWrite<{
  sessionRef: SessionRef; target: WorkLinkTarget;
}>): Promise<WriteResult<SessionWorkLink>>;
// model/session-facts-contracts.ts；可信窄事实接口，由composition注入，不从HTTP接收。
export type SessionResponsibilityBasisV1 = {
  task: TaskTriple; planRef: PlanRevisionRef;
  terminal: boolean; finishedAt: string | null;
  terminalCause: 'satisfied' | 'cancelled' | 'superseded' | null;
  sourceRun: RunSnapshot | null; writerStopped: boolean;
  guards: readonly RecordGuard[]; sourceCursor: CommitCursor;
};
export interface SessionResponsibilityBasisPort {
  readResponsibilityBasis(ctx: CoreCallContext, input: {
    sessionRef: SessionRef; target: WorkLinkTarget;
  }): Promise<ReadResult<SessionResponsibilityBasisV1>>;
}
// tasks/plan-readers.ts；沿readCanonicalTaskFacts，读窗口和guard都由tasks提供。
export function createSessionResponsibilityBasisReader(
  records: GoalRecordTransactionPort & RecordLookupPort,
): SessionResponsibilityBasisPort;
// model/session-facts-contracts.ts；旧来历可信取证接口，不是用户输入。
export interface LegacySessionProvenancePort {
  deriveLegacySessionProvenance(ctx: CoreCallContext, sessionRef: SessionRef): Promise<ReadResult<{
    provenance: SessionProvenanceV1; basis: LegacyProvenanceBasisV1;
    guards: readonly RecordGuard[]; sourceCursor: CommitCursor;
  }>>;
}
// tasks/session-provenance-facts.ts；tasks可依赖queries/sessions，不反向import。
export function createLegacySessionProvenanceReader(
  records: GoalRecordTransactionPort & RecordLookupPort, facts: SessionFactsPort,
): LegacySessionProvenancePort;
// tasks/session-anomaly-service.ts
recordSessionAnomaly(ctx: CoreCallContext, input: { step: ArchiveStepRefV1; files: ArchiveChangedFilesV1 }):
  Promise<WriteResult<SessionAnomalyAnchorV1>>;
listSessionAnomalies(ctx: CoreCallContext, input: {
  goalRef: GoalRef; taskId?: string; page: SessionPageRequest;
}): Promise<ReadResult<SessionPage<SessionAnomalyViewV1>>>;
readTaskArchiveState(ctx: CoreCallContext, task: TaskTriple): Promise<ReadResult<{
  pending: SessionAnomalyViewV1[]; label: '中断，待核对' | null;
  next: { kind: 'dispatch' } | { kind: 'human_continue' }
    | { kind: 'goal_stopped'; desiredState: 'paused' | 'cancelled' }
    | { kind: 'rework_blocked'; code: TaskReworkRefusalCode } | null;
}>>;
// communication/mailbox-service.ts
disposeArchiveWait(ctx: CoreCallContext, step: ArchiveStepRefV1): Promise<WriteResult<SessionMessage>>;
readUndeliveredReplies(ctx: CoreCallContext, input: { sessionRef: SessionRef; page: SessionPageRequest }):
  Promise<ReadResult<SessionPage<UndeliveredReplyV1>>>;
readRoutedReplies(ctx: CoreCallContext, input: { handler: SessionRef; page: SessionPageRequest }):
  Promise<ReadResult<SessionPage<SessionMessage>>>;
// agent-runtime/ports.ts；实际Runtime工厂发布，可选只为旧narrow doubles兼容。
readArchiveChangedFiles?(ctx: CoreCallContext, input: { runRef: RunRef }): Promise<ReadResult<ArchiveChangedFilesV1>>;
```

依赖具体加法：`SessionLifecycleStores.sessionFacts?:SessionFactsPort`（【lead 改：L1】由 composition 注入 `tasks/session-facts.ts` 的实现；缺它时 requestSessionArchive、finishSessionArchive、releaseSessionArchiveRequest 回 `unsupported`，旧入口不变；`lastExecutionRef===null` 的从未领取快路照旧）；`SessionDirectoryStores.legacyProvenance?:LegacySessionProvenancePort`（只影响backfill，缺它返回unsupported）；新责任service的stores含必需 `basis:SessionResponsibilityBasisPort`；新anchor service的stores含records/lookups/sessionFacts和 `now:()=>string`。WorkflowDependencies追加可选窄端口 `sessionLifecycle`、`sessionFacts`、`responsibilities`、`sessionAnomalies`、`controls:RunControlPort`、`archivePolicy:SessionArchivePolicyV1`、`sessionDuty:SessionDutyResolver`，真实composition全部装配，未装的旧doubles只有新归档/维护入口unsupported，原advance不得默默宣称维护通过。【lead 改：L1】`tasks/claim-service.ts` 直接用同子模块的 `tasks/session-facts.ts`；`queries/query-execution.ts` 经新加的可选依赖 `sessionFacts?: SessionFactsPort` 注入（composition 必装；缺它时 Query 领取维持旧行为，只为旧的窄测试替身）。直接claim不能因Workflow没装就绕过排除。

Workflow的controls/runtime依赖实际调用既有submitControl/deliverControl/resolveUnknownRun；Host只能经Workflow组合入口。`SESSION_ARCHIVE_AUTOMATION_ACTOR` 在contracts/task-requeue.ts的准确类型为 `Readonly<{kind:'system';id:'workflow:session-archive'}>`，Object.freeze后加入已有PLATFORM_AUTOMATION_ACTORS。所有新时刻由owner注入now获取，未注入沿现有new Date().toISOString；测试用同一固定clock或vi.setSystemTime，state不碰clock。

其中resolveUnknownRun**不在RuntimeExecutionPort上**。WorkflowDependencies单独注入 `attestUnknownRun?: (ctx:CoreCallContext, request:GraphWrite<{runRef:RunRef;reason:string}>)=>Promise<WriteResult<RunSnapshot>>`，绑定 `composition/create-platform.ts:resolveUnknownRun` 的既有Host包装，它先readAttestationFacts、核instance lease再调用WorkGraph reconcile owner。不把KernelTurnOpen/退出证明作为浏览器输入，也不在slice1新增一套认定。

Query同理注入 `attestUnknownQueryRun?: (ctx:CoreCallContext, request:GraphWrite<{queryRunRef:QueryRunRef;reason:string}>)=>Promise<WriteResult<QueryExecutionRecord>>`，绑定同文件已有resolveUnknownQueryRun；只有R.confirmUnknownStopped来自该次人工确认且Query正式unknown时可调用。QueryExecutionRecord沿 `queries/contracts.ts` 既有类型，不放进state。两种认定的原expected从R.executionPins取，不能重新取当前revision后重用相同请求身份。

【lead 改：L1】`tasks/session-facts.ts` 直接用 `tasks/claim-record-codecs.ts:decodeDispatchOutboxEntry` 读 Outbox；QueryRun 用 `materials/record-readers.ts:validateQueryRunSnapshot` 验证 EncodedRecord，通过后才 parse 成 QueryRunSnapshot 并核引用/scope；Run 用 `materials/run-snapshot-decoder.ts:decodeRun`。不搬任何 codec，不新建 persistence 文件，不加第二个 QueryRun codec。sessions 和 queries 只经 model 的 `SessionFactsPort`（composition 注入）拿这些事实，不 import tasks。不裸 JSON.parse 当可信领域对象。

Work waiting 精确定义：最近 Work claim 对应 Run outcome=yielded、有 continuation、没有 cancel 控制指针、没有后继 Run 通过 consumedWait 消费该 Run/message。即使 response 已保存但还没用也在等。cancel指针/合法消费使等待结束；普通 Query 不覆盖 latestWork。由于 generation 严格递增，默认可用同 Session 的后继 claim识别消费；跨Session移交必须有已提交的旧wait cancel，不需要反向全图查。未知/缺Run/未终止页→incomplete。所有 request/claim最终guard同一Session revision，防读完“不在等”又yield的竞态。`lastExecutionRef===null` 的从未领取Session可直接证明没有Work等待（任意实际claim均在同次occupy更新该字段），无需调用缺少执行schema的窄Session夹具里的lookup；其他情况不走这个快路。

### 3.4 服务检查顺序、授权和回执

公共写固定次序：同步隔离 caller/request（signal不clone）→可信 principal/scope/shape/expected键集合→完整稳定 fingerprint→`lookupCommit`→canonical读窗→按表守卫→state→同一 PreparedCommit的records/events/guards/cursor bindings→abort再查→commit→回放原事件。拒绝/竞争后沿 `session-lifecycle.ts:recheckLifecycleAfterMiss` **只重查一次同身份回执**，不是无限重试。回执回放用事件里的原结果，核cursor、eventId、ref、revision，不返回新状态冒充原结果。

跨记录 owner 检查顺序：

| owner | 回执未命中后的次序 / 必需guards |
| --- | --- |
| requestSessionArchive | 先稳定input/meta查回执；未命中再Session existence/scope→pin→occupancy/SessionFacts确定execution（Work claim补attempt）和原wait执行pins→request机器；guard Session/精确claim/对应Run与QueryRun；生成时间、操作者和receipt；Task选择由Workflow先核，本owner不读Task状态 |
| finishSessionArchive | request id/authority→Session active/nooccupancy→links→readSessionFacts“不在等”或退休例外→机器；guard Session及读到的wait Run/links；query/read失败不能算idle |
| transfer/close责任 | 双Session scope/lifecycle→旧link开放和pin→Task当前成员/终结证据→旧Task写者无占用/真实停止→机器；guards双方Session/link、Goal/Plan/Lease/Run/Reduction用到的版本 |
| disposeArchiveWait | 读持久R得到原选择→回执→原wait/消息/target→scope→response未接受→机器；guards消息、Run、source/dest Session；不修改正文/期限 |
| recordSessionAnomaly | 稳定Step+Run身份→回执/已有anchor→读R/claim/Run/Task→已停/未完/同scope→机器；guard anchor absent+R的Session+Run+采用Task证据；files只作为Runtime事实，不授权 |
| requeueTask(archiveOrigin) | 原requeue回执→原known/reconciliation/lease/session释放守卫→R/anchor真实性和匹配取消intent→原Goal/Task/fence→豁免归类→原Task机器/no-progress→commit；不因anchor绕过未知结果 |
| backfill | 原回执→Session nullprovenance→可信basis逐项验证→cycle/scope→state→commit；null→new也记录来源判断 |

内部恢复步先从持久请求确认权限；回执身份用原 requestedBy，而当前 Host 的 lease/权限仍要核。禁止从外部 JSON 设置“以用户名义”。Workflow 只把原人工归档的真实 durable request作为授权证明传给 owner，owner核验后才能在事件 `requestedBy` 记录原人。自动维护 actor 固定 `{kind:'system',id:'workflow:session-archive'}`，加进明确的 `PLATFORM_AUTOMATION_ACTORS`；不能把所有 system actor都当平台自动化。

对于 archiveOrigin，`deriveReworkClass` 的新增可选 ctx仅取已核锚点及停止事实，优先保持原 FC-1/FC-2未停止/未知和paused围栏，再把本次归档cancel映射 interrupted/executing。`nextRequeueAutoCount`：人工仍按原规则 automatic=false、counted=false、autoCount=0、cap=null；平台退休 interrupted为 automatic=true、counted=false、autoCount保持prior、cap=当前cap。不能增加次数，也不能允许攻击者用随便一个anchor豁免普通失败。原TaskRequeue已覆盖该Run→复用已有记录，不补写/改写旧记录。新增actor同时进入 `stopRequesterOf` 的精确id分支，不改变其他system操作人的原有human归类。原人为human的归档cancel围栏，仅该匹配durable R的同一次requeue可用原授权通过；先前任何暂停/取消围栏保持原语义。

责任提交归sessions：`createSessionResponsibilityBasisReader` 在tasks用已有 canonical Task读窗生成事实及RecordGuard，经model的窄Port由composition注入sessions。sessions核scope、重读双方Session/link，并把proof.guards与自身guards合入同次commit；这个callback只有可信composition能装配，public API不能携带terminal/writerStopped布尔证明。这样不复制Task完成算法，也不产生sessions→tasks导入边。`work` target目前沿 `sessions/session-targets.ts` 仍没有正式WorkContext写/read闭环；保存过但无法映射的work负责link按已定incomplete保留，不能虚构WorkContext→Task映射或扩这个历史unsupported边界。

### 3.5 纯state新增类型、函数和effects

来历取证算法由 `tasks/session-provenance-facts.ts` 实现：这里能用已有 `queries/query-record-codecs.ts:decodeQueryJobSnapshot`、`tasks/claim-record-codecs.ts:decodeTaskRequeueSnapshot` 和sessions的message/creation codec。sessions的backfill只调用可信model Port，再对derive结果与输入逐字段比对并合入全部guards；不反向import这些codec、不裸parse历史证明。Workflow维护分页调用backfill，完整线投影仍后片做。这个reader只有读，没有调度和第二份事实；consultation取证查固定messageDerivation，creation用§2.2的eventAt路径，无事件扫描。

旧copy发现还需覆盖“已建child、Query尚未claim”的窗口：provenance reader按既有workspace Session lookup和各sender-session Message lookup读固定consultationDerivation.childSessionRef，在有界完整窗里找这个child，而不只看Query.executionState。预算未读完返回incomplete；已找到的copy可直接证明排除。Workflow挑到provenance=null的候选先补齐、重读新revision再构造claim；直接Work/Query claim通过可信legacy reader取得同一有效provenance及guards再交state（Query经model窄Port注入，不能import tasks）。没有完整可靠结果拒incomplete，不能把null默认为可派活。普通新admission已写new，旧窄夹具的正式新创建路径不用做这次历史扫描。

能力豁免的证据比“有anchor”更窄：普通failed/budget_exhausted/check_failed已经发生，之后Session才退休，不能凭retired_archive锚点把普通失败改为interrupted。只有本次R的cancel、archive_wait_cancel或真实interrupted_clean/人工认定停止证据对应到该Run，才传VerifiedArchiveInterruptionV1；其余走原分类、cap/no-progress，归档本身仍可完成。重入队被原cap拒绝不回滚anchor/放下，也不阻止已经没有占用/责任的退休线最终归档；结果保留原refusal供读。

以下是冻结后的具体签名。旧SessionEvent/Effect/DomainEventType union追加分支，不改已有分支的discriminant；MessageEvent使用现有 `type`，不能改成Session的 `kind`。state里的证明均为owner读出的值，不含port、RecordGuard或函数。

```ts
// state/session-availability.ts：给现有非absent SessionMachineState追加可选字段。
provenance?: SessionProvenanceV1 | null;
archiveRequest?: SessionArchiveRequestV1 | null;
// sessionMachineStateOf始终填入；旧窄夹具缺省读作null。
export type SessionArchiveGuardV1 = {
  requestMatches: boolean; choicesValid: boolean; authorityValid: boolean;
  wait: 'not_read' | 'not_waiting' | 'waiting'; retired: boolean;
  sourceExecutionStopped: boolean; stopQueued: boolean; failedDisposal: boolean;
  provenanceBasisValid: boolean;
};
export type SessionDispatchGuardV1 = {
  purpose: 'work' | 'query'; waiting: 'not_read' | SessionWorkWaitStateV1 | null;
  consumedWait: SessionWorkWaitStateV1 | null; readonlyQueryMatches: boolean;
  legacyProvenance: SessionProvenanceV1 | null;
};
// 结构性定义，与model的SessionWorkWaitV1等价；禁止state import model。
export type SessionWorkWaitStateV1 = {
  runRef: RunRef; messageRef: SessionMessageRef; task: TaskTriple;
};
// SessionGuardContext追加：archive?: SessionArchiveGuardV1;
// dispatch?: SessionDispatchGuardV1；相关新event缺ctx拒incomplete，旧release不读取。
export type Slice1SessionEvent =
  | { kind: 'archive_requested'; archive: SessionArchiveRequestV1 }
  | { kind: 'archive_request_released'; archiveRequestId: string }
  | { kind: 'legacy_provenance_backfilled'; provenance: SessionProvenanceV1 };
export type Slice1SessionEffect =
  | { kind: 'write_archive_request'; archive: SessionArchiveRequestV1 }
  | { kind: 'clear_archive_request' }
  | { kind: 'write_session_provenance'; provenance: SessionProvenanceV1 };
// 追加到现有SessionEvent、SessionEffect及emit_event闭合union；不注册独立第二台Session机器。
export function requestSessionArchiveRecord(
  session: SessionRecord, archive: SessionArchiveRequestV1,
): SessionRecord;
export function releaseSessionArchiveRequestRecord(session: SessionRecord): SessionRecord;
export function backfillSessionProvenanceRecord(
  session: SessionRecord, provenance: SessionProvenanceV1,
): SessionRecord;
export function sessionDispatchAdmissionProblem(
  session: SessionRecord, facts: SessionDispatchGuardV1,
): Rejected | null;
export function executorArchiveDue(input: {
  duty: 'executor' | 'other' | 'unknown'; session: SessionRecord;
  unfinishedResponsibility: boolean; waiting: boolean;
  openModuleResponsibility: boolean; // 【lead 改：L4】为 true 时恒返回 false（模块维护的线不自动归档）
  finishedAt: string | null; now: string; thresholdMs: number;
}): boolean;

// state/session-responsibility.ts
export type PendingResponsibleLinkV1 = Omit<SessionWorkLink, 'since'> & {
  since: CommitCursor | null;
};
export type ResponsibilityStateV1 = {
  source: SessionRecord; destination: SessionRecord | null;
  sourceLink: SessionWorkLink | null; destinationLink: SessionWorkLink | null;
};
export type ResponsibilityEventV1 =
  | { kind: 'responsibility_transferred'; to: SessionRef }
  | { kind: 'responsibility_released'; mode: 'drop' | 'terminal' };
export type ResponsibilityGuardV1 = {
  sameScope: boolean; targetValid: boolean; taskTerminal: boolean;
  writerStopped: boolean; destinationEligible: boolean; pinsMatch: boolean;
};
export type ResponsibilityEffectV1 = {
  kind: 'write_responsibility'; source: SessionRecord; destination: SessionRecord | null;
  closed: PendingResponsibleLinkV1; opened: PendingResponsibleLinkV1 | null;
  openedBound: 'since' | null;
} | { kind: 'emit_event'; eventType: 'SessionResponsibilityChanged' };
export type PendingResponsibilityStateV1 = Omit<ResponsibilityStateV1, 'sourceLink' | 'destinationLink'> & {
  sourceLink: PendingResponsibleLinkV1 | null; destinationLink: PendingResponsibleLinkV1 | null;
};
export function transitionResponsibility(
  state: ResponsibilityStateV1, event: ResponsibilityEventV1, ctx: ResponsibilityGuardV1,
): Transition<PendingResponsibilityStateV1, ResponsibilityEventV1, ResponsibilityEffectV1>;
// next未绑定link不以as伪造已绑定cursor；owner在同次提交绑定后返回SessionWorkLink。

// state/session-anomaly.ts
export type NewSessionAnomalyInputV1 = Omit<SessionAnomalyAnchorV1, 'revision' | 'schemaVersion'>;
export type AnomalyEventV1 = { kind: 'record'; input: NewSessionAnomalyInputV1 };
export type AnomalyGuardV1 = {
  execution: 'work' | 'query'; stopped: boolean; taskTerminal: boolean;
  sameScope: boolean; requestMatches: boolean;
};
export type AnomalyEffectV1 =
  | { kind: 'write_anchor'; anchor: SessionAnomalyAnchorV1 }
  | { kind: 'emit_event'; eventType: 'SessionAnomalyRecorded' };
export function newSessionAnomalyAnchorRecord(input: NewSessionAnomalyInputV1): SessionAnomalyAnchorV1;
export function transitionSessionAnomaly(
  state: 'absent' | SessionAnomalyAnchorV1, event: AnomalyEventV1, ctx: AnomalyGuardV1,
): Transition<'absent' | SessionAnomalyAnchorV1, AnomalyEventV1, AnomalyEffectV1>;
export function deriveSessionAnomalyView(
  anchor: SessionAnomalyAnchorV1,
  entered: readonly { runRef: RunRef; sessionRef: SessionRef; enteredAt: string;
    anchorRefs: readonly SessionAnomalyAnchorRef[] }[],
): SessionAnomalyViewV1;
// label由pending数与现有Task phaseCause/Goal desiredState纯读算出，不另存Task状态。【审查改】纯函数如下；readTaskArchiveState（§3.3）只读出输入再调它。
export type TaskArchiveNextV1 = { kind: 'dispatch' } | { kind: 'human_continue' }
  | { kind: 'goal_stopped'; desiredState: 'paused' | 'cancelled' } | { kind: 'rework_blocked'; code: TaskReworkRefusalCode };
export function deriveTaskArchiveState(input: {
  views: readonly SessionAnomalyViewV1[]; // 这个 Task 的全部锚点，各自先经 deriveSessionAnomalyView
  goalDesiredState: GoalDesiredState; phaseCause: TaskPhaseCauseV1 | null; // contracts/ledger.ts、contracts/task-failure.ts
  reworkRefusal: TaskReworkRefusalCode | null; claimable: boolean; // 本次归档重新入队的正式拒绝码；owner 按现有 eligibility 读出的“现在可领取”
}): { pending: SessionAnomalyViewV1[]; label: '中断，待核对' | null; next: TaskArchiveNextV1 | null };
// pending = views 里 pickedUpBy===null 的项（顺序不变）。pending 为空 → label=null、next=null。否则 label='中断，待核对'，next 取下面第一个成立的：
// goalDesiredState!=='active' → goal_stopped；phaseCause?.code==='paused_interrupted' → human_continue；reworkRefusal!==null → rework_blocked；claimable → dispatch；都不成立 → null。

// state/task-failure.ts：追加可选第四参数，旧三参调用行为逐字不变。
export type VerifiedArchiveInterruptionV1 =
  | { kind: 'execution'; anchorRef: SessionAnomalyAnchorRef; runRef: RunRef;
      cause: 'archive_cancel' | 'retired_interruption' }
  | { kind: 'wait'; runRef: RunRef; messageRef: SessionMessageRef; cause: 'archive_wait_cancel' };
export function deriveReworkClass(
  run: RunSnapshot, pointerIntent: StopIntentV1 | null, chain: RoundChainHeadV1,
  archive?: VerifiedArchiveInterruptionV1 | null,
): ReworkClassDerivationV1;
// 新class.row追加'S1-FC-ARCHIVE'，failureClass='interrupted'，interruption='executing'。
```

消息机器新增 `MessageEvent` 分支 `{type:'archive_wait_disposed'}`；`MessageGuardContext.archiveWait?` 精确类型为 `{choice:ArchiveWaitChoiceV1; archiveSessionRef:SessionRef; archiveRequestId:string; now:string; requestMatches:boolean; waitMatches:boolean; targetEligible:boolean; responseAccepted:boolean}`。effect用现有write_message，change union追加 `archive_wait_disposed`；`SessionMessageChange` 追加 `{kind:'archive_wait_disposed'; choice:ArchiveWaitChoiceV1; archiveSessionRef:SessionRef; archiveRequestId:string; now:string}`，原构造器从change写新handler/disposition。transfer同时写kind=transfer的archiveWaitDisposition；cancel保持原handler。emit eventType追加ArchiveWaitDisposed，old respond/read/accept规则保持。

`state/run-machine.ts` 只给已有授权ctx追加 `anomalyRefsMatch?: boolean`：旧brief无段时视为true；新brief有段必须明确true，否则invalid。函数签名仍是已有transitionRun，不新增entered生命周期；实际inputBinding只在已有authorize构造器写。archive取消不修改Run.outcome成新的枚举。state due函数输入的“完成时间”和retired/no-continuation事实全部来自owner可信读窗，不自己读Store。

实际caller在 `tasks/execution-entry-service.ts:continuationBriefVerdict` 所在授权组装：将manifest.anomalies实际装入refs与inputBinding.anomalyAnchorRefs规范排序后相等传给state。`persistence/execution-entry-codecs.ts:inputBindingProblem` 严校验可选refs（完整ref、最多8、无重复）；旧无字段继续通过。漏改实际caller/shape checker时，Runtime新段仍不能获得正式授权，因此两文件均列入清单。

## 4. Workflow、Runtime 与路由

### 4.1 归档组合入口与返回值

新 `business/workflow/session-archive.ts`，由 WorkflowPort 发布（optional兼容旧doubles，真实composition必装）：

```ts
export type ArchiveLineInput = Omit<RequestSessionArchiveInput, 'mode'>;
export type ArchiveStepReceiptV1 = {
  step: ArchiveStepRefV1['step']; subjectKey: string; cursor: CommitCursor; replayed: boolean;
};
export type ArchiveLineResultV1 = {
  state: 'archived' | 'pending' | 'partial';
  session: SessionRecord;
  receipts: ArchiveStepReceiptV1[];
  pendingOn: ExecutionRef | null;
  rejection: CoreRejection | null;
  requeueRefusals: TaskReworkRefusalSnapshotV1[];
  message: '已归档' | '归档中' | '归档中 · 停止中' | '处置已完成，归档没成功';
};
archiveLine(ctx: CoreCallContext, request: GraphWrite<ArchiveLineInput>):
  Promise<ReadResult<ArchiveLineResultV1>>;
continueArchiveLine(ctx: CoreCallContext, input: { sessionRef: SessionRef; archiveRequestId: string }):
  Promise<ReadResult<ArchiveLineResultV1>>;
```

返回外层 ready 意味着能读到组合结果，**不代表已归档**。零子提交的输入/权限错误直接 CoreRejection；已有处置后失败为 ready/state=partial，携带原rejection和已提交receipts，message精确用上表文案。pending结果保留R；不返回 archivedAt。完成结果R=null且lifecycle=archived。整个组合不造一个跨系统commit cursor；每个receipt含自己的真实cursor。受理请求的原回执可独立重放，组合入口同request重来时继续做剩下的步，不能只重放第一次pending结果便永远停住。

入口顺序（所有有依赖步骤串行）：

1. 隔离input/principal/scope/shape，meta.expected恰一个Session pin；先 `readSessionArchiveRequestReceipt`。命中取其原R/receipt接着恢复，不先用当前版本拒绝老请求；未命中才读SessionFacts、开放责任、当前Task图，核真实pin、选择和unknown确认，缺项零提交拒绝。原archived Session只有这个原请求的回执能重放原final，否则invalid。
2. 持久 request，立刻排除该Session的新领取。
3. Work：先用既有 `RunControlPort.submitControl`提交cancel，再马上 `RuntimeExecutionPort.deliverControl`；未进入走现有RUN-09当场释放，已进入停安全点；仍在跑→pending/停止中。未知结果只能有明确人工confirm才能走现有 `resolveUnknownRun`（Host持实例lease），结果不明不能由平台自动认定。停止后再看事实，即使callback返回失败也不重发新intent。
4. Query：不cancel、不pause、不写anchor；保存请求，返回pending/归档中。原已claim Query继续完成观察/回答关联；新Query不得claim。Query的unknown仍走既有显式认定，不能暗中弃回答。
5. 对本次归档停止的未完Work写anchor。退休无continuation的未完Task也写；Kernel读取失败落unknown仍写，不把未知路径当零改动。
6. **先保证源Session封住派工**；释放/转移未完责任，关闭终结责任。没有生产间隙能再选到源：R还在。每个target独立提交；不跨多个target做总事务。还在yielded wait的Task这时不能requeue，必须先做第7步；不能越过原no_rework守卫。
7. 有wait transfer：先消息replyHandler提交，然后提交原yielded wait cancel；有wait cancel：记取消处置，然后原wait cancel。已完成的同身份步重放。退休免处置，不改原消息。处理过程中新的yield不在原choice中→partial，要求重选。此步真实完成后才以durable authority重新入队对应可行动Task：live Work用archiveOrigin.kind=execution，普通wait用kind=wait；后者不另写anchor、不假造consumedWait，response走routed input。原paused/Goal停止照现有围栏保留。
8. 读当前Session/links/wait，带最新事实CAS完成archive、清R。final失败保留前面处置。修正选择先显式释放原R（不撤已下达stop）、再新request；不能改旧request的内容重用旧requestId。

固定stop pin在控制首次提交前被其他合法写过期时，组合返回partial/revision_conflict、保留R和原pin，不制造无限CAS重试。执行仍活着时不释放R；操作者可用既有显式Run控制停下，再恢复原R。已queued的同一次stop重放必须走原public回执，不能把这个可重放分支误当pin过期；SV60/61分别锁住两种情形。

transfer给指定Session时后续领取优先用这个开放responsible link；普通drop由现有chooseSession选候选。本片不实现Q19的语义评分；已有sessionHint可用则复用，然后当前directory次序。不存在合适候选则create。**异常锚点分支的新建Session来历=new**；不能因Task有前一次Run就无条件写continuation。普通C3中断继续、角色不合适等既有接续分支仍写continuation，做责任转移并归档前任。若任务因原paused围栏等待人工continue，继续时按原退路创建continuation，同样带锚点（决定42特例）。

历史输入采用§7 T10推荐：`prepareContinuationBrief` 已读到的 `basis.requeue.archiveOrigin!=null` 表示归档普通领取分支，在 `execution-preparation.ts:sessionBasisOf` 调用前直接取sessionBasis=null、seededFrom=null；保留真实TaskRequeue事实链和带锚点的brief，brief.session.continuity='other_session'，不把旧线完整Kernel对话移到这次领取。复用目标的已有历史照常保留。原paused在归档时没有自动requeue，之后人点continue产生的原C3 requeue不写archiveOrigin，仍走原LA-1历史seed；该分支也可带pendingAnomalies。这个条件不使用“Task有anchor就禁止seed”，避免破坏已定的人工接续特例。

“方案确认后自动/每步确认”由第5片的目标策略接缝控制。slice1只产出等待派工/原围栏事实；既有未安装该策略的Host仍用当前明确授权的advance，不新增自动模型调用。第5片接上后，automatic→普通领取；step→决定卡。不能在slice1硬写永远自动、也不能把未来step策略降为不需要实现。

### 4.2 维护的有限一步

已知Goal暂停/取消、原human暂停围栏保持待继续，不以归档自动放行。普通旧失败的正式rework refusal保留在result.requeueRefusals及原Task历史，能final archive时仍state=archived；task archive-state给rework_blocked，不能假报等待派工。重新入队发生技术失败则按partial保留R待恢复，不把缺少必需提交当成已归档。

plain `continueArchiveLine` 用当前R恢复；R为空且Session已archived时只读返回state=archived/receipts=[]，不冒充原写回执。需要原值/cursor的客户端用原GraphWrite重放archiveLine，Workflow经R.receipt还原原final事件。R为空且active或id不匹配拒invalid。final之后内部Step重放使用requestReceipt找到原R，不能要求当前Session还挂着R。

```ts
// business/workflow/session-maintenance.ts
export type SessionMaintenanceInput = { workspace: WorkspaceScope; after: string | null };
export type SessionMaintenanceResultV1 = {
  processed: number; nextCursor: string | null;
  archived: SessionRef[]; pending: SessionRef[];
  failures: { sessionRef: SessionRef; rejection: CoreRejection }[];
};
maintainSessions(ctx: CoreCallContext, input: SessionMaintenanceInput):
  Promise<ReadResult<SessionMaintenanceResultV1>>;
```

每次 Workflow advance/显式continue、Host启动核对结束后顺带最多一页，不建timer/无限loop。continuing pending archives在选择新work前做；维护失败记录可见，不能阻塞另一个Session的合法工作。Host只调用Workflow，不直接清links或写anchor。startup：既有Session probe→Run/Query/check/control reconciliation→Goal扇出完成→Workflow维护→原startup re-drive；维护不启动Kernel/检查/模型。第7片提交唤醒会使已停止提交立即被继续，本片只有已有driver有限step和启动/显式入口。

Workflow实例按workspace保存上次maintenance nextCursor的内存Map；每步继续下一页，末页归零，Host重启重新开始。cursor只影响公平遍历，不是业务进度/新记录，全部归档进度来自R和正式回执。不能每次从第一页开始而让前100条长期线饿死后面的退休线；当前page只做bounded工作，limit按policy。默认维护与backfill的读页分别计budget，达到上限保留incomplete/nextCursor，不虚报工作区补齐完成。

executor due依据责任历史，而非最后Run.endedAt：新terminal关闭事件保存taskBasis.finishedAt，satisfied取 `src/contracts/reduction.ts:TaskReductionSnapshot.reducedAt`（string ISO UTC），cancelled/superseded取首次该Task终结处置的PlanRevision.acceptedAt。通过link.until→eventAt读原关闭事件，后来的Task定义/无关计划变化不会重置已做完的时钟。旧关闭事件没有该proof时按正式Task/Plan历史可靠恢复；无法证明→不自动archive并报告incomplete，不猜createdAt。曾负责多个任务取最大终结时间；无任务从未开始不算已做完。当前有新开放未完责任不due；新责任/claim与due读窗CAS竞争，若新Task先提交，archive不成功，下一次做完后重新算一天。

副本：`consultation.ts:attach` 在正式Answer与original message关联提交后，执行final archive；如果归档失败，返回正式回答及 pending archive，重试只补归档，不再启模型。响应处理自己的Query即使message已有response也要完成acceptance，不能用“response存在”代替“这一副本已答完”。故障且没Answer的copy不套“答完归档”；退休规则另算。

### 4.3 软排序的冻结算法

新 `business/workflow/task-order.ts`：

```ts
export function orderTasksByDependency(
  tasks: readonly RuntimeTask[], dependsOn: RuntimeExecutionDAG['dependsOn'],
): RuntimeTask[];
```

只用真实dependsOn，不把parent_of/coordination/expected_dependency当执行门。流程：对本次候选构造upstream→downstream边，去重；candidate之外的endpoint不加入候选也不挡下游。Kahn稳定拓扑排序，每次在入度0集合按 `(required优先,原plan数组位置,taskId字典序)` 取最小项；边跨required/optional时上游先于下游，因此optional上游可以排到required下游前。未有关联的任务仍required优先。循环属于正式计划本来不允许的损坏：函数防御性把剩余节点按相同stable key附尾，自边忽略；正式计划有效性仍由已有owner判断，这个纯排序函数不另外发warning或新增UI状态。算法只改选择次序；`selectNext`仍逐项尝试现有eligibility/phase/action，如果上游不能执行，下游照常被尝试。不可执行上游不能“占住第一名”。

`workflow.ts:orderTasks` 改为该函数，调用传plan.executionDag.dependsOn；claim owner不添加新的 dependsOn satisfied guard。第3片精确输入消费检查仍可能因所需产物实际不存在拒绝，这是独立规则。

### 4.4 路由与只读模型

沿 `src/app/core-routes.ts:CORE_ROUTE_SPECS / createPlatformCoreRouteBindings / dispatchCoreRoute`：

| suffix | kind / binding / owner | input与result |
| --- | --- | --- |
| `sessions/archive-line` | graph_write / archiveLine / workflow.archiveLine | §4.1 GraphWrite，ready ArchiveLineResultV1 |
| `sessions/archive-continue` | plain / continueArchiveLine / workflow.continueArchiveLine | §4.1 plain，恢复持久请求 |
| `sessions/archive-release` | graph_write / releaseSessionArchiveRequest / sessions.releaseSessionArchiveRequest | §3.3 明确修正入口 |
| `sessions/facts` | plain / readSessionFacts / sessionFacts.readSessionFacts | SessionRef→SessionFactsV1 |
| `sessions/successors` | plain / findSessionSuccessors / sessionFacts.findSessionSuccessors | §3.3 page |
| `sessions/executions` | plain / listSessionExecutions / sessionFacts.listSessionExecutions | §3.3 Work claim定位页 |
| `sessions/queries` | plain / listSessionQueries / sessionFacts.listSessionQueries | §3.3 Query页 |
| `sessions/transfer-responsibility` | graph_write / transferSessionResponsibility / responsibilities.transferSessionResponsibility | §3.3 原子转关系 |
| `tasks/archive-state` | plain / readTaskArchiveState / sessionAnomalies.readTaskArchiveState | TaskTriple→派生词/等待原因 |
| `anomalies/list` | plain / listSessionAnomalies / sessionAnomalies.listSessionAnomalies | goalRef、可选taskId、page |
| `messages/undelivered-replies` | plain / readUndeliveredReplies / messages.readUndeliveredReplies | §3.3 只读来源页 |

既有 `sessions/archive` 低层签名/返回WriteResult不改，仍拒绝开放责任/占用/普通等待；旧UI当尚无unfinished选择且无occupancy时照旧可用。新归档按钮只能 `archive-line`，禁止从Host路由绕过组合动作。`sessions/reactivate` 保持原route，新增退役guard；`executions/brief`原签名不改，新brief字段用同一renderer/digest。只读模型只加载已存事实，不启模型、不探测Kernel、不写State；changedFiles是archive写时读的快照，不在每次read模型重算。

本片创建 **11 个新suffix**。enum、route table、binding类型、parser/body校验、typed assembly全部同步。plain不是免权限，恢复和facts照Host workspace scope核；不向浏览器公开低层recordSessionAnomaly/requestSessionArchive内部payload。

## 5. 测试包

### 5.1 固定夹具与执行方式

以下每行是一个**主案例**，不是把多个成功/失败路径藏在同一个it。service组每行在 `describe.each(['memory','sqlite'] as const)` 跑两次；场景用当前tests/scenarios的HTTP+SQLite+scripted model harness，不用真实provider。时间固定 `t0='2026-10-08T00:00:00.000Z'`，`t1='2026-10-09T00:00:00.000Z'`，now注入；项目p/工作区w，源S/目标D，Task A/B，Run r0/r1，消息m，request a。示例 `P=cursor` 是测试实际commit返回值，不写伪固定p:1。

复制：`tests/helpers/graph-session-fixture.ts:createGraphSessionFixture / commitBarrier`（目录/links/receipt）；`tests/helpers/B2-execution-fixture.ts:createB2ExecutionFixture`（正式claim→authorize→enter→result）；`tests/work-graph/A2-requeue-service.test.ts:open`（memory/SQLite及失败/竞争）；`tests/record-store/lookup.test.ts:open`（旧SQLite重开）；`tests/scenarios/harness.ts` 与 `tests/scenarios/A4-duplicate-receipts.test.ts`（lost response/重启、逐步invariants）。不通过直接写成功状态证明service行为；codec兼容夹具可以旧编码直接seed。

通用负断言：每个拒绝检查 `status/code/reason前缀`，records/events/receipt数不变；每个幂等检查 `replayed=true`、原cursor与原value完整相等、Kernel/provider/check调用数不增加。多个子提交失败不套通用零写断言，而核已提交子结果。每次记录改变后跑已有invariant checker，并新增R/anchor状态规则：archived无occupancy/R；copy无Work claim；一Run≤一anchor；anchor不改phase；退休cannotreactivate；已归档源不被锚点新领取。

### 5.2 unit：state 行与纯Workflow算法

codec坏shape案例只直接给纯decoder输入坏编码，或从公开写入口给坏参数；**不篡改DB**制造owner损坏分支。正常service拒绝形状的code是invalid，已有持久损坏的unavailable映射只沿既有机制保留，不另造防御测试（AGENTS第4条）。

| case | 文件 | 给定 / 动作 | 精确预期 |
| --- | --- | --- | --- |
| UT01 | tests/state/S1-session-archive.test.ts | S revision7/running occupancy.generation=7；request | next.revision=8；occupancy.generation=7；R.requestId=a；1 write_archive_request effect+1 emit_event |
| UT02 | 同上 | active R=a；新request b | ok=false/code=busy；原state不变 |
| UT03 | 同上 | archived；request | invalid；effects不存在 |
| UT04 | 同上 | active/null/noLinks但wait=m；final | busy；detail前缀archive_wait_disposal_required |
| UT05 | 同上 | retired/null/noLinks/wait=m；final | archived；rev+1；清R；不生成wait处置effect |
| UT06 | 同上 | active occupied；final | busy，先于链接/等待失败 |
| UT07 | 同上 | archived/unavailable/kernel_turn_open；reactivate | unavailable；lifecycle仍archived |
| UT08 | 同上 | archived/available/null rev9；reactivate | active rev10，archivedAt=null，health不变 |
| UT09 | 同上 | legacy provenance=null rev3；unique basis | rev4；provenance continuation from S |
| UT10 | 同上 | 已有new provenance；backfill | revision_conflict，无改 |
| UT11 | tests/state/S1-responsibility.test.ts | 源开放rev2，目标absent；transfer | 【审查改】纯 state 拿不到提交游标：write_responsibility 的 closed=源link rev3、until=null（待绑定）；opened=目标link rev1、since=null、until=null，openedBound='since'；双方Session各+1。P 的绑定由 SV16 在 owner 上核 |
| UT12 | 同上 | 源任务旧Run仍running；transfer | busy，无构造记录 |
| UT13 | 同上 | 目标已有开放rev4；transfer | 源关闭；目标rev4/since原值；不重开目标 |
| UT14 | 同上 | retired目标；transfer | unavailable，无记录 |
| UT15 | 同上 | Task satisfied正式proof；close | 【审查改】closed.until=null（待绑定，绑定由 SV19 核）、opened=null；Task phase不变；无Task cancelled效果 |
| UT16 | tests/state/S1-anomaly.test.ts | 已停Work/Task未完；anchor | anchor.rev1/resultVerification=not_checked；1 write+1 event |
| UT17 | 同上 | Work仍outcome_unknown；anchor | busy，无anchor |
| UT18 | 同上 | Query；anchor | invalid，无anchor |
| UT19 | 同上 | 只有claimed r1携anchor | pickedUpBy=null；label=中断，待核对（【审查改】UT19–22、UT42、UT48 的 label/next 经 deriveTaskArchiveState 断言，行里没给的输入取 goalDesiredState='active'、phaseCause=null、reworkRefusal=null、claimable=true） |
| UT20 | 同上 | r1真实entered、别的Session、携anchor | pickedUpBy=r1；label=null；anchor本体deepEqual原值 |
| UT21 | 同上 | r1not_entered cancelled携anchor | pickedUpBy=null |
| UT22 | 同上 | 原paused_interrupted+pending anchor | label=中断，待核对；next={kind:'human_continue'} |
| UT23 | tests/state/S1-message-routing.test.ts | 转wait m→D | status/response/sender/recipient逐值不变；replyHandler=D；rev+1 |
| UT24 | 同上 | response已accepted；转wait | busy，字段不变 |
| UT25 | 同上 | 取消wait | archiveWaitDisposition.kind=cancel；response仍null；status不变 |
| UT26 | tests/state/S1-dispatch.test.ts | copy空闲；普通Work | forbidden |
| UT27 | 同上 | wait=m；普通Work | busy，effects不存在，不acquire |
| UT28 | 同上 | wait=m已responded未消费；Work | busy，不能把有回答当idle |
| UT29 | 同上 | 原Task精确consumedWait同m；Work | ok=true；沿正常acquire effect，generation=revision+1 |
| UT30 | 同上 | R非null空闲；Work | busy，effects不存在 |
| UT31 | 同上 | copy固定consultation Query | ok=true；沿正常acquire effect |
| UT32 | tests/state/S1-archive-rework.test.ts | 本次archive cancel，人，prior2/cap3 | interrupted；automatic=false/count=false/count0/cap=null |
| UT33 | 同上 | retired interrupted，自动，prior3/cap3 | interrupted；automatic=true/count=false/count3/cap3；未拒cap |
| UT34 | 同上 | 普通失败伪archiveOrigin | forbidden，不能豁免 |
| UT35 | 同上 | 先前人工paused，auto retired | 原human_only fence；forbidden；不requeue |
| UT36 | tests/business/S1-task-order.test.ts | plan[B(required),A(optional),C(required)]，B依赖A | [C,A,B]（ready队列先required C） |
| UT37 | 同上 | [B(required),A(required),C(optional)]，B依赖A | [A,B,C] |
| UT38 | 同上 | 下游B依赖不在候选的A | [B]；未新增A，未拒领取 |
| UT39 | 同上 | A不可执行、B可执行，B依赖A | order=[A,B]；selectNext选择B；不dependency_blocked |
| UT40 | 同上 | 重复边A→B | [A,B]；入度按1，数组/输入不改 |
| UT41 | 同上 | plan[A,B]、同required，坏循环A↔B | 返回[A,B]；无无限loop；不写新状态 |
| UT42 | tests/state/S1-anomaly.test.ts | 未完Goal paused+pending anchor | label=中断，待核对；next={kind:'goal_stopped',desiredState:'paused'}；不能claim |
| UT43 | tests/state/S1-dispatch.test.ts | wait=m；Query | busy，effects不存在 |
| UT44 | 同上 | consumedWait同m但task=B，真实wait.task=A | busy，effects不存在 |
| UT45 | 同上 | consumedWait同task但message=n，真实wait.message=m | busy，effects不存在 |
| UT46 | 同上 | R非null空闲；Query | busy，effects不存在 |
| UT47 | 同上 | copy为m固定派生；另一个Query | forbidden，effects不存在 |
| UT48 | tests/state/S1-anomaly.test.ts | 未完Goal cancelled+pending anchor | label=中断，待核对；next={kind:'goal_stopped',desiredState:'cancelled'} |
| UT49 | tests/state/S1-session-archive.test.ts | R=a但queued stop未生效；release | busy；R仍a；revision不变 |
| UT50 | 同上 | 处置失败、execution已停、无queued stop；release | R=null；revision+1；已闭link/Run不构造恢复效果 |
| UT51 | tests/state/S1-responsibility.test.ts | readonly_copy目标；transfer | unavailable，无记录 |
| UT52 | tests/state/S1-dispatch.test.ts | record.provenance=null，可信legacyProvenance为readonly_copy；Work | forbidden；0acquire effects |
| UT53 | 同上 | record.provenance=null且legacyProvenance=null；Work | incomplete；0acquire effects；不把null当new |
| UT54 | tests/state/S1-session-archive.test.ts | executor/null/no责任/wait=false，finishedAt=t0，now=t1-1ms，threshold86400000 | executorArchiveDue=false；0副作用 |
| UT55 | 同上 | 同UT54，now=t1 | executorArchiveDue=true；0副作用 |
| UT56 | 同上 | 同UT55，但openModuleResponsibility=true（【lead 改：L4】） | executorArchiveDue=false；0副作用 |

另外扩已有Session/Message state测试的event覆盖穷尽矩阵，用单独生成的 `(state,event)` 数量报告，不把矩阵算成上面的主案例数。Session窄夹具明确提供not_waiting和普通dispatch事实；没有读到的生产ctx仍拒incomplete。Session旧reactivate oracle中unavailable分支按决定38改成unavailable拒绝，这是点名的行为改动；其余旧rows的预期不改。Message矩阵添加新event覆盖项，原sent/read/respond/accept/derive/claim各行预期不改。

### 5.3 codec、lookup与services（每行双后端）

| case | 文件 | 给定 / 动作 | 精确预期 |
| --- | --- | --- | --- |
| SV01 | tests/work-graph/S1-codecs-indexes.test.ts | 旧Session/Operation/Message/brief解码 | provenance=null/R=null/handler=null/disposition=null；旧briefdigest逐字节原值 |
| SV02 | 同上 | 六lookup注册，两Session/两个Work/一Query/一anchor/一handler消息 | 每个索引仅返回对应完整ref；w2全空；无duplicate schema registration |
| SV03 | 同上 | 相同旧格式Outbox：memory在新schema下seed；SQLite先旧schema写再以新schema重开 | IDX-S2直接返回原claim.runRef；lookup前后records/events数量不增；不伪造memory持久重开 |
| SV04 | 同上 | copy消息/continuation创建，读取provenance索引 | copy不当continuation；两successor事实保留；不锁第二continuation |
| SV05 | 同上 | decoder输入provenance.kind='bogus'；创建入口同坏字段 | decoder invalid；入口invalid；0写；不吞成null |
| SV06 | tests/work-graph/S1-session-facts.test.ts | 最新Query覆盖lastExecutionRef，旧Work已yield | latestWork=Work claim；wait=m；不被Query盖掉 |
| SV07 | 同上 | runId字典序和generation顺序相反 | latestWork按max generation；不是key最后一项 |
| SV08 | 同上 | response存在但未consumed | wait仍m；ordinary claim/query busy |
| SV09 | 同上 | 源wait被archive cancel后 | wait=null；消息response不变 |
| SV10 | 同上 | 2501个候选需26页 | incomplete/session_facts_page_limit；不返回wait=null |
| SV11 | 同上 | 下一页cursor换workspace/filter | invalid，0写/0模型 |
| SV12 | tests/work-graph/S1-provenance.test.ts | 旧首claim+新建operation+requeue.historySource唯一 | 一次backfill continuation；再次同请求原cursor/replayed=true |
| SV13 | 同上 | 已有老Session被复用，historySource指另一Session | backfill new，basis=no_reliable_predecessor；不误接线 |
| SV14 | 同上 | 两个不同后继共享前任 | findSuccessors两项；回溯两条都含前任；不unique conflict |
| SV15 | 同上 | legacy两可靠证据冲突 | incomplete/legacy_provenance_ambiguous；provenance仍null，0提交 |
| SV16 | tests/work-graph/S1-responsibility.test.ts | A由S转D | 两links同cursor；两Sessions各+1；Task/Run不变 |
| SV17 | 同上 | source writer running | busy；两边均无部分写 |
| SV18 | 同上 | 双并发转S→D/S→E | 恰一committed、一revision_conflict；唯一开放新负责关系 |
| SV19 | 同上 | 已satisfied/已cancelled/已superseded的三个Task | 三个link均closed；各保留since；非terminal failed link仍open |
| SV20 | 同上 | Run completed但未正式Task satisfied | 不自动close该link；最终archive仍busy |
| SV21 | tests/work-graph/S1-archive-owner.test.ts | busyS登记R，旧Run释放 | 登记rev+1/generation保持；释放匹配旧generation成功；R保留到final |
| SV22 | 同上 | 不在等读完后另一合法yield提交 | final revision_conflict/current指S；lifecycle active；已close责任不回滚 |
| SV23 | 同上 | S退休+wait+links均已处置 | final archived；wait消息记录完全不变 |
| SV24 | 同上 | archiveRequest同id改to/confirm | idempotency_conflict；旧choices不改 |
| SV25 | 同上 | final原receipt后Session重新启用；重放final | 原archived结果/原cursor/replayed=true；不读成active |
| SV26 | tests/work-graph/S1-anomaly-owner.test.ts | r0被archive停，重复写/不同request同run，原R已清除 | 只1anchor；原recordedAt/文件事实/receipt不改；第二次返回原记录、原cursor、replayed=true |
| SV27 | 同上 | 拿不到Kernel和workspace | unknown/unavailable；confirmed=[]/possible=[]；reason非空；依然1anchor |
| SV28 | 同上 | 正式Task/Goal双索引读同anchor | 两返回ref/body完全相同；没有两条记录 |
| SV29 | 同上 | stopped但Task已satisfied | invalid；0anchor；不把满足Task重入队 |
| SV30 | tests/work-graph/S1-wait-disposal.test.ts | wait transfer→reply slot后来保存→D接受 | 问题bodyRef原值；handler D；原wait已cancel；response inputId仅1次accepted |
| SV31 | 同上 | transfer成功后wait_cancel提交失败，重开service | transfer不再写；原wait cancel一次；最终不等待；回执原值 |
| SV32 | 同上 | 已response再transfer | 新目标能消费原responseRef；不再创建一条问题/回答 |
| SV33 | 同上 | 退役无continuation迟到reply | 1UndeliveredReply；requiresUserRecipient=true；消息未自动ack/转交 |
| SV34 | 同上 | 退役有continuation迟到reply | hasContinuation=true；不自动入后继Kernel；原responseRef保存 |
| SV35 | tests/work-graph/S1-requeue.test.ts | 人工archive已cancel r0，cap已3 | committed kind=requeued；failureClass interrupted；counted=false；archiveOrigin原ref |
| SV36 | 同上 | archiveOrigin.archiveRequestId指不存在的R | forbidden；0TaskRequeue/0refusal |
| SV37 | 同上 | 退休paused_interrupted任务归档 | anchor1/linkclosed/S archived；Task仍paused_interrupted；TaskRequeue0 |
| SV38 | 同上 | archive后已有TaskRequeue，恢复 | 不改已有requeue；0新Attempt/0新Run/0Kernel |
| SV39 | tests/work-graph/S1-dispatch-guards.test.ts | 普通claim直接调用copy Session绕Workflow | forbidden；0新Run/Lease |
| SV40 | 同上 | Query直接claim等待Session | busy；QueryJob/QueryRun仍pending；Session occupancy=null |
| SV41 | 同上 | 正确consumedWait claim和archive request并发 | 恰一胜者；archive若先commit则claim busy或revision_conflict；无双占用 |
| SV42 | tests/work-graph/S1-codecs-indexes.test.ts | 纯decoder输入archiveRequest.execution.kind='bogus' | decoder invalid；0DB改写；不吞成null |
| SV43 | 同上 | 纯decoder输入anchor.outer revision=2/body.revision=1 | decoder invalid；0DB改写 |
| SV44 | 同上 | 纯decoder输入provenance.from.projectId与session.ref.projectId不同 | decoder invalid；0DB改写 |
| SV45 | tests/work-graph/S1-provenance.test.ts | 旧provenance回溯形成环 | cycle/session_provenance_cycle；保持null；0提交 |
| SV46 | 同上 | initial link.since指后来linkChanged，非SessionCreated | 不采纳requeue_creation；无其他证据时new；basis=no_reliable_predecessor |
| SV47 | tests/work-graph/S1-responsibility.test.ts | transfer目标workspace为w2 | forbidden/archive_scope；双方links/revisions不变 |
| SV48 | tests/work-graph/S1-requeue.test.ts | archiveOrigin.anchorRef不存在，R存在 | forbidden；0TaskRequeue/0refusal |
| SV49 | 同上 | anchor.runRef=r0但请求afterRun=r2 | forbidden；0TaskRequeue/0refusal |
| SV50 | 同上 | 普通自动失败、prior=cap=3、无archiveOrigin | 1原TaskReworkRefusal/code=auto_rework_cap_reached；automation.autoCount=4/cap=3；0TaskRequeue |
| SV51 | tests/work-graph/S1-dispatch-guards.test.ts | 普通Work直接claim等待S | busy；0Run/0Lease/0Session占用 |
| SV52 | 同上 | 普通Work直接claim R非null S | busy；0Run/0Lease/0Session占用 |
| SV53 | tests/work-graph/S1-session-facts.test.ts | lastExecutionRef指旧Query，无executionState；旧Work yield m | ready；latestWork仍Work；wait=m；Query由精确pointer定位1项；未伪造执行字段 |
| SV54 | tests/work-graph/S1-wait-disposal.test.ts | handler=D，原sender S以真实Kernel事实确认response | forbidden；acceptedInputs=[]；0新receipt/0写 |
| SV55 | 同上 | handler=D且D真实input_accepted确认response | committed；acceptedInputs仅1项/inputId=deriveSessionInputId(m,'response')/executionRef=D的Run |
| SV56 | tests/work-graph/S1-archive-owner.test.ts | final清R后用原Step/requestReceipt重放 | 原archived Session/cursor/replayed=true；不要求current R；0新写 |
| SV57 | tests/work-graph/S1-requeue.test.ts | 原yield wait已archive cancel、无anchor，kind=wait origin | requeued；failureClass=interrupted；人工count0；anchor总0；无ConsumedWait伪值 |
| SV58 | tests/work-graph/S1-dispatch-guards.test.ts | 旧copy记录无provenance，固定message.child关系已保存、Query尚未claim；直调Work claim | legacy reader证实copy；forbidden；0Work Run/0Lease；不把未claim当new |
| SV59 | tests/work-graph/S1-requeue.test.ts | 普通failed早于退休、真实retired_archive anchor、prior=cap3；auto requeue | failureClass=run_failed；counted=true/count4/cap3；refusal.code=auto_rework_cap_reached；0TaskRequeue |
| SV60 | tests/work-graph/S1-archive-owner.test.ts | R.executionPins保存r0@k，cancel提交响应丢失，r0已到k+1；重启恢复同R | submitControl仍expected r0@k；原intent/ref/cursor/replayed=true；0新intent；deliver原intent；无idempotency_conflict |
| SV61 | 同上 | R已提交、cancel尚未提交，别的合法control先把r0从k改到k+1且仍在跑 | ready/state=partial/rejection=revision_conflict；R保留且pin仍k；归档cancel新intent0；不换pin/不释放R |

### 5.4 Runtime、Workflow、路由与场景

这组每行一个主案例；Workflow/route doubles只模拟外部callback，不伪造正式状态通过断言。场景固定SQLite。

| case | 文件 | 给定 / 动作 | 精确预期 |
| --- | --- | --- | --- |
| IT01 | tests/runtime/S1-archive-files-brief.test.ts | Kernel已确认编辑a、命令结果未知可能改b | source=kernel；confirmed=['a']；possible=['b']；status=partial |
| IT02 | 同上 | Kernel缺失，当前HEADworktree含a/b | source=worktree；confirmed=[]；possible=['a','b']；runBaselineKnown=false；包含混合归属警示 |
| IT03 | 同上 | prepare r1带r0anchor，重复prepare | brief新段ref=r0anchor、inputBinding同ref；digest固定；capture只第一次发生 |
| IT04 | 同上 | 原manifest旧brief无anomalies | 旧marker/digest/text完整相等；无新增段 |
| IT05 | 同上 | 9条pending anchor | 装最早8条/omitted1；未装项pickedUpBy仍null；警示/固定句保留 |
| IT06 | tests/business/S1-session-maintenance.test.ts | finishedAt=t0，now=t1-1ms | archived=[]；lifecycle active |
| IT07 | 同上 | finishedAt=t0，now=t1 | archived=[S]；archivedAt=t1；无模型调用 |
| IT08 | 同上 | deadline前接新未完Task | 不归档；新Task做完后用新finishedAt+86400000，不沿旧时钟 |
| IT09 | 同上 | 【审查改：L4】secretary/adviser/scribe/reviewer/unknown 五个 Session（`SessionDutyResolver` 依次返回这四种职责和 `'unknown'`）同样闲一天 | archived=[]；不按executor阈值处理 |
| IT10 | 同上 | 有新retired无continuation且释放占用 | 本次维护即archived；未完Task drop/anchor；不是等一天 |
| IT11 | 同上 | copy已答，原source仍跑 | copy archived；source rev/occupancy不变；Query/provider不重跑 |
| IT12 | tests/business/S1-archive-flow.test.ts | cancel已发但Kernel仍跑 | state=pending/message=归档中 · 停止中；R存在；0责任转移/0requeue |
| IT13 | 同上 | stop/anchor/drop已commit，final失败 | state=partial/message=处置已完成，归档没成功；rejection=revision_conflict；已处置links不恢复 |
| IT14 | 同上 | 原Query正在回答，archive | state=pending/message=归档中；0cancel/0anchor；回答保存后archived |
| IT15 | 同上 | unknown Work未confirm | busy/archive_unknown_confirmation_required；0提交；R=null；occupancy保留 |
| IT16 | 同上 | archive anchor任务再派，D可用 | claim.sessionRef=D；不是S；brief包含anchor；sessionBasis=null/seededFrom=null/continuity=other_session；保留D已有历史；0新Session |
| IT17 | tests/app/S1-session-routes.test.ts | 新suffix parsing和bindings | 11suffix逐项归正确owner；graph/plain形状错误invalid；未暴露内部写payload |
| IT18 | 同上 | partial经HTTP返回 | HTTP成功带ready/state=partial+嵌入rejection+真实receipts；不是archived也不是丢掉部分事实的通用错误 |
| IT19 | tests/scenarios/S1-archive-restart.test.ts | request提交后Host重启并按原request恢复 | 最终S archived/R=null；anchor1/requeue1；旧S无新Run；已交receipt原值；新执行brief含anchor |
| IT20 | tests/scenarios/S1-wait-copy-retirement.test.ts | S真实yield→转等待D→reply→D消费；另copy答完；另retired无continuation收到reply | 原问题不变、response只消费一次；copy归档；退休reply来源项1且不自动转交；原S不被Query/Work重新派；读/刷新调用模型增量0 |
| IT21 | tests/scenarios/S1-archive-restart.test.ts | stop提交后Host重启并恢复 | 最终S archived/R=null；anchor1/requeue1；stop原intentId；旧S无新Run |
| IT22 | 同上 | anchor提交后Host重启并恢复 | anchor原body/cursor；总anchor1；最终archived；requeue1 |
| IT23 | 同上 | responsibility提交后Host重启并恢复 | 旧link关闭cursor原值；不重开；总anchor1/requeue1；最终archived |
| IT24 | 同上 | requeue提交后Host重启并恢复 | 原TaskRequeue完整值/cursor；总requeue1；0额外Attempt/Run/模型调用；最终archived |
| IT25 | 同上 | final提交但HTTP响应丢失后重启 | 回放archived原Session/receipt；R=null；0额外stop/anchor/requeue |
| IT26 | tests/business/S1-archive-flow.test.ts | unknown Work明确confirm | 先真实attestation释放占用，再anchor1/archive；Run不写completed；R最终null |
| IT27 | 同上 | archive anchor任务再派，无可用其他Session | 创建1Session；provenance={schemaVersion:1,kind:'new'}；brief含anchor；sessionBasis=null/seededFrom=null/continuity=other_session；未写continuation from S |
| IT28 | tests/runtime/S1-routed-replies.test.ts | D运行中，handler消息从routed页读到 | 下个before_model供给1项原response/inputId；原sender供给0项；不重问 |
| IT29 | 同上 | 同message出现在outbox/routed及分页重复候选 | 本次供给1项；正式accepted以后后续供给0项；model不被发现器新建Query触发 |
| IT30 | 同上 | D空闲不负责原Task；reply已保存 | 保留未accepted；0新Task/Query/model；D下次合法执行安全点供给1项 |
| IT31 | tests/business/S1-session-maintenance.test.ts | t0正式Task终结并terminal关闭责任；随后计划改同Task定义但没重新交给S；now=t1 | 从关闭事件taskBasis.finishedAt=t0算due；archived=[S]；不以新计划时间重置；0模型调用 |
| IT32 | tests/runtime/S1-archive-files-brief.test.ts | 正式Run事实证明not_entered，工作区已有别的执行改动a | source=kernel/status=not_entered；confirmed=[]/possible=[]/omitted=0；runBaselineKnown=false；工作区capture调用0 |
| IT33 | tests/business/S1-session-maintenance.test.ts | 【lead 改：L3】S退役、无接续，对Task A有开放负责关系（createSession的初始link），但S从没为A跑过执行；维护一步 | archived=[S]；A的负责link关闭（until=本次提交cursor）；SessionAnomalyAnchor总数0；A的effectivePhase不变；TaskRequeue 0；读A的archive-state得label=null；模型调用0 |
| IT34 | tests/business/S1-session-maintenance.test.ts | 【审查改：§0.1 U1 冻结】S 退役、无接续；S 手上 r0 的结果未知（outcome_unknown），r0 仍占着 S；S 对 Task A 有开放负责关系；维护一步 | archived=[]；pending=[]；failures 恰一项：sessionRef=S、rejection.code=busy、reason 以 `archive_unknown_confirmation_required:` 开头；对 S 零提交（archiveRequest 仍 null、SessionAnomalyAnchor 总数 0、A 的负责 link 仍开放、r0 仍 outcome_unknown、S 的占用不变）；模型调用 0 |

IT19、IT21–25分别是一条崩溃点案例，可以在同一文件用`it.each`组织，但总数就是6，每条检查invariants。IT20是一个串联场景，有3条相互独立Session线，不冒充大规模验收。Work等待/R拒绝分别由UT27/30覆盖，Query对应UT43/46，不另重复计purpose子例。骨架阶段全新主案例 RED 应来自指定unsupported/stub，不能 TypeScript不通过或fixture失败；DSH必须把未执行到的断言另报，不能“fail正确所以已覆盖”。

### 5.5 既有测试保持通过且预期不改

以下为必须维持的**固定回归清单**，不为了新行为更改其已有期望：

- `tests/work-graph/A1-session-lifecycle.test.ts`、`R4b-session-directory.test.ts`：scope、原回执、links interval、低层archive仍拒未完责任。
- `tests/work-graph/A2-requeue-service.test.ts`、`tests/state/task-failure.test.ts`：普通失败cap/no-progress、Host actor分类、权限/人停围栏；只增加archive例外用例。
- `tests/work-graph/R5b-query-execution.test.ts`、`tests/runtime/R5b-query-session-loop.test.ts`：既有Query claim/observations/replay，不把查询回答当Task完成。
- `tests/runtime/C3-brief-timeline.test.ts`、`tests/app/A2-continuation-projection.test.ts`：没有anomaly时旧brief渲染/marker/readonly projection。
- `tests/business/R5c-workflow.test.ts`、`A2-workflow-result-mapping.test.ts`、`A2-workflow-disposition.test.ts`：没有依赖的新输入保持required优先，不扩大deferred/cancelled/superseded的行动。
- `tests/scenarios/C8-human-stop-respected.test.ts`、`C8-auto-rework-cap.test.ts`、`A8-host-restart-paused.test.ts`、`C3-not-entered-chain.test.ts`、`C3-brief-idempotency.test.ts`：不复活旧Run、不误解paused、不把未进入算接手、不重装manifest。
- `tests/record-store/lookup.test.ts`、`tests/architecture/boundaries.test.ts`：既有lookup/子模块纯度不弱化。

不把全仓5234项（9b94fc55）全部标为“预期不改”：新排除行为可能揭示旧测试依赖错误的原Session查询；遇此情况列原case、原行为和新规则，交lead审，只改对应fixture/必要行为断言，不能删测试或改数量凑绿。`tests/architecture/state-writes.test.ts`必须扩受保护字段/解码白名单，下面明确列为改动文件。

### 5.6 点名检查与两阶段顺序

按 STATE-MACHINES-SPEC §15：先contracts/旧解码→state+unit→owner双后端→Runtime/Workflow→composition/route→两个场景。不是按模块层号把整个工程串行施工。

DSH阶段1仅在lead冻结的副本写类型、真实兼容codec、state/owner签名骨架和点名测试后STOP；报告新主案例数、表驱动展开数、RED到达断言、UNSPECIFIED。lead冻结上述接口、§7技术选项和测试hash后阶段2写实现；不调用真实provider，不操作3080/3099/44797，不改vendor，禁止git add/rm/checkout/restore/stash/reset/commit/push。

每阶段限定跑：`npm run typecheck`、`npm run check:architecture`、本节明确新增文件及§5.5固定回归文件（用显式文件名传vitest，不传整个目录）。集成后一次 `npm run build`。`tests/architecture/state-writes.test.ts`较重，保护字段完成后跑一次，出现相关改动再复验。新主案例与expanded总数冻结后记录实际数；**本规格不宣称已经跑过测试**。全量测试是否作为批次最终门槛由lead统一收尾安排，不每个小步重复全量。

## 6. 逐文件施工清单

`C`=改变现有文件，`N`=新建。标 `1/3`、`1/5`、`1/3/5` 的文件共享修改面，先冻结新增类型/字段、事件和导出归属，禁止DSH用某片原始基线覆盖另外片。下面每行一个文件；不修改module-target的边，不新建views/notes目录。

| ID | C/N | 文件 | 模块/子模块 | 用途 / 交叉片 |
| --- | --- | --- | --- | --- |
| F01 | C | src/contracts/core/session.ts | Contracts | 来历/request；1/3 |
| F02 | N | src/contracts/core/session-archive.ts | Contracts | 归档数据/executionPins/纯提交身份派生 |
| F03 | N | src/contracts/session-anomaly.ts | Contracts | anchor/ref/文件事实 |
| F04 | C | src/contracts/ledger.ts | Contracts | 新AggregateRef；1/5 |
| F05 | C | src/contracts/continuation-brief.ts | Contracts | anomaly段/shape/render；1/3 |
| F06 | C | src/contracts/dispatch.ts | Contracts | inputBinding refs；1/3 |
| F07 | C | src/contracts/task-requeue.ts | Contracts | archiveOrigin/actor；1/5 |
| F08 | C | src/core/work-graph/model/session-contracts.ts | WG/model | 创建输入/可选facts端口；1/3 |
| F09 | N | src/core/work-graph/model/session-facts-contracts.ts | WG/model | 索引常量/facts只读接口 |
| F10 | C | src/core/work-graph/model/claim-contracts.ts | WG/model | requeue archiveOrigin；1/5 |
| F11 | C | src/core/work-graph/model/execution-read-contracts.ts | WG/model | pendingAnomalies；1/3 |
| F12 | C | src/core/work-graph/model/communication-contracts.ts | WG/model | replyHandler/处置/read port；1/3/5 |
| F13 | C | src/core/work-graph/sessions/session-record-codecs.ts | WG/sessions | 来历/R/receipt兼容/前任index；1/3 |
| F14 | C | src/core/work-graph/sessions/lifecycle-contracts.ts | WG/sessions | 归档内部steps |
| F15 | C | src/core/work-graph/sessions/lifecycle-record-codecs.ts | WG/sessions | request/release/backfill/转责任事件 |
| F16 | C | src/core/work-graph/sessions/session-lifecycle.ts | WG/sessions | request/final/CAS/wait guard |
| F17 | C | src/core/work-graph/sessions/session-directory.ts | WG/sessions | creation/backfill来历 |
| F18 | N | src/core/work-graph/tasks/session-facts.ts | WG/tasks | latestWork/等待/索引facts；【lead 改：L1】从 sessions 移到 tasks |
| F20 | C | src/core/work-graph/tasks/claim-record-codecs.ts | WG/tasks | Work index、archiveOrigin；1/5（【lead 改：L1】不搬 codec，不加 re-export） |
| F21 | C | src/core/work-graph/queries/query-record-codecs.ts | WG/queries | Query session lookup |
| F22 | C | src/core/work-graph/queries/query-execution.ts | WG/queries | waiting/archive/copy claim守卫；1/3 |
| F23 | C | src/core/work-graph/tasks/claim-service.ts | WG/tasks | 直接claim排除/合法等待例外 |
| F24 | N | src/core/work-graph/tasks/session-anomaly-codecs.ts | WG/tasks | 唯一新aggregate/events/双index |
| F25 | N | src/core/work-graph/tasks/session-anomaly-service.ts | WG/tasks | anchor写/读/接手派生 |
| F26 | N | src/core/work-graph/sessions/session-responsibility-service.ts | WG/sessions | 负责关系写owner；注入tasks只读证明后原子转移 |
| F27 | C | src/core/work-graph/tasks/requeue-service.ts | WG/tasks | 原授权archive例外；1/5 |
| F28 | C | src/core/work-graph/tasks/plan-readers.ts | WG/tasks | 责任basis可信reader、anchor事实参与failure读取；1/3/5 |
| F29 | C | src/core/work-graph/tasks/run-state-service.ts | WG/tasks | continuationBasis带pending anchor |
| F30 | C | src/core/work-graph/state/session-availability.ts | WG/state | 来历/R构造/guard/自动due；1/3 |
| F31 | N | src/core/work-graph/state/session-responsibility.ts | WG/state | link/Session纯构造 |
| F32 | N | src/core/work-graph/state/session-anomaly.ts | WG/state | anchor构造/接手/label |
| F33 | C | src/core/work-graph/state/message-machine.ts | WG/state | handler/处置与类型等价；1/5 |
| F34 | C | src/core/work-graph/state/task-failure.ts | WG/state | 确证归档中断类别/豁免；1/5 |
| F35 | C | src/core/work-graph/state/task-machine.ts | WG/state | 原requeue rows archive ctx；1/5 |
| F36 | C | src/core/work-graph/state/run-machine.ts | WG/state | 授权时anomaly refs一致；1/3 |
| F37 | C | src/core/work-graph/sessions/message-record-codecs.ts | WG/sessions | message新字段/处置事件/handler index；1/5 |
| F38 | C | src/core/work-graph/communication/mailbox-service.ts | WG/communication | 转等待/未送达来源/授权；1/3/5 |
| F39 | C | src/core/agent-runtime/session-operations.ts | AgentRuntime | 来历贯穿isolation/admit/complete；1/3 |
| F40 | N | src/core/agent-runtime/session-anomaly-facts.ts | AgentRuntime | Kernel/selfChanged/worktree退路 |
| F41 | C | src/core/agent-runtime/execution-preparation.ts | AgentRuntime | 复用改动读取+brief段；archiveOrigin普通领取跳过sessionBasisOf；1/3 |
| F42 | C | src/core/agent-runtime/continuation-brief-assembly.ts | AgentRuntime | 构造新段；1/3 |
| F43 | C | src/core/agent-runtime/ports.ts | AgentRuntime | changedFiles可选port；1/3 |
| F44 | C | src/core/agent-runtime/runtime.ts | AgentRuntime | 实际readFiles port/brief旧值兼容；1/3 |
| F45 | N | src/business/workflow/session-archive.ts | Workflow | 唯一组合动作 |
| F46 | N | src/business/workflow/session-maintenance.ts | Workflow | 一页维护/退休/一天/copy |
| F47 | N | src/business/workflow/task-order.ts | Workflow | 纯依赖软排序 |
| F48 | C | src/business/workflow/contracts.ts | Workflow | 归档/维护结果类型re-export；1/5 |
| F49 | C | src/business/workflow/ports.ts | Workflow | 所需owner/lifecycle/facts/duty；1/3/5 |
| F50 | C | src/business/workflow/workflow.ts | Workflow | order/exclusion/接续责任/维护；1/3/5 |
| F51 | C | src/business/workflow/consultation.ts | Workflow | copy来历/答完archive/handlerresponse |
| F52 | C | src/composition/create-platform.ts | Composition | schema/ports/policy/duty装配；1/3/5 |
| F53 | C | src/app/core-routes.ts | Host | 11suffix+types/bindings；1/3/5 |
| F54 | C | src/app/startup-reconcile.ts | Host | 核对后调用Workflow维护 |
| F55 | C | src/app/collaboration-driver.ts | Host | 已有有限驱动接维护/转走回复；规则仍Workflow |
| F56 | N | tests/state/S1-session-archive.test.ts | tests/state | UT01–10/49–50/54–55/56 |
| F57 | N | tests/state/S1-responsibility.test.ts | tests/state | UT11–15/51 |
| F58 | N | tests/state/S1-anomaly.test.ts | tests/state | UT16–22/42/48 |
| F59 | N | tests/state/S1-message-routing.test.ts | tests/state | UT23–25 |
| F60 | N | tests/state/S1-dispatch.test.ts | tests/state | UT26–31/43–47/52–53 |
| F61 | N | tests/state/S1-archive-rework.test.ts | tests/state | UT32–35 |
| F62 | N | tests/business/S1-task-order.test.ts | tests/business | UT36–41 |
| F63 | N | tests/work-graph/S1-codecs-indexes.test.ts | tests/work-graph | SV01–05/42–44 |
| F64 | N | tests/work-graph/S1-session-facts.test.ts | tests/work-graph | SV06–11/53 |
| F65 | N | tests/work-graph/S1-provenance.test.ts | tests/work-graph | SV12–15/45–46 |
| F66 | N | tests/work-graph/S1-responsibility.test.ts | tests/work-graph | SV16–20/47 |
| F67 | N | tests/work-graph/S1-archive-owner.test.ts | tests/work-graph | SV21–25/56/60–61 |
| F68 | N | tests/work-graph/S1-anomaly-owner.test.ts | tests/work-graph | SV26–29 |
| F69 | N | tests/work-graph/S1-wait-disposal.test.ts | tests/work-graph | SV30–34/54–55 |
| F70 | N | tests/work-graph/S1-requeue.test.ts | tests/work-graph | SV35–38/48–50/57/59 |
| F71 | N | tests/work-graph/S1-dispatch-guards.test.ts | tests/work-graph | SV39–41/51–52/58 |
| F72 | N | tests/runtime/S1-archive-files-brief.test.ts | tests/runtime | IT01–05/32 |
| F73 | N | tests/business/S1-session-maintenance.test.ts | tests/business | IT06–11/31/33/34 |
| F74 | N | tests/business/S1-archive-flow.test.ts | tests/business | IT12–16/26–27 |
| F75 | N | tests/app/S1-session-routes.test.ts | tests/app | IT17–18 |
| F76 | N | tests/scenarios/S1-archive-restart.test.ts | tests/scenarios | IT19/21–25，6崩溃点分别一行 |
| F77 | N | tests/scenarios/S1-wait-copy-retirement.test.ts | tests/scenarios | IT20 |
| F78 | C | tests/architecture/state-writes.test.ts | tests/architecture | provenance/R/消息新字段/immutable anchor保护及decode白名单；1/3/5 |
| F79 | C | tests/state/invariants.ts | tests/state | R/anchor/copy断言，仅测试工具 |
| F80 | C | tests/state/session-availability.test.ts | tests/state | 新event穷尽覆盖/明确ctx事实/retired reactivate拒绝oracle |
| F81 | C | tests/state/message-machine.test.ts | tests/state | 新event穷尽覆盖，原消息各行不改 |
| F82 | C | src/core/agent-runtime/execution-inputs.ts | AgentRuntime | routed回复供给/有效handler/inputId去重；1/3 |
| F83 | C | src/core/work-graph/persistence/execution-entry-codecs.ts | WG/persistence | inputBinding.anomalyAnchorRefs严格shape；1/3 |
| F84 | C | src/core/work-graph/tasks/execution-entry-service.ts | WG/tasks | 实际authorize调用refsMatch guard；1/3 |
| F85 | N | tests/runtime/S1-routed-replies.test.ts | tests/runtime | IT28–30 |
| F86 | N | src/core/work-graph/tasks/session-provenance-facts.ts | WG/tasks | 可信旧来历证明，禁止sessions向上import |
| F87 | C | src/app/core-http-types.ts | Host | 【lead 改：L5】11 个新 suffix 加进 `CoreRouteSuffix`（唯一声明处），新路由的输入/结果类型；1/3/5 |
| F88 | N | src/contracts/platform-duty.ts | Contracts | 【lead 改：L4】共用的 `PlatformDutyV1`，原文见 README“共用文件”，逐字节相同；1/3/5 |

【lead 改】草稿的 F19（`persistence/claim-outbox-codec.ts`）删去（L1），ID 不重排。

不需要改package.json/锁文件、RecordStore后端、WorkspaceTools、module-target.json、vendor/dist、src/ui。【审查改】Outbox codec 不下移（§0.2 L1），不得带着本片做任何 codec 重排。Runtime 直接利用已有 executions.readContinuationBasis、kernelStores、workspaceHost/workspaceSource；`src/core/agent-runtime/execution-contracts.ts:RuntimeExecutionDependencies` 不增加新依赖口，不在清单中。清单外的真实依赖问题须报UNSPECIFIED交lead核对，不能隐含扩大写范围。

本次文档写入只有 `model-work/slice-1/SPEC.md`。正常施工验收后主仓HANDOFF/能力/实施计划/证据同步由lead另给明确写范围；本任务禁止改这些真源，不能假装已经完成文档同步。

## 7. Lead 技术选择与 needs the user

### 7.1 技术选择（都不能改变产品裁决）

| ID | 选项 A | 选项 B | 推荐及冻结后要改的地方 |
| --- | --- | --- | --- |
| T1 changed-files fallback | 不存执行起点baseline；Kernel→当前HEADworktree→unknown，始终披露归属不明 | 在start前保存完整/有界路径hash baseline，结束按该baseline比对；只保存HEAD commit不足以发现已有dirty文件的变化 | 【lead 定：A】A，本草案按A列类型/文件/测试。B需另列Run字段、baseline Artifact容量/并发/失败/重启策略、state构造、codec兼容、workspace reader、开始capture失败行为；不得只写“baseline已知”。仍必须警示可能混别的执行 |
| T2 Work按Session索引 | 索引已有Outbox.claim，generation可靠；（【审查改】codec 不下移，见 §0.2 L1） | Run新增claimSessionRef/generation，所有旧Run用outbox回填 | 【lead 定：A】A，少两份同步事实、旧数据已有索引路径；设计所需3个Session相关lookup不变 |
| T3 组合恢复身份 | 内部ArchiveStepRef从不可变R派生；R保存首次executionPins供既有控制/认定API，内部fingerprint不含动态读guards | 每步的完整公开GraphWrite/pins持久保存回Session，再执行 | 【lead 定：A】A，见§2.3；不能把公开API的expected从fingerprint删掉或在重试中换掉。B增加request progress fields和额外提交，不另建Operation |
| T4 旧来历 | 一次性null→事实补齐，由state和事件记录依据；lookup直接覆盖 | 永久只读时恢复，所有forward查询额外扫描旧Session和manifest | 【lead 定：A】A，明确限定旧数据；没有证据就根线，冲突显式incomplete |
| T5 软排序 | 稳定Kahn，所有真实依赖优先，ready平局required/plan/id | required/optional先分桶，各桶内拓扑，跨桶边只提示 | 【lead 定：A】A，依赖顺序才完整；本片不增加eligibility门，测试UT36/39锁住语义 |
| T6 自动归档设置 | Host可信SessionArchivePolicy注入默认一天，未来项目设置提供同getter | 现在新增项目设置aggregate/保存route | 【lead 定：A】A，避免抢第5/6/7片设置存储；默认/校验必须在production装配 |
| T7 锚点消费 | inputBinding refs+实际entered事实派生已接手，anchorimmutable | anchor增加mutablepickedUp字段，进入时更新 | 【lead 定：A】A，明确时间点，不再维护第二份状态；prepare失败不算接手 |
| T8 转走回复发现 | 新增handler lookup，readRoutedReplies直接取目标原消息 | 遍历workspace的Sessions，逐个readOutbox再筛handler，bounded并返回incomplete | 【lead 定：A】A，本稿因此共6新lookup；不存第二份Message或改sender。B少一个index但每个安全点读放大，不能靠已清掉的R发现回复；采用B要重写预算/游标/测试 |
| T9 请求清除后的授权/回放 | R保存现有receipt locator，Step携带locator，用原Requested事件还原 | 每步携带原public输入与expected pins，调用方自行重算初始fingerprint | 【lead 定：A】A，沿Query submission locator样板；R在final清掉，回执仍可验证。B不能依赖内存、当前revision或随机requestId；须另冻原输入保存位置 |
| T10 普通领取的历史输入 | archiveOrigin分支仅带Task事实链/锚点brief，不seed旧线完整历史；无archiveOrigin的原C3照旧 | TaskRequeue.historySource的原seed规则全保留，provenance仍按决定43写new/保留复用目标值 | 【lead 定：A】A，避免把普通领取技术上做成旧线接续；不丢锚点/Task事实、不动复用目标历史；原paused特例经非archiveOrigin原C3保留。选择B须明确brief.seededFrom与Session工作线来历是两个概念，改IT16/27期待 |

这些选项由lead冻结，不让DSH自行挑。不把“技术问题”用来改变用户的归档、等待转走、取消是终态或暂停继续规则。

### 7.2 needs the user：两处尚不能按原文同时满足的边界

【lead 改】下表是草稿原文，保留作依据。冻结结果：U1 列为 OPEN，见 §0.1（本规格对这一支冻结为“不新增行为”）；U2 由 lead 定，见 §0.2 L3（没有执行不写锚点，只放下负责关系；不返回 `archive_no_execution_anchor`）。

| ID | 设计原文与当前事实 | 尚缺的行为裁决；DSH应如何处理 |
| --- | --- | --- |
| U1 自动退休归档但Run仍unknown占用 | DESIGN §4.5：“退役、没有接续的线马上归档”；同节结果未知：“你确认，就走已有的‘认定’”；自动归档：“没人在场，所以这里只走不需要人选的路”。现有SES-19允许missing/damaged且occupancy仍在，RUN-20 unknown也不释放 | 不能同时自动马上archive和必须人认定才能释放。选项(a)先记R和异常待办，保留占用/归档中，等人确认；(b)明确授权退休自动处置unknown占用并定义证明/异常语义。两种都改变看到的状态，本稿不裁定。正常无占用退休按已定马上归档；这个分支返回busy/archive_unknown_confirmation_required并列为未冻结，不声称已满足全部slice1 |
| U2 未完责任从未有Run | DESIGN §4.5：“手上没做完的任务…写一条锚点”；附录C：“一条锚点一个执行”。现有Workflow先createSession(initial responsible link)，后claim；期间Session可能missing/retired，任务有责任但没有Attempt/Run | 选项(a)允许无Run的Task级异常锚点，另定身份/接续段；(b)保留负责关系放下事实，但明确这种情况无需执行异常锚点。不能虚构Run/Attempt满足record类型。本稿覆盖有真实Run的所有分支；无Run返回incomplete/archive_no_execution_anchor并保留待办，在lead获得裁决前不宣称这条完成 |

这两项是实现读当前代码找到的**窄分支**，不重开决定42/43的正常行为。UNKNOWN文件清单不是U1：路径未知仍可写anchor；U1说的是执行是否已停止和占用能否释放。另片AMB-26/63/64、秘书archive请求归属等按§1.2留后片，不在本片替用户选。

## 8. 大小、验收边界与DSH风险规则

【lead 改】冻结的数量以 §0.6 为准（87 个文件，新建 38、修改 49；151 个用例，212 次）。下面是草稿原文：按本稿推荐选项、U1/U2未扩展时：**86个计划源码/测试文件**（59源码、23新测试文件、4现有测试工具/门禁/矩阵文件），其中新建38、修改48；19条状态行、6新lookup（3设计Session索引+2anchor索引+1技术handler索引）、1新正式aggregate、11新route；**148个逐行案例**（55 unit、61双后端service、32集成/场景），双后端展开为209个案例（额外61）；6崩溃点已分别列入，不能再加5虚计。另有状态穷尽矩阵和route表项子例，准确最终it数由阶段1固定清单报告，不把未知矩阵数假报成确定总数。

行数是估算而非DSH验收数字：生产净新增约2,600–4,100行（contracts/codec/index约700–1050；state约450–700；owner/取证约800–1150；Workflow/Runtime/Host约650–1200），新增/扩展测试约2,100–3,200行；codec下移约100–180行只有位置变化不计新增。U1/U2或T1-B会扩大范围，必须重算；不为压行删state规则注释（决定35）。建议DSH按骨架/测试与实现两阶段，不按文件量机械切成多批，保留每片DSH/lead用量记录（决定43）。

DSH任务书必须逐句带入以下规则（源于DSH-WORKFLOW §6，不写空泛“照仓库惯例”）：

1. **对外和内部幂等分开。** 公开GraphWrite保留expected在fingerprint；内部恢复guard可变、身份不变。相同请求只重放原事件，不读当前行代替结果；不能用随机requestId重试。
2. **停止不是成功。** cancel queued不释放占用；unknown不以无日志推断已停；Query不能cancel；archive不能顺手completeTask或开检查。U1按§0.1冻结为跳过（记入failures），U2按§0.2 L3（没有执行不写锚点）；遇到这两条以外的同类空白报UNSPECIFIED，不能写猜出的行为。
3. **等待和回复不同。** responded未consumed仍waiting；transfer不重问、不改sender；cancel旧yield只封续接，不删回复。不得给新的Session自动转交退休消息。
4. **别加反向边。** sessions不importtasks/queries（Session事实经model的SessionFactsPort注入，§0.2 L1），state不importmodel或node包；不搬codec；不改module-target.json“修绿”。
5. **来历不等于每次Run的前任。** 复用Session不改provenance；正常接续才同线；anchor后普通新领取是new；分叉允许；copy永不干Work。
6. **索引不复制状态。** 六lookup各有唯一owner；lookup按key排序、latest按claim.generation；分页没结束返回incomplete，不拿部分页证明不存在wait/continuation；sourceCursor来自真实Store读水位。handler回复仍是原Message，inputId不变。
7. **archive复合失败不是零写。** 先把已完成处置列明，exact message“处置已完成，归档没成功”；绝不回滚已停Run/已转责任。R存在期间所有新claim入口也必须守卫，不能只在chooseSession过滤。
8. **改动归属不能吹成确定。** Kernel确定/可能分别列；workspace fallback全possible，runBaselineKnown=false；unknown路径空不等于没修改；paths64上限与omitted计数明确。
9. **anchor不会自带授权/验收。** anchorimmutable，一个Run最多一条；接手由真实entered+manifestref证据；claim/prepare不算；人暂停还等人继续。cap豁免要核durablearchive，不给通用“skip cap”开关。
10. **旧bytes保留。** 旧brief不补新key后重新算hash；旧eventreceipt不覆盖；新字段存在但坏不能default；不把MODEL分析时间/role/内嵌正文搬生产。
11. **维护不启模型。** 没timer、每次最多一页，startup在核对后才维护；copy答案先保存/关联，再归档；归档失败不重答。
12. **软排序不是等待上游。** expected_dependency/parent_of不入真实DAG；不可执行上游后继续尝试下游；不得在claim owner加新dependsOn完成guard。

交付报告固定四段 `FILES CHANGED / CHECKS / UNSPECIFIED / NOTES`，逐项给实际文件/主案例/展开案例/检查命令与结果；列每个规格和代码惯例冲突并引用位置。lead审阅反馈要给file:symbol、违反的本稿规则和思考方向，不只贴测试输出。绿色检查只说明这份限定规格和已冻结分支，不代表编排全部、整个MVP或真实大规模UI验收完成。
