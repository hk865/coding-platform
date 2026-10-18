/**
 * K3-16 / UCR-08 (L15, L16, L17, D2; rework item 1): the SECOND unfinished
 * proposal round of one `stateEntry` always reaches the person. Even when every
 * `proposalTargets` item already has a proposal, the settlement is
 * `needs_decision` with `review_incomplete`; `proposal_missing` appears only
 * when a target really lacks a proposal. A new `stateEntry` counts from one
 * again.
 *
 * Everything is reached through the shared `K3-proposal-round` fixture: ONE
 * real `pending_review` record (claim → production prepare → the Runtime's own
 * start/end over §5.1's shell stand-in, RUN-20/RUN-22 over the real draft), the
 * review/proposal claims, the scripted `propose_safer_method` tool, the real
 * `run_crashed` end and `settleReview`. Every row runs on both backends: the
 * real Host recognition path (RUN-20/RUN-22 over the draft) reads the SQLite
 * fixture store or the world's ONE in-memory backend. The item is concluded
 * `done` by a real review round, so no other L17 reason can be added by the
 * final settlement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  answerK3Disposition, claimK3ReviewRound, createK3PendingReview, endK3RunUnfinished,
  openK3ReviewCardWorld, runK3ReviewRound, settleK3Review,
  writeK3Proposals, type K3ReviewCardWorld, type K3Round,
} from '../helpers/K3-proposal-round.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const open of worlds.splice(0)) await open.close(); });

async function world(kind: 'memory' | 'sqlite'): Promise<K3ReviewCardWorld> {
  const opened = await openK3ReviewCardWorld(kind);
  worlds.push(opened);
  return opened;
}

const DONE_EVIDENCE = 'K3-16 second-unfinished: the review round saw the command finish';
const UNLIKELY_EVIDENCE = 'K3-16 second-unfinished: the command leaves no crash trace';

function targetIds(record: UnknownCallReviewV1): string[] {
  return [...(record.proposalTargets ?? [])].sort();
}

function proposalIds(record: UnknownCallReviewV1): string[] {
  return record.proposals.map(proposal => proposal.callId).sort();
}

/**
 * The real `needs_decision` card whose single process item is concluded `done`:
 * one real `pending_review` record from the Runtime's own Run, a real review
 * round that writes `done`/`unlikely` through the public conclusion owner, ends
 * unfinished (UCR-06, first round), and the public
 * `settleReview{review_unavailable}` turns the record into the card. The item
 * verdict is therefore the review round's, not injected.
 */
async function concludedDecision(worldRef: K3ReviewCardWorld): Promise<UnknownCallReviewV1> {
  const created = await createK3PendingReview(worldRef, {
    taskId: 'k3-20-a', label: 'k3-16-second', command: 'npm run build',
  });
  expect(created).toMatchObject({ status: 'pending_review', inventory: 'complete', activeRound: null });
  expect(created.items).toHaveLength(1);
  const review = await runK3ReviewRound(worldRef, created, {
    conclusions: created.items.map(item => ({
      item: item.alias, verdict: 'done', evidence: DONE_EVIDENCE,
      crashSuspicion: { verdict: 'unlikely', evidence: UNLIKELY_EVIDENCE },
    })),
    end: 'unfinished',
  });
  expect(review.settled).toMatchObject({ status: 'pending_review', activeRound: null });
  const decision = await settleK3Review(worldRef, review.settled!, { cause: 'review_unavailable' });
  expect(decision.status).toBe('needs_decision');
  expect(decision.items.map(item => item.observed.verdict)).toEqual(['done']);
  return decision;
}

/** The real disposition answer + the real proposal claim (UCR-10/UCR-03). */
async function awaitingProposal(worldRef: K3ReviewCardWorld): Promise<K3Round> {
  const decision = await concludedDecision(worldRef);
  const proposed = await answerK3Disposition(worldRef, decision, 'safer_method');
  expect(proposed).toMatchObject({ status: 'awaiting_proposal', proposals: [],
    stateEntry: decision.stateEntry + 1 });
  return await claimK3ReviewRound(worldRef, proposed, { phase: 'proposal' });
}

/**
 * Steps 1-3: claim, write every proposal, end the Run `crashed`, settle; then
 * the second proposal round writes every proposal, ends `crashed`, settles.
 * Returns the second settlement.
 */
