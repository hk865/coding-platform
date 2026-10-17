## 1. Unclear (question + smallest options)

1. **`notes` in the codec.** The type is `LanguageCoverageV1` in `src/contracts/architecture-inspection.ts:74`; the record decoder is `readLanguageCoverage` in `src/core/work-graph/architecture/architecture-record-codecs.ts:249`. It currently uses `exactKeys([...8 keys])` and returns an object with no `notes`. Options: (a) accept an optional `notes`, validate only “array of strings”, return `value.notes ?? []`, and leave the 10×200/sort/dedupe rule to providers; (b) also reject records that violate the caps/order; (c) sort/truncate in the codec. The spec does not say which layer owns the caps.
2. **`skipped` / `configOnly` today.** `captureFileGraph` builds `frozen` only from read text (`capture.ts:289-298`) and calls `extractImports({ source: frozen, signal })` (`:324`). `observed.skipped` only becomes `issues` (`:281-286`, `:306`). So the new `skipped` parameter does not exist. Options: pass all skips (provider filters by language/config name) or a per-language subset. `configOnly` is empty this segment; pass `new Map()`.
3. **Workspace roots for the C/C++ header.** `WorkspaceReadAccess` (`access.ts:35-50`) has `workspaceIdentity` (a stat-derived identity, not a path) but no `workspaceRoot`/`workspaceRealRoot`. Options: (a) add required `root` and `realRoot` to `WorkspaceReadAccess` and update test access mocks; (b) add optional fields and require them only for C/C++ observation; (c) add a `roots()` method to `ProjectSourceAccess`. The spec says “the capture owner takes them from where the root is resolved”, but that value is currently discarded in `createWorkspaceAccessFactory`.
4. **Provider `coverage.edges` consistency.** The new interface says the capture copies the provider’s `edges`, while `files`/`complete` are owner-computed. Should the capture trust a provider that returns `edges:'supported'` with a non-null `reason`, or reject/normalize it? Smallest: trust `edges`/`notes`, copy `parsed`/`issues`, compute `complete`; do not validate the reason.
5. **Timeout plumbing.** `sourceAnalyzers` (`workspace-tools.ts:31`, `execution-contracts.ts:231`, `exploration-tools.ts:84`, `create-platform.ts:226`) has only `directory`, `pythonPath`, `cppLibraryPath`. `createWorkspaceTools` builds both providers at `:55-65`; `pythonPath` reaches both indexes and `cppLibraryPath` only C/C++; neither timeout reaches anything. Options: add both optional timeout fields to the same shared type (exploration ignores them), or define a separate observation-only options type. `sourceAnalyzers.directory` must stop reaching the observation Python provider.
6. **Zero-readable-file rule.** Should the provider short-circuit on `claimed.length === 0` (as TS does at `architecture-language-provider.ts:96-100`) before config/database selection, or should the capture not invoke it? The capture currently invokes every recognized language, including languages with only skipped files. Provider short-circuit is the smallest and matches “no config, no database, no process”.
7. **Python argv/version.** `scripts/python-source-query.py` ignores `sys.argv`, hardcodes `.local/source-analyzers` (`:115`), imports `tomllib` at `:11`, and `PythonSourceIndex` invokes it with `-I` only (`python-source-index.ts:90`). Options: route on `sys.argv[1] == 'import_graph'`; put the 3.11 check before `tomllib` for all operations, or only for `import_graph` (old `python_index` behavior on 3.10 would then differ).
8. **C/C++ approximate note.** Add `近似：…` whenever the language is `supported`, or only when `parsed > 0`? The prototype adds it after any non-empty scan (`d6_scan.py:358`), including all-failed units; the spec says “read claimed files ≠ 0”. Smallest: add it after the zero-file early return, regardless of `parsed`.

## 2. Spec differs from the code

