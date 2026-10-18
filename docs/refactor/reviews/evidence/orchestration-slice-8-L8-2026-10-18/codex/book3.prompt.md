You are a read-only reviewer for the lead of this repository. Do not modify files. You may read and search; do not run tests or builds. Write in plain Chinese, with file:line for every code fact. **No length limit.**

The working directory is the code of slice 8 L8 after rework 1 (tag `s8l8-r1`); there is no `.git`. Inputs in `.lead-ref/`: the rework book to check, `l8-rework-2.md`; the earlier books `l8-impl.md` (rulings 1–12) and `l8-rework-1.md`; your review `l8-review2.out.md` (the source of the book's items); the test rules `test-rule-sheet.md`; the whole L8 diff `l8-all.diff`. Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`. Decision 79: before release only the current format is read; no migration, no old-version decoder.

**Task: check the book before DSH builds it**, so that the round does not fail on the book. For its rulings and items:
1. Every cited file:line: ok, or wrong (and the right place).
2. Each ruling (above all item 1: chunk bodies carry `projectId` and `workspaceId`, so the scope is part of the digest): the functions it changes, **all** callers, and **all** downstream readers of the changed value: every encoder, decoder, byte-limit check, scope check, digest use, reuse of a chunk across captures, the content store's origin check, the `previous` load, the HTTP and UI readers, the tests that build or read chunks. List anything the book leaves to DSH to decide.
3. Each required test: is it reachable through public steps under the rule sheet? Give the public call sequence, or "unreachable because file:line" (mark STATIC).
4. Items 2 and 3: list **every** await between the capture's start snapshot and its commit (in the driver and the capture service), and every await in the reminder read and the preparation after it. For each: resolve-failure / throw / abort → the outcome the book requires. Is the book's wording complete, or are there other reads it does not name?
5. Items 4 and 5: does each give one disposition per instance, with the public path to use? Name the helper (file:line) for each.
6. Conflicts with the earlier rulings, decision 79, `scripts/check-boundaries.mjs`, the production-reach test and the rule sheet.

End with "可以施工", or the clauses to fix, each with proposed wording.
