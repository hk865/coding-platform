# Task: slice 8D — C/C++ and Python references in the architecture observation (L13, AE6); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it. There is no fixed limit on how many subagents run at once
(decision 76), but files of running subagents must be disjoint and every vitest command uses `--maxWorkers=2`.
**Do not end your turn while a subagent has not reported back.** Subagents write all code and tests; you split, brief,
check and reply. **Finish within 180 minutes** (the run stops at 190, with a handoff if needed). Finish whole items; an
unfinished item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch e919304b (8A merged, ce4369b1; 4C-2 session A merged). `slice-base` adds
  `DSH-BASELINE.md`.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md` (frozen). Read: L12 and L13 (~140–164),
  §1's 8D (~182), §2 (the provider interface and `LanguageCoverageV1`), §3's 8D line (~342), §4 rule 13 (~358), §5.1
  AE6 (~373), §5.2 A-06 (~420), §5.3's language-coverage line (~431), §6's 8D (~443), and **§9 (8A's readings, binding
  for 8D; they win on conflict)**. The user confirmed the test entries (decision 64).
- Code facts Codex checked on this copy: `./.dsh-ref/s8d-facts.md` (Chinese; the provider interface, the two
  analyzers, the environment, old assertions, current line numbers). Use them.
- 8A's construction and readings: `./.dsh-ref/s8a-final.md` and the rework replies (what 8A built).
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding)

1. **Two providers through 8A's interface.** A C/C++ provider and a Python provider implementing
   `ArchitectureLanguageProviderV1` (`src/core/workspace/architecture-language-provider.ts` ~21), registered in the capture's non-TS
   provider list (`src/core/workspace/capture.ts` ~106; see section 8 answer 2), working only on the capture's frozen `ProjectSourceAccess` material (§9.1: one
   frozen material per observation). They reuse `src/core/workspace/cpp-source-index.ts` and
   `python-source-index.ts`; the exploration tools' use of those indexes keeps its behaviour (their tests stay green).
2. **Per-file results and full statistics before truncation (L13 "覆盖从哪里来").** Change the two indexes and
   `scripts/cpp-source-query.py`, `scripts/python-source-query.py` so the imports operation returns each file's result
   (parsed / failed with reason / skipped with reason) and full counts before any diagnostic truncation; build
   `LanguageCoverageV1` by §2's formula (not the analyzers' own `coverage.complete`); truncate only the `issues` stored in
   the record. Update the two scripts' `sha256` in `runtime-assets.json` (checked by the architecture boundary check).
3. **Configuration (L13, frozen as written):** C/C++ uses the root `compile_commands.json`, else the only one, several →
   `failed` ("有多个编译数据库"), none → `failed` (reason written). Python looks for `pyrightconfig.json`,
   `pyproject.toml`, `setup.cfg` at the root, else the workspace root (plus `src` when `src/` has `.py` files).
   **Ruling 1 — a configuration error fails the language** (e.g. an import root outside the readable snapshot): the
   language is `failed` with that reason; no fallback to another configuration (§9.1 "失败不换配置").
4. **C/C++ per-file attribution. Ruling 2:**
   - one translation unit that libclang cannot parse → its main file `failed` (reason: libclang's code), the other units
     still parse (today one failure aborts the whole batch);
   - an error or fatal diagnostic located in a file → that file `failed` (reason: the first such message), the unit's
     edges are still taken;
   - a file of the language reached by no parsed unit (not in the compile database, not included by a parsed unit) →
     `skipped` ("not reached by a parsed translation unit");
   - headers count as files of the language; a header included by a parsed unit with no error located in it is
     `parsed` (A-06 case 2: `files: 2, parsed: 2`).
5. **Paging and parsing once. Ruling 3:** each analyzer's first imports query fixes its own snapshot and every later
   page carries it (`expectedSnapshot`, L13; A-06's `many.py` crosses the analyzer's second page). The index parses a
   snapshot **once** for the lifetime of one index instance and serves the pages of the imports operation from that
   result; it never re-parses per page. Exploration tools' other operations are unchanged.
6. **Environment and failure. Ruling 4:** the Python index gets constructor options like the C/C++ index (`pythonPath`
   and an `analyzersDirectory` defaulting to `.local/source-analyzers`); production passes nothing; tests inject a
   missing directory for "the analyzer is not available" (A-06 case 3). An analyzer that cannot run makes that language
   `failed` with the reason and never affects the other languages (L13, §3). Correct the not-available message so it no
   longer points at an install script that does not exist; say what is missing.
7. **Deduplication and unresolved (L13):** edges deduplicated across pages; unresolved specifiers kept (A-06: `e.py`
   → `os`).

## 3. Rows

- **A-06 (AE6)**, all four situations, memory and SQLite where the capture is stored, expected values literal from the
  row (file nodes, `nonBlankLines`, the exact edge set, unresolved, the three `LanguageCoverageV1` values, the
  `compare-formal` line `N→S` `unknown` in case 1 and `proven` in case 2, the pure non-TS project). Case 2 needs libclang
  (`/usr/lib/llvm-18/lib/libclang.so.1` on this machine) and case 1/3 need the Python analyzers package
  (`.local/source-analyzers`); report if your environment lacks either rather than skipping silently.
- **§5.3 old assertions:** `tests/data/S8A-file-graph.test.ts` ~160, ~163, ~188 (Python and C/C++ coverage were
  `unsupported`) change to what A-06 says; the low-level indexes' own `unsupported` cases do not flip.

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id. Expected values literal, from the row or hand-computed.
- **Tests through public entries** (the capture and the file-level reads, as `tests/**/S8A-*.test.ts` drive them;
  temporary workspaces). Fault injection is fine (a missing analyzers directory, a library path that does not exist, a
  syntax error in a file); fact injection is not. States only tampering can make are not tested (AGENTS rule 4).
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end.
- **Line budget (decision 69):** about 800 new production lines (Codex estimated 500–800; soft). Report the count.

## 5. Order (suggested; you decide the briefs, files disjoint)

1. The two scripts and indexes (items 2, 4, 5, 6): one subagent for C/C++, one for Python, in parallel.
2. Then the providers, configuration and registration (items 1, 3, 7) with A-06 and the §5.3 assertions.
3. Close-out (one subagent): the checks below.

## 6. Checks (close-out subagent)

- `--maxWorkers=2`: `tests/data/`, every `tests/**/S8A-*.test.ts`, the source-tool tests (`tests/**/*source*.test.ts`),
  `tests/architecture/`, `tests/composition/`, the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox (no bwrap). Name any other failure. **Do not run
  the full suite.**

## 7. Reply

Under 800 words: FILES CHANGED (production / tests, production line count); each scope item and A-06 situation: done
or not, RED → GREEN; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at once);
anything surprising (especially the environment).

## 8. Answers to the read-through (lead, 2026-10-17 12:55; binding like the sections above)

Paths: the provider interface, `capture.ts` and the indexes are in `src/core/workspace/`; the DTO is
`src/contracts/architecture-inspection.ts`; the comparison is `src/core/work-graph/architecture/formal-comparison.ts`.
Spec §5.1's "待你确认" on AE6 is stale: the user confirmed the entries (decision 64); the lead post-notes it.

1. **Reason texts.** The three whole-language reasons 8D creates use the row's Chinese literally, like 8A's
   `引用关系未支持`: `没有 compile_commands.json`, `有多个编译数据库`, `分析器不可用`. Other language-level failures (a
   configuration error, an analyzer runtime error) carry the analyzer's message. Per-file issues keep the existing
   machine text where one exists (8A's binary skip, the analyzer's syntax message) and the test asserts that text
   literally; A-06's `语法错误` / `二进制` name the kind of reason, not the literal (the lead post-notes it). The new
   per-file C/C++ skip reason uses spec §2's phrase `没有编译单元包含它` (replaces the book's English phrase in ruling 2).
2. **The injection seam: option (a).** An optional `sourceAnalyzers?: { directory?: string; pythonPath?: string;
   cppLibraryPath?: string }` on `TargetPlatformOptions` and `WorkspaceToolsDependencies`, forwarded to every place the
   platform constructs the two indexes (the capture's providers and the exploration tools), like 8A §9.7's injectable
   caps. Production passes nothing (defaults unchanged). The capture registry takes its non-TS providers through its
   constructor, filled by the composition. Do not drive A-06 through a bare registry.
3. **`other` in `languages`:** assert the three named entries by language (find), leave `other` as 8A has it; where a
   case adds a file (case 2's `compile_commands.json`), hand-compute the node count and assert it.
4. **Whole-language failures:** no per-file issues when the language has no configuration or no analyzer: the
   language `reason` covers it and `issueCount: 0` (as A-06 writes cases 1 and 3).
5. See answer 1 (spec §2's phrase).
6. **Subagents:** decision 76 removed the fixed cap; run as many as your plan needs with disjoint files (2–3 is fine).
   `coordinator-mode.md` is updated accordingly.
