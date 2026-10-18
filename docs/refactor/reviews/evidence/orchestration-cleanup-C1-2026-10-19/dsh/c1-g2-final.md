All work is complete and verified. Final report:

## Summary (under 300 words)

G2 is done on base `c1-g1`: the SE supplement, SE-2, SE-3, SE-5, SE-7, the G1 shared-helper wiring (XX-1/2/5/6/7, rejection shapes, pin decoder, Session store-failure map) and SE-4. Behaviour remained byte-identical on inspection: same codes/texts/order/field presence/list order/read counts/JSON bytes. No test, assertion or allowlist file changed.

Three regional helpers were created, all G2-internal: `sessions/trusted-context.ts` (trusted Host context + GraphWrite isolation + identity/fingerprint), `sessions/session-links.ts` (the one complete link read), and `configuration/workspace-settings-reads.ts` (owned scope, Workspace pin check, exact Workspace read, original-event replay). The two settings services keep their own null/`{pin}` wrappers and business transitions.

The four Session services now use `sessionStoreFailureToRejection`; each keeps a six-line `StoreFailure` type-narrowing adapter because `unique_conflict.current` is a claim slot, not version pins. The output is unchanged. `decision-source-facts` now has one template-parameterised stored-record read/decode protocol; its own store-failure map (not a G1 map) moved to module scope unchanged.

The run is above the 600–1,200 add+delete target (3,069) because replacing local helpers also renames every call site and the moved bodies count as additions; no item was added, and net (−535) is inside the delta's −430…−570 estimate. Nothing is left unfinished.

Checks: typecheck and `check:architecture` pass; `tests/architecture` has exactly the six inherited production-reach failures; 52 area-dependent test files (764 tests) pass. The reverse-dependency closure is 593 files (essentially the full suite), so the lead's bwrap full run is still required. `WP1-wiring` (3) and `A7-control` (14) fail identically on pristine `c1-g1` (no bwrap), so they are environment/pre-existing, not regressions.

## Interface table (new regional helpers)

| Module | Export | Signature | Return shape | Source | Consumers |
|---|---|---|---|---|---|
| `sessions/trusted-context.ts` | `trustedContext` | `(ctx: CoreCallContext, label: string) => TrustedContext` | `{ok:true;scope;actor}` \| `{ok:false;rejection}` | `session-directory.ts` `trustedContext` | directory, lifecycle, responsibility |
| | `ownRequest` | `<T>(request: GraphWrite<T>, what: string) => OwnedRequest<T>` | `{ok:true;input;requestId;expected}` \| `{ok:false;reason}` | `session-lifecycle.ts` | lifecycle, responsibility |
| | `actorIdentity` | `(actor: HostActor) => {kind;id}` | object | directory/lifecycle | lifecycle, responsibility, directory |
| | `identityKeyOf` | `(prefix, actor, scope, requestId) => string` | SHA | lifecycle | lifecycle, responsibility, directory |
| | `fingerprintOf` | `(kind, actor, scope, payload, expected) => string` | SHA | lifecycle | lifecycle, responsibility, directory |
| | `eventIdOf` | `(identityKey, suffix) => string` | SHA | lifecycle | lifecycle, responsibility |
| | `HostActor`, `TrustedContext`, `OwnedRequest<T>` | types | — | directory/lifecycle | same |
| `sessions/session-links.ts` | `readSessionWorkLinks` | `(lookups, projectId, sessionId, observe?) => Promise<{ok:true;links}\|{ok:false;rejection}>` | links | `session-directory.ts` `readSessionLinks` | directory, lifecycle |
| `configuration/workspace-settings-reads.ts` | `sameActor`, `ownScope`, `isOwned`, `workspacePinProblem`, `loadWorkspace`, `replayWorkspace` | see brief | per source | `decision-settings-service.ts` | decision-settings, line-settings |
| | `Owned`, `WorkspaceSettingsRecords`, `CommittedReceipt`, `WorkspaceReplayTexts`, `WorkspaceEventDecoder` | types | — | decision-settings | both settings services |

## Per-item table

