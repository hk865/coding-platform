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
src/app/runtime-configuration.ts
tests/kernel/K-readonly-sandbox.test.ts
tests/runtime/K-readonly-command.test.ts
tests/helpers/K-readonly-work-support.ts
```
(`query-preparation.ts` stayed unchanged: the projection already carries the tool; the new tests cover it.)

**ROWS:**
```
KB-01 | KB-01 read_only refuses every workspace write and leaves the sentinel byte-identical | KE5, not runnable here (ENOENT /usr/bin/bwrap) | process-sandbox.ts:#arguments
KB-02 | KB-02 read_only lets /tmp and HOME be written, forgets them next call, and never touches the host workspace | KE5, not runnable here | process-sandbox.ts:#arguments
KB-03 | KB-03 read_only blocks the network…; KB-03 D-IPC masks a workspace FIFO and Unix socket…; KB-03 D-IPC skips masked protected subtrees…; KB-03 D-IPC finds a root-level socket before a deep sibling tree exhausts the walk bound; KB-03 D-IPC masks a socket and FIFO inside the readable .git mount; KB-03 D-GIT keeps a Host-denied .git subtree hidden… | KE5, not runnable here; D-IPC root-socket RED on a bwrap host before the BFS fix: expected "socket-masked", received "socket-present"; D-GIT RED: denied .git/private was readable | process-sandbox.ts:#ipcPaths / nearestProtectedAncestor / topMostProtectedPaths / #arguments
KB-04 | KB-04 read_only rejects escaping cwd…; KB-04 D-CWD rejects a cwd that is a regular file before launch | KE5, not runnable here | process-sandbox.ts:#resolveReadOnlyCwd / #arguments / #run
KB-05 | KB-05 read_only retains output emitted before timeout and cancellation, and reports 32 KiB truncation | KE5, not runnable here (test hardened; no production change needed) | process-sandbox.ts:#run
KB-06 | KB-06 read_only probe reports unavailable and execute refuses to start the command anywhere (GREEN); KB-06 D-PROBE rejects bubblewrap without --ro-bind-fd or --remount-ro and starts nothing | D-PROBE RED: "the wrapper must delegate to a real bubblewrap: process exited 2" | process-sandbox.ts:probe / #arguments
KB-07 | KB-07 authorized Query…; KB-07 the run_readonly_command description discloses…; KB-07 authorized empty-write Work… | description RED: expected 'Run a non-interactive bash command…' to contain 'subprocess timeout keeps the captured output' | readonly-command-tool.ts:description; query-execution.ts / execution-driver.ts injection
KB-08 | KB-08 the real Host startup with the switch off…; KB-08 the real Host settings rebuild…; KB-08 …positive control; KB-08 the real Host narrows a programmatic runtime…; KB-08 a Query / a read-only Work from the real Host with the switch off…; KB-08 partial read prefix / RoleSpec ceiling / non-empty write scope / Host read permission changed… | startup RED: expected [ 'code_index', … ] to not include 'run_readonly_command'; permission RED: startsWith('forbidden:') false | runtime-configuration.ts:narrowResolvedReadonlyCommands / resolve; host.ts:readonlyCommandsDisabledScopes / narrowProgrammaticRuntime; readonly-command-tool.ts permission_denied
KB-09 | KB-09 an authorized Query granted shell, edit and write still sees none of them; KB-09 an empty-write Work granted shell, edit and write publicly rejects…; KB-09 an empty-write Work granted write alone…; KB-09 an empty-write Work granted the model name edit alone is publicly rejected | write/edit-alone RED: expected 'ready' not to be 'ready' (silent no-op, 0 model calls) | execution-preparation.ts:232-235; observed-model-run.ts
KB-10 | KB-10 a non-zero exit / subprocess timeout / out-of-range timeoutMs / unavailable sandbox; KB-10 the capability probe uses the same read-only sandbox options…; KB-10 more than 100 external changed paths…; KB-10 long external changed paths name a literal byte-ordered prefix and bound the COMPLETE result at 128 KiB; KB-10 the complete serialized handler result…; KB-10 an oversized launch-failure message…; KB-10 a sandbox-reported cancellation reports empty output…; KB-10 a real Query whose execution is cancelled mid-command… | RED: expected undefined to be 'execution_failed' (dispatcher dropped the >128 KiB result); expected 131234 to be ≤131072; expected undefined to be the reason marker; expected undefined to be 'invalid_arguments' (unbounded launch message) | readonly-command-tool.ts:boundResult / handler mapping
KB-11 | KB-11 read_only reports another writer's snapshot-visible change… (KE5); KB-11 (KE6) an external change during the command is reported as a path, never as this command's effect | KE6 RED: expected '只读命令期间工作区被其他写者改动：src/racy.txt' to be 'workspace_changed_during_readonly_command: …' | readonly-command-tool.ts external-change branch; process-sandbox.ts:#run read_only effects
```

**CHECKS:**
```
npm run typecheck                                   -> exit 0
npm run check:architecture                          -> exit 0 ("next source boundaries: OK")
npm run build                                       -> exit 0
node scripts/build-kernel-patch.mjs --check         -> exit 0 (all four process-sandbox artifacts matches:true)
npx vitest run tests/kernel/K-readonly-sandbox.test.ts tests/runtime/K-readonly-command.test.ts -> exit 1
  Test Files  1 failed | 1 passed (2)
  Tests       13 failed | 30 passed (43)
  tests/kernel/K-readonly-sandbox.test.ts (14 tests | 13 failed) — every id below; 12 first line =
    AssertionError: read-only sandbox unavailable: ENOENT: no such file or directory, access '/usr/bin/bwrap'
    KB-01 read_only refuses every workspace write and leaves the sentinel byte-identical
    KB-02 read_only lets /tmp and HOME be written, forgets them next call, and never touches the host workspace
    KB-03 read_only blocks the network, reads git, refuses git writes, and cannot use a linked worktree
    KB-04 read_only rejects escaping cwd, hides the parent environment, and closes the inherited root fd
    KB-05 read_only retains output emitted before timeout and cancellation, and reports 32 KiB truncation
    KB-11 read_only reports another writer's snapshot-visible change and never advances the Kernel baseline
    KB-03 D-IPC masks a workspace FIFO and Unix socket so the sandbox cannot reach the host endpoints
    KB-03 D-IPC skips masked protected subtrees so an endpoint there cannot break the launch
    KB-03 D-IPC finds a root-level socket before a deep sibling tree exhausts the walk bound
    KB-03 D-IPC masks a socket and FIFO inside the readable .git mount
    KB-03 D-GIT keeps a Host-denied .git subtree hidden while git still reads history
    KB-04 D-CWD rejects a cwd that is a regular file before launch
    KB-06 D-PROBE rejects bubblewrap without --ro-bind-fd or --remount-ro and starts nothing — first line:
      AssertionError: the wrapper must delegate to a real bubblewrap: process exited 2 (its passthrough control; real bwrap absent)
  (GREEN: KB-06 read_only probe reports unavailable and execute refuses to start the command anywhere; all 29 runtime tests GREEN
   including D-PROBE wiring, complete-result bound, long paths, launch-message bound and cancellation.)

