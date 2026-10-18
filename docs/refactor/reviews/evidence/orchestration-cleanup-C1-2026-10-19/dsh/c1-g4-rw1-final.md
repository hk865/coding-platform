## Summary

Both code items and the interface table are done. The signal decision is back at each entry: `trusted-context.ts` takes a per-caller `isSignal` predicate and runs it in the old position (after the scope check, before the identity clone); claim keeps its array-accepting predicate, the other three keep the plain-record one. Every B-wiring copy named by Codex is switched to G1's shared helper, plus identical copies the scan found (`plan-readers` `isSafeRevision`, `task-service` `refFromRefKey`, three more rejection builders). Only bodies that genuinely differ stay (throwing canonical wrappers, boolean `sameRef`, digest wrappers, parse-with-validation, bounded limit check, fixed-code/business wrappers). `trustedContextOf`/`isolatedWriteOf` are otherwise untouched, and `terminalProposalOf` is unchanged. Typecheck and the boundary check pass; the direct-dependent test set passes except one file whose 8 failures all report missing `/usr/bin/bwrap`.

## Per-item table

| Item | Status | Why |
|---|---|---|
| 1. Signal check back at each entry | **done** | `allowArraySignal` removed from `tasks/trusted-context.ts`; required `isSignal: (signal: unknown) => boolean` runs after the project/workspace scope check and before `structuredClone`. Claim's predicate accepts any non-null object (arrays included); execution-history/run-state/execution-entry use `isRecord`. Same `forbidden` code and `${label} requires the bound AbortSignal` text. `isolatedWriteOf` untouched. |
| 2. Finish B wiring | **done** | `canonicalOf`: completion, control-service, run-state. `parseObject`: execution-entry, plan-readers, run-state, task-service. Integers: completion `isPos`/`isNonNeg`, plan-readers `isNonNeg`. Rejections: `rejectedWithCurrent` (claim, completion, control-service, goal-settings, execution-history, execution-entry) and `rejected` (run-state, context-input, initial-plan, plan-service, run-activity, run-reconcile, session-anomaly, task-service). No Codex-named copy remains. |
| 3. Complete interface table | **done** | Below; also corrects the earlier "all wrapper success fields kept" claim. |

## Copies left (and why)

1. **Non-nullable canonical wrappers** (`canonicalOf` throws→null; these throw or hash): `completion.ts:110`, `control-service.ts:188`, `run-reconcile-service.ts:127` `fingerprintOf`; `refKeyOf` returning `string` at `claim-service.ts:121`, `goal-settings-service.ts:84`, `plan-service.ts:311`, `requeue-service.ts:193`, `run-reconcile-service.ts:131`, `session-facts.ts:53`, `session-provenance-facts.ts:61`, `goal-executed-files-reader.ts:52`.
2. **Boolean `sameRef`** (try/catch canonical equality, not a nullable string): `claim-service.ts:124`, `execution-history-service.ts:87`, `execution-entry-service.ts:137`, `session-anomaly-service.ts:93`, `run-reconcile-service.ts:129`, `session-provenance-facts.ts:64`.
3. **Digest catch-null wrappers** `plan-readers.ts:795` `completionPolicyDigest` and `:805` `architectureBaselineDigest` — they catch around a policy digest / `sha256Hex`, not `canonicalOf`.
4. **Parse-with-validation**: `run-state-service.ts:295` `decodeExecutionListCursor` (schemaVersion + fields), `:310` `runRefFromCandidateKey` (`isRunRef`), `session-anomaly-service.ts:158` `parseSubjectRunRef` (`parseRunRef`), plus cursor/manifest parsers in `context-input-service.ts:877`, `plan-service.ts:1042/1206`, `session-facts.ts:83`, `session-provenance-facts.ts:411`, `requeue-service.ts:1211`, `run-reconcile-service.ts:95` — not the bare nullable object parse.
5. **Bounded integer check** `session-facts.ts:170` `validLimit`: `Number.isInteger` plus `EXTERNAL_MAX_LIMIT`, not `isInt`; all other `Number.isSafeInteger` uses are inline inside larger conditions.
6. **Fixed-code/business rejection wrappers**: `request-facts-reader.ts:26/29/32` and `goal-decision-reader.ts:82/85/88` (fixed code + literal return type), `goal-executed-files-reader.ts:48`, `plan-write-admission.ts:95-104`, `plan-service.ts` fixed-code wrappers/`refusalOf`, `task-service.ts` goal refusal (adds `currentRevision` + non-empty `current`), `completion.ts:101` `mapRejected`; `requeue-service.ts:187` already delegates to `rejectedWithNonEmptyCurrent`.
7. **Thin delegating wrappers kept for the caller's narrow name/type** (one-line body calls the shared builder, not a copied implementation): `completion:93`, `control-service:106`, `goal-settings:77`, `execution-history:79`, `execution-entry:130`, `context-input:107`, `initial-plan:40`, `plan-service:289`, `run-activity:84`, `run-reconcile:113`, `session-anomaly:95`, `task-service:67`, and run-state's narrow `refKeyOf`/`parseBody`.

## Complete interface table

