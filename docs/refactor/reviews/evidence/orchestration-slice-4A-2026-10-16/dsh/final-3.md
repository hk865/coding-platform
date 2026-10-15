All four fixes are done, test-first, with the section 4 checks green.

## FILES CHANGED (`git diff HEAD --stat`)

```
 src/core/work-graph/notes/note-anchors.ts | 60 +++++++++++++++++------------
 src/core/work-graph/notes/note-service.ts | 63 ++++++++++++++++++++-----------
 src/core/work-graph/notes/scribe-scope.ts | 15 ++++++--
 tests/work-graph/S4A-note-scope.test.ts   | 13 +++++++
 tests/work-graph/S4A-note-write.test.ts   | 63 +++++++++++++++++++++++++++++--
 5 files changed, 162 insertions(+), 52 deletions(-)
```

`git status --short` shows only those five round-1/2 scope files; `.dsh-scratch/` is deleted.

## Fix 1 — returned `overQuota` = committed population

- **Test:** `N-07 %s a committed overQuota equals the read after the commit` (memory + sqlite), `tests/work-graph/S4A-note-write.test.ts`; three exactly-full-goal fixtures (`goalQuota: 2`): (a) structural replacement of an accepted item → `pending_review`, `reasons:['structural']`, literal `overQuota:true`; (b) agent `repair` replacing an accepted understanding → `staged`, literal `overQuota:true`; (c) plain accepted replacement → `accepted`, literal `overQuota:false`. Each write result is compared against `readNote(...).overQuota` right after.
- **Implementation:** `src/core/work-graph/notes/note-service.ts` `writeNote` — new `supersedesNow`/`committedOverQuota` block; `successResult.overQuota` (also the value stored with `NoteWritten` for replay) now uses it. Admission keeps the R6 projection (`anchorFull`/`goalFull` computed from `replacedCurrent` and the deduped `goalHeads`).
- **RED→GREEN:** literal `overQuota:true` received `false` (a pending structural replacement subtracted its not-yet-superseded target) → `true`.

## Fix 2 — L2a class order

- **Test:** `N-20 %s an executor naming a missing task in another goal reads anchor_not_found first` (memory + sqlite), `tests/work-graph/S4A-note-scope.test.ts`; missing `s4a-goal-2/t99` → `invalid`/`anchor_not_found`, existing `s4a-goal-2/t9` control → `forbidden`/`anchor_out_of_goal`.
- **Implementation:** `src/core/work-graph/notes/note-service.ts` `writeNote` — the understanding-compatibility and own-goal checks moved after `resolveNoteAnchors` (class 1 format/duplicate + class 2 existence now run first).
- **RED→GREEN:** missing cross-goal task returned `forbidden`/`anchor_out_of_goal` → `invalid`/`anchor_not_found` (existing-task control unchanged).

## Fix 3 — duty read failure → `unavailable`

- **Test:** none (per the task: the production resolver always answers ready; injecting one is not allowed).
- **Implementation/where:** `src/core/work-graph/notes/scribe-scope.ts`, function `deriveFacts`, the Session loop (~line 195). A `deps.duties` result that is not `ready`, or a throw, now returns `{ ok: false, code: 'unavailable', reason: 'the session duty cannot be read' }` from the whole scope computation instead of silently treating the Session as `'unknown'`. A READY `'unknown'` is untouched (R12).
- **RED→GREEN:** n/a (no test).

## Fix 4 — malformed-anchor feedback keeps the field

- **Test:** extended `N-01 %s malformed shapes are refused invalid with the draft, never thrown` (memory + sqlite) with literal reasons `anchor_invalid: anchor.moduleId` (`{kind:'module'}`) and `anchor_invalid: extraAnchors[1].path` (`extraAnchors:[project, {kind:'file',path:'../escape.ts'}]`).
- **Implementation:** `src/core/work-graph/notes/note-anchors.ts` `anchorFormatProblem` — its `bad()` helper now emits `anchor_invalid: <field>.<subpath>` (non-record → `anchor_invalid: <field>`); `symbolRequestProblem` returns a failing subpath so nested `symbolRequest` shape failures also carry it.
- **RED→GREEN:** expected `anchor_invalid: anchor.moduleId`, received `anchor_not_found` → `anchor_invalid`.

## Round 1/2 assertions changed for fix 4

**None.** No round-1/2 test asserted `anchor_not_found` for a *shape* failure. The seven existing `anchor_not_found` assertions are all class-2 existence cases and were left alone: `S4A-note-write.test.ts:112,116,118` (unknown module id, unknown stage, missing file) and `S4A-note-scope.test.ts:100,109,119,159` (name-as-id, typo, missing file, missing cross-goal task).

## CHECKS

- `npm run typecheck` — pass (both `tsconfig.json` and `tsconfig.ui.json`).
- `npm run check:architecture` — pass (`next source boundaries: OK`).
- `npm run build` — pass.
- `node scripts/build-kernel-patch.mjs --check` — exit 0, 56 files `matches: true`.
- `tests/work-graph/S4A-*.test.ts` — 7 files, **202 tests passed**.
- `tests/architecture/` + `tests/composition/platform.test.ts` — 4 files, **54 tests passed**.

## UNSPECIFIED

1. **Fix 1(b) target kind:** a `repair` may only `replaces` its own kind family, and in 4A a repair is always `staged`; the only *accepted* target it can replace is an `understanding`, so (b) replaces an accepted understanding. The task did not pin the target kind.
2. **Fix 4 nested `symbolRequest`:** I treated the item-14 `symbolRequest` shape as class-1 anchor shape, so it now returns `anchor_invalid: <field>.symbolRequest…` rather than its previous descriptive sentence. If item 14 is meant to keep the descriptive text, that one branch should be reverted.
3. **Fix 1 concurrency:** the "result equals `readNote` right after the commit" rule is enforced for sequential writes; the interleaved-commit test still asserts only `readNote` (L7's soft-limit/no-lock stance). `admitNoteWrite` still computes `overQuota` per R6, but the writer no longer returns it.
4. **Fix 2 duplicate anchors:** duplicate-anchor validation already ran before the existence reads inside `resolveNoteAnchors`; I left it there (observable order is still format+duplicates → existence → class 3), rather than moving it into `writeInputProblem`.