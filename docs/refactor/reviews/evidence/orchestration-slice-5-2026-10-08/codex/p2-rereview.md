**Not ready for acceptance.** Several corrections are sound, but replay, source validation, read consistency, and new regressions remain.

Read-only inspection only; no files changed and no tests, Node, npm, or package scripts run. The lead’s measurements are treated as supplied evidence. L2’s operator fallbacks are accepted.

Below, paths are relative to `src/core/work-graph/` unless explicitly prefixed otherwise. **M-small** = must-fix, estimated under 30 lines; **M-large** = must-fix, larger change. Estimates exclude tests.

**Previous review: all 26 findings**

| # | Status | Current file:line evidence |
|---|---|---|
| 1 | **PARTLY — M-large** | `communication/decision-source-facts.ts:440,485,525` establishes more formal sources; `:198–205` still refreshes non-Goal pins, and `:132–137` permits cause validation without the formal reader. |
| 2 | **FIXED** | `src/app/host.ts:377`, `src/composition/create-platform.ts:464,526,557,560,570` wire the same operator; remaining fallbacks are expressly permitted by L2. |
| 3 | **FIXED** | `src/core/agent-runtime/communication-tools.ts:330`, `communication/decision-service.ts:699–709` preserve the principal and check actual Session membership. Historical-read regression is N6 below. |
| 4 | **PARTLY — M-large** | `views/decision-read-model.ts:223,507` adds scope gates; `:259–262` still reports a same-project foreign-Workspace Goal as missing; `communication/decision-source-facts.ts:455–457` reads an explicit proposal before checking its scope. |
| 5 | **FIXED** | `communication/decision-service.ts:578,627,787`, `communication/mailbox-service.ts:2883–2913`, `tasks/plan-service.ts:2293–2309` enforce required sets and accepted message/Goal CAS. |
| 6 | **PARTLY — M-large** | `communication/mailbox-service.ts:1213–1247` reads objects and checks revisions, but `:1236–1243` fails to establish Workspace ownership for non-Goal records lacking `workspaceId`. |
| 7 | **FIXED** | `tasks/plan-service.ts:1585–1588` recognizes null/null first-plan pointers while retaining operator authorization. |
| 8 | **FIXED** | `tasks/plan-service.ts:1451,3113,3206–3237` carries request/replacement through fingerprint and atomic records/events/claim updates; new replacement crash is N4. |
| 9 | **FIXED** | `tasks/requeue-service.ts:686–705,869`, `evidence/evidence-service.ts:1909,1936–1945`, `tasks/plan-service.ts:2922–2937` enforce owner-level policy with Goal guards. |
| 10 | **PARTLY — M-large** | `src/business/workflow/decision-actions.ts:221–226` preserves captured pair pins, but `:151–178` still reads supplementary pins before replay; owner rebasing remains incomplete at `tasks/goal-settings-service.ts:580–584,648–650`. |
| 11 | **FIXED** | `src/business/workflow/decision-actions.ts:171–178` now supplies GoalPhase; `src/business/workflow/workflow.ts:1485–1493` derives its revision, including absence@0. Retry stability remains finding 10. |
| 12 | **PARTLY — M-small** | `tasks/goal-settings-service.ts:713–719` checks captured ordering; `:638–642` checks only the later Goal’s control state, allowing a paused earlier Goal. |
| 13 | **FIXED** | `tasks/goal-settings-service.ts:229,236–238,510` retains the first enumeration horizon and refuses unfinished enumeration. |
| 14 | **FIXED** | `tasks/goal-settings-service.ts:400–405,686–691` propagates successor-read failures and refuses unfinished traversal. |
| 15 | **PARTLY — M-large** | `src/app/collaboration-driver.ts:900` discards the sorted result; `:492` bypasses admission ordering for null Session hints, although those can select the same Session. |
| 16 | **PARTLY — M-large** | `tasks/goal-decision-reader.ts:203–208` adds Run identity for unknown outcomes; `:211–220` still identifies recurring rework/stop causes using only Task@0. |
| 17 | **PARTLY — M-large** | `tasks/goal-decision-reader.ts:183,239` and `tasks/planning-question-reader.ts:162` propagate specified failures; `views/decision-read-model.ts:677,887,901,918` still converts other unavailable/corrupt sources into absence or partial success. |
| 18 | **FIXED** | `views/decision-read-model.ts:430–450` selects sections before pagination. |
| 19 | **FIXED** | `views/decision-read-model.ts:444–447` resumes notices by position, fixing the acknowledgement/offset skip; the replacement cursor introduces N1. |
| 20 | **PARTLY — M-large** | `views/goal-conflicts.ts:135–156` stabilizes individual lookups, but `views/decision-read-model.ts:457–462` still stamps results with a later watermark; `views/goal-conflicts.ts:260–266` mixes listed Goals with later footprint reads. |
| 21 | **PARTLY — M-small** | `tasks/plan-service.ts:463–467` includes PlanRevision creation; `:432–433` still emits empty changes when acknowledgement exists without `decisionSource`. |
| 22 | **PARTLY — should-fix, small** | `persistence/decision-record-codecs.ts:70,96,154` binds envelopes, but `:260–262` accepts arbitrary `SessionWorkLink.target` objects and relation strings. |
| 23 | **FIXED** | `tasks/plan-service.ts:2221–2228` establishes the formal request before reading its candidate slot. |
| 24 | **PARTLY — should-fix, small** | `tasks/goal-settings-service.ts:726–744` implements risk no-op; `:491` skips cancelled Goals during reorder, leaving incorrect positions; cycle-code discrepancy remains at `state/goal-settings-machine.ts:202,213`. |
| 25 | **FIXED** | `views/automatic-rework-notices.ts:99–105,211–212` labels exempt automatic recovery as uncounted. |
| 26 | **PARTLY — should-fix, large** | `communication/mailbox-service.ts:1621` shares persistence; body storage remains duplicated at `:1392–1516` versus `:2749–2799`, including differing operation identities. |

