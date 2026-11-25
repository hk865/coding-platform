import { afterEach, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import { bootE3N, descendants, lineRows, quietPage, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { lineOrder } from './helpers/E3N-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  openS7AWorkWorld, runS7ASameSessionAgain, seedS7AGoalPlan,
} from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage, withdrawS7A2Message } from '../helpers/S7A2-fixture.js';

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

describe('4b line view message facts', () => {
  it('⑦ a withdrawn message says 消息已撤回 in the line view', async () => {
    const opened = await openS7AWorkWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const source = await seedS7AGoalPlan(opened.world);
    const sent = await sendS7A2PersonMessage(opened.world, {
      label: 'e3u-4b-w', recipient: opened.line.ref, goal: source.goal,
    });
    await withdrawS7A2Message(opened.world, sent, 'e3u-4b-w');
    const index = (await lineOrder((route, body) => opened.world.post(route, body).then((reply) => reply.body), S6A_SCOPE))
      .indexOf(opened.line.ref.sessionId);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: `?goal=${source.goal.goalId}` });
    try {
      await openRailLine(page, log, index);
      /* 具名改坏: `lvRecordOf` 不填 `closed`；这一条红。 */
      await waitFor(() => page.root.textContent.includes('消息已撤回'));
      expect(page.root.textContent).toContain('S7A2 e3u-4b-w message');
      expect(textOf(findClass(page.root, 'lv-thread'))).toContain('消息已撤回');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
