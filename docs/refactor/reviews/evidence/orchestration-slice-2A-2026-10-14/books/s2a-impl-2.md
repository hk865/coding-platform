# Task: slice 2A — second session: finish group N, integrate, self-check, report

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. A first session
built most of slice 2A in this working tree (not committed) and was cut off by a network failure before it finished:
its subagents were killed and it wrote no report. You finish the work. **You must finish within the run limit (150
minutes).**

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents` and `job_list`; repeat.
- End your turn only after the checks of section 5 and the reply of section 6.

## 1. Material

- `./.dsh-ref/s2a-impl.md` — the first session's task book. **Sections 1–9 still apply** (rules, L-scope, L-tdd,
  L-fixtures, P1–P14, groups, self-check, checks), except where this message changes them.
- `./.dsh-ref/r1/` — what the first session left: `coordinator-notes.txt` (its notes and rulings), `group-H-report.txt`,
  `targeted-after-r1.txt` (the lead's run of the targeted tests on the tree as it was left).
- `./.dsh-ref/tdd/` — the TDD skill.

## 2. Where the first session stopped

- **Done:** group O (QE1), group Q (QE2, 24 tests; the L11 seam `DecisionSourceAttempt` in `decision-contracts.ts:127`,
  optional `page.attempt` on `DecisionNoticeSourcePort`, created per attempt in `decision-read-model.ts:269`, passed
  at `:477`), group H (QE4, 4 tests).
- **Not done:** group N's follow-up (it was running when the run died; its partial edits may be in the tree), group I,
  the self-check, the full report.
- Typecheck passes on the tree as left; the 3 frozen files still match their sha256.

## 3. Lead rulings for this session (binding)

- **R1 — group N's open work** (a new subagent; read the group N block of the first book and `coordinator-notes.txt`
  first, and look at the tree as it is — some of it may already be done):
  1. **QA-10(二)** at full scale through public services, without the 2,001-link case (P11).
  2. **QA-12's second case:** notices of a cancelled Goal and of a completed Goal stay, each with its own assertion.
  3. **L11 / P1:** `automatic-rework-notices.ts` builds its whole collection once per window attempt using
     `input.page.attempt?.cache` (key: workspace + goal + category). Results unchanged.
  4. **P7:** type the notice source's dependency inline as `Pick<S5RecordPort, 'readMany' | 'lookup'> &
     RecordOrderedLookupPort` (or the equivalent), without an alias in `decision-contracts.ts`.
  5. **P3 — the Session listing moves off `findSessions`,** as spec §0.4 row 5 requires: list Sessions through the
     Session-by-workspace index (`session-record-codecs.ts:948`) in its key order, read only the Session records'
     health, never the responsibility links.
- **R2 — the two M10 tests change their injection point, not their meaning.** The frozen
  `tests/work-graph/WP2-undelivered-notices.test.ts` has two tests named `M10 …` that script a moving directory by
  replacing `sessions.findSessions`. After R1.5 the source no longer calls `findSessions`, so the same script must be
  injected where the source now reads the Session list: the records port's `lookup` of the Session index (a later page
  reports a moved window; attempt counting as before). You may change **only those two tests' setup**. Every
  assertion, test name and comment meaning stays as it is: (a) a later page that moves discards the whole accumulated
  window, so the recovered result is empty; (b) stable on attempt four recovers with 1 item, stable only on attempt
  five fails with `unavailable` and `undelivered_reply_window_changed:`. Report the diff of that file. No other test
  in it changes. The lead re-freezes the file after review.
- **R3 — group Q's two storage-boundary datasets are accepted** as lead exceptions 3 and 4 (QA-09(二)'s closed
  candidates and QA-17's Run records): building them through public services is quadratic and does not fit the time
  limit. Conditions: every seeded record is one today's codecs decode and a public writer could have produced, it is
  written through the store's normal commit API (never raw SQL), and every assertion goes through public reads. List
  both in UNSPECIFIED with the measured time of the public alternative if the first session noted it.
- **R4 — frozen files now:** `DSH-BASELINE.md`, `tests/work-graph/S5R2-queue-history.test.ts` and
  `tests/work-graph/WP2-context-extensions.test.ts` keep the sha256 of the first book's section 3.
  `tests/work-graph/WP2-undelivered-notices.test.ts` may differ only by R2.
- **R5 — then group I and the self-check** exactly as the first book's sections 6 and 7 (one review subagent per group
  O, Q with H, and N).

## 4. Order

1. Start the R1/R2 subagent (group N). While it works, do nothing else that runs vitest (one vitest at a time).
2. When it has reported: group I (integration: the 3 frozen files, every new `S2A-` file, `S5-notices.test.ts`, the
   S5 files of the first book's section 8; fix failures in the owning group's files with a new subagent).
3. The self-check of the first book's section 7; the owning group fixes what is not done.
4. The checks of section 5; the reply of section 6.

## 5. Checks

The first book's section 8, with R4: `sha256sum` must match for the three files of R4, and
`git diff slice-base -- tests/work-graph/WP2-undelivered-notices.test.ts` may touch only the two M10 tests.

## 6. Reply

The first book's section 9 format, covering **all** groups (O, Q, H, N, I) — reconstruct the rows of O, Q and H from
their test files and the tree (test names and implementation file:symbol; for RED, write "first session, not
recorded" where you do not have it). Add **R-RULINGS:** R1–R5, each done / not done (why), with file:symbol, and the
wall time of every 5,001-scale test.
