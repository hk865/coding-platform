Read-only book check for the lead. Do not write any file, do not run tests. Answer in Chinese with file:line.

`./.lead-ref/c1/c1-book.md` is the lead's task book for the cleanup round C1, to be given to DSH (an implementing agent) one group per run, G1 first. It points DSH at your two reports `./.lead-ref/c1/c1-refresh.out.md` and `./.lead-ref/c1/c1-delta.out.md` (the delta wins) as the item list. This copy is the tree DSH will work on (K3 merged; the K3 make-up only touches tests and the Kernel sandbox patch, not `src/core/work-graph`).

Check:
1. Can DSH do G1 from the book plus your reports alone, without guessing? List each G1 item (XX-1, XX-2/SE-1, XX-5, XX-6, XX-7/TA-7, rejection helpers, the K3 duplicates in G1 files, PE-1, comments) and say whether its shared position, its call sites inside G1's files, and its must-keep differences are stated precisely enough on this tree. Where not, give the missing fact (file:line).
2. Does any book rule contradict your reports or the code (e.g. rule 2 "keep every existing export as a re-export", rule 4 "tests do not change", rule 6 scope)? Is anything in G1 likely to change behaviour despite the rules (a helper whose two copies differ subtly)? Name each with both locations.
3. Is G1's size within 600–1,200 added+deleted lines, or should it be split (and how, by files)?
4. Anything the book must add so G2–G5 can later run from the same book.

Output: numbered problems with the exact text the book should say. End with: must-fix count.
