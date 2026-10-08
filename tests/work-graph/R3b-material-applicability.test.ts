import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas, EncodedRecord } from '../../src/core/record-store/ports.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { materialRecordSchemas, createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';

type Snapshot = GoalSnapshot | WorkspaceSnapshot | RunSnapshot | QueryRunSnapshot;
type Backend = { records: GoalRecordTransactionPort; close(): Promise<void> };
const at = '2026-09-24T00:00:00.000Z', projectId = 'material-project';
const targetWorkspace = 'workspace-target', sourceWorkspace = 'workspace-source';
const targetGoal = 'goal-target', sourceGoal = 'goal-source';
const actor = { kind: 'human' as const, id: 'trusted-reviewer' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'binding', templateId: 'worker', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const workspace = (workspaceId: string): WorkspaceSnapshot => ({ ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 });
const goal = (goalId: string, workspaceId: string): GoalSnapshot => ({ ref: { aggregateType: 'Goal', projectId, goalId },
  workspaceRef: workspace(workspaceId).ref, objective: 'Preserve material scope', desiredState: 'active', activePlanRevision: null, revision: 1 });
const runRef = (goalId: string, runId: string): RunRef => ({ aggregateType: 'Run', projectId, goalId, runId });
function run(ref: RunRef, workspaceId: string): RunSnapshot {
  return { ref, revision: 1, schemaVersion: 1, task: { projectId, goalId: ref.goalId, taskId: 'task-1' },
    attemptId: 'attempt-1', planRef: { aggregateType: 'PlanRevision', projectId, planId: 'plan-1' },
    roleBinding, budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId, revision: 1 },
    status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
    envelope: null, startedAt: null, endedAt: null };
}
const queryRef = (queryJobId: string): QueryRunRef => ({ aggregateType: 'QueryRun', projectId,
  workspaceId: targetWorkspace, queryJobId, runId: 'query-run' });
function queryRun(ref: QueryRunRef): QueryRunSnapshot {
  const queryJobRef = { aggregateType: 'QueryJob' as const, projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId };
  return { ref, revision: 1, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef, runId: ref.runId,
    status: 'pending', startedAt: null, endedAt: null, outcome: null } };
}
const key = (ref: Snapshot['ref']) => canonicalJson(ref as unknown as JsonValue);
const encode = (row: Snapshot): EncodedRecord => ({ refKey: key(row.ref),
  schemaId: row.ref.aggregateType + 'Snapshot@1', revision: row.revision, json: JSON.stringify(row) });
let seedNo = 0;
function seedCommit(rows: Snapshot[]): PreparedCommit {
  const n = ++seedNo, event = { eventId: 'material-seed-event-' + n, eventType: 'MaterialFixtureSeeded', schemaVersion: 1, occurredAt: at };
  return { identityKey: 'material-seed-' + n, fingerprint: 'material-seed-' + n,
    guards: rows.map(row => ({ refKey: key(row.ref), expectedRevision: null })), records: rows.map(encode),
    events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] };
}
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function open(kind: 'memory' | 'sqlite'): Promise<Backend> {
  const registered = materialRecordSchemas();
  const schemas: RecordBackendSchemas = { ...registered, events: [...registered.events,
    { eventType: 'MaterialFixtureSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }] };
  if (kind === 'memory') return createInMemoryRecordBackend({ schemas });
  const dir = await mkdtemp(join(tmpdir(), 'next-r3b-applicability-')); dirs.push(dir);
  return createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas });
}
async function bodyFor(owner: RunRef, body: string) {
  const bodies = new RawArtifactBodyStore();
  const stored = await bodies.put({ body, contentType: 'text/plain',
    sourceRefs: [{ kind: 'workspace', refId: sourceWorkspace, revision: '1' }],
    origin: { kind: 'run', owner }, requestedAt: at });
  if (stored.status !== 'ready') throw Error('raw body unavailable');
  return { bodies, ref: stored.value.ref };
}
const queryCtx = (reader: QueryRunRef): CoreCallContext => ({ projectId, workspaceId: targetWorkspace,
  principal: { kind: 'query_run', queryRunRef: reader, initiator: actor },
  materialReader: { kind: 'run', requester: reader }, signal: new AbortController().signal });
const workCtx = (reader: RunRef, workspaceId: string): CoreCallContext => ({ projectId, workspaceId,
  principal: { kind: 'work_run', runRef: reader, roleBinding },
  materialReader: { kind: 'run', requester: reader }, signal: new AbortController().signal });

// Material grants were deleted (decision 34): no recorded grant can share a
// Run's material, so a Run or QueryRun reader opens only its own, never for current use.
it.each(['memory', 'sqlite'] as const)('%s: a Run or QueryRun reader opens only its own material, and not for current use', async kind => {
  const store = await open(kind);
  try {
    const owner = runRef(sourceGoal, 'source-run');
    const otherRun = runRef(targetGoal, 'reader-run');
    const reader = queryRef('query-1');
    const { bodies, ref } = await bodyFor(owner, 'historical source material');
    expect(await store.records.commit(seedCommit([workspace(sourceWorkspace), workspace(targetWorkspace),
      goal(sourceGoal, sourceWorkspace), goal(targetGoal, targetWorkspace), run(owner, sourceWorkspace),
      run(otherRun, targetWorkspace), queryRun(reader)]))).toMatchObject({ status: 'committed', replayed: false });
    const reads = createMaterialRecordReaders(store.records);
    const materials = createMaterialService({ bodies, authority: reads.authority, now: () => at });
    const historical = { ref, usage: 'historical_explanation' as const };
    expect(await materials.openArtifact(workCtx(owner, sourceWorkspace), historical))
      .toMatchObject({ status: 'ready', value: { body: 'historical source material', applicability: 'historical_explanation' } });
    expect(await materials.openArtifact(workCtx(owner, sourceWorkspace), { ref, usage: 'current' }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await materials.openArtifact(queryCtx(reader), historical)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await materials.openArtifact(workCtx(otherRun, targetWorkspace), historical))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  } finally { await store.close(); }
});
