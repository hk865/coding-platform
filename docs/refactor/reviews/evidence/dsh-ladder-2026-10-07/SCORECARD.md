# DSH ladder scorecard (2026-10-07)

**What was measured.** How far the local DSH gets on this repository, and which task-book form works best. This was done before task D (the WorkGraph file move) is handed to DSH (HANDOFF decision 32).

**Setup.**
- DSH 0.1.7-rc.2, headless profile. The model is the default deepseek-flash, except one deepseek-v4-pro run.
- Every ladder run went through the bubblewrap runner (`~/dsh-work/ladder/_common/run-dsh.mjs`), on a fresh WSL copy of bfb6075. Caps: 20 min and 10M tokens. One run at a time. Checks ran on a throwaway clone, never in the copy.
- The smoke test (L1) ran earlier: on a copy of 9ef4d8d, without the sandbox.

**Sources.** Details per level are in `<level>/RESULTS.md`; each level's best result is in `<level>/best.diff`. Run artifacts are in `_results/<level>work/runs/`. The means and spreads below come from `_tools/scorecard-stats.mjs`.

**Terms.**
- *pass*: score 1 and every gate. *partial*: some score, or score 1 with a failed gate.
- *baseline*: the plain book, run 3 times on independent copies.
- *first run*: any run that is not a feedback round.
- *Tokens*: fresh input / cache read / output / total, from DSH's own usage events.
- *Wall*: DSH time only; checks are not included.
- *±*: half the range divided by the mean.

## Headline

- **57 recorded runs (60 DSH sessions), 146 minutes of DSH time and 84.9M tokens in all.** No run hit a cap. The longest took 7.8 min (L3a role, 467 s). The largest used 7.1M tokens (L6 baseline-3, 71% of the cap). Cache reads were 84–97% of all tokens.
- **Baselines: 21/24 pass.** The 3 others are all L3. Each got every one of the 157 files right, but all 3 failed one scope gate in the same way.
- **First runs: 36/41 passed with no feedback (37/42 with the smoke test).** The only score below 1 in the whole ladder is the single pro run (L6, 15/16). Every other non-pass is the L3 scope gate.
- **Every level was passed on the first try by its best book form.** The ladder did not find an upper limit by size or by difficulty. It found a limit in *how the book states its rules* (see the last section).
- **Feedback.** The raw check output alone changed nothing in 8/8 rounds. A guided review fixed the work, or correctly kept correct work, in 9/9 rounds.
- **Role framing** was tried at 7 levels and was never better.
- **The detailed book** (a reading list by line ranges, steps, exact numbers) cut tokens by 50–69% at L4, L5, L5b, L6 and LD at equal quality. At L3 it turned 0/3 into a pass.
- **Splitting** (L3 only) cost about 3× as much and repeated the same error. **pro** (one run): slower and partial.

## Levels at a glance

| level | task kind | size | baselines pass | best form (first try) | best-form cost | baseline mean wall / tokens |
|---|---|---|---|---|---|---|
| L1 smoke | new file from an exact spec, frozen test | 1 file, 11 tests | 1/1 (single run) | plain book | 16 s / 71k | — |
| L2 | pure move | 4 moves; 35 files; 39 specifiers + 5 path strings | 3/3 | plain book | 163 s / 0.81M | 163 s / 0.81M |
| L3a | pure move | 8 moves; 76 files; 114 + 7 | 3/3 | plain book | 254 s / 2.37M | 254 s / 2.37M |
| L3 | pure move = whole task D at bfb6075 | 17 moves; 157 files; 358 + 15 | **0/3** (partial: 157/157 files, one scope gate) | detailed book | 352 s / 1.88M | 329 s / 2.16M |
| L4 | implement a 79-line pure fold to a frozen interface and output contract, plus own tests | 1 function + 1 test file | 3/3 | detailed book | 182 s / 0.71M | 232 s / 2.34M |
| L5 | write 14 tests from a case list with every expected value | 1 test file | 3/3 | detailed book | 23 s / 84k | 35 s / 0.27M |
| L5b | the same 14 tests from situations only (values derived from the code) | 1 test file | 3/3 | detailed book | 28 s / 98k | 36 s / 0.28M |
| L6 | implement a 94-line owner-service write from spec §2 plus the repository, no case list | 1 function | 3/3 | detailed book | 240 s / 2.14M | 315 s / 6.29M |
| LD | doc and code lookup: 10 places, 4 of them in Chinese docs | 10 answers | 3/3 | detailed book | 21 s / 160k | 31 s / 0.32M |

