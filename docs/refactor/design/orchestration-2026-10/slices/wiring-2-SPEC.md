# 接线包 2 规格：I-2、I-4、I-5、I-6

**后注（决定 49 第 29 项、决定 50）：** 约 18、44、444 行「整份规格/清单和夹具待冻结」已不成立：本规格已冻结并合入 bb924854。正文原样保留，只加此注。

2026-10-13 lead 冻结（L10–L12 已定；§5 按 TDD 重写：用户确认 6 个测试入口，验收行为表由 lead 写，测试由 DSH 一条一条写，Codex 只写夹具）

源码核对基线 HEAD `6c63f069bae9158201661f528a46500a44fba639`。第 1、3、5 片及接线包 1 已在 HEAD。依据：[分片总说明](README.md)“合入以后的接线”及三个有日期的“施工结果”；[第 1 片规格](slice-1-SPEC.md) §2.5、§3.3，[第 3 片规格](slice-3-SPEC.md) §2.4–2.5、§4.1–4.3，[第 5 片规格](slice-5-SPEC.md) §2.2、§2.5–2.6、§4.1–4.2、§8，[接线包 1](wiring-1-SPEC.md) §0、§4；[DESIGN](../DESIGN.md) §1.4、§4.5、§5.1、§7.2；[HANDOFF](../../../HANDOFF.md) 决定 42–49；[DSH-WORKFLOW](../../../DSH-WORKFLOW.md) §6.10。旧规格与已合入实现有差异处以下面点名的 `file:symbol` 为准；本次明确要求 **G 不动**，优先于旧接线包 L3 的预告。

本包只接四条线：

- **I-2**：消息发信职责从过渡映射改读正式角色事实，交 `effectivePlatformDuty` 求单一职责；原消息 owner 决定可不可以发送。
- **I-4**：`extensions.goalSettings` 接 `GoalSettingsPort.readGoalSettings`，自治值原样转交。
- **I-5**：原 Session/消息 owner 同事务保存最近一次进入不可用/回复的位置，`undelivered_reply` 接 `SessionMailboxPort.readUndeliveredReplies` 并取较晚位置；按完整 `messageRef + responseRef` 去重。先回复后不可用和先不可用后回复都按进入未送达的位置提醒；恢复后退出，再次不可用按新位置提醒。读列表不转交、不确认消费。方案 B 按 L10/L11 修订，不改 SES-13。
- **I-6**：`extensions.decisions` 接 `DecisionReadPort.queryDecisionQueue` 的待答卡，并补上装配器把这些行放进提醒段的消费端。行格式及任务关联口径见 L5，均【lead 定，待审】。

## 0. 草稿说明

### 0.1 U1 已定；位置方案与源码核对

**U1：【已定（决定 49）】第 29 项选甲。** 回复早已保存、未被执行消费，后来因原 Session 进入不可用而进入“未送达”，也算新提醒。进入位置必须可以重放；同一段不可用期间重复读取不产生新位置，恢复后退出，再次进入不可用则产生新位置，不跨次去重。原回复和转交历史保留，不自动转交。依据：[HANDOFF 决定 49](../../../HANDOFF.md)、[DESIGN §4.5](../DESIGN.md)、[MODEL O24、R35](../model/MODEL.md)。产品选择不再待定；L10/L11 已由 lead 定，整份规格待冻结。

路径约定：`sessions/`、`state/`、`communication/`、`configuration/`、`tasks/`、`queries/`、`views/`、`model/`、`persistence/` 均省略 `src/core/work-graph/`；`record-store/` 省略 `src/core/`；`contracts/`、`composition/` 省略 `src/`；Runtime 文件省略 `src/core/agent-runtime/`。标“拟增”的符号是本包设计，不冒充 HEAD 已有实现。

**先查能否从已有持久事实推出。**

| 查什么 | HEAD 的 `file:symbol` 与结论 |
| --- | --- |
| 不可用是否永久 | 不是。`state/session-availability.ts:healthObserved/observeSessionHealthRecord` 允许 active + unavailable 经 ready probe 恢复 available；结论为 kernel_turn_open 时还须 Kernel head.activeRunId===null。`sessions/session-health.ts:recordSessionHealth` 正式执行此分支。`reactivated` 拒绝 archived + unavailable（决定 38），是另一条 lifecycle 守卫，不得外推为不可用永久化。**L10 保留 SES-13，不改恢复分支。** `STATE-MACHINES-SPEC.md` 的 health_observed 行及 Session 状态表、Host 重启三文件（§5.7）均依赖它；K 片 [DESIGN](../DESIGN.md)“关掉以后，Session 按已有规则 SES-13 回到可用”（决定 49）也依赖它。 |
| 不可用写了什么 | `contracts/core/session.ts:SessionRecord` 有 health、healthConclusion、lifecycle、revision、createdAt、archivedAt、historyCursor，无不可用提交位置。`state/session-availability.ts` 中写 health 的记录构造器只有 `createSessionRecord`（初始化 available）、`releaseSessionRecord`（open Turn 释放可进入 unavailable）、`observeSessionHealthRecord`（available 与 unavailable 双向迁移）；`archiveSessionRecord/reactivateSessionRecord` 只改 lifecycle，`occupySessionRecord` 只接受 available，不改 health。revision、创建/归档时间和 Kernel 完整 Turn 边界均不能当最近一次进入不可用的位置。 |
| 同提交有无顺序 | 有。`sessions/session-health.ts:recordSessionHealth` 同提交写 Session 和 `SessionHealthObserved`（occurredAt、observed/probe、完整 session）；`record-store/sqlite-record-store.ts:appendEvents/commitInsideTransaction` 用 events.id 生成 cursor，同事务存 `PersistedIdempotencyRecord.aggregateRevisions/commitCursor`；`record-store/in-memory-record-store.ts:createInMemoryRecordBackend` 内 appendEvents/commitPrepared 同样做。**顺序已持久化在账本，不等于 Session 快照已能定位它。** |
| 是否所有进入不可用的事件都直接带 Session | 否。`tasks/run-reconcile-service.ts:commitDecided` 经 `tasks/execution-entry-service.ts:claimEffectRecords` 同提交写 Session，但结果事件只带 Run；`queries/query-execution.ts:settleRecovery/buildRecordedEvent` 在 result 中带 Session；健康观察事件也带 Session。`recordRunResult` 的 terminal_observed/reconcile_terminal/late_evidence 在 `state/run-machine.ts` 均以 kernelTurnOpen:false 释放（未知终态分支不释放），不能首次进入 unavailable，只能保持已有 health/位置；不把它列为新位置写者。 |
| 回复保存位置 | `model/communication-contracts.ts:SessionMessage/UndeliveredReplyV1` 只有 response.respondedAt；`state/message-machine.ts:nextSessionMessageRecord` 保持单 response slot。`communication/mailbox-service.ts:commitPreparedSessionMessage` 只在**问题创建**绑定 wire.since，其后经 preservedNoticeOrigin 保留；所以 since 不是回复位置。 |
| 原来源看得见什么 | `communication/mailbox-service.ts:readUndeliveredReplies` 直接 decode SessionRecord 和消息，按 health===unavailable、response 非空、无 response acceptance 过滤；DTO 没有位置。底层 `record-store/ports.ts:EncodedRecord/RecordBatchRead/GoalRecordTransactionPort` 只给当前 revision、批量 readThrough，eventAt 要先有 cursor，lookupCommit 要 identityKey+fingerprint；没有按 Session 版本查提交或历史分页的 port。`views/goal-conflicts.ts:DecisionReadRecordsPort` 更只有 readMany/lookup。 |

**两种技术选项（数字与 §0.5、§5、§6 同口径）。**

| 项 | A：完全从已有事实派生 | B：原记录加两个提交位置（L10/L11） |
| --- | --- | --- |
| 精确输入/字段 | 想用最近一次 available→unavailable 提交 R 和写 response 提交 P 的 `commitCursor`，以同 itemKey 构成 commit position 后取较晚者。Session revision、事件时间、问题 since、readThrough 均不能替代 R/P；已有 port 不提供版本到提交的反查。 | 拟增 `SessionRecord.unavailableSince?: CommitCursor \| null` 与 `SessionMessage.responseSince?: CommitCursor \| null`。R 每次进入 unavailable 置 pending null，由原提交绑定；恢复 available 清除字段，归档保留。P 首次回复置 pending null。持久读不允许 null；旧缺字段保留 undefined。notice 仍为现有 `NoticePositionV1`，不另存 enteredUndelivered。 |
| 正式写者、索引 | 理论上可回查账本并重放 health/Work/Query/消息各类 owner，但 HEAD 没有这种读链，现有窄接口不能完成 A；不得在 views 解析 SQL、猜 cursor 或拿本次水位代替事实位置。 | `state/session-availability.ts:releaseSessionRecord/observeSessionHealthRecord` 定每次进入/恢复的字段变化，原 health/Work reconcile/Query recovery 提交尾机械绑定；`state/message-machine.ts:nextSessionMessageRecord` 的 responded/decision_answered 标记回复，原 mailbox 共用提交尾绑定，decision-service 独立回执路径也用原 cursor 还原。复用两个快照与原索引，**0 新索引**；详见 §2.3。 |
| “均 0”影响 | 新记录/字段/索引/事件虽可报 0，但不能给可靠位置，不构成可交付方案。 | 新 aggregate/索引/事件/路由/工具仍 0，**持久字段 +2**；既有记录构造规则调整 2 组，§3 增 3 条写流程。SES-13 迁移及守卫不变；不是新通知表或读 adapter 写状态。 |
| 文件/用例/运行影响 | A 的否证预算：原 16 路径，含 NR21–30 后 72 用例/92 次，无 ST01–04；NR21/23/28 不能仅凭 HEAD 字段全部满足。这不是可交付 A 的施工承诺；若改历史扫描须另定接口、覆盖及清单。 | §6 共 **32 路径（新 10、改 22）**；§5 共 **76 用例/100 次**。较旧稿 +16 路径、+14 用例、+26 次；6 个新测试文件、3 个新夹具文件。此次审后删 W224、W233–W235 的修改安排，增 W236，净减 3 路径；用例 ID/运行数不增减。 |
| 并列/时钟风险 | Session 局部 revision 不能跨线比较；occurredAt/respondedAt 同时或回拨会漏提醒；按 key 打破时间平局也不能补出真正顺序。完整事件重建若以后有可验证接口，才可消除此风险。 | `views/notice-position.ts:compareNoticePositions` 按 ledger sequence 后按 itemKey；同次不可用的多条旧回复共用 cursor，由完整二元 key 排序。同 cursor 必须完整翻页，不能按 cursor 单值去重。时钟回拨不影响顺序。 |
| 旧库风险 | 只有完整定位原提交才可重建；最新快照不能恢复进入不可用发生在哪个版本，任意旧库的完整历史也无保证。 | 先核实消息归属并排除已证明不在请求 Goal 的项；仅范围内缺 R/P 时 `incomplete/undelivered_reply_position_missing:`。受影响 Goal 及无过滤 Workspace 查询仍明确失败；其它 Goal 的历史缺字段不阻断过滤查询。原 mailbox 列表保留历史，不降级时间、不写回；坏 cursor/持久 null 仍是损坏。人工迁移另批。 |

**【lead 定，L10/L11】采用 B 的两位置定义及审后修正。** A 的 max 数学关系成立，但 HEAD 没有向读端提供可定位的两个位置。B 在原 owner 写事实时固定位置，恢复时清除 R，再进入时重写 R，不扇出改全部消息；读取只取 max。依赖遵守 state 纯函数及 views 只读规则；状态字段只能在 `state/` 构造，RecordStore 仅机械绑定原提交的 null 槽。整份清单和夹具仍待冻结，不再把 SES-13 永久化当成前提。

本次不新增转交按钮、提醒频率、自动唤醒或“看过即收到回复”的规则。决定 49 第 28 项的窄索引、完整分页及 200 Goal 上限处理属于第 2 片；L6/L7 的本包有界读取不得变成产品永久容量或按年龄丢弃待办的规则。

### 0.2 技术选择（L10–L12 已定；L1–L9 lead 定）

