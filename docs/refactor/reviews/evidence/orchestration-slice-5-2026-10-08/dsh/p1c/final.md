## FILES CHANGED

New files (`N`), all inside the write scope — 23 source + 16 tests + 2 support:
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
Modified files (`C`), inside the write scope (38 source + the one named test):
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
Not modified in part 1 (in scope): `src/core/work-graph/state/goal-machine.ts` (F87 body change deferred to part 2 because part 1 forbids changing existing bodies) and `tests/architecture/production-reach-allowlist.json` (part 2 by the task).

`sha256sum src/contracts/platform-duty.ts` = `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39` (318 bytes, ASCII, LF, one final newline).

## CHECKS

**`npm run typecheck`** — before (untouched copy): exit 0. After: **exit 0** (both `tsconfig.json` and `tsconfig.ui.json`).

**`npm run check:architecture`** — before: exit 0. After: **exit 0**, last line `next source boundaries: OK`; `views` submodule present (43 submodule edges); `pure submodules: WorkGraph/state`.

**New-tests command (16 files)** — before: files did not exist. After: `Test Files 16 failed (16)`, `Tests 214 failed | 10 passed (224)`. Per-file runs exactly match the table:
```
S5-goal-settings (state) 15/15 fail   S5-decision-policy 16/16   S5-message-decision 14/14
S5-request-candidate 10 (7 fail)      S5-notice-settings 8/8
S5-goal-settings (work-graph) 32/32   S5-user-messages 26 (24 fail)
S5-request-candidates 22 (20 fail)    S5-decision-queue 18/18
S5-decision-application 28/28         S5-notices 16/16
S5-decision-routes 8 (5 fail)         S5-user-message-tools 7/7
S5-decision-workflow 2/2              S5-two-request-decisions 1/1
S5-goal-conflict-rework 1/1
```
Passing ids (10 runs): **PC01, PC05, PC09, RT03, RT05, RT07, RC11 (memory+sqlite), UM12 (memory+sqlite)**.
Failing ids and first failure line (memory and sqlite identical unless noted):
```
GS01–05 transitionGoalSettings; GS09 transitionGoalSettings
GS06,07,08,10 goalStartPolicy; GS11–13 goalConflictFacts; GS14–15 goalDecisionBasisMatches
PO01–12 decisionActionPolicy; PO13–16 canSendUserMessage
MD01–02 canSendUserMessage; MD03–10 transitionMessage user_decision_answered;
MD11 transitionMessage synthetic_decision_answered; MD12–14 transitionMessage decision_application_recorded
PC02–04 transitionPlanProposal proposal_replaced; PC06–07 proposal_adopted; PC08 proposal_abandoned; PC10 proposal_read
NS01 buildWorkspaceDecisionSettingsRecord; NS02–08 transitionNoticeSettings
SS01,02,03,08,09,10,12,13,14,15,16 GoalSettingsPort.setGoalSettings; SS04–05 reorderGoals; SS06,07,11 resolveGoalConflict
UM01–05 SessionMailboxPort.sendUserMessage; UM06–11,13 DecisionMessagePort.answerDecision
RC01,05,08,10 RequestCandidatePort.readRequestCandidate; RC06 abandonPlanProposal; RC09 candidateRequestRef;
RC02,03,07 AssertionError committed-vs-rejected; RC04 AssertionError 1-vs-2 (expected value not produced)
DQ01–07,09 DecisionReadPort.queryDecisionQueue; DQ08 DecisionReadPort.readDecisionCard
AP01,02,08 DecisionMessagePort.answerDecision; AP03–07,09,12–16 recordDecisionApplication
NR01,07,08 DecisionNoticeSourcePort.readPage; NR02 mergeNoticePages; NR03 NoticeDisplayTokenPort.issue;
NR04,06 WorkspaceDecisionSettingsPort.markNoticesSeen; NR05 NoticePositionComparatorPort.compare
RT01,08 DecisionReadPort.queryDecisionQueue; RT02 WorkflowPort.resolveDecision;
RT04 RequestCandidatePort.abandonPlanProposal; RT06 WorkspaceDecisionSettingsPort.markNoticesSeen
TU01–03 not implemented: send_user_message; TU04 formatDecisionResponseInput; TU06 read_user_decision;
TU07 isUserMessageRecipient; TU05 AssertionError raw body vs '用户答复\n'+canonicalJson (expected value not produced)
WF01 GoalSettingsPort.setGoalSettings; WF02 GoalSettingsPort.reorderGoals
SC01 RequestCandidatePort.readRequestCandidate; SC02 DecisionReadPort.queryGoalConflicts
```
No compile, fixture, setup or timeout failures (`0` hits for unregistered schema / Cannot find / TypeError / timeout).

