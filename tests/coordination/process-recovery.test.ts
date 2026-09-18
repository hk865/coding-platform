import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { CodingAgentRuntime, type RunSpec } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import { buildDispatchClaimCommand } from '../../src/fixtures/dispatch-fixtures.js';
import { setupP107Scenario } from './runtime-concurrency-fixture.js';
import { P107_PROJECT, P107_WORKSPACE, P107_SCHEMA } from '../contract-support/fixtures/workspace-fixtures.js';
import { P107_GOAL, P107_TASK_READER_A, P107_ROLE_BINDING_READER_V1 } from '../contract-suite/p1-07-harness.js';

const execute = promisify(execFile);
const driver = fileURLToPath(new URL('./runtime-process.mjs', import.meta.url));
const cleanup: string[] = [];
// Keep persistent process witnesses, including assertion failures, for diagnosis.
afterEach(() => { console.info("Persistent process evidence:", cleanup.splice(0)); });
async function seed(deferClaim = false) {
  const dir = await mkdtemp(join(tmpdir(), 'cm1a-process-')); cleanup.push(dir);
  const sourceRoot = join(dir, 'source'), runsDir = join(dir, 'runs'), stateDir = join(dir, 'state'), counter = join(dir, 'external-calls');
  await mkdir(sourceRoot); await mkdir(stateDir);
  const scope = { projectId: P107_PROJECT, workspaceId: P107_WORKSPACE };
  const runRef = { aggregateType: 'Run' as const, projectId: P107_PROJECT, goalId: P107_GOAL, runId: 'process-run' };
  const spec: RunSpec = { ...scope, goalId: P107_GOAL, taskId: P107_TASK_READER_A, runId: runRef.runId, root: sourceRoot,
    instruction: 'Return the process witness.', budget: { contextWindowTokens: 1_000_000, inputTokens: null, outputTokens: null,
      maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 8192 } };
  const runtime = new CodingAgentRuntime(runsDir, async () => ({ configuration: { revision: 'test', provider: 'deepseek', model: 'capture', baseUrl: 'http://127.0.0.1' },
    client: { async *stream() { throw Error('seed may not call a provider'); } } }));
  await runtime.init(); await runtime.prepare(spec); await runtime.close();
  const h = await createPersistentPlatform({ dir: stateDir, deps: { clock: () => P107_SCHEMA } });
  try {
    await setupP107Scenario(h);
    const claimCommand = buildDispatchClaimCommand({ projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_READER_A,
      runId: runRef.runId, attemptId: 'process-attempt', commandId: 'process-claim', correlationId: 'process', idempotencyKey: 'process-claim',
      submittedAt: P107_SCHEMA, roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: { tools: ['read'], writeScope: [] },
      budget: { tokenBudget: 1_000_000, deadline: null } });
    if (deferClaim) await writeFile(join(dir, 'claim-command.json'), JSON.stringify(claimCommand));
    else {
      const claim = await h.claimTask(claimCommand);
      expect(claim.status, JSON.stringify(claim)).toBe('committed');
    }
  } finally { await h.close(); }
  return { dir, sourceRoot, runsDir, stateDir, counter, scope, runRef, at: P107_SCHEMA };
}

