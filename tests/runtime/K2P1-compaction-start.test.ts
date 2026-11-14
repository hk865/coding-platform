/**
 * Slice K2 P1: the compaction decision at the next Turn's start, through the real Host/Workflow and the
 * scripted model (book-k2-slim.frozen §2.2 worlds A/A′/A″/C/H; rows K2P1-02/03/06/14/15).
 *
 * Every expected value is the frozen book's hand count (§2.1, §2.2): W = 1,000,000; trigger 400,000;
 * target 200,000; tailBudget 100,000; tokensPerChar 0.29; a large result ≥ 60,000 code points, a small
 * one ≤ 2,600. The model is scripted; no row reads the database or imports compaction.ts.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { reenter, submitRunControl } from '../scenarios/support/control.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE_BINDING } from '../helpers/S6A-request-fixture.js';
import { usageOf, type S6AReply } from '../helpers/S6A-host-fixture.js';
import { bigReply, compactions, kernelRecordsOf, openK2QueryWorld, openK2WorkWorld, renameRepeatedCalls,
  smallReply, type K2KernelRecord, type K2QueryWorld, type K2WorkWorld } from '../helpers/K2-world.js';
import { checkConfiguration } from '../helpers/S7A-fixture.js';
import { heartbeat, heartbeatUntil, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { adviserWorkOf, openS7D2RoleLineWorld, S7D2_ADVISER_WORK, S7D2_TOO_LONG_INPUT_TOKENS,
  type S7D2RoleLineWorld } from '../helpers/S7D2-role-line-world.js';
import { claimSuccessorRun, type WP2PlatformFixture } from '../helpers/WP2-platform-support.js';

import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
/** P1: a Work Turn's Kernel run id (the Run start's fixed identity), not the RunRef's own runId. */
const kernelRunIdOf = (runRef: unknown): string => 'krun-' + sha256Hex(canonicalJson(runRef as never));
/** P2: the Host starts a round-end handoff in its lifecycle pass, after the round reads ended. */
async function successorsOf(world: { world: { post(suffix: string, body: unknown): Promise<{ body: unknown }> } },
  sessionRef: unknown, expected: number): Promise<unknown[]> {
  let items: unknown[] = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const answer = await world.world.post('sessions/successors', plain(S6A_SCOPE, { sessionRef, page: { limit: 10 } }));
    items = (answer.body as { value: { items: unknown[] } }).value.items;
    if (items.length >= expected) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return items;
}
const worlds: Array<K2WorkWorld | K2QueryWorld | S7D2RoleLineWorld> = [];
afterEach(async () => {
  const left = worlds.splice(0);
  await Promise.allSettled(left.map(world => world.close()));
});

const openWork = async (options: Parameters<typeof openK2WorkWorld>[0]): Promise<K2WorkWorld> => {
  const world = await openK2WorkWorld(options);
  worlds.push(world);
  return world;
};
const openQueryWorld = async (options: Parameters<typeof openK2QueryWorld>[0] = {}): Promise<K2QueryWorld> => {
  const world = await openK2QueryWorld(options);
  worlds.push(world);
  return world;
};

const payloadOf = (record: K2KernelRecord): Record<string, unknown> =>
  (record as unknown as { payload: Record<string, unknown> }).payload;
const eventOf = (record: K2KernelRecord): Record<string, unknown> | null =>
  record.recordType === 'agent.event'
    ? (payloadOf(record)['event'] as Record<string, unknown>) : null;
const runIdOf = (record: K2KernelRecord): string | null => {
  if (record.recordType === 'turn.started') {
    const run = (payloadOf(record)['run'] as Record<string, unknown>)['runId'];
    return typeof run === 'string' ? run : null;
  }
  const event = eventOf(record);
  const meta = event === null ? null : event['meta'] as Record<string, unknown>;
  return meta !== null && typeof meta['runId'] === 'string' ? meta['runId'] as string : null;
};
/** The `run.completed` position of `runId`, the Turn's terminal boundary. */
const terminalOf = (records: readonly K2KernelRecord[], runId: string): number => {
  const record = [...records].reverse().find(candidate => {
    const event = eventOf(candidate);
    return event !== null && event['type'] === 'run.completed' && runIdOf(candidate) === runId;
  });
  if (record === undefined) throw new Error(`K2: no run.completed for ${runId}`);
  return record.position;
};
const textOf = (message: ModelRequest['messages'][number] | undefined): string | null => {
  if (message === undefined || message.role !== 'tool') return null;
  const output = (message as unknown as { result: { output: Array<{ kind: string; text?: string }> } }).result.output;
  return output[0]?.kind === 'text' ? output[0].text ?? null : null;
};
const toolText = (request: ModelRequest, callId: string): string | null =>
  textOf(request.messages.find(message => (message as unknown as { callId?: string }).callId === callId));

async function capabilities(world: K2WorkWorld): Promise<Record<string, unknown>> {
  const answer = await world.world.post('runtime/capabilities', plain(S6A_SCOPE, S6A_SCOPE));
  const body = answer.body as { status: string; value?: Record<string, unknown> };
  if (body.status !== 'ready' || body.value === undefined) throw new Error(`K2: capabilities: ${JSON.stringify(answer.body)}`);
  return body.value;
}

