/**
 * D9 (Q frozen row; 121-146/R6 U1): the Decide page writes the one line "暂时读不到：计划候选。其余照常显示。" and
 * stops saying there is nothing to handle. The queue is one ready page with `candidate: read_failed` and no cards;
 * every other route is W1's real Host. Today the page has no line and still shows the empty state.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { bootPage } from './helpers/boot-page.js';
import { routeOf } from './helpers/E3N-page.js';
import { settle } from './helpers/E3D-page.js';
import { openE3GW1, type E3GWorld } from './helpers/E3G-world.js';

let opened: E3GWorld | null = null;
afterAll(async () => { await opened?.world.close(); opened = null; });

const QUEUE = {
  waitingAnswer: [], answeredPendingApplication: [], history: [], notices: [],
  counts: { waitingAnswer: 0, answeredPendingApplication: 0, notices: {} }, countsComplete: false,
  nextCursor: null, sourceCursor: null, seenThrough: {}, displayToken: null,
  capabilities: [{ source: 'candidate', availability: 'read_failed', reason: 'injected source failure' }],
};

describe('D9 the Decide page unreadable line', () => {
  it('names the unreadable card source and does not say the page is empty', async () => {
    opened ??= await openE3GW1();
    let queueReads = 0;
    const page = await bootPage({
      name: 'Decide', token: opened.world.token,
      request: async (url, init, realFetch) => {
        if (routeOf(url) === 'decisions/queue') {
          queueReads += 1;
          return new Response(JSON.stringify({ status: 'ready', value: QUEUE }),
            { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return await realFetch(new URL(url, opened!.world.base).toString(), init);
      },
    });
    try {
      await settle(() => queueReads > 0 && page.root.textContent.includes('暂时读不到'), 8_000);
      expect(page.root.textContent).toContain('暂时读不到：计划候选。其余照常显示。');
      expect(page.root.textContent).not.toContain('现在没有需要你处理的事。');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
