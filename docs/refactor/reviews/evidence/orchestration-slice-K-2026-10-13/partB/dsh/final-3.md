All work is complete. Final report follows.

## FILES CHANGED
- `src/app/host.ts` *(prior session; unchanged this round)*
- `src/app/runtime-configuration.ts` *(prior session; unchanged this round)*
- `src/core/agent-runtime/execution-contracts.ts` *(prior session)*
- `src/core/agent-runtime/execution-driver.ts` *(prior session)*
- `src/core/agent-runtime/execution-preparation.ts` *(prior session; prepare-time guard kept reverted)*
- `src/core/agent-runtime/observed-model-run.ts` *(prior session; start-time guard is the only one)*
- `src/core/agent-runtime/query-execution.ts` *(prior session)*
- `src/core/agent-runtime/readonly-command-tool.ts` *(this round: D-ID)*
- `tests/helpers/K-readonly-work-support.ts` *(prior session; unchanged)*
- `tests/helpers/K-readonly-host-support.ts` *(new this round: real-Host Work support)*
- `tests/kernel/K-readonly-sandbox.test.ts` *(this round: new KB-03 D-GITFILE test)*
- `tests/runtime/K-readonly-command.test.ts` *(this round: D-ID tests + four review test fixes)*
- `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts` *(this round: D-GITFILE)*
- `vendor/coding-agent/dist/sandbox/process/process-sandbox.js`, `.js.map`, `.d.ts.map` *(regenerated via `--write`; `.d.ts` unchanged)*

## ROWS
- KB-01 | `KB-01 read_only refuses every workspace write and leaves the sentinel byte-identical` (kernel) | KE5, not runnable here | `process-sandbox.ts:execute/#arguments`
- KB-02 | `KB-02 read_only lets /tmp and HOME be written…` (kernel) | KE5, not runnable here | `process-sandbox.ts:execute`
- KB-03 | `KB-03 read_only blocks the network, reads git…`, `KB-03 D-IPC masks a workspace FIFO and Unix socket…`, `KB-03 D-IPC skips masked protected subtrees…`, `KB-03 D-IPC finds a root-level socket…`, `KB-03 D-IPC masks a socket and FIFO inside the readable .git mount`, `KB-03 D-GIT keeps a Host-denied .git subtree hidden…`, **`KB-03 D-GITFILE keeps ordinary commands working when a linked worktree's .git is a file with a denied descendant`** (kernel) | KE5, not runnable here | `process-sandbox.ts:topMostProtectedPaths`, `#arguments` (D-GITFILE), `#ipcPaths`, `#ensureReadOnlyReady`
- KB-04 | `KB-04 read_only rejects escaping cwd…`, `KB-04 D-CWD rejects a cwd that is a regular file before launch` (kernel) | KE5, not runnable here | `process-sandbox.ts:#resolveReadOnlyCwd`, `READONLY_CWD_GUARD`
- KB-05 | `KB-05 read_only retains output emitted before timeout and cancellation…` (kernel) | KE5, not runnable here | `process-sandbox.ts:execute`
- KB-06 | `KB-06 read_only probe reports unavailable…`, `KB-06 D-PROBE rejects bubblewrap without --ro-bind-fd or --remount-ro…` (kernel) | KE5, not runnable here | `process-sandbox.ts:probe`
- KB-07 | `KB-07 authorized Query sees run_readonly_command…`, `KB-07 the run_readonly_command description…`, `KB-07 authorized empty-write Work sees run_readonly_command…` (runtime) | pass | `readonly-command-tool.ts:createReadonlyCommandTool`
- KB-08 | `KB-08 …real Host…` Query/Work/switch/programmatic/role-ceiling/write-scope/permission tests (runtime) | pass | `host.ts:narrowProgrammaticRuntime`/`narrowResolvedReadonlyCommands`, `runtime-configuration.ts`
- KB-09 | `KB-09 an authorized Query granted shell, edit and write…`, `KB-09 an empty-write Work granted shell, edit and write publicly rejects…`, **`KB-09 an empty-write Work granted write alone stays at the start-time guard with zero model calls`**, `KB-09 an empty-write Work granted the model name edit alone is publicly rejected` (runtime) | pass | `observed-model-run.ts:239` (start-time guard; unchanged)
- KB-10 | `KB-10` mapping / probe / paths / bound tests incl. **`KB-10 a provider call identity larger than the budget never shortens a bounded launch diagnostic`**, **`KB-10 an early permission refusal with an oversized input is bounded and names the public code`** (runtime) | RED→GREEN for the callId test | `readonly-command-tool.ts:measuredBytes/boundResult` + four early returns
- KB-11 | `KB-11 read_only reports another writer's snapshot-visible change…` (kernel), `KB-11 (KE6) an external change during the command…` (runtime) | KE5 not runnable here / KE6 pass | `process-sandbox.ts:execute` snapshot diff, `readonly-command-tool.ts` external-change result

