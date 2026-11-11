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
import type { MemoryFindRequest } from '../../src/core/work-graph/model/note-contracts.js';
import { createS4ANoteFixture, S4A_AT, type S4ANoteFixture, type S4ANoteFixtureKind, type S4ANoteLimits } from '../helpers/S4A-note-fixture.js';
import { capturedKnowledgeIndexes, fileNoteWithoutRecord } from '../helpers/KLS2-knowledge-lines.js';

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
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: planRef.planId, planRevision: 1, goalId,
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

describe('S4C related find over a filed note with no record head (F-27 甲, [2B-16])', () => {
  it('F-27 memory: a filed note with no record head anchored in the related scope is in the related segment, not the project segment', async () => {
    // The platform's own index of this project, shared with the test world (the platform's index seam).
    const indexes = capturedKnowledgeIndexes();
    const f = await createS4ANoteFixture('memory', { knowledgeIndexFactory: indexes.factory });
    try {
      // A person puts a note file on module A into the line's knowledge folder; the platform's indexer takes it in.
      const noteId = 'f27-filed-note';
      expect(await fileNoteWithoutRecord({ root: f.root, caller: f.ctx(), workspaceId: f.scope.workspaceId,
        index: indexes.indexOf(f.scope.projectId), noteId, note: { kind: 'pitfall',
          source: { kind: 'user', principalId: 's4a-operator' }, topic: 'f27marker filed', conclusion: 'a filed conclusion',
          body: 'filed body', anchor: { kind: 'module', moduleId: 'A' }, extraAnchors: [], structural: false, facts: [],
          basisFiles: [], replaces: [], contradicts: [], coexistWith: [] } }))
        .toMatchObject({ status: 'decoded', value: { kind: 'note' } });

      const base = { v: 1 as const, op: 'find' as const, related: { kind: 'module' as const, moduleId: 'A' },
        limit: 20, cursor: null };
      const placed = async (request: typeof base & { terms?: string[]; match?: 'any' }) => {
        const found = await f.platform.notes.memoryFind(f.ctx(), request);
        if (found.status !== 'ready') throw new Error(`F-27 find: ${JSON.stringify(found)}`);
        return found.value.items.filter(item => item.noteId === noteId)
          .map(item => ({ segment: item.segment, version: item.version }));
      };
      expect({ plain: await placed(base), byTerm: await placed({ ...base, terms: ['f27marker'], match: 'any' }) })
        .toEqual({ plain: [{ segment: 'related', version: null }], byTerm: [{ segment: 'related', version: null }] });
    } finally { await f.close(); }
  });

  it('F-38 memory: a find with no terms by anchor or by path prefix lists the filed notes with no record head after every head, by note id', async () => {
    const indexes = capturedKnowledgeIndexes();
    const f = await createS4ANoteFixture('memory', { knowledgeIndexFactory: indexes.factory });
    try {
      const filed = async (noteId: string, anchor: NoteDraftV1['anchor']) => {
        const indexed = await fileNoteWithoutRecord({ root: f.root, caller: f.ctx(), workspaceId: f.scope.workspaceId,
          index: indexes.indexOf(f.scope.projectId), noteId, note: { kind: 'pitfall',
            source: { kind: 'user', principalId: 's4a-operator' }, topic: `${noteId} topic`, conclusion: 'filed',
            body: 'filed body', anchor, extraAnchors: [], structural: false, facts: [], basisFiles: [], replaces: [],
            contradicts: [], coexistWith: [] } as Parameters<typeof fileNoteWithoutRecord>[0]['note'] });
        if (indexed.status !== 'decoded') throw new Error(`F-38 index: ${JSON.stringify(indexed)}`);
      };
      // Filed in this order so the note id order differs from it.
      await filed('f38-filed-b', { kind: 'module', moduleId: 'A' });
      await filed('f38-filed-a', { kind: 'module', moduleId: 'A' });
      await filed('f38-filed-file', { kind: 'file', path: 'src/a/one/x.ts' });
      const onModule = await writeNote(f, f.ctx(), draft({ topic: 'f38 head on A', anchor: { kind: 'module', moduleId: 'A' } }));
      const onFile = await writeNote(f, f.ctx(), draft({ topic: 'f38 head on a file',
        anchor: { kind: 'file', path: 'src/a/x.ts' } }));
      const foundIn = async (scope: { anchor: { kind: 'module'; moduleId: string } } | { pathPrefix: string }) => {
        const found = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find', ...scope, limit: 20, cursor: null });
        if (found.status !== 'ready') throw new Error(`F-38 find: ${JSON.stringify(found)}`);
        return found.value.items.map(item => ({ noteId: item.noteId, version: item.version === null ? null : 'v' }));
      };
      expect({
        anchor: await foundIn({ anchor: { kind: 'module', moduleId: 'A' } }),
        pathPrefix: await foundIn({ pathPrefix: 'src/a' }),
      }).toEqual({
        anchor: [{ noteId: onModule, version: 'v' }, { noteId: 'f38-filed-a', version: null },
          { noteId: 'f38-filed-b', version: null }],
        pathPrefix: [{ noteId: onFile, version: 'v' }, { noteId: 'f38-filed-file', version: null }],
      });
    } finally { await f.close(); }
  });

  it('CR6 memory: a find with terms on an anchor or a path prefix keeps the filed notes with no record head; one on a removed module is still found', async () => {
    const indexes = capturedKnowledgeIndexes();
    const f = await createS4ANoteFixture('memory', { knowledgeIndexFactory: indexes.factory });
    try {
      await filedWithoutRecord(f, indexes, 'cr6-on-a', { kind: 'module', moduleId: 'A' }, 'cr6marker on A');
      await filedWithoutRecord(f, indexes, 'cr6-on-file', { kind: 'file', path: 'src/a/one/x.ts' }, 'cr6marker on a file');
      // `Z` is in no adopted catalog: the module of this note is gone.
      await filedWithoutRecord(f, indexes, 'cr6-on-z', { kind: 'module', moduleId: 'Z' }, 'cr6 on Z');
      const ids = async (request: Omit<MemoryFindRequest, 'v' | 'op' | 'limit' | 'cursor'>) => {
        const found = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find', limit: 20, cursor: null, ...request });
        return found.status === 'ready' ? found.value.items.map(item => item.noteId) : found;
      };
      const terms = ['cr6marker'];
      expect({
        all: await ids({ anchor: { kind: 'module', moduleId: 'A' }, terms, match: 'all' }),
        any: await ids({ anchor: { kind: 'module', moduleId: 'A' }, terms, match: 'any' }),
        prefix: await ids({ pathPrefix: 'src/a', terms }),
        removed: await ids({ anchor: { kind: 'module', moduleId: 'Z' } }),
      }).toEqual({ all: ['cr6-on-a'], any: ['cr6-on-a'], prefix: ['cr6-on-file'], removed: ['cr6-on-z'] });
    } finally { await f.close(); }
  });

  it('CR7 memory: a filed note with no record head has its anchors checked like a head\'s: on a removed module it is retired', async () => {
    const indexes = capturedKnowledgeIndexes();
    const f = await createS4ANoteFixture('memory', { knowledgeIndexFactory: indexes.factory });
    try {
      await filedWithoutRecord(f, indexes, 'cr7-on-a', { kind: 'module', moduleId: 'A' }, 'cr7 on A');
      await filedWithoutRecord(f, indexes, 'cr7-on-z', { kind: 'module', moduleId: 'Z' }, 'cr7 on Z');
      // A link from the removed module `Z` to `A`.
      await filedWithoutRecord(f, indexes, 'cr7-link', { kind: 'module', moduleId: 'Z' }, 'cr7 link', { kind: 'link',
        extraAnchors: [{ kind: 'module', moduleId: 'A' }], link: { relation: 'data',
          ends: { from: { kind: 'module', moduleId: 'Z' }, to: { kind: 'module', moduleId: 'A' }, via: null },
          key: { kind: 'literal', text: 'cr7.json' }, evidence: [{ role: 'emit', at: { path: 'src/a/x.ts' } }] } });
      const anchorsOf = (item: { anchorStatus: string; anchorRetiredReasons: string[]; anchorSlots: unknown[] }) =>
        ({ status: item.anchorStatus, reasons: item.anchorRetiredReasons, slots: item.anchorSlots });
      const read = await f.platform.notes.readNote(f.ctx(), { noteId: 'cr7-on-a' });
      const listed = await f.platform.notes.listByAnchor(f.ctx(), { anchor: { kind: 'module', moduleId: 'Z' }, limit: 20, cursor: null });
      const links = await f.platform.notes.readSemanticLinks(f.ctx(), { scope: { kind: 'project' }, cursor: null, limit: 20 });
      if (read.status !== 'ready' || listed.status !== 'ready' || links.status !== 'ready') {
        throw new Error(`CR7 reads: ${JSON.stringify({ read, listed, links })}`);
      }
      const link = links.value.items.find(item => item.noteId === 'cr7-link')!;
      const live = { status: 'live', reasons: [] };
      const removed = { status: 'retired', reasons: ['module_removed'] };
      expect({
        read: anchorsOf(read.value),
        listed: listed.value.items.map(item => ({ noteId: item.noteId, ...anchorsOf(item) })),
        link: { from: [link.from.anchorStatus, link.from.anchorRetiredReasons], to: [link.to.anchorStatus, link.to.anchorRetiredReasons] },
      }).toEqual({
        read: { ...live, slots: [live] },
        listed: [{ noteId: 'cr7-link', ...removed, slots: [removed, live] }, { noteId: 'cr7-on-z', ...removed, slots: [removed] }],
        link: { from: ['retired', ['module_removed']], to: ['live', []] },
      });
    } finally { await f.close(); }
  });
});

/** A person's note file with no record head, taken into the platform's index (the named F3 exception). */
async function filedWithoutRecord(f: S4ANoteFixture, indexes: ReturnType<typeof capturedKnowledgeIndexes>, noteId: string,
  anchor: NoteDraftV1['anchor'], topic: string, extra: Partial<Parameters<typeof fileNoteWithoutRecord>[0]['note']> = {}):
Promise<void> {
  const indexed = await fileNoteWithoutRecord({ root: f.root, caller: f.ctx(), workspaceId: f.scope.workspaceId,
    index: indexes.indexOf(f.scope.projectId), noteId, note: { kind: 'pitfall',
      source: { kind: 'user', principalId: 's4a-operator' }, topic, conclusion: 'filed', body: 'filed body', anchor,
      extraAnchors: [], structural: false, facts: [], basisFiles: [], replaces: [], contradicts: [], coexistWith: [],
      ...extra } as Parameters<typeof fileNoteWithoutRecord>[0]['note'] });
  if (indexed.status !== 'decoded') throw new Error(`${noteId} index: ${JSON.stringify(indexed)}`);
}
