**Do not freeze this part-1 baseline yet.** The consultation regression and duplicate-start race are fixed. Several tests still reject conforming behavior or omit their distinguishing assertions. **AP07 and RC05 fail because of invalid adoption fixtures, not stubs.**

I verified HEAD `48c8d473`. This review used read-only inspection; I ran no tests, Node, npm, or package scripts. Reported execution results remain implementer-provided evidence.

For compact file:line references below:

- `WG` = `src/core/work-graph/`.
- `F` = `tests/helpers/S5-decision-fixture.ts`.
- `SS`, `UM`, `RC`, `DQ`, `AP`, `NR` = the corresponding `tests/work-graph/S5-{goal-settings,user-messages,request-candidates,decision-queue,decision-application,notices}.test.ts`.
- `sGS`, `sMD`, `sPC`, `sNS` = `tests/state/S5-{goal-settings,message-decision,request-candidate,notice-settings}.test.ts`.
- `RT`, `TU`, `WF` = `tests/{app,runtime,business}/S5-{decision-routes,user-message-tools,decision-workflow}.test.ts`.
- `SC01`, `SC02` = `tests/scenarios/S5-{two-request-decisions,goal-conflict-rework}.test.ts`; `Support` = `tests/scenarios/support/S5-decisions.ts`.

**Previous findings**

“FIXED” includes objections explicitly settled by a binding lead decision; it does not mean deferred implementations are complete.

