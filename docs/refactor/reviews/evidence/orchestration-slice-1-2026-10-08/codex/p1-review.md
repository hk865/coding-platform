**Do not freeze these tests yet.** All 151 required IDs are present, with the correct file mapping and both backend wrappers for every SV row. The problems are fixtures, assertions, entry-point coverage, and several premature production changes.

This was read-only. I did not run tests, Node, npm, or package scripts. The execution results below are the lead’s supplied measurements.

1. **must-fix — `tests/state/session-availability.test.ts:169`, `:253`, `:281`: the extended Session matrix has no usable oracle for its new events.**  
   **Violates:** §5.2 matrix extension, §3.2 S1-SES-02/03/05/06; book D.  
   **Evidence:** three new events are added to `CASES`, but `expectedFor` has no corresponding branches and reaches `throw new Error('unhandled event in the oracle')`. Its reactivation branch still returns legal reactivation for every archived health state. Changing the separate unavailable-reactivation test does not correct this matrix. The contexts also omit the explicit archive/wait and dispatch facts required by §5.2.  
   **Direction:** complete the new-event oracles, apply unavailable-reactivation refusal throughout the matrix, and supply the prescribed narrow-fixture facts.

2. **must-fix — `tests/state/session-availability.test.ts:850`, `:924`; `src/core/work-graph/state/session-availability.ts:290`: required normalization conflicts with unchanged exact assertions.**  
   **Violates/conflicts:** §3.5 versus book D’s “only existing expectation that changes”; §5.5 regression requirements.  
   **Evidence:** `sessionMachineStateOf` now supplies `provenance: … ?? null` and `archiveRequest: … ?? null`, while `machineState` and the absent-state creation result lack those properties. The two exact comparisons therefore remain unequal after the unrelated stubs are implemented.  
   **Direction:** retain the normalization explicitly required by §3.5. The minimal consistent resolution is a narrowly agreed adjustment to canonical machine-state fixtures/creation projection, preserving the old raw-record literal and key-order assertions. No §0 provision makes absent properties equal explicit null; §5.5 provides escalation to the lead, not permission to silently change additional expectations.

3. **must-fix — `tests/state/message-machine.test.ts:179`, `:253`, `:308`, `:1043`: every new archive-disposition matrix cell is hard-coded invalid.**  
   **Violates:** §3.2 S1-MSG-01/02, §3.5, §5.2 matrix extension.  
   **Evidence:** all six states use `archiveDisposed: no('guard_failed', 'invalid')`, despite the “happy” context supplying `requestMatches: true`, `waitMatches: true`, and `responseAccepted: false`. Valid cancellation of an unconsumed wait is allowed. The context/application also uses `archiveSessionRef: RECIPIENT`, whereas this wait belongs to `WORK_RUN_SENDER.sessionRef`; the complete-response state is incorrectly given `responseAccepted: false`.  
   **Direction:** construct internally consistent archive contexts and specify legal cancellation and accepted-response refusal. Retain the existing message-event expectations; do not make the added event permanently invalid to preserve them.

4. **must-fix — `tests/state/invariants.ts:2147`, `:2155`: two required invariants are missing.**  
   **Violates:** §5.1; book D.  
   **Evidence:** `checkSlice1Invariants(world)` receives no previous world/step and checks occupancy, requests, open claims, and duplicate anchors, but never verifies **anchor creation leaves Task phase unchanged** or **retired Sessions cannot reactivate**. `S1-5` is declared without a corresponding finding.  
   **Direction:** implement these cross-step checks and invoke them after each relevant recorded mutation.

5. **must-fix — `tests/state/S1-session-archive.test.ts:135`; `tests/state/S1-responsibility.test.ts:151`: retired fixtures represent different states.**  
   **Violates:** UT05, UT14; §3.2 S1-SES-04/S1-LINK-01.  
   **Evidence:** UT05 starts from the default available Session and supplies only `retired: true`. UT14 creates `{ lifecycle: 'archived', archivedAt: T0 }` with default available health, then supplies `destinationEligible: false`. Thus UT14 tests an archived destination, not the specified retired destination; UT05 preserves available health in its exact next-state expectation.  
   **Direction:** represent actual retirement consistently in the Session facts, while retaining the trusted guard abstraction.

6. **should-fix — `tests/state/S1-session-archive.test.ts:36`, `:185`: UT09’s record fixture creates a self-predecessor.**  
   **Violates:** UT09’s reliable continuation basis; §2.2/§3.4 provenance cycle rules.  
   **Evidence:** `PROVENANCE_CONTINUATION.from` is S, and it is applied to `sessionRecord()` whose own ref is also S.  
   **Direction:** use child D with predecessor S. The pure transition can accept trusted basis facts, but its record-constructor fixture should not describe an impossible reliable basis.

