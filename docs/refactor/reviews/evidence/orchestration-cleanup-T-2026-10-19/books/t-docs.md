# Task: draft the documents for merging the T round (docs only; Chinese)

You are working in a copy of the repository (the current directory): the lead branch with T applied. This is a NEW
session. You write **document drafts only**: no code, no tests, no builds, no git writes, no network, no real model
calls. The lead reviews every line before anything is used. **Finish within 70 minutes** (the run stops at 85). Work
in coordinator mode (`./.dsh-ref/coordinator-mode.md`); the files of running subagents are disjoint; at most three
subagents; **do not end your turn while a subagent has not reported back.**

**This run is headless. When your turn ends, the whole run ends.**

## 1. What happened (the material is in `./.dsh-ref/evidence/`)

T is HANDOFF decision 79-4: one round over the whole test suite and the production code that only old data or old
interfaces need (also decision 79: no old-data compatibility). Tests that are outdated, duplicated or trivial were
deleted or merged with a reason; tests that wrote facts by hand were converted to public steps under the test rule
sheet; production code kept only for old data or old interfaces was removed. It was built in two waves, each with up
to three reworks from frozen finding tables (decisions 80 and 81). **Start with `books/t-lead-summary.md`** (the time
line, the deviations, the lead fixes, the rulings R-1..R-24, the checks, the size, the usage). Then:

- `books/`:
  - the inventory's rules (`t-common.md`) and its verdicts (`t-final-summary.txt`; per row `t-final.json`);
  - wave 1: the book (`t-book.md`), the run files (`t-run-TP.md`, `t-run-TQ.md`, `t-run-TQ2.md`), the items and
    whitelists (`t-items-TP.md`, `t-items-TQ.md`, `t-files-TP.txt`, `t-files-TQ.txt`), the group plan
    (`t-groups.json`), the rework run files (`t-run-W1R1.md`, `t-run-W1R1b.md`, `t-run-W1R2.md`, `t-run-W1R3.md`);
  - the test rule sheet v2 (`test-rule-sheet-v2.md`; v1 is
    `docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md`) and Codex's instance list
    (`t-v2-instances.md`);
  - wave 2: the book (`t-book-w2.md`), the run files and items (`t-run-T?-w2.md`, `t-items-T?-w2.md`,
    `t-files-T?-w2.txt`), the items the refresh dropped (`t-w2-dropped.md`), the merge notes (`t-audit-merge-notes.md`);
  - the frozen finding tables: `t-w1-findings.md` (wave 1, rework 1), `t-w1r1-findings.md` (rework 2),
    `t-w1r2-findings.md` (rework 3), `t-w2b-findings.md` (wave 2, rework 1), `t-w2r2-findings.md` (rework 2),
    `t-w2r3-findings.md` (rework 3). Each has its rulings in §0 and the result of the rework in its last section;
  - the items left for the user (`t-end-list.md`) and this book (`t-docs.md`).
- `dsh/`: the DSH replies, final notes and ledgers (`t-reply-*.md`, `tb-*-final.md`, `ledger-*.txt`); the inventory's
  books and reports (`inventory/`). Replies are claims, not evidence: the finding tables say what the audits found.
- `claude/`: the reports of the Claude subagents that applied wave-2 reworks 1 and 2 (`t-reply-W2R1-agents.md`,
  `t-reply-W2R2-agents.md`), and the Claude audits (`w2-preaudit-dump.md`, `w2-ledger-cover-dump.md`,
  `w2r1-claude-audit.md`, `w2r2-claude-audit.md`).
- `codex/`: every Codex prompt and answer of T (`*.prompt.md`, the shared `*common.md` and `*.head.md`, `*.out.md`):
  inventory `t-inv-*`, book checks `t-bk-*` and `t-bk2-W1`, wave-1 audits `t-aud-G1..G7`, rework audits `t-r1-*`,
  `t-r2-*`, `t-r3-P1`, the v2 instance lists `t-v2-list`, `t-v2-full`, `t-v2g-*` (pass 1), `t-v2n-*` (pass 2), the
  wave-2 refresh `t-w2r-*`, the wave-2 audit `t-w2a-*`, the rework audits `t-w2r1a-*`, `t-w2r2a-*` and the quick check
  `t-w2r3q`.
