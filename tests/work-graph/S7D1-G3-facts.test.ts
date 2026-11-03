/**
 * `G3-facts` (book `:2029`, §3.7; PS-13; DR-7D1 G3-2-05/06): one role-facts record is written in the
 * real registration commit, carrying the `creator`/`openedBy` `roleFactsOf` decides for each production path. The
 * stored facts and the "no record" cases are observed on the real commit the `CommitBarrier` returns after it ran
 * (`holdAfter(...).reached`), then the public receipt; the derived contact is read back through
 * `role-lines/allocation` (W's route, the same deferred form as G3-1's rows). Line A is a person's `sessions/create`,
 * E is A's real `create_member`, the full handoff's successor inherits A's stored creator, the partial handoff is not
 * followed, an ordinary archive lapses the contact as a read, a reactivation restores it and a reuse changes nothing.
 * Named mutations (run here): drop `roleFactsOf`'s one null rule -> an unknown duty and a readonly copy write facts;
 * take E's creator from the creation intent instead of the member parent -> E's stored contact is not session A.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import type { SessionRoleFactsV1 } from '../../src/contracts/role-lines.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openingLinesOf } from '../helpers/S6A-host-fixture.js';
import { type S6ABackend } from '../helpers/S6A-request-fixture.js';
import {
  archiveS7D1Session, openS7D1AllocationWorld, reactivateS7D1Session, readS7D1Allocation, readS7D1Limits,
  setS7D1Open,
} from '../helpers/S7D1-allocation-world.js';
import {
  heldRegistration, seedS7D1RoleFactsChain, type S7D1RoleFactsChain,
} from '../helpers/S7D1-role-facts-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const BACKENDS = ['memory', 'sqlite'] as const satisfies readonly S6ABackend[];
const UNKNOWN_ROLE = { kind: 'legacy_template' as const, templateId: 's7d1-unbound-template', templateRevision: '1' };

function factsRecords(commit: PreparedCommit): readonly SessionRoleFactsV1[] {
  return commit.records.filter(record => record.schemaId === 'SessionRoleFacts@1')
    .map(record => JSON.parse(record.json) as SessionRoleFactsV1);
}

function factsIn(commit: PreparedCommit, sessionId: string): SessionRoleFactsV1 | null {
  return factsRecords(commit).find(value => value.sessionRef.sessionId === sessionId) ?? null;
}

type FactsCase = { readonly name: string; readonly run: (chain: S7D1RoleFactsChain) => Promise<void> };

const CASES: readonly FactsCase[] = [
  {
    name: 'a person create writes the trusted human actor, never the intent creator',
    async run(chain) {
      const principal = chain.world.humanContext().principal;
      if (principal.kind !== 'host') throw new Error('G3-facts: the world human is not a Host actor');
      const human = principal.actor;
      expect(factsIn(chain.registrations.A, chain.A.ref.sessionId)).toMatchObject({
        revision: 1, name: null, creator: { kind: 'human', actor: human }, openedBy: 'human',
      });
      expect(factsRecords(chain.registrations.A)).toHaveLength(1);
    },
  },
  {
    name: 'E created by A\'s member_create writes session A and member_create',
    async run(chain) {
      expect(factsIn(chain.registrations.E, chain.E.ref.sessionId)).toMatchObject({
        revision: 1, name: null, creator: { kind: 'session', ref: chain.A.ref }, openedBy: 'member_create',
      });
    },
  },
  {
    name: 'a platform create writes the platform creator and platform_rule',
    async run(chain) {
      // The real Host path: the open secretary cap leaves the request waiting, and the public raise of the cap
      // wakes the Host's own queue, which creates the line and commits the registration under the system actor.
      // O1b (L26): the opening secretary holds the one open seat; occupying it leaves the request waiting.
      const busy = (await openingLinesOf(chain.world)).secretary;
      const limits = await readS7D1Limits(chain.world);
      await setS7D1Open(chain.world, 'secretary', 1, limits.revision, 's7d1-facts-platform-seat');
      await chain.world.occupy(busy);
      const submitted = await chain.world.submit({
        commandId: 's7d1-facts-platform-request', goalId: chain.goal.goalId, text: 'S7D1 platform request',
      });
      if (submitted.status !== 'queued' || submitted.assignment !== 'unassigned') {
        throw new Error(`S7D1: requests/submit did not wait for an open seat: ${JSON.stringify(submitted)}`);
      }
      const held = await heldRegistration('S7D1 platform registration', async () => {
        const current = await readS7D1Limits(chain.world);
        await setS7D1Open(chain.world, 'secretary', 2, current.revision, 's7d1-facts-platform-open');
        return await chain.world.waitForRequest(submitted.requestRoot,
          view => view.assignment === 'assigned', 'the Host assigns the waiting request');
      });
      expect(factsRecords(held.commit)).toHaveLength(1);
      expect(factsIn(held.commit, factsRecords(held.commit)[0]!.sessionRef.sessionId)).toMatchObject({
        revision: 1, name: null, creator: { kind: 'platform' }, openedBy: 'platform_rule',
      });
    },
  },
  {
    name: 'a full handoff successor inherits the historical creator and rewrites no facts',
    async run(chain) {
      const historical = factsIn(chain.registrations.A, chain.A.ref.sessionId);
      const successor = factsIn(chain.registrations.full, chain.S.ref.sessionId);
      expect(successor).toMatchObject({
        revision: 1, name: null, creator: historical?.creator, openedBy: 'handoff',
        originOperation: chain.handoffs.full.createOperation,
      });
      expect(factsRecords(chain.registrations.full)).toHaveLength(1);
    },
  },
  {
    name: 'a partial handoff inherits the creator but the contact does not follow it',
    async run(chain) {
      const source = factsIn(chain.registrations.full, chain.S.ref.sessionId);
      const successor = factsIn(chain.registrations.partial, chain.P.ref.sessionId);
      expect(successor).toMatchObject({ creator: source?.creator, openedBy: 'handoff' });
      const report = await readS7D1Allocation(chain.world);
      expect(report.duties.executor.holders.find(holder => holder.session.sessionId === chain.E.ref.sessionId)?.creator)
        .toEqual({ kind: 'session', session: chain.S.ref });
    },
  },
  {
    name: 'an ordinary archive reads E\'s contact as lapsed and a reactivation restores it',
    async run(chain) {
      await archiveS7D1Session(chain.world, chain.S.ref, 'S7D1 G3-facts archive');
      try {
        const lapsed = await readS7D1Allocation(chain.world);
        expect(lapsed.duties.executor.holders.find(holder =>
          holder.session.sessionId === chain.E.ref.sessionId)?.creator).toEqual({ kind: 'lapsed' });
        await reactivateS7D1Session(chain.world, chain.S.ref, 'S7D1 G3-facts reactivate');
        const restored = await readS7D1Allocation(chain.world);
        expect(restored.duties.executor.holders.find(holder =>
          holder.session.sessionId === chain.E.ref.sessionId)?.creator).toEqual({ kind: 'session', session: chain.S.ref });
      } finally {
        const card = await chain.world.readSession(chain.S.ref);
        if (card.record.lifecycle === 'archived') await reactivateS7D1Session(chain.world, chain.S.ref, 'S7D1 G3-facts reactivate');
      }
    },
  },
  {
    name: 'a reactivated line reads the original contact again',
    async run(chain) {
      await archiveS7D1Session(chain.world, chain.S.ref, 'S7D1 G3-facts archive');
      await reactivateS7D1Session(chain.world, chain.S.ref, 'S7D1 G3-facts reactivate');
      const report = await readS7D1Allocation(chain.world);
      expect(report.duties.executor.holders.find(holder => holder.session.sessionId === chain.E.ref.sessionId)?.creator)
        .toEqual({ kind: 'session', session: chain.S.ref });
    },
  },
  {
    name: 'a reuse changes no stored facts and no contact',
    async run(chain) {
      expect(chain.member.reused.status).toBe('reused');
      expect(factsIn(chain.registrations.E, chain.E.ref.sessionId)).toMatchObject({
        creator: { kind: 'session', ref: chain.A.ref }, openedBy: 'member_create',
      });
      const report = await readS7D1Allocation(chain.world);
      expect(report.duties.executor.holders.find(holder => holder.session.sessionId === chain.E.ref.sessionId)?.creator)
        .toEqual({ kind: 'session', session: chain.S.ref });
    },
  },
];

type NoRecordCase = { readonly name: string; readonly run: (backend: S6ABackend) => Promise<void> };

const NO_RECORD_CASES: readonly NoRecordCase[] = [
  {
    name: 'an unknown duty writes no role-facts record',
    async run(backend) {
      const world = await openS7D1AllocationWorld({ backend });
      try {
        const held = await heldRegistration('S7D1 unknown-duty registration', () =>
          world.createLine({ label: 's7d1-facts-unknown', role: UNKNOWN_ROLE, duty: 'executor' }));
        expect(held.value.answer.body).toMatchObject({ status: 'completed', replayed: false });
        expect(factsRecords(held.commit)).toEqual([]);
      } finally {
        await world.close();
      }
    },
  },
  {
    name: 'a readonly copy writes no role-facts record',
    async run(backend) {
      const world = await openS7D1AllocationWorld({ backend });
      try {
        const source = await world.createLine({ label: 's7d1-facts-copy-source' });
        expect(source.session).not.toBeNull();
        const held = await heldRegistration('S7D1 readonly-copy registration',
          () => world.world.makeReadonlyCopy(source.session!, 's7d1-facts-copy'));
        expect(factsRecords(held.commit)).toEqual([]);
      } finally {
        await world.close();
      }
    },
  },
];

describe.each(BACKENDS)('G3-facts: no record on the real %s Host', (backend: S6ABackend) => {
  afterEach(() => { expect(commitBarrier.reset()).toEqual([]); });
  it.each(NO_RECORD_CASES)('$name', async (testCase: NoRecordCase) => {
    await testCase.run(backend);
  }, 180_000);
});

describe.each(BACKENDS)('G3-facts on the real %s Host', (backend: S6ABackend) => {
  let chain: S7D1RoleFactsChain | null = null;
  let setupError: unknown = null;
  beforeAll(async () => {
    try {
      chain = await seedS7D1RoleFactsChain({ backend });
    } catch (error) {
      setupError = error;
    }
  }, 300_000);
  afterAll(async () => { if (chain !== null) await chain.close(); });
  afterEach(() => { expect(commitBarrier.reset()).toEqual([]); });

  it.each(CASES)('$name', async (testCase: FactsCase) => {
    if (setupError !== null) throw setupError;
    if (chain === null) throw new Error('G3-facts: the creator chain did not open');
    await testCase.run(chain);
  }, 300_000);

});
