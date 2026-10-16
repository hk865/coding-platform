You are a read-only reviewer for the lead of this repository. Do not modify files. You may run read-only commands (git diff, git grep, reading files). No tests, builds, network or model calls. Write the report in plain Chinese, with file:line for every code fact.

The working directory is the lead branch at 6f900eaa with the DeepSeek agent's speed-round-1 change applied as uncommitted edits (`git status`, `git diff`, plus new untracked files; see `git status --short`). The binding book is `.lead-ref/s4f-impl.md` (section 4 rulings S1-S3 and section 9 answers; user decision 66 in docs/refactor/HANDOFF.md); the agent's reply is `.lead-ref/dsh-reply.md`; background: `.lead-ref/design/`, `.lead-ref/summary.md` (profiling of the old code). This is the implementation review of the round (one full review, then a quick check after rework).

Review for:
1. Correctness against each ruling S1.1-S3.3 and the section 9 answers: name the ruling, the code, and a minimal counter-example for every deviation. Both-backend parity (memory and SQLite give the same pages, cursors, errors), cursor binding, revision_conflict, the 48 KiB bound, read failures = unavailable, index_not_ready, the catch-up and reload rules, the legacy FTS drop, the statement cache and literal LIMIT/aggregateType, the registration pattern.
2. Cost (decision 69 item 2): repeated store reads inside one call, per-page re-queries, the same record decoded several times, unused indexes or caches, anything O(n^2) in the scan or the memory index. Say what a call costs on 20,000 notes where you can.
3. Superseded paths (decision 69 item 3): old FTS/window code, the removed port cap, `fullTextProbe`, leftovers kept only for tests; production-reach.
4. Tests: rows that test nothing (pass on the old code for the wrong reason), expected values computed with the product's own functions, database reads to verify (forbidden), skipped tests (SP-13b) and whether the skip is justified, missing rows the book required.
5. The agent's UNSPECIFIED items 1-3: your view.
Classify each item as 必须改 (blocks merge) or 建议 (can wait), smallest fix for each. End with a one-line verdict. Keep it under about 4,000 Chinese characters.
