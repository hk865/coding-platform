# Task: K slice part B — read-only command tool and a read-only process sandbox, test-driven

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
  (2) the spec sections its block names; (3) the code at the named symbols; then: work through its rows test-first
  (section 5, rule 1), run `npm run typecheck` and its own test files only; reply with FILES, per row the test name(s)
  and the implementation file:symbol, the test numbers of its files, and UNSPECIFIED items.
- The two groups run in parallel and write disjoint files. A subagent never edits a file of the other group; if it
  needs a change there, it stops and tells you.

## 1. What this copy is

- **Base:** commit `slice-setup` = commit 834e5897 of the branch. It contains the frozen spec
  `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md`.
- **Commit `slice-base`** adds `DSH-BASELINE.md`, the lead's measured baseline.
- **The TDD skill** the user chose for all test writing is in `./.dsh-ref/tdd/` (not committed, excluded from
  `git status`).
- **What you do:** implement **part B** of the spec (the read-only command) **test-driven**: for each row of spec §5.2
  KB-01..KB-11, write one failing test at the row's entry point (spec §5.1), see it fail for the right reason, write
  just enough production code to make it pass, go to the next row. Part A of the spec (closing the dangling Turn) is
  done by someone else in another copy: do not touch it.
- **This sandbox has no bubblewrap.** Every test that really launches a sandboxed process fails here with the sandbox
  kind ("sandbox unavailable", or a Workflow "waiting" for a check). `DSH-BASELINE.md` lists the 31 such failures that
  already exist. The entry KE5 (rows KB-01..KB-06 and the KE5 half of KB-11) needs real bubblewrap: write those tests
  anyway, test-first in spirit, and report them under NOTES; the lead runs them outside with bubblewrap. Never
  instrument a harness to fake a sandbox for KE5.

## 2. Where the rules are (all inside this copy)

The frozen spec, `docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md`. Chinese prose, English
identifiers. For part B read:
- §0.1 (who may use the tool: read-only executions, decided);
- §0.2 **B 部分** L12–L18 (binding; they override other prose);
- §2 the B interfaces;
- §3 row KB1; §4 rule 7;
- §5.1 entries KE5 and KE6; §5.2 rows KB-01..KB-11; §5.3 the bubblewrap limit;
- §6 the B files; §7; §8.

## 3. Frozen files (never change them, not even temporarily)

At the end, `sha256sum` of these prints exactly:

```
0a2b5acf813bdaae7e92c3833fcdc08373184e282e94690af884ec0c7ee75a6c  docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md
0dd5663f487cef4c1a11efa6da837f8263f1cb2f3288f35bc86846a7f71f3c92  DSH-BASELINE.md
```

- **No existing test file changes.** `git diff --stat slice-base -- tests` may list only new files. Part B flips no old
  test; `tests/runtime/R5b-query-session-loop.test.ts` and `tests/runtime/source-text-loop-migration.test.ts` keep
  their exclusion assertions.
- **Probes:** throw-away scripts go under `./.dsh-scratch/` and are deleted at the end. Never use `/tmp`.
- **If the spec seems to contradict an existing test:** keep that test passing; report it under UNSPECIFIED with the
  test id, the assertion, the spec line and a minimal counter-example.

## 4. Lead decisions for this round (binding)

- **L-scope.** Only these may change:
  - `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts`, and the generated files that
    `node scripts/build-kernel-patch.mjs --write` rewrites from it (never edit a generated file by hand; AGENTS.md
    rule 6);
  - new `src/core/agent-runtime/readonly-command-tool.ts`;
  - `src/core/agent-runtime/observed-model-run.ts`, `query-preparation.ts`, `query-execution.ts`, `execution-driver.ts`,
    `execution-preparation.ts`, `execution-contracts.ts`;
  - `src/app/host.ts`, `src/app/runtime-configuration.ts`;
  - new test files `tests/kernel/K-readonly-sandbox.test.ts` and `tests/runtime/K-readonly-command.test.ts`, and if a
    row needs setup no existing helper gives, a new `tests/helpers/K-readonly-<name>-support.ts`, named in your reply.
  - Nothing else: no lock files, no `docs/`, no UI, no other `vendor/` file. At the end `git status --short` lists only
    these.
