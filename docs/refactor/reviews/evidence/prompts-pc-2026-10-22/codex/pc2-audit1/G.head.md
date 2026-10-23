# PC-2 audit, part G: the guard, the entry and I-19 (ruling 12; PE9)

Your part is `G`: `./.lead-ref/parts/G.diff` and `G-files.txt`: `src/core/work-graph/state/context-input.ts`,
`src/core/work-graph/tasks/execution-entry-service.ts`, `src/core/work-graph/queries/query-execution.ts` (the Query
manifest check of the new fields), `tests/state/invariants.ts` and the old tests G owns (book §4 and §5.3:
`tests/state/invariants.test.ts`, `context-input.test.ts`, `WP1-goal-content.test.ts`,
`tests/work-graph/S3-prepared-context-admission`, `K3-35-owner-manifest-trim`, `tests/runtime/K3-unknown-call-review-section`,
`tests/helpers/WP1-units-fixture.ts`), and G's new tests (`tests/state/PC2-G-context-order`,
`tests/work-graph/PC2-G-entry-guard`). The book ruling 11 (the binding's order), ruling 12, §5.2 PE9 rows and PC-21's
guard half, §5.3 (G's lines).

**Look hardest at:**

- **The guard.** `SECTION_ORDER` dropped; the binding's `sectionOrder` checked itself (role first, each once, inside
  the call kind's legal set, `goal` and `task` present where required today); the sections appear in that order; the
  re-rendered text accepted only when the binding's byte range equals it (`utf8Slice`, not only the ends) **and** it
  occurs exactly once in the input; the brief and review no longer required last or at the end. Does the guard still
  reject everything it rejected before that the book did not loosen (a missing section, a range outside the input,
  overlapping ranges, an omission marker it checks with literals)? A loosening the book did not ask for is
  **会出错**: give the input that used to be rejected and is now accepted.
- **"Exactly once".** How is uniqueness checked (`indexOf` / `lastIndexOf`)? Does an occurrence that overlaps the
  range itself, or one inside another section, count? Is the check on bytes or UTF-16 indices, and can a multi-byte
  character make the range check and the uniqueness check disagree?
- **The entry.** At `execution-entry-service.ts` (brief ~975, ~1201; review ~1053): reads the frozen template and
  string table back, re-renders with `promptSet.toolNames`, calls the guard's range-and-unique check; never the
  current pack; a changed character still `invalid`. WorkGraph imports no Runtime module.
- **The Query manifest check** (`queries/query-execution.ts`): the new required fields (`sectionOrder`,
  `takesSessionHistory`, the tool fields) checked, not just passed.
- **I-19** checks by the binding's range in the same way and does not assume a fixed line.
- **Old tests:** each change is the mechanical one §5.3 names (sectionOrder added, the new required manifest fields,
  the tail assumption removed); no other assertion weakened. Compare each changed old test hunk with `base/`.
- **Tests:** PE9's separate rows (a wrong range, a duplicated text, a non-tail success) through the public entry with
  literal inputs; `PC2-G-context-order`'s four mutations (role first, legal name, duplicate, order). Name a mutation
  each would miss (e.g. comparing only the range's start, checking uniqueness with `includes`, accepting an order that
  is legal but differs from the frozen set's).
