/**
 * A.2 step 5.6 over the production composition root on SQLite
 * (docs/refactor/STATE-MACHINES-SPEC.md §6 RD-3 / L-5 and contract (b), §12.2
 * W-10, A8-3b; C8 wiring).
 *
 * W-10: a yielded Kernel terminal the start-up reconcile books itself (no live
 * handle) rebuilds its continuation from the Kernel history only when exactly
 * one `send_session_message` of the Turn waits for a reply, and only from the
 * message this Run stored at its claim generation; otherwise the end is
 * unknown (`continuation_unrebuildable`). The yielded Turn is real
 * (real Kernel, real mailbox, scripted model); the in-process observer already
 * booked it, so the classifier reads it as the restart would see it before
 * that booking: the Run record handed to it is the same Run with the booking
 * undone in memory (nothing persisted is touched), and its two writers record
 * what it would submit.
 *
 * C8: the Host-installed automation policy (defaults 3 / true) and the refusal
 * of a malformed one.
 */
import { afterEach, expect, it } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { reconcileRunAtStartup, type RunReconcileClassifierDependencies } from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import type { TaskResultObservation } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { ReconcileRunInput } from '../../src/core/work-graph/tasks/run-reconcile-contracts.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { createC2RuntimePlatform, type C2RuntimePlatformFixture } from '../helpers/C2-runtime-platform-fixture.js';

const fixtures: C2RuntimePlatformFixture[] = [];
const platforms: Array<Awaited<ReturnType<typeof createTargetPlatform>>> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
  for (const platform of platforms.splice(0)) await platform.close();
});

/** The Run as the restart reads it when the yielded terminal was never booked (in memory only). */
function unbooked(record: TaskExecutionRecord): TaskExecutionRecord {
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
  return { ...record, run: running };
}

async function yieldedRun(sends: 1): Promise<{ fx: C2RuntimePlatformFixture; record: TaskExecutionRecord }> {
  const calls = Array.from({ length: sends }, (_, index) => ({ callId: `a2-w10-send-${index + 1}`, name: 'send_session_message',
    args: { recipient: {}, text: `A2 W-10 question ${index + 1}`, intent: 'inquiry', needsReply: true, waitAfterSend: true } }));
  const replies: ScriptedReply[] = [{ kind: 'calls', calls }, { kind: 'text', text: 'never reached: the Run yields' }];
  const fx = await createC2RuntimePlatform({ toolNames: ['send_session_message'], scriptedReplies: replies });
  fixtures.push(fx);
  for (const call of calls) call.args.recipient = { projectId: fx.secondSession.projectId, sessionId: fx.secondSession.sessionId };
  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: `a2-w10-prepare-${sends}` });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'a2-w10-driver',
    requestId: `a2-w10-start-${sends}` });
  if (started.status !== 'ready') throw new Error(`start: ${JSON.stringify(started)}`);
  expect(started.value.run, JSON.stringify(started.value.run.terminalPayload)).toMatchObject({ status: 'ended', outcome: 'yielded' });
  return { fx, record: started.value };
}

async function classify(fx: C2RuntimePlatformFixture, record: TaskExecutionRecord):
  Promise<{ booked: TaskResultObservation[]; reconciled: ReconcileRunInput[] }> {
  const booked: TaskResultObservation[] = [];
  const reconciled: ReconcileRunInput[] = [];
  const refused = { status: 'rejected' as const, code: 'unavailable' as const, reason: 'A2 W-10: recorded, not written' };
  const owner = createSessionHistoryCursorOwner({ kernelStores: fx.platform.kernelStores });
  const deps: RunReconcileClassifierDependencies = {
    owner, messages: fx.platform.messages, controls: fx.platform.controls,
    entry: { recordRunResult: async (_ctx, request) => { booked.push(request.input); return refused; } },
    reconcile: {
      reconcileRun: async (_ctx, request) => { reconciled.push(request.input); return refused; },
      resolveUnknownRun: async () => refused, reconcileRunControls: async () => refused,
    },
    now: () => '2026-10-05T00:00:00.000Z', newId: () => 'a2-w10-id',
  };
  const input = unbooked(record);
  const probe = await owner.probe({ session: input.session, signal: fx.ctx.signal });
  expect(probe.verdict).toBe('ready');
  await reconcileRunAtStartup(deps, fx.ctx, { record: input, hostInstanceId: 'a2-w10-host', probe });
  return { booked, reconciled };
}

