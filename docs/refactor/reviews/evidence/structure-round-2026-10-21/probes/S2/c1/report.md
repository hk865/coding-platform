# C1 — break the note read/write import cycle (book §5.4)

Working tree: `/home/han001/dsh-work/slices/s9s85-S2` (based on `s85-base` = `e94d7b9`).
No commit was made. Scratch proof root: `/tmp/s85-scratch/S2/probes/c1/`
(the required repo scratch root is not writable in this sandbox).

## What changed

New modules:

- `src/core/work-graph/notes/note-base-reader.ts` (47 lines) — owns
  `ReadFailureCode`, `ReadOutcome<T>`, `readAllRecords`, `readAllHeads`.
- `src/core/work-graph/notes/note-rendering.ts` (9 lines) — owns
  `renderUnderstandingBody`.

Moved bodies are cut and paste, byte-identical except that `ReadOutcome` is now
`export`ed so `note-read-model.ts` can import it (see `body-diff.txt`).
`note-read-model.ts` re-exports `readAllRecords`, `readAllHeads`,
`ReadFailureCode` and keeps its `mapStoreFailure` / `MappedStoreFailure`
re-exports. `note-service.ts` re-exports `renderUnderstandingBody`. The writer
and scribe scope take `mapStoreFailure` directly from `store-failures.ts`.
`note-decision-source.ts` and `note-scribe-todos.ts` take `readAllHeads` from
`note-base-reader.ts`. The reader imports `renderUnderstandingBody` from
`note-rendering.ts`, so it no longer imports the writer.

Preserved exactly (by byte diff / inspection):

- first page omits `after`, every page `limit: 200`, stop only on `next === null`;
- every page is read before decoding (`await readAllRecords` then decode loop);
- a scan failure returns no partial result; the first bad head returns
  `{ ok: false, code: 'unavailable', reason: 'damaged note head' }`;
- success shapes stay distinct: `{ ok: true, value }` for records,
  `{ ok: true, heads }` for heads;
- the five-section body is byte-identical (no trailing newline, no trim);
- `note-read-model.ts` keeps
  `head.sections === undefined ? head.body : renderUnderstandingBody(head.sections)`.
- No note warning-label text was moved.

## Tests

All commands: `timeout 900 npx vitest run --maxWorkers=2 <files>` (never more
workers). The optional `tests/work-graph/S4C2-disposition-facts.test.ts` does
not exist; `S4C2-disposition-core.test.ts` was run instead.

| Batch | Files | Result |
|---|---|---|
| minimum list | S4A-note-caps, S4A-note-failures, S4A-note-history, S4C2-read-counts, S4C2-memory-material, S4C2-project-set-shared, S4C-scribe-ownership, S4C2-disposition-core | 8 files, 104 passed |
| remaining S4A/S4B/S4C note suites | S4A-note-concurrency, S4A-note-scope, S4A-note-symbol, S4A-note-write, S4B-note-read-failures, S4C-node-notes, S4C-note-continuity, S4C-note-path-ownership, S4C-note-protection, S4C-note-related-find | 10 files, 191 passed |
| more note suites | S4C-note-supersede-race, S4C2-scribe-user-reason, S8D-coverage-notes, SP-note-reuse, K3-39-record-note-lookup, S4B-note-anchor-goals, S4B-note-anchor-status, S4B-note-basis-path, S4B-note-budget-check, S4B-note-check-head-version | 10 files, 62 passed, 1 skipped |
| more note suites | S4B-note-check-isolation, S4B-note-check-observation, S4B-note-conflicts, S4B-note-definitions, S4B-note-facts, S4B-note-freshness, S4B-note-hints, S4B-note-invalid, S4B-note-missing-flows, S4B-note-symbol-recheck | 10 files, 87 passed, 1 skipped |

Total: 38 files, 444 passed, 2 pre-existing skips, 0 failures. `grep -rln` in
`tests/` for imports of the five existing note modules returned exactly the five
already-run files (S4C-scribe-ownership, S4C2-disposition-core,
S4C2-memory-material, S4C2-project-set-shared, S4C2-read-counts); every
note/scribe-named suite was also run. No test was edited and no timeout raised.

## Static proof artifacts

- `body-diff.txt` — OLD `s85-base` extracted bodies vs NEW bodies. Result:
  `readAllRecords`, `readAllHeads`, `renderUnderstandingBody` byte-identical;
  only the required `export` keyword added to `ReadOutcome`.
- `binding-table.md` — every identifier used by each moved body with old/new
  source module, plus the consumers whose same-named imports moved
  (`mapStoreFailure` → `store-failures.ts`, readers → `note-base-reader.ts`).
- `imports.txt` — before/after import lines for the five existing files and the
  runtime-cycle proof: base had 3 cycles, after has 0
  (static parse, `import type` excluded, `.js` specifier mapped to `.ts`).
- `cyclecheck2.py` — the cycle-checker used for `imports.txt`.

## Notes / skipped

- `npx vitest` does not typecheck; no typecheck/build was run per the task
  restrictions. The re-export/import pattern used here already exists in the
  base (`mapStoreFailure`), and every suite compiled and ran.
- The architecture check (`npm run check:architecture`) was not run by me; the
  coordinator runs it later. The import-graph proof above shows the reader,
  writer and scribe scope no longer form a runtime cycle.
- The working tree also contains unrelated modifications under
  `src/core/work-graph/views/` (`activity-read-model.ts`,
  `task-state-timeline.ts`, `track-read-model.ts`, new
  `views/activity-stable-window.ts`) that appeared during this session from
  parallel work. They are not mine and were not touched.
