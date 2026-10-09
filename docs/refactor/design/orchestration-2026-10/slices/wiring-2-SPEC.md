# 接线包 2 规格：I-2、I-4、I-5、I-6

> **状态：草稿（Codex 起草，待 lead 审核）。** 2026-10-09。核对基线 `bd408e66ef0645e5a231ccb45b2a12227c5d92d1`。第 1、3、5 片及接线包 1 已在 HEAD；本文件不是冻结任务书，不授权施工。依据：[分片总说明](README.md)“合入以后的接线”及三个有日期的“施工结果”；[第 1 片规格](slice-1-SPEC.md) §2.5、§3.3，[第 3 片规格](slice-3-SPEC.md) §2.4–2.5、§4.1–4.3，[第 5 片规格](slice-5-SPEC.md) §2.2、§2.5–2.6、§4.1–4.2、§8，[接线包 1](wiring-1-SPEC.md) §0、§4；[DESIGN](../DESIGN.md) §1.4、§4.5、§5.1、§7.2；[HANDOFF](../../../HANDOFF.md) 决定 43–48；[DSH-WORKFLOW](../../../DSH-WORKFLOW.md) §6.10。旧规格与已合入实现有差异处以下面点名的 `file:symbol` 为准；本次明确要求 **G 不动**，优先于旧接线包 L3 的预告。

本包只接四条线：

- **I-2**：消息发信职责从过渡映射改读正式角色事实，交 `effectivePlatformDuty` 求单一职责；原消息 owner 决定可不可以发送。
- **I-4**：`extensions.goalSettings` 接 `GoalSettingsPort.readGoalSettings`，自治值原样转交。
- **I-5**：`undelivered_reply` 接 `SessionMailboxPort.readUndeliveredReplies`；按完整 `messageRef + responseRef` 去重；读列表不转交、不确认消费。
- **I-6**：`extensions.decisions` 接 `DecisionReadPort.queryDecisionQueue` 的待答卡，并补上装配器把这些行放进提醒段的消费端。行格式及任务关联口径见 L5，均【lead 定，待审】。

## 0. 草稿说明

### 0.1 OPEN：要用户定

**U1：一条已经保存、尚未被执行消费的回复，后来因原 Session 退役才成为“未送达”，是否要作为新出现的“请知悉”再次提示？** DESIGN §4.5、AMB-43 明确定了“退役以后到的回复”；没有找到对“先回复、后退役，而且用户已看过更晚通知”的决定。当前 `communication/mailbox-service.ts:readUndeliveredReplies` 两种都返回，只检查源 Session 退役、存在 response、没有 response acceptance，不比较回复与退役的时间。`views/notice-position.ts:compareNoticePositions` 和 `configuration/decision-settings-service.ts:markNoticesSeen` 则按类别的单一位置排除旧项。

这会产生两个用户能看见的结果，草稿不替用户选：甲，后来退役的旧回复也算新提醒，须有“进入未送达集合”的持久位置；乙，通知按回复原来的时间排序，已经越过已看位置的旧回复只在原线的未送达列表中保留。L8 的 `legacy/respondedAt` 方案能覆盖已定的“退役后迟到”路径，**不能据此默认选择乙**。在 U1 定下或 lead 找到已有决定以前，B 组可以做读取、去重及迟到路径的测试，但不能冻结 I-5 的已看语义和最终生产接线。若甲需要补持久位置，先改本规格的接口、状态行、文件数和测试数；不能在只读 adapter 中偷偷写一张通知表。

本次没有新增转交按钮、提醒频率、自动唤醒或“看过即收到回复”的决定。长期 Workspace 索引超过 5,000 条的规模问题沿第 5 片证据保留，不在本包另定产品策略。

### 0.2 技术选择提案（均未冻结）

- **L1【lead 定，待审】I-2 用角色事实，不复用 I-1 的 `'unknown'` 自动归档兜底。** `configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter` 保留原 `roles.resolveRoleBindingFacts` 及其 guards，增加 Session 只读依赖和 pin 读取。角色正文取 Session 固定的 `role_spec.pin`；legacy 只认 composition 从 `agent-runtime/role-profiles.ts:platformRoleProfile` 传来的五个完整模板及版本。有效职责调用 `state/context-input.ts:effectivePlatformDuty`；两种职责都缺席时，沿该函数的缺省 `executor`，不是给未知角色任意授予秘书权。当前执行入口 `tasks/execution-entry-service.ts:contextConsumptionProblem` 也是角色/版本化模板/缺省 executor 这条规则。
- **L2【lead 定，待审】读取失败与无职责分开。** 当前过渡 adapter 在 role resolver 拒绝后仍可能尝试 legacy 映射；正式 adapter 不沿用这个分支。`rejected` 原样返回，`not_found/not_ready` 原样返回，throw 转 `unavailable`；`ready/inadmissible` 回 `forbidden`，不降级。`ready/absent` 只代表已经核实没有角色矩阵，仍读 Session 固定角色。Session 版本 guard 与 resolver 的 guards 一起交原 owner；角色 pin 不随激活指针更换。`readOnlyCopy` 来自 `SessionRecord.provenance.kind==='readonly_copy'`。`independentReview:false` 仅适用于当前 `mailbox-service.ts:sendUserMessage` 唯一能走到 adapter 的 `work_run` 入口；独立审阅/普通 Query 没有这条发信入口，不能把 `duty==='reviewer'` 直接等同独立审阅（`state/decision-policy.ts:canSendUserMessage` 允许普通 reviewer 发 notify）。
- **L3【lead 定，待审】删除过渡注入，不保留第二种生产授权。** 删除 `MessageDutiesFactV1`、`MessageDutiesMappingPort` 和 `TargetPlatformOptions.messageDutiesMapping`。三个仍构造 mapping 的既有测试辅助文件改为显式 `MessageDutiesFactsPort` 测试替身，保留其 `f.duties` 测试旋钮；它们测的是决定落实/重放，不能为迁移夹具改正式 Session 的角色或放宽生产 adapter。新增 I-2 集成用例单独验证正式 adapter。
- **L4【lead 定，待审】I-4/I-6 继续用接线包 1 的扩展提供方。** `views/context-extensions.ts:createContextExtensionsReader` 增加可选的 `goalSettings`、`decisions` 窄依赖，production composition 必装；旧窄替身没装时分别 `not_implemented`。顺序为已有参数/scope/signal 检查 → anomalies 原路径 → goalSettings → decisions；失败停止，不把已装但读坏的来源变成 `available/[]`。Host 上下文仍只在图读取器已授权后、以同 project/workspace/signal 构造，不发布新的 HTTP 或模型入口。
- **L5【lead 定，待审】I-6 行格式、任务关联和不完整提示。** 卡行 `key='decision:'+card.cardKey`，与 `anomaly:<refkey>` 同层。`node` 统一指请求 Goal，避免在无活动 Plan 的 Goal 上伪造 task/plan ref；文本与 sources 见 §4.3。请求有 focus 时只留明确涉及该任务的卡和无明确任务的 Goal 卡；关联从 `source.pins` 与 `objects[].pin` 的正式 Task 指称读取，不从中文摘要、发信人最后一轮或裸 taskId 猜。当前 `tasks/goal-decision-reader.ts:taskPin` 使用 `{aggregateType:'Task',projectId,goalId,taskId}@0`，这是指称，不是持久 aggregate。`countsComplete:false` 不能当作 queue 故障：HEAD 的 note_review/message_release 仍未接，连只要待答卡的读取也会因其它来源缺席而为 false。只针对七个卡来源的 `not_available` 加明确提示行，忽略 notice 类别的可用性，不说“全部没有待决”。
- **L6【lead 定，待审】I-6 的翻页按完整队列读取，不按筛选后的行数停。** 每页 100，最多 50 页/5,000 张输入卡；正好 5,000 且无下一页可通过，仍有下一页回 `capacity`。这是本扩展的聚合预算，不冒称原 queue 的全局预算：`views/decision-read-model.ts` 对每个来源有各自窗口。第一页与后续页 `sourceCursor` 必须相同；不同回 `unavailable`，下一次准备可重新读。不缓存半份队列。因焦点过滤而得到空页仍继续读 cursor。
- **L7【lead 定，待审】I-5 单独的只读 notice source。** 新 `views/undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource`，只实现已有 `DecisionNoticeSourcePort`，放进原 `createDecisionReadModel.noticeSources`。用 `SessionDirectoryPort.findSessions(includeArchived:true)` 枚举同 Workspace 全部线；不能只从任务开放负责关系找，E15 已会转走旧线责任。对退役线调用原 mailbox 来源页，再读原消息元数据求 Goal。空页仍翻页。Session 枚举、每条线的来源扫描分别每页 100/最多 50 页，单个 source 的去重输出最多 5,000 项；超量回 `capacity`。开始/结束及中间来源的水位必须一致，最多重读整个窗口四次，持续变化回 `unavailable`。没有 notice 的 Workspace 也必须有真实读水位，不能伪造空游标。
- **L8【lead 定，待审；受 U1 限制】I-5 项身份和迟到路径的位置。** `itemKey='undelivered_reply:'+canonicalJson({messageRef,responseRef})`；responseRef 是 ArtifactRef，不是字符串 id。行文为 `未送达回复 · Session ${sourceSessionRef.sessionId}`，`objects` 指原消息当前版本，`rework:null`。现有 `UndeliveredReplyV1` 只有 `respondedAt`，没有回复提交 cursor；消息 wire 的 `since` 是问题创建的位置，不可拿来当回复到达位置，更不能把本次读取水位当创建位置。暂提案该类别统一使用 `position={kind:'legacy',occurredAt:respondedAt,itemKey}`，经现有比较器排序；不会与其它类别的已看位置混用。时间相同以完整 key 决序；先去重再计数、分页。本提案对先回复后退役及时间回拨的边界须在 U1 一并明确，未定前不发布它的已看功能。
- **L9【lead 定，待审】提醒是索引，不新增消费守卫。** `agent-runtime/context-assembler.ts:optionalRowsFromExtensions` 将 decision 行合入 reminders，仍按既有预算、全行省略和字符码排序。`ContextIndexRowV1.sources` 保留来源，但不把这些提醒的 pins 合并进执行准入的 `binding.sources`；当前 `views/graph-context-reader.ts:readContextFacts` 的顶层来源本来只取 `baseSources`。待决卡变化不应使不相关的已准备执行卡住。改这项会涉及新的准入行为，超出 I-6。

