import { afterEach, expect, it } from 'vitest';
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
const at = '2026-09-24T00:00:00.000Z', projectId = 'replay-project', workspaceId = 'workspace-main';
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'trusted-human' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const schemas: RecordBackendSchemas = { ...GOAL_RECORD_SCHEMAS, events: [...GOAL_RECORD_SCHEMAS.events,
  { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }] };
const isProject = (row: ProjectSnapshot | WorkspaceSnapshot): row is ProjectSnapshot => row.ref.aggregateType === 'Project';
let seedNo = 0;
function scopeCommit(rows: Array<ProjectSnapshot | WorkspaceSnapshot>, previous: number | null): PreparedCommit {
  const n = ++seedNo, event = { eventId: 'scope-event-' + n, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at };
  return { identityKey: 'scope-seed-' + n, fingerprint: 'scope-seed-' + n,
    guards: rows.map(row => ({ refKey: canonicalRefKey(row.ref), expectedRevision: previous })),
    records: rows.map(row => isProject(row) ? encodeProjectSnapshot(row) : encodeWorkspaceSnapshot(row)),
    events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] };
}
const request = (goalId: string, requestId: string, objective = ' Original objective ') => ({
  meta: { requestId, expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
  input: { goalId, workspace: { projectId, workspaceId }, objective },
});
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function open(kind: 'memory' | 'sqlite') {
  if (kind === 'memory') return createInMemoryRecordBackend({ schemas }) as { records: GoalRecordTransactionPort; close(): Promise<void> };
  const dir = await mkdtemp(join(tmpdir(), 'next-r3a-replay-')); dirs.push(dir);
  return createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas }) as
    { records: GoalRecordTransactionPort; close(): Promise<void> };
}
it.each(['memory', 'sqlite'] as const)('%s: replay restores the original Goal event/cursor before stale scope pins are checked', async kind => {
  const backend = await open(kind);
  try {
    expect(await backend.records.commit(scopeCommit([project, workspace], null))).toMatchObject({ status: 'committed' });
    let number = 0;
    const goals = createGoalService({ records: backend.records, now: () => at, eventId: () => 'goal-event-' + ++number }).tasks;
    const first = await goals.createGoal(ctx, request('goal-one', 'same-request'));
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: { objective: 'Original objective' } });
    if (first.status !== 'committed') throw Error('Goal missing');
    expect(await backend.records.commit(scopeCommit([{ ...project, revision: 2 }, { ...workspace, revision: 2 }], 1)))
      .toMatchObject({ status: 'committed' });
    expect(await goals.createGoal(ctx, request('goal-one', 'same-request'))).toMatchObject({ status: 'committed',
      replayed: true, cursor: first.cursor, value: { objective: 'Original objective', revision: 1 } });
    const recorded = await backend.records.eventAt(first.cursor);
    expect(recorded).toMatchObject({ status: 'ready', value: { event: { eventId: 'goal-event-1' } } });
    if (recorded.status !== 'ready') throw Error('original Goal event missing');
    expect(JSON.parse(recorded.value.event.json)).toMatchObject({ payload: { objective: 'Original objective' } });
    expect(await goals.createGoal(ctx, request('goal-one', 'same-request', 'changed')))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await goals.createGoal(ctx, request('new-goal', 'new-request')))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  } finally { await backend.close(); }
});
it.each(['memory', 'sqlite'] as const)('%s: Goal input is owned before the first lookup and uncloneable input never reaches storage', async kind => {
  const backend = await open(kind);
  try {
    expect(await backend.records.commit(scopeCommit([project, workspace], null))).toMatchObject({ status: 'committed' });
    let release!: () => void, seen!: () => void, lookups = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { seen = resolve; });
    const records: GoalRecordTransactionPort = {
      lookupCommit: async input => { lookups++; seen(); await gate; return backend.records.lookupCommit(input); },
      readMany: keys => backend.records.readMany(keys), commit: input => backend.records.commit(input),
      eventAt: cursor => backend.records.eventAt(cursor),
    };
    const goals = createGoalService({ records, now: () => at, eventId: () => 'owned-event' }).tasks;
    const input = request('original-goal', 'owned-request');
    const pending = goals.createGoal(ctx, input);
    await entered;
    input.input.goalId = 'redirected-goal'; input.input.objective = 'mutated'; input.meta.expected[0]!.revision = 999;
    release();
    expect(await pending).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: { goalId: 'original-goal' }, objective: 'Original objective' } });
    expect(await backend.records.readMany([canonicalRefKey({ aggregateType: 'Goal', projectId, goalId: 'redirected-goal' })]))
      .toMatchObject({ status: 'ready', value: { records: [], missing: [
        canonicalRefKey({ aggregateType: 'Goal', projectId, goalId: 'redirected-goal' }),
      ] } });
    const before = lookups;
    const bad = { ...request('bad-goal', 'bad-request'), extra: () => 'cannot clone' };
    expect(await goals.createGoal(ctx, bad)).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(lookups).toBe(before);
  } finally { await backend.close(); }
});
