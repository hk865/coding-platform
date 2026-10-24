/**
 * Picking a secretary (book-6a §3.4.2-§3.4.4, §3.12; spec §5.2 R-01a).
 *
 * `readSecretarySelectionFacts` is the store-level read on the frozen
 * `S6A-request-fixture.ts` world (memory and SQLite): secretaries through
 * `sessions/create`, one busy through `queries/submit` + `queries/claim`, one
 * archived through `sessions/archive-line`, one with a pending archive
 * request, one unprofiled secretary, one Work line, one active read-only copy
 * through the real consultation path, and (SQLite) one health-unavailable
 * secretary through the fixture's crash path. `admitRequestSecretary`, the one
 * L7 admission check, is called on the same world. The reader is given the
 * platform's OWN record store (a pass-through capture of the backend factory,
 * rule sheet A3/A4), the real `SessionFactsPort`, a `SecretaryProfilePort`
 * built from the Host's published `bootstrap` profiles, the real
 * `SessionDutyResolver` and the 6A project-scope adapter.
 *
 * The pure half (sorting and the clock) lives in
 * `S6A-secretary-selection-pure.test.ts`. Awaiting later work (book §5.2
 * R-01a): `ranGoal`, a real `busy` pending request round and an `inputTokens`
 * usage need `requests/submit`; `secretaryOpenCap` needs the Host option. Those
 * halves are NOT faked; this file asserts only what the public path can
 * produce now.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as memoryStoreModule from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteStoreModule from '../../src/core/record-store/sqlite-record-store.js';
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { SessionDutyReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import type {
  SecretaryCandidateFactsV1, SecretaryProfilePort, SecretaryProfileV1, SecretarySelectionFactsV1,
} from '../../src/core/work-graph/model/request-contracts.js';
import {
  admitRequestSecretary, createProjectSecretaryScope, createSecretarySelection,
} from '../../src/core/work-graph/tasks/secretary-selection.js';
import { AG2B_CONSUMER_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  S6A_GOAL_1, S6A_PLAIN_ROLE, S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING,
  openS6ARequestWorld, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import type { OperationReceipt } from '../../src/contracts/core/results.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';

// ------------------------------------------------------------------------ //
// The store-level read on the frozen fixture                                //
// ------------------------------------------------------------------------ //

type Backend = { records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort };

/**
 * A pass-through around each real backend factory (rule sheet A3/A4): the
 * platform builds and owns its own store; the test only keeps a reference so the
 * read under test can be given the platform's real records. Nothing is written.
 */
const backendBox = vi.hoisted(() => ({ backends: [] as unknown[] }));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof memoryStoreModule;
  return { ...actual,
    createInMemoryRecordBackend: (options: Parameters<typeof memoryStoreModule.createInMemoryRecordBackend>[0]) => {
      const backend = actual.createInMemoryRecordBackend(options);
      backendBox.backends.push(backend);
      return backend;
    } };
});

vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof sqliteStoreModule;
  return { ...actual,
    createSqliteRecordBackend: (options: Parameters<typeof sqliteStoreModule.createSqliteRecordBackend>[0]) => {
      const backend = actual.createSqliteRecordBackend(options);
      backendBox.backends.push(backend);
      return backend;
    } };
});

const latestBackend = (): Backend => {
  const backend = backendBox.backends[backendBox.backends.length - 1] as Backend | undefined;
  if (backend === undefined) throw new Error('S6A selection: no record backend was captured');
  return backend;
};

const worlds: S6ARequestWorld[] = [];

afterAll(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const WORKFLOW = {
  consumerId: AG2B_CONSUMER_ID,
  bindings: [{ workspace: S6A_SCOPE, sessionRole: S6A_WORK_ROLE, roleBinding: S6A_WORK_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } }],
};

