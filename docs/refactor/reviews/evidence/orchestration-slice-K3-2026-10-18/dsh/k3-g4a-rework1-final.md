All work is complete. Final state verified.

# Reply

## FILES CHANGED

**Production (11 files, +304/−87, net +217):** `plan-readers.ts` (one shared `readUnknownCallReviewOutcome`; every failed/thrown read = `unreadable`), `claim-service.ts` (probe deleted, direct `expectedRevision:null`), `requeue-service.ts` (`selectedReviewBlocker`/second read deleted; `readTaskRequeueByIdentity`), `task-machine.ts`/`run-machine.ts` (gate every non-review claim), `core-routes.ts` (release-hold read failures; replay-first), `claim-contracts.ts`, `create-platform.ts`, `runtime.ts` (L27 review-purpose authorization; one TaskRow read), `session-maintenance.ts` (`closableWorkRun`), `unknown-call-review-codecs.ts` (path ≤512 chars, +1).

**Tests (+1231/−450):** 9 fixture helpers + `invariants.ts`/`S1-session-maintenance`/`A8-host-restart-attestation` schema registration and de-dup; rewritten `K3-47-claim-gate`, `K3-47-reader-facts` (memory+SQLite), `K3-48-3`, `K3-29-startup-reconcile-2b`, `K3-41-release-hold`, `K3-29-recovery-round/-continuation/-extras`, `K3-large-review-input`, state tests; new `K3-47-continuation-gate.test.ts`, `K3-29-maintenance-review-run.test.ts`.

## ITEMS — RED → GREEN

1. **L7** — RED 10 failed/24 passed (8 requeue fault cases + 2 old `unsupported`-as-absent assertions); GREEN 36 passed (22+14), both backends. Old assertion named by option A rewritten (`unsupported` now `unreadable`).
2. **Non-review claim** — state RED `committed` → 15/15; owner RED (real yield+reply, fault wrapper) `committed` → 2/2 memory+SQLite, `unavailable`, no Run, zero writes.
3. **release-hold** — RED `requeue:null` → 2/2 (Run and intent read, thrown included); K3-41 6/6.
4. **Derived requeue replay** — RED `idempotency_conflict` after Goal pause/resume → 2/2: same ref+cursor, one `TaskRequeued`, one continuation.
5. **L27 bullets 2/3** — new maintenance tests RED (`kernel_turn_open`) → 3/3; row 4b hold→release→auto-requeue→continuation in the round's Session, one `TaskRequeued`, quiet restart.
6. **Diagnostic:** round-1 `close_open_turn` = `{status:'mismatch', reason:'the Kernel answers already_terminal'}` — exactly the predicted early-shell-release artefact. Fixtures fixed; rows end: 3 clean at the `review_incomplete` card; 3 unresolved one continuation; 6 one continuation (original Session); 8 decision card (new Session); 9 one continuation; 11 replayed-hold stop; 13 one continuation with a Host restart between steps and a quiet final restart. 8/8, 8/8, 1/1.
7. **K3-48 (三)** — codec RED committed (Run rev 6) → `invalid`, no record; rebuilt on `createK3LargeReviewRecord({padToCreationBudget:true})`, 3/3 memory+SQLite; state 53/53 incl. a required 524,289-byte write → `capacity`. Sizes: created **158,720**; settle **164,184**; hold **170,887**; release **170,891** (all ≤ 524,288). K3-35 3/3 unchanged.
8. **2b / K3-47** — 2b 5/5 through real RUN-22/hold owners and production `listReviews`; faked 100×100 case deleted; K3-47 both backends.

## CHECKS

- K3+K-: 85 files/476 tests — 459 pass, 17 fail (15 `K-readonly-sandbox` §A + 2 reported below).
- business+state+WP1+A8: 62 files/4064 (29 skipped) — 4007 pass, 28 fail + 1 suite (§A).
- composition+S4C+architecture: 47 files/223 — 202 pass, 21 fail (§A).
- `typecheck` 0, `check:architecture` 0, `build` 0; allowlist none removed; A8-attestation 2/2 after fix.
- **Reported, not edited:** `K3-08-wait-reply` (一) line 166 and `K3-R1-restart-flows` K3-01 line 177 expect a later `close_open_turn`; L27 bullet 3 now closes that resolved-RUN-25 line at start-up maintenance, so the advance has no close step.
- `tests/scenarios/S1-archive-flow.test.ts` is a stale book path (business twin passes).

## UNSPECIFIED

1. **RUN-25 maintenance vs L29 row 8:** unconditional `takeover_unresolved` breaks K3-27 3/3 (maintenance pre-closes the Turn the review claim must close). Kept: defer only while a review claim is due (`activeRound`/`pending_review`/`awaiting_proposal`) **and** Goal active; pending + paused Goal still closes (new test). Options: (a) as written, (b) unconditional + rewrite K3-27 row 8.
2. **Row 4b close receipt** is not observable through a public seam; test asserts maintenance `lastExecutionRef` = round and health → available in the settle advance. (b) add a runtime seam if the receipt must be asserted.
3. **Item 4** method name/signature `readTaskRequeueByIdentity(ctx,{taskRef,afterRunRef,requestId})`; replay-read store failure is returned as a rejection, not a miss.
4. **Item 7 padding:** short callIds + `notVisible` split to hit 158,720 exactly (512-byte callIds cannot fit); opt-in flag leaves K3-35 untouched.
5. **2b:** old fabricated held-with-round / `awaiting_proposal` 6b variants dropped (they need card answers, session B); kinds 1/2, held-no-round and inactive Goal kept.
6. **Row 13** uses `expectQuietRestart` (its `AG2bHost` type) rather than `expectQuietHarnessRestart`.

## SUBAGENTS

Item 1 ≈35m (+5m schema fix); A (2–4) ≈12m; B (5–6) ≈25m + 6m check; C (7–8) ≈7m; close-out ≈25m. **Most at once: 3.**