async function child(world: Awaited<ReturnType<typeof seed>>, suffix: string, options: Record<string, unknown> = {}) {
  const path = join(world.dir, suffix + '.json'); await writeFile(path, JSON.stringify({ ...world, ...options }));
  try {
    const result = await execute(process.execPath, [driver, path], { maxBuffer: 1024 * 1024 });
    await writeFile(join(world.dir, suffix + ".result.json"), result.stdout); return { code: 0, value: JSON.parse(result.stdout) };
  } catch (error) {
    const failure = error as { code: number; signal?: string; stderr: string; stdout: string };
    if (options['claimCommandFile'] && failure.signal === 'SIGKILL') return { code: 137, value: null };
    if (failure.code !== 86) throw Error('Child failed: ' + failure.stderr + failure.stdout);
    return { code: 86, value: null };
  }
}
async function count(world: Awaited<ReturnType<typeof seed>>) {
  const body = await readFile(world.counter, 'utf8').catch(() => '');
  return body.trim() ? body.trim().split('\n').length : 0;
}
async function exists(path: string) { return access(path).then(() => true, () => false); }
async function recordedCancel(world: Awaited<ReturnType<typeof seed>>) {
  const h = await createPersistentPlatform({ dir: world.stateDir, deps: { clock: () => world.at } });
  try {
    return await h.control.submitControl({ schemaVersion: 1, commandType: 'SubmitControl', commandId: 'late-cancel',
      identity: { projectId: world.scope.projectId, actor: { kind: 'human', id: 'user-1' }, idempotencyKey: 'late-cancel' },
      aggregateId: 'late-cancel', expectedRevision: 0, correlationId: 'late-cancel', submittedAt: world.at,
      payload: { intent: { schemaVersion: 1, intentId: 'late-cancel', ...world.scope, kind: 'cancel',
        scope: { ...world.scope, goalId: world.runRef.goalId, taskId: P107_TASK_READER_A, runRef: world.runRef }, reason: 'reconcile cancellation',
        steer: null, desiredState: 'cancelled', status: 'queued', acks: [], resumeFromIntentRef: null, submittedAt: world.at, updatedAt: world.at } } });
  } finally { await h.close(); }
}
async function cancelSnapshot(world: Awaited<ReturnType<typeof seed>>) {
  const h = await createPersistentPlatform({ dir: world.stateDir });
  try { return await h.ledger.load({ aggregateType: 'ControlIntent', ...world.scope, intentId: 'late-cancel' }); }
  finally { await h.close(); }
}


it('SIGKILL immediately after formal claim commit preserves one execution through two new processes', async () => {
  const w = await seed(true), marker = join(w.dir, 'claim-committed.json');
  expect((await child(w, 'claim-kill', { claimCommandFile: join(w.dir, 'claim-command.json'), marker })).code).toBe(137);
  const committed = JSON.parse(await readFile(marker, 'utf8'));
  expect(committed.receipt).toMatchObject({ status: 'committed', replayed: false });
  expect(committed.facts.TaskClaimed).toBe(1);
  expect(await count(w)).toBe(0);
  const recovered = (await child(w, 'claim-recover', { recover: true })).value;
  expect(recovered.pid).not.toBe(committed.pid);
  expect(recovered.run.snapshot).toMatchObject({ attemptId: 'process-attempt', outcome: 'completed' });
  expect(recovered.facts.TaskClaimed).toBe(1);
  expect(await count(w)).toBe(1);
  const replay = (await child(w, 'claim-third-pid', { recover: true })).value;
  expect(new Set([committed.pid, recovered.pid, replay.pid]).size).toBe(3);
  expect(replay.run).toEqual(recovered.run);
  expect(replay.facts).toEqual(recovered.facts);
  expect(replay.result.started).toBe(0);
  expect(await count(w)).toBe(1);
}, 90000);

