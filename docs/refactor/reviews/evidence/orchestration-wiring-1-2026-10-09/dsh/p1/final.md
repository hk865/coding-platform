All work is complete: five writer subagents, five independent reviewers, fixes applied, and every section-6 check run. Final reply:

FILES CHANGED

New source (2):
- src/composition/session-duty.ts (new) — SessionDutyResolverDependencies + createSessionDutyResolver stub (factory returns a throwing function)
- src/core/work-graph/views/context-extensions.ts (new) — ContextExtensionsDependencies + createContextExtensionsReader stub (factory returns a throwing function)

Modified source (6):
- src/contracts/graph-context.ts (modified) — GoalContextContentV1 type + goalContextContentV1 / goalContextDigestV1 stubs
- src/core/work-graph/state/context-input.ts (modified) — contextGoalContentProblem stub
- src/business/workflow/contracts.ts (modified) — transfer_responsibility + archive_predecessor in WorkflowCalls, WorkflowHandoverContinuation, WorkflowOperation union
- src/business/workflow/workflow.ts (modified) — the two new performStep cases, each throwing not implemented
- src/business/workflow/ports.ts (modified) — SessionDutyResolver gains optional ctx
- src/business/workflow/index.ts (modified) — re-exports WorkflowHandoverContinuation

New tests (8), exactly the spec §6 names:
- tests/state/WP1-goal-content.test.ts (new) — W12 GC01, GC02, CG01–CG05
- tests/runtime/WP1-context-assembly.test.ts (new) — W13 GC03, GC04, AN08
- tests/work-graph/WP1-context-anomalies.test.ts (new) — W14 AN01–AN07 (own describe.each), AN09
- tests/work-graph/WP1-goal-content-entry.test.ts (new) — W15 GE01–GE07 (describe.each memory/sqlite)
- tests/business/WP1-start-refusal.test.ts (new) — W16 WF01, WF02
- tests/composition/WP1-session-duty.test.ts (new) — W17 DU01–DU09
- tests/business/WP1-continuation-handover.test.ts (new) — W18 HO01–HO13, HM01–HM04
- tests/scenarios/WP1-wiring.test.ts (new) — W19 SC01, SC02

`git status --short` shows only those 16 paths (before deleting scratch). No existing test/helper/fixture was touched.

CHECKS

