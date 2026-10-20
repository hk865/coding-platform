# Rule sheet v2: the complete instance list (v1 line 14), second pass

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

Your first pass (`./.lead-ref/t-v2-list.out.md`) was a checked subset. The lead froze v2 with your five wording fixes:
`./.lead-ref/books/test-rule-sheet-v2.md`. Wave 2 of the T round will be frozen against it, so the list must now be
**complete** over `tests/` (helpers included) on this tree.

## List every instance of

1. **A1 public input.** Every call in `tests/` that hands a value to an owner that a route in `src/app/core-routes.ts`
   binds, or to a platform tool, where the value is built in the test (not returned by an earlier public step), and
   the test then goes on. Group by owner (`plans.proposePlan`, messages, decisions and applications, notes, goal
   settings, requeue, notices `seenThrough`, …). For each: `file:line`; value source (hand-written / from a public
   read / from a record, a captured commit or a store read); whether it carries a platform-issued field (credential,
   token, position, cursor, receipt, fingerprint, prepared value) and where that came from; whether the test goes on
   only publicly; verdict **v2 允许** or **F1** (name the clause).
2. **Record-store tests.** Every row in `tests/record-store/*` and its own helpers: does it check the store's own
   contract (**v2 允许**) or an upper owner's business state (**F3**)?
3. **F3 above the store.** Every helper or test outside `tests/record-store/` that commits records through a store
   port, `commitRaw`, `seedCommit` or similar: `file:line` and who calls it (files only, grouped by helper).
4. **A7.** Every use of the three named helpers, inside or outside their bounds.

Your first pass's rows stay valid; you may cite them instead of re-checking them. Only add, correct or confirm.

## Answer

- One table per section; a JSON block `[{"section","file","line","owner","value","verdict","note"}]`.
- Last line: `v2 允许 n，F1 n，F3 n，A7 越界 n` and the words `枚举完整` or `枚举不完整：<what is missing>`.
