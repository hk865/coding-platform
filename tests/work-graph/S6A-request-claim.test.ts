/**
 * A request round's claim through the `queries/claim` route, on memory and
 * SQLite, with the secretary profile the Host publishes (`bootstrap`'s query
 * profiles) and the round's refs as `requests/submit` and `queries/read` return
 * them:
 * - the claim writes the profile's role binding and the attempt's profile
 *   (`requestProfile`), and the round reads `running`; a profile whose binding
 *   and budget differ from the Job intent's is the one the attempt keeps;
 * - a plain Query's claim writes no profile;
 * - `rejects:` a request round without a profile, a profile whose Session role
 *   is not the Session's (its role binding still fits the Session), a profile
 *   without its Session role, a profile on a plain Query; each followed by public
 *   reads showing that nothing changed (the Run pending at its revision, the
 *   Session's revision).
 *
 * Every step is a public route; no record is written by hand and no store is
 * read. Expected values are whole literals, written out by hand from the
 * fixture's literal configuration (`tests/helpers/S6A-request-fixture.ts`: the
 * profile 's6a-secretary-profile' with the binding 's6a-secretary-binding' on
 * the pack's role template `platform-secretary` at 's3.1', binding version 1,
 * policy 'legacy-template'; the AG2b runtime budget, query budget and consumer
 * it configures).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimProfile, claimQuery } from '../helpers/request-claim-steps.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_PLAIN_PROFILE_ID, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID,
  type S6ABackend, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';

const worlds: S6ARequestWorld[] = [];

async function open(backend: S6ABackend): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld({ backend });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  const openWorlds = worlds.splice(0);
  await Promise.all(openWorlds.map(world => world.close()));
});

/** `requests/submit` on goal 1; the free pick is the only secretary. Answers the round. */
async function submitRequest(world: S6ARequestWorld, commandId: string): Promise<QueryJobRef> {
  const submitted = (await world.post('requests/submit', plain(S6A_SCOPE, {
    commandId, goalId: S6A_GOAL_1.goalId, text: `S6A claim ${commandId}`, continues: null, recipient: null,
  }))).body as Record<string, unknown>;
  expect(submitted).toMatchObject({ status: 'queued', assignment: 'assigned' });
  return submitted['round'] as QueryJobRef;
}

async function roundStatus(world: S6ARequestWorld, root: QueryJobRef): Promise<string> {
  const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`S6A: the request is not readable: ${JSON.stringify(read)}`);
  return read.value.rounds[0]!.status;
}

