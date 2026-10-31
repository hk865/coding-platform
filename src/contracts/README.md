# src/contracts：最外层共享契约

## 负责什么，不负责什么

- 本层是所有模块共同依赖的最外层：只放类型、纯函数和纯常量，提供共同的身份、结果、事件、读模型 DTO 与校验原语。
- 允许依赖本层文件彼此，以及 `node:crypto` 的纯哈希；不得 import `src/core`、`src/app`、`src/business`、`src/composition` 的实现。
- 不放业务选择、I/O、仓储、时钟/随机数、状态机或编排逻辑；这些属于各自的 owner。
- 状态迁移只经过 `src/core/work-graph/state/`；本层只声明状态、快照和迁移结果的形状，不写状态。
- 身份、指纹、key 的配方按领域区分（Goal、Session、Query、request 不可互换）；同一语义只留一份声明，别处引用而不是复制。
- 直接子文件夹：`core/`（核心身份/结果/Session 原语）、`prompts/`（提示词包与渲染）、`validation/`（输入校验规则），各见自己的 README。

## 文件

### 任务与计划
做 Goal 决定/相位、初始规划、Task/Plan 形状、返工与命令重跑的去这组。
- `command-rerun-request.ts` — `CommandRerunRequest` 聚合、状态与三个索引名；状态机在 `src/core/work-graph/state/`。
- `goal-card.ts` — 目标卡确认/复制的输入、回执、事实与决定：`GoalConfirmDraftInputV1`/`GoalConfirmDraftReceiptV1`/`GoalConfirmFactsV1`/`GoalConfirmDecisionV1`、`GoalCopyDraftInputV1`/`GoalCopyDraftResultV1`/`GoalCopyConfirmInputV1`/`GoalCopyConfirmResultV1`/`GoalUnderstandingPinV1`/`GoalCopyFactsV1`/`GoalCopyDecisionV1`。复制的三处形状：`GoalCopyDraftResultV1.interventions` 为 `{ available: false }` 或带 `candidates` 的 `{ available: true }`（候选用 `goal-copy-retraction.ts` 的 `CopyInterventionCandidateV1`），`GoalCopyFactsV1.selected` 直接就是这个候选类型（没有 `intervened`），决定 create 臂的 `retract` 是未选中的候选 ref。
- `goal-change.ts` — `UserDecisionV1`/`UserDecisionSnapshot`：有界的 Goal 决定记录。
- `goal-copy-retraction.ts` — 复制取消的候选契约：`CopyInterventionStateV1`（候选状态闭集）与 `CopyInterventionCandidateV1`（消息 ref、版本、状态、可选/可撤回及各自原因）。
- `goal-phase.ts` — `GoalPhaseRef`/`GoalPhaseSnapshot`：Goal 终止相位。
- `initial-planning.ts` — `InitialPlanAssignment`、`InitialPlanOrigin`、`InitialPlanOriginSourceV1`（`binding`/`prepared_goal`/`plain`/`intervention` 四臂）与 `InterventionAnswerSourceV1`（`{ kind: 'intervention', messageRef }`，干预 Plan 答案的唯一来源选择器）、`InitializationSourceShape`/`InitializationSourceV1`（初始化计划读哪一份回答：绑定的草稿或已备好的 Goal）、初始规划响应/设置。
- `initial-planning-parse.ts` — `parseInitialPlanningResponseV2`：初始规划 v2 回答外层协议的唯一纯解析；WorkGraph `tasks/` 的 Plan owner 和 `queries/` 的秘书回答检查共用（`queries` 不能 import `tasks`）。
- `input-declaration-id.ts` — `edgeDeclarationId`/`legacyDeclarationId`：输入声明 id。
- `plan.ts` — 计划/任务 DAG：`RuntimeTask`、`TaskInputRequirementV2`、`PlanRevisionSnapshot`、`planValidationError`、`revisionAssignments`。
- `reduction.ts` — `TaskReductionRef`、归因码与完成审计快照。
- `task-envelope.ts` — `TaskEnvelopeV1`：有界执行绑定。
- `task-failure.ts` — 任务失败/自动化停止/返工事实 DTO。
- `task-requeue.ts` — `TaskRequeue`/返工拒绝、自动化 actor、策略默认、启动三档 `RESUME_ON_STARTUP_MODES`、`isAutomationActor`、`reworkActorClassOf`。

### 执行与 Run
做派发、Query、Run 活动/预算、续接简报与控制意图的去这组。
- `continuation-brief.ts` — 续接简报：`ContinuationBriefV1`、上限、digest/marker、来源比较、中文渲染、结构校验与 `ContinuationBriefCapacityError`。
- `control-intent.ts` — 暂停/取消/恢复/引导：`ControlIntentRef`、`ControlIntentRequestV1`、`ControlIntentSnapshotV1`。
- `dispatch.ts` — 派发/运行契约：`RunRef`、`TaskAttemptRef`、`RunSnapshot`、`TaskEligibility`、`MODEL_SERVICE_FAILURE_CODES`、`TERMINAL_PAYLOAD_*`。
- `execution-feedback.ts` — `FeedbackSource`：验证失败调查的输入来源。
- `query-execution-context.ts` — `QueryExecutionRequest`：持久化的 Query 请求形状。
- `query-job.ts` — Query 聚合/意图/执行/答案：`QueryJobV1`（`understanding` 是唯一的命令存放处）、`GoalScreeningShape`/`GoalScreeningV1`（目标卡草稿的筛选，整体或 null）、`GoalCardDraftV1` 的 `screening`、回答的 `planDraftIndex`、`RequestUnderstandingCommandV1`（`request_understanding` 命令的唯一格式）、`SecretaryRoundMaterialV1.command`（从 `round.job.understanding` 投影一次）、`SecretaryRequestManifestV1` 的 `briefRef`/`understandingGrants`、`RequestCommandReceiptV1` 的 `understanding` 臂、`consultationQueryRefs`、`interventionPlanningQueryRefs`（由真实来源消息派生计划 Query 的固定身份）、`queryJobRefFor`、`validQueryExecution`（执行种类含 `intervention_planning`；该种类必带 `sourceMessageRef`，其他种类不得带）、`InitialPlanSourceResolutionV1`（plain/binding/prepared_goal/`intervention` 四臂，干预臂带 `InterventionAnswerSourceV1`）。
- `initialization-binding.ts` — 初始化绑定记录（字段表格式 `InitializationBinding@1`，`revision`/`goalRevision` 固定为 1）：`InitializationBindingRefShape`、`InitializationBindingFormat`、两个查找名；两条规则要求 ref 指向同一份回答和草稿，且回答、请求、Goal 同一项目、回答与请求同一工作区；记录没有事件，键是完整 ref 的 `canonicalJson`。
- `initialization-adoption.ts` — P11 初始化采用的共享数据（唯一正本）：`InitializationAdoptionRefShape`/`InitializationAdoptionRef`、`INITIALIZATION_ADOPT_STAGES`/`InitializationAdoptStageV1`、pin/progress/result/record 类型，以及操作定位 `initializationAdoptionOperationId`；阶段/进度检查是 J 的 `validation/initialization-adoption.ts`（P-3 不写它）。
- `run-activity.ts` — Run/Query 活动读数：规则版本、各项上限、`RunActivitySnapshot`、`QueryActivitySnapshot`、带 `querySince` 的 `ActivityRecordingSnapshot`、显式 unknown 的唯一构造 `unknownFacts` 与 `provenNotEnteredKernel`。
- `runtime-budget.ts` — `RuntimeBudget`、`DEFAULT_RUNTIME_BUDGET`、`MAX_RESPONSE_TOKENS`、`validateRuntimeBudget`。

