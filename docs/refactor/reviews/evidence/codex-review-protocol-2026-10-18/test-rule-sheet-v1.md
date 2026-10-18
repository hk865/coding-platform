# Test rule sheet v1 (lead, 2026-10-18, decision 80)

This sheet binds every test and test helper in a slice's scope. It replaces the judgment calls in
`coordinator-mode.md` "How tests reach their state" wherever they differ.

**Default deny.** A test reaches its state and checks its result only in the shapes under "Allowed". Every other
shape is forbidden, whatever it is called: "a seam", "a frozen boundary", "the test's declared outcome", "a stand-in".
The list under "Forbidden" gives examples; it is not complete.

**Nobody grades their own work.** The implementer never marks a hit "allowed", never edits an allowlist, and never
weakens a test to get past a wall. It fixes the hit, or it reports **BLOCKED** with the exact refusal (file:line and
the message) and the smallest options; the lead rules.

**The sheet does not move during a slice.** A change is a new version (v2, …) with its reason. The lead has Codex list
every instance under the new reading in the same step, and the new version applies from the next freeze.

Examples are `tag:path:line`. A tag means the line as it was at that tag (most rejected examples are fixed since).

## Allowed

- **A1 Public steps.** The platform's own code produces the prior state through the steps real use takes: routes and
  public owners, the Workflow's advance, Host start-up and restart, a scripted model calling the real tools, the real
  analyzer scripts on real source files, real files on disk (written, edited, moved away and back). Keep the steps in
  shared helpers. A helper takes only public inputs (ids, names, file contents, scripted model replies), never a draft,
  item, event, cursor, position or prepared value.
  - Accepted: `k3-g4b3-r8:tests/helpers/K3-35-continuation-fixture.ts` (the shared continuation path);
    `s8l8-r1:tests/app/S8A-L8-auto-capture-host.test.ts:94` (a failure produced by moving the root away).
- **A2 Fault injection.** A dependency fails, hangs, is cancelled or crashes at a named point, and the platform
  reacts. Shapes: a wrapper around the real dependency that fails once or always; a crash fixture; a cancelled signal;
  a wrapper around the real interpreter that prints garbage, hangs or exits; a narrowed Host authorization; a small
  limit set through a platform option.
  - Accepted: `k3-g4b3-r8:tests/work-graph/K3-17-disposition-replay.test.ts:88` (`failNextApplicationCommit`);
    `k3-g4b3-r8:tests/business/K3-46-review-advance-failures.test.ts:257` (a records port whose disposition commits
    fail).
- **A3 Delegating wrappers.** A wrapper around a real dependency that counts the calls, or holds them at a gate the
  test controls, then returns the real result unchanged.
  - Accepted: `s8l8-r1:tests/app/S8A-L8-auto-capture-gate.test.ts:48` (the per-workspace gate on `resolveRoot`).
- **A4 The backend seam.** Wrapping the backend or body-store factory so that the platform shares the test world's one
  real backend (so a memory Host can be reopened), and nothing else.
  - Accepted: `k3-g4b3-r8:tests/helpers/K3-35-continuation-fixture.ts:637`.
- **A5 Pure functions.** A parser, normalizer, codec, renderer, sorter or predicate called directly with built input.
  A pure test imports no store, platform, Host, Workflow, Runtime or stub port. A row moved out of a scenario goes into
  a `*-pure.test.ts` file. Combinations the public steps cannot reach, and extreme values (a 16-digit count), belong
  here and never in a scenario's state.
- **A6 Refused input.** A built value that the owner **refuses**, inside a `describe('rejects: …')` block. Every
  prior state comes from A1. The row asserts the refusal and, through a public read, that nothing changed. Each row
  holds one error, so removing the check under test makes the row fail.
  - Accepted: `k3-g4b3-r8:tests/work-graph/K3-26-unknown-call-review-storage.test.ts:485` (only the unrecorded
    `call-9`, `itemsOmitted: 0`).
  - Rejected: `k3-g4b3-r7:` the same file `:508–514` (an unrecorded call *and* a wrong count: the row passed without
    the check).
