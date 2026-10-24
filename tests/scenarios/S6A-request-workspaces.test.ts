/**
 * A request's scope across two workspaces of one project: a round of one
 * workspace is not a request round of another (select-idea and route answer
 * `not_found`), and a secretary of one workspace never takes a request of
 * another (`@` and a manual route answer `unavailable`). Memory and SQLite.
 *
 * Every prior state is real. The first workspace is the frozen S6A world's; a
 * request there comes from `requests/submit`. The other workspace of the same
 * project is registered through the public `workspaces/register` owner, and its
 * calls run in process through the world's `dispatch` with that workspace's
 * trusted Host context. The round a refused call names is the real round the
 * first workspace returned, used as returned, so the only error is the
 * workspace. A secretary of the other workspace needs the Host to configure
 * that workspace (its root and Kernel store, A8): `openS6ATwoWorkspaceWorld`.
 *
 * A3: the two record-backend factories are wrapped (the backend seam) to list
 * the record keys every `readMany` asks for, then answer unchanged. A refused
 * cross-workspace round must be refused before its record is read: the request
 * read further down would also answer `not_found`, and only the read list shows
 * which check refused it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionCard } from '../../src/app/core-http-types.js';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import {
  openS6ARequestWorld, openS6ATwoWorkspaceWorld, S6A_GOAL_1, S6A_SCOPE, S6A_SECOND_SCOPE,
  type S6ABackend, type S6ARequestWorld, type S6ASecondWorkspace, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { AG2B_PROJECT_REF, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';

const reads = vi.hoisted(() => {
  const state = { keys: [] as string[] };
  type Store = { readMany(refKeys: readonly string[]): Promise<unknown> };
  /** A3: the real backend; every `readMany` key is listed, every answer unchanged. */
  function wrap<B extends { records: Store }>(backend: B): B {
    const real = backend.records;
    return { ...backend, records: { ...real, readMany: (refKeys: readonly string[]) => {
      state.keys.push(...refKeys);
      return real.readMany(refKeys);
    } } } as B;
  }
  return { state, wrap };
});

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual,
    createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) =>
      reads.wrap(actual.createInMemoryRecordBackend(options)) };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>();
  return { ...actual,
    createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) =>
      reads.wrap(actual.createSqliteRecordBackend(options)) };
});

const worlds: S6ARequestWorld[] = [];

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()));
});

/** The other workspace of the world's project, for the rows that need no secretary there. */
const OTHER = { projectId: S6A_SCOPE.projectId, workspaceId: 's6a-other-workspace' } as const;

/** A route answer or a ref inside one is an object; any other shape fails here, with what came back. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`S6A: expected an object, received ${JSON.stringify(value) ?? String(value)}`);
  }
  return value as Record<string, unknown>;
}

const submitInput = (commandId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  commandId, goalId: S6A_GOAL_1.goalId, text: `S6A workspaces ${commandId}`, continues: null, recipient: null, ...overrides,
});

function sessionOf(value: unknown): SessionRef {
  return asRecord(value) as unknown as SessionRef;
}

function contextOf(scope: typeof OTHER): CoreCallContext {
  return createHostCoreCallContext({ scope, actor: { kind: 'human', id: 's6a-operator' },
    signal: new AbortController().signal });
}

async function post(world: S6ARequestWorld, suffix: string, input: unknown): Promise<Record<string, unknown>> {
  return asRecord((await world.post(suffix, { scope: S6A_SCOPE, input })).body);
}

async function requestView(world: S6ARequestWorld, root: QueryJobRef): Promise<RequestCoreViewV1> {
  const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`S6A: the request read is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

/** The keys `readMany` was asked for while `call` ran (A3), with the call's answer. */
async function readsDuring<T>(call: () => Promise<T>): Promise<{ result: T; keys: string[] }> {
  reads.state.keys.length = 0;
  const result = await call();
  return { result, keys: reads.state.keys.splice(0) };
}

/** A request of the first workspace: secretary A, one submitted round. */
async function firstWorkspaceRequest(backend: S6ABackend) {
  const world = await openS6ARequestWorld({ backend });
  worlds.push(world);
  const a = await world.createSecretary('a');
  const submitted = await post(world, 'requests/submit', submitInput('s6a-ws-root'));
  expect(submitted).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
  expect(sessionOf(submitted['secretary'])).toEqual(a.ref);
  // The other workspace of the same project, registered through its public owner.
  const registered = asRecord(await world.dispatch('workspaces/register', contextOf(OTHER), graphWrite(OTHER,
    { workspace: OTHER }, 's6a-other-workspace', [
      { ref: AG2B_PROJECT_REF, revision: 1 },
      { ref: { aggregateType: 'Workspace', ...OTHER }, revision: 0 },
    ])));
  expect(registered['status']).toBe('committed');
  await world.settleDetached();
  return { world, a, root: submitted['requestRoot'] as QueryJobRef, round: submitted['round'] as QueryJobRef };
}