7. **must-fix — `tests/state/S1-archive-rework.test.ts:151`, `:167`: UT34/UT35 can pass when permission incorrectly allows requeue.**  
   **Violates:** UT34/UT35’s required forbidden result.  
   **Evidence:** `if (refusal === null || refusal.ok) return;` skips the forbidden assertions precisely when there is no refusal.  
   **Direction:** assert that a refusal exists before inspecting its code. **UT33’s current pass is legitimate preservation coverage:** its real `interrupted_clean` fixture already receives the prescribed uncounted automation values. UT35 also currently exercises the old human-pause fence, but its conditional assertion remains weak.

8. **must-fix — `tests/business/S1-task-order.test.ts:54`, `:67`: UT39 omits selection; UT40’s mutation check is shallow.**  
   **Violates:** UT39/UT40; §4.3; §8 rule 12.  
   **Evidence:** UT39 checks `[A,B]` and `ordered.some(…B)`, but never makes A non-executable or calls `selectNext`; it cannot detect a new dependency gate. UT40 snapshots with `[...tasks]` and `[...dependsOn]`, sharing their objects with the originals.  
   **Direction:** exercise real selection that skips A and chooses B, and retain independent snapshots capable of detecting input-object mutation.

9. **must-fix — `tests/work-graph/S1-responsibility.test.ts:73`; `tests/work-graph/S1-archive-owner.test.ts:93`: the suspected `openLink` failures are fixture failures.**  
   **Violates:** §5.1; book C and part-1 RED requirements.  
   **Evidence:** these fixtures omit `SESSION_LIFECYCLE_RECORD_SCHEMAS`. Existing `linkSessionWork` emits `SessionWorkLinkChanged` at `src/core/work-graph/sessions/session-lifecycle.ts:531`; Store validation rejects it with `event … uses unregistered schema …` at `src/core/record-store/record-codec.ts:666`.  
   **Direction:** register the lifecycle bundle before opening links. **Suspicion (a) is confirmed**, but the missing prerequisite is event-schema registration—not Task membership, workspace, or an occupancy guard. This blocks SV16–20, SV47, and SV22 before their intended code.

10. **must-fix — `tests/work-graph/S1-session-facts.test.ts:61`, `S1-provenance.test.ts:65`, `S1-anomaly-owner.test.ts:50`, `S1-wait-disposal.test.ts:72`, `S1-requeue.test.ts:74`: other necessary schemas are also absent.**  
    **Violates:** §5.1/5.3; book C.  
    **Evidence:** plain `createB2ExecutionFixture(kind)` does not register the Message, Query, lifecycle/archive/backfill, and anomaly bundles needed by these rows. Archive-owner adds only the Message bundle.  
    **Direction:** compose the required real registrations through the existing additional-schema mechanism. Implementing owners cannot repair these frozen fixtures.

11. **must-fix — `tests/work-graph/S1-requeue.test.ts:78`; `tests/work-graph/S1-session-facts.test.ts:65`; `tests/runtime/S1-archive-files-brief.test.ts:35`: fixed identities and clocks are replaced by old helper values.**  
    **Violates:** §5.1; book C.  
    **Evidence:** requeue injects `now = () => B2_AT`; other files alias B2’s project/workspace/Sessions/Runs to p/w/S/D/r0/r1, while the underlying facts retain older names and September timestamps. Runtime files explicitly use `s1-files-*` or `s1-routed-*`. Setting fake Date does not replace owners’ injected clocks.  
    **Direction:** adapt the in-file fixtures to the frozen values throughout the prerequisite chain, rather than merely renaming local variables.

12. **must-fix — `tests/work-graph/S1-dispatch-guards.test.ts:113`, `:173`; other new service files: required observations are missing or ineffective.**  
    **Violates:** §5.1’s rejection, replay, and invariant rules.  
    **Evidence:** none of the nine new work-graph files calls the invariant checker. Many refusals check only status/code; replay checks often omit original cursor/full value and call/write counts. `base.spy.commits` observes the fixture’s wrapped claim service, not separately constructed owners using the raw backend.  
    **Direction:** observe actual records/events/receipts and relevant calls, compare complete original replay results, and run invariants after mutations. Do not use an unrelated spy as proof of zero writes.

13. **must-fix — `tests/work-graph/S1-codecs-indexes.test.ts:185`, `:203`, `:254`, `:300`, `:333`, `:357`: codec/index rows have incomplete or misleading coverage.**  
    **Violates:** SV01–05, SV43; §2.1/2.8/2.9; §8 rules 6/10.  
    **Evidence and direction:**
    - **SV01:** decodes Session and Message but omits old **Operation**. Current encoders generate the supposedly old bytes. Use preserved old encodings and cover Operation compatibility.
    - **SV02:** positively checks predecessor and one Work lookup; no Query, anchor, handler message, or second Work lookup result is checked. `foreignWorkspaceValues` also changes non-workspace keys, so empty results do not prove workspace isolation. Seed/check every prescribed ref, then change only workspace.
    - **SV03:** opens SQLite with new schemas and reopens the same schemas; never performs old-schema-write → new-schema-reopen. Check actual record/event counts.
    - **SV04:** `commitRaw` directly assigns provenance; no copy-message derivation or continuation creation occurs. Its current pass does not prove creation propagation or copy exclusion from continuation successors.
    - **SV05:** calls the decoder and registered validator, not the required bad-field **creation entry**; public invalid/zero-write coverage is missing.
    - **SV43:** the anchor body contains only ref/revision/schemaVersion. Missing required fields cause invalid independently of the revision mismatch. Start with a complete valid anchor and alter only the outer revision.
    
    SV42 and SV44 use the intended pure-decoder path; I found no independent wrong row expectation in those cases.

