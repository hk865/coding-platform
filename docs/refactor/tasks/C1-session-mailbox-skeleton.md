# C1：Session 定向邮箱骨架与独立测试（主审草稿）

状态：2026-09-26，**主 Agent 已审定架构/接口，批准第一阶段骨架与测试；尚未实现**。Stage 1 仅接口、职责注释、明确 unsupported 骨架与独立行为测试；DSH 必须停止等待中审，不能顺带实现。以下路径相对 `coding-platform/next`。本批不调用模型，不修改旧工程。

## 1. 依据、复用与交付边界

先读 [PRODUCT](../../PRODUCT.md)、[原话 DLG-037](../intent/ORIGINAL-DIALOGUE.md#dlg-037-用户)、[实施方案 §0](../IMPLEMENTATION-PLAN.md)、[WorkGraph §7.1](../modules/core/work-graph.md#71-当前-c-路径定向-session-咨询)、[Workflow](../modules/business/workflow.md)、[能力索引](../IMPLEMENTED-CAPABILITIES.md)、[DSH 分工](../DSH-WORKFLOW.md)。§7 后续旧 WorkParticipation/AgentInstance 协议仅供追溯，不作为本批前置。

目标：Host 或真实工作 Run 向同工作区的已有 Session 持久发信；收件 Session 的真实工作 Run 查询、读取、确认和回复；Host 和原发送 Session 可精确查看回复。Session 是地址，不新增永久 Agent、邮箱中间件、业务管理器或第二历史库。

**普通消息不是任务义务。** busy Session 仍可收件；archived Session 仍保留收件与历史，不自动唤醒、不抢占、不改 lifecycle/occupancy。pending inbox 不阻止归档。本批不建立 wait、不唤醒 Kernel、不自动推进，不关闭完整 R3f/R3c/R5。正式 wait 后续另有记录与受理协议。

| 需求 | 必须复用的真实源码 | 本批增量 |
| --- | --- | --- |
| 地址/按图发现 | `src/core/work-graph/sessions/contracts.ts` 的 `findSessions/readSession`；`session-record-codecs.ts` | 精确 SessionRef，不复制发现目录 |
| Run→Session 事实 | `tasks/execution-read-contracts.ts`、`run-state-service.ts` 的 WG11；claim outbox 的原 claim | 验证正式 Run/Role/Session 及执行代次，不由 JSON 自报身份 |
| 原子记录/幂等 | `core/record-store/ports.ts` 的 `readMany/lookupCommit/eventAt/commit` | 消息 codec、事件及局部 CAS |
| 局部邮箱查询 | `core/record-store/lookup-ports.ts` 的注册 lookup | recipient 与 recipient/status 两个索引 |
| 正文 | `materials/contracts.ts`、`material-service.ts`、`applicability.ts`；原 `RawArtifactStorePort` | 专用消息 JSON envelope，复用 MaterialPort，不改通用材料授权 |
| Kernel 工具接点 | `core/agent-runtime/observed-model-run.ts` 的 `coordinationTools` | 独立工具 factory；本批测试直接执行工具，不启动模型 |

## 2. 公开 DTO 与窄方法

复用已有 `GraphWrite`、`CoreCallContext`、`VersionPin`、`SessionRef`、`RunRef`、`RoleBindingRefV1`、`ArtifactRef`、`SourceRefV1`、`ReadResult/WriteResult`、`CommitCursor`。以下为冻结方向。SessionMessageRef 单独放 src/contracts/core/session-message.ts；在 ledger.ts 的 AggregateRef 封闭 union 增加该引用。其余 DTO 留在 communication/contracts.ts；禁止 shared contracts 反向 import WorkGraph。C1 独占 ledger.ts 的这项改动，B2 不写该文件。

```ts
type SessionMessageRef = {
  aggregateType: 'SessionMessage'; projectId: string;
  workspaceId: string; messageId: string;
};
type MessageSender =
  | { kind: 'host'; actor: { kind: 'human' | 'system'; id: string } }
  | { kind: 'work_run'; sessionRef: SessionRef; runRef: RunRef;
      roleBinding: RoleBindingRefV1; generation: number };
type MessageResponse = {
  sender: Extract<MessageSender, {kind: 'work_run'}>;
  bodyRef: ArtifactRef; sourceRef: SourceRefV1; respondedAt: string;
};
type SessionMessage = {
  ref: SessionMessageRef; schemaVersion: 1; revision: number;
  sender: MessageSender; recipient: SessionRef;
  bodyRef: ArtifactRef; sourceRef: SourceRefV1; createdAt: string;
  status: 'pending' | 'read' | 'responded';
  readAt: string | null; response: MessageResponse | null;
};
type MessageBody = {
  messageRef: SessionMessageRef; part: 'message' | 'response';
  text: string; sourceRef: SourceRefV1;
  // A received statement; this is not a current-source/evidence grant.
  usage: 'message';
};
interface SessionMailboxPort {
  sendMessage(ctx: CoreCallContext, request: GraphWrite<{
    recipient: SessionRef; text: string;
  }>): Promise<WriteResult<SessionMessage>>;
  readMessage(ctx: CoreCallContext, ref: SessionMessageRef):
    Promise<ReadResult<SessionMessage>>;
  readMessageBody(ctx: CoreCallContext, input: {
    messageRef: SessionMessageRef; part: 'message' | 'response';
  }): Promise<ReadResult<MessageBody>>;
  readInbox(ctx: CoreCallContext, input: {
    recipient: SessionRef; status?: SessionMessage['status'];
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<{
    items: SessionMessage[]; nextCursor: string | null;
    sourceCursor: CommitCursor;
  }>>;
  ackMessage(ctx: CoreCallContext, request: GraphWrite<{
    messageRef: SessionMessageRef;
  }>): Promise<WriteResult<SessionMessage>>;
  respondMessage(ctx: CoreCallContext, request: GraphWrite<{
    messageRef: SessionMessageRef; text: string;
  }>): Promise<WriteResult<SessionMessage>>;
}
```

本批只发送有界文本，不接受任意 ArtifactRef、附件、模型提供的来源、强义务或自动继承历史。上下文以后增加完整精确引用，不能将裸 ID 当授权。`text` 非空、UTF-8 最多 16 KiB；不截断后悄悄接受，超过返回 `capacity`。

回复保存在原消息的 response 槽中，不自动产生第二条 inbox 消息，不在 Host 没有 Session 地址时伪造收件 Session。原发送者可精确 `readMessage/readMessageBody(response)`；本批没有 outbound 列表与回复通知。需要继续往返时发送新消息，避免另造线程/订阅协议。

## 3. 身份、权限与 B2 共享契约

ctx 必须是可信 Host/tool adapter 绑定，先同步快照所有可变输入；signal 保留原对象。projectId/workspaceId 均必填。拒绝缺失、跨作用域、不一致 materialReader；query_run 本批返回 unsupported。

- **Host**：actor 必须是真实 human/system 非空身份，ctx 与 materialReader 的项目/工作区/actor 完全一致。Host 可发送及读取同工作区正式消息，不能假称收件 Session 已读或已答复；Host 的 ack/respond 返回 forbidden。真实人类答复通过新 Host 消息表达。
- **work_run 正式绑定**：沿已有 WG11/claim 精确事实核对完整 RunRef、Run.workspaceSnapshot、Run.roleBinding 与 ctx；claim.sessionRef/Run/代次一致，并验证正式 Session 同工作区。不得使用 `agentPrincipal.workId` 代替 Session。
- **新工具调用**：Run 必须为真实 running、未终止，Session active，occupancy 为该 Run 的 execution 且 generation 等于正式 claim。Run.envelope 非空，envelope 的 Run/Role/工作区一致，`permissions.tools` 包含该操作工具名；使用现有 Role resolver 对绑定/当前权限上界再核验。starting/unknown、释放后的旧 Run、maintenance/别的 Run、缺 envelope 不获新写许可。不能因为拿到了 WG11 历史记录就推导许可。
- **收件及回执**：work_run 的 inbox/ack/respond 只针对其正式 Session；readMessage/body 还可读由其正式 Session 发出的旧消息。Session 中新 Run 可以处理该 Session 的历史收件；原消息 sender 仍保留原 Run，不改写历史。
- **目标 Session**：send 精确核对存在与同项目/工作区；busy/archived/health 不禁止普通持久收件，不以收件推导执行可用。自发自收合法。本批不改 Session 记录、不建立 task 依赖。

Mailbox 服务复用 WG11 reader/role resolver；正式写提交还须把观察到的 sender Run、sender Session 及 Role 解析 guards 纳入原 Store 事务，不能只在事务外调用一次 boolean 授权。如何取得现有 Role facts guards 使用 `RoleBindingFactsPort`，不复制角色判据。B2 统一冻结 Running/envelope 事实写入者及工具名，C1 骨架不能偷偷降低到 starting 也可执行。测试可以构造严格有效的正式执行事实，不需启动模型。

## 4. 正文存储与精确消息读取

采用主 Agent 已批准的方向：**复用 MaterialPort；不把文本直接内联消息记录、不新增 MessageBodyPort、不修改 MaterialPort 或 grant 规则。**

原因：`applicability.ts` 对 platform_operation 正文的普通 Run reader 没有可用 owner grant；将收件人伪装 Host 或给其通用 Artifact 读取能力都不正确。body store 对相同文本/contentType 复用首个 provenance，也不能直接把相同短文本跨工作区存为同一正文后推断作者。

服务依赖直接包含既有 `MaterialPort` 和组合根固定的 system actor（例如 Host 配置的通信服务 actor；不由模型输入）。内部构造同工作区 system Host ctx，**只作为平台正文存取执行者**，不替换 mailbox 命令的真实 actor；正式消息 sender 仍由第 3 节绑定。

1. 完成业务身份/参数验证与首次幂等检查后，生成稳定 messageId；reply 使用原 messageId。读取真实 Workspace ref/revision，生成合法 `kind:'workspace'` 的 SourceRefV1。该引用仅标识消息平台操作的工作区来源依据，不声称文本来自源码或已经核实。
2. MaterialPort.storeArtifact 保存固定 contentType（建议 `application/vnd.coding-platform.session-message+json`）的 canonical JSON：`{schemaVersion:1, projectId, workspaceId, messageId, part, sender, text}`。scope/messageId/part 防止独立消息错误共享第一作者。正文中的 sender 必须等于正式记录中的对应 sender。来源列表使用上一步真实 sourceRef；platform_operation origin 的 scope/requestId/system actor 来自可信服务。
3. store 成功后验证 ref/contentType/size/source 与预期并实际读取核验 envelope；不因 stored 就称消息已投递。再以单一 PreparedCommit 写消息、事件/幂等回执。失败可留下不可达 body，但绝不能先发布无正文消息。重放优先返回旧回执，不再次 store。
4. readMessageBody 先按第 3 节确认调用者可读该正式消息，随后只选择记录内精确 `bodyRef` 或 response.bodyRef。仅此后用内部 system Host、`historical_explanation` 调 MaterialPort.openArtifact；绝不接受调用者 ArtifactRef，不替换调用者材料身份以读取任意内容。
5. 检验返回完整 ref/source 及 envelope 的项目、工作区、messageId、part、sender、schema、UTF-8 边界，返回 `MessageBody`。引用损坏、正文缺失/来源不符返回 unavailable；不伪造空文本或 current applicability。阅读不自动 ack。

正文中的 sourceRef 与 ArtifactRef.source 必须以实际存储回执为准并逐项验证；源 Workspace 改版不导致历史消息文本不可读。正文是声明，不传递所提及其他 Artifact 的权限。若实现发现 Workspace sourceRef 编码不能复用现有合法转换，应报告准确接缝，不能扩 SourceRefV1 枚举或伪造来源。

## 5. GraphWrite expected、状态与幂等

- send 的 `meta.expected` 必须为 `[]`，拒绝额外/重复/跨域 pin。messageId 是服务根据 scope、真实发送身份、requestId 派生的稳定 ID，不能由模型自选。消息 CAS@0；目标 Session 读取只核地址/工作区，不把其忙闲 revision 变成用户 pin 或启动门槛。
- ack/respond 的 expected 恰好一个目标 SessionMessage pin，revision 为正整数。缺少、重复、不相关、跨域、非整数 pin 返回 invalid。内部 sender Run/Session/role guards 由服务从可信事实收集，不向模型索要。
- 初始 pending/readAt=null/response=null。ack 只允许 pending→read；respond 可 pending/read→responded，填 response，并在 readAt 为空时填本次实际响应时间。read/responded 不退回 pending；第二个不同响应 forbidden/invalid（统一采用 invalid）。不同请求重复 ack 已读返回 invalid；相同请求命中原幂等回执必须成功重放。
- 幂等 identityKey 包含操作、项目、工作区、可信完整发送 Run 或 Host actor、requestId；fingerprint 包含业务载荷及原 expected，排除临时 signal、时间和工具包装数据。相同 identity/不同 payload 或 expected 返回 idempotency_conflict。不同 Run 的同 requestId 不能串用。
- 重放先验证 caller 的真实稳定身份/原 Run-Session 关联及作用域，再查原提交；精确重放返回原事件保存的 receipt/value/cursor，不从当前 message 重建，不要求原 Run 仍 running，不产生新动作。新请求才要求当前执行许可。不能仅因请求携带旧 RunRef 就允许读取回执。
- 新写在提交前检查取消并纳入 sender 执行事实与消息 revision guards；提交成功后不得因晚到取消返回“未提交”。失败/回执竞争恢复只使用同 identity 原回执核对，不能重跑业务到当前状态再宣布成功。

## 6. schema、lookup 和分页

注册 `SessionMessage@1` codec，外层 refKey 为完整 SessionMessageRef canonical key，revision 与 body 一致。消息/回复正文只存 ArtifactRef。注册 `SessionMessageSent@1`、`SessionMessageRead@1`、`SessionMessageResponded@1` 事件；事件保存本次返回的完整消息元数据及真实 actor/identity，支持 eventAt 恢复原回执，不嵌入正文。

注册 `RecordLookupIndex`：

```ts
{ name: 'session-message-by-recipient', aggregateType: 'SessionMessage',
  paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId'] }
{ name: 'session-message-by-recipient-status', aggregateType: 'SessionMessage',
  paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId', 'status'] }
```

使用原 schema/lookup 自动维护；不使用仍为空元组的 indexGuards/indexChanges，不另建手写 SQL 表。注册位置由主 Agent 在 create-platform 聚合，DSH 独立 lane 不改共享组合根。

分页为**明确的实时 keyset**，按完整 canonical refKey 排序，不宣称时间线顺序或跨页快照。limit 为 1–100 整数。cursor 版本化并绑定 project/workspace、recipient、status filter、可信 caller key 与 after full key；改变任一项拒绝 invalid。每页使用一个注册 lookup，复核返回记录的 codec/作用域/收件人/筛选，不全事件扫描，不为了凑满页反复扫描。

返回 lookup 的真实 readThrough；atLeastCursor 未达到返回原 not_ready，不标较新水位。cursor 不要求与全账本最新水位相等，无关提交不导致 revision_conflict。后续页中刚插入排序靠前的消息或状态迁移可能不出现，需从第一页刷新；不声称无遗漏快照。不重复已经越过的键。空结果正常，损坏候选返回 unavailable，不静默跳过。读取不提交任何事件或更改 status。

## 7. 工具适配与准确拟议写范围

`communication-tools.ts` 导出 `createSessionMailboxTools({ mailbox, context, sessionRef, requestIdForCall })` 以及固定 names，输出与既有 `coordinationTools` 相同的 `{names,create}` 形状。context 为可信、已绑定的 ctx；sessionRef 为可信 Host 绑定的当前 Session，供 inbox 定址，服务仍沿 WG11 核其身份；requestIdForCall 使用可信 Kernel 派发的 ToolCall.callId 加绑定 Run/操作形成命令身份，不使用随机 ID 或仅对 args 做 hash。现有 `ToolDefinition.handler.execute(call, options)` 已提供该字段；args 中没有 requestId。复用已冻结 public-api，不改 Kernel 类型。

工具名拟定：`send_session_message`、`read_session_inbox`、`read_session_message`、`read_session_message_body`、`ack_session_message`、`respond_session_message`。读取为 read_only，其余按真实平台副作用声明；Kernel hostAuthorizedTools 来自可信 factory 的 names，并与 B2 envelope/Role 实际许可取交集。

所有 JSON schema strict。send 只接受 recipient/text；inbox 的 recipient 由当前可信 Session 绑定，模型只给 filter/page；read/body 只给 messageRef/part；ack/respond 给 messageRef/expectedRevision 及 reply text，由 adapter 构造唯一 message pin。禁止 sender、runRef、roleBinding、principal、materialReader、Host actor、scope grant、generation、requestId、bodyRef/source 等权限/来源字段。额外字段拒绝，不能忽略后偷偷使用宽权限。闭包冻结 context；首次 await 前快照 args，不把工具文本当系统指令。

**冻结生产文件：**

- `src/contracts/core/session-message.ts`（仅共享引用）
- `src/contracts/ledger.ts`（仅 AggregateRef union 扩展）

- `src/core/work-graph/communication/contracts.ts`
- `src/core/work-graph/communication/mailbox-service.ts`
- `src/core/work-graph/communication/message-record-codecs.ts`
- `src/core/agent-runtime/communication-tools.ts`

**拟议独立测试：** `tests/work-graph/C1-session-mailbox.test.ts`、`tests/runtime/C1-communication-tools.test.ts`。如四文件不可读性明显上升，报告所需拆分，由主审批准，不随意扩大 scope。

**主 Agent 集成保留：** create-platform.ts 的 schema/service/公开入口/关闭排空、必要平台类型导出、组合根 SQLite/重启验证及 B2 工具装配。不改 MaterialPort、Store、Session lifecycle、claim、W1 plan、Workflow 自动推进或 vendor。正式能力索引仅在实现和隔离验收后更新。

## 8. 独立验收判据（两组 12 项）

领域组复用现有 Memory/SQLite、Session/claim/Role fixtures，不重做全部 A1/W1/B1。以下每项允许参数化反例，不能把实现内部函数调用次数当唯一正确性证据。

1. Host→busy/archived 收件，正式消息与同一 scoped 正文可重启读取；Session revision/occupancy/lifecycle 不变，pending 不阻止显式归档。
2. 合法 running Run 发信；伪造/跨 workspace/错误 Role/旧 generation/缺 envelope/工具未授权/已结束 Run 的新写逐项拒绝且零消息写。query_run unsupported。
3. 精确重放原 send/ack/respond 回执；终态后原身份重试仍回原 receipt；相同 key 改载荷或 pin 冲突；新 request 不复用旧许可。
4. pending→read/responded 单调；reply 单槽 CAS 并发恰有一个接受，不同内容不得覆盖；只读不隐式 ack；发送方后续 Run 可查 response。
5. scope+messageId+part envelope：相同文本跨项目、跨消息、reply 不串正文；16 KiB UTF-8 边界、正文缺失/损坏/ref/source/作者不符均明确失败；未提交消息不能通过正文 API 读取。
6. 收件人限定的正文读取；其他 Session、猜 messageId、任意 ArtifactRef/part 替换、伪 Host 字段拒绝。测试使用真实 MaterialPort，证明其普通 run open 仍 forbidden，而合法消息 readBody 可读且不授其他材料权限。
7. 注册 lookup 的 keyset/filter/caller 绑定；页上限、空页、水位 not_ready、无关提交、插入/状态移动的实时语义、损坏记录失败；无全事件扫描、无每页遍历全部 Session。
8. sender release/角色撤销与提交竞争、消息 CAS、预提交取消、成功后晚取消、正文 stored 后 commit 失败及原回执恢复；不把可能孤立正文称正式投递。

工具组不启动模型：

9. 六工具 strict schema 和可信闭包；禁止字段、跨 scope、变更参数对象不能改变已受理调用；names 与实际 definitions 一致。
10. 可信 tool-call ID 重试产生同 requestId，不同 call ID 不合并；ack/respond 仅生成唯一消息 pin，不能由模型塞额外 expected。
11. 工具直接调用真实 Mailbox/Material/Store：send→inbox→body→ack→response→发送者读取；保留真实 typed rejection，只有正式 committed 才报告写成功。
12. effectClass 与授权清单匹配；没有注入绑定、不可用权限或关闭/取消不回落 Host/空成功；factory 本身不开模型、不改 Session、不做自动 reply/wait。

Stage 1 交付报告须列“需求→复用符号→新接缝→测试”。主审特别检查稳定身份重放与新许可的区别、正文内部 Host 身份边界、真实 keyset 语义及 race 测试是否能在错误实现上失败。骨架通过类型检查不代表上述行为已实现。

## 9. 实际施工命令与停止条件

W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。只写同名 scope JSON 列出的文件，已由主 Agent 预建。文件级 bind 不支持 rename 替换，使用 Python/Node 原地写入；允许宽读当前 docs/next/旧行为源码，禁止 reset/提交/安装依赖/改全局 DSH 配置/读凭据。复用 tests/helpers/task-claim-fixture.ts 与真实 MaterialPort。

类型：`python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py next-types`；专项：`python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py next-session-mailbox`。新测试应因明确 unsupported 为红，而非坏导入/语法/无效夹具；旧服务不受骨架影响。报告后停止，主审将复现红测、审核测试和 schema，再冻结测试只读后派发实现。

## 2026-09-26 中审补充冻结

正式新 work_run 工具调用还须 Run.executionAuthorization 为 B2 V2 phase=entered、sessionGeneration=claim.generation、固定非空kernel绑定与Session映射相同。V1、authorized/entering/unknown即使被写成status running也不得推断进入。原幂等回执恢复仍先于此新动作权限核查。测试中的V2 entered仅领域规则种子，真实生产链另由B2组合根验收。
工具mapper阶段一已被主审恢复明确unsupported；第二阶段才实现。测试共享一个真实claim账本，新增schema在原fixture中注入；不得再复制若干记录到第二账本后声称同一事务。
