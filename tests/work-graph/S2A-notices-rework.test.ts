/**
 * Slice 2A QE3, Group N: the automatic-rework notice source (L4/L5/L7).
 *
 * Rows: QA-11 (legacy `since`-less requeues), QA-18 (ordered reverify index +
 * full-chain verification, D2). Every dataset is built through the real S5
 * owners; QA-11's three historical requeues are the only direct storage writes
 * (L-fixtures exception 1).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { automaticRework, committed, legacyRequeueItemKeys, legacyRequeueRecords,
  noticesHarness, openReverifyChain, openS2ANotices } from '../helpers/S2A-notices-support.js';
import { GOAL_B } from '../helpers/S5-decision-fixture.js';
import { automationContext, mailboxDependencies, workContext } from '../helpers/S5-queue-support.js';

/** ItemKey of one requeue notice (`automatic_rework:<canonical ref>`). */
function requeueItemKey(ref: object): string {
  return `automatic_rework:${canonicalJson(ref as JsonValue)}`;
}

/** ItemKey of one reverify notice (`automatic_rework:<4-digit ordinal>:<ref>`). */
function reverifyItemKey(ordinal: number, ref: object): string {
  return `automatic_rework:${String(ordinal).padStart(4, '0')}:${canonicalJson(ref as JsonValue)}`;
}

const opened: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of opened.splice(0)) await close(); });

async function open(kind: 'memory' | 'sqlite') {
  const { f, work } = await openS2ANotices(kind);
  opened.push(() => f.close());
  return { f, work };
}