/** The profile port production's `A/secretary-profiles.ts` (group H) will replace. */
async function profilesFromHost(world: S6ARequestWorld): Promise<SecretaryProfilePort> {
  const published = await world.readProfiles();
  const profiles: SecretaryProfileV1[] = published.map((profile) => ({
    profileId: profile.id, sessionRole: profile.sessionRole, roleBinding: profile.roleBinding,
    runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId,
  }));
  const key = (role: RoleConfigurationRef): string => canonicalJson(role as unknown as JsonValue);
  return {
    forSession(input) {
      return profiles.find((profile) => key(profile.sessionRole) === key(input.sessionRole)) ?? null;
    },
    async forNewLine() {
      return { status: 'ready', value: profiles[0] ?? null };
    },
  };
}

function dutyFromHost(world: S6ARequestWorld): SessionDutyReadPort {
  return createSessionDutyResolver({
    readRoleSpec: (...args) => world.platform.roles.readRoleSpec(...args),
    configuration: WORKFLOW,
  });
}

type SelectionReader = ReturnType<typeof createSecretarySelection>;
type SelectionCase = { world: S6ARequestWorld; reader: SelectionReader; facts: SecretarySelectionFactsV1;
  sessions: Record<string, S6ASession> };

async function readSelection(backend: 'memory' | 'sqlite'): Promise<SelectionCase> {
  const world = await openS6ARequestWorld({ backend });
  worlds.push(world);
  const sessions: Record<string, S6ASession> = {};
  // SQLite only: the A8 Q-04 crash path retires one secretary `unavailable`.
  if (backend === 'sqlite') {
    sessions['unavailable'] = await world.makeUnavailableSecretary('unavailable', { at: '2026-10-23T09:50:00.000Z' });
  }
  world.clock.set('2026-10-23T09:00:00.000Z');
  sessions['idle'] = await world.createSecretary('idle');
  world.clock.set('2026-10-23T09:05:00.000Z');
  sessions['busy'] = await world.createSecretary('busy');
  await world.occupy(sessions['busy']!);
  world.clock.set('2026-10-23T09:06:00.000Z');
  sessions['archived'] = await world.createSecretary('archived');
  await world.archive(sessions['archived']!);
  world.clock.set('2026-10-23T09:07:00.000Z');
  sessions['archiveRequested'] = await world.createSecretary('requested');
  await world.requestArchive(sessions['archiveRequested']!);
  world.clock.set('2026-10-23T09:11:00.000Z');
  // The plain consultation role HAS a Host profile, but its duty is not
  // `secretary`: the duty filter alone must exclude it.
  const plainCreated = await world.post('sessions/create', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, role: S6A_PLAIN_ROLE, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 's6a-session-plain', expected: [] },
  }));
  const plainReceipt = plainCreated.body as OperationReceipt<SessionRecord>;
  if (plainReceipt.status !== 'completed') {
    throw new Error(`S6A: the plain-role Session creation failed: ${JSON.stringify(plainCreated.body)}`);
  }
  const plainRef: SessionRef = { projectId: plainReceipt.value.ref.projectId, sessionId: plainReceipt.value.ref.sessionId };
  const plainCard = await world.readSession(plainRef);
  sessions['plain'] = { label: 'plain', ref: plainRef, aggregateRef: plainCard.record.ref,
    role: structuredClone(S6A_PLAIN_ROLE), createdAt: plainCard.record.createdAt };
  world.clock.set('2026-10-23T09:08:00.000Z');
  sessions['unprofiled'] = await world.createUnprofiledSecretary('unprofiled');
  world.clock.set('2026-10-23T09:09:00.000Z');
  sessions['work'] = await world.createWorkSession('work');
  world.clock.set('2026-10-23T09:10:00.000Z');
  sessions['released'] = await world.createSecretary('released');
  const releasedQuery = await world.occupy(sessions['released']!);
  world.clock.set('2026-10-23T09:20:00.000Z');
  await world.finishQuery(releasedQuery);
  world.clock.set('2026-10-23T09:30:00.000Z');
  sessions['copySource'] = await world.createSecretary('copy-source');
  world.clock.set('2026-10-23T09:40:00.000Z');
  const copied = await world.makeReadonlyCopy(sessions['copySource']!, 'readonly');
  sessions['copy'] = copied.copy;

  const reader = createSecretarySelection({
    records: latestBackend().records,
    sessionFacts: world.platform.sessionFacts,
    profiles: await profilesFromHost(world),
    scope: createProjectSecretaryScope(),
    duty: dutyFromHost(world),
  });
  const read = await reader.readSecretarySelectionFacts(world.humanContext(), {
    scope: S6A_SCOPE, goalId: S6A_GOAL_1.goalId, exclude: [],
  });
  if (read.status !== 'ready') {
    throw new Error(`S6A selection read was not ready: ${JSON.stringify(read)}`);
  }
  return { world, reader, facts: read.value, sessions };
}