## Per-level tables

All runs use deepseek-flash unless the model column says otherwise. Feedback rounds ran in the same copy and Session as the run named in brackets.

### L1 smoke: `formatDuration` from an exact spec (2026-10-06)

| variant | model | verdict | score | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|
| smoke | flash | pass | 1 (11/11 frozen tests) | 16 s | 7 (6 steps) | ~11.2k | ~57.9k | ~1.7k | ~70.8k | Only the allowed file was created, and the frozen test's sha was unchanged. The report had 4/4 sections. UNSPECIFIED: negative, NaN, Infinity and non-number inputs, with no behaviour added. Its only git command was `git status`. |

### L2: move 4 files (35 files to change)

| variant | model | verdict | score | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | flash | pass | 1 (35/35) | 167 s | 29 | 32,366 | 749,312 | 26,095 | 807,773 | bash sed loop; found a stale comment; one wrong rule attribution in the report |
| baseline-2 | flash | pass | 1 (35/35) | 169 s | 26 | 42,141 | 743,552 | 23,046 | 808,739 | Node script, written in `/tmp` (not reported); diff byte-identical to baseline-1 |
| baseline-3 | flash | pass | 1 (35/35) | 154 s | 21 | 67,761 | 736,640 | 19,039 | 823,440 | Python edit dict; same diff again |
| role | flash | pass | 1 (35/35) | 249 s | 52 | 53,600 | 1,483,520 | 33,836 | 1,570,956 | mid-run rewrite of 3 unrelated files, which it restored itself; a "before" test run overlapped its own edits |
| detailed-book | flash | pass | 1 (35/35) | 162 s | 36 | 54,592 | 971,264 | 22,416 | 1,048,272 | still wrote its own resolver scripts; one FALSE "no comment names an old path" |
| raw feedback (b2) | flash | pass | unchanged | 3 s | 0 | 1,480 | 64,128 | 180 | 65,788 | "Confirmed …"; dropped the report format |
| guided feedback (b1) | flash | pass | 1 | 12 s | 2 | 1,541 | 114,816 | 2,811 | 119,168 | fixed both report lines it was pointed to; no file changed |

### L3a: move 8 files (76 files to change)

| variant | model | verdict | score | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | flash | pass | 1 (76/76, 76 exact) | 220 s | 42 | 53,640 | 1,661,184 | 32,847 | 1,747,671 | its first dry run over-reached (124 edits); caught before applying |
| baseline-2 | flash | pass | 1 (76/76, 76 exact) | 295 s | 58 | 44,933 | 2,489,088 | 40,279 | 2,574,300 | a quoting slip, caught by its own grep |
| baseline-3 | flash | pass | 1 (76/76, 74 exact, book-literal) | 248 s | 60 | 78,167 | 2,685,312 | 34,119 | 2,797,598 | a quote-stripping bug broke every edited file; reverted with `git checkout` (not allowed) and redone |
| detailed-book | flash | pass | 1 (76/76, 76 exact) | 283 s | 50 | 49,081 | 1,901,568 | 38,524 | 1,989,173 | trusted the approximate hint for a while; broke "stays exactly as it is" and "never /tmp" |
| role | flash | pass | 1 (76/76, 74 exact) | 467 s | 62 | 45,207 | 2,732,416 | 59,337 | 2,836,960 | missed `import()` types (3× TS2307), repaired; the only run that reported the rule-2 lines |
| raw feedback (b2) | flash | pass | unchanged | 8 s | 0 | 1,055 | 80,640 | 1,226 | 82,921 | four sections, "no discrepancy"; the unreported edits stayed unreported |
| guided feedback (b1) | flash | pass | 1 (74 exact, book-literal) | 131 s | 11 | 7,642 | 861,824 | 15,405 | 884,871 | restored the 3 specifiers, citing rule 2; found 9 comment lines no run had listed |

