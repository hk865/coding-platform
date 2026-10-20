# T run: group TQ (wave 1, v2)

- **Book:** `./.dsh-ref/t-book.md` (v2). **Items:** `./.dsh-ref/t-items-TQ.md` (115 items, v2: 18 of them carry
  书面核对改正 lines). **Whitelist:** `./.dsh-ref/t-files-TQ.txt` (62 files; book rule 1 for the one exception).
- **Book check (binding):** `./.dsh-ref/t-bk-TQ.out.md`. Its item fixes are already copied into your items. Its
  tables of callers, files and "must land together or in order" (section 4) bind you (book rule 9).
- **Base:** tag `t-base` in this copy (= repository commit 3a9f6d94). Count lines and run the ledger against it.
- **Wave 1:** only TP and TQ run now, in two copies. The test groups T1, T2 and T3 start after the lead has merged
  both.
  - `tests/app/S0-attention-edge-label.test.ts` is yours alone: TQ-001 takes over what the T3 list had for it.
  - In `tests/scenarios/S3-query-graph.test.ts`, change only SC02's lines that TQ-001 names.
- **Files TP also edits:** `src/app/host.ts`, `src/app/main.ts`, `src/core/work-graph/model/tool-commit-arguments.ts`,
  `src/core/work-graph/views/graph-context-reader.ts`, `tests/architecture/production-reach-allowlist.json`,
  `tests/helpers/graph-session-fixture.ts`, `tests/scenarios/S3-query-graph.test.ts`. In these, change only the lines
  your items name, and do not reformat or reorder anything.
- **Order:**
  - Production items first: each dependency combination whole, with its callers, fixtures, tests and allowlist
    entries (book rule 9).
  - Then the allowlist note changes. Most of your items are one-line note changes: do them yourself in one pass,
    without subagents.
  - Then the remaining tests.
- **Memory (binding, book rule 10):**
  - Typecheck only as `flock /home/han001/dsh-work/t-typecheck.lock npm run typecheck`, by you, never while a
    subagent runs tests.
  - Subagents run only their own test files, with `npx vitest run --maxWorkers=2`.
  - At most three subagents at once.
- **Do not end your turn before every subagent has reported back.**
- **Reply:** `./.dsh-ref/t-reply-TQ.md` (book §4), ledger `./.dsh-ref/ledger-TQ.txt`.
- **Inputs in `./.dsh-ref/`:** `t-book.md`, `t-run-TQ.md`, `t-items-TQ.md`, `t-files-TQ.txt`, `t-bk-TQ.out.md`,
  `test-rule-sheet-v1.md`, `d1-ledger.py`, `coordinator-mode.md`.
