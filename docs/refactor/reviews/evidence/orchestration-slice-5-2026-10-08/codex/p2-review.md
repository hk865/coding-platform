The implementation needs fixes before acceptance. I reviewed the changes against `48c8d473` using read-only inspection. I did not modify files or run tests, Node, npm, or package scripts. The reported test results are not independently verified here.

1. **must-fix — Canonical source validation accepts invented sources.**  
   `src/core/work-graph/communication/decision-source-facts.ts:178–245`  
   **Rule:** §2.3, §3.3, S5-MSG-03: reconstruct the source from formal facts.  
   **Evidence:** candidate/planning/cause branches essentially read only the Goal; the returned source uses `pins: clonePins(source.pins)`. A canonical key naming a nonexistent candidate, with an existing Goal and empty pins, can reach synthetic answering and occupy its unique answer claim. Conflict membership, pointers and actual conflict are likewise not established.  
   **Direction:** derive and verify each source’s identity, objects, pins, closure and readers through its formal records/readers.

2. **must-fix — Operator configuration is bypassed and incompletely wired.**  
   `src/composition/create-platform.ts:461,519`; `src/core/work-graph/tasks/plan-service.ts:2602–2607`; `src/app/host.ts:365`  
   **Rule:** §3.2, §8.2, book rule 1: exact configured operator; absence means `unsupported`.  
   **Evidence:** `options.operatorActor ?? options.checks?.executor`; Plan dependencies omit that operator entirely; `hostOperatorMatches` returns `true` when configuration is absent. Host does not supply its startup actor. Comments explicitly justify these fallbacks using frozen fixtures. Consequently arbitrary non-automation Host actors qualify for candidate adoption/abandonment, while ordinary Host settings/answer routes can remain unsupported.  
   **Direction:** wire the startup operator consistently; remove fixture-driven identity fallbacks.

3. **must-fix — Runtime decision reads bypass Session authorization.**  
   `src/core/agent-runtime/communication-tools.ts:350–362,545`; `src/core/work-graph/communication/decision-service.ts:545–551`  
   **Rule:** §4.6: preserve trusted principal and enforce `allowedReaderSessionRefs`.  
   **Evidence:** `decisionReadContext` converts a work-run principal into a Host principal. The owner then skips its Agent reader gate. Even without that conversion, the gate checks only whether the allowed-reader array is nonempty, not whether it contains the caller’s Session.  
   **Direction:** preserve the original principal and prove membership using the Run/Query’s formal Session.

4. **must-fix — Read paths permit cross-Workspace access or inspect foreign facts before refusing.**  
   `src/core/work-graph/views/decision-read-model.ts:189,439–455`; `views/goal-conflicts.ts:203`; `communication/decision-source-facts.ts:158–233`  
   **Rule:** §8.2 scope rule; §4.1 authorized Workspace.  
   **Evidence:** direct card reads use supplied Goal/message refs; notice-only queries use the supplied Workspace without a context comparison. Source validation checks scope only after reading objects and pins, and checks only one Goal of a conflict pair. Some settings branches also return `invalid` for foreign predecessors (`tasks/goal-settings-service.ts:375`).  
   **Direction:** validate explicit scope before reads, check every object’s ownership, and preserve `forbidden` versus same-scope `not_found`.

5. **must-fix — Required command pins are not enforced.**  
   `src/core/work-graph/communication/decision-service.ts:436–462,466–524,641–655`; `communication/mailbox-service.ts:2796–2799`; `tasks/plan-service.ts:2232–2269`  
   **Rule:** §3.3 pin sets, line 625; unchanged command CAS at line 684.  
   **Evidence:** synthetic answers do not compare `meta.expected` with source pins; message answers inspect only the message pin. Application persistence guards `before.revision`, discarding the state effect containing the caller’s revision. Thus a message currently @2 can accept application expected@1. Abandonment requires a proposal pin but permits the required Goal pin to be absent.  
   **Direction:** enforce exact sets and compile the accepted caller/state pins into the transaction.

