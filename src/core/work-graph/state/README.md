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

- `session-availability.ts` — Session 机器：lifecycle × health × occupancy、生命周期记录构造、占用/分派/可用性三类准入。
- `session-responsibility.ts` — Session 责任转移/关闭机器：同一提交游标关闭源链接、打开目标链接。
- `session-anomaly.ts` — Session 异常锚点的构造/迁移/读取与 Task 归档状态派生。
- `request-rounds.ts` — 请求轮构造：新请求、路由轮、未开始结束、新尝试、吸收、intake、entered。
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
- `goal-machine.ts` — Goal 机器：目标状态、计划指针、完成记录；fan-out/resume 身份与展示归约；re-export `GOAL_FAN_OUT_ACTOR`。
- `goal-settings-machine.ts` — Goal 设置机器与启动准入、决策依据匹配、Goal 冲突事实。
- `plan-machine.ts` — PlanProposal 机器与 PlanRevision 派生：candidate→accepted 与 Goal 指针同一提交。
- `verification-machine.ts` — VerificationRound / round-check / TaskEvidenceIndex 机器与链、折叠、重验证、证据索引。
- `decision-policy.ts` — 自主级别动作表、用户消息准入、自动化确认原因、gate 覆盖与修复判定。
- `line-status.ts` — 工作线的纯派生：状态、注意、标记、桶、归档标签、控制项、排序键。
- `line-pin-machine.ts` — Workspace 工作线置顶机器（一次原子增删）。

### 注记/消息/其他生命周期

做注记、消息、通知已读、命令、上下文守卫、未知调用、架构捕获与 ref 比较的去这组。

