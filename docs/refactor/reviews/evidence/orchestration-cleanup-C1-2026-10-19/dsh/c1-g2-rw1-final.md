All checks are complete and both subagents have reported back. Final reply:

## Summary

All three items are done. The shared Workspace pin check now returns the pin it read once; both owners use it and no service indexes `expected[0]` again. The stale Module/WorkContext notes now say Task→current Plan, Module→current adopted architecture directory, WorkContext→unsupported; the `registrationVerdict` comment is byte-identical to `c1-g1`. All listed G1/lead/date tags are gone and their rules remain. The complete interface table follows. Typecheck and `check:architecture` pass; 19 of 20 test files pass (209 tests); production-reach fails only for the six other-group declarations. Rework: +31/−26 (57, net +5) against `c1-g2-r1`; total +1,279/−1,809 (3,088, net −530) against `c1-g1`.

## Per-item table

| # | Item | Status | What was done / why |
|---|---|---|---|
| 1 | Workspace pin read once | **done** | `workspacePinProblem` now returns `{ pin: VersionPin } \| CoreRejection`, carrying the `expected[0]` it validated. `line-settings-service.boundWorkspacePin` delegates to it (`{ pin }`). `decision-settings-service` wraps the verdict as `{ pinProblem: CoreRejection \| null; pin }` (null on success) and its later `expected.length === 1 ? expected[0] : undefined` read was removed; `pinMatches` uses the captured pin. `grep -rn "expected\[0\]" src/core/work-graph/configuration/` has exactly one hit, inside the shared check (`workspace-settings-reads.ts:78`). |
| 2 | Comments (rule 5 / SE-4) | **done** | `session-directory.ts:13` and `:939`: both now say Task against the current active accepted Plan, Module against the current adopted architecture directory, WorkContext still unsupported, keeping "instead of writing a fabricated association". `session-links.ts:20`, `decision-source-facts.ts:212`, `session-lifecycle.ts:96`, `session-directory.ts:114`, `session-responsibility-service.ts:68`: "G1's map" / "never a G1 shared map" replaced by "the shared map" / "a shared map", keeping the version-pin `current` and claim-slot rule. `Lead decision L-a:` prefix removed from `session-lifecycle.ts:784`; lead date removed from `session-health.ts:14`. The `session-directory.ts:338` state-machine comment was restored byte-for-byte from `c1-g1` (checked programmatically: `MATCH`). Grep for `G1's map\|never a G1\|Lead decision L-a\|lead 2026` in the three directories: zero hits. |
| 3 | Complete interface table | **done** | Full table below: every export of the three modules, complete parameter/return types, defined types, original `c1-g1` implementation, consumers; `identityKeyOf` documented as prefix + SHA. |

## Interface table (book §5)

### `src/core/work-graph/sessions/trusted-context.ts`

**Types it defines**
- `HostActor = { kind: 'human' | 'system'; id: string }` (also re-exported by `session-directory.ts:83`)
- `TrustedContext = { ok: true; scope: WorkspaceScope; actor: HostActor } | { ok: false; rejection: CoreRejection }`
- `OwnedRequest<T> = { ok: true; input: T; requestId: string; expected: readonly VersionPin[] } | { ok: false; reason: string }`

