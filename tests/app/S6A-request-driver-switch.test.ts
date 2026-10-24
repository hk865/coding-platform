/**
 * The Host's `requestDriver` start option (ruling S16): the request driver is
 * the wake loop that claims and runs request rounds on its own. Off (the
 * fixture's default) the Host creates no loop, so a submitted round waits where
 * the request command left it; on, the same submit runs to its answer through
 * the driver alone — the test never calls a `queries/*` route for it.
 *
 * Both backends: neither row restarts the Host. The off row proves "no claim"
 * deterministically: after the bounded public poll shows the round still
 * queued, a manual `queries/claim` commits — a claim that could not commit if
 * any driver had taken the round — and the Session's scripted reply is still
 * unconsumed (no model call). The on row is the same `requests/submit` input
 * (same command id and text) in a world started with `requestDriver: 'on'`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { BootstrapExecutionQueryProfile } from '../../src/app/core-http-types.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ABackend, type S6ASession,
} from '../helpers/S6A-request-fixture.js';

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];
/** The one submit both halves send: same command id, same text. */
const SUBMIT = { commandId: 's6a-driver-switch', goalId: S6A_GOAL_1.goalId, text: 'S6A driver switch' } as const;
const ANSWER = JSON.stringify({ schemaVersion: 1, body: 'S6A driver answer', ideas: [], goalCardDrafts: [] });

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

/** One round of a request read by its ref; a missing round fails the row. */
function roundOf(view: RequestCoreViewV1, ref: QueryJobRef): RequestCoreViewV1['rounds'][number] {
  const found = view.rounds.find(round => round.ref.queryJobId === ref.queryJobId);
  if (found === undefined) throw new Error(`S6A: the request read has no round ${ref.queryJobId}`);
  return found;
}

/** `queries/claim` of the round's current Run on the Session, pinned at the revisions read now. */
async function claim(world: S6AHostWorld, round: QueryJobRef, session: S6ASession): Promise<void> {
  const profiles: BootstrapExecutionQueryProfile[] = await world.readProfiles();
  const published = profiles.find(candidate => candidate.id === S6A_SECRETARY_PROFILE_ID);
  if (published === undefined) throw new Error('S6A: the secretary profile is not published');
  const profile = { profileId: published.id, sessionRole: published.sessionRole, roleBinding: published.roleBinding,
    runtimeBudget: published.runtimeBudget, budget: published.budget, consumerId: published.consumerId };
  const { job, run } = await readQuery(world.ag2b, round);
  const card = await world.readSession(session);
  const answer = await world.post('queries/claim', graphWrite(S6A_SCOPE, {
    queryRunRef: run.ref, sessionRef: session.ref, profile,
  }, `s6a-driver-switch-claim-${round.queryJobId}`, [
    { ref: job.ref, revision: job.revision }, { ref: run.ref, revision: run.revision },
    { ref: card.record.ref, revision: card.record.revision },
  ]));
  expect(answer.body).toMatchObject({ status: 'committed' });
}

describe.each(BACKENDS)('the request driver switch on the %s backend', backend => {
  it('off: the submitted round waits where the command left it, unclaimed and unrun', async () => {
    const world = await openS6AHostWorld({ backend });
    worlds.push(world);
    const a = await world.createSecretary('a');
    // The reply the round would consume; it stays queued while no driver exists.
    await world.scripted.script(a, [{ kind: 'text', text: ANSWER }]);
    const submitted = queued(await world.submit(SUBMIT));

    // The bounded public poll: the round is waiting, its request still processing.
    const waiting = await world.waitForRequest(submitted.requestRoot,
      current => roundOf(current, submitted.round).status === 'queued' && current.processing,
      'the submitted round waits where the command left it');
    expect(roundOf(waiting, submitted.round)).toMatchObject({ status: 'queued', session: null,
      assignedSession: a.ref, closeCode: null, closeDetail: null, answer: null });
    expect(waiting).toMatchObject({ owner: a.ref, ownerState: 'owned', assignment: 'assigned' });

    // No claim: the line is free, its Run is still pending at revision 1, and the
    // claim itself commits (nothing took the round in between).
    const card = await world.readSession(a);
    expect(card.record.occupancy).toBeNull();
    expect(card.record.health).toBe('available');
    const { job, run } = await readQuery(world.ag2b, submitted.round);
    expect(job.job.status).toBe('pending');
    expect(run.revision).toBe(1);
    expect(run.run).toMatchObject({ status: 'pending', outcome: null, endedAt: null });
    expect(run.run.executionState).toBeUndefined();
    await claim(world, submitted.round, a);

    // No model call: A's scripted reply was never consumed, before or by the claim.
    expect(await world.scripted.requests(a)).toEqual([]);
    expect(await world.scripted.pending(a)).toBe(1);
  }, 60_000);

  it('on: the same submit runs to its answer through the driver alone', async () => {
    const world = await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: ANSWER }]);
    const submitted = queued(await world.submit(SUBMIT));

    // The test calls no `queries/*` route for this round: the driver claims,
    // prepares, starts and observes it.
    const answered = await world.waitForRequest(submitted.requestRoot,
      current => roundOf(current, submitted.round).status === 'ended'
        && roundOf(current, submitted.round).answer !== null,
      'the driver runs the submitted round to its answer');
    expect(roundOf(answered, submitted.round)).toMatchObject({ status: 'ended', answer: 'S6A driver answer',
      session: a.ref, assignedSession: a.ref, closeCode: null, closeDetail: null });
    expect(answered.processing).toBe(false);
    expect(await world.scripted.requests(a)).toHaveLength(1);
    expect(await world.scripted.pending(a)).toBe(0);
  }, 60_000);
});