| # | Status | Current file:line evidence |
|---|---|---|
| 1 | **PARTLY** | `WG/state/plan-machine.ts:258,282,308` adds request/replacement/adoption inputs. `:408,508,516` still lacks the adopting-action verdict and observable old-record/slot effects. Replacement/abandonment lack actor/time. |
| 2 | **PARTLY** | Four invariant booleans removed; `WG/state/message-machine.ts:232` still exposes `receiptReadable`, contrary to A8’s service-before-state boundary. |
| 3 | **FIXED** | `src/business/workflow/consultation.ts:228,321` uses inline union discrimination; ordinary Session paths no longer call the throwing helper. |
| 4 | **FIXED** | `src/app/collaboration-driver.ts:843` awaits before the busy check; `:845–858` checks/registers synchronously. |
| 5 | **FIXED by A10** | Earlier codec/tool/pump bodies are expressly retained as early part-2 work. New behavior added during this round is separately discussed below. |
| 6 | **NOT FIXED** | `WG/sessions/message-record-codecs.ts:866` still excludes Host actors from `SessionMessageResponded`. Deferred implementation defect under A10. |
| 7 | **NOT FIXED** | `WG/configuration/project-bootstrap-record-codecs.ts:201` still casts present `decisionSettings` without validating it. Deferred under A10. |
| 8 | **PARTLY** | Single decoder implementation is now the stub at `WG/persistence/decision-record-codecs.ts:104`; sessions still re-exports it at `:72`. Wire fields still leak through round/requeue DTO decoders at `WG/persistence/evidence-record-codecs.ts:353`, `WG/tasks/claim-record-codecs.ts:617`. |
| 9 | **PARTLY** | `F:600,609` creates distinct sources and a captured basis. But keys incorporate mutable bases, captured pins omit Goal versions, and `F:653` still puts responded@2 into the Sent event. |
| 10 | **PARTLY** | SS builders fixed at `SS:253`; UM answer pins fixed at `UM:95`; RC abandonment fixed at `RC:187`. AP still adds Workspace pins at `AP:127,208`; DQ abandonment still has empty pins at `DQ:164`. |
| 11 | **PARTLY** | Services now receive the observed port (`F:157,341,668`). Most assertions still compare commit calls/submitted counts rather than persisted records/events/claims and versions. |
| 12 | **FIXED** | SS01 reads through the S5 context (`SS:101,294`); SS16 constructs S5 preparation/entry (`SS:196,215,541`). A separate new free-Session scope defect remains below. |
| 13 | **PARTLY** | SS02 now cancels/replays (`SS:312`); SS14 now exercises settings/order/pause/resume/replay (`SS:480`). Conflict-answer sequences, claim fixtures and rebase assertions remain defective. |
| 14 | **PARTLY** | SS01 checks the actual event (`SS:300`); SS04 seeds/checks risk (`SS:332,344`) but contradicts itself at `:343,346`. SS03/05 still use commit counters (`:328,353`). |
| 15 | **PARTLY** | UM operator and per-row trusted duties are supplied (`UM:43,73,76`). However, the duties property is cast into a dependency type that does not declare it (`WG/model/communication-contracts.ts:307`). |
| 16 | **FIXED** | UM08 uses a two-commit barrier (`UM:238`) and preserves the winner; UM11 rereads responded@2 and uses the same operator/current pin (`UM:294–304`). |
| 17 | **PARTLY** | UM12 now performs real ack/replay (`UM:319–325`), but still creates current mail at `:310`, rather than seeding historical absent-field data; `:328` also accepts persisted null. |
| 18 | **PARTLY** | Sender/index checks and admission improved (`UM:139,156,284`). UM03/06 omit stored Task invariants; UM07 omits the specific response event and allocation counters (`UM:169,205,228`). |
| 19 | **PARTLY** | RC03 proves fault interception (`RC:109`); RC04 checks receipt versions/slot transfer (`:140`). RC02 lacks controlled empty-slot concurrency (`:76`); RC07 lacks prescribed persisted zero-write evidence (`:204`). |
| 20 | **PARTLY** | RC05 now asserts adoption but its fixture remains inadmissible (`RC:164`, `F:570`). RC01/05 omit queue assertions; RC06 does not prove slot release; RC08 leaves a closed proposal owning its slot (`RC:222`). RC10’s foreign-read observation is fixed (`:284`). |
| 21 | **PARTLY** | AP now invokes real settings/plan owners (`AP:125,132`), but the decision service still lacks `operatorActor` (`:79`), settings pins are invalid, and captured sources cannot prove the requested changes. |
| 22 | **PARTLY** | AP01 now uses `other`, message delta and source lookup (`AP:169–178`), but still tests a candidate instead of the required **cause**, and does not inspect the unique claim. |
| 23 | **PARTLY** | AP06 injects message-commit failure (`AP:159,218`); AP13 uses another real cursor (`:274`); AP16 preserves the application (`:304`). Exact proof/changes/queue assertions and valid setup remain incomplete. |
| 24 | **PARTLY** | Real readers are wired (`DQ:109–118`). DQ01 still lacks answered planning-question and conflict facts (`:183`); DQ02 has invalid abandonment requests and no established concrete cause (`:163,193`). |
| 25 | **PARTLY** | DQ06–09 now perform pause/cancel/answer/pagination (`DQ:245–304`). DQ04 archives an occupied Session (`:149,223`); DQ05 builds its message source from an empty key (`:77`). |
| 26 | **PARTLY** | NR uses P/W and finalized predecessors (`NR:54,177,268`). Round history remains inconsistent: accumulated basis digests are discarded (`:94`), supporting Runs are absent, and finalized records use revision1. |
| 27 | **PARTLY** | Operator and real display tokens are wired (`NR:121,191`). NR04 still performs no ack and marks undisplayed pos20 (`:226`); NR06 neither saves both categories nor rereads persisted message facts (`:254–264`). |
| 28 | **PARTLY** | NR02 uses read/mark/reread; NR05 corrupts at the read boundary (`NR:185,236`). NR03 prefilters away the competing category (`:207`); NR08 inserts another record instead of changing current cap (`:288`). |
| 29 | **PARTLY** | PC06/08/10 improve retained-candidate/stale/closed checks (`sPC:208,236,261`). PC01/02/09 still omit slot effects; PC02 omits U1’s terminal result (`:156,162,251`). |
| 30 | **PARTLY** | Work-run admission, text digest and real annotation object improved (`sMD:194,251,262`). MD01 checks its own flag (`:206`); MD11 constructs and checks its own synthetic record (`:349–356`). |
| 31 | **PARTLY** | GS06 and GS15 improved (`sGS:200,297`). GS01/NS01 still use local defaults and write builders (`sGS:142`, `sNS:68`); GS14 manufactures its own proof (`sGS:282`). Several fixed identities remain wrong. |
| 32 | **PARTLY** | Real route parsing/binding with permitted recorders now works (`RT:45–96`). RT06 still manufactures its validation result (`:135–150`); RT08 lacks the requested explicit model-call observation (`:176`). |
| 33 | **FIXED** | TU01/03 invoke real owners with work-run admission (`TU:123,295,328`); counting wrappers forward calls. The undeclared duties seam remains a separate interface blocker. |
| 34 | **PARTLY** | TU05 now uses real bodies and `recordInputAccepted` (`TU:257,385`). Its ordinary work-run message is still seeded as responded@1 with another message’s source (`:274–285`). |
| 35 | **PARTLY** | TU04/06 now use real readers; TU07 has a usable profile and positive Session control (`TU:343,395,530`). TU04 silently returns on a null answer body (`:355`). |
| 36 | **FIXED** | WF01 uses B-only settings pins (`WF:196`); WF02 uses full `[B,A,C]` and all Goal pins (`:236`); idle Session creation uses S5 scope (`:136`). |
| 37 | **PARTLY** | SC01 rejects unchanged stale U2, replaces it, and uses real receipt identity (`SC01:98–117`). Its source is still manually assembled through the wrong key procedure (`Support:90`, `SC01:56`). |
| 38 | **PARTLY** | Scope exception is settled by A9; root QueryJobs, canonical annotations and readback are present (`Support:183,320`, `SC01:64,82`). Stored `candidate` status and exact formal-change count remain unasserted. |
| 39 | **PARTLY** | SC02 now performs the intended broad sequence (`SC02:58–148`), but agent admission, repeated no-progress basis and final task deletion prevent success. |
| 40 | **FIXED** | `tests/state/message-machine.test.ts:111` uses a partial historical event map; false mappings are removed and the old assertion is preserved. |
| 41 | **PARTLY** | Factories/adapters/composition exist (`WG/tasks/goal-decision-reader.ts:26`, `src/composition/create-platform.ts:522`); reader dependencies still expose transaction/commit capabilities. |
| 42 | **FIXED by A1** | Accepted extra files retain the described type/narrowing/label changes. No additional semantic weakening found in the historical orchestration assertion. |

