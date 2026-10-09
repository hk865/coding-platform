**Do not freeze these tests yet.** Several fixtures and assertions conflict with the specified behavior; a correct `src`-only implementation cannot make them all pass. The reported stub failures conceal many of these later failures.

This was a static, read-only review against `48c8d473`. I did not modify files or run tests, Node, npm, or scripts. Paths below are relative to the checkout.

**Findings, ordered by impact**

1. **must-fix — SV50/SV59 require a field absent from the refusal contract.**  
   `tests/work-graph/S1-requeue.test.ts:633`, `:678`; **§5.3 SV50/SV59; §2.1**. Both require `refusal.automation`. `TaskReworkRefusalSnapshotV1` at `src/contracts/task-requeue.ts:227`, its constructor, and its closed codec do not carry that field. The correction’s “keep the expectation” and the frozen contract therefore disagree.  
   **Direction:** resolve the observation contract before freezing: assert the existing refusal plus the counter/class facts through their specified observation path, or explicitly amend the contract. Do not require part 2 to invent an undeclared persisted field.

2. **must-fix — SV49/SV50/SV59 require zero captures after setup has already captured.**  
   `tests/work-graph/S1-requeue.test.ts:619`, `:638`, `:683`; **§5.1/G4**. `growChain()` performs successful ordinary requeues, whose source callback appends to `f.captures` at `:215`. The later assertion is `expect(f.captures).toEqual([])`.  
   **Direction:** record the count after setup and assert that the tested refusal adds no captures.

3. **must-fix — IT03/IT05 use invalid anchor identities; IT05 requests nine anchors for one Run.**  
   `tests/runtime/S1-archive-files-brief.test.ts:399`; **§2.3, §2.6; IT03/IT05**. The loop repeatedly records an anchor for the same `r0`, with `subjectKey` formed as `index + ':' + canonicalJson(r0)` at `:402`. The specification requires the canonical RunRef and at most one immutable anchor per Run.  
   **Direction:** use the prescribed identity and distinct execution histories for the nine-anchor case.

4. **must-fix — IT03/IT05 subsequently claim the still-archiving source Session.**  
   `tests/runtime/S1-archive-files-brief.test.ts:433`; **S1-DISPATCH-01; IT03/IT05**. `base.buildRequest()` defaults to S, whose archive request has not been finished or released. Correct admission must return `busy`.  
   **Direction:** finish the archive and construct the specified legal successor claim in another Session before preparation.

5. **must-fix — SV12/SV13 cannot backfill through the composed directory.**  
   `tests/work-graph/S1-provenance.test.ts:264`; **§3.3, S1-SES-02**. Backfill calls `base.sessionsPort`, constructed without `legacyProvenance` in `tests/helpers/task-claim-fixture.ts:233`; the real reader created at `S1-provenance.test.ts:155` is not injected there. The specification requires `unsupported` without that dependency.  
   Furthermore, `createChild()` at `:224` uses today’s admission. Correct part 2 gives it `provenance: new`, so it cannot be the null-provenance legacy record required by SV12/SV13. This also undermines SV15/SV45/SV46’s legacy givens.  
   **Direction:** use permitted old-format fixtures and inject the real provenance reader into the directory being tested.

6. **must-fix — SV04’s copy message names a different Session from the creation request.**  
   `tests/work-graph/S1-codecs-indexes.test.ts:495`, `:523`; **§2.2; SV04**. `plannedCopy` is derived from `s1-sv04-copy-1`, but admission uses `s1-sv04-admit-copy-1`. The fixed message derivation therefore cannot match the actual planned child.  
   **Direction:** derive both from the same actual creation identity.

7. **must-fix — maintenance’s due-archive cases leave S occupied.**  
   `tests/business/S1-session-maintenance.test.ts:196`, `:617`, `:629`, `:722`; **S1-AUTO-01; IT06–08/IT31**. The B2 fixture immediately claims Task A in S. Closing B or C does not stop that Run or release S. IT07/IT08/IT31 nevertheless expect S to archive. IT06 can pass solely because S is occupied, without testing the threshold.  
   **Direction:** establish the specified idle executor history before measuring the deadline.

