# L2 results: DSH on the small mechanical move (2026-10-07)

Level L2: move 4 WorkGraph contract files into `model/` (TARGET-DAG M5, M7, M8, M12; M7 and M8 are renamed), then fix every reference. 35 files have to change: 4 moved files, 30 importer files and 1 data file. That is 39 specifier changes in 31 files plus 5 `"file"` values in `tests/architecture/production-reach-allowlist.json`. The checker is `L2/check.sh` (`check-move.mjs`): score = files exactly right / 35, plus the gates from `ORACLE.md`.

DSH 0.1.7-rc.2, headless profile, default model **deepseek-flash** for every run. Each run went through `run-dsh.mjs` in bubblewrap, on a fresh copy made by `L2/setup.sh`. Feedback rounds reused the same copy and the same Session (`--session-id`). Run artifacts (run.json, scan.json, events.jsonl, final.md, check JSON) are in `_results/L2work/runs/`. The variant books and follow-ups are in `_results/L2work/`.

## Result in one paragraph

L2 is well within DSH's reach. All 5 independent runs passed: 3 baselines, role framing and the detailed book. All 5 had score 1, every gate green and 35/35 files byte-identical to the reference move. The 5 diffs are byte-identical to each other (same sha256). A baseline took 2.5–3 minutes and about 0.81M tokens, about 92% of them cache reads. The extra book styles did not make it better, cheaper or faster. Role framing made it slower and more expensive, and it caused a mid-run mistake that DSH then repaired itself. A guided review round fixed two wrong report lines in 12 s without touching the tree. Raw check output got only a one-line "Confirmed".

## Runs

| run | book / follow-up | wall | tool calls (by tool) | steps | fresh input | cache read | output | total | verdict | score | gates | scope | outside the copy | report |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 (`L2-base-1`) | `L2/task.md` | 167 s | 29 (bash 20, read 4, grep 2, todo 3) | 20 | 32,366 | 749,312 | 26,095 | 807,773 | pass | 1 | all | in scope | none ¹ | 4/4 sections; one wrong rule attribution |
| baseline-2 (`L2-base-2`) | `L2/task.md` | 169 s | 26 (bash 18, read 5, edit 1, todo 2) | 19 | 42,141 | 743,552 | 23,046 | 808,739 | pass | 1 | all | in scope ² | none ¹ | 4/4; true; did not mention its /tmp scripts |
| baseline-3 (`L2-base-3`) | `L2/task.md` | 154 s | 21 (bash 17, read 4) | 15 | 67,761 | 736,640 | 19,039 | 823,440 | pass | 1 | all | in scope | none ¹ | 4/4; true; shortest |
| role (`L2-role-1`) | role preamble + `L2/task.md` | 249 s | 52 (bash 30, edit 11, read 8, job_output 3) | 31 | 53,600 | 1,483,520 | 33,836 | 1,570,956 | pass | 1 | all | in scope at the end ³ | none ¹ | 4/4; true; reported its own slip |
| detailed-book (`L2-detail-1`) | `L2/task.md` + 10-step list | 162 s | 36 (bash 30, read 5, edit 1) | 22 | 54,592 | 971,264 | 22,416 | 1,048,272 | pass | 1 | all | in scope | none ¹ | 4/4; **one false claim** |
| guided-feedback (`L2-base-1-guided`) | lead's review on baseline-1, same Session | 12 s | 2 (bash 2) | 2 | 1,541 | 114,816 | 2,811 | 119,168 | pass (re-checked) | 1 | all | tree unchanged | none | both report errors fixed |
| raw-feedback (`L2-base-2-raw`) | `visible-check.mjs` output on baseline-2, same Session | 3 s | 0 | 1 | 1,480 | 64,128 | 180 | 65,788 | pass (tree unchanged) | 1 | all | tree unchanged | none | one line, no sections |

Every run ended with `turn_end: completed`, exit 0 and no stop. No limit came near: the longest run took 4.2 of the 20 minutes and 1.6M of the 10M tokens. Checker times were 346–410 s. Every full suite gave 5203/5203 ids, with 0 regressions and 0 flaky tests. No run committed, moved the tag, left git-ignored leftovers or changed a test beyond specifiers.

¹ `scan.json` marks every run except the two feedback rounds as `attempted-outside`. All 19 `..` hits are false positives: `..` inside module-specifier text that DSH typed into its own edit tables and scripts (for example `'../model/execution-history-contracts.js'`), never a path it opened. The other 4 hits are its helper scripts in the private `/tmp` (² ³). No canary hits. Nothing outside the copy was read. Suggestion for `scan-run.mjs`: ignore `..` inside quoted `.js` specifiers, or the flag means nothing on move levels.
² baseline-2 wrote helper scripts `/tmp/analyze.js` and `/tmp/analyze2.js` and deleted them at the end. The book says "do not read, list or write any path outside it". That is harmless in the sandbox, where /tmp is private, but it breaks the letter of the book, and the report does not mention it.
³ The role run's rewrite script first changed 3 unrelated files. DSH saw this and restored them; the end state is in scope (details below). It also wrote `/tmp/scan.mjs`.