The cycle-code part of finding 24 is a frozen-contract tension: the specification says `cycle`, while frozen GS09 expects `invalid`. It should be explicitly reconciled, not silently changed under L5.

**Guided items: all 30**

| Item | Status | Current file:line evidence |
|---|---|---|
| G-A1 | **PARTLY** | `communication/decision-source-facts.ts:198–205,440–565` — formal reconstruction improved; non-Goal refresh, scope and historical-source problems remain. |
| G-A2 | **FIXED** | `communication/decision-service.ts:699–709` — actual caller Session membership enforced. |
| G-A3 | **FIXED** | `communication/decision-service.ts:578,627,787`; `communication/mailbox-service.ts:2912` — exact sets and accepted CAS. |
| G-A4 | **PARTLY** | `communication/mailbox-service.ts:1236–1243` — object existence/revision checked, non-Goal Workspace ownership incomplete. |
| G-A5 | **PARTLY** | `communication/mailbox-service.ts:1621,2749` — persistence unified, body-writing implementations remain separate. |
| G-B1 | **FIXED** | `tasks/plan-service.ts:1585–1588` — legitimate initial null/null relationship accepted. |
| G-B2 | **FIXED** | `tasks/plan-service.ts:3113,3206–3237` — request association and replacement transaction retained; see N4. |
| G-B3 | **FIXED** | `tasks/requeue-service.ts:686`; `evidence/evidence-service.ts:1936`; `tasks/plan-service.ts:2922` — modifying owners enforce policy. |
| G-B4 | **PARTLY** | `tasks/goal-settings-service.ts:229,400,726` fixes enumeration/traversal/no-op; `:580,638,648,491` leaves rebase, earlier-active and reorder gaps. |
| G-B5 | **PARTLY** | `tasks/goal-decision-reader.ts:211–220` — Task identity improved, successive Run identity still missing; specified failures now propagate. |
| G-B6 | **PARTLY** | `tasks/plan-service.ts:432–433,463–467` — creation proof added, source-null proof still empty. |
| G-B7 | **FIXED** | `tasks/plan-service.ts:2221–2228` — request existence verified. |
| G-B8 | **FIXED** | `tasks/plan-service.ts:2293–2309` — exact proposal+Goal pins and Goal CAS. |
| G-C1 | **PARTLY** | `views/decision-read-model.ts:223,507` adds gates; `:259–262` retains incorrect foreign-Goal classification. |
| G-C2 | **FIXED** | `views/decision-read-model.ts:430–450` — sections precede paging. |
| G-C3 | **PARTLY** | `views/decision-read-model.ts:444–447` fixes offsets; `:1132–1134` loses previous categories’ continuation positions. |
| G-C4 | **PARTLY** | `views/goal-conflicts.ts:135–156` adds lookup retries; `views/decision-read-model.ts:457–462,677,887` retains watermark/failure defects. |
| G-C5 | **FIXED** | `views/automatic-rework-notices.ts:99–105` — saved counting facts drive the recovery label. |
| G-C6 | **FIXED** | `views/goal-conflicts.ts:186–187`, `views/decision-read-model.ts:304,980` use helpers; helper integration introduces N2. |
| G-D1 | **FIXED** | `state/goal-settings-machine.ts:114–150` validates wait refs and risk entries. |
| G-D2 | **FIXED** | `state/message-machine.ts:1071` establishes the synthetic marker itself. |
| G-D3 | **FIXED** | `persistence/plan-record-codecs.ts:668–675,719–720` permits absence-before@0. |
| G-D4 | **PARTLY** | `persistence/decision-record-codecs.ts:154–159,260–262` — envelope equality fixed, nested ref validation incomplete. |
| G-D5 | **FIXED** | `configuration/decision-settings-service.ts:210` uses the shared effective-settings helper. |
| G-E1 | **PARTLY** | `src/business/workflow/decision-actions.ts:151–178,221–226` — captured pair retained, supplementary inputs remain mutable. |
| G-E2 | **FIXED** | `src/business/workflow/decision-actions.ts:171–178` supplies the required phase pin; replay problem remains G-E1. |
| G-E3 | **FIXED** | `src/business/workflow/workflow.ts:1037–1056` carries Task/Run pins; canonical validation now rejects that cause, N3. |
| G-E4 | **PARTLY** | `src/app/collaboration-driver.ts:492,506,900` — explicit-Session gate added, default selection remains unordered and gate introduces N5. |
| G-E5 | **FIXED** | `src/app/host.ts:377`; `src/composition/create-platform.ts:526,605,644` — operator and autonomy seams wired. |
| G-E6 | **FIXED** | `tests/architecture/production-reach-allowlist.json:1` — none of the four prohibited entries remain; approved wire-format entries remain. |

