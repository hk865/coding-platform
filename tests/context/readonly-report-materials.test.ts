import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { VerificationContextCompiler } from '../../src/data/context-compiler/verification-context.js';
import { ReadonlyReadWitnessReader } from '../../src/data/workspace-reader/readonly-read-witness-reader.js';
import { VerificationWorkspaceReader } from '../../src/data/workspace-reader/verification-workspace-reader.js';
import type { VerificationRuntimeFacts, VerificationRoundMaterialIdentity, VerificationRoundScope } from '../../src/contracts/verification-context.js';
import type { AggregateSnapshot } from '../../src/contracts/ledger.js';
import type { RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import { prepareP107Scenario, runP107Task, toP1_07Harness, P107_PROJECT, P107_WORKSPACE, P107_GOAL, P107_SCHEMA,
  P107_TASK_READER_A, P107_ROLE_BINDING_READER_V1, P107_BUDGET_READER_V1 } from '../contract-suite/p1-07-harness.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function world() {
  const root = await mkdtemp(join(tmpdir(), 'readonly-report-material-')); roots.push(root);
  await writeFile(join(root, 'source.txt'), 'current read source\n');
  const h = createInMemoryHarness({ deps: { clock: () => P107_SCHEMA } }), p = toP1_07Harness(h);
  await prepareP107Scenario(p);
  const runRef = await runP107Task(p, { taskId: P107_TASK_READER_A, runId: 'readonly-report-run', attemptId: 'readonly-report-attempt',
    roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: { tools: ['read'], writeScope: [] }, budget: P107_BUDGET_READER_V1 });
  const scope: VerificationRoundScope = { projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, goalId: P107_GOAL, taskId: P107_TASK_READER_A, runId: runRef.runId };
  const page = await h.ledger.events({ afterCursor: null, limit: 1000 });
  const events = page.events.flatMap(({ event }) => event.eventType === 'RunEventRecorded' && event.payload.runtimeEvent.runRef.runId === runRef.runId ? [event.payload.runtimeEvent] : []) as RuntimeEventV1[];
  const file = await (await WorkspaceSandbox.create(root)).read('source.txt', 256 * 1024);
  const effect = { changedPaths: [], workspaceRevision: null, artifactRefs: [] };
  // Public trace fixture uses an actual native source revision. Model quality is
  // not tested here; the independently recorded canonical lifecycle is real.
  const record: Omit<ReturnType<VerificationRuntimeFacts['all']>[number], 'trace'> & { trace?: Array<{ type: string; sequence: number; at: string; data: unknown }> } = { spec: scope, status: 'completed', events, trace: [
    { type: 'tool.started', sequence: 1, at: P107_SCHEMA, data: { call: { callId: 'read-1', name: 'read', arguments: { path: 'source.txt' } } } },
    { type: 'tool.completed', sequence: 2, at: P107_SCHEMA, data: { callId: 'read-1', result: { status: 'success', effects: effect, output: [{ kind: 'json', value: { path: file.path, revision: file.revision, startLine: 1, endLine: 1 } }] } } },
    { type: 'assistant.message_completed', sequence: 3, at: P107_SCHEMA, data: { toolCalls: [], message: { content: 'Observed current source; this report does not certify task completion.' } } },
  ] };
  let mutate = (snapshot: AggregateSnapshot): AggregateSnapshot => snapshot;
  const ledger = Object.create(h.ledger) as typeof h.ledger;
  ledger.load = async ref => { const value = await h.ledger.load(ref); return value.status === 'found' ? { ...value, snapshot: mutate(structuredClone(value.snapshot)) } : value; };
  const reads = new ReadonlyReadWitnessReader(() => root);
  const context = new VerificationContextCompiler({ ledger, vault: h.vault, runtime: { all: () => [structuredClone(record)] }, rootFor: () => root,
    roundSource: new VerificationWorkspaceReader(), readonlyReads: reads });
  const identity = async (): Promise<VerificationRoundMaterialIdentity> => { const result = await context.resolveRound(scope); expect(result.status, JSON.stringify(result)).toBe('ready'); if (result.status !== 'ready') throw Error('missing round'); return result.material.identity; };
  return { root, h, record, context, reads, scope, identity, mutate: (f: typeof mutate) => { mutate = f; } };
}

