# Slice RL round 2 — final reply

All 22 section-6 items are fixed. GK and GW ran in parallel (2 builders); GT ran after GK in two waves (fixtures/helpers, then the remaining RE1 rows); one read-only reviewer per group ran; the GT reviewer's 1 medium + 5 low findings were fixed in a last pass. No subagent is left running.

## FILES CHANGED

`git diff HEAD --stat` (tracked; 22 files, +1636/−396):

```
 src/app/host-settings.ts                                    |  16 +-
 src/core/work-graph/evidence/evidence-service.ts            |   2 +-
 src/core/work-graph/model/decision-contracts.ts             |   2 +
 src/core/work-graph/persistence/evidence-record-codecs.ts   |  57 +
 src/core/work-graph/views/automatic-rework-notices.ts       |  15 +-
 tests/app/A2-settings-automation.test.ts                    |   7 +-
 tests/app/RL-34-wiring-resource-caps.test.ts                |  13 +-
 tests/app/RL-40-43-resource-cap-settings.test.ts            |  26 +
 tests/helpers/RL-child-node.mjs                             |  24 +-
 tests/helpers/RL-fake-systemd-run.sh                        |  34 +-
 tests/helpers/RL-resource-caps-support.ts                   | 151 ++--
 tests/kernel/RL-03-05-oom-pids.test.ts                      |  39 +-
 tests/kernel/RL-06-11-stop.test.ts                          | 327 ++++++---
 tests/kernel/RL-12-15-conditions.test.ts                    | 155 +++-
 tests/kernel/RL-22-settlement.test.ts                       |  74 +-
 tests/runtime/RL-32-check-resource-caps.test.ts             |  34 +
 tests/work-graph/RL-32b-rework-notice-memory-cap.test.ts    | 194 +++++-
 vendor/coding-agent/dist/sandbox/process/process-sandbox.*  | 425 (via --write only)
 vendor/coding-agent/patches/sandbox/process/process-sandbox.ts | 437 +++++++---
```

New (untracked, all in scope): `tests/helpers/RL-fake-bwrap.sh` (44), `tests/helpers/RL-bwrap-child.mjs` (91), `tests/kernel/RL-15c-gate-stream-error.test.ts` (173). `git status --short` shows only round-1-scope files plus section 4. `public-api.ts`/`build-kernel-patch.mjs` unchanged; no hand edit of `dist` (only the 4 `process-sandbox.*` artifacts regenerate; script hashes them).

## Per item (section 6)

**GK group**
- **MF1 — fixed.** `process-sandbox.ts:runResourceCapProbe` step 4 (systemd/private existence only; `/run/user/<uid>` keeps isDirectory+uid) and `#runCapped`/`CappedRunContext.probeCanary` skip of the canary's own cache invalidation. RE1 written: RL-15/RL-13 (lead's machine). RED→GREEN: code-only here; `--check` green.
- **MF2 — fixed.** `commandOutput(signal?)` (detached, stderr ignore, 4 KiB stdout, SIGKILL(-pid) then reap on abort), private `ProcessSandbox.#probeInternal` (public `probe` signature untouched), `probeResourceCapsCanary` signal+`min(5s,remaining)`, `runResourceCapProbe` one 10 s AbortController (unref, cleared) overriding any inner result with `probe_failed`/`探测超过 10 秒`; 2 s scope loop bounded by the deadline; no `Promise.race`. RE1: **RL-15b (a)/(b)**. code-only here.

