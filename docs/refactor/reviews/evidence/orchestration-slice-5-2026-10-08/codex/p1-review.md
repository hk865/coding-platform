**Do not freeze this part-1 test baseline yet.** All **153 case IDs / 224 parameterized runs** are present, but several tests cannot pass under the frozen specification, and many omit required assertions. I verified HEAD `48c8d473`; this review used read-only inspection, without running tests, Node, npm, or scripts.

1. **Must-fix — `src/core/work-graph/state/plan-machine.ts:244` — §3.1, S5-PLAN-01/02/03.**  
   The new replacement event supplies references/pins but lacks the new draft, reason, issues and provenance needed to construct both replacement results. The existing `proposal_recorded` input also lacks the request association exercised by S5-PLAN-01. Meanwhile `proposal_adopted` omits the existing acceptance event’s `decisionRefs`/`agentWriter`. `PlanRequestCandidateFacts` at **:355** has `firstPlanUserOnly`, but no verdict covering the row’s §3.2 autonomy requirement.  
   **Direction:** freeze an interface capable of producing both candidates and the slot effects, while retaining the existing adoption guards. PC01/PC02 currently hide these deficiencies by omitting their distinguishing assertions.

2. **Must-fix — `src/core/work-graph/state/message-machine.ts:188` — §3.1 guard columns.**  
   `goalStartNotRequired`, `pausedAnswerable`, `capturedPinsAreReadGuards` and `noFakeCurrentPass` encode unconditional rules as caller-supplied booleans. They must not become additional rejection conditions or substitutes for formal proof. The remaining fields broadly cover MSG01–06: trusted admission/scope, operator, pins, cancellation, selection, annotations, source/slot, receipt linkage and modifier.  
   **Direction:** freeze observable facts and their rejection mappings; keep “paused may answer” and “sending does not require starting work” as invariants. For application, distinguish unreadable/corrupt evidence from missing or mismatched proof rather than treating everything as one boolean.

3. **Must-fix — `src/business/workflow/consultation.ts:321`, `:228` — part-1 book B; §4.6, §5.5.**  
   Both existing consultation paths now execute `isUserMessageRecipient(message.recipient)`. Its body at `src/contracts/core/session-message.ts:99` unconditionally throws `not implemented`. Ordinary Session-addressed messages therefore throw before the original consultation logic.  
   **Direction:** preserve the old path with non-throwing union discrimination; any permitted part-1 throw must be confined to the new union member. **This explains the reported AG2-consultation HTTP 500 regression.**

4. **Must-fix — `src/app/collaboration-driver.ts:847` — part-1 book B; §4.5.**  
   `await orderAdvanceSelection(ctx, [typedAdvance])` sits between the existing `handles.get` check and `handles.set` at **:858**. Concurrent starts can both pass the check before either registers its handle.  
   **Direction:** remove this premature behavior change; later ordering must preserve atomic handle registration. **It does not currently reach the ordering stub:** the only caller supplies one item, and **:454** returns immediately for `length <= 1`. The extra `await` still creates the race.

5. **Must-fix — `src/core/work-graph/persistence/record-codecs.ts:235`, `:689` — part-1 book A/B, §8.1.**  
   Substantial behavior has already been implemented in existing codecs, beyond types, constants, registration data and stubs. Other examples are `plan-record-codecs.ts:751`, `message-record-codecs.ts:697`, `project-bootstrap-record-codecs.ts:199`, `claim-record-codecs.ts:506`, and `evidence-record-codecs.ts:320`. Runtime tool registration/selection bodies at `communication-tools.ts:475` and `execution-driver.ts:123`, and the collaboration pump at `collaboration-driver.ts:496`, are also implemented behavior.  
   **Direction:** restore the part-1 boundary before freezing; defer these implementations to part 2. Route and composition wiring are expressly permitted exceptions.

