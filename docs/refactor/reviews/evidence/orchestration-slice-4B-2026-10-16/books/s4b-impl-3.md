# Task: slice 4B round 3 — the quick check's eight fixes; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec is frozen;
do not make design decisions; where this message and the earlier rulings do not determine something, list it under
UNSPECIFIED.

**This run is headless. When your turn ends, the whole run ends.** If you start subagents (at most 1), stay in your turn
until it has reported (wait with `sleep 120`, then `list_agents`). Keep your context small: `grep -n`, `sed -n a,bp`.
**Finish within 40 minutes** (the run stops at 45): do the items in the order below and finish whole items.

## Context

- The copy's commits: `slice-setup` (lead branch with 2C, RL, 4A), `slice-base` (DSH-BASELINE), `lead: 4B round 1`, and
  the working tree holds **round 2** (uncommitted; it is your base — do not revert it).
- Binding inputs in `./.dsh-ref/`: `s4b-impl.md` (section 10, P1–P14), `s4b-impl-2.md` (section 5, rulings R1–R16; section
  6, the items), `s4b-final-2.md` (round 2's report), `s4b-quick.out.md` (the quick check; its must-fix 1–8 are the items
  below). The TDD skill: `./.dsh-ref/tdd/`. Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`.
- Rules as round 2's book sections 3 and 4 (scope, frozen files, tests through public interfaces, literal expectations,
  no database reads, no real model calls, no git writes, never ports 3080/3099/44797), with these changes:
  `src/core/record-store/record-codec.ts` must end up **unchanged** (item 8).
- **Tests:** run only the S4B test files you touch, the S4B suite once at the end, and `tests/work-graph/S4A-*.test.ts`
  plus `tests/composition/platform.test.ts` once at the end, all with `--maxWorkers=2`. **Do not run the full suite**
  (the lead runs it; the machine is busy). Also `npm run typecheck`, `npm run check:architecture`.

## Items (one failing test first, then the fix; quick check must-fix numbers)

1. **Message facts check the revision** (`views/note-views.ts:732`): move the revision comparison (R1) before the
   message-specific success return; test: a message fact at revision 999 → `unresolvedFacts` `version_ahead`,
   `freshness: 'unchecked'`, `currentEligible: false`.
2. **Symbol missing needs an analysed file** (`note-views.ts:320`): zero hits are `symbol_missing` only after the captured
   file was read and analysed; a captured file that is missing or unreadable → `unchecked` (R4).
3. **R7 and terms** (`notes/note-read-model.ts`): (a) `'all'` results carry **no** `ranking` field (R7 overrides the
   item text; change `S4B-memory-ranking.test.ts:44,65` accordingly); (b) an explicitly supplied `terms: []` is
   `invalid` (L10's 1–8 terms; same reason code the port uses); (c) **lead ruling on the cap signal:** for `'all'`, each
   `memoryFind` page makes **one** port call (from the cursor's last examined refKey); it returns the filtered matches
   of that port page — fewer than `limit` is fine — with `complete: false` and a cursor whenever the port page was not
   complete (L12: short and empty pages are valid). Remove the short-page heuristic.
4. **Pinned body cursors bind the head version** (`note-read-model.ts:954`, `:1003`): store the head version in every
   body cursor, also when the request pins a version; a later head change → `revision_conflict` (R10).
5. **R11 at both boundaries**: (a) `note-views.ts:952`: `checkNotes` itself gives `currentEligible: true` only when the
   checked version is the head version; (b) compute `body_target_not_on_page` **after** the byte trim
   (`note-read-model.ts:1199`, `:1265`).
6. **Deletion-proof read failures** (`note-views.ts:627`): `hasDeletionProof` returns an outcome; a failed or undecodable
   read → the check answers `unavailable`, never `deleted_path_unverified`.
7. **R16 coverage**: parameterize over both backends `S4B-memory-version-lists.test.ts:52`, `S4B-note-budget-check.test.ts:27`,
   `S4B-note-missing-flows.test.ts:38` (and any other NE3 file still memory-only, as time allows — list the rest); add the
   read-side `forbidden` case (a basis file that becomes a symlink pointing outside the workspace, or the workspace's
   forbidden path rule — whichever the workspace tools treat as `forbidden`) → that item `unchecked` with outcome
   `forbidden` in `observedFiles`.
8. **Revert the out-of-scope helper** (`record-store/record-codec.ts:50`, `unavailableFailure`): return the rejection
   locally in `sqlite-record-store.ts`; `git diff slice-base -- src/core/record-store/record-codec.ts` must be empty
   (the file equals `slice-setup`'s).

**Lead ruling on UNSPECIFIED 3 of round 2:** `filesRead` counts every distinct path the page attempted, including
`forbidden`, `capacity` and `unavailable` outcomes (they consume the budget). No change needed if that is what the code does.

## Reply

Under 600 words: FILES CHANGED; per item the test name(s), file:symbol, RED/GREEN; items not finished; CHECKS with
numbers; UNSPECIFIED (short).