- `npm run typecheck`: exit 0 (tsconfig.json + tsconfig.ui.json).
- `npm run check:architecture`: exit 0 (observed edges 7/8 allowed, boundaries OK).
- New tests: 8 files, 63 runs → 47 failed / 16 passed. Zero TypeError / import / timeout / fixture-setup failures; every failure is a `not implemented:` stub throw or an AssertionError for genuinely missing new behaviour.
  - Passing case ids (16 runs, exactly the lead's estimate, no unexpected pass): GC04-runtime, AN08, WF02, GE03/GE05/GE06/GE07 (memory and sqlite each), HO09, HO10, HO11, HM02, HM03.
  - Distinct first-failure messages (counts; backend-paired GE/AN07 messages print once for two runs): 8× `Error: not implemented: createSessionDutyResolver`; 7× `Error: not implemented: createContextExtensionsReader`; 5× `Error: not implemented: contextGoalContentProblem`; 2× `Error: not implemented: goalContextDigestV1`; 1× `Error: not implemented: goalContextContentV1`; 4× `AssertionError: expected { kind: 'claim_task', …(1) } to match object { …(2) }`; 3× `… to match object { kind: 'archive_predecessor', …(2) }`; 2× `… expected { status: 'ready', value: { …(5) } } to match object { status: 'ready', value: { …(1) } }`; 2× `… to match object { …(3) }`; 1× each of `{ …(5) } to match object { …(3) }`, `{ status:'ready', value:{…(4)} } to strictly equal { …(4) }` (WF01), `{ kind:'claim_task', …(1) } to match object { kind:'transfer_responsibility' }` (HO01), `expected null to be '<64-hex>'` (GE01×2), `expected null not to be null` (GE04×2), `expected [ 'create_session', 'claim_task' ] to deeply equal [ 'create_session', …(2) ]` (SC01), `expected 'rejected' to be 'ready'` (AN07×2), `expected 'not_implemented' to be 'available'` (SC02), `expected 'committed' to be 'rejected'` (GE02×2).
- Regression (34 files): 50 failed / 295 passed vs baseline 49 failed / 296 passed. The single new failure is `tests/architecture/production-reach.test.ts` (new exports not yet reached from production); its 8 items are listed under UNSPECIFIED. The other 49 failures are byte-for-byte the baseline set: per-file counts identical (A7-control 14, A8-host-restart-entry 7, C6 5, A8-host-restart-paused 5, A2-requeue-platform 5, harness 4, A8-host-restart 3, A8-host-restart-rework 2, A8-host-restart-lease 2, S1-archive-restart 1, A7-control-goal29 1), all missing-bwrap / waiting-at-run_check only.
- `sha256sum tests/helpers/WP1-*.ts`: all four values match section 2 exactly (440f91…, 6ecebf…, 4d45ce…, 413e6a…).

UNSPECIFIED

1. production-reach new exports (not yet called from production in part 1; allowlist untouched as instructed):
   src/composition/session-duty.ts:15 SessionDutyResolverDependencies (type); :20 createSessionDutyResolver (function); src/contracts/graph-context.ts:147 GoalContextContentV1 (type); :155 goalContextContentV1 (function); :162 goalContextDigestV1 (function); src/core/work-graph/state/context-input.ts:330 contextGoalContentProblem (function); src/core/work-graph/views/context-extensions.ts:16 ContextExtensionsDependencies (type); :21 createContextExtensionsReader (function).
2. GE01/GE02/GE06 (spec §5.2 lines 286,287,291) name `goalContextDigestV1(当前 Goal)` in their exact expectation/input, but in part 1 that function is a throwing stub and GE06 must stay green, so W15 computes the §2.1 digest locally with the real `canonicalJson`/`sha256Hex` over the exact field set {contentVersion:1,goalId,objective,workspaceId}. The literal production call is therefore not exercised in W15 (W12 covers the pure functions). If the lead prefers, GE01/GE02 could call the production function (accepting a stub-throw RED), but GE06 must keep a non-stub digest.
3. GE04 (line 289) asserts only "Goal source digest non-empty" (row says 摘要非空); no exact equality is determined by the row.

NOTES

- Subagents run: 5 writer groups in parallel — T1 (W12/W13/W16), T2 (W14/W15), T3 (W17), T4 (W18), T5 (W19) — then 5 fresh independent reviewers, one per group. All 10 reported; no writer hit a fixture gap.
- Self-check outcome: all 5 reviewers returned "matches the row" for every case id and found no rule-4 violation (no tautology, no `if (…) return;`, no `.every`, no failure-hiding try/catch). One real weakness was found and fixed: HO03 now also asserts the follow-on claim's Session pin equals C's current (post-handover) revision, and reads P's revision after `create_session` (the handover-decision read), so the archive pin is literal.
- Expected part-2 transitions: once `create_session` returns the handover step but `performStep` is still stubbed, HO02/HO12 will fail at `not implemented: Workflow step transfer_responsibility` and HO03/HO07/HO13 at `… archive_predecessor`; that is the intended RED for part 2.
- Reviewer minor notes (not deviations, left as-is): WF01's `expectedPrepareRequest` duplicates the frozen fixture's `requestIdFor`/`prepareStep` formula; GC03's expected source order duplicates `sortedSources`' canonical comparator; AN08/SC02 check the reminder row with `toContain(canonicalJson(row))` over the whole input rather than scoping to the reminders section (matches the AN08 row precedent).
- T5 confirmed no bwrap/ENOENT was hit: SC01's drive used the harness `check:'pass'`; SC01/SC02 fail at the first missing new behaviour instead.
- `.dsh-scratch/` was deleted at the end; no scratch files remain.