6. **Must-fix — `src/core/work-graph/sessions/message-record-codecs.ts:866` — §2.3.**  
   The existing `SessionMessageResponded` validator still permits only work-run/query-run actors. §2.3 explicitly retains `SessionMessageResponded@1` for replies to existing user-addressed messages, whose response sender is the configured Host operator.  
   **Direction:** the eventual codec must validate that legitimate Host response variant without weakening old response validation.

7. **Must-fix — `src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:199` — §2.2.**  
   `decisionSettings` is cast into the returned value without validating its structure. A malformed present field is therefore accepted instead of rejected as unavailable.  
   **Direction:** apply the same strict settings validation used by the Workspace codec; retain absence for old records.

8. **Must-fix — `src/core/work-graph/sessions/message-record-codecs.ts:1026` — §2.5.**  
   The implemented `decodeNoticeOrigin` casts `since`/cap values, including persisted `since:null`. Another `decodeNoticeOrigin` exists as a stub in `persistence/decision-record-codecs.ts:111`. Round and Requeue decoders at `evidence-record-codecs.ts:350` and `claim-record-codecs.ts:612` return the whole JSON object, including the newly accepted wire-only fields.  
   **Direction:** choose one authoritative origin decoder, reject malformed persisted origins, and keep wire metadata out of public DTOs. This is an implementation defect, not evidence that old absent-field records changed shape.

9. **Must-fix — `tests/helpers/S5-decision-fixture.ts:535`, `:573`, `:582` — §§2.3, 2.8, 3.3, 5.1.**  
   Two different messages share `key: 's5-message-source'`; message source identity must derive from the complete message reference. The answer reuses the question source without captured Goal bases, and its seeded `SessionMessageSent` event contains the final `responded@2` snapshot.  
   **Direction:** construct distinct canonical sources and historically valid sent/answered facts. A legacy answer lacking Goal bases cannot prove the control rebases required by SS11/SS15/AP09.

10. **Must-fix — `tests/work-graph/S5-goal-settings.test.ts:30`; `tests/work-graph/S5-user-messages.test.ts:19`; `tests/work-graph/S5-decision-application.test.ts:20` — §3.3 pin sets/check order.**  
    Several common request builders violate the exact pin contract:
    - SS `setReq` adds a Workspace pin; waiting requests omit predecessor Goal/GoalPhase pins. Several reorder calls also add Workspace.
    - UM answers provide the message pin but omit their source’s PB1 pin.
    - AP answers and applications use `expected: []`; application requires exactly the message pin.
    - RC abandonment at `S5-request-candidates.test.ts:58` supplies only Goal, omitting proposal.
    - Scenario answer/application/reorder helpers at `support/S5-decisions.ts:280`, `:312`, `:357` use empty pins.
    
    **Direction:** supply exactly the specified pins. Correct implementations must reject these requests before reaching the intended assertions.

11. **Must-fix — `tests/helpers/S5-decision-fixture.ts:296`; `tests/work-graph/S5-decision-application.test.ts:42`; `S5-decision-queue.test.ts:95` — §5.1 “0 writes”.**  
    The new services receive `b2.base.records`, the raw backend. `b2.base.spy.commits` observes a separate wrapper used by the claim service (`task-claim-fixture.ts:131`, `:352`). Thus these AP/DQ “no writes” assertions do not observe writes by the tested service. Other tests substitute one lookup bucket or commit-call count for the required record/event/claim/version comparison.  
    **Direction:** observe the actual injected store and persisted before/after facts. Replay tests must also check original value/cursor and unchanged ID/time/body/model counters. SS has its own attached counter, but that still does not prove its required event contents.

12. **Must-fix — `tests/work-graph/S5-goal-settings.test.ts:41`, `:56` — SS01/SS16, §5.1.**  
    `f.b2.read(f.claimRA)` and `f.b2.buildPrepared({claim: f.claimRB})` use the original B2 fixture’s scope/configuration, not S5 `P/W`, Workspace revision 3 and S5 configuration.  
    **Direction:** use the S5 fixture’s actual read/preparation/entry services. SS01 cannot establish RA preservation through a cross-project reader; SS16 cannot reach its intended waiting guard through incompatible preparation.

