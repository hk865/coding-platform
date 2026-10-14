# 第 5 片第二轮返工：补测的用例表（lead 冻结的期望）

**后注（决定 49 第 28 项）：** 约 19 行「任一来源的窗口超过 25 页 / 5000 项回 `capacity`」的超界期望已由 2A 规格翻转。正文原样保留，只加此注。

> **状态：** lead 写，2026-10-09（HANDOFF 决定 48：第 5 片再给一轮，先补测试再修）。这份表是 [slice-5-SPEC.md](slice-5-SPEC.md) 的补充，不改它的任何条文；§0 和正文仍以原规格为准。表里每一行给出：用例 id、测试文件、给定和动作、精确期望、对应的规格条文、现在代码里管这件事的位置（行号按合并后副本 `s5r` 的当时状态）、以及**现在**的预期结果：**RED** = 还开着的问题，用例现在应当失败，而且失败在问题本身那一步（不是搭建失败）；**GREEN** = 已经修好的行为，用例现在就应当通过。测试由 Codex 按本表写，lead 核对后冻结（sha256 记在 lead 的笔记里），之后 DSH 按区域改生产代码，不改这些测试。
>
> **不在本轮：** 回答了“缺初始架构 / 缺完成标准”的卡在初始化采用后仍停在“已答复，待落实”（第 5 片收尾的第 6 条），按决定 48 移到第 6 片，本表不写。LB-1（每步确认下预算用完的停止也出确认卡）和接线包 L13 照 lead 的做法保留，本表不改它们。

## 0. 统一口径

- **夹具和断言口径同原规格 §5.1**：P/W，Goals A/B/C（order 0/1/2，revision 7），PA1/PB1，operator = human:operator，automation = WORKFLOW_AUTOMATION_ACTOR，T = `2026-10-08T00:00:00.000Z`，Q1/Q2 是 Goal B 的真实用户发起的根 QueryJob。“0 写”= 被测 owner 实际写的那个 Store 前后的 records/events/claims 数量和版本相同；“重放”= `replayed: true`、cursor 和 value 等于第一次、newId/now/body-put/模型调用计数不变。
- **真实历史。** 给定状态一律通过生产入口造（fixture 的 seed API、已有 owner 和状态机、平台的路由或 Workflow）；不伪造数据库里生产走不到的状态。读失败用“包一层真实端口、只在指定那一次读返回 `unavailable`”的方式注入，其余调用原样转给真实端口。
- **服务行**（文件名标了 `×2` 的）用 `describe.each(['memory','sqlite'])` 各跑一次；其余只跑 memory，除非行里另说。
- **RED 的写法。** RED 行在问题所在那一步之前，先用断言证明搭建是对的（例如“暂停前卡在队列里”），这样它失败时失败在问题那一步。
- **规格依据的写法。** `§8.2 行 1357` 指 slice-5-SPEC.md 第 1357 行（§8.2 表里“暂停/取消”那一行），其余同理：1354 范围/权限、1355 request head 并发、1356 答复/修改/补记三种事实、1357 暂停/取消、1358 固定等待/自治并发、1361 七源计数/历史、1362 notice cursor、1366 原回执、1367 数据兼容。

## 1. lead 为本轮定的技术选择（写进测试的期望；用户可改的行为一条没有新增）

