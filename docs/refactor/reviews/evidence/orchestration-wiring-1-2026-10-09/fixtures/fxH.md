# Group H — continuation handover (E15) and the retired-line maintenance branch

Checkout: `D:/cxt/impl-w1-fxH`. Read `D:/cxt/impl-w1-fx-msg/RULES.md` first.

## Your files (only these two)

- `tests/helpers/WP1-handover-fixture.ts` (new)
- `tests/wp1-smoke/handover.smoke.test.ts` (new, temporary)

## Rows (spec §5.2, file `tests/business/WP1-continuation-handover.test.ts`, memory backend only)

HO01–HO13 and HM01–HM04. Read the spec: §0 L10–L17 (all), §1.1 item 4, §3 rows W1-HO-01…04 and W1-AUTO-01, §4.4
(all), §5.1, §5.2 rows HO01–HM04, §7 rules 1–5, 10. Code (spec §0.4): `src/business/workflow/workflow.ts`
(`selectWorkStep`, `claimRequeued` 992–1060, `chooseSession`, `continuationProvenanceFor` 718, `responsibleSessionFor`,
`chooseExcluded`, `roleReusable`, `performStep` `create_session` 1304, `advanceWork` 1505), `session-maintenance.ts`
(retired branch 481–526, `platformCleanInterruption`, `dutyOf`), `session-archive.ts` (`drive`, `archiveLineInternal`),
`src/core/work-graph/sessions/session-responsibility-service.ts` (`transferSessionResponsibility` 359),
`src/core/work-graph/tasks/session-facts.ts` (`continuations` 278–300).

## What the helper must provide

1. **A Workflow composition on the real owners (memory).** Based on `workflowForFixture`
   (`tests/helpers/S1-workflow-archive-fixture.ts:1169`), copied and extended so a builder can choose:
   - the trusted `configuration` bindings (HO03/HO04/HO05/HO07/HO13 need configuration 1 with the assignment's
     `sessionRole` = role Y, later configuration 2 with `sessionRole` = role X for the SAME assignment role, on the SAME
     store: build a second Workflow instance on the same records/owners);
   - whether `responsibilities` is installed (HO10: absent; every other row: the real
     `createSessionResponsibilityService` as in `workflowForFixture`);
   - the HO13 injection (below).
   Keep `sessionLifecycle`, `sessionFacts`, `sessionAnomalies`, `messages`, `records.eventAt`, `sessionDuty` as
   `workflowForFixture` wires them (so `advanceWork` runs its maintenance page, spec §3 note and L11).
   Return the Workflow, the Host ctx it is called with, and the `WorkflowAdvanceBase` fields (`goalRef`, `flowId`,
   `sessionHint`, `taskId` when a row selects a Task explicitly) so the test can send `select_work` and `perform`.