**New regressions attributable to the correction**

1. **N1 — Notice pagination can loop indefinitely. Must-fix; small.**  
   [decision-read-model.ts:1132](D:/cxt/impl-s5-p2g/src/core/work-graph/views/decision-read-model.ts:1132) builds notice continuation from only the current page, discarding `cursor.notices`. With interleaved positions A1, B1, A2 and limit 1, pages can repeat A1/B1 indefinitely without acknowledgement.  
   **Rule:** §2.5 and §4.1 stable continuation. **Direction:** retain prior per-category positions and advance only categories displayed.

2. **N2 — Abandoned candidates disappear from queue history. Must-fix; large.**  
   [decision-read-model.ts:304](D:/cxt/impl-s5-p2g/src/core/work-graph/views/decision-read-model.ts:304) now exclusively uses `enumerateGoalCandidates`, whose `tasks/plan-readers.ts:609` excludes `not_adopted`. A directly readable closed candidate consequently disappears from queue history.  
   **Rule:** §4.1 and §4.2 source 3. **Direction:** preserve live enumeration and add formal closed-history enumeration, with correct per-request identity.

3. **N3 — Genuine automation-confirmation decisions cannot be answered. Must-fix; large.**  
   [decision-source-facts.ts:373](D:/cxt/impl-s5-p2g/src/core/work-graph/communication/decision-source-facts.ts:373) rejects `automation_confirmation_required`, emitted by `src/business/workflow/workflow.ts:1042–1056`. Adding that code alone is insufficient: `:271–286` demands a matching formal cause that `tasks/goal-decision-reader.ts:61–66,189` never derives.  
   **Rule:** §4.5 line 888 and §4.2 source 2. **Direction:** derive and validate the same automation cause from shared formal Task/Run/policy facts.