- **L1【lead 定，待审】I-2 用角色事实，不复用 I-1 的 `'unknown'` 自动归档兜底。** `configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter` 保留原 `roles.resolveRoleBindingFacts` 及其 guards，增加 Session 只读依赖和 pin 读取。角色正文取 Session 固定的 `role_spec.pin`；legacy 只认 composition 从 `agent-runtime/role-profiles.ts:platformRoleProfile` 传来的五个完整模板及版本。有效职责调用 `state/context-input.ts:effectivePlatformDuty`；两种职责都缺席时，沿该函数的缺省 `executor`，不是给未知角色任意授予秘书权。当前执行入口 `tasks/execution-entry-service.ts:contextConsumptionProblem` 也是角色/版本化模板/缺省 executor 这条规则。
- **L2【lead 定，待审】读取失败与无职责分开。** 当前过渡 adapter 在 role resolver 拒绝后仍可能尝试 legacy 映射；正式 adapter 不沿用这个分支。`rejected` 原样返回，`not_found/not_ready` 原样返回，throw 转 `unavailable`；`ready/inadmissible` 回 `forbidden`，不降级。`ready/absent` 只代表已经核实没有角色矩阵，仍读 Session 固定角色。Session 版本 guard 与 resolver 的 guards 一起交原 owner；角色 pin 不随激活指针更换。`readOnlyCopy` 来自 `SessionRecord.provenance.kind==='readonly_copy'`。`independentReview:false` 仅适用于当前 `mailbox-service.ts:sendUserMessage` 唯一能走到 adapter 的 `work_run` 入口；独立审阅/普通 Query 没有这条发信入口，不能把 `duty==='reviewer'` 直接等同独立审阅（`state/decision-policy.ts:canSendUserMessage` 允许普通 reviewer 发 notify）。
- **L3【lead 定，待审】删除过渡注入，不保留第二种生产授权。** 删除 `MessageDutiesFactV1`、`MessageDutiesMappingPort` 和 `TargetPlatformOptions.messageDutiesMapping`。三个仍构造 mapping 的既有测试辅助文件改为显式 `MessageDutiesFactsPort` 测试替身，保留其 `f.duties` 测试旋钮；它们测的是决定落实/重放，不能为迁移夹具改正式 Session 的角色或放宽生产 adapter。新增 I-2 集成用例单独验证正式 adapter。
- **L4【lead 定，待审】I-4/I-6 继续用接线包 1 的扩展提供方。** `views/context-extensions.ts:createContextExtensionsReader` 增加可选的 `goalSettings`、`decisions` 窄依赖，production composition 必装；旧窄替身没装时分别 `not_implemented`。顺序为已有参数/scope/signal 检查 → anomalies 原路径 → goalSettings → decisions；失败停止，不把已装但读坏的来源变成 `available/[]`。Host 上下文仍只在图读取器已授权后、以同 project/workspace/signal 构造，不发布新的 HTTP 或模型入口。
- **L5【lead 定，待审】I-6 行格式、任务关联和不完整提示。** 卡行 `key='decision:'+card.cardKey`，与 `anomaly:<refkey>` 同层。`node` 统一指请求 Goal，避免在无活动 Plan 的 Goal 上伪造 task/plan ref；文本与 sources 见 §4.3。请求有 focus 时只留明确涉及该任务的卡和无明确任务的 Goal 卡；关联从 `source.pins` 与 `objects[].pin` 的正式 Task 指称读取，不从中文摘要、发信人最后一轮或裸 taskId 猜。当前 `tasks/goal-decision-reader.ts:taskPin` 使用 `{aggregateType:'Task',projectId,goalId,taskId}@0`，这是指称，不是持久 aggregate。`countsComplete:false` 不能当作 queue 故障：HEAD 的 note_review/message_release 仍未接，连只要待答卡的读取也会因其它来源缺席而为 false。只针对七个卡来源的 `not_available` 加明确提示行，忽略 notice 类别的可用性，不说“全部没有待决”。
- **L6【lead 定，待审】I-6 翻完本次窗口，不按筛选后的行数停。** 每页 100，暂限 50 页/5,000 张输入卡；正好 5,000 且无 next 通过，有 next 回 `capacity/decision_index_page_limit:`，不得返回半份 rows、截断后称完整或按年龄丢掉待答/待落实。此数只是本包聚合防护，**不是产品永久容量**；决定 49 第 28 项已把窄索引、完整分页排到第 2 片，届时必须联动撤换该防护，不能让上层 5,000 再挡住已可完整分页的后端。本包不提前实现第 2 片，也不声称已解决规模读取。当前 `views/decision-read-model.ts:SOURCE_PAGE_LIMIT/SOURCE_MAX_PAGES/SOURCE_MAX_ITEMS/readDecisionQueueWindow` 还有每源窗口；后端拒绝原样返回。各页 sourceCursor 必须相同，否则 unavailable；focus 过滤空页仍跟 cursor，不缓存半份队列。
- **L7【lead 定】I-5 读源只投影，位置由原写者提供（按 L10/L11 修订）。** 新 `views/undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource` 实现已有 `model/decision-contracts.ts:DecisionNoticeSourcePort`；原 mailbox DTO 新增两个可选 cursor（§2.3），source 不拥有 commit。`sessions/session-directory.ts:findSessions` 以 includeArchived:true 枚举同 Workspace，每页转交调用方 page.atLeastCursor；只对 health===unavailable 的线读来源。先核消息归属/Goal、排除确定不在过滤范围内的项，再要求 R/P。目录和每线来源各每页100/最多50页，去重输出最多5,000，仅为本包防护。所有水位同窗；目录续页 source_stale 丢弃已积累行和内部游标，连同水位变化最多整窗尝试四次；空目录/全可用也须满足最低水位。SES-13 恢复及原 health 过滤保留。
- **L8【lead 定】I-5 按最近一次进入未送达的提交位置提醒（按 L10 修订）。** `itemKey='undelivered_reply:'+canonicalJson({messageRef,responseRef})`，responseRef 是完整 ArtifactRef。构造 `R={kind:'commit',cursor:unavailableSince,itemKey}`、`P={kind:'commit',cursor:responseSince,itemKey}`，只用 `views/notice-position.ts:compareNoticePositions` 取较晚者。先回复后不可用取 R，先不可用后回复取 P；恢复后退出集合，再次不可用写新 R，同 key 可成为新提醒，不跨次去重。同 cursor 按完整 itemKey 排序。summary 为 `未送达回复 · Session ${sourceSessionRef.sessionId}`，objects 指原消息当前版本，rework:null。respondedAt 只作元数据；问题 since、archivedAt、revision、sourceCursor 不参与位置。范围内旧数据缺字段明确 incomplete，不用 legacy 时间兜底；同一段不可用内重复读/归档/转交/重放不换位置，显示后才推进已看。
- **L9【lead 定，待审】提醒是索引，不新增消费守卫。** `agent-runtime/context-assembler.ts:optionalRowsFromExtensions` 将 decision 行合入 reminders，仍按既有预算、全行省略和字符码排序。`ContextIndexRowV1.sources` 保留来源，但不把这些提醒的 pins 合并进执行准入的 `binding.sources`；当前 `views/graph-context-reader.ts:readContextFacts` 的顶层来源本来只取 `baseSources`。待决卡变化不应使不相关的已准备执行卡住。改这项会涉及新的准入行为，超出 I-6。
- **L10【lead 定】保留 SES-13；未送达位置取最近一次进入不可用。** unavailable 不是永久退役。`SessionRecord.unavailableSince?: CommitCursor | null` 记录最近一次 available→unavailable 的提交 cursor；所有改变 health 的记录构造器在 `state/session-availability.ts` 内处理进入置 null、恢复清除，原 owner 同事务绑定，归档保留。构造器及实际 writer 穷举见 §2.3。notice=max(R,P)，恢复后随原 health 过滤退出，再次不可用以新 R 再提醒；短暂不可用同样提醒。不能改 SES-13、增加永久化前提或修改旧测试来拒绝恢复；Host 重启、K 片和 §5.7 的原测试保持。recordRunResult 只验证保持已有位置，不承担首次进入不可用。
- **L11【lead 定】五项审查修正全部接受。** ① `communication/decision-service.ts:replayMessage` 用原 receipt.cursor 调同一 state 回复绑定函数，NR25 对照首次答复/重试/重开字段；② NR24 按真实健康观察、Work reconcile/认定和 Query recovery 路径造进入不可用，W224 移出修改清单；③ 先定消息归属和 Goal，再对范围内项要求位置，NR28 分其它 Goal/受影响 Goal/无过滤 Workspace；④ 目录续页 `source_stale` 整窗重读，不直接传播 rejected，NR14 覆盖四次上限；⑤ `page.atLeastCursor` 传入 findSessions，NR13 覆盖空目录及全 active + available 目录。§0.5、§5、§6 同步。

- **L12【lead 定】Four old whole-object assertions are completed for the new fields, not loosened.**
  - `tests/state/session-availability.test.ts`：`releaseSessionRecord` 的 “kernelTurnOpen writes unavailable…”（原1054行断言）及 `observeSessionHealthRecord` 的 “writes missing/damaged…”（原1108行断言），在完整期望对象中增加 `unavailableSince: null`。
  - `tests/work-graph/S1-wait-disposal.test.ts`：SV33/SV34（原151、173–174行）增加两个 cursor 字段，精确值从夹具实际提交的记录读取；不使用 `expect.anything`、`objectContaining`，不删除字段。
  - 四处均由 Codex 在测试编写步骤修改；lead 与新测试一起核对并以 sha256 冻结，DSH 不得修改。
  - 除这四处外，不得修改其它旧业务测试；§6 已列的三个 mapping 辅助文件和架构保护表按各自范围修改。

**L1–L9 的 HEAD/决定 49 复核（L7/L8 按 L10/L11 修订，其余保留）：**

| 项 | 保留/调整及一句理由 |
| --- | --- |
| L1 | 保留：`state/context-input.ts:effectivePlatformDuty` 与 `tasks/execution-entry-service.ts:contextConsumptionProblem` 支持固定角色/版本化模板/缺省 executor；决定 49 未改职责来源。 |
| L2 | 保留：`configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter` 确有失败后 mapping 回退；`communication/mailbox-service.ts:sendUserMessage` 的 Work 分支与 `state/decision-policy.ts:canSendUserMessage` 支持原拒绝边界。 |
| L3 | 保留：`composition/create-platform.ts:TargetPlatformOptions/createTargetPlatform` 仍注入 mapping；删除该生产旁路，不变更决定落实的业务政策。 |
| L4 | 保留：`views/context-extensions.ts:createContextExtensionsReader` 仍只有 anomalies，`composition/create-platform.ts:createTargetPlatform` 已有两个 raw owner 可接。 |
| L5 | 保留：`tasks/goal-decision-reader.ts:taskPin` 的 Task@0 只作指称；`views/decision-read-model.ts:cardInScope/readDecisionQueueWindow` 的双 Goal 与 capabilities 规则仍成立，决定 49 不授权猜任务关联。 |
| L6 | 调整：明确 5,000 是暂时失败边界，必须随第 2 片完整分页联动；不得和决定 49 第 28 项相冲突或丢旧待办。 |
| L7 | 调整：按 L10 保留 SES-13，按 L11 补 Goal 过滤先后、source_stale 整窗重读及目录最低水位；HEAD 原 DTO 尚不带位置。 |
| L8 | 调整：R 为最近一次进入 unavailable 的提交，恢复清除、再进入重写；max(R,P) 仍用原 compareNoticePositions，U1=甲不变。 |
| L9 | 保留：`context-assembler.ts:optionalRowsFromExtensions` 缺 decision 消费，`views/graph-context-reader.ts:readContextFacts` 顶层 sources 仍取 baseSources；提醒不增准入守卫。 |

### 0.3 G 与本包的边界（本次要求，不待 DSH 选择）

**I-4 不新增任何修改 Goal 的动作，也不让修改 objective 成为可能。** 但不能说“Goal 内容现在完全不能变”：第 5 片已有 `tasks/goal-settings-service.ts:setGoalSettings` 写 `GoalSnapshot.settings`；`persistence/record-codecs.ts:readGoalSettings` 为缺字段的旧记录提供默认值。I-4 只是把这个已经可变的自治值读进 `context-assembler.ts:goalPayload`。

G 的实际摘要是 `contracts/graph-context.ts:goalContextContentV1` 的 `{contentVersion:1,goalId,objective,workspaceId}`；`state/context-input.ts:contextGoalContentProblem` 与 `tasks/execution-entry-service.ts:contextConsumptionProblem` 比较它。`state/goal-machine.ts:GoalEvent` 仍无改 objective 的事件。**本包不改这些函数、版本或 Workflow 的 G 重准备分支。** 新准备显示当前自治；准备后改自治不触发 G，也不重新装配已绑定输入。自治相关的实际动作权限继续由第 5 片原 owner 在动作时检查。

