# Group CU — duty resolver in maintenance (DU09), context assembly (GC03, GC04, AN08), start refusal (WF01, WF02)

Checkout: `D:/cxt/impl-w1-fxCU`. Read `D:/cxt/impl-w1-fx-msg/RULES.md` first.

## Your files (only these two)

- `tests/helpers/WP1-units-fixture.ts` (new)
- `tests/wp1-smoke/units.smoke.test.ts` (new, temporary)

## Rows (spec §5.2)

- DU09, file `tests/composition/WP1-session-duty.test.ts` (memory).
- GC03, GC04, AN08, file `tests/runtime/WP1-context-assembly.test.ts`.
- WF01, WF02, file `tests/business/WP1-start-refusal.test.ts`.
(The other rows of these files — DU01–DU08 — use plain doubles; the test writer builds them, not you.)

Read the spec: §0 L2, L4, L5, L6, L9, §2.1, §2.4, §3 rows W1-WF-01 and W1-DUTY-01, §4.1, §4.3, §5.1, the rows above, §7
rules 7, 8. Code: `src/composition/create-platform.ts` (`defaultSessionDutyResolver` 204, `sessionDuty` 992),
`src/business/workflow/session-maintenance.ts` (`dutyOf` 391, executor branch, `finishedAtProof` 173,
`closeTerminalResponsibilities`), `src/business/workflow/ports.ts` (`SessionDutyResolver`, `WorkflowHostConfiguration`),
`src/core/work-graph/` role configuration service (`createRoleConfigurationService`, `installRoleSpec`/`readRoleSpec`,
RoleSpec content `platformDuty`), `src/core/agent-runtime/context-assembler.ts` (`goalPayload` 415,
`optionalRowsFromExtensions` 533, `assembleTask` 922, `assembleQuery` 998, `sortedSources` 148),
`src/business/workflow/workflow.ts` (`performStep` `start` 1353, `prepareStep` 117), and the existing tests
`tests/business/S1-session-maintenance.test.ts` (executor idle rows, how terminal closes carry `finishedAt`),
`tests/runtime/S3-context-assembler.test.ts` (its facts doubles, CA rows, CA14), `tests/business/R5c-workflow.test.ts`
and `tests/business/A2-workflow-result-mapping.test.ts` (Workflow doubles that perform one step).

## What the helper must provide

1. **DU09 `openDutyMaintenanceFixture(sessionDuty)`** (memory, real records): install two RoleSpecs through the REAL
   `createRoleConfigurationService` — R1 whose content has `platformDuty: 'secretary'`, R2 with no `platformDuty`; a
   trusted Work configuration with two bindings whose `sessionRole` pin R1 and R2 (`{ kind: 'role_spec', pin }`);
   Session S1 (role pinned to R1) and S2 (role pinned to R2), each responsible for its own Task; both Tasks satisfied
   at t0 and the responsible links closed as terminal with `finishedAt = t0` (through the real owners, the way the S1
   maintenance rows reach that state); both Sessions unoccupied, not waiting, no module link, no archive request. The
   builder takes `sessionDuty: WorkflowDependencies['sessionDuty']` (the test passes `createSessionDutyResolver({
   readRoleSpec, configuration })`), and returns: the maintenance entry to call at now = t1 (a Workflow or maintenance
   service built with that `sessionDuty` and a clock at t1), the ctx and workspace scope, S1/S2 refs, the role
   configuration service's `readRoleSpec` (bound) and the configuration object (so the test can build the resolver),
   and a read helper for a Session's lifecycle.
2. **Assembler fixture `assemblerWithFacts(options)`** for GC03/GC04/AN08: the REAL `createContextAssembler` (or the
   Runtime piece that calls it) with a graph-context double whose `readContextFacts` returns facts you choose, built
   like `tests/runtime/S3-context-assembler.test.ts` does. Options: the facts' `sources` (GC03: a Goal `record` source of
   this Goal with `digest: null`, a Plan source, a Run source), the facts' `extensions` (AN08: anomalies `available`
   with one row of the AN01 shape — `key:'anomaly:'+refKey`, `node:{kind:'task',ref,planRef}`, the §4.2 text,
   `sources:[{kind:'record',ref:<anchor ref>,revision:1,digest:null}]` — and notes `not_implemented`), the budget (AN08:
   4096). Return: functions to call `assembleTask` (a Work claim) and `assembleQuery` (a Query) with the same facts, the
   facts object (so the test computes `goalContextDigestV1(facts.goal)`), the Goal/objective/workspace values and the
   Run's workspace revision used in the Goal section text (GC03 expects the section text exactly
   `## Goal\ngoal: g\nobjective: <objective>\nworkspace: w@<rev>\nautonomy: (not_implemented)\ncurrent understanding: (not_implemented)`
   — check `goalPayload` and pick fixture values that make this exact).
3. **Workflow double `startRefusalWorkflow(startResult)`** for WF01/WF02: a Workflow (`createWorkflow`) whose deps are
   doubles except what `performStep('start')` needs; `runtime.startRun` returns `startResult`; any other port call
   throws. Return the Workflow, the ctx, and the complete `perform` input whose operation is `{ kind: 'start', request }`
   built from a prepared execution (`request.prepared.claim.runRef` must be a real-looking RunRef), plus the base
   fields so the test can compute the expected `prepareStep(base, runRef)` request (read `prepareStep` and
   `requestIdFor` in `workflow.ts`; they are not exported — return the exact `base` object so the test can rebuild the
   expected `{ runRef, requestId }` the way the code does, or return the expected prepare request computed by a copied
   pure function, and say which).

## Lead notes for this group

- DU09 expects `archived=[S2]` and S1 still active once the new resolver exists; today (S1 fixture's default rule)
  the outcome differs — that is the RED. Never set a Session's role or duty by editing a record.
- If `createRoleConfigurationService` needs schemas or a catalog not registered by `createTaskClaimFixture`, register
  them the way existing role-spec tests (`tests/**/R3g-role-spec*.test.ts`) do.
