**M-12 updateDue / latestTriggerCursor and scribe reminders: proposal for the slice-4C addendum**

## 1. FACTS

**Spec**
- L9: updateDue applies only to a current understanding. It counts from that understanding's last *text* version; a review does not reset it. Triggers are a task ending, rework, a new plan adopted, a Session archived, or regroup.
- L16 / rule 19: the dedupe key is the set of `(anchorKey, latestTriggerCursor, ownerSessionKey)`. Thresholds are 10 pending and 5 due. A manual archive with no agent present sends a reminder at once.
- §2 types `UnderstandingStatusV1.updateDue` as `boolean`. §10 P3 makes it `boolean | null`, and 4B always returns `null`.
- M-12 also counts anchors that have no understanding. A stage counts only its own tasks.
- DESIGN §3.5 says "one indexed read per goal".

**Code today (1e0b1383)**
- The field is null everywhere:
  - `note-read-model.ts:1025-1032` (`understandingOf` always sets `updateDue: null, latestTriggerCursor: null`).
  - `note-views.ts:989` (`updateDue: null`).
  - `note-contracts.ts:159-162`.
- A note's text never changes after it is written: there is no edit operation, and changing a note means writing a new one that replaces it. So "last text version at" equals `NoteHead.createdAt` (`note.ts:86`, set at `note-service.ts:873,891`). Review, accept and withdraw only add versions with a new `at` (`note-service.ts:1029-1036`).
- Accepting an understanding supersedes the note the pointer leaves, in the same commit (`note-service.ts:569-602`). Withdraw does not move the pointer, so the pointer can end up on a withdrawn note.

**The facts file, checked claim by claim**
- Cursor format and `sameCursor`/`laterCursor`: correct (`ledger.ts:107`, `plan-readers.ts:346-363`).
- `terminalCause` and `finishedAt` (`plan-readers.ts:1955-1978`): correct, with one caveat. They live inside the *per-task* `createSessionResponsibilityBasisReader` (`:1901`). That reader calls `readCanonicalTaskFacts` for one task, which also reads round chains and reverify refusals. It cannot be reused cheaply for a pass over a whole goal.
- `TaskReduction` is read by key (`taskRecordRefKey`, `:1121`). `reducedAt` moves forward on every re-reduction (`reduction.ts:56-57,72`).
- `TaskRequeue` has `since` and `requestedAt` (`task-requeue.ts:193`). Its only index covers the whole project (`claim-record-codecs.ts:62-74`). Per Run it is read by key (`plan-readers.ts:1312-1322`, `readReworkRecords`, not exported).
- An archive-caused requeue carries `archiveOrigin.archiveSessionRef` (`session-anomaly.ts:38-42`, `session-archive.ts:582-587`). It exists only when the archive stopped a running Run or a wait.
- `PlanRevision.acceptedAt` is correct (`plan-service.ts:1710`).
- There is no index from a goal to its Sessions. `session-links-by-task` needs all 5 values (`session-record-codecs.ts:965`, `lookup-index.ts:166`), so it would take one lookup per task.
- Regroup does not exist anywhere in `src/` (grep finds nothing).

**Clocks**
- These times all come from the injected composition clock (`create-platform.ts:502`): note `createdAt`, `acceptedAt` (`plan-service.ts:1710`), `reducedAt` (`completion.ts:445`) and `requestedAt` (`requeue-service.ts:1045`).
- `Session.archivedAt` uses the wall clock, `new Date()` (`session-lifecycle.ts:321,1317`), so it cannot be compared under an injected test clock.
- All are ISO strings, compared as text. Timestamps are in milliseconds, so ties are possible, and the clock is not guaranteed to only move forward.

**Heartbeat today**
- `attention-observer.ts:514-523` emits a heartbeat only when `pendingInputs > 0`. The scanner always returns `pendingInputs: 0` (`:716-718`), so in production no heartbeat signal is ever sent.
- `host.ts` runs the loop only for scopes configured in `options.attention`, and only when it holds the instance lease (`:144,1149`). Each scope sends to one fixed `targetSession` (`:1202`).
- Timing uses `Date.now()` (`:1164,1201`). The request id is a hash of the delivered content (`:1223-1228`). A delivery counts as processed only after the receiving execution finishes (`:1173-1195`).
- Nothing finds a scribe or counts notes. Goal and stage anchors always map to the project scope today (`scribe-scope.ts:239-243`). A project scribe is a `scribe`-duty Session with no open module link (`:212-219`).