**Binding decisions and guided items**

| Item | Status | Evidence |
|---|---|---|
| A1 | **FIXED** | Accepted extra-file changes remain within their stated purposes; historical matrix typing at `tests/state/message-machine.test.ts:111`. |
| A2 | **FIXED** | `WG/state/message-machine.ts:183`: `decision_application_recorded`. |
| A3 | **PARTLY** | `WG/state/plan-machine.ts:258,282,308` restores inputs; `:408,508` still lacks policy/output facts. |
| A4 | **FIXED** | Observable closed verdict at `WG/state/plan-machine.ts:183`; asserted at `sPC:261`. Implementation timing is an A10 issue. |
| A5 | **FIXED** | Shared Sent-event type resides in model and is re-exported without semantic duplication. |
| A6 | **PARTLY** | Factories and adapters wired at `src/composition/create-platform.ts:522`; dependencies at `WG/tasks/{goal-decision-reader,planning-question-reader}.ts:26,29` remain too broad. |
| A7 | **PARTLY** | One decoder body at `WG/persistence/decision-record-codecs.ts:104`; an additional export remains at `WG/sessions/message-record-codecs.ts:72`. |
| A8 | **PARTLY** | Forbidden invariant flags removed; `WG/state/message-machine.ts:232` retains `receiptReadable`; plan policy fact remains absent. |
| A9 | **PARTLY** | Real roots/canonical annotations fixed (`Support:183,115`); source helpers bypass the required constructor (`:90,104`). |
| A10 | **PARTLY** | Earlier bodies correctly retained; new behavior appears in `src/contracts/goal-decisions.ts:145` and `WG/state/plan-machine.ts:183,1522`. |
| B1 | **FIXED** | `src/business/workflow/consultation.ts:228,321`. |
| B2 | **FIXED** | `src/app/collaboration-driver.ts:843–858`. |
| B3 | **PARTLY** | Corrected `SS:253`, `UM:95`, `RC:187`, `WF:236`; invalid `AP:127,208`, `DQ:164`. |
| B4 | **PARTLY** | Distinct message references/bases at `F:591,609`; malformed identity construction and Sent history remain at `F:600,653`. |
| B5 | **PARTLY** | UM and NR operator setup improved (`UM:76`, `NR:121`); AP omits it (`AP:79`); duties seam is undeclared (`UM:73`, `TU:153`). |
| B6 | **PARTLY** | Attached observer at `F:157`; persisted-state and replay-allocation observations remain incomplete. |
| B7 | **FIXED** | Original SS01/SS16/WF scope errors fixed at `SS:101,215`, `WF:136`. New free-Session scope issue at `SS:181`. |
| B8 | **PARTLY** | Named sequences substantially expanded; remaining SS blockers at `SS:261,343,389,433,512`. |
| B9 | **PARTLY** | Race/late-answer corrected (`UM:238,294`); legacy fixture and Task/event assertions remain incomplete (`:310,205,228`). |
| B10 | **PARTLY** | Fault/atomic receipt fixed (`RC:109,140`); adoption, slot-release and queue coverage remain incomplete (`:164,187,64`). |
| B11 | **PARTLY** | Readers and transitions added (`DQ:109,245`); missing source facts/invalid lifecycle setup remain (`:183,223`). |
| B12 | **PARTLY** | Real receipt-producing calls added (`AP:125`), but their configuration, pins, captured proof and several assertions remain invalid. |
| B13 | **PARTLY** | Coherent scope/token plumbing improved; invalid rounds and NR04/06/08 behavior remain (`NR:94,226,260,288`). |
| B14 | **PARTLY** | Recorder routing valid at `RT:45`; RT06 remains self-fulfilling at `:137`. |
| B15 | **PARTLY** | Real owners/input acceptance and TU07 fixed (`TU:123,385,530`); fixture history and null-body skip remain (`:279,355`). |
| B16 | **FIXED** | `WF:196,236,136`. |
| B17 | **PARTLY** | SC01 replacement/receipt fixed; source/proof/assertion gaps remain. SC02 still has three independent blockers (`SC02:50,107,141`). |
| B18 | **PARTLY** | PC/MD/GS/NS improvements do not resolve remaining manufactured or missing observations (`sPC:156`, `sMD:349`, `sGS:142,282`, `sNS:68`). |
| B19 | **FIXED** | Historical event matrix and assertion preserved at `tests/state/message-machine.test.ts:111`. |