14. **must-fix — `tests/work-graph/S1-session-facts.test.ts:94`: all seven facts rows lack their distinguishing prerequisites.**  
    **Violates:** SV06–11/SV53; §3.3/3.5; §8 rules 3/6.  
    **Evidence:** each starts from ordinary B2 claims; SV07 explicitly says “the exact seeded ordering lands with part 2.”  
    **Direction, by row:**
    - **SV06:** create yielded Work and the newer Query that actually replaces `lastExecutionRef`.
    - **SV07:** create opposing runId/generation order on the same Session; `items.length > 0` cannot test maximum generation.
    - **SV08:** save the unconsumed response and assert both ordinary Work and Query claims are busy.
    - **SV09:** actually cancel the original wait and compare the unchanged response; `session.revision > 0` is unrelated.
    - **SV10:** seed the 2501 candidates/26-page traversal; the present single-candidate fixture cannot reach the limit.
    - **SV11:** require a nonnull next-page cursor before changing filter/scope. Currently null is omitted, producing a valid first-page read that should not be invalid.
    - **SV53:** establish the exact old Query pointer with no `executionState`; assert its exact ref and absence of fabricated execution fields.

15. **must-fix — `tests/work-graph/S1-provenance.test.ts:102`, `:117`, `:125`, `:138`, `:149`, `:159`: provenance rows do not establish or write the specified facts.**  
    **Violates:** SV12–15/SV45/SV46; §2.2/3.4; §8 rules 1/5/6.  
    **Evidence:** SV12/SV13 call only `deriveLegacySessionProvenance`; equal read `sourceCursor` values are not a committed backfill replay. Other rows reuse ordinary fixtures without successors, conflicting evidence, a cycle, or the later-link event.  
    **Direction:** SV12/SV13 must call real backfill and inspect persisted provenance, revision, original value/cursor and `replayed`. SV14 must assert both exact successor refs/from and both traces containing S. SV15/SV45 need their real conflict/cycle plus zero commits. SV46 needs a genuine `linkChanged` cursor that is not `SessionCreated`, with candidate requeue evidence rejected for that reason.

16. **must-fix — `tests/work-graph/S1-responsibility.test.ts:160`, `:189`, `:202`: writer-state prerequisites are reversed or missing.**  
    **Violates:** SV16–18; S1-LINK-01; §3.4.  
    **Evidence:** SV16 and SV18 never stop/release the source writer, so correct transfer should refuse before committing or reaching the barrier. Conversely, SV17 calls `await f.endRun()` before expecting the “writer running” busy refusal.  
    **Direction:** stop the writer for SV16/SV18; enter and keep it running for SV17. SV16 also needs the complete unchanged current Task facts and destination `until=null`, not merely unchanged Plan revision.

17. **must-fix — `tests/work-graph/S1-responsibility.test.ts:228`, `:262`, `:278`: terminal and unchanged-link assertions are incomplete.**  
    **Violates:** SV19/SV20/SV47; S1-LINK-02.  
    **Evidence:** SV19’s satisfied/cancelled/superseded states exist only in a comment; the three Tasks remain pending/active, and the fourth is not made failed. SV20 and SV47 compare open-link counts rather than complete original link values.  
    **Direction:** formally establish all three terminal states and the failed nonterminal Task; retain each `since` and actual closure cursor. For SV20/SV47 compare exact links/revisions and zero-write observations. SV20’s completed-Run-without-satisfied-Task setup otherwise matches its row.

18. **must-fix — `tests/work-graph/S1-archive-owner.test.ts:177`, `:263`: SV22 cannot exercise its race.**  
    **Violates:** SV22; §2.3/3.4/5.1.  
    **Evidence:** the step helper always uses `subjectKey: canonicalJson(SessionRef)`, but responsibility requires canonical **WorkLinkTarget**. Request choices remain `tasks:[]`; disposal is attempted before stopping the writer. `f.endRun()` later produces completion—not the specified legal yield after the final read—and no interleaving hook holds that read window.  
    **Direction:** use valid choices and step identity, complete disposal after stopping, inject the actual yield after final’s not-waiting read, and assert the exact conflicting S pin plus unchanged closed link.

