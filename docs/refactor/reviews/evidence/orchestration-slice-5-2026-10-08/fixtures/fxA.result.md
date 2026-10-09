**FILES**

- Modified only [tests/helpers/S5-decision-fixture.ts](D:/cxt/impl-s5-fxA/tests/helpers/S5-decision-fixture.ts).
- No Node, npm, npx, typecheck or tests were run. Part-1 expectations below are from static inspection.

**PER CASE**

- Duty 1 — **REWRITTEN:** natural-identity source constructors use `decisionSourceKey`; expected to pass in part 1, no stub.
- Duty 2 — **REWRITTEN:** separate pending@1 Sent and responded@2 Answered commits; captures message@1, A/B/C@7, U1@1, PB1@1 and Goal bases. Expected to pass through existing codecs.
- Duty 3 — **REWRITTEN:** initial plans use real propose/apply; U1 targets PB2/version2, U2 targets PB2-Q2/version2, preserving PB1 tasks. Candidate preconditions use codecs and request-slot claims; no setup stub expected.
- Duty 4 — **REWRITTEN:** A/B contain module-M work; C has PC1 with module-N work. All plans include Goal gates. No setup stub expected.
- Duty 5 — **REWRITTEN:** `createS5Session` uses P/W Session admission/registration; `settleRunRA` uses `recordRunResult` and checks release. No stub expected.
- Duty 6 — **REWRITTEN:** actual store snapshots and allocation counters, including SQLite reopen. No stub expected during baseline observation.
- Duty 7 — **KEPT:** pending Query submission retained; optional answered-planning-query helper was not added. DQ01 still needs that setup from the queue group.

**FINDINGS**

- Defect 5 — **DONE:** coherent message history and captured pins/bases.
- Defect 6 — **DONE:** admissible future candidate drafts.
- Defect 8 — **DONE:** real planned-module overlap.
- Defect 9 — **DONE:** identity-only source keys.
- Defect 11 — **DONE:** store snapshots and allocation counters.
- Defect 10 — **DONE:** P/W idle Session helper.
- Defect 14 — **NOT DONE in full:** Run settlement supplied; optional answered Query helper deferred.

**EXPORT CONTRACTS**

Existing exports were retained.

- `PLAN_A2`, `PLAN_B2`, `PLAN_B2_Q2`, `PLAN_C1`: distinct full PlanRefs.
- `sourceOf`: constructs any supported source from its natural identity.
- `messageSourceOf`: message source with the caller’s complete captured pin set.
- `candidateSourceOf`: Goal/request candidate source.
- `conflictSourceOf`: unordered Goal/Plan-pair identity with separate captured facts.
- `goalBasisOf`: captures Goal content, excluding control fields.
- `S5AllocationCounts`, `createS5Allocations`: counting ID/clock/body-put dependencies; clock returns T.
- `S5StoreSnapshot`: record versions, event count/cursor, actual claim owners, and SQLite receipt count.
- Fixture/reopened `allocationCounts`, `newId`, `now`, `storeSnapshot`: shared observations across reopen.
- Fixture `createS5Session(name, role?)`: creates an idle P/W Session.
- Fixture `settleRun(claim)`, `settleRunRA()`: formally complete a running Run and verify release.
- `openS5DecisionFixture` changed values: expanded message captures; two-commit answered history; valid gates/governance; adoptable U1/U2; overlapping B scope; C→PC1 and `plans.C1`. Header documents these changes.

**UNDETERMINED**

- Duty 7 / DQ01, SPEC §4.2 source 5 (line 784): the optional helper needs Query claim, frozen preparation, entry, terminal observation and a Query-owned answer body. Pending Q1/Q2 do not satisfy this source. No substitute answer was fabricated.

**RISKS**

- Unexecuted integration checks: initial adoption at fixture line 570, settlement at 733, and store observation at 918.
- Memory claim enumeration requires tested owners to use `f.records`; this boundary is documented. Memory receipt count is unavailable and omitted.
- SessionDirectory internally uses wall-clock `new Date()` (`session-directory.ts:759,942`); injectable fixture clocks return T, but Session creation timestamps remain wall-clock.