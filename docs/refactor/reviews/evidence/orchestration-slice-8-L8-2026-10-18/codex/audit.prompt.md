You are a read-only auditor for the lead of this repository. Do not modify files. You may read and search; do not run tests or builds. Write the report in plain Chinese, with file:line for every code fact. **There is no length limit: completeness matters more than brevity.** One line per instance.

The working directory is the code of slice 8 L8 after rework 1 (tag `s8l8-r1`). There is no `.git`. Inputs in `.lead-ref/`:
- `l8-all.diff`: the whole L8 change from the slice base; `l8-all-stat.txt`; `l8-files.txt` (33 files: the audit scope).
- `test-rule-sheet.md`: the test rules v1 (default deny; A1–A7 allowed, F1–F12 forbidden, with examples). It binds every test.
- `l8-impl.md` (the construction book, rulings 1–12 and §3 rows), `l8-rework-1.md`, `l8-rework1-final.md` (DSH's reply), and `l8-rework-2.md` (the next rework's book, items 1–6, already decided).
- `l8-review1.out.md`, `l8-review2.out.md`: your two earlier reviews, which were capped and only gave examples.
- `d1-s8l8-r1.txt`: the assertion ledger (no weakened assertions found).
- Spec: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md` (the L8 rows).

**Task: one exhaustive audit of the whole L8 change**, so that rework 2 can fix everything in one round. The items of `l8-rework-2.md` §2 are already known: list them under KNOWN with every instance, and find everything else.

Read every line of every file in `l8-files.txt`; for src files, read each changed function whole, and its callers. Do not sample. If you cannot finish a file, list it under UNREAD; never call an unread file clean.

Classes:
- **T. Tests:** every rule F1–F12 and "Every row also" in the rule sheet.
- **P1. Silent defaults.** For each new or changed async chain in src (the auto-capture driver, the Host triggers and start-up retry, the observation-state read, the reminder read in the context assembler and the execution preparation, the capture service): each await × resolve-ok / resolve-failure / throw / abort (cancellation) → what happens. Flag every path that ends as a normal answer, a silent return, a pending request with no reason, or a swallowed cancellation.
- **P2. Triggers.** Every path that registers a workspace, adopts, revises or PASSes × new / replayed / restored at start-up / closed Host → does it trigger exactly as the books say.
- **P3. Scope.** Every stored or content-addressed value that L8 reads or writes: is it scoped to its project and workspace; can two workspaces (a clone, a worktree, empty projects) collide, as in rework-2 item 1.
- **P4.** One rule in one place; leftovers (unused types, constants, branches, fields, parameters); declarations that no production entry reaches.
- **P5. Spec details:** order, caps, data source, row text, time text and edge cases of the L8 rows against the code.
- **P6. Row coverage:** each L8 row (spec and book §3) → test file:line, both backends where required, the hand-computed literal, and whether removing the production check it guards would make it fail.

Output:
1. **COVERAGE:** one line per file in `l8-files.txt`: file | read fully? | classes found, or "clean on T, P1–P6" | the last test title or function you read.
2. **KNOWN:** rework-2 items 1–5, each with every instance (file:line), plus any sibling instance the book does not name.
3. **FINDINGS per class:** class | every instance (file:line, why) | the systemic fix | ONE disposition per instance (the public path with the helper's file:line, a named pure test, a production fix, or delete). Never offer alternatives. Mark each 必须改 or 建议.
4. **P1 TABLE:** call site | resolve-failure | throw | abort → current outcome → required outcome.
5. **ROW TABLE (P6).**
6. **STATIC claims:** runtime behavior you could not verify by reading, with the exact public call sequence it relies on.
7. **OPEN QUESTIONS** the books and the rule sheet do not decide. Do not decide them; give the smallest options.
8. **SEARCH LOG:** the searches and reading checks you ran, so they can be rerun.

End with one line: the number of must-fix instances outside KNOWN.
