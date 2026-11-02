/**
 * PL C-23 / §6.4.1, §6.7.1 (route table row 5a): the frozen
 * `decisions/candidate-card` read over the real HTTP route.
 *
 * The world is the existing PL readings fixture (`openPLReadingsWorld`,
 * `tests/helpers/PL-readings-fixture.ts:74`): a real S6A Host on the memory
 * backend, its adopted Plan and its installed check configuration. The
 * candidate is proposed through the public `plans/propose` route by
 * `S6ACardsWorkspace.proposeCandidate` (`tests/helpers/S6A-cards-fixture.ts:259`),
 * and the composite read is the platform's published `readCandidateCard`
 * reached through the Host's real HTTP server. No record is written by hand
 * and no store is read.
 *
 * The four facts are the frozen ones: the existing card, the diagnosis, the
 * `ReadResult<PlanReviewReadV1>` of the candidate's current version and the
 * candidate draft's taskbook export probe. `decisions/card` stays the bare
 * card read and is exercised with the same source.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { openPLReadingsWorld, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

type CandidateCardBody = ReadResult<{
  card: DecisionCardV1;
  diagnosis: readonly unknown[] | null;
  exactReview: ReadResult<{ status: string }>;
  exportRead: { status: string; stages?: readonly unknown[] };
}>;

const worlds: PLReadingsWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('PL candidate-card route', () => {
  it('returns card, diagnosis, exact review and export read for a real candidate', async () => {
    const fixture = await openPLReadingsWorld();
    worlds.push(fixture);
    const candidate = await fixture.main.proposeCandidate({
      label: 'pl-route-card', goal: fixture.goal, request: null,
    });
    const answer = await fixture.world.post('decisions/candidate-card', {
      scope: S6A_SCOPE,
      input: { goalRef: fixture.goal, proposalRef: candidate.proposal.ref },
    });
    expect(answer.httpStatus).toBe(200);
    const body = answer.body as CandidateCardBody;
    expect(body.status).toBe('ready');
    if (body.status !== 'ready') return;
    expect(body.value.card.source.kind).toBe('candidate');
    expect(body.value.card.candidateStatus).toBe('candidate');
    expect(body.value.card.state).toBe('waiting_answer');
    // The governed candidate's dependency plan is fully covered, so the
    // diagnosis is a real empty finding list (not the unreadable `null`).
    expect(body.value.diagnosis).toEqual([]);
    // No `planreview:` was sent for this candidate: the exact four-state read
    // is `not_sent`, never a fabricated verdict.
    expect(body.value.exactReview).toEqual({ status: 'ready', value: { status: 'not_sent' } });
    // The candidate draft's stages are empty, so the rooted probe has no file
    // to report (`ready`, no per-stage status).
    expect(body.value.exportRead).toEqual({ status: 'ready', stages: [] });

    // `decisions/card` keeps its original bare-card shape for the same source.
    const card = await fixture.world.post('decisions/card', {
      scope: S6A_SCOPE,
      input: { source: body.value.card.source },
    });
    expect(card.body).toEqual({ status: 'ready', value: body.value.card });
  }, 120_000);
});