19. **must-fix — `tests/work-graph/S1-archive-owner.test.ts:242`, `:282`, `:316`, `:334`: archive fixtures bypass or omit release/disposal.**  
    **Violates:** SV21/SV23/SV25/SV56; §5.1; §8 rules 2/7.  
    **Evidence:** SV21 overwrites occupancy and never reaches final; SV23 directly clears occupancy/sets unavailable health without genuine wait/link disposal. SV25/SV56 call final while the original claim still occupies S, so legitimate final must return busy.  
    **Direction:** use actual claim generation and formal release. SV21 must verify retention through final and atomic clearing; SV23 must establish the disposed wait/links and preserve the real message. Release before SV25/SV56 replay; add SV56’s zero-new-write observation. Their exact original replay comparisons are useful once reachable.

20. **must-fix — `tests/work-graph/S1-archive-owner.test.ts:303`: SV24 changes pins as well as choices.**  
    **Violates:** SV24’s discriminating given; §3.4/§8 rule 1.  
    **Evidence:** the second `archiveRequest` is rebuilt after the first commit, obtaining a new Session pin. Correct fingerprinting already detects that changed `expected`, even if choices were accidentally excluded.  
    **Direction:** preserve the original request identity and pins; change only transfer destination/confirmation.

21. **must-fix — `tests/work-graph/S1-archive-owner.test.ts:223`, `:350`, `:374`: SV60/SV61 fabricate the control evidence they must test.**  
    **Violates:** SV60/SV61; §4.1; §8 rules 1/2.  
    **Evidence:** `countingControls` returns synthetic committed values and `'control-cursor-1'`; `readControl` returns not_found. No durable cancel, lost response, k→k+1 change, real competing control, or `deliverControl` exists. SV60 requires `submits.length === 1` after recovery, conflating API calls with durable intents and potentially forbidding necessary receipt replay.  
    **Direction:** use the real control owner. Lose the response after its durable commit for SV60; establish a different legal control while running for SV61. Verify original pin/intent/ref/cursor/replay, one durable intent, original delivery, and preserved R without pin replacement/release.

22. **must-fix — `tests/work-graph/S1-anomaly-owner.test.ts:66`, `:84`, `:100`, `:110`, `:123`: anomaly rows lack durable authority; SV29 additionally asserts an impossible next action.**  
    **Violates:** SV26–29; §2.3/3.5; §8 rules 1/9.  
    **Evidence:** steps use fabricated `a-identity`/`a-fingerprint` receipts, with no real stopped/archive-authorized execution. SV26 never clears real R or proves exactly one persisted anchor; SV27 also omits the persisted count. SV29 merely comments that Task is satisfied and expects `pending:[], label:null, next:{kind:'dispatch'}`.  
    **Direction:** obtain receipts from real requests, establish stopped/satisfied facts, and count persisted anchors. **§3.5 explicitly fixes empty pending → `next:null`**, so change SV29’s direction accordingly and assert no TaskRequeue. SV28’s target body/ref equality assertions are appropriate once its prerequisites/indexes exist.

23. **must-fix — `tests/work-graph/S1-wait-disposal.test.ts:91`, `:108`, `:135`: wait steps and execution acceptance identities are invalid.**  
    **Violates:** SV30–34/SV54/SV55; §2.3/3.4/5.1.  
    **Evidence:** fake receipts accompany `step:'wait_cancel', subjectKey:'m'`; wait_cancel requires canonical complete RunRef. D is `base.sessions.second`, but r1 belongs to the additional B2 Session `b2-session-second`. Hard-coded Kernel identities do not represent real entered/accepted-input evidence.  
    **Direction:** derive steps from durable R, separate reply-handler and original-Run cancellation identities, align D with its actual Run, and establish genuine Kernel bindings. Otherwise SV54 can reject for unrelated execution evidence, and SV30/SV55 cannot validly accept.

24. **must-fix — `tests/work-graph/S1-wait-disposal.test.ts:149`, `:162`: SV30 and SV31 contradict their sequencing/persistence givens.**  
    **Violates:** SV30/SV31; §2.5; §8 rules 1/3.  
    **Evidence:** SV30 demands nonnull response immediately after transfer, although the row saves it **later** and transfer preserves null. It neither saves that later response nor proves source cancellation; `expect.any(Object)` does not preserve the original body. SV31’s `await open(kind)` creates a fresh database, with no injected cancellation failure.  
    **Direction:** transfer while null, compare original body, save the later reply, cancel and accept once. For SV31 reopen the same ledger/reconstruct over the same memory store, inject the specified failure, compare original receipt, count one transfer/cancel and read actual `wait=null`.

25. **must-fix — `tests/work-graph/S1-wait-disposal.test.ts:169`, `:181`, `:194`, `:205`, `:217`: remaining wait rows omit exact outcomes.**  
    **Violates:** SV32–34/SV54/SV55.  
    **Evidence and direction:**  
    **SV32:** establish saved response/transfer; compare exact original responseRef, consume in D, and count no second question/answer.  
    **SV33:** establish retirement/late reply; assert exactly one item and unchanged ack/handler/message rather than only an empty routed page.  
    **SV34:** establish continuation/late reply; replace any-object refs with original equality and observe zero successor Kernel input.  
    **SV54:** make every execution guard except handler authorization valid, then assert zero receipts/writes.  
    **SV55:** its accepted-input id/part/Run/count assertions are suitable after fixing the actual routed response and D execution facts.