npx vitest run <the 42-path regression list of section 8> -> exit 1
  Test Files  15 failed | 29 passed (44)
  Tests       44 failed | 302 passed | 29 skipped (375)
  44 failures = the 31 baseline sandbox-kind failures of DSH-BASELINE.md + the 13 new KE5 tests. Per-file counts match
  the baseline exactly: MVP-workbench-tools 1, R6-host 1, business/R5b-initial-planning-workflow 1,
  composition/A2-requeue-platform 5, A2-reverify-platform 1, A2-verification-chain-platform 6,
  R3e-command-check-platform 2, R3e-completion-platform 1, R5c-workflow-platform 3, C5-gate-fix-open 1,
  C5-gate-fix 2, C5-reverify-guards 5, C8-human-stop-respected 2, plus tests/kernel/K-readonly-sandbox 13.
  First lines are the documented sandbox kind ("expected 'waiting' to be 'completed'", "the round must finalize",
  "the Workflow must reach the gate open", requeue busy, registered check rejected, ~/usr/bin/bwrap ENOENT, …).
  No non-baseline, non-KE5 failure. tests/state/invariants.test.ts is a pre-existing failed suite (0 tests, 29 skipped),
  not in DSH-BASELINE.md (reproduced on pristine slice-setup in the previous session).

