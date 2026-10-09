# Wiring package 1 (W): test fixtures written before the tests — common rules (all groups)

## What this checkout is and what happens next

- A clean checkout of commit 67dfee7a (TypeScript, Node 24, vitest). Nothing of package W is implemented yet.
- The frozen spec is `docs/refactor/design/orchestration-2026-10/slices/wiring-1-SPEC.md` (Chinese). §0 (lead notes
  L1–L17) wins over the body. §2 interfaces, §3 state rows, §4 rules, §5.1 fixture rules, §5.2 the test table
  (one row = one `it`), §5.3 existing tests, §6 file list, §7 rules. Code references are `file:symbol (line)` at
  this commit (§0.4).
- The work is split: YOU write only the FIXTURES (shared setup helpers that build each row's "给定" = given) for the
  rows of your group. Afterwards the lead checks and freezes your helper. Then another agent ("DSH part 1") writes
  the 8 test files of §6 on top of your helper (the `it` cases with the exact assertions of each row) plus
  `not implemented` stubs for the new production symbols; a later agent ("part 2") implements the production code
  and MAY NOT EDIT ANY TEST OR HELPER FILE. So your helper must build every given exactly and legally TODAY (with the
  code of this commit), must not need the new production code to build a given, and must not need any later change.
- The new production symbols of §2 (`goalContextContentV1`, `goalContextDigestV1`, `contextGoalContentProblem`,
  `createSessionDutyResolver`, `createContextExtensionsReader`, the Workflow steps `transfer_responsibility` /
  `archive_predecessor`, `WorkflowHandoverContinuation`) DO NOT EXIST yet. Never import them. Where a given needs one
  of them (e.g. a graph reader "with the provider installed", a maintenance service "with the new duty resolver"),
  take it as a PARAMETER of your builder (dependency injection with the existing type, e.g. the existing
  `GraphContextReaderDependencies['extensions']` or `WorkflowDependencies['sessionDuty']`), so the test can pass
  the new symbol later.

## What you may change

- ONLY the two files your group file names: one helper `tests/helpers/WP1-<group>-fixture.ts` and one smoke test
  `tests/wp1-smoke/<group>.smoke.test.ts`. Never edit `src/`, never edit any existing test or helper (import from
  existing helpers freely; if you need a variant of an existing helper function, copy it into your helper and
  change the copy).
- The smoke test is temporary (the lead runs it and then deletes it): for every builder it builds the given (on
  every backend the row uses) and asserts only the given's preconditions that hold with TODAY's code (e.g. "P is
  active, health unavailable, healthConclusion kernel_turn_open, P has an open responsible link on T, T has a
  TaskRequeue"). It must not call any new production symbol and must not assert the row's expected result.
- You cannot run node, npm or tests here (no Node). Be careful with TypeScript: read the types you use
  (`src/contracts/**`, `src/core/**`, `tests/helpers/**`), keep imports correct (`.js` suffix in relative imports, as
  the repo does), no `any`/`as unknown as` shortcuts that hide wrong shapes (a cast is acceptable only where the
  existing helpers do the same thing; say so in a comment). The lead runs typecheck and the smoke test afterwards.

## How the fixtures must be built

1. **Real histories.** Every given that an existing production entry can produce is produced through that entry and
   the state machines it uses (claim -> prepare -> authorize -> enter -> result/reconcile, Session create/health,
   responsibility transfer/link, archive request, requeue, plan propose/apply, Workflow advance steps, Host
   configuration). Read the existing fixtures first and reuse them: `tests/helpers/S1-workflow-archive-fixture.ts`
   (`createTaskClaimFixture`, `createB2ExecutionFixture`, `interruptWork`, `unknownWork`, `retireSession`,
   `completeWork`, `workflowForFixture`), `tests/helpers/S1-session-facts-fixture.ts`,
   `tests/helpers/S1-archive-service-fixture.ts`, and the tests that use them (`tests/business/S1-*.test.ts`,
   `tests/work-graph/S1-*.test.ts`, `tests/work-graph/S3-*.test.ts`, `tests/runtime/S3-*.test.ts`,
   `tests/scenarios/A8-host-restart-paused.test.ts`, `tests/scenarios/harness.ts`, `tests/scenarios/support/*.ts`).
2. **No database edits to make a state** (spec §5.1, AGENTS.md rule 4): never write or rewrite a record/event by hand
   to create a given, unless the row says "手工构造" (hand-made) — only GE02 and GE06 (an UNBOUND Run's prepared
   manifest whose binding is hand-made, following `tests/work-graph/S3-prepared-context-admission.test.ts:makeBinding`)
   and HO13 (the final-archive commit conflict injected the way `tests/business/S1-archive-flow.test.ts` IT13 does).
   A crash is simulated only by NOT performing the next step.
3. **Today's guards.** A builder may only fail at a step that uses NEW behaviour; it must never fail at a setup step
   that uses EXISTING code. Before you call an existing entry, read it and check that its guards accept your inputs
   today (registered schemas, ids and scopes, legal state order, pins, actor kinds — e.g. a Run paused by a person can
   only be requeued by a person; `continuationProvenanceFor` and `chooseSession` decide which Session a requeued Task
   gets). Think through each given step by step against the code and note the file:line you relied on.
4. **The given only.** A builder builds the row's given and returns everything the test needs to perform the row's
   action and check the expected values (refs, pins/revisions read from the store, the Workflow/service instance, the
   ctx, the input of the next step, small read helpers). It does NOT perform the row's action (the step under test)
   and asserts nothing about the expected result. If a row's given is "接 HO01" (continue from another row), offer a
   builder for the earlier state and say which builder plus which action leads there.
5. **Observation helpers.** Offer small read helpers the rows need for their exact expectations (e.g. read a Session
   card with links; list `SessionAnomalyAnchor` records of a Goal; list TaskRequeue records of a Task; read the
   `SessionArchiveRequested` events of a Session with `mode` and `requestId`; count records/events/receipts before and
   after). Read through existing owner read ports or the record lookup the existing fixtures use; read-only.
6. **Clock and ids.** §5.1: `t0='2026-10-08T00:00:00.000Z'`, `t1='2026-10-09T00:00:00.000Z'`; scope `p`/`w` unless
   an existing fixture fixes other ids (then keep the existing fixture's ids and say so). Deterministic ids.
7. **Do not invent.** If the spec does not determine something a given needs, or a given cannot be built with a
   legal history today, do not invent behaviour: build it as close to the row as the code allows and list the point
   under UNDETERMINED (row id, what is missing, spec line, code file:line).
8. **Header comment.** Start the helper with a comment block: per exported function its row ids and one line on the
   history it builds. Export types for what builders return.

## Your final answer (in English, the -o file)

- FILES: the two files.
- INTERFACE: per export: name, signature (parameters and returned fields), the row ids that use it, and for each row
  what the test does next (the action under test, with the exact call) — this text goes to the agent that writes the
  tests, so make it precise.
- PER ROW: one line per row id of your group: how the given is built (which entries, in order), what the smoke test
  checks, and which NEW behaviour the row's action will hit first (it must fail today only because of missing new
  behaviour / stubs).
- UNDETERMINED: see rule 7.
- RISKS: any setup step you are not sure passes today (file:line), so the lead checks it first.
