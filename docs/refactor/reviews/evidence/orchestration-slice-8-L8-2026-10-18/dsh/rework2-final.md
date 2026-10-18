All rows are complete, all subagents reported, and the final tree is green. Reply follows.

---

**A–G — done; BLOCKED: none.**

**A (`K1-01`–`K1-10`).** RED: in a scratch copy of `s8l8-r1`, identical-content workspaces failed `the stored chunk origin is not this workspace platform observation` and project B/main `listFiles` was rejected. GREEN: `S8D-observed-v2-codecs` 17/17, `S8E-old-format-rejection` 1/1, `S8E-A12` 4/4 (caps 297/294, exact `needs 65 chunks; the limit is 64`), `S8E-A28` 6/6, `S8A-file-layer` 14/14, new `S8A-L8-chunk-scope` 8/8 (4 rows × memory/SQLite: identical two-workspace capture + adoption/revision + both prepares, same `workspaceId` in two projects, later-capture reuse, empty graph). Pure rows: old unscoped rejected, body-scope mismatch rejected, escaped/non-ASCII ids round-trip, one error each.

**B (`K2-01`–`K2-03`, `P05`–`P09`, `S12`).** RED: capture-start 10/18 failed with the request still `requested`; P05 `committed` vs `cancelled`; P06 a Held Host close wrote `failed` revision 2; P07/P08 `ready`; P09 `committed`. GREEN: `capture-start` 18/18, `observation-state` 44/44 (22 new rows), `http-watermark` 2/2. Every L8 owner method checks the caller signal after each await, before a commit starts, and before ready/replayed; this call's completed commit keeps its result, an early replay returns cancelled.

**C (`K3-01`–`K3-11`).** RED: both cancellation rows returned `ready` instead of cancelled (memory+SQLite, 4/4). GREEN: `reminders-public` 22/22, `read-counts` 2/2. Fault wrappers are A2 around the real reader; non-cancel throw/reject gives one `架构提醒不可用` and a ready preparation; cancelled-before-put writes 0 prepared manifests.

**D (`K4-01`–`K4-24`).** Real `onArchitectureCaptureTrigger` in the gate; fake registrations replaced by real adoption/revision; `pointerOf`/`chunkCountOf` deleted; reminders use `runtime.prepareExecution` + `materials.openArtifact` (H4); duplicate mappings row at :281 deleted (`K4-12/13`). Numbers below.