26. **must-fix — `tests/work-graph/S1-requeue.test.ts:203`, `:243`, `:258`, `:298`, `:312`: archive-origin rows provide refs without the required evidence.**  
    **Violates:** SV35/SV38/SV48/SV57/SV59; §3.4/3.5; §8 rule 9.  
    **Evidence:** positive cases end ordinary Work with `CRASHED` and construct `executionOrigin(f,'a')`; no matching R/anchor/archive cancel exists.  
    **Direction:** SV35 needs real human archive cancellation. SV38 needs an archive-produced requeue and actual unchanged Attempt/Run/Kernel counts. SV48 must have real R while only the anchor is absent. SV57 needs the yielded-wait cancellation/disposition without anchor and an explicit absence of fabricated `ConsumedWait`. SV59 needs ordinary failure **before** genuine retirement/anchor and prior count three; retain the normal run_failed/count-four refusal.

27. **must-fix — `tests/work-graph/S1-requeue.test.ts:226`: SV37’s current pass is for the wrong reason.**  
    **Violates:** SV37; §8 rules 2/7/9.  
    **Evidence:** ordinary CRASHED Work plus nonexistent archive proof is followed only by `status:'rejected'` and absent requeue/refusal checks. None of anchor1/link closed/S archived/Task paused_interrupted is asserted. Currently unknown `archiveOrigin` input alone produces rejection.  
    **Direction:** run genuine retired paused-interrupted archive and assert every positive archive result and unchanged pause fence. This confirms suspicion (c) for SV37.

28. **must-fix — `tests/work-graph/S1-requeue.test.ts:270`: SV49 is rejected before the intended anchor mismatch.**  
    **Violates:** SV49; §3.4 check order.  
    **Evidence:** afterRun is changed to nonexistent r2, but the request helper still pins r0. Existing `expectedPinsOf` rejects the extra r0 pin as invalid before archive validation. Absence checks also inspect r0-keyed records instead of r2.  
    **Direction:** create eligible r2 with its correct pin and real r0 anchor/R; isolate the mismatch and check records for the requested Run.

29. **must-fix — `tests/work-graph/S1-requeue.test.ts:283`: SV50’s expectation is correct; its fixture is wrong.**  
    **Violates:** SV50’s `prior=cap=3` given.  
    **Evidence:** only policy cap three is configured. Fresh r0 has no prior requeue chain, so prior count is zero and the next ordinary automatic failure has count one. Correct old behavior therefore requeues.  
    **Direction:** establish the actual prior count-three chain before the fourth failure. **Suspicion (b): retain the frozen refusal/count-four expectation; fix the fixture.**

30. **must-fix — `tests/work-graph/S1-dispatch-guards.test.ts:117`, `:129`, `:174`, `:185`, `:203`: five service rows bypass the public claim owner.**  
    **Violates:** SV39/SV40/SV51/SV52/SV58; §0.2 L1; §5.1/5.3; §8 rule 7.  
    **Evidence:** calls are `workClaimDispatchProblem(facts, null)` or `queryClaimDispatchProblem(facts, false)` against fabricated facts. No actual copy/wait/R/legacy Message-child relation is persisted, no QueryJob/Run is pending, and no public claim is attempted. Pure helper calls trivially leave commit counters unchanged.  
    **Direction:** call the real direct Work/Query claim entries with valid persisted prerequisites. SV40 must inject SessionFacts; SV58 must force the trusted legacy reader to discover the saved child relation before Query claim. Check actual Run/Lease/Job/occupancy outcomes. Helper APIs cannot substitute for the specified service entry.

31. **must-fix — `tests/work-graph/S1-dispatch-guards.test.ts:139`, `:154`: SV41 discards the archive stub exception.**  
    **Violates:** SV41; §5.1; book’s permitted RED reasons.  
    **Evidence:** ordinary B is claimed on idle D without consumedWait; lifecycle has no SessionFacts. `Promise.allSettled` filters out rejected Promises, leaving one committed claim. `losers.every(...)` on an empty array passes, and “not maintenance” does not prove no double occupancy.  
    **Direction:** establish the genuine wait/consumedWait exception and injected facts, require both operations to fulfill, and require exactly one committed result plus exactly one permitted domain rejection with consistent durable occupancy. This confirms suspicion (c) for SV41.

32. **must-fix — `tests/business/S1-session-maintenance.test.ts:83`, `:91`; `tests/business/S1-archive-flow.test.ts:79`, `:88`: integration dependencies remain permanent fakes.**  
    **Violates:** §5.1/5.4; book C.  
    **Evidence:** responsibility basis always returns unsupported with `"SessionResponsibilityBasisPort arrives with the phase-2 owner"`. Required anomaly/Query schemas are absent; archive-flow also lacks lifecycle schemas.  
    **Direction:** compose the real basis reader and all required schemas now. This is not an external callback double permitted by §5.4; part 2 cannot fix it without editing frozen tests.

