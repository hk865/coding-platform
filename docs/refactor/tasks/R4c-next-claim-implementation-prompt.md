# R4c.1 第二阶段：审核后的原子领取实现

W=/home/hyh001/projects/coding-platform，T=W/coding-platform/next。
Astra已经审阅DSH第一阶段骨架及测试，并补充独立反例。现在实现真实行为。仍先读现有产品/架构/模块/原话的相关章节，路径及冻结设计在 docs/refactor/tasks/R4c-next-claim-skeleton-prompt.md（包括末尾Astra补充）、modules/core/work-graph.md §4.2、DSH-WORKFLOW.md。本轮不是完整R4c，也不授权你自行实现Runtime entry/release/Query。

## 唯一可写4文件
- T/src/core/work-graph/tasks/claim-service.ts
- T/src/core/work-graph/tasks/claim-record-codecs.ts
- T/src/core/work-graph/tasks/plan-readers.ts
- T/src/core/work-graph/configuration/role-memory-service.ts

代码骨架、types、测试已在当前快照。公共接口、tests/helpers/tests、composition、RecordStore、Workspace、Kernel、配置/依赖全部只读。确需调整接口先报告具体缺口，不修改测试/断言/增加隐藏Store入口。不stage/commit/push/reset/restore/clean/stash，不装依赖，不读取凭据/其他会话。可对授权文件原地写，DSH write/edit工具的临时目录受沙箱限制时用已有文件原地写入，不扩大scope。

## 主审冻结的实施决定

- `createTaskClaimService`两个真实入口；composition已经接入platform.claims，并在close等待inflight。不得新增ControlEngine/Legacy/Repository层。
- `readCanonicalTaskFacts(records,goal,plan,taskId?)`可选参数已有显式unsupported骨架，改为定向读取；不传时保持原query/adoption行为。精确索引名称 `r4c-run-by-task`，由**PLAN_STATE_RECORD_SCHEMAS**注册，路径为Run的project/goal/task。复用同一fold，不复制第二套状态规则。本Task已存在任何Run（包括旧Plan）拒绝首次claim：既有read.guards在Plan过滤前包含所读Run，可从这些事实或同次读取的显式标志判断，不能另扫一遍。返回所有实际读的guards，narrow只含本Task；未注册索引/缺读完整性不当空事实。
- RoleConfigurationService已增加 `resolveRoleBindingFacts` 的编译骨架，返回类型是公开Port与内部FactsPort交集。实现时把现有resolveRoleBinding内部相同解析过程复用为一个流程；公开resolve只取result。Facts返回**本次稳定读窗口**精确RecordGuard[]，包括确证missing的policyActive、roleActive，存在的policy revision/spec。重试清掉旧读集；不新增扫描，不重复角色规则，不引入global horizon提交。
- `revisionAssignments`现已从旧工程迁至T/src/contracts/plan.ts，直接复用。要求本Task恰好一条assignment且role==binding.templateId。legacy Session只在确证无matrix时匹配同模板ID/revision；role_spec必须resolved且ref+digest等于Session pin，digest复用roleSpecContentDigest(spec,roleId,revision)。领取只核对角色身份，不授予任何工具权限。
- 语义顺序：同步隔离ctx/request（保留原signal）→形状/scope/expected合法性→lookup原回执→若命中验证原event并返回，**不读现态、不取now/newId、不检查过期**→若miss再读当前Goal/acceptedPlan/Workspace/Session、本Task canonical state与当前role facts→资格/预算→编译一批→cancel复查→commit。
- expected恰好Goal/Workspace/Session三项，记录完整且当前值匹配；Plan/角色/任务读集内部guard。所有guard冲突零写入。无全局ledgerHorizon、无重复Task/Session unique claim表、不写Goal/Workspace/Plan。时间deadline null或非空且Date.parse有限；新请求要求deadline>now且now合法。元数据pin shape是安全整数，Session revision+1必须是安全整数。
- 一事务五记录：TaskLease@1、TaskAttempt@1 claimed、Run@1 starting、DispatchOutboxEntry@1 pending、Session revision+1 occupancy。Run无executionAuthorization，envelope/start/end/outcome等null、eventseq0；generation=Session新revision。Reuse Run/Lease/Session codecs和注册，Attempt/outbox/TaskClaimed才是新codec。新ID和eventId用newId()，不与requestId绑定，absence guards阻止碰撞。
- 新codec使用一个纯TaskClaim交叉引用检查：task作scope基准；各project相同；run/attempt/outbox goal相同；attempt/outbox task与attemptId一致；Plan/Session只核其真实project字段；outer outbox.ref==claim.outboxRef；generation==sessionRevision正安全整数。codec不反查Store。event outer ID/type/version/time与JSON一致，actor只human/system，identity/fingerprint非空。原事件重放要核对receipt eventId/cursor、actor/identity/fingerprint、claim Task/Plan/Session等请求refs；不要读取当前outbox重建旧回执。不可解码/交叉引用损坏映射unavailable，不当not_found。
- 错误码：现有本Task Run或占用Session/Lease→busy；角色不匹配→forbidden；期限/预算非法→invalid或capacity；版本变化→revision_conflict；缺事实/缺provider→incomplete/unavailable/unsupported如实，不能全部unsupported。取消→cancelled。主审边界测试有准确约束。
- Task图的关系不阻止并行、不读前驱facts、不扫描未来materials，不调Kernel/workspace。真正prepare/entry/消费验证留后续，不能把领取写成执行许可。新平台后续合法Run创建/处置必须和canonical TaskLease同事务，不绕开本Task absence CAS。

## 已审核测试与必须使用的检查

`python3 tools/dsh-refactor/check.py next-types`
`python3 tools/dsh-refactor/check.py next-task-claim`
`python3 tools/dsh-refactor/check.py next-architecture`
必要时next-plan、next-session-directory、next-roles已有检查可以调用。不要复制测试内容到另一个套件再只跑你自己的。主审将在最终物理隔离副本跑全量。

中间审核修正了两种测试错误：commit调用次数不等于成功次数；无关提交必须发生在读后、提交前。本次SQLite竞争用真实双连接+barrier，要求两个提交尝试、一成功一revision_conflict，且loser新记录全部不存在。不同Task/Session的两个提交都应成功。不要用进程内mutex或提前串行化逃避。

新增独立反例在T/tests/work-graph/R4c-task-claim-boundaries.test.ts：role_spec真安装/激活、坏digest、no-matrix→新matrix在commit前安装、deadline过后仍原结果replay、旧Plan Run、await内取消、嵌套refs与外层event损坏、foreign actor replay。已有composition测试复用真实创建的Kernel Session，确认claim不启动Kernel、close等待claim、重开能读原结果/occupancy。

交付实现与真实检查结果，准确列出未实现能力；通过后停止，由Astra独立审阅。测试先前RED是实现缺失，不是允许放宽验收。
