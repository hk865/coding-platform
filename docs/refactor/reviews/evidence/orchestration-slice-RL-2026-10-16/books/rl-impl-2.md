# Task: slice RL round 2 — fix the review findings; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not seen
this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not make
design decisions. Where the spec, the round-1 book and this message do not determine something, do not invent
behaviour: list it under UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (`sleep 300`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents; keep your own context small.** Do not read the spec, the code or the tests yourself beyond what
you need to coordinate; use `grep -n` and `sed -n a,bp`, never whole large files. At most 2 subagents at once. Each
building subagent's message contains sections 1–5 of this message verbatim, its own group block of section 7 verbatim,
the full text of every item its group names (section 6), and: read `./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`;
read the spec sections its items cite, always including §0.3 and §8; work test-first (each new or changed assertion is
seen RED for the right reason before the fix — for RE1 tests see A3 of the round-1 book); run `npm run typecheck` and
its own test files only; reply with FILES, per item the test name(s), the implementation file:symbol, the RED/GREEN
log, and UNSPECIFIED items (short).

## 1. What this copy is

- **HEAD** is the local commit "lead: RL round 1 (DSH rl-impl), kept as the round-2 base": round 1's 59 files on top of
  `slice-base` (`DSH-BASELINE.md`) and `slice-setup` (the lead's commit 7ad00938). Slice 2C is not in this copy; RL
  merges onto it without conflicts. `git diff HEAD` shows your work of this round.
- **Round 1** built every row (report `./.dsh-ref/final-1.md`). A full implementation review by a second model
  (`./.dsh-ref/rl-implrev.out.md`) found 10 must-fix and 3 should-fix items and answered the open points; each was then
  checked against the spec, the code and the lead's real machine (section 6 carries the checked findings, the fixes and
  the tests). The verdict was "not ready". The most serious one: on a real machine the probe never succeeds
  (`systemd/private` is a socket, not a directory), so every capped command ran uncapped; RE1 could not show it.
- **The round-1 book** `./.dsh-ref/rl-impl.md` still binds (A1–A6, its sections 3–5, the answers P1–P11), except where
  section 4 or 5 of this message amends it. A3 still holds: RE1 tests are written test-first as far as this sandbox
  allows, never skip-guarded; the lead runs them on a real machine (WSL, systemd 255, a running user session, bwrap
  through `CODING_AGENT_BWRAP_PATH`).
- **The Kernel patch:** sources under `vendor/coding-agent/patches/`; `vendor/coding-agent/dist` changes ONLY through
  `node scripts/build-kernel-patch.mjs --write`, then `--check` (A4). Never hand-edit `dist`.
- **Never install anything** (apt, npm, pip); "Notes from the check" that mention installing or the lead's machine are for the lead.
- **The TDD skill** is in `./.dsh-ref/tdd/`. `vendor/coding-agent/node_modules` holds `zod` and `openai` (round 1 copied
  them); do not change `node_modules`.

## 2. Where the rules are

The frozen spec `docs/refactor/design/orchestration-2026-10/slices/slice-RL-SPEC.md`: §0.2, §0.3 (L1–L16, binding),
§1, §2 (names and signatures bind), §4, §5 (rows RL-01 … RL-44, entries RE0–RE3, §5.3, §5.4), §6, §7, §8.
Repository rules: `AGENTS.md`.

## 3. Frozen files

As in round 1 (its section 3), with two sanctioned existing-test edits: round 1's `tests/kernel/B2-history-public-
export.test.ts` and, now, the two assertions of `tests/app/A2-settings-automation.test.ts` named in R8. Round 1's own
`RL-*` tests and `tests/helpers/RL-*` fixtures **may** change where an item says so.

## 4. Amendments to the round-1 book (lead, binding)

- **Scope additions:** one optional field on `NoticeItemV1` in `src/core/work-graph/model/decision-contracts.ts` (R9);
  a new fixture `tests/helpers/RL-fake-bwrap.sh` (R3; its forward mode still runs the real bwrap); a new RE1 row
  RL-15b in the existing `tests/kernel/RL-12-15-conditions.test.ts` (R2).
- **Fixtures:** RL-32b's trigger-read failure case may use a read-fault double at the storage boundary that only makes
  a read FAIL (R10); every other fact comes from real public services.

## 5. Lead rulings on the spec's silent points (binding; recorded later as post-notes in the spec)

- **R1 (item MF1).** L5 step 4: `/run/user/<uid>` must be a directory owned by the uid; `systemd/private` must only
  exist (no type test). The probe's own capped canary must not invalidate the cache entry the probe is filling (the
  "作废" of L4 is about an execution's own pre-release failure).
- **R2 (item MF2).** L5's 10 seconds: all probe work stops at 10 s; then only bounded cleanup runs (SIGKILL and wait
  for close, the settlement's escalation and quiescence); only then does the probe resolve `probe_failed`. It never
  resolves before its children are reaped. Going past the deadline in step 5 is `probe_failed`, not
  `sandbox_unavailable`. New RE1 row **RL-15b** (the item's tests (a)).
- **R3 (item MF3).** An error on the Host's end of the gate (fd 4) is never a settlement event, adds no stop reason and
  no startup failure, and is never retried; the Host destroys its end; a gate still waiting reads EOF and exits without
  running the command; the outcome is reported as it is. The fixture `RL-fake-bwrap.sh` is approved.
- **R4 (item MF4).** Any exit of the spawned process before release is `startup_failed: launcher_exited` (the L4 table's
  "收到 r 之前" reads "放行之前"): close fd 5, no kill_group, invalidate the cache (R1 still applies to the probe).
- **R5 (item SF1).** Every not-started cancellation reports `{ status: 'not_started' }`, capped or not; `none` is only
  for commands that actually ran uncapped.
- **R6 (item 5(c)-2).** `settleExecution` ignores `host_oom_kill` while starting (no state change, no action). Timeout →
  `deadline_before_start` and cancel → not started stay.
- **R7 (item 9).** `observationComplete: true` is RL-06/07's evidence for "看门进程活到最后一次读之后". RL-13's
  fail-bus case needs a user session (it must reach step 6). Apply the retained-marker fix and the "单元 not-found"
  check to RL-03 as well.
- **R8 (item MF-10 / 5(a)).** In `tests/app/A2-settings-automation.test.ts` change exactly the two whole-snapshot
  assertions (lines ~65 and ~129): the automation value stays exact; the snapshot is matched partially and includes
  `resourceCaps: { memoryMaxMiB: null, tasksMax: null }` (defaults and machine values depend on the machine, so they are
  not asserted there; RL-40 covers them). Nothing else in that file changes.
- **R9 (item 5(b)).** Add one optional field to `NoticeItemV1`: `actions?: readonly ({ kind: 'raise_memory_cap' })[]`
  (or the narrow named type the item proposes); no E3 work.
- **R10 (item 5(c)-5).** Add RL-32b's requeue datasets (cap hit and no hit) through public services; the trigger-read
  failure case may use the read-fault double of section 4.
- **R11 (item 5(c)-6).** The L16 summary addition is joined with `' · '`; literal expectations follow.
- **R12 (item 5(c)-7).** Accept the split evidence for RL-34 and say its limit in the reply; remove the tautological
  parts.
- **R13 (item 5(c)-8, MF-6).** Validate the observation report at admission (closed union; an applied report has whole
  MiB ≥ 16 MiB and tasksMax 8..4194304); then divide exactly — no `Math.floor`. Legacy observations without the field
  stay valid.
- **R14 (item SF-2).** A stored resource-cap value out of range fails Host start-up, the same as the automation
  setting; the only exception stays (memory above this machine's RAM is used as stored).
- **R15 (item 5(c)-3).** Accept RL-22 (m)'s seam limit; report the coverage accurately; no test hook.

## 6. The items (checked findings; the fix and the tests are binding unless section 5 says otherwise)

Each item: what is wrong (with the code, spec and machine facts found when it was checked), the ruling, the fix and the tests. Line numbers are round 1's; find the symbol if a line moved. Where an item leaves a choice to the lead, section 5 has decided it; where it offers two ways, take the first unless section 5 says otherwise. For items 7, 8, 9 "Codex item N" means the item of that number in this section.

### Item MF1 — Codex must-fix 1: the probe requires systemd/private to be a directory

**Found (confirmed).** process-sandbox.ts:2147-2148 (runResourceCapProbe) does `stat(.../systemd/private)` and then `if (!privateDir.isDirectory()) throw`. The throw is caught at 2149 and returned as fail("no_user_session"). I checked the lead's WSL (read-only): uid 1000, `/run/user/1000` is a directory owned by han001 with mode 700, `/run/user/1000/systemd/private` is a socket (`srwx------`), and systemd is 255 (255.4-1ubuntu8.17). So on the real RE1 machine every probe stops at step 4 with no_user_session, and every capped command runs uncapped. The builder never saw this because its sandbox already failed at step 2 (final-1.md: RL-13 got 'no_cgroup_v2').

**Ruling.** Spec L5 step 4 says "/run/user/<uid> 是这个 uid 的目录，里面有 systemd/private". The directory requirement covers /run/user/<uid> only. For systemd/private the spec asks only that it exists, not what type it is. The code adds a directory test the spec does not have, and it is wrong on every real machine. Must-fix.

**Fix.** vendor/coding-agent/patches/sandbox/process/process-sandbox.ts, runResourceCapProbe, step 4: keep the stat of `/run/user/<uid>` with its isDirectory() and uid === getuid() checks. For `systemd/private`, only require that stat succeeds and delete the isDirectory() line. If the lead wants a type check, use isSocket(), never isDirectory(); existence alone is the literal L5 reading, and step 6 proves the session works anyway. Rebuild dist only with `scripts/build-kernel-patch.mjs --write` and then `--check` (A4).

**Tests.** No new row. RE1 on the lead's WSL: the existing RL-15 must now return `{ status: 'available' }` twice and `resourceCapStatus()` must equal `{ status: 'available' }`; before the fix it returns no_user_session. RL-01 must show `resourceCaps.status === 'applied'`. Also make RL-13's fail-bus case prove it reached step 6, so it cannot pass just because step 4 already fails: assert the fake's `.log` has at least one line containing `--user --scope` (this overlaps Codex item 9).

**Notes from the check.** None. Conflicts and adjacent defects: fixing this exposes a separate bug that the current RE1 run hides, and it should go into the same rework. The probe's own canary uses #runCapped, and #runCapped line 1508 calls invalidateResourceCapCache() on every launch_failed except deadline_before_start. In the fail-bus case (launcher_exited) and the strip-p case (limits_not_effective), that wipes the cache entry while the probe is still running. The `.then` in probeResourceCapsInternal (2094-2096) then finds the cache null, so the result is never stored. Consequences: `resourceCapStatus()` stays `unknown`, so RL-13 line 100 fails on the real machine and the settings page shows "还没检查" instead of the reason. Every later capped execute probes again, each costing up to the 5 s ready timeout, and a concurrent caller can start a second probe, against L5's "同时只跑一个". L5 "作废" is about an execute's own pre-release failure, not the probe's canary. Fix: skip the invalidation when #runCapped runs the probe canary (an explicit flag on CappedRunContext), or have invalidation clear only the settled cache entry that this execute used. Prove it with RL-13 (RE1): `resourceCapStatus()` equals the capability for fail-bus and strip-p, and after the following `printf 'hi'` execute the fake log has exactly one canary (`cap_literal`) line.

### Item MF2 — Codex must-fix 2: the L5 ten-second probe deadline is missing and probe children are not reaped

**Found (confirmed).** There is no overall deadline anywhere in runResourceCapProbe or probeResourceCapsCanary. (a) commandOutput (539-550), used for `systemd-run --version` (2133) and, through ProcessSandbox.probe, for `bwrap --version` (764), has no timeout and no kill. Its stderr is a pipe that nobody reads, so a child that writes about 64 KiB of stderr blocks forever. (b) The waits add up past 10 s: the step-5 bwrap canary has its own 5 s timeout (805); the step-6 canary has timeoutMs 10_000 (868), and inside it the 5 s ready wait, the 250 ms escalation and the 1 s quiescence; then the scope-disappearance loop takes 2 s (926), worst case about 18 s. (c) L5 caching is single-flight (2087), and every capped execute awaits probeResourceCapsInternal (968). So one stuck version command leaves every capped command pending forever, and main.ts's background probe never fills the cache, so the settings page shows unknown. Codex is right that a bare Promise.race would leave the version child, or the capped canary's scope, alive.

**Ruling.** Spec L5, the step-6 rules: "全程最多 10 秒，超了 probe_failed". L5 caching: "同时只跑一个（共用同一个 Promise）". The cost of a missing deadline is unbounded, so this is a must-fix. The spec does not say whether the cleanup that runs after the deadline (kill, reap, settlement, removing the temp dir) counts toward the 10 s. Recommended lead ruling, as a post-note on L5: all probe work stops at 10 s, then only bounded cleanup runs (SIGKILL and wait for close, and the existing settlement's escalation and quiescence, about 1.5 s at most), and only then does the probe resolve probe_failed. It never resolves before its children are reaped. Second ruling: going past the deadline in step 5 gives probe_failed, not sandbox_unavailable.

**Fix.** process-sandbox.ts:
1. runResourceCapProbe: create one AbortController with a 10_000 ms timer (unref'd, cleared in finally) at the start, and pass its signal through every later step. Wrap the whole probe so that when signal.aborted it returns `fail('probe_failed', <fixed detail, e.g. '探测超过 10 秒'>)` whatever the inner step returned. Keep the rule that the probe never rejects.
2. commandOutput: add an optional `signal` argument. Spawn detached. Set stderr to 'ignore', or drain it within a bound. Keep at most 4 KiB of stdout. On abort, `process.kill(-pid, 'SIGKILL')`, then reject only after 'close' (reaped). With no signal the behaviour is unchanged for the K-slice caller.
3. Step 5: move the body of `ProcessSandbox.probe` into a private static helper that takes an optional signal. The public `probe` calls it without one, so its public signature and behaviour stay as they are (L14, F7). probeResourceCapsCanary calls the helper with the deadline signal: it is passed to commandOutput, and the uncapped canary request uses it instead of `new AbortController().signal`, with timeoutMs `min(5_000, remaining)`.
4. Step 6: the capped canary's request uses `signal` = the deadline signal and `timeoutMs` = the remaining budget, not a fresh controller and a fixed 10_000. The existing settlement then reaps: before release kill_group, then exit/close; after release SIGTERM to bwrap plus escalation, then close fd 5.
5. The 2 s scope-disappearance loop ends at `min(now + 2_000, deadline)`.
Do not use Promise.race and do not abandon any child.

**Tests.** These are new RE1 rows. §5 has no row for the 10 s deadline, so the lead adds them as RL-15b with a post-note on L5. Each test gets an explicit vitest timeout of 30 s.
(a) A new fake systemd-run mode `hang-version` in tests/helpers/RL-fake-systemd-run.sh: for `--version` it runs `exec -a rl-hang-<marker> sleep 600` instead of forwarding. Measure `t0`, then `await probeResourceCaps()`. Expect the result to match `{ status: 'unavailable', reason: 'probe_failed' }` (and the detail literal if the lead fixes one), and the elapsed time to be between 10_000 and 12_000 ms. `resourceCapStatus()` must equal that same result. Searching for the marker must return a definite "no match", using a pgrepMarked that tells no-match apart from a failed command (Codex item 9). Then a capped execute of `printf 'hi'` must return stdout `hi` and `resourceCaps` `{ status: 'none', reason: 'probe_failed', text: '没有资源上限：探测失败' }`, and the fake's `.log` must contain exactly one `--version` line, so nothing was probed again.
(b) Recommended: a fake bwrap set through CODING_AGENT_BWRAP_PATH that hangs on `--version` the same way, with systemd-run forwarded. `probeResourceCaps()` must return reason `probe_failed` (not `sandbox_unavailable`) within 12 s, and the marker search must give no match. Do not execute through that profile afterwards, because the unbounded K probe is unchanged.
There is no RE0 version: the timer and the children are private, and adding a production test hook is not allowed.

**Notes from the check.** None needed from the user. The lead has two wording rulings to record: whether the 10 s includes the bounded reaping, and that going past the deadline in step 5 means probe_failed. Conflicts: (1) this fix must not change the public ProcessSandbox.probe signature or the K probe's behaviour (L14, F7), hence the private helper. (2) Codex item 8 (the RL-09/09b cold cache) is a separate matter, but once there is a deadline, a child Node process that stalls in the probe gets probe_failed after 10 s instead of hanging, which can make those tests pass for the wrong reason. Item 8's handshake (probe inside the child first, then switch the fake's mode) stays required. (3) The cache-invalidation-during-probe defect reported under finding 1 also affects this path. Aborting through the signal finishes as not_started_cancelled or cancelled, neither of which invalidates the cache, so the probe_failed result does get cached. Keep it that way.

### Item MF3 — Codex must-fix 3: gate fd-4 stream errors can crash the Host

**Found (confirmed).** vendor/coding-agent/patches/sandbox/process/process-sandbox.ts #runCapped. Line 1449 types the gate as `{ write(chunk): unknown }`. Line 1459 adds only a 'data' listener to stdio[4], and nothing anywhere adds an 'error' listener to stdio[4] or stdio[5]. Line 1412 wraps `gateStream?.write("g")` in try/catch, which catches only synchronous throws. Node reports socket write and read failures asynchronously as an 'error' event (destroy(err)). With no listener that event becomes an uncaught exception, the same well-known crash as a child.stdin EPIPE. Node's 'pipe' stdio is a socketpair, so two windows exist after release. (1) The gate or bwrap dies, or closes fd 4, between the Host receiving `r` and writing `g`. The write then fails with EPIPE (or writeAfterFIN's EPIPE) and the Host dies. (2) The gate dies after `g` is written but before it reads it. Linux unix_release_sock then sets the Host's socket error to ECONNRESET because `g` is still unread, the next read fails, and the Host dies. Either way the whole Host process goes down, every Session with it, for one command's edge case. It can also happen during the background probe that main.ts starts after listen, because the probe canary runs through the same #runCapped. Codex's other point also holds: settlement is never touched on this path, so the released / possibly-started boundary is already right. The fix must keep it that way.

**Ruling.** Governing text, L4: 第4步在试着写 g 之前、同步地改成“已放行”，从这一刻起算“可能已开始”，不管 g 写没写成. Also L4: “已放行”以后，不论出什么事…结果照实报，不重跑. L11: 再也不起第二次. §8: no new error codes. L4/L12: 闸门读到文件结束…就退出，命令不跑. The spec does not say how the Host should handle errors on its own end of fd 4. Recommended ruling: a gate-stream error is never a settlement event, adds no stop reason and no startup failure, and is never retried. The Host only destroys its end of fd 4. A gate that is still waiting then reads EOF and exits 125 without running the command. bwrap exits, finalization runs and the outcome is reported as-is (`result`, status applied). This is a lead ruling, not a spec change.

**Fix.** process-sandbox.ts #runCapped:
(a) Type gateStream as a Duplex/net.Socket. Right after spawn, before attaching the 'data' listener, add `gate.on('error', () => { gate.destroy(); })`. The handler must not call apply/failStartup and must not change settlement.
(b) Add a no-op `on('error')` on stdio[5] (keeperStream). The Host never writes to fd 5, so this is cheap defence only.
(c) In onReady, after `apply({kind:'release'})` and only while `settlement.phase === 'released'`, write `gate.write('g', (err) => { if (err) gate.destroy(); })`, and skip the write if `gate.destroyed`. Keep the synchronous try/catch.
(d) Do not add a stop reason, a launch_failed path or a second write or spawn. Do not touch the uncapped path or stdout/stderr (§8).

**Tests.** RE1, deterministic. It needs a new fixture, `tests/helpers/RL-fake-bwrap.sh`, selected only through CODING_AGENT_BWRAP_PATH (L-fixtures allows this variable). It is file-driven like RL-fake-systemd-run.sh. Mode `forward` runs `exec /usr/bin/bwrap "$@"` and is used for ProcessSandbox.probe and the warm probeResourceCaps(). Mode `gate-reset` runs `printf r >&4; sleep 0.5 4>&-; exec 4>&- 4<&-; sleep 1; exit 7`. Closing fd 4 while `g` is still unread forces ECONNRESET on the Host's socket every time.
Test `RL-xx gate stream error after release does not crash the Host`: run in a child Node process, following the RL-child-node.mjs pattern. Warm the probe in forward mode, switch to gate-reset, execute with caps 256 MiB/64 and timeoutMs 30000, then print the result as JSON. Expected: child exit code 0, and the result equals {exitCode: 7, signal: null, timedOut: false, cancelled: false, resourceCaps: {status: 'applied', memoryMaxBytes: 268435456, tasksMax: 64, memory: 'none_observed', processes: 'none_observed', observationComplete: true}}. The fake systemd-run log shows exactly one scope launch. Before the fix, the child dies with an unhandled ECONNRESET.
If the lead does not approve the new fixture, accept code review as the only evidence and state that limitation in the evidence file. RE0 cannot reach this code.

**Notes from the check.** None for the user. Lead decision needed: approve the extra RE1 fixture RL-fake-bwrap.sh, which §7's fixture list does not include (A1). Its forward mode still requires the real bwrap and a real systemd user session, so it does not fake the environment.

### Item MF4 — Codex must-fix 4: exit after r but before release has no settlement path; late continuations after cleanup

**Found (confirmed).** Part 1, exit after `r` but before release. The exit handler (line 1465) calls failStartup('launcher_exited') only `if (!ready)`, and `ready` becomes true as soon as `r` arrives (line 1374). If the child exits during onReady's awaits, settleExecution's `bwrap_exited` (lines 463-473) only sets bwrapExited while the phase is 'starting'. It records no failure and emits no close_keeper. The later `release` is refused because bwrapExited is set (line 415). The keeper still holds fd 5, so Node's child 'close' event never fires (fds 1, 2, 4 and 5 each count toward it), and streams_closed never arrives. The execution hangs until timeoutTimer fires. It then settles as launch_failed `deadline_before_start`: wrong reason, cache not invalidated, a machine fault hidden. If the scope is killed from outside (keeper dead too), all streams close with no stop at all. settlementOutcome (line 371) then returns `not_started_cancelled`, and `#notStartedResult(true, …)` hands back `cancelled: true` to a caller who never cancelled.
Part 2, late continuations. onReady does not recheck settlement after its awaits (readScopePath, identifyKeeper, limitsEffective, baseline). Suppose a timeout, cancel, ready_timeout or exit settles the run while onReady is suspended, and 'close' has already run clearTimers. On resume, onReady still calls `context.onScopeReady`, `apply(keeper_recorded)` and `startObservation()`. startObservation creates fs.watch watchers, which are ref'd and leak inotify handles, and a 100 ms setInterval that is never cleared. This breaks L4's 已结算以后来的事一概不理 and 计时器和监听归结算管.

**Ruling.** Governing text, L4: “已放行”之前，命令一定没跑。这时出任何问题都当作没开始…抛 launch_failed…这个键的能力缓存作废. Also L4: 已结算以后来的事一概不理；计时器和监听…一直留到结算. RL-22 (a): not_started_cancelled only follows a cancel. The L4 table defines launcher_exited only as 收到 r 之前子进程就退出了, so the spec does not cover an exit after `r` but before release. Recommended lead ruling: any exit of the spawned process before release is `startup_failed: launcher_exited`. It closes fd 5 (the keeper reads EOF and exits, per L1) with no kill_group, the same as RL-22 (p). It invalidates the cache and needs no new reason or type, since StartupFailure is frozen. Record a post-note in the L4 table changing 收到 r 之前 to 放行之前. This conflicts with no other finding: cancel and deadline_before_start still win when they come first, because the new rule applies only while stopReason and startupFailure are both null.

**Fix.** process-sandbox.ts:
(1) settleExecution, case 'bwrap_exited': when phase === 'starting', startupFailure === null and stopReason === null, set startupFailure = 'launcher_exited' and call closeKeeper (no kill_group).
(2) settlementOutcome: return not_started_cancelled only when phase === 'starting' && stopReason === 'cancel'. After change (1) no other starting-phase outcome is reachable.
(3) #runCapped exit handler: change `if (!ready)` to `if (settlement.phase === 'starting')`, so the first 256 bytes of stderr are recorded with launcher_exited. failStartup already guards against an earlier stop or failure.
(4) onReady: add `stillStarting = () => settlement.phase === 'starting' && settlement.stopReason === null && settlement.startupFailure === null && !settlement.bwrapExited`. Check it at entry and after every await, and return silently when false. In particular, call onScopeReady, apply(keeper_recorded), startObservation() and apply(release) only while it holds. Keep `startObservation(); apply(release)` in one synchronous block after the last check. The fd-4 'data' handler also requires phase 'starting'.
(5) startObservation returns early if the phase is 'settled' or bwrapExited is set.
No change to the uncapped path. No retry: the result is still launch_failed, with no second spawn.

**Tests.** RE0, added to tests/kernel/RL-22-settlement.test.ts with literal states.
RL-22 (u): spawned, keeper_recorded 4242, bwrap_exited. State = {phase 'starting', hasPid true, keeperPid 4242, startupFailure 'launcher_exited', bwrapExited true, keeperClosed true, others initial}; actions = [close_keeper]. Then release: actions [], state unchanged. Then streams_closed: actions [finish {launch_failed, launcher_exited}], phase 'settled'.
RL-22 (u'), scope killed from outside with no stop: spawned, keeper_recorded 4242, streams_closed, bwrap_exited. Actions = [close_keeper, finish {launch_failed, launcher_exited}]. The outcome is never not_started_cancelled.
Existing (a), (p) and (r) must pass unchanged: cancel then exit is still not_started_cancelled, and a pre-release timeout is still deadline_before_start.
The Runtime parts (exit-handler condition, onReady guards, startObservation guard) cannot be timed on a real machine and have no public hook. Verify them in Codex's quick check by review and state that limitation in the evidence file; do not add a production test hook.
Optional RE1 smoke test, only if the lead approves the RL-fake-bwrap.sh fixture from finding 3, mode `exit-after-r` = `printf r >&4; exit 9`, timeoutMs 60000. Settlement must arrive within 5 s. The outcome is either a ProcessSandboxError with code launch_failed whose message starts with 'launcher_exited:', or (when the release won the race) a result with exitCode 9 and status applied. It is never `cancelled: true` and never a message starting 'deadline_before_start:'.

**Notes from the check.** None for the user. Lead ruling needed: post-note on the L4 table so that launcher_exited covers any exit before release, not only before `r`.

### Item MF5a — MF5a observe() Promise.all drops a good read

**Found (confirmed).** process-sandbox.ts observe() (~l.1256-1273): `await Promise.all([readFile(memory.events), readFile(pids.events)])` in one try; if either rejects, the catch skips the merge and the OOM-stop check, so a successful memory read showing Δoom_kill is discarded. readFinal() (~l.1211-1240) already reads each file separately and merges what succeeded. parseResourceCapCounters("" ,…) returns zeros (l.289-309), so merging a half-read cannot lower anything.

**Ruling.** L7: '每次读成功，每个计数都和已存的值比，取大的…读失败不改任何值'; §4 rule 5 '看到过的事件从不丢'; L8 'bwrap 还没退出时读到 oom_kill 或 oom_group_kill 比基线多：…马上…SIGKILL'. Reading each file is its own read, so a successful one must be merged. Real defect; it only bites when one file fails and the other does not (rare), but the fix is small.

**Fix.** process-sandbox.ts #runCapped: add one non-exported helper (e.g. readCounterFiles(): {memoryText|null, pidsText|null}) used by both observe() and readFinal(). In observe(): merge whenever at least one file was read (missing side = ""), then run the OOM-stop check on maxSeen. Before apply({kind:'stop',reason:'host_oom_kill'}), check again after the awaits that the settlement is not settled and bwrap has not exited (L8 says 'bwrap 还没退出时'; this goes with Codex must-fix 4's 'recheck settlement after async reads'). Keep the baseline read in onReady as Promise.all: L7 says a baseline that cannot be read means not started.

**Tests.** No new test. A fault in one cgroup file cannot be injected on a real machine without a test hook, which §5 head forbids. RE0 RL-20 (16) already pins the merge rule. Regression: RE1 RL-03, RL-03b, RL-03c and RL-01 must still pass in WSL. The lead verifies by reading the code and records in the evidence that this branch is not covered by a test.

### Item MF5b — MF5b swap-limit read error treated as absent

**Found (confirmed).** process-sandbox.ts limitsEffective() (~l.1357-1373): the inner `try { readFile(memory.swap.max) … } catch { /* L6：有才读 */ }` treats every error (EACCES, EIO, ENODEV …) as 'file absent' and returns true. The command is then released and reported `applied` without the swap limit having been checked. Checked read-only in WSL: /sys/fs/cgroup/user.slice/memory.swap.max exists (kernel 6.18.33.1), so today's machine never needs the absent branch.

**Ruling.** L6: '读…memory.swap.max（有才读）…memory.swap.max 是 0；不对就是 L4 的"没开始"'. L5 step 6: '有 memory.swap.max 而不是 0 → controllers_not_delegated'. 'Present only' (有才读) covers genuine absence (ENOENT) only. Any other read failure means the limit was not proven, which is startup_failed limits_not_effective (L4 table).

**Fix.** process-sandbox.ts limitsEffective(): in the swap catch, return true (absent) only when (error as NodeJS.ErrnoException).code === 'ENOENT'; for every other error return false, putting the errno in launchDetail (e.g. 'limits_not_effective: memory.swap.max read failed EACCES'). The rest is unchanged: failStartup('limits_not_effective'), kill_group, launch_failed, cache invalidated. The canary's existing mapping (limits_not_effective → controllers_not_delegated) may stay as is because both outcomes are 'unavailable', which is safe. Optionally map a read-error detail to probe_failed instead.

**Tests.** No new test. Cgroup read errors cannot be produced on a real machine without a hook (§5 head). Regression: RE1 RL-01 (swap 0 is read and verified) and RL-13 'remove all -p' → controllers_not_delegated must still pass. Lead verifies by reading.

### Item MF5c — MF5c probe: any scope stat error counts as disappearance

**Found (confirmed).** process-sandbox.ts probeResourceCapsCanary (~l.925-933): `try { await stat(scopeDir) } catch { return { status: 'available' } }`. Any stat failure, not only ENOENT, turns into a definite 'available' capability.

**Ruling.** L5 step 6: 'Host 关掉 fd 5 以后，scope 目录 2 秒内消失…任何一条不对 → probe_failed，明细写"看门进程没通过"'; §0.2 tail: '探测证明不了的，就报不可用'. Only ENOENT proves the directory disappeared.

**Fix.** probeResourceCapsCanary: in the stat catch, return { status: 'available' } only when the code is 'ENOENT'. Otherwise return { status: 'unavailable', reason: 'probe_failed', detail: `看门进程没通过：scope 目录读不了 ${code}` }. The 2 s loop and the timeout result stay as they are.

**Tests.** No new test (a stat error on /sys/fs/cgroup cannot be produced on a real machine without a hook). Regression: RE1 RL-15 (available, one probe batch) and RL-01 (unit not-found within 2 s). Lead verifies by reading.

### Item SF1 — SF1 pre-start cancellation returns none instead of not_started

**Found (confirmed).** execute() (l.947-951): `notStartedReport = caps.kind === 'capped' ? {status:'not_started'} : caps.report`, so with caps unavailable or not_configured a signal aborted before start returns `{status:'none',…}`. #runUncapped's second pre-spawn abort check (~l.1615-1616) also returns `report` (none). Related: execute() runs #resolveResourceCaps() (which may run the whole probe canary, up to 10 s) before it checks the abort. #runCapped has no pre-spawn abort check: a cancel that arrives during preparation (snapshot, #classifyProtectedPaths, #arguments) still spawns systemd-run and then kill_groups it (`if (request.signal.aborted) onAbort()` right after spawn, ~l.1488). No existing test pins `none` for a pre-start cancel (grep of tests/).

**Ruling.** L10: '命令没开始（启动前已取消，或"已放行"之前取消）：{ status: 'not_started' }'. This is not qualified by whether caps are available. L4: '起跑前已取消：返回今天"没开始"的取消结果（F2）'. F2: 'spawn 之前已取消的不起进程'. Ruling: the report describes the command, so every not-started cancellation carries not_started, capped or not. `none` is only for commands that actually ran uncapped (RL-13). The spec could be read the other way (§0.1 item 8 '每条命令的结果里都写"没有资源上限"'), so the lead should record this ruling. It is a spec reading, not a product decision.

**Fix.** process-sandbox.ts: (1) execute(): move `if (request.signal.aborted) return #notStartedResult(true,false,limit,{status:'not_started'})` to directly after the sandbox_unavailable check, before #resolveResourceCaps(), so no probe runs for a call that is already cancelled. (2) #runUncapped: the pre-spawn abort return uses {status:'not_started'} instead of `report`. (3) #runCapped: after #arguments and before spawn, add the same check (close rootCapability, return not_started, no spawn, no settlement, no cache invalidation) so F2 holds on the capped path too.

**Tests.** RE1, added as RL-10b cases (2) and (3), not a new row. (2) Sandbox built without resourceCaps (not_configured), and a sandbox with caps but CODING_AGENT_SYSTEMD_RUN_PATH=/nonexistent/rl-systemd-run (no_systemd_run). Each executes 'touch /workspace/.rl-pre' with an AbortController aborted before execute → toMatchObject({cancelled:true, timedOut:false, exitCode:null, resourceCaps:{status:'not_started'}}); .rl-pre absent. (3) Capped, cache warmed with the recording fake in 'forward' mode, signal aborted before execute → same literal result, and the fake's 'agent-keeper' line count is unchanged (0 new launches). Conflict to rule on: RL-10c asserts exactly `before + 1` launches per iteration (RL-06-11-stop.test.ts ~l.358). With fix (3), an abort landing during preparation yields 0 launches. Even today that assertion is racy: kill_group can SIGKILL the fake before it writes its log line. Recommend reading the row's '每次只调一次假 systemd-run' as 'never more than one': assert `<= before + 1`, and `=== before + 1` when resourceCaps is applied. Also note for Codex must-fix 6: the check codec must accept `not_started` (and `none`) inside an `executed` observation, because check-execution copies the Kernel report verbatim and a cancel that reaches the sandbox produces executed + cancelled + not_started.

**Notes from the check.** None. The lead rules on the L10 reading and on the RL-10c reading.

### Item SF3 — SF3 capability lookup ignores profile.bwrapPath

**Found (confirmed).** #resolveResourceCaps() calls probeResourceCapsInternal(), which keys the cache and runs the canary with resolveBwrapPath() = env CODING_AGENT_BWRAP_PATH ?? /usr/bin/bwrap (l.2055-2056, 2083-2089). #runCapped launches `this.profile.bwrapPath` (l.1140, 1426, 1439), which ProcessSandbox.probe took from options.bwrapPath ?? env ?? default (l.758-759). The two differ when a caller passes bwrapPath (K-readonly-sandbox.test.ts l.791/803 do, without caps) or when env changes between probe and execute. #runCapped also re-reads resolveSystemdRunPath() separately from the probe. Today there is no production trigger: the composition root, check-execution, workbench and readonly-command-tool (comment l.248) pass no bwrapPath. invalidateResourceCapCache() clears the single slot whatever the key.

**Ruling.** L5 step 5: 'ProcessSandbox.probe 说 bwrap 可用（同一个 bwrap 路径）'. Cache: '按（systemd-run 路径、bwrap 路径、uid）在 Host 进程里缓存'. Invalidation: '作废这个键的缓存'. 'This key' is the key of the executing command, whose bwrap is profile.bwrapPath (L1 launches the bwrap of today's spawn). This is a latent mismatch, so should-fix. The public probeResourceCaps() keeps its no-argument §2 signature.

**Fix.** process-sandbox.ts: give probeResourceCapsInternal(systemdRunPath = resolveSystemdRunPath(), bwrapPath = resolveBwrapPath()) internal parameters; the exported probeResourceCaps()/resourceCapStatus() keep using the env/default key. #resolveResourceCaps passes this.profile.bwrapPath, resolves systemdRunPath once, and stores {systemdRunPath, bwrapPath, key} in the 'capped' caps object. #runCapped uses caps.systemdRunPath and caps.bwrapPath (no second env read). invalidateResourceCapCache(key) drops only that key. Make the cache a Map by key so a differing key does not evict the default entry; resourceCapStatus() reads the env/default key's entry.

**Tests.** RE1, optional (no production trigger; AGENTS rule 3 says no non-blocking tests, so the lead decides). If added, make it an RL-15 case: a passthrough wrapper script (`#!/bin/sh\nexec /usr/bin/bwrap "$@"`) in the test dir, CODING_AGENT_BWRAP_PATH unset, the recording forward fake systemd-run, ProcessSandbox.probe(root, ws, {bwrapPath: wrapper}), new ProcessSandbox(…, {resourceCaps: 256 MiB/64}), execute 'true' → resourceCaps.status 'applied', exitCode 0. Every logged 'agent-keeper' launch (canary and command) is followed by the wrapper's absolute path and none by /usr/bin/bwrap. Otherwise the lead verifies by reading.

### Item 5(c)-2 — 5(c)-2 pre-release host_oom_kill mapped to deadline_before_start

**Found (confirmed).** process-sandbox.ts:421-433: in the starting phase, any non-cancel stop (timeout or host_oom_kill) sets startupFailure 'deadline_before_start'. It is unreachable today: startObservation() and apply({kind:'release'}) run in one synchronous block (:1407-1408). observe() runs only from later watch/interval ticks. Once release is refused, settleExecution breaks early because stopReason or startupFailure is already set, or observe returns early on bwrapExited.

**Ruling.** The spec does not cover this case. L4 table: deadline_before_start = '命令的超时在放行之前到了' only. L8 OOM acceptance is 'bwrap 还没退出时读到…', which is post-release observation. StartupFailure may not grow (no new reasons/error codes, §8). Ruling: settleExecution does not accept host_oom_kill while starting (no state change, no actions). Timeout→deadline_before_start and cancel→not_started stay as they are. No new lifecycle.

**Fix.** In process-sandbox.ts settleExecution, `stop` in phase 'starting': if event.reason === 'host_oom_kill', break before any mutation, with a comment saying it is unreachable and why. Optionally make #runCapped's observe() apply host_oom_kill only when settlement.phase === 'released'. Coordinate with the MF-4 owner; MF-4 also asks that observers not be installed when release did not take effect.

**Tests.** RE0, tests/kernel/RL-22-settlement.test.ts, new case 'RL-22 (u) host_oom_kill while starting is ignored'. From the starting state the test file already uses (hasPid true), event {kind:'stop', reason:'host_oom_kill'} gives state toEqual the input state and actions toEqual []. A following {kind:'release'} gives phase 'released'. RED today: startupFailure 'deadline_before_start' plus kill_group/close_keeper.

### Item 5(c)-3 — 5(c)-3 RL-22(m) three keeper shapes

**Found (confirmed).** RL-22-settlement.test.ts:237-254 feeds the identical event {quiescence_failed, keeper_not_identified} three times under comments claiming three shapes. The shapes are only told apart in #runCapped waitQuiescence (process-sandbox.ts:1185-1210): wrong pid :1199, cmdline :1199, gone :1209. Side note: a cgroup.procs read failure becomes lastProcs=[] (:1195-1196) and then keeper_not_identified at the deadline. Both give observationComplete false, so it never becomes a definite result.

**Ruling.** Row RL-22 (m) asks for 'three examples', but at the §2 settleExecution seam they are one event. §5 forbids test hooks ('生产代码里不加只给测试用的口子'), and RE1 cannot produce the shapes deterministically. Ruling: accept the seam limitation and report coverage accurately. No new export or hook.

**Fix.** Test-only. Collapse (m) to one case: 'RL-22 (m) quiescence_failed keeper_not_identified ends like (l)'. Assert state toEqual the expected value and actions toEqual [CLOSE], and remove the m1/m2/m3 comments. The lead's evidence and spec post-note on RL-22 (m) say: the three production shapes are in waitQuiescence and are covered by review, not tests.

**Tests.** RE0, the single collapsed (m) case.

### Item MF-6 — MF-6 (codec does not validate observation resourceCaps)

**Found (confirmed).** evidence-record-codecs.ts:592-620 checkObservationProblem never looks at resourceCaps. evidence-service.ts:1324 validates, then :1355 storeReport writes the report, then :1360 resourceCapHitOf reads report.status. So resourceCaps:null throws a TypeError after the report has been stored. An applied report with memoryMaxBytes < 1 MiB gives memoryCapMiB 0, which the checkSnapshotProblem (:217) rejection only catches at commit, also after storage. A bogus processes value is stored and accepted. The check runner (check-execution.ts:241-248) copies the Kernel value verbatim.

**Ruling.** Spec §6 (contracts line) gives evidence-record-codecs.ts the job '有时校验形状' for the new optional executed field. §2 defines ResourceCapsReportV1 as a closed union. Kernel L13 says an applied request is 'memoryMaxBytes 1 MiB 整数倍且 ≥16 MiB, tasksMax 8..4194304'. The VR-03 comment at evidence-service.ts:1345 says validation comes before any IO. Legacy observations without the field stay valid ('旧记录没有这一项').

**Fix.** In evidence-record-codecs.ts, add resourceCapsReportProblem(value). Call it from checkObservationProblem in the executed branch when observation['resourceCaps'] !== undefined. Rules: record; status is applied, none or not_started. applied: exact keys {status, memoryMaxBytes, tasksMax, memory, processes, observationComplete}; memoryMaxBytes is a safe integer ≥ 16*MIB with % MIB === 0; tasksMax is an integer 8..4194304; memory is cap_hit, none_observed or uncertain; processes is cap_hit, none_observed or unknown; observationComplete is boolean. none: exact keys {status, reason, text}; reason is one of the 9 ResourceCapUnavailableReasonV1 values (local const array with `satisfies`); text is a non-empty string. not_started: exact keys {status}. Then in evidence-service.ts resourceCapHitOf, use exact division memoryMaxBytes / MIB (see 5(c)-8).

**Tests.** RE2, tests/runtime/RL-32-check-resource-caps.test.ts, new cases 'RL-32 (c)…'. Use the R3e fixture with the RL double, one case per malformed report. (c1) resourceCaps null. (c2) {...CAP_HIT, memoryMaxBytes: 6144*1048576+1}. (c3) {...NO_HIT, processes:'maybe'}. For each, runRegisteredCheck answers toMatchObject {status:'rejected', code:'invalid'}, and readVerification shows that check with phase 'executing' and reportRef null. RED today: c1 throws TypeError, c2 and c3 commit. The legacy no-field case is already covered by the existing R3e tests.

### Item MF-10 / 5(a) — MF-10 / 5(a) (A2-settings-automation exact toEqual vs always-present resourceCaps)

**Found (confirmed).** tests/app/A2-settings-automation.test.ts:65-66 and :129 use toEqual on the whole snapshot value. host-settings.ts snapshotOf (:549-560) always adds resourceCaps, as RL-40 requires (present with null/defaults/machine:'unknown' even without a file or resourceCapStatus). No other test asserts the whole snapshot (grep). The §5.3 premise is false.

**Ruling.** Spec §5.3 row ('A2-settings-automation.test.ts | 不翻转…快照用 toMatchObject') conflicts with RL-40 and §2 (snapshot carries resourceCaps). §5.3's heading ('lead 写出前后断言，DSH 不自行翻转') puts the edit with the lead. Ruling: amend these two assertions and nothing else. Do not suppress resourceCaps. Lead adds a post-note correcting the §5.3 row and lists this as the second sanctioned existing-test edit beside B2-history-public-export.

**Fix.** Lead-written edit (builder applies it verbatim). Line 65 becomes: expect(await settings.call('snapshot', {})).toEqual({ status: 'ready', value: { models: [], workspaces: [], automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: true }, resourceCaps: expect.any(Object) } }); Line 129 becomes: expect(saved).toEqual({ status: 'ready', value: { models: [], workspaces: [], automation: policy, resourceCaps: expect.any(Object) } }); Add a comment: 'RL L13: resourceCaps is always published; its content is RL-40's.' Every other key stays exact.

**Tests.** RE3: the two amended A2 tests pass. RL-40 keeps owning the resourceCaps content.

### Item 5(b) — 5(b) (NoticeItemV1 lacks raise_memory_cap)

**Found (confirmed).** decision-contracts.ts:258-266 NoticeItemV1 has no actions field. automatic-rework-notices.ts adds a local intersection AutomaticReworkNoticeItem = NoticeItemV1 & {actions?} and emits it as NoticeItemV1, so typed consumers (decision-read-model, HTTP, E3) have to cast. RL-32b casts to Record<string, unknown>. The value does pass through queryDecisionQueue at runtime (RL-32b (b) passes). decision-contracts.ts is the slice 5 file (§4.1). It is not in RL §6.

**Ruling.** L16 says '条目加操作 { kind: raise_memory_cap }', and decision 55 already fixed the product behaviour. §6 says '施工时以实际为准，超出要报', and the builder reported it. Ruling: the lead authorises a narrow scope addition of one optional field. This is not E3 work. Lead adds post-notes on RL §6 and slice 5 §4.1.

**Fix.** In src/core/work-graph/model/decision-contracts.ts NoticeItemV1, add `actions?: { kind: 'raise_memory_cap' }[];` with a comment: only on an automatic_rework item whose trigger round has a resourceCapHit; absent otherwise, so existing notices stay word-for-word the same. In automatic-rework-notices.ts, delete RaiseMemoryCapAction and AutomaticReworkNoticeItem and use NoticeItemV1. Keep the field optional; do not add `actions: []` to other items. If a named alias is exported, NoticeItemV1 must use it (production-reach).

**Tests.** RE2: in RL-32b, drop the `as unknown as Record<string, unknown>` casts and read notice.actions and notice.summary typed. Keep the literals of (b) [{kind:'raise_memory_cap'}] and (c) actions undefined. npm run typecheck is the proof. Existing notice tests stay unchanged.

**Notes from the check.** none (decision 55 covers it)

### Item 5(c)-5 — 5(c)-5 RL-32b requeue branch not covered

**Found (confirmed).** RL-32b-rework-notice-memory-cap.test.ts:61-109 builds only a system reverify (platform.evidence.reverifyRound). The requeue branch (automatic-rework-notices.ts:245-260, triggerRoundCapHit :507-523, one readMany by afterRoundRef) is not run by any test. The requeue branch is the main product path: a check FAIL gets automation verdict {kind:'requeue', failureClass:'check_failed'} (tests/composition/A2-requeue-platform.test.ts:270-275), with afterRoundRef = the failed round (:293). firstResourceCapHitOf ordering (:497-502) and the trigger-read failure (:512-521) are also untested.

**Ruling.** Governed by L16 '读法': '重新入队的那条按 TaskRequeue.afterRoundRef 按键读一次轮次；重新检查的那条用…前一轮'; 'N 取第一项（按 checkId 排）'; '读失败…不当成没有'. A5 makes both reads binding. Row RL-32b ('检查失败、系统自动返工') is generic, so both branches fall under it.

**Fix.** Test-only. Production code is unchanged unless a new test exposes a defect.

**Tests.** RE2, tests/work-graph/RL-32b-…test.ts. (e) Requeue with cap hit. Build the dataset through public services as in A2-requeue-platform.test.ts: a scripted Work Run, then the round with the registered check, where the RL double returns exitCode 137 with CAP_HIT; finalize FAIL; then the Workflow's automatic requeue under the default policy (system, counted, autoCount 1, cap 3). The automatic_rework notice with rework.operation 'requeue' has summary `自动返工 · <taskId> · 第 1 次（1/3）` + '检查超出内存上限（当时上限 6144 MiB）' (separator per 5(c)-6) and actions [{kind:'raise_memory_cap'}]. (f) Same with NO_HIT: summary is exactly today's sentence, actions undefined. (g) Ordering, on either branch (the reverify dataset is cheapest). The trigger round has two registered checks, both cap_hit. The double gives 512 MiB to the check whose checkId sorts first and 6144 MiB to the other. Run the later-sorting check first, so neither execution order nor round.checks order equals checkId order. Expected sentence: '（当时上限 512 MiB）'. (h) Trigger-read failure, only if the lead authorises a storage wrapper as an L-fixtures exception (precedent: 2C-31 failingReads, tests/app/S2C-line-routes.test.ts:103). Use the (e) dataset, with the notice source read through a records wrapper whose readMany answers {status:'rejected', code:'unavailable'} only when the keys include the trigger round's canonical key. queryDecisionQueue then answers toMatchObject {status:'rejected', code:'unavailable'} and never returns a notice without the sentence. Without that authorisation, (h) is review-only and the evidence says so.

**Notes from the check.** none. The lead must decide whether the storage-wrapper exception for (h) is allowed.

### Item 5(c)-6 — 5(c)-6 L16 summary separator

**Found (partly).** automatic-rework-notices.ts withResourceCapHit (:528-535) gives `${item.summary}检查超出内存上限（当时上限 N MiB）`, for example '自动返工 · T · 第 1 次（1/3）检查超出内存上限（当时上限 6144 MiB）'. Today's summaries use ' · ' as the separator (reworkSummary :542-545).

**Ruling.** L16 / RL-32b: '摘要后加' / '今天那一句加' do not fix a separator. Plain concatenation meets the letter, so it is not a correctness defect (Codex is right). Recommendation, for the lead to pick: use ' · ' to match the existing summary grammar. Keeping plain concatenation is also acceptable; record the choice in an L16 post-note either way.

**Fix.** If ' · ' is chosen: in withResourceCapHit, use `${item.summary} · 检查超出内存上限（当时上限 ${N} MiB）`. Otherwise no change.

**Tests.** RE2 RL-32b (a) and the new requeue case (e), literal `自动返工 · ${R3E_WORK_TASK_ID} · 第 1 次（1/3） · 检查超出内存上限（当时上限 6144 MiB）` (or today's concatenation if unchanged). (c) and (f) stay exactly today's sentence.

**Notes from the check.** Wording only. The lead picks; the user can see it when E3 shows the notice.

### Item 5(c)-7 — 5(c)-7 RL-34 config revision via fixture

**Found (confirmed).** RL-34-wiring-resource-caps.test.ts:206-243 compares hostConfigurationRevision, but the S2B fixture fixes it to the constant 's2b-be1-host@1' (S2B-be1-platform-fixture.ts:245). The equality and the 'forbidden digits' loop (:236-238) therefore hold by construction. The real Host is wired through a vi.mock wrapper of createTargetPlatform, not the real Host. Static check of host.ts: installFromSettings (:667-702) computes the binding revision from {scope, duty, residentBytes, tools, writeScope, modelRevision} (:645-652) and the check revision from {answerDigest, checks} (:684-686). resourceCaps only updates the holder (:674). The live-save propagation through the real Host is in RL-44.

**Ruling.** RL-34 asks '真实 Host…这次 Work 的配置版本在保存前后相同' and L13 says '改设置不改任何执行的配置版本'. The real Host exposes no readable revision without a real model (§8 forbids real model calls). Ruling: accept the split evidence and state the limit. L-tdd forbids tests whose answer is obvious, so remove the tautological parts.

**Fix.** Test-only. In the RL-34 revision case, delete the hostConfigurationRevision equality and the forbidden-digit loop. Keep the product-written manifest checks: no 'resourceCaps' before and after the save, and currentReads equal [EXPECTED_SAVED]. Rename to 'RL-34 caps enter no prepared manifest before or after a live save'. Evidence: the real-Host revision inputs are verified by review (host.ts lines above); holder propagation through the real Host is in RL-44 live-save.

**Tests.** RE2 RL-34 (renamed case) and RE3 RL-44 live-save, both unchanged otherwise.

### Item 5(c)-8 — 5(c)-8 resourceCapHitOf status check and Math.floor

**Found (partly).** evidence-service.ts:220-225. `report.status !== 'applied'` is the TypeScript discriminant needed to read `memory`, so it does not go beyond L16. Math.floor(memoryMaxBytes/MIB) hides malformed input. The codec currently lets a non-MiB value through (see MF-6).

**Ruling.** L16: 'memoryCapMiB 抄观察里记下的上限'. L6/L13: values are whole MiB, and the Kernel rejects anything else before start. Ruling: keep the applied discriminant. Validate whole MiB at admission (MF-6), then divide exactly.

**Fix.** evidence-service.ts resourceCapHitOf: `memoryCapMiB: report.memoryMaxBytes / MIB`, which relies on the MF-6 codec rule (multiple of MIB, ≥ 16 MiB).

**Tests.** Covered by MF-6 case (c2) (RE2: 6144*MIB+1 is refused as invalid) and RL-32b (d) (memoryCapMiB 6144).

### Item SF-2 — SF-2 stored resourceCaps validation accepts zero/out-of-range

**Found (confirmed).** host-settings.ts parseStoredResourceCaps (:347-362) accepts any non-negative safe integer. A stored memoryMaxMiB 0 or tasksMax 0 loads, the private snapshot pushes memoryMaxBytes 0 / tasksMax 0, and every capped command then fails the Kernel L13 recheck (launch_failed). The precedent parseStoredAutomation fails start-up on an out-of-range stored policy (A2-settings-automation.test.ts it.each 'fails start-up instead of reading defaults').

**Ruling.** L13 validation table: memoryMaxMiB null or 256 ≤ v ≤ floor(RAM/MiB); tasksMax null or 64..65536. Explicit exception: '启动时读到的值比这台机器的内存还大：照存的值用，不报错'. The spec says nothing else about invalid stored values. Ruling: same as automation, start-up fails. Do not fall back to defaults; a corrupt value must not quietly become 'default'.

**Fix.** In host-settings.ts parseStoredResourceCaps: memoryMaxMiB is null or a safe integer with RESOURCE_CAP_MIN_MEMORY_MIB ≤ v ≤ Math.floor(Number.MAX_SAFE_INTEGER / MIB), with no machine-RAM upper bound. tasksMax is null or an integer from RESOURCE_CAP_MIN_TASKS to RESOURCE_CAP_MAX_TASKS. Anything else throws 'the private host settings file is invalid'. Update the doc comment.

**Tests.** RE3, tests/app/RL-40-43-resource-cap-settings.test.ts, 'RL-42 (stored) …'. it.each over the stored {schemaVersion:1, memoryMaxMiB, tasksMax} values (0,null), (255,null), (null,0), (null,63), (null,65537): createHostSettings rejects with toThrow('the private host settings file is invalid'). Also stored (4194304, null) loads: the pushed private snapshot has resourceCaps.memoryMaxBytes 4398046511104, and the snapshot has memoryMaxMiB 4194304 and effective.memoryMaxMiB 4194304. That value is a literal, above any test machine's RAM.

**Notes from the check.** none. A hand-edited bad value stops the Host from starting, the same as automation; the lead may mention this to the user.

### Item 7 — Codex must-fix 7

**Found (confirmed).** tests/helpers/RL-resource-caps-support.ts:66-77 (makeRLSandbox) passes workspaceMode only to ProcessSandbox.probe. The constructor falls back to read_write (process-sandbox.ts:712 `options.workspaceMode ?? "read_write"`). probe(read_only) runs only the read-only canary (788-792), and the profile it returns does not record the mode. So all four RL-14 tests run read_write. KB-01 (writes succeed) and KB-03 (`git commit` succeeds) will fail on the lead's machine, which is fail-safe. KB-04 and KB-05 pass, but without checking read_only, so they say nothing about L14. The K-B fixture passes read_only to both calls (K-readonly-sandbox.test.ts:95, 118-120).

**Ruling.** Spec §5.2 RL-14 says the KB assertions must run 在只读模式加上限下各跑一遍; L14 keeps M10-M12. Only the helper is wrong; the test bodies already match the row.

**Fix.** tests/helpers/RL-resource-caps-support.ts:makeRLSandbox: build `const mode = options.workspaceMode === undefined ? {} : { workspaceMode: options.workspaceMode }` once. Spread it into both `ProcessSandbox.probe(root, ws, mode)` and `new ProcessSandbox(profile, root, ws, { ...mode, ...(source === undefined ? {} : { resourceCaps: source }) })`. Do not change any test file.

**Tests.** RE1 RL-14 KB-01/03/04/05 stay as they are. KB-01 proves the fix: all 7 attempts end non-zero with resourceCaps {status:'applied'}, sentinel.txt reads 'SENTINEL-KB01', sub/keep.txt reads 'KEEP', `.evaluator` is []. KB-03 also proves it: the commit exits non-zero. Both fail before the fix and pass after it, so no new test is needed. The lead runs them in WSL.

**Notes from the check.** None. Note for the lead: after the fix, RL-14 reaches the capped read-only branches of #runCapped (process-sandbox.ts ~1521-1533) for the first time. Any new failure there is an implementation finding, not a test problem.

### Item 8 — Codex must-fix 8

**Found (confirmed).** (a) RL-08 and RL-08b (RL-06-11-stop.test.ts:137, 154) wrap the payload in identityAndWait, but nothing writes `.rl-release`. `.rl-marked` and `.rl-lines` never appear, so both rows fail at waitForPath, which is fail-safe. The child is left running for up to 60 s and is never reaped.
(b) The probe cache is module-level (process-sandbox.ts:2068 `let resourceCapCache`), so each process has its own. RL-child-node.mjs:17-24 never warms it, so the child's first execute probes cold. In RL-09 the probe canary meets the wait-external fake and stalls (5 s ready timeout). The test SIGKILLs the child at 1.5 s, inside the probe, so the command never launches. In RL-09b the started file is written by the canary's launch, so the child is stopped during the probe. Both pass without testing anything.
(c) RL-09 and RL-09b also use identityAndWait. A command that did start would write `.rl-identity` and then block, so the `.rl-09`/`.rl-09b` absence check passes even if the gate let the command start.
(d) The RL-09 loop at line 187 polls while the file exists, so it exits at once and checks the instant after the external file is written. RL-09 never asserts the unit is not-found. RL-09b never waits for ActiveState=active and never asserts not-found.
(e) No afterEach kills or reaps children.

**Ruling.** Spec §5.2 RE1 convention bullet 4: warm-up 先在同一个 Host 进程里（子 Node 进程的行就在那个子进程里）…跑一次 probeResourceCaps()…再切换夹具的模式. Rows RL-08/08b/09/09b. L12: the command never starts after Host death. RL-09/09b define the command's first step as 写标记文件, so the identity barrier is not in the spec for those rows.

**Fix.** 1. tests/helpers/RL-child-node.mjs: import probeResourceCaps. After ProcessSandbox.probe, run `const cap = await probeResourceCaps()` and write `JSON.stringify({probed: cap})+'\n'` to stdout; exit 3 if cap.status !== 'available'. Then wait for one stdin line before sandbox.execute.
2. tests/helpers/RL-fake-systemd-run.sh: log `printf 'pid=%s %s\n' "$$" "$*"`. Existing `.includes` users are unaffected. The pid stays the same through the exec chain (P3).
3. RL-06-11-stop.test.ts:
   - spawnChild uses stdio ['pipe','pipe','pipe'] and pushes the child to a `children` list.
   - Add helpers: childReady (read the first stdout line, ≤20 s, `toEqual({probed:{status:'available'}})`), childGo (write 'go\n'), killAndReap (kill, then await 'exit').
   - afterEach SIGKILLs and awaits every child still alive (this works on stopped children). RL-09 writes the external file in `finally`, so a stuck fake can finish before the workspace is removed.
   - Remove the parent-side 'hot' warm-ups in RL-09 and RL-09b; they warm the wrong process.
   - RL-08: command `cat /proc/self/cgroup > /workspace/.rl-identity; touch /workspace/.rl-marked; exec -a rl-08-marker sleep 600` (no barrier). Steps: ready → go → wait for .rl-marked → unit matches /^agent-next-cmd-.+\.scope$/ → pgrepMarked('rl-08-marker') has length 1 (helper from finding 9) → SIGKILL and await exit → within 5 s pgrepMarked is [] and waitForUnitNotFound(unit,5000) is true.
   - RL-08b: command `cat /proc/self/cgroup > /workspace/.rl-identity; printf 'one\n' >> /workspace/.rl-lines; sleep 0.5; exit 0`. Steps: ready → go → wait for the line → SIGSTOP. Keep the existing checks plus the unit-pattern check. Then SIGKILL and await exit.
   - RL-09: command `touch /workspace/.rl-09`. Steps: ready (the canary went through forward) → setMode('wait-external') → go → within 10 s find the log line containing '.rl-09' and take its pid= and --unit= (unit must match the pattern) → SIGKILL and await exit → write the external file → within 10 s `/proc/<pid>` is gone (the launcher/gate exited) → waitForUnitNotFound(unit,10000) is true → `.rl-09` is absent.
   - RL-09b: command `touch /workspace/.rl-09b`. Steps: ready → setMode('write-started') → go → wait for started → SIGSTOP → take the unit from the '.rl-09b' log line → within 5 s systemctlUserShow(unit) matches /ActiveState=active/ → `.rl-09b` is absent → SIGKILL and await exit → waitForUnitNotFound(unit,5000) is true → `.rl-09b` is absent.

**Tests.** All RE1, run by the lead.
- RL-08: child ready line `{probed:{status:'available'}}`; exactly one argv0-marked pid before the kill; none, and unit not-found, within 5 s after.
- RL-08b: lines ['one']; ActiveState=active and an agent-keeper pid while stopped; not-found within 5 s after SIGKILL; lines still ['one'].
- RL-09: the command's own launch line appears in the fake log while the child is alive; the fake pid disappears and the unit is not-found within 10 s of the external release; `.rl-09` is absent.
- RL-09b: ActiveState=active before the kill; not-found within 5 s; `.rl-09b` is absent before and after.
To check the fixtures, the lead can confirm by reading that RL-09/09b without the child warm-up would time out finding their '.rl-09' log line instead of passing.

**Notes from the check.** None. These rows depend on Codex #1 (probe treats systemd/private as a directory; it is a socket on this machine) and #2 (10 s probe deadline). Until those are fixed, childReady fails with no_user_session, which is fail-safe. Logging the pid in the fake is a fixture change under A1 and does not touch the spec.

### Item 9 — Codex must-fix 9

**Found (confirmed).** (a) RL-06 and RL-07 (RL-06-11-stop.test.ts:71-103) assert only cancelled/timedOut and pgrep [] after 500 ms. Nothing checks resourceCaps or the unit. If the probe says unavailable (today on this machine, per Codex #1), both run uncapped and pass. RL-06 lines 90-91 run an unrelated command.
(b) Machine facts: WSL bash 5.2.21; `bash --noprofile --norc -lc "echo m; sleep 0.4"` exec's the last command, so the process args read `sleep 0.4`. The sleeping process therefore loses the marker. The marker stays only in the argv of the launcher, keeper and bwrap: the keeper argv carries bwrapArgs (process-sandbox.ts:1426), and the gate passes the command as $1 (1951). `pgrep -f marker` matches those processes, not the command.
(c) The same flaw affects RL-10(d):276 and RL-11:374. pids[0] is the lowest pid: the systemd-run → keeper sh → bwrap pid, by P3. Those rows kill the outer bwrap, not the command, so they test a different scenario. RL-03:50-56 uses the same marker check.
(d) pgrepMarked (helpers:227-233) swallows every error and returns [], so a pgrep failure becomes 'none left'. pgrep exits 1 for no match and 2/3 for errors. Same class of bug: readIfExists (158-164) turns any read error into null, i.e. 'absent'.
(e) RL-13 (RL-12-15:86-110): L5 step 4 stats /run/user/<uid>/systemd/private before the canary (process-sandbox.ts:2142-2151). On this machine that path is a socket, so with Codex #1 unfixed, and on any machine without a session, the fail-bus case returns no_user_session from step 4 and never reaches the fake's bus message. The test still passes.
(f) /usr/bin/bwrap is missing in the default WSL distro (`wsl.exe -e`); systemd 255.4, pgrep and python3 are present.

**Ruling.** RL-06: 结果 cancelled；Host 只给 bwrap 发了信号，看门进程活到最后一次读之后；2 秒内带标记的进程一个不剩，单元 not-found. RL-07: 其余同 RL-06. RL-11: 对这个命令进程 kill -9. RL-13 with L5 step 4/step 6 (bus message → no_user_session at step 6). The global rule: a failed read never becomes absent. The spec gives no literal for 看门进程活到最后一次读之后. Recommended ruling: use `observationComplete: true`. L7 allows a complete final read only when quiescence leaves the identified keeper, which is the only evidence on the public surface. RL-02c's reasoning (namespace teardown within 1 s) predicts true. Spec conflict: §5.4 says RL-13's no_user_session case 不要用户会话. Given the L5 step order that is wrong, because step 6 is only reached when step 4 passes. The lead should add a post-note: the case needs a real user session.

**Fix.** Helpers (RL-resource-caps-support.ts):
- markedSleep(marker) → `exec -a ${marker} sleep 600`, keeping touch as a separate step.
- pgrepMarked(marker) → `pgrep -f '^<marker>( |$)'`, returning number[]. Return [] only when `(error as {status?:number}).status === 1`; rethrow anything else.
- readIfExists returns null only for ENOENT and rethrows other errors.
- systemctlUserShow throws on failure.

RL-06:
- Command: `cat /proc/self/cgroup > /workspace/.rl-identity; touch /workspace/.rl-marked; exec -a rl-06-marker sleep 600`.
- Wait for .rl-marked; unit matches /^agent-next-cmd-.+\.scope$/; pgrepMarked has length 1.
- Abort. Expect cancelled true, timedOut false, resourceCaps toMatchObject {status:'applied', memoryMaxBytes:268435456, tasksMax:64, observationComplete:true}.
- Poll for up to 2 s: pgrepMarked is [] and waitForUnitNotFound(unit,2000) is true.
- Delete lines 90-91.

RL-07: the same with timeoutMs 2000. Start the run without awaiting; after .rl-marked appears, require one marked pid. Expect timedOut true, cancelled false, the same report, and the same 2 s checks.

RL-10(d) and RL-11 (capped and uncapped): use `exec -a <marker> sleep 600` and the anchored pgrep. Require exactly one pid, then kill that pid.

RL-13: in every case expect `(await fake.invocations()).filter(l => l.includes('cap_literal'))` to have length 1, which shows step 6 reached the fake. In the fail-bus case also expect capability.detail toContain 'Failed to connect to bus'.

**Tests.** All RE1.
- RL-06: report literal {status:'applied', memoryMaxBytes:268435456, tasksMax:64, observationComplete:true}; one marked pid before abort; [] and unit not-found within 2 s.
- RL-07: timedOut:true, cancelled:false, the same literals.
- RL-11: capped report toMatchObject {applied, none_observed, none_observed, observationComplete:true}; (exitCode, signal) equal to the uncapped run, now with the killed pid being the command.
- RL-10(d): lines ['x'] and launches before+1, with the command pid killed.
- RL-13: one canary per case. fail-bus: reason no_user_session and detail containing 'Failed to connect to bus'. This passes only after Codex #1 is fixed; today it must fail. That is the expected red.

**Notes from the check.** None for the user. Lead items: (1) rule that `observationComplete:true` is RL-06/07's evidence for 看门进程活到最后一次读之后; (2) add the §5.4 post-note that RL-13's fail-bus case needs a user session; (3) decide whether to apply the same marker fix to RL-03 (same flaw, outside this finding; RL-03 also lacks its 单元 not-found check). The RE1 run needs bwrap: it is missing in the default WSL distro, so install it or set CODING_AGENT_BWRAP_PATH.

## 7. Groups and order

- **GK — the Kernel patch** (`vendor/coding-agent/patches/**`, then `--write`/`--check`): MF1, MF2, MF3, MF4, MF5a,
  MF5b, MF5c, SF1, SF3, 5(c)-2, 5(c)-3. RE0 tests (RL-20, RL-22) and new RE0 cases run here; RE1 cases are written.
- **GW — WorkGraph, Host and the existing-test edit** (`src/**`, `tests/app/`, `tests/work-graph/`): MF-6, MF-10 / 5(a),
  5(b), 5(c)-5, 5(c)-6, 5(c)-7, 5(c)-8, SF-2. GW touches no file of GK, so **GK and GW may run at the same time** (the
  two subagents you are allowed).
- **GT — the RE1 tests and fixtures** (`tests/kernel/RL-*`, `tests/helpers/RL-*`), after GK: items 7, 8, 9 and the RE1
  cases the GK items name (RL-15b; RL-13's log assertion; RL-03 per R7). Written test-first as far as the sandbox
  allows (A3); say for each RE1 case what it will assert on the real machine.

After GK and GW, a read-only reviewer per group may run alongside the next work (it gets sections 1–5, the group block,
its items and the group's FILES; it reads `git diff HEAD -- <files>` against the spec; it does not edit). Fix its
findings in a short last pass. Finish whole items rather than half of many.

## 8. Checks (at the end, by you)

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`
(after `--write`), the RE0/RE2/RE3 RL test files, `tests/app/A2-settings-automation.test.ts`, the full suite once
(`npx vitest run --maxWorkers=4`) compared with `DSH-BASELINE.md` §A — list every failure outside it (RE1 failures here
are expected only for the environment; list them with their first error line). `git status --short`: only the files of
the round-1 scope plus section 4.

## 9. Reply

FILES CHANGED (`git diff HEAD --stat`); per item of section 6 (by its id): fixed / partly / not done, the test name(s),
the implementation file:symbol, RED→GREEN in one line (RE1: "written, runs on the lead's machine", with what it
asserts); the reviewers' findings and what was done; CHECKS with numbers; UNSPECIFIED (short, each with the spec line).

## 10. Size and time

Finish within 180 minutes.