**Remaining defects**

For repair estimates, **small** means a local edit under 20 lines; **larger** means fixture/interface/shared-observation work or multiple coordinated edits. Estimates include completing the relevant assertions.

1. **Must-fix — mutable and recursively wrapped source identities.**  
   **Rows:** §3.3 keys; SS06/07/11/15, AP01/09, DQ05, SC01/02.  
   **Evidence:** [decisionSourceKey](D:/cxt/impl-s5-p1g/src/contracts/goal-decisions.ts:145) includes `pins`, `goalBases`, focal `goalRef`, and the existing `key`. The spec explicitly separates identity from CAS pins and requires the same unordered conflict pair to share an identity. Reapplying the constructor also wraps its previous output. `SS:273` and `Support:92,110` bypass it; `DQ:77` supplies an empty natural message identity.  
   **Direction:** freeze per-kind natural identity construction; exclude mutable guard facts and use the constructor consistently.  
   **Estimate:** **larger** overall; individual corrected call sites are small. **NEW production defect.**

2. **Must-fix — the plan interface cannot expose the required replacement and slot operations.**  
   **Rows:** S5-PLAN-01–04; PC01/02/08/09.  
   **Evidence:** `WG/state/plan-machine.ts:508–516` has one `next` and a payload-free `write_proposal`; replacement/abandonment inputs at `:282,317` lack the actor/time required by `notAdopted`. The adopting-action policy verdict is absent at `:408`.  
   **Direction:** retain `next = U3`; add narrow effects carrying transitioned U1 and slot create/transfer/release, plus actor/time inputs. Add the §3.2 verdict without weakening existing adoption guards. PC08 can then assert its complete terminal value. A generic multiple-`next` redesign is unnecessary.  
   **Estimate:** policy-field addition **small**; complete interface/effects/tests **larger**.

