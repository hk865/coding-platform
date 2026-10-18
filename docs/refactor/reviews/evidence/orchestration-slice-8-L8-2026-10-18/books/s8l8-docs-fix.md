# Continue: fix the L8 docs drafts (docs only; Chinese)

The lead read your drafts and had Codex check every fact: `./.dsh-ref/l8-docs-facts.out.md` (Chinese; must-fix items
1–17 and suggestions 1–7, each with the draft file:line, the evidence and the corrected sentence; **S** = the slice-8
spec, **A** = `lead-acceptance.md`, **E** = the evidence README). Same rules as your book: drafts only, no code, no
tests, no git writes. **Finish within 40 minutes** (the run stops at 50). Do not end your turn while a subagent has not
reported back.

1. Apply all of Codex's must-fix items 1–17 and suggestions 1–7 as corrected there. Check each correction against the
   evidence it cites before you write it; if one is wrong, say so in the reply and keep your text. On item 1 the lead
   rules: the cancellation of `requestAutoCapture`'s acceptance is reached by no public step (`auto-capture-driver.ts`
   creates a fresh controller per acceptance and never aborts it); the cancellation of `failAutoCapture` **is**
   reachable (it uses the running round's signal, which Host close aborts) and is partly covered (P06,
   `S8A-L8-observation-state.test.ts:849`); its remaining rows are on T. Rework 4 ruling 2 was wrong for
   `failAutoCapture`; say so once, in spec §13 and in lead-acceptance, as the lead's correction.
2. The lead's own items (`./.dsh-ref/s8l8-docs-lead-review.md`):
   - Evidence README, first line: "在 8D 和 §10 段合入后施工、合入" (not "按决定 74 在 4C-2 合入后").
   - Evidence README §规模: `dsh/impl-final.md` is the build reply ("施工回报"), not the book.
   - Drop "读取次数是性能上限，不是业务结果" from the known limits (spec §13.11, lead-acceptance); at most one sentence
     under §13.9 on why the counts matter, matching Codex item 2's corrected scope.
   - Keep the `【lead 填】` placeholders (the merge commit, the merge suite, the s8l8-r4 check); write "s8l8-r4 的数字
     【lead 填】" instead of "没有汇总".
   - The T list stays complete in exactly two places (spec §13.12, lead-acceptance §移到清理轮 T); STATUS keeps one line
     with the link.

Reply under 250 words: what you changed per item, any Codex correction you did not take and why.