### L3: move 17 files = the whole task D at bfb6075 (157 files to change)

| variant | model | verdict | score | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | flash | **partial** | 1 (157/157) | 288 s | 51 | 47,887 | 1,914,752 | 39,215 | 2,001,854 | 10 extra specifiers in 3 unrelated files (gate `onlySpecifierChanges`); "Task said ~360 … Close." |
| baseline-2 | flash | **partial** | 1 (157/157) | 342 s | 42 | 38,990 | 1,397,760 | 31,726 | 1,468,476 | same 10; ran `git add -A` and `git rm -f`; wrong path-string counts in its report |
| baseline-3 | flash | **partial** | 1 (157/157) | 356 s | 76 | 45,461 | 2,912,256 | 44,802 | 3,002,519 | same 10; diff byte-identical to the other two baselines |
| detailed-book | flash | **pass** | 1 (157/157, 153 exact, book-literal) | 352 s | 59 | 51,736 | 1,786,368 | 38,569 | 1,876,673 | "Dry run matched exactly: 354 … in 149 files"; used no forbidden git command; listed 35/38 stale lines |
| split (b1 + b1 guided + b2 + b3, 4 sessions) | flash | pass at the end | 1 (157/157, book-literal) | 909 s | 147 | 177,325 | 6,390,912 | 109,664 | 6,677,901 | b1 had the same over-reach and needed a guided round; b2 used `git checkout -- src tests`; plus about 21 min of checks between batches |
| raw feedback (b2) | flash | partial | unchanged | 5 s | 0 | 1,046 | 68,096 | 480 | 69,622 | "Confirmed …", plus a FALSE claim that only allowed strings changed |
| guided feedback (b1) | flash | **pass** | 1 (157/157, reference-identical) | 196 s | 17 | 24,611 | 1,762,304 | 26,281 | 1,813,196 | reverted exactly the 10, named the rule, accounted 368 = 333 + 25 + 10; +21 stale lines |

### L4: implement a pure fold to a frozen interface, plus own tests

| variant | model | verdict | score | own tests (cases; mutant score) | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | flash | pass | 1 (15/15) | 10; 1.0 | 207 s | 34 | 69,860 | 1,698,816 | 33,182 | 1,801,858 | body in one edit, green at once; "no discrepancies" in NOTES (misses the spec/contract tension) |
| baseline-2 | flash | pass | 1 (15/15) | 13; 1.0 | 270 s | 39 | 59,821 | 2,078,720 | 42,141 | 2,180,682 | checked its tests on the stub unprompted; named the tension; unreported `/tmp` backup |
| baseline-3 | flash | pass | 1 (15/15) | 15; 0.8 | 218 s | 40 | 97,363 | 2,894,336 | 35,580 | 3,027,279 | read the most (15 ranges); never tested a gap as the only reason (VD-4) |
| role | flash | pass | 1 (15/15) | 11; 0.6 | 183 s | 36 | 43,918 | 1,481,344 | 38,256 | 1,563,518 | the cheapest plain-book run, but the weakest tests |
| detailed-book | flash | pass | 1 (15/15) | 14; 1.0 | 182 s | 33 | 26,873 | 661,248 | 25,047 | 713,168 | read only the listed ranges; did the stub check without scratch files |
| raw feedback (b3) | flash | pass | unchanged | 15; 0.8 | 4 s | 0 | 1,285 | 130,688 | 182 | 132,155 | "Confirmed …" |
| guided feedback (b3) | flash | pass | 1 | 17; **1.0** | 46 s | 8 | 3,740 | 948,736 | 4,806 | 957,282 | +2 cases; touched only its test file |

### L5: 14 tests from a case list with every expected value

