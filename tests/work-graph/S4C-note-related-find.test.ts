/**
 * Slice 4C-1 rework (spec §11.2/§11.8): the related-first `find` fixes found by
 * the Codex rework review, read through `platform.notes.memoryFind`.
 *
 * RW-7: the REQUEST `related` union accepts only a well-formed task/module
 * object with no extra keys, or `null`; `{kind:'caller_task'}` and extra keys
 * are `invalid`. RW-6: segment 1's `partial` ranking survives onto a page that
 * starts in segment 2.
 */
import { describe, expect, it } from 'vitest';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RunRef, RoleBindingRefV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, S4A_AT, type S4ANoteFixture, type S4ANoteFixtureKind, type S4ANoteLimits } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const GOAL = 's4c-related-find-goal';

type ScopedGoal = {
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  plan: PlanRevisionSnapshot;
  claimRun(suffix: string, taskId: string, role: 'executor' | 'scribe'): Promise<RunRef>;
  workCtx(runRef: RunRef, role: 'executor' | 'scribe'): CoreCallContext;
};

function roleRef(role: 'executor' | 'scribe'): RoleConfigurationRef {
  return { kind: 'legacy_template', templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor',
    templateRevision: 's3.1' };
}

function bindingFor(role: 'executor' | 'scribe', id: string): RoleBindingRefV1 {
  return { schemaVersion: 1, bindingId: `s4c-rf-${id}-binding`,
    templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor', templateRevision: 's3.1',
    bindingVersion: 1, policyRevision: 'legacy-template' };
}

async function buildBase(kind: S4ANoteFixtureKind,
  options: { resultMaxBytes?: number; textSearchCandidateMax?: number } = {}): Promise<S4ANoteFixture> {
  const noteLimits = {
    ...(options.resultMaxBytes === undefined ? {} : { resultMaxBytes: options.resultMaxBytes }),
    ...(options.textSearchCandidateMax === undefined ? {} : { textSearchCandidateMax: options.textSearchCandidateMax }),
  } as unknown as S4ANoteLimits;
  const f = await createS4ANoteFixture(kind, Object.keys(noteLimits).length === 0 ? {} : { noteLimits });
  return f;
}

/**
 * A real second Goal whose accepted plan scopes t1 to module A and t2 to module
 * B, both in stage s1 (the same shape as the S4C-related-scope fixture).
 */
