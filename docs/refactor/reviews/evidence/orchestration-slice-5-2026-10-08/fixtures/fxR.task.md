# Group R: routes and scenarios

Read RULES.md first. You may change ONLY:
- `tests/app/S5-decision-routes.test.ts` (RT01–RT08, spec §5.4 route rows + §4.5)
- `tests/scenarios/S5-two-request-decisions.test.ts` (SC01, §5.4)
- `tests/scenarios/S5-goal-conflict-rework.test.ts` (SC02, §5.4)
- `tests/scenarios/support/S5-decisions.ts` (the scenario support file; it is yours)
No other new helper. Never edit `tests/scenarios/harness.ts` (§5.4) or `tests/helpers/S5-decision-fixture.ts`
(another group is repairing it in parallel: use only its EXISTING exports, by name; do not depend on values that
group may change, such as the U1 draft or the answered message's captured pins).

## Findings (review-codex2.md; lead-verified where marked)

- **RT06 (defect 18)** `RT:135–150` returns `invalid` unconditionally from a test-local owner, uses a literal token
  and compares untouched local data. Rewrite: obtain a REAL display token from a real decision read (the real
  decision-settings service + display-token port built as composition builds them), submit
  `decisions/notices/seen` with that token but a mismatched filter/category (the row's mismatch) and the correct
  Workspace pin (§3.3 line 625: markSeen = Workspace), assert `invalid` and that the persisted Workspace
  (revision 3, `decisionSettings`) is unchanged through the store. In part 1 the real owner/token are stubs, so
  this row fails with `not implemented` — allowed.
- **RT08** lacks the explicit model-call observation the row asks for: count model calls with a real counter
  (e.g. a scripted model/provider double or the composition's model-call port) and assert 0.
- RT01/02/03/05/07 are genuine forwarding rows (keep), RT04 keeps its recorder (forwarding/rejection
  translation only). Do not turn recorder rows into fakes of the code under test.
- **SC01 (defects 20, 37, 38)** `SC01:56` and `Support:90` hand-build the card source (now must be D1
  `decisionSourceKey({kind:'candidate', goalRef, requestRef})` and the canonical card source read from the real
  queue/card read, not assembled by hand); the capture must support the later acknowledged formal change across
  the U2 replacement (valid acknowledgement proof), `:49` must assert the stored `status:'candidate'`, `:138`
  must count exactly the one Q2 formal modification attributable to the acknowledgement, besides the
  applications. Q1/Q2 on one Goal with canonical keys (A9).
- **SC02 (defects 21, 22, 39; lead-verified at `SC02:50`)** the agent requeue uses `h.direct()`, which is composed
  without Runtime (`harness.ts:887`), so `tasks/requeue-service.ts:553` rejects before `requeue_task` is checked.
  In-scope repair without editing the harness: in `Support`, create a fresh auxiliary Session/claim/Run on the
  same SQLite store with `requeue_task` granted from inception, following the real
  `authorizeRuntimeEntry → beginRuntimeEntry → recordExecutionEntered` pattern of
  `tests/work-graph/A2-requeue-service.test.ts:119–136`, then call the real delegated requeue owner as that Run;
  settle the auxiliary Run before any restart. Describe it in comments as owner-seeded Agent admission (not a
  model-driven tool call). The second automatic requeue at `SC02:107` meets `no_new_basis`
  (`requeue-service.ts:741`) because the scripts only re-read unchanged source (`Support:46–49`): create a real new
  source/input basis before it. The final draft at `SC02:141` starts from one work Task (`Support:217`) and
  deletes A2 (`tasks/plan-validation.ts:338` forbids physical removal): derive the final revision from the existing
  plan, keeping every Task. Assert requeue counts 1/2 and reverify count 1 as the row says.
- Source helpers `Support:90,104,110` bypass the key constructor: use D1 everywhere (conflict pair identity =
  unordered Goal pair + both active Plan pointers).