## 2. GAPS

1. Time or cursor, strict or non-strict comparison, and what happens on a tie.
2. The stage anchor key contains the plan revision (`note-anchors.ts:389`). After a replan, `stage@M` has no understanding, and `stage@N` can never be cleared by writing again: a new write goes to `stage@M`. The lead's rule "stage planRevision mismatch → due" would therefore keep `stage@N` due forever.
3. The no-understanding case. If the first plan adoption counts, every new goal is due the moment its plan is adopted.
4. A pointer that sits on a withdrawn or rejected note.
5. Which archives count. Using `archivedAt` costs one lookup per task and mixes the two clocks.
6. Which stage a task belongs to: `task.stageId` (`graph-context-reader.ts:1057`) or `scope.stageId` (`node-detail-reader.ts:232`, `decision-policy.ts:152`).
7. Where it is computed, so that lookup, the check, the assembler and the heartbeat do not each recompute it.
8. Who receives the reminder when there are several project scribes. How often reminders may be sent, and what "no agent present" means.
9. What `latestTriggerCursor` actually holds.

## 3. PROPOSAL

**Triggers for goal g** (the active plan is M; only tasks in M count):
- T1 `task_end:<taskId>#r<reductionRevision>` at `reducedAt`, when `TaskReduction.phase === 'satisfied'`. A re-reduction fires again. That is accepted, because the task's result changed.
- T2 `task_end:<taskId>@p<rev>` at the `acceptedAt` of the first plan that made the task cancelled or superseded. This uses the same rule as `plan-readers.ts:1964-1978` (the `dispositionRecord.setIn` plan, otherwise M).
- T3 `rework:<taskId>/<afterRunId>` at `requestedAt`, for every requeue of the goal's ended Runs. When `archiveOrigin` is set, the kind is `archive:` instead.
- T4 `plan:p<M>` at `acceptedAt(M)`. Goal anchor only.

**Triggers for a stage:** T1–T3, limited to tasks of M whose `task.stageId === s`. Alternative: use `scope.stageId` (lead). There is no T4 for a stage: a replan already moves the stage to a new key, and L11's `plan_changed` marks the old understanding stale.

**Baseline B**
- With a current understanding: B is that understanding's `createdAt`. A pointer on a note whose state is not accepted or reviewed counts as no understanding.
- Without one: goal B = −∞ with T4 left out. `stage@M` B = `acceptedAt(M)`.

**Rule**
- `updateDue` = some trigger has `at > B` (strict).
- `latestTriggerCursor` = the key of the largest such trigger by `(at desc, key ascending in byte order)`, or null when nothing is due.
- Keep the field name and change its meaning (smallest change). Alternative: rename it to `latestTriggerKey` (lead).
- `UnderstandingStatusV1.updateDue` goes back to `boolean`. A read failure makes the whole call `unavailable` (§9).
- `NoteItemV1.updateDue` is non-null only for the head version of an understanding in state accepted or reviewed. L8 guarantees that is the note the pointer targets, so no pointer read is needed.
- Time comparison over cursors: only requeues carry a cursor, and one rule should cover every trigger. Regroup is left out until it is built.

**Where it is computed**
- A new file, `notes/note-update-due.ts`:
  - `readGoalTriggers(records, goalRef, plan)` does the I/O.
  - `foldUpdateDue({ triggers, plan, anchors: [{ anchorKey, baseline }] })` is pure.
- The check (`note-views.ts`) memoizes per goal inside the round-1 per-call `CheckCaches`, next to the `currentPlan` cache it already has.
- `checkHeads` takes an optional `understandingAnchor`, so lookup gets the status from the same cache and `understandingOf` stops reading on its own.
- The assembler (L20 reminder section) and the heartbeat call a narrow `NoteUpdateDuePort.readUpdateDue(ctx, { goalIds })` that uses the same function.

