# T 轮 P2a：`src/core/work-graph/` 里只为旧数据/旧接口存在的生产代码

- 只读审查：没有运行测试、构建或类型检查；没有改动仓库文件，唯一写入是本报告。
- 范围：`src/core/work-graph/**`（215 个文件、约 114,600 行）中生产走得到、但只为旧格式/旧接口存在的代码；决定 79-1、79-4。`legacy_template` 是当前在用的角色配置，按任务书不报。
- 方法：先按 `schemaVersion`、`legacy`、`earlier`、`older`、`compat`、`migrat`、`tolerat`、`pre-`、`old ` 全量扫描；三片交子代理（Plan 版本 / Run-Auth 版本 / 其余），主会话合并、去重并抽查了证据（下文标“已抽查”的条目由主会话直接看过 writer 与测试）。`rg` 在本机不可用，writer 证明统一用 `grep -rn`/`git grep`。
- 结果：28 行。22 条 `old-data`、3 条 `legacy`、3 条核后 `keep`。估计可删/改约 1,334 行生产代码，其中约 850 行是 Session legacy-provenance 整链；测试侧行数未计。

## 发现表

| 编号 | 类别 | 位置（path:line range，symbol/测试名） | 证据（含 writer 证明） | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---|---|
| P2a-01 | old-data | `src/contracts/plan.ts:221-227,263-272`；`src/core/work-graph/tasks/plan-commit-compiler.ts:127-162`；`src/core/work-graph/tasks/plan-service.ts:1500-1535`；`src/core/work-graph/state/plan-machine.ts:1030-1060,1388-1410` | 读/写 PlanRevision 内容 v1：`PlanRevisionDraft`/`PlanRevisionSnapshot` 的 v1 联合臂、`buildPlanRevisionSnapshot` 的非 v2 兜底。**writer 证明：当前仍能写 v1**——Host `plans/propose`（`core-routes.ts:1067`）→ `proposePlan`（`plan-service.ts:1526`）不校验 `draft.schemaVersion`，初始 adoption 走到 `plan-commit-compiler.ts:162` 写出 v1 快照；`grep -n "draft\\.schemaVersion" plan-service.ts plan-validation.ts` 无命中（已抽查）。Agent 路径反而在 `plan-machine.ts:1049` 拒绝 v1。 | `change`：入口拒收 v1 draft（一行 `rejected('invalid', ...)`），`buildPlanRevisionSnapshot` 固定 v2，删 `:1049-1050`/`:1400-1407`/`compiler:347` 的 v1 拒绝步骤 | 初始 v2：`tests/work-graph/R5b-initial-plan.test.ts:178`；future v2：`tests/work-graph/W1-future-plan.test.ts:363` | 17 | 79-1（HANDOFF:565） | 高 |
| P2a-02 | old-data | `src/core/work-graph/tasks/plan-service.ts:770,977`；`plan-readers.ts:1347,2277`；`plan-validation.ts:306-311`；`plan-task-basis.ts:106,244`；`evidence-coverage.ts:64`；`context-input-service.ts:364`；`execution-entry-service.ts:990`；`views/graph-context-reader.ts:914,1143`；`views/task-state-timeline.ts:270` | 9 个 reader 的 v1 三目/早退：`plan.schemaVersion === 2 ? <v2 字段> : <空>` 或 `!== 2` 直接返回空。v1 联合臂没有 `taskRelations`/`inputRequirements`/`taskStateBasis`/`dispositionRecord`，另一支恒为空。**writer 证明**：这些字段只由 v2 分支写（`plan-commit-compiler.ts:158,412`、`initial-plan.ts:107`），grep 无 v1 写点。 | `delete`：三目改直接读 `?? []`/`?? undefined`；`plan-task-basis.ts:106` 只删 `plan.schemaVersion === 2 &&`（保留“缺 basis=self”当前语义）；`context-input-service.ts:363-365` 删 `legacyRequirements` helper | 各 reader 的 v2 用例：`A2-disposition-change.test.ts:296,352`、`R3c-task-relations.test.ts:81`、`R3e-evidence-coverage.test.ts:103`、`S3-context-inputs.test.ts:670`、`S2B-31-task-timeline-main.test.ts:20` | 21 | 79-1 | 高 |
| P2a-03 | old-data | `src/core/work-graph/persistence/plan-record-codecs.ts:1-12,521-522,572-583` | 同一 `PlanRevisionSnapshot@1` codec 接受内容版本 1 或 2，并对 v1 额外执行“不得带 v2 字段”的禁令；v1 分支只服务旧 body。P2a-01 收紧后没有 writer 产 v1。 | `delete`：`:522` 改 `!== 2`；删整段 `if (schemaVersion === 1) {...} else if (schemaVersion === 2) {`，只留 v2 块；改文件头“v1/v2”说明 | 当前格式：`tests/work-graph/R3c-task-relations-boundaries.test.ts:94`；v1 body 改为必须 invalid | 12 | 79-1 | 高 |
| P2a-04 | old-data | `src/core/work-graph/state/plan-machine.ts:103-108,1245-1251,1623-1625,1709-1711`；`src/core/work-graph/persistence/plan-record-codecs.ts:741,800-818,997-1021`；`src/contracts/goal-change.ts`（`PlanProposalSnapshot` 链） | 旧 `PlanProposal@1`：解码成 `kind:'legacy_v1', draft:null`，accept/replace/abandon 一律 `unsupported`。**writer 证明**：`grep -n "kind: 'legacy_v1'" src` 只有类型定义与解码；`newCandidateProposal` 只产 `candidate_v2`，`encodePlanProposal` 固定 `PlanProposal@2`，无构造点。 | `delete`：类型/联合/三处 `case 'legacy_v1'`、legacy 校验与解码视图、`PlanProposalSnapshot`/`PlanPatchV1`（确认无其他消费者后） | `tests/work-graph/S5-request-candidates.test.ts:58-291` RC01-RC10；`tests/state/plan-machine.test.ts` 的 candidate 表 | 60 | 79-1 / 79-4 | 高 |
| P2a-05 | old-data | `src/contracts/plan.ts:83-100,286-300`；`src/core/work-graph/state/plan-machine.ts:78-85`；`src/core/work-graph/model/plan-contracts.ts`（无版本分派） | 核后 keep：`taskStateBasis` 缺失=每个 Task 指向本 Plan，因为**初始计划 writer 现在就不写 basis**（`plan-commit-compiler.ts:127-162`，只有 future adoption `:412` 写）；未署名 acceptance 的四字段是当前可达分支（`plan-service.ts:1564-1567` 可选）；`requestRef/notAdopted` 是同 v2 格式的可选增量。 | `keep`（只需改“legacy/pre-slice”注释措辞） | `R5b-initial-plan.test.ts:178`、`A2-entry-plan.test.ts:70,130`、`S5-request-candidates.test.ts:269` | 0 | — | 高 |
| P2a-06 | old-data | `src/contracts/dispatch.ts:112-116,223` | `ExecutionAuthorizationV1`（无 `schemaVersion` 字段，phase 含 `quarantined`）仍挂在 `RunSnapshot.executionAuthorization` 联合上。**writer 证明**：`grep -rn "executionAuthorization:" src` 全在 `run-machine.ts` 且写 V2（`:864`、`:960`）；`grep -rn "phase: 'quarantined'" src` 无构造点。 | `delete`：删 V1 类型与联合成员，保留 `executionAuthorization?: ExecutionAuthorizationV2` 与“缺省=starting/Claimed”的当前语义 | V2：`tests/work-graph/B2-execution-entry.test.ts:215`、`A2-entry-plan.test.ts:219`、`tests/state/run-machine.test.ts:1648` | 7 | 79-1 | 高 |
| P2a-07 | old-data | `src/core/work-graph/persistence/execution-entry-codecs.ts:5-18,93,128-152` | 读 V1 宽形状：`'schemaVersion' in value` 为假时只查 `generation/consumerId/phase`（接受 V1 的 `quarantined`）。唯一调用者是 `materials/record-readers.ts:209` 的 Run 记录解码，V1 只可能来自旧库/raw commit。 | `delete`：`V1_PHASES`、`executionAuthorizationV1Problem`、`runExecutionAuthorizationProblem` 的 V1 兜底与注释；V1 对象改由 V2 校验以 `schemaVersion must be 2` 拒绝 | V2 严格校验：`B2-execution-entry.test.ts:205` 后半段 | 30 | 79-1 | 高 |
| P2a-08 | old-data | `src/core/work-graph/state/run-machine.ts:75-81,94-96,155-167,1170-1177,1456-1458,2199-2201` | `legacyV1` = 有 V1 auth，或 `status:'running'` 且无 auth（pre-B2）。**writer 证明**：`newRunRecord`（`:846-860`）只写 `starting` 且无 auth，唯一 `running` 写入 `:886` 已经过 `entryV2Binding` 要求 V2；`grep legacyV1 src` 只在本文件。 | `delete`：字段/注释/计算、`:1456-1458`“不能升级”、`:2199-2201`“无 Kernel binding 不 reconcile”；`v2Binding` 对 `undefined` 保留 `illegal/forbidden`（Claimed 当前路径） | V2 路径：`run-machine.test.ts:456,1023,1648` | 20 | 79-1 | 高 |
| P2a-09 | old-data | `src/core/work-graph/state/run-machine.ts:242-244` | `runUnresolvedBlocker` 接受 `authorization.phase === 'quarantined'`；该值只在 V1 联合里，V2 phase 没有，且无 writer。 | `change`：删掉 `authorization.phase === 'quarantined'` 这一支，保留 V2 `unknown` 分支 | `tests/state/run-machine.test.ts:1712`（V2 unknown） | 1 | 79-1 | 高 |
| P2a-10 | legacy | `src/core/work-graph/tasks/execution-entry-service.ts:788-793`；`state/review-lease.ts:48-51`；`communication/mailbox-service.ts:1295-1297,1355-1357,2788-2790`；`state/run-machine.ts:94-95` | V1/V2 联合上的 `'schemaVersion' in auth && auth.schemaVersion === 2` 收窄；V1 分支分别是 null/拒绝/跳过 phase。P2a-06 删类型后这些收窄变成机械清理。 | `change`：5 处各一行（`auth === undefined` 语义保留）；另 13 处片外同类收窄（`app/startup-reconcile.ts:205-209`、`business/workflow/workflow.ts:1132`、`agent-runtime/execution-observation.ts:530` 等）需同批机械跟随，否则类型检查报不可达 | V2 路径不变：`tests/work-graph/C2-mailbox-admission.test.ts`、`tests/state/review-lease.test.ts:72` | 8（片内）+约 20（片外） | 79-1 | 高 |
| P2a-11 | old-data | `src/core/work-graph/state/attempt-machine.ts:73-78`；`src/core/work-graph/tasks/claim-record-codecs.ts:244-251` | 容忍 `status:'ended'` 且 `endOutcome:null`；两个 ended writer（`attempt-machine.ts:310-322`）都写非空 outcome，所以只可能是旧库行；`attemptNodeOf` 读成 `ended_known`。 | `user-decides`：codec 在 `ended` 时要求 `RunOutcome`，删旧注释；影响一条旧夹具（`attempt-machine.test.ts:699-700`） | 当前 ended 用例均带非空 outcome（`attempt-machine.test.ts`） | 4 | 79-1 | 中 |
| P2a-12 | legacy | `src/core/work-graph/state/attempt-machine.ts:50-69,324-355`；`src/core/work-graph/state/run-machine.ts:447-459,729-735`；`src/core/work-graph/tasks/execution-entry-service.ts:1212-1229` | 核后 keep：`DispatchStateV1` 是**当前** writer 写的（`:327,:334` entered，`:341` settled；V2 只用于 `not_entered`）；`autoCleanup` 在 `kernel_unreadable`/`continuation_unrebuildable` 当前就省略；`anomalyRefsMatch` 空集是当前合法语义。 | `keep`（可只改“pre-K3/old brief”注释） | `tests/state/k3-run-reconcile.test.ts`、`tests/runtime/S1-archive-files-brief.test.ts:193` | 0 | — | 高 |
| P2a-13 | old-data | `src/contracts/core/prepared-execution.ts:189`；`src/core/work-graph/state/context-input.ts:213,334-355`；`tasks/execution-entry-service.ts:451-456,1057-1060`；`src/core/agent-runtime/context-assembler.ts:1908-1916,1949`；`execution-preparation.ts:478,497,531`；`queries/query-execution.ts:1070-1076` | manifest 的旧输入投影 `selectedTaskInputs:{requirementId,ref}[]`：准入要求它逐项等于 binding 的 Artifact 选中项。**writer 证明（已抽查）**：当前 assembler 仍从同一 `inputSelections` 重算并写进 manifest（`context-assembler.ts:1908-1916,1949`），Query 固定传 `[]`。 | `delete`：manifest 字段、`contextAssemblyProblem` 的入参与互校、admission 数组校验、assembler 重算、Query 空数组实参；分页 API `TaskInputPageV1.selectedTaskInputs`（`graph-context.ts:126`）是当前语义，保留 | `S3-context-inputs.test.ts:671` IN01（分页）；`S3-prepared-context-admission.test.ts:438` AD01 | 40 | 79-1 | 高 |
| P2a-14 | old-data | `src/contracts/core/prepared-execution.ts:203-205,269-271`；`src/core/work-graph/state/context-input.ts:210-226`；`tasks/execution-entry-service.ts:1040,1056-1059`；`queries/query-execution.ts:1073,1079`；`src/core/agent-runtime/query-preparation.ts:332,359` | `contextAssembly?` 可缺省（`legacy_unversioned`）：Work 准入直接放行、Query 准入跳过 G-CTX。**writer 证明**：`assembleTask`/`assembleQuery` 无条件构造 binding，两个 preparation 只是接住，当前不会省略。 | `delete`：manifest 字段改必填；删 `contextAssemblyProblem` 的 `undefined` 早退、Work/Query 的 `binding === undefined` 分支、两处条件展开、契约注释 | `S3-prepared-context-admission.test.ts:438` AD01、`tests/state/context-input.test.ts:105` ST02 | 20 | 79-1 | 高 |
| P2a-15 | old-data | `src/core/work-graph/tasks/session-provenance-facts.ts:1-611`；`tasks/claim-service.ts:728-775`；`sessions/session-directory.ts:92,519,968-979,1608-1785`；`queries/query-execution.ts:227,234,930-946`；`state/session-availability.ts:120-139,493-515,1003-1020`；`src/contracts/core/session.ts:33-54`；`sessions/lifecycle-record-codecs.ts:102,345,416`；`model/claim-contracts.ts:160-168`；`composition/create-platform.ts:806-808,848,1837` | 整条 legacy Session provenance 推导/回填：缺 `provenance` 的旧 Session 从 consultation/requeue/manifest 反推，再写 `legacy_provenance_backfilled`。**writer 证明（已抽查）**：`session-directory.ts:712-735` 缺 key 时默认 `{kind:'new'}`，`:792` 写进 `CoreOperation.action.provenance`；`createSessionRecord` 只在 `acceptedProvenance===undefined`（旧 operation）时省略，当前 create 总写。 | `delete`：整文件、claim/query 两处 fallback、`backfillSessionProvenance` 命令与事件/转移/codec、`LegacySessionProvenancePort`、`SessionRecord.provenance?` 改必填、`claim-contracts.bodies?`、composition 注入 | 新 Session 路径：`tests/work-graph/R4b-session-directory.test.ts:146`（当前只断言 admit/replay，未断言 provenance，删后建议补一条最小断言） | 850 | 79-1 / 79-4 | 高（分类）/中（回归面） |
| P2a-16 | old-data | `src/core/work-graph/state/line-status.ts:86,443-447`；`views/work-line-reader.ts:278-321,338,515-516` | `legacyUncheckedInWorkspace` 统计 workspace 内 `provenance` 为 null 的 Session，只可能数到 P2a-15 的旧 operation。 | `delete`：字段、`readLegacyUnchecked`、reader 传参、`legacyInChain`/`retiredUnchecked` 的该条件与 marker；P2a-15 后可连“链上 provenance null”防御一起收 | `tests/state/S2C-line-status.test.ts:148` 主路径；旧行为 `S2C-K-legacy-provenance.test.ts:440-478` | 30 | 79-1 | 高 |
| P2a-17 | old-data | `src/core/work-graph/persistence/evidence-record-codecs.ts:55,96,117-125,485,782`；`state/verification-machine.ts:94-95` | `EvidenceAdmitted` 仍注册为可解码事件，但决定 34 删了 `submitEvidence`。**writer 证明（已抽查）**：`grep -rn EvidenceAdmitted src` 只有常量/union/注册/类型，无 encode/commit；`grep EvidenceAdmitted tests` 无命中。 | `delete`：常量、union 成员、`VERIFICATION_ROUND_EVENT_TYPES` 成员与注册、machine 的事件类型成员；`EvidenceSnapshot` 本身保留 | 行为已不存在：决定 34 删除 `submitEvidence`；无测试 pin | 25 | 79-1 / 决定 34 | 高 |
| P2a-18 | old-data | `src/contracts/verification.ts:195-210`；`src/core/work-graph/persistence/evidence-record-codecs.ts:319-321`；`state/verification-machine.ts:99-101,507,530,590,645,652,716,1394,1463,1495`；`state/task-failure.ts:1180` | `RoundSnapshot.chain?` 缺失被读成 slot-less ordinal-1 root，所有 `?.`/`?? 1/0` 都服务旧 round。**writer 证明**：`buildOpenedRound`（`verification-machine.ts:920`）总写 `chain: rootRoundChain()`，后继轮 `:646` 总写新 chain。 | `delete`：`chain` 改必填，删所有 `?.`/`??`；`isFinalizedNonPass` 的 `gaps.length > 0` 分支先确认 finalize 不会产生 PASS+gaps 后再删 | 当前链：`tests/work-graph/A2-step1-codecs.test.ts:387`、`tests/state/verification-machine.test.ts:860` | 20 | 79-1 | 高（chain）/中（PASS+gaps） |
| P2a-19 | old-data | `src/core/work-graph/views/track-read-model.ts:190-226` | track 分页 cursor 的 `ca` 缺失被容忍为 null，注释明说“earlier versions”。**writer 证明（已抽查）**：`:908,920,976,988` 四个构造点都写 `ca`，`encodeCursor` 不丢字段。 | `delete`：`ca !== undefined &&` 改 `!isStringOrNull(ca)`，返回 `ca` 不再 `?? null` | 当前分页：`tests/work-graph/S2B-30-track-bars.test.ts`；无测试手写旧 cursor | 4 | 79-1 | 高 |
| P2a-20 | legacy | `src/core/work-graph/state/message-machine.ts:178-183,309,1120,1202`；`communication/mailbox-service.ts:2034,2049-2071,2091-2095`；`sessions/message-record-codecs.ts:721,780-781`；`queries/query-job-service.ts:682`；外部 `app/collaboration-driver.ts:665,671`、`app/host.ts:1224`、`business/workflow/consultation.ts:142,364`、`session-maintenance.ts:348`、`agent-runtime/communication-tools.ts:319,412,417`、`ui/views/execution/panel.ts:36` | 旧发送别名 `replyMode:'wait'`：被归一成 `intent/needsReply/waitAfterSend`，但消息仍持久化该字段，多处 reader 在 `intent===undefined` 时回退。**writer 证明（已抽查）**：当前 tool schema 仍暴露 `z.literal('wait')`（`communication-tools.ts:319`），`mailbox-service.ts:2095` 按入参写，所以这是仍在用的旧接口，不是死数据。 | `user-decides`：删别名（tool schema/入参/持久化/reader 回退/UI 文案），调用方改传 `intent:'inquiry'`+`waitAfterSend:true`；迁移面到 `app`/`business`/`ui`，建议单独一片 | 新字段：`tests/state/message-machine.test.ts:943`（改后只留 intent/needsReply/waitAfterSend） | 45 | 79-4 | 高（旧别名）/中（迁移面） |
| P2a-21 | old-data | `src/core/work-graph/architecture/catalog-record-codecs.ts:459-471,565-578`；`notes/note-version-lists.ts:136-144` | catalog record 的 `since` 可缺省，decode 归 null；note 版本列表对 `since===null` 显示空时间/“没有记下原因”。**writer 证明**：`catalog-service.ts:296,525,707` 都构造 `since:null`，`:760` 提交后写真实 cursor，当前不省略。 | `delete`：`since` 改必需 key，删 `declaresSince` 两套 key 集、`?? null`、版本列表的 null 分支 | 当前 catalog：`tests/work-graph/A1-architecture-catalog.test.ts:242`、`S8A-catalog-version-time.test.ts` | 14 | 79-1 | 高 |
| P2a-22 | old-data | `src/contracts/ledger.ts:69-90`；`src/core/work-graph/persistence/record-codecs.ts:709-731,754-756,779-790`；`state/goal-machine.ts:91-99,134,199,651`；`tasks/requeue-service.ts:951`；`tasks/plan-service.ts:2170`；`app/goal-fan-out-driver.ts:193,354-355,411,475`；`app/startup-reconcile.ts:441` | Goal 的 pre-A.2 形状：缺 `desiredStateRevision` 读 1、缺 `desiredStateRequestedBy` 读 null。**writer 证明（已抽查）**：`newGoalSnapshot` 构造时就不写这两字段；`encodeGoalSnapshot` 对“从未改过”的 Goal 主动剥掉（`neverChanged ? legacyShape : snapshot`），注释自认“keeps writing legacy bytes until GOAL-04…06”。注意 `settings` 缺省是当前语义（初始 Goal 不写），不随本条删。 | `change`：构造器固定写 `1/null`，`encodeGoalSnapshot` 总是写完整 snapshot，`goalSnapshotProblem` 两字段改必填，删所有 `?? 1`/`undefined→null` | 完整字段：`tests/work-graph/A2-step1-codecs.test.ts:564`、`tests/state/goal-machine.test.ts:207`；旧形状 pin：`A2-step1-codecs.test.ts:557,573`、`goal-machine.test.ts:176` | 40 | 79-1 | 高 |
| P2a-23 | legacy | `src/core/work-graph/sessions/session-directory.ts:706-735` | 缺 `provenance` key 的 create 请求走“compatibility fingerprint”（fingerprint 不含 provenance），注释说为“truly old caller”。当前内部调用要么显式带 provenance、要么由默认 `{new}` 补，产品无旧调用者。 | `delete`：fingerprint 永远写 `provenance: createdProvenance`；`hasProvenance` 仍保留用于拒绝显式 null | `tests/work-graph/R4b-session-directory.test.ts:146` | 4 | 79-1 | 中 |
| P2a-24 | old-data | `src/core/work-graph/persistence/rework-codecs.ts:46,62-74`；`views/automatic-rework-notices.ts:118-210,257-259,395-430,527`；`views/task-state-timeline.ts:331-332`；`views/decision-read-model.ts:1565`；`views/work-line-reader.ts:2439,2551`；`tasks/claim-record-codecs.ts:61-77,665-695`；`persistence/plan-record-codecs.ts:1025-1039` | wire-only `since` 可缺省：旧 TaskRequeue/round/PlanProposal 没有该 key，读取归入 `since:null` equality 组、按 `occurredAt` 排序，`legacySince` 只接受真缺 key。**writer 证明**：`requeue-service.ts:1110`、`evidence-service.ts:352,1701`、`plan-service.ts:1425,3356` 都写 `{since:null}` 占位，由 Store 绑定 cursor，当前不会省略。 | `delete`：`S2A_REQUEUE_LEGACY_LOOKUP` 及取数分支、`legacySince`、legacy/ordered 合并、`since===undefined` 映射；`since` 改必填，`encodeTaskRequeueSnapshot` 的 `origin?` 改必填，`decodePlanProposalOrigin` 删“无 since 读作 `{}`” | 当前 ordered 分页：`S2B-30-track-bars.test.ts` 其余用例、`A2-step1-codecs.test.ts:387` | 50 | 79-1 | 高 |
| P2a-25 | old-data | `src/core/work-graph/materials/applicability.ts:15-16,97`；`src/core/record-store/body-ports.ts:7-16` | `MaterialOrigin` 的 `kind:'legacy'`（裸 `ownerRunRef`）只服务旧 artifact；`RawArtifactPut.origin` 已排除 legacy，当前写 `run`/`platform_operation`。`usage` 的 `undefined` 默认也只是旧 open 的 owner-only 语义。 | `delete`：`materialOwnerFromOrigin` 的 legacy 分支与 `MaterialOrigin` 的 legacy 成员；`usage` 改必填（两个调用点补显式值） | 当前 `platform_operation`：`tests/work-graph/S3-context-inputs.test.ts:397` | 3 | 79-1 | 高 |
| P2a-26 | old-data | `src/core/work-graph/tasks/model-call-contracts.ts:43-55`；`src/core/work-graph/tasks/model-request-codecs.ts:11` | 历史 permit 可缺 `requestId/requestDigest/contextInputDigest/manifestDigest`，注释说“readable but can never authorize a fresh call”。**writer 证明**：`model-call-service.ts:146-147` 当前 issuance 总写这四个字段。 | `change`：四字段改必填，删 codec 文件头“historical permit”说明；旧 permit 改由 codec 拒绝 | `tests/work-graph/B2-model-request.test.ts` 当前 issuance/consumption | 4 | 79-1 | 高 |
| P2a-27 | old-data | `src/contracts/query-job.ts:324-350`；`src/core/work-graph/queries/query-record-codecs.ts:1-15,430-465,522` | `QueryJobSnapshot.submission?`（submit locator）可缺省，注释说“historical snapshot without a locator stays readable”。**writer 证明**：`query-job-service.ts:498,731` 的当前 submit/replay 总写 `submission`；Query 生命周期只 spread 既有 job。 | `change`：`submission` 改必填，`validateQueryJobSnapshot` 删除“缺省跳过”，删文件头“predate the locator”说明 | 当前 submit/read：`tests/work-graph/R5b-query-job.test.ts`、`R5b-query-execution.test.ts` | 5 | 79-1 | 高 |
| P2a-28 | old-data | `src/core/work-graph/evidence/evidence-service.ts:790-800,1025-1030,1983-1985`；`architecture/architecture-record-codecs.ts:286-310,482-499,532,571`；`architecture/catalog-record-codecs.ts:244`；`src/contracts/verification.ts:146-150`；`src/contracts/query-job.ts:147-160`；`src/contracts/control-intent.ts:94-102`；`src/contracts/core/session.ts:46-59`；`state/context-input.ts:167-169,408-467` | 核后 keep（防误删）：evidence 的 `configuration?` 仍由 composition 从 `options.checks` 传（当前 Host 输入边界）；architecture 旧 8A 形状已改为拒绝；`containment`/`sourceBinding` 是当前可选声明；`incompleteCause` 是 PASS/FAIL 当前就不写；Query `execution?` 是普通 copy Query 当前形状；`queued@1` 是当前 control producer；Session `healthConclusion/archiveRequest/unavailableSince` 缺省是当前语义；`legacy:` declaration/`legacyArtifactRef` 是当前 Plan v2 输入能力（两种声明 `edge:`/`legacy:`）；`legacy_template` 例外。 | `keep`（最多改注释，不删字段/分支） | `S3-context-inputs.test.ts:671,759,886`、`S4C-path-ownership-callers.test.ts:150`、`S5-notice-settings.test.ts` 等 | 0 | — | 高 |

