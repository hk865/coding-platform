# How to write a task for DSH in this repository

These rules come from the ladder of 2026-10-07: 57 runs at 8 levels plus the smoke test. The numbers are in `SCORECARD.md`, and the details in `<level>/RESULTS.md`. Each rule below names its evidence. "flash" means deepseek-flash, the headless profile's default.

Short version:
- Give DSH exact rules, exact numbers and an exact reading list.
- Make it check itself against those numbers before it writes.
- Check its work mechanically on your side.
- When something is wrong, send a pointed review, never the bare check output.

## 1. What to give DSH, and what not

| task kind | measured | use DSH? |
|---|---|---|
| Mechanical edits across many files with exact rules (file moves, renames, specifier rewrites) | L2, L3a, L3: up to 157 files in one run of about 6 min; every file right in every run | **yes**, with the detailed book (§2) |
| Implement one function to a frozen signature and an exact output contract | L4: 5/5 first runs, one edit each | **yes** |
| Implement an owner write when the repository holds the pattern and the spec has implementation notes | L6: 5/5 flash first runs passed | **yes**. Cite the pattern file and the notes, and write every convention as a rule (rule 6) |
| Write tests from a case list, with or without expected values | L5, L5b: identical tests across runs | **yes**. The tests are exactly as good as the case list |
| Look up places in code and docs by identifier, Chinese docs included | LD: 10/10, byte-identical answers | **yes** |
| Decide where something belongs, break a cycle, choose between designs | not measured; the user's view is that DSH is weak here | **no**. The lead or the user decides; DSH then executes the decision |
| Anything that needs the real repository, a commit, a push, real-model product acceptance, or the user | — | **no** |

## 2. The task-book template