这与 wiring-1 §0 L3、README 夜间施工结果中“把自治加入摘要并升到 2”的预告不同；本次用户明确说保持 G 不动，故本草稿不执行那个预告。不能把本包验收写成“自治的准备后变化已被 G 拦住”。以后若要求这一行为，另列变更；不通过改数据库 objective 来假造本包生产场景。

### 0.4 核对依据与已建成的接缝

| 项 | HEAD 的真实入口及差异 | 本包落点 |
| --- | --- | --- |
| 第 1 片 | `model/communication-contracts.ts:UndeliveredReplyV1`；`communication/mailbox-service.ts:readUndeliveredReplies` 是按 Session 的可选 port 成员，实际工厂已实现；来源读不含 Goal、没有通知位置 | I-5 补两字段/DTO及投影；保留原 acceptedInputs 排除，按 §2.3 补每次进入/恢复的位置记录与正式写入 |
| 第 3 片 | `state/context-input.ts:effectivePlatformDuty` 已有；`context-assembler.ts:effectiveDuty` 的 Runtime 装配还会检查 Host duty；`optionalRowsFromExtensions` **只**消费 anomalies，没有 decisions | I-2 用正式纯规则；I-6 同时接生产者和消费者，不误称已经会渲染 |
| 第 5 片 | `tasks/goal-settings-service.ts:readGoalSettings` 返回 `{goal,settings}`，不是裸 settings；决定读接口实际叫 `model/decision-contracts.ts:DecisionReadPort.queryDecisionQueue`，没有 `readDecisionQueue` | I-4 取 `value.settings.autonomy`；I-6 只取 `waitingAnswer` |
| 接线包 1 | `views/context-extensions.ts:anchorRow/createContextExtensionsReader`；`composition/create-platform.ts` 已装 anomalies；`composition/session-duty.ts:createSessionDutyResolver` 已承担 I-1 | 原 anomalies 文本、排序、25 页上限及 I-1/E15/G 全保留 |
| 第 5 片返工 | `views/decision-read-model.ts:queryDecisionQueue/readDecisionQueueWindow` 最多四个稳定窗口尝试；`views/goal-conflicts.ts:lookupAll` 正好 5,000 不算截断；`notice-position.ts:compareNoticePositions` 是唯一 notice 游标比较点 | 用例含精确边界，不能恢复“截断后假报完整” |

上表 WorkGraph 路径省略 `src/core/work-graph/`，Runtime 路径省略 `src/core/agent-runtime/`。施工事实按最新日期读取：[片 1](../../../reviews/evidence/orchestration-slice-1-2026-10-08/README.md)的原 E15 缺口已由[接线包 1](../../../reviews/evidence/orchestration-wiring-1-2026-10-09/README.md)补上；[片 3](../../../reviews/evidence/orchestration-slice-3-2026-10-08/README.md)的合入修正保留；[片 5](../../../reviews/evidence/orchestration-slice-5-2026-10-08/README.md)以“2026-10-09 夜：决定 48”验收为准，不采用上午“没有接受”的旧状态。历史全量是 279 文件/5,974 项及 verify:isolated 通过，不是本次起草重跑的结果。

### 0.5 数量和冻结条件

按方案 B 及 L12 的 §6 清单：**35 个实现/测试路径（新建 11、修改 24）**，生产 **19（新建1、修改18）**，测试及辅助 **16（新建10、修改6）**。DSH 写的新测试文件 **8**（W206–W210、W231、W239、W240；W231 按需），Codex 写的新夹具 **2**（W211、W213；W212 删掉）；修改测试侧的 3 个 mapping 辅助文件、1 个架构保护表及 L12 点名的 2 个旧测试文件。§5.5 除 L12 的四处补字段外，其余旧业务测试只回归、不改断言。

§5（2026-10-13 按 TDD 重写）不再预定用例数：**§5.2 共 29 行验收行为**（Z01–Z02、F01–F15、M01–M11、P01），每行至少一个测试，由 DSH 一条一条写。原来的 76 个用例、100 次运行作废。W232 只扩保护字段/纯函数名单，不增 it。

新 aggregate、索引、事件类型、路由、模型工具仍 **0**；持久字段 **2**，公共读 DTO 增2个可选cursor，机械 CommitCursorBinding 允许字段增2个。新状态迁移行 **0**；既有记录构造规则调整 **2组**（进入不可用标位置/恢复清除；首次回复标位置），**SES-13 的迁移与守卫改动0**。§3仍 **11条流程行**（8条读取/组合，P01–P03三条写入），P03改为原恢复提交清除位置。

**冻结条件：** lead 冻结规格，L10–L12 已定，SES-13 保留恢复；测试入口由用户 2026-10-13 确认。冻结的测试侧文件只有 §5.4 列的那些（2 个夹具、3 个辅助文件迁移、W232、L12 的两个旧测试文件），lead 核对后以 sha256 冻结，DSH 不得修改。新测试由 DSH 按 §5.3 写，lead 合入前按 §5.2 逐行核对并按 TDD skill 的反面清单审。除 L12 外旧测试保持原样。

## 1. 范围与职责

| 接线 | 写规则的 owner | 读/组合的 owner | 可见结果与边界 |
| --- | --- | --- | --- |
| I-2 | 原 `communication/mailbox-service.ts:sendUserMessage`、`state/decision-policy.ts:canSendUserMessage` | `configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter` | 正式 secretary/adviser/scribe 能发决定请求，executor/reviewer 仅 notify；工具/Host grant、当前 Run 准入、回执重放顺序都不变 |
| I-4 | 原 `tasks/goal-settings-service.ts:setGoalSettings` | `views/context-extensions.ts:createContextExtensionsReader` → `context-assembler.ts:goalPayload` | 新上下文显示原样自治值；读不到是读失败，没装是 not_implemented |
| I-5 | `sessions/session-health.ts:recordSessionHealth`、Work/Query 原提交写 unavailableSince；`communication/mailbox-service.ts:commitPreparedSessionMessage` 写 responseSince；`configuration/decision-settings-service.ts:markNoticesSeen` 写已看（详见 §2.3） | 新 `views/undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource` → `views/decision-read-model.ts:queryDecisionQueue` | 两条进入路径均按 max(R,P) 新提醒；原身份与 acceptedInputs 不变，读取零写；U1=甲已解决 |
| I-6 | 原消息/计划/目标 owner 决定卡状态 | 同扩展提供方 → `context-assembler.ts:optionalRowsFromExtensions` | 只展示本次读取到的待答索引；不答复、不自动落实、不放宽准入 |

## 2. 接口（新增名字/字段均为本包施工接口；§2.3 点名的两条记录和读 DTO 改动，其余公共 DTO 不变）

### 2.1 I-2：正式职责 adapter

```ts
// src/core/work-graph/configuration/message-duties-adapter.ts
export type MessageDutiesAdapterDependencies = {
  roles: RoleBindingFactsPort & Pick<RoleConfigurationPort, 'readRoleSpec'>;
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  legacyDuty: (role: Extract<RoleConfigurationRef, {kind:'legacy_template'}>)
    => PlatformDutyV1 | undefined;
};
export function createMessageDutiesFactsAdapter(
  deps: MessageDutiesAdapterDependencies,
): MessageDutiesFactsPort;
```

`roles/sessions` 类型从 WorkGraph/model 引入；legacyDuty 在 composition 用五个 `platformRoleProfile(d).template` 完整相等实现，不能让 configuration 向上 import AgentRuntime。`create-platform.ts:createTargetPlatform` 当前先构造 messageDuties、后构造 sessionDirectory；接入新依赖时把前者移到后者之后、mailbox 之前，不能留下未初始化引用。Session guard 的 key 用 `canonicalJson(record.ref)`（与正式 Session ref key 等价）；同 key guards 去重，版本不同则 `revision_conflict`，不任选一条。不改 `MessageDutiesFactsPort` 的输入/输出或 `canSendUserMessage` 的政策。

### 2.2 I-4/I-6：同一个提供方的两个依赖

```ts
// src/core/work-graph/views/context-extensions.ts
export type ContextExtensionsDependencies = {
  anomalies: Pick<SessionAnomalyPort, 'listSessionAnomalies'>;
  hostActor: Extract<ActorRef, {kind:'human'|'system'}>;
  goalSettings?: Pick<GoalSettingsPort, 'readGoalSettings'>;
  decisions?: Pick<DecisionReadPort, 'queryDecisionQueue'>;
};
// createContextExtensionsReader 的返回签名不变。
```

composition 传同实例 `rawGoalSettings`、`rawDecisionReads`；两者在当前文件中都早于图读取器构造。`goalSettings.autonomy` 使用现有 `'every_step' | 'after_plan_confirmation' | null`。不加 `partial`、不改 ContextAssemblyBindingV1 或 formatVersion。

### 2.3 I-5：原写者固定两位置，只读 source 取较晚者

**【lead 定，L10/L11；方案 B】字段只放在原记录，不新建通知 aggregate。** 以下是后续接口增量；HEAD 定义在 `contracts/core/session.ts:SessionRecord`、`model/communication-contracts.ts:SessionMessage/UndeliveredReplyV1`。null 仅是进入不可用/首次回复的提交前占位；正常持久读和写回执必须已绑定。available 的 Session 不保存 unavailableSince（恢复时移除字段），旧 unavailable 记录缺字段继续保留 undefined，不在读取时补位置。

```ts
// 拟增：src/contracts/core/session.ts:SessionRecord
unavailableSince?: CommitCursor | null;
// 拟增：src/core/work-graph/model/communication-contracts.ts:SessionMessage
// 同步 state/message-machine.ts:SessionMessageRecord 的结构副本。
responseSince?: CommitCursor | null;
// 拟增：同文件 UndeliveredReplyV1；只返回已绑定值或旧数据缺席。
unavailableSince?: CommitCursor;
responseSince?: CommitCursor;
```

