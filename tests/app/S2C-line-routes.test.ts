/**
 * Slice 2C row 2C-31 (LE7): the seven HTTP routes for the line/detail reads and
 * the one pin write (spec §2, L13; L-rule 5, "a failure is an error code, never
 * an empty list/0").
 *
 * Everything is driven through the REAL `CORE_ROUTE_SPECS` table with
 * `parseCoreRouteRequest` + `dispatchCoreRoute` over the REAL
 * `createPlatformCoreRouteBindings`: the seven route rows keep their exact
 * literal kind/binding/owner, `lines/list` returns the same value the real
 * `WorkLineReadPort` returns (LE3), a storage read failure comes back as an
 * error code, and `lines/pin` is a graph_write whose same-requestId replay is
 * the ORIGINAL receipt.
 *
 * The only Doubles are the storage wrappers (L-fixtures exception): a named
 * read is made to fail. Data is built through group L's and group P's public
 * helpers, which build it only through the real services.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { ArchivedLinePageV1, WorkLineDetailV1, WorkLineListV1, WorkLineSectionPageV1 } from '../../src/contracts/work-line.js';
import type { WorkLineConversationPageV1 } from '../../src/app/core-http-types.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createWorkLineConversation } from '../../src/composition/work-line-conversation.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import {
  CORE_ROUTE_SPECS, CoreRouteRejectionError, createPlatformCoreRouteBindings, dispatchCoreRoute,
  parseCoreRouteRequest, type CoreRouteBindings,
} from '../../src/app/core-routes.js';
import type { CoreRouteSuffix } from '../../src/app/core-http-types.js';
import { createLineSettingsService } from '../../src/core/work-graph/configuration/line-settings-service.js';
import type { WorkLineStore } from '../../src/core/work-graph/views/work-line-reader.js';
import {
  buildD1, openLineFixture, type D1, type LineFixture,
} from '../helpers/S2C-L-line-support.js';
import {
  acceptPin, openPinsFixture, pinRequest, type S2CPinsFixture,
} from '../helpers/S2C-P-pins-fixture.js';

/** A typed real platform supplies the shape; only the composed line owners are exercised. */
const noWorkspace = {
  async resolveRoot() {
    return { status: 'rejected' as const, code: 'not_found' as const, reason: 'no route fixture workspace IO' };
  },
  async authorize() {
    return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no route fixture workspace IO' };
  },
};

/** The literal §2 route table for the seven suffixes. */
const EXPECTED_ROUTES: Record<'lines/list' | 'lines/archived' | 'lines/read' | 'lines/page'
  | 'lines/pin' | 'graph/hover' | 'graph/detail', { kind: 'plain' | 'graph_write'; binding: string; owner: string }> = {
  'lines/list': { kind: 'plain', binding: 'listWorkLines', owner: 'workLines.listWorkLines' },
  'lines/archived': { kind: 'plain', binding: 'listArchivedLines', owner: 'workLines.listArchivedLines' },
  'lines/read': { kind: 'plain', binding: 'readWorkLine', owner: 'workLines.readWorkLine' },
  'lines/page': { kind: 'plain', binding: 'readWorkLinePage', owner: 'workLineConversation.readWorkLinePage' },
  'lines/pin': { kind: 'graph_write', binding: 'setLinePins', owner: 'lineSettings.setLinePins' },
  'graph/hover': { kind: 'plain', binding: 'readGraphHover', owner: 'nodeDetail.readGraphHover' },
  'graph/detail': { kind: 'plain', binding: 'readNodeDetail', owner: 'nodeDetail.readNodeDetail' },
};

const SCOPE: WorkspaceScope = { projectId: 'p-2c31', workspaceId: 'w-2c31' };

function routeList(bindings: CoreRouteBindings, ctx: CoreCallContext, scope: WorkspaceScope) {
  return dispatchCoreRoute(bindings, 'lines/list', ctx, parseCoreRouteRequest('lines/list', {
    scope, input: { workspace: scope },
  })) as Promise<ReadResult<WorkLineListV1>>;
}

function routePin(bindings: CoreRouteBindings, ctx: CoreCallContext, scope: WorkspaceScope, request: unknown) {
  return dispatchCoreRoute(bindings, 'lines/pin', ctx, parseCoreRouteRequest('lines/pin', {
    scope, request,
  })) as Promise<WriteResult<WorkspaceSnapshot>>;
}

function routeArchived(bindings: CoreRouteBindings, ctx: CoreCallContext, scope: WorkspaceScope, limit: number) {
  return dispatchCoreRoute(bindings, 'lines/archived', ctx, parseCoreRouteRequest('lines/archived', {
    scope, input: { workspace: scope, page: { limit } },
  })) as Promise<ReadResult<ArchivedLinePageV1>>;
}

function routeRead(bindings: CoreRouteBindings, ctx: CoreCallContext, scope: WorkspaceScope, key: SessionRef) {
  return dispatchCoreRoute(bindings, 'lines/read', ctx, parseCoreRouteRequest('lines/read', {
    scope, input: { workspace: scope, key },
  })) as Promise<ReadResult<WorkLineDetailV1 | { kind: 'branched'; heads: SessionRef[] }>>;
}

