All four subagents reported; close-out checks are complete.

## Summary

G5 is done on top of `c1-g1`, behaviour-preserving. The type layer now has one declaration: `state/message-machine.ts` and `state/plan-machine.ts` own the message/plan record types, with `model/` keeping the old public names as aliases/re-exports (field docs moved, not duplicated). The dispatch/outbox and entry-permit duplicates are aliases, and N8 makes the decision port reuse `NoteDecisionApplicationInputV1`. ST-7 moved the recursive ref comparator to `state/ref-equality.ts`; ST-4 unified the two attention enumerations; ST-9 removed the unreachable branch; ST-6 calls the existing budget helper. N12 is one `readOwnerRecord` helper (one `readMany`, `notFound`/`invalid`/owner texts preserved) used by both CRR and UCR.

All G5 files now consume G1's frozen primitives, `canonicalOf`, `encodeEventEnvelope` (8 exact whole-event encoders), rejection helpers, `ownerWriteStoreFailureToRejection` / `ownerReadStoreFailureToRejection`, and `sessionRefProblem` (UCR + session-anomaly). `ownerWrite`/`ownerRead` are now production-reached. K3 field comparisons were kept separate from ST-7. Comments were trimmed of rework/group/round history only; state-machine rule comments remain.

Checks: `npm run typecheck` passes; `npm run check:architecture` passes; the broad dependent run is green except 10 tests in 4 files — 8 are the missing `/usr/bin/bwrap` environment, 1 is the inherited production-reach set (7 G1 rows), and the `invariants`/`invariants-fuzz` failures reproduce identically on a clean `c1-g1` archive. Added + deleted: **1,194** (419 added, 775 deleted), net **−356**; no test or allowlist file changed.

## Interface table (G5 regional helpers)

| Module | Export | Signature / return shape | Original implementation | Consumers |
|---|---|---|---|---|
| `state/ref-equality.ts` | `sameRef(left: unknown, right: unknown): boolean` | `===` short-circuit; null/array/own-key recursive equality, `true`/`false` | `state/session-anomaly.ts:93-105` (verbatim) | `state/session-anomaly.ts` (4 call sites), `state/session-availability.ts` (3) — G5, production-reached |
| `tasks/owner-record-read.ts` | `readOwnerRecord<T>(input: { store: Pick<GoalRecordTransactionPort,'readMany'>; refKey: string; decode(record): DecodeResult<T>; readError(message): CoreRejection; decodeError(reason): CoreRejection }): Promise<OwnerRecordRead<T>>`; `OwnerRecordRead<T> = { ok: true; value: T } \| { ok: false; rejection: CoreRejection } \| { ok: false; notFound: true }` | one `readMany([refKey])`; non-ready → owner read map; no record → `notFound`; decode failure → caller's `invalid` template | `command-rerun-request-service.ts` `loadRequest`, `unknown-call-review-service.ts` `loadReview` | both owners — G5, production-reached |

G1 modules consumed unchanged (no signature change): `contracts/validation/common.ts`, `contracts/fingerprint.ts` `canonicalOf`, `contracts/core/rejections.ts`, `persistence/event-envelope.ts`, `persistence/read-result-failures.ts` (:110/:124 now reached), `persistence/rework-codecs.ts` `sessionRefProblem`.

## Per-item table

| Item | Status | Detail |
|---|---|---|
| ST-1 message types | done | `state/message-machine.ts` single declaration; `model/communication-contracts.ts` same-name aliases/re-exports; model field docs moved to state |
| ST-1 plan types | done | `state/plan-machine.ts` owns `PlanProposalRef`/`PlanChangeReason`/`CandidateRequestExtensionV1`/`CandidatePlanProposal`/`LegacyPlanProposal`/`PlanProposalRecord`; model re-exports, `PlanProposal = PlanProposalRecord` |
| ST supplement 1 (dispatch/outbox) | done | `TaskDispatchStateV1 = DispatchStateV1`; V1/V2 union and optional `dispatchState` unchanged |
| ST supplement 2 (entry permit) | done | `TaskEntryPermit = RunEntryPermit`; five fields unchanged |
| ST-4 attention enumeration | done | one `attentionCandidates` generator; summary keeps rank/order/key/complete, detail keeps real card/head source |
| ST-6 budget condition | done | calls `requeueBudgetIncreased`; same text and guard position |
| ST-7 recursive ref compare | done | new `state/ref-equality.ts`; both local copies removed |
| ST-9 unreachable run branch | done | deleted branch covered by the earlier ended+`outcome_unknown` return |
| N8 note application input | done | decision port imports `NoteDecisionApplicationInputV1` from `model/note-contracts.ts`; no reverse dependency |
| N12 owner single-record read | done | one `readMany`; `{ok:false,notFound:true}`; decode failure `invalid`; each owner's own templates |
| B XX-1 primitives | done | `state/context-input.ts`, `state/run-machine.ts`, all 7 task codecs, all 10 K3 files where the body was identical; look-alikes (`isObject`, `isSafeRevision`, execution-entry refs) left |
| B XX-2 event envelope | done | 8 exact whole-event encoders (claim ×3, completion, model-request, session-anomaly, command-rerun, unknown-call); wrappers keep their types |
| B XX-5 nullable canonical | done | `context-input.ts` `canonicalKey` → `canonicalOf`; direct-throw `refKeyOf` helpers left |
| B XX-6 nullable parse | done | task codecs + `decision-source-identity.ts` (outer checks and `kind` check kept) |
| B XX-7 maps / pins | partly | `ownerWriteStoreFailureToRejection` and `ownerReadStoreFailureToRejection` wired; `pinsFromStoreCurrent` has no G5 consumer (G2/G4), left for them |
| Rejection helpers | done | `rejectedWithCurrent` aliased in CRR/UCR, `rejected` in receipts/reviews/answers/decision-answer-lookup; fixed-business wrappers kept |
| K3 `sessionRefProblem` | done | UCR `plainSessionRefProblem` and session-anomaly `plainRefProblem` (both call sites) |
| TA-2 / VW-2 / ST-5 comments | done | rework/group/round tags trimmed; rules kept; long state-machine comments untouched |
| K3 small field comparisons | skipped as specified | `sameTask`/`sameReviewRef`/`sameRunRef` kept separate from ST-7 |
| `tasks/run-activity-codecs.ts` | skipped | pure 11-line re-export; nothing to migrate |

