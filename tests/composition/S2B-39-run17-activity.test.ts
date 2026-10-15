/**
 * Slice 2B row 2B-39 (entry BE2c, L5/L6; RUN-17) — a real Run that reached a
 * Kernel terminal is handed to the start-up reconcile as it would look BEFORE
 * the execution entered; the reconcile must address it as RUN-17 and hand
 * `recordRunResult` a counted tally windowed from `turn.started` to the
 * terminal (`end_position`), plus the back-filled `enteredAt`.
 *
 * It follows `tests/composition/A2-reconcile-classifier-platform.test.ts`: the
 * production composition root (`createTargetPlatform` over the C2 Runtime
 * platform fixture), a real Kernel and a scripted model run the real Turn. The
 * Run record and the Session's `historyCursor` are then restored IN MEMORY
 * (nothing persisted is touched): `status: 'starting'`, authorization
 * `entering`, no `startedAt`, no history locator, and the Session snapshot taken
 * before the execution entered. The two writers only record what would be
 * submitted, so the assertion is on the `activity` handed to `recordRunResult`
 * (BE2c) — never on a stored/restart value.
 */
import { afterEach, expect, it } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import { decodeKernelEntry, type DecodedKernelRecord } from '../../src/core/agent-runtime/kernel-turn-facts.js';
import { reconcileRunAtStartup, type RunReconcileClassifierDependencies } from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import type { TaskResultObservation } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { ReconcileRunInput } from '../../src/core/work-graph/tasks/run-reconcile-contracts.js';
import { createC2RuntimePlatform, type C2RuntimePlatformFixture } from '../helpers/C2-runtime-platform-fixture.js';

const fixtures: C2RuntimePlatformFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

/** The completed Run as a restart would read it before the execution entered (in memory only). */
function beforeEntering(record: TaskExecutionRecord, historyCursor: SessionRecord['historyCursor']): TaskExecutionRecord {
  const run = record.run;
  const auth = run.executionAuthorization;
  if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2) {
    throw new Error('the completed Run must carry its V2 binding');
  }
  const { executionHistory: _history, ...rest } = run;
  const starting: RunSnapshot = { ...rest, status: 'starting', outcome: null, exitCode: null,
    startedAt: null, endedAt: null, executionAuthorization: { ...auth, phase: 'entering' } };
  return { ...record, run: starting, session: { ...record.session, historyCursor } };
}

/** Read and decode the real Kernel Session from position 1, as the reconcile reads it. */
async function readKernelRecords(fx: C2RuntimePlatformFixture, session: SessionRecord,
  owner: ReturnType<typeof createSessionHistoryCursorOwner>): Promise<DecodedKernelRecord[]> {
  const records: DecodedKernelRecord[] = [];
  let afterPosition = 0;
  let throughPosition: number | null = null;
  for (;;) {
    const window = await owner.readPositionWindow({ session, afterPosition, throughPosition,
      limit: 200, signal: fx.ctx.signal });
    if (window.status !== 'ready') throw new Error(`kernel history window: ${JSON.stringify(window)}`);
    throughPosition = window.value.throughPosition;
    for (const entry of window.value.entries) {
      const decoded = decodeKernelEntry(entry);
      if (decoded === null) throw new Error('the Kernel history did not decode');
      records.push(decoded);
    }
    if (!window.value.hasMore) return records;
    afterPosition = window.value.nextPosition;
  }
}

