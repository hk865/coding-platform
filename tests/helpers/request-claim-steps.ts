/**
 * The claim step of the request-round tests, through public routes only:
 * - `claimProfile`: a query profile the Host publishes (`bootstrap`'s query
 *   profiles) as a claim takes it (`SecretaryProfileV1`: the bootstrap's `id`
 *   is its `profileId`);
 * - `claimQuery`: `queries/claim` of a Query's current Run on a Session, pinned
 *   at the Job, Run and Session revisions read just before it, with a profile
 *   or without one;
 * - `claimWithSecretaryProfile`: the same with the published secretary profile.
 *
 * Every value it sends is read from a public route or given by the row; the
 * rows keep their own expected values. Not frozen.
 */
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { readQuery } from './A2-restart-fixture.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ARequestWorld, type S6ASession } from './S6A-request-fixture.js';

/** The published query profile `id` as a claim takes it; fails when the Host does not publish it. */
export async function claimProfile(world: S6ARequestWorld, id: string): Promise<Record<string, unknown>> {
  const profile = (await world.readProfiles()).find(candidate => candidate.id === id);
  if (profile === undefined) throw new Error(`no published query profile ${id}`);
  return { profileId: profile.id, sessionRole: profile.sessionRole, roleBinding: profile.roleBinding,
    runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId };
}

/**
 * `queries/claim` of the Query's current Run on the Session, pinned at the revisions read now, carrying `profile`
 * (none when `null`). Answers the route's body.
 */
export async function claimQuery(world: S6ARequestWorld, ref: QueryJobRef, session: S6ASession,
  profile: Record<string, unknown> | null, requestId: string): Promise<Record<string, unknown>> {
  const { job, run } = await readQuery(world.ag2b, ref);
  const card = await world.readSession(session);
  const input = profile === null
    ? { queryRunRef: run.ref, sessionRef: session.ref }
    : { queryRunRef: run.ref, sessionRef: session.ref, profile };
  return (await world.post('queries/claim', graphWrite(S6A_SCOPE, input, requestId, [
    { ref: job.ref, revision: job.revision }, { ref: run.ref, revision: run.revision },
    { ref: card.record.ref, revision: card.record.revision },
  ]))).body as Record<string, unknown>;
}

/** `claimQuery` with the secretary profile the Host publishes. */
export async function claimWithSecretaryProfile(world: S6ARequestWorld, ref: QueryJobRef, session: S6ASession,
  requestId: string): Promise<Record<string, unknown>> {
  return await claimQuery(world, ref, session, await claimProfile(world, S6A_SECRETARY_PROFILE_ID), requestId);
}
