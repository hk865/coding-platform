# Task: slice 2C, round 3 — fix what the implementation review found; test-driven

You are working in the slice-2C copy (the current directory). The build sessions' work is **uncommitted in the working
tree — keep it**. This is a NEW session. No git write commands, no network, no real model calls. Throw-away files under
`./.dsh-scratch/` (delete at the end); never `/tmp`. Finish within 150 minutes.

**This run is headless. When your turn ends, the whole run ends, and every subagent still running is killed.** After
starting subagents, stay in your turn until every one has reported (wait with `sleep 540`, then `list_agents`; repeat).

**Memory limits (binding; the machine failed once from memory exhaustion):** at most 2 subagents at once; every vitest
command adds `--maxWorkers=4`; one vitest command at a time; the scale test runs alone with `--maxWorkers=2`; the full
suite with `--maxWorkers=8`.

Read first: `./.dsh-ref/s2c-impl.md` sections 1–8 (they all apply, including the lead answers P1–P13), the frozen spec
`docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md` (L1–L24, §3, §15 binding), the review
`./.dsh-ref/s2cimplrev.out.md`, and the last report `./.dsh-ref/final-2.md`.

## 1. Lead rulings on the review (binding)

Fix every must-fix item 1–15 and both should-fix items as the review says, test-first. Specifics and scope decisions:

- **Items 1, 2, 5–13, 15:** as the review's "Fix" says. Item 1: one bounded, cycle-aware resolver shared by the list,
  detail and hover readers. Item 2: a failed read never becomes an empty fact or `active`; propagate the failure or mark
  the part incomplete (B4). Item 5: the budget latches on the first denied request; every later budgeted read is refused;
  each affected part (including done evidence) is listed in `partialParts` with `history_budget`. Item 6: DE1 only for
  active heads. Item 9: one bounded candidate page per call, short pages allowed, malformed cursors rejected.
- **Items 3 and 4 — scope expansion approved (lead, 2026-10-15).** The two rows reported last time are fixed here, not
  deferred, because otherwise the user sees a wrong status. Allowed extra files, only for these two rows:
  `src/core/work-graph/state/session-availability.ts`, `src/business/workflow/session-maintenance.ts` (2C-22(2):
  attestation keeps the unreadable health — `missing`/`damaged` — so maintenance retires and archives the line as the
  spec says; do not change what KA1 does for a genuinely open Turn), and `src/business/workflow/session-archive.ts`
  (2C-32: the person's archive of a retired RUN-24 line writes the anomaly anchor through the owner's guarded anchor
  selection). Existing tests that assert the old behaviour: run them; if one fails, stop and report it with the test id —
  do not edit it (the lead decides).
- **Item 14 — fixtures.** `S2C-D-node-support.ts` builds scope and policy through public services. The scale fixture
  (`S2C-X-scale-fixture.ts`): the 5,000 Sessions and lines X, R, W stay public; the 3,000 Runs of line Z and the picker
  records may stay at the storage boundary as a named exception (same reasoning as 2A's exceptions 3–4: the public path
  is quadratic), written in shapes today's codecs decode, with a comment naming this ruling. Everything else public.
- **The read budget.** Set `LINE_HISTORY_READ_BUDGET = 100` (lead decision from the measured m = 4, r = 78, w = 63; spec
  L1b steps 2–4). Keep it injectable. Re-run 2C-25 alone and report m, r, w again; if r or w exceeds 100 after the
  fixes, stop and report.
- **Item 13 — coverage.** Add 2C-26; exercise 2C-40 through LE4; complete 2C-05, 13, 20, 21, 22, 24, 28, 39 with every
  case the rows list; for 2C-20 observe zero model calls and zero Runtime history reads.
- **Should-fix 2:** do not touch 2B's files; the lead merges 2B first and resolves shared registration files.

## 2. Work with subagents (the lead's recommendation; you may regroup with a reason)

- Wave 1 (2 at once): **R** resolver and identification (item 1) + failure propagation in the list reader (item 2,
  work-line-reader part); **D** node detail and hover (items 2 detail part, 12, should-fix 1).
- Wave 2: **B** budget, done evidence, archived paging (items 5, 6, 9); **S** the two scope-expanded rows (items 3, 4).
- Wave 3: **C** controls, consistency, copies, names, detail facts, contracts (items 7, 8, 10, 11, 15); **F** fixtures and
  coverage (items 13, 14) and the budget re-measure.
- Then two read-only reviewers (one per half), fixes, then section 3.

## 3. Checks

The book's section 8 with the memory flags (`--maxWorkers=4` targeted, scale alone with `--maxWorkers=2`, full suite
`--maxWorkers=8`).

## 4. Reply

The book's section 9 format, plus: per review item 1–15 the test name(s) and file:symbol; the new m, r, w; any existing
test that failed because of items 3–4 (id and first failure line).