## Tests and checks

| Check | Result |
|---|---|
| `npm run typecheck` | pass (both `tsconfig.json` and `tsconfig.ui.json`) |
| `npm run check:architecture` | pass |
| `npx vitest run --maxWorkers=2 tests/state tests/work-graph tests/architecture` | 341 files / 7,207 tests: **337 files, 7,163 tests pass**, 34 skipped, 4 files / 10 tests fail |
| — `tests/work-graph/A2-verification-chain.test.ts` | 8 fails: `ENOENT /usr/bin/bwrap` — environment |
| — `tests/architecture/production-reach.test.ts` | 1 fail: exactly the 7 inherited G1 rows below |
| — `tests/state/invariants.test.ts`, `invariants-fuzz.test.ts` | reproduced identically on a clean `c1-g1` archive → pre-existing base failure |
| Remaining 280 non-bwrap `tests/work-graph` files (JSON rerun) | 3,153 / 3,153 pass |
| All 44 `tests/state` files (JSON rerun) | 3,863 pass, 1 fail + 1 file error — same two pre-existing files |
| Targeted reruns | `A2-verification-chain` + `verification-machine`: 150 pass / 8 bwrap fails; bwrap-referencing set + `tests/architecture` (17 files): 278 pass / 1 inherited production-reach fail |
| Subagent runs (already reported) | S1: 6 state files 2,008 pass + 12 dependent files pass. S2: 8 specified 1,286 pass + 33 dependent 731 pass (3 WP1-wiring, reproduced on base). S3: 7 required 75 pass + 48 dependent 640 pass (8 bwrap + 3 WP1 base). S4: 10 prescribed 198 pass + 6 extra 84 pass |

**Production-reach remaining (G5 subset), matched to the frozen table** — `ownerWriteStoreFailureToRejection` and `ownerReadStoreFailureToRejection` are now reached; the remaining seven rows are inherited, no new ones:

| Declaration | Consumer group |
|---|---|
| `contracts/core/rejections.ts:22` `rejectedWithNonEmptyCurrent` | G3, G4 |
| `contracts/core/rejections.ts:33` `okFalse` | G3 |
| `contracts/input-declaration-id.ts:5` `edgeDeclarationId` | G3, G4 |
| `contracts/input-declaration-id.ts:14` `legacyDeclarationId` | G3, G4 |
| `persistence/read-result-failures.ts:48` `pinsFromStoreCurrent` | G2, G4 |
| `persistence/read-result-failures.ts:66` `sessionStoreFailureToRejection` | G2 |
| `persistence/read-result-failures.ts:88` `executionStoreFailureToRejection` | G4 |

## Cross-group hand-over

| Item | Outside G5 whitelist? | Hand-over |
|---|---|---|
| `pinsFromStoreCurrent` consumers | yes — G2 `sessions/`, G4 `tasks/claim-service`, `execution-entry-service`, `execution-history-service` | G5 did not switch them; declaration stays G1-frozen |
| `sessionStoreFailureToRejection` consumers | yes — G2 four Session services | G5 did not switch them |
| `executionStoreFailureToRejection` consumers | yes — G4 entry/history | G5 did not switch them |
| `rejectedWithNonEmptyCurrent`, `okFalse`, `edge/legacyDeclarationId` | yes — G3/G4 | G5 did not switch them |
| New regional helpers | no | `sameRef` and `readOwnerRecord` are consumed only inside G5; no later-group consumer, no signature owed to another group |
| Files outside whitelist | none | 35 modified + 2 new files, all under `state/`, `model/`, the hit `tasks/*-codecs.ts`, the 10 K3 files, and the two new helpers; `tests/` untouched |

## Changed lines (against `c1-g1`)

| Measure | Value |
|---|---|
| Tracked files (35) | 365 added, 775 deleted |
| New untracked files (2: `state/ref-equality.ts` 14, `tasks/owner-record-read.ts` 40) | 54 added, 0 deleted |
| **Added + deleted** | **1,194** (419 + 775) |
| **Net** | **−356** |

Unspecified/deviation notes: S1 used a same-name re-export `export type { MessageResponseRecord as MessageResponse }` rather than the suggested `Omit` form, because `Omit` broke the exact type-equality assertion (verified with `tsc`); this is the rule-2 re-export allowance. `canonicalOf` is in `contracts/fingerprint.ts` (interface §2), not `validation/common.ts`. `state/command-rerun-request.ts` was left unchanged (its remaining tags are L19a/K8-7 rule citations, not construction history).