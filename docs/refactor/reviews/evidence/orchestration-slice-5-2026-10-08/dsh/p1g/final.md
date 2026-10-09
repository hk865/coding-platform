## FILES CHANGED

New files (`N`), all 41 in the write scope (23 source + 16 test + 2 support):
```
N src/business/workflow/decision-actions.ts
N src/contracts/goal-decisions.ts
N src/contracts/platform-duty.ts
N src/core/work-graph/communication/decision-application.ts
N src/core/work-graph/communication/decision-service.ts
N src/core/work-graph/communication/decision-source-facts.ts
N src/core/work-graph/configuration/decision-settings-service.ts
N src/core/work-graph/configuration/message-duties-adapter.ts
N src/core/work-graph/model/decision-contracts.ts
N src/core/work-graph/persistence/decision-record-codecs.ts
N src/core/work-graph/state/decision-policy.ts
N src/core/work-graph/state/goal-settings-machine.ts
N src/core/work-graph/state/notice-settings-machine.ts
N src/core/work-graph/tasks/executed-files-stub.ts
N src/core/work-graph/tasks/goal-decision-reader.ts
N src/core/work-graph/tasks/goal-settings-service.ts
N src/core/work-graph/tasks/planning-question-reader.ts
N src/core/work-graph/tasks/request-facts-reader.ts
N src/core/work-graph/views/automatic-rework-notices.ts
N src/core/work-graph/views/decision-read-model.ts
N src/core/work-graph/views/goal-conflicts.ts
N src/core/work-graph/views/notice-display-token.ts
N src/core/work-graph/views/notice-position.ts
N tests/state/S5-goal-settings.test.ts
N tests/state/S5-decision-policy.test.ts
N tests/state/S5-message-decision.test.ts
N tests/state/S5-request-candidate.test.ts
N tests/state/S5-notice-settings.test.ts
N tests/work-graph/S5-goal-settings.test.ts
N tests/work-graph/S5-user-messages.test.ts
N tests/work-graph/S5-request-candidates.test.ts
N tests/work-graph/S5-decision-queue.test.ts
N tests/work-graph/S5-decision-application.test.ts
N tests/work-graph/S5-notices.test.ts
N tests/app/S5-decision-routes.test.ts
N tests/runtime/S5-user-message-tools.test.ts
N tests/business/S5-decision-workflow.test.ts
N tests/scenarios/S5-two-request-decisions.test.ts
N tests/scenarios/S5-goal-conflict-rework.test.ts
N tests/helpers/S5-decision-fixture.ts
N tests/scenarios/support/S5-decisions.ts
```
Modified scope files (`C`) — 39 of the 41 (all but `src/core/work-graph/state/goal-machine.ts` (F87 body deferred to part 2) and `tests/architecture/production-reach-allowlist.json` (part 2)):
```
C src/app/collaboration-driver.ts
C src/app/core-http-types.ts
C src/app/core-routes.ts
C src/business/workflow/consultation.ts
C src/business/workflow/contracts.ts
C src/business/workflow/ports.ts
C src/business/workflow/workflow.ts
C src/composition/create-platform.ts
C src/contracts/core/session-message.ts
C src/contracts/ledger.ts
C src/contracts/plan.ts
C src/core/agent-runtime/communication-tools.ts
C src/core/agent-runtime/execution-contracts.ts
C src/core/agent-runtime/execution-driver.ts
C src/core/agent-runtime/execution-inputs.ts
C src/core/work-graph/communication/mailbox-service.ts
C src/core/work-graph/configuration/project-bootstrap-record-codecs.ts
C src/core/work-graph/evidence/evidence-service.ts
C src/core/work-graph/model/communication-contracts.ts
C src/core/work-graph/model/plan-contracts.ts
C src/core/work-graph/persistence/evidence-record-codecs.ts
C src/core/work-graph/persistence/plan-record-codecs.ts
C src/core/work-graph/persistence/record-codecs.ts
C src/core/work-graph/persistence/rework-codecs.ts
C src/core/work-graph/queries/query-record-codecs.ts
C src/core/work-graph/sessions/message-body-envelope.ts
C src/core/work-graph/sessions/message-record-codecs.ts
C src/core/work-graph/state/message-machine.ts
C src/core/work-graph/state/plan-machine.ts
C src/core/work-graph/tasks/claim-record-codecs.ts
C src/core/work-graph/tasks/claim-service.ts
C src/core/work-graph/tasks/execution-entry-service.ts
C src/core/work-graph/tasks/initial-plan.ts
C src/core/work-graph/tasks/plan-commit-compiler.ts
C src/core/work-graph/tasks/plan-readers.ts
C src/core/work-graph/tasks/plan-service.ts
C src/core/work-graph/tasks/requeue-service.ts
C src/ui/views/execution/actions.ts
C tests/architecture/state-writes.test.ts
```
The 6 A1 files (kept, each limited to the type-forced change):
```
C src/contracts/query-job.ts                       (InitialPlanAnswerFacts moved here; re-exported by tasks/initial-plan.ts)
C src/core/work-graph/queries/query-job-service.ts ('kind' in recipient narrowing)
C src/ui/views/sessions/render.ts                  (response-union sender narrowing)
C src/ui/api/routes.ts                             (12 ROUTE_LABELS entries)
C tests/app/orchestration-mechanism.test.ts        (response-union sender narrowing)
C tests/state/message-machine.test.ts              (partial EVENT_COVERAGE; old assertion text restored, item 19)
```
`sha256sum src/contracts/platform-duty.ts` = `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39` (318 bytes).