### 0.3 G 与本包的边界（本次要求，不待 DSH 选择）

**I-4 不新增任何修改 Goal 的动作，也不让修改 objective 成为可能。** 但不能说“Goal 内容现在完全不能变”：第 5 片已有 `tasks/goal-settings-service.ts:setGoalSettings` 写 `GoalSnapshot.settings`；`persistence/record-codecs.ts:readGoalSettings` 为缺字段的旧记录提供默认值。I-4 只是把这个已经可变的自治值读进 `context-assembler.ts:goalPayload`。

G 的实际摘要是 `contracts/graph-context.ts:goalContextContentV1` 的 `{contentVersion:1,goalId,objective,workspaceId}`；`state/context-input.ts:contextGoalContentProblem` 与 `tasks/execution-entry-service.ts:contextConsumptionProblem` 比较它。`state/goal-machine.ts:GoalEvent` 仍无改 objective 的事件。**本包不改这些函数、版本或 Workflow 的 G 重准备分支。** 新准备显示当前自治；准备后改自治不触发 G，也不重新装配已绑定输入。自治相关的实际动作权限继续由第 5 片原 owner 在动作时检查。

这与 wiring-1 §0 L3、README 夜间施工结果中“把自治加入摘要并升到 2”的预告不同；本次用户明确说保持 G 不动，故本草稿不执行那个预告。不能把本包验收写成“自治的准备后变化已被 G 拦住”。以后若要求这一行为，另列变更；不通过改数据库 objective 来假造本包生产场景。

### 0.4 核对依据与已建成的接缝

| 项 | HEAD 的真实入口及差异 | 本包落点 |
| --- | --- | --- |
| 第 1 片 | `model/communication-contracts.ts:UndeliveredReplyV1`；`communication/mailbox-service.ts:readUndeliveredReplies` 是按 Session 的可选 port 成员，实际工厂已实现；来源读不含 Goal、没有通知位置 | I-5 补投影；不改原 owner 的退役/acceptedInputs 判定 |
| 第 3 片 | `state/context-input.ts:effectivePlatformDuty` 已有；`context-assembler.ts:effectiveDuty` 的 Runtime 装配还会检查 Host duty；`optionalRowsFromExtensions` **只**消费 anomalies，没有 decisions | I-2 用正式纯规则；I-6 同时接生产者和消费者，不误称已经会渲染 |
| 第 5 片 | `tasks/goal-settings-service.ts:readGoalSettings` 返回 `{goal,settings}`，不是裸 settings；决定读接口实际叫 `model/decision-contracts.ts:DecisionReadPort.queryDecisionQueue`，没有 `readDecisionQueue` | I-4 取 `value.settings.autonomy`；I-6 只取 `waitingAnswer` |
| 接线包 1 | `views/context-extensions.ts:anchorRow/createContextExtensionsReader`；`composition/create-platform.ts` 已装 anomalies；`composition/session-duty.ts:createSessionDutyResolver` 已承担 I-1 | 原 anomalies 文本、排序、25 页上限及 I-1/E15/G 全保留 |
| 第 5 片返工 | `views/decision-read-model.ts:queryDecisionQueue/readDecisionQueueWindow` 最多四个稳定窗口尝试；`views/goal-conflicts.ts:lookupAll` 正好 5,000 不算截断；`notice-position.ts:compareNoticePositions` 是唯一 notice 游标比较点 | 用例含精确边界，不能恢复“截断后假报完整” |

上表 WorkGraph 路径省略 `src/core/work-graph/`，Runtime 路径省略 `src/core/agent-runtime/`。施工事实按最新日期读取：[片 1](../../../reviews/evidence/orchestration-slice-1-2026-10-08/README.md)的原 E15 缺口已由[接线包 1](../../../reviews/evidence/orchestration-wiring-1-2026-10-09/README.md)补上；[片 3](../../../reviews/evidence/orchestration-slice-3-2026-10-08/README.md)的合入修正保留；[片 5](../../../reviews/evidence/orchestration-slice-5-2026-10-08/README.md)以“2026-10-09 夜：决定 48”验收为准，不采用上午“没有接受”的旧状态。历史全量是 279 文件/5,974 项及 verify:isolated 通过，不是本次起草重跑的结果。

### 0.5 数量和冻结条件

按当前提案的 §6 清单：**16 个实现/测试路径（新建 9、修改 7）**，其中生产 5（新建 1、修改 4），测试及辅助 11（新建 8、修改 3）；新测试文件 5，新辅助文件 3。§5 **62 个用例、74 次运行**：DU 18/22，CX 16/18，NR 20/26，RA 5/5，PI 3/3。括号中的分支在一个 `it` 内显式循环，不用 `it.each` 暗中改变数量。

新 aggregate、索引、持久字段、事件、路由、模型工具和状态迁移行均 **0**；§3 的 8 行是读取/投影流程，不是状态机新增。U1 未定分支另有一条产品核对记录，**不冒充第 63 个已有精确断言的测试**。如果 U1 决定需要持久位置，这组数字和只读范围必须重新冻结。

本次仅新建本规格 1 文件，源码/测试改动 0，测试运行 0，产品模型调用 0，DSH 启动 0。上述 16/62/74 是后续施工提案，未宣称夹具已搭好。lead 冻结前要解决 U1、逐项审 L1–L9、跑夹具冒烟并据实际 test collection 再核数量。

## 1. 范围与职责

