import { afterAll, describe, expect, it } from 'vitest';
import { findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { click } from './helpers/E3N-interact.js';
import {
  callsTo, countRoute, descendants, lineRows, onBoard, quietPage, settledN, waitFor,
  type PageLog,
} from './helpers/E3N-page.js';
import { lineOrder } from './helpers/E3N-world.js';
import { buttonText, openMemberS7C, UUID_V4, worldSlot, type E3MW1 } from './helpers/E3M-world.js';
import { typeInto } from './helpers/E3D-page.js';

/**
 * 5a (7D2 CU5A): the Plan page's line view. The rail's data lines open
 * `lines/read`; the view's four controls, its 整页查看 and 回到主对话 are Main's,
 * and 问一问 goes through the line's published pins.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);

const S7C = { search: '?goal=s7c-goal' };

/** The rail button of `lines/list` row `index` (after the synthetic 秘书（主对话） row). */
function railButton(root: FakeElement, index: number): FakeElement | undefined {
  const holder = lineRows(root)[index + 1];
  return holder === undefined ? undefined
    : descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
}

const moduleIndex = async (w: E3MW1): Promise<number> =>
  (await lineOrder(async (route, request) => (await w.s7c.world.post(route, request)).body)).indexOf(w.module.sessionId);

async function openModuleLine(w: E3MW1, body: (page: BootedPage, log: PageLog) => Promise<void>): Promise<void> {
  const index = await moduleIndex(w);
  expect(index).toBeGreaterThanOrEqual(0);
  await onBoard('Plan', w.s7c.world, async (page, log): Promise<void> => {
    await waitFor(() => railButton(page.root, index) !== undefined);
    click(railButton(page.root, index)!);
    await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined);
    await quietPage(log);
    await body(page, log);
  }, S7C);
}

/** The line view's own composer (the `.composer` holding `#lv-input`): its send button. */
function lineSend(root: FakeElement): FakeElement | undefined {
  const composer = findClass(root, 'composer');
  return composer === undefined ? undefined : findClass(composer, 'send');
}

describe('E3P-7 the Plan line view', () => {
  it('opens the line, pauses it, links its full page and returns with no request', async () => {
    const w = await slot.use('held', () => openMemberS7C({ firstRun: 'held' }), (opened) => opened.s7c.close());
    const index = await moduleIndex(w);
    expect(index).toBeGreaterThanOrEqual(0);
    await onBoard('Plan', w.s7c.world, async (page, log) => {
      await waitFor(() => railButton(page.root, index) !== undefined);
      const before = countRoute(log, 'lines/read');
      click(railButton(page.root, index)!);
      await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined);
      await quietPage(log);
      /* The click reads this line once, with its key. */
      expect(countRoute(log, 'lines/read')).toBe(before + 1);
      expect((callsTo(log, 'lines/read').at(-1)!.input as { key?: unknown }).key)
        .toEqual(w.module);

      click(buttonText(findClass(page.root, 'lv-acts'), '暂停')!);
      await settledN(log, 'controls/submit', 1);
      expect(callsTo(log, 'controls/submit')[0]!.input)
        .toEqual({ runRef: w.s7c.run.runRef, kind: 'pause', reason: null });

      const href = findClass(page.root, 'plink')!.getAttribute('href')!;
      const url = new URL(href, 'http://host/workbench/Plan.dc.html');
      expect(url.searchParams.get('lineProject')).toBe('ag2b-collab-project');
      expect(url.searchParams.get('lineSession')).toBe(w.module.sessionId);

      const sent = log.calls.length;
      click(findClass(page.root, 'lv-back')!);
      /* PB-M4: going back is local, zero requests in the click's own turn. */
      expect(findClass(page.root, 'lv-headbar')).toBeUndefined();
      expect(log.calls.length).toBe(sent);
    }, S7C);
  }, 180_000);

  it('问一问 sends one queries/ask to the module line', async () => {
    const w = await slot.use('ended', () => openMemberS7C({ firstRun: 'ended' }), (opened) => opened.s7c.close());
    await openModuleLine(w, async (page, log) => {
      typeInto(page.root, 'lv-input', '刚才改了哪些文件');
      click(lineSend(page.root)!);
      await settledN(log, 'queries/ask', 1);
      await quietPage(log);
      const sent = callsTo(log, 'queries/ask')[0]!;
      expect((sent.input as { sessionRef?: unknown }).sessionRef).toEqual(w.module);
      expect((sent.input as { commandId?: unknown }).commandId).toMatch(UUID_V4);
      /* SPEC-9: the draft is cleared once the ask is answered. */
      expect(findElement(page.root, (element) => element.getAttribute('id') === 'lv-input')!.value).toBe('');
    });
  }, 180_000);
});