async function secondUnfinished(worldRef: K3ReviewCardWorld): Promise<UnknownCallReviewV1> {
  const first = await awaitingProposal(worldRef);
  const firstWritten = await writeK3Proposals(worldRef, first);
  expect(proposalIds(firstWritten.record)).toEqual(targetIds(first.record));
  await endK3RunUnfinished(worldRef, first.claim);
  const afterFirst = await settleK3Review(worldRef, firstWritten.record);
  expect(afterFirst).toMatchObject({ status: 'awaiting_proposal', activeRound: null });
  // UCR-06: one `unfinished` proposal round in this stateEntry, proposals kept.
  expect(afterFirst.rounds.filter(round =>
    round.stateEntry === afterFirst.stateEntry && round.phase === 'proposal'
    && round.result === 'unfinished')).toHaveLength(1);
  expect(proposalIds(afterFirst)).toEqual(targetIds(afterFirst));

  const second = await claimK3ReviewRound(worldRef, afterFirst, { phase: 'proposal' });
  const secondWritten = await writeK3Proposals(worldRef, second);
  expect(proposalIds(secondWritten.record)).toEqual(targetIds(second.record));
  await endK3RunUnfinished(worldRef, second.claim);
  return await settleK3Review(worldRef, secondWritten.record);
}

describe('K3-16 second unfinished proposal round (UCR-08, L15/L16/L17)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: every proposal written, both rounds unfinished -> needs_decision with review_incomplete',
    async kind => {
      const opened = await world(kind);
      const final = await secondUnfinished(opened);
      expect(final.status).toBe('needs_decision');
      expect(final.decisionReasons).toEqual(['review_incomplete']);
      expect(final.activeRound).toBeNull();
      // The proposal written by the two rounds is kept for the one real target.
      expect(proposalIds(final)).toEqual(targetIds(final));
      expect(targetIds(final)).toHaveLength(1);
      expect(final.rounds.filter(round =>
        round.stateEntry === final.stateEntry && round.phase === 'proposal'
        && round.result === 'unfinished')).toHaveLength(2);
    },
    120_000,
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: a target really lacking a proposal adds proposal_missing after review_incomplete',
    async kind => {
      const opened = await world(kind);
      // Neither proposal round writes anything, so every target really lacks a
      // proposal when the second unfinished round settles.
      const first = await awaitingProposal(opened);
      expect(first.record.proposals).toEqual([]);
      await endK3RunUnfinished(opened, first.claim);
      const afterFirst = await settleK3Review(opened, first.record);
      expect(afterFirst).toMatchObject({ status: 'awaiting_proposal', activeRound: null,
        proposals: [] });
      const second = await claimK3ReviewRound(opened, afterFirst, { phase: 'proposal' });
      await endK3RunUnfinished(opened, second.claim);
      const final = await settleK3Review(opened, second.record);
      expect(final.status).toBe('needs_decision');
      expect(final.decisionReasons).toEqual(['review_incomplete', 'proposal_missing']);
      expect(final.proposals).toEqual([]);
    },
    120_000,
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: a new stateEntry counts from one again',
    async kind => {
      const opened = await world(kind);
      const final = await secondUnfinished(opened);
      expect(final).toMatchObject({ status: 'needs_decision', decisionReasons: ['review_incomplete'] });

      // UCR-10 from the new card: the new stateEntry starts its proposal slots.
      const proposed = await answerK3Disposition(opened, final, 'safer_method');
      expect(proposed).toMatchObject({ status: 'awaiting_proposal', proposals: [],
        stateEntry: final.stateEntry + 1 });

      const round1 = await claimK3ReviewRound(opened, proposed, { phase: 'proposal' });
      const written1 = await writeK3Proposals(opened, round1);
      await endK3RunUnfinished(opened, round1.claim);
      const afterRound1 = await settleK3Review(opened, written1.record);
      // The first round of the NEW stateEntry is UCR-06, not a settlement.
      expect(afterRound1).toMatchObject({ status: 'awaiting_proposal', activeRound: null });
      expect(afterRound1.rounds.filter(round =>
        round.stateEntry === afterRound1.stateEntry && round.result === 'unfinished')).toHaveLength(1);

      const round2 = await claimK3ReviewRound(opened, afterRound1, { phase: 'proposal' });
      const written2 = await writeK3Proposals(opened, round2);
      await endK3RunUnfinished(opened, round2.claim);
      const settled = await settleK3Review(opened, written2.record);
      expect(settled.status).toBe('needs_decision');
      expect(settled.decisionReasons).toEqual(['review_incomplete']);
      expect(proposalIds(settled)).toEqual(targetIds(settled));
    },
    120_000,
  );
});
