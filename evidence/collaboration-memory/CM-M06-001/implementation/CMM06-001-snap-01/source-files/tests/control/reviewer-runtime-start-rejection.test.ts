import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { ReviewerDispatch } from '../../src/control/dispatch-engine/reviewer-dispatch.js';
import { LeasedWorkerRuntime } from '../../src/control/dispatch-engine/leased-worker-runtime.js';
import { CodingAgentRuntime } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import { reviewerFixture, scope } from '../verification/reviewer-fixture.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function scenario(failure: 'closed' | 'unknown') {
  const f = await reviewerFixture(roots);
  const started = await f.service.startReview(scope, f.input);
  expect(started.review.work, JSON.stringify(started.review)).not.toBeNull();
  const work = await f.work(started.review.work!.ref);
  const calls = { materials: 0, start: 0, rejection: 0, model: 0 };
  const runtime = new CodingAgentRuntime(f.directory + '-runtime', async () => ({
    configuration: { revision: work.reviewerProfile.model.configurationRevision, provider: work.reviewerProfile.model.provider,
      model: work.reviewerProfile.model.model, baseUrl: work.reviewerProfile.model.baseUrl },
    client: { complete: async () => { calls.model += 1; throw Error('model must not be called'); } } as never,
  }));
  roots.push(f.directory + '-runtime');
  await runtime.init();
  const leased = new LeasedWorkerRuntime({
    runtime: {
      all: () => runtime.all(), capabilities: () => runtime.capabilities(),
      start: async (envelope, context) => {
        calls.start += 1;
        // Leave the production readonly envelope and real material assembly
        // intact. Fail inside the real start method, after preparation/grants.
        expect(envelope.permissions).toMatchObject({ tools: ['read'], writeScope: [] });
        expect(context?.reviewer).toBeDefined();
        if (failure === 'closed') await runtime.close();
        else await runtime.markUnknown(envelope.runRef);
        return runtime.start(envelope, context);
      },
      rejectBeforeStart: (envelope, reason) => {
        calls.rejection += 1;
        return runtime.rejectBeforeStart(envelope, reason);
      },
    },
    lease: () => f.h.workspaceLease, vault: () => f.h.vault, materials: async () => undefined,
    reviewerMaterials: async (spec, envelope) => {
      const materials = await f.reviewContext.runtime(spec.review!.workRef, envelope);
      calls.materials += 1;
      return materials;
    },
    now: () => '2026-09-10T08:00:01.000Z',
  });
  const dispatch = new ReviewerDispatch({ ledger: f.h.ledger,
    control: { startRun: command => f.h.control.startRun(command), runFact: command => f.h.control.runFact(command),
      grantMaterialAccess: command => f.h.grantMaterialAccess(command) },
    reviewControl: f.control.dispatch, context: f.reviewContext, runtime, execution: leased,
    observations: runtime.observations, vault: f.h.vault, now: () => '2026-09-10T08:00:02.000Z' });
  const run = async () => {
    const loaded = await f.h.ledger.load(work.reviewerRunRef);
    if (loaded.status !== 'found') throw Error('canonical reviewer run missing');
    return loaded.snapshot as RunSnapshot;
  };
  return { dispatch, runtime, work, run, calls };
}

it('classifies the real runtime.start closing rejection as one canonical crash with no model execution', async () => {
  const s = await scenario('closed');
  try {
    expect(await s.dispatch.drive(s.work.ref)).toMatchObject({ status: 'incomplete', code: 'review_execution_incomplete' });
    const first = await s.run();
    expect(first).toMatchObject({ status: 'ended', outcome: 'crashed', exitCode: null, lastEventSeq: 1 });
    expect(await s.dispatch.drive(s.work.ref)).toMatchObject({ status: 'incomplete', code: 'review_execution_incomplete' });
    expect(await s.run()).toEqual(first);
    expect(s.calls).toEqual({ materials: 1, start: 1, rejection: 1, model: 0 });
    expect(s.runtime.all()).toHaveLength(1);
    const record = s.runtime.all()[0]!;
    expect(record).toMatchObject({ status: 'failed', trace: [], usage: [] });
    expect(record.error).toContain('执行器正在关闭，不能开始运行');
    expect(record.events).toHaveLength(1);
    expect(record.events[0]).toMatchObject({ eventType: 'run_crashed', sequence: 1, eventId: first.lastRuntimeEventId });
    expect(s.runtime.observations.all()[0]).toEqual(record);
  } finally { await s.runtime.close(); }
});

it('preserves unknown effects when the same runtime.start catch cannot prove that execution never started', async () => {
  const s = await scenario('unknown');
  try {
    const first = await s.dispatch.drive(s.work.ref);
    expect(first).toMatchObject({ status: 'incomplete', code: 'dispatch_interrupted' });
    expect(first.issues?.join(' ')).toContain('运行结果未知，需要先核对工作区');
    expect(first.issues?.join(' ')).toContain('无法证明尚未启动');
    expect(await s.dispatch.drive(s.work.ref)).toMatchObject({ status: 'incomplete', code: 'runtime_outcome_unknown' });
    const unknown = await s.run();
    expect(unknown).toMatchObject({ status: 'ended', outcome: 'outcome_unknown', lastEventSeq: 0 });
    expect(await s.dispatch.drive(s.work.ref)).toMatchObject({ status: 'incomplete', code: 'review_execution_incomplete' });
    expect(await s.run()).toEqual(unknown);
    expect(s.calls).toEqual({ materials: 1, start: 1, rejection: 1, model: 0 });
    expect(s.runtime.all()).toHaveLength(1);
    expect(s.runtime.all()[0]).toMatchObject({ status: 'outcome_unknown', events: [], trace: [], usage: [] });
    expect(s.runtime.observations.all()[0]).toEqual(s.runtime.all()[0]);
  } finally { await s.runtime.close(); }
});