| 接线 | 写规则的 owner | 读/组合的 owner | 可见结果与边界 |
| --- | --- | --- | --- |
| I-2 | 原 `communication/mailbox-service.ts:sendUserMessage`、`state/decision-policy.ts:canSendUserMessage` | `configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter` | 正式 secretary/adviser/scribe 能发决定请求，executor/reviewer 仅 notify；工具/Host grant、当前 Run 准入、回执重放顺序都不变 |
| I-4 | 原 `tasks/goal-settings-service.ts:setGoalSettings` | `views/context-extensions.ts:createContextExtensionsReader` → `context-assembler.ts:goalPayload` | 新上下文显示原样自治值；读不到是读失败，没装是 not_implemented |
| I-5 | 原 mailbox 写 response/acceptance；原 Workspace 设置 owner 写已看 | 新 `views/undelivered-reply-notices.ts` → `views/decision-read-model.ts:queryDecisionQueue` | 迟到未消费回复可从请知悉发现；身份不复制，读取零写；U1 未定 |
| I-6 | 原消息/计划/目标 owner 决定卡状态 | 同扩展提供方 → `context-assembler.ts:optionalRowsFromExtensions` | 只展示本次读取到的待答索引；不答复、不自动落实、不放宽准入 |

## 2. 接口（新增名字为提案；未列出的公共 DTO 不变）

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

### 2.3 I-5：已有类别的 SourcePage adapter

```ts
// src/core/work-graph/views/undelivered-reply-notices.ts（新）
export type UndeliveredReplyNoticeSourceDependencies = {
  records: DecisionReadRecordsPort; // 只有 readMany/lookup，无 commit
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  messages: Pick<SessionMailboxPort, 'readUndeliveredReplies'|'readMessage'>;
};
export function createUndeliveredReplyNoticeSource(
  deps: UndeliveredReplyNoticeSourceDependencies,
): DecisionNoticeSourcePort;
```

`category` 固定 `undelivered_reply`。`messages.readUndeliveredReplies` 未装时直接返回 `ready/{availability:'not_available',items:[],nextCursor:null,sourceCursor:null}`，不读 records。已装后无项是 `available/[]`；任何实际读取故障返回真实失败。该 adapter 只给 `createDecisionReadModel`；ctx 必须是当前 Workspace 的 Host（公开 queue 当前也不为 Query 开 mailbox 能力），不为未知调用方补一个更强身份。图上下文 I-6 用同范围内部 Host 读 queue，但只请求 waiting_answer，不触发 I-5。

## 3. 读取流程行（8 行，零个新状态迁移）

| # | 位置 `file:symbol` | 输入/动作 | 分支及输出 | 写入/重放 |
| --- | --- | --- | --- | --- |
| W2-D01 | `configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter` | 正式 Session + RoleBinding | 按 §4.1 读事实；ready 单职责及 guards，或真实失败 | 零写；不缓存跨调用授权 |
| W2-D02 | `communication/mailbox-service.ts:sendUserMessage` | 新用户发信/原请求重试 | 原回执命中仍早于 duties；新发信仍走原准入/政策/CAS | owner 的既有写，不改状态行 |
| W2-G01 | `views/context-extensions.ts:createContextExtensionsReader` | 读 Goal settings | 未装 NI；已装成功 available/原自治；失败不降级 | 零写；G 不变 |
| W2-C01 | 同上；`views/decision-read-model.ts:queryDecisionQueue` | 当前 Goal/focus | 全部 waiting_answer 页 → 任务筛选 → 确定索引/缺来源提示 | 零写；不读 notices、不生成 displayToken |
| W2-C02 | `agent-runtime/context-assembler.ts:optionalRowsFromExtensions` | extensions | anomalies + decisions 共用 reminders 预算；copy/planning 不新增提醒段 | 零写；已绑定 Run 不重装 |
| W2-N01 | 新 `views/undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource`；原 `sessions/session-directory.ts:findSessions` | Workspace/可选 Goal | includeArchived 枚举、退役来源逐页、消息归属核对 | 零写；不因旧线已转走任务而漏读 |
| W2-N02 | 新 source；原 `communication/mailbox-service.ts:readUndeliveredReplies` | 未消费 response | 完整二元 ref 去重；排序/after/seek 分页；U1 未定部分不冻结 | 不写消息、不转交、不 ack、不启动模型 |
| W2-N03 | `views/decision-read-model.ts:readDecisionQueueWindow`、`configuration/decision-settings-service.ts:markNoticesSeen` | 来源页/实际显示 token | 原计数、capabilities、显示页 token 和人工已看入口 | 只有明确 markNoticesSeen 才有原 Workspace 写 |

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

### 4.4 I-5：退役回复到“请知悉”

1. `workspaceScopeProblem`、Host 身份及取消检查先于读取；可选 goalRef 的 project 必须同 scope。Goal 在其它 Workspace 的输入，读该 Goal 经 `decodeGoalSnapshot` 确认后回 `forbidden`；同 scope 不存在回 `not_found`。没有 goalRef 的通知查询不枚举全部 Goal，也不引入 200 Goal 限制（第 5 片 T-R2-3a）。
2. 按 L7 枚举 `findSessions(ctx,{workspace,includeArchived:true,page:{limit:100,...cursor}})`；只对返回 `record.health==='unavailable'` 的 Session 调来源。不能要求 lifecycle 必须 archived，也不能排除有 continuation 的线。第 1 片 owner 返回的 `hasContinuation/requiresUserRecipient` 是事实，不能解释成已转交。
3. 每条退役线调用 `readUndeliveredReplies(ctx,{sessionRef,page:{limit:100,...cursor,atLeastCursor}})`，atLeastCursor 使用调用方要求（如有）；保留 sourceCursor 核窗口。空 items 但 nextCursor 非空仍翻页，因为底层按发送消息分页后才过滤 response。每个 item 重读 `messages.readMessage(ctx,messageRef)`：必须是同 scope 的 work_run sender，sender.sessionRef 与来源相等，当前 response.bodyRef 等于 item.responseRef，且无 response acceptance。不打开 body。并发导致不一致先重读窗口；稳定窗口仍不一致回 `unavailable/undelivered_reply_source_mismatch:`。
4. Goal 取原消息 `goalRef`；旧消息缺席/null 时取 `sender.runRef.projectId/goalId` 构成 GoalRef。两者都在时必须一致，不一致走上条 `undelivered_reply_source_mismatch:`；不从 Session 当前负责关系猜。仅保留请求 Goal（如有）。源中已消费的回复由 mailbox 排除；转走但尚未消费的仍保留。
5. 去重按 L8 二元 ref，重复且内容一致只一项；同 key 而归属/时间/源 Session 不一致回 `unavailable/undelivered_reply_identity_conflict:`。`objects=[{kind:'aggregate',pin:{ref:message.ref,revision:message.revision},label:'原消息'}]`，不把 ArtifactRef 强塞 AggregateRef。不新建 SessionMessage、不调用转交、不调用 recordInputAccepted。
6. 位置暂提案见 L8；U1 未定分支不默认处理。对已定的迟到路径，先去重、按 `compareNoticePositions` 排序、按 input.after 排除已看、再按 source page cursor 的最后返回位置作 seek。cursor 是 `base64url(canonicalJson({v:1,workspace,goalRef:goalRef??null,after:after??null,last:position}))`；字段/scope/过滤/after 不符或格式坏回 `invalid`，不能静默从第 1 页重来。source 接受 1..200 的内部 page.limit（queue 当前 SOURCE_PAGE_LIMIT=200），直接来源请求不合法回 invalid。不要把它错限成外层 queue 的 1..100。
7. 来源页 sourceCursor 为本次稳定窗口，不是每项的位置；以 `readWatermark(records)`（原理为 `records.readMany([])`）首尾核对，实际带 sourceCursor 的 Session 列表页、回复来源页必须同窗。`readMessage` 不返回水位，其读取由首尾 records 水位包住，不能虚构 metadata cursor。真实 `not_ready/not_found/rejected` 原样传播，底层 Store 失败沿 `goal-conflicts.ts:storeFailureToRejection` 转换；throw 转 `unavailable/undelivered_reply_read_failed:`，损坏消息不跳过。四次不能稳定 → `unavailable/undelivered_reply_window_changed:`；任一 L7 上限后还有下一页或超输出上限 → `capacity/undelivered_reply_page_limit:`。生产只经原 queue 读；queue 的外层稳定窗口和 token 机制保留。
8. 注册后即使 0 项，capability 也是 available；不注册或窄依赖未装才是 not_available。其它类别未实现仍保持 not_available，countsComplete 不能因此改成 true。读取/重复读取/刷新不写 Workspace 已看；只有原 `markNoticesSeen` 收到该操作者实际显示页 token 才更新。

