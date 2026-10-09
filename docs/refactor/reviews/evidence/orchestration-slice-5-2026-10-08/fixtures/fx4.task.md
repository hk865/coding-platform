# Group 4: goal-settings owner service rows (SS01–SS16)

Read RULES.md first. You may change ONLY `tests/work-graph/S5-goal-settings.test.ts` and create at most ONE new
helper `tests/helpers/S5-goal-settings-support.ts`. The shared fixture `tests/helpers/S5-decision-fixture.ts` was
just repaired by another group (read its header comment and `fxA-result.md` in this folder for its new exports:
source constructors via D1, the coherent answered message, the adoptable U1, the A/B footprint overlap on M,
`createS5Session`, Run settlement, `storeSnapshot` and allocation counters). Do not edit it; use its exports.

Spec: §5.3 SS rows (memory + SQLite each), §3.1 S5-GS-01…06 and S5-AU-01/02, §3.3 goal-settings-service check
order and pin sets (line 625), §2.2, §2.8 (content basis, control rebase), §4.3 (conflict identity, risk label).

## Findings (review-codex2.md defects 8, 9, 10, 11, 13, 14; lead-verified where marked)

- **Defect 8.** `SS:261` always acknowledges the shared MESSAGE answer; `SS:269` independently invents a conflict
  source; SS11/12/15 pause/resume but never answer the conflict; the old B plan had no M overlap (now fixed in the
  fixture). Establish the real A/B conflict (fixture overlap), answer ITS canonical conflict source (D1 key:
  unordered pair + both plan pointers; captured pins + goalBases of both Goals) through `answerDecision` (part-1
  stub: allowed), then do the row's control/settings sequence through the real owners. Do not reuse the PB1
  message answer.
- **Defect 9 (verified).** SS04: `:343` expects returned A order 1 but `:346` expects persisted A order 0 —
  contradiction; assert persisted A order 1 (and B 0, C 2) and the retained risk. SS11/SS15 (`:447,529`) compare
  the captured rebase basis with `basisB(x)` AFTER the parallel risk was written (that helper includes current
  settings, `:263–266`); capture the expected basis BEFORE applying the change; the proof must retain the
  pre-change basis.
- **Defect 10 (verified at `:181`).** SS08/09/13's free-Task claim creates its Session with
  `b2.base.createSession` in the foreign `r4c-claim-*` scope, so `tasks/claim-service.ts:494` rejects before the
  wait behaviour. Use the fixture's `createS5Session` (P/W). SS08 must control two in-flight operations (the
  settings write wins the race against the claim; use a commit barrier like UM08's `synchronizeB2Commits` in
  `tests/helpers/B2-execution-fixture.js`) instead of submitting the claim after settings completed; inspect both
  the lease and the Run preservation.
- **Defect 11.** SS03/05/08/12/16 assert commit counters (`:328,353`) instead of §5.1 "0 writes": use
  `storeSnapshot()` before/after on the store the owner writes.
- **Defect 13.** SS02 replays after cancel (`:312`): also assert newId/now/body counters unchanged (allocation
  counters from the fixture) and the original cursor/value.
- **Defect 14.** SS03/05 still use commit counters.
- SS16 constructs S5 preparation/entry correctly (keep); SS01 reads through the S5 context (keep).
- Remaining blockers named by the review at `SS:261,343,389,433,512`: re-check each.