describe('K2P1-02 the 12-large-result Turn becomes stubs at the next Turn start', () => {
  it('K2P1-02 writes one compacted record to R1, stubs exactly R1, and keeps the small R2 original', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3'] });
    const r1 = await world.runTask('r1', 'k2-02-r1', bigReply(12, 100_000, 'R1 done'));
    await world.runTask('r2', 'k2-02-r2', smallReply(400_000, 'R2 done'));
    await world.runTask('r3', 'k2-02-r3', [{ kind: 'text', text: 'R3 done', usage: usageOf(1_000) }]);

    const records = await world.records();
    const written = compactions(records);
    expect(written).toHaveLength(1);
    const boundary = terminalOf(records, kernelRunIdOf(r1));
    expect(payloadOf(written[0]!)).toMatchObject({
      outcome: 'compacted', failure: null, summary: null,
      stubs: { throughPosition: boundary },
    });

    const request = (await world.requests()).at(-1)!;
    const first = toolText(request, 'big-1');
    expect(first).toContain('旧工具结果已清');
    expect(first).toContain('look_graph');
    expect(first).toContain(r1.runId);
    expect(toolText(request, 'small')).toBe('b'.repeat(2_000));

    const report = await capabilities(world);
    expect((report['nativeCompact'] as { supported: boolean }).supported).toBe(true);
    expect(await world.world.readSession(world.line)).toMatchObject({ record: { ref: world.line.aggregateRef } });
  }, 120_000);
});