function routePage(bindings: CoreRouteBindings, ctx: CoreCallContext, scope: WorkspaceScope, key: SessionRef,
  section: WorkLineSectionPageV1['section'] | 'conversation', limit: number) {
  return dispatchCoreRoute(bindings, 'lines/page', ctx, parseCoreRouteRequest('lines/page', {
    scope, input: { workspace: scope, key, section, page: { limit } },
  })) as Promise<ReadResult<WorkLineSectionPageV1 | WorkLineConversationPageV1>>;
}

/** The D1 route test never reads Kernel history: the conversation route's WorkGraph source is the only step reached. */
const unsupportedSessionHistory: RuntimeExecutionPort['readSessionHistory'] = async () =>
  ({ status: 'rejected', code: 'unsupported', reason: 'the D1 route test does not read Kernel history' });

/** Every read rejects; this is the storage wrapper of the row (no stub service). */
function failingReads(store: WorkLineStore): WorkLineStore {
  const fail = () => ({ status: 'rejected' as const, code: 'unavailable' as const, reason: 'injected 2C-31 read failure' });
  return {
    ...store,
    async readMany() { return fail(); },
    async lookup() { return fail(); },
    async lookupOrdered() { return fail(); },
    async countLookup() { return fail(); },
    async eventAt() { return fail(); },
  };
}

describe('2C-31 route table and envelopes', () => {
  it('2C-31 (a) the seven routes are in CORE_ROUTE_SPECS with the exact kind, binding and owner', () => {
    for (const [suffix, expected] of Object.entries(EXPECTED_ROUTES)) {
      expect(CORE_ROUTE_SPECS[suffix as CoreRouteSuffix]).toEqual(expected);
    }
  });

  it('2C-31 (c) the parser takes the graph_write envelope for lines/pin and the plain envelope for lines/list', () => {
    const pin = parseCoreRouteRequest('lines/pin', {
      scope: SCOPE,
      request: { input: { workspace: SCOPE, add: [], remove: [] }, meta: { requestId: 'r', expected: [] } },
    });
    expect(pin.ok).toBe(true);
    if (pin.ok) expect(pin.kind).toBe('graph_write');

    const list = parseCoreRouteRequest('lines/list', { scope: SCOPE, input: { workspace: SCOPE } });
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.kind).toBe('plain');

    const wrong = parseCoreRouteRequest('lines/pin', { scope: SCOPE, input: {} });
    expect(wrong.ok).toBe(false);
  });
});

describe.each(['memory', 'sqlite'] as const)('2C-31 line reads through the routes (%s)', (kind) => {
  let fixture: LineFixture;
  let composed: Awaited<ReturnType<typeof createTargetPlatform>>;
  let bindings: CoreRouteBindings;

  beforeAll(async () => {
    fixture = await openLineFixture(kind);
    await fixture.createSession('s-2c31-head');
    composed = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: noWorkspace });
    bindings = createPlatformCoreRouteBindings({ ...composed, workLines: fixture.reader });
  });

  afterAll(async () => {
    await composed.close();
    await fixture.close();
  });

  it('2C-31 (e) a storage read failure is an error code, not an empty ready line list', async () => {
    const failingBindings = createPlatformCoreRouteBindings({
      ...composed, workLines: fixture.readerWith(failingReads(fixture.records)),
    });
    const result = await routeList(failingBindings, fixture.ctx, fixture.base.scope);
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error(`expected a rejection, got ${JSON.stringify(result)}`);
    expect(result.code).toBe('unavailable');
  });
});

