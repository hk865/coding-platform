/**
 * Group T1 support (D13): build the platform state through public flows and open
 * a REAL composition root that holds the Host instance lease.
 *
 * `ownedRuntimeRoot` mirrors `tests/scenarios/support/common.ts:openWorkRoot`
 * (the Host's Runtime grant over the scenario files) but passes
 * `hostInstance: { lease: 'owned' }`, so `RuntimeExecutionPort.closeOpenTurn`
 * is admitted instead of answering `refused('lease')`. The Kernel dependency is
 * the real module; a test may gate it with `vi.hoisted` + `vi.mock` (spec §9 M2).
 *
 * `buildRun24KernelOpen` produces a genuine RUN-24: a person pauses a live Work
 * Run at its safe point, the Host is closed and a stale lock written (the
 * `pausedRunOnClosedHostChecked` crash), the next Host reconciles it to
 * `crashed` + `interrupted_clean` with a pause intent, and — because the
 * maintenance never closes a paused line — the Session is left
 * `active` / `unavailable` / `kernel_turn_open` with the real open Kernel Turn.
 * The person's own `tasks/requeue` (TASK-27) then authorizes the closure. No
 * Session, Run, requeue or Kernel record is fabricated.
 */
import { join } from 'node:path';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { TaskRequeueRef, TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { AG2B_AT, AG2B_SCOPE, permissionRevision, startAG2bHost, type AG2bHost } from './AG2b-collaboration-fixture.js';
import { createScriptedModel } from './B2-runtime-fixture.js';
import { publicDirectory, readExecution, tempDir, writeAutomationSettings } from './A2-restart-fixture.js';
import { ag2bWorkRuntime, ag2bWorkspaceBindings, SCENARIO_OPERATOR, type InvariantTarget, type Platform } from '../scenarios/harness.js';
import { operatorRequeue, pausedRunOnClosedHostChecked } from '../scenarios/support/common.js';

/** A real Runtime root over a scenario's files that holds the instance lease.
 * `options.kernelRegistered: false` leaves the Session's Kernel adapter
 * unregistered, so a probe answers `host_config` (the D6 retryable mapping). */
export async function ownedRuntimeRoot(root: string, database: string,
  options: { kernelRegistered?: boolean } = {}): Promise<Platform> {
  return await createTargetPlatform({
    storage: { kind: 'sqlite', directory: database },
    workspace: ag2bWorkspaceBindings(root, { value: 1 }, permissionRevision(SCENARIO_OPERATOR, AG2B_SCOPE, ['.'])),
    now: () => AG2B_AT,
    kernelStores: options.kernelRegistered === false ? { entries: [] }
      : { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
        databasePath: join(database, 'kernel.sqlite') }] },
    runtime: ag2bWorkRuntime(() => createScriptedModel([])),
    hostInstance: { hostInstanceId: 'k-t1-owned-host', lease: 'owned' },
  });
}

export type Run24KernelOpen = {
  runRef: RunRef;
  sessionRef: SessionRef;
  requeueRef: TaskRequeueRef;
  release(): Promise<void>;
};

/**
 * The public-flow RUN-24 + `active` / `unavailable` / `kernel_turn_open` state
 * and the person's `继续` TaskRequeue that authorizes the closure.
 */
export async function buildRun24KernelOpen(input: {
  root: string; database: string; publicDir: string; prefix: string;
}): Promise<Run24KernelOpen> {
  const inv: InvariantTarget = { database: input.database };
  const paused = await pausedRunOnClosedHostChecked(input.root, input.database, input.publicDir, inv, 'run');
  await writeAutomationSettings(input.database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false });
  let second: AG2bHost | undefined;
  try {
    second = await startAG2bHost(input.publicDir, { root: input.root, database: input.database,
      replies: [{ kind: 'text', text: `${input.prefix}: never delivered` }] });
    const reconciled = await readExecution(second, paused.runRef);
    if (reconciled.session.lifecycle !== 'active' || reconciled.session.health !== 'unavailable'
      || (reconciled.session.healthConclusion ?? null) !== 'kernel_turn_open') {
      throw new Error(`the reconcile must leave an active RUN-24 kernel_turn_open state: ${JSON.stringify({
        lifecycle: reconciled.session.lifecycle, health: reconciled.session.health }) }`);
    }
    const continued = await operatorRequeue(second, paused.runRef, `${input.prefix}-continue`, '继续') as WriteResult<TaskRequeueOutcomeV1>;
    if (continued.status !== 'committed' || continued.value.kind !== 'requeued') {
      throw new Error(`the person's requeue must commit: ${JSON.stringify(continued)}`);
    }
    const sessionRef = reconciled.session.ref;
    const requeueRef = continued.value.requeue.ref;
    const closing = second;
    second = undefined;
    return { runRef: paused.runRef, sessionRef, requeueRef, async release() {
      await closing.host.close().catch(() => undefined);
    } };
  } finally {
    if (second !== undefined) await second.host.close().catch(() => undefined);
  }
}

/** A fresh public scenario directory triple. */
export async function scenarioFiles(prefix: string): Promise<{ root: string; database: string; publicDir: string }> {
  return { root: await tempDir(`${prefix}-ws-`), database: await tempDir(`${prefix}-db-`), publicDir: await publicDirectory() };
}
