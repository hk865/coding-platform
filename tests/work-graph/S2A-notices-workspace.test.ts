/**
 * Slice 2A QE3, Group N: QA-12 — a requeue belongs to the workspace of its Goal,
 * not to the project, and the workspace read never leaks across workspaces
 * (L4). The source reads the whole project's ordered window and filters each
 * requeue by reading its Goal directly, regardless of the Goal's status.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import { automaticRework, committed, completeWorldGoal, openManyTaskWorld, openReverifyChain,
  openS2ANotices, pin, ready, WORKSPACE_SCOPE } from '../helpers/S2A-notices-support.js';
import { openW2World, W2_SCOPE, w2Context } from '../helpers/S2A-notices-workspace2-fixture.js';
import type { S5DecisionFixture } from '../helpers/S5-decision-fixture.js';

const opened: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

const requeueKey = (ref: object) => `automatic_rework:${canonicalJson(ref as JsonValue)}`;

describe.each(['memory', 'sqlite'] as const)('S2A automatic-rework workspace isolation (%s)', kind => {
  it('QA-12 two workspaces of one project: each read returns only its own Goal\'s notices', async () => {
    const { f } = await openS2ANotices(kind);
    opened.push(f);
    // Two workspaces of the SAME project P, each populated with a real Goal and
    // a real automatic rework (public Goal/Plan/claim/entry/requeue services).
    const worldW = await openManyTaskWorld(f, ['rework-w']);
    const first = await worldW.requeueOnce('rework-w');
    const worldW2 = await openW2World(f, ['rework-w2']);
    const second = await worldW2.requeueOnce('rework-w2');
    const source = automaticRework(f);

    // The W context read lists the SAME project ordered window and returns only
    // W's notice; W2's is absent.
    const own = ready(await source.readPage(f.ctx, { workspace: WORKSPACE_SCOPE, page: { limit: 50 } }));
    expect(own.items.map(notice => notice.itemKey)).toEqual([requeueKey(first.ref)]);
    expect(own.items.map(notice => notice.itemKey)).not.toContain(requeueKey(second.ref));
    expect(own.items[0]?.goalRef).toMatchObject({ aggregateType: 'Goal', goalId: 'S2A' });
    expect(own.availability).toBe('available');

    // The W2 read uses a W2 call context and returns only W2's notice.
    const foreign = ready(await source.readPage(w2Context(f), { workspace: W2_SCOPE, page: { limit: 50 } }));
    expect(foreign.items.map(notice => notice.itemKey)).toEqual([requeueKey(second.ref)]);
    expect(foreign.items.map(notice => notice.itemKey)).not.toContain(requeueKey(first.ref));
    expect(foreign.items[0]?.goalRef).toMatchObject({ aggregateType: 'Goal', goalId: worldW2.goalRef.goalId });
    expect(foreign.availability).toBe('available');
  }, 600_000);

  it('QA-12 a cancelled Goal and a completed Goal both keep their notices', async () => {
    const { f } = await openS2ANotices(kind);
    opened.push(f);
    // Two Goals of the SAME project and workspace, each with a real requeue.
    const cancelledWorld = await openManyTaskWorld(f, ['cancelled-work'], { goalId: 'Q-CANCEL', planId: 'PQ-CANCEL' });
    const completedWorld = await openManyTaskWorld(f, ['completed-work'],
      { goalId: 'Q-COMPLETE', planId: 'PQ-COMPLETE', optionalTaskIds: ['completed-notice'] });
    const cancelled = await cancelledWorld.requeueOnce('cancelled-work');
    const completed = await completedWorld.requeueOnce('completed-notice');

    // Cancel one Goal and complete the other BEFORE the notices are seen. The
    // source reads each requeue's Goal directly, regardless of its state.
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: cancelledWorld.goalRef.projectId, goalId: 'Q-CANCEL' };
    committed(await setGoalControlFromHost({ records: f.records, now: f.now, eventId: f.newId }, f.ctx, {
      input: { goalRef: cancelledWorld.goalRef, control: 'cancel', reason: 'QA-12 cancelled Goal' },
      meta: { requestId: f.newId(), expected: [await pin(f.records, cancelledWorld.goalRef), { ref: phaseRef, revision: 0 }] } }));
    await completeWorldGoal(f, completedWorld, openReverifyChain(f), 'completed-work');

    const page = ready(await automaticRework(f).readPage(f.ctx, { workspace: WORKSPACE_SCOPE, page: { limit: 50 } }));
    const byGoal = new Map(page.items.map((notice) => [notice.goalRef.goalId, notice.itemKey]));
    expect(byGoal.get('Q-CANCEL')).toBe(requeueKey(cancelled.ref));
    expect(byGoal.get('Q-COMPLETE')).toBe(requeueKey(completed.ref));
    expect(new Set(page.items.map((notice) => notice.itemKey)))
      .toEqual(new Set([requeueKey(cancelled.ref), requeueKey(completed.ref)]));
  }, 600_000);
});
