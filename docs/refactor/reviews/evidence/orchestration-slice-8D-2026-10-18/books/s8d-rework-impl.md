# Task: 8D rework — the light import scan for C/C++ and Python, the shared NDJSON runner, the coverage convention, and taking 8D's additions out of the exploration tools (slice 8 §11, decision 78); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it. No fixed limit on how many subagents run at once (decision 76),
but files of running subagents must be disjoint and every vitest command uses `--maxWorkers=2`. **Do not end your turn
while a subagent has not reported back.** Subagents write all code and tests; you split, brief, check and reply.
**Finish within 290 minutes** (the run stops at 300, with a handoff if needed). Finish whole items; an unfinished item
is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch at 13551ac9 (4C-2 A and B merged; slice-8 spec §11 frozen). `s8d-1r` = the first
  8D build (your earlier session's work, tag `s8d-1` on the old base) replayed on it; it applied cleanly and
  typechecks. `slice-base` adds `DSH-BASELINE.md`. HEAD = `slice-base`.
- **The spec:** `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`, the header post-note "决定 78" and
  **§11 (whole)**. §11 wins over every earlier section it names (§0.3 L12/L13, §1, §2, §4 item 13, §5, §6, §9, §10).
  Each §11 bullet is tagged 〔8D 返工〕 or 〔§10 段〕: **this session builds only 〔8D 返工〕**; 〔§10 段〕 is the next
  session (it builds on your code).
- The first build: book `./.dsh-ref/s8d-impl.md` (§8 = the lead's answers then), your reply `./.dsh-ref/s8d-final-1.md`,
  and the verified review of it `./.dsh-ref/verify-s8d.out.md`. §11.1 takes most of that build out again; the review's
  items are settled by §11 as follows: 1 → §11.5 "选配置看存在"; 2 and X → §11.1 (exploration back to before 8D); 3 →
  §11.1 `python_index` change 1; 4 → §11.1 (the `imports` cache goes); 5 → §11.5 "认领的每个文件都有结果"; 6 → §11.5
  "分清错误"; 7 → gone with §11.1.
- **Prototypes (read, port what helps; the spec wins on any difference):** `./.dsh-ref/proto/cpp/` (`d6_scan.py` on top
  of `proto_scan.py`: C/C++ through libclang 18 by ctypes; database selection, merge, argument table, fallbacks, R2lex,
  notes; `run_fixtures.py` builds the A-22/A-23 fixtures under its own `ws/` and writes `out/`, so copy the directory
  to `./.dsh-scratch/` before running it) and `./.dsh-ref/proto/python/` (`light_import_scan_d6.py`, standard library
  only; `d6_cases.py`, `d6_check.py`). They ran every A-20..A-23 expectation of draft 6 and matched; they are
  single-process, production goes through the §11.5 runner. **Two places where they predate the frozen text:**
  (1) `d6_scan.py` reads colcon's aggregate `B/compile_commands.json` next to `B/<subdir>/…` as `有多个编译数据库`; the
  frozen §11.4 uses the aggregate alone; (2) the "no analysis when no claimed file was read" rule in §11.5 counts only
  files handed to the scan (skipped ones do not count); the Python prototype has both readings behind a flag.
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding) — every §11 bullet tagged 〔8D 返工〕

1. **§11.1 take-out and keep.** Remove what 8D added for the observation from the exploration side (the per-file
   coverage and per-TU tolerance in both scripts, the `imports` cache, `MissingAnalyzers`, the paging collection and row
   conversion in the two providers); keep the list §11.1 keeps; `python_index` changes exactly three things (analyzers
   directory as argv[1], `-S`, the missing-Jedi message). `sourceAnalyzers.directory` reaches only the exploration
   tools.
2. **§11.3 Python `import_graph`** in `scripts/python-source-query.py`: argv routing before the analyzer unpacking;
   observation-mode configuration (JSONC `pyrightconfig.json`, unused fields and unusable roots into `notes`, the
   configuration-error literals, root order per configuration, trailing slashes); `ast.parse` per file; CPython's
   lookup incl. the namespace rules, `标准库`, `命名空间目录，可能是同名的外部包` (absolute imports only), relative
   imports, specifiers. `python_index` keeps its old configuration reading (no relaxation; tested).
3. **§11.4 C/C++ `import_graph`** in `scripts/cpp-source-query.py`: database selection (root first; the single one;
   the colcon aggregate alone; the per-subdirectory merge; otherwise `有多个编译数据库`; one unreadable selected →
   fail; the colcon/CMake hints), entries and paths (`databases[]`, per-database relative `directory`, workspace
   mapping through `workspaceRoot`/`workspaceRealRoot`, numbering, dedupe, default target), the argument table (port
   the prototype's table as §11.4 says), libclang options and the outer `InclusionDirective` walk, specifiers, the two
   fallbacks (and the fallback-to-itself → null), R2lex, the whole-unit failures, the per-file results incl.
   `源文件不在编译数据库里`, outside directories and forced includes, notes with their scopes. **In this session only
   databases in the frozen material are seen** (`configOnly` is empty until the §10 segment), so the merge and
   aggregate rules are tested with non-ignored databases (A-23's `dbs/…` cases).
4. **§11.5 common:** `LanguageCoverageV1` with `edges`/`notes`, the provider interface with `skipped` (and an empty
   `configOnly`), the capture copying the provider's `edges`, the record decode of `notes` (absent → `[]`), all reason
   and note literals, file names not paths in reasons, choose-the-config-by-existence, every claimed file has a result,
   the self-edge rule (C/C++ and Python; TS is the §10 segment), no analysis when no claimed file was read, cancel and
   capacity, **the NDJSON runner** (spawn, stdin header and files, stdout lines, merge, timers, exits and restarts,
   error classes, output caps, dedupe, cancel), `unitTimeoutMs`/`languageTimeoutMs` through `sourceAnalyzers`.
   Providers produce `unresolved[].reason`; the capture does **not** store reasons yet (§10 segment).
5. **`runtime-assets.json`:** update both scripts' digests.

**Not in this session (〔§10 段〕):** the TS light scan (§11.2), the `lightScan` fault hook and A-11 (1), A-17–A-19,
the module-snapshot truncation, freezing ignored compile databases (A-23's §10 part), storing reasons and the
`detail` assertions, A-16, deleting A-10, the scale-fix items of §10.

## 3. Rows (§11.6) for this session

A-06 (changed), AE6 wording in tests if any, S8D-PROV-03 (changed like A-06), A-11 (2), A-20 (edges and specifiers; the
`detail` half is §10), A-21 (all, incl. JSONC and "no claimed file read"), A-22 (a)–(n) (edges, statuses, notes,
specifiers; the `detail` half is §10), A-23 (the 〔8D 返工〕 part, incl. the merge, aggregate, colcon-hint and
`-Xclang` cases), A-24 (1)–(4), the exploration regression rows ("查源码不变"), and the 8D test fate list ("8D 的测试去
留"). Memory and SQLite each where §11.6 says "内存和 SQLite 各跑一遍"; A-24 memory only. Expected values exactly as
§11.6 writes them (they were machine-checked against the prototypes); if the code disagrees, report it, do not change
the expectation.

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id. Expected values literal, from §11.6 or hand-computed from §11.
- **Tests through public entries:** the observation through the platform/workspace capture path (as the 8A and 8D
  tests do), the exploration tools through `createExplorationTools`; `pythonPath` wrappers for the runner rows (A-11
  (2), A-22 (i), A-24) as §11.6 describes. Fault injection yes; fact injection no. States only tampering can make are
  not tested (AGENTS rule 4).
- **One runner**, one TS module, used by both providers. Scripts read stdin line by line and write stdout line by line;
  no temporary files for the protocol.
- **Old tests:** §11.6 "8D 的测试去留" says which S8D-* tests are rewritten, deleted or kept; whole-object assertions
  gain `notes` as §11.5 lists. Any other failing assertion: do not edit it; report it with before/after.
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end. libclang 18 and Python ≥ 3.11 are installed in this sandbox (the first build used them).
- **Line budget (decision 69):** §11.7 estimates about 920–1,380 new production lines and about 200 removed. Report the
  count per part.

## 5. Order (suggested; you decide the briefs, files disjoint)

1. In parallel from the start: (A) the runner module and the coverage convention on the TS side (types, record decode
   of `notes`, capture copying `edges`, provider input `skipped`); (B) the Python script: `import_graph` plus the §11.1
   take-out and the three `python_index` changes in the same file; (C) the C/C++ script: `import_graph` plus the §11.1
   take-out in the same file.
2. Then: (D) the two providers on the runner (config selection by existence, merge/aggregate selection, hints,
   zero-file rule, claimed-file completion, notes) and the §11.1 TS-side take-out (indexes, exploration wiring);
   (E) the row tests not already written by A–D, split by row group (Python rows; C/C++ rows; runner rows; regression
   rows).
3. Close-out (one subagent): the checks below, `runtime-assets.json` digests.

## 6. Checks (close-out subagent)

- `--maxWorkers=2`: `tests/data/`, `tests/composition/`, `tests/architecture/`, every `tests/**/S8*.test.ts`, every
  test file that mentions `explorationTools`, `cpp_index`, `python_index` or `project_index`, the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox (no bwrap). Name any other failure. Do not run the
  full suite.

## 7. Reply

Under 900 words: FILES CHANGED (production / tests, production line count per part); each scope item and row: done or
not, RED → GREEN; CHECKS with numbers; measured time of A-22 and A-24 runs; UNSPECIFIED (short, with options);
subagents (task, time, most at once); anything surprising.

## 8. Answers to the read-through (lead; filled after the read-through)

The read-through (`./.dsh-ref/s8d-rework-preread-final.md`) is accepted with these answers (binding):

1. **`notes` in the codec.** The decoder accepts the key absent (→ `[]`) or an array of at most 10 strings, each at
   most 200 characters; anything else is rejected like other malformed coverage. The capture owner normalizes before
   writing (dedupe, sort by string, cut each to 200, keep the first 10); providers and the runner may hand it any
   list. No sorting in the codec.
2. **`skipped`.** Pass the capture's whole skip list (`{ path, reason }`, all languages) to every provider; each
   provider uses it only for choosing its configuration by existence. `configOnly` is `new Map()` in this segment.
3. **Workspace roots for the C/C++ header.** Add two optional fields to `WorkspaceReadAccess` (for example `hostRoot`
   and `hostRealRoot`), filled by `createWorkspaceAccessFactory` from the root it resolves; the C/C++ provider passes
   them as `workspaceRoot`/`workspaceRealRoot`. When a test double leaves them out, every absolute path counts as
   outside the workspace (relative paths still work). No new method.
4. **Provider coverage.** Trust the provider's `edges`, `parsed`, `notes`, `issues` and `reason`; the owner computes
   `files` and `complete`. No extra validation of `reason`.
5. **Timeouts.** Add optional `unitTimeoutMs` and `languageTimeoutMs` to the existing shared `sourceAnalyzers` type;
   the exploration tools ignore them. `sourceAnalyzers.directory` no longer reaches the observation's Python provider.
6. **Zero read claimed files.** The provider short-circuits on an empty claimed list before any configuration or
   database selection (as TS does); the capture keeps calling every recognized language.
7. **Python argv and version.** Route on `sys.argv[1] == 'import_graph'`; otherwise `argv[1]` is the analyzers
   directory (`python_index` change 1). Import `tomllib` after the routing in both paths: `import_graph` checks the
   version first and answers `unavailable` below 3.11; the `python_index` path keeps its old behaviour.
8. **The approximate C/C++ note.** Added whenever the language is `supported` after the zero-file early return,
   whatever `parsed` is.
9. **Spec vs code (your section 2).** Right: §11.5's interface is the target, not today's; cited lines that drifted —
   use the code's. The argument table: `./.dsh-ref/proto/cpp/light_include_scan.py` (now copied in; lines 70–151) is the
   table §11.4 means; `proto_scan.py` carries the same table.
10. **Tests (your section 3).** The extra `notes` edits you list (S8A-formal-comparison, S8A-file-layer,
    S8A-file-graph `:113`, `:128–130`, `:202–203`, S8D-language-providers) are covered by §11.5 "整对象断言的旧测试加
    `notes`" — make them, report them in one line each. `boundaries.test.ts` turns green with the digests.
11. **Plan and time.** The scripts do not depend on the TS seam: start S1 (Python script), S2 (C/C++ script), S3
    (runner) and S0 (seam) at the same time; S6 writes the C/C++ row tests from §11.6 in parallel with S2 (RED first)
    and turns them green when S2 and S4 land; the same for S5 with S1. The run limit is raised: **finish within 290
    minutes** (the run stops at 300). Production estimate accepted.