## CHECKS
- `npm run typecheck` → **exit 0**
- `npm run check:architecture` → **exit 0** (`next source boundaries: OK`)
- `npm run build` → **exit 0**
- `node scripts/build-kernel-patch.mjs --check` → **exit 0** (all artifacts `matches: true`)
- `npx vitest run tests/kernel/K-readonly-sandbox.test.ts tests/runtime/K-readonly-command.test.ts` → **exit 1**; `Test Files 1 failed | 1 passed (2)`; `Tests 14 failed | 34 passed (48)`. The runtime file has **0 failures** (33 pass). All 14 failures are the KE5 kernel tests (13 × `AssertionError: read-only sandbox unavailable: ENOENT … access '/usr/bin/bwrap': expected false to be true`; `KB-06 D-PROBE` × `AssertionError: the wrapper must delegate to a real bubblewrap: process exited 127: expected false to be true`). Failed ids: KB-01, KB-02, KB-03 (base + D-IPC ×4 + D-GIT + **D-GITFILE**), KB-04 (base + D-CWD), KB-05, KB-06 base, KB-06 D-PROBE, KB-11.
- Regression (the exact 43-entry list) → **exit 1**; `Test Files 15 failed | 29 passed (44)`; `Tests 45 failed | 302 passed | 29 skipped (376)`. Counted test failures are exactly the **31 baseline** sandbox-kind tests (`MVP-workbench-tools 1, R6-host 1, R5b-initial-planning 1, A2-requeue 5, A2-reverify 1, A2-verification-chain 6, R3e-command-check 2, R3e-completion 1, R5c-workflow 3, C5-gate-fix-open 1, C5-gate-fix 2, C5-reverify-guards 5, C8-human-stop 2`) **plus the 14 new KE5 tests**. Additionally the pre-existing suite-level `beforeAll` error in `tests/state/invariants.test.ts` (`finalize_first: round … is open`) is reported as `FAIL tests/state/invariants.test.ts [ … ]`; its 29 tests are the 29 skipped, which is exactly the baseline's 29 skipped (see UNSPECIFIED/NOTES).
- `sha256sum docs/…/slice-K-SPEC.md DSH-BASELINE.md` → `0a2b5acf…a6c` and `0dd5663f…c92` (match the frozen values).
- `git diff --stat slice-base -- tests` → only the three K test files, all additions (no existing test modified).
- `git status --short` → 17 paths, all L-scope (plus the new untracked `tests/helpers/K-readonly-host-support.ts`, explicitly allowed). `.dsh-scratch/` deleted; `HEAD` unchanged at `df5347f`; **no commit**.
- Extra (binding L-reach, not in the section 8 list): `npx vitest run tests/architecture/production-reach.test.ts tests/architecture/boundaries.test.ts` → **exit 0**, `Tests 33 passed`.

## REVIEW
**Review problem 1 (file-form `.git` + denied descendant) — FIXED.**
Test: `KB-03 D-GITFILE keeps ordinary commands working when a linked worktree's .git is a file with a denied descendant`, `tests/kernel/K-readonly-sandbox.test.ts`. Implementation: `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:topMostProtectedPaths` (now takes `readableAncestors`; only a real `.git` directory is non-masking) and `#arguments` (lstat `.git`, classify; mount-loop catch ignores `ENOTDIR` alongside `ENOENT`). KE5 cannot run here (fails sandbox-kind, as intended); the lead must run it with bubblewrap.

**Review problem 2 (complete-result bound / call ID) — FIXED as decided.**
Tests: `KB-10 a provider call identity larger than the budget never shortens a bounded launch diagnostic` and `KB-10 an early permission refusal with an oversized input is bounded and names the public code`, `tests/runtime/K-readonly-command.test.ts`. Implementation: `src/core/agent-runtime/readonly-command-tool.ts:measuredBytes` (serializes with `callId:''` so the budget covers everything the tool produces except the provider ID) used by `boundResult`; the four early returns (invalid args, invalid cwd, `current()` threw, stale permission) now return through `boundResult`; the last-resort error-message trim is skipped for the fixed `WORKSPACE_CHANGED_MESSAGE`. Captured output is still trimmed before named paths.

