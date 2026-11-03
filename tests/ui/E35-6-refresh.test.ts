import { describe, expect, it } from 'vitest';
import { withE35Page } from './helpers/e35-host.js';
import { sceneData, sceneView, type Row } from './helpers/e35-scene.js';
import { until } from '../helpers/change-stream-reader.js';

/** E35-6: refresh, a dropped stream (E3-3, HO:1963) and a failed reread (E3-3 ruling item 5: every 2 s, no cap). */

describe('E35-6 refresh', () => {
  it('E35-6 6.1 a dropped stream is said on the goal bar over a known line count', () => {
    /* Named mutation: the known line count outranks the stale text again (the order before 6.1). */
    expect(sceneView([], sceneData(), {}, { status: 'ready', stale: true, staleText: '连接断开，正在重连。' }).vals().barWhy).toBe('连接断开，正在重连。');
  });

  it('E35-6 6.2 a failed reread over shown data is tried again in 2 s, and 读取失败。 goes by itself', async () => {
    /* Named mutation: no 2 s retry after a failed reread over data; 读取失败。 stays. */
    let fail = false;
    await withE35Page((route) => (fail && route === 'goals/read' ? { status: 'rejected', code: 'e35_6', reason: 'down' } : undefined), async (page, notify) => {
      fail = true; notify();
      await until(() => page.root.textContent.includes('读取失败。'), 20_000);
      fail = false;
      await until(() => !page.root.textContent.includes('读取失败。'), 6_000);
    });
  }, 60_000);

  it('E35-6 6.3 a stream the Host refuses for too many pages says so', async () => {
    /* Named mutation: drop the 429 reason in host-client's onEnd; the bar says 连接断开，正在重连。 */
    await withE35Page(() => undefined, async (page) => {
      await until(() => page.root.textContent.includes('这台主机同时打开的页面太多，这一页暂时不自动更新；关掉别的页签后会自己接上。'), 8_000);
    }, () => new Response('{}', { status: 429 }));
  }, 60_000);

  it('E35-6 6.4 the right column’s 回到现在 withdraws the replay reads as the track’s does', () => {
    /* Named mutation: the right column's 回到现在 only sets t to null. */
    const calls: Row[] = [];
    const { vals, state } = sceneView(calls);
    vals().wl.cur.key({ key: 'Home' });
    (vals().now as unknown as { back(): void }).back();
    expect([calls.at(-1), state().t]).toEqual([{ replay: false, archive: false }, null]);
  });
});
