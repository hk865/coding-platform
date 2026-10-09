All corrections are complete and the checks are green. Here is the part 1 report (both runs).

## FILES CHANGED

`N` (new):
```
N src/contracts/platform-duty.ts
N src/contracts/core/session-archive.ts
N src/contracts/session-anomaly.ts
N src/core/work-graph/model/session-facts-contracts.ts
N src/core/work-graph/sessions/session-responsibility-service.ts
N src/core/work-graph/state/session-anomaly.ts
N src/core/work-graph/state/session-responsibility.ts
N src/core/work-graph/tasks/session-anomaly-codecs.ts
N src/core/work-graph/tasks/session-anomaly-service.ts
N src/core/work-graph/tasks/session-facts.ts
N src/core/work-graph/tasks/session-provenance-facts.ts
N src/core/agent-runtime/session-anomaly-facts.ts
N src/business/workflow/session-archive.ts
N src/business/workflow/session-maintenance.ts
N src/business/workflow/task-order.ts
N tests/state/S1-session-archive.test.ts
N tests/state/S1-responsibility.test.ts
N tests/state/S1-anomaly.test.ts
N tests/state/S1-message-routing.test.ts
N tests/state/S1-dispatch.test.ts
N tests/state/S1-archive-rework.test.ts
N tests/business/S1-task-order.test.ts
N tests/work-graph/S1-codecs-indexes.test.ts
N tests/work-graph/S1-session-facts.test.ts
N tests/work-graph/S1-provenance.test.ts
N tests/work-graph/S1-responsibility.test.ts
N tests/work-graph/S1-archive-owner.test.ts
N tests/work-graph/S1-anomaly-owner.test.ts
N tests/work-graph/S1-wait-disposal.test.ts
N tests/work-graph/S1-requeue.test.ts
N tests/work-graph/S1-dispatch-guards.test.ts
N tests/runtime/S1-archive-files-brief.test.ts
N tests/business/S1-session-maintenance.test.ts
N tests/business/S1-archive-flow.test.ts
N tests/app/S1-session-routes.test.ts
N tests/scenarios/S1-archive-restart.test.ts
N tests/scenarios/S1-wait-copy-retirement.test.ts
N tests/runtime/S1-routed-replies.test.ts
```
`C` (modified):
```
C src/contracts/core/session.ts
C src/contracts/ledger.ts
C src/contracts/continuation-brief.ts
C src/contracts/dispatch.ts
C src/contracts/task-requeue.ts
C src/core/work-graph/model/session-contracts.ts
C src/core/work-graph/model/claim-contracts.ts
C src/core/work-graph/model/execution-read-contracts.ts
C src/core/work-graph/model/communication-contracts.ts
C src/core/work-graph/sessions/session-record-codecs.ts
C src/core/work-graph/sessions/lifecycle-contracts.ts
C src/core/work-graph/sessions/lifecycle-record-codecs.ts
C src/core/work-graph/sessions/session-lifecycle.ts
C src/core/work-graph/sessions/session-directory.ts
C src/core/work-graph/sessions/message-record-codecs.ts
C src/core/work-graph/tasks/claim-record-codecs.ts
C src/core/work-graph/tasks/claim-service.ts
C src/core/work-graph/tasks/requeue-service.ts
C src/core/work-graph/tasks/plan-readers.ts
C src/core/work-graph/tasks/run-state-service.ts
C src/core/work-graph/tasks/execution-entry-service.ts
C src/core/work-graph/queries/query-record-codecs.ts
C src/core/work-graph/queries/query-execution.ts
C src/core/work-graph/state/session-availability.ts
C src/core/work-graph/state/message-machine.ts
C src/core/work-graph/state/task-failure.ts
C src/core/work-graph/state/task-machine.ts
C src/core/work-graph/state/run-machine.ts
C src/core/work-graph/persistence/execution-entry-codecs.ts
C src/core/work-graph/communication/mailbox-service.ts
C src/core/agent-runtime/session-operations.ts
C src/core/agent-runtime/execution-preparation.ts
C src/core/agent-runtime/continuation-brief-assembly.ts
C src/core/agent-runtime/execution-inputs.ts
C src/core/agent-runtime/ports.ts
C src/core/agent-runtime/runtime.ts
C src/business/workflow/contracts.ts
C src/business/workflow/ports.ts
C src/business/workflow/workflow.ts
C src/business/workflow/consultation.ts
C src/composition/create-platform.ts
C src/app/core-http-types.ts
C src/app/core-routes.ts
C src/app/startup-reconcile.ts
C src/app/collaboration-driver.ts
C tests/architecture/state-writes.test.ts
C tests/state/invariants.ts
C tests/state/session-availability.test.ts
C tests/state/message-machine.test.ts
C src/core/work-graph/queries/contracts.ts   (lead added to scope)
C src/ui/api/routes.ts                        (out of scope; see UNSPECIFIED)
```
`sha256sum src/contracts/platform-duty.ts` → `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`.

