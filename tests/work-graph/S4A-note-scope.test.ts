/**
 * Slice 4A group G (NE1): N-20 write-time anchor classes, N-21/N-22 region
 * scribe admission, the N-10 scribe-scope cases and the L7 per-scope count.
 * Assertions go only through `platform.notes` (the public write/read/count
 * ports) on both backends; the record store is never read.
 */
import { describe, expect, it } from 'vitest';
import type { ArchiveTaskChoiceV1 } from '../../src/contracts/core/session-archive.js';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createS4ANoteScopeFixture, type S4ANoteScopeFixture, type S4ANoteScopeFixtureKind } from '../helpers/S4A-note-scope-fixture.js';

const KINDS: readonly S4ANoteScopeFixtureKind[] = ['memory', 'sqlite'];

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}
const asAnchor = (anchor: NoteDraftAnchorV1): NoteDraftV1 => general({ anchor });
const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

async function committedValue(label: string, result: { status: string }): Promise<Record<string, unknown>> {
  if (result.status !== 'committed') throw new Error(`S4A scope ${label} failed: ${JSON.stringify(result)}`);
  return (result as unknown as { value: Record<string, unknown> }).value;
}

/**
 * Item 6/15b: accept a second plan revision of s4a-goal through the public plan
 * service while the claimed Runs still bind revision 1. Stage s1 is kept, one
 * new unclaimed task t7 is added to s1 (platform-executor) and to o1, and the
 * plan gets a new planId. A refusal is surfaced with the exact code and reason.
 */
async function reviseGoalOneToTwo(f: S4ANoteScopeFixture): Promise<void> {
  const ctx = f.ctx();
  const goalRead = await f.platform.plans.queryGoal(ctx, f.goalRef);
  if (goalRead.status !== 'ready') throw new Error(`S4A scope goal read failed for r2: ${JSON.stringify(goalRead)}`);
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's4a-scope-plan-r2', planRevision: 2, goalId: 's4a-goal',
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [...f.plan.tasks, { taskId: 't7', stageId: 's1', title: 'New work', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [...(f.plan.assignments ?? []), { taskId: 't7', role: 'platform-executor', instruction: 'Execute t7' }],
    obligations: f.plan.obligations.map(obligation => obligation.obligationId === 'o1'
      ? { ...obligation, taskIds: [...obligation.taskIds, 't7'] } : obligation),
    taskHierarchy: f.plan.taskHierarchy, executionDag: f.plan.executionDag,
  };
  const proposed = await committedValue('plan-r2-propose', await f.platform.plans.proposePlan(ctx, {
    meta: { requestId: 's4a-scope-plan-r2-propose', expected: [{ ref: f.goalRef, revision: goalRead.value.goal.revision }] },
    input: { goalRef: f.goalRef, basedOn: f.planRef, draft, reason: { text: 'S4A scope plan revision 2', sources: [] } } }));
  await committedValue('plan-r2-apply', await f.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: 's4a-scope-plan-r2-apply', expected: [{ ref: f.goalRef, revision: goalRead.value.goal.revision }] },
    input: { proposalRef: proposed['ref'] as never, expectedProposalRevision: proposed['revision'] as number, decisionRefs: [] } }));
}

/**
 * Item 7(e): accept a second plan revision of s4a-goal-2 through the same public
 * plan path, keeping stage s2. This makes goal two's current revision (2) differ
 * from S0's Run-bound revision (1), so a wrong implementation that used S0's
 * bound revision would be caught.
 */
