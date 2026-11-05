/**
 * P's paging world and read-fault wrapper (fixture spec FX-7C1-04, drill rulings DR-05).
 *
 * One `openS6AHostWorld` opens on the requested backend. The first 51 Sessions are real `createWorkSession` calls,
 * sorted by `plainSessionRefKey`; a real `sessions/find` page 1 (limit 50) and page 2 are taken while the directory
 * holds only those 51, so page 2's actual remainder is one entry.
 *
 * Three modes:
 * - `page_two`: the 51-Session world with the first 50 (every key before the last) carrying a real archive request
 *   through `world.requestArchive`, so page 1 is un-reusable and the single idle last entry is the only candidate on
 *   page 2. The pre-request page 1/page 2 reads stay the actual remainder.
 * - `bound` (default): after the 51, 350 more real creates bring the directory to 401 with one-second-apart creation
 *   times, so the chooser's 8 x 50 read stops at 400, marks `incomplete: ['directory']`, and ranks the read set by the
 *   activity key instead of returning the first entry; no create is refused.
 * - `single`: one real Session; the rows that only need one candidate and a fault arm keep the wrapper.
 *
 * The returned ports wrap the REAL platform ports (`sessions.findSessions`, `sessionFacts.readSessionFacts`,
 * `workLines.listWorkLines`) with a one-shot fault arm: a `StoreError` or a plain `Error` is thrown at the named
 * read, never an empty page or a faked rejection. A `page` fault fires only on the plain directory read and a `link`
 * fault only on the task-target read, so A-10 can fail the responsible-link page without touching the directory.
 * The chooser itself is the composition's own pick path; no activity-record stand-in is built. Nothing reads a
 * store, builds a record or makes a context.
 */
import { StoreError } from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionCard, SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionFactsPort } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { openS6AHostWorld } from './S6A-host-fixture.js';
import { setS7D1Open } from './S7D1-allocation-world.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_AT, S6A_SCOPE, type S6ASession, type S6AWorldOptions } from './S6A-request-fixture.js';

export type S7C1FaultTarget = 'page' | 'link' | 'facts';
export type S7C1FaultKind = 'store' | 'plain';
export type S7C1PagingMode = 'page_two' | 'bound' | 'single';

export type S7C1PagingWorld = {
  readonly backend: S6AWorldOptions['backend'];
  readonly world: S6AHostWorld;
  /** The page Sessions in `plainSessionRefKey` order: 51 in `page_two`/`bound`, the one Session in `single`. */
  readonly page: { readonly sessions: readonly S6ASession[]; readonly keys: readonly string[] };
  /** The real page 1 and page 2 taken while only the 51 Sessions existed; `null` outside `page_two`/`bound`. */
  readonly pageTwo: {
    readonly first: SessionPage<SessionCard>;
    readonly second: SessionPage<SessionCard>;
  } | null;
  /** All 401 Sessions in `plainSessionRefKey` order; only `bound` builds it. */
  readonly bound: { readonly sessions: readonly S6ASession[]; readonly keys: readonly string[] } | null;
  readonly directory: SessionDirectoryPort;
  readonly facts: SessionFactsPort;
  readonly faults: {
    /** Arms the next read of `target`; `kind` defaults to `'store'`. */
    arm(target: S7C1FaultTarget, kind?: S7C1FaultKind): void;
  };
  close(): Promise<void>;
};

function ordered(sessions: readonly S6ASession[]): readonly S6ASession[] {
  return [...sessions].sort((left, right) =>
    plainSessionRefKey(left.ref) < plainSessionRefKey(right.ref) ? -1 : 1);
}

export async function openS7C1PagingWorld(options: {
  backend: S6AWorldOptions['backend']; mode?: S7C1PagingMode;
}): Promise<S7C1PagingWorld> {
  const mode = options.mode ?? 'bound';
  const world = await openS6AHostWorld({ backend: options.backend });
  await setS7D1Open(world, 'executor', 401, 0, 's7c1-paging-executors');
  const platform = world.platform;

  const armed = new Map<S7C1FaultTarget, S7C1FaultKind>();
  function fire(target: S7C1FaultTarget): void {
    const kind = armed.get(target);
    if (kind === undefined) return;
    armed.delete(target);
    if (kind === 'store') throw new StoreError('busy', `S7C1: the injected ${target} read fault`);
    throw new Error(`S7C1: the injected ${target} read fault`);
  }

  const realFind = platform.sessions.findSessions;
  const directory: SessionDirectoryPort = {
    ...platform.sessions,
    async findSessions(ctx, input) {
      fire(input.target === undefined ? 'page' : 'link');
      return realFind(ctx, input);
    },
  };

  const readPage = async (cursor: string | null): Promise<SessionPage<SessionCard>> => {
    const read = await directory.findSessions(world.humanContext(), {
      workspace: { ...S6A_SCOPE }, includeArchived: false,
      page: cursor === null ? { limit: 50 } : { limit: 50, cursor },
    });
    if (read.status !== 'ready') throw new Error(`S7C1: the page read is not ready: ${JSON.stringify(read)}`);
    return read.value;
  };

  let page: { sessions: readonly S6ASession[]; keys: readonly string[] };
  let pageTwo: S7C1PagingWorld['pageTwo'] = null;
  let bound: S7C1PagingWorld['bound'] = null;

  if (mode === 'single') {
    const only = await world.createWorkSession('s7c1-single');
    page = { sessions: [only], keys: [plainSessionRefKey(only.ref)] };
  } else {
    const pageSessions: S6ASession[] = [];
    for (let index = 0; index < 51; index += 1) {
      pageSessions.push(await world.createWorkSession(`s7c1-page-${String(index).padStart(2, '0')}`));
    }
    const sorted = ordered(pageSessions);
    const first = await readPage(null);
    if (first.nextCursor === null) throw new Error('S7C1: the 51-Session page 1 has no next cursor');
    const second = await readPage(first.nextCursor);
    page = { sessions: sorted, keys: sorted.map(session => plainSessionRefKey(session.ref)) };
    pageTwo = { first, second };

    if (mode === 'page_two') {
      // Page 1 is the 50 lower keys; a real archive request excludes each before the facts read, so the one idle
      // last entry is only reachable on page 2. The request keeps the line active, so the pages themselves stay 50+1.
      for (const session of sorted.slice(0, 50)) await world.requestArchive(session);
    } else {
      // The 8 x 50 traversal needs 401 real Sessions in the same directory; each create still succeeds. One-second
      // creation steps make the read set's activity order real, so the winner is not just the first read entry.
      const base = Date.parse(S6A_AT);
      const extra: S6ASession[] = [];
      for (let index = 0; index < 350; index += 1) {
        extra.push(await world.createWorkSession(`s7c1-bound-${String(index).padStart(3, '0')}`,
          { at: new Date(base + (index + 1) * 1_000).toISOString() }));
      }
      const all = ordered([...sorted, ...extra]);
      bound = { sessions: all, keys: all.map(session => plainSessionRefKey(session.ref)) };
    }
  }

  const realFacts = platform.sessionFacts.readSessionFacts;
  const facts: SessionFactsPort = {
    ...platform.sessionFacts,
    async readSessionFacts(ctx, sessionRef) {
      fire('facts');
      return realFacts(ctx, sessionRef);
    },
  };

  return {
    backend: world.backend, world, page: { sessions: page.sessions, keys: page.keys },
    pageTwo, bound,
    directory, facts,
    faults: {
      arm(target, kind = 'store') { armed.set(target, kind); },
    },
    close: () => world.close(),
  };
}
