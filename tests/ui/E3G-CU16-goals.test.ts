import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { bootPage, findClass, type PageFetch } from './helpers/boot-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  bootE3N, callsTo, countRoute, forwardPage, newPageLog, quietPage, routeOf, textOf, turns,
} from './helpers/E3N-page.js';
import { openCapWorld, openDeferredWorld } from './helpers/E3D-world.js';
import { e3gGoalRows, openE3GW1, pairsOf, rowButton, type E3GWorld } from './helpers/E3G-world.js';
import { cleanupScenarios, type HostScenario } from '../scenarios/harness.js';
import type { FakeElement } from './helpers/dom.js';
/** E3G CU16 (batch 16b): the Goals page's reasons, progress and running wait.
 * The accepted-risk label's pure rule is in `E3G-CU16-goals-pure.test.ts`. */
const scenarios: HostScenario[] = [];
const worlds: E3GWorld[] = [];
afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.world.close();
  /* Remove the shared temporary directories only after the file: between rows
     `cleanupScenarios` deletes the next Host's own public/config directories. */
  for (const scenario of scenarios.splice(0)) await scenario.dispose();
});
afterAll(cleanupScenarios);
function rowNamed(root: FakeElement, name: string): FakeElement {
  const row = e3gGoalRows(root).find((entry) => textOf(findClass(entry, 'row-name')) === name);
  expect(row).toBeDefined();
  return row!;
}
describe('E3G CU16 Goals reasons', () => {
  it('P16-1 a Goal at the automatic-rework cap shows the reason and its real progress', async () => {
    const h = await openCapWorld();
    scenarios.push(h);
    const { page, log } = await bootE3N(h.host, 'Goals');
    try {
      await turns(() => e3gGoalRows(page.root).length === 1, 15_000);
      const row = e3gGoalRows(page.root)[0]!;
      /* 具名改坏: `goalCauseSentenceOf` 不取任务行、退回“停下了”；本行的任务名和上限红。 */
      expect(textOf(findClass(row, 'gx-line'))).toContain('自动返工已达上限（3/3）');
      click(rowButton(row)!);
      await turns(() => findClass(row, 'row-more') !== undefined, 3_000);
      const pairs = pairsOf(row);
      expect(pairs.slice(0, 4).map((pair) => pair.key)).toEqual(['进度', '工作线', '改动', '自治']);
      expect(pairs.find((pair) => pair.key === '进度')!.value).toBe('0/2 已满足');
      expect(pairs.filter((pair) => pair.key === '原因').map((pair) => pair.value))
        .toContain('「Independent work ag2b-work」：自动返工已达上限（3/3）');
      await quietPage(log);
      const calls = callsTo(log, 'tasks/query')
        .filter((call) => ((call.input as { goalRef?: { goalId?: string } } | null)?.goalRef?.goalId) === 'ag2b-goal');
      expect(calls).toHaveLength(2);
    } finally {
      await page.restore();
    }
  }, 90_000);
  it('P16-2 a Goal whose required Task was deferred names the Task', async () => {
    const h = await openDeferredWorld();
    scenarios.push(h);
    const { page } = await bootE3N(h.host, 'Goals');
    try {
      await turns(() => e3gGoalRows(page.root).length === 1, 15_000);
      /* 具名改坏: `required_task_deferred` 回到不带任务名的旧句；本行的任务名红。 */
      expect(textOf(findClass(e3gGoalRows(page.root)[0]!, 'gx-line')))
        .toContain('必需的任务「Independent work ag2b-work」被延后了');
    } finally {
      await page.restore();
    }
  }, 90_000);
});
describe('E3G CU16 the running Goal wait', () => {
  it('P16-4 a running Goal says it waits, names why, and shows the wait basis', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const first = opened.world.goals.first;
    const second = opened.world.goals.second;
    const log = newPageLog();
    const forward = forwardPage(opened.world, log);
    const drivers: string[] = [];
    const waiting = { status: 'ready', value: { state: 'waiting_for_reply', last: { status: 'ready', value: {
      state: 'waiting', reason: null, waitBasis: { reasons: ['plan_adoption', 'plan_change', 'task_claimable',
        'formal_check', 'evidence', 'wait_reply', 'claim_hold:scribe_stop', 'e3g_unknown'] } } } } };
    const notFound = { status: 'rejected', code: 'not_found', reason: 'no driver for this Goal' };
    const withDriver: PageFetch = async (url, init, realFetch) => {
      if (routeOf(url) !== 'workflow/driver-read') return forward(url, init, realFetch);
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: { goalRef?: { goalId?: string } } };
      const goalId = body.input?.goalRef?.goalId ?? '';
      drivers.push(goalId);
      const reply = goalId === first.goalId ? waiting : notFound;
      log.calls.push({ route: 'workflow/driver-read', url, input: body.input ?? null, body, token: '', reply });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const page = await bootPage({ name: 'Goals', search: `?goal=${first.goalId}`,
      token: opened.world.token, request: withDriver });
    try {
      await turns(() => e3gGoalRows(page.root).length === 2 && countRoute(log, 'goals/list') === 2, 15_000);
      await quietPage(log);
      const firstRow = rowNamed(page.root, 'S6A goal one');
      const secondRow = rowNamed(page.root, 'S6A goal two');
      /* 具名改坏: `driverWaitOf` 不认 `waiting_for_reply`；本行的“在等”红。 */
      expect(textOf(findClass(firstRow, 'gx-line'))).toMatch(/在等回复或新进展$/);
      expect(textOf(findClass(secondRow, 'gx-line'))).not.toContain('在等回复或新进展');
      click(rowButton(firstRow)!);
      await turns(() => findClass(firstRow, 'row-more') !== undefined, 3_000);
      const waited = pairsOf(firstRow).filter((pair) => pair.key === '在等');
      expect(waited).toHaveLength(1);
      expect(waited[0]!.value).toBe('回复、暂缓解除');
      click(rowButton(secondRow)!);
      await turns(() => findClass(secondRow, 'row-more') !== undefined, 3_000);
      expect(pairsOf(secondRow).some((pair) => pair.key === '在等')).toBe(false);
      expect(drivers.filter((id) => id === first.goalId)).toHaveLength(2);
      expect(drivers.filter((id) => id === second.goalId)).toHaveLength(2);
    } finally {
      await page.restore();
    }
  }, 90_000);
});
