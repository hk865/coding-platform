import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createLineSettingsService } from '../../src/core/work-graph/configuration/line-settings-service.js';
import { LINE_SETTINGS_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/line-settings-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
const at = '2026-09-24T00:00:00.000Z', projectId = 'replay-project', workspaceId = 'workspace-main';
const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const actor = { kind: 'human' as const, id: 'trusted-human' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    ...LINE_SETTINGS_RECORD_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...(SESSION_RECORD_SCHEMAS.lookups ?? [])],
};
const request = (goalId: string, requestId: string, objective = ' Original objective ') => ({
  meta: { requestId, expected: [{ ref: project.ref, revision: 1 }, { ref: workspace.ref, revision: 1 }] },
  input: { goalId, workspace: { projectId, workspaceId }, objective },
});
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
type OpenedBackend = { records: GoalRecordTransactionPort & RecordLookupPort; close(): Promise<void> };
async function seedScope(records: GoalRecordTransactionPort): Promise<void> {
  let sequence = 0;
  const bootstrap = createProjectBootstrapServices({ records, now: () => at,
    eventId: () => `r3a-bootstrap-${++sequence}` });
  const created = await bootstrap.projects.createProject(ctx, { input: { projectId },
    meta: { requestId: 'r3a-create-project', expected: [{ ref: project.ref, revision: 0 }] } });
  if (created.status !== 'committed') throw Error(`Project creation failed: ${JSON.stringify(created)}`);
  const registered = await bootstrap.projects.registerWorkspace(ctx, {
    input: { workspace: { projectId, workspaceId } },
    meta: { requestId: 'r3a-register-workspace', expected: [
      { ref: created.value.ref, revision: created.value.revision }, { ref: workspace.ref, revision: 0 },
    ] } });
  if (registered.status !== 'committed') throw Error(`Workspace registration failed: ${JSON.stringify(registered)}`);
}
async function open(kind: 'memory' | 'sqlite'): Promise<OpenedBackend> {
  const backend = kind === 'memory' ? createInMemoryRecordBackend({ schemas }) : await (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'next-r3a-replay-')); dirs.push(dir);
    return createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas });
  })();
  const opened = backend as unknown as OpenedBackend;
  await seedScope(opened.records);
  return opened;
}
it.each(['memory', 'sqlite'] as const)('%s: replay restores the original Goal event/cursor before stale scope pins are checked', async kind => {
  const backend = await open(kind);
  try {
    let number = 0;
    const goals = createGoalService({ records: backend.records, now: () => at, eventId: () => 'goal-event-' + ++number }).tasks;
    const first = await goals.createGoal(ctx, request('goal-one', 'same-request'));
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: { objective: 'Original objective' } });
    if (first.status !== 'committed') throw Error('Goal missing');
    // The Workspace advances to revision 2 through real public steps: a real
    // Session via the Session Runtime entry, then the public line-pin owner adds
    // it. The Project stays at the revision createProject wrote.
    const kernelDir = await mkdtemp(join(tmpdir(), 'next-r3a-kernel-')); dirs.push(kernelDir);
    const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
    const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r3a-kernel',
      storeKey: 'r3a-kernel-store', workspace: { projectId, workspaceId },
      databasePath: join(kernelDir, 'kernel.sqlite') }] });
    const sessionRuntime = createSessionOperations({ sessions, kernelStores });
    const createdSession = await sessionRuntime.createSession(ctx, {
      workspace: { projectId, workspaceId },
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      recommendedRefs: [], initialLinks: [], meta: { requestId: 'r3a-create-session', expected: [] },
    });
    if (createdSession.status !== 'completed') throw Error(`Session creation failed: ${JSON.stringify(createdSession)}`);
    const sessionRef = { projectId: createdSession.value.ref.projectId,
      sessionId: createdSession.value.ref.sessionId };
    const lineSettings = createLineSettingsService({ records: backend.records,
      sessionRead: sessions.readSession.bind(sessions), now: () => at, operatorActor: actor });
    const pinned = await lineSettings.setLinePins(ctx, { input: {
      workspace: { projectId, workspaceId }, add: [sessionRef], remove: [],
    }, meta: { requestId: 'r3a-pin-session', expected: [{ ref: workspace.ref, revision: 1 }] } });
    if (pinned.status !== 'committed') throw Error(`setLinePins failed: ${JSON.stringify(pinned)}`);
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
