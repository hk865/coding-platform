import { afterEach, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import { bootE3N, descendants, lineRows, quietPage, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { lineOrder } from './helpers/E3N-world.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import {
  cancelS7AGoal, committed, openS7AWorkWorld, ready, runS7ASameSessionAgain, seedS7AGoalPlan,
} from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { GoalCopyConfirmResultV1, GoalCopyDraftResultV1 } from '../../src/contracts/goal-card.js';

const worlds: Array<Awaited<ReturnType<typeof openS7AWorkWorld>>['world']> = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map((world) => world.close()));
});

async function openRailLine(page: { root: Parameters<typeof lineRows>[0] }, log: Parameters<typeof quietPage>[0], index: number): Promise<void> {
  const button = (): ReturnType<typeof findClass> => {
    const holder = lineRows(page.root)[index + 1];
    if (holder === undefined) return undefined;
    return descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
  };
  await waitFor(() => lineRows(page.root).length > index + 1);
  click(button()!);
  await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined);
  await quietPage(log);
}

describe('4b forwarded message facts', () => {
  it('⑧ a forwarded copy and its original name each other line in the same view', async () => {
    const opened = await openS7AWorkWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const main = s6aCardsWorkspace(opened.world, S6A_SCOPE);
    const source = await seedS7AGoalPlan(opened.world);
    const a = await sendS7A2PersonMessage(opened.world, {
      label: 'e3u-4b-f', recipient: opened.line.ref, goal: source.goal,
    });
    await runS7ASameSessionAgain(opened.world, opened.line);
    await cancelS7AGoal(opened.world, source.goal);
    const draft = ready<GoalCopyDraftResultV1>(
      await opened.world.post('goals/copy-draft', plain(S6A_SCOPE, { goalRef: source.goal })), 'the copy draft');
    const born = committed<GoalCopyConfirmResultV1>(await opened.world.post('goals/copy-confirm', plain(S6A_SCOPE, {
      commandId: 'e3u-4b-copy', sourceGoalRef: draft.source.goal, expectedSourceRevision: draft.source.revision,
      selectedInterventions: [a.ref],
    })), 'the copy');
    await adoptS6BPlan(main, born.goal.ref, { label: 'e3u-4b-copy', taskIds: ['e3u-4b-copy-1'], role: S6A_WORK_ROLE.templateId });
    const select = { schemaVersion: 1 as const, goalRef: born.goal.ref, flowId: 'e3u-4b-copy-first', sessionHint: null, kind: 'select_work' as const };
    expect(await opened.world.dispatch('workflow/advance', opened.world.systemContext(), plain(S6A_SCOPE, select)))
      .toMatchObject({ status: 'ready' });
    const original = await readS7BMessage(opened.world, a.ref);
    const inbox = await inboxOf(opened.world, opened.line.ref);
    const copy = inbox.find((message) => message.originalRef?.messageId === a.ref.messageId);
    expect(original.transferredTo).not.toBeNull();
    expect(copy).toBeDefined();
    const listed = (await opened.world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE })))
      .body as { value: { rows: Array<{ key: { sessionId: string }; name: { primary: string } }> } };
    const lineName = listed.value.rows.find((row) => row.key.sessionId === opened.line.ref.sessionId)?.name.primary;
    expect(lineName).toBeDefined();
    const index = (await lineOrder((route, body) => opened.world.post(route, body).then((reply) => reply.body), S6A_SCOPE))
      .indexOf(opened.line.ref.sessionId);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: `?goal=${source.goal.goalId}` });
    try {
      await openRailLine(page, log, index);
      /* 具名改坏: `lvRecordOf` 的 `closed` 只认 `withdrawnAt`；这两条断言红。 */
      await waitFor(() => page.root.textContent.includes(`已转交给 ${lineName}`));
      expect(page.root.textContent).toContain(`转自 ${lineName} 的一条消息`);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
