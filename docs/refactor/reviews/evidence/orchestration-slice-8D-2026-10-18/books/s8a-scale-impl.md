# Task: the §10 segment of slice 8 — the observation's file inventory (git or skip list), the TS light scan replacing the analyzer in the observation, one scan shared by both layers, the v2 body and compact module snapshot, the v2 file-layer chunks with unresolved reasons, ignored compile databases as configuration (slice 8 §10 as amended by §11, decisions 77, 78); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it. No fixed limit on how many subagents run at once (decision 76),
but files of running subagents must be disjoint and every vitest command uses `--maxWorkers=2`. **Do not end your turn
while a subagent has not reported back.** Subagents write all code and tests; you split, brief, check and reply.
**Finish within 330 minutes** (the run stops at 340, with a handoff if needed). Finish whole items; an unfinished item
is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch at 13551ac9 (8A merged; slice-8 spec §10 and §11 frozen; its code is the same as
  da633d89). `s8d-1r` = the first 8D build replayed; `slice-base` adds `DSH-BASELINE.md`; then the 8D rework
  (decision 78, the C/C++ and Python light scans, the NDJSON runner, the coverage `edges`/`notes`), accepted by the lead except the two items of section 2 item 0.
  HEAD = tag `s8d-rw3`. Its book `./.dsh-ref/s8d-rework-impl.md` (§8 = the lead's answers), its reply
  `./.dsh-ref/s8d-rework1-final.md`, and its two further rounds: books `./.dsh-ref/s8d-rework2.md`, `./.dsh-ref/s8d-rework3.md`, replies `./.dsh-ref/s8d-rework2-final.md`, `./.dsh-ref/s8d-rework3-final.md` (their rulings bind here too, in particular: the TS provider alone selects compile databases; coverage notes are cut to 200, deduped, sorted, first 10; tests through the shared platform fixture `tests/helpers/S8D-platform-fixture.ts`).
- **The spec:** `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`: the header post-notes on decisions
  77 and 78, **§10 (whole, ~495–562)** and **§11 (whole, ~564–800)**; §11 wins over §10 where they differ (§11.1's
  "观测的捕获不带分析器" bullet lists the §10 items it changes). **This session builds §10 as amended and every §11
  bullet or row part tagged 〔§10 段〕.** The 〔8D 返工〕 parts are built; do not redo them; extend them where a 〔§10 段〕
  part says so. Also read L12 and §9 (8A's settled readings) for what §10 changes.
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding)

0. **Two items left from Codex's quick check of the 8D rework round 3** (`./.dsh-ref/s8d-rw3-review.out.md`, Chinese).
   Do them first, in their own small task.
   - **Must:** `graph_logical_directive` in `scripts/cpp-source-query.py` (~415–421) splits the whole file again for
     every reference (O(file × references)); §11.4 says each file's line-start offsets are computed once. Cache the
     physical lines or the line-start index per file, shared by both paths, then locate and join the current
     directive. Behaviour and existing assertions unchanged; update `runtime-assets.json`.
   - **Should:** A-11 (2)'s wrapper (`tests/composition/S8D-A11-python-failure.test.ts` ~35) starts Python in the
     background of a non-interactive `/bin/sh`, so it reads `/dev/null` instead of the platform's input. Run the real
     Python in the foreground with the original stdin, print `garbage`, then hang; the literal assertions stay.

1. **The observation's file inventory (§10 item 1).** Its own enumeration where the observation material is read
   (`access.ts`'s observation read), not through the verification reader's "workspace must be the repository root"
   check. In a git work tree: `git ls-files --cached --others --exclude-standard -z` run at the workspace root (a
   subdirectory of the repository is allowed; paths relative to the workspace root), through the existing git process
   layer and its sandboxed environment (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`) but not its root
   check (`git-read.ts` ~173); tracked-but-deleted files out, submodules out, symbolic links skipped as today. Not a
   git work tree or git unusable → the fixed skip list (`.git`, `node_modules`, `.venv`, `venv`, `__pycache__`,
   `.mypy_cache`, `.pytest_cache`, `.tox` at any depth), pruned **during** the recursion; today's hard skips aligned
   to it, one copy. No fallback on cancel (`cancelled`) or on the 60,000-entry cap (`capacity` with the count reached).
   `inventory: { source: 'git' | 'skip_list', reason: string | null }` on the observation record (reasons "不是 git
   仓库" or "git 不能用：<原因>"), returned by the three file pages next to `languages`; old observations read `null`.
   The material, the scans and the file layer use only this list.
2. **Ignored compile databases as configuration (§11.4's 〔§10 段〕 bullet, §11.5's provider-input comment).** In a git
   work tree, a second `git ls-files --others --ignored --exclude-standard -z -- ':(glob)**/compile_commands.json'`
   (no `--directory`); paths under a skip-list directory do not count; outside git nothing extra. Each found one: Host
   authorization checked before reading; read with its digest, or its skip reason recorded. Every file named
   `compile_commands.json` (ignored or not) has its own 32 MiB read cap, counted in the 128 MiB total. An ignored one
   is not a node, not any language's file, not in `other`'s `issues`; readable ones go into the C/C++ provider's
   `configOnly`, unreadable ones (not authorized, over 32 MiB, binary) with their reason into `skipped` (configuration
   selection only). The observation's source digest covers them (path + digest, or path + skip reason); both
   verifications (`capture.ts` ~221, ~623) find and read them again, a change → `source_stale`. The 8D rework's
   selection rules then apply over "ignored + not ignored" databases unchanged.
3. **The TS light scan (§11.2, whole) and the observation capture without analyzers (§11.1's 〔§10 段〕 bullet).** The
   observation's capture (built and released in `architecture-service.ts`) builds no TS program; the scan result has
   its own type (no `SourceRelation` stitching); semantic queries on it, `imports` included, answer `unsupported`. The
   configuration step extracted from `TypeScriptSourceAnalyzer.configure` into one exported function used by both;
   `references` → `unsupported` with the literal; the explicit-queue walk; loadability through
   `ts.getResolutionDiagnostic` and `ts.getAllowJSCompilerOption`; per-file format, parse with `setParentNodes: true`,
   explicit-stack traversal; the reference forms; resolution with the usage mode and one shared cache, the precomputed
   directory set; triple-slash `path` and `types`; line numbers; per-file try/catch (cancel rethrown), the raw-reference
   cap outside it (`lightScan.maxRawReferences`, default 100,000), language-level failures; yielding about every 50 ms
   with `signal.throwIfAborted()`; the engine identity fields; the fault hook `lightScan` through `workspace-tools` into
   the capture registration (precedent `fileGraph`). The 2,000-file / 40 MiB pre-check of §10 item 4 is **not built**;
   the three 10,000 caps in the observation path go (`capture.ts` ~565, ~207, ~238); the two 100,000 caps stay (raw
   references; deduplicated edges of all three languages together).
4. **One scan, both layers (§10 item 3 as amended).** The scan runs once in the capture; the module layer takes the
   walked files (failed ones and walked `.json` included) as `sources` and each reference as §11.2 lists; the file
   layer takes the deduplicated edges, unresolved references and per-file states. The file layer no longer builds a
   provider and scans again (`architecture-language-provider.ts` ~101 today). The TS self-edge rule of §11.5.
5. **Errors never recorded as success (§10 item 5 as amended).** Any language's scan exception or rejection → that
   language `failed` with `<type>: <first 200 characters>`, `complete: false`, others unaffected; TS failed → empty
   module layer, file layer still has files and line counts. Never commit "0 edges, empty module layer" with a
   successful coverage after a failure (a project with truly no references is `supported` with 0 edges).
6. **The v2 body and the compact module snapshot (§10 item 2, §11.2's "模块快照的没解析").** The snapshot drops
   `indexedSources`; its `unresolved` lines deduplicated, sorted, cut at 500 lines or 64 KiB cumulative with the line
   `另有 <n> 条没列出，逐条见文件层`. The module body `schemaVersion: 2` without `files`, `changes` path lists and
   `summary.coverage.unresolved`: capture identity, `observedAt`, the summary counts (files, per language, the three
   change counts), the mapping, the compact snapshot; 256 KiB and 240 KiB caps unchanged. Change counts as today over
   the capture's exported files, counts only. One chunk-reading helper for the Host's per-path authorization check,
   reading the previous observation and the three file pages; decode-time member checks by the chunk nodes. **v1
   bodies still decode, check members, and serve as `previous`;** observations from before 8A as §9 item 4.
7. **The v2 file layer (§10 item 6) and unresolved reasons (§11.5's 〔§10 段〕 part).** Chunks and the record's list
   carry `schemaVersion: 2`; nodes sorted by path; chunk edges as node-index pairs `[i, j]` over the whole sorted node
   table, across chunks; decode checks indices in range, node counts and member digests. The file layer's unresolved
   references move into the chunks as `{ from, specifier, reason }` (dedupe by `(from, specifier)`, the first non-null
   reason by string order), the record keeps the count; v1 reads `reason: null`. The formal comparison reads them from
   the chunks: `detail` = the specifier when `reason` is null, else `<说明符>（<原因>）`. 64 chunks × 256 KiB with nodes,
   edges and unresolved all counted (`capacity` beyond). The three file pages pick explicitly path, `nonBlankLines`,
   `language` and edges, plus `inventory`; digests, byte counts and `indexed` never appear on a page.
8. **Known limits** (§10 item 7 as amended by §11.1 and §11.7): the three pages read all chunks per call; three full
   material reads per observation; the TS scan in the Host process (memory follows the frozen material, one syntax
   tree at a time); the strict capture and `project_index` still build unbounded TS programs; the §11.2 "已知的差别".
   Write them where §11.7 says (tool descriptions), not into each observation's `notes`.

## 3. Rows for this session

- §10 item 8: **A-07, A-08, A-09, A-11 (§11.6's (1) replaces §10's A-11 for TS), A-12, A-13, A-14, A-15, A-16**
  (fixture as §11.6 "旧记录"); **A-10 is deleted** (§11.6 last line).
- §11.6 〔§10 段〕: **A-11 (1), A-17, A-18, A-19**, the `detail` assertions of **A-20** and **A-22**, the 〔§10 段〕 part of
  **A-23**, **"旧记录"**.
- §10 item 8's old tests whose assertions change: `R3d-record-integrity`, `S8A-file-layer`, `S8A-root-path`, the
  architecture codec tests (reads of `body.files`, `indexedSources`, path-shaped edges); whole-page assertions only
  gain `inventory`. Any other failing assertion: do not edit it; report it with before/after.
- **The A-16 / "旧记录" fixture is generated on the old code:** `git archive slice-setup` into `./.dsh-scratch/old/`
  (a read of the repository, no git write), link `node_modules` into it, and run a one-off generation script there
  through the public capture entry; the source tree has at least one TS file with an unresolved import (for example
  `import "missing-pkg";`). Store `ledger.sqlite`, `artifacts.sqlite`, the capture reference and that source tree under
  `tests/fixtures/s8-observation-v1/` with the generating commit (13551ac9; code as da633d89) and the script; add exact
  `.gitignore` exceptions for the two database files; every test copies the fixture into its own temporary directory.
- Memory and SQLite each, except where the row says otherwise (A-16 SQLite only). Expected values exactly as §10 and
  §11.6 write them (the TS ones by TS 6.0.3, hand-computed); if the code disagrees, report it, do not change the
  expectation.

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id. Expected values literal, from the rows or hand-computed.
- **Tests through public entries:** the observation through the platform/workspace capture path and the three file
  pages, the formal comparison through `compare-formal`, as the 8A and 8D tests do. Fault injection yes (`lightScan`,
  the chunk-size service option, the edge-cap platform option, narrowing the Host authorization); fact injection no
  (no hand-written records or bodies; the v1 fixture is written by the old code). States only tampering can make are
  not tested (AGENTS rule 4).
- **No second copy:** one inventory function for both outcomes, one chunk-reading helper, one TS configuration
  function, one scan result for both layers.
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end (keep only what goes into `tests/fixtures/`).
- **Line budget (decision 69):** §11.7 estimates about 820–1,290 new production lines (§10 items 750–1,150, the TS-scan
  contract and protocol cost 50–100, the snapshot cut 20–40). Report the count per item.

## 5. Order (suggested; you decide the briefs, files disjoint)

1. In parallel from the start: (A) the inventory and the ignored compile databases (items 1, 2; A-07, A-08, A-23's
   part); (B) the TS light scan as a module with its own tests (item 3; A-17, A-18, A-19 at the scan level first);
   (C) the v2 file-layer chunks, reasons and the chunk-reading helper (item 7; A-12, A-14); (D) the A-16 fixture on
   the old code (it needs nothing new).
2. Then: (E) wiring the scan into the capture for both layers, errors, caps, the compact snapshot and the v2 body,
   v1 reading (items 4, 5, 6; A-09, A-11 (1), A-13, A-15, A-16, "旧记录"); (F) the old-test assertion changes, the
   A-20/A-22 `detail` assertions, the known-limit texts.
3. **Measure (one subagent, after E):** one observation of this copy's own tree (without `./.dsh-ref`,
   `./.dsh-scratch`, `node_modules`) through the public entry: files, `inventory`, per-language coverage, edge and
   unresolved counts, module count, body and chunk sizes, wall time and peak RSS (`/usr/bin/time -v` or
   `process.memoryUsage` sampling). It is the case 8A refused at 2,196 files.
4. Close-out (one subagent): the checks below.

## 6. Checks (close-out subagent)

- `--maxWorkers=2`: `tests/data/`, `tests/composition/`, `tests/architecture/`, `tests/work-graph/`, every
  `tests/**/S8*.test.ts`, `tests/**/R3d*.test.ts`, every test file that mentions `compare-formal`, `listFiles`,
  `fileGraph`, `project_index`, `cpp_index` or `python_index`, the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox (no bwrap). Name any other failure. Do not run the
  full suite.

## 7. Reply

Under 1,000 words: FILES CHANGED (production / tests, production line count per item); each scope item and row: done
or not, RED → GREEN; the measurement numbers; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task,
time, most at once); anything surprising.

## 8. Answers to the read-through (lead; filled after the read-through)

The read-through (`./.dsh-ref/s8a-scale-preread-final.md`) is accepted with these answers (binding). Where it corrected
a path or a line number, use the code's.

1. **Inventory seam: your option (a).** A separate `listObservationFiles()` on the workspace read access; the strict
   reader and `listFiles` stay as they are.
2. **Git without the root check:** one method on `WorkspaceGitReadAccess` (for example `listProjectFiles`), in
   `git-read.ts`, using the root handle's cwd, `runGitProcess` and `GIT_ENVIRONMENT`, not `openRepository`. It returns
   a result, never throws for the expected cases: `{ kind: 'listed'; paths } | { kind: 'not_repository' } |
   { kind: 'unusable'; reason }` (cancel and capacity stay their own outcomes). The reason literals of §10 item 1 are
   chosen in one place from that result.
3. **Deleted, symlinks, submodules: one git command, then the existing per-path checks.** Each listed path goes through
   the observation read path as today: not on disk (tracked but deleted) → dropped, not a file; a directory (a
   submodule's gitlink) → dropped; a symbolic link → skipped exactly as today. No `-s`, no `--deleted`.
4. **The 60,000 cap:** count NUL-separated records; give `runGitProcess` a large enough `maxStdout` (64 MiB) for this
   call; more than 60,000 records, or output cut at the byte cap, → `capacity` naming the count reached (at least N
   when cut). Use today's enumeration-capacity wording with the count; if there is none, UNSPECIFIED.
5. **Ignored compile databases:** a separate `configSkipped` on the observed source (never a language issue). The
   source digest gains, after today's inputs, the list of ignored databases sorted by path, each as
   `[path, 'config', digest]` or `[path, 'config-skipped', reason]`, so **an observation without ignored databases keeps
   exactly today's digest**. The C/C++ provider receives readable ones in `configOnly` and unreadable ones in `skipped`
   (selection only), as §11.5 says.
6. **The skip list replaces only the observation's own hard skips.** `WORKSPACE_DENIED_PREFIXES` is access control,
   not observation: denied paths stay out on **both** paths (the git path applies the same denial filter, and Host
   authorization still applies at read). In git mode the list is git's (no skip list); the skip list is the fallback,
   and it also filters the ignored compile databases (§11.4).
7. **v2 summary:** a new internal `ObservedSummaryV2 { files; languages: Array<{ language; files }>; changes: { added;
   modified; deleted } }`, counts only, as §10 item 2 lists.
8. **`indexed` and node fields:** every chunk node, every language, carries path, digest, byte size, language,
   `nonBlankLines` and `indexed`. `indexed` = walked by the TS scan for TS/JS (walked `.json` included); = `parsed` for
   C/C++ and Python; false otherwise.
9. **Reasons: your option (b), not (a).** The file layer's unresolved entries become `{ from, specifier, reason }` (the
   type §11.5 defines; providers already produce reasons); the existing exact assertions gain the reasons §11.6 gives
   (A-22's literals; `reason: null` where the spec says null, for example `S8A-formal-comparison.test.ts` ~86). Report
   each changed assertion file with the count. No sibling field.
10. **Previous change counts:** derive the exported set from the previous chunk nodes (`isProjectInputPath(node.path)`
    plus digest); no new field.
11. **Versions:** the module body carries `schemaVersion: 2`; the record's file-graph list (manifest) and every chunk
    carry `schemaVersion: 2`; the observation record's own version is unchanged. Decoders dispatch on those fields;
    absent = v1.
12. **A-16 layout:** `tests/fixtures/s8-observation-v1/` with `ledger.sqlite`, `artifacts.sqlite`, `capture.json`, the
    source tree under `source/`, the one-off generator (`generate.test.ts` run with the old tree's vitest config and
    this copy's `node_modules/.bin/vitest`, your first option) and `README.md` (generating commit 13551ac9, code as
    da633d89, the command used). Exact `.gitignore` negations for the two database files only.
13. **Tests that will break:** your list is right. `S8A-21` (`maxQueryResults: 2`): the observation no longer has a
    query cap; rewrite it on `lightScan.maxRawReferences` if A-18's last case does not already cover it, else delete it
    and name A-18 as the cover. `S8A-AE1-formal-comparison.test.ts` ~156: verify after the scan, change nothing unless
    the spec says so.
14. **Plan:** accepted (S1–S5 at once, then E, F, measure, close-out; stagger vitest). Start S2 first. The time limit
    is now 330 minutes. Section 2 item 0 is a small task of its own at the start (it touches only the C/C++ script, its
    digest and the A-11 test).