async function createScopedGoal(f: S4ANoteFixture, goalId: string): Promise<ScopedGoal> {
  const platform = f.platform;
  const ctx = f.ctx();
  const scope = f.scope;
  const projectRef = f.projectRef;
  const workspaceRef: WorkspaceRef = f.workspaceRef;
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: `${goalId}-plan` };
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
  const committed = async (label: string, result: { status: string }): Promise<Record<string, unknown>> => {
    if (result.status !== 'committed') throw new Error(`s4c related find goal ${label} failed: ${JSON.stringify(result)}`);
    return (result as unknown as { value: Record<string, unknown> }).value;
  };
  const readProject = platform.projects.readProject;
  if (readProject === undefined) throw new Error('platform.projects.readProject is not published');
  const project = await readProject(ctx, scope.projectId);
  if (project.status !== 'ready') throw new Error(`project read failed: ${JSON.stringify(project)}`);
  await committed('goal', await platform.goals.createGoal(ctx, { meta: { requestId: `${goalId}-create`,
    expected: [{ ref: projectRef, revision: project.value.revision }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId, workspace: scope, objective: `${goalId} objective` } }));
  const draft: PlanRevisionDraft = { schemaVersion: 1, planId: planRef.planId, planRevision: 1, goalId,
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [
      { taskId: 't1', stageId: 's1', title: 'Work one', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'module', stageId: 's1', moduleRef: 'A' } },
      { taskId: 't2', stageId: 's1', title: 'Work two', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'module', stageId: 's1', moduleRef: 'B' } },
      { taskId: 't3', stageId: 's1', title: 'Scribe review', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'g1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 't1', role: 'platform-executor', instruction: 'Work one' },
      { taskId: 't2', role: 'platform-executor', instruction: 'Work two' },
      { taskId: 't3', role: 'platform-scribe', instruction: 'Scribe review' }],
    obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required', taskIds: ['t1', 't2', 't3', 'g1'],
      verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed = await committed('plan-propose', await platform.plans.proposePlan(ctx, {
    meta: { requestId: `${goalId}-propose`, expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: `${goalId} plan`, sources: [] } } }));
  const applied = await committed('plan-apply', await platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `${goalId}-apply`, expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed['ref'] as never, expectedProposalRevision: proposed['revision'] as number,
      decisionRefs: [] } }));
  const plan = applied as unknown as PlanRevisionSnapshot;

  let sessionSeq = 0;
  const workCtx = (runRef: RunRef, role: 'executor' | 'scribe'): CoreCallContext =>
    ({ projectId: scope.projectId, workspaceId: scope.workspaceId,
      principal: { kind: 'work_run', runRef, roleBinding: bindingFor(role, runRef.runId) },
      materialReader: { kind: 'run', requester: runRef }, signal: new AbortController().signal });

  async function claimRun(suffix: string, taskId: string, role: 'executor' | 'scribe'): Promise<RunRef> {
    const admitted = await committed(`admit-${suffix}`, await platform.sessions.admitSessionCreation(ctx, {
      meta: { requestId: `${goalId}-admit-${suffix}`, expected: [] },
      input: { workspace: scope, kernelStore: { adapterId: 's4a-kernel', storeKey: 's4a-kernel-store' },
        role: roleRef(role), recommendedRefs: [], initialLinks: [] } }));
    const action = admitted['action'] as { plannedSessionRef: { projectId: string; sessionId: string } };
    const admittedRef = admitted['ref'] as { projectId: string; sessionId: string };
    const kernelSessionId = `${goalId}-kernel-session-${suffix}-${++sessionSeq}`;
    await platform.kernelStores.withStore('s4a-kernel', store => store.create({
      sessionId: kernelSessionId, recordId: `${goalId}-kernel-record-${suffix}`, createdAt: S4A_AT,
    }, { signal: ctx.signal }));
    const registered = await committed(`record-${suffix}`, await platform.sessions.recordSessionCreated(ctx, {
      meta: { requestId: `${goalId}-record-${suffix}`, expected: [] },
      input: { operationRef: admittedRef as never, sessionRef: action.plannedSessionRef, adapterId: 's4a-kernel',
        kernelSessionId, historyCursor: null, observedAt: S4A_AT } }));
    const sessionRef = registered['ref'] as { projectId: string; sessionId: string };
    const roleBinding = bindingFor(role, suffix);
    const goalRead = await platform.plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('s4c related find goal read failed');
    const card = await platform.sessions.readSession(ctx, sessionRef);
    if (card.status !== 'ready') throw new Error('s4c related find session read failed');
    const claimed = await committed(`claim-${suffix}`, await platform.claims.claimTask(ctx, {
      input: { goalRef, planRef, taskId, sessionRef, roleBinding, budget },
      meta: { requestId: `${goalId}-claim-${suffix}`, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: 1 },
        { ref: { aggregateType: 'Session', projectId: scope.projectId, sessionId: sessionRef.sessionId },
          revision: card.value.record.revision },
      ] } }));
    return claimed['runRef'] as RunRef;
  }

  return { goalRef, planRef, plan, claimRun, workCtx };
}

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'topic', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'task', goalId: GOAL, taskId: 't1' }, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeNote(f: S4ANoteFixture, ctx: CoreCallContext, d: NoteDraftV1): Promise<string> {
  const result = await f.write(ctx, d, null);
  if (result.status === 'rejected') throw new Error(`note rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4C related-find request shape (RW-7)', () => {
  it.each(KINDS)('RW-7 %s: caller_task and extra keys are invalid; null never segments', async kind => {
    const f = await buildBase(kind);
    try {
      const base = { v: 1 as const, op: 'find' as const, limit: 20, cursor: null };
      const caller = await f.platform.notes.memoryFind(f.ctx(), { ...base,
        related: { kind: 'caller_task' } as never });
      expect(caller).toMatchObject({ status: 'rejected', code: 'invalid' });
      const extra = await f.platform.notes.memoryFind(f.ctx(), { ...base,
        related: { kind: 'task', goalId: 'g', taskId: 't', extra: 1 } as never });
      expect(extra).toMatchObject({ status: 'rejected', code: 'invalid' });
      const extraModule = await f.platform.notes.memoryFind(f.ctx(), { ...base,
        related: { kind: 'module', moduleId: 'M', extra: 1 } as never });
      expect(extraModule).toMatchObject({ status: 'rejected', code: 'invalid' });
      const none = await f.platform.notes.memoryFind(f.ctx(), { ...base, related: null });
      expect(none.status).toBe('ready');
      if (none.status !== 'ready') return;
      expect(none.value.related).toBeUndefined();
      expect(none.value.boundary).toBeUndefined();
      expect(none.value.items.every(item => item.segment === undefined)).toBe(true);
    } finally { await f.close(); }
  });
});

describe('S4C segment-1 partial survives onto segment 2 (RW-6)', () => {
  it.each(KINDS)('RW-6 %s: a page that starts in segment 2 keeps ranking partial and is not complete', async kind => {
    const f = await buildBase(kind, { textSearchCandidateMax: 1 });
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-rw6-scribe', 't3', 'scribe');
      const ctx = goal.workCtx(scribe, 'scribe');
      // Segment 1: more matching related notes than the injected cap (1).
      await writeNote(f, ctx, draft({ topic: 'alpha one', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      await writeNote(f, ctx, draft({ topic: 'alpha two', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      // Segment 2: one matching project note.
      await writeNote(f, ctx, draft({ topic: 'alpha three', anchor: { kind: 'module', moduleId: 'B' } }));
      const request = { v: 1 as const, op: 'find' as const, terms: ['alpha'], match: 'any' as const,
        related: { kind: 'task' as const, goalId: GOAL, taskId: 't1' }, limit: 1, cursor: null };
      const page1 = await f.platform.notes.memoryFind(f.ctx(), request);
      expect(page1.status).toBe('ready');
      if (page1.status !== 'ready') return;
      expect(page1.value.items).toHaveLength(1);
      expect(page1.value.items[0]!.segment).toBe('related');
      expect(page1.value.ranking).toBe('partial');
      expect(page1.value.next).not.toBe(null);

      const page2 = await f.platform.notes.memoryFind(f.ctx(), { ...request, cursor: page1.value.next });
      expect(page2.status).toBe('ready');
      if (page2.status !== 'ready') return;
      expect(page2.value.items).toHaveLength(1);
      expect(page2.value.items[0]!.segment).toBe('project');
      expect(page2.value.ranking).toBe('partial');
      expect(page2.value.complete).toBe(false);
    } finally { await f.close(); }
  });
});
