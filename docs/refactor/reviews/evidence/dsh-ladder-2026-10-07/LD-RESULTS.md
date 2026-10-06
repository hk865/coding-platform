# LD results: DSH looks up ten places in the Chinese docs and the code (2026-10-07)

Level LD tests the strength the user expects of DSH: looking things up. The book asks for ten places in the copy at bfb6075. DSH answers each as `{file, line[, value]}` in `lookup-answers.json`. Four places are in Chinese docs:
- spec §9.3 row VR-07, one of four rows that start with `| VR-07 |`;
- spec §2.3 row GOAL-05, one of two;
- HANDOFF decision 32;
- the RecordStore `id` in `module-target.json`.

Six are in code:
- two constant declarations, with their values;
- two function declarations;
- the `describe` of the test dedicated to `setGoalControlFromHost`, among several Goal-control tests;
- the one call of `finalizeRoundOutcome` in `evidence-service.ts`, not its import.

The checker compares file, line and value exactly. Score = right / 10. The gates: only `lookup-answers.json` is added, and all ten keys are present. Nothing is stripped from the copy; only the key is outside it.

All runs used DSH 0.1.7-rc.2, the headless profile and the default model **deepseek-flash**. They ran through `run-dsh.mjs` in bubblewrap, each first run on a fresh copy made by `LD/setup.sh`, with the default limits (20 min, 10M tokens). The feedback rounds used the same copy and the same Session (`--session-id`). I saved the copy and its private DSH state before the raw round and restored both before the guided round, so each Session saw exactly one follow-up. Run artifacts are in `_results/LDwork/runs/<run>/`: run.json, scan.json, events.jsonl, final.md, git-status.txt, check.json, and the answer file. `_results/LDwork/` also holds the variant books (`task-detailed.md`, `task-role.md`), the two follow-ups (`feedback-raw-base3.md`, `feedback-guided-base3.md`), `runs-summary.txt`, `checks-summary.txt` and the chain scripts.

## Result in one paragraph

LD saturates. All 5 first runs (3 baselines, the detailed book, the role run) scored **10/10** and passed every gate, in **21–47 s** and **0.16–0.37M tokens**. The 5 answer files are **byte-identical** (md5 `ace151c8…`). Every trap was handled in every run:
- the four VR-07 rows and the two GOAL-05 rows: each run confirmed the section heading above its line;
- import against call (Q9) and comment against declaration (Q2, Q5, Q10);
- the Chinese decision list (Q4);
- the one judgement question, the "dedicated" test file (Q8): 5/5 chose it and named their reading in UNSPECIFIED.

No run left the copy, used `/tmp`, ran a git command that writes, or made a false claim in its report.

The detailed book (search commands, read-by-range rules, a read-back step, the expected `git status`) halved the cost at the same result: 160k tokens, 15 tool calls and 21 s, against a baseline mean of 318k, 25.7 and 31 s. The role preamble made the run slower and wordier (47 s, +53% output) and changed nothing else.

On passing work, the raw check output got "Confirmed" in 4 s, as at every level, and the four-section report was dropped. A guided review asked pointed questions about two correct answers ("the row ids repeat", "dedicated") and asked for a list of near misses. DSH checked, **kept all ten answers** ("No answer is wrong, so no field changed"), and listed about 70 near misses. Every line number I checked was right, but 4 section labels were wrong.

## Runs