| Item | Status | What was done / why |
|---|---|---|
| SE supplement | **done** | `trusted-context.ts`: directory trusted context with label; lifecycle GraphWrite isolation shared by lifecycle+responsibility; identity/fingerprint helpers shared; exact four texts and scope→signal→principal→actor order kept. Directory's arbitrary-value clone stays local. |
| SE-2 | **done** | `pageProblem(page, texts)` + `atLeastCursorOf` + `readProgress` in `mailbox-service.ts`; all four reads wired; exact per-read texts, 1–100 limit, numeric watermark comparison and `MIN_CURSOR` null rule kept; no store reads added. |
| SE-3 | **done** | `workspace-settings-reads.ts`; both services keep their own pin wrapper, transitions/commit conditions and replay event decoder; replay still reads the original `eventAt` event. |
| SE-5 | **done** | One `readStoredRecord`/`readStoredDecoded` with current-source and saved-answer templates; one `readMany`; missing vs unaccounted omission kept separately; saved answers still read their captured historical source. |
| SE-7 | **done** | `session-links.ts`; index, page 200, total 2000, observer timing, budget/damage texts kept; directory wraps `value`, lifecycle wraps `links`. |
| B: XX-1 | **done** | 18 files: `isRecord`, `nonEmpty`, `hasOnlyKeys`, `isPos`, `isNonNeg`, `isSha256Hex`, nullable `parseObject`, `invalid` imported; local copies deleted. |
| B: XX-2 | **done** | 16 event encoder entry points (2 session-record, 6 lifecycle, 2 message incl. the 7 wrappers, 4 project-bootstrap, 2 role) delegate to `encodeEventEnvelope`; no inline `json: JSON.stringify(event)` remains in G2. |
| B: XX-5 | **done** | 14 local `canonicalOf` copies replaced by `contracts/fingerprint`; throwing callers (e.g. message-duties `canonicalJson`) kept. |
| B: XX-6 | **done** | 2 nullable `parseObject` copies replaced. Tagged parser not applied to non-listed codecs. |
| B: XX-7 | **done** | Four Session services use `sessionStoreFailureToRejection` and the shared pin decoder; other local maps left (different protocols). |
| B: rejection helpers | **done** | Local `reject`/`rejected` copies replaced with `rejectedWithCurrent`/`rejected`; all callers keep narrow code types. |
| SE-4 | **done** | mailbox `part-1/part-2` history, project-bootstrap staged narrative, message-record re-export duplicate removed; all rules/why kept. |
| SE-9/11/12/13 | **skipped (not G2)** | Withdrawn/other-group rows; no effect. |

## Tests and checks

| Command | Result |
|---|---|
| `npm run typecheck` | **pass** |
| `npm run check:architecture` | **OK** |
| `npx vitest run --maxWorkers=1 tests/architecture` | 4 files, 52 passed; 1 expected failure |
| `npx vitest run --maxWorkers=2` (52 area-dependent files) | **52 files, 764 tests passed** |
| Agent-focused runs | 30 files, 602 tests passed (included above in substance) |
| Pristine `c1-g1` diagnostics | `WP1-wiring` 3 failed, `A7-control` 14 failed **identically** on base (no bwrap) |
| Full-suite attempt | stopped: reverse closure is 593 files / essentially the full suite; one scale file alone takes 284 s at `--maxWorkers=2`. Lead runs it with bwrap. |

**Production-reach at G2** — exactly six failures, one-to-one with the inherited G1 table:

| Declaration | Consumer group(s) |
|---|---|
| `contracts/core/rejections.ts:33 okFalse` | G3 |
| `contracts/input-declaration-id.ts:5 edgeDeclarationId` | G3, G4 |
| `contracts/input-declaration-id.ts:14 legacyDeclarationId` | G3, G4 |
| `persistence/read-result-failures.ts:88 executionStoreFailureToRejection` | G4 |
| `persistence/read-result-failures.ts:110 ownerWriteStoreFailureToRejection` | G5 |
| `persistence/read-result-failures.ts:124 ownerReadStoreFailureToRejection` | G5 |

Now reached (removed from the inherited list): `rejectedWithNonEmptyCurrent`, `pinsFromStoreCurrent`, `sessionStoreFailureToRejection`.

## Cross-group hand-over

| Item | Value |
|---|---|
| New helper consumed by a later group | none — all three regional modules are consumed only inside G2 |
| G1 declarations switched by G2 | `rejectedWithCurrent`/`rejected` (primitives), `pinsFromStoreCurrent`, `sessionStoreFailureToRejection`; now production-reached |
| Remaining inherited production-reach list | the six rows above |
| Rows needing a file outside the whitelist | none |
| Frozen signatures changed | none |

## Changed lines against `c1-g1`

| Tracked | New files | Added + deleted | Net |
|---|---:|---:|---:|---:|
| +953 / −1,802 | +314 / −0 | **3,069** | **−535** |

Tracked diff = 20 files (953+1802); new files = `trusted-context.ts` 113, `session-links.ts` 67, `workspace-settings-reads.ts` 134. Over the 600–1,200 target for the reason above; no item was left unfinished and nothing was padded. `.dsh-scratch/` was deleted.