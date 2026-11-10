/**
 * DEXC-10, 11a, 11c, 12, 16 (`exc-tests.frozen.md` §2; R-15–R-18): the structural card's "不对，重新提". The coarse card
 * re-runs its round with the reason; a region batch opens one follow-up, one round per block with the reason, one
 * new card; a batch not from exploration has no such option; a plain reject keeps today's path; an empty reason is
 * refused before the answer is written. World: `S7D2-coldstart-world.ts` (memory); rounds as in the stop file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureProposalRef } from '../../src/contracts/architecture-proposal.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import {
  coldStartCoarseProposal, dexcAnswer, dexcBarrier, dexcFollowUps, dexcNextCard as nextCard, dexcProposal,
  dexcRounds, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const batchOf = (card: DecisionCardV1): unknown => (card.objects[0] as { pin: { ref: unknown } }).pin.ref;
const worlds: S7D2ColdStartWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

async function opened(): Promise<S7D2ColdStartWorld> {
  const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
  worlds.push(cold);
  await cold.initialize();
  return cold;
}

/** The region batch card of `toProposals`, with each block's line and first proposal. */
async function regionBatch(cold: S7D2ColdStartWorld) {
  const { lines } = await cold.toProposals(async (id, line, pin) => await cold.host.scripted.script(line,
    dexcProposal(`dexc-${id}`, pin, [{ op: 'set_module_name', moduleId: id, name: `DEXC ${id}` }], `DEXC ${id}`)));
  const card = await nextCard(cold);
  const proposalOf = async (id: string): Promise<ArchitectureProposalRef> =>
    (jsonOf(await cold.host.scripted.requests(lines[id]!), `dexc-${id}`) as { proposalRef: ArchitectureProposalRef })
      .proposalRef;
  return { lines, card, src: await proposalOf('src'), docs: await proposalOf('docs'),
    revision: (await cold.pin()).catalogRef.revision };
}

