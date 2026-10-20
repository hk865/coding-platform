/** R4b implementation acceptance against real Memory/SQLite stores. These
 * tests preserve durable identity, directory and link semantics across adapters. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { GOAL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';

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
const policyContent = { schemaVersion: 1 as const, requirementKinds: ['test'],
  minimumRequiredRequirementsPerObligation: 1 };
const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'policy-1', revision: 1 };
const activePolicyRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId };
const projectRef = { aggregateType: 'Project' as const, projectId };
const workspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
const creation = (requestId: string, kernelStore = { adapterId: 'workspace-kernel', storeKey: 'workspace-key' }) => ({
  input: { workspace, kernelStore, role, recommendedRefs: [], initialLinks: [] },
  meta: { requestId, expected: [] },
});
const schemas: RecordBackendSchemas = {
  records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
    ...PLAN_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records],
  events: [...GOAL_RECORD_SCHEMAS.events, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events,
    ...PLAN_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events,
    ...ARCHITECTURE_CATALOG_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...(PLAN_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_RECORD_SCHEMAS.lookups ?? []),
    ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [])],
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
  // Scope and governance through the real public owners: Project/Workspace,
  // the installed and activated CompletionPolicy, then the initial architecture.
  let bootstrapSequence = 0;
  const bootstrap = createProjectBootstrapServices({ records: backend.records, now: () => at,
    eventId: () => `r4b-bootstrap-${++bootstrapSequence}` });
  const createdProject = await bootstrap.projects.createProject(ctx, {
    input: { projectId },
    meta: { requestId: 'r4b-create-project', expected: [{ ref: projectRef, revision: 0 }] },
  });
  if (createdProject.status !== 'committed') throw new Error(`Project creation failed: ${JSON.stringify(createdProject)}`);
  const registered = await bootstrap.projects.registerWorkspace(ctx, {
    input: { workspace },
    meta: { requestId: 'r4b-register-workspace', expected: [
      { ref: createdProject.value.ref, revision: createdProject.value.revision },
      { ref: workspaceRef, revision: 0 },
    ] },
  });
  if (registered.status !== 'committed') throw new Error(`Workspace registration failed: ${JSON.stringify(registered)}`);
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: policyRef.policyId, contentRevision: policyRef.revision, content: policyContent },
    meta: { requestId: 'r4b-install-policy', expected: [
      { ref: createdProject.value.ref, revision: createdProject.value.revision },
      { ref: policyRef, revision: 0 },
    ] },
  });
  if (installed.status !== 'committed') throw new Error(`policy install failed: ${JSON.stringify(installed)}`);
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    meta: { requestId: 'r4b-activate-policy', expected: [
      { ref: createdProject.value.ref, revision: createdProject.value.revision },
      { ref: activePolicyRef, revision: 0 },
    ] },
  });
  if (activated.status !== 'committed') throw new Error(`policy activation failed: ${JSON.stringify(activated)}`);
  const adopted = await createArchitectureCatalogService({ records: backend.records }).adoptInitialArchitecture(ctx, {
    input: { baselineId: 'baseline-1', description: 'Task fixture baseline', constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [] } },
    meta: { requestId: 'r4b-adopt-architecture', expected: [
      { ref: createdProject.value.ref, revision: createdProject.value.revision },
      { ref: workspaceRef, revision: registered.value.revision },
    ] },
  });
  if (adopted.status !== 'committed') throw new Error(`architecture adoption failed: ${JSON.stringify(adopted)}`);
  const sessions = createSessionDirectory({ records: backend.records, lookups: backend.records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'workspace-kernel', storeKey: 'workspace-key', workspace,
    databasePath: path.join(directory, 'kernel.sqlite'),
  }] });
  // The real Session Runtime entry: admission, trusted Kernel session creation
  // and registration through the directory. Tests that need a Session as a
  // target use this instead of writing Runtime facts themselves.
  const operations = createSessionOperations({ sessions, kernelStores });
  return { backend, sessions, kernelStores, operations, ledgerPath };
}

/** Seed the actual Goal -> accepted immutable Plan relation used for Task links
 * through the public createGoal -> proposePlan -> applyPlanChange adoption path. */
