# Task D with DSH: the plan

Task D is the WorkGraph split as a pure file move: it moves files to the target submodule directories of `docs/refactor/module-target.json` and of the recomputed TARGET-DAG. The DSH ladder ran L3, which is task D itself at bfb6075 (17 moves, 157 files). This plan turns those results into a run. The evidence is in `SCORECARD.md`, `GUIDE.md` and `L3/RESULTS.md`; the move table draft is `L3/MOVE-TABLE.md`.

## In short

- **One task, not split.** Splitting cost about 3× and repeated the same error in each batch. One run handled all 157 files in about 6 minutes (L3).
- **One detailed book**, made from `_results/L3work/task-detailed.md` and regenerated on the then-current HEAD. That book form is the only one that passed L3 on its own. It needs:
  - exact counts by kind;
  - one keep rule, with an in-repo example;
  - a dry run whose count must match before anything is written;
  - forbidden git commands named;
  - a named scratch place.
- **Two stages in one Session** (the DSH-WORKFLOW rule, adapted to a move):
  - Part 1: DSH reads, measures the before-state, writes its script and the dry-run listing, and stops.
  - The lead compares that listing with the reference, line by line, in seconds.
  - Part 2: DSH applies the listing and runs the checks.
- **deepseek-flash, headless profile, no overlay, no role framing**, in the bubblewrap runner, with the 20 min and 10M token caps.
- **The lead checks mechanically.** First `check-move.mjs`, then a byte comparison with the reference move, then the report against the lead's own scans. A guided review round is ready for a failed gate. Then a reviewer re-checks (decision 32). The lead then applies the patch to the real branch, runs the full checks there and commits.
- **Expected DSH cost: 6–10 minutes and 2–3.8M tokens in all.** The L3 detailed run alone took 5.9 min and 1.88M tokens. One guided round, if needed, adds about 3 minutes and 1.8M tokens.

## 0. What task D is, and what it is not

**It is:**
- a pure move of the WorkGraph files listed in the approved move table;
- exported names stay the same; only file locations, file names and the references to them change;
- the test count stays the same, and tests change only in import specifiers and in the path strings that name moved files (STATUS "收尾").

