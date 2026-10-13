# Task: orchestration wiring package 2 (I-2, I-4, I-5, I-6): test-driven implementation

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not
seen this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not
make design decisions. Where the spec and this message do not determine something, do not invent behaviour: list it
under UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
Earlier runs lost all their work that way: they started subagents and then ended the turn.
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- No notification wakes you after your turn ends.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents.** You are the coordinator; keep your own context small.
- Do not read the spec, the code of the groups or the test files yourself.
- Give each group of section 6 to its own subagent. Its message contains:
  - sections 1–5 of this message, verbatim;
  - its own group block, verbatim;
  - the instruction to read, in order:
    1. `./.dsh-ref/tdd/SKILL.md`, `tests.md` and `mocking.md`;
    2. spec §5.1–§5.3 and the spec sections its block names;
    3. the code at the named symbols;
  - then: work through its rows test-first (section 5, rule 1), and run `npm run typecheck` and its own test files only;
  - the instruction to reply with:
    - FILES;
    - per row: the test name(s), and file:symbol of the implementation;
    - the test numbers of its files;
    - UNSPECIFIED items.
- Groups in one wave run in parallel and write disjoint files.
- A subagent never edits a file of another group. If it needs a change there, it stops and tells you; you decide and
  tell the owning group.

## 1. What this copy is

- **Base:** commit `slice-setup` = commit 6c63f069 of the branch, with orchestration slices 0, 1, 3, 5 and wiring
  package 1 merged.
- **Commit `slice-base`** adds:
  - the frozen spec `docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md`;
  - the frozen test-side files of spec §5.4;
  - `DSH-BASELINE.md`, with the lead's measured baseline.
- **The TDD skill** the user chose for all test writing is in `./.dsh-ref/tdd/`. That folder is not committed and is
  excluded from `git status`.
- **What you do:** implement the production files of spec §6 **test-driven**:
  1. for each row of spec §5.2 that belongs to your group: write one failing test at the row's entry point (spec
     §5.1), run it and see it fail for the right reason;
  2. write just enough production code to make it pass;
  3. go to the next row.
  Nobody wrote these tests in advance; you write them.
- **What the lead measured on `slice-base`** (this sandbox, no `/usr/bin/bwrap`): see `DSH-BASELINE.md`. Typecheck has
  0 errors. In the regression run, 25 tests fail:
  - 18 of the bwrap kind (scenario tests wait for a check: "expected 'waiting' to be 'stopped'/'completed'"). That is
    expected here; never instrument a harness to prove it. The lead runs those tests with bubblewrap outside.
  - 7 intended RED that your implementation must turn GREEN:
    - `session-availability` (2);
    - `S1-wait-disposal` SV33/SV34 on memory and sqlite (4);
    - `state-writes` (1).

## 2. Where the rules are (all inside this copy)

- **The frozen spec:** `docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md`. Chinese prose, English
  identifiers. Paths in it omit `src/core/work-graph/`, and `src/core/` for `record-store/`.
  - §0.1 the U1 position design;
  - §0.2 L1–L12, binding;
  - §0.3 G stays unchanged;
  - §1 scope;
  - §2 interfaces;
  - §3 flow rows;
  - §4 rules per line;
  - §5 tests:
    - §5.1 the six entry points the user confirmed;
    - §5.2 the 29 acceptance rows;
    - §5.3 test-writing rules;
    - §5.4 frozen test-side files;
    - §5.5 regressions;
  - §6 the closed file list;
  - §7 groups and the TDD flow;
  - §8 rules 1–11;
  - §9 what this package does not do.
- **Precedence:** §0.2 and §8 override other prose.

## 3. Frozen files (never change them, not even temporarily)

- These files must not change. At the end, `sha256sum` of them prints exactly:

```
14d7e2fdabf97c589998791ec8d236c280f8a0423fd3fd028a8485982c2eeb84  docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md
bc03a0ae99cc14d0f376f598f0207957fa437803fc1201536242d6c0f316992e  tests/helpers/WP2-duties-fixture.ts
ea74913b76ffd0a53e5dbe41f683be82c3662c24d8e9bf829e6817063b7b9c84  tests/helpers/WP2-notices-fixture.ts
734afa7197468dd9d9589a3f1e6223084cd6ee2f59e6f4100d29d3b6fa0b53fa  tests/helpers/S5-application-support.ts
cf42a29065e41f02a4dc387bbf92c525eb91caeabc728d7ec6c4a37d547458a7  tests/helpers/S5R2-b-support.ts
14c6db940365b40b69d249a49d2b7cb811ddddb620ddd7b7d29369e9546d2f02  tests/helpers/S5R2-c-support.ts
203736eb880b18df2cf9a7d0712c04bd8bb05958823d799a60105f1ff9e5e10e  tests/architecture/state-writes.test.ts
82f24a3a1fd8873ea5e9bc4d2031c0cc348d4dd8611ee6cb895d252a2cb251d8  tests/state/session-availability.test.ts
ed9f015be2371e5c266bf90a49f0814194a704c8854d0652dbe681bf8007e677  tests/work-graph/S1-wait-disposal.test.ts
f943bbdb01668d62a8086ca3cea213b1ba1c82233f7504be449c2828826993e9  DSH-BASELINE.md
```

- **No other existing test file changes either.** `git diff --stat slice-base -- tests` may list only new files.
- **Probes.** To probe something, write a throw-away script under `./.dsh-scratch/` and delete it at the end. Never
  use `/tmp`.
- **If the spec seems to contradict a frozen or existing test:**
  - keep that test passing;
  - report under UNSPECIFIED: the test id, the assertion, the spec line and a minimal counter-example.

## 4. Lead decisions for this round (binding)

- **L-scope.** You may change only what spec §6 assigns to your group:
  - its production files (W201–W205, W217–W223, W225–W230, W236);
  - its new test files (W206–W210, W231 if needed, W239, W240);
  - if a row needs setup that no existing helper gives, a new helper `tests/helpers/WP2-<name>-support.ts`, named in
    your reply.
  - Nothing under `vendor/`, the lock files, `docs/` or the UI.
  - At the end, `git status --short` lists exactly those paths.
- **L-tdd.** Follow `./.dsh-ref/tdd/` and spec §5.3:
  - one row → one failing test → minimal code → next row;
  - tests at the row's entry point only, through public interfaces;
  - no reading the database or record store to verify;
  - no expected value computed the way the code computes it, or read back from the system under test;
  - mocks only at system boundaries: the scripted model, the clock, injected faults;
  - each test name starts with the row id, for example `F10 …`;
  - do not write tests whose answer is obvious from reading the code;
  - refactoring is not part of the loop.
- **L-reach.** `tests/architecture/production-reach.test.ts` must still pass: every new exported declaration must be
  reached from production code. The allowlist cannot be edited.
- **L-interfaces.** Implement the names, signatures and fields exactly as spec §2 gives them. A group may add
  non-exported helpers inside its own files.
- **L-SES13 (spec L10).** The SES-13 recovery rule stays as it is:
  - an active unavailable Session returns to available on a ready probe;
  - recovery clears `unavailableSince`;
  - a later re-entry writes a new position.
  Never make unavailability permanent.
- **L-bwrap.** If a row's test needs a registered check to run, it fails here with the bwrap kind (`waiting`). This
  can happen at entry E0, for Z01/Z02, if the Workflow cannot finish without a check.
  - Prefer a scenario that needs no registered check.
  - If that is impossible, write the test anyway and report it under NOTES with the exact reason. The lead runs it
    outside.

## 5. Rules for every group

1. **Test-first, one row at a time** (L-tdd). Keep a short log per row: the test name, the first failure message you
   saw (RED), and the change that made it pass (GREEN). This log goes into your reply.
2. **Spec §8 rules 1–11 hold.**
3. **State.** State transitions and protected fields change only through `src/core/work-graph/state/` constructors.
   - The two position fields are bound to the owner's commit cursor through the existing bind mechanism (spec §2.3,
     group E).
   - Never use a clock, `respondedAt` or `sourceCursor` as a position.
   - Never write during a read.