## CHECKS

**`npm run typecheck`** — before: exit 0; after: **exit 0** (both tsconfigs).
**`npm run check:architecture`** — before: exit 0; after: **exit 0**, `next source boundaries: OK` (`views` submodule present).
**`npx vitest run tests/app/AG2-consultation.test.ts`** — base: 4 passed; after: **4 passed / 4** (was 4 failing with HTTP 500 before the B1 fix).
**New-tests command (16 files)** — after: `Test Files 15 failed | 1 passed (16)`, `Tests 209 failed | 15 passed (224)`. Per-file runs match the table exactly: state 15/16/14/10/8 = 63; work-graph 32/26/22/18/28/16 = 142; routes 8; runtime 7; workflow 2; scenarios 1+1 = 2. No compile, fixture, setup or timeout failure (`0` hits for unregistered schema / Cannot find / TypeError / timeout / admission-forbidden).
Passing ids (15 runs; one file passes entirely):
`RT01, RT02, RT03, RT04, RT05, RT06, RT07, RT08` (the routes file, 8/8), `PC01, PC05, PC09, PC10, TU07, UM12` (memory+sqlite).
Failing ids and first failure line — 139 unique ids, 209 runs (both backends unless noted):
```
DecisionMessagePort.answerDecision: AP01, AP02, AP08, DQ04, DQ05, DQ06, UM06, UM07, UM08, UM09, UM10, UM11, UM13
DecisionMessagePort.recordDecisionApplication: AP04
DecisionReadPort.queryDecisionQueue: DQ01, DQ03, DQ07, DQ09, NR02, NR03, NR06
RequestCandidatePort.abandonPlanProposal: DQ02, RC06
DecisionReadPort.readDecisionCard: DQ08
DecisionNoticeSourcePort.readPage: NR01, NR07, NR08
decodeNoticeOrigin: NR04 ; NoticePositionComparatorPort.compare: NR05
transitionGoalSettings: GS01, GS02, GS03, GS04, GS05, GS09
goalStartPolicy: GS06, GS07, GS08, GS10 ; goalConflictFacts: GS11, GS12, GS13 ; goalDecisionBasisMatches: GS14, GS15
transitionMessage user_decision_answered: MD03–MD10 ; synthetic_decision_answered: MD11 ; decision_application_recorded: MD12–MD14
buildWorkspaceDecisionSettingsRecord: NS01 ; transitionNoticeSettings: NS02–NS08
transitionPlanProposal proposal_replaced: PC02, PC03, PC04 ; proposal_adopted: PC06, PC07 ; proposal_abandoned: PC08
decisionActionPolicy: PO01–PO12 ; canSendUserMessage: MD01, MD02, PO13–PO16
candidateRequestRef: RC09, RC11 ; RequestCandidatePort.readRequestCandidate: RC01, RC08, RC10, SC01
DecisionReadPort.queryGoalConflicts: SC02
GoalSettingsPort.resolveGoalConflict: SS06, SS07, SS11
send_user_message: TU01, TU02, TU03 ; DecisionMessagePort.readDecisionAnswer: TU04 ; read_user_decision: TU06
SessionMailboxPort.sendUserMessage: UM01–UM05
GoalSettingsPort.setGoalSettings: AP05, SS01, SS02, SS03, SS08, SS09, SS10, SS12, SS13, SS14, SS15, SS16, WF01
GoalSettingsPort.reorderGoals: AP03, AP06, AP09, AP12, AP13, AP14, AP15, AP16, SS04, SS05, WF02
expected value not produced yet (AssertionError):
  AP07, RC05  expected { status:'rejected' } to match { status:'committed' } (real plan owner unsupported / adoption not admissible)
  RC02 expected [] to deeply equal [ Array(1) ] ; RC03, RC07 expected committed to match rejected
  RC04 expected [] to have length 1
  TU05 expected raw body to be '用户答复\n'+canonicalJson(body)
```
**Regression command (25 files)** — before: `Test Files 3 failed | 22 passed`, `Tests 7 failed | 1926 passed`; after: `Test Files 4 failed | 21 passed`, `Tests 8 failed | 1925 passed`. All baseline per-file numbers unchanged; the 7 baseline scenario failures are the same 7. `tests/architecture/state-writes.test.ts` **19 passed / 0 failed**. `tests/architecture/production-reach.test.ts` baseline 4 passed → now **3 passed / 1 failed**, reporting **116 unreached declarations** (24 `core-http-types.ts`, 20 `model/decision-contracts.ts`, 16 `persistence/decision-record-codecs.ts`, 8 `goal-settings-machine.ts`, 6 `notice-settings-machine.ts`, and the rest across the new views/tasks/state/workflow files — expected until part 2).

