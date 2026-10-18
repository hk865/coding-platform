# Task: K3 group 1 — contracts, state machines and pure functions (R5); test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec and the
lead's decisions are binding; do not make design decisions. Where they do not determine something, choose nothing: list
it under UNSPECIFIED with the smallest options, and go on with the next item.

**This run is headless. When your turn ends, the whole run ends.** You may start subagents (at most 2 at a time). Stay
in your turn until every subagent has reported (wait with `sleep 300`, then `list_agents`), and only then reply. Keep
your own context small: `grep -n`, `sed -n a,bp`, never whole large files (the spec is ~1,770 lines). **Finish within
200 minutes** (the run stops at 210): do the items in order and finish whole items; an unfinished item is reported,
not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch at `6f900eaa`: everything through 4B merged; the K3 spec frozen as its eighth draft
  (`docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`), decisions 66–71 in `docs/refactor/HANDOFF.md`.
  `slice-base` adds `DSH-BASELINE.md` (tests that fail in this sandbox only).
- K3 is built in four groups (spec §7), each a new DeepSeek session. **This is group 1**: the contracts, the state
  modules and the pure functions, tested through R5 (pure state transitions) and one unit-test file. Nothing in this
  group touches the RecordStore, the services, the Runtime, the Host or the Workflow; groups 2–4 do.

## 2. Inputs (inside this copy)

- **Binding:** the K3 spec: §1 (the rules your items cite: L3, L7, L8, L9, L10, L11, L14, L17, L19a, L23 and the M1/M3
  notes), §2 (all types and the pure-function signatures: use these names), §3 (the state rows: 3.1 RUN-25 and the review
  claim rows, 3.2 UCR, 3.2b CRR, 3.3 TD-9, 3.5), §4 rules, §5.1 R5, §5.2 rows **K3-30, K3-31, K3-32, K3-33, K3-34,
  K3-36, K3-38, B2-10**, §6 (file list), §7 group 1. Background on how the eighth draft came about:
  `./.dsh-ref/k3-v8-lead-decisions.md`, `./.dsh-ref/k3-v8b-lead-decisions.md` (the spec wins).
- The TDD skill: `./.dsh-ref/tdd/`.
- State transitions must go through `src/core/work-graph/state/` (root `AGENTS.md` rule 9); the state-writes check in
  `tests/architecture/` must pass.

## 3. Scope of group 1 (spec §6 and §7 item 1)

- **Contracts:** new `src/contracts/unknown-call-review.ts` (incl. `WorkspaceBaselineV1`, `WorkspaceChangeCaptureV1`);
  `src/contracts/dispatch.ts` (`purpose`, `takeover_unresolved`, `unresolved.autoCleanupBlockedBy`);
  `src/contracts/core/prepared-execution.ts` (the `workspaceBaseline` reference, `unknownCallReview` with aliases and
  `display`, `blockedCommands` with `{ reviewRunId, alias, commandSha256 }` only); new
  `src/contracts/command-rerun-request.ts` (`CommandRerunRequestV1`, its states, `declaredForms`, `match`, the three index
  names); `src/contracts/goal-decisions.ts` (the source kinds and identities incl. `command_rerun_request`,
  `decisionSourceKey`); `src/contracts/task-failure.ts` (the stop cause, `reviewStatus`, `reviewHold`, the failure facts'
  `unknownCallReview`). The continuation-brief changes are group 3/4 (not yours).
