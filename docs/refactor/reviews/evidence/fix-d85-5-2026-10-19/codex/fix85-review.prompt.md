Read-only review for the lead. Do not write any file, do not run tests or builds, no network. Answer in plain Chinese with file:line for every code fact.

This copy is the lead branch at `0e1a9386` plus DSH's change for HANDOFF decision 85-5 (two small fixes). `.lead-ref/` has: the task book DSH followed (`fix85-book.md`, binding), the diff (`fix85.diff`, against `0e1a9386`), the original versions of the changed files under `.lead-ref/base/`, and DSH's reply (`fix85-final.md`; its claims are input, not facts).

Check the change against the book, one by one:

1. Fix A (`src/core/work-graph/tasks/goal-decision-reader.ts`):
   - without `atLeastCursor`, are the store reads, their order and the results exactly as before (compare with `.lead-ref/base/`)?
   - with it, is the check made with `atLeastCursorResult` (`persistence/read-result-failures.ts:22`) on the Goal read's own `readThrough`, with no extra store read?
   - is the order project check → Goal read → workspace check → the new check → the rest?
   - is the reasoning in book rule 4 sound? Every later read in the method happens after the Goal read, with no cached or earlier-read data used for the result. Name any read that comes before the Goal read, or any value that is not read fresh.
   - do other callers of the changed helper behave the same?
2. Fix B (`src/contracts/ledger.ts`):
   - is the bound exactly "above 9,999,999,999 throws `invalid cursor sequence: <n>`"?
   - is everything else unchanged?
   - does any production caller of `makeCommitCursor` now throw where it did not before, for a value it can really reach?
3. The tests (`tests/work-graph/S5-goal-cause-at-least-cursor.test.ts`, `tests/contracts/ledger-cursor.test.ts`):
   - do they go through the public interfaces?
   - are the expected values literal or counted by hand, and not taken from the code under test?
   - would case D85-5a-1 and case D85-5b-1 fail on the base code, and for the right reason?
   - do the cases cover the book's list?
   - are existing tests, helpers, fixtures and the allowlist unchanged?
4. Anything else in the diff that the book does not allow.

Sort findings into 会出错 (wrong behaviour, a broken rule of the book, or a test that does not test what it says) and 不整洁 (naming, comments, small redundancy), each with file:line and the smallest fix. If there is nothing, say so plainly. Under 600 words.
