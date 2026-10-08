# Task D stage Prepare (TASK-D-PLAN §1–§4, decision 40) — notes

H = **58ea2fdc** (58ea2fdcaccf3c5f79d5d5d57bb8f5c45b78cbf0, tree 09696ea2), branch feat/reliability-and-structure.
The real worktree was not changed and nothing was committed (git status clean at start and end). No DSH run, no model
call, no Codex call in this stage. All outputs: `scratchpad/taskd/prepare/` (P below); the ladder copies:
`scratchpad/dsh-ladder/LTd/` (source of truth) and `~/dsh-work/ladder/LTd/` (synced).

## §1 Preconditions

1. Simplification committed (060e7696 … 7f137117), step 7 committed (1d53b569; full suite on 2ba9b46b: 216 files,
   5245 tests, all pass) — STATUS lines 8–9, 39–41.
2. Decision 40 (HANDOFF item 40, d8cfa5b1): the recomputed split (688589cc, after the Codex review 6d5b3024) is
   confirmed as recommended: 13 submodules per `target.json`, moves M1–M18, UNPLACED: M18 moves and the other nine
   stay, X1 and X2 before the move (done: d91208e3, 58ea2fdc), fix B for model → state, type-only file cycles
   accepted, module-target written after acceptance. Every UNPLACED file has its decision; the new X1 file
   `materials/run-snapshot-decoder.ts` was placed by decision 40 itself.
3. Real worktree clean at H. From here nothing else may change `src/` or `tests/` until task D is applied.
4. Quiet machine: before every suite run no vitest, checker or DSH run was on the machine (`ps`), only the user's idle
   DSH servers on 3080/3099 (untouched); this stage ran one suite at a time. One exception noted in
   `P/baseline.md` (a one-core PowerShell parse during the second visible measurement; identical results).

## §2 Regenerate everything from H

1. **Move list and MOVE-TABLE §1–6**: `LTd/data/moves.json` = the evidence `moves.json` (M1–M18, byte-identical).
   `P/tools/measure-H.sh` = the proposal's measure.sh without its what-if step (X1/X2 are in the code now) plus two
   extra scans; output `P/measure-H/` (move-stats, importers, import graphs, path places, stale scans, kinds).
   Summary in `P/move-table.md`.
2. **New base**: `P/tools/new-base.sh` (log `P/new-base.log`). Old base kept read-only as `~/dsh-work/base-bfb6075`
   (tree a69718a8 = bfb6075's tree). New `~/dsh-work/base` = `git archive 58ea2fdc` + node_modules from the old base
   (both lock files are identical at bfb6075 and H) + one commit "baseline 58ea2fdc…" (by base@localhost, like the old
   one); its tree equals H's tree (09696ea2). `_tools/sync.sh` rewrote the golden manifest (copy `P/golden-H.json`;
   the bfb6075 one in `P/old-bfb6075/`). Integrity verify: ok.