13. **Must-fix — `tests/work-graph/S5-goal-settings.test.ts:42` — SS02–SS16.**  
    Beyond the common pin defects, these rows do not perform their named operations:
    - **SS02 :42:** never cancels B before replay; omits original value/cursor equality.
    - **SS06 :46:** uses a non-conflict answer source, then stale B@7 pins; never checks two labels, their pointers or zero cards.
    - **SS07 :47:** never installs PA2 or reads labels/cards; fabricates a key and still supplies PA1.
    - **SS08 :48:** no race. It expects `claimRun(...).toBeDefined()`, although that helper throws unless the claim commits—the opposite of the required conflict.
    - **SS09 :49:** cancels A but never claims B or verifies the fixed wait reference.
    - **SS10 :50:** memory “reopen” creates a new database; expects B order 0 although the fixture fixes B order 1. Only autonomy is saved.
    - **SS11 :51:** no paused answer; applies before the supposed resume; omits B@9, captured/actual proof and one-answer checks.
    - **SS12 :52:** no pause/resume; its conflict can arise from the fabricated revision rather than changed content.
    - **SS13 :53:** does not verify the claimed Run survives; uses a Session-pin helper from the other fixture scope.
    - **SS14 :54:** never sets order 2/risks, resumes, or rereads historical receipts.
    - **SS15 :55:** no paused answer/resume; the second settings write reuses B@7; B@10 was never established.
    - **SS16 :56:** additionally omits unchanged `Starting.Unbound` and zero binding/authorization writes.
    
    **Direction:** establish each specified sequence, then assert its exact resulting versions, proof and preserved facts.

14. **Must-fix — `tests/work-graph/S5-goal-settings.test.ts:41` — SS01/03/04/05, §5.1.**  
    SS01 lacks the actual single `GoalSettingsChanged` event; SS03/SS05 lack the prescribed persisted zero-write checks; SS04 neither seeds nor verifies the retained B risk and asserts orders without identifying their Goals.  
    **Direction:** assert the row’s actual event/receipt and Goal identities, not merely successful status or submission count.

15. **Must-fix — `tests/work-graph/S5-user-messages.test.ts:14` — UM01–11/13, §3.2.**  
    No trusted duties adapter is injected. UM01–04 therefore use indistinguishable configurations despite requiring adviser/executor differences. The decision service at **:16** also omits `operatorActor`; the spec requires unconfigured new user-write entry points to return `unsupported`.  
    **Direction:** configure the exact trusted duties/operator per row. Keep missing mapping specifically for UM05.

16. **Must-fix — `tests/work-graph/S5-user-messages.test.ts:60`, `:78` — UM08/UM11.**  
    UM08 submits the second answer only after the first finishes, without arranging two reads of pending@1. UM11 changes the principal to `human:other-operator` and reuses pin 1; that principal should be forbidden, not treated as the configured operator making a later command.  
    **Direction:** distinguish a controlled concurrent CAS loss from a legitimate later reader observing responded@2. Verify the original response is unchanged.

17. **Must-fix — `tests/work-graph/S5-user-messages.test.ts:83` — UM12, §§2.3, 2.5, 5.5.**  
    The test performs **send→send replay**, not the required **legacy ack→ack replay**. It also sends a new message through the current owner and then requires no `since`, rather than seeding an old message with absent origin.  
    **Direction:** restore the actual legacy acknowledgment operation and frozen old DTO/receipt comparison. Ack replay already exists in `C1-session-mailbox.test.ts:339`, `:346`; its unreachability here is a fixture problem. **Part 2 cannot make the frozen UM12 row covered without changing this test.**

