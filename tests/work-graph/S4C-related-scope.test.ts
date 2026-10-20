/**
 * Slice 4C-1 C2.1/C2.4 (spec §11.2 and §11.4 find side): the related-first
 * `find` segments and the first-page project header, read through the public
 * `platform.notes.memoryFind` on both backends (NE3).
 *
 * Every expectation is literal and hand-computed from the spec fixture. The
 * concrete `runTask` resolver is wired by another task, so all segmentation here
 * is driven by an EXPLICIT `related: { kind: 'task' | 'module', ... }`.
 *
 * The fixture builds a SECOND real Goal whose accepted Plan scopes t1 to module
 * A and t2 to module B in stage s1 (the spec fixture's M/M1/N with the real
 * catalog's A/A1/B). The original 4A Goal keeps its own plan and has no notes.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import type { RunRef, RoleBindingRefV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { createS4ANoteFixture, S4A_AT, type S4ANoteFixture, type S4ANoteFixtureKind, type S4ANoteLimits } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const GOAL = 's4c-goal';

type PortCounter = { searchText: number; lookup: number; lookupOrdered: number; readMany: number };

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
  return { schemaVersion: 1, bindingId: `s4c-${id}-binding`,
    templateId: role === 'scribe' ? 'platform-scribe' : 'platform-executor', templateRevision: 's3.1',
    bindingVersion: 1, policyRevision: 'legacy-template' };
}

/** Compose the real 4A fixture, add the fixture files, and optionally count store-port calls. */
async function buildBase(kind: S4ANoteFixtureKind, options: { resultMaxBytes?: number; relatedFilesMax?: number;
  countPorts?: boolean } = {}): Promise<{ f: S4ANoteFixture; counter: PortCounter }> {
  const counter: PortCounter = { searchText: 0, lookup: 0, lookupOrdered: 0, readMany: 0 };
  const noteLimits = {
    ...(options.resultMaxBytes === undefined ? {} : { resultMaxBytes: options.resultMaxBytes }),
    ...(options.relatedFilesMax === undefined ? {} : { relatedFilesMax: options.relatedFilesMax }),
  } as unknown as S4ANoteLimits;
  let f: S4ANoteFixture;
  if (options.countPorts === true) {
    const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
    const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
    const originalMemory = memoryBackend.createInMemoryRecordBackend;
    const originalSqlite = sqliteBackend.createSqliteRecordBackend;
    const wrap = <T,>(backend: T): T => {
      const records = (backend as unknown as { records: Record<string, unknown> }).records;
      return { ...(backend as object),
        records: { ...records,
          searchText: (...args: unknown[]) => { counter.searchText += 1; return (records['searchText'] as (...a: unknown[]) => unknown)(...args); },
          lookup: (...args: unknown[]) => { counter.lookup += 1; return (records['lookup'] as (...a: unknown[]) => unknown)(...args); },
          lookupOrdered: (...args: unknown[]) => { counter.lookupOrdered += 1; return (records['lookupOrdered'] as (...a: unknown[]) => unknown)(...args); },
          readMany: (...args: unknown[]) => { counter.readMany += 1; return (records['readMany'] as (...a: unknown[]) => unknown)(...args); },
        } } as unknown as T;
    };
    const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
      .mockImplementation(optionsIn => wrap(originalMemory(optionsIn)) as never);
    const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
      .mockImplementation(optionsIn => wrap(originalSqlite(optionsIn)) as never);
    try {
      f = await createS4ANoteFixture(kind, Object.keys(noteLimits).length === 0 ? {} : { noteLimits });
    } finally {
      memorySpy.mockRestore();
      sqliteSpy.mockRestore();
    }
  } else {
    f = await createS4ANoteFixture(kind, Object.keys(noteLimits).length === 0 ? {} : { noteLimits });
  }
  await writeFile(join(f.root, 'src/a/one/y.ts'), 'export const oneY = 1;\n');
  await writeFile(join(f.root, 'src/b/z.ts'), 'export const z = 1;\n');
  await writeFile(join(f.root, 'src/b/a.ts'), 'export const a = 1;\n');
  await writeFile(join(f.root, 'src/b/b.ts'), 'export const b = 1;\n');
  await writeFile(join(f.root, 'src/b/c.ts'), 'export const c = 1;\n');
  return { f, counter };
}