6. **must-fix — User-message source objects are never established as formal facts.**  
   `src/core/work-graph/communication/mailbox-service.ts:1114,2548–2579`  
   **Rule:** §3.3 send check order: Goal, duties and source objects before state/body/commit.  
   **Evidence:** object validation checks array shape/count, then supplied object pins become source metadata. Those objects are neither read nor guarded. A nonexistent or stale object can therefore be persisted as a decision question and later make answering fail.  
   **Direction:** validate source existence, scope and revisions before storing the message, and guard those observations.

7. **must-fix — Request-linked first plans cannot be adopted.**  
   `src/core/work-graph/tasks/plan-service.ts:1576–1588`; `state/plan-machine.ts:1673–1674`  
   **Rule:** S5-PLAN-03; brief D2.  
   **Evidence:** `basedOnIsActivePointer` requires both pointers to be non-null. For a legitimate first plan, candidate `basedOn` and Goal active pointer are both null; the state machine unconditionally rejects the resulting false fact as `revision_conflict`.  
   **Direction:** recognize the valid null/null initial-plan relationship while retaining first-plan operator authorization.

8. **must-fix — Agent proposal calls silently lose request/replacement semantics.**  
   `src/core/work-graph/tasks/plan-service.ts:1445–1451,3034–3132`  
   **Rule:** §2.4, S5-PLAN-01/02, brief D2.  
   **Evidence:** `proposePlan` parses `requestRef` and `replaces`, then omits both when calling `proposePlanAsAgent`. That branch fingerprints neither field and commits `claims: []`. A requested replacement becomes an independent proposal instead of replacing the head atomically.  
   **Direction:** carry the association through the Agent path and use the same request-head transaction semantics.

9. **must-fix — Autonomy enforcement is absent from direct owners and requestless adoption.**  
   `src/core/work-graph/tasks/requeue-service.ts:124`; `evidence/evidence-service.ts:777`; `tasks/plan-service.ts:2875–2892`  
   **Rule:** §3.2, S5-AU-03, part-2 step 3.  
   **Evidence:** `goalSettings?` and `automaticReverifyPolicy?` are declared but never consumed. Future-plan autonomy checks run only inside `if (requestRef !== null)`. Direct requeue/reverify and requestless Agent refinement can bypass `every_step`. Workflow’s preliminary reads do not repair owner-level enforcement or its races.  
   **Direction:** enforce the shared policy in each modifying owner using guarded current facts, independent of request association.

10. **must-fix — Conflict coordination cannot reliably replay its completed settings step.**  
    `src/business/workflow/decision-actions.ts:164–178`; `src/core/work-graph/tasks/goal-settings-service.ts:529–531`  
    **Rule:** §4.5: retain captured pins in settings identity; recover receipts before new business reads.  
    **Evidence:** Workflow rereads the source and current Goals, then supplies `expected: currentPins.pins`. After settings succeed, the original source may already be stale, so retry stops before restoring the settings receipt. Mutable expected pins also change its fingerprint. A failed third commit can therefore leave application recording unrecoverable through this coordinator.  
    **Direction:** preserve the original settings command and restore its receipt before validating new business state.

11. **must-fix — The conflict “wait” path always omits a required pin.**  
    `src/business/workflow/decision-actions.ts:107–123`; `src/core/work-graph/tasks/goal-settings-service.ts:604–610`  
    **Rule:** §3.3 line 625: wait requires both Goals plus predecessor GoalPhase.  
    **Evidence:** `conflictPins` produces only Goal pins; the owner requires `[earlierRef, laterRef, phaseRef]`. The answer commits, but its settings action returns `invalid`.  
    **Direction:** provide the required phase fact/pin within the stable command/rebase protocol.