## 5. 测试

### 5.1 夹具与运行口径

所有新用例一行对应一个 `it`；ID 不复用接线包 1 的名字。标 **双** 的 12 行在 memory、SQLite 各跑一次；标 **单** 的端口替身/纯装配行只跑一次；PI 三行固定 SQLite。共 62 行、74 次。失败分支用窄端口替身模拟，不破坏数据库。真实给定通过 owner 构造，沿 `tests/helpers/S1-archive-service-fixture.ts:createArchiveServiceFixture`、`tests/helpers/S5-decision-fixture.ts:openS5DecisionFixture`、`tests/helpers/WP1-units-fixture.ts` 和 `tests/scenarios/harness.ts`；现有 S5 fixture 含导入检查点，新增行为必须沿正式 owner 推进，不能改快照造结果。

代码出处缩写：**D**=`src/core/work-graph/configuration/message-duties-adapter.ts:createMessageDutiesFactsAdapter`，**P**=`src/core/work-graph/state/context-input.ts:effectivePlatformDuty`，**M**=`src/core/work-graph/communication/mailbox-service.ts:sendUserMessage`，**X**=`src/core/work-graph/views/context-extensions.ts:createContextExtensionsReader`，**Q**=`src/core/work-graph/views/decision-read-model.ts:queryDecisionQueue`，**U**=`src/core/work-graph/communication/mailbox-service.ts:readUndeliveredReplies`，**N**=拟建 `src/core/work-graph/views/undelivered-reply-notices.ts:createUndeliveredReplyNoticeSource`（依据 U 和 `model/decision-contracts.ts:DecisionNoticeSourcePort`），**A**=`src/core/agent-runtime/context-assembler.ts:optionalRowsFromExtensions/assembleTask`，**C**=`src/composition/create-platform.ts:createTargetPlatform`。每行最后一栏给当前依据；新 helper 不当作当前已存在的证据。

文件缩写：DU=`tests/work-graph/WP2-message-duties.test.ts`，CX=`tests/work-graph/WP2-context-extensions.test.ts`，NR=`tests/work-graph/WP2-undelivered-notices.test.ts`，RA=`tests/runtime/WP2-context-assembly.test.ts`，PI=`tests/composition/WP2-wiring.test.ts`。下表“生产前”是预期：新接线断言应 RED；旧不变分支应 GREEN，不要求桩阶段每个旧行为都 RED。夹具失败、import/编译失败不算预期 RED。

### 5.2 I-2（18 行，22 次）

| id | 文件/后端 | 给定/动作 | 精确期望 | 当前依据 |
| --- | --- | --- | --- | --- |
| DU01 | DU/单 | pinned RoleSpec duty=secretary，resolver resolved 同 pin | ready，duties 恰 `['secretary']`，两个 flags=false；pin 读取入参逐项相等 | D、P；L1 |
| DU02 | DU/单 | 五种 `platform-<duty>@s3.1` legacy 各读一次 | 各只返回对应一个 duty；legacy 不调 readRoleSpec | P；`role-profiles.ts:platformRoleProfile` |
| DU03 | DU/单 | absent 矩阵，普通 legacy 无正式 duty | ready/executor；不是 unsupported，不获得 decision_request 权 | P、`decision-policy.ts:canSendUserMessage` |
| DU04 | DU/单 | pinned spec 缺 platformDuty | ready/executor；仍读取精确 pin | D、P |
| DU05 | DU/单 | 正式 roleDuty=secretary、版本化 legacyDuty=adviser | rejected/forbidden，与 P 的冲突结果相等，无可发送事实 | P |
| DU06 | DU/单 | resolver 依次 rejected/unavailable、not_found、not_ready、throw | 前三原样；throw rejected/unavailable；Session/legacy/pin 后续读取 0 | D 原失败分支；L2 |
| DU07 | DU/单 | resolver ready/inadmissible | forbidden/§4.1 精确 reason；Session 读取 0 | `role-spec-materials.ts:RoleSpecResolutionV1` |
| DU08 | DU/单 | Session 依次 not_found、not_ready、rejected、throw | 前三原样；throw unavailable；没有 executor 兜底 | `session-directory.ts:readSession` |
| DU09 | DU/单 | Session pin 读取依次 not_found、not_ready、rejected、throw | 前三原样；throw unavailable；legacy resolver 调用 0 | `configuration-contracts.ts:RoleConfigurationPort.readRoleSpec` |
| DU10 | DU/单 | Session role 与 binding 的完整 id/revision 不一致 | forbidden；不读其它 pin，不返回职责 | `role-spec.ts:roleSpecRevisionFromBinding`；L2 |
| DU11 | DU/单 | Session 正式 readonly_copy，正文 duty=adviser | ready/adviser，readOnlyCopy=true；原 canSendUserMessage 对两种 intent 都 false | `core/session.ts:SessionProvenanceV1`、P |
| DU12 | DU/单 | 普通 reviewer Session、新 Work sender | independentReview=false；notify=true，decision_request=false | `decision-policy.ts:canSendUserMessage`、M |
| DU13 | DU/单 | resolver guards 有重复相同 key；再以不同版本冲突重读 | 相同版本只一份并包含 Session guard；冲突版本 rejected/revision_conflict | D guards；§2.1 |
| DU14 | DU/单 | foreign project、已取消、非 Host ctx 分支 | forbidden/cancelled/forbidden；所有依赖调用为 0 | M 的内部 Host 调用；§4.1 |
| DU15 | DU/双 | 真实固定秘书 RoleSpec + 真实进入的 Work，工具/Host grant 授权 send_user_message，正式 adapter；新 decision_request | committed 一条用户消息；decision.source 指同一消息；无 mapping；role/Session guards 进入原提交 | M；`S5-user-messages.test.ts` |
| DU16 | DU/双 | 真实 executor Work，正式 adapter；发 notify，再新 decision_request | notify committed；后者 forbidden、事件/记录增量 0；不能仅断言 allocated id=0 | M、`decision-policy.ts:canSendUserMessage` |
| DU17 | DU/双 | DU15 成功后，第二次同请求，duties reader 改成 throw | 原 cursor/value，replayed=true；duties 调用 0；无新消息/事件 | M 的 lookupCommit 顺序 |
| DU18 | DU/双 | Session pin R1；已有生效的角色矩阵，再正式安装/激活 R2；直接读旧绑定职责；当前 resolver 返回 inadmissible | forbidden，不读 R2 当旧 Session duty；不存在运行中角色热切换；无矩阵的 absent 分支不能冒充此给定 | `role-memory-service.ts:resolveRoleBindingFacts`；D |

### 5.3 I-4/I-6 提供方（16 行，18 次）