**Heartbeat (host.ts)**
- A separate scribe-reminder pass for each configured workspace. It needs no attention scope.
- Goals: `GOAL_BY_WORKSPACE_INDEX`. Anchors: `goal:g` plus `stage@M` for every stage of the active plan.
- Recompute only when the ledger cursor has moved since the last pass. This is a memory-only cache, not a stored marker.
- Recipient: the managing scope (project today). If several project scribes exist, pick the smallest `sessionId` until 7D's `resolveResponsibleLine` replaces this. `ownerSessionKey` = that `sessionId`.
- Send when the count is at or over the threshold. Send at once when there is an `archive:` trigger whose requeue no Run has claimed yet (`Run.requeueRef`, `dispatch.ts:246`). That is how "no agent present" is read.
- Each owner gets one message with request id `scribe-reminder:<ws>:<owner>:<sha256(sorted set)>`. Idempotent delivery prevents repeats. The message lists counts plus at most 20 anchor labels.
- At most one unprocessed reminder per owner, using the same pending/processed rule as `host.ts:1173-1195`.

**Decisions for the user** (these change what an agent or the scribe sees):
- (U1) Only archives that stopped a running task or a wait count as triggers. The alternative counts every archive and costs one lookup per task.
- (U2) Plan adoption alone never makes an anchor without an understanding due. After a replan, a stage counts only what happens after the new plan.

Everything else is the lead's call: time vs cursor, strict `>`, key format, field name, stage membership, the scribe tie-break and the pacing.

## 4. COST (per call, extra store reads)

**Per goal**
- The plan window is shared with the check: 2, or 3 at worst.
- `readGoalRunsForCount` (`plan-readers.ts:1244`): 1 lookup per 200 Runs plus 1 `readMany`, with the reduction keys merged into the same `readMany`.
- `readReworkRecords` (export it): 1.
- Each Run, Reduction and Requeue is decoded once per call.

**Per read**

| Read | Extra store reads |
| --- | --- |
| lookup on a goal or stage anchor | +2 + ⌈R/200⌉, plan already cached |
| find, stale, history, neighbors, conflicts, checkNotes | the same for each distinct goal of the understanding items on the page; 0 when there are none |
| heartbeat | 1 (cursor read) when nothing has moved; otherwise 2 (goals) + 5·G + 2 (pointers and their heads, batched) + scribe-scope reads, only when something is due |

**New source:** about 300–350 lines (triggers and fold ~120, check and read-model wiring ~50, host reminder ~120, assembler line ~25).

**Reused:**
- `readGoalPlanWindow` / `currentPlan` cache
- `readGoalRunsForCount`
- `readReworkRecords`
- `taskRecordRefKey`
- `planRevisionsOfGoal` (for T2's origin plan)
- the scribe-scope facts
- the message idempotency by request id

## 5. TESTS (public interfaces; a settable injected clock; times hand-picked)

- **M-12a** (NE3, `memoryLookup`): understanding at t10, task A satisfied at t20 → `{ updateDue: true, latestTriggerCursor: 'task_end:A#r1' }`.
- **M-12b:** review only at t30 → `false`, `null`.
- **M-12c:** requeue at t25 after satisfaction at t20 → `rework:A/R1`.
- **M-12d:** adopt p2 at t40 → goal `plan:p2`; `stage@2` not due.
- **M-12e:** no understanding, task in s1 satisfied → goal and s1 due, s2 not due, `pointer.noteId: null`.
- **M-12f:** trigger at exactly t10 → not due.
- **D-03 additions** (NE6, real Host):
  - archiving a Session with a running task → sent at once while unclaimed, not after a claim;
  - the same set twice → one message;
  - a new trigger → a new message listing all items;
  - an owner change → a new key.
- **Cost row:** a counting wrapper on the store port (not a database read) checks the per-read limits above.
- **Accepted as untestable:** regroup.

**Must change for NE6:** heartbeat timing uses `Date.now()` (`host.ts:1164,1201`), and `archivedAt` uses the wall clock. 4C has to route both through the injected `now` for NE6, or the tests have to wait real time. Unknown: whether a counting store wrapper already exists in the tests.

Files: `D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/src/core/work-graph/notes/note-read-model.ts`, `.../views/note-views.ts`, `.../tasks/plan-readers.ts`, `.../sessions/session-lifecycle.ts`, `.../src/app/attention-observer.ts`, `.../src/app/host.ts`, `D:/cc-lead-notes/impl/s4c/updatedue-facts.md`.