## JSON

```json
[
  {
    "id": "P2a-01",
    "category": "old-data",
    "file": "src/contracts/plan.ts",
    "lines": "221-227, 263-272; src/core/work-graph/tasks/plan-commit-compiler.ts:127-162; src/core/work-graph/tasks/plan-service.ts:1500-1535",
    "tests": ["tests/work-graph/R5b-initial-plan.test.ts:178", "tests/work-graph/W1-future-plan.test.ts:363", "tests/state/plan-machine.test.ts:498 (stale)"],
    "evidence": "PlanRevision v1 union and compiler fallback; the Host plans/propose entry does not check draft.schemaVersion, so the initial adoption can still write a v1 snapshot today.",
    "action": "change: reject v1 drafts at the Host entry, always build a v2 snapshot, delete the v1-only rejection steps",
    "covered_by": "tests/work-graph/R5b-initial-plan.test.ts:178; tests/work-graph/W1-future-plan.test.ts:363",
    "est_lines": 17,
    "spec_row": "decision 79-1 (HANDOFF:565)",
    "confidence": "高"
  },
  {
    "id": "P2a-02",
    "category": "old-data",
    "file": "src/core/work-graph/tasks/plan-service.ts",
    "lines": "770, 977; plan-readers.ts:1347,2277; plan-validation.ts:306-311; plan-task-basis.ts:106,244; evidence-coverage.ts:64; context-input-service.ts:364; execution-entry-service.ts:990; views/graph-context-reader.ts:914,1143; views/task-state-timeline.ts:270",
    "tests": ["tests/work-graph/A2-disposition-change.test.ts:296,352", "tests/work-graph/R3c-task-relations.test.ts:81", "tests/work-graph/R3e-evidence-coverage.test.ts:103", "tests/work-graph/S3-context-inputs.test.ts:670", "tests/work-graph/S2B-31-task-timeline-main.test.ts:20"],
    "evidence": "Nine v1 reader ternaries/early returns in tasks/ and views/; a v1 body never carries taskRelations, inputRequirements, taskStateBasis or dispositionRecord, and no current writer produces v1 for those fields.",
    "action": "delete: read the v2 fields directly (?? [] / ?? undefined); keep the 'no taskStateBasis = self' current semantics",
    "covered_by": "the v2 cases listed against each reader (A2-disposition-change, R3c-task-relations, R3e-evidence-coverage, S3-context-inputs, S2B-31)",
    "est_lines": 21,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-03",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/plan-record-codecs.ts",
    "lines": "1-12, 521-522, 572-583",
    "tests": ["tests/work-graph/R3c-task-relations-boundaries.test.ts:87,97 (stale)"],
    "evidence": "One PlanRevisionSnapshot@1 codec accepts content schemaVersion 1|2 and bans v2-only fields on v1; the v1 branch only reads old bodies and has no writer once P2a-01 is tightened.",
    "action": "delete: require schemaVersion 2; remove the whole v1 block and the v1/v2 header note",
    "covered_by": "tests/work-graph/R3c-task-relations-boundaries.test.ts:94 (current v2 round-trip); v1 body should become invalid",
    "est_lines": 12,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-04",
    "category": "old-data",
    "file": "src/core/work-graph/state/plan-machine.ts",
    "lines": "103-108, 1245-1251, 1623-1625, 1709-1711; persistence/plan-record-codecs.ts:741,800-818,997-1021",
    "tests": ["tests/work-graph/S5-request-candidates.test.ts:305 (stale)", "tests/state/plan-machine.test.ts:114,379-384,828 (stale)"],
    "evidence": "Legacy PlanProposal@1 is decoded into kind legacy_v1 with draft null and three unconditional unsupported refusals; grep shows only the type and the decoder, no constructor, while encodePlanProposal is fixed to PlanProposal@2.",
    "action": "delete: LegacyPlanProposal type, union member, three case branches, legacy validation/decode view and the goal-change v1 types",
    "covered_by": "tests/work-graph/S5-request-candidates.test.ts:58-291 (RC01-RC10, candidate_v2); plan-machine candidate tables",
    "est_lines": 60,
    "spec_row": "decision 79-1 / 79-4",
    "confidence": "高"
  },
  {
    "id": "P2a-05",
    "category": "old-data",
    "file": "src/contracts/plan.ts",
    "lines": "83-100, 286-300; state/plan-machine.ts:78-85",
    "tests": ["tests/work-graph/R5b-initial-plan.test.ts:178", "tests/work-graph/A2-entry-plan.test.ts:70,130", "tests/work-graph/S5-request-candidates.test.ts:269"],
    "evidence": "Checked and dismissed: missing taskStateBasis is the current initial-plan shape (only future adoption writes it); unattributed acceptance fields are a current optional branch; requestRef/notAdopted are same-v2 optional extensions.",
    "action": "keep (comment wording only)",
    "covered_by": "the current tests listed",
    "est_lines": 0,
    "spec_row": null,
    "confidence": "高"
  },
  {
    "id": "P2a-06",
    "category": "old-data",
    "file": "src/contracts/dispatch.ts",
    "lines": "112-116, 223",
    "tests": ["tests/work-graph/B2-execution-entry.test.ts:205", "tests/state/run-machine.test.ts:445,447,819,944,1401,1651", "tests/state/invariants.ts:112-126"],
    "evidence": "ExecutionAuthorizationV1 (no schemaVersion, phase includes quarantined) is still in the RunSnapshot union, but every current executionAuthorization write is V2 at run-machine.ts:864,960 and there is no quarantined writer.",
    "action": "delete: remove the V1 type and union member; keep absent authorization for starting/Claimed Runs",
    "covered_by": "tests/work-graph/B2-execution-entry.test.ts:215; A2-entry-plan.test.ts:219; tests/state/run-machine.test.ts:1648",
    "est_lines": 7,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-07",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/execution-entry-codecs.ts",
    "lines": "5-18, 93, 128-152",
    "tests": ["tests/work-graph/B2-execution-entry.test.ts:205"],
    "evidence": "The Run codec falls back to a wide V1 validator when schemaVersion is absent; the only caller is the Run record reader and V1 can only come from old DB rows or raw-commit tests.",
    "action": "delete: V1_PHASES, executionAuthorizationV1Problem and the no-schemaVersion branch; a V1 object then fails V2 validation",
    "covered_by": "B2-execution-entry.test.ts:205 (malformed V2 still rejected by the real codec)",
    "est_lines": 30,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-08",
    "category": "old-data",
    "file": "src/core/work-graph/state/run-machine.ts",
    "lines": "75-81, 94-96, 155-167, 1170-1177, 1456-1458, 2199-2201",
    "tests": ["tests/state/run-machine.test.ts:444,1012,1409,1653,483,433 (stale)"],
    "evidence": "legacyV1 marks a V1 authorization or a running Run with no authorization; newRunRecord only writes starting without auth and the only running write (enteredRunRecord) requires V2.",
    "action": "delete: the legacyV1 field and its three guards; v2Binding keeps illegal/forbidden for an absent binding",
    "covered_by": "tests/state/run-machine.test.ts:456,1023,1648",
    "est_lines": 20,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-09",
    "category": "old-data",
    "file": "src/core/work-graph/state/run-machine.ts",
    "lines": "242-244",
    "tests": ["tests/state/run-machine.test.ts:1714 (stale)", "tests/state/task-failure.test.ts:404 (stale)"],
    "evidence": "runUnresolvedBlocker accepts authorization.phase === quarantined, a V1-only value with no V2 member and no writer.",
    "action": "change: delete the quarantined alternative, keep the V2 unknown branch",
    "covered_by": "tests/state/run-machine.test.ts:1712 (V2 unknown)",
    "est_lines": 1,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-10",
    "category": "legacy",
    "file": "src/core/work-graph/tasks/execution-entry-service.ts",
    "lines": "788-793; state/review-lease.ts:48-51; communication/mailbox-service.ts:1295-1297,1355-1357,2788-2790; state/run-machine.ts:94-95",
    "tests": ["tests/state/review-lease.test.ts:72", "tests/work-graph/C2-mailbox-admission.test.ts"],
    "evidence": "Five V1|V2 type-narrowing checks where the V1 branch is null/reject/skip-phase; deleting ExecutionAuthorizationV1 makes them mechanical one-line cleanups (13 more outside the area).",
    "action": "change: narrow on auth === undefined instead of schemaVersion in auth; update the 13 out-of-area sites in the same change",
    "covered_by": "the V2 paths listed (C2 mailbox admission, review-lease V2 cases)",
    "est_lines": 8,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-11",
    "category": "old-data",
    "file": "src/core/work-graph/tasks/claim-record-codecs.ts",
    "lines": "244-251; state/attempt-machine.ts:73-78",
    "tests": ["tests/state/attempt-machine.test.ts:699-700 (stale)"],
    "evidence": "An ended Attempt with endOutcome null is accepted and read as ended_known, but both current ended writers always write a non-null RunOutcome.",
    "action": "user-decides: require RunOutcome when status is ended and delete the legacy comment",
    "covered_by": "the existing ended cases in tests/state/attempt-machine.test.ts (all carry an outcome)",
    "est_lines": 4,
    "spec_row": "decision 79-1",
    "confidence": "中"
  },
  {
    "id": "P2a-12",
    "category": "legacy",
    "file": "src/core/work-graph/state/attempt-machine.ts",
    "lines": "50-69, 324-355; state/run-machine.ts:447-459,729-735",
    "tests": ["tests/state/k3-run-reconcile.test.ts", "tests/runtime/S1-archive-files-brief.test.ts:193"],
    "evidence": "Checked and dismissed: DispatchStateV1 is what the current writer writes for entered/settled (V2 only for not_entered); autoCleanup and anomalyRefsMatch are legitimately absent on current paths.",
    "action": "keep (comment wording only)",
    "covered_by": "the current tests listed",
    "est_lines": 0,
    "spec_row": null,
    "confidence": "高"
  },
  {
    "id": "P2a-13",
    "category": "old-data",
    "file": "src/contracts/core/prepared-execution.ts",
    "lines": "189; state/context-input.ts:213,334-355; tasks/execution-entry-service.ts:451-456,1057-1060; agent-runtime/context-assembler.ts:1908-1916,1949; execution-preparation.ts:478,497,531; queries/query-execution.ts:1070-1076",
    "tests": ["tests/work-graph/S3-prepared-context-admission.test.ts:386 (fixture, stale)", "tests/runtime/K3-35-manifest-trim-pure.test.ts:257 (fixture, stale)"],
    "evidence": "The manifest still carries selectedTaskInputs, a duplicate of the binding's artifact selections; the current assembler recomputes it from the same inputSelections and the admission cross-checks it.",
    "action": "delete: manifest field, admission cross-check, assembler recomputation and the Query empty-array argument; keep the page API TaskInputPageV1.selectedTaskInputs",
    "covered_by": "tests/work-graph/S3-context-inputs.test.ts:671 IN01 (page API) and S3-prepared-context-admission.test.ts:438 AD01",
    "est_lines": 40,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-14",
    "category": "old-data",
    "file": "src/contracts/core/prepared-execution.ts",
    "lines": "203-205, 269-271; state/context-input.ts:210-226; tasks/execution-entry-service.ts:1040,1056-1059; queries/query-execution.ts:1073,1079; agent-runtime/query-preparation.ts:332,359",
    "tests": ["tests/work-graph/S3-prepared-context-admission.test.ts:499 AD05 (stale)", "tests/state/context-input.test.ts:99 ST01 (stale)"],
    "evidence": "contextAssembly is optional as legacy_unversioned and both Work and Query admission accept a manifest without it; assembleTask/assembleQuery always produce a binding today.",
    "action": "delete: make the manifest field required, remove the undefined early returns and conditional spreads, delete the legacy_unversioned note",
    "covered_by": "S3-prepared-context-admission.test.ts:438 AD01 and tests/state/context-input.test.ts:105 ST02",
    "est_lines": 20,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-15",
    "category": "old-data",
    "file": "src/core/work-graph/tasks/session-provenance-facts.ts",
    "lines": "1-611; tasks/claim-service.ts:728-775; sessions/session-directory.ts:92,519,968-979,1608-1785; queries/query-execution.ts:227,234,930-946; state/session-availability.ts:120-139,493-515,1003-1020; contracts/core/session.ts:33-54; sessions/lifecycle-record-codecs.ts:102,345,416; model/claim-contracts.ts:160-168; composition/create-platform.ts:806-808,848,1837",
    "tests": ["tests/work-graph/S1-provenance.test.ts:293,338,393,415 (stale)", "tests/state/S1-session-archive.test.ts:192 (stale)", "tests/scenarios/S2C-K-legacy-provenance.test.ts:437,462 (stale)"],
    "evidence": "The whole legacy provenance derivation and one-time backfill chain: a Session without provenance derives it from consultation/requeue/manifest and writes legacy_provenance_backfilled. The current create path always writes provenance (default new), so only old CoreOperations lack it.",
    "action": "delete: session-provenance-facts.ts, both claim/query fallbacks, backfill command/event/machine transition/codec, LegacySessionProvenancePort, make SessionRecord.provenance required, drop claim-contracts.bodies? and the composition wiring",
    "covered_by": "tests/work-graph/R4b-session-directory.test.ts:146 (durable admit/replay); it does not assert provenance, so add one minimal assertion",
    "est_lines": 850,
    "spec_row": "decision 79-1 / 79-4",
    "confidence": "高（分类）/中（回归面）"
  },
  {
    "id": "P2a-16",
    "category": "old-data",
    "file": "src/core/work-graph/state/line-status.ts",
    "lines": "86, 443-447; views/work-line-reader.ts:278-321,338,515-516",
    "tests": ["tests/scenarios/S2C-K-legacy-provenance.test.ts:440-478 (stale)", "tests/work-graph/S2C-lines-scale.test.ts:56 (stale)"],
    "evidence": "legacyUncheckedInWorkspace counts active/archived Sessions whose provenance is null, which only P2a-15's old operations produce; current create always writes provenance.",
    "action": "delete: the field, readLegacyUnchecked, its reader argument, the retiredUnchecked condition and the provenance_unchecked marker branch",
    "covered_by": "tests/state/S2C-line-status.test.ts:148 (main line-status path)",
    "est_lines": 30,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-17",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/evidence-record-codecs.ts",
    "lines": "55, 96, 117-125, 485, 782; state/verification-machine.ts:94-95",
    "tests": [],
    "evidence": "EvidenceAdmitted is still registered and decodable although decision 34 deleted submitEvidence; grep finds no encoder/commit and no test constructs it.",
    "action": "delete: the constant, union member, VERIFICATION_ROUND_EVENT_TYPES member, registry entry and machine event-type member; keep EvidenceSnapshot",
    "covered_by": "行为已不存在：decision 34 deleted submitEvidence; no test pins it",
    "est_lines": 25,
    "spec_row": "decision 79-1 / decision 34",
    "confidence": "高"
  },
  {
    "id": "P2a-18",
    "category": "old-data",
    "file": "src/core/work-graph/state/verification-machine.ts",
    "lines": "99-101, 507, 530, 590, 645, 652, 716, 1394, 1463, 1495; contracts/verification.ts:195-210; persistence/evidence-record-codecs.ts:319-321; state/task-failure.ts:1180",
    "tests": ["tests/work-graph/A2-step1-codecs.test.ts:380 (stale)", "tests/work-graph/A2-gate-chain-facts.test.ts:218 (stale)"],
    "evidence": "RoundSnapshot.chain is optional and all readers fall back to a slot-less ordinal-1 root, but buildOpenedRound always writes rootRoundChain() and successor rounds always write a new chain.",
    "action": "delete: make chain required and drop every ?./?? fallback; separately confirm that finalize never writes PASS+gaps before deleting the isFinalizedNonPass gap branch",
    "covered_by": "tests/work-graph/A2-step1-codecs.test.ts:387 (successor round) and tests/state/verification-machine.test.ts:860",
    "est_lines": 20,
    "spec_row": "decision 79-1",
    "confidence": "高（chain）/中（PASS+gaps）"
  },
  {
    "id": "P2a-19",
    "category": "old-data",
    "file": "src/core/work-graph/views/track-read-model.ts",
    "lines": "190-226",
    "tests": [],
    "evidence": "decodeQueryCursor tolerates a missing ca ('cursors written by earlier versions'); all four current cursor constructors write ca and encodeCursor never drops a field.",
    "action": "delete: require ca (isStringOrNull check) and return ca directly",
    "covered_by": "tests/work-graph/S2B-30-track-bars.test.ts (current paging); no test writes a legacy cursor",
    "est_lines": 4,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-20",
    "category": "legacy",
    "file": "src/core/work-graph/state/message-machine.ts",
    "lines": "178-183, 309, 1120, 1202; communication/mailbox-service.ts:2034,2049-2071,2091-2095; sessions/message-record-codecs.ts:721,780-781; queries/query-job-service.ts:682",
    "tests": ["tests/state/message-machine.test.ts:598,815,943-946 (stale)", "tests/work-graph/S1-wait-copy-retirement.test.ts:81,118 (stale)", "tests/scenarios/K3-R1-restart-flows.test.ts:82 (callers)"],
    "evidence": "The old send alias replyMode:'wait' is normalized into intent/needsReply/waitAfterSend but is still persisted, exposed by the current model tool schema (communication-tools.ts:319) and used as a fallback by several readers.",
    "action": "user-decides: delete the alias from the tool schema, inputs, record/codec and readers; migrate callers to intent:'inquiry' + waitAfterSend:true (app/business/ui spread)",
    "covered_by": "tests/state/message-machine.test.ts:943 (the same block covers the new fields once changed)",
    "est_lines": 45,
    "spec_row": "decision 79-4",
    "confidence": "高（旧别名）/中（迁移面）"
  },
  {
    "id": "P2a-21",
    "category": "old-data",
    "file": "src/core/work-graph/architecture/catalog-record-codecs.ts",
    "lines": "459-471, 565-578; notes/note-version-lists.ts:136-144",
    "tests": ["tests/work-graph/A1-architecture-catalog.test.ts:242", "tests/work-graph/S8A-catalog-version-time.test.ts:28 (stale legacy placeholder comment)"],
    "evidence": "Catalog records accept a missing since and decode it to null; the version list then shows no time/reason for pre-8A rows. All current catalog writers write since (null placeholder bound by the Store).",
    "action": "delete: make since a required key, remove declaresSince and the ?? null, delete the version-list null branch",
    "covered_by": "A1-architecture-catalog.test.ts:242 and S8A-catalog-version-time.test.ts current rows with since",
    "est_lines": 14,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-22",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/record-codecs.ts",
    "lines": "709-731, 754-756, 779-790; contracts/ledger.ts:69-90; state/goal-machine.ts:91-99,134,199,651; tasks/requeue-service.ts:951; tasks/plan-service.ts:2170; app/goal-fan-out-driver.ts:193,354-355,411,475; app/startup-reconcile.ts:441",
    "tests": ["tests/work-graph/A2-step1-codecs.test.ts:557,573 (stale)", "tests/state/goal-machine.test.ts:176 (stale)"],
    "evidence": "The Goal pre-A.2 shape: a never-changed Goal is intentionally written without desiredStateRevision/desiredStateRequestedBy and readers default them to 1/null. newGoalSnapshot and encodeGoalSnapshot still do this today; GOAL-04..06 are implemented.",
    "action": "change: write 1/null at creation, always write the complete snapshot, make both fields required and delete every ?? 1/undefined fallback; settings absence is current and stays",
    "covered_by": "tests/work-graph/A2-step1-codecs.test.ts:564 and tests/state/goal-machine.test.ts:207 (full current shape)",
    "est_lines": 40,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-23",
    "category": "legacy",
    "file": "src/core/work-graph/sessions/session-directory.ts",
    "lines": "706-735",
    "tests": [],
    "evidence": "A create request without the provenance key uses a compatibility fingerprint that omits provenance; the comment says this is for a truly old caller and no such caller remains.",
    "action": "delete: always include provenance in the fingerprint; keep hasProvenance only for rejecting an explicit null",
    "covered_by": "tests/work-graph/R4b-session-directory.test.ts:146 (current create)",
    "est_lines": 4,
    "spec_row": "decision 79-1",
    "confidence": "中"
  },
  {
    "id": "P2a-24",
    "category": "old-data",
    "file": "src/core/work-graph/persistence/rework-codecs.ts",
    "lines": "46, 62-74; views/automatic-rework-notices.ts:118-210,257-259,395-430,527; views/task-state-timeline.ts:331-332; views/decision-read-model.ts:1565; views/work-line-reader.ts:2439,2551; tasks/claim-record-codecs.ts:61-77,665-695; persistence/plan-record-codecs.ts:1025-1039",
    "tests": ["tests/work-graph/S2A-notices-rework.test.ts:37 QA-11 (stale)", "tests/work-graph/S2B-30-track-bars.test.ts:188 (stale)"],
    "evidence": "The wire-only since is optional on TaskRequeue, rounds and PlanProposal; old rows without it fall into a since:null equality group ordered by occurredAt. All current writers pass {since:null} and let the Store bind the cursor.",
    "action": "delete: S2A_REQUEUE_LEGACY_LOOKUP and its branch, legacySince, the legacy/ordered merge, every since===undefined mapping; make since and the encode origin required; drop the decodePlanProposalOrigin legacy {}",
    "covered_by": "tests/work-graph/S2B-30-track-bars.test.ts (ordered paging) and A2-step1-codecs.test.ts:387",
    "est_lines": 50,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-25",
    "category": "old-data",
    "file": "src/core/work-graph/materials/applicability.ts",
    "lines": "15-16, 97; src/core/record-store/body-ports.ts:7-16",
    "tests": ["tests/work-graph/S3-context-inputs.test.ts:176,397 (stale legacyOrigin fixture)"],
    "evidence": "MaterialOrigin kind 'legacy' (a bare ownerRunRef) only serves old artifacts; RawArtifactPut excludes it and current writers use run/platform_operation. The undefined usage default is the old open's owner-only semantics.",
    "action": "delete: the legacy origin member and materialOwnerFromOrigin branch; make usage required at the two call sites",
    "covered_by": "tests/work-graph/S3-context-inputs.test.ts:397 (current platform_operation origin)",
    "est_lines": 3,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-26",
    "category": "old-data",
    "file": "src/core/work-graph/tasks/model-call-contracts.ts",
    "lines": "43-55; tasks/model-request-codecs.ts:11",
    "tests": ["tests/work-graph/B2-model-request.test.ts"],
    "evidence": "Historical model-request permits may lack four request pins and then cannot authorize a fresh call; the current issuance writes all four (model-call-service.ts:146-147).",
    "action": "change: make requestId/requestDigest/contextInputDigest/manifestDigest required, delete the historical-permit note; old permits fail the codec",
    "covered_by": "tests/work-graph/B2-model-request.test.ts (current issuance/consumption)",
    "est_lines": 4,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-27",
    "category": "old-data",
    "file": "src/contracts/query-job.ts",
    "lines": "324-350; queries/query-record-codecs.ts:1-15,430-465,522",
    "tests": ["tests/work-graph/R5b-query-job.test.ts", "tests/work-graph/R5b-query-execution.test.ts"],
    "evidence": "QueryJobSnapshot.submission (the submit locator) is optional for historical snapshots; the current formal submit/replay always writes it and later lifecycle writes only copy the existing job.",
    "action": "change: make submission required, remove the missing-field skip in validateQueryJobSnapshot and the 'predate the locator' comments",
    "covered_by": "tests/work-graph/R5b-query-job.test.ts and R5b-query-execution.test.ts (current submit/read)",
    "est_lines": 5,
    "spec_row": "decision 79-1",
    "confidence": "高"
  },
  {
    "id": "P2a-28",
    "category": "old-data",
    "file": "src/core/work-graph/evidence/evidence-service.ts",
    "lines": "790-800, 1025-1030, 1983-1985; architecture/architecture-record-codecs.ts:286-310,482-499,532,571; architecture/catalog-record-codecs.ts:244; contracts/verification.ts:146-150; contracts/query-job.ts:147-160; contracts/control-intent.ts:94-102; contracts/core/session.ts:46-59; state/context-input.ts:167-169,408-467",
    "tests": ["tests/work-graph/S3-context-inputs.test.ts:671,759,886", "tests/work-graph/S4C-path-ownership-callers.test.ts:150", "tests/state/S5-notice-settings.test.ts", "tests/work-graph/S5-notice-settings.test.ts:80"],
    "evidence": "Checked and dismissed: evidence configuration? is still a live Host input (options.checks); architecture already rejects the old 8A shapes; containment/sourceBinding, incompleteCause, Query execution?, queued@1, Session healthConclusion/archiveRequest/unavailableSince, legacy: declarations/legacyArtifactRef and legacy_template are current semantics.",
    "action": "keep (comments only)",
    "covered_by": "the current tests listed",
    "est_lines": 0,
    "spec_row": null,
    "confidence": "高"
  }
]
```

