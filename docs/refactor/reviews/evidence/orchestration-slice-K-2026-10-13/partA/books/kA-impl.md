# Task: K slice part A — close the dangling Kernel Turn and continue in the same Session, test-driven

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
- Do not read the spec, the code or the test files yourself.
- Give each group of section 6 to its own subagent. Its message contains: sections 1–5 of this message verbatim; its own
  group block verbatim; the instruction to read, in order: (1) `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`;
  (2) the spec sections its block names, always including §9; (3) the code at the named symbols; then: work through
  its rows test-first (section 5, rule 1), run `npm run typecheck` and its own test files only; reply with FILES, per
  row the test name(s) and the implementation file:symbol, the test numbers of its files, and UNSPECIFIED items.
- Groups write disjoint files. A subagent never edits a file of another group; if it needs a change there, it stops and
  tells you, and you pass it on.

## 1. What this copy is

- **Base:** commit `slice-setup` = commit 834e5897 of the branch.
- **Commit `slice-base`** adds, on top: the spec with its §9 (post-freeze amendments M1–M9, binding), the lead-frozen
  changes to 14 old test files (section 3), and `DSH-BASELINE.md`, the lead's measured baseline.
- **The TDD skill** the user chose for all test writing is in `./.dsh-ref/tdd/` (not committed, excluded from
  `git status`).
- **What you do:** implement **part A** of the spec (closing the dangling Turn; staying in the original Session)
  **test-driven**: for each row of spec §5.2 KA-01..KA-17, write one failing test at the row's entry point (spec §5.1),
  see it fail for the right reason, write just enough production code to make it pass, go to the next row. Part B (the
  read-only command) is done by someone else in another copy: do not touch it.
- **The 14 old test files are already changed and frozen.** They describe the behaviour after part A; today they fail
  (`DSH-BASELINE.md` lists how). They must pass at the end, except the sandbox kind (section 8). You never edit them.
- **This sandbox has no bubblewrap.** Tests that run a registered check or a real sandboxed command fail here with the
  sandbox kind ("sandbox unavailable", or a Workflow `waiting` for a check that cannot run). `DSH-BASELINE.md` lists
  every such failure. The lead runs those outside with bubblewrap. Never instrument a harness to fake a sandbox.

## 2. Where the rules are (all inside this copy)

The frozen spec, `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md`. Chinese prose, English
identifiers. For part A read:
- §0.1 (decided by the user: decisions 49 item 25 and 51) and §0.2 **A 部分** L1–L11 (binding);
- **§9 M1–M9 (binding; they override everything above them)**;
- §2 the A interfaces; §3 rows KA1–KA5; §4 rules 1–6 and 8;
- §5.1 entries KE1–KE4; §5.2 rows KA-01..KA-17;
- §6 the A files; §7; §8.

## 3. Frozen files (never change them, not even temporarily)

At the end, `sha256sum` of these prints exactly:

```
b030a7f8b03f15e2edd83cf4dfd8e9a458157ddc11c7db3063e3dcc73ad72a6c  docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md
de40e52b63f8d99cc71910cf65fa7f41f71808f4d4acf8090a93dd0efb51bb71  tests/app/A2-runtime-capabilities.test.ts
34be632df85079c041834625118f022974cf1fd51f4701e5eeb7129211b9ec2c  tests/composition/R3c-R4b-platform.test.ts
32c200054419723c7d23a88852cc8c5a01e6c2669b086a2d605cc1ad26f710c5  tests/kernel/B2-history-public-export.test.ts
abf05018d9ccaa55a3a0b8aeb77f3134407fd9600f519e523ba82a7affca70d9  tests/kernel/R4a-frozen-public.test.ts
4922fae29950456fc3221723cc50af7fadbd633a836ff155b4bc3d0c167c6a41  tests/scenarios/A4-duplicate-receipts.test.ts
4b129fb935a9981c47e8df9bf90bd1246a66279d774b4bf3a78327684baea4dd  tests/scenarios/A7-control-goal29.test.ts
2495612afb682301c2e420f87be36269ec4b9e77ce45487b06c6680fb0390834  tests/scenarios/A7-control.test.ts
fd34cdcfb52018e96e6e82b6cfa498ae0916f7da975bd97fcec8c5ac0dc93230  tests/scenarios/A8-host-restart-entry.test.ts
931be9412d453bced0e3c6dffeee65a675537029cc44b4e2e5190f55f80174bc  tests/scenarios/A8-host-restart-lease.test.ts
ace88ddae5e53fc6989a66642f14d72b29822a824d228cddfeb671e830a99958  tests/scenarios/A8-host-restart-paused.test.ts
54e7aec707b54a7d6e4b43c051258151fbb20832c00d87824a2b480a28f303be  tests/scenarios/A8-host-restart.test.ts
2e3d3183ff0eedf35593c7086902161d24f73b62712b383212ae032ac731af52  tests/scenarios/C3-paused-continue-brief.test.ts
2ee0965354c862328e0af29c83cd5fda9ebd770cf66dfc52ed9f468a62101be0  tests/scenarios/WP1-wiring.test.ts
75794e0e527cd4ebdb04b5da2417fc18088c12f1ad3fd4e7e914c67781c135d6  tests/scenarios/harness.test.ts
94a495a7d20df767cd2cd6febcf2686382c3b0b231e597880039861da1da9d3e  DSH-BASELINE.md
```

