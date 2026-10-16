# Task: note-search speed round 1, rework part 2 — three small items from the last review

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The previous
session's rework (book `./.dsh-ref/s4f-impl-2.md`) is in the working tree, uncommitted. Fix exactly these three items;
change nothing else. **This run is headless; when your turn ends, the whole run ends.** Do not start subagents. Keep your
context small (`grep -n`, `sed -n a,bp`). **Finish within 40 minutes** (the run stops at 45).

1. **SP-19 (`tests/work-graph/SP-note-reuse.test.ts`) must really exercise each branch.** Today its three notes have no
   relations, so `neighbors` gets an empty set and returns before the check, and history has only version 1, so the
   non-head version path is never used. Through the public write service, give the notes real relations (one note
   `replaces` or `contradicts` another on the same anchor) so `neighbors` and `conflicts` return a target, and give one
   note a second version (a review or accept disposition) so `history` lists a non-head version and `readNote` is also
   called with `version` set to the older version. Assert the returned items (noteIds, versions) as literals. Check that
   the test fails if the reuse wiring is removed (revert one wire temporarily, see RED, restore).
2. **SP-33 (`tests/record-store/SP-literal-type.test.ts`) must catch a missing type filter in every shape it lists.**
   - Plain count: give W and V a shared value (both have a row with the same indexed value) so that a count without the
     type term would add the other type's row.
   - Ordered lookups with `bound`: choose bounds that actually exclude rows, in both directions (asc with a lower bound
     that drops W's/V's first row, desc with an upper bound that drops the last), and assert the exact remaining rows.
   - Keep expected keys as literal strings.
3. **`sqlite-text-scan.ts`:** the fixed `UPDATE next_text_meta …` statement becomes a module-level constant, prepared
   through the statement cache like the others.

Checks: `tests/record-store/`, `tests/work-graph/SP-*.test.ts`, `--maxWorkers=2`; `npm run typecheck`. Reply under 300
words: what changed, RED → GREEN evidence for items 1 and 2, checks.
