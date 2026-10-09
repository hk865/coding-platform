**FILES**

Changed only:

- [S5-request-candidate.test.ts](D:/cxt/impl-s5-fxS/tests/state/S5-request-candidate.test.ts)
- [S5-goal-settings.test.ts](D:/cxt/impl-s5-fxS/tests/state/S5-goal-settings.test.ts)
- [S5-notice-settings.test.ts](D:/cxt/impl-s5-fxS/tests/state/S5-notice-settings.test.ts)
- [S5-message-decision.test.ts](D:/cxt/impl-s5-fxS/tests/state/S5-message-decision.test.ts)

All 47 case IDs remain. No helper file created. Hash comparison confirmed no other files changed. No Node, npm, npx, tests, or typecheck ran.

**PER CASE**

Results below are static expectations. **R** means the first failure is missing `requestRef`/slot effects in `proposal_recorded`, before the later transition.

| Case | Status and construction | Expected first part-1 result |
|---|---|---|
| PC01 | REWRITTEN — record U1; exact candidate and slot claim | R |
| PC02 | REWRITTEN — record U1, replace with U3; both records/events and transfer | R |
| PC03 | REWRITTEN — record U1, replace with pin 0; no next/effects | R |
| PC04 | REWRITTEN — record Q1/U1 and Q2/U2; reject cross-request replacement | R |
| PC05 | REWRITTEN — Host recording against PB0, then derive stale | Passes: existing Host/stale behavior |
| PC06 | REWRITTEN — record both heads, adopt U1; release Q1 and derive U2 stale | R |
| PC07 | REWRITTEN — record U2, attempt adoption against PB2 | R |
| PC08 | REWRITTEN — record U2, abandon stale head; complete terminal metadata | R |
| PC09 | REWRITTEN — independent recordings; exact effects exclude slots | Passes: existing independent recording |
| PC10 | REWRITTEN — record U2, then unchanged read and cancelled verdict | R |
| GS01 | REWRITTEN — legacy codec round trip and real default reader | `readGoalSettings` |
| GS02 | REWRITTEN — active settings transition; exact next/effects | `transitionGoalSettings` |
| GS03 | REWRITTEN — paused settings transition; exact next/effects | `transitionGoalSettings` |
| GS04 | REWRITTEN — cancelled refusal; unchanged input | `transitionGoalSettings` |
| GS05 | REWRITTEN — automation refusal; no next/effects | `transitionGoalSettings` |
| GS06 | REWRITTEN — select wait, reorder B/A, then check claim | `transitionGoalSettings` |
| GS07 | REWRITTEN — cancellation constructor and predecessor projection | `goalStartPolicy` |
| GS08 | REWRITTEN — real GoalPhase constructor/projection for PA1 versus PA0 | `goalStartPolicy` |
| GS09 | REWRITTEN — establish A→B, then refuse B→A | `transitionGoalSettings` |
| GS10 | REWRITTEN — waiting Goal query/dispatch predicates | `goalStartPolicy` |
| GS11 | REWRITTEN — canonical footprint inputs, module/file overlap | `goalConflictFacts` |
| GS12 | REWRITTEN — identical unattributed file footprints | `goalConflictFacts` |
| GS13 | REWRITTEN — module versus uncertain unattributed file | `goalConflictFacts` |
| GS14 | REWRITTEN — pause/resume constructors, basis comparison, B@9 settings transition | `goalDecisionBasisMatches` |
| GS15 | REWRITTEN — pointer change/resume, basis mismatch, refused migration | `goalDecisionBasisMatches` |
| NS01 | REWRITTEN — legacy codec round trip and production default reader | `effectiveWorkspaceDecisionSettings` |
| NS02 | REWRITTEN — forward transition; exact Workspace@4/effects | `transitionNoticeSettings` |
| NS03 | REWRITTEN — establish pos10 through transition, then same-position no-op | `transitionNoticeSettings` |
| NS04 | REWRITTEN — establish pos10, then backward no-op | `transitionNoticeSettings` |
| NS05 | REWRITTEN — automation guard refusal | `transitionNoticeSettings` |
| NS06 | REWRITTEN — invalid-token guard refusal | `transitionNoticeSettings` |
| NS07 | REWRITTEN — uncovered-category refusal; no next/effects | `transitionNoticeSettings` |
| NS08 | REWRITTEN — stale-pin refusal against Workspace@3 | `transitionNoticeSettings` |
| MD01 | REWRITTEN — adviser policy, send transition and real constructor; partial | `canSendUserMessage` |
| MD02 | REWRITTEN — executor policy feeds send guard | `canSendUserMessage` |
| MD03 | REWRITTEN — codec-backed pending card, answer transition/record writer | `encodeUserDecisionBody` |
| MD04 | REWRITTEN — read constructor, defer answer, preserved readAt | `encodeUserDecisionBody` |
| MD05 | REWRITTEN — production body encoding, answer and decoded text | `encodeUserDecisionBody` |
| MD06 | REWRITTEN — canonical object key, answer and decoded annotation | `encodeUserDecisionBody` |
| MD07 | REWRITTEN — pending card and invalid-selection guard | `transitionMessage user_decision_answered` |
| MD08 | REWRITTEN — pending card and foreign-annotation guard | `transitionMessage user_decision_answered` |
| MD09 | REWRITTEN — pending card and work-run/operator mismatch | `transitionMessage user_decision_answered` |
| MD10 | REWRITTEN — paused-compatible answer; exact effects exclude Plan/Run writes | `encodeUserDecisionBody` |
| MD11 | REWRITTEN — synthetic transition and observable effects; partial | `transitionMessage synthetic_decision_answered` |
| MD12 | REWRITTEN — establish defer response through answer path, refuse application | `encodeUserDecisionBody` |
| MD13 | REWRITTEN — establish accept response, apply proof through transition/writer | `encodeUserDecisionBody` |
| MD14 | REWRITTEN — establish accept response, refuse mismatching proof | `encodeUserDecisionBody` |

