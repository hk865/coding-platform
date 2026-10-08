/**
 * Slice 1 (Session facts, corrections and archive) route rows IT17 and IT18
 * (spec §4.4, §5.4). Both rows reach the code under test through the real
 * route table of `src/app/core-routes.ts`; IT18 with the real Host over HTTP.
 *
 * IT17 (green in part 1): the eleven new suffixes are exactly classified, a
 * wrong-shaped body is `invalid`, and the concrete bindings
 * `createPlatformCoreRouteBindings` really builds reach the one named public
 * owner method each row assigns. No Proxy stands in for the built bindings.
 *
 * IT18 (expected RED in part 1): an archive composite that already committed
 * its stop and disposal steps survives a faulted final commit as
 * `ready`/`state: 'partial'` over HTTP, with its embedded rejection and its
 * real step receipts (each receipt cursor names its own ledger commit), never
 * as `archived` and never as a generic transport error. The Workflow owner is
 * still a `not implemented:` stub, so the Host answers the route with a 500.
 */
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import * as hostFactory from '../../src/app/host.js';
import * as platformFactory from '../../src/composition/create-platform.js';
import { join } from 'node:path';
import {
  CORE_ROUTE_SPECS, createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest,
  type CoreRouteBindings,
} from '../../src/app/core-routes.js';
import type { CoreRouteKind, CoreRouteSuffix } from '../../src/app/core-http-types.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionAggregateRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { ArchiveStepRefV1 } from '../../src/contracts/core/session-archive.js';
import type { ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import { AG2B_SCOPE, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  assertInvariants, cleanupScenarios, openHostScenario, openPlatformScenario, performs, readSqlite,
} from '../scenarios/harness.js';
import { NO_REDRIVE, readCall, selectedRun, textReply, WORK_TARGET } from '../scenarios/support/common.js';
import { failCommitOf, rawPost } from '../scenarios/support/receipts.js';

const T0 = '2026-10-08T00:00:00.000Z';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  // The shared harness supplies older clocks. Delegate to the actual factories,
  // changing only their trusted `now` callback; all Host/owner code still runs.
  const createHost = hostFactory.createLocalWorkbenchHost;
  const createPlatform = platformFactory.createTargetPlatform;
  vi.spyOn(hostFactory, 'createLocalWorkbenchHost').mockImplementation(options => createHost({ ...options, now: () => T0 }));
  vi.spyOn(platformFactory, 'createTargetPlatform').mockImplementation(options => createPlatform({ ...options, now: () => T0 }));
});
const pendingStarts: Array<Promise<{ ok: true } | { ok: false; error: unknown }>> = [];
afterEach(async () => {
  await cleanupScenarios();
  try {
    for (const pending of pendingStarts.splice(0)) {
      const result = await pending;
      if (!result.ok) throw result.error;
    }
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

const SCOPE = { projectId: 's1-routes', workspaceId: 'w' };

/** The eleven suffixes the slice adds (`CoreRouteSuffix` is declared in core-http-types.ts). */
const NEW_ROUTES = [
  'sessions/archive-line',
  'sessions/archive-continue',
  'sessions/archive-release',
  'sessions/facts',
  'sessions/successors',
  'sessions/executions',
  'sessions/queries',
  'sessions/transfer-responsibility',
  'tasks/archive-state',
  'anomalies/list',
  'messages/undelivered-replies',
] as const satisfies readonly CoreRouteSuffix[];

/** Spec §4.4: kind, binding and documented owner of each new suffix. */
const EXPECTED: Record<(typeof NEW_ROUTES)[number], { kind: CoreRouteKind; binding: keyof CoreRouteBindings; owner: string }> = {
  'sessions/archive-line': { kind: 'graph_write', binding: 'archiveLine', owner: 'workflow.archiveLine' },
  'sessions/archive-continue': { kind: 'plain', binding: 'continueArchiveLine', owner: 'workflow.continueArchiveLine' },
  'sessions/archive-release': { kind: 'graph_write', binding: 'releaseSessionArchiveRequest', owner: 'sessions.releaseSessionArchiveRequest' },
  'sessions/facts': { kind: 'plain', binding: 'readSessionFacts', owner: 'sessionFacts.readSessionFacts' },
  'sessions/successors': { kind: 'plain', binding: 'findSessionSuccessors', owner: 'sessionFacts.findSessionSuccessors' },
  'sessions/executions': { kind: 'plain', binding: 'listSessionExecutions', owner: 'sessionFacts.listSessionExecutions' },
  'sessions/queries': { kind: 'plain', binding: 'listSessionQueries', owner: 'sessionFacts.listSessionQueries' },
  'sessions/transfer-responsibility': { kind: 'graph_write', binding: 'transferSessionResponsibility',
    owner: 'responsibilities.transferSessionResponsibility' },
  'tasks/archive-state': { kind: 'plain', binding: 'readTaskArchiveState', owner: 'sessionAnomalies.readTaskArchiveState' },
  'anomalies/list': { kind: 'plain', binding: 'listSessionAnomalies', owner: 'sessionAnomalies.listSessionAnomalies' },
  'messages/undelivered-replies': { kind: 'plain', binding: 'readUndeliveredReplies', owner: 'messages.readUndeliveredReplies' },
};

function context(scope: { projectId: string; workspaceId: string }): CoreCallContext {
  const actor = { kind: 'human' as const, id: 's1-routes-operator' };
  return {
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor },
    signal: new AbortController().signal,
  };
}

function bodyFor(suffix: CoreRouteSuffix): unknown {
  return CORE_ROUTE_SPECS[suffix].kind === 'graph_write'
    ? { scope: SCOPE, request: { input: {}, meta: { requestId: `it17-${suffix}`, expected: [] } } }
    : { scope: SCOPE, input: {} };
}

it('IT17 (route table): each of the eleven new suffixes maps to its exact kind, binding and owner; a wrong-shaped graph/plain body is invalid; the real bindings reach the named owner method', async () => {
  const scenario = await openPlatformScenario({ workIds: null });
  const before = scenario.counts();
  for (const suffix of NEW_ROUTES) {
    expect(CORE_ROUTE_SPECS[suffix], suffix).toEqual(EXPECTED[suffix]);
    const wrongBody = EXPECTED[suffix].kind === 'graph_write'
      ? { scope: SCOPE, input: {} }
      : { scope: SCOPE, request: { input: {}, meta: { requestId: 'wrong-shape', expected: [] } } };
    const rejected = parseCoreRouteRequest(suffix, wrongBody);
    if (rejected.ok) throw new Error(`${suffix} accepted the wrong envelope`);
    expect({ status: rejected.rejection.status, code: rejected.rejection.code }).toEqual({ status: 'rejected', code: 'invalid' });
    expect(rejected.rejection.reason.startsWith('the request body may not carry')).toBe(true);
    const internalPayload = { ...bodyFor(suffix) as object, recordSessionAnomaly: {} };
    const internal = parseCoreRouteRequest(suffix, internalPayload);
    if (internal.ok) throw new Error(`${suffix} exposed an internal write payload`);
    expect(internal.rejection).toEqual({ status: 'rejected', code: 'invalid',
      reason: 'the request body may not carry "recordSessionAnomaly"' });
  }
  expect(scenario.counts()).toEqual(before);
  // A graph_write suffix refuses the plain `{input}` body and vice versa, a bad
  // scope is invalid, and no internal write payload key is accepted.
  expect(parseCoreRouteRequest('sessions/archive-line', { scope: SCOPE, input: {} }))
    .toMatchObject({ ok: false, rejection: { status: 'rejected', code: 'invalid' } });
  expect(parseCoreRouteRequest('sessions/facts', { scope: SCOPE, request: { input: {}, meta: { requestId: 'x', expected: [] } } }))
    .toMatchObject({ ok: false, rejection: { status: 'rejected', code: 'invalid' } });
  expect(parseCoreRouteRequest('sessions/archive-line', { scope: { projectId: 'p' }, request: { input: {}, meta: { requestId: 'x', expected: [] } } }))
    .toMatchObject({ ok: false, rejection: { status: 'rejected', code: 'invalid' } });
  expect(parseCoreRouteRequest('sessions/facts', { scope: SCOPE, input: {}, extra: true }))
    .toMatchObject({ ok: false, rejection: { status: 'rejected', code: 'invalid' } });

  // The bindings under test are the real object `createPlatformCoreRouteBindings`
  // builds from a real platform; the one named owner method of each route is
  // replaced by a recorder before the bindings capture it. A missing or miswired
  // binding then has no recorder to satisfy the assertion (a Proxy would hide it).
  const platform = scenario.platform;
  type SpyTarget = Record<string, (...args: unknown[]) => unknown>;
  const spies: Array<{ suffix: (typeof NEW_ROUTES)[number]; spy: MockInstance }> = [];
  for (const suffix of NEW_ROUTES) {
    const [group, method] = EXPECTED[suffix].owner.split('.') as [string, string];
    const owner = (platform as unknown as Record<string, SpyTarget>)[group];
    if (owner === undefined) throw new Error(`the platform publishes no ${group} group`);
    const spy = vi.spyOn(owner, method).mockImplementation(async () => ({ status: 'ready', value: EXPECTED[suffix].owner }));
    spies.push({ suffix, spy });
  }
  const bindings = createPlatformCoreRouteBindings(platform);
  for (const suffix of NEW_ROUTES) {
    const binding = EXPECTED[suffix].binding;
    expect(typeof bindings[binding], `${suffix} -> ${binding}`).toBe('function');
    const parsed = parseCoreRouteRequest(suffix, bodyFor(suffix));
    expect(parsed.ok, suffix).toBe(true);
    await dispatchCoreRoute(bindings, suffix, context(SCOPE), parsed);
  }
  for (const { suffix, spy } of spies) {
    expect(spy, `${suffix} must reach ${EXPECTED[suffix].owner}`).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toEqual(EXPECTED[suffix].kind === 'graph_write'
      ? { input: {}, meta: { requestId: `it17-${suffix}`, expected: [] } } : {});
  }
  expect(scenario.counts()).toEqual(before);
  await assertInvariants(scenario, 'IT17 parsing and route delegation');
});

/** The ledger's committed events as `(cursor, event type)`, read with its own connection. */
function ledgerEvents(database: string): Array<{ cursor: CommitCursor; type: string }> {
  return readSqlite(join(database, 'ledger.sqlite'), (ledger) =>
    (ledger.prepare('SELECT id, event_json FROM events ORDER BY id').all() as Array<{ id: number; event_json: string }>)
      .map(row => ({ cursor: makeCommitCursor(Number(row.id)),
        type: (JSON.parse(row.event_json) as { eventType: string }).eventType })),
  []);
}

it('IT18 (partial over HTTP): an archive whose stop and disposal already committed survives a faulted final commit as ready/state=partial with its embedded rejection and the real receipts of those commits', async () => {
  const host = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    script: { replies: [readCall('it18'), textReply('IT18: the interrupted work answers')] } });
  // Hold the Run's second model call: the Run is running while the operator
  // archives the line, so the first call commits the request and stop and stays
  // pending; the crash's reconcile then stops the abandoned Run.
  const held = host.holdReply(1);
  const toStart = await host.advance(host.select('it18'), { stopBefore: performs('start') });
  if (toStart.next === null) throw new Error('the Workflow must reach the start');
  const starting = host.answer('workflow/advance', plain(AG2B_SCOPE, toStart.next))
    .then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
  pendingStarts.push(starting);
  await held.reached;
  await assertInvariants(host, 'IT18 Work entered before archive');

  const runRef = await selectedRun(host);
  const execution = await host.post<ReadResult<{ session: { ref: SessionRef } }>>('executions/read', plain(AG2B_SCOPE, runRef));
  if (execution.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(execution)}`);
  const sessionRef = execution.value.session.ref;
  const card = await host.post<ReadResult<{ record: { ref: SessionAggregateRef; revision: number } }>>('sessions/read',
    plain(AG2B_SCOPE, sessionRef));
  if (card.status !== 'ready') throw new Error(`the Session must be readable: ${JSON.stringify(card)}`);

  const requestId = 'it18-archive-line';
  const body = graphWrite(AG2B_SCOPE, {
    sessionRef,
    reason: 'IT18: the operator archives the interrupted line',
    tasks: [{ target: WORK_TARGET, disposition: { kind: 'drop' } }],
    wait: null,
  }, requestId, [{ ref: card.value.record.ref, revision: card.value.record.revision }]);

  // The committed disposal: the request and the stop survive the pending answer.
  const pending = await host.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', body);
  expect(pending.status, JSON.stringify(pending)).toBe('ready');
  if (pending.status !== 'ready') throw new Error(`the archive request must be ready: ${JSON.stringify(pending)}`);
  expect({ state: pending.value.state, message: pending.value.message, pendingOn: pending.value.pendingOn })
    .toEqual({ state: 'pending', message: '归档中 · 停止中', pendingOn: runRef });
  await assertInvariants(host, 'IT18 pending archive and submitted cancel');
  const stopReceipt = pending.value.receipts.find(receipt => receipt.step === 'stop');
  if (stopReceipt === undefined) throw new Error(`the stop must be a committed receipt: ${JSON.stringify(pending.value.receipts)}`);

  // A real crash of the Host; the next Host stops the abandoned Run and the same
  // durable request continues. The final archive commit is faulted once.
  // Arm BEFORE restart: startup performs reconciliation, then maintenance.
  // Keep it armed until the explicit continuation, including every startup retry.
  const finalFault = failCommitOf(host.database, 'SessionArchived');
  let partial: ReadResult<ArchiveLineResultV1>;
  try {
    await host.restart({ crash: true });
    const beforeContinue = host.counts();
    const http = await rawPost(host, 'sessions/archive-continue',
      plain(AG2B_SCOPE, { sessionRef, archiveRequestId: requestId }));
    expect(http.status).toBe(200);
    partial = http.body as ReadResult<ArchiveLineResultV1>;
    const afterContinue = host.counts();
    expect({ model: afterContinue.modelCalls, kernel: afterContinue.kernelRecords, checks: afterContinue.checksBegun })
      .toEqual({ model: beforeContinue.modelCalls, kernel: beforeContinue.kernelRecords, checks: beforeContinue.checksBegun });
    await assertInvariants(host, 'IT18 partial archive over HTTP');
  } finally {
    finalFault.drop();
  }

  // The transport answers a successful HTTP body, not a generic failure.
  expect(partial.status, JSON.stringify(partial)).toBe('ready');
  if (partial.status !== 'ready') throw new Error(`the partial archive must be readable over HTTP: ${JSON.stringify(partial)}`);
  expect(partial.value).toMatchObject({
    state: 'partial',
    message: '处置已完成，归档没成功',
    // The SQLite transaction-abort seam raises a storage failure, not a CAS loss.
    rejection: { status: 'rejected', code: 'unavailable' },
  });
  expect(partial.value.session.lifecycle).toBe('active');

  // Every receipt is the real commit it names: the stop committed by the earlier
  // call is replayed with its original cursor and subject, and each disposal
  // receipt's cursor points at that step's own ledger event.
  const ledger = ledgerEvents(host.database);
  const stopAgain = partial.value.receipts.find(receipt => receipt.step === 'stop');
  expect(stopAgain, 'the already-committed stop must be a receipt of the partial')
    .toEqual({ ...stopReceipt, replayed: true });
  const eventOfStep: Partial<Record<ArchiveStepRefV1['step'], string>> = {
    stop: 'ControlIntentSubmitted',
    anchor: 'SessionAnomalyRecorded',
    responsibility: 'SessionResponsibilityChanged',
    requeue: 'TaskRequeued',
  };
  for (const receipt of partial.value.receipts) {
    const eventType = eventOfStep[receipt.step];
    if (eventType === undefined) continue;
    expect(ledger.find(event => event.cursor === receipt.cursor),
      `the ${receipt.step} receipt must name its real ledger commit`).toMatchObject({ type: eventType });
  }
  expect(partial.value.receipts.map(receipt => receipt.step))
    .toEqual(expect.arrayContaining(['stop', 'anchor', 'responsibility']));
  const stopped = await host.post<ReadResult<{ run: { status: string; outcome: string }; session: { occupancy: unknown } }>>(
    'executions/read', plain(AG2B_SCOPE, runRef));
  if (stopped.status !== 'ready') throw new Error(JSON.stringify(stopped));
  expect({ status: stopped.value.run.status, outcome: stopped.value.run.outcome, occupancy: stopped.value.session.occupancy })
    .toEqual({ status: 'ended', outcome: 'cancelled', occupancy: null });
  await host.drainAbandoned();
  const finished = await starting;
  if (!finished.ok) throw finished.error;
}, 120_000);