| 事实/正式 owner | 同事务写入规则、回执及保持规则 |
| --- | --- |
| Session health 构造器穷举 | `state/session-availability.ts:createSessionRecord` 初始化 available，不带 unavailableSince；`releaseSessionRecord` 仅在 kernelTurnOpen:true 且原 health 为 available 时写 unavailableSince:null，已 unavailable 则保持原 cursor/缺席，kernelTurnOpen:false 保持 health/位置；`observeSessionHealthRecord` 每次 available→unavailable 置 null，每次 unavailable→available 移除字段（不写 null）。以上三个是文件中全部写 health 的记录构造器。`occupySessionRecord` 不改 health；`archiveSessionRecord/reactivateSessionRecord` 只改 lifecycle，保留位置；`requestSessionArchiveRecord/releaseSessionArchiveRequestRecord/backfillSessionProvenanceRecord` 也不改 health。规则及回执绑定纯函数均在 state，不由 owner 判断“是否首次”。 |
| 状态机与实际入口 | `state/session-availability.ts:healthObserved` 的 SES-12 进入 unavailable，SES-13 恢复 available，SES-19 同值无写；ready/Kernel head 守卫保持。`releasedOnRunEnd/releasedWithoutBoundary` 在 kernelTurnOpen:true 时进入 unavailable：Work 的 `state/run-machine.ts:onReconcileInterrupted/onStopPaused/onUnknownAttested` 发出 SES-06（RUN-19/23/24）和 SES-07（RUN-22）的释放，Query 的 `state/query-run-recovery.ts:reconcileInterrupted/unknownAttested/releaseKeepingCursor` 发出 SES-09（QRR-04）及 SES-10（QRR-06）的释放，均经 releaseSessionRecord；无 open Turn 的释放不进入。`reactivated` 的 archived + unavailable 守卫照旧，不能据此禁止 active Session 的 SES-13。 |
| Session 提交尾（3处） | `sessions/session-health.ts:recordSessionHealth`（健康观察）；`tasks/run-reconcile-service.ts:commitDecided`（公开 reconcileRun/resolveUnknownRun，经原 claimEffectRecords）；`queries/query-execution.ts:commitOperation`（公开 reconcileQueryRun/resolveUnknownQueryRun，经内部 reconcileQuery/resolveUnknownQuery→settleRecovery）。只为本次写出的 Session 的显式 unavailableSince:null 添加 `{refKey,field:'unavailableSince'}`，与原 health/Session CAS、原事件同一次 commit，覆盖以上全部进入不可用的路径。恢复提交携清除后的记录，不添加绑定。 |
| 无须改的结果/控制写者 | `tasks/execution-entry-service.ts:recordRunResult` 的结果处理（RUN-07/17/18/21）只以 kernelTurnOpen:false 释放；未知结果（RUN-08）不释放。它经 claimEffectRecords 调原 state 构造器时保持已有 unavailableSince，不生成 pending null，**W224移出修改范围**。recordExecutionEntered 的 claimEffectRecords 不释放；`tasks/control-service.ts:stoppedClaimRecords` 只做 stop_not_entered/kernelTurnOpen:false，也不新增绑定。不把共享 helper 所在文件等同新增位置的提交 owner。 |
| 回复首次保存 | `state/message-machine.ts:nextSessionMessageRecord` 的 responded **及 decision_answered** 分支，对原 sender.kind==='work_run' 的消息置 responseSince:null，覆盖 Work/Query Answer/用户答复。其它 sender 不增加此位置。`communication/mailbox-service.ts:respondMessage/respondFromQueryAnswer/createMessageWriteOwner` 共用 commitPreparedSessionMessage，在 response 与原事件同一提交绑定 `{refKey,field:'responseSince'}`，保留原消息 CAS。 |
| 保持与重放 | 同一段 unavailable 内的重复观察、结论变化、归档/关联保留 R；转交/acceptance/读取保留 P，恢复清除 R，重新进入生成新的 R。拟增 `state/session-availability.ts:bindSessionUnavailableCursor(record,cursor)`、`state/message-machine.ts:bindMessageResponseCursor(message,cursor)`，只用原回执 cursor 替换显式 null，undefined/已有 cursor 原样；不比较/解析 cursor。健康的 replayed、Query 的 loadRecordedResult/commitOperation、mailbox 的 replaySessionMessageReceipt/commitPreparedSessionMessage 均还原首次结果及重放。Work 回执只返回 Run，从同提交的 Session 快照读位置。 |
| 用户决定的独立重放（L11） | `communication/decision-service.ts:answerDecision` 的 lookupCommit 命中直接走 `replayMessage`，另有 recheckMiss 共用它；HEAD 直接返回事件 decoded.value，新增字段后会把 responseSince:null 原样返回。须在 replayMessage 用 **原 receipt.cursor** 调同一 bindMessageResponseCursor，再返回原版本。首次答复仍走原 persistDecisionMessage→messageWrites.persist→mailbox 共用提交尾。不能只改 mailbox 重放或改读当前快照。NR25 对照首次、同请求重试、SQLite重开后重试的完整 value/字段/cursor（仅 replayed 标志可不同），不补写事件。 |

**机械绑定的最小增量。** `record-store/ports.ts:CommitCursorBinding/EncodedRecordSchema`、`record-store/commit-extensions.ts:COMMIT_CURSOR_FIELDS/bindCommitCursor`、`record-store/record-codec.ts:validateCommitCursorFields/planPreparedCommit/bindPreparedRecords` 的闭合字段集增加 unavailableSince、responseSince；Session schema 只登记前者，SessionMessage schema 在原 since 外只登记后者，不允许任意 JSON 字段绑定。原 `record-store/sqlite-record-store.ts:commitInsideTransaction` 与 `record-store/in-memory-record-store.ts:createInMemoryRecordBackend` 已在事务中 appendEvents→bindPreparedRecords→写快照/回执，本包复用，不改两个 backend，不提前猜序号或另起第二次提交。持久 schema/读 decoder 拒绝 null、坏 cursor；事件 body 校验允许这两个明确的 pending null，回执复原后才给调用方。`sessions/session-record-codecs.ts:checkSessionBody/SESSION_RECORD_SCHEMAS/decodeSessionRecord` 与 `sessions/message-record-codecs.ts:checkSessionMessageBody/SESSION_MESSAGE_RECORD_SCHEMAS/decodeSessionMessageRecord` 须区分 record 和 event 的校验模式；旧缺字段继续可读。unavailableSince若存在必须对应unavailable，responseSince若存在必须对应work_run发信且已有response；持久值须是有效非零平台cursor。事件允许null仅限上述新迁移；原responseSince、unavailableSince缺席不能被回执绑定函数补成这次cursor。

层规则：state 决定“每次进入/恢复清除/保持及首次回复”，原 health/Work/Query/communication owner 编译 PreparedCommit，RecordStore 只作机械原子绑定；views 不得拿 commit。`tests/architecture/state-writes.test.ts:PROTECTED_TYPES/MESSAGE_FIELDS` 增两字段保护及纯绑定函数名，不加非 state 写入豁免（schema decode 的原豁免保留）。新增枚举允许值不是新增事件类型或状态枚举。

```ts
// src/core/work-graph/views/undelivered-reply-notices.ts（新）
export type UndeliveredReplyNoticeSourceDependencies = {
  records: DecisionReadRecordsPort; // views/goal-conflicts.ts：仅 readMany/lookup
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  messages: Pick<SessionMailboxPort, 'readUndeliveredReplies'|'readMessage'>;
};
export function createUndeliveredReplyNoticeSource(
  deps: UndeliveredReplyNoticeSourceDependencies,
): DecisionNoticeSourcePort;
```

原 `communication/mailbox-service.ts:readUndeliveredReplies` 已读这两种记录，本包只向 DTO 转交各自 cursor；不比较位置、不在读取中绑定/迁移。source.category 固定 undelivered_reply，取 max 的唯一比较点仍是 `views/notice-position.ts:compareNoticePositions`。进入不可用/恢复和保存回复分别对自己的记录 CAS；无须跨 owner 扇出，首尾稳定水位确保一次读见到同窗的 R/P。

`messages.readUndeliveredReplies` 未装仍直接 `ready/{availability:'not_available',items:[],nextCursor:null,sourceCursor:null}`，零其它读取；已装且空为 available（仍须满足最低水位）。ctx 必须是同 Workspace Host；原 queue 来源入口不增授权，I-6 只请求 waiting_answer，不触发 I-5。**先核消息归属并作 Goal 过滤，再要求位置**：已证明属于其它 Goal 的旧项直接排除；请求受影响 Goal 或无过滤 Workspace 时，范围内缺 R/P 回 `rejected/incomplete`、reason 前缀 `undelivered_reply_position_missing:`，列完整 message/Session ref，不发伪位置或部分计数。原 mailbox 列表仍保留历史；持久 null/坏 cursor 是 decode 损坏，沿 unavailable，不在此承诺能过滤无法解码的数据。历史迁移另批。

## 3. 读写流程行（11 行；2 组记录构造规则调整，SES-13 不变）

| # | 位置 `file:symbol` | 输入/动作 | 分支及输出 | 写入/重放 |
| --- | --- | --- | --- | --- |
| W2-D01 | `configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter` | 正式 Session + RoleBinding | 按 §4.1 读事实；ready 单职责及 guards，或真实失败 | 零写；不缓存跨调用授权 |
| W2-D02 | `communication/mailbox-service.ts:sendUserMessage` | 新用户发信/原请求重试 | 原回执命中仍早于 duties；新发信仍走原准入/政策/CAS | owner 的既有写，不改状态行 |
| W2-G01 | `views/context-extensions.ts:createContextExtensionsReader` | 读 Goal settings | 未装 NI；已装成功 available/原自治；失败不降级 | 零写；G 不变 |
| W2-C01 | 同上；`views/decision-read-model.ts:queryDecisionQueue` | 当前 Goal/focus | 全部 waiting_answer 页 → 任务筛选 → 确定索引/缺来源提示 | 零写；不读 notices、不生成 displayToken |
| W2-C02 | `agent-runtime/context-assembler.ts:optionalRowsFromExtensions` | extensions | anomalies + decisions 共用 reminders 预算；copy/planning 不新增提醒段 | 零写；已绑定 Run 不重装 |
| W2-P01 | `state/session-availability.ts:releaseSessionRecord/observeSessionHealthRecord`；§2.3 三个原提交尾 | 每次 available→unavailable | state 置 unavailableSince:null，原 commit 绑定；已 unavailable 的释放/观察及归档保持原值 | 原 Session CAS/原事件/原回执，失败全回滚 |
| W2-P02 | `state/message-machine.ts:nextSessionMessageRecord`；`communication/mailbox-service.ts:commitPreparedSessionMessage` | Work 发信消息首次 response（含用户答复） | 同提交绑定 responseSince，原单槽/消费规则不变 | 重放从原事件+原 cursor 还原；不新增通知提交 |
| W2-P03 | `state/session-availability.ts:healthObserved/observeSessionHealthRecord`；`sessions/session-health.ts:recordSessionHealth` | 按原 SES-13 的 ready/Kernel head 守卫恢复 | 同一恢复提交清除 unavailableSince；原 U 的 health 过滤使回复退出未送达集合 | 原恢复规则及回执；再次进入按 P01 写更晚位置 |
| W2-N01 | 新 `views/undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource`；原 `sessions/session-directory.ts:findSessions` | Workspace/可选 Goal | includeArchived 枚举、不可用来源逐页、消息归属及两持久位置核对 | 零写；不因旧线已转走任务而漏读 |
| W2-N02 | 新 source；原 `communication/mailbox-service.ts:readUndeliveredReplies` | 未消费 response | 完整二元 ref 去重；max(R,P) 排序/after/seek 分页；缺位置明确失败 | 不写消息、不转交、不 ack、不启动模型 |
| W2-N03 | `views/decision-read-model.ts:readDecisionQueueWindow`、`configuration/decision-settings-service.ts:markNoticesSeen` | 来源页/实际显示 token | 原计数、capabilities、显示页 token 和人工已看入口 | 本读取/已看流程仅明确 markNoticesSeen 写原 Workspace；P01/P02 写在业务发生时 |

## 4. 规则

### 4.1 I-2：读取顺序与拒绝

1. 固定入参副本，先核 ctx project/workspace/signal、Session project；scope 错 `forbidden`，已取消 `cancelled`，零依赖调用。只接受 Host 的内部读，不接受模型自报 duties。
2. 原 `resolveRoleBindingFacts(ctx,{roleBinding,declaredPermissions:{tools:[],writeScope:[]}})`；失败按 L2。`ready/inadmissible` 返回 `forbidden`，reason 固定 `the Role binding is inadmissible for message duties`，不再读 Session 或尝试 legacy。
3. `sessions.readSession(ctx,input.sessionRef)`；失败原样、throw → `unavailable`。取 `read.value.record`，验证其 ref/workspace 与请求相等，不相等 `forbidden`。收集 Session guard。`role.kind==='role_spec'`：核 roleId 等于 binding.templateId、`roleSpecRevisionFromBinding(templateRevision)===pin.ref.revision`；不符 `forbidden`。读 `readRoleSpec(ctx,{pin})`，取 `content.platformDuty`；resolver 若 resolved，其 revision、`roleSpecContentDigest(spec,roleId,revision)` 还须等于 Session pin，冲突拒绝，不能换用新激活角色。
4. `legacy_template`：binding 的 templateId/templateRevision 必须与 Session role 完全相等；取 `legacyDuty(role)`。resolver 若 resolved，也取它的 `spec.platformDuty`，由 `effectivePlatformDuty({roleDuty,hostDuty:templateDuty})` 检查冲突；不得按名字前缀或 Skill 猜职责。Host runtime 的可变 `grant.platformDuty` 不是 Session 身份来源，不读取它。
5. ready 返回 `{duties:[d],readOnlyCopy:provenance?.kind==='readonly_copy',independentReview:false,guards}`。旧 provenance 缺席按 false；Session 不存在或读坏不能按 false 继续。原 `sendUserMessage` 的 `canSendUserMessage` 判断及其后原业务守卫照旧；所有原 role guards 和 Session guard 都必须进入提交。
6. 三个旧辅助文件改用直接测试替身，给定仍是原 `f.duties`；它们的断言、owner 和回执顺序不改。I-1 `createSessionDutyResolver` 不改。

### 4.2 I-4：只接读取

沿当前扩展提供方的 hostCtx 调 `readGoalSettings(hostCtx,{goalRef:request.goalRef})`。ready → `{availability:'available',autonomy:read.value.settings.autonomy}`；没有 settings 的老 Goal 的默认值由 owner 提供，是 `after_plan_confirmation`，adapter 不另写默认。依赖缺席 → `{availability:'not_implemented',autonomy:null}`；`not_found` 原样；`not_ready` → `rejected/incomplete`；`rejected` 原样；throw → `rejected/unavailable`。throw reason 前缀 `goal_settings_read_failed:`，not_ready reason 前缀 `goal_settings_not_ready:`。失败使整个 context read 失败。

