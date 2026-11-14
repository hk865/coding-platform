/**
 * DEXC-10/11a/12/16 (`exc-tests.frozen.md` §2; R-15–R-18) and DREPRO-01..04 (`repro-start-rulings-draft.md` §3, §4;
 * lead 11-13 §9): the structural card's "不对，重新提". DREPRO-01/02 are one Work-Run batch over one and two blocks;
 * its answer opens one `exploration_followup` round per block on the block's adviser line. DREPRO-03's new top-level
 * block falls back to the proposer's line. DREPRO-04 ends that proposer's line and reads the follow-up's failed
 * record and reason. A plain reject and an empty reason keep today's paths.
 *
 * Today (the production package is not in this tree) DREPRO-01/02/03 are RED at `card.options`: a Work-Run proposal has
 * `operationRef`/`queryRunRef` null (`architecture/proposal-service.ts:825`) and the source read refuses it
 * (`sessions/exploration-followup-service.ts:123-125`), so the card offers `approve`/`reject` only. The package's
 * Work-Run arm, the null operation/round in `beginRepropose` (`sessions/exploration-control.ts:222-223`, `:245-246`)
 * and the proposer-line fallback turn them green; DEXC-10/11a/12/16 stay green today and guard the untouched paths.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureProposalRef } from '../../src/contracts/architecture-proposal.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import {
  coldStartCoarseProposal, coldStartRegionQuestion, dexcAnswer, dexcBarrier, dexcFollowUps, dexcNextCard as nextCard,
  dexcProposal, dexcRounds, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
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

/** A completed cold start, one adviser Work Run on the `:src` line proposing `ops`, and the two free region lines
 *  (the Work-Run proposer is the `:src` line). The Work Run's card waits at the end. */
async function workRunBatch(cold: S7D2ColdStartWorld, ops: readonly Record<string, unknown>[], label: string) {
  const { goal } = await cold.initialize();
  const { final } = await cold.walkToCompleted();
  const regionLine = async (id: string) => await cold.lineOf((final.explorations ?? [])
    .find(entry => entry.queryRunRef.runId.endsWith(`:${id}`))!.sessionRef, `${label}-${id}`);
  const lines = { src: await regionLine('src'), docs: await regionLine('docs') };
  await cold.waitFor('the region lines free', async () =>
    (await cold.host.readSession(lines.src.ref)).record.occupancy === null
    && (await cold.host.readSession(lines.docs.ref)).record.occupancy === null);
  await cold.adoptWorkPlan({ goal, label, taskId: `${label}-work`, line: lines.src,
    replies: dexcProposal(label, await cold.pin(), ops, `${label} work proposal`) });
  const card = await nextCard(cold);
  await cold.waitFor('the Work-Run line free again', async () =>
    (await cold.host.readSession(lines.src.ref)).record.occupancy === null);
  return { card, lines, goal };
}

