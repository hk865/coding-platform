# Round 2 (corrections after the lead's run and the third review): common notes

Read RULES.md (unchanged rules) and `review-rv3.md` (the third review; the lead verified the findings named in your
group file). Your clone already contains every group's round-1 result and these lead changes:

- **D7** `state/message-machine.ts`: `NewSessionMessageInput` has optional `goalRef`/`decision`; new stub
  `createSyntheticDecisionAnswerRecord` (synthetic answer: recipient user, intent notify, syntheticAnswer true,
  responded@1).
- **D8** `PlanTaskPort.applyPlanChange` input has optional `decisionSource?: DecisionSourceV1` = the answer's
  `response.decision.source`, passed by the trusted caller next to `acknowledgementRef`: proof data only (never
  authorization) for the PlanRevisionAccepted `decisionApplication` proof (capturedPins = source.pins; Goal control
  rebase per §2.8; other captured pins must equal current). See the doc comment in `model/plan-contracts.ts`.
- **D9** the `SessionMessageResponded` event validator (`sessions/message-record-codecs.ts`) now also accepts the
  trusted Host actor when the message is a user-recipient decision card whose response carries `decision` (the
  ordinary answer of a message card writes the original response slot with `SessionMessageResponded`, §2.3;
  `SessionMessageDecisionAnswered` is ONLY for synthetic answers of non-message cards).
- **Spec §2.3 (verified):** `source.pins` never contains the message's own pin; an answer request on a message
  card carries the current message pin separately in `meta.expected` (line 625: original message + captured
  source pins). The shared fixture is being corrected IN PARALLEL in exactly these two points (its message
  sources lose the self pin; its answered message gets a `SessionMessageResponded` event): do not depend on a
  self pin inside `source.pins` and do not copy the old pattern.

Measured on the lead's copy after round 1 (memory + SQLite): typecheck 0; 224 runs, 214 fail / 10 pass; all
failures are `not implemented` stubs or missing part-2 behaviour EXCEPT: DQ01/DQ07 fail at setup
(`initial_coordination requires a Goal without an active Plan`, `tests/helpers/S5-queue-support.ts:176`) and SS08
fails at setup (`b-work-2` already has RB's execution, `S5-goal-settings.test.ts:451`). Passing: RT01–05/07,
PC05, PC09, UM12 x2.

Same output format as before (end of RULES.md).