18. **Must-fix — `tests/work-graph/S5-user-messages.test.ts:24` — remaining UM assertions.**  
    UM01 omits exact sender S/RA and exact lookup counts; UM02 checks only a pending bucket; UM03 omits Task/model invariants; UM06 never rereads original text or stored Task/Plan, instead inspecting cached fixture data; UM07 omits the single response/event evidence and allocation counters; UM09 checks only one bucket. UM10’s legacy reply uses a Run whose configured tool set is only `read`, so its admitted response path is not established. UM13’s bucket/reopen assertions otherwise match its row, once the shared setup is corrected.  
    **Direction:** observe every named effect through the real owners/store.

19. **Must-fix — `tests/work-graph/S5-request-candidates.test.ts:30` — RC02/03/04/07 and the eight reported AssertionError runs.**  
    Their central expectations are correct: an occupied request must conflict; replacement failure must not commit; successful replacement must version U1; a B request cannot propose for A. Current production ignores `requestRef`/`replaces` and commits no request claims, explaining these failures. But:
    - RC02 is one write against an already occupied slot, not simultaneous first writes against an empty slot.
    - RC03’s fault triggers only when a particular claim is written; it accepts any rejection without proving injection occurred.
    - RC04 never checks the same receipt contains U1@2/U3@1.
    - RC07’s one-bucket equality does not prove zero writes.
    
    **Direction:** retain those expectations and repair the missing race/fault/atomicity observations. These are not reasons to weaken the expected business behavior.

20. **Must-fix — `tests/work-graph/S5-request-candidates.test.ts:51` — RC01/05/06/08–11.**  
    RC05 ignores the adoption result; the seeded candidate is a v1 full draft based on PB1, which existing future-adoption rules reject. It therefore cannot establish “Q1 adopted”. It also omits Q2 queue/actions. RC01 omits the two queue cards; RC06 omits actual slot-release proof; RC08 reopens only an initial head, without closed history or pointer-derived staleness; RC09 omits unchanged raw JSON/claims; RC10 does not observe foreign-body reads; RC11 checks decoding but not absent added fields, claims or read-only behavior.  
    **Direction:** use an adoptable candidate and complete each specified read/compatibility assertion.

21. **Must-fix — `tests/work-graph/S5-decision-application.test.ts:15`, `:19` — AP03–07/09/12–16, §§0.2 L1, 3.3.**  
    The service lacks configured operator identity, and `receipt()` commits only `TrustedScopeSeeded`, with no changes or formal proof. Such a receipt cannot demonstrate settings/plan application, historical before/after, modifier identity or a control rebase.  
    **Direction:** use actual acknowledged `GoalSettingsChanged`/`PlanRevisionAccepted` receipts. **The benign event is suitable only for AP04’s missing-event condition**, after fixing its other setup. AP12 needs a genuine formal receipt whose event read is corrupted. The reported receipt substitution cannot satisfy these rows unchanged in part 2.

22. **Must-fix — `tests/work-graph/S5-decision-application.test.ts:28` — AP01.**  
    The row requires a non-message **cause**. The test invents a candidate source and answers `option:accept`, although candidate/cause options are empty under §4.1 and their replies use `other`. It expects total user messages to be one despite the shared fixture already seeding two, and never inspects the source claim.  
    **Direction:** use a canonical cause, valid free text/annotations, an observed message delta, and the exact single claim.

23. **Must-fix — `tests/work-graph/S5-decision-application.test.ts:35` — AP02–16 assertion gaps.**  
    AP02 omits distinct cursors and pending-application state; AP03 accepts any changes array and omits exact before/after and queue decrement; AP04/05 omit retained null application and real zero-write evidence. AP06 never injects a failed application commit—it successfully applies before reopening. AP07 never advances the object again. AP09 asserts arbitrary rebase objects instead of exact proof/current-before/applied state. AP12–14 omit null application/zero writes; AP13 invents an arbitrary cursor string rather than another valid commit cursor. AP16 omits exact retained application and zero writes. AP15’s equality checks are appropriate but unreachable with the fake receipt.  
    **Direction:** perform each row’s distinct operation and assert the frozen values.

