Quick check of slice 4A (the note core) after its rework, before merge. Read-only: do not edit files, do not run
tests, do not call any model. You may read any file in this repository and in D:/cc-lead-notes.

Repository: the current directory. HEAD dfe3cc9a (slice 2C merged). The index holds slice 4A as it will be merged
(`git diff --cached HEAD`, 25 files): rounds 1 and 2, with the lead's union merge of `src/composition/create-platform.ts`
(record groups, the owner-key list, ONE hoisted `sessionDutyResolver` shared by the Workflow, the 2C line read and the
notes service).

Your implementation review: `D:/cc-lead-notes/impl/s4a/s4a-implrev.out.md` (15 must-fix, 3 should-fix, answers
(a)–(d)). Each item was then checked against the spec and the code; the lead's rulings are section 5 (R1–R13) of the
round-2 book `D:/cc-lead-notes/impl/s4a/s4a-impl-2.md`, and its section 6 holds every item with the fix and tests that
bound the builder. Builder's round-2 report: `D:/cc-lead-notes/impl/s4a/final-2.md` (read its UNSPECIFIED list).

Lead verification on the merged tree (WSL, bwrap): typecheck, boundary check, build, kernel-patch check pass; all
`tests/work-graph/S4A-*.test.ts`, `tests/architecture/`, `tests/composition/platform.test.ts`: 11 files, 252 tests
passed. (Round 1 on the same base passed the full suite, 419 files.)

Check briefly, citing file:line:
1. Each must-fix and should-fix item of your review: fixed, or not (say exactly what is left). Where a lead ruling (R1–
   R13) differs from your proposal, say only whether it leaves a correctness problem.
2. The builder's UNSPECIFIED 1–9, especially 3 (a staged/pending replacement at an exactly-full goal can make the write
   result's `overQuota` differ from `readNote`) and 1 (the symbol locator range is the source query's name span):
   recommend a one-line ruling for each that needs one.
3. Anything new in round 2 that breaks the spec or the test rules (literal expectations, no database reads, no product
   functions as oracles, fixtures only through public services except the two permitted doubles: the commit gate and
   the read-fault double).

Reply under 1,200 words: numbered must-fix items (only what blocks merge, with the concrete fix), then should-fix,
then the rulings for 2, then a one-line verdict ("merge", "merge after listed fixes" or "not ready").
