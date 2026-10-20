/**
 * Slice 2A QE3, Group N: the automatic-rework notice source (L4/L5/L7).
 *
 * Rows: QA-18 (ordered reverify index + full-chain verification, D2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { automaticRework, committed, noticesHarness, openReverifyChain, openS2ANotices } from '../helpers/S2A-notices-support.js';
import { GOAL_B } from '../helpers/S5-decision-fixture.js';
import { automationContext, mailboxDependencies, workContext } from '../helpers/S5-queue-support.js';

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
