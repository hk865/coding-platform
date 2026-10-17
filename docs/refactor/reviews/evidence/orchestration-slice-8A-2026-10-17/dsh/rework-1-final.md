All subagents have reported and stopped; the close-out found no integration breaks. Final reply:

## FILES CHANGED

**Production: 15 files, +381/−230 (net +151), all modifications.**
`workspace/project-source-snapshot.ts` (+74), `workspace/capture.ts` (+60/−39), `workspace/architecture-language-provider.ts` (+6/−3), `workspace/ports.ts` (+7), `workspace/workspace-tools.ts` (+1); `architecture/architecture-service.ts` (+88/−39), `architecture/architecture-record-codecs.ts` (+30/−10), `architecture/catalog-service.ts` (+4/−1), `architecture/formal-comparison.ts` (+48/−98), `architecture/architecture-delta.ts` (+22/−7); `contracts/architecture-inspection.ts` (+2), `contracts/path-ownership.ts` (+11/−6); `notes/note-related-scope.ts` (+8/−4), `views/graph-context-reader.ts` (+9/−19); `composition/create-platform.ts` (+9/−2). **Tests: 16 files, +706/−125.** No new production files this run.

## ITEMS (RED → GREEN)

- **1–2:** tolerant one-pass `captureObservationSource`/`projectSnapshotOf`; registry `captureObservation` (strict `capture()` kept); tolerant `verify`; file graph from the frozen `observed` material (no worktree re-read); provider gets `requestedConfigPath`; `parsed` counts TS only. RED `S8A-08…13` in `tests/data/S8A-file-graph.test.ts` (skips; `good.ts`+NUL `bad.ts`; `.py` edit frozen+`source_stale`; alias; `parsed≤files`; strict capture → `unsupported`) → 6 green.
- **3:** intra-module edges never findings; unowned/tied outgoing edges, own skipped/failed issues, truncated non-`other` issues → `unknown`; `other` files never (new `S8A-18`, a doc tie stays `proven`). RED `S8A-08/09–14/18` → green; A-02/A-02b/A-05 arrays exact.
- **4:** `compareFormalObserved` now scope `forbidden`, pin-linkage `invalid`, exported `readRevisionByRef` (`not_found`), digest mismatch `invalid`. S8A-07 re-seeded through public `adoptInitialArchitecture`; S8A-07b (foreign project, wrong digest, broken linkage, missing baseline) RED→GREEN.
- **5:** `pathOwnershipOf` returns the winning prefix; both private matchers deleted, the `.` filters dropped; root-only search returns the root, two roots both return. `S8A-16/17`, `S4C-note-path-ownership`, `S8A-path-ownership-dedupe`, `S4C-related-scope` F-02 RED→GREEN.
- **6:** `decodeObservedArchitectureBody(json, 'longest'|'legacy_any_prefix')`; `loadObservation` picks legacy iff no `fileGraph`. Pre-8A `A=src,B=src/b` body reads and works as `previous` (work-graph `S8A-08`) RED→GREEN.
- **7:** `languages` on the three file-graph pages; `notCaptured` gets `[]`; cursor check before the old-observation branch (A-01a/A-01g).
- **8:** `mappings: []` accepted; empty module layer; TS-project test `S8A-06b` RED→GREEN.
- **9:** platform `fileGraph` caps option → `capacity` through `platform.architecture`; AE1 on memory+SQLite (obs 3/3, formal 2/2 each); one successful `compare-formal` route request with the exact A-02b pair; A-01a/A-01h assert languages/chunks only through `listFiles`; chunk packer made linear; catalog time asserted with a bounded wall clock (no DB read).
- **10:** one `stronglyConnectedCycles` in `architecture-delta.ts`, called by `formal-comparison.ts` (`S8A-15`).

## CHECKS (`--maxWorkers=2`)

`tests/data/` 152 · `tests/architecture/` 53 · all S8A 60 · S4B/S4C 408 (4 skip) · SP/S3/S2C/R3d 179 (1 skip) · conflict+catalog 47 · platform+routes 51 with **2 pre-existing** DSH-baseline failures (`A2-requeue-route`: `check_failed` vs `verification_running`; `A2-reverify-route`: `waiting` vs `stopped`). `npm run typecheck` exit 0 · `npm run check:architecture` exit 0, no new line · `npm run build` exit 0. Production-reach allowlist unchanged.

## UNSPECIFIED

- **`not_captured` at the platform entry** (ruling 8) is not asserted: new captures always write `fileGraph`, and there is no public seam to create a pre-8A record without a private store injection or a direct DB/artifact write. Kept the service-level A-01g proof; smallest option is a platform legacy-record injection seam. Capacity **is** asserted at the platform.
- Observation digest also covers engine+identity (superset of the verifier's `[path,digest]`+skip list).
- Chunk-size injection is on `ObservedArchitectureDependencies.fileGraph.chunkBytes`, not the platform `fileGraph` option (that carries only `maxNodes`/`maxEdges`).
- Legacy membership: a `.`-mapping matches nothing (the old writer predates `.`); a zero-node graph still emits one empty node chunk.
- Test ids `S8A-08…` are reused across `tests/data/` and `tests/work-graph/`; names are file-scoped.

## SUBAGENTS

8 total (7 work + close-out); **most at once = 3**: wave 1 `W1`+`WG1`+`C1`, wave 2 `WG1`-fix+`SVC1`+`IT9`, then close-out.