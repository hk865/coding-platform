# Slice 5 round 2 — new tests written by Codex: common rules (all groups)

## What this checkout is

- A clone of the branch at the base commit printed by `git log -1`, plus an uncommitted change (see
  `git status`): the complete slice 5 (types, owners, readers, routes, Workflow, Runtime tools, 16 frozen test files
  `tests/**/S5-*.test.ts` and their support files). The whole existing suite passes on this state.
- Slice 5 still has five open production defects ("blockers") and several fixes that no test covers. The lead wrote a
  test table for them: `docs/refactor/design/orchestration-2026-10/slices/slice-5-round2-TESTS.md` (Chinese; ids,
  given/action, exact expected values, spec rule, code location, and the column 现在 = RED or GREEN today).
  **You write the tests of your group's rows.** After you, the lead freezes them; then another agent changes ONLY
  production code (`src/`) until every row passes, and may not edit your tests. So:
  - a **GREEN** row must pass today, for the right reason;
  - a **RED** row must fail today, and fail **exactly at the step that shows the blocker** (the assertion or call the
    row names), never earlier at setup. Before that step, assert that the setup is right (e.g. "the card is in the
    queue before the pause"), so a RED failure can only mean the blocker;
  - once the production code implements the spec and the table exactly, every row must pass without changing the test.
- Authorities: the table above (§0 common rules, §1 lead choices T-R2-1..3, §2 rows), and
  `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md` (§0 wins over the body; §5.1 fixture and
  observation rules; the spec lines each row cites). The table wins where it is more specific.

## What you may change

- ONLY the new test file(s) your group file names, plus at most ONE new helper file whose name your group file gives
  (`tests/helpers/S5R2-<group>-support.ts`). Never edit `src/`, never edit an existing file under `tests/` (all
  existing tests and helpers are frozen). Import existing helpers instead (`tests/helpers/S5-*.ts`,
  `tests/scenarios/support/S5-decisions.ts`, `tests/helpers/B2-execution-fixture.ts`, …); if one does not offer what
  you need, write it in your own helper file (copy code if needed).
- You cannot run node, npm or tests in this checkout (no Node). Read the types you use (`src/contracts/**`,
  `src/core/**`, `src/business/**`, `src/app/**`), keep imports and paths exact, no `any` / `as unknown as` shortcuts
  that hide wrong shapes (a cast is allowed only where an existing frozen test does the same for the same reason). The
  lead runs typecheck and the tests afterwards.

## How each case must look

1. **One `it` per row**, title starting with the row id (`it('R2A01 …', …)`). Rows marked ×2 run under
   `describe.each(['memory', 'sqlite'] as const)` with the S5 fixture of that kind (`openS5DecisionFixture(kind)` or the
   group's named fixture); close every fixture in `afterEach`.
2. **Exact row.** Build the given of the row and assert its expected values exactly (`toEqual` / `toMatchObject` on the
   named fields, exact codes, exact counts, exact refs and revisions). Not "truthy", not "any increasing revision".
3. **Real histories.** Every given is produced through production entry points: the fixture seed APIs, existing owners
   and their state machines (claim → authorize → enter; mailbox send/respond; Query submit/claim/answer; plan
   propose/apply/abandon; Goal control pause/resume; requeue/reverify owners; evidence/round owners), and the slice-5
   owners (`setGoalSettings`, `reorderGoals`, `resolveGoalConflict`, `sendUserMessage`, `answerDecision`,
   `recordDecisionApplication`, the Workflow's `resolveDecision` / `advanceWork` / `orderGoalAdvances`, the Runtime
   tools). Never hand-write a record, never edit the database to create a state production cannot reach. The
   `seedCommit` rule of the earlier fixture round still holds: a raw seed only for a precondition an existing
   production path could have produced, with a coherent history — prefer the real entry.
4. **Fault injection** (rows that say a read returns `unavailable` on a retry): wrap the REAL port or record store the
   code under test uses, delegate every call unchanged, and make only the named read return the store's
   `{status:'rejected', code:'unavailable', …}` shape (or the port's own rejection shape) — only during the retry. The
   first execution runs against the unwrapped behaviour. Assert in the test that the injected fault was actually
   reached (a counter in the wrapper), so the row cannot pass by never reading.
5. **Observations (§5.1).** "0 writes" = the store snapshot (`storeSnapshot()` / `observeRecords`) of the store the
   owner under test writes to is identical before and after. "Replay" = `replayed: true`, cursor and value equal to the
   first execution, newId/now/body-put counters unchanged. No mock call counter stands in for a store fact.
6. **No tautologies, no escapes.** Never compare a value with itself or with the test's own input as if it were output;
   no `if (...) return;` or optional chaining that skips the row's assertions; no `.every` over a possibly empty array;
   no fake that replaces the code under test (the driver rows replace only `advanceWork` and the runtime/session ports,
   as the table says).
7. **Do not invent.** If the spec and the table do not determine something a row needs, or a given cannot be built
   through production entries, do not invent behaviour and do not forge state: write the case as close to the row as
   possible and list it under UNDETERMINED (row id, what is missing, file:line).
8. **Before you use an existing entry, read it and check that its guards accept your inputs today** (registered
   schemas, ids and scopes, legal state order, exact pin sets of §3.3 line 625, an adoptable plan delta, Run/Session
   admission). A GREEN row or the setup of a RED row that fails because of your setup is a defect of your test.

## Your final answer (in English, the -o file)

- FILES: each file you created.
- PER ROW: one line per row id: how the given is built (which entries), which step is the row's decisive assertion,
  and for a RED row the exact call/assertion where it fails today and why (file:line in `src/`).
- UNDETERMINED: see rule 7.
- RISKS: any setup step you are not sure passes today (file:line), so the lead checks it first.