Machine note: baseline-1 ran alone. The other runs ran while the previous run's checker was working (`--maxWorkers=4`, 24 cores). Baseline-1, which ran alone, took 167 s; baselines 2 and 3 took 169 s and 154 s, so the overlap shows no visible effect on wall time. A separate test workflow in `~/cc-work` ran the whole time.

## Spread across the three baselines

- **Outcome: no spread.** 3/3 pass, the same 35 files, byte-identical diffs (sha256 `e74d1f8a…` for all three, and also for role and detailed-book).
- **Process: moderate spread.** Wall time 154–169 s (±5%), tool calls 21–29, output 19–26k tokens, fresh input 32–68k. Total tokens 0.808–0.823M (±1%), because cache reads dominate. Each baseline used a different edit method:
  - baseline-1: a `while read f old new` bash loop that counts each old string before it applies `sed`;
  - baseline-2: a Node analysis script in /tmp, then an inline Node edit table;
  - baseline-3: an explicit Python edit dict (`python3 - <<'PYEOF'`).
  All three found the traps without being told: `./contracts.js` inside `tasks/` names the non-moved `tasks/contracts.ts`, `task-service.ts` uses double quotes, and the moved `execution-history-contracts.ts` needs `./contracts.js` → `../tasks/contracts.js`.
- On this level, flash showed no "good one time, bad the next" effect in the result. The unevenness showed up only in how it worked: see the role run.

## What DSH did well

- **It followed the spec exactly.** The diffs contain only specifier text and `"file"` values. No reformatting, no comment edits, no shims, no `docs/` changes, no re-serialized JSON. In every run the allowlist was edited as text.
- **It resolved paths instead of matching text.** Every run handled the same-directory `./contracts.js` correctly: it changed it in `configuration/` and `materials/` and left it alone in `tasks/`. Every run also left `src/core/agent-runtime/execution-history-contracts.ts`, the same-basename file, untouched.
- **It checked its own work.** Each run looked at `git status` and the changed lines (`git diff | grep '^[+-]'`) before it ran the three checks. The CHECKS sections match what the checker measured.
- **Its UNSPECIFIED sections were useful.** 4 of 5 runs found the comment that still names an old path (`architecture/catalog-record-codecs.ts:13`, "reused from `tasks/task-index.ts`"). They also noticed that only M7 has allowlist entries (5 entries), and listed the old paths that `docs/` still mentions.

## Where it went wrong

- **Role run: over-reach, then self-repair.** Its Node rewrite script turned every relative `.js` specifier in `src/` and `tests/` into the `path.relative` spelling, not only the specifiers that point to moved files. That changed 3 unrelated files (`agent-runtime/exploration-tools.ts`, `observed-model-run.ts`, `project-source-tool.ts`), whose original spelling `'../../core/workspace/…'` is not canonical. DSH noticed: "The script over-reached: it canonicalized unrelated relative paths in three non-moved files." Its first restore attempt failed ("file has not been read"). It then read the files, restored them and confirmed an empty diff. It also started a "before" test run in the background and edited files while that run was going, then admitted: "The first baseline vitest run overlapped my edits (it observed a half-moved tree) and is invalid". The cost was +53% wall time, +93% tokens and about twice the tool calls compared with the baseline mean. The likely trigger is the book sentence "the specifier is exactly the path from the importing file's directory to the target, as `path.relative` gives it": the role framing pushed DSH to apply it to every specifier.
- **Detailed-book run: one false report claim.** Its report says "No comment in any `.ts` file under `src/` or `tests/` names one of the four old paths". That is wrong. Its own search had piped the hits through `grep -vE "^\S+:[0-9]+:(import|export|\}|.*from )"`, and the only such comment reads "reused from `tasks/task-index.ts`", so the comment matched `.*from ` and was dropped. The edit itself was perfect, but the report claim was untrue.
- **Baseline-1: one wrong rule attribution.** It wrote: "Same-directory `./contracts.js` imports inside `configuration/` and `materials/` were rewritten to `../model/...` because the importing file moved (rule 2)". In fact the imported file moved, so rule 1 applies. It also said, correctly: "I did not capture pre-change vitest counts independently".
- **"Same number of tests" was not verified in 4 of 5 runs.** The book asks for the same count as on the unchanged copy but does not give that count. Baselines 2 and 3 and the detailed-book run report "159 passed" without a before count. The role run tried to measure it, but the measurement was invalid. Baseline-1 admitted it had none.
- **Helper files outside the copy.** Baseline-2 and the role run wrote scripts to `/tmp`, although the book forbids paths outside the copy. 4 of 5 runs did the edit with a throwaway script (Node or Python) rather than with the edit tool.

## Feedback rounds: (a) raw and (b) guided

There was no failure to feed back: every run passed every gate, and the book's own checks all pass. So the two rounds were run as review rounds on passing work, in the same Session. They do not show how DSH repairs a real failure; that comparison belongs to the levels where it fails (L3a/L3).

