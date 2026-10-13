# Task: orchestration wiring package 2 — fourth session: the remaining test evidence after the second review

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Three earlier
sessions implemented wiring package 2 in this copy; their work is in the working tree (not committed). The lead ran the
full suite with real bubblewrap: everything passes (287 files, 6,073 tests). Codex's second review confirms that the six
production defects are fixed and found no new production defect, but six test-evidence items must be fixed before
merge, plus a few smaller ones. This session fixes them. Everything you need is in this message and in files of this
copy.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 5 and the reply of section 6.

**Work with subagents.** You are the coordinator; keep your own context small. Do not read the spec, the code or the
tests yourself. Give each group of section 3 to its own subagent; they write disjoint files.

## 1. Material (inside this copy, excluded from `git status`)

- `./.dsh-ref/w2-impl.md` — the first brief. Sections 1–5 still apply (frozen spec and sha256, L-scope, L-tdd,
  L-reach, L-interfaces, L-SES13, L-bwrap, rules).
- `./.dsh-ref/r3/` — the third session's material (acceptance review, verified fixes, the refreeze). The refrozen old
  tests and the approved harness additions stay exactly as they are now.
- `./.dsh-ref/r4/codex-review-2.md` — **the second review. Its "Must fix before merge" items 1–6 and its "Should fix"
  items are this session's work.**
- `./.dsh-ref/r4/report-3.md` — the third session's reply.
- `./.dsh-ref/tdd/` — the TDD skill.

Every subagent reads: the TDD skill; the first brief sections 1–5; this message's section 2; its group block; the
review items its block names; the spec lines those items cite; then the code and tests.

## 2. Lead decisions for this round (binding)

- **Test-only round, plus one small production fix (group P).** Production code stays as it is except the DTO source
  check below. If a must-fix test item cannot be written without another production change, stop that item and report
  it under UNSPECIFIED with the spec line and the minimal counter-example.
- **Expected values (review must-fix 2).** Never take an expected identity, order or count from the system under test
  (no queue readback, no message readback, no `noticeKey`, no product serialization or comparison functions). Take
  identities from the creating command's own result or a commit observed by the harness `commitObserver`; write the
  expected order as a literal list in the test. A test that "accommodates" whichever item came first is not allowed.
- **E2 evidence (must-fix 1).** F05: after the autonomy change, prepare a NEW unbound Run and assert its prepared input
  contains the new level (the already-bound input stays as it was). F06 budget: prepare a real continuation under the
  constrained budget and assert what the spec says is kept and what is cut. F08: inject a read failure at the boundary
  of an installed settings or decisions source and assert the E2 preparation is rejected (not a successful empty
  input).
- **F14 (must-fix 3).** For the Work, user-answer and Query-answer writers: keep the complete first result, replay the
  same request after reopening SQLite, and compare complete values and cursors, including R and P. For the user answer
  assert the Goal/workspace notice at R; for the Query answer the notice at P (`verified-fixes.md` findings 1–2).
- **E3 writers (must-fix 4).** Drive the other unavailable-position writers through the real platform on both backends:
  Work reconciliation/recognition and Query recovery; assert the independently observed R, the resulting notices, and
  replay/reopen where the spec applies (L11-2).
- **Observation brackets (must-fix 5).** Every tested preparation or read stage is bracketed by the harness
  `commitObserver` (zero commits) and both model counters (`scripted` and `queryScripted`, zero calls).
- **Capacity and retry boundaries (must-fix 6).** Use real successful histories (not fabricated pages) with
  independently named tails; cover exactly the capacity (success, every item, the named last one) and one more
  (the capacity rejection without half a page); for the retry limit use failure scripts that stabilize on attempt four
  versus only after attempt four, and assert the public outcomes, not call counts.
- **DTO source identity (should fix; group P).** `undelivered-reply-notices.ts` validates the DTO's
  `sourceSessionRef` against the directory-derived source and rejects a disagreement (spec line 248). Test-first.
- **Other should-fix items.** Remove or replace the successful internal mocks the review names (keep legitimate
  failure injections and the accepted F07 limitation); remove the implementation-coupled or trivial W231 assertions or
  keep only meaningful mechanical boundary checks without store reads; fix the malformed-position empty-source case to
  use the valid envelope.
- **F07** stays an accepted, documented omission. Narrow its comment: Task-linked cards also come from unknown-outcome,
  stop, rework and automation-confirmation causes (`goal-decision-reader.ts`), and no preparable claim for the same Task
  coexists with them in the paths the lead checked; say so instead of "only deferred Tasks".

## 3. Groups

**P — the DTO source check:** `src/core/work-graph/views/undelivered-reply-notices.ts`; its test in
`tests/work-graph/WP2-undelivered-notices.test.ts` (coordinate with group M, which owns that file: P sends its test to
the coordinator, who passes it to M, or P runs after M).

**M — module-entry tests:** `tests/work-graph/WP2-undelivered-notices.test.ts`, `tests/work-graph/WP2-context-extensions.test.ts`,
`tests/work-graph/WP2-message-duties.test.ts`, `tests/record-store/WP2-notice-cursors.test.ts`,
`tests/runtime/WP2-context-assembly.test.ts`. Review items: must-fix 2 (X, U parts), 6; should-fix mocks, W231, the
envelope case; F07 comment.

**C — platform-entry tests:** `tests/composition/WP2-wiring.test.ts`, `tests/scenarios/WP2-wiring-scenario.test.ts`,
`tests/helpers/WP2-platform-support.ts`. Review items: must-fix 1, 2 (C parts, F11), 3, 4, 5.

## 4. Rules

Test-first for the production change; for test rewrites keep a log (old test, what was wrong, new test, result). No git
write commands; one vitest command at a time; no real model calls; no network; do not touch ports 3080, 3099, 44797;
probes only under `./.dsh-scratch/`, deleted at the end. No edits to the refrozen old tests, the harness additions or
any other existing test file.

## 5. Checks

Run exactly the commands of the first brief section 8, plus:
```
npx vitest run tests/state/S5-message-decision.test.ts tests/work-graph/S5-user-messages.test.ts tests/scenarios/S1-wait-copy-retirement.test.ts tests/app/S5-decision-routes.test.ts
git diff --stat slice-base -- tests
```
Expected (no bubblewrap here): typecheck, check:architecture and build exit 0; every `WP2-` test passes; the regression
run fails only in the 18 sandbox-kind cases of `DSH-BASELINE.md`; the four refrozen files pass; all ten sha256 values
hold; the tests diff lists only `WP2-` files, the helper, and the unchanged refreeze and harness changes.

## 6. Reply

The first brief's reply format, plus **REVIEW:** for each must-fix item 1–6 and each should-fix item: fixed / not fixed
(why), with the test name(s) and file:line.
