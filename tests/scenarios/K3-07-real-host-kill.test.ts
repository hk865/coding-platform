/**
 * K3-07 (R1, spec §5.2 line 1414; §5.4): a real platform Host in a child
 * process is SIGKILLed while a real `shell` command is in flight, and a new
 * Host in the test process takes the files over through RUN-25.
 *
 * Why a child process: `memory_store` cannot prove the L2 premise ("the old
 * process is gone, so its tools stopped too"). Only a real kill leaves a real
 * stale lease file whose pid is dead, and only bwrap's `--die-with-parent`
 * stops the sandboxed command with it. The lease proof is `hl03_stale_lock`
 * carrying the killed child's pid.
 *
 * Loader: Node v24 with no `vite-node`/`tsx`/`ts-node`, so the child runs the
 * `npm run build` output (`dist/`) through
 * tests/helpers/K3-07-host-child.mjs. The test fails with "run npm run
 * build first" when that output is missing.
 *
 * RE1 environment: the DSH sandbox has neither bubblewrap nor a systemd user
 * session, so this test is typechecked here and run by the lead in WSL with
 * bwrap (spec §5.4). It does not skip: the gate below throws the named error.
 *
 * Everything business-facing goes through the public HTTP routes; the SQLite
 * ledger/Kernel are real files, and no test reads or writes records directly.
 * The one private write is the Host's own settings file (`writeAutomationSettings`),
 * the same fixture the restart scenarios use, to turn the start-up re-drive off
 * so the second Host's only job is the takeover.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostReconcileReportV1 } from '../../src/app/core-http-types.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  AG2B_SCOPE, cleanupAG2b, corePost, plain, readPageToken, seedAG2bWorkGraph, startAG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  advanceUntil, cleanupRestart, post, publicDirectory, selectWork, writeAutomationSettings,
} from '../helpers/A2-restart-fixture.js';
import {
  killK307Host, k307HostConfig, k307RemoteHost, readK307Marker, spawnK307Host, type K307Child,
} from '../helpers/K3-07-support.js';
import {
  delay, makeRLWorkspace, pgrepMarked, procExists, removeRLWorkspace, requireRLCapabilities, unitNameOf,
  waitForUnitNotFound,
} from '../helpers/RL-resource-caps-support.js';
import { initGitWorkspace } from './support/git-workspace.js';
import { redrivePolicy } from './support/common.js';

afterEach(async () => {
  await cleanupAG2b();
  await cleanupRestart();
});

/**
 * §5.4: the row needs a real bwrap sandbox. This is not a skip; the error text
 * says exactly why the row cannot run here, and the lead sees it in WSL too if
 * bwrap or the systemd user session is missing.
 */
async function requireK307Environment(): Promise<void> {
  const workspace = await makeRLWorkspace();
  try {
    await requireRLCapabilities(workspace);
  } catch (error) {
    // Drop the helper's own copy of the same prefix so the message names the row
    // and the machine condition exactly once.
    const reason = (error instanceof Error ? error.message : String(error))
      .replace(/^RL RE1 environment unavailable \(no bubblewrap \/ systemd user session\): /, '');
    throw new Error(`K3-07 RE1 environment unavailable (no bubblewrap / systemd user session): ${reason}`);
  } finally {
    await removeRLWorkspace(workspace);
  }
}

/** The child imports compiled JS only; without the build its first import fails opaquely. */
function requireK307Build(): void {
  const missing = ['dist/app/main.js', 'dist/app/host.js'].filter(path => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(`K3-07 child needs the build output; run npm run build first (missing ${missing.join(', ')})`);
  }
}

/** Poll `/proc/<pid>` (RL-08's evidence): the command must be reaped, not just signalled. */
async function waitForProcessGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (!procExists(pid)) return true;
    await delay(20);
  }
  return !procExists(pid);
}

/** The unique argv[0] of the real command, as the host sees it (RL-08's markedSleep). */
const COMMAND_MARKER = 'k3-07-command';