- **A7 Named helpers.** A list the lead owns (at most 10 entries, each with file:line and reason) of helpers allowed
  to do something A1–A6 do not cover. **v1: empty.**

## Forbidden (examples)

- **F1 The owner accepts a built value** (a draft, classification, review, Run, record, entered fact or prepared
  value), and the test goes on from there.
  - Rejected: `k3-g4b3-r7:tests/work-graph/K3-26-unknown-call-review-storage.test.ts:396–400` (a hand-built draft
    committed, then the review read).
- **F2 Overwriting** a read result, record or Session field, including spread-then-override.
  - Rejected: `k3-g4b3-r7:tests/runtime/K3-19-review-admission.test.ts:37–40` (an ordinary Run's `purpose`
    overwritten on read).
- **F3 Writing as the Runtime or Host would.** Calling an owner write that the Runtime or Host normally calls
  (`recordRunResult` with a built event), appending to or committing a store, opening a store to write.
  - Rejected: `k3-g4b3-r8:tests/helpers/B2-execution-fixture.ts:297` `enter()` (writes the entry facts by hand; the
    file is on the T list, its K3 callers are not).
- **F4 A stub port or stand-in that returns built values** to a Workflow or an owner.
  - Rejected: `k3-g4b3-r8:tests/business/K3-review-workflow-rows.test.ts:736` `performWorld`.
- **F5 A trigger or notification sent again with no real cause.**
  - Rejected: `s8l8-r1:tests/work-graph/S8A-L8-observation-state.test.ts:255` (the registration notification sent
    again without a new registration).
- **F6 A made-up failure** or record written through an owner's write.
  - Rejected: `s8l8-r1:tests/composition/S8A-L8-capture-mappings.test.ts:292` (`failAutoCapture` with an invented
    reason).
- **F7 Asserting by reading the store.** Assert through public reads.
  - Rejected: `s8l8-r1:tests/work-graph/S8A-L8-observation-state.test.ts:250–258` (`pointerOf` reads the record store).
- **F8 An expected value from a `src` constant or copied from program output.** It comes from the spec or a
  hand-computed example.
- **F9 Timing.** Sleeps, `setImmediate` chains, or many files to slow a step. Use an A3 gate.
  - Rejected: `s8l8-1:tests/app/S8A-L8-auto-capture-host.test.ts:220–232` (900 files and `setImmediate`).
- **F10 Counting at an inner layer** when the spec bounds a public operation.
  - Rejected: `s8l8-r1:tests/work-graph/S8A-L8-observation-state.test.ts:596–600` (reads counted on the reader, not on
    one `prepare`).
- **F11 A row that passes without the check it names**: two errors in one row, or an example that another rule also
  matches. See A6's rejected example.
- **F12 Weakening.** Removing or loosening an assertion; removing a row, an `.each` entry or a backend; `skip`,
  `todo`, `only`; raising a timeout; changing a refused row's input. Allowed only where the frozen finding table names
  it. Otherwise report the before and after.

## Every row also

- Names one behavior from the spec. Its expected literal comes from the spec or a hand-computed example.
- Runs on memory and SQLite when it is a service-layer row. The row table may say "SQLite only" with the reason (a Host
  restart).
- Fails if the production check it guards is removed.

## Detectors (run in every close-out and by the lead each round)

- **D1 Assertion ledger:** removed or loosened assertions, removed tests and `.each` rows, `skip`/`todo`/`only`, fewer
  backends, raised timeouts, `src` constants in expected values, changed refused inputs; cumulative from the slice base.
  Every line cites a finding-table id.
- **D3 Pure-file guard:** a `*-pure.test.ts` file imports no store, platform, Host, Workflow, Runtime or stub port.
- **D4 Fact scan** (when it exists): F1, F3 and the helper parameters of A1, outside A6 blocks and A7.

A red detector blocks the close-out: fix the hit or report BLOCKED. Do not classify the hits.