- **T-R2-1 Agent 采用时记下是谁定的（问题 2）。** Runtime 工具 `apply_future_plan` 的严格参数加一个可选字段 `acknowledgementRef`（完整 SessionMessageRef，对应规格 §4.5“plans/apply input 仅扩 acknowledgementRef”）。模型不提供 `decisionSource`：计划 owner 的 Agent 分支自己读这条正式答复消息（`tasks → sessions` 是已有的边），用它保存的 `response.decision.source`（§2.8“message.response.decision.source 是答复 basis”），不信模型自报；答复不存在是 `not_found`，读失败原样返回，另一个 Workspace 是 `forbidden`。带了 `acknowledgementRef` 并且提交成功时，工具成功结果另带 `applicationReceipt: { identityKey, fingerprint, cursor }`，Agent 拿它调 `record_decision_application`；不带时结果和今天逐字节相同。原因：`record_decision_application` 的严格参数是 `{messageRef, receipt}`（§4.6），Agent 没有别的正式途径拿到 identityKey 和 fingerprint。**接线：** `WhiteboardToolsConfig` 加一个可选依赖 `applicationReceipt?: (ctx, cursor) => Promise<DecisionApplicationReceiptV1 | null>`，形状和 Workflow 的 `DecisionActionDependencies.applicationReceipt` 相同；composition 传给它的就是给 Workflow 的那一个函数（`create-platform.ts` 第 633–643 行，读提交 cursor 处事件里保存的 identityKey/fingerprint）。没接这个依赖、或它返回 null 时，结果里 `applicationReceipt: null`。
- **T-R2-2 已关闭请求历史的顺序（问题 4）。** 同一个请求的卡只有一张（§4.2 来源 3）。请求的槽在采用或放弃后释放，之后可以再出一个新的首候选（§2.4），于是一个请求可以有好几条替换链。历史卡取**最后一条链的末端**：按各条链的首候选的创建提交先后（正式的提交顺序），不按 refKey，也不按“accepted 优先”。槽是唯一的，新链只能在旧链关闭后开始，所以“最后创建的链”就是“最后关闭的链”。**做法：** 照 §2.5 通知 origin 的约定，PlanProposal 的 codec 注册 `commitCursorFields:["since"]`，新候选在创建它的那次提交里用 `commitCursorBindings {refKey, field:"since"}` 记下创建位置；之后的更新（替换、采用、放弃）复制原 `since`，不重绑；origin 和公开的 PlanProposal DTO 分开（另加一个 decode origin 的帮助函数），公开 DTO 和旧回执形状不变。比较位置只用 `contracts/ledger.ts:seqOfCommitCursor`。没有 `since` 的旧记录（第 5 片还没发布，生产里没有带请求的旧候选）排在有 `since` 的前面，彼此按 refKey。
- **T-R2-3 超界（问题 5）。** 按 §4.1 第 772 行：不按 Goal 过滤的队列读取，Workspace 的 Goal 超过 200 个回 `capacity`；任一来源的窗口超过 25 页 / 5000 项回 `capacity`。不再回 `ready` 加 `truncated` / `countsComplete: false`。正好 200 个 Goal、正好 5000 项不算超界。

## 2. 用例表

### 2.1 第 A 组：请求历史、超界、直接读卡（`tests/work-graph/S5R2-queue-history.test.ts`，×2，A08/A09 例外见行内）

