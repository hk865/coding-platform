**FILES**

- [S5R2-queue-history.test.ts](D:/cxt/s5r2-a1/tests/work-graph/S5R2-queue-history.test.ts)
- [S5R2-a-support.ts](D:/cxt/s5r2-a1/tests/helpers/S5R2-a-support.ts)

**PER ROW** — Expected results from static inspection; tests were not run.

- R2A01: Real propose → adopt → propose against PB2 → abandon. Both readers must pin P2@2. RED at helper lines 137–138: accepted-first selection returns P1 (`src/core/work-graph/tasks/plan-readers.ts:705`, `src/core/work-graph/views/decision-read-model.ts:1132`).
- R2A02: Two real propose/abandon chains; returned canonical keys prove P2 sorts before P1. RED at helper lines 137–138: refKey ordering selects P1 (`plan-readers.ts:700–707`, `decision-read-model.ts:1127–1134`).
- R2A03: Propose/abandon P1, then propose/adopt P2. Assert one Q1 history card, P2@2, closed fields, no P1 objects, and equal direct read.
- R2A04: Propose P1, replace with P2, abandon P2. Assert one Q1 history card and no separate replaced-P1 card; see clarification below.
- R2A05: Adopt P1, then propose P2 against freshly read PB2. Assert P2@1 appears once in waiting and Q1 is absent from history.
- R2A06: Propose/adopt independent U. Assert one matching history card keyed by U, pin U@2.
- R2A07: Create 198 additional Goals through `createGoal`; verify 201 stored Goals. RED at the capacity assertion: Workspace enumeration lacks the 200-Goal check (`decision-read-model.ts:286–300`). Assert unchanged Store, allocations, and zero model admissions.
- R2A08: Create 197 additional Goals; verify exactly 200. Assert queue returns `ready`.
- R2A09: Answer the fixture request, then send 5,001 real adviser requests; verify all stored pending requests. RED at the capacity assertion: truncation still returns `ready` (`decision-read-model.ts:322–324,560–561`). Assert zero writes.
- R2A10: RA sends a real Session notification. Assert direct decision-card read returns exactly `not_found`, with zero writes.
- R2A11: Propose independent PA for Goal A; verify its legitimate card first. Read using Goal B identity; assert exactly `not_found`, with zero writes.

**UNDETERMINED**

R2A04’s literal total-history count of one conflicts with the fixture’s existing independent PB1 history card. The test asserts one Q1 card plus that preserved baseline: `tests/work-graph/S5R2-queue-history.test.ts:70–89`.

**RISKS**

Node, typecheck, and tests were not run, as instructed. Check future-plan adoption first (`tests/helpers/S5R2-a-support.ts:98`) and the large message setup (`tests/work-graph/S5R2-queue-history.test.ts:199–209`). Import paths and prohibited-cast checks passed static inspection. No existing files were edited; no Git mutations were performed.