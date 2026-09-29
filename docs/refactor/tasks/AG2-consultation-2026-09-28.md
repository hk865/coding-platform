# AG2a：显式咨询 → 原收件 Session → 正式 Answer → 原消息回复

2026-09-28。用户要求把分享中的异步感知/控制、冷启动与当前缺口形成到 MVP 的路线，并完成下一步。本批接 AG1 之后的真实咨询消费者，路线在 [Agent 行为计划 §6–8](../AGENT-BEHAVIOR-PLAN.md#6-对齐注意力与异步感知)。仍按 Astra 冻结接口 → DSH 测试 STOP → 主审 → DSH 实现 → 独审。禁止恢复无边界平台扩建、语义校验或全量测试循环。

## 选择：复用正式 Answer，不开放 Query 写工具

Query 仍只读。模型在收件方已有 Session 内阅读原消息与必要源码并产生正式 QueryJobAnswer；外层将这个真实答案挂到原消息的 response 槽。回复 sender 从已结束 QueryRun/Answer 派生为 query_run，不能由调用者填写文本或冒充 Host/Work Run。不新增 AgentFactory、调度库、独立咨询状态库、模型循环或每工具全链校验。

首批是显式处理一条消息，不是收信自动执行。无模型的普通读取保持原行为；busy/archived/unavailable 收件人不抢占、不新建替代 Session、不解除归档。回复不完成 Task，不代替控制生效，也不自动继续已结束 Work。

## 冻结接口

1. `QueryJobIntentV1.execution.consultation?: { messageRef: SessionMessageRef; recipient: SessionRef }`，仅 `semantic_query` 合法。保留现有执行 kind/协议。绑定存原 QueryJob，不造另一数据库。
2. 在现有 query contract 暴露 `consultationQueryRefs(messageRef)`：从完整 messageRef 的 canonical SHA-256 确定唯一 QueryJob 与 QueryRun ID（`consultation-<hash>`、`consultation-run-<hash>`）。有 consultation 的 submit 必须使用这对身份，因此不同外层重试也不能为同一消息新建第二轮。不要再加泛用去重层。
3. Query submit 通过注入的原 mailbox 只读端口核对原消息/正文、收件人、scope；question 必须为实际 message body.text。Goal 为 Host 显式指定的真实同工作区 Goal，由原 submit 验证，不从问题文本猜测，也不新增“跨 Goal 不能咨询”限制。原消息已回复时不新建 Query；原请求 replay 保留。claim 在原首次占用点核 recipient 等于绑定 Session。历史普通 Query 不受影响。
4. `SessionMailboxPort.respondFromQueryAnswer?(ctx, GraphWrite<{messageRef,answerRef}>)`。Host-only 结果关联操作，不是 Host 代答。只从正式 Answer/Job/settled answered Run 读取正文与身份；核完整 ref/scope、consultation、原 recipient/实际 claimed Session。派生 `MessageQueryAnswerSender = {kind:'query_run',sessionRef,queryRunRef,answerRef,generation}`；MessageResponse.sender 接受该形状，原消息 sender 仍限 host/work_run。消息正文封装、单 response 槽、CAS 与原回执恢复复用。不要因之后 Session 再次忙碌/归档而否认已经发生的 Answer。Query 仍不能 send/ack/respond 任意文本。
5. 新增 `WorkflowPort.consumeConsultation?`；实现可放同目录小文件，由原 `createWorkflow` 暴露，组合根沿原 trackedCall 排空。

```ts
type ConsultationInput = {
  schemaVersion: 1;
  messageRef: SessionMessageRef;
  goalRef: GoalRef;
  roleBinding: RoleBindingRefV1;
  runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget'];
  consumerId: string;
};
// 复用真实返回类型，不复制状态库；not_found/rejected只用于尚无已受理动作的前置失败。
type ConsultationResult = ReadResult<{
  state: 'waiting' | 'responded';
  message: SessionMessage;
  query: QueryJobRecord | null;
  answer: QueryJobAnswerSnapshot | null;
  reason: string | null;
}>;
```

薄消费者：读原消息/已有确定性 Query → busy 等待或复用原 recipient → 原 submit/claim/prepare/start/observe → 正式 Answer → respondFromQueryAnswer → 返回原消息/Query/Answer。Scope/角色/工具以现有 owner 裁决。原 Query 已存在时不重建；配置不同不得偷偷换一次执行。已有 Answer 挂回失败仅补挂回复，不能重新调用模型。entering/entered/unknown 仅观察原执行，不把未知当未启动；claimed/prepared 沿既有准备/开始规则续办。有限调用，无 while/后台 timer/调度循环。开始受理后若后续失败，保留已得到的 Query/Answer/消息及具体原因，不返回空回执暗示可安全新建。

顺序特别说明：先读既有 Query/Answer 并恢复挂回，再判断当前 Session 是否 busy/archived；历史 Answer 不因其后占用变化而失效。回复来源保留实际 Answer/source 引用，不拿后来 Workspace 当前版本冒充回答时的证据。引用是可追溯性，不是语义正确性认证。

6. HTTP 增加一个 plain `workflow/consultation` 路由，精确绑定该方法；不新增任意方法分发，不新增配置工厂。输入中的预算/RoleBinding 仍经原 Host/Role 上限检查，不授予新能力。
7. 同一通用工作台消息详情加“处理咨询”入口，复用当前 Goal 和已选 Query profile，只提交 messageRef + 该 profile 的既有安全字段；没有合适配置/Goal 则说明缺项。结果后刷新原 scope/Session/message 的收件箱/消息与正文，沿既有请求 tags，切换成员时不串写。显示等待或已回复，绝不写“已停止/Task完成”。入口显式调用一次，没有自动 poll 或心跳；不改整体布局。

## 依赖与复用约束

- mailbox 使用现有 records / Query codecs 读取已发生 Answer，复用 MaterialPort 存消息正文。无需 Runtime 工具例外或 query_run principal 授权扩张。
- QueryJob 可增加可选 `consultations` 只读 mailbox 依赖；组合根在构造它前构造 mailbox，或用窄只读转发闭包，不能新增服务实例。QueryExecution claim 读取 intent 绑定，不每次模型请求重读消息。
- Workflow 可增加可选 `consultations: {messages,queries,projects}` 依赖组，复用已有 sessions/plans/runtime；缺配置返回 unsupported，旧 Workflow fixture 不被迫扩展。
- Reply sender 的 codec、body envelope 与事件允许真实 QueryAnswer 来源；保留旧记录可读。不把 query sender 放开到一般发信/ack。
- 本批不引入节点变更计数/心跳订阅持久状态；相关策略和未来缺口已在路线中说明，不冒充实现。

## Stage1（测试后 STOP）

只允许新 `tests/app/AG2-consultation.test.ts` 与 `tests/app/R6-host.test.ts` 必要的路由夹具适配。不改生产。最多三条有意义场景，复用 R5b/C2 的公开 bootstrap、真实 SQLite/Kernel 和受控 provider，不直接改内部记录：

1. 实际 Host HTTP `workflow/consultation`：原 idle 收件 Session，模型看到原问题并真实调用既有读源码工具后回答；原 response 正文逐字等于正式 Answer，query_run/answerRef 指回同一 Session/Query。原消息入箱时不发模型请求。重复相同处理及关闭重开后读取/处理不新增模型或 Session；普通读取不 ack/调用模型，不造 Task。
2. 合法占用竞争/归档：消息仍可入箱；显式处理返回等待或明确拒绝，模型调用为零，不创建新 Session。另以正式 submit/claim 尝试把 consultation 绑定到非收件 Session，必须拒绝；不编造数据库损坏状态。
3. Query Answer 已成功保存但回复关联尚未提交的可达窗口：通过公开 submit/claim/prepare/start 得到正式 Answer，然后调用消费者应只补挂回复；原请求 replay 返回原结果；其它消息不能绑定这份 Answer。禁止用自填 answer 文本/伪造终态通过。

Stage1 用现有 import 和动态未来入口类型/真实 HTTP 未支持作为行为 RED，不能用缺包/错误夹具当红测。若测试公共 helper 需要新文件，先报告主审，别写出 scope。字段/场景以本任务书冻结，不扩异常矩阵。Stage1 回报真正到达的 RED 与后续未达断言后 STOP。

## Stage2（冻结测试）

主审冻结测试后只实现 scope，测试只读；使用 Node24、两个现有 npm 锁文件。跑 AG2/相关 Query/邮箱/Host 必要集合与类型/边界/构建，主审查看真实 diff。随后少量真实模型验证此生产链；非语义错误修到可用，模型文字保留来源与具体限制，不无限提示词调参。实际浏览器操作消息入口核等待/回复可见。

不提交/推送，不修改三个候选真实工作区。完成更新现有 HANDOFF/能力索引/路线和本批证据，保留先前未提交改动。没有完整咨询等待推进、自动派发、控制恢复或整体 MVP 交付声明。

## 本批落点

2026-09-28 已两阶段实现、集中返修/独审并导入。独立12文件115项、类型/边界/构建，以及限定真实模型和浏览器接收/回复链通过；首条模型两次参数错误后恢复，第二条浏览器场景无工具错误。[完整证据与局限](../reviews/evidence/agent-behavior-2026-09-28/ag2/README.md)。发送方自动续接等余项保持，不再在本批扩局部测试循环；未提交/推送。
