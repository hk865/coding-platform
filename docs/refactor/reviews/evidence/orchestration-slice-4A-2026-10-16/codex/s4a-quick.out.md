**Must-fix**

1. **Original #8 remains partially unfixed: `overQuota` uses the admission projection instead of the committed population.** At an exactly-full goal, a structural replacement subtracts its accepted target, returns `overQuota:false`, then remains pending alongside that target; `readNote` returns `true`. The subtraction is at `src/core/work-graph/notes/note-service.ts:839`, the result at `src/core/work-graph/notes/note-service.ts:883`, and the read calculation at `src/core/work-graph/notes/note-read-model.ts:269`.

   **Fix:** retain R6’s replacement projection for admission/reasons, but calculate the returned—and replay-stored—`overQuota` from the projected **committed** population: add the new counted item and subtract only targets actually superseded by this commit. Add literal exact-full pending/staged replacement assertions. This requires separating two calculations, not removing the lead’s admission subtraction.

2. **Original #12 remains partially unfixed: L2a’s validation order is still wrong.** Understanding compatibility and own-goal checks run before anchor existence at `src/core/work-graph/notes/note-service.ts:633`. Thus an executor naming a nonexistent task in another goal receives `forbidden/anchor_out_of_goal`, rather than the required class-2 `invalid/anchor_not_found`. The temporary exception in item 12a no longer applies: the narrow reader now exists.

   **Fix:** perform duplicate-anchor validation with class 1, resolve existence for all anchors next, then apply understanding compatibility and own-goal/scribe-scope checks. The specified order is explicit at `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:79`. Add an overlapping-error case through the public writer.

**Should-fix**

- **Original #3 has one additional residual:** `src/core/work-graph/notes/scribe-scope.ts:195` still swallows an explicitly rejected/thrown duty resolution and omits that Session. Return `unavailable` instead. This is separate from R12’s deliberately retained **ready `unknown`** behavior; the default resolver always returns ready, so this is not an additional merge blocker.
- **Malformed-anchor feedback loses the field.** `src/core/work-graph/notes/note-service.ts:341` discards the validator’s field and often returns only `anchor_not_found`. Preserve the field in explanatory `reason` text without changing the public result shape.

Prior-review closure, using the original numbering:

| Item | Result and evidence |
|---|---|
| 1 | **Fixed:** understanding-only pointer movement and commit-conflict pointer recovery: `src/core/work-graph/notes/note-service.ts:1021`, `src/core/work-graph/notes/note-service.ts:1065`. |
| 2 | **Fixed under R1:** deduplicated supersession shared by writing and acceptance: `src/core/work-graph/notes/note-service.ts:274`, `src/core/work-graph/notes/note-service.ts:1033`. |
| 3 | **Fixed except the residual above and R12’s deferred limitation:** failure-aware reads at `src/core/work-graph/notes/note-read-model.ts:76`; forbidden file handling at `src/core/work-graph/notes/note-anchors.ts:749`. |
| 4 | **Fixed:** complete cursor traversal, `src/core/work-graph/notes/note-read-model.ts:76`. |
| 5 | **Fixed:** scoped identity, original-result recovery, replay before mutable checks: `src/core/work-graph/notes/note-service.ts:396`, `src/core/work-graph/notes/note-service.ts:412`, `src/core/work-graph/notes/note-service.ts:950`. |
| 6 | **Fixed under R5:** bound/current basis and per-goal stage resolution: `src/core/work-graph/notes/note-anchors.ts:483`, `src/core/work-graph/notes/note-anchors.ts:704`. |
| 7 | **Fixed:** narrow cross-goal reader, `src/core/work-graph/notes/note-anchor-facts.ts:49`. |
| 8 | **Partial:** populations corrected; blocker 1 remains. |
| 9 | **Fixed:** human repair refusal, Session authorship, required reasons: `src/core/work-graph/state/note-machine.ts:78`, `src/core/work-graph/notes/note-service.ts:973`, `src/core/work-graph/state/note-machine.ts:224`. |
| 10 | **Zero rule fixed:** `src/core/work-graph/notes/scribe-scope.ts:327`. Root-prefix ownership remains incorrect at `src/core/work-graph/notes/scribe-scope.ts:81`, explicitly deferred by R8. |
| 11 | **Fixed:** staging key cleared, distinct event IDs, truthful pre-bind decoding: `src/core/work-graph/state/note-machine.ts:252`, `src/core/work-graph/notes/note-service.ts:588`, `src/core/work-graph/persistence/note-record-codecs.ts:586`. |
| 12 | **Shape crashes and goal restrictions fixed;** blocker 2 and feedback issue remain. |
| 13 | **Fixed:** shape-only commit facts and populated unchecked indices: `src/core/work-graph/persistence/note-record-codecs.ts:246`, `src/core/work-graph/notes/note-read-model.ts:293`. |
| 14 | **Implemented:** capture, pagination, disambiguation and locator: `src/core/work-graph/notes/note-anchors.ts:281`; see ruling U1 below. |
| 15 | **Fixed:** real role/claim fixtures, genuine cross-goal and revised-plan cases, fuller replay assertions: `tests/helpers/S4A-note-fixture.ts:77`, `tests/work-graph/S4A-note-scope.test.ts:125`, `tests/work-graph/S4A-note-scope.test.ts:211`, `tests/work-graph/S4A-note-history.test.ts:76`. |

All three original should-fixes are **fixed**: latest topic spelling/new-topic filtering at `src/core/work-graph/notes/note-service.ts:515`, current-state conflict gating at `src/core/work-graph/notes/note-read-model.ts:237`, historical confirmation at `src/core/work-graph/notes/note-read-model.ts:140`.

R8 and R12 retain correctness limitations: root files can receive the wrong managing scope; unreadable RoleSpecs can remove scribes from scope calculations. Both are explicitly deferred. I found no additional correctness objection to the other rulings beyond blocker 1.

**UNSPECIFIED rulings**

1. **Accept the source hit/name span for 4A; document that TypeScript’s digest detects name changes, not declaration-signature changes.** `src/core/work-graph/notes/note-anchors.ts:347`, `src/core/workspace/typescript-source-query.ts:162`.
2. **Keep the result shape; include the malformed field path in `reason`.** See feedback issue above.
3. **Admission projection and committed-population reporting are separate; require sequential write/read agreement.** See blocker 1.
4. **Accept schemaVersion 2 public plan revision setup.** `tests/work-graph/S4A-note-scope.test.ts:41`.
5. **Accept `t10`: it supplies the required existing, unannotated cross-goal task.** `tests/work-graph/S4A-note-scope.test.ts:177`.
6. **Accept `unavailable` when a required historical version is missing.** `src/core/work-graph/notes/note-read-model.ts:146`.
7. **Accept page size 32 as internal; the total cap remains binding.** `src/core/work-graph/notes/note-anchors.ts:304`.
8. **Accept the permitted renderer fold; only its reach exception remains.** `tests/architecture/production-reach-allowlist.json:934`.
9. **Unused `plans` dependency is harmless; no ruling needed.** `src/core/work-graph/notes/note-read-model.ts:35`.

No new test-rule violation found: expectations are literal/manual, assertions use public services, and the `eventAt` fault is expressly covered by round-2 item 5(4). The composition union preserves both registrations and one shared resolver. Read-only review only; no tests or models invoked.

**merge after listed fixes**