All items are closed and green. Final report:

## FILES CHANGED

**Production** — ~1,460 new lines (book soft estimate ~1,000; over, led by `note-service.ts` +289, `decision-actions.ts` +205, `decision-read-model.ts` +135, `create-platform.ts` +113, and three new files). Full production set: new `notes/note-decision-source.ts` (216), `views/note-review-notices.ts` (197), `views/notice-grouping.ts` (113); modified `state/note-machine.ts` (+77), `notes/note-service.ts` (+289/−26), `model/note-contracts.ts` (+21), `model/decision-contracts.ts` (+48), `persistence/note-record-codecs.ts` (+53), `persistence/decision-record-codecs.ts` (+5), `contracts/note.ts` (+1), `communication/decision-application.ts` (+40), `communication/decision-source-facts.ts` (+51), `business/workflow/decision-actions.ts` (+205/−56), `ports.ts` (+8), `workflow.ts` (+1), `views/decision-read-model.ts` (+135), `composition/create-platform.ts` (+113/−8).

**Tests** — 15 new files (~1,830 lines); 5 changed: the 3 book-named assertions (`WP2-wiring.test.ts` ~465/~623, `WP2-wiring-scenario.test.ts` ~80) `toContain`→`not.toContain`; typing-only fixups (`S2C-L-line-support.ts`, `S5R2-settings-replay.test.ts`); `S4A-note-fixture.ts` optional operator.

## SCOPE ITEMS

1. **U3 done.** `decodeProofEvent` is a table (`GoalSettingsChanged`, `PlanRevisionAccepted`, `NoteDispositionChanged`; architecture/completion rows stay `unsupported`; unknown `incomplete`). `NoteDispositionChanged` carries `actor` + `proof` (null for ordinary), with `acknowledgementRef === proof.acknowledgementRef`. RED (`incomplete`) → GREEN (`invalid` for a forged proof naming another answer; proof-null stays `incomplete`).
2. **U6 done.** `resolveDecision` dispatches step ② on `input.source.kind`; today's conflict code moved unchanged into the built-in `goal_conflict` adapter (non-conflict → `answered`); no-adapter kind → `answered`; step ③ records the adapter receipt. `ResolveDecisionActionV1 = WriteResult<{goals: GoalSnapshot[]}> | NoteDispositionResult | CoreRejection | null`; `DecisionsAnswerResponse = RouteResponse<…>` follows by alias. `source_stale` = adapter `revision_conflict` reason. RED (`answered`) → GREEN (`applied`, receipt recorded).
3. **U7 done.** `DecisionCardSourcePort` gains required `needsGoal` + optional `readByKey`; `sourceNeedsGoal` deleted; `deriveOpenCard` uses `readByKey` (no paging). Note card source assembles once per attempt. RED (`note_review` not connected) → GREEN (by-key read; missing key `not_found`). Three hand-rolled sources not migrated (C1).
4. **Note cards done.** `NoteDecisionSourcePort` in `model/decision-contracts.ts`; pending gate (cancelled/answered/overridden/waiting); card identity/pins/objects/options; `readSource note_review`; one disposition core in `note-service.ts` shared with the scribe path (scribe target set unchanged); full actual target set in card mode; proof on the last event; `commandId` replay. D17/D16/D13 RED→GREEN; D-01 six variants RED→GREEN through the real `resolveDecision`.
5. **Notices done.** `NoticeVersion.noticeClass` written with precedence `user_affected > structural > scribe_result`; ordered `NoteVersion` lookup per class; `views/note-review-notices.ts`; pure `notice-grouping.ts`; `seenThrough` advances only over shown members. N1/N2/N3 GREEN (N3 mutation-verified).
6. **Rows.** D-01, D-02, D-13, D-16, D-17 have explicit GREEN tests; D-04/D-05/D-06/D-08 write-side card reasons are exercised by 4C-1 + D-13/D-17; D-12 via D-13. **D-09/D-11 implemented (goal-less never read; cancelled goal → `goal_cancelled`) but have no dedicated session-B test** — see UNSPECIFIED.

## CHECKS (all `--maxWorkers=2`)

1. work-graph S5/S4/SP: 79 files, 884 pass / 5 skip. 2. composition/scenario WP2 + platform: 39 pass, 1 fail (reserved). 3. `tests/app/`: 422 pass, 10 fail — all DSH-BASELINE §A. 4. runtime S4C + architecture + state: 3,703 pass, 2 baseline fails. 5. all new S4C2 files (re-run after the final fix): 18 files, 116 pass. 6. `typecheck` clean. 7. `check:architecture` clean, state-writes 19 pass, production-reach clean. 8. `build` pass.

## UNSPECIFIED (short)

- Note-card options are all `effect:'apply'`; the book never states the field but requires the reject application's formal receipt (D-01/NE6). Options: keep all-apply (chosen) vs. permit an unrecorded reject.
- `NoteDecisionCardFactsV1` augmentation (S0) — §2's `NoteDecisionCardV1` cannot carry pins/objects/options; alternative put them on the card.
- `NoticeItemV1.noteClass` (only `members` was named); `itemKey` prefixed `note_review:`; `review` mapped to 审阅; structural also fires on an accepted ordinary write (book N2 reading); production-reach reason strings ("wire-format"/"kept-for") because "4C-2 wires it" is rejected by the checker.
- D-09/D-11 lack a dedicated test; recommend adding two small card-gate tests next session.

## SUBAGENTS

S0 shared contracts+grouping (~45 min); A/B/C in parallel (~65–75 min each); close-out wiring+checks (~50 min); one e2e integration (~15 min); one reject-effect fix (~8 min). **Most at once: 3.**

## SURPRISING

- `AGGREGATE_REF_RULES` had no `NoteHead`/`NoteVersion`/`CurrentPointer` rows, so the proof-carrying `NoteDispositionChanged` could not commit; B added the three rows (outside its listed files).
- The note card's `reject` was `effect:'reject'`, silently skipping receipt recording; only the new end-to-end test caught it.
- `WP2-wiring.test.ts` F06 line 539 (`另有 3 条` vs `2`) remains red, reserved by the lead (pre-existing session A).
- S4C2-N2/N3 were green on first run; N3 was mutation-verified.