describe('K2P1-03 the entry does not fire without its four preconditions', () => {
  it('K2P1-03 (a) one completed Turn cannot make a boundary', async () => {
    const world = await openWork({ files: { small: true }, taskIds: ['r1', 'r2'] });
    await world.runTask('r1', 'k2-03a-r1', smallReply(400_000, 'R1 done'));
    await world.runTask('r2', 'k2-03a-r2', smallReply(1_000, 'R2 done'));
    expect(compactions(await world.records())).toEqual([]);
  }, 60_000);

  it('K2P1-03 (b) 399,999 is below the 400,000 trigger', async () => {
    const world = await openWork({ files: { small: true }, taskIds: ['a', 'b', 'c', 'd', 'e', 'f'] });
    for (const [index, taskId] of ['a', 'b', 'c', 'd', 'e'].entries()) {
      await world.runTask(taskId, `k2-03b-${taskId}`, smallReply(index === 4 ? 399_999 : 1_000, taskId));
    }
    await world.runTask('f', 'k2-03b-f', smallReply(1_000, 'f'));
    expect(compactions(await world.records())).toEqual([]);
  }, 120_000);

  it('K2P1-03 (c) a Turn with no inputTokens report leaves lastInput null', async () => {
    const world = await openWork({ files: { small: true }, taskIds: ['r1', 'r2'] });
    await world.runTask('r1', 'k2-03c-r1', smallReply(null, 'R1 done'));
    await world.runTask('r2', 'k2-03c-r2', smallReply(1_000, 'R2 done'));
    expect(compactions(await world.records())).toEqual([]);
  }, 60_000);

  it('K2P1-03 (e) the first Turn is current_turn', async () => {
    const world = await openWork({ files: { small: true }, taskIds: ['r1'] });
    await world.runTask('r1', 'k2-03e-r1', smallReply(400_000, 'R1 done'));
    expect(compactions(await world.records())).toEqual([]);
  }, 60_000);

  it('K2P1-03 (d) a continuation Session does not enter with a non-empty sourceSessionId', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3', 'r4', 'r5'] });
    await world.runTask('r1', 'k2-03d-r1', bigReply(12, 100_000, 'R1 done'));
    await world.runTask('r2', 'k2-03d-r2', smallReply(200_000, 'R2 done'));
    await world.runTask('r3', 'k2-03d-r3', smallReply(300_000, 'R3 done'));
    await world.runTask('r4', 'k2-03d-r4', smallReply(300_000, 'R4 done'));
    // The fifth Run's own verification round fails, so its completed Task is requeueable for the continuation.
    await world.world.platform.registerCheckConfiguration({ configuration: {
      ...checkConfiguration({ ...OPERATOR, kind: 'human' }), configurationRevision: 'k2-03d-failing@1',
      checks: [{ checkId: 's7a-static-check', kind: 'static', command: 'node -e "process.exit(1)"',
        cwd: '.', timeoutMs: 30_000, taskIds: 'all' }] } });
    const source = await world.runTask('r5', 'k2-03d-r5', smallReply(400_000, 'R5 done'));
    const sourceRecords = await world.records();
    expect(compactions(sourceRecords)).toEqual([]);
    const sourceCard = await world.world.readSession(world.line);

    // The public successor path: the failed round makes the Workflow requeue the completed Run; read the
    // Run and its public Task row, then claim the first Run of a same-role continuation Session.
    const ctx = world.world.humanContext();
    const goalBefore = await world.world.platform.plans.queryGoal(ctx, world.goal);
    if (goalBefore.status !== 'ready') throw new Error(JSON.stringify(goalBefore));
    const planRef = goalBefore.value.goal.activePlanRevision;
    if (planRef === null) throw new Error('K2P1-03 (d) the Goal has no active Plan');
    const prior = await world.world.platform.executions.readExecution(ctx, source);
    if (prior.status !== 'ready') throw new Error(JSON.stringify(prior));
    // The source's fifth Run really completed; the Workflow's requeue is the successor's authority.
    expect(prior.value.run).toMatchObject({ status: 'ended', outcome: 'completed' });
    const goal = await world.world.platform.plans.queryGoal(ctx, world.goal);
    if (goal.status !== 'ready') throw new Error(JSON.stringify(goal));
    const graph = await world.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: world.goal }));
    const tasks = (graph.body as { value: { tasks: Array<{ ref: { taskId: string }; requeueRef?: TaskRequeueRef;
      requeueBudget?: { tokenBudget: number; deadline: string | null } }> } }).value.tasks;
    const row = tasks.find(candidate => candidate.ref.taskId === world.tasks[4]!.taskId);
    if (row?.requeueRef === undefined) throw new Error('K2P1-03 (d) the completed Run has no TaskRequeue');
    expect(row.requeueRef.afterRunId).toBe(source.runId);
    const continuation = await world.world.createWorkSession('k2-03d-continuation');
    const successor = {
      fixture: { roleBinding: S6A_WORK_ROLE_BINDING, budget: row.requeueBudget ?? { tokenBudget: 1_000_000, deadline: null },
        workspaceRef: { aggregateType: 'Workspace', ...S6A_SCOPE }, planRef },
      platform: world.world.platform, ctx, scope: S6A_SCOPE,
    } as unknown as WP2PlatformFixture;
    const runRef = await claimSuccessorRun(successor, world.goal, world.tasks[4]!.taskId, continuation.ref,
      'k2-03d-claim', planRef, row.requeueRef);
    const prepared = await world.world.platform.runtime.prepareExecution(ctx, { runRef, requestId: 'k2-03d-prepare' });
    if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
    const opened = await world.world.platform.materials.openArtifact(ctx,
      { ref: prepared.value.envelope.bundleRef, usage: 'historical_explanation' });
    if (opened.status !== 'ready') throw new Error(JSON.stringify(opened));
    const manifest = JSON.parse(opened.value.body) as PreparedTaskManifestV1;
    expect(manifest.sessionBasis?.sourceKernelSessionId).toBeTruthy();
    expect(compactions(await world.recordsOf(continuation.ref))).toEqual([]);
    await world.world.scripted.script(continuation, [{ kind: 'text', text: 'R6 done', usage: usageOf(1_000) }]);

    const started = await world.world.platform.runtime.startRun(ctx, {
      prepared: prepared.value, consumerId: 'k2-03d', requestId: 'k2-03d-start',
    });
    expect(started.status, JSON.stringify(started)).toBe('ready');
    expect(compactions(await world.recordsOf(continuation.ref))).toEqual([]);
    const request = (await world.world.scripted.requests(continuation)).at(-1)!;
    expect(toolText(request, 'big-1')).toBe('a'.repeat(60_000));
    expect(request.messages.at(-1)).toMatchObject({ role: 'user', content: manifest.input });
    expect((await world.records()).length).toBe(sourceRecords.length);
    expect((await world.world.readSession(world.line)).record.revision).toBe(sourceCard.record.revision);
  });

  it('K2P1-03 (f) an interrupted Turn after the cursor blocks the entry', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] });
    await world.runTask('r1', 'k2-03f-r1', bigReply(12, 100_000, 'R1 done'));
    await world.runTask('r2', 'k2-03f-r2', smallReply(200_000, 'R2 done'));
    await world.runTask('r3', 'k2-03f-r3', smallReply(300_000, 'R3 done'));
    await world.runTask('r4', 'k2-03f-r4', smallReply(300_000, 'R4 done'));
    const fifth = await world.runTask('r5', 'k2-03f-r5', smallReply(300_000, 'R5 done'));
    const before = await world.records();
    expect(compactions(before)).toEqual([]);

    // The sixth Turn's first request reports 400,000 and is held; the pause is queued before its reply,
    // so the Kernel interrupts the Turn at the next safe point.
    const hold = await world.world.gates.modelRequest(world.line);
    const driving = world.runTask('r6', 'k2-03f-r6', [
      { kind: 'calls', calls: [{ callId: 'small', name: 'read', args: { path: 'small.txt' } }], usage: usageOf(400_000) },
      { kind: 'text', text: 'R6 done', usage: usageOf(1_000) },
    ]);
    await hold.reached;
    const graph = await world.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: world.goal }));
    const runRef = (graph.body as { value: { tasks: Array<{ ref: { taskId: string }; execution: RunRef | null }> } })
      .value.tasks.find(task => task.ref.taskId === 'r6')?.execution;
    if (runRef === null || runRef === undefined) throw new Error('K2P1-03 (f) the sixth Run is not claimed');
    const paused = await submitRunControl(world.world.ag2b, runRef, 'pause', 'interrupt the Turn', 'k2-03f-pause');
    expect(paused.status, JSON.stringify(paused)).toBe('committed');
    hold.release();
    await driving;

    const afterPause = await world.records();
    expect(compactions(afterPause)).toEqual([]);
    const cursor = terminalOf(afterPause, kernelRunIdOf(fifth));
    const firstAfter = afterPause.find(record => record.position > cursor);
    expect(firstAfter?.recordType).toBe('turn.started');
    expect(runIdOf(firstAfter!)).toBe(kernelRunIdOf(runRef));
    const usage = afterPause.find(record => record.position > cursor && runIdOf(record) === kernelRunIdOf(runRef)
      && eventOf(record)?.['type'] === 'model.usage_recorded');
    expect((eventOf(usage!) as { payload: { delta: { inputTokens: number } } }).payload.delta.inputTokens).toBe(400_000);
    expect(afterPause.some(record => eventOf(record)?.['type'] === 'run.completed'
      && runIdOf(record) === kernelRunIdOf(runRef))).toBe(false);

    // Resume the paused Turn: the entry runs before the resumed model request, with 400,000 as the last report.
    const resumed = await submitRunControl(world.world.ag2b, runRef, 'resume', 'resume the Turn', 'k2-03f-resume');
    expect(resumed.status, JSON.stringify(resumed)).toBe('committed');
    if (resumed.status !== 'committed') return;
    const delivered = await world.world.post('controls/deliver', plain(S6A_SCOPE, { intentRef: resumed.value.intent.ref }));
    expect(delivered.body).toMatchObject({ status: 'ready' });
    const holdResumed = await world.world.gates.modelRequest(world.line);
    const reentering = reenter(world.world.ag2b, runRef, 'k2-03f-reenter');
    await holdResumed.reached;
    const atEntry = await world.records();
    expect(compactions(atEntry)).toEqual([]);
    expect(atEntry.slice(afterPause.length).some(record => record.recordType === 'context.compacted')).toBe(false);
    holdResumed.release();
    expect(await reentering).toMatchObject({ status: 'ready' });
    const resumedRequest = (await world.world.scripted.requests(world.line)).at(-1)!;
    expect(toolText(resumedRequest, 'big-1')).toBe('a'.repeat(60_000));
    expect(compactions(await world.records())).toEqual([]);
  });
});