**Regression command (25 files)** — before: exit 1; `Test Files 3 failed | 22 passed (25)`, `Tests 7 failed | 1926 passed (1933)`. After: exit 1; `Test Files 4 failed | 21 passed (25)`, `Tests 8 failed | 1925 passed (1933)`.
- All baseline per-file numbers unchanged (message-machine 93, plan-machine 228, task-failure 154, task-machine 1084, verification-machine 138, C1 50, C2 7, R3a 4, R3c-plan-adoption 2, W1 7, W2 26, R5b-initial-plan 2, R5b-query-job 8, A2-goal-control 9, A2-requeue 8, R3e 20, R3c-canonical 2, boundaries 29, lookup 9, transaction-extensions 16).
- The 7 baseline scenario failures are still exactly the same 7 (A4 ×4, C8-auto-rework-cap ×1, C8-human-stop-respected ×2).
- `tests/architecture/state-writes.test.ts`: **19 passed / 0 failed** (unchanged).
- `tests/architecture/production-reach.test.ts`: baseline 4 passed; now **3 passed / 1 failed** — the new slice-5 declarations are not yet reachable from a production entry point. It reports **118 unreached declarations**, grouped by file: `core-http-types.ts` 24, `model/decision-contracts.ts` 21, `persistence/decision-record-codecs.ts` 16, `state/goal-settings-machine.ts` 8, `state/notice-settings-machine.ts` 6, `sessions/message-body-envelope.ts` 5, `views/notice-position.ts` 4, `configuration/message-duties-adapter.ts` 4, `contracts/goal-decisions.ts` 4, `views/goal-conflicts.ts` 3, `state/decision-policy.ts` 3, `sessions/message-record-codecs.ts` 3, `business/workflow/decision-actions.ts` 3, and 1–2 each in `tasks/plan-readers.ts`, `tasks/request-facts-reader.ts`, `tasks/planning-question-reader.ts`, `tasks/goal-decision-reader.ts`, `persistence/{record,plan-record,rework}-codecs.ts`, `model/plan-contracts.ts`, `communication/decision-application.ts`, `agent-runtime/execution-inputs.ts`, `contracts/platform-duty.ts`. This is the expected part-1 state; the allowlist update is part 2.

## UNSPECIFIED

**Changed files outside the write scope (continuation requirement):**
- `src/contracts/query-job.ts` — `InitialPlanAnswerFacts` moved here from `tasks/initial-plan.ts` because `model/plan-contracts.ts` and `model/decision-contracts.ts` must name it and `module-target.json` allows `model -> state` only, so the spec's `model -> tasks` import is a forbidden edge (`npm run check:architecture`).
- `src/core/work-graph/queries/query-job-service.ts` — the `MessageRecipient` widening broke `recipient.sessionId`; added a `'kind' in recipient` narrowing guard.
- `src/ui/views/sessions/render.ts` — `SessionMessage.response` now includes `UserMessageResponseV1`, whose sender has no `sessionRef`; added a `sender.kind === 'host'` narrowing guard.
- `tests/app/orchestration-mechanism.test.ts` — same response-union widening; added a sender narrowing guard.
- `tests/state/message-machine.test.ts` — `MessageEvent` gained 3 members; the total `EVENT_COVERAGE: Record<MessageEvent['type'], EventName>` map and its sorted assertion needed the 3 new keys (no new test runs).
- `src/ui/api/routes.ts` — `ROUTE_LABELS` is a total `Record<CoreRouteSuffix, string>`; the 12 new suffixes forced 12 additive labels.

