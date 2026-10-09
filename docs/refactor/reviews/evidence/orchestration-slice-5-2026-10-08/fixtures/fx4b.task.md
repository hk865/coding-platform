# Group 4, round 2: `tests/work-graph/S5-goal-settings.test.ts` + `tests/helpers/S5-goal-settings-support.ts`

Read RULES.md, ROUND2.md, review-rv3.md. Same file permissions as fx4.md.

1. rv3 #3 (verified by run: SS08 fails at `:451`, `expect(await executionOf(x, 'b-work-2')).toBeNull()` receives
   RB's Run): `freeClaim()` (`:158–168`) targets `b-work-2`, already claimed by the fixture's RB. Provide a
   genuinely unclaimed, claimable Task of Goal B in the ACTIVE plan (e.g. adopt through the real plan service, as
   operator, a legal future revision of B that keeps every PB1 Task and adds one active work Task; check every
   existing PLAN guard and the claim admission of that Task; or another real path), keep RB intact for the
   preservation/authorization assertions, and keep pins current (Goal B's revision moves with the adoption).
   SS08 (settings wins the in-flight claim race: no new lease/Run), SS09 (cancelled predecessor: a first claim
   succeeds), SS13 (committed claim survives a later wait; the next claim refused) must all start from that free
   Task.
2. rv3 #1 at `S5-goal-settings-support.ts:580`: remove the message's own pin from stored sources (§2.3).
3. rv3 #2 at `S5-goal-settings-support.ts:630`: an ordinary message answer is seeded with
   `SessionMessageResponded` (D9), not `SessionMessageDecisionAnswered`.