async function seedAcceptedTask(records: Awaited<ReturnType<typeof open>>['backend']['records']) {
  const goalRef = { aggregateType: 'Goal' as const, projectId, goalId: 'goal-with-plan' };
  const planRef = { aggregateType: 'PlanRevision' as const, projectId, planId: 'accepted-plan' };
  let sequence = 0;
  const goals = createGoalService({ records, now: () => at, eventId: () => `r4b-goal-${++sequence}` }).tasks;
  const created = await goals.createGoal(ctx, {
    input: { goalId: goalRef.goalId, workspace: { projectId, workspaceId }, objective: 'Implement the accepted task' },
    meta: { requestId: 'r4b-create-goal', expected: [
      { ref: projectRef, revision: 1 },
      { ref: workspaceRef, revision: 1 },
    ] },
  });
  expect(created.status).toBe('committed');
  if (created.status !== 'committed') throw new Error('the Goal seed failed');
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: planRef.planId, planRevision: 1, goalId: goalRef.goalId,
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
  const plans = createPlanService({ records, now: () => at, eventId: () => `r4b-plan-${++sequence}` });
  const proposed = await plans.proposePlan(ctx, {
    input: { goalRef, basedOn: null, draft, reason: { text: 'Accepted task plan', sources: [] } },
    meta: { requestId: 'r4b-propose-plan', expected: [{ ref: goalRef, revision: created.value.revision }] },
  });
  expect(proposed).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
  if (proposed.status !== 'committed') throw new Error('the Plan proposal failed');
  const applied = await plans.applyPlanChange(ctx, {
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: 'r4b-apply-plan', expected: [{ ref: goalRef, revision: created.value.revision }] },
  });
  expect(applied).toMatchObject({ status: 'committed', value: { ref: planRef, revision: 1, planRevision: 1 } });
  if (applied.status !== 'committed') throw new Error('the Plan adoption failed');
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
    const { backend, sessions, operations } = await open(kind);
    try {
      const { taskRef } = await seedAcceptedTask(backend.records);
      // A real Session through the Runtime entry; the completion receipt's
      // cursor is the registration commit that activates the initial link.
      const created = await operations.createSession(ctx, {
        workspace, role, recommendedRefs: [],
        initialLinks: [{ target: { kind: 'task' as const, ref: taskRef }, relation: 'responsible' as const }],
        meta: { requestId: 'initial-link', expected: [] },
      });
      expect(created.status).toBe('completed');
      if (created.status !== 'completed') return;
      const card = await sessions.readSession(ctx, { projectId, sessionId: created.value.ref.sessionId });
      expect(card.status).toBe('ready');
      if (card.status !== 'ready') return;
      expect(card.value.links).toHaveLength(1);
      expect(card.value.links[0]?.since).toBe(created.cursor);
      expect(card.value.links[0]?.until).toBeNull();
    } finally { await backend.close(); }
  });

  describe('rejects: a Task link the active accepted Plan does not hold', () => {
    it('rejects a Task link absent from the active accepted Plan', async () => {
      const { backend, sessions, kernelStores } = await open(kind);
      try {
        const { taskRef } = await seedAcceptedTask(backend.records);
        const missingTask = { ...taskRef, taskId: 'not-in-plan' };
        // A3: a delegating wrapper around the real directory notes the planned
        // Session ref of the real admission and returns the real result unchanged.
        const planned: SessionRef[] = [];
        const observed: SessionDirectoryPort = { ...sessions, async admitSessionCreation(callCtx, request) {
          const admitted = await sessions.admitSessionCreation(callCtx, request);
          if (admitted.status === 'committed') planned.push(admitted.value.action.plannedSessionRef);
          return admitted;
        } };
        const operations = createSessionOperations({ sessions: observed, kernelStores });
        const listed = async () => {
          const page = await sessions.findSessions(ctx, { workspace, includeArchived: true, page: { limit: 10 } });
          if (page.status !== 'ready') throw new Error(`the Session directory read failed: ${JSON.stringify(page)}`);
          return page.value.items;
        };
        // Before: no Session exists in the workspace (none was created yet).
        const before = await listed();
        expect(before).toEqual([]);
        const created = await operations.createSession(ctx, {
          workspace, role, recommendedRefs: [],
          initialLinks: [{ target: { kind: 'task' as const, ref: missingTask }, relation: 'responsible' as const }],
          meta: { requestId: 'missing-task-link', expected: [] },
        });
        expect(created.status).toBe('rejected');
        if (created.status !== 'rejected') return;
        expect(['not_found', 'dependency_blocked', 'invalid']).toContain(created.code);
        // The refused link never became a Session at all: the admitted planned
        // Session is not readable, and the workspace directory is unchanged.
        expect(planned).toHaveLength(1);
        expect(await sessions.readSession(ctx, planned[0]!)).toEqual({ status: 'not_found' });
        expect(await listed()).toEqual(before);
        const found = await sessions.findSessions(ctx, { workspace,
          target: { kind: 'task', ref: missingTask }, includeArchived: true, page: { limit: 10 } });
        expect(found.status).toBe('ready');
        if (found.status === 'ready') expect(found.value.items).toEqual([]);
      } finally { await backend.close(); }
    });
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
