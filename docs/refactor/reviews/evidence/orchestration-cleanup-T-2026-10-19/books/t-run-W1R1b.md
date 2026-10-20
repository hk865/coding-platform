# T run: wave 1, rework 1, segment 2 (lead, 2026-10-19 23:30)

Segment 1 stopped at the context limit after 17 minutes. Its work is uncommitted in this copy. The typecheck was
green at the stop.

## Read first, and only this

- `./.dsh-ref/t-reply-W1R1.md`: §1 (the per-row table) and §8 (HANDOFF). Segment 1's results stand; do not redo
  done rows.
- `./.dsh-ref/t-w1-findings.md`: **only the rows you are working on.** Find them with `rg -n "^\| W1-13 "` or
  `rg -n "^\| B-08 "`, plus §0 (R-1 to R-6). Never read the whole file.
- `./.dsh-ref/test-rule-sheet-v2.md`, and the v1 sheet it changes, only when a row needs them.
- **Do not read** the Codex audit answers (`t-aud-G*.out.md`) or the items files. Use `rg` for one line only when a
  row's evidence is unclear.

**Why:** segment 1 filled 360K in 17 minutes. You coordinate; subagents do the work and read the files.

## Lead rulings on segment 1

1. **R-6 accepted.**
   - W1-19: `usage:'historical_explanation'` stays. `current` is refused for the Host principal
     (`src/core/work-graph/materials/applicability.ts:38-40`), and the read is still the real materials owner.
   - W1-01: no test asserts the deleted `legacy` row, so there is nothing to delete.
2. **BLOCKED accepted for this rework.** These keep their wave-1 form, and the lead rules on them later with B-14:
   - W1-21: two real claims of one Task across two segments;
   - W1-25: the upstream `runA` needs a full Runtime;
   - W1-26 AD06: a real unentered failure and Host reconcile;
   - W1-26 AD08: already on the base path.
3. **Accepted as reported:**
   - the `FORMAT` seed in `tests/state/session-availability.test.ts`;
   - the two out-of-row files (`session-availability.test.ts`, `S1-codecs-indexes.test.ts`);
   - the deletions listed in segment 1's §4.

## What to do, in this order

1. `git status --short`: check that the tree matches segment 1's §8, then `flock ./.typecheck.lock npm run typecheck`.
2. **Half-done fixtures.** Run each one's tests:
   - C1 (W1-13);
   - S2B-track and S2B-runtime-steps (W1-15, W1-36, W1-37);
   - S5-decision and S5-queue (W1-17, W1-18, W1-36, W1-37);
   - S1-archive-service (W1-44, with `tests/work-graph/S1-requeue.test.ts`);
   - S1-workflow-archive (W1-35).

   Find the importers with `rg`. For each fixture:
   - green, and the row's fix is complete: keep it, the row is done;
   - otherwise: finish it within the row's fix. If that cannot be done, revert that file to `w1-merged`
     (`git checkout w1-merged -- <file>`) and mark the row BLOCKED with the evidence (R-5).
3. **Not started:**
   - W1-10 (WP1) and W1-20 (SQLite);
   - B-02, B-03, B-04, B-08, B-09 (runtime and R4c);
   - B-10, B-11, B-12, B-13 (graph-session and context inputs).

   Each per its row in the findings table, with R-5 per row or per use.
4. Checks (segment 1's book, "Checks before you finish"):
   - typecheck and `check:architecture`;
   - the tests of every changed file and its importers;
   - commit `T W1 rework 1`;
   - both ledgers, with the mapping;
   - both shortstats.
5. Update `./.dsh-ref/t-reply-W1R1.md`:
   - keep segment 1's text;
   - change the §1 results that changed;
   - add `## 9. 第二段`, with the same sections as §1 to §7 of the book's reply, for this segment's work.

## Subagents

- Three at once at most, on files that do not overlap. A good split:
  - (a) the half-done fixtures (step 2);
  - (b) W1-20, B-03, B-04, B-08, B-09;
  - (c) B-02, B-10, B-11, B-12, B-13.

  Then W1-10 when a slot frees.
- Give each subagent its rows' text from the findings table, R-1 to R-6, and the rule-sheet lines it needs.
- Each reports in at most 40 lines:
  - each row's result;
  - the files it changed;
  - test pass/fail counts and the failing test names (no logs);
  - BLOCKED evidence as `file:line` plus one sentence.
- Subagents never run the typecheck. They run only their own test files, with `npx vitest run --maxWorkers=2`.
- Only you run `flock ./.typecheck.lock npm run typecheck`, never while a subagent runs tests.
- **Do not end your turn before every subagent has reported back.**

## Environment

Tests that fail only on `ENOENT /usr/bin/bwrap` are environment failures. List them; the lead runs the full suite
with bwrap.