describe('K2P1-06 the debounce reads the compacted view instead of writing again', () => {
  it('K2P1-06 (a) a 500,000-Turn after the compacted start writes nothing', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3', 'r4'] });
    await world.runTask('r1', 'k2-06a-r1', bigReply(12, 100_000, 'R1'));
    await world.runTask('r2', 'k2-06a-r2', smallReply(400_000, 'R2'));
    await world.runTask('r3', 'k2-06a-r3', [{ kind: 'text', text: 'R3', usage: usageOf(500_000) }]);
    await world.runTask('r4', 'k2-06a-r4', [{ kind: 'text', text: 'R4', usage: usageOf(1_000) }]);
    expect(compactions(await world.records())).toHaveLength(1);
    const successors = await world.world.post('sessions/successors', plain(S6A_SCOPE, {
      sessionRef: world.line.ref, page: { limit: 10 } }));
    expect((successors.body as { value: { items: unknown[] } }).value.items).toEqual([]);
  }, 120_000);

  it('K2P1-06 (b) 300,000 then 500,000 is also debounced, not written', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3', 'r4', 'r5'] });
    await world.runTask('r1', 'k2-06b-r1', bigReply(12, 100_000, 'R1'));
    await world.runTask('r2', 'k2-06b-r2', smallReply(400_000, 'R2'));
    await world.runTask('r3', 'k2-06b-r3', [{ kind: 'text', text: 'R3', usage: usageOf(300_000) }]);
    await world.runTask('r4', 'k2-06b-r4', [{ kind: 'text', text: 'R4', usage: usageOf(500_000) }]);
    await world.runTask('r5', 'k2-06b-r5', [{ kind: 'text', text: 'R5', usage: usageOf(1_000) }]);
    expect(compactions(await world.records())).toHaveLength(1);
  }, 150_000);
});

describe('K2P1-05 a compacted, at-threshold secretary line is handed off after the round', () => {
  it('K2P1-05 (b) Q5 starts with stubs through Q1 and ends at 500,000; the line hands off', async () => {
    const world = await openQueryWorld();
    await world.round('q1', bigReply(12, 100_000, 'Q1'));
    await world.round('q2', smallReply(200_000, 'Q2'));
    await world.round('q3', [{ kind: 'text', text: 'Q3', usage: usageOf(300_000) }]);
    await world.round('q4', [{ kind: 'text', text: 'Q4', usage: usageOf(400_000) }]);
    await world.round('q5', [{ kind: 'text', text: 'Q5', usage: usageOf(500_000) }]);

    const records = await world.records();
    const written = compactions(records);
    expect(written).toHaveLength(1);
    expect(payloadOf(written[0]!)['outcome']).toBe('compacted');

    await world.world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef: world.goal, flowId: 'k2-05-handoff', sessionHint: null, kind: 'select_work' }));
    const items = await successorsOf(world, world.line.ref, 1) as Array<{ provenance: { kind: string; from: { sessionId: string } } }>;
    expect(items).toHaveLength(1);
    expect(items[0]!.provenance).toMatchObject({ kind: 'handoff', from: { sessionId: world.line.ref.sessionId } });
  }, 180_000);
});

describe('K2P1-11 a line whose next round would compact is still selected', () => {
  it('K2P1-11 ends Q5 without handoff; Q6 picks the same line and writes stubs through Q2', async () => {
    const world = await openQueryWorld();
    await world.round('q1', bigReply(12, 100_000, 'Q1'));
    await world.round('q2', bigReply(12, 200_000, 'Q2'));
    await world.round('q3', [{ kind: 'text', text: 'Q3', usage: usageOf(300_000) }]);
    await world.round('q4', [{ kind: 'text', text: 'Q4', usage: usageOf(350_000) }]);
    await world.round('q5', [{ kind: 'text', text: 'Q5', usage: usageOf(500_000) }]);
    const before = compactions(await world.records());
    expect(before).toEqual([]);

    const q6 = await world.round('q6', [{ kind: 'text', text: 'Q6', usage: usageOf(1_000) }], null);
    expect(q6.secretary.sessionId).toBe(world.line.ref.sessionId);
    const written = compactions(await world.records());
    expect(written).toHaveLength(1);
    expect(payloadOf(written[0]!)['outcome']).toBe('compacted');
    const first = toolText(q6.requests[0]!, 'big-1');
    expect(first).toContain('旧工具结果已清');
  }, 240_000);
});

