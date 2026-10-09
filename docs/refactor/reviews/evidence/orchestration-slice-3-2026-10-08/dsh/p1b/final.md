All checks pass. Here is the round‑2 report.

## FILES CHANGED

Only the 11 new test files (all `C` in this round; no `src/`, helper, config or `tests/architecture/production-reach-allowlist.json` change — verified no `src/**.ts` is newer than the first round‑2 test edit):
```
C tests/state/context-input.test.ts
C tests/work-graph/S3-context-inputs.test.ts
C tests/work-graph/S3-graph-context.test.ts
C tests/work-graph/S3-prepared-context-admission.test.ts
C tests/work-graph/S3-role-profiles.test.ts
C tests/runtime/S3-context-assembler.test.ts
C tests/runtime/S3-graph-tools.test.ts
C tests/app/S3-attention-context.test.ts
C tests/app/S3-graph-routes.test.ts
C tests/scenarios/S3-context-and-inputs.test.ts
C tests/scenarios/S3-query-graph.test.ts
```
`src/contracts/platform-duty.ts` unchanged: `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`. `src/ui/api/routes.ts` keeps exactly the two accepted label lines.

## CHECKS

1. `npm run typecheck` — exit 0.
2. `npm run check:architecture` — exit 0 (`next source boundaries: OK`).
3. `npx vitest run <the 11 files>` — `Test Files  10 failed | 1 passed (11)`, `Tests  141 failed | 27 passed (168)`.
   - per file (runs/failed/passed): `context-input` 15/15/0; `S3-context-inputs` 38/38/0; `S3-graph-context` 38/38/0; `S3-prepared-context-admission` 16/2/14; `S3-role-profiles` 12/8/4; `S3-context-assembler` 15/13/2; `S3-graph-tools` 14/14/0; `S3-attention-context` 12/11/1; `S3-graph-routes` 6/0/6; `S3-context-and-inputs` 1/1/0; `S3-query-graph` 1/1/0. 116 cases, 168 runs.
   - passing ids: `AD01, AD02, AD03, AD04, AD05, AD06, AD07` (×2), `AT01`, `CA03`, `CA04`, `RP03, RP04` (×2), `RT01, RT02, RT03, RT04, RT05, RT06`.
   - failing ids → first failure line (memory and SQLite are identical):
     - `ST01–ST08` `Error: not implemented: contextAssemblyProblem`; `ST09–ST15` `Error: not implemented: declaredInputProblem`
     - `IN01–IN19` `Error: not implemented: TaskContextInputPort.readTaskInputs`
     - `GR01–GR05, GR09–GR12, GR19` `Error: not implemented: GraphContextReadPort.lookGraph`; `GR06–GR08, GR15–GR18` `Error: not implemented: GraphContextReadPort.findGraph`; `GR13, GR14` `Error: not implemented: GraphContextReadPort.readContextFacts`
     - `CA01, CA02, CA05, CA06, CA07, CA08, CA12` `Error: not implemented: renderContext`; `CA09, CA10, CA11, CA14` `Error: not implemented: ContextAssembler.assembleTask`; `CA13` `Error: not implemented: ContextAssembler.assembleQuery`; `CA15` `AssertionError: expected { status: 'ready', value: { …(4) } } to match object { status: 'rejected', …(1) }`
     - `AD08` `AssertionError: expected { status: 'committed', …(3) } to match object { status: 'rejected', …(1) }`
     - `RP01` `Error: not implemented: ContextAssembler.assembleTask`; `RP02, RP05, RP06` `Error: not implemented: effectivePlatformDuty`
     - `GT01–GT04, GT06–GT09, GT13, GT14` `Error: not implemented: GraphTools.create`; `GT05` `AssertionError: expected [] to have a length of 1 but got +0`; `GT10` `AssertionError: expected 'error' to be 'success' // Object.is equality`; `GT11` `AssertionError: expected [ 'code_index', 'cpp_index', …(7) ] to deeply equal ArrayContaining{…}`; `GT12` `AssertionError: expected 'error' to be 'success' // Object.is equality`
     - `AT02` `AssertionError: expected undefined to match object { nodes: [ ObjectContaining{…} ] }`; `AT03` `AssertionError: expected undefined to match object { change: 'removed', …(2) }`; `AT04` `Error: unexpected legacy plan read`; `AT05` `AssertionError: expected undefined to be 'graph_delta' // Object.is equality`; `AT06` `AssertionError: expected undefined to deeply equal { before: 'plan:p1', after: 'plan:p2' }`; `AT07–AT10, AT12` `Error: not implemented: renderAttentionChanges`; `AT11` `Error: unexpected legacy plan read`
     - `SC01` `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality`; `SC02` `AssertionError: expected undefined to be defined`
   - No compile/import/fixture/setup error and no timeout; every failure is a stub `not implemented:` or an expected-value mismatch.

