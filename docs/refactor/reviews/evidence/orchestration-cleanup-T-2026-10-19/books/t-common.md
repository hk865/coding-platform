# T-round inventory (HANDOFF decision 79-4): read-only, one area

You review ONE area of this repository (given in your task) for the lead. **Read only:** do not modify, create or delete
any repository file; no tests, no builds, no git writes, no network, no model calls. The only file you may write is
your report (where your task says). Write the report in plain Chinese, with `file:line` for every code fact.

## Background (read first)

- `docs/refactor/HANDOFF.md` decision 79 in full (search `^79\. `), especially 79-1 and 79-4; decision 85-4 (search
  `85-4`). Root `AGENTS.md` rules 3, 4 and 9.
- The product has never run for real, so there is no old user data to protect (79-1): code reads only the current
  format; old-format readers, "written by earlier versions" tolerance and legacy fixtures are candidates to remove.
- Tests are about 261,000 lines (src about 186,000) and were never reviewed as a whole. Slices only added tests; the
  same scenario is often tested again in a later slice's file.
- Tests should pin business flows through public interfaces. Small unit tests whose assertions a business-flow test
  already makes are candidates; pure-function tests of a frozen spec table (state-machine rows, "R5") are not trivial
  by default.

## What to find (test areas)

1. **过时 (stale):** the behaviour the test pins was changed by a later slice or decision, or the test exercises an
   interface kept only for compatibility or an old data format (79-1). Evidence: the decision or spec line that changed
   it, and where the current behaviour is tested.
2. **重复 (duplicate):** the same business scenario with the same assertions tested in two or more places. Evidence:
   both places side by side (path:line and test name) and what each asserts; say which one should stay (the
   business-flow one, or the spec-row one).
3. **琐碎 (trivial):** a small test whose assertions a business-flow test already makes. Evidence: the covering test
   (path and name) and the line where it asserts the same thing.
4. **手写事实 (handwritten facts):** a test or fixture that writes records or events directly (`seedCommit`, raw
   `encode*`, handcrafted JSON) where a public step (owner method, route, tool) would produce the same state. These are
   **converted, not deleted**: name the public step and say whether it exists today. No public step → say so, no
   conversion.
5. **只为篡改 (tamper-only):** tests that corrupt stored data only to reach a defensive check that only database
   tampering can trigger (root `AGENTS.md` rule 4). Decoding malformed input from a real boundary (HTTP body, model
   output, file content, process output) is not tamper-only.
6. **辅助 (helpers, area F mainly):** helpers or exports no test imports (prove with `rg`), duplicated fixture builders,
   helpers that exist only for stale tests.

**Do not propose deleting:**

- A test named after a row of a frozen spec's test table (names start with a row id such as `K3-31`, `S2B-34`,
  `RL-12`, `D85-5a`), unless that row's behaviour no longer exists. If it duplicates another test, report it as 重复
  with action `keep-note` or `merge-into`, and set `spec_row: true`.
- `tests/architecture/` checks (production-reach, boundaries, state writes); report only a stale check.
- A test that is the only one pinning an MVP behaviour (`docs/MVP-BEHAVIOR.md`).

Every `delete` names what covers it, or states that the behaviour no longer exists, with the decision or spec line
(decision 79-4).

## How to work

- Go through **every file** of your area. For duplicates, search the whole `tests/` tree (`rg` for the same owner method,
  route, tool, fixture and expected codes).
- Keep your context small: `rg -n`, `sed -n a,bp`; read whole files only when they are short.
- Do not pad. A file with nothing to report gets nothing. Do not report style or naming.

## Report format

1. A table, one row per finding: 编号 (area prefix + number, e.g. `A1-07`) | 类别 | 位置 (path:line range; test names)
   | 证据 | 建议 (`delete` / `merge-into:<path::test name>` / `convert:<public step>` / `keep-note`) | 被谁覆盖 (path::test
   name, or `行为已不存在：<decision or spec line>`) | 估计行数 (test lines removed or changed) | 规格行 | 把握 (高/中/低).
2. The same findings as a JSON array in one fenced ` ```json ` block, keys: `id`, `category` (`stale` | `duplicate` |
   `trivial` | `handwritten` | `tamper` | `helper`), `file`, `lines`, `tests`, `evidence`, `action`, `covered_by`,
   `est_lines`, `spec_row`, `confidence`.
3. Totals per category (count, lines).
4. Which files you read fully, which you only skimmed, and anything you could not settle.

## Production areas (P1, P2a, P2b)

Their task says what to look at. Use the same table and JSON, with `category` one of `allowlist-kept-for`,
`allowlist-pre-batch`, `allowlist-wire-format`, `old-data`, `legacy`, `c1-transfer`, `n0`, and `action` one of
`delete`, `keep` (with the reason), `user-decides` (pre-batch: describe it in plain words so the user can choose, and
give your recommendation), `change:<one line>`.