| 用例 | 给定 / 动作 | 精确期望 | 规格依据 | 代码（s5r） | 现在 |
| --- | --- | --- | --- | --- | --- |
| R2A01 | Q1：Host 提 P1（requestRef=Q1，basedOn=PB1）→ operator 采用 P1（PB2 成为活动计划，槽释放）→ Host 为 Q1 再提 P2（新的首候选，basedOn=活动计划）→ operator 放弃 P2。读队列 `sections:['history']`（goalRef=B）和 `readDecisionCard`（来源 {kind:'candidate', goalRef:B, requestRef:Q1}） | 历史里 Q1 恰好一张卡，cardKey = `decisionSourceKey({kind:'candidate',goalRef:B,requestRef:Q1})`；`source.pins` 里的候选 pin = P2 的 ref 和当前 revision；`objects` 里没有 P1；`state:'closed'`、`closedReason:'source_resolved'`、`candidateStatus:null`、`readOnly:true`、`actions:[]`；两个入口返回的卡深等 | §2.4（采用/放弃槽→null，旧迭代历史可读）；§4.2 来源 3（每请求一张）；§4.1 第 776 行（两入口同 key）；§8.2 行 1361、1362（不拿 key 排序当时间）；T-R2-2 | `tasks/plan-readers.ts:637–721`（`enumerateClosedGoalCandidates`，`:700–707` accepted 优先、取 refKey 序的最后一个）；`views/decision-read-model.ts:1063–1135`（`findCandidateProposal` 同样规则） | **RED**（显示 P1） |
| R2A02 | Q1：P1 提出后放弃；P2（新的首候选）提出后放弃。两次提出的 requestId 选成 P2 的 refKey 排在 P1 之前（搭建里先断言 `planProposalRefKey(P2) < planProposalRefKey(P1)`）。读同上 | 历史卡的候选 pin = P2；其余同 R2A01 | 同 R2A01 | 同 R2A01（`:700–707` 取 refKey 序的最后一个） | **RED**（显示 P1） |
| R2A03 | Q1：P1 提出后放弃；P2 提出后由 operator 采用。读同上 | 历史卡的候选 pin = P2（revision 为采用后的版本）；其余同 R2A01 | 同 R2A01 | 同上 | GREEN |
| R2A04 | Q1：P1 提出；P2 以 `replaces:{P1}` 替换 P1；operator 放弃 P2。读同上 | Q1 历史恰好一张卡，候选 pin = P2；P1（not_adopted/replaced）不另成一张卡；历史里卡的总数 = 1 | §2.4 替换链；§4.2 来源 3 | `plan-readers.ts:684–691`（被替换的不算链末） | GREEN |
| R2A05 | Q1：P1 提出后被 operator 采用；再为 Q1 提 P2（活的候选，不关闭）。读队列 `sections:['waiting_answer','history']` | waiting_answer 里 Q1 一张卡（候选 pin = P2，`state:'waiting_answer'`）；history 里没有 Q1 的卡 | §4.2 来源 3（每请求一张；活的 head 归待答） | `plan-readers.ts:692–694` | GREEN |
| R2A06 | Goal B 的独立候选 U（无 requestRef）由 operator 采用。读 history | 一张历史卡，cardKey = `decisionSourceKey({kind:'candidate',goalRef:B,proposalRef:U})`，候选 pin = U | §3.3 第 629 行（独立候选按自己的 proposal 定 key）；§4.2 来源 3 | `plan-readers.ts:667–672`（LA5） | GREEN |
| R2A07 | Workspace W 里共 201 个 Goal（夹具的 A/B/C 加 198 个经正式建 Goal 入口建的）。不带 goalRef 读队列，四个 section，`page.limit:50` | `{status:'rejected', code:'capacity'}`；0 写；模型调用 0 | §4.1 第 772 行（Goal≤200，超界回 capacity）；T-R2-3 | `views/decision-read-model.ts`（列 Workspace Goal 的地方没有上限检查） | **RED** |
| R2A08 | 同 R2A07 但正好 200 个 Goal | `status:'ready'`（不是 capacity） | 同上 | 同上 | GREEN |
| R2A09 | 只跑 memory（建 5001 条太慢，sqlite 不跑）：W 里 5001 条待答的用户决定请求（经正式 `sendUserMessage`，发信方有 adviser 职责）。读队列 `sections:['waiting_answer']`、goalRef=B（这些请求都属 Goal B） | `{status:'rejected', code:'capacity'}`；不是 `ready` 加 `countsComplete:false`；0 写 | §4.1 第 772 行（单次窗口≤25 页/5000 项）；T-R2-3 | `decision-read-model.ts:273–324, 414–415, 487–488`（超了只记 `truncated`） | **RED** |
| R2A10 | 一条普通的 Session→Session 消息（Run RA 的 Session 经邮箱正式发给另一个 Session）。`readDecisionCard({source:{kind:'message', key: decisionSourceKey({kind:'message', messageRef}), …}})` | `{status:'not_found'}`；0 写 | §4.2 来源 1（只认用户收件、intent=decision_request、非合成）；lead LZ5 | `decision-read-model.ts:598–614` | GREEN |
| R2A11 | Goal A 的一个真实独立候选 PA。`readDecisionCard`，来源 = {kind:'candidate', goalRef:**B**, proposalRef:PA} | `{status:'not_found'}`；0 写 | §4.2 来源 3（查目标+请求）；lead LZ5 | `decision-read-model.ts:1068–1080` | GREEN |

### 2.2 第 B 组：自动化确认卡的回答和暂停（`tests/business/S5R2-automation-cards.test.ts`，memory；装配照原 `tests/business/S5-decision-workflow.test.ts` 的 WF01：真实 WorkGraph memory 夹具和真实决定 owner / 读者，只把执行和检查 owner 换成受控替身，不跑模型）

