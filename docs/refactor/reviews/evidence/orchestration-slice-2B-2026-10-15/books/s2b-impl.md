# Task: slice 2B — run activity counts recorded at run end, backfill, activity calendar, track bars, task state over time; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not seen
this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not make
design decisions. Where the spec and this message do not determine something, do not invent behaviour: list it under
UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
Earlier runs lost all their work that way: they started subagents and then ended the turn.
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (for example `sleep 540`), then check with `list_agents`; repeat.
- No notification wakes you after your turn ends.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents.** You are the coordinator; keep your own context small.
- Do not read the spec, the code or the test files yourself beyond what you need to coordinate.
- Give each group of section 6 to its own subagent. Its message contains: sections 1–5 of this message verbatim; its own
  group block verbatim; the instruction to read, in order: (1) `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`;
  (2) the spec sections its block names, always including §0.2 (code facts), §0.3 L1–L17, §0.4, §8 and §10; (3) the code at
  the named symbols; then: work through its rows test-first (section 5, rule 1), run `npm run typecheck` and its own
  test files only; reply with FILES, per row the test name(s) and the implementation file:symbol, the test numbers of
  its files, and UNSPECIFIED items.
- Groups write disjoint files (section 6 names the owner of every shared file). A subagent never edits a file of
  another group; if it needs a change there, it stops and tells you, and you pass it on to the owner.

## 1. What this copy is

- **Base:** commit `slice-setup` holds the content of commit 79032271 of the lead's branch plus slice 2A as the lead
  verified it for merging (patch `s2a-code-4`, the whole suite passed with bubblewrap). This copy has its own history;
  use `slice-setup`, not the outside hashes.
- **Commit `slice-base`** adds the frozen spec (`docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md`)
  and `DSH-BASELINE.md`, the baseline of this sandbox.
- **The TDD skill** the user chose for all test writing is in `./.dsh-ref/tdd/` (not committed, excluded from
  `git status`).
- **What you do:** implement **slice 2B** of the spec **test-driven**: for each row of spec §5.2 (2B-01 … 2B-45), write
  one failing test at the row's entry point (spec §5.1, entries BE0–BE5; the user confirmed them on 2026-10-14), see it
  fail for the right reason, write just enough production code to make it pass, go to the next row.
- **This sandbox has no bubblewrap.** Tests that run a registered check or a real sandboxed command fail here with the
  sandbox kind. `DSH-BASELINE.md` lists every such failure; the lead runs those outside with bubblewrap. Never
  instrument a harness to fake a sandbox. Row **2B-09 (entry BE1s, the real `shell`) needs bubblewrap**: write it as
  the spec says, run it once here, report its failure as `sandbox`; the lead runs it outside.

## 2. Where the rules are (all inside this copy)

The frozen spec, `docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md`. Chinese prose, English
identifiers. Read:
- §0.2 F1–F37 (code facts; line numbers are from before 2A and K part A merged — find the symbol if a line moved);
- §0.3 L1–L17 (binding);
- §0.4 (seams), §1, §2 (interfaces: names and signatures are binding), §3, §4 (rules), §5 (tests), §6, §7, §8;
- §9 records how reviews were handled (background only); §10 (the freeze qualifications and the measurements) is binding.

Lead amendments to the spec, binding (decision 56 of `docs/refactor/HANDOFF.md`):
- **A1 — you write the fixtures.** Spec §7 says "Codex writes the fixtures first". This session cannot let Codex
  write, so you write them, under the rules of section 4 (L-fixtures). The lead reviews them afterwards.
- **A2 — the measurements of §7.** The lead measured the store reads of F37 before freezing; the results are in the
  spec's §10 ("冻结前的实测"): no per-day summary record; `ACTIVITY_READ_RECORD_CAP` stays 20,000 (change its comment to
  say it was measured, §10). The backfill batch size cannot be measured before the tally exists: export
  `ACTIVITY_BACKFILL_BATCH_RUNS = 5` from the Workflow's `activity-backfill.ts` as the default, injectable as §7 says;
  the lead measures it at acceptance (§10).
