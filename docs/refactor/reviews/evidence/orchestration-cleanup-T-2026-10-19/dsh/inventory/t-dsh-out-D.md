# D 片（state / record-store / architecture / contracts / context / core-work-graph）T 轮测试盘点

范围：`.dsh-ref/t-area-D.txt` 的 69 个文件、33,175 行。只读：未改仓库文件、未跑测试/构建/类型检查、未联网。
依据：`docs/refactor/HANDOFF.md` 决定 79（尤其 79-1、79-4）、决定 85-4、`.dsh-ref/t-common.md`、根 `AGENTS.md` 第 3/4/9 条。
做法：按文件分三部分由三个只读子任务盘点（D1/D2/D3），主会话合并、去掉重复并抽查证据；下表编号已重排为 `D-01`…；`D-08`/`D-09` 等正文交叉引用指本表编号。

## 1. 发现表

| 编号 | 类别 | 位置 (path:line; 测试名) | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---:|---|---|
| D-01 | 过时 | `tests/state/plan-machine.test.ts:113-116, 335, 379-386, 588, 828-829, 1011`；legacy_v1 × proposal_accepted（§3 穷尽矩阵）；reads the state after the Agent pre-checks: legacy, not pending and old revisions keep their codes；other content keeps today's create CAS result: a legacy record；derivePlanProposalStatus (PLAN-06) / legacy on an older plan | 夹具在 :113-116 建 `kind:'legacy_v1', draft:null, legacy:{…}`；:335 放进状态表，:379-386 给它整行矩阵，:588 进 create-CAS 表，:828-829 进 Agent 预检，:1011 进 PLAN-06。生产 `src/core/work-graph/persistence/plan-record-codecs.ts:1007-1021` 把任何 `kind !== 'candidate_v2'` 的记录按旧 `PlanProposalSnapshot` 解码成 `legacy_v1`，正是决定 79-1 要删的旧格式解码分支；产品从未真实运行。 | `delete` | 行为已不存在：决定 79-1；`STATE-MACHINES-SPEC:520,644` 的 legacy_v1 只读行须同批重看 | 17 | 是 | 中 |
| D-02 | 过时 | `tests/state/run-machine.test.ts:444-455, 638-640, 801-807, 820-822, 1012-1021, 1401-1412, 1647-1650`；reads V1 and pre-B2 authorizations as legacy history, not damage；checks the persisted claim, then the prepared binding, between the Lease and the existing authorization；refuses in recordExecutionEntered order, with no pointer fence and no fresh re-admission；refuses a V1 or pre-B2 Run with the one text of a Run without a V2 binding；reconcile_*: legacy, Host lease, probe, then the row；the guards RUN-02/04/05 and the model barrier share (A.2 step 3b) | :444-455 明确断言 V1 / pre-B2 授权读到 `legacyV1:true`；其余位置把 V1/pre-B2 当合法旧历史继续走授权、begin、terminal、reconcile。生产 `src/core/work-graph/state/run-machine.ts:77-81` 自述这是 “written before B2” 的历史 Run，:167 用 `legacyV1` 投影；`src/contracts/dispatch.ts:112-116` 是旧 `ExecutionAuthorizationV1`。没有真实 V1 库，决定 79-1 不留旧版本分支。 | `delete` | 行为已不存在：决定 79-1（发布前不兼容旧数据） | 40 | 否 | 中 |
| D-03 | 过时 | `tests/state/S1-session-archive.test.ts:192-218`；UT09 a null legacy provenance is backfilled once with the continuation, revision 4；UT10 backfilling an existing new provenance is a revision conflict and changes nothing | 两条测 `legacy_provenance_backfilled` / `backfillSessionProvenanceRecord`，即 `provenance=null` 的旧 Session 补写一次。`slice-1-SPEC.md:473` 自述“旧数据且唯一可靠 basis”；生产 `src/core/work-graph/state/session-availability.ts:1006` 与 `src/core/work-graph/tasks/session-provenance-facts.ts` 的 legacy reader 都只为旧记录存在。决定 79-1 下旧库重建、不写迁移。 | `delete` | 行为已不存在：决定 79-1；`slice-1-SPEC.md:473`“旧数据” | 27 | 是 | 高 |
| D-04 | 过时 | `tests/state/S1-dispatch.test.ts:173-185`；UT52 a null record provenance with a trusted readonly_copy legacy provenance is forbidden for Work；UT53 a null record provenance with no legacy provenance is incomplete, never treated as new | 两行的前提是 `record.provenance=null` 加 `legacyProvenance` 兜底：`src/core/work-graph/state/session-availability.ts:501` 为 `session.provenance ?? facts.legacyProvenance ?? null`，:126 是 `legacyProvenance` 字段；`slice-1-SPEC.md:942` 的给定值就是“可信 legacyProvenance”。决定 79-1 后旧记录不读，这两行没有输入。 | `delete` | 行为已不存在：决定 79-1；`slice-1-SPEC.md:942` | 13 | 是 | 高 |
| D-05 | 过时 | `tests/state/S5-goal-settings.test.ts:137-147`；GS01 an absent settings field reads as the exact §2.2 default without a write | GS01 从记录删 `settings` 再 encode/decode，断言 `readGoalSettings` 返回 §2.2 默认值。规格行写作“旧 Goal 无 settings”，但**当前新 Goal 也不写该字段**：`newGoalSnapshot`（`src/core/work-graph/state/goal-machine.ts:91-100`）只写 7 个字段，`src/core/work-graph/persistence/record-codecs.ts:794-802` 的缺省读法是所有新 Goal 的当前路径；`tests/state/goal-machine.test.ts:175-181` 还专门断言新 Goal 没有 settings。按 79-1 删除会删掉当前行为，不能删。 | `keep-note` | 行为仍在：`newGoalSnapshot`（goal-machine.ts:91-100）今天不写 `settings`；只建议改 §5.2 GS01 的“旧 Goal”措辞 | 0 | 是 | 高 |
| D-06 | 过时 | `tests/state/S5-notice-settings.test.ts:74-85`；NS01 an old Workspace without decisionSettings reads the empty noticeSeen default | 没有 `decisionSettings` 的 “old Workspace” 解码后，`effectiveWorkspaceDecisionSettings` 返回空默认且再编码字节不变。但**当前新 Workspace 也不写该字段**：`registerWorkspace` 建快照时只有 `{ref, revision:1}`（`src/core/work-graph/configuration/project-bootstrap-service.ts:669`），`src/core/work-graph/persistence/record-codecs.ts:803-814` 的缺省读法是新 Workspace 的当前路径。不能按 79-1 删；只建议改 §5.2 NS01 的“旧 Workspace”措辞。 | `keep-note` | 行为仍在：`registerWorkspace`（project-bootstrap-service.ts:669）今天不写 `decisionSettings` | 0 | 是 | 高 |
| D-07 | 过时 | `tests/record-store/SP-text-scan.test.ts:400-435`；SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports) | 用 `tests/helpers/SP-storage-migration-fixture.ts:15` 的 `addLegacyFtsArtifacts` 在 :415 造 4B 时代的 `next_fts_meta` / `next_fts_%` 虚拟表，再断言新端口在旧文件上与干净文件结果一致；生产对应 `src/core/record-store/sqlite-text-scan.ts:14` 的“open 时删旧 FTS 表”。决定 79-1 规定开发期旧库重建、不写迁移、不留旧版本读法；删除后 `addLegacyFtsArtifacts` 失去唯一调用方。 | `delete` | 行为已不存在：决定 79-1（4B 版 `next_fts_*` 不再迁移/读取） | 36 | 是 | 中 |
| D-08 | 过时 | `tests/state/invariants.ts:953, 1063, 1156, 1275, 1504, 1890, 1949, 2103-2143, 123-131, 753-760`；checkI3/checkI5/checkI7/checkI10/checkI13/checkI20/checkI22 的 legacy 分支；runCombinationProblem / checkAttemptPairing 的 V1 无授权历史 | 8 处 `legacy(...)` 豁免按旧规则写下的数据（R3e.3 前 TaskReduction、pre-D-8 的 CTL-05 指针、VD-4 前 PASS+gaps、V1 Run 的 failed、@0 evidence index、GAP-52 slot-less round root、W1 前无 `taskStateBasis` 的 v2 adoption）；当前写入方写不出这些状态：`src/core/work-graph/state/verification-machine.ts:1055-1059`（evidence index revision = 长度 ≥ 1），`src/core/work-graph/state/run-machine.ts:864,960`（只写 schemaVersion 2）。:953/:1890/:1949 在 `invariants.test.ts` 里没有调用。 | `keep-note` | 行为已不存在：决定 79-1；删前须同步改 §11 各条的 legacy 措辞 | 60 | 否 | 中 |
| D-09 | 过时 | `tests/state/invariants.test.ts:723-728, 830-834, 1092-1102, 1552-1567, 1578-1579`；I-5 legacy only when the pointer moved on；I-7 VD-4 legacy PASS；I-13 @0 legacy；I-22 v2 adoption without taskStateBasis；checkAllInvariants legacy kept apart | 用 `clone(flow.final)` 手工改出旧规则记录再断言 `legacy`：pre-D-8 指针（:723-728）、VD-4 前 PASS 带 gap（:830-834，注释 “written before the rule”）、@0 index（:1092-1102）、无 `taskStateBasis` 的 v2 adoption（:1564-1567）。这些状态没有当前写入方（见 D-08），开发期也没有旧库可产（决定 79-1）。 | `keep-note` | 行为已不存在：决定 79-1；随 §11 条款一起改 | 40 | 是 | 中 |
| D-10 | 过时 | `tests/state/context-input.test.ts:98-102`；ST01 no binding keeps the legacy input and reports no problem | `slice-3-SPEC.md:646` 的行文就是“无 binding，已有 legacy input”；生产 `src/core/work-graph/state/context-input.ts:225` 对 `binding === undefined` 直接返回 null，即旧 Run 没有 s3 绑定时放行。产品从未真实运行，没有 pre-s3 Run；决定 79-1 只读当前格式，这一行没有输入。 | `delete` | 行为已不存在：决定 79-1；`slice-3-SPEC.md:646` | 3 | 是 | 高 |
| D-11 | 过时 | `tests/state/WP1-goal-content.test.ts:107-119`；CG04 a missing binding, a null digest and another Goal all pass（仅 :108-110 的 binding:undefined 断言） | CG04 的第一条断言依赖 `binding` 缺失仍放行（`src/core/work-graph/state/context-input.ts:374`），与 ST01 同属旧 Run 无 s3 绑定；后两条（`digest:null`、只有别的 Goal）是当前语义，必须保留。 | `keep-note` | 行为已不存在：决定 79-1（只删 :108-110 的 binding:undefined 断言，保留 :111-118） | 2 | 是 | 中 |
| D-12 | 重复 | `tests/state/S1-anomaly.test.ts:132-138`；UT21 a cancelled successor that never entered carries the anchor but does not pick it up | UT21 :134 调 `deriveSessionAnomalyView(anchor, [])`，与 UT19 :106-115 的输入完全相同（UT19 也是空 entered 列表）；`pickedUpBy:null`、label、next dispatch 全被 UT19 断言。UT21 没有构造它名字里的 cancelled successor，`slice-1-SPEC.md:911` 的给定值实际未测到。 | `merge-into:tests/state/S1-anomaly.test.ts::UT19 only a claimed successor carries the anchor, so it is not picked up and the Task waits for dispatch` | tests/state/S1-anomaly.test.ts::UT19 | 7 | 是 | 高 |
| D-13 | 重复 | `tests/state/S1-dispatch.test.ts:115-119`；UT28 a stored response on m that is not yet consumed is still a wait, not idle | `dispatchFacts` 默认 `consumedWait:null`（:70-71）；UT27 :109-113 用 `dispatchFacts({waiting: WAIT_M})`，UT28 :115-119 用 `dispatchFacts({waiting: WAIT_M, consumedWait: null})`，同一输入、同一个 busy 断言、同样不 acquire。名字里的“已 responded 未消费”在 facts 中没有字段表示。 | `merge-into:tests/state/S1-dispatch.test.ts::UT27 a Session waiting on m refuses ordinary Work as busy with no effects` | tests/state/S1-dispatch.test.ts::UT27 | 5 | 是 | 高 |
| D-14 | 重复 | `tests/state/S1-responsibility.test.ts:188-201`；UT51 refuses the transfer to a readonly copy destination | UT51 与 UT14 :151-166 都传 `guards({destinationEligible:false})`，断言同一个 `unavailable` + 无 effects；机器只读 `ctx.destinationEligible`（`src/core/work-graph/state/session-responsibility.ts:54`），从不读 `state.destination` 的 health/provenance，所以 retired 与 readonly copy 在机器层不可区分。真正的派生在 `src/core/work-graph/sessions/session-responsibility-service.ts:98`，两处都没覆盖。 | `keep-note` | tests/state/S1-responsibility.test.ts::UT14 refuses the transfer to a retired destination（断言相同；readonly copy 派生是测试缺口） | 0 | 是 | 中 |
| D-15 | 重复 | `tests/state/S1-message-routing.test.ts:114-135`；UT24 refuses the transfer once the response is already accepted | UT24 用 `responseAccepted:true` 断言 `archive_wait_disposed` 返回 `guard_failed/busy`；`tests/state/message-machine.test.ts:309-320` 的 `respondedComplete × archive_wait_disposed` 由 :87 `acceptedInputIds:[MESSAGE_INPUT, RESPONSE_INPUT]` 构成，:187-189 令 `responseAccepted=true`，:318 期望同一个 `no('guard_failed','busy')`。UT24 额外的无 effects / 原记录不变由 :377 的 purity 测试覆盖。 | `keep-note` | tests/state/message-machine.test.ts::respondedComplete × archive_wait_disposed（:309-320） | 0 | 是 | 中 |
| D-16 | 重复 | `tests/state/unknown-call-kinds.test.ts:17-84`；K3-34 maps every L3 table name...；K3-34 lists the L3 rows in order...；K3-34 defaults an out-of-table name...；K3-34 maps the authorization name write...；K3-34 admits only the two proof kinds | 与 `tests/runtime/K3-34-tool-name-constants.test.ts:26-66` 是同一 K3-34 行的重叠断言：platform 名单→`platform`/contained（:41-44 vs :36-40）、`apply_future_plan`→process/false（:68-71 vs :43-45）、`write→edit` 与 read/shell/write containment（:74-84 vs :48-56）；runtime 版还用生产常量做集合比对（:60-66）。state 版独有的是行顺序/无重名（:48-58）与 `admitsAutoCleanupTakeover`（:80-86），合并时带走。`vitest.config.ts:5` 的 include 是 `tests/**/*.test.ts`，runtime 文件在同一全量内。 | `merge-into:tests/runtime/K3-34-tool-name-constants.test.ts::K3-34 tool-name constants` | tests/runtime/K3-34-tool-name-constants.test.ts::K3-34 tool-name constants（行顺序与 takeover 断言并入） | 50 | 是 | 中 |
| D-17 | 重复 | `tests/state/unknown-call-review-streak.test.ts:87-93`；K3-32 #3 and #3b: a prior disposition is not a reset point | :88-90 与 :91-92 两次 `streak(...)` 的入参（同一数组字面量、同一 `reviewed`）和 `toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: true })` 逐字相同，同一断言写了两遍；L23 的 #3 与 #3b 是两个不同例子，第二个实际没有独立覆盖。 | `keep-note` | tests/state/unknown-call-review-streak.test.ts:88-90（同一断言） | 3 | 是 | 高 |
| D-18 | 重复 | `tests/state/k3-review-claim.test.ts:92-98`；K3-38 lets an ordinary (first/requeue) claim answer busy while the record is unsettled | 该 it 的 body 只有 `reviewClaimProblem(null)` → `{reason:'illegal',code:'invalid'}`，与同 describe 内 :79（`K3-38 refuses every review-claim guard with its own row` 的第一条）断言完全相同；标题说“ordinary claim 回答 busy”，body 里没有 `claimBasisProblem`，也没有任何 busy 期望。 | `merge-into:tests/state/k3-review-claim.test.ts::K3-38 refuses every review-claim guard with its own row` | tests/state/k3-review-claim.test.ts:79 | 7 | 是 | 高 |
| D-19 | 重复 | `tests/state/no-progress.test.ts:652-655`；#23 paused-interrupted (RUN-24) keys with origin host_interrupted | :653 的 `expect(keyOf(keyInput({ afterRun: hostInterrupted('run-1', intentRef('pause-1')), head: null })).failure.origin).toBe('host_interrupted')` 与 `runFailureOrigin` 测试内 :286 的表达式和期望逐字相同；#23 相对 RUN-19 的区分语义已由 :283-285 覆盖。 | `keep-note` | tests/state/no-progress.test.ts:286（runFailureOrigin 的 owner 测试） | 3 | 是 | 中 |
| D-20 | 重复 | `tests/state/session-availability.test.ts:793-798`；reactivation of an unavailable Session is refused with unavailable (decision 38, S1-SES-05) | 与 `tests/state/S1-session-archive.test.ts:163-171`（UT07）断言同一个 `transitionSession(archived+unavailable, session_reactivated)` 拒绝 `{guard_failed, unavailable}`；两处只差 fixture 字段（occupancy/revision/pin），S1 版多断言状态仍 archived。§8 owner 文件与 S1 行文件各留一份。 | `keep-note` | tests/state/session-availability.test.ts:793-798 与 tests/state/S1-session-archive.test.ts:163-171 二选一，建议留 §8 owner | 6 | 是 | 中 |
| D-21 | 重复 | `tests/contracts/review-admission.test.ts:28-184`；reviewRoundAdmissionProblem / isReviewRoundPurpose / 两个工具名常量 | `tests/runtime/K3-19-review-admission-pure.test.ts:46-123` 已直接测同一 `reviewRoundAdmissionProblem`：接受、缺工具、多工具、非空 writeScope、Host layer 1（hostTools/readonlyCommandAccess），且同时覆盖 review 与 proposal 两相位并钉精确 reason。contracts 文件独有的断言必须在合并时带走：工具名数组字面量（:33-44）、`isReviewRoundPurpose` 真假（:62-66）、`reviewHostLayerOneAccess` 的 A1 三条（:59-77）、工具集顺序无关（:84-88）、`role_invalid`（:120-122）、非 review Run（:127-134）。 | `merge-into:tests/runtime/K3-19-review-admission-pure.test.ts::reviewRoundAdmissionProblem: combinations the real path cannot produce` | tests/runtime/K3-19-review-admission-pure.test.ts::reviewRoundAdmissionProblem | 120 | 否 | 高 |
| D-22 | 重复 | `tests/record-store/S4B-text-search.test.ts:675-725`；T-05 both: more than 1000 prefix records yield the same records / next / complete on both backends（三个 it） | 三个 `it` 各自重建同一 `capRows`（1001+1 条，:675-682）、各 `seedBatch` 两个后端、发同一个 search，只分别断言 `records`、`next`、`complete`；同一场景/同一夹具写三遍。保留 :675 一条，把另两条断言并入即可。三条都以冻结行 T-05 命名。 | `merge-into:tests/record-store/S4B-text-search.test.ts::T-05 both: more than 1000 prefix records yield the same records on both backends` | tests/record-store/S4B-text-search.test.ts:675（并入后） | 34 | 是 | 高 |
| D-23 | 重复 | `tests/state/K3-B3-shared-rules-pure.test.ts:78-116`；F-081 the state transition owns the declared-form business cap | F-081 用 8 次 `forms_added` 填满再拒第 9 次（capacity）；`tests/state/command-rerun-request-pure.test.ts:77-112` 已用字面 8 形态覆盖同一 transition 容量拒绝（`refuses forms_added on a full eight-form request with capacity`），并同时测构造器入口与固定 sha 字面量。两份都是冻结行，保留更完整的那份。 | `merge-into:tests/state/command-rerun-request-pure.test.ts::refuses forms_added on a full eight-form request with capacity` | tests/state/command-rerun-request-pure.test.ts:77-112 | 30 | 是 | 中 |
| D-24 | 重复 | `tests/state/S5-message-decision.test.ts:283-313`；MD01 / MD02 的 canSendUserMessage 前置 | MD01 在 :284-286 断言 `canSendUserMessage({duties:['adviser'],intent:'decision_request'}) === true`，MD02 在 :307-309 断言 executor false；与 `tests/state/S5-decision-policy.test.ts:109-117` 的 PO13/PO14 逐字同义。它只是随后的 message state 测试前置，保留两份会随权限表变更两处改。 | `keep-note` | tests/state/S5-decision-policy.test.ts::PO13/PO14 | 6 | 是 | 高 |
| D-25 | 手写事实 | `tests/record-store/R3a-transaction-boundaries.test.ts:20-32（:50/:81/:108 直接 commit）`；scopeSeed fixture | 直接构造 `PreparedCommit` 写 Project/Workspace 快照，并自制 `TrustedScopeSeeded` 事件（:23-25）。公开步骤今天存在：`src/core/work-graph/configuration/project-bootstrap-service.ts` 的 `createProject` 与 `registerWorkspace:601`，composition 在 `src/composition/create-platform.ts:1314-1315` 暴露。同一测试里 Goal 已走 `createGoal`，只有 scope 是手写事实。 | `convert:createProject + registerWorkspace` | 不适用（转换，不删） | 25 | 否 | 中 |
| D-26 | 只为篡改 | `tests/state/control-intent-machine.test.ts:602-606, 853-857, 859-876`；a recorded state without a kind is malformed（同名两条）；a stored locator that fails the locator codec is unavailable right after the missing-locator row (`control-service.ts:551`) | :602-606 与 :853-857 同名同输入同断言，状态 `{node:'Queued', kind:null}`。生产 `src/core/work-graph/state/control-intent-machine.ts:57-59` 写明 `kind:null` 只在 `Absent`，:331 只在 `controlIntentStateOf(null)` 产生 `Absent`；`Queued` 且无 kind 的记录当前写入方/codec 造不出，只能手写或篡改存档才到 :723/:756/:844 的守卫。:859-876 的 `history:'malformed'` 同理：:109-113 自述来自损坏的 stored locator。 | `delete` | 行为已不存在：AGENTS 第 4 条；决定 79-4 | 28 | 否 | 中 |
| D-27 | 只为篡改 | `tests/state/run-machine.test.ts:852-855, 1022-1031`；refuses a moved identity, a backwards watermark, a changed end and a foreign mapping（malformed 段）；reads a fresh entry by status, then the V2 phase, also outside the eight states | :852-855 造 `executionHistory:{…, startPosition:0}` 的损坏 locator，守卫在 `src/core/work-graph/state/run-machine.ts:1261` 返回 `unavailable`。:1022-1031 用 `withPhase(CLAIMED,'entered'／'unknown'／'settled')` 造“starting 状态 + 已进入的 V2 phase”，测试名自述 outside the eight states；当前每个 commit 原子写一条记录，造不出这种组合，只有篡改/旧记录能触发。 | `delete` | 行为已不存在：AGENTS 第 4 条；决定 79-4 | 14 | 否 | 中 |
| D-28 | 只为篡改 | `tests/record-store/R3a-transaction-boundaries.test.ts:103-131`；SQLite rejects a same-revision scope identity change made after the Goal pre-read | 测试开第二个 `DatabaseSync`，在 Goal 预读后直接 `UPDATE snapshots SET snapshot_json = ...`（:118-120）改 Workspace 身份，只为触发同 revision scope identity 防御并断言 `unavailable`（:125-127）。根 AGENTS 第 4 条与 79-4 明说不恢复只有篡改数据库才能触发的防御校验/测试。 | `delete` | 行为已不存在：只有直接改写 `snapshots.snapshot_json` 才能触发（AGENTS 第 4 条） | 29 | 否 | 高 |
| D-29 | 只为篡改 | `tests/record-store/lookup.test.ts:174-202（只删 195-201）`；SQLite adds an index to an existing database and refuses to return a matching damaged row（damaged-row 后半） | 前半 :176-193 是合法的“旧库补建索引”；后半 :195-197 用 `UPDATE snapshots SET snapshot_json = ?` 把 ref 换成别的类型，再断言 lookup 返回 `corrupt`（:200）。只有直接篡改快照 JSON 才走到该防御分支。 | `delete` | 行为已不存在：只有篡改快照 JSON 才会 corrupt（AGENTS 第 4 条；保留 :176-193） | 8 | 否 | 高 |
| D-30 | 辅助 | `tests/state/S1-session-archive.test.ts:32`；（夹具常量 S_PLAIN，无测试引用） | :32 定义 `const S_PLAIN: SessionRef = { projectId:'p', sessionId:'S' }`；`grep -rn "S_PLAIN" tests/` 只命中定义行，文件内 `grep -c` = 1，零使用。 | `delete` | 未被任何测试引用（全树 0 处使用） | 1 | 否 | 高 |
| D-31 | 辅助 | `tests/state/invariants.test.ts:86-211`；ctx / workspaceBindings / runtimeHost / planDraft / openEnvironment（store-built world 的搭建） | 与 `tests/composition/A2-requeue-platform.test.ts:82-245` 逐字段同构：同样的 `createTargetPlatform` 参数、四个 owner 调用（createProject → registerWorkspace → install/activateCompletionPolicy → adoptInitialArchitecture → createGoal → proposePlan/applyPlanChange）、同样的 `legacy_template` role、`test -f fixed.txt` 检查、脚本模型三条回复；只有 projectId/ID 前缀和 A2 的 `commitObserver` 参数不同。`invariants.test.ts:6` 自述流程取自该文件。 | `keep-note` | —（建议抽到 tests/helpers 共用；现阶段两份都会随 owner 接口变动一起改） | 125 | 否 | 高 |
| D-32 | 辅助 | `tests/state/invariants.ts:750-812, 2196, 154-158, 185-205, 221-228, 269-274, 2153-2154`；checkAttemptPairing、checkSlice1Invariants、InvariantId、Slice1InvariantId、InvariantEventType、InvariantManifest、InvariantStore、InvariantChecker | 全 `tests/` 树 import 扫描：`checkAttemptPairing` 只在 `invariants.ts:814,1092` 被 `checkI1`/`checkI6` 内部调用；`checkSlice1Invariants` 只在 :2267 被 `checkAllInvariants` 调用；其余类型无任何测试导入（测试只用 `InvariantWorld`/`FuzzStep`/`FuzzStepKind`/`InvariantTaskState`/`InvariantEvent`/`InvariantViolation`）。`export` 只把内部名字外露，删 `export` 不删实现。 | `keep-note` | — | 0 | 否 | 高 |
| D-33 | 辅助 | `tests/record-store/S2A-ordered-lookup.test.ts:24-140`；私有 keyOf / widget / event / change / widgetSchemas / withLookups / open / seed | `tests/helpers/S4B-text-search-support.ts:36-178` 已导出同义的 `widgetSchemas`、`withLookups`、`keyOf`、`widget`、`event`、`change`、`open`（支持 `schemas` 覆盖）、`seed`；S4B、SP-text-scan、SP-record-store-limits 已复用。S2A 又抄一份，只有三个索引名不同。 | `merge-into:tests/helpers/S4B-text-search-support.ts::widgetSchemas/withLookups/keyOf/widget/event/change/open/seed` | tests/helpers/S4B-text-search-support.ts | 80 | 否 | 高 |
| D-34 | 辅助 | `tests/record-store/S2C-count-lookup.test.ts:34-120`；同一组私有构造器 | 与 D-33 逐段重复（`widgetSchemas`、`withLookups`、`keyOf`、`widget`、`event`、`change`、`open`、`seed`），仅索引名与 `RecordCountPort` 不同；共享 helper 的 `open(kind,{schemas})` 已足够，返回类型由本文件自己 cast。 | `merge-into:tests/helpers/S4B-text-search-support.ts::widgetSchemas/withLookups/keyOf/widget/event/change/open/seed` | tests/helpers/S4B-text-search-support.ts | 70 | 否 | 高 |
| D-35 | 辅助 | `tests/record-store/SP-literal-type.test.ts:34-64；另 tests/record-store/SP-lookup-index-migration.test.ts:38-95`；两份通用的 recordSchema / event / open / commit 构造器 | `SP-literal-type.test.ts:34-64` 与 `SP-lookup-index-migration.test.ts:38-95` 各写一份通用 `recordSchema(aggregateType)`、`Changed` 事件、`open(kind, schemas)` 和单行 `PreparedCommit`（SP-lookup 还多 `keyW/keyV/typed/commitRow/openSqlite`）。它们不是 Widget 专用，放一个 `tests/helpers/SP-record-store-support.ts` 即可两处共用。 | `merge-into:tests/helpers/SP-record-store-support.ts（新建；两文件的通用构造器合并）` | 新建 helper，两测试共用 | 30 | 否 | 中 |