`context-assembler.ts:goalPayload` 已会显示值，不需要为 I-4 改它。settings 的 order/waitForGoalRef/parallelRisks 不加入目标段。G 的范围按 §0.3。

### 4.3 I-6：范围、行格式和装配

1. 调 `queryDecisionQueue(hostCtx,{workspace:{projectId,workspaceId},goalRef:request.goalRef,sections:['waiting_answer'],page:{limit:100,...cursor}})`。没有 categories、没有 notices。翻完 L6 的窗口，真实拒绝原样；not_found 原样、not_ready → `incomplete/decision_queue_not_ready:`、throw → `unavailable/decision_queue_read_failed:`。换水位回 `unavailable/decision_queue_window_changed:`；超量回 `capacity/decision_index_page_limit:`。不吞成“没有待决”。
2. 只读 `waitingAnswer`，并要求 `state==='waiting_answer'`；忽略 pending_application/history/notices。Goal 筛选信任 queue 的正式 scope 规则，包括 `views/decision-read-model.ts:cardInScope` 的双 Goal 冲突卡：属于 pair 中任一 Goal 都可出现，不能在 adapter 用 `card.goalRef===request.goalRef` 再误删一次。
3. 【lead 定，待审，L5】从 `source.pins`、aggregate objects 的 pins 收集 `aggregateType==='Task'` 且含完整 projectId/goalId/taskId 的指称；同 ref 去重。没有这种指称是 Goal 级卡。有 focusTaskIds 时保留 Goal 级或与同 Goal 的任一 focus 相交的卡；focus 为空保留该 Goal 全部卡。不要扫描 source.key 文本、不要用 RunRef 猜 taskId。当前没有规范 Task 指称的卡保留为 Goal 级，不自行缩窄消息卡语义；若以后想更精确关联 Run/file/module，另定接口。
4. 【lead 定，待审，L5】每卡一行，完整格式：`{key:'decision:'+card.cardKey,node:{kind:'goal',ref:request.goalRef},text:'待决定：'+card.source.kind+'；source='+card.source.key,sources:[...]}`。sources 取 `card.source.pins` 中真实 AggregateRef 且 revision>0 的 `{kind:'record',ref,revision,digest:null}`，按完整 canonical JSON 去重、字符码排序；`Task@0` 不伪装 record。不复制选项正文、用户答复或完整问题材料；source key 可沿已有 `decisions/card` 读原卡。
5. 七个卡来源依 `model/decision-contracts.ts:DecisionSourceV1['kind']`。每个报告 not_available 的卡来源加一行 `{key:'decision:not_available:'+kind,node:{kind:'goal',ref:request.goalRef},text:'待决来源尚未接入：'+kind,sources:[]}`。整格 `available` 只表示 queue 已接，行里如实说明仍缺哪类来源。notice capabilities 不生成这些行。依赖完全没装才是 `not_implemented/[]`，保持旧窄测试行为。
6. 卡键按完整 key 去重，同键内容冲突回 `unavailable/decision_index_conflict:`；合并提示行后按 key 字符码升序。装配器把这批行加入 `optionalRowsFromExtensions().reminders`，按既有 `indexRowText` 的 canonical JSON 输出；保持恰一个 `decision:` 前缀。`renderContext` 的全局前缀裁剪、omitted 数、UTF-8 字节计数和 continuation 最后不变。Query 当前只有 copy/planning；不能因为接口声明了 secretary/review 就提前开新调用模式。提醒来源不加入 binding 的消费版本钉（L9）。

### 4.4 I-5：不可用期间的回复到“请知悉”

1. `workspaceScopeProblem`、Host 身份及取消检查先于读取；可选 goalRef 的 project 必须同 scope。Goal 在其它 Workspace 的输入，读该 Goal 经 `decodeGoalSnapshot` 确认后回 `forbidden`；同 scope 不存在回 `not_found`。没有 goalRef 的通知查询不枚举全部 Goal，也不引入 200 Goal 限制（第 5 片 T-R2-3a）。
2. 按 L7 枚举 `findSessions(ctx,{workspace,includeArchived:true,page:{limit:100,...cursor,atLeastCursor}})`；atLeastCursor 原样取调用方 page.atLeastCursor（未给则省略），空目录/全 active + available 也必须经目录最低水位检查，不能靠后续 mailbox 调用补检查。只对返回 `record.health==='unavailable'` 的 Session 调来源。不能要求 lifecycle 必须 archived，也不能排除有 continuation 的线。第 1 片 owner 返回的 `hasContinuation/requiresUserRecipient` 是事实，不能解释成已转交。
3. 每条不可用线调用 `readUndeliveredReplies(ctx,{sessionRef,page:{limit:100,...cursor,atLeastCursor}})`，同样转交调用方最低水位；保留 sourceCursor。空 items 但 next 非空仍翻页。每项重读 `messages.readMessage(ctx,messageRef)`，先核同 scope 的 work_run sender、sender.sessionRef 与来源相等、response.bodyRef 与 item.responseRef 相等且无 response acceptance；不打开 body。归属/响应不一致先按第7条核窗口，变窗重试，稳定损坏回 `unavailable/undelivered_reply_source_mismatch:`。
4. Goal 先取原消息 goalRef；旧消息缺席/null 时从 sender.runRef.projectId/goalId 构成 GoalRef；两者均有必须一致，不从 Session 当前负责关系猜。**确认属于其它 Goal 的项先排除，再检查保留项位置**：item.unavailableSince 等于目录 Session.record.unavailableSince，item.responseSince 等于当前消息 responseSince。范围内缺字段按 §2.3 incomplete；不同值按第7条重试/稳定损坏处理。其它 Goal 的历史缺 R/P 不阻断本 Goal 查询；受影响 Goal 和无过滤 Workspace 都必须明确失败。来源已消费的回复由 mailbox 排除，转走未消费仍保留。
5. 去重按 L8 二元 ref5. 去重按 L8 二元 ref，重复且内容一致只一项；同 key 而归属/respondedAt/unavailableSince/responseSince/源 Session 不一致回 `unavailable/undelivered_reply_identity_conflict:`。`objects=[{kind:'aggregate',pin:{ref:message.ref,revision:message.revision},label:'原消息'}]`，不把 ArtifactRef 强塞 AggregateRef。读 source 不新建 SessionMessage、不调用转交、不调用 recordInputAccepted；业务写者仅按 §2.3 更新原记录。
6. 位置按 L8，两条路径统一取 max(R,P)。先去重、按 `compareNoticePositions` 排序、按 input.after 排除已看、再按 source page cursor 的最后返回完整 position 作 seek；同 cursor 的其它 itemKey 不得跳过。cursor 是 `base64url(canonicalJson({v:1,workspace,goalRef:goalRef??null,after:after??null,last:position}))`；字段/scope/过滤/after 不符或格式坏回 `invalid`，不能静默从第 1 页重来。source 接受 1..200 的内部 page.limit（queue 当前 SOURCE_PAGE_LIMIT=200），直接来源请求不合法回 invalid。不要把它错限成外层 queue 的 1..100。
7. 来源页 sourceCursor 为本次稳定窗口，不是每项的位置；以 `readWatermark(records)`（原理为 `records.readMany([])`）首尾核对，实际带 sourceCursor 的 Session 列表页、回复来源页必须同窗。`readMessage` 不返回水位，其读取及 unavailableSince/responseSince 的核对由首尾 records 水位包住，不能虚构 metadata cursor；max 只用事实 cursor，不用窗口 cursor。目录续页因水位变化返回的 `rejected/source_stale` 是整窗重试信号：丢弃本次已积累的行、去重表、Session及每线分页游标、水位，从新窗口第一页开始；不拿旧 continuation cursor 接着读，不将这个拒绝直接向上传播。此分支与首尾/页水位变化共用最多四次整窗尝试。其余真实 `not_ready/not_found/rejected` 原样传播，底层 Store 失败沿 `goal-conflicts.ts:storeFailureToRejection` 转换；throw 转 `unavailable/undelivered_reply_read_failed:`，损坏消息不跳过。四次不能稳定 → `unavailable/undelivered_reply_window_changed:`；任一 L7 上限后还有下一页或超输出上限 → `capacity/undelivered_reply_page_limit:`。生产只经原 queue 读；queue 的外层稳定窗口和 token 机制保留。
8. 注册后即使 0 项，capability 也是 available；不注册或窄依赖未装才是 not_available。其它类别未实现仍保持 not_available，countsComplete 不能因此改成 true。读取/重复读取/刷新不写 Workspace 已看；只有原 `markNoticesSeen` 收到该操作者实际显示页 token 才更新。正式位置由 P01/P02 提前写定，不是本条读取零写的例外；旧回复后不可用与新迟回均按同一已看机制提示。**短暂不可用也产生提醒**（指已提交health=unavailable后又恢复；probe=transient本身仍按原规则不写health），与今天 U 按 health 过滤的列表一致：SES-13 恢复后退出；再次不可用时 R 是新提交，同 itemKey 的 max(R,P) 变晚，可再次成为未看。只在当前窗口按二元 ref 去重，不跨不同进入次数去重；不可用的持续时长不参与判断。

## 5. 测试（2026-10-13 lead 重写：按 TDD，测试由 DSH 一条一条写）

**做法。** 用 Matt Pocock 的 TDD skill（`mattpocock/skills` 的 `engineering/tdd`，MIT；副本里在 `.dsh-ref/tdd/`）。
- **测试入口先定。** 测试入口已由用户 2026-10-13 确认（§5.1），不在别的入口写测试。
- **一条一条做。** DSH 按 §5.2 的验收行为一条一条做：先写一个会失败的测试（RED），再写刚好让它通过的实现（GREEN），再做下一条。不先把全部测试写完。
- **不重构。** 重构不在这个循环里，留给审查。
- **原来那 76 个用例作废。** 本节原来列的 76 个用例（DU、CX、NR、RA、PI、ST 各行）是另一个模型先写好的整套测试。按 skill 分类：保留 4、改写 43、删除或合并 29。所以作废，不交给 DSH。

### 5.1 测试入口（用户确认的 6 个）

| 入口 | 是什么 | 能抓到 | 抓不到（由哪个入口补） |
| --- | --- | --- | --- |
| E0 自动编排场景 | 现有场景测试框架（`tests/scenarios/support/common.ts`）：真实平台加 Workflow 自动推进，模型用脚本；场景里不跑注册的检查命令 | 四条线在自动推进里的真实时序 | 分支细节（E1–E4） |
| E1 正式平台 + 成员在 Run 里用工具发信 | `createTargetPlatform`，一次真实进入的 Run，脚本模型调用 `send_user_message` 工具 | I-2：角色读取、发信政策、Runtime 工具、组装 | 角色读取失败的各种形状（E4） |
| E2 正式平台 + 准备一次执行 | `createTargetPlatform` 的执行准备/上下文装配 | I-4、I-6：成员看到的自治级别、待答卡提醒、预算 | 队列分页的各种窗口（E4，按需） |
| E3 正式平台 + 真实的 Session 变不可用、回复，再读“请知悉” | `createTargetPlatform`，健康观察 / Work 核对或认定 / Query 恢复这些真实写者，加回复命令，再读 notices 和队列 | I-5：位置、提醒、看过、恢复、再进入、转交、接受、重放、重开、两种后端 | 分页、容量、旧数据（E4） |
| E4 模块入口 | 未送达提醒来源 `createUndeliveredReplyNoticeSource`、职责读取 `createMessageDutiesFactsAdapter`，用真实依赖，只对失败注入用替身 | 复杂规则分支 | 组装（E0–E3） |
| E5 纯状态转换 | `state/session-availability.ts`、`state/message-machine.ts` 的构造器 | 进入、恢复、再进入，以及两种答复标记 | 持久化（E3） |

### 5.2 验收行为（每行至少一个测试，测试名以行号开头）

