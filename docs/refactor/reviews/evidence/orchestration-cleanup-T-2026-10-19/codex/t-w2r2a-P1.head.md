# T wave 2 rework 2 audit, part P1

Your part is `P1`: `./.lead-ref/parts/P1.diff` and `./.lead-ref/parts/P1-files.txt` (41 files, the change
`w2r1b` → `w2r2`); base `./.lead-ref/base/`. Your rows: all of `t-w2r2-findings.md` §1 (W2c-01 to W2c-14).

**Look hardest at:**

- W2c-01 (`tests/work-graph/S4C2-goal-triggers.test.ts`): is the graph read the agent uses really taken after the
  archive requeue, so the `rework.entries` item is the archive's own record, and does a wrong archive `at` now fail?
  Were only the deleted case's own imports removed?
- W2c-03 (`tests/runtime/R4c-execution-history.test.ts`): the new `noLowerRequest` option of the refusal frame: does
  it observe every lower call of the refused read (and nothing from the setup), and does each of the four rows now
  fail without the reader's own check (`src/core/agent-runtime/observation-recovery.ts:260`, `:269`)?
- W2c-04: the canonical text and the 183 bytes in the comment against `catalog-record-codecs.ts:193-202` and the
  key order of `canonicalJson` (`src/contracts/fingerprint.ts`).
- W2c-05: the two public reads before the reopened platform closes: do they assert the same facts the removed
  database reads did?
- W2c-14: with `later` now `pending_review`, does the wider page still return `pending` and `decided` and a cursor after
  `decided`, so the bounded query shows the cursor is a keyset bound?
- W2c-07: 53 removals in 27 scenario files; anything else changed there?