async function reviseGoalTwoToTwo(f: S4ANoteScopeFixture): Promise<void> {
  const ctx = f.ctx();
  const goalRead = await f.platform.plans.queryGoal(ctx, f.goal2Ref);
  if (goalRead.status !== 'ready') throw new Error(`S4A scope goal read failed for goal2 r2: ${JSON.stringify(goalRead)}`);
  const graph = await f.platform.plans.queryTaskGraph(ctx, { goalRef: f.goal2Ref });
  if (graph.status !== 'ready') throw new Error(`S4A scope task graph read failed for goal2 r2: ${JSON.stringify(graph)}`);
  const base = graph.value.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's4a-scope-plan-2-r2', planRevision: 2, goalId: 's4a-goal-2',
    stages: base.stages,
    tasks: [...base.tasks, { taskId: 't11', stageId: 's2', title: 'New other-goal work', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [...(base.assignments ?? []), { taskId: 't11', role: 'platform-scribe', instruction: 'Scribe t11' }],
    obligations: base.obligations.map(obligation => obligation.obligationId === 'o2'
      ? { ...obligation, taskIds: [...obligation.taskIds, 't11'] } : obligation),
    taskHierarchy: base.taskHierarchy, executionDag: base.executionDag,
  };
  const proposed = await committedValue('plan2-r2-propose', await f.platform.plans.proposePlan(ctx, {
    meta: { requestId: 's4a-scope-plan2-r2-propose', expected: [{ ref: f.goal2Ref, revision: goalRead.value.goal.revision }] },
    input: { goalRef: f.goal2Ref, basedOn: base.ref, draft, reason: { text: 'S4A scope plan two revision 2', sources: [] } } }));
  await committedValue('plan2-r2-apply', await f.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: 's4a-scope-plan2-r2-apply', expected: [{ ref: f.goal2Ref, revision: goalRead.value.goal.revision }] },
    input: { proposalRef: proposed['ref'] as never, expectedProposalRevision: proposed['revision'] as number, decisionRefs: [] } }));
}

async function withFixture<T>(kind: S4ANoteScopeFixtureKind, body: (f: S4ANoteScopeFixture) => Promise<T>,
  options: { containment?: boolean; skipProjectScribe?: boolean } = {}): Promise<T> {
  const fixture = await createS4ANoteScopeFixture(kind, options);
  try { return await body(fixture); } finally { await fixture.close(); }
}

