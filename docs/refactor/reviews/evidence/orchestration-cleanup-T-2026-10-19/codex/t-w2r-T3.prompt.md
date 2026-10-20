# T wave 2: item refresh against d4c4cea, group T3

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

## Why

T round wave 2 (HANDOFF decision 79-4) runs on this tree: `d4c4cea`, after wave 1 (groups TP and TQ, plus three DSH
reworks) changed many tests and helpers. The wave-2 items were written on `t-base` (repository 3a9f6d94) and
checked by you on 10-19 (your fixes are appended to the items as **书面核对改正** lines). Each item is marked when a
file it names changed in wave 1 or no longer exists. DSH starts on these items within the hour, so check every item
of your group against this tree, briefly.

Inputs in `./.lead-ref/books/`: your items `t-items-T3.md`, the book `t-book.md`, the rule sheets
`test-rule-sheet-v1.md` and `test-rule-sheet-v2.md` (v2 binds wave 2), and the wave-1 rulings `t-w1-findings.md` §0,
`t-w1r1-findings.md` §0 (R-1 to R-9: tamper-only rows go, unreachable rows go, refusals stay as A6 rows, the shared
real Runtime `tests/helpers/S2B-runtime-steps-fixture.ts` reaches entered/ended Runs, platform-issued values come from
a public read).

## For each item, one status

- **OK:** still applies as written. If its lines moved, give the current `file:line`.
- **DONE:** wave 1 already did it (cite the current code).
- **GONE:** what it acts on no longer exists, and nothing is left to do (cite).
- **CHANGED:** still needed, but the action must change because of wave 1 or rule sheet v2. Give the one exact new
  action, with `file:line`.
- **BLOCK:** cannot be done as written and you see no public path (cite the refusing check or the missing entry).

Be brief; spend effort on the items marked as changed in wave 1 and on every `convert`.

## Answer

1. A table: 编号 | 状态 | 现在的位置 | 说明（CHANGED 写新的动作）.
2. A JSON block: `[{"id","status","where","note","action"}]` (`action` only for CHANGED).
3. Last line: `OK n，DONE n，GONE n，CHANGED n，BLOCK n，条目 n/N`.