- **(a) raw, on baseline-2.** The follow-up was the `visible-check.mjs` output alone: three exit 0s and 9 files / 159 tests. DSH answered in 3 s with no tool call: "Confirmed — your run matches my report exactly: typecheck exit 0, architecture exit 0, and vitest 9 files / 159 tests passed. No further changes were made…". The tree stayed byte-identical. The reply was harmless but gave no new information, and it dropped the four-section format.
- **(b) guided, on baseline-1.** The follow-up was written like a lead's review. It named two lines of DSH's own report. The first was the unverified "same number of tests", with a line of thought: show from `git diff` of the test files whether any `it(`/`test(`/`describe(`/`.skip`/`.only` line changed, and report that as a reasoned claim. The second was the wrong "(rule 2)" line, with a file to look at and the question "which file moved?". It gave no answer and no verdict. DSH took 12 s, 2 tool calls and 2.8k output tokens. It ran exactly the two suggested checks, fixed both lines correctly ("those belong to rule 1, not rule 2… Rule 2 applies only to the four moved files themselves") and labelled the count as reasoned, not measured, as it was asked to. It changed no file: same diff sha256, and the re-check passed.
- **Comparison.** Both rounds were cheap: 66k and 119k tokens, almost all cache. Neither damaged correct work. Only the guided round produced anything useful. That fits the user's point: a follow-up should name a location and a line of thought. When nothing fails, raw output just produces "confirmed".

## Did the variants make it cheaper or faster?

| | wall | tool calls | total tokens | output | result |
|---|---|---|---|---|---|
| baseline mean (3) | 163 s | 25 | 0.813M | 22.7k | 3/3 pass |
| role | 249 s (+53%) | 52 (+105%) | 1.571M (+93%) | 33.8k (+49%) | pass, after a self-repaired over-reach |
| detailed-book | 162 s (±0) | 36 (+42%) | 1.048M (+29%) | 22.4k (±0) | pass, one false report claim |

Neither variant helped at L2. The detailed book's extra commands became extra steps. DSH ran the suggested `git grep` searches and then still wrote its own resolver scripts, so the book saved no exploration. The role preamble ("check your own work line by line", "never claim a check passed unless…") made DSH more active but not more careful: it ran more checks and wrote a broader script, and that is where the mistake came from. No split, effort or pro run was spent: the level was solved by the plain book in 3 of 3 runs, so those variants had nothing to fix.

## Lessons for writing tasks for DSH

1. **For a fully specified mechanical edit of this size (35 files, about 44 line changes), the plain smoke-shaped book is enough.** Give an exact move table, exact rules about which strings may change, the write scope, the three check commands and the four-section report. Expect about 2.5–3 min and about 0.8M tokens per run (about 25k output), with the same result every time. Do not add role framing or step lists here: they cost more and add room for mistakes.
2. **Scope every style rule to the edits it covers.** Write "spell the specifiers you change exactly as `path.relative` gives them; leave every other specifier as it is". DSH applies a general sentence to everything it can reach.
3. **Give the numbers the book asks it to keep.** Write "the vitest command reports 9 files / 159 tests before and after". If the book only says "the same number", DSH cannot verify the claim within the allowed git commands, and most runs just assert it. The same goes for "5 `"file"` values in the allowlist".
4. **Say where scratch files may go.** DSH likes throwaway scripts for bulk edits: 4 of 5 runs used one, 2 of them in `/tmp`. Either allow one scratch place, such as "you may write helper scripts under /tmp; they are not part of the change", or forbid helper files explicitly. Outside a sandbox, that rule decides whether a run stays in scope.
5. **Check every "nothing found" claim in the report.** The UNSPECIFIED section is valuable, since 4 of 5 runs found the stale comment. But a negative claim can come from a buggy filter in DSH's own search. Have the checker or a cheap `git grep` confirm such claims.
6. **Write follow-ups as a lead's review.** Point to the line or file, ask what to look at ("which file moved?") and say how to report it ("a reasoned claim, not a measurement"). That took 12 s and fixed what it pointed at without touching correct work. Raw check output on passing work only gets "confirmed".
7. **Keep feedback free of verdicts.** The guided review here gave only the book's own check results and the two report lines. It did not say whether the edit was right.
8. **For task D: L2 is not the limit.** The limit, if there is one, is above L2: L3a has 76 files and 3 inline `import()` types, and L3 has 157 files. Use the plain book there first, add the numbers (lesson 3) and the scoped style rule (lesson 2), and keep guided review rounds ready for real failures.

## Kept and deleted

- Kept: copy `~/dsh-work/ladder/L2-base-1` (baseline-1 plus its guided round). It passed, used the fewest total tokens of the baselines and has the corrected report. Its diff is `L2/best.diff` (491 lines; 4 renames and 31 modified files; identical to every other run's diff). Its setup record and private DSH state are kept with it.
- Deleted with `drop_copy`: `L2-base-2`, `L2-base-3`, `L2-role-1`, `L2-detail-1` (copy, record and private DSH state). The run directories stay in `~/dsh-work/ladder/_runs/`, mirrored to `_results/L2work/runs/`.
- Note: `best.diff` sits in a level directory, so the next `_tools/sync.sh` will mirror it to WSL and include it in the golden manifest. That is harmless, because sync rewrites the manifest.