| Export / full signature | Return protocol | Original at `c1-g1` | Consumers |
|---|---|---|---|
| `trustedContext(ctx: CoreCallContext, label: string): TrustedContext` | For a bound project/workspace, a real `AbortSignal` and a Host principal with a human/system actor: `{ ok: true, scope: { projectId, workspaceId }, actor: { kind, id } }`. Otherwise `forbidden` with the caller's `label` in one of four texts. Checks run before any store/Kernel access. | `sessions/session-directory.ts:180` (same body at `session-lifecycle.ts:168`, `session-responsibility-service.ts:111`; the label is the parameter). | `session-directory.ts` (:682, :847, :1074, :1127, :1680); `session-lifecycle.ts` (:444, :622, :1014, :1061, :1205, :1260); `session-responsibility-service.ts` (:264, :532, :681). |
| `ownRequest<T>(request: GraphWrite<T>, what: string): OwnedRequest<T>` | Synchronously `structuredClone`s the whole GraphWrite before the first await; requires non-empty `meta.requestId` and an array `meta.expected`; returns `{ ok: true, input: clone.input, requestId, expected }` or `{ ok: false, reason }` with `${what} requires meta.requestId`, `${what} requires meta.expected`, or `${what} request cannot be isolated from the caller: ${detail}`. | `sessions/session-lifecycle.ts:203` (same at `session-responsibility-service.ts:141`). | `session-lifecycle.ts` (:448, :626, :1021, :1065, :1267); `session-responsibility-service.ts` (:269, :685). (`session-directory.ts` keeps its own generic clone helper at :122, not this export.) |
| `actorIdentity(actor: HostActor): { kind: string; id: string }` | Copy of `kind` and `id`. | `sessions/session-directory.ts:213` (also `session-responsibility-service.ts:154`, `session-lifecycle.ts:381`). | `session-directory.ts` (:140, :144, :147, :726, :898, :1128); used internally by `identityKeyOf` / `fingerprintOf`. |
| `identityKeyOf(prefix: string, actor: HostActor, scope: WorkspaceScope, requestId: string): string` | **`prefix` + `sha256Hex(canonicalJson({ actor: actorIdentity(actor), projectId: scope.projectId, workspaceId: scope.workspaceId, requestId }))`** — prefix plus a SHA, not a bare SHA. | `sessions/session-responsibility-service.ts:157` (same at `session-lifecycle.ts:385`). | `session-directory.ts` (:1710); `session-lifecycle.ts` (:469, :638, :1039, :1078, :1281); `session-responsibility-service.ts` (:290, :700). |
| `fingerprintOf(kind: string, actor: HostActor, scope: WorkspaceScope, payload: Record<string, unknown>, expected: readonly VersionPin[]): string` | Copies each pin to `{ ref, revision }`, sorts by `canonicalOf(ref) ?? ''` (stable, ascending), then `sha256Hex(canonicalJson({ kind, actor: actorIdentity(actor), projectId, workspaceId, ...payload, expected: pins }))`. | `sessions/session-responsibility-service.ts:162` (same at `session-lifecycle.ts:396`). | `session-directory.ts` (:1711); `session-lifecycle.ts` (:470, :639, :1040, :1079, :1282); `session-responsibility-service.ts` (:291, :701). |
| `eventIdOf(identityKey: string, suffix: string): string` | `sha256Hex(`${identityKey}|${suffix}`)`. | `sessions/session-lifecycle.ts:415` (also `session-responsibility-service.ts:177`). | `session-lifecycle.ts` (:397, :585, :975, :1325); `session-responsibility-service.ts` (:445, :817). |

### `src/core/work-graph/sessions/session-links.ts`

**Types it defines:** none.

| Export / full signature | Return protocol | Original at `c1-g1` | Consumers |
|---|---|---|---|
| `readSessionWorkLinks(lookups: RecordLookupPort, projectId: string, sessionId: string, observe?: (readThrough: CommitCursor \| null) => void): Promise<{ ok: true; links: SessionWorkLink[] } \| { ok: false; rejection: CoreRejection }>` | Reads `SESSION_WORK_LINKS_LOOKUP` page by page, `limit: 200`; calls `observe(page.readThrough)` only after a ready page and before that page's per-record capacity/decode checks; more than 2000 links → `capacity` (`Session ${sessionId} exceeds the bounded work-link read budget`); undecodable record → `unavailable` (`session work link ${record.refKey} is damaged: ${reason}`); links in page order. | `sessions/session-directory.ts:1181` (`readSessionLinks`, with observer, returned `{ ok: true, value: links }`) merged with `sessions/session-lifecycle.ts:353` (no observer, returned `{ ok: true, links }`); shared uses the `links` shape and both callers adapt. | `session-directory.ts:1109`; `session-lifecycle.ts:266`. |

### `src/core/work-graph/configuration/workspace-settings-reads.ts`

**Types it defines**
- `Owned = { projectId: string; workspaceId: string; principal: CoreCallContext['principal']; signal: AbortSignal }`
- `WorkspaceSettingsRecords = Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'>`
- `CommittedReceipt = Extract<StoreCommitReceipt, { status: 'committed' }>`
- `WorkspaceReplayTexts = { receipt: string; read: string; disagree: string; damaged: string }`
- `WorkspaceEventDecoder = (event: EncodedDomainEvent) => DecodeResult<{ payload: { value: WorkspaceSnapshot } }>`

