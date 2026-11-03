/**
 * A rejected proposal leaves no card, no pending proposal and no catalog change,
 * and the real commit observer proves the rejected call wrote zero
 * ArchitectureProposal commits. W-C is tests/helpers/S8C-proposal-world.ts: the
 * real Work tool and the real owner; the four variants arrive through the tool input.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openProposalWorld, type ProposalWorld } from '../helpers/S8C-proposal-world.js';
import type { ProposalResult } from '../../src/contracts/architecture-proposal.js';

const worlds: ProposalWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

async function world(): Promise<ProposalWorld> {
  const opened = await openProposalWorld();
  worlds.push(opened);
  return opened;
}

function invalid(result: ProposalResult) {
  if (result.status !== 'invalid') throw new Error(`expected invalid: ${JSON.stringify(result)}`);
  return result;
}

function forbidden(result: ProposalResult) {
  if (result.status !== 'rejected' || result.code !== 'forbidden') {
    throw new Error(`expected forbidden: ${JSON.stringify(result)}`);
  }
  return result;
}

describe('R12: invalid proposals write nothing', () => {
  it.each([
    { entry: 'a shape-valid bad op (remove a non-existent interface)',
      expected: () => 'unknown_interface',
      input: (w: ProposalWorld) => ({ ops: [{ op: 'remove_interface', moduleId: 's6a-core',
        interfaceId: 's8c-no-such-interface' }], moves: [] as unknown[] }) },
    { entry: 'a missing destination (an open link on a removed module is not moved)',
      expected: (w: ProposalWorld) => `responsibility_destination_missing: the open link ${
        (w.executorLinks.dest as { sessionId: string }).sessionId} is not moved`,
      input: (w: ProposalWorld) => ({ ops: [{ op: 'remove_module', moduleId: 's6a-dest' }],
        moves: [] as unknown[] }) },
    { entry: 'an unknown destination (a module not in the trial catalog)',
      expected: () => 'responsibility_destination_missing',
      input: (w: ProposalWorld) => ({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core',
        text: 'S8C unknown destination trial' }],
        moves: [{ link: w.executorLinks.core, to: { kind: 'modules',
          destinations: [{ projectId: w.projectId, moduleId: 's8c-absent' }] } }] }) },
    { entry: 'a duplicate owner (two executors move to one new empty module)',
      expected: () => 'duplicate_responsibility_move',
      input: (w: ProposalWorld) => ({ ops: [{ op: 'add_module', module: {
        ref: { projectId: w.projectId, moduleId: 's8c-empty' }, name: 's8c-empty',
        responsibility: 'Own s8c-empty', paths: ['src/empty'], interfaces: [] } }],
        moves: [{ link: w.executorLinks.core, to: { kind: 'modules',
          destinations: [{ projectId: w.projectId, moduleId: 's8c-empty' }] } },
        { link: w.executorLinks.ui, to: { kind: 'modules',
          destinations: [{ projectId: w.projectId, moduleId: 's8c-empty' }] } }] }) },
    { entry: 'an executor Run calls the adviser-only proposal tool',
      expected: () => 'a structural proposal is written by an adviser',
      actor: 'executor' as const,
      input: (w: ProposalWorld) => ({ ops: [{ op: 'add_module', module: {
        ref: { projectId: w.projectId, moduleId: 's8c-executor' }, name: 's8c-executor',
        responsibility: 'Own s8c-executor', paths: ['src/executor'], interfaces: [] } }],
        moves: [] as unknown[] }) },
  ])('$entry', async variant => {
    const target = await world();
    const { expected, input } = variant;
    const before = await target.readCatalog();
    expect(await target.proposalCardCount()).toBe(0);
    target.resetProposalCommits();
    const payload = input(target);
    const calls = [{ baseCatalogPin: target.pin,
      ops: payload.ops as never[], responsibilityMoves: payload.moves as never[],
      reason: 'R12 invalid proposal' }];
    const result = (await ('actor' in variant && variant.actor === 'executor'
      ? target.proposeAsExecutor(calls) : target.propose(calls)))[0]!;
    const refused = 'actor' in variant && variant.actor === 'executor' ? forbidden(result) : invalid(result);
    expect(refused.reason).toBe(expected(target));
    // DR G4-04: the rejected call's own new ArchitectureProposal commits are zero.
    expect(target.proposalCommits()).toBe(0);
    expect((await target.readCatalog()).revision).toBe(before.revision);
    expect(await target.proposalCardCount()).toBe(0);
  }, 120_000);
});