- **§10 of the spec overrides** where it differs from the earlier sections (it says so itself).
- **A3 — §5.3 is applied by you, exactly as written.** The table of §5.3 lists the only old tests whose text changes
  (SC02 lines 52–54 of `tests/scenarios/S5-goal-conflict-rework.test.ts`, the import paths of the stub's users, the
  allowlist entries). Make exactly those edits and no other change to an existing test; every other old test in §5.3
  is "run it and confirm"; if one fails, stop and report it with the test id and first failure line.

## 3. Frozen files (never change them, not even temporarily)

At the end, `sha256sum` of these prints exactly:

```
198e832f4c490660f50ea89e9db1bc3f814fdd6514936f78b1fd6becada3dc0d  DSH-BASELINE.md
8e7e159a193b7168504e877fef31b5a0abb368d32209258fdcd638556419bc2c  docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md
```

- **No existing test file changes except the §5.3 edits (A3).** `git diff --stat slice-base -- tests` may list only new
  files and the files §5.3 names.
- **Probes:** throw-away scripts go under `./.dsh-scratch/` and are deleted at the end. Never use `/tmp`.
- **If the spec seems to contradict an existing test:** keep that test as it is; report it under UNSPECIFIED with the
  test id, the assertion, the spec line and a minimal counter-example; go on with the other rows.

## 4. Lead decisions for this round (binding)

- **L-scope.** Only the files of spec §6 may change, plus new test files whose names start with `S2B-` under
  `tests/` (any existing test directory that fits the entry: `tests/runtime/`, `tests/work-graph/`,
  `tests/composition/`, `tests/scenarios/`, `tests/app/`), new helpers `tests/helpers/S2B-<name>-fixture.ts` or
  `tests/helpers/S2B-<name>-support.ts`, `tests/helpers/executed-files-stub.ts` (moved, L13) and the §5.3 edits. Nothing
  else: no lock files, no `docs/`, no UI components (only the route label table `src/ui/api/routes.ts`), no `vendor/`.
  A file outside this list that you believe must change: stop and report it.
