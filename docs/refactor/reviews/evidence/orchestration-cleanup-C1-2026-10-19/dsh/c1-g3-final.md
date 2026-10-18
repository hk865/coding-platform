All four G3 subagents reported; checks run; scratch removed.

## Summary

G3 is complete on base `c1-g4-r1` (`b6dc03f`), all changes inside the whitelist (33 source files: 31 changed + 2 new regional helpers; no tests or allowlists touched). The work: shared activity read/projection helpers for the calendar, track and timeline; the note store-failure mapping; VW-1/XX-8, VW-3, VW-5's view caller exactly per G4's frozen `terminalProposalOf`, VW-7, N1–N7, N9–N11; all G1 B-wiring in G3's files (`rejectedWithNonEmptyCurrent`, `okFalse`, edge/legacy ids, `storeFailureCode`, `sessionRefProblem`, primitives, canonical/parse, event envelopes); decision-35 comment trims in G3's files. Behaviour constraints kept (codes, texts, check order, field presence, list order, read counts, stored bytes); no renames or new error paths. `npm run typecheck` and `npm run check:architecture` pass. The only architecture-test failure is the inherited production-reach table: exactly `sessionStoreFailureToRejection` (G2) and `ownerWrite/ownerReadStoreFailureToRejection` (G5); G3's own inherited symbols are now reached. The 13-file merged focused run passed 193/193. The line target was exceeded (2,809 changed vs 600–1,200); the overrun is mechanical call-site churn, reported below, not new work. Nothing assigned was left unfinished; N8/N12 remain G5's and the withdrawn VW items were left untouched.

## Interface table (G3 regional helpers)

| Module | Export | Signature / return | Source | Consumers |
|---|---|---|---|---|
| `views/activity-read-helpers.ts` | `CapacityError` | class | activity-read-model :144 | activity only |
| | `Budget` | `(cap: number)`, `spend(reads): void` | activity-read-model :153 | all three readers |
| | `scanOrdered` | `(records, request, limit, budget) => AsyncGenerator<EncodedRecord>` | activity :173 | activity (lazy early stop), readOrderedAll |
| | `readOrderedAll` | `(records, request, budget) => Promise<EncodedRecord[]>` | activity :196 | activity, timeline |
| | `readEqualityAll` | `(records, index, values, budget) => Promise<EncodedRecord[]>` | activity :206 | activity, track, timeline |
| | `readOneKeyed` | `(records, refKey, budget) => Promise<EncodedRecord \| undefined>` | activity :229 | activity, track, timeline |
| | `readWatermark` | `(records) => Promise<ReadResult<CommitCursor \| null>>` | activity :242 | activity, track, timeline |
| | `isQuarterInstant` | `(value) => value is string` | activity :254 | activity, track |
| | `activityViewOf` | `(activity, since) => RunActivityViewV1` | activity :941 / track :331 | activity, track |
| | `emptyView` | `(runRef, status, reason, error) => RunActivityViewV1` | activity :961 / track :351 | activity, track |
| | `claimingSessionOf` | `(records, run, budget) => Promise<SessionRef \| null>` | activity :749 / track :362 | activity, track |
| | `gateInfoOf` | `(records, goalRef, round, budget, cache) => Promise<{owners: SessionRef[]; gate: boolean}>` — owners **unsorted**; caller sorts (activity by sessionId, track by canonical key) and track keeps its workspace check | activity :821 / track :733 | activity, track |
| `views/automatic-rework-notices.ts` | `readOrderedToEnd` | `(records, index, values, bound) => Promise<EncodedRecord[]>` | its own :91 | note-review-notices |
| `notes/store-failures.ts` | `MappedReadCode`, `MappedStoreFailure` | types | note-read-model :91/:122 | note-read-model, note-related-scope |
| | `mapStoreFailure` | `(failure) => MappedStoreFailure` (only `revision_conflict`/`invalid`/`not_found`, else `unavailable`) | note-read-model :125 | note-read-model re-export, store-failures |
| | `asOutcome` | `(failure) => {ok:false, code, reason}` via `okFalse` | note-read-model :139 | note-read-model, note-related-scope |
| `notes/note-anchors.ts` | `symbolRangeText` | `(content, start:{line,column}, end:{line,column}) => string` | its own :280 (wrapper kept) | note-anchors, note-views |
| `notes/note-related-scope.ts` | `anchorSlots` | `(head:{anchorKey0..4}) => string[]` (order 0→4, nulls only) | its own :81 | related-scope, note-read-model, note-service, note-views |
| | `matchesPathPrefix` | `(key, prefix) => boolean` (exact or `${base}/`) | its own :86 | related-scope, note-read-model |
| `architecture/graph-index.ts` | `encodeCursor` | `(value: object) => string` — base64url(JSON.stringify) | its own :46 | graph-index, file-graph-index |

## Per-item table