- §11.5’s interface is not the real one: actual `extractImports` takes `{ source, signal }`, returns `analyzerSnapshot`, and its coverage has `files`/`complete` but no `edges`/`notes`; there is no `skipped`/`configOnly` (`architecture-language-provider.ts:20-38`). `LanguageCoverageV1` has no `notes`.
- `sourceAnalyzers` has no `unitTimeoutMs`/`languageTimeoutMs` (four declarations above).
- Python script: analyzer directory is hardcoded, not `argv[1]`; invocation is `-I`, not `-I -S`; no version check (`python-source-query.py:11,115-137`).
- 8D additions to remove are present: `CppSourceIndex.importsCache`, `importCoverage`, `MissingAnalyzers`, and `collectImports` paging (`cpp-source-index.ts:27,63-109`; `python-source-index.ts:13-18`; `architecture-language-provider.ts:160-195`).
- Cited-line drift: `capture.ts:344` is the cancel branch, not a capacity check; `:270-273` is the text/skips maps (language counting is `:272-276`); `:302` is `unresolvedKeys`. `architecture-language-provider.ts:94-96` is the provider object start; TS zero-file is `:96-100`. `capture.ts:305`, `:327`, `:332`, `:357` match.
- §11.4 cites `light_include_scan.py:70-151`; that file does not exist in the prototype (`proto_scan.py`/`d6_scan.py` are present).

## 3. Tests that will break

Beyond the explicit fate list, the type change breaks compile-time literals in `tests/work-graph/S8A-formal-comparison.test.ts:31-45` (helper at `:32`, `supportedCoverage` at `:36-44`) and `tests/work-graph/S8A-file-layer.test.ts:153-156` (`A_01_LANGUAGES`), plus coverage overrides at `S8A-formal-comparison.test.ts:245,266,373`. Runtime `toEqual` assertions also gain `notes`: `tests/data/S8A-file-graph.test.ts:113,128-130,202-203` (the fate list names only `:160` and `:188`), and `tests/data/S8D-language-providers.test.ts:94-100,112-116,127-130,143-148,162-167,178-180`. `tests/composition/S8D-A06-multilingual.test.ts:170-188,218-220,260-265,295-300,328-330` changes anyway under A-06. `tests/architecture/boundaries.test.ts:352-355` fails until `runtime-assets.json` digests are updated (book item 5, not a test edit). I found no other failing tests beyond the fate list and these `notes` edits.

## 4. Prototype check

Copied `./.dsh-ref/proto/cpp/` to scratch and ran `python3 -I ./.dsh-scratch/proto-cpp/run_fixtures.py`. libclang 18 loads (`Ubuntu clang version 18.1.3`). 31 of 32 fixtures pass; the single mismatch is `X-colcon-real-layout` (prototype reports `有多个编译数据库` where frozen §11.4 uses the aggregate). This is the first of the book’s two “prototype predates the spec” cases; the second (Python no-read rule) is not exercised by the C++ runner. Scratch deleted.

## 5. Plan

Peak 5–6 subagents, disjoint files, `--maxWorkers=2`, stagger test runs (memory 8 GB).

- **S0 seam (45m):** contracts/codec `notes`, provider interface and `skipped`/`configOnly`, capture copy `edges`, `sourceAnalyzers` timeouts and roots. Owns `contracts/architecture-inspection.ts`, `architecture-record-codecs.ts`, `capture.ts`, `access.ts`, `workspace-tools.ts`, `create-platform.ts`.
- **S1 Python script (120m):** `scripts/python-source-query.py` only; A-20/A-21 script-level tests in a new file.
- **S2 C/C++ script (150m):** `scripts/cpp-source-query.py` only; A-22/A-23 script-level tests in a new file.
- **S3 runner (100m):** new NDJSON runner module + runner unit tests.
- **S4 take-out/providers (90m):** `architecture-language-provider.ts`, `cpp-source-index.ts`, `python-source-index.ts`, `exploration-tools.ts`; config selection, database merge, provider wiring.
- **S5 Python/runner rows (90m)** and **S6 C/C++ rows (100m):** public-entry tests, separate files; S7 regression/notes edits (60m), owns `S8A-file-graph.test.ts` and whole-object updates.
- **Close-out (45m):** checks, digests, integration fixes.

Critical path S0→S2→S6 ≈ 45+150+100+45 = 340m, over the 240-minute cap unless S2/S6 overlap and S4/S5 run alongside. Production: **920–1,380 new lines, ~200 removed** (C/C++ 335–475, Python 230–320, runner 160–240, providers 90–140, selection/input 50–100, zero-file 10–20, coverage 30–60, `python_index` 10–15, timeouts 5–10).