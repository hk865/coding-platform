# T build: book check before DSH builds (HANDOFF decision 80-1, step 2)

You check the lead's build book for one group of the T round. **Read only:** do not modify, create or delete any
repository file; no tests, no builds, no git writes, no network. Write your answer in plain Chinese, with `file:line`
for every code fact. No length limit: list every instance, one fix per instance, no options.

## Inputs (this copy is the build base, repository commit 3a9f6d94)

- `.lead-ref/books/t-book.md` (the rules every group follows), `.lead-ref/books/t-run-<G>.md` (your group's run file),
  `.lead-ref/books/t-items-<G>.md` (the items), `.lead-ref/books/t-files-<G>.txt` (the group's file whitelist; the
  other groups' whitelists are next to it).
- The test rule sheet v1: `docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md`.
- Background: `docs/refactor/HANDOFF.md` decisions 79 (search `^79\. `), 80 and 85-4; root `AGENTS.md` rules 3 and 4.

## What the items are

Each item came from a read-only inventory (Codex and DSH), was checked by a skeptic against this code, and conflicts were
judged; the user decided the `user-decides` ones. **Do not re-decide an item.** An item is wrong only when:

- it contradicts the code: cited lines, symbols, tests or files do not match;
- doing it as written loses a current behaviour that no remaining test pins; for a deletion, the named cover does not
  really assert it, and no decision says the behaviour is gone;
- it cannot be done as written:
  - a merge target does not exist, or the merge would drop an assertion the item does not drop;
  - a conversion's public step does not exist, or cannot reach the state under the test rule sheet;
  - a production change breaks a caller the item does not mention;
- it has two readings that would give different code.

## What to check, for every item

1. The cited `file:line`, symbols and test names against this code.
2. Deletions: the cover named in 覆盖/依据.
3. Merges: the target, and what moves.
4. Conversions: the public step, and whether it reaches the state without any form the rule sheet forbids.
5. Production changes (`change`/`delete` under `src/`): every caller and downstream reader of each changed or deleted
   symbol (`rg`). Say which are outside the group's whitelist and whether the item's action covers them.
6. Cross-item order inside the group: items that must land together, or in a set order. Items whose actions conflict.
7. The whitelist: files an item must edit that are missing from `t-files-<G>.txt`, and whether such a file is on another
   group's whitelist (a conflict the lead must resolve).

Also read `t-book.md` and the run file once, and report any rule that is ambiguous or contradicts the items.

## Answer

1. A verdict line: `可以施工`, or `改完再施工`.
2. A table of the items to change: 编号 | 问题 | 证据 (`file:line`) | 改法 (one, concrete enough to paste into the item).
3. The whitelist additions (file | which item | on another group's whitelist?).
4. The items that must land together or in order.
5. Book/run-file rule problems.
6. The same items as JSON in one fenced ` ```json ` block: `[{"id", "problem", "fix", "files_add": []}]`.
7. Which items you checked fully and which you only skimmed. An item you did not check is not clean.