33. **must-fix — `tests/runtime/S1-archive-files-brief.test.ts:113`, `:122`, `:165`: IT01/IT02/IT32 have no specified Kernel evidence.**  
    **Violates:** IT01/IT02/IT32; §2.6; §8 rule 8.  
    **Evidence:** all use the same merely claimed, unexecuted Run. There is no confirmed edit a, unknown command effect b, missing Kernel window, or formal not_entered proof. IT02 accepts any nonempty reason instead of the prescribed mixed-ownership warning.  
    **Direction:** establish each real history separately; assert the fixed warning for fallback and formal not_entered evidence with zero capture.

34. **must-fix — `tests/runtime/S1-archive-files-brief.test.ts:136`, `:150`, `:156`: IT03–05 test a helper instead of preparation/rehydration.**  
    **Violates:** IT03–05; §2.7; §8 rules 9/10.  
    **Evidence:** IT03 calls `assembleAnomalySection` twice and checks disconnected `captures=[]`, whereas the row requires real repeated prepare with capture once and matching inputBinding refs. IT04 formats an arbitrary digest without loading old manifest/text. IT05 omits the ninth anchor’s `pickedUpBy=null`, warning, and fixed final sentence.  
    **Direction:** exercise real Runtime preparation/rehydration and compare persisted brief/inputBinding/digest/text and actual capture count.

35. **must-fix — `tests/business/S1-session-maintenance.test.ts:206`, `:223`, `:237`, `:280`: IT06–09/IT31 do not establish the time basis.**  
    **Violates:** IT06–09/IT31; §4.2; S1-AUTO-01.  
    **Evidence:** IT06/07 leave occupied unfinished Work; IT08’s new Task and new completion time exist only in comments; IT09 creates five never-used Sessions; IT31 never creates the terminal closure event or later Task redefinition. The default day constant is not evidence of historical `finishedAt`.  
    **Direction:** establish formal terminal closures at t0, actual new responsibility/completion for IT08, equivalent elapsed histories for all duties in IT09, and real closure/redefinition for IT31. Assert their precise thresholds and zero model calls. IT06 can currently pass for unrelated busy state.

36. **must-fix — `tests/business/S1-session-maintenance.test.ts:160`, `:267`, `:293`, `:313`: IT10/IT11/IT33/IT34 manufacture or incompletely inspect lifecycle facts.**  
    **Violates:** these IT rows; §0.1/0.2 L3; §5.1; §8 rules 2/11.  
    **Evidence:** `retire` directly overwrites health/occupancy; `markRunOutcomeUnknown` raw-writes the Run. IT10 does not prove drop/anchor. IT11’s copy has no formal Query Answer/message association, and source is not entered. IT33 checks `until !== null` rather than actual cursor and reads phase from a stale Plan object; it creates a later link rather than the specified creation-time initial link. IT34 omits full zero-commit/unchanged-Run and model observations.  
    **Direction:** use formal retirement/reconcile/answer paths. Check actual anchor/drop for IT10, answered copy and unchanged running source for IT11, current effectivePhase/cursor/counts for IT33, and complete unchanged snapshots plus record/event/receipt/model counts for frozen U1 in IT34.

37. **must-fix — `tests/business/S1-archive-flow.test.ts:179`, `:188`, `:198`, `:206`: IT12–15 lack their execution/failure givens.**  
    **Violates:** IT12–15; §4.1; §8 rules 2/7.  
    **Evidence:** IT12 has unentered Work, empty choices, and `link?.until ?? null` passes with no link. IT13 injects no final CAS failure and commits no prescribed stop/anchor/drop before it. IT14 uses a Work fixture, not an answering Query, and never saves its answer/final archive. IT15 never establishes unknown Work.  
    **Direction:** establish the named real execution and disposal sequence; induce only the specified final conflict for IT13. Assert all required zero-transfer/requeue/cancel/anchor or zero-submit observations and eventual results.

38. **must-fix — `tests/business/S1-archive-flow.test.ts:219`, `:235`, `:252`: IT16/IT26/IT27 bypass the behavior under test.**  
    **Violates:** IT16/IT26/IT27; §0.2 T10; §4.1; §8 rules 5/9.  
    **Evidence:** IT16 explicitly supplies D to `claimTask` and uses minimal `buildPrepared`, proving neither Workflow choice nor anchor/history brief. IT26 directly clears occupancy and returns fake `'it26-attest-cursor'`, without real attestation or persisted stopped Run. IT27 manually creates/claims a Session while another usable candidate remains.  
    **Direction:** exercise normal Workflow dispatch and real Runtime preparation, inspecting anchor/sessionBasis/seededFrom/continuity/history and Session counts. For IT26 use the real unknown attestation/lease path and exactly one anchor.

