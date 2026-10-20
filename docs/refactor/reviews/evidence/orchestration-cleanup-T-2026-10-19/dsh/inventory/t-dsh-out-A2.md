# T 轮测试清单：A2（`tests/work-graph`，163 个文件）

只读盘点，不运行测试、构建或类型检查。范围是 `./.dsh-ref/t-area-A2.txt` 的 163 个文件、37,288 行。
依据：`./.dsh-ref/t-common.md`、HANDOFF 决定 79（79-1、79-4）与 85-4、根 `AGENTS.md` 第 3/4/9 条、`docs/MVP-BEHAVIOR.md`。

## 口径

- **stale（过时）**：测的行为已被后来的切片/决定改掉，或只测旧格式/兼容接口（决定 79-1：产品没有真实运行过，代码只读当前格式）。
- **duplicate（重复）**：同一业务场景、同一断言在多处出现；写明两边位置、各断言什么、建议保留哪边。
- **trivial（琐碎）**：小测试的断言已被业务流程测试覆盖；另含无断言的 `it.skip` 占位。
- **handwritten（手写事实）**：测试/夹具直接 `encode*`、`seedCommit`、手写 JSON 或让替身返回编造结果；按 t-common 是 `convert`，不是删除。已写明公开步骤是否存在；无公开步骤的保留为 `keep-note`。
- **tamper（只为篡改）**：只改库内记录 JSON/事件来触发防御校验（AGENTS 第 4 条）。从真实边界解码坏输入不算这一类。
- **规格行**：名字以冻结规格行开头的测试不直接判 `delete`；旧格式或篡改的规格行给 `keep-note`，并写明“与生产分支同批删/需 lead 改规格行”。所以 `keep-note` 的行仍给出估计行数，表示清掉该分支时要改/删多少行。
- **估计行数**：删或改的测试行，不含生产代码和夹具总行数（夹具只在证据里点名）。

## 主要结论

- 23 条重复、约 427 行，集中在三处：SP 提速轮对 S4B 记忆读的 4 条近乎逐字重测；S4A「note-history 对 note-write」的 N-06/N-08；S4C2 纯 `N1–N3` 与真实 N1/N2/N3 对同一 summary/水位/成员的重复断言。
- 16 条手写事实、约 600 行：S3 两个大夹具的 scope/Goal/Plan/Run/Round 直接 raw commit；W1 的 accepted Plan/Run/Lease/Reduction；node-detail 的 executed-files/anomalies 替身；S4C2 goal-triggers 的 fake reader。能走公开步骤的都给了具体 owner 方法。
- 16 条过时、约 347 行：15 条是 79-1 的旧格式/旧兼容面（S2B 无 `since` 的旧轮次与无 locator 的旧 Run、S2C 无 provenance 的旧 Session 与旧 QueryRun、S5 旧 Session 消息/旧 proposal v1/v2、S3 `contextAssembly` 缺省与 `legacy:` 声明、S4B 旧 Plan 版本、WP2 旧 `unavailableSince/responseSince`）；另 1 条是 2C-29 钉的 notes fallback，真实组合 `create-platform.ts:2222` 已不传该缺省。
- 7 条只为篡改、约 182 行：W1 三处改源记录 JSON、S2C-lines-failure 三处 `rewriteRead`、S5 AP12 坏事件、S3 GR14 坏 catalog、WP2 M05 坏位置。非规格行的建议删；规格行的保留给 lead 裁定。
- 没有发现两个分片对同一 `file:line` 报出不同结论；合并时按 `file + lines` 去重，未发现同位置重复条目。

## 发现表