describe.each(['memory', 'sqlite'] as const)('rejects: a round of another workspace (%s)', backend => {
  it('requests/select-idea from the other workspace on a real first-workspace round is not_found before the round is read', async () => {
    const { world, a, root, round } = await firstWorkspaceRequest(backend);
    const before = { view: await requestView(world, root), sessions: await world.listSessions() };

    const { result, keys } = await readsDuring(() => world.dispatch('requests/select-idea', contextOf(OTHER),
      plain(OTHER, { commandId: 's6a-ws-idea', round, index: 0 })));
    expect(result).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(keys.filter((key) => key.includes(round.queryJobId))).toEqual([]);
    expect({ view: await requestView(world, root), sessions: await world.listSessions() }).toEqual(before);
    expect(before.view.owner).toEqual(a.ref);
  });

  it('the request service refuses select_idea from the other workspace on a real first-workspace round before reading it', async () => {
    const { world, root, round } = await firstWorkspaceRequest(backend);
    const before = await requestView(world, root);

    const { result, keys } = await readsDuring(() => world.platform.requestRounds.precheck(contextOf(OTHER),
      { kind: 'select_idea', commandId: 's6a-ws-service-idea', round, index: 0 }));
    expect(result).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(keys.filter((key) => key.includes(round.queryJobId))).toEqual([]);
    expect(await requestView(world, root)).toEqual(before);
  });

  it('the request service refuses a drop from the other workspace on a real first-workspace round before reading it', async () => {
    const { world, root, round } = await firstWorkspaceRequest(backend);
    const before = await requestView(world, root);

    const { result, keys } = await readsDuring(() => world.platform.requestRounds.precheck(contextOf(OTHER),
      { kind: 'route', commandId: 's6a-ws-service-drop', round, to: null, reason: 'dropped' }));
    expect(result).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(keys.filter((key) => key.includes(round.queryJobId))).toEqual([]);
    expect(await requestView(world, root)).toEqual(before);
  });
});

/** The two-workspace world: secretary A in the first workspace, a secretary in the second. */
async function twoWorkspaces(backend: S6ABackend): Promise<{
  world: S6ARequestWorld; second: S6ASecondWorkspace; a: S6ASession; other: S6ASession;
}> {
  const { world, second } = await openS6ATwoWorkspaceWorld({ backend });
  worlds.push(world);
  const a = await world.createSecretary('a');
  const other = await second.createSecretary('other');
  expect(other.ref.projectId).toBe(S6A_SECOND_SCOPE.projectId);
  return { world, second, a, other };
}

type FirstWorkspaceState = { sessions: SessionCard[]; other: SessionCard };

async function firstWorkspaceState(world: S6ARequestWorld, second: S6ASecondWorkspace,
  other: S6ASession): Promise<FirstWorkspaceState> {
  return { sessions: await world.listSessions(), other: await second.readSession(other) };
}

/**
 * No request was written: nothing waits for the drain, and A, the first
 * workspace's only secretary, still takes a fresh request with no new line.
 */
async function expectNoRequestWritten(world: S6ARequestWorld, a: S6ASession): Promise<void> {
  const drained = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
    { maxRequests: 20, continuation: null });
  expect(drained).toMatchObject({ status: 'ready', value: { progressed: 0, blocked: 0 } });
  const next = await post(world, 'requests/submit', submitInput('s6a-ws-next'));
  expect(next).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
  expect(sessionOf(next['secretary'])).toEqual(a.ref);
}

describe.each(['memory', 'sqlite'] as const)('rejects: a secretary of another workspace (%s)', backend => {
  it('requests/submit with @ a secretary of the other workspace is unavailable and writes no round', async () => {
    const { world, second, a, other } = await twoWorkspaces(backend);
    const before = await firstWorkspaceState(world, second, other);

    const refused = await post(world, 'requests/submit', submitInput('s6a-ws-at-other', { recipient: other.ref }));
    expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(await firstWorkspaceState(world, second, other)).toEqual(before);
    await expectNoRequestWritten(world, a);
  });

  it('requests/route manual to a secretary of the other workspace is unavailable and leaves the request with its owner', async () => {
    const { world, second, a, other } = await twoWorkspaces(backend);
    const submitted = await post(world, 'requests/submit', submitInput('s6a-ws-route-root'));
    expect(sessionOf(submitted['secretary'])).toEqual(a.ref);
    const root = submitted['requestRoot'] as QueryJobRef;
    const round = submitted['round'] as QueryJobRef;
    const before = { view: await requestView(world, root), ...await firstWorkspaceState(world, second, other) };

    const refused = await post(world, 'requests/route',
      { commandId: 's6a-ws-route-other', round, to: other.ref, reason: 'manual' });
    expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect({ view: await requestView(world, root), ...await firstWorkspaceState(world, second, other) }).toEqual(before);
    expect(before.view).toMatchObject({ owner: a.ref, ownerState: 'owned' });
    expect(before.view.rounds).toHaveLength(1);
  });
});