4. **Replay** of an original receipt comes before any new business read. A replayed result returns the same bound
   fields as the first result (spec L11-1).
5. **Read failures** are returned (`unavailable`, `incomplete`, `capacity`), never turned into empty results or
   `not_found`.
6. **No real model calls.** No network. Do not touch ports 3080, 3099 or 44797.
7. **No git write commands:** no commit, no stash, no checkout of other revisions.
8. **Run one vitest command at a time;** never two in parallel.

## 6. Groups, rows and waves (spec §6, §7)

`WG/` = `src/core/work-graph/`.

**Wave 1 (parallel):**

- **E — mechanical cursor binding.**
  - Production: W228 `src/core/record-store/ports.ts`, W229 `src/core/record-store/commit-extensions.ts`,
    W230 `src/core/record-store/record-codec.ts`.
  - Tests:
    - new, only if needed: `tests/record-store/WP2-notice-cursors.test.ts`;
    - must still pass: `tests/record-store/lookup.test.ts`, `tests/record-store/transaction-extensions.test.ts`.
  - Spec: §2.3 (the binding part).
  - Extend only the closed set of bindable fields, by the two new fields. The store does not judge availability or
    message meaning.
  - Report the exact exported names and signatures as soon as they exist; B needs them.
- **A — message duties (I-2).**
  - Production: W201 `WG/configuration/message-duties-adapter.ts`.
  - Tests: new `tests/work-graph/WP2-message-duties.test.ts`.
  - Rows: M01, M02, M03 (entry E4). Also the module side of F04: a read failure rejects; replay is unchanged.
  - Spec: §2.1, §4.1, L1–L3.
  - Must still pass: `tests/work-graph/S5-user-messages.test.ts`, `tests/business/S5R2-settings-replay.test.ts`,
    `tests/runtime/S5R2-agent-application.test.ts`, `tests/runtime/S5-user-message-tools.test.ts`.
  - The transitional mapping types are deleted by L3. Their composition use is removed by group D in wave 3. Until
    then, keep composition compiling: do not touch `src/composition/`.
- **C — context extensions (I-4, I-6).**
  - Production: W202 `WG/views/context-extensions.ts`, W203 `src/core/agent-runtime/context-assembler.ts`.
  - Tests: new `tests/work-graph/WP2-context-extensions.test.ts` and `tests/runtime/WP2-context-assembly.test.ts`, for
    the module side of F05–F08.
  - Spec: §2.2, §4.2, §4.3, L4–L6, L9, §0.3.
  - Must still pass: `tests/runtime/S3-context-assembler.test.ts`, `tests/runtime/WP1-context-assembly.test.ts`,
    `tests/work-graph/WP1-context-anomalies.test.ts`, `tests/work-graph/S3-graph-context.test.ts`,
    `tests/work-graph/WP1-goal-content-entry.test.ts`, `tests/state/WP1-goal-content.test.ts`.
  - G stays unchanged (§0.3).

**Wave 2 (after E has reported its signatures):**

