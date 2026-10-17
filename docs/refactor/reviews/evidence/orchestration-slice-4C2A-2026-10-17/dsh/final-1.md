All work and checks are complete. Final state: typecheck/architecture/build pass; one unlisted old assertion I reverted and report below.

## FILES CHANGED (production 14 files, ~1,416 added / ~1,325 net lines)

**Production (new):** `notes/note-update-due.ts` (191), `notes/note-memory-material.ts` (25), `notes/note-scribe-todos.ts` (240).
**Production (modified):** `contracts/graph-context.ts` +20, `model/note-contracts.ts` +56, `state/note-machine.ts` +25, `tasks/plan-readers.ts` +123, `views/note-views.ts` +147, `notes/note-read-model.ts` +271/−55, `views/context-extensions.ts` +50, `agent-runtime/context-assembler.ts` +93, `views/graph-context-reader.ts` +5, `app/host.ts` +101, `composition/create-platform.ts` +69.
**Tests (new):** `S4C2-update-due-fold`, `S4C2-pending-understanding-overridden`, `S4C2-goal-triggers`, `S4C2-update-due`, `S4C2-memory-material`, `S4C2-assembly`, `S4C2-scribe-reminders`, `S4C2-platform`. **Tests (modified, shape/plumbing only):** `S3-context-assembler`, `S3-graph-context`, `S3-graph-routes`, `WP1-units-fixture`, `S3-graph-tools`, `WP1-context-anomalies`.

## SCOPE ITEMS / ROWS

1. **Assembly (L20/§11.4/U8) — done.** `notes = { availability; understanding:{rows,norms,normsOmitted}; general }`; U8 `NoteMemoryMaterialPort` one read window; query gets understanding only; bound replay does not re-assemble; reminder line "当前理解该更新了"; `ContextSourceV1.note` = `{anchorKey,noteId,version,digest}` (confirmed: no producer existed). **C-01, C-02, C-04, G-01 assembly, PU-03 RED→GREEN; C-03 was already green (replay existed) and now asserts 0 graph/input reads.** NE5: B's G-01 goes genuinely through `createExecutionPreparation.prepare`; C's composition test reaches the one real `readMemoryMaterial` via public `readContextFacts`.
2. **"Update due" (§11.5) — done.** `readGoalTriggerRecords` (three reads, `unsupported`→`unavailable`, T2 first-terminal source plan), `foldUpdateDue` pure, `note-views` per-call trigger cache, `understandingOf`'s pointer read deleted, `NoteUpdateDuePort` declared in `model/note-contracts.ts` and implemented in `notes/note-update-due.ts`, project anchor `updateDue:null`. **M-12a–h RED→GREEN** (12 tests).
3. **Scribe reminders (U10) — done.** Shell scope→to-dos→one recipient resolver (smallest-sessionId project scribe)→idempotent delivery; loop starts for every `options.workspaces` even with no attention/input consumers; thresholds 10/5; immediate on an unclaimed `archive:` trigger; one unhandled reminder per recipient; compute/send separate (failed send retried). **D-03, D-10, D-15 reminder, D-18, NE6 RED→GREEN** (5/5). D-15's card part is session B — not built, as scoped.

## CHECKS

- Targeted vitest (79 files, `--maxWorkers=2`): **905 passed, 2 failed, 5 skipped**. One failure is baseline §A `orchestration-mechanism.test.ts` (bwrap ENOENT). The second is the reverted `WP2-wiring.test.ts` F06 (below).
- `npm run typecheck`: **PASS, 0 errors**. `npm run check:architecture`: **PASS**. `npm run build`: **PASS**.
- Must-stay-green: CA14 + not-injected (15/15), `S3-graph-context` (54/54), `S4C-project-understanding:91` (4/4), attention `:51/:83/:331` all pass; only the baseline bwrap test fails in that file.

## UNSPECIFIED (short)

- **`WP2-wiring.test.ts` F06 (reported, not edited):** expected `reminders: 另有 3 条`, received `2`. Cause is plumbing, not a rule: the `注记索引尚未接入` placeholder disappears once notes are available (§4.3/G5.3, L20). Close-out had updated the literal; I reverted per the book. Options: accept `3→2`, or keep the red assertion.
- **Clock:** input-consumer throttle stays on wall `Date.now()` (book named ~1167/1168); injecting `now` stops idle re-scan and breaks the legacy AG2b fixed-`now` fixture. Attention timestamp (~1204) and the reminder loop use the injected clock.
- **No ledger cursor on `NoteScribeTodoPort`:** the Host recomputes each heartbeat and suppresses duplicate sends via an in-memory requestId memo.
- **U-7 marker:** `SessionMessage` carries no `requestId`, so the unhandled check reads the reminder's leading body marker (record-based, survives restart).
- **Note-source digest:** `sha256Hex(canonicalJson({anchorKey,noteId,version,label}))` (spec silent); Goal-card understanding/norm rows are not recorded as sources (understanding rows carry no note version).
- `pendingUnderstandingOverridden` does not require `current.kind==='understanding'` (U-8 list omits it).

## SUBAGENTS

S0 contracts+pure+trigger reader (~45 min); A update-due+memory material+read model (~70); B assembly (~60); C Host+composition+scribe to-dos (~80); close-out (~35). **Most at once: 3.**

## SURPRISING

- `readIndexes` is shared by look/find; B added a gate so the memory material is read only for assembly (`includeInputs !== undefined`), keeping look/find within §11.7.
- `PlanRevisionSnapshot.revision` is the aggregate revision (always 1); keys must use `plan.planRevision` — caught and fixed, with a regression test.
- Close-out also had to update two doubles beyond the three named (`S3-graph-tools`, `WP1-context-anomalies`) for the same `notes` shape.