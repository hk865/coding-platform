# Group 5: decision application (AP) and request candidates (RC)

Read RULES.md first. You may change ONLY `tests/work-graph/S5-decision-application.test.ts`,
`tests/work-graph/S5-request-candidates.test.ts` and create at most ONE new helper
`tests/helpers/S5-application-support.ts`. The shared fixture `tests/helpers/S5-decision-fixture.ts` was just
repaired by another group (read its header and `fxA-result.md` here for the new exports: D1 source constructors,
the coherent answered message with captured pins for Goals A/B, U1 and PB1, the adoptable U1 (PB1 → PB2), the
overlap, `storeSnapshot`, allocation counters). Do not edit it.

Spec: §5.3 AP rows and RC rows (memory + SQLite), §3.1 S5-MSG-04/05 and S5-PLAN-01…05, §3.3
decision-application proof order, recordDecisionApplication, plan-service request slot, pin sets line 625,
§2.4, §2.8, §0.2 L1 (only GoalSettingsChanged and PlanRevisionAccepted proofs; architecture/policy →
`unsupported`).

## Findings — AP (defects 3, 4, 6, 7, 11, 21–23; lead-verified where marked)

- **Operator (defect 3).** `AP:79` builds the decision service without `operatorActor`; configuring the fixture's
  or mailbox's actor does not configure that service. Pass the configured operator to every owner that the row's
  caller uses.
- **Pins (defect 4, verified `AP:127`, `AP:206`).** The reorder receipt helper pins Workspace + Goals; reorderGoals
  = every listed Goal only. AP05's `setGoalSettings` adds a Workspace pin; setGoalSettings = target Goal (+ wait
  target Goal and GoalPhase if non-null). Fix every helper to exactly line 625 and assert each setup result.
- **AP07/RC05 adoption (defect 6).** They failed because the old U1 was inadmissible; the fixture's U1 is now an
  adoptable future revision. Use it through `applyPlanChange` with the decisionRefs/acknowledgementRef the row
  names; AP07's later mutation must be a legitimate later owner write (`AP:148–152,236` rebuilt the old Goal B,
  possibly restoring PB1 after adoption): change the object through its owner again.
- **Proof (defect 7).** AP01 must test the required **goal cause** source (row text), not a candidate (`AP:169`),
  and inspect the unique synthetic-answer claim (`s5-decision-answer:` + canonicalJson({projectId, workspaceId,
  kind, key}), §2.5) — exactly one synthetic message for two entries. AP03 accepts any increasing revisions
  (`:194–196`) and never checks the pending-application decrement: assert the exact before/after pins of the real
  receipt and the queue/pending count change. AP06 must prove its injected message-commit failure hook was
  reached and inspect the intermediate state (object changed, application not recorded, card pending
  application). AP09 must compare the complete application against the actual receipt proof (`:261–263`)
  including the §2.8 control rebase.
- **0 writes / replay (defect 11).** Rejection and replay rows (`AP:202` etc.) use `storeSnapshot()` and the
  allocation counters; AP15 replays deep-equal with unchanged counters; AP16 keeps the application.
- AP13 (another real cursor) and AP16 (application preserved) were improved: keep, add exact assertions.

## Findings — RC (defects 13, 19, 20)

- RC01's enumeration (`RC:64`) is not a queue read: read the real decision queue (candidate cards: one per
  request) as the row says. RC05 must assert the stale Q2 card's actions (regenerate/abandon, §2.4/§4.2 source 3)
  besides the adoption (`:172`). RC06 observes `head:null`, not a released slot (`:197`): prove the release by a
  legitimate subsequent ownership (a new first candidate for Q2 then commits with expectedOwner=null).
  RC08 closes U1 without releasing its seeded unique claim (`:222`): seed/close history consistently (claims match
  owners). RC02's `Promise.all` does not force two empty-slot readers (`:76`): use a commit barrier so both
  writers have read the empty slot before either commits (see `synchronizeB2Commits` in
  `tests/helpers/B2-execution-fixture.ts`). RC07 lacks the persisted zero-write evidence (`:204`): use
  `storeSnapshot()`. RC09/RC11 replays/legacy reads: strict absence of new fields and no new claims.
- RC03 (fault interception) and RC04 (receipt versions, slot transfer) are improved: keep, check they use the D2
  effects semantics (old head not_adopted/replaced + U3@1 + slot transfer in ONE commit).
- RC10's foreign-read observation is fixed: keep.

## Lead measurements on the repaired fixture (2026-10-08 22:35, the copy)

- The fixture's U1 IS adoptable today: `createPlanService(...).applyPlanChange(f.ctx, {input:{proposalRef:
  f.candidates.U1.ref, expectedProposalRevision: 1, decisionRefs: []}, meta:{expected:[{ref: GOAL_B, revision: 7}]}})`
  commits (memory and SQLite) and creates PB2 planRevision 2. Note `plan-service.ts:21`: a FUTURE adoption
  (`basedOn !== null`) is never authorized by a non-empty `decisionRefs` — `AP:133–136` passes `[PB1]`, which the
  existing guard rejects (that was one cause of AP07's AssertionError). Use the acknowledgementRef for attribution
  (§3.3), `decisionRefs: []`.
- With the old test bodies, AP01/02/08 and DQ05 now fail with `TypeError: Cannot convert undefined or null to
  object` (old `decisionSourceKey(source)` calls; D1) — expected, you rewrite them.
