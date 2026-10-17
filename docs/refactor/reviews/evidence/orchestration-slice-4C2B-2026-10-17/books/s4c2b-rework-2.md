# Task: slice 4C-2 session B rework 2 — the quick check's findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The books and the
lead's rulings are binding; do not make design decisions; report anything undetermined under UNSPECIFIED with the
smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), at most 3 subagents at once, every vitest command `--maxWorkers=2`. **Finish within
120 minutes** (the run stops at 130).

## 1. What this copy is

Tag `s4c2-b2` (HEAD) = session B after rework 1 (book `./.dsh-ref/s4c2b-rework.md`, your reply
`./.dsh-ref/s4c2b-rework1-final.md`). Codex's quick check (`./.dsh-ref/s4c2b-review2.out.md`, Chinese): items 1–5, 7,
9, 10, 11 done; item 6 and item 8 partly; three must-fix below. The lead checked item 1 in the code. Your UNSPECIFIED
are accepted: `createCollectionCardSource(spec, readGoal?)` stays; D-09's goal-less seed (a project understanding)
stays.

## 2. Items (binding)

1. **One plan window and one catalog per queue call** (§11.7, §12.7; production). Today the card source reads the
   goal's plan window (`notes/note-decision-source.ts` ~142), then `userReasonFacts` builds a fresh `NoteCall`
   (`notes/note-service.ts` ~908), so a stage target reads the same window again (`planWindowOf`, ~990), and every
   module or interface target resolves its anchor with a fresh catalog read (`resolveNoteAnchors`, ~1004;
   `note-anchors.ts` ~671; `catalog-service.ts` ~815). Fix: `userReasonFacts` takes the windows the caller already
   read (seed the new `NoteCall`'s plan cache with them), and module/interface targets resolve through that
   `NoteCall`'s per-call catalog cache, so one queue call reads each goal's plan window once and the catalog at most
   once, however many targets. The scribe path and the write path keep their behaviour (same caches, same reads).
   **Test:** from the real queue (`queryDecisionQueue`), a counting wrapper on the record store the platform actually
   uses, memory and SQLite; seed through public writes one goal with a pending note whose targets are a stage note
   and two module notes, plus a second goal with one pending note on a file: plan-window reads = 1 per goal, catalog
   reads ≤ 1 per call, relation-target batches = 1 per goal, note-index lookups + NoteHead/CurrentPointer `readMany`
   = 3 per goal; the expected numbers hand-computed in a comment. It must fail on today's code. Replace the current
   `S4C2-read-counts.test.ts` case that reassembles the source and uses only file anchors.
2. **No spy fixture, no fact injection left** (rework 1 item 8): move U7's call-counting wrapper onto the shared
   no-spy fixture over memory and SQLite (`tests/helpers/S4C2-note-card-fixture.ts`) and delete
   `tests/helpers/S4C2-note-decision-fixture.ts`. In `tests/work-graph/S4C2-note-decision-source.test.ts`, delete
   every assertion a public row already covers; any positive, closed or stale case that remains goes through the real
   owners (a saved answer through `decisions/answer`, a real card). In `tests/work-graph/S4C2-U3.test.ts`, keep only
   the forged-proof fault row (~90); the positive fake card (identity `NoteHead`, pins `Goal@7`, ~122–130) goes, or is
   rebuilt on a real card. Say for each deleted test which public test covers it.
3. **Expected values are literals** (rework 1 item 8): with the deterministic note ids, write the card keys and the
   rendered headers the tests compare as literal strings, computed by hand — not through production
   `decisionSourceKey` or `renderNoteHeader` (`tests/scenarios/S4C2-U6-note-card-e2e.test.ts` ~58,
   `tests/helpers/S4C2-note-card-fixture.ts` ~126, and any other place).

## 3. Checks (close-out subagent)

The checks of `s4c2b-rework.md` section 3 with `--maxWorkers=2`; `npm run typecheck`, `npm run check:architecture`,
`npm run build`. Failures listed in `DSH-BASELINE.md` are expected in your sandbox. No real model calls, no git
writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 600 words: files changed (production net; tests), each item RED → GREEN, the deleted tests with the public test
that covers each, checks with numbers, UNSPECIFIED.