| Export / full signature | Return protocol | Original at `c1-g1` | Consumers |
|---|---|---|---|
| `sameActor(left: unknown, right: unknown): boolean` | Both are records and have equal `kind` and `id`. | `configuration/decision-settings-service.ts:35` and `configuration/line-settings-service.ts:54` (identical). | `decision-settings-service.ts`, `line-settings-service.ts`. |
| `ownScope(ctx: CoreCallContext, forbiddenReason: string): Owned \| CoreRejection` | Shape check (ctx record, non-empty projectId/workspaceId, principal and signal records); returns an `Owned` copy or `forbidden` with the owner's exact text. | `decision-settings-service.ts:50` / `line-settings-service.ts:69` (text parameterized). | Both services. |
| `isOwned(value: Owned \| CoreRejection): value is Owned` | `'projectId' in value`. | `decision-settings-service.ts:57` / `line-settings-service.ts:76`. | Both services. |
| `workspacePinProblem(expected: unknown, owned: Owned): { pin: VersionPin } \| CoreRejection` | `meta.expected` must be an array of exactly one object pin with an object `ref`, a safe non-negative revision, and a canonical ref equal to the bound Workspace. On success returns the pin captured from `expected[0]`; malformed input is `invalid` with one of three texts. | `decision-settings-service.ts:66`; `line-settings-service.ts:85` (`boundWorkspacePin`). | Both services. |
| `loadWorkspace(records: WorkspaceSettingsRecords, owned: Owned): Promise<ReadResult<WorkspaceSnapshot>>` | One `readMany([canonicalRefKey(Workspace)])`. Throw → `unavailable` ("the Workspace record could not be read"); non-ready → `not_found` for `not_found`, else `unavailable` with the store reason; missing record → `not_found`; decode failure → `unavailable` (`the Workspace record is damaged: ${reason}`); ready → `{ status: 'ready', value }`. | `decision-settings-service.ts:91` / `line-settings-service.ts:122` (inside each factory; records parameterized). | Both services. |
| `replayWorkspace(records: WorkspaceSettingsRecords, receipt: CommittedReceipt, texts: WorkspaceReplayTexts, decode: WorkspaceEventDecoder): Promise<WriteResult<WorkspaceSnapshot>>` | Receipt must name exactly one non-empty event; `eventAt(receipt.cursor)`; throw → `texts.read`; non-ready → `unavailable` with the store reason; cursor (`String` compare) or `eventId` disagreement → `texts.disagree`; decode failure → `${texts.damaged}${reason}`; success → `{ status: 'committed', value: payload.value, replayed: true, cursor }`. | `decision-settings-service.ts:107` / `line-settings-service.ts:140` (texts and decoder parameterized). | Both services. |

## Tests run

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit -p tsconfig.json`, then `tsconfig.ui.json`) | **pass**, no diagnostics. |
| `npm run check:architecture` (`scripts/check-boundaries.mjs`) | **pass**: `next source boundaries: OK`; WorkGraph/sessions 12 files, configuration 9 files, communication 4 files; only the allowed module edges. |
| `npx vitest run --maxWorkers=2` on the settings tests (`S2C-pins`, `S5-notices`, all six `S2A-notices-*`, `app/S2C-line-routes`, `app/S5-decision-routes`), the Session tests (`R4b-session-directory`, `R4b-session-boundaries`, `A1-session-lifecycle`, `A1-session-discovery`, `A1-session-independent`, `state/S1-responsibility`) and `tests/architecture` | **19/20 files pass; 209/210 tests pass; 461.32 s.** The only failure is `tests/architecture/production-reach.test.ts`, listing exactly `okFalse`, `edgeDeclarationId`, `legacyDeclarationId`, `executionStoreFailureToRejection`, `ownerWriteStoreFailureToRejection`, `ownerReadStoreFailureToRejection` — the six other-group consumers this copy does not contain (allowed by the task). |
| Subagent pre-check A (same six settings files, alone) | 6 files / 67 tests pass, 7.38 s. |
| Subagent pre-check B (same six Session files, alone) | 6 files / 80 tests pass, 2.99 s. |

No failure mentioned `/usr/bin/bwrap`; no bubblewrap-related environmental failure occurred.

## Changed lines

Nine files changed, all under G2's whitelist (`git status`: only these + the untracked `.dsh-ref/`):

| File | Added | Deleted |
|---|---:|---:|
| `communication/decision-source-facts.ts` | 1 | 1 |
| `configuration/decision-settings-service.ts` | 10 | 5 |
| `configuration/line-settings-service.ts` | 1 | 3 |
| `configuration/workspace-settings-reads.ts` | 4 | 3 |
| `sessions/session-directory.ts` | 10 | 9 |
| `sessions/session-health.ts` | 1 | 1 |
| `sessions/session-lifecycle.ts` | 2 | 2 |
| `sessions/session-links.ts` | 1 | 1 |
| `sessions/session-responsibility-service.ts` | 1 | 1 |
| **Rework total vs `c1-g2-r1`** | **31** | **26** (57, net **+5**) |

Against `c1-g1` (G2's first run plus this rework): **+1,279 / −1,809 = 3,088, net −530**. The committed `c1-g2-r1` baseline was +1,267/−1,802 = 3,069, net −535; the two views are not arithmetically additive because hunks that add lines in G2 and delete them in the rework cancel inside the `c1-g1` diff.