import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import { materialRecordSchemas, createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';

type Snapshot = GoalSnapshot | WorkspaceSnapshot | RunSnapshot | QueryRunSnapshot;
type Backend = { records: GoalRecordTransactionPort; close(): Promise<void> };
const at = '2026-09-24T00:00:00.000Z';
const projectId = 'materials-project';
const workspaceId = 'workspace-main';
const goalId = 'materials-goal';
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const goal: GoalSnapshot = { ref: { aggregateType: 'Goal', projectId, goalId }, workspaceRef: workspace.ref,
  objective: 'Preserve the original material', desiredState: 'active', activePlanRevision: null, revision: 1 };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'p1' };
const runRef = (runId: string, project = projectId, goalName = goalId): RunRef =>
  ({ aggregateType: 'Run', projectId: project, goalId: goalName, runId });
function run(ref: RunRef, sourceWorkspace = workspaceId): RunSnapshot {
  return { ref, revision: 1, schemaVersion: 1, task: { projectId: ref.projectId, goalId: ref.goalId, taskId: 'task-1' },
    attemptId: 'attempt-1', planRef: { aggregateType: 'PlanRevision', projectId: ref.projectId, planId: 'plan-1' },
    roleBinding, budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId: sourceWorkspace, revision: 1 },
    status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
    envelope: null, startedAt: null, endedAt: null };
}
function queryRun(runId: string, workspaceName: string): QueryRunSnapshot {
  const queryJobRef = { aggregateType: 'QueryJob' as const, projectId, workspaceId: workspaceName, queryJobId: 'query-1' };
  return { ref: { aggregateType: 'QueryRun', projectId, workspaceId: workspaceName, queryJobId: 'query-1', runId },
    revision: 1, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef, runId, status: 'pending',
      startedAt: null, endedAt: null, outcome: null } };
}
const refKey = (ref: Snapshot['ref']) => canonicalJson(ref as unknown as JsonValue);
const encode = (snapshot: Snapshot): EncodedRecord => ({ refKey: refKey(snapshot.ref),
  schemaId: snapshot.ref.aggregateType + 'Snapshot@1', revision: snapshot.revision, json: JSON.stringify(snapshot) });
let nextSeed = 0;
function commitRows(rows: Snapshot[], priorRevision: number | null = null): PreparedCommit {
  const seedId = ++nextSeed;
  const event = { eventId: 'fixture-event-' + seedId, eventType: 'FixtureSeeded', schemaVersion: 1, occurredAt: at };
  return { identityKey: 'fixture-seed-' + seedId, fingerprint: 'fixture-seed-' + seedId,
    guards: rows.map(row => ({ refKey: refKey(row.ref), expectedRevision: priorRevision })),
    records: rows.map(encode), events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] };
}
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function backend(kind: 'memory' | 'sqlite'): Promise<Backend> {
  const materialSchemas = materialRecordSchemas();
  const schemas: RecordBackendSchemas = { ...materialSchemas, events: [...materialSchemas.events,
    { eventType: 'FixtureSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }] };
  if (kind === 'memory') return createInMemoryRecordBackend({ schemas }) as unknown as Backend;
  const dir = await mkdtemp(join(tmpdir(), 'next-material-readers-'));
  dirs.push(dir);
  return createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas }) as unknown as Backend;
}
async function seed(store: Backend, rows: Snapshot[], priorRevision: number | null = null): Promise<void> {
  expect(await store.records.commit(commitRows(rows, priorRevision))).toMatchObject({ status: 'committed', replayed: false });
}

it.each(['memory', 'sqlite'] as const)('%s: canonical material records use complete refs and returned values are isolated', async kind => {
  const store = await backend(kind);
  try {
    const owner = runRef('same-run');
    const otherProject = run(runRef('same-run', 'other-project'));
    const otherGoal = run(runRef('same-run', projectId, 'other-goal'));
    const firstQuery = queryRun('same-query', workspaceId);
    const secondQuery = queryRun('same-query', 'other-workspace');
    await seed(store, [workspace, goal, run(owner), otherProject, otherGoal, firstQuery, secondQuery]);
    const { authority } = createMaterialRecordReaders(store.records);
    for (const snapshot of [workspace, goal, run(owner), otherProject, otherGoal, firstQuery, secondQuery]) {
      expect(await authority.load(snapshot.ref)).toMatchObject({ status: 'found', snapshot });
    }
    expect(await authority.load(runRef('absent'))).toMatchObject({ status: 'not_found' });
    const first = await authority.load(owner);
    if (first.status !== 'found' || first.snapshot.ref.aggregateType !== 'Run') throw Error('Run missing');
    (first.snapshot as RunSnapshot).workspaceSnapshot.workspaceId = 'tampered';
    expect(await authority.load(owner)).toMatchObject({ status: 'found', snapshot: { workspaceSnapshot: { workspaceId } } });
  } finally { await store.close(); }
});
