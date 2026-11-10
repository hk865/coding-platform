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
- `assign-maintainer.ts` — `modules/assign-maintainer` 命令的唯一纯决定 `assignMaintainerDecision`：按目录成员、执行者线、现有维护者三态排序冻结检查，返回打开本线链接、移动既有 owner 的链接或拒绝（含 `already_owner` 带原链接）；入参 `AssignMaintainerFactsV1` 不含 caller，受信证明由 owner 在这些事实之前核对。
- `member-creation.ts` — 记录 1 的 `member_create` 分支：调用者/输入/进度的字段表、跨字段规则 `memberCreateInputProblem`（任务属于调用者的工作区和项目、reason 1..2000 UTF-8 字节）、纯 progress 步骤与阶段迁移 `acceptedMemberCreation`/`advancedMemberCreation`（接已存 action 与事实，返回下一个 action 和 phase，不读时钟），以及 `MemberCreationAccepted`/`MemberCreationDecided`/`MemberCreated` 三个事件的纯体格式；MemberCreated 只留字段表和事件形状，正式 proof 由 `sessions/session-record-codecs.ts` 调 `decisionChangeProofProblem`，Store 信封与 typed 解码也在那里。
- `module-maintainer-assignment.ts` — 记录 1 的 `maintainer_assignment` 分支的纯半边（§3.13）：阶段/回答/裁定三张表、字段表 `MaintainerAssignmentActionShape`（跨字段规则：reason 1..2000 UTF-8 字节）和两个纯步骤 `acceptedMaintainerAssignment`、`advancedMaintainerAssignment`；Store 信封、操作 codec 分支和 `MaintainerAssignmentRecorded` 事件在 `sessions/session-record-codecs.ts`。输入里的调用者只是归属，不是可信命令分支。
- `session-availability.ts` — Session 机器：lifecycle × health × occupancy、生命周期记录构造、占用/分派/可用性三类准入；分派准入把已消费等待按消息、原 Run 与任务三元匹配（`SessionConsumedWaitStateV1`），`intervention` 在旁边运行、不消费等待。参谋/书记线的闲置判定 `roleLineIdleOf` 在 `executorArchiveDue` 旁边：六项事实 `RoleLineIdleFactsV1` 全可读、占用为 `none`、五个布尔都为假才闲置，否则给 `RoleLineIdleReasonV1`（先 `unreadable`，再 `occupied`，`unknown` 占用也算占用，再按五个布尔的顺序）；`pendingDecisionCard`/`lastUnarchivedOfDuty` 不是原因，是回收的排除；执行者的一天归档规则另是一条。
- `role-line-position.ts` — 角色线位置的纯规则：`goalPositionOf`（在推进中的目标、`small` 可共用、每条参谋线最多 `MAX_GOALS_PER_ADVISER` 个按平台计的目标，人指派的不计）、`regionPositionOf`（按最长前缀归属累加 `nonBlankLines`，`≤ REGION_SLOT_LINE_BUDGET` 是一个 region，超过且有子模块就 `descend`；观察缺失/失败/未读完、归属并列、目录缺失或没有 `containment` 字段都是 `unknown`，只有显式 `{parentOf: []}` 才是平的）、书记份额 `SCRIBE_SLOT_NOTE_LIMIT`，以及 `role-lines/read` 原样带出的 `RoleLinePositionV1`；`NoteScopeV1` 从 `contracts/note.ts` 引。不读存储。
- `role-line-split.ts` — 拆线计划 `planRoleLineSplit`：一次严格子范围证明（挪的是本线持有的目标，或本线某个 region 的严格子 region；两边都非空；每个挪走的范围负担已知，参谋看 goal/region 位置、书记看 scribe 位置），返回 `Omit<RoleLineSplitSavedV1, 'source'>` 或 `null`；`move === null` 时由它挑（参谋两个以上目标留第一个挪其余，否则 `descend` 里负担最大的已知子 region，平局取 `moduleId` 小的；书记超过份额时挑计数已知且最大的子模块或目标，平局取范围键小的）。不建模块，不重算 too-long/too-slow。
- `role-line-reclaim.ts` — 保留名额回收的纯半边：`reclaimIdleLineOf`（同职责、`roleLineIdleOf` 闲置、不是该职责最后一条未归档的线、没有待决卡，按 `lastActivityAt` 最早、再按 `sessionId` 选）、回收端口 `RoleLineReclaimPort`（唯一的 `reclaimForAdmission` 声明）与结果 `ReclaimSeatV1`（两个 guard 写成结构类型）、容量 episode 的注入端口 `RoleCapacityPort`（`observeAtCap`、`closeIfStale`）及其结果 `RoleCapacityObservationV1`、`CapacityCloseV1`。没有闲置时钟，回收本身不出卡。
- `goal-adviser-queue.ts` — 项目参谋队列的纯顺序规则（7D2 O4a）：`emptyGoalAdviserQueue`（没有记录时的读值，revision 0 不入库，第一次写得 revision 1）、`queueRankOf`（`suggestedPosition` 从 1 起，夹到 1..length+1，`null` 排最后）、`enqueueGoal`（同名次插在最后一个同名次之后；收待绑定的 `GoalAdviserQueuePendingV1`，新条目的 `enqueuedAt` 是 `null`，由提交游标填）、`reorderGoals`（只收当前目标的全排列，否则 `null`）、`dropGoal`，以及一趟最多提交的分配数 `QUEUE_DRAIN_BATCH`。队列类型是 O1a 的，这里只引用；不读存储、不读钟。
- `session-responsibility.ts` — Session 责任转移/关闭机器：同一提交游标关闭源链接、打开目标链接。
- `role-scope.ts` — 角色范围的纯规则：`regionContains`/`moduleDepth`/`deepestContainingRegion`（从 `notes/scribe-scope.ts` 搬来的唯一副本）、`effectiveRegions`（同职责更深 region 扣除后的生效模块）、`responsibilityClaimChanges`/`foldRoleScopeClaimChanges` 与 `EffectiveScopeReadPort`/`RegionClaimV1`/`EffectiveScopeV1`；不读存储、不写。
- `reanchor.ts` — 责任换挂靠的纯迁移计划 `planReanchor`：逐来源关闭、逐去向 `openDestination`，目标记录/占位/授权/目录/Goal 事实全在输入里，拒绝时 `{ok:false, refusals}` 不给计划；`REANCHOR_REASONS` 是八个原因的运行时列表。
- `role-line-action.ts` — `role_line` 操作分支的纯词表与字段表（D-11 先例 `module-maintainer-assignment.ts`）：七个动作 `ROLE_LINE_ACTIONS`、三个 start_lines 步骤键 `ROLE_LINE_STEP_KEYS`、七个步骤状态 `ROLE_LINE_STEP_STATES`、六个冷启动阶段 `COLD_START_PHASES`、加入三相位 `WORKSPACE_JOIN_PHASES`（冷启动六相的子集）、探索 Query 的 ref 形状 `ColdStartExplorationQueryRefShape`、单个注记版本的字段 `NoteVersionField` 与整臂字段表 `RoleLineActionShape`（必填可空的 `goalRef`、可选的拆线载荷、七个冷启动载荷字段和拆线可选的 `understanding`）；`sessions/session-record-codecs.ts` 用它做唯一的 `checkShape` 臂，`model/session-operation-arms.ts` 只再导出；探索轮的 `explorationGroupsOf` 按 region 分组、`appendExploration` 追加一轮、`setPlannedRounds` 写计划轮数，形状另带可选的 `depth`、`plannedRounds` 和 `followUp`。
- `exploration-control.ts` — 冷启动探索控制的纯 state：人的停止与继续（`holdExploration`/`releaseExploration`，停止原因是 `EXPLORATION_STOP_REASON`）、每轮“只重开一次”的标记 `markRoundReopen`、读探索深度 `explorationDepthOf`（缺省 `DEFAULT_EXPLORATION_DEPTH`）和唯一的计划轮数公式 `plannedExplorationRounds`；不写记录，构造与提交在 `sessions/` 的 owner。
- `exploration-followup.ts` — `exploration_followup` 操作的纯 state：每条公开原因一条派生身份 `explorationFollowUpOperationRef`、新动作 `newExplorationFollowUpAction`、冻结批 ref 的保存 `saveBatchRefs` 与终止标记 `completeFollowup`；不写记录，批和轮的 owner 在 `sessions/`。
- `role-line-operation.ts` — `role_line` 操作的纯步骤机：`START_LINES_PHASES`、`ROLE_LINE_CHANGE_SCOPE_PHASE`、操作身份 `roleLineOperationRef`、子创建命令号 `roleLineChildCommandId`、步骤迁移 `roleLineStepTransition`（`pending→reserved→created→registered→linked→done`，每个非终态都可到 `failed`；`planned` 的拆线在步骤到 `reserved` 的同一次写里把阶段推到 `admitted`，O2B-R1-04）；只 import contracts 和 `role-line-action.ts`。
- `cold-start.ts` — 冷启动操作在 `role_line` 那一臂上的窄视图 `ColdStartActionV1` 和纯的六相位机：派生的操作身份 `coldStartOperationRef`（每个项目一条，按项目派生、不扫）、新动作 `newColdStartAction`、相位核对 `coldStartPhaseProblem`（相位指针是第一个没做完的相位；完成的操作相位留在 `proposals`、`lastCompleted` 也是 `proposals`）、一次推进一个相位 `advanceColdStartPhase`，以及跳过 region 的 `skipRegions`；记录由 `sessions/cold-start-service.ts` 写。
- `workspace-join.ts` — 7D2 XA 的第二个工作区加入动作在 `role_line` 那一臂上的窄视图和纯三相位机：派生身份 `workspaceJoinOperationRef`（每个 `(project, workspace)` 一条，按 id 派生、不扫）、新动作 `newWorkspaceJoinAction`、相位核对 `workspaceJoinPhaseProblem`（`lastCompleted` 必须是前一相，`proposals` 完成时两处都是 `proposals`）、一次推进一相 `advanceWorkspaceJoinPhase`、跳过 region 的 `skipJoinRegions` 和登记出生的记录 `newWorkspaceJoinOperation`；记录由 `sessions/workspace-join-service.ts` 写。
- `role-exploration.ts` — 冷启动探索 Query 的纯部分：唯一的无目标执行臂 `roleExplorationExecution`、“请动手”问句 `roleExplorationQuestion`、Host 系统 `action_request` 的判定 `hostSystemActionRequest`（正本；规划来源和探索消息共用）、注记 owner 核对探索轮可信绑定的 `roleExplorationBindingOf`（线的角色事实来源、冷启动的探索项、Host 系统消息三者对上）。
- `role-line-allocation.ts` — 保留名额记录的唯一初始化器 `allocationNext`：六个分支（reserve/convert/add_holder/cancel_reservation/release_holder/move_holder）各自按对象键幂等，`revision` 递增，新条目的游标为 `null`、搬 holder 保留原 `since`。
- `role-facts.ts` — Session 角色事实记录的唯一构造 `sessionRoleFactsRecord`：由 `SessionRecord`、`roleFactsOf` 已决定的 `creator`/`openedBy` 和创建操作 ref 生成整条 `SessionRoleFactsV1`（`name` 为 null，revision 1）；不读存储、不另判 duty 或只读副本。角色事实记录的 ref 只由 `sessionRoleFactsRef` 构造。
- `role-limits.ts` — 项目额度记录的唯一构造 `projectRoleLimitsNext`：核对 `expectedRevision`，按部分更新合并 `running`/`open`，递增 revision 并返回完整 `ProjectRoleLimitsV1`；`RoleLimitsLevelsV1`、`RoleLimitsChangeV1` 和 `RoleLimitsDecisionV1` 是它的输入/输出形状。降低 `open` 不撤销任何名额。
- `project-notice.ts` — 项目通知的纯决定与身份：`projectNoticeIdentity` 用 subject+kind+operation 的 sha256 作记录 id（也是操作身份），`projectNoticeNext` 取输入的 subject（Goal 或项目，没给时是项目）并检查 summary 1..512 UTF-8 字节、kind 合法与 operation 属于本项目（拒绝 `invalid`），`projectNoticePending`/`projectNoticeBound` 写待提交与已绑定 `since` 的记录。
- `session-handoff-contracts.ts` — 交接座位的纯规则：`residualResponsibilityOf`（先复用 `openResponsibleLinkOf` 判 task/work，再记住 scope）与 `seatInheritanceOf`（固定拒绝顺序 `no_parent`/`not_our_parent`/`other_duty`/`not_first_create`/`not_full`；`other_duty` 先比原始固定职责，不按角色线类别互借，满时借座）。
- `session-archive-release.ts` — 归档释放的纯计划 `planArchiveRelease` 与 `openScopeLinkOf`：关闭开着的 goal/project（以及参谋/书记的 module）负责链接、释放 claim、移动或释放 holder；职责读不到时 `unavailable`，纯任务且无 allocation 时给空计划。
- `session-handoff.ts` — 交接操作和秘书归档操作的纯准入（拒绝顺序：调用者、范围、形状、源和目标、职责（existing 目标同职责，create 目标带自己的职责）、未完成操作）与接受时的记录构造；两个分支的 `progress` 只在这里写，包含三个保存位置（`createInput`、`understanding[].command`、`archiveRequest.savedInput`）、推进用的 `withHandoffProgress`、纯覆盖规则 `coverageHolds`、简报就绪规则 `briefReady` 和 entered 确认的 `consumeHandoffBrief`。
- `work-handoff-brief.ts` — 工作线交接简报（记录 5）的纯 state 半边：字段表 `WORK_HANDOFF_BRIEF_SCHEMA_ID`/`WORK_HANDOFF_BRIEF_FIELDS`、两个事件类型与格式 `WORK_HANDOFF_BRIEF_RECORDED_EVENT_TYPE`/`WORK_HANDOFF_BRIEF_CONSUMED_EVENT_TYPE`/`WORK_HANDOFF_BRIEF_RECORDED_FORMAT`/`WORK_HANDOFF_BRIEF_CONSUMED_FORMAT`、按 Session 的查找 `WORK_HANDOFF_BRIEF_BY_SESSION_LOOKUP`、绑定规则 `workHandoffBriefBindingProblem`、记录格式 `WORK_HANDOFF_BRIEF_FORMAT`、传输完成 `workHandoffBriefTransferComplete` 与消费贡献 `workHandoffBriefConsumption`（`consumedBy` 是 `ExecutionRef`：Work Run 或 QueryRun，消费贡献接受 `ExecutionRef`）；就绪不是字段：交接要等责任转移完成，拆线的记录 5 写在拆线做完的那次提交里，读到就是就绪；Store 信封与 `HANDOFF_BRIEF_RECORD_SCHEMAS` 注册在 `sessions/session-record-codecs.ts`。
- `session-anomaly.ts` — Session 异常锚点的构造/迁移/读取与 Task 归档状态派生。
- `request-rounds.ts` — 请求轮构造：新请求、路由轮（普通路由与 `routing: null` 的归属臂）、未开始结束、新尝试、吸收、intake、entered；归属臂把 `goalAttribution.goalId` 同时写进 `job.goalId` 与 `job.goalAttribution`（下游按字符串比较），`understanding` 保持 `null`，普通路由臂不变；理解命令的合法状态迁移 `live → closed|consumed`、当前 generation 读取，以及冻结材料列表上仍有效授权集的唯一纯规则（每条命令按自己的 operation 判 generation/state/root owner，按 Goal 去重并保持轮次顺序）。
- `review-lease.ts` — 复查租约释放、可证明未进入的复查取消、复查轮已知结束。
- `control-intent-machine.ts` — ControlIntent 机器：一次暂停/取消/恢复/steer 请求的归宿，以及提交前检查。

