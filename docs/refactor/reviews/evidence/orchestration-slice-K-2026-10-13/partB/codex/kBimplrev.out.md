**Verdict: not ready.** I reviewed the working-tree diff and all four untracked files without changing files or running tests. The reported 26 passing tests and build checks do not cover the issues below.

1. **Must fix before merge — filesystem IPC can bypass the isolation claim.**  
   [process-sandbox.ts:582](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:582), `#arguments`. The whole-workspace bind exposes existing pathname Unix sockets and FIFOs. Read-only mounts prevent ordinary filesystem mutations; `--unshare-net` does not isolate pathname Unix sockets. No additional restriction blocks these endpoints.

   Concrete scenario: a host service listens on `workspace/service.sock` and supports file writes or network proxying. A sandboxed command connects to `/workspace/service.sock` and asks that service to write a host file or make a network request. This requires an existing accessible service; it is not an unconditional escape in every workspace. Bubblewrap explicitly warns that exposed sockets can enable commands outside the sandbox. [Official limitations](https://github.com/containers/bubblewrap#limitations); [Linux pathname-socket lookup](https://github.com/torvalds/linux/blob/master/net/unix/af_unix.c).

   **Spec:** L13, §4 rule 7; undermines L15’s unconditional `sideEffect: 'none'`.  
   **Fix:** prevent access to host IPC endpoints using a stable filesystem view containing permitted file types, or equivalent enforced restrictions covering both sockets and FIFOs. Scanning and masking existing endpoints once is insufficient when concurrent writers can create new ones.

2. **Must fix before merge — explicit denied paths beneath `.git` become readable.**  
   [process-sandbox.ts:139](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:139), `topMostProtectedPaths`; [line 598](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:598), `#arguments`.

   Default protection includes `.git`, so ancestor elimination removes a Host denial such as `.git/private`. But `.git` is subsequently bound with its contents visible, rather than masked empty. Thus `cat /workspace/.git/private` reveals a Host-hidden file. Runtime `deniedPrefixes` reach this code through `runObservedModel.workspaceOptions`; the scenario is reachable. The canary checks writability, not confidentiality.

   **Spec:** L13’s protected-path masking, L17’s Host hidden prefixes, L18’s `all_except_denied`.  
   **Fix:** eliminate descendants only beneath genuinely masked ancestors. Preserve explicit denial overlays beneath the readable `.git` mount. Add a real KE5 assertion for denied `.git` content.

3. **Must fix before merge — the Host off switch does not govern explicit startup bindings.**  
   [host.ts:243](D:/cxt/kB-review/src/app/host.ts:243), `localWorkbenchGrant`; startup initialization at [line 348](D:/cxt/kB-review/src/app/host.ts:348), and `buildRuntimeConfiguration` at [line 567](D:/cxt/kB-review/src/app/host.ts:567).

   The switch only narrows automatically generated local grants. A workspace configured with `allowReadonlyCommands:false`, `readPrefixes:['.']`, and an explicit runtime binding containing the tool and `readonlyCommandAccess:'all_except_denied'` still exposes it. Both drivers see a valid grant and whole-workspace read permission. This is conflicting trusted configuration defeating the advertised switch, rather than model-created authorization.

   **Spec:** L18 layer 1; KB-08 explicitly requires the disabled tool to be invisible.  
   **Fix:** apply the workspace switch as a narrowing constraint at the common Host resolution boundary, including initial startup and settings rebuilds. Test the explicit-binding scenario through KE6.

4. **Must fix before merge — the 128 KiB guarantee is false.**  
   [readonly-command-tool.ts:87](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts:87), `boundOutput`; [line 216](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts:216), external-change result.

   Two independent problems:

   - Only `output` is measured, although the specification bounds the serialized result. `error.message` duplicates all named paths outside that measurement.
   - Once output text is empty, an oversized path array remains oversized. For example, 100 valid deeply nested paths averaging 1.5 KiB exceed the limit by themselves. The frozen dispatcher then throws `invalid_result`, losing the required business result.

   Even shorter paths can keep `output` within budget while the complete result exceeds it; provider adapters serialize the complete result.

   **Spec:** L16, KB-10.  
   **Fix:** budget the complete result, use a short fixed error message, and define a byte-budget exception allowing fewer named paths with an increased omitted count. Lead must reconcile that exception with the frozen path-list rule.

5. **Should fix — capability probing does not always prove the promised configuration.**  
   [process-sandbox.ts:232](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:232), `probe`; [line 326](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:326), canary cache; [line 604](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:604), conditional remount.

   `probe` constructs only with `workspaceMode`, rather than the eventual runtime options. `execute` checks its actual options, which preserves rejection before command execution, but the initial profile can be optimistic. Moreover, `--remount-ro` is never exercised when no protected directory exists. Cached success can therefore precede a later configuration requiring that operation.

   **Spec:** L13 requires proving both options with the actual protection configuration; KB-06 includes unsupported bwrap.  
   **Fix:** probe the actual options and explicitly exercise both required operations. Preserve `sandbox_unavailable` classification. No read-write or host-shell fallback was found.

6. **Should fix — cwd validation has a check/use race.**  
   [process-sandbox.ts:307](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:307), `#resolveReadOnlyCwd`, checks the resolved target but returns the original path at line 323; `#arguments` later resolves that path again.

   A concurrent writer can replace an initially safe directory symlink with `/tmp` before bwrap’s `--chdir`. The command then starts outside `/workspace`, in private sandbox storage. **This is not evidence of access to host `/tmp` or a host-root escape.** Existing-file cwd values also pass `realpath` and fail only at launch.

   **Spec:** L13’s workspace-directory validation; L16 `invalid_arguments` before startup.  
   **Fix:** validate directory type and final containment against the actual sandbox view, or otherwise pin the validated directory without leaking a host-root fd.

7. **Should fix — the tool description omits required output-loss behavior.**  
   [readonly-command-tool.ts:235](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts:235), `description`, does not explain that cancellation or the dispatcher timeout replaces captured output.

   **Spec:** L16 explicitly requires disclosure.  
   **Fix:** distinguish subprocess timeout, which retains captured output, from outer cancellation/timeout overlays. Also describe ordinary `.git` as readable but read-only, rather than generally “masked.”

**The error-code substitution is technically justified, but needs a recorded contract decision.** At [tool-executor-port.js:38](D:/cxt/kB-review/vendor/coding-agent/dist/core/ports/tool_executor/tool-executor-port.js:38), the frozen enum contains neither `forbidden` nor `workspace_changed_during_readonly_command`. Returning either fails validation at [tool-dispatcher.js:131](D:/cxt/kB-review/vendor/coding-agent/dist/tools/dispatcher/tool-dispatcher.js:131).

- `permission_denied` preserves the permission-refusal meaning for the model and existing consumers.
- `execution_failed` preserves the external-change explanation for the model through the message and structured `externalChangedPaths`, with `retryable:false` and no command effects. It **does not preserve the distinction for consumers inspecting only `error.code`**.
- Searching `src/` found no tool-result consumer depending on either proposed new code. `kernel-turn-facts` specifically distinguishes `outcome_unknown`, not these codes. Thus no current downstream misclassification was identified.

**Severity: note requiring lead resolution before acceptance.** Accept and document the compatible mapping, with a stable structured discriminator if required; do not insert invalid enum members into results. Tests at Runtime lines 471, 588 and 704 currently freeze the substitutes ahead of that decision.

The remaining implementation checks passed static review:

| File:symbol | Finding |
|---|---|
| `execution-contracts.ts:ResolvedRuntimeConfiguration`; `execution-preparation.ts:snapshotRuntimeConfiguration` | New access field retained. |
| `execution-preparation.ts:intersectTools`; `query-preparation.ts:projectQueryConfiguration` | RoleSpec ceiling respected; legacy Host ceiling preserved. |
| `runtime-configuration.ts:resolve` | Grant spread carries the field; does not repair finding 3. |
| `execution-driver.ts:createExecutionDriver`; `query-execution.ts:createQueryExecutionDriver` | Injection restricted to Query/empty-write Work, explicit access and whole-workspace reads. Each handler call reauthorizes and compares `permissionRevision`. |
| `observed-model-run.ts:runObservedModel` | Extension joins enabled/registered/Host-authorized tools; existing mutation-tool guard remains. |
| `readonly-command-tool.ts:createReadonlyCommandTool` | Strict arguments, timeout range/default, process classification and required capabilities match L12. Normal mapped outcomes report `none`. |
| `process-sandbox.ts:#run` | Read-only branch never calls `acceptAgentChanges`; paths byte-sort and cap at 100 with omitted count. |
| `process-sandbox.ts:#arguments` | Root uses `--ro-bind-fd`; later protection mounts are read-only; runtime binds remain read-only. Environment clearing, network/PID isolation and `--die-with-parent` remain. Writable scratch is private tmpfs; root fd is handed to bwrap’s fd operation and the parent handle closes in `finally`. |

Frozen `shell-tool.js`, `tool-dispatcher.js`, and `permission-policy.js` are untouched. Generated-artifact absence was treated as instructed.

**Test acceptance is incomplete despite 26 passing cases.** “Kernel” below means [K-readonly-sandbox.test.ts](D:/cxt/kB-review/tests/kernel/K-readonly-sandbox.test.ts); “Runtime” means [K-readonly-command.test.ts](D:/cxt/kB-review/tests/runtime/K-readonly-command.test.ts).

| KB row | Entry and assertions | Required action / severity |
|---|---|---|
| 01 | Kernel:96, real KE5. Seven write attempts, unchanged sentinels and absent new paths asserted. | Covered. |
| 02 | Kernel:130, real KE5. `/tmp`/HOME writes, disappearance next call, host absence asserted. | Covered. |
| 03 | Kernel:151, real KE5. Host port first proven reachable; sandbox denial, git log/diff, commit and linked-worktree failure asserted. | Named cases covered; IPC escape remains outside these assertions. |
| 04 | Kernel:211, real KE5. Four cwd cases, parent environment and fd 3 asserted. | Static cases covered; finding 6 remains. |
| 05 | Kernel:259, real KE5. Timeout/cancel flags and both stream limits asserted. Sleep commands produce no preceding output. | **Should fix:** emit and assert retained markers before timeout and cancellation, as KB-05 requires. |
| 06 | Kernel:297, real KE5. Missing bwrap and no-start markers asserted. | **Must fix:** add the separately required unsupported-option case; currently absent. |
| 07 | Runtime:252/288. Both use the same Runtime’s prepare/start/observe chain. Query reads saved output; Work only compares history end positions. | **Must fix:** Runtime:315 must read Work history publicly and assert the saved call/output. Matching positions do not prove persistence. |
| 08 | Runtime:326–477. Partial read, Role ceiling, nonempty write scope and revision change have assertions. “Switch off” removes the access field in a fixture; Host helper is tested separately. | **Must fix:** exercise the actual Host switch with an explicit binding, finding 3. Resolve error-code contract. |
| 09 | Runtime:485/498. Both assert absence of `shell/edit/write`, but neither grants those tools initially. | **Must fix:** supply the competing write-tool grant and verify exclusion or the legitimate public rejection. Current tests cannot detect a broken filtering guard. |
| 10 | Runtime:522–687 plus :455. Mapping cases exist; 100/50 count asserted; cancellation has a real Query case. | **Must fix:** :614 measures only `result.output`; assert complete results and long-path cases. **Should fix:** :597 checks only count, not the correct byte-sorted prefix; use independently specified expected paths. |
| 11 | Kernel:325 and Runtime:694. Real external change, baseline drift, result paths and `none` asserted. | Covered apart from the unresolved wire-code contract. |

Per-file TDD assessment:

- **Kernel test file:** no internal mocks, database verification, internal-call assertions or tautological expectations found. Public baseline/consistency checks and host sentinel reads are appropriate at KE5. These are substantive security tests.
- **Runtime test file:** the sandbox mock at line 53 targets an internal module path, but substitutes the explicitly permitted Kernel boundary. Extra coupling occurs in KB-07 constructor-mode assertions at lines 275/313, KB-08 line 477, and KB-10 forwarding assertion at line 552. Command-record assertions in refusal cases have legitimate “did not start” meaning. No direct database/RecordStore verification was found; history uses public `readSessionHistory`, although decoding at lines 240–241 imports private Runtime helpers.
- **Should fix — unapproved/redundant entries:** Runtime:349 tests the exported Host helper outside KE6; Runtime:618 constructs the tool/dispatcher directly and duplicates the real Query cancellation test at :659. Move useful assertions to the agreed execution boundary. Work cases at :415, :440 and :498 also omit `observeRun`; complete that step where asserting execution outcomes. **Rule:** §5.1 and TDD’s agreed-entry requirement.
- **Tautological/trivial:** no strict recomputation tautology found. Work’s end-position equality is insufficient persistence evidence, and KB-09’s absent-grant assertions are weak counterexamples, as above.
- **[K-readonly-work-support.ts:69](D:/cxt/kB-review/tests/helpers/K-readonly-work-support.ts:69):** raw policy appends couple fixture setup to storage representation, but are not database reads used for acceptance. No standalone tests or tautological assertions. **Note:** prefer public setup when practical; no broad fixture rewrite is needed.

**Final verdict: not ready.** Fix the security and Host-gate defects, enforce the complete-result bound, close the listed mandatory test gaps, and record the error-code contract decision before merge.