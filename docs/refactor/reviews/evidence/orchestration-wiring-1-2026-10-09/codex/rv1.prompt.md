# Read-only review: wiring package 1, part-1 tests against the frozen spec

You review, you do not edit. This checkout = commit 67dfee7a + the lead's frozen fixture helpers + "part 1" written
by another agent (uncommitted: `git status`): 8 new test files, `not implemented` stubs and new types in src.

- Spec: `docs/refactor/design/orchestration-2026-10/slices/wiring-1-SPEC.md` (Chinese). §0 (lead notes L1–L17) wins
  over the body; §3 state rows; §4 rules; §5.1 test rules; §5.2 the test table (one row = one `it`); §7 rules.
- Frozen fixture helpers (lead-checked, they build each row's given through real entry points; review them only where
  a case's correctness depends on them): `tests/helpers/WP1-handover-fixture.ts`, `WP1-entry-fixture.ts`,
  `WP1-units-fixture.ts`, `WP1-scenario-fixture.ts`.
- Test files: `tests/state/WP1-goal-content.test.ts` (GC01, GC02, CG01–CG05), `tests/runtime/WP1-context-assembly.test.ts`
  (GC03, GC04, AN08), `tests/work-graph/WP1-context-anomalies.test.ts` (AN01–AN07, AN09),
  `tests/work-graph/WP1-goal-content-entry.test.ts` (GE01–GE07, memory+SQLite), `tests/business/WP1-start-refusal.test.ts`
  (WF01, WF02), `tests/composition/WP1-session-duty.test.ts` (DU01–DU09),
  `tests/business/WP1-continuation-handover.test.ts` (HO01–HO13, HM01–HM04), `tests/scenarios/WP1-wiring.test.ts`
  (SC01, SC02).
- After this review the tests are frozen; a later agent implements the spec and may not edit any test. So:
  1. every case must assert its row's "精确期望" exactly and completely (each named value, exact strings, exact counts,
     the order where the row gives one), not weaker and not stronger than the row (an assertion the spec does not
     support would block a correct implementation);
  2. a correct implementation of the spec must pass every case; a plausible wrong implementation (e.g. the Goal pin put
     back, a transfer done in two steps, `effectivePlatformDuty`'s default `executor` used, a read failure turned into
     an empty row list, maintenance archiving a retired line that still holds an open task) must fail at least one case;
  3. no tautology (a value compared with itself or with the test's own input presented as output), no escape
     (`if (…) return`, `?? skip`, `.every` on a possibly empty array, swallowed errors, a fake replacing the code under
     test), no dependence on timing or test order;
  4. the case's setup is the row's given (right builder, right action, the right `next` performed), and nothing in the
     test writes records by hand to create a state (only GE02/GE06's hand-made unbound manifest and HO13's injected
     conflict are allowed; both live in the fixtures).
- Today's measured run (lead, DSH sandbox without bubblewrap) is in `D:/cxt/impl-w1-fx-msg/p1-results.txt`: which cases
  pass and the first failure line of the others. Cases that pass today must be cases whose row asserts unchanged
  behaviour; say if one passes for a wrong reason.

Output (English): for each case id one line `OK` or `DEFECT: <what, test file:line, spec line, why>`; then a list of
must-fix defects (most severe first) and should-fix ones. Do not propose code; describe the direction. Verify each
claim in the code before you report it.