/**
 * A real second Goal with an accepted plan scoping t1 to module A and t2 to
 * module B, both in stage s1 (the spec fixture's M/M1/N mapped to A/A1/B).
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
    if (result.status !== 'committed') throw new Error(`s4c scoped goal ${label} failed: ${JSON.stringify(result)}`);
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
    if (goalRead.status !== 'ready') throw new Error('s4c scoped goal read failed');
    const card = await platform.sessions.readSession(ctx, sessionRef);
    if (card.status !== 'ready') throw new Error('s4c scoped session read failed');
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

function understandingDraft(): NoteDraftV1 {
  return { kind: 'understanding', topic: 'project-understanding', conclusion: 'the project now',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [],
    sections: { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' } } as NoteDraftV1;
}

async function writeNote(f: S4ANoteFixture, ctx: CoreCallContext, d: NoteDraftV1): Promise<string> {
  const result = await f.write(ctx, d, null);
  if (result.status === 'rejected') throw new Error(`note rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

/** The spec fixture's n01..n11, all written by the project scribe in the scoped goal. */
async function writeCoreNotes(f: S4ANoteFixture, ctx: CoreCallContext): Promise<string[]> {
  const ids: string[] = [];
  ids.push(await writeNote(f, ctx, draft({ topic: 'n01', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n02', anchor: { kind: 'stage', goalId: GOAL, stageId: 's1' } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n03', anchor: { kind: 'goal', goalId: GOAL } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n04', anchor: { kind: 'module', moduleId: 'A' } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n05', anchor: { kind: 'interface', moduleId: 'A', interfaceId: 'I1' } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n06', anchor: { kind: 'file', path: 'src/b/z.ts' } })));
  ids.push(await writeNote(f, ctx, draft({ kind: 'convention', topic: 'n07', anchor: { kind: 'project' } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n08', anchor: { kind: 'task', goalId: GOAL, taskId: 't2' } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n09', anchor: { kind: 'module', moduleId: 'B' } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n10', anchor: { kind: 'file', path: 'src/a/x.ts' } })));
  ids.push(await writeNote(f, ctx, draft({ topic: 'n11', anchor: { kind: 'file', path: 'src/a/one/y.ts' } })));
  return ids;
}

function countedFacts(definite: string[]): RunActivityFactsV1 {
  const at = '2026-10-15T00:00:00.000Z';
  return { status: 'counted', ruleVersion: 1,
    window: { kernelRunId: 's4c-kernel-run', kernelTurnId: 's4c-kernel-turn', fromPosition: 1, throughPosition: 4,
      bound: 'end_position', turnTerminal: true, unresolvedCalls: 0, turnStartedAt: at, lastRecordAt: at },
    quarters: [], overflow: null, totals: { steps: 0, edits: 0, editsUnknown: 0 },
    changedFiles: { definite: [...definite], possible: [], definiteOmitted: 0, possibleOmitted: 0,
      possiblyIncomplete: false, incompleteBecause: [] },
    usage: { requests: [], omitted: 0, totals: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, complete: true } };
}

function unknownFacts(): RunActivityFactsV1 {
  return { status: 'unknown', ruleVersion: 1, reason: 'no_history_locator', detail: 's4c unknown' };
}

/** End a claimed Run through the real Host control entry, then record its activity. */
async function endRunWithActivity(f: S4ANoteFixture, run: RunRef, facts: RunActivityFactsV1, suffix: string): Promise<void> {
  const execution = await f.platform.executions.readExecution(f.ctx(), run);
  if (execution.status !== 'ready') throw new Error(`run read failed: ${JSON.stringify(execution)}`);
  const cancelled = await f.platform.controls.submitControl(f.ctx(), {
    input: { runRef: run, kind: 'cancel', reason: 's4c related scope' },
    meta: { requestId: `s4c-cancel-${suffix}`, expected: [{ ref: run, revision: execution.value.run.revision }] } });
  if (cancelled.status !== 'committed') throw new Error(`run cancel failed: ${JSON.stringify(cancelled)}`);
  const recorded = await f.platform.runActivity.recordRunActivity(f.ctx(), {
    input: { runRef: run, facts }, meta: { requestId: `s4c-activity-${suffix}`, expected: [] } });
  if (recorded.status !== 'committed') throw new Error(`activity write failed: ${JSON.stringify(recorded)}`);
}

function idsOf(items: { noteId: string }[]): string[] { return items.map(item => item.noteId); }

describe('S4C F-01 related-first task segments', () => {
  it.each(KINDS)('F-01 %s: task t1 pages three times with the spec segments and boundary', async kind => {
    const { f } = await buildBase(kind);
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-scope-scribe', 't3', 'scribe');
      const t1Run = await goal.claimRun('s4c-scope-t1', 't1', 'executor');
      await endRunWithActivity(f, t1Run, countedFacts(['src/b/z.ts']), 's4c-scope-t1');
      const ids = await writeCoreNotes(f, goal.workCtx(scribe, 'scribe'));
      const [n01, n02, n03, n04, n05, n06, n07, n08, n09, n10, n11] = ids as string[];
      const request = { v: 1 as const, op: 'find' as const,
        related: { kind: 'task' as const, goalId: GOAL, taskId: 't1' }, limit: 4, cursor: null };
      const page1 = await f.platform.notes.memoryFind(f.ctx(), request);
      expect(page1.status).toBe('ready');
      if (page1.status !== 'ready') return;
      expect(idsOf(page1.value.items)).toEqual([n01, n02, n03, n04]);
      expect(page1.value.items.map(item => item.segment)).toEqual(['related', 'related', 'related', 'related']);
      expect(page1.value.related?.node).toMatchObject({ kind: 'task', goalId: GOAL, taskId: 't1' });
      expect(page1.value.boundary).toEqual({ relatedEnded: false, projectStartsAt: null });
      expect(page1.value.next).not.toBe(null);

      const page2 = await f.platform.notes.memoryFind(f.ctx(), { ...request, cursor: page1.value.next });
      expect(page2.status).toBe('ready');
      if (page2.status !== 'ready') return;
      expect(idsOf(page2.value.items)).toEqual([n05, n06, n07, n08]);
      expect(page2.value.items.map(item => item.segment)).toEqual(['related', 'related', 'related', 'project']);
      expect(page2.value.boundary).toEqual({ relatedEnded: true, projectStartsAt: 3 });
      expect(page2.value.next).not.toBe(null);

      const page3 = await f.platform.notes.memoryFind(f.ctx(), { ...request, cursor: page2.value.next });
      expect(page3.status).toBe('ready');
      if (page3.status !== 'ready') return;
      expect(idsOf(page3.value.items)).toEqual([n09, n10, n11]);
      expect(page3.value.items.map(item => item.segment)).toEqual(['project', 'project', 'project']);
      expect(page3.value.boundary).toEqual({ relatedEnded: true, projectStartsAt: 0 });
      expect(page3.value.next).toBe(null);
      expect(page3.value.complete).toBe(true);
    } finally { await f.close(); }
  });
});

describe('S4C F-02 related-first module segment', () => {
  it.each(KINDS)('F-02 %s: module A relates its interfaces and longest-owned files only', async kind => {
    const { f } = await buildBase(kind);
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-scope-scribe', 't3', 'scribe');
      const t1Run = await goal.claimRun('s4c-scope-t1', 't1', 'executor');
      await endRunWithActivity(f, t1Run, countedFacts(['src/b/z.ts']), 's4c-scope-t1');
      const ids = await writeCoreNotes(f, goal.workCtx(scribe, 'scribe'));
      const [n01, n02, n03, n04, n05, n06, n07, n08, n09, n10, n11] = ids as string[];
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'module', moduleId: 'A' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const related = read.value.items.filter(item => item.segment === 'related').map(item => item.noteId);
      const project = read.value.items.filter(item => item.segment === 'project').map(item => item.noteId);
      expect(related).toEqual([n04, n05, n07, n10]);
      expect(project).toEqual([n01, n02, n03, n06, n08, n09, n11]);
      expect(read.value.related?.node).toMatchObject({ kind: 'module', moduleId: 'A' });
      expect(read.value.boundary).toEqual({ relatedEnded: true, projectStartsAt: 4 });

      // The root module `"."` owns no files: only the project general notes relate.
      const root = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'module', moduleId: 'R' }, limit: 20, cursor: null });
      expect(root.status).toBe('ready');
      if (root.status !== 'ready') return;
      expect(root.value.items.filter(item => item.segment === 'related').map(item => item.noteId)).toEqual([n07]);
      expect(root.value.items.filter(item => item.segment === 'project').map(item => item.noteId))
        .toEqual([n01, n02, n03, n04, n05, n06, n08, n09, n10, n11]);
    } finally { await f.close(); }
  });

  it.each(KINDS)('F-02 %s: the root `.` module relates a file note no concrete prefix owns', async kind => {
    const { f } = await buildBase(kind);
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-scope-root-scribe', 't3', 'scribe');
      const ctx = goal.workCtx(scribe, 'scribe');
      await writeFile(join(f.root, 'src/loose.ts'), 'export const loose = 1;\n');
      const ids = await writeCoreNotes(f, ctx);
      const n07 = ids[6]!;
      const loose = await writeNote(f, ctx, draft({ topic: 'loose', anchor: { kind: 'file', path: 'src/loose.ts' } }));
      const root = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'module', moduleId: 'R' }, limit: 20, cursor: null });
      expect(root.status).toBe('ready');
      if (root.status !== 'ready') return;
      const related = root.value.items.filter(item => item.segment === 'related').map(item => item.noteId);
      expect(related).toContain(loose);
      expect(related).toContain(n07);
    } finally { await f.close(); }
  });
});