- **L-tdd.** Follow `./.dsh-ref/tdd/` and spec §5:
  - one row → one failing test → minimal code → next row;
  - tests at the row's entry point only, through public interfaces;
  - no reading the database or record store to verify;
  - no expected value computed the way the code computes it, or read back from the system under test;
  - mocks only at system boundaries: the scripted model, the clock, injected faults, and — for KE6 only — the Kernel
    sandbox capability (spec §5.1 KE6: "沙箱可用与否经 Kernel 的能力探测替身控制");
  - each test name starts with the row id, for example `KB-07 …`;
  - no tests whose answer is obvious from reading the code; refactoring is not part of the loop.
- **L-reach.** `tests/architecture/production-reach.test.ts` must still pass: every new exported declaration is reached
  from production code. The allowlist cannot be edited.
- **L-interfaces.** Names, signatures and fields exactly as spec §2 and L12–L18 give them: `workspaceMode`,
  `externalChangedPaths`, `externalChangedPathsOmitted`, `run_readonly_command`, `{ command, cwd?, timeoutMs? }`,
  `readonlyCommandAccess: 'all_except_denied'`, `allowReadonlyCommands`.
- **L-kernel.** The frozen dispatcher `vendor/coding-agent/dist/tools/dispatcher/tool-dispatcher.js` and permission
  policy `vendor/coding-agent/dist/policy/permissions/permission-policy.js` are not changed (L16, L18). The existing
  `read_write` mode of `ProcessSandbox` must stay byte-for-byte equivalent in behaviour.
- **L-build.** After a change to the patch source, run `node scripts/build-kernel-patch.mjs --write`, then
  `node scripts/build-kernel-patch.mjs --check` must exit 0.

## 5. Rules for every group

1. **Test-first, one row at a time** (L-tdd). Keep a short log per row: the test name, the first failure message you saw
   (RED), and the change that made it pass (GREEN). For KE5 rows that cannot run here, write "KE5, not runnable here"
   in place of the RED message. This log goes into your reply.
2. **Spec §4 rules 6–8 hold**, and L12–L18.
3. **Never fall back to a host command.** Sandbox unavailable means the tool fails (L13, KB-06, KB-10).
4. **Read failures and refusals are returned, never turned into success or an empty result.**
5. **No real model calls.** No network. Do not touch ports 3080, 3099 or 44797.
6. **No git write commands:** no commit, no stash, no checkout of other revisions.
7. **Run one vitest command at a time;** never two in parallel.

## 6. Groups and rows

**Group S — the read-only process sandbox (Kernel patch).**
- Production: `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts` and its generated files.
- Tests: new `tests/kernel/K-readonly-sandbox.test.ts`, entry KE5 (`ProcessSandbox.probe/execute` with a real
  `WorkspaceSandbox`, `workspaceMode: 'read_only'`).
- Rows: KB-01, KB-02, KB-03, KB-04, KB-05, KB-06, and the KE5 half of KB-11.
- Spec: L13, L14, L15, L16 (the sandbox parts), L17 (git), §2.
- Must still pass: every file in `tests/kernel/`.
- Report the exact exported names and signatures as soon as they exist; group T builds on them.

**Group T — the tool, its wiring and the Host grant.**
- Production: new `src/core/agent-runtime/readonly-command-tool.ts`; `observed-model-run.ts`, `query-preparation.ts`,
  `query-execution.ts`, `execution-driver.ts`, `execution-preparation.ts`, `execution-contracts.ts`; `src/app/host.ts`,
  `src/app/runtime-configuration.ts`.