8. **must-fix — IT10 clears occupancy without stopping its writer; IT33 asserts the wrong Task phase.**  
   `tests/business/S1-session-maintenance.test.ts:561`, `:685`, `:761`; **S1-ANCHOR-01, S1-LINK-01/02; IT10/IT33**. IT10’s retirement helper only overwrites Session health/occupancy, leaving the Run/Attempt/Lease live, then expects an anchor and responsibility disposal. IT33 expects Task A to be `pending`, although the fixture’s existing starting Run makes its actual phase `running`.  
   **Direction:** produce stopped execution facts through the owner; use an execution-free Task for IT33 or compare its actual unchanged phase.

9. **must-fix — IT13/IT16/IT27 never complete the requested stop.**  
   `tests/business/S1-archive-flow.test.ts:505`, `:553`, `:598`; **§4.1; IT13/IT16/IT27**. Each enters a Run, calls `archiveLine`, then expects final disposal or re-dispatch. The real control owner queues an intent; no terminal observation, reconciliation, or archive continuation follows. `{status:'ready'}` at `:559`/`:609` also accepts a pending result.  
   **Direction:** observe the real stop, continue the durable request, and require the expected final state before dispatch.

10. **must-fix — IT14 expects an answering Query to finish without saving an answer.**  
    `tests/business/S1-archive-flow.test.ts:389`, `:526`; **§4.1; IT14; G1**. The helper raw-writes a QueryRun while the original Work occupancy remains. After the pending assertion, only a comment says the answer is saved; `continueArchiveLine` immediately follows and must supposedly return archived.  
    **Direction:** build a real Query execution, persist its answer/terminal facts, then continue the archive.

11. **must-fix — IT26’s unknown-outcome fixture is not resolvable by the real attestation owner.**  
    `tests/business/S1-archive-flow.test.ts:410`, `:583`; **IT15/IT26; G1**. The helper changes only the Run to `outcome_unknown`; its Attempt remains started. `resolveUnknownRun` performs `attempt_resolved`, which rejects a started Attempt (`src/core/work-graph/state/attempt-machine.ts:536`). The analogous helper at `tests/business/S1-session-maintenance.test.ts:572` also makes IT34 inconsistent.  
    **Direction:** establish the paired unknown Run/Attempt/Outbox state through real reconciliation.

12. **must-fix — SV37 asks final archive to dispose an open responsibility.**  
    `tests/work-graph/S1-requeue.test.ts:549`; **S1-SES-04; SV37**. It opens a responsibility, registers R and records an anchor, then directly calls `finishSessionArchive`. No responsibility-close owner runs. Correct final archive must refuse the open link.  
    **Direction:** perform the real disposal first, then assert the archived Session, exactly one anchor, closed link, unchanged `paused_interrupted` Task, and zero requeues.

13. **must-fix — SV33/SV34 never create the retired, late-reply history.**  
    `tests/work-graph/S1-wait-disposal.test.ts:480`, `:507`; **§2.5, S1-SES-04; SV33/SV34**. S is never retired; the response is saved before archive; the yielded wait remains undisposed. Final archive is nevertheless expected to commit. SV33 also requires its disposition to remain null.  
    **Direction:** create actual retirement facts, archive under the retired exception, and save the late response afterward.

14. **must-fix — SV35/SV38 do not prove that this archive caused the cancellation.**  
    `tests/work-graph/S1-requeue.test.ts:507`, `:568`; **S1-TASK-01; §3.5**. They record `run_cancelled` before registering R and have no matching archive control intent. A cancellation reason mentioning archive is not the required same-request evidence.  
    **Direction:** register R, submit its deterministic control, observe that stop, and then record the anchor/requeue.

15. **must-fix — SV22 races a different Session and changes the required conflict oracle.**  
    `tests/work-graph/S1-archive-owner.test.ts:452`, `:466`, `:474`; **SV22; §3.4**. S’s Run is already completed; the injected yield belongs to D’s second Run. The test even expects the conflict pin to name D, whereas SV22 requires S. D’s unrelated yield does not establish the specified invalidation of S’s final read.  
    **Direction:** construct the legal race on S’s relevant facts and retain the exact S conflict pin and unchanged disposed link.

16. **must-fix — SV23 compares the global read cursor as though it were message content.**  
    `tests/work-graph/S1-archive-owner.test.ts:512`; **SV23**. It compares the complete `readMany` result before and after a successful final commit. That result includes global `readThrough`, which the archive event advances even when the message bytes are unchanged.  
    **Direction:** compare the exact encoded message separately from the store cursor.

