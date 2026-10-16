You are a read-only reviewer for the lead of this repository. Do not modify files. You may run read-only commands. Do not run tests or builds. Write the report in plain Chinese, with file:line for every code fact.

This checks the 4C-1 rework part 3. The working directory is the code after it. Your previous quick check is `.lead-ref/s4c1-delta.clean.md`; the lead's verified rulings for part 3 are `.lead-ref/s4c1-rework-3.md` (items 1–6); the agent's reply is `.lead-ref/s4c1-rework3-final.md`; the diff of part 3 (production and tests) is `.lead-ref/s4c1-rework3.diff`, file list `.lead-ref/rework3-stat.txt`.

Check only:
1. For each ruling item 1–5, is it fixed as ruled (yes / partly / no, with file:line)? For item 1, confirm no module-level or ctx-keyed cache is left in the notes and views code it touched, and that a goal's plan window is read once per call.
2. Did part 3 introduce a new defect or regression in the files it touched (the new per-call objects passed down through writeNote/reviewNote/withdrawNote and their reads; the moved resolution check; trim coverage; graph-context path search and its "path equals the query" branch; the batched relation read and its error handling)?
3. Do the changed and new count literals (find read bounds 7→5 and 10→8, RW-12a 13→12, the new RW-12b through the record_note tool) match §11.7 of `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` for their fixtures, with derivations that add up?
4. The agent's UNSPECIFIED list: is each choice consistent with the spec and the rulings, or does one need a change?

For every problem, mark it "必须改" (affects use or correctness) or "建议" (cleanliness, readability), and give the fix approach (修改思路): where, how, and why this is the smallest or the cleaner way. Do not list style preferences that change nothing. End with one line: "可以合入" or "先改完列出的几处". Keep it under about 2,000 Chinese characters.
