# Task D stage DSH (TASK-D-PLAN §5–§7, decision 40): notes

H = 58ea2fdc. The real worktree was not changed and nothing was committed. Only DSH ran (headless profile, deepseek-flash,
through `~/dsh-work/ladder/_common/run-dsh.mjs`, bubblewrap, caps 20 min / 10M tokens). The product model and Codex
were not run. Codex is not needed here: DSH-WORKFLOW §7 says a pure move is reviewed by byte comparison with the
reference script, not by Codex. Ports 3080, 3099 and 44797 were not touched.
Evidence: `scratchpad/taskd/dsh/` (D below). The copy `~/dsh-work/ladder/LTd-1` is kept for the next stage. The
reference copy `LTd-ref` was only read.

## Result: every §6 check passes. DSH's tree is byte-identical to the reference move.

| §6 check | result | file in D |
|---|---|---|
| 1. `LTd/check.sh` (check-move.mjs) | **pass, score 1**: 165/165 files right and exactly as the reference. 18/18 moves are git renames (similarity ≥ 96). 380 specifiers in 158 files, plus the 2 data files. All 8 gates pass: movecheck, typecheck 0, architecture 0, noExtraChanges, onlySpecifierChanges, canonicalSpecifiers, noAgentCommits, testsUnchanged. Tests: 216/216 files and 5245/5245 ids, 0 regressions, 0 missing, 0 fixed, 0 flaky. HEAD and tag = setup 789a796c. | `LTd-1.check.json` |
| 2. Byte comparison | `git -C LTd-1 diff -M --binary HEAD` is **byte-identical** to `prepare/ref.patch` (sha256 adbc8a45…41c0 for both, 228,299 bytes). The setup trees are equal (a1554d40). All 2800 files outside .git and node_modules have the same sha256 in LTd-1 and LTd-ref. | `LTd-1.patch`, `tree-compare.txt`, `files-*.sha256` |
| git status / diff shape | 5 `R`, 13 `RM`, 147 ` M`. No untracked file. No ignored entry except the two node_modules, the same as LTd-ref. numstat: 165 entries, added = deleted in each, 392 lines in all, and the 5 unchanged moves are `0 0`. | `LTd-1.status*.txt`, `LTd-1.numstat.txt` |
| Frozen test hashes | The 166 `tests/` files outside the expected list keep their setup blob (`git hash-object`, which does not write). The changed tests are covered by the byte identity. | `tree-compare.txt` |
| Typecheck and check:architecture in a copy | Exit 0 in the checker's throwaway clone. Exit 0 again in visible-check.mjs's clone. | `LTd-1.check.json`, `visible-LTd-1.md` |
| Visible test command vs baseline | `Test Files  3 failed \| 68 passed (71)` / `Tests  9 failed \| 4202 passed \| 29 skipped (4240)`. This equals the baseline. It is also what DSH reported before and after. | `visible-LTd-1.md` |
| 3. Report vs lead's scans | See "DSH's report" below. The CHECKS numbers are all right, the stale list is 38/38, and every negative claim is true. One location in an UNSPECIFIED note is wrong. | — |
| 4. scan.json | Part 1: contamination "attempted-outside" from 1 pathHit. It is the known false positive: `../../../` inside an `echo` string of its own grep command (event 110). Part 2: none. Private /tmp uses: 0 and 0. `/tmp` in the events: 0 and 0. Forbidden git commands (add, rm, checkout, restore, stash, reset, commit): 0 and 0. Canary hits: 0. | `run-p1/scan.json`, `run-p2/scan.json` |
| 5. §6 import graph on DSH's tree | All five outputs are byte-identical to `prepare/ref-graph/`. That means 0 violations under target.json (fix B), and check:architecture with the fragment exits 0. The strict declaration fails only at `model/plan-contracts.ts:19` model → state. This ran on a throwaway rsync clone, and LTd-1's status was unchanged afterwards. | `graph-ltd1/` |
| 6. Reviewer (decision 32) | Not part of this stage. It is due before the commit, in the apply stage. | — |

No guided round was needed. Part 1's listing matched, so Part 2 went out as written in the book.

## Run sequence (TASK-D-PLAN §5)

1. `LTd/setup.sh ~/dsh-work/ladder/LTd-1`: setup commit 789a796c, tag ladder-setup (`setup-LTd-1.log`).
2. Part 1 (`run-p1.sh`): `run-dsh.mjs run LTd-1 LTd/task-part1.md LTd-1-p1 --level LTd`. Session session-49a1c63a-6066-4eb7-907a-162fc0cb0871.
3. Listing comparison: `expected-listing.mjs LTd/data/expected.json LTd-1/.dsh-scratch/move-dry.txt` (canonical, no `--literal`) gives `{"expected":392,"got":392,"match":true,"missing":0,"extra":0}`, exit 0 (`p1-listing-compare.txt`). Sorted, the listing also equals `prepare/listing-canonical.txt`. Saved as `move-dry.txt`, together with DSH's `move-tool.mjs`, `stale.txt` and the search log (`p1-*`).
4. Part 2 (`run-p2.sh`), same Session and same copy, with `--session-id`. After it: the diff, status, numstat and log of the copy (read only), then `LTd/check.sh`.
5. Lead checks: `tree-compare.sh`, `graph-ltd1.sh`, `visible-check.mjs` on a clone.

## DSH cost (decision 36)

