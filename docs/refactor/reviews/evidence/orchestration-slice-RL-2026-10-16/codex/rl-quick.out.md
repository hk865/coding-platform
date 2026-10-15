**Must-fix: none remaining.** Reviewed the staged tree against `dfe3cc9a`; no edits, tests, or model calls.

Closure of the original review items:

| Item | Result and evidence |
|---|---|
| MF1 | **Fixed.** The runtime directory retains its ownership/type checks; `systemd/private` requires existence only. Probe-canary failures preserve their cache entry. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:2332`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1675`. |
| MF2 | **Fixed.** One ten-second abort deadline reaches version commands and canaries; aborted version children are killed and awaited through `close`. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:569`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:2305`. |
| MF3 | **Fixed.** Gate errors have an error listener and write callback; destroying the stream preserves the released boundary and introduces no retry. R3 leaves no correctness problem. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1555`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1611`. |
| MF4 | **Fixed.** Unexpected pre-release exits become `launcher_exited`; asynchronous startup continuations recheck settlement before installing observers or releasing. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:480`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1503`. |
| MF5 | **Fixed, all three parts.** Successful counter reads survive failure of the other file; swap verification and scope disappearance accept only `ENOENT` as absence. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1329`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1488`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1034`. |
| MF6 | **Fixed.** Closed-union validation runs before report storage, including whole-MiB/range checks; legacy absence remains accepted. `src/core/work-graph/persistence/evidence-record-codecs.ts:603`, `src/core/work-graph/evidence/evidence-service.ts:1324`. |
| MF7 | **Fixed.** Read-only mode reaches both probe and constructor. `tests/helpers/RL-resource-caps-support.ts:80`. |
| MF8 | **Fixed.** Child-local probing and the ready/go handshake precede fault-mode activation; payload barriers are removed, children reaped, and disappearance awaited. `tests/helpers/RL-child-node.mjs:22`, `tests/kernel/RL-06-11-stop.test.ts:239`. |
| MF9 | **Fixed.** Cancellation/timeout cases require applied caps, complete observation, retained process markers and scope removal; `pgrep` errors propagate; RL-13 proves the canary ran. `tests/kernel/RL-06-11-stop.test.ts:148`, `tests/helpers/RL-resource-caps-support.ts:274`, `tests/kernel/RL-12-15-conditions.test.ts:117`. |
| MF10 | **Fixed.** Both A2 assertions preserve exact automation expectations and check null cap settings; the action is public; requeue hit/no-hit, ordering and read-failure cases exist. `tests/app/A2-settings-automation.test.ts:65`, `tests/app/A2-settings-automation.test.ts:132`, `src/core/work-graph/model/decision-contracts.ts:261`, `tests/work-graph/RL-32b-rework-notice-memory-cap.test.ts:179`. |

**Should-fix: none remaining from the prior review.**

- **SF1 fixed:** pre-start cancellation consistently reports `not_started`, including uncapped execution. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1058`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1784`.
- **SF2 fixed:** stored ranges are validated while preserving the above-current-RAM exception. `src/app/host-settings.ts:353`.
- **SF3 fixed:** capability lookup uses the executing profile’s bwrap path. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1078`.

The remaining 5(c) resolutions leave no correctness problem: pre-release OOM is ignored, division is exact after validation, and the separator is implemented. The accepted RL-22 classification and RL-34 real-Host revision coverage limitations remain accurately stated. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:438`, `src/core/work-graph/evidence/evidence-service.ts:225`, `src/core/work-graph/views/automatic-rework-notices.ts:526`, `tests/kernel/RL-22-settlement.test.ts:238`, `tests/app/RL-34-wiring-resource-caps.test.ts:217`.

The **`delay()` change is correct**. Its only callers use monotonic deadlines: one-second quiescence and at most two-second scope disappearance. Each timer is a finite one-shot; this change cannot keep the Host alive unboundedly. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:2188`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1307`, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1030`.

The **RL-13 ruling is correct for `rewrite-dollar`**: rewriting changes the keeper’s expected argv, so identification fails before release and before the literal canary executes. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1292`, `tests/kernel/RL-12-15-conditions.test.ts:111`.

No new spec/test-rule violation found: expectations remain literal or hand-calculated; no database assertions, product-derived oracles, or RE1 skip guards were introduced. The read-fault wrapper follows R10. Source-map embedded sources match all three changed patch sources; no indication of hand-edited dist. Regeneration verification relies on the supplied 60/60 result.

merge