- **No other existing test file changes either.** `git diff --stat slice-base -- tests` may list only new files.
- **Probes:** throw-away scripts go under `./.dsh-scratch/` and are deleted at the end. Never use `/tmp`.
- **If the spec seems to contradict an existing or frozen test:** keep that test as it is; report it under UNSPECIFIED
  with the test id, the assertion, the spec line and a minimal counter-example; go on with the other rows.

## 4. Lead decisions for this round (binding)

- **L-scope.** Only these may change:
  - the Kernel patch sources of spec §6 A under `vendor/coding-agent/patches/` (`core/runtime/state/run-state.ts`,
    `core/runtime/events/agent-events.ts`, `core/runtime/reducer/run-state-reducer.ts`,
    `storage/adapters/sqlite/sqlite-stores.ts`, `core/ports/session_store/session-store-port.ts`,
    `core/ports/session_store/session-history.ts`, `app/composition/composition-root.ts`,
    `app/composition/composition-contracts.ts`, `public-api.ts`; and `core/ports/session_store/session-projection.ts`
    only after adding it to `scripts/build-kernel-patch.mjs:relativeSources`), and the generated files that
    `node scripts/build-kernel-patch.mjs --write` rewrites from them (never edit a generated file by hand; AGENTS.md
    rule 6);
  - `src/core/agent-runtime/`: `ports.ts`, `runtime.ts`, `execution-contracts.ts`, `kernel-store-locator.ts`,
    `session-operations.ts`, `kernel-turn-facts.ts`, `run-reconcile.ts`, `execution-observation.ts`,
    `query-observation.ts`, `context-assembler.ts`, `continuation-brief-assembly.ts`, `contracts.ts` (M4);
  - `src/contracts/continuation-brief.ts` (M5 only: the `'interrupted'` value);
  - `src/business/workflow/`: `workflow.ts`, `session-maintenance.ts`, `contracts.ts`, `ports.ts`;
  - `src/composition/create-platform.ts` (the `turnClosure` wiring, M1; the capability texts, M6);
  - `scripts/build-kernel-patch.mjs` (only to add `session-projection.ts` to `relativeSources`, if needed);
  - new test files whose names start with `K-` under `tests/kernel/`, `tests/scenarios/`, `tests/composition/` or
    `tests/app/`, and, if a row needs setup no existing helper gives, new `tests/helpers/K-<name>-support.ts`, named in
    your reply.
  - Nothing else: no lock files, no `docs/`, no UI, no other `vendor/` file, no existing test or helper file. At the
    end `git status --short` lists only these.
