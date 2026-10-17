**Production (this rework vs `s8a-scale`; shared-file split per driving item, total exact):**

| item | net | +/− |
|---|---|---|
| 1 strict capture | +21 | +30/−9 |
| 2 module sources | +2 | +3/−1 |
| 3 TS scan | +17 | +101/−84 |
| 4 chunk contract | +24 | +29/−5 |
| 5 git | +37 | +57/−20 |
| 6 decision 79 | −307 | +105/−412 |
| 7 rows | 0 | tests only |
| 8 second copies | +11 | +110/−99 |

Total **+435/−630, net −195**. Segment against `s8d-rw3`: **+1,754/−593, net +1,161** (was +1,703/−347 = +1,356). §11.7's 820–1,290: now 129 under the top; the earlier +413 overage is gone. One-line glue I made after a check: restored the strict-path relation-cap in `capture.ts` (~270, same as `s8d-rw3`, no new test). Also restored `mapArchitectureSource`'s `indexedSources` in strict mode.

**RED → GREEN**

1. **A-25:** RED export `ready` at `maxQueryResults=1` and 500+summary/501 cut → GREEN `capacity`; 501 full unresolved lines, no summary, `indexedSources` 501. Strict test assertions back to `s8d-rw3` values.
2. **S8E-file-fault-module-layer:** RED both backends `[]` → GREEN `module:M`; TS coverage `{files:1,parsed:0,edges:'supported',issues:[{main.ts,failed,RangeError: injected}],complete:false}`.
3. **A-27:** noResolve RED no edge → GREEN `a→b`, `./c` unresolved, `c.ts` skipped; cancel RED hook reached `z.ts` → GREEN stops before it; type line RED 2 → GREEN 1. **A-17/18/19** rewritten through the public fixture: A-17 2/2 (10 edges, one `esm/m.ts → ./a`), A-18 8/8, A-19 16/16, memory+SQLite.
4. **A-28:** empty `import ""` RED pages damaged → GREEN committed/ready with `specifier:''`; 4096 accepted/4097 rejected; 5000-char capture RED committed → GREEN `invalid`; `chunkBytes:10` RED committed → GREEN `capacity`. **A-12** chunk 240 B (162-byte node + 57-byte envelope; two don't fit), hand-computed 65 chunks >64.
5. **A-26:** corrupt `.git/config` RED `不是 git 仓库` → GREEN `git 不能用：退出码 128：fatal: bad config line …`; corrupt index likewise; real non-repo unchanged; formatter `(at least 17)` vs `(reached 60001)`, no fabricated 60,001.
6. **S8E-old-format-rejection:** v1 body / `files` body / v1 chunk / path-shaped edges / record missing `fileGraph`,`languages`,`inventory` all rejected. A-16 test, `tests/fixtures/s8-observation-v1/`, v1/v2 codecs and loaders, `notCaptured`, legacy prefix, missing-field defaults, and the `.gitignore`/`tsconfig.json`/`vitest.config.ts` entries deleted; grep for the removed symbols = 0.
7. **A-09** 2/2 per backend (1,500 long paths; 10,010 refs non-empty module) and **A-23 binary** both backends, literals unchanged.
8. Store `normalizeFileGraph` now only builds the path-sorted node table and maps edges to indices; capture-normalized unresolved passes through. Compaction happens once in the observation mapper before validation; `compactArchitectureSnapshot`+regex gone. Read-count test RED 2 opens/2 reads → GREEN 1/1 for `listFiles` and `queryArchitecture`; per-language issue/path lookup built once.

**Measurement** (real tree, public `captureSourceChanges`, denies `.dsh-ref`/`.dsh-scratch`/`node_modules`): inventory git, 4,348 listed (50 denied + 11 tracked-deleted filtered → 4,287 eligible) → 4,202 nodes, 85 skipped; TS 1,409 files/1,162 parsed/supported; Python 22/22; other 2,856; edges 10,759; unresolved 1,600; module 1 (`module:Repo`); body 40,480 B; 6 chunks, 1,236,276 B (largest 262,061 B, 83 B under cap); wall 26.72 s; peak RSS 676,040 KB; listFiles 22 pages. Previous shape: 4,290→4,203/87, TS 1,406/1,156, edges 10,732, unresolved 1,589, body 40,470, chunks 1,235,115 (largest 262,025), 26.8 s, 754,256 KB. Deltas match the rework's test/fixture file count and RSS measurement; no behavioural regression.

**Fact-grep** (100 hits/35 changed+new test files; every line listed in the close-out): real temp source/config writes and context signals (`S8A-file-layer` 11–474; `S8E-A25` 10,41,69; `S8A-file-graph` 2–262; fixture 18,135,181,297; `S8E-A26` 11,32,53); pure codec inputs/old-shape rejection (`S8D-observed-v2-codecs` 106–309; `S8E-old-format-rejection` 54–65; `S8D-coverage-notes` 42); fault injection only (`S8D-A11` 6–43 garbage wrapper; `S8D-A18` 2–48, `S8E-A11` 3–65, `S8E-file-fault-module-layer` 4–23, `S8E-A27` 24–83, fixture 47 `lightScan.fault`; `S8D-A22` 197 interpreter wrapper); workspace configs (`S8D-A22` 49–392 compile DBs; `S8D-cpp-import-graph-script` 50 parser input; `S8D-observation-inventory` 255–291 size-cap files). False positives: “default” contains “fault” (`S8A-formal-comparison` 30, `S8D-A19` 4,138, `S8D-A22` 11). No platform fact hand-written on a normal path; nothing flagged.

**Checks** (`--maxWorkers=2`): data 54 files/**446 pass**; architecture 4/**53 pass** (production reach included); work-graph 230/**2,615 pass, 8 fail, 5 skip**; composition 41/**130 pass, 21 fail**; S8*/R3d outside those dirs 1 file/3 pass; changed tests 33 files/**252 pass**. All 29 failures are `DSH-BASELINE` (no bwrap); one listed baseline now passes. `typecheck` 0 (24.3 s), `check:architecture` 0 (1.8 s), `build` 0 (15.6 s).

**UNSPECIFIED (smallest choices):** (1) `mapArchitectureSource` mode has a default of `'observation'`; all production call sites pass it explicitly (making it required would touch 5 pure test call sites). (2) A >4096-char specifier rejects the capture as `invalid` (same 4096 limit on write/read; the book names the limit, not the outcome). (3) Item-overflow capacity text `the file graph cannot fit one item in a <n>-byte chunk`. (4) A-18's 300-edge literal is asserted on the module layer because `listFiles` pages return only edges with both endpoints on that page; the scan is still the same one used by both layers. (5) The per-item split of shared service/codec lines is attributed to the driving item; only the total is exact.