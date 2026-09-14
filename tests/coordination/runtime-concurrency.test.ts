import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { CodingAgentRuntime, type RunSpec } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import { LeasedWorkerRuntime } from '../../src/control/dispatch-engine/leased-worker-runtime.js';
import { buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { setupP107Scenario } from './runtime-concurrency-fixture.js';
import { P107_PROJECT, P107_WORKSPACE, P107_SCHEMA } from '../contract-support/fixtures/workspace-fixtures.js';
import { P107_GOAL, P107_TASK_READER_A, P107_TASK_READER_B, P107_ROLE_BINDING_READER_V1 } from '../contract-suite/p1-07-harness.js';
import type { ModelClientPort, ModelEvent } from '../../vendor/coding-agent/dist/public-api.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function until(check: () => boolean) {
  const deadline = Date.now() + 15_000;
  while (!check()) { if (Date.now() >= deadline) throw Error('Expected runtime boundary was not reached'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

async function world(write: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'cm1a-concurrent-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'source'); await mkdir(root); await mkdir(join(dir, 'state'));
  const finish = latch();
  let calls = 0, active = 0, maximum = 0;
  const entered: string[] = [];
  const client: ModelClientPort = { async *stream(request): AsyncIterable<ModelEvent> {
    calls++; active++; maximum = Math.max(maximum, active); entered.push(request.requestId);
    try {
      await finish.promise;
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: 'text_delta', delta: 'done' };
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: 'completed', reason: 'final_answer' };
    } finally { active--; }
  } };
  const runtime = new CodingAgentRuntime(join(dir, 'runs'), async () => ({
    configuration: { revision: 'test', provider: 'deepseek', model: 'capture', baseUrl: 'http://127.0.0.1' }, client,
  }));
  await runtime.init();
  cleanup.push(async () => { finish.release(); await runtime.close(); });
  let h: Awaited<ReturnType<typeof createPersistentPlatform>>;
  h = await createPersistentPlatform({ dir: join(dir, 'state'), deps: { clock: () => P107_SCHEMA },
    runtimePreparation: runtime, workspaceRootFor: () => root,
    runtime: { capabilities: () => runtime.capabilities(), start: (envelope, access) => new LeasedWorkerRuntime({
      runtime, lease: () => h.workspaceLease, vault: () => h.vault, now: () => P107_SCHEMA, materials: async () => undefined,
    }).start(envelope, access) },
  });
  cleanup.push(() => h.close());
  await setupP107Scenario(h);
  for (const [i, taskId] of [P107_TASK_READER_A, P107_TASK_READER_B].entries()) {
    const runId = 'run-concurrent-' + i;
    const spec: RunSpec = { projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, goalId: P107_GOAL, taskId,
      runId, root, instruction: 'Read the supplied task and return done.',
      budget: { contextWindowTokens: 1_000_000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 8192 } };
    await runtime.prepare(spec);
    const claimed = await h.claimTask(buildDispatchClaimCommand({ projectId: P107_PROJECT, goalId: P107_GOAL, taskId,
      runId, attemptId: 'attempt-concurrent-' + i, commandId: 'claim-concurrent-' + i, correlationId: 'concurrent',
      idempotencyKey: 'claim-concurrent-' + i, submittedAt: P107_SCHEMA, roleBinding: P107_ROLE_BINDING_READER_V1,
      declaredPermissions: write ? { tools: ['read', 'write', 'shell'], writeScope: ['*'] } : { tools: ['read'], writeScope: [] },
      budget: { tokenBudget: 1_000_000, deadline: null } }));
    expect(claimed.status, JSON.stringify(claimed)).toBe('committed');
  }
  return { h, runtime, finish, entered, counts: () => ({ calls, active, maximum }) };
}

it('ordinary drive overlaps two actual read-only Runtime/provider calls', async () => {
  const w = await world(false);
  const drive = w.h.drive({ reason: 'ordinary-read-overlap' });
  try {
    await until(() => w.counts().calls === 2 || w.runtime.all().some(r => r.status === 'failed'));
    expect(w.counts(), JSON.stringify(w.runtime.all().map(r => ({ status: r.status, error: r.error })))).toMatchObject({ active: 2, maximum: 2 });
  } finally { w.finish.release(); await drive; }
  const result = await drive;
  expect(result.failures, JSON.stringify(w.runtime.all().map(r => ({ status: r.status, error: r.error, events: r.events })))).toEqual([]);
  expect(result.completed).toBe(2);
});

it('conflicting writers remain pending and execute sequentially through the shared owner', async () => {
  const w = await world(true);
  const drive = w.h.drive({ reason: 'ordinary-write-conflict' });
  try {
    await until(() => w.counts().calls === 1);
    expect(await w.h.ledger.pendingDispatchIntents(10)).toHaveLength(1);
    expect(w.counts()).toMatchObject({ active: 1, maximum: 1, calls: 1 });
    expect(w.runtime.all().some(r => r.status === 'failed')).toBe(false);
  } finally { w.finish.release(); await drive; }
  const result = await drive;
  expect(result.failures).toEqual([]);
  expect(result.completed).toBe(2);
  expect(w.counts()).toMatchObject({ calls: 2, maximum: 1 });
  expect(w.runtime.all().every(r => r.status === 'completed')).toBe(true);
});