| 编号 | 类别 | 位置 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---|---|
| A2-01 | stale | `tests/work-graph/S2B-activity-calendar-tasks.test.ts:52-79,146-169,171-208`<br>2B-26 filters a cell to one line with sessionRefs and counts Runs whose claiming Session is unknown; 2B-26 sessionRefs skips a foreign-line uncounted Run and counts an unresolvable claiming Session | 本地 seedLegacyRun 直接 commitRaw 一个无 history locator、无 dispatch claim 的旧 RunSnapshot（:52-79），fixture seedLegacyActivity 同样手写（tests/helpers/S2B-activity-fixture.ts:302-330）；只有旧记录才产生 `runsSessionUnknown`/`not_recorded`。当前 Run 由正式入口写 V2 授权与定位（src/core/work-graph/state/run-machine.ts:167 legacyV1 只对旧记录为真）。决定 79-1 后这种形状不存在 | keep-note | 行为已不存在：HANDOFF 79-1（冻结行；与旧 Run 形状及两个 fixture 方法同批删，规格 2B-26 加后注） | 52 | 2B-26 | 高 |
| A2-02 | stale | `tests/work-graph/S2B-activity-calendar.test.ts:215-260`<br>2B-24 attributes begun checks to the round start hour and its task and counts legacy rounds as unplaced | fixture 先用公开 openRound 造轮次，再读回记录删掉 `since` 后用 commitRaw 重写（tests/helpers/S2B-activity-fixture.ts:251-269，注释自称 legacy §7 shape）；生产仍有专用旧轮次读 `s2b-round-by-goal-legacy`（src/core/work-graph/persistence/evidence-record-codecs.ts:746），规格明确只为没有 since 的旧轮次（slice-2B-SPEC.md:292、:367）。决定 79-1：产品未真实运行，旧格式 reader 与夹具同批删 | keep-note | 行为已不存在：HANDOFF 79-1（冻结行；与 `s2b-round-by-goal-legacy` 及 openLegacyRound 同批删，规格 2B L9 加后注） | 46 | 2B-24 | 高 |
| A2-03 | stale | `tests/work-graph/S2B-r2-keyed-cap.test.ts:61-78`<br>R7 readActivityCalendar charges an absent dispatch claim for an unplaced Run | 注释自称 §7 legacy old Run shape（:62-63），seedActivityRun 直接 commitRaw 造无派工记录 ended Run（:66-69）；真实 claim 必有 claim 记录。其余 R7 用例（:21-59）有效。 | keep-note | HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567） | 18 | R7 | 中 |
| A2-04 | stale | `tests/work-graph/S2B-r2-r5-not-entered.test.ts:36-53`<br>2B-r2 R5 a V1 authorization does not prove non-entry | seedRawRunVariant 克隆真 Run 后塞 V1 executionAuthorization（:41-46）；V1 只是 retained compatibility shape（execution-entry-codecs.ts:4-17），当前写者只写 V2（run-machine.ts:869），L7 只列 V2/无授权（slice-2B-SPEC.md:250-259）。同用例在 S2B-r2-never-entered.test.ts:23-37 重复。 | keep-note | HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）；V2-kernel 用例 tests/work-graph/S2B-r2-r5-not-entered.test.ts:70-89 仍有效 | 18 | R5 | 中 |
| A2-05 | stale | `tests/work-graph/S2C-lines-d1.test.ts:37-70`<br>2C-14 (1) the literal D1 counts are working 3, standby 6 and the archived range | D1 数据集里 `l` 是 storage-boundary 手写的无 provenance Session（tests/helpers/S2C-L-line-support.ts:467-481、:711），计数因此断言 `archived` 为 partial、reason '1 legacy Session(s) without provenance'（:45-48）。生产为此保留 `createLegacySessionProvenanceReader`（src/core/work-graph/tasks/session-provenance-facts.ts:95，composition 已接）与 `legacyUnchecked`（src/core/work-graph/state/line-status.ts:86）。决定 79-1 后旧 Session 可重建 | keep-note | 行为不再需要：HANDOFF 79-1（删 D1 的 l、partial reason 与 provenance reader；其余 working/standby 断言保留） | 20 | 2C-14 | 高 |
| A2-06 | stale | `tests/work-graph/S2C-lines-page.test.ts:394-421`<br>2C-18 executions list only the indexed Work claims and QueryRuns on a legacy Session | 手写旧 QueryRunSnapshot（无 executionState）并 commitRaw(encodeQueryRunSnapshotRecord)（:409-414），配 createLegacySession（:397）；旧格式记录按 79-1 不再保留原样，规格 §7 曾作为单独例外（slice-2C-SPEC.md:1405）。 | keep-note | HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）（79-1） | 25 | 2C-18 | 中 |
| A2-07 | stale | `tests/work-graph/S2C-node-detail-executions.test.ts:44-47`<br>2C-29 notes say not_available/slice_4 and a failed Run read keeps its executions item with a problem | 断言 notes 为 'the notes read is not wired'；生产组合 src/composition/create-platform.ts:2222 已传 notes: listNotes，views/node-detail-reader.ts:966 的 fallback 只在测试不传 deps.notes 时走到。 | keep-note | 行为在真实组合中不存在：create-platform.ts:2222 已接 listNotes；tests/work-graph/S4C-node-notes.test.ts | 3 | 2C-29 | 中 |
| A2-08 | stale | `tests/work-graph/S3-context-inputs.test.ts:671-711,759-788,886-906`<br>IN01/IN02/IN09/IN19 legacy declarations | 只覆盖 slice-3 之前 Plan 的 inputRequirements 转换 declarationId='legacy:'+requirementId（slice-3-SPEC.md:234；src/contracts/input-declaration-id.ts:13-15、src/core/work-graph/tasks/context-input-service.ts:808）；产品从未运行，79-1 说旧格式夹具可重建 | keep-note | 行为已不存在：HANDOFF 79-1；slice-3-SPEC.md:234 | 0 | IN01 | 中 |
| A2-09 | stale | `tests/work-graph/S3-prepared-context-admission.test.ts:499-508`<br>AD05 an old manifest without contextAssembly authorizes as before and is not migrated | 只 pin contextAssembly 缺省的旧 manifest（:501-507）；当前代码保留可选空分支 src/contracts/core/prepared-execution.ts:205,271 与 src/core/work-graph/tasks/execution-entry-service.ts:1057；HANDOFF 79-1 要求发布前不兼容旧数据 | keep-note | 行为已不存在：HANDOFF 79-1；slice-3-SPEC.md:231 | 0 | AD05 | 中 |
| A2-10 | stale | `tests/work-graph/S4B-memory-version-lists.test.ts:78-81`<br>M-10 an old plan version without a recorded reason shows the missing label | `it.skip(... () => undefined)`，注释自认经公开服务造不出没有 reason 的旧 Plan 版本，reader 也不可达（:78-80）。旧记录只有 79-1 之前才有；当前 proposePlan 必带 reason（src/core/work-graph/tasks/plan-service.ts:386 的 fingerprint 含 reason 输入） | delete | 行为已不存在：HANDOFF 79-1（空占位、无断言；同文件 M-10 分页用例保留） | 2 | M-10 | 高 |
| A2-11 | stale | `tests/work-graph/S5-notices.test.ts:195-212`<br>NR05 legacy precedes a bound creation position and corrupt null origin is unavailable | requeue(..., true) 造无 since 的旧通知（:197-199）并断 position.kind==='legacy'（:210）；corruptOrigin 改持久 origin 为 null 再断 unavailable（:212-213）。旧排序在 tests/work-graph/S2A-notices-rework.test.ts:37-77 QA-11 更全地测过（跨文件重复）。 | keep-note | HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）；HANDOFF.md:574 | 18 | NR05 | 中 |
| A2-12 | stale | `tests/work-graph/S5-notices.test.ts:271-285`<br>NR08 legacy reverify retains an unknown cap after the current policy cap changes | {legacyRounds:true} 造没有 noticeAutomationCap 的旧 Round（:272-274），断 cap:null、summary 上限未记录（:278-281）；当前写者必写 cap（slice-5-SPEC.md:297）。 | keep-note | HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567） | 15 | NR08 | 中 |
| A2-13 | stale | `tests/work-graph/S5-request-candidates.test.ts:269-290`<br>RC09 an old v2 candidate gains neither optional fields nor a request claim on read | seedCandidateProposal 前删掉 requestRef/notAdopted 再写（:271-275），断读回不补字段、不建 claim（:280-289）；当前写者都写这两个字段。 | keep-note | HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567） | 22 | RC09 | 中 |
| A2-14 | stale | `tests/work-graph/S5-request-candidates.test.ts:305-342`<br>RC11 a legacy v1 proposal remains a read-only candidate without added request fields or claims | 手写 PlanProposalSnapshot v1（:307-323）seedCommit（:324-325），断 kind:'legacy_v1' 只读（:330-332）；legacy v1 是旧格式分支（slice-5-SPEC.md:265、:1085）。 | keep-note | HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567） | 38 | RC11 | 中 |
| A2-15 | stale | `tests/work-graph/S5-user-messages.test.ts:277-346`<br>UM12 a genuinely old absent-field Session message keeps its frozen ack DTO/receipt and origin absence | bodies.put 手写 body（:288-295）、encodeSessionMessageSentEvent + encodeSessionMessageRecord + seedCommit（:296-306），断旧 ack DTO/receipt（:321-337）；真实 sendMessage 只写现格式。 | keep-note | HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567） | 70 | UM12 | 高 |
| A2-16 | stale | `tests/work-graph/WP2-undelivered-notices.test.ts:221-286`<br>M05 old data missing a position blocks only its Goal; a damaged position is refused | The test deletes unavailableSince/responseSince from real records and the DTO to simulate 'Real pre-package records' (226-255) and expects incomplete. Decision 79-1 says the product never ran and code reads only the current format; but wiring-2-SPEC.md:303 (M05) still requires the old-data rule, so this is a spec-row conflict. | keep-note | 行为已不存在：HANDOFF 决定 79-1 (conflicts with wiring-2-SPEC.md:303) | 0 | M05 | 中 |
| A2-17 | duplicate | `tests/work-graph/S2B-r2-s-preentry-control.test.ts:26-49`<br>2B-32 fold order (a): public claim + pause + resume + entry read paused/pending/running | 与 tests/work-graph/S2B-32-task-timeline-fold.test.ts:226-243 同一 fold order (a) 与同一 paused/pending/running 断言，只把写路径换成公开服务；规格 §11 明说两版并存（slice-2B-SPEC.md:961）。 | keep-note | tests/work-graph/S2B-32-task-timeline-fold.test.ts::2B-32 fold order (a) | 24 | 2B-32 | 高 |
| A2-18 | duplicate | `tests/work-graph/S2B-r2-s-yielded.test.ts:34-91`<br>2B-32 yielded and its continuation claim are real and the timeline reads waiting_reply | 与 tests/work-graph/S2B-32-task-timeline-fold.test.ts:54-72 同一 yielded→接续→waiting_reply 规则；§11 明说保留两版（slice-2B-SPEC.md:961）。 | keep-note | tests/work-graph/S2B-32-task-timeline-fold.test.ts::2B-32 yielded | 40 | 2B-32 | 高 |
| A2-19 | duplicate | `tests/work-graph/S2C-lines-attention.test.ts:216-235`<br>2C-12 (9) an INCONCLUSIVE formal check is the block round_inconclusive attention | 同 S2C-lines-tiers.test.ts:155-174 同一 INCONCLUSIVE 夹具与同一 attention.code/reason.code 断言；tiers 多断 bucket==='standby'，attention 多断 own==='standby'。 | merge-into:tests/work-graph/S2C-lines-tiers.test.ts::2C-03 (3) an INCONCLUSIVE formal round puts the line in the blocked tier | tests/work-graph/S2C-lines-tiers.test.ts::2C-03 (3) | 20 | 2C-12 | 高 |
| A2-20 | duplicate | `tests/work-graph/S4A-note-history.test.ts:464-492`<br>N-08 accepting a pending general note on a goal anchor leaves the pointer | 与 S4A-note-write.test.ts:481-523 N-08 同名同断言：接受 pending general note 后 goal anchor pointer 仍指向 U1（history :483-487；write :517-522 另有 pointer null 的 Case A） | merge-into:tests/work-graph/S4A-note-write.test.ts::N-08 accepting a pending general note on a goal anchor leaves the pointer | tests/work-graph/S4A-note-write.test.ts::N-08 | 29 | N-08 | 高 |
| A2-21 | duplicate | `tests/work-graph/S4A-note-history.test.ts:493-513`<br>N-06 accepting a pending replacement supersedes its target in that commit | 与 S4A-note-write.test.ts:699-740 N-10 同场景：pending replacement accept 后旧目标 superseded；N-10 还断言已撤回目标保持 withdrawn 且 version 2（:731-739），是超集 | merge-into:tests/work-graph/S4A-note-write.test.ts::N-10 accepting a pending note supersedes its current replaces targets | tests/work-graph/S4A-note-write.test.ts::N-10 | 21 | N-06 | 高 |
| A2-22 | duplicate | `tests/work-graph/S4B-memory-l12-bounds.test.ts:172-209`<br>L9 own-goal currentEligible | 与 tests/work-graph/S4B-memory-current-filter.test.ts:31-77 M-08 重叠：别的 Goal agent-accepted 不进 find/lookup、用户确认的 currentEligible true；M-08 还断言三层排序、crossGoal、freshness（:60-75） | keep-note | tests/work-graph/S4B-memory-current-filter.test.ts::M-08 | 0 | L9 | 中 |
| A2-23 | duplicate | `tests/work-graph/S4B-memory-not-found.test.ts:17-27`<br>M-16 a missing module anchor with no head is not_found anchor_not_found | 与 tests/work-graph/S4B-memory-anchor-not-found.test.ts:45-62 MF9 同请求 moduleId A2，同 code not_found/reason anchor_not_found；MF9 还断言 4 个候选（:55-60） | merge-into:tests/work-graph/S4B-memory-anchor-not-found.test.ts::MF9 anchor not found | tests/work-graph/S4B-memory-anchor-not-found.test.ts::MF9 | 11 | M-16 | 高 |
| A2-24 | duplicate | `tests/work-graph/S4B-note-anchor-status.test.ts:122-134`<br>M-15 a symbol that no longer resolves retires the note for symbol_missing | 与 tests/work-graph/S4B-note-symbol-recheck.test.ts:73-84 MF4 renamed symbol 完全同场景同断言：改文件为 'export const renamed = 1' 后 anchorStatus retired、reasons 含 symbol_missing | merge-into:tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4 symbol rechecks | tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4 | 13 | M-15 | 高 |
| A2-25 | duplicate | `tests/work-graph/S4B-note-anchor-status.test.ts:152-168`<br>M-15 a target symbol after 20 other symbols still resolves | 与 tests/work-graph/S4B-note-symbol-recheck.test.ts:28-42 MF4 line-inserted 同断言行号移动仍 live（anchorStatus live、reasons []）；M-15 只是加 30 个声明与 stored-range tie-break | merge-into:tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4 symbol rechecks | tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4 | 17 | M-15 | 中 |
| A2-26 | duplicate | `tests/work-graph/S4B-note-freshness.test.ts:54-70`<br>M-05 an unreadable message fact is sourceUnavailable and the note is still returned | 与 tests/work-graph/S4B-note-budget-check.test.ts:127-144 M-14 同场景（缺失 SessionMessage record fact → sourceUnavailable true、currentEligible false），M-14 另走 checkNotes；M-05 只走 listByAnchor | merge-into:tests/work-graph/S4B-note-budget-check.test.ts::M-14 the write-after check resolves facts | tests/work-graph/S4B-note-budget-check.test.ts::M-14 | 17 | M-05 | 中 |
| A2-27 | duplicate | `tests/work-graph/S4C-find-byte-trim.test.ts:87-114`<br>RW-9(iii) a norm trimmed from the shown header stays in coverage and observedFiles | 与 S4C-find-read-bounds.test.ts:87-113 RW-10 同断言族：project.norms 为空、omitted 计数、coverage.checkedItems/filesRead 与 readBasis.observedFiles 仍含被丢弃 norm（trim :110-113；RW-10 :106-112），仅丢弃原因不同 | keep-note | tests/work-graph/S4C-find-read-bounds.test.ts::RW-10 | 0 | RW-9 | 中 |
| A2-28 | duplicate | `tests/work-graph/S4C-note-protection.test.ts:287-311`<br>RW-8 review/reject resolution_not_applicable | 与 S4C-resolution-order.test.ts:79-98 同断言 code invalid、reason resolution_not_applicable；resolution-order 用 readMany seam 证明判定先于目标读取（:33-63、:86），更强 | merge-into:tests/work-graph/S4C-resolution-order.test.ts::RW-8 order | tests/work-graph/S4C-resolution-order.test.ts::RW-8 order | 25 | RW-8 | 高 |
| A2-29 | duplicate | `tests/work-graph/S4C-project-understanding.test.ts:40-62`<br>DS-07 project understanding visibility | 与同文件 :64-105 PU-02 重叠：g2 work Run 的 lookup {kind:project} 都断言见到项目理解（DS-07 :55-59；PU-02 :83-96 还断言 pointer/currentEligible/crossGoal/goalQuota）；DS-07 独有 find 一半（:50-54） | merge-into:tests/work-graph/S4C-project-understanding.test.ts::PU-02 | tests/work-graph/S4C-project-understanding.test.ts::PU-02 | 23 | DS-07 | 中 |
| A2-30 | duplicate | `tests/work-graph/S4C2-D-rows.test.ts:100-120`<br>D-06 %s: replacing the user note is pending, opens the three-option card and supersedes it；D-17 %s supersede: the note replaces the target and the target becomes superseded | D-06 and D-17 use the same user-confirmed note plus pending agent replaces seed and the same resolve('supersede'); D-06:114-119 and S4C2-D17.test.ts:62-70 both assert accepted v2, replaces:[userId], target superseded and card gone. D-06 uniquely checks the three options (110-112); D-17 uniquely the literal card key (60). | merge-into:tests/work-graph/S4C2-D17.test.ts::D-17 %s supersede | tests/work-graph/S4C2-D17.test.ts::D-17 %s supersede | 7 | D-06 | 高 |
| A2-31 | duplicate | `tests/work-graph/S4C2-collection-card-source.test.ts:123-146`<br>U7-b reads item 200 by key with zero collection reads and answers not_found for a missing key | U7-b's fake collection asserts collectionCalls 0, byKeyCalls 1 and not_found (130-138); the real U7 test asserts list 1, by-key 1 and not_found (S4C2-U7.test.ts:129-147). Only the closed-item branch (140-146) is unique. | merge-into:tests/work-graph/S4C2-U7.test.ts::U7 %s: the queue assembles once, a direct read is by key, a missing key is not_found and M1 leaves the g1 card waiting | tests/work-graph/S4C2-U7.test.ts::U7 %s... | 14 | U7 | 中 |
| A2-32 | duplicate | `tests/work-graph/S4C2-notice-grouping.test.ts:52-116`<br>S4C2-N2 keeps own-line notes, folds scribe results per goal and passes other categories through；S4C2-N3 advances to the highest member position when every member at or below it is shown；S4C2-N4 leaves the category absent when an earlier member is not shown；S4C2-N4b falls back to the last displayed position for a category without members | 纯 N2 asserts the same g1 summary '书记整理 · 3 条注记', key note_review_scribe:p1/g1 and three members (65-85) as the real N1 at S4C2-N1.test.ts:74-100; pure N3 asserts seenThrough {note_review:p3} (110-112) as the real N3 at S4C2-N3.test.ts:114-116. Both are N1-N3 spec rows. | keep-note | tests/work-graph/S4C2-N1.test.ts::N1 %s..., tests/work-graph/S4C2-N2.test.ts::N2 %s..., tests/work-graph/S4C2-N3.test.ts::N3 %s... | 0 | S4C2-N2 | 高 |
| A2-33 | duplicate | `tests/work-graph/S5R2-queue-history.test.ts:141-149`<br>R2A08 - exactly 200 Goals remain inside the Workspace queue limit | 与同文件 R2A07（:127-136）同读法同断言，只把 201 换成 200；200 上限已被 2A 取消（slice-2A-SPEC.md:202、:358），标题的 limit 已不成立。 | merge-into:tests/work-graph/S5R2-queue-history.test.ts::R2A07 - an unfiltered Workspace queue over 201 Goals is read, not refused | tests/work-graph/S5R2-queue-history.test.ts::R2A07 | 9 | R2A08 | 高 |
| A2-34 | duplicate | `tests/work-graph/S8A-L8-reminders-public.test.ts:119-166`<br>caps twelve real ungrouped rows at ten plus one omission line (%s)；renders an unknown dependency finding with ，不确定 after one real capture (%s)；renders 还没有观测 when no capture has succeeded (%s)；renders no architecture rows for an observation with nothing to say (%s) | Each asserts the same literal as the pure A-03 test: cap '另有 2 条架构提醒没列出' (public 113 vs pure 160), '，不确定' (130 vs 145), '还没有观测' (144 vs 168), no rows (161 vs 174). The first public test (53-70) already proves the real manifest route; the pure file is the frozen A-03 rule table, so it is not trivial. | keep-note | tests/work-graph/S8A-L8-reminders-pure.test.ts::caps at 10 rows..., unknown dependency..., no successful observation..., nothing to say... | 0 | A-03 | 中 |
| A2-35 | duplicate | `tests/work-graph/SP-memory-history-confirm.test.ts:34-73`<br>SP-13 history confirmation across versions | 与 S4A-note-history.test.ts:215-243 N-11 第三例同规则 confirmedByUser 按第一个 change.by.kind==='user' 的版本向后为真（SP :71 [true,true,false,false]；N-11 :242-243 [false,true,true,true]），SP 覆盖四版更全 | merge-into:tests/work-graph/SP-memory-history-confirm.test.ts::SP-13 | tests/work-graph/SP-memory-history-confirm.test.ts::SP-13 | 29 | SP-13 | 中 |
| A2-36 | duplicate | `tests/work-graph/SP-memory-scoped-find.test.ts:117-141`<br>SP-8 path prefix over main and extra file slots | 与 S4B-memory-find-stale.test.ts:100-124 MF6a 同场景（src/a 前缀、嵌套文件、extra anchor、排除 src/a-b、complete true），SP 另造 src/ab 并加 terms（:123-137） | merge-into:tests/work-graph/S4B-memory-find-stale.test.ts::MF6a | tests/work-graph/S4B-memory-find-stale.test.ts::MF6a | 25 | — | 高 |
| A2-37 | duplicate | `tests/work-graph/SP-memory-scoped-find.test.ts:143-159`<br>SP-9 anchor AND path prefix intersect | 与 S4B-memory-find-stale.test.ts:126-137 MF6b 同断言（anchor 与 pathPrefix 相交为空、items []、next null、complete true），仅 anchor 换成 file src/b/y.ts 并加 terms | merge-into:tests/work-graph/S4B-memory-find-stale.test.ts::MF6b | tests/work-graph/S4B-memory-find-stale.test.ts::MF6b | 17 | — | 高 |
| A2-38 | duplicate | `tests/work-graph/SP-memory-scoped-find.test.ts:29-59`<br>SP-6 T-07 scoring under an anchor with off-anchor noise | 与 S4B-memory-ranking.test.ts:25-47 T-07 同三条注记、同分数 3.9120/2.3026/0.6931、同 matchedTerms/ranking/complete；SP 只多两条 off-anchor 噪声与 anchor 参数（:38-44、:54-56）；SP-* 非冻结行（slice-4-SPEC.md:932） | merge-into:tests/work-graph/S4B-memory-ranking.test.ts::T-07 any ranking | tests/work-graph/S4B-memory-ranking.test.ts::T-07 | 31 | — | 高 |
| A2-39 | duplicate | `tests/work-graph/SP-memory-scoped-find.test.ts:61-115`<br>SP-7 the read-model candidate cap on a scoped any find | 与 S4B-memory-ranking.test.ts:206-257 T-09 两个用例一一对应（cap 2、前两 id、3*ln2、ranking partial、warnings 含锚点、limit-1 翻页），SP 只加 anchor（:73、:98） | merge-into:tests/work-graph/S4B-memory-ranking.test.ts::T-09 partial ranking | tests/work-graph/S4B-memory-ranking.test.ts::T-09 | 55 | — | 高 |
| A2-40 | trivial | `tests/work-graph/S2C-lines-scale.test.ts:146-183`<br>A2 measured on this build (printout, not asserted) | 只 console.log 每线读数和耗时，唯一断言 expect(m).toBeGreaterThan(0)（:183）；预算行为已由 2C-25 (3)/(4)（:100-144）断言。 | delete | tests/work-graph/S2C-lines-scale.test.ts::2C-25 (3)/(4) | 38 | — | 高 |
| A2-41 | trivial | `tests/work-graph/S4B-memory-not-found.test.ts:43-46`<br>M-16 a module that is gone but still has heads returns them as retired | `it.skip(... () => { /* see comment */ })`，无断言；注释自认 `reviseArchitectureCatalog` 拒绝移除模块（src/core/work-graph/tasks/catalog-service.ts:671-673），公开路径永远造不出该状态 | delete | 行为已不存在：模块移除被生产拒绝；同文件 M-16 的 not_found 用例保留 | 4 | M-16 | 高 |
| A2-42 | trivial | `tests/work-graph/S4B-note-anchor-status.test.ts:63-70`<br>M-15 a module removed from the current catalog retires the note | `it.skip(...)` 空体，无断言；注释同样自认 catalog 不能移除模块（catalog-service.ts:671-673），只是留一条不可达缺口 | delete | 行为已不存在：模块移除被生产拒绝；同文件 interface 移除用例（:72 起）保留 | 8 | M-15 | 高 |
| A2-43 | trivial | `tests/work-graph/S4B-note-hints.test.ts:147-151`<br>MF13 a counted RunActivity that lists the deleted path is proof | `it.skip` 空体；注释说可经真 Kernel 运行产生 RunActivity，但夹具没有该入口（:147-150），属可发生但未测的缺口，不是不可达行为 | keep-note | 测试缺口：需要真 Kernel run end 的 RunActivity 夹具；不删 | 0 | MF13 | 中 |
| A2-44 | trivial | `tests/work-graph/S4C2-project-set-shared.test.ts:197-229`<br>item 3 %s: the Goal-card query material reads the project set once (5, not 10) | Same seed, same state.project===5 and same project-row/norm assertions as the work-material test at 160-194; only includeInputs:false differs (198-199). includeInputs:false skipping general is already pinned by S4C2-memory-material.test.ts:338-351. | merge-into:tests/work-graph/S4C2-project-set-shared.test.ts::item 3 %s: the Goal-card work material reads the project set once (5, not 10) | tests/work-graph/S4C2-project-set-shared.test.ts::item 3 %s: the Goal-card work material... | 33 | — | 高 |
| A2-45 | trivial | `tests/work-graph/S8A-path-ownership-dedupe.test.ts:18-28`<br>S8A-06b the canonical decision keeps the 4C-1/8A semantics | 06a (13-16) already proves both entry points are the same function object; 06b re-tests owner/tie/none already covered by S8A-root-path.test.ts:70-115 (S8A-02a/b) and S8A-formal-comparison.test.ts:131-153. | keep-note | tests/work-graph/S8A-root-path.test.ts::S8A-02a/S8A-02b, tests/work-graph/S8A-formal-comparison.test.ts::the root module owns src/loose.ts... | 0 | S8A-06b | 中 |
| A2-46 | trivial | `tests/work-graph/SP-memory-history-confirm.test.ts:75-84`<br>SP-13b a head version >= 5 with a confirmation at version 3 lists every confirmedByUser | `it.skip` 空体；注释说明五次版本在 accept/review/withdraw 转移下不可达（:76-81），fixture 也没有原始版本种子 | delete | 行为已不存在：状态机无可达路径；同文件 SP-13 四版本用例保留 | 10 | SP-13b | 高 |
| A2-47 | handwritten | `tests/work-graph/S2B-34-executed-files.test.ts:32-63`<br>2B-34 a counted Run yields its definite and possible files… / the conflict read exposes the real changed file… | changedFiles 由 countedFacts 手写（:194-201、:218-231），writeActivity 虽走公开 recordRunActivity（S2B-track-fixture.ts:501-507），facts 不由真 Kernel 记录算出；真 Runtime+edit 步骤存在（S2B-be1-platform-fixture、tests/runtime/S2B-tally.test.ts）。 | convert:真 Runtime + edit 工具跑一次 Run，再由 createRunActivityService 写 activity（存在；重） | — | 55 | 2B-34 | 中 |
| A2-48 | handwritten | `tests/work-graph/S2B-r4-session-workspace.test.ts:44-86`<br>2B-r3 R4 a track run bar whose Session is in another workspace is forbidden / a calendar cell Session in another workspace is forbidden | 经 tests/helpers/S2B-r3-r4-support.ts:26-45 读真 Session JSON、改 workspaceId 后 commitRaw；helper :5-8 自认没有公开流程能造跨工作区 Session。无公开步骤；保留为 workspace 绑定边界。 | keep-note | — | 0 | R4 | 中 |
| A2-49 | handwritten | `tests/work-graph/S2C-node-detail-anomalies.test.ts:96-160`<br>2C-28 the task anomaly facts, the goal count and the incomplete count / the goal anomaly count pages the index to the end | scriptedAnomalies（:83-94）用 double 返回编造 SessionAnomalyViewV1；公开步骤 recordSessionAnomaly 经 requestSessionArchive 真写锚点（S2C-lines-task-anchors.test.ts:12-13、:43-47）。 | convert:src/core/work-graph/tasks/session-anomaly-service.ts（recordSessionAnomaly，存在） | — | 40 | 2C-28 | 中 |
| A2-50 | handwritten | `tests/work-graph/S2C-node-detail-hover.test.ts:20-122`<br>2C-30 never-ran terminal, owners vs lines/list, group/module counts and the file mapping / changedByLines maps the writing Runs claiming Sessions | scriptedExecutedFiles 手写 available 文件表（:32-40、:113-116）；changedByLines 的写作 Run 不是真写文件。 | convert:…createGoalExecutedFilesReader（存在） | — | 40 | 2C-30 | 中 |
| A2-51 | handwritten | `tests/work-graph/S2C-node-detail-task.test.ts:20-98`<br>2C-27 planned modules, owners/participants split, same-module risks and the three executed-files answers | scriptedExecutedFiles 手写文件表（:62-70、:108-115）直接给 graph/detail 的 executed-files 端口；公开步骤 createGoalExecutedFilesReader 由真 RunActivity 产出（S2B-34:32-63）。规格 §7 允许此注入（slice-2C-SPEC.md:1403）。 | convert:src/core/work-graph/tasks/goal-executed-files-reader.ts（createGoalExecutedFilesReader，存在；需真 Runtime+edit） | — | 45 | 2C-27 | 中 |
| A2-52 | handwritten | `tests/work-graph/S3-context-inputs.test.ts:311-330,470-502`<br>S3 input fixture scope/run/round/message seed | encodeProjectSnapshot/encodeWorkspaceSnapshot/自写 encodeGovernance 后 backend.records.commit(scopeSeed)（:311-330）；RunSnapshot 手写 JSON 经 commitRaw（:483-490）；encodeVerificationRoundSnapshot/encodeSessionMessageRecord 直接提交（:493-502） | convert:platform.projects/registerWorkspace/completionPolicies.install/architecture.adoptInitialArchitecture + claims.claimTask + 校验轮 finalize owner + 会话消息 owner |  | 60 | — | 高 |
| A2-53 | handwritten | `tests/work-graph/S3-graph-context.test.ts:504-551,580-594,748-760`<br>S3 graph fixture scope/facts/run-end/plan-switch seed | scopeRecords() 手写 Project/Workspace@7/Policy raw commit（:518-525）；factRecords() 手写 Goal/Plan/Session/Round raw commit（:544-551）；runAEnded 直改 RunSnapshot JSON（:586-594）；switchToPlanTwo 直改 GoalSnapshot revision 3（:748-760） | convert:goals.createGoal/plans.propose+applyPlanChange/sessions.admit+record/executions.recordRunResult |  | 80 | — | 高 |
| A2-54 | handwritten | `tests/work-graph/S4C2-U3.test.ts:47-108`<br>rejects a forged proof whose acknowledgementRef names another answer as invalid | Hand-built NoteHead/NoteVersion are encoded with encodeNoteDispositionChangedEvent and committed via backend.records.commit (66-86), then the receipt is passed to readApplicationReceiptFacts (89-93). No public step can produce a forged proof; slice-4-SPEC.md:1110 explicitly keeps this one forged record to test decoder rejection. | keep-note | no public step (slice-4-SPEC.md:1110) | 0 | U3 | 高 |
| A2-55 | handwritten | `tests/work-graph/S4C2-goal-triggers.test.ts:92-198`<br>S4C2-3a: T1 reads a satisfied TaskReduction as task_end#r<revision> at reducedAt；S4C2-3b: a TaskReduction that is not satisfied produces no task_end；S4C2-3c: T2 uses the FIRST terminal source plan acceptedAt when setIn is an older plan；S4C2-3d: T3 makes one rework trigger per requeue; archiveOrigin replaces it with archive；S4C2-3e: plan === null drops T1/T2/T4 but still builds T3；S4C2-3h: a requeue key is only built for ended Runs | fakeRecords returns a canned lookup page (94-110); Run and TaskReduction are hand-written JSON (57-70); only TaskRequeue/Plan use encode* (164-167). The public path exists: real plan adoption at S4C2-update-due.test.ts:41-62 and real startRun -> requeueTask -> memoryLookup at 149-187. | convert:real plan adoption + startRun/requeueTask + platform.notes.memoryLookup | tests/work-graph/S4C2-update-due.test.ts::M-12a/c and M-12d | 110 | — | 中 |
| A2-56 | handwritten | `tests/work-graph/S8A-file-layer.test.ts:89-130`<br>fixture (all A-01/S8A-06/S8A-07/S8A-14/S8A-20/S8A-21 cases) | The fixture directly records encodeProjectSnapshot/encodeWorkspaceSnapshot and a hand-written TrustedArchitectureScopeSeeded event, with a permissive validator for that event (94-111, 122-129). Public owners exist: createProjectBootstrapServices (createProject at src/core/work-graph/configuration/project-bootstrap-service.ts:525, registerWorkspace at :598), used by S8A-L8-observation-state.test.ts:9-11. | convert:createProjectBootstrapServices createProject + registerWorkspace | tests/work-graph/S8A-L8-observation-state.test.ts::fixture (public bootstrap owners) | 40 | — | 中 |
| A2-57 | handwritten | `tests/work-graph/UCR-settle-review.test.ts:60-110,152-163,199-210`<br>fixture setup used by UCR-06/07/08c and L16 D6 settleReview cases | 用 newUnknownCallReview + transitionUnknownCallReview 手拼任意 status（round_claimed/idle），再 encodeUnknownCallReview + UnknownCallReviewChanged 事件 commit（:85-96、:152-163、:199-210），把记录直接交给 settleReview。公开创建只在真 Run 的未知调用收尾/启动核对（src/core/work-graph/state/run-machine.ts:2466、src/core/work-graph/tasks/run-reconcile-service.ts:957）；review 轮次还可走 claimTask 的 round_claimed（src/core/work-graph/tasks/claim-service.ts:1249）。只有 idle 记录没有独立公开步 | convert:真 Run 的未知调用经 run-reconcile 建 review，再 claimTask/review 轮次与 holdReview；idle 若无公开步则单独保留 |  | 50 | — | 中 |
| A2-58 | handwritten | `tests/work-graph/W1-future-plan.test.ts:225-330`<br>W1 fixture: seedAcceptedPlan / seedRun / seedLease / seedReduction | 头注自认读侧夹具直接 seed（:9-13）；encodePlanRevisionSnapshot/encodeGoalSnapshot + backend.records.commit（:240-254、:281、:311-321）。accepted Plan 有公开步骤 proposePlan+applyPlanChange（:346-355 已在用）；TaskReduction 本批无写入口（skeleton §8）。 | convert:createPlanService.proposePlan + applyPlanChange（存在；seedReduction 无公开步骤，保留） | — | 30 | — | 中 |
| A2-59 | handwritten | `tests/work-graph/WP2-context-extensions.test.ts:91-97`<br>anomalyDouble used by F05/F06/F07 and the SUP rows | The stand-in returns a made-up empty SessionPage (93-95). The real owner exists: createSessionAnomalyService listSessionAnomalies at src/core/work-graph/tasks/session-anomaly-service.ts:604. | convert:createSessionAnomalyService listSessionAnomalies | src/core/work-graph/tasks/session-anomaly-service.ts:604 | 10 | — | 中 |
| A2-60 | handwritten | `tests/work-graph/WP2-message-duties.test.ts:82-101`<br>seedRoleMatrix used by M01-M03 | seedCommit writes CoordinationPolicyRevisionSnapshot@1 and ProjectCoordinationPolicyActiveSnapshot@1 directly (94-100). src has only readers (role-memory-service.ts:646-700); there is no public writer for the coordination policy. | keep-note | no public writer (src has readers only) | 0 | M01–M03 | 高 |
| A2-61 | handwritten | `tests/work-graph/material-readers.test.ts:61-84`<br>%s: canonical material records use complete refs and returned values are isolated | 手写四类 snapshot + 自造 FixtureSeeded 事件 commit（:37-58），再调 createMaterialRecordReaders().authority.load；公开步骤 createGoalService/claimTask/Query owner 可产真记录，但跨 project/goal/workspace 同 runId 需两套 scope。 | convert:createGoalService.createGoal / claimTask / QueryRun owner（存在，需新跨 scope 夹具） | — | 15 | — | 中 |
| A2-62 | handwritten | `tests/work-graph/unknown-call-review-list.test.ts:46-77`<br>seed (used by every listReviews case) | newUnknownCallReview+transitionUnknownCallReview 拼任意 status，再 encodeUnknownCallReview + UnknownCallReviewChanged 事件直接 commit（:57-76）；真实创建只在 run-machine.ts:2466 / run-reconcile-service.ts:957，无独立 owner create。 | convert:run-reconcile-service（真 Run 未知调用→reconcile 建 review，再 listReviews；存在但重） | — | 25 | — | 中 |
| A2-63 | tamper | `tests/work-graph/S2C-lines-failure.test.ts:23-38,173-184,186-197,199-215`<br>2C-14 (review item 2) an undecodable open responsible link marks the line B4 / 2C-14/L11 an ended-but-occupied Run rereads once and then reports source_moving / 2C-14/RD-8 a lease held by another Run makes the yielded Run refuse pause and cancel | helper 注释明说 `rewriteRead` 造的是 "states the public services cannot build"（:23）；三处分别把 lookup schema 改成 BogusLink@1（:178）、把已 claim 的 Run JSON 改成 ended+completed（:41-42、:192）、把 TaskLease.holderRunId 改成别的 Run（:212）。这些状态只能靠改存储读取结果（等同改库内容）到达；公开步骤没有等价的损坏入口 | delete | 行为已不存在：AGENTS 第 4 条（只测篡改数据库才能触发的防御校验；failingLookup/failingReadMany 的读失败注入 :66-120 属允许的故障注入，保留） | 57 | — | 中 |
| A2-64 | tamper | `tests/work-graph/S3-graph-context.test.ts:259-280,1103-1109`<br>GR14 a damaged catalog codec is unavailable and never a ready empty graph | corruptRecordReads 在 catalog 精确 refKey 上把记录 JSON 换成坏内容（:259-280），createFixture({corruptCatalog:true}) 后只断 unavailable 与 0 提交（:1103-1109）。只有改库能造成损坏 codec；公开架构入口不会写坏记录。slice-3-SPEC.md:705 的 GR14 行即此 | keep-note | 行为仍存在但规则 4 不允许：AGENTS 4；需 lead 连同 slice-3-SPEC.md:705 的 GR14 行一起裁定 | 30 | GR14 | 中 |
| A2-65 | tamper | `tests/work-graph/S5-decision-application.test.ts:365-380`<br>AP12 a corrupt formal receipt event is unavailable and leaves application null with zero writes | 用 store 包装器把 `eventAt(receipt.cursor)` 的 event.json 改成 `'{'`（:369-375），只为命中 decoder 的 unavailable 防御分支；平台自己的写路径写不出坏 JSON。slice-5-SPEC.md:1115 的 AP12 行就是“eventAt 损坏 decoder”，与 AGENTS 第 4 条冲突 | keep-note | 行为仍存在但规则 4 不允许：AGENTS 4；需 lead 连同 slice-5-SPEC.md:1115 的 AP12 行一起裁定 | 16 | AP12 | 中 |
| A2-66 | tamper | `tests/work-graph/W1-future-plan.test.ts:416-441`<br>scenario 1/2: future-only B edit + prompt edge keep A running and C satisfied after real adoption | 在 readMany 包装器里改 P1 记录的 title/requirementLevel/verification 三个字段，且先断言改完仍 decode（:428-437），只为让 queryTaskGraph 报 unavailable；这些“shape-valid source corruption”组合公开写入不会产生（:417-418 自认） | delete | 行为已不存在：AGENTS 第 4 条（该断言块；场景其余断言保留） | 26 | — | 高 |
| A2-67 | tamper | `tests/work-graph/W1-future-plan.test.ts:622-661`<br>scenario 8: codec rejects broken shapes and graph reads verify the actual basis source | 对 basis source 的 readMany 注入 cross-goal/missing/definition 三种损坏（:622-661），每种都先断言 decode 仍过再断 graph unavailable；公开 plan 服务不会写跨 Goal 或自相矛盾的 basis | delete | 行为已不存在：AGENTS 第 4 条（scenario 8 前半的 codec schema 校验 :600-620 保留） | 40 | — | 高 |
| A2-68 | tamper | `tests/work-graph/W1-future-plan.test.ts:670-680,739-741`<br>scenario 9: a changed or added Task with a Run, TaskLease or TaskReduction is no longer future (zero writes) | corruptLeaseB 把 B 的 TaskLease JSON 换成 `'{}'`（:670-680），只为让 refusedAdoption 命中 `is not decodable`（:740）；其余 Run/Lease/Reduction 场景用真 seed 造状态，保留 | delete | 行为已不存在：AGENTS 第 4 条（仅这一条 undecodable-lease 用例与 helper；其余 refusedAdoption 用例保留） | 13 | — | 高 |
| A2-69 | tamper | `tests/work-graph/WP2-undelivered-notices.test.ts:317-351`<br>M05 a zero or malformed platform cursor is never a stored position: the Session and SessionMessage records refuse it | commitRaw writes hand-built next-revision Session/SessionMessage records with c0000000000/not-a-cursor (333-343) only to reach the schema rejection. AGENTS rule 4 forbids tests for defensive checks that only DB tampering can reach; the M05 row itself says '不改数据库造数据' (wiring-2-SPEC.md:303). | keep-note | no behaviour change; rule 4 disallows, but M05 is a spec row | 0 | M05 | 中 |