| run | book / follow-up | wall | tool calls (by tool) | steps | fresh input | cache read | output | total | verdict | score | scope | outside the copy | report |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 (`LD-base-1`) | `LD/task.md` | 29 s | 25 (bash 9, read 8, grep 7, write 1) | 7 | 35,328 | 179,328 | 5,879 | 220,535 | **pass** | 1 (10/10) | only `?? lookup-answers.json` | none | 4/4 sections, CHECKS true; UNSPECIFIED 3 lines (Q4/Q5 value as text, Q8 reading), all true |
| baseline-2 (`LD-base-2`) | `LD/task.md` | 41 s | 30 (grep 12, read 11, bash 4, todo_write 2, write 1) | 11 | 38,404 | 315,648 | 7,697 | 361,749 | **pass** | 1 (10/10) | same | none | 4/4, true; UNSPECIFIED 2 lines; it names three Q8 candidates (service, route and state-machine test) |
| baseline-3 (`LD-base-3`) | `LD/task.md` | 22 s | 22 (read 9, bash 6, grep 6, write 1) | 7 | 64,741 | 303,104 | 4,217 | 372,062 | **pass** | 1 (10/10) | same | none | 4/4, true; UNSPECIFIED 2 lines (Q4/Q5/Q6 as strings; Q8 against `goal-machine.test.ts:578`) |
| raw-feedback (`LD-base-3-raw`) | `visible-check.mjs` output on baseline-3, same Session | 4 s | 0 | 1 | 259 | 68,608 | 227 | 69,094 | pass (answers byte-identical) | 1 | unchanged | none | **no sections**: one sentence, "Confirmed — … The task is complete" |
| guided-feedback (`LD-base-3-guided`) | the lead's review on baseline-3, same Session, from the state saved before the raw round | 47 s | 8 (bash 8) | 3 | 18,951 | 232,704 | 12,046 | 263,701 | **pass** (re-checked; answers byte-identical) | 1 | unchanged | none | 4/4 + NEAR MISSES (7,488 chars, about 70 `file:line` items); every checked line number true; 4 wrong labels (see below) |
| detailed-book (`LD-detail-1`) | `task-detailed.md` | **21 s** | **15** (bash 14, write 1) | 7 | 23,757 | 132,096 | 4,202 | **160,055** | **pass** | 1 (10/10) | same | none ¹ | 4/4, true, and a read-back line for each answer (the line text and the heading above Q1/Q7) and the `git status` output; UNSPECIFIED 2 lines, true |
| role (`LD-role-1`) | `task-role.md` = `LD/task.md` + the one-sentence role preamble used at L6 | 47 s | 27 (grep 9, bash 9, read 7, todo_write 1, write 1) | 12 | 40,363 | 324,224 | 9,061 | 373,648 | **pass** | 1 (10/10) | same | none | 4/4, true; UNSPECIFIED 2 lines (value type; Q8 against `A2-control-service.test.ts`), true |

- Every run ended with exit 0, an empty stderr and no stop. The longest took 47 s of the 20 minutes; the largest used 0.37M of the 10M tokens.
- Each check took about 1–2 s and found nothing out of scope, no commit and no tag move.
- There was no canary hit, so no run is contaminated.
- `scan.json` shows `contamination: none` and 0 path hits in every run. This is the first level with no `attempted-outside` false positive: no run typed an import specifier.
- No run used `/tmp` (0/7 sessions). No run ran a git command other than `git status` / `git grep`.
- `scan.json.lookups`: every first run read all five tracked answer places (the Q1, Q4, Q6, Q7 and Q9 rows).
- The seven sessions used 1.82M tokens and 211 s of DSH time in total.

¹ The detailed run wrote the answer file by its absolute path inside the copy (`/home/han001/dsh-work/ladder/LD-detail-1/lookup-answers.json`). That is inside the copy and harmless.

## Spread across the three baselines

- **Outcome: none.** All three scored 10/10 and passed every gate. The three answer files, and the two variant files, are byte-identical. Each copies the one-line-per-key layout of the book's example.
- **Method: the same in all three.** Each run did the following:
  1. One or two orientation listings (`ls`).
  2. A first fan of 7–10 parallel searches, one per identifier or row id. In baseline-1, steps 2–3 issued 8 grep calls at once.
  3. A second fan for the ambiguous ones: the section headings of the spec, every `setGoalControl` in `tests/`, and the numbered items of HANDOFF.
  4. A read-back of each answer line with a narrow range (`read` with offset and limit 1–18, or `sed -n`).
  5. One write, and the JSON check.

  All three checked the section heading above the VR-07 and GOAL-05 rows before writing. Baseline-1 wrote "There might be multiple VR-07 rows … Section 9.3 spans lines 2970-3072. VR-07 row at line 2981. Good." Baseline-2 placed the other rows itself: "Line 3648 is another VR-07 row (maybe section 11). Line 5024 is mapping."
- **Process: moderate spread.**
  - Wall time 22–41 s (mean 31 s, ±31%).
  - Tool calls 22–30, in 7–11 steps.
  - Total tokens 0.22–0.37M (mean 318k, ±24%), of which 81–87% cache reads.
  - Output 4.2–7.7k tokens; thinking 7.8–17.7k characters.

  Baseline-2 was the most expensive: it kept a `todo_write` list and read all of `module-target.json`. Baseline-3 had the highest fresh input (65k), because it read 12–18-line windows around both spec rows.