- **B — undelivered-reply positions and the notice source (I-5).** It may use up to three subagents with disjoint
  files, in this order:
  - **B-state** first. Row P01 (entry E5), in a new `tests/state/WP2-positions.test.ts`. Production:
    - W217 `src/contracts/core/session.ts`;
    - W218 `WG/model/communication-contracts.ts`;
    - W219 `WG/state/session-availability.ts`;
    - W220 `WG/state/message-machine.ts`;
    - W221 `WG/sessions/session-record-codecs.ts`;
    - W222 `WG/sessions/message-record-codecs.ts`.
  - **Then B-writers and B-source, in parallel.**
    - B-writers:
      - W223 `WG/sessions/session-health.ts`;
      - W225 `WG/tasks/run-reconcile-service.ts`;
      - W226 `WG/queries/query-execution.ts`;
      - W227 `WG/communication/mailbox-service.ts`;
      - W236 `WG/communication/decision-service.ts`.
    - B-source: W205 `WG/views/undelivered-reply-notices.ts`, new.
    - Rows: M04–M11 (entry E4), in a new `tests/work-graph/WP2-undelivered-notices.test.ts`, plus the module side of
      F09–F15 where useful. Use the frozen `tests/helpers/WP2-notices-fixture.ts`.
  - Spec: §0.1, §2.3, §3, §4.4, L7, L8, L10, L11.
  - Must turn GREEN: the 7 intended-RED tests (section 1).
  - Must still pass: every file of spec §5.5. Its scenario files may fail here with the bwrap kind only. Also
    `tests/state/message-machine.test.ts`, `tests/state/query-run-recovery.test.ts`, `tests/state/run-machine.test.ts`,
    `tests/work-graph/R5b-query-execution.test.ts`, `tests/work-graph/C1-session-mailbox.test.ts`.
  - The views source only projects and compares; it never commits. Positions are written only in the original owner
    commits. Old records without the fields stay readable; only the notice source fails, explicitly, for the affected
    Goal (L11-3).

**Wave 3 (after A, B, C, E):**

- **D — production composition and the business flows.**
  - Production: W204 `src/composition/create-platform.ts`.
  - Tests:
    - new `tests/composition/WP2-wiring.test.ts`: rows F01–F15 through `createTargetPlatform` (entries E1, E2, E3;
      E3 rows on memory and sqlite, restart/crash rows on sqlite);
    - new `tests/scenarios/WP2-wiring-scenario.test.ts`: rows Z01, Z02 through the existing scenario harness
      `tests/scenarios/support/common.ts` (entry E0; see L-bwrap).
  - Spec: §2 (the composition parts), L3, L4, L7, §5.1–§5.3.
  - Must still pass: `tests/composition/WP1-session-duty.test.ts`, `tests/composition/platform.test.ts`,
    `tests/architecture/production-reach.test.ts`, `tests/architecture/boundaries.test.ts`.
  - D runs `npm run check:architecture` and reports any allowlist effect. It cannot edit the allowlist.
  - **For F01–F04, the scripted model must really call the `send_user_message` tool inside an entered Run.** Do not
    call the owner directly from the script.

## 7. Self-check

When every group has reported and `npm run typecheck` passes, start one read-only review subagent per group, with a
fresh context.
- It reads `./.dsh-ref/tdd/`, spec §5.2–§5.3, the group's block of section 6, and the final diff of the group's files
  (`git diff slice-base -- <files>`, plus the new files).
- It answers:
  1. Per row: covered or not covered, with the test name. Does the test exercise the row's entry point? Is its expected
     value independent?
  2. Per test: any TDD anti-pattern:
     - implementation-coupled (mocks internal modules, reads the database or record store, asserts call counts);
     - tautological (expected value computed like the code, or read back from the system);
     - trivial.
  3. Per implementation item: done / not done / done differently, with file:line.
  4. Any new defect in those lines, for example:
     - a read failure turned into absence;
     - a position taken from a clock or `respondedAt`;
     - a write outside `state/` or outside the owner's commit;
     - a write during a read;
     - a business read before the replay lookup;
     - a changed public shape;
     - SES-13 blocked.

The owning group fixes what is not done, with a new subagent if needed. Then run section 8 once.

