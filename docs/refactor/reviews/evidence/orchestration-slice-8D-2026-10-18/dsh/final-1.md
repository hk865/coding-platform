All work is complete and verified. Final reply:

## FILES CHANGED

**Production (12 files, +353/−40):** `src/` +289/−34 in 10 files — `workspace/architecture-language-provider.ts` +167 (two providers, config, paging, dedupe), `workspace/cpp-source-index.ts` +51/−16ish, `workspace/python-source-index.ts` +37/−10ish, `workspace/capture.ts` +8/−3 (providers via constructor), `workspace/workspace-tools.ts` +22, `composition/create-platform.ts` +11, `agent-runtime/{execution-contracts,execution-driver,exploration-tools,query-execution}.ts` +27/−4; `scripts/` +64/−6; `runtime-assets.json` 4 lines (both hashes). Well under the ~800 soft budget.

**Tests:** new `tests/data/S8D-language-providers.test.ts` 208, `tests/composition/S8D-A06-multilingual.test.ts` 334; modified `tests/data/S8A-file-graph.test.ts` +3/−3 (only S8A-03/05), `cpp-source-index.test.ts` +134/−1, `python-source-index.test.ts` +73/−1.

## Scope items (RED → GREEN)

1. **Providers/interface/registration** — done. Factories in 8A's `architecture-language-provider.ts`, registered through `CaptureRegistry`'s constructor filled by `createWorkspaceTools`; only the frozen `ProjectSourceAccess`. PROV-01 RED (cpp `unsupported`/`引用关系未支持`) → GREEN; PROV-02..06.
2. **Per-file results and full counts** — done. Both scripts return untruncated `importCoverage` before diagnostic truncation; `LanguageCoverageV1` built by §2's formula (`complete = supported && parsed==files && issueCount==0`), only stored `issues` capped. CPP-01/02, PY-01. Script hashes updated; `check:architecture` 0 hash lines.
3. **Configuration** — done. C/C++ root wins, else only one, else `有多个编译数据库`, none `没有 compile_commands.json`; Python root `pyrightconfig.json`→`pyproject.toml`→`setup.cfg`, else the script's root(+`src`) roots; a configuration error fails the language with the analyzer's message and no fallback (PROV-05; root-first PROV-02 RED `有多个编译数据库` → GREEN).
4. **C/C++ attribution** — done. Per-TU parse failure fails only its main file and other units parse; error/fatal diagnostic fails its file, unit edges kept; unreached headers `skipped` with `没有编译单元包含它`; reached header `parsed`. CPP-01 RED batch abort → GREEN; CPP-02 RED header parsed → GREEN; A-06 case 2 files 2/parsed 2.
5. **Paging / parse once** — done. First imports query fixes the snapshot, later pages carry `expectedSnapshot`; C++ caches the full analysis (CPP-03 wrapper counter shows exactly 1 script run across 2 pages); Python reuses the cached analyzer response (PY-02 `reusedResult:true`, pages 100/200; `many.py` 201 imports one edge).
6. **Environment/failure** — done. Python index takes `{pythonPath, analyzersDirectory}` (defaults unchanged, production passes nothing); missing package → `分析器不可用`, `issueCount:0`; corrected message names `analyzers.zip`/directory, no nonexistent install script. PY-03/04, PROV-03/04.
7. **Dedup/unresolved** — done. Edges deduped across pages (201→1), unresolved kept.

**A-06:** all four situations on memory + SQLite, **8/8 GREEN**; node/`nonBlankLines` literals, exact edge sets, three coverage objects, `other`'s `logo.png`/`binary source`, `python` `f.py`/`invalid syntax`, and `N→S` `unknown` (case 1/3) → `proven` (case 2). §5.3 S8A-03/S8A-05 RED → GREEN; low-level `unsupported` cases untouched.

## CHECKS (`--maxWorkers=2`)

`tests/data/` 21 files/167 pass · all 9 `S8A-*` 67 pass · 25 `*source*` files 240 pass · `tests/architecture/` 4/53 pass, `check:architecture` exit 0 (0 hash lines; production-reach allowlist untouched) · `tests/composition/` 40 files/149: 128 pass, **21 fail all DSH-BASELINE §A** (missing bwrap; 5 A2-requeue, 1 A2-reverify, 6 verification-chain, 2 R3e-check, 1 R3e-completion, 3 R5c, 3 S2B) — no other failure · new two files 15/15 pass · my rerun of the three flipped/low-level files 39/39 · `typecheck` 0 · `build` 0.

## UNSPECIFIED

- **A-06 `unresolved` has no public page field** (`FileGraphPageV1` has none, §2), so the exact `e.py→os` entry is asserted through `compareFormalObserved`'s `{kind:'unresolved', path:'e.py', detail:'os'}`; smallest alternative is adding `unresolved` to the page (outside the frozen DTO).
- **C++ parse-once cache key** includes material digest + configPath + query path/prefix so per-file `imports` queries cannot collide; paging within one scope still parses once.
- **`analyzerSnapshot` on a later-page stale** returns the first page's snapshot; not asserted.
- `语法错误`/`二进制` are kind names, not literals; tests assert `invalid syntax`/`binary source` per §8.1.

## Subagents

Five: C/C++ script+index; Python script+index; providers/config/seam; A-06+flips; close-out. Disjoint files, most at once **2**, roughly 15–25 min each. All wrote their own code/tests; I edited nothing.

## Surprising

Environment had both `/usr/lib/llvm-18/lib/libclang.so.1` and `.local/source-analyzers` — nothing missing. libclang 18 returns parse code 0 for ordinary syntax errors (they arrive as diagnostics), so the low-level parse-failure test adds `--target=bogus` to reach code 1; acceptance case 2 is unaffected. Wave 2 first implemented “any two compile DBs fail”; its report flagged it against L13 and wave 3 corrected it to root-wins (RED→GREEN) before acceptance.