## JSON

```json
[
 {
  "id": "A2-01",
  "category": "stale",
  "file": "tests/work-graph/S2B-activity-calendar-tasks.test.ts",
  "lines": "52-79,146-169,171-208",
  "tests": "2B-26 filters a cell to one line with sessionRefs and counts Runs whose claiming Session is unknown; 2B-26 sessionRefs skips a foreign-line uncounted Run and counts an unresolvable claiming Session",
  "evidence": "本地 seedLegacyRun 直接 commitRaw 一个无 history locator、无 dispatch claim 的旧 RunSnapshot（:52-79），fixture seedLegacyActivity 同样手写（tests/helpers/S2B-activity-fixture.ts:302-330）；只有旧记录才产生 `runsSessionUnknown`/`not_recorded`。当前 Run 由正式入口写 V2 授权与定位（src/core/work-graph/state/run-machine.ts:167 legacyV1 只对旧记录为真）。决定 79-1 后这种形状不存在",
  "action": "keep-note",
  "covered_by": "行为已不存在：HANDOFF 79-1（冻结行；与旧 Run 形状及两个 fixture 方法同批删，规格 2B-26 加后注）",
  "est_lines": 52,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-02",
  "category": "stale",
  "file": "tests/work-graph/S2B-activity-calendar.test.ts",
  "lines": "215-260",
  "tests": "2B-24 attributes begun checks to the round start hour and its task and counts legacy rounds as unplaced",
  "evidence": "fixture 先用公开 openRound 造轮次，再读回记录删掉 `since` 后用 commitRaw 重写（tests/helpers/S2B-activity-fixture.ts:251-269，注释自称 legacy §7 shape）；生产仍有专用旧轮次读 `s2b-round-by-goal-legacy`（src/core/work-graph/persistence/evidence-record-codecs.ts:746），规格明确只为没有 since 的旧轮次（slice-2B-SPEC.md:292、:367）。决定 79-1：产品未真实运行，旧格式 reader 与夹具同批删",
  "action": "keep-note",
  "covered_by": "行为已不存在：HANDOFF 79-1（冻结行；与 `s2b-round-by-goal-legacy` 及 openLegacyRound 同批删，规格 2B L9 加后注）",
  "est_lines": 46,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-03",
  "category": "stale",
  "file": "tests/work-graph/S2B-r2-keyed-cap.test.ts",
  "lines": "61-78",
  "tests": "R7 readActivityCalendar charges an absent dispatch claim for an unplaced Run",
  "evidence": "注释自称 §7 legacy old Run shape（:62-63），seedActivityRun 直接 commitRaw 造无派工记录 ended Run（:66-69）；真实 claim 必有 claim 记录。其余 R7 用例（:21-59）有效。",
  "action": "keep-note",
  "covered_by": "HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）",
  "est_lines": 18,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-04",
  "category": "stale",
  "file": "tests/work-graph/S2B-r2-r5-not-entered.test.ts",
  "lines": "36-53",
  "tests": "2B-r2 R5 a V1 authorization does not prove non-entry",
  "evidence": "seedRawRunVariant 克隆真 Run 后塞 V1 executionAuthorization（:41-46）；V1 只是 retained compatibility shape（execution-entry-codecs.ts:4-17），当前写者只写 V2（run-machine.ts:869），L7 只列 V2/无授权（slice-2B-SPEC.md:250-259）。同用例在 S2B-r2-never-entered.test.ts:23-37 重复。",
  "action": "keep-note",
  "covered_by": "HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）；V2-kernel 用例 tests/work-graph/S2B-r2-r5-not-entered.test.ts:70-89 仍有效",
  "est_lines": 18,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-05",
  "category": "stale",
  "file": "tests/work-graph/S2C-lines-d1.test.ts",
  "lines": "37-70",
  "tests": "2C-14 (1) the literal D1 counts are working 3, standby 6 and the archived range",
  "evidence": "D1 数据集里 `l` 是 storage-boundary 手写的无 provenance Session（tests/helpers/S2C-L-line-support.ts:467-481、:711），计数因此断言 `archived` 为 partial、reason '1 legacy Session(s) without provenance'（:45-48）。生产为此保留 `createLegacySessionProvenanceReader`（src/core/work-graph/tasks/session-provenance-facts.ts:95，composition 已接）与 `legacyUnchecked`（src/core/work-graph/state/line-status.ts:86）。决定 79-1 后旧 Session 可重建",
  "action": "keep-note",
  "covered_by": "行为不再需要：HANDOFF 79-1（删 D1 的 l、partial reason 与 provenance reader；其余 working/standby 断言保留）",
  "est_lines": 20,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-06",
  "category": "stale",
  "file": "tests/work-graph/S2C-lines-page.test.ts",
  "lines": "394-421",
  "tests": "2C-18 executions list only the indexed Work claims and QueryRuns on a legacy Session",
  "evidence": "手写旧 QueryRunSnapshot（无 executionState）并 commitRaw(encodeQueryRunSnapshotRecord)（:409-414），配 createLegacySession（:397）；旧格式记录按 79-1 不再保留原样，规格 §7 曾作为单独例外（slice-2C-SPEC.md:1405）。",
  "action": "keep-note",
  "covered_by": "HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）（79-1）",
  "est_lines": 25,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-07",
  "category": "stale",
  "file": "tests/work-graph/S2C-node-detail-executions.test.ts",
  "lines": "44-47",
  "tests": "2C-29 notes say not_available/slice_4 and a failed Run read keeps its executions item with a problem",
  "evidence": "断言 notes 为 'the notes read is not wired'；生产组合 src/composition/create-platform.ts:2222 已传 notes: listNotes，views/node-detail-reader.ts:966 的 fallback 只在测试不传 deps.notes 时走到。",
  "action": "keep-note",
  "covered_by": "行为在真实组合中不存在：create-platform.ts:2222 已接 listNotes；tests/work-graph/S4C-node-notes.test.ts",
  "est_lines": 3,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-08",
  "category": "stale",
  "file": "tests/work-graph/S3-context-inputs.test.ts",
  "lines": "671-711,759-788,886-906",
  "tests": "IN01/IN02/IN09/IN19 legacy declarations",
  "evidence": "只覆盖 slice-3 之前 Plan 的 inputRequirements 转换 declarationId='legacy:'+requirementId（slice-3-SPEC.md:234；src/contracts/input-declaration-id.ts:13-15、src/core/work-graph/tasks/context-input-service.ts:808）；产品从未运行，79-1 说旧格式夹具可重建",
  "action": "keep-note",
  "covered_by": "行为已不存在：HANDOFF 79-1；slice-3-SPEC.md:234",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-09",
  "category": "stale",
  "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
  "lines": "499-508",
  "tests": "AD05 an old manifest without contextAssembly authorizes as before and is not migrated",
  "evidence": "只 pin contextAssembly 缺省的旧 manifest（:501-507）；当前代码保留可选空分支 src/contracts/core/prepared-execution.ts:205,271 与 src/core/work-graph/tasks/execution-entry-service.ts:1057；HANDOFF 79-1 要求发布前不兼容旧数据",
  "action": "keep-note",
  "covered_by": "行为已不存在：HANDOFF 79-1；slice-3-SPEC.md:231",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-10",
  "category": "stale",
  "file": "tests/work-graph/S4B-memory-version-lists.test.ts",
  "lines": "78-81",
  "tests": "M-10 an old plan version without a recorded reason shows the missing label",
  "evidence": "`it.skip(... () => undefined)`，注释自认经公开服务造不出没有 reason 的旧 Plan 版本，reader 也不可达（:78-80）。旧记录只有 79-1 之前才有；当前 proposePlan 必带 reason（src/core/work-graph/tasks/plan-service.ts:386 的 fingerprint 含 reason 输入）",
  "action": "delete",
  "covered_by": "行为已不存在：HANDOFF 79-1（空占位、无断言；同文件 M-10 分页用例保留）",
  "est_lines": 2,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-11",
  "category": "stale",
  "file": "tests/work-graph/S5-notices.test.ts",
  "lines": "195-212",
  "tests": "NR05 legacy precedes a bound creation position and corrupt null origin is unavailable",
  "evidence": "requeue(..., true) 造无 since 的旧通知（:197-199）并断 position.kind==='legacy'（:210）；corruptOrigin 改持久 origin 为 null 再断 unavailable（:212-213）。旧排序在 tests/work-graph/S2A-notices-rework.test.ts:37-77 QA-11 更全地测过（跨文件重复）。",
  "action": "keep-note",
  "covered_by": "HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）；HANDOFF.md:574",
  "est_lines": 18,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-12",
  "category": "stale",
  "file": "tests/work-graph/S5-notices.test.ts",
  "lines": "271-285",
  "tests": "NR08 legacy reverify retains an unknown cap after the current policy cap changes",
  "evidence": "{legacyRounds:true} 造没有 noticeAutomationCap 的旧 Round（:272-274），断 cap:null、summary 上限未记录（:278-281）；当前写者必写 cap（slice-5-SPEC.md:297）。",
  "action": "keep-note",
  "covered_by": "HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）",
  "est_lines": 15,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-13",
  "category": "stale",
  "file": "tests/work-graph/S5-request-candidates.test.ts",
  "lines": "269-290",
  "tests": "RC09 an old v2 candidate gains neither optional fields nor a request claim on read",
  "evidence": "seedCandidateProposal 前删掉 requestRef/notAdopted 再写（:271-275），断读回不补字段、不建 claim（:280-289）；当前写者都写这两个字段。",
  "action": "keep-note",
  "covered_by": "HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）",
  "est_lines": 22,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-14",
  "category": "stale",
  "file": "tests/work-graph/S5-request-candidates.test.ts",
  "lines": "305-342",
  "tests": "RC11 a legacy v1 proposal remains a read-only candidate without added request fields or claims",
  "evidence": "手写 PlanProposalSnapshot v1（:307-323）seedCommit（:324-325），断 kind:'legacy_v1' 只读（:330-332）；legacy v1 是旧格式分支（slice-5-SPEC.md:265、:1085）。",
  "action": "keep-note",
  "covered_by": "HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）",
  "est_lines": 38,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-15",
  "category": "stale",
  "file": "tests/work-graph/S5-user-messages.test.ts",
  "lines": "277-346",
  "tests": "UM12 a genuinely old absent-field Session message keeps its frozen ack DTO/receipt and origin absence",
  "evidence": "bodies.put 手写 body（:288-295）、encodeSessionMessageSentEvent + encodeSessionMessageRecord + seedCommit（:296-306），断旧 ack DTO/receipt（:321-337）；真实 sendMessage 只写现格式。",
  "action": "keep-note",
  "covered_by": "HANDOFF 79-1（docs/refactor/HANDOFF.md:565-567）",
  "est_lines": 70,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-16",
  "category": "stale",
  "file": "tests/work-graph/WP2-undelivered-notices.test.ts",
  "lines": "221-286",
  "tests": "M05 old data missing a position blocks only its Goal; a damaged position is refused",
  "evidence": "The test deletes unavailableSince/responseSince from real records and the DTO to simulate 'Real pre-package records' (226-255) and expects incomplete. Decision 79-1 says the product never ran and code reads only the current format; but wiring-2-SPEC.md:303 (M05) still requires the old-data rule, so this is a spec-row conflict.",
  "action": "keep-note",
  "covered_by": "行为已不存在：HANDOFF 决定 79-1 (conflicts with wiring-2-SPEC.md:303)",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-17",
  "category": "duplicate",
  "file": "tests/work-graph/S2B-r2-s-preentry-control.test.ts",
  "lines": "26-49",
  "tests": "2B-32 fold order (a): public claim + pause + resume + entry read paused/pending/running",
  "evidence": "与 tests/work-graph/S2B-32-task-timeline-fold.test.ts:226-243 同一 fold order (a) 与同一 paused/pending/running 断言，只把写路径换成公开服务；规格 §11 明说两版并存（slice-2B-SPEC.md:961）。",
  "action": "keep-note",
  "covered_by": "tests/work-graph/S2B-32-task-timeline-fold.test.ts::2B-32 fold order (a)",
  "est_lines": 24,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-18",
  "category": "duplicate",
  "file": "tests/work-graph/S2B-r2-s-yielded.test.ts",
  "lines": "34-91",
  "tests": "2B-32 yielded and its continuation claim are real and the timeline reads waiting_reply",
  "evidence": "与 tests/work-graph/S2B-32-task-timeline-fold.test.ts:54-72 同一 yielded→接续→waiting_reply 规则；§11 明说保留两版（slice-2B-SPEC.md:961）。",
  "action": "keep-note",
  "covered_by": "tests/work-graph/S2B-32-task-timeline-fold.test.ts::2B-32 yielded",
  "est_lines": 40,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-19",
  "category": "duplicate",
  "file": "tests/work-graph/S2C-lines-attention.test.ts",
  "lines": "216-235",
  "tests": "2C-12 (9) an INCONCLUSIVE formal check is the block round_inconclusive attention",
  "evidence": "同 S2C-lines-tiers.test.ts:155-174 同一 INCONCLUSIVE 夹具与同一 attention.code/reason.code 断言；tiers 多断 bucket==='standby'，attention 多断 own==='standby'。",
  "action": "merge-into:tests/work-graph/S2C-lines-tiers.test.ts::2C-03 (3) an INCONCLUSIVE formal round puts the line in the blocked tier",
  "covered_by": "tests/work-graph/S2C-lines-tiers.test.ts::2C-03 (3)",
  "est_lines": 20,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-20",
  "category": "duplicate",
  "file": "tests/work-graph/S4A-note-history.test.ts",
  "lines": "464-492",
  "tests": "N-08 accepting a pending general note on a goal anchor leaves the pointer",
  "evidence": "与 S4A-note-write.test.ts:481-523 N-08 同名同断言：接受 pending general note 后 goal anchor pointer 仍指向 U1（history :483-487；write :517-522 另有 pointer null 的 Case A）",
  "action": "merge-into:tests/work-graph/S4A-note-write.test.ts::N-08 accepting a pending general note on a goal anchor leaves the pointer",
  "covered_by": "tests/work-graph/S4A-note-write.test.ts::N-08",
  "est_lines": 29,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-21",
  "category": "duplicate",
  "file": "tests/work-graph/S4A-note-history.test.ts",
  "lines": "493-513",
  "tests": "N-06 accepting a pending replacement supersedes its target in that commit",
  "evidence": "与 S4A-note-write.test.ts:699-740 N-10 同场景：pending replacement accept 后旧目标 superseded；N-10 还断言已撤回目标保持 withdrawn 且 version 2（:731-739），是超集",
  "action": "merge-into:tests/work-graph/S4A-note-write.test.ts::N-10 accepting a pending note supersedes its current replaces targets",
  "covered_by": "tests/work-graph/S4A-note-write.test.ts::N-10",
  "est_lines": 21,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-22",
  "category": "duplicate",
  "file": "tests/work-graph/S4B-memory-l12-bounds.test.ts",
  "lines": "172-209",
  "tests": "L9 own-goal currentEligible",
  "evidence": "与 tests/work-graph/S4B-memory-current-filter.test.ts:31-77 M-08 重叠：别的 Goal agent-accepted 不进 find/lookup、用户确认的 currentEligible true；M-08 还断言三层排序、crossGoal、freshness（:60-75）",
  "action": "keep-note",
  "covered_by": "tests/work-graph/S4B-memory-current-filter.test.ts::M-08",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-23",
  "category": "duplicate",
  "file": "tests/work-graph/S4B-memory-not-found.test.ts",
  "lines": "17-27",
  "tests": "M-16 a missing module anchor with no head is not_found anchor_not_found",
  "evidence": "与 tests/work-graph/S4B-memory-anchor-not-found.test.ts:45-62 MF9 同请求 moduleId A2，同 code not_found/reason anchor_not_found；MF9 还断言 4 个候选（:55-60）",
  "action": "merge-into:tests/work-graph/S4B-memory-anchor-not-found.test.ts::MF9 anchor not found",
  "covered_by": "tests/work-graph/S4B-memory-anchor-not-found.test.ts::MF9",
  "est_lines": 11,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-24",
  "category": "duplicate",
  "file": "tests/work-graph/S4B-note-anchor-status.test.ts",
  "lines": "122-134",
  "tests": "M-15 a symbol that no longer resolves retires the note for symbol_missing",
  "evidence": "与 tests/work-graph/S4B-note-symbol-recheck.test.ts:73-84 MF4 renamed symbol 完全同场景同断言：改文件为 'export const renamed = 1' 后 anchorStatus retired、reasons 含 symbol_missing",
  "action": "merge-into:tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4 symbol rechecks",
  "covered_by": "tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4",
  "est_lines": 13,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-25",
  "category": "duplicate",
  "file": "tests/work-graph/S4B-note-anchor-status.test.ts",
  "lines": "152-168",
  "tests": "M-15 a target symbol after 20 other symbols still resolves",
  "evidence": "与 tests/work-graph/S4B-note-symbol-recheck.test.ts:28-42 MF4 line-inserted 同断言行号移动仍 live（anchorStatus live、reasons []）；M-15 只是加 30 个声明与 stored-range tie-break",
  "action": "merge-into:tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4 symbol rechecks",
  "covered_by": "tests/work-graph/S4B-note-symbol-recheck.test.ts::MF4",
  "est_lines": 17,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-26",
  "category": "duplicate",
  "file": "tests/work-graph/S4B-note-freshness.test.ts",
  "lines": "54-70",
  "tests": "M-05 an unreadable message fact is sourceUnavailable and the note is still returned",
  "evidence": "与 tests/work-graph/S4B-note-budget-check.test.ts:127-144 M-14 同场景（缺失 SessionMessage record fact → sourceUnavailable true、currentEligible false），M-14 另走 checkNotes；M-05 只走 listByAnchor",
  "action": "merge-into:tests/work-graph/S4B-note-budget-check.test.ts::M-14 the write-after check resolves facts",
  "covered_by": "tests/work-graph/S4B-note-budget-check.test.ts::M-14",
  "est_lines": 17,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-27",
  "category": "duplicate",
  "file": "tests/work-graph/S4C-find-byte-trim.test.ts",
  "lines": "87-114",
  "tests": "RW-9(iii) a norm trimmed from the shown header stays in coverage and observedFiles",
  "evidence": "与 S4C-find-read-bounds.test.ts:87-113 RW-10 同断言族：project.norms 为空、omitted 计数、coverage.checkedItems/filesRead 与 readBasis.observedFiles 仍含被丢弃 norm（trim :110-113；RW-10 :106-112），仅丢弃原因不同",
  "action": "keep-note",
  "covered_by": "tests/work-graph/S4C-find-read-bounds.test.ts::RW-10",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-28",
  "category": "duplicate",
  "file": "tests/work-graph/S4C-note-protection.test.ts",
  "lines": "287-311",
  "tests": "RW-8 review/reject resolution_not_applicable",
  "evidence": "与 S4C-resolution-order.test.ts:79-98 同断言 code invalid、reason resolution_not_applicable；resolution-order 用 readMany seam 证明判定先于目标读取（:33-63、:86），更强",
  "action": "merge-into:tests/work-graph/S4C-resolution-order.test.ts::RW-8 order",
  "covered_by": "tests/work-graph/S4C-resolution-order.test.ts::RW-8 order",
  "est_lines": 25,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-29",
  "category": "duplicate",
  "file": "tests/work-graph/S4C-project-understanding.test.ts",
  "lines": "40-62",
  "tests": "DS-07 project understanding visibility",
  "evidence": "与同文件 :64-105 PU-02 重叠：g2 work Run 的 lookup {kind:project} 都断言见到项目理解（DS-07 :55-59；PU-02 :83-96 还断言 pointer/currentEligible/crossGoal/goalQuota）；DS-07 独有 find 一半（:50-54）",
  "action": "merge-into:tests/work-graph/S4C-project-understanding.test.ts::PU-02",
  "covered_by": "tests/work-graph/S4C-project-understanding.test.ts::PU-02",
  "est_lines": 23,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-30",
  "category": "duplicate",
  "file": "tests/work-graph/S4C2-D-rows.test.ts",
  "lines": "100-120",
  "tests": "D-06 %s: replacing the user note is pending, opens the three-option card and supersedes it；D-17 %s supersede: the note replaces the target and the target becomes superseded",
  "evidence": "D-06 and D-17 use the same user-confirmed note plus pending agent replaces seed and the same resolve('supersede'); D-06:114-119 and S4C2-D17.test.ts:62-70 both assert accepted v2, replaces:[userId], target superseded and card gone. D-06 uniquely checks the three options (110-112); D-17 uniquely the literal card key (60).",
  "action": "merge-into:tests/work-graph/S4C2-D17.test.ts::D-17 %s supersede",
  "covered_by": "tests/work-graph/S4C2-D17.test.ts::D-17 %s supersede",
  "est_lines": 7,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-31",
  "category": "duplicate",
  "file": "tests/work-graph/S4C2-collection-card-source.test.ts",
  "lines": "123-146",
  "tests": "U7-b reads item 200 by key with zero collection reads and answers not_found for a missing key",
  "evidence": "U7-b's fake collection asserts collectionCalls 0, byKeyCalls 1 and not_found (130-138); the real U7 test asserts list 1, by-key 1 and not_found (S4C2-U7.test.ts:129-147). Only the closed-item branch (140-146) is unique.",
  "action": "merge-into:tests/work-graph/S4C2-U7.test.ts::U7 %s: the queue assembles once, a direct read is by key, a missing key is not_found and M1 leaves the g1 card waiting",
  "covered_by": "tests/work-graph/S4C2-U7.test.ts::U7 %s...",
  "est_lines": 14,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-32",
  "category": "duplicate",
  "file": "tests/work-graph/S4C2-notice-grouping.test.ts",
  "lines": "52-116",
  "tests": "S4C2-N2 keeps own-line notes, folds scribe results per goal and passes other categories through；S4C2-N3 advances to the highest member position when every member at or below it is shown；S4C2-N4 leaves the category absent when an earlier member is not shown；S4C2-N4b falls back to the last displayed position for a category without members",
  "evidence": "纯 N2 asserts the same g1 summary '书记整理 · 3 条注记', key note_review_scribe:p1/g1 and three members (65-85) as the real N1 at S4C2-N1.test.ts:74-100; pure N3 asserts seenThrough {note_review:p3} (110-112) as the real N3 at S4C2-N3.test.ts:114-116. Both are N1-N3 spec rows.",
  "action": "keep-note",
  "covered_by": "tests/work-graph/S4C2-N1.test.ts::N1 %s..., tests/work-graph/S4C2-N2.test.ts::N2 %s..., tests/work-graph/S4C2-N3.test.ts::N3 %s...",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-33",
  "category": "duplicate",
  "file": "tests/work-graph/S5R2-queue-history.test.ts",
  "lines": "141-149",
  "tests": "R2A08 - exactly 200 Goals remain inside the Workspace queue limit",
  "evidence": "与同文件 R2A07（:127-136）同读法同断言，只把 201 换成 200；200 上限已被 2A 取消（slice-2A-SPEC.md:202、:358），标题的 limit 已不成立。",
  "action": "merge-into:tests/work-graph/S5R2-queue-history.test.ts::R2A07 - an unfiltered Workspace queue over 201 Goals is read, not refused",
  "covered_by": "tests/work-graph/S5R2-queue-history.test.ts::R2A07",
  "est_lines": 9,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-34",
  "category": "duplicate",
  "file": "tests/work-graph/S8A-L8-reminders-public.test.ts",
  "lines": "119-166",
  "tests": "caps twelve real ungrouped rows at ten plus one omission line (%s)；renders an unknown dependency finding with ，不确定 after one real capture (%s)；renders 还没有观测 when no capture has succeeded (%s)；renders no architecture rows for an observation with nothing to say (%s)",
  "evidence": "Each asserts the same literal as the pure A-03 test: cap '另有 2 条架构提醒没列出' (public 113 vs pure 160), '，不确定' (130 vs 145), '还没有观测' (144 vs 168), no rows (161 vs 174). The first public test (53-70) already proves the real manifest route; the pure file is the frozen A-03 rule table, so it is not trivial.",
  "action": "keep-note",
  "covered_by": "tests/work-graph/S8A-L8-reminders-pure.test.ts::caps at 10 rows..., unknown dependency..., no successful observation..., nothing to say...",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-35",
  "category": "duplicate",
  "file": "tests/work-graph/SP-memory-history-confirm.test.ts",
  "lines": "34-73",
  "tests": "SP-13 history confirmation across versions",
  "evidence": "与 S4A-note-history.test.ts:215-243 N-11 第三例同规则 confirmedByUser 按第一个 change.by.kind==='user' 的版本向后为真（SP :71 [true,true,false,false]；N-11 :242-243 [false,true,true,true]），SP 覆盖四版更全",
  "action": "merge-into:tests/work-graph/SP-memory-history-confirm.test.ts::SP-13",
  "covered_by": "tests/work-graph/SP-memory-history-confirm.test.ts::SP-13",
  "est_lines": 29,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-36",
  "category": "duplicate",
  "file": "tests/work-graph/SP-memory-scoped-find.test.ts",
  "lines": "117-141",
  "tests": "SP-8 path prefix over main and extra file slots",
  "evidence": "与 S4B-memory-find-stale.test.ts:100-124 MF6a 同场景（src/a 前缀、嵌套文件、extra anchor、排除 src/a-b、complete true），SP 另造 src/ab 并加 terms（:123-137）",
  "action": "merge-into:tests/work-graph/S4B-memory-find-stale.test.ts::MF6a",
  "covered_by": "tests/work-graph/S4B-memory-find-stale.test.ts::MF6a",
  "est_lines": 25,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-37",
  "category": "duplicate",
  "file": "tests/work-graph/SP-memory-scoped-find.test.ts",
  "lines": "143-159",
  "tests": "SP-9 anchor AND path prefix intersect",
  "evidence": "与 S4B-memory-find-stale.test.ts:126-137 MF6b 同断言（anchor 与 pathPrefix 相交为空、items []、next null、complete true），仅 anchor 换成 file src/b/y.ts 并加 terms",
  "action": "merge-into:tests/work-graph/S4B-memory-find-stale.test.ts::MF6b",
  "covered_by": "tests/work-graph/S4B-memory-find-stale.test.ts::MF6b",
  "est_lines": 17,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-38",
  "category": "duplicate",
  "file": "tests/work-graph/SP-memory-scoped-find.test.ts",
  "lines": "29-59",
  "tests": "SP-6 T-07 scoring under an anchor with off-anchor noise",
  "evidence": "与 S4B-memory-ranking.test.ts:25-47 T-07 同三条注记、同分数 3.9120/2.3026/0.6931、同 matchedTerms/ranking/complete；SP 只多两条 off-anchor 噪声与 anchor 参数（:38-44、:54-56）；SP-* 非冻结行（slice-4-SPEC.md:932）",
  "action": "merge-into:tests/work-graph/S4B-memory-ranking.test.ts::T-07 any ranking",
  "covered_by": "tests/work-graph/S4B-memory-ranking.test.ts::T-07",
  "est_lines": 31,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-39",
  "category": "duplicate",
  "file": "tests/work-graph/SP-memory-scoped-find.test.ts",
  "lines": "61-115",
  "tests": "SP-7 the read-model candidate cap on a scoped any find",
  "evidence": "与 S4B-memory-ranking.test.ts:206-257 T-09 两个用例一一对应（cap 2、前两 id、3*ln2、ranking partial、warnings 含锚点、limit-1 翻页），SP 只加 anchor（:73、:98）",
  "action": "merge-into:tests/work-graph/S4B-memory-ranking.test.ts::T-09 partial ranking",
  "covered_by": "tests/work-graph/S4B-memory-ranking.test.ts::T-09",
  "est_lines": 55,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-40",
  "category": "trivial",
  "file": "tests/work-graph/S2C-lines-scale.test.ts",
  "lines": "146-183",
  "tests": "A2 measured on this build (printout, not asserted)",
  "evidence": "只 console.log 每线读数和耗时，唯一断言 expect(m).toBeGreaterThan(0)（:183）；预算行为已由 2C-25 (3)/(4)（:100-144）断言。",
  "action": "delete",
  "covered_by": "tests/work-graph/S2C-lines-scale.test.ts::2C-25 (3)/(4)",
  "est_lines": 38,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-41",
  "category": "trivial",
  "file": "tests/work-graph/S4B-memory-not-found.test.ts",
  "lines": "43-46",
  "tests": "M-16 a module that is gone but still has heads returns them as retired",
  "evidence": "`it.skip(... () => { /* see comment */ })`，无断言；注释自认 `reviseArchitectureCatalog` 拒绝移除模块（src/core/work-graph/tasks/catalog-service.ts:671-673），公开路径永远造不出该状态",
  "action": "delete",
  "covered_by": "行为已不存在：模块移除被生产拒绝；同文件 M-16 的 not_found 用例保留",
  "est_lines": 4,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-42",
  "category": "trivial",
  "file": "tests/work-graph/S4B-note-anchor-status.test.ts",
  "lines": "63-70",
  "tests": "M-15 a module removed from the current catalog retires the note",
  "evidence": "`it.skip(...)` 空体，无断言；注释同样自认 catalog 不能移除模块（catalog-service.ts:671-673），只是留一条不可达缺口",
  "action": "delete",
  "covered_by": "行为已不存在：模块移除被生产拒绝；同文件 interface 移除用例（:72 起）保留",
  "est_lines": 8,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-43",
  "category": "trivial",
  "file": "tests/work-graph/S4B-note-hints.test.ts",
  "lines": "147-151",
  "tests": "MF13 a counted RunActivity that lists the deleted path is proof",
  "evidence": "`it.skip` 空体；注释说可经真 Kernel 运行产生 RunActivity，但夹具没有该入口（:147-150），属可发生但未测的缺口，不是不可达行为",
  "action": "keep-note",
  "covered_by": "测试缺口：需要真 Kernel run end 的 RunActivity 夹具；不删",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-44",
  "category": "trivial",
  "file": "tests/work-graph/S4C2-project-set-shared.test.ts",
  "lines": "197-229",
  "tests": "item 3 %s: the Goal-card query material reads the project set once (5, not 10)",
  "evidence": "Same seed, same state.project===5 and same project-row/norm assertions as the work-material test at 160-194; only includeInputs:false differs (198-199). includeInputs:false skipping general is already pinned by S4C2-memory-material.test.ts:338-351.",
  "action": "merge-into:tests/work-graph/S4C2-project-set-shared.test.ts::item 3 %s: the Goal-card work material reads the project set once (5, not 10)",
  "covered_by": "tests/work-graph/S4C2-project-set-shared.test.ts::item 3 %s: the Goal-card work material...",
  "est_lines": 33,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-45",
  "category": "trivial",
  "file": "tests/work-graph/S8A-path-ownership-dedupe.test.ts",
  "lines": "18-28",
  "tests": "S8A-06b the canonical decision keeps the 4C-1/8A semantics",
  "evidence": "06a (13-16) already proves both entry points are the same function object; 06b re-tests owner/tie/none already covered by S8A-root-path.test.ts:70-115 (S8A-02a/b) and S8A-formal-comparison.test.ts:131-153.",
  "action": "keep-note",
  "covered_by": "tests/work-graph/S8A-root-path.test.ts::S8A-02a/S8A-02b, tests/work-graph/S8A-formal-comparison.test.ts::the root module owns src/loose.ts...",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-46",
  "category": "trivial",
  "file": "tests/work-graph/SP-memory-history-confirm.test.ts",
  "lines": "75-84",
  "tests": "SP-13b a head version >= 5 with a confirmation at version 3 lists every confirmedByUser",
  "evidence": "`it.skip` 空体；注释说明五次版本在 accept/review/withdraw 转移下不可达（:76-81），fixture 也没有原始版本种子",
  "action": "delete",
  "covered_by": "行为已不存在：状态机无可达路径；同文件 SP-13 四版本用例保留",
  "est_lines": 10,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-47",
  "category": "handwritten",
  "file": "tests/work-graph/S2B-34-executed-files.test.ts",
  "lines": "32-63",
  "tests": "2B-34 a counted Run yields its definite and possible files… / the conflict read exposes the real changed file…",
  "evidence": "changedFiles 由 countedFacts 手写（:194-201、:218-231），writeActivity 虽走公开 recordRunActivity（S2B-track-fixture.ts:501-507），facts 不由真 Kernel 记录算出；真 Runtime+edit 步骤存在（S2B-be1-platform-fixture、tests/runtime/S2B-tally.test.ts）。",
  "action": "convert:真 Runtime + edit 工具跑一次 Run，再由 createRunActivityService 写 activity（存在；重）",
  "covered_by": "—",
  "est_lines": 55,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-48",
  "category": "handwritten",
  "file": "tests/work-graph/S2B-r4-session-workspace.test.ts",
  "lines": "44-86",
  "tests": "2B-r3 R4 a track run bar whose Session is in another workspace is forbidden / a calendar cell Session in another workspace is forbidden",
  "evidence": "经 tests/helpers/S2B-r3-r4-support.ts:26-45 读真 Session JSON、改 workspaceId 后 commitRaw；helper :5-8 自认没有公开流程能造跨工作区 Session。无公开步骤；保留为 workspace 绑定边界。",
  "action": "keep-note",
  "covered_by": "—",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-49",
  "category": "handwritten",
  "file": "tests/work-graph/S2C-node-detail-anomalies.test.ts",
  "lines": "96-160",
  "tests": "2C-28 the task anomaly facts, the goal count and the incomplete count / the goal anomaly count pages the index to the end",
  "evidence": "scriptedAnomalies（:83-94）用 double 返回编造 SessionAnomalyViewV1；公开步骤 recordSessionAnomaly 经 requestSessionArchive 真写锚点（S2C-lines-task-anchors.test.ts:12-13、:43-47）。",
  "action": "convert:src/core/work-graph/tasks/session-anomaly-service.ts（recordSessionAnomaly，存在）",
  "covered_by": "—",
  "est_lines": 40,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-50",
  "category": "handwritten",
  "file": "tests/work-graph/S2C-node-detail-hover.test.ts",
  "lines": "20-122",
  "tests": "2C-30 never-ran terminal, owners vs lines/list, group/module counts and the file mapping / changedByLines maps the writing Runs claiming Sessions",
  "evidence": "scriptedExecutedFiles 手写 available 文件表（:32-40、:113-116）；changedByLines 的写作 Run 不是真写文件。",
  "action": "convert:…createGoalExecutedFilesReader（存在）",
  "covered_by": "—",
  "est_lines": 40,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-51",
  "category": "handwritten",
  "file": "tests/work-graph/S2C-node-detail-task.test.ts",
  "lines": "20-98",
  "tests": "2C-27 planned modules, owners/participants split, same-module risks and the three executed-files answers",
  "evidence": "scriptedExecutedFiles 手写文件表（:62-70、:108-115）直接给 graph/detail 的 executed-files 端口；公开步骤 createGoalExecutedFilesReader 由真 RunActivity 产出（S2B-34:32-63）。规格 §7 允许此注入（slice-2C-SPEC.md:1403）。",
  "action": "convert:src/core/work-graph/tasks/goal-executed-files-reader.ts（createGoalExecutedFilesReader，存在；需真 Runtime+edit）",
  "covered_by": "—",
  "est_lines": 45,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-52",
  "category": "handwritten",
  "file": "tests/work-graph/S3-context-inputs.test.ts",
  "lines": "311-330,470-502",
  "tests": "S3 input fixture scope/run/round/message seed",
  "evidence": "encodeProjectSnapshot/encodeWorkspaceSnapshot/自写 encodeGovernance 后 backend.records.commit(scopeSeed)（:311-330）；RunSnapshot 手写 JSON 经 commitRaw（:483-490）；encodeVerificationRoundSnapshot/encodeSessionMessageRecord 直接提交（:493-502）",
  "action": "convert:platform.projects/registerWorkspace/completionPolicies.install/architecture.adoptInitialArchitecture + claims.claimTask + 校验轮 finalize owner + 会话消息 owner",
  "covered_by": "",
  "est_lines": 60,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-53",
  "category": "handwritten",
  "file": "tests/work-graph/S3-graph-context.test.ts",
  "lines": "504-551,580-594,748-760",
  "tests": "S3 graph fixture scope/facts/run-end/plan-switch seed",
  "evidence": "scopeRecords() 手写 Project/Workspace@7/Policy raw commit（:518-525）；factRecords() 手写 Goal/Plan/Session/Round raw commit（:544-551）；runAEnded 直改 RunSnapshot JSON（:586-594）；switchToPlanTwo 直改 GoalSnapshot revision 3（:748-760）",
  "action": "convert:goals.createGoal/plans.propose+applyPlanChange/sessions.admit+record/executions.recordRunResult",
  "covered_by": "",
  "est_lines": 80,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-54",
  "category": "handwritten",
  "file": "tests/work-graph/S4C2-U3.test.ts",
  "lines": "47-108",
  "tests": "rejects a forged proof whose acknowledgementRef names another answer as invalid",
  "evidence": "Hand-built NoteHead/NoteVersion are encoded with encodeNoteDispositionChangedEvent and committed via backend.records.commit (66-86), then the receipt is passed to readApplicationReceiptFacts (89-93). No public step can produce a forged proof; slice-4-SPEC.md:1110 explicitly keeps this one forged record to test decoder rejection.",
  "action": "keep-note",
  "covered_by": "no public step (slice-4-SPEC.md:1110)",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-55",
  "category": "handwritten",
  "file": "tests/work-graph/S4C2-goal-triggers.test.ts",
  "lines": "92-198",
  "tests": "S4C2-3a: T1 reads a satisfied TaskReduction as task_end#r<revision> at reducedAt；S4C2-3b: a TaskReduction that is not satisfied produces no task_end；S4C2-3c: T2 uses the FIRST terminal source plan acceptedAt when setIn is an older plan；S4C2-3d: T3 makes one rework trigger per requeue; archiveOrigin replaces it with archive；S4C2-3e: plan === null drops T1/T2/T4 but still builds T3；S4C2-3h: a requeue key is only built for ended Runs",
  "evidence": "fakeRecords returns a canned lookup page (94-110); Run and TaskReduction are hand-written JSON (57-70); only TaskRequeue/Plan use encode* (164-167). The public path exists: real plan adoption at S4C2-update-due.test.ts:41-62 and real startRun -> requeueTask -> memoryLookup at 149-187.",
  "action": "convert:real plan adoption + startRun/requeueTask + platform.notes.memoryLookup",
  "covered_by": "tests/work-graph/S4C2-update-due.test.ts::M-12a/c and M-12d",
  "est_lines": 110,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "A2-56",
  "category": "handwritten",
  "file": "tests/work-graph/S8A-file-layer.test.ts",
  "lines": "89-130",
  "tests": "fixture (all A-01/S8A-06/S8A-07/S8A-14/S8A-20/S8A-21 cases)",
  "evidence": "The fixture directly records encodeProjectSnapshot/encodeWorkspaceSnapshot and a hand-written TrustedArchitectureScopeSeeded event, with a permissive validator for that event (94-111, 122-129). Public owners exist: createProjectBootstrapServices (createProject at src/core/work-graph/configuration/project-bootstrap-service.ts:525, registerWorkspace at :598), used by S8A-L8-observation-state.test.ts:9-11.",
  "action": "convert:createProjectBootstrapServices createProject + registerWorkspace",
  "covered_by": "tests/work-graph/S8A-L8-observation-state.test.ts::fixture (public bootstrap owners)",
  "est_lines": 40,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "A2-57",
  "category": "handwritten",
  "file": "tests/work-graph/UCR-settle-review.test.ts",
  "lines": "60-110,152-163,199-210",
  "tests": "fixture setup used by UCR-06/07/08c and L16 D6 settleReview cases",
  "evidence": "用 newUnknownCallReview + transitionUnknownCallReview 手拼任意 status（round_claimed/idle），再 encodeUnknownCallReview + UnknownCallReviewChanged 事件 commit（:85-96、:152-163、:199-210），把记录直接交给 settleReview。公开创建只在真 Run 的未知调用收尾/启动核对（src/core/work-graph/state/run-machine.ts:2466、src/core/work-graph/tasks/run-reconcile-service.ts:957）；review 轮次还可走 claimTask 的 round_claimed（src/core/work-graph/tasks/claim-service.ts:1249）。只有 idle 记录没有独立公开步",
  "action": "convert:真 Run 的未知调用经 run-reconcile 建 review，再 claimTask/review 轮次与 holdReview；idle 若无公开步则单独保留",
  "covered_by": "",
  "est_lines": 50,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "A2-58",
  "category": "handwritten",
  "file": "tests/work-graph/W1-future-plan.test.ts",
  "lines": "225-330",
  "tests": "W1 fixture: seedAcceptedPlan / seedRun / seedLease / seedReduction",
  "evidence": "头注自认读侧夹具直接 seed（:9-13）；encodePlanRevisionSnapshot/encodeGoalSnapshot + backend.records.commit（:240-254、:281、:311-321）。accepted Plan 有公开步骤 proposePlan+applyPlanChange（:346-355 已在用）；TaskReduction 本批无写入口（skeleton §8）。",
  "action": "convert:createPlanService.proposePlan + applyPlanChange（存在；seedReduction 无公开步骤，保留）",
  "covered_by": "—",
  "est_lines": 30,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "A2-59",
  "category": "handwritten",
  "file": "tests/work-graph/WP2-context-extensions.test.ts",
  "lines": "91-97",
  "tests": "anomalyDouble used by F05/F06/F07 and the SUP rows",
  "evidence": "The stand-in returns a made-up empty SessionPage (93-95). The real owner exists: createSessionAnomalyService listSessionAnomalies at src/core/work-graph/tasks/session-anomaly-service.ts:604.",
  "action": "convert:createSessionAnomalyService listSessionAnomalies",
  "covered_by": "src/core/work-graph/tasks/session-anomaly-service.ts:604",
  "est_lines": 10,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "A2-60",
  "category": "handwritten",
  "file": "tests/work-graph/WP2-message-duties.test.ts",
  "lines": "82-101",
  "tests": "seedRoleMatrix used by M01-M03",
  "evidence": "seedCommit writes CoordinationPolicyRevisionSnapshot@1 and ProjectCoordinationPolicyActiveSnapshot@1 directly (94-100). src has only readers (role-memory-service.ts:646-700); there is no public writer for the coordination policy.",
  "action": "keep-note",
  "covered_by": "no public writer (src has readers only)",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "高"
 },
 {
  "id": "A2-61",
  "category": "handwritten",
  "file": "tests/work-graph/material-readers.test.ts",
  "lines": "61-84",
  "tests": "%s: canonical material records use complete refs and returned values are isolated",
  "evidence": "手写四类 snapshot + 自造 FixtureSeeded 事件 commit（:37-58），再调 createMaterialRecordReaders().authority.load；公开步骤 createGoalService/claimTask/Query owner 可产真记录，但跨 project/goal/workspace 同 runId 需两套 scope。",
  "action": "convert:createGoalService.createGoal / claimTask / QueryRun owner（存在，需新跨 scope 夹具）",
  "covered_by": "—",
  "est_lines": 15,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "A2-62",
  "category": "handwritten",
  "file": "tests/work-graph/unknown-call-review-list.test.ts",
  "lines": "46-77",
  "tests": "seed (used by every listReviews case)",
  "evidence": "newUnknownCallReview+transitionUnknownCallReview 拼任意 status，再 encodeUnknownCallReview + UnknownCallReviewChanged 事件直接 commit（:57-76）；真实创建只在 run-machine.ts:2466 / run-reconcile-service.ts:957，无独立 owner create。",
  "action": "convert:run-reconcile-service（真 Run 未知调用→reconcile 建 review，再 listReviews；存在但重）",
  "covered_by": "—",
  "est_lines": 25,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "A2-63",
  "category": "tamper",
  "file": "tests/work-graph/S2C-lines-failure.test.ts",
  "lines": "23-38,173-184,186-197,199-215",
  "tests": "2C-14 (review item 2) an undecodable open responsible link marks the line B4 / 2C-14/L11 an ended-but-occupied Run rereads once and then reports source_moving / 2C-14/RD-8 a lease held by another Run makes the yielded Run refuse pause and cancel",
  "evidence": "helper 注释明说 `rewriteRead` 造的是 \"states the public services cannot build\"（:23）；三处分别把 lookup schema 改成 BogusLink@1（:178）、把已 claim 的 Run JSON 改成 ended+completed（:41-42、:192）、把 TaskLease.holderRunId 改成别的 Run（:212）。这些状态只能靠改存储读取结果（等同改库内容）到达；公开步骤没有等价的损坏入口",
  "action": "delete",
  "covered_by": "行为已不存在：AGENTS 第 4 条（只测篡改数据库才能触发的防御校验；failingLookup/failingReadMany 的读失败注入 :66-120 属允许的故障注入，保留）",
  "est_lines": 57,
  "spec_row": false,
  "confidence": "中"
 },
 {
  "id": "A2-64",
  "category": "tamper",
  "file": "tests/work-graph/S3-graph-context.test.ts",
  "lines": "259-280,1103-1109",
  "tests": "GR14 a damaged catalog codec is unavailable and never a ready empty graph",
  "evidence": "corruptRecordReads 在 catalog 精确 refKey 上把记录 JSON 换成坏内容（:259-280），createFixture({corruptCatalog:true}) 后只断 unavailable 与 0 提交（:1103-1109）。只有改库能造成损坏 codec；公开架构入口不会写坏记录。slice-3-SPEC.md:705 的 GR14 行即此",
  "action": "keep-note",
  "covered_by": "行为仍存在但规则 4 不允许：AGENTS 4；需 lead 连同 slice-3-SPEC.md:705 的 GR14 行一起裁定",
  "est_lines": 30,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-65",
  "category": "tamper",
  "file": "tests/work-graph/S5-decision-application.test.ts",
  "lines": "365-380",
  "tests": "AP12 a corrupt formal receipt event is unavailable and leaves application null with zero writes",
  "evidence": "用 store 包装器把 `eventAt(receipt.cursor)` 的 event.json 改成 `'{'`（:369-375），只为命中 decoder 的 unavailable 防御分支；平台自己的写路径写不出坏 JSON。slice-5-SPEC.md:1115 的 AP12 行就是“eventAt 损坏 decoder”，与 AGENTS 第 4 条冲突",
  "action": "keep-note",
  "covered_by": "行为仍存在但规则 4 不允许：AGENTS 4；需 lead 连同 slice-5-SPEC.md:1115 的 AP12 行一起裁定",
  "est_lines": 16,
  "spec_row": true,
  "confidence": "中"
 },
 {
  "id": "A2-66",
  "category": "tamper",
  "file": "tests/work-graph/W1-future-plan.test.ts",
  "lines": "416-441",
  "tests": "scenario 1/2: future-only B edit + prompt edge keep A running and C satisfied after real adoption",
  "evidence": "在 readMany 包装器里改 P1 记录的 title/requirementLevel/verification 三个字段，且先断言改完仍 decode（:428-437），只为让 queryTaskGraph 报 unavailable；这些“shape-valid source corruption”组合公开写入不会产生（:417-418 自认）",
  "action": "delete",
  "covered_by": "行为已不存在：AGENTS 第 4 条（该断言块；场景其余断言保留）",
  "est_lines": 26,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-67",
  "category": "tamper",
  "file": "tests/work-graph/W1-future-plan.test.ts",
  "lines": "622-661",
  "tests": "scenario 8: codec rejects broken shapes and graph reads verify the actual basis source",
  "evidence": "对 basis source 的 readMany 注入 cross-goal/missing/definition 三种损坏（:622-661），每种都先断言 decode 仍过再断 graph unavailable；公开 plan 服务不会写跨 Goal 或自相矛盾的 basis",
  "action": "delete",
  "covered_by": "行为已不存在：AGENTS 第 4 条（scenario 8 前半的 codec schema 校验 :600-620 保留）",
  "est_lines": 40,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-68",
  "category": "tamper",
  "file": "tests/work-graph/W1-future-plan.test.ts",
  "lines": "670-680,739-741",
  "tests": "scenario 9: a changed or added Task with a Run, TaskLease or TaskReduction is no longer future (zero writes)",
  "evidence": "corruptLeaseB 把 B 的 TaskLease JSON 换成 `'{}'`（:670-680），只为让 refusedAdoption 命中 `is not decodable`（:740）；其余 Run/Lease/Reduction 场景用真 seed 造状态，保留",
  "action": "delete",
  "covered_by": "行为已不存在：AGENTS 第 4 条（仅这一条 undecodable-lease 用例与 helper；其余 refusedAdoption 用例保留）",
  "est_lines": 13,
  "spec_row": false,
  "confidence": "高"
 },
 {
  "id": "A2-69",
  "category": "tamper",
  "file": "tests/work-graph/WP2-undelivered-notices.test.ts",
  "lines": "317-351",
  "tests": "M05 a zero or malformed platform cursor is never a stored position: the Session and SessionMessage records refuse it",
  "evidence": "commitRaw writes hand-built next-revision Session/SessionMessage records with c0000000000/not-a-cursor (333-343) only to reach the schema rejection. AGENTS rule 4 forbids tests for defensive checks that only DB tampering can reach; the M05 row itself says '不改数据库造数据' (wiring-2-SPEC.md:303).",
  "action": "keep-note",
  "covered_by": "no behaviour change; rule 4 disallows, but M05 is a spec row",
  "est_lines": 0,
  "spec_row": true,
  "confidence": "中"
 }
]
```