- **L-tdd.** Follow `./.dsh-ref/tdd/` and spec §5:
  - one row → one failing test → minimal code → next row;
  - tests at the row's entry point only, through public interfaces;
  - **no reading the database or record store to verify** (spec §9 M7; the user's standing rule): no new
    `kernelSnapshot`, `kernelTurnOf`, `readSqlite`, `readInvariantWorld` reads in new tests; KE1 tests use the public
    `SqliteStores.get/read/append` (spec §5.1);
  - no expected value computed the way the code computes it, or read back from the system under test;
  - mocks only at system boundaries: the scripted model, the clock, injected Kernel-store faults (KE3, KE4), and the
    Kernel closure switch of spec §9 M2 (copy its exact pattern from `tests/scenarios/A8-host-restart-paused.test.ts`);
  - each test name starts with the row id, for example `KA-07 …`; a row that lists several cases has one assertion per
    case;
  - no tests whose answer is obvious from reading the code; refactoring is not part of the loop.
- **L-reach.** `tests/architecture/production-reach.test.ts` must still pass: every new exported declaration is reached
  from production code. The allowlist cannot be edited.
- **L-interfaces.** Names, signatures and fields exactly as spec §2, L1–L11 and §9 give them: `run.interrupted`,
  `closeOpenTurn`, `CloseOpenTurnInput`, `CloseOpenTurnResult`, `readTurnBounds`, `TurnBounds`,
  `RuntimeExecutionPort.closeOpenTurn`, `WorkflowCalls.close_open_turn`, `kernelSessionApiVersion` 3, `turnClosure`.
- **L-kernel.** Only the listed patch sources change. Every existing Kernel behaviour other than L1–L3 stays as it is;
  `tests/kernel` must pass (the two frozen changes there are R4a's version and B2's export list).
- **L-build.** After a change to a patch source, run `node scripts/build-kernel-patch.mjs --write`, then
  `node scripts/build-kernel-patch.mjs --check` must exit 0.
- **L-state.** State changes go through `src/core/work-graph/state/` (AGENTS.md rule 9). Health is written only by the
  existing `recordSessionHealth` (SES-13), called with the Host principal (spec L5, §9 M3); no new state row.

## 5. Rules for every group

1. **Test-first, one row at a time** (L-tdd). Keep a short log per row: the test name, the first failure message you saw
   (RED), and the change that made it pass (GREEN). This log goes into your reply.
2. **Spec §4 rules 1–6 and 8 hold**, and L1–L11 and §9.
3. **Read failures and refusals are returned, never turned into success or an empty result.**
4. **No real model calls.** No network. Do not touch ports 3080, 3099 or 44797.
5. **No git write commands:** no commit, no stash, no checkout of other revisions.
6. **Run one vitest command at a time;** never two in parallel.

## 6. Groups and rows

Order: **wave 1** group K alone. **Wave 2**, after K has reported its exported names: groups R and W in parallel.
**Wave 3**: group I. Then the self-check (section 7).

**Group K — the Kernel patch (closing, history restore, identity).**
- Production: the Kernel patch sources of L-scope and their generated files.
- Tests: new `tests/kernel/K-close-open-turn.test.ts` (entry KE1) and `tests/kernel/K-interrupted-history.test.ts`
  (entry KE2).
- Rows: KA-01, KA-02, KA-03 (KE1); KA-04, KA-05, KA-06 (KE2).
- Spec: L1, L2, L3; §2 the Kernel part; §4 rules 1–3; §9 M8.
- Must still pass: every file in `tests/kernel/`.
- Report the exact exported names and signatures as soon as they exist; groups R and W build on them.

**Group R — the Runtime operation, its wiring and what reads Kernel terminals.**
- Production: the `src/core/agent-runtime/` files of L-scope, `src/contracts/continuation-brief.ts` (M5),
  `src/composition/create-platform.ts`.
- What: `RuntimeExecutionPort.closeOpenTurn` with the L4 checks in order, the `turnClosure` dependency (M1, M3), the
  call-time Kernel lookup (M2), the result mapping (L4), the terminal consumers that must accept `run.interrupted`
  (§6 A Runtime list), the continuation brief's fact window (L9) and `turnStatus` (M5), the capability texts (M6, L11),
  `kernelSessionApiVersion` 3 (M4).
- Tests: new test files under `tests/scenarios/` or `tests/composition/` as the rows' entries require.
- Rows: KA-09 (brief; with group W's flow), KA-12 (fallback causes), KA-17 (capability report: the entry
  `tests/app/A2-runtime-capabilities.test.ts` uses — write a new test file at that entry).
- Spec: L4, L5, L8, L9, L11; §9 M1–M6.

**Group W — the Workflow step and the maintenance insertion.**
- Production: the `src/business/workflow/` files of L-scope.
- What: `WorkflowCalls.close_open_turn`; `claimRequeued` returns the step when L7 says so and goes straight to today's
  fallback when the port has no `closeOpenTurn` (M1); the receipt table of L7; the single maintenance insertion point
  and its three result classes (L7); nothing else in the maintenance order changes (§4 rule 5).
- Tests: new `tests/scenarios/K-*.test.ts` files at entries KE3 and KE4 (the scenario harness; the Kernel store is the
  system boundary where faults may be injected).
- Rows: KA-07, KA-08, KA-10, KA-11, KA-13, KA-14, KA-15, KA-16; and KA-09's flow half (with group R).
- Spec: L6, L7, L10; §3; §4 rules 5–6; §9 M1, M2, M7.
- Until group R has reported, code against the frozen port interface (§2); after R reports, run the KE3/KE4 tests
  end to end.

**Group I — integration.**
- After R and W have reported: run the 14 frozen old test files and every new `K-` test file; fix what fails in the
  files of the group that owns them (start a new subagent for that group if its first one has finished). Never change a
  frozen file.
- Then run the full suite once (section 8) and compare with `DSH-BASELINE.md`.

## 7. Self-check

When all groups have reported and `npm run typecheck` passes, start one read-only review subagent per group K, R, W,
with a fresh context. It reads `./.dsh-ref/tdd/`, spec §5 and §9, its group block, and the final diff of the group's
files (`git diff slice-base -- <files>` plus the new files). It answers:
1. Per row: covered or not, with the test name; does the test exercise the row's entry point; is its expected value
   independent; does each case of the row have its own assertion?
2. Per test: any TDD anti-pattern (implementation-coupled, tautological, trivial, a database read).
3. Per L-rule of its group: done / not done / done differently, with file:line.
4. Any defect: a closure that resumes or re-runs the original Turn or invents a tool result (§4 rule 1); a closure of a
   line L4/L7 do not allow (a paused line by maintenance, an unknown-outcome occupant, a line with a continuation, an
   archive request, a Query line); a fallback taken on a retryable result; a health write outside SES-13; the interrupted
   Turn's transcript in a model input; a cached Kernel lookup (M2); a changed maintenance order; a frozen file changed.

The owning group fixes what is not done, with a new subagent if needed. Then run section 8 once.

## 8. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
node scripts/build-kernel-patch.mjs --check
npx vitest run tests/kernel
npx vitest run tests/app/A2-runtime-capabilities.test.ts tests/composition/R3c-R4b-platform.test.ts tests/kernel/B2-history-public-export.test.ts tests/kernel/R4a-frozen-public.test.ts tests/scenarios/A4-duplicate-receipts.test.ts tests/scenarios/A7-control-goal29.test.ts tests/scenarios/A7-control.test.ts tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart-lease.test.ts tests/scenarios/A8-host-restart-paused.test.ts tests/scenarios/A8-host-restart.test.ts tests/scenarios/C3-paused-continue-brief.test.ts tests/scenarios/WP1-wiring.test.ts tests/scenarios/harness.test.ts tests/kernel/K- tests/scenarios/K- tests/composition/K- tests/app/K-
npx vitest run
sha256sum DSH-BASELINE.md docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md tests/app/A2-runtime-capabilities.test.ts tests/composition/R3c-R4b-platform.test.ts tests/kernel/B2-history-public-export.test.ts tests/kernel/R4a-frozen-public.test.ts tests/scenarios/A4-duplicate-receipts.test.ts tests/scenarios/A7-control-goal29.test.ts tests/scenarios/A7-control.test.ts tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart-lease.test.ts tests/scenarios/A8-host-restart-paused.test.ts tests/scenarios/A8-host-restart.test.ts tests/scenarios/C3-paused-continue-brief.test.ts tests/scenarios/WP1-wiring.test.ts tests/scenarios/harness.test.ts
git diff --stat slice-base -- tests
git status --short
```

Expected at the end (this sandbox, no bubblewrap):
- typecheck, check:architecture, build and the kernel-patch check exit 0.
- `tests/kernel`: everything passes.
- The 14 frozen files: the 10 tests of `DSH-BASELINE.md` section C pass; the tests of sections B and D fail only with
  the sandbox kind (for section D: never on a K assertion; report where each one now stops).
- The new `K-` files: every test passes, except a test that needs a registered check or a real sandboxed command, which
  fails only with the sandbox kind (name each one). Prefer KE3/KE4 tests that stop before the checks
  (`stopBefore` on `open_checks`) when the row does not need them. Every row KA-01..KA-17 has at least one test whose
  name starts with its id.
- The full suite: no failure other than `DSH-BASELINE.md` sections A, B and D (same files, same tests), and the new
  sandbox-kind ones you named.
- Every sha256 as in section 3; `git diff --stat slice-base -- tests` lists only new files; `git status --short` lists
  only L-scope paths; `./.dsh-scratch/` deleted; no commit.

## 9. Reply format

Reply with these five sections and nothing else:
- **FILES CHANGED:** each file changed or added, one per line.
- **ROWS:** one line per row: `row | test name(s) | RED message first seen | implementation file:symbol`.
- **CHECKS:** each command, its exit code; for vitest the `Test Files` and `Tests` lines and, for every file with a
  failure, each failing test id and the first line of its failure, marked `baseline` or `NEW`.
- **UNSPECIFIED:** per L-rule: done with file:symbol, or what was not done and why; each case the spec does not
  describe; each existing or frozen test you believe contradicts the spec.
- **NOTES:** at most ten lines: the subagents you ran, anything that blocked you.