describe('S4C F-03 any-term ranking per segment', () => {
  it.each(KINDS)('F-03 %s: each segment ranks on its own U and df, related fully first', async kind => {
    const { f } = await buildBase(kind);
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-f03-scribe', 't3', 'scribe');
      const ctx = goal.workCtx(scribe, 'scribe');
      const r1 = await writeNote(f, ctx, draft({ topic: 'jwt analysis', conclusion: 'r1 conclusion',
        body: 'token in body', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      const r2 = await writeNote(f, ctx, draft({ topic: 'r2 topic', conclusion: 'token conclusion',
        body: 'body', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      const p1 = await writeNote(f, ctx, draft({ topic: 'token overview', conclusion: 'p1 conclusion',
        body: 'body', anchor: { kind: 'module', moduleId: 'B' } }));
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['jwt', 'token'],
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(idsOf(read.value.items)).toEqual([r1, r2, p1]);
      expect(read.value.items.map(item => item.segment)).toEqual(['related', 'related', 'project']);
      expect(read.value.items[0]!.score).toBeCloseTo(3.9890, 4);
      expect(read.value.items[1]!.score).toBeCloseTo(1.3863, 4);
      expect(read.value.items[2]!.score).toBeCloseTo(2.0794, 4);
      expect(read.value.ranking).toBe('full');
      expect(read.value.boundary).toEqual({ relatedEnded: true, projectStartsAt: 2 });
    } finally { await f.close(); }
  });
});

describe('S4C F-04 kind filter across both segments', () => {
  it.each(KINDS)('F-04 %s: the kind filter applies to both segments and an understanding is never related', async kind => {
    const { f } = await buildBase(kind);
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-f04-scribe', 't3', 'scribe');
      const ctx = goal.workCtx(scribe, 'scribe');
      const ids = await writeCoreNotes(f, ctx);
      const n07 = ids[6]!;
      const understanding = await f.write(ctx, understandingDraft(), null, { expectedPointerRevision: null });
      if (understanding.status === 'rejected') throw new Error(JSON.stringify(understanding));

      const convention = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, kind: 'convention', limit: 20, cursor: null });
      expect(convention.status).toBe('ready');
      if (convention.status !== 'ready') return;
      expect(idsOf(convention.value.items)).toEqual([n07]);
      expect(convention.value.items[0]!.segment).toBe('related');

      const understandingFind = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, kind: 'understanding', limit: 20, cursor: null });
      expect(understandingFind.status).toBe('ready');
      if (understandingFind.status !== 'ready') return;
      expect(idsOf(understandingFind.value.items)).toEqual([understanding.noteId]);
      expect(understandingFind.value.items[0]!.segment).toBe('project');
    } finally { await f.close(); }
  });
});