| 用例 | 给定 / 动作 | 精确期望 | 规格依据 | 代码（s5r） | 现在 |
| --- | --- | --- | --- | --- | --- |
| R2B01 | WF01 的给定（B 设为 every_step；b-work 的上一个 Run 崩溃，requeue 资格：prior 0、cap 3）。Workflow `select_work`（Goal B）得到 waiting 和 `decisionCause` C。读队列（goalRef=B，waiting_answer）。然后 operator 经 Workflow 的 `resolveDecision` 回答：source = 队列卡的 source，selection `{kind:'other'}`，text 非空，annotations [] | 队列里恰好一张 `goal_cause` 卡，`cardKey === C.source.key`，`state:'waiting_answer'`；`resolveDecision` → `ready`，`answer.status:'committed'`，`action:null`，`application:null`，`state:'answered'`；之后 `readDecisionCard(C.source)` 的 `state:'answered_pending_application'`、`answerMessageRef` = 答复的 ref；队列 counts：waitingAnswer 少 1，answeredPendingApplication 多 1；整个过程 TaskRequeue 数不变（回答不自动开始工作） | §2.8 末段（自动动作卡，code `automation_confirmation_required`）；§4.1（goal_cause 卡 options=[]，答复记 selection=other、requiresApplication=true）；§4.5 第 886、888 行；§8.2 行 1356 | `business/workflow/workflow.ts`（`automationConfirmation`，约 1123–1190）；`tasks/goal-decision-reader.ts:330–382`；`communication/decision-source-facts.ts:124–130, 416–431`；`views/decision-read-model.ts:1202–1212`（`workspaceOf`） | 原定 GREEN，实测 **RED**：新问题 N-R2-1（§3） |
| R2B02 | R2B01 到 waiting 为止；operator 正式暂停 Goal B。读队列；再按 R2B01 的方式回答 | 暂停后队列里仍是同一张卡（同 cardKey，`state:'waiting_answer'`，`readOnly:false`）；回答 → `answer.status:'committed'`、`state:'answered'`；卡变 `answered_pending_application` | §8.2 行 1357（暂停可答，卡不能因暂停消失）；§4.5 第 886 行 | `state/decision-policy.ts:159–194`（工作 Task 的暂停推导）；`goal-decision-reader.ts:357–361` | GREEN |
| R2B03 | B 设为 every_step；B 的一个 gate Task，它的检查链头是已定稿的非 PASS 轮次，满足自动 reverify（GV-9 或 GV-10，没有进行中的修复）。Workflow `select_work`（Goal B）得到 waiting，`decisionCause.action:'auto_reverify'`，`taskRef` 是这个 gate。先断言队列里有这张卡（cardKey = `decisionCause.source.key`）。然后 operator 暂停 Goal B，再读队列 | 暂停后队列里仍有这张卡：同 cardKey、`state:'waiting_answer'`、`readOnly:false` | §8.2 行 1357；§2.8 末段；§4.5 第 888 行 | `state/decision-policy.ts:195–196`（gate 一律返回 null）；`goal-decision-reader.ts:357–361` | **RED**（卡消失） |
| R2B04 | R2B03 到暂停为止；operator 用 R2B01 的方式回答这张 gate 卡 | `answer.status:'committed'`、`state:'answered'`；卡变 `answered_pending_application` | §8.2 行 1357；§4.5 第 886 行（目标暂停时 ① 成功） | `decision-source-facts.ts:301–318`（`verifyRealCause` 找不到这个原因 → not_found） | **RED**（not_found） |
| R2B05 | B 是默认的 after_plan_confirmation；b-work 的上一个 Run 崩溃。Workflow 推进到真正执行了 `requeue_task`（TaskRequeue 已提交）。operator 把 B 改成 every_step（正式 `setGoalSettings`）。原样重试那一步 `requeue_task`（同一个 advance、同一个 requestId） | `ready`，回执是原来那次 requeue 的回执（同一个 TaskRequeue ref、`replayed:true`、同 cursor）；没有 `decisionCause`，reason 不是 `automation_confirmation_required:…`；重试 0 写 | §8.2 行 1366（重放早于新业务状态读）；§4.5 第 888 行（已开始的不按新自治设置追溯停止）；lead LZ4（第 5 片收尾的第 7 条） | `workflow.ts`（`automationConfirmation` 开头 `coveringRequeue` 判断，约 1132–1135） | GREEN |

