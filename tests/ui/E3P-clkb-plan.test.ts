import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass } from './helpers/boot-page.js';
import { callsTo, countRoute, descendants, quietPage, sentWrite, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  answerOf, bootPlanW2, goalbarButton, lineText, openPAW2, planCard, planLines, planList,
} from './helpers/E3P-world.js';
import { pauseS7AGoal } from '../helpers/S7A-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

/**
 * E3P CLKB: the three Plan click rows the click inventory still lists as
 * untested (P04-6 继续, P09-3 stale 采用, P10-1 a required-reviewer draft).
 * Every row reuses openPAW2's real Host and scripted model; nothing is read
 * from storage.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe('E3P CLKB Plan rows', () => {
  it('P04-6 继续 sends goals/control resume with the paused Goal and GoalPhase pins, then shows 暂停', async () => {
    const w = await openPAW2();
    worlds.push(w.world);
    const paused = await pauseS7AGoal(w.world, w.world.goals.first);
    const { page, log } = await bootPlanW2(w);
    try {
      expect(goalbarButton(page.root, '继续')).toBeDefined();
      click(goalbarButton(page.root, '继续')!);
      const reply = await answerOf(log, 'goals/control');
      await quietPage(log);
      expect(countRoute(log, 'goals/control')).toBe(1);
      const sent = sentWrite(callsTo(log, 'goals/control')[0]);
      expect(sent.input['control']).toBe('resume');
      /* The row's Goal@2 is W1's count; openPAW2 already adopted v1 (Goal@2),
         so the pause the page shows is Goal@3. */
      expect(paused.goal.revision).toBe(3);
      expect(sent.meta.expected).toEqual([
        { ref: { aggregateType: 'Goal', projectId: 'ag2b-collab-project', goalId: 'ag2b-goal' }, revision: 3 },
        { ref: { aggregateType: 'GoalPhase', projectId: 'ag2b-collab-project', goalId: 'ag2b-goal' }, revision: 0 },
      ]);
      expect(reply['status']).toBe('committed');
      await waitFor(() => goalbarButton(page.root, '暂停') !== undefined);
      expect(goalbarButton(page.root, '继续')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('P09-3 采用 after another client moved the Plan answers revision_conflict, shows it and adds no version', async () => {
    const w = await openPAW2();
    worlds.push(w.world);
    const { page, log } = await bootPlanW2(w, { controlled: true });
    try {
      const card = planCard(page.root)!;
      expect(planLines(page.root).length).toBe(1);
      /* A second client adopts an independent revision based on v1; the page
         still holds candidate v2 (based on v1), so its pins are stale. */
      const goal = ready<{ goal: { revision: number; activePlanRevision: { planId: string; revision: number } | null } }>(
        await w.world.post('goals/read', plain(S6A_SCOPE, S6A_GOAL_1)), 'the Goal read').goal;
      const head = ready<{ head: { ref: unknown; revision: number; draft: Record<string, unknown> } | null }>(
        await w.world.post('plans/request-candidate', plain(S6A_SCOPE, { goalRef: S6A_GOAL_1, requestRef: w.requestRoot })),
        'the request candidate').head!;
      const draft = { ...head.draft, planId: 'pa-other-plan' };
      const proposed = (await w.world.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: S6A_GOAL_1, basedOn: goal.activePlanRevision, draft,
        reason: { text: 'PA other version', sources: [] },
      }, 'pa-other-propose', [{ ref: S6A_GOAL_1, revision: goal.revision }]))).body as
        { status: string; value: { ref: unknown; revision: number } };
      expect(proposed.status).toBe('committed');
      const applied = await w.world.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
      }, 'pa-other-apply', [{ ref: S6A_GOAL_1, revision: goal.revision }]));
      expect((applied.body as { status?: string }).status).toBe('committed');
      expect(planLines(page.root).length).toBe(1);
      const from = log.calls.length;
      click(findButton(findClass(card, 'plan-foot')!, '采用方案')!);
      await waitFor(() => log.calls.slice(from).some((call) => call.route === 'plans/apply' && call.reply !== undefined));
      const reply = log.calls.slice(from).find((call) => call.route === 'plans/apply')!.reply as Record<string, unknown>;
      await waitFor(() => findClass(findClass(page.root, 'composer-foot')!, 'to') !== undefined);
      await quietPage(log);
      expect(log.calls.slice(from).filter((call) => call.route === 'plans/apply').length).toBe(1);
      expect(reply['status']).toBe('rejected');
      expect(reply['code']).toBe('revision_conflict');
      const note = findClass(findClass(page.root, 'composer-foot')!, 'to');
      expect(note).toBeDefined();
      expect(textOf(note)).not.toBe('');
      expect(planLines(page.root).length).toBe(2);
      expect(planLines(page.root).map(lineText)).toEqual(['第 2 版 · PA other version', '第 1 版 · PA version one']);
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('P10-1 a required-reviewer draft is adopted and its 检查 row lists both obligations', async () => {
    const w = await openPAW2({ reviewer: true });
    worlds.push(w.world);
    const { page, log } = await bootPlanW2(w);
    try {
      const card = planCard(page.root)!;
      const check = findButton(card, '检查 2');
      expect(check).toBeDefined();
      click(check!);
      await waitFor(() => planList(page.root, '检查') !== undefined);
      const rows = descendants(planList(page.root, '检查')!)
        .filter((element) => element.tagName.toLowerCase() === 'span').map(textOf);
      /* The adapter lists one pair per requirement: the obligation and its
         requirement's description, the required reviewer pair included. */
      expect(rows).toEqual(['PA delivery', 'PA static check', 'PA independent review', 'PA review check']);
      expect(textOf(page.root)).not.toContain('reviewer_not_supported');
      click(findButton(findClass(planCard(page.root)!, 'plan-foot')!, '采用方案')!);
      const reply = await answerOf(log, 'plans/apply');
      await quietPage(log);
      expect(countRoute(log, 'plans/apply')).toBe(1);
      expect(reply['status']).toBe('committed');
      await waitFor(() => planLines(page.root).length === 2);
      expect(planLines(page.root).map(lineText)).toEqual(['第 2 版 · PA version two', '第 1 版 · PA version one']);
      /* 具名改坏: `boot.ts` 不把采用的 proposal 写回 `data.plan`；检查行断言红。 */
      expect(findButton(page.root, '检查 2')).toBeDefined();
      const checksAfter = planList(page.root, '检查');
      expect(checksAfter).toBeDefined();
      expect(descendants(checksAfter!).filter((element) => element.tagName.toLowerCase() === 'span').map(textOf))
        .toEqual(['PA delivery', 'PA static check', 'PA independent review', 'PA review check']);
      expect(findClass(findClass(page.root, 'composer-foot')!, 'to')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 240_000);
});