4. **N4 — Agent replacement with `basedOn:null` throws. Must-fix; small.**  
   [plan-service.ts:3187](D:/cxt/impl-s5-p2g/src/core/work-graph/tasks/plan-service.ts:3187) skips scoped proposal validation for replacements, then calls `readPlan(input.basedOn!)` at `:3192`; the missing-record path dereferences `ref.planId` at `tasks/plan-readers.ts:434`.  
   **Rule:** S5-PLAN-02; G-B2 must preserve existing admission behavior. **Direction:** apply scoped validation to replacements before reading the source Plan.

5. **N5 — Admission ordering blocks already-completed work behind active handles. Must-fix; large.**  
   [collaboration-driver.ts:498](D:/cxt/impl-s5-p2g/src/app/collaboration-driver.ts:498) treats running and waiting-for-reply handles as competitors; `:684` gates every `select_work`. After `workflow.ts:1403–1407` commits Task completion, its final observation can wait indefinitely behind a higher-priority handle awaiting an external reply.  
   **Rule:** §4.5 line 890 limits ordering to pending claim/create operations. **Direction:** distinguish actual pending admission from already-admitted work and completion/observation.

6. **N6 — Agents lose access to saved answers after candidate adoption. Must-fix; large.**  
   [decision-service.ts:699](D:/cxt/impl-s5-p2g/src/core/work-graph/communication/decision-service.ts:699) authorizes historical reads through live source validation; `communication/decision-source-facts.ts:460–462` rejects accepted candidates. The original proposer therefore loses the answer after acting on it.  
   **Rule:** §4.6 formal reader authorization and preserved answer history. **Direction:** authorize saved-answer reads using the historical proposer/request facts, independently of current answerability.

Two additional must-fixes were found, but their introduction **cannot be attributed to this round** from the supplied snapshots:

- **Actual Agent modifiers cannot record applications — large.** `communication/decision-service.ts:176–178,803` gives every work-run caller a null actor and consequently fails modifier authorization. The Runtime’s ordinary mailbox pre-read also rejects synthetic Host→user answers (`src/core/agent-runtime/communication-tools.ts:533`). **§4.6:** derive the actual modifier and use authorized decision access.
- **Conflict reorder omits changed third Goals from proof — small for proof accounting, larger for the complete protocol.** `tasks/goal-settings-service.ts:788` skips changes lacking captured pins, although `:595–608` writes those Goals. **D8/§3.3:** record every actual change and reconcile the command’s captured scope.

No concrete new protected-field write outside `state/`, or forbidden module import, was found in the inspected paths.

**Judgment on the two reported tensions**

- **Fresh GoalPhase in `conflict_wait`: real unresolved replay defect.** The required phase pin does not justify rebuilding an already-committed settings command from current state. `decision-actions.ts:171–178` changes its fingerprint after a phase update, before the owner can replay `goal-settings-service.ts:539`. There is a genuine missing capture/recovery detail in the protocol, but L4 explicitly requires stable replay; this cannot count as completed. Preserve or reconstruct the original supplementary pins before current-state reads. **Must-fix, large.** Wider `conflict_order` has the same issue for extra Goals at `decision-actions.ts:151–161`.

- **Live-only candidate helper: implementation integration gap, not an unavoidable frozen-test conflict.** L3 permits using the helper or removing the duplicate implementation; it does not require that a live-only helper be the queue’s sole history source. Keep its frozen live behavior and supply closed history separately. `candidateCard` also rejects accepted candidates at `decision-read-model.ts:717`, so merely restoring abandoned rows would remain incomplete. **Must-fix, large.**