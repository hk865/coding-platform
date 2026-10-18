# C1 G1: frozen interfaces (lead, 2026-10-18)

G1 is frozen at tag `c1-g1` (DSH run `c1-g1-1018` plus the lead's comment fixes). Its change kept behaviour byte-identical (Codex review: 0 behaviour differences, all 18 event encoders identical). **No later group changes anything in this file's modules** (book rule 2); if a row needs a different shape, skip the row and report it.

Line numbers are at `c1-g1`. "Source" is where the shared implementation came from at `c1-base`; switch a caller only when its local copy is the same implementation (book §5 lists the look-alikes that stay separate). Imports through an old name that still exists (for example `tasks/codec-fields.ts`) are fine; do not change an import only to point at the new path.

## 1. Field primitives — `src/contracts/validation/common.ts`

| Line | Signature | Meaning | Source |
| --- | --- | --- | --- |
| 11 | `isRecord(value: unknown): value is UnknownRecord` | object, not null, not an array (unchanged) | existing |
| 14 | `nonEmpty(value: unknown): value is string` | string with length > 0; no trim | `tasks/codec-fields.ts` and the local copies in G1's codecs |
| 18 | `isSha256Hex(value: unknown): value is string` | `/^[0-9a-f]{64}$/` | same |
| 21 | `isInt(value: unknown): value is number` | `Number.isSafeInteger` | same |
| 24 | `isNonNeg(value: unknown): value is number` | safe integer ≥ 0 | same |
| 27 | `isPos(value: unknown): value is number` | safe integer ≥ 1 | same |
| 30 | `hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean` | no key outside `allowed`; does **not** require any key | same |
| 33 | `utf8Bytes(value: string): number` | UTF-8 byte count | same |
| 36 | `codePoints(value: string): number` | code point count (never swap with `utf8Bytes`) | same |
| 39 | `inList<T extends string>(value: unknown, allowed: readonly T[]): value is T` | string in the list | same |
| 42 | `parseObject(json: string): UnknownRecord \| null` | `null` for bad JSON, an array, `null` or a scalar | `tasks/codec-fields.ts` |
| 51 | `parseTaggedObject(json: string, what: string): UnknownRecord \| string` | the two exact texts `${what} is not valid JSON`, `${what} JSON must be an object` | `persistence/record-codecs.ts:100` |
| 63 | `invalid(reason: string): { status: "invalid"; reason: string }` | a codec validation result, not a Core rejection | same |

Integer, non-negative and positive stay three checks; a checker with a `minimum` parameter (`persistence/evidence-record-codecs.ts:136`) is a different function.

## 2. Canonical JSON — `src/contracts/fingerprint.ts`

| Line | Signature | Meaning | Source |
| --- | --- | --- | --- |
| 60 | `canonicalOf(value: unknown): string \| null` | `canonicalJson(value)`, or `null` when it throws | `tasks/codec-fields.ts:53`, evidence `refKeyOf` |

A SHA or digest wrapper that throws on a non-JSON value (evidence `fingerprintOf`, `digestOf`) does not use it.

## 3. Rejection shapes — `src/contracts/core/rejections.ts`

All keep the key order shown. Callers keep their own narrow code types.

| Line | Signature | Returns | Source |
| --- | --- | --- | --- |
| 5 | `rejected<C extends CoreError>(code: C, reason: string)` | `{ status: "rejected", code, reason }` | the per-file `reject` / `invalid` / `forbidden` … helpers without `current` |
| 13 | `rejectedWithCurrent<C extends CoreError>(code: C, reason: string, current?: VersionPin[])` | adds `current` whenever it was passed, **an empty array included** | `evidence/evidence-service.ts` `reject` (`c1-base` :136–138) |
| 22 | `rejectedWithNonEmptyCurrent<C extends CoreError>(code: C, reason: string, current?: VersionPin[])` | adds `current` only when it has at least one pin | `queries/query-execution.ts:83` |
| 33 | `okFalse<C extends CoreError>(code: C, reason: string)` | `{ ok: false, code, reason }` | `views/note-views.ts:82` and the like |

Not merged: `evidence/verification-plan.ts` `rejected` (`{ status, code, issues }`, its own codes); wrappers with fixed business texts or fields; codec `{ status: "invalid", reason }` (that is `invalid` above).

## 4. Input declaration ids — `src/contracts/input-declaration-id.ts`

Construction only. Each caller keeps its own enumeration, order and gates (book rule 6: the assembler and the graph reader keep edge before legacy, the two task services keep legacy before edge; the entry's schemaVersion gate and object copy stay).

| Line | Signature | Returns | Source |
| --- | --- | --- | --- |
| 5 | `edgeDeclarationId(planRef: PlanRevisionRef, edge: { taskId: string; dependsOnId: string; requires: DependencyRequirement }): string` | `"edge:" + sha256Hex(canonicalJson({ planRef, consumerTaskId: edge.taskId, dependsOnId, requires }))` | `views/graph-context-reader.ts:905` |
| 14 | `legacyDeclarationId(requirementId: string): string` | `` `legacy:${requirementId}` `` | same |

## 5. Event envelope — `src/core/work-graph/persistence/event-envelope.ts`

| Line | Signature | Returns |
| --- | --- | --- |
| 4 | `encodeEventEnvelope<E extends { eventId: string; eventType: string; schemaVersion: number; occurredAt: string }>(event: E): EncodedDomainEvent` | `{ eventId, eventType, schemaVersion, occurredAt, json: JSON.stringify(event) }`, the four taken from `event` |

Use it only where the old encoder stringifies the **whole event object unchanged** and takes the four fields from it. An encoder that projects, renames, drops fields or uses canonical JSON keeps its own code.

## 6. Event checks — `src/core/work-graph/persistence/event-validation.ts`

Used by the decision and line-settings codecs (G1, done). Another codec may use one only when its texts and order are exactly these.

| Line | Signature | Checks, in order |
| --- | --- | --- |
| 6 | `eventEnvelopeProblem(event: EncodedDomainEvent, eventType: string, schemaVersion: number): string \| null` | eventType, schemaVersion, eventId, occurredAt |
| 25 | `eventBodyEnvelopeProblem(body: UnknownRecord, event: EncodedDomainEvent, eventType: string): string \| null` | body eventId, eventType, schemaVersion, occurredAt equal the envelope |
| 40 | `actorProblem(value: unknown): string \| null` | the wire ActorRef (human / system / agent with a complete RunRef) |
| 57 | `eventBodyProblem(value: unknown, envelopeKeys: readonly string[], bodyKeys: readonly string[]): UnknownRecord \| string` | object, keys, identityKey, fingerprint, projectId, workspaceId, requestId, actor, payload `{ value, proof }` |

## 7. Store failures — `src/core/work-graph/persistence/read-result-failures.ts`

Separate maps; never one map for all. `atLeastCursorResult` (:22) and `storeFailureToRejection` (:42) behave as before.

| Line | Signature | Mapping | Source | Consumers |
| --- | --- | --- | --- | --- |
| 37 | `storeFailureCode(failure: { code: string }): CoreRejection["code"]` | the 14 Core codes kept, anything else `unavailable` | the code part of `storeFailureToRejection` | G3 (VW-7) |
| 48 | `pinsFromStoreCurrent(current: readonly { refKey: string; revision: number \| null }[]): VersionPin[]` | skips a null revision and an unparseable or non-object `refKey`; no schema check, no sort, no dedupe | `sessions/session-directory.ts:125` and the like | G2 session-directory :133; G4 claim-service :141 (claim switches only this; its corrupt has no prefix), execution-entry-service :158, execution-history-service :107 |
| 66 | `sessionStoreFailureToRejection(failure: { code: string; reason: string; current?: readonly { refKey: string; revision: number \| null }[] }): CoreRejection` | `revision_conflict` → pins, `current` only when non-empty; `unique_conflict` → `revision_conflict` + ` (the unique slot is held by another owner)`; `corrupt` → `unavailable` + prefix `the record store reported damage: `; `invalid`, `not_found`, `idempotency_conflict`, `unsupported` kept; else `unavailable` | `sessions/session-directory.ts:144` | G2 session-directory :144, session-lifecycle :139, session-responsibility-service :83, mailbox-service :177 |
| 88 | `executionStoreFailureToRejection(same input): CoreRejection` | `revision_conflict` → pins, non-empty `current`; `unique_conflict` → `busy` + ` (the Kernel identity slot is held by another Run)`; `idempotency_conflict`, `not_found`, `invalid` kept; `unsupported`, `corrupt`, else → `unavailable` | the execution entry / history maps | G4 execution-entry-service :169, execution-history-service :118 |
| 110 | `ownerWriteStoreFailureToRejection(failure: { code: string; reason: string }): CoreRejection` | `revision_conflict` kept without `current`; `unique_conflict` → `busy` without suffix; `idempotency_conflict`, `not_found`, `invalid` kept; `unsupported`, `corrupt`, else → `unavailable` | the K3 UCR / CRR / receipt write maps | G5 command-rerun-request-service :101, unknown-call-review-service :334, receipt-replay :71 |
| 124 | `ownerReadStoreFailureToRejection(failure: { code: string; reason: string }): CoreRejection` | `invalid`, `unsupported` kept; everything else `unavailable`; reason unchanged | the K3 read maps | G5 command-rerun-request-service :112, unknown-call-review-service :330 |

## 8. Old names kept

- `src/core/work-graph/tasks/codec-fields.ts` re-exports `isObject` (= `isRecord`), `nonEmpty`, `isSha256Hex`, `isInt`, `isNonNeg`, `isPos`, `hasOnlyKeys`, `utf8Bytes`, `codePoints`, `inList`, `parseObject`, `invalid`, `canonicalOf` and the type `UnknownRecord`, same signatures.
- `src/core/work-graph/tasks/codec-shape-checks.ts`: `runRefProblem`, `taskTripleProblem` are re-exports of the identical `persistence/rework-codecs.ts` functions; `sessionMessageRefProblem` keeps its own protocol.
- `src/core/work-graph/persistence/rework-codecs.ts` keeps every export. `sessionRefProblem(value: unknown, label: string): string | null` (:154) is the strict SessionRef check; `label` is error text. G3 switches `persistence/note-record-codecs.ts:158`; G5 switches `tasks/unknown-call-review-codecs.ts:93` and `tasks/session-anomaly-codecs.ts:83`.

## 9. Consumers by group

- **G2:** primitives, `canonicalOf`, `encodeEventEnvelope` where identical, the rejection shapes, `pinsFromStoreCurrent`, `sessionStoreFailureToRejection`.
- **G3:** primitives, `canonicalOf`, `encodeEventEnvelope` where identical, `rejectedWithNonEmptyCurrent` (`queries/query-execution.ts:83`, `queries/query-job-service.ts:91`), `okFalse` (`views/note-views.ts:82`), `edgeDeclarationId` / `legacyDeclarationId` (`views/graph-context-reader.ts:910`, `:924`), `storeFailureCode`, `sessionRefProblem` for the note codec. The note codec uses the nullable `parseObject`, **not** `parseTaggedObject`.
- **G4:** primitives, `canonicalOf`, `rejectedWithNonEmptyCurrent` (`tasks/requeue-service.ts:191`), the declaration ids (`tasks/execution-entry-service.ts:1082`, `:1093`, `tasks/context-input-service.ts:373`, `src/core/agent-runtime/context-assembler.ts:766`, `:780`), `pinsFromStoreCurrent`, `executionStoreFailureToRejection`.
- **G5:** primitives, `canonicalOf`, `encodeEventEnvelope` where identical, the rejection shapes, `pinsFromStoreCurrent` where its revision-conflict mapping uses it, `ownerWriteStoreFailureToRejection`, `ownerReadStoreFailureToRejection`, `sessionRefProblem` for UCR and session-anomaly.
- `parseTaggedObject` and the `event-validation.ts` checks have no planned consumer after G1.

## 10. Pending production reach (book rule 4)

At `c1-g1`, `tests/architecture/production-reach.test.ts` fails for exactly these nine declarations; nothing else may fail there. Each group reports the subset still unreached after its run.

| Declaration | Consumer groups |
| --- | --- |
| `src/contracts/core/rejections.ts:22` `rejectedWithNonEmptyCurrent` | G3, G4 (and G2 / G5 through the maps below) |
| `src/contracts/core/rejections.ts:33` `okFalse` | G3 |
| `src/contracts/input-declaration-id.ts:5` `edgeDeclarationId` | G3, G4 |
| `src/contracts/input-declaration-id.ts:14` `legacyDeclarationId` | G3, G4 |
| `src/core/work-graph/persistence/read-result-failures.ts:48` `pinsFromStoreCurrent` | G2, G4 |
| `src/core/work-graph/persistence/read-result-failures.ts:66` `sessionStoreFailureToRejection` | G2 |
| `src/core/work-graph/persistence/read-result-failures.ts:88` `executionStoreFailureToRejection` | G4 |
| `src/core/work-graph/persistence/read-result-failures.ts:110` `ownerWriteStoreFailureToRejection` | G5 |
| `src/core/work-graph/persistence/read-result-failures.ts:124` `ownerReadStoreFailureToRejection` | G5 |