12. **must-fix — Conflict application does not consistently require active Goals or validate the selected ordering.**  
    `src/core/work-graph/tasks/goal-settings-service.ts:595–677,705–713`  
    **Rule:** S5-GS-03/06, §4.5: application waits for resume; store on the Goal later in the actual order.  
    **Evidence:** the active-state check exists only in the revision-rebase branch. When captured/current revisions match, a paused Goal reaches the settings transition. The service also trusts `selection.earlier/later` without checking their current ordering.  
    **Direction:** validate both Goals’ control state and actual ordering before applying the selected conflict operation.

13. **must-fix — Goal enumeration can authorize an incomplete reorder.**  
    `src/core/work-graph/tasks/goal-settings-service.ts:224–257`  
    **Rule:** §2.2: full Workspace set; §3.3: first-read ledger horizon.  
    **Evidence:** enumeration stops after 25 pages without rejecting an unfinished listing, and repeatedly replaces `watermark`, including with the final `readMany` horizon. A Goal inserted between enumeration and canonical reads can be absent from the list while the newer horizon allows the commit.  
    **Direction:** require completed enumeration and a stable window anchored to its first read.

14. **must-fix — Wait-cycle inspection treats unreadable or unfinished chains as safe.**  
    `src/core/work-graph/tasks/goal-settings-service.ts:391–399,639–647`  
    **Rule:** S5-GS-01/03; §3.1 says source-read failures are returned before state evaluation.  
    **Evidence:** failed successor reads execute `waitingCycle = false; break`; reaching depth 64 also exits without establishing termination. Missing/corrupt chain facts can therefore permit a wait, and longer cycles escape detection.  
    **Direction:** propagate read failures and reject incomplete bounded traversal instead of declaring it acyclic.

15. **must-fix — Goal priority ordering is never invoked for competing advances.**  
    `src/app/collaboration-driver.ts:451–458,843`  
    **Rule:** §4.5: order currently pending competing advances at the claim/create safe point.  
    **Evidence:** the only call supplies `[typedAdvance]`, while the helper immediately returns when `advances.length <= 1`. The implemented Workflow sorter has no effective production call path.  
    **Direction:** pass the actual competing pending set at that safe point.

16. **must-fix — Goal-cause identity collapses independent decisions.**  
    `src/core/work-graph/tasks/goal-decision-reader.ts:172–192,235–239`; `src/business/workflow/workflow.ts:1035–1053`  
    **Rule:** brief D1; §2.8/§4.2 require affected Task/Run facts in source identity.  
    **Evidence:** multiple causes use `affected: []`, then deduplicate by source key. Workflow’s automation cause also supplies an empty affected set. Two Tasks—or successive Runs—with the same cause code become one decision, allowing an old answer to join a different occurrence.  
    **Direction:** derive affected pins from the formal failure/cause facts and preserve them in identity.

17. **must-fix — Source failures are presented as available empty results.**  
    `src/core/work-graph/tasks/goal-decision-reader.ts:157–160,205–211`; `tasks/planning-question-reader.ts:129–137`; `views/decision-read-model.ts:526–528`  
    **Rule:** §4.2 explicitly prohibits converting unavailable sources into available empty arrays.  
    **Evidence:** failed display/governance reads return `[]`; failed formal Answer reads are skipped; direct-card provider failures become `not_found`. Decisions disappear during storage/body failures instead of exposing unavailable evidence.  
    **Direction:** propagate the actual failure and capability state.

18. **must-fix — Queue pagination happens before section filtering.**  
    `src/core/work-graph/views/decision-read-model.ts:386–418`  
    **Rule:** §4.1 query sections and paging.  
    **Evidence:** `flat = [...waiting, ...answered, ...history, ...allNotices]` is sliced before requested sections are selected. With 50 waiting cards and one pending application, requesting only pending applications with limit 50 returns an empty first page.  
    **Direction:** filter the requested sections before applying their page limit/cursor.

