/**
 * Slice 2A QE3, Group N: QA-10(二) — the notice source and the queue carry more
 * than the old wiring-2 bounds (directory 50 pages, per-line 50 pages, output
 * 5,000) and never report `capacity` (L4, L8, L10; §0.4).
 *
 * The dataset is built only through the real services (see
 * `S2A-notices-overbound-fixture.ts`). This daily file keeps the scale case's
 * behaviour with every read width cut to 2; the scale batch keeps the 5,001
 * sizes. The 2,001-link "available Session" case is dropped by P11; the listing
 * reads only the Session records' health.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { automaticRework, noticesHarness, openS2ANotices } from '../helpers/S2A-notices-support.js';
import { buildOverboundNoticesWorld } from '../helpers/S2A-notices-overbound-fixture.js';

const SESSIONS = 5;
const REPLIES = 5;
const MEMBER_NOTICES = 5;
/** Every inner and outer read width in this world. */
const PAGE = 2;
/**
 * The five literal member-notification request ids, in submission order N0..N4.
 * They are chosen (and the resulting order computed below) so that N4, the last
 * submitted notice, has the greatest SessionMessage messageId of the seven
 * `s2a-user-messages` records: the A layer's last page.
 */
const MEMBER_REQUEST_IDS = ['qa10-member-0', 'qa10-member-1', 'qa10-member-2', 'qa10-member-3', 'qa10-member-tail-8'] as const;

const opened: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

describe.each(['memory', 'sqlite'] as const)('S2A over-bound notices (%s)', kind => {
  it('QA-10 (二) (small: 5 new Sessions in an 8-Session directory, page 2) 5 undelivered replies and 5 member notices page to the end without capacity', async () => {
    const { f } = await openS2ANotices(kind);
    opened.push(f);
    const world = await buildOverboundNoticesWorld(f, { sessions: SESSIONS, replies: REPLIES,
      memberNotices: MEMBER_NOTICES, memberNoticeRequestIds: MEMBER_REQUEST_IDS,
      replyOrder: 'message-key', readPageLimit: PAGE });
    const h = noticesHarness(f, [automaticRework(f), world.undelivered],
      { sourcePageLimit: PAGE, lookupPageLimit: PAGE });

    // Directory (Session-by-workspace index, refKey order, width 2): the whole
    // workspace holds the base fixture's two Sessions (session-s and
    // session-second), the five created ones and the responder — 8 records.
    // Hand order (the ids are deterministic):
    //   [created-00004, created-00002], [base session-second, responder],
    //   [base session-s, created-00003], [created-00000, created-00001].
    // created-00001 is the one unavailable source Session: greatest of the
    // created ids and greatest overall, so it is last. 8 / 2 = 4 pages, the
    // decisive Session on the last one.
    //
    // A layer (the shared `s2a-user-messages` index, ascending SessionMessage
    // refKey, width 2): the base fixture's two decision messages (`s5-decision-send`
    // = still pending, `s5-answered-send` = answered) plus the five member
    // notifications N0..N4 (`qa10-member-0`..`qa10-member-3` and
    // `qa10-member-tail-8`; N4 submitted last). The key is
    // `{"aggregateType":"SessionMessage","messageId":...,"projectId":...,
    // "workspaceId":...}`; project and workspace are the same, so the order is
    // the ascending messageId string (UTF-8). Hand-computed order, named by
    // request id:
    //   [N3, base answered] / [base pending, N2] / [N0, N1] / [N4].
    // 7 records / 2 = 4 pages (2, 2, 2, 1); the asserted memberTailKey is N4 on
    // the last page.
    //
    // Reply layer (inner, width 2): the fixture commits the 5 responses in
    // ascending SessionMessage refKey order, the order this read returns, so
    // the tail reply is read last: 5 / 2 = 3 pages (2, 2, 1).
    // Member layer (built-in source, ordered by commit position, width 2):
    // N0..N4 in submission order: [N0, N1] / [N2, N3] / [N4]; 3 pages
    // (2, 2, 1); the tail notice N4 is last.
    // Source layer (undelivered source, width 2): 5 replies sorted by commit
    // position, 5 / 2 = 3 pages (2, 2, 1); the tail reply is last.
    // Outer queue (limit 2): 5 replies + 5 member notices = 10 items,
    // 10 / 2 = 5 pages.

    // The literal category counts on the first page; no `capacity`.
    const first = await h.page({ limit: PAGE });
    expect(first.counts.notices.member_notice).toBe(5);
    expect(first.counts.notices.undelivered_reply).toBe(5);

    // Page the whole queue to the end: every item once, the literal total.
    const members = new Set<string>();
    const replies = new Set<string>();
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await h.page({ limit: PAGE, ...(cursor === undefined ? {} : { cursor }) });
      for (const notice of page.notices) {
        if (notice.category === 'member_notice') members.add(notice.itemKey);
        else if (notice.category === 'undelivered_reply') replies.add(notice.itemKey);
      }
      total += page.notices.length;
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(total).toBe(10);
    expect(members.size).toBe(5);
    expect(replies.size).toBe(5);
    expect(members.has(world.expected.memberTailKey)).toBe(true);
    expect(replies.has(world.expected.replyTailKey)).toBe(true);
  });
});
