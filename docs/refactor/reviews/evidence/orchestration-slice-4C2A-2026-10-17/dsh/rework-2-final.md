# Slice 4C-2 session A rework 2 — final

All six section-2 items landed. Close-out found **no integration break** and edited nothing.

## FILES CHANGED (production net)
**Production +94 net** (325 ins / 231 del): new `notes/note-batch-reader.ts` +104; `host.ts` +42/−42; `note-read-model.ts` +35/−66; `note-scribe-todos.ts` +72/−77; `note-update-due.ts` +30/−46. `note-views.ts` unchanged — it already consumes the seeded pointers/heads, so no own read.
**Tests** +922 net: `S4C2-scribe-reminders` +407/−23; `S4C2-read-counts` +168; `S4C2-memory-material` +112/−1; `S4C2-update-due` +115/−136; `S4C2-assembly` +76/−51; `WP2-platform-support` +23/−4.

## ITEMS (RED → GREEN)
1. **General rows** (note-read-model): RED – s2 note leaked and an accepted module row sorted before a confirmed interface row; GREEN – `isRelatedHead` filters to this call's `generalKeys`, rank = `generalKeyRank` class (task/stage/goal/module-class), array order only picks the display anchor. Tests: `item 1 … stage s2 never enters an assembly for a task in s1`, `… confirmed interface note sorts before an accepted module note`.
2. **"Handled?" three answers** (host): RED – a failed Run read folded to `false`, so `computedAtCursor` stuck and the new set was never sent; GREEN – `inputCompletion` = completed / not_completed / unknown, per-recipient `{ref, recovered}` map (`recovered` also on an empty inbox). Test: `item 2: a failed Run read is unknown (no send); a completed read lets the new set be sent`.
3. **Retry only when the cursor did not move**: RED with the old ordering (stale resend to archived A); GREEN – unchanged cursor retries `pendingSend`, moved cursor drops it. Test: `item 3: after the cursor moves the stale send is never retried to the old recipient`.
4. **One batch per workspace**: extracted `note-batch-reader.ts`; pending anchors collected first and handed to `readGoalUnderstandingAnchors` (optional `extraAnchorKeys`); it returns pointers/heads; only the relation-target batch remains; `planWindows`/`understandingPointers` go to the relation check. RED pointer 2 / pointed-head 2 → GREEN `{pointer:1, pointedHead:1, targetHead:1, otherHead:0}` on memory+SQLite.
5. **Through the owners**: T4 RED (`schemaVersion 1` draft refused) → GREEN through real `proposePlan/applyPlanChange` (tasks unchanged) + `memoryLookup` `plan:p2`; T3 RED (hand-encoded) → GREEN through WP2 `preparedBundle→runtime.startRun→requeueTask→memoryLookup` `rework:<task>/<run>`; `head()` never puts a pitfall behind an understanding pointer. D-03 hand-builds the sorted `noteId@1` list from write results, then public `archiveSession` re-owns the next reminder. Immediate negative (post-archive understanding ⇒ no message), restart with page-2 unhandled reminder + failed page read, C-02 restored (stale warning omitted 1, no source), C-03 public binding + supersede.
6. Codex's accepted UNSPECIFIED (a)(b)(c)(e)(f) untouched.

## CHECKS (`--maxWorkers=2`)
runtime S3+S4C* **5 files/49 pass/0 fail**; work-graph S4*/SP-*+S3 **64/766 pass/5 skip/0 fail**; app S4C-*+orchestration-mechanism **4/40 pass/1 fail (baseline A#19 bwrap)**; composition platform+WP2-* **2/38 pass/0 fail**; architecture **4/53 pass/0 fail**; AG2b **1 file/3, 1 pass/2 fail (baseline A#14/#15 timeouts)**. `npm run typecheck`, `check:architecture`, `build` all exit 0. **No non-baseline failure.**

## UNSPECIFIED (smallest options)
- S4A's `platform.runtime` is an un-wired skeleton; C-03 binds through the WP2 public `runtime.startRun` aborted after entry-authorization (test-helper `onCommit` hook). Alt: keep the old `h.bound` injection (review-rejected).
- `anchorSets` not passed to the relation check — no complete per-anchor head set exists; a partial seed would corrupt overQuota/conflicting. `planWindows`+`understandingPointers` are passed.
- Pending buckets are read for every input goal + the goal-less bucket before the cancelled/planless filter, so a read failure in a later-filtered bucket is now `unavailable` (one extra index read per filtered goal).
- Item-2 test mechanism: backend wrapper injects `acceptedInputs` and fails/replays the Run read (`recordInputAccepted` needs Kernel turn facts the fixture Run lacks). Alt: a completion-read Host seam (not in the book).
- `recovered` set only after a complete inbox scan; an early unhandled return leaves it false. Restarted Host has `sentRequestId=null`, so an unchanged set is re-sent once the old reminder is handled.

## SUBAGENTS
A (items 1+4), B (items 2+3), C (item 5 tests) in parallel; close-out D sequential. **Most at once: 3.** Elapsed ≈ 75 min of 150.