it('W-10 (RD-3, L-5): exactly one waiting send of the Turn rebuilds the yielded continuation from the stored message', async () => {
  const { fx, record } = await yieldedRun(1);
  const { booked, reconciled } = await classify(fx, record);
  expect(reconciled).toEqual([]);
  expect(booked).toHaveLength(1);
  // The rebuilt continuation is the one the live handle recorded: the claim's Task and Session and the stored wait message.
  expect(booked[0]).toMatchObject({ basis: { kind: 'host_instance_takeover', hostInstanceId: 'a2-w10-host' },
    continuation: record.run.continuation, inputsConfirmed: true, event: { eventType: 'run_yielded' } });
  expect(record.run.continuation).toMatchObject({ kind: 'wait_reply', task: fx.claim.task, sessionRef: fx.claim.sessionRef });
}, 60_000);

it('W-10 (RD-3 condition 2): a waiting send the stored message does not tie to this claim generation is not rebuilt: the end is unknown, continuation_unrebuildable', async () => {
  // A second waiting send in the same Turn cannot occur with this Kernel: it refuses to yield a Turn with an
  // unsettled call (`tool_group_yield_unsettled`), so each yielded Turn holds at most one. The facts disagreeing is
  // what is left: here the claim names a later generation than the message the Kernel history points at.
  const { fx, record } = await yieldedRun(1);
  const disagreeing: TaskExecutionRecord = { ...record,
    outbox: { ...record.outbox, claim: { ...record.outbox.claim, generation: record.outbox.claim.generation + 1 } } };
  const { booked, reconciled } = await classify(fx, disagreeing);
  expect(booked).toEqual([]);
  expect(reconciled).toEqual([expect.objectContaining({ runRef: fx.runRef, probe: 'ready',
    basis: { kind: 'host_instance_takeover', hostInstanceId: 'a2-w10-host' },
    result: expect.objectContaining({ kind: 'unknown', cause: 'continuation_unrebuildable', unresolvedToolCallIds: [] }) })]);
}, 60_000);

it('the frozen Kernel never yields a Turn with a second waiting send still unsettled (why L-5\'s "several sends" branch is guarded, not reached)', async () => {
  const calls = [1, 2].map(index => ({ callId: `a2-w10-pair-${index}`, name: 'send_session_message',
    args: { recipient: {}, text: `A2 W-10 pair ${index}`, intent: 'inquiry', needsReply: true, waitAfterSend: true } }));
  const fx = await createC2RuntimePlatform({ toolNames: ['send_session_message'],
    scriptedReplies: [{ kind: 'calls', calls }, { kind: 'text', text: 'never reached' }] });
  fixtures.push(fx);
  for (const call of calls) call.args.recipient = { projectId: fx.secondSession.projectId, sessionId: fx.secondSession.sessionId };
  const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'a2-w10-pair-prepare' });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'a2-w10-driver',
    requestId: 'a2-w10-pair-start' });
  expect(started).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'crashed',
    terminalPayload: { kind: 'crashed', error: 'tool_group_yield_unsettled:after_group:a2-w10-pair-2' } } } });
}, 60_000);

it('C8: the platform holds the automation policy the Host installs (defaults 3 / true) and refuses a malformed one', async () => {
  const platform = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: {
    async resolveRoot() { return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no workspace' }; },
    async authorize() { return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no workspace' }; },
  } });
  platforms.push(platform);
  expect(platform.automationPolicy()).toEqual({ schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: true });
  platform.registerAutomationPolicy({ schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false });
  expect(platform.automationPolicy()).toEqual({ schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false });
  for (const malformed of [{ schemaVersion: 2, autoReworkLimit: 1, resumeOnStartup: true },
    { schemaVersion: 1, autoReworkLimit: -1, resumeOnStartup: true },
    { schemaVersion: 1, autoReworkLimit: 1.5, resumeOnStartup: true },
    { schemaVersion: 1, autoReworkLimit: 1, resumeOnStartup: 'yes' }]) {
    expect(() => platform.registerAutomationPolicy(malformed as never), JSON.stringify(malformed)).toThrow('the automation policy is malformed');
  }
  // A refused policy leaves the installed one; a caller cannot change it through the returned copy.
  const read = platform.automationPolicy();
  read.autoReworkLimit = 9;
  expect(platform.automationPolicy()).toEqual({ schemaVersion: 1, autoReworkLimit: 0, resumeOnStartup: false });
});