24. **Must-fix — `tests/work-graph/S5-decision-queue.test.ts:27` — DQ01–03, §4.2.**  
    `cardSources: []` supplies none of the required narrow readers. DQ01 also has no answered planning-question Query evidence. DQ02 does not establish the specified RUNNING display plus concrete decision cause. DQ03 uses the same undifferentiated fixture.  
    **Direction:** wire the real readers and seed each row’s formal source facts. A correct unavailable-source implementation must not invent six cards to satisfy DQ01.

25. **Must-fix — `tests/work-graph/S5-decision-queue.test.ts:63` — DQ04–09.**  
    DQ04 never answers then archives the sender or checks count deltas; DQ05 never defers; DQ06 never pauses/answers and compares cached objects to themselves; DQ07 never cancels B. DQ08 checks initial identity only, not answering through one entrance and observing both. DQ09 begins with limit 50, does not refresh, changes later page limits, and requires every mixed-section page to contain a waiting card—an ordering/content guarantee the spec does not make.  
    **Direction:** establish the required transitions and reread stored facts, counts and both entrances. Page through a genuinely multi-page result without inventing per-page waiting-card requirements.

26. **Must-fix — `tests/work-graph/S5-notices.test.ts:40`, `:49` — NR01/07/08, §§4.4, 5.1.**  
    The second claim fixture contains `r4c-claim-*` scope, while inserted rework/round records refer to P/W/B and nonexistent supporting Runs/Tasks in that store. NR01 inserts R2 without R1; NR07/08 make every predecessor `status:'open'`. `roundChainHead` requires finalized non-PASS predecessors (`state/verification-machine.ts:513`).  
    **Direction:** register evidence schemas in a coherent P/W fixture and construct a possible round chain. **Using a second fixture is not inherently forbidden, but this second fixture cannot meet the rows as written.**

27. **Must-fix — `tests/work-graph/S5-notices.test.ts:51`, `:53` — NR03/04/06.**  
    Settings are created without `operatorActor`; successful cases use literal `displayToken:'page'`. Correct operator/token checks reject them. NR04 never creates/acknowledges a message and advances `automatic_rework`, not that message’s notice. NR06 saves only one category and after reopening inspects the original in-memory message object.  
    **Direction:** use a token issued from the actual returned page, configure the operator, and reread both category settings and unchanged message facts after reopening.

28. **Must-fix — `tests/work-graph/S5-notices.test.ts:62`, `:77` — NR02/03/05/08.**  
    NR02 tests only `mergeNoticePages`; it never filters the actual read, marks seen, or verifies pos11/pos12 remain. NR03 manually supplies the token contents it should verify the read model generated. NR05 attempts to persist `since:null` through a validating normal commit, then expects `availability:'not_available'`; the specified damaged-data outcome is unavailable, distinct from an unconnected source. NR08 never changes current cap to prove independence.  
    **Direction:** exercise the specified service/read-model paths, use a read-boundary corruption fixture for impossible persisted corruption, and retain the precise error distinction.

29. **Must-fix — `tests/state/S5-request-candidate.test.ts:122` — PC01/02/06/08/09/10.**  
    PC01 never passes Q1 and asserts its own `slotExpectedOwnerIsNull` input rather than U1 slot ownership. PC02 only checks U3@1, omitting U1@2/not_adopted/replaced/U3 and slot transfer. PC06 does not preserve an actual Q2 stored candidate. PC08’s candidate is not stale. PC09 omits zero slot effects. PC10 omits `closedReason:'goal_cancelled'`.  
    **Direction:** complete these state inputs/results before freezing. PC05’s existing stale derivation is valid coverage and need not be forced red.