| variant | model | verdict | score | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | flash | pass | 1 (8/8 mutants) | 32 s | 11 | 31,092 | 206,208 | 6,255 | 243,555 | one write; green on the first vitest run |
| baseline-2 | flash | pass | 1 (8/8) | 32 s | 11 | 30,918 | 194,048 | 6,714 | 231,680 | same test bodies |
| baseline-3 | flash | pass | 1 (8/8) | 40 s | 12 | 32,107 | 281,088 | 7,780 | 320,975 | same test bodies; 6 UNSPECIFIED lines |
| role | flash | pass | 1 (8/8) | 39 s | 11 | 31,100 | 240,896 | 7,930 | 279,926 | same test bodies |
| detailed-book | flash | pass | 1 (8/8) | 23 s | 5 | 14,697 | 65,024 | 4,690 | 84,411 | read exactly the 2 listed ranges |
| raw feedback (b3) | flash | pass | unchanged | 3 s | 0 | 183 | 39,424 | 158 | 39,765 | "Confirmed …" |
| guided feedback (b3) | flash | pass | 1 | 70 s | 0 | 333 | 39,552 | 15,465 | 55,350 | UNSPECIFIED went from 6 to 17 true lines (15/15 items), with correct line numbers |

### L5b: the same 14 tests from situations only

| variant | model | verdict | score | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | flash | pass | 1 (8/8) | 32 s | 11 | 30,884 | 210,688 | 7,076 | 248,648 | traced all 14 cases by hand, then one write |
| baseline-2 | flash | pass | 1 (8/8) | 40 s | 13 | 33,772 | 280,448 | 8,194 | 322,414 | shortest UNSPECIFIED list (5 items) |
| baseline-3 | flash | pass | 1 (8/8) | 36 s | 10 | 31,196 | 242,176 | 7,799 | 281,171 | one wrong example in UNSPECIFIED |
| detailed-book | flash | pass | 1 (8/8) | 28 s | 7 | 15,415 | 76,032 | 6,872 | 98,319 | ignored "one line each" (wrote a paragraph) |
| role | flash | pass | 1 (8/8) | 42 s | 11 | 31,757 | 250,880 | 8,691 | 291,328 | same tests; report at the top of the spread |
| raw feedback (b2) | flash | pass | unchanged | 4 s | 0 | 184 | 41,216 | 373 | 41,773 | repeated its report word for word |
| guided feedback (b2) | flash | pass | 1 | 34 s | 0 | 334 | 41,344 | 7,643 | 49,321 | 5 → 10 true items (not complete; it dropped one of its own) |

All 5 L5b first runs wrote the same 14 test bodies as each other and as the L5 runs (one normalised hash).

### L6: implement an owner-service write from the spec plus the repository

| variant | model | verdict | score | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | flash | pass | 1 (16/16) | 290 s | 64 | 140,171 | 5,410,944 | 46,617 | 5,597,732 | one edit, green at once; no workspace check (named in UNSPECIFIED) |
| baseline-2 | flash | pass | 1 (16/16) | 327 s | 61 | 132,302 | 5,950,464 | 51,689 | 6,134,455 | quoted spec row 5.5 verbatim in its thinking; no workspace check (named) |
| baseline-3 | flash | pass | 1 (16/16) | 329 s | 68 | 147,884 | 6,925,952 | 65,675 | 7,139,511 | 4 esbuild probes; "no files created" is false for `/tmp` |
| detailed-book | flash | pass | 1 (16/16) | 240 s | 65 | 65,265 | 2,026,240 | 44,107 | 2,135,612 | context at the edit 85k against 146–179k; missed the workspace gap and did NOT name it |
| role | flash | pass | 1 (16/16) | 290 s | 55 | 149,148 | 5,032,960 | 39,615 | 5,221,723 | same skeleton and the same choices |
| **pro** | **deepseek-v4-pro** | **partial** | 0.938 (15/16) | 394 s | 59 | 153,104 | 5,991,680 | 46,890 | 6,191,674 | never found spec row 5.5; wrong stale `current`; the only run with the workspace check |
| raw feedback (b2) | flash | pass | unchanged | 2 s | 0 | 280 | 180,352 | 235 | 180,867 | "… The implementation is complete" |
| guided feedback (b2) | flash | pass | 1 | 89 s | 13 | 6,494 | 2,445,696 | 7,984 | 2,460,174 | added both refusals with the code base's exact texts |

### LD: lookup of 10 places (docs and code)