| Item | Status | Where / why |
|---|---|---|
| VW-1 / XX-8 | done | helper module; 3 readers wired; lazy scan, 200-page limits, per-row budget, miss-charged keyed read, page-throw, watermark mapping kept |
| VW-3 | done | projections/claim/gate reads shared; caller sorts and track scope check kept |
| VW-5 (view) | done | `decision-read-model` live branch + superseded set then `terminalProposalOf(...)`, fallback unchanged, no sort |
| VW-7 | done | node-detail/work-line 14-code switches → `storeFailureCode`; wrappers/texts kept; third `coreCode` use in `readHistory` handled |
| N1 | done | note files + note codec + file-graph-index; strict key-count and `>=0`/SHA/cursor checks kept |
| N2 | done | nullable `parseObject` + `canonicalOf` in note codec |
| N3 | done | 3 note encoders + 2 architecture encoders wrap `encodeEventEnvelope` (plus 2 catalog encoders under XX-2); signatures kept |
| N4 | done | all listed note/view files, including `note-review-notices` (A's file) |
| N5 | done | `anchorSlots`/`matchesPathPrefix` exported and wired; rules unchanged |
| N6 | done | `symbolRangeText` extracted; anchors wrapper and views caller wired |
| N7 | done | shared `encodeCursor`; decoders and their errors left separate |
| N9 | done | generic `readOrderedToEnd` exported; note-review calls it; receiver/asc/200/bound/after/throw/next kept |
| N10 | done | `notes/store-failures.ts`; read-model re-exports; related-scope uses it |
| N11 / VW-2 | done | construction tags trimmed, rules/why kept in notes, views, queries, architecture |
| B wiring (XX-1/2/5/6/7, rejection helpers, ids) | done | where implementations were identical |
| N8, N12 | not in G3 | assigned to G5 |
| Withdrawn (VW-6/8/9/11/12 etc.) | not done by design | delta §二/refresh §三 |

## Tests run

| Run | Result |
|---|---|
| `npm run typecheck` | pass (both tsconfigs) |
| `npm run check:architecture` | pass (`next source boundaries: OK`) |
| `npx vitest run --maxWorkers=2 tests/architecture` | 3 files / 52 tests pass; `production-reach.test.ts` 1 fail with **exactly** 3 inherited declarations: `read-result-failures.ts:66 sessionStoreFailureToRejection` (G2), `:110 ownerWriteStoreFailureToRejection` (G5), `:124 ownerReadStoreFailureToRejection` (G5) |
| Coordinator merged focused set: S5-decision-queue, S5-notices, S2B-30-track-bars, S2B-r2-calendar-same-task, S2B-r2-r3-track-pagination, S4C2-U3, S4C2-disposition-core, WP2-context-extensions, A1-architecture-catalog, R3d-observed-architecture, A2-step1-codecs, R5b-query-job, S2C-lines-failure | 13 files / 193 tests pass |
| A (activity/track/timeline/notices) | direct 21 files/126 tests + focused indirect 37 files/183 tests pass |
| B (notes/note codec/note views) | 59 dependent files: 646 passed, 5 skipped, 0 failed |
| C (queries/decision/graph/node/work-line) | 38 direct files/588 tests pass (rerun after concurrent edits); final focused 6 files/149 pass |
| D (architecture) | 20 files/228 tests pass |

Not run here: full suite (lead's bubblewrap run), `S2A-notices-overbound.test.ts` (5,001-entity sweep exceeded 8 min; A reports interrupted), and A/C's broad fixture-mediated indirect sweeps (documented in their reports).

## Cross-group hand-over

| Declaration | Consumer group | State after G3 |
|---|---|---|
| `persistence/read-result-failures.ts:66` `sessionStoreFailureToRejection` | G2 | still unreached (expected) |
| `persistence/read-result-failures.ts:110` `ownerWriteStoreFailureToRejection` | G5 | still unreached (expected) |
| `persistence/read-result-failures.ts:124` `ownerReadStoreFailureToRejection` | G5 | still unreached (expected) |

`rejectedWithNonEmptyCurrent`, `okFalse`, `edgeDeclarationId`, `legacyDeclarationId` and `storeFailureCode` are now reached by G3 consumers and no longer appear. No G3 helper needs another group; no row required a file outside the whitelist. No files left for a later G3 pass.

## Changed lines (base `c1-g4-r1`, `b6dc03f`)

| | Count |
|---|---|
| Tracked files added / deleted | 912 / 1,652 |
| New files (compared with empty): `notes/store-failures.ts` 21, `views/activity-read-helpers.ts` 224 | +245 |
| **Added + deleted** | **2,809** |
| **Net** | **−495** |
| Tests / allowlist changed | 0 (`git diff --stat c1-g4-r1 -- tests` empty) |

The 600–1,200 target is clearly exceeded; the excess is mechanical, not new items: the two query files alone account for 1,007 changed lines because the local `rejected`/`reject` helper was replaced at every call site rather than aliased, and moving the activity helpers adds 224 lines while deleting 610. All assigned G3 items are finished; no padding was added.