it('two independent processes race the same durable outbox; only one enters the actual provider', async () => {
  const w = await seed(); const go = join(w.dir, 'go');
  const readyA = join(w.dir, 'ready-a'), readyB = join(w.dir, 'ready-b');
  const a = child(w, 'a', { go, ready: readyA }); const b = child(w, 'b', { go, ready: readyB });
  const deadline = Date.now() + 20_000;
  while (!(await exists(readyA)) || !(await exists(readyB))) {
    if (Date.now() >= deadline) throw Error('Both independent processes did not reach the barrier');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await writeFile(go, 'go');
  const results = await Promise.all([a, b]);
  expect(new Set(results.map(r => r.value.pid)).size).toBe(2);
  await writeFile(join(w.dir, "race-results.json"), JSON.stringify({ results, providerCalls: await count(w) }, null, 2)); expect(results.reduce((n, r) => n + r.value.result.started, 0), JSON.stringify(results)).toBe(1);
  expect(await count(w)).toBe(1);
  const replay = await child(w, 'replay', { recover: true });
  expect(replay.value.result.started).toBe(0);
  expect(await count(w)).toBe(1);
}, 60_000);

it.each(['before_start', 'after_bind', 'after_authorize', 'after_attempt', 'provider_effect', 'after_terminal'])(
  'process exit at %s reopens SQLite and never repeats an ambiguous external action', async fault => {
    const w = await seed();
    expect((await child(w, 'crash', { fault })).code).toBe(86);
    const before = await count(w);
    expect(before).toBe(fault === 'provider_effect' || fault === 'after_terminal' ? 1 : 0);
    const recovered = await child(w, 'recover', { recover: true });
    expect(recovered.value.result.started).toBe(0);
    expect(recovered.value.run.snapshot.outcome).toBe(fault === 'after_terminal' ? 'completed' : 'outcome_unknown');
    expect(await count(w)).toBe(before);
    if (fault !== 'after_terminal') {
      expect(recovered.value.run.snapshot.reconciliation.status).toBe('quarantined');
      expect(recovered.value.recovery.quarantined).toEqual([w.runRef]);
    }
    expect(recovered.value.recovery.rejected).toEqual([]);
  }, 60_000,
);

it('a committed claim with no wake survives process restart and executes exactly once', async () => {
  const w = await seed();
  const resumed = await child(w, 'wake-after-restart', { recover: true });
  expect(resumed.value.run.snapshot.outcome).toBe('completed');
  expect(await count(w)).toBe(1);
}, 60_000);


it('an unconsumed execution generation is fenced before retry; an old process arriving late cannot enter Runtime', async () => {
  const w = await seed(); const entryReady = join(w.dir, 'entry-ready'), entryGo = join(w.dir, 'entry-go');
  const old = child(w, 'old-generation', { entryReady, entryGo });
  const deadline = Date.now() + 30_000;
  while (!(await exists(entryReady))) {
    if (Date.now() > deadline) throw Error('old consumer did not reach its durable authorization');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  try {
    const revoke = await child(w, 'fence-old', { recover: true });
    expect(revoke.value.recovery.scheduledRetries).toEqual([w.runRef]);
    expect(revoke.value.run.snapshot.executionAuthorization).toMatchObject({ generation: 1, phase: 'revoked' });
    expect(revoke.value.result.started).toBe(0);
    expect(await count(w)).toBe(0);
    const retry = await child(w, 'new-generation', { recover: true, at: new Date(Date.parse(w.at) + 2000).toISOString() });
    expect(retry.value.run.snapshot).toMatchObject({ attemptId: 'process-attempt', outcome: 'completed', executionAuthorization: { generation: 2, phase: 'entered' } });
    expect(await count(w)).toBe(1);
  } finally { await writeFile(entryGo, 'release'); }
  const late = await old;
  expect(late.value.result.started).toBe(0);
  expect(await count(w)).toBe(1);
}, 120_000);

it('a process exit after start authorization but before begin produces a durable no-effect retry', async () => {
  const w = await seed();
  expect((await child(w, 'unconsumed-start', { fault: 'after_start_authorization' })).code).toBe(86);
  const recovered = await child(w, 'revoke-unconsumed', { recover: true });
  expect(recovered.value.recovery.scheduledRetries).toEqual([w.runRef]);
  expect(recovered.value.run.snapshot.status).toBe('starting');
  expect(await count(w)).toBe(0);
  const resumed = await child(w, 'retry-unconsumed', { recover: true, at: new Date(Date.parse(w.at) + 2000).toISOString() });
  expect(resumed.value.run.snapshot.outcome).toBe('completed');
  expect(await count(w)).toBe(1);
}, 90_000);

it('cancel intent persisted before a caller crash is applied after restart without any Runtime execution', async () => {
  const w = await seed(); const h = await createPersistentPlatform({ dir: w.stateDir, deps: { clock: () => w.at } });
  try {
    expect(await h.control.submitControl({ schemaVersion: 1, commandType: 'SubmitControl', commandId: 'pending-cancel',
      identity: { projectId: w.scope.projectId, actor: { kind: 'human', id: 'user-1' }, idempotencyKey: 'pending-cancel' },
      aggregateId: 'pending-cancel', expectedRevision: 0, correlationId: 'pending-cancel', submittedAt: w.at,
      payload: { intent: { schemaVersion: 1, intentId: 'pending-cancel', ...w.scope, kind: 'cancel',
        scope: { ...w.scope, goalId: w.runRef.goalId, taskId: P107_TASK_READER_A, runRef: w.runRef }, reason: 'cancel before crash',
        steer: null, desiredState: 'cancelled', status: 'queued', acks: [], resumeFromIntentRef: null, submittedAt: w.at, updatedAt: w.at } } })).toMatchObject({ status: 'committed' });
  } finally { await h.close(); }
  const recovered = await child(w, 'cancel-recovery', { recover: true });
  expect(recovered.value.recovery.rejected).toEqual([]);
  expect(recovered.value.run.snapshot.outcome).toBe('cancelled');
  const reopened = await createPersistentPlatform({ dir: w.stateDir, deps: { clock: () => w.at } });
  try {
    const intent = await reopened.ledger.load({ aggregateType: 'ControlIntent', ...w.scope, intentId: 'pending-cancel' });
    expect(intent).toMatchObject({ status: 'found', snapshot: { revision: 2, intent: { status: 'applied', acks: [], reconciliation: { reason: 'cancelled', runRef: w.runRef } } } });
    await reopened.advanceProjection();
    expect(JSON.stringify(await reopened.controlTimelineView(w.scope))).toContain('applied');
  } finally { await reopened.close(); }
  expect(await count(w)).toBe(0);
}, 60_000);


it.each([false, true])('late durable Runtime terminal receipt reconciles an unknown Run (cancel=%s) without replay', async cancelDuringProvider => {
  const w = await seed();
  const first = await child(w, 'unknown-before-terminal', { markUnknownBeforeTerminal: true, cancelDuringProvider });
  expect(first.value.run.snapshot.outcome).toBe('outcome_unknown');
  expect(await count(w)).toBe(1);
  expect(await recordedCancel(w)).toMatchObject({ status: 'committed' });
  const recovered = await child(w, 'formal-reconcile', { recover: true });
  expect(recovered.value.recovery.rejected).toEqual([]);
  expect(recovered.value.run.snapshot).toMatchObject({ status: 'ended', outcome: cancelDuringProvider ? 'cancelled' : 'completed',
    reconciliation: { status: cancelDuringProvider ? 'cancelled' : 'done', observation: { kind: 'runtime_terminal' } } });
  expect(recovered.value.result.started).toBe(0);
  expect(await count(w)).toBe(1);
  expect(await cancelSnapshot(w)).toMatchObject({ status: 'found', snapshot: { intent: { status: cancelDuringProvider ? 'applied' : 'rejected', acks: [] } } });
  const replay = await child(w, 'reconciled-restart', { recover: true });
  expect(replay.value.recovery.recorded).toBe(0);
  expect(await count(w)).toBe(1);
}, 90_000);

it('fixed vault miss and deferred failure interleaving keeps one provider start', async () => {
  const w = await seed();
  const marker = (name: string) => join(w.dir, name);
  const wait = async (name: string) => { const deadline = Date.now() + 45000; while (!(await exists(marker(name)))) { if (Date.now() >= deadline) throw Error('Missing barrier '+name); await new Promise(r => setTimeout(r, 10)); } };
  const a = child(w, 'a', { vaultReadReady: marker('read-a'), vaultReadGo: marker('insert-a'), startReady: marker('start-a'), startGo: marker('start-go') });
  const b = child(w, 'b', { vaultReadReady: marker('read-b'), vaultReadGo: marker('insert-b') });
  await Promise.all([wait('read-a'), wait('read-b')]);
  await writeFile(marker('insert-a'), 'go');
  await wait('start-a');
  await writeFile(marker('insert-b'), 'go');
  const loser = await b;
  await writeFile(marker('start-go'), 'go');
  const winner = await a;
  const results = [winner, loser];
  const providerCalls = await count(w);
  await writeFile(marker('race-results.json'), JSON.stringify({results, providerCalls}, null, 2));
  expect(results.reduce((n,r)=>n+r.value.result.started,0), JSON.stringify({dir:w.dir,results})).toBe(1);
  expect(providerCalls).toBe(1);
}, 120000);
it('new-process recovery repairs legacy terminal Run with queued cancel intent without replay', async () => {
  const w = await seed();
  const first = await child(w, 'legacy-terminal-cancel', { cancelDuringProvider: true });
  expect(first.value.run.snapshot.outcome).toBe('cancelled');
  expect(await recordedCancel(w)).toMatchObject({ status: 'committed' });
  expect(await cancelSnapshot(w)).toMatchObject({ status: 'found', snapshot: { intent: { status: 'queued' } } });
  const recovered = await child(w, 'legacy-intent-recovery', { recover: true });
  expect(recovered.value.pid).not.toBe(first.value.pid);
  expect(recovered.value.recovery.rejected).toEqual([]);
  expect(recovered.value.run.snapshot.outcome).toBe('cancelled');
  expect(await cancelSnapshot(w)).toMatchObject({ status: 'found', snapshot: { revision: 2, intent: { status: 'applied', acks: [] } } });
  const repeated = await child(w, 'legacy-intent-repeat', { recover: true });
  expect(repeated.value.recovery.recorded).toBe(0);
  expect(await count(w)).toBe(1);
}, 90000);