19. **must-fix — Normal notice acknowledgement causes subsequent pages to skip unseen notices.**  
    `src/core/work-graph/views/decision-read-model.ts:365,387–389,421`  
    **Rule:** §2.5/§8.2: do not advance beyond unshown items.  
    **Evidence:** each request filters using current saved `noticeSeen`, then applies a numeric offset. For N10/N11/N12 with limit 1: show and acknowledge N10; cursor `1` now indexes `[N11,N12]` and returns N12. Acknowledging it crosses unseen N11.  
    **Direction:** use continuation tied to stable notice positions/window, not offsets into a shrinking list.

20. **must-fix — Read results claim a watermark that their source reads do not establish.**  
    `src/core/work-graph/views/goal-conflicts.ts:91–115`; `views/decision-read-model.ts:258–277,394,781–789`  
    **Rule:** §4.1 stable windows, `atLeastCursor`, capacity and truthful completeness.  
    **Evidence:** sources are collected without the prescribed stable-window retries; the final current watermark replaces their evidence. Built-in reads do not enforce `atLeastCursor`, and candidate truncation is discarded. `refreshSourcePins` also replaces every historical object revision, exceeding the permitted Goal-control refresh.  
    **Direction:** enforce a coherent bounded read window, retain truncation/failures, and refresh only the specifically permitted Goal facts.

21. **must-fix — Application proof omits changed aggregates and cannot encode valid absence pins.**  
    `src/core/work-graph/tasks/plan-service.ts:431–465`; `tasks/plan-commit-compiler.ts:231`; `persistence/plan-record-codecs.ts:662–668`  
    **Rule:** brief D8: exact before/after of every changed aggregate; §2.1: absence pin 0.  
    **Evidence:** proof contains only proposal and Goal changes, although adoption also creates a PlanRevision; without `decisionSource`, changes are empty. The proof codec uses positive-only revisions, rejecting the required new-aggregate before@0.  
    **Direction:** construct proof from the actual write set and support legal absence versions.

22. **must-fix — New evidence codecs accept malformed formal data.**  
    `src/core/work-graph/persistence/decision-record-codecs.ts:72–102,171–178`; `sessions/message-record-codecs.ts:352–361`  
    **Rule:** §2.8 formal event proof; §8.2 bad fields must become unavailable.  
    **Evidence:** settings-event decoders validate outer and JSON envelopes separately without requiring equality of event ID/type/version/time. Pin validators accept refs containing little more than `aggregateType`. Such malformed data is returned as typed formal evidence.  
    **Direction:** bind the envelopes and validate complete aggregate-specific refs before decoding succeeds.

23. **must-fix — Request-candidate reads do not establish that the request exists.**  
    `src/core/work-graph/tasks/plan-service.ts:2197–2215`  
    **Rule:** §3.1: missing requests are `not_found`; §3.3 request facts.  
    **Evidence:** the method checks request scope, reads the Goal and searches the candidate index, but never reads the QueryJob. A nonexistent same-Workspace request returns `{head:null,status:'closed'}`.  
    **Direction:** validate the formal same-Goal request before interpreting its candidate slot.

24. **should-fix — Several Goal-settings state rows have the wrong behavior.**  
    `src/core/work-graph/state/goal-settings-machine.ts:145–190`; `tasks/goal-settings-service.ts:489,664–690`  
    **Rule:** S5-GS-02/03/04.  
    **Evidence:** a cancelled historical Goal cannot change position in a pure reorder; accepting the identical parallel risk always increments revision rather than producing the required new-identity no-op; detected wait cycles return `invalid` rather than `cycle`.  
    **Direction:** implement each row’s explicit terminal/no-op/error semantics, including receipt-only no-op proof.

25. **should-fix — Exempt automatic recovery is displayed as counted rework.**  
    `src/core/work-graph/views/automatic-rework-notices.ts:98`  
    **Rule:** §4.4: interrupted recovery is “automatic recovery, not counted,” never “zeroth rework.”  
    **Evidence:** all automatic requeues call `reworkSummary(...autoCount...)` without inspecting `automation.counted`.  
    **Direction:** derive the recovery label from the saved exemption/counting facts.