## 8. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
npx vitest run WP2-
npx vitest run tests/state/session-availability.test.ts tests/work-graph/S1-wait-disposal.test.ts tests/architecture/state-writes.test.ts tests/architecture/production-reach.test.ts tests/architecture/boundaries.test.ts tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart.test.ts tests/state/S1-session-archive.test.ts tests/state/S1-message-routing.test.ts tests/state/S1-responsibility.test.ts tests/work-graph/S1-codecs-indexes.test.ts tests/work-graph/S1-dispatch-guards.test.ts tests/work-graph/S1-archive-owner.test.ts tests/work-graph/S1-requeue.test.ts tests/work-graph/S1-session-facts.test.ts tests/runtime/S1-routed-replies.test.ts tests/scenarios/S1-wait-copy-retirement.test.ts tests/scenarios/S1-archive-restart.test.ts tests/work-graph/S5-user-messages.test.ts tests/work-graph/S5-decision-application.test.ts tests/work-graph/S5-decision-queue.test.ts tests/work-graph/S5-notices.test.ts tests/work-graph/S5-goal-settings.test.ts tests/work-graph/S5R2-queue-history.test.ts tests/work-graph/S5-request-candidates.test.ts tests/state/S5-message-decision.test.ts tests/state/S5-notice-settings.test.ts tests/business/S5R2-automation-cards.test.ts tests/business/S5R2-settings-replay.test.ts tests/runtime/S5R2-agent-application.test.ts tests/runtime/S5-user-message-tools.test.ts tests/scenarios/WP1-wiring.test.ts tests/business/WP1-continuation-handover.test.ts tests/business/WP1-start-refusal.test.ts tests/composition/WP1-session-duty.test.ts tests/work-graph/WP1-context-anomalies.test.ts tests/runtime/WP1-context-assembly.test.ts tests/work-graph/WP1-goal-content-entry.test.ts tests/state/WP1-goal-content.test.ts tests/work-graph/S3-graph-context.test.ts tests/runtime/S3-context-assembler.test.ts tests/scenarios/C6-unrelated-adoption.test.ts tests/state/message-machine.test.ts tests/state/query-run-recovery.test.ts tests/state/run-machine.test.ts tests/work-graph/R5b-query-execution.test.ts tests/work-graph/C1-session-mailbox.test.ts tests/composition/platform.test.ts tests/record-store/lookup.test.ts tests/record-store/transaction-extensions.test.ts
sha256sum docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md tests/helpers/WP2-duties-fixture.ts tests/helpers/WP2-notices-fixture.ts tests/helpers/S5-application-support.ts tests/helpers/S5R2-b-support.ts tests/helpers/S5R2-c-support.ts tests/architecture/state-writes.test.ts tests/state/session-availability.test.ts tests/work-graph/S1-wait-disposal.test.ts DSH-BASELINE.md
git diff --stat slice-base -- tests
git status --short
```

Expected at the end (this sandbox, without `/usr/bin/bwrap`):
- `typecheck`, `check:architecture` and `build` exit 0.
- **`npx vitest run WP2-`:** every test passes, except Z01/Z02 if L-bwrap applies; those fail only with the bwrap
  kind. Every row of spec §5.2 has at least one test whose name starts with its id.
- **The regression run (50 files):** exactly 18 failures, all of the bwrap kind, in these files only:
  - tests/scenarios/A8-host-restart-entry.test.ts (7);
  - tests/scenarios/A8-host-restart.test.ts (3);
  - tests/scenarios/C6-unrelated-adoption.test.ts (5);
  - tests/scenarios/S1-archive-restart.test.ts (1);
  - tests/scenarios/WP1-wiring.test.ts (2).

  The 7 intended-RED tests now pass. Any other failure is yours.
- **Every sha256 is as in section 3.**
- **`git diff --stat slice-base -- tests`** lists only new files.
- **`git status --short`** lists only the paths L-scope allows. `./.dsh-scratch/` is deleted. No commit: `git log`
  still shows the two commits.

## 9. Reply format

Reply with these five sections and nothing else:
- **FILES CHANGED:** each file changed or added, one per line.
- **ROWS:** one line per row of spec §5.2: `row | test name(s) | RED message first seen | implementation file:symbol`.
- **CHECKS:** each command and its result. Give the exit code. For vitest, give the `Test Files` and `Tests` lines,
  and for every file with a failure: its numbers, each failing test id and the first line of its failure.
- **UNSPECIFIED:**
  - per group item: `done` with file:symbol, or what was not done and why;
  - each case the spec and this message do not describe;
  - each existing or frozen test you believe contradicts the spec.
- **NOTES:** at most ten lines: the subagents you ran (group, count), L-bwrap rows, and anything that blocked you or
  is undone.
