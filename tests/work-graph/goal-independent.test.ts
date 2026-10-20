import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'independent-project';
const workspaceId = 'workspace-main';
const schemas: RecordBackendSchemas = { records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_RECORD_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...PLAN_RECORD_SCHEMAS.lookups] };
const actor = { kind: 'human' as const, id: 'trusted-host' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const request = (expected: readonly VersionPin[], requestId: string, objective = 'Independent goal') => ({
  meta: { requestId, expected },
  input: { goalId: 'new-goal', workspace: { projectId, workspaceId }, objective },
});
const temporary: string[] = [];
afterEach(async () => { for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true }); });

it.each(['memory', 'sqlite'] as const)('%s: Goal creation uses only the new Store transaction, including exact replay and conflict', async kind => {
  let backend: { records: GoalRecordTransactionPort & RecordLookupPort; close(): Promise<void> };
  if (kind === 'memory') backend = createInMemoryRecordBackend({ schemas });
  else {
    const dir = await mkdtemp(join(tmpdir(), 'next-goal-independent-'));
    temporary.push(dir);
    backend = createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas });
  }
  try {
    let seedSequence = 0;
    const bootstrap = createProjectBootstrapServices({ records: backend.records, now: () => at,
      eventId: () => 'scope-seed-event-' + ++seedSequence });
    const project = await bootstrap.projects.createProject(ctx, { input: { projectId },
      meta: { requestId: 'create-project', expected: [{ ref: { aggregateType: 'Project', projectId }, revision: 0 }] } });
    expect(project).toMatchObject({ status: 'committed', replayed: false });
    if (project.status !== 'committed') throw Error('project seed failed: ' + project.reason);
    const workspace = await bootstrap.projects.registerWorkspace(ctx, { input: { workspace: { projectId, workspaceId } },
      meta: { requestId: 'register-workspace', expected: [
        { ref: project.value.ref, revision: project.value.revision },
        { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 0 }] } });
    expect(workspace).toMatchObject({ status: 'committed', replayed: false });
    if (workspace.status !== 'committed') throw Error('workspace seed failed: ' + workspace.reason);
    const pins = [
      { ref: project.value.ref, revision: project.value.revision },
      { ref: workspace.value.ref, revision: workspace.value.revision },
    ] as const;
    let sequence = 0;
    const goal = createGoalService({ records: backend.records, now: () => at, eventId: () => 'goal-event-' + ++sequence });
    const first = await goal.tasks.createGoal(ctx, request(pins, 'create-goal'));
    expect(first).toMatchObject({ status: 'committed', replayed: false,
      value: { ref: { aggregateType: 'Goal', projectId, goalId: 'new-goal' },
        // The registerWorkspace input above: { workspace: { projectId, workspaceId } }.
        workspaceRef: { aggregateType: 'Workspace', projectId, workspaceId },
        objective: 'Independent goal', revision: 1 } });
    const replay = await goal.tasks.createGoal(ctx, request(pins, 'create-goal'));
    expect(replay).toMatchObject({ status: 'committed', replayed: true, value: first.status === 'committed' ? first.value : {} });
    expect(await goal.tasks.createGoal(ctx, request(pins, 'create-goal', 'Changed objective')))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await goal.tasks.createGoal(ctx, request(pins, 'another-request')))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await goal.tasks.createGoal({ ...ctx, workspaceId: 'other-workspace' }, request(pins, 'forged-scope')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    const plans = createPlanService({ records: backend.records, now: () => at, eventId: () => 'goal-event-' + ++sequence });
    expect(await plans.queryGoal(ctx, { aggregateType: 'Goal', projectId, goalId: 'new-goal' }))
      .toMatchObject({ status: 'ready', value: { goal: { ref: { aggregateType: 'Goal', projectId, goalId: 'new-goal' }, revision: 1 } } });
    if (first.status !== 'committed') throw Error('created Goal missing');
    expect(await backend.records.eventAt(first.cursor)).toMatchObject({ status: 'ready',
      value: { event: { eventType: 'GoalCreated', eventId: expect.stringContaining('goal-event-') } } });
    expect(Object.keys(backend).sort()).toEqual(['close', 'records']);
  } finally { await backend.close(); }
});