- **Report: small spread, all true.** Every run named the Q8 reading. Each named different rejected candidates: baseline-1 the state-machine test; baseline-2 the route test and the state-machine test; baseline-3 `goal-machine.test.ts:578`. Each named the value-as-text choice. Every claim checks out:
  - baseline-1: "no test imports `setGoalControlFromHost` by name" is true (`git grep` in `tests/` is empty);
  - every CHECKS line is the real output.

## What DSH did well

- **Doc lookup in Chinese and in code is a strength**, as the user expected: 5/5 × 10/10. Chinese headings and rows (`### 9.3 迁移表`, `32. **任务 D 交给本地 DSH 执行，先测它的上限…**`) caused no trouble. The runs grep the row id or the identifier, then the headings, then read back.
- **It verifies before it writes, unasked.** Every first run read each answer line back before the single write. Every run confirmed the section of the two repeated row ids. No run trusted a single grep hit.
- **It parallelises lookups.** It ran 3–4 tool calls per step on average, which is why ten lookups took about half a minute.
- **The one judgement question (Q8) was answered the same way 5/5, and flagged 5/5.** All runs read the header comment of the candidate test files. They rejected the state-machine guard test (`tests/state/goal-machine.test.ts:578`, which also has a `describe('… setGoalControl …')`), and stated the reading in UNSPECIFIED.
- **It holds a correct answer under a pointed question.** The guided review said "the row ids repeat" and asked whether Q8's file was really the dedicated one. DSH re-checked: "the review may be probing whether there's an issue: Q1's line 2981 is the VR-07 row in §9.3's transition table — correct". It changed nothing, and its report says why.

## Where it went wrong (small things only)

- **Format deliberation instead of a question.** The book types `value` as `"<text>"` and asks for a number (Q4, Q5). 4/5 runs spent thought on it and listed it in UNSPECIFIED. The role run went back and forth: "I'll go with number for Q5 … Actually, let me reconsider … I lean towards using strings for all values". The detailed book said "write every `value` as a JSON string", and that run did not raise it. (The checker compares `String(value)`, so either choice would have passed.)
- **Wrong labels on right line numbers (guided round).** The NEAR MISSES list has about 70 items. I checked about 45 cited lines, and all were right. The section names attached to 4 of them were wrong:
  - "`STATE-MACHINES-SPEC.md:3240` — a `VR-07` row in the §15 implementation/owner mapping table": it is §9.6 实现对照.
  - "`:3648` — … in the §… 'old vs target' comparison table": §11.7, label left blank.
  - "`:419` — a `GOAL-05` row in the §2.4 refusal table": a §2.4 row whose text cites GOAL-05, not a GOAL-05 row.
  - "`HANDOFF.md:3` — the section heading above both decision blocks": it heads decisions 20–32 only; 1–19 sit under line 98.

  It also left out two comment mentions of `reworkActorClassOf` (`src/contracts/dispatch.ts:187`, `src/contracts/verification.ts:178`). Trust its `file:line`; check any category it attaches.
- **Raw feedback dropped the report format.** It gave one sentence instead of the four sections ("Confirmed — `lookup-answers.json` is valid JSON with all ten keys … The task is complete").

## Raw versus guided feedback (same saved state, baseline-3)

There was no failure to feed back, so both rounds were given the same passing state.