30. **Must-fix — `tests/state/S5-message-decision.test.ts:178`, `:194` — MD01/02/05/06/11.**  
    MD01/02 use `principal:'host'`, not adviser/executor work-run admission. MD05 passes text into a helper that never consumes it, then compares body references. MD06 supplies a valid-annotation boolean despite an empty object list. MD11 sets synthetic sender/flags locally and asserts them, while its source remains `kind:'message'`.  
    **Direction:** use self-consistent guard facts and production constructors; exercise a non-message synthetic answer and real preservation of the supplied text/annotation metadata.

31. **Must-fix — `tests/state/S5-goal-settings.test.ts:127`; `tests/state/S5-notice-settings.test.ts:61` — GS01/06/14/15, NS01, §5.1.**  
    GS01 tests an `order_set` write and forces revision/event creation instead of reading defaults from an absent field; the spec permits no-op sorting. GS06 preloads the reordered state without verifying that reordering preserved the wait. GS14/15 test only basis comparison, omitting migration before-version/conflict. NS01 compares a constant and an explicitly supplied builder value, not legacy default reading. Several state fixtures use `p-s5/w-s5/goal-b/plan-b-1` instead of the mandated values.  
    **Direction:** test the named default/migration behavior and normalize the fixed fixture values.

32. **Must-fix — `tests/app/S5-decision-routes.test.ts:36`, `:41` — RT01/02/04/06/08.**  
    Factories receive `{} as never`; RT02 supplies its own permanently throwing `resolveDecision`. Implementing production cannot make that substitute pass. RT02 also omits trusted-context/forged-authority assertions. RT01 omits named-call/no-write observations. RT06 combines a forged token, wrong pin and empty updates rather than a valid token with mismatched filter, and never compares Workspace state. RT08 omits model-call evidence.  
    **Direction:** use viable dependencies and isolate each row’s condition. RT03/RT05/RT07 are valid narrow route tests.

33. **Must-fix — `tests/runtime/S5-user-message-tools.test.ts:146`, `:288`, `:313` — TU01/03.**  
    `decisionOwnerHarness` fabricates committed/forbidden results; the rows explicitly require the real owner. Its successful message even has a Host sender.  
    **Direction:** use real work-run admission, trusted adviser/executor duties and the real owner; retain tool-result/wait registration assertions.

34. **Must-fix — `tests/runtime/S5-user-message-tools.test.ts:336` — TU05, §4.6.**  
    The expected formatted string is correct. The fixture is not: it returns canonical JSON as `body.text` rather than original text plus the user-decision body, response annotations disagree with the body, and a Host-sent message is returned through a Session outbox. Its “recordInputAccepted” is a local array mutation.  
    **Direction:** use matching persisted response/body facts and the formal accepted-input owner. **The reported AssertionError does not justify changing the expected string:** a correct implementation needs the specified formatter, but this fixture must also change.

35. **Must-fix — `tests/runtime/S5-user-message-tools.test.ts:325`, `:388`, `:409` — TU04/06/07.**  
    TU04 serializes/parses its own body rather than testing the real wire/body reader. TU06’s fake read returns a pending message with no response rather than the original answer. TU07 disables the matching Query profile for the user branch, allowing zero consultation calls for an unrelated reason.  
    **Direction:** exercise the real body/answer seams and run the user exclusion test with an otherwise usable consultation profile.

36. **Must-fix — `tests/business/S5-decision-workflow.test.ts:169`, `:211` — WF01/02, S5-GS-02.**  
    WF01 includes an extra Workspace pin in settings. WF02 reorders only `[B,A]` although the fixture contains C, and also includes Workspace in its pins. The correct reorder owner must reject it. The idle Session is created through the original fixture’s scope at **:220**.  
    **Direction:** use the exact settings pins, reorder `[B,A,C]` with all three Goal pins, and supply a real compatible Session. The ordering input can still contain only A/B advances.

