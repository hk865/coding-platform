## Summary

G4 is complete: TA-1, TA-4 (task + Runtime callers), TA-5, TA-10, the VW-5 terminal-candidate helper, the G4 B-wiring, and TA-2 comments. All production code was written by four disjoint-file subagents plus the coordinator's single glue fix.

Behaviour-preserving constraints held: trusted-context keeps the four labels, the claim-only array-signal check and each wrapper's success fields; TA-4 keeps legacy-before-edge in the two task services and edge-before-legacy in the assembler, with the entry's schemaVersion gate and object copies; execution-entry/history keep the Kernel `busy` suffix and unsupported→unavailable; claim keeps its unprefixed corrupt branch and only switches the pin decoder; requeue keeps `reductionRevision === null`; VW-5 keeps chain-position comparison, strict `>0`, equal-keeps-earlier and no sorting. No tests, fixtures or the allowlist were edited.

One coordinator glue fix: `execution-history-service.mapStoreFailure` now passes `{code, reason}` for `unique_conflict` (its `current` names claim slots, which the execution map never reads); otherwise TypeScript rejects the shared parameter. No behaviour change.

Checks: `npm run typecheck` PASS; `npm run check:architecture` OK; `tests/work-graph` 293 files / 3261 tests → 3248 pass, 8 fail (all `A2-verification-chain`: absent `/usr/bin/bwrap`), 5 skip; `tests/architecture` 52/53 pass with only the four inherited production-reach declarations below; targeted scenario/app/composition 50/50 pass.

Changed lines vs `c1-g1`: tracked **+242 / −617**; two new untracked files **+165 / −0**; total **added 407 + deleted 617 = 1,024**, net **−210**.

## Interface table (frozen for later groups)

| Module | Export | Signature / return | Source | Consumers |
|---|---|---|---|---|
| `tasks/plan-readers.ts` | `terminalProposalOf` | `(heads: readonly PlanProposal[], positions: ReadonlyMap<string, CommitCursor \| null>) => PlanProposal \| null`; first `accepted`/`not_adopted` `candidate_v2`, replaced only when `compareProposalChainPositions(...) > 0`, equal keeps earlier, no sort/reads | plan-readers inline loop | **G3** view `decision-read-model.ts` (caller still to wire); G4 caller wired |
| `tasks/trusted-context.ts` | `trustedContextOf` | `(ctx, { label, reject, allowArraySignal }) => { ok: true; ctx; scope; actor; signal } \| { ok: false; rejection }` | execution-history `ownCallContext` | claim, execution-history, run-state, execution-entry |
| `tasks/trusted-context.ts` | `isolatedWriteOf<T>` | `(request, { label, reject, cannotIsolate }) => { ok: true; input; requestId; expected } \| { ok: false; rejection }` | execution-history `ownRequest` | claim, execution-history, execution-entry |
| `tasks/task-phase-facts.ts` | `taskPhaseFactsOf` | `({ taskKind, applicableReduction, selectedRun, effectivePhase, round, coveringRequeue }) => TaskPhaseFacts` | completion literal | claim, completion, plan-readers |
| `tasks/goal-settings-service.ts` | `waitPredecessorWalk` (file-local) | bounded 64-link walk returning `{ waitingCycle } \| CoreRejection` | both goal-settings loops | same file only |

## Per-item

| Item | Status | Notes |
|---|---|---|
| TA-1 | done | 4 services call `trustedContextOf`; claim/execution-history/entry call `isolatedWriteOf`; labels, texts, order and success shapes preserved |
| TA-4 | done (G4 side) | entry, context-input, context-assembler use `edgeDeclarationId`/`legacyDeclarationId`; graph-context-reader/view side belongs to G3 |
| TA-5 | done | claim, completion, plan-readers call `taskPhaseFactsOf`; requeue deliberately not wired |
| TA-10 | done | one `waitPredecessorWalk`; seen-set, start, 64 bound, failed-read return, capacity text preserved |
| VW-5 | done (G4 side) | helper created and called in plan-readers; G3 wires the view caller |
| B wiring | done / partly | primitives in 21 files; `canonicalOf` (entry), `pinsFromStoreCurrent` (claim, history, entry), `executionStoreFailureToRejection` (history, entry), `rejectedWithNonEmptyCurrent` (requeue). Near-copies left: inline safe-int checks, compound `isRunRef`, throwing `refKeyOf`/`sameRef`, codec parsers |
| TA-2 | done | stale staging notes, K3/rework/group/slice tags and restatements trimmed in G4 files; rules, spec refs and state-machine comments kept |

## Tests run

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run check:architecture` | OK |
| `npx vitest run --maxWorkers=2 tests/work-graph` | 293 files: 292 pass, 1 fail; 3248 pass / 8 fail / 5 skip. All 8 in `A2-verification-chain.test.ts`, environment: `/usr/bin/bwrap` missing (category b); isolated re-run same evidence |
| `npx vitest run --maxWorkers=2 tests/architecture` | 4 files, 52/53 tests. Only `production-reach.test.ts:103`; unreached = exactly the four inherited declarations below; allowlist problems `[]` |
| scenario/app/composition: `K3-42-unexpanded-r2`, `S3-query-graph`, `S3-attention-context`, `WP2-wiring` | 4 files, 50/50 pass |
| subagent runs: R4c execution claim/history/read (116), entry/context/graph (111), requeue/goal-settings/completion (38), D sweep (104) | all pass, 0 fail |

Production-reach, one-to-one with G1's pending table (category c, all later groups): `rejections.ts:33 okFalse` (G3), `read-result-failures.ts:66 sessionStoreFailureToRejection` (G2), `:110 ownerWriteStoreFailureToRejection` (G5), `:124 ownerReadStoreFailureToRejection` (G5). `edgeDeclarationId`, `legacyDeclarationId`, `pinsFromStoreCurrent`, `executionStoreFailureToRejection` and `rejectedWithNonEmptyCurrent` are now reached by G4; `terminalProposalOf` and both new helpers have production callers.

## Cross-group hand-over

| Group | Needs from G4 | Status |
|---|---|---|
| G3 | `terminalProposalOf` (module/signature above); wire the `decision-read-model.ts` view caller | helper frozen and reached; view caller not wired |
| G2 | `sessionStoreFailureToRejection` consumers | still unreached (G2's own file) |
| G5 | `ownerWriteStoreFailureToRejection`, `ownerReadStoreFailureToRejection` consumers | still unreached (G5's own files) |

No G4 item required a file outside its whitelist; no G1 signature was changed.

## Changed lines (vs `c1-g1`)

| Kind | Added | Deleted |
|---|---:|---:|
| Tracked files (30 modified) | 242 | 617 |
| Untracked new files (`tasks/trusted-context.ts` 138, `tasks/task-phase-facts.ts` 27) | 165 | 0 |
| **Total** | **407** | **617** |

**Added + deleted = 1,024** (inside 600–1,200); **net = −210**.