| variant | model | verdict | score | wall | tool calls | fresh | cache | out | total | note |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline-1 | flash | pass | 1 (10/10) | 29 s | 25 | 35,328 | 179,328 | 5,879 | 220,535 | 8 parallel searches, a read-back of each answer, one write |
| baseline-2 | flash | pass | 1 (10/10) | 41 s | 30 | 38,404 | 315,648 | 7,697 | 361,749 | kept a todo list |
| baseline-3 | flash | pass | 1 (10/10) | 22 s | 22 | 64,741 | 303,104 | 4,217 | 372,062 | fastest |
| detailed-book | flash | pass | 1 (10/10) | 21 s | 15 | 23,757 | 132,096 | 4,202 | 160,055 | search commands given; read-back table in CHECKS |
| role | flash | pass | 1 (10/10) | 47 s | 27 | 40,363 | 324,224 | 9,061 | 373,648 | most thinking (string vs number) |
| raw feedback (b3) | flash | pass | unchanged | 4 s | 0 | 259 | 68,608 | 227 | 69,094 | "Confirmed …"; format dropped |
| guided feedback (b3) | flash | pass | 1 (held) | 47 s | 8 | 18,951 | 232,704 | 12,046 | 263,701 | kept all 10 correct answers; listed ~70 near misses (line numbers right, 4 labels wrong) |

The 5 LD answer files are byte-identical.

## Spread across the three baselines

| level | pass | spread in outcome | wall mean (range, ±) | tool calls | tokens mean (range, ±) | cache share | where the spread was |
|---|---|---|---|---|---|---|---|
| L2 | 3/3 | none: byte-identical diffs | 163 s (154–169, ±5%) | 21–29 | 0.81M (0.81–0.82, ±1%) | 91% | edit method (sed loop / Node / Python) |
| L3a | 3/3 | 2 identical to the reference, 1 book-literal (3 lines); both are correct | 254 s (220–295, ±15%) | 42–60 | 2.37M (1.75–2.80, ±22%) | 96% | every first draft had a bug, a different one each time; DSH caught them all |
| L3 | 0/3 | none: byte-identical diffs with the same systematic error | 329 s (288–356, ±10%) | 42–76 | 2.16M (1.47–3.00, ±36%) | 96% | process only |
| L4 | 3/3 | same behaviour, three different code structures | 232 s (207–270, ±14%) | 34–40 | 2.34M (1.80–3.03, ±26%) | 95% | own tests (mutant score 1 / 1 / 0.8); 2 of 3 named the spec tension |
| L5 | 3/3 | none: the same 14 test bodies | 35 s (32–40, ±12%) | 11–12 | 0.27M (0.23–0.32, ±17%) | 86% | which 6–8 of the 15 open points UNSPECIFIED named |
| L5b | 3/3 | none: the same test bodies (also the same as L5) | 36 s (32–40, ±11%) | 10–13 | 0.28M (0.25–0.32, ±13%) | 86% | UNSPECIFIED: 7 / 5 / 9 of 15 |
| L6 | 3/3 | none: same skeleton and the same judgement call (no workspace check) | 315 s (290–329, ±6%) | 61–68 | 6.29M (5.60–7.14, ±12%) | 97% | small code details; about half the tokens went to optional test runs after the edit |
| LD | 3/3 | none: byte-identical answers | 31 s (22–41, ±31%) | 22–30 | 0.32M (0.22–0.37, ±24%) | 84% | which rejected candidates each run named |

**Consistency in plain words.** The outcome never varied between repeats, at any level. The user's concern that flash is "good one time, bad the next" did not show in results. It showed in three other places:
- the first drafts of its bulk-edit scripts (L3a: 5/5 had a bug, each one caught by DSH itself);
- which extra test cases it chose (L4);
- which open points its report listed (L5, L5b).

When a run was wrong (L3), all three repeats were wrong in the same way. Repeating a run does not catch a systematic error. A better book does.

## Feedback rounds: raw vs guided

*Raw* = the output of the book's own checks, unchanged. *Guided* = the same output plus a lead's review. The review gives a location, a line of thought, the rule to reread and a scope fence. It never gives the answer, the verdict or hidden results.

