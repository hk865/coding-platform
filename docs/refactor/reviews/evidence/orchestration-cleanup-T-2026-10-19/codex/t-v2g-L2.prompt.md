# Rule sheet v2: the complete instance list, group L2

**Your files:** `./.lead-ref/groups/L2-files.txt` (tests/scenarios).

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

## Why

Rule sheet v2 (`./.lead-ref/books/test-rule-sheet-v2.md`, changing v1 `./.lead-ref/books/test-rule-sheet-v1.md`) was
frozen for T wave 1's reworks, which are now finished (this tree, `d4c4cea`). Before wave 2 of the T round is frozen,
v1 line 14 needs the **complete** list of v2's instances. Your two earlier passes over the whole of `tests/`
(`./.lead-ref/t-v2-list.out.md`, `./.lead-ref/t-v2-full.out.md`) were each incomplete, so the list is now split into
seven groups of files. You do one group, and your list must be complete for it.

Wave 1 changed many files since those passes: re-check every hit; cite an earlier row only when the code at that
line is unchanged.

## Method

1. Search every file in your group (`rg -n`) for the forms below, then open each hit. Suggested starts, not limits:
   `commitRaw`, `seedCommit`, `.commit(`, `records.put`, `rawBodies.put`, `encode[A-Z]\w*Snapshot`, `proposePlan`,
   `sendMessage`, `respondMessage`, `seenThrough`, `requeueTask`, `setGoalSettings`, `writeNote`, `damageKernel`,
   `process-sandbox-standin`, `executeChecks`, `buildNoteTools`.
2. A helper defined outside your group counts where your file calls it: list the call, and name the helper's file.
3. Before you answer, compare your hits with the file list: every file in your group appears in your answer, either
   with its rows or under "no instance".

## List every instance of

1. **A1 public input.** A value built in the test (not returned by an earlier public step) handed to an owner that a
   route in `src/app/core-routes.ts` binds, or to a platform tool, after which the test goes on. For each:
   `file:line`; the owner; the value's source (hand-written / from a public read / from a record, a captured commit or
   a store read); any platform-issued field (credential, token, position, cursor, receipt, fingerprint, prepared
   value) and where it came from; whether the test goes on only publicly; verdict **v2 允许** or **F1** (name the
   clause).
2. **Record-store tests** (only if your group has `tests/record-store/`): each row checks the store's own contract
   (**v2 允许**) or an upper owner's business state (**F3**).
3. **F3 above the store.** Every place outside `tests/record-store/` that commits records through a store port,
   `commitRaw`, `seedCommit` or similar, or writes a body or record directly: `file:line`, what it writes, and which
   test files reach it.
4. **A7.** Every use of the three named helpers, and whether it is inside or outside their bounds.

## Answer

- One table per section.
- **No instance:** the files of your group with none, as one list.
- A JSON block: `[{"section","file","line","owner","value","verdict","note"}]`.
- Last line: `v2 允许 n，F1 n，F3 n，A7 越界 n，文件 n/N` (files covered / files in the group) and either `枚举完整` or
  `枚举不完整：<what is missing>`.