it('2B-39 (BE2c): RUN-17 hands recordRunResult a counted tally windowed turn.started→terminal with the back-filled enteredAt', async () => {
  const calls = [{ callId: 's2b-39-read', name: 'read', args: { path: 'c2-read.txt' } }];
  const fx = await createC2RuntimePlatform({ toolNames: ['read'], allowSourceRead: true,
    scriptedReplies: [{ kind: 'calls', calls }, { kind: 'text', text: 'S2B 2B-39 done' }] });
  fixtures.push(fx);

  // The Session snapshot from before the execution entered (its history cursor).
  const before = await fx.platform.sessions.readSession(fx.ctx, fx.claim.sessionRef);
  if (before.status !== 'ready') throw new Error(`session before enter: ${JSON.stringify(before)}`);

  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 's2b-39-prepare' });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-39-driver',
    requestId: 's2b-39-start' });
  if (started.status !== 'ready') throw new Error(`start: ${JSON.stringify(started)}`);
  expect(started.value.run, JSON.stringify(started.value.run.terminalPayload)).toMatchObject({ status: 'ended', outcome: 'completed' });

  const completed = await fx.platform.executions.readExecution(fx.ctx, fx.runRef);
  if (completed.status !== 'ready') throw new Error(`execution: ${JSON.stringify(completed)}`);

  // Pin the tally window to the real Turn positions: the `turn.started` record
  // and the last record of that Turn in the real Kernel Session. The RUN-07
  // locator leaves `endPosition` null (F26), so the terminal position lives only
  // in the Kernel history.
  const history = completed.value.run.executionHistory;
  if (history === undefined) throw new Error('the completed Run must carry its Kernel history locator');
  const owner = createSessionHistoryCursorOwner({ kernelStores: fx.platform.kernelStores });
  const kernelRecords = await readKernelRecords(fx, completed.value.session, owner);
  const turnStarted = kernelRecords.find(item => item.record.recordType === 'turn.started'
    && (item.record.payload as { run?: { runId?: string; turn?: { turnId?: string } } }).run?.runId === history.kernel.runId
    && (item.record.payload as { run?: { turn?: { turnId?: string } } }).run?.turn?.turnId === history.kernel.turnId);
  if (turnStarted === undefined) throw new Error('no turn.started for the completed Run in the Kernel history');
  const turnTerminalPosition = kernelRecords.filter(item => item.position >= turnStarted.position).at(-1)!.position;

  const input = beforeEntering(completed.value, before.value.record.historyCursor);

  const booked: TaskResultObservation[] = [];
  const reconciled: ReconcileRunInput[] = [];
  const refused = { status: 'rejected' as const, code: 'unavailable' as const, reason: 'S2B 2B-39: recorded, not written' };
  const deps: RunReconcileClassifierDependencies = {
    owner, messages: fx.platform.messages, controls: fx.platform.controls,
    entry: { recordRunResult: async (_ctx, request) => { booked.push(request.input); return refused; } },
    reconcile: {
      reconcileRun: async (_ctx, request) => { reconciled.push(request.input); return refused; },
      resolveUnknownRun: async () => refused, reconcileRunControls: async () => refused,
    },
    now: () => '2026-10-05T00:00:00.000Z', newId: () => 's2b-39-id',
  };
  const probe = await owner.probe({ session: input.session, signal: fx.ctx.signal });
  expect(probe.verdict).toBe('ready');
  await reconcileRunAtStartup(deps, fx.ctx, { record: input, hostInstanceId: 's2b-39-host', probe });

  // RUN-17: the Kernel terminal is booked as the observer books it; nothing goes through reconcileRun.
  expect(reconciled).toEqual([]);
  expect(booked).toHaveLength(1);
  const submission = booked[0]!;
  expect(submission.basis).toEqual({ kind: 'host_instance_takeover', hostInstanceId: 's2b-39-host' });
  expect(submission.event).toMatchObject({ eventType: 'run_completed' });
  // The back-filled entry instant is carried in the same input.
  expect(typeof submission.enteredAt).toBe('string');
  // The tally is windowed from turn.started to the terminal, terminal through the Turn end.
  expect(submission.activity).toMatchObject({ status: 'counted',
    window: { bound: 'end_position', turnTerminal: true, unresolvedCalls: 0 },
    totals: { steps: 1, edits: 0, editsUnknown: 0 } });
  if (submission.activity?.status === 'counted') {
    // Pinned to the real Turn positions: `[turn.started, Turn terminal]`.
    expect(submission.activity.window.fromPosition).toBe(turnStarted.position);
    expect(submission.activity.window.throughPosition).toBe(turnTerminalPosition);
    expect(submission.activity.window.kernelRunId).toBe(history.kernel.runId);
    expect(submission.activity.window.kernelTurnId).toBe(history.kernel.turnId);
  }
}, 60_000);
