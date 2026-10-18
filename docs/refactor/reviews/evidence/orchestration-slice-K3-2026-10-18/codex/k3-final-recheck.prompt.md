Independent read-only recheck (decision 81-2) of the final full list for K3 group 4 session B3. This repository copy is tag `k3-g4b3-r10` (exported, no .git). The list to recheck is `./.lead-ref/k3-final-list.out.md`; all its inputs are under `./.lead-ref/` (the frozen table `k3-merge.out.md`, the decisions `decisions-80-81.md`, book `k3-g4b3-rework-10.md`, `k3-verify9.out.md`, `k3-mutation-r9b.txt`, the diffs `k3-g4b3-r10.diff` and `k3-g4b3-r8-r10.diff`, the ledgers `d1-round-10.txt` and `d1-cumulative-r10.txt`, `test-rule-sheet.md`, the classification `k3-business-classification.md`). Answer in Chinese. Do not write any file, do not run tests.

The four categories: 会出错 (production misbehaves in normal use) / 缺保护 (production is right but no test would catch removing its check) / 只是写法 (test form only, no protection lost) / 没有可见后果 (hygiene). The list's result decides the next step: any 会出错 row sends a third DSH round; otherwise tests go to Codex patches and the rest to T.

Check against the code, not against the list's wording:
1. For each open item (N-01, F-067, N-02, N-03, N-04): is the category right? Is the proposed fix and the mutation patch right (would the named assertion really fail with the mutation, and pass without it)? Say agree / disagree (with file:line and the reason).
2. For each row the list calls closed in its section 2 (F-020, F-021, F-026, F-032, F-035, F-054, F-069, F-072, F-073, F-076, F-098, F-100, F-101, the F-046 restored assertions, G1–G6): agree it is closed, or show it is still open (for protection rows: name the production check whose removal the test would survive, file:line).
3. Its ledger rulings: any line it calls "required" or "equivalent" that is really a weakening?
4. Only if you see one: a 会出错 problem in the r8..r10 changes that the list missed (one line each, file:line). Do not list form issues.

End with one line: categories agreed / disagreed; closures agreed / disputed; any missed 会出错.