describe.each(['memory', 'sqlite'] as const)('readSecretarySelectionFacts (%s)', (backend) => {
  let world: S6ARequestWorld;
  let reader: SelectionReader;
  let facts: SecretarySelectionFactsV1;
  let sessions: Record<string, S6ASession>;

  beforeAll(async () => {
    const selection = await readSelection(backend);
    world = selection.world;
    reader = selection.reader;
    facts = selection.facts;
    sessions = selection.sessions;
  });

  it('only admissible profiled secretaries are candidates', async () => {
    const bySession = new Map<string, SecretaryCandidateFactsV1>(
      facts.candidates.map((entry) => [entry.session.sessionId, entry] as const));

    const expected = [sessions['idle']!, sessions['busy']!, sessions['released']!, sessions['copySource']!]
      .map((session) => session.ref.sessionId).sort();
    expect([...bySession.keys()].sort()).toEqual(expected);

    // Inadmissible lines are absent, never merely ranked lower.
    for (const label of ['archived', 'archiveRequested', 'unprofiled', 'work', 'plain', 'copy']) {
      expect(bySession.has(sessions[label]!.ref.sessionId)).toBe(false);
    }
    if (backend === 'sqlite') {
      expect(bySession.has(sessions['unavailable']!.ref.sessionId)).toBe(false);
    }

    // The real duty resolver and the Host's published profiles decide: the
    // unprofiled secretary's RoleSpec says `secretary` but no profile names it;
    // the Work line resolves `executor`.
    expect(facts.candidates.every((entry) => entry.ranGoal === false)).toBe(true);
    expect(facts.candidates.every((entry) => entry.lastInputTokens === null)).toBe(true);
    expect(facts.candidates.every((entry) => entry.tooLong === false)).toBe(true);
    expect(facts.watermark).not.toBeNull();

    // A pending archive request is excluded by the Query dispatch admission; a
    // held occupancy is busy, not excluded.
    expect(bySession.get(sessions['busy']!.ref.sessionId)!.busy).toBe(true);
    for (const label of ['idle', 'released']) {
      expect(bySession.get(sessions[label]!.ref.sessionId)!.busy).toBe(false);
    }
    expect(bySession.get(sessions['copySource']!.ref.sessionId)!.busy).toBe(false);

    // Guards carry each candidate's public revision.
    for (const session of [sessions['idle']!, sessions['busy']!, sessions['released']!, sessions['copySource']!]) {
      const card = await world.readSession(session);
      const key = canonicalJson({ aggregateType: 'Session', ...session.ref } as unknown as JsonValue);
      const guard = facts.guards.find((entry) => entry.refKey === key);
      expect(guard?.expectedRevision).toBe(card.record.revision);
    }
  });

  it('drops the Sessions named by exclude', async () => {
    const read = await reader.readSecretarySelectionFacts(world.humanContext(), {
      scope: S6A_SCOPE, goalId: S6A_GOAL_1.goalId, exclude: [sessions['idle']!.ref, sessions['busy']!.ref],
    });
    if (read.status !== 'ready') throw new Error(`S6A selection exclude read: ${JSON.stringify(read)}`);
    const present = read.value.candidates.map((entry) => entry.session.sessionId);
    expect(present).not.toContain(sessions['idle']!.ref.sessionId);
    expect(present).not.toContain(sessions['busy']!.ref.sessionId);
    expect(present).toContain(sessions['released']!.ref.sessionId);
  });

  it('lastActivityAt uses the execution and copy instants', () => {
    const bySession = new Map<string, SecretaryCandidateFactsV1>(
      facts.candidates.map((entry) => [entry.session.sessionId, entry] as const));
    // An untouched line's clock is its creation.
    expect(bySession.get(sessions['idle']!.ref.sessionId)!.lastActivityAt).toBe('2026-10-23T09:00:00.000Z');
    // A claimed Query that never started leaves no later instant.
    expect(bySession.get(sessions['busy']!.ref.sessionId)!.lastActivityAt).toBe('2026-10-23T09:05:00.000Z');
    // The finished QueryRun's start/end is the line's latest activity.
    expect(bySession.get(sessions['released']!.ref.sessionId)!.lastActivityAt).toBe('2026-10-23T09:20:00.000Z');
    // A read-only copy's Query start belongs to its source line's clock even
    // though the copy does not occupy the source.
    expect(bySession.get(sessions['copySource']!.ref.sessionId)!.lastActivityAt).toBe('2026-10-23T09:40:00.000Z');
  });

  it('admitRequestSecretary admits a busy secretary and refuses each other rule', async () => {
    const deps = {
      sessionFacts: world.platform.sessionFacts,
      duty: dutyFromHost(world),
      profiles: await profilesFromHost(world),
    };
    const admit = async (session: SessionRef) => admitRequestSecretary(deps, world.humanContext(), {
      caller: S6A_SCOPE, session,
    });

    // L7: a held occupancy is not a refusal; it only makes the Session busy.
    const busy = await admit(sessions['busy']!.ref);
    if (busy.status !== 'ready' || busy.value.status !== 'admitted') {
      throw new Error(`S6A admission of the busy secretary: ${JSON.stringify(busy)}`);
    }
    const busyCard = await world.readSession(sessions['busy']!);
    expect(busy.value.session.ref).toEqual(busyCard.record.ref);
    expect(busy.value.profile.sessionRole).toEqual(sessions['busy']!.role);
    expect(busy.value.guards).toEqual([{
      refKey: canonicalJson({ aggregateType: 'Session', ...sessions['busy']!.ref } as unknown as JsonValue),
      expectedRevision: busyCard.record.revision,
    }]);

    // Archived / unavailable are the shared availability rule; a pending archive
    // request and a read-only copy are the Query dispatch rules.
    expect(await admit(sessions['archived']!.ref))
      .toMatchObject({ status: 'ready', value: { status: 'refused', code: 'busy' } });
    expect(await admit(sessions['archiveRequested']!.ref))
      .toMatchObject({ status: 'ready', value: { status: 'refused', code: 'busy' } });
    expect(await admit(sessions['copy']!.ref))
      .toMatchObject({ status: 'ready', value: { status: 'refused', code: 'forbidden' } });
    if (backend === 'sqlite') {
      expect(await admit(sessions['unavailable']!.ref))
        .toMatchObject({ status: 'ready', value: { status: 'refused', code: 'busy' } });
    }
    // Duty and the Host profile decide the rest.
    expect(await admit(sessions['work']!.ref))
      .toMatchObject({ status: 'ready', value: { status: 'refused', code: 'forbidden' } });
    expect(await admit(sessions['plain']!.ref))
      .toMatchObject({ status: 'ready', value: { status: 'refused', code: 'forbidden' } });
    expect(await admit(sessions['unprofiled']!.ref))
      .toMatchObject({ status: 'ready', value: { status: 'refused', code: 'forbidden' } });
    // A missing Session is unavailable (M1-03), never a refusal.
    expect(await admit({ projectId: S6A_SCOPE.projectId, sessionId: 's6a-missing-session' }))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
  });
});
