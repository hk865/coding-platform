# Task: draft the documents for merging cleanup round C1 (docs only; Chinese)

You are working in a copy of the repository (the current directory): the lead branch with C1 (all five groups) applied to `src`. This is a NEW session. You write **document drafts only**: no code, no tests, no builds, no git writes, no network, no real model calls. The lead reviews every line before anything is used. **Finish within 60 minutes** (the run stops at 75). Work in coordinator mode (`./.dsh-ref/coordinator-mode.md`); files of running subagents disjoint; at most three subagents; **do not end your turn while a subagent has not reported back.**

**This run is headless. When your turn ends, the whole run ends.**

## 1. What happened (the material is in `./.dsh-ref/evidence/`)

C1 is round 1 of the cleanup that decision 70 set (HANDOFF decision 70; also 79 and 84): merge duplicated helpers and copied service code in `src/core/work-graph`, and delete construction-history comments, **without changing any behaviour** (no test, assertion or allowlist changed). DSH built it in five groups; Codex reviewed each group; the lead fixed small things, merged, and ran the full suite with bubblewrap. **Start with `books/c1-lead-rulings.md`** (the time line, the rulings, the lead fixes, the checks). Then:
- `books/`: the cleanup list (`2026-10-16-cleanup-list.md`), the book (`c1-book.md`, v2), the run file per group (`c1-run-g1..g5.md`), the frozen interface tables (`c1-g1-interfaces.md`, `c1-g4-interfaces.md`), the rework books (`c1-g4-rework-1.md`, `c1-g2-rework-1.md`), the lead's rulings (`c1-lead-rulings.md`), this book (`c1-docs.md`);
- `dsh/`: the DSH replies (`*-final.md`; claims, not evidence; the rulings file lists the wording errors the lead found);
- `codex/`: the list's audits (`audit/`), the refresh and the delta (`c1-refresh`, `c1-delta`), the two book checks (`c1-book`, `c1-book2`), the group reviews (`c1-gN-review`) and the quick checks after the reworks (`c1-g4-recheck`, `c1-g2-recheck`);
- `checks/`: `dsh-runs.txt` (every DSH run; the G4 run killed for memory has no `run.json`: 00:00–00:07 local), the lead-fix diffs (`c1-gN-leadfix.diff`), the killed G4 run's partial diff, `merge-check.txt`, `group-stat.txt`, the full-suite summaries (`g1-full-suite.txt`; `m25-full-suite.txt` and `final-full-suite.txt` may be placeholders).

## 2. What to draft (edit the files in this copy)

Write Chinese in the style of the existing documents: short sentences, plain words, exact numbers, one idea per bullet. Follow the formats of the note-speed counterparts (`docs/refactor/reviews/evidence/orchestration-note-speed-2-2026-10-16/`) and, for the round table, the K3 README (`docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md`).

1. **Evidence README** `docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/README.md`: what C1 is (decision 70 round 1; what was merged, by kind, in a few bullets); the result line (merged, commit `【lead 填】`; no real model calls); a table of all rounds per group (book or run file, DSH run seconds / tokens / context peak, the Codex review and its 会出错 / 不整洁 counts, the rework, the lead's fix); the totals (DSH seconds and tokens, Codex calls); the size (total and per group, from `checks/group-stat.txt`; compare with decision 70's estimate of 1,800–2,600 lines); and the process notes (decision 81's rework counts; the G4 memory kill and the new memory rule).
2. **`lead-acceptance.md`** in the same folder: the conclusion; the full suite `【lead 填】`; the merge (order, clean, each group's diff unchanged in the merged tree); per group: the items done / partly / left with the reason (from the replies' item tables, checked against the Codex reviews), the Codex findings and how each was closed; the rulings of `c1-lead-rulings.md` §2, each with its reason; **moved to the T round** (one bullet each with its source); **moved to the decision-84 structure review** (one bullet each with its source); **not in C1 by the book** (one bullet each); known limits.
3. **`docs/refactor/STATUS.md`**:
   - a C1 bullet where the recent batches are listed (C1 merged, commit `【lead 填】`, what it did in one or two sentences, the size, the link to the evidence);
   - the "last check" line: the C1 merge suite `【lead 填】`;
   - the long next-step paragraph (around line 335, "接下来按决定 70 做两轮清理 …") and the numbered next steps (around lines 345–346): C1 done; now the T round and, alongside, the decision-84 structure review (whose results come before the 6A book); the separate `atLeastCursor` fix; then the decision-83 section of slices 6–7; then 6A. Round 2 of the cleanup (C2, fewer reads) stays where decision 70 put it; do not move it.
4. **`docs/refactor/IMPLEMENTED-CAPABILITIES.md`**: one dated line at the top like the note-speed lines (C1 merged; no new capability, no new route, interfaces and behaviour unchanged; the new shared modules by path; the evidence link). Do not edit the WG table rows unless a row names a file C1 deleted or a function C1 moved; list such rows in your reply instead of guessing.
5. **`docs/refactor/design/orchestration-2026-10/slices/README.md`** (the line around 22) and **`AGENTS.md`** (the status line): C1 merged (`【lead 填】`); the last full suite becomes C1's merge suite (`【lead 填】`); next: T and the decision-84 structure review.
6. **`docs/refactor/DSH-WORKFLOW.md`**:
   - §7.1 "停止" paragraph: bring it in line with HANDOFF decision 81 (at most three DSH reworks counted from the decision-80 freeze; after rework 2 the recheck lists everything once as the final freeze; after that tests go to Codex as a read-only patch the lead applies and checks in WSL, business to an Opus subagent). Quote decision 81's numbers exactly; do not invent rules.
   - §6.10: one bullet for the memory rule of `c1-lead-rulings.md` §2 ruling 5 (only the coordinator runs the type check, once; subagents run vitest with `--maxWorkers=2` on their own files; at most three subagents; why: 2026-10-19 G4 was killed at 8 GB with five parallel `tsc`).

Do not edit `docs/refactor/HANDOFF.md` or any spec (the lead does those). Do not copy the material into the evidence folder (the lead does that); refer to it by the paths of section 1 relative to the evidence folder (`books/…`, `dsh/…`, `codex/…`, `checks/…`). Keep `【lead 填】` for the merge commit and the merge full suite.

## 3. Reply

Under 300 words: the files you edited, anything you could not decide (with options), and any fact in the material that contradicts another.