### Run/Attempt/Query

做 Run、Attempt/Lease/Outbox、Query 生命周期、活动替换与无进展判定的去这组。

- `run-machine.ts` — Run 机器：status/outcome、V2 入口相位、控制指针；每次写入整条 Run。
- `attempt-machine.ts` — TaskAttempt / TaskLease / DispatchOutboxEntry 三部机器与 Run 事件映射；与 Run 事件同一提交。outbox 记录 `DispatchOutboxRecord` 和 `DispatchStateV1` 的正本在 `contracts/execution-read.ts`，这里转出。
- `query-run-recovery.ts` — QueryRun/QueryJob 生命周期构造与恢复：claimed/prepared/entering/entered/unknown/settled。
- `running-admission.ts` — 运行中并发的纯规则：`runningGroupOf` 是五职责到四组的唯一映射（reviewer → executor，没有职责依据的 `unknown` 也按 executor 计）；`countsRunningAdmission`/`emptyRunningCounts`/`countRunningAdmission` 只算 entering/entered/unknown 且每个占用 Session 一次；`admitModelCall` 是唯一判定；不读存储、不保存计数。
- `transition.ts` — 所有机器共用的 `Transition` 形状与 accept/reject 构造。
- `no-progress.ts` — 无进展/重验证键与失败事实；requeue 与 successor 两套键，互不比较。
- `activity-replacement.ts` — L4 唯一的活动替换判定（created/replaced/unchanged），回填与 Run 结束提交共用。

### Task/Goal/Plan 与工作线

做 Task/Goal/Plan、验证轮、决策策略与工作线派生的去这组。

- `task-machine.ts` — Task 机器：相位投影（P1..P20）与写入合法性（TASK-01..30）、缩减/重排队记录。
- `task-failure.ts` — Task 失败事实：失败分类、重做权限与围栏、自动化裁决、refusal 记录、`modelServiceOf` 与 `permissionInterruptionOf`。
- `goal-confirm.ts` — `goals/confirm-draft` 的纯规则：`decideGoalConfirm` 的拒绝顺序（不是最新已答轮 → `revision_conflict`；草稿下标越界 → `invalid`；同一 `(answerRef, draftIndex)` 已确认 → `revision_conflict`）、确认后的 objective 文本 `confirmObjectiveText`（正文与每条完成标准都经 `normalizeObjective`），以及不可变 `InitializationBinding@1` 的唯一构造 `newInitializationBinding`（ref 指 answer+draft，revision 与 goalRevision 都是 1，顺序和重复原样保留）。无 I/O、无时钟、无 id；服务只编码它并放进自己的一次提交。
- `goal-copy.ts` — 复制的纯决定：只有 `cancelled` 源可复制；确认带回 `expectedSourceRevision` 时先核对源 revision；勾选的干预必须是 owner 读到的、可选的候选，同一 ref 勾选两次被 `invalid` 拒绝（6B 没有读端口时候选集为空，非空勾选被拒而不是被信任）；出生设置保留源的 autonomy 与 order、清空「等前一个」和并行风险，再由 `isLegalSettings` 查形状；决定给出 `continuedFrom`、`copiedInterventions`（勾中的候选 ref，按勾选顺序）、`retract`（未勾中的候选 ref，按候选顺序）与 `selection`（`retract` 非空即 `retraction_pending`）。`planReanchorHook` 包 7D1 的 `planReanchor`，复制的出生提交按职责各调一次（入参、结果是 `PlanReanchorHookInputV1`、`PlanReanchorHookResultV1`）。
- `goal-machine.ts` — Goal 机器：目标状态、计划指针、完成记录；fan-out/resume 身份与展示归约；re-export `GOAL_FAN_OUT_ACTOR`。
- `goal-settings-machine.ts` — Goal 设置机器与启动准入、决策依据匹配、Goal 冲突事实（模块说法按模块比，文件只按同一路径比）。
- `plan-machine.ts` — PlanProposal 机器与 PlanRevision 派生：candidate→accepted 与 Goal 指针同一提交；候选与提案事件带必填可空的 `sourceMessageRef`（干预消息，其他写者为 `null`）。
- `architecture-proposal-machine.ts` — `ArchitectureProposal` 状态机：写入时 `pending`，之后只改 `state`（`pending → applied | rejected | stale`）与一次进入冻结批的 `batchRef`；内容（pin/ops/moves/reason/proposer/operation ref）不可变，`ARCHITECTURE_PROPOSAL_STATES` 是闭集，`newArchitectureProposalRecord`/`transitionArchitectureProposal` 只复制记录并改 revision/state/batchRef；无存储、时钟或 id。
- `plan-candidate.ts` — 计划候选的纯决定与机械诊断（§6.1.3、§6.2）：`decidePlanCandidate` 按审阅/修复读与采用策略给出请求审阅、请求修复、采用、出卡或等待（首次匹配即返回，不读存储）；`diagnosePlanCandidate` 用验证计划编译器的同一份 `compileVerificationCoverage` 逐条报 `no_registered_check`/`reviewer_not_supported`，`checks: null` 是覆盖未知、永不采用，`checks: []` 是已配置但没有注册检查。
- `verification-machine.ts` — VerificationRound / round-check / TaskEvidenceIndex 机器与链、折叠、重验证、证据索引。
- `autonomy-rules.ts` — 自主规则的纯半边：`validateAutonomyRule`（唯一校验：先查 actions/scope 是数组、limits/limits.open 是对象，再查 actions 非空且都是 `RuleActionV1`（否则 `invalid/rule_action_fixed`）、scope 非空、每职责上限不超过项目 `open` 上限（否则 `invalid/rule_limit_over_cap`）、`expiresAt` 是 ISO 时间或 null）、`matchAutonomyRule`（active、未到期、动作在列、每个责任对象在规则 scope 和调用方责任上限内、工具与建成员授权、动作之后的计数不超过规则的每职责上限）、`nextAutonomyRuleSetRevision`；记录与 codec 在 contracts 和 sessions，三个写命令在 `tasks/autonomy-rule-service.ts`。
- `role-capacity-episode.ts` — 容量 episode 的三个纯函数：`nextCapacityEpisode`（同一项目同一职责的下一个编号）、`capacityEpisodeCloses`（回到上限以下，或上限变了就关）、`closeCapacityEpisode`（revision 加一、写 `closedAt`）；记录格式是 contracts 的 `RoleCapacityEpisodeFormat`。
- `decision-policy.ts` — 五层动作策略 `decisionActionPolicy`（`DecisionPolicyInputV1` 只在旧入参上做加法，结果是 `DecisionPolicyVerdictV1`）：总是问你的九个动作 → 同一动作已有待答卡 → 匹配到的自主规则（`automatic_notice`）→ 出厂默认（四个角色线动作与 `create_member`/`short_change_duty` 有一个受影响目标是每步问就出卡，否则人做直接做、别的调用方发通知；`module_maintainer` 照旧；其余旧动作照旧表）→ 越界出卡；另有用户消息准入、自动化确认原因、gate 覆盖与修复判定。
- `line-status.ts` — 工作线的纯派生：状态、注意、标记、桶、归档标签、控制项、排序键；线的 `wait` 取最早未消费等待的状态，决定“等回复”（open/answered）与已消费标记（consumed）；待命原因多一个 `unassigned`（链上没有开着的负责链接），行带名额等待 `runningCap`。
- `line-pin-machine.ts` — Workspace 工作线置顶机器（一次原子增删）。
- `initialization-adoption.ts` — 初始化采用操作的纯记录表：出生 `newInitializationAdoptionRecord`、既有操作的再次接受 `acceptExistingInitializationAdoption`、写入前标记 `nextAdoptionStage`，以及三个后写 `advanceInitializationAdoption`/`stopInitializationAdoption`/`completeInitializationAdoption`，再加供服务重建已提交记录的纯投影 `committedAdoptionRecord`（前缀、before/stopped 标记与 `record.result` 只在这里形成；不读时钟、不生成 id、不碰存储）。