## 分类合计

| 类别 | 条数 | 估计生产代码行数 |
|---|---:|---:|
| old-data（旧格式数据/容忍） | 24（含 2 条 keep） | 1,277 |
| legacy（旧接口/旧别名） | 4（含 1 条 keep） | 57 |
| **合计** | **28** | **1,334** |

其中 `P2a-15` 一条占约 850 行（Session legacy-provenance 整链）；其余 21 条 old-data 合计约 427 行。测试侧改动未计入（旧行为测试会 stale 或需改 fixture；`P2a-15`/`P2a-20` 的迁移面最大）。`P2a-05`、`P2a-12`、`P2a-28` 是核后 `keep`，列出来是为了防止下一轮误删。

## 决定 79-1 的开放问题：要不要在打开库时统一提示“旧版本建的库，请重建”

**今天的做法。** 没有库级版本标记；每条记录族在自己的 codec/validator 里核版本，不认识就 `invalid`/`unavailable`/`corrupt`。例子：`src/core/work-graph/persistence/plan-record-codecs.ts:522`（Plan 内容版本 1|2）、`persistence/event-validation.ts:12`（事件外层版本）、`persistence/record-codecs.ts:457,590`（Goal 事件）、`sessions/message-record-codecs.ts:1094`、`tasks/claim-record-codecs.ts:341`、`queries/query-record-codecs.ts:483,588`。读失败经 `persistence/read-result-failures.ts` 映射成领域拒绝。