37. **Must-fix — `tests/scenarios/S5-two-request-decisions.test.ts:46`, `:78`, `:82` — SC01, §§3.3, 5.4.**  
    The scenario invents source key `'s5-q2-candidate'` and uses the newly accepted Q1 Plan as its pins. It later applies the unchanged stale U2 and expects success, contradicting PC07/S5-PLAN-03. Its receipt sets both identity and fingerprint to `'s5-apply-q2'`, rather than the actual namespaced identity/fingerprint.  
    **Direction:** obtain the canonical card, regenerate/replace the stale proposal through the legitimate path, then use its actual formal receipt. Do not weaken stale adoption to satisfy the scenario.

38. **Must-fix — `tests/scenarios/S5-two-request-decisions.test.ts:49`; `tests/scenarios/support/S5-decisions.ts:57`, `:89`, `:253` — SC01, §5.1.**  
    The scenario omits stored U2@1 checks, direct-card/queue identity comparison, original text/annotation readback, and exact formal-change/application counts. Annotation `objectKey` is a path rather than `canonicalJson(object)`. Shared identities use AG2b scope/module and put Q1/Q2 on Goal A instead of the frozen P/W/B fixture.  
    **Direction:** use the fixed identities and canonical object/source keys, then assert all SC01 effects. Preserve the original harness rather than altering its defaults globally.

39. **Must-fix — `tests/scenarios/S5-goal-conflict-rework.test.ts:53`, `:73` — SC02, §§3.2, 4.3–4.4.**  
    It expects two accepted-risk labels **before** accepting risk. Its scripted provider only reads a file and returns text; nothing performs an agent requeue or establishes an automatic reverify, yet two generic advances are expected to produce those facts. It neither limits the notice page to leave undisplayed items nor marks the displayed category seen. Several post-operation assertions are conditional on `status==='ready'`, allowing rejected reads to skip them. No occupied Run is present when reordering, so preservation is untested.  
    **Direction:** drive the actual system/agent requeue and reverify paths, assert their separate counts, page/mark only displayed items, and verify restart retention and occupied-Run preservation.

40. **Must-fix — `tests/state/message-machine.test.ts:117`, `:329` — §5.5, part-1 book D.**  
    New event names are mapped to old `'read'`/`'sent'` fixtures while the asserted “every event” list is expanded. The matrix never executes those new events. This also changes an expressly frozen existing assertion.  
    **Direction:** preserve the old matrix’s meaning and resolve its widened-union typing explicitly; do not claim coverage through false mappings.

41. **Should-fix — `src/core/work-graph/tasks/goal-decision-reader.ts:16`; `planning-question-reader.ts:19` — §4.2 interface gap.**  
    The dependency-free `(ctx,input)` functions match the spec literally, but neither argument supplies records/owners and no factory supplies a closure. Composition directly calls the planning function.  
    **Direction:** lead should freeze an explicit dependency/factory seam before part 2. This is a specification omission, not invented DSH behavior. Likewise, helper API details such as `mergeNoticePages` are implementation choices; NR tests must not replace the specified service behavior with tests of that chosen helper.

42. **Should-fix — `tests/app/orchestration-mechanism.test.ts:471`; `src/contracts/query-job.ts`; `src/core/work-graph/queries/query-job-service.ts:679`; `src/ui/views/sessions/render.ts:93` — §0.6/§6 write scope.**  
    These changes require explicit scope reconciliation. The orchestration test’s sender narrowing preserves its surrounding expected Session identity; I found no semantic weakening there. Moving `InitialPlanAnswerFacts` to contracts and re-exporting it preserves the type while avoiding the forbidden dependency. Query/UI narrowing likewise has a legitimate type-compatibility purpose, but it is outside the frozen list. The lead-accepted `ROUTE_LABELS` change is not an outstanding finding.

The requested disagreement resolutions are:

