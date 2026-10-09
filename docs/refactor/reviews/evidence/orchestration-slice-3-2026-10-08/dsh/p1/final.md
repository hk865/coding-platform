All checks are complete. Here is the part‑1 report.

## FILES CHANGED

New files (`N`), 10 source + 11 tests:
```
N src/contracts/graph-context.ts
N src/contracts/platform-duty.ts
N src/core/agent-runtime/context-assembler.ts
N src/core/agent-runtime/graph-tools.ts
N src/core/agent-runtime/role-profiles.ts
N src/core/work-graph/model/context-input-contracts.ts
N src/core/work-graph/model/graph-context-contracts.ts
N src/core/work-graph/state/context-input.ts
N src/core/work-graph/tasks/context-input-service.ts
N src/core/work-graph/views/graph-context-reader.ts
N tests/state/context-input.test.ts
N tests/work-graph/S3-context-inputs.test.ts
N tests/work-graph/S3-graph-context.test.ts
N tests/runtime/S3-context-assembler.test.ts
N tests/work-graph/S3-prepared-context-admission.test.ts
N tests/work-graph/S3-role-profiles.test.ts
N tests/runtime/S3-graph-tools.test.ts
N tests/app/S3-attention-context.test.ts
N tests/app/S3-graph-routes.test.ts
N tests/scenarios/S3-context-and-inputs.test.ts
N tests/scenarios/S3-query-graph.test.ts
```
Modified write‑scope files (`C`):
```
C src/app/attention-observer.ts
C src/app/core-http-types.ts
C src/app/core-routes.ts
C src/app/host.ts
C src/composition/create-platform.ts
C src/contracts/core/prepared-execution.ts
C src/contracts/role-spec.ts
C src/contracts/validation/role.ts
C src/core/agent-runtime/execution-contracts.ts
C src/core/agent-runtime/execution-preparation.ts
C src/core/agent-runtime/ports.ts
C src/core/agent-runtime/query-preparation.ts
C src/core/agent-runtime/runtime.ts
```
Not touched in part 1 (write‑scope, reserved for part 2): `src/app/runtime-configuration.ts`, `src/core/agent-runtime/execution-driver.ts`, `src/core/agent-runtime/query-execution.ts`, `src/core/agent-runtime/session-discovery-tools.ts`, `src/core/agent-runtime/whiteboard-tools.ts`, `src/core/work-graph/queries/query-execution.ts`, `src/core/work-graph/tasks/execution-entry-service.ts`, `tests/architecture/production-reach-allowlist.json`.

Out‑of‑scope file I had to edit (see UNSPECIFIED): `C src/ui/api/routes.ts`.

Created: `.dsh-scratch/` (probe/baseline/new-test/regression logs only; left in place).

`sha256sum src/contracts/platform-duty.ts` → `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39` (318 bytes, ASCII, one final LF).

## CHECKS

