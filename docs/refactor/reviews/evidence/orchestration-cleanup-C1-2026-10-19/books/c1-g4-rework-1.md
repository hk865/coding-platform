# C1 G4 rework 1 (lead, 2026-10-19)

Do not end your turn until every subagent you start has reported back. **This run is headless: when your turn ends, the whole run ends.** Finish within 60 minutes (the run stops at 70). Coordinator mode (`./.dsh-ref/coordinator-mode.md`); split by FILE so running subagents never edit the same file.

- **Memory (binding):** an earlier C1 run was killed at 8 GB because five subagents ran `tsc --noEmit` at the same time (about 1.8 GB each). Only you, the coordinator, run `npm run typecheck`, never two at once, and not while a subagent is running tests. Subagents only run their own dependent test files with `npx vitest run --maxWorkers=2`. Start at most three subagents at once.
- **Working root:** this copy, branch at tag `c1-g4-r1-lead` = G4's first run (`c1-g4-r1`) plus two lead fixes (run-state's success result no longer carries `scope`; two `R10 (review item 10)` tags removed). Count lines against `c1-g4-r1-lead`, and also report the total against `c1-g1`.
- **What you are fixing:** Codex reviewed G4 (`./.dsh-ref/c1-g4-review.out.md`): no other behaviour difference; the items below are left. The book (`./.dsh-ref/c1-book.md`), G4's run file (`./.dsh-ref/c1-run-g4.md`) and G1's frozen interfaces (`./.dsh-ref/c1-g1-interfaces.md`) still apply; rule 1 (byte-identical behaviour) is the bar. Do not touch any file G4 did not own; G3 is running in another copy on top of `c1-g4-r1` and imports `terminalProposalOf` from `tasks/plan-readers.ts`, so that function's signature and behaviour must not change.

## Items

1. **The signal check goes back to each entry** (refresh TA-1, `./.dsh-ref/c1-refresh.out.md:115`: "claim 的 signal 判断允许带相应属性的数组，另外三份排除数组，这一步留在入口"). Remove the `allowArraySignal` flag from `tasks/trusted-context.ts`. Each of the four callers (claim, execution-history, run-state, execution-entry) supplies its own signal check — a function it passes in, or its own check — and the shared code runs it at the same place as today: after the scope check, before the principal / material-reader clone. Same rejection text and code as today for each caller; claim still accepts an array carrying the signal properties, the other three still reject arrays. No other change to `trustedContextOf` or `isolatedWriteOf`.
2. **Finish the B wiring in G4's files** where the local code is the same implementation as G1's shared one (`c1-g1-interfaces.md`). Codex found these left (line numbers at `c1-g4-r1`; find them by the function):
   - nullable canonical JSON → `canonicalOf`: `tasks/completion.ts:105`, `tasks/control-service.ts:190`, `tasks/run-state-service.ts:119`;
   - nullable JSON object parse → `parseObject`: `tasks/execution-entry-service.ts:144`, `tasks/plan-readers.ts:131`, `tasks/run-state-service.ts:122`;
   - integer checks → `isInt` / `isNonNeg` / `isPos`: `tasks/completion.ts:112`, `:115`;
   - generic rejection builders → `rejected` / `rejectedWithCurrent` / `rejectedWithNonEmptyCurrent` / `okFalse` by shape: for example `tasks/claim-service.ts:115`, `tasks/context-input-service.ts:106`, `tasks/initial-plan.ts:40`; check the other G4 files for the same pattern.
   Before each switch, compare the body: a copy that throws instead of returning `null`, has a `minimum`, adds or drops `current` differently, or carries a fixed business text or field stays as it is (book §5). Keep each caller's narrow types. List every copy you leave and why.
3. **The interface table, complete** (book §5): for each helper G4 created — full parameter types, return type (`waitPredecessorWalk` is async: give its `Promise<...>`), `TaskPhaseFacts`'s six fields in order, and for `terminalProposalOf` the G3 precondition (the view filters its superseded candidates first and keeps its live branch and fallback; see `./.dsh-ref/c1-g4-interfaces.md`). Correct the earlier claim that every wrapper's success fields were kept (run-state's was not; the lead fixed it).

## Checks before you finish

`npm run typecheck` (coordinator, once, at the end); `npm run check:architecture`; `npx vitest run --maxWorkers=2` on every test file that depends on a changed file (book rule 4) and `tests/architecture`. Production reach may still fail only for `okFalse` (G3), `sessionStoreFailureToRejection` (G2), `ownerWriteStoreFailureToRejection` and `ownerReadStoreFailureToRejection` (G5). No bubblewrap here: failures that only say `/usr/bin/bwrap` is missing are environmental; say so.

## Reply

A summary under 200 words, then: a per-item table (done / partly / left, why), the list of copies left with the reason for each, the complete interface table, the tests run with results, the remaining production-reach list, and the changed lines (added + deleted against `c1-g4-r1-lead`, net; and the total against `c1-g1`; untracked new files counted).
