Read-through complete. No files changed; no subagents. Report:

## 1. Unclear (ruling/row I could not implement without guessing)

- **G-04 needs `src/core/work-graph/views/graph-context-reader.ts`, which §3 forbids.** `findGraph` matching is `presentation.name/paths/summary.includes(needle)` at `graph-context-reader.ts:1546-1552`; the cursor pages by matched offsets, so it cannot be re-filtered in `graph-tools.ts` without corrupting paging. Options: (a) authorize that file (only place); (b) defer G-04.
- **C1.5 needs `src/contracts/work-line.ts`, also not in §3.** `NodeDetailV1.notes` is `NotYetV1` at `contracts/work-line.ts:260`. Options: (a) authorize it; (b) add a new sibling field (still edits that file).
- **C1.3 role_exploration writers contradict §9.** `note-service.ts:115` refuses every `query_run`; no `role_exploration` classification exists in `src/` (grep is empty); query tool grants are manifest-permission driven (`query-execution.ts:218`). Options: (a) admit `query_run` writes for a named duty (changes 4A policy); (b) register the tool only and leave writes refused (G-01 partly undelivered); (c) defer to slice 6 as §9 says.
- **C1.4 `notes/list` has no target.** `notes.listNotes` does not exist; the holder has `listByAnchor`/six memory reads (`create-platform.ts:1328-1332`). Options: (a) new binding composing find+lookup from `{anchor?,goalId?,state?,limit,cursor}`; (b) alias `memoryFind`; (c) alias `listByAnchor`.
- **C3.2 `userReasonsOf(head, targets)` target shape and guard wiring.** Anchor-retired facts and relation heads live in the service/views, so state/ cannot compute them. `transitionNote` guard reads `event.reasons`, currently `head.reviewReasons` (`note-service.ts:1025`). Options: (a) service computes reasons and passes them in `event.reasons` (guard unchanged); (b) extend `NoteDispositionEventV1`/guard with targets; (c) inject facts into the machine.
- **Structural scope (C3.4 vs §11.6).** Does `structural: true` still put an *understanding* in `pending_review`? Existing tests `S4A-note-write.test.ts:464` and `:555` rely on yes; §3 lists only general-note sites. Options: (a) only general kinds change; (b) all kinds change.
- **Find's first-page `project` header (§11.4).** Every first page, or segmented only? §11.2 promises non-segmented 4B results byte-identical, but §11.4 states no condition. Options: (a) every `cursor===null`; (b) only when segmented.
- **`reviewNote` `resolution`.** §2's frozen `NoteWritePort.reviewNote` has no `resolution`; C1.2/C3.5 require it. Options: (a) add optional `resolution` to the port; (b) keep it tool-only (4C-2 card application needs it later).
- **Node→note anchor mapping (C1.5).** `GraphNodeRefV1` has session/run/round kinds with no note anchor. Options: (a) goal/stage/task/module get notes, others `note: null`; (b) map more.

## 2. Spec/facts vs code

- All §11.2/§11.3 and fact-report line cites predate speed round 1: `pointerOf` 404→**425**, `understandingOf` 1027→**1063**, `plan_changed` 547→**622**, lookup filter 1160-1166→**1214-1220**, `note-views.ts:973`→**1073**, `updateDue:null` 989→**1089**, stale 1403-1423→**1501-1521**, `graph-tools.ts:240-258`→**251-259**.
- Book C2.4 says `UnderstandingStatusV1.updateDue` "becomes `boolean | null`" — it already is (`model/note-contracts.ts:181`).
- §5.3 says GR05's path rule was "full equality"; the code is substring `.includes` (`graph-context-reader.ts:1551`).
- §2 labels `MemoryFindRequest`/`NoteItemV1`/`NoteCheckV1` under `src/contracts/note.ts`; they live in `model/note-contracts.ts:130-198`.

## 3. Tests that will break, not in §3

- `tests/work-graph/S3-graph-context.test.ts:862` GR07 ("find b is empty because matching is case-sensitive"), and expectations in GR06 `:851`/GR05 `:838` — G-04/G-03.
- `tests/work-graph/S2C-node-detail-executions.test.ts:34` expects `notes = {not_available, slice_4}` — C1.5.
- `tests/work-graph/S4A-note-write.test.ts:373` (test at 358) and `:701` (test at 687): structural general notes become accepted, not `pending_review` (C3.4); unlisted.
- `tests/architecture/production-reach-allowlist.json`: new route Body/Response aliases need `wire-format` entries or G3's `production-reach` fails; not in §3.
- `tests/work-graph/S4A-note-write.test.ts:676` reason list becomes `['quota_full']` (listed, but not by "change how the note is made").
- Likely: `tests/scenarios/S3-context-and-inputs.test.ts` sc01-find and `tests/scenarios/S3-query-graph.test.ts` sc02-find (§5.3, unlisted).

## 4. Plan

Order: (1) shared contracts + `note-machine` `userReasonsOf`/coexist-by (1 subagent, 25m); (2) reads in parallel — `note-related-scope`+resolver+segmented find (45m) and visibility/b11/project read side (40m); (3) writes/dispositions + allowed test changes (40m); (4) tools/registration (35m) and routes+node-detail+allowlist (35m) in parallel; (5) skill text (10m); (6) close-out checks (30m).

170m is not enough once the file-list and role_exploration decisions cost a round. I would land C2.1–C2.4, C3.1–C3.5, C1.1, C1.2, C1.4, C1.5 and leave C1.6 text, C3.6, G-04's `graph-context-reader` change, and role_exploration registration.