describe('S4C F-05 cursors and the extended byte trim', () => {
  it.each(KINDS)('F-05 %s: rule/related cursor mismatches, a new activity and the trimmed mixed page', async kind => {
    const { f } = await buildBase(kind, { resultMaxBytes: 1 });
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-f05-scribe', 't3', 'scribe');
      const t1Run = await goal.claimRun('s4c-f05-t1', 't1', 'executor');
      await endRunWithActivity(f, t1Run, countedFacts(['src/b/z.ts']), 's4c-f05-t1');
      // An ended t2 Run whose activity is recorded only between pages.
      const t2Run = await goal.claimRun('s4c-f05-t2', 't2', 'executor');
      const t2Execution = await f.platform.executions.readExecution(f.ctx(), t2Run);
      if (t2Execution.status !== 'ready') throw new Error('t2 run read failed');
      const cancelled = await f.platform.controls.submitControl(f.ctx(), {
        input: { runRef: t2Run, kind: 'cancel', reason: 's4c f05' },
        meta: { requestId: 's4c-f05-t2-cancel', expected: [{ ref: t2Run, revision: t2Execution.value.run.revision }] } });
      if (cancelled.status !== 'committed') throw new Error(JSON.stringify(cancelled));

      const ctx = goal.workCtx(scribe, 'scribe');
      const r1 = await writeNote(f, ctx, draft({ topic: 'r1', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      const r2 = await writeNote(f, ctx, draft({ topic: 'r2', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      const p1 = await writeNote(f, ctx, draft({ topic: 'p1', anchor: { kind: 'module', moduleId: 'B' } }));
      const p2 = await writeNote(f, ctx, draft({ topic: 'p2', anchor: { kind: 'module', moduleId: 'B' } }));
      const request = { v: 1 as const, op: 'find' as const,
        related: { kind: 'task' as const, goalId: GOAL, taskId: 't1' }, limit: 10, cursor: null };
      const page1 = await f.platform.notes.memoryFind(f.ctx(), request);
      expect(page1.status).toBe('ready');
      if (page1.status !== 'ready') return;
      expect(idsOf(page1.value.items)).toEqual([r1]);
      expect(page1.value.boundary).toEqual({ relatedEnded: false, projectStartsAt: null });
      expect(page1.value.warnings).toContain('result_over_byte_bound');

      // A rule-1 cursor is a mismatch.
      const parsed = JSON.parse(page1.value.next!) as Record<string, unknown>;
      const oldRule = await f.platform.notes.memoryFind(f.ctx(), { ...request,
        cursor: JSON.stringify({ ...parsed, rule: 1 }) });
      expect(oldRule).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });

      // Reusing the cursor with a different `related` is a mismatch.
      const changed = await f.platform.notes.memoryFind(f.ctx(), { ...request,
        related: { kind: 'task', goalId: GOAL, taskId: 't2' }, cursor: page1.value.next });
      expect(changed).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });

      // The next page resumes from the last kept item's segment.
      const page2 = await f.platform.notes.memoryFind(f.ctx(), { ...request, cursor: page1.value.next });
      expect(page2.status).toBe('ready');
      if (page2.status !== 'ready') return;
      expect(idsOf(page2.value.items)).toEqual([r2]);
      expect(page2.value.boundary).toEqual({ relatedEnded: true, projectStartsAt: null });
      const page3 = await f.platform.notes.memoryFind(f.ctx(), { ...request, cursor: page2.value.next });
      expect(page3.status).toBe('ready');
      if (page3.status !== 'ready') return;
      expect(idsOf(page3.value.items)).toEqual([p1]);
      expect(page3.value.boundary).toEqual({ relatedEnded: true, projectStartsAt: 0 });
      const page4 = await f.platform.notes.memoryFind(f.ctx(), { ...request, cursor: page3.value.next });
      expect(page4.status).toBe('ready');
      if (page4.status !== 'ready') return;
      expect(idsOf(page4.value.items)).toEqual([p2]);
      expect(page4.value.items[0]!.segment).toBe('project');

      // A new RunActivity between pages is a revision conflict.
      await f.platform.runActivity.recordRunActivity(f.ctx(), { input: { runRef: t2Run, facts: countedFacts([]) },
        meta: { requestId: 's4c-f05-t2-activity', expected: [] } });
      const conflict = await f.platform.notes.memoryFind(f.ctx(), { ...request, cursor: page1.value.next });
      expect(conflict).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    } finally { await f.close(); }
  });
});

describe('S4C F-07 related files and the cap', () => {
  it.each(KINDS)('F-07 %s: cap 2 omits one changed file', async kind => {
    const { f } = await buildBase(kind, { relatedFilesMax: 2 });
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-f07-scribe', 't3', 'scribe');
      const known = await goal.claimRun('s4c-f07-known', 't1', 'executor');
      await endRunWithActivity(f, known, countedFacts(['src/b/a.ts', 'src/b/b.ts', 'src/b/c.ts']), 's4c-f07-known');
      const ctx = goal.workCtx(scribe, 'scribe');
      const fa = await writeNote(f, ctx, draft({ topic: 'fa', anchor: { kind: 'file', path: 'src/b/a.ts' } }));
      const fb = await writeNote(f, ctx, draft({ topic: 'fb', anchor: { kind: 'file', path: 'src/b/b.ts' } }));
      const fc = await writeNote(f, ctx, draft({ topic: 'fc', anchor: { kind: 'file', path: 'src/b/c.ts' } }));
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.related).toMatchObject({ filesOmitted: 1, filesUnknownRuns: 0 });
      expect(idsOf(read.value.items)).toEqual([fa, fb, fc]);
      expect(read.value.items.map(item => item.segment)).toEqual(['related', 'related', 'project']);
    } finally { await f.close(); }
  });

  it.each(KINDS)('F-07 %s: a still-running Run contributes no files', async kind => {
    const { f } = await buildBase(kind, { relatedFilesMax: 2 });
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-f07b-scribe', 't3', 'scribe');
      await goal.claimRun('s4c-f07b-running', 't1', 'executor');
      const ctx = goal.workCtx(scribe, 'scribe');
      const fa = await writeNote(f, ctx, draft({ topic: 'fa', anchor: { kind: 'file', path: 'src/b/a.ts' } }));
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.related).toMatchObject({ filesOmitted: 0, filesUnknownRuns: 0 });
      expect(read.value.items.map(item => item.noteId)).toEqual([fa]);
      expect(read.value.items[0]!.segment).toBe('project');
    } finally { await f.close(); }
  });

  it.each(KINDS)('F-07 %s: a changedFiles unknown Run increments filesUnknownRuns', async kind => {
    const { f } = await buildBase(kind, { relatedFilesMax: 2 });
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-f07c-scribe', 't3', 'scribe');
      const unknown = await goal.claimRun('s4c-f07c-unknown', 't1', 'executor');
      await endRunWithActivity(f, unknown, unknownFacts(), 's4c-f07c-unknown');
      const ctx = goal.workCtx(scribe, 'scribe');
      const fa = await writeNote(f, ctx, draft({ topic: 'fa', anchor: { kind: 'file', path: 'src/b/a.ts' } }));
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.related).toMatchObject({ filesOmitted: 0, filesUnknownRuns: 1 });
      expect(read.value.items[0]!.segment).toBe('project');
      expect(read.value.items[0]!.noteId).toBe(fa);
    } finally { await f.close(); }
  });
});

