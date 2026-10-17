Close-out is green. Final report:

# 8D rework round 2 — final report

## FILES CHANGED

**Production (this round: +578/−493, net +85)**
- item 1 — `architecture-record-codecs.ts` +9/−1, `architecture-service.ts` +2/−2
- items 2, 3, 9 — `scripts/cpp-source-query.py` +64/−47
- items 7, 10, 11 — `scripts/python-source-query.py` +380/−378 (net +2; un-indenting the old body cancels its round-1 churn)
- items 4, 5, 6, 7 — `analysis-runner.ts` +82/−41
- items 2, 11 — `architecture-language-provider.ts` +27/−20
- items 7, 12 — `capture.ts` +14/−4

**Tests:** 11 files modified (+1575/−1621) + 3 new files (`tests/helpers/S8D-platform-fixture.ts` 252, `S8D-platform-fixture.test.ts` 38, `S8D-capture-error.test.ts` 64).

## ITEMS

1. **Done.** Decoder returns `readLanguageCoverage` results; service default removed. RED: old-record test got `undefined`, now `notes: []`.
2. **Done.** `graph_select` + slash check + script hints deleted; script consumes the provider's ordered list and emits `合并了 n 个编译数据库`; provider merge note removed. RED: nested-B script test gave `有多个编译数据库`; now merged. A-23 row `out/build/{a,b}` green memory+SQLite.
3. **Done.** One `graph_include_specifier` (continuations, both comment forms, delimiters). RED `NOPE // n` / `missing.h`; now `NOPE` / `"missing.h"`; expanded `HDR` stays `HDR`.
4. **Done.** `unfinished` only for whole-unit single-main failures, not `预处理出错：`. RED: `#if 1` + `orphan.h` gave `有编译单元没有做完`; now main `预处理出错：unterminated conditional directive`, orphan `没有编译单元包含它` (A-22(o)).
5. **Done.** One byte counter in `runAnalysis`, per-process buffers. RED: two 40 MiB launches finished; now `输出超过 64 MiB` (S8D-RUN-09).
6. **Done.** `end`, stdout end and exit recorded separately in one timed loop. RED: garbage after `end` was swallowed; now `输出读不了`; closed-stdout hang ends at the language limit or cancel (S8D-RUN-10/11/12).
7. **Done.** Only ENOENT/EACCES/unavailable → `分析器不可用`; ENOTDIR → `Error: spawn ENOTDIR` (RED all-errors-unavailable). Python catches ordinary entry exceptions (`RecursionError`, RED traceback → `failed` line). Capture records `TypeError: <first 200>` (RED bare message).
8. **Done.** A-11(2), A-20, A-21, A-22, A-23 now use the shared platform fixture (A-06 pattern), memory+SQLite, file pages, unresolved via `compareFormalObserved`. A-24 memory only. Counts: 2/2/20/34/40/4. No fact injection remains in runner tests.
9. **Done.** `readline()` header then `for raw in sys.stdin:` straight into the content table; whole-input list gone (structural; script suite green).
10. **Done.** One `ConfigurationReader` with `observation` flag; shared branches/root order; strict `python_index` texts unchanged (python-source-index 16/16).
11. **Done.** argv routing before the un-indented old `python_index` body; `coverageFromFiles` shared by both providers; argument table and protocol checks kept.
12. **Done.** Cut 200 → dedupe → sort → first 10 in `normalizeCoverageNotes`; codec only validates. RED: cut-after-dedupe produced two identical notes; now one.

## DELETED/REPLACED TESTS

- Old fake-protocol RUN-01 → real-source S8D-RUN-01; old RUN-02/03 → A-24(1); RUN-05 → A-24(3); RUN-10 → A-24(4); RUN-11 → S8D-RUN-09; RUN-12 → S8D-RUN-08 + A-22(k)/(n); RUN-07/08/09 rewritten with forwarding wrappers.
- Script-level CMake-hint test → A-23 hint row; package.xml/colcon-hint → A-23 hint row; “rejects two non-root DBs” → A-23 multiple; “aggregate alone” → A-23 aggregate row.

## PRODUCTION TOTAL (8D vs `slice-setup`)

**+2160/−125, net +2035** across 17 files. Over §11.7's 920–1,380/≈200; the two scripts still dominate (+693 and +488 net), reported not hidden.

## CHECKS

- Union run (`--maxWorkers=2`): **312 files, 3207 tests — 3173 passed, 29 failed, 5 skipped, 765 s**. All 29 failures exact-match `DSH-BASELINE.md` (bwrap/ENOENT); **0 unlisted**.
- `npm run typecheck` 0 (24 s); `check:architecture` 0 (1 s); `build` 0 (13 s). `boundaries.test.ts` included and passed (29 tests).
- `runtime-assets.json` updated: cpp `37060c…`, python `4745aa…`; 22/22 hashes match.

## UNSPECIFIED (smallest options)

1. Non-Error throws are labelled by `typeof` (e.g. `string: …`); §11.5 names only Error types. Keep.
2. Python RecursionError fixture uses 10,000 nested arrays (2,000 does not raise on 3.12.3). Keep.
3. A `failed` protocol line after `ready` (mid-stream ordinary exception) is treated as whole-language failed; ordering not explicit. Keep.
4. Self-edge drop has no protocol fixture because both real scripts drop `from==to` before emitting; A-22(m) covers fallback-to-self. Keep.
5. Trailing stdout line without newline and byte-identical duplicate `ready` are still accepted (round-1 UNSPECIFIED 3; no rejection rule). Keep.
6. `ready.engine/engineVersion` literals still unasserted (round-1 UNSPECIFIED 1). Keep.