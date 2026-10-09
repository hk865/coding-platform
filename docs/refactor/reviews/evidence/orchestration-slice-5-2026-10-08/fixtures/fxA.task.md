# Group A: the shared fixture `tests/helpers/S5-decision-fixture.ts`

Read RULES.md first. You may change ONLY `tests/helpers/S5-decision-fixture.ts` (no new helper file in this
group). It is imported by 12 test files that other agents repair AFTER you, against your result. Therefore:

- **Keep every existing export** (names, and types compatible: you may add optional fields/parameters and new
  exports, you may not remove or rename anything or narrow a parameter). Values may change where a finding says
  the value is wrong (e.g. the U1 draft, the answered message history, the captured pins); document each changed
  value in the file's header comment and in your final answer.
- Do not edit any test file. If a test file stops typechecking because of your change, that is a defect: avoid it.
- Fix the existing typecheck error at the old `decisionSourceKey(base)` call (D1).

## What the fixture must provide after your work (spec §5.1, §2.3, §2.4, §2.8, §3.3)

1. **D1 keys.** Every seeded `decision.source.key` = `decisionSourceKey({kind:'message', messageRef})` (or the
   matching identity of its kind). `pins` and `goalBases` stay separate fields. Export a small helper per kind you
   use (e.g. `messageSourceOf(message, pins, goalBases?)`, `candidateSourceOf(goalRef, requestRef, pins)`,
   `conflictSourceOf(pair, pins, goalBases)`) that build complete `DecisionSourceV1` values through
   `decisionSourceKey`, so the test groups use one constructor.
2. **Coherent answered-message history** (review defect 5, verified at fixture :640–656): today the
   `SessionMessageSent` event of `messages.answered` carries the responded@2 snapshot. Seed the sent message as
   pending@1 with its Sent event, then the answered state responded@2 with its `SessionMessageDecisionAnswered`
   event (the answer is a precondition here, seeded through the real codecs; the rows that TEST answering call
   `answerDecision` themselves). Captured pins of the answer must be the real versions at answer time and must
   cover every object the application rows later change through REAL owners: Goals A and B at revision 7 (a
   reorder [B,A,C] changes A and B order; Goal C unchanged is allowed as a read guard), Goal B@7 + U1@1 (+ PB1@1 as
   read guard) for the plan adoption, each Goal pin with its `goalBases` entry (GoalDecisionBasisV1 built from the
   seeded snapshot). Today `capturedBasisB` alone (fixture :581, :643) is not enough.
3. **An adoptable U1** (defect 6, verified): U1 today is a schema-1 draft targeting the existing PB1 at
   planRevision 1, which `state/plan-machine.ts:1319–1340` (existing PLAN-05 guards) always rejects. Make U1 a
   real future revision of Goal B: `basedOn` = PB1 (the active pointer), a NEW plan id (`PB2`, the §5.1
   "really different PlanRef"), `planRevision` = source + 1, schema 2 draft, a supported delta that keeps every
   PB1 Task (no physical task removal, `tasks/plan-validation.ts:338`) and whose adoption by the configured
   operator passes every existing guard (read `plan-service.ts` applyPlanChange and the PLAN-04/05/06 guards).
   U2 (request Q2) is also based on PB1 with another new plan id, so after U1 is adopted U2 derives stale.
   Request-slot claims stay exactly the spec §2.4 key (already right at fixture :303).
4. **A real footprint overlap of A and B** (defect 8): PA1 and PB1 each contain at least one work Task whose
   module scope includes M (`src/m/`), so the pure footprint (§4.3) of A and B overlaps on M; Goal C uses only N.
   This lets the conflict rows (SS06/07/11/12/15, DQ01, SC rows use their own harness) establish a real conflict.
   Check that no existing fixture user depends on "no overlap" (grep the 12 test files for `MODULE_`/`plannedModules`).
5. **Free Session and Run settlement** (defects 10 and 14): export `createS5Session(name)` that creates an idle
   Session in P/W through the S5 Session directory (today `b2.base.createSession` closes over the foreign
   `r4c-claim-*` scope, `tests/helpers/task-claim-fixture.ts:297`, so a later claim under P/W is rejected at
   `tasks/claim-service.ts:494`). Export `settleRunRA()` (or a general `settleRun(run)`) that ends Run RA through
   the real existing Run result/settle entry, so Session S can then be archived legally
   (`state/session-availability.ts:623` rejects occupied Sessions).
6. **§5.1 observation helpers** (defect 11): keep `observeRecords`/`counts`, and add `storeSnapshot()` returning,
   for the store the services really write (memory and SQLite; also usable on a reopened fixture): the set of
   record ref keys with their revisions, the event count (and last cursor), the unique-claim keys with owners, and
   receipt count if the store exposes it. Read `src/core/record-store/**` to find the enumeration each backend
   offers; if one backend cannot enumerate, document what you use (e.g. `readMany` over every fixture ref plus the
   refs a row can create, and an `eventAt` scan) so that "0 writes" is a real store comparison. Add allocation
   counters: a counting `newId`, a counting `now` (always T) and a counting body store wrapper (puts), exported so
   service builders in the tests can pass them and replay rows can assert "not called again".
7. **Planning-question source for DQ01** (defect 14, optional in this group): if you can, add an exported
   `seedAnsweredPlanningQuery(...)` that saves a REAL answered QueryJob for Goal B through the existing Query
   service and answer path whose saved answer parses with `tasks/initial-plan.ts:parseInitialPlanningResponseV2`
   as needs_decision with at least one question (spec §4.2 source 5). If the existing entries make this too
   large, list it under UNDETERMINED with what blocks it; the queue group will then build it in its own helper.

Keep the fixed §5.1 values. Keep `messages.decision` (pending decision_request from Session S's Run RA to the
user, Goal B) consistent with the same rules (its Sent event carries pending@1; its source key via D1; its source
pins = the message pin + its captured objects).

## Findings for this file (from review-codex2.md; verified by the lead)

- Defect 5: `F:653` Sent event carries responded@2; `F:581` captures only PB1; `F:643` adds a basis but no
  captured Goal pin.
- Defect 6: `F:274–276,570` U1 schema-1 draft on PB1 planRevision 1 (inadmissible future plan).
- Defect 8: `F:404` B plan has no module-M overlap with A.
- Defect 9: `F:600,609` keys incorporate mutable bases/pins and wrap a previous key (now D1).
- Defect 11: `F:157–168` counts calls only; rows need store snapshots and allocation counters.
- Defect 10 (helper part): `SS:181` uses `b2.base.createSession` in the foreign scope.
- Defect 14 (helper part): `DQ:223` archives S while RA is running; no answered planning Query exists.

In your final answer list every export you added or whose value changed, with a one-line contract each (the
other groups get this list).