39. **must-fix — `tests/app/S1-session-routes.test.ts:99`, `:114`: IT17/IT18 omit actual binding/HTTP behavior.**  
    **Violates:** IT17/IT18; §4.4/5.4.  
    **Evidence:** IT17 uses a Proxy that supplies any binding; it never checks `createPlatformCoreRouteBindings`, so incorrect owner wiring can pass. Rejecting top-level `extra:true` does not prove internal write payloads/endpoints are unexposed. IT18 uses in-process dispatch rather than HTTP, creates no final conflict, and checks only nonempty receipts.  
    **Direction:** exercise actual platform bindings and exposure boundaries; send IT18 through real HTTP with a committed-disposal/final-conflict fixture and compare receipts to actual commits.

40. **must-fix — `tests/scenarios/S1-archive-restart.test.ts:126`, `:146`, `:165`: IT22–24 arm faults after startup may finish the archive.**  
    **Violates:** IT22–24; §4.2’s startup order.  
    **Evidence:** `restart({crash:true})` precedes `failCommitOf(...)`. Correct startup reconciliation then maintenance may complete the remaining responsibility/requeue/final steps before the fault exists.  
    **Direction:** hold or inject the fault before startup reaches that durable boundary.

41. **must-fix — `tests/scenarios/S1-archive-restart.test.ts:84`, `:107`, `:121`, `:141`, `:160`, `:181`: restart assertions omit original identities.**  
    **Violates:** IT19/IT21–25; §5.1; §8 rule 1.  
    **Evidence and direction:**  
    **IT19:** different runId is not a different Session; compare old-S Run inventory, original receipts, and the actual anchor ref in the successor brief.  
    **IT21:** retain original stop intent/ref/cursor and inspect old-S Runs.  
    **IT22:** compare original anchor body/cursor, not only counts.  
    **IT23:** read and compare the actual closed link/cursor; prove no reopening.  
    **IT24:** compare full original TaskRequeue/cursor and Attempt/Run/model counts; `kernelTurnsStarted` alone is insufficient.  
    **IT25:** it awaits the successful final response before claiming that response was lost. Use the lost-response boundary and compare full original archived Session/final receipt, not only `session.ref`.

42. **must-fix — `tests/scenarios/S1-wait-copy-retirement.test.ts:58`, `:76`: IT20 omits its three independent lines and actual consumption.**  
    **Violates:** IT20 and the paragraph following §5.4; §8 rules 3/11.  
    **Evidence:** one transferred source is reused as the supposed retired late-reply source. No separate retired/no-continuation late reply exists. `maintained.archived.length >= 1` does not identify the copy and can fail after proper immediate copy archive. D never legally consumes/accepts the routed response; original body, one accepted input, source dispatch exclusion, and no automatic retirement forwarding are unproved.  
    **Direction:** construct the three distinct lines and inspect their exact identities, body/ref, acceptance, archive, dispatch, and late-reply outcomes. The existing read-model-call delta check is useful.

43. **must-fix — `tests/runtime/S1-routed-replies.test.ts:57`, `:129`, `:151`, `:167`: IT28–30 substitute handcrafted mailbox state for real safe points.**  
    **Violates:** IT28–30; §2.5/5.4.  
    **Evidence:** no real D Run/backend/before_model exists. IT29’s page always has `nextCursor:null`, duplicates only the routed array, and manufactures acceptance with `accepted:true`; it does not cover outbox+routed/page duplication or formal acceptance. IT30 immediately invokes supply with a nonexistent Run, never observing an idle interval. Query/model/Task noncreation counters are absent.  
    **Direction:** use persisted routed messages and legal Runtime executions, actual pagination/overlap and input acceptance; observe idle unaccepted state, exact supply counts, and no new questions/models/Tasks/Queries.

44. **must-fix — `src/core/work-graph/persistence/execution-entry-codecs.ts:196`; `src/core/work-graph/sessions/session-record-codecs.ts:386`; `src/core/work-graph/tasks/claim-record-codecs.ts:377`: active validators are prematurely relaxed.**  
    **Violates:** book B; §2.1/3.5; §8 rule 10.  
    **Evidence:** accepted-key lists now include `anomalyAnchorRefs`, `provenance`, `archiveRequest`, and `archiveOrigin` without corresponding strict validation. `inputBindingProblem` never calls the new throwing `anomalyAnchorRefsProblem`; malformed present values can pass old validation.  
    **Direction:** defer activation of these fields until strict validation is implemented together in part 2. This confirms the substantive `inputBindingProblem` concern in (e); it also identifies two indirect validator behavior changes.

45. **must-fix — `src/app/startup-reconcile.ts:340`: step 6c implements existing startup behavior in part 1.**  
    **Violates:** book B’s existing-body prohibition.  
    **Evidence:** `runStartupReconcile` now calls maintenance and appends problems on failure whenever the hook is supplied.  
    **Direction:** keep the dependency declaration, defer the operational call/catch to part 2. §4.2 fixes eventual ordering, not a part-1 exception.

