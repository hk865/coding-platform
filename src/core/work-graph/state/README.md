# src/core/work-graph/state：受保护生命周期字段的唯一构造与迁移层

## 负责什么，不负责什么

- 本层是 Run、Attempt、Lease、Outbox、Session、Query、Goal、Task、Plan、验证轮/检查、注记、消息、控制意图等受保护字段的唯一构造与迁移处；服务写这些字段必须经过这里的构造器或 `transition*`（AGENTS.md 第 9 条）。
- 纯子模块（module-target.json `state` 的 `pure: true`，dependencies 为空）：只 import `src/contracts` 和本目录，不 import WorkGraph 其它子模块、AgentRuntime、RecordStore、app/business/composition。
- 每个 `transition*` 接收当前记录/机器状态、事件、守卫上下文，返回 `next`（整条下一条记录）和 `effects`；owner service 在同一个 RecordStore 提交里写 `next`、翻译 effects。
- 不读存储、不生成 id、不读时钟/随机数/计时器/网络/进程；时间、事件 id、已判定的守卫事实都由调用方传入，本层不做 I/O。
- 服务负责收集事实、做 guard、翻译 effects、落持久层；本层不承担调度、重试和事务，也不决定何时提交。

## 文件

### Session/占用/请求与控制

做 Session 生命周期、占用、责任交接、请求轮与控制意图的去这组。

- `session-activity.ts` — Session 活动记录的纯规则与记录构造都在这里：`latestActivityAt`（线卡时钟，`src/core/work-graph/state/session-activity.ts:25`；`tasks/line-clock.ts` 只再导出）与 `nextSessionActivity`（`src/core/work-graph/state/session-activity.ts:41`；一次提交事实之后的下一条记录：revision 递增、时刻不回退、迟到的旧事实不改 kind/source）。
- `session-availability.ts` — Session 机器：lifecycle × health × occupancy、生命周期记录构造、占用/分派/可用性三类准入。
- `session-responsibility.ts` — Session 责任转移/关闭机器：同一提交游标关闭源链接、打开目标链接。
- `session-handoff.ts` — 交接操作和秘书归档操作的纯准入（拒绝顺序：调用者、范围、形状、源和目标、职责、未完成操作）与接受时的记录构造；两个分支的 `progress` 只在这里写，包含三个保存位置（`createInput`、`understanding[].command`、`archiveRequest.savedInput`）、推进用的 `withHandoffProgress`、纯覆盖规则 `coverageHolds`、简报就绪规则 `briefReady` 和 entered 确认的 `consumeHandoffBrief`。
- `session-anomaly.ts` — Session 异常锚点的构造/迁移/读取与 Task 归档状态派生。
- `request-rounds.ts` — 请求轮构造：新请求、路由轮（普通路由与 `routing: null` 的归属臂）、未开始结束、新尝试、吸收、intake、entered；归属臂把 `goalAttribution.goalId` 同时写进 `job.goalId` 与 `job.goalAttribution`（下游按字符串比较），`understanding` 保持 `null`，普通路由臂不变；理解命令的合法状态迁移 `live → closed|consumed`、当前 generation 读取，以及冻结材料列表上仍有效授权集的唯一纯规则（每条命令按自己的 operation 判 generation/state/root owner，按 Goal 去重并保持轮次顺序）。
- `review-lease.ts` — 复查租约释放、可证明未进入的复查取消、复查轮已知结束。
- `control-intent-machine.ts` — ControlIntent 机器：一次暂停/取消/恢复/steer 请求的归宿，以及提交前检查。

### Run/Attempt/Query

做 Run、Attempt/Lease/Outbox、Query 生命周期、活动替换与无进展判定的去这组。

- `run-machine.ts` — Run 机器：status/outcome、V2 入口相位、控制指针；每次写入整条 Run。
- `attempt-machine.ts` — TaskAttempt / TaskLease / DispatchOutboxEntry 三部机器与 Run 事件映射；与 Run 事件同一提交。
- `query-run-recovery.ts` — QueryRun/QueryJob 生命周期构造与恢复：claimed/prepared/entering/entered/unknown/settled。
- `transition.ts` — 所有机器共用的 `Transition` 形状与 accept/reject 构造。
- `no-progress.ts` — 无进展/重验证键与失败事实；requeue 与 successor 两套键，互不比较。
- `activity-replacement.ts` — L4 唯一的活动替换判定（created/replaced/unchanged），回填与 Run 结束提交共用。

### Task/Goal/Plan 与工作线

做 Task/Goal/Plan、验证轮、决策策略与工作线派生的去这组。

- `task-machine.ts` — Task 机器：相位投影（P1..P20）与写入合法性（TASK-01..30）、缩减/重排队记录。
- `task-failure.ts` — Task 失败事实：失败分类、重做权限与围栏、自动化裁决、refusal 记录。
- `goal-confirm.ts` — `goals/confirm-draft` 的纯规则：`decideGoalConfirm` 的拒绝顺序（不是最新已答轮 → `revision_conflict`；草稿下标越界 → `invalid`；同一 `(answerRef, draftIndex)` 已确认 → `revision_conflict`）、确认后的 objective 文本 `confirmObjectiveText`（正文与每条完成标准都经 `normalizeObjective`），以及不可变 `InitializationBinding@1` 的唯一构造 `newInitializationBinding`（ref 指 answer+draft，revision 与 goalRevision 都是 1，顺序和重复原样保留）。无 I/O、无时钟、无 id；服务只编码它并放进自己的一次提交。
- `goal-copy.ts` — 复制的纯决定：只有 `cancelled` 源可复制；确认带回 `expectedSourceRevision` 时先核对源 revision；勾选的干预必须是 owner 读到的、可选的候选，同一 ref 勾选两次被 `invalid` 拒绝（6B 没有读端口时候选集为空，非空勾选被拒而不是被信任）；出生设置保留源的 autonomy 与 order、清空「等前一个」和并行风险，再由 `isLegalSettings` 查形状；决定给出 `continuedFrom`、`copiedInterventions`（勾中的候选 ref，按勾选顺序）、`retract`（未勾中的候选 ref，按候选顺序）与 `selection`（`retract` 非空即 `retraction_pending`）。`planReanchorHook` 是 7D1 填的唯一具名缝（现在只答 `not_implemented`）。
- `goal-machine.ts` — Goal 机器：目标状态、计划指针、完成记录；fan-out/resume 身份与展示归约；re-export `GOAL_FAN_OUT_ACTOR`。
- `goal-settings-machine.ts` — Goal 设置机器与启动准入、决策依据匹配、Goal 冲突事实。
- `plan-machine.ts` — PlanProposal 机器与 PlanRevision 派生：candidate→accepted 与 Goal 指针同一提交。
- `verification-machine.ts` — VerificationRound / round-check / TaskEvidenceIndex 机器与链、折叠、重验证、证据索引。
- `decision-policy.ts` — 自主级别动作表、用户消息准入、自动化确认原因、gate 覆盖与修复判定。
- `line-status.ts` — 工作线的纯派生：状态、注意、标记、桶、归档标签、控制项、排序键。
- `line-pin-machine.ts` — Workspace 工作线置顶机器（一次原子增删）。
- `initialization-adoption.ts` — 初始化采用操作的纯记录表：出生 `newInitializationAdoptionRecord`、既有操作的再次接受 `acceptExistingInitializationAdoption`、写入前标记 `nextAdoptionStage`，以及三个后写 `advanceInitializationAdoption`/`stopInitializationAdoption`/`completeInitializationAdoption`，再加供服务重建已提交记录的纯投影 `committedAdoptionRecord`（前缀、before/stopped 标记与 `record.result` 只在这里形成；不读时钟、不生成 id、不碰存储）。

