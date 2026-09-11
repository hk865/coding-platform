# ERR-01 final-change coverage supplement

Scope: added `tests/control/reviewer-runtime-start-rejection.test.ts` only; no product source or vendor changes.

The existing second test in `reviewer-lease-conflict-recovery.test.ts` changes the envelope to writable permissions. `LeasedWorkerRuntime` rejects it at the `!readOnly` material guard, before `runtime.start`. Its historical name/comment overstates runtime-start-catch coverage; the original file is preserved.

The new two tests retain the valid readonly envelope, real grants and successfully assembled Reviewer materials. A wrapper calls the real `CodingAgentRuntime.start` after either `close()` or `markUnknown()`. They assert material/start/rejection calls each occur once, zero model calls, one persistent terminal `run_crashed` and matching canonical state for the known rejection, and no manufactured terminal runtime event plus canonical `outcome_unknown` for the unprovable case. Repeated drive preserves the settled canonical snapshot and does not call start again.

Validation: WSL Node 24 repository entry, with its normal bubblewrap preflight enabled:

```sh
bash scripts/test-wsl.sh tests/control/reviewer-runtime-start-rejection.test.ts tests/control/reviewer-lease-conflict-recovery.test.ts tests/control/reviewer-unknown-outcome-preservation.test.ts
```

Exit 0; 3 files / 5 tests passed. Output: `prestart-coverage.log`.

The first authoring run exited 1 (2 failures / 3 passes): the new wrapper incorrectly compared the entire permissions object to only tools/writeScope, omitting the legitimate policyRevision field. The exact failure-reason assertion and unknown contrast exposed that test error. Corrected to partial object matching; no product change. Original output retained in `prestart-coverage-test-authoring-failure.log`; these were test-authoring assertion failures, not environment faults.

Independent R-4 supplement: `r4-prefix-injection.test.ts` isolates the old catch-all probe from the post-fix module-level throw. An ordinary assertion proves the injected real regression returns false; the historical gated throwing test is discovered and skipped. Run with the adjacent dedicated config using the repository Linux Vitest runner: exit 0, 1 passed / 1 skipped (`r4-prefix-skip.log`). This intentional historical fault-injection skip is outside `tests/**`, is not a skipped product verification, and supplements rather than replaces the original post-fix FAIL and sentinel evidence. Original fault-injection files remain untouched.
