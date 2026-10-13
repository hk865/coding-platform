All checks are complete. Final report:

**FILES CHANGED:**
```
vendor/coding-agent/patches/sandbox/process/process-sandbox.ts
vendor/coding-agent/dist/sandbox/process/process-sandbox.js
vendor/coding-agent/dist/sandbox/process/process-sandbox.js.map
vendor/coding-agent/dist/sandbox/process/process-sandbox.d.ts
vendor/coding-agent/dist/sandbox/process/process-sandbox.d.ts.map
src/core/agent-runtime/readonly-command-tool.ts
src/core/agent-runtime/execution-contracts.ts
src/core/agent-runtime/execution-preparation.ts
src/core/agent-runtime/observed-model-run.ts
src/core/agent-runtime/query-execution.ts
src/core/agent-runtime/execution-driver.ts
src/app/host.ts
tests/kernel/K-readonly-sandbox.test.ts
tests/runtime/K-readonly-command.test.ts
tests/helpers/K-readonly-work-support.ts
```
(`query-preparation.ts` and `runtime-configuration.ts` were in L-scope but needed no change: the grant spread and the Host tool list already carry `readonlyCommandAccess`.)

**ROWS:**
```
KB-01 | KB-01 read_only refuses every workspace write and leaves the sentinel byte-identical | KE5, not runnable here (observed: read-only sandbox unavailable: ENOENT ... /usr/bin/bwrap) | process-sandbox.ts:ProcessSandbox.#arguments / #ensureReadOnlyReady
KB-02 | KB-02 read_only lets /tmp and HOME be written, forgets them next call, and never touches the host workspace | KE5, not runnable here | process-sandbox.ts:#arguments
KB-03 | KB-03 read_only blocks the network, reads git, refuses git writes, and cannot use a linked worktree | KE5, not runnable here | process-sandbox.ts:#arguments
KB-04 | KB-04 read_only rejects escaping cwd, hides the parent environment, and closes the inherited root fd | KE5, not runnable here | process-sandbox.ts:#resolveReadOnlyCwd / #arguments
KB-05 | KB-05 read_only reports timeout, cancellation and 32 KiB truncation with the real captured output | KE5, not runnable here | process-sandbox.ts:#run
KB-06 | KB-06 read_only probe reports unavailable and execute refuses to start the command anywhere | no RED (the deterministic absent-bwrap branch was already green; the bwrap-present-but-unsupported half is "KE5, not runnable here") | process-sandbox.ts:probe + execute availability check
KB-07 | KB-07 authorized Query sees run_readonly_command, runs it and stores the output in this execution; KB-07 authorized empty-write Work sees run_readonly_command, runs it and stores the output in this execution | AssertionError: expected [ 'code_index', 'cpp_index', …(7) ] to include 'run_readonly_command' | readonly-command-tool.ts:createReadonlyCommandTool; query-execution.ts / execution-driver.ts injection
KB-08 | KB-08 the real Host grant adds run_readonly_command only for a whole-workspace read with the switch on (default-on; allowReadonlyCommands:false; partial readPrefixes; RoleSpec ceiling; non-empty write scope; Host read permission changed mid-execution) | AssertionError: expected undefined to be 'forbidden' — the spec code made the frozen dispatcher reject the result as invalid_result | readonly-command-tool.ts handler -> permission_denied; host.ts:localWorkbenchGrant; query-execution.ts/execution-driver.ts assert-current
KB-09 | KB-09 Query and empty-write Work both see the tool | green on first run (guard over the KB-07 wiring) | observed-model-run.ts enabledNames/hostAuthorizedTools
KB-10 | KB-10 exit code / timeout / out-of-range timeoutMs / sandbox unavailable / >100 external paths / 128 KiB / in-flight dispatcher cancellation / in-flight Runtime cancellation | RED 1: expected undefined to be 'workspace_changed_during_readonly_command'; RED 2: expected undefined to be 'success' (untrimmed stderr JSON) | readonly-command-tool.ts handler mapping + boundOutput
KB-11 (KE5 half) | KB-11 read_only reports another writer's snapshot-visible change and never advances the Kernel baseline | KE5, not runnable here | process-sandbox.ts:#run read_only effects branch
KB-11 (KE6 half) | KB-11 (KE6) an external change during the command is reported and never advances the Kernel baseline | green on first run | readonly-command-tool.ts externalChangedPaths branch; effects sideEffect:none
```

