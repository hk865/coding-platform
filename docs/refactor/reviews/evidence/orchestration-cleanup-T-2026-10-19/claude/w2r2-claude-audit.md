
######## v2:e157b9f8db9f31fa934db32472890929a6f7f0aa6dd3272250a0b09a598c5004
{
 "findings": [
  {
   "id": "Pb-01",
   "class": "不整洁",
   "file": "tests/composition/R3d-R3g-platform.test.ts",
   "line": 16,
   "row": "W2c-05",
   "problem": "W2c-05 删掉了尾段对 ProjectArchitectureBaselineActive 的 readMany（base :233-235），这是 PLAN_GOVERNANCE_RECORD_SCHEMAS 唯一的用处。删完以后，:16 的导入和 :53 inspectSchemas 里的展开都没人用了：剩下的唯一一次 inspect 读取（:238）只读 WorkspaceArchitectureObservationCurrent，这个类型由 OBSERVED_ARCHITECTURE_RECORD_SCHEMAS 注册。这是本行改动留下的死代码。§4 记成“agent 看到了、没修（行外）”，§3 没有裁定过。",
   "fix": "删掉 :16 的 `import { PLAN_GOVERNANCE_RECORD_SCHEMAS } ...`，并删掉 :53 的 `...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,`。其它不动，然后只跑这个文件。",
   "evidence": "src/core/work-graph/tasks/plan-readers.ts:321-330（只有 records，:326 是 ProjectArchitectureBaselineActive；events/lookups 都是空的）；src/core/work-graph/architecture/architecture-record-codecs.ts:738-747（OBSERVED_ARCHITECTURE_RECORD_SCHEMAS 含 WorkspaceArchitectureObservationCurrent）；src/core/record-store/sqlite-record-store.ts:356-364（readMany 只按请求的 refKey 找对应 schema）；src/core/record-store/record-codec.ts:143-173（注册时不做跨类型检查）；tests/composition/R3d-R3g-platform.test.ts:237-238 是剩下的唯一读取。以上是静态阅读的结论，我没有运行测试。"
  },
  {
   "id": "Pb-02",
   "class": "不整洁",
   "file": "tests/composition/K-R-previous-turn-bounds.test.ts",
   "line": 88,
   "row": "W2c-10",
   "problem": "注释“The four assertions of the counted case, now under an absent seam.”里的 counted case 已经不存在了：T3-036 删了计数的那一例，W2c-10 又删了最后的计数包装和 `calls`（:27-37）。现在文件里没有任何计数，这句注释描述的是已删的代码（W2b-40 那一类）。§4 记成“agent 看到了、没修”，§3 没有裁定过。",
   "fix": "把 :88 改成 `// Moved from the deleted live-seam case (T3-036): the same four assertions, under the absent seam.`，断言不动。",
   "evidence": "现在 tests/composition/K-R-previous-turn-bounds.test.ts:27-37（没有 calls、没有包装）、:84-93（只剩 absent 一例）；base 同文件 :27-37、:93（原来的计数器）；.lead-ref/books/t-items-T3.md:360（T3-036：删掉计数那一次）；t-w2r2-findings.md:112（§4 noticed）。"
  }
 ],
 "perRow": [
  {
   "row": "W2c-04",
   "status": "OK",
   "note": "A1-graph-session-platform.test.ts:110 是字面量，注释 :100-105 写了公式、规范文本和 183 字节。我用 sha256sum 对注释里的文本复算：183 字节，哈希 27272b141e404048373f9886a5c179a23d500d987d486619fae262023fb055d5，两项都一致。键序 content<identity<revision<schemaVersion、内层 constraints<description<schemaVersion，和 fingerprint.ts:45-47 的排序一致。输入 :88-89 在 catalog-service.ts:469-472、:517-518 原样进入，没有被改写（codec 见 catalog-record-codecs.ts:193-202）。只改了一个 hunk，原来就只跑 SQLite（:50）。"
  },
  {
   "row": "W2c-05",
   "status": "Pb-01",
   "note": "两次公开读取在重开的平台关闭前完成（:195-203）。observationState 的 current.captureRef 就是 pointer.observedRef（architecture-service.ts:856），与删掉的 observedRef 断言是同一事实，同样用 toEqual。readArchitectureRevision current 只在 active 指针不存在时回 {status:'not_found'}（catalog-service.ts:369-373、:772-775），与删掉的 readMany missing 是同一事实，替换没有变弱。尾段只剩 revision（:239）和 readThrough（:241），R-20 注释 :232-234 属实（architecture-observation.ts:53-60 没有这两个字段）。账本 :231、:233 两条都能对应本行。"
  },
  {
   "row": "W2c-07",
   "status": "OK",
   "note": "27 个文件共 53 处：26 个文件各 2 处，K3-R1-second-cleanup 只有 hoisted 一处；base 里 grep 也是 27 个文件 53 处。diff 里没有别的改动。tests 下 grep executeChecks 为 0（只剩 docs 里的历史证据）。替身状态只剩 available（tests/scenarios/support/process-sandbox-standin.ts:16-18）。"
  },
  {
   "row": "W2c-08",
   "status": "OK",
   "note": "K3-review-card-fixture.ts:337-338 改成了符号名，三个符号在 S5-decision-fixture.ts:484（additionalSchemas）、:531（forwarded）、:270（observeRecords）都存在。共享 helper 只改了注释，默认路径和它给出的 id、位置、时间都不变，没有哪个 importer 的行为会变。"
  },
  {
   "row": "W2c-09",
   "status": "OK",
   "note": "R4-history-turn-support.ts:56-57 的说法与 :128-129 一致（给了 replies 就整个替换掉单条 text 回复）。只改注释，默认路径不变，importer 不受影响。"
  },
  {
   "row": "W2c-10",
   "status": "Pb-02",
   "note": "行本身做到了：计数包装、calls 和 :93 断言都删了，afterEach 只剩 absent 复位。新注释 :27-29 与 session-operations.ts:1004-1006（缺接缝回 unsupported）、continuation-brief-assembly.ts:574-575（转成 retry/unavailable）一致。接缝不在时如果被调用，brief 建不出来，测试仍会失败，所以删掉的断言（账本 :93）由这条失败路径覆盖，删除也是行里点名的。剩一处旧注释 :88。"
  },
  {
   "row": "W2c-12",
   "status": "OK",
   "note": "S3-context-assembler.test.ts:687-689 只加了注释，断言没变。注释属实：图读取拿到的是原始 taskInputsOwner（create-platform.ts:1116-1123，graph-context-reader.ts:1381），被计数的是 f.platform.taskInputs 这个包装端口（create-platform.ts:1161-1164）；assembler 直接读的只有 readTaskInputPage（context-assembler.ts:1826）。这个世界的任务没有 inputs（WP2-platform-support.ts:297）。"
  },
  {
   "row": "W2c-13",
   "status": "OK",
   "note": "session-rendering.test.ts:447 换成 '未识别记录 · <code>future.unknown</code>'。我逐字节比对了 :447 和 timeline.ts:277：分隔符都是 U+00B7（C2 B7），两边各一个空格，escapeHtml 不改 future.unknown。新断言比旧的 toContain('future.unknown') 更严，:448 保留。账本 :447 能对应本行。"
  }
 ]
}
######## v2:e719119dd944ce85bcf13dd7cd26afe335681621570a31a0bcb79719942b100d
{
 "findings": [
  {
   "id": "Pa-01",
   "class": "不整洁",
   "file": "tests/work-graph/S4C2-goal-triggers.test.ts",
   "line": 29,
   "row": "W2c-01",
   "problem": "文件头 :27-29 说平台给出的时间取自“公开步骤返回的值（或一次公开的 task-timeline 读取）”。改完 W2c-01 后，3d 的三个时间里有两个来自图读取 `queryTaskGraph`（:487）：Plan 的 `at` 在 :523（`graph.value.plan.acceptedAt`），archive 的 `at` 在 :533-538（`rework.entries[ref = archiveRef].requestedAt`）。括号里只写了 timeline 读取，没写图读取。这句话不算错，但说得不全；§4（t-w2r2-findings.md:110-111）记了 agent 看到这一处、没有改。",
   "fix": "把 :29 的括号改成“(or a public task-timeline or task-graph read)”，其余不动。",
   "evidence": "S4C2-goal-triggers.test.ts:27-29（头注原文）；:487（queryTaskGraph，在 :478-485 的 archive 之后）；:523（planAt 取自图读取）；:533-538（archiveAt 取自同一次图读取的 rework.entries）；t-w2r2-findings.md:110-111（agent 看到了，没改）"
  },
  {
   "id": "Pa-02",
   "class": "建议",
   "file": "tests/work-graph/unknown-call-review-list.test.ts",
   "line": 310,
   "row": "W2c-14",
   "problem": "W2c-14 的问题栏还写了“nothing shows the cursor sits after `decided`”。按表改完后，只看这个测试，这一点仍然证明不了。refKey 的顺序由 runId 决定（:250-254；B2-crr-world.ts:56 用 padStart(12) 生成递增的 id），所以 pending < decided < later。只查 pending_review 的那次查询（:305-307）是按 status 过滤的，decided 是 needs_decision，本来就会被滤掉。所以 wider 页的 nextCursor 不管落在 decided 之后（正确），还是错落在 pending 之后，这次查询都返回 `[later]`、`nextCursor: null`，:308-310 都会通过。这样一来，:287-288、:302-304 注释说的“cursor 落在 decided 之后、在过滤条件之外”在本测试里没有被断言。表里 W2c-14 的改法已经按原文做完；“nextCursor 落在本页最后一项之后”这一点另有店页测试（:346-357，第二页正好是 runIds.slice(200)）覆盖，所以这里只算可选补强。",
   "fix": "在 :310 之后加一次 wider 查询的续页：过滤条件同 :294（两种 open 状态），limit 2，cursor 用 `wider.value.nextCursor` 原样传入，期望 items 正好是 `[later]`、`nextCursor: null`。如果 cursor 错落在 pending 之后，这次会返回 `[decided, later]`，测试就会失败。",
   "evidence": "unknown-call-review-list.test.ts:285-289（pending 和 later 是 pending_review，decided 是 needs_decision）；:296-299（wider 页只断言 items，没有断言 cursor 落在哪里）；:305-310（只查 pending_review）；:250-254（refKey 按 runId 排序）；tests/helpers/B2-crr-world.ts:56（runId 递增）；:346-357（店页测试覆盖 nextCursor 位置）；t-w2r2-findings.md:51（W2c-14 问题栏原文）"
  },
  {
   "id": "Pa-03",
   "class": "建议",
   "file": "tests/runtime/R4b-session-input-boundaries.test.ts",
   "line": 117,
   "row": "W2c-02",
   "problem": "改完 W2c-02 后，拒绝框 `expectRefusedWithoutChange` 只有两处调用，都传了 `code: 'invalid'`（:132 limit 行，:137 另一 principal 行），但参数类型仍写成 `code?: 'invalid'`。以后新加的行可以只断言 `status: 'rejected'`，而 W2c-02 已经说明这种写法太弱。agent 回报里提到了这一点（§4，t-w2r2-findings.md:113），没有改。",
   "fix": "把 :117 的 `code?: 'invalid'` 改成必填的 `code: 'invalid'`；两处调用已经满足，不用改。",
   "evidence": "R4b-session-input-boundaries.test.ts:117（`expected: { status: 'rejected'; code?: 'invalid' }`）；:132、:137（两处调用都带 code）；:126（toMatchObject）；t-w2r2-findings.md:113"
  }
 ],
 "perRow": [
  {
   "row": "W2c-01",
   "status": "Pa-01",
   "note": "按表做完。archive 的 at 改为取 :487 那次图读取（在 :478-485 的 archive 之后）里的 rework.entries[ref = archiveRef].requestedAt，原样使用（:533-538）。读者（plan-readers.ts:1417）和 TaskRow（task-failure.ts:1285）读的是同一条 TaskRequeue 记录的 requestedAt；archive 写 requeue 是单独一次提交（session-archive.ts:673），在推进时钟上它和 Run 结束、rework、Plan 的时间都不同，所以 archive 分支返回别的时间就会失败。w2-base describe、BLOCKED 注释和头注里对应的句子都已删除。删掉的 11 个 import 名字在 base 里只出现在被删的 describe 中（base :578-676）；留下的 import 都还有用处（例如 RunRef 在 :366，TaskRequeueRef 在 :366，canonicalJson 在 :473、:534）。账本里的 :578、:657、:669、:671、:676 都对应本行。只剩头注 :29 的一个措辞问题（Pa-01）。"
  },
  {
   "row": "W2c-02",
   "status": "Pa-03",
   "note": "按表做完。recovery 文件 :248 改为 toMatchObject({status:'rejected', code:'invalid'})；去掉 session-operations.ts:426 的游标绑定检查后，会落到 :494 返回 unavailable，现在会失败。input-boundaries 文件 :137 另一 principal 的读取在 :426 拒绝，返回 invalid（cursorMatches 在 :230 比较 principal；前面 :704-795 的检查都不会提前拦下这个请求）。读取前后的公开历史比较都保留。账本 :248 是换成了更严的断言。"
  },
  {
   "row": "W2c-03",
   "status": "OK",
   "note": "noLowerRequest 是可选参数，不传时行为和以前一样。spy 只包住交给 reader 的 history（:145-146）；ExecutionHistoryDependencies 只有 history 这一个依赖（execution-history-contracts.ts:31-33），所以被拒绝的那次读取发给下层的请求都会被记下。准备游标的那次读取在 :154 清掉；histories() 直接走 world.history，不进 spy。四行的拒绝回调只调用 reader。去掉 observation-recovery.ts:260-262 后，limit 0、201、1.5 会被交给下层（ownRequest 在 :93-109 不检查 limit），记下 1 次请求，测试失败；去掉 :269 后，另一 Session 那一行会被交给下层，下层在 :426 拒绝，同样记下 1 次，测试失败。拒绝码和读取前后的公开比较都保留。"
  },
  {
   "row": "W2c-06",
   "status": "OK",
   "note": "seedRawRunVariant 连同注释、canonicalJson/JsonValue 和 RunRef 两个 import、RUN_SCHEMA_ID 都已删除，这些名字在剩下的文件里都不再出现。整个仓库已经没有 seedRawRunVariant 的调用方。直接 import 这个文件的是 4 个测试（S2B-r3-consultation-cap:16、S2B-r2-r7-keyed-read-cap:13、S2B-r2-r4-bound-workspace:12、S2B-r2-r3-track-pagination:17），只用 R2_DAY_*/seedRealTrackRuns；没有经别的 helper 间接 import 的情况。默认路径没变。"
  },
  {
   "row": "W2c-11",
   "status": "OK",
   "note": "只改了注释。代码 :382 传的是 b2.entry。Run 卡在模型门是 running 状态，所以走 run-reconcile.ts:303-308 的 missing/W-14 分支，这个分支不用 entry；deps.entry 在这个文件里只在 :397 使用。restartedHost 用的是 rebuildDeps 重建的 entry（S2B-runtime-tools-support.ts:83、:87），和注释说的一致。"
  },
  {
   "row": "W2c-14",
   "status": "Pa-02",
   "note": "按表做完。later 改用 createPending 生成，是公开 readReview 读回的 pending_review 记录（B2-crr-world.ts:164-169）。wider 页仍然只含 pending 和 decided，并返回 cursor。只查 pending_review、cursor 原样传入的那次查询，期望 items 正好是 [later]（toEqual）、nextCursor 为 null；两个后端都跑；店页测试没动。账本 :307 换成了更严的断言。剩下一点：这次查询分不出 cursor 是在 decided 之后还是在 pending 之后（Pa-02，建议）。"
  }
 ]
}
######## v2:b40ef6e5bdf0059e97094e76e0d1c6f13b85e139154b606ba7196ad1122bd2ba
{
 "verdicts": [
  {
   "id": "Pb-01",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "Not refuted. The current file has the import at tests/composition/R3d-R3g-platform.test.ts:16 and spreads `...PLAN_GOVERNANCE_RECORD_SCHEMAS.records` into inspectSchemas at :53. The only remaining inspect read is at :237-238, and it reads WorkspaceArchitectureObservationCurrent. That type is registered by OBSERVED_ARCHITECTURE_RECORD_SCHEMAS (architecture-record-codecs.ts:738-740, :746-747). The base file (.lead-ref/base/...R3d-R3g-platform.test.ts:233-235) had a readMany of ProjectArchitectureBaselineActive, the only aggregate in that set the test needed (plan-readers.ts:326; events and lookups are empty at :328-329). The P1.diff lines 111-113 show W2c-05 deleted it, and the diff does not touch :16 or :53. readManyInside looks up a schema only for each requested aggregate type (sqlite-record-store.ts:356-364). The open path uses only lookups (:126-127, :162, :166), and inspect lookups come from OBSERVED (empty). The record registry does no cross-type check (record-codec.ts:143-173). So removing the import and the spread changes nothing, and the registration does nothing now. The name is still used in an expression, which is why the lead's --noUnusedLocals pass (§4 :87-89) could not catch it. Table check: §4 :110-112 only records it as noticed by the agent outside the rows. No §0 ruling (R-1..R-24) and no §3 or rework-1 §5 entry decides it, and no rule sheet allows a leftover registration. All cited file:line facts check out. The class 不整洁 fits: dead code, same kind as W2c-06."
  },
  {
   "id": "Pb-02",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "Not refuted. The current file still has `// The four assertions of the counted case, now under an absent seam.` at tests/composition/K-R-previous-turn-bounds.test.ts:88. Nothing in the file counts any more: :30 is `{ absent: false }` with no `calls`, :31-36 have no wrapper, :37 resets only `absent`, and :84-93 hold the single absent-seam case. The base file had the counter at :29, :33, :37 and the assertion at :93. T3-036 (books/t-items-T3.md:360) deleted the counted case itself. So the comment names a case that does not exist and refers to a counter that is now gone, which is W2b-40's class: comments that point at removed code. t-w2r2-findings.md:112 records it only as noticed and not fixed, outside the rows. The agent's own note (replies/t-reply-W2R2-agents.md:147) says the same. No §0 ruling, §3 entry or rework-1 §5 entry decides it. Caveat: the stale comment already existed at w2r1 (base :88), so rework 2 left it in place rather than introducing it. But W2c-10's purpose was to remove the counter references, and this comment is one of them. The proposed fix changes only the comment and leaves the assertions alone. The class 不整洁 fits."
  }
 ]
}
######## v2:ea0e6bdefbdd68acaa4222ed26ad3f68a40729497e67d268cf5a942ab6c9f2a5
{
 "verdicts": [
  {
   "id": "Pa-01",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "The code says what the finding claims. In the w2r2 tree, S4C2-goal-triggers.test.ts:28-29 reads 'platform-issued times are the values those public steps returned (or a public task-timeline read)'. In 3d, reworkAt comes from the timeline read (:513-521). planAt comes from the graph read `graph.value.plan.acceptedAt` (:523), and that graph read is made after the archive (:487). archiveAt comes from the same graph read's `rework.entries[ref = archiveRef].requestedAt` (:533-538). So two of the three times come from the graph read, and the parenthetical names only the timeline read. One detail the finding leaves out: the gap is older than rework 2. Base already took planAt from the graph read (base :531) under the same parenthetical (base :31-32). W2c-01 rewrote this very sentence (P1.diff:895-901, dropping 'Apart from that one w2-base test'), kept the parenthetical, and added a second graph-read time. Nothing in the tables rules this out. §4 (t-w2r2-findings.md:110-111) only records it as 'noticed by the agents, not fixed (outside the rows)', which is not a ruling. The line range W2c-01 named for the header (:24-30 at w2r1) did not cover the parenthetical, so the agent stayed inside its row. The comment is still only untidy, not wrong: :24-25 already says the three times are read back 'through a public read'. 不整洁 fits."
  },
  {
   "id": "Pa-02",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "The facts hold. createPending and createNeedsDecision both go through blockedRecord, which uses runIdGeneratorOf(world). That generator yields increasing ids padded to 12 digits (B2-crr-world.ts:50-56). The wider page asserts [pending, decided] at limit 2 (:296-299), so the order is pending < decided < later. That page checks only that nextCursor is not null (:300), not where it sits. The bounded query filters on pending_review only (:305-307), and `decided` is needs_decision (:286). So if nextCursor were wrongly placed after `pending`, the query would still return [later] with nextCursor null, and :308-310 would pass. The comments at :287-288 and :302-304, which say the cursor sits after `decided`, are therefore not asserted in this test. This is not a re-raise of a settled point. W2c-14's own problem column (t-w2r2-findings.md:51) names 'nothing shows the cursor sits after `decided`', and the adopted fix closes that only partly: it rules out an empty page or a cursor after `later`, but not a cursor after `pending`. The rework applied the row as written, which the finding itself says. The proposed check is sound: continue the wider query (both open statuses, limit 2, the returned cursor). After `decided` it returns [later] with nextCursor null; after `pending` it would return [decided, later] and fail. The suggestion stays clear of the store-page test, which the row said not to touch. That test (:346-357) already catches an off-by-one cursor, so 建议 (optional) is the right class."
  },
  {
   "id": "Pa-03",
   "verdict": "confirmed",
   "classOk": "yes",
   "reason": "R4b-session-input-boundaries.test.ts:117 declares `expected: { status: 'rejected'; code?: 'invalid' }`. The helper is local to the describe block and has exactly two callers, both passing code 'invalid': the limit rows at :132 (they already did in base) and the other-principal row at :137 (changed by W2c-02, P1.diff:213-214). Making `code` required would compile with no change at either call. The match at :126 is toMatchObject, so with `code` optional a future row could assert only `status: 'rejected'`, the weak form W2c-02 just removed. §4 (t-w2r2-findings.md:113) only records the agents' note, not a decision. Neither the rule sheets nor R-13..R-24 say anything against it. W2c-02 asked only for the two assertions, so the rework did not break its row; that makes this a suggestion, and 建议 fits."
  }
 ]
}