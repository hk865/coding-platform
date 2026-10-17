## Read-through report — slice 4C-2 session A

### 1. Unclear (question → smallest options)

**U-1. `ContextExtensionsV1.notes` new shape.** Book §2.1 says `notes` “splits into `understanding` … and `general`”, but §3 requires CA14 (binding annotation, `S3-context-assembler.test.ts:802`) and `S3-graph-context.test.ts:1067` (`extensions.notes.availability`) to keep passing. → (a) keep the outer `availability` and make `notes = { availability; understanding; general }`; (b) move them to two top-level members and edit `:1067`. Nested member type also unstated.

**U-2. U8 function file/signature.** No file named; output mixes `UnderstandingStatusV1` (local) with `NoteIndexRowV1` (general), and the `reminders` type is unstated. → (a) new `notes/note-memory-material.ts`; (b) add to `note-read-model.ts` beside `selectProjectHeader`/`buildFindPage`.

**U-3. Deleting `understandingOf`’s pointer read.** `understandingOf` (`note-read-model.ts:1177`) is in `notes`, which cannot see `views`’ per-call trigger cache, yet `lookup` needs pointer + `updateDue` from “the same cache”. → (a) inject `NoteUpdateDuePort` into the read model and have `understandingOf` take `{triggers, pointer}`; (b) return per-anchor status from `checkHeads`; (c) keep the pointer read and only fill `updateDue`/`latestTriggerCursor`.

**U-4. Pending to-dos have no port.** `NoteUpdateDuePort` only carries update-due, but the reminder needs pending status buckets, cancelled-goal exclusion and `userReasonsOf`; also the port takes `goalIds[]` while `readGoalTriggerRecords(records,goalRef,plan)` takes one goal. → (a) a second narrow pending-review port; (b) widen this port.

**U-5. Immediate send.** Needs an `archive:` trigger whose rework no Run claimed (`Run.requeueRef`), but the §11.5 port shape exposes no `requeueRef`. → (a) add a `claimed` flag to the port; (b) separate read in `host`.

**U-6. Host loop.** `period` at `host.ts:1162` is `Math.min(...attention, ...inputConsumers)` = `Infinity` when both are empty, although the loop must now run with neither. Also “every configured workspace” and how ports reach the Host (it only sees `sessions/executions/controls/plans/reconcile`, `:984`). → reuse `options.workspaces`, pick a fixed reminder heartbeat, add new `CreateHostOptions` seams.

**U-7. “One unhandled reminder per recipient.”** Today’s rule is attention `pending`/`markProcessed` (`host.ts:1182-1195`); mapping it to non-attention scribe messages is undefined. → in-memory requestId set vs. reusing `pending`.

**U-8. `pendingUnderstandingOverridden`.** Book says “e.g.”; parameter types and `currentHead: null` handling unspecified.

**U-9. `foldUpdateDue`.** Trigger row type/keys, T2 `setIn` fallback output, and the no-plan result are not fixed.

**U-10. `NoteIndexRowV1` does not exist** anywhere in `src/`; L20/§6 assume it. It must be created in `contracts/graph-context.ts`.

### 2. Spec/book/facts vs code

- Facts §2 and spec §12.7 claim the `moduleOfAnchor` export was deleted; it still exists at `scribe-scope.ts:93` and is imported by `note-related-scope.ts:38,345` (reuse ruling U2 not fully executed).
- `S4C-project-understanding.test.ts` is at `tests/work-graph/`, not `tests/runtime/` (book §3 omits the dir; facts §4 too).
- Book §2.1 treats `NoteIndexRowV1` as existing; it is new.
- Cosmetic: facts §1 puts `createNoteCheck`/`createNoteReadModel` at `:1308/:1311` (actual 1307/1309); `readReworkRecords` unsupported branch is `:1354` not `:1355`; spec §11.5 cites host failure retry `:1238` (actual catch `:1241-1242`).

### 3. Tests that will break (beyond book-named)

- `tests/work-graph/S3-graph-context.test.ts:712` — extension double builds `notes: { availability:'available', rows:[…] }`.
- `tests/app/S3-graph-routes.test.ts:42` — `emptyIndexes()` builds the old `notes` shape.
- `tests/helpers/WP1-units-fixture.ts:360` — `emptyExtensions()` same.
- `tests/app/orchestration-mechanism.test.ts:331` — real-Host attention scenario: unconditional reminder check + `Date.now()`→injected `now` may add messages/change ids. Verify.
- `tests/runtime/S4C-note-tools.test.ts:54` — `NoteCheckV1` fixture `updateDue:null` stays type-valid, but recheck if it is a goal understanding.

### 4. Plan (200 min)

1. **Shared first (1 subagent, ~45 min):** contracts (`NoteUpdateDuePort`, notes split, `ContextSourceV1.note`, U8 types, `NoteIndexRowV1`) + pure `foldUpdateDue` / `pendingUnderstandingOverridden` + unit tests. Files: `contracts/graph-context.ts`, `model/note-contracts.ts`, new `notes/note-update-due.ts`, `state/note-machine.ts`, the 3 fixture files above.
2. **Three parallel (~65 min each):** A — trigger read + update-due wiring (`tasks/plan-readers.ts`, `notes/note-read-model.ts`, `views/note-views.ts`; M-12a–h); B — assembly (`notes/note-memory-material.ts`, `views/context-extensions.ts`, `agent-runtime/context-assembler.ts`; C-01–04, PU-03, G-01); C — Host + composition (`app/host.ts`, `composition/create-platform.ts`; D-03, D-10, D-15 reminder, D-18).
3. **Close-out (1 subagent, ~40 min):** the book’s check list.

Total ≈ 215 min with handoffs, so 200 is tight. If short, leave the spec §11.7/§12.12 20k-note timing measurement and the final `npm run build` to the follow-up — neither is a scope item.