**Should-fix 1 (actual Host-started Work) — FIXED.**
Tests: `KB-08 a read-only Work started by the real Host with the switch off never sees run_readonly_command` and positive control `KB-08 the same real Host Work with the switch on still sees run_readonly_command`, `tests/runtime/K-readonly-command.test.ts`; new helper `tests/helpers/K-readonly-host-support.ts:startKReadonlyRealHost` starts the real `createLocalWorkbenchHost` with `allowReadonlyCommands:false` and an explicit work binding listing the tool + `readonlyCommandAccess:'all_except_denied'`, seeds the AG2b graph and drives the Work through the public `workflow/driver-start` route.

**Should-fix 2 (KB-09 write-alone) — FIXED (with a stated limit).**
Test: `KB-09 an empty-write Work granted write alone stays at the start-time guard with zero model calls`, `tests/runtime/K-readonly-command.test.ts`. It now asserts the exact public start result and observed Run (`{status:'ready', value:{run:{status:'starting', outcome:null}}}`) and zero model calls, instead of a conditional "not completed". The literal guard reason (`observed-model-run.ts:239`) is swallowed by `execution-driver.ts:936-942` and is not exposed by any public reader, so the test names the guard in a comment rather than asserting the string; if the lead requires the literal reason, it is not publicly observable.

**Should-fix 3 (constructor coupling) — FIXED.**
Tests: `KB-10 the read-only sandbox capability is probed with the command's actual options` and `KB-10 a read-only capability probe that does not match the command options refuses and starts nothing`, `tests/runtime/K-readonly-command.test.ts`. The sandbox double now refuses `probe`/`execute` unless its options match `sandbox.expectedReadOnlyOptions`; the assertions are the public tool result and `sandbox.commands`. No test reads the construction count or constructor arguments.

**Should-fix 4 (ordering) — FIXED.**
Tests: `KB-10 more than 100 external changed paths are named 100 in byte order plus the omitted count` and `KB-10 long external changed paths name a literal byte-ordered prefix and bound the COMPLETE result at 128 KiB`, `tests/runtime/K-readonly-command.test.ts`. Inputs are now fed reversed/shuffled and include byte-order-sensitive names (`Apple`/`Zebra` before `apple`; multi-byte `Ärger`), compared against a handwritten `byteOrdered` prefix; omitted counts 4 and 15.

## UNSPECIFIED
- **L-scope:** done. Only L-scope paths changed (see `git status --short`); added helper named `tests/helpers/K-readonly-host-support.ts`.
- **L-tdd:** done. D-ID was RED→GREEN (`expected 'c' to be 'cwd: not a directory'` → pass); the four test rewrites are test-only with old/new logs; D-GITFILE's test was written before the production edit (KE5 RED recorded as "not runnable here").
- **L-reach:** done — `tests/architecture/production-reach.test.ts` passes; no new production export was added.
- **L-interfaces:** unchanged this round; names/fields as before.
- **L-kernel:** `read_write` is otherwise untouched; the one edge delta is the mandated shared-loop `ENOTDIR` skip (previously `launch_failed`, now treated as "path does not exist"). The binding decision is mode-agnostic; flagged because it is a strict reading of "byte-for-byte `read_write`".
- **L-build:** done (`--write` then `--check` exit 0).
- **D-ID reachability:** the invalid-arguments and invalid-cwd early returns cannot be reached through the KE6 entry (the frozen dispatcher validates `inputSchema`; the permission policy normalizes cwd upstream), so the required oversized-input test exercises the reachable permission refusal; all four returns are still routed through `boundResult`.
- **Fixed-message guard:** defensive only (after output/path trimming the short fixed message always fits); no test can force the fallback onto it, and the long-path test asserts the message verbatim.
- **`tests/state/invariants.test.ts`:** its suite-level `beforeAll` failure is pre-existing and environmental (no bubblewrap → the registered check cannot finalize the round). Its 29 tests are the only skipped tests, matching the baseline's 29 skipped exactly; it is not a regression and not caused by these changes.
- No spec/test contradiction found.

## NOTES
- Subagents: group S (D-GITFILE) and group T (D-ID + four test fixes), disjoint files, both reported; no cross-edits.
- KE5 rows not runnable here (no bubblewrap): KB-01..KB-06 and the KE5 half of KB-11; the lead must run `tests/kernel/K-readonly-sandbox.test.ts` with real bwrap.
- Full regression reproduces the expected arithmetic: 45 counted failures = 31 baseline sandbox-kind + 14 new KE5; 302 pass; 29 skipped.
- No real model calls; network only on the real Host's own loopback listener; ports 3080/3099/44797 untouched; one vitest command at a time.
- `./.dsh-scratch/` deleted; no git write commands; no commit (HEAD `df5347f`).
- Frozen sha256 values hold; `git diff --stat slice-base -- tests` lists only additions; no existing test was modified.