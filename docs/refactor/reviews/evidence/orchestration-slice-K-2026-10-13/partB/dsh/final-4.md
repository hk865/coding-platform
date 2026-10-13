All checks are done and the workspace is clean. Final reply:

**FILES CHANGED**
```
vendor/coding-agent/patches/sandbox/process/process-sandbox.ts        (S, this session)
vendor/coding-agent/dist/sandbox/process/process-sandbox.js           (S, regenerated)
vendor/coding-agent/dist/sandbox/process/process-sandbox.js.map       (S, regenerated)
vendor/coding-agent/dist/sandbox/process/process-sandbox.d.ts         (S, regenerated)
vendor/coding-agent/dist/sandbox/process/process-sandbox.d.ts.map     (S, regenerated)
tests/kernel/K-readonly-sandbox.test.ts                               (S, this session)
tests/runtime/K-readonly-command.test.ts                              (T, this session)
-- unchanged this session, earlier rounds --
src/app/host.ts ; src/app/runtime-configuration.ts
src/core/agent-runtime/execution-contracts.ts ; execution-driver.ts ; execution-preparation.ts
src/core/agent-runtime/observed-model-run.ts ; query-execution.ts
src/core/agent-runtime/readonly-command-tool.ts (new)
tests/helpers/K-readonly-work-support.ts (new) ; tests/helpers/K-readonly-host-support.ts (new, untracked)
```

**ROWS**
```
D-ONECHECK | KB-03 D-ONECHECK plans a file .git as masked and drops every protected descendant | TypeError: planReadonlyMounts is not a function | process-sandbox.ts:200 planReadonlyMounts
D-ONECHECK | KB-03 D-ONECHECK keeps directory .git descendant overlays and skips exactly the masked subtrees | same RED | process-sandbox.ts:200/251 readonlyIpcSkips
D-ONECHECK | KB-03 D-ONECHECK gives a missing protected path no overlay | same RED | process-sandbox.ts:200
D-ONECHECK | KB-03 D-ONECHECK drops a protected descendant under a masked non-.git ancestor | same RED | process-sandbox.ts:200
D-ONECHECK | KB-03 D-ONECHECK fails closed when .git is replaced by a directory after the mount snapshot | KE5, not runnable here | process-sandbox.ts:687 classifyProtectedPaths / :540 #run / :760 #arguments
D-DOUBLE  | KB-10 the read-only sandbox capability is probed with the command's actual options ; KB-10 a read-only capability probe that does not match the command options refuses and starts nothing | (test-double rewrite, no new RED) | K-readonly-command.test.ts:80 matchesReadOnlyOptions / :87 KProcessSandbox / :105 execute
```

**CHECKS**
```
npm run typecheck                     exit 0
npm run check:architecture            exit 0 (next source boundaries: OK)
npm run build                         exit 0
node scripts/build-kernel-patch.mjs --check   exit 0 (all 56 artifacts matches:true)
```
`npx vitest run tests/kernel/K-readonly-sandbox.test.ts tests/runtime/K-readonly-command.test.ts` → exit 1: `Test Files 1 failed | 1 passed (2)`, `Tests 15 failed | 38 passed (53)`. Runtime file 33/33 pass. Kernel file 5 pass (4 pure D-ONECHECK + pre-existing `KB-06 read_only probe reports unavailable…`); the 15 failures are the KE5 sandbox-kind set:
- 14 × `AssertionError: read-only sandbox unavailable: ENOENT: no such file or directory, access '/usr/bin/bwrap'` — KB-01; KB-02; KB-03 read_only blocks the network…; KB-03 D-GIT keeps a Host-denied .git subtree hidden…; KB-03 D-GITFILE keeps ordinary commands working…; KB-03 D-IPC masks a workspace FIFO and Unix socket…; KB-03 D-IPC skips masked protected subtrees…; KB-03 D-IPC finds a root-level socket…; KB-03 D-IPC masks a socket and FIFO inside the readable .git mount; **KB-03 D-ONECHECK fails closed when .git is replaced by a directory after the mount snapshot**; KB-04 read_only rejects escaping cwd…; KB-04 D-CWD rejects a cwd that is a regular file…; KB-05 read_only retains output…; KB-11 read_only reports another writer's….
- 1 × `AssertionError: the wrapper must delegate to a real bubblewrap: process exited 127` — KB-06 D-PROBE rejects bubblewrap without --ro-bind-fd or --remount-ro.

Regression run (first brief §8 list) → exit 1: `Test Files 15 failed | 29 passed (44)`, `Tests 46 failed | 306 passed | 29 skipped (381)`. Exactly `31` baseline sandbox-kind test failures in the 13 `DSH-BASELINE.md` files + the `15` KE5 tests above = 46. Per-file baseline counts: MVP-workbench-tools 1, R6-host 1, R5b-initial-planning-workflow 1, A2-requeue-platform 5, A2-reverify-platform 1, A2-verification-chain-platform 6, R3e-command-check-platform 2, R3e-completion-platform 1, R5c-workflow-platform 3, C5-gate-fix-open 1, C5-gate-fix 2, C5-reverify-guards 5, C8-human-stop-respected 2. First lines are the sandbox-kind classes (`Error: the round must finalize`, `Error: the Workflow must reach the gate open`, `expected 'waiting' to be 'stopped'`, `expected { status: 'ready' } to match object { effectivePhase: 'failed' }`). The run also has 1 failed suite, `tests/state/invariants.test.ts` (29 skipped), which is the source of the baseline's 29 skipped, not a new test failure.
```
sha256sum slice-K-SPEC.md        0a2b5acf…e75a6c   (frozen value holds)
sha256sum DSH-BASELINE.md        0dd5663f…f71f3c92 (frozen value holds)
git diff --stat slice-base -- tests   only the 3 new test files (K-readonly-work-support, K-readonly-sandbox, K-readonly-command)
git status --short                    only L-scope paths (see FILES CHANGED)
.dsh-scratch/                         deleted; HEAD still df5347f (no commit)
```