async function waitForMarkedCount(marker: string, count: number, timeoutMs: number): Promise<number[]> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const pids = pgrepMarked(marker);
    if (pids.length === count || performance.now() >= deadline) return pids;
    await delay(20);
  }
}

async function waitForMarkedGone(marker: string, timeoutMs: number): Promise<boolean> {
  return (await waitForMarkedCount(marker, 0, timeoutMs)).length === 0;
}

/**
 * The long command: it starts a `sleep 120` whose argv[0] is the unique marker
 * (RL-08's `markedSleep`) and writes that process's pid plus the scope's
 * `/proc/self/cgroup` into the workspace, then waits for it. The `mv` publishes
 * the marker atomically: the parent must never read the pid without the cgroup
 * (that would skip the unit assertion for the wrong reason).
 *
 * bwrap runs with `--unshare-pid`, so the pid written from inside may be
 * namespace-local. The host-side identity the kill must erase is therefore the
 * unique argv[0] (`pgrepMarked`, exactly RL-08's evidence); the written pid is
 * kept as the command's own record and is asserted too when it is host-visible.
 */
const SHELL_COMMAND = `( exec -a k3-07-command sleep 120 ) & command_pid=$!; `
  + `{ printf '%s\\n' "$command_pid"; cat /proc/self/cgroup; } > .k3-07-marker.tmp `
  + `&& mv .k3-07-marker.tmp .k3-07-marker; wait "$command_pid"`;

