Read-only facts check for the lead. Do not write any file, do not run tests. Answer in Chinese with file:line.

This folder (`D:/cxt/t-docs`) has three parts:
- `tree/`: the repository with the T round merged (T = HANDOFF decision 79-4: test-suite and old-code cleanup). The
  code before T is in `D:/cxt/t-inv` (base `3a9f6d94`), read-only too.
- `draft/`: DSH's DRAFT documents for merging T (not yet reviewed by the lead):
  - `draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/README.md` and `lead-acceptance.md` (new);
  - `draft/docs/refactor/STATUS.md`, `draft/docs/refactor/IMPLEMENTED-CAPABILITIES.md`,
    `draft/docs/refactor/design/orchestration-2026-10/slices/README.md`, `draft/AGENTS.md`,
    `draft/docs/refactor/DSH-WORKFLOW.md` (§6.10, the new bullet "T 轮学到的");
  - `draft/docs-draft.diff` is the diff of the edited files against `tree/`; `draft/dsh-reply.md` is DSH's reply.
  `【lead 填】` marks the merge commit, the merge full suite, the coverage after T and the user's decisions, which are
  not known yet; skip them.
- `evidence/`: the material the drafts cite (`books/`, `dsh/`, `claude/`, `codex/`, `checks/`, `coverage/`; the
  evidence paths in the drafts are relative to this folder). Start with `evidence/books/t-lead-summary.md`; DSH's task
  was `evidence/books/t-docs.md`. Note: the lead corrected two facts in the material after DSH started: the user's
  rework-2 decision was at 18:14 (not "about 18:15" or 18:25), and the wave-2 refresh's CHANGED count is 14 (8+5+1), not
  16.

Check every factual sentence of the drafts against the cited material and the code:
1. **Numbers.** Run seconds / tokens / context peaks and the totals against `evidence/checks/dsh-runs.txt`; Claude
   workflow figures against `evidence/checks/claude-workflows.txt`; Codex counts (会出错 / 违规 / 不整洁) per audit
   against each `evidence/codex/*.out.md` (its last lines or its table); full-suite figures against
   `evidence/checks/full-*.txt` and `evidence/books/t-lead-summary.md` §6; sizes against `t-lead-summary.md` §7 and
   `evidence/checks/t-files-deleted-added.txt`; item counts per group (done / partial / BLOCKED) against the DSH
   replies (`evidence/dsh/t-reply-*.md`) and the finding tables' result sections. For TQ, settle "100 done" vs "107"
   from `evidence/dsh/t-reply-TQ.md` and say which is right and why.
2. **Citations.** Does each cited table row (W1-xx, B-xx, W2-xx, W3-xx, W2b-xx, W2c-xx, W2d-xx), ruling (R-1..R-24),
   item (TP-xxx, TQ-xxx, T1-xxx, T2-xxx, T3-xxx), Codex finding (P1-183..188 etc.) or reply section say what the
   sentence claims? Flag wrong ids, wrong counts of rows "done / partial / BLOCKED / not adopted", and claims the source
   does not make. Check every bullet of `lead-acceptance.md` "逐波判断" and "审查和问题表" this way.
3. **Code facts** in `tree/` (and `D:/cxt/t-inv` for "before"): the four deleted production files are gone; the N0
   provenance line (`source provenance is recorded in the N0 transfer manifest`) was in 31 files before and is in none
   now, and which directories those 31 files were in; `track-read-model.ts` requires the cursor's `ca`;
   `TaskClaimOutbox = DispatchOutboxRecord`; `TaskDispatchStateV1` and `N0GoalInput` are gone; RL-15b's bounds in
   `tests/kernel/RL-12-15-conditions.test.ts`; `claimingSessionOf` in `views/activity-read-helpers.ts`; every file:line
   and name the drafts cite (e.g. `graph-context-reader.ts:1010`, `execution-driver.ts:239-243`, `:1253`,
   `session-operations.ts:426`, `plan-validation.ts:337-338`, `plan-readers.ts:1390`, `K3-35-runtime.ts:113`).
4. **The four capability rows** the draft changed in `IMPLEMENTED-CAPABILITIES.md` (WG29, WG43, WS5, and the removed
   `role-source-reader.ts` row): is each new sentence true in `tree/`? For WG29: is the old-Session provenance
   backfill (S1-SES-02) gone, and do the cited tests still exist? For WG43: is `GoalExecutedFilesPort` /
   `createGoalExecutedFilesReader` real and wired as stated, with the cited lines? For WS5: do `ProjectSourceQuery` and
   `ProjectSourceAccess` exist in `project-source-snapshot.ts`? Is any other row of the file now naming a file or test
   that T deleted (`evidence/checks/t-files-deleted-added.txt`)?
5. **STATUS.** The draft left five sentences that send work "to T" (DSH's reply lists them: lines ~42, 48, 49, 295,
   345 of the draft). For each, find the source list (the K3 and L8 evidence in
   `tree/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/` and `orchestration-slice-8-L8-2026-10-18/`,
   their acceptance files and finding tables) and say whether T covered each named thing: search
   `evidence/books/t-items-*.md`, `evidence/books/t-final.json` and the T tables for the ids, files or lines, and compare
   the test in `D:/cxt/t-inv` with `tree/`. Answer per named thing: covered (T item id, what changed), partly, or not
   covered.
6. **DSH-WORKFLOW §6.10** new bullet: every fact in it holds against the material (the lock, the sandbox, the context
   peaks, the lean continuation book).
7. **Internal consistency** across the drafts (the same number or claim stated differently in two places), and
   anything in `evidence/books/t-lead-summary.md` §3 (deviations), §4 (lead fixes) or §5 (rulings) that the drafts miss
   or state differently.

Output: a numbered list of problems (file:line of the draft, what is wrong, the correct text or fact with its source).
Skip style. Then the per-thing answers of item 5 as a table. End with: problem count.