/** The new top-level block DREPRO-03 proposes and DREPRO-04 proposes again after the line ends. */
const newTopLevelBlock = (): Record<string, unknown> => ({ op: 'add_module', module: {
  ref: { projectId: P, moduleId: 'newblock' }, name: 'newblock', responsibility: 'DREPRO new block',
  paths: ['newblock'], interfaces: [] } });

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

  it('DREPRO-01 a Work-Run batch offers repropose; one follow-up round opens on the block adviser line', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    const { card, lines } = await workRunBatch(cold,
      [{ op: 'set_module_name', moduleId: 'src', name: 'DREPRO work' }], 'drepro01');
    const pin = await cold.pin();
    expect(card.options.map(option => option.id)).toEqual(['approve', 'reject', 'repropose']);
    const before = (await dexcRounds(cold.host, lines.src)).length;
    await cold.host.scripted.script(lines.src, dexcProposal('drepro01-again', pin,
      [{ op: 'set_module_name', moduleId: 'src', name: 'DREPRO again' }], 'DREPRO-01 again'));
    expect(await dexcAnswer(cold.host, card, 'repropose', '换个说法', 'drepro01-answer'))
      .toMatchObject({ status: 'ready' });
    const next = await nextCard(cold, card);
    const follows = await dexcFollowUps(cold.host);
    expect(follows).toHaveLength(1);
    const [follow] = follows;
    expect(follow?.followUp).toEqual({ kind: 'repropose', moduleRefs: [{ projectId: P, moduleId: 'src' }],
      reason: '换个说法', sourceBatchRef: batchOf(card) });
    expect(follow?.plannedRounds).toBe(1);
    expect(follow?.explorations?.map(entry => entry.sessionRef)).toEqual([lines.src.ref]);
    const rounds = await dexcRounds(cold.host, lines.src);
    expect(rounds).toHaveLength(before + 1);
    expect(rounds.at(-1)).toContain('换个说法');
    expect(rounds.at(-1)).toContain(coldStartRegionQuestion('src'));
    expect((await cold.cards()).find(item => item.cardKey === card.cardKey)?.state).not.toBe('waiting_answer');
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision);
    expect(next.objects.slice(1).map(object => object.label)).toEqual(['DREPRO-01 again']);
  }, 300_000);

  it('DREPRO-02 a Work-Run batch touching two blocks opens one round per block with the reason', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    const { card, lines } = await workRunBatch(cold, [{ op: 'set_module_name', moduleId: 'src', name: 'DREPRO src' },
      { op: 'set_module_name', moduleId: 'docs', name: 'DREPRO docs' }], 'drepro02');
    const pin = await cold.pin();
    expect(card.options.map(option => option.id)).toEqual(['approve', 'reject', 'repropose']);
    const before = [(await dexcRounds(cold.host, lines.src)).length, (await dexcRounds(cold.host, lines.docs)).length];
    await cold.host.scripted.script(lines.src, dexcProposal('drepro02-src', pin,
      [{ op: 'set_module_name', moduleId: 'src', name: 'DREPRO src again' }], 'DREPRO-02 src again'));
    await cold.host.scripted.script(lines.docs, dexcProposal('drepro02-docs', pin,
      [{ op: 'set_module_name', moduleId: 'docs', name: 'DREPRO docs again' }], 'DREPRO-02 docs again'));
    expect(await dexcAnswer(cold.host, card, 'repropose', '两块都重看', 'drepro02-answer'))
      .toMatchObject({ status: 'ready' });
    const next = await nextCard(cold, card);
    const [follow] = await dexcFollowUps(cold.host);
    expect(follow?.followUp).toMatchObject({ kind: 'repropose', reason: '两块都重看', sourceBatchRef: batchOf(card) });
    expect((follow?.followUp?.moduleRefs ?? []).map(ref => ref.moduleId).sort()).toEqual(['docs', 'src']);
    expect(follow?.plannedRounds).toBe(2);
    expect(follow?.explorations?.map(entry => entry.sessionRef.sessionId).sort())
      .toEqual([lines.src.ref.sessionId, lines.docs.ref.sessionId].sort());
    const rounds = { src: await dexcRounds(cold.host, lines.src), docs: await dexcRounds(cold.host, lines.docs) };
    expect([rounds.src.length, rounds.docs.length]).toEqual([before[0]! + 1, before[1]! + 1]);
    expect([rounds.src.at(-1), rounds.docs.at(-1)].every(text => text?.includes('两块都重看'))).toBe(true);
    expect(rounds.src.at(-1)).toContain(coldStartRegionQuestion('src'));
    expect(rounds.docs.at(-1)).toContain(coldStartRegionQuestion('docs'));
    expect((await cold.cards()).find(item => item.cardKey === card.cardKey)?.state).not.toBe('waiting_answer');
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision);
    expect(next.objects.slice(1).map(object => object.label).sort()).toEqual(['DREPRO-02 docs again', 'DREPRO-02 src again']);
  }, 300_000);

  it('DREPRO-03 a new top-level block falls back to the proposer\'s line', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    const { card, lines } = await workRunBatch(cold, [newTopLevelBlock()], 'drepro03');
    const pin = await cold.pin();
    expect(card.options.map(option => option.id)).toEqual(['approve', 'reject', 'repropose']);
    const before = (await dexcRounds(cold.host, lines.src)).length;
    await cold.host.scripted.script(lines.src, dexcProposal('drepro03-again', pin, [newTopLevelBlock()], 'DREPRO-03 again'));
    expect(await dexcAnswer(cold.host, card, 'repropose', '这块也要重看', 'drepro03-answer'))
      .toMatchObject({ status: 'ready' });
    await nextCard(cold, card);
    const [follow] = await dexcFollowUps(cold.host);
    expect(follow?.followUp).toEqual({ kind: 'repropose', moduleRefs: [{ projectId: P, moduleId: 'newblock' }],
      reason: '这块也要重看', sourceBatchRef: batchOf(card) });
    expect(follow?.plannedRounds).toBe(1);
    expect(follow?.explorations?.map(entry => entry.sessionRef)).toEqual([lines.src.ref]);
    const rounds = await dexcRounds(cold.host, lines.src);
    expect(rounds).toHaveLength(before + 1);
    expect(rounds.at(-1)).toContain('这块也要重看');
    expect(rounds.at(-1)).toContain(coldStartRegionQuestion('newblock'));
    expect((await cold.cards()).find(item => item.cardKey === card.cardKey)?.state).not.toBe('waiting_answer');
    expect((await cold.pin()).catalogRef.revision).toBe(pin.catalogRef.revision);
  }, 300_000);

  it('DREPRO-04 an ended proposer line: the new top-level block is refused with the reason, no round, no card',
    async () => {
      const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
      worlds.push(cold);
      const { card, lines, goal } = await workRunBatch(cold, [newTopLevelBlock()], 'drepro04');
      // The Work-Run task is still open while its card waits, so `sessions/archive` is refused `busy`; the public
      // `sessions/archive-line` ends the line and drops that task (the same route the S7B3 world uses).
      const read = await cold.host.readSession(lines.src.ref);
      expect((await cold.host.post('sessions/archive-line', graphWrite(S6A_SCOPE, {
        sessionRef: lines.src.ref, reason: 'DREPRO-04', wait: null,
        tasks: [{ target: { kind: 'task', ref: { projectId: P, goalId: goal.goalId, taskId: 'drepro04-work' } },
          disposition: { kind: 'drop' } }],
      }, 'drepro04-archive', [{ ref: read.record.ref, revision: read.record.revision }]))).body)
        .toMatchObject({ status: 'ready', value: { state: 'archived' } });
      expect((await cold.host.readSession(lines.src.ref)).availability).toBe('unavailable');
      const before = (await dexcRounds(cold.host, lines.src)).length;
      expect(await dexcAnswer(cold.host, card, 'repropose', '这块也要重看', 'drepro04-answer'))
        .toMatchObject({ status: 'ready' });
      await cold.waitFor('the refused re-proposal', async () =>
        (await dexcFollowUps(cold.host))[0]?.phase === 'failed');
      const [follow] = await dexcFollowUps(cold.host);
      expect(follow?.result).toMatchObject({ status: 'failed' });
      expect(follow?.result?.reason).toContain('not in the adopted architecture');
      expect(follow?.result?.reason).toContain('proposer line has ended');
      expect(follow?.explorations ?? []).toEqual([]);
      expect(await dexcRounds(cold.host, lines.src)).toHaveLength(before);
      expect((await cold.proposalCards()).filter(item => item.cardKey !== card.cardKey)).toEqual([]);
      expect((await cold.cards()).find(item => item.cardKey === card.cardKey)?.state).not.toBe('waiting_answer');
    });

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
