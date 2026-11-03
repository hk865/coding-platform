import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootPage, findButton, findClass, type BootedPage } from './helpers/boot-page.js';
import { scene } from './helpers/task-map-scene.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E34-13 (ruling 4/5): the frozen prototype screen, expressed as route replies,
 * goes through the real page: 41 nodes (40 prototype Tasks plus the real goal
 * gate), the DAG's dock and now column, and the prototype's bars, marks, ticks
 * and calendar cells. The scene is only a visual fixture, never a fact source.
 */
afterEach(() => { vi.useRealTimers(); });

async function poll(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function nodesWithClass(root: FakeElement, cls: string): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (el: FakeElement): void => {
    if ((el.getAttribute('class') ?? '').split(/\s+/).includes(cls)) found.push(el);
    for (const child of el.childNodes) if (child instanceof Object && 'tagName' in child) walk(child as FakeElement);
  };
  walk(root);
  return found;
}

type SceneBar = { id: string; kind: string; startAt: string; endAt: string | null };
type TrackReply = { value: { bars: SceneBar[]; queriesIncluded: boolean } };
type LineReply = { value: { rows: Array<{ chainSessions: Array<{ projectId: string; workspaceId: string; sessionId: string }> }> } };

function trackReply(input: Record<string, unknown>): TrackReply {
  return scene.reply('activity/track', input) as TrackReply;
}

/** The page's bars are the producer's two replies: Work/check without a
 * `sessionRefs` filter, plus the Query/talk bars of the lines' Sessions. */
function todayBars(): unknown[] {
  const lines = (scene.reply('lines/list', {}) as LineReply).value.rows;
  const sessions = lines.flatMap((row) => row.chainSessions);
  const bars = [...trackReply({}).value.bars, ...trackReply({ sessionRefs: sessions }).value.bars];
  const now = new Date(scene.now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return bars.filter((bar) => {
    const from = Date.parse(bar.startAt);
    const to = bar.endAt === null ? Infinity : Date.parse(bar.endAt);
    return from < end && to > start;
  });
}

describe('E34-13 the prototype scene reaches the page intact', () => {
  it('E34-13 the scene track reply has the real producer’s Query filter and one calendar granularity', () => {
    /* Named mutation: let the unfiltered track reply keep its Query/talk bars
       and hard-code `queriesIncluded:true` again (the old scene shape). */
    const unfiltered = trackReply({});
    expect(unfiltered.value.queriesIncluded).toBe(false);
    expect(unfiltered.value.bars.some((bar) => bar.kind === 'query' || bar.kind === 'talk')).toBe(false);

    const sessions = (scene.reply('lines/list', {}) as LineReply).value.rows.flatMap((row) => row.chainSessions);
    const filtered = trackReply({ sessionRefs: sessions });
    expect(filtered.value.queriesIncluded).toBe(true);
    expect(filtered.value.bars.length).toBeGreaterThan(0);
    for (const bar of filtered.value.bars) expect(['query', 'talk']).toContain(bar.kind);

    const one = sessions.slice(0, 1);
    const onlyOne = trackReply({ sessionRefs: one });
    const wanted = new Set(one.map((session) => session.sessionId));
    expect(onlyOne.value.queriesIncluded).toBe(true);
    for (const bar of onlyOne.value.bars) expect(wanted.has((bar as unknown as { sessionRef: { sessionId: string } }).sessionRef.sessionId)).toBe(true);

    for (const granularity of ['day', 'hour']) {
      const reply = scene.reply('activity/calendar', { granularity }) as { value: { granularity: string; cells: Array<{ localHour: unknown }> } };
      expect(reply.value.granularity).toBe(granularity);
      for (const cell of reply.value.cells) {
        if (granularity === 'hour') expect(typeof cell.localHour).toBe('number');
        else expect(cell.localHour).toBeNull();
      }
    }
  });

  it('E34-13 draws 41 real nodes, the dock, now and the scene counts without placeholder text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-13-token',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = envelope.input ?? envelope;
          return new Response(JSON.stringify(scene.reply(route, input)), { status: 200 });
        },
      });
      expect(page.root.textContent).toContain('状态机可靠性改造');

      /* The DAG view carries the prototype dock and the now column. */
      expect(nodesWithClass(page.root, 'dg-node')).toHaveLength(41);
      const dock = findClass(page.root, 'is-dock');
      expect(dock).toBeDefined();
      expect(dock!.getAttribute('class')).toContain('wl-block');
      const now = findClass(page.root, 'dg-now');
      expect(now).toBeDefined();
      expect(now!.textContent).toContain('现在');

      /* Counts are the scene's own: 25 in-window bars, one decision mark plus
         the incomplete check mark, seven returned hours for the day. */
      expect(nodesWithClass(page.root, 'tl-b')).toHaveLength(todayBars().length);
      expect(nodesWithClass(page.root, 'tl-mark')).toHaveLength(2);
      expect(nodesWithClass(page.root, 'tl-tick').length).toBeGreaterThan(0);
      /* The calendar is the full 轨道's; the DAG dock is the same data without it. */
      findButton(page.root, '轨道')!.dispatch('click');
      await poll(() => findClass(page!.root, 'cal') !== undefined);
      /* A complete scene day fills the local hours the route did not list as
         zero buckets: 24 for the day; the legend's five swatches are outside
         the calendar container and are not counted. */
      const calendar = findClass(page.root, 'cal')!;
      expect(nodesWithClass(calendar, 'cal-c')).toHaveLength(24);

      const text = page.root.textContent;
      expect(text).not.toContain('{{');
      expect(text).not.toContain('}}');
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('undefined');
    } finally {
      await page?.restore();
    }
  }, 60_000);
});