describe('K3-07 real Host SIGKILL during a real shell command', () => {
  it('K3-07 (L2 premise): the sandboxed command dies with the Host, and the new Host auto-closes the Run with hl03_stale_lock carrying the killed pid', async () => {
    await requireK307Environment();
    requireK307Build();

    const root = await mkdtemp(join(tmpdir(), 'k3-07-ws-'));
    const database = await mkdtemp(join(tmpdir(), 'k3-07-db-'));
    const configDir = await mkdtemp(join(tmpdir(), 'k3-07-config-'));
    const publicDir = await publicDirectory();
    let child: K307Child | undefined;
    let second: Awaited<ReturnType<typeof startAG2bHost>> | undefined;
    try {
      // RUN-25 needs a git workspace with a start baseline; this is the same
      // initial commit the scenario harness uses (src/module.ts + tsconfig.json).
      await initGitWorkspace(root);
      const configPath = join(configDir, 'workbench.json');
      await writeFile(configPath, JSON.stringify(k307HostConfig({ database, root })));

      child = await spawnK307Host({ configPath, publicDir, command: SHELL_COMMAND, cwd: root });
      const token = await readPageToken(child.ready.url);
      const remote = k307RemoteHost(child.ready.url, token);

      // Seed Goal/Plan/Work through the public routes, then advance untouched
      // steps until the next request is the Run `start` (the command's home).
      await seedAG2bWorkGraph(remote);
      const start = await advanceUntil(remote, selectWork('k3-07'), 'start');

      // The `start` request stays open for the whole 120 s command; the fetch
      // promise is consumed below, after the kill turns it into a socket error.
      const running = corePost(child.ready.url, 'workflow/advance', token, plain(AG2B_SCOPE, start));
      running.catch(() => undefined);

      const marker = await readK307Marker(join(root, '.k3-07-marker'), 60_000);
      expect(marker, 'the real shell command wrote its pid and cgroup marker').not.toBeNull();
      if (marker === null) return;
      // Host-side proof that the command is running: its unique argv[0] (RL-08).
      // The count is polled once because the marker's `mv` can beat the child's
      // `exec` by a few microseconds.
      const markedPids = await waitForMarkedCount(COMMAND_MARKER, 1, 5_000);
      expect(markedPids, 'exactly one real command runs under the sandbox').toHaveLength(1);
      const markerPidIsHostVisible = markedPids.includes(marker.pid);
      if (!markerPidIsHostVisible) {
        console.warn(`K3-07: marker pid ${String(marker.pid)} is namespace-local (bwrap --unshare-pid); `
          + `asserting the host-visible argv[0] ${JSON.stringify(COMMAND_MARKER)} instead, as RL-08 does`);
      }

      const killedPid = child.child.pid;
      expect(typeof killedPid, 'the child Host has a process id').toBe('number');
      if (typeof killedPid !== 'number') return;
      await killK307Host(child.child);
      await running.catch(() => undefined);

      // (1) The sandboxed command must not outlive the Host by more than 5 s.
      // `pgrepMarked` is anchored on argv[0], so bwrap/keeper argv text that
      // merely contains the marker is not a match (RL-09's item 9).
      expect(await waitForMarkedGone(COMMAND_MARKER, 5_000),
        `the bwrap-sandboxed command ${COMMAND_MARKER} is gone within 5 s of the Host SIGKILL`).toBe(true);
      if (markerPidIsHostVisible) {
        expect(await waitForProcessGone(marker.pid, 5_000),
          `pid ${String(marker.pid)} from the marker is gone within 5 s`).toBe(true);
      }

      // The unit assertion only applies when a transient systemd scope was really
      // used. The marker's cgroup is the per-command evidence; the ready-line
      // probe is the machine condition (and can be `unknown` when probing fails).
      const unit = unitNameOf(marker.cgroup);
      if (child.ready.resourceCaps.status !== 'available') {
        console.warn(`K3-07: resource caps not applied (probe status ${child.ready.resourceCaps.status}`
          + `${child.ready.resourceCaps.reason === undefined ? '' : `: ${child.ready.resourceCaps.reason}`}); `
          + 'skipping only the unit not-found assertion');
      } else if (!/^agent-next-cmd-.+\.scope$/.test(unit)) {
        console.warn(`K3-07: no transient scope unit in the command cgroup (${JSON.stringify(unit)}); `
          + 'skipping only the unit not-found assertion');
      } else {
        expect(await waitForUnitNotFound(unit, 5_000), `unit ${unit} is not-found after the Host dies`).toBe(true);
      }

      // (2) A fresh Host in THIS process over the same data directory and lease
      // file. The start-up re-drive is off so the second Host writes only the
      // reconcile's takeover records (the K3-01 crash-scenario convention).
      await writeAutomationSettings(database, redrivePolicy(false));
      second = await startAG2bHost(publicDir, { root, database, replies: [] });
      const report: HostReconcileReportV1 = second.host.reconcile;
      expect(report, 'the second Host took over the dead instance lease').toMatchObject({
        lease: 'owned', leaseRow: 'HL-03',
      });
      const line = report.report?.runs.find(candidate => candidate.row === 'W-26');
      expect(line, 'the killed Run is reported as W-26').toBeDefined();
      expect(line, 'RUN-25 applied to the killed Run').toMatchObject({
        row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved', autoCleanup: { applied: true },
      });
      if (line === undefined) return;
      const runRef = JSON.parse(line.ref) as RunRef;

      // The review record, read exactly as K3-01 reads it, carries the takeover
      // proof with the killed child's pid and the in-flight `shell` item.
      const read = await post<ReadResult<UnknownCallReviewV1>>(second, 'unknown-call-reviews/read',
        plain(AG2B_SCOPE, { runRef }));
      expect(read.status, 'the review record is readable').toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.runRef, 'the review belongs to the killed Run').toEqual(runRef);
      expect(read.value.origin, 'the takeover proof names the killed child process').toMatchObject({
        kind: 'takeover_unresolved',
        proof: { kind: 'hl03_stale_lock', previousPid: killedPid },
      });
      expect(read.value.items, 'the review lists the in-flight shell call as a process item').toEqual(
        expect.arrayContaining([expect.objectContaining({ toolName: 'shell', kind: 'process' })]));
    } finally {
      if (child !== undefined) await killK307Host(child.child).catch(() => undefined);
      if (second !== undefined) await second.host.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
      await rm(database, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  }, 180_000);
});
