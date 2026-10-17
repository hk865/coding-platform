# Task: 8D rework, round 2 — Codex's review of round 1 (twelve items); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); no fixed limit on subagents at once (decision 76), files disjoint, every vitest
command `--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 200 minutes**
(the run stops at 210). Finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

Tag `s8d-rw1` (HEAD) = the 8D rework, round 1 (book `./.dsh-ref/s8d-rework-impl.md` with the lead's answers in its
§8; your reply `./.dsh-ref/s8d-rework1-final.md`). The lead's bwrap check of round 1: 82 test files, 528 passed.
Codex's review: `./.dsh-ref/s8d-rw1-review.out.md` (Chinese, items 1–12 with file:line and the fix approach). The
spec is `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md` §11 (the 〔8D 返工〕 parts). Everything
the round-1 book says still holds unless an item below changes it.

## 2. Items (binding; the review's numbering)

1. **`notes: []` from the decoder.** The record decoder returns the decoded coverage (with `notes` defaulted to `[]`
   for old records), not the raw object; the service's own default goes. The old-record test asserts `notes: []`.
2. **One owner of compile-database selection: the TS provider.** It has the existence and skip information, so it
   alone applies §11.4's order (root; the single one; the aggregate alone; the per-subdirectory merge under any
   non-root `B`, nested `B` such as `out/build` included; otherwise `有多个编译数据库`). The script's second selection
   (`graph_select` and its slash-count check) goes; the script reads the databases it is given and computes the merge
   note. Not UNSPECIFIED 2's "tighten the provider" (that narrows the frozen rule). Add a row-named case for a nested
   `B` (`out/build/a/…`, `out/build/b/…` → merged, `合并了 2 个编译数据库`).
3. **One specifier extractor** for expanded and unexpanded macro includes and for the plain forms: comments, line
   continuations and delimiters handled once (`#include HDR // note` gives `HDR` both ways; `#include /*c*/
   "missing.h"` keeps `"missing.h"` with its quotes).
4. **A completed unit with a preprocessing error is not "unfinished".** The runner tells a per-file preprocessing
   failure (`预处理出错：…`, the R2lex case) from §11.4's whole-unit failures by what the script reports, not by the
   length of `done.files`. Case: the only main file is `#if 1\n` plus an unincluded `orphan.h` → the main file
   `failed` `预处理出错：unterminated conditional directive`, `orphan.h` `skipped` `没有编译单元包含它`. No protocol
   extension unless the existing messages cannot carry it (then UNSPECIFIED).
5. **The 64 MiB output cap is per language run, across restarts:** one byte counter for the whole `runAnalysis`, each
   process keeps only its own line buffer.
6. **Ending:** protocol `end`, stdout end and process exit are recorded separately and finished in one loop that
   still obeys cancellation and the language time limit; output after `end` is still read and an unreadable line
   wins (`分析运行失败：输出读不了`); a process that closes stdout and hangs is still stopped by the limit or the
   cancel.
7. **Error classes:** only `ENOENT`/`EACCES` (or the `unavailable` path §11.5 names) map to `分析器不可用`; other
   spawn errors keep their own class as §11.5 orders. The Python script turns any other ordinary exception in the
   language entry (for example `RecursionError` from deeply nested JSON) into a language `failed` with the type and
   message. At the capture boundary every caught exception is recorded as `<type>: <first 200 characters>`;
   cancellation stays separate.
8. **Tests at the required entries.** A-11 (2), A-20, A-21, A-22, A-23 run through the platform fixture A-06 uses,
   **memory and SQLite each**, read through the file pages, and A-20/A-22's unresolved specifiers through
   `compareFormalObserved`'s `unresolved` findings; the literal expectations stay exactly as now (they are §11.6's).
   A-24 stays memory only. **No fact injection:** runner tests use wrappers that forward the real interpreter and
   inject faults only (garbage, hang, exit codes, kills, closed stdout); tests that feed made-up protocol results
   (made-up edges or unit states, for example RUN-12) are replaced by real-source fixtures, or deleted where an
   acceptance row already covers the rule. List each deleted or replaced test with the row that covers it.
9. **The C/C++ script reads stdin line by line:** `readline()` for the header, then iterate stdin and put each parsed
   file straight into the content table; no whole-input list.
10. **One Python configuration reader.** The observation mode reuses `project_configuration`'s branches and root
    order (pyright, setuptools, setup.cfg; `where` → `extraPaths`) and differs only where §11.3 says (JSONC, ignore vs
    refuse, reasons and notes); `python_index` keeps its strict behaviour (A-21's `python_index` assertions stay green).
11. **Smaller diff where it is free:** route `import_graph` by argv and exit before the old `python_index` top-level
    body, so that body is not re-indented; one small coverage-conversion function shared by the two providers. Keep
    the ported argument table and the runner's protocol checks.
12. **Notes normalization (lead ruling, replaces the round-1 order):** cut each note to 200 characters, then dedupe,
    then sort, then take the first 10. The owner normalizes; the codec only checks.

## 3. Checks

`--maxWorkers=2`: `tests/data/`, `tests/composition/`, `tests/architecture/`, `tests/work-graph/`, every
`tests/**/S8*.test.ts`, every test file that mentions `explorationTools`, `cpp_index`, `python_index` or
`project_index`, the changed and new files; `npm run typecheck`, `npm run check:architecture`, `npm run build`;
`runtime-assets.json` digests updated and checked. Failures listed in `DSH-BASELINE.md` are expected (no bwrap). No
real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 700 words: files changed (production net per item; tests), each item RED → GREEN or how it was checked, the
deleted/replaced tests with their covering rows, the production line total of 8D after this round (against
`slice-setup`), checks with numbers, UNSPECIFIED.