describe('S4C F-08 a page inside segment 1 makes no text-port call', () => {
  it.each(KINDS)('F-08 %s: the scoped related segment is scanned locally, never through the port', async kind => {
    const { f, counter } = await buildBase(kind, { countPorts: true });
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-f08-scribe', 't3', 'scribe');
      const ctx = goal.workCtx(scribe, 'scribe');
      const r1 = await writeNote(f, ctx, draft({ topic: 'alpha one', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      const r2 = await writeNote(f, ctx, draft({ topic: 'alpha two', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      await writeNote(f, ctx, draft({ topic: 'alpha project', anchor: { kind: 'module', moduleId: 'B' } }));
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha'],
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 2, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(idsOf(read.value.items).sort()).toEqual([r1, r2].sort());
      expect(read.value.items.every(item => item.segment === 'related')).toBe(true);
      expect(counter.searchText).toBe(0);
    } finally { await f.close(); }
  });
});

describe('S4C PU-04 the first-page project header', () => {
  it.each(KINDS)('PU-04 %s: page 1 carries the understanding and norms, page 2 does not', async kind => {
    const { f } = await buildBase(kind);
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-pu04-scribe', 't3', 'scribe');
      const ctx = goal.workCtx(scribe, 'scribe');
      const norm = await writeNote(f, ctx, draft({ kind: 'convention', topic: 'alpha norm', conclusion: 'c',
        anchor: { kind: 'project' } }));
      const reviewed = await f.platform.notes.reviewNote(f.ctx(), { commandId: 's4c-pu04-review', noteId: norm,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(reviewed.status).toBe('done');
      const taskNote = await writeNote(f, ctx, draft({ topic: 'task', conclusion: 'alpha task',
        anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
      const understanding = await f.write(ctx, understandingDraft(), null, { expectedPointerRevision: null });
      if (understanding.status === 'rejected') throw new Error(JSON.stringify(understanding));

      const request = { v: 1 as const, op: 'find' as const, terms: ['alpha'],
        related: { kind: 'task' as const, goalId: GOAL, taskId: 't1' }, limit: 1, cursor: null };
      const page1 = await f.platform.notes.memoryFind(f.ctx(), request);
      expect(page1.status).toBe('ready');
      if (page1.status !== 'ready') return;
      expect(idsOf(page1.value.items)).toEqual([norm]);
      expect(page1.value.items[0]!.segment).toBe('related');
      expect(page1.value.project).toEqual({
        understanding: { noteId: understanding.noteId, version: 1, pointerRevision: 1,
          conclusion: 'the project now', currentEligible: true },
        norms: [{ noteId: norm, version: 2, header: '约定(项目)：c' }],
        omitted: 0 });
      // The understanding and the shared norm are checked once.
      expect(page1.value.coverage.checkedItems).toBe(2);

      const page2 = await f.platform.notes.memoryFind(f.ctx(), { ...request, cursor: page1.value.next });
      expect(page2.status).toBe('ready');
      if (page2.status !== 'ready') return;
      expect(idsOf(page2.value.items)).toEqual([taskNote]);
      expect(page2.value.project).toBeUndefined();
    } finally { await f.close(); }
  });
});

describe('S4C F-06 an anchor or pathPrefix never segments', () => {
  it.each(KINDS)('F-06 %s: a work Run with an anchor or pathPrefix stays unsegmented and rejects related', async kind => {
    const { f } = await buildBase(kind);
    try {
      const goal = await createScopedGoal(f, GOAL);
      const scribe = await goal.claimRun('s4c-f06-scribe', 't3', 'scribe');
      const executor = await goal.claimRun('s4c-f06-exec', 't1', 'executor');
      await writeCoreNotes(f, goal.workCtx(scribe, 'scribe'));
      const ctx = goal.workCtx(executor, 'executor');

      const anchored = await f.platform.notes.memoryFind(ctx, { v: 1, op: 'find',
        anchor: { kind: 'project' }, limit: 20, cursor: null });
      expect(anchored.status).toBe('ready');
      if (anchored.status !== 'ready') return;
      expect(anchored.value.items.every(item => item.segment === undefined)).toBe(true);
      expect(anchored.value.related).toBeUndefined();
      expect(anchored.value.boundary).toBeUndefined();

      const prefixed = await f.platform.notes.memoryFind(ctx, { v: 1, op: 'find',
        pathPrefix: 'src/b', limit: 20, cursor: null });
      expect(prefixed.status).toBe('ready');
      if (prefixed.status !== 'ready') return;
      expect(prefixed.value.items.every(item => item.segment === undefined)).toBe(true);
      expect(prefixed.value.related).toBeUndefined();

      const bad = await f.platform.notes.memoryFind(ctx, { v: 1, op: 'find', anchor: { kind: 'project' },
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 20, cursor: null });
      expect(bad).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'related_with_scope' });
    } finally { await f.close(); }
  });
});