17. **must-fix — SV61 expects pending after a committed substep followed by failure.**  
    `tests/work-graph/S1-archive-owner.test.ts:313`, `:633`; **§4.1**. The injected control commit returns `unavailable` after R has committed, but the assertion requires `state:'pending'`. The specified result is `partial`, retaining the rejection and receipts.  
    **Direction:** assert the specified partial failure. Also replace SV60/SV61’s wait choices at `:602`/`:630`: neither running Run has the named yielded wait.

18. **must-fix — restart tests demand replay receipts from the non-replaying continuation path.**  
    `tests/scenarios/S1-archive-restart.test.ts:109`, `:168`, `:205`, `:235`, `:271`; **§4.2; IT21–24**. After startup maintenance finishes and clears R, `continueArchiveLine` must return current archived state with `receipts: []`. These tests demand original receipts from that call.  
    **Direction:** replay the original `archiveLine` GraphWrite to verify original receipts; separately verify continuation’s current-state result.

19. **must-fix — IT18 still installs its final fault too late.**  
    `tests/app/S1-session-routes.test.ts:180`; **§4.2 startup order; IT18**. Restart occurs before fault installation. Startup maintenance can already finish the archive, making the later expected partial result impossible.  
    **Direction:** arm the fault before restarting.

20. **must-fix — IT20 still equates answering with consuming and archives an undisposed ordinary wait.**  
    `tests/scenarios/S1-wait-copy-retirement.test.ts:122`, `:165`; **IT20; §2.5**. Consultation produces the response, but no subsequent D execution/safe point consumes it before the acceptance assertion. The third line saves its reply before calling an ordinary archive helper; it is neither retired nor relieved of its wait. The copy branch also expects maintenance to newly report a copy that correct consultation completion may already have archived (`:151`).  
    **Direction:** establish the three independent histories and distinguish response persistence, response consumption, retirement, and already-completed copy archive.

21. **must-fix — S1-5 can reject a correct multi-commit archive.**  
    `tests/state/invariants.ts:2197`; **§5.1; book D**. Whenever an anchor appears between snapshots, any Task phase change is attributed to that anchor. Scenario restart checks span reconciliation plus maintenance (`tests/scenarios/harness.ts:541`, `:851`). In IT22, that interval legitimately stops the Run and then records an anchor.  
    **Direction:** check phase preservation across the actual anchor mutation, not across unrelated stop/requeue commits.

22. **must-fix — SV10’s pagination fixture contains dangling execution references.**  
    `tests/work-graph/S1-session-facts.test.ts:216`; **§3.3; SV10**. It creates 2,500 Outbox candidates without their Run/Attempt records, then requires `session_facts_page_limit:`. A compliant reader can encounter a missing Run and correctly reject before reaching that page-limit condition.  
    **Direction:** supply complete valid execution candidates so pagination is the only failure being tested.

23. **should-fix — UT34 still passes because of the unrelated human fence.**  
    `tests/state/S1-archive-rework.test.ts:141`; **UT34; correction’s unit-test bullet**. It explicitly constructs `human_only`, then obtains `forbidden` from `reworkPermission`. Removing archive-origin validation would not make that refusal disappear. The escape hatch is fixed, but the stated cause is not.  
    **Direction:** test the forged-origin rejection at the boundary that actually validates the origin, without an independent refusing fence.

24. **should-fix — SV08 still substitutes pure helpers for both claim owners.**  
    `tests/work-graph/S1-session-facts.test.ts:343`; **SV08; G6**. It calls `workClaimDispatchProblem` and `queryClaimDispatchProblem` directly. Both can return busy while real claims ignore them.  
    **Direction:** call the real Work and Query claim entries and inspect their persisted effects.