- `checks/`: the full suites (`full-*.txt`; `full-TMERGE.txt` is the merge suite and may be a placeholder), the
  wave-2 ledgers, the wave-1 lead patch and diff, `r3-in05.txt`, `w2-env-T3.txt`, `dsh-runs.txt`, `codex-calls.txt`,
  `claude-workflows.txt`, `t-files-deleted-added.txt` (every file T deleted or added).
- `coverage/`: the coverage before T (`before-summary.txt`, `before-run.txt`, `before-coverage-summary.json`); the
  after-T files and the comparison may be missing (the lead adds them).

## 2. What to draft (edit the files in this copy)

Write Chinese in the style of the existing documents: short sentences, plain words, exact numbers, one idea per
bullet. Follow the format of the C1 counterparts (`docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/`
`README.md` and `lead-acceptance.md`). Every number comes from the material; write `【lead 填】` where the material
does not have it yet.

1. **Evidence README** `docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/README.md`:
   - what T is (decision 79-4, in a few bullets: what was deleted, merged and converted, by kind; the production code
     removed; the allowlist change; the two waves and why there are two);
   - the result line: merged, commit `【lead 填】`; the merge full suite `【lead 填】`; no real model calls;
   - a table of all rounds: the inventory, the book checks, wave 1 (TP, TQ, TQ2, reworks 1–3 and the lead patch), the
     v2 instance list, wave 2 (T1–T3, reworks 1–3). Per round: who did it, the book or run file, the run seconds /
     tokens / context peak (DSH from `checks/dsh-runs.txt`; Claude workflows from `checks/claude-workflows.txt`), the
     audit and its 会出错 / 违规 / 不整洁 counts, the finding table it produced, the resulting commit, the full suite;
   - the totals (DSH runs, seconds, tokens; Codex answers; Claude workflows, agents, subagent tokens);
   - the size (`books/t-lead-summary.md` §7; per wave; test files, helpers, tests passed before and after);
   - the process notes: the deviations of `t-lead-summary.md` §3, each as one bullet; decision 81's rework count per
     wave (3 and 3); the context-limit handoffs; the book errors.
