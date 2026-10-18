/**
 * K3-41 (一) / L19: the formal `DecisionChangeProofV1` a real
 * `disposition_applied` commit carries. The real committed event is decoded
 * both directly and through the fifth-slice `readApplicationReceiptFacts`;
 * another answer's real receipt is `invalid`, and an ordinary non-application
 * review change stays `incomplete`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { readApplicationReceiptFacts } from '../../src/core/work-graph/communication/decision-application.js';
import { unknownCallReviewChangedEventFromEvent } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  createK3NeedsDecisionRecord, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`: the real record's one blocked call is held until the
// recognition path has read the draft (the real shell needs bwrap, which DSH
// does not have). The mock is per test file, so this file owns it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]) =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function cardOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1) {
  const page = await world.cardSource.readPage(world.fixture.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    page: { limit: 100 } });
  if (page.status !== 'ready') throw new Error(`the card page failed: ${JSON.stringify(page)}`);
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const card = page.value.items.find(item => item.source.key === key);
  if (card === undefined) throw new Error(`the card ${key} is not on the source page`);
  return card;
}

async function appliedWorld(kind: 'memory' | 'sqlite') {
  const world = await openK3ReviewCardWorld(kind);
  worlds.push(world);
  const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
  const card = await cardOf(world, record);
  const result = await world.decisionActions.resolveDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
      text: 'proof me', annotations: [] },
    meta: { requestId: 'k3-41-apply', expected: card.source.pins },
  });
  expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  if (result.status !== 'ready') throw new Error('the disposition must apply');
  const action = result.value.action;
  if (action === null || action.status !== 'committed') throw new Error('the disposition must commit');
  const receipt = await world.applicationReceipt(world.fixture.ctx, action.cursor);
  if (receipt === null) throw new Error('the disposition commit must carry its identity');
  const answerRead = await world.decisions.readDecisionAnswer(world.fixture.ctx, { source: card.source });
  if (answerRead.status !== 'ready' || answerRead.value.message === null) {
    throw new Error(`the saved answer is not readable: ${JSON.stringify(answerRead)}`);
  }
  return { world, record, card, action, receipt, answer: answerRead.value.message };
}

describe('K3-41 (一) disposition proof', () => {
  it.each(['memory', 'sqlite'] as const)('K3-41 (%s): the real disposition_applied event proves the answer, captured pins and both record revisions', async kind => {
    const { world, record, card, action, receipt, answer } = await appliedWorld(kind);
    const located = await world.records.eventAt(action.cursor);
    expect(located).toMatchObject({ status: 'ready' });
    if (located.status !== 'ready') return;
    const decoded = unknownCallReviewChangedEventFromEvent(located.value.event);
    expect(decoded).toMatchObject({ status: 'decoded' });
    if (decoded.status !== 'decoded') return;
    const event = decoded.value;
    expect(event.change).toBe('disposition_applied');
    expect(event.proof).toBeDefined();
    expect(event.proof!.acknowledgementRef).toEqual(answer.ref);
    expect(event.proof!.capturedPins).toEqual(card.source.pins);
    expect(event.proof!.changes).toEqual([
      { before: { ref: record.ref, revision: record.revision },
        after: { ref: record.ref, revision: record.revision + 1 } },
    ]);
    expect(event.proof!.basisRebases).toEqual([]);

    // The formal reader decodes the SAME receipt and returns the change.
    const read = await readApplicationReceiptFacts(world.records)(world.fixture.ctx, { answer, receipt });
    expect(read).toMatchObject({ status: 'ready', value: {
      receipt, changes: [{ before: { ref: record.ref, revision: record.revision },
        after: { ref: record.ref, revision: record.revision + 1 } }] } });
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)("K3-41 (%s): another answer's real disposition receipt is invalid for this answer", async kind => {
    const { world, answer: answerA, receipt: receiptA } = await appliedWorld(kind);
    // A second REAL answer, B, answered (not applied) through the public entry.
    const recordB = await createK3NeedsDecisionRecord(world, 'k3-20-b');
    const cardB = await cardOf(world, recordB);
    const answeredB = await world.decisions.answerDecision(world.fixture.ctx, {
      input: { source: cardB.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
        text: '', annotations: [] },
      meta: { requestId: 'k3-41-answer-b', expected: cardB.source.pins },
    });
    expect(answeredB).toMatchObject({ status: 'committed' });
    if (answeredB.status !== 'committed') throw new Error('answer B must commit');
    const answerB = answeredB.value;
    expect(answerB.ref).not.toEqual(answerA.ref);

    // A's real receipt through the PUBLIC application entry, paired with B.
    const cross = await world.decisions.recordDecisionApplication(world.fixture.ctx, {
      input: { messageRef: answerB.ref, receipt: receiptA },
      meta: { requestId: 'k3-41-cross', expected: [{ ref: answerB.ref, revision: answerB.revision }] },
    });
    expect(cross).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the receipt is not associated with this answer' });

    // Nothing was written: B is still answered and pending application.
    const cardRead = await world.readModel.readDecisionCard(world.fixture.ctx, { source: cardB.source });
    expect(cardRead).toMatchObject({ status: 'ready', value: {
      state: 'answered_pending_application', application: null, answerMessageRef: answerB.ref } });
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-41 (%s): a non-application UnknownCallReviewChanged stays incomplete', async kind => {
    const base = await appliedWorld(kind);
    const held = await base.world.reviews.holdReview(base.world.fixture.ctx, {
      input: { reviewRef: base.record.ref, text: null },
      meta: { requestId: 'k3-41-hold', expected: [{ ref: base.record.ref, revision: base.record.revision + 1 }] },
    });
    expect(held).toMatchObject({ status: 'committed' });
    if (held.status !== 'committed') return;
    const receipt = await base.world.applicationReceipt(base.world.fixture.ctx, held.cursor);
    expect(receipt).not.toBeNull();
    if (receipt === null) return;
    const read = await readApplicationReceiptFacts(base.world.records)(base.world.fixture.ctx,
      { answer: base.answer, receipt });
    expect(read).toMatchObject({ status: 'rejected', code: 'incomplete',
      reason: 'the formal event carries no decision change proof' });
  }, 120_000);
});