| | raw | guided |
|---|---|---|
| follow-up | the book's JSON check output only | the same output + the lead's review: Q1/Q7 "the row ids repeat" (where: your Q1/Q7 entries; line of thought: name the nearest heading and say why the line is in the named section's table); Q8 "dedicated" (where: your Q8 entry and UNSPECIFIED line; which test is about the service itself, what shows it); "account for the near misses, one line each as file:line"; scope fence "change only if this review shows an answer is wrong, name the book's sentence" |
| time, tool calls | 4 s, 0 | 47 s, 8 bash calls |
| tokens (total / output) | 69k / 227 | 264k / 12,046 |
| answers | unchanged | unchanged (it held 10/10) |
| report | one sentence, no sections | 4 sections + NEAR MISSES: section spans for Q1/Q7 (2970–3072, 350–408), the Q8 reasoning (the route test "contains no `describe(` block at all", which is true), about 70 near misses; line numbers right, 4 labels wrong |

The raw round changes nothing and adds nothing, as at every level (now 8 levels). The guided round is safe on correct work: a pointed question plus a scope fence did not make DSH "fix" a right answer. Its enumeration was close to complete when the method was named ("an import, a re-export, a comment, a second table row, another `describe`, a derived constant").

## Detailed book and role framing

- **Detailed book** (`task-detailed.md`). It keeps every requirement and gives no answer. It adds:
  - one search command per question; for Q8, the rule "the dedicated file is the one whose header says it tests the service itself";
  - read rules: grep, then at most 40 lines; never read a whole file; the spec has about 5,500 lines;
  - "write every value as a JSON string", and one write, no scratch files;
  - a read-back step "repeat until all ten match", with the heading above Q1/Q7;
  - the expected `git status`;
  - the forbidden git commands by name.

  Result: 10/10, **−50% tokens, −32% wall time, −42% tool calls**, and the cheapest context (132k cache reads against 179–316k). It followed the steps literally. It ran the given commands in 7 steps, wrote once, then printed all ten lines in one `sed` and the heading lines. It reported the read-back table in CHECKS without being asked. This is the fifth level (L4, L5, L5b, L6, LD) where a search-and-read list was the cost lever at equal quality.
- **Role** (`task-role.md`, the one-sentence L6 preamble). Result: 10/10, +53% wall time, +17% tokens, +53% output, and the most thinking of any first run (24.5k characters, against 7.8–17.7k), much of it on the string/number question. It made no difference to the answers or the report. Role framing has not improved the work at any level (L2, L3a, L4, L5, L5b, L6, LD).

Not run:
- raw/guided on a real failure: there was none;
- split: ten independent lookups in one 30-second run; nothing to split;
- effort and pro: the level is solved, and the user expects pro not to help.

## Lessons for writing tasks for DSH

1. **Use DSH for lookups freely; it is reliable there.** Ten exact places, four of them in Chinese docs with repeated ids, came back 5/5 × 10/10 in under a minute and about 0.3M tokens, the same answer file every time. The upper limit of lookup by identifier is not reached at this size. Lookup by meaning, with no identifier given, was not tested.
2. **Ask for `file:line` and check it mechanically.** DSH's line numbers were right in every answer and in about 45 near-miss lines checked. Its categories ("§15 table", "a GOAL-05 row") were wrong 4 times in about 70. In task D, ask for each comment, title or specifier that names a moved file as `file:line`, and compare against `git grep` on the lead's side.
3. **Settle format choices in the book.** One line ("every value as a JSON string") removed a deliberation that 4/5 runs otherwise spent thought on and reported. For task D: the spelling of specifiers, what counts as a path string, and how to list comments.
4. **Give the search commands and a read-by-range rule.** That halves the cost. Name the expected `git status` output and the forbidden git commands. The detailed run did exactly that, and reported the read-back without being asked.
5. **Name the enumeration method when completeness matters.** "An import, a re-export, a comment, a second table row, another `describe`, a derived constant" produced a near-complete list. "List what is unspecified" alone produces a sample (L5, L5b).
6. **A guided review is safe on correct work, and raw output is useless on it.** A pointed question with a scope fence ("change only if this review shows an answer is wrong; name the sentence") made DSH re-verify and keep right answers. Raw check output only gets "Confirmed".
7. **Drop role framing.** It was slower and wordier again, with no gain (7 levels).
8. **Scope discipline follows the task shape.** With no bulk edit to script, there was no `/tmp`, no outside path and no scanner false positive. The `/tmp` use at L2/L3a/L3 came from self-written edit scripts. For task D, keep the sandbox or name a scratch place.

## Files and clean-up

- `LD/best.diff`: the detailed-book run's diff (`git diff --no-index /dev/null lookup-answers.json`, 18 lines, sha256 `1f06a4d7…`). The answer file is byte-identical to every other run's.
- Run artifacts: `_results/LDwork/runs/` (7 run directories), with `runs-summary.txt` and `checks-summary.txt`.
- Copies dropped: `LD-base-1`, `LD-base-2`, `LD-base-3`, `LD-role-1` (copy, record, private state), and the saved baseline-3 state. Kept: `~/dsh-work/ladder/LD-detail-1`. The run directories under `_runs` are kept.