期望值一律来自独立来源：规格的字面值、手算的例子、命令自己返回的回执（例如回复命令返回的 `cursor`、提交日志里那次提交的游标）。**不能**从被测系统读回来再当期望，**不能**用产品代码里的比较器或转换函数算期望。

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| Z01 | E0 | 目标在自动模式下推进；成员回复以后，它的执行被中断，Session 变成不可用 → “请知悉”里多一条未送达提醒；标看过以后不再出现；Session 按 SES-13 恢复可用后，这条从未送达列表里消失 | 事件顺序是手写的；提醒条数按字面值：1 → 0 → 0 |
| Z02 | E0 | 自动推进里，有秘书职责的成员调用工具发“请你决定” → 你的队列里多一张卡；下一轮执行的提醒段里有这张卡的行；答完以后再准备，这一行没有了 | 卡的文字、选项按字面值；行文本按 L5 的格式字面值 |
| F01 | E1 | 真实进入的秘书 Run 调用 `send_user_message`，得到成功，正好产生一张待答的决定卡 | 请求文字、选项、意图按字面值；允许的职责按 L1/L2；工具回执只提供生成的消息标识 |
| F02 | E1 | 执行者和普通审阅者的 Run 可以发“请知悉”，不能发“请你决定” | 字面的政策表：notify 成功、decision 被拒；被拒的动作不在公开队列里留下卡 |
| F03 | E1（准入边界） | 只读副本 Session 不能发给你的消息，也不产生决定卡 | 只读副本禁止发信的正式规则；在真实更早的准入或工具边界被拒即可，不伪造一个进入了 Work 的副本 |
| F04 | E1 | 一次成功的请求以后，角色事实失效或读不到 → 新请求被拒；原请求重放结果不变 | 首次回执对照 F01 的字面值；L2 读失败就拒、回执优先；卡的总数不增加 |
| F05 | E2 | 改了自治级别 → 新准备的上下文是新值；已经绑定的执行仍是原来的输入，G 不变 | 字面值 `after_plan_confirmation`、`every_step`；原输入单独核对；§0.3 的不变规则 |
| F06 | E2 | 待答卡进提醒段；答完后消失；卡源缺席时有明确提示行；预算放不下时省略整行，不损坏必须段 | 卡文字和提示文字按 L5/L9 字面值；必须段（任务、接续说明）的文字按字面值 |
| F07 | E2 | 带焦点任务准备时，按 L5 选出相关的任务卡和目标卡，包括尾页上的；容量不足的结果被拒，不装半份 | 一个手写的、逐张列出的卡片归属例子；L5/L6 的上限 |
| F08 | E2 | Work 和 Query 的准备按范围和模式取扩展；已装的来源读失败时，不给出看似成功的上下文 | 允许和禁止的范围、Query 的模式规则按字面值；失败码和前缀按规格 |
| F09 | E3 | Session 已经由真实写者变成不可用以后才保存的回复，出现一次提醒；已归档、有接续两种情况都一样，接续线上不多出执行或输入接受 | 手写的“先 R 后 P”历史：期望位置是 P（回复命令返回的游标）；条数按字面值 |
| F10 | E3 | 早已保存的回复，后来它的 Session 变成不可用 → 成为新的未看提醒；时间戳相同或倒退都不影响 | 手写的“先 P 后 R”历史：期望位置是 R（那次健康提交的游标）；变成不可用之前提醒是 0 条 |
| F11 | E3 | 标看过一条显示过的提醒以后，同一游标上排在后面的提醒和之后提交的回复仍然未看，重开以后也一样 | 每次标看过以后的期望标识序列和条数是手写的；显示范围的规则按字面值；显示令牌不透明 |
| F12 | E3 | 恢复可用以后，回复不在未送达里；再次变成不可用，同一对消息和回复又出现一次新的未看提醒 | 字面的序列：可见 → 看过 → 不在 → 可见；新位置是第二次进入不可用那次提交的游标 |
| F13 | E3 | 转交和归档都不让提醒消失；真实执行接受了这条回复以后，提醒消失 | 接受前后的提醒条数按字面值；回复内容和标识按原值 |
| F14 | E3 | Work 回复、Query Answer、你的答复三种写者在重试和 SQLite 重开以后，回复和位置都不变 | 回复正文和选项按字面值；首次回执；规格的“重放不变”关系 |
| F15 | E3 | 健康提交或回复提交失败，不留下半截业务状态；回复已提交但回执丢失的，恰好恢复一次 | 命令前的公开状态；请求的回复按字面值；受控的故障结果和原提交的观察 |
| M01 | E4 | 五个旧模板按版本精确对上职责；未知或版本不对的模板、合法但没有职责的规格，只缺省为 executor | 手写的五模板/版本表；executor 缺省按字面值 |
| M02 | E4 | 职责、身份或 guard 版本冲突的被拒；相同的 guard 合并成一个 | 手写的冲突表和期望的 guard 集合；不用产品里的政策函数算 |
| M03 | E4 | 角色解析、Session 读取、固定角色规格读取失败，都不会变成成功的缺省职责 | L2、§4.1 的状态码表按字面值，包括“确实没有”和“读失败”的区别 |
| M04 | E4 | 消息加回复这一对完整引用只在元数据一致时去重 | 手写的成对例子；条数按字面值；标识冲突按规格拒绝 |
| M05 | E4 | 旧数据缺位置只挡相关的目标；位置损坏的直接拒绝 | 手写的 A/B 两个目标的历史，A/B/整个工作区三种读取的结果表；不改数据库造数据 |
| M06 | E4 | 中间的目录页和回复页是空的，也不会漏掉后面合格的那一条 | 夹具里点名的一条尾项；规格的“空页照样跟游标”规则 |
| M07 | E4 | 正好在容量边界上成功；再多一页或再多一条就拒绝，不给半份结果 | L7 的 50 页、5,000 条按字面值 |
| M08 | E4 | 同一次提交上的多条按完整键排序分页；游标不能换一个不兼容的请求接着用 | 手算的顺序；返回的不透明游标；非法上限和换范围按字面值 |
| M09 | E4 | 窗口变了可以从元数据不一致里恢复；稳定的不一致就拒绝 | 手写的第一、第二窗口记录；成功和拒绝结果按字面值 |
| M10 | E4 | 目录 `source_stale` 或水位变化时整窗丢弃重读；连续四次不稳定就失败 | 手写的新旧项标识；四次上限和失败前缀按字面值 |
| M11 | E4 | 没装、读失败、新鲜度不够三种情况，都和“已装且为空”分得开 | 可用性、错误、新鲜度的字面矩阵；不用产品里的错误转换函数 |
| P01 | E5 | 健康进入 unavailable 时 `unavailableSince` 置为待绑定（null）；SES-13 恢复为 available 时清除；再进入又置为待绑定；回复的两种答复分支把 `responseSince` 置为待绑定 | 规格 §2.3 的字面值 |

所有读取阶段（读 notices、读队列、准备上下文）都通过生产组装已有的 `commitObserver` 和模型边界核对：**没有新的提交，没有脚本模型调用**。不查 SQL 表，不查具体记录的存储形状，不断言内部函数被调用了几次。

### 5.3 写测试的规则（按 TDD skill）

1. **只在 §5.1 的入口上测。** 测公开接口的行为，不测私有函数，不模拟自己的模块。替身只用在系统边界：脚本模型、时钟、注入的故障、E4 里需要失败形状的上游读取。
2. **不读旁路核对。** 写进去的东西，通过公开的读取接口读回来核对，不直接查数据库或记录存储。只有 E5 的纯状态测试，可以直接看构造器返回的记录。
3. **不自证。** 期望值不能用产品代码同样的算法算出来，也不能从被测系统读回来。位置用命令回执里的游标或提交日志里那次提交的游标。
4. **一个测试一件事。** 测试名写行为，以 §5.2 的行号开头，例如 `F10 a saved reply becomes unseen again when its Session later becomes unavailable`。
5. **两种后端。** E3 的行用内存和 SQLite 各跑一次；重开、崩溃这类只在 SQLite 上有意义的，只跑 SQLite。
6. **不调用真实模型，不联网，不靠墙钟顺序。**
7. **数量不是目标。** §5.2 每行至少一个测试；一行的几个变化可以写成同一个测试里的表，也可以拆开，以读起来像规格为准。不写读一眼代码就知道答案的测试。

### 5.4 夹具、已改的旧测试（lead 冻结，DSH 不改）

- **新夹具（Codex 写，lead 核对冻结）：**
  - `tests/helpers/WP2-duties-fixture.ts`（E1、E4 的职责）；
  - E2 不另设夹具：用正式平台（`createTargetPlatform`）和仓库现有的帮手（例如 `tests/helpers/S5-decision-fixture.ts`、`tests/helpers/WP1-units-fixture.ts`）。原来 Codex 写的 `WP2-context-fixture.ts` 用手造的队列页和算期望值的帮手，2026-10-13 删掉；DSH 需要新的帮手时新建 `tests/helpers/WP2-*-support.ts`，合入时 lead 审；
  - `tests/helpers/WP2-notices-fixture.ts`（E3、E4 的真实健康观察、Work 核对或认定、Query 恢复、回复先后、SES-13 恢复和再进入、你的答复和 Query Answer、转交和接受、回执和同库重开）。
  - E0 用现有的场景框架，不另写夹具。
- **测试侧的迁移（Codex 写，lead 冻结）：**
  - 三个辅助文件按 L3 把旧 mapping 改成显式的职责事实替身，原有期望不动：`tests/helpers/S5-application-support.ts`、`tests/helpers/S5R2-b-support.ts`、`tests/helpers/S5R2-c-support.ts`；
  - `tests/architecture/state-writes.test.ts`：保护两个新字段，不加写入豁免。
- **L12 改的四处旧断言（lead 冻结）：**
  - `tests/state/session-availability.test.ts` 两处补 `unavailableSince: null`；
  - `tests/work-graph/S1-wait-disposal.test.ts` 的 SV33/SV34 补两个游标，期望值取自命令回执：R 取提交日志里让 S 变成不可用的那次健康提交的游标，P 取回复命令返回的 `cursor`。
- **DSH 写的新测试放在这几个文件里：**
  - `tests/work-graph/WP2-message-duties.test.ts`（E4 职责）；
  - `tests/work-graph/WP2-context-extensions.test.ts`；
  - `tests/work-graph/WP2-undelivered-notices.test.ts`（E3、E4 提醒）；
  - `tests/runtime/WP2-context-assembly.test.ts`；
  - `tests/composition/WP2-wiring.test.ts`（E1、E2、E3 的正式平台）；
  - `tests/record-store/WP2-notice-cursors.test.ts`（只在需要时用）；
  - `tests/scenarios/WP2-wiring-scenario.test.ts`（E0）；
  - E5 的行写进 `tests/state/WP2-positions.test.ts`。

  需要别的文件名时，先在回复里说明。

### 5.5 回归（原 §5.7）

- 每条 RED 应在被测的行为处失败（adapter 返回值、生产消费点、提醒读取），不能在注册 schema、创建 Session、claim/entry 或准备材料时失败。E1 的测试先证明这次真实运行确实有 `send_user_message` 权限；模型脚本不能替自己授角色。
- **必须原样继续通过（本包不改这些测试文件、用例及断言）：**

| 范围 | 既有测试文件 | 保留的行为 |
| --- | --- | --- |
| SES-13/Host重启 | `tests/state/session-availability.test.ts`、`tests/scenarios/A8-host-restart-entry.test.ts`、`tests/scenarios/A8-host-restart.test.ts` | health_observed 的 SES-12/13/19；“SES-13 clears it”及closed Kernel head恢复；Host原Session恢复/重驱，不改为拒绝恢复 |
| 第1片状态/持久化 | `tests/state/S1-session-archive.test.ts`、`tests/state/S1-message-routing.test.ts`、`tests/state/S1-responsibility.test.ts`、`tests/work-graph/S1-codecs-indexes.test.ts`、`tests/work-graph/S1-dispatch-guards.test.ts` | health/lifecycle分轴、归档守卫、旧形状解码和消息路由 |
| 第1片owner/场景 | `tests/work-graph/S1-archive-owner.test.ts`、`tests/work-graph/S1-requeue.test.ts`、`tests/work-graph/S1-session-facts.test.ts`、`tests/work-graph/S1-wait-disposal.test.ts`、`tests/runtime/S1-routed-replies.test.ts`、`tests/scenarios/S1-wait-copy-retirement.test.ts`、`tests/scenarios/S1-archive-restart.test.ts` | 健康观察、归档、接续、mailbox转交/未送达/实际消费及重开 |
| 第5片消息/通知 | `tests/work-graph/S5-user-messages.test.ts`、`tests/work-graph/S5-decision-application.test.ts`、`tests/work-graph/S5-decision-queue.test.ts`、`tests/work-graph/S5-notices.test.ts`、`tests/work-graph/S5-goal-settings.test.ts`、`tests/work-graph/S5R2-queue-history.test.ts`、`tests/state/S5-message-decision.test.ts`、`tests/state/S5-notice-settings.test.ts` | 原决定答复/落实/回执、完整通知位置与显示token、旧消息形状 |
| 接线包1 | `tests/scenarios/WP1-wiring.test.ts`、`tests/business/WP1-continuation-handover.test.ts`、`tests/business/WP1-start-refusal.test.ts`、`tests/composition/WP1-session-duty.test.ts`、`tests/work-graph/WP1-context-anomalies.test.ts`、`tests/runtime/WP1-context-assembly.test.ts` | 原不可用线的接续/归档、职责与异常提醒，不改I-1/I-3/E15 |
| G/装配 | `tests/work-graph/WP1-goal-content-entry.test.ts`、`tests/state/WP1-goal-content.test.ts`、`tests/work-graph/S3-graph-context.test.ts`、`tests/runtime/S3-context-assembler.test.ts`、`tests/scenarios/C6-unrelated-adoption.test.ts` | G摘要及已绑定输入不变；其余既有用例合入前全量复核 |