### Session/通信
做工作上下文、参与/委派来源、Session 异常与工作线读 DTO 的去这组。
- `context-continuity.ts` — `WorkContextRef`：持久工作身份。
- `coordination.ts` — `WorkParticipationRef` 与 `AgentPrincipalRefV1`（参与关系与 Agent 归因）。
- `delegated-write.ts` — `DelegatedWriteProvenanceV1`/`PlanWriteProvenanceV1`：Agent 写入来源与授权代数。
- `session-activity.ts` — Session 的活动记录（字段表格式 `SessionActivity@1`）：`SessionActivityRefShape`、`SessionActivityFormat` 和推导出的 `SessionActivityRef`/`SessionActivityV1`；只随引起它的事实一起提交，`source` 是那个事实的 ref（`input` 来自 QueryJob 或 SessionMessage，`round_ended` 来自 QueryRun）。
- `session-anomaly.ts` — `SessionAnomalyAnchorRef`、归档变更与排队来源视图。
- `work-line.ts` — 工作线读 DTO：列表、详情、悬停、分段与执行项；秘书线的名字是“秘书 N”（`LineNameV1.ordinal`）。消息项的 `LineMessageStateV1` 顶层带 `release`（记录原值）、推导出的 `delivery`/`deliveredTo`/`evidence`/`reason` 与 `disposition`（`reason` 是未送达的读原因，仅 `delivery === 'undelivered'` 时非 null；记录上存的 `delivery` 不读，7B 才读）；`undelivered` 仍是“未送达的回复”，不是推导出的投递状态。

### 证据与审查
做证据、无进展、审查准入/材料与验证范围/导入的去这组。
- `evidence.ts` — 证据与覆盖：`EvidenceRef`、`EvidenceV1`、`EVIDENCE_OUTCOMES`、`requirementKeyOf`、`EVIDENCE_SUMMARY_MAX_BYTES`。
- `no-progress.ts` — 平台生成正文类型、`newBasisInputProblem`、`MAX_NEW_BASIS_INPUT_REFS` 与无进展键形状。
- `review-admission.ts` — 审查轮准入：固定工具集、`isReviewRoundPurpose`、`reviewHostLayerOneAccess`、`reviewRoundAdmissionProblem`。
- `reviewer-context.ts` — `ReviewerConfigRef`/`ReviewerProfileV1`。
- `reviewer-verification.ts` — `ReviewMaterialDescriptorV1`：独立审查材料的不可变索引。
- `reviewer-work.ts` — 独立审查聚合：`TaskReviewProtocolRef`、`ReviewWorkRef`、绑定与 `ReviewWorkSnapshot`。
- `verification-context.ts` — 验证轮来源证明、来源端口、范围与材料身份。
- `verification-import.ts` — `VerificationScope`：验证的目标范围。
- `verification.ts` — 检查/验证轮/风险契约与 `CHANGE_SCOPE_MAX_FILES`、`ROUND_CHECK_INCOMPLETE_CAUSES` 等常量。

### 材料与架构
做架构目录/观察/源码快照、artifact、材料授权与路径归属的去这组。
- `architecture-catalog.ts` — 架构目录 DTO：`ModuleDefinition`、`AdoptedArchitecture`、`ArchitectureCatalogPinV1` 与 `moduleMappingsOf`；R1 字段表形状 `architectureBaselineRevisionRefShape`、`architectureCatalogRefShape`、`architectureCatalogPinShape`（pin 的 `catalogRef` 必须与 `baseline.ref` 同 project/baseline/revision）。
- `architecture-inspection.ts` — 代码图/观察清单：`CodeGraphNode`、`FormalObservedFindingV1`、`FileGraphPageV1`、`LanguageCoverageV1`、`COVERAGE_ISSUES_MAX`。
- `architecture-observation.ts` — 自动捕获：`AUTO_CAPTURE_TRIGGERS`、`isAutoCaptureTrigger`、`ArchitectureAutoCaptureRecordV1`、`ArchitectureObservationStateV1`。
- `architecture-source.ts` — 架构源快照：`ArchitectureSourceSnapshotV1`、`compactUnresolvedLines`、`architectureSourceIssues`，并转出 `pathOwnershipOf`。
- `artifact.ts` — 内容寻址正文：`ArtifactRef`、`ArtifactRecord`、`ARTIFACT_MAX_SIZE_BYTES`、`artifactBodyDigest`、`artifactBodySize`。
- `material-access.ts` — 材料来源集/pin、grant 引用与 `sameArtifactRef`/`sameArtifactOwnerRunRef`。
- `path-ownership.ts` — 唯一的最长前缀归属 `pathOwnershipOf` 与目录前缀打分工具。
- `role-spec-materials.ts` — `RoleSpecResolutionV1`：角色规格只读解析结果。

