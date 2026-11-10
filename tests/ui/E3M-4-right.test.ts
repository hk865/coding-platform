import { afterAll, describe, expect, it } from 'vitest';
import { findAllClass, findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { countRoute, descendants, hasClass, textOf } from './helpers/E3N-page.js';
import { hover, leave } from './helpers/E3N-interact.js';
import {
  bootMemberAt, bootMemberOnHost, detailValue, elementsOf, memberSearch, openMemberS7C, openMemberW3, openMemberW4,
  press, recordRows, settle, worldSlot,
} from './helpers/E3M-world.js';

/**
 * E3M-4 (test sheet §2.4, M31–M41): the right panel — records grouped by
 * Task with group heads that link to the Task's own Goal, a record's detail
 * (语义/关系 still 还没接通), the workspace's uncommitted files read only when
 * 改动 opens, and the raw trace read only when 轨迹 opens.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const w3 = () => slot.use('W3', () => openMemberW3(), (opened) => opened.close());
const w4 = () => slot.use('W4', () => openMemberW4(), (opened) => opened.h.dispose());
const w1 = () => slot.use('W1', () => openMemberS7C(), (opened) => opened.s7c.close());

const panel = (root: FakeElement): FakeElement | undefined => findClass(root, 'panel');
const tab = (root: FakeElement, name: string): FakeElement | undefined =>
  findElement(root, (element) => element.getAttribute('role') === 'tab' && textOf(element) === name);
const groupHeads = (root: FakeElement): FakeElement[] => findAllClass(panel(root) ?? root, 'sgh');
const headLink = (head: FakeElement): FakeElement | undefined => elementsOf(head, 'a', 'sg')[0];
/** A group head's Task name: the span after its square (`Member.dc.html:974-977`). */
const groupName = (head: FakeElement): string => textOf(elementsOf(headLink(head), 'span')[1]);
const goalOf = (link: FakeElement | undefined): URL => new URL(link?.getAttribute('href') ?? '', 'http://host/workbench/Member.dc.html');
const traceRows = (root: FakeElement): FakeElement[] =>
  findAllClass(findClass(root, 'lg') ?? root, 'lg-row').filter((row) => !hasClass(row, 'lg-th'));

const bootW3 = async () => {
  const w = await w3();
  return await bootMemberAt(w.world, memberSearch('ag2b-goal', w.worker.ref));
};

describe('E3M-4 the Member right panel', () => {
  it('R30 工作记录 groups the records under their three Tasks (M31)', async () => {
    const { page } = await bootW3();
    try {
      expect(tab(page.root, '工作记录')?.getAttribute('aria-selected')).toBe('true');
      /* 具名改坏: 所有记录塞进一个组；本行的组头数红。 */
      expect(groupHeads(page.root).map(groupName).sort())
        .toEqual(['Independent work ag2b-work', 'Independent work ag2b-work', 'Independent work s6a-cards-work-2']);
      const sections = elementsOf(panel(page.root), 'div', 'rail-sec').filter((section) => findClass(section, 'sgh') !== undefined);
      expect(sections).toHaveLength(3);
      for (const section of sections) expect(elementsOf(section, 'button', 'row').length).toBeGreaterThanOrEqual(1);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it.each([{ goal: 'ag2b-goal' }, { goal: 's6a-goal-2' }])('R32 the group head of $goal links to its own Goal and hovers without a read (M33)', async ({ goal }) => {
    const { page, log } = await bootW3();
    try {
      const index = groupHeads(page.root).findIndex((head) => goalOf(headLink(head)).searchParams.get('goal') === goal);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(goalOf(headLink(groupHeads(page.root)[index]!)).pathname).toBe('/workbench/Main.dc.html');
      const hovers = countRoute(log, 'graph/hover');
      const tooltip = () => findElement(groupHeads(page.root)[index]!, (element) => element.getAttribute('role') === 'tooltip');
      hover(headLink(groupHeads(page.root)[index]!)!);
      await settle(() => tooltip() !== undefined);
      expect(tooltip()).toBeDefined();
      leave(headLink(groupHeads(page.root)[index]!)!);
      await settle(() => tooltip() === undefined);
      expect(tooltip()).toBeUndefined();
      /* 具名改坏: 悬停时再读 `graph/hover`；两个条目的请求数红。 */
      expect(countRoute(log, 'graph/hover')).toBe(hovers);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R33 a record’s detail says 还没接通 for 语义 and 关系 and reads no graph detail (M34/G05)', async () => {
    const { page, log } = await bootW3();
    try {
      press(recordRows(page.root)[0], 'the first record row');
      await settle(() => findClass(page.root, 'detail') !== undefined);
      /* 具名改坏: 详情读 `graph/detail` 填语义/关系；本行的零请求/两处 `还没接通` 红。 */
      expect(detailValue(page.root, '语义')).toBe('还没接通');
      expect(detailValue(page.root, '关系')).toBe('还没接通');
      expect(countRoute(log, 'graph/detail')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R34 关闭详情 closes the detail without a request (M37)', async () => {
    const { page, log } = await bootW3();
    try {
      expect(countRoute(log, 'lines/read')).toBe(1);
      press(recordRows(page.root)[0], 'the first record row');
      await settle(() => findClass(page.root, 'detail') !== undefined);
      const before = log.calls.length;
      press(findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-label') === '关闭详情'), '关闭详情');
      await settle(() => findClass(page.root, 'detail') === undefined);
      expect(findClass(page.root, 'detail')).toBeUndefined();
      /* 具名改坏: 关闭时重读；本行的请求数红。 */
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R31a 改动 reads the workspace files only when it opens (M32, DM3)', async () => {
    const w = await w4();
    const { page, log } = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      /* 具名改坏: `readMember` 首读就带 `files/*`；本行的“点击前 0”红。 */
      expect(countRoute(log, 'files/list')).toBe(0);
      press(tab(page.root, '改动'), '改动');
      await settle(() => countRoute(log, 'files/uncommitted') > 0);
      expect(countRoute(log, 'files/list')).toBe(1);
      expect(countRoute(log, 'files/uncommitted')).toBe(1);
      const call = log.calls.find((entry) => entry.route === 'files/uncommitted');
      expect((call?.input as { paths?: string[] } | undefined)?.paths).toContain('src/e3m-change.ts');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('R31b the workspace change shows +3 −0 under 只在本任务的工作区 (M32 部分, DMT5)', async () => {
    const w = await w4();
    const { page, log } = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      press(tab(page.root, '改动'), '改动');
      const step = () => findAllClass(panel(page.root) ?? page.root, 'step')
        .find((entry) => textOf(findClass(entry, 'step-obj')) === 'src/e3m-change.ts');
      await settle(() => step() !== undefined);
      /* 具名改坏: `member.ts` 用 `tasks/query` 的 `plannedFiles` 造文件行；本行的 path/`+3` 红。 */
      expect(step()).toBeDefined();
      expect(textOf(findClass(step()!, 'step-meta'))).toBe('+3 −0');
      expect(textOf(panel(page.root))).toContain('只在本任务的工作区');
      expect(countRoute(log, 'graph/detail')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R35a 轨迹 reads the line’s history only when it opens (M40)', async () => {
    const w = await w1();
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      /* 具名改坏: `readMember` 首读就带 `sessions/history`；本行的“点击前 0”红。 */
      expect(countRoute(log, 'sessions/history')).toBe(0);
      press(tab(page.root, '轨迹'), '轨迹');
      await settle(() => countRoute(log, 'sessions/history') > 0);
      expect(countRoute(log, 'sessions/history')).toBe(1);
      expect(log.calls.find((entry) => entry.route === 'sessions/history')?.input).toEqual({
        sessionRef: { projectId: 'ag2b-collab-project', sessionId: w.module.sessionId },
        afterCursor: null, throughCursor: null, limit: 100,
      });
      expect(tab(page.root, '轨迹')?.getAttribute('aria-selected')).toBe('true');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('R35b the trace’s type column shows the record kinds as they are (M41)', async () => {
    const w = await w1();
    const { page } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      press(tab(page.root, '轨迹'), '轨迹');
      await settle(() => traceRows(page.root).length > 0);
      const types = traceRows(page.root).map((row) => textOf(findAllClass(row, 'lg-c')[1]));
      expect(types.length).toBeGreaterThan(0);
      /* 具名改坏: `member.ts` 把 `kind` 归成“推理/工具/消息/检查”；本行的类型列红。 */
      for (const type of types) expect(['session_created', 'turn_started', 'agent_event']).toContain(type);
      for (const word of ['推理', '工具', '消息', '检查']) expect(types).not.toContain(word);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R35c a record number shows its raw text without another read (M41)', async () => {
    const w = await w1();
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      press(tab(page.root, '轨迹'), '轨迹');
      await settle(() => traceRows(page.root).length > 0 && countRoute(log, 'sessions/history') > 0);
      const histories = countRoute(log, 'sessions/history');
      expect(histories).toBe(1);
      const number = traceRows(page.root).map((row) => descendants(row)
        .find((element) => element.tagName.toLowerCase() === 'button'))[0];
      press(number, 'the first record number');
      const raw = () => findAllClass(page.root, 'step-detail').find((element) => hasClass(element, 'raw'));
      await settle(() => raw() !== undefined);
      expect(raw()).toBeDefined();
      /* 具名改坏: 点编号重新读 `sessions/history`；本行的请求数红。 */
      expect(countRoute(log, 'sessions/history')).toBe(histories);
    } finally {
      await page.restore();
    }
  }, 120_000);
});

