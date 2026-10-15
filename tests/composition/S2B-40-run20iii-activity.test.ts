/**
 * Slice 2B row 2B-40 (entry BE2c, L4/L5) — the RUN-20(iii) reconcile.
 *
 * It follows `tests/composition/A2-reconcile-classifier-platform.test.ts`: a
 * real Kernel + scripted model produces a genuinely yielded Turn; the Run
 * record handed to the start-up classifier is the same Run with the booking
 * undone in memory (and the claim generation advanced so the yielded
 * continuation cannot be rebuilt). The two writers only record what would be
 * submitted, so the assertion is on the `activity` handed to `reconcileRun`
 * — never on a stored/restart value (BE2c).
 *
 * Fixture (built only through public calls):
 * - `createC2RuntimePlatform` (C2 Runtime platform fixture) with
 *   `toolNames: ['send_session_message']` and a scripted model;
 * - `platform.runtime.prepareExecution` + `startRun` drive the real Turn to
 *   `yielded`.
 * The only in-memory mutation is the claim generation, exactly as the A2 test.
 */
import { afterEach, expect, it } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
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

/** The yielded Run as a restart reads it before the booking (in memory only), with a later claim generation. */
function unbookedWithLaterClaim(record: TaskExecutionRecord): TaskExecutionRecord {
  const run = record.run;
  const auth = run.executionAuthorization;
  const locator = run.executionHistory;
  if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2 || locator === undefined) {
    throw new Error('the yielded Run must carry its V2 binding and history locator');
  }
  const { continuation: _continuation, ...rest } = run;
  const running: RunSnapshot = { ...rest, status: 'running', outcome: null, exitCode: null, endedAt: null,
    executionAuthorization: { ...auth, phase: 'entered' },
    executionHistory: { ...locator, observedThroughPosition: locator.startPosition, endPosition: null } };
  return { ...record, run: running,
    outbox: { ...record.outbox, claim: { ...record.outbox.claim, generation: record.outbox.claim.generation + 1 } } };
}

it('2B-40 (BE2c): RUN-20(iii) hands reconcileRun a counted tally for the real yielded Turn (one send_session_message = one step, not an edit)', async () => {
  const calls = [{ callId: 's2b-40-send-1', name: 'send_session_message',
    args: { recipient: {}, text: 'S2B 2B-40 question', intent: 'inquiry', needsReply: true, waitAfterSend: true } }];
  const fx = await createC2RuntimePlatform({ toolNames: ['send_session_message'],
    scriptedReplies: [{ kind: 'calls', calls }, { kind: 'text', text: 'never reached: the Run yields' }] });
  fixtures.push(fx);
  calls[0]!.args.recipient = { projectId: fx.secondSession.projectId, sessionId: fx.secondSession.sessionId };
  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 's2b-40-prepare' });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-40-driver',
    requestId: 's2b-40-start' });
  if (started.status !== 'ready') throw new Error(`start: ${JSON.stringify(started)}`);
  expect(started.value.run, JSON.stringify(started.value.run.terminalPayload)).toMatchObject({ status: 'ended', outcome: 'yielded' });

  const booked: TaskResultObservation[] = [];
  const reconciled: ReconcileRunInput[] = [];
  const refused = { status: 'rejected' as const, code: 'unavailable' as const, reason: 'S2B 2B-40: recorded, not written' };
  const owner = createSessionHistoryCursorOwner({ kernelStores: fx.platform.kernelStores });
  const deps: RunReconcileClassifierDependencies = {
    owner, messages: fx.platform.messages, controls: fx.platform.controls,
    entry: { recordRunResult: async (_ctx, request) => { booked.push(request.input); return refused; } },
    reconcile: {
      reconcileRun: async (_ctx, request) => { reconciled.push(request.input); return refused; },
      resolveUnknownRun: async () => refused, reconcileRunControls: async () => refused,
    },
    now: () => '2026-10-05T00:00:00.000Z', newId: () => 's2b-40-id',
  };
  const input = unbookedWithLaterClaim(started.value);
  const probe = await owner.probe({ session: input.session, signal: fx.ctx.signal });
  expect(probe.verdict).toBe('ready');
  await reconcileRunAtStartup(deps, fx.ctx, { record: input, hostInstanceId: 's2b-40-host', probe });

  // The yielded continuation cannot be rebuilt, so the end is unknown and goes through reconcileRun.
  expect(booked).toEqual([]);
  expect(reconciled).toHaveLength(1);
  const result = reconciled[0]!.result;
  expect(result.kind).toBe('unknown');
  if (result.kind !== 'unknown') throw new Error('expected an unknown reconcile');
  expect(result.cause).toBe('continuation_unrebuildable');
  const activity = reconciled[0]!.activity;
  expect(activity).toMatchObject({ status: 'counted',
    window: { turnTerminal: true, unresolvedCalls: 0, bound: 'reconcile_observation' },
    totals: { steps: 1, edits: 0, editsUnknown: 0 } });
}, 60_000);
