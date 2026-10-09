**FILES:** Modified only:

- [S5R2-b-support.ts](/D:/cxt/s5r2-b2/tests/helpers/S5R2-b-support.ts:228)
- [S5R2-automation-cards.test.ts](/D:/cxt/s5r2-b2/tests/business/S5R2-automation-cards.test.ts:132)

R2B01, R2B02, R2B05, and shared assembly remain unchanged.

**PER ROW:**

- **R2B03:** Real Run entry/settlement → plan proposal/adoption retaining required active work outside the new stage gate → verification open/finalize `INCONCLUSIVE` → Workflow confirmation → pre-pause queue assertion → operator pause. Expected RED at the post-pause `waitingCard` assertion, test line 145: [decision-policy.ts:195](/D:/cxt/s5r2-b2/src/core/work-graph/state/decision-policy.ts:195) returns null for paused gates.
- **R2B04:** Same setup, then `resolveDecision` while paused. Expected RED at the committed-answer assertion, test line 78: [decision-source-facts.ts:317](/D:/cxt/s5r2-b2/src/core/work-graph/communication/decision-source-facts.ts:317) returns `not_found` because the gate cause disappeared.

**UNDETERMINED:** R2B03/R2B04’s exact `select_work` route remains unresolved. [workflow.ts:1398](/D:/cxt/s5r2-b2/src/business/workflow/workflow.ts:1398) refuses explicit gate selection and requires all Goal work satisfied. The fixture’s frozen `test` requirements lack registered check coverage. Following RULES.md’s closest-case fallback, these tests use real Workflow `perform/reverify_round`; the deviation is documented at helper line 315.

**RISKS:** Node, typecheck, and tests were not run, as instructed. Lead should first verify plan adoption at helper line 258 and verification open/finalize at lines 283/296. RED locations above are based on code inspection. No Git commands were run.