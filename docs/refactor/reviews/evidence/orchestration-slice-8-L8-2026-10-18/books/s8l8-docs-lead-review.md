# Lead's line review of the L8 docs draft (2026-10-18)

1. Evidence README, first line: L8 was built after 8D and the §10 segment merged (STATUS next steps; decision 74 put
   8A without L8 after 4C-1). Write "在 8D 和 §10 段合入后施工、合入", not "按决定 74 在 4C-2 合入后".
2. Evidence README §规模, second bullet: `dsh/impl-final.md` is the build reply, not the book; write "施工回报".
3. Spec §13.11 and lead-acceptance §已知限制: drop the bullet "读取次数是性能上限，不是业务结果" from the known
   limits (it is not a limit; 12/21 are met). If kept anywhere, it belongs under §13.9 as one sentence of why the
   counts matter.
4. The r4 bubblewrap check and the merge-tree full suite: the lead fills them (keep `【lead 填】`), and the sentences
   "s8l8-r4 那一条没有汇总" / "r4 没有汇总" become the lead's numbers.
5. Keep the T list in exactly one full place per document (spec §13.12, lead-acceptance §移到清理轮 T); STATUS keeps
   its one-line summary with the link.
