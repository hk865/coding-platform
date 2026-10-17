## Reply

**Files changed (tests only; `git diff -- src/` empty):**
- NEW `tests/work-graph/S4C2-m12h-store-fault.test.ts` (+63)
- `tests/work-graph/S4C2-update-due.test.ts` (−83): deleted damaged-pointer Part 2
- `tests/work-graph/S4C2-goal-triggers.test.ts` (−23): deleted tamper-only `3g`; deleted `3f` (now covered by public M-12h); kept `3a–3e, 3h` (trigger shapes with no public equivalent)
- `tests/helpers/S4A-note-fault-fixture.ts` (+15/−): lookup fault takes `code:'unsupported'` (default `unavailable`); `notes` widened to `NoteMemoryReadPort`
- `tests/app/S4C2-scribe-reminders.test.ts` (+45): new claimed→no-send test
- `tests/helpers/S4A-note-fixture.ts` (+11/−): `claimInSession` optional `requeueRef`

**Item 1 RED→GREEN:** mutated `plan-readers.ts` ~1282 so a non-ready Run-index read (`unsupported`→`incomplete`) became `ready` empty; `S4C2-m12h-store-fault.test.ts` failed (received `ready`) → restored exact line → passed. New test: real fixture goal/plan + real understanding via `f.write`; one `r3c-run-by-goal` lookup returns `unsupported`; `memoryLookup` on the goal anchor is `rejected/unavailable`; disarm re-read is `ready`.

**Item 2 RED→GREEN:** removed `!row.claimedArchiveKeys.has(trigger.key)` at `note-scribe-todos.ts:230`; new test failed at `expect(goal.immediate).toBe(false)` (got true) → restored → passed. Flow: real `workflow.archiveLine`; real `requeueRef` from `queryTaskGraph`; new executor line claims t1 via `claims.claimTask(requeueRef)`; `readExecution` confirms it; then `hasArchiveTrigger` true, `immediate` false, real Host sends nothing, inbox empty.

**Checks (`--maxWorkers=2`):** work-graph/S4C2-* 7 files/67 passed; app/S4C2-* 1/13 passed; work-graph/S4A-* 7/202 passed; architecture 4/53 passed; typecheck exit 0. `A2-requeue-platform` 5/5 fail — environment only: no bwrap/cgroup-v2 (`probeResourceCaps no_cgroup_v2`, `bwrapPath:null`), so registered checks never start and rounds stay `verification_running`; it imports none of the changed files.

**UNSPECIFIED:** A2 on a bwrap+cgroup host unverified here.