describe('2C-31 lines/pin is a graph_write that replays the original receipt', () => {
  let fixture: S2CPinsFixture;
  let composed: Awaited<ReturnType<typeof createTargetPlatform>>;

  beforeAll(async () => {
    fixture = await openPinsFixture('memory');
    composed = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: noWorkspace,
      operatorActor: fixture.operator });
  });

  afterAll(async () => {
    await composed.close();
    await fixture.close();
  });

  it('2C-31 (g) the composed platform itself publishes both owners through the routes', async () => {
    const realBindings = createPlatformCoreRouteBindings(composed);
    const list = await routeList(realBindings, fixture.operatorCtx, fixture.scope);
    expect(list.status).toBe('ready');
    if (list.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(list)}`);
    expect(list.value.rows).toEqual([]);
    expect(list.value.counts.working).toEqual({ status: 'exact', value: 0 });
    expect(list.value.counts.standby).toEqual({ status: 'exact', value: 0 });

    // The composed pin owner is the real service (not the unsupported gap): an
    // unknown Workspace is `not_found`, a domain code, and a graph_write.
    const anySession = await fixture.createSession('route-pin-real');
    const request = pinRequest(fixture, { add: [anySession], remove: [], requestId: 'route-pin-real-request' });
    let caught: unknown;
    try {
      await routePin(realBindings, fixture.operatorCtx, fixture.scope, request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CoreRouteRejectionError);
    expect((caught as CoreRouteRejectionError).rejection.code).toBe('not_found');
  });

  it('2C-31 (f) the same requestId returns the original receipt, and a rejection is a route error code', async () => {
    const bindings = createPlatformCoreRouteBindings({ ...composed, lineSettings: fixture.pins });
    const first = await fixture.createSession('route-pin-first');
    const request = pinRequest(fixture, { add: [first], remove: [], requestId: 'route-pin-request' });
    const committed = await routePin(bindings, fixture.operatorCtx, fixture.scope, request);
    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') throw new Error(`expected committed, got ${JSON.stringify(committed)}`);
    acceptPin(fixture, committed);

    const replayed = await routePin(bindings, fixture.operatorCtx, fixture.scope, request);
    expect(replayed.status).toBe('committed');
    if (replayed.status !== 'committed') throw new Error(`expected committed, got ${JSON.stringify(replayed)}`);
    expect(replayed.replayed).toBe(true);
    expect(replayed.value).toEqual(committed.value);

    // A refused pin write is a route rejection, not a returned value.
    const second = await fixture.createSession('route-pin-second');
    const stale = pinRequest(fixture, { add: [second], remove: [], requestId: 'route-pin-stale', revision: 0 });
    let caught: unknown;
    try {
      await routePin(bindings, fixture.operatorCtx, fixture.scope, stale);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CoreRouteRejectionError);
    expect((caught as CoreRouteRejectionError).rejection.code).toBe('revision_conflict');

    // A storage read failure while loading the Workspace is `unavailable`.
    const failingRecords: WorkLineStore = {
      ...(fixture.base.records as unknown as WorkLineStore),
      async readMany() {
        return { status: 'rejected' as const, code: 'unavailable' as const, reason: 'injected 2C-31 workspace read failure' };
      },
    };
    const failingPins = createLineSettingsService({
      records: failingRecords,
      sessionRead: fixture.base.sessionsPort.readSession,
      now: () => '2026-10-14T00:00:00.000Z',
      operatorActor: fixture.operator,
    });
    const unavailableBindings = createPlatformCoreRouteBindings({ ...composed, lineSettings: failingPins });
    const third = await fixture.createSession('route-pin-third');
    const unavailableRequest = pinRequest(fixture, { add: [third], remove: [], requestId: 'route-pin-readfail' });
    let failure: unknown;
    try {
      await routePin(unavailableBindings, fixture.operatorCtx, fixture.scope, unavailableRequest);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CoreRouteRejectionError);
    expect((failure as CoreRouteRejectionError).rejection.code).toBe('unavailable');
  });
});

describe.each(['memory', 'sqlite'] as const)('2C-31 D1 through the routes (%s)', (kind) => {
  let fixture: LineFixture;
  let d1: D1;
  let composed: Awaited<ReturnType<typeof createTargetPlatform>>;
  let bindings: CoreRouteBindings;

  beforeAll(async () => {
    fixture = await openLineFixture(kind);
    d1 = await buildD1(fixture);
    composed = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: noWorkspace });
    bindings = createPlatformCoreRouteBindings({
      ...composed,
      workLines: fixture.reader,
      workLineConversation: createWorkLineConversation({
        lines: fixture.reader, readSessionHistory: unsupportedSessionHistory,
      }),
    });
  }, 600_000);

  afterAll(async () => {
    await composed.close();
    await fixture.close();
  });

  it('2C-31 (h) the routes return exactly the LE3 results over the 13-Session D1 dataset', async () => {
    // lines/list
    const directList = await fixture.reader.listWorkLines(fixture.ctx, { workspace: fixture.base.scope });
    expect(await routeList(bindings, fixture.ctx, fixture.base.scope)).toEqual(directList);

    // lines/archived (one page holds both archived heads of D1)
    const directArchived = await fixture.reader.listArchivedLines(fixture.ctx,
      { workspace: fixture.base.scope, page: { limit: 100 } });
    expect(await routeArchived(bindings, fixture.ctx, fixture.base.scope, 100)).toEqual(directArchived);

    // lines/read for every D1 Session (heads, predecessors and copies).
    const sessions: SessionRef[] = [d1.a, d1.b, d1.c, d1.d, d1.e, d1.f1, d1.f2,
      d1.g, d1.gCopy, d1.h, d1.i, d1.j, d1.k];
    for (const key of sessions) {
      const direct = await fixture.reader.readWorkLine(fixture.ctx, { workspace: fixture.base.scope, key });
      expect(await routeRead(bindings, fixture.ctx, fixture.base.scope, key)).toEqual(direct);
    }

    // lines/page: the Host forwards every WorkGraph section to the same port.
    for (const section of ['participation', 'messages', 'copies', 'executions'] as const) {
      const direct = await fixture.reader.readWorkLinePage(fixture.ctx,
        { workspace: fixture.base.scope, key: d1.a, section, page: { limit: 10 } });
      expect(await routePage(bindings, fixture.ctx, fixture.base.scope, d1.a, section, 10)).toEqual(direct);
    }
  }, 600_000);
});
