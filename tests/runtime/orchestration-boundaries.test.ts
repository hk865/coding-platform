/**
 * Common-orchestration boundary tests over the REAL frozen Kernel runner.
 *
 * These tests observe the explicit `run.yielded` terminal the workbench adds to
 * the ONE Kernel Run lifecycle. They prove the seam is real and distinct:
 *   - a waited tool group drains, the Run yields and ends with a `yielded`
 *     outcome that is NOT `paused` and NOT `completed`;
 *   - the original Kernel identity can still `resume` a genuinely paused state,
 *     while a yielded state is terminal and cannot be silently resumed;
 *   - a yield requested before the group drained fails closed instead of
 *     pretending the un-settled side effects were abandoned.
 *
 * No model, network or platform owner is faked: the scripted model, the
 * controlled tool executor and the required sink are the frozen public seams.
 */
import { describe, expect, it } from 'vitest';
import { reduceRunState, type RunState, type ToolGroupBarrierDecision } from '../../vendor/coding-agent/dist/public-api.js';
import {
  ORCHESTRATION_AT,
  baseRun,
  createRunner,
  runLimits,
  runnerInput,
  successResult,
} from '../helpers/orchestration-fixture.js';

const TOOL = 'wait_tool';

async function yieldOnce(): Promise<{ state: RunState; events: string[] }> {
  const harness = createRunner({
    replies: [
      { kind: 'tools', calls: [{ callId: 'call-1', name: TOOL }] },
      { kind: 'text', text: 'unreachable after yield' },
    ],
    handlers: { [TOOL]: async call => successResult(call.callId, 'waited') },
    sinkId: 'orchestration-yield-sink',
    limits: runLimits(),
    barrier: async (invocation): Promise<ToolGroupBarrierDecision> => (invocation.point === 'after_group'
      ? { kind: 'yield', reason: 'reply_required' }
      : { kind: 'continue' }),
  });
  const state = await harness.runner.run(runnerInput(baseRun('run-yield', 'turn-yield'), [TOOL]));
  return { state, events: harness.sink.events.map(event => event.type) };
}

describe('kernel run.yielded boundary', () => {
  it('drains the waited tool group and ends with a real yielded terminal', async () => {
    const { state, events } = await yieldOnce();
    expect(state.status).toBe('yielded');
    expect(state.outcome).toMatchObject({ kind: 'yielded', yield: { reason: 'reply_required', requestedBy: 'app' } });
    expect(state.endedAt).toBe(ORCHESTRATION_AT);
    expect(state.pause).toBeNull();
    // The waiting tool really completed BEFORE the yield: its result is durable.
    expect(state.transcript.some(entry => entry.kind === 'tool_result' && entry.callId === 'call-1')).toBe(true);
    expect(events).toContain('run.yielded');
    expect(events).not.toContain('run.completed');
    expect(events).not.toContain('run.paused');
  });

  it('keeps paused genuinely resumable on the original Kernel identity while yielded is terminal', async () => {
    let pausedOnce = false;
    const harness = createRunner({
      replies: [
        { kind: 'tools', calls: [{ callId: 'call-pause', name: TOOL }] },
        { kind: 'text', text: 'resumed answer' },
      ],
      handlers: { [TOOL]: async call => successResult(call.callId) },
      sinkId: 'orchestration-pause-sink',
      limits: runLimits(),
      barrier: async (invocation): Promise<ToolGroupBarrierDecision> => {
        if (invocation.point === 'before_group' && !pausedOnce) {
          pausedOnce = true;
          return { kind: 'pause' };
        }
        return { kind: 'continue' };
      },
    });
    const input = runnerInput(baseRun('run-pause', 'turn-pause'), [TOOL]);
    const paused = await harness.runner.run(input);
    expect(paused.status).toBe('paused');
    const resumed = await harness.runner.resume(paused, input);
    expect(resumed.status).toBe('completed');

    const { state: yielded } = await yieldOnce();
    // A yielded state is a real terminal: the frozen Kernel schema only resumes paused.
    await expect(harness.runner.resume(yielded, input))
      .rejects.toThrow(/paused/);
  });

  it('rejects a run.resumed event against a yielded state through the reducer', async () => {
    const { state } = await yieldOnce();
    expect(() => reduceRunState(state, {
      type: 'run.resumed',
      meta: {
        schemaVersion: 1,
        eventId: 'late-resume',
        runId: state.runId,
        turnId: state.turn.turnId,
        sequence: state.lastEventSequence + 1,
        occurredAt: ORCHESTRATION_AT,
        elapsedMs: state.elapsedMs,
      },
      payload: { resumedBy: 'app' },
    })).toThrow();
  });

  it('fails closed when a yield is requested with an un-settled tool group', async () => {
    const harness = createRunner({
      replies: [{ kind: 'tools', calls: [{ callId: 'call-unsettled', name: TOOL }] }],
      handlers: { [TOOL]: async call => successResult(call.callId) },
      sinkId: 'orchestration-unsettled-sink',
      limits: runLimits(),
      barrier: async (invocation): Promise<ToolGroupBarrierDecision> => (invocation.point === 'before_group'
        ? { kind: 'yield', reason: 'external_input_required' }
        : { kind: 'continue' }),
    });
    const state = await harness.runner.run(runnerInput(baseRun('run-unsettled', 'turn-unsettled'), [TOOL]));
    expect(state.status).toBe('failed');
    expect(harness.executor.calls).toHaveLength(0);
    expect(harness.sink.events.map(event => event.type)).toContain('run.failed');
  });
});