**E (`K5-01`, `K5-02`).** New SQLite-only `S8A-L8-host-close-restart` 2/2: A3 `vi.spyOn(createObservedArchitecture)` gate on the real `workspace.captureObservation`; A running + B queued; real `host.close()` (A's original signal aborted); new Host on the same SQLite DB retries both with seq2/`startup_retry`; no `lightScan` fault, no `driver.close`/`retryPending`. Driver gate rows kept on both backends.

**F (`T15`–`T32`, `T70`, `T71`).** T15/T28 via H4; T16–T24 gates/completion/`maxActive=1`; T19 real Host startup boundary; T25–T27/T30–T32 in `S8A-L8-reminders-pure` 27/27; T29 in observation; T70/T71 allowlist entries removed; `state-writes` 19/19.

**G (`P11`–`P16`, `S01`–`S08`).** P11 Host close starts auto-capture stop/abort first; P12 driver key is canonical `JSON.stringify([projectId,workspaceId])` (`host.ts:183` untouched); P13/P14 shared production constants; P15 unused import deleted; P16 HTTP DTO omits `requestSeq` and the runtime parse rejects it (tested through the real route); S01/S02 comments, S03 dependency declaration, S04 comment, S05 system actor, S06–S08 scope fixed before await.

**Chunk format.** Closed v2 shape `{schemaVersion:2,projectId,workspaceId,nodes,edges,unresolved}`; node/edge/unresolved/empty chunks all carry the scope; the envelope is built from escaped scope values and a fixed structure, never by searching JSON. Old unscoped chunks are rejected; writer and decoder check body scope; the reader requires full origin match and keeps the store's returned ref. Empty envelope for `s8a-l8-observation/main` is exactly **111 bytes**:
`{"schemaVersion":2,"projectId":"s8a-l8-observation","workspaceId":"main","nodes":[],"edges":[],"unresolved":[]}`.
Limits: 256 KiB/chunk, 64 chunks, empty chunk counts; A12 caps 297/294; L8 500-byte case 6/7 chunks.

**Read counts.** One public `runtime.prepareExecution`: **12 = 5 record + 7 body** at 6 chunks (no previous); **21 = 6 record + 15 body** at 7+6 chunks (with previous); both memory and SQLite; the post-prepare material read is excluded. The catalog window's two record reads are `ArchitectureCatalog` + `ArchitectureBaselineRevision`.

**Production lines.** **+286 / −106** across 14 `src/` files (net +180): `architecture-service.ts` +75/−26, `auto-capture-driver.ts` +54/−31, `architecture-record-codecs.ts` +32/−21, `execution-preparation.ts` +32/−2, `context-assembler.ts` +16/−1.

**D1/D3.** Required `slice-base WORKTREE`: 15 REMOVED assertions, all row A re-spellings with the new scope argument (same assertion present and green):
`S8D:87 K1-01`; `S8D:111 K1-06`; `S8D:112 K1-06`; `S8D:113 K1-06`; `S8D:114 K1-06`; `S8D:117 K1-06`; `S8D:122 K1-06`; `S8D:130 K1-06`; `S8D:132 K1-06`; `S8D:133 K1-06`; `S8D:134 K1-06`; `S8D:135 K1-06`; `S8D:140 K1-06`; `S8E-old:54 K1-06`; `S8E-old:64 K1-06`.
D3: 1 `*-pure.test.ts`, **0 hits**.
Supplemental `s8l8-r1 WORKTREE` (slice-base cannot see files created after it): gate 224 `K4-02`; gate 309–348 `T19`; mappings 281–300 `K4-12/13`; observation 319–336/443/557 `K4-14–16`, 496/510 `K4-07–09`, 575–634 `K4-17–23`; reminders-public 333–554 `K4-24/T15/T28`; deleted `S8A-L8-reminders.test.ts` (14 tests/29 expects) `T27`.

**Checks** (one vitest command at a time, `--maxWorkers=2`; 19 changed/new files): codecs 17, old-format 1, A12 4, A28 6, file-layer 14, observation 44, reminders-public 22, read-counts 2, reminders-pure 27, chunk-scope 8, gate 7, host 11, capture-start 18, http-watermark 2, host-close-restart 2, host-restart 2, adoption 2, mappings 8, state-writes 19 = **216 passed**. PASS 6/6 failed only for `AssertionError: ENOENT: no such file or directory, access '/usr/bin/bwrap': expected 'rejected' to be 'ready'` (not skipped). Architecture boundaries+production-reach **33/33**; `typecheck` exit 0; `check:architecture` exit 0; `build` exit 0. No `.dsh-scratch/` exists.

**FOUND.** `S8A-L8-host-restart.test.ts` still uses fixed-duration loops to prove a non-event (F9); it is not in the frozen table, so unchanged. `host.ts:183` NUL scope key remains per ruling 7. D1 from slice-base cannot see deletions inside files created after slice-base (hence the supplemental run). `read-counts` counts the catalog+baseline window as B§4's "catalog twice".

**UNSPECIFIED.** (1) Start-read failure reason wording is implementation-chosen; tests fix `code:'unavailable'` plus the injected cause. (2) T19 is SQLite-only (Host restart needs persistence); smallest option: accept, or add a memory driver row with an awaited `driver.close()` barrier. (3) The post-close pending read uses a real `createTargetPlatform` + public `observationState` on the same SQLite DB (the closed Host has no route). (4) S03 keeps `materials` optional for direct assembler callers with an explicit throw otherwise; smallest option: accept, or make it required.