describe('K2P1-07 the compacted view survives a Host restart', () => {
  it('K2P1-07 (a) a crash after the start record and before turn.started reuses that one record', async () => {
    const world = await openWork({ backend: 'sqlite', files: { big: 12, small: true },
      taskIds: ['r1', 'r2', 'r3', 'r4'] });
    await world.runTask('r1', 'k2-07a-r1', bigReply(12, 100_000, 'R1'));
    await world.runTask('r2', 'k2-07a-r2', smallReply(400_000, 'R2'));

    // R3's start: the compaction append commits, the Kernel Turn is never entered. The crash leaves W-05.
    const hold = await world.world.gates.beforeKernel(world.line);
    const driving = world.runTask('r3', 'k2-07a-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    driving.catch(() => undefined);
    try {
      await hold.reached;
      const before = await world.records();
      const written = compactions(before);
      expect(written).toHaveLength(1);
      const position = written[0]!.position;
      expect(before.some(record => record.position > position && record.recordType === 'turn.started')).toBe(false);
      const graph = await world.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: world.goal }));
      const runRef = (graph.body as { value: { tasks: Array<{ ref: { taskId: string }; execution: RunRef | null }> } })
        .value.tasks.find(task => task.ref.taskId === 'r3')?.execution;
      if (runRef === null || runRef === undefined) throw new Error('K2P1-07 (a) the third Run is not claimed');

      await world.world.crash();
      const report = await world.world.post('host/reconcile-report', plain(S6A_SCOPE, {}));
      const runs = (report.body as { value: { report: { runs: Array<{ ref: string; row: string; status: string;
        reason: string }> } } }).value.report.runs;
      expect(runs).toContainEqual(expect.objectContaining({
        ref: JSON.stringify(runRef), row: 'W-05', status: 'reconciled', reason: 'not_entered' }));

      // The next start re-drives the same claim: the one record is reused and its position is the basis.
      await world.script([{ kind: 'text', text: 'R3 next', usage: usageOf(1_000) }]);
      await driveWorkflow(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal, flowId: 'k2-07a-r3-next',
        sessionHint: world.line.ref, kind: 'select_work', taskId: 'r3' });
      const after = await world.records();
      expect(compactions(after)).toHaveLength(1);
      expect(compactions(after)[0]!.position).toBe(position);
      const started = after.filter(record => record.recordType === 'turn.started' && record.position > position);
      expect(started).toHaveLength(1);
      expect(payloadOf(started[0]!)['contextBasis']).toMatchObject({ throughPosition: position });
    } finally {
      hold.release();
      await driving.catch(() => undefined);
    }
  });

  it('K2P1-07 (d) a paused compacted start re-enters the same Turn on the same view and record', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3', 'r4'] });
    await world.runTask('r1', 'k2-07d-r1', bigReply(12, 100_000, 'R1'));
    await world.runTask('r2', 'k2-07d-r2', smallReply(100_000, 'R2'));
    await world.runTask('r3', 'k2-07d-r3', smallReply(400_000, 'R3'));

    // R4 starts with the compacted view (through R1); its first model request is held.
    const hold = await world.world.gates.modelRequest(world.line);
    const driving = world.runTask('r4', 'k2-07d-r4', [
      { kind: 'calls', calls: [{ callId: 'small', name: 'read', args: { path: 'small.txt' } }], usage: usageOf(1_000) },
      { kind: 'text', text: 'R4 done', usage: usageOf(1_000) },
    ]);
    driving.catch(() => undefined);
    await hold.reached;
    const first = await hold.reached;
    const written = compactions(await world.records());
    expect(written).toHaveLength(1);
    const position = written[0]!.position;
    expect(toolText(first, 'big-1')).toContain('旧工具结果已清');
    const graph = await world.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: world.goal }));
    const runRef = (graph.body as { value: { tasks: Array<{ ref: { taskId: string }; execution: RunRef | null }> } })
      .value.tasks.find(task => task.ref.taskId === 'r4')?.execution;
    if (runRef === null || runRef === undefined) throw new Error('K2P1-07 (d) the fourth Run is not claimed');

    const paused = await submitRunControl(world.world.ag2b, runRef, 'pause', 'operator pause', 'k2-07d-pause');
    expect(paused.status, JSON.stringify(paused)).toBe('committed');
    hold.release();
    await driving;
    const pausedRecords = await world.records();
    expect(pausedRecords.some(record => eventOf(record)?.['type'] === 'run.paused'
      && runIdOf(record) === kernelRunIdOf(runRef))).toBe(true);
    const started = pausedRecords.find(record => record.recordType === 'turn.started'
      && runIdOf(record) === kernelRunIdOf(runRef));
    expect(payloadOf(started!)['contextBasis']).toMatchObject({ throughPosition: position });

    const resumed = await submitRunControl(world.world.ag2b, runRef, 'resume', 'operator resume', 'k2-07d-resume');
    expect(resumed.status, JSON.stringify(resumed)).toBe('committed');
    if (resumed.status !== 'committed') return;
    const delivered = await world.world.post('controls/deliver', plain(S6A_SCOPE, { intentRef: resumed.value.intent.ref }));
    expect(delivered.body).toMatchObject({ status: 'ready' });
    const accepted = await reenter(world.world.ag2b, runRef, 'k2-07d-reenter');
    expect(accepted.status, JSON.stringify(accepted)).toBe('ready');
    // The re-entry keeps the first attempt's input byte-for-byte; its own tool exchange is the only addition.
    const second = (await world.requests()).at(-1)!;
    const firstInput = JSON.stringify(first.messages);
    const secondInput = JSON.stringify(second.messages);
    expect(second.messages.length).toBeGreaterThan(first.messages.length);
    // The longer array replaces the prefix array's closing "]" with ","; compare the prefix content exactly.
    expect(secondInput.slice(0, firstInput.length - 1)).toBe(firstInput.slice(0, -1));
    const added = second.messages.slice(first.messages.length);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ role: 'assistant',
      toolCalls: [{ name: 'read', arguments: { path: 'small.txt' } }] });
    expect(textOf(added[1])).toBe('b'.repeat(2_000));
    expect(compactions(await world.records())).toHaveLength(1);
  });

  it('K2P1-07 (c) a Host restart after the compacted start keeps the next Turn on the same view', async () => {
    const world = await openWork({ backend: 'sqlite', files: { big: 12, small: true },
      taskIds: ['r1', 'r2', 'r3', 'r4'] });
    await world.runTask('r1', 'k2-07c-r1', bigReply(12, 100_000, 'R1'));
    await world.runTask('r2', 'k2-07c-r2', smallReply(400_000, 'R2'));
    await world.runTask('r3', 'k2-07c-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    const before = compactions(await world.records());
    expect(before).toHaveLength(1);

    await world.reopen();
    await world.runTask('r4', 'k2-07c-r4', [{ kind: 'text', text: 'R4', usage: usageOf(1_000) }]);
    expect(compactions(await world.records())).toHaveLength(1);
    expect(toolText((await world.requests()).at(-1)!, 'big-1')).toContain('旧工具结果已清');
  }, 300_000);
});