describe('S4A N-20 write-time anchor classes', () => {
  it.each(KINDS)('N-20 %s a module id written as a name names the normalized-name candidate first', async kind => {
    await withFixture(kind, async f => {
      const result = await f.write(f.ctx(), asAnchor({ kind: 'module', moduleId: 'Area A' }), null);
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
      const candidates = (result as unknown as { anchorCandidates: { kind: string; id: string; displayName: string }[] }).anchorCandidates;
      expect(candidates[0]).toMatchObject({ kind: 'module', id: 'A', displayName: 'Area A' });
    });
  });

  it.each(KINDS)('N-20 %s a one-character typo lists Levenshtein candidates capped at five', async kind => {
    await withFixture(kind, async f => {
      const result = await f.write(f.ctx(), asAnchor({ kind: 'module', moduleId: 'Mq' }), null);
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
      const candidates = (result as unknown as { anchorCandidates: { kind: string; id: string }[] }).anchorCandidates;
      expect(candidates).toHaveLength(5);
      expect(candidates.every(candidate => candidate.kind === 'module' && candidate.id.startsWith('M'))).toBe(true);
    });
  });

  it.each(KINDS)('N-20 %s a missing file names the same-basename candidate elsewhere first', async kind => {
    await withFixture(kind, async f => {
      const result = await f.write(f.ctx(), asAnchor({ kind: 'file', path: 'src/old.ts' }), null);
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
      const candidates = (result as unknown as { anchorCandidates: { kind: string; id: string }[] }).anchorCandidates;
      expect(candidates[0]).toMatchObject({ kind: 'file', id: 'tests/old.ts' });
    });
  });

  it.each(KINDS)('N-20 %s an executor cannot use another goal\'s task anchor but a project scribe can', async kind => {
    await withFixture(kind, async f => {
      const anchor: NoteDraftAnchorV1 = { kind: 'task', goalId: 's4a-goal-2', taskId: 't9' };
      const refused = await f.write(f.workCtx(f.scribes.executor.runRef), asAnchor(anchor), 's4a-goal');
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_goal' });
      // Item 7(a)/15a: S0's Run is on s4a-goal, so this is a real cross-goal write.
      const allowed = await f.write(f.workCtx(f.scribes.s0.runRef), asAnchor(anchor), null);
      expect(allowed.status).toBe('accepted');
      const item = await f.notes.readNote(f.ctx(), { noteId: idOf(allowed) });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.anchor).toEqual({ kind: 'task', goalId: 's4a-goal-2', taskId: 't9' });
      expect(item.value.goalId).toBe('s4a-goal');
    });
  });

  it.each(KINDS)('N-20 %s a region scribe cannot use another goal\'s task anchor', async kind => {
    await withFixture(kind, async f => {
      const anchor: NoteDraftAnchorV1 = { kind: 'task', goalId: 's4a-goal-2', taskId: 't9' };
      const project = await f.write(f.workCtx(f.scribes.s0.runRef), asAnchor(anchor), null);
      expect(project.status).toBe('accepted');
      // SA is the region scribe of A and its Run is on s4a-goal: the anchor is
      // admitted by the own-goal rule (scribes are exempt) but refused by scope.
      const refused = await f.write(f.workCtx(f.scribes.sa.runRef), asAnchor(anchor), null);
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_scope' });
      const page = await f.notes.listByAnchor(f.ctx(), { anchor, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items.map(item => item.noteId)).toEqual([idOf(project)]);
    });
  });

  it.each(KINDS)('N-20 %s a project scribe writing a missing task in another goal reads anchor_not_found', async kind => {
    await withFixture(kind, async f => {
      const result = await f.write(f.workCtx(f.scribes.s0.runRef),
        asAnchor({ kind: 'task', goalId: 's4a-goal-2', taskId: 't99' }), null);
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
    });
  });

  it.each(KINDS)('N-20 %s an executor naming a missing task in another goal reads anchor_not_found first', async kind => {
    await withFixture(kind, async f => {
      // L2a: class 2 (existence of every anchor) precedes class 3 (own goal).
      const missing = await f.write(f.workCtx(f.scribes.executor.runRef),
        asAnchor({ kind: 'task', goalId: 's4a-goal-2', taskId: 't99' }), 's4a-goal');
      expect(missing).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
      // Reverse control: an EXISTING task in another goal is class 3, forbidden.
      const existing = await f.write(f.workCtx(f.scribes.executor.runRef),
        asAnchor({ kind: 'task', goalId: 's4a-goal-2', taskId: 't9' }), 's4a-goal');
      expect(existing).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_goal' });
    });
  });

  it.each(KINDS)('N-20 %s a project scribe stage anchor in another goal uses that goal\'s current plan', async kind => {
    await withFixture(kind, async f => {
      await reviseGoalOneToTwo(f);
      await reviseGoalTwoToTwo(f);
      // S0's bound plan is revision 1; goal two's current plan is revision 2.
      const written = await f.write(f.workCtx(f.scribes.s0.runRef),
        asAnchor({ kind: 'stage', goalId: 's4a-goal-2', stageId: 's2' }), null);
      expect(written.status).toBe('accepted');
      const item = await f.notes.readNote(f.ctx(), { noteId: idOf(written) });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.anchor).toEqual({ kind: 'stage', goalId: 's4a-goal-2', planRevision: 2, stageId: 's2' });
    });
  });

  it.each(KINDS)('N-20 %s listByAnchor on another goal\'s existing task with no notes is an empty ready page', async kind => {
    await withFixture(kind, async f => {
      // Item 7(f): an existing task in another goal (t10) has no notes; the
      // read must be an empty page, not anchor_not_found. S0's real work context
      // exercises the changed read-side work_run path.
      const page = await f.notes.listByAnchor(f.workCtx(f.scribes.s0.runRef),
        { anchor: { kind: 'task', goalId: 's4a-goal-2', taskId: 't10' }, limit: 100, cursor: null });
      expect(page).toMatchObject({ status: 'ready', value: { items: [], complete: true } });
    });
  });

  it.each(KINDS)('N-20 %s a cancelled task is accepted with an anchor_ended warning', async kind => {
    await withFixture(kind, async f => {
      const result = await f.write(f.workCtx(f.scribes.executor.runRef),
        asAnchor({ kind: 'task', goalId: 's4a-goal', taskId: 't2' }), 's4a-goal');
      expect(result.status).toBe('accepted');
      expect((result as unknown as { warnings: string[] }).warnings).toContain('anchor_ended');
    });
  });

  it.each(KINDS)('N-20 %s a deleted file anchor follows file_exists / deleted_needs_fact / a fact', async kind => {
    await withFixture(kind, async f => {
      const exists = await f.write(f.ctx(), asAnchor({ kind: 'file', path: 'src/b/y.ts', deleted: true }), null);
      expect(exists).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'file_exists' });
      const noFact = await f.write(f.ctx(), asAnchor({ kind: 'file', path: 'src/gone.ts', deleted: true }), null);
      expect(noFact).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'deleted_needs_fact' });
      const withFact = await f.write(f.ctx(), general({
        anchor: { kind: 'file', path: 'src/gone.ts', deleted: true },
        facts: [{ kind: 'file', path: 'src/gone.ts', digest: 'a'.repeat(64) }],
      }), null);
      expect(withFact.status).toBe('accepted');
    });
  });

  it.each(KINDS)('N-20 %s a stage anchor keeps the bound plan revision for an agent and the current one for the user', async kind => {
    await withFixture(kind, async f => {
      // Item 15b: accept a second plan revision of s4a-goal through the public
      // plan service while the executor's Run is still claimed under revision 1.
      await reviseGoalOneToTwo(f);
      const written = await f.write(f.workCtx(f.scribes.executor.runRef),
        asAnchor({ kind: 'stage', goalId: 's4a-goal', stageId: 's1' }), 's4a-goal');
      expect(written.status).toBe('accepted');
      const item = await f.notes.readNote(f.ctx(), { noteId: idOf(written) });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.anchor).toEqual({ kind: 'stage', goalId: 's4a-goal', planRevision: 1, stageId: 's1' });
      const page = await f.notes.listByAnchor(f.ctx(),
        { anchor: { kind: 'stage', goalId: 's4a-goal', planRevision: 1, stageId: 's1' }, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items.map(candidate => candidate.noteId)).toEqual([idOf(written)]);
      // The user reads the goal's current accepted plan (revision 2).
      const asUser = await f.write(f.ctx(), asAnchor({ kind: 'stage', goalId: 's4a-goal', stageId: 's1' }), 's4a-goal');
      expect(asUser.status).toBe('accepted');
      const userItem = await f.notes.readNote(f.ctx(), { noteId: idOf(asUser) });
      if (userItem.status !== 'ready') throw Error('unreachable');
      expect(userItem.value.anchor).toEqual({ kind: 'stage', goalId: 's4a-goal', planRevision: 2, stageId: 's1' });
    });
  });

  it.each(KINDS)('N-20 %s each goal\'s stage gets its own revision', async kind => {
    await withFixture(kind, async f => {
      await reviseGoalOneToTwo(f);
      const written = await f.write(f.ctx(), general({
        anchor: { kind: 'stage', goalId: 's4a-goal', stageId: 's1' },
        extraAnchors: [{ kind: 'stage', goalId: 's4a-goal-2', stageId: 's2' }],
      }), 's4a-goal');
      expect(written.status).toBe('accepted');
      const item = await f.notes.readNote(f.ctx(), { noteId: idOf(written) });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.anchor).toEqual({ kind: 'stage', goalId: 's4a-goal', planRevision: 2, stageId: 's1' });
      expect(item.value.extraAnchors[0]).toEqual({ kind: 'stage', goalId: 's4a-goal-2', planRevision: 1, stageId: 's2' });
    });
  });
});

