## 1. Unclear

1. **Exact reason strings.** A-06 writes Chinese prose: cpp `没有 compile_commands.json` / `有多个编译数据库`, python `分析器不可用` / `语法错误`, `logo.png` reason `二进制`. Code emits English (`binary source`, `invalid syntax`, `Multiple compilation databases; select configPath explicitly`, a long `requires a readable compile_commands.json…`). Book says expected values are literal. Options: (a) translate at the provider/capture boundary to the row’s Chinese; (b) keep existing machine text and assert only the fields the row spells out; (c) Chinese for language-level `reason`, existing English for per-file `issues`.
2. **How tests inject the analyzer paths.** Book item 6 says “production passes nothing; tests inject a missing directory”, and ruling 4 names Python index options. But `CaptureRegistry` has a private, always-empty `providers` list (`capture.ts:106`) and its constructor takes no providers or analyzer paths; `createWorkspaceTools`/`TargetPlatformOptions` expose only `fileGraph`. A-06 must go through public capture. Options: (a) add optional `sourceAnalyzers` (`directory`, `pythonPath`, `cppLibraryPath`) to `WorkspaceToolsDependencies` + `TargetPlatformOptions`, forwarded to the provider factories; (b) add a provider-factory list instead; (c) drive A-06 through a bare `CaptureRegistry` (violates “public entries”). This is the one blocking gap.
3. **Does `languages` include `other`?** The row lists three coverage objects, but says `logo.png` is “recorded in `other`’s issues”; current capture always emits an `other` entry (existing tests `S8A-01/02` assert it). Options: (a) assert only the three named entries via `find`/`toMatchObject`; (b) assert an exact four-element array (then case 2’s `compile_commands.json` also becomes an `other` node, not just an edge).
4. **Whole-language failures: per-file `issues`?** A-06 gives cpp case 1 and python case 3 without an `issues` list. Options: (a) no per-file issues when there is no configuration/analyzer (language `reason` covers it, `issueCount: 0`); (b) mark every claimed file `skipped`/`failed` (then `issueCount` = files).
5. **C++ skipped reason text.** Spec §2 says `没有编译单元包含它`; book ruling 2 says “not reached by a parsed translation unit”. Options: use the book phrase, the spec phrase, or a stable English phrase.
6. **Book vs `coordinator-mode.md`:** the book says “no fixed limit on subagents (decision 76)”, coordinator mode says “at most 3 at a time”. I would keep 2–3.

## 2. Book/spec/facts vs code

- There is no `src/core/architecture/`. The provider interface is `src/core/workspace/architecture-language-provider.ts` (`export interface` at :21), `capture.ts` is `src/core/workspace/capture.ts`, the DTO is `src/contracts/architecture-inspection.ts`, and the comparison is `src/core/work-graph/architecture/formal-comparison.ts`.
- `capture.ts`’s non-TS provider list exists only as a private empty array (:106); no constructor option or registration method exists, so “registered in the capture’s non-TS provider list” is not currently possible.
- Book §3 names old assertions “~160, ~162, ~188”; actual Python coverage is :160, the empty-edge assertion is :163, and :162 is only `]);`. C++ coverage is :188.
- Facts §3 says Python syntax failure is at `python-source-query.py:232`; actual `except SyntaxError`/append is :234–235.
- Spec §5.1 AE6 still says “待你确认” while the book says the user confirmed entries (decision 64).
- Python index has no `pythonPath`/`analyzersDirectory` option: it hardcodes `/usr/bin/python3` (:75) and repo-relative `.local/source-analyzers` (:26–30). C++ already has `{ libraryPath, pythonPath }` (:18, :61, :66).
- `runtime-assets.json` entries are correct (:55, :59); both current script hashes match.

## 3. Environment

- `/usr/lib/llvm-18/lib/libclang.so.1` exists (symlink to `libclang-18.so.18`). A hand-run `cpp-source-query.py` on an A-06-style project with `compile_commands.json` returned `sourced`, engine 18.1.3, and resolved `native/c.cpp → native/d.h`; no diagnostics.
- `/usr/bin/python3` is 3.12.3. `.local/source-analyzers/analyzers.zip` hash matches `analyzers.sha256`; zip contains Jedi 0.19.2 and Parso 0.8.4. A hand-run `python-source-query.py` resolved `e.py → g.py`, kept `os` unresolved, and reported `invalid syntax` for `f.py`.
- A copy of the script with no sibling `.local` printed `Python semantic provider missing; run scripts/setup-source-analyzers.py` — confirming the nonexistent-install-script message.
- A-06 lacks nothing at the toolchain level; it lacks only the public injection seam in §1.2. bwrap is not needed by these probes.

## 4. Tests that will break

- `tests/data/S8A-file-graph.test.ts:160` (S8A-03 Python coverage) and `:163` (`edges` is now `[{e.py,g.py}]`), plus `:188` (S8A-05 cpp); the book names 160/162/188.
- `tests/architecture/boundaries.test.ts` / `scripts/check-boundaries.mjs:245` (`runtime asset hash differs`) until `runtime-assets.json` is updated.
- Keep the low-level messages and cache semantics or these break: `tests/data/cpp-source-index.test.ts:91` (`analyzer unavailable`), `:93` (`requires a readable compile_commands`), `:147` (`Multiple compilation variants`), and `tests/data/python-source-index.test.ts:98` (`index.reusedResult`). No other test asserts `languages` for a `.py`/`.cpp` fixture; `S8A-file-layer` S8A-06 only asserts nodes and will now exercise Jedi (slower, still green).

## 5. Plan

- Wave 1 (parallel, 2): **W1** C++ script + `cpp-source-index.ts` (per-TU failure, per-file status, parse-once cache), 45–50 min; **W2** Python script + `python-source-index.ts` (per-file status, options, keep response cache), 30–35 min. No shared files.
- Wave 2 (1): **W3** providers, config selection, registry registration and `sourceAnalyzers` seam in `architecture-language-provider.ts`, `capture.ts`, `workspace-tools.ts`, `create-platform.ts`, 40–45 min.
- Wave 3 (1): **W4** A-06 + §5.3 flips in one new test file plus `S8A-file-graph.test.ts`, 40–45 min.
- Wave 4 (1): **W5** close-out checks, `runtime-assets.json` hash lines, integration fixes, 30–35 min. Total ≈ 160–170 min; max 3 at once (I would run 2).
- Production estimate: **≈550–650 lines** (C++ script/index ~160, Python ~70, providers ~180, registration/options ~50), plus ~350–450 test lines.