/**
 * DEXC-03, 11b (`exc-tests.frozen.md` §2; R-01/02/05, R-17.1): a join stops and continues on the cold start's path; a
 * join batch answered in the main workspace is re-proposed in the joined workspace. World: `XWS2A-world.ts` (memory),
 * the join's `proposals` commit held while the `second-mod` line is scripted; rounds as in the stop file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { dexcAnswer, dexcCommand, dexcFollowUps, dexcRounds, type DexcRow } from '../helpers/S7D2-coldstart-world.js';
import { openXWS2AWorld, XWS2A_MODULE_ID, type XWS2AWorld } from '../helpers/XWS2A-world.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: XWS2AWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

const joinCard = (world: XWS2AWorld, not?: DecisionCardV1): Promise<DecisionCardV1> => waitFor(world.cards,
  cards => cards.some(card => card.source.kind === 'structural_proposal' && card.state === 'waiting_answer'
    && card.cardKey !== not?.cardKey), 'a waiting join structural card')
  .then(cards => cards.find(card => card.source.kind === 'structural_proposal' && card.state === 'waiting_answer'
    && card.cardKey !== not?.cardKey)!);

/** The join at `proposals` with its region round scripted; `hold` holds that round's first model request. */
async function joinAtProposals(hold: boolean) {
  const world = await openXWS2AWorld({ backend: 'memory' });
  worlds.push(world);
  const proposals = world.holdJoinProposals();
  await world.base.setOpen('adviser', (await world.base.allocation()).duties.adviser.holders.length + 2, 'dexc-seats');
  await world.approveCoarse();
  const revision = (await world.catalog(S6A_SCOPE)).catalog.ref.revision;
  await proposals.reached;
  const line = await world.scriptRegionProposal();
  const gate = hold ? await world.base.world.gates.modelRequest(line) : null;
  proposals.release();
  await gate?.reached;
  return { world, line, gate, revision, host: world.base.world, scope: world.second.scope };
}

describe('DEXC: the joined workspace', () => {
  it('DEXC-03 a join stops and continues on the same path; the catalog moves only on approval', async () => {
    const { world, line, gate, revision, host, scope } = await joinAtProposals(true);
    await dexcCommand(host, 'stop', 'dexc03-stop', { scope });
    const join = await world.join() as DexcRow;
    expect(join.result).toEqual({ status: 'waiting', reason: 'stopped_by_person' });
    expect(['accepted', 'running']).toContain(join.phase);
    gate!.release();
    expect((await dexcCommand(host, 'continue', 'dexc03-continue', { scope })).result)
      .toMatchObject({ status: 'committed' });
    const card = await joinCard(world);
    expect([(await dexcRounds(host, world.adviser)).length, (await dexcRounds(host, line)).length]).toEqual([1, 2]);
    expect((await world.catalog(S6A_SCOPE)).catalog.ref.revision).toBe(revision);
    await world.approve(card, 'dexc03-approve');
    expect((await world.catalog(S6A_SCOPE)).catalog.ref.revision).toBe(revision + 1);
  }, 300_000);

  it('DEXC-11b a join batch answered in the main workspace is re-proposed in the joined workspace', async () => {
    const { world, line, host, scope } = await joinAtProposals(false);
    const card = await joinCard(world);
    await host.scripted.script(line, [{ kind: 'text', text: 'DEXC-11b: second-mod again' }]);
    expect(await dexcAnswer(host, card, 'repropose', 'wrong grouping', 'dexc11b')).toMatchObject({ status: 'ready' });
    await waitFor(async () => [...await dexcFollowUps(host), ...await dexcFollowUps(host, scope)],
      rows => rows.some(row => (row.explorations ?? []).length > 0), 'the follow-up round');
    const [follow] = await dexcFollowUps(host, scope);
    expect((follow?.explorations ?? []).map(entry => entry.queryRunRef.workspaceId)).toEqual([scope.workspaceId]);
    expect(follow!.explorations![0]!.sessionRef).toEqual(line.ref);
    expect(follow!.followUp!.moduleRefs).toEqual([{ projectId: scope.projectId, moduleId: XWS2A_MODULE_ID }]);
    expect(await dexcFollowUps(host)).toEqual([]);
    await waitFor(async () => (await dexcRounds(host, line)).length, count => count === 2, 'the joined round');
  }, 300_000);
});