**Guard fields added by the state machines (names chosen here, for lead freeze):**
- `MessageUserSendFacts`: `goalScopeMatches, dutiesAllowSend, decisionParamsValid, goalStartNotRequired`.
- `MessageDecisionAnswerFacts`: `operatorMatches, messagePinMatches, goalNotCancelled, selectionValid, annotationsFromObjects, pausedAnswerable, sourceFactsMatch, sourceNotUiOnly, answerSlotEmpty`.
- `MessageDecisionApplicationFacts`: `receiptReadable, changedBeforeMatchesReceipt, capturedPinsAreReadGuards, receiptAfterMatches, answerAssociationExists, modifierOrOperator, noFakeCurrentPass, requiresApplication`.
- `PlanRequestCandidateFacts`: `requestRootSameGoal, replacesIsNull, slotExpectedOwnerIsNull, headMatches, headRevisionMatches, requestGoalMatches, replacesComplete, firstPlanUserOnly, slotOwnerMatches, basedOnIsActivePointer, operatorMatches, headPinMatches, goalNotCancelled, storedTerminalStatus, goalCancelled, basedOnDerivesStale`.
- Contexts: `MessageGuardContext.userSend?/.decisionAnswer?/.decisionApplication?`, `PlanProposalGuardContext.requestCandidate?`.

**Other names/placements the spec did not fix:** `DEFAULT_GOAL_SETTINGS_V1`, `DEFAULT_WORKSPACE_DECISION_SETTINGS_V1`; `createExecutedFilesStub`, `createCandidateRequestFactsReader`, `createRequestCandidateService`, `readRequestCandidateHead`, `enumerateGoalCandidates`, `TaskClaimGoalSettingsDependencies`, `ExecutionEntryGoalSettingsDependencies`, `PlanRequestSlotChangeV1`, `PlanAcceptanceDecisionProofV1`; `createMessageDutiesFactsAdapter`, `MessageDutiesFactV1`, `MessageDutiesMappingPort`, `MessageDutiesAdapterDependencies`, `AutomaticReverifyPolicyV1`; `createNoticePositionComparator`, `compareNoticePositions`, `mergeNoticePages`, `createNoticeDisplayToken`, `createDecisionReadModel`, `DecisionReadModelDependencies`, `createGoalConflictAssembler`, `GoalConflictAssemblerDependencies`, `readGoalFootprint`, `mapExecutedFilesToModules`, `createAutomaticReworkNoticeSource`; `DecisionActionDependencies`, `DecisionActionsPort`, `UserDecisionBodyEnvelopeV1`, `encodeUserDecisionBody`, `checkUserDecisionBody`, `isUserDecisionAnswerPart`, `decodeStoredUserDecisionBody`; `NoticeOriginWireV1`/`decodeNoticeOrigin`, `readApplicationReceiptFacts` signature, `decodeNoticeOrigin` return type; persistence constants `GOAL_SETTINGS_CHANGED_EVENT`, `WORKSPACE_NOTICE_SEEN_CHANGED_EVENT`, `DECISION_EVENT_SCHEMA_VERSION`, `GOAL_SETTINGS_CHANGED_SCHEMA_ID`, `WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID`, `DECISION_RECORD_SCHEMAS`, `decisionChangeProofProblem`, `goalSettingsChangedEventProblem`, `workspaceNoticeSeenChangedEventProblem`; `S5_SESSION_MESSAGE_LOOKUP_INDEXES` (kept `SESSION_MESSAGE_LOOKUP_INDEXES` byte-unchanged for the frozen C1 assertion).

