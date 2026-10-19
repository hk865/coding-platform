# Task: decision 85-5 — two small fixes, test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The rules below are
the lead's and binding; do not make design decisions. Where they do not determine something, choose nothing: list it
under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents (the task is small). Keep your
context small: `grep -n`, `sed -n a,bp`, never whole large files. **Finish within 40 minutes** (the run stops at 50).

## 1. What this copy is

`slice-setup` = the lead branch at `0e1a9386`: cleanup C1 merged, decision 85 recorded. Background: `docs/refactor/HANDOFF.md`
decision 85, item 85-5 (both defects), and decision 70 (the line "顺带发现的缺陷").

## 2. Fix A — `readGoalDecisionCauses` honours `atLeastCursor`

**Production file:** `src/core/work-graph/tasks/goal-decision-reader.ts` only.

**Spec:** `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md` §4.2: the signature at :817–818 takes
`atLeastCursor?`; :829 says every adapter receives the same `atLeastCursor`. Today the reader accepts it and never uses
it, so it never answers "not read that far yet" (`not_ready`).

**Rule (lead):**

1. `input.atLeastCursor` absent: nothing changes — the same store reads in the same order, the same results.
2. Present: compare it with the `readThrough` that the Goal read already returns (`readGoalRecord`, its
   `records.readMany([key])`, `:118`). Use the existing `atLeastCursorResult(observed, required)` in
   `src/core/work-graph/persistence/read-result-failures.ts:22`; do not write a new comparison. When it returns a result,
   return that result (`not_ready`, `observed` = the Goal read's `readThrough`, or `null`). **No extra store read.**
3. Order inside `readGoalDecisionCauses` (`:425`): the project check → the Goal read (its rejections unchanged) → the
   workspace check → **the new check** → everything after it unchanged. So `forbidden`, `not_found` and `unavailable`
   still win over `not_ready`.
4. Why the Goal read is enough: every later read in this method happens after it, so a Goal read at or past the
   required position makes the whole result at least that new. Say this in one short comment at the check.
5. `readGoalRecord` may hand back the `readThrough` with the Goal; its other callers, if any, behave exactly as before.

**Tests:** new file `tests/work-graph/S5-goal-cause-at-least-cursor.test.ts`, test names start with `D85-5a`. Reuse the
world that `tests/work-graph/K3-18-autonomy-facts.test.ts` builds (it calls the reader over real records at `:130`) or
`tests/helpers/S5-application-support.ts:101`; do not build a new store fixture.

1. Ask for a position past the store's last commit → exactly
   `{ status: 'not_ready', observed: { kind: 'platform', cursor: LAST }, required: { kind: 'platform', cursor: ASKED } }`.
   `LAST` comes from the fixture's own last commit result, or `makeCommitCursor(n)` with `n` counted by hand from the
   fixture's commits — never from the reader. **This case must fail before the fix** (today it returns `ready`).
2. Ask for exactly `LAST` → `ready`, the value deep-equal to the same call without `atLeastCursor`.
3. Ask for an earlier cursor → `ready`, the same value.
4. A Goal of another project + a position past the end → `forbidden`; a Goal that does not exist + a position past the
   end → `not_found`. If the world already has a Goal in another workspace of the same project, add that case
   (→ `forbidden`); do not build one.

Cases 2–4 pass before and after the fix (they pin the order); write them after case 1 is green.

## 3. Fix B — `makeCommitCursor` refuses sequences longer than ten digits

**Production file:** `src/contracts/ledger.ts` only.

`makeCommitCursor` (`:103`) pads to ten digits, but a sequence of 10,000,000,000 or more makes an 11-digit cursor that
`seqOfCommitCursor` (`:109`, `/^c(\d{10})$/`) rejects. **Rule:** `makeCommitCursor` throws the same error it throws today
(`invalid cursor sequence: <n>`) for a sequence above 9,999,999,999, so every cursor it makes reads back. Nothing else
changes (the padding, the check below 1). Update the comment above it: ten digits; larger sequences are refused.

**Tests:** new file `tests/contracts/ledger-cursor.test.ts`, names start with `D85-5b`:

1. `makeCommitCursor(10_000_000_000)` throws `invalid cursor sequence: 10000000000` — **fails before the fix**.
2. `makeCommitCursor(9_999_999_999)` is `'c9999999999'`, and `seqOfCommitCursor` of it is `9_999_999_999`.
3. `makeCommitCursor(1)` is `'c0000000001'`.

## 4. Rules

- **TDD:** follow `./.dsh-ref/tdd/`: one test first (it must fail for the right reason), then the smallest change, then
  the next.
- Through public interfaces; no reading the database to check results; expected values literal or counted by hand.
- Existing tests, helpers and fixtures stay unchanged; `tests/architecture/production-reach-allowlist.json` unchanged.
  Production changes only in the two files above. If an existing assertion fails, do not edit it: report it.
- State transitions are not touched. No real model calls, no git writes, never ports 3080/3099/44797. Throw-away probes
  under `./.dsh-scratch/`, deleted at the end; never `/tmp`.

## 5. Checks (keep the machine light)

- With `npx vitest run --maxWorkers=2`: your two new files; the files that use the reader
  (`tests/work-graph/S5-decision-queue.test.ts`, `S5-decision-application.test.ts`, `K3-18-autonomy-facts.test.ts`,
  `K3-18-requeue-confirmed.test.ts`, `WP2-context-extensions.test.ts`); `tests/contracts/`.
- Once at the end: `npm run typecheck`, then `npm run check:architecture`.
- **Do not run the full suite** (the lead does).

## 6. Reply (plain Chinese, under 200 words)

The files changed with added/deleted lines; the tests added (names), which ones failed first and why; the checks run
and their results; anything under UNSPECIFIED.