## CHECKS

**`npm run typecheck`** — before: exit 0; after: exit 0 (`tsc --noEmit -p tsconfig.json` and `... tsconfig.ui.json`). **`npm run check:architecture`** — before: exit 0/`next source boundaries: OK`; after: exit 0/`next source boundaries: OK`.

**New tests** — 23 files, **212 runs**, 203 failed | 9 passed. Per-file runs equal the table: session-archive 15, responsibility(state) 6, anomaly 9, message-routing 3, dispatch 13, archive-rework 4, task-order 6, codecs-indexes 16, session-facts 14, provenance 12, responsibility(work-graph) 12, archive-owner 16, anomaly-owner 8, wait-disposal 14, requeue 18, dispatch-guards 12, archive-files-brief 6, session-maintenance 9, archive-flow 7, session-routes 2, archive-restart 6, wait-copy-retirement 1, routed-replies 3. There is **no `unregistered schema`, no other setup error, no compile error and no timeout**: every failure's first line is either `Error: not implemented: …` (in a setup given or the action) or an assertion on new behaviour.

Passing ids (9 runs), each an unchanged old behaviour:
- `UT06` — an occupied Session is busy before link/wait failures (old guard order).
- `UT08` — reactivating an available archived Session clears `archivedAt` and keeps its health (old SES-14).
- `UT33` — an automatic retired interruption keeps the prior count within its cap (old classify/count, no exemption).
- `UT34` — a forged archive origin does not exempt an ordinary run failure (old `run_failed` classification).
- `UT35` — an automatic retired interruption keeps the earlier human pause fence (old fence).
- `SV03` (memory and sqlite) — the old-format Outbox bytes decode and IDX-S2 returns the original `claim.runRef` with no backfill write (old compatibility).
- `IT17` — the 11 new suffix rows carry the exact kind/binding/owner and the real bindings reach the named owner (part-1 route-table data; no part-2 behaviour).
- `IT04` — loading the unchanged old manifest keeps marker/digest/text and adds no `anomalies` section (old brief bytes).