**FINDINGS**

- **DONE — PC01/02/09:** request association, complete replacement record, exact business effects and slot counts checked.
- **DONE — D2:** actor/time fields, `adoptionPolicy`, rejection effects, adoption release and abandonment metadata updated.
- **DONE — GS01:** production default read replaces the default-value write.
- **DONE — GS14:** actual control constructors and settings transition replace manufactured proof.
- **DONE — NS01:** real decoder/default reader replaces local fallback.
- **NOT DONE fully — MD01:** returned constructor fields are checked; Goal/decision output remains unobservable through the frozen constructor.
- **NOT DONE fully — MD11:** synthetic transition is exercised; fabricated record assertions removed, but complete synthetic construction lacks a production entry.
- **DONE — identities/source keys:** normalized fixtures; source keys use `decisionSourceKey` with natural identity.
- Also replaced the inadmissible empty plan draft with a legal `plan_only` task and real admission validators.

**UNDETERMINED**

- **MD01 — spec lines 506, 979:** `NewSessionMessageInput` cannot accept `goalRef` or `decision`; transition state exposes neither. A production constructor contract is needed for complete output coverage.
- **MD11 — spec lines 228, 508, 989:** no pure constructor accepts synthetic source/operator/body data and returns responded@1. The effect union also lacks an answer-slot claim. Sender and `syntheticAnswer` cannot currently be asserted from production output.
- **MD04 — spec line 982:** the stipulated user-card `read@2` is expressible through the record constructor, but `ackMessage` rejects user recipients and ordinary reads do not acknowledge. Its production owner history is unspecified.

**RISKS**

- [Message fixture:121](D:/cxt/impl-s5-fxS/tests/state/S5-message-decision.test.ts:121): pending metadata uses the real codec because of the MD01 constructor gap.
- [Message fixture:322](D:/cxt/impl-s5-fxS/tests/state/S5-message-decision.test.ts:322): MD04 uses the stipulated pure-state precondition, not a claimed mailbox acknowledgement.
- [goal-machine.ts:118](D:/cxt/impl-s5-fxS/src/core/work-graph/state/goal-machine.ts:118): currently drops settings during control changes; GS14/15 require the specified part-2 preservation fix.
- Runtime and TypeScript validation remain for the lead; none were executed here.