### 注记/消息/其他生命周期

做注记、消息、通知已读、命令、上下文守卫、未知调用、架构捕获与 ref 比较的去这组。

- `note-machine.ts` — 注记状态机：写入准入、授权、处置目标、版本与现行指针；纯 `secretaryNoteScope`（普通注记取本轮冻结的有效 Goal，目标或 stage 理解停在有效 Goal 内，只有授权的 Goal 理解可用该 Goal 作主锚点，项目理解与修复拒绝）。
- `secretary-note.ts` — 纯的 Query 注记准入（`secretaryNoteAdmission`，`src/core/work-graph/state/secretary-note.ts:31`）：只有请求轮（有冻结的请求根）是秘书轮，给六个通用写入种类加 `understanding`、`withdraw: true` 和被授权的 Goal id；普通 Query 与副本得到 `none`。`QueryNoteAdmissionV1` 唯一的声明在本文件，消费方经 `model/secretary-note-contracts.ts` 的再导出引用。
- `message-machine.ts` — SessionMessage 机器：pending<read<responded、等待满足与记录构造；7A-1 的投递与证据值、秘书轮发送方记录、拒绝回复、四个生命周期变更与事件类型（M-1 已激活）。
- `copy-intervention.ts` — 复制取消的纯候选规则：`copyInterventionCandidateOf` 按书的表序（先两项排除，再投递/未投递）判一条消息是不是候选、可选/可撤回及原因；事实形状 `CopyInterventionFactsV1`，不读存储、不写、无游标。
- `dispatch-counter.ts` — 派工计数器的纯构造：`firstDispatch` 从缺失生成 sequence/revision 1，`nextDispatch` 递增两者；返回记录与 `expectedRevision`，不构造 RecordStore guard。
- `notice-settings-machine.ts` — Workspace 通知已读位置机器。
- `command-rerun-request.ts` — `CommandRerunRequest` 机器与“同一别名只开一个请求”的 helper。
- `command-normalization.ts` — 命令文本规范化、sha256、action key 与 shell 动作解析（纯）。
- `context-input.ts` — 上下文/声明输入的纯守卫：冻结段序、结构、渲染区间、字节数、Goal 段、平台职责；`secretary` 调用必须有 `goal` 和 `task` 两段（没有目标时 `goal` 段照旧渲染 Workspace、目标列表和 `secretary.noGoal`）。
- `unknown-call-kinds.ts` — 固定工具种类表（自上而下首个匹配）与主机停止/清理接管判定。
- `unknown-call-review.ts` — UnknownCallReview 聚合机器：创建、截断、准入、迁移与上限常量。
- `architecture-capture.ts` — `ArchitectureAutoCapture@1` 的唯一写入：捕获请求、当前状态、失败记录。
- `ref-equality.ts` — 与键序无关的 ref 结构相等；`sameRef` 的唯一正本。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `firstDispatch`、`nextDispatch`、`DispatchCounterWriteV1` | `src/core/work-graph/state/dispatch-counter.ts:10`、`src/core/work-graph/state/dispatch-counter.ts:28`、`src/core/work-graph/state/dispatch-counter.ts:4` | 首次与后续派工的计数器记录和版本期待 | 发送 owner 在同一次提交中写计数器并构造 guard 时 |
| `decideActivityOutcome` | `src/core/work-graph/state/activity-replacement.ts:23` | 按 L4 判定本次活动写是 created/replaced/unchanged | 回填或 Run 结束要写 Run.activity 时 |
| `newArchitectureCaptureRequestRecord` | `src/core/work-graph/state/architecture-capture.ts:37` | 建 status=requested 的捕获请求记录（revision/requestSeq 递增） | 接受一次自动捕获触发时 |
| `architectureAutoCaptureState` | `src/core/work-graph/state/architecture-capture.ts:56` | 自动捕获的公开投影，pending 由 satisfiedRequestSeq 算出 | 判断是否该触发捕获 |
| `attemptEventFromRunEvent` | `src/core/work-graph/state/attempt-machine.ts:231` | Run 事件映射为 Attempt 事件；null 表示三记录都不写 | Run 事件提交里同步 Attempt/Lease/Outbox |
| `newTaskAttemptRecord` | `src/core/work-graph/state/attempt-machine.ts:270` | ATT-01 的 claimed@1，可带 requeueRef | claim 提交 |
| `newTaskLeaseRecord` | `src/core/work-graph/state/attempt-machine.ts:277` | ATT-14 的 held@1，不靠 expiresAt 释放 | claim 提交 |
| `newDispatchOutboxRecord` | `src/core/work-graph/state/attempt-machine.ts:285` | ATT-24 的 pending@1，保留不可变 claim | claim 提交 |
| `transitionAttempt` | `src/core/work-graph/state/attempt-machine.ts:527` | TaskAttempt 的 ATT-01..13 迁移 | Run 事件同一提交 |
| `transitionTaskLease` | `src/core/work-graph/state/attempt-machine.ts:711` | TaskLease 的持有/释放迁移 | release_lease、Attempt 结束时 |
| `transitionDispatchOutbox` | `src/core/work-graph/state/attempt-machine.ts:812` | DispatchOutboxEntry 迁移 | Run 事件同一提交 |
| `commandSha256` | `src/core/work-graph/state/command-normalization.ts:34` | 命令摘要，走 contracts 的 sha256 | 记录/比较命令指纹 |
| `parseShellActionsDetailed` | `src/core/work-graph/state/command-normalization.ts:522` | 解析一条命令里的 shell 动作，保留词边界 | 命令分类、重跑与审查 |
| `newCommandRerunRequest` | `src/core/work-graph/state/command-rerun-request.ts:78` | 建 CommandRerunRequest 记录 | 收到一次重跑请求 |
| `transitionCommandRerunRequest` | `src/core/work-graph/state/command-rerun-request.ts:109` | 重跑请求迁移，含同身份同指纹重放 | 处理/重放重跑请求 |
| `frozenSectionOrderProblem` | `src/core/work-graph/state/context-input.ts:96` | 检查冻结的段序 | 校验 ContextAssemblyBinding |
| `contextAssemblyProblem` | `src/core/work-graph/state/context-input.ts:284` | G-CTX 总检查：结构、区间、字节、段、来源 | 读取或写入上下文绑定时 |
| `pointerAfterSubmit` | `src/core/work-graph/state/control-intent-machine.ts:185` | 提交后 Run 控制指针的变化 | 与意图同一提交写 Run 指针 |
| `controlSubmissionProblem` | `src/core/work-graph/state/control-intent-machine.ts:230` | 控制提交两机器共用的检查 | 提交 pause/cancel/resume/steer |
| `newQueuedControlIntentRecord` | `src/core/work-graph/state/control-intent-machine.ts:364` | 建 Queued@1 意图记录 | 接受控制请求 |
| `controlIntentStateOf` | `src/core/work-graph/state/control-intent-machine.ts:333` | 意图快照的机器状态 | 迁移前 |
| `transitionControlIntent` | `src/core/work-graph/state/control-intent-machine.ts:886` | 意图主迁移（Queued→Applied/Superseded/OutcomeUnknown） | 控制请求提交与观测 |
| `decisionActionPolicy` | `src/core/work-graph/state/decision-policy.ts:31` | 自主级别 × 动作的唯四值表 | owner、工具、Workflow、路由都查它 |
| `canSendUserMessage` | `src/core/work-graph/state/decision-policy.ts:71` | S5-AU-04 的 notify/decision_request 准入 | 准备向用户发消息 |
| `automationConfirmationCause` | `src/core/work-graph/state/decision-policy.ts:118` | 从策略与已存受影响 refs 派生确认原因 | 需要 automation_confirmation_required 时 |
| `decideGoalCopy`、`DecideGoalCopy` | `src/core/work-graph/state/goal-copy.ts:24` | 复制的唯一纯决定：源必须 `cancelled`；`revision_conflict`/`invalid` 的拒绝文案都出自这里，同一 ref 勾选两次也是 `invalid`；产出新 Goal 的 `objective`、`settings`、`continuedFrom`、`copiedInterventions`（勾中的候选 ref，按勾选顺序）、`retract`（未勾中的候选 ref，按候选顺序）与 `selection`（`selection_only`/`retraction_pending`，`retract` 非空即后者） | 复制确认在提交前判；不要在服务里另判源状态、revision 或勾选 |
| `planReanchorHook` | `src/core/work-graph/state/goal-copy.ts:12` | 7D1 要填的具名 seam：把目标参谋/书记的负责关系挪到新 Goal；现在只返回 `not_implemented`，不写事实、不给回执 | 复制确认里预留的负责关系迁移点；不要另开一条迁移路径 |
| `newGoalSnapshot` | `src/core/work-graph/state/goal-machine.ts:97` | 建 Goal 的预绑定快照（`since: null`，创建提交填游标）；出生即带 `settings`、`continuedFrom`、`copiedInterventions` | 新建 Goal |
| `decideGoalConfirm` | `src/core/work-graph/state/goal-confirm.ts:32` | confirm-draft 的唯一纯决定：拒绝顺序、草稿、objective、出生设置与 order | 确认草稿前；不要另写拒绝顺序 |
| `confirmObjectiveText` | `src/core/work-graph/state/goal-confirm.ts:21` | 确认后的 objective：正文 + 空行 + `完成标准：` + 每条 `- ` 完成标准，两段都规范化 | 建确认 Goal 的 objective |
| `newInitializationBinding` | `src/core/work-graph/state/goal-confirm.ts:60` | 不可变 `InitializationBinding@1` 的唯一构造：ref、answerRef、digest、requestRef、draftIndex、goalRef、screening | 确认提交；服务只编码，不自己构造 |
| `goalStateOf` | `src/core/work-graph/state/goal-machine.ts:217` | Goal + GoalPhase 的机器状态；保留记录类型，预绑定 Goal 得 pending 状态 | Goal 迁移前 |
| `goalCompletionProblem` | `src/core/work-graph/state/goal-machine.ts:451` | 完成事件的前置检查 | goal_completed 提交 |
| `transitionGoal` | `src/core/work-graph/state/goal-machine.ts:601` | Goal 主迁移：目标状态、计划指针、完成；`goal_created` 的 `next` 是预绑定 Goal | Goal 写入 |
| `goalFanOutRequestId` | `src/core/work-graph/state/goal-machine.ts:646` | 派生 fan-out 请求的稳定 id | pause/cancel/resume 的扇出 |
| `findGoalResumeContinuations` | `src/core/work-graph/state/goal-machine.ts:699` | 从任务事实找 resume 的续作 | 恢复 Goal 后规划续作 |
| `transitionGoalSettings` | `src/core/work-graph/state/goal-settings-machine.ts:189` | Goal 设置迁移（order_set 用已有顺序的下标） | 修改 Goal 设置 |
| `goalStartPolicy` | `src/core/work-graph/state/goal-settings-machine.ts:237` | 启动准入策略 | 自动启动 Goal 前 |
| `goalDecisionBasisMatches` | `src/core/work-graph/state/goal-settings-machine.ts:255` | 决策依据是否仍对应当前 Goal | 复用/重算决策时 |
| `isLegalSettings` | `src/core/work-graph/state/goal-settings-machine.ts:141` | Goal 设置形状的唯一纯检查（schema 版本、autonomy、order、wait/risk 字段） | 构造或复制设置后写之前；`decideGoalCopy` 与设置迁移共用 |
| `transitionLinePins` | `src/core/work-graph/state/line-pin-machine.ts:81` | 一次原子增删置顶项；无变化时 effects 为空 | 修改工作线置顶 |
| `deriveLineStatus` | `src/core/work-graph/state/line-status.ts:259` | 唯一的工作线状态派生（词、注意、标记、桶） | 列表、悬停卡、详情 |
| `deriveLineControls` | `src/core/work-graph/state/line-status.ts:485` | 由事实与状态派生可用控制项 | 画工作线操作 |
| `deriveAttentionAll` | `src/core/work-graph/state/line-status.ts:741` | 一条线上所有注意项及来源 | 需要完整注意清单时 |
| `transitionMessage` | `src/core/work-graph/state/message-machine.ts:1348` | SessionMessage 主迁移 | 消息读/回/派生 |
| `createSessionMessageRecord` | `src/core/work-graph/state/message-machine.ts:1512` | 建新消息记录 | 收到用户或系统消息 |
| `nextSessionMessageRecord` | `src/core/work-graph/state/message-machine.ts:1575` | 按变更生成下一条消息记录 | 读、回、绑定答复 |
| `messageConsumptionProblem` | `src/core/work-graph/state/message-machine.ts:1036` | 消息能否被消费的唯一规则：撤回 → `invalid`；`release` 为 awaiting/approved/denied → `busy`；null/released 可消费 | 读正文、读回复、咨询、提交咨询、接续等待之前 |
| `messageFactsOfRecord` | `src/core/work-graph/state/message-machine.ts:1044` | 从消息记录取消费规则的三项事实 | 拿着记录的消费方 |
| `messageFactsOfState` | `src/core/work-graph/state/message-machine.ts:1050` | 从机器状态取同样的三项事实；absent 为 null | `messageSatisfiesWait` 和其它按状态判断的消费方 |
| `noProgressKey` | `src/core/work-graph/state/no-progress.ts:175` | requeue 的无进展键，存进 TaskRequeue.basis | 重排队守卫与比较 |
| `reverifyBasis` | `src/core/work-graph/state/no-progress.ts:206` | successor 轮的重验证键 | VR-14 比较链上 basisDigests |
| `roundFailureFacts` | `src/core/work-graph/state/no-progress.ts:96` | 一轮的非 PASS 检查与 gap codes | 两套键、失败事实读模型 |
| `admitNoteWrite` | `src/core/work-graph/state/note-machine.ts:59` | 新注记的准入状态 | 写注记前 |
| `transitionNote` | `src/core/work-graph/state/note-machine.ts:425` | 注记处置迁移 | 注记状态写入 |
| `newNoteHeadRecord` | `src/core/work-graph/state/note-machine.ts:291` | 建 pending 注记头 | 新建注记 |
| `newNoteVersionRecord` | `src/core/work-graph/state/note-machine.ts:365` | 建注记版本 | 追加注记版本 |
| `userReasonsOf` | `src/core/work-graph/state/note-machine.ts:221` | 由处置关系算用户复查原因 | 注记复查 |
| `secretaryNoteScope`、`SecretaryNoteScopeFactsV1` | `src/core/work-graph/state/note-machine.ts:131`、`src/core/work-graph/state/note-machine.ts:102` | 纯：一轮写入范围的唯一判定——普通注记的范围与 `storedGoalId` 跟本轮冻结的 `effectiveGoalId`（无 Goal 轮只能项目/模块/接口/文件锚点），目标或 stage 理解停在有效 Goal 内，只有被授权的 Goal 理解可用该 Goal 作主锚点，项目理解与修复拒绝；事实形状 `SecretaryNoteScopeFactsV1` | 注记 owner 判定 `query_run` 写入的 `storedGoalId` 与越界拒绝 |
| `secretaryNoteAdmission` | `src/core/work-graph/state/secretary-note.ts:31` | 纯：一轮 Query 的注记准入——没有请求根（普通 Query、副本）是 `none`；秘书请求轮是 `secretary`，写入种类正好是六个通用种类加 `understanding`（`review` 不是写入种类，`repair` 被拒），带 `withdraw: true` 和只含 Goal id 的授权集 | 准备与开始检查都只经这条规则定类；工具声明和注记工具组只消费这个值，调用方不要各自判类 |
| `transitionNoticeSettings` | `src/core/work-graph/state/notice-settings-machine.ts:45` | 通知已读位置迁移；无前进更新则不写记录 | 标记通知已读 |
| `newCandidateProposal` | `src/core/work-graph/state/plan-machine.ts:119` | 建候选计划提案；候选带 `catalogPin`（只在创建时写，不受保护，采用重核不比较） | 提交计划草案 |
| `derivePlanProposalReadVerdict` | `src/core/work-graph/state/plan-machine.ts:186` | 提案的读取结论（含 Goal 状态） | 读计划提案 |
| `derivePlanRevisionStatus` | `src/core/work-graph/state/plan-machine.ts:208` | adopted/superseded 派生，不落库 | 读计划修订 |
| `planRevisionTargetOf` | `src/core/work-graph/state/plan-machine.ts:220` | 由提案与草稿算目标修订 ref | 采纳提案前 |
| `transitionPlanProposal` | `src/core/work-graph/state/plan-machine.ts:1735` | 提案主迁移；采纳与 Goal 指针同一提交 | 计划写入 |
| `planProposalProblem` | `src/core/work-graph/state/plan-machine.ts:872` | 提案事件的前置检查 | 提案迁移前 |
| `draftHasModuleTask` | `src/core/work-graph/state/plan-machine.ts:1543` | 草稿里有 module 作用域的任务（`scope.kind === 'module'`），采用时要读 catalog | 采用 effects 需要决定是否加 catalog guard 时 |
| `newPendingQueryRecords` | `src/core/work-graph/state/query-run-recovery.ts:533` | 建 pending 的 QueryJob/QueryRun 对 | 新 Query 请求 |
| `advanceQueryExecutionRecord` | `src/core/work-graph/state/query-run-recovery.ts:608` | 推进 claimed/prepared/entering/entered | Query 进入执行 |
| `markQueryRunUnknownRecord` | `src/core/work-graph/state/query-run-recovery.ts:681` | 记录 unknown（Job 保持 running） | 结果未知 |
| `settleQueryRunRecord` | `src/core/work-graph/state/query-run-recovery.ts:701` | 一起结清 Job 与 Run；带答案检查的 failed 关闭原因为 `invalid_answer` | Query 终态 |
| `transitionQueryRunRecovery` | `src/core/work-graph/state/query-run-recovery.ts:216` | QRR 恢复子机器；请求轮的 not-entered 按是否被 drop 覆盖分成结束或新 attempt | 启动对账与人工确认 |
| `queryRecoveryStateOf` | `src/core/work-graph/state/query-run-recovery.ts:505` | Job+Run 的恢复机器状态 | 恢复迁移前 |
| `MAX_ATTESTATION_REASON_CHARS` / `QueryAnswerCheck` | `src/core/work-graph/state/query-run-recovery.ts:135`、`src/core/work-graph/state/query-run-recovery.ts:129` | 人工确认理由和关闭消息的上限（2000 个 UTF-16 单位，截断不留半个代理对）；答案检查失败的 detail 与理由 | 校验确认理由、结清带答案检查的终态；`src/core/work-graph/tasks/run-reconcile-service.ts` 只复用这个常量，不另写答案检查类型 |
| `sameRef`（**正本**） | `src/core/work-graph/state/ref-equality.ts:2` | 与键序无关的 ref 结构相等；本层是唯一正本 | 比较 ref；不要再写第二份 |
| `newRequestRound` | `src/core/work-graph/state/request-rounds.ts:63` | 建新请求轮（Job/Run 对），可写入本轮的理解命令 | 收到新请求 |
| `newRoutingRound` | `src/core/work-graph/state/request-rounds.ts:109` | 建只路由、不跑的轮（无 Run）；`routing: null` 的归属臂带 `goalAttribution`，`job.goalId` 与 `job.goalAttribution` 都写该 Goal id，`understanding` 保持 `null` | 秘书分派与 Goal 归属轮；不要另写归属轮 |
| `endUnstartedRound` | `src/core/work-graph/state/request-rounds.ts:154` | 结束未开始的轮 | 未执行即关闭 |
| `newAttempt` | `src/core/work-graph/state/request-rounds.ts:179` | 在同一 Job 上开新 Run | 重试；保留旧 runId/触发身份 |
| `absorbRound` | `src/core/work-graph/state/request-rounds.ts:228` | 把批轮吸收进执行轮 | 合并批处理请求 |
| `recordAbsorbedRounds` | `src/core/work-graph/state/request-rounds.ts:251` | 记录被吸收的批轮（一次一条） | absorb 之后 |
| `setIntake` | `src/core/work-graph/state/request-rounds.ts:263` | 设置/清除 secretary-intake 持有者 | 秘书领取/释放请求 |
| `recordEntered` | `src/core/work-graph/state/request-rounds.ts:272` | 一次性写 enteredSession，第二次换 Session 抛错 | 请求第一次真正进入 |
| `transitionUnderstandingCommand` | `src/core/work-graph/state/request-rounds.ts:290` | 理解命令的唯一合法迁移 `live → closed`、`live → consumed`、`closed → consumed`；已 consumed、回退或 commandId 不符抛错，只改 state/updatedAt、revision+1 | 关闭或消费一条理解命令 |
| `foldUnderstandingCommand` | `src/core/work-graph/state/request-rounds.ts:320` | 把一次理解命令迁移的结果折进另一份 Job 快照：保留该快照的 revision/updatedAt，只取迁移产出的命令；没有命令抛错 | 轮结束提交把消费后的命令并入自己的下一份 Job |
| `UnderstandingOperationFactsV1`、`liveUnderstandingGrants` | `src/core/work-graph/state/request-rounds.ts:360`、`:371` | 冻结材料列表 `[round, ...batch]` 上仍有效授权集的唯一纯规则：命令 live、自身 generation 等于其 operation 当前 generation、requestRoot 是本次请求根且 operation 的 source 仍是 owner；按 Goal 去重、轮次顺序，返回 readonly `GoalRef[]` | 准备读取、启动重核和注记时解析授权集 |
| `currentUnderstandingGeneration` | `src/core/work-graph/state/request-rounds.ts:401` | operation 的当前理解 generation：`progress.understanding` 最大记录，非交接分支或无记录为 `null` | 判命令 generation 前 |
| `leaseReleasedForContinuation` | `src/core/work-graph/state/review-lease.ts:25` | 租约是否由 afterRun 或其复查轮释放 | 续作前置检查 |
| `isUnenteredReviewRoundForCancellation` | `src/core/work-graph/state/review-lease.ts:41` | 可证明未进入 Kernel 的复查 Run | UR3h 取消判定 |
| `reviewRoundEndedKnown` | `src/core/work-graph/state/review-lease.ts:63` | 复查 Run 是否已知结束 | 判断可续作 |
| `newRunRecord` | `src/core/work-graph/state/run-machine.ts:837` | 建 Run 记录 | claim/开跑 |
| `transitionRun` | `src/core/work-graph/state/run-machine.ts:1366` | Run 主迁移，返回整条下一条 Run | 任何 Run 生命周期写入 |
| `runStateOf` | `src/core/work-graph/state/run-machine.ts:148` | Run 快照的机器状态 | Run 迁移前 |
| `messageMachineStateOf` | `src/core/work-graph/state/message-machine.ts:529` | 消息记录的机器状态；缺失为 absent | 消息迁移前 |
| `isPausedInterrupted` | `src/core/work-graph/state/run-machine.ts:208` | 是否 paused/interrupted 的结束 | 重排队与展示 |
| `runUnresolvedBlocker` | `src/core/work-graph/state/run-machine.ts:222` | 未解决工具调用的阻塞原因 | 未知调用审查 |
| `claimHoldGuard` | `src/core/work-graph/state/run-machine.ts:1099` | claim 时 Session/Lease 的持有检查 | claim 提交 |
| `entryPermitGuard` | `src/core/work-graph/state/run-machine.ts:1194` | 进入许可与持久 claim 的一致性检查 | 进入 Kernel 前 |
| `newSessionAnomalyAnchorRecord` | `src/core/work-graph/state/session-anomaly.ts:24` | 建异常锚点（每 Run 至多一个，不可变） | 发现异常时 |
| `transitionSessionAnomaly` | `src/core/work-graph/state/session-anomaly.ts:27` | 异常锚点首次写入迁移 | 记录异常 |
| `deriveSessionAnomalyView` | `src/core/work-graph/state/session-anomaly.ts:55` | 由锚点与后续事实派生异常视图 | 读异常 |
| `createSessionRecord` | `src/core/work-graph/state/session-availability.ts:325` | 建 Session 记录 | 新建 Session |
| `occupySessionRecord` | `src/core/work-graph/state/session-availability.ts:348` | 在下一代 generation 上取得占用 | 运行开始 |
| `releaseSessionRecord` | `src/core/work-graph/state/session-availability.ts:372` | 只释放匹配的 holder/generation | 终态、取消、恢复 |
| `releaseUnenteredQuerySession` | `src/core/work-graph/state/session-availability.ts:405` | 没进 Kernel 就结束的 Query attempt 的 SES-08 释放（drop、`end_unbound`、请求轮新 attempt）：Run 不再持有时返回 null | 请求 owner 的 drop/结束和新 attempt；调用方自己读 Session、加 revision guard、映射拒绝 |
| `transitionSession` | `src/core/work-graph/state/session-availability.ts:604` | Session 主迁移（SES-01..19） | 任何 Session 生命周期写入 |
| `sessionMachineStateOf` | `src/core/work-graph/state/session-availability.ts:289` | Session 记录的机器状态；缺失为 absent | Session 迁移前 |
| `ownsOccupancy` | `src/core/work-graph/state/session-availability.ts:246` | 占用是否正好是该 holder 与该代 | claim、进入、Query、对账 |
| `nextOccupancyGeneration` | `src/core/work-graph/state/session-availability.ts:230` | 下一次占用代数 | 取占用时 |
| `sessionAvailabilityAdmissionProblem` | `src/core/work-graph/state/session-availability.ts:662` | SES-02/SES-03 的共用可用性检查：lifecycle 为 active 且 health 为 available | 占用准入与请求分派共用这条子规则 |
| `occupancyAdmissionProblem` | `src/core/work-graph/state/session-availability.ts:680` | 完整占用准入：lifecycle/health/占用/代/pin | 实际 claim |
| `sessionDispatchAdmissionProblem` | `src/core/work-graph/state/session-availability.ts:515` | 分派准入：归档、只读副本、Work 等待 | 选秘书/分派候选 |
| `transitionResponsibility` | `src/core/work-graph/state/session-responsibility.ts:33` | 责任转移/关闭：关源链接、开目标链接 | 责任交接 |
| `admitHandoff`、`newHandoffOperationRecord` | `src/core/work-graph/state/session-handoff.ts:77`、`:100` | 交接的拒绝顺序（`read: null` 只查前三步）；接受时的记录：revision 1、`accepted`，每个分配和每个任务各一条进度，其余步骤为 `null` | 交接 owner 的接受：读之前先查前三步，命令里带读到的事实再查一遍 |
| `OperationCallerV1`、`OperationSessionFactV1`、`HandoffAdmissionFactsV1`、`SecretaryArchiveAdmissionFactsV1`、`OperationAdmissionV1` | `src/core/work-graph/state/session-handoff.ts:21`、`:23`、`:26`、`:41`、`:49` | 两张准入表的输入和结果：调用者的分类、公开读到的 Session 事实、交接和秘书归档各自的事实、准入结果（`busy` 带未完成操作的 pin） | owner 读完事实后调 `admitHandoff` 或 `admitSecretaryArchive` |
| `admitSecretaryArchive`、`newSecretaryArchiveOperationRecord` | `src/core/work-graph/state/session-handoff.ts:125`、`:138` | 秘书归档的拒绝顺序（人、范围、形状、源、秘书职责、未完成操作）；接受时的记录，每个选择一项，`input.actor` 从可信上下文保存 | 秘书归档 owner 的接受 |
| `saveHandoffCreateInput`、`saveUnderstandingCommand`、`saveArchiveSavedInput`、`saveArchiveReceipt` | `src/core/work-graph/state/session-handoff.ts:194`、`:206`、`:219`、`:228` | 三个保存位置的结构拷贝：后继的 `ensureLine` 输入、某理解代的命令、归档的 `GraphWrite`，以及归档注册返回的 `{identityKey,fingerprint}`；写归档 receipt 前必须先有保存输入 | 推进的 before/after 写；原输入按自己的 generation 重放 |
| `withHandoffProgress`、`coverageHolds` | `src/core/work-graph/state/session-handoff.ts:189`、`:271` | 推进写唯一的 progress 构造；覆盖规则：每个 Goal 的当前理解文字必须由旧 Session 在最后进入并结束的轮写入，无 Goal 不需要覆盖 | 推进的每一步；不要另写 progress 或第二条覆盖规则 |
| `consumeHandoffBrief` | `src/core/work-graph/state/session-handoff.ts:242` | entered 确认的消费迁移：写 `brief.consumedBy`、revision 加 1，并给出 pin 住读到的 revision 的 guard；不写事件 | D 在 entered 提交里合并 record+guard；推进只设 `brief.ready`，从不消费 |
| `briefReady`、`BriefReadyFacts` | `src/core/work-graph/state/session-handoff.ts:277` | 简报就绪：受保护的最终归档提交成功且完整路由集已保存（`closed` 且每根有回执或被明确跳过）；`pending`/`partial` 不是成功 | 推进在归档 after 写里设 `brief.ready`；读取按同一规则判 `waiting` |
| `deriveReworkClass` | `src/core/work-graph/state/task-failure.ts:208` | 失败分类（FC-1..FC-17） | 重排队前 |
| `reworkFenceOf` | `src/core/work-graph/state/task-failure.ts:137` | 人工停止围栏 | 判定谁能重做 |
| `reworkPermission` | `src/core/work-graph/state/task-failure.ts:390` | Goal 活动 + 操作者/失败类别矩阵 | 允许重排队前 |
| `automationVerdict` | `src/core/work-graph/state/task-failure.ts:772` | 按策略给自动化裁决 | 失败后自动处理 |
| `buildTaskFailureFacts` | `src/core/work-graph/state/task-failure.ts:1009` | 组装失败事实读模型 | 展示失败与重做 |
| `runErrorOf` | `src/core/work-graph/state/task-failure.ts:667` | 从终态负载与对账取错误与来源 | 统一错误展示 |
| `taskReworkRefusalEffects` | `src/core/work-graph/state/task-failure.ts:1449` | 拒绝重做的 effects | 拒绝记录同一提交 |
| `controlIntentRecordOf` | `src/core/work-graph/state/control-intent-machine.ts:380` | 由请求与 next 生成意图记录 | 控制提交 |
| `projectTaskPhase` | `src/core/work-graph/state/task-machine.ts:241` | 相位 + 原因的精简投影 | 展示/守卫 |
| `taskMachineStateOf` | `src/core/work-graph/state/task-machine.ts:255` | Task 定义的机器状态 | Task 迁移前 |
| `transitionTask` | `src/core/work-graph/state/task-machine.ts:797` | Task 写入合法性（TASK-01..30） | claim、完成、处置、重排队 |
| `taskRequeueStateProblem` | `src/core/work-graph/state/task-machine.ts:1164` | 当前状态能否重排队 | 重排队前 |
| `newTaskRequeueRecord` | `src/core/work-graph/state/task-machine.ts:711` | 建 TaskRequeue 记录 | 重排队提交 |
| `effectivePlatformDuty` | `src/core/work-graph/state/context-input.ts:609` | 解析有效平台职责 | 判断平台/职责时 |
| `normalizeCommandText` | `src/core/work-graph/state/command-normalization.ts:29` | 规范化命令文本 | 比较/算指纹前 |
| `declaredInputProblem` | `src/core/work-graph/state/context-input.ts:478` | 检查声明输入 | 校验工具/上下文输入时 |
| `observationPairingProblem` | `src/core/work-graph/state/control-intent-machine.ts:294` | 意图与观察的配对检查 | 提交观察结果前 |
| `unreachable` | `src/core/work-graph/state/transition.ts:53` | 穷尽检查的兜底 | switch 的 never 分支 |
| `UNKNOWN_CALL_KIND_TABLE` | `src/core/work-graph/state/unknown-call-kinds.ts:19` | 固定工具种类表，首个匹配生效 | 分类未知调用 |
| `unknownCallKindOf` | `src/core/work-graph/state/unknown-call-kinds.ts:49` | 按 Kernel 工具名取种类，默认值在表里 | 未知调用审查 |
| `newUnknownCallReview` | `src/core/work-graph/state/unknown-call-review.ts:163` | 建 UnknownCallReview | 发现未知调用 |
| `transitionUnknownCallReview` | `src/core/work-graph/state/unknown-call-review.ts:245` | 审查主迁移（UCR-01..15） | 审查写入 |
| `admitUnknownCallReview` | `src/core/work-graph/state/unknown-call-review.ts:217` | 审查准入 | 开审前 |
| `UNKNOWN_CALL_REVIEW_MAX_ROUNDS` | `src/core/work-graph/state/unknown-call-review.ts:39` | 审查最多轮数 | 校验轮数 |
| `transitionRound` | `src/core/work-graph/state/verification-machine.ts:1348` | 验证轮主迁移（VR-01..15） | 轮生命周期写入 |
| `transitionCheck` | `src/core/work-graph/state/verification-machine.ts:1599` | 单项检查迁移 | 检查开始/结果/中断 |
| `buildOpenedRound` | `src/core/work-graph/state/verification-machine.ts:905` | 建已开启的轮 | 开轮提交 |
| `buildSuccessorRound` | `src/core/work-graph/state/verification-machine.ts:629` | 建后继轮 | 重验证 |
| `finalizeRoundOutcome` | `src/core/work-graph/state/verification-machine.ts:802` | 折叠检查并定轮结果 | 轮收尾 |
| `foldVerdictChecks` | `src/core/work-graph/state/verification-machine.ts:782` | 按验证计划折叠检查判定 | 轮收尾/展示 |
| `roundChainHead` | `src/core/work-graph/state/verification-machine.ts:477` | 一轮链的头（最新/最高轮次） | 链相关守卫 |
| `roundTaskSignal` | `src/core/work-graph/state/verification-machine.ts:700` | 轮链给 Task 相位的信号 | Task 相位投影 |
| `reverifyAdmissionProblem` | `src/core/work-graph/state/verification-machine.ts:1409` | 能否开重验证轮 | 重验证前 |
| `reverifyExemption` | `src/core/work-graph/state/verification-machine.ts:550` | 重验证的豁免判定 | 自动重做计数 |
| `roundWriteAdmission` | `src/core/work-graph/state/verification-machine.ts:1074` | 轮写入的通用准入 | 任何轮写入 |
| `taskEvidenceIndexRefOf` | `src/core/work-graph/state/verification-machine.ts:1024` | 轮对应的证据索引 ref | 追加证据 |
| `displayRoundStatus` | `src/core/work-graph/state/verification-machine.ts:430` | 展示用轮状态 | 读模型 |
| `isFinalizedNonPass` | `src/core/work-graph/state/verification-machine.ts:102` | 已定稿且非 PASS | 失败事实/重验证 |
| `copyInterventionCandidateOf`、`CopyInterventionFactsV1` | `src/core/work-graph/state/copy-intervention.ts:16`、`src/core/work-graph/state/copy-intervention.ts:6` | 复制取消的纯候选规则与事实形状：按书的表序（先排除，再投递/未投递）判一条消息是否候选、可选/可撤回及原因；`null` 不是候选 | 分页读可复制干预时；不要另写状态判定 |

