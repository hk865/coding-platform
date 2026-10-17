All items are closed and green. Final report:

## FILES CHANGED

**Production** (net +113; +502/−389): `notes/note-service.ts` (+268/−279), `views/decision-read-model.ts` (+98/−28), `business/workflow/decision-actions.ts` (+35/−31), `communication/decision-source-facts.ts` (+34/−2), `composition/create-platform.ts` (+20/−6), `notes/note-decision-source.ts` (+24/−36), `notes/note-scribe-todos.ts` (+9/−3), `model/decision-contracts.ts` (+6), `views/notice-grouping.ts` (+5/−2), `persistence/decision-record-codecs.ts` (+3/−2). No new production file.

**Tests** (13 modified, +925/−776; 6 new, 1,455 lines): new `S4C2-note-card-fixture.ts` (394, no spies), `S4C2-D-rows` (279), `S4C2-rework-staleness` (305), `S4C2-disposition-core` (224), `S4C2-collection-card-source` (155), `S4C2-proof-changes` (98); rewrote N1/N2/N3, D17, U6-e2e, U7, read-counts; U3's two locked lines; WP2-wiring F06; S2C-K; additive `S4A-note-scope-fixture` options. `S4C2-note-decision-source.test.ts`: two assertions updated to the new required `goalId`/proof shape (contract changes from items 4/9), nothing unrelated.

## ITEMS (RED → GREEN)

1. **Answer-text read**: RED `state:'applied'` after a one-shot saved-body read fault. Adapter now returns rejected `unavailable` before calling the owner; card stays answered-pending; retry applies v2 with `change.reason === '仅适用于旧接口'`. Memory+SQLite.
2. **`source_stale`**: RED pointer @3→@4 expected `source_stale` got `invalid`; D-02 got `revision_conflict`. `readSource` now set-compares the request pins with the fresh card (moved head/pointer/new pointer) and returns the CoreRejection; adapter maps the owner's `revision_conflict`; U3/U6 locked lines changed. Pointer test + D-02 memory+SQLite.
3. **One disposition core**: RED owner reject committed `{status:'done'}` and coordinator returned `applied`. Split `dispose`/`applyNoteDecision` at `transitionNote` into `finishDisposition`; scribe front unchanged (contradicted-only targets, pointer read only on accept); card reject gets a read-only pointer guard. M2: actor+proof on the card's own event only, targets `actor:null/proof:null`. RaceSeam test: coordinator `source_stale`/`application_not_recorded`, u2 pending v1, pointer u1@2 (memory+SQLite).
4. **Proof changes**: RED after ref was `NoteVersion@1`. Now `{before: NoteHead@v, after: NoteHead@v+1}` per changed head, no CurrentPointer row; supersede two literal rows, reject one. Removed the `NoteVersion` row from `AGGREGATE_REF_RULES` (nothing else used it).
5. **U7/U6**: RED `createCollectionCardSource is not a function`; U7-b expected `not_found` got `ready`. Added the verifier's generic spec adapter (assemble-once, offset paging, by-key, closed check); note source is now a spec registration. U6: `goal_conflict` is the default registration inside `createDecisionActions` (`{ goal_conflict, ...deps.decisionApplications }`), one lookup, no adapter → `answered`; existing decision/conflict suites green unedited.
6. **Card-source reads**: RED 9/8 note batches per goal. Added `reasonFactsOf`/batched `userReasonFacts` (one NoteCall, same facts as the guard), per-head only its own targets, `targetFactsOf` deleted, `note-scribe-todos` O(H×T) fixed. Read counts: 3 per goal / 6 total (note-index + NoteHead + CurrentPointer), plan reads counted separately = 1/goal, 2 total; memory+SQLite. Relation-target batch stays one per goal.
7. **Notice grouping**: both unbounded spreads → push loops; existing grouping test green.
8. **Tests through owners**: new no-spy fixture over memory+SQLite, deterministic ids, real writes/scribe dispositions. N1 RED `outside_managed_scope`; N2 RED `anchor_not_found`; N3 RED only my wrong consecutive-cursor assumption; corrected real seeds green. D-01 now a real contradiction card (supersede/coexist edit `contradicts`, old version keeps it); D-04/05/06/08/09/11/12/13/16 queue-level through `queryDecisionQueue`/`readDecisionCard`/`resolveDecision`; D17 migrated to the coordinator. Old hand-built `NoteVersion`/`noticeClass` seeds deleted. D rows were first-run green after items 1–7 landed (the old tests could not show the difference).
9. **M1**: RED misrouted g2 request expected `invalid` got `ready`/committed. `goalId` added to card facts; `readSource` → `invalid`, `readByKey` → null on mismatch; real two-goal test memory+SQLite.
10. **F06**: `另有 3 条` → `另有 2 条` (0 note_review hint + 1 message_release + 1 update-due); WP2-wiring 36/36.
11. **2C-26**: per-case `vi.useFakeTimers({toFake:['Date']})` + `setSystemTime(HOST_NOW)`, restored in `afterEach`; 3/3 twice. Probe: `SteppingDate` stepping back 1.7 s between requeue and C creation → fixed file **3/3 green**; control with the fix disabled 1/3, failing exactly as `inv-2c26` (`['implement-a']` vs `['implement-a','implement-a']`). Scratch deleted.
12. **M3**: no code change; N3 relies on the earlier-pages reading.

## CHECKS

`--maxWorkers=2`: 123 files, **1,279 passed / 5 failed / 5 skipped**. All 5 failures are in `DSH-BASELINE.md`: R5b-initial-planning-workflow (1, §A) and S2C-K-archive-tags-checks 2C-05 (4, §B). All new/changed files green (D-rows 18, e2e 16, N1–N3 6, U7/collection 6, disposition 4, proof 4, read-counts 6, staleness 8, 2C-K 3, WP2 36). `typecheck` 0; `check:architecture` 0 (`next source boundaries: OK`); `build` 0. No probe/stray files; no git writes.

## UNSPECIFIED

- `createCollectionCardSource(spec, readGoal?)`: the verifier's sketch has no goal-read seam but `project()` needs `GoalSnapshot`; added one optional second argument. Options: keep (chosen) vs. return the goal with the collection.
- The spy-captured `S4C2-note-decision-fixture.ts` remains only for U7's call-counting wrapper and the internal source/DTO/proof-receipt unit file; every acceptance row uses the new no-spy fixture. Options: keep (chosen) vs. delete and lose those unit assertions.
- U3's fake-port `readSource` unit tests were kept (they already use a `NoteHead` pin, unlike the old U7); real pointer/D-02/M1 tests cover the owners.
- D-09's only real goal-less pending seed is a project understanding (work-Run writes inherit the goal); D-13 uses a real Plan revision to retire the primary anchor.

## SUBAGENTS

7 total: Phase 1 — note core, staleness/adapters, acceptance fixture/N rows; Phase 2 — U7/U6, queue-level D rows, F06+2C-26; then close-out. **Most at once: 3.**