**静态核对发现的冻结阻点：已由 L12 消解。** `tests/state/session-availability.test.ts` 的 `releaseSessionRecord` 用例“kernelTurnOpen writes unavailable…”和 `observeSessionHealthRecord` 用例“writes missing/damaged…”，完整期望对象各补 `unavailableSince:null`；`tests/work-graph/S1-wait-disposal.test.ts` 的 SV33/SV34 完整DTO各补两个cursor，期望值取自命令回执（R=提交日志里让 S 不可用的那次健康提交的游标，P=回复命令返回的 `cursor`），不从记录读回。仅补字段，不放宽断言、不隐藏字段、不跳过用例。四处由 Codex 和 lead 改好，lead 冻结，DSH 不得修改。L10的恢复规则和其它旧测试保持；其余回归不预报已通过。

- 三个旧辅助文件只改工厂注入形式，不改任何既有测试期望。生产上下文的自治/提醒字节会变化；若既有整串快照因此失败，DSH 列文件:断言:实值交 lead 核实，不擅自扩大 §6 写范围。异常行字节、G digest、已绑定重放变化都当回归。
- 新测试的数量不预先定（§5.3 第 7 条）；合入时 lead 按 §5.2 逐行核对每行都有测试、测试名以行号开头，并按 TDD skill 的反面清单审测试。全量基线是 279 个文件、5,974 项（a7cafccc），新增多少以实际收集数为准。

## 6. 精确文件清单（方案 B 及 L12：35 个；不含本规格）

| ID | N/M | 文件 | 用途/符号；所属组 |
| --- | --- | --- | --- |
| W201 | M | src/core/work-graph/configuration/message-duties-adapter.ts | createMessageDutiesFactsAdapter 正式事实，删除过渡类型；A |
| W202 | M | src/core/work-graph/views/context-extensions.ts | ContextExtensionsDependencies/createContextExtensionsReader，I-4/I-6；C |
| W203 | M | src/core/agent-runtime/context-assembler.ts | optionalRowsFromExtensions 的 decision 行消费；C |
| W204 | M | src/composition/create-platform.ts | adapter依赖、删除messageDutiesMapping、注册带位置DTO的notice source、传两个扩展依赖；原同backend owner复用；D |
| W205 | N | src/core/work-graph/views/undelivered-reply-notices.ts | createUndeliveredReplyNoticeSource，仅投影/比较，无commit；B |
| W206 | N | tests/work-graph/WP2-message-duties.test.ts | DSH 按 TDD 写：§5.2 的 F01–F04（E4 部分）、M01–M03；A |
| W207 | N | tests/work-graph/WP2-context-extensions.test.ts | DSH 按 TDD 写：§5.2 的 F05–F08 的模块部分（按需）；C |
| W208 | N | tests/work-graph/WP2-undelivered-notices.test.ts | DSH 按 TDD 写：§5.2 的 M04–M11，以及 F09–F15 中按需放在模块入口的部分；B |
| W209 | N | tests/runtime/WP2-context-assembly.test.ts | DSH 按 TDD 写：F06 的装配部分（按需）；C |
| W210 | N | tests/composition/WP2-wiring.test.ts | DSH 按 TDD 写：§5.2 的 F01–F15（E1、E2、E3 的正式平台）；D 收尾，各组按需先写本组的行 |
| W211 | N | tests/helpers/WP2-duties-fixture.ts | 真实角色/Session/Work及guard观察，不预置待测返回；夹具A |
| W212 | — | （删除）tests/helpers/WP2-context-fixture.ts | 2026-10-13 删掉：手造队列页、带算期望值的帮手；E2 用正式平台。空号不计入文件数 |
| W213 | N | tests/helpers/WP2-notices-fixture.ts | 真实健康观察/Work核对或认定/Query恢复、回复前后顺序、SES-13恢复/再进入、用户答/Query Answer、转交/接受、回执及同库重开；夹具B，D只复用 |
| W214 | M | tests/helpers/S5-application-support.ts | owners 中旧mapping改显式测试facts替身，断言不动；A |
| W215 | M | tests/helpers/S5R2-b-support.ts | 同上，原 f.duties 行为保留；A |
| W216 | M | tests/helpers/S5R2-c-support.ts | 同上，原 f.duties 行为保留；A |
| W217 | M | src/contracts/core/session.ts | SessionRecord.unavailableSince可选字段；B |
| W218 | M | src/core/work-graph/model/communication-contracts.ts | SessionMessage.responseSince、UndeliveredReplyV1两个可选cursor；B |
| W219 | M | src/core/work-graph/state/session-availability.ts | releaseSessionRecord每次进入标记、observeSessionHealthRecord进入/恢复清除；拟增bindSessionUnavailableCursor；healthObserved/SES-13守卫不改；B |
| W220 | M | src/core/work-graph/state/message-machine.ts | SessionMessageRecord结构副本、nextSessionMessageRecord两种答复标记；拟增bindMessageResponseCursor；B |
| W221 | M | src/core/work-graph/sessions/session-record-codecs.ts | checkSessionBody/SESSION_RECORD_SCHEMAS/encodeSessionRecord/decodeSessionRecord，两种校验模式和绑定字段注册；B |
| W222 | M | src/core/work-graph/sessions/message-record-codecs.ts | checkSessionMessageBody/SESSION_MESSAGE_RECORD_SCHEMAS/decodeSessionMessageRecord，responseSince保留/校验/注册；B |
| W223 | M | src/core/work-graph/sessions/session-health.ts | recordSessionHealth/replayed，同提交绑定与原回执还原；B |
| W225 | M | src/core/work-graph/tasks/run-reconcile-service.ts | commitDecided的Session写集绑定；B |
| W226 | M | src/core/work-graph/queries/query-execution.ts | commitOperation/loadRecordedResult及settleRecovery的Session绑定、回执返回；B |
| W227 | M | src/core/work-graph/communication/mailbox-service.ts | commitPreparedSessionMessage/replaySessionMessageReceipt绑定；readUndeliveredReplies传两cursor；B |
| W228 | M | src/core/record-store/ports.ts | CommitCursorBinding/EncodedRecordSchema闭合字段集+2；E |
| W229 | M | src/core/record-store/commit-extensions.ts | COMMIT_CURSOR_FIELDS/bindCommitCursor闭合校验+2，原机械事务语义不变；E |
| W230 | M | src/core/record-store/record-codec.ts | validateCommitCursorFields/planPreparedCommit/bindPreparedRecords使用同一字段集；E |
| W231 | N | tests/record-store/WP2-notice-cursors.test.ts | DSH 按需写：绑定字段集的公开端口行为（record-store 本身是被测模块，通过它的公开接口读回不算旁路）；E |
| W232 | M | tests/architecture/state-writes.test.ts | PROTECTED_TYPES/MESSAGE_FIELDS两字段保护及state纯绑定函数名，不加写入豁免/新it；B |
| W236 | M | src/core/work-graph/communication/decision-service.ts | replayMessage以原receipt.cursor调用bindMessageResponseCursor；覆盖answerDecision的receipt命中及recheckMiss，不改决定政策；B |
| W237 | M | tests/state/session-availability.test.ts | L12两处完整对象各补unavailableSince:null；Codex测试步骤修改、lead核对sha256冻结，DSH禁改 |
| W238 | M | tests/work-graph/S1-wait-disposal.test.ts | L12的SV33/SV34完整DTO各补两个cursor，值取命令回执（R=提交日志里那次健康提交的游标，P=回复命令的cursor）；lead改好并冻结，DSH禁改 |
| W239 | N | tests/scenarios/WP2-wiring-scenario.test.ts | DSH 按 TDD 写：§5.2 的 Z01、Z02（入口 E0，用现有场景框架）；D |
| W240 | N | tests/state/WP2-positions.test.ts | DSH 按 TDD 写：§5.2 的 P01（入口 E5）；B |

W224（execution-entry-service）因没有首次进入不可用的结果写入而移出；W233–W235（三个旧恢复测试）因 L10 要求原样通过而移出。保留原ID，不把空号算作文件；W236补独立的决定回执重放。既有测试侧修改为W214–W216三个辅助文件、W232架构保护表，以及L12限定的W237/W238四处完整对象断言；其它旧测试不得修改。

**已核查的连带文件，不是遗漏的可写白名单：**

| 文件/符号 | 本提案净改动 | 理由/若检查出现相反事实 |
| --- | --- | --- |
| tests/architecture/production-reach-allowlist.json:entries | 0 | HEAD 无上述mapping/adapter的允许条目；readRoleSpec 的旧 kept-for 已在接线包1删。新factory有C的真实调用。施工后必须跑生产可达检查，若有新变可达的既有条目，lead 点名删并更新本表/计数，不能加宽allowlist掩盖漏接 |
| src/core/record-store/sqlite-record-store.ts:commitInsideTransaction、src/core/record-store/in-memory-record-store.ts:createInMemoryRecordBackend | 0 | 已有绑定后校验及事务回滚；只改W228–W230闭合字段集，用ST验证双backend，无需另写持久表或迁移 |
| src/app/core-http-types.ts:CoreRouteSuffix、src/app/core-routes.ts:CORE_ROUTE_SPECS、src/ui/api/routes.ts:ROUTE_LABELS | 0 | 原goals/settings、decisions/queue、messages/undelivered-replies都已有；本包0新路由，不需要新的穷举标签。若新加路由就已越出本包 |
| docs/refactor/module-target.json:configuration/views dependencies | 0 | configuration只依赖model/state/persistence；legacy模板函数从composition注入。views现已可读sessions/tasks/communication；不加向上边 |
| src/contracts/graph-context.ts:goalContextContentV1、src/core/work-graph/state/context-input.ts:contextGoalContentProblem、src/core/work-graph/tasks/execution-entry-service.ts:contextConsumptionProblem | 这三个符号0 | G明确不改；W224已移出修改清单，整个execution-entry-service不改，不能因I-4升contentVersion |

以上是按L10/L11修订的 B 封闭清单，已冻结，不授权 DSH 自行加字段/索引/历史迁移。W221/W222须按§2.3让事件body接受pending形状；HEAD `queries/query-record-codecs.ts:validateQueryExecutionRecordedEvent` 只要求payload.result是对象，新增Session字段不另加该文件；若施工发现另一个正式不可用写者或遗漏的严格事件校验，须给 file:symbol、重冻清单和计数，不绕过检查。本次只修改本规格，HANDOFF/README/证据均不更新；验收后的文档同步由 lead 另批完成。

## 7. DSH 分组与接口交接（决定 46）

| 组 | 可写范围 | 输入/输出 | 依赖、可并行与停点 |
| --- | --- | --- | --- |
| 夹具（已做） | Codex 写 W211/W212/W213 及 W214–W216、W232；lead 改 W237/W238 | 已有 owner 构造给定；新 factory 由参数注入 | lead 核对后冻结，DSH 不改 |
| A：职责 | 生产 W201；测试 W206 | §2.1 固定接口 → MessageDutiesFactsPort；§5.2 的 M01–M03，F01–F04 的模块部分 | 与 B/C/E 并行；不能写 composition 或 state |
| B：未送达事实与来源 | 生产 W205、W217–W223、W225–W227、W236；测试 W208、W240 | §2.3 原记录/DTO/绑定与 L7/L8 → DecisionNoticeSourcePort；§5.2 的 P01、M04–M11，F09–F15 的模块部分 | 依赖 E 的字段集；内部可分写者/投影，同一文件只一个写者；views 只读；SES-13 保持原规则 |
| E：机械绑定 | 生产 W228–W230；测试 W231（按需） | 只扩两个允许字段 → 原 PreparedCommit/原 backend | 与 A/C 并行，先交出签名给 B；不让 store 判断不可用或消息语义 |
| C：上下文 | 生产 W202、W203；测试 W207、W209 | §2.2 扩展 reader → 原 ContextExtensionsV1 → reminders；§5.2 的 F05–F08 的模块部分 | 与 A/B/E 并行；G 和 graph reader 不改 |
| D：生产组合与业务流程 | 生产 W204；测试 W210、W239 | 消费 A/B/C/E 的导出，复用同一 raw owner/backend 实例；§5.2 的 Z01–Z02、F01–F15（正式平台） | 四组之后；D 独占 composition，负责运行架构检查并报告确切的 allowlist 变化 |