Failing ids by first line (every `SV`/`UT` id listed runs on both backends):
```
not implemented: SessionLifecyclePort.requestSessionArchive ==> IT03 IT05 IT28 IT29 IT30 SV21 SV22 SV23 SV24 SV25 SV26 SV27 SV28 SV29 SV30 SV31 SV32 SV33 SV34 SV35 SV36 SV37 SV38 SV41 SV48 SV49 SV52 SV54 SV55 SV56 SV57 SV59
not implemented: SessionArchivePort.archiveLine ==> IT12 IT13 IT14 IT15 IT16 IT26 IT27 SV60 SV61
not implemented: WorkflowPort.archiveLine ==> IT19 IT20 IT21 IT22 IT23 IT24 IT25
not implemented: SessionMaintenancePort.maintainSessions ==> IT10 IT11 IT33 IT34
not implemented: SessionResponsibilityPort.closeTerminalResponsibility ==> IT06 IT07 IT08 IT09 IT31 SV19 SV20
not implemented: SessionResponsibilityPort.transferSessionResponsibility ==> SV16 SV17 SV18 SV47
not implemented: ArchiveChangedFilesReader.readArchiveChangedFiles ==> IT01 IT02 IT32
not implemented: LegacySessionProvenancePort.deriveLegacySessionProvenance ==> SV15 SV45 SV46
not implemented: SessionDirectoryPort.backfillSessionProvenance ==> SV12 SV13
not implemented: SessionFactsPort.readSessionFacts ==> SV06 SV07 SV08 SV09 SV10 SV53
not implemented: SessionFactsPort.listSessionExecutions ==> SV11
not implemented: SessionFactsPort.findSessionSuccessors ==> SV14
not implemented: encodeSessionAnomalyAnchor ==> SV02
not implemented: decodeSessionAnomalyAnchor ==> SV43
not implemented: executorArchiveDue ==> UT54 UT55 UT56
not implemented: newSessionAnomalyAnchorRecord ==> UT19 UT20 UT21 UT22 UT42 UT48
not implemented: transitionSessionAnomaly ==> UT16 UT17 UT18
not implemented: transitionResponsibility ==> UT11 UT12 UT13 UT14 UT15 UT51
not implemented: orderTasksByDependency ==> UT36 UT37 UT38 UT39 UT40 UT41
not implemented: sessionDispatchAdmissionProblem ==> UT26 UT27 UT28 UT29 UT30 UT31 UT43 UT44 UT45 UT46 UT47 UT52 UT53
not implemented: transitionSession archive_requested ==> UT01 UT02 UT03
not implemented: transitionSession archive_request_released ==> UT49 UT50
not implemented: transitionSession legacy_provenance_backfilled ==> UT09 UT10
not implemented: transitionMessage archive_wait_disposed ==> UT23 UT24
not implemented: nextSessionMessageRecord archive_wait_disposed ==> UT25
AssertionError: expected undefined to be null ==> SV01
AssertionError: expected [] to have a length of 1 but got +0 ==> SV04
AssertionError: expected 'decoded' to be 'invalid' ==> SV05 SV42 SV44
AssertionError: expected { ok: true, next: {…}, …} to deeply equal { ok: true, next: {…}, …} ==> UT05
AssertionError: expected { ok: true, next: {…}, …} to match object { ok: false, …} ==> UT04 UT07
AssertionError: expected { row: 'FC-9', kind: 'class', …} to match object { row: 'S1-FC-ARCHIVE', …} ==> UT32
AssertionError: expected { status: 'committed', …} to match object { status: 'rejected', code: 'busy' } ==> SV40 SV51
AssertionError: expected { status: 'committed', …} to match object { status: 'rejected', …} ==> SV39 SV58
AssertionError: expected { status: 'committed', …} to match object { Object (status, value) } ==> SV50
AssertionError: sessions/archive-line: expected 500 to be 200 ==> IT18
```

**Regression command** — before: exit 1, `Test Files 5 failed | 17 passed (22)`, `Tests 13 failed | 519 passed (532)`. After: exit 1, `Test Files 8 failed | 14 passed (22)`, `Tests 30 failed | 511 passed (541)` (541 = 532 + 9 new matrix rows). Only the four allowed files differ: `production-reach` 4/0→4 tests|1 failed; `session-availability` 125/0→128 tests|7 failed; `message-machine` 93/0→99 tests|9 failed; `state-writes` unchanged 19/0. All other 18 files match the baseline, including the 13 pre-existing `/usr/bin/bwrap` scenario failures. Failing titles in the differing files: production-reach `reaches every declaration from a production entry point, or allowlists it with its reason`; session-availability `createSessionRecord > writes today's SES-01 literal …`, `SES-11/SES-14 > reactivation of an unavailable Session is refused with unavailable (decision 38)`, and the matrix rows `'session_created'`, `'session_reactivated'`, `'archive_requested'`, `'archive_request_released'`, `'legacy_provenance_backfilled'`; message-machine the six `archiveDisposed` matrix cells, `is pure: the input state and context are not mutated`, the `I-8` property, and `§10.4 … I-8`.

## UNSPECIFIED

