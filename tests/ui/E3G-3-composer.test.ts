import { afterEach, describe, expect, it } from 'vitest';
import {
  bootE3N, countRoute, descendants, hasClass, textOf, turns, type PageLog,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { findButton, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { openE3GW1, e3gSettled, type E3GWorld } from './helpers/E3G-world.js';

/**
 * E3G-3 G20–G24 (test sheet §2.3): 问秘书, the composer, `requests/submit` and
 * the one `requests/read`. W1's conflict card supplies the visible reference;
 * the page submits the typed text and, from a node's 在对话里问, that file.
 */

const worlds: E3GWorld[] = [];
afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.world.close();
});

function composer(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('id') === 'goals-composer');
}

function sendButton(root: FakeElement): FakeElement | undefined {
  return descendants(root).find((element) => element.tagName.toLowerCase() === 'button'
    && element.getAttribute('aria-label') === '发送');
}

function logs(root: FakeElement, name: string): FakeElement[] {
  return descendants(root).filter((element) => hasClass(element, name));
}

function submitInput(log: PageLog): Record<string, unknown> {
  const call = log.calls.filter((entry) => entry.route === 'requests/submit').at(-1)!;
  /* T3: `client.post` sends `{scope, input}`; `requests/submit` is a plain route, not a graph write. */
  return (call.body as { input: Record<string, unknown> }).input;
}

function submitAnswer(log: PageLog): { status?: string; requestRoot?: { projectId: string; queryJobId: string } } {
  return log.submits.at(-1) as { status?: string; requestRoot?: { projectId: string; queryJobId: string } };
}

async function openCard(opened: E3GWorld): Promise<{ page: BootedPage; log: PageLog }> {
  const booted = await bootE3N(opened.world, 'Goals');
  /* T1: the baseline is after the first read and the stream-open reread. */
  await e3gSettled(booted.log, true);
  await turns(() => findClass(booted.page.root, 'plan') !== undefined, 800);
  return booted;
}

async function openComposer(booted: { page: BootedPage; log: PageLog }): Promise<void> {
  const ask = findButton(booted.page.root, '问秘书');
  expect(ask).toBeDefined();
  click(ask!);
  await turns(() => composer(booted.page.root) !== undefined, 800);
}

function type(page: BootedPage, text: string): void {
  const box = composer(page.root);
  expect(box).toBeDefined();
  box!.value = text;
  box!.dispatch('input', { target: box, currentTarget: box });
}

async function send(page: BootedPage, log: PageLog): Promise<void> {
  const button = sendButton(page.root);
  expect(button).toBeDefined();
  click(button!);
  await turns(() => log.submits.length === 1, 800);
  await turns(() => countRoute(log, 'requests/submit') === 1, 800);
}

describe('E3G-3 asking the secretary', () => {
  it('G20 问秘书 opens the composer with the conflict reference and writes nothing', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const booted = await openCard(opened);
    try {
      expect(countRoute(booted.log, 'goals/conflicts')).toBe(2);
      await openComposer(booted);
      /* 具名改坏: 预填文字只写“冲突”；G20 的文件名红。 */
      expect(composer(booted.page.root)).toBeDefined();
      const ref = textOf(findClass(booted.page.root, 'composer-ref'));
      expect(ref).toContain('目标 2');
      expect(ref).toContain('目标 1');
      expect(ref).toContain('src/ui/views.ts');
      expect(countRoute(booted.log, 'decisions/answer')).toBe(0);
      expect(countRoute(booted.log, 'requests/submit')).toBe(0);
    } finally {
      await booted.page.restore();
    }
  }, 60_000);

  it('G21 sending submits exactly the typed text for the current Goal', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const booted = await openCard(opened);
    try {
      await openComposer(booted);
      type(booted.page, '把冲突记下来');
      await send(booted.page, booted.log);
      /* 具名改坏: 把 `text` 写成 `#goals-composer` 的 `value` 之外的占位文字；G21 的 `text` 等值红。 */
      const input = submitInput(booted.log);
      expect(input['text']).toBe('把冲突记下来');
      expect(input['goalId']).toBe(opened.world.goals.first.goalId);
      expect(input['references']).toEqual([]);
      expect(typeof input['commandId']).toBe('string');
      expect(input['commandId']).not.toBe('');
      expect(submitAnswer(booted.log).status).toBe('queued');
    } finally {
      await booted.page.restore();
    }
  }, 60_000);

  it('G22 the composer closes, the bubble shows the text and requests/read carries its root', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const booted = await openCard(opened);
    try {
      await openComposer(booted);
      type(booted.page, '把冲突记下来');
      await send(booted.page, booted.log);
      /* 具名改坏: 发送后不清草稿/不关 composer；G22 的“不存在”红。 */
      await turns(() => composer(booted.page.root) === undefined, 800);
      expect(composer(booted.page.root)).toBeUndefined();
      await turns(() => logs(booted.page.root, 'msg-user').length === 1, 800);
      expect(logs(booted.page.root, 'msg-user').map((bubble) => textOf(bubble))).toEqual(['把冲突记下来']);
      await turns(() => countRoute(booted.log, 'requests/read') >= 1, 800);
      const root = submitAnswer(booted.log).requestRoot;
      expect(root).toBeDefined();
      const read = booted.log.calls.filter((entry) => entry.route === 'requests/read').at(-1)!;
      expect((read.input as { requestRoot: unknown }).requestRoot).toEqual(root);
    } finally {
      await booted.page.restore();
    }
  }, 60_000);

  it('G23 the send button is off while the draft is empty and writes nothing', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const booted = await openCard(opened);
    try {
      expect(countRoute(booted.log, 'goals/conflicts')).toBe(2);
      await openComposer(booted);
      const button = sendButton(booted.page.root);
      expect(button).toBeDefined();
      /* 具名改坏: 去掉 `draft.trim()` 的判断；G23 的零请求红。 */
      expect(hasClass(button!, 'is-off')).toBe(true);
      click(button!);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(countRoute(booted.log, 'requests/submit')).toBe(0);
    } finally {
      await booted.page.restore();
    }
  }, 60_000);

  it('G24 在对话里问 sends the selected file as one structured reference', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const booted = await openCard(opened);
    try {
      const ref = descendants(booted.page.root).find((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'ref') && textOf(element) === 'src/ui/views.ts');
      expect(ref).toBeDefined();
      click(ref!);
      await turns(() => findClass(booted.page.root, 'detail') !== undefined, 800);
      const acts = descendants(findClass(booted.page.root, 'detail')!)
        .filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'btn-text'));
      const ask = acts.find((element) => textOf(element) === '在对话里问');
      expect(ask).toBeDefined();
      click(ask!);
      await turns(() => composer(booted.page.root) !== undefined, 800);
      type(booted.page, '这个文件为什么冲突');
      await send(booted.page, booted.log);
      /* 具名改坏: 把 `references` 写成 `[]`；G24 的 `path` 红。 */
      const input = submitInput(booted.log);
      const references = input['references'] as Array<{ path?: string }>;
      expect(references).toHaveLength(1);
      expect(references[0]!.path).toBe('src/ui/views.ts');
      expect(input['goalId']).toBe(opened.world.goals.first.goalId);
      expect(input['text']).toBe('这个文件为什么冲突');
      expect(submitAnswer(booted.log).status).toBe('queued');
    } finally {
      await booted.page.restore();
    }
  }, 60_000);
});
