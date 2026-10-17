# Task: slice 4C-2 session B rework 4 — the 20,000-note measurement's read fixes; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The books and the
lead's rulings are binding; do not make design decisions; report anything undetermined under UNSPECIFIED with the
smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); there is no fixed limit on how many subagents run at once (decision 76), but files
of running subagents must be disjoint and every vitest command uses `--maxWorkers=2`. **Do not end your turn while a
subagent has not reported back.** **Finish within 120 minutes** (the run stops at 130).

## 1. What this copy is

Tag `s4c2-b4` (HEAD) = session B after rework 3 (Codex: mergeable; the merged tree passed the full suite). Before 4C-2
merges, spec-4 §11.7 (line 918) asks for a measurement on 20,000 notes. It found three places that read far more than
the §11.7 budget. Read, in this order:
- `./.dsh-ref/measure-4c2-investigation.md` — the measurement and where the reads come from (line numbers are this HEAD);
- `./.dsh-ref/s4c2b-measure-recheck.out.md` — Codex's recheck (Chinese): items 1–3 must change, item 4 is explained in
  the acceptance, not changed here;
- `./.dsh-ref/verify-measure-fixes.md` — four Claude verifiers, one per fix, with the smallest correct version of each
  fix and the tests (sections "Fix 1", "Fix 2", "Fix 3", "Item 4"; their Fix and Tests parts are the working list; the rulings below settle what they left open).

## 2. Items (binding)

Every item: a failing test first (for the right reason), then the smallest change. Expected values literal, from the
spec or hand-computed (write the arithmetic in a comment). Tests through public entries, memory and SQLite.

1. **The scribe to-dos use the one user-reason function (§11.6 "one function decides the card, the guard and the
   reminder count").** `note-scribe-todos.ts` stops calling `deps.check.checkHeads` for the relation targets and calls
   the note service's `userReasonFacts` (the function the card source and the disposition guard use), passing the plan
   windows the shared anchor reader already read; the `check` dependency goes (composition: `create-platform.ts` ~1463).
   - Carry `readThrough` from the window into the shared reader's rows (no made-up `null`).
   - Read relation targets only for the pending buckets that count (a cancelled goal contributes nothing, §11.5).
   - Delete what only the check's seeding needed (`targetAnchorKeys`; the `understandingTriggers` input of
     `checkHeads` if nothing else passes it — "Fix 1" found none; confirm with grep) and the unused imports.
   - **Ruling A — `symbol_missing` is a file reason.** The non-file retirement reasons of §11.6/L23 are `task_ended`,
     `module_removed`, `interface_removed`, `stage_not_in_current_plan`; `file_deleted` and `symbol_missing` are file
     reasons (session B's rule and the 4C-1 reading). Test ("Fix 1" T1, red today): a user note on a file anchor
     with a symbol, contradicted by a pending agent note; the symbol is renamed away; the to-dos do NOT count the pending
     note (the user reason stays live), and the scribe's accept is `forbidden`.
2. **The reason-facts path reuses the call's plan window for task targets.** The "Fix 2" version: an optional
   `goalPlanWindow` hook on `NoteAnchorFactsDeps`, set only on the reason-facts path (`note-service.ts` ~1081, next to
   `skipCandidates`), fed by `planWindowOf(call)`; `readAnchorGoalFacts` uses the window instead of reading Goal, Goal,
   PlanRevision; on a `not_found` window it reads the Goal once to tell a missing goal from a dangling plan. The write
   path (`anchorFactsOf`) is unchanged (RW-12a/b stay green as they are).
   - **Ruling B — another workspace of the same project.** On this reason-facts path a target anchored to a goal in
     another workspace of the same project is evaluated from that goal's plan window, not `forbidden` (the facts only
     decide whether a user reason is live; nothing is written there). A goal in another project stays `forbidden`. The
     write path's workspace check is unchanged. Test ("Fix 1" T4): two workspaces in one project; a W2 agent note
     that replaces a W1 user-confirmed task-anchored note through a shared module anchor; W2's to-dos and W2's queue are
     `ready`, the user reason is live while the W1 task is active and gone after the task is cancelled through a public
     plan revision.
3. **The project anchor set is read once per call and shared with the check.** `selectProjectHeader` takes the call's
   `anchorSets` map ("Fix 3" ~10-line version: use the entry if present, else read all five slots with
   `headsByAnchorKey` and store the unfiltered set); `buildFindPage` and `readMemoryMaterial` pass their map. The old
   counts in `tests/work-graph/S4C-find-read-bounds.test.ts` RW-12(i)/(ii) change from 25→20 and 37→32 (the book allows
   this edit; recompute and say if your numbers differ); update the comments that say the set is read again.
4. **Read-count tests (the budget lines, hand-computed):**
   - the heartbeat (`readScribeTodos`, "Fix 1" T3 data extended with a task-anchored target): no anchor-set lookups
     for targets, review-status lookups G+1, one pointer batch, one pointed-head batch, one target batch, one plan window
     per goal, one catalog read;
   - the queue's note card source with two task targets of one goal ("Fix 2" T1): Goal readMany 1, plan window 1;
   - the Goal-card material and the find first page (segmented page 1 and 2, unsegmented): project-key anchor lookups 5
     with a small project anchor ("Fix 3" tests 2–5), with the literal project header asserted unchanged.

## 3. Checks

`tests/work-graph/S4*.test.ts`, `tests/work-graph/S5*.test.ts`, `tests/scenarios/S4C2-*`, `tests/app/S4C*.test.ts`,
`tests/business/`, `tests/composition/WP2-wiring.test.ts`, `tests/architecture/` with `--maxWorkers=2`, plus every changed
test file; `npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are
expected. No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 500 words: files changed (production net; tests); each item RED → GREEN with the hand-computed numbers; checks
with numbers; UNSPECIFIED.