2. **`lead-acceptance.md`** in the same folder:
   - the conclusion; the merge full suite `【lead 填】`; the merge (the merge copy is the worktree commit `47cc63e8`
     plus `t-base..9a69bdb`; it differs from the T result only in `package.json`, `package-lock.json` and
     `scripts/check-boundaries.mjs`, the coverage dependency);
   - the user's decisions of 10-19 14:50 and the two of 10-20 (who does wave-2 reworks 1 and 2), each with the words
     the summary quotes;
   - per wave: the items done / partial / BLOCKED with the reason (from the replies, checked against the finding
     tables' result sections); the audit findings by table, and how each table was closed (rows done, rows not
     adopted and why, BLOCKED kept with its category);
   - the rulings R-1..R-24, each in one line with its reason (from §0 of the tables, not from the summary alone);
   - **what C1 sent to T** (C1 acceptance rulings 3, 8, 12, 14; decision 85-4) and what T did with each. The lead
     checked the merged tree: the N0 provenance line is gone from all 31 files; `track-read-model` requires the
     cursor's `ca` field (the tolerance for cursors without it is gone); `TaskClaimOutbox` is
     `DispatchOutboxRecord` and `TaskDispatchStateV1` is gone; RL-15b's lower bound is 9,900 ms; `N0GoalInput` is
     gone. Find the item ids in `books/t-items-TP.md` / `t-items-TQ.md` (Codex P1-183..188 in `books/t-final.json`);
   - the coverage before and after: `【lead 填】` for the after numbers and the triage;
   - **left for the user**: one bullet per item of `books/t-end-list.md` "For the user to decide", with its source;
   - known limits (no real model calls; the full suites ran with bubblewrap in WSL; DSH's sandbox had no bubblewrap).
3. **`docs/refactor/STATUS.md`**:
   - the title line: add T to the merged list; the date line: 2026-10-20;
   - a T bullet right after the C1 bullet (around line 51): merged, commit `【lead 填】`; what it did in two or three
     sentences; the size; who built it (DSH waves and reworks; wave-2 reworks by Claude subagents by the user's
     decisions and the lead); links to the evidence README and the acceptance;
   - the "last check" lines (around 87–88): a new first line for the T merge suite `【lead 填】`;
   - the next steps (around 337 and 348–354): T done, with one short sentence and the link; what is left for the user
     (`books/t-end-list.md`, `【lead 填：用户的决定】`); then, unchanged in order, the decision-83 section of slices 6–7,
     the structure round before 6A (85-1), then 6A. C2 stays where it is;
   - every sentence in STATUS that sends something "to T" ("进 T", "在 T", "归 T", "T 轮"): find whether a T item
     covered it (search `books/t-items-*.md` and `books/t-final.json` for the id, e.g. F-067, F-066, G3, G5, N-04, P3).
     If covered, say it is done in T with the item id; if not, leave the sentence and list it in your reply. Do not
     guess.
4. **`docs/refactor/IMPLEMENTED-CAPABILITIES.md`**:
   - one dated line at the top like the C1 line: T merged (`【lead 填】`); no new capability, no new route; old-data
     readers removed (decision 79); the four production files deleted (by path); the one behaviour change of wave 2
     (`claimingSessionOf`, W2b-57); the evidence link;
   - the four rows that name files T deleted: WG29 (line 228, `session-provenance-facts.ts` and the S1-SES-02 backfill
     sentence), WG43 (line 245, `executed-files-stub.ts`), WS5 (line 290, `project-source-index.ts` and its test
     `tests/data/project-source-index.test.ts`), and the `role-source-reader.ts` row (line 298). For each, read the T
     item that deleted the file (search `books/t-items-*.md` and `books/t-final.json` for the file name) and the
     current code, then rewrite only what is no longer true. For WG43, say what the conflict hint reads for executed
     files today, from `src/core/work-graph/views/goal-conflicts.ts` and its callers. If you cannot tell, list the row
     in your reply instead of guessing.
5. **`docs/refactor/design/orchestration-2026-10/slices/README.md`** (the status line around 22) and **`AGENTS.md`**
   (the status paragraph): T merged (`【lead 填】`); the last full suite becomes T's merge suite (`【lead 填】`); next:
   the user's choices on the end-of-T list, then the decision-83 section, the structure round before 6A, then 6A.
6. **`docs/refactor/DSH-WORKFLOW.md` §6.10**: one bullet, "T 轮学到的（2026-10-19/20）", with three facts from the
   summary §3 and the books: (a) the type-check lock must be a file inside the copy (`./.typecheck.lock`), because a
   machine-wide lock outside the DSH sandbox is refused; (b) DSH's sandbox has no bubblewrap for the platform's own
   process sandbox: the book lists those tests and the lead runs them with bubblewrap (R-10); (c) large rework books
   reached the 360K context limit (TQ, wave-1 reworks 1 and 2): the continuation books kept the coordinator lean
   (it does not read the audit answers or the item files; subagents report in at most 40 lines; see
   `books/t-run-W1R1b.md`). Quote the numbers exactly; do not invent rules.

Do not edit `docs/refactor/HANDOFF.md`, `docs/AGENTS.md`, any spec or any test rule sheet (the lead does those). Do
not copy the material into the evidence folder (the lead does that); refer to it by the paths of section 1 relative
to the evidence folder (`books/…`, `dsh/…`, `claude/…`, `codex/…`, `checks/…`, `coverage/…`). Keep `【lead 填】`
where this book says so.

## 3. Reply

Under 300 words: the files you edited; anything you could not decide (with options); every STATUS "to T" sentence
and capability row you left as it was, with the reason; and any fact in the material that contradicts another.
