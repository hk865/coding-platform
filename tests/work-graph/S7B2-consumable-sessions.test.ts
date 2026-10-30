/**
 * C-candidates (a) (SR3 C.4; book-7b.md:1209): the Session-key continuation of `sessions/find` after a real commit.
 * Page 1 through the public route, a real `messages/send`, then the opaque cursor answers `source_stale` while
 * `page.afterSessionKey` = page 1's last returned Session key answers `ready` with exactly the Sessions whose
 * `plainSessionRefKey` follows that key in the fixture's directory order. Both backends in one table.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessagePage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionCard, SessionDirectoryPort, SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  createConsumableSessions, type ConsumableSessionBusyV1, type ConsumableSessionV1,
  type ConsumableSessionsPageV1,
} from '../../src/core/work-graph/views/consumable-sessions.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  openS7B2DirectoryWorld, type S7B2DirectoryName, type S7B2DirectoryWorld,
} from '../helpers/S7B2-consumable-sessions.js';
import { S6A_SCOPE, type S6AWorldOptions } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

const BACKENDS = ['memory', 'sqlite'] as const satisfies readonly S6AWorldOptions['backend'][];
const worlds: S7B2DirectoryWorld[] = [];

afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.close();
});

/** One public `sessions/find` as the Host, with a page the route's own caller could send. */
async function findPage(opened: S7B2DirectoryWorld,
  page: Parameters<SessionDirectoryPort['findSessions']>[1]['page']): Promise<ReadResult<SessionPage<SessionCard>>> {
  const answer = await opened.paging.world.post('sessions/find', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, includeArchived: false, page,
  }));
  expect(answer.httpStatus).toBe(200);
  return answer.body as ReadResult<SessionPage<SessionCard>>;
}

const keyList = (page: SessionPage<SessionCard>): string[] =>
  page.items.map(card => plainSessionRefKey(card.record.ref));

describe.each(BACKENDS)('C-candidates (a) on %s: the Session-key continuation', backend => {
  it('continues after the last Session key once a real send committed, where the opaque cursor is stale', async () => {
    const opened = await openS7B2DirectoryWorld({ backend });
    worlds.push(opened);
    const { paging } = opened;
    expect(paging.keys.length).toBeGreaterThan(2);

    const first = ready<SessionPage<SessionCard>>(await findPage(opened, { limit: 2 }),
      'the first directory page');
    expect(keyList(first)).toEqual(paging.keys.slice(0, 2));
    const lastKeyOfPageOne = paging.keys[1]!;
    expect(first.nextCursor).not.toBeNull();

    // A real send between pages advances the commit ledger.
    const sent = await paging.world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: paging.sessions[0]!.ref, text: 'S7B2 page break',
    }, 's7b2-page-break'));
    expect(sent.body).toMatchObject({ status: 'committed' });

    // The ruling's baseline: the opaque directory cursor no longer matches the ledger.
    expect(await findPage(opened, { limit: 2, cursor: first.nextCursor! }))
      .toMatchObject({ status: 'rejected', code: 'source_stale' });

    // The Session-key arm resumes from the key.
    const second = ready<SessionPage<SessionCard>>(
      await findPage(opened, { limit: 2, afterSessionKey: lastKeyOfPageOne }), 'the Session-key page');
    expect(keyList(second)).toEqual(paging.keys.slice(2));
    expect(second.nextCursor).toBeNull();

    // A cursor the caller still holds is ignored: this arm seeds `cursorSource = null`, so the
    // stale water level is never compared.
    const withStaleCursor = ready<SessionPage<SessionCard>>(await findPage(opened, {
      limit: 2, cursor: first.nextCursor!, afterSessionKey: lastKeyOfPageOne,
    }), 'the Session-key page with a stale cursor');
    expect(keyList(withStaleCursor)).toEqual(paging.keys.slice(2));
  }, 180_000);
});

// Part (b): busy reasons, offers and the view's own `next` continuation.
const directoryWorlds = new Map<string, Promise<S7B2DirectoryWorld>>();
function directoryWorld(backend: S6AWorldOptions['backend']): Promise<S7B2DirectoryWorld> {
  let opening = directoryWorlds.get(backend);
  if (opening === undefined) {
    opening = openS7B2DirectoryWorld({ backend });
    directoryWorlds.set(backend, opening);
  }
  return opening;
}
afterAll(async () => {
  for (const opening of directoryWorlds.values()) await (await opening).close();
});

async function readPage(world: S6AHostWorld, after: string | null,
  limit: number): Promise<ConsumableSessionsPageV1> {
  // The view from the real composition's five published owners (no hand-built dependency).
  const platform = world.platform;
  const result = await createConsumableSessions({
    directory: platform.sessions, executions: platform.executions, queries: platform.queries,
    messages: platform.messages, eligibility: platform.workflow,
  }).readConsumableSessions(world.humanContext(), { workspace: S6A_SCOPE, after, limit });
  return ready<ConsumableSessionsPageV1>(result, 'the consumable read');
}
function itemOf(page: ConsumableSessionsPageV1, key: string): ConsumableSessionV1 {
  const item = page.items.find(entry => plainSessionRefKey(entry.session) === key);
  if (item === undefined) throw new Error(`the consumable page has no Session ${key}`);
  return item;
}
const BUSY_MEMORY = [
  ['claim_not_started', 'claimedNotStarted'],
  ['query', 'queryClaimed'],
  ['query', 'queryEntered'],
  ['archive_request', 'archiveRequested'],
  ['copy', 'readonlyCopy'],
] as const satisfies readonly (readonly [ConsumableSessionBusyV1, S7B2DirectoryName])[];

