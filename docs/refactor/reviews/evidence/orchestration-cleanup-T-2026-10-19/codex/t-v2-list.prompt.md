# Rule sheet v2: list every instance on the merged wave-1 tree (v1 line 14)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

The tree is T round wave 1 merged (HANDOFF decision 79-4). The lead plans to freeze rule sheet v2 before the wave-1
rework, so the rework and wave 2 are both bound by it. v1 is `./.lead-ref/books/test-rule-sheet-v1.md`; the v2 draft is
`./.lead-ref/books/test-rule-sheet-v2-draft.md`. v1 says a new version applies from the next freeze, after every
instance under the new reading is listed. List them.

## What to list

1. **A1, public input.** Every place in `tests/` where a helper or test passes a value to `plans.proposePlan` (the
   owner that the `plans/propose` route binds, `src/app/core-routes.ts:388`, `:1067`) or to the plan proposal tool,
   and the test then goes on. For each: `file:line`, what the value is (hand-written body, built from a public read,
   or built from a record or a derived value), whether the test then goes on only through public steps (review,
   apply, adopt), and the verdict: **v2 允许** or **仍是 F1** (say which derived value it hands over). Also say
   whether the value has exactly the shape the route receives (`src/app/core-http-types.ts` and the binding's
   parameter type), or a narrower internal type.
2. **A1, other "drafts" a public route or tool receives.** Search for other owners that a route in
   `src/app/core-routes.ts` binds and that tests feed a hand-built body (messages/send, decisions, notes, goal
   settings, requeue, and so on). Same columns. Only list the ones a test then continues from.
3. **A1, the record store's own tests.** Every file under `tests/record-store/` and every helper only they use that
   builds records and commits them through the store port: **v2 允许**. Every test of a module above the store that
   does the same: **F3** (`file:line`).
4. **A7.** For each of the three named helpers: every use (`file:line`), and whether each use stays inside the v2
   bounds (only that file; only the adapter; never an owner's state; never results of checks or commands).
5. **Problems with the v2 text itself:** a case where the reading is ambiguous, or where v2 would allow something
   that hides a production gap. Give the case and the smallest wording fix.

## Answer

- One table per section above.
- Then a JSON block: `[{"section", "file", "line", "value", "verdict", "note"}]`.
- Last line: `v2 允许 n，仍是 F1 n，F3 n，A7 越界 n，措辞问题 n`.