25. **should-fix — several corrected oracles remain non-discriminating.**  
    **§5.1/G4/G5**, specifically:

    - `tests/work-graph/S1-wait-disposal.test.ts:545`: SV54 compares the same port object before/after, not commits.
    - `tests/work-graph/S1-provenance.test.ts:272`: the zero-write oracle uses `base.spy`, which observes the wrapped claim service, not the provenance operation.
    - `tests/work-graph/S1-responsibility.test.ts:447`: SV19 never calls terminal-close on the failed fourth Task; its link stays open simply because it was untouched.
    - `tests/work-graph/S1-archive-owner.test.ts:615`: SV60 checks ready/no new intent but not the recovered request, original pin, returned intent/ref/cursor, or `replayed:true`. Recovery doing nothing can pass.
    - `tests/business/S1-archive-flow.test.ts:570`: a nondecreasing revision does not prove preservation of D’s history; `sessionBasis:null` is also unasserted.

    **Direction:** observe the action and durable facts named by each row, using the actual writer and independent before/after values.

26. **should-fix — SV31 does not retry or verify the failed wait-disposal step.**  
    `tests/work-graph/S1-wait-disposal.test.ts:438`; **SV31**. Recovery replays transfer and separately submits ordinary cancel; it does not retry the failed disposal or prove its original receipt, one cancellation, and `SessionFacts.wait === null`. Empty undelivered replies is insufficient.  
    **Direction:** recover the failed internal step on the same store and inspect its exact receipt and resulting wait facts.

27. **should-fix — changed-file and compatibility givens remain wrong or self-referential.**  
    `tests/runtime/S1-archive-files-brief.test.ts:149`, `:279`, `:395`; **IT01/IT04/IT05**. IT01 completes an observed failed edit using a wrong revision rather than creating an unobserved result. IT04 generates a current manifest and compares its current digest/text with itself after reload. IT05 requests a mixed-ownership warning while constructing known Kernel-only anchors.  
    **Direction:** supply the specified uncertain Kernel history, frozen old manifest expectations, and warning-bearing file facts.

28. **should-fix — routed-reply tests miss their distinguishing histories.**  
    `tests/runtime/S1-routed-replies.test.ts:209`, `:356`, `:383`; **IT28–30**. D is entered in every fixture, including IT30’s supposedly idle case. IT29 has one message and no real overlapping pagination through D’s supply sources. IT28 calls the input-supply component but does not drive the stated Kernel safe point and acceptance boundary.  
    **Direction:** establish the actual idle-to-next-execution, overlapping-page, and safe-point histories; compare Task/Query/model creation deltas where required.

29. **should-fix — IT25 still does not lose the final response.**  
    `tests/scenarios/S1-archive-restart.test.ts:285`; **IT25**. It awaits completion and calls it a lost answer; it does not drop the final response or compare the original final value/cursor with its replay.  
    **Direction:** inject response loss after the durable final commit and replay the original request.

30. **should-fix — G1 and G4 remain incomplete across the suite.**  
    Examples of prohibited aggregate setup are ordinary message/response raw writes at `tests/work-graph/S1-session-facts.test.ts:263`, `S1-wait-disposal.test.ts:192`, and `S1-dispatch-guards.test.ts:178`; forged control/reconciliation at `S1-requeue.test.ts:320`; and rewritten Run/Attempt outcomes at `:270`. These are not old-format codec fixtures or unavailable Kernel facts.

    Memory invariant helpers return without checking, including `tests/business/S1-session-maintenance.test.ts:588` and `S1-archive-flow.test.ts:464`. Service helpers call `checkAllInvariants(world)` without `prev`, so S1-5 never runs there. Many refusal/replay rows still omit reason prefixes, actual event/receipt changes, or call-count deltas.  
    **Direction:** use the available owner entries and check each relevant mutation on both backends, with correctly scoped previous worlds.

31. **should-fix — context alignment stops at the Session matrix.**  
    `tests/state/session-availability.test.ts:743`, `:1006`; `tests/state/S1-dispatch.test.ts:95`; **§5.2, correction’s context requirement**. Successful archive/acquire calls outside `CASES` still omit the new facts. UT29/UT31 calculate exceptional dispatch facts and discard them before acquisition.  
    **Direction:** carry the intended archive/dispatch facts through these narrow fixtures too. This is fixture alignment; do not change the preserved old expectations or SES-01 literal.

The correction dispositions follow. **FIXED refers to the named correction item; shared G1/G3/G4 gaps still apply where noted.** Test paths in these tables are relative to `tests/`.