3. **Must-fix — authority configuration is still incomplete.**  
   **Rows:** AP answer/application rows; UM01–05; TU01/03.  
   **Evidence:** `AP:79` omits the decision service’s `operatorActor`; configuring the fixture or mailbox `systemActor` does not configure that service. `UM:73` and `TU:153` cast a guessed `duties` property into `SessionMailboxDependencies`, whose declaration at `WG/model/communication-contracts.ts:307` has no such seam.  
   **Direction:** supply the AP operator and freeze a typed trusted-duties dependency used consistently by owners/tests/composition.  
   **Estimate:** AP operator **small**; coordinated duties seam **larger**. The concealed, undeclared dependency is a **NEW round defect**.

4. **Must-fix — requests still violate exact pin sets.**  
   **Rows:** AP02–07/09/12–16; DQ02; RT06.  
   **Evidence:** `AP:127` adds Workspace to reorder pins; `AP:208` adds Workspace to settings pins. `DQ:164` abandons with `expected: []`. `RT:143` pins Goal B instead of Workspace.  
   **Direction:** use precisely §3.3:625’s sets, then assert setup results before continuing.  
   **Estimate:** **small per helper**; RT06’s complete repair is larger below.

5. **Must-fix — answer fixtures still contain impossible history and insufficient captured versions.**  
   **Rows:** SS11/15, AP09, TU04/05; §2.3/2.8.  
   **Evidence:** `F:653` still records `SessionMessageSent` with responded@2. `F:581` captures only PB1, while later tests require captured Goal B@7 and settings changes to Goals A/B. `F:643` adds a basis but no captured Goal pin. `TU:279` separately seeds an ordinary nonsynthetic work-run message directly as responded@1 and reuses another message’s source at `:274`.  
   **Direction:** build valid sent→answered snapshots/events, correct message identities, and the actual captured pins/bases required by each operation.  
   **Estimate:** **larger shared fixture repair**; TU’s wrong revision/source is locally small once shared construction is sound.

6. **Must-fix — AP07 and RC05 use a permanently inadmissible future-plan candidate.**  
   **Rows:** AP07, RC05; A3.  
   **Evidence:** `F:274–276,570` gives U1 a schema-1 draft targeting existing PB1 at planRevision1. `AP:133–136` supplies nonempty decision references; `RC:164–166` supplies none. Existing `WG/state/plan-machine.ts:1319–1326` rejects these paths as unsupported/incomplete. Merely changing schema still violates source+1/new-plan-ID checks at `:1336–1340`.  
   **Direction:** use an actually adoptable future revision with a new Plan identity and supported delta, retaining the old guards.  
   **Estimate:** **larger**. These AssertionErrors must not be classified as harmless missing-stub results.

7. **Must-fix — AP rows still do not establish or verify their formal proof.**  
   **Rows:** AP01/03/06/07/09/16.  
   **Evidence:** AP01 remains a candidate rather than a cause (`AP:169`). AP03 accepts any increasing revisions (`:194–196`) and never checks the pending-application decrement. AP06 does not prove its failure hook was reached or inspect the intermediate queue. AP07’s later mutation reconstructs the old fixture Goal (`:148–152,236`), potentially restoring PB1 after adoption. AP09 does not compare the complete application against the actual receipt proof (`:261–263`).  
   **Direction:** use the specified cause, genuine acknowledged changes matching captured objects, an observed injected failure, a legitimate later owner mutation, and exact changes/proof/queue assertions.  
   **Estimate:** **larger**.

8. **Must-fix — SS conflict tests still lack the answered conflict they claim to apply.**  
   **Rows:** SS06/07/11/12/15.  
   **Evidence:** `SS:261` always acknowledges the shared **message** answer; `SS:269` independently invents a conflict source. SS11/12/15 pause/resume but never answer that conflict. Their initial B plan has no module-M overlap (`F:404`).  
   **Direction:** establish an actual conflict, answer its canonical source with captured bases, then perform the specified control/settings sequence. Do not reuse an unrelated PB1 message answer.  
   **Estimate:** **larger**.