describe('K2P1-10 a second compaction that needs a summary writes failed', () => {
  it('K2P1-10 boundary R5, estimate 397,680, the scripted summary fails, and the view stays at R6', async () => {
    const world = await openWork({ files: { big: 12, small: true },
      taskIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'], compaction: { triggerRatio: 0.05 } });
    await world.runTask('r1', 'k2-10-r1', bigReply(12, 40_000, 'R1'));
    await world.runTask('r2', 'k2-10-r2', smallReply(42_000, 'R2'));
    await world.runTask('r3', 'k2-10-r3', smallReply(44_000, 'R3'));
    await world.runTask('r4', 'k2-10-r4', smallReply(46_000, 'R4'));
    await world.runTask('r5', 'k2-10-r5', smallReply(100_000, 'R5'));
    await world.runTask('r6', 'k2-10-r6', bigReply(12, 400_000, 'R6'));
    world.world.scriptReplies([{ kind: 'error', code: 'provider_request_failed', retryable: false }]);
    await world.runTask('r7', 'k2-10-r7', [{ kind: 'text', text: 'R7', usage: usageOf(1_000) }]);

    const written = compactions(await world.records());
    expect(written).toHaveLength(2);
    expect(payloadOf(written[0]!)['outcome']).toBe('compacted');
    expect(payloadOf(written[1]!)).toMatchObject({ outcome: 'failed', failure: { reason: 'summary_call_failed' } });
    const request = (await world.requests()).at(-1)!;
    expect(toolText(request, 'big-1')).toContain('旧工具结果已清');
    expect(toolText(request, 'small')).toBe('b'.repeat(2_000));
  }, 360_000);
});

describe('K2P1-09 sessions/history lists both context_compacted outcomes and keeps the originals', () => {
  it('K2P1-09 the compacted and failed rows are history entries; executions/history still has R1 full', async () => {
    const compacted = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3'],
      compaction: { triggerRatio: 0.2 } });
    const r1 = await compacted.runTask('r1', 'k2-09-r1', bigReply(12, 100_000, 'R1'));
    await compacted.runTask('r2', 'k2-09-r2', smallReply(399_999, 'R2'));
    await compacted.runTask('r3', 'k2-09-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    const compactedHistory = await compacted.history();
    const compactedEntries = compactedHistory.filter(item => (item as { kind: string }).kind === 'context_compacted');
    expect(compactedEntries).toHaveLength(1);
    expect(JSON.parse((compactedEntriesAT(compactedEntries[0]!))).payload.outcome).toBe('compacted');

    const original = await compacted.world.post('executions/history', plain(S6A_SCOPE, { runRef: r1, afterCursor: null, limit: 200 }));
    expect(JSON.stringify(original.body)).toContain('a'.repeat(60_000));

    const failed = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3'],
      compaction: { triggerRatio: 0.2, targetRatio: 0.1 } });
    await failed.runTask('r1', 'k2-09f-r1', bigReply(12, 100_000, 'R1'));
    await failed.runTask('r2', 'k2-09f-r2', smallReply(399_999, 'R2'));
    failed.world.scriptReplies([{ kind: 'error', code: 'provider_request_failed', retryable: false }]);
    await failed.runTask('r3', 'k2-09f-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    const failedHistory = (await failed.history()).filter(item => (item as { kind: string }).kind === 'context_compacted');
    expect(failedHistory).toHaveLength(1);
    expect(JSON.parse(compactedEntriesAT(failedHistory[0]!)).payload).toMatchObject({
      outcome: 'failed', failure: { reason: 'summary_call_failed' },
    });
  }, 300_000);
});

