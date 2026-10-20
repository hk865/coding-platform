Read-only inventory for the lead. Do not write any file, do not run tests or builds. Answer in Chinese, with
`file:line` for every claim.

**Why.** The full test suite (766 files) takes about 48 minutes with 5 workers; the files' summed time is 13,520 s and
the slowest 5 files are a third of it, the slowest 20 half (`D:/cxt/t-scale/summary.txt`, `per-file.tsv`). Most of
them are scale tests: they build thousands of real records through public steps to reach a frozen spec limit
(5,000 cards, 201 Goals, 401 Tasks, 205 blocked Runs …). The same test often runs once on the memory backend and once
on SQLite, and the SQLite run is tens of times slower (`D:/cxt/t-scale/slow-tests.txt`: per-test times, two lines per
test name = the two backends). The user asked to run fewer scale tests **without losing quality**. The lead's
proposal, for you to check against the code: a scale test protects up to three things, and only the third needs real
scale:
1. **the boundary** (the limit holds: item 5,001 is refused, the last page has no duplicate and no gap): testable
   with a small limit passed in, if production takes the limit as a parameter whose default is the spec value;
2. **the cost** (reads stay bounded: R = 401 reads exactly three pages): testable at small N by counting reads with a
   small page size, if the page size can be passed in;
3. **real-size performance** (SQLite query plans, memory at thousands of rows): needs real scale; it can be a separate
   measurement run at chosen points instead of part of every full suite.

**Where.** The code is this folder (`src/`, `tests/`; the T-merged tree). The specs are under
`docs/refactor/design/orchestration-2026-10/slices/` and `docs/refactor/`. The test rule sheet v2 binds every test:
`docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/books/test-rule-sheet-v2.md` (no hand-written
facts; expected values from the spec or a hand calculation, never from a production function or constant).

**For each file of `D:/cxt/t-scale/top25.txt`** (the 25 slowest), and inside it for each test case slower than about
5 s:
1. the spec rows it implements (`file:line` of the row) and the limit or size it uses, with where that number comes
   from (spec line, production constant `file:line`);
2. which of the three things above the case protects (one or more), and anything else it protects;
3. where the time goes: building the state (how many public steps, per backend), the read under test, or something
   else (a timeout, a sleep, a real process);
4. whether the limit / page size / size is already injectable in production today (`file:line` of the constant and
   of the place it is passed), and if not, the smallest production seam that would make it so with the spec value as
   the default (the composition root keeps passing the spec value);
5. a proposal: keep as is, shrink with an existing seam, shrink with a new seam, run large-N only on the memory backend
   and small-N on SQLite, or move to a separate measurement run; with the expected time after (rough) and **what
   quality would be lost**, if any;
6. any case whose large size is itself the spec's point (a spec line that asks for real scale), so it must stay.

**Also:** cases that repeat the same property at the same scale in another file (duplicates); and whether the vitest
run order lets the slowest files start first (check `vitest.config.ts` and whether a results cache is present).

**Output.** A table per file (case | spec row | protects 1/2/3 | time per backend | where the time goes | injectable
today? | proposal | expected time after | quality lost). Then: a list of the production seams needed (each with
`file:line`, the parameter, its default and its callers); the total expected saving; cases that must stay at real
scale and why; your doubts about the lead's three-way split. Mark anything you could not settle as 待定 with what
would settle it.