| level | what was fed back | raw: time, tokens → effect | guided: time, tool calls, tokens → effect |
|---|---|---|---|
| L2 | no failure; 2 report lines | 3 s, 66k → "Confirmed", format dropped | 12 s, 2, 119k → both lines fixed, tree unchanged |
| L3a | no failure; 3 unreported rule-2 edits | 8 s, 83k → "no discrepancy" | 131 s, 11, 0.88M → restored the 3 citing rule 2; +9 comment lines |
| **L3** | **a real failure (same tree for both)** | 5 s, 70k → "Confirmed" + a false claim; still partial | 196 s, 17, 1.81M → reverted exactly the 10; **pass** (split b1: 155 s, 1.57M, pass) |
| L4 | weak own tests (mutant 0.8) | 4 s, 132k → "Confirmed" | 46 s, 8, 0.96M → +2 cases, mutant 1.0 |
| L5 | short UNSPECIFIED list | 3 s, 40k → "Confirmed" | 70 s, 0, 55k → 6 → 17 true lines (complete) |
| L5b | short UNSPECIFIED list | 4 s, 42k → report repeated | 34 s, 0, 49k → 5 → 10 items (not complete) |
| L6 | two missing refusals | 2 s, 181k → "complete" | 89 s, 13, 2.46M → both added, code base's own texts |
| LD | correct work, probing questions | 4 s, 69k → "Confirmed" | 47 s, 8, 0.26M → kept all 10 correct; listed near misses |

Raw changed nothing in **0/8** cases, and at L3 it added a false claim. Guided fixed or correctly held the work in **9/9** cases, and it never provoked a "fix" of correct work (L2, LD). A guided round took 12 s to 3.3 minutes. Most of its tokens go to re-running checks. In the two rounds with no tool calls (L5, L5b), DSH wrote about 220 output tokens per second.

## Role framing

The role framing was a one-sentence preamble: "meticulous senior TypeScript engineer, follows the spec literally, reports gaps, never changes what a test checks". It was added on top of the unchanged book.

| level | wall vs baseline mean | tokens vs mean | quality vs baselines |
|---|---|---|---|
| L2 | +52% | +93% | same diff; a mid-run over-reach into 3 unrelated files (it restored them) |
| L3a | +84% | +20% | pass; a new miss (`import()` types), repaired |
| L4 | −21% | −33% | **weakest tests** (mutant 0.6); conflict not named |
| L5 | +13% | +5% | same tests; shortest report |
| L5b | +17% | +3% | same tests |
| L6 | −8% | −17% | same code and the same choices |
| LD | +53% | +17% | same answers; +53% output (most thinking) |

**Effect: none on quality at any of 7 levels; worse in cost at 3 and worse in tests at 1.** Drop it.

## Detailed book and split

The detailed book adds whatever the plain book lacked at that level: a reading list by line ranges with short excerpts, numbered steps ("run the checks first and expect N", "until it passes"), exact numbers, case lists, named forbidden git commands, and a scratch rule.

| level | tokens vs baseline mean | wall | tool calls | quality |
|---|---|---|---|---|
| L2 | +29% | −1% | +42% | same; one false negative claim in its report |
| L3a | −16% | +11% | −6% | same; broke two of its explicit rules |
| **L3** | −13% | +7% | +5% | **turned 0/3 into a pass**: the exact counts, the keep rule with an example, the matching dry run and the named git commands did it |
| L4 | **−69%** | −21% | −12% | best tests (it followed the case list) |
| L5 | **−68%** | −34% | −56% | same |
| L5b | **−65%** | −22% | −38% | same |
| L6 | **−66%** | −24% | +1% | same; it did not name the workspace gap |
| LD | **−50%** | −32% | −42% | same |

- **Split** (L3 only; three batches in one copy, one Session each): 2.8× the wall time, 2.6× the tool calls and 3.1× the tokens of a baseline, plus about 21 minutes of checks between batches. Batch 1 repeated the baseline error. Batch 2 repaired its own slip with `git checkout -- src tests`, which would have wiped batch 1 had batch 1 not staged its work with a forbidden `git add -A`. The end state equals the detailed book's.
- **pro** (L6 only, one run): +25% wall time, −2% tokens, partial 15/16. It never found the spec row that 4/4 searching flash runs found.
- **Not run:** reasoningEffort and thinking overlays (no level needed them), more pro runs (the user caps pro), role framing at L3.

## Where the limit is, in plain words

