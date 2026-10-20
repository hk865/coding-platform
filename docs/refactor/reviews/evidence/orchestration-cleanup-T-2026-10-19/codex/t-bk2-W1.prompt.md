# T build wave 1 (TP, TQ): quick check of the changed clauses (HANDOFF decision 80-1: changed clauses are checked once more)

**Read only:** do not modify, create or delete any repository file; no tests, no builds, no git writes, no network.
Answer in plain Chinese with `file:line` for every fact. This copy is the build base (commit 3a9f6d94).

## Background

You checked the T build books earlier. Your answers are `.lead-ref/books-v2/t-bk-TPa.out.md`, `t-bk-TPb.out.md`, and
`t-bk-TQ.out.md`; all three said 改完再施工. The lead then made these changes:

- **The plan.** The five groups no longer run at once. Wave 1 is TP and TQ, in two copies. The test groups T1, T2 and
  T3 start after the lead has merged wave 1, on the merged code, with their own books refreshed. So wave 1's
  whitelists may now include files that were on the T1–T3 lists.
- **Your item fixes.** Each one is appended verbatim to its item as a `书面核对改正` line, and wins over the item's
  动作 when they differ. Your BLOCKED marks stand: DSH leaves those parts undone, and the lead rules on them later.
- **The whitelists.** The bad entries are cleaned, and your `files_add` entries are added. The old versions are
  `t-files-*.v1.txt`.
- **The book, v2** (`t-book.md`; the old one is `t-book.v1.md`). New text covers:
  - BLOCKED in advance;
  - the edit boundary;
  - the files TP and TQ share;
  - the index move only for TP-063 and TP-166;
  - "public" is judged by the rule sheet, keep-note is no exception, and the lead-named list is empty;
  - the order by dependency combination (your section 3/4 tables are binding);
  - one machine-wide typecheck slot through `flock`;
  - the checks run surviving files only;
  - the commit adds `resources runtime-assets.json`.
- **The run files, v2:** `t-run-TP.md`, `t-run-TQ.md`.

## Check only these

1. **The fixes:** each JSON fix in your three answers sits on the right item in `t-items-TP.md` / `t-items-TQ.md`,
   complete and unaltered. List any that are missing, misplaced or truncated.
2. **The whitelists:** each `files_add` of yours is on `t-files-TP.txt` / `t-files-TQ.txt`. Every entry is a real path,
   or a new file that an item names. Report any file a wave-1 item must edit that is still missing.
3. **The shared files:** the run files list exactly the files on both wave-1 whitelists. Check that list against
   both whitelists.
4. **The rules:** the new book text and the run files are unambiguous and agree with the items. Look for two readings
   that would give different code, and for rules your earlier answers asked for that are still missing.
5. **The order:** with the waves, check whether any wave-1 item still needs a change that belongs to a T1–T3 item
   first. If one does, it must be marked BLOCKED or moved.

## Answer

1. A verdict line: `可以施工` or `改完再施工`.
2. One table: 位置 | 问题 | 唯一改法.
3. The same as JSON in one fenced ` ```json ` block: `[{"where", "problem", "fix"}]`.