**Spec ↔ code disagreements (file:line):**
- `slice-5-SPEC.md:510` S5-MSG-05 event column `application_recorded` vs `:492` `decision_application_recorded`; code uses the latter.
- `slice-5-SPEC.md:514` S5-PLAN-03 `proposal_adopted` vs existing `proposal_accepted` (`state/plan-machine.ts:233`); both are now in the union, lead must confirm rename-vs-distinct.
- `slice-5-SPEC.md:516` S5-PLAN-05 `proposal_read` names an event where existing code derives the status purely (`derivePlanProposalStatus`); both coexist now.
- `slice-5-SPEC.md:418` "用已有私有 SentEventBase" is impossible with the model port: the union/base moved to `model/communication-contracts.ts:161` and `sessions/message-record-codecs.ts` re-exports it (module-target forbids `model -> sessions`).
- `slice-5-SPEC.md:616/686` `readApplicationReceiptFacts` is realised as a factory returning `DecisionSourceFactsPort.readApplication`.
- `slice-5-SPEC.md:817` `readInitialPlanAnswerFacts` was declared both as a free function and a `PlanTaskPort` seam; only the optional `PlanTaskPort` method remains (the free model stub was removed as an IO function in `model/`).
- `slice-5-SPEC.md:809/812` `readGoalDecisionCauses`/`readPlanningQuestions` have no deps parameter, so they are free stubs in `tasks/goal-decision-reader.ts` / `tasks/planning-question-reader.ts` with no persistence seam yet; part 2 needs a bound deps/factory or a lead decision.
- `slice-5-SPEC.md:299-329` `MessageWriteOwnerPort.persist` names `SessionMessageEventV1` in a `model` file, which is the forbidden `model -> sessions` edge; resolved by moving the union to `model`.

**Deferred/found-not-connected seams (part 2):** `operatorActor` is not wired by composition (`TargetPlatformOptions` has no operator field), so new user writes will return `unsupported`; `decisionDuties` (`MessageDutiesFactsPort`) is not wired; `decision-read-model` `cardSources` only contains `planning_question` (goal_cause/candidate/message/note/release read `not_available`), `noticeSources` only `automatic_rework`; `orderGoalAdvances` is never invoked in part 1 (the driver has only one pending advance); `RoundSnapshot` (`contracts/verification.ts`) does not declare `since`/`noticeAutomationCap` even though the codec validates/registers them; `ReverifyOutcomeV1` has no `needs_decision` variant; `RoleSpecResolutionV1` carries no digest for the exact `RoleSpecPinV1`; the shared fixture does not register `EVIDENCE_RECORD_SCHEMAS` (NR seeds rounds through a second real claim fixture); UM12's literal `ack→replay` is unreachable because the entered Run's permissions are `['read']` only (implemented as the reachable old-Session receipt replay); AP03–AP16 receipts carry the benign `TrustedScopeSeeded` event, not a real `GoalSettingsChanged`/`PlanRevisionAccepted`; RC02/03/04/07 fail because part-1 `proposePlan` ignores `requestRef`/`replaces` and `plan-commit-compiler` hardcodes `claims: []`; SS16's `goalSettings` dep is declared but unused by `authorizeRuntimeEntry`.
- Note: `decodeNoticeOrigin` was independently placed in both `persistence/decision-record-codecs.ts` and `sessions/message-record-codecs.ts` (two same-named exports, different files) — part 2 must reconcile to one.
- The task text says "the four `views/` files"; SPEC F42–F46 list **five**, all five were created.

## NOTES

- `tests/architecture/state-writes.test.ts` now names `WorkspaceSnapshot.decisionSettings`, `GoalSnapshot.settings`, `SessionMessage.decision/application`, `CandidatePlanProposal/PlanProposal.requestRef/notAdopted`, plus decoders `decodeWorkspaceSnapshot`, `decodeGoalSettingsChangedEvent`, `decodeWorkspaceNoticeSeenChangedEvent`, `workspaceSnapshotFromValue`; it is unscoped allowlist additions, no whole-file widening.
- Slice 1 also edits `tests/architecture/state-writes.test.ts`; the merge must combine both field lists and decoder rows.
- The 10 passing new tests are checks on already-implemented code paths (candidate/legacy decode, route scope/field forwarding, old-message replay); they do not prove new slice-5 behaviour.
- `tests/state/message-machine.test.ts` and `tests/app/orchestration-mechanism.test.ts` were touched only for the widened-union compile guards; the 93 and existing case outcomes are unchanged in the regression run.
- All 214 new-test failures are stub throws (205) or "expected value not produced yet" (9: TU05 + RC02/03/04/07); no fixture, compile or timeout defect was observed.
- `./.dsh-scratch/` is left in place for part 2 (deleted there).