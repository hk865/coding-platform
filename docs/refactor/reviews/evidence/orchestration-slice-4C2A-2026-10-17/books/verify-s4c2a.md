# Verification of Codex's review of 4C-2 session A (copy `D:/cxt/s4c2a-review`)

Read-only check. I read the cited code, the spec (L16, L20, §11.4–§11.8, §12, rows C/G/PU/M/D) and the book's §7. Nothing was run. Below, `notes/`, `views/`, `tasks/` are under `src/core/work-graph/`. Line numbers are from the copy.

| # | Verdict | Breaks a spec rule? |
|---|---|---|
| 1 stage understanding / no-understanding reminder | CONFIRMED | L20, §11.4, §11.5 |
| 2 ineligible notes rendered as conclusions | CONFIRMED | L20 |
| 3 source tier from foreign anchors | CONFIRMED | L20 order, L20 record |
| 4 sources / row identity | CONFIRMED | L20, C-01 |
| 5 T4 after withdraw; UTF-16 order | CONFIRMED (both) | §11.5 |
| 6 cursor, retry, period, clock | CONFIRMED, except the throttle clock, which is PARTLY (lead rules) | §11.5, §11.7 |
| 7 unhandled reminder after restart | PARTLY (defects real; Codex's fix needs a read that does not exist) | §11.5, book §7.6 |
| 8 duplicated reads | CONFIRMED | §11.7 Goal-card and heartbeat rows, §12.7 |
| 9 tests bypass the chain | CONFIRMED | NE5, NE6, §11.8 |
| 10 three copies of the baseline logic | CONFIRMED; the fix is right | quality, and the cause of item 5 |

## 1. Stage understanding missing; no reminder without an understanding — CONFIRMED

- `views/context-extensions.ts:260-263` passes only `{ goalId, taskId }`.
- `notes/note-read-model.ts:1890-1892` builds the stage key only from `input.stageId`, so a real Work assembly never has a stage row.
- `:1974-1985` pushes a goal/stage row only when `isCurrentUnderstanding(head)` holds.
- `:2009` computes `reminders`, but `context-extensions.ts:273-279` drops them.
- The assembler takes its reminders only from rows (`context-assembler.ts:627-634`).
- L20 ("没有当前理解也给出锚点状态"; the reminder section uses `updateDue`, "没有当前理解也算") and §11.4 (at most 3 rows) require the goal and stage rows even when no understanding exists.
- Examples:
  - t1 is in stage s1 and s1 has an accepted understanding. The prepared input has no stage line.
  - The goal has no understanding, and a requeue of t1 ends a Run (a T3 trigger). The goal's `updateDue` is true (baseline −∞), but the input has no "当前理解该更新了" line.
- The tests hide both cases: `S4C2-memory-material.test.ts` passes `stageId: 's1'` explicitly (e.g. :184), and `S4C2-assembly.test.ts` injects the rows.

**Fix (book wording).** In `readMemoryMaterial`, when `input.stageId` is absent and `taskId` is given, take the stage from the plan window this call already read. Use the §11.2 rule `stageIdOf` (export it from `note-related-scope.ts:297`; do not write another copy). Then always emit:
- a goal row;
- a stage row whenever the task's stage is in the current plan;
- each row with its `UnderstandingStatusV1`, whether or not `pointer.noteId` is null.

The project row stays only when a current project understanding exists. The assembler keeps deriving the reminder from `row.status.updateDue === true`, so no new extension field is needed. `reminders` stays in U8's output for other callers. The lead must fix the wording of a row without an understanding, e.g. `目标 g：没有当前理解` / `阶段 s1：没有当前理解`.

**Tests (NE5, real chain).** Use the S4A fixture with the memory and SQLite backends, `f.platform.runtime.prepareExecution`, and the bundle's `input` and `contextAssembly.sources` (see `tests/helpers/WP2-platform-support.ts:895`).
- (a) The user writes goal understanding "goal now" and stage-s1 understanding "stage now". `claimRun(.., 't1')`, then prepare. Expect the Goal card to show "goal now" before "stage now", and the note sources to have anchorKeys `goal:s4a-goal` and `stage:s4a-goal/1/s1`.
- (b) A WP2 scenario with F06's budget requeue and the normal budget. The continuation input contains `当前理解该更新了：goal:<goalId>`, and the Goal card shows the goal status row without an understanding.

## 2. Ineligible notes as conclusions — CONFIRMED

- `note-read-model.ts:1991` filters with `visibleByDefault`, which admits own-goal `pending_review` (`:604`).
- `:2006` renders `renderNoteHeader` whenever there is no stale/conflicting/source-unavailable warning. It never reads `item.currentEligible`.
- L20: only `currentEligible` items give a conclusion line, and only accepted/reviewed items with one of those three problems give a warning line.
- Examples:
  - With `anchorQuota: 1`, an agent's second note on t1 is `pending_review` (`quota_full`). It renders as `约定(任务 t1)：…`, a conclusion.
  - With `readFilesMax: 1`, the second note with a basis file comes back `freshness: 'unchecked'` and also renders as a conclusion.
  - Items that are `invalid` or have a retired primary anchor render the same way.

**Fix.** In the `general` mapping:
- `item.currentEligible` → conclusion row with `renderNoteHeader`;
- else, if `head.state` is accepted or reviewed and the item is stale, conflicting or source-unavailable → one warning row (existing `generalWarningLabel`);
- else → no row and no omitted count.

Use the check result already at hand; add no new read.

**Test (NE5).** In the quota case, the notes section has exactly one row (the accepted note) and one note source. In the `readFilesMax: 1` case, the unchecked note appears neither as a conclusion nor as a warning.

## 3. Source tier taken from foreign anchors — CONFIRMED

- `:1993-1994` (sort) and `bestGeneralKey` `:1850-1858` rank over all of the head's anchors.
- `:1845-1846` puts own-goal `reviewed` into the cross-goal tier.
- L20 tiers are "你确认的 → 本目标收下的 → 书记已审跨目标的".
- Example: note X has main anchor `goal:g` and extra anchor `task:g/t2`; note Y is on `task:g/t1`, with topics X='a' and Y='b'. Assembling t1:
  - L20 order is Y then X, and X's display/source anchor should be `goal:g`.
  - The code gives X then Y and records `anchorKey: task:g/t2`, which is not a source of this assembly.

**Fix.** Build `rankByKey` from the `generalKeys` this call assembled (task 0, stage keys 1, goal 2, module/interface/file 3). For each head:
- source rank = the minimum over `anchorKeysOf(head)` ∩ `rankByKey`;
- display/source `anchorKey` = the first key in `generalKeys` order that reaches that minimum;
- tier = `confirmedByUser ? 0 : head.goalId === goalId ? 1 : 2` (after item 2's filter only accepted and reviewed remain).

**Test.** The X/Y case above: expect `general.map(r => r.noteId)` to equal `[Y, X]` and X's source `anchorKey: 'goal:s4a-goal'`. Through prepare when practical; the material level is acceptable for the tier half, which needs a module-scoped task: own-goal reviewed 'z' and cross-goal reviewed 'a' on `module:A` → order z, a.

## 4. Goal-card sources and row identity — CONFIRMED

- `context-assembler.ts:173-196` records only budget-area notes.
- The Query binding (`:1153`) records none.
- C-01 says "装配记录里五条注记的版本" (2 understanding + 3 general), but `S4C2-assembly.test.ts:393` pins 3.
- A real version is available: `readMemoryMaterial` holds `goalHead`, `stageHead` and `selected.understanding.head` with `.version`.
- `UnderstandingStatusV1.pointer.revision` is the pointer's CAS revision, not the note version. Using it would be wrong, as Codex says.
- L20: "每行都带编号、版本、锚点、新鲜度". Today a general line is only the header (`:611`, `contracts/note.ts:108`). Without the note id the model cannot cite a note in `replaces` or `contradicts`.

**Fix.**
- Add the note's `version` and `currentEligible` (or a nullable `note: { noteId; version }`) to `NotesUnderstandingRowV1`.
- One function `noteSourcesOf(notes, keptGeneral)` records:
  - every rendered understanding row that has a note;
  - every rendered norm;
  - only the kept general rows.
- Work (`:1077`) and Query (`:1153`) both use it.
- Every rendered note line carries id and version. Suggested form: `<label>（<noteId> v<version>）`; for understanding rows, `目标 g 当前理解（<noteId> v<version>）：<conclusion>`. The lead must fix the exact format.

**Tests.**
- C-01 through prepare: 5 note sources with literal anchorKeys and `version: 1`.
- PU-03: 1 project + 2 local + 5 norms + kept general rows.
- C-04: the Query sources contain the goal understanding and the norm (2) and no general note.

## 5. "Update due" boundaries — CONFIRMED (both)

- **Withdraw.** `withdraw` does not touch the pointer (`notes/note-service.ts:1329`; only `accept` moves it, `:1351`).
  - `notes/note-update-due.ts:174` and `views/note-views.ts:514` set `includePlanTrigger: head !== undefined/null`.
  - `note-scribe-todos.ts:205` correctly uses `current`, so the three copies already disagree.
  - Example: plan p1, a user-accepted goal understanding that is then withdrawn, no task triggers. §11.5 ("指针指向的注记不是已收下或已审时，当作没有…不算 T4") expects `updateDue: false, latestTriggerCursor: null`. The code gives `true, 'plan:p1'` through `lookup` and `readUpdateDue`.
- **Byte order.** `note-update-due.ts:76` uses `<`, which compares UTF-16 code units. Task ids are any non-empty string (`persistence/plan-record-codecs.ts:352`).
  - Two triggers at the same `at`: `task_end:Ａ#r1` (U+FF21, UTF-8 EF BC A1) and `task_end:😀#r1` (U+1F600, F0 9F…).
  - By byte order the latest is `task_end:Ａ#r1`; the code returns `task_end:😀#r1` (0xD83D < 0xFF21). This changes the to-do identity.

**Fix.**
- One pure `foldInputOf(anchorKey, head | null, plan, stageId?)` in `note-update-due.ts`: `current = head !== null && (accepted || reviewed)`; goal → `{ baseline: current ? createdAt : null, includePlanTrigger: current }`; stage → `{ baseline: current ? createdAt : plan.acceptedAt }`. All three callers use it (see item 10).
- `latestOf` breaks ties with `Buffer.compare(Buffer.from(a,'utf8'), Buffer.from(b,'utf8'))`, the same idiom as `tasks/session-facts.ts:82`.

**Tests.**
- Public service: write, then withdraw, then `memoryLookup` on the goal anchor → `understanding.updateDue === false`, `latestTriggerCursor === null`; `readScribeTodos` → `updateDueTodos: []`. Memory and SQLite.
- Pure fold: the two-key literal above → `'task_end:Ａ#r1'`.

## 6. Cursor, retry, period, clock — CONFIRMED except the throttle clock, which is PARTLY

- `host.ts:1194-1235` recomputes everything on each loop pass: recipient, inbox, goals, to-dos.
- `:1248-1249` sets the loop period to the minimum of all configured periods, and `:1337-1340` runs the reminder check on every pass. With attention at 5 ms, the reminder runs every 5 ms instead of every 60 s.
- §11.5 ("账本游标没动就不重算"; "上一次没发成功的…下一次心跳照样再发") and the §11.7 heartbeat row ("游标没动 → 1 次读") are specified; this is not UNSPECIFIED.
- A cheap cursor read exists: `readMany([])` → `readThrough` (`note-read-model.ts:549-553`, `composition/commit-observer.ts:74`).
- Throttle clock: the agent kept `Date.now()` at `host.ts:1258-1259` against the book (§2.3 names facts lines 1167/1168, which are these two lines). The reason is real: the AG2b fixture injects a fixed `now` (`tests/helpers/AG2b-collaboration-fixture.ts:266`), and with a fixed clock input consumers would never re-scan. The fixed clock also stamps records, so switching it to an advancing clock risks breaking timestamp assertions in about 10 files.
- Lead ruling needed on the throttle, one of:
  - (a) post-note §11.5 "时间" to name only the attention timestamp (`:1295`) and the new reminder gate. I recommend this: NE6 does not observe the input-consumer throttle.
  - (b) switch to the injected clock and move the AG2b fixture to an advancing clock, reporting every changed assertion.

**Fix (book wording).**
- Add `readLedgerCursor(ctx)` to `NoteScribeTodoPort`, implemented in notes with `records.readMany([])` (same as `ledgerCursor()`).
- The Host keeps per workspace, in memory: `{ lastCheckAtMs, computedAtCursor, pendingSend: { requestId, input } | null, sentRequestId }`.
- Each loop pass:
  1. Skip unless `clockMs() − lastCheckAtMs ≥ scribeReminderPeriodMs`, using the injected clock.
  2. Read the cursor. If it equals `computedAtCursor`: re-send `pendingSend` if there is one, otherwise do nothing.
  3. Otherwise: run the unhandled check (item 7), read the goals and to-dos, and set `computedAtCursor` to the cursor read in step 2.
  4. If a send is due, set `pendingSend`, then send. On `committed`, clear it and record `sentRequestId`.

**Tests (NE6: real Host on SQLite, manual injected clock, attention heartbeat 5 ms so the loop spins, `scribeReminderPeriodMs: 60_000`, a counting wrapper over the real port).**
- 9 pending notes (below threshold). After start: cursor reads 1, to-do reads 1.
- Advance 59,999 ms and let the loop spin: counts unchanged.
- Advance to 60,000: cursor reads 2, to-do reads 1.
- Write a note, then advance 60,000: cursor reads 3, to-do reads 2.
- D-18: 10 pending and the sender seam fails once. After the failure, advance one period: the same `requestId` is sent and to-do reads are still 1.

## 7. Unhandled reminder after a restart — PARTLY

**Defects, confirmed.**
- `host.ts:1199` reads only the first 100 inbox items. The inbox is in index order (`communication/mailbox-service.ts:2259-2265`), so an older unhandled reminder can sit on page 2.
- `:1191` treats a failed body read as "not a reminder", so the check fails open.

**Overstated by Codex.**
- Spoofing by a "same-name notice": only `sender.kind === 'host'` notify messages are considered (`:1188`), and only this code writes that prefix as the Host.
- A requestId cannot be recovered through an *existing* narrow read. `SessionMessage` has no requestId (`model/communication-contracts.ts:98-130`); it exists only on the Sent event (`:205`). `messageIdOf` (`mailbox-service.ts:771`) is a one-way hash, and the old requestId depends on the old to-do set, which the Host no longer knows. Codex's fix needs a new mailbox read across modules, so it is not smaller.

**What "today's rule" is.** In the original code, `host.ts` 1173–1195 is the current 1264–1289 (the hunk offset is +91): the sent `messageRef` is kept in memory (`entry.pending`) and each pass runs `readMessage` + `inputCompleted`. It does not survive a restart by itself; book §7.6's "survives a restart" was optimistic.

**Fix (smallest, and today's rule).**
- Keep per recipient the last sent reminder's `messageRef` (from `sent.value.ref`) and check it with `readMessage` + `inputCompleted`.
- Only when that memory is empty (first check after start, or a new recipient), recover by paging the recipient's inbox to the end. Look at Host notify messages whose body starts with the marker and that are not completed.
- Any page, body or message read failure means "unknown": send nothing this pass and leave `computedAtCursor` unset.

**Tests.**
- Restart, real sender, SQLite: Host A sends a reminder for 10 pending notes and closes. Add an 11th pending note. Host B starts on the same directory and runs one check. The recipient inbox still holds exactly 1 Host message.
- "After it is handled, a new set is sent": complete the input the way `tests/app/orchestration-mechanism.test.ts` ~360–384 does (an accepted input whose Run completes). If that is too heavy, keep the restart negative and let the lead decide.

## 8. Duplicated reads — CONFIRMED; they break §11.7 and §12.7, not only cost

- Plan read twice: `note-read-model.ts:1883` (`readGoalPlanWindow`), then `:1919` → `note-related-scope.ts:386` reads it again. The `plans` map argument only writes; it never reads. This breaks §12.7 ("一个目标的计划窗口只读一次"), and the stage key and the task scope can come from two different plans.
- Pointers and heads: the project pointer (`:1295`), goal pointer (`:1894`), stage pointer (`:1897`) and the two heads (`:1903`) are separate reads. The check then reads the goal and stage pointers again (`views/note-views.ts:486`) and their heads again (`:508`; `noteHeads` is not seeded). §11.7's Goal-card row allows one batched read of three pointers plus one batched read of their heads.
- Scribe to-dos, per goal:
  - pointers `note-scribe-todos.ts:181`;
  - heads `:195`;
  - for each bucket: relation targets `:92`, a `checkHeads` with fresh caches (`:99`, re-reading plan windows), pointers `:119`, heads `:134`.

  The §11.7 heartbeat row allows one batched read of all pointers, one of the pointed heads, and one relation-target read for all pending notes together.

**Fix.**
- Export from `note-related-scope.ts` a resolver that takes the already-read plan: `resolveTaskScopeWithPlan(ctx, deps, goalId, taskId, plan)` → existing `resolvedTaskScope`. `readMemoryMaterial` calls it.
- `readMemoryMaterial` does one batched pointer read for `[project, goal, stage]` and one batched head read. It hands them to `selectProjectHeader` (new optional pre-read pointer parameter) and to `checkHeads`, through a new seed `understandingPointers?: ReadonlyMap<anchorKey, { pointer; head | null }>` that `computeUnderstandingOfAnchorKey` uses before reading.
- Scribe to-dos: read all goals first, then batch across the workspace through item 10's shared reader. Read all pending buckets, then do one relation-target read and one `checkHeads` for all of them.

**Test.** RW-12-style counting wrapper over the public port (§11.7 allows this):
- Goal-card assembly through `readContextFacts(includeInputs:true)`: plan-window reads = one window, pointer `readMany` = 1, pointed-head `readMany` = 1.
- Heartbeat with 2 goals: one pointer batch and one pending-relation batch.

## 9. Tests bypass the chain — CONFIRMED

The bypasses:
- `tests/runtime/S4C2-assembly.test.ts`: material double `:240`, graph-context double `:299`, assembler called directly `:324`/`:345`. G-01 calls `prepare` but over a graph double (`:471`, `:521-550`).
- `tests/work-graph/S4C2-update-due.test.ts:18`: `vi.mock` of `plan-readers`. M-12b (`:152`) passes an empty trigger list; no review action is performed.
- `S4C2-memory-material.test.ts`: memory only (0 SQLite cases), explicit `stageId`, and a spy on `createNoteReadModel` (`:52`).
- `tests/app/S4C2-scribe-reminders.test.ts`: sender double `:139`, so nothing persists and the unhandled rule is never exercised; to-do port and recipient doubles `:129`/`:136`. D-18 `:197` waits only for an eventual send. NE6 `:207` counts clock calls.
- The immediate-send rule (archive while running → send; after it is claimed → no send) has **no test at all**.

**Tests the rework must add.** Keep the existing unit tests.
1. NE5 C-01, C-02 (real `readFilesMax`), C-03, PU-03 through `prepareExecution`, memory and SQLite, with the literals from items 1–4.
2. M-12 over the public note service plus real plan/run records:
   - review-only: the user reviews the accepted understanding → `updateDue: false`;
   - T4: a plan p2 adopted after the understanding → `true`, `'plan:p2'`;
   - item 5's withdraw case;
   - all through `memoryLookup`, on both backends.
3. D-03 on a real Host and real platform:
   - 10 pending → 1 message, and its `requestId` equals `scribe-reminder:<ws>:<scribe>:` + sha256 of the sorted literal identities;
   - same set → no second message;
   - item 7's restart case;
   - immediate: an archive requeue with no claimant → sent below threshold; after a Run claims it (`requeueRef`) → not sent;
   - real recipient resolver: two scribes `sb`, `sa` → `sa`.
4. The cursor, period and retry tests from item 6.

## 10. Three copies of "anchor → pointer → head → baseline → fold" — CONFIRMED; Codex's fix is right

The copies:
- `note-update-due.ts:114-178`
- `note-scribe-todos.ts:170-209`
- the baseline rule in `note-views.ts:512-516`

Item 5 shows they already diverge. `taskStageOf` (`note-update-due.ts:65`) also copies §11.2's `stageIdOf`. The norm projection is duplicated at `note-read-model.ts:1361-1367` and `:1963-1970`.

There is also an unused port: `readUpdateDue` (`createNoteUpdateDue`) has no production caller. Only `create-platform.ts:1405` exposes it, because the assembly uses the check (U-3) and the Host uses `readScribeTodos`.

**Fix.** One internal reader in `note-update-due.ts`: `readGoalUnderstandingAnchors(records, ctx, goalIds)`. It reads each goal's plan window once, batches all pointers and heads across goals, reads the triggers, folds with `foldInputOf` (item 5), and returns `{ goal, plan, triggers, claimedArchiveKeys, anchors[] }`.
- `readUpdateDue` maps that result.
- `readScribeTodos` uses it for the update-due part and the immediate flag.
- `note-views` uses `foldInputOf`.
- `foldUpdateDue` uses the exported `stageIdOf`.
- One `eligibleNorms(norms, itemByKey)` helper replaces the two norm loops.

This is smaller than a new service layer and removes code.

## The agent's open points

- **`WP2-wiring.test.ts:537`, 3 → 2.** Legitimate: the `注记索引尚未接入` placeholder (`context-assembler.ts:940-942`) disappears once notes are wired. But F06 is a budget requeue (a T3 trigger, no understanding), so after item 1 the goal row has `updateDue: true` and adds a reminder row. The literal will probably return to 3, plus 1 more if the WP2 task has a stage in the plan. The book should state the recomputed value and the reason.
- **No ledger cursor:** must be built (item 6).
- **Body-prefix marker:** acceptable with item 7's fixes.
- **Digest formula:** acceptable.
- **No `current.kind` check in `pendingUnderstandingOverridden`:** matches book §7.7.
- **Understanding rows "carry no note version":** wrong; the head version is at hand (item 4).

## What Codex missed

1. **Goal-card understanding rows ignore `currentEligible`.** `note-read-model.ts:1952-1985` puts the project body and the goal/stage conclusions on the card without looking at the checked item, so a stale, conflicting, retired or source-unavailable understanding reads as current. L20's conclusion/warning rule should apply: when not eligible, render one warning line `需复查：<id> <结论>，不能当现行结论`, with no body. The lead should confirm this for the project row.
2. **`immediate` ignores the baseline.** `note-scribe-todos.ts:220-221` sets it for any unclaimed `archive:` trigger. Example: archive at 10:00, unclaimed; goal understanding written at 11:00. Then `updateDue` is false, yet the Host sends "待审 0 条，该更新 0 条" (`host.ts:1222` passes on `immediate` alone) with an empty identity set. Fix: `immediate` = an unclaimed archive trigger whose `at` is after the goal anchor's baseline.
3. **Query assembly reads and checks the whole general set and then discards it.** `context-extensions.ts:255-263` calls the material for `includeInputs: false` as well. This is cost only: pass a parts flag, or skip the related-scope and general part when `includeInputs === false`.
4. **`readUpdateDue` is unused in production** (item 10).