**GW group**
- **MF-6 — fixed.** `evidence-record-codecs.ts:resourceCapsReportProblem` (closed union, exact keys, ≥16 MiB whole-MiB, tasksMax 8..4194304, 9-reason `none`, `not_started`), called from `checkObservationProblem` executed-branch before storage; legacy field-absent valid. RE2: `RL-32 (c1)/(c2)/(c3)`. RED (c1 TypeError; c2/c3 committed) → GREEN 6/6.
- **MF-10/5(a) — fixed.** Exactly the two A2 whole-snapshot assertions (R8) with `resourceCaps: expect.any(Object)` + comment. RE3: A2 23/23.
- **5(b) — fixed.** `decision-contracts.ts:NoticeItemV1.actions?: readonly {kind:'raise_memory_cap'}[]`; `automatic-rework-notices.ts` local types deleted, `withResourceCapHit` typed. RE2 `RL-32b (b)/(c)` read typed. RED typecheck (`TS2353`/`TS2339`) → GREEN.
- **5(c)-5 — fixed (test-only).** New `RL-32b (e)(f)(g)(h)`. (e) real requeue via public `claims.requeueTask` (afterRoundRef) with CAP_HIT; (f) NO_HIT; (g) two checks, first-by-checkId ordering (512 MiB) with execution order reversed; (h) R10 read-fault wrapper at the storage boundary → `queryDecisionQueue` unavailable. No production change (round-1 branch was already correct).
- **5(c)-6 — fixed.** `withResourceCapHit` uses `' · '`. RE2 `RL-32b (a)/(e)`. RED (plain concatenation) → GREEN.
- **5(c)-7 — fixed (test-only).** RL-34 renamed "caps enter no prepared manifest before or after a live save"; tautological revision equality + forbidden-digit loop removed; manifest checks kept.
- **5(c)-8 — fixed.** `evidence-service.ts:resourceCapHitOf` exact `memoryMaxBytes / MIB`. Covered by MF-6 (c2) and RL-32b (d).
- **SF-2 — fixed.** `host-settings.ts:parseStoredResourceCaps` range checks (memory [256, floor(MAX_SAFE/MIB)] with no RAM ceiling; tasks [64,65536]). RE3 `RL-42 (stored)` it.each (0/255/null-0/63/65537) + above-RAM 4194304→4398046511104. RED (bad files loaded) → GREEN 26/26.
- **GT group**
- **Item 7 — fixed.** `tests/helpers/RL-resource-caps-support.ts:makeRLSandbox` spreads `workspaceMode` into both `probe` and the constructor. RL-14 KB-01/03/04/05 now run read_only (written, lead's machine).
- **Item 8 — fixed.** `RL-child-node.mjs` warms the probe and waits one stdin `go`; fake logs `pid=<pid> <argv>`; RL-08/08b/09/09b step sequences, afterEach reap, RL-09 `finally`. RE1 written.
- **Item 9 — fixed.** `markedSleep`/anchored `pgrepMarked` ([] only on exit 1)/`readIfExists` ENOENT-only/`systemctlUserShow` throws; RL-06/07/10(d)/11/13 literals. RE1 written.
- **R7 — fixed.** RL-03 uses the retained marker, `pgrepMarked` [] and `waitForUnitNotFound(unit,2000)`.
- **RL-15b (a)/(b) — written** (GT-B); **(b)** uses a test-written hanging bwrap wrapper via `CODING_AGENT_BWRAP_PATH` (helpers off-limits).
- **MF3 RL-15c, MF4 RL-15d, SF1 RL-10b(2)/(3)/RL-10c, SF3 RL-15 profile-path — written** (GT-A/GT-B), all literal as the items specify. RE1 runs on the lead's machine.
- **5(c)-2 — fixed.** `settleExecution` breaks on `host_oom_kill` while starting. RE0 `RL-22 (v) host_oom_kill while starting is ignored`. RED (`deadline_before_start` + kill_group/close_keeper) → GREEN.
- **5(c)-3 — fixed (test-only).** `RL-22 (m)` collapsed to one case; m1/m2/m3 removed.

Every RE1 RED here is environment-only (no `/usr/bin/bwrap`, no cgroup v2, no user session); no test is skip-guarded.

## Reviewers' findings and what was done

- **GK review:** no blocker/high; all 11 items OK (dist regenerated, 60/60, public `probe` unchanged). Low: stale RL-22 header "(a)–(t)" → GK fixed to "(a)–(v)"; after-`limitsEffective` guard and the two optional `probeResourceCapsCanary` params accepted as no-action. Its medium cross-group note (RL-15b absent) was GT-B's and is now delivered.
- **GW review:** all 8 items OK, no blocker/high/medium; 5(c)-5 (g)/(h) shown non-tautological; SF-2 message note judged acceptable under R14 (public wrapper `'…could not be loaded'`, A2 precedent is a bare `toThrow`).
- **GT review:** 1 medium + 5 low, all fixed by the last-pass fixer: RL-03 race (removed the synchronous `pgrepMarked` busy-loop and the pre-result "must have existed" assertion; unit read moved after `await running`); `waitForUnitNotFound` tightened to `LoadState=not-found` or the exact `Unit <unit> could not be found.`; RL-15 now fails on an unparseable `--version`; RL-13b asserts `resourceCapStatus()`; RL-09/09b get `{timeout: 60_000}`; `RL-fake-bwrap.sh` comment corrected.

## CHECKS

- `npm run typecheck` → exit 0. `npm run check:architecture` → exit 0 (`next source boundaries: OK`). `npm run build` → exit 0. `node scripts/build-kernel-patch.mjs --check` → exit 0, **60/60 artifacts allMatch:true**.
- RE0/RE2/RE3 RL files + `tests/app/A2-settings-automation.test.ts` → **13 files, 155 tests passed**.
- Full suite `npx vitest run --maxWorkers=4` → **53 files failed; 191 failed / 6483 passed / 29 skipped (6703)**. Against `DSH-BASELINE.md §A` (154 tests + 1 suite): **failures outside baseline = 38, all RE1 environment-only, zero non-RE1.** Breakdown by first error line:
  - [23] `Error: RL RE1 environment unavailable (no bubblewrap / systemd user session): ENOENT … access '/usr/bin/bwrap'` — RL-01/02c, RL-06/07/07b/08/08b/09/09b/10(a–d)/10b/10b(2)/10b(3)/10c/11, RL-12, RL-14 KB-01/03/04/05.
  - [7] `ProcessSandboxError: 隔离进程能力不可用` — RL-02/02b, RL-03b/03c/04/05, RL-13b.
  - [2] `Error: RL RE1 environment unavailable …: process exited 127` — RL-15c, RL-15d.
  - [1] `AssertionError: fail-bus: expected 'no_cgroup_v2' to be 'no_user_session'` — RL-13.
  - [1] `AssertionError: expected { status:'unavailable' } to deeply equal { status:'available' }` — RL-15 (cached probe).
  - [1] `AssertionError: expected { unavailable, …(2) } to deeply equal { unavailable, …(2) }` — RL-15b (a) (got `no_cgroup_v2` instead of `探测超过 10 秒`).
  - [1] `AssertionError: expected 'no_cgroup_v2' to be 'probe_failed'` — RL-15b (b).
  - [1] `AssertionError: process exited 127: expected false to be true` — RL-15 (SF3 profile path).
  - [1] `AssertionError: expected false to be true` — RL-03 identity wait (execute rejects `sandbox_unavailable`).
  Baseline `/usr/bin/bwrap` failures stayed failing; the baseline `tests/state/invariants.test.ts` suite still fails as listed (`Error: requeue 1: {status:'rejected',code:'busy'…}` at invariants.test.ts:297). One baseline entry now passes: `tests/composition/S2B-be1s-shell.test.ts > 2B-09 a cancelled command that changed nothing…` (also passed in round 1).
- `git status --short`: only the 22 tracked in-scope files + 3 new in-scope files. `.dsh-scratch/` deleted; `AGENTS.md` untouched.

## UNSPECIFIED (short, with the spec line)

1. **RL-22 label collision.** Item MF4's Tests and item 5(c)-2 both name `RL-22 (u)`. The item text is frozen and self-contradictory; GK used MF4=`(u)/(u')` and 5(c)-2=`(v)`. Label-only (`settleExecution` is reason-based). Needs an L4/RL-22 post-note.
2. **SF-2 public message.** Item SF-2's Tests says `createHostSettings` rejects with `'the private host settings file is invalid'`; `createHostSettings` wraps a corrupt file as `'…could not be loaded'` (host-settings.ts:459), the same as the A2 automation precedent (bare `toThrow`). The test asserts the observable wrapped message; the range-check throw inside `parseStoredResourceCaps` is the item's literal. R14 intent met.
3. **Optional tests kept.** SF3's item says "RE1, optional" and AGENTS rule 3 says no non-blocking tests; GT-B added the self-contained RL-15 profile-path case (non-tautological, discriminates the fix). MF4's optional RE1 smoke (RL-15d) is also present. The lead may drop either.
4. **MF2 test (b) fixture.** The item approved a `hang-version` mode in `RL-fake-bwrap.sh`; that fixture is GT-A-owned with no hang mode, so GT-B used a test-written inline wrapper. Same for SF3's passthrough wrapper (test-created, no `tests/helpers` edit).
5. **RL-15c launch count.** The item says "exactly one scope launch"; the child's warm probe canary also logs, so the test asserts `launchesAfter − launchesBefore === 1` (the execute), not `total === 1`.
6. **New helper ownership.** `tests/helpers/RL-bwrap-child.mjs` is a new GT-A helper not named in the GT split.
7. **MF5a/MF5b/MF5c have no test** (the items say so; §5 head forbids hooks; reviewed by reading). **5(c)-5 (e)–(h)** covered already-correct round-1 production, so their RED is only the absent test. **RL-22 (m)** is one seam case; the three `waitQuiescence` shapes are review-only (R15).
8. **Duplicate `RL-15` name** (cached-probe row and SF3's profile-path case) — both are "RL-15" per the item text; both in `RL-12-15-conditions.test.ts`.
9. **MF2 marker sibling** key/name/default were unspecified: `RL_FAKE_SYSTEMD_HANG_MARKER` / `.hang-marker` / `rl-hang-version`; deadline detail literal `探测超过 10 秒`.

**Lead post-notes now due:** L5 (10 s = all probe work, bounded cleanup after; step-5 overrun = `probe_failed`), L4 table (`收到 r 之前` → `放行之前`), L10 (every not-started cancel = `not_started`), §5.3 A2 row corrected, §5.4 (RL-13 fail-bus needs a user session), RL §6/slice-5 §4.1 (`NoticeItemV1.actions`), L16 separator ` · `, RL-22 (m) seam + `(u)/(v)` label, R14 stored-range start-up failure.