### 2.3 第 C 组：结构化冲突答复的重试和 lead 小修（`tests/business/S5R2-settings-replay.test.ts`，×2）

装配：真实 owner（Goal 设置、决定消息、来源事实、计划）加 Workflow 的 `resolveDecision`，依赖和 `src/composition/create-platform.ts` 的接法相同（`applicationReceipt` 读提交 cursor 处事件里保存的 identityKey/fingerprint，同 create-platform 第 633–643 行；`goalPhasePin` 是 Workflow 自己的，`workflow.ts` 约 1984–1994 行）。冲突给定：A、B 两个 Goal 的活动计划都改模块 M（`src/m/`），冲突卡来自 `queryGoalConflicts`。

| 用例 | 给定 / 动作 | 精确期望 | 规格依据 | 代码（s5r） | 现在 |
| --- | --- | --- | --- | --- | --- |
| R2C01 | operator 对 A/B 冲突卡 `resolveDecision`，selection `{kind:'conflict_wait', earlier:A, later:B}`，requestId r → `state:'applied'`。然后 operator 正式暂停再继续 A（A 的 revision +2，内容不变）。原样重试同一个请求（同 requestId、同 input、同 meta） | `ready`；`answer` = 第一次的（`replayed:true`、同 cursor）；`action` = 第一次的 settings 回执（`status:'committed'`、`replayed:true`、同 cursor、value 深等）；`application` 同样是重放；`state:'applied'`；重试 0 写，计数不变 | §4.5 第 884 行（settings 命令的 expected 和指纹保留原捕获 pins，重试先恢复原 settings receipt）；§8.2 行 1366；lead LD1/LD3 | `business/workflow/decision-actions.ts:148–181, 221–258`；`tasks/goal-settings-service.ts:548–561`（指纹只含捕获的 pins） | GREEN |
| R2C02 | R2C01 的第一次执行之后，原样重试；这次重试时 A 的 Task 图（`goalPhasePin` 读 A 的 GoalPhase 用的读）返回 `unavailable` | 和 R2C01 的期望完全相同（三个回执都是重放，`state:'applied'`） | §8.2 行 1366（重放早于新业务状态读）；§4.5 第 884 行 | `decision-actions.ts:172–179`（重放前先读 GoalPhase） | **RED**（action 是 unavailable，state `application_not_recorded`） |
| R2C03 | operator 对 A/B 冲突卡 `resolveDecision`，selection `{kind:'conflict_order', goalOrder:[C, B, A]}`（C 不在卡捕获的 pins 里）→ `applied`。然后 C 经正式 owner 再变一次（例如 `setGoalSettings` 改 C 的自治）。原样重试 | 同 R2C01 的期望 | §4.5 第 884 行；lead LD1/LD3 | `decision-actions.ts:152–171`；`goal-settings-service.ts:548–561` | GREEN |
| R2C04 | R2C03 的第一次执行之后，原样重试；这次重试时读 Goal C 的设置（`readGoalSettings` 用的 Goal 记录读）返回 `unavailable` | 同 R2C01 的期望 | §8.2 行 1366；§4.5 第 884 行 | `decision-actions.ts:152–162`（重放前先读没捕获的 Goal） | **RED** |
| R2C05 | A 先被 operator 暂停；operator 对 A/B 冲突卡 `resolveDecision`（conflict_wait，earlier A，later B）→ `state:'awaiting_resume'`（action 是 `busy`）。operator 继续 A（A 的 revision +1，内容不变）。原样重试同一个请求 | `state:'applied'`；`action.status:'committed'`、`replayed:false`；返回的 B 的 `settings.waitForGoalRef` 深等 A；`GoalSettingsChanged` 事件的 proof：`capturedPins` 里 A 是暂停时捕获的版本 | §2.8 第 402 行（只差控制字段、内容基础相同，可以重定位）；§0.2 T02；lead LZ3 | `goal-settings-service.ts:680–700`（只读的前一个 Goal 也适用控制重定位） | GREEN |
| R2C06 | 一个真实答复消息 ref，把它的 workspaceId 换成 `W2`（同 project 另一个 Workspace）后作为 `decisionMessageRef` 调 `reorderGoals`（goalOrder=[A,B,C]，pins 正确） | `{status:'rejected', code:'forbidden'}`；0 写 | §8.2 行 1354（跨 Workspace forbidden）；lead LZ2 | `goal-settings-service.ts:437–444` | GREEN |
| R2C07 | 同 R2C06，调 `resolveGoalConflict`（source = 真实冲突卡的 source，selection conflict_parallel） | `{status:'rejected', code:'forbidden'}`；0 写 | 同上 | `goal-settings-service.ts:538–541` | GREEN |
| R2C08 | Goal A 的计划 PA1 正式完成（GoalPhase=COMPLETED，planRef=PA1），之后 A 采用了新计划 PA2（仍改模块 M）；B 的活动计划也改 M。读 `queryGoalConflicts` 和队列 | A/B 冲突卡存在，`state:'waiting_answer'`（不是 closed / source_resolved）；两个入口一致 | §4.3 第 829 行（只有当前活动计划的完成才算终止）；lead LZ1 | `communication/decision-source-facts.ts:263–279`；`views/goal-conflicts.ts:228–241` | GREEN（这个给定若走生产入口造不出来，写进 UNDETERMINED，不伪造） |