**今天没有库级标记。** `src/core/record-store/migrations.ts:147 initRecordStoreSchema` 只建/校验四张物理表（`events`/`snapshots`/`idempotency`/`identity_claims`），全文没有 `PRAGMA user_version` 或 `store_meta` 表；`grep -rn "user_version\|store_meta\|format_version" src` 无命中。SQLite 打开路径是 `src/core/record-store/sqlite-record-store.ts:157-174`（`initRecordStoreSchema(db)`，失败则 close 并 rethrow），Host 启动在 `src/app/main.ts:211-215` 捕获后打印 `workbench configuration rejected: <message>` 并以 1 退出。

**选项（不决定）：**

- **A. 不加（保持现状）。** 每条记录各自核版本，旧库在第一次读到旧记录时报错，开发时删库重建。成本 0；缺点是错误是逐条、逐族出现的，第一次可能只看到一句 “schemaVersion must be 2”，看不出“整库旧了”。按 79-1 删掉本轮旧 reader 后，旧记录会以同样的方式失败，效果已接近提示。
- **B. 打开库时统一检查（唯一能“只说一次”的位置）。** 在 `src/core/record-store/migrations.ts:147`（被 `sqlite-record-store.ts:158` 调用）加库级格式标记：新库写入当前版本（`PRAGMA user_version` 或一张 `store_meta(format_version)`），打开时若标记缺失/不同就抛一条 “this database was built by an older version; rebuild it”，由 `app/main.ts:211-215` 的启动错误路径显示。注意：本轮改造前建的库都没有标记，正是要提示的对象；内存后端不需要。这属于 `src/core/record-store`，不是 P2a 的 work-graph 范围，且“拒绝启动”是产品决定。
- **C. 懒提示（读到时统一文案）。** 在 `src/core/work-graph/persistence/read-result-failures.ts` 或各 `decode*` 的失败映射处，把“版本不认识”统一成“库是旧版本建的，请重建”。成本小，但要先读到那条记录；而且真正的损坏和旧版本会混在同一句里，分不清。
- **D. Host 启动探针。** 在 `src/app/host.ts`/`startup-reconcile.ts` 读一条已知记录（如 Project/Workspace 快照）判断版本。不改 record-store 物理层；但新库没有该记录，旧库也不保证有，无法区分“空库”和“旧库”，判断不可靠。

