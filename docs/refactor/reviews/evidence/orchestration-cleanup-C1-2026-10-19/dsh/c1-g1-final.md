## Summary

C1 **G1** is complete on base `c1-base` (`5e83681`), not split. 23 tracked files + 4 new shared modules changed; no test, assertion or allowlist change; every file is inside `c1-run.md`’s whitelist (`note-record-codecs.ts`, `execution-preparation.ts` and all later-group files untouched).

Created the cross-group modules: contracts primitives + tagged/nullable parsers + codec-invalid, nullable `canonicalOf`, four separate rejection shapes, `edge:`/`legacy:` id builders, `event-envelope`, `event-validation`, and separate store-failure maps (session / execution / K3 owner-write / K3 read / shared pin decoder / VW-7 code normaliser). G1’s own files now use them: **18 event encoders** wired; all named local primitive copies removed; decision/line-settings envelope, inner/outer, actor and common body checks moved; evidence `refKeyOf→canonicalOf` and `reject→rejectedWithCurrent`; material applicability→`rejected`; run-snapshot decoder→`parseObject`. Book-listed look-alikes stayed separate; withdrawn items and PE-4/8/9 behaviour untouched. Comments: construction tags/stage narration removed, rules and “why” kept.

**Checks.** `npm run typecheck` → 161 errors, exactly the c1-base count, none naming a changed file (18 pre-existing `src/core/agent-runtime` + test implicit-any). `npm run check:architecture` → OK. Dependent vitest run (17 files) → **597 passed, 1 failed**; the only failure is production-reach, exactly the 9 later-group declarations below. Three more dependent files cannot load because `node_modules/zod` is absent from `vendor/coding-agent` (`R4c-execution-history-index`, `S2B-r2-activity-run-ended-at`, `R3e-evidence-coverage`; also `S3-role-profiles`, `SP-lookup-index-migration`), reproduced identically at c1-base; the environment also has no bubblewrap.

**Changed lines vs base (including untracked new files):** added **678**, deleted **896** = **1,574**, net **−218**. Above the 600–1,200 target because the whitelist covers 23 files and 18 encoders; no padding.

---

### Interface table (frozen for later groups)

| Module | Export / signature | Return shape | Source | Consumers |
|---|---|---|---|---|
| `contracts/validation/common.ts` | `nonEmpty`, `isSha256Hex`, `isInt`, `isNonNeg`, `isPos`, `hasOnlyKeys`, `utf8Bytes`, `codePoints`, `inList<T>`, `parseObject`, `invalid` | predicates / `UnknownRecord\|null` / `{status:"invalid";reason}` | moved from `tasks/codec-fields.ts`; `parseObject` from codec-fields | G1 done; all groups later |
| same | `parseTaggedObject(json, what): UnknownRecord\|string` | two exact messages | `persistence/record-codecs.ts:100` | G1 record/plan/decision/line done; G3 note |
| `contracts/fingerprint.ts` | `canonicalOf(value): string\|null` | nullable canonical JSON | `tasks/codec-fields.ts:53` | G1 evidence + 3 codecs done; G2/G3/G5 |
| `contracts/core/rejections.ts` | `rejected<C>(code, reason)`; `rejectedWithCurrent<C>(code, reason, current?)`; `rejectedWithNonEmptyCurrent<C>(…)`; `okFalse<C>(code, reason)` | `{status,code,reason[,current?]}`; `{ok:false,code,reason}` | new, separate shapes per book §5 | G1 evidence/applicability; G2–G5 |
| `contracts/input-declaration-id.ts` | `edgeDeclarationId(planRef, edge)`; `legacyDeclarationId(requirementId)` | `edge:<sha>`; `legacy:<id>` | `views/graph-context-reader.ts:905` | G3 graph reader; G4 tasks + assembler |
| `tasks/codec-fields.ts` | all old names re-exported (`isObject`, `nonEmpty`, …, `invalid`, `canonicalOf`) | unchanged signatures | delegates to contracts | existing G5 task codecs |
| `persistence/rework-codecs.ts` | keeps all old exports; `sessionRefProblem` stays | unchanged | delegates primitives/`sameJson` | G3/G5 switch note/UCR/anomaly copies |
| `tasks/codec-shape-checks.ts` | `runRefProblem`, `taskTripleProblem` re-export; `sessionMessageRefProblem` own | unchanged | `rework-codecs` | existing UCR/CRR |
| `persistence/event-envelope.ts` | `encodeEventEnvelope<E>(event)` | `{eventId,eventType,schemaVersion,occurredAt,json:JSON.stringify(event)}` | `project-bootstrap-record-codecs.ts:383` | G1 18 encoders; G2/G5 |
| `persistence/event-validation.ts` | `eventEnvelopeProblem(event,type,version)`, `eventBodyEnvelopeProblem(body,event,type)`, `actorProblem`, `eventBodyProblem(value,envelopeKeys,bodyKeys)` | `string\|null`; `UnknownRecord\|string` | decision/line codecs | G1 decision/line done |
| `persistence/read-result-failures.ts` | `storeFailureCode`; `pinsFromStoreCurrent`; `sessionStoreFailureToRejection`; `executionStoreFailureToRejection`; `ownerWriteStoreFailureToRejection`; `ownerReadStoreFailureToRejection`; existing `atLeastCursorResult`/`storeFailureToRejection` unchanged | `CoreRejection` / code / pins | directory `:125/:144`, entry/history maps, CRR/UCR/receipt maps | G2/G3/G4/G5 |