### 2.4 第 D 组：Agent 采用的归属和补记、Runtime 重试；排序安全点

`tests/runtime/S5R2-agent-application.test.ts`（×2）：Agent = Session S 上真实领取、进入、运行中的 Run RA（work_run），职责和 W2 委托写权限由可信 adapter 给，经真实 `createWhiteboardTools` 和 `createSessionMailboxTools`（带 `decisionMessages`）调用工具；operator 经真实 owner 回答。

| 用例 | 给定 / 动作 | 精确期望 | 规格依据 | 代码（s5r） | 现在 |
| --- | --- | --- | --- | --- | --- |
| R2D01 | Goal B 的自治是默认的 after_plan_confirmation（ack 只是归因、不是授权，§8.2 行 1356；every_step 下 Agent 本来就不能采用）。Agent 用 `propose_future_plan` 为 Goal B 提独立候选 U（basedOn=PB1）。operator 回答 U 的候选卡（selection other，text 非空）。Agent 调 `apply_future_plan`：`{proposalRef:U, expectedProposalRevision:1, expected:[…], acknowledgementRef: 答复的 ref}` | 工具成功，结果是 committed 的 PlanRevision；Store 里这次的 `PlanRevisionAccepted` 事件 `payload.acknowledgementRef` 深等答复 ref，`payload.decisionApplication.capturedPins` 深等答复的 `response.decision.source.pins`；结果带 `applicationReceipt`，其 `identityKey`/`fingerprint` 等于该事件保存的值，`cursor` 等于这次提交的 cursor | §4.5（plans/apply 仅扩 acknowledgementRef）；§2.8（answer 的 source 是 basis；PlanRevisionAccepted 加可选 ack/proof）；§8.2 行 1356；T-R2-1 | `agent-runtime/whiteboard-tools.ts:211–218`（严格 schema 没有这个字段）、`:301–309`（转发时不带）；`tasks/plan-service.ts:3276–3355`（owner 一侧已能收） | **RED**（工具参数非法） |
| R2D02 | R2D01 之后，Agent 调 `record_decision_application`：`{messageRef: 答复 ref, receipt: R2D01 的 applicationReceipt}` | 工具成功，committed；答复消息 revision +1，`application` 深等 owner 从这条正式回执读出的 application（`actor` 是 Agent 的 actor）；`readDecisionCard`（候选来源）`state:'applied'`；队列 answeredPendingApplication 少 1 | §4.6（record 工具需真实修改者）；§3.1 S5-MSG-04；§8.2 行 1356 | `agent-runtime/communication-tools.ts:532–566`；`communication/decision-service.ts:945–1047` | **RED**（先失败在 R2D01 那一步，同一个问题 2） |
| R2D03 | R2D02 之后，Agent 原样重试那次 `record_decision_application`（同 callId，所以同 requestId）；这次重试时读答复消息（工具在调 owner 之前的那次读）返回 `unavailable` | 工具成功，`replayed:true`、cursor 和 message 值等于第一次；0 写 | §8.2 行 1366（重放早于新业务状态读）；lead LB-2 | `communication-tools.ts:547–561`（先读消息再调 owner） | **RED**（问题 2 修好以前先失败在 R2D01 那一步；问题 2 修好、问题 3 没修时失败在重试这一步） |
| R2D04 | Agent 的候选 U 被 operator 采用（Host `applyPlanChange` 带 `acknowledgementRef` = 答复 ref）之后，Agent 调 `read_user_decision`（source = U 的候选卡 source） | `ready`，读到原答复（selection、text、annotations 和答复时一致）；0 写 | §4.6（问的一方即使申请应用已完成仍读得到） | `decision-service.ts`（`readDecisionAnswer` 按保存的历史事实授权，B 区 B3） | GREEN |
| R2D05 | Host `applyPlanChange`（operator）采用 U，`acknowledgementRef` = 一个真实答复 ref 但 workspaceId 换成 `W2` | `{status:'rejected', code:'forbidden'}`；0 写 | §8.2 行 1354；lead LZ2 | `plan-service.ts:1508–1518` | GREEN |
| R2D06 | Agent 调 `apply_future_plan`，不带 `acknowledgementRef` | 工具成功；事件 `payload` 里没有 `acknowledgementRef` 和 `decisionApplication` 两个键；工具结果里没有 `applicationReceipt` 键 | §2.8（旧的 Accepted 缺 ack/proof 照样可读）；T-R2-1（不带时和今天相同）；lead LB3 | `plan-service.ts:3301–3310`（不带时指纹不变） | GREEN |