- **MSG05:** use `decision_application_recorded`. §3.1’s explicit paragraph says MSG05 uses that same event; `application_recorded` in the table is the inconsistent remnant.
- **PLAN03:** `proposal_adopted` follows the frozen table. Preserve/reuse the existing `proposal_accepted` admission semantics rather than dropping its inputs.
- **PLAN05:** `proposal_read` is a read/derived-status operation. It must not persist stale or cancelled history.
- **SentEventBase:** moving the unchanged shared type to model and re-exporting it is a consistent dependency correction.
- **InitialPlanAnswerFacts:** the contracts move is similarly consistent; reconcile its extra write scope.
- **Dependency-free readers, duplicate origin decoder and guard fields:** findings 41, 8 and 1–2 respectively.

For the six codec groups, I found **no demonstrated decode-shape change for a valid historical record whose new fields are absent**. Goal/Workspace and plan preserve absence; old message variants retain their old path; evidence/claim decoders remain unchanged for absent metadata; bootstrap retains the absent-field shape. That does **not** clear the implemented new-field defects above. The §2.7 protected fields are registered, and the architecture-test additions retain named decoder allowances without widening whole-file exemptions.

The only confirmed ordinary old production paths newly reaching a throwing stub are the two consultation paths. Mailbox/state switch throws are confined to new events/variants; new tool handlers and new ports are new entry points. Claim, entry, requeue and evidence old methods have not been wired to the new throwing settings methods. Collaboration startup currently bypasses its ordering stub through the singleton shortcut.

The **ten current passing runs** are therefore: PC05 and RT03/05/07 are valid existing-behavior checks; PC01 passes through the wrong no-request path; PC09 is incomplete; RC11 ×2 genuinely check legacy decoding but omit required compatibility evidence; UM12 ×2 test the wrong replay operation. The **nine AssertionError failures** comprise the four correct-but-incomplete RC expectations ×2, plus TU05’s correct formatter expectation with an invalid fixture.

| Test file | IDs found = expected | Rows checked | Declared runs |
|---|---|---:|---:|
| `tests/state/S5-goal-settings.test.ts` | GS01–15 | 15/15 | 15 |
| `tests/state/S5-decision-policy.test.ts` | PO01–16 | 16/16 | 16 |
| `tests/state/S5-message-decision.test.ts` | MD01–14 | 14/14 | 14 |
| `tests/state/S5-request-candidate.test.ts` | PC01–10 | 10/10 | 10 |
| `tests/state/S5-notice-settings.test.ts` | NS01–08 | 8/8 | 8 |
| `tests/work-graph/S5-goal-settings.test.ts` | SS01–16 | 16/16 | 32 |
| `tests/work-graph/S5-user-messages.test.ts` | UM01–13 | 13/13 | 26 |
| `tests/work-graph/S5-request-candidates.test.ts` | RC01–11 | 11/11 | 22 |
| `tests/work-graph/S5-decision-queue.test.ts` | DQ01–09 | 9/9 | 18 |
| `tests/work-graph/S5-decision-application.test.ts` | AP01–09, AP12–16 | 14/14 | 28 |
| `tests/work-graph/S5-notices.test.ts` | NR01–08 | 8/8 | 16 |
| `tests/app/S5-decision-routes.test.ts` | RT01–08 | 8/8 | 8 |
| `tests/runtime/S5-user-message-tools.test.ts` | TU01–07 | 7/7 | 7 |
| `tests/business/S5-decision-workflow.test.ts` | WF01–02 | 2/2 | 2 |
| `tests/scenarios/S5-two-request-decisions.test.ts` | SC01 | 1/1 | 1 |
| `tests/scenarios/S5-goal-conflict-rework.test.ts` | SC02 | 1/1 | 1 |
| **Total** | **No missing/extra IDs; AP10/11 absent correctly** | **153/153** | **224** |

All six service files contain a same-file SQLite reopen branch—SS10, UM13, RC08, DQ09, AP06 and NR06—but several cannot reach it under a conforming implementation, and several do not verify the required persisted behavior afterward. All three changed existing test files were also reviewed.