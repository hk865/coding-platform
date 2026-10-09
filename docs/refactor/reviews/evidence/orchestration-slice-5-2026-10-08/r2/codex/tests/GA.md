# Group A: request history, capacity, direct card reads

Read RULES.md first. Rows: table §2.1, R2A01–R2A11. You may create ONLY
`tests/work-graph/S5R2-queue-history.test.ts` and at most one helper `tests/helpers/S5R2-a-support.ts`.

- ×2 rows: `describe.each(['memory','sqlite'] as const)`. R2A09 runs on memory only: put it in its own `describe` with
  the memory fixture (no conditional skipping), with an explicit timeout (e.g. 300_000 ms). R2A07/R2A08 create ~200
  Goals: give them explicit timeouts too.
- Entry points to use (read them first): `tests/helpers/S5-decision-fixture.ts` (`openS5DecisionFixture`, Q1/Q2 real
  root queries of Goal B, operator, `storeSnapshot`, allocation counters), `tests/helpers/S5-application-support.ts`
  (`owners(f)`, `queue(f)`), `tests/helpers/S5-queue-support.ts`; the plan service
  `src/core/work-graph/tasks/plan-service.ts` (`proposePlan` with `requestRef` / `replaces`, Host `applyPlanChange`,
  `abandonPlanProposal`), the decision read model `src/core/work-graph/views/decision-read-model.ts`
  (`queryDecisionQueue`, `readDecisionCard`). See how the frozen `tests/work-graph/S5-request-candidates.test.ts`
  (RC01–RC08) builds candidates, adoptions and abandonments.
- Proposal ids are derived from the requestId (`plan-service.ts:1464`, `planProposalIdFor`). For R2A02 choose the two
  requestIds so that P2's refKey sorts before P1's; assert that order in the setup (compute the refKeys from the
  returned refs with the same canonical key function the code uses, `planProposalRefKey` / `canonicalJson`).
- R2A01/R2A05: after an adoption the request slot is released (§2.4); the new first candidate for Q1 is based on the
  NEW active plan (read it after the adoption). Build its draft the way the frozen tests build an adoptable future
  revision.
- R2A07/R2A08: create the extra Goals through the real Goal creation entry the WorkGraph offers (read how the fixture
  creates A/B/C; if the fixture itself seeds Goals, use exactly that seed path and nothing hand-made). Assert the Goal
  count of the Workspace in the setup.
- R2A09: 5001 user decision requests through the real `sendUserMessage` path (see
  `tests/helpers/S5-user-message-support.ts` `sendDecision` / `realOwners`, a sender with the adviser duty), all for
  Goal B. Assert the count of stored requests in the setup.
- R2A10: a real Session→Session mailbox message (see the frozen S5 user-message tests or
  `tests/work-graph/C1-session-mailbox.test.ts` for how Run RA's Session sends to another Session).
- R2A11: a real independent candidate of Goal A (propose without requestRef).
- Keys: always `decisionSourceKey({...identity})` from `src/contracts/goal-decisions.ts`; never a hand-written key.