## 内部用

本层导出的其余名字（多为机器之间或 owner 内部使用；跨层引用前先看上表，确需复用就补进上表）：

- Attempt/Session：`attemptNodeOf`、`taskLeaseNodeOf`、`leaseHeldByClaim`、`isTaskLeaseEvent`、`ownsQuery`、`deriveAvailability`、`openResponsibleLinkOf`、`archiveSessionRecord`、`reactivateSessionRecord`、`observeSessionHealthRecord`、`bindSessionUnavailableCursor`、`requestSessionArchiveRecord`、`releaseSessionArchiveRequestRecord`、`executorArchiveDue`、`INCONCLUSIVE_PROBES`。
- Goal/Plan：`goalControlTarget`、`nextGoalPointer`、`nextGoalDesiredState`、`buildGoalPhaseSnapshot`、`goalFanOutReason`、`goalResumeContinueRequestId`、`projectGoalRunStop`、`isPendingVerdict`、`isGoalStopCause`、`reduceGoalDisplay`、`buildGoalSettingsRecord`、`goalConflictFacts`、`automationDecisionCause`、`buildWorkspaceDecisionSettingsRecord`、`buildWorkspaceLineSettingsRecord`、`acceptProposalRecord`、`derivePlanProposalStatus`、`samePlanPointer`、`futureChangeTraceProblem`、`tracedDispositionChangeProblem`、`parallelCarrierFactTaskIds`、`parallelCarrierFenceProblem`、`GOAL_CANCELLED_PLAN_DETAIL`、`INITIAL_ADOPTION_STALE_DETAIL`、`SOURCE_PLAN_STALE_DETAIL`、`TARGET_PLAN_NOT_NEW_DETAIL`。
- Control/Message：`desiredStateOfKind`、`controlSubmitProblem`、`observationStatusFor`、`newControlIntentRequest`、`controlIntentRequestOf`、`notEnteredEntryPhase`、`submissionReadsPointerIntent`、`submissionReadsGoal`、`observedIntentAnswer`、`messagePrincipalProblem`、`messageRecipientProjectProblem`、`messagePinProblem`、`messageSendFlagsProblem`、`inputObserverProblem`、`messageSatisfiesWait`、`createSyntheticDecisionAnswerRecord`、`bindMessageResponseCursor`。
- Task/Run：`runNodeOf`、`runControlNodeOf`、`runControlFence`、`leaseOwnedByRun`、`terminalOutcomeOf`、`terminalPayloadOf`、`attestedTerminalPayload`、`RUN_UNRESOLVED_TERMINAL_REASON`、`reviewClaimProblem`、`requeueClaimProblem`、`claimPinProblem`、`reviewBlockerProblem`、`claimBasisProblem`、`entryV2Binding`、`reviewEntryProblem`、`controlSubmissionRunEvent`、`stopRequesterOf`、`isGoalFanOutActor`、`reworkStopOf`、`priorRequeueAutoCount`、`nextRequeueAutoCount`、`permitClaimGuard`、`requeueHistorySourceOf`、`countEndedGoalRuns`、`streakOf`、`previousChainRefOf`、`reworkRefusalIsStale`、`requeueConfirmedByReview`、`REWORK_ACTOR_CLASSES`、`newTaskReworkRefusalRecord`、`newTaskReductionRecord`、`taskClaimProblem`、`taskCompletionRoundProblem`、`taskCompletionFoldProblem`、`taskCompletionProjectionProblem`、`requeueBudgetIncreased`、`requeueBasisCompared`。
- 验证/审查：`roundOrdinalOf`、`rootRoundChain`、`ROUND_SUBJECT_SLOT_PREFIX`、`ROUND_GATE_SLOT_PREFIX`、`roundSlotKey`、`roundSlotSubjectOf`、`roundSlotOwner`、`outcomeFor`、`FROZEN_PERMISSION_CHANGED`、`FROZEN_ROOT_CHANGED`、`FROZEN_SOURCE_CHANGED`、`frozenBindingReason`、`beginRefusalIsPermanent`、`chainEvidenceIds`、`evidenceSupersededByRequeue`、`reverifyFailureClass`、`reverifyExemptionOfFacts`、`successorAutoCount`、`reverifyCapExceeded`、`roundChainFull`、`pendingRoundChecks`、`withCheckPhase`、`buildFinalizedRound`、`nextTaskEvidenceIndex`、`roundReviewerEvidenceProblem`、`roundOpenProblem`、`roundGoalActivityProblem`、`roundSubjectActivityProblem`、`roundActivityProblem`、`roundOpenPointerProblem`、`roundOpenBasisProblem`、`roundOpenSubjectProblem`、`roundOpenChainProblem`、`roundOpenChecksProblem`、`checkEventAdmission`、`frozenBindingProblem`、`reverifyCapRefusal`、`reverifyPolicyRefusal`、`newSessionAnomalyAnchorRecord`、`deriveTaskArchiveState`、`kernelToolNameOf`、`containedByHostStop`、`admitsAutoCleanupTakeover`、`truncateUnknownCallReviewItems`、`lastHolderOf`、`UNKNOWN_CALL_REVIEW_MAX_BYTES`、`UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES`、`UNKNOWN_CALL_REVIEW_MAX_ITEMS`、`UNKNOWN_CALL_DECISION_REASON_ORDER`。
- 其它纯 helper：`commandActionKey`、`COMMAND_RERUN_REQUEST_MAX_FORMS`、`openRequestForAlias`、`contextAssemblyStructureProblem`、`renderedSectionProblem`、`contextGoalContentProblem`、`gateCoveredTaskIds`、`gateFixInProgress`、`pausedAutomationAction`、`cardLineKeys`、`deriveTaskDisplayFacts`、`archivedLineTag`、`lineSortKey`、`keyCheckFacts`、`newBasisInputDigest`、`noteWriteAuthority`、`actualDispositionTargets`、`pendingUnderstandingOverridden`、`noticeClassOf`、`noteBodyOf`、`newCurrentPointerRecord`、`moveCurrentPointerRecord`、`newArchitectureCaptureFailureRecord`、`classifyTaskAttention`、`runFailureOrigin`、`accept`、`reject`、`failed`、`rejected`、`classifyTaskPhase`、`isRunFinished`。

## 不要做

- 不要在服务里 spread 一条 Run/Session/Task 改字段或另写一套迁移；受保护字段写入一律走本层构造器与 `transition*`（M1-05、M1-06）。
- 不要手抄 Session 的 lifecycle/health/occupancy 判定：领用走 `occupancyAdmissionProblem`，只共享 lifecycle/health 的候选筛选走 `sessionAvailabilityAdmissionProblem` 并把 busy 单列（FP-09、M1-04）。
- 不要把 Query 的 claimed/prepared 当成不可达，也不要只结清 Job/Run 的一半（M1-01、M1-36、CS-03）。
- 不要手搓 Attempt/Lease/Outbox，或假设 Run 完成等于 Task/Goal 完成；effects 交 `claimEffectRecords`（`src/core/work-graph/tasks/execution-entry-service.ts:890`）翻译。
- 不要在本层 import 时钟、随机数、计时器、网络、进程或任何 store；时间与 id 由调用方传入。
