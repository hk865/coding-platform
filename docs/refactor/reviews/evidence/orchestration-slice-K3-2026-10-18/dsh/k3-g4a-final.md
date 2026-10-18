# K3 group 4, session A — reply

## FILES CHANGED
Production: **22 files, +957/−129 (net 828)** — budget ~1,400.
- `core/work-graph`: `tasks/unknown-call-review-service.ts` +229 (hold/release + D3); `tasks/claim-service.ts` +50, `requeue-service.ts` +46 (L11 gate); `tasks/plan-readers.ts` +35 (full records, fail-closed), `plan-service.ts` +5 (AV facts), `goal-decision-reader.ts` +3 (`requeueConfirmed`); `state/run-machine.ts` +22, `task-machine.ts` +16 (`reviewBlocker`); `state/unknown-call-review.ts` +12 (512 KiB); `state/unknown-call-kinds.ts` +1; `notes/note-service.ts` +93, `model/note-contracts.ts` +93, `agent-runtime/note-tool.ts` −45 (builder moved/re-exported).
- `app`: `core-routes.ts` +83, `core-http-types.ts` +24, `startup-reconcile.ts` +101 (2b/6b), `host.ts` +3.
- `business/workflow`: `workflow.ts` +90 (UR3h/UR6/UR8/gatePerform), `contracts.ts` +16.
- `composition`: `create-platform.ts` +19, `tool-commit-lookup.ts` +3; `ui/api/routes.ts` +4.

Tests: **21 new files (5,872 lines)**, 7 existing adjusted (WP1 fixture, KA-14, KA-09, `K3-review-workflow-rows`, `k3-review-claim`, `unknown-call-review`, `K3-34`), allowlist −24. No old assertion was weakened.

## SCOPE / ROWS (RED → GREEN)
**1. L11 gate — done.** `reviewBlocker` `pending|held|unreadable` replaces `reviewPending` (state tests RED on the old field, GREEN). Ordinary claim reads the selected Run's record once and refuses (`busy`/`unavailable`; K3-47(二) RED phase-busy → `unavailable`, GREEN). Requeue: system/agent `busy`, human accepted, held-without-`archiveOrigin` `busy` with release-hold text. D3 revision/"still absent" guard in the one guard block (K3-43(一)(二) RED with guards disabled, GREEN, memory+SQLite). `gatePerform` waits without writing. UR6/UR8 `skip`; a named task waits with the typed card source. `requeueConfirmedByReview` wired into both Workflow cause calls and the decision reader; plan-readers `invalid`→`unreadable`; AV-2b/AV-4c from the facts (K3-47-reader RED before wiring, GREEN). RUN-02 was already implemented by group 3 and is state-tested.
**2. L21 hold/release — done.** Owner ops + lease/selected-Run guards (K3-15(四)(五), K3-43(三)(四) RED `unsupported` → GREEN, memory+SQLite); routes `unknown-call-reviews/hold`/`release-hold` with the composite `{hold, requeue}`; UR3h `cancel_review_round` pinned to the Run revision (K3-15(六)(七) RED held→waiting, GREEN, incl. `revision_conflict` and paused-before-entry). Card entry is B.
**3. Start-up 2b/6b(c) — done.** 2b pages `open='yes'` (100×100, unread→`problems`); `reviews: ReconcileLine[]` with `<status>[ reasons][ active_round]`; `emptyStartupReport`; 6b(c) kinds 1–2 add the record's task id; kinds 3–4 a typed unbuilt slot; late-opened workspace appends `reviews`.
**4. Recovery L29 — done except reported gaps.** K3-09(一)(二), K3-27, K3-29 rows 1–4, 4b, 6–13, extra (一) GREEN. Extras (二)(三) left (§8). Row 3's `close_open_turn(afterRunRef=round 1)` is not emitted because `session-maintenance` (L27, not named in the book) archives the Session first.
**5. `record_note` — done.** L3 platform row; note `lookupToolCommit` on the shared identity/fingerprint; fourth dispatch row (K3-34 RED `process` → platform, GREEN; K3-39 committed/not_committed 4/4).
**6. Size — done.** Absolute 524,288 check on every write, required included; K3-48(三) settle/hold/release near threshold commit ≤512 KiB, over-MAX `capacity` with zero writes.

## B LEFT
- K3-18: (一) answer-side one-card; (四) the review card's queue presence (A asserts `pausedAutomationAction` null); (五) card flow after release.
- K3-26: card contents/options/reason display; (七)(八) group 3.
- K3-29: rows 5/5b; 6b(c) kinds 3–4.
- K3-41(一): answer `rerun_as_is`/the card; K3-44(一)(三) answers/historical answers.
- K3-15(一)(二)(三): card entry/answer; K3-48(二) proposal rationale.
- Proposal-refusal assertions (K3-19) stay B.

## CHECKS
`K3-`: 71 files / 371 tests, 0 fail. `K-`: 267 files (case-insensitive filter), 4,158 tests — 4,116 pass / 37 fail / 5 skip, **all baseline §A/§B**. `business`: 151 pass / 1 baseline; `WP1-`: 0/3 baseline; `S1-archive-flow` path is stale (its business twin is 7/7); `A8-host-restart`: 20/21 baseline; `state`: 3,832 pass + 1 test + 1 file baseline; `composition`: 121/21 baseline; `app/S4C`: 28/0; `architecture`: 53/0 (reach green). `typecheck` 0, `check:architecture` OK, `build` pass. Allowlist: 4 reached entries removed (`isUnenteredReviewRoundForCancellation`, `UNKNOWN_CALL_REVIEW_MAX_BYTES`, `holdReview`, `releaseHold`), none added. **No new failure.**

## UNSPECIFIED (smallest taken)
1. Review `readMany` `unsupported` = absence, not unreadable; the literal rule breaks 81 fixtures that do not register the schema. Alt: make it unreadable and register the schema in shared fixtures.
2. K3-08(二)'s literal one-batch wait-send+command is unreachable under the frozen Kernel batch policy; the fence is asserted with a real review round and a pending message. Alt: owner-level mixed record + driver fence.
3. UR6 `waiting.source`: typed `DecisionSourceV1` kind `unknown_call_review`, L18 key.
4. `StartupReconcilePlatform.reviews` lives under `reconcile.reviews`.
5. U1 moved `recordNoteRequestOf` to `work-graph/model/note-contracts.ts` for the dependency DAG and re-exported it; `writeNote` has no receipt, so the cursor assertion uses a withdraw-op lookup.
6. K3-48(三) SQLite twin and K3-29 extras (二)(三) omitted (allowed by §8).
7. Null guard only when a probe proves the review schema; continuation claims carry the revision guard but are not refused (ordinary `first`/`requeue` are).

## SUBAGENTS
10 implementation lanes + 2 close-out; **max 3 at once** (Wave 1: T1-core / T2a / U1; Wave 3: E / F / G1+G2 rotations). Longest: T1-core and D (~45–60 min); close-out ~75 min including the slow `K-` suite.

## SURPRISING
C8/C6 are baseline failures, not gate regressions. The `K-` filter is case-insensitive (267 files) and its 5,001-session tests take 250–470 s each. One baseline-B test now passes.