46. **must-fix — `src/core/work-graph/tasks/run-state-service.ts:861`: the existing reader reports unverified absence.**  
    **Violates:** book B; §2.7; §8 rule 6.  
    **Evidence:** `readContinuationBasis` now returns `pendingAnomalies: []` without reading anchors.  
    **Direction:** leave the optional field absent during part 1; populate it from actual complete durable reads in part 2.

47. **must-fix — `src/composition/create-platform.ts:380`, `:469`; `tests/state/invariants.ts:284`: required registration/injection is incomplete.**  
    **Violates:** §0.2 L1; §2.8/3.3; book B(e).  
    **Evidence:** `createQueryExecution` receives no `sessionFacts` despite the shared instance being constructed. `SESSION_ANOMALY_RECORD_SCHEMAS` is not included in either production or invariant-world schema assembly, leaving the new aggregate/event and two indexes unregistered.  
    **Direction:** complete the mandated composition and schema wiring now; retain stub behavior until part 2.

48. **should-fix — `src/ui/api/routes.ts:90`: a minimal type-forced change remains outside the declared scope.**  
    **Violates:** §6/book write scope.  
    **Evidence:** eleven labels were added to the total `Record<CoreRouteSuffix,string>` after the union expanded.  
    **Direction:** record the narrow scope exception with the lead. This is the minimal completeness change forced by the type; it introduces no UI action or function-body behavior.

For the remaining scope questions: `src/core/work-graph/queries/contracts.ts` contains only the requested import/optional `sessionFacts` dependency, explicitly authorized by book B(c). `deriveReworkClass` adds the fourth parameter and `void archive`; that is syntactically added body text, but it implements no new classification behavior. The new `state-writes` protections use named decoder allowances, without a whole-file exemption.

The following inventory distinguishes **IDs present** from **rows actually covered correctly**. “Checked” means reviewed against the frozen row, not executed. Paths are under `tests/`.

| Test file | IDs found = expected | Rows checked | Declared runs |
|---|---|---:|---:|
| state/S1-session-archive.test.ts | UT01–10,49–50,54–56 | 15 | 15 |
| state/S1-responsibility.test.ts | UT11–15,51 | 6 | 6 |
| state/S1-anomaly.test.ts | UT16–22,42,48 | 9 | 9 |
| state/S1-message-routing.test.ts | UT23–25 | 3 | 3 |
| state/S1-dispatch.test.ts | UT26–31,43–47,52–53 | 13 | 13 |
| state/S1-archive-rework.test.ts | UT32–35 | 4 | 4 |
| business/S1-task-order.test.ts | UT36–41 | 6 | 6 |
| work-graph/S1-codecs-indexes.test.ts | SV01–05,42–44 | 8 | 16 |
| work-graph/S1-session-facts.test.ts | SV06–11,53 | 7 | 14 |
| work-graph/S1-provenance.test.ts | SV12–15,45–46 | 6 | 12 |
| work-graph/S1-responsibility.test.ts | SV16–20,47 | 6 | 12 |
| work-graph/S1-archive-owner.test.ts | SV21–25,56,60–61 | 8 | 16 |
| work-graph/S1-anomaly-owner.test.ts | SV26–29 | 4 | 8 |
| work-graph/S1-wait-disposal.test.ts | SV30–34,54–55 | 7 | 14 |
| work-graph/S1-requeue.test.ts | SV35–38,48–50,57,59 | 9 | 18 |
| work-graph/S1-dispatch-guards.test.ts | SV39–41,51–52,58 | 6 | 12 |
| runtime/S1-archive-files-brief.test.ts | IT01–05,32 | 6 | 6 |
| business/S1-session-maintenance.test.ts | IT06–11,31,33–34 | 9 | 9 |
| business/S1-archive-flow.test.ts | IT12–16,26–27 | 7 | 7 |
| app/S1-session-routes.test.ts | IT17–18 | 2 | 2 |
| scenarios/S1-archive-restart.test.ts | IT19,21–25 | 6 | 6 |
| scenarios/S1-wait-copy-retirement.test.ts | IT20 | 1 | 1 |
| runtime/S1-routed-replies.test.ts | IT28–30 | 3 | 3 |
| **New-test total** | **UT01–56 / SV01–61 / IT01–34; no missing or extra IDs** | **151** | **212** |
| state/session-availability.test.ts | Expected three-event extension present; oracle incomplete | 3 added events × 41 states, plus affected old assertions | Matrix has 28 event fixtures |
| state/message-machine.test.ts | Expected one-event extension present; oracle incorrect/inconsistent | 6 added matrix cells plus affected context/property paths | Matrix has 54 cells |
| state/invariants.ts | Six required S1 rules assessed; two missing | 6 rules | Support file |
| architecture/state-writes.test.ts | Required field/anchor protections present; named allowances retained | Entire changed protection/allowance diff | Existing gate |