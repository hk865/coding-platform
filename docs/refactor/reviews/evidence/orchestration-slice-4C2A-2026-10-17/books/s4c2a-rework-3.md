# Task: slice 4C-2 session A rework 3 — the quick check's findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The books and the
lead's rulings are binding; do not make design decisions; report anything undetermined under UNSPECIFIED.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), at most 3 subagents at once, every vitest command `--maxWorkers=2`. **Finish within
110 minutes** (the run stops at 120).

## 1. What this copy is

Tag `s4c2-a3` (HEAD) = session A after rework 2 (book `./.dsh-ref/s4c2a-rework-2.md`, your reply
`./.dsh-ref/s4c2a-rework2-final.md`). Codex's quick check (`./.dsh-ref/s4c2a-review3.out.md`, Chinese): items 1 and 3
done; 2, 4, 5 partly; four must-fix below. Your UNSPECIFIED items are accepted (C-03's binding route; no partial
`anchorSets`; buckets read before the filter; `recovered` after a full scan and the restart resend with the same id).

## 2. Items (binding; "fault injection is fine, fact injection is not")

1. **Relation targets' understanding anchors join the shared read** (production; `note-scribe-todos.ts` ~161,
   `note-views.ts` ~499/517/522/1234, `note-update-due.ts` ~189): read the pending notes' relation targets first, add
   the understanding anchors among them (e.g. an old stage understanding sharing an extra anchor, `note-service.ts`
   ~943) to the one `readGoalUnderstandingAnchors` call, and pass the triggers it read to the check so they are not read
   again. The read-count test gets a pending note whose relation target is such an understanding, and counts the
   trigger reads too (expect one trigger read per goal).
2. **Item 2's test through the owners** (`S4C2-scribe-reminders.test.ts` ~364–414, ~526): produce the old reminder's
   completion through the public message acceptance / execution chain (as `tests/app/orchestration-mechanism.test.ts`
   ~360–384 does), not by rewriting `acceptedInputs` or a Run's state in a wrapper. The wrapper may only inject one
   failed read. Then write one new pending note publicly; assert: the failed read → no send this period; the next
   period → exactly one new request and one new persisted message (read through the recipient's inbox).
3. **The immediate-send negative case on real records** (~784–901): archive publicly so an unclaimed archive requeue
   exists, then write the goal understanding publicly, then let the real Host run with the real to-do port → no
   message. Its positive twin (archive, no understanding after it → one message) uses the same route.
4. **D-03 with fixed literals**: give the fixture a deterministic note id generator (the note service's injected
   `newId`, `note-service.ts` ~78), write the sorted identity list (`<noteId>@1` …) and its sha256 and the full request
   id as literals in the test, computed beforehand. No run-time computation of the expected value from write results.
5. **Suggestion (do it):** the remaining tests that call the internal reader over encoded records (`S4C2-update-due.test.ts`
   ~259, ~294, ~316) — delete those that the public read-count and M-12 tests already cover; keep any that prove a case
   the public tests do not (say which).

## 3. Checks

The checks of `s4c2a-rework.md` section 3 with `--maxWorkers=2`, plus `tests/composition/WP2-*.test.ts`; then
`npm run typecheck`, `npm run check:architecture`, `npm run build`. No real model calls, no git writes, never ports
3080/3099/44797; probes under `./.dsh-scratch/`, deleted. Any existing assertion that fails beyond section 2: report it.

## 4. Reply

Under 400 words: files changed (production net), each item RED → GREEN, checks with numbers, UNSPECIFIED.