describe('S4A N-21 region-scribe write admission', () => {
  const FILE_A1 = { kind: 'file', path: 'src/a/one/x.ts' } as const;
  const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;

  it.each(KINDS)('N-21 %s a containment-subtree anchor is admitted and the deepest scribe manages it', async kind => {
    await withFixture(kind, async f => {
      const written = await f.write(f.workCtx(f.scribes.sa.runRef), asAnchor(FILE_A1), null);
      expect(written.status).toBe('accepted');
      const noteId = idOf(written);
      const refused = await f.review(f.scribes.sa, noteId, 'review');
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
      const managed = await f.review(f.scribes.sa1, noteId, 'review');
      expect(managed).toMatchObject({ status: 'done', state: 'reviewed' });
    });
  });

  it.each(KINDS)('N-21 %s an anchor in the scribe own module is managed by that scribe', async kind => {
    await withFixture(kind, async f => {
      const written = await f.write(f.workCtx(f.scribes.sa.runRef), asAnchor(FILE_A), null);
      expect(written.status).toBe('accepted');
      const noteId = idOf(written);
      const refused = await f.review(f.scribes.sa1, noteId, 'review');
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
      const managed = await f.review(f.scribes.sa, noteId, 'review');
      expect(managed).toMatchObject({ status: 'done', state: 'reviewed' });
    });
  });

  it.each(KINDS)('N-21 %s without containment the region is the module alone and the write is refused', async kind => {
    await withFixture(kind, async f => {
      const result = await f.write(f.workCtx(f.scribes.sa.runRef), asAnchor(FILE_A1), null);
      expect(result).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_scope' });
      const page = await f.notes.listByAnchor(f.ctx(), { anchor: FILE_A1, limit: 100, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toHaveLength(0);
    }, { containment: false });
  });
});

describe('S4A N-22 region scribe out-of-region anchors', () => {
  const FILE_B = { kind: 'file', path: 'src/b/y.ts' } as const;

  it.each(KINDS)('N-22 %s an out-of-region anchor is refused without records and the project scribe takes it', async kind => {
    await withFixture(kind, async f => {
      const refused = await f.write(f.workCtx(f.scribes.sa.runRef), asAnchor(FILE_B), null);
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_scope' });
      const page = await f.notes.listByAnchor(f.ctx(), { anchor: FILE_B, limit: 100, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toHaveLength(0);

      const accepted = await f.write(f.workCtx(f.scribes.s0.runRef), asAnchor(FILE_B), null);
      expect(accepted.status).toBe('accepted');
      const noteId = idOf(accepted);
      const managed = await f.review(f.scribes.s0, noteId, 'review');
      expect(managed).toMatchObject({ status: 'done', state: 'reviewed' });
      const refusedReview = await f.review(f.scribes.sa, noteId, 'review');
      expect(refusedReview).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
    });
  });
});

describe('S4A N-10 scribe scope cases and the per-scope count', () => {
  const FILE_A1 = { kind: 'file', path: 'src/a/one/x.ts' } as const;
  const FILE_B = { kind: 'file', path: 'src/b/y.ts' } as const;

  it.each(KINDS)('N-10 %s n1 is managed by the A1 scribe and the A scribe is refused', async kind => {
    await withFixture(kind, async f => {
      const n1 = await f.write(f.workCtx(f.scribes.sa1.runRef), asAnchor(FILE_A1), null);
      expect(n1.status).toBe('accepted');
      const refused = await f.review(f.scribes.sa, idOf(n1), 'review');
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
      const managed = await f.review(f.scribes.sa1, idOf(n1), 'review');
      expect(managed).toMatchObject({ status: 'done', state: 'reviewed' });
    });
  });

  it.each(KINDS)('N-10 %s n2 (module A and an A1 file) is managed by the A scribe', async kind => {
    await withFixture(kind, async f => {
      const n2 = await f.write(f.workCtx(f.scribes.sa.runRef), general({
        topic: 'n2', anchor: { kind: 'module', moduleId: 'A' }, extraAnchors: [FILE_A1],
      }), null);
      expect(n2.status).toBe('accepted');
      const refused = await f.review(f.scribes.sa1, idOf(n2), 'review');
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
      const managed = await f.review(f.scribes.sa, idOf(n2), 'review');
      expect(managed).toMatchObject({ status: 'done', state: 'reviewed' });
    });
  });

  it.each(KINDS)('N-10 %s n3 and n4 go up to the project scribe', async kind => {
    await withFixture(kind, async f => {
      const n3 = await f.write(f.workCtx(f.scribes.s0.runRef), general({
        topic: 'n3', anchor: FILE_A1, extraAnchors: [FILE_B],
      }), null);
      const n4 = await f.write(f.workCtx(f.scribes.s0.runRef), asAnchor(FILE_B), null);
      expect(n3.status).toBe('accepted');
      expect(n4.status).toBe('accepted');
      expect(await f.review(f.scribes.s0, idOf(n3), 'review')).toMatchObject({ status: 'done', state: 'reviewed' });
      expect(await f.review(f.scribes.s0, idOf(n4), 'review')).toMatchObject({ status: 'done', state: 'reviewed' });
    });
  });

  it.each(KINDS)('N-10 count %s counts current notes by managing scope', async kind => {
    await withFixture(kind, async f => {
      const n1 = await f.write(f.workCtx(f.scribes.sa1.runRef), general({ topic: 'c1', anchor: FILE_A1 }), null);
      const n2 = await f.write(f.workCtx(f.scribes.sa.runRef), general({ topic: 'c2',
        anchor: { kind: 'module', moduleId: 'A' }, extraAnchors: [FILE_A1] }), null);
      const n3 = await f.write(f.workCtx(f.scribes.s0.runRef), general({ topic: 'c3', anchor: FILE_A1, extraAnchors: [FILE_B] }), null);
      const n4 = await f.write(f.workCtx(f.scribes.s0.runRef), general({ topic: 'c4', anchor: FILE_B }), null);
      expect([n1.status, n2.status, n3.status, n4.status]).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
      const ctx = f.ctx();
      const a1 = await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'A1' } });
      const a = await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'A' } });
      const project = await f.notes.countCurrentNotes(ctx, { scope: { kind: 'project' } });
      const b = await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'B' } });
      expect(a1).toMatchObject({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'A1' }, current: 1 } });
      expect(a).toMatchObject({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'A' }, current: 1 } });
      expect(project).toMatchObject({ status: 'ready', value: { scope: { kind: 'project' }, current: 2 } });
      expect(b).toMatchObject({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'B' }, current: 0 } });
    });
  });

  it.each(KINDS)('N-10 count %s a scope with no scribe counts zero', async kind => {
    await withFixture(kind, async f => {
      const n1 = await f.write(f.workCtx(f.scribes.sa1.runRef), general({ topic: 'z1', anchor: FILE_A1 }), null);
      const n2 = await f.write(f.workCtx(f.scribes.sa.runRef), general({ topic: 'z2',
        anchor: { kind: 'module', moduleId: 'A' }, extraAnchors: [FILE_A1] }), null);
      const n3 = await f.write(f.ctx(), general({ topic: 'z3', anchor: FILE_A1, extraAnchors: [FILE_B] }), null);
      const n4 = await f.write(f.ctx(), general({ topic: 'z4', anchor: FILE_B }), null);
      expect([n1.status, n2.status, n3.status, n4.status]).toEqual(['accepted', 'accepted', 'accepted', 'accepted']);
      const ctx = f.ctx();
      expect(await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'A1' } }))
        .toMatchObject({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'A1' }, current: 1 } });
      expect(await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'A' } }))
        .toMatchObject({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'A' }, current: 1 } });
      expect(await f.notes.countCurrentNotes(ctx, { scope: { kind: 'project' } }))
        .toMatchObject({ status: 'ready', value: { scope: { kind: 'project' }, current: 0 } });
      expect(await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'B' } }))
        .toMatchObject({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'B' }, current: 0 } });
    }, { skipProjectScribe: true });
  });

  it.each(KINDS)('N-10 count %s counts the project-level slot of a goalId-null note', async kind => {
    await withFixture(kind, async f => {
      const n3 = await f.write(f.workCtx(f.scribes.s0.runRef), general({ topic: 'pl3', anchor: FILE_A1,
        extraAnchors: [FILE_B] }), null);
      const n4 = await f.write(f.workCtx(f.scribes.s0.runRef), general({ topic: 'pl4', anchor: FILE_B }), null);
      expect([n3.status, n4.status]).toEqual(['accepted', 'accepted']);
      const before = await f.notes.countCurrentNotes(f.ctx(), { scope: { kind: 'project' } });
      expect(before).toMatchObject({ status: 'ready', value: { scope: { kind: 'project' }, current: 2 } });
      // R11/d11: a project-level note stores `goalId: null` and the readers query it with null.
      const projectLevel = await f.write(f.ctx(), general({ topic: 'pl-user', anchor: FILE_B }), null);
      expect(projectLevel.status).toBe('accepted');
      const after = await f.notes.countCurrentNotes(f.ctx(), { scope: { kind: 'project' } });
      expect(after).toMatchObject({ status: 'ready', value: { scope: { kind: 'project' }, current: 3 } });
    });
  });

  it.each(KINDS)('N-10 %s the A scribe cannot replace n1 but the A1 scribe can', async kind => {
    await withFixture(kind, async f => {
      const n1 = await f.write(f.workCtx(f.scribes.sa1.runRef), general({ topic: 'r1', anchor: FILE_A1 }), null);
      expect(n1.status).toBe('accepted');
      const refused = await f.write(f.workCtx(f.scribes.sa.runRef), general({ topic: 'r2',
        anchor: FILE_A1, replaces: [idOf(n1)] }), null);
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
      const page = await f.notes.listByAnchor(f.ctx(), { anchor: FILE_A1, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items.map(item => item.noteId)).toEqual([idOf(n1)]);
      const accepted = await f.write(f.workCtx(f.scribes.sa1.runRef), general({ topic: 'r2',
        anchor: FILE_A1, replaces: [idOf(n1)] }), null);
      expect(accepted.status).toBe('accepted');
      const old = await f.notes.readNote(f.ctx(), { noteId: idOf(n1) });
      if (old.status !== 'ready') throw Error('unreachable');
      expect(old.value.storedState).toBe('superseded');
    });
  });

  it.each(KINDS)('N-10 %s a handover moves n1 to the successor scribe', async kind => {
    await withFixture(kind, async f => {
      const n1 = await f.write(f.workCtx(f.scribes.sa1.runRef), general({ topic: 'h1', anchor: FILE_A1 }), null);
      expect(n1.status).toBe('accepted');
      // Public handover today: close the predecessor's responsible link and open the successor's.
      await f.linkModule(f.scribes.sa1, 'A1', false);
      await f.linkModule(f.scribes.sa1b, 'A1', true);
      const refused = await f.review(f.scribes.sa1, idOf(n1), 'review');
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
      const managed = await f.review(f.scribes.sa1b, idOf(n1), 'review');
      expect(managed).toMatchObject({ status: 'done', state: 'reviewed' });
    });
  });

  it.each(KINDS)('N-10 %s SA1 archived (not a handover) sends n1 up to SA', async kind => {
    await withFixture(kind, async f => {
      const n1 = await f.write(f.workCtx(f.scribes.sa1.runRef), asAnchor(FILE_A1), null);
      expect(n1.status).toBe('accepted');
      const noteId = idOf(n1);
      const ctx = f.ctx();

      // Item c: the cancelled Run and the archive both go through public calls.
      // Cancel the claimed-but-unentered Run (the platform applies it); then
      // archive SA1's line with a `drop` for each open non-terminal task link
      // (module links need no choice and never block an archive).
      const runRead = await f.platform.executions.readExecution(ctx, f.scribes.sa1.runRef);
      if (runRead.status !== 'ready') throw new Error(`S4A archive run read failed: ${JSON.stringify(runRead)}`);
      const cancelled = await f.platform.controls.submitControl(ctx, {
        input: { runRef: f.scribes.sa1.runRef, kind: 'cancel', reason: 's4a archive' },
        meta: { requestId: 's4a-archive-cancel', expected: [{ ref: f.scribes.sa1.runRef, revision: runRead.value.run.revision }] },
      });
      expect(cancelled).toMatchObject({ status: 'committed' });
      const card = await f.platform.sessions.readSession(ctx, f.scribes.sa1.sessionRef);
      if (card.status !== 'ready') throw new Error(`S4A archive session read failed: ${JSON.stringify(card)}`);
      const tasks: ArchiveTaskChoiceV1[] = [];
      for (const link of card.value.links) {
        if (link.until !== null || link.ref.relation !== 'responsible') continue;
        const target = link.ref.target;
        if (target.kind !== 'task' && target.kind !== 'work') continue;
        tasks.push({ target, disposition: { kind: 'drop' } });
      }
      const archived = await f.platform.workflow.archiveLine(ctx, {
        input: { sessionRef: f.scribes.sa1.sessionRef, reason: 's4a archive', tasks, wait: null },
        meta: { requestId: 's4a-archive-line', expected: [{ ref: card.value.record.ref, revision: card.value.record.revision }] },
      });
      expect(archived).toMatchObject({ status: 'ready', value: { state: 'archived' } });

      // SA1 is gone: n1 goes up to the region-A scribe SA.
      expect(await f.review(f.scribes.sa, noteId, 'review'))
        .toMatchObject({ status: 'done', state: 'reviewed' });
      const a1 = await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'A1' } });
      const a = await f.notes.countCurrentNotes(ctx, { scope: { kind: 'region', moduleId: 'A' } });
      const project = await f.notes.countCurrentNotes(ctx, { scope: { kind: 'project' } });
      expect(a1).toMatchObject({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'A1' }, current: 0 } });
      expect(a).toMatchObject({ status: 'ready', value: { scope: { kind: 'region', moduleId: 'A' }, current: 1 } });
      expect(project).toMatchObject({ status: 'ready', value: { scope: { kind: 'project' }, current: 0 } });
    });
  });
});