## UNSPECIFIED

**Final guard field sets (A8):**
- `MessageUserSendFacts`: `goalScopeMatches, dutiesAllowSend, decisionParamsValid`.
- `MessageDecisionAnswerFacts`: `operatorMatches, messagePinMatches, goalNotCancelled, selectionValid, annotationsFromObjects, sourceFactsMatch, sourceNotUiOnly, answerSlotEmpty`.
- `MessageDecisionApplicationFacts`: `receiptReadable, changedBeforeMatchesReceipt, receiptAfterMatches, answerAssociationExists, modifierOrOperator, requiresApplication`.
- `PlanRequestCandidateFacts` (unchanged, 16): `requestRootSameGoal, replacesIsNull, slotExpectedOwnerIsNull, headMatches, headRevisionMatches, requestGoalMatches, replacesComplete, firstPlanUserOnly, slotOwnerMatches, basedOnIsActivePointer, operatorMatches, headPinMatches, goalNotCancelled, storedTerminalStatus, goalCancelled, basedOnDerivesStale`.

**A6 factory/adapter names:** `createGoalDecisionCauseReader(deps)` / `createPlanningQuestionReader(deps)`; `GoalDecisionCauseReaderDependencies` = `{ records; plans: Pick<PlanTaskPort,'queryGoalDisplay'|'readInitialPlanAnswerFacts'> }`, `PlanningQuestionReaderDependencies` = `{ records; plans: Pick<PlanTaskPort,'readInitialPlanAnswerFacts'> }`; reader interfaces `GoalDecisionCauseReader` / `PlanningQuestionReader`; views adapters `createGoalCauseCardSource(reader)` / `createPlanningQuestionCardSource(reader)` in `views/decision-read-model.ts`; `create-platform.ts` wires both (plus the automatic-rework notice source). No free dependency-free reader remains.