| Module | Export | Full signature / return | TaskPhaseFacts order | Source | Consumers |
|---|---|---|---|---|---|
| `tasks/trusted-context.ts` | `trustedContextOf` | `(ctx: CoreCallContext, options: { label: string; reject: (code: CoreError, reason: string) => CoreRejection; isSignal: (signal: unknown) => boolean }): TrustedContextResult`, where `TrustedContextResult = { ok: true; ctx: CoreCallContext; scope: WorkspaceScope; actor: Extract<ActorRef, { kind: 'human' \| 'system' }>; signal: AbortSignal } \| { ok: false; rejection: CoreRejection }` | — | the four per-service wrappers at `c1-g1` (claim-service, execution-history-service, run-state-service, execution-entry-service) | those four, same files |
| `tasks/trusted-context.ts` | `isolatedWriteOf` | `<T>(request: GraphWrite<T>, options: { label: string; reject: (code: CoreError, reason: string) => CoreRejection; cannotIsolate: string }): IsolatedWrite<T>`, where `IsolatedWrite<T> = { ok: true; input: T; requestId: string; expected: readonly VersionPin[] } \| { ok: false; rejection: CoreRejection }` | — | same four wrappers | claim-service, execution-history-service, execution-entry-service |
| `tasks/task-phase-facts.ts` | `taskPhaseFactsOf` | `(input: { taskKind: TaskKind; applicableReduction: Pick<TaskReductionSnapshot, 'phase'> \| null; selectedRun: RunSnapshot \| null; effectivePhase: Phase; round: TaskPhaseFacts['round']; coveringRequeue: TaskPhaseFacts['coveringRequeue'] }): TaskPhaseFacts` | 1 `taskKind: TaskKind`; 2 `applicableReduction: Pick<TaskReductionSnapshot, 'phase'> \| null`; 3 `selectedRun: RunSnapshot \| null`; 4 `originUnresolvable: boolean`; 5 `round: RoundTaskSignalV1`; 6 `coveringRequeue: TaskRequeueRef \| null` (type at `state/task-machine.ts:86`) | per-caller constructions in claim-service, completion, plan-readers | claim-service:240, completion:154, plan-readers:2158 |
| `tasks/plan-readers.ts:762` | `terminalProposalOf` | `(heads: readonly PlanProposal[], positions: ReadonlyMap<string, CommitCursor \| null>): PlanProposal \| null` | — | the inline loop at `c1-g1` `plan-readers.ts:745–756` | plan-readers:740; G3 `views/decision-read-model.ts` |

**G3 precondition for `terminalProposalOf`:** the view first filters its superseded candidates and passes only live heads (`candidates.filter(c => !superseded.has(canonicalJson(c.ref)))`), keeps its live branch first, and keeps its `candidates.find(c => c.status !== 'candidate') ?? null` fallback when the helper returns `null`; it must not pass the unfiltered `candidates`.

**Wrapper success fields (corrected):** the earlier claim that every wrapper kept its success fields was wrong. G4's first version had run-state return `ok,ctx,scope,actor`; the lead removed `scope` at `c1-g4-r1-lead`, restoring `ok,ctx,actor`. Final: claim `ok,ctx,actor`; execution-history `ok,ctx,scope,actor`; run-state `ok,ctx,actor`; execution-entry `ok,ctx,scope,actor,signal`; request isolation `ok,input,requestId,expected`.

## Tests run

| Check | Result |
|---|---|
| `npm run typecheck` (coordinator, once) | **pass**, exit 0 |
| `npm run check:architecture` | **pass** (`next source boundaries: OK`) |
| `npx vitest run --maxWorkers=2 tests/architecture` | 3/4 files, 52/53 tests; production-reach fails only for the 4 allowed declarations below |
| Direct dependents, 114 files (`npx vitest run --maxWorkers=2 …`) | 113/114 files, 1433/1441 tests; the only failure is `A2-verification-chain.test.ts` (8 tests), all actual results carrying `ENOENT … access '/usr/bin/bwrap'` — environmental, not a regression |
| Worker A: B2-execution-entry, R4c-execution-read, R4c-execution-history-index, A1-session-lifecycle, S3-prepared-context-admission, R4-control-runtime | 6/6 files, 166/166 tests |
| Worker B: A2-control-service, R4-control-intent, S3-context-inputs, R5b-initial-plan, A2-requeue-service, S5-goal-settings, R3e-completion, S2B-r2-conflict-catalog | 8/8 files, 114/114 tests |

The full transitive dependant set is 583/591 test files (effectively the whole suite); I started the remaining 469 but stopped it — the 5,001-item route/scale files (`S2A-decision-routes`, `S2C-lines-scale`) take minutes per file at `--maxWorkers=2`, so the complete transitive run does not fit this 60-minute headless window. The three files that did finish before the stop passed.

## Remaining production reach

`okFalse` (G3), `sessionStoreFailureToRejection` (G2), `ownerWriteStoreFailureToRejection` (G5), `ownerReadStoreFailureToRejection` (G5) — exactly the allowed list; nothing else.

## Changed lines

- **Against `c1-g4-r1-lead`:** 16 files, **+68 / −87**, total **155**, net **−19**. No untracked new source files (`.dsh-ref/` is the pre-existing reference input, not counted).
- **Total against `c1-g1`:** 32 files, **+452 / −682**, total **1,134**, net **−230** (within G4's 600–1,200 target).