### 注记/消息/其他生命周期

做注记、消息、通知已读、命令、上下文守卫、未知调用、架构捕获与 ref 比较的去这组。

- `note-machine.ts` — 注记状态机：写入准入、授权、处置目标、版本与现行指针；纯 `secretaryNoteScope`（普通注记取本轮冻结的有效 Goal，目标或 stage 理解停在有效 Goal 内，只有授权的 Goal 理解可用该 Goal 作主锚点，项目理解与修复拒绝）。
- `secretary-note.ts` — 纯的 Query 注记准入（`secretaryNoteAdmission`，`src/core/work-graph/state/secretary-note.ts:41`）：只有请求轮（有冻结的请求根）是秘书轮，给六个通用写入种类加 `understanding`、`link`、`flow`、`withdraw: true` 和被授权的 Goal id；普通 Query 与副本得到 `none`。`QueryNoteAdmissionV1` 唯一的声明在本文件，消费方经 `model/secretary-note-contracts.ts` 的再导出引用。
- `message-machine.ts` — SessionMessage 机器：pending<read<responded、等待满足与记录构造；7A-1 的投递与证据值、秘书轮发送方记录、拒绝回复、四个生命周期变更与事件类型（M-1 已激活）；7B-1：等待事实 `waitFactsOfRecord` 与完整的接续判定 `messageSatisfiesWait`、唯一的到期决定 `decideExpiry`（含 `ExpirySkipReason`）、到期状态字段 `expiredAt`、事件 `MessageExpiredEventV1`/`SessionMessageEventType` 的 `SessionMessageExpired`、变更 `MessageExpiredChangeV1` 与迁移 `onExpired`；等待状态和投递资格（纯规则）。持久消息记录 `SessionMessageRecord` 和它的发送方、回复、投递值、已接受输入、派生等小类型的正本在 `contracts/mailbox.ts`，这里转出。
- `copy-intervention.ts` — 复制取消的纯候选规则：`copyInterventionCandidateOf` 按书的表序（先两项排除，再投递/未投递）判一条消息是不是候选、可选/可撤回及原因；事实形状 `CopyInterventionFactsV1`，不读存储、不写、无游标。
- `goal-interruption.ts` — 目标中断记录的地址 `interruptionRefOf`（每个目标一条）和两个纯迁移：`pendingGoalInterruption`（缺失/`resumed` → revision+1 的 `pending`，已 `pending` → null 保留）与 `resumedGoalInterruption`（`pending` → `resumed`，缺失/已 `resumed` → null）；返回记录与 `expectedRevision`，不构造 guard。
- `dispatch-counter.ts` — 派工计数器的纯构造：`firstDispatch` 从缺失生成 sequence/revision 1，`nextDispatch` 递增两者；返回记录与 `expectedRevision`，不构造 RecordStore guard。
- `notice-settings-machine.ts` — Workspace 通知已读位置机器。
- `command-rerun-request.ts` — `CommandRerunRequest` 机器与“同一别名只开一个请求”的 helper。
- `rework-request.ts` — `ReworkRequest`（record 3）的唯一字段表与格式：`REWORK_REQUEST_FIELDS`/`REWORK_REQUEST_FORMAT`（`REWORK_REQUEST_ACTOR_FIELDS`/`REWORK_REQUEST_OUTCOME_FIELDS` 是与事件共用的两个子表），`rework-request-by-goal` 只有三个等值键（不含 `state`）并按 `since` 排序；`newReworkRequest` 返回未绑定 `since` 的 pending 记录，`applyReworkRequest`/`closeReworkRequestRecord` 产出下一版 pending 记录（revision、state、outcome、closedBy），`since` 只由提交的 `commitCursorBindings` 绑定。输入类型从字段表派生，本文件不 import `model/`，两个 owner 的 `RequeueTaskInput`/`ReverifyRoundInput` 留在调用侧。
- `command-normalization.ts` — 命令文本规范化、sha256、action key 与 shell 动作解析（纯）。
- `context-input.ts` — 上下文/声明输入的纯守卫：冻结段序、结构、渲染区间、字节数、Goal 段、平台职责；`secretary` 调用必须有 `goal` 和 `task` 两段（没有目标时 `goal` 段照旧渲染 Workspace、目标列表和 `secretary.noGoal`）。
- `unknown-call-kinds.ts` — 固定工具种类表（自上而下首个匹配）与主机停止/清理接管判定；7C-1 的平台写工具行加入 `create_member`、`request_rework`、`request_recheck` 与 `withdraw_session_message`；只读行加入 `check_links`（只读，不查提交回执）。
- `unknown-call-review.ts` — UnknownCallReview 聚合机器：创建、截断、准入、迁移与上限常量。
- `architecture-capture.ts` — `ArchitectureAutoCapture@1` 的唯一写入：捕获请求、当前状态、失败记录。
- `ref-equality.ts` — 与键序无关的 ref 结构相等；`sameRef` 的唯一正本。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `firstDispatch`、`nextDispatch`、`DispatchCounterWriteV1` | `src/core/work-graph/state/dispatch-counter.ts:10`、`src/core/work-graph/state/dispatch-counter.ts:28`、`src/core/work-graph/state/dispatch-counter.ts:4` | 首次与后续派工的计数器记录和版本期待 | 发送 owner 在同一次提交中写计数器并构造 guard 时 |
| `interruptionRefOf`、`pendingGoalInterruption`、`resumedGoalInterruption`、`GoalInterruptionWriteV1` | `src/core/work-graph/state/goal-interruption.ts:9`、`src/core/work-graph/state/goal-interruption.ts:22`、`src/core/work-graph/state/goal-interruption.ts:38`、`src/core/work-graph/state/goal-interruption.ts:9` | 目标中断记录的地址，pending/resumed 迁移与版本期待（已 pending 保留、已 resumed 不再写） | 启动对账记录候选、驱动开始时结清、显示读记录时；不要另写记录地址，不要绕过状态层写记录 |
| `projectNoticeIdentity`、`projectNoticeNext`、`projectNoticePending`、`projectNoticeBound` | `src/core/work-graph/state/project-notice.ts:65`、`:37`、`:61`、`:65` | 项目通知的操作身份/记录 id、写入前的决定、待提交记录与回执游标绑定后的投影 | 项目通知写入与来源读取；不要另写身份、校验或字段 |
| `decideActivityOutcome` | `src/core/work-graph/state/activity-replacement.ts:23` | 按 L4 判定本次活动写是 created/replaced/unchanged | 回填或 Run 结束要写 Run.activity 时 |
| `MemberCreateActionShape`、`memberCreateInputProblem` | `src/core/work-graph/state/member-creation.ts:101`、`:99` | `member_create` 的字段表与跨字段规则（任务/调用者在同一项目、reason 1..2000 UTF-8 字节，`done` 必须有 outcome） | 编解码 member 操作、建事件、M-records 的纯规则行 |
| `MEMBER_CREATION_STAGES`、`MEMBER_CREATION_ANSWERS`、`MEMBER_CREATION_VERDICTS`、`memberCreationAcceptedEventFormat`、`memberCreationDecidedEventFormat`、`memberCreatedEventFormat`、`checkMemberCreatedEventBody` | `src/core/work-graph/state/member-creation.ts:365`、`:37`、`:39`、`:283`、`:303`、`:341`、`:366` | 成员创建的固定阶段/答复/判定值，以及三个事件的纯体格式与 Created 的字段/形状校验（正式 proof 在 sessions 层） | 建成员事件、校验成员进度与答复时 |
| `assignMaintainerDecision`、`AssignMaintainerFactsV1` | `src/core/work-graph/state/assign-maintainer.ts:37`、`:17` | 维护者指定的纯决定：模块不在目录 → `not_found`；目标不是 active 执行者线 → `invalid`；无维护者 → 打开本线链接；已有别的 owner → 一次提交关闭旧链接并打开新链接；同一 owner → `already_owner` 带原链接 | 维护者命令 owner 在读完目录/职责/维护者之后调用；不要另写检查顺序 |
| `MemberCreationStepV1`、`acceptedMemberCreation`、`advancedMemberCreation` | `src/core/work-graph/state/member-creation.ts:209`、`:190`、`:207` | 成员创建的纯 progress 步骤与阶段迁移：接已存 action 和事实，返回下一个 action 与 phase；revision/时刻/编码/提交由 `tasks/member-service.ts` 写 | 写 accepted、决定、建线、拒绝或恢复进度时；不要另写阶段或 phase 判断 |
| `MAINTAINER_ASSIGNMENT_STAGES`、`MAINTAINER_ASSIGNMENT_ANSWERS`、`MAINTAINER_ASSIGNMENT_VERDICTS`、`MaintainerAssignmentActionShape` | `src/core/work-graph/state/module-maintainer-assignment.ts:74`、`:24`、`:26`、`:74` | `maintainer_assignment` 的三张表（五个阶段、人的 `approve`/`reject`、`automatic`/`needs_decision`）与字段表（reason 1..2000 UTF-8 字节） | 操作 codec 分支与维护者 owner；不要另写 |
| `MaintainerAssignmentStepV1`、`acceptedMaintainerAssignment`、`advancedMaintainerAssignment` | `src/core/work-graph/state/module-maintainer-assignment.ts:138`、`:121`、`:138` | 维护者操作的纯 progress 步骤与阶段迁移：接已存 action 和 phase，返回下一对；revision 和时间由写入者加 | 维护者 owner 写每一步；调用者不自定阶段、phase 或结果 |
| `ROLE_LINE_ACTIONS`、`ROLE_LINE_STEP_KEYS`、`ROLE_LINE_STEP_STATES`、`COLD_START_PHASES`、`ColdStartExplorationQueryRefShape`、`NoteVersionField`、`RoleLineActionShape` | `src/core/work-graph/state/role-line-action.ts:17`、`:18`、`:19`、`:22`、`:28`、`:53`、`:54` | `role_line` 分支的词表（七个动作、三个步骤键、七个步骤状态、六个冷启动阶段）、探索 Query 的 ref 形状、单个注记版本的字段和整臂字段表 | `sessions/session-record-codecs.ts` 的 `checkShape` 臂；`model/session-operation-arms.ts` 只再导出；不要另写第二份 |
| `roleLineOperationRef`、`roleLineChildCommandId`、`roleLineStepTransition`、`START_LINES_PHASES`、`ROLE_LINE_CHANGE_SCOPE_PHASE` | `src/core/work-graph/state/role-line-operation.ts:12`、`:22`、`:27`、`:11`、`:12` | `role_line` 操作的身份、子创建命令号、唯一的步骤迁移表和两组阶段名 | `sessions/role-line-operations.ts` 写步骤、`sessions/session-directory.ts` 的准入写 `reserved`；不要另写步骤表 |
| `newArchitectureCaptureRequestRecord` | `src/core/work-graph/state/architecture-capture.ts:37` | 建 status=requested 的捕获请求记录（revision/requestSeq 递增） | 接受一次自动捕获触发时 |
| `architectureAutoCaptureState` | `src/core/work-graph/state/architecture-capture.ts:56` | 自动捕获的公开投影，pending 由 satisfiedRequestSeq 算出 | 判断是否该触发捕获 |
| `attemptEventFromRunEvent` | `src/core/work-graph/state/attempt-machine.ts:211` | Run 事件映射为 Attempt 事件；null 表示三记录都不写 | Run 事件提交里同步 Attempt/Lease/Outbox |
| `newTaskAttemptRecord` | `src/core/work-graph/state/attempt-machine.ts:250` | ATT-01 的 claimed@1，可带 requeueRef | claim 提交 |
| `newTaskLeaseRecord` | `src/core/work-graph/state/attempt-machine.ts:257` | ATT-14 的 held@1，不靠 expiresAt 释放 | claim 提交 |
| `newDispatchOutboxRecord` | `src/core/work-graph/state/attempt-machine.ts:265` | ATT-24 的 pending@1，保留不可变 claim | claim 提交 |
| `transitionAttempt` | `src/core/work-graph/state/attempt-machine.ts:507` | TaskAttempt 的 ATT-01..13 迁移 | Run 事件同一提交 |
| `transitionTaskLease` | `src/core/work-graph/state/attempt-machine.ts:691` | TaskLease 的持有/释放迁移 | release_lease、Attempt 结束时 |
| `transitionDispatchOutbox` | `src/core/work-graph/state/attempt-machine.ts:792` | DispatchOutboxEntry 迁移 | Run 事件同一提交 |
| `commandSha256` | `src/core/work-graph/state/command-normalization.ts:34` | 命令摘要，走 contracts 的 sha256 | 记录/比较命令指纹 |
| `parseShellActionsDetailed` | `src/core/work-graph/state/command-normalization.ts:522` | 解析一条命令里的 shell 动作，保留词边界 | 命令分类、重跑与审查 |
| `newCommandRerunRequest` | `src/core/work-graph/state/command-rerun-request.ts:78` | 建 CommandRerunRequest 记录 | 收到一次重跑请求 |
| `transitionCommandRerunRequest` | `src/core/work-graph/state/command-rerun-request.ts:109` | 重跑请求迁移，含同身份同指纹重放 | 处理/重放重跑请求 |
| `frozenSectionOrderProblem` | `src/core/work-graph/state/context-input.ts:98` | 检查冻结的段序 | 校验 ContextAssemblyBinding |
| `contextAssemblyProblem` | `src/core/work-graph/state/context-input.ts:286` | G-CTX 总检查：结构、区间、字节、段、来源 | 读取或写入上下文绑定时 |
| `pointerAfterSubmit` | `src/core/work-graph/state/control-intent-machine.ts:185` | 提交后 Run 控制指针的变化 | 与意图同一提交写 Run 指针 |
| `controlSubmissionProblem` | `src/core/work-graph/state/control-intent-machine.ts:230` | 控制提交两机器共用的检查 | 提交 pause/cancel/resume/steer |
| `newQueuedControlIntentRecord` | `src/core/work-graph/state/control-intent-machine.ts:364` | 建 Queued@1 意图记录 | 接受控制请求 |
| `controlIntentStateOf` | `src/core/work-graph/state/control-intent-machine.ts:333` | 意图快照的机器状态 | 迁移前 |
| `transitionControlIntent` | `src/core/work-graph/state/control-intent-machine.ts:886` | 意图主迁移（Queued→Applied/Superseded/OutcomeUnknown） | 控制请求提交与观测 |
| `decisionActionPolicy`、`DecisionPolicyInputV1`、`DecisionPolicyVerdictV1` | `src/core/work-graph/state/decision-policy.ts:60`、`:35`、`:34` | 五层策略的唯四值表：总是问你 → 已有待答卡 → 匹配的规则 → 出厂默认（按受影响目标的档位） → 越界出卡；旧调用方的旧入参照收 | owner、工具、Workflow、路由都查它；平台的调用写 `actorClass: 'system'` |
| `canSendUserMessage` | `src/core/work-graph/state/decision-policy.ts:140` | S5-AU-04 的 notify/decision_request 准入 | 准备向用户发消息 |
| `automationConfirmationCause` | `src/core/work-graph/state/decision-policy.ts:187` | 从策略与已存受影响 refs 派生确认原因 | 需要 automation_confirmation_required 时 |
| `validateAutonomyRule`、`AutonomyRuleLimitsV1`、`matchAutonomyRule`、`nextAutonomyRuleSetRevision` | `src/core/work-graph/state/autonomy-rules.ts:104`、`:18`、`:73`、`:104` | 自主规则的唯一校验（两个具名拒绝 `rule_action_fixed`、`rule_limit_over_cap`）、唯一匹配（委托的 `writeScope` 是路径表，不当责任范围比）和规则集的下一个 revision | 规则服务的三个写与策略入口匹配规则时；不要另写校验或匹配 |
| `nextCapacityEpisode`、`capacityEpisodeCloses`、`closeCapacityEpisode` | `src/core/work-graph/state/role-capacity-episode.ts:20`、`:15`、`:20` | 容量 episode 的编号、关闭判定与关闭后的记录 | 容量服务开、关 episode 时；不要另算编号或关闭条件 |
| `decideGoalCopy`、`DecideGoalCopy` | `src/core/work-graph/state/goal-copy.ts:30` | 复制的唯一纯决定：源必须 `cancelled`；`revision_conflict`/`invalid` 的拒绝文案都出自这里，同一 ref 勾选两次也是 `invalid`；产出新 Goal 的 `objective`、`settings`、`continuedFrom`、`copiedInterventions`（勾中的候选 ref，按勾选顺序）、`retract`（未勾中的候选 ref，按候选顺序）与 `selection`（`selection_only`/`retraction_pending`，`retract` 非空即后者） | 复制确认在提交前判；不要在服务里另判源状态、revision 或勾选 |
| `planReanchorHook`、`PlanReanchorHookInputV1`、`PlanReanchorHookResultV1` | `src/core/work-graph/state/goal-copy.ts:18`、`:12`、`:13` | 包 7D1 的 `planReanchor`，复制的出生提交按职责各调一次：把源目标参谋/书记的负责关系挪到新 Goal；纯函数，不写事实、不给回执 | 复制的出生提交里迁参谋和书记；不要另开一条迁移路径 |
| `newGoalSnapshot` | `src/core/work-graph/state/goal-machine.ts:97` | 建 Goal 的预绑定快照（`since: null`，创建提交填游标）；出生即带 `settings`、`continuedFrom`、`copiedInterventions` | 新建 Goal |
| `decideGoalConfirm` | `src/core/work-graph/state/goal-confirm.ts:32` | confirm-draft 的唯一纯决定：拒绝顺序、草稿、objective、出生设置与 order | 确认草稿前；不要另写拒绝顺序 |
| `confirmObjectiveText` | `src/core/work-graph/state/goal-confirm.ts:21` | 确认后的 objective：正文 + 空行 + `完成标准：` + 每条 `- ` 完成标准，两段都规范化 | 建确认 Goal 的 objective |
| `newInitializationBinding` | `src/core/work-graph/state/goal-confirm.ts:60` | 不可变 `InitializationBinding@1` 的唯一构造：ref、answerRef、digest、requestRef、draftIndex、goalRef、screening | 确认提交；服务只编码，不自己构造 |
| `goalWithObjective` | `src/core/work-graph/state/goal-machine.ts:124` | 纯函数：只把候选带来的新目标说明写进 Goal 快照的 `objective`，不 bump revision；随后仍由 `nextGoalPointer` 移指针并 bump 一次 | 人采用带 `reason.objective` 的候选时，与计划指针同一次提交 |
| `goalStateOf` | `src/core/work-graph/state/goal-machine.ts:228` | Goal + GoalPhase 的机器状态；保留记录类型，预绑定 Goal 得 pending 状态 | Goal 迁移前 |
| `goalCompletionProblem` | `src/core/work-graph/state/goal-machine.ts:462` | 完成事件的前置检查 | goal_completed 提交 |
| `transitionGoal` | `src/core/work-graph/state/goal-machine.ts:601` | Goal 主迁移：目标状态、计划指针、完成；`goal_created` 的 `next` 是预绑定 Goal | Goal 写入 |
| `goalFanOutRequestId` | `src/core/work-graph/state/goal-machine.ts:657` | 派生 fan-out 请求的稳定 id | pause/cancel/resume 的扇出 |
| `findGoalResumeContinuations` | `src/core/work-graph/state/goal-machine.ts:710` | 从任务事实找 resume 的续作 | 恢复 Goal 后规划续作 |
| `transitionGoalSettings` | `src/core/work-graph/state/goal-settings-machine.ts:189` | Goal 设置迁移（order_set 用已有顺序的下标） | 修改 Goal 设置 |
| `goalStartPolicy` | `src/core/work-graph/state/goal-settings-machine.ts:237` | 启动准入策略 | 自动启动 Goal 前 |
| `goalDecisionBasisMatches` | `src/core/work-graph/state/goal-settings-machine.ts:255` | 决策依据是否仍对应当前 Goal | 复用/重算决策时 |
| `isLegalSettings` | `src/core/work-graph/state/goal-settings-machine.ts:141` | Goal 设置形状的唯一纯检查（schema 版本、autonomy、order、wait/risk 字段） | 构造或复制设置后写之前；`decideGoalCopy` 与设置迁移共用 |
| `transitionLinePins` | `src/core/work-graph/state/line-pin-machine.ts:81` | 一次原子增删置顶项；无变化时 effects 为空 | 修改工作线置顶 |
| `deriveLineStatus` | `src/core/work-graph/state/line-status.ts:261` | 唯一的工作线状态派生（词、注意、标记、桶） | 列表、悬停卡、详情 |
| `lineRunningCapOf` | `src/core/work-graph/state/line-status.ts:413` | 由持有者的 Query 标记或 Run 的持久 `starting`+`authorized` 形状派生运行名额等待（`running_cap` 或 null） | 画线的名额等待；不要另写判定 |
| `deriveLineControls` | `src/core/work-graph/state/line-status.ts:496` | 由事实与状态派生可用控制项 | 画工作线操作 |
| `deriveAttentionAll` | `src/core/work-graph/state/line-status.ts:744` | 一条线上所有注意项及来源 | 需要完整注意清单时 |
| `transitionMessage` | `src/core/work-graph/state/message-machine.ts:1432` | SessionMessage 主迁移 | 消息读/回/派生 |
| `createSessionMessageRecord` | `src/core/work-graph/state/message-machine.ts:1598` | 建新消息记录 | 收到用户或系统消息 |
| `nextSessionMessageRecord` | `src/core/work-graph/state/message-machine.ts:1679` | 按变更生成下一条消息记录 | 读、回、绑定答复 |
| `messageConsumptionProblem` | `src/core/work-graph/state/message-machine.ts:885` | 消息能否被消费的唯一规则：撤回 → `invalid`；`release` 为 awaiting/approved/denied → `busy`；null/released 可消费 | 读正文、读回复、咨询、提交咨询、接续等待之前 |
| `messageFactsOfRecord` | `src/core/work-graph/state/message-machine.ts:893` | 从消息记录取消费规则的三项事实 | 拿着记录的消费方 |
| `messageFactsOfState` | `src/core/work-graph/state/message-machine.ts:899` | 从机器状态取同样的三项事实；absent 为 null | `messageSatisfiesWait` 和其它按状态判断的消费方 |
| `messageSatisfiesWait` | `src/core/work-graph/state/message-machine.ts:924` | 接续等待的唯一判定：先过 `messageConsumptionProblem`；`intervention` 直接满足（该臂不消费）；已消费的等待答 `busy`；`expiry` 要求记录存在、没有回复（`reply_present`）且已过期；`wait_reply` 保持正式答复的 `responseRef` 与工作区检查 | K 的 claim 续作判定；`MessageGuardContext.consumedWait` 只走这一份 |
| `WAIT_INTENTS`、`isWaitMessage` | `src/core/work-graph/state/message-machine.ts:917`、`src/core/work-graph/state/message-machine.ts:920` | 可等待意图的闭集（`inquiry`/`action_request`）与一条消息是否成等待（`waitAfterSend` 且意图在这个闭集里） | 等待处置、到期与转发判定共用这一份；不要另写意图列表 |
| `waitFactsOfRecord` | `src/core/work-graph/state/message-machine.ts:1047` | 从消息记录已存的 accepted-input 投影读 `WaitFactsV1`（等待是否已被消费）；不读 holder claim | 到期判定、等待读取与接续等待之前；不要另扫 `acceptedInputs` |
| `waitStateOf` | `src/core/work-graph/state/message-machine.ts:978` | 等待的状态：已消费、撤回、取消等待、已回复、已到期、仍开着，先中先算 | 等待读取、到期投递与接续判断之前 |
| `decideExpiry`、`ExpirySkipReason`、`MessageExpiredChangeV1` | `src/core/work-graph/state/message-machine.ts:1153`、`:1154`、`:1155` | 到期投递的唯一决定：未释放、不是 `waitAfterSend` 的询问、未到 deadline、等待不 open 各给一个跳过原因，否则给带 `at` 的 `expired` 变更 | 到期投递在提交前据此判；不要另写条件或跳过原因 |
| `MessageExpiredEventV1`、`SessionMessageEventType` 的 `SessionMessageExpired`、`MessageMachineState` 的 `expiredAt`、`onExpired` | `src/core/work-graph/state/message-machine.ts:1422`、`:310`、`:134`、`:1319` | 到期的事件体与事件类型、机器状态的到期时刻，以及 `message_expired` 迁移：`onExpired` 只产出 `expired` 变更与事件，记录构造写 `expiredAt`；已到期再迁移是 `illegal/invalid`，答复过的等待不能到期 | 到期事件编码与迁移；只在 `transitionMessage` 的 `message_expired` 臂里用 `onExpired`，不要另造事件名或字段 |
| `deliveryEligibility` | `src/core/work-graph/state/message-machine.ts:1015` | 投递资格的唯一规则：先调 `messageConsumptionProblem`，再看 Goal、任务阻塞、对方结果未知、本部分事实 | 邮件箱投递、回复与到期投递之前 |
| `forwardMessageProblem`、`disposeWaitProblem`、`destinationProblem`、`FORWARD_DESTINATION_GONE` | `src/core/work-graph/state/message-machine.ts:1070`、`:1138`、`:1072`、`:1070` | 转发与等待处置的纯拒绝表（固定顺序的 code/reason）；`destinationProblem` 是同工作区、资格、职责共用的目的地规则；`FORWARD_DESTINATION_GONE` 是服务端归档/退休/归档申请预检的拒绝 detail | 转发/等待处置 owner 提交前判；P 用该 detail 判“待指定收件线”，不要另写表或目的地规则 |
| `noProgressKey` | `src/core/work-graph/state/no-progress.ts:175` | requeue 的无进展键，存进 TaskRequeue.basis | 重排队守卫与比较 |
| `reverifyBasis` | `src/core/work-graph/state/no-progress.ts:206` | successor 轮的重验证键 | VR-14 比较链上 basisDigests |
| `roundFailureFacts` | `src/core/work-graph/state/no-progress.ts:96` | 一轮的非 PASS 检查与 gap codes | 两套键、失败事实读模型 |
| `admitNoteWrite` | `src/core/work-graph/state/note-machine.ts:60` | 新注记的准入状态 | 写注记前 |
| `transitionNote` | `src/core/work-graph/state/note-machine.ts:430` | 注记处置迁移 | 注记状态写入 |
| `newNoteHeadRecord` | `src/core/work-graph/state/note-machine.ts:291` | 建 pending 注记头 | 新建注记 |
| `newNoteVersionRecord` | `src/core/work-graph/state/note-machine.ts:366` | 建注记版本 | 追加注记版本 |
| `userReasonsOf` | `src/core/work-graph/state/note-machine.ts:221` | 由处置关系算用户复查原因 | 注记复查 |
| `secretaryNoteScope`、`SecretaryNoteScopeFactsV1` | `src/core/work-graph/state/note-machine.ts:131`、`src/core/work-graph/state/note-machine.ts:102` | 纯：一轮写入范围的唯一判定——普通注记的范围与 `storedGoalId` 跟本轮冻结的 `effectiveGoalId`（无 Goal 轮只能项目/模块/接口/文件锚点），目标或 stage 理解停在有效 Goal 内，只有被授权的 Goal 理解可用该 Goal 作主锚点，项目理解与修复拒绝；事实形状 `SecretaryNoteScopeFactsV1` | 注记 owner 判定 `query_run` 写入的 `storedGoalId` 与越界拒绝 |
| `secretaryNoteAdmission` | `src/core/work-graph/state/secretary-note.ts:40` | 纯：一轮 Query 的注记准入——没有请求根（普通 Query、副本）是 `none`；秘书请求轮是 `secretary`，写入种类正好是六个通用种类加 `understanding`（`review` 不是写入种类，`repair` 被拒），带 `withdraw: true` 和只含 Goal id 的授权集 | 准备与开始检查都只经这条规则定类；工具声明和注记工具组只消费这个值，调用方不要各自判类 |
| `planningNoteAdmission` | `src/core/work-graph/state/secretary-note.ts:64` | 纯：非请求的规划 Query 的注记准入——`plan_round`/`plan_review` 形状是 `planning`（六个通用写入种类、`withdraw: true`、不授 Goal）；`text` 形状只在冻结来源是 Host 系统 `action_request` 且有有效 Goal 时才是 `planning`，`planRef` 不决定类别；`roleExploration` 为真（冷启动的探索轮，没有 Goal）也是 `planning`，另加 `link`、`flow` 两种 | 规划轮的注记工具声明与写入；准备和开始两侧都传 `roleExploration`；不要另判轮次类别 |
| `coldStartOperationRef`、`newColdStartAction`、`coldStartPhaseProblem`、`advanceColdStartPhase`、`ColdStartActionV1` | `src/core/work-graph/state/cold-start.ts:36`、`:36`、`:43`、`:54`、`:16` | 纯：项目唯一冷启动操作的派生 ref、新动作、相位核对、一次推进一个相位 | 冷启动 owner、批窗口、探索轮的注记来源读都用这一份；不要另拼 `cold_start:` ref 或另写相位推进 |
| `roleExplorationExecution`、`roleExplorationQuestion`、`hostSystemActionRequest`、`roleExplorationBindingOf` | `src/core/work-graph/state/role-exploration.ts:43`、`:27`、`:37`、`:43` | 纯：探索轮唯一的无目标执行臂、“请动手”问句、Host 系统 `action_request` 判定、探索轮可信绑定的核对 | 冷启动提交探索 Query 和发消息、规划来源和探索轮的注记来源核对 |
| `sessionRoleFactsRef` | `src/core/work-graph/state/role-facts.ts:31` | Session 角色事实记录的 ref | 读或写 `SessionRoleFacts` 时用它；不要手写这个 refKey |
| `decidePlanCandidate`、`diagnosePlanCandidate` | `src/core/work-graph/state/plan-candidate.ts:126`、`src/core/work-graph/state/plan-candidate.ts:126` | 计划候选的唯一决定表（请求审阅/请求修复/采用/出卡/等待，首次匹配即返回）与机械诊断（必需验证要求必须有已注册检查覆盖；`checks: null` 是覆盖未知、`checks: []` 是全部诊断） | 规划环的候选推进与出卡；不要另写决定顺序或覆盖规则 |
| `transitionNoticeSettings` | `src/core/work-graph/state/notice-settings-machine.ts:45` | 通知已读位置迁移；无前进更新则不写记录 | 标记通知已读 |
| `newCandidateProposal`、`CandidatePlanProposal` | `src/core/work-graph/state/plan-machine.ts:132`、`src/core/work-graph/state/plan-machine.ts:92` | 建候选计划提案；候选带 `catalogPin`（只在创建时写，不受保护，采用重核不比较），并在它之后写必填可空的 `sourceMessageRef`（干预消息，其他写者为 `null`） | 提交计划草案 |
| `derivePlanProposalReadVerdict` | `src/core/work-graph/state/plan-machine.ts:197` | 提案的读取结论（含 Goal 状态） | 读计划提案 |
| `derivePlanRevisionStatus` | `src/core/work-graph/state/plan-machine.ts:219` | adopted/superseded 派生，不落库 | 读计划修订 |
| `planRevisionTargetOf` | `src/core/work-graph/state/plan-machine.ts:231` | 由提案与草稿算目标修订 ref | 采纳提案前 |
| `transitionPlanProposal` | `src/core/work-graph/state/plan-machine.ts:1689` | 提案主迁移；采纳与 Goal 指针同一提交 | 计划写入 |
| `planProposalProblem` | `src/core/work-graph/state/plan-machine.ts:883` | 提案事件的前置检查 | 提案迁移前 |
| `draftHasModuleTask` | `src/core/work-graph/state/plan-machine.ts:1497` | 草稿里有 module 作用域的任务（`scope.kind === 'module'`），采用时要读 catalog | 采用 effects 需要决定是否加 catalog guard 时 |
| `newPendingQueryRecords` | `src/core/work-graph/state/query-run-recovery.ts:533` | 建 pending 的 QueryJob/QueryRun 对 | 新 Query 请求 |
| `advanceQueryExecutionRecord` | `src/core/work-graph/state/query-run-recovery.ts:608` | 推进 claimed/prepared/entering/entered | Query 进入执行 |
| `markQueryRunUnknownRecord` | `src/core/work-graph/state/query-run-recovery.ts:688` | 记录 unknown（Job 保持 running） | 结果未知 |
| `settleQueryRunRecord` | `src/core/work-graph/state/query-run-recovery.ts:708` | 一起结清 Job 与 Run；带答案检查的 failed 关闭原因为 `invalid_answer` | Query 终态 |
| `transitionQueryRunRecovery` | `src/core/work-graph/state/query-run-recovery.ts:216` | QRR 恢复子机器；请求轮的 not-entered 按是否被 drop 覆盖分成结束或新 attempt | 启动对账与人工确认 |
| `queryRecoveryStateOf` | `src/core/work-graph/state/query-run-recovery.ts:505` | Job+Run 的恢复机器状态 | 恢复迁移前 |
| `MAX_ATTESTATION_REASON_CHARS` / `QueryAnswerCheck` | `src/core/work-graph/state/query-run-recovery.ts:129`、`src/core/work-graph/state/query-run-recovery.ts:129` | 人工确认理由和关闭消息的上限（2000 个 UTF-16 单位，截断不留半个代理对）；答案检查失败的 detail 与理由 | 校验确认理由、结清带答案检查的终态；`src/core/work-graph/tasks/run-reconcile-service.ts` 只复用这个常量，不另写答案检查类型 |
| `sameRef`（**正本**） | `src/core/work-graph/state/ref-equality.ts:2` | 与键序无关的 ref 结构相等；本层是唯一正本 | 比较 ref；不要再写第二份 |
| `newRequestRound` | `src/core/work-graph/state/request-rounds.ts:66` | 建新请求轮（Job/Run 对）：`roundKind` 取 `request`/`followup`/`reply`/`expiry`，`relatedMessageRef` 在答复/到期轮上写消息、其它轮为 `null`，可写入本轮的理解命令；`NewRequestRoundInput.requestReferences` 必填（没有引用时构造器收到 `[]`），`newRoutingRound` 写 `[]` | 收到新请求、答复或到期 |
| `newRoutingRound` | `src/core/work-graph/state/request-rounds.ts:113` | 建只路由、不跑的轮（无 Run）；`routing: null` 的归属臂带 `goalAttribution`，`job.goalId` 与 `job.goalAttribution` 都写该 Goal id，`understanding` 保持 `null` | 秘书分派与 Goal 归属轮；不要另写归属轮 |
| `endUnstartedRound` | `src/core/work-graph/state/request-rounds.ts:163` | 结束未开始的轮 | 未执行即关闭 |
| `newAttempt` | `src/core/work-graph/state/request-rounds.ts:188` | 在同一 Job 上开新 Run | 重试；保留旧 runId/触发身份 |
| `absorbRound` | `src/core/work-graph/state/request-rounds.ts:237` | 把批轮吸收进执行轮 | 合并批处理请求 |
| `recordAbsorbedRounds` | `src/core/work-graph/state/request-rounds.ts:260` | 记录被吸收的批轮（一次一条） | absorb 之后 |
| `setIntake` | `src/core/work-graph/state/request-rounds.ts:272` | 设置/清除 secretary-intake 持有者 | 秘书领取/释放请求 |
| `recordEntered` | `src/core/work-graph/state/request-rounds.ts:281` | 一次性写 enteredSession，第二次换 Session 抛错 | 请求第一次真正进入 |
| `transitionUnderstandingCommand` | `src/core/work-graph/state/request-rounds.ts:299` | 理解命令的唯一合法迁移 `live → closed`、`live → consumed`、`closed → consumed`；已 consumed、回退或 commandId 不符抛错，只改 state/updatedAt、revision+1 | 关闭或消费一条理解命令 |
| `foldUnderstandingCommand` | `src/core/work-graph/state/request-rounds.ts:329` | 把一次理解命令迁移的结果折进另一份 Job 快照：保留该快照的 revision/updatedAt，只取迁移产出的命令；没有命令抛错 | 轮结束提交把消费后的命令并入自己的下一份 Job |
| `UnderstandingOperationFactsV1`、`liveUnderstandingGrants` | `src/core/work-graph/state/request-rounds.ts:369`、`:380` | 冻结材料列表 `[round, ...batch]` 上仍有效授权集的唯一纯规则：命令 live、自身 generation 等于其 operation 当前 generation、requestRoot 是本次请求根且 operation 的 source 仍是 owner；按 Goal 去重、轮次顺序，返回 readonly `GoalRef[]` | 准备读取、启动重核和注记时解析授权集 |
| `currentUnderstandingGeneration` | `src/core/work-graph/state/request-rounds.ts:410` | operation 的当前理解 generation：`progress.understanding` 最大记录，非交接分支或无记录为 `null` | 判命令 generation 前 |
| `leaseReleasedForContinuation` | `src/core/work-graph/state/review-lease.ts:25` | 租约是否由 afterRun 或其复查轮释放 | 续作前置检查 |
| `isUnenteredReviewRoundForCancellation` | `src/core/work-graph/state/review-lease.ts:41` | 可证明未进入 Kernel 的复查 Run | UR3h 取消判定 |
| `reviewRoundEndedKnown` | `src/core/work-graph/state/review-lease.ts:63` | 复查 Run 是否已知结束 | 判断可续作 |
| `newRunRecord` | `src/core/work-graph/state/run-machine.ts:855` | 建 Run 记录 | claim/开跑 |
| `withBoundStart` | `src/core/work-graph/state/run-machine.ts:877` | 首次 entry 成功后把提交游标绑到返回的 Run；已有的值不替换 | entered/result 返回 Run 时 |
| `transitionRun` | `src/core/work-graph/state/run-machine.ts:1395` | Run 主迁移，返回整条下一条 Run | 任何 Run 生命周期写入 |
| `runStateOf` | `src/core/work-graph/state/run-machine.ts:148` | Run 快照的机器状态 | Run 迁移前 |
| `messageMachineStateOf` | `src/core/work-graph/state/message-machine.ts:369` | 消息记录的机器状态；缺失为 absent | 消息迁移前 |
| `isPausedInterrupted` | `src/core/work-graph/state/run-machine.ts:208` | 是否 paused/interrupted 的结束 | 重排队与展示 |
| `runUnresolvedBlocker` | `src/core/work-graph/state/run-machine.ts:222` | 未解决工具调用的阻塞原因 | 未知调用审查 |
| `claimHoldGuard` | `src/core/work-graph/state/run-machine.ts:1128` | claim 时 Session/Lease 的持有检查 | claim 提交 |
| `entryPermitGuard` | `src/core/work-graph/state/run-machine.ts:1223` | 进入许可与持久 claim 的一致性检查 | 进入 Kernel 前 |
| `newSessionAnomalyAnchorRecord` | `src/core/work-graph/state/session-anomaly.ts:24` | 建异常锚点（每 Run 至多一个，不可变） | 发现异常时 |
| `transitionSessionAnomaly` | `src/core/work-graph/state/session-anomaly.ts:27` | 异常锚点首次写入迁移 | 记录异常 |
| `deriveSessionAnomalyView` | `src/core/work-graph/state/session-anomaly.ts:55` | 由锚点与后续事实派生异常视图 | 读异常 |
| `createSessionRecord` | `src/core/work-graph/state/session-availability.ts:344` | 建 Session 记录；可选的 `delegationCeiling`/`secretaryCreated` 从创建意图带进记录 | 新建 Session |
| `occupySessionRecord` | `src/core/work-graph/state/session-availability.ts:375` | 在下一代 generation 上取得占用 | 运行开始 |
| `releaseSessionRecord` | `src/core/work-graph/state/session-availability.ts:399` | 只释放匹配的 holder/generation | 终态、取消、恢复 |
| `releaseUnenteredQuerySession` | `src/core/work-graph/state/session-availability.ts:431` | 没进 Kernel 就结束的 Query attempt 的 SES-08 释放（drop、`end_unbound`、请求轮新 attempt）：Run 不再持有时返回 null | 请求 owner 的 drop/结束和新 attempt；调用方自己读 Session、加 revision guard、映射拒绝 |
| `transitionSession` | `src/core/work-graph/state/session-availability.ts:673` | Session 主迁移（SES-01..19） | 任何 Session 生命周期写入 |
| `sessionMachineStateOf` | `src/core/work-graph/state/session-availability.ts:304` | Session 记录的机器状态；缺失为 absent | Session 迁移前 |
| `ownsOccupancy` | `src/core/work-graph/state/session-availability.ts:259` | 占用是否正好是该 holder 与该代 | claim、进入、Query、对账 |
| `nextOccupancyGeneration` | `src/core/work-graph/state/session-availability.ts:243` | 下一次占用代数 | 取占用时 |
| `sessionAvailabilityAdmissionProblem` | `src/core/work-graph/state/session-availability.ts:731` | SES-02/SES-03 的共用可用性检查：lifecycle 为 active 且 health 为 available | 占用准入与请求分派共用这条子规则 |
| `occupancyAdmissionProblem` | `src/core/work-graph/state/session-availability.ts:749` | 完整占用准入：lifecycle/health/占用/代/pin | 实际 claim |
| `sessionDispatchAdmissionProblem` | `src/core/work-graph/state/session-availability.ts:541` | 分派准入：归档、只读副本、Work 等待；已消费等待按消息/原 Run/任务匹配，`intervention` 不消费等待 | 选秘书/分派候选 |
| `roleLineIdleOf`、`RoleLineIdleFactsV1` | `src/core/work-graph/state/session-availability.ts:623`、`:603` | 参谋/书记线的闲置判定与六项事实；读不到是 `unreadable`，占用未知是 `occupied`；事实里另带三项排除（最后一条、待答卡、`unfinishedSplitLine`：未完成拆线的新线或源线），由回收挑线时跳过 | 保留名额回收挑线之前；不要另写闲置规则 |
| `goalPositionOf`、`regionPositionOf`、`RoleLinePositionV1` | `src/core/work-graph/state/role-line-position.ts:104`、`:65`、`:104` | 目标位置（候选参谋线）与 region 负担（`region`/`descend`/`unknown`），以及读线时带出的位置值 | 选参谋线、读线卡、拆线规划；不要另走一遍最长前缀归属 |
| `planRoleLineSplit` | `src/core/work-graph/state/role-line-split.ts:15` | 拆线的唯一严格子范围证明与挑选 | 维护页和 `propose_role_split` 的 owner 共用；不要另写校验 |
| `reclaimIdleLineOf`、`RoleLineReclaimPort`、`RoleCapacityPort` | `src/core/work-graph/state/role-line-reclaim.ts:34`、`:23`、`:34` | 回收挑线（跳过最后一条、有待答卡和未完成拆线的线）、回收端口（答 `ReclaimSeatV1`，`limits` 可为 `null`：项目从没设过额度）和容量 episode 的注入端口 | 满额时回收一条闲置线、归档后关闭 episode |
| `emptyGoalAdviserQueue`、`queueRankOf`、`enqueueGoal`、`reorderGoals`、`dropGoal`、`QUEUE_DRAIN_BATCH`、`GoalAdviserQueuePendingV1` | `src/core/work-graph/state/goal-adviser-queue.ts:19`、`:25`、`:30`、`:45`、`:60`、`:11`、`:16` | 项目参谋队列的唯一顺序规则：空队列读值、名次、入队、重排、移出，和一趟最多提交的分配数；入队收待绑定的队列 | 队列服务写队列之前；不要另写名次或插入规则 |
| `transitionResponsibility` | `src/core/work-graph/state/session-responsibility.ts:33` | 责任转移/关闭：关源链接、开目标链接 | 责任交接 |
| `destinationEligible` | `src/core/work-graph/state/session-responsibility.ts:111` | 转移/换挂靠目的地的唯一资格谓词：`active` + `available` + 无 `archiveRequest` + 不是只读副本 | 服务的三处调用（`:421`、`:441`、`:640`）和 `planReanchor` 共用；不要另写第二份 |
| `admitHandoff`、`newHandoffOperationRecord` | `src/core/work-graph/state/session-handoff.ts:110`、`:100` | 交接的拒绝顺序（`read: null` 只查前三步）；接受时的记录：revision 1、`accepted`，每个分配和每个任务各一条进度，其余步骤为 `null` | 交接 owner 的接受：读之前先查前三步，命令里带读到的事实再查一遍 |
| `OperationCallerV1`、`OperationSessionFactV1`、`HandoffAdmissionFactsV1`、`SecretaryArchiveAdmissionFactsV1`、`OperationAdmissionV1` | `src/core/work-graph/state/session-handoff.ts:52`、`:23`、`:26`、`:41`、`:49` | 两张准入表的输入和结果：调用者的分类、公开读到的 Session 事实、交接和秘书归档各自的事实、准入结果（`busy` 带未完成操作的 pin） | owner 读完事实后调 `admitHandoff` 或 `admitSecretaryArchive` |
| `admitSecretaryArchive`、`newSecretaryArchiveOperationRecord` | `src/core/work-graph/state/session-handoff.ts:148`、`:145` | 秘书归档的拒绝顺序（人、范围、形状、源、秘书职责、未完成操作）；接受时的记录，每个选择一项，`input.actor` 从可信上下文保存 | 秘书归档 owner 的接受 |
| `saveHandoffCreateInput`、`saveUnderstandingCommand`、`saveArchiveSavedInput`、`saveArchiveReceipt` | `src/core/work-graph/state/session-handoff.ts:237`、`:212`、`:225`、`:234` | 三个保存位置的结构拷贝：后继的 `ensureLine` 输入、某理解代的命令、归档的 `GraphWrite`，以及归档注册返回的 `{identityKey,fingerprint}`；写归档 receipt 前必须先有保存输入 | 推进的 before/after 写；原输入按自己的 generation 重放 |
| `withHandoffProgress`、`coverageHolds` | `src/core/work-graph/state/session-handoff.ts:331`、`:328` | 推进写唯一的 progress 构造；覆盖规则：每个 Goal 的当前理解文字必须由旧 Session 在最后进入并结束的轮写入，无 Goal 不需要覆盖 | 推进的每一步；不要另写 progress 或第二条覆盖规则 |
| `consumeHandoffBrief` | `src/core/work-graph/state/session-handoff.ts:248` | entered 确认的消费迁移：写 `brief.consumedBy`、revision 加 1，并给出 pin 住读到的 revision 的 guard；不写事件 | D 在 entered 提交里合并 record+guard；推进只设 `brief.ready`，从不消费 |
| `withHandoffApproval`、`decidedHandoffApproval` | `src/core/work-graph/state/session-handoff.ts:296`、`:293` | 交接批准卡：接受时写入待批 `approval`（不动 revision）；`handoff.decide` 把人的裁决与回答写回，拒绝把操作置 `failed` | 交接接受与 `handoff.decide` |
| `briefReady`、`BriefReadyFacts` | `src/core/work-graph/state/session-handoff.ts:349` | 简报就绪：受保护的最终归档提交成功且完整路由集已保存（`closed` 且每根有回执或被明确跳过）；`pending`/`partial` 不是成功 | 推进在归档 after 写里设 `brief.ready`；读取按同一规则判 `waiting` |
| `deriveReworkClass` | `src/core/work-graph/state/task-failure.ts:200` | 失败分类（FC-1..FC-17） | 重排队前 |
| `reworkFenceOf` | `src/core/work-graph/state/task-failure.ts:147` | 人工停止围栏 | 判定谁能重做 |
| `reworkPermission` | `src/core/work-graph/state/task-failure.ts:414` | Goal 活动 + 操作者/失败类别矩阵 | 允许重排队前 |
| `automationVerdict` | `src/core/work-graph/state/task-failure.ts:799` | 按策略给自动化裁决 | 失败后自动处理 |
| `buildTaskFailureFacts` | `src/core/work-graph/state/task-failure.ts:1041` | 组装失败事实读模型 | 展示失败与重做 |
| `runErrorOf` | `src/core/work-graph/state/task-failure.ts:694` | 从终态负载与对账取错误与来源 | 统一错误展示 |
| `attemptOrdinalOf` | `src/core/work-graph/state/task-failure.ts:1337` | Run 在它的链上是第几次尝试（从 1）：链上每个带 `requeueRef` 的 Run 开一次新尝试，接续（`previousRun`）留在同一次；复用 `chainRunIds` 防环 | 轨道横条 `attempt.ordinal` 与 `TaskRow.attemptOrdinal`；不要另写走链 |
| `taskReworkRefusalEffects` | `src/core/work-graph/state/task-failure.ts:1490` | 拒绝重做的 effects | 拒绝记录同一提交 |
| `controlIntentRecordOf` | `src/core/work-graph/state/control-intent-machine.ts:380` | 由请求与 next 生成意图记录 | 控制提交 |
| `projectTaskPhase` | `src/core/work-graph/state/task-machine.ts:241` | 相位 + 原因的精简投影 | 展示/守卫 |
| `taskMachineStateOf` | `src/core/work-graph/state/task-machine.ts:255` | Task 定义的机器状态 | Task 迁移前 |
| `transitionTask` | `src/core/work-graph/state/task-machine.ts:797` | Task 写入合法性（TASK-01..30） | claim、完成、处置、重排队 |
| `taskRequeueStateProblem` | `src/core/work-graph/state/task-machine.ts:1164` | 当前状态能否重排队 | 重排队前 |
| `newTaskRequeueRecord` | `src/core/work-graph/state/task-machine.ts:711` | 建 TaskRequeue 记录 | 重排队提交 |
| `effectivePlatformDuty` | `src/core/work-graph/state/context-input.ts:611` | 解析有效平台职责 | 判断平台/职责时 |
| `normalizeCommandText` | `src/core/work-graph/state/command-normalization.ts:29` | 规范化命令文本 | 比较/算指纹前 |
| `declaredInputProblem` | `src/core/work-graph/state/context-input.ts:480` | 检查声明输入 | 校验工具/上下文输入时 |
| `observationPairingProblem` | `src/core/work-graph/state/control-intent-machine.ts:294` | 意图与观察的配对检查 | 提交观察结果前 |
| `unreachable` | `src/core/work-graph/state/transition.ts:53` | 穷尽检查的兜底 | switch 的 never 分支 |
| `UNKNOWN_CALL_KIND_TABLE` | `src/core/work-graph/state/unknown-call-kinds.ts:19` | 固定工具种类表，首个匹配生效；含 `create_member`、`request_rework`、`request_recheck`、`withdraw_session_message` 与只读的 `check_links` | 分类未知调用 |
| `unknownCallKindOf` | `src/core/work-graph/state/unknown-call-kinds.ts:50` | 按 Kernel 工具名取种类，默认值在表里 | 未知调用审查 |
| `newUnknownCallReview` | `src/core/work-graph/state/unknown-call-review.ts:163` | 建 UnknownCallReview | 发现未知调用 |
| `transitionUnknownCallReview` | `src/core/work-graph/state/unknown-call-review.ts:245` | 审查主迁移（UCR-01..15） | 审查写入 |
| `admitUnknownCallReview` | `src/core/work-graph/state/unknown-call-review.ts:217` | 审查准入 | 开审前 |
| `UNKNOWN_CALL_REVIEW_MAX_ROUNDS` | `src/core/work-graph/state/unknown-call-review.ts:39` | 审查最多轮数 | 校验轮数 |
| `ARCHITECTURE_PROPOSAL_STATES`、`newArchitectureProposalRecord`、`transitionArchitectureProposal` | `src/core/work-graph/state/architecture-proposal-machine.ts:45`、`:34`、`:45` | 提案状态闭集与记录的唯一构造/迁移：进入批或到终态，只改 state/batchRef 与 revision，内容不可变 | 提案 owner 的写入、冻结与答复提交 |
| `transitionRound` | `src/core/work-graph/state/verification-machine.ts:1352` | 验证轮主迁移（VR-01..15） | 轮生命周期写入 |
| `transitionCheck` | `src/core/work-graph/state/verification-machine.ts:1603` | 单项检查迁移 | 检查开始/结果/中断 |
| `buildOpenedRound` | `src/core/work-graph/state/verification-machine.ts:909` | 建已开启的轮 | 开轮提交 |
| `buildSuccessorRound` | `src/core/work-graph/state/verification-machine.ts:629` | 建后继轮 | 重验证 |
| `finalizeRoundOutcome` | `src/core/work-graph/state/verification-machine.ts:806` | 折叠检查并定轮结果 | 轮收尾 |
| `foldVerdictChecks` | `src/core/work-graph/state/verification-machine.ts:786` | 按验证计划折叠检查判定 | 轮收尾/展示 |
| `roundChainHead` | `src/core/work-graph/state/verification-machine.ts:477` | 一轮链的头（最新/最高轮次） | 链相关守卫 |
| `roundTaskSignal` | `src/core/work-graph/state/verification-machine.ts:704` | 轮链给 Task 相位的信号 | Task 相位投影 |
| `reverifyAdmissionProblem` | `src/core/work-graph/state/verification-machine.ts:1413` | 能否开重验证轮 | 重验证前 |
| `reverifyExemption` | `src/core/work-graph/state/verification-machine.ts:550` | 重验证的豁免判定 | 自动重做计数 |
| `roundWriteAdmission` | `src/core/work-graph/state/verification-machine.ts:1078` | 轮写入的通用准入 | 任何轮写入 |
| `taskEvidenceIndexRefOf` | `src/core/work-graph/state/verification-machine.ts:1028` | 轮对应的证据索引 ref | 追加证据 |
| `displayRoundStatus` | `src/core/work-graph/state/verification-machine.ts:430` | 展示用轮状态 | 读模型 |
| `isFinalizedNonPass` | `src/core/work-graph/state/verification-machine.ts:102` | 已定稿且非 PASS | 失败事实/重验证 |
| `copyInterventionCandidateOf`、`CopyInterventionFactsV1` | `src/core/work-graph/state/copy-intervention.ts:16`、`src/core/work-graph/state/copy-intervention.ts:6` | 复制取消的纯候选规则与事实形状：按书的表序（先排除，再投递/未投递）判一条消息是否候选、可选/可撤回及原因；`null` 不是候选 | 分页读可复制干预时；不要另写状态判定 |