- `note-machine.ts` — 注记状态机：写入准入、授权、处置目标、版本与现行指针。
- `message-machine.ts` — SessionMessage 机器：pending<read<responded、等待满足与记录构造。
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
| `frozenSectionOrderProblem` | `src/core/work-graph/state/context-input.ts:97` | 检查冻结的段序 | 校验 ContextAssemblyBinding |
| `contextAssemblyProblem` | `src/core/work-graph/state/context-input.ts:285` | G-CTX 总检查：结构、区间、字节、段、来源 | 读取或写入上下文绑定时 |
| `pointerAfterSubmit` | `src/core/work-graph/state/control-intent-machine.ts:185` | 提交后 Run 控制指针的变化 | 与意图同一提交写 Run 指针 |
| `controlSubmissionProblem` | `src/core/work-graph/state/control-intent-machine.ts:230` | 控制提交两机器共用的检查 | 提交 pause/cancel/resume/steer |
| `newQueuedControlIntentRecord` | `src/core/work-graph/state/control-intent-machine.ts:364` | 建 Queued@1 意图记录 | 接受控制请求 |
| `controlIntentStateOf` | `src/core/work-graph/state/control-intent-machine.ts:333` | 意图快照的机器状态 | 迁移前 |
| `transitionControlIntent` | `src/core/work-graph/state/control-intent-machine.ts:886` | 意图主迁移（Queued→Applied/Superseded/OutcomeUnknown） | 控制请求提交与观测 |
| `decisionActionPolicy` | `src/core/work-graph/state/decision-policy.ts:31` | 自主级别 × 动作的唯四值表 | owner、工具、Workflow、路由都查它 |
| `canSendUserMessage` | `src/core/work-graph/state/decision-policy.ts:71` | S5-AU-04 的 notify/decision_request 准入 | 准备向用户发消息 |
| `automationConfirmationCause` | `src/core/work-graph/state/decision-policy.ts:118` | 从策略与已存受影响 refs 派生确认原因 | 需要 automation_confirmation_required 时 |
| `newGoalSnapshot` | `src/core/work-graph/state/goal-machine.ts:93` | 建 Goal 的预绑定快照（`since: null`，创建提交填游标） | 新建 Goal |
| `goalStateOf` | `src/core/work-graph/state/goal-machine.ts:206` | Goal + GoalPhase 的机器状态；保留记录类型，预绑定 Goal 得 pending 状态 | Goal 迁移前 |
| `goalCompletionProblem` | `src/core/work-graph/state/goal-machine.ts:433` | 完成事件的前置检查 | goal_completed 提交 |
| `transitionGoal` | `src/core/work-graph/state/goal-machine.ts:583` | Goal 主迁移：目标状态、计划指针、完成；`goal_created` 的 `next` 是预绑定 Goal | Goal 写入 |
| `goalFanOutRequestId` | `src/core/work-graph/state/goal-machine.ts:628` | 派生 fan-out 请求的稳定 id | pause/cancel/resume 的扇出 |
| `findGoalResumeContinuations` | `src/core/work-graph/state/goal-machine.ts:681` | 从任务事实找 resume 的续作 | 恢复 Goal 后规划续作 |
| `transitionGoalSettings` | `src/core/work-graph/state/goal-settings-machine.ts:190` | Goal 设置迁移（order_set 用已有顺序的下标） | 修改 Goal 设置 |
| `goalStartPolicy` | `src/core/work-graph/state/goal-settings-machine.ts:238` | 启动准入策略 | 自动启动 Goal 前 |
| `goalDecisionBasisMatches` | `src/core/work-graph/state/goal-settings-machine.ts:256` | 决策依据是否仍对应当前 Goal | 复用/重算决策时 |
| `transitionLinePins` | `src/core/work-graph/state/line-pin-machine.ts:85` | 一次原子增删置顶项；无变化时 effects 为空 | 修改工作线置顶 |
| `deriveLineStatus` | `src/core/work-graph/state/line-status.ts:259` | 唯一的工作线状态派生（词、注意、标记、桶） | 列表、悬停卡、详情 |
| `deriveLineControls` | `src/core/work-graph/state/line-status.ts:485` | 由事实与状态派生可用控制项 | 画工作线操作 |
| `deriveAttentionAll` | `src/core/work-graph/state/line-status.ts:741` | 一条线上所有注意项及来源 | 需要完整注意清单时 |
| `transitionMessage` | `src/core/work-graph/state/message-machine.ts:1061` | SessionMessage 主迁移 | 消息读/回/派生 |
| `createSessionMessageRecord` | `src/core/work-graph/state/message-machine.ts:1175` | 建新消息记录 | 收到用户或系统消息 |
| `nextSessionMessageRecord` | `src/core/work-graph/state/message-machine.ts:1218` | 按变更生成下一条消息记录 | 读、回、绑定答复 |
| `noProgressKey` | `src/core/work-graph/state/no-progress.ts:175` | requeue 的无进展键，存进 TaskRequeue.basis | 重排队守卫与比较 |
| `reverifyBasis` | `src/core/work-graph/state/no-progress.ts:206` | successor 轮的重验证键 | VR-14 比较链上 basisDigests |
| `roundFailureFacts` | `src/core/work-graph/state/no-progress.ts:96` | 一轮的非 PASS 检查与 gap codes | 两套键、失败事实读模型 |
| `admitNoteWrite` | `src/core/work-graph/state/note-machine.ts:59` | 新注记的准入状态 | 写注记前 |
| `transitionNote` | `src/core/work-graph/state/note-machine.ts:354` | 注记处置迁移 | 注记状态写入 |
| `newNoteHeadRecord` | `src/core/work-graph/state/note-machine.ts:220` | 建 pending 注记头 | 新建注记 |
| `newNoteVersionRecord` | `src/core/work-graph/state/note-machine.ts:294` | 建注记版本 | 追加注记版本 |
| `userReasonsOf` | `src/core/work-graph/state/note-machine.ts:150` | 由处置关系算用户复查原因 | 注记复查 |
| `transitionNoticeSettings` | `src/core/work-graph/state/notice-settings-machine.ts:45` | 通知已读位置迁移；无前进更新则不写记录 | 标记通知已读 |
| `newCandidateProposal` | `src/core/work-graph/state/plan-machine.ts:115` | 建候选计划提案 | 提交计划草案 |
| `derivePlanProposalReadVerdict` | `src/core/work-graph/state/plan-machine.ts:181` | 提案的读取结论（含 Goal 状态） | 读计划提案 |
| `derivePlanRevisionStatus` | `src/core/work-graph/state/plan-machine.ts:203` | adopted/superseded 派生，不落库 | 读计划修订 |
| `planRevisionTargetOf` | `src/core/work-graph/state/plan-machine.ts:215` | 由提案与草稿算目标修订 ref | 采纳提案前 |
| `transitionPlanProposal` | `src/core/work-graph/state/plan-machine.ts:1691` | 提案主迁移；采纳与 Goal 指针同一提交 | 计划写入 |
| `planProposalProblem` | `src/core/work-graph/state/plan-machine.ts:857` | 提案事件的前置检查 | 提案迁移前 |
| `newPendingQueryRecords` | `src/core/work-graph/state/query-run-recovery.ts:533` | 建 pending 的 QueryJob/QueryRun 对 | 新 Query 请求 |
| `advanceQueryExecutionRecord` | `src/core/work-graph/state/query-run-recovery.ts:608` | 推进 claimed/prepared/entering/entered | Query 进入执行 |
| `markQueryRunUnknownRecord` | `src/core/work-graph/state/query-run-recovery.ts:681` | 记录 unknown（Job 保持 running） | 结果未知 |
| `settleQueryRunRecord` | `src/core/work-graph/state/query-run-recovery.ts:701` | 一起结清 Job 与 Run；带答案检查的 failed 关闭原因为 `invalid_answer` | Query 终态 |
| `transitionQueryRunRecovery` | `src/core/work-graph/state/query-run-recovery.ts:216` | QRR 恢复子机器；请求轮的 not-entered 按是否被 drop 覆盖分成结束或新 attempt | 启动对账与人工确认 |
| `queryRecoveryStateOf` | `src/core/work-graph/state/query-run-recovery.ts:505` | Job+Run 的恢复机器状态 | 恢复迁移前 |
| `MAX_ATTESTATION_REASON_CHARS` / `QueryAnswerCheck` | `src/core/work-graph/state/query-run-recovery.ts:135`、`src/core/work-graph/state/query-run-recovery.ts:129` | 人工确认理由和关闭消息的上限（2000 个 UTF-16 单位，截断不留半个代理对）；答案检查失败的 detail 与理由 | 校验确认理由、结清带答案检查的终态；`src/core/work-graph/tasks/run-reconcile-service.ts:107` 另有私有副本 |
| `sameRef`（**正本**） | `src/core/work-graph/state/ref-equality.ts:2` | 与键序无关的 ref 结构相等；本层是唯一正本 | 比较 ref；不要再写第二份，旧副本见“不要做”（M1-32） |
| `newRequestRound` | `src/core/work-graph/state/request-rounds.ts:58` | 建新请求轮（Job/Run 对） | 收到新请求 |
| `newRoutingRound` | `src/core/work-graph/state/request-rounds.ts:101` | 建只路由、不跑的轮（无 Run） | 秘书分派 |
| `endUnstartedRound` | `src/core/work-graph/state/request-rounds.ts:143` | 结束未开始的轮 | 未执行即关闭 |
| `newAttempt` | `src/core/work-graph/state/request-rounds.ts:168` | 在同一 Job 上开新 Run | 重试；保留旧 runId/触发身份 |
| `absorbRound` | `src/core/work-graph/state/request-rounds.ts:217` | 把批轮吸收进执行轮 | 合并批处理请求 |
| `recordAbsorbedRounds` | `src/core/work-graph/state/request-rounds.ts:240` | 记录被吸收的批轮（一次一条） | absorb 之后 |
| `setIntake` | `src/core/work-graph/state/request-rounds.ts:252` | 设置/清除 secretary-intake 持有者 | 秘书领取/释放请求 |
| `recordEntered` | `src/core/work-graph/state/request-rounds.ts:261` | 一次性写 enteredSession，第二次换 Session 抛错 | 请求第一次真正进入 |
| `leaseReleasedForContinuation` | `src/core/work-graph/state/review-lease.ts:25` | 租约是否由 afterRun 或其复查轮释放 | 续作前置检查 |
| `isUnenteredReviewRoundForCancellation` | `src/core/work-graph/state/review-lease.ts:41` | 可证明未进入 Kernel 的复查 Run | UR3h 取消判定 |
| `reviewRoundEndedKnown` | `src/core/work-graph/state/review-lease.ts:63` | 复查 Run 是否已知结束 | 判断可续作 |
| `newRunRecord` | `src/core/work-graph/state/run-machine.ts:837` | 建 Run 记录 | claim/开跑 |
| `transitionRun` | `src/core/work-graph/state/run-machine.ts:1366` | Run 主迁移，返回整条下一条 Run | 任何 Run 生命周期写入 |
| `runStateOf` | `src/core/work-graph/state/run-machine.ts:148` | Run 快照的机器状态 | Run 迁移前 |
| `messageMachineStateOf` | `src/core/work-graph/state/message-machine.ts:412` | 消息记录的机器状态；缺失为 absent | 消息迁移前 |
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
| `effectivePlatformDuty` | `src/core/work-graph/state/context-input.ts:610` | 解析有效平台职责 | 判断平台/职责时 |
| `normalizeCommandText` | `src/core/work-graph/state/command-normalization.ts:29` | 规范化命令文本 | 比较/算指纹前 |
| `declaredInputProblem` | `src/core/work-graph/state/context-input.ts:479` | 检查声明输入 | 校验工具/上下文输入时 |
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
- 不要手搓 Attempt/Lease/Outbox，或假设 Run 完成等于 Task/Goal 完成；effects 交 `claimEffectRecords`（`src/core/work-graph/tasks/execution-entry-service.ts:892`）翻译。
- `sameRef` 另有旧副本：`src/core/work-graph/tasks/execution-entry-service.ts:144`（导出副本），新代码一律用正本 `src/core/work-graph/state/ref-equality.ts:2`，旧副本由清理轮删除（M1-32）。
- `sameRef` 另有旧副本：`src/core/work-graph/queries/query-execution.ts:104`、`src/core/work-graph/tasks/claim-service.ts:122` 等 `tasks/`、`queries/`、`agent-runtime/` 私有副本，新代码一律用正本 `src/core/work-graph/state/ref-equality.ts:2`，旧副本由清理轮删除（M1-32）。
- `sameJson` 另有旧副本：`src/core/work-graph/state/goal-settings-machine.ts:80`（私有），正本在 `src/contracts/fingerprint.ts:50`，新代码一律用正本，旧副本由清理轮删除（M1-32）。
- 不要在本层 import 时钟、随机数、计时器、网络、进程或任何 store；时间与 id 由调用方传入。