`tests/app/S5R2-driver-safe-point.test.ts`（memory）：真实 `createCollaborationDriver`；`workflow.orderGoalAdvances` 是真实 Workflow 的排序（真实 Goal 设置 owner，先经正式 `reorderGoals` 把顺序定成 B=0、A=1、C=2），`workflow.advanceWork` 用一个记录调用顺序、按脚本返回的替身（照 `tests/app/change-emitters.test.ts` 的写法）；runtime/sessions/executions/mailbox/controls 同 change-emitters 的替身。“同一轮”= 两次 `driver.start` 之间不 await。

| 用例 | 给定 / 动作 | 精确期望 | 规格依据 | 代码（s5r） | 现在 |
| --- | --- | --- | --- | --- | --- |
| R2D07 | 同一轮先 start Goal A 的 `select_work`，再 start Goal B 的 `select_work`（同一个 sessionHint） | `advanceWork` 收到的顺序是 B 再 A；`orderGoalAdvances` 恰好被调一次，参数里两个 advance 都在 | §4.5 第 890 行（在领取/创建的安全点按 Goal.settings.order 排序，再逐个调 Workflow） | `app/collaboration-driver.ts:476–611`（`awaitAdvanceAdmission`、`runRendezvous`） | GREEN |
| R2D08 | 同 R2D07，两个 advance 的 `sessionHint` 都是 null | 顺序同 R2D07（B 再 A） | 同上 | 同上 | GREEN |
| R2D09 | 同 R2D07，但 `orderGoalAdvances` 返回 `{status:'rejected', code:'unsupported'}` | `advanceWork` 两次都被调用，顺序 A 再 B（到达顺序）；两个 handle 都离开安全点 | 同上（拒绝时保持原来的顺序） | `collaboration-driver.ts:485–491` | GREEN |
| R2D10 | 同 R2D07，但 `orderGoalAdvances` 抛异常 | 同 R2D09 | 同上 | `collaboration-driver.ts:581–585` | GREEN |
| R2D11 | Goal A 的 handle：第一次 `advanceWork` 返回带 `complete_task` 回执、`next` 是钉在同一 Task 上的 `select_work`（有 taskId）；第二次（这个钉住的观察步）返回 completed；之后回到 Goal 范围的 `select_work` | 钉住的观察步不经过安全点：调它之前 `orderGoalAdvances` 的调用次数不增加；回到 Goal 范围的那次 `select_work` 经过安全点（调用次数 +1） | §4.5 第 890 行（只在领取/创建处排序）；lead LC1 | `collaboration-driver.ts:787–797, 830–841, 893–895` | GREEN |
| R2D12 | Goal B（order 0）的 handle 已放行，它的 `advanceWork` 永不返回；同一轮 Goal A（order 1）在安全点等。`driver.stop` A | stop 在 B 的调用仍挂着时就完成；A 的状态是 stopped；A 的 `advanceWork` 从未被调用 | §4.5 第 890 行（不新建调度器，不无限等）；lead LC2 | `collaboration-driver.ts:551–558, 977–986` | GREEN |
| R2D13 | Goal A（order 1）单独 start，它的 `advanceWork` 已被调用且挂着；之后 start Goal B（order 0） | B 的 `advanceWork` 在 A 之后被调用；A 那次调用拿到的 signal 没有被 abort | §4.5 第 890 行（后来的高顺位目标不能撤回已领取的低顺位任务） | `collaboration-driver.ts:567–611` | GREEN |

