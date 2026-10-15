# Task: slice 2C, round 4 — redo item 3, finish the coverage gaps, two bounded reads; test-driven

You are working in the slice-2C copy (the current directory). The earlier rounds' work is **uncommitted in the working
tree — keep it**. This is a NEW session. No git write commands (reading with `git show`/`git diff` is fine), no network,
no real model calls. Throw-away files under `./.dsh-scratch/` (delete at the end); never `/tmp`. Finish within 100
minutes.

**This run is headless. When your turn ends, the whole run ends, and every subagent still running is killed.** After
starting subagents, stay in your turn until every one has reported (wait with `sleep 540`, then `list_agents`; repeat).

**Memory limits (binding):** at most 2 subagents at once; every vitest command adds `--maxWorkers=4`; one vitest command
at a time; the scale test runs alone with `--maxWorkers=2`; the full suite with `--maxWorkers=8`.

Read first: `./.dsh-ref/s2c-impl.md` sections 1–8 (they still apply), the frozen spec
`docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md` (row 2C-22 and §3.2, §3.6), the K spec
`docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md` (L4, L7, KA1, KA-14), and your last report
`./.dsh-ref/final-3.md`.

## 1. Item 3 (2C-22(2)) — lead ruling, replaces round 3's approach

Round 3 kept `missing`/`damaged` at attestation in `session-availability.ts`. That breaks K slice A's frozen behaviour
(SES-07/SES-10, LA-1, decision 51): an attested crash is written `kernel_turn_open` so that, **when the Kernel store is
readable again**, KA1 closes the Turn and the line comes back (KA-14). The 9 tests you listed are right. The bug 2C-22(2)
names is the other case: the store **stays** missing or damaged, KA1's closure fails `unreadable`, and today the line sits
as `kernel_turn_open` forever (maintenance leaves `kernel_turn_open` lines alone). The fix belongs where the Kernel is
actually observed:

1. Restore `src/core/work-graph/state/session-availability.ts` to its `slice-base` content
   (`git show slice-base:src/core/work-graph/state/session-availability.ts > that path`). Attestation keeps writing
   `kernel_turn_open`.
2. **Scope expansion approved (lead, 2026-10-15), only for this:** `src/core/agent-runtime/runtime.ts`, inside the
   `closeOpenTurn` closure. Where it returns `unreadable` because the mapped Kernel database file is missing (step 5,
   `kernelDatabaseState(...) === 'missing'`) or because the Kernel closure answers `unreadable` (damaged), first probe
   the Session with the same `owner.probe` that `settleHealth` uses; if the verdict is `missing` or `damaged`, record that
   probe through `closure.recordSessionHealth` (the health owner applies its own guards), then return `unreadable` as
   today. Any other probe verdict, or a refused/failed health write, changes nothing and still returns `unreadable`.
   If the health owner (`sessions/session-health.ts` → the session machine) refuses `unavailable/kernel_turn_open →
   missing|damaged`, **stop and report** with the refusal; do not change the session machine.
3. `src/business/workflow/session-maintenance.ts`: keep today's logic. After step 2, a pass whose KA1 closure was
   `unreadable` skips the line (its in-memory record still says `kernel_turn_open`); the next pass reads
   `missing`/`damaged` and today's retirement rule archives the line as retired. Only if that does not happen, change
   the smallest thing in maintenance and say why.
4. Tests (2C-22(2), on LE4): Kernel store deleted (`missing`) and, separately, damaged, while a Run is in progress →
   restart → outcome unknown → a person attests (RUN-22) → health `kernel_turn_open` (unchanged) → maintenance pass 1 →
   health `missing`/`damaged` → maintenance pass 2 → archived · retired; the line reads 已归档 · 已退役 and never
   returns to available or to "re-enable". The 9 tests from your last report (A8 host restart ×4, K-R attested facts
   ×3, K-W maintenance ×2) must pass **unchanged**; run them alone and report.
5. The lead amends the 2C-22 row in the spec (attestation first writes `kernel_turn_open`; an unreadable closure records
   the probe; the next maintenance archives). Do not edit the spec.

## 2. Coverage gaps left from item 13 (test-first; no product change unless a test shows a real bug — then report it)

- **2C-05 (1)(3)(3′)(4)(5):** write them through the registered check process exactly as the row says, even though the
  check process cannot run in this sandbox. Name the file `tests/scenarios/S2C-K-archive-tags-checks.test.ts` and put
  the reason in a comment at the top; the lead runs it under bwrap. Report them as "written, not run here".
- **2C-21:** the Query variant, the `missing`/`damaged` variants and the `legacyPending` variant.
- **2C-22:** the T2 variant, the goal-card variant (`unknown_outcome` reason card lands on the responsible line,
  `objects` empty, task pin in `source.pins`), and the `kernel_turn_open` variant.
- **2C-39 (4)** and **2C-28** with each of the five `next` kinds.
- If a case cannot be built through public services (or the documented LE exceptions), do not fake it: write the row,
  the case and why, and move on.

## 3. Two bounded reads (the reviewers' residuals from round 3)

- `views/node-detail-reader.ts`: participants, file risks and executions page with an **offset** cursor over a list
  built in memory, so every page reads everything before it. Page by the underlying index/lookup cursor (2A's ordered
  lookup), one bounded read per page; a malformed or foreign cursor → `invalid`, `cursor_mismatch`. Keep the public shapes.
- `hover` calls `readTaskArchiveState` once per task: bound it (read the archive state once per line, or batch by the
  existing lookup) and count it in the shared cost as L1b says; show it with a test that counts store calls.

## 4. Checks

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`;
targeted vitest (`--maxWorkers=4`); the scale test alone (`--maxWorkers=2`) and report m, r, w; the full suite
(`--maxWorkers=8`) and compare against `DSH-BASELINE.md` §A — list every failure that is not in the baseline. Check the
frozen hashes as before.

## 5. Reply

Sections: FILES CHANGED, ROWS (only the rows you touched), ITEM 3 (what the probe/record does, which tests, the 9 tests'
result), GAPS (each case: test name, or "cannot build: why"), BOUNDED READS (test names, store-call counts before/after),
CHECKS (commands and results; failures outside the baseline with id and first failing line), UNSPECIFIED, NOTES.