1. `npm run typecheck` — before: exit 0. after: exit 0.
2. `npm run check:architecture` — before: exit 0. after: exit 0.
3. New‑tests command (exact list from the task):
   - after: `Test Files  10 failed | 1 passed (11)`, `Tests  137 failed | 31 passed (168)`.
   - per file (runs / failed / passed): `tests/state/context-input.test.ts` 15/15/0; `tests/work-graph/S3-context-inputs.test.ts` 38/38/0; `tests/work-graph/S3-graph-context.test.ts` 38/38/0; `tests/work-graph/S3-prepared-context-admission.test.ts` 16/2/14; `tests/work-graph/S3-role-profiles.test.ts` 12/6/6; `tests/runtime/S3-context-assembler.test.ts` 15/15/0; `tests/runtime/S3-graph-tools.test.ts` 14/14/0; `tests/app/S3-attention-context.test.ts` 12/7/5; `tests/app/S3-graph-routes.test.ts` 6/0/6; `tests/scenarios/S3-context-and-inputs.test.ts` 1/1/0; `tests/scenarios/S3-query-graph.test.ts` 1/1/0. Total 168 runs.
   - passing ids (part 1): `AD01, AD02, AD03, AD04, AD05, AD06, AD07` (each memory+sqlite), `AT01, AT09, AT10, AT11, AT12`, `RP01, RP03, RP04` (each memory+sqlite), `RT01, RT02, RT03, RT04, RT05, RT06`. 31 runs.
   - failing ids and first failure line:
     - `ST01–ST08` → `Error: not implemented: contextAssemblyProblem`; `ST09–ST15` → `Error: not implemented: declaredInputProblem`
     - `IN01–IN19` (×2) → `Error: not implemented: TaskContextInputPort.readTaskInputs`
     - `GR01–GR05, GR10–GR12, GR19` → `Error: not implemented: GraphContextReadPort.lookGraph`; `GR06–GR09, GR15–GR18` → `Error: not implemented: GraphContextReadPort.findGraph`; `GR13, GR14` → `Error: not implemented: GraphContextReadPort.readContextFacts`
     - `CA01, CA02, CA05–CA09, CA12` → `Error: not implemented: renderContext`; `CA03, CA04, CA10, CA11, CA14, CA15` → `Error: not implemented: ContextAssembler.assembleTask`; `CA13` → `Error: not implemented: ContextAssembler.assembleQuery`
     - `AD08` (×2) → `AssertionError: expected { status: 'committed', …(3) } to match object { status: 'rejected', …(1) }`
     - `RP02, RP05, RP06` (×2) → `Error: not implemented: effectivePlatformDuty`
     - `GT01–GT14` → `Error: not implemented: GraphTools.create`
     - `AT02` → `AssertionError: expected undefined to match object { nodes: [ ObjectContaining{…} ] }`; `AT03` → `AssertionError: expected undefined to match object { change: 'removed', …(2) }`; `AT04` → `AssertionError: expected undefined to deeply equal ArrayContaining{…}`; `AT05` → `Error: not implemented: graphChanges`; `AT06` → `AssertionError: expected undefined to deeply equal { before: 'plan:p1', after: 'plan:p2' }`; `AT07, AT08` → `Error: not implemented: renderAttentionChanges`
     - `SC01` → `AssertionError: expected undefined to be defined`; `SC02` → `AssertionError: expected undefined to match object { status: 'ready' }`
   - No compile, import, fixture/setup errors or timeouts; all 137 failures are stub `not implemented:` or expected‑value mismatches.
4. Regression command (50 files):
   - before (untouched copy): `Test Files  19 failed | 31 passed (50)`, `Tests  63 failed | 1028 passed | 29 skipped (1120)` — matched the task baseline exactly.
   - after: `Test Files  20 failed | 30 passed (50)`, `Tests  64 failed | 1027 passed | 29 skipped (1120)`.
   - per‑file diff against the baseline is empty except `tests/architecture/production-reach.test.ts` (baseline `4 tests` all pass → after `4 tests | 1 failed`). Every other file's per‑file numbers and every other failing test name are unchanged.
   - `production-reach` reports 25 new unreached declarations (no stale allowlist entries): `attention-observer.ts#graphChanges`; `contracts/graph-context.ts#TaskInputPageRequestV1`, `#TaskInputPageV1`; `context-assembler.ts#CONTEXT_FORMAT_VERSION`, `#CONTEXT_SECTION_HEADERS`, `#CONTEXT_SECTION_ORDER`, `#WORK_CONTEXT_PRELUDE`, `#QUERY_CONTEXT_PRELUDE`, `#renderContext`, `#renderAttentionChanges`; `graph-tools.ts#GRAPH_TOOL_NAMES`, `#GraphToolsConfig`, `#LookArgs`, `#createGraphTools`; `role-profiles.ts#PlatformRoleProfileV1`, `#PLATFORM_ROLE_PROFILES`, `#platformRoleProfile`; `context-input-contracts.ts#TaskContextInputPort.readTaskInputs`, `#….readTaskInputPage`; `graph-context-contracts.ts#GraphContextFactsV1`, `#GraphContextReadPort.readContextFacts`, `#….readAttentionFacts`; `context-input.ts#contextAssemblyProblem`, `#declaredInputProblem`, `#effectivePlatformDuty`.