**UNSPECIFIED**
- L-scope: done. Only the sandbox patch, its generated files, and `tests/kernel/K-readonly-sandbox.test.ts` (S); only `tests/runtime/K-readonly-command.test.ts` (T); no other file changed this session.
- L-build: done (`--write` then `--check` exit 0).
- L-reach / L-interfaces / L-kernel: done; `check:architecture` OK, dispatcher/policy untouched, `read_write` mount loop kept verbatim.
- The four pure D-ONECHECK tests import `planReadonlyMounts`/`readonlyIpcSkips` from `vendor/coding-agent/dist/sandbox/process/process-sandbox.js`. `patches/public-api.ts`/`dist/public-api.js` are outside L-scope, so the new export is not surfaced through `public-api`; the KE5 entry itself remains `public-api`.
- D-ONECHECK residual (frozen decision, not a gap): a protected path classified `absent` gets no overlay and is not treated as a masking ancestor; if a concurrent writer creates it after the snapshot there is no bind for bwrap to refuse. The plan never prunes a descendant from a non-existent mask.
- Group S test (b) needed no production hook: a delegating `Proxy` `WorkspaceSandbox` (`K-readonly-sandbox.test.ts:130 flipGitFileToDirectoryOnSnapshot`) flips `.git` file→directory inside `snapshot()`, after the one-shot classification and before launch. It cannot run here (no bwrap) and is in the KE5 set for the lead.
- T's `sandbox.probes` remains a pre-existing unused record; only `constructorOptions`, `calls` and the global `readOnlyCapability` were removed as directed.
- No existing test contradicts the spec.

**REVIEW**
- **Finding 1 — fixed.** One classification per execution (`ProcessSandbox#classifyProtectedPaths`, `process-sandbox.ts:687`, called at the top of `#run` `:540` before any snapshot/root-fd call and before argument building) feeds one pure `planReadonlyMounts(snapshot)` (`:200`); the read-only mount loop (`#arguments` `:760`) and IPC skips (`readonlyIpcSkips` `:251`, used at `#ipcPaths` `:724`) consume only that plan, so no later `lstat`/`stat` of `.git` or a protected path decides anything. Pruning follows the actual selected masking mount, a readable directory `.git` keeps descendant overlays, `ENOENT`/`ENOTDIR` gives no overlay, symlink/other fails closed. Tests: `KB-03 D-ONECHECK plans a file .git as masked and drops every protected descendant` (:673), `…keeps directory .git descendant overlays and skips exactly the masked subtrees` (:692), `…gives a missing protected path no overlay` (:726), `…drops a protected descendant under a masked non-.git ancestor` (:742), `…fails closed when .git is replaced by a directory after the mount snapshot` (:759, real bwrap, lead).
- **Finding 2 — fixed.** `KProcessSandbox` now keeps `instanceOptions` (`tests/runtime/K-readonly-command.test.ts:87`) and `execute` (`:105`) refuses with the real `ProcessSandboxError('sandbox_unavailable', …)` unless the instance's own options satisfy `matchesReadOnlyOptions` (`:80`: `workspaceMode === 'read_only'`, plus the test-declared `readOnlyPaths`/`executablePath` when set). Assertions stay on public results and `sandbox.commands`; constructor-option recording/assertions are gone. Tests: `KB-10 the read-only sandbox capability is probed with the command's actual options` and `KB-10 a read-only capability probe that does not match the command options refuses and starts nothing`.
- **D-DOUBLE probe result.** One throwaway `.dsh-scratch/` script mutated `src/core/agent-runtime/readonly-command-tool.ts:239` `workspaceMode: 'read_only' as const` → `'read_write' as const`, then ran `npx vitest run tests/runtime/K-readonly-command.test.ts -t "probed with the command's actual options"`. Unmutated: pass. Mutated: **FAIL** — `AssertionError: expected 'error' to be 'success'` at test line 909 (`Tests 1 failed | 32 skipped`, exit 1). The script restored the file (sha256 `be2e9ac0…` before = after, `cmp` byte-identical), then deleted itself; `.dsh-scratch/` is gone and the tool file is untouched.

**NOTES**
- Two subagents ran in parallel: group S (sandbox/D-ONECHECK) and group T (test double/D-DOUBLE); both completed and reported; I verified their diffs and preserved lead changes (reverted prepare-time guard, KE5 wrapper loop `:`, FIFO `wrote|blocked`, KB-09 tests).
- KE5 rows not runnable here (no bubblewrap): all 15 sandbox-kind failures above, including the new interleaving test; the lead runs them with real bwrap.
- The 29-skipped `tests/state/invariants.test.ts` failed suite is pre-existing (it is exactly the baseline's 29 skipped); it adds no test failure beyond the 31 sandbox-kind baseline.
- Full checks ran once after both groups finished; `.dsh-scratch/` deleted; no commit.