**CHECKS:**
```
npm run typecheck                                            -> exit 0
npm run check:architecture                                   -> exit 0
npm run build                                                -> exit 0
node scripts/build-kernel-patch.mjs --check                  -> exit 0 (all four process-sandbox artifacts matches:true)
npx vitest run tests/kernel/K-readonly-sandbox.test.ts tests/runtime/K-readonly-command.test.ts -> exit 1
  Test Files  1 failed | 1 passed (2)
  Tests       6 failed | 20 passed (26)
  tests/kernel/K-readonly-sandbox.test.ts: KB-01, KB-02, KB-03, KB-04, KB-05, KB-11 — each first line:
    AssertionError: read-only sandbox unavailable: ENOENT: no such file or directory, access '/usr/bin/bwrap': expected false to be true
  (KB-06 passed)
npx vitest run <the 42-path regression list>                 -> exit 1
  Test Files  15 failed | 29 passed (44)
  Tests       37 failed | 302 passed | 29 skipped (368)
  tests/kernel/K-readonly-sandbox.test.ts (NEW, 6): KB-01, KB-02, KB-03, KB-04, KB-05, KB-11 — "AssertionError: read-only sandbox unavailable: ENOENT: no such file or directory, access '/usr/bin/bwrap': expected false to be true // Object.is equality"
  tests/app/MVP-workbench-tools.test.ts (1): "retains real output, replays one command handle and cancels a running command" — "AssertionError: expected { status: 'rejected', …(2) } to match object { status: 'ready', …(1) }"
  tests/app/R6-host.test.ts (1): "loads a real startup JSON and consumes the trusted runtime through the public Query/Workflow owners" — "AssertionError: expected 'waiting' to be 'completed' // Object.is equality"
  tests/business/R5b-initial-planning-workflow.test.ts (1): "consumes the answer, adopts the candidate, then advances to a formal Goal completion" — "AssertionError: the adopted Plan must reach a formal Goal completion: expected 'waiting' to be 'completed' // Object.is equality"
  tests/composition/A2-requeue-platform.test.ts (5): "D-3: FAIL → TaskRequeue (P4) → requeue claim with the continuation brief → no_new_basis refusal → note → PASS completes" — "AssertionError: expected { ref: { …(3) }, …(13) } to match object { effectivePhase: 'failed', …(2) }"; "§4.3 / §4.4: 0-commit refusals of a requeue …" — same kind; "TASK-03 (§4.3): the Workflow claims a requeue with the budget it pins; a claim with another budget is invalid" — "Error: requeue: {… code: busy, reason: finalize_first: round … is open}"; "C3 (§6.1 (e), RUN-02/03, I-19): a requeue Run binds one brief; prepare rehydrates it and the driver refuses another" — same busy Error; "W-21 / C3: an archived afterRun Session moves the requeue to a new Session; the brief lists the message Run 1 accepted" — "AssertionError: … to match object { effectivePhase: 'failed', …(1) }"
  tests/composition/A2-reverify-platform.test.ts (1): "C5 (§15.2 5.9, VR-14/15, TASK-29): an operator reverifies an INCONCLUSIVE head …" — "Error: the round must finalize"
  tests/composition/A2-verification-chain-platform.test.ts (6): "VR-01..VR-07: one chain per subject Run …" — "AssertionError: expected 'waiting' to be 'stopped'"; "VD-7: future adoptions before the open and before the completion never strand the Task" — "Error: work-1 must reach its completion"; "VD-7: an adoption while the Run is in the Kernel …" — "AssertionError: expected { stopped: null, …(3) } to match object { state: 'completed' }"; "VR-05 (VD-6): a root moved after begin …" — "AssertionError: expected { status: 'ready', value: { …(4) } } to match object …"; "VD-15: a gate has one chain anchored on its first producer …" — "Error: the Workflow must reach the gate check"; "VD-8: a source changed after the open …" — "AssertionError: expected { status: 'ready', value: { …(4) } } to match object …"
  tests/composition/R3e-command-check-platform.test.ts (2): "executes the fixed commands through the real sandbox …" — "AssertionError: registered check r3e-pass must return the persisted view: expected { status: 'rejected', …(2) } to match object { status: 'ready' }"; "collapses a concurrent fresh run into one real process …" — "AssertionError: at least one request observes the run: expected false to be true"
  tests/composition/R3e-completion-platform.test.ts (1): "runs the real registered checks, completes work and goal …" — "AssertionError: registered check r3e-pass must reach the persisted round view: expected { status: 'rejected', …(2) } to match object { status: 'ready' }"
  tests/composition/R5c-workflow-platform.test.ts (3): "advances two works and 'the Goal gate' …" and "advances two works and 'a stage gate then the Goal gate' …" — "AssertionError: the adopted Plan must reach a formal Goal completion (settled: ENOENT: … '/usr/bin/bwrap'): expected 'waiting' to be 'completed'"; "resumes the original verification round for a completed Work Run across a different flow" — "AssertionError: the original check runs to a persisted finished window: expected { status: 'ready', value: { …(4) } } to match object …"
  tests/scenarios/C5-gate-fix-open.test.ts (1): "C5 gate fix while the gate round is open …" — "Error: the Workflow must reach the gate open"
  tests/scenarios/C5-gate-fix.test.ts (2): "C5 gate fix (§15.2 5.9, GV-8/GV-9, P20, TASK-15) …" and "C5 control: a fix that does not repair the failure …" — "Error: the Workflow must reach the gate open"
  tests/scenarios/C5-reverify-guards.test.ts (5): "(a) verification_uncovered …" — "AssertionError: expected 'waiting' to be 'stopped'"; "(a)/(b) §13.7 / LA-4 …" — "Error: the round must finalize"; "(b) a timed-out check with the workspace changed between every round …" — "Error: the Workflow must request re-verification 1"; "(c) not_started …" — "AssertionError: expected [] to deeply equal [ Array(4) ]"; "(d) VR-03 …" — "AssertionError: expected undefined to match object { result: { …(2) } }"
  tests/scenarios/C8-human-stop-respected.test.ts (2): "AV-4 (STEP5-FLIPS §14) …" — "AssertionError: expected [ 'open_checks', 'run_check' ] to deeply equal [ 'open_checks', 'run_check', …(3) ]"; "VR-14 step 5 (hard limit 3, I-17) …" — "Error: the round must finalize"
  + Failed Suites 1: tests/state/invariants.test.ts (0 tests, 29 skipped) — "Error: requeue 1: {… code: busy, reason: finalize_first: round … of the selected Run is open}"; reproduced identically on pristine slice-setup, so pre-existing and sandbox-induced (not from part B).
sha256sum docs/.../slice-K-SPEC.md DSH-BASELINE.md                -> exit 0
  0a2b5acf813bdaae7e92c3833fcdc08373184e282e94690af884ec0c7ee75a6c  docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md
  0dd5663f487cef4c1a11efa6da837f8263f1cb2f3288f35bc86846a7f71f3c92  DSH-BASELINE.md
git diff --stat slice-base -- tests                            -> exit 0, empty (new files only)
git status --short                                             -> exit 0, only L-scope paths (12 modified + 4 new untracked: readonly-command-tool.ts, K-readonly-sandbox.test.ts, K-readonly-command.test.ts, K-readonly-work-support.ts)
```
The 37 test failures = the 31 sandbox-kind failures of `DSH-BASELINE.md` + the 6 new KE5 tests; no new non-KE5 failure.

