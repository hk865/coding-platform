import { afterAll, describe, expect, it } from 'vitest';
import { findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { countRoute, mainHeadTitle, textOf } from './helpers/E3N-page.js';
import {
  bootMemberAt, callsOf, headFact, memberSearch, press, settle, worldSlot,
} from './helpers/E3M-world.js';
import { openS9ReviewWorld } from '../helpers/S9-review-fixture.js';

/**
 * E3M-10 (clk-current.md:216, P10-2): the reviewer line's own independent
 * context. The S9 world opens its reviewer line only through
 * `role-lines/open({duty:'reviewer'})`; Member boots on that line, and the
 * page's one `lines/read`, its head's 职责 fact and the 轨迹 tab's one
 * `sessions/history` all name the reviewer's own Session — never the work
 * line's. The two boots are separate because a page shows one line in its
 * centre (the right panel is hidden while another line is on show).
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const s9 = () => slot.use('S9-reviewer', () => openS9ReviewWorld({ backend: 'memory', reviewLine: 'open' }),
  (opened) => opened.close());

const reviewTab = (root: FakeElement): FakeElement | undefined =>
  findElement(root, (element) => element.getAttribute('role') === 'tab' && textOf(element) === '轨迹');

/** The line a call actually asked for: `lines/read`'s `key`, `sessions/history`'s `sessionRef`. */
const clkcCallKey = (input: unknown): unknown => (input as { key?: unknown }).key;
const clkcCallSessionRef = (input: unknown): unknown => (input as { sessionRef?: unknown }).sessionRef;

describe('E3M-10 the reviewer line', () => {
  it('P10-2 the reviewer line reads its own Session for its head and 轨迹, apart from the work line', async () => {
    const review = await s9();
    const reviewer = review.reviewLine;
    expect(reviewer).not.toBeNull();
    const { page, log } = await bootMemberAt(review.world, memberSearch(review.goal.goalId, reviewer!.ref));
    try {
      const reads = callsOf(log, 'lines/read');
      /* 具名改坏: `readNav` 把请求的线换成 `lines/list` 的第一条；本行的 key 红。 */
      expect(reads).toHaveLength(1);
      expect(clkcCallKey(reads[0]!.input)).toEqual(reviewer!.ref);
      expect(mainHeadTitle(page.root)).toBe('审阅者');
      /* 具名改坏: 页头的职责取 `line.duty.word`（审阅者）而不是 DUTY 表；本行的 `职责` 红。 */
      expect(headFact(page.root, '职责')).toBe('规格条目、验收与正式检查');
      expect(countRoute(log, 'sessions/history')).toBe(0);
      press(reviewTab(page.root), '轨迹');
      await settle(() => countRoute(log, 'sessions/history') > 0);
      const history = callsOf(log, 'sessions/history');
      /* 具名改坏: 轨迹读页头自己的 `sessions/history`（工作线）而不是审阅线；本行的 `sessionRef` 红。 */
      expect(history).toHaveLength(1);
      expect(clkcCallSessionRef(history[0]!.input)).toEqual(reviewer!.ref);
      expect(reviewTab(page.root)?.getAttribute('aria-selected')).toBe('true');
    } finally {
      await page.restore();
    }

    const work = await bootMemberAt(review.world, memberSearch(review.goal.goalId, review.workLine.ref));
    try {
      const reads = callsOf(work.log, 'lines/read');
      /* 具名改坏: 工作线的 `lines/read` 仍读审阅线的 Session；本行的 key 和“不同”红。 */
      expect(reads).toHaveLength(1);
      expect(clkcCallKey(reads[0]!.input)).toEqual(review.workLine.ref);
      expect(clkcCallKey(reads[0]!.input)).not.toEqual(reviewer!.ref);
      press(reviewTab(work.page.root), '轨迹');
      await settle(() => countRoute(work.log, 'sessions/history') > 0);
      const history = callsOf(work.log, 'sessions/history');
      expect(history).toHaveLength(1);
      expect(clkcCallSessionRef(history[0]!.input)).toEqual(review.workLine.ref);
      expect(clkcCallSessionRef(history[0]!.input)).not.toEqual(reviewer!.ref);
    } finally {
      await work.page.restore();
    }
  }, 180_000);
});
