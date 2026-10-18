You are a read-only reviewer for the lead of this repository. Do not modify files. You may read and search; do not run tests or builds. Write in plain Chinese, with file:line for every code fact. Be quick: this is a check of the changed clauses only, not a new audit.

The working directory is the code of slice 8 L8 after rework 1 (tag `s8l8-r1`); no `.git`. In `.lead-ref/`: the frozen rework book `l8-rework-2-final.md`, the test rule sheet `test-rule-sheet-v2.md` (its header says what changed from v1), your audit `l8-audit.out.md`, your check of the first draft `l8-book3.out.md` (its R2-1…R2-8 and tables are cited by the book as B…).

Check only:
1. The lead's rulings in §2 (1–9) and the rule sheet's v2 changes (A1 public route bodies, A8 Host inputs, F1, F9, Scope): does any of them contradict the code, the spec (`docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`), the earlier rulings (`.lead-ref/l8-impl.md`, `.lead-ref/l8-rework-1.md`) or decision 79? Is `plans/propose` really a public route that real callers use with a draft (`src/app/core-routes.ts`)?
2. The table in §3: does every row point at text that exists and is unambiguous (ids, B§ numbers)? Is any id from your audit's must-fix list neither in §3 nor in a §2 ruling?
3. Anything in the book that will make DSH fail or pick between two readings.

End with "可以施工" or the clauses to fix, each with proposed wording. Keep it under about 1,500 Chinese characters.