**Settled by A1 but relevant:** the 6 out-of-scope files are as listed above (A1); A5 (SentEventBase move) accepted; A7 single `decodeNoticeOrigin` export in `persistence/decision-record-codecs.ts` (sessions re-exports).

**Not settled / deviations I had to choose:**
- `decisionSourceKey` is now a real pure canonical constructor (`canonicalJson({kind, key, goalRef, pins, goalBases?})`) because A9 requires tests/fixture to build keys with it; the `key` field carries the natural per-kind identity before derivation.
- The fixture's trusted Run permissions were widened to `['read', ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES]` so the real mailbox admission lets UM01/UM03/UM10/UM12 and TU01 reach the owners (item 9/15 required a Run that may ack/send/respond). `openS5DecisionFixture(kind, {duties, operatorActor})` and `observeRecords`/`fixture.counts` are the new hooks.
- **SC02 blocker:** the harness work/runtime grant has no `requeue_task` (GAP-46), so the "real agent requeue" cannot produce its 3rd notice without editing `tests/scenarios/harness.ts` or `tests/helpers/AG2b-collaboration-fixture.ts`, both outside this round's write scope. The test currently reaches the real owners and fails only at the read stub; part 2 must either extend the grant or the lead must authorize a different SC02 third-notice path.
- **PC02/PC08 interface gaps:** `transitionPlanProposal` has a single `next`, so "U1 not_adopted@2" is not observable beside the new head U3 (asserted via U3 + slot transfer); `proposal_abandoned`/`PlanProposalGuardContext` carry no `requestedBy`/`at`, so a full `notAdopted` cannot be built by the pure machine (asserted with `toMatchObject`).
- **DQ01** `waitingAnswer=6` needs a seeded answered QueryJob (planning_question) and an overlapping footprint (goal_conflict); unverifiable with the stubs.
- Pause/cancel/finalized-round preconditions are seeded with `seedCommit` + real codecs, not the literal owner entries, because the fixture does not register `COMPLETION_RECORD_SCHEMAS`/`EVIDENCE_RECORD_SCHEMAS`; the NR file extends the shared claim bundle at module load (cleaner: register evidence schemas in the fixture).
- `proposal_recorded`'s `requestRef`/`replaces` are optional per SPEC §2.4 line 266; the §3.2 adopting-action verdict was not added as a new plan guard field (A8 said keep the rest).
- A10: existing codec/tool/pump bodies implemented earlier remain; no new behaviour was added except `decisionSourceKey` and the fixture permission admission above.

## NOTES

1. B1 fix: both `consultation.ts` entries use `'kind' in message.recipient` in place of the throwing `isUserMessageRecipient` stub; the ordinary Session path no longer reaches any stub, and AG2-consultation is back to 4/4.
2. B2 fix: the `orderAdvanceSelection` await now runs before the `handles.get` busy check, so check-and-`handles.set` are one synchronous block again.
3. `tests/state/message-machine.test.ts` keeps the old coverage assertion byte-identical and resolves the widened union with `Partial<Record<…>>` (item 19).
4. The routes file passes 8/8; the remaining failures are the expected part-1 stubs or the "expected value not produced yet" set (AP07, RC02–RC05, RC07, TU05).
5. `decisionSourceKey` being implemented means the fixture's two message sources now carry distinct canonical keys.
6. Part 2 still owes: `goal-machine.ts` F87 settings preservation, the production-reach allowlist, and the `operatorActor`/`decisionDuties` composition wiring.
7. `.dsh-scratch/` is left in place for part 2 (deleted there).