## UNSPECIFIED

- `src/ui/api/routes.ts` is **not** in the write scope but had to change: its `ROUTE_LABELS: Record<CoreRouteSuffix,string>` is total, so adding `graph/look`/`graph/find` to `CoreRouteSuffix` makes `tsconfig.ui` fail until those two labels exist. I added two label strings only; `npm run typecheck` requires it.
- Per B(d)'s parenthetical (“`CoreRouteSuffix`, the only declaration” in `core-http-types.ts`) I deliberately did **not** add `GraphLookBody/Response`/`GraphFindBody/Response`; the existing per‑route body/response pattern would add 4 unreached types, and rule 13 forbids new allowlist entries.
- `platformRoleProfile` is implemented as the pure‑data lookup+clone (task A says the five profiles are literal data written now), not stubbed. The `behaviorSkillId` column is ambiguous (“追加职责行为资源”); I used `platform-work`, `platform-secretary`, `platform-adviser`, `platform-scribe`, `platform-reviewer`. `PLATFORM_ROLE_PROFILES` is an extra non‑spec export.
- Added exports not named by spec §4.3/§4.2: `CONTEXT_FORMAT_VERSION`, `CONTEXT_SECTION_HEADERS`, `CONTEXT_SECTION_ORDER`, `WORK_CONTEXT_PRELUDE`, `QUERY_CONTEXT_PRELUDE` (task A requires the literal section names/headers/format version now).
- Invented type name `GraphContextReaderDependencies` (spec §4.1 gives the deps shape inline).
- `TaskInputPageRequestV1`/`TaskInputPageV1` are placed in `contracts/graph-context.ts` (task A: “Pure DTOs live in `src/contracts/graph-context.ts`”), whereas spec §3.4 shows them in the service/owner block.
- Added `AttentionScannerDependencies.readAttentionGraph?` and wired it in `host.ts` from `platform.runtime.readAttentionGraph`; the scanner body and `platform.runtime` fallback are unchanged in part 1.
- `HostSettingsStoredModel` has no `revision` field (`src/app/host-settings.ts:105`); the §4.6 revision formula uses `settingsModelBinding(selected).revision` (`src/app/host.ts:533`).
- Spec §1.2 says the “四个旧读工具” are replaced, while §4.6 says “移除其中三个旧读名称”; the current `localWorkbenchGrant` list contains exactly three read names (`find_related_sessions`, `read_session_card`, `query_task_graph`), which I removed.
- Rule 13: a probe (`npx vitest run tests/architecture/zz-reach-probe.test.ts`, file since deleted) printed `PROBE_STALE_COUNT 0`; no `kept-for` slice‑3 entry became reached, so the allowlist is unchanged (the real test cannot print its stale list because its unreached assertion fails first).
- Two spec/harness gaps surfaced by the scenario tests: the only harness (`tests/scenarios/harness.ts:600`) seeds the AG2b graph with no tA/tB edge, no `old-A`, and its binding does not grant `look_graph`/`find_graph`, so SC01/SC02 cannot pass without a harness change or spec reconciliation.
- `src/core/agent-runtime/session-discovery-tools.ts` and `whiteboard-tools.ts` are in the write scope but unchanged in part 1, as the task says.

## NOTES

- The `src/ui/api/routes.ts` edit is required by `npm run typecheck` but is outside the declared 42‑file set; the lead's file‑list check should treat it as an approved exhaustive‑union companion edit.
- The Host `localWorkbenchGrant` change is part 1 and did not regress any of the 50 baseline files (all existing tests use explicit run bindings).
- Part 2 must wire the 25 unreached declarations (assembler, tools, role profiles, guards) to make `production-reach` pass without adding allowlist entries.
- The 11 test files are frozen‑shape but several have fixture gaps part 2 must satisfy inside the same files only if the lead permits: IN11/IN12 (Round chain), IN14 (decision application), IN19 and GR17/GR18 (canonical QueryJob/QueryRun seeds), AT02–AT06 (observer must carry `details`/`changes`).
- No commits, no package installs, no servers/models; scratch logs are under `.dsh-scratch/`.