| id | 文件/后端 | 给定/动作 | 精确期望 | 当前依据 |
| --- | --- | --- | --- | --- |
| CX01 | CX/单 | X 只装原 anomalies | 两新格仍 NI（autonomy=null、rows=[]）；原 anomaly 行逐字相等 | X |
| CX02 | CX/单 | settings 分别返回 every_step/after_plan_confirmation | goalSettings available、两值原样；owner 收到同 Goal 和同范围 Host/signal | `goal-settings-service.ts:readGoalSettings`、X |
| CX03 | CX/单 | settings 返回 not_found/not_ready/rejected/throw | not_found；incomplete/goal_settings_not_ready:；原 rejected；unavailable/goal_settings_read_failed:；queue 未调用 | X；§4.2 |
| CX04 | CX/单 | G 的 goalId/objective/workspaceId 相同，只有 settings/revision 不同 | goalContextDigestV1 完全相同，contentVersion=1；本包不生成 context_goal_changed | `graph-context.ts:goalContextContentV1` |
| CX05 | CX/单 | fake queue waitingAnswer 两卡，另放 answered/history/notices 各一卡 | 只两条 `decision:<cardKey>` 及按 capabilities 所需提示；无其它卡；请求 sections 恰 waiting_answer | Q、X；§4.3 |
| CX06 | CX/单 | 两任务 T1/T2，Task@0 pins；另 Goal 卡；focus=[T1] | 只 T1 卡及 Goal 卡；sources 不含 Task@0，node 为请求 Goal | `goal-decision-reader.ts:taskPin`、L5 |
| CX07 | CX/单 | CX06，focus=[]；无 planRef | T1/T2/Goal 三卡全在；没有伪造 Plan 或 task node | `graph-context-contracts.ts:ContextReadRequestV1` |
| CX08 | CX/单 | 请求 Goal 是冲突 pair 的第二个，queue 返回 card.goalRef 为第一个 | 冲突卡保留一次，node 指请求 Goal | Q 的 cardInScope |
| CX09 | CX/单 | queue countsComplete=false；仅 note_review/message_release 卡来源缺席，另 notice 来源缺席 | 恰两条 decision:not_available 提示；其余真实卡保留；不因 notice 缺席失败 | Q 的 capabilities；L5 |
| CX10 | CX/单 | 两页，第 1 页卡全部被 focus 排除，第 2 页有焦点卡；水位相等 | 第 2 页仍读，传上页 cursor；结果含该卡；非空 cursor 不被丢弃 | Q nextCursor；L6 |
| CX11 | CX/单 | 第 50 页后(a)无 next、共5,000卡；(b)仍有 next | (a)完整通过；(b)capacity/decision_index_page_limit:，不返回半份 rows | Q 外页 100、L6 |
| CX12 | CX/单 | queue 第 2 页 not_found/not_ready/rejected/throw/水位变动 | 依 §4.3 原样/指定 code+前缀；无 available 半页 | Q sourceCursor；L6 |
| CX13 | CX/单 | 两页重复同 cardKey：(a)内容相同；(b)相异；输入次序反转 | (a)只一行且字节/排序不变；(b)unavailable/decision_index_conflict: | Q cardKey；`fingerprint.ts:canonicalJson` |
| CX14 | CX/单 | scope 错/已取消；或原 anomalies owner 拒绝 | 前两所有 owner 0 调用；后者原拒绝且 settings/queue 0 调用 | X 现有检查顺序 |
| CX15 | CX/双 | 真实旧 Goal 缺 settings 读一次；真实 setGoalSettings 改 every_step 再读 | 两次分别 after_plan_confirmation/every_step；两次读取零写；只有显式 setter 产生原事件 | `record-codecs.ts:readGoalSettings`、settings owner |
| CX16 | CX/双 | 真实待答消息卡，同 Goal；X 读取，原 answerDecision 答复，再读 | 首次含对应 decision 行；第二次该行消失，pending_application 不被塞回；不因缺其它卡源而失败 | Q、`decision-service.ts:answerDecision` |

### 5.4 I-5 来源（20 行，26 次；U1 定前不能据此宣称完整验收）

| id | 文件/后端 | 给定/动作 | 精确期望 | 当前依据 |
| --- | --- | --- | --- | --- |
| NR01 | NR/单 | 没装 readUndeliveredReplies | not_available/[]、两个 cursor=null；无其它依赖调用 | `communication-contracts.ts:SessionMailboxPort`；N |
| NR02 | NR/单 | 稳定 Workspace，有正常/退役/归档退役线，来源均无回复 | available/[]、next=null、真实 sourceCursor；只退役两线被查，includeArchived=true | U、`session-directory.ts:findSessions` |
| NR03 | NR/单 | 两页重复相同 messageRef+responseRef；另作两次隔离的替身调用，同 messageRef 分别配不同 responseRef，每次 readMessage 均与当次来源一致 | 跨页相同二元键只一项；两次隔离结果的 itemKey 不同；不要求一个稳定窗口中同消息同时有两份 response | U 的 DTO、L8 |
| NR04 | NR/单 | 回复的原消息 goalRef 存在/旧缺席两分支 | Goal 分别取 goalRef/发送 Run；filter 排除其它 Goal；不读 Session links 求归属 | U；`communication-contracts.ts:SessionMessage` |
| NR05 | NR/单 | item 与重读消息响应不符且首尾水位变，次窗恢复；另以稳定窗口分别给不符的 responseRef、sender Session、goalRef/发送Run归属 | 首者重读后只输出真实响应；三个稳定损坏分支均 unavailable/undelivered_reply_source_mismatch:；不拿旧 item 继续 | U、L7 |
| NR06 | NR/单 | source 空 items 但 next 非空，次页有项；Session 枚举亦有次页 | 两条 cursor 都推进，末页回复不丢 | U 底层候选分页；N |
| NR07 | NR/单 | Session/source 枚举各在第50页无 next/有 next 的边界 | 无 next 且不超5,000可过；有 next capacity/undelivered_reply_page_limit: | `session-contracts.ts:SessionPage`、L7 |
| NR08 | NR/单 | 扫描到5,001个不同二元键 | capacity，同调用没有 available 部分结果 | Q 的完整来源预算；L7 |
| NR09 | NR/单 | 同二元 key 的两项 respondedAt 不同；两次元数据核对均匹配 responseRef/sender/Goal | unavailable/undelivered_reply_identity_conflict:；不任选第一项；元数据不匹配的拒绝点另见NR05 | `UndeliveredReplyV1`、L8 |
| NR10 | NR/单 | 两项 respondedAt 相同、keys 倒序；after/seek 指其中第一项 | 初页按 key 排；续页只第二项，无重复/跳项；position 按 L8（待 U1 冻结） | `notice-position.ts:compareNoticePositions` |
| NR11 | NR/单 | cursor 坏编码、别 Workspace、别 Goal filter、别 after；page.limit=0/201 | 均 invalid；不能从头返回；不把200误判非法 | Q SOURCE_PAGE_LIMIT；§4.4 |
| NR12 | NR/单 | 依次在目录、来源、元数据返回 not_found/not_ready/rejected/throw；watermark 返回 Store 失败或throw | 三个owner的非ready原样；Store失败沿原转换器；throw unavailable/undelivered_reply_read_failed:；损坏记录不跳过 | U、`goal-conflicts.ts:readWatermark/storeFailureToRejection` |
| NR13 | NR/单 | source 返回 not_ready（携 observed/required）；另测试跨scope、取消、非Host | not_ready 原样；其余 forbidden/cancelled/forbidden，零读取 | U 的 watermark 检查；§4.4 |
| NR14 | NR/单 | 首尾水位变一次/连续四次；稳定时有真实回复 | 一次变后重读成功，用稳定窗 cursor；连续四次 unavailable/undelivered_reply_window_changed: | Q 稳定窗口先例；L7 |
| NR15 | NR/双 | S1 SV33 路径：真实退役归档、无接续，再正式答复；装 source/queue | 恰一条对应 notice，key 按二元 ref，summary/objects/rework 按§4.4；原 response、acceptedInputs 不变 | `S1-wait-disposal.test.ts:SV33`、U |
| NR16 | NR/双 | S1 SV34 路径：有接续仍退役，之后回复 | 同一来源 notice 一条；不把 hasContinuation 当已送达，接续线无新增执行/输入接受 | `S1-wait-disposal.test.ts:SV34`、U |
| NR17 | NR/双 | 回复已合法转给 D 但未消费，后 D 通过 recordInputAccepted 接受 response | 转交后仍一条；接受后该条消失；读取自身没有新提交 | `S1-wait-disposal.test.ts:SV32`、U |
| NR18 | NR/双 | 真实普通 active Session 有 response；另退役 Session 只有问题无response | 两者均不产生未送达 notice；available 空不等于 not_available | U 的过滤条件 |
| NR19 | NR/双 | NR15 两条迟到项；queue 分页显示一条，原 markNoticesSeen，再读下一页 | 只有实际显示项进入 token/已看；第二项仍可见；单纯再读不写；按 L8，待U1冻结 | `decision-settings-service.ts:markNoticesSeen`、Q |
| NR20 | NR/双 | 已看迟到项 r1；更晚时刻新迟到项 r2 正式保存，重读；SQLite 分支再重开 | 只 r2 未看；key/position 重开稳定，旧 token 不跨重启复用，重新读得新 token | Q、`notice-display-token.ts:createNoticeDisplayToken` |

