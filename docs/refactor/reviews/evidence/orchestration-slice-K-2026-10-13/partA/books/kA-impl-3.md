# Task: K slice part A — third session: two regressions that only show with real bubblewrap

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Two earlier
sessions implemented part A of the K slice in this copy; the work is in the working tree (not committed). With real
bubblewrap the lead ran the full suite after round two: 3 tests fail. In your environment these tests fail earlier for
sandbox reasons (they are on the `DSH-BASELINE.md` sandbox list), which is why round two could not see them. The lead
diagnosed both with bubblewrap; the decisions below are exact. This session makes exactly these changes.

**This run is headless. When your turn ends, the whole run ends.** Work alone (no subagents needed) and end your turn
only after the checks of section 4 and the reply of section 5.

## 1. Material (inside this copy, excluded from `git status`)
- `./.dsh-ref/kA-impl.md` — the first brief (sections 1–5 and 8 still apply). `./.dsh-ref/r2/` — the round-two review.
- `./.dsh-ref/tdd/` — the TDD skill.

## 2. Lead decisions (binding)

**D7 — an unreadable identity read makes prepare wait (code defect; spec L9, round-two D1, scenario W-25).**
`src/core/agent-runtime/continuation-brief-assembly.ts` around line 302–307 turns an `unsupported` or `unreadable`
answer of `readTurnBounds` into a degraded brief (`{ kernel: 'unavailable', … }`), so prepare answers `ready` and pins
a degraded brief. Change it to the retry outcome:
```ts
return { kernel: 'retry', code: 'unavailable', reason: bounds.reason };
```
so prepare answers `rejected` / `unavailable`, pins nothing, and the Workflow waits (as round one did through
`readPositionWindow`). With bubblewrap this makes `tests/scenarios/C3-brief-idempotency.test.ts` "C3-R2 (W-25) …
host_config …" and "C3-R2 (W-25) with a transient Kernel read …" pass (the lead verified this). No K test depends on the
degrade path.

**D8 — only look up the Turn when it can be interrupted (narrowing, spec L9 "其它情况照今天").** In `readPreviousTurn`,
a previous Run whose position record has a non-null `endPosition` cannot be an interrupted Turn: use today's path
(`readPositionWindow`, as round one) and do not call `readTurnBounds`. Call `readTurnBounds` only when the previous Run
has no `endPosition` (the interrupted or unknown case). Test-first: add a composition/Runtime case (no bubblewrap
needed) where a same-Session continuation follows a normally completed Run while the injected `readTurnBounds` is
absent, and the brief is still built (today's behaviour); it fails before D8 because the call refuses.

**D9 — clearer reason for an unregistered store.** In `src/core/agent-runtime/session-operations.ts` around
line 1023–1025, the null-location case (a Kernel store this Host has not registered, i.e. `host_config`) keeps its
status but its reason becomes `the Session Kernel store is not registered by this Host` (not "legacy or another
adapter"). Do not change any status.

**D10 — KA-09 test stops where it means to (test defect).** In `tests/scenarios/K-R-interrupted-brief.test.ts` line
~110, the drive uses `stopBefore: 'observe'`, but this flow never emits `observe` (the `start` step runs the Turn to its
end), so with bubblewrap the drive continues through checks and later Runs and the test reads another Run's brief.
Replace with:
```ts
const driven = await driveChecked(second, inv, selectWork('kr09-continue', true), { stopBefore: 'open_checks' });
expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops after the continuation Run').toBe('open_checks');
```
and update the comment above it (lines ~107–109) to say the drive stops right after the continuation Run, before its
checks. Add the same kind of "the drive stopped where intended" assertion to any other new K test you wrote whose
`stopBefore` step might not occur (check each `stopBefore` use in the new K files; report what you found).

Spec qualification the lead records (no code): a same-Session continuation whose previous-Turn identity read stays
unreadable (including permanent damage) keeps waiting; the operator resolves it by archiving or attesting the line.

## 3. Rules
Test-first for D8. No git write commands; one vitest command at a time; no real model calls; no network; do not touch
ports 3080, 3099, 44797; probes only under `./.dsh-scratch/`, deleted at the end. No edits to the frozen files.

## 4. Checks
Run exactly the commands of the first brief section 8. Expected (no bubblewrap here): as round two (every new K test
passes; the 14 frozen files and the regression run fail only as in `DSH-BASELINE.md`, NEW = 0; frozen sha256 values
hold; typecheck, architecture, build and kernel-patch check exit 0). The two C3-R2 tests still fail here for the
sandbox reason; the lead runs them with bubblewrap.

## 5. Reply
The first brief's reply format (FILES CHANGED, ROWS, CHECKS, UNSPECIFIED, NOTES), plus **REVIEW:** D7–D10 each: done /
not done (why), with file:symbol and test names.
