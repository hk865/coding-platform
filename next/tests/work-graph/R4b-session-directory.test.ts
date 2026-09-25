/** R4b implementation acceptance against real Memory/SQLite stores. These
 * tests preserve durable identity, directory and link semantics across adapters. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { EncodedRecord, EncodedRecordSchema, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeGoalSnapshot, encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import type { GoalSnapshot, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';

const at = '2026-09-24T00:00:00.000Z';
const projectId = 'session-project';
const workspaceId = 'workspace-a';
const actor = { kind: 'human' as const, id: 'session-operator' };
const ctx: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
const workspace = { projectId, workspaceId };
const role = { kind: 'legacy_template' as const, templateId: 'implementer', templateRevision: '1' };
const policyFixture = { schemaVersion: 1, identity: { policyId: 'policy-1' }, revision: 1,
  content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
const architectureFixture = { schemaVersion: 1, identity: { baselineId: 'baseline-1' }, revision: 1,
  content: { schemaVersion: 1, description: 'Task fixture baseline', constraints: [] } };
const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'policy-1', revision: 1 };
const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const,
  projectId, baselineId: 'baseline-1', revision: 1 };
const governance = [
  { ref: policyRef, revision: 1, schemaVersion: 1, policyId: 'policy-1', contentRevision: 1,
    contentDigest: digest(policyFixture), content: policyFixture.content },
  { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: 'baseline-1', contentRevision: 1,
    contentDigest: digest(architectureFixture), content: architectureFixture.content },
  { ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId }, projectId,
    revision: 1, activeRevision: policyRef },
  { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId }, projectId,
    revision: 1, activeRevision: architectureRef },
];
const governanceSchemas: EncodedRecordSchema[] = governance.map(snapshot => ({
  aggregateType: snapshot.ref.aggregateType,
  schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
  validate: record => record.refKey === canonicalJson(snapshot.ref as JsonValue) &&
    record.schemaId === `${snapshot.ref.aggregateType}Snapshot@1`
    ? { status: 'decoded', value: record } : { status: 'invalid', reason: 'wrong governance prerequisite' },
}));
const encodeGovernance = (snapshot: (typeof governance)[number]): EncodedRecord => ({
  refKey: canonicalJson(snapshot.ref as JsonValue), schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
  revision: snapshot.revision, json: JSON.stringify(snapshot),
});
const creation = (requestId: string, kernelStore = { adapterId: 'workspace-kernel', storeKey: 'workspace-key' }) => ({
  input: { workspace, kernelStore, role, recommendedRefs: [], initialLinks: [] },
  meta: { requestId, expected: [] },
});
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...governanceSchemas,
    ...PLAN_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: SESSION_RECORD_SCHEMAS.lookups ?? [],
};
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function open(kind: 'memory' | 'sqlite') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'next-r4b-acceptance-'));
  directories.push(directory);
  const ledgerPath = path.join(directory, 'ledger.sqlite');
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ schemas, path: ledgerPath });
  const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
  const workspaceSnapshot: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
  const seedEvent = { eventId: 'session-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: at, json: JSON.stringify({ eventId: 'session-scope-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at }) };
  const seed: PreparedCommit = { identityKey: 'session-scope-seed', fingerprint: 'session-scope-seed',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
      { refKey: canonicalRefKey(workspaceSnapshot.ref), expectedRevision: null },
      ...governance.map(snapshot => ({ refKey: canonicalJson(snapshot.ref as JsonValue), expectedRevision: null }))],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspaceSnapshot),
      ...governance.map(encodeGovernance)],
    claims: [], indexGuards: [], indexChanges: [], events: [seedEvent] };
  const seeded = await backend.records.commit(seed);
  if (seeded.status !== 'committed') throw new Error(`scope seed failed: ${seeded.reason}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  return { backend, sessions, kernelStores, ledgerPath };
}

/** Seed the actual Goal → accepted immutable Plan relation used for Task links.
 * These records run through the registered Goal and Plan codecs. */
