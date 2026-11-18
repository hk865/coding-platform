/**
 * D7 (Q frozen row; 121-146/R6 U3): the rail's inbox uses `decideText` — the count, "至少 n" only when a card
 * source could not be read, and "暂时读不到" when that partial read found no card. A whole failed queue is not
 * "nothing to handle": it hides both inbox rows instead of saying none. Today the row is red because `decideText`
 * does not exist and a null queue still answers `none: true`.
 * lead 11-18 改判（界面审查备注 1）：队列整次没读到时，Main 照旧藏起两行（`hasDecide: false`），
 * 常显左栏的画板读 `decideText`、`noticeText`，两个都写“暂时读不到”，不写 0。
 */
import { describe, expect, it } from 'vitest';
import { adaptNav, type NavData, type NavReads } from '../../src/ui/adapters/nav.js';

function navOf(queue: unknown): NavData {
  const reads: NavReads = { goals: { goals: [] }, lines: { rows: [], counts: {} }, queue };
  return adaptNav(reads, null);
}

describe('D7 adaptNav decideText and none', () => {
  it.each([
    { name: 'three cards plus a failed card source',
      queue: { counts: { waitingAnswer: 3, notices: {} },
        capabilities: [{ source: 'candidate', availability: 'read_failed' }] },
      decideText: '至少 3', noticeText: '0', hasDecide: true, none: false },
    { name: 'zero cards plus a failed card source',
      queue: { counts: { waitingAnswer: 0, notices: {} },
        capabilities: [{ source: 'candidate', availability: 'read_failed' }] },
      decideText: '暂时读不到', noticeText: '0', hasDecide: true, none: false },
    { name: 'the whole queue read failed', queue: null,
      decideText: '暂时读不到', noticeText: '暂时读不到', hasDecide: false, none: false },
    { name: 'only a notice source is disconnected',
      queue: { counts: { waitingAnswer: 0, notices: {} },
        capabilities: [{ source: 'second_expiry', availability: 'not_available' }] },
      decideText: '0', noticeText: '0', hasDecide: false, none: true },
  ])('shows $name', ({ queue, decideText, noticeText, hasDecide, none }) => {
    const inbox = navOf(queue).inbox;
    expect(inbox.decideText).toEqual(decideText);
    expect(inbox.noticeText).toEqual(noticeText);
    expect(inbox.hasDecide).toBe(hasDecide);
    expect(inbox.none).toBe(none);
  });
});
