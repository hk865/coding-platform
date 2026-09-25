import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { GOAL_RECORD_SCHEMAS, encodeProjectSnapshot, encodeWorkspaceSnapshot, canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'independent-project';
const workspaceId = 'workspace-main';
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const seedEvent = { eventId: 'scope-seed-event', eventType: 'ScopeSeeded', schemaVersion: 1, occurredAt: at,
  json: JSON.stringify({ eventId: 'scope-seed-event', eventType: 'ScopeSeeded', schemaVersion: 1, occurredAt: at }) };
const schemas: RecordBackendSchemas = { records: GOAL_RECORD_SCHEMAS.records,
  events: [...GOAL_RECORD_SCHEMAS.events, { eventType: 'ScopeSeeded', schemaVersion: 1,
    validate: event => ({ status: 'decoded', value: event }) }] };
const seed: PreparedCommit = { identityKey: 'trusted-scope-seed', fingerprint: 'trusted-scope-seed-v1',
  guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
    { refKey: canonicalRefKey(workspace.ref), expectedRevision: null }],
  records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)], events: [seedEvent],
  claims: [], indexGuards: [], indexChanges: [] };
const actor = { kind: 'human' as const, id: 'trusted-host' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const request = (requestId: string, objective = 'Independent goal') => ({
  meta: { requestId, expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
  input: { goalId: 'new-goal', workspace: { projectId, workspaceId }, objective },
});
const temporary: string[] = [];
afterEach(async () => { for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true }); });

it.each(['memory', 'sqlite'] as const)('%s: Goal creation uses only the new Store transaction, including exact replay and conflict', async kind => {
  let backend: { records: GoalRecordTransactionPort; close(): Promise<void> };
  if (kind === 'memory') backend = createInMemoryRecordBackend({ schemas });
  else {
    const dir = await mkdtemp(join(tmpdir(), 'next-goal-independent-'));
    temporary.push(dir);
    backend = createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas });
  }
  try {
    expect(await backend.records.commit(seed)).toMatchObject({ status: 'committed', replayed: false });
    let sequence = 0;
    const goal = createGoalService({ records: backend.records, now: () => at, eventId: () => 'goal-event-' + ++sequence });
    const first = await goal.tasks.createGoal(ctx, request('create-goal'));
    expect(first).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: { aggregateType: 'Goal', projectId, goalId: 'new-goal' },
        workspaceRef: workspace.ref, objective: 'Independent goal', revision: 1 } });
    const replay = await goal.tasks.createGoal(ctx, request('create-goal'));
    expect(replay).toMatchObject({ status: 'committed', replayed: true, value: first.status === 'committed' ? first.value : {} });
    expect(await goal.tasks.createGoal(ctx, request('create-goal', 'Changed objective')))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await goal.tasks.createGoal(ctx, request('another-request')))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await goal.tasks.createGoal({ ...ctx, workspaceId: 'other-workspace' }, request('forged-scope')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    const goalKey = canonicalRefKey({ aggregateType: 'Goal', projectId, goalId: 'new-goal' });
    expect(await backend.records.readMany([goalKey])).toMatchObject({ status: 'ready',
      value: { records: [{ refKey: goalKey, revision: 1 }] } });
    if (first.status !== 'committed') throw Error('created Goal missing');
    expect(await backend.records.eventAt(first.cursor)).toMatchObject({ status: 'ready',
      value: { event: { eventType: 'GoalCreated', eventId: expect.stringContaining('goal-event-') } } });
    expect(Object.keys(backend).sort()).toEqual(['close', 'records']);
  } finally { await backend.close(); }
});