## 内部用

本层导出的其余名字（多为机器之间或 owner 内部使用；跨层引用前先看上表，确需复用就补进上表）：

- Attempt/Session：`attemptNodeOf`、`taskLeaseNodeOf`、`leaseHeldByClaim`、`isTaskLeaseEvent`、`ownsQuery`、`deriveAvailability`、`openResponsibleLinkOf`、`archiveSessionRecord`、`reactivateSessionRecord`、`observeSessionHealthRecord`、`bindSessionUnavailableCursor`、`requestSessionArchiveRecord`、`releaseSessionArchiveRequestRecord`、`executorArchiveDue`、`INCONCLUSIVE_PROBES`。
- Goal/Plan：`goalControlTarget`、`nextGoalPointer`、`nextGoalDesiredState`、`buildGoalPhaseSnapshot`、`goalFanOutReason`、`goalResumeContinueRequestId`、`projectGoalRunStop`、`isPendingVerdict`、`isGoalStopCause`、`reduceGoalDisplay`、`buildGoalSettingsRecord`、`goalConflictFacts`、`automationDecisionCause`、`buildWorkspaceDecisionSettingsRecord`、`buildWorkspaceLineSettingsRecord`、`acceptProposalRecord`、`derivePlanProposalStatus`、`samePlanPointer`、`futureChangeTraceProblem`、`tracedDispositionChangeProblem`、`parallelCarrierFactTaskIds`、`parallelCarrierFenceProblem`、`GOAL_CANCELLED_PLAN_DETAIL`、`INITIAL_ADOPTION_STALE_DETAIL`、`SOURCE_PLAN_STALE_DETAIL`、`TARGET_PLAN_NOT_NEW_DETAIL`。
- Control/Message：`desiredStateOfKind`、`controlSubmitProblem`、`observationStatusFor`、`newControlIntentRequest`、`controlIntentRequestOf`、`notEnteredEntryPhase`、`submissionReadsPointerIntent`、`submissionReadsGoal`、`observedIntentAnswer`、`messagePrincipalProblem`、`messageRecipientProjectProblem`、`messagePinProblem`、`messageSendFlagsProblem`、`inputObserverProblem`、`createSyntheticDecisionAnswerRecord`、`bindMessageResponseCursor`、`effectiveReplyHandler`。
- Task/Run：`runNodeOf`、`runControlNodeOf`、`runControlFence`、`leaseOwnedByRun`、`terminalOutcomeOf`、`terminalPayloadOf`、`attestedTerminalPayload`、`RUN_UNRESOLVED_TERMINAL_REASON`、`reviewClaimProblem`、`requeueClaimProblem`、`claimPinProblem`、`reviewBlockerProblem`、`claimBasisProblem`、`entryV2Binding`、`reviewEntryProblem`、`controlSubmissionRunEvent`、`stopRequesterOf`、`isGoalFanOutActor`、`reworkStopOf`、`priorRequeueAutoCount`、`nextRequeueAutoCount`、`permitClaimGuard`、`requeueHistorySourceOf`、`countEndedGoalRuns`、`streakOf`、`attemptOrdinalOf`、`previousChainRefOf`、`reworkRefusalIsStale`、`requeueConfirmedByReview`、`REWORK_ACTOR_CLASSES`、`newTaskReworkRefusalRecord`、`newTaskReductionRecord`、`taskClaimProblem`、`taskCompletionRoundProblem`、`taskCompletionFoldProblem`、`taskCompletionProjectionProblem`、`requeueBudgetIncreased`、`requeueBasisCompared`。
- 验证/审查：`roundOrdinalOf`、`rootRoundChain`、`ROUND_SUBJECT_SLOT_PREFIX`、`ROUND_GATE_SLOT_PREFIX`、`roundSlotKey`、`roundSlotSubjectOf`、`roundSlotOwner`、`outcomeFor`、`FROZEN_PERMISSION_CHANGED`、`FROZEN_ROOT_CHANGED`、`FROZEN_SOURCE_CHANGED`、`frozenBindingReason`、`beginRefusalIsPermanent`、`chainEvidenceIds`、`evidenceSupersededByRequeue`、`reverifyFailureClass`、`reverifyExemptionOfFacts`、`successorAutoCount`、`reverifyCapExceeded`、`roundChainFull`、`pendingRoundChecks`、`withCheckPhase`、`buildFinalizedRound`、`nextTaskEvidenceIndex`、`roundReviewerEvidenceProblem`、`roundOpenProblem`、`roundGoalActivityProblem`、`roundSubjectActivityProblem`、`roundActivityProblem`、`roundOpenPointerProblem`、`roundOpenBasisProblem`、`roundOpenSubjectProblem`、`roundOpenChainProblem`、`roundOpenChecksProblem`、`checkEventAdmission`、`frozenBindingProblem`、`reverifyCapRefusal`、`reverifyPolicyRefusal`、`newSessionAnomalyAnchorRecord`、`deriveTaskArchiveState`、`kernelToolNameOf`、`containedByHostStop`、`admitsAutoCleanupTakeover`、`truncateUnknownCallReviewItems`、`lastHolderOf`、`UNKNOWN_CALL_REVIEW_MAX_BYTES`、`UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES`、`UNKNOWN_CALL_REVIEW_MAX_ITEMS`、`UNKNOWN_CALL_DECISION_REASON_ORDER`。
- 其它纯 helper：`commandActionKey`、`COMMAND_RERUN_REQUEST_MAX_FORMS`、`openRequestForAlias`、`contextAssemblyStructureProblem`、`renderedSectionProblem`、`contextGoalContentProblem`、`gateCoveredTaskIds`、`gateFixInProgress`、`pausedAutomationAction`、`cardLineKeys`、`deriveTaskDisplayFacts`、`archivedLineTag`、`lineSortKey`、`keyCheckFacts`、`newBasisInputDigest`、`noteWriteAuthority`、`actualDispositionTargets`、`pendingUnderstandingOverridden`、`noticeClassOf`、`noteBodyOf`、`newCurrentPointerRecord`、`moveCurrentPointerRecord`、`newArchitectureCaptureFailureRecord`、`classifyTaskAttention`、`runFailureOrigin`、`accept`、`reject`、`failed`、`rejected`、`classifyTaskPhase`、`isRunFinished`。

## 不要做

- 不要在服务里 spread 一条 Run/Session/Task 改字段或另写一套迁移；受保护字段写入一律走本层构造器与 `transition*`（M1-05、M1-06）。
- 不要手抄 Session 的 lifecycle/health/occupancy 判定：领用走 `occupancyAdmissionProblem`，只共享 lifecycle/health 的候选筛选走 `sessionAvailabilityAdmissionProblem` 并把 busy 单列（FP-09、M1-04）。
- 不要把 Query 的 claimed/prepared 当成不可达，也不要只结清 Job/Run 的一半（M1-01、M1-36、CS-03）。
- 不要手搓 Attempt/Lease/Outbox，或假设 Run 完成等于 Task/Goal 完成；effects 交 `claimEffectRecords`（`src/core/work-graph/tasks/execution-entry-service.ts:919`）翻译。
- 不要在本层 import 时钟、随机数、计时器、网络、进程或任何 store；时间与 id 由调用方传入。