Rows whose given could not be built through a real public entry (reason):
- `SV50`, `SV59` — the intermediate prior-chain Runs cannot be *entered* (a requeue Run needs a Kernel continuation brief that hangs in the B2 fixture), so they are ended through the real `submitControl` RUN-09 path; SV59's final Run fact is corrected to `crashed` by a raw write so retirement does not exempt an ordinary `run_failed`.
- `SV06`, `SV53` — the QueryRun pointer is seeded by raw write because the fixture Goal already has an accepted Plan so the R5b.1 submit cannot run; SV53's is a genuinely old-format Query pointer.
- `IT15` — the `outcome_unknown` Run is written through the real codec (no public entry exists for that fact).
- `IT01`/`IT02`/`IT32` — Kernel turns are recorded through the real `recordExecutionEntered`; IT01's `possible:['b']` still needs part-2 to derive the path of an unobserved failed edit (the Kernel records it with `changedPaths:[]`).
- `SV19` — the terminal satisfied proof runs on the R3e v2 evidence fixture because the base plan's `test` requirement kind has no registered check.
- G4 invariant checker runs on the SQLite rows only; memory rows have no `readInvariantWorld` window.
- `tests/business/S1-session-maintenance.test.ts` keeps one memory backend for the required 9 runs; its `invariantsHold` helper is a no-op there (same convention as `S1-archive-flow.test.ts`).
- `UT34` — in pure state the only way a system requeue of `run_failed` becomes `forbidden` is the `human_only` fence (`src/core/work-graph/state/task-failure.ts:503` area); the forged archive origin cannot itself produce the refusal, so the test uses the related archive-cancel fence and asserts the `run_failed`+no-exemption classification.
- `SV60`/`SV61` use the real `createRunControlService`; `deliverControl` (a `RuntimeExecutionPort` callback) is not in `SessionArchiveDependencies`, so only the durable-intent side is asserted.

Spec/code disagreements found (file:line):
- §6 F22 lists only `queries/query-execution.ts` for `QueryExecutionDependencies.sessionFacts?`, but the type is declared at `src/core/work-graph/queries/contracts.ts:225` (lead added the file to scope).
- §6 F87/L5 adds the 11 suffixes to `CoreRouteSuffix`, but the UI label table `src/ui/api/routes.ts:13` is `Record<CoreRouteSuffix, string>` and `tsconfig.ui.json` typechecks it, so it had to gain 11 labels (out-of-scope edit accepted).
- §2.9 says each new eventType is registered once with `schemaVersion: 1`; `SESSION_LIFECYCLE_RECORD_SCHEMAS`/`SESSION_MESSAGE_RECORD_SCHEMAS` do not yet register `SessionArchiveRequested`, `SessionArchiveRequestReleased`, `SessionProvenanceBackfilled`, `SessionResponsibilityChanged`, `ArchiveWaitDisposed` (part 2).
- §5.6 says stage 1 writes “real compatibility codecs”, but the task A/B rules forbid changing existing bodies, so `decodeSessionRecord`/`decodeSessionMessageRecord`/`decodeTaskRequeueSnapshot` still return `undefined` for the new optional fields (SV01/SV05/SV42/SV44 fail as expected).
- §6 F83 `persistence/execution-entry-codecs.ts:inputBindingProblem` has no type declaration to extend (`value: unknown`); I added the allowed key `anomalyAnchorRefs` and a stub `anomalyAnchorRefsProblem`.
- §4.3 `workflow.ts:orderTasks` is not wired to `orderTasksByDependency` (that is behaviour, part 2), so `orderTasksByDependency` and 100 other new declarations are unreachable in production-reach (list in `.dsh-scratch/unreachable.txt`).

## NOTES

- Two files outside the original 87-file scope were touched: `src/core/work-graph/queries/contracts.ts` (lead-authorized) and `src/ui/api/routes.ts` (11 labels, required by the UI typecheck).
- All 203 new-test failures are `not implemented:` stubs (setup given or action) or assertions on new behaviour; no fixture/compile/timeout failure remains.
- Regression differs from the baseline only in the four allowed files; the delta is the 9 extended matrix rows and 17 failures (production-reach 1, session-availability 7, message-machine 9).
- Production wiring added: `createQueryExecution({…, sessionFacts})` and `SESSION_ANOMALY_RECORD_SCHEMAS` records/events/lookups in `create-platform.ts`; nothing else in `src/` changed in this correction.
- The interrupted run left 12 files half-done; each was rebuilt by a fresh subagent, and the session-maintenance file was brought back from 18 to the required 9 `it`s.
- `.dsh-scratch/` keeps the baseline run, the correction brief, the final typecheck/new-test/regression logs and the grouped failure list; it is deleted in part 2.