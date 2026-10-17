# Verify: Codex's 8D implementation review (Claude subagent, adversarial)

Method: read the diff, spec, book and answers, and the code in `D:/cxt/s8d-review`; ran 11 probes in my own WSL copy at `s8d-1` (hashes match the Windows copy), one also at `slice-base`; copy deleted. Every item survives at least in part; one extra regression (X). Paths are under `src/core/workspace/` unless stated.

## 1. Skipped config → silent fallback: HOLDS
- **Evidence:** the frozen inventory is only the read texts (`capture.ts:289-291`); skips go under `other` (`:281-286`). Both providers pick their config from that list (`architecture-language-provider.ts:287`, `:251`).
- **Probes:** root `pyrightconfig.json` = `{"extraPaths":["lib"]}\0` → python `supported, parsed 3, complete:true` with `import c` (in `lib/`) unresolved: another configuration was used. Root DB with NUL plus a valid `build/compile_commands.json` → C/C++ `supported, complete:true` from the nested DB. Root DB alone → `没有 compile_commands.json`, which is false.
- **Scope:** yes. §9.1 (binding on 8D) counts "配置文件被跳过" as an analysis failure ("不偷换别的配置"); ruling 1 forbids fallback. L13 selects by existence, a skipped file exists, so its failed read is a configuration error.
- **Fix:** Codex's is the smallest correct one. The owner adds `observed.skipped` to the frozen access (e.g. an optional `skipped` on the inventory result); providers select over read ∪ skipped and fail the language if the selected config was skipped. Do not put skips into `inventory.paths`: one skipped `.py` would then fail all of Python.
- **RED test:** the probe fixture (`a.py` imports `b` and `c`; `b.py`; `lib/c.py`) → python `{files:3, parsed:0, edges:'failed', reason:'pyrightconfig.json: binary source', issues:[], issueCount:0, complete:false}`, `edges: []`. The lead fixes the wording; C/C++ is the same shape.

## 2. Per-TU tolerance leaks into other operations: HOLDS
- **Evidence:** `scripts/cpp-source-query.py:255-261` now does `continue` for every operation; the old code raised `Unsupported`. The failure appears only in `importCoverage` (`:367-378`), and `hasErrors` reads only the diagnostics (`:383`).
- **Probe:** one TU with `--target=bogus`. `symbols` and `calls` return `{status:'sourced', results:[], hasErrors:false, diagnostics:[]}`. With one good and one bad TU, `symbols` returns only `b.cpp` and signals no gap.
- **Scope:** yes. Book §2.1 ("exploration tools keep behaviour") and §2.5 ("other operations unchanged") cover it; ruling 2 is about imports coverage.
- **Fix:** restore the old raise when `query['operation'] != 'imports'` (one line). A better fix is the flag under X.
- **RED test:** index (as `cpp-source-index.test.ts`) or the `cpp_index` tool, `{operation:'symbols'}` → `{status:'unsupported', message:'libclang could not parse configured translation unit: src/a.cpp (code 1)'}`.

## 3. Analyzers directory not passed to the script: HOLDS (latent in production)
- **Evidence:** `python-source-index.ts:29,35-46` checks the directory and computes the digest from it. The spawn (`:90`, `:94`) sends only `['-I', script]` and `{files, query}`. The script loads `Path(__file__)/../.local/source-analyzers` (`python-source-query.py:115-132`) before it reads stdin (`:143`), and its "missing" message is hard-coded (`:136`).
- **Probe:** an injected directory with an empty zip, matching sha256 and a manifest → python `supported, parsed 2, complete:true` (the script used the repo archive), while `provenance.toolchain.dependencyArchiveDigest` is the empty zip's (`8739c76e…`). Production passes nothing, so it is latent there; the defect is in ruling 4's seam.
- **What PROV-03 proves:** only the parent's ENOENT check (`:38-39`) before any spawn.
- **Fix (smaller than moving stdin):** pass the directory as argv (`['-I', script, dir]`); the script uses `sys.argv[1]` when present and names it in the missing message. Update the sha256.
- **RED test:** that probe through the capture → python `{files:2, parsed:0, edges:'failed', reason:'分析器不可用', issues:[], issueCount:0, complete:false}`, `edges: []`.

## 4. Unbounded C/C++ cache: PARTLY HOLDS
- **What holds:** the key is `[snapshot, configPath, path, prefix]` (`cpp-source-index.ts:66`); each entry stores the whole `captured` material plus the analysis (`:16`, `:83`); no eviction, no dispose, and `cppIndex` is not in `disposables` (`agent-runtime/exploration-tools.ts:95,125`). Probe: 7 imports queries (whole, two paths, a prefix, three edits) left 7 entries, each with every file. The bound is one entry per distinct imports call in a Run, freed only by GC after the group closes. Capture providers build one index per `extractImports` (≤1 entry), so only exploration is affected.
- **What does not hold — digest staleness:** `libraryPath`, `pythonPath` and the script path are fixed per instance, and nothing in `src` swaps them at run time. After an external on-disk swap, a cached page still reports the digests of the engine that produced it, which is accurate. No toolchain key is needed.
- **Not a regression:** re-parsing per path (before 8D every query re-parsed everything).
- **Fix:** drop `captured` from the entry; it is redundant, since the key holds `captured.snapshot`. Then either (a) clear the cache on a snapshot change and cap it, as Python does (`python-source-index.ts:83,99`); or (b) Codex's variant: key `[snapshot, configPath]`, send imports without path/prefix, and filter in TS. (b) is equivalent (the script filters after collecting; dedupe/sort commute), about 5 lines, ≤1 entry, and removes the re-parse.
- **RED test:** only for (b). Through `cpp_index` with a run-counting `pythonPath` wrapper (as S8D-CPP-03): imports whole, path a, path b → runs `1` (today 3). Memory growth has no public observable.

