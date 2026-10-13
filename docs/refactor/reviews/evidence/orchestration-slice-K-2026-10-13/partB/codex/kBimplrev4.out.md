**One must-fix remains.** No files changed or tests run; the passing test results are lead-reported.

1. **Must fix before merge — the readable `.git` bind does not preserve its classified type.**  
   [process-sandbox.ts:835](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:835) resolves the bind source through a mutable pathname.

   Remaining interleaving:

   - The snapshot classifies `.git` as a directory, selecting `bind-readonly`.
   - Another writer replaces it with a regular file containing sensitive content.
   - The IPC scan sees an ordinary file and adds no mask.
   - Bubblewrap resolves **both source and destination to that replacement file**. This is file-over-file, so the demonstrated type-mismatch failures do not apply. `cat /workspace/.git` can expose content that D-GITFILE requires masking.

   `.git` existed at classification, so this is outside the accepted absent-path residual. The new interleaving test covers only the inverse, file→directory.

   **Fix:** retain a directory capability for the classified readable `.git` and use that pinned source for mounting and IPC traversal. Replacement with a file must cause an actual mismatch or fail closed. Add the directory→file case through the existing snapshot test seam.

   The explicit overlay selection, descendant pruning and `readonlyIpcSkips` now share one plan. However, [process-sandbox.ts:745](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:745) still re-`lstat`s readable `.git` and uses the result to decide traversal. Also, :822 independently checks runtime paths, which can overlap protected defaults such as `.git`. Thus the unconditional “one classification decides everything” claim is not yet true. Reuse the snapshot/capability for these overlapping paths rather than independently classifying them.

2. **read_write: unchanged by round four.**  
   Comparing the saved third- and fourth-round patches, its mount loop retains the previous behavior at [process-sandbox.ts:858](D:/cxt/kB-review/vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:858). The new classifier and IPC planning remain restricted to `read_only`.

3. **Finding 2: fixed.**  
   [K-readonly-command.test.ts:88](D:/cxt/kB-review/tests/runtime/K-readonly-command.test.ts:88) retains instance options; :105 validates them before recording a started command. Wrong/missing `workspaceMode` is refused, and configured `readOnlyPaths`/`executablePath` must match. Assertions inspect public results and started commands.

   The reported mutation probe is convincing for this fix: changing the shared options to `read_write` lets the double’s probe succeed but causes its instance execution guard to refuse, failing the positive success assertion. I did not rerun the probe.

**Verdict: merge after listed fixes.**