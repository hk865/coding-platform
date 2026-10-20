# T run: group TP (wave 1, v2)

- **Book:** `./.dsh-ref/t-book.md` (v2). **Items:** `./.dsh-ref/t-items-TP.md` (173 items, v2: 98 of them carry a
  书面核对改正 line). **Whitelist:** `./.dsh-ref/t-files-TP.txt` (350 files; book rule 1 for the one exception).
- **Book check (binding):** `./.dsh-ref/t-bk-TPa.out.md` (items TP-001 to TP-086) and `./.dsh-ref/t-bk-TPb.out.md`
  (TP-087 to TP-172). Their item fixes are already copied into your items. Their tables of callers, files and
  "must land together or in order" (section 3 or 4) bind you (book rule 9). TP-173 (formerly T2-064) lands in the
  same combination as TP-137 (the quick recheck).
- **Base:** tag `t-base` in this copy (= repository commit 3a9f6d94). Count lines and run the ledger against it.
- **Wave 1:** only TP and TQ run now, in two copies. The test groups T1, T2 and T3 start after the lead has merged
  both, so a file on their lists is yours when it is on your whitelist.
- **Files TQ also edits:** `src/app/host.ts`, `src/app/main.ts`, `src/core/work-graph/model/tool-commit-arguments.ts`,
  `src/core/work-graph/views/graph-context-reader.ts`, `tests/architecture/production-reach-allowlist.json`,
  `tests/helpers/graph-session-fixture.ts`, `tests/scenarios/S3-query-graph.test.ts`. In these, change only the lines
  your items name, and do not reformat or reorder anything.
- **Order:**
  - Before you start, write `./.dsh-ref/t-plan-TP.md`. List the dependency combinations from the book check (rule 9),
    and the themes that hold them. Examples of themes:
    - verification rounds and chains;
    - Session provenance and its backfill;
    - execution authorization V1 and dispatch state;
    - plan V1 and legacy proposals;
    - notice positions without `since`;
    - the Role allowlist notes;
    - C1 transfers and N0.
  - For each theme, list its items and files.
  - Do one theme at a time: the whole combination, then the typecheck and that theme's tests, then the next theme.
  - Run subagents in parallel only on themes whose files do not overlap.
- **Memory (binding, book rule 10):**
  - Typecheck only as `flock /home/han001/dsh-work/t-typecheck.lock npm run typecheck`, by you, never while a
    subagent runs tests.
  - Subagents run only their own test files, with `npx vitest run --maxWorkers=2`.
  - At most three subagents at once.
- **Do not end your turn before every subagent has reported back.**
- **Reply:** `./.dsh-ref/t-reply-TP.md` (book §4), ledger `./.dsh-ref/ledger-TP.txt`.
- **Inputs in `./.dsh-ref/`:** `t-book.md`, `t-run-TP.md`, `t-items-TP.md`, `t-files-TP.txt`, `t-bk-TPa.out.md`,
  `t-bk-TPb.out.md`, `test-rule-sheet-v1.md`, `d1-ledger.py`, `coordinator-mode.md`.