| General rule | Status | Evidence |
|---|---|---|
| G1 — construct each real given through its owner | **PARTLY** | Many real actions added, but raw aggregate writes and missing stop/answer/retirement histories remain; findings 5–14, 20, 30. |
| G2 — register real-path schemas | **FIXED** for the named missing registrations | Lifecycle/message/control/query bundles added, e.g. `work-graph/S1-responsibility.test.ts:58`, `S1-anomaly-owner.test.ts:69`, `S1-wait-disposal.test.ts:79`, `S1-requeue.test.ts:88`, `business/S1-archive-flow.test.ts:105`. This does not validate unreached setup. |
| G3 — injected t0/t1 and correct identities | **PARTLY** | New owners often inject clocks; B2 paths still use `B2_AT` (`helpers/B2-execution-fixture.ts:45`, `:171`). Some lifecycle constructors receive no clock. D/r1 alignment is fixed at `work-graph/S1-wait-disposal.test.ts:187`. |
| G4 — exact refusal/replay/write/invariant observations | **PARTLY** | Some exact replay assertions added, e.g. `work-graph/S1-archive-owner.test.ts:587`; wrong counters, skipped memory checks and missing previous worlds remain. |
| G5 — no escaping or vacuous assertions | **PARTLY** | Previous silent refusal returns and dropped race rejections are repaired; port-identity and unexercised-action assertions remain. Guarded returns following a failing `expect` are not silent escapes. |
| G6 — exercise the named entry | **PARTLY** | Claim guards, Workflow selection and preparation now mostly use real entries; SV08 still calls pure helpers at `work-graph/S1-session-facts.test.ts:343`. |

| Existing-file correction | Status | Evidence |
|---|---|---|
| `state/session-availability.test.ts` — three new oracle branches | **FIXED** | `:283–329`, including missing-context refusals. |
| Same — unavailable reactivation in matrix | **FIXED** | `:278`; dedicated expectation at `:788`. |
| Same — ordinary facts in `CASES` | **FIXED** | `:170–188`. Calls outside the matrix remain finding 31. |
| Same — machine fixture/projected creation fields, preserve raw SES-01 literal | **FIXED** | Null fields at `:77`, `:238`; literal and key order preserved at `:985–996`. |
| `state/message-machine.test.ts` — six new cells, sender Session, accepted-response context | **FIXED** | Context `:179–187`; cells `:258–316`; existing cells unchanged. |
| `state/invariants.ts` — emit S1-5 and check across steps | **PARTLY** | Added at `:2194–2218`, but phase attribution is too broad and service callers omit previous worlds. |
| Same — anomaly schema/read support | **FIXED** | `:293`, `:407`. |
| `architecture/state-writes.test.ts` — book D protections and narrow decoder allowances | **FIXED** | New fields/anchor protection `:78–115`; named decoder allowances `:171–173`; no new whole-file allowance. |

| Unit-file correction | Status | Evidence |
|---|---|---|
| `state/S1-archive-rework.test.ts` — UT34/35 refusal existence | **FIXED** | Explicit failures at `:153`, `:169`. |
| Same — UT34 refusal caused by forged archive origin | **NOT FIXED** | `:141–155` still obtains refusal through `human_only`. |
| `state/S1-responsibility.test.ts` — UT14 retired destination | **FIXED** | `:154` uses unavailable/`kernel_turn_open`. |
| `state/S1-session-archive.test.ts` — UT05 retired facts | **FIXED** | `:140–145`. |
| Same — UT09 non-self predecessor | **FIXED** | Distinct predecessor at `:34`, used by the continuation fixture. |
| `business/S1-task-order.test.ts` — UT39 real selection of B | **FIXED** | Real Workflow call `:108`; exact B assertion `:150`. |
| Same — UT40 independent snapshots | **FIXED** | `structuredClone` at `:158–162`. |

