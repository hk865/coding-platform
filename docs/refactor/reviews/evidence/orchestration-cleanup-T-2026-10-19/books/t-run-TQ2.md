# T run: group TQ, segment 2 (lead, 2026-10-19 19:50)

Segment 1 stopped at the context limit (360k). Your work so far is uncommitted in this copy.

- **Read first:** `./.dsh-ref/t-reply-TQ.md` (segment 1's reply; its HANDOFF section says where it stopped), book
  `./.dsh-ref/t-book.md` §2 rules 1–8 and §3–4, and this file.
- **Items:** `./.dsh-ref/t-items-TQ.md` is large (141 KB). Look up only the items you need, by id (`rg -n "TQ-091"`);
  do not read the whole file.
- **Do not redo items.** Segment 1's results stand.

## Lead rulings on segment 1

1. **Typecheck lock.** The lock in the book is outside your sandbox. Run the typecheck as plain `npm run typecheck`,
   only by you, never while a subagent runs tests. The rest of book rule 10 stands.
2. **Two fixtures stay as they are.** `tests/work-graph/R4b-session-directory.test.ts` and
   `tests/helpers/task-claim-fixture.ts` belong to group TP, which is running now. Do not edit them; the lead adds
   their catalog rows when the two groups are merged. Their failures in your copy (R4b-session-directory 2,
   S2B-34-executed-files 4) are expected: list them as known.
3. **`tests/helpers/S5-decision-fixture.ts`:** your catalog-row change stays (TQ-091 downstream, reported).
4. **Left for the lead:** TQ-001's `plan:p1`, TQ-111 lines 22–62, TQ-103/104/112/114/115. Leave them as they are.
5. **Environment failures:** tests that fail only on `ENOENT /usr/bin/bwrap` (RL-12-15, A2-automation-verdict,
   S8A-L8-pass-capture) are run by the lead with bwrap. List them; do not chase them.

## What to do

1. `git status --short` and `git diff --stat`: check that the working tree matches segment 1's HANDOFF (57 changed
   files plus the deletions it lists).
2. `npm run typecheck` and `npm run check:architecture`, both green.
3. Commit as book §3 says (`git add -A -- src tests scripts resources runtime-assets.json`, message `T TQ`).
4. Run the ledger: `python3 -I ./.dsh-ref/d1-ledger.py . t-base HEAD > ./.dsh-ref/ledger-TQ.txt`.
   - Map every REMOVED or LOOSENED line, and every deleted file, to one item id.
   - A line you cannot map is an unplanned deletion: undo it, re-run that file's tests
     (`npx vitest run --maxWorkers=2 <files>`), and commit again (`T TQ fix`). Then run the ledger again.
5. Update `./.dsh-ref/t-reply-TQ.md`:
   - Keep segment 1's text.
   - In §4, replace the "not committed / no ledger" lines with the results.
   - Add `## 6. 第二段`:
     - commands and pass/fail counts;
     - the ledger mapping, as a table: 文件 | REMOVED/LOOSENED 行 | 条目;
     - unmapped lines (there should be none);
     - `git diff --shortstat t-base HEAD`.

## Subagents

- Allowed only for the ledger mapping, split by file. At most three at once.
- Subagents do not run the typecheck.
- **Do not end your turn before every subagent has reported back.**
