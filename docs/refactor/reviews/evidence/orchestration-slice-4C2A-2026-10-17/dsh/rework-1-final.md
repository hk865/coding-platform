All 11 items landed. Close-out found no integration breaks and edited nothing.

## FILES CHANGED
**Production** (11 modified, 0 new; +792/−432 = **+360 net**): `host.ts` +116/−23, `note-read-model.ts` +258/−121, `note-scribe-todos.ts` +86/−105, `note-update-due.ts` +152/−113, `context-assembler.ts` +94/−34, `note-views.ts` +37/−20, `note-contracts.ts` +22/−8, `note-related-scope.ts` +11/−1, `graph-context.ts` +9/−2, `context-extensions.ts` +4, `create-platform.ts` +3/−5. **Deletions:** `NoteUpdateDuePort`/`readUpdateDue` removed **98** production lines (88-line `createNoteUpdateDue`, 6-line interface, 4 composition lines); before that deletion the rework reads **+458**, after **+360**.
**Tests** (6 modified + 1 new; +1239/−733 = +506, +105 new = +611): `S4C2-scribe-reminders` +406/−106, `S4C2-assembly` +295/−444, `S4C2-update-due` +313/−181, `S4C2-memory-material` +148, `S4C2-update-due-fold` +53/−1, `S4C2-platform` +24/−1, new `S4C2-read-counts` 105. `note-memory-material.ts` untouched.

## ITEMS (RED → GREEN)
1. **Stage row / no-understanding rows:** goal row always emitted; stage derived from the call's plan via exported `stageIdOf`; rows carry `UnderstandingStatusV1` with a null pointer. S2 `item 1 …without an explicit stageId`, `…after a task_end trigger` (memory+SQLite); S3 C-05 + F06 reminder.
2. **Items 2/3 + missed 1:** conclusion only for `currentEligible`; one warning only for accepted/reviewed stale/conflicting/unavailable, nothing otherwise; source rank/anchor/tier from this call's `generalKeys`. S2 `item 2 …anchorQuota 1`, `…readFilesMax 1`, `item 3 …foreign-anchor note` (`[Y,X]`, X→`goal:s4a-goal`); S3 pins the warning line with no body.
3. **Item 4:** rows carry the real note `version`/`currentEligible`; one `noteSourcesOf(notes, keptGeneral)` feeds Work and Query; each rendered line gets `（<noteId> v<version>）`. S2 `item 4 …real note version`; S3 C-01=5, PU-03=9, C-04 Query=2.
4. **Item 5:** `foldInputOf` is the one baseline rule; `latestOf` ties by `Buffer.compare` UTF-8. S1 `S4C2-1j` (Ａ beats 😀), `1k/1l`, withdraw via `memoryLookup`.
5. **Item 6:** `readLedgerCursor` on `NoteScribeTodoPort`, per-workspace memory on the injected clock, own period gate, `pendingSend` retried. S4 NE6 counts 1/1→(+59,999)1/1→(60,000)2/1→(note+60,000)3/2; D-18 same id, todos 1. Input-consumer throttle stays wall clock.
6. **Item 7:** last-sent ref per recipient via `readMessage`+`inputCompleted`; empty memory pages the whole inbox once; any read failure = unknown, nothing sent, `computedAtCursor` unset. S4 restart: 10 sent, add 11th, Host B → still exactly 1 message.
7. **Items 8/10:** one shared `readGoalUnderstandingAnchors` (one plan window/goal, one batched pointer read, one batched head read, one trigger read/goal) used by to-dos and mapped by the view; `understandingPointers` seed; `eligibleNorms`; exported `stageIdOf`; port deleted. S2 `item 8 …{planWindow:1,pointer:1,pointedHead:1}`; S1 M-12a–h.
8. **Missed 2:** `immediate` = unclaimed `archive:` trigger after the goal baseline. S4 unclaimed sends / claimed does not.
9. **Missed 3:** `includeInputs:false` skips related scope + general. S3 Query keeps understanding/norm, general `[]`; S2 `item 7 …includeInputs false`.
10. **Item 9:** M-12 over the public note service/real records (S1); NE5 through `createExecutionPreparation.prepare` memory+SQLite (S3); D-03 real Host + real sender + persisted messages + literal requestId + restart + immediate + real resolver (S4); cursor/period/retry (S4); read-count wrapper (S2).
11. **F06:** WP2's main plan has `stages: []` (`WP2-platform-support.ts:269`), so the always-emitted F06 goal row (`updateDue:true`; budget requeue is a T3 trigger, no understanding) adds exactly 1 to the prior 2 (anomalies+decisions); no stage row. **Literal = 3**, observed 3.

## CHECKS (`--maxWorkers=2`)
runtime S3-context-assembler+S4C*/S4C2* **49/0**; work-graph `^S4|^SP`+S3-graph-context **759/0/5 skipped**; app S4C*+S4C2*+orchestration-mechanism **37/1** (baseline bwrap); composition platform+WP2-wiring **38/0**; architecture **53/0**; S4C2-scribe-reminders+AG2b **9/2** (both baseline timeouts); S1/S2 re-run **65/0**. `npm run typecheck` pass; `check:architecture` pass; `build` pass. **No non-baseline failure.**

## UNSPECIFIED (smallest options)
- Explicit `stageId: null` treated as absent, derived from the plan (alt: treat null as no stage).
- Ruling 3's literal suffix repeats the id on warning lines (`需复查：N …（N v1）`); alt: append only `（v<version>）` there.
- Understanding source digest has no label field; used the rendered base label (alt: full line, or anchorKey).
- M-12's T3/T4 rows run through the exported `readGoalUnderstandingAnchors` over real codec-encoded records because the S4A fixture cannot end a Run or adopt a second plan through the public API; accept/review/withdraw/stage go through `memoryLookup`.
- S4A's `platform.runtime.prepareExecution` is an unsupported skeleton, so NE5's real chain is public `createExecutionPreparation.prepare` over the real graphContext/read model (the verifier's own wording).
- A recipient change with an unchanged ledger cursor sends nothing (step 3); the old "new recipient" assertion was dropped. `readMessage` not_found = unknown.

## SUBAGENTS
Five tasks: S1 foundation, S2 read model, S3 assembly, S4 Host, S5 close-out. **Most at once: 3** (S2/S3/S4). Elapsed ≈ 37 min of the 200.