## 分类合计

| 类别 | 条数 | 估计行数 |
|---|---|---|
| stale | 16 | 347 |
| duplicate | 23 | 427 |
| trivial | 7 | 93 |
| handwritten | 16 | 600 |
| tamper | 7 | 182 |
| helper | 0 | 0 |
| **合计** | **69** | **1,649** |

建议动作分布：`keep-note` 29、`merge-into` 18、`convert` 13、`delete` 9。

## 覆盖说明

- **文件覆盖**：163 个文件全部至少按“用例名 + 关键断言段”读过，没有整个没读的文件。三个分片分别 63、62、38 个文件。
  - 整读或逐用例读完：S2B 的 22 个短夹具测试、S2C-lines-walk/task-anchors、S4B 全部 29 个、S4C 的 note-continuity/path-ownership/scribe-ownership/resolution-order/project-understanding、S4C2 的 D-rows/D17/N1/N2/N3/U3/U7/notice-class/notice-grouping/proof-changes/update-due、S8A-catalog-version-time/path-ownership-dedupe/L8-reminders-pure、WP2-undelivered 等。
  - 只抽读（用例名 + 关键块）：S3-context-inputs/graph-context 的夹具前半段、S4A-note-write 的部分用例、S8A-file-layer/L8-observation-state/L8-chunk-scope 的主体、W2-agent-whiteboard/W2-future-intent、S5-goal-settings 的部分 SS case、S2B-r2-v-real-runs 等；明细按三个分片记录在盘点底稿中（底稿不留在仓库）。