9. **Must-fix — new SS expectations contradict the specified result.**  
   **Rows:** SS04, SS11, SS15.  
   **Evidence:** `SS:343` expects returned A order1, but `:346` expects persisted A order0. `SS:447,529` compares captured rebase `basis` against `basisB(x)` **after** parallel risk was written; that helper includes current settings (`:263–266`), whereas the proof must retain the pre-change basis.  
   **Direction:** assert persisted A order1 and capture the expected basis before applying the change.  
   **Estimate:** **small per row**. **NEW contradictions.**

10. **Must-fix — the new free-Task claim fixture creates its Session in the wrong project.**  
    **Rows:** SS08/09/13.  
    **Evidence:** `SS:181` calls `b2.base.createSession`; that helper closes over the original `r4c-claim-*` scope (`tests/helpers/task-claim-fixture.ts:297`). These tests then claim under P/W. `WG/tasks/claim-service.ts:494` rejects the foreign Session before the intended stale/wait behavior. SS08 also submits the claim after settings complete instead of controlling two in-flight operations.  
    **Direction:** create/read the free Session through the S5 directory and arrange the specified commit ordering; inspect both lease and Run preservation.  
    **Estimate:** **larger**. The newly added free-Session helper introduces a **NEW scope defect**.

11. **Must-fix — zero-write and replay evidence remains below §5.1.**  
    **Rows:** SS03/05/08/12/16, UM07, RC07/09/11, AP rejection/replay rows, DQ09.  
    **Evidence:** `F:157–168` counts calls; `UM:82` counts submitted records/events/claims. Assertions such as `SS:328`, `RC:209`, `AP:202`, `DQ:304` do not provide the prescribed persisted before/after counts and versions. Several replay rows omit unchanged clock/ID/body/model counters.  
    **Direction:** add shared snapshots over the actual injected store and the required allocation observations. Keep actual receipt cursor/value comparisons.  
    **Estimate:** **larger shared helper work**.

12. **Must-fix — UM12 is genuine ack replay, but not historical compatibility coverage.**  
    **Rows:** UM12; also UM03/06/07 assertion gaps.  
    **Evidence:** `UM:310` uses the current sender; `:324` compares against this execution’s first result; `:328` treats absent and null `since` alike. UM03/06 do not reread Task state, and UM07 does not identify the one response event.  
    **Direction:** seed genuine old absent-field wire data, compare frozen old DTO/receipt semantics, assert strict absence/no new claims and replay allocations; add stored Task/event observations.  
    **Estimate:** **larger**.

13. **Must-fix — request-candidate tests still allow slot/queue bugs to pass.**  
    **Rows:** RC01/02/05/06/08/09/11.  
    **Evidence:** RC01’s enumeration is not a queue read (`RC:64`); RC05 omits regenerate/abandon actions (`:172`). RC06 observes `head:null`, not released ownership (`:197`). RC08 closes U1 without releasing its seeded unique claim (`:222`). RC02’s `Promise.all` does not enforce two empty-slot readers (`:76`).  
    **Direction:** inspect real queue cards/actions, prove slot release—e.g. through legitimate subsequent ownership—and seed closed history with consistent claims. Control the race.  
    **Estimate:** queue/race assertions **small with shared helpers**; consistent slot/history repair **larger**.

14. **Must-fix — DQ preconditions remain missing or inadmissible.**  
    **Rows:** DQ01/02/04/05/07.  
    **Evidence:** DQ01 has no answered planning Query or overlap (`DQ:183`, `F:553–567,404`); checking six total cards cannot establish the six required kinds. DQ02 ignores failed abandonment setup. DQ04 archives S while RA remains running (`DQ:223`, `F:541`); `WG/state/session-availability.ts:623` rejects occupied Sessions. DQ05’s new source omits its message identity (`DQ:77`). DQ07 checks only one closed history item.  
    **Direction:** seed each actual source, settle the sender’s Run before archive, use the message’s canonical identity, and assert all specified count/action changes.  
    **Estimate:** DQ05 identity **small**; other fixture/lifecycle work **larger**. The newly attempted occupied archive is a **NEW blocker**.