3. **Level LTd**: `setup.sh`, `check.sh` (adapted from L3: level name, comments), `oracle/wg-move.mjs` (= L3's, =
   `_tools/wg-move.mjs`), `data/moves.json`, `data/visible.json`, `data/scan.json` (L3's commands and canaries).
   Copies in `P/LTd/`.
   - **Change found by the oracle pair's canary check:** H contains the proposal's evidence directory, whose
     `scripts/ladder/wg-move.mjs` and `mk-expected.mjs` carry both canaries (and `out/listing-canonical.txt` is the
     answer listing at 4404f4dc); `dsh-ladder-2026-10-07/` holds TASK-D-PLAN and the move-table draft. A DSH copy
     would contain the reference script and the answers. LTd's `setup.sh` therefore removes these two evidence
     directories before the setup commit. No test, script or config reads them (git grep), the move touches only
     src/ and tests/, and the reference patch is byte-identical with and without the strip. With the strip the canary
     check is ok (`P/oracle-pair/LTd-canary.json`); the first, unstripped round is kept as `unstripped-*`.
4. **Baseline** (`P/baseline.md`): full suite at H, plain WSL: **216 files, 5245 tests: 5089 passed, 127 failed,
   29 skipped** (all the missing check sandbox `/usr/bin/bwrap`; stable in five full runs). `_tools/mk-baseline.sh`
   now computes its note (it hard-coded the bfb6075 sentence; original in `P/old-bfb6075/`) → `_common/
   baseline-full.json`. Visible vitest command, four runs (clone and sandbox, before and after the strip), identical:
   `Test Files  3 failed | 68 passed (71)` / `Tests  9 failed | 4202 passed | 29 skipped (4240)`; typecheck and
   check:architecture exit 0. At bfb6075: 60 failures / 5203 tests and `1 failed | 72 passed (73)`,
   `8 failed | 4278 passed (4286)`; the differences are explained in `P/baseline.md` (new step-6 scenario and
   invariants tests that need the check sandbox; 14 test files gone).
5. **Expected changes**: `_tools/mk-move-data.sh LTd` → `LTd/data/expected.json` (sha256 5580dd6f…3c32): 165 files =
   18 moved + 145 importer + 2 data; 380 specifiers; 12 path strings. Regenerated after the strip: byte-identical.
6. **Exact counts by kind** (`P/counts.md`, `P/counts.txt`, `P/listing-canonical.txt` 392 lines,
   `P/listing-literal.txt` 388 lines): canonical **380 in 158 = 23 in 13 moved files + 357 in 145 other files**
   (src 207 in 68, tests 150 in 77, vitest.config.ts 0); literal 376 in 157 = 19/12 + 357/145; path strings
   **12 = allowlist 5 + state-writes 7** (4 full + 3 `file:`); test files 79.
   **Against the proposal at 4404f4dc** (380 in 158, 145 other files, 12 path strings, 79 test files): every total is
   the same. Only the split moved by 3: inside moved files 26 → 23, other files 354 → 357 (src 204 → 207). The listing
   diff is exactly 6 lines, all X2: the three type imports of moved files (`../communication/contracts.js`,
   `../materials/contracts.js`, `../tasks/execution-read-contracts.js`) left `evidence/contracts.ts` (M11) with
   `EvidenceServiceDependencies` and went to `evidence/evidence-service.ts`, which stays and was already one of the
   145 importers; M11 keeps 1 change, so the file counts do not move. X1 changes no count (the new decoder file does
   not move and imports no moved file; its six importers switched between two files that do not move). The 4
   literal-keep drops, path strings, path places and test-file count are identical.
7. **Specifier kinds and path places at H** (`P/measure-H/kinds.txt`, `path-places.txt`, `path-strings.txt`):
   changes are 366 `import … from`, 9 `export … from` (all `src/app/core-http-types.ts`), 5 type-position
   `import('…')` (the same 5 places as the proposal); dynamic `import()` (13 relative ones in the tree) and `vi.mock`
   (8) name no moved file; `vi.importActual`/`vi.doMock` do not occur; vitest.config.ts 0. No other place names a
   WorkGraph file by path (tests/architecture, scripts, and a git grep outside src/tests/docs). Nothing to add to
   wg-move.mjs or the book's data-file rule. Both quote styles occur among the changes.
8. **Lead's stale-name list** (`P/stale-list.md`): **38 lines = 14 by path + 24 by file name alone (21 with a line
   reference, 3 without)**, every hit read in context; the same 38 places as at bfb6075 (checked with the same scan on
   bfb6075), with line numbers moved in `state/`. One extra note: `tasks/plan-validation.ts:1` names the stem
   `plan-record-codecs` without `.ts` (not counted).
9. **Oracle pair** (`_tools/oracle-ltd.sh`, results `P/oracle-pair/`): the reference move on a fresh LTd copy
   (`~/dsh-work/ladder/LTd-ref`, kept for the §6.2 byte comparison) **passes** `LTd/check.sh`: score 1, 165/165
   exactly as reference, all 8 gates, 18/18 moves (similarity ≥ 96), 380 specifiers in 158 files, typecheck 0,
   architecture 0, 5245/5245 test ids with 0 regressions, 0 missing, 0 fixed (404–409 s). A fresh copy **fails**:
   score 0, 147 files missing, 18 moves not moved, all other gates green and tests unchanged (400–414 s). Both rounds
   (unstripped, stripped) give the same verdicts. Reference patch: `P/ref.patch` (`git diff -M --binary HEAD` in
   LTd-ref, sha256 adbc8a45…41c0); its status: 5 `R`, 13 `RM`, 147 ` M`; numstat: 165 entries, every one with equal
   added and deleted lines, the 5 unchanged moves 0/0.
10. **§6 check on the reference tree** (`P/ref-graph/`, same as the measure copy): with `target.json` (fix B) 0
    violations, 0 forbidden directions, 0 submodule cycles, 2 accepted type-only file cycles, `tasks → architecture`
    declared and unused, `check:architecture` with the fragment in a throwaway clone exit 0; with the strict 10-02
    declaration exactly one error, `model/plan-contracts.ts:19` model → state (what fix B declares). Input for the
    later module-target step: no open edge.
11. **The book**: below (§4). `mk-move-books.mjs` was not used.

## §3 Keep rule