**UNSPECIFIED:**
- **L-scope — done.** Only the permitted files changed; `.dsh-scratch/` deleted; no lock/docs/UI/other vendor file; `git diff --stat slice-base -- tests` empty.
- **L-tdd — done.** One row → one failing test → minimal code; tests at the row entry point; no DB/record-store reads (the fix's `storedQueryToolResult` goes through the public `readSessionHistory` port); mocks only the scripted model and, for KE6, the Kernel `ProcessSandbox` capability. Caveat: historical red→green order is only in the subagents' logs.
- **L-reach — done.** `production-reach` 4/4 and `boundaries` 29/29 (subagent run); allowlist untouched; `host.ts:localWorkbenchGrant` is called by `host.ts:buildRuntimeConfiguration`.
- **L-interfaces — done.** `workspaceMode` (`process-sandbox.ts:ProcessWorkspaceMode`), `externalChangedPaths`/`externalChangedPathsOmitted` (`ProcessExecutionEffects`), `run_readonly_command` (`readonly-command-tool.ts:READONLY_COMMAND_TOOL_NAME`), `{command, cwd?, timeoutMs?}` (its input schema), `readonlyCommandAccess:'all_except_denied'` (`execution-contracts.ts`; `host.ts:localWorkbenchGrant`), `allowReadonlyCommands` (`host.ts:WorkbenchWorkspaceConfig`). `externalChangedPaths`/`externalChangedPathsOmitted` are typed optional in the shared effects type because `read_write` never carries them, while spec §2 presents them as always present for `read_only`.
- **L-kernel — done.** Frozen `tool-dispatcher.js`/`permission-policy.js`/`tool-executor-port.js` unchanged; `read_write` behaviour preserved; `build-kernel-patch.mjs --check` exit 0.
- **L-build — done.** Patch source regenerated with `--write`; `--check` exit 0.
- **Spec not described:** spec L16 item 2/L18 layer 3 and L16 item 4/L15/KB-11 name the tool error codes `forbidden` and `workspace_changed_during_readonly_command`, but the frozen `toolErrorCodeSchema` has no such members; returning them makes `ToolDispatcher` throw `ToolProtocolError('invalid_result')`. Implemented `permission_denied` (KB-08) and `execution_failed` with the named paths in message+output (KB-10/KB-11). This is the one lead decision outstanding.
- `ProcessSandboxError.code` gained `invalid_arguments` though §2 does not enumerate the error union.
- KE6 entry names: §5.1 writes `prepareQueryExecution/startQueryExecution/observeQueryExecution`; the real public methods are `prepareQuery/startQuery/observeQuery`.
- `probe(read_only)` canaries only `{workspaceMode}` (not the caller's protected/readOnly/executable options), so `probe.available` can be optimistic; `execute` re-canaries the real config. `--remount-ro` is exercised only when a protected directory exists.
- KB-06 covers only bwrap-absent, not bwrap-present-but-unsupported.
- >128 KiB latent edge: 100 very long `externalChangedPaths` cannot be shrunk by `boundOutput`, and the external-change `error.message` is outside the dispatcher's `output`-only size check. Left unchanged: a fix would need dropping/truncating named paths, which L15/L16 do not authorize.
- `PROFILE_VERSION` was not bumped; the new KE5 file under `tests/kernel/` inherently fails here, which the literal "tests/kernel must still pass" rule conflicts with (§5.3 permits it).
- **No existing test was found to contradict the spec.**

**NOTES:**
- Subagents: Group S `6cd74d24` (sandbox + KE5 tests), Group T `26cb0630` (tool/wiring/Host grant), Review S `ff48a8f5` (no definite defects), Review T `e3ea3287` (found the Query/`observeQuery`, L18 layer-1, off-seam cancel, proxy-assertion, >128 KiB gaps), Group T fix `1bedb27d` (fixed all but the frozen-enum and >128 KiB items).
- KE5 rows not runnable here: KB-01, KB-02, KB-03, KB-04, KB-05 and the KE5 half of KB-11 (6 tests) — all "read-only sandbox unavailable: ENOENT /usr/bin/bwrap". The lead must run them with bubblewrap.
- The regression run numbers differ from the brief's literal "exactly 31" only because `tests/kernel` now also contains the new KE5 file (31 baseline + 6 KE5 = 37, all sandbox-kind).
- `tests/state/invariants.test.ts` reports 1 pre-existing failed suite (not in `DSH-BASELINE.md`); I reproduced it byte-for-byte on a read-only `git archive` of pristine `slice-setup`, so part B did not cause it. It is sandbox-induced (round cannot finalize, requeue busy).
- No commit, no git write commands; frozen hashes match exactly; `.dsh-scratch/` removed.