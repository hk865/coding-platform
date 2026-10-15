Reviewed the staged tree against `dfe3cc9a`. No edits, tests, or model calls were made. The reported build checks do not establish RE1 correctness.

Must-fix items:

1. **The probe rejects normal systemd user sessions.** `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:2147` requires `systemd/private` to be a directory; it is a Unix socket. Consequently, supported machines report `no_user_session` and commands run uncapped. Replace this directory check with the required existence/socket check, retaining the ownership check on `/run/user/<uid>`.

2. **L5’s ten-second probe deadline is absent.** `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:539` runs version commands without a timeout, and `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:845` adds separate sandbox/capped-canary/cleanup waits. A stuck version command leaves the cached promise—and every waiting execution—pending indefinitely. Apply one overall deadline across probing; terminate and reap probe children on expiry, drain stderr, and return `probe_failed`. A bare `Promise.race` would leave processes behind.

3. **Gate write errors can crash the Host.** `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1412` catches synchronous `write()` exceptions only. The fd-4 stream has a data listener but no error listener at `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1459`. A peer disappearing during release can produce an asynchronous `EPIPE`/reset error. Handle stream errors and write completion explicitly, close the gate appropriately, and finish cleanup while retaining the “released/possibly started” boundary and prohibiting retries.

4. **An exit after `r` but before release has no proper settlement path.** `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1465` reports startup failure only when `ready` is false. If the launcher exits during the subsequent asynchronous checks, the starting-state exit neither closes the keeper nor records failure; it can wait until the command deadline, or become a false “not-started cancellation” through `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:371`. Treat unexpected exits throughout the unreleased phase as startup failures. Also recheck settlement after asynchronous startup reads so late continuations cannot install observers after cleanup.

5. **Read failures still discard evidence or masquerade as absence.** The observation loop’s `Promise.all` at `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1259` discards a successful memory read when the pids read fails, and vice versa. This can lose positive evidence and suppress immediate OOM termination. Merge each successful read independently, as `readFinal` already does. Separately, `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:1364` treats every swap-limit read error as “file absent,” and `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:930` treats every scope-stat error as successful disappearance. Accept only genuine absence; other failures must fail the relevant verification.

6. **The new observation report is not validated.** `src/core/work-graph/persistence/evidence-record-codecs.ts:592` still accepts arbitrary `resourceCaps`. Only the derived `resourceCapHit` gained validation. For example, `resourceCaps: null` passes admission and then throws in `resourceCapHitOf`, after report storage. Validate the optional discriminated report—including its required values—before storing anything, while continuing to accept legacy observations without the field.

7. **RL-14 does not construct a read-only sandbox.** `tests/helpers/RL-resource-caps-support.ts:71` supplies `workspaceMode` to `probe`, but omits it from the constructor at line 74. Thus the purported read-only tests execute in read-write mode. Pass the same relevant options to both calls.

8. **The Host-death fixtures do not reach their claimed scenarios.** `tests/kernel/RL-06-11-stop.test.ts:137` and `tests/kernel/RL-06-11-stop.test.ts:154` use `identityAndWait` but never create its release file; RL-08/08b cannot reach their payload markers. RL-09/09b warm the parent’s cache, whereas `tests/helpers/RL-child-node.mjs:16` starts a fresh process with a cold cache, so the fake launcher stalls the probe. Add a child-ready handshake after probing inside that child, then switch modes and start the target command. Release the identity barrier where required, verify the intended scope/state before killing, await disappearance afterwards, and always reap children in cleanup. RL-09’s loop at line 187 currently exits immediately when the forbidden marker is absent.

9. **Several RE1 assertions can pass without testing capped cleanup.** `tests/kernel/RL-06-11-stop.test.ts:71` and line 94 assert cancellation/timeout but neither `applied` nor disappearance of that execution’s scope. Their `echo marker; sleep 600` does not reliably retain the marker in the sleeping process’s argv. Assert the applied report, identify the actual scope, and verify its removal; use a marker retained by the surviving child. Make `tests/helpers/RL-resource-caps-support.ts:227` distinguish “no matches” from command failures. In `tests/kernel/RL-12-15-conditions.test.ts:86`, verify the fake scope invocation actually occurred: `fail-bus` can otherwise pass merely because the real machine already reports `no_user_session`.

10. **Complete the public-contract and regression changes described in 5 below:** update the two incompatible automation assertions, declare the notice action publicly, and cover the requeue branch. These are concrete gaps, not reasons to weaken the required resource-cap behaviour.

Should-fix:

- Return `{status: 'not_started'}` consistently for pre-start cancellation. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:948` currently returns `none` when caps are unavailable/unconfigured.
- Tighten persisted settings validation at `src/app/host-settings.ts:347`: it accepts zero and other out-of-range stored values. Preserve the explicit exception for memory exceeding the current machine’s RAM.
- Use the execution’s actual bwrap path for capability lookup. `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts:968` probes the environment/default path, which can differ from `profile.bwrapPath`.

Answers to 5(a)–(c):

**5(a): Update the tests.** At `tests/app/A2-settings-automation.test.ts:65` and `tests/app/A2-settings-automation.test.ts:129`, retain exact assertions for the automation value, but use a partial enclosing snapshot assertion or explicitly include the new field. Do not suppress `resourceCaps` to satisfy obsolete whole-object expectations. The lead should record the narrow A2 exception and correct §5.3.

**5(b): Add the optional field now.** Extend `src/core/work-graph/model/decision-contracts.ts:258` with the narrowly typed `raise_memory_cap` action. The local intersection currently hides a promised public capability from typed consumers. This requires a small, explicit scope amendment; it does not require E3 implementation.

**5(c), by UNSPECIFIED number:**

- **2:** Pre-release `host_oom_kill` is unreachable through today’s observer. Reserve `deadline_before_start` for timeout; ignore/reject the impossible event explicitly instead of inventing that attribution. No new lifecycle is needed.
- **3:** Accept the stated seam limitation. `tests/kernel/RL-22-settlement.test.ts:237` repeats the identical event three times; that proves one settlement response, not three production classifications. Report coverage accurately rather than adding a production test hook.
- **5:** Add cap-hit/no-hit **requeue** datasets through public services and assert the public notice. `tests/work-graph/RL-32b-rework-notice-memory-cap.test.ts:61` exercises only reverify. Include meaningful coverage of trigger-read failure and first-hit ordering.
- **6:** Plain concatenation is not a correctness blocker. Prefer a readable separator, selected by the lead and reflected in literal expectations.
- **7:** Accept the split evidence with its limitation stated. `tests/app/RL-34-wiring-resource-caps.test.ts:235` cannot prove real-Host revision stability using a fixture-defined revision. Static Host review shows caps excluded from the revision inputs; the real-Host live-save test proves holder propagation. Do not describe these as a complete real-Host revision test.
- **8:** Keep the `status === 'applied'` discriminator. Validate whole-MiB values before deriving the snapshot, then use exact division instead of silently flooring malformed input.

L16’s same-commit write is correctly placed at `src/core/work-graph/evidence/evidence-service.ts:1360`. Legacy absence remains accepted; requeue reads `afterRoundRef` once, reverify uses its predecessor already in the chain, and read/decode failures propagate rather than becoming “no hit.” Runtime wiring, manifest exclusion, and L10 tail-note mapping otherwise follow the reviewed contracts. No skip guards or direct database assertions were found in the added tests.

not ready