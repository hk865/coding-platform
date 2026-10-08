# Task D stage BringIn (TASK-D-PLAN §8, decision 40): notes

Commit **0cd45508** on `feat/reliability-and-structure` (parent H = 58ea2fdc): "refactor: split WorkGraph into its
submodule directories (task D, pure move, decisions 32, 34, 40)". 165 files, +392 −392. Not pushed. The product model
and Codex were not run (DSH-WORKFLOW §7: a pure move is reviewed by byte comparison with the reference script, not by
Codex). DSH was not run in this stage. Ports 3080, 3099 and 44797 were not touched. `module-target.json` was not
written. Evidence files are in `scratchpad/taskd/bringin/` (B below).

## How the result came in

- Patch: `taskd/dsh/LTd-1.patch` (= `prepare/ref.patch`), sha256 adbc8a45…41c0. Rechecked first: `git -C ~/dsh-work/ladder/LTd-1 diff -M --binary HEAD` still gives the same hash.
- In the real worktree, clean at H: `git apply --index --check`, then `git apply --index`. Exit 0 both times. The renames come straight from the patch's rename headers, the same as `git mv`, so git records 18 `R` entries. The worktree files are written through the normal autocrlf conversion (CRLF on disk, LF in the index, like every other file here); `git diff` (worktree vs index) was empty.
- `git -c core.abbrev=7 diff --cached -M --binary` is **byte-identical** to the patch (`cmp`; sha256 adbc8a45…). Without `core.abbrev=7` the only difference is the index-line hash length (8 here, 7 in WSL; 160 index lines), not content. The full-hash form (`core.abbrev=40`) also matches between the real index and LTd-1 (sha256 6577442b…).
- All 574 `src/` and `tests/` files: mode, blob id and path in the real index equal `git hash-object` of LTd-1's files (`B/real-blobs.txt` = `B/ltd1-blobs.txt`).
- After the commit: `git diff -M --binary HEAD^ HEAD` (abbrev 7) has sha256 adbc8a45…, the commit's tree is 71c52ceb, which is the tree the full suite ran on (snapshot a8ff61c0, parent 58ea2fdc), and the worktree is clean.

## Checks on the real tree

| check | result | where |
|---|---|---|
| Files changed vs expected data (`verify-real.mjs` against `LTd/data/expected.json`) | 165 = 18 R (min similarity 96) + 147 M; expected 165 = 18 moved + 145 importers + 2 data files. Every move is a rename from the expected old path. No unexpected file. 0 files outside `src/` and `tests/`. | `B/name-status.txt`, `B/verify-real.mjs` |
| Content vs reference | 165/165 files have the reference move's sha256 (from `expected.json`) | `B/index-sha256.txt` |
| Line counts | numstat +392 −392 = 380 specifiers + 12 path strings; added = deleted in every file; the 5 pure renames `0 0` | `B/numstat.txt`, `B/stat.txt` |
| Exported names | TypeScript checker (`getExportsOfModule`, both tsconfig.json and tsconfig.ui.json programs) before (H) and after: **568/568 modules identical, 3600 names** (each with value/type kind); the 18 moved modules export 210 names, all as before (compared under their old paths) | `B/exports.mjs`, `B/exports-before.json`, `B/exports-after.json` |
| `npm run typecheck` | pass | WSL log `main-taskd-full-1` |
| `npm run check:architecture` | pass ("next source boundaries: OK"; WorkGraph sourceFiles=101; observed module edges 7/8 allowed, the same line as in the checker's run on DSH's copy) | same |
| `npm run build` | pass | same |
| Full suite (`~/cc-work/with-usr-bin-node.sh npm test`, slot main, quiet machine) | **Test Files 216 passed (216), Tests 5245 passed (5245)**, 996 s (wrapper 1036 s), exit 0. No failure, so no rerun and no flake. Same totals as the last full run `main-step7-full-1` (216 / 5245), and the per-file test counts are identical file by file (216 lines, `diff` empty), so X1 and X2 added no tests. | same; `B/full.out` |

The machine was quiet: only the user's two idle DSH instances (3080, 3099) were running in WSL, load average 0.8.
No host sleep this time (the suite's 996 s is close to step 7's 1086 s).

## Reviewer (decision 32)

No separate reviewer run. DSH-WORKFLOW §7 says a pure move is reviewed by byte comparison with the reference script,
which is independent of DSH; that comparison holds at three points: DSH's copy = reference (DSH stage), real index =
DSH's patch, and the commit's diff = the same patch. Decision 32's lead checks (test count unchanged, tests changed
only in imports and path strings, export sets unchanged, boundary check passes) are the table above.

## Stale names (follow-up, not edited)

`scratchpad/taskd/stale-paths.md`:
- **38 comments and test titles** in `src/` and `tests/`, the same 38 as the lead's list at H and DSH's report, rechecked on the moved tree (no new one, none gone): 14 by old path and 10 by a file name that changed are wrong now; 14 name a file that kept its name and are still true by name.
- `tasks/plan-validation.ts:1` (stem only), optional.
- **82 lines in 13 docs kept current** (work-graph.md 23, STATE-MACHINES-SPEC 22, IMPLEMENTED-CAPABILITIES 10, workflow.md 5, agent-runtime.md 5, design/orchestration-2026-10 12, and 5 single lines). Some describe the before-state on purpose (D-PLACEMENT 121–122).
- Historical or frozen, leave: `reviews/` 1265 lines, `tasks/` 130, `ui-reference/workbench-2026-10/` 63.
- No old path anywhere outside `src/`, `tests/` and `docs/`.

## Not done in this stage

- `npm run verify:isolated`: TASK-D-PLAN §8.3 lists it ("the closing step needs it"); this stage's task named only typecheck, check:architecture, build and the full suite, so it was not run. It repeats those four in an isolated copy plus the Kernel patch check and two smoke runs (port 0, no model). Due at the closing step.
- The evidence README (`docs/refactor/reviews/evidence/workgraph-move-2026-10-07/README.md`) and the HANDOFF, STATUS and DSH-WORKFLOW updates (TASK-D-PLAN §8.5).
- The follow-ups of §8.6: the stale comments and test titles, the doc mentions, and the `module-target.json` submodule rules (decision 40: after acceptance, a separate step).
- `~/dsh-work/ladder/LTd-1` and `LTd-ref` are still there; drop them (`drop_copy`) when the evidence is written.

## Lead effort (decision 36)

About 47 tool calls in about 25 minutes (21:17–21:42). About 17 minutes were the full suite (21:23:23–21:40:43);
about 8 minutes were the apply, the byte and blob comparisons, the export and expected-data checks, the stale-name
scan and the commit.
