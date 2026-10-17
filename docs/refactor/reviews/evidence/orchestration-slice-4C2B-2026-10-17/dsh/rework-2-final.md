## FILES

**Production** (4 files, +93/−21, net **+72**): `architecture/catalog-service.ts` +15/−5, `notes/note-anchors.ts` +16/−3, `notes/note-decision-source.ts` +8/−6, `notes/note-service.ts` +54/−7. No new production file.
**Tests**: 9 modified (+350/−357) — `S4C2-note-card-fixture`, U6-e2e, D-rows, D17, U3, U7, collection-card-source, memory-material, read-counts; deleted `S4C2-note-decision-source.test.ts` (263) and `S4C2-note-decision-fixture.ts` (144).

## ITEMS (RED → GREEN)

1. **RED** on today's code (memory+SQLite): the new real-queue assertion got g1 `{plan:2, catalog:2, …}` — the card source read the goal window again for the stage target and the catalog per module target. **GREEN**: g1 `{plan:1, catalog:1, noteIndex:1, noteHead:1, pointer:1, targetHead:1}`, g2 `{plan:1, catalog:0, …}`; catalog total 1; note batches 3+3. Fix: `userReasonFacts` seeds the new `NoteCall.planWindows` with the caller's already-read windows; `NoteCall` gained a per-call catalog window threaded through a new `NoteAnchorFactsDeps.catalogModuleFacts` seam; write/scribe use the same per-call facts. The old reassembling file-anchor case was replaced by a real `queryDecisionQueue` case (record-store counting bracketed by the production note source); the first two cases are untouched and green.
2. U7 rebuilt on `createS4C2NoteCardFixture` over memory+SQLite (real writes, queue, `readDecisionCard`); the counting wrapper now sits on the production `createNoteReviewCardSource` (list vs by-key), no reassembly and no note-service spy. Deleted the spy fixture and the internal source test; U3 keeps only the forged-proof row.
3. `noteCardKey` and every S4C2 expected card key are hand-built JCS literals (`AGENT_CARD_KEY` in U6, independent literals in U7/D17/D-rows/collection); the memory-material header is literal. No production `decisionSourceKey`/`renderNoteHeader` in acceptance expectations.

## DELETED TESTS → COVERAGE

- D-13 keep/close → `S4C2-D-rows` D-13; D-13 stale/moved → `S4C2-rework-staleness` rework-2/D-02; D-16 → `S4C2-D-rows` D-16; D-17 pointer move → `S4C2-D17`.
- Exact card DTO/headers → `S4C2-U6-note-card-e2e` D-01 card assertions; the `renderNoteHeader` unit itself remains in `S4A-note-history`.
- U3 proof/receipt/replay → `S4C2-proof-changes` + retained U3 forged row + rework-staleness retry; U3 ordinary-incomplete → `S5-decision-application` AP04; U3 `note_review source facts` block → D-rows (D-05/D-12/D-13), rework-staleness, U6-e2e. The fake `Goal@7` positive card was deleted per the book; real-card projection is covered by U6-e2e/D-rows.

## CHECKS (`--maxWorkers=2`)

158 files / **1380 tests: 1349 pass, 26 fail, 5 skip**. All 26 are in `DSH-BASELINE.md`: composition 21 (§A), business R5b 1 (§A), `S2C-K-archive-tags-checks` 4 (§B). Groups: work-graph S4/S5/SP 84/951 (946 pass, 5 skip); app 5/43; business 15/131 (130/1); composition 39/141 (120/21); scenarios 10/46 (42/4); runtime+architecture 5/68. Focused run of the 8 changed test files 81/81; collection test re-run 4/4 after its literal fix. `typecheck` 0; `check:architecture` 0 (`next source boundaries: OK`); `build` 0. No scratch files, no git writes.

## UNSPECIFIED

- U7 has no meaningful RED — test-only rewrite, no production change; its counters are non-vacuous (missed spy → list 0; page-based direct read → list 2). Options: accept, or require a fault-injection seam for a RED.
- `S4C2-note-decision-source.test.ts` was deleted whole (every case publicly covered); no unique positive case remained. Options: accept, or keep one redundant positive case.
- U3's ordinary-disposition `incomplete` row: closest public coverage is S5 AP04 (generic incomplete), not note-specific. Options: accept AP04, or add a public note-specific row.

At most 3 subagents ran at once; all five finished.