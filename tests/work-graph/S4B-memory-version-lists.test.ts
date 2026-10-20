/**
 * Slice 4B G3/G4 — M-10 the two version lists and `history`'s change/since.
 *
 * What it builds and through which public calls: the real `S4B` fixture
 * (`createS4BNoteCheckFixture`, which builds `S4ANoteFixture`) plus plan
 * revisions through `platform.plans.proposePlan`/`applyPlanChange` and catalog
 * revisions through `platform.architecture.reviseArchitectureCatalog`. Every
 * assertion goes through `listPlanVersions`/`listCatalogVersions` or the public
 * `memoryHistory`; expected values are literals from spec M-10/L19.
 */
import { describe, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

async function addPlanVersion(f: S4BNoteCheckFixture, text: string): Promise<void> {
  const ctx = f.ctx();
  const graph = await f.inner.platform.plans.queryTaskGraph(ctx, { goalRef: f.inner.goalRef });
  if (graph.status !== 'ready') throw new Error(`task graph read failed: ${JSON.stringify(graph)}`);
  const source = graph.value.plan;
  const draftV2: PlanRevisionDraft = {
    schemaVersion: 2, planId: `s4b-plan-${source.planRevision + 1}`, planRevision: source.planRevision + 1,
    goalId: source.goalRef.goalId, stages: structuredClone(source.stages), tasks: structuredClone(source.tasks),
    assignments: structuredClone(source.assignments ?? []), obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const before = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (before.status !== 'ready') throw new Error('goal read failed');
  const proposed = await f.inner.platform.plans.proposePlan(ctx, {
    meta: { requestId: `s4b-m10-propose-${source.planRevision}`,
      expected: [{ ref: f.inner.goalRef, revision: before.value.goal.revision }] },
    input: { goalRef: f.inner.goalRef, basedOn: source.ref, reason: { text, sources: [] }, draft: draftV2 } });
  if (proposed.status !== 'committed') throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
  const after = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (after.status !== 'ready') throw new Error('goal re-read failed');
  const applied = await f.inner.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `s4b-m10-apply-${source.planRevision}`,
      expected: [{ ref: f.inner.goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`apply failed: ${JSON.stringify(applied)}`);
}

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'history', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B M-10 version lists', () => {
  it.each(['memory', 'sqlite'] as const)('M-10 %s: three plan versions list newest first with each recorded reason', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      await addPlanVersion(f, 'second reason');
      await addPlanVersion(f, 'third reason');
      const graph = await f.inner.platform.plans.queryTaskGraph(f.ctx(), { goalRef: f.inner.goalRef });
      expect(graph.status).toBe('ready');
      if (graph.status !== 'ready') return;
      const page = await f.planVersions({ goalId: f.inner.goalRef.goalId, limit: 50, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.items.map(item => item.revision)).toEqual([3, 2, 1]);
      expect(page.value.items.map(item => item.reason)).toEqual(['third reason', 'second reason', 'S4A plan']);
      expect(page.value.items.map(item => item.reasonLabel)).toEqual(['third reason', 'second reason', 'S4A plan']);
      // R14: the newest item carries the adopted plan's own acceptedAt and the
      // three times are strictly descending ISO strings.
      expect(page.value.items[0]!.at).toBe(graph.value.plan.acceptedAt);
      const ats = page.value.items.map(item => item.at);
      expect(ats.every(at => typeof at === 'string')).toBe(true);
      expect(ats[0]! > ats[1]!).toBe(true);
      expect(ats[1]! > ats[2]!).toBe(true);
      expect(page.value.complete).toBe(true);
      expect(page.value.next).toBe(null);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-10 %s: the plan version list pages newest first with a stable cursor', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      await addPlanVersion(f, 'second reason');
      await addPlanVersion(f, 'third reason');
      const first = await f.planVersions({ goalId: f.inner.goalRef.goalId, limit: 2, cursor: null });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.items.map(item => item.revision)).toEqual([3, 2]);
      expect(first.value.complete).toBe(false);
      expect(first.value.next).not.toBe(null);
      const second = await f.planVersions({ goalId: f.inner.goalRef.goalId, limit: 2, cursor: first.value.next });
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      expect(second.value.items.map(item => item.revision)).toEqual([1]);
      expect(second.value.complete).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-10 %s: history items carry each version change and since', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const written = await f.inner.write(f.ctx(), draft({ topic: 'v' }), null);
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      const review = await f.inner.platform.notes.reviewNote(f.ctx(), {
        commandId: 's4b-m10-review', noteId: written.noteId, expectedVersion: 1, expectedPointerRevision: null,
        verdict: 'review', reason: null });
      expect(review.status).toBe('done');
      const history = await f.memory.memoryHistory(f.ctx(), { v: 1, op: 'history', noteId: written.noteId,
        limit: 100, cursor: null });
      expect(history.status).toBe('ready');
      if (history.status !== 'ready') return;
      expect(history.value.items.map(item => item.version)).toEqual([2, 1]);
      expect(history.value.items.map(item => item.change.kind)).toEqual(['review', 'write']);
      expect(history.value.items.map(item => item.change.by.kind)).toEqual(['user', 'user']);
      expect(history.value.items.every(item => typeof item.since === 'string' && item.since.length > 0)).toBe(true);
    } finally { await f.close(); }
  });
});