2. **Givens (one builder per given; the test performs the row's action):**
   - HO01 / HO06 / HO10 / HO08 / HO02 / HO12: Session P (role = the binding's `sessionRole`) is responsible for Task T
     (open `responsible` link, from claiming T); P's Run of T stopped so that P is left `health: 'unavailable'`,
     `healthConclusion: 'kernel_turn_open'`, `occupancy: null`, AND the maintenance page does NOT archive P first —
     L15: only the interruption with a person's pause fence (the A8-host-restart-paused path: Run paused by a person,
     interrupted before the pause took effect) or a person-attested stop (`platformCleanInterruption` false,
     `session-maintenance.ts:376–389`) qualifies; `interruptWork` in the S1 fixture is the clean host-takeover case,
     which maintenance archives (IT10) — do not use it unchanged. T has a TaskRequeue pointing to that Run (made by the
     actor today's requeue guards accept, e.g. a person for a person-paused Run). No other reusable Session of the same
     role exists in the workspace. The test then sends `select_work` (HO01 expects the next operation to be
     `create_session` with `provenance: { kind: 'continuation', from: P, reason: 'interrupted', task: T }`) and performs
     it. Return P, T, the Run, the requeue ref, the Workflow(s) and the select input.
   - HO03 / HO07 / HO13 (role mismatch): P (role Y) claimed T under configuration 1, the Run ended (a normal, legal
     end that leaves T requeueable and P's responsible link on T OPEN — read how links close: `closeTerminalResponsibilities`
     closes only formally terminal Tasks), T requeued; then configuration 2 (assignment `sessionRole` = X); no Session
     of role X in the workspace; P is `active`, healthy (`health !== 'unavailable'`), not occupied, not waiting
     (`readSessionFacts(P).wait === null`), no archive request, and its ONLY open responsible link (module included) is
     T. The maintenance page must not archive P (check `dutyOf`/`executorArchiveDue`: an open link keeps it).
     Expected next steps (test): `create_session` (provenance reason `role_mismatch`) → `archive_predecessor`.
   - HO04: as HO03, but P also has an OPEN responsible link on another unfinished Task T2 (legal history, e.g. P claimed
     T2 too, or T2 was transferred to P by the responsibility owner); P idle.
   - HO05: as HO03, but P is currently occupied by a Run of another Task T2 (claimed and entered, still running).
   - HO09: P has a durable archive request (or is archived) when T is picked up; no other reusable Session of the role;
     the test expects `create_session` WITHOUT `provenance` and then `claim_task`. Build P's archive request through the
     real archive composition (operator `archiveLine`) with a disposition that leaves T claimable.
   - HO11: T requeued after a Run whose ORIGINAL Session (afterRun's Session) is reusable and is not a continuation
     Session; the test expects `claim_task` directly.
   - HO08: a helper `bumpSessionRevision(C)` that raises Session C's revision by one through an EXISTING public write
     unrelated to T (e.g. a responsibility/participation link to another target through the real owner), returning the
     new revision.
   - HO13: as HO03, plus a way to make the FINAL archive commit of P conflict once while `archive_predecessor` runs,
     done the way `tests/business/S1-archive-flow.test.ts` IT13 injects it (read IT13; copy its mechanism into the
     composition option). The responsibility transfer inside the composition must still commit; the later maintenance
     page then continues the request (spec HO13).
   - HM01–HM04 (maintenance only; the test calls `maintainSessions` of the Workflow directly with the workspace scope):
     P retired (`unavailable`), a continuation Session C exists (C's `provenance = { kind: 'continuation', from: P, … }`,
     so `readSessionFacts(P).continuations.length > 0`), no archive request on P, and:
     HM01 — no occupancy, P has NO open task/work responsible link (e.g. T transferred P→C through the real
     `transferSessionResponsibility`); HM02 — no occupancy, P still OPEN responsible for an unfinished T; HM03 — P occupied
     by a Run whose outcome is unknown (`outcome_unknown`; see `unknownWork`), no archive request; HM04 — no occupancy, the
     only open responsible link left on P is a `module` target. Make sure the earlier maintenance pages of your own
     setup (if your setup calls `advanceWork`) do not archive P before the row runs, and that P is in the first
     maintenance page (< 100 Sessions).
3. **Read helpers:** Session card (record + links) of a ref; the open `responsible` link of a Session on a target with
   its revision, `since`, `until`; all `SessionAnomalyAnchor` records of the Goal; TaskRequeue records of T; the
   `SessionArchiveRequested` events of a Session (mode, requestId); a link's revision for the four transfer pins of §4.4
   item 5.

## Lead notes for this group

- The row's action is always the test's: `select_work`, `perform <operation>` (the operation object is exactly the
  `next.operation` the previous result returned), or `maintainSessions`. Your builders stop before it.
- If HO01's given cannot be produced with a paused fence at this level, use the person-attested stop (L15 lists both);
  say which one you used and why under PER ROW.
- The new Workflow step kinds do not exist yet: never construct a `transfer_responsibility` / `archive_predecessor`
  operation in the helper.
