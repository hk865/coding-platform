# Task D at H = 58ea2fdc: exact counts (TASK-D-PLAN §2 steps 6–7)

Source: `LTd/data/expected.json` (mk-move-data.sh LTd: wg-move.mjs on a fresh LTd copy of the new base, then
mk-expected.mjs), split with `split-counts.mjs` (`counts.txt`). The independent measure copy (`measure-H/`, measure.sh
on `git archive 58ea2fdc` in slot s1) gives the same `counts.txt` byte for byte, and the same 392-line listing except
for the three `file: '…'` lines (see "Listing format" below).

Keep rule: **canonical** (TASK-D-PLAN §3, recommended by the proposal, confirmed with it by decision 40).

| kind | H = 58ea2fdc (canonical) | proposal at 4404f4dc | bfb6075 (17 moves) |
|---|---|---|---|
| files the move changes | 165 = 18 moved + 145 other + 2 data | 165 = 18 + 145 + 2 | 157 = 17 + 138 + 2 |
| specifier changes, canonical | **380 in 158 files = 23 in 13 moved files + 357 in 145 other files** | 380 / 158 = 26 / 13 + 354 / 145 | 358 / 150 = 25 / 12 + 333 / 138 |
| specifier changes, literal keep | 376 / 157 = 19 / 12 + 357 / 145 | 376 / 157 = 22 / 12 + 354 / 145 | 354 / 149 = 21 / 11 + 333 / 138 |
| other files under `src/` | 68 files, 207 changes | 68, 204 | — |
| other files under `tests/` | 77 files, 150 changes | 77, 150 | — |
| `vitest.config.ts` | 0 | 0 | 0 |
| path strings | **12 = allowlist 5 + state-writes 7** (4 full + 3 `file:`) | 12 = 5 + 7 | 15 = 8 + 7 |
| test files touched | 79 = 77 + 2 data | 79 | — |
| dry-run lines | **392** = 380 + 12 | 392 | — |
| moved files without a specifier change | 5 (M1, M7, M8, M9, M12) | 5 | — |
| still-resolving specifiers rule (b) respells | 4 (in M14, M15, M16, M17) | 4 (same lines) | 4 |

## By syntax form (classify-kinds.mjs, `measure-H/kinds.txt`)

| form | relative specifiers in the tree | changed by the move |
|---|---:|---:|
| `import … from` | 5040 | 366 |
| `export … from` | 80 | 9 (all `src/app/core-http-types.ts`) |
| `import('…')` type position | 120 | 5 (attention-observer.ts:438, :440; host.ts:946; communication/mailbox-service.ts:1538; tasks/plan-write-admission.ts:230) |
| dynamic `import()` | 13 | 0 |
| `vi.mock` | 8 | 0 |
| `vi.importActual`, `vi.doMock`, `import x = require()` | 0 | 0 |

Both quote styles occur among the changes (e.g. `tasks/task-service.ts:37` `"./contracts.js"`).

## Other places that name WorkGraph files by path (§2 step 7)

`measure-H/path-places.txt`, `path-strings.txt`: only the two data files. `tests/architecture/boundaries.test.ts`
names fake files in temp dirs; `scripts/graph-session-demo.mjs:12` imports `dist/…/persistence/record-codecs.js`
(does not move); `scripts/check-boundaries.d.mts:17` names `state/` in a comment. No string literal outside the two
data files names a moved file. `git grep` outside `src/`, `tests/`, `docs/` finds no moved path (tools/dsh-refactor
names test files only). Nothing new for wg-move.mjs or the book's data-file rule.

## The difference from the proposal (4404f4dc → 58ea2fdc), line by line

`diff out/listing-canonical.txt measure-H/listing-canonical.txt`: 6 lines, all X2 (d91208e3):

```
- src/core/work-graph/model/evidence-contracts.ts   ../communication/contracts.js        ./communication-contracts.js
- src/core/work-graph/model/evidence-contracts.ts   ../materials/contracts.js            ./material-contracts.js
- src/core/work-graph/model/evidence-contracts.ts   ../tasks/execution-read-contracts.js ./execution-read-contracts.js
+ src/core/work-graph/evidence/evidence-service.ts  ../communication/contracts.js        ../model/communication-contracts.js
+ src/core/work-graph/evidence/evidence-service.ts  ../materials/contracts.js            ../model/material-contracts.js
+ src/core/work-graph/evidence/evidence-service.ts  ../tasks/execution-read-contracts.js ../model/execution-read-contracts.js
```

X2 moved `EvidenceServiceDependencies` and `CheckConfigurationResolver` out of `evidence/contracts.ts` (M11) into
`evidence/evidence-service.ts` (stays), and with them the type imports of three moved files. So 3 specifier changes
moved from "inside moved files" (26 → 23) to "other files" (354 → 357; src 204 → 207). File counts do not change:
`evidence/contracts.ts` keeps 1 change (`../tasks/contracts.js`), so 13 moved files still have changes, and
`evidence-service.ts` already imported moved files (`../tasks/contracts.js` and others), so it was already one of the
145. `tests/work-graph/R3e-reverify.test.ts` (X2) only moved a name between two existing imports: no count change.
M11 shrank from 241 to 186 lines (`move-stats.txt`); its importer count (19) did not change.

X1 (58ea2fdc) changes nothing in the counts: the new `materials/run-snapshot-decoder.ts` does not move and imports no
moved file, and its six importers switched from `tasks/run-state-service.js` to it, neither of which moves. WorkGraph
now has 101 files (100 + run-snapshot-decoder), so 83 stay instead of 82.

The literal-keep drops are the same 4 lines (`listing-literal-drops.txt` identical). Path strings, path places and the
test-file count are identical.

## Listing format

`expected-listing.mjs` (scratchpad `_tools`) was changed in one line: a state-writes decoder entry `file: '<from>'` now
lists as `<from>` (the text between the quotes), as the book asks; the bfb6075 version listed it as
`file: '<from>` (prefix kept, closing quote dropped), which no book asked for and would have failed 3 lines of a
correct dry run. The original is in `old-bfb6075/expected-listing.mjs.orig`. `listing-canonical.txt` (392 lines) is the
expected listing in the book's format; it compares to itself with exit 0.
