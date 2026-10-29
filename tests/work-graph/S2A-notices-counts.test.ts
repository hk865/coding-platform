/**
 * Slice 2A QE3, Group N: QA-10(一) — the notice counts and the per-category
 * "from the saved seen position" continuation, at a scale past the old source
 * pages (L4/L8).
 *
 * 30 real system requeues, 10 real automatic reverifies and 20 real member
 * notifications are built through the real owners; the read is the real queue +
 * `markNoticesSeen`. Expected counts and identities come from the fixture.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NoticeCategoryV1 } from '../../src/contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { automaticRework, committed, noticesHarness, openManyTaskWorld, openReverifyChain,
  openS2ANotices } from '../helpers/S2A-notices-support.js';
import { GOAL_B, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { automationContext, mailboxDependencies, workContext } from '../helpers/S5-queue-support.js';

const opened: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

describe.each(['memory', 'sqlite'] as const)('S2A notice counts and continuation (%s)', kind => {
  it('QA-10 30 requeues, 10 reverifies and 20 member notices: counts stay literal and each category continues from its seen position', async () => {
    const { f, work } = await openS2ANotices(kind);
    opened.push(f);

    // 30 real automatic requeues, one Task each (fresh Session/Run per Task).
    // M5: record each notice identity in creation order from the public write
    // result, so the read order is checked against an independent expectation.
    const createdRework: string[] = [];
    const world = await openManyTaskWorld(f, Array.from({ length: 30 }, (_, index) => `rework-${String(index)}`));
    for (let index = 0; index < 30; index += 1) {
      const requeue = await world.requeueOnce(`rework-${String(index)}`);
      createdRework.push(`automatic_rework:${canonicalJson(requeue.ref as unknown as JsonValue)}`);
    }

    // 10 real automatic reverifies on one check subject.
    const chain = openReverifyChain(f, { schemaVersion: 1, autoReworkLimit: 20, resumeOnStartup: 'off' });
    if (chain.evidence.openVerification === undefined || chain.evidence.finalizeChecks === undefined
      || chain.evidence.reverifyRound === undefined) {
      throw new Error('the evidence owner lacks the reverify surface');
    }
    const root = await work.start('round');
    await f.settleRun(root);
    let round = committed(await chain.evidence.openVerification(f.ctx, { input: { subjectRunRef: root.runRef,
      subject: root.task, planRef: work.plan.ref }, meta: { requestId: f.newId(), expected: [] } }));
    const finalize = async () => {
      round = committed(await chain.evidence.finalizeChecks(f.ctx, { input: { roundRef: round.ref },
        meta: { requestId: f.newId(), expected: [{ ref: round.ref, revision: round.revision }] } })).snapshot;
    };
    await finalize();
    for (let index = 0; index < 10; index += 1) {
      chain.bumpSource();
      const opened = committed(await chain.evidence.reverifyRound(automationContext(f), { input: { predecessorRoundRef: round.ref },
        meta: { requestId: f.newId(), expected: [{ ref: round.ref, revision: round.revision }] } }));
      if (opened.kind !== 'reverified') throw new Error(`the automatic reverify was refused: ${JSON.stringify(opened)}`);
      round = opened.round;
      createdRework.push(`automatic_rework:${String(round.chain?.ordinal ?? 0).padStart(4, '0')}:${canonicalJson(round.ref as unknown as JsonValue)}`);
      await finalize();
    }

    // 20 real member notifications.
    const createdMembers: string[] = [];
    const mailbox = createSessionMailbox(mailboxDependencies(f));
    for (let index = 0; index < 20; index += 1) {
      const result = await mailbox.sendUserMessage(workContext(f, f.claimRA), { input: { goalRef: GOAL_B, intent: 'notify',
        text: `Member notification ${index}`, needsReply: false, waitAfterSend: false, options: [], objects: [] },
        meta: { requestId: f.newId(), expected: [] } });
      if (result.status !== 'committed') throw new Error(`the member notification was refused: ${JSON.stringify(result)}`);
      createdMembers.push(`member_notice:${sessionMessageRefKey(result.value.ref)}`);
    }

    const h = noticesHarness(f, [automaticRework(f)]);
    const byCategory = (items: readonly { category: NoticeCategoryV1; itemKey: string }[], category: NoticeCategoryV1) =>
      items.filter(item => item.category === category).map(item => item.itemKey);

    // One full page: the literal counts and the literal number of items.
    const full = await h.page({ limit: 100 });
    expect(full.counts.notices.automatic_rework).toBe(40);
    expect(full.counts.notices.member_notice).toBe(20);
    expect(full.notices).toHaveLength(60);
    const originalRework = byCategory(full.notices, 'automatic_rework');
    const originalMembers = byCategory(full.notices, 'member_notice');
    // M5: each category's item order equals the independently recorded creation
    // order (the spec orders notices by creation position).
    expect(originalRework).toEqual(createdRework);
    expect(originalMembers).toEqual(createdMembers);
    expect(new Set(originalRework).size).toBe(40);
    expect(new Set(originalMembers).size).toBe(20);

    // Small-limit paging never changes either count and never repeats an item.
    const paged: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await h.page({ limit: 7, ...(cursor === undefined ? {} : { cursor }) });
      expect(page.counts.notices.automatic_rework).toBe(40);
      expect(page.counts.notices.member_notice).toBe(20);
      paged.push(...page.notices.map(notice => notice.itemKey));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(paged).toHaveLength(60);
    expect(new Set(paged).size).toBe(60);

    // Mark the middle of each category from its own delivered page.
    const reworkSeen = await h.page({ categories: ['automatic_rework'], limit: 20 });
    expect(reworkSeen.notices.map(notice => notice.itemKey)).toEqual(originalRework.slice(0, 20));
    await h.mark(reworkSeen.displayToken, reworkSeen.seenThrough);
    const memberSeen = await h.page({ categories: ['member_notice'], limit: 10 });
    expect(memberSeen.notices.map(notice => notice.itemKey)).toEqual(originalMembers.slice(0, 10));
    await h.mark(memberSeen.displayToken, memberSeen.seenThrough);

    // Each category continues from its own saved position, independently. The
    // count keeps today's meaning: the items the source returned after the bound.
    const after = await h.page({ limit: 100 });
    expect(byCategory(after.notices, 'automatic_rework')).toEqual(originalRework.slice(20));
    expect(byCategory(after.notices, 'member_notice')).toEqual(originalMembers.slice(10));
    expect(after.counts.notices.automatic_rework).toBe(20);
    expect(after.counts.notices.member_notice).toBe(10);
  }, 600_000);
});