**流程（2026-10-13 起按 TDD，取代原来的“DSH 第一段写骨架与用例、STOP”）：** lead 冻结规格和 §5.4 的测试侧文件 → **一个新的 DSH Session** 按组派子任务，每组对自己 §5.2 的行一条一条做：先写会失败的测试，再写刚好通过的实现，再下一条 → 各组完成后 D 做组合与业务流程行 → 每组一个只读复查子任务 → lead 按 §5.2 逐行核对测试、按 TDD skill 的反面清单审、跑检查 → Codex 只读审 → 有 bwrap 的环境跑全量 → 合入。带指导返工也开新 Session。主 Session 只分派、汇总，子任务全部回报前不能结束回合。每个子任务带本组文件、接口、对应规则和 §5.2 的行，不让每个 agent 通读三片历史。共享文件只由表内所有者改。

运行器按 DSH-WORKFLOW §6.10 用上下文上限360000、每段120分钟；token只记不拦，主/子Session一起统计，等待单列。临时文件只在副本 `./.dsh-scratch/`。测试一次只跑一个，按机器槽位排队。实现不了约定做法先报告，不自行替换成进程缓存、放宽权限或减少测试。冻结测试与规格冲突时停下列出两处原文，lead 修规格/重冻结；不能暗选测试或正文一边。

## 8. 规则（发给 DSH 的说明书逐项带入）

1. **可用性如实。** 缺依赖是未接；已接且空是available空；已接而读取失败返回失败。I-6部分卡源缺席用提示行，不能因countsComplete=false永远拒绝已接的queue（X/Q）。
2. **授权留在原owner。** I-2只给事实和guards；tools/Host grant、原Run准入、重放先行都保留。只读副本不能发信；普通reviewer不冒充独立审阅（M/decision-policy）。
3. **只认完整引用。** 职责看正式pin/版本化模板；卡用owner cardKey；回复按messageRef+responseRef。伪Task@0只作关联，不作持久record或新授权（role-spec/goal-decision-reader/U）。
4. **分页不丢尾页。** 空filtered页照样跟cursor；上限含等号边界；超过回capacity，不报完整计数。不把sourceCursor拿来当notice发生位置（Q/lookupAll）。
5. **读取不推进业务。** source不答复、不创建卡/notice、不消费response、不转交、不自动启动Agent；两事实位置仅在原业务迁移同commit保存，已看仅由有效显示token写原Workspace（§2.3、U/Q/markNoticesSeen）。
6. **不可用与归档分开。** 不可用可以恢复，也可尚未归档或已有接续；includeArchived必须true，不靠开放责任寻找旧线（session-directory/U）。
7. **I-6端到端。** 给扩展赋值还不够，装配器必须消费decision行；预算和continuation顺序使用原renderer。Query模式照旧（A）。
8. **G不动。** 不加Goal revision钉、不把自治/提醒来源加进G摘要、不重新装配已绑定Run；如实记录§0.3限制（graph-context/context-input/execution-entry）。
9. **U1按甲。** 两条路径都取max(R,P)，旧回复后来不可用也成为新未看；同一段不可用内重放、刷新不换位置，恢复清除R，再进入写新R。不得以respondedAt/sourceCursor或读取时写入替代；旧库缺位置按§2.3明确失败。B按lead已定L10/L11，整份待冻结；产品选择由决定49解决。
10. **只写§6。** 不改vendor、锁文件、运行器、UI或其它文档；没有新生产路由。架构检查迫使额外改动时给准确file:symbol及原因，由lead重冻结清单。
11. **真实夹具、脚本模型。** 不改数据库制造Goal变更/退休/已消费，不调用真实模型，不碰3080/3099/44797，不运行git写命令。

## 9. 验收与不做的事

DSH 做完后：检查冻结的测试侧文件的 sha256 和精确文件清单；跑 typecheck（含 UI）、check:architecture、DSH 写的新测试文件、§5.5 点名的回归和 W232；合入前在有 bwrap 的 WSL 跑一次全量和 build，比较失败的名字和信息，不只比较数字。lead 按 §5.2 逐行核对：每行都有测试、测试名以行号开头、期望值来源独立、没有 TDD skill 反面清单里的写法。无需浏览器或真实模型；E3 的行验证原业务事实同提交、回滚、重放、恢复清除和再进入的新位置，E1–E3 验证正式组合和已有路由，读取仍须零写入、零模型调用。结果固定报告 `FILES CHANGED / CHECKS / UNSPECIFIED / NOTES`，并附 §5.2 每行对应的测试名和主/子 DSH 用量。

不做：G扩容；I-1/I-3/E15重做；改变Goal说明；第6片初始化卡关闭/秘书请求处理；第7片自动感知、到期、转交新消息、待放行/独立审阅入口；补notes/footprint/note_review/message_release；通知UI/聚合文案/浏览器推送；全面修复旧卡关联或读模型规模（决定49第28项归第2片，L6只是暂时防护）；自动迁移历史库；真实模型E2E。I-5“发现未送达”不等于“转交交互已交付”，I-6“提醒有待决”不等于“决定自动落实”，本包不等于MVP完成。

### 9.1 合入时的更正和限定（lead 2026-10-14）

施工五轮、Codex 三次验收审查以后，lead 定的：
1. **§4.4 第 5 条的拒绝码。** 回复 DTO 上的 `sourceSessionRef` 和目录推出的来源 Session 不一致，逐项校验时就拒，码是 `unavailable/undelivered_reply_source_mismatch:`，先于去重。`undelivered_reply_identity_conflict:` 只留给逐项校验都通过、同一个键内容却不一致的重复项。这是第 4 轮唯一的生产改动（`views/undelivered-reply-notices.ts`）。
2. **F14 的 Query 回答。** 写入方 `respondFromQueryAnswer` 只接在 Workflow 内部的 `consultations.messages` 上；重试 `consumeConsultation` 在 `consultation.ts:152` 提前返回，公开入口走不到写入方的回执重放。测试照样核对第一次、重试、重开库后的完整值、游标、DTO 的 R/P、P 处的通知和回复正文；写入方自身的重放不另测，不为测试加入口。
3. **F10 的 Query 恢复正例。** 先存回复、再跑 Query，Query 进入时会把这条回复当输入收下，通知是空的（这是对的）。正例因此是：先起 Query，执行中存下 Work 的回复，再让 Query 结果未知、经真实的 `resolveUnknownQueryRun` 恢复，在观察到的 R 处出通知；两个后端。
4. **临时上限。** 待答卡提醒的 50 页/5,000 张、未送达回复来源的 50 页/5,000 条，是本包写明由第 2 片撤的临时防护；2A 规格 §0.4 撤掉它们，对应的测试边界由 2A 翻转。
5. **测试文件。** `tests/runtime/WP2-context-assembly.test.ts` 删了（它的四个测试替换了成功的内部协作者）；Query 的模式和扩展的检查改在 E2 的 F08 里经真实路径做。

## 附录：多视角核对

### A. 数据流、权限和状态视角

```text
I-2  Work身份/原准入 ── mailbox.sendUserMessage ── 职责adapter
           原回执优先                         ├─ RoleBindingFacts + guards
                                              ├─ Session固定role/provenance + guard
                                              └─ RoleSpec pin / 完整legacy模板
       effectivePlatformDuty ── duties facts ── 原canSendUserMessage/CAS
       读失败→拒绝；无明确duty→executor；只读副本→政策禁止；没有角色热切换

I-4  已授权graph reader ── 同范围Host扩展 ── readGoalSettings ── goalPayload
       未装→NI；缺settings→owner默认；已装读坏→失败；setter/G均不改变

I-6  已授权graph reader ── 同范围Host扩展 ── queryDecisionQueue(waiting_answer)
       卡各自owner→queue派生状态→翻完页→Task指称筛选→decision:<cardKey>
       缺卡源→明确索引提示；行→reminders预算；不写卡、不读notice、不加准入pin

I-5  state每次进入不可用 ── 原health/Work reconcile/Query recovery ── 原commit绑定unavailableSince=R
       state首次回复 ── 原mailbox共用写尾       ── 原commit绑定responseSince=P
       SES-13恢复available并清除R；再次不可用写新R；同段内重复观察/归档/转交保留位置
       Host queue(notices) ── 只读notice source ── includeArchived目录
       不可用线→readUndeliveredReplies(R/P)→原message归属/Goal过滤→范围内R/P核对/二元ref
       最低水位→同窗核对（目录source_stale整窗重读，最多四次）→去重→max(R,P)→完整位置分页
       queue计数/token→用户明确markNoticesSeen；未显示的同cursor尾项仍未看
       先回复后不可用取R；先不可用后回复取P；时钟不参与，同段内重放/重开位置不变
       范围内缺历史位置→明确incomplete；确定属于其它Goal先排除，不造legacy位置、不补写；已被执行接受→原owner不再列
```

| 视角 | 推导结果 | 找到的矛盾/不能成立的给定/处理 |
| --- | --- | --- |
| I-2 身份/授权 | 唯一生产调用点是M的Work分支；resolver证明当前绑定可用，Session role固定；新facts仍带guards | 不能把resolver拒绝等同未配置再回退；不能拿I-1的unknown当消息duties；不能造“独立Query成功发送”正例。L1/L2及DU06/07/12堵住 |
| I-4 内容/时序 | setter早已可写settings；I-4新增读取，objective仍无写者；G摘要没包含自治 | 旧L3的“接I-4时升摘要”与本次明确要求冲突，§0.3按本次要求写清；CX04/RA04只证明不变范围，不能宣称新鲜自治准入 |
| I-6 producer/consumer | X原只给anomaly，A原也只消费anomaly；Task@0存于source pins而非真实卡.task字段 | 单改X不能交付；按card.taskRef写测试会断言不存在字段；把Task@0塞AggregateRef是伪记录。CX06/RA01/RA05覆盖 |
| I-6 完整性 | queue总countsComplete涵盖未接notice；双Goal卡归属由pair决定；look/find传空focus | 不能要求countsComplete=true、不能只比card.goalRef、不能因空focus丢全部卡；CX07/08/09覆盖。未规范关联Run/file的卡保留Goal级，写在L5而非暗猜 |
| I-5 来源/归属 | 来源按发送Session读，归档旧线责任可能已转走；DTO不含goalRef；acceptedInputs才证明送达 | 不能只列active、只找responsible links、把hasContinuation或replyHandler当已送达；NR02/04/15–18覆盖 |
| I-5 身份/分页 | 同消息正式只有一个response slot；投影身份仍须完整二元ref；过滤在候选分页后 | NR03用两次隔离的替身调用比较不同responseRef的键，不能在同一稳定窗口制造双response；空页不等于末页，NR06覆盖 |
| I-5 时间/已看 | `mailbox-service.ts:readUndeliveredReplies/commitPreparedSessionMessage` 的原sourceCursor是读取账本水位、since是问题创建；B补原写者的R/P，由 `notice-position.ts:compareNoticePositions` 取max | U1=甲已解决；NR21堵旧回复后不可用，NR22堵同提交尾页，NR23堵同钟/回拨；NR28明确旧库缺位置，不能把“可读原消息”写成“已知进入位置” |
| 合成/依赖 | 配置层不能import Runtime；生产组合独占装配；新read source没有commit | legacy resolver由C注入；D组串接；UI后缀不变，ROUTE_LABELS无被迫变更；architecture检查仍必跑 |

### B. 逐用例核对（已作废）

这里原来逐个核对旧的 76 个用例（DU、CX、NR、RA、PI、ST）。2026-10-13 这些用例按 TDD skill 作废，§5 改成按入口的验收行为表，测试由 DSH 一条一条写，所以本附录不再适用。旧内容在提交历史里。