U1 的复现必须在冻结前另写用例：r1 在 S 活着时已保存而未消费 → 看过别线更晚的未送达 r2 → S 退役。甲期望 r1 新增到未看列表；乙期望队列不重新提示、原 `readUndeliveredReplies(S)` 仍含 r1。没有答案前两种断言都不能加入冻结测试；不能用 NR20 的“新回复”偷换这条“旧回复后来才符合条件”。

### 5.5 Runtime 与生产组合（8 行，8 次）

| id | 文件/后端 | 给定/动作 | 精确期望 | 当前依据 |
| --- | --- | --- | --- | --- |
| RA01 | RA/单 | 合法 Work 事实，anomaly/decision 各一行，预算足 | reminders 两行恰一次，prefix不重复，按key字符码排；绑定两 availability=available；input 含原自治值 | A、X；L9 |
| RA02 | RA/单 | RA01 的 budget=0/很小两分支，含中文完整JSON行 | 原 renderContext 前缀/omitted/UTF-8 规则成立；义务与continuation完整，后者最后；不截半条decision | A 的 renderContext |
| RA03 | RA/单 | Query copy/planning，extensions 有 decisions/settings | goal 显示自治；两模式均不新增 reminders；binding callKind 原值；问题原文不变 | `context-assembler.ts:assembleQuery` |
| RA04 | RA/单 | 新准备1；settings变化；新准备2；对已绑定输入走恢复 | 新准备显示新自治；已绑定返回原输入；G摘要仍v1，不因卡变化多版本钉 | `execution-preparation.ts:rehydratePreparedExecution`；§0.3、L9 |
| RA05 | RA/单 | input 中真实 card sources 包含 Goal/Run/Task@0；卡答复后再次新准备 | 提醒文本反映各次事实；binding.sources 不因decision新增任意消费pins，Task@0不进record来源 | A、`graph-context-reader.ts:baseSources` |
| PI01 | PI/SQLite | createTargetPlatform 正式组合，具正式角色/授权 Work；无 mapping 发决定卡，再准备同Goal任务 | 发信成功；Goal自治行与 settings owner 一致；提醒包含同 cardKey；确认使用生产组合而非手拼 adapter | C、M、A |
| PI02 | PI/SQLite | 真实归档退役后脚本咨询保存回复；经平台 decisions.queryDecisionQueue 再经已有 decisions/queue route 读取 | undelivered_reply capability=available，原reply恰一条；两次读模型调用增量0、消息/Workspace提交增量0 | C；`core-routes.ts:CORE_ROUTE_SPECS`；S1场景 |
| PI03 | PI/SQLite | 未接的原窄reader与生产reader对照；Work/Query各用自己已授权Goal及foreign Goal读上下文 | 窄reader新格NI；生产已接；原graph授权仍拒foreign、未授权时queue/settings读0；无新公开平台键/路由 | `graph-context-reader.ts:resolveReadContexts/loadUniverse`、C |

### 5.6 回归与预期失败位置

- 第一段的新增接线断言应在 adapter 返回值/生产消费点失败，不能在注册 schema、创建 Session、claim/entry 或准备材料时失败。DU15/16 先证明真实运行有 send_user_message 权限；PI01 的模型脚本不得替自己授角色。
- 保持通过：`tests/work-graph/S5-user-messages.test.ts`、`S5-decision-application.test.ts`、`S5-decision-queue.test.ts`、`S5-notices.test.ts`、`S5-goal-settings.test.ts`、`S5R2-queue-history.test.ts`、`S1-wait-disposal.test.ts`、`WP1-context-anomalies.test.ts`、`S3-graph-context.test.ts`；`tests/runtime/S3-context-assembler.test.ts`、`WP1-context-assembly.test.ts`；`tests/scenarios/C6-unrelated-adoption.test.ts`。I-1/E15/G 不变，接线包 1 其余测试只在合入前全量中复核。
- 三个旧辅助文件只改工厂注入形式，不改任何既有测试期望。生产上下文的自治/提醒字节会变化；若既有整串快照因此失败，DSH 列文件:断言:实值交 lead 核实，不擅自扩大 §6 写范围。异常行字节、G digest、已绑定重放变化都当回归。
- 本次是规格起草，没有运行上述测试。后续新用例收集数应是74，不能将表内循环分支再乘一次；预计全量为284文件/6,048项的前提是基线仍为279/5,974且无其它批次合入，实际以冻结副本收集数为准。

## 6. 精确文件清单（当前提案 16 个；不含本规格）

| ID | N/M | 文件 | 用途/符号；所属组 |
| --- | --- | --- | --- |
| W201 | M | src/core/work-graph/configuration/message-duties-adapter.ts | createMessageDutiesFactsAdapter 正式事实，删除过渡类型；A |
| W202 | M | src/core/work-graph/views/context-extensions.ts | ContextExtensionsDependencies/createContextExtensionsReader，I-4/I-6；C |
| W203 | M | src/core/agent-runtime/context-assembler.ts | optionalRowsFromExtensions 的 decision 行消费；C |
| W204 | M | src/composition/create-platform.ts | adapter依赖、删除messageDutiesMapping、注册notice source、传两个扩展依赖；D |
| W205 | N | src/core/work-graph/views/undelivered-reply-notices.ts | createUndeliveredReplyNoticeSource；B |
| W206 | N | tests/work-graph/WP2-message-duties.test.ts | DU01–DU18；A |
| W207 | N | tests/work-graph/WP2-context-extensions.test.ts | CX01–CX16；C |
| W208 | N | tests/work-graph/WP2-undelivered-notices.test.ts | NR01–NR20；B |
| W209 | N | tests/runtime/WP2-context-assembly.test.ts | RA01–RA05；C |
| W210 | N | tests/composition/WP2-wiring.test.ts | PI01–PI03；D |
| W211 | N | tests/helpers/WP2-duties-fixture.ts | 真实角色/Session/Work及guard观察，不预置待测返回；夹具A |
| W212 | N | tests/helpers/WP2-context-fixture.ts | 真settings/queue、可注入扩展及Runtime准备；夹具C；D只读复用 |
| W213 | N | tests/helpers/WP2-notices-fixture.ts | 真实退役/等待/response/acceptance、同库重开；夹具B；D只读复用 |
| W214 | M | tests/helpers/S5-application-support.ts | owners 中旧mapping改显式测试facts替身，断言不动；A |
| W215 | M | tests/helpers/S5R2-b-support.ts | 同上，原 f.duties 行为保留；A |
| W216 | M | tests/helpers/S5R2-c-support.ts | 同上，原 f.duties 行为保留；A |

**已核查的连带文件，不是遗漏的可写白名单：**

| 文件/符号 | 本提案净改动 | 理由/若检查出现相反事实 |
| --- | --- | --- |
| tests/architecture/production-reach-allowlist.json:entries | 0 | HEAD 无上述mapping/adapter的允许条目；readRoleSpec 的旧 kept-for 已在接线包1删。新factory有C的真实调用。施工后必须跑生产可达检查，若有新变可达的既有条目，lead 点名删并更新本表/计数，不能加宽allowlist掩盖漏接 |
| tests/architecture/state-writes.test.ts | 0 | 无新写字段/状态机；N只注入readMany/lookup，不注入commit |
| src/app/core-http-types.ts:CoreRouteSuffix、src/app/core-routes.ts:CORE_ROUTE_SPECS、src/ui/api/routes.ts:ROUTE_LABELS | 0 | 原goals/settings、decisions/queue、messages/undelivered-replies都已有；本包0新路由，不需要新的穷举标签。若新加路由就已越出本包 |
| docs/refactor/module-target.json:configuration/views dependencies | 0 | configuration只依赖model/state/persistence；legacy模板函数从composition注入。views现已可读sessions/tasks/communication；不加向上边 |
| src/contracts/graph-context.ts:goalContextContentV1、src/core/work-graph/state/context-input.ts:contextGoalContentProblem、src/core/work-graph/tasks/execution-entry-service.ts:contextConsumptionProblem | 0 | G明确不改；不能因I-4擅自升contentVersion |