- **抽查**：我按分片各抽了证据回原文件核对，共 15 条：A2-01/02（2B-24/2B-26 旧轮次与旧 Run）、A2-05（2C-14 legacy Session）、A2-06（2C-18 旧 QueryRun）、A2-07（2C-29 notes fallback 与 `create-platform.ts:2222` 的 `listNotes`）、A2-15（UM12 旧 wire）、A2-19（2C-12/2C-03 INCONCLUSIVE 重复）、A2-24（M-15/MF4）、A2-30（D-06/D-17）、A2-38（SP-6/T-07）、A2-52（S3 scope seed）、A2-55（S4C2 goal-triggers）、A2-57（UCR 记录直接 commit）、A2-59（WP2 anomaly 替身）、A2-63/66（tamper）、A2-41/42/46（skip 占位）。抽查结论与表中一致。
- **未定/要 lead 拍板**：
  1. **规格行与 79-1 的冲突**：旧格式的规格行（2B-24、2B-26、2C-14、R7、R5、NR05、NR08、UM12、RC09、RC11、2C-29、AD05、IN01/02/09/19、M-10、M05）现在仍有生产分支，所以统一给 `keep-note`。要真正删测试，需同一轮删生产旧分支并给规格加后注；否则测试会先于行为消失。
  2. **规格行与 AGENTS 第 4 条的冲突**：AP12、GR14、WP2 M05 的坏记录/坏事件用例是冻结行，但只有改库能到达，给 `keep-note` 交裁定；非规格行的同类（S2C-lines-failure、W1 三处）已按规则 4 判 `delete`。
  3. **SP-\* 是否冻结**：`slice-4-SPEC.md:932` 说提速轮的 SP 测试“冻结时 lead 核”，所以 4 条 SP 重复按非冻结处理（`spec_row:false`），建议 `merge-into` S4B；若 lead 认定 SP 是冻结行，改 `keep-note` 即可。
  4. **旧格式清理的连带项**：删 2B-24/2B-26 要同批删 `s2b-round-by-goal-legacy`（`evidence-record-codecs.ts:746`）、`openLegacyRound`/`seedLegacyActivity`；删 2C-14 的 legacy 行要同批删 `createLegacySessionProvenanceReader`（`session-provenance-facts.ts:95`）与 `legacyUnchecked`；删 UM12/RC09/RC11 要同批删 `replyHandler ?? null` 默认（`message-record-codecs.ts:1217`）与 `legacy_v1`（`plan-record-codecs.ts:1009`）；删 AD05/IN 要同批删 `contextAssembly` 可选分支与 `legacy:` 派生（`context-input-service.ts:808`）。
  5. **S2B 的 `countedFacts`**：读取模型测试普遍用它手写 RunActivity facts。一个分片按“纯函数输入→输出”例外未逐条报；若 lead 认为它属于手写事实，需要另开一轮统一改走真 Runtime + `edit`。
  6. **转换成本**：node-detail 的 executed-files/anomalies 注入是 slice-2C §7 明确允许的测试替身；`S4C2-goal-triggers` 改成真 plan/startRun/requeue 会把读模型单测变成集成测试；`S3-context-inputs`/`S3-graph-context` 的夹具改造量大。三条 `convert` 都保留，交 lead 按收益决定先做哪条。
  7. **W1 `seedReduction`**：本批没有 TaskReduction 的公开写入口（`W1` skeleton §8），只能保留并在注释里写明；accepted Plan/Run/Lease 部分可改 `proposePlan`+`applyPlanChange`。
- **没读到的文件**：无。