## UNSPECIFIED

Fixes I could not make exactly as asked (file:line as reported by the subagent, reason):
- `tests/work-graph/S3-context-inputs.test.ts:564` IN05: a `RunSnapshot` whose read ref differs from its canonical refKey cannot be persisted (`src/core/record-store/record-codec.ts:296`, `record-readers.ts:199`), so the “owner ref loads a different Run” mismatch is injected at the fixture authority seam; the real applicability guard (`materials/applicability.ts:70`) still rejects.
- `tests/work-graph/S3-context-inputs.test.ts` IN11/IN12: rounds are seeded via the real round codec+store, not `createEvidenceService.openVerification/finalizeChecks` (that needs the full B2 execution/workspace/check-runner fixture and `/usr/bin/bwrap`, absent here).
- `tests/work-graph/S3-context-inputs.test.ts` IN16: the §5.1 fixture has no canonical TaskLease/claim for runB; if part 2’s owner literally requires the claim, a claim seed must be added.
- `tests/work-graph/S3-context-inputs.test.ts` IN14: `decisionApplications` answers `[]` (no application) rather than `null`.
- `tests/work-graph/S3-context-inputs.test.ts` IN19: uses `semantic_query` (`query-job-service.ts:703` rejects `initial_coordination` because the Goal has an active Plan).
- `tests/work-graph/S3-graph-context.test.ts:580/648/663` GR17/GR18/GR19: Kernel increments are not observable — `createGraphContextReader` has no Kernel dependency; ledger commits, material opens and raw-body reads are asserted instead.
- `tests/work-graph/S3-graph-context.test.ts:909` GR11: the reader deps expose no workspace/file port; material `openArtifact` and raw-body reads are asserted 0.
- `tests/work-graph/S3-graph-context.test.ts:246/643` GR14: a damaged catalog body cannot be committed (the store validates with the same codec), so the stored catalog record is corrupted at its exact key on read while the real catalog owner is kept.
- `tests/work-graph/S3-graph-context.test.ts` fixture: did not import `tests/helpers/task-claim-fixture.ts` (its fixed `r4c-claim-*` scope ids are incompatible with §5.1 and no new file may be created); used the same real `TaskClaimPort` path.
- `tests/runtime/S3-context-assembler.test.ts:757` CA12: anomalies feed the reminders rows, but the row reaches `renderContext` with the real `renderContinuationBriefZh` suffix, not `assembleTask` (the continuation-basis chain is unavailable in part 1).
- `tests/runtime/S3-context-assembler.test.ts:781` CA13: uses `assembleQuery` with formal `QueryPreparationFacts`, not `createQueryPreparation` (which would need the full ~20‑field `RuntimeExecutionDependencies`).
- `tests/runtime/S3-context-assembler.test.ts:813` CA15: part 1’s `createExecutionPreparation` still ignores its `_contextAssembler`, so the test fails as `ready` instead of `unavailable` (expected-value mismatch, intended to pass after part‑2 wiring).
- `tests/runtime/S3-context-assembler.test.ts:742` CA11: “preparation is ready” is asserted on the assembly result, not the service-level prepare.
- `tests/runtime/S3-context-assembler.test.ts:716` CA09: pins the spec-fixed parts (body absent, `另有 1 条`, `omitted===1`, kept selection/ref) rather than the full inputs-row string.
- `tests/runtime/S3-graph-tools.test.ts:409` GT06: not driven through the driver’s proxy (the proxy is driver-internal/not exported and `createTargetPlatform` closes over the real RT8 with no injection); pins the adapter’s pass-through of the proxy’s `forbidden`.
- `tests/runtime/S3-graph-tools.test.ts:423` GT07: no formally changeable declaration + prepare-time manifest exists in part 1; asserts the real owner’s fixed historical source/usage.
- `tests/runtime/S3-graph-tools.test.ts` GT05/GT12: the exact Kernel per-call signal and per-tool-call commit count are not observable from the composition surface; asserts an `AbortSignal` instance, commit aggregates and a Workflow spy.
- `tests/runtime/S3-graph-tools.test.ts` GT11: the spec shorthand “send/note/shell” has no `note` tool; the real writer names `send_session_message`/`write`/`shell` are used.
- `tests/work-graph/S3-prepared-context-admission.test.ts` AD02: part 1’s `ExecutionEntryDependencies` (`model/execution-entry-contracts.ts:145-156`) has no input resolver; the counter wraps the only resolver `authorizeRuntimeEntry` reaches, `roles.resolveRoleBindingFacts` (`tasks/execution-entry-service.ts:581`). Run id `runB` was produced by constructing the real claim owner with a deterministic first `newId`, since `tests/helpers/task-claim-fixture.ts:319` does not expose `newId`.
- `tests/work-graph/S3-role-profiles.test.ts`: §5.1 Goal `g`/Plan `p1` cannot be used (the real role helpers read no Goal/Plan record); Project+Workspace and revision 7 are used. “Session role” is the immutable `RoleConfigurationRef` pin, since this fixture wires no Session directory.
- `tests/app/S3-attention-context.test.ts:184-235` AT01/AT09/AT10/AT12: the real HTTP Host exposes no seam for `requestId`, `markDelivered`/`markProcessed` counts or the send retry (`src/app/host.ts:1085,1066,1097,1091-1100`); the rows drive the real observer + real `renderAttentionChanges` through an in-test `createHostAttention` reproducing `host.ts:1075-1101`, with the mailbox as the only fake.
- `tests/scenarios/S3-context-and-inputs.test.ts` / `S3-query-graph.test.ts`: `tests/scenarios/harness.ts:660` `openComposition`, `:131` `checksConfiguration`, `:654` `workflowBinding` are private, and `tests/helpers/AG2b-collaboration-fixture.ts:166` (`ag2bChecksConfiguration`, `:174-175`) and `:342` (`seedAG2bWorkGraphThrough`, `:307/:370` `ag2bPlanDraft`) hard-code the AG2b scope/plan, so the §5.1 set-up is written explicitly in-test. No public owner port seeds a completed `RunSnapshot`, so runA is inserted as the same `snapshots` row the claim owner writes (`src/core/record-store/sqlite-record-store.ts:216`) and `old-A` is stored through the real material service.

## NOTES

- Two subagents transiently wrote verification output to `/tmp` (outside the write scope) and deleted it immediately; no repository file was affected. I did not, and the repo tree contains only the scratch logs under `./.dsh-scratch/`.
- The round‑1 source changes are untouched: no `src/**.ts` mtime is newer than the round‑2 test edits, and no file outside the 11 tests was added.
- `AT04`/`AT11` now fail with `Error: unexpected legacy plan read`, which is a deliberate fail-fast guard in the test (not a stub); after part 2 the scanner must read through `readAttentionGraph` and never touch the legacy `plans`/`architecture` ports.
- `GT05/GT10/GT11/GT12` and `SC01/SC02` fail on assertions rather than `GraphTools.create` because part 1’s drivers never register the tools; they are written to go green once part 2 registers/grants them.
- All 116 case ids, titles and the M/S doubling are preserved; 168 runs. No part 2 work started.