## 3. 补测时发现的新问题（lead 在被引的行上核过）

- **N-R2-1 Workflow 发出的自动化确认卡，用它自己给的来源读不到答复。** R2B01：回答以后，用 Workflow 返回的 `decisionCause.source` 调 `readDecisionCard`，卡仍是 `waiting_answer`、`answer:null`；用队列卡的来源读则是 `answered_pending_application`。两处原因：(a) Workflow 发出的来源没有 `goalBases`（`business/workflow/workflow.ts` 约 1200–1212 行），违反 §2.8“每个用于答复的新 source 包含 canonical goalBases，由 owner 从正式 Goal 生成”；(b) 读模型找答复时用 `goalBases[0]` 推出 Workspace（`views/decision-read-model.ts:1202–1212` `workspaceOf`），来源没有 `goalBases` 就当作“没有答复”，而这次读取本来已经绑定了 Workspace（§4.1“卡 key 是 §3.3 的 source identity，两入口共用”；旧来源缺 `goalBases` 默认 `[]`，§2.8）。(a) 让 R2B01 通过；(b) 是同一类问题的另一半，一并修：找答复用调用已绑定的 Workspace，不靠来源里的 goalBases。

## 4. 汇总

- 新测试文件 5 个：`tests/work-graph/S5R2-queue-history.test.ts`（11 行，×2；R2A09 只跑 memory）、`tests/business/S5R2-automation-cards.test.ts`（5 行）、`tests/business/S5R2-settings-replay.test.ts`（8 行，×2）、`tests/runtime/S5R2-agent-application.test.ts`（6 行，×2）、`tests/app/S5R2-driver-safe-point.test.ts`（7 行）。共 37 行。每组至多另加一个 `tests/helpers/S5R2-*.ts` 辅助文件。不改任何已冻结的文件。
- **RED 11 行**：R2A01、R2A02（问题 4）；R2A07、R2A09（问题 5）；R2B03、R2B04（问题 1）；R2C02、R2C04（问题 3，设置一侧）；R2D01、R2D02（问题 2），R2D03（问题 3，Runtime 一侧；问题 2 修好以前先失败在问题 2）。
- **GREEN 26 行**（其中 R2B01 实测失败，是新问题 N-R2-1，见 §3，并入要修的清单）：第 7 条 / LZ4（R2B05）；LZ1（R2C08）、LZ2（R2C06、R2C07、R2D05）、LZ3（R2C05）、LZ5（R2A10、R2A11）；C 区排序安全点（R2D07–R2D13）；D 区等待 / 顺序的重试（R2C01、R2C03）；A 区已关闭历史（R2A03–R2A06）和 R2A08；B 区已发出、已暂停的工作 Task 卡的回答（R2B01、R2B02）；R2D04、R2D06。