**Canonical** (rules a/b/c of TASK-D-PLAN §3): recommended by the proposal (README §7) and confirmed with it by
decision 40; the reference script does it, so DSH's tree can be compared byte for byte with `LTd-ref` / `ref.patch`.
The book prints its count (380 in 158 = 23/13 + 357/145) and names the 4 still-resolving specifiers rule (b)
respells, with one of them as the example (M15's `'../tasks/model-call-contracts.js'` → `'./model-call-contracts.js'`).
Compare with `expected-listing.mjs` **without** `--literal`.

## §4 The book (`P/part1.md`, `P/part2.md` = `~/dsh-work/ladder/LTd/task-part1.md`, `task-part2.md`)

Made from `_results/L3work/task-detailed.md`. Checklist of TASK-D-PLAN §4:
1. Move table M1–M18 from `moves.json`; the 83 staying files described (all of `state/`, the two root files, the nine
   UNPLACED that stay, run-snapshot-decoder); "do not split any file, do not move a declaration".
2. Rules (a), (b), (c) decided by the file a specifier names; example for (c) that exists at H:
   `src/core/agent-runtime/observed-model-run.ts:10` `'../../core/workspace/source-identity.js'`; the regenerated
   same-name list (5 files, unchanged since bfb6075).
3. The three invariant sentences.
4. Exact counts by kind (specifiers moved/other, src/tests split, by form, the 5 moved files without changes,
   path strings 5 + 7, 392 lines); "The dry run must match these numbers before you write anything."
5. Dry-run format `<path after the move>\t<old>\t<new>` in `./.dsh-scratch/move-dry.txt`, one line per occurrence,
   path strings in the same format with the text between the quotes (example for `file: '…'`).
6. Part 1 ends at the dry run with the required stop sentence and the DRY RUN / CHECKS / UNSPECIFIED / NOTES reply;
   the apply steps (mkdir, the 18 `git mv` lines, apply, path strings, verify, checks, cleanup, report) exist only in
   part 2. Part 2 opens with "The lead compared your listing with the expected changes: they match. Now apply it."
   (if the listing does not match, the next stage sends a guided review instead, TASK-D-PLAN §5/§7).
7. Scratch place `./.dsh-scratch/`, never `/tmp`, deleted in part 2.
8. Allowed git: mv (part 2), status, diff, grep; named as not allowed: add, rm, checkout, restore, stash, reset, commit.
9. Visible checks with the exact before/after lines and the exact failing tests.
10. Report: stale names by old path or by file name alone, with or without a line reference, as file:line, with the
    search commands; every "none found" names its command (searched in part 1, re-checked in part 2).
11. Reading list: `grep -nE` of the import/export lines of the 18 files, and one `grep -nE` for the 12 data lines
    (verified to return exactly those 12 lines at H).
12. No mention of the reference script, hidden checks or the checker, no approximate number, no role preamble
    (grep of the book for about/approx/reference script/oracle/hidden: none).
Size: part 1 1,899 words, part 2 504.

## Tool changes in the scratchpad ladder (not in the repo)

- `_tools/expected-listing.mjs`: `file: '<from>'` now lists as `<from>` (the bfb6075 version listed
  `file: '<from>`, which no book asks for and would have failed 3 lines of a correct dry run). Negative test: a
  listing with one line replaced gives exit 1 with the MISSING and EXTRA line. Original in `P/old-bfb6075/`.
- `_tools/mk-baseline.sh`: note computed from the report and the base commit. `_tools/oracle-ltd.sh`: new.
- `~/dsh-work/base` is now H. The old levels L2–LD (pinned to bfb6075) are judged against the new base from now on;
  to rerun one of them, point BASE at `~/dsh-work/base-bfb6075` and restore `P/old-bfb6075/baseline-full.json`.
- `~/dsh-work/ladder/_baseline` (this stage's baseline copy) removed after use; `LTd-ref` kept.

## For the next stage (run, TASK-D-PLAN §5)

- Fresh copy with `bash ~/dsh-work/ladder/LTd/setup.sh ~/dsh-work/ladder/LTd-1`, part 1, then
  `node <scratchpad>/dsh-ladder/_tools/expected-listing.mjs ~/dsh-work/ladder/LTd/data/expected.json
  ~/dsh-work/ladder/LTd-1/.dsh-scratch/move-dry.txt` (no `--literal`), part 2 in the same Session, `LTd/check.sh`.
- Byte comparison: `git -C ~/dsh-work/ladder/LTd-1 diff -M --binary HEAD` must equal `P/ref.patch`
  (= `_results/LTd-ref.patch`).
- Report check: CHECKS against the numbers above, UNSPECIFIED against `P/stale-list.md` (38 lines).
- Any sync after editing the books: `_tools/sync.sh` (golden manifest), then integrity verify.