sha256sum …/slice-K-SPEC.md DSH-BASELINE.md          -> exit 0, both hashes exact
  0a2b5acf813bdaae7e92c3833fcdc08373184e282e94690af884ec0c7ee75a6c
  0dd5663f487cef4c1a11efa6da837f8263f1cb2f3288f35bc86846a7f71f3c92
git diff --stat slice-base -- tests                 -> exit 0; only the 3 new K files (helpers 134, kernel 655, runtime 1023)
git status --short                                  -> exit 0; only L-scope paths (7 modified src + new tool + 3 new tests
                                                       + 4 process-sandbox dist artifacts + the patch source); no docs/lock/UI
fresh frozen-file diff (dispatcher, policy, shell-tool, tool-executor-port) -> empty
HEAD                                                -> df5347f (no commit); ./.dsh-scratch/ deleted
```

**UNSPECIFIED:**
- **L-scope/L-build/L-kernel/L-reach — done.** Only L-scope files; generated only via `build-kernel-patch.mjs --write`; `--check` exit 0; frozen dispatcher/policy/shell/executor-port untouched; `production-reach` + `boundaries` 33/33 green (subagent run), allowlist untouched.
- **D-IPC residual (recorded, not fixed):** a socket/FIFO created *while* the command runs is not masked; the walk is bounded (`ProcessSandboxOptions.ipcWalkMaxEntries`, new optional field, no new export) and entries beyond the bound are a residual. The walk is now breadth-first so root/shallow endpoints are always reached, skips masked protected subtrees, and enters only the readable `.git`.
- **D-IPC mechanism nuance:** the binding's `/dev/null` mask makes a masked FIFO *write succeed to /dev/null* rather than "fail or block"; the test now asserts the concrete `wrote` outcome plus zero bytes/connections at the host reader. The lead fixed the mechanism, so this is a wording discrepancy only.
- **D-PROBE tool call site:** the tool has no `bwrapPath` and sets no custom `protectedPaths`, so the shared `sandboxOptions` object contains `workspaceMode`, `readOnlyPaths`, `executablePath` (exactly what it gives `new ProcessSandbox`).
- **Test environment dependency:** the KE5 socket-connect probe uses `python3` inside the sandbox, and the KB-03 network case assumes `timeout`/`/dev/tcp`; the KE5 host must have them.
- **Work public reader seam:** the B2 fixture's Runtime port leaves `readSessionHistory` as the base stub, so the helper exposes `sessionOperations.readSessionHistory` (the same public reader the composition root wires).
- **Real-Host coverage shape:** D-SWITCH startup and settings-rebuild wiring is proven through a real `createLocalWorkbenchHost` with the scripted model over the public HTTP Query chain; the Work switch case remains at the KE6 factory boundary (the full Goal/Plan/Task HTTP claim flow was not built out). This is the one literal D-SWITCH test shape not exercised end-to-end for Work.
- **Names not fixed by the spec:** `WorkbenchRuntimeNarrowing`, `narrowResolvedReadonlyCommands`, `narrowProgrammaticRuntime`, `readonlyCommandsDisabledScopes`, `ipcWalkMaxEntries`. The real-Host Query test also raises the Query job `budget.maxTokens` 4096→200000 because the real factory supplies no `inputCounter`.
- **Error codes / bound:** the frozen enum has neither `forbidden` nor `workspace_changed_during_readonly_command`; mapped per D-CODES (lead records §9 M10) and the 100-path cap per D-BOUND (lead records §9 M11) — no frozen file was edited.
- **Existing tests:** none found that contradict the spec.

**NOTES:**
- Subagents: S `8a3e851f`, T `e2185ecf`, S review `ac4acf30`, T review `6b089770`; S and T each re-run once for their self-check fixes. The final revision was validated by the section-6 checks, not by a second read-only review.
- KE5 rows not runnable here: KB-01…KB-06 and KB-11 (13 tests) fail only with the sandbox kind (`ENOENT /usr/bin/bwrap`); the one green kernel case is KB-06 absent-bwrap. The lead must run `tests/kernel/K-readonly-sandbox.test.ts` with real bubblewrap (and `python3`).
- `.dsh-ref/r2/first-report.md` is superseded: this round changed `runtime-configuration.ts`, made the external-change message path-free, uses real probe options, and bounds the complete result.
- `.dsh-scratch/` deleted; no commit (HEAD still `df5347f`); spec/baseline sha256 exact; `git status` and the tests diff contain only L-scope/new K paths.
- The previous fix round had left an availability regression when a socket sat under a masked `.git/private`; the self-check caught it and it is fixed and covered.

**REVIEW:**
- **Finding 1 (D-IPC) — fixed.** `process-sandbox.ts:#ipcPaths` (BFS, `nearestProtectedAncestor`, mask via `--ro-bind /dev/null` in `#arguments`). Tests: `KB-03 D-IPC masks a workspace FIFO and Unix socket so the sandbox cannot reach the host endpoints`; `KB-03 D-IPC skips masked protected subtrees so an endpoint there cannot break the launch`; `KB-03 D-IPC finds a root-level socket before a deep sibling tree exhausts the walk bound`; `KB-03 D-IPC masks a socket and FIFO inside the readable .git mount`. Residual: endpoints created during the command (lead-owned).
- **Finding 2 (D-GIT) — fixed.** `process-sandbox.ts:topMostProtectedPaths` / `#arguments`; test `KB-03 D-GIT keeps a Host-denied .git subtree hidden while git still reads history` (denied `.git/private` + file unreadable, `git log` exit 0).
- **Finding 3 (D-SWITCH) — fixed.** `runtime-configuration.ts:narrowResolvedReadonlyCommands` + `resolve`; `host.ts:readonlyCommandsDisabledScopes` / `narrowProgrammaticRuntime` at both startup and settings rebuild, plus the programmatic `options.runtime` path. Tests: `KB-08 the real Host startup with the switch off hides run_readonly_command from a Query`; `KB-08 the real Host settings rebuild with the switch off hides run_readonly_command from a Query`; `KB-08 the real Host startup with the switch on still grants run_readonly_command (positive control)`; `KB-08 the real Host narrows a programmatic runtime that lists run_readonly_command`; `KB-08 a Query from the real Host with the switch off does not see run_readonly_command`; `KB-08 a read-only Work from the real Host with the switch off does not see run_readonly_command`.
- **Finding 4 (D-BOUND) — fixed.** `readonly-command-tool.ts:boundResult` measures the complete serialized result, trims captured output first then the byte-ordered paths (growing `externalChangedPathsOmitted`), and trims the launch `error.message` as a last resort. Tests: `KB-10 long external changed paths name a literal byte-ordered prefix and bound the COMPLETE result at 128 KiB` (literal first 85, omitted 15); `KB-10 the complete serialized handler result stays within the 128 KiB definition limit`; `KB-10 more than 100 external changed paths are named 100 in byte order plus the omitted count`; `KB-10 an oversized launch-failure message is bounded and still reaches the model`.
- **Finding 5 (D-PROBE) — fixed.** `process-sandbox.ts:probe` now takes `protectedPaths/readOnlyPaths/executablePath` (cache key = configuration) and `#arguments` always emits `--ro-bind-fd` and `--remount-ro` (scratch tmpfs when no protected dir); `readonly-command-tool.ts` passes one `sandboxOptions` object to both `probe` and `new ProcessSandbox`. Tests: `KB-06 D-PROBE rejects bubblewrap without --ro-bind-fd or --remount-ro and starts nothing`; `KB-10 the capability probe uses the same read-only sandbox options as the command it authorizes`.
- **Finding 6 (D-CWD) — fixed.** `process-sandbox.ts:#resolveReadOnlyCwd` resolves once, requires a directory and passes the validated relative path; `#arguments` adds the `pwd -P` `/workspace` containment guard; `#run` maps the marker to `invalid_arguments`; no host-root fd is passed. Tests: `KB-04 D-CWD rejects a cwd that is a regular file before launch`; `KB-04 read_only rejects escaping cwd, hides the parent environment, and closes the inherited root fd`.
- **Finding 7 (D-DESC) — fixed.** `readonly-command-tool.ts:description`; test `KB-07 the run_readonly_command description discloses timeout retention, cancellation replacement, read-only git and hidden denied paths`.
- **Error-code note (D-CODES) — fixed.** `readonly-command-tool.ts` returns `permission_denied` with a `forbidden:`-prefixed message, and `execution_failed` / `retryable:false` / fixed path-free message plus the JSON item `{ reason: 'workspace_changed_during_readonly_command', externalChangedPaths, externalChangedPathsOmitted, … }` (M10). Tests: `KB-08 a Query whose Host read permission changed during execution gets forbidden and starts nothing`; `KB-11 (KE6) an external change during the command is reported as a path, never as this command's effect`; the KB-10 path tests assert `reason`.
- **KB-01 / KB-02 — covered (kept).** Real KE5 tests; names as in ROWS.
- **KB-03 — covered and extended.** Network/git cases kept; the four D-IPC and the D-GIT tests above were added/fixed.
- **KB-04 — fixed/covered.** Escaping cwd + env + fd kept; D-CWD case added.
- **KB-05 — fixed (test-only).** `KB-05 read_only retains output emitted before timeout and cancellation, and reports 32 KiB truncation` now emits and asserts pre-timeout and pre-cancel output; capture already retained it.
- **KB-06 — fixed.** `KB-06 read_only probe reports unavailable…` (green here) + `KB-06 D-PROBE rejects bubblewrap without --ro-bind-fd or --remount-ro and starts nothing` (unsupported-option half).
- **KB-07 — fixed.** Public `readSessionHistory` + `sessionRecordSchema` (private decoders removed); Work now `prepareExecution/startRun/observeRun` and asserts the saved call/output. Tests: the three KB-07 names.
- **KB-08 — fixed.** Real `createLocalWorkbenchHost` startup + settings rebuild with the explicit binding; plus partial prefix, RoleSpec ceiling, non-empty write scope and mid-execution permission change.
- **KB-09 — fixed.** Query and Work now grant `shell`/`edit`/`write`; `execution-preparation.ts:232-235` publicly rejects a granted `write`/`edit` with an empty write scope; tests isolate `write` alone and `edit` alone as well as the combined grant.
- **KB-10 — fixed.** Complete-result bound and independently specified byte-ordered prefix (85 literal / 15 omitted), >100 cap, capability-probe option parity, oversized launch message, cancellation-empty-output, real Query cancellation.
- **KB-11 — covered.** KE5 drift test and KE6 external-change test; `sideEffect:none`, baseline not advanced.
- **Per-file TDD assessment — addressed.** Removed: constructor-mode assertions, the `timeoutMs` forwarding assertion, the direct tool/dispatcher construction, the exported `localWorkbenchGrant` helper test and the direct resolution-boundary test (replaced by the real-Host tests); history decoded only through the public reader; Work cases now call `observeRun`. Remaining note: the capability-probe test is mock-call-level but the Kernel sandbox boundary is explicitly permitted for KE6.