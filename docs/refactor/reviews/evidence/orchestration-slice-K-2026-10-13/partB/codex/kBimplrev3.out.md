**Two issues remain: one isolation regression and one incomplete test fix.** Read-only review; no files changed or tests run. The 48 K-B tests, typecheck and full-suite results are lead-reported.

References: **S** = [process-sandbox.ts](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts), **T** = [readonly-command-tool.ts](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts), **R** = [runtime tests](D:/cxt/kB-review/tests/runtime/K-readonly-command.test.ts), **K** = [kernel tests](D:/cxt/kB-review/tests/kernel/K-readonly-sandbox.test.ts).

1. **Must fix before merge — D-GITFILE introduces a race exposing Host-denied paths.**

   [S:727](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:727) classifies `.git`; :733 prunes descendants accordingly. The mount loop independently classifies it again at :741.

   On an already-probed execution, the first check can see a file and discard `.git/private`. If another writer replaces `.git` with a directory containing `private/secret` before the second check, :745–746 binds that directory readably, without the denied subtree’s overlay. The second-round implementation retained that descendant and would mask it in this interleaving.

   This can also expose **IPC writes**: [S:645](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:645) skips `.git/private` during IPC scanning because it assumes the subtree is masked. A socket/FIFO there could receive commands or data. No new direct regular-file write route was identified; the root remains read-only at :716.

   **Rule:** [D-GITFILE, brief:33–38](D:/cc-lead-notes/impl/kB/kB-impl-3.md:33): descendants are dropped **when their ancestor is masked**.  
   **Fix:** derive pruning from the actual selected masking overlay; fail closed if classification changes instead of exposing a directory after discarding its denials. Cover the file-to-directory interleaving.

   **Original availability defect:** fixed for stable layouts. File-form `.git` is masked, directory-form `.git` retains descendant overlays, and `ENOENT`/`ENOTDIR` no longer abort ordinary commands. The specified linked-worktree case is covered by `KB-03 D-GITFILE keeps ordinary commands working when a linked worktree's .git is a file with a denied descendant` at [K:600](D:/cxt/kB-review/tests/kernel/K-readonly-sandbox.test.ts:600). Skipping nonexistent paths does not change mount permissions, but cannot establish safety against concurrent replacement.

2. **Should fix — replacement sandbox double ignores actual execution options.**

   [R:79](D:/cxt/kB-review/tests/runtime/K-readonly-command.test.ts:79) merely records constructor options. `execute` at :101 checks a global flag set by `probe`, without checking its own instance configuration.

   Consequently, removing or changing only the constructor options at [T:244](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts:244) still passes the rewritten probe tests. The constructor-coupled assertions were removed, but their execution-configuration coverage was lost.

   **Rule:** [brief:52–54](D:/cc-lead-notes/impl/kB/kB-impl-3.md:52), and [L14:228](D:/cxt/kB-review/docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md:228).  
   **Fix:** retain instance options in the double and have execution refuse mismatched options, including an incorrect workspace mode. Keep assertions on public results and whether commands started.

**D-ID / second-review problem 2: fixed as decided.** [T:117](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts:117) measures the serialized result with only the provider ID’s value excluded. Every handler-owned return uses `boundResult`: invalid arguments/cwd, both authorization refusals, sandbox/launch exceptions, external changes, cancellation, timeout, nonzero exit and success. Dispatcher-generated refusals remain outside the handler, as specified.

Captured output is trimmed before paths. [T:189](D:/cxt/kB-review/src/core/agent-runtime/readonly-command-tool.ts:189) explicitly excludes the fixed external-change message from diagnostic trimming. For the actual result shapes, no remaining tool-produced overflow path was found; a large provider ID can still make the complete wire result exceed 128 KiB, as D-ID permits.

The four test items resolve as follows:

| Item | Result and test |
|---|---|
| Actual Host Work | **Done.** R:626, `KB-08 a read-only Work started by the real Host with the switch off never sees run_readonly_command`; actual Host startup, explicit granting binding and model entry are exercised, with a switch-on control. |
| KB-09 write alone | **Done under the lead’s revised instruction.** R:778, `KB-09 an empty-write Work granted write alone never hands a write tool to the model`. Observation success is asserted before the conditional, so failure cannot silently skip acceptance. Avoiding an assertion of the known `starting` defect is appropriate. |
| Constructor coupling | **Partial; finding 2.** R:893, `KB-10 the read-only sandbox capability is probed with the command's actual options`, and R:911, `KB-10 a read-only capability probe that does not match the command options refuses and starts nothing`. |
| Ordering | **Done.** R:929, `KB-10 more than 100 external changed paths are named 100 in byte order plus the omitted count`; R:965, `KB-10 long external changed paths name a literal byte-ordered prefix and bound the COMPLETE result at 128 KiB`. Reversed inputs and independent expectations distinguish byte ordering. |

No new tautological or database-based acceptance assertion was found. **Note:** R:1057’s oversized-input early-refusal test returns a fixed diagnostic, so its budget assertion does not exercise trimming or prove helper routing; it does satisfy the requested observable scenario. Routing was verified statically.

I compared the saved second- and third-round patches and verified the current files against the third-round patch. No other third-round regression was identified.

**Verdict: merge after listed fixes.**