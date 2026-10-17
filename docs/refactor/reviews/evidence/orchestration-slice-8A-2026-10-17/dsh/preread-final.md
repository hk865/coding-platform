I have enough to report. (No files changed; no scratch created.)

---

## 1. Unclear (would need guessing)

- **Where the file-level graph is stored.** Spec §0.3 L12 says the file graph sits in a chunked artifact separate from the module graph, but `ArchitectureSourceSnapshotV1` / `ObservedArchitecture` has no artifact slot and `memory`/`sqlite` record bodies are the only store. Options: (a) add optional `files`/`chunks` fields to the observed body; (b) a new record keyed to the `ObservedArchitectureRef`; (c) a store-side artifact API. No ruling.
- **Whether `LanguageCoverageV1` is on the observation record or returned by capture.** Spec says the observation record gains `languages`, but it is also a capture result. Options: record only / result only / both.
- **`. ` vs empty string in the ownership function.** `pathOwnershipOf` already skips `stripped.length === 0 || stripped === '.'`. Adding `.` = length 0 must not accidentally admit `''`. The book does not say whether `''` stays non-matching.
- **Fix-site for routes.** `architecture/query` is a plain route. Spec doesn't say whether `compare/compare-formal/impact` are plain or graph_write; the service methods are reads, so plain is likely but unstated.
- **`at` semantics for catalog versions.** The bound `since` cursor is opaque; the real time can only come from `eventAt(cursor).event.occurredAt`. Spec post-note ① doesn't say this. It also means up to 50 `eventAt` calls per page.
- **`capture.ts:207` vs `:210` for the no-TS fix.** The book names `:207`; the reject is at `:210` (`architectureSource`). `:207` is inside `verify`. The snapshot throws are `project-source-snapshot.ts:68` (binary) and `:66` (read), not the sole `:48/70`.

## 2. Spec / book / facts vs code

- `work-graph/views/graph-index.ts` does not exist; the file is **`src/core/work-graph/architecture/graph-index.ts`** (the facts' `V/graph-index.ts` is wrong; the pre-read listing repeats it).
- The unified `pathOwnershipOf` **does exist** at `notes/note-path-ownership.ts:22` with three callers (`scribe-scope.ts:96`, `goal-conflicts.ts:478`, `node-detail-reader.ts:752`, `graph-context-reader.ts:234`). The facts' "尚未在本树出现" is stale; the book accounts for it.
- `ArchitectureCatalogRef` is still defined **once** in `architecture/catalog-contracts.ts:68`; `src/contracts/architecture-catalog.ts` has only the four DTOs — matches the book's item 1.
- `note-version-lists.ts:141` still returns `at:null, reason:null` + `CATALOG_REASON_LABEL` (line 26).
- `GraphWrite`/`Plain` route unions end at `'architecture/versions'`; no `compare`/`compare-formal`/`impact` anywhere (`core-routes.ts:346-349,462`; `core-http-types.ts:149-152,272`).
- Item 9 is bigger than the book implies: `ARCHITECTURE_CATALOG_RECORD_SCHEMA` (`catalog-record-codecs.ts:509`) has **no `commitCursorFields`**, `ArchitectureCatalogRecord` has **no `since`** (`catalog-contracts.ts:69`), and `validateArchitectureCatalog` uses `exactKeys(..., ['ref','revision','baselineRef','schemaVersion','catalog'])` (`:400`). A `since:null` row fails validation until all three change. `record-codec.ts:705` reads `commitCursorFields` from the registry.

## 3. Tests expected to break beyond item 10

- `tests/data/project-source-snapshot.test.ts:79` (`rejects binary_source/read_failure`) — fails if the per-file skip replaces the throw. Facts §4 flags this; item 10 does not name it. Likely must be extended/replaced, but that is an item‑10 gap.
- `tests/data/workspace-capture-architecture.test.ts:111` — already named; the concrete reason is that this graph has **no file nodes now**, so "add file nodes" changes `graph.nodes`.
- `tests/work-graph/R3d-record-integrity.test.ts:86` — it rebuilds and re-encodes `ObservedArchitectureBody`; if `mapArchitectureSource` gains `files`/`languages`, `decodeObservedArchitectureBody` rejects the body. Facts say "extend"; item 10 doesn't name it.
- `tests/work-graph/S4B-note-hints.test.ts:69` — the item-10 "flip" is real: fixture R already has `paths:['.']` (`tests/helpers/S4A-note-fixture.ts:179`, `S4A-note-scope-fixture.ts:165`, `S4B-note-multi-scope-fixture.ts:134`), so the current test asserts the old rule.
- Risky, not confirmed: `tests/work-graph/S4C-scribe-ownership.test.ts` and any test that resolves ownership through `graph-context-reader`/`node-detail-reader` once `.` becomes an owner (or once `graph-context-reader.ts:217,250,253` normalizes differently).
- Architecture-source validator (`src/contracts/architecture-source.ts:34`): the single `path` closure serves config, mapping, and node paths, so allowing `.` for mappings risks also admitting it for `configPath`/nodes (spec forbids that). No named test, but likely one to add.

## 4. Plan (3 subagents max, disjoint files)

- **S0 (shared, alone, 25 min):** `src/contracts/architecture-source.ts`, `architecture-inspection.ts`, `architecture-catalog.ts` (new `ArchitectureCatalogPinV1`), `notes/note-path-ownership.ts` + its `pathOwnershipOf` unit test. No one else starts until S0 lands.
- **S1 workspace (45 min):** `src/core/workspace/project-source-snapshot.ts`, `capture.ts`, `ports.ts`, new provider file; item 2–3 + item 8's file layer. Owns `tests/data/project-source-snapshot.test.ts`.
- **S2 work-graph (60 min):** `architecture/*` storage/codecs/service, `graph-index.ts`, items 2 (storage), 4, 5, 6 callers.
- **S3 catalog + old tests (35 min):** `notes/note-version-lists.ts` + item 9 codec/`since` changes + item 10 flips.
- **S4 routes + item 8 wiring (25 min)**, then **S5 AE1 e2e (35 min)**, then **close-out (20 min)**.

Total ≈ 245 min, so 200 is tight. I would leave at the end, in order: the automatic-capture triggers/retry part of item 8 and the AE1 rows that need them (A-04 auto), keeping only the manual no-catalog file-layer capture.