it('requires explicit resume and accepts queued steering in the original paused Turn', async () => {
  const { join } = await import('node:path');
  const { createTargetPlatform } = await import('../../src/composition/create-platform.js');
  const { createB2RuntimeFixture, B2_AT } = await import('../helpers/B2-runtime-fixture.js');
  let platform: Awaited<ReturnType<typeof createTargetPlatform>> | undefined;
  let pauseRef: import('../../src/contracts/control-intent.js').ControlIntentRef | undefined;
  const fixture = await createB2RuntimeFixture({ kind: 'sqlite', scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'control-read', name: 'read', args: { path: 'b2-read.txt' } }] },
    { kind: 'text', text: 'continued after the explicit direction' },
  ], beforeReply: async (_request, index) => {
    if (index !== 0 || platform === undefined) return;
    const read = await platform.executions.readExecution(fixture.ctx, fixture.claim.runRef);
    if (read.status !== 'ready') throw Error('missing running fact');
    const result = await platform.controls.submitControl(fixture.ctx, {
      input: { runRef: fixture.claim.runRef, kind: 'pause', reason: 'operator pause' },
      meta: { requestId: 'common-pause', expected: [{ ref: fixture.claim.runRef, revision: read.value.run.revision }] },
    });
    if (result.status !== 'committed') throw Error('pause was not committed');
    pauseRef = result.value.intent.ref;
  } });
  try {
    await fixture.claimFixture.closeBackend();
    const { mkdir, writeFile } = await import('node:fs/promises');
    const workRoot = join(fixture.directory, 'work');
    await mkdir(workRoot);
    await writeFile(join(workRoot, 'b2-read.txt'), 'controlled workspace file');
    platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory: fixture.directory },
      workspace: { ...fixture.deps.workspaceHost, async resolveRoot() { return { status: 'ready' as const, value: { root: workRoot, workspaceRevision: 1 } }; } }, now: () => B2_AT, runtime: fixture.host,
      kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store', workspace: fixture.scope, databasePath: join(fixture.directory, 'kernel.sqlite') }] },
    });
    const prepared = await platform.runtime.prepareExecution(fixture.ctx, { runRef: fixture.claim.runRef, requestId: 'common-prepare' });
    if (prepared.status !== 'ready') throw Error('prepare failed');
    const start = { prepared: prepared.value, consumerId: 'common-control', requestId: 'common-start' };
    await platform.runtime.startRun(fixture.ctx, start);
    expect(pauseRef).toBeDefined();
    expect(await platform.controls.readControl(fixture.ctx, pauseRef!)).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { kind: 'paused' } } });
    const paused = await platform.executions.readExecution(fixture.ctx, fixture.claim.runRef);
    if (paused.status !== 'ready') throw Error('paused Run missing');
    const kernel = paused.value.run.executionHistory!.kernel;
    await platform.runtime.startRun(fixture.ctx, { ...start, requestId: 'ordinary-retry' });
    expect(fixture.scripted.calls()).toBe(1);
    const control = async (kind: 'steer' | 'resume', reason: string) => {
      const current = await platform!.executions.readExecution(fixture.ctx, fixture.claim.runRef);
      if (current.status !== 'ready') throw Error('Run missing');
      const result = await platform!.controls.submitControl(fixture.ctx, { input: { runRef: fixture.claim.runRef, kind, reason },
        meta: { requestId: `common-${kind}`, expected: [{ ref: fixture.claim.runRef, revision: current.value.run.revision }] } });
      if (result.status !== 'committed') throw Error(`${kind} failed`);
      return result.value.intent.ref;
    };
    const steer = await control('steer', 'EXPLICIT_STEER_USE_EXISTING_CONTRACT');
    await platform.runtime.startRun(fixture.ctx, { ...start, requestId: 'paused-steer-retry' });
    expect(fixture.scripted.calls()).toBe(1);
    const resume = await control('resume', 'operator continues original Turn');
    const resumedResult = await platform.runtime.startRun(fixture.ctx, { ...start, requestId: 'explicit-resume' });
    expect(resumedResult.status).toBe('ready');
    expect(fixture.scripted.calls()).toBe(2);
    expect(JSON.stringify(fixture.scripted.lastRequest()?.messages)).toContain('EXPLICIT_STEER_USE_EXISTING_CONTRACT');
    const completed = await platform.executions.readExecution(fixture.ctx, fixture.claim.runRef);
    expect(completed).toMatchObject({ status: 'ready', value: { run: { outcome: 'completed', executionHistory: { kernel } } } });
    expect(await platform.controls.readControl(fixture.ctx, resume)).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { kind: 'resumed' } } });
    expect(await platform.controls.readControl(fixture.ctx, steer)).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { kind: 'steered' } } });
  } finally { await platform?.close(); await fixture.close(); }
});
