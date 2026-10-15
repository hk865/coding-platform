Read-only check of a test-failure diagnosis before merging slice 2C. Do not edit files, do not run tests, do not call
any model. You may read any file in this repository and in D:/cc-lead-notes.

Repository: the current directory. HEAD 7ad00938. The index holds slice 2C exactly as it will be merged
(`git diff --cached HEAD`). The working tree adds test-only fixes on top (`git diff`):
- `tests/scenarios/A8-host-restart-paused.test.ts`: case A8-3n, "option X";
- `tests/scenarios/S2C-K-archive-tags-checks.test.ts`: checks (3), (3'), (4), (5).
Product code in the working tree equals the index.

Read first: `.lead-ref/diagnosis.md` (the investigation agent's findings; it ran the tests in WSL with bwrap; its logs
are in `.lead-ref/logs/`). `.lead-ref/optY.diff` is the alternative maintenance-code change (option Y), NOT applied.

Frozen texts to check against: `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md` (L7 "维护" and
L8), `slice-2C-SPEC.md` (2C-05 checks (3)–(5), the line-status truth table, L1a), `docs/refactor/HANDOFF.md`
decisions 42 (item 2), 43 (incl. its supplement on who takes over after an anomaly anchor), 45, 54,
`docs/refactor/STATE-MACHINES-SPEC.md` (LA-1, S1-AUTO-02 / IT10, SES-02, HM01/HM02). 2C round-6 item 10 (a reused
Session's claim opens the Task's `responsible` link in the claim commit) is a lead ruling, not to be reopened.

Lead ruling under check: A8-3n takes option X. Reason: K L7 says a definite closure failure in maintenance runs
"today's logic, unchanged" (exemption → incomplete → retired archive), and decision 42 item 2 / 43 say a retired line
with no continuation is archived at once, the Task dropped with an anomaly anchor, and the next claim goes through the
ordinary selection ("不是那条线的接续，而是一次新的领取"). The old A8-3n expectation (a new continuation Session, not
the idle one) only held because, before item 10, a reused Session had no open responsible link.

Check, citing file:line:
1. Is the A8-3n diagnosis right (the archive happens in the start-up reconcile's maintenance, and why)? Does any frozen
   text require option Y instead, i.e. is the ruling wrong? Is anything in the X test assertions not derived from the
   spec or a hand-computed value? Which comments/texts in the test file and in STATE-MACHINES-SPEC LA-1 (c) and K L8
   become false under X (list them, with the replacement meaning in one line each)?
2. Checks (3), (3'), (4), (5): is each failure a test-construction problem and not a product bug? Are the rebuilt
   constructions faithful to what 2C-05 meant to test, with literal expected values, no database reads, no product
   functions used as oracles? Which 2C-05 / §10 spec sentences need a post-note?
3. The agent's other findings (a) `refused('handed_over')` skipped forever, (b) the `runMaintenance` helper on the direct
   root, (c) one link record per (Session, target, relation): confirm or refute each. For (a), is it a regression from
   2C or pre-existing since slice K, how severe, and what is the smallest fix consistent with K L7 ("其余的 refused …
   按新事实重新走")?

Reply under 1,200 words: must-fix before merging 2C (with the concrete fix), then should-fix / follow-ups, then a
one-line verdict ("merge with these test fixes", "merge after listed fixes" or "not ready").
