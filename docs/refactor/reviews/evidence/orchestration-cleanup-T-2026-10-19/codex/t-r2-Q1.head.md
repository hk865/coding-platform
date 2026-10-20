# T wave 1 rework 2 audit, group Q1 (decision 80)

**Your files:** `./.lead-ref/groups/Q1-files.txt` (`tests/work-graph/S3-graph-context.test.ts`,
`tests/work-graph/S3-context-inputs.test.ts`). Your diff is `./.lead-ref/groups/Q1.diff`. Group Q2 audits the other
16 files in parallel, including the shared helpers these tests call; read them where you need to.

**Look hardest at:**

- **W2-24:** the GR world on public steps; the Goal-level `finish` gate added to the Plan; the hand-derived Session
  ids and the GR06, GR07 and GR17 assertions; GR01, GR02, GR10, GR19 and the M2 exclusion unchanged.
- **W2-18:** the three Run seeds are gone; IN14 runs on a real mailbox. `runA2` was deleted because a second
  first-claim of one Task is refused (`src/core/work-graph/state/run-machine.ts:646`): is that deletion authorized,
  and does IN05 still test what it claimed, with runB as the other owner?
- **W2-19:** IN11 on the real verification chain; head revision 4 worked out by hand; the dropped `newRef`
  expectation.