function compactedEntriesAT(entry: { body: unknown }): string {
  const body = entry.body as { encoding?: string; text?: string };
  if (body.encoding !== 'kernel_session_record_json' || body.text === undefined) {
    throw new Error('K2P1-09: the history entry is not a Kernel record');
  }
  return body.text;
}

describe('K2P1-14 the tail keeps the newest whole Turn even when it alone exceeds the budget', () => {
  it('K2P1-14 (a) boundary R3, stubs R1–R3, R4 original', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
      compaction: { triggerRatio: 0.4 } });
    await world.runTask('r1', 'k2-14a-r1', bigReply(12, 300_000, 'R1'));
    await world.runTask('r2', 'k2-14a-r2', smallReply(301_000, 'R2'));
    const r3 = await world.runTask('r3', 'k2-14a-r3', smallReply(302_000, 'R3'));
    const r4 = await world.runTask('r4', 'k2-14a-r4', bigReply(6, 406_400, 'R4'));
    await world.runTask('r5', 'k2-14a-r5', [{ kind: 'text', text: 'R5', usage: usageOf(1_000) }]);

    const records = await world.records();
    const written = compactions(records);
    expect(written).toHaveLength(1);
    const boundary = terminalOf(records, kernelRunIdOf(r3));
    const payload = payloadOf(written[0]!);
    expect(payload['outcome']).toBe('compacted');
    expect((payload['stubs'] as { throughPosition: number }).throughPosition).toBe(boundary);
    const request = (await world.requests()).at(-1)!;
    expect(toolText(request, 'big-1')).toContain('旧工具结果已清');
    expect(toolText(request, 'big-6@r4')).toBe('a'.repeat(60_000));
    expect(terminalOf(records, kernelRunIdOf(r4))).toBeGreaterThan(boundary);
  }, 180_000);
});

describe('K2P1-15 the startup ratios decide trigger, target and tail', () => {
  it('K2P1-15 (a) the default 0.4 does not fire at 399,999', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3'] });
    await world.runTask('r1', 'k2-15a-r1', bigReply(12, 100_000, 'R1'));
    await world.runTask('r2', 'k2-15a-r2', smallReply(399_999, 'R2'));
    await world.runTask('r3', 'k2-15a-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    expect(compactions(await world.records())).toEqual([]);
  }, 120_000);

  it('K2P1-15 (b) triggerRatio 0.2 fills target and tail from the defaults and writes stubs', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3'],
      compaction: { triggerRatio: 0.2 } });
    await world.runTask('r1', 'k2-15b-r1', bigReply(12, 100_000, 'R1'));
    await world.runTask('r2', 'k2-15b-r2', smallReply(399_999, 'R2'));
    await world.runTask('r3', 'k2-15b-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    const written = compactions(await world.records());
    expect(written).toHaveLength(1);
    expect(payloadOf(written[0]!)['outcome']).toBe('compacted');
  }, 120_000);

  it('K2P1-15 (c) targetRatio 0.1 makes the same boundary a summary', async () => {
    const world = await openWork({ files: { big: 12, small: true }, taskIds: ['r1', 'r2', 'r3'],
      compaction: { triggerRatio: 0.2, targetRatio: 0.1 } });
    await world.runTask('r1', 'k2-15c-r1', bigReply(12, 100_000, 'R1'));
    await world.runTask('r2', 'k2-15c-r2', smallReply(399_999, 'R2'));
    const summary = '## 目标和验收义务\nA\n## 用户原话和要求\nB\n## 做过的决定和依据\nC\n## 没解决的事\nD\n## 试过什么、结果如何\nE\n## 来源\nF';
    world.world.scriptReplies([{ kind: 'text', text: summary, usage: usageOf(1_000) }]);
    await world.runTask('r3', 'k2-15c-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    const written = compactions(await world.records());
    expect(written).toHaveLength(1);
    expect(payloadOf(written[0]!)['outcome']).toBe('compacted');
    expect(payloadOf(written[0]!)['summary']).not.toBeNull();
    expect(payloadOf(written[0]!)['stubs']).toBeNull();
  }, 120_000);

  it('K2P1-15 (d) tailRatio 0.9 keeps both Turns and writes nothing; 0.5 writes stubs', async () => {
    const world = await openWork({ files: { big: 6, small: true }, taskIds: ['r1', 'r2', 'r3'],
      compaction: { triggerRatio: 0.2, tailRatio: 0.9 } });
    await world.runTask('r1', 'k2-15d-r1', bigReply(6, 150_000, 'R1'));
    await world.runTask('r2', 'k2-15d-r2', smallReply(300_000, 'R2'));
    await world.runTask('r3', 'k2-15d-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    expect(compactions(await world.records())).toEqual([]);

    const half = await openWork({ files: { big: 6, small: true }, taskIds: ['r1', 'r2', 'r3'],
      compaction: { triggerRatio: 0.2, tailRatio: 0.5 } });
    await half.runTask('r1', 'k2-15d-half-r1', bigReply(6, 150_000, 'R1'));
    await half.runTask('r2', 'k2-15d-half-r2', smallReply(300_000, 'R2'));
    await half.runTask('r3', 'k2-15d-half-r3', [{ kind: 'text', text: 'R3', usage: usageOf(1_000) }]);
    expect(compactions(await half.records())).toHaveLength(1);
  }, 180_000);
});