**What DSH does reliably** (flash, measured):
1. **Mechanical edits across many files, when the rules are exact.** Up to 17 moves, 157 files and 358 specifiers in one run of about 6 minutes, with every file right in every run. It writes its own TypeScript-AST script, so the cost follows the number of steps, not the number of files. From L3a to L3 the files doubled, while wall time grew 1.3× and tokens 0.9×.
2. **Implementing one function to a frozen interface and an exact output contract.** A 79-line fold: 5/5 first runs, each in one edit, green at once.
3. **Implementing an owner-service write from the spec plus the repository, with no case list.** 94 lines: 5/5 flash first runs passed. It found the sibling service and the spec's implementation note by itself.
4. **Writing tests from a case list,** with or without expected values. The test bodies were identical across runs. It derives exact reason strings from the code by tracing it by hand.
5. **Lookup by identifier in code and Chinese docs.** 10/10 with byte-identical answers, and it checks each answer before writing.
6. **Acting on a pointed review.** It fixes exactly what is pointed out and leaves the rest alone.

**Where it starts to fail** (every case seen):
1. **The scope of a rule.** A general sentence gets applied to everything it can reach: all 3 L3 baselines "tidied" 10 unrelated specifiers, as did 3 of 5 L3a first drafts and the L2 role run. Only a case rule with an example from this repository stopped it.
2. **Conventions that are not written down.** At L6, 5/5 flash runs left out the code base's workspace refusal and empty-source refusal, because the spec row did not list them. The book said "follow the code base", and the literal spec won.
3. **Vague targets.** An approximate count becomes a target. At L3, 3/3 runs accepted 368 changes as "about 360". At L3a, one run called 110 "the right magic number".
4. **Completeness of lists it writes itself.** The L3 baselines listed 14 of 38 stale comment lines. UNSPECIFIED lists named 5–9 of 15 open points at L5 and L5b. Test cases outside the given list were hit or miss (L4).
5. **Negative claims in reports.** "None found", "no files created" and "no discrepancy" were false or misleading in about one run per level. Positive counts in CHECKS were nearly always true (one wrong count, L3 baseline-2).
6. **Process discipline.** Every tool-using session at the move levels used `/tmp`, despite "stay inside the current directory" (L3: 9/9). At L3, 4 of the 8 sessions whose book did not name the forbidden git commands used one (`add`, `rm`, `checkout`). The run whose book named them used none. At L3a, one more run used `git checkout`.

**What is not a limit** (as measured): size up to 157 files; time (at most 7.8 minutes); tokens (at most 7.1M); consistency of outcome between repeats.

**The limit in one sentence.** The ladder did not find a size or difficulty at which flash fails. The boundary it found is the book: DSH is reliable when every rule it must apply is written as an explicit, scoped rule, with exact numbers to check itself against. It fails when it must infer how far a rule reaches, or must infer a convention.

**What each optimisation changed:**
- The plain smoke-shaped book was enough for 7 of 8 levels.
- Exact numbers, a keep rule with an example, a dry run that must match, and named forbidden git commands fixed L3.
- A reading list by ranges plus a capped test step cut cost by 50–69% at L4, L5, L5b, L6 and LD. It brought no gain on the move levels, where DSH's own script carries the work.
- A step list that repeats what DSH would do anyway brought no gain (L2, L3a).
- A case list makes the tests exactly as good as the list (L4, L5).
- An enumeration method makes a list complete. For example: "each return, each side of each `||`", or "git grep every old file name, with or without a line reference".
- Guided review fixed 9/9; raw output 0/8.
- Role framing, split and pro brought no gain.

**Compared with the user's view.** "A good executor for very clear tasks, and for doc lookup": confirmed. "Weak at decisions": spec-literal judgement calls were good (L6), and it names them in UNSPECIFIED. But it does not infer unwritten conventions, and it was never given real design choices. "Weak at interaction": it responds very well to a pointed review and not at all to bare check output. It was not tested as a conversation partner.

**Not measured:**
- real design decisions (where an unplaced file goes, how to break a cycle);
- features with new behaviour across several files;
- UI work;
- lookup by meaning without an identifier;
- runs longer than 8 minutes;
- thinking or effort overlays;
- the consistency of the detailed L3 book (a single run);
- whether DSH stops cleanly at a "STOP after the dry run" (the two-stage form planned for task D).