## 5. Case mismatch: HOLDS, and the problem is wider
- **Evidence:** `languageOfPath` lowercases (`architecture-language-provider.ts:71`); the indexes and `scripts/cpp-source-query.py:126` are case-sensitive (`cpp-source-index.ts:8`, `python-source-index.ts:9`).
- **Probe 1:** `main.cpp` includes `"API.H"` → cpp `{files:2, parsed:0, edges:'supported', issues:[main.cpp failed "'API.H' file not found"]}`, no edge, nothing for `API.H`. `e.PY` → python `{files:2, parsed:1, issues:[], complete:false}`.
- **Wider:** the indexes' `ignored()` list (`node_modules`, `.venv`) differs from the observation's (`project-source-snapshot.ts:64-65`). Probe 2: `a.py` + `node_modules/gyp/pylib/b.py` + `.venv/lib/c.py` → python `files:3, parsed:1, issues:[]`.
- **8A:** L12 has no case rule; lowercasing is 8A's reading, and 8A's TS provider has the same gap (`X.TS` claimed, `isSourcePath` case-sensitive, `:63`).
- **Fix (smaller than unifying the rules):** in the providers, give every claimed path with no per-file result a `skipped` issue (lead fixes the text). About 5 lines; closes both causes.
- **RED test:** probe 1 → cpp `issueCount:2` including `{path:'API.H', kind:'skipped', reason:<literal>}`; python `issues:[{path:'e.PY', kind:'skipped', reason:<literal>}]`.
- **Routing:**
  - The two providers: 8D rework.
  - The ignore-list part shrinks under the scale fix §10.1 but does not disappear (tracked files in git mode).
  - TS `X.TS`: scale fix (§10.3 rewrites the TS path) or an 8A note.

## 6. Run failures read as 分析器不可用: HOLDS for C/C++
- **What reaches the provider:** every `execFile` error (spawn ENOENT, non-zero exit, signal, 60 s timeout, 8 MiB maxBuffer) carries the prefix "C/C++ analyzer unavailable, failed or exceeded capacity:" (`cpp-source-index.ts:73`). Script `Unsupported`/`OSError` cases (libclang missing, ABI, configuration) arrive as `unsupported` with their text; anything else as `rejected`.
- **Mapping:** the regex `/analyzer unavailable/` (`architecture-language-provider.ts:233,260`) turns every `execFile` error into `分析器不可用`. Probe: maxBuffer, SIGSEGV and a missing interpreter (via `pythonPath` wrappers) all give `分析器不可用`, against answer 1.
- **Python (not in Codex's item):** runtime errors keep their message (correct), but a missing interpreter gives "Python analyzer failed or exceeded capacity: spawn /no/such/python3 ENOENT", not `分析器不可用`.
- **Fix:** classify at the source. Spawn ENOENT/EACCES → "…analyzer unavailable: …" (Python: `MissingAnalyzers`); other errors → "…failed or exceeded capacity: …"; anchor the regex to the three "unavailable" prefixes. These are the lines the scale fix §10.5 edits; if routed there, its "type + 200 chars" must sit on top of this split.
- **RED test:** C/C++ with a wrapper printing 9,000,000 bytes → `reason:'C/C++ analyzer failed or exceeded capacity: stdout maxBuffer length exceeded'`; Python with `/no/such/python3` → `reason:'分析器不可用'`.

## 7. Duplication: note only
- **Double parse:** confirmed (`python-source-query.py:209,248`) and in decision 69's cost scope, but Jedi's goto per alias dominates and `ast.parse` runs at C speed. Codex's "keep the first tree" holds every AST of up to 64 MiB of source at once. If done, use one loop (parse once, record coverage, run Jedi only on selected files), and only because items 2/3 re-hash the script anyway.
- **Providers:** the two new ones share about 25 lines; merging is cheap and gives §10.5 one place to edit. The `edgesOfRows`/TS dedupe merge is 8A code → scale fix (§10.3).

## X (new). Exploration `imports` regression: HOLDS
- **Evidence:** both indexes spread `importCoverage` (every file of the language, ignoring path/prefix/limit) into the result (`cpp-source-index.ts:94-95`, `python-source-index.ts:102-103`); exploration tools reject output over 60 KiB (`exploration-tools.ts:160`).
- **Probe:** 1,500 small files, `python_index` imports with `path` and `limit:10` → `error "Analysis output too large; narrow paths or result limit"`; at `slice-base` → `success`. Above about 1,300 Python files (fewer for C/C++) exploration `imports` is gone, against book §2.1.
- **Fix:** put 8D's per-file coverage and per-TU tolerance behind a provider-only query flag (the strict tool schemas cannot set it). Exploration then behaves as before, which also fixes item 2.
- **RED test:** that probe → `status:'success'`.

## Summary
Five of the six "必须改" hold in full (1, 2, 3, 5, 6; 6 for C/C++, plus Python's opposite case); 4 partly (memory growth yes, digest staleness no). Item 7 is a note. X also holds.
- **8D rework:** 1; 2 + X (one flag); 3; 4 (drop `captured`; key without path/prefix); 5 (generic skipped issue); 6.
- **Scale fix:** 6's reason format after the split (§10.5); TS `X.TS` gap and the TS dedupe merge (§10.3); ignore-list alignment (§10.1).
