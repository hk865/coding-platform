# Test rule sheet v2 (lead, 2026-10-18, decision 80)

This sheet binds every test and test helper in a slice's scope. It replaces the judgment calls in
`coordinator-mode.md` "How tests reach their state" wherever they differ.

**v2 (before any finding table was frozen), from the first two audits:** A1 now says that the body of a public route
is a public input (v1 read "never a draft" too widely: a Plan draft for `plans/propose` is what callers send); A8
admits the Host's own inputs (v1 flagged workspace roots, authorizations and runtime configuration as stand-ins); F1
says which drafts are facts; F9 separates bounded polling of a public state from sleeps; the scope rule for old
files is new; the F5 example points at the right line. v1 is kept as `test-rule-sheet-v1.md`.

**Scope.** In a file the slice creates, everything is in scope. In an older file the slice only touches, only the
slice's changed lines are in scope; older debt elsewhere in that file goes to the T list, listed once, and is not
part of the slice's finding table.

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
  shared helpers. A helper takes only public inputs: ids, names, file contents, scripted model replies, and the body
  of any public route or public owner method that real callers send (a person through the UI or HTTP, an agent through
  a tool), such as a Plan draft for `plans/propose`, a Goal objective or an answer. The test may build such a body
  freely, with values a real caller could send. A helper never takes a value that in real use the platform produces
  itself (see F1), nor an event, cursor, position or prepared value.
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
  to do something A1–A6 and A8 do not cover. **v2: empty.**
- **A8 Host inputs.** What the Host itself supplies to the platform from its configuration: a workspace root (a real
  directory the test created) and its revision, the authorization decision for paths inside that root, the runtime
  configuration with a scripted model provider (a model client the step never calls may be a placeholder), clocks and
  id generators. Plain values are fine: these are inputs, not facts the platform records or derives. A Host input
  that the real Host would never give (a root outside the workspace, an authorization of a foreign path) belongs only
  in a row about that refusal.
  - Accepted: `s8l8-r1:tests/app/S8A-L8-auto-capture-gate.test.ts:87,97` (root and authorization of the test's own
    temp directory).

## Forbidden (examples)

- **F1 The owner accepts a built value that in real use the platform produces itself** (the draft the platform builds
  from Kernel facts, a classification, a review outcome, a Run or its state, a record, an entered fact, a prepared
  value), handed to the owner write that the platform's own step calls, even when that write is exported; then the
  test goes on from there. The test: does a real caller send this value through one of A1's public entries (a route
  through the UI or HTTP, or an agent's tool)? Only values the platform produces internally and no real caller sends
  are forbidden here. An owner method that is merely exported is not a public entry.
  - Rejected: `k3-g4b3-r7:tests/work-graph/K3-26-unknown-call-review-storage.test.ts:396–400` (a hand-built review
    draft committed through the owner's `resolveUnknownRun`, then the review read; the public route
    `executions/resolve-unknown` takes only the Run and the operator's reason, and the platform builds the draft).
  - Not F1: `s8l8-r1:tests/composition/S8A-L8-pass-capture.test.ts:243` (a Plan draft through `plans.proposePlan`,
    which the public route `plans/propose` exposes to callers).
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
  - Rejected: `s8l8-r1:tests/work-graph/S8A-L8-observation-state.test.ts:311` (the registration notification sent
    again without a new registration).
- **F6 A made-up failure** or record written through an owner's write.
  - Rejected: `s8l8-r1:tests/composition/S8A-L8-capture-mappings.test.ts:292` (`failAutoCapture` with an invented
    reason).
- **F7 Asserting by reading the store.** Assert through public reads.
  - Rejected: `s8l8-r1:tests/work-graph/S8A-L8-observation-state.test.ts:250–258` (`pointerOf` reads the record store).
- **F8 An expected value from a `src` constant or copied from program output.** It comes from the spec or a
  hand-computed example.
- **F9 Timing.** Sleeps, `setImmediate` chains, or many files to slow a step; a sleep to show that something did
  *not* happen. Use an A3 gate, a completion barrier (the awaited close, drain or callback) or a counted call. Bounded
  polling of a public state until a condition holds (`pending: false`) is allowed.
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

D1 and D3 run as `python3 -I .dsh-ref/d1-ledger.py . <base tag> WORKTREE` (the book names the base tag; the lead runs
the same script on the committed round). Every D1 line must match a finding-table id that asks for it; list each line
with its id in the reply.

A red detector blocks the close-out: fix the hit or report BLOCKED. Do not classify the hits.
