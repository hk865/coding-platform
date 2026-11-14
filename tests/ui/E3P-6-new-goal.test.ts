import { afterAll, describe, expect, it } from 'vitest';
import { findButton, findClass } from './helpers/boot-page.js';
import { bootE3N, hasClass, pickTab, quietPage, revealTreeNode, treeNames, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { answerOf, goalCard, lineText, openPAW5, planLines, planReady } from './helpers/E3P-world.js';
import { activateArchPolicy, seedArchWorld } from './helpers/E3A-world.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

import { asRecord } from '../../src/ui/values.js';
import type { GoalRef } from '../../src/contracts/ledger.js';

/**
 * E3P-6 (CLKD package 9, row P20-7): the Plan page's goal-card confirm creates
 * the new Goal; its small work task, once a plan is adopted, is drawn 可领取 in
 * the task map. The claim itself has no page control (only the `s-claimable`
 * square), so that is the click-level evidence the click table names. The
 * plan after the confirm is proposed/applied through the real routes, the same
 * public steps the secretary's plan round uses.
 */

const worlds: Array<Awaited<ReturnType<typeof openPAW5>>['world']> = [];
afterAll(async () => {
  for (const world of worlds.splice(0)) await world.close();
}, 240_000);

describe('E3P-6 a confirmed goal card and its claimable task', () => {
  it('P20-7 确认目标卡 makes the new Goal; its small task is 可领取 in the task map', async () => {
    const opened = await openPAW5();
    worlds.push(opened.world);
    const plan = await bootE3N(opened.world, 'Plan', { mode: 'controlled', gate: true });
    let goalRef: GoalRef;
    let goalId: string;
    try {
      await planReady(plan.log);
      const card = goalCard(plan.page.root);
      expect(card).toBeDefined();
      click(findButton(card!, '确认目标卡')!);
      const confirmed = await answerOf(plan.log, 'goals/confirm-draft');
      expect(confirmed['status']).toBe('committed');
      const confirmedValue = asRecord(confirmed['value']);
      const confirmedRef = asRecord(asRecord(confirmedValue['goal'])['ref']);
      goalRef = { aggregateType: 'Goal', projectId: String(confirmedRef['projectId']),
        goalId: String(confirmedRef['goalId']) };
      goalId = goalRef.goalId;
      expect(goalId).not.toBe('');
      await waitFor(() => planLines(plan.page.root).length > 0, 5_000);
      /* 具名改坏: 确认后页面不出现确认行；本句红。 */
      expect(planLines(plan.page.root).map(lineText)).toContain('已确认目标卡，自治档位：每一步都等你确认');
    } finally {
      await plan.page.restore();
    }

    /* The pre-goal world has no project pointers; a plan on the new Goal needs
       the same architecture baseline and completion policy a project gets at
       initialization. */
    await seedArchWorld(opened.world);
    await activateArchPolicy(opened.world);
    const goalRead = asRecord((await opened.world.post('goals/read', plain(S6A_SCOPE, goalRef))).body);
    const revision = asRecord(asRecord(goalRead['value'])['goal'])['revision'] as number;
    const draft = ag2bPlanDraft(['p20-small']);
    draft.planId = 'p20-plan';
    draft.goalId = goalId;
    const proposed = asRecord((await opened.world.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef, basedOn: null, draft, reason: { text: 'P20-7 small task', sources: [] },
    }, 'p20-propose', [{ ref: goalRef, revision }]))).body);
    expect(proposed['status']).toBe('committed');
    const proposal = asRecord(proposed['value']);
    const applied = asRecord((await opened.world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposal['ref'], expectedProposalRevision: proposal['revision'], decisionRefs: [],
    }, 'p20-apply'))).body);
    expect(applied['status']).toBe('committed');

    const main = await bootE3N(opened.world, 'Main', { search: '?goal=' + encodeURIComponent(goalId), mode: 'controlled', gate: true });
    try {
      await quietPage(main.log);
      await pickTab(main.page, main.log, '任务图');
      const node = await revealTreeNode(main.page.root, 'Independent work p20-small');
      const square = findClass(node!, 'sq') ?? (hasClass(node!, 'sq') ? node! : undefined);
      expect(square).toBeDefined();
      /* 具名改坏: 小任务画成 `s-pending`（没看 eligibility）；本行的可领取方框红。 */
      expect(hasClass(square!, 's-claimable')).toBe(true);
      expect(treeNames(main.page.root)).toContain('Independent work p20-small');
    } finally {
      await main.page.restore();
    }
  }, 300_000);
});