26. **should-fix — The required shared message writer remains two implementations.**  
    `src/core/work-graph/communication/mailbox-service.ts:1477–1530,2610–2834`  
    **Rule:** §3.3 line 684; brief G4.  
    **Evidence:** original send/respond still commit through `writeMessage`; the new facade independently implements body storage, replay and commit. The divergent CAS behavior in finding 5 occurs in this second implementation.  
    **Direction:** route the original and new paths through the specified shared writer while preserving their original identities.

For each item in the implementer’s **UNSPECIFIED** list:

| Item | Judgment and evidence |
|---|---|
| DQ04 missing `SessionArchived` schema | **Fine as a reported fixture limitation**, not a demonstrated production defect. Production composition registers lifecycle schemas. I did not review or alter the frozen fixture. |
| SC02 missing sandbox binary | **Fine as an environment limitation**, based on the supplied measurement. No independent execution was performed. |
| AP09 versus captured settings pins | **Real production defect, with a genuine frozen-contract inconsistency to resolve.** AP09’s direct owner call supplies current pins; §4.5 requires Workflow’s original captured command pins. AP09 does not justify Workflow’s fresh-state reads or broken retry behavior in finding 10. |
| Host operator injection outside scope | **Real production defect**, finding 2. The write-scope restriction explains reporting it, not declaring the wiring complete or adding permissive fallbacks. |
| Default helpers bypassed | **Implementation integration gap**, not unspecified behavior. §2.2 names these consumption helpers. Current duplicated defaults appear equivalent; no differing runtime default was established. |
| Unused `enumerateGoalCandidates` / `notFound` | **Unjustified retention**, not an established later-slice seam. The former duplicates current-slice enumeration; no cited requirement justifies the latter. Connect the required helper or remove unused production declarations. |
| Broken `conflict_wait` | **Real production defect**, finding 11. |
| Unused autonomy seams | **Real production defect**, finding 9. |
| Incomplete `isLegalSettings` | **Real state-contract defect.** `state/goal-settings-machine.ts:113–119` omits wait-ref and risk-entry validation required by S5-GS-01. Current public settings input validation limits reachability; it does not fulfill the pure transition contract. |
| Synthetic constructor does not force flag | **Real invariant defect.** `state/message-machine.ts:1069` copies `input.decision`; D7 requires the constructor to establish `syntheticAnswer:true`. The current service supplies true, so ordinary synthetic answers are not presently all malformed. |
| Answer `meta.expected` not enforced | **Real production defect**, finding 5. |
| Work-run converted to Host for reading | **Real authorization defect**, finding 3. |
| `wire-format` allowlist wording | **Task-rule violation, not a spec gap.** Part-2 step 6 permits only specification-named future seams with `kept-for`; describing declarations as wire formats does not establish that exception. This is not itself a runtime defect. |

Things checked and found correct:

- Host request replacement compiles old/new candidate records, both events and the `s5-request-candidate:` claim transfer into one commit; other requests are not rewritten.
- Answer commits write message facts without modifying Plans or Tasks. Synthetic answers use the prescribed unique claim.
- Application verification uses `lookupCommit` and `eventAt`, checks receipt/event membership and acknowledgement attribution, and supports only the two permitted event families.
- Normal receipt-hit paths restore saved results before body/clock work. Runtime answer formatting preserves structured text/annotations and the original input ID/accepted-input mechanism.
- Both backends share the new schema/index registrations and existing atomic claim/CAS/cursor-binding machinery. Creation origins are preserved on updates; wire origins are stripped from public DTOs.
- Legacy missing settings retain their old public shape, present settings survive Goal-control changes, and the bootstrap validation defect was repaired.
- Inspected protected record construction remains in `state/`; the specified import boundaries were retained. Read-model paths inspected do not write, acknowledge messages or invoke models.
- Conflict identity uses the unordered Goal pair and both full Plan pointers. Footprint mapping and explicitly deferred source availability follow the intended seams; the executed-files stub and initialization-proof `unsupported` are authorized deferrals.