15. **Must-fix — notice chains are codec-accepted but not production-consistent.**  
    **Rows:** NR01/07/08.  
    **Evidence:** `NR:94` discards accumulated basis digests; the real successor construction appends predecessor history (`WG/state/verification-machine.ts:650`). `NR:96–98` uses placeholder proof/configuration and revision1 finalized rounds; supporting Runs are not seeded. NR07 also omits the task-head-only-R4 assertion.  
    **Direction:** seed coherent supporting facts and a possible successor chain, retaining accumulated history and correct revisions.  
    **Estimate:** **larger**.

16. **Must-fix — NR04/06 contain impossible watermark expectations; other notice operations remain untested.**  
    **Rows:** NR03–06/08.  
    **Evidence:** NR04 displays pos10 but submits pos20 under that token (`NR:223–227`), so a correct owner returns invalid; it never calls ack. NR06 returns m11/r12 but expects `seenThrough` to remain pos10/undefined (`:259–262`): those are delivered-page watermarks, not saved settings. NR03 prefilters member notices (`:207`), avoiding the merged-page condition. NR08 never changes current cap (`:288`).  
    **Direction:** perform a real message ack, mark only delivered positions, read saved settings separately, exercise merged truncation, save both categories, reread stored messages, and change actual current cap.  
    **Estimate:** individual mistaken assertions **small**; complete rows **larger**. The token-bound and returned-watermark contradictions are **NEW**.

17. **Must-fix — state rows still contain false-positive or overconstrained assertions.**  
    **Rows:** PC01/02/09, GS01/14, NS01, MD01/11.  
    **Evidence:** PC01 passes although production still drops `requestRef` (`sPC:156`, `WG/state/plan-machine.ts:1020`); PC02 checks only U3; PC09 never checks slot effects. GS01 requires a default order0 write (`sGS:142–151`), rejecting permitted no-op behavior. NS01 uses a test-local fallback (`sNS:68`). GS14 manufactures proof (`sGS:282`); MD11 manufactures synthetic fields (`sMD:349`).  
    **Direction:** assert production-produced facts/effects; call real default-reading helpers; test actual migration and synthetic construction. Normalize remaining PC/MD/NS identities to §5.1.  
    **Estimate:** default/identity/individual assertions **small**; replacement and synthetic-output coverage **larger**.

18. **Must-fix — RT06 manufactures the rejection being tested.**  
    **Row:** RT06/B14.  
    **Evidence:** `RT:137` returns invalid unconditionally; `:142` uses a literal token; `:148` compares untouched local data.  
    **Direction:** obtain a valid token, submit the specified mismatched filter with valid Workspace pins, and compare persisted Workspace state through a real settings owner. Retain recorder tests for ordinary routing rows.  
    **Estimate:** **larger**.

19. **Must-fix — TU04 can skip its required result assertions.**  
    **Row:** TU04.  
    **Evidence:** `TU:355` returns successfully when the answer body is null. Formatting and input-supply checks are then skipped. TU05’s separate invalid history is covered in defect 5.  
    **Direction:** require a non-null original answer before formatting/supply assertions. Keep TU05’s expected formatted string unchanged.  
    **Estimate:** **small**. **NEW silent-pass path.**

20. **Must-fix — SC01 still constructs its source and undercounts the required observations.**  
    **Row:** SC01/B17.  
    **Evidence:** `SC01:56` constructs a U2-only source instead of using the canonical card source. That capture must support the later acknowledged formal change, not merely identify U2. `:49` omits stored `status:'candidate'`; `:138` counts applications but not the one Q2 formal modification.  
    **Direction:** use the real canonical source/captured objects, verify valid acknowledgement proof across replacement, and assert the stored candidate and attributable formal-change count.  
    **Estimate:** assertions **small**; source/proof setup **larger**.

21. **Must-fix — SC02’s agent requeue has no delegated admission.**  
    **Row:** SC02.  
    **Evidence:** `SC02:50` uses `h.direct()`, deliberately composed without Runtime (`tests/scenarios/harness.ts:887`). Consequently `WG/tasks/requeue-service.ts:553` rejects before checking `requeue_task`.  
    **Direction:** use an admitted fresh auxiliary work Run and a real requeue owner with matching delegated dependencies; see the in-scope resolution below.  
    **Estimate:** **larger**. This newly added call exposes a **NEW immediate blocker**.