### 记录与通用编码
做命令/指纹/游标、注记、角色规格、资源上限和品牌/编码原语的去这组。
- `actor-equality.ts` — actor 身份比较：`sameActorIdentity`（两个 unknown，只比 `kind`/`id`，不算 `runRef`）与 `sameActorKindAndId`（typed actor，只比 `kind`/`id`）。
- `command-event.ts` — 命令/事件基线：`CommitCursor`、`CommandFingerprint`、`ActorRef`、`CommandIdentity`、`normalizeObjective`、`commandFingerprint`、`commandIdentityKey`。
- `data-format.ts` — 字段表格式：字段只写一次的运行时描述（`f` 的封闭字段种类，含 JSON 值 `f.json()`、`defineShape`/`defineRecord`/`defineEvent`），TS 类型由它推导（`InferShape`、`InferRecord`、`InferPending`、`InferEvent`）；描述在构造时校验，坏描述抛 `<what> description is invalid: <detail>`。值检查在 `validation/data-format.ts`，RecordStore 适配在 `src/core/work-graph/persistence/field-table-codec.ts`。
- `data-format-refs.ts` — 字段表格式可复用的 ref 描述（21 种，每种与手写 ref 类型一致）：带 `aggregateType` 的聚合 ref（含 `CurrentPointerRef`）与不带标签的 `SessionRef`/`ModuleRef`/`TaskTriple`/`ProjectScope`/`WorkspaceScope` 各自一份；7A-1 加 `DispatchCounterRefShape`（`src/contracts/data-format-refs.ts:17`），6B-3 加 `PlanRevisionRefShape`（`src/contracts/data-format-refs.ts:52`）；另导出 `id`，即 ref 内字段的非空字符串描述（按码点计，至少 1）。
- `goal-interruption.ts` — `GoalInterruption@1` 的字段表 `GoalInterruptionFields`（`src/contracts/goal-interruption.ts:18`）、推导类型 `GoalInterruptionV1`（`src/contracts/goal-interruption.ts:28`）、具名规则与格式 `GoalInterruptionFormat`（`src/contracts/goal-interruption.ts:30`）、ref 形状 `GoalInterruptionRefShape`（`src/contracts/goal-interruption.ts:10`）；一个 Goal 一条记录，`pending`/`resumed` 只由 `state/goal-interruption.ts` 写。
- `dispatch-counter-format.ts` — `DispatchCounter@1` 的字段表 `DispatchCounterFields`（`src/contracts/dispatch-counter-format.ts:5`）、推导类型 `DispatchCounterV1`（`src/contracts/dispatch-counter-format.ts:14`）、具名规则 `dispatchCounterProblem` 与格式 `DispatchCounterFormat`；规则检查正安全整数、Goal 身份和消息项目一致性。
- `error-message.ts` — `messageOf`：取 `Error.message`，否则 `String(error)`；转换本身抛错时不吞。
- `fingerprint.ts` — JCS/SHA-256 原语：`canonicalJson`、`sameJson`、`canonicalKey`、`canonicalOf`、`sha256Hex`、`CanonicalJsonError`。
- `goal-decisions.ts` — Goal/工作区决策设置、对象/选项/来源与 `decisionSourceKey`、默认设置常量；来源/卡片/请知悉的 subject 只有 `DecisionSubjectShape`/`DecisionSubjectV1` 一份（Goal 或 project 的带标签联合），身份键 `decisionSubjectKey`、取 Goal 的 `decisionSubjectGoalRef`；7A-1 加 `message_release` 卡片的条目 `MessageReleaseCardItemV1`（`src/contracts/goal-decisions.ts:160`）与它的派生字段 `releaseBlock`；7A-2 加那张卡的两个选项 id `MESSAGE_RELEASE_OPTIONS`（`src/contracts/goal-decisions.ts:157`）与派生块 `MessageReleaseBlockV1`（`src/contracts/goal-decisions.ts:178`，`blockedReason` 与三个当前值，`tasks/` 不许 import `communication/`，所以正本在 C）。
- `governance.ts` — 完成策略/架构基线的 revision、pin 与 `completionPolicyContentDigest`。
- `graph-context.ts` — 上下文装配/图读模型/注意力/任务输入页 DTO，调用种类闭集 `ContextCallKindV1` 与唯一列表 `CONTEXT_CALL_KINDS`（含 `intervention_planning`），以及 `goalContextContentV1`、`goalContextDigestV1`。
- `human-role-collaboration.ts` — 协作策略 revision/active 与 `coordinationPolicyContentDigest`。
- `keyset-cursor.ts` — 有序查找的翻页游标 `KeysetCursorV1`（`{ v: 1, goalId, after }`，只绑一个 Goal，`goalId` 为 null 是工作区页）与它的 `encodeKeysetCursor`/`decodeKeysetCursor`（base64url 的 JSON）。
- `ledger.ts` — 聚合引用/快照、`AggregateRef` 闭集、`makeCommitCursor`（`src/contracts/ledger.ts:124`）/ `seqOfCommitCursor`（`src/contracts/ledger.ts:130`）/ `compareCursors`（`src/contracts/ledger.ts:142`）；`GoalSnapshot` 带创建提交的 `since`，创建路径用预绑定的 `PendingGoalSnapshot`（`since` 为提交占位符）；每个 Goal 自带出生字段 `settings`、`continuedFrom`（`GoalContinuationV1` 或 null）和 `copiedInterventions`，缺字段的记录被拒绝。7A-1 加 `DispatchCounterRef`（`src/contracts/ledger.ts:151`）、`DispatchBasisV1`（`:152`）、`DispatchCurrentV1`（`:157`），`AggregateRef` 增 `DispatchCounterRef` 成员，并转出 `DispatchCounterV1`（`:159`）。
- `memory.ts` — `MemoryPurpose`：记忆用途闭集。
- `note.ts` — 注记 Head/Version/CurrentPointer、锚点、`NOTE_GENERAL_KINDS` 与 `renderNoteHeader`；Agent 来源带 `runRef`（Work Run）和 `queryRunRef`（秘书的 QueryRun），各自可为 null。
- `opaque.ts` — `Opaque<Value, Brand>` 品牌类型。
- `platform-duty.ts` — `PlatformDutyV1`：五种平台职责；`PLATFORM_DUTIES` 是它唯一的运行时列表。
- `resource-caps.ts` — 资源上限：`MIB`、`RESOURCE_CAP_*`、`defaultResourceCapSettings`、报告与不可用原因。
- `role-spec.ts` — 角色规格 revision/pin/权限/预算/命令与摘要、指纹、`projectRoleSpecActiveRefFor`、`roleSpecRevisionFromBinding`。
- `unknown-call-review.ts` — `UnknownCallReview` 聚合与工作区捕获。
- `utf8.ts` — `utf8ByteLength`/`truncateUtf8`：按 UTF-8 字节计长与安全截断。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `dispatchCounterProblem`、`DispatchCounterFormat` | `src/contracts/dispatch-counter-format.ts:17`、`src/contracts/dispatch-counter-format.ts:42` | 派工计数器的结构规则与字段表格式 | 计数器校验及字段表 codec 构造 |
| `GoalInterruptionFields`、`GoalInterruptionFormat`、`GoalInterruptionV1`、`GoalInterruptionRefShape` | `src/contracts/goal-interruption.ts:18`、`src/contracts/goal-interruption.ts:30`、`src/contracts/goal-interruption.ts:28`、`src/contracts/goal-interruption.ts:10` | 目标中断记录的字段表、格式与推导类型（`ref`/`revision`/`status`/`close`/`detectedAt`/`taskIds`/`runRefs`） | 记录 codec、状态构造与目标中断 owner；不要另写字段表 |
| `canonicalJson` | `src/contracts/fingerprint.ts:24` | RFC 8785/JCS 规范 JSON：键排序、拒绝非 JSON 值。 | 需要稳定字节、摘要或跨进程比较时；身份/指纹只用这一份序列化。 |
| `sameJson` **正本** | `src/contracts/fingerprint.ts:50` | 无视键顺序的 JSON 内容相等；不可编码即不相等。**正本**只此一份，别处同名的私有副本已删除，不要再写。 | 比较两个已解析值是否表示同一内容。 |
| `canonicalKey` **正本** | `src/contracts/fingerprint.ts:59` | 任意值的规范 JSON；不可编码时抛错（与 `canonicalOf` 的 null 相对）。 | 聚合 key 与记录 refKey 的唯一编码，不要另写一份。 |
| `sha256Hex` | `src/contracts/fingerprint.ts:72` | UTF-8 文本的 SHA-256 小写十六进制。 | 所有内容寻址与摘要的哈希原语。 |
| `f` | `src/contracts/data-format.ts:132` | 字段表的封闭字段种类：字符串（字节/码点上限）、sha256、整数、有限数、revision、字面量（字符串、安全整数或布尔）、枚举、布尔、JSON 值、ref、游标、可绑定游标、ISO 时间、optional/nullable、数组、精确对象、判别联合。 | 新记录、事件或嵌套形状写字段表时；不在此列的是具名规则（`rules`）或留手写。 |
| `defineShape`、`defineRecord`、`defineEvent` | `src/contracts/data-format.ts:250`、`src/contracts/data-format.ts:314`、`src/contracts/data-format.ts:346` | 构造并校验嵌套形状、存储记录（`ref` 是本 `aggregateType` 的完整带标签 ref，`revision` 是 `f.revision` 或 `f.literal(1)`，可带 lookup）和事件（字段不含四个信封键）。 | 新格式只写这一份字段表；类型用 `InferRecord`/`InferPending`/`InferEvent` 推导，不再手写一份。 |
| `ProjectRefShape` 等 18 个 ref 描述 | `src/contracts/data-format-refs.ts:12` | `ProjectRefShape`、`WorkspaceRefShape`、`GoalRefShape`、`DispatchCounterRefShape`、`SessionRefShape`、`SessionAggregateRefShape`、`ModuleRefShape`、`QueryJobRefShape`、`QueryRunRefShape`、`QueryJobAnswerRefShape`、`SessionMessageRefShape`、`TaskTripleShape`、`RunRefShape`、`OperationRefShape`、`PlanProposalRefShape`、`PlanRevisionRefShape`、`TaskRequeueRefShape`、`VerificationRoundRefShape`。 | 字段表里的 `f.ref(...)`；不要另写只查 `aggregateType`/`projectId` 的通用 ref 检查。 |
| `ProjectScopeShape`、`WorkspaceScopeShape`、`CurrentPointerRefShape` | `src/contracts/data-format-refs.ts:66`、`src/contracts/data-format-refs.ts:67`、`src/contracts/data-format-refs.ts:68` | 不带标签的 `{ projectId }`、`{ projectId, workspaceId }` 范围和带标签的 `CurrentPointerRef`（ref 描述共 21 个）。 | 字段表里写范围或注记当前指针时；不要另写一份。 |
| `id` | `src/contracts/data-format-refs.ts:10` | ref 内字段的非空字符串描述（`min: 1`，按码点计）。 | 写 ref 的字段表时复用；不要另写 `f.string({ min: 1 })`。 |
| `SessionActivityFormat`、`SessionActivityRefShape` | `src/contracts/session-activity.ts:40`、`src/contracts/session-activity.ts:37` | Session 活动记录的字段表和它的 ref；两条规则：`session` 与 ref 同一个 Session、`source` 在同一项目且种类对得上。 | 写或读 Session 的最后活动；类型用 `SessionActivityV1`，不要手写。 |
| `SessionActivityRef`、`SessionActivityV1`、`SessionActivityKindV1`、`SessionActivitySourceV1` | `src/contracts/session-activity.ts:60`、`src/contracts/session-activity.ts:61`、`src/contracts/session-activity.ts:62`、`src/contracts/session-activity.ts:64` | 由字段表推导的活动引用、记录、类别和来源类型。 | 供活动状态、codec 和读取使用。 |
| `GoalScreeningShape`、`GoalScreeningV1` | `src/contracts/query-job.ts:217`、`src/contracts/query-job.ts:226` | 目标卡草稿的筛选：模块、规模、冲突/依赖 Goal、紧急度、从 0 起的建议位次、≤512 UTF-8 字节的说明。 | 目标卡草稿的 `screening` 和绑定记录的 `screening`；没有筛选时为 null，不要自己补一个。 |
| `InitializationBindingFormat`、`InitializationBindingV1`、`InitializationBindingRefShape`、`InitializationBindingRef`、`INITIALIZATION_BINDING_BY_ANSWER_DRAFT_LOOKUP`、`INITIALIZATION_BINDING_BY_GOAL_LOOKUP` | `src/contracts/initialization-binding.ts:52`、`src/contracts/initialization-binding.ts:71`、`src/contracts/initialization-binding.ts:46`、`src/contracts/initialization-binding.ts:70`、`src/contracts/initialization-binding.ts:50`、`src/contracts/initialization-binding.ts:51` | 初始化绑定记录和它的类型、它的 ref 形状和 ref 类型、两条规则和两个查找名（回答+草稿五条路径、按 Goal 两条路径）。 | 确认所有者写绑定、按回答或 Goal 读绑定；类型用 `InitializationBindingV1`，不要另写字段表。 |
| `InitializationAdoptionRefShape`、`InitializationAdoptionRef` | `src/contracts/initialization-adoption.ts:13` | P11 初始化采用的聚合 ref（`aggregateType: 'InitializationAdoption'`、`projectId`、`operationId`）和推导出的 ref 类型；也是 `AggregateRef` 的联合成员。 | 写/读采用记录、操作进度和 `Ledger` 的 ref 时；不要另写只查 `aggregateType` 的 ref 检查。 |
| `INITIALIZATION_ADOPT_STAGES`、`InitializationAdoptStageV1` | `src/contracts/initialization-adoption.ts:35` | 八个采用阶段的唯一有序列表（`admission`…`apply`）和阶段字面量类型。 | 记录进度、判断完成前缀和恢复读时；不要另写阶段数组。 |
| `initializationAdoptionOperationId` | `src/contracts/initialization-adoption.ts:21` | 采用操作定位：scope、source 与 expected Goal 的 ref 的规范 JSON 的 SHA-256；不含 `commandId`、generation 或单独的 `goalId`。 | `accept` 与新一次授权提交找同一操作；不要另写定位配方。 |
| `InitializationSourceShape`、`InitializationSourceV1` | `src/contracts/initial-planning.ts:38`、`src/contracts/initial-planning.ts:44` | 初始化计划的来源：`binding`（回答 + 草稿号）或 `prepared_goal`（回答）。 | 读取/采用初始化计划时指定来源；不要从回答文本猜来源。 |
| `InitialPlanOriginSourceV1`、`InterventionAnswerSourceV1` | `src/contracts/initial-planning.ts:14`、`src/contracts/initial-planning.ts:21` | 初始 Plan 的 origin 来源选择：`binding`/`prepared_goal`/`plain`/`intervention` 四臂，以及干预臂的 `{ kind: 'intervention', messageRef }`。 | 规范化写 origin、读取/采用重核时；干预选择器只校验完整消息 ref，不比较 `answerRef`。 |
| `InitialPlanSourceResolutionV1`、`InitialPlanAnswerFacts` | `src/contracts/query-job.ts:636`、`src/contracts/query-job.ts:644` | 来源与 Goal 只解析一次的产物：plain/binding/prepared_goal/`intervention` 四臂，`bindingRef`、Goal 与 `goalRevision`；干预臂带回 `InterventionAnswerSourceV1`。 | 初始 Plan 的规范化、提案与采用重核；不要另写来源解析。 |
| `GoalContinuationV1` | `src/contracts/ledger.ts:74` | 接续来源：被接续的 Goal、它当时的 revision 和可选的理解注记版本。 | Goal 的 `continuedFrom`；不接续时为 null。 |
| `CanonicalJsonError` | `src/contracts/fingerprint.ts:18` | 规范 JSON 编码失败的错误类型。 | 需要捕获并区分不可编码值时。 |
| `messageOf` **正本** | `src/contracts/error-message.ts:2` | 把 unknown 错误转成可读文本：`Error.message`，否则 `String(error)`；转换抛错不吞。 | 统一错误文本；不要再另写一份副本。 |
| `sameActorIdentity` | `src/contracts/actor-equality.ts:4` | 两个 unknown 的 actor 身份：只比 `kind`/`id`，`runRef` 不参与。 | 宽容读入的历史 actor 比较。 |
| `sameActorKindAndId` | `src/contracts/actor-equality.ts:9` | 两个 typed actor 只比 `kind`/`id`，不另做形状检查。 | 已校验形状的 actor 比较。 |
| `commandIdentityKey` | `src/contracts/command-event.ts:108` | 命令幂等身份键：projectId、actor、idempotencyKey、agentPrincipal。 | 命令幂等/replay 查重；不要退回只比 idempotencyKey。 |
| `commandFingerprint` | `src/contracts/command-event.ts:90` | `CreateGoalCommand` 的内容指纹（JCS + SHA-256）。 | Goal 创建命令的幂等/replay；其他命令用自己的配方。 |
| `normalizeObjective` | `src/contracts/command-event.ts:86` | Unicode NFC + 首尾空白裁剪。 | 指纹与存储 Goal 目标之前。 |
| `queryJobRefFor` | `src/contracts/query-job.ts:208` | 由三个身份分量构造 `QueryJobRef`。 | 生产 Query 引用；不要手拼 aggregate 对象。 |
| `RequestUnderstandingCommandV1` | `src/contracts/query-job.ts:63` | 内部 `request_understanding` 命令的唯一格式：操作、代、请求根、每个 Goal 的指针与检查版本、checkedRound 与 live/closed/consumed。 | 交接的 understanding 代写、准备/启动读取与 Runtime 模板；不要另写一份命令形状。 |
| `QueryJobV1` 的 `understanding`、`SecretaryRoundMaterialV1` 的 `command` | `src/contracts/query-job.ts:401`、`src/contracts/query-job.ts:30` | 一次存储一次投影：Job 上的 `understanding` 是唯一副本（其余 Query 与历史记录为 null），材料的 `command` 由 `round.job.understanding` 投影。 | 存/读 understanding 命令；不要另存第二份，也不要另拼一份命令形状。 |
| `SecretaryRequestManifestV1` 的 `briefRef`、`understandingGrants` | `src/contracts/query-job.ts:45` | 请求清单冻结的两项：后继者的简报操作（没有则 null）和仍有效的 understanding 授予（按轮次再按批次顺序、每个 Goal 一条）。 | 准备与启动读取、Runtime 清单；冻结一次，不在原地替换。 |
| `RequestCommandReceiptV1` 的 `understanding` 臂 | `src/contracts/query-job.ts:231` | 内部 `request_understanding` append 的回执：`{ kind: 'understanding'; round }`。 | 写/重放内部命令时；不要借用 `route` 臂或写空回执。 |
| `consultationQueryRefs` | `src/contracts/query-job.ts:90` | 由 `SessionMessageRef` 派生咨询 QueryJob/QueryRun 引用。 | 消息驱动的咨询 Query；外层重试因此落在同一对记录上。 |
| `interventionPlanningQueryRefs` | `src/contracts/query-job.ts:104` | 由真实来源消息 ref 派生 `intervention_planning` 的 QueryJob/QueryRun 固定 id（含 `intervention-planning-` 前缀）。 | 创建/重试这条计划 Query 时；重试落在同一对记录上，不要手拼 id。 |
| `validQueryExecution` | `src/contracts/query-job.ts:354` | 校验 Query 意图的 execution 绑定。 | 接受 Query 意图前做纯输入校验。 |
| `isRequestRound` | `src/contracts/query-job.ts:492` | 唯一判别：`job.roundKind !== null`。 | 所有 request round 分支；不要另写判别。 |
| `parseInitialPlanningResponseV2` | `src/contracts/initial-planning-parse.ts:18` | 初始规划 v2 回答的外层协议：一个 JSON 对象、`schemaVersion` 2、`plan` 或 `needs_decision` 的外形；不修补模型的计划，计划内容由 Plan 校验器判断。 | 读初始规划回答或秘书 `initial_coordination` 回答；不要另写 v2 JSON 解析。 |
| `queryExecutionBindingOf` | `src/contracts/query-job.ts:503` | 普通 Query 读 intent；request round 读该 attempt 的 `executionState.roleBinding/requestProfile`，缺 profile 抛错。 | 所有读 Query 绑定或预算的地方。 |
| `decisionSourceKey` | `src/contracts/goal-decisions.ts:245` | 决策来源身份键；`planning_question` 带 `binding` 选择器时键里多出 `binding` 一项，不带时键逐字节不变。 | 决策来源去重/幂等。 |
| `DecisionSubjectShape`、`DecisionSubjectV1` | `src/contracts/goal-decisions.ts:89`、`src/contracts/goal-decisions.ts:95` | 决定来源/卡片/请知悉的 subject 字段表与推导类型：`{ kind: 'goal', goalRef }` 或 `{ kind: 'project', projectRef }`，旁边不再有第二个 `goalRef` 字段。 | 构造或读 `subject`；不要另写一份只认 Goal 的 subject 形状。 |
| `decisionSubjectKey` | `src/contracts/goal-decisions.ts:97` | subject 的带标签规范键。 | 读侧按 subject 分组/排序；不要手拼字符串。 |
| `decisionSubjectGoalRef` | `src/contracts/goal-decisions.ts:110` | 对已校验的 subject 收窄（来源、卡片、请知悉）：goal 返回 `goalRef`，project 或缺失返回 `null`；不代替输入形状校验。 | 每个来源/卡片分支只经这一处收窄；不要自己再写一份 `goalRefOf`。 |
| `requirementKeyOf` | `src/contracts/evidence.ts:130` | 由 obligationId 与 requirementId 生成键。 | 证据覆盖与需求查找。 |
| `edgeDeclarationId` | `src/contracts/input-declaration-id.ts:5` | 内容派生的执行 DAG 边 `edge:` 声明 id。 | 计划输入声明。 |
| `legacyDeclarationId` | `src/contracts/input-declaration-id.ts:14` | `inputRequirements` 条目的 `legacy:` 声明 id。 | 兼容旧计划输入时。 |
| `makeCommitCursor` | `src/contracts/ledger.ts:124` | 由序号构造 `CommitCursor`。 | 合成/测试游标；生产写入从提交回执取真实游标。 |
| `seqOfCommitCursor` | `src/contracts/ledger.ts:130` | 从 `CommitCursor` 取回序号。 | 排序、日志与范围比较。 |
| `compareCursors` | `src/contracts/ledger.ts:142` | 两个游标的顺序：都是 ledger 游标时按序号，否则按文本。 | 排序、日志与范围比较；`queries/request-rounds-read.ts` 转出这一份，不要另写。 |
| `encodeKeysetCursor`、`decodeKeysetCursor` | `src/contracts/keyset-cursor.ts:11`、`src/contracts/keyset-cursor.ts:18` | 有序查找页的游标：把 Goal（或 null，工作区页）和页的 `next` 原样编成 base64url；解码只认 `v` 为 1 且 `goalId` 相同的游标，否则 `null`。不查 `after` 和页宽，坏值由存储的有序请求规则拒绝。 | 按 Goal 或工作区翻 `lookupOrdered` 的页时；不要另写私有游标。 |
| `completionPolicyContentDigest` | `src/contracts/governance.ts:106` | 完成策略正文摘要。 | 安装/激活 revision 前对齐摘要。 |
| `coordinationPolicyContentDigest` | `src/contracts/human-role-collaboration.ts:88` | 协作策略正文摘要。 | 安装/激活协作策略 revision。 |
| `roleSpecContentDigest` | `src/contracts/role-spec.ts:156` | 角色规格正文摘要。 | 安装/激活角色规格。 |
| `projectRoleSpecActiveRefFor` | `src/contracts/role-spec.ts:153` | 构造 `ProjectRoleSpecActiveRef`。 | 读写项目当前角色规格指针。 |
| `roleSpecRevisionFromBinding` | `src/contracts/role-spec.ts:164` | 从 `templateRevision` 十进制解析 revision，非法即 null。 | claim 绑定校验；不得猜一个 revision。 |
| `installRoleSpecRevisionFingerprint` | `src/contracts/role-spec.ts:226` | `InstallRoleSpecRevision` 命令指纹。 | 该命令的幂等与 replay。 |
| `activateRoleSpecRevisionFingerprint` | `src/contracts/role-spec.ts:235` | `ActivateRoleSpecRevision` 命令指纹。 | 该命令的幂等与 replay。 |
| `CONTEXT_CALL_KINDS` **正本** | `src/contracts/graph-context.ts:31` | 九种上下文调用种类的唯一运行时列表（`ContextCallKindV1`，含 `intervention_planning`）。 | 解码/校验调用种类时；不要再另写一份列表。 |
| `goalContextDigestV1` | `src/contracts/graph-context.ts:205` | Goal 上下文内容摘要。 | 比较 Goal 内容是否变化。 |
| `pathOwnershipOf` | `src/contracts/path-ownership.ts:36` | 最长前缀路径归属，返回 owner/none/tie 与命中前缀。 | 文件到模块/范围归属；全仓唯一实现，不要另写。 |
| `bestModuleDirectoryPrefixLength` | `src/contracts/path-ownership.ts:93` | 候选模块路径的最佳公共目录段数。 | 归属打平后的回退排序/打分。 |
| `validMaterialSourcePin` | `src/contracts/material-access.ts:66` | 校验材料来源 pin 的结构与摘要。 | 读取/接受 material basis 前。 |
| `sameArtifactRef` | `src/contracts/material-access.ts:85` | 按 contentType/digest/size 比较 artifact 引用。 | artifact 去重与身份比较；artifact 引用只按这三个字段比。 |
| `sameArtifactOwnerRunRef` | `src/contracts/material-access.ts:88` | 比较 artifact 的 Run/QueryRun 所有者。 | 归属与读取授权判断。 |
| `defaultResourceCapSettings` | `src/contracts/resource-caps.ts:25` | 按本机内存算默认 memory 上限与 tasksMax。 | Host 未配置资源上限时的默认值。 |
| `validateRuntimeBudget` | `src/contracts/runtime-budget.ts:29` | 归一/校验不可信预算；累积上限保持 null。 | HTTP 或边界接受预算时。 |
| `provenNotEnteredKernel` | `src/contracts/run-activity.ts:128` | 判定已结束 Run 是否可证明未进入 Kernel。 | 无进展/返工判断；running 必须当作不完整。 |
| `unknownFacts` | `src/contracts/run-activity.ts:104` | 带规则版本的显式 unknown 活动读数，detail 截到 500 字；唯一构造。 | Runtime 读窗口失败、WorkGraph 收尾提交没拿到 tally 时；不要写 0，也不要另写构造。 |
| `isAutomationActor` | `src/contracts/task-requeue.ts:57` | 判断 actor 是否为平台自动化 actor。 | 归因分类与权限判断。 |
| `reworkActorClassOf` | `src/contracts/task-requeue.ts:75` | 由 principal 与 actor 定 agent/system/human。 | 返工/重跑归因；`query_run` 返回 null。 |
| `isReviewRoundPurpose` | `src/contracts/review-admission.ts:57` | 判断 Run 是否为审查/提案轮。 | 审查准入分支；缺失 purpose 是普通工作。 |
| `reviewHostLayerOneAccess` | `src/contracts/review-admission.ts:96` | Host 第一层工具与只读命令访问判定。 | 准入与审查能力查询共用同一判据。 |
| `reviewRoundAdmissionProblem` | `src/contracts/review-admission.ts:127` | 审查轮固定工具集、空写范围、角色与 Host 准入。 | 审查 Run 启动与执行前复核。 |
| `newBasisInputProblem` | `src/contracts/no-progress.ts:56` | 判断输入能否作为新依据。 | requeue/reverify 两个所有者共用；平台生成正文与未回应消息不算。 |
| `continuationBriefDigest` | `src/contracts/continuation-brief.ts:302` | 简报摘要 `sha256Hex(canonicalJson(brief))`。 | 固定 `inputBinding.continuationBriefDigest`。 |
| `continuationBriefMarker` | `src/contracts/continuation-brief.ts:306` | 简报第二行的标记文本。 | 重渲染后逐字比对。 |
| `compareSourceCheckpoints` | `src/contracts/continuation-brief.ts:316` | 比较两个持久化来源戳，无法判定即 `unknown`。 | 判断工作区是否变化。 |
| `renderContinuationBriefZh` | `src/contracts/continuation-brief.ts:530` | 渲染中文续接简报；强制段放不下时抛容量错误。 | 准备 requeue Run 的输入段。 |
| `approvedMethodLinesZh` | `src/contracts/continuation-brief.ts:1039` | 渲染已批准方法的固定行。 | 简报审查段的必选块。 |
| `continuationBriefShapeProblem` | `src/contracts/continuation-brief.ts:1298` | 校验简报结构，返回首个问题或 null。 | 读回/接受简报时。 |
| `ContinuationBriefCapacityError` | `src/contracts/continuation-brief.ts:1120` | 简报强制段超出字节上限的错误。 | 调用方把它映射为 `capacity` 拒绝。 |
| `renderNoteHeader` | `src/contracts/note.ts:115` | 渲染 `<类名>(<锚点>)<!>：<结论>` 标题。 | 展示注记；结构性问题才带 `!`。 |
| `planValidationError` | `src/contracts/plan.ts:303` | 构造 `{path,code,message}` 计划校验错误。 | 计划校验累积错误时。 |
| `revisionAssignments` | `src/contracts/plan.ts:309` | 取计划 assignment；显式空数组覆盖 origin。 | 读取已接受计划的分配。 |
| `moduleMappingsOf` | `src/contracts/architecture-catalog.ts:81` | 从架构目录取模块到路径映射。 | 检查/比较架构归属。 |
| `architectureBaselineRevisionRefShape`、`architectureCatalogRefShape`、`architectureCatalogPinShape` | `src/contracts/architecture-catalog.ts:93`、`src/contracts/architecture-catalog.ts:98`、`src/contracts/architecture-catalog.ts:112` | 架构 baseline/catalog 引用与完整 `ArchitectureCatalogPinV1` 的 R1 字段表形状；pin 形状要求 `catalogRef` 的 project/baseline/revision 与 `baseline.ref` 一致。 | 字段表里校验已存的架构 pin；不要另写形状或同源检查。 |
| `isAutoCaptureTrigger` | `src/contracts/architecture-observation.ts:23` | 校验自动捕获触发名。 | 读记录或请求时。 |
| `compactUnresolvedLines` | `src/contracts/architecture-source.ts:40` | 去重排序后压缩未解析行，遵守行数/字节上限。 | 保存架构源快照前。 |
| `architectureSourceIssues` | `src/contracts/architecture-source.ts:55` | 架构源绑定的结构、重复项与容量校验。 | 接受/读回架构源时。 |
| `artifactBodyDigest` | `src/contracts/artifact.ts:29` | 正文的 SHA-256 内容地址，与 `sha256Hex` 同一算法；只用于 artifact 正文。 | 写入/校验 artifact。 |
| `artifactBodySize` | `src/contracts/artifact.ts:32` | 正文的 UTF-8 字节数，与 `src/contracts/utf8.ts:13` 的 `utf8ByteLength` 同一计数口径。 | artifact 大小上限校验。 |
| `truncateUtf8` | `src/contracts/utf8.ts:22` | 按 UTF-8 字节截断且不劈开码点。 | 生成展示或声明文本时。 |
| `COVERAGE_ISSUES_MAX` | `src/contracts/architecture-inspection.ts:112` | 覆盖率问题列表上限。 | 生成 coverage 报告时截断。 |
| `AUTO_CAPTURE_TRIGGERS`、`AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS` | `src/contracts/architecture-observation.ts:18`、`src/contracts/architecture-observation.ts:29` | 自动捕获触发闭集与失败原因上限。 | 记录/校验自动捕获。 |
| `SNAPSHOT_UNRESOLVED_MAX_LINES`、`SNAPSHOT_UNRESOLVED_MAX_BYTES` | `src/contracts/architecture-source.ts:32`、`src/contracts/architecture-source.ts:33` | 未解析行的行数/字节上限。 | 保存快照前截断。 |
| `ARTIFACT_MAX_SIZE_BYTES` | `src/contracts/artifact.ts:6` | Artifact 正文最大字节数。 | artifact 写入校验。 |
| `K3_CRR_BY_TASK_ALIAS_INDEX`、`K3_CRR_BY_GOAL_STATE_INDEX`、`K3_CRR_BY_TASK_INDEX` | `src/contracts/command-rerun-request.ts:64` | `CommandRerunRequest` 的三个注册索引名。 | 读写/查询 CRR 时按名引用。 |
| `CONTINUATION_BRIEF_LIMITS` | `src/contracts/continuation-brief.ts:280` | 简报各项条数/字节上限。 | 组装或渲染简报。 |
| `TERMINAL_PAYLOAD_TEXT_MAX_CHARS`、`TERMINAL_PAYLOAD_TRUNCATION_SUFFIX` | `src/contracts/dispatch.ts:218`、`src/contracts/dispatch.ts:220` | 终止 payload 文本上限与截断后缀。 | 记录/展示终止原因时截断。 |
| `EVIDENCE_SUMMARY_MAX_BYTES`、`EVIDENCE_OUTCOMES` | `src/contracts/evidence.ts:55`、`src/contracts/evidence.ts:60` | 证据摘要上限与结局闭集。 | 证据校验与展示。 |
| `DEFAULT_GOAL_SETTINGS_V1`、`DEFAULT_WORKSPACE_DECISION_SETTINGS_V1` | `src/contracts/goal-decisions.ts:44`、`src/contracts/goal-decisions.ts:64` | Goal/工作区决策默认设置。 | Goal 的那份只是 `goals/create` 的出生值，没有 `settings` 的 Goal 记录被拒绝、不读成默认；工作区的未配置时取默认。不要另抄一份。 |
| `MANIFEST_CONTENT_TYPE`、`QUERY_MANIFEST_CONTENT_TYPE`、`REPORT_CONTENT_TYPE`、`PLATFORM_GENERATED_CONTENT_TYPES`、`MAX_NEW_BASIS_INPUT_REFS` | `src/contracts/no-progress.ts:21` | 平台生成正文类型与新依据输入上限。 | 判定内容类型/新依据时。 |
| `NOTE_GENERAL_KINDS` | `src/contracts/note.ts:50` | 通用注记种类闭集。 | 校验/分组注记。 |
| `PLATFORM_DUTIES` **正本** | `src/contracts/platform-duty.ts:13` | 五种平台职责的唯一运行时列表，顺序同 `PlatformDutyV1`；它由以 `PlatformDutyV1` 为键的表取键，少一个职责就编译不过。 | 运行时校验职责或按职责遍历；不要再另写一份职责列表。 |
| `MIB`、`RESOURCE_CAP_DEFAULT_TASKS_MAX`、`RESOURCE_CAP_DEFAULT_MEMORY_CEILING_MIB`、`RESOURCE_CAP_MIN_MEMORY_MIB`、`RESOURCE_CAP_MIN_TASKS`、`RESOURCE_CAP_MAX_TASKS` | `src/contracts/resource-caps.ts:10` | 资源上限的单位、默认与边界。 | 计算/校验资源设置。 |
| `UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES`、`UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES` | `src/contracts/review-admission.ts:29`、`src/contracts/review-admission.ts:38` | 审查轮/提案轮的固定工具集。 | 准入判定与审查能力查询。 |
| `ROLE_SPEC_REVISION`、`ROLE_RESPONSIBILITIES`、`ROLE_MATERIAL_KINDS`、`ROLE_OUTPUT_KINDS` | `src/contracts/role-spec.ts:45` | 角色规格版本、职责、材料与输出闭集。 | 校验/生成角色规格。 |
| `RUN_ACTIVITY_RULE_VERSION`、`ACTIVITY_QUARTER_CAP`、`RUN_CHANGED_FILES_CAP`、`RUN_USAGE_REQUESTS_CAP`、`ACTIVITY_RECENT_WINDOW_DAYS`、`ACTIVITY_READ_RECORD_CAP`、`RUN_ACTIVITY_MAX_PAGES`、`FILE_EDIT_TOOL_NAMES`、`ACTIVITY_AUTO_RETRY_REASONS` | `src/contracts/run-activity.ts:9` | 活动读数的规则版本、各项上限与自动重试原因。 | 计算/读取 Run 活动。 |
| `DEFAULT_RUNTIME_BUDGET`、`MAX_RESPONSE_TOKENS` | `src/contracts/runtime-budget.ts:19`、`src/contracts/runtime-budget.ts:21` | 默认预算与单次响应 token 上限。 | 归一预算时。 |
| `WORKFLOW_AUTOMATION_ACTOR`、`GOAL_FAN_OUT_ACTOR`、`SESSION_ARCHIVE_AUTOMATION_ACTOR`、`PLATFORM_AUTOMATION_ACTORS`、`REWORK_FAILURE_CLASSES`、`DEFAULT_AUTO_REWORK_LIMIT`、`MAX_AUTO_REWORK_LIMIT`、`DEFAULT_TASK_AUTOMATION_POLICY`、`TASK_REWORK_REASON_MAX_CHARS`、`TASK_REWORK_REFUSAL_CODES` | `src/contracts/task-requeue.ts:29` | 自动化 actor 闭集、返工失败分类、自动返工上限与默认策略。 | 归类 actor、校验返工与拒绝原因。 |
| `UNKNOWN_CALL_APPROVED_METHODS_MAX_BYTES`、`UNKNOWN_CALL_REVIEW_T02_REASON` | `src/contracts/unknown-call-review.ts:186`、`src/contracts/unknown-call-review.ts:195` | 已批准方法文本上限与 T02 原因文本。 | 生成/展示审查记录时。 |
| `CHANGE_SCOPE_MAX_FILES`、`ROUND_CHECK_INCOMPLETE_CAUSES`、`INTERRUPTED_CHECK_GAP_CODE`、`ROUND_CHAIN_MAX` | `src/contracts/verification.ts:14` | 变更范围上限、未完成原因闭集、中断缺口码与轮链上限。 | 验证轮校验。 |
| `CopyInterventionStateV1`、`CopyInterventionCandidateV1` | `src/contracts/goal-copy-retraction.ts:4`、`src/contracts/goal-copy-retraction.ts:11` | 复制取消的候选状态闭集（`withdrawn`/`applied`/`rejected`/`copied`/`delivered`/`not_delivered`）与候选 DTO（消息 ref、版本、状态、可选/可撤回及各自原因）。 | 候选规则与 copy 端口引用候选类型时；不要另写候选形状。 |