| Service-file correction | Status | Evidence |
|---|---|---|
| `work-graph/S1-codecs-indexes.test.ts` — SV01 old Operation/old bytes | **FIXED** | Frozen encodings `:128–162`; decoding/digest assertions `:325–349`. |
| Same — SV02 complete population/exact refs/foreign workspace | **FIXED** | `:364–414`. |
| Same — SV03 old-schema reopen and counts | **PARTLY** | Same SQLite database reopened at `:465–475`; counters observe wrapper commits, not actual before/after database totals during reopen. |
| Same — SV04 creation entries | **PARTLY** | Real entries `:522–536`; inconsistent copy identity remains. |
| Same — SV05 bad creation field/zero writes | **FIXED** | `:565–593`; actual directory writer counted. |
| Same — SV43 valid anchor except outer revision | **FIXED** | `:609–631`. |
| `work-graph/S1-session-facts.test.ts` — SV06 yielded Work/new Query | **PARTLY** | Real yield `:133–142`; Query/pointer still raw-written `:187–207`. |
| Same — SV07 reverse generation/runId history | **PARTLY** | Real second claim `:159–175`, inverse-order assertion `:333`; message/response history raw-seeded. |
| Same — SV08 response and real claim refusals | **NOT FIXED** | `:343–344` still pure helpers. |
| Same — SV09 archive-cancelled wait | **PARTLY** | Real ordinary cancel `:146–155`, response comparison `:355`; no archive request/disposal. |
| Same — SV10 complete 26-page history | **NOT FIXED** | Dangling Outboxes `:216–233`. |
| Same — SV11 reused non-null cursor | **PARTLY** | `:371–380` checks changed filter; zero-write/model observations absent. |
| Same — SV53 old Query pointer | **FIXED** | Old pointer setup `:187–207`; exact ref/no fabricated execution field `:386–393`. |
| `work-graph/S1-provenance.test.ts` — SV12 stored backfill/replay | **NOT FIXED** | Uninjected directory `:264`; non-legacy child `:224`; assertions `:370–384` cannot rescue setup. |
| Same — SV13 real reused old Session/backfill | **NOT FIXED** | Child is newly created at `:303–306`; same missing dependency. |
| Same — SV14 two successors/refs/traces | **FIXED** | Two real creations and exact direct predecessor relations `:412–425`. |
| Same — SV15 conflict | **PARTLY** | Conflicting evidence constructed `:432–440`; legacy given and zero-write counter remain wrong. |
| Same — SV45 cycle | **PARTLY** | Cycle constructed `:457–467`; legacy given/counter remain wrong. |
| Same — SV46 later link-change basis | **PARTLY** | Real close/reopen `:485–487`; newly created provenance and missing exact event-location check remain. |
| `work-graph/S1-responsibility.test.ts` — SV16 stopped source | **FIXED** | `:338–358`. |
| Same — SV17 actually running source | **FIXED** | `:365–378`. |
| Same — SV18 stopped source/real race | **FIXED** | `:386–419`; both outcomes observed. |
| Same — SV19 three terminal Tasks and failed fourth | **PARTLY** | Formal terminal histories added; fourth failed link never submitted to close at `:447–456`. |
| Same — SV20 exact links/revisions | **FIXED** | `:470–480`. |
| Same — SV47 exact links/revisions | **PARTLY** | Exact comparisons `:491–497`; foreign workspace fabricated by rewriting D at `:487`. |
| `work-graph/S1-archive-owner.test.ts` — subject keys/stored receipts | **FIXED** | `:283–294`, `:462`, `:506`, `:509`. |
| Same — SV21 formal release through final | **FIXED** | `:427–442`. |
| Same — SV22 valid S race and exact conflict/link | **NOT FIXED** | Race moved to D at `:466–474`; disposed link only checked for non-null `until`. |
| Same — SV23 disposed wait/links | **PARTLY** | Real disposal `:505–510`; whole-read comparison at `:516` is impossible. |
| Same — SV24 preserve original pins/change choices | **FIXED** | `:523–543`. |
| Same — SV25 release before final/replay old result | **FIXED** | `:554–565`. |
| Same — SV56 release and zero new writes | **FIXED** | `:576–589`, using actual writer counter. |
| Same — SV60 real control/lost response/original replay | **PARTLY** | Real durable commit before response loss `:174–178`; recovery’s essential input/result assertions absent at `:615–620`. |
| Same — SV61 different legal control | **PARTLY** | Real pause `:641–646`; invalid wait given and wrong initial pending expectation remain. |
| `work-graph/S1-anomaly-owner.test.ts` — SV26 real R/stopped Run/count/replay | **FIXED** | `:284–310` establishes and compares the stored anchor, cursor and cleared-R replay. |
| Same — SV27 unavailable file facts/stored anchor | **FIXED** | `:315–327`. |
| Same — SV28 exact common anchor from both indexes | **FIXED** | `:331–352`. |
| Same — SV29 satisfied Task/zero anchor/correct next | **FIXED** | Formal satisfaction `:202–231`, `:361`; null label/next and empty pending `:370–384`. |
| `work-graph/S1-wait-disposal.test.ts` — SV30 transfer before reply/accept once | **PARTLY** | `:401–425`; original wait cancellation and full replay receipt remain unchecked. |
| Same — SV31 same-store recovery | **PARTLY** | SQLite reopen fixed `:331–338`; failed disposal itself is not recovered at `:438–449`. |
| Same — SV32 existing response consumed by D | **PARTLY** | Exact response retained `:455–476`; actual D consumption missing. |
| Same — SV33 retired/no-continuation late reply | **NOT FIXED** | `:480–504`. |
| Same — SV34 retired/continuation late reply | **PARTLY** | Continuation exists; retirement and temporal ordering absent `:507–530`. |
| Same — SV54 real ownership/zero writes | **PARTLY** | Ownership fixed; port-identity zero-write assertion `:545–553`. |
| Same — SV55 actual acceptance facts/exact refs | **PARTLY** | Exact refs/count `:569–578`; actual Kernel input-accepted observation still absent. |
| `work-graph/S1-requeue.test.ts` — SV35 real archive origin/cap history | **PARTLY** | Real R/anchor `:511–520`; no same-R stop proof or prior-count-three history. |
| Same — SV36 nonexistent request origin | **PARTLY** | `:523–537`; negative target exists, but full refusal/no-write observations absent. |
| Same — SV37 retired paused archive | **NOT FIXED** | `:540–561`; missing link disposal and required final fact assertions. |
| Same — SV38 existing requeue recovery | **PARTLY** | Original value compared `:571–581`; stop proof and replay/cursor/creation-count observations missing. |
| Same — SV48 absent anchor with real R | **PARTLY** | `:591–600`; full refusal/no-write observations absent. |
| Same — SV49 r2 pin before anchor mismatch | **PARTLY** | Correct request target at `:615`; impossible capture assertion `:619`; r0 anchor setup also needs matching R execution evidence. |
| Same — SV50 real prior count three | **PARTLY** | Three real requeues at `:629`; latest Run is cancelled, not ordinary failed; refusal shape/capture assertions remain invalid. |
| Same — SV57 real archive wait origin | **PARTLY** | Yield/R/control/disposal `:645–654`; raw message and missing persisted zero-anchor/no-ConsumedWait checks remain. |
| Same — SV59 ordinary failure before retirement | **PARTLY** | Prior chain/R/anchor added; ordinary failure raw-rewritten at `:270–298`; unsupported refusal shape remains. |
| `work-graph/S1-dispatch-guards.test.ts` — SV39/40/51/52/58 real claim entries | **PARTLY** | Entries now real (`:338–390`, `:433–490`); several ordinary message/response givens still raw-written. SV52’s specific real-R setup is fixed. |
| Same — SV41 real consumed wait/race/no dropped rejection | **PARTLY** | `Promise.all` and exactly one winner `:393–427`; final occupancy assertion at `:429` does not establish the required R/claim/Lease/Run relationship. |

