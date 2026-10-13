**Verdict: merge after listed fixes.** The main remaining defect is an availability regression involving file-form `.git`. Most previous fixes are correct, but the absolute result-size guarantee and several acceptance-test requirements remain incomplete.

Read-only review only: no files changed, no tests run. The 43 passing tests and successful typecheck are lead-reported; the full suite remains pending. I reviewed the patch source, not generated artifacts.

References below: **S** = [process-sandbox.ts](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts), **T** = [readonly-command-tool.ts](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts), **K** = [Kernel tests](D:/cxt/kB-review/tests/kernel/K-readonly-sandbox.test.ts), **R** = [Runtime tests](D:/cxt/kB-review/tests/runtime/K-readonly-command.test.ts). “Brief” means [kB-impl-2.md §2](D:/cc-lead-notes/impl/kB/kB-impl-2.md:32).

The previous findings resolve as follows:

| Previous item | Re-review |
|---|---|
| **1 — IPC** | **Fixed as decided**, within D-IPC’s bounded-scan approach. S:610 scans; S:757 masks found endpoints. Residual limits below. |
| **2 — `.git` denials** | **Partially fixed.** Directory-form `.git` retains descendant denial overlays, S:169/S:727. File-form `.git` exposes the availability defect below. |
| **3 — Host switch** | **Production fix correct.** Startup, settings rebuild and programmatic runtime paths all narrow bindings. Required Work acceptance coverage remains incomplete. |
| **4 — complete-result bound** | **Original long-path defect fixed; absolute guarantee incomplete.** T:109 measures the complete result, but an unbounded call ID survives trimming. |
| **5 — probe** | **Fixed as decided.** Actual options reach the probe, S:270; both required mount operations are always exercised, S:710/S:749. |
| **6 — cwd** | **Fixed as decided.** Directory validation and resolved relative path, S:344; in-sandbox guard, S:772; marker mapping, S:542. |
| **7 — description** | **Fixed as decided**, T:298: timeout retention, cancellation/dispatcher replacement, readable/read-only `.git`, and hidden denied paths. |
| **Error-code note** | **Resolved by D-CODES**, T:37/T:270: `permission_denied` plus `forbidden:`; external change uses `execution_failed`, `retryable:false`, fixed message and JSON `reason`. |

The specification review found two remaining problems.