async function seedAcceptedTask(records: Awaited<ReturnType<typeof open>>['backend']['records']) {
  const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'goal-with-plan' };
  const planRef = { aggregateType: 'PlanRevision' as const, projectId, planId: 'accepted-plan' };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
  const firstGoal: GoalSnapshot = { ref: goalRef, workspaceRef, objective: 'Implement the accepted task',
    desiredState: 'active', activePlanRevision: null, revision: 1 };
  const initialEvent = { eventId: 'task-goal-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: at, json: JSON.stringify({ eventId: 'task-goal-seeded', eventType: 'TrustedScopeSeeded',
      schemaVersion: 1, occurredAt: at }) };
  const initial = await records.commit({ identityKey: 'task-goal-seed', fingerprint: 'task-goal-seed',
    guards: [{ refKey: canonicalRefKey(goalRef), expectedRevision: null }],
    records: [encodeGoalSnapshot(firstGoal)], events: [initialEvent], claims: [], indexGuards: [], indexChanges: [] });
  expect(initial.status).toBe('committed');
  const plan: PlanRevisionSnapshot = {
    ref: planRef, revision: 1, schemaVersion: 1, goalRef, planId: 'accepted-plan', planRevision: 1, acceptedAt: at,
    effectiveCompletionPolicy: { ref: policyRef, digest: digest(policyFixture) },
    effectiveArchitectureBaseline: { ref: architectureRef, digest: digest(architectureFixture) },
    stages: [],
    tasks: [{ taskId: 'implement', title: 'Implement', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [{ taskId: 'implement', role: 'builder', instruction: 'Implement the accepted work' }],
    obligations: [{ obligationId: 'obligation-1', title: 'Deliver implementation', requirementLevel: 'required',
      taskIds: ['implement', 'goal-gate'], verificationRequirements: [{ requirementId: 'check-1',
        requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  };
  const acceptedGoal: GoalSnapshot = { ...firstGoal, activePlanRevision: planRef, revision: 2 };
  const planKey = canonicalJson(planRef as JsonValue);
  const planEvent = { eventId: 'accepted-task-plan-seeded', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: at, json: JSON.stringify({ eventId: 'accepted-task-plan-seeded', eventType: 'TrustedScopeSeeded',
      schemaVersion: 1, occurredAt: at }) };
  const accepted = await records.commit({ identityKey: 'accepted-task-plan-seed', fingerprint: 'accepted-task-plan-seed',
    guards: [{ refKey: canonicalRefKey(goalRef), expectedRevision: 1 }, { refKey: planKey, expectedRevision: null }],
    records: [encodeGoalSnapshot(acceptedGoal), { refKey: planKey, schemaId: 'PlanRevisionSnapshot@1',
      revision: 1, json: JSON.stringify(plan) }], events: [planEvent], claims: [], indexGuards: [], indexChanges: [] });
  expect(accepted.status).toBe('committed');
  return { goalRef, planRef, taskRef: { projectId, goalId: goalRef.goalId, taskId: 'implement' } };
}

describe.each(['memory', 'sqlite'] as const)('R4b real %s RecordStore acceptance', kind => {
  it('durably admits one planned identity and restores the original on request replay', async () => {
    const { backend, sessions } = await open(kind);
    try {
      const first = await sessions.admitSessionCreation(ctx, creation('same-request'));
      expect(first.status).toBe('committed');
      if (first.status !== 'committed') return;
      expect(first.value.phase).toBe('accepted');
      expect(first.value.action.plannedSessionRef.projectId).toBe(projectId);
      expect(first.value.action.kernelStore).toEqual({ adapterId: 'workspace-kernel', storeKey: 'workspace-key' });
      // A Host route change after admission cannot move the durable operation.
      const replay = await sessions.admitSessionCreation(ctx, creation('same-request',
        { adapterId: 'replacement-kernel', storeKey: 'replacement-key' }));
      expect(replay).toMatchObject({ status: 'committed', replayed: true,
        value: { ref: first.value.ref, action: { plannedSessionRef: first.value.action.plannedSessionRef,
          kernelStore: { adapterId: 'workspace-kernel', storeKey: 'workspace-key' } } } });
      expect(await sessions.readSession(ctx, first.value.action.plannedSessionRef)).toEqual({ status: 'not_found' });
    } finally { await backend.close(); }
  });

  it('registers one Kernel mapping under concurrent competing platform operations', async () => {
    const { backend, sessions, kernelStores } = await open(kind);
    try {
      const a = await sessions.admitSessionCreation(ctx, creation('competing-a'));
      const b = await sessions.admitSessionCreation(ctx, creation('competing-b'));
      expect(a.status).toBe('committed');
      expect(b.status).toBe('committed');
      if (a.status !== 'committed' || b.status !== 'committed') return;
      expect(await sessions.recordSessionCreated(ctx, { meta: { requestId: 'wrong-adapter', expected: [] }, input: {
        operationRef: a.value.ref, sessionRef: a.value.action.plannedSessionRef,
        adapterId: 'replacement-kernel', kernelSessionId: 'fixed-shared-kernel-id',
        historyCursor: null, observedAt: at,
      } })).toMatchObject({ status: 'rejected', code: 'invalid' });
      const kernelSessionId = 'fixed-shared-kernel-id';
      await kernelStores.withStore('workspace-kernel', store => store.create({
        sessionId: kernelSessionId, recordId: 'fixed-shared-created-id', createdAt: at,
      }, { signal: ctx.signal }));
      const register = (admission: typeof a, requestId: string) => {
        if (admission.status !== 'committed') throw Error('test requires a committed admission');
        return sessions.recordSessionCreated(ctx, { meta: { requestId, expected: [] }, input: {
          operationRef: admission.value.ref,
          sessionRef: admission.value.action.plannedSessionRef,
          adapterId: 'workspace-kernel', kernelSessionId, historyCursor: null, observedAt: at,
        } });
      };
      const results = await Promise.all([register(a, 'register-a'), register(b, 'register-b')]);
      expect(results.filter(result => result.status === 'committed')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    } finally { await backend.close(); }
  });

  it('binds a directory page cursor to the original filters and project workspace scope', async () => {
    const { backend, sessions } = await open(kind);
    try {
      for (const n of [1, 2]) {
        const admitted = await sessions.admitSessionCreation(ctx, creation(`page-${n}`));
        expect(admitted.status).toBe('committed');
        if (admitted.status !== 'committed') return;
        const registered = await sessions.recordSessionCreated(ctx, { meta: { requestId: `register-page-${n}`, expected: [] }, input: {
          operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
          adapterId: 'workspace-kernel', kernelSessionId: `kernel-page-${n}`, historyCursor: null, observedAt: at,
        } });
        expect(registered.status).toBe('committed');
      }
      const first = await sessions.findSessions(ctx, { workspace, includeArchived: false, page: { limit: 1 } });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.items).toHaveLength(1);
      expect(first.value.nextCursor).not.toBeNull();
      const wrongFilter = await sessions.findSessions(ctx, { workspace, includeArchived: true,
        page: { limit: 1, cursor: first.value.nextCursor! } });
      expect(wrongFilter.status).toBe('rejected');
      const wrongScope = await sessions.findSessions({ ...ctx, workspaceId: 'workspace-b' }, {
        workspace: { projectId, workspaceId: 'workspace-b' }, includeArchived: false,
        page: { limit: 1, cursor: first.value.nextCursor! },
      });
      expect(wrongScope.status).toBe('rejected');
    } finally { await backend.close(); }
  });

  it('binds an initial work link to the actual Session registration commit cursor', async () => {
    const { backend, sessions } = await open(kind);
    try {
      const { taskRef } = await seedAcceptedTask(backend.records);
      const linked = { ...creation('initial-link'), input: { ...creation('initial-link').input,
        initialLinks: [{ target: { kind: 'task' as const, ref: taskRef },
          relation: 'responsible' as const }] } };
      const admitted = await sessions.admitSessionCreation(ctx, linked);
      expect(admitted.status).toBe('committed');
      if (admitted.status !== 'committed') return;
      const registered = await sessions.recordSessionCreated(ctx, { meta: { requestId: 'register-initial-link', expected: [] }, input: {
        operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 'workspace-kernel', kernelSessionId: 'linked-kernel-id', historyCursor: null, observedAt: at,
      } });
      expect(registered.status).toBe('committed');
      if (registered.status !== 'committed') return;
      const card = await sessions.readSession(ctx, admitted.value.action.plannedSessionRef);
      expect(card.status).toBe('ready');
      if (card.status !== 'ready') return;
      expect(card.value.links).toHaveLength(1);
      expect(card.value.links[0]?.since).toBe(registered.cursor);
      expect(card.value.links[0]?.until).toBeNull();
    } finally { await backend.close(); }
  });

  it('rejects a Task link absent from the active accepted Plan', async () => {
    const { backend, sessions } = await open(kind);
    try {
      const { taskRef } = await seedAcceptedTask(backend.records);
      const missing = { ...creation('missing-task-link'), input: { ...creation('missing-task-link').input,
        initialLinks: [{ target: { kind: 'task' as const, ref: { ...taskRef, taskId: 'not-in-plan' } },
          relation: 'responsible' as const }] } };
      const admitted = await sessions.admitSessionCreation(ctx, missing);
      if (admitted.status === 'rejected') {
        expect(['not_found', 'dependency_blocked', 'invalid']).toContain(admitted.code);
        return;
      }
      const registered = await sessions.recordSessionCreated(ctx, { meta: { requestId: 'register-missing-task-link', expected: [] }, input: {
        operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 'workspace-kernel', kernelSessionId: 'kernel-missing-task', historyCursor: null, observedAt: at,
      } });
      expect(registered.status).toBe('rejected');
      expect(await sessions.readSession(ctx, admitted.value.action.plannedSessionRef)).toEqual({ status: 'not_found' });
    } finally { await backend.close(); }
  });

  it.each([
    { kind: 'module' as const, ref: { projectId, moduleId: 'module-without-provider' } },
    { kind: 'work' as const, ref: { aggregateType: 'WorkContextBinding' as const,
      projectId, workspaceId, workId: 'work-without-provider' } },
  ])('does not activate a $kind link without an available canonical target', async target => {
    const { backend, sessions } = await open(kind);
    try {
      const request = { ...creation(`unsupported-${target.kind}`), input: { ...creation(`unsupported-${target.kind}`).input,
        initialLinks: [{ target, relation: 'responsible' as const }] } };
      const admitted = await sessions.admitSessionCreation(ctx, request);
      if (admitted.status === 'rejected') {
        expect(admitted.code).toBe(target.kind === 'module' ? 'not_found' : 'unsupported');
        return;
      }
      const registered = await sessions.recordSessionCreated(ctx, { meta: { requestId: `register-unsupported-${target.kind}`, expected: [] }, input: {
        operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 'workspace-kernel', kernelSessionId: `kernel-${target.kind}`, historyCursor: null, observedAt: at,
      } });
      // A1 supplies the module provider; an unadopted module is now absent.
      // WorkContext still has no producer/provider and remains unsupported.
      expect(registered).toMatchObject({ status: 'rejected', code: target.kind === 'module' ? 'not_found' : 'unsupported' });
      expect(await sessions.readSession(ctx, admitted.value.action.plannedSessionRef)).toEqual({ status: 'not_found' });
    } finally { await backend.close(); }
  });
});
