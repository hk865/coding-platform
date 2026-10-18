# K3 group 4, session B1 — reply

## FILES CHANGED
**Production: 22 files (18 modified + 4 new), +1,077/−119 diff plus 436 new-file lines = 1,513 gross, 1,394 net** (soft budget ~1,400: net inside, gross ~113 over).
New: `tasks/unknown-call-review-card.ts` (126), `tasks/unknown-call-review-answers.ts` (212), `tasks/decision-answer-lookup.ts` (82), `tasks/goal-basis.ts` (18). Main modified: `unknown-call-review-service.ts` (+289), `decision-actions.ts` (+193), `decision-read-model.ts` (+175), `startup-reconcile.ts` (+115), `decision-source-facts.ts` (+57), `create-platform.ts` (+48), `workflow.ts` (+168), `requeue-service.ts`, brief assembly/contracts, `decision-application/service`, message codecs, UCR contracts.
**Tests: 27 files (13 modified + 14 new) + 1 helper (280), +947/−43 diff plus 3,182 new-file lines = 4,129 gross.** Allowlist: removed `listUnappliedAnswers` and `applyDisposition`; kept `recordProposal`; 244 entries.

## SCOPE / ROWS (all done; RED → GREEN)
1. **Card source `unknown_call_review`** — done. One pure projection shared by views/communication; `CARD_KINDS` + composition registration; pins record/Run/Goal + `goalBases`; record + per-path file objects; D7 targets/options (three when no proposable target or <2 slots); fixed labels and mixed line; `available`; cancelled/inactive/terminal/held = closed history. K3-20 (five real records, `pageLimit:2` → 3 pages, queue `limit:2` to the end, 5th card by key, mid-read real commit → next attempt, memory+SQLite) and K3-18(四) queue (no `system_requeue` card) GREEN.
2. **Answers** — done. Option required (table, not `if`); text/annotations ride; text-only/off-card `invalid`, nothing written; older revision `revision_conflict`; paused Goal accepts, applies on resume. K3-17 RED (`no card source`) → GREEN, including a real paused Goal (`awaiting_resume`).
3. **Disposition owner, proof, U6, brief, D9** — done. `applyDisposition` writes revision+1 with `disposition_applied` + `DecisionChangeProofV1`; answer-derived identity/fingerprint (answer pins/goalRef verified against the captured copy); receipt lookup before guards; replay returns the original cursor; four effects (`rerun_as_is`/`skip_as_done` resolved, observation untouched; `safer_method` `awaiting_proposal` + `stateEntry+1`; `handle_myself` resolved+held, source `card`). U3 row `UnknownCallReviewChanged` (absent proof → incomplete); U6 adapter wired; brief disposition/targets/platform line + text. K3-15 (一)(二)(三), K3-17 both apply orders, K3-41(一), K3-18(一) RED→GREEN.
4. **UR7 / UR7b / 6b kinds 3–4 / M2** — done. `advanceReviewDisposition` is the one ②-then-③ path; UR7 emits `apply_review_disposition` with the answer's captured source; UR7b driven by each handed-over answer's own `reviewRef`, ignores selected Run/eligibility/`open`, replays ② and does ③ only; start-up kind 3 (current card answered) and kind 4 (one `listUnappliedAnswers({goalRef})` per active Goal, answers carried on `redriveGoals`/advance input). L29 rows 5 and 5b, K3-44(一)(三) RED→GREEN, plus both dropped 6b variants (held+③-missing kind 4; `awaiting_proposal` kind 1).
5. **L22 confirmation** — done. `requeueConfirmed` from an applied disposition suppresses the `system_requeue` card; the owner autonomy gate now admits the confirmed system requeue (K3-18(一) was RED with `forbidden` → GREEN, one card total).
6. **Card “I'll handle it”** — done (K3-15(三): held, AV-4c, human requeue `busy`, release-hold continues).
**Left card parts** K3-03, 10, 11, 13, 19, 26(七)–(九), 37, 42, 45: card/queue assertions added and GREEN (K3-26 RED on real queue schemas; K3-37/42/45 via Host queue).

## B2/B3 LEFT
- **B2:** L20 proposal round, K3-16, K3-35(二)(三), K3-46, K3-48(二), `awaiting_approval` options/application/`approvedMethods`, K3-19(二), `recordProposal` (approval phase returns `unsupported`).
- **B3:** L19a (CRR owner, request tool, `shell` hook, script expansion, CRR card source, B2-01..18), the `command_rerun_request` half of the UR7 step/kind 4, K3-15(二)'s blocked sentence and the `blockedCommands` section.

## CHECKS (`--maxWorkers=2`)
`K3-*`: 84 files / 408 tests, 0 fail. `K-*`: 14/112, 15 fail (baseline A). `S5*`+`S4C2-*`: 50/498, 1 fail (baseline). `business`: 18/172, 1 baseline. `WP1-*`+`A8-host-restart*`: 7/44, 24 baseline. `state`: 38/3,864, 1 baseline suite + 29 skip. `composition`: 40/142, 21 baseline. `app/S4C*`: 3/28 pass. `architecture`: 4/53 pass. All B1-touched: **27 files / 137 tests, 0 fail** (re-run after the final K3-20 fix). `typecheck` 0, `check:architecture` 0, `build` 0. No new failure; one A8-3n title mismatch reproduces on pristine HEAD (stale baseline title).

## UNSPECIFIED
- K3-20's mid-read commit is a real human hold, not a new record (smallest fault).
- UR7b records ③ under `owned.ctx` (trusted Host operator): the S5 application guard refuses the automation identity for a user-committed answer; ② remains answer-derived. Alt: extend that guard.
- `applyDisposition` gained an optional `readAnswerText` owner seam (same `readDecisionAnswer`) because the port input has no `text`.
- File objects carry `digest: null` (the record's capture has paths only); alt: open `materials/open` for digests.
- `awaiting_approval` projects no options / `not_available` (untested, ruling 5).
- The “held + ③ recorded” 6b variant cannot appear in 2b (`open='no'`); the test asserts the real empty `reviews` + kind 4 hand-over.
- `pausedAutomationAction` alone still returns `system_requeue` for resolved/applied; the reader's `automationConfirmationCause` suppresses it (no user-visible card). Alt: tighten the function.
- A8-3n's baseline title is stale; not a B1 failure.

## SUBAGENTS
9 agents + follow-up resumes. Lane 1 foundation ~23 min; Lane 2 disposition ~35 (+2 fixes); Lane 3a start-up ~12; Lane 3b UR7/UR7b ~35 (+1 fix); Lane 4a card rows ~10; Lane 4b hold/requeue ~15 (+1 fix); Lane 4c card rows ~10; Lane 5 6b variants ~13; close-out ~10. **Most at once: 4** (Lane 2/3a/4a/4c), then 3. Wall ~78 min.

## SURPRISING
Review caught a real UR7 bug: the minimal source was refused `invalid` by the captured-pins guard; fixed to use the answer's captured source + pins and regression-tested. The S5 ③ guard rejects automation, so UR7b uses the operator. K3-18 exposed a genuine `requeueConfirmed` owner-gate gap, fixed in `requeue-service.ts`. The earlier 3-record K3-20 fallback was replaced with the row's five real records.