**倾向（供 lead 决定，不是结论）：** 如果要“一次说清”，只有 B 能做到，代价是改 record-store 并让 Host 在旧库上拒绝启动；如果只在开发期用，A 已足够，C 可作为 A 的低成本补充。D 不建议。

## 覆盖说明

**主会话完整读过（或相关段落全部读过）**
- `src/contracts/plan.ts`、`src/contracts/dispatch.ts`、`src/contracts/ledger.ts`、`src/contracts/verification.ts`、`src/contracts/graph-context.ts`、`src/contracts/input-declaration-id.ts`、`src/contracts/query-job.ts`、`src/contracts/control-intent.ts`、`src/contracts/core/prepared-execution.ts`、`src/contracts/core/session.ts`
- `src/core/work-graph/state/run-machine.ts`（55-184、220-248、440-480、715-745、830-1010、1140-1180、1300-1530、2185-2210）、`state/attempt-machine.ts`（20-80、300-360）、`state/review-lease.ts`、`state/plan-machine.ts`（95-130、1020-1075、1240-1260、1380-1420、1610-1635、1700-1720）、`state/verification-machine.ts`（70-115、900-1010）、`state/context-input.ts`（1-60、150-240）、`state/goal-machine.ts`（80-100、190-205、640-660）、`state/message-machine.ts`（145-200、1105-1210、1320-1350）、`state/line-status.ts`（80-95、430-450）
- `src/core/work-graph/persistence/plan-record-codecs.ts`（1-30、500-600、700-1090）、`persistence/record-codecs.ts`（680-820）、`persistence/evidence-record-codecs.ts`（40-140、275-360）、`persistence/execution-entry-codecs.ts`（1-40、85-155）、`persistence/rework-codecs.ts`（40-95）、`persistence/read-result-failures.ts`、`persistence/graph-repository.ts`（1-60）
- `src/core/work-graph/views/track-read-model.ts`（190-245、900-990）、`tasks/plan-commit-compiler.ts`（110-260、390-445）、`tasks/plan-service.ts`（355-420、1515-1535）、`tasks/execution-entry-service.ts`（780-800、985-1000、1690-1710）、`tasks/session-provenance-facts.ts`（90-130、378-420）、`tasks/model-call-contracts.ts`（43-75）、`tasks/model-request-codecs.ts`（1-20）、`tasks/model-call-service.ts`（140-150、220-265）、`tasks/claim-record-codecs.ts`（238-254）、`sessions/session-directory.ts`（690-800、955-985）、`sessions/message-record-codecs.ts`（115-170）、`queries/query-record-codecs.ts`（1-20、420-530）、`queries/query-job-service.ts`（490-500、720-770）、`materials/applicability.ts`（1-110）、`materials/record-readers.ts`（195-270）、`evidence/evidence-service.ts`（770-840、1000-1050）、`architecture/catalog-record-codecs.ts`（440-590）、`architecture/architecture-record-codecs.ts`（280-330）、`configuration/project-bootstrap-record-codecs.ts`（85-210）、`configuration/project-bootstrap-service.ts`（660-695）、`notes/note-version-lists.ts`（1-155）
- `src/core/record-store/migrations.ts`（1-170）、`sqlite-record-store.ts`（140-185）、`body-ports.ts`
- `src/app/main.ts`（100-240）、`src/composition/create-platform.ts`（660-700、820-890、1000-1010、1055-1080）、`src/app/core-routes.ts`（1060-1070）、`src/core/agent-runtime/whiteboard-tools.ts`（180-360）、`src/ui/views/setup/requests.ts`（150-175）

