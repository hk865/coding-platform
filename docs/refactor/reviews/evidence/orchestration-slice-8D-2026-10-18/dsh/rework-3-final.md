# 8D rework round 3 — final report

## FILES CHANGED

**Production (+34/−21, net +13):**
- item 1 — `scripts/cpp-source-query.py` +33/−15: one `graph_logical_directive` (LF/CRLF continuations joined, no 400-byte cap, no two-line window); both call sites feed the one `graph_include_specifier`.
- item 4 — `src/core/workspace/analysis-runner.ts` −3 (unreachable fill-in loop); `scripts/python-source-query.py` +1/−3 (`implicit` parameter and branch removed).

**Tests (+137/−148):** `S8D-A06-multilingual` +31/−144 (shared `S8D-platform-fixture.ts`, literals unchanged); `S8D-A11-python-failure` +12/−4; `S8D-A22-cpp-imports` +14; `S8D-cpp-import-graph-script` +25; `analysis-runner` +55. `runtime-assets.json` digests updated (cpp `16b7702e…`, python `3a3491a5…`).

## ITEMS

1. **RED→GREEN.** >400-byte block comment: RED specifier `x.h` (clang spelling), now `HDR`; continued unexpanded macro over three physical lines: RED raw text, now `NOPE` + `include 后面跟宏`. Script-level pair plus platform row A-22(r) (platform row green pre-fix: edges expose only from/to). 76/76, then 40/40 after title cleanup.
2. **GREEN-first, restored guard.** Wrapper forwards real `python3`, prints `garbage`, `wait`s and sleeps, never exits. Platform kills it and records the exact §11.6 literal; TS unaffected; memory+SQLite 2/2, 272 ms (immediate, not the 10 s bound; an EOF-waiting runner would record `没有给出单元清单就到时`).
3. **GREEN-first, restored guards.** S8D-RUN-16: real header fails as FOO in `z.cpp` unit 0 and BAR in `a.cpp` unit 1; merged reason is the main-file rule’s BAR. S8D-RUN-17: undefined-HDR unit first, defined second; only the edge remains, `unresolved: []`. `analysis-runner.test.ts` 17/17.
4. **Checked.** Dead loop removed; `implicit` removed (9 call sites, no true caller); A-06 now uses the shared fixture with byte-identical literals, 8/8 before and after; python script suite 11/11.

## CHECKS
Union (`tests/data`, `tests/composition`, `tests/architecture`, `tests/work-graph`, `tests/app/S8A-architecture-routes.test.ts`; covers all `S8*.test.ts` and changed files), `--maxWorkers=2`: **308 files, 3,179 tests — 3,145 passed, 29 failed, 5 skipped, 787 s**. All 29 exact-match `DSH-BASELINE.md` (bwrap ENOENT), **0 unlisted** (independently rechecked). typecheck 0 (20 s), check:architecture 0 (1.2 s, 22/22 digests), build 0 (11 s). Fact-grep: none; only allowed fault injection.

## REPLY CORRECTIONS (item 5)
Replacement list now: old RUN-04 → new RUN-03, old RUN-06 → new RUN-04, and the script ordinary merge case → the nested-directory case. UNSPECIFIED 6 corrected: the engine **is** asserted as `libclang` (`S8D-RUN-01`).

## UNSPECIFIED
None. IDs RUN-16/17 were chosen here (the book assigns none); the directive tuple’s unused `column`/`offset` were left as-is.