This shape passed on the first try at every level. Lines marked "(detailed)" are the additions that paid off. They come from the L3, L4, L5, L5b, L6 and LD detailed books (`_results/<level>work/task-detailed.md`; L3's is the model for task D).

````markdown
# Task: <one line> (<task id>)

You are working in a copy of a TypeScript repository (the current directory). This is a fully specified task.
Follow it exactly. Do not make design decisions: if something is not specified here, do not invent behaviour;
list it in your report instead.

## What to do
<the exact table / frozen signature and interfaces / spec rows quoted verbatim / output contract / case list>

## Rules
<each rule as cases, decided by what a thing IS, not how it is spelled:>
- (a) <condition> → change it, spelled <exact form>.
- (b) <condition> → change it the same way.
- (c) Everything else stays exactly as written, even if <the tempting tidy-up> would spell it differently.
  Example from this copy: <one real file:line that must stay>.
<Same-name traps that must NOT be touched: <list>.>
<Every invariant you expect, as a sentence: "no file outside the list below changes", "every specifier you do not
need to change stays byte-identical", "a record of another workspace is refused with forbidden, '<text>'".>

## Size (exact, measured on this copy)                                   (detailed)
<N changes in M files = n1 in m1 <kind 1> + n2 in m2 <kind 2>; plus K <other kind>.>

## What to read (exactly this; line numbers are those of this copy)       (detailed)
Read these ranges and nothing else. If you need a type that is not listed, find its declaration with grep -n
and read only that.
1. <file> lines <a–b> (<what is there>), with a 1–3 line excerpt of the signature you need.
2. <the pattern file> lines <a–b>: the nearest example of the conventions you must follow.
3. <the spec's implementation notes>, printed by: <exact sed/grep command>.

## Steps                                                                   (detailed)
1. Run <checks> once BEFORE any edit and wait for them. Expected: <exact lines, e.g. "Tests 8 failed | 4278 passed (4286)">.
2. <dry run: print every planned change as `<file>\t<old>\t<new>` into ./<name>.txt; the count must be exactly N in M
   files (n1/m1 + n2/m2). If it differs, fix the script; write nothing until it matches.>
3. <the edit: one write / one edit / apply the listing>.
4. Run <checks> until they pass. If one fails, read its first error (file and line) and fix the cause. Read the exit code
   of the command itself: `cmd 2>&1 | tail -n 40; echo "exit ${PIPESTATUS[0]}"`.
5. Self-check: <git status --short shows exactly: …>; <git diff --numstat: …>; <for each X, name the line that does Y>.
6. Delete every helper or log file you created; `git status --short` then shows <exact lines>.
7. For UNSPECIFIED: <the enumeration method, e.g. "git grep -n every old file name, with or without a line reference,
   and list each hit as file:line">. Every claim that something was not found names the command that found nothing.

## Write scope
- Create / edit exactly: <paths, or "only the text inside specifier strings in .ts files under src/ and tests/">.
- Do not create, edit, rename or delete any other file, also not in git-ignored places. Do not touch package.json,
  lock files, config, vendor/, node_modules/, docs/.
- Scratch files: only <./.dsh-scratch/ inside the current directory>, deleted before you finish; never /tmp.
- Stay inside the current directory: no absolute paths outside it, no `..` above it.
- Do not install packages. Do not commit. Allowed git commands: <list>. Not allowed: git add, rm, checkout, restore,
  stash, reset, commit.

## Checks
Run exactly these and make them pass:
<commands>
Before your change: <exact numbers>. After: <exact numbers>. Do not run other test files or whole directories.

## Report (your final message)
Reply with these four sections and nothing else:
- FILES CHANGED: <exact shape>.
- CHECKS: each command and its result (exit code; for vitest the passed/failed counts).
- UNSPECIFIED: each case this task does not describe that you met (one line each, with file:line), and confirm you
  changed nothing for it. <List every sentence where the quoted spec and the contract disagree.>
- NOTES: at most five lines, only if something blocked you or looked wrong in this task.
````

What each part is for, with the evidence:

| part | why | evidence |
|---|---|---|
| Opening paragraph ("Do not make design decisions … list it") | DSH follows it: no run at any level invented behaviour, and every run listed its choices | smoke; L4, L5b, L6 |
| Exact "what to do" (table, frozen signature, quoted spec, output contract) | this is where flash is reliable | L2–L6: every file and every frozen text right |
| Rules as cases (a)/(b)/(c), with one in-repo example of "stays" | a general sentence is applied to everything it can reach | L3: 3/3 plain baselines tidied 10 unrelated specifiers; the detailed book with the cases never touched them. L2 role run: "as `path.relative` gives it" was applied to every specifier |
| Every expected invariant as a sentence | "follow the code base" loses to a literal spec | L6: 5/5 flash runs left out the workspace refusal and the empty-source refusal, because the spec row did not list them |
| Exact counts by kind | approximate counts become targets and hide small errors | L3: 3/3 accepted 368 as "about 360"; with "exactly 354 in 149 (21/11 + 333/138)" the dry run matched on the first try. L3a: "Good sign that 110 is the right magic number" |
| Reading list by line ranges plus excerpts | tokens grow with steps × context; "everything is in this copy" invites a tour | tokens −69% (L4), −68% (L5), −65% (L5b), −66% (L6), −50% (LD) at equal quality. L6: context at the edit 85k against 146–179k |
| Cite the pattern file and the spec's notes | DSH finds them anyway (4/4 at L6), but citing makes it certain and costs one line | L6 |
| "Run the checks first and expect N" | followed literally, and costs nothing; it gives DSH a true "before" | L4, L3 detailed |
| Dry run whose count must match before writing | DSH's first drafts have bugs (5/5 at L3a, each a different one); the dry run is where it catches them | L3a, L3 detailed |
| "Until it passes" plus the first error's file:line | the book's own check output was enough to fix every mid-run failure | L3a role (3× TS2307), L3a baseline-3 (TS1110) |
| Self-check with the expected `git status` shape | followed literally | L3, L4, LD detailed |
| Named scratch place and "never /tmp" | without it, every move session used `/tmp`. With it, use dropped but did not stop | L2/L3a/L3: 100% of move sessions; L3 detailed: 1 log, which it reported |
| Forbidden git commands by name | "allowed: mv, status, diff, grep" alone did not stop `add`, `rm` or `checkout` | L3: 4 of 8 sessions used one; 0 once they were named. L3 split b2's `git checkout -- src tests` would have wiped batch 1 |
| Exact test command and numbers, "no whole directories" | about half the tokens went to optional test runs | L6: 2.8–3.8M of 5.6–7.1M tokens came after the single edit |
| 4-section report | always delivered on a first run | all levels |
| Enumeration method for UNSPECIFIED | "list what is unspecified" gives a random sample | L5: 6–8 of 15 open points; with a method, 15/15. L3: 14 of 38 stale lines; "name alone with a line reference" found 35 |
| "List every sentence where the spec and the contract disagree" | otherwise NOTES says "no discrepancy" even when its own UNSPECIFIED shows one | L4: 3/5 runs |

## 3. How much priming

- **Start from the smoke-shaped plain book** (the opening paragraph, what to do, write scope, checks, 4-section report). It passed 7 of 8 levels in 3/3 repeats.
- **Add only what the task lacks**:
  - exact numbers when DSH must check itself;
  - case rules when a rule could reach too far;
  - a reading list whenever the task needs fewer than a handful of files;
  - a case list when you want tests;
  - an enumeration method when a list must be complete.
- **Do not add steps that repeat what DSH does anyway.** At L2 the detailed book cost +29% tokens and +42% tool calls for the same diff. At L3a it cost −16% (inside the baseline spread), and DSH still wrote its own resolver scripts. Extra commands in the book become extra steps.
- **No role framing.** It was tried at 7 levels and never improved the work. It was slower at 3 levels (+52%, +84%, +53% wall time) and wrote the weakest tests at L4 (mutant score 0.6). Spend those words on rules, numbers and a reading list.
- **Settle format choices in the book.** Examples: "every value is a JSON string", "one line per item with file:line", "spell the specifiers you change as `path.relative` gives them; leave every other specifier as it is". At LD, 4/5 runs spent thought on string vs number; one line removed the question.
- **Settle one rule where two readings exist, and print the count that matches it.** At L3a and L3, "keep still-resolving specifiers" and the reference's "canonical spelling" both passed, so the runs split 3:2. One rule with its count makes the result independent of the run.

## 4. Which model, which settings

- **deepseek-flash (headless default) for everything.**
- **Not pro.** One L6 run: slower (394 s against a 315 s mean), partial 15/16. It missed the spec row that 4/4 searching flash runs found. The user also expects flash to code better.
- **reasoningEffort and thinking overlays: untested.** No level needed them. Try one only on a task that flash fails after a guided round. To do so, write an overlay in `~/dsh-work/patches/`, check it with `--dump-config`, and pass `--patch` *before* `--json` (§8).
- **Caps: 20 minutes and 10M tokens per run.** No ladder run came close in time (at most 7.8 min, the L3a role run). One came to 71% of the token cap, mostly through optional test runs. A run that hits a cap is stuck, not working.

## 5. Feedback rounds

- **Never send bare check output.** In 8/8 rounds it changed nothing (2–8 s). Usually it answered "Confirmed" and dropped the report format. At L3 it added a false claim. When the checks are green, their output carries no signal. When the error is one the checks cannot see (L3), raw output cannot point at it.
- **Send a lead's review.** It fixed the work, or correctly held correct work, in 9/9 rounds (12–196 s, 0.05–2.5M tokens). It did not provoke "fixes" of correct work (L2, LD). Template:

```markdown
Review of your work by the lead. I re-ran the checks of the task book on a clone of your copy as you left it;
the output is below. <N> points need another look. Do not change any file unless you conclude that the task book
requires a different text there; if you change one, name the rule that requires it.

1. <What, in a few words.> Where: <file:line, file:line> <and/or your report line "…">.
   Line of thought: <how to examine it: "resolve each old specifier and check whether its target is in the move
   table"; "walk your body for <input>: what does it return and write?"; "a fold that ignored X would still pass all
   your cases; which input would make it fail?">. Then reread <the book's sentence, quoted or located>. Decide, and
   name the sentence you rely on. <Account for your count of N with numbers from your own diff.>
2. …

Only <the body / the test file / these files> may change. Rerun only <these checks>.
Reply with the same four sections as before, updated.

<the check output>
```

- **The location must come from your side.** DSH does not find it from green checks. Get it from:
  - `git diff --name-only` against the expected file list;
  - the count against the exact count;
  - your own `git grep`;
  - reading its diff against the contract and the sibling services;
  - for tests, looking for each OR-clause as the only reason, and one case that holds every part of an order.

  The review must be right, because DSH acts on a pointed question (L3a).
- **Give the line of thought and the rule, never the answer, the code, the verdict or hidden test results.** With precedents named by file:line, DSH used the code base's exact texts (L6).
- **Add an accounting question** ("account for your 368"). It made DSH reconcile its own numbers: 368 = 333 + 25 + 10 (L3).
- **Tell it which checks to rerun.** Unasked, it reran whole directories. At L6, 2.1M of the 2.46M tokens came after the fix.
- **Run the visible checks on a quiet machine before feeding them back.** Under load, the vitest command showed 14 failures instead of 8 (sqlite timing, L3). Sent as feedback, that would have sent DSH after a bug that does not exist.
- **One round is normally enough.** The ladder needed one round each time. If a second round still fails, stop and finish by other means.
- **A follow-up goes in the same Session and the same copy** (`--session-id`). To compare two follow-ups on the same state, save the copy and `_runs/_state/<copy>` first, and restore both in between (L4, L5b, L6).

## 6. Splitting

- **Do not split a task that one script can do.** At L3, three batches cost 2.8× the wall time and 3.1× the tokens, plus about 21 minutes of checks between batches. Batch 1 repeated the same rule error, and batch 2 repaired a slip with `git checkout -- src tests`. Smaller batches did not make DSH more careful: each batch pays the start-up reading again and repeats any wrong rule.
- **Size alone is no reason to split.** 157 files in one run cost about the same as 76 (L3a → L3: wall 1.3×, tokens 0.9×).
- **Split by kind, not by size.** For example: stage 1 dry run and stage 2 apply, or stage 1 skeleton and tests and stage 2 implementation (the two-stage rule). If you split anyway, commit after each passing batch on your side, and forbid checkout, restore, stash and reset by name.

## 7. Checking its work mechanically (the lead's side)

DSH's own report is input, not acceptance. Its positive counts were nearly always true. Its negative claims ("none found", "no files created", "no discrepancy") were false in about one run per level.

Always:
1. **Run in a sandboxed copy** (`run-dsh.mjs`), never in the real worktree or in `base`.
2. **`git status --short` shape** equals the expected one (renames, modified, nothing untracked). Check ignored leftovers too (`git status --ignored`).
3. **`git diff --name-only`** equals the expected file list. This is what found the L3 over-reach.
4. **Counts:** specifiers or lines changed equal the exact count. `git diff --numstat` has added = deleted on pure edits.
5. **Frozen and hidden tests:** sha unchanged. Hidden tests live outside the copy and run on a throwaway clone.
6. **Typecheck, architecture check and tests** with the same test ids as the baseline and no newly failing test. Rerun a failing test once alone (flakes under load). Use a quiet machine.
7. **No commit, no tag move** against the setup record (the checkers' `agentGit`).
8. **Outside access:** `scan.json` (tool-call arguments with `/tmp`, `/mnt/`, `~`, `/home/`, `..`). Known false positives: `..` inside module specifiers it typed, `~` inside an awk regex, and an absolute path inside its own copy. Tool results are logged only up to 8,192 characters, so result-based lookups and canary checks are a lower bound.
9. **Report:** compare every CHECKS number with your checker. Check every negative claim with `git grep` or `git diff`. Compare its UNSPECIFIED list with your own enumeration. File:line references were reliable; labels attached to them were not always (LD: 4 wrong section labels out of about 45 checked lines).

Per kind:
- **Moves:** `check-move.mjs` (per-file specifier pairs, renames, canonical spelling, same exported names, `onlySpecifierChanges`). Best of all: the diff is byte-identical to the reference script's.
- **Implementation:** hidden target tests. Own tests must pass on the real code and fail on a stub (`check-hidden.mjs`). Optionally use mutants, or the read-through: each OR-clause as the only reason, each order in one case.
- **Tests:** mutants (`check-mutants.mjs`), or at least "all fail on a stub, all pass on the real code".
- **Lookup:** an answer key (`check-lookup.mjs`).

## 8. Running it (operational notes)

- **One fresh copy per task:** `cp -a` of a base = `git archive` of the HEAD you want, plus `node_modules`, plus `zod` and `openai` in `vendor/coding-agent/node_modules` (without them, typecheck shows 100 TS7006 errors), plus one baseline commit. Never `base` itself, `~/cc-work` or the Windows worktree.
- **Runner:** `node ~/dsh-work/ladder/_common/run-dsh.mjs run <copy> <book> <runName> --level <levelDir> [--session-id <id>]`. Defaults: 20 min, 10M tokens. It writes `run.json`, `events.jsonl`, `final.md`, `scan.json` and `git-status.txt` under `~/dsh-work/ladder/_runs/<runName>/`.
- **Overlay argument order:** `--profile headless --patch <file> --json`. The shared runner puts `--patch` after `--json`, which fails at once with "unknown option '--patch'". A fixed copy is `_results/L6work/run-dsh-fixed.mjs`; fix `_common/run-dsh.mjs` through `sync.sh` before any overlay run. `run-dsh.mjs exec` binds no overlay, so the `--dump-config` check needs the overlay copied into the copy (and deleted afterwards).
- **One DSH at a time.** Start it as a backgrounded tool call. Do not use `nohup … &` inside `wsl.exe`: SIGHUP killed a run at step 1 (L4).
- **Wait loops go in script files.** An inline `pgrep -f "…run-dsh…"` matches its own `bash -lc` line and never ends (L5, L6).
- **Expected cost** of one run, by kind (baseline means; detailed-book figures in brackets):

  | kind | wall time | tokens |
  |---|---|---|
  | lookup | 31 s (21 s) | 0.32M (0.16M) |
  | tests from cases | 35 s (23–28 s) | 0.27–0.28M (0.08–0.10M) |
  | pure function | 3.9 min (3.0 min) | 2.3M (0.7M) |
  | owner write | 5.3 min (4.0 min) | 6.3M (2.1M) |
  | 157-file move | 5.5 min (5.9 min) | 2.2M (1.9M) |
  | guided round | 12 s – 3.3 min | 0.05–2.5M |

  About 85–97% of all tokens are cache reads.

## 9. What never to give it

- **Approximate numbers** ("about 360", "about 80 files"). They become targets (L3, L3a).
- **Unscoped style sentences** ("as `path.relative` gives it", "match the style"). DSH applies them to everything it can reach (L2 role, L3).
- **"Follow the code base's convention" in place of the rule itself** (L6, 5/5).
- **"Everything you need is in this copy" without a reading list.** It invites a tour: 2–3× the tokens (L4, L6).
- **Raw check output as feedback** (8/8 useless), or check output taken under load (14 failures instead of 8).
- **The answer, the code, the verdict or hidden test results in a review.** Give the location and the line of thought.
- **A role preamble** (7 levels, no gain).
- **Design decisions:** where an unplaced file goes, which edge to break, X1-style splits. Decide first, then hand over the decision as a rule.
- **Write access to anything but its copy:** no real worktree, no commit, no push, no `~/.dsh`, no ports 3080, 3099 or 44797.
- **A batch plan where a later batch can undo an earlier one,** unless you commit between batches and forbid checkout, restore, stash and reset by name.