### Per-item table

| Item | Status | Notes |
|---|---|---|
| XX-1 primitives/refs | done | moved to contracts, old names kept; strict `sessionRefProblem` stays; look-alikes untouched |
| XX-2 / SE-1 event envelope | done for G1 files | module + 18 encoders; G2/G5 codecs switch later |
| XX-5 nullable canonical | done | `canonicalOf` + evidence `refKeyOf`; `fingerprintOf`/`digestOf` still direct |
| XX-6 nullable parse | done | contracts `parseObject`; execution entry/history, run-activity, control, evidence-record, run-snapshot |
| XX-7 / TA-7 failure maps | done (definitions) | four separate maps + pin decoder + code normaliser; consumers are later groups |
| Rejection helpers | done | four shapes; evidence + applicability wired; verification-plan `rejected` kept |
| PE-2 / PE-3 | done | tagged parser + event-validation; line proof/Workspace check stayed in file |
| TA-4 / VW-4 ids | done (construction only) | no G1 consumer, as book requires |
| VW-7 code normaliser | done (definition) | `storeFailureCode`; G3 wires |
| PE-1 comments | done | construction tags/restatements removed; rules/why kept |

### Tests run

- `npx vitest run --maxWorkers=2` over: `tests/architecture` (4 files), `S5-goal-settings`, `S5-notice-settings`, `S5-message-decision`, `control-intent-machine`, `R3a-transaction-boundaries`, `A2-step1-codecs`, `K3-50-codec-shape-checks`, `material-readers`, `R3b-material-applicability`, `R3b-materials-contract`, `R3c-plan-entry`, `R3c-plan-adoption`, `R3a-goal-replay-boundaries` → **16 files passed, 1 failed; 597 tests passed, 1 failed** (production-reach only).
- Cannot load (missing `zod` in `vendor/coding-agent`): `R4c-execution-history-index`, `S2B-r2-activity-run-ended-at`, `R3e-evidence-coverage`, `S3-role-profiles`, `SP-lookup-index-migration`, several composition/helper tests → environmental, same at base.
- `npm run typecheck`: 161 errors = base; `npm run check:architecture`: OK.

### Production-reach failures ↔ hand-over (one-to-one)

| Path#symbol (exact failure line) | Consumer group |
|---|---|
| `contracts/core/rejections.ts:22 rejectedWithNonEmptyCurrent` | G2/G4/G5 |
| `contracts/core/rejections.ts:33 okFalse` | G3/G4/G5 |
| `contracts/input-declaration-id.ts:5 edgeDeclarationId` | G3/G4 |
| `contracts/input-declaration-id.ts:14 legacyDeclarationId` | G3/G4 |
| `persistence/read-result-failures.ts:48 pinsFromStoreCurrent` | G2/G4/G5 |
| `persistence/read-result-failures.ts:66 sessionStoreFailureToRejection` | G2 |
| `persistence/read-result-failures.ts:88 executionStoreFailureToRejection` | G4 |
| `persistence/read-result-failures.ts:110 ownerWriteStoreFailureToRejection` | G5 |
| `persistence/read-result-failures.ts:124 ownerReadStoreFailureToRejection` | G5 |

No other declaration is unreached; these nine are the complete frozen hand-over. No fake calls, no allowlist edits.

### Changed lines (vs `c1-base`)

| File | +/− |
|---|---|
| fingerprints/common | 9/0, 52/0 |
| new: rejections / input-declaration-id / event-envelope / event-validation | 39/0, 16/0, 14/0, 74/0 |
| evidence-service / verification-plan | 45/49, 1/1 |
| materials applicability / record-readers / run-snapshot-decoder | 2/7, 7/11, 4/16 |
| commit-compiler / control / decision / evidence-record | 6/10, 10/48, 25/121, 9/30 |
| execution-entry / execution-history / graph-repository | 12/43, 7/42, 2/2 |
| line-settings / lookup-all / plan-record | 16/93, 3/3, 125/151 |
| read-result-failures / record / rework / run-activity | 97/7, 58/94, 12/29, 20/62 |
| codec-fields / codec-shape-checks | 9/60, 4/17 |
| **Total** | **678 / 896 → 1,574 changed, net −218** |