it('returns exact public report and current native read witness without assigning quality, permits host effects', async () => {
  const s = await world(), expected = await s.identity(), before = await s.h.ledger.events({ afterCursor: null, limit: 1000 });
  expect(await s.context.readonlyReport(s.scope, expected)).toMatchObject({ status: 'ready', report: 'Observed current source; this report does not certify task completion.', sourceReads: [{ path: 'source.txt', callId: 'read-1' }], workspaceEffects: 'none' });
  s.record.trace!.splice(2, 0,
    { type: 'tool.started', sequence: 3, at: P107_SCHEMA, data: { call: { callId: 'host-1', name: 'coordination_wait' } } },
    { type: 'tool.completed', sequence: 4, at: P107_SCHEMA, data: { callId: 'host-1', result: { status: 'success', effects: { changedPaths: [] }, output: [] } } });
  s.record.trace!.at(-1)!.sequence = 5;
  expect(await s.context.readonlyReport(s.scope, expected)).toMatchObject({ status: 'ready', observedTools: ['coordination_wait', 'read'], workspaceEffects: 'none' });
  s.record.trace!.pop();
  expect(await s.context.readonlyReport(s.scope, expected)).toMatchObject({ status: 'ready', report: null });
  expect(await s.h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
});

it('refuses stale read versions even with a newly captured round and rejects forbidden paths and fabricated terminal facts', async () => {
  const s = await world(), original = await s.identity();
  await writeFile(join(s.root, 'source.txt'), 'changed since model read\n');
  expect((await s.context.readonlyReport(s.scope, original)).status).toBe('rejected');
  const current = await s.identity();
  expect(await s.context.readonlyReport(s.scope, current)).toMatchObject({ status: 'rejected', issues: [expect.stringContaining('Read source revision')] });
  const result = s.record.trace![1]!.data as { result: { output: Array<{ value: { path: string } }> } };
  result.result.output[0]!.value.path = '../outside';
  expect((await s.context.readonlyReport(s.scope, current)).status).toBe('rejected');
  s.record.events!.at(-1)!.eventId = 'invented-terminal';
  expect(await s.context.readonlyReport(s.scope, current)).toMatchObject({ status: 'rejected', issues: [expect.stringContaining('terminal')] });
});

it('reports missing/uncertain workspace observations and rejects newer Task Run, Plan and Workspace versions', async () => {
  const s = await world(), expected = await s.identity();
  const saved = structuredClone(s.record);
  delete s.record.trace;
  expect((await s.context.readonlyReport(s.scope, expected)).status).toBe('incomplete');
  Object.assign(s.record, structuredClone(saved));
  (s.record.trace![0]!.data as { call: { name: string } }).call.name = 'shell';
  expect(await s.context.readonlyReport(s.scope, expected)).toMatchObject({ status: 'ready', workspaceEffects: 'unknown', sourceReads: [] });
  ((s.record.trace![1]!.data as { result: { effects: { changedPaths: string[] } } }).result.effects).changedPaths = ['source.txt'];
  expect(await s.context.readonlyReport(s.scope, expected)).toMatchObject({ status: 'ready', workspaceEffects: 'changed' });
  Object.assign(s.record, structuredClone(saved));
  s.mutate(snapshot => snapshot.ref.aggregateType === 'TaskLease' ? { ...snapshot, holderRunId: 'newer-run' } as AggregateSnapshot : snapshot);
  expect(await s.context.readonlyReport(s.scope, expected)).toMatchObject({ status: 'rejected', issues: [expect.stringContaining('latest')] });
  for (const aggregateType of ['PlanRevision', 'Workspace']) {
    s.mutate(snapshot => snapshot.ref.aggregateType === aggregateType ? { ...snapshot, revision: snapshot.revision + 1 } as AggregateSnapshot : snapshot);
    expect((await s.context.readonlyReport(s.scope, expected)).status).toBe('rejected');
  }
});

it('rechecks source and canonical bindings after witness I/O using an explicit mutation hook', async () => {
  const s = await world(), expected = await s.identity(), read = s.reads.assertCurrent.bind(s.reads);
  s.reads.assertCurrent = async (...args) => { const value = await read(...args); await writeFile(join(s.root, 'source.txt'), 'changed after witness capture\n'); return value; };
  expect((await s.context.readonlyReport(s.scope, expected)).status).toBe('rejected');
  await writeFile(join(s.root, 'source.txt'), 'current read source\n');
  s.reads.assertCurrent = async (...args) => { const value = await read(...args); s.mutate(snapshot => snapshot.ref.aggregateType === 'Workspace' ? { ...snapshot, revision: snapshot.revision + 1 } as AggregateSnapshot : snapshot); return value; };
  expect((await s.context.readonlyReport(s.scope, expected)).status).toBe('rejected');
});

it('distinguishes partial reads from complete current-file coverage including disjoint native ranges', async () => {
  const s = await world(), expected = await s.identity();
  const result = await s.context.readonlyReport(s.scope, expected);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error('missing report');
  expect(result.completeReadPaths).toEqual([]);
  const first = result.sourceReads[0]!;
  expect(await s.reads.assertCurrent(s.scope, [first, { ...first, callId: 'read-2', startLine: 2, endLine: 2 }])).toEqual({ completeReadPaths: ['source.txt'] });
  expect(await s.reads.assertCurrent(s.scope, [{ ...first, startLine: 2, endLine: 2 }])).toEqual({ completeReadPaths: [] });
  const value = s.record.trace![1]!.data as { result: { output: Array<{ value: { endLine: number } }> } };
  value.result.output[0]!.value.endLine = 2;
  expect(await s.context.readonlyReport(s.scope, expected)).toMatchObject({ status: 'ready', completeReadPaths: ['source.txt'] });
});