- **L-tdd.** Follow `./.dsh-ref/tdd/` and spec §5:
  - one row → one failing test → minimal code → next row;
  - tests at the row's entry point only, through public interfaces;
  - **no reading the database or record store to verify** (the user's standing rule): assertions go through the public
    reads the entry names (`readRunActivities`, `readActivityCalendar`, `readTrackBars`, `readTaskStateTimeline`,
    `decisions.queryGoalConflicts`, the routes);
  - expected counts, hours, identities and orders are literal values in the test or the fixture, hand-computed from the
    spec, never computed with the product's own functions;
  - each test name starts with the row id, for example `2B-05 …`; a row that lists several cases has one assertion per
    case;
  - service-level examples run on both backends (memory and SQLite) where the entry allows it;
  - no tests whose answer is obvious from reading the code; refactoring is not part of the loop.
- **L-fixtures (amendment A1).** You write the fixtures of spec §7 (the list under "夹具由 Codex 先写"):
  - Build every dataset **only through the real public services and the real Runtime/Kernel with the scripted model**.
    Never write records directly, except what §7 names: the BE0 Kernel record builder (validated against
    `agentEventSchema`), the test-only "counting off" module double (BE3; vitest module mock, never in production code,
    F34), the storage-boundary fault and pause doubles, and the legacy shapes §7 lists (rounds without `since`, rounds
    finalized without `finalizedAt`), committed at the storage boundary in shapes today's codecs decode.
  - The clock: replace only `Date`, move it between scripted model replies; the scenario budget has `timeoutMs: null`.
  - Reuse what §7 says to reuse (`blockingTool`, `controlledTool`, `restartedHost`, the C2 Runtime platform fixture of
    `tests/composition/A2-reconcile-classifier-platform.test.ts`); do not build new versions of them.
  - Each fixture file starts with a comment listing what it builds and through which public calls.
  - Large datasets: build once per test file where the rows allow it; a slow test may take up to 1,800 s (use one
    exported constant `S2B_SLOW_TIMEOUT_MS = 1_800_000`, like 2A's `S2A_SCALE_TIMEOUT_MS`).
- **L-reach.** `tests/architecture/production-reach.test.ts` must pass: every new exported declaration is reached from
  production code. Only the allowlist entries §5.3 names may be added (the five route Body/Response aliases as
  `wire-format`).
- **L-interfaces.** Names, signatures, record and event types, index ids and route paths exactly as spec §2 and L1–L17
  give them.
- **L-state.** State changes go through `src/core/work-graph/state/` (AGENTS.md rule 9). 2B adds no state row; the
  `finalizedAt` field sits at the record top level, not in `RoundSnapshot` (L14; `tests/architecture/state-writes.test.ts`
  does not change).
- **L-2A.** Ordered reads use 2A's `RecordOrderedLookupPort.lookupOrdered` and 2A's stable window exactly as the
  spec says; do not change any RecordStore file (they belong to 2A and to slice 2C, which is being built in parallel in
  another copy).

## 5. Rules for every group

1. **Test-first, one row at a time** (L-tdd). Keep a short log per row: the test name, the first failure message you saw
   (RED), and the change that made it pass (GREEN). This log goes into your reply.
2. **Spec §4 rules and §8 hold**, and L1–L17.
3. **Read failures and refusals are returned, never turned into success, zero or an empty result.** Unknown is not 0
   (decision 49 item 03).
4. **No real model calls.** No network. Do not touch ports 3080, 3099 or 44797.
5. **No git write commands:** no commit, no stash, no checkout of other revisions.
6. **Run one vitest command at a time;** never two in parallel (subagents too: coordinate through the coordinator if
   needed, or run only your own files and keep each run short).

**Lead answers to the pre-read (binding; they refine the spec and this book where they were silent).**
- **P1 — factory names.** `views/activity-read-model.ts` exports `createActivityReadModel` (implements
  `ActivityReadPort`: `readActivityCalendar`, `readRunActivities`); `views/track-read-model.ts` exports
  `createTrackReadModel` (`readTrackBars`); `views/task-state-timeline.ts` exports `createTaskStateTimeline`
  (`TaskTimelineReadPort`); `tasks/run-activity-service.ts` exports `createRunActivityService` (the WorkGraph write and
  candidate side); `src/business/workflow/activity-backfill.ts` exports `createActivityBackfill` (the two Workflow
  operations); `tasks/goal-executed-files-reader.ts` exports `createGoalExecutedFilesReader` (spec §2). If §2 puts a
  method on a port, the factory returns an object with exactly those methods.
- **P2 — the two events.** `RunActivityRecorded@1` and `ActivityRecordingStarted@1`, encoded like the nearest existing
  event codec of the same module (envelope fields, the ref of the record written, `occurredAt`); no payload fields
  beyond what the spec names. They are registered in the same exported group as the two records (§5.3 last row).
- **P3 — the scenario clock and budget.** `tests/scenarios/harness.ts` has a fixed `now` and the 60 s budget; do not
  edit it. Build the Host/platform for BE2/BE3 in a new `tests/helpers/S2B-*-fixture.ts` the same way the harness does,
  with a `now` that reads the replaced `Date` and the budget `timeoutMs: null` (spec §7).
- **P4 — injection points.** Each factory takes an optional override in its dependency object: `maxPages` (default
  `RUN_ACTIVITY_MAX_PAGES`, reaching `readRunActivityFacts` through the Runtime port the backfill uses — the Runtime's
  `countRunActivity` gets an optional `maxPages` in its input for this), `readRecordCap` (default
  `ACTIVITY_READ_RECORD_CAP`), `batchRuns` (default `ACTIVITY_BACKFILL_BATCH_RUNS`). Production never passes them.
- **P5 — `unresolvedCalls`** is computed from the raw window exactly as L1 defines it; the sentence about
  `unresolvedToolCallIds` means "the same number on the same input", not a call into that function.
- **P6 — the three test tools are not exported** (`blockingTool`, `controlledTool` in
  `tests/runtime/A2-reconcile-runtime.test.ts`, `restartedHost` in `tests/runtime/R4-control-runtime.test.ts`), and those
  files may not change. Copy each one into a new `tests/helpers/S2B-runtime-tools-support.ts`, unchanged in behaviour,
  with a comment naming the original. "Do not build new versions" means: same behaviour, no redesign.
- **P7 — BE1r's store handle.** `tests/helpers/B2-runtime-fixture.ts` does not expose its store and may not change.
  Build BE1r's Runtime fixture in a new S2B helper following B2-runtime-fixture's construction (same registrations;
  they include the new records through `EXECUTION_ENTRY_RECORD_SCHEMAS`), keeping the store handle, and build the
  activity reads and the backfill on that store.
- **P8 — stub importers.** §5.3 row 2 covers every importer of `src/core/work-graph/tasks/executed-files-stub.ts`,
  including `tests/work-graph/WP2-context-extensions.test.ts` and `tests/helpers/S2A-window-fixture.ts`; change only the
  import path line in each (line numbers moved by one in some files).
- **P9 — allowlist: ten entries.** Each of the five routes has a Body and a Response alias; one `wire-format` entry each,
  as `core-http-types.ts:239–240` and the existing entries show.
- **P10 — `persistence/execution-entry-codecs.ts`** joins L-scope, only to add the run-activity group to
  `EXECUTION_ENTRY_RECORD_SCHEMAS` (§5.3 last row).
- **P11 — §0.2 is partly stale** (2A and K part A are merged: `RecordOrderedLookupPort` exists, `readTurnBounds` exists;
  F22's "only equality `lookup`" no longer holds; several line numbers moved; the classifier test is
  `tests/composition/A2-reconcile-classifier-platform.test.ts`). Read the merged code; find facts by symbol.
- **P12 — the Workflow backfill.** `backfillRecentActivity` and `backfillActivityRange` are Workflow operations: their
  types go in `src/business/workflow/contracts.ts` beside the other Workflow operations, the dependencies they need
  (the Runtime `RunActivityPort` and the WorkGraph run-activity service) as new members in `ports.ts`, the code in
  `activity-backfill.ts`. The route `activity/backfill` binds `workflow.backfillActivityRange` (spec §2).

## 6. Groups and rows (the lead's recommendation, revised after the pre-read)

The lead's grouping follows the spec's §7 (G1 → G2 → G3, G4) and splits it for parallel work. **You may regroup**
(merge, split, reorder) if you see a better cut; if you do, say in NOTES what you changed and why. Keep two rules
whatever you do: groups that run at the same time write disjoint files, and a shared interface is finished and reported
before the groups that use it start.

**Wave 1 — group F first; group T starts as soon as F has written `src/contracts/run-activity.ts`.**

*Group F — foundation (no rows of its own; report the exported names as they appear).*
- Production: `src/contracts/run-activity.ts` (new; write it first and report), `src/contracts/ledger.ts` (the two
  refs), `src/core/work-graph/tasks/run-activity-codecs.ts` (new: two records, two events P2, the index
  `s2b-run-activity-by-goal-last`), `persistence/execution-entry-codecs.ts` (P10), the other index registrations of L14
  (`tasks/plan-readers.ts` two Run indexes, `persistence/evidence-record-codecs.ts` four round indexes,
  `persistence/control-record-codecs.ts`, `persistence/plan-record-codecs.ts`, `queries/query-record-codecs.ts`), and
  `finalizedAt` (L14 end: `evidence-record-codecs.ts`, `decision-record-codecs.ts`, `rework-codecs.ts`,
  `evidence/evidence-service.ts`); the stub move of L13 (`tests/helpers/executed-files-stub.ts` and every importer, P8).
- Tests: the indexes and `finalizedAt` are exercised by later rows; F runs the §5.3 "run and confirm" files its changes
  touch (round codecs, the fixtures that register fixed sets) and reports.
- Spec: L4, L14, L13 (the stub move only), §2 contracts and codecs, §5.3.

*Group T — the tally (entry BE0, pure function).*
- Production: `src/core/agent-runtime/run-activity-tally.ts` (new).
- Tests: new `tests/runtime/S2B-tally.test.ts`; the Kernel record builder `tests/helpers/S2B-kernel-records-fixture.ts`.
- Rows: 2B-01, 2B-02, 2B-03.
- Spec: L1 (the whole 10-row table and its order), L2, L3, L6 (the pure-function half), P5.

**Wave 2 — one subagent, after F and T have reported.**

*Group R — recording at run end (entries BE1, BE2, BE2c, BE1r, BE1s).*
- Production: `src/core/agent-runtime/run-activity-reader.ts` (new), `execution-observation.ts`, `run-reconcile.ts`,
  AgentRuntime `ports.ts`, `runtime.ts`; WorkGraph `tasks/run-activity-service.ts` (new; P1), `execution-entry-service.ts`,
  `run-reconcile-service.ts`, `run-reconcile-contracts.ts`, `model/execution-entry-contracts.ts`; the composition
  wiring of the tally into the Runtime in `src/composition/create-platform.ts` (R owns this file in wave 2).
- Tests: new `S2B-` files for each entry; helpers P3, P6, P7.
- Rows: BE1 2B-04 … 2B-08; BE1s 2B-09; BE2 2B-10 … 2B-15; BE1r 2B-36, 2B-37, 2B-38, 2B-45; BE2c 2B-39, 2B-40.
- Must still pass: the §5.3 "do not flip" rows for the observer, control and reconcile tests
  (`tests/runtime/B2-runtime-execution.test.ts`, `R4-control-runtime.test.ts`, `A2-reconcile-runtime.test.ts`,
  `tests/composition/B2-runtime-platform.test.ts`, `A2-reconcile-classifier-platform.test.ts`,
  `tests/scenarios/A7-control.test.ts`, the ledger-counting scenarios).
- Spec: L5, L6, L7, §0.4 (wiring 2's cursor bindings stay; K part A's `readTurnBounds`).

**Wave 3 — three subagents in parallel, after R has reported. None of them edits composition or routes.**

*Group B — backfill (entries BE3, BE1r).*
- Production: `src/business/workflow/contracts.ts`, `ports.ts`, `activity-backfill.ts` (new; P1, P12);
  `src/app/host.ts` (start-of-recording record, automatic backfill, `leaseGated` gains `backfillActivityRange`); the
  backfill half of `run-activity-service.ts` (B owns that file in wave 3).
- Tests: new `S2B-` files; the "counting off" module double. Rows whose entry is the HTTP route are finished by group W
  in wave 4; B writes everything else through the Workflow and the Host.
- Rows: 2B-16 … 2B-20, 2B-41, 2B-42, 2B-44.
- Spec: L7, L8, L6 (the read-window half), P4, P12.

*Group V — the reads (entry BE4 except the time stripe).*
- Production: `views/activity-read-model.ts`, `views/track-read-model.ts`, `tasks/goal-executed-files-reader.ts` (new;
  P1, L13).
- Tests: new `S2B-` files, through the factories' public ports on stores built by R's and B's fixtures.
- Rows: 2B-21 … 2B-30, 2B-43.
- Spec: L9, L10, L12, L13, L17.

*Group S — task state over time (entry BE4, the time stripe).*
- Production: `views/task-state-timeline.ts` (new; P1).
- Tests: new `S2B-` file(s).
- Rows: 2B-31, 2B-32, 2B-33.
- Spec: L11, L17.

**Wave 4 — group W (wiring), after B, V and S have reported; then integration.**

*Group W — composition, routes and the stub replacement (entry BE5, and the route parts of the other rows).*
- Production: `src/composition/create-platform.ts` (reads, the stub replacement, the `activity` and `timeline` owners
  in the non-enumerable table, B's backfill wiring), `src/app/core-routes.ts`, `src/app/core-http-types.ts`,
  `src/ui/api/routes.ts`, `tests/architecture/production-reach-allowlist.json` (P9).
- Tests: new `S2B-` route files; the SC02 edit of §5.3 (lines 52–54 and the comment at line 7).
- Rows: 2B-34, 2B-35, and the route part of any row B, V or S left for the route.
- Spec: L13, L15.

*Integration (the coordinator or one subagent).*
- Run every new `S2B-` file and the §5.3 "run and confirm" files; fix what fails in the files of the group that owns
  them (start a new subagent for that group if its first one has finished). Then the self-check (section 7), then
  section 8.

## 7. Self-check

When all groups have reported and `npm run typecheck` passes, start one read-only review subagent per group (T, R, B,
V, S, W; F's changes go to R's reviewer), with a fresh context. It reads `./.dsh-ref/tdd/`, spec §5 and the L-rules its
group block names, its group block, and the final diff of the group's files (`git diff slice-base -- <files>` plus the
new files). It answers:
1. Per row: covered or not, with the test name; does the test exercise the row's entry point; is its expected value
   literal and independent; does each case of the row have its own assertion?
2. Per test: any TDD anti-pattern (implementation-coupled, tautological, trivial, a database read).
3. Per fixture: built only through public services and the real Runtime, except the doubles L-fixtures names?
4. Any defect: an unknown reported as 0, a read failure turned into an empty result, a count written twice on retry or
   restart, a Run or Task state changed by counting, a read that truncates instead of reporting `capacity`.

The owning group fixes what is not done, with a new subagent if needed. Then run section 8 once.

## 8. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
node scripts/build-kernel-patch.mjs --check
npx vitest run tests/runtime/S2B- tests/work-graph/S2B- tests/composition/S2B- tests/scenarios/S2B- tests/app/S2B- tests/scenarios/S5-goal-conflict-rework.test.ts tests/architecture/
npx vitest run
sha256sum DSH-BASELINE.md docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md
git diff --stat slice-base -- tests
git status --short
```

Expected at the end (this sandbox, no bubblewrap):
- typecheck, check:architecture, build and the kernel-patch check exit 0.
- The targeted run: everything passes except 2B-09 (sandbox kind) and baseline entries.
- The full suite: no failure other than those listed in `DSH-BASELINE.md` section A (same tests) and 2B-09.
- Every sha256 as in section 3; `git diff --stat slice-base -- tests` lists only new files and the §5.3 files;
  `git status --short` lists only L-scope paths; `./.dsh-scratch/` deleted; no commit.

## 9. Reply format

Reply with these five sections and nothing else:
- **FILES CHANGED:** each file changed or added, one per line.
- **ROWS:** one line per row: `row | test name(s) | RED message first seen | implementation file:symbol`.
- **CHECKS:** each command, its exit code; for vitest the `Test Files` and `Tests` lines and, for every file with a
  failure, each failing test id and the first line of its failure, marked `baseline`, `sandbox (2B-09)` or `NEW`.
- **UNSPECIFIED:** per L-rule: done with file:symbol, or what was not done and why; each case the spec does not
  describe; each existing test you believe contradicts the spec; every §5.3 row with its outcome.
- **NOTES:** at most twelve lines: the subagents you ran and in which waves, any regrouping and why, anything that
  blocked you, and the wall time of the slowest test.