/**
 * K2P1-12: role-line maintenance on an adviser line (`intervention_planning` rounds) in the S7D2 200k world (lead
 * 11-10: the spec's 1M line cannot be built on the public path): trigger 0.4×200,000 = 80,000, target 0.2×200,000
 * = 40,000, handoff line min(500,000, floor(0.8×200,000)) = 160,000. Q1/Q2 are 12×60,000-byte results; Q3 one
 * small result (kept original), Q4/Q5 answer-only small rounds, because one planning input is 15,470 record chars
 * and three result-bearing small turns (3×25,048 chars = 21,792 tokens) overflow the 20,000 tail. Reported input
 * Q1–Q4 = 40,000, Q5 = 160,000. After Q5: no compacted view, 5 rounds, last 160,000 ≥ 80,000; tail budget
 * 0.5×40,000 = 20,000; Q3–Q5 = 18,514 tokens, Q2 = 208,800 > the 1,486 left -> boundary Q2; savedChars
 * 2×712,800 = 1,425,600; estimate 160,000 − 413,424 = −253,424 ≤ 40,000 -> stubs through Q2 (the sheet's
 * result-only count, newest 3 small rounds 1,740 and Q2 > 18,260, reads the same boundary). Using the spec's
 * literal reports inside this 200k world (Q5 500,000) gives estimate 86,576 > target 40,000, so Q6 would summarize,
 * not stub; the spec's own 1M world has target 200,000 and reads stubs.
 * Named mutation: `create-platform.ts:3840–:3841`'s `unlessCompactsNext` wrapper removed -> (a) hands off.
 */
describe('K2P1-12 role-line maintenance defers to the compaction of the next round', () => {
  it('K2P1-12 (a) Q5 at the handoff line does not hand off, Q6 compacts; (b) the compacted Q6 hands off',
    async () => {
      const world = await openS7D2RoleLineWorld({ backend: 'memory',
        extraBindings: [adviserWorkOf(S7D2_ADVISER_WORK.binding.grant.tools, true)],
        extraHostOptions: { inputConsumers: [{ scope: S6A_SCOPE,
          sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: 'k2p1-12-consume' },
          goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: 'k2p1-12-consume' },
          queryProfileId: 's7d2-adviser-query-profile', heartbeatMs: 25 }] } });
      worlds.push(world);
      for (let index = 1; index <= 12; index += 1) await writeFile(join(world.world.root,
        `big-${String(index)}.txt`), 'a'.repeat(60_000));
      await writeFile(join(world.world.root, 'small.txt'), 'b'.repeat(2_000));
      const line = world.lines.adviser;
      const used = new Set<string>();
      const round = async (label: string, replies: readonly S6AReply[]): Promise<ModelRequest[]> => {
        await world.world.scripted.script(line, renameRepeatedCalls(used, label, replies));
        const before = (await world.world.scripted.requests(line)).length;
        const sent = await sendS7A2PersonMessage(world.world, { label, recipient: line.ref, goal: world.goal });
        const ended = await heartbeatUntil(world.world, () => readPlanningQuery(world.world, sent.ref),
          value => value?.job.job.status === 'answered' || value?.run.run.status === 'closed'
            || value?.run.run.executionState?.phase === 'settled', 64);
        if (ended === null) throw new Error(`K2P1-12: the ${label} planning Query did not end`);
        return (await world.world.scripted.requests(line)).slice(before);
      };
      const maintenance = async (label: string): Promise<void> => {
        await world.world.post('workflow/advance', plain(S6A_SCOPE, { schemaVersion: 1,
          goalRef: world.world.goals.second, flowId: `k2p1-12-${label}`, sessionHint: null, kind: 'select_work' }));
        for (let pass = 0; pass < 8; pass += 1) await heartbeat(world.world);
      };
      await round('q1', bigReply(12, 40_000, 'Q1'));
      await round('q2', bigReply(12, 40_000, 'Q2'));
      await round('q3', smallReply(40_000, 'Q3'));
      await round('q4', [{ kind: 'text', text: 'Q4', usage: usageOf(40_000) }]);
      await round('q5', [{ kind: 'text', text: 'Q5', usage: usageOf(S7D2_TOO_LONG_INPUT_TOKENS) }]);
      // (a) one maintenance page: the handoff line is reached, but the next round compacts first.
      expect(compactions(await kernelRecordsOf(world.world, line.ref))).toEqual([]);
      await maintenance('a');
      const successorsNow = (await world.world.post('sessions/successors',
        plain(S6A_SCOPE, { sessionRef: line.ref, page: { limit: 10 } }))).body as { value: { items: unknown[] } };
      expect(successorsNow.value.items).toEqual([]);
      expect(compactions(await kernelRecordsOf(world.world, line.ref))).toEqual([]);

      const q6 = await round('q6', smallReply(S7D2_TOO_LONG_INPUT_TOKENS, 'Q6'));
      const written = compactions(await kernelRecordsOf(world.world, line.ref));
      expect(written).toHaveLength(1);
      expect(payloadOf(written[0]!)['outcome']).toBe('compacted');
      const first = q6[0]!;
      expect(toolText(first, 'big-1')).toContain('旧工具结果已清');
      expect(toolText(first, 'big-1@q2')).toContain('旧工具结果已清');
      expect(toolText(first, 'small')).toBe('b'.repeat(2_000));

      // (b) Q6 began on the compacted view and ended at the handoff line: the page hands the line off.
      await maintenance('b');
      const successors = await successorsOf(world, line.ref, 1) as Array<{ provenance: unknown }>;
      expect(successors).toHaveLength(1);
      expect(successors[0]!.provenance).toEqual({ schemaVersion: 1, kind: 'handoff', from: line.ref });
    }, 240_000);
});