| part | wall | active (host awake) | tokens | in / cache read / out | tool calls (steps) |
|---|---|---|---|---|---|
| 1 (read, before-checks, script, dry run, stale search) | 183 s | 183 s | 1,000,540 | 31,431 / 932,736 / 36,373 | 26 (24): bash 21, write 2, job_output 2, read 1 |
| 2 (git mv, apply, verify, checks, cleanup, report) | 292 s | ≈205 s | 1,172,794 | 7,372 / 1,147,648 / 17,774 | 14 (15): bash 11, write 2, read 1 |
| total | 475 s | ≈388 s (6.5 min) | **2,173,334** | | 40 |

- This is inside the plan's estimate (6–10 min, 2–3.8M tokens), and close to L3's single detailed run (352 s, 1.88M). The two-stage form cost about 0.3M more tokens than L3 and 36 s more active time.
- The stop after the dry run worked. Part 1 changed nothing outside `./.dsh-scratch/` (its git status showed only `.dsh-scratch/` files).
- **Host sleep** (`host-sleep.txt`): the Windows host slept four times during this stage, and the WSL VM paused with it. Once was in Part 2: 87 s, 20:38:06–20:39:33. Three were in the checker: 83 s, 31 s and 1198 s. The checker therefore shows 1818 s (about 506 s active). The app's keep-awake was already on, so the sleeps came from the user's power settings or the user. No test failed or flaked across them, and the byte identity does not depend on timing.

## DSH's report, checked

- **DRY RUN** (Part 1): `392 lines = 380 specifier changes in 158 files (23 in 13 moved files + 357 in 145 other files) + 12 path strings (5 + 7)`. By form 366/9/5; src 207/68, tests 150/77. Every number is right.
- **CHECKS**: before and after, typecheck 0, architecture 0, and the visible lines equal the baseline. The three failing files it names are the right ones. Its extra verification also checks out: 18 renames, 165 numstat entries with equal counts, 5 at `0 0`, and 160 content-changed files (158 + 2) with 392 changed spans (= 392 added lines in numstat).
- **FILES CHANGED**: the 18 moves, and 147 other files. That list equals the 147 ` M` lines of `git status` exactly (`p2-reported-files.txt` = `status-M.txt`).
- **Stale names (UNSPECIFIED)**: 38 lines in Part 1, and the same 38 again in Part 2. Both equal the lead's 38 (`prepare/stale-list.md`: 14 by path + 24 by name alone). Compared as sorted file:line lists: `p1-stale-lines.txt`, `p2-stale-lines.txt`, `lead-stale-38.txt`. It did not list `tasks/plan-validation.ts:1` (stem without `.ts`), which the lead's list also does not count.
- **Negative claims**: there are 8 "found nothing" claims and 1 "only the data line state-writes.test.ts:170" claim, for the old paths of M1, M4, M5, M7, M8, M11, M15, M17 and M18. I checked each with `git grep -nE '<path>' HEAD -- 'src/*.ts' 'tests/*.ts'` at H, where src/ and tests/ are identical to the copy's setup. All are true. Also true: "bare `contracts.ts` … 10 files, the 8 hits are all in `state/message-machine.ts`", and `src/contracts/architecture-catalog.ts:5` names `architecture/catalog-contracts.ts`.
- **One wrong location**: UNSPECIFIED says `tests/architecture/boundaries.test.ts:354 has relative specifier ../../scripts/check-boundaries.mjs` (in both parts). The specifier is on **line 6**. 354 is its character offset in the file (`head -c 400 | grep -bo` → `354:`). So DSH's script printed a position as a line number. The point itself is right: it is a `.mjs` specifier, neither end moves, and it stays by rule (c). It does not affect the tree. Per TASK-D-PLAN §10 ("expect at least one wrong … claim"), this is the expected kind of report error. It is a location, not a wrong negative claim.
- **Process**: no `/tmp`, no forbidden git command, `.dsh-scratch/` deleted, no commit, and the tag did not move.

## Lead effort (decision 36)

About 56 tool calls in about 47 minutes (20:30–21:17). Of that time, about 37 minutes were waiting: 3 min Part 1, 5 min Part 2, and 30 min checker, of which 22 min were host sleep. About 10–15 minutes were reading and checking:
- reading the plan, DSH-WORKFLOW §1/§6/§7 and the two books;
- the listing comparison (seconds);
- the patch byte comparison, status/numstat shape, report against the scans and negative claims, scan.json, the tree hash comparison, the import graph and visible checks (about 2 min of machine time each);
- explaining the sleep gap.

## For the next stage (TASK-D-PLAN §8)

- The patch to apply is `D/LTd-1.patch` (= `prepare/ref.patch`, sha256 adbc8a45…41c0). In the real worktree, clean at H: `git apply --index`, then `git diff --cached -M --binary` must equal the patch byte for byte.
- After that: the full checks (typecheck, check:architecture, the full suite at 216 files / 5245 tests with no new failure, `verify:isolated`), the reviewer (decision 32), and the commit.
- The evidence README needs: the two books (`prepare/part1.md`, `part2.md`), the numbers above, the check JSON, the reference comparison, DSH's reports (`run-p1/final.md`, `run-p2/final.md`) and the lead's stale list.
- The DSH-WORKFLOW cost entry: Part 1 183 s / 1.00M, Part 2 ≈205 s active / 1.17M, total ≈6.5 min / 2.17M, no guided round.
- `~/dsh-work/ladder/LTd-1` and `LTd-ref` are kept. Drop them after the apply (`drop_copy`).