| Integration/scenario correction | Status | Evidence |
|---|---|---|
| `business/S1-session-maintenance.test.ts` — real responsibility reader | **FIXED** | `:219–221`. |
| Same — IT06/07 idle terminal history | **PARTLY** | Real closes added; initial r0 occupancy remains `:603–624`. |
| Same — IT08 new Task/new finish time | **PARTLY** | Actions added `:632–650`; occupied S still prevents archive. |
| Same — IT09 five non-executor idle histories | **FIXED** | `:660–678`. |
| Same — IT10 drop/anchor | **PARTLY** | Assertions `:693–698`; no stopped writer. |
| Same — IT11 answered copy/running source | **PARTLY** | Real creation/answer path and source enter added; required complete observations/invariants remain absent. |
| Same — IT31 later plan change | **PARTLY** | Real close/change `:722–726`; original occupancy remains. |
| Same — IT33 initial link/current phase | **PARTLY** | Initial-link creation `:309–324`, graph reread `:759`; wrong pending assertion `:761`. |
| Same — IT34 all zero-commit items/model count | **PARTLY** | Selected facts checked `:775–794`; inconsistent unknown state and missing event/receipt totals. |
| Same — zero model-call assertions | **FIXED** | Added for all nine rows, e.g. `:612`, `:624`, `:794`. |
| `business/S1-archive-flow.test.ts` — IT12 real entered Work/choices | **FIXED** | `:487–500`. |
| Same — IT13 stop/anchor/drop before final fault | **NOT FIXED** | `:505–514`. |
| Same — IT14 real answering Query/answer | **NOT FIXED** | `:389–407`, `:526–528`. |
| Same — IT15 real unknown Work | **NOT FIXED** | Run-only overwrite `:410–420`. |
| Same — IT16/27 ordinary Workflow redispatch/full history | **PARTLY** | Real Workflow path `:423–455`; missing stop completion and history/sessionBasis observations. |
| Same — IT26 real attestation | **PARTLY** | Real owner at `:583–585`; invalid paired setup prevents success. |
| `runtime/S1-archive-files-brief.test.ts` — IT01 uncertain Kernel history | **NOT FIXED** | Completed failed edit `:149–165`. |
| Same — IT02 missing Kernel/worktree/warning | **FIXED** | `:237–244`. |
| Same — IT32 not-entered/no capture | **FIXED** | `:248–257`. |
| Same — IT03 repeated real preparation/binding | **PARTLY** | Target assertions `:264–275`; invalid shared setup. |
| Same — IT04 old manifest | **NOT FIXED** | Current-data self-comparison `:279–288`. |
| Same — IT05 ninth anchor/warning/fixed sentence | **PARTLY** | Assertions added `:295–308`; anchor identities/history and warning facts are wrong. |
| `runtime/S1-routed-replies.test.ts` — persisted messages/real D | **FIXED** | `:190–209`, `:238–255`. |
| Same — IT28 actual safe-point supply/acceptance | **PARTLY** | Production supply called `:333–343`; full safe-point boundary absent. |
| Same — IT29 overlap/pagination/acceptance | **PARTLY** | Real acceptance `:370–377`; no overlapping multi-page given. |
| Same — IT30 idle then next execution | **NOT FIXED** | D already entered at `:209`, reused at `:393`. |
| Same — Task/Query/model creation counts | **PARTLY** | Actual counters `:146–160`; all three compared only in IT30. |
| `app/S1-session-routes.test.ts` — IT17 real bindings | **FIXED** | Concrete spies and real binding constructor `:110–129`; Proxy removed. |
| Same — IT18 HTTP/disposal/conflict/real receipts | **PARTLY** | HTTP and receipt comparisons `:171–221`; final fault still installed after restart. |
| `scenarios/S1-archive-restart.test.ts` — arm faults before restart | **FIXED** | IT22–24 at `:184`, `:218`, `:249`. |
| Same — IT19 exact request/successor facts | **PARTLY** | Receipt-to-anchor `:134–141`; no exact successor-Session exclusion or anchor-ref comparison. |
| Same — IT21 original stop identity | **PARTLY** | Identity comparisons `:158–169`; wrong post-final receipt path. |
| Same — IT22 original anchor/body/cursor | **PARTLY** | Comparisons `:198–207`; wrong receipt path and invariant interval. |
| Same — IT23 original closed-link cursor | **PARTLY** | Receipt comparison `:229–235`; actual link interval/revision not compared. |
| Same — IT24 full requeue and creation counts | **PARTLY** | Added `:260–275`; wrong post-final receipt path. |
| Same — IT25 lose final response | **NOT FIXED** | `:285–299` has no final response loss or original final replay baseline. |
| `scenarios/S1-wait-copy-retirement.test.ts` — three independent lines | **PARTLY** | Separate structures exist; their consumption/retirement histories remain wrong. |
| Same — transferred wait consumed by D | **NOT FIXED** | `:122–125` substitutes answering for consumption. |
| Same — answered copy archived | **PARTLY** | Real consultation `:135–142`; maintenance assertion `:151` ignores archive-at-attachment behavior. |
| Same — retired independent line/late response | **NOT FIXED** | `:165–185`. |
| Same — reads/refresh add zero model calls | **FIXED** | `:187–193`. |
| Production wiring — shared facts into Query execution and anomaly schemas | **FIXED** | `src/composition/create-platform.ts:389`, `:398`, `:407`, `:476`. |