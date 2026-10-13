All checks pass on the frozen state. Final report follows.

# FILES CHANGED

**This round — production (the only production change)**
- `src/core/work-graph/views/undelivered-reply-notices.ts` — `sourceMismatchReason` now validates the full DTO `sourceSessionRef` against the directory-derived source and rejects a disagreement (`:352`).

**This round — tests (group M)**
- `tests/work-graph/WP2-context-extensions.test.ts`
- `tests/work-graph/WP2-undelivered-notices.test.ts`
- `tests/work-graph/WP2-message-duties.test.ts`
- `tests/record-store/WP2-notice-cursors.test.ts`
- `tests/runtime/WP2-context-assembly.test.ts` — **deleted** (all four tests replaced successful internal graph-facts collaborators; rows remain covered at E2/E4)

**This round — tests (group C)**
- `tests/composition/WP2-wiring.test.ts`
- `tests/helpers/WP2-platform-support.ts`
- `tests/scenarios/WP2-wiring-scenario.test.ts`

**Carried unchanged from the previous sessions (still in the working tree):** the other 19 production files, `tests/state/WP2-positions.test.ts`, and the unchanged refreeze/harness changes (`S5-message-decision`, `S5-user-messages`, `S1-wait-copy-retirement`, `S5-decision-routes`, `harness.ts`, `support/common.ts`). Full status is in CHECKS.

# ROWS

Every spec §5.2 row still has at least one test whose name starts with its id; the fix round changed evidence, not row coverage.

| Row | Primary test file | Test name(s) / change |
|---|---|---|
| Z01 | scenarios/WP2-wiring-scenario | `Z01 automatic advancement through the scenario harness…` |
| Z02 | scenarios/WP2-wiring-scenario | `Z02 automatic advancement: … the NEXT prepared reminder input carries its row…`; read bracket now observes `scripted` **and** `queryScripted` (`:84`,`:89`) |
| F01 | composition/WP2-wiring | `F01 a real entered secretary Run calling send_user_message…` |
| F02 | composition/WP2-wiring | `F02 an executor and an ordinary reviewer Run…` |
| F03 | composition/WP2-wiring | `F03 a read-only copy Session is refused…` |
| F04 | composition/WP2-wiring | `F04 after a successful tool request, broken role facts refuse the next request…` |
| F05 | composition/WP2-wiring | `F05 a changed autonomy level reaches the new prepared context…`; **new unbound successor Run** prepared input carries `every_step` (`:346`, evidence `:394`) |
| F06 | composition/WP2-wiring + work-graph/WP2-context-extensions | `F06 [budget] a real continuation is kept whole…` (`:473`, real requeue+continuation); module F06 real queue (`WP2-context-extensions:262`) |
| F07 | work-graph/WP2-context-extensions + composition/WP2-wiring | `F07 follows a predetermined page boundary and keeps the named tail Task card…` (`:311`); `F07 exactly 5,000 real waiting cards…` (`:339`); E2 `F07 a focus task keeps the real Task-linked goal_cause card…` |
| F08 | composition/WP2-wiring | `F08 real Work preparation carries the installed extensions…` (`:569`); **installed settings/decisions read failure** → prepared rejection (`:635`) |
| F09 | composition/WP2-wiring | `F09 [%s] a reply saved after its Session already became unavailable…` |
| F10 | composition/WP2-wiring | `F10 …` health plus **Work reconcile** (`:1232`), **Work recognition** (`:1725`), **Query recovery** (`:1632`) |
| F11 | composition/WP2-wiring | `F11 [%s] marking one displayed notice…` literal ordered first/head/tail/post-seen/reopened sequences (`:648`) |
| F12 | composition/WP2-wiring | `F12 [%s] SES-13 recovery removes the notice…` |
| F13 | composition/WP2-wiring | `F13 [%s] the real responsible link and wait transfer…` |
| F14 | composition/WP2-wiring | Work `:1049`, user-answer `:1377`, Query-answer `:1491`; complete first/retry/reopened-retry values+cursors and notices at R/P |
| F15 | composition/WP2-wiring | `F15 [%s] a failed reply or health commit leaves no half state…` |
| M01–M03 | work-graph/WP2-message-duties | M02 now uses the real adapter/resolver/Session (`:250`) |
| M04–M11 | work-graph/WP2-undelivered-notices | M06 named tail from creating commands (`:351`); M07 real 5,000/5,001 (`:536`); M08 literal order (`:392`); M10 attempt-4 boundary (`:681`); M09 DTO source (`:782`); malformed empty-source valid envelope (`:449`) |
| W231 | record-store/WP2-notice-cursors | public boundary checks only (`:61`,`:78`) |
| P01 | state/WP2-positions | unchanged, passes |

