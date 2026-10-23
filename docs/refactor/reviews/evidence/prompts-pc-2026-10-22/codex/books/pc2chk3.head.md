# Quick check of the PC-2 task book, v3 (the one quick check after two full reviews)

You are checking, read only, the lead's task book for PC-2, version 3 (below). The tree at `D:\cxt\pc` is the lead
branch at `dc462a95`; W's commit `87f16ba` is the patch `D:\cc-lead-notes\codex2\pc\w-87f16ba.patch`. PC-1's frozen
book is `D:\cc-lead-notes\impl\pc\pc1-book.md`, PC-1a's interface table `D:\cc-lead-notes\impl\pc\replies\pc1a-am-reply.md`
§4. Your second review of v2 is `D:\cc-lead-notes\codex2\pc\pc2chk2.out.md`; the lead's rulings on it, which v3
applies, are `D:\cc-lead-notes\impl\pc\pc2-chk2-rulings.md` (L1–L4 from the lead's own review, C1–C9 on your
findings, D8). DSH's reply on the edit: `D:\cc-lead-notes\impl\pc\replies\pc2-book3-reply.md`.

**Read only:** do not modify, create or delete any file; no tests, no builds, no git, no network. Answer in plain
Chinese, with `file:line` for every fact about the code.

**The lead already found these two in v3; do not report them** (fixed before freeze):
1. `PromptPartsV1.tools` must carry the raw entries (`{ name; packId; entry: ToolTextV1 }`), not digests and refs:
   `storePromptTexts` builds the canonical body, stores it and writes `{ name, packId, digest, ref }` into the set,
   as PC-1's parts carry raw texts.
2. The assembler's pack argument is PC-1's, where PC-1 puts it; PC-2 adds only `toolNames` and `history` beside it,
   instead of moving the pack into a new `text` object.

This is a quick check, not a third full review. Check only:

1. **Each of the 14 rulings** (L1–L4, C1–C9, D8): 已修 / 部分修复 (what is missing) / 未修. One line each.
2. **Anything the v3 edits themselves broke:** signatures that would not compile or name types that exist nowhere
   (tree, W's patch, PC-1's book or table); the new assembler seam (`ContextWorkHistoryInputV1`,
   `ContextQueryHistoryInputV1`, `AssembledContextV1.historyDecision`) against `context-types.ts` ~59 and the two
   recipes; `finalToolNamesOf`'s per-family conditions against the lines they cite; a file in two groups in §4.
3. **Can the run still end green** on typecheck, build, `check:architecture` and the old tests other than §5.3's,
   with the rulings as written?

Only blocking or should-fix problems; no style remarks, no new topics outside the above.

## Answer

First the 14 status lines, then any new finding numbered, each with severity (阻塞 / 应改), the place, the evidence
(file:line), and the change to the book text. End with one line: `结论：可冻结` or `结论：改后再核`.

---

# The book (v3)