## 内部用

只在本层内部调用，外部请用其公开包装：`commonDirectoryPrefixLength`、`utf8ByteLength`、`validMaterialSourceSet`、`goalContextContentV1`、`templateToolNames`。

## 不要做

- 不要在本层 import `src/core`、`src/app`、`src/business`、`src/composition` 的实现，或加入 I/O、时钟、状态机；状态迁移只经过 `src/core/work-graph/state/`。
- 不要另写 `rejection`/结果包装；用 `rejected*` 与 `ReadResult`/`WriteResult` 原语（**M1-29**）。
- 不要另写 JSON 相等比较；`sameJson` 的唯一正本在本表（`fingerprint.ts`），别处同名的私有副本已删除。
- 不要在 `app`/`agent-runtime`/`queries` 另写 `messageOf`；正本是 `src/contracts/error-message.ts:2`（M1-38），旧副本已删除。
- 不要在公共命令身份/指纹里塞入会变的选中事实、当前 revision 或重试数据（**M1-25, MH-03**）。
- 不要另写规范 JSON、相等或哈希；也不要另造聚合 key（**M1-32**）。
- 不要用裸局部 ID 作记录键，或只校验一半的引用形状（**M1-31, CS-04**）。
- 不要把读取失败折叠成空事实、普通阻塞或成功完成（**FP-05, M1-12, M1-15, MH-06**）。