# CHECKS

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 (main + UI clean) |
| `npm run check:architecture` | exit 0 (`next source boundaries: OK`; 49 submodule edges) |
| `npm run build` | exit 0 (workbench published) |
| `npx vitest run WP2-` | `Test Files 7 passed (7)` / `Tests 97 passed (97)` (97 s) |
| 50-file regression (brief §8 list) | `Test Files 5 failed │ 45 passed (50)` / `Tests 18 failed │ 1184 passed (1202)`; failures exactly the 18 sandbox-kind cases, only in A8-host-restart-entry (7), A8-host-restart (3), C6-unrelated-adoption (5), S1-archive-restart (1), WP1-wiring (2) |
| `npx vitest run` the four refrozen files | `Test Files 4 passed (4)` / `Tests 49 passed (49)` |
| `sha256sum` (10 frozen files) | all ten match byte-for-byte |
| `git diff --stat slice-base -- tests` | only `WP2-` files, the helper, and the unchanged refreeze/harness changes (14 files; 5246 insertions, 19 deletions); no other tracked test change |
| `git status --short` | only L-scope paths; `./.dsh-scratch/` deleted; no commit (`git log` still `d1a82d1`, `e446a10`) |

# UNSPECIFIED

- **Query recovery positive notice (must-fix 4, spec L11-2 / lines 174, 268, 316).** Driven through the real platform on both backends: the reachable public consultation always runs its Query on a freshly derived **read-only** Query Session, and the Query Answer is a response on the original sender's message. The recovered derived Session authors no replied message, so the correct resulting notice set is `[]` (asserted); R, the bound `unavailableSince`, retry and SQLite reopen are asserted. A positive notice there would need a production change (run the Query on a message-authoring Session), which the test-only rule forbids. Counter-example: `F10 [%s] (Query recovery)` — after Q-04 the derived Session's `unavailableSince` equals R, yet the notices queue is `[]`.
- **Spec line 248 prefix.** The spec words a same-key/different-source-Session duplicate as `undelivered_reply_identity_conflict:`; the binding brief and review require the per-item DTO-vs-directory shape `unavailable/undelivered_reply_source_mismatch:`. Group P implemented the brief’s shape (validated before dedup), so such a duplicate is rejected as `source_mismatch`. Flag if the two prefixes must be reconciled.
- **M07 capacity bound.** Because the mailbox indexes unresponded messages too, the exact-5,000 success and the “one more” overflow must be two separate real reply lines; the proven overflow bound is the L7 50-page bound rather than a 5,001-dedup-item bound. Both rejections carry `undelivered_reply_page_limit:`.
- **`tests/runtime/WP2-context-assembly.test.ts` deleted.** All four of its tests used the successful `assemblerWithFacts` graph-facts mock the review names; F05/F06/F08 remain covered at E2 (composition) and E4 (context-extensions). The lead should note the file is gone.
- **F07 assembled-input assertion** remains the accepted documented omission (narrowed comment), unchanged.

# NOTES

- Subagents run: M (1), C (1 + 1 follow-up), P (1), independent read-only reviewer (1). The coordinator ran only the section 5 checks.
- No L-bwrap rows; no real model calls; no network; ports 3080/3099/44797 untouched; no git write commands; `./.dsh-scratch/` deleted.
- One low-severity residue: `tests/helpers/WP2-platform-support.ts:209` `withSourceFault` spies on the internal production factories `createGoalSettingsService`/`createDecisionReadModel`. It is an expressly allowed injected fault and fails loudly if those factories move; no production-behaviour change was made beyond the DTO source check.
- `WP2-` file count is 7 (was 8) because the redundant runtime file was removed.

# REVIEW

**Must-fix 1 — finish the required E2 evidence: fixed.**
- F05: `F05 a changed autonomy level reaches the new prepared context while the already-bound input does not move` (`tests/composition/WP2-wiring.test.ts:346`; new unbound successor Run prepared input carries `every_step`, already-bound bundle unchanged).
- F06 budget: `F06 [budget] a real continuation is kept whole while reminder rows that do not fit are cut from the E2 prepared input` (`:473`; real failed attempt → real `requeueTask` → real continuation).
- F08: `F08 real Work preparation carries the installed extensions in the bound scope…` (`:569`; installed settings/decisions read failure injected at `:635` → `prepareExecution` rejected `goal_settings_read_failed:` / `decision_queue_read_failed:`, never a successful empty input).

