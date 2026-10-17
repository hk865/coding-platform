# 8A module-body cap measurement (Claude subagent a1167017, 2026-10-17, report in substance)

Setup: `~/dsh-work/measure-8a/repo` = lead e919304b, `dist/` built; target `~/dsh-work/measure-8a/target` = the same tree,
git commit 852bb9f (2,196 TS/JS/JSON files counted by the capture). Mappings: root `.` + the 6 `src/*` modules; config
`tsconfig.json`. Script `measure-8a.mjs` uses only `createTargetPlatform` → `projects` → `architecture.captureSourceChanges`
/ `listFiles`; sizes from a read-only JSON.stringify observer; outputs `out/<label>.json`, `out/summary.tsv`.

## Full target
- `rejected / capacity` ("the observed architecture body exceeds the artifact capacity"), 17.7 s, peak RSS 1.3 GB.
- Body 555,020 B = 2.1 × 262,144 for 2,196 files. No file-layer chunk written (size check before chunking).
- Second cap already hit: the capture's TS analysis stops at 10,000 import relations; this tree has ≈ 12,100 (src 4,378,
  tests 7,715). The overflow is tolerated as `failed` → module layer empty (`indexedSources` 0, `complete: false`); the
  555 KB is `files` (409 KB) + `changes.added` (144 KB).
- Probe build `repo/dist-probe` (4 lines marked `MEASURE-8A PROBE`: 256 KiB cap, 240 KiB snapshot cap, 10,000 cap
  raised; chunk size 256 KiB): commits; body 921,268 B (`files` 409 K, `added` 144 K, `indexedSources` 143 K,
  `coverage.unresolved` 109 K, `architecture.unresolved` 109 K — the same strings again); the module snapshot alone
  258,381 B (over its 240 KiB cap); file layer 4,097 nodes in 6 chunks (~1.5 MB of 64 allowed); 40.8 s, 2.1 GB.

## Growth
Per file: `files` path + ~122 B; `changes.added` path + 3; `indexedSources` path + 87; each unresolved import (~80 B)
twice (`summary.coverage.unresolved`, `architecture.unresolved`); each unmapped file once more ("unmapped source: P").
Clean TS project: 3 × path + 210 B per file, + ~160 B per unresolved import. Exact boundary (synthetic, 20-byte paths,
no imports): 962 files commit at 262,051 B, 963 refused at 262,321 B (270 B/file). Fits ≈ 261,000 / (3 × path + 210):
path 20 → 962, 30 → 870, 40 → 790, 60 → 670. This repo: average path 40 (src+tests), 62 overall.
Subsets: src only 424 files 157,696 B commits; src + 110 tests 534 files 284,644 refused; +140 tests 564 → 313,167
refused; + half the tests 733 → 417,567 refused (test files bring unresolved `vitest`, `node:*` imports, listed twice).
`mappings: []`: body = `files` + `added` + `coverage.unresolved` (98,568 B for 424 files).

## Code (src/)
- Body assembled `core/work-graph/architecture/architecture-service.ts:752-761`; per-file lists `core/workspace/capture.ts:576`
  (`files`), `:599` (`coverage.unresolved`), `core/workspace/architecture-source.ts:73,51,58` (`indexedSources`, `unresolved`).
- 256 KiB check / `capacity`: `architecture-service.ts:766`; constant `contracts/artifact.ts:7`; store re-check
  `core/record-store/body-codec.ts:241`.
- Snapshot 240 KiB cap `contracts/architecture-source.ts:69-70`, throws `core/workspace/architecture-source.ts:75`,
  → `capacity` `capture.ts:245`, returned `architecture-service.ts:326,749`.
- 10,000 import cap `core/workspace/workspace-tools.ts:10`, used `capture.ts:563`, tolerated 564-572 (overflow raised
  `typescript-source-query.ts:187`); module layer emptied `architecture-service.ts:745`; file layer reuses the failure
  `capture.ts:308-319`; further export checks `capture.ts:205,236`.
- 64-chunk cap `architecture-service.ts:777`.
- Readers of the body's file lists: grant check over `body.files` (`architecture-service.ts:522`); the `previous`
  change set (718, 755); the decoder's membership check (`architecture-record-codecs.ts:369-411`). Module queries,
  compare, impact read only nodes/edges; the formal comparison reads the file layer.

## Fix approaches
- **A (recommended):** the module body stops listing files; the chunked file layer carries them. Stored file-graph
  nodes gain digest and size (and an "indexed" flag), stripped by `listFiles` (A-01 literals unchanged); body v2 keeps
  capture, summary (counts instead of path lists), mappings, module nodes and edges; unresolved lists move into chunks,
  one copy; the grant check and `previous` read the chunks; the decoder keeps a v1 branch. Same change: the observation
  analysis gets its own cap instead of the 10,000 page cap (`capture.ts:563/205/236`), else this repo still gets an empty
  module layer. ≈ 200–250 production lines; ≈ 5 test files touched (`R3d-record-integrity`, `S8A-file-layer`,
  `S8A-root-path`, codec tests) + 2 rows (a capture of > 2,000 files commits; a v1 body still reads and works as
  `previous`). A-01..A-05 unchanged; §9 item 4 gains a second legacy shape; L12 "模块级的不变" needs the lead.
  Chunk budget at L12 maxima (20,000 nodes, 100,000 edges, this repo's path lengths) ≈ 17 node + ≈ 40 edge chunks ≈ 57 of
  64 — tight; 8D's edges count against the same 100,000.
- **B:** split the unchanged body into ≤ 256 KiB parts listed in the record; 80–120 lines; needs the 240 KiB snapshot cap
  and the 10,000 cap raised; duplicates stay (20,000 files ≈ 8 MB ≈ 32 parts re-read on every module query). Scales worst.
- **C:** dedup only (drop `changes.added` without a previous capture, drop digests from `indexedSources`, one copy of
  unresolved); 40–60 lines; ≈ 1,250 files at path 40; this repo still over.
- Side notes (not measured): the observation inventory does not skip `node_modules`
  (`core/workspace/project-source-snapshot.ts:64`); `fileGraph.unresolved` is stored in the record with no cap
  (`architecture-service.ts:787`).