**子代理读全的文件**（报告在 `.dsh-scratch/P2a-part1..3.md`，未纳入仓库）：Plan 分片的 `plan-*`/`PlanRevision` 全链与 tests/state、tests/work-graph 相关测试；Run-Auth 分片的 `run-machine`、`attempt-machine`、`execution-entry-codecs`、`review-lease`、`mailbox` 准入；其余分片的 `session-provenance-facts`、`context-input`、`claim-service`、`automatic-rework-notices`、`task-state-timeline`、`decision-read-model`、`catalog-*`、`query-execution`、`query-preparation`、`context-assembler`、`execution-preparation` 及列出的契约。

**只略读/只按命中读**
- `src/contracts/goal-change.ts`（只确认 `PlanProposalSnapshot` 消费者）、`src/core/agent-runtime/context-assembler.ts` 的其余段、`execution-preparation.ts` 的其余段、`queries/query-execution.ts` 的其余段、`app/host.ts` 的线程/启动路径、`tool-commit-arguments.ts`、`message-record-codecs` 的完整 validator、`src/ui` 的其余调用点。

**没定下来的问题**
1. `isFinalizedNonPass` 的 “PASS 但有 gaps” 是否仍是当前可达组合——删 `gaps.length > 0` 分支前要逐条走 VR-07；本报告只报 `chain` 部分。
2. `evidence-service` 的 `configuration?` 是否保留 `TargetPlatformOptions.checks` 这个 Host 输入边界，要产品决定（P2a-28 keep）。
3. `P2a-15` 删除后，`tests/` 里手写 `SessionRecord` 的夹具面没有系统扫（本报告只核了 `src` 构造点）；`R4b-session-directory.test.ts:146` 也没有断言 provenance。
4. `P2a-20` 的 `replyMode` 迁移面到 `app`/`business`/`ui` 与大量 scenario，需单独排片。
5. `P2a-01` 的 v1 入口收紧放在 `proposePlan` 服务入口还是 `structuralPlanIssues` 只收 2，两处都做更稳；第二处会让“直接 seed v1 candidate”的旧测试从“能读”变成“读不了”。
6. 片外同型分派未逐文件审：`src/core/agent-runtime/context-assembler.ts:775`（Plan v1）、`src/app/startup-reconcile.ts:202-209,338` 与另外 12 处 V1 auth 收窄（见 P2a-10）。
7. `wire-format` 允许清单里属于 `src/core/work-graph` 的 3 条（`GOAL_SETTINGS_CHANGED_SCHEMA_ID`、`WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID`、`UserDecisionBodyEnvelopeV1`）是“生产走不到”的条目，属允许清单分片（P1/P2b），本报告未按 P2a 处理；按 79-1 重看时需与那一片合并结论。
