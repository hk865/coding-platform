/**
 * Slice 2A QE3, Group N: QA-10(二) — the notice source and the queue carry more
 * than the old wiring-2 bounds (directory 50 pages, per-line 50 pages, output
 * 5,000) and never report `capacity` (L4, L8, L10; §0.4).
 *
 * The dataset is built only through the real services (see
 * `S2A-notices-overbound-fixture.ts`). The 2,001-link "available Session" case
 * is dropped by P11; the listing reads only the Session records' health.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { automaticRework, noticesHarness, openS2ANotices } from '../helpers/S2A-notices-support.js';
import { S2A_SCALE_TIMEOUT_MS } from '../helpers/S2A-queue-fixture.js';
import { buildOverboundNoticesWorld } from '../helpers/S2A-notices-overbound-fixture.js';

const SESSIONS = 5_001;
const REPLIES = 5_001;
const MEMBER_NOTICES = 5_001;

const opened: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

describe.each(['memory', 'sqlite'] as const)('S2A over-bound notices (%s)', kind => {
  it('QA-10 (二) a 5,001-Session directory, 5,001 undelivered replies and 5,001 member notices page to the end without capacity', async () => {
    const { f } = await openS2ANotices(kind);
    opened.push(f);
    const world = await buildOverboundNoticesWorld(f, { sessions: SESSIONS, replies: REPLIES, memberNotices: MEMBER_NOTICES });
    const h = noticesHarness(f, [automaticRework(f), world.undelivered]);

    // The literal category counts on the first page; no `capacity`.
    const first = await h.page({ limit: 100 });
    expect(first.counts.notices.member_notice).toBe(MEMBER_NOTICES);
    expect(first.counts.notices.undelivered_reply).toBe(REPLIES);

    // Page the whole queue to the end: every item once, the literal total.
    const members = new Set<string>();
    const replies = new Set<string>();
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await h.page({ limit: 100, ...(cursor === undefined ? {} : { cursor }) });
      for (const notice of page.notices) {
        if (notice.category === 'member_notice') members.add(notice.itemKey);
        else if (notice.category === 'undelivered_reply') replies.add(notice.itemKey);
      }
      total += page.notices.length;
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(total).toBe(MEMBER_NOTICES + REPLIES);
    expect(members.size).toBe(MEMBER_NOTICES);
    expect(replies.size).toBe(REPLIES);
    expect(members.has(world.expected.memberTailKey)).toBe(true);
    expect(replies.has(world.expected.replyTailKey)).toBe(true);
  }, S2A_SCALE_TIMEOUT_MS);
});
