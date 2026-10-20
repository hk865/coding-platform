# Rule sheet v2: the instances under the new reading, group L7

**Your files:** `./.lead-ref/groups/L7-files.txt` (the other tests/work-graph files).

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

## Why, and the narrower scope

Rule sheet v1 line 14: when the sheet changes, Codex lists every instance **under the new reading**. v2
(`./.lead-ref/books/test-rule-sheet-v2.md`) changes only three things. Your first answer for this group
(`./.lead-ref/first/t-v2g-L7.out.md`) listed far more than that: every public input and every hand-committed record.
Those are judged the same under v1 and v2, so they are **out of scope** here:

- an ordinary public input that v1 already allowed (ids, names, file contents, scripted model replies, request ids,
  texts);
- F3 hand-built records above the store (v2 only restates that they are F3).

List only the instances whose verdict depends on v2's changes:

1. **A1 drafts and outside values.** A value whose type or role is a draft, item, plan or tool-argument object (for
   example `PlanRevisionDraft`, a `*Draft`, a proposal body, a tool's arguments), built in the test or a helper, and
   handed to an owner that a route in `src/app/core-routes.ts` binds, or to a platform tool. v1 said a helper never
   takes a draft; v2 allows it when it meets the whole parameter contract of the real route or tool branch. For each:
   `file:line`, the owner, whether the value meets that contract (or is cast, partial, or sent to a stand-in that
   ignores it), whether the test goes on only publicly; verdict **v2 允许** or **F1** (with the reason).
2. **A1 platform-issued fields.** A public input that carries a credential, display token, position, cursor,
   receipt, fingerprint or prepared value. For each: `file:line`, the field, where its value came from (returned by a
   public step and used as returned / rebuilt from records or a captured commit / issued in the test); verdict **v2
   允许** or **F1**.
3. **Record-store tests** (group L1 only): each row of `tests/record-store/*` and the helpers only they use checks the
   store's own contract (**v2 允许**) or an upper owner's business state (**F3**).
4. **A7:** every use of the three named helpers, inside or outside their bounds.

Your first answer's rows in these four sections may be reused when the code at that line is unchanged; re-check the
rest. A helper defined outside your group counts where your file calls it.

## Answer

- One table per section.
- **No instance:** the files of your group with none of the four, as one list.
- A JSON block: `[{"section","file","line","owner","value","verdict","note"}]`.
- Last line: `v2 允许 n，F1 n，F3 n，A7 越界 n，文件 n/N` and either `枚举完整` or `枚举不完整：<what is missing>`.