describe.each(['memory', 'sqlite'] as const)('a request round claimed with its profile (%s)', backend => {
  it('writes the profile role binding and the attempt profile; the round runs', async () => {
    const world = await open(backend);
    const a = await world.createSecretary('a');
    const round = await submitRequest(world, 's6a-claim-1');
    const profile = await claimProfile(world, S6A_SECRETARY_PROFILE_ID);

    const claimed = await claimQuery(world, round, a, profile, 's6a-claim-1-claim');
    expect(claimed).toMatchObject({ status: 'committed' });
    const { run } = await readQuery(world.ag2b, round);
    expect(run.revision).toBe(2);
    expect(run.run.executionState).toMatchObject({ phase: 'claimed', sessionRef: a.ref });
    expect(run.run.executionState?.roleBinding).toEqual({ schemaVersion: 1, bindingId: 's6a-secretary-binding',
      templateId: 'platform-secretary', templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' });
    expect(run.run.executionState?.requestProfile).toEqual({
      profileId: 's6a-secretary-profile',
      runtimeBudget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 16, maxToolCalls: 16,
        timeoutMs: 60000, perResponseTokens: 512 },
      budget: { maxTokens: 200000, deadline: null },
      consumerId: 'ag2b-consumer',
    });
    expect(await roundStatus(world, round)).toBe('running');
    expect((await world.readSession(a)).record.occupancy).toMatchObject({ kind: 'execution', executionRef: run.ref });
  });

  it("the attempt keeps the claim profile's binding and budget, not the Job intent's", async () => {
    const world = await open(backend);
    const a = await world.createSecretary('a');
    const round = await submitRequest(world, 's6a-claim-5');
    const published = await claimProfile(world, S6A_SECRETARY_PROFILE_ID);
    const roleBinding = { ...(published['roleBinding'] as Record<string, unknown>), policyRevision: 's6a-other-policy' };
    const budget = { maxTokens: 4321, deadline: null };
    expect((await readQuery(world.ag2b, round)).job.job.intent.budget).not.toEqual({ maxTokens: 4321, deadline: null });
    const claimed = await claimQuery(world, round, a, { ...published, roleBinding, budget }, 's6a-claim-5-claim');
    expect(claimed).toMatchObject({ status: 'committed' });
    const { run } = await readQuery(world.ag2b, round);
    expect(run.run.executionState?.roleBinding).toEqual({ schemaVersion: 1, bindingId: 's6a-secretary-binding',
      templateId: 'platform-secretary', templateRevision: 's3.1', bindingVersion: 1, policyRevision: 's6a-other-policy' });
    expect(run.run.executionState?.requestProfile?.budget).toEqual({ maxTokens: 4321, deadline: null });
  });

  it("a plain Query's claim writes no profile", async () => {
    const world = await open(backend);
    const a = await world.createSecretary('a');
    const refs = await world.occupy(a);
    const { run } = await readQuery(world.ag2b, refs.queryJobRef);
    expect(run.run.executionState?.phase).toBe('claimed');
    expect(run.run.executionState?.requestProfile).toBeNull();
  });

  describe('rejects:', () => {
    /** The Run still pending at revision 1 and the Session at the revision read before. */
    async function expectUnchanged(world: S6ARequestWorld, ref: QueryJobRef, session: S6ASession, sessionRevision: number): Promise<void> {
      const { run } = await readQuery(world.ag2b, ref);
      expect(run.revision).toBe(1);
      expect(run.run.status).toBe('pending');
      expect(run.run.executionState).toBeUndefined();
      const card = await world.readSession(session);
      expect(card.record.revision).toBe(sessionRevision);
      expect(card.record.occupancy).toBeNull();
    }

    it('a request round without a profile', async () => {
      const world = await open(backend);
      const a = await world.createSecretary('a');
      const round = await submitRequest(world, 's6a-claim-2');
      const before = (await world.readSession(a)).record.revision;
      expect(await claimQuery(world, round, a, null, 's6a-claim-2-claim')).toMatchObject({ status: 'rejected', code: 'invalid' });
      await expectUnchanged(world, round, a, before);
      expect(await roundStatus(world, round)).toBe('queued');
    });

    it("a profile whose Session role is not the Session's", async () => {
      const world = await open(backend);
      const a = await world.createSecretary('a');
      const round = await submitRequest(world, 's6a-claim-3');
      const before = (await world.readSession(a)).record.revision;
      // The secretary profile with the plain profile's Session role: its role binding alone would fit A.
      const profile = { ...await claimProfile(world, S6A_SECRETARY_PROFILE_ID),
        sessionRole: (await claimProfile(world, S6A_PLAIN_PROFILE_ID))['sessionRole'] };
      expect(await claimQuery(world, round, a, profile, 's6a-claim-3-claim')).toMatchObject({ status: 'rejected', code: 'forbidden' });
      await expectUnchanged(world, round, a, before);
      expect(await roundStatus(world, round)).toBe('queued');
    });

    it('a profile without its Session role', async () => {
      const world = await open(backend);
      const a = await world.createSecretary('a');
      const round = await submitRequest(world, 's6a-claim-6');
      const before = (await world.readSession(a)).record.revision;
      const incomplete = Object.fromEntries(Object.entries(await claimProfile(world, S6A_SECRETARY_PROFILE_ID))
        .filter(([key]) => key !== 'sessionRole'));
      expect(await claimQuery(world, round, a, incomplete, 's6a-claim-6-claim')).toMatchObject({ status: 'rejected', code: 'invalid' });
      await expectUnchanged(world, round, a, before);
      expect(await roundStatus(world, round)).toBe('queued');
    });

    it('a profile on a plain Query', async () => {
      const world = await open(backend);
      const a = await world.createSecretary('a');
      const refs = await world.submitPlanningQuery('claim-4');
      const before = (await world.readSession(a)).record.revision;
      const profile = await claimProfile(world, S6A_SECRETARY_PROFILE_ID);
      expect(await claimQuery(world, refs.queryJobRef, a, profile, 's6a-claim-4-claim')).toMatchObject({ status: 'rejected', code: 'invalid' });
      await expectUnchanged(world, refs.queryJobRef, a, before);
    });
  });
});