22. **Must-fix — SC02 repeats a no-progress basis and later deletes A2.**  
    **Row:** SC02.  
    **Evidence:** scripts only read unchanged source (`Support:46–49`), so the second automatic requeue at `SC02:107` meets `no_new_basis` (`WG/tasks/requeue-service.ts:741`). The final draft at `SC02:141` starts from one work Task (`Support:217`), deleting the previously seeded A2; `WG/tasks/plan-validation.ts:338` prohibits physical task removal.  
    **Direction:** create real new source/input basis before the second requeue; derive the final revision from the existing plan, retaining every Task. Assert requeue counts 1/2 and reverify count1.  
    **Estimate:** **small per correction**, after admission/setup is repaired. Both are **NEW blockers in the expanded sequence**.

23. **Should-fix — remaining interface and part-1 boundary discrepancies.**  
    **Evidence:** `receiptReadable` at `WG/state/message-machine.ts:232`; broad reader dependencies at `WG/tasks/goal-decision-reader.ts:26` and `planning-question-reader.ts:29`; extra decoder re-export at `WG/sessions/message-record-codecs.ts:72`. New implemented read-verdict bodies at `WG/state/plan-machine.ts:183,1522` exceed A10’s “do not add more behaviour.”  
    **Direction:** remove the service-failure boolean, narrow reader capabilities, keep the authoritative export, and retain observable signatures with part-1 stubs. A9 requires calling `decisionSourceKey`; it does not authorize its current incorrect implementation. These are generally **small** edits.

24. **Should-fix in part 2 — retain the acknowledged implementation debt.**  
    Host response-event validation, malformed bootstrap-settings acceptance, and round/requeue wire-field leakage remain at the locations in findings 6–8. Composition still lacks operator/duties wiring (`src/composition/create-platform.ts:500–513`). **A10 means these earlier bodies should not be rolled back merely for having been implemented early.**

**Interpretation of the passing tests and open points**

- **RT01/02/03/05/07:** genuine narrow route/binding checks. Recorders are explicitly permitted by B14.
- **RT04:** genuine forwarding/rejection-translation coverage; its recorder does not prove the owner’s missing-pin validation.
- **RT06:** vacuous for the claimed token-filter/durable-state requirement.
- **RT08:** genuine capability-result forwarding; not the requested explicit real model-call observation.
- **PC01:** false green—the production transition still ignores the request association. **PC09:** incomplete green. **PC05:** genuine existing behavior. **PC10:** genuine closed-reason/no-mutation assertions, enabled by newly implemented behavior rather than a recorder.
- **TU07:** genuine. Both branches retain a usable profile; the Session control reaches consultation while the user-recipient branch does not.
- **UM12:** genuine current ack/replay, incomplete historical compatibility coverage.

**SC02 has an in-scope repair without editing the harness.** Under §5.1’s owner/seed allowance, `Support` can create a fresh auxiliary Session/claim/Run on the same SQLite store, with `requeue_task` granted from inception, matching trusted Host authorization and real Role facts. Follow the existing real `authorizeRuntimeEntry → beginRuntimeEntry → recordExecutionEntered` pattern in `tests/work-graph/A2-requeue-service.test.ts:119–136`, then invoke the real delegated requeue owner as that Run. Settle the auxiliary Run before restart. This is larger helper work.

Installing a Role alone cannot enlarge the Host grant or an existing manifest. Nor does adding the name to `ag2bWorkRuntime` make normal Runtime execution work: `src/core/agent-runtime/execution-driver.ts:120` rejects unknown tools. Describe the repaired case accurately as **owner-seeded Agent admission**, not model-driven execution of a requeue tool.

**`seedCommit` is permitted for preconditions.** Pause/cancel/finalized-round seeds are not defective merely because they bypass an owner. They must represent possible states and preserve coherent history. They cannot replace the operation a row expressly tests—answering, acknowledging, applying, or changing configuration—or justify responded snapshots inside Sent events.

**The widened fixture Run permissions are reasonable test admission setup.** They enable real mailbox operations without widening production authority. The unresolved problems are the undeclared duties dependency and the specific missing/inconsistent admissions identified above.