**It is not** (each of these is a separate step, and not DSH's):
- X1 (moving `decodeRun` out of `tasks/run-state-service.ts`);
- writing the §8 `submodules` fragment into `module-target.json`;
- the decisions on the edges that the §6 check reports (at bfb6075: `model → tasks` through `PlanDelegatedWriteDependencies`, `model → state`, and the X1 edge);
- where each UNPLACED file belongs;
- the comment and doc updates for names that are now stale (a follow-up list, see §8).

These are decisions or code changes. DSH executes decisions, it does not make them (GUIDE §1).

## 1. Preconditions (before anything is regenerated)

1. The simplification step is done and committed (decision 34: unreachable code deleted first), and step 7 is done.
2. TARGET-DAG has been recomputed on the reduced code and compared with the structure part of the orchestration design. **The user has confirmed the move list** (decisions 32 and 34). Every UNPLACED file has a decision, even if the decision is "stays where it is".
3. The real worktree is clean at one commit, called **H**. Nothing else changes `src/` or `tests/` until task D is applied; otherwise the patch drifts.
4. A quiet machine for every check that feeds DSH or decides acceptance: no `~/cc-work` suite running at the same time. Under load the visible vitest command showed 14 failures instead of 8 (L3).

## 2. Regenerate everything from H

This follows MOVE-TABLE §9, with the ladder's corrections (marked "changed"). All counts in `MOVE-TABLE.md` are pinned to bfb6075. The tree at 42604b3 already has 8 new test files that import moved files, and the deletions will change it further.

1. **Move list:** write `moves.json` from the approved move list (`id`, `from`, `to`, relative to `src/core/work-graph/`). Regenerate MOVE-TABLE §1–6 with the same scripts: `_tools/move-stats.mjs`, `_tools/importers.mjs`, `scripts/import-graph*.mjs`, and the two scans of §5.
2. **New base:**
   - Keep the old base as `~/dsh-work/base-bfb6075` (read-only), so the ladder can be rerun.
   - Build `~/dsh-work/base` from H: `git archive` plus `node_modules`. `make_copy` adds the two vendor packages.
   - Run `_tools/sync.sh` to rewrite the golden manifest.
3. **Level directory for task D:** `LTd`. The name must match `^L[A-Z0-9][a-z0-9]*$` for `sync.sh`. Copy `setup.sh`, `check.sh` and `oracle/wg-move.mjs` from `L3/`, and put the new `data/moves.json` in it.
4. **Baseline:** `_tools/baseline-full.sh` and `_tools/mk-baseline.sh` give `_common/baseline-full.json` (all test ids and the environment failures; at bfb6075: 5203 ids, 60 failures). Also record the exact output of the book's visible vitest command (at bfb6075: `Test Files 1 failed | 72 passed (73)`, `Tests 8 failed | 4278 passed (4286)`). Run it on a quiet machine.
5. **Expected changes:** `_tools/mk-move-data.sh LTd` applies the reference move (`wg-move.mjs`) to a scratch copy and writes `data/expected.json`: every file that must change, with its specifier pairs, and the counts.
6. **Exact counts under the chosen keep rule (§3)** (changed). The listing helper prints and counts both forms: `node _tools/expected-listing.mjs LTd/data/expected.json [--literal LTd/data/moves.json]`. Split the counts by kind: changes and files inside moved files, changes and files in other files, and path strings per data file. At bfb6075:
   - canonical: 358 in 150 = 25 in 12 moved files + 333 in 138 others, plus 8 + 7 path strings;
   - literal: 354 in 149 = 21/11 + 333/138, plus 8 + 7 path strings.
7. **Specifier kinds and path-string places at H** (changed). `wg-move.mjs` covers:
   - `import … from` and `export … from`;
   - type-position `import('…')` and dynamic `import()`;
   - the first argument of `vi.mock`, `vi.importActual` and `vi.doMock`;
   - `vitest.config.ts`;
   - the two architecture data files.

   List in the book only the kinds that actually occur at H. Grep `tests/architecture/` and `scripts/` for any *other* place that names WorkGraph files by path. A new one must go into both the reference script and the book's rule 3.
8. **The lead's own stale-name list** (changed). Scan comments and test titles for every old directory path, *and* for the file name of every moved file, renamed or not, with or without a line reference. At bfb6075 there were 38 lines: 14 by path and 24 by name alone, 3 of those without a line reference. This list is what DSH's UNSPECIFIED is compared against.
9. **Oracle pair:** the reference move must pass `LTd/check.sh`, and a fresh copy must fail it (adapt `_tools/oracle-moves-b.sh`). Only then does the book go to DSH.
10. **The §6 check on the reference tree:** `import-graph.mjs` and `import-graph-check.mjs` with the new submodules. The violations it lists are input for the lead's later §8 step, not for DSH.
11. **The book:** start from `_results/L3work/task-detailed.md` and apply §4. Do **not** use `mk-move-books.mjs` as it is. It writes counts as "about N" (its `about()` function), and that is exactly what hid the L3 error.

## 3. One rule for specifiers that still resolve inside moved files

Two readings both pass the checker, and at L3a and L3 the runs split between them. Pick one and print its count.

- **Recommended: canonical.**
  - (a) In every file, a specifier that names a moved file gets the new path, as `path.relative` gives it.
  - (b) Inside a moved file, *every* relative specifier is spelled as `path.relative` gives it from the file's new directory, even when the old spelling still resolves.
  - (c) Everything else stays exactly as written.

  Why canonical:
  - MOVE-TABLE §7.4 asks for canonical spelling;
  - the reference script does this, so DSH's tree can be compared with the reference byte for byte;
  - 3 of 5 L3a runs and the L3 guided run ended there.

  Rule (b) is scoped to the moved files, so it cannot reach the 3 unrelated `agent-runtime` files that the L3 baselines touched.
- **Alternative: literal keep.** A still-resolving specifier inside a moved file stays as written. At bfb6075 this keeps 4 lines in the `../<own dir>/x.js` spelling. The detailed book passed with this rule.

## 4. The book: changes to `_results/L3work/task-detailed.md`

1. **Move table and "stays" list** come from the approved `moves.json` and the recomputed TARGET-DAG. The UNPLACED files stay where they are. Repeat "do not split any file".
2. **Rules as cases, decided by the file a specifier names, never by its text:** (a) and (b) as in §3, then (c): "everything else stays exactly as written, even if `path.relative` would spell it differently". Give one example that exists at H; at bfb6075 it was `'../../core/workspace/x.js'` under `src/core/agent-runtime/`. Regenerate the list of files that have the same name as a moved file but do not move.
3. **Invariant sentences:**
   - "No file outside the expected list changes."
   - "Every specifier you do not need to change stays byte-identical."
   - "No exported name changes. No re-export files at the old paths. No edits to comments, test titles or `docs/`."
4. **Size:** the exact counts from §2.6, by kind. "The dry run must match these numbers before you write anything."
5. **Dry-run format** (new). One line per change, tab-separated: `<path after the move>\t<old text>\t<new text>`. The texts are without quotes. Path strings in the data files go in the same format. The file is `./.dsh-scratch/move-dry.txt`. This is the format that `_tools/expected-listing.mjs` compares.
6. **Two parts** (new). Part 1 holds the whole book except the apply steps. It ends: "Stop after the dry run. Do not run `git mv` and do not change any file under `src/` or `tests/`. Reply with DRY RUN (the count line), CHECKS (the before numbers), UNSPECIFIED, NOTES." The apply steps (`mkdir`, the `git mv` lines, apply the listing, the path strings, verify, checks, cleanup, report) exist **only in the Part 2 message**, so DSH cannot run on past the stop.
7. **Scratch place:** `./.dsh-scratch/`, created by DSH and deleted at the end; never `/tmp`.
8. **Git:** allowed are `git mv`, `git status`, `git diff` and `git grep`. Named as not allowed: `git add`, `rm`, `checkout`, `restore`, `stash`, `reset` and `commit`.
9. **Visible checks** with the exact before and after numbers from §2.4. No other test runs.
10. **Report:** every comment or test title under `src/` and `tests/` that names a moved file by its old path, *or by its file name alone, with or without a line reference*, as file:line. List the search commands used. Every "none found" names the command that found nothing.
11. **Reading list:** the import and export lines of the moved files (by `grep -n`), and the lines of the data files that name moved files (by `grep -n`). Nothing else; the book carries the rest.
12. **Leave out:** any mention of the reference script or of hidden checks, any approximate number, any role preamble.

## 5. Run sequence

```bash
L=~/dsh-work/ladder; . $L/_common/env.sh
bash $L/LTd/setup.sh $L/LTd-1                                   # fresh copy of H + setup record
node $COMMON/run-dsh.mjs run $L/LTd-1 $L/LTd/task-part1.md LTd-1-p1 --level $L/LTd
#   lead, seconds: compare the listing with the reference (exit 0 = match)
node <scratchpad>/dsh-ladder/_tools/expected-listing.mjs $L/LTd/data/expected.json $L/LTd-1/.dsh-scratch/move-dry.txt
#   Part 2 in the same Session (session id from _runs/LTd-1-p1/run.json)
node $COMMON/run-dsh.mjs run $L/LTd-1 $L/LTd/task-part2.md LTd-1-p2 --level $L/LTd --session-id <id>
bash $L/LTd/check.sh $L/LTd-1 > <evidence dir>/LTd-1.check.json   # quiet machine, about 6–7 min
```

- Add `--literal $L/LTd/data/moves.json` to the comparison if §3 chose the literal rule.
- **If the listing matches,** the Part 2 message starts: "The lead compared your listing with the expected changes: they match. Now …".
- **If it does not match,** the Part 2 message is a guided review instead (§7): the extra or missing lines as file:line, the rule sentence to reread, and "account for your count". The apply steps come only after DSH has corrected the listing and it matches.
- One DSH run at a time, launched as a backgrounded tool call. Wait loops go in script files.

## 6. Acceptance checks (the lead's side)

1. **`LTd/check.sh`** (`check-move.mjs`) checks:
   - every expected file is right (per-file pairs), and every move is a git rename with the same exported names;
   - only specifier and path-string changes, all canonically spelled;
   - no other file is added, changed or deleted, ignored leftovers included;
   - typecheck exits 0, and `check:architecture` passes;
   - the full suite has the same test ids, with no newly failing test (a failing test is rerun once alone);
   - there is no commit and the tag has not moved.
2. **Byte comparison with the reference tree** (canonical rule): `git diff -M --binary HEAD` in DSH's copy and in the reference copy from §2.5 must give byte-identical output. If `mk-move-data.sh` dropped the reference copy, make it again: `setup.sh`, then `wg-move.mjs`. Blob hashes depend only on content, so a different setup commit does not matter. Two independent executions that agree byte for byte are the strongest evidence. At L3 the guided baseline matched the reference this way. With the literal rule, compare with the `--literal` listing instead.
3. **The report:**
   - every CHECKS number against the checker;
   - the stale-name list against the lead's list from §2.8;
   - every negative claim checked with `git grep`.
4. **`scan.json`:**
   - no access outside the copy (ignore the known false positives: `..` inside specifier text it typed, `~` in a regex);
   - `/tmp` uses should be 0 with the scratch rule. If not, record the count.
5. **The §6 import-graph check on DSH's tree** gives the same violations as on the reference tree.
6. **Reviewer:** an independent re-check (decision 32) of items 1–5 and of the diff itself, before anything is committed.

## 7. If something fails

| what | next step |
|---|---|
| The listing (Part 1) has extra or missing lines | A guided review instead of the plain Part 2: the lines as file:line; "resolve each old specifier; is its target in the move table?"; the rule sentence to reread; "account for your count". The apply steps come after the listing matches. |
| Score 1 but a gate failed (the L3 pattern) | A guided review in the same Session. Name the files and lines (from the check JSON's `unexpected` / `extraChanges`, or from `git diff --name-only` against the expected list), quote the rule sentence, ask it to account for its count, and add "edit only if the book requires it; name the rule". At L3 this took 155–196 s and 1.6–1.8M tokens, and both rounds passed. |
| A file is left unchanged | `details.files.missing` names each file and the specifiers it lacks; send them as a guided point. |
| A typecheck or test error | The first error's file:line is the location. DSH fixed every such mid-run error itself at L3a. Feed back only output taken on a quiet machine. |
| Still failing after one guided round, or a run hits 20 min or 10M tokens | Stop. Do not loop. Either rerun once on a fresh copy, or apply the reference move (`wg-move.mjs`) and record "DSH result not used" in the evidence. The lead decides. |

## 8. Bringing the result into the real repository

1. **Make the patch in the copy** (DSH has finished; this only reads the copy): `git -C <copy> diff -M --binary HEAD > task-d.patch`. `HEAD` is the setup commit, so this covers the staged renames and the unstaged edits.
2. **Apply it in the real worktree,** clean at H: `git apply --index task-d.patch`. Then regenerate `git diff --cached -M --binary` there; it must equal the patch byte for byte.
3. **Real-repo checks:**
   - `npm run typecheck`, `npm run check:architecture`;
   - the full suite: same test count as before the move, no new failure;
   - `verify:isolated` (the closing step needs it).
4. **Reviewer, then commit** on `feat/reliability-and-structure`, e.g. "refactor: move WorkGraph files to their target submodules (task D, executed by DSH)". No push without the user's authorization.
5. **Evidence:** `docs/refactor/reviews/evidence/workgraph-move-<date>/README.md` with:
   - the two book parts;
   - the numbers from `run.json` (time, tool calls, tokens);
   - the check JSON;
   - the reference comparison;
   - DSH's report and the lead's stale-name list.

   Update HANDOFF, STATUS and DSH-WORKFLOW (with the measured cost of the real run).
6. **Follow-ups, in their own commits:**
   - the stale comments and test titles from §2.8. These are mechanical once the file:line list and the new names exist. The lead can do them, or a small separate DSH task with the exact list and the replacement text per line.
   - the doc mentions (`IMPLEMENTED-CAPABILITIES.md`, `modules/core/work-graph.md`, the spec);
   - X1;
   - the §8 fragment, after the edge decisions.

## 9. Expected time and tokens

| step | who | time | DSH tokens |
|---|---|---|---|
| regenerate (§2): base, two full suites, reference move, oracle pair, book | lead + machine | 30–45 min of machine time (full suite and checker about 6–7 min each) | — |
| Part 1: read, before-checks, script, dry run | DSH | 3–5 min | 1.0–1.8M |
| listing comparison | lead | seconds | — |
| Part 2: apply, verify, checks, cleanup, report | DSH | 3–5 min | 1.0–2.0M |
| `check.sh` | machine | 6–7 min (9 min under load) | — |
| guided round, if needed | DSH | about 3 min | about 1.6–1.8M |
| apply in the repo, full checks, `verify:isolated`, reviewer | lead | 20–30 min | — |

**Basis for the DSH numbers:**
- The L3 detailed book did the whole job in one run: 352 s and 1.88M tokens.
- L3 baselines took 288–356 s and 1.5–3.0M tokens.
- Splitting the run at the dry run adds one continuation that re-reads the cached context. The L3 guided rounds, which mostly re-ran checks, cost 1.6–1.8M tokens each.
- The Part 1/Part 2 split itself was **not measured**, so the ranges are estimates.

Both parts are far below the caps (20 min and 10M tokens per run). **Size:** the deletions will shrink the tree, and the step-6 tests add about 8 importer files. Cost follows DSH's steps, not the number of files: from L3a to L3 the files grew 2.1×, while wall time grew 1.3× and tokens 0.9×. A move list somewhat larger or smaller than 17 files should stay in these ranges.

## 10. Risks and what is not measured

- **The stop after the dry run is new.** No ladder book contained a stop. Keeping the apply steps out of Part 1 means DSH cannot run past the stop. If the two-stage form causes trouble, the measured single-run form (the L3 detailed book, one message) is the fallback. The lead's listing comparison then happens after the fact, on `git diff`.
- **The detailed L3 book passed once.** Its consistency is not measured. The three plain baselines were wrong in the same way, so a systematic error is the risk, not a random one. The exact counts and the matching listing guard against it. If the first run needs a guided round, consider one more fresh run of the corrected book, to see whether the book or the run was at fault (about +6 min and +2M tokens).
- **New traps at H:**
  - new files with the same name as a moved file;
  - new path-string places in the architecture tests;
  - new specifier kinds.

  §2.7 and the oracle pair must find them before DSH does.
- **Reports.** Expect at least one wrong negative claim, and an incomplete stale-name list unless the method is given (L3: 14 of 38 lines without it, 35 of 38 with it). The lead's §2.8 list is the reference.
- **Process.** `/tmp` and forbidden git commands are likely even when named. The sandbox makes them harmless. The check's "no other file changed" gate and the setup record catch commits and leftovers.
