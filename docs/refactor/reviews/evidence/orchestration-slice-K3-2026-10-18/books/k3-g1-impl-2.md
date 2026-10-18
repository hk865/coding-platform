# Task: K3 group 1, part 2 — finish and check what the first session built (it stopped at the context limit)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The first session
of K3 group 1 built most of the group and was stopped when its context ran over the limit, before it could reply. Its
work is in the working tree (uncommitted). Continue it; do not redo it.

**This run is headless. When your turn ends, the whole run ends.** You may start one subagent (for item 4). Stay in your
turn until it has reported (wait with `sleep 300`, then `list_agents`). **Keep your context small:** `git status`,
`git diff --stat`, `grep -n`, `sed -n a,bp`; never print whole files or whole diffs; the spec is ~1,770 lines.
**Finish within 90 minutes** (the run stops at 100).

## 1. Inputs

- The first session's book `./.dsh-ref/k3-g1-impl.md` (sections 1–8 stay binding, including section 8's answers).
- The K3 spec `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`: only the rows and rules you need.
- What is already in the tree (from `git status`): new `src/contracts/{unknown-call-review,command-rerun-request}.ts`,
  `src/core/work-graph/model/{unknown-call-review,command-rerun-request}-contracts.ts`,
  `src/core/work-graph/state/{command-normalization,command-rerun-request,review-lease,unknown-call-kinds,unknown-call-review}.ts`,
  edits in the state machines and contracts, and new tests `tests/state/{command-normalization,command-rerun-request,
  k3-failure-classification,k3-review-claim,k3-run-reconcile,review-lease,unknown-call-kinds,unknown-call-review-streak,
  unknown-call-review}.test.ts`.
- The lead checked the small edits outside group 1's file list and accepts them (closed unions that must list the new
  values): `workflow.ts` (`gateStopAdvice`), `execution-driver.ts` (exported tool-name sets), `observed-model-run.ts`
  (`EXPLORATION_TOOL_NAMES`), `views/decision-read-model.ts` (`identityScopeProblem`), and the table entries added to
  `tests/state/no-progress.test.ts` and `tests/state/session-availability.test.ts`.

## 2. State the lead measured (normal WSL, outside the sandbox)

- `tsc -p tsconfig.json`: 5 errors, all in `tests/state/k3-review-claim.test.ts` (lines 75, 112, 113, 132: reading
  `reason`/`code` on a `Transition` without narrowing, `result.next` possibly null).
- `tests/state` + `tests/architecture`: 3,867 passed, 3 failed, 29 skipped:
  - `tests/architecture/production-reach.test.ts`: 19 unreached declarations (the new modules; groups 2–4 wire them);
  - `tests/state/session-availability.test.ts` "lists exactly the causes step 5.6 adds": the computed list now also holds
    `reconcile_takeover_unresolved`;
  - `tests/state/invariants.test.ts` (suite) and `tests/state/invariants-fuzz.test.ts` "coverage …": these fail on the base
    too and are in `DSH-BASELINE.md` (lines 155–156). Leave them.

## 3. Items (in order)

1. Fix the type errors in `tests/state/k3-review-claim.test.ts` by narrowing the results the way the other state tests do
   (assert `ok`, then read). Do not change what the tests assert.
2. Production reach: add the unreached declarations to `tests/architecture/production-reach-allowlist.json` in its
   existing format, each with the reason "K3 group N wires it" (N per spec §7: 2 for the classifier, RUN-25 and the
   recognition entry; 3 for the review owner, tools and the review round; 4 for cards, dispositions, CRR, the hook and the
   Workflow). The lead reviews them.
3. `tests/state/session-availability.test.ts` "lists exactly the causes step 5.6 adds": the lead allows one change: the
   computed list excludes `reconcile_takeover_unresolved` (it is K3's, not step 5.6's). Its K3 behaviour is asserted in
   K3-30 (SES-06 from RUN-25); make sure K3-30 has that assertion.
4. Coverage audit (a subagent may do it, reading only): for each row K3-30, K3-31, K3-32, K3-33, K3-34, K3-36, K3-38,
   B2-10 and the CRR rows CRR-01 … CRR-07 (pure transitions), list every case the spec row names and the test that
   asserts it. Write the missing assertions (TDD: a missing case is a failing test first if the code lacks it).
5. Checks: `tests/state/`, `tests/architecture/` with `--maxWorkers=3`; `npm run typecheck`, `npm run check:architecture`,
   `npm run build`. Do not run the full suite.

## 4. Rules

Same as the first book (section 4): R5 only, no database, literal hand-computed expectations, `state/` stays pure (no
`node:crypto`; `sha256Hex` from `src/contracts/fingerprint.ts`), no real model calls, no git writes, probes under
`./.dsh-scratch/` deleted at the end.

## 5. Reply

Under 900 words: FILES CHANGED for the whole group (production / tests, new production line count from `git diff --stat`
and the new files); per row (K3-30 … K3-38, B2-10, CRR-01 … CRR-07) done or not with the test names; the coverage table
from item 4 (case → test); the allowlist entries; CHECKS with numbers; the RunGuardContext field names you (or the first
session) added for U1; UNSPECIFIED.