describe.each(['memory', 'sqlite'] as const)('S2A automatic-rework notices (%s)', kind => {
  it('QA-11 legacy requeues without since order by occurredAt before the commit-position requeues', async () => {
    const { f, work } = await open(kind);
    // One real commit-bound requeue is the template and the commit notice.
    const real = await work.requeue('system', automationContext(f));
    const seeded = await f.seedCommit(legacyRequeueRecords(real));
    expect(seeded.status).toBe('committed');
    const legacyKeys = legacyRequeueItemKeys(real);
    const realKey = requeueItemKey(real.ref);
    const h = noticesHarness(f, [automaticRework(f)]);

    // No saved seen position: the three legacy requeues come first, in
    // occurredAt order (c, b, a), then the commit-position requeue.
    const first = await h.page({ categories: ['automatic_rework'], limit: 50 });
    expect(first.notices.map(notice => notice.itemKey)).toEqual([...legacyKeys, realKey]);
    expect(first.notices.map(notice => notice.position.kind)).toEqual(['legacy', 'legacy', 'legacy', 'commit']);
    expect(first.notices.slice(0, 3).map(notice => notice.position)).toEqual([
      { kind: 'legacy', occurredAt: '2026-10-07T00:00:00.000Z', itemKey: legacyKeys[0]! },
      { kind: 'legacy', occurredAt: '2026-10-08T00:00:00.000Z', itemKey: legacyKeys[1]! },
      { kind: 'legacy', occurredAt: '2026-10-09T00:00:00.000Z', itemKey: legacyKeys[2]! },
    ]);
    expect(first.counts.notices.automatic_rework).toBe(4);

    // Paging with a small limit does not change the count.
    const pageOne = await h.page({ categories: ['automatic_rework'], limit: 2 });
    expect(pageOne.notices.map(notice => notice.itemKey)).toEqual([legacyKeys[0], legacyKeys[1]]);
    expect(pageOne.counts.notices.automatic_rework).toBe(4);
    expect(pageOne.nextCursor).not.toBeNull();
    const pageTwo = await h.page({ categories: ['automatic_rework'], limit: 2, cursor: pageOne.nextCursor! });
    expect(pageTwo.notices.map(notice => notice.itemKey)).toEqual([legacyKeys[2], realKey]);
    expect(pageTwo.counts.notices.automatic_rework).toBe(4);

    // A saved LEGACY seen position at the earliest occurredAt leaves the other
    // two legacy requeues, then the commit-position one.
    const seenFirst = await h.page({ categories: ['automatic_rework'], limit: 1 });
    expect(seenFirst.notices.map(notice => notice.itemKey)).toEqual([legacyKeys[0]]);
    expect(seenFirst.seenThrough).toEqual({ automatic_rework: seenFirst.notices[0]!.position });
    await h.mark(seenFirst.displayToken, seenFirst.seenThrough);
    const after = await h.page({ categories: ['automatic_rework'], limit: 50 });
    expect(after.notices.map(notice => notice.itemKey)).toEqual([legacyKeys[1], legacyKeys[2], realKey]);
  }, 600_000);

  it('QA-18 the ordered reverify index names only the subject; the chain verifies and only new system rounds appear', async () => {
    const { f, work } = await open(kind);
    // Round 1 (root), round 2 opened by a PERSON, round 3 opened by the system.
    const chain = openReverifyChain(f);
    const root = await work.start('round');
    await f.settleRun(root);
    const evidence = chain.evidence;
    if (evidence.openVerification === undefined || evidence.finalizeChecks === undefined || evidence.reverifyRound === undefined) {
      throw new Error('the evidence owner lacks the reverify surface');
    }
    let round = committed(await evidence.openVerification(f.ctx, { input: { subjectRunRef: root.runRef, subject: root.task,
      planRef: work.plan.ref }, meta: { requestId: f.newId(), expected: [] } }));
    round = committed(await evidence.finalizeChecks(f.ctx, { input: { roundRef: round.ref },
      meta: { requestId: f.newId(), expected: [{ ref: round.ref, revision: round.revision }] } })).snapshot;
    expect(round).toMatchObject({ revision: 2, status: 'finalized', outcome: 'INCONCLUSIVE' });
    const humanResult = await evidence.reverifyRound(f.ctx, { input: { predecessorRoundRef: round.ref },
      meta: { requestId: f.newId(), expected: [{ ref: round.ref, revision: round.revision }] } });
    const human = committed(humanResult);
    if (human.kind !== 'reverified') throw new Error('the person reverify must open a successor');
    expect(human.round.chain?.reverify).toMatchObject({ actorClass: 'human' });
    round = committed(await evidence.finalizeChecks(f.ctx, { input: { roundRef: human.round.ref },
      meta: { requestId: f.newId(), expected: [{ ref: human.round.ref, revision: human.round.revision }] } })).snapshot;
    // M6/QA-18: the public flow, never a fabricated `after`. Deliver a member
    // notice after round 2, read it through the notices page, then mark it seen
    // with `markNoticesSeen` using that page's display token and `seenThrough`.
    const mailbox = createSessionMailbox(mailboxDependencies(f));
    const delivered = await mailbox.sendUserMessage(workContext(f, f.claimRA), { input: { goalRef: GOAL_B, intent: 'notify',
      text: 'QA-18 notice delivered after round 2', needsReply: false, waitAfterSend: false, options: [], objects: [] },
      meta: { requestId: f.newId(), expected: [] } });
    if (delivered.status !== 'committed') throw new Error(`the QA-18 notice was refused: ${JSON.stringify(delivered)}`);
    const h = noticesHarness(f, [automaticRework(f)]);
    const deliveredPage = await h.page({ limit: 50 });
    expect(deliveredPage.notices.map(notice => notice.category)).toContain('member_notice');
    await h.mark(deliveredPage.displayToken, deliveredPage.seenThrough);

    // Only THEN does the system open round 3.
    chain.bumpSource();
    const system = committed(await evidence.reverifyRound(automationContext(f), { input: { predecessorRoundRef: round.ref },
      meta: { requestId: f.newId(), expected: [{ ref: round.ref, revision: round.revision }] } }));
    if (system.kind !== 'reverified') throw new Error(`the system reverify must open a successor: ${JSON.stringify(system)}`);
    expect(system.round.chain?.reverify).toMatchObject({ actorClass: 'system' });
    expect(system.round.chain?.ordinal).toBe(3);

    // The next read shows exactly the system round 3 among automatic-rework
    // notices; rounds 1 and 2 never appear, and the chain check passed or the
    // read would have been `unavailable`.
    const page = await h.page({ categories: ['automatic_rework'], limit: 50 });
    expect(page.notices.map(notice => notice.itemKey)).toEqual([reverifyItemKey(3, system.round.ref)]);
    expect(page.notices.map(notice => notice.rework?.sourceRef)).toEqual([system.round.ref]);
    const all = await h.page({ limit: 50 });
    expect(all.notices.filter(notice => notice.category === 'automatic_rework').map(notice => notice.itemKey))
      .toEqual([reverifyItemKey(3, system.round.ref)]);
  }, 600_000);
});
