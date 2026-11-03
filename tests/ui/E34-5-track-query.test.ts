import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHostClient } from '../../src/ui/host-client.js';
import { readTaskMap } from '../../src/ui/boot.js';
import type { TaskMapTimeData } from '../../src/ui/adapters/task-map.js';
import { openS6ARequestWorld, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { ag2bPlanDraft } from '../helpers/AG2b-collaboration-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { adoptE34Plan } from './helpers/E34-plan.js';
import { bootPage, findButton, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';

/** E34-5 (design §3/§5): a turn Query sits on the original line, a
 * consultation sits on the asked line, the QueryRunRef is never counted twice
 * and a Query with no Task ref gets no guessed Task. */
let world: S6ARequestWorld | undefined;
let time: TaskMapTimeData;
let lineRef: { sessionId: string };
let copyRef: { sessionId: string };

beforeAll(async () => {
  world = await openS6ARequestWorld({ backend: 'memory' });
  await governS6B(world, s6aCardsWorkspace(world, S6A_SCOPE), world.goals);
  const draft = ag2bPlanDraft(['e34-5-a']);
  draft.planId = 'e34-5-plan'; draft.goalId = world.goals.first.goalId;
  await adoptE34Plan(world, S6A_SCOPE, world.goals.first, draft, 'track-query');
  const line = await world.createWorkSession('e34-5-line');
  lineRef = line.ref;
  const turn = await world.occupy(line);
  await world.finishQuery(turn);
  const copy = await world.makeReadonlyCopy(line, 'e34-5-copy');
  copyRef = copy.copy.ref;
  const client = createHostClient(world.token, new URL(world.base).origin);
  const { data } = await readTaskMap(client, world.goals.first.goalId, { track: true });
  if (!data?.time) throw new Error('E34-5: the track was not read');
  time = data.time;
}, 40_000);

afterAll(async () => { await world?.close(); world = undefined; });

afterEach(() => { vi.useRealTimers(); });

/** Poll with the process clock; the page's own timers are not involved. */
async function poll(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function nodesWithClass(root: FakeElement, cls: string): FakeElement[] {
  const found: FakeElement[] = [];
  const seen = new Set<FakeElement>();
  const stack = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (seen.has(el)) continue;
    seen.add(el);
    if ((el.getAttribute('class') ?? '').split(/\s+/).includes(cls)) found.push(el);
    for (const child of el.childNodes) if (child instanceof Object && 'tagName' in child) stack.push(child as FakeElement);
  }
  return found;
}

describe('E34-5 Query placement on the real track', () => {
  it('E34-5 places the turn and the consultation by line, counts each QueryRunRef once and guesses no Task', () => {
    const bars = time.rows.flatMap((row) => row.bars.filter((bar) => bar.kind === 'query'));
    expect(bars.length).toBeGreaterThan(0);
    const keys = bars.map((bar) => bar.id);
    expect(new Set(keys).size).toBe(keys.length);
    const turnBar = bars.find((bar) => bar.via === 'turn')!;
    expect(turnBar).toBeDefined();
    expect(turnBar.taskId).toBe('');
    const consultation = bars.find((bar) => bar.via === 'consultation')!;
    expect(consultation).toBeDefined();
    expect(consultation.taskId).toBe('');
    const turnRow = time.rows.find((row) => row.bars.some((bar) => bar.id === turnBar.id))!;
    const askedRow = time.rows.find((row) => row.bars.some((bar) => bar.id === consultation.id))!;
    /* A turn and the consultation asked from that line both belong to the
       asked line; the read-only copy is a separate Session and never a
       continuation of it. */
    expect(turnRow.id).toBe(askedRow.id);
    expect(turnRow.sessionId).toBe(lineRef.sessionId);
    expect(time.rows.some((row) => row.sessionId === copyRef.sessionId)).toBe(false);
    expect(askedRow.name).toBeTruthy();
  });

  it('E34-5 draws the turn and the consultation on the asked line once, with the copy separate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: `?goal=${world!.goals.first.goalId}`, token: world!.token,
        request: async (url, init, realFetch) => realFetch(new URL(url, world!.base).href, init),
      });
      findButton(page!.root, '轨道')!.dispatch('click');
      await poll(() => nodesWithClass(page!.root, 'k-talk').length + nodesWithClass(page!.root, 'k-query').length >= 2);
      /* The prototype keeps the turn as `k-talk` and the consultation as
         `k-query`; each QueryRunRef is drawn once, on the asked line. */
      expect(nodesWithClass(page!.root, 'k-talk')).toHaveLength(1);
      expect(nodesWithClass(page!.root, 'k-query')).toHaveLength(1);
      const rows = nodesWithClass(page!.root, 'wl-row').filter((row) =>
        nodesWithClass(row, 'k-talk').length + nodesWithClass(row, 'k-query').length > 0);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain('执行者');
      expect(page!.root.textContent).not.toContain('状态机可靠性改造');
      /* The read-only copy is a separate Session and never a row of its own. */
      expect(nodesWithClass(page!.root, 'wl-row').some((row) => row.textContent.includes(copyRef.sessionId))).toBe(false);
    } finally {
      await page?.restore();
    }
  }, 60_000);
});