# PC-2 audit 4: rework 3, the last (read-only; lead, 2026-10-23 night)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is **PC-2 after rework 3** (HEAD `2efd8f8`; `.lead-ref/commits.txt`). You audited rework 2 (audit 3, your
report `.lead-ref/audit3/A.out.md`, with your J-06 fixture patch `audit3/FX-J06.diff`); the lead applied the patch as
commit `8f8a2f0` (`.lead-ref/parts/fixture-8f8a2f0.diff`; the lead's check `checks/pc2-fx-j06.{sh,log}`), froze the
findings in `.lead-ref/books/pc2-r3-findings.md`, and DSH did rework 3 from that table by `books/run-pc2-r3.md` and the
whitelist `books/pc2-r3-whitelist.txt`. This is **audit 4** (decision 80). Rework 3 was the last rework: whatever you
find goes to a patch you write and the lead lands, so for every finding give the exact test change (a unified diff
against this tree, or the exact replacement lines with `file:line`). Report everything you can prove, and nothing you
cannot.

Inputs in `./.lead-ref/`:

- **The frozen table** `books/pc2-r3-findings.md`: binding. `books/pc2-r2-findings.md` only where a row cites it.
- **The change:** `parts/A.diff` (`8f8a2f0` → `2efd8f8`: rework 3, five test files) and `parts/A-files.txt`; the
  `8f8a2f0` version of each changed file under `base/`. The whole result tree is the current directory.
- **DSH's reply** (claims, not evidence): `replies/pc2-r3-reply.md`; §2 each row's production mutation, RED and GREEN;
  §3 the J-09 and T2-03 mutation records.
- **The lead's checks:** `checks/full-pc2-r2.txt` (the full suite on `9e984e1` with bubblewrap: all green); the full
  suite on `2efd8f8` if present (`checks/full-pc2-r3.txt`). DSH has no bubblewrap.

## What to check

1. **Each row** (A3-01 … A3-05 and the J-09 / T2-03 paragraph), one by one: done exactly as the row and its lead note
   say, and as your audit-3 fix said? Cite the row and the test line.
2. **The test bar:** expected values literal or hand-computed (values a public read returns at run time may fill a
   hand-written whole text, as the table allows); no production function (digest helpers included), the generated
   pack, `preparedTexts()`, a manifest or a captured request used to build an expectation; whole texts compared whole;
   no fact read from the database or a private module; through public steps (A3-02: no `commitRaw`, no hand-filled
   Kernel facts, no second owner; is the `vi.spyOn` capture of the composition's own `QueryExecutionPort` a public
   path?; A3-05: is a second Plan id `pc2-j08-input-plan@2` a public Plan change, and does the new Task really reach
   the continuation's inputs section through the steps your audit 3 named?).
3. **Each mutation claim, by reading:** is it in production code, at the file and line named; would the changed case
   fail under it and pass without it? Name a mutation of the same rule it would still miss, if any.
4. **Hand-written literals:** spot-check the long ones (A3-01's history, A3-04's three inputs, A3-05's current input)
   against the frozen pack texts and the production renderer by reading; a literal that only passes because it was
   copied from a run is not a finding by itself, but a literal that disagrees with the rule it claims to pin is.
5. **Scope and leftovers:** no file outside the whitelist; no change under `src`, `scripts`, `resources`,
   `runtime-assets.json` or `tests/helpers`; no timeout above `60_000`; no skipped or `.only` case.
6. **Anything rework 3 broke** that a row did not ask for: **会出错** with the input and both outputs.

## Answer

1. **Findings table:** 编号 (`A4-01` …) | 类别 | 位置 (`file:line`) | 依据 | 问题 | 唯一改法. Classes **会出错**, **违规**,
   **不整洁**, **建议**. If nothing is wrong, say so and leave the table empty.
2. **Per row:** one line each (A3-01 … A3-05, J-09, T2-03): `OK` / finding ids.
3. **Patches:** for each finding, the exact test change, as a unified diff against this tree (zero context is fine;
   say so), touching only the test files of `parts/A-files.txt`.
4. The findings as JSON in one fenced ` ```json ` block (`[]` if none).
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
