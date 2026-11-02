/**
 * G4-card-x-workspace: one project card answered in A is the same card in B — same queue card and counts,
 * the answer on B's `decisions/card`, and the published
 * `decisionMessages.readDecisionAnswer` in B returning A's answer ref and the exact body text. B's
 * `decisions/application` stays `invalid` (the answer pin's workspace check), and a card source of another
 * project is `forbidden`. Every state is FX-7D1-03's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import { openS7D1ProjectCardWorld } from '../helpers/S7D1-project-card-world.js';

describe.each(['memory', 'sqlite'] as const)('the project card answered in A, read from B (%s)', (backend) => {
  let opened: Awaited<ReturnType<typeof openS7D1ProjectCardWorld>>;
  beforeAll(async () => { opened = await openS7D1ProjectCardWorld({ backend }); }, 180_000);
  afterAll(async () => { await opened?.world.close(); });

  it('shows the same card and count, reads the answer body, keeps B\'s application invalid and a foreign project forbidden', async () => {
    // The same card is in B's queue with the same counts, and its answer is A's.
    const inQueue = opened.bCards.find((card) => card.source.key === opened.card.source.key);
    expect(inQueue).toBeDefined();
    expect(inQueue!.answerMessageRef).toEqual(opened.answer.messageRef);
    expect(opened.bCounts).toEqual(opened.aCounts);
    expect(opened.bCard.answerMessageRef).toEqual(opened.answer.messageRef);

    // B calls the published answer read: A's answer ref and the exact text.
    const read = await opened.world.platform.decisionMessages.readDecisionAnswer(opened.b.humanContext(),
      { source: opened.card.source });
    if (read.status !== 'ready') throw new Error(`B's decision answer is not readable: ${JSON.stringify(read)}`);
    expect(read.value.message?.ref).toEqual(opened.answer.messageRef);
    expect(read.value.body?.text).toBe(opened.answer.text);
    expect(read.value.body?.selection).toEqual({ kind: 'option', optionId: 'accept' });

    // The write side stays per workspace: the pin's workspace check refuses the application in B.
    expect(opened.bApplication).toMatchObject({ status: 'rejected', code: 'invalid' });

    // A card source of another project is forbidden before any answer lookup.
    const foreignSource: DecisionSourceV1 = {
      ...opened.card.source, subject: { kind: 'project', projectRef: { projectId: 's7d1-other-project' } },
    };
    expect(await opened.b.route('decisions/card', { source: foreignSource }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});