## 2. JSON

```json
[
  {
    "id": "D-01",
    "category": "stale",
    "file": "tests/state/plan-machine.test.ts",
    "lines": "113-116, 335, 379-386, 588, 828-829, 1011",
    "tests": "legacy_v1 × proposal_accepted（§3 穷尽矩阵）；reads the state after the Agent pre-checks: legacy, not pending and old revisions keep their codes；other content keeps today's create CAS result: a legacy record；derivePlanProposalStatus (PLAN-06) / legacy on an older plan",
    "evidence": "夹具在 :113-116 建 `kind:'legacy_v1', draft:null, legacy:{…}`；:335 放进状态表，:379-386 给它整行矩阵，:588 进 create-CAS 表，:828-829 进 Agent 预检，:1011 进 PLAN-06。生产 `src/core/work-graph/persistence/plan-record-codecs.ts:1007-1021` 把任何 `kind !== 'candidate_v2'` 的记录按旧 `PlanProposalSnapshot` 解码成 `legacy_v1`，正是决定 79-1 要删的旧格式解码分支；产品从未真实运行。",
    "action": "delete",
    "covered_by": "行为已不存在：决定 79-1；`STATE-MACHINES-SPEC:520,644` 的 legacy_v1 只读行须同批重看",
    "est_lines": 17,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-02",
    "category": "stale",
    "file": "tests/state/run-machine.test.ts",
    "lines": "444-455, 638-640, 801-807, 820-822, 1012-1021, 1401-1412, 1647-1650",
    "tests": "reads V1 and pre-B2 authorizations as legacy history, not damage；checks the persisted claim, then the prepared binding, between the Lease and the existing authorization；refuses in recordExecutionEntered order, with no pointer fence and no fresh re-admission；refuses a V1 or pre-B2 Run with the one text of a Run without a V2 binding；reconcile_*: legacy, Host lease, probe, then the row；the guards RUN-02/04/05 and the model barrier share (A.2 step 3b)",
    "evidence": ":444-455 明确断言 V1 / pre-B2 授权读到 `legacyV1:true`；其余位置把 V1/pre-B2 当合法旧历史继续走授权、begin、terminal、reconcile。生产 `src/core/work-graph/state/run-machine.ts:77-81` 自述这是 “written before B2” 的历史 Run，:167 用 `legacyV1` 投影；`src/contracts/dispatch.ts:112-116` 是旧 `ExecutionAuthorizationV1`。没有真实 V1 库，决定 79-1 不留旧版本分支。",
    "action": "delete",
    "covered_by": "行为已不存在：决定 79-1（发布前不兼容旧数据）",
    "est_lines": 40,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "D-03",
    "category": "stale",
    "file": "tests/state/S1-session-archive.test.ts",
    "lines": "192-218",
    "tests": "UT09 a null legacy provenance is backfilled once with the continuation, revision 4；UT10 backfilling an existing new provenance is a revision conflict and changes nothing",
    "evidence": "两条测 `legacy_provenance_backfilled` / `backfillSessionProvenanceRecord`，即 `provenance=null` 的旧 Session 补写一次。`slice-1-SPEC.md:473` 自述“旧数据且唯一可靠 basis”；生产 `src/core/work-graph/state/session-availability.ts:1006` 与 `src/core/work-graph/tasks/session-provenance-facts.ts` 的 legacy reader 都只为旧记录存在。决定 79-1 下旧库重建、不写迁移。",
    "action": "delete",
    "covered_by": "行为已不存在：决定 79-1；`slice-1-SPEC.md:473`“旧数据”",
    "est_lines": 27,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-04",
    "category": "stale",
    "file": "tests/state/S1-dispatch.test.ts",
    "lines": "173-185",
    "tests": "UT52 a null record provenance with a trusted readonly_copy legacy provenance is forbidden for Work；UT53 a null record provenance with no legacy provenance is incomplete, never treated as new",
    "evidence": "两行的前提是 `record.provenance=null` 加 `legacyProvenance` 兜底：`src/core/work-graph/state/session-availability.ts:501` 为 `session.provenance ?? facts.legacyProvenance ?? null`，:126 是 `legacyProvenance` 字段；`slice-1-SPEC.md:942` 的给定值就是“可信 legacyProvenance”。决定 79-1 后旧记录不读，这两行没有输入。",
    "action": "delete",
    "covered_by": "行为已不存在：决定 79-1；`slice-1-SPEC.md:942`",
    "est_lines": 13,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-05",
    "category": "stale",
    "file": "tests/state/S5-goal-settings.test.ts",
    "lines": "137-147",
    "tests": "GS01 an absent settings field reads as the exact §2.2 default without a write",
    "evidence": "GS01 从记录删 `settings` 再 encode/decode，断言 `readGoalSettings` 返回 §2.2 默认值。规格行写作“旧 Goal 无 settings”，但**当前新 Goal 也不写该字段**：`newGoalSnapshot`（`src/core/work-graph/state/goal-machine.ts:91-100`）只写 7 个字段，`src/core/work-graph/persistence/record-codecs.ts:794-802` 的缺省读法是所有新 Goal 的当前路径；`tests/state/goal-machine.test.ts:175-181` 还专门断言新 Goal 没有 settings。按 79-1 删除会删掉当前行为，不能删。",
    "action": "keep-note",
    "covered_by": "行为仍在：`newGoalSnapshot`（goal-machine.ts:91-100）今天不写 `settings`；只建议改 §5.2 GS01 的“旧 Goal”措辞",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-06",
    "category": "stale",
    "file": "tests/state/S5-notice-settings.test.ts",
    "lines": "74-85",
    "tests": "NS01 an old Workspace without decisionSettings reads the empty noticeSeen default",
    "evidence": "没有 `decisionSettings` 的 “old Workspace” 解码后，`effectiveWorkspaceDecisionSettings` 返回空默认且再编码字节不变。但**当前新 Workspace 也不写该字段**：`registerWorkspace` 建快照时只有 `{ref, revision:1}`（`src/core/work-graph/configuration/project-bootstrap-service.ts:669`），`src/core/work-graph/persistence/record-codecs.ts:803-814` 的缺省读法是新 Workspace 的当前路径。不能按 79-1 删；只建议改 §5.2 NS01 的“旧 Workspace”措辞。",
    "action": "keep-note",
    "covered_by": "行为仍在：`registerWorkspace`（project-bootstrap-service.ts:669）今天不写 `decisionSettings`",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-07",
    "category": "stale",
    "file": "tests/record-store/SP-text-scan.test.ts",
    "lines": "400-435",
    "tests": "SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)",
    "evidence": "用 `tests/helpers/SP-storage-migration-fixture.ts:15` 的 `addLegacyFtsArtifacts` 在 :415 造 4B 时代的 `next_fts_meta` / `next_fts_%` 虚拟表，再断言新端口在旧文件上与干净文件结果一致；生产对应 `src/core/record-store/sqlite-text-scan.ts:14` 的“open 时删旧 FTS 表”。决定 79-1 规定开发期旧库重建、不写迁移、不留旧版本读法；删除后 `addLegacyFtsArtifacts` 失去唯一调用方。",
    "action": "delete",
    "covered_by": "行为已不存在：决定 79-1（4B 版 `next_fts_*` 不再迁移/读取）",
    "est_lines": 36,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-08",
    "category": "stale",
    "file": "tests/state/invariants.ts",
    "lines": "953, 1063, 1156, 1275, 1504, 1890, 1949, 2103-2143, 123-131, 753-760",
    "tests": "checkI3/checkI5/checkI7/checkI10/checkI13/checkI20/checkI22 的 legacy 分支；runCombinationProblem / checkAttemptPairing 的 V1 无授权历史",
    "evidence": "8 处 `legacy(...)` 豁免按旧规则写下的数据（R3e.3 前 TaskReduction、pre-D-8 的 CTL-05 指针、VD-4 前 PASS+gaps、V1 Run 的 failed、@0 evidence index、GAP-52 slot-less round root、W1 前无 `taskStateBasis` 的 v2 adoption）；当前写入方写不出这些状态：`src/core/work-graph/state/verification-machine.ts:1055-1059`（evidence index revision = 长度 ≥ 1），`src/core/work-graph/state/run-machine.ts:864,960`（只写 schemaVersion 2）。:953/:1890/:1949 在 `invariants.test.ts` 里没有调用。",
    "action": "keep-note",
    "covered_by": "行为已不存在：决定 79-1；删前须同步改 §11 各条的 legacy 措辞",
    "est_lines": 60,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "D-09",
    "category": "stale",
    "file": "tests/state/invariants.test.ts",
    "lines": "723-728, 830-834, 1092-1102, 1552-1567, 1578-1579",
    "tests": "I-5 legacy only when the pointer moved on；I-7 VD-4 legacy PASS；I-13 @0 legacy；I-22 v2 adoption without taskStateBasis；checkAllInvariants legacy kept apart",
    "evidence": "用 `clone(flow.final)` 手工改出旧规则记录再断言 `legacy`：pre-D-8 指针（:723-728）、VD-4 前 PASS 带 gap（:830-834，注释 “written before the rule”）、@0 index（:1092-1102）、无 `taskStateBasis` 的 v2 adoption（:1564-1567）。这些状态没有当前写入方（见 D-08），开发期也没有旧库可产（决定 79-1）。",
    "action": "keep-note",
    "covered_by": "行为已不存在：决定 79-1；随 §11 条款一起改",
    "est_lines": 40,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-10",
    "category": "stale",
    "file": "tests/state/context-input.test.ts",
    "lines": "98-102",
    "tests": "ST01 no binding keeps the legacy input and reports no problem",
    "evidence": "`slice-3-SPEC.md:646` 的行文就是“无 binding，已有 legacy input”；生产 `src/core/work-graph/state/context-input.ts:225` 对 `binding === undefined` 直接返回 null，即旧 Run 没有 s3 绑定时放行。产品从未真实运行，没有 pre-s3 Run；决定 79-1 只读当前格式，这一行没有输入。",
    "action": "delete",
    "covered_by": "行为已不存在：决定 79-1；`slice-3-SPEC.md:646`",
    "est_lines": 3,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-11",
    "category": "stale",
    "file": "tests/state/WP1-goal-content.test.ts",
    "lines": "107-119",
    "tests": "CG04 a missing binding, a null digest and another Goal all pass（仅 :108-110 的 binding:undefined 断言）",
    "evidence": "CG04 的第一条断言依赖 `binding` 缺失仍放行（`src/core/work-graph/state/context-input.ts:374`），与 ST01 同属旧 Run 无 s3 绑定；后两条（`digest:null`、只有别的 Goal）是当前语义，必须保留。",
    "action": "keep-note",
    "covered_by": "行为已不存在：决定 79-1（只删 :108-110 的 binding:undefined 断言，保留 :111-118）",
    "est_lines": 2,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-12",
    "category": "duplicate",
    "file": "tests/state/S1-anomaly.test.ts",
    "lines": "132-138",
    "tests": "UT21 a cancelled successor that never entered carries the anchor but does not pick it up",
    "evidence": "UT21 :134 调 `deriveSessionAnomalyView(anchor, [])`，与 UT19 :106-115 的输入完全相同（UT19 也是空 entered 列表）；`pickedUpBy:null`、label、next dispatch 全被 UT19 断言。UT21 没有构造它名字里的 cancelled successor，`slice-1-SPEC.md:911` 的给定值实际未测到。",
    "action": "merge-into:tests/state/S1-anomaly.test.ts::UT19 only a claimed successor carries the anchor, so it is not picked up and the Task waits for dispatch",
    "covered_by": "tests/state/S1-anomaly.test.ts::UT19",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-13",
    "category": "duplicate",
    "file": "tests/state/S1-dispatch.test.ts",
    "lines": "115-119",
    "tests": "UT28 a stored response on m that is not yet consumed is still a wait, not idle",
    "evidence": "`dispatchFacts` 默认 `consumedWait:null`（:70-71）；UT27 :109-113 用 `dispatchFacts({waiting: WAIT_M})`，UT28 :115-119 用 `dispatchFacts({waiting: WAIT_M, consumedWait: null})`，同一输入、同一个 busy 断言、同样不 acquire。名字里的“已 responded 未消费”在 facts 中没有字段表示。",
    "action": "merge-into:tests/state/S1-dispatch.test.ts::UT27 a Session waiting on m refuses ordinary Work as busy with no effects",
    "covered_by": "tests/state/S1-dispatch.test.ts::UT27",
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-14",
    "category": "duplicate",
    "file": "tests/state/S1-responsibility.test.ts",
    "lines": "188-201",
    "tests": "UT51 refuses the transfer to a readonly copy destination",
    "evidence": "UT51 与 UT14 :151-166 都传 `guards({destinationEligible:false})`，断言同一个 `unavailable` + 无 effects；机器只读 `ctx.destinationEligible`（`src/core/work-graph/state/session-responsibility.ts:54`），从不读 `state.destination` 的 health/provenance，所以 retired 与 readonly copy 在机器层不可区分。真正的派生在 `src/core/work-graph/sessions/session-responsibility-service.ts:98`，两处都没覆盖。",
    "action": "keep-note",
    "covered_by": "tests/state/S1-responsibility.test.ts::UT14 refuses the transfer to a retired destination（断言相同；readonly copy 派生是测试缺口）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-15",
    "category": "duplicate",
    "file": "tests/state/S1-message-routing.test.ts",
    "lines": "114-135",
    "tests": "UT24 refuses the transfer once the response is already accepted",
    "evidence": "UT24 用 `responseAccepted:true` 断言 `archive_wait_disposed` 返回 `guard_failed/busy`；`tests/state/message-machine.test.ts:309-320` 的 `respondedComplete × archive_wait_disposed` 由 :87 `acceptedInputIds:[MESSAGE_INPUT, RESPONSE_INPUT]` 构成，:187-189 令 `responseAccepted=true`，:318 期望同一个 `no('guard_failed','busy')`。UT24 额外的无 effects / 原记录不变由 :377 的 purity 测试覆盖。",
    "action": "keep-note",
    "covered_by": "tests/state/message-machine.test.ts::respondedComplete × archive_wait_disposed（:309-320）",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-16",
    "category": "duplicate",
    "file": "tests/state/unknown-call-kinds.test.ts",
    "lines": "17-84",
    "tests": "K3-34 maps every L3 table name...；K3-34 lists the L3 rows in order...；K3-34 defaults an out-of-table name...；K3-34 maps the authorization name write...；K3-34 admits only the two proof kinds",
    "evidence": "与 `tests/runtime/K3-34-tool-name-constants.test.ts:26-66` 是同一 K3-34 行的重叠断言：platform 名单→`platform`/contained（:41-44 vs :36-40）、`apply_future_plan`→process/false（:68-71 vs :43-45）、`write→edit` 与 read/shell/write containment（:74-84 vs :48-56）；runtime 版还用生产常量做集合比对（:60-66）。state 版独有的是行顺序/无重名（:48-58）与 `admitsAutoCleanupTakeover`（:80-86），合并时带走。`vitest.config.ts:5` 的 include 是 `tests/**/*.test.ts`，runtime 文件在同一全量内。",
    "action": "merge-into:tests/runtime/K3-34-tool-name-constants.test.ts::K3-34 tool-name constants",
    "covered_by": "tests/runtime/K3-34-tool-name-constants.test.ts::K3-34 tool-name constants（行顺序与 takeover 断言并入）",
    "est_lines": 50,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-17",
    "category": "duplicate",
    "file": "tests/state/unknown-call-review-streak.test.ts",
    "lines": "87-93",
    "tests": "K3-32 #3 and #3b: a prior disposition is not a reset point",
    "evidence": ":88-90 与 :91-92 两次 `streak(...)` 的入参（同一数组字面量、同一 `reviewed`）和 `toMatchObject({ priorAutoCleanup: true, priorUnknownProcess: true })` 逐字相同，同一断言写了两遍；L23 的 #3 与 #3b 是两个不同例子，第二个实际没有独立覆盖。",
    "action": "keep-note",
    "covered_by": "tests/state/unknown-call-review-streak.test.ts:88-90（同一断言）",
    "est_lines": 3,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-18",
    "category": "duplicate",
    "file": "tests/state/k3-review-claim.test.ts",
    "lines": "92-98",
    "tests": "K3-38 lets an ordinary (first/requeue) claim answer busy while the record is unsettled",
    "evidence": "该 it 的 body 只有 `reviewClaimProblem(null)` → `{reason:'illegal',code:'invalid'}`，与同 describe 内 :79（`K3-38 refuses every review-claim guard with its own row` 的第一条）断言完全相同；标题说“ordinary claim 回答 busy”，body 里没有 `claimBasisProblem`，也没有任何 busy 期望。",
    "action": "merge-into:tests/state/k3-review-claim.test.ts::K3-38 refuses every review-claim guard with its own row",
    "covered_by": "tests/state/k3-review-claim.test.ts:79",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-19",
    "category": "duplicate",
    "file": "tests/state/no-progress.test.ts",
    "lines": "652-655",
    "tests": "#23 paused-interrupted (RUN-24) keys with origin host_interrupted",
    "evidence": ":653 的 `expect(keyOf(keyInput({ afterRun: hostInterrupted('run-1', intentRef('pause-1')), head: null })).failure.origin).toBe('host_interrupted')` 与 `runFailureOrigin` 测试内 :286 的表达式和期望逐字相同；#23 相对 RUN-19 的区分语义已由 :283-285 覆盖。",
    "action": "keep-note",
    "covered_by": "tests/state/no-progress.test.ts:286（runFailureOrigin 的 owner 测试）",
    "est_lines": 3,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-20",
    "category": "duplicate",
    "file": "tests/state/session-availability.test.ts",
    "lines": "793-798",
    "tests": "reactivation of an unavailable Session is refused with unavailable (decision 38, S1-SES-05)",
    "evidence": "与 `tests/state/S1-session-archive.test.ts:163-171`（UT07）断言同一个 `transitionSession(archived+unavailable, session_reactivated)` 拒绝 `{guard_failed, unavailable}`；两处只差 fixture 字段（occupancy/revision/pin），S1 版多断言状态仍 archived。§8 owner 文件与 S1 行文件各留一份。",
    "action": "keep-note",
    "covered_by": "tests/state/session-availability.test.ts:793-798 与 tests/state/S1-session-archive.test.ts:163-171 二选一，建议留 §8 owner",
    "est_lines": 6,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-21",
    "category": "duplicate",
    "file": "tests/contracts/review-admission.test.ts",
    "lines": "28-184",
    "tests": "reviewRoundAdmissionProblem / isReviewRoundPurpose / 两个工具名常量",
    "evidence": "`tests/runtime/K3-19-review-admission-pure.test.ts:46-123` 已直接测同一 `reviewRoundAdmissionProblem`：接受、缺工具、多工具、非空 writeScope、Host layer 1（hostTools/readonlyCommandAccess），且同时覆盖 review 与 proposal 两相位并钉精确 reason。contracts 文件独有的断言必须在合并时带走：工具名数组字面量（:33-44）、`isReviewRoundPurpose` 真假（:62-66）、`reviewHostLayerOneAccess` 的 A1 三条（:59-77）、工具集顺序无关（:84-88）、`role_invalid`（:120-122）、非 review Run（:127-134）。",
    "action": "merge-into:tests/runtime/K3-19-review-admission-pure.test.ts::reviewRoundAdmissionProblem: combinations the real path cannot produce",
    "covered_by": "tests/runtime/K3-19-review-admission-pure.test.ts::reviewRoundAdmissionProblem",
    "est_lines": 120,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-22",
    "category": "duplicate",
    "file": "tests/record-store/S4B-text-search.test.ts",
    "lines": "675-725",
    "tests": "T-05 both: more than 1000 prefix records yield the same records / next / complete on both backends（三个 it）",
    "evidence": "三个 `it` 各自重建同一 `capRows`（1001+1 条，:675-682）、各 `seedBatch` 两个后端、发同一个 search，只分别断言 `records`、`next`、`complete`；同一场景/同一夹具写三遍。保留 :675 一条，把另两条断言并入即可。三条都以冻结行 T-05 命名。",
    "action": "merge-into:tests/record-store/S4B-text-search.test.ts::T-05 both: more than 1000 prefix records yield the same records on both backends",
    "covered_by": "tests/record-store/S4B-text-search.test.ts:675（并入后）",
    "est_lines": 34,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-23",
    "category": "duplicate",
    "file": "tests/state/K3-B3-shared-rules-pure.test.ts",
    "lines": "78-116",
    "tests": "F-081 the state transition owns the declared-form business cap",
    "evidence": "F-081 用 8 次 `forms_added` 填满再拒第 9 次（capacity）；`tests/state/command-rerun-request-pure.test.ts:77-112` 已用字面 8 形态覆盖同一 transition 容量拒绝（`refuses forms_added on a full eight-form request with capacity`），并同时测构造器入口与固定 sha 字面量。两份都是冻结行，保留更完整的那份。",
    "action": "merge-into:tests/state/command-rerun-request-pure.test.ts::refuses forms_added on a full eight-form request with capacity",
    "covered_by": "tests/state/command-rerun-request-pure.test.ts:77-112",
    "est_lines": 30,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "D-24",
    "category": "duplicate",
    "file": "tests/state/S5-message-decision.test.ts",
    "lines": "283-313",
    "tests": "MD01 / MD02 的 canSendUserMessage 前置",
    "evidence": "MD01 在 :284-286 断言 `canSendUserMessage({duties:['adviser'],intent:'decision_request'}) === true`，MD02 在 :307-309 断言 executor false；与 `tests/state/S5-decision-policy.test.ts:109-117` 的 PO13/PO14 逐字同义。它只是随后的 message state 测试前置，保留两份会随权限表变更两处改。",
    "action": "keep-note",
    "covered_by": "tests/state/S5-decision-policy.test.ts::PO13/PO14",
    "est_lines": 6,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-25",
    "category": "handwritten",
    "file": "tests/record-store/R3a-transaction-boundaries.test.ts",
    "lines": "20-32（:50/:81/:108 直接 commit）",
    "tests": "scopeSeed fixture",
    "evidence": "直接构造 `PreparedCommit` 写 Project/Workspace 快照，并自制 `TrustedScopeSeeded` 事件（:23-25）。公开步骤今天存在：`src/core/work-graph/configuration/project-bootstrap-service.ts` 的 `createProject` 与 `registerWorkspace:601`，composition 在 `src/composition/create-platform.ts:1314-1315` 暴露。同一测试里 Goal 已走 `createGoal`，只有 scope 是手写事实。",
    "action": "convert:createProject + registerWorkspace",
    "covered_by": "不适用（转换，不删）",
    "est_lines": 25,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "D-26",
    "category": "tamper",
    "file": "tests/state/control-intent-machine.test.ts",
    "lines": "602-606, 853-857, 859-876",
    "tests": "a recorded state without a kind is malformed（同名两条）；a stored locator that fails the locator codec is unavailable right after the missing-locator row (`control-service.ts:551`)",
    "evidence": ":602-606 与 :853-857 同名同输入同断言，状态 `{node:'Queued', kind:null}`。生产 `src/core/work-graph/state/control-intent-machine.ts:57-59` 写明 `kind:null` 只在 `Absent`，:331 只在 `controlIntentStateOf(null)` 产生 `Absent`；`Queued` 且无 kind 的记录当前写入方/codec 造不出，只能手写或篡改存档才到 :723/:756/:844 的守卫。:859-876 的 `history:'malformed'` 同理：:109-113 自述来自损坏的 stored locator。",
    "action": "delete",
    "covered_by": "行为已不存在：AGENTS 第 4 条；决定 79-4",
    "est_lines": 28,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "D-27",
    "category": "tamper",
    "file": "tests/state/run-machine.test.ts",
    "lines": "852-855, 1022-1031",
    "tests": "refuses a moved identity, a backwards watermark, a changed end and a foreign mapping（malformed 段）；reads a fresh entry by status, then the V2 phase, also outside the eight states",
    "evidence": ":852-855 造 `executionHistory:{…, startPosition:0}` 的损坏 locator，守卫在 `src/core/work-graph/state/run-machine.ts:1261` 返回 `unavailable`。:1022-1031 用 `withPhase(CLAIMED,'entered'|'unknown'|'settled')` 造“starting 状态 + 已进入的 V2 phase”，测试名自述 outside the eight states；当前每个 commit 原子写一条记录，造不出这种组合，只有篡改/旧记录能触发。",
    "action": "delete",
    "covered_by": "行为已不存在：AGENTS 第 4 条；决定 79-4",
    "est_lines": 14,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "D-28",
    "category": "tamper",
    "file": "tests/record-store/R3a-transaction-boundaries.test.ts",
    "lines": "103-131",
    "tests": "SQLite rejects a same-revision scope identity change made after the Goal pre-read",
    "evidence": "测试开第二个 `DatabaseSync`，在 Goal 预读后直接 `UPDATE snapshots SET snapshot_json = ...`（:118-120）改 Workspace 身份，只为触发同 revision scope identity 防御并断言 `unavailable`（:125-127）。根 AGENTS 第 4 条与 79-4 明说不恢复只有篡改数据库才能触发的防御校验/测试。",
    "action": "delete",
    "covered_by": "行为已不存在：只有直接改写 `snapshots.snapshot_json` 才能触发（AGENTS 第 4 条）",
    "est_lines": 29,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-29",
    "category": "tamper",
    "file": "tests/record-store/lookup.test.ts",
    "lines": "174-202（只删 195-201）",
    "tests": "SQLite adds an index to an existing database and refuses to return a matching damaged row（damaged-row 后半）",
    "evidence": "前半 :176-193 是合法的“旧库补建索引”；后半 :195-197 用 `UPDATE snapshots SET snapshot_json = ?` 把 ref 换成别的类型，再断言 lookup 返回 `corrupt`（:200）。只有直接篡改快照 JSON 才走到该防御分支。",
    "action": "delete",
    "covered_by": "行为已不存在：只有篡改快照 JSON 才会 corrupt（AGENTS 第 4 条；保留 :176-193）",
    "est_lines": 8,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-30",
    "category": "helper",
    "file": "tests/state/S1-session-archive.test.ts",
    "lines": "32",
    "tests": "（夹具常量 S_PLAIN，无测试引用）",
    "evidence": ":32 定义 `const S_PLAIN: SessionRef = { projectId:'p', sessionId:'S' }`；`grep -rn \"S_PLAIN\" tests/` 只命中定义行，文件内 `grep -c` = 1，零使用。",
    "action": "delete",
    "covered_by": "未被任何测试引用（全树 0 处使用）",
    "est_lines": 1,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-31",
    "category": "helper",
    "file": "tests/state/invariants.test.ts",
    "lines": "86-211",
    "tests": "ctx / workspaceBindings / runtimeHost / planDraft / openEnvironment（store-built world 的搭建）",
    "evidence": "与 `tests/composition/A2-requeue-platform.test.ts:82-245` 逐字段同构：同样的 `createTargetPlatform` 参数、四个 owner 调用（createProject → registerWorkspace → install/activateCompletionPolicy → adoptInitialArchitecture → createGoal → proposePlan/applyPlanChange）、同样的 `legacy_template` role、`test -f fixed.txt` 检查、脚本模型三条回复；只有 projectId/ID 前缀和 A2 的 `commitObserver` 参数不同。`invariants.test.ts:6` 自述流程取自该文件。",
    "action": "keep-note",
    "covered_by": "—（建议抽到 tests/helpers 共用；现阶段两份都会随 owner 接口变动一起改）",
    "est_lines": 125,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-32",
    "category": "helper",
    "file": "tests/state/invariants.ts",
    "lines": "750-812, 2196, 154-158, 185-205, 221-228, 269-274, 2153-2154",
    "tests": "checkAttemptPairing、checkSlice1Invariants、InvariantId、Slice1InvariantId、InvariantEventType、InvariantManifest、InvariantStore、InvariantChecker",
    "evidence": "全 `tests/` 树 import 扫描：`checkAttemptPairing` 只在 `invariants.ts:814,1092` 被 `checkI1`/`checkI6` 内部调用；`checkSlice1Invariants` 只在 :2267 被 `checkAllInvariants` 调用；其余类型无任何测试导入（测试只用 `InvariantWorld`/`FuzzStep`/`FuzzStepKind`/`InvariantTaskState`/`InvariantEvent`/`InvariantViolation`）。`export` 只把内部名字外露，删 `export` 不删实现。",
    "action": "keep-note",
    "covered_by": "—",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-33",
    "category": "helper",
    "file": "tests/record-store/S2A-ordered-lookup.test.ts",
    "lines": "24-140",
    "tests": "私有 keyOf / widget / event / change / widgetSchemas / withLookups / open / seed",
    "evidence": "`tests/helpers/S4B-text-search-support.ts:36-178` 已导出同义的 `widgetSchemas`、`withLookups`、`keyOf`、`widget`、`event`、`change`、`open`（支持 `schemas` 覆盖）、`seed`；S4B、SP-text-scan、SP-record-store-limits 已复用。S2A 又抄一份，只有三个索引名不同。",
    "action": "merge-into:tests/helpers/S4B-text-search-support.ts::widgetSchemas/withLookups/keyOf/widget/event/change/open/seed",
    "covered_by": "tests/helpers/S4B-text-search-support.ts",
    "est_lines": 80,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-34",
    "category": "helper",
    "file": "tests/record-store/S2C-count-lookup.test.ts",
    "lines": "34-120",
    "tests": "同一组私有构造器",
    "evidence": "与 D-33 逐段重复（`widgetSchemas`、`withLookups`、`keyOf`、`widget`、`event`、`change`、`open`、`seed`），仅索引名与 `RecordCountPort` 不同；共享 helper 的 `open(kind,{schemas})` 已足够，返回类型由本文件自己 cast。",
    "action": "merge-into:tests/helpers/S4B-text-search-support.ts::widgetSchemas/withLookups/keyOf/widget/event/change/open/seed",
    "covered_by": "tests/helpers/S4B-text-search-support.ts",
    "est_lines": 70,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-35",
    "category": "helper",
    "file": "tests/record-store/SP-literal-type.test.ts",
    "lines": "34-64；另 tests/record-store/SP-lookup-index-migration.test.ts:38-95",
    "tests": "两份通用的 recordSchema / event / open / commit 构造器",
    "evidence": "`SP-literal-type.test.ts:34-64` 与 `SP-lookup-index-migration.test.ts:38-95` 各写一份通用 `recordSchema(aggregateType)`、`Changed` 事件、`open(kind, schemas)` 和单行 `PreparedCommit`（SP-lookup 还多 `keyW/keyV/typed/commitRow/openSqlite`）。它们不是 Widget 专用，放一个 `tests/helpers/SP-record-store-support.ts` 即可两处共用。",
    "action": "merge-into:tests/helpers/SP-record-store-support.ts（新建；两文件的通用构造器合并）",
    "covered_by": "新建 helper，两测试共用",
    "est_lines": 30,
    "spec_row": false,
    "confidence": "中"
  }
]
```

## 3. 分类合计

| 类别 | 条数 | 估计行数 |
|---|---:|---:|
| 过时 | 11 | 238 |
| 重复 | 13 | 271 |
| 手写事实 | 1 | 25 |
| 只为篡改 | 4 | 79 |
| 辅助 | 6 | 306 |
| **合计** | **35** | **919** |

按建议动作：`delete` 11 条 / 216 行；`merge-into` 10 条 / 433 行；`convert` 1 条 / 25 行；`keep-note` 13 条 / 245 行（含建议抽 helper、改规格措辞与只删单条断言的“改”而不整条删）。

## 4. 覆盖说明

- **全读（逐行）**：`tests/state/` 的 S1-anomaly、S1-archive-rework、S1-dispatch、S1-message-routing、S1-responsibility、S1-session-archive（6 个，1,148 行）；`unknown-call-review-streak`、`unknown-call-kinds`、`review-lease`、`k3-failure-classification`、`k3-review-claim`、`invariants-fuzz`、`tests/context/verification-workspace-reader`、`tests/core/work-graph/MVP-execution-list`（8 个）；以及第 3 部分的 31 个文件（含 `S2A-ordered-lookup`、`S4B-text-search`、`R3a`、`R3b`、`SP-text-scan-undo`、`SP-record-store-limits`、`lookup`、`WP2-notice-cursors`、全部 `contracts/` 与 `production-reach.test.ts`）。
- **跳读/抽查**：`run-machine`、`task-machine`、`goal-machine`、`plan-machine`、`control-intent-machine`、`message-machine`、`attempt-machine` 七个大文件（读文件头、全部 describe/it 名与被引片段）；`invariants.ts`（读 1-860、953-1075、1262-1285、2180-2274，其余 grep 定位）、`invariants.test.ts`（读 1-420、450-500、895-930、1470-1581）；`verification-machine`、`task-failure`、`session-availability`、`no-progress`、`k3-run-reconcile`、`state-writes`（读关键段与全部 it 名）。
- **未逐行读完的区段**（均已打开、按标题/构造器判断）：`SP-text-scan` 的 1-497 分段跳读；`SP-literal-type` 90 行以后；`SP-lookup-index-migration` 110-120；`transaction-extensions` 180-216；`S2C-count-lookup` 80-120；`boundaries.test.ts` 夹具；`production-reach.ts` 60-745。**没有整文件未打开**。
- **未决/留 lead 判断**：① D-05/D-06 经核对是新 Goal / 新 Workspace 的当前缺省读法（新写入也不带该字段），已从“删除”改为 keep-note；真正要同批删生产旧分支的是 D-10/D-11 的旧 context binding（`context-input.ts:225,374`）；② D-07 删除后 `addLegacyFtsArtifacts` 失去唯一调用方（helper 不在本区清单）；③ D-16/D-21 的合并跨到 `tests/runtime/` 与 `tests/helpers/`，需确认文件归属与 import 可行；④ D-08/D-09 是否真按 79-1 执行取决于 §11 的 `legacy` 措辞是否同批改；⑤ D-35 需新建 helper 后重跑两个文件才能确认无夹具差异。
- **合并去重**：三份子报告之间没有逐字相同的条目；同一旧数据簇（D-01/02/03/04/07/10）与同一 `legacy` 不变式簇（D-08/09）保留为独立行，因为删除动作和覆盖关系不同。