describe('C-candidates (b) on memory: the busy reasons', () => {
  it.each(BUSY_MEMORY)('%s: %s is busy with no offers', async (busy, name) => {
    const opened = await directoryWorld('memory');
    const item = itemOf(await readPage(opened.world, null, 50), opened.sessions[name]!.key);
    expect(item.busy).toBe(busy);
    expect(item.kinds).toEqual([]);
    expect(item.nextMessage).toBeNull();
  }, 180_000);
});

describe('C-candidates (b) on memory: the candidate limit', () => {
  it('returns the idle candidate after the busy cards before it when limit is one', async () => {
    const opened = await directoryWorld('memory');
    const all = await readPage(opened.world, null, 100);
    // The fixture's own directory order: a non-busy card directly after a run of busy cards.
    const idleAt = all.items.findIndex((item, index) => item.busy === null && index > 0
      && all.items[index - 1]!.busy !== null);
    expect(idleAt, `observed order: ${all.items.map(item =>
      `${plainSessionRefKey(item.session)}:${item.busy ?? 'idle'}`).join(', ')}`).toBeGreaterThan(0);
    let runStart = idleAt;
    while (runStart > 0 && all.items[runStart - 1]!.busy !== null) runStart -= 1;
    const before = all.items[runStart - 1];
    const page = await readPage(opened.world,
      before === undefined ? null : plainSessionRefKey(before.session), 1);
    const expected = all.items.slice(runStart, idleAt + 1).map(item => plainSessionRefKey(item.session));
    expect(page.items.map(item => plainSessionRefKey(item.session))).toEqual(expected);
    expect(page.next).toBe(expected[expected.length - 1]);
  }, 180_000);
});

const BUSY_SQLITE = [
  ['unknown', 'unknown'],
  ['health', 'health'],
] as const satisfies readonly (readonly [ConsumableSessionBusyV1, S7B2DirectoryName])[];
// SQLite only: `unknown` needs the real Host crash and `health` the unavailable restart; memory refuses both.
describe('C-candidates (b) on sqlite: the crash and restart busy reasons', () => {
  it.each(BUSY_SQLITE)('%s: %s is busy with no offers', async (busy, name) => {
    const opened = await directoryWorld('sqlite');
    const item = itemOf(await readPage(opened.world, null, 50), opened.sessions[name]!.key);
    expect(item.busy).toBe(busy);
    expect(item.kinds).toEqual([]);
    expect(item.nextMessage).toBeNull();
  }, 240_000);
});
describe('C-candidates (b) on memory: the offers', () => {
  it.each([
    ['idleInquiry', ['inquiry'], 'inquiry'],
    ['notifyOnly', ['notify'], null],
    ['pausedGoalPerson', [], null],
  ] as const)('%s: kinds %j and nextMessage %s', async (name, kinds, nextKind) => {
    const opened = await directoryWorld('memory');
    const item = itemOf(await readPage(opened.world, null, 50), opened.sessions[name]!.key);
    expect(item.kinds).toEqual(kinds);
    expect(item.nextMessage?.kind ?? null).toBe(nextKind);
  }, 180_000);

  it('idlePerson: the offer is the real person message', async () => {
    const opened = await directoryWorld('memory');
    const item = itemOf(await readPage(opened.world, null, 50), opened.sessions.idlePerson!.key);
    expect(item.kinds).toEqual(['person_message', 'inquiry']);
    expect(item.nextMessage?.kind).toBe('person_message');
    const inbox = await opened.world.post('messages/inbox', plain(S6A_SCOPE, {
      recipient: opened.sessions.idlePerson!.session.ref, page: { limit: 10 } }));
    expect(inbox.httpStatus).toBe(200);
    const read = ready<SessionMessagePage>(inbox.body, 'the inbox read');
    const person = read.items.find(message => message.intent === 'action_request');
    expect(person).toBeDefined();
    expect(item.nextMessage?.messageRef).toEqual(person?.ref);
  }, 180_000);
});
describe.each(BACKENDS)('C-candidates (b) on %s: the view continuation', backend => {
  it('returns the last returned key as next and then the following Sessions', async () => {
    const opened = await directoryWorld(backend);
    const first = await readPage(opened.paging.world, null, 2);
    expect(first.items.map(entry => plainSessionRefKey(entry.session))).toEqual(opened.paging.keys.slice(0, 2));
    expect(first.next).toBe(opened.paging.keys[1]);
    const second = await readPage(opened.paging.world, first.next, 2);
    expect(second.items.map(entry => plainSessionRefKey(entry.session))).toEqual(opened.paging.keys.slice(2));
    expect(second.next).toBeNull();
  }, 240_000);
});