describe('DEXC: the structural card asks for another proposal', () => {
  it('DEXC-10 the coarse card re-runs the coarse round with the reason; the catalog waits for the approval', async () => {
    const cold = await opened();
    await cold.advanceTo('coarse_split');
    const card = await nextCard(cold);
    const pin = await cold.pin();
    await cold.host.scripted.script(cold.lines.adviser,
      dexcProposal('dexc10-coarse', pin, coldStartCoarseProposal(P).ops, 'DEXC-10 coarse again'));
    expect(await dexcAnswer(cold.host, card, 'repropose', 'the split is too coarse', 'dexc10'))
      .toMatchObject({ status: 'ready' });
    const next = await nextCard(cold, card);
    expect((await cold.cards()).find(item => item.cardKey === card.cardKey)?.state).not.toBe('waiting_answer');
    const rounds = await dexcRounds(cold.host, cold.lines.adviser);
    expect(rounds).toHaveLength(2);
    expect(rounds[1]).toContain('the split is too coarse');
    expect(next.source.kind).toBe('structural_proposal');
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision);
    await cold.approve(next, 'dexc10-approve');
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision + 1);
  }, 300_000);

  it('DEXC-11a a region batch re-proposes in one follow-up: each block one round with the reason, one new card', async () => {
    const cold = await opened();
    const { lines, card, src, docs, revision } = await regionBatch(cold);
    const pin = await cold.pin();
    for (const id of ['src', 'docs']) {
      await cold.host.scripted.script(lines[id]!, [{ kind: 'calls', calls: [{ callId: `dexc11-${id}-note`,
        name: 'record_note', args: { op: 'write', kind: 'pitfall', body: '', topic: `DEXC-11 ${id}`,
          conclusion: `DEXC-11 ${id} note`, anchor: { kind: 'module', moduleId: id } } }] },
      ...dexcProposal(`dexc11-${id}`, pin, [{ op: 'set_responsibility', moduleId: id, text: `DEXC ${id} again` }],
        `DEXC ${id} again`)]);
    }
    expect(await dexcAnswer(cold.host, card, 'repropose', 'wrong grouping', 'dexc11a')).toMatchObject({ status: 'ready' });
    const next = await nextCard(cold, card);
    const rounds = { src: await dexcRounds(cold.host, lines['src']!), docs: await dexcRounds(cold.host, lines['docs']!) };
    expect([rounds.src.length, rounds.docs.length]).toEqual([2, 2]);
    expect([rounds.src[1], rounds.docs[1]].every(text => text?.includes('wrong grouping'))).toBe(true);
    for (const id of ['src', 'docs']) {
      expect(jsonOf(await cold.host.scripted.requests(lines[id]!), `dexc11-${id}-note`))
        .toMatchObject({ write: { status: 'accepted' } });
    }
    expect(next.objects.slice(1).map(object => object.label).sort()).toEqual(['DEXC docs again', 'DEXC src again']);
    expect([(await cold.proposal(src)).proposal.state, (await cold.proposal(docs)).proposal.state])
      .toEqual(['rejected', 'rejected']);
    const order = card.objects.slice(1).map(object => object.label === 'DEXC src' ? 'src' : 'docs');
    const [follow] = await dexcFollowUps(cold.host);
    expect(follow?.followUp).toEqual({ kind: 'repropose', moduleRefs: order.map(moduleId => ({ projectId: P, moduleId })),
      reason: 'wrong grouping', sourceBatchRef: batchOf(card) });
    expect(follow?.plannedRounds).toBe(2);
    expect(follow?.batchRefs).toEqual([batchOf(next)]);
    expect((await cold.pin()).catalogRef.revision).toBe(revision);
    await cold.approve(next, 'dexc11a-approve');
    expect((await cold.pin()).catalogRef.revision).toBe(revision + 1);
  }, 300_000);

  it('DEXC-11c a batch exploration did not produce offers approve and reject only', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    const { goal } = await cold.initialize();
    const { final } = await cold.walkToCompleted();
    const entry = (final.explorations ?? []).find(candidate => candidate.queryRunRef.runId.endsWith(':src'))!;
    const line = await cold.lineOf(entry.sessionRef, 'dexc11c-src');
    await cold.waitFor('the src line free', async () => (await cold.host.readSession(line.ref)).record.occupancy === null);
    await cold.adoptWorkPlan({ goal, label: 'dexc11c', taskId: 'dexc11c-work', line, replies: dexcProposal('dexc11c',
      await cold.pin(), [{ op: 'set_module_name', moduleId: 'src', name: 'DEXC work' }], 'DEXC-11c work proposal') });
    const card = await nextCard(cold);
    expect(card.options.map(option => option.id)).toEqual(['approve', 'reject']);
    expect(await dexcAnswer(cold.host, card, 'repropose', 'not from exploration', 'dexc11c'))
      .toMatchObject({ status: 'rejected' });
    expect((await cold.proposalCards()).map(item => item.cardKey)).toEqual([card.cardKey]);
    expect(await dexcFollowUps(cold.host)).toEqual([]);
  }, 300_000);

  it('DEXC-12 a plain reject of a region batch keeps today\'s path: no follow-up, no round, completed', async () => {
    const cold = await opened();
    const { lines, card, src, docs, revision } = await regionBatch(cold);
    const before = [(await dexcRounds(cold.host, lines['src']!)).length, (await dexcRounds(cold.host, lines['docs']!)).length];
    expect(await dexcAnswer(cold.host, card, 'reject', '', 'dexc12')).toMatchObject({ status: 'ready' });
    expect(await dexcFollowUps(cold.host)).toEqual([]);
    expect((await cold.waitForPhase('completed')).phase).toBe('completed');
    await dexcBarrier(cold.host);
    expect([(await dexcRounds(cold.host, lines['src']!)).length, (await dexcRounds(cold.host, lines['docs']!)).length])
      .toEqual(before);
    expect((await cold.pin()).catalogRef.revision).toBe(revision);
    expect([(await cold.proposal(src)).proposal.state, (await cold.proposal(docs)).proposal.state])
      .toEqual(['rejected', 'rejected']);
  }, 300_000);
});

describe('rejects: the structural card\'s re-proposal', () => {
  it('DEXC-16 an empty reason is refused before the answer is written; the card still waits', async () => {
    const cold = await opened();
    await cold.advanceTo('coarse_split');
    const card = await nextCard(cold);
    const pin = await cold.pin();
    expect(card.options.map(option => option.id)).toContain('repropose');
    expect(await dexcAnswer(cold.host, card, 'repropose', '', 'dexc16')).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect((await cold.proposalCards()).find(item => item.cardKey === card.cardKey)?.state).toBe('waiting_answer');
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision);
  }, 300_000);
});