- Tests: new `tests/runtime/K-readonly-command.test.ts`, entry KE6 (a scripted-model read-only execution: Query through
  `prepareQueryExecution/startQueryExecution/observeQueryExecution`, and a Work with an empty write scope through the
  same Runtime's prepare/start/observe; the sandbox capability is a boundary stand-in).
- Rows: KB-07, KB-08, KB-09, KB-10, and the KE6 half of KB-11.
- Spec: L12, L14, L16 (the tool result and its precedence), L18 (who, the three grant layers, the wiring), §2.
- Until group S has reported, code against the spec's `workspaceMode` option; after S reports, make the tool construct
  the real read-only sandbox (L14) and re-run typecheck.
- Must still pass: `tests/runtime/R5b-query-session-loop.test.ts`, `tests/runtime/source-text-loop-migration.test.ts`,
  `tests/app/host-settings.test.ts`, `tests/app/R6-host.test.ts` (sandbox-kind failures only, as in the baseline),
  `tests/app/A2-runtime-capabilities.test.ts`, `tests/architecture/production-reach.test.ts`,
  `tests/architecture/boundaries.test.ts`.

## 7. Self-check

When both groups have reported and `npm run typecheck` passes, start one read-only review subagent per group, with a
fresh context. It reads `./.dsh-ref/tdd/`, spec §5, its group block, and the final diff of the group's files
(`git diff slice-base -- <files>` plus the new files). It answers:
1. Per row: covered or not, with the test name; does the test exercise the row's entry point; is its expected value
   independent?
2. Per test: any TDD anti-pattern (implementation-coupled, tautological, trivial).
3. Per L-rule of its group: done / not done / done differently, with file:line.
4. Any defect: a host fallback; a write that reaches the workspace in `read_only`; `acceptAgentChanges` called in
   `read_only`; a cwd that escapes through a symlink; a result larger than 128 KiB; a tool visible without all three
   grant layers; a changed `read_write` behaviour; a changed frozen dispatcher or policy.

The owning group fixes what is not done, with a new subagent if needed. Then run section 8 once.

## 8. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
node scripts/build-kernel-patch.mjs --check
npx vitest run tests/kernel/K-readonly-sandbox.test.ts tests/runtime/K-readonly-command.test.ts
npx vitest run tests/kernel tests/app/A2-runtime-capabilities.test.ts tests/app/AG2-consultation.test.ts tests/app/AG6-agent-assembly.test.ts tests/app/MVP-ui-entry.test.ts tests/app/MVP-workbench-tools.test.ts tests/app/R6-host.test.ts tests/app/S1-session-routes.test.ts tests/app/change-commit-observer.test.ts tests/app/host-settings.test.ts tests/business/R5b-initial-planning-workflow.test.ts tests/business/S1-archive-flow.test.ts tests/composition/A2-requeue-platform.test.ts tests/composition/A2-reverify-platform.test.ts tests/composition/A2-verification-chain-platform.test.ts tests/composition/R3e-command-check-platform.test.ts tests/composition/R3e-completion-platform.test.ts tests/composition/R5c-workflow-platform.test.ts tests/contracts/A2-rework-contract-helpers.test.ts tests/data/cpp-source-index.test.ts tests/kernel/B2-history-public-export.test.ts tests/runtime/B1-kernel-assembly.test.ts tests/runtime/R4c-execution-history.test.ts tests/runtime/R4c-graph-history.test.ts tests/runtime/R4c-session-continuity.test.ts tests/runtime/R5b-query-session-loop.test.ts tests/runtime/S1-archive-files-brief.test.ts tests/runtime/S3-context-assembler.test.ts tests/runtime/S5-user-message-tools.test.ts tests/runtime/W2-role-skills.test.ts tests/runtime/source-text-loop-migration.test.ts tests/runtime/source-tool-lifecycle.test.ts tests/scenarios/A8-host-restart-attestation.test.ts tests/scenarios/C5-gate-fix-open.test.ts tests/scenarios/C5-gate-fix.test.ts tests/scenarios/C5-reverify-guards.test.ts tests/scenarios/C8-human-stop-respected.test.ts tests/state/invariants.test.ts tests/work-graph/R5b-initial-plan.test.ts tests/work-graph/S3-graph-context.test.ts tests/work-graph/S3-prepared-context-admission.test.ts
sha256sum docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md DSH-BASELINE.md
git diff --stat slice-base -- tests
git status --short
```

The regression list is the second vitest command above: `tests/kernel` plus the 40 files that import what part B changes.

Expected at the end (this sandbox, no bubblewrap):
- typecheck, check:architecture, build and the kernel-patch check exit 0.
- The two new files: every test passes except the KE5 tests, which fail only with the sandbox kind. Every row KB-01..KB-11
  has at least one test whose name starts with its id.
- The regression run: exactly the 31 sandbox-kind failures of `DSH-BASELINE.md`, no other failure.
- Every sha256 as in section 3; `git diff --stat slice-base -- tests` lists only new files; `git status --short` lists
  only L-scope paths; `./.dsh-scratch/` deleted; no commit.

## 9. Reply format

Reply with these five sections and nothing else:
- **FILES CHANGED:** each file changed or added, one per line.
- **ROWS:** one line per row: `row | test name(s) | RED message first seen | implementation file:symbol`.
- **CHECKS:** each command, its exit code; for vitest the `Test Files` and `Tests` lines and, for every file with a
  failure, each failing test id and the first line of its failure.
- **UNSPECIFIED:** per L-rule: done with file:symbol, or what was not done and why; each case the spec does not
  describe; each existing test you believe contradicts the spec.
- **NOTES:** at most ten lines: the subagents you ran, the KE5 rows you could not run, anything that blocked you.
