import { afterEach, describe, expect, it } from 'vitest';
import {
  bootDone, openDoneDeliveryWorld, openDoneTerminalOnlyWorld,
} from './helpers/E3DN-done-world.js';
import { findClass } from './helpers/boot-page.js';
import { byLabel, goalSectionRows } from './helpers/E3C-world.js';
import { buttonText, settle, worldSlot } from './helpers/E3M-world.js';
import { notConnected } from './helpers/E3N-interact.js';
import { bootE3N, descendants, textOf } from './helpers/E3N-page.js';
import { openInterruptedWorld, seePlanAdoptions } from './helpers/E3D-world.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

/**
 * E3DN-1 D01–D02 (test sheet §2.1): the rail and the goal bar of the Done
 * page. The rail's two inbox rows are the Member/Chain pages' links to Main
 * (ruling 2); the goal bar's buttons follow the Goal's state, and a cancelled
 * Goal's 重新入队 is unconnected. The open world marks its notices seen
 * through the public `decisions/notices/seen` first: the main world's own
 * steps leave three notices (rework, plan adoption, plan notice).
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const GOAL_ONE = 'ag2b-goal';
const GOAL_TWO = 's6a-goal-2';

const openWorld = () => slot.use('open', async () => {
  const done = await openDoneDeliveryWorld({ completed: false });
  await seePlanAdoptions(s6aCardsWorkspace(done.world, S6A_SCOPE), 'e3dn-d01',
    ['automatic_rework', 'plan_adoption', 'plan_notice']);
  return done;
}, (done) => done.close());
const terminalWorld = () => slot.use('terminal', () => openDoneTerminalOnlyWorld(), (done) => done.close());

describe('E3DN-1 the rail and the goal bar', () => {
  it('D01 the two inbox rows show 0, link to Main with the goal, and goal 1 is the first goal row', async () => {
    const done = await openWorld();
    const { page } = await bootE3N(done.world, 'Done', { search: `?goal=${GOAL_ONE}`, mode: 'controlled', gate: true });
    try {
      const links = () => descendants(byLabel(page.root, '需要你处理') ?? page.root)
        .filter((element) => element.tagName.toLowerCase() === 'a');
      await settle(() => links().length === 2 && goalSectionRows(page.root).length > 0, 10_000);
      /* 具名改坏: 计数 0 的行藏掉（旧的 hasDecide 按钮逻辑）；本行的“两行都在、写 0”红。 */
      expect(links().map((link) => textOf(findClass(link, 'row-name')))).toEqual(['需要你决定', '请知悉']);
      expect(links().map((link) => textOf(findClass(link, 'row-meta')))).toEqual(['0', '0']);
      for (const link of links()) {
        const href = new URL(link.getAttribute('href') ?? '', 'http://host/workbench/Done.dc.html');
        expect(href.pathname.split('/').at(-1)).toBe('Main.dc.html');
        /* 具名改坏: href 写成 `Main.dc.html`（丢 `?goal=`）；本行红。 */
        expect(href.searchParams.get('goal')).toBe(GOAL_ONE);
      }
      const first = goalSectionRows(page.root)[0];
      expect(textOf(findClass(first!, 'row-ord'))).toBe('1');
      expect(textOf(findClass(first!, 'row-name'))).toBe('S6A goal one');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D21 N31 需要你决定 is a link to Main carrying the Goal', async () => {
    const scenario = await openInterruptedWorld();
    const { page } = await bootDone(scenario.host, 'ag2b-goal');
    try {
      const decide = () => findClass(page.root, 'gb-decide');
      await settle(() => decide() !== undefined, 10_000);
      /* 具名改坏: 留成 `openDecide` 死按钮；本行的 `<a>`/href 红。 */
      expect(decide()!.tagName.toLowerCase()).toBe('a');
      const href = new URL(decide()!.getAttribute('href') ?? '', 'http://host/workbench/Done.dc.html');
      expect(href.pathname.split('/').at(-1)).toBe('Main.dc.html');
      expect(href.searchParams.get('goal')).toBe('ag2b-goal');
    } finally {
      await page.restore();
      await scenario.dispose();
    }
  }, 180_000);

  it.each([
    { entry: '① 活跃目标', goal: GOAL_ONE, has: ['暂停'], lacks: ['继续'] },
    { entry: '② 完成的目标', goal: GOAL_ONE, has: [], lacks: ['暂停', '继续', '重新入队'] },
    { entry: '③ 取消的目标', goal: GOAL_TWO, has: ['重新入队'], lacks: ['暂停', '继续'] },
  ])('D02 $entry: the goal bar buttons follow the Goal’s state', async ({ entry, goal, has, lacks }) => {
    const done = entry.startsWith('①') ? await openWorld() : await terminalWorld();
    const { page, log } = await bootDone(done.world, goal);
    try {
      const bar = () => byLabel(page.root, '目标状态');
      await settle(() => bar() !== undefined && textOf(findClass(bar()!, 'gb-state')) !== '', 10_000);
      /* 具名改坏: 按 desiredState 而不是 phase 判暂停/继续；② 的“没有暂停/继续”红。 */
      for (const name of has) expect(buttonText(bar(), name), `${entry} has ${name}`).toBeDefined();
      for (const name of lacks) expect(buttonText(bar(), name), `${entry} lacks ${name}`).toBeUndefined();
      if (entry.startsWith('③')) {
        const before = log.calls.length;
        /* 具名改坏: 让取消目标的重新入队可点（发 `goals/copy-draft`）；③ 的未接通三样/零请求红。 */
        notConnected(buttonText(byLabel(page.root, '目标状态'), '重新入队')!);
        expect(log.calls.length).toBe(before);
      }
    } finally {
      await page.restore();
    }
  }, 180_000);
});