- **State:** new `state/unknown-call-review.ts` (the UCR table, `lastHolderOf`, M3's admission by serialised size with
  R = 365,536 and B = 158,720, the `too_large` type); new `state/unknown-call-kinds.ts` (L3's table); `state/review-lease.ts`
  (`leaseReleasedForContinuation`, `isUnenteredReviewRoundForCancellation`); new `state/command-rerun-request.ts` (the
  CRR table CRR-01 … CRR-07 as pure transitions); new `state/command-normalization.ts` (`normalizeCommandText`,
  `commandSha256`, `parseShellActions` with the six rules and the word-array action key; written by hand, no new npm
  dependency); the edits named in §6 for `run-machine.ts`, `task-machine.ts`, `attempt-machine.ts`, `goal-machine.ts`,
  `session-availability.ts`, `decision-policy.ts`, as far as rows K3-30 … K3-38 need them.
- **Model contracts** that only declare types for the above (`model/unknown-call-review-contracts.ts`,
  `model/command-rerun-request-contracts.ts`, `model/execution-entry-contracts.ts`'s `HostInstanceFacts.takeover`) may be
  added now with types only (no implementation).
- **Not in group 1:** codecs, services, owners, the Runtime hook, the Host, the Workflow, routes, the continuation brief,
  fixtures (Codex writes the §5.1 seams in parallel for groups 2–4).

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change, then the next. Follow
  `./.dsh-ref/tdd/`. Test names start with the row id (`K3-31 …`, `B2-10 …`); a row that lists several cases has an
  assertion for each.
- **R5 only:** call the pure functions and machines directly; no RecordStore, no services, no database. B2-10 goes in the
  new `tests/state/command-normalization.test.ts`. Expected values are literal and hand-computed (for `sha256` values,
  compute them in the test from the literal input with `node:crypto`, never with the product's `commandSha256`).
- Existing tests stay unchanged. Any existing assertion that fails: do not edit it; report it under UNSPECIFIED (test
  id, assertion, the rule, a minimal counter-example) and go on.
- No real model calls, no git writes, never ports 3080/3099/44797. Throw-away probes under `./.dsh-scratch/`, deleted
  at the end; never `/tmp`.
- **Line budget (decision 69):** about 1,600 new production lines for this group (soft); report the actual count; over
  needs a reason.

## 5. Order and priority

1. Contracts (all of section 3's contract files), then `state/unknown-call-kinds.ts` with K3-34.
2. `state/command-normalization.ts` with B2-10 (a subagent may take this item: its own file and its own test file).
3. UCR table and M3 admission with K3-31 and K3-32; `lastHolderOf`.
4. RUN-25 and the review claim rows with K3-30, K3-36, K3-38; TD-9 and the failure classification with K3-33.
5. The CRR table (pure transitions) — its state rows are tested in group 4 through the owner; here only what B2-09's
   pure replay part needs.

When time runs short: finish 1–4; leave 5 and report it.

## 6. Checks (the machine is shared with another DSH run: keep it light)

- Run only the files you touch while working, with `--maxWorkers=2`.
- At the end, once: `tests/state/`, `tests/architecture/`, with `--maxWorkers=3`.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- **Do not run the full suite.**

## 7. Reply

Under 800 words: FILES CHANGED (production / tests, with the new production line count); per row (K3-30 … K3-38,
B2-10) done or not, RED → GREEN; CHECKS with numbers; UNSPECIFIED (short, with options); anything that surprised you.

## 8. Answers to the read-through (lead, 2026-10-16 18:35; binding like the sections above)

- **U1 RUN-25 facts:** (a). The candidate gains `unresolvedCalls: { callId: string; toolName: string }[]`; the machine
  maps names to kinds with `state/unknown-call-kinds.ts` (G3) and reads the other WorkGraph facts (pointer pause,
  inputs confirmed, Session, streak, inventory: G4, G5, G7, G9, G11) from `RunGuardContext` fields you add now with
  names taken from L25's guard names; group 2 fills them. List the field names in your reply.
- **U2 SES-06:** add a new `SessionReleaseCause` value `reconcile_takeover_unresolved` for RUN-25 (do not reuse
  `reconcile_terminal`).
- **U3 ATT-16:** add `leaseRelease?: { releasedBy: RunRef; releasedByPurpose: <the Run purpose type from §2> | null }`
  to `AttemptClaimBasis.requeue` and to `ClaimRequeueFacts`; `leaseReleasedForContinuation` takes it; keep the old
  boolean only where existing callers still need it, and report where.
- **U4 `automationConfirmationCause`:** make `requeueConfirmedByReview` optional, default `false`; group 4 wires it.
- **U5 failure facts:** add optional `reviews?: UnknownCallReviewV1[]` to `WorkFailureInputV1` and a pure
  `streakOf(run, runs, reviews)` in `task-failure.ts`; the reader wiring is group 4.
- **U6 names:** `newUnknownCallReview(input)` and `admitUnknownCallReview(record, { required })` in
  `state/unknown-call-review.ts`.
- **U7:** export `isGoalStopCause` from `goal-machine.ts`.
- **U8:** if any segment is `unparsed`, the whole command is `unparsed` (rule 6 literally).
- **`node:crypto` in `state/`:** your reading is right: `state/` is a pure directory. `commandSha256` and the action key
  use `sha256Hex` from `src/contracts/fingerprint.ts`. Tests (outside `state/`) compute expected digests with
  `node:crypto` from literal inputs.
- **`GoalStopCauseCode`:** also exclude `unknown_call_review`.
- **Production reach:** add entries for the new modules to `tests/architecture/production-reach-allowlist.json` in the
  existing format with the reason "K3 group N wires it" (N = the group that will reach it); the lead reviews them and
  removes each when its group lands. This is the only allowed change to an existing test file in this group.
- **Time:** your order is accepted; the limit is raised to 200 minutes (the run stops at 210). The CRR table stays last.
