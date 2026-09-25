import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'transaction-project';
const workspaceId = 'workspace-main';
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'trusted-host' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const schemas: RecordBackendSchemas = { ...GOAL_RECORD_SCHEMAS, events: [...GOAL_RECORD_SCHEMAS.events,
  { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }] };
const event = { eventId: 'trusted-scope-event', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at };
const scopeSeed: PreparedCommit = { identityKey: 'trusted-scope-seed', fingerprint: 'trusted-scope-seed',
  guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
    { refKey: canonicalRefKey(workspace.ref), expectedRevision: null }],
  records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)],
  events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] };
const request = (goalId: string, requestId = goalId) => ({
  meta: { requestId, expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
  input: { goalId, workspace: { projectId, workspaceId }, objective: 'Record exactly once' },
});
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function open(kind: 'memory' | 'sqlite', beforeWrite?: () => void) {
  if (kind === 'memory') return { backend: createInMemoryRecordBackend({ schemas, ...(beforeWrite ? { beforeWrite } : {}) }) as
    { records: GoalRecordTransactionPort; close(): Promise<void> }, path: null };
  const dir = await mkdtemp(join(tmpdir(), 'next-r3a-transaction-'));
  dirs.push(dir);
  const path = join(dir, 'ledger.sqlite');
  return { backend: createSqliteRecordBackend({ schemas, path, ...(beforeWrite ? { beforeWrite } : {}) }) as
    { records: GoalRecordTransactionPort; close(): Promise<void> }, path };
}

it.each(['memory', 'sqlite'] as const)('%s: beforeWrite belongs only to a real Goal write and receipts cannot mutate storage', async kind => {
  let calls = 0;
  const { backend } = await open(kind, () => { calls++; });
  try {
    expect(await backend.records.commit(scopeSeed)).toMatchObject({ status: 'committed' });
    calls = 0;
    let eventNo = 0;
    const goals = createGoalService({ records: backend.records, now: () => at, eventId: () => 'goal-event-' + ++eventNo }).tasks;
    const first = await goals.createGoal(ctx, request('goal-one'));
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    expect(calls).toBe(1);
    expect(await goals.createGoal(ctx, request('goal-one'))).toMatchObject({ status: 'committed', replayed: true });
    expect(await goals.createGoal(ctx, request('goal-one', 'different-id')))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(calls).toBe(1);
    if (first.status !== 'committed') throw Error('Goal was not created');
    const key = canonicalRefKey(first.value.ref);
    first.value.objective = 'caller rewrote the returned value';
    first.value.workspaceRef.workspaceId = 'caller-replaced-workspace';
    const replay = await goals.createGoal(ctx, request('goal-one'));
    expect(replay).toMatchObject({ status: 'committed', replayed: true,
      value: { objective: 'Record exactly once', workspaceRef: workspace.ref }, cursor: first.cursor });
    expect(await backend.records.eventAt(first.cursor)).toMatchObject({ status: 'ready',
      value: { event: { eventId: 'goal-event-1' } } });
    expect(await backend.records.readMany([key])).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: key, revision: 1 }] } });
    expect(calls).toBe(1);
  } finally { await backend.close(); }
});

it.each(['snapshot', 'idempotency'] as const)('SQLite rolls back a Goal write when the %s insert fails after earlier writes', async stage => {
  const { backend, path } = await open('sqlite');
  if (!path) throw Error('SQLite path missing');
  const observer = new DatabaseSync(path);
  try {
    expect(await backend.records.commit(scopeSeed)).toMatchObject({ status: 'committed' });
    const goalId = 'rollback-' + stage;
    const key = canonicalRefKey({ aggregateType: 'Goal', projectId, goalId });
    const marker = 'r3a-injected-' + stage;
    const sqlLiteral = (value: string) => "'" + value.replaceAll("'", "''") + "'";
    observer.exec(stage === 'snapshot'
      ? `CREATE TRIGGER reject_goal BEFORE INSERT ON snapshots WHEN NEW.ref_key=${sqlLiteral(key)} BEGIN SELECT RAISE(ABORT,${sqlLiteral(marker)}); END;`
      : `CREATE TRIGGER reject_goal BEFORE INSERT ON idempotency WHEN NEW.identity_key LIKE 'goal-create:%' BEGIN SELECT RAISE(ABORT,${sqlLiteral(marker)}); END;`);
    const counts = () => ['events', 'snapshots', 'idempotency'].map(table =>
      Number(observer.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!['n']));
    const before = counts();
    let eventNo = 0;
    const goals = createGoalService({ records: backend.records, now: () => at, eventId: () => 'rollback-event-' + ++eventNo }).tasks;
    await expect(goals.createGoal(ctx, request(goalId))).rejects.toThrow(marker);
    expect(counts()).toEqual(before);
    expect(await backend.records.readMany([key])).toMatchObject({ status: 'ready', value: { missing: [key] } });
    observer.exec('DROP TRIGGER reject_goal');
    expect(await goals.createGoal(ctx, request(goalId))).toMatchObject({ status: 'committed', replayed: false });
    expect(counts()).toEqual([before[0]! + 1, before[1]! + 1, before[2]! + 1]);
  } finally { observer.close(); await backend.close(); }
});

it('SQLite rejects a same-revision scope identity change made after the Goal pre-read', async () => {
  const { backend, path } = await open('sqlite');
  if (!path) throw Error('SQLite path missing');
  const observer = new DatabaseSync(path);
  try {
    expect(await backend.records.commit(scopeSeed)).toMatchObject({ status: 'committed' });
    let release!: () => void;
    let seen!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const observed = new Promise<void>(resolve => { seen = resolve; });
    const records: GoalRecordTransactionPort = {
      readMany: async keys => { const value = await backend.records.readMany(keys); seen(); await gate; return value; },
      lookupCommit: input => backend.records.lookupCommit(input),
      commit: input => backend.records.commit(input),
      eventAt: cursor => backend.records.eventAt(cursor),
    };
    const goals = createGoalService({ records, now: () => at, eventId: () => 'tamper-goal-event' }).tasks;
    const pending = goals.createGoal(ctx, request('tamper-goal'));
    await observed;
    const key = canonicalRefKey(workspace.ref);
    observer.prepare('UPDATE snapshots SET snapshot_json = ? WHERE ref_key = ?').run(
      JSON.stringify({ ref: { ...workspace.ref, workspaceId: 'other-workspace' }, revision: 1 }), key);
    const before = Number(observer.prepare('SELECT COUNT(*) AS n FROM events').get()!['n']);
    release();
    expect(await pending).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(Number(observer.prepare('SELECT COUNT(*) AS n FROM events').get()!['n'])).toBe(before);
    expect(await backend.records.readMany([canonicalRefKey({ aggregateType: 'Goal', projectId, goalId: 'tamper-goal' })]))
      .toMatchObject({ status: 'ready', value: { records: [] } });
  } finally { observer.close(); await backend.close(); }
});