1. **Must fix before merge — file-form `.git` plus a denied descendant disables every read-only command.**  
   [S:169](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:169) always excludes `.git` from masking ancestors, although [S:737](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:737) masks it when it is a file.

   Concrete layout: a linked worktree with `.git` as a file and Host denial `.git/private`. The descendant survives pruning; S:723 attempts `lstat(".git/private")`, which fails with `ENOTDIR`. S:744 ignores only `ENOENT`. The canary therefore fails—or an already-probed sandbox fails during launch—even for `printf hello`. A negative canary result is cached. Linux documents this `ENOTDIR` behavior for a non-directory path component. [stat(2)](https://man7.org/linux/man-pages/man2/stat.2.html)

   **Rule:** brief:42–45, D-GIT; spec L17:264 limits the linked-worktree restriction to git usability.  
   **Fix:** classify ancestors by their actual overlay: retain descendants beneath a readable `.git` directory; discard them beneath a masked `.git` file. Add KE5 coverage combining file-form `.git`, denied descendants, successful ordinary commands and failed git access.

2. **Should fix — the complete-result bound still assumes bounded call IDs.**  
   [T:183](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts:183) returns without establishing that the result fits; T:292 copies `call.callId` unchanged. A 131,072-byte ASCII ID alone exceeds the budget, even after all output disappears. Early refusals at T:190/T:196/T:206/T:210 also bypass bounding.

   This is accepted by the existing model boundary: [nonEmptyIdSchema:18](D:/cxt/kB-review/vendor/coding-agent/dist/core/context/types/context-types.js:18) has no maximum length. The frozen dispatcher measures only `output`, so it does not enforce the envelope limit. Near the limit, T:171 can also shorten the supposedly fixed external-change message.

   **Rule:** brief:51–57, D-BOUND; spec L16:242 and KB-10.  
   **Fix:** establish an accepted identifier-size limit before execution, preserving call/result identity, or have the lead explicitly qualify the guarantee. Do not truncate only the returned ID. This is a provider-contract edge, not an isolation escape.

The remaining sandbox checks are consistent with the decisions:

- **IPC walk:** S:624 processes breadth-first levels, with a 20,000-entry limit and depth loop `0..64`. It skips symlinks, failed reads/stats and masked protected subtrees. It enters ordinary directories—including snapshot-ignored directories such as `node_modules`—and readable `.git`, while skipping independently denied descendants.
- **Beyond the bound:** traversal stops without refusing launch; undiscovered endpoints remain exposed. A sufficiently wide root can exhaust the entry budget before every root entry is inspected. Endpoints created after scanning also remain outside coverage. **Note:** document these precise limits alongside D-IPC; the code is a bounded mitigation, not comprehensive IPC exclusion.
- **Mount order:** S:710 binds the root read-only, then runtime directories, protected overlays, optional scratch remount, and finally IPC masks at S:757. Later `.git` binding cannot undo IPC masks. Skipping masked subtrees avoids trying to create IPC mountpoints inside empty read-only overlays.
- **Canary:** every read-only argument set includes `--ro-bind-fd` and either a protected-directory `--remount-ro` or the scratch remount. S:388 keys the cache by bwrap path/version, executable path, runtime paths and protected paths—not workspace root or current layout. This matches configuration-based caching, but also propagates cached layout failures.
- **cwd:** S:344 resolves once, requires a directory, checks containment/protection, and returns the resolved relative path. The shell checks physical cwd before the user command. Exit 126 plus the stderr marker maps to `invalid_arguments`; the root handle closes in `finally`. No new host-shell fallback or additional mount escape was identified.

The Host paths also check out. [host.ts:326](D:/cxt/kB-review/src/app/host.ts:326) wraps both programmatic resolution methods; :385 passes narrowing into configured startup bindings; :681 preserves it on settings rebuild. [runtime-configuration.ts:177](D:/cxt/kB-review/src/app/runtime-configuration.ts:177) removes **both** the tool and `readonlyCommandAccess`. Query and Work then apply their respective scope, Role and current-read checks.

For ordinary-sized identities, D-BOUND now works: complete serialization is measured; stderr and stdout text are trimmed before paths; paths retain a UTF-8 byte-ordered prefix; removed paths increase the omitted count. The fixed message is used. Trimming oversized launch diagnostics is an additional, reasonable repair, though it exceeds the brief’s literal “then nothing else”; it should remain distinct from trimming the fixed external-change message.

The standards/test review found these remaining issues:

- **Should fix — actual Host-started Work coverage is missing.** [R:602](D:/cxt/kB-review/tests/runtime/K-readonly-command.test.ts:602) uses a factory whose narrowing is supplied by the fixture at R:175, not `createLocalWorkbenchHost`. It cannot detect omitted Work-side Host wiring. **Rule:** brief:48–50 explicitly requires Host-started Query and Work. **Fix:** execute the disabled-switch Work scenario through the actual Host with an explicit granting binding.
- **Should fix — KB-09 can skip its outcome assertion.** [R:748](D:/cxt/kB-review/tests/runtime/K-readonly-command.test.ts:748) discards the start result; R:756 checks non-completion only if observation succeeds. Unrelated failures can satisfy zero model calls. **Rule:** KE6, spec:411; brief:108. **Fix:** require the expected start/observation result before asserting non-completion, or explicitly assert the accepted public rejection.
- **Should fix — constructor coupling remains.** [R:855](D:/cxt/kB-review/tests/runtime/K-readonly-command.test.ts:855) requires exactly one read-only construction and inspects constructor arguments. **Rule:** brief:105–107 required removing these assertions. **Fix:** make the permitted Kernel double’s capability behavior depend on options, then assert the public result and whether execution started.
- **Should fix — ordering tests receive already-sorted inputs.** R:867/R:896 construct sorted ASCII paths and compare slices of those same lists. Removing sorting would still pass. **Rule:** D-BOUND, brief:58–60; previous KB-10 ordering action. **Fix:** supply shuffled paths, including a byte-order-sensitive example, and assert an independently specified prefix.

| KB row | Acceptance assessment |
|---|---|
| 01 | Covered, K:167: mutations fail and sentinels remain unchanged. |
| 02 | Covered, K:201: private scratch succeeds, disappears, and leaves no host file. |
| 03 | IPC/network/git cases added; file-form `.git` plus denied descendants remains missing. |
| 04 | Covered, K:282/K:643: cwd, environment, fd and regular-file rejection. |
| 05 | Previous action done, K:326: output before timeout/cancellation is asserted. |
| 06 | Previous must-fix done, K:599: each unsupported option plus working passthrough control. |
| 07 | Previous must-fix done, R:465/R:512: Query and Work publicly read persisted results. |
| 08 | Production fix done; actual Host Work test remains incomplete. |
| 09 | Competing grants now supplied; write-only outcome assertion needs strengthening. |
| 10 | Complete-result and long-path cases added; identity bound, ordering coverage and constructor coupling remain. |
| 11 | Covered, K:405/R:1001: external changes, unchanged baseline, mapping and `none` effects. |

The lead’s wrapper `:` at K:132 correctly fixes the empty shell loop. Accepting `wrote` or `blocked` at K:457 is appropriate because K:470 asserts the essential condition: zero host FIFO bytes.

Reverting the new prepare guard is acceptable under your instruction: [observed-model-run.ts:239](D:/cxt/kB-review/src/core/agent-runtime/observed-model-run.ts:239) retains the start-time mutation guard before model entry. Strengthen its test without restoring the rejected behavior change.

Kernel tests remain substantive KE5 tests. Runtime history now uses public reading; no strict recomputation tautology or database-based acceptance assertion was found. The helper’s raw policy appends remain fixture-only coupling. Static review cannot establish TDD chronology.

**Final verdict: merge after listed fixes and successful lead full-suite completion.**