U1 若选择新的持久位置，以上是**尚不能直接冻结的清单**，不是授权 DSH 另外加字段/索引的理由。本次起草只允许写此新文件，HANDOFF/README/证据均不更新；验收后的文档同步由 lead 另批完成。

## 7. DSH 分组与接口交接（决定 46）

| 组 | 可写范围 | 输入/输出 | 依赖、可并行与停点 |
| --- | --- | --- | --- |
| 夹具阶段 | Codex按A/B/C各只写W211/W213/W212 | 已有owner构造给定；新factory由参数注入；快照记录/events/claims和模型调用计数 | lead先在WSL跑冒烟，再冻结这3个文件；D复用，不另造第四个同义fixture |
| A：职责 | W201、W206、W214–W216 | §2.1固定接口 → MessageDutiesFactsPort；DU18行 | 与B/C并行；不能写composition或state。实际构造不能成立时UNSPECIFIED后停，不改测试期望 |
| B：未送达来源 | W205、W208 | §2.3固定接口 → DecisionNoticeSourcePort | 与A/C并行；只读owner。U1解决前不得冻结已看分支、不得交最终实现；L7/L8格式先由lead审 |
| C：上下文 | W202、W203、W207、W209 | §2.2扩展reader → 原ContextExtensionsV1 → reminders | I-4/I-6共用文件，只给一个组。内部子agent可拆“provider”和“Runtime/测试”，同文件只一个写者；G和graph reader不改 |
| D：生产组合/整体验收 | W204、W210 | 消费A/B/C已冻结导出，复用同raw owner实例 | A/B/C接口可先写编译桩；生产合成在三组接口定后顺序进行。D独占composition，负责运行架构检查并报告确切allowlist变化 |

两段仍然分开：lead 审规格及附录 → Codex夹具/lead冻结 → DSH第一段写骨架与用例，STOP → lead逐行核对RED/GREEN、冻结测试sha256 → **新DSH Session**做第二段实现。带指导返工也新Session；主Session只分派/汇总，子任务全部回报前不能结束回合。每个子任务带本组文件、接口、对应规则与用例行，不让每个agent通读三片历史。共享文件只由表内所有者改。

运行器按 DSH-WORKFLOW §6.10 用上下文上限360000、每段120分钟；token只记不拦，主/子Session一起统计，等待单列。临时文件只在副本 `./.dsh-scratch/`。测试一次只跑一个，按机器槽位排队。实现不了约定做法先报告，不自行替换成进程缓存、放宽权限或减少测试。冻结测试与规格冲突时停下列出两处原文，lead 修规格/重冻结；不能暗选测试或正文一边。

## 8. 规则（发给 DSH 的说明书逐项带入）

1. **可用性如实。** 缺依赖是未接；已接且空是available空；已接而读取失败返回失败。I-6部分卡源缺席用提示行，不能因countsComplete=false永远拒绝已接的queue（X/Q）。
2. **授权留在原owner。** I-2只给事实和guards；tools/Host grant、原Run准入、重放先行都保留。只读副本不能发信；普通reviewer不冒充独立审阅（M/decision-policy）。
3. **只认完整引用。** 职责看正式pin/版本化模板；卡用owner cardKey；回复按messageRef+responseRef。伪Task@0只作关联，不作持久record或新授权（role-spec/goal-decision-reader/U）。
4. **分页不丢尾页。** 空filtered页照样跟cursor；上限含等号边界；超过回capacity，不报完整计数。不把sourceCursor拿来当notice发生位置（Q/lookupAll）。
5. **读取不推进业务。** 不答复、不创建卡/notice、不消费response、不转交、不自动启动Agent；原已看写仅由有效显示token触发（U/Q/markNoticesSeen）。
6. **退役与归档分开。** 退役可尚未归档，也可有接续；includeArchived必须true，不靠开放责任寻找旧线（session-directory/U）。
7. **I-6端到端。** 给扩展赋值还不够，装配器必须消费decision行；预算和continuation顺序使用原renderer。Query模式照旧（A）。
8. **G不动。** 不加Goal revision钉、不把自治/提醒来源加进G摘要、不重新装配已绑定Run；如实记录§0.3限制（graph-context/context-input/execution-entry）。
9. **U1留给用户。** 不用测试默认选择乙；也不以“技术实现”名义增加甲所需的持久状态。lead先确认出处或取得决定，更新此草稿后才能冻结B的已看接线。
10. **只写§6。** 不改vendor、锁文件、运行器、UI或其它文档；没有新生产路由。架构检查迫使额外改动时给准确file:symbol及原因，由lead重冻结清单。
11. **真实夹具、脚本模型。** 不改数据库制造Goal变更/退休/已消费，不调用真实模型，不碰3080/3099/44797，不运行git写命令。

## 9. 验收与不做的事

第二段完成后，检查 frozen 测试sha256和精确文件清单；跑typecheck（含UI）、check:architecture、5个新测试文件和§5.6点名回归；合入前在有bwrap的WSL跑一次全量和build，比较失败名/信息，不只比较数字。无需用浏览器或真实模型证明只读接线；PI验证正式组合和已有路由。结果固定报告 `FILES CHANGED / CHECKS / UNSPECIFIED / NOTES`，附主/子DSH用量及lead等待时间。

不做：G扩容；I-1/I-3/E15重做；改变Goal说明；第6片初始化卡关闭/秘书请求处理；第7片自动感知、到期、转交新消息、待放行/独立审阅入口；补notes/footprint/note_review/message_release；通知UI/聚合文案/浏览器推送；全面修复旧卡关联或读模型规模；自动迁移历史库；真实模型E2E。I-5“发现未送达”不等于“转交交互已交付”，I-6“提醒有待决”不等于“决定自动落实”，本包不等于MVP完成。

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

I-5  Host queue(notices) ── notice source ── includeArchived目录
       退役线→原readUndeliveredReplies→原message元数据→Goal/二元ref
       去重→稳定窗口→位置/分页→queue计数/token→用户明确markNoticesSeen
       response被执行接受→原owner不再列；转走未接受→仍列；读不产生任何转移
       U1：先保存reply、后退役的首次可见位置目前没有事实字段，不能伪造
```

| 视角 | 推导结果 | 找到的矛盾/不能成立的给定/处理 |
| --- | --- | --- |
| I-2 身份/授权 | 唯一生产调用点是M的Work分支；resolver证明当前绑定可用，Session role固定；新facts仍带guards | 不能把resolver拒绝等同未配置再回退；不能拿I-1的unknown当消息duties；不能造“独立Query成功发送”正例。L1/L2及DU06/07/12堵住 |
| I-4 内容/时序 | setter早已可写settings；I-4新增读取，objective仍无写者；G摘要没包含自治 | 旧L3的“接I-4时升摘要”与本次明确要求冲突，§0.3按本次要求写清；CX04/RA04只证明不变范围，不能宣称新鲜自治准入 |
| I-6 producer/consumer | X原只给anomaly，A原也只消费anomaly；Task@0存于source pins而非真实卡.task字段 | 单改X不能交付；按card.taskRef写测试会断言不存在字段；把Task@0塞AggregateRef是伪记录。CX06/RA01/RA05覆盖 |
| I-6 完整性 | queue总countsComplete涵盖未接notice；双Goal卡归属由pair决定；look/find传空focus | 不能要求countsComplete=true、不能只比card.goalRef、不能因空focus丢全部卡；CX07/08/09覆盖。未规范关联Run/file的卡保留Goal级，写在L5而非暗猜 |
| I-5 来源/归属 | 来源按发送Session读，归档旧线责任可能已转走；DTO不含goalRef；acceptedInputs才证明送达 | 不能只列active、只找responsible links、把hasContinuation或replyHandler当已送达；NR02/04/15–18覆盖 |
| I-5 身份/分页 | 同消息正式只有一个response slot；投影身份仍须完整二元ref；过滤在候选分页后 | NR03用两次隔离的替身调用比较不同responseRef的键，不能在同一稳定窗口制造双response；空页不等于末页，NR06覆盖 |
| I-5 时间/已看 | sourceCursor是读取时间，message.since是问题创建；都不是reply首次成为未送达的时间 | L8能测试迟到路径但不能证明U1。U1未解决就是规格未冻结，不能声称“多视角核对没有缺口” |
| 合成/依赖 | 配置层不能import Runtime；生产组合独占装配；新read source没有commit | legacy resolver由C注入；D组串接；UI后缀不变，ROUTE_LABELS无被迫变更；architecture检查仍必跑 |

### B. 逐用例核对（每个 ID 都核过一次；不是测试运行报告）

下表“可造”表示与已读接口/状态路径相容，仍待夹具冒烟；“替身”只证明投影/错误传播，不能替代真实owner用例；“待U1”不能在未决时冻结为完整产品期望。

| id | 对照的数据流/状态 | 核对结论 |
| --- | --- | --- |
| DU01 | 固定pin→P→facts | 可造；不拿active pointer替换pin |
| DU02 | legacy精确模板→P | 替身循环五值，一行一次it，不冒充五次统计 |
| DU03 | absent矩阵≠读取失败 | 可造；executor仍不具决定权 |
| DU04 | 读到合法无duty正文 | 可造；与DU09缺记录不同 |
| DU05 | 双明确duty冲突 | 替身；不要构造违反生产Host配置校验的全平台正例 |
| DU06 | resolver失败先返回 | 替身，核后续0调用，不能回退 |
| DU07 | ready/inadmissible不是ready/resolved | 可造；精确拒绝点已写 |
| DU08 | Session缺/坏 | 替身；不是默认普通Session |
| DU09 | pin读失败 | 替身；不借当前激活角色成功 |
| DU10 | binding与Session身份冲突 | 替身；不能通过已占用Session篡改角色造真库 |
| DU11 | readonly_copy事实→原政策 | 只测facts/纯政策；真实Work领取会更早排除副本，不能要求进入M后才失败 |
| DU12 | 普通reviewer vs 独立review | 替身政策可造；没有Query发信正例 |
| DU13 | guards合并 | 替身；不同版本不应任选一份 |
| DU14 | scope/cancel先于IO | 替身，精确0依赖调用 |
| DU15 | 正式发信全链 | 可造；必须先有工具grant和entered Run，不能把缺权限当I-2的RED |
| DU16 | executor两个intent | 可造；失败看持久增量，不要求预分配id数为0 |
| DU17 | receipt先于事实读 | 可造；故障注入发生在成功提交之后 |
| DU18 | 角色active变化不改旧线 | 可造；断言拒绝或固定pin规则，表已选inadmissible分支，不期待热切换 |
| CX01 | 未注入新两格 | GREEN，旧WP1调用形式仍编译 |
| CX02 | owner settings→autonomy | 替身两值；不翻译成旧拼写every_action |
| CX03 | settings失败→整次失败 | 替身；区分not_ready与未接 |
| CX04 | G字段子集 | 纯函数；不改真库objective |
| CX05 | queue待答分区→rows | 替身含非目标分区用来防误消费 |
| CX06 | Task指称+focus | Task@0来自真实读模型先例；sources不能声称它存在 |
| CX07 | 空focus/无Plan | 合法，look/find和新Goal会走到 |
| CX08 | 冲突pair两端 | 合法；避免二次Goal过滤误删 |
| CX09 | 卡源缺席与notice缺席分开 | HEAD必需分支；全部capabilities可用不是可造基线 |
| CX10 | 先翻页后任务筛选 | 替身；空筛选页不等于空来源 |
| CX11 | 50×100边界 | 替身生成，外层100与queue内部source200不混算 |
| CX12 | 第二页失败/变窗 | 替身；不得返回第一半页 |
| CX13 | 同身份同内容/冲突 | 同内容可去重，冲突不任选；反转输入验证确定性 |
| CX14 | X原scope/anomaly拒绝 | GREEN；新增读取不能绕过前序失败 |
| CX15 | 默认读取+真实设置写 | 可造；默认读不能回写旧Goal，setter独立记增量 |
| CX16 | waiting→answered_pending_application | 可造；已答卡消失于提醒不等于从原队列删除 |
| NR01 | port缺席 | GREEN语义；不注入假available空来源 |
| NR02 | health与lifecycle两轴 | 替身；同退役包含active和archived |
| NR03 | 二元身份 | 同键跨页去重；不同responseRef用隔离的两次替身调用，每次元数据匹配，不构造同窗双response或正式二次答复 |
| NR04 | 原message→Goal | 可造旧缺省；不依赖已转走的Session链接 |
| NR05 | item与现消息读不一致 | 替身模拟竞争；稳定不一致不能当无消息 |
| NR06 | 双层分页 | 替身明确空页带next；防漏尾 |
| NR07 | 目录/消息候选窗口 | 替身边界；按扫描页而非产出notice数计限 |
| NR08 | 去重输出窗口 | 替身5001不同key；不是5001重复项 |
| NR09 | 重复身份的时间矛盾 | 替身两项先各自通过元数据核对，才触发去重冲突；sender/Goal损坏由NR05在更早处拒绝 |
| NR10 | 同时间、after、seek | 待U1；仅位置算法可测，不能据此裁定旧回复是否重提示 |
| NR11 | cursor范围/内部limit | 替身；确认200合法、201非法 |
| NR12 | 每个读取故障 | 替身；所有分支都有确切拒绝，无跳过损坏记录 |
| NR13 | 水位未到/scope/cancel | 替身；not_ready原戳不抹掉 |
| NR14 | 稳定窗口有限重试 | 替身；不在views写新水位或通知 |
| NR15 | 退役归档后迟到 | S1 SV33可造，双后端；原回复/接受记录不变 |
| NR16 | 有接续仍未消费 | S1 SV34可造；不是自动把回复送到接续线 |
| NR17 | 已转交→合法消费 | S1 SV32路径扩退役源；先核D可执行/有真实输入接受证明，不能直接写acceptedInputs |
| NR18 | 活线/无response | 可造的两个排除条件；来源装了仍available |
| NR19 | 显示页→已看 | 待U1；迟到分支不构成先回复后退役的答案，必须检查实际returnedKeys |
| NR20 | 已看后新的迟到回复/重开 | 待U1的位置方案；时间明确递增，不能声称已测时间回拨；SQLite才重开 |
| RA01 | X→A消费 | 旧A没有消费，应在提醒行缺失处RED |
| RA02 | reminders→原renderer | 可造；整行裁剪，不能给goal/task算可选预算 |
| RA03 | copy/planning段表 | GREEN边界；不能拿未来secretary模式造现有生产Query |
| RA04 | fresh prepare vs bound rehydrate | 两种给定分开；不要求同一已绑定Run同时变和不变 |
| RA05 | row.sources vs binding.sources | 可造；只检查提醒变化，准入来源保持原集合 |
| PI01 | 生产组合A/C接线 | 可造待冒烟；不能手工注入duties mapping或fake extensions冒充生产 |
| PI02 | 生产组合B→原route | 可造待U1冻结；用脚本provider创建必要历史，读取调用增量必须0 |
| PI03 | graph授权→内部Host | 可造；foreign请求必须在扩展IO前失败，不能直接调用内部provider冒充授权测试 |

结论：已找出并在草稿中处理两处静态漏接（decision消费端、消息Goal归属）、三处易错给定（伪Task记录、同消息双response、独立Query发信）和G的旧预告冲突；**U1仍未解决，全部夹具尚未运行，不能把本附录写成已独审或已验收。** lead 审核后再按决定46交DSH。
