# K3 make-up: K3-07 (a real platform Host killed with SIGKILL) and K3-49 / L31b (stop the Host's own scope on a cancel before release) (lead, 2026-10-18)

Do not end your turn until every subagent you start has reported back. **This run is headless: when your turn ends, the whole run ends.** Finish within 80 minutes (the run stops at 90). Work in coordinator mode (`./.dsh-ref/coordinator-mode.md`); files of running subagents disjoint.

## 1. What this is

Both rows are in the frozen K3 spec but were never put into a group book (the lead's omission). This copy is the K3 merge tree (tag `k3-merge-1`). Read `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`: L31b (line 774), the R1 entry note (lines 1381, 1387), the rows K3-07 (line 1414) and K3-49 (line 1441), §6 (line 1560), §7 (line 1526). Also `slice-RL-SPEC.md` §5.2 (RL-08 line 750, RL-10c) and §7 / §9.

**Your sandbox has no bubblewrap and no systemd user session.** Write both parts by TDD as far as the sandbox allows (fakes for what needs the machine, exactly as the RL RE1 rows do); the lead runs the real rows in WSL with bwrap and systemd. Say in the reply which rows you could only typecheck.

Do not touch `src/core/agent-runtime/context-assembler.ts` or `execution-preparation.ts` (the lead is fixing them in parallel). No other production file than those named here; anything else needed → stop that item and report.

## 2. Item A — L31b: the Host stops its own scope when a command is cancelled before release

**Behaviour (L31b, spec line 774; the rest stays as the resource-limits slice has it).** When a capped command is cancelled **after systemd-run was started for it but before release** (the outcome the sandbox reports as `resourceCaps: { status: 'not_started' }` on that path), the Host runs `systemctl --user stop <unitName>` once for the unit it named itself. Stopping fails (non-zero exit, spawn error, or no answer within 5 s) → one log line, the result is unchanged. A cancel before systemd-run was started (`process-sandbox.ts:1058–1060`, no unit exists) runs nothing. A cancel after release keeps today's path (RL-06).

**Where (reuse, file:line in the managed source `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts`):**
- the capped launch: `:1230–1700`; the unit name is made at `:1253` (`agent-next-cmd-<uuid>.scope`) and passed at `:1588` (`--unit=`);
- the not-started-after-launch returns: `:1575–1579`, `:1686–1687` (outcome `not_started_cancelled` from `:384`), `:1785–1786`. Find which of these happen after systemd-run was spawned; only those stop the unit. Put the stop in ONE helper used by all of them.
- the `systemctl` path follows L1's `systemd-run` rule (`:154–155`): `CODING_AGENT_SYSTEMCTL_PATH`, else `/usr/bin/systemctl`; absolute only, like `:2320`.
- the log line: if the sandbox already has a diagnostic/log seam, use it; otherwise one `process.stderr.write` line `agent-next: scope stop failed: <unit>: <reason>\n`. Say which you used.
- regenerate the dist only with `node scripts/build-kernel-patch.mjs --write`, then `node scripts/build-kernel-patch.mjs --check` must pass. **Never edit `vendor/coding-agent/dist` by hand.**

**Tests.**
- **K3-49 (RE1, lead runs):** in `tests/kernel/RL-06-11-stop.test.ts` RL-10c (`:556–600`), for every iteration whose result is `not_started` after a launcher invocation, the unit named in that invocation (the fake `systemd-run` in `forward` mode logs its arguments: `tests/helpers/RL-fake-systemd-run.sh`) is `not-found` within 5 s. Reuse the unit-state helper RL-08 uses (`tests/helpers/RL-resource-caps-support.ts`). Do not change RL-10c's existing assertions.
- **The failure branch (runs in your sandbox):** a fake `systemctl` through `CODING_AGENT_SYSTEMCTL_PATH` (a script like `RL-fake-systemd-run.sh`, recording its arguments, exiting 1) → the result is byte-identical to the result without the stop, and exactly one log line names the unit. If the cancel-before-release path cannot be reached without systemd in your sandbox, write it against the same fake launcher the RL rows use and say so.

## 3. Item B — K3-07: a real platform Host killed with SIGKILL during a real `shell`

**Row (spec line 1414, R1, RE1-style environment: real bwrap).** The platform Host runs in a child process over a real SQLite data directory and a real lease file. A scripted-model Work calls the real `shell` tool with a long command that first writes a marker (its own pid and the scope's `/proc/self/cgroup`, like `tests/helpers/RL-child-node.mjs`), then sleeps 120 s. The test sees the marker and sends the child `SIGKILL`. Then:
1. within 5 s no process with the marker's pid is left (and, when caps were applied, its unit is `not-found`);
2. a new Host is opened in the test process on the same data directory and lease file; its start-up takes over through RUN-25 and the Run carries `proof: { kind: 'hl03_stale_lock', previousPid: <the killed child's pid> }`; the review record exists with the `shell` item (`process` kind), read through the public routes as `tests/scenarios/K3-R1-restart-flows.test.ts:144–200` reads K3-01.

**Reuse.** The second half is K3-01's (`K3-R1-restart-flows.test.ts`; `tests/scenarios/harness.ts` `restart`, `tests/helpers/A2-restart-fixture.ts`). The only new thing is that the first Host is a real child process killed for real instead of `restart({ crash: true })`. The child process pattern is `tests/helpers/RL-child-node.mjs` (ready line on stdout, wait for one stdin line, then act). The RE1 environment check is `tests/helpers/RL-resource-caps-support.ts:54–62`; use the same convention for "no bubblewrap here".

**The child cannot import TypeScript directly** (no `tsx`; source imports use `.js` specifiers). Pick one, without adding a dependency, and say which: (a) `vite-node` if it is already in `node_modules` (a vitest dependency); (b) the build output of `npm run build` (`tsconfig.build.json`), with the test failing with a clear "run npm run build first" message when the build is missing. Prefer (a).

**Files.** New `tests/scenarios/K3-07-real-host-kill.test.ts` and one child helper `tests/helpers/K3-07-host-child.mjs` (or `.ts` under (a)); small exports from existing helpers are allowed. No production change for this item; if the real kill shows a production gap (as K3-01 once did), stop, write the RED test, and report the gap — do not fix production.

## 4. Rules

Business flows through public steps; no database reads; expected values from the spec. Memory/SQLite: K3-07 is SQLite only (real Host files; spec ruling for real-Host rows); RL rows have no backend. No real model calls. Error codes and texts unchanged. Comments say why, per decision 35. Run what you can: `npx vitest run --maxWorkers=2` on the touched files, `npm run typecheck`, `npm run check:architecture`, `node scripts/build-kernel-patch.mjs --check`.

## 5. Reply

Under 300 words: files changed; which rows ran in your sandbox and which only typecheck; the child loader you chose; the log seam; any UNSPECIFIED with your choice.