**Must-fix 2 — replace self-derived identity/order expectations: fixed.**
- F11 (`:648`) asserts explicit ordered first-page/head/full/post-seen/reopened sequences from command-returned ids and committed R; a wrong first item is rejected.
- F07 real-pages (`tests/work-graph/WP2-context-extensions.test.ts:311`) uses a handwritten two-page example keyed by the requested cursor, literal key order.
- M06 (`tests/work-graph/WP2-undelivered-notices.test.ts:351`) takes the named tail identity from the creating commands.
- M08 (`:392`) uses a literal first/tail order and rejects wrong/incompatible cursors; no `canonicalJson`/comparison-function expectation remains.

**Must-fix 3 — complete F14 replay and notice evidence: fixed.**
- Work: `F14 [%s] the Work reply position…` (`:1049`) — complete first value+cursor, same-request retry, DTO R/P, post-reopen reissue and comparison.
- User answer: `F14 [%s] the user-answer writer…` (`:1377`) — complete first/retry/reopened-retry comparisons, literal reply options, DTO R/P, Goal and workspace notices at R.
- Query answer: `F14 [%s] (Query Answer)…` (`:1491`) — complete initial result/retry/reopen, DTO R/P, notice at P.

**Must-fix 4 — exercise other unavailable-position writers at E3: fixed.**
- `F10 [%s] (Work reconcile)…` (`:1232`), `F10 [%s] (Work recognition)…` (`:1725`), `F10 [%s] (Query recovery)…` (`:1632`), each `it.each(['memory','sqlite'])`, driving real `reconcileRun`/`resolveUnknownRun`/`reconcileQuery`; R observed from the commit log, notices and replay/reopen asserted (Query recovery’s correct notice set is empty — see UNSPECIFIED).

**Must-fix 5 — observe preparation stages for writes and both models: fixed.**
- `observeStage` (`tests/helpers/WP2-platform-support.ts:186`) asserts zero `commitObserver` commits and zero `scripted` + `queryScripted` calls; `preparedBundle`/`preparedBundleInput` (`:870`) bracket E2 prepares; all direct `prepareExecution` calls in the composition file are wrapped; `quietRead` (`tests/composition/WP2-wiring.test.ts:38`) observes both counters; the Z02 scenario read stage now observes both (`tests/scenarios/WP2-wiring-scenario.test.ts:84`,`:89`). Existing notice/queue guards preserved.

**Must-fix 6 — repair capacity and retry-boundary evidence: fixed.**
- `F07 exactly 5,000 real waiting cards succeed and one more is a capacity rejection` (`tests/work-graph/WP2-context-extensions.test.ts:339`).
- `M07 exactly 5000 real undelivered replies succeed and one more real page is a capacity rejection` (`tests/work-graph/WP2-undelivered-notices.test.ts:536`; every item and the named tail verified).
- `M10 a window that stabilizes on attempt four recovers, and one that stabilizes only after four fails` (`:681`); public outcomes, no call counts.

**Should-fix — DTO source Session ignored: fixed.** Production `src/core/work-graph/views/undelivered-reply-notices.ts:352` compares the complete `SessionRef` against the directory-derived source and includes it in the signature (`:408`); test `M09 a DTO that names another source Session is refused, never silently collapsed by the directory identity` (`tests/work-graph/WP2-undelivered-notices.test.ts:782`; RED first seen: `expected 'ready' to be 'rejected'`).

**Should-fix — successful internal mocks: fixed.** `tests/runtime/WP2-context-assembly.test.ts` deleted; `F06 …` (`tests/work-graph/WP2-context-extensions.test.ts:290`) drives the real queue; `M02 the real resolver and Session facts…` (`tests/work-graph/WP2-message-duties.test.ts:250`) uses the real adapter/Session. Legitimate failure injections and the accepted F07 limitation retained.

**Should-fix — W231 implementation-coupled/trivial: fixed.** `tests/record-store/WP2-notice-cursors.test.ts:61`,`:78` keep only closed-whitelist/registration boundary checks; no constant restatement, internal binder or receipt-replay test, no store reads; not counted as E3 evidence.

**Should-fix — malformed-position empty-source envelope: fixed.** `tests/work-graph/WP2-undelivered-notices.test.ts:449` uses the valid `rawSourceCursor` envelope with malformed/zero/legacy positions (populated-source case already did).

**Should-fix — F07 comment narrowed: fixed.** `tests/composition/WP2-wiring.test.ts:529` now names the unknown-outcome/stop/rework and automation-confirmation Task-linked card causes (`goal-decision-reader.ts`) and states that no preparable claim for the same Task coexists with them in the checked paths; “only deferred Tasks” is gone.