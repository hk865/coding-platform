All work is complete; `.dsh-scratch/` is removed and the working tree holds the earlier rounds' work plus this round's edits.

## FILES CHANGED
```
src/core/work-graph/state/session-availability.ts   caller kind 'turn_closure'; SES-19a branch in healthObserved; optional replacesKernelTurnOpen in observeSessionHealthRecord
src/core/work-graph/sessions/session-health.ts      SessionHealthInput.caller (default reconcile); caller -> transitionSession; replacesKernelTurnOpen -> record constructor
src/core/agent-runtime/runtime.ts                   recordUnreadableProbe takes the close's turnClosureCaller; also fires on the Kernel-read unreadable (closureFailure) path
src/core/agent-runtime/ports.ts                     closeOpenTurn input gains optional turnClosureCaller
src/business/workflow/session-maintenance.ts        SessionMaintenanceInput.turnClosureCaller threaded to tryCloseDanglingTurn -> closeOpenTurn
src/business/workflow/workflow.ts                   runMaintenancePage passes turnClosureCaller: 'turn_closure'
tests/state/session-availability.test.ts            new SES-19a unit tests (transition + record constructor)
tests/scenarios/S2C-K-unknown-outcome.test.ts       2C-22 (2) and (4) flipped to the ruled outcome
tests/scenarios/S2C-K-retired.test.ts               2C-21 (2) missing/damaged flipped to the ruled outcome
```

## SES-19a (what and where)
- `SessionGuardContext.caller` is now `'service' | 'reconcile' | 'turn_closure'`.
- `healthObserved` accepts `reconcile` or `turn_closure`; **before** the SES-19 return, when the caller is `turn_closure`, the Session is `active / unavailable / kernel_turn_open`, and `ctx.probe` is `missing`/`damaged`, it writes `active / unavailable / <probe>` at rev+1 with effects `observe_health` + `SessionHealthObserved`. Occupancy/lifecycle unchanged, same `hostLease='owned'` guard as SES-12. `reconcile` keeps SES-19 exactly (empty transition).
- `observeSessionHealthRecord` takes an optional `{ replacesKernelTurnOpen: true }` and then writes `kernel_turn_open -> missing/damaged` keeping `unavailableSince` (the Session was already unavailable). Without the option the existing SES-19 throw is unchanged.
- **Caller scoping (flag for the lead).** "The Turn closure" is identified by a `turnClosureCaller: 'turn_closure'` carried only by the Workflow maintenance path: `runMaintenancePage` -> `SessionMaintenanceInput.turnClosureCaller` -> `tryCloseDanglingTurn` -> `closeOpenTurn` input -> `recordUnreadableProbe` -> `recordSessionHealth(caller)`. The Workflow's own `close_open_turn` selection and the start-up reconcile's maintenance omit it, so they keep SES-19. I scoped this because applying SES-19a to *every* `closeOpenTurn` call broke two tests that the ruling did not list for flipping: `A8-host-restart > W-14 and RUN-22` (its final quiet restart gained one `SessionHealthObserved`, 22→23 ledger events) and `K-W-workflow-close > KA-12` (the Workflow's unreadable-store fallback lost `transfer_responsibility`). The lead's "SES-19 stays for every probe the reconcile path makes" supports the start-up-reconcile exclusion; the KA-12 exclusion is the same mechanism. If the lead intends SES-19a for all Turn closures, A8 W-14 and KA-12 need re-baselining.
- `recordUnreadableProbe` now also fires when reading the Kernel store itself throws an unreadable `StoreError` (`closureFailure`: fresh empty file after removal, or damaged rows). This is the path the 2C-22 tests actually hit; the pre-existing `kernelDatabaseState === 'missing'` and `kernelResult.status === 'unreadable'` sites also call it.

## TESTS
Unit, `tests/state/session-availability.test.ts` — **130 passed**:
- `SES-19a: the Turn closure replaces kernel_turn_open with its fresh missing/damaged probe under the SES-12 lease guard` ✓
- `SES-19a: the constructor replaces kernel_turn_open only when the owner allows it and keeps the entry cursor` ✓
- Existing SES-19 tests unchanged and passing: `run(TURN_OPEN, observe('unavailable'), reconcile({probe:'missing'|'damaged'}))` → empty transition; `observeSessionHealthRecord` same-value throws for missing/damaged/kernel_turn_open; `ready`+closed head clears kernel_turn_open.

Flipped scenarios (all pass):
- `2C-22 (2) … maintenance pass 1 records the unreadable probe, and pass 2 archives the line as retired` — pass 1 `unavailable/missing`; pass 2 archived page, bucket `archived`, archivedTag/own `retired`, `retired.conclusion missing`, reactivate `unavailable/reactivate_refused_retired`, Session `archived/unavailable/missing` ✓
- `2C-22 (4) … pass 1 records the damaged probe …` — same with `damaged` ✓
- `2C-21 (2) a missing Kernel … the probe then retires it and maintenance archives it (SES-19a)` ✓
- `2C-21 (2) a damaged Kernel …` ✓
- The other 2C-22 (1)/(3) and 2C-21 (1)/(3)/(3b) remained green (regression guard).

The 9 tests alone (`--maxWorkers=4`, each file filtered):
1. `A8-host-restart > W-14 and RUN-22…` ✓
2. `A8-host-restart-attestation > RUN-22 (LA-8)…` ✓
3. `A8-host-restart-attestation > QRR-06 (LA-8)…` ✓
4. `A8-host-restart-lease > Q-05 and QRR-06…` ✓
5. `K-R-attested-facts-source > KA-09 (KE3, L9/D2)…` ✓
6. `K-R-attested-facts-source > KA-09 (KE3, L9/D12)…` ✓
7. `K-R-attested-facts-source > KA-09 (KE3, L9)…` ✓ (the file's 4 KA-09 tests all pass)
8. `K-W-maintenance > KA-14 … decision 45/51` ✓
9. `K-W-maintenance > KA-14 … second phase` ✓

## CHECKS
```
npm run typecheck                            exit 0
npm run check:architecture                   exit 0
npm run build                                exit 0
node scripts/build-kernel-patch.mjs --check  all "matches": true
full suite (--maxWorkers=8)                  49 failed | 309 passed (358); 155 failed | 6479 passed | 29 skipped (6663)
```
Full-suite failures outside `DSH-BASELINE.md` §A: only the 5 `tests/scenarios/S2C-K-archive-tags-checks.test.ts` (`2C-05 (1)(3)(3′)(4)(5)`, expected red here; lead runs it under bwrap) plus the baseline's own `tests/state/invariants.test.ts` +1 suite. No A8/KA-12 failures. Same 155 baseline failures as the previous round; total is 6663 because of the 2 new unit tests.

## NOTES
- The 2C-22/2C-21 pass-1 maintenance must run on the Host: only its Runtime publishes `closeOpenTurn` (the K support `runMaintenance` uses the Runtime-less composition root). Pass 1 therefore drives the Host via `h.advance(h.select(flowId, 'ag2b-work'), { invariants: false })`; pass 2 (the archive decision) still uses `runMaintenance`. No product change.
- `unavailableSince` is preserved on the SES-19a write (already unavailable); the health event's identity/fingerprint come from the fresh revision + probe, so the write is idempotent on replay.
- No specs edited (SES-19a is the lead's to add), no git writes, no network, no real model calls; `.dsh-scratch/` deleted.