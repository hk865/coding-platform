/**
 * The Session handoff fence read at every Query start.
 *
 * The fence module is a delegating wrapper (rule sheet A3): it calls the real `readHandoffFence` and records its
 * result, so the rows judge what the start actually read. Every prior state comes from public steps: the plain
 * Queries through `occupy` → `prepare` → `start`, and the held fence, the carrier close and the abandon chain through
 * the published composite (`world.platform.workflow.sessionHandoff`). The failure rows wrap the real backend's
 * `lookup` (A2) so the real reader sees a failed or damaged page. Two holds sit on real steps: AD-01's fence read
 * before its result returns, and the crash row's abandon commit before it reaches the store.
 *
 * The fence, the abandon, the not-entered close, the stale migration and the carrier close all predate these rows:
 * the rows are 后验, and the named production mutation is the only sensitivity evidence they carry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import { createSessionActivityReader } from '../../src/core/work-graph/sessions/session-activity.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { governS6B, seedS6BHandoffLines } from '../helpers/S6B1-fixture.js';
import { openS6B2World } from '../helpers/S6B2-fixture.js';
import { s6b2UnderstandingCarrier } from '../helpers/S6B2-handoff-scene.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { HOST_RECONCILE_ACTOR } from '../../src/app/startup-reconcile.js';

/**
 * The one injected fault: the real `lookup` for the unfinished-operations index
 * answers a rejection (`failed`) or a page with one undecodable record
 * (`damaged`); every other read is the real one. The wrapper is installed on
 * the backend the platform itself uses (A2/A4), and its default is pass-through.
 */
const fault = vi.hoisted(() => ({ mode: 'real' as 'real' | 'failed' | 'damaged' }));
const memoryBackends = vi.hoisted(() => ({ all: [] as unknown[] }));  // A4: the platform's real in-memory backends
/** What the real `readHandoffFence` answered at each start (A3). */
const fenceReads = vi.hoisted(() => ({ results: [] as unknown[] }));
/**
 * AD-01's hold: the real start's fence read waits here, its result already computed, before it returns. The Host's own
 * lifecycle pass (the reconcile actor) reads the same fence for a running handoff, so its reads pass untouched.
 */
const startHold = vi.hoisted(() => {
  const box: { reached: Promise<void>; gate: Promise<void>; reach: () => void; release: () => void;
    armed: boolean; reset: () => void } = {
    reached: Promise.resolve(), gate: Promise.resolve(), reach: () => {}, release: () => {}, armed: false,
    reset() {
      let reach!: () => void; let open!: () => void;
      box.reached = new Promise<void>(resolve => { reach = resolve; });
      box.gate = new Promise<void>(resolve => { open = resolve; });
      box.reach = reach; box.release = open;
    },
  };
  box.reset();
  return box;
});

vi.mock('../../src/core/work-graph/sessions/session-handoff-fence.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/core/work-graph/sessions/session-handoff-fence.js')>();
  return {
    ...actual,
    readHandoffFence: async (
      records: Parameters<typeof actual.readHandoffFence>[0],
      ctx: Parameters<typeof actual.readHandoffFence>[1],
      session: Parameters<typeof actual.readHandoffFence>[2],
    ) => {
      const result = await actual.readHandoffFence(records, ctx, session);
      fenceReads.results.push(structuredClone(result));
      const principal = ctx.principal;
      const holds = startHold.armed && principal.kind === 'host' && principal.actor.id !== HOST_RECONCILE_ACTOR.id;
      if (holds) { startHold.armed = false; startHold.reach(); await startHold.gate; }
      return result;
    },
  };
});

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const module = (await (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal)) as
    typeof import('../../src/core/record-store/in-memory-record-store.js');
  const operationIndex = (await import('../../src/core/work-graph/sessions/session-record-codecs.js'))
    .CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP;
  return {
    ...module,
    createInMemoryRecordBackend: (options: Parameters<typeof module.createInMemoryRecordBackend>[0]) => {
      const backend = module.createInMemoryRecordBackend(options);
      const realLookup = backend.records.lookup;
      const records: typeof backend.records = {
        ...backend.records,
        lookup: async (request) => {
          if (request.index !== operationIndex) return realLookup(request);
          if (fault.mode === 'failed') {
            return { status: 'rejected', code: 'unavailable', reason: 'S6B2 fence: the operation read failed' };
          }
          const page = await realLookup(request);
          if (fault.mode === 'damaged' && page.status === 'ready') {
            return { status: 'ready', value: { records: [{
              refKey: 'damaged-operation', schemaId: 'CoreOperation@1', revision: 1, json: '{"not":"an operation"}',
            }], next: null, readThrough: page.value.readThrough } };
          }
          return page;
        },
      };
      const built = { ...backend, records };
      memoryBackends.all.push(built); return built;
    },
  };
});

// The SQLite backend keeps the commit barrier of the crash row (A4): its own exports, one wrapped `commit`.
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

beforeEach(() => {
  fault.mode = 'real';
  fenceReads.results.length = 0;
  startHold.armed = false;
  startHold.reset();
});

afterEach(async () => {
  fault.mode = 'real';
  startHold.armed = false;
  startHold.release();
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.all(open.map(world => world.close()));
  expect(left).toEqual([]);
});

async function openHostWorld(backend: 'memory' | 'sqlite' = 'memory'): Promise<S6AHostWorld> {
  const world = (await openS6B2World({ backend })).world;
  worlds.push(world);
  return world;
}

/** A claimed plain Query on the Session, prepared through the public Query route. */
async function preparedPlainQuery(world: S6AHostWorld, session: S6ASession, label: string):
Promise<{ prepared: PreparedQueryExecution; queryJobRef: QueryJobRef }> {
  const refs = await world.occupy(session);
  const run = (await readQuery(world.ag2b, refs.queryJobRef)).run.ref;
  const prepared = (await world.post('queries/prepare', plain(S6A_SCOPE, {
    queryRunRef: run, requestId: `s6b2-fence-${label}-prepare`,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (prepared.status !== 'ready') throw new Error(`S6B2 fence: the preparation was refused: ${JSON.stringify(prepared)}`);
  return { prepared: prepared.value, queryJobRef: refs.queryJobRef };
}

const startPlain = async (world: S6AHostWorld, prepared: PreparedQueryExecution, requestId: string) =>
  (await world.post('queries/start', plain(S6A_SCOPE, {
    prepared, consumerId: AG2B_CONSUMER_ID, requestId,
  }))).body as Record<string, unknown>;

/** The owner's own SessionActivity read over the backend the platform built (the existing read). */
async function activityOf(world: S6AHostWorld, session: S6ASession['ref']) {
  const records = (memoryBackends.all.at(-1) as { records: Parameters<typeof createSessionActivityReader>[0]['records'] }).records;
  const read = await createSessionActivityReader({ records }).readSessionActivity(world.humanContext(), { session });
  if (read.status !== 'ready') throw new Error(`S6B2 fence: the activity read failed: ${JSON.stringify(read)}`);
  return read.value;
}

/** The published handoff composite: the one owner a row drives, never a second assembly. */
function handoffComposite(world: S6AHostWorld) {
  const owner = world.platform.workflow.sessionHandoff;
  if (owner === undefined) throw new Error('S6B2: the Workflow publishes no handoff composite');
  return owner;
}

/**
 * A handoff accepted on the source that takes its fence and stops at `wait_writer`: the source's writer (the
 * caller's live Query) has not stopped. The composite answers the fence it really wrote; a drive that did not
 * take it throws, never a built claim.
 */
async function heldFence(world: S6AHostWorld, source: S6ASession): Promise<OperationRef> {
  const accepted = await world.platform.sessionHandoff.acceptHandoff(world.systemContext(), {
    commandId: `s6b2-fence-${source.label}`, workspace: { ...S6A_SCOPE }, source: source.ref, trigger: 'too_long',
    assignments: [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] }] });
  if (accepted.status !== 'committed') throw new Error(`S6B2 fence: the accept was refused: ${JSON.stringify(accepted)}`);
  const advanced = await handoffComposite(world).advance(world.systemContext(), { operation: accepted.value.operation });
  if (advanced.status !== 'ready' || advanced.value.stage !== 'wait_writer') {
    throw new Error(`S6B2 fence: the handoff did not take the fence: ${JSON.stringify(advanced)}`);
  }
  const record = await world.platform.sessions.getSessionOperation(world.systemContext(), accepted.value.operation);
  if (record.status !== 'ready' || record.value.action.kind !== 'handoff'
    || record.value.action.progress.fence?.state !== 'held') {
    throw new Error(`S6B2 fence: the handoff records no held fence: ${JSON.stringify(record)}`);
  }
  return accepted.value.operation;
}

/** The public read of one QueryRun by its ref: what the Run recorded, after the Job moved to a new attempt. */
async function readRun(world: S6AHostWorld, run: Parameters<S6AHostWorld['platform']['reconcile']['readQueryExecution']>[1]) {
  const read = await world.platform.reconcile.readQueryExecution(world.systemContext(), run);
  if (read.status !== 'ready') throw new Error(`S6B2 fence: the QueryRun is not readable: ${JSON.stringify(read)}`);
  return read.value.run;
}

/** The frozen manifest `materials/open` returns for a prepared round: the same value the start reads. */
async function frozenManifestOf(world: S6AHostWorld, prepared: PreparedQueryExecution): Promise<PreparedQueryManifestV1> {
  const opened = (await world.post('materials/open', plain(S6A_SCOPE, {
    ref: prepared.bundleRef, usage: 'historical_explanation',
  }))).body as ReadResult<{ body: string }>;
  if (opened.status !== 'ready') throw new Error(`S6B2 fence: the frozen manifest is not readable: ${JSON.stringify(opened)}`);
  return JSON.parse(opened.value.body) as PreparedQueryManifestV1;
}

/** `queries/claim` (while the attempt has no execution state) then `queries/prepare` of the round's current Run. */
async function prepareRound(world: S6AHostWorld, round: QueryJobRef, session: S6ASession, id: string) {
  if ((await readQuery(world.ag2b, round)).run.run.executionState === undefined) {
    const claimed = await claimWithSecretaryProfile(world, round, session, `${id}-claim`);
    if (claimed['status'] !== 'committed') throw new Error(`S6B2 fence: ${id} was not claimed: ${JSON.stringify(claimed)}`);
  }
  const run = (await readQuery(world.ag2b, round)).run.ref;
  const prepared = (await world.post('queries/prepare', plain(S6A_SCOPE, {
    queryRunRef: run, requestId: `${id}-prepare`,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (prepared.status !== 'ready') throw new Error(`S6B2 fence: ${id} was not prepared: ${JSON.stringify(prepared)}`);
  return { run, prepared: prepared.value, manifest: await frozenManifestOf(world, prepared.value) };
}

describe('a Query start reads the fence (memory)', () => {
  it('a plain Query on a world with no operation reads {held:false} and enters', async () => {
    const world = await openHostWorld();
    const session = await world.createSecretary('fence-none');
    const refs = await world.occupy(session);

    // A3: the real start's entering commit carries the empty-slot fence claim.
    const entering = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entering:'), 'the plain entering commit');
    const finished = world.finishQuery(refs);
    const commit = await entering.reached;
    entering.release();
    await finished;

    expect(commit.claims.some(claim => claim.claimKey.startsWith('secretary-handoff:')
      && claim.expectedOwner === null && claim.nextOwner === null)).toBe(true);
    expect(fenceReads.results).toEqual([{ status: 'ready', value: { held: false, operation: null } }]);
    const after = await readQuery(world.ag2b, refs.queryJobRef);
    expect(after.run.run.executionState?.phase).toBe('settled');
    expect(after.job.job.status).toBe('answered');
    expect((await world.readSession(session)).record.occupancy).toBeNull();
  });

  it.each(['failed', 'damaged'] as const)(
    'a %s fence read answers unavailable, leaves the attempt prepared and writes nothing',
    async mode => {
      const world = await openHostWorld();
      const session = await world.createSecretary(`fence-${mode}`);
      const { prepared, queryJobRef } = await preparedPlainQuery(world, session, mode);
      const before = await readQuery(world.ag2b, queryJobRef);
      const beforeSession = await world.readSession(session);

      fault.mode = mode;
      const answer = await startPlain(world, prepared, `s6b2-fence-${mode}-start`);
      fault.mode = 'real';

      expect(answer).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(fenceReads.results.at(-1)).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const after = await readQuery(world.ag2b, queryJobRef);
      expect(after.job.revision).toBe(before.job.revision);
      expect(after.run.revision).toBe(before.run.revision);
      expect(after.job.job.runRef).toEqual(before.job.job.runRef);
      expect(after.run.run.executionState?.phase).toBe('prepared');
      const afterSession = await world.readSession(session);
      expect(afterSession.record.revision).toBe(beforeSession.record.revision);
      expect(afterSession.record.occupancy).not.toBeNull();
    },
  );
});

describe('the held fence', () => {
  it('abandons the request attempt for a pending one and releases the occupancy', async () => {
    const world = await openHostWorld();
    const session = await world.createSecretary('fence-abandon');
    // A live writer holds the slot while the handoff takes the fence; it stops before the request arrives.
    const busy = await preparedPlainQuery(world, session, 'abandon-busy');
    await world.scripted.script(session, [{ kind: 'text', text: 'S6B2 fence busy answer' }]);
    const gate = await world.gates.modelRequest(session);
    const running = startPlain(world, busy.prepared, 's6b2-fence-abandon-busy-start');
    await gate.reached;
    const operation = await heldFence(world, session);
    gate.release();
    expect(await running).toMatchObject({ status: 'ready' });
    expect((await world.readSession(session)).record.occupancy).toBeNull();
    const before = await world.platform.sessions.getSessionOperation(world.systemContext(), operation);

    const request = await world.submit({ commandId: 's6b2-fence-abandon-submit', goalId: null,
      text: 'S6B2 fence abandon request', recipient: session.ref });
    if (request.status !== 'queued') throw new Error(`S6B2 fence: the request was refused: ${JSON.stringify(request)}`);
    expect(await claimWithSecretaryProfile(world, request.round, session, 's6b2-fence-abandon-claim'))
      .toMatchObject({ status: 'committed' });
    const attempt = await prepareRound(world, request.round, session, 's6b2-fence-abandon');
    expect(await startPlain(world, attempt.prepared, 's6b2-fence-abandon-start'))
      .toMatchObject({ status: 'rejected', code: 'busy' });

    // The old attempt ended `not_entered`, the Job waits on a new pending Run, the slot is free.
    expect((await readRun(world, attempt.run)).run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    const after = await readQuery(world.ag2b, request.round);
    expect(after.job.job.status).toBe('pending');
    expect(after.run.ref.runId).not.toBe(attempt.run.runId);
    expect((await world.readSession(session)).record.occupancy).toBeNull();
    // The abandon makes no routing and no activity: the handoff operation is where taking the fence left it.
    expect(await world.platform.sessions.getSessionOperation(world.systemContext(), operation)).toEqual(before);
  });

  it('settles a plain Query not_entered, releases the occupancy and writes no routing', async () => {
    const world = await openHostWorld();
    const session = await world.createSecretary('fence-plain');
    const { prepared, queryJobRef } = await preparedPlainQuery(world, session, 'plain');
    const operation = await heldFence(world, session);
    const before = await world.platform.sessions.getSessionOperation(world.systemContext(), operation);
    const beforeActivity = await activityOf(world, session.ref);
    expect(beforeActivity).toMatchObject({ revision: 0, record: null });

    expect(await startPlain(world, prepared, 's6b2-fence-plain-start'))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    const after = await readQuery(world.ag2b, queryJobRef);
    expect(after.run.run.executionState?.phase).toBe('settled');
    expect(after.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    expect(after.job.job.status).toBe('closed');
    expect((await world.readSession(session)).record.occupancy).toBeNull();
    expect(await activityOf(world, session.ref)).toEqual(beforeActivity);
    expect(await world.platform.sessions.getSessionOperation(world.systemContext(), operation)).toEqual(before);
  });

  it('closes the attempt on either side of the abandon commit and replays its own identity', async () => {
    const world = await openHostWorld('sqlite');
    const session = await world.createSecretary('fence-crash');
    const busy = await preparedPlainQuery(world, session, 'crash-busy');
    await world.scripted.script(session, [{ kind: 'text', text: 'S6B2 fence busy answer' }]);
    const gate = await world.gates.modelRequest(session);
    const running = startPlain(world, busy.prepared, 's6b2-fence-crash-busy-start');
    await gate.reached;
    await heldFence(world, session);
    gate.release();
    await running;
    const request = await world.submit({ commandId: 's6b2-fence-crash-submit', goalId: null,
      text: 'S6B2 fence crash request', recipient: session.ref });
    if (request.status !== 'queued') throw new Error(`S6B2 fence: the request was refused: ${JSON.stringify(request)}`);
    expect(await claimWithSecretaryProfile(world, request.round, session, 's6b2-fence-crash-claim'))
      .toMatchObject({ status: 'committed' });
    const attempt = await prepareRound(world, request.round, session, 's6b2-fence-crash');

    // Crash BEFORE the abandon commit: the commit never landed, and the new Host's own start-up finds the attempt
    // still occupying the Session and closes it (`new_attempt`, QRR-02). Nothing half-written is left behind.
    const before = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entering:'), 'the abandon commit');
    const abandoned = startPlain(world, attempt.prepared, 's6b2-fence-crash-start');
    abandoned.catch(() => undefined);
    await before.reached;
    await world.crash();
    const reread = await readQuery(world.ag2b, request.round);
    expect(reread.run.ref.runId).not.toBe(attempt.run.runId);
    expect(reread.run.run).toMatchObject({ status: 'pending', outcome: null });
    expect((await readRun(world, attempt.run)).run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    expect((await world.readSession(session)).record.occupancy).toBeNull();
    before.release();
    // The held commit is refused by the guards it froze: the Job, its Run and the Session all moved.
    await abandoned.catch(() => undefined);
    expect((await readQuery(world.ag2b, request.round)).run.ref.runId).toBe(reread.run.ref.runId);

    // Crash AFTER the abandon commit: the same start identity restores the committed answer and adds nothing.
    const second = await prepareRound(world, request.round, session, 's6b2-fence-crash-second');
    const migrating = startPlain(world, second.prepared, 's6b2-fence-crash-second-start');
    expect(await migrating).toMatchObject({ status: 'rejected', code: 'busy' });
    const committed = await readQuery(world.ag2b, request.round);
    // After a crash on the committed abandon, the retry answers the record the abandon committed (the old Run's
    // own settled `not_entered` state) and adds nothing: the same identity is never a second attempt.
    await world.crash();
    expect(await startPlain(world, second.prepared, 's6b2-fence-crash-second-start')).toMatchObject({
      status: 'ready', value: { run: { run: { status: 'closed', outcome: 'not_entered' } } } });
    const replayed = await readQuery(world.ag2b, request.round);
    expect(replayed.job.revision).toBe(committed.job.revision);
    expect(replayed.run.ref.runId).toBe(committed.run.ref.runId);
  });
});

/** Close the carrier through the published composite; each row keeps its own link/start gate after this. */
async function closeCarrier(world: S6AHostWorld, carrier: Awaited<ReturnType<typeof s6b2UnderstandingCarrier>>) {
  expect((await handoffComposite(world).advance(world.systemContext(),
    { operation: carrier.operation })).status).toBe('ready');
  expect((await readQuery(world.ag2b, carrier.carrier)).job.job.understanding?.state).toBe('closed');
  // The Host's detached work settles before the row reads the Session, so no later write moves it under the gate.
  await world.settleDetached();
}

describe('the stale attempt', () => {
  it('a Session moved while the start reads the fence refuses the migration and keeps the old manifest', async () => {
    const world = await openHostWorld('sqlite');
    const secretary = await world.createSecretary('fence-stale');
    const carrier = await s6b2UnderstandingCarrier(world, secretary, 'stale');
    await closeCarrier(world, carrier);
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, ws, world.goals);
    const task = (await seedS6BHandoffLines(ws, world.goals.first)).tasks[0]!;
    const before = await readQuery(world.ag2b, carrier.carrier);

    // AD-01's A3 gate: the real fence read has answered; the start's pins are checked, its facts are not read yet.
    startHold.armed = true;
    const started = startPlain(world, carrier.prepared, 's6b2-fence-stale-start');
    started.catch(() => undefined);
    await startHold.reached;
    // The Session's revision the start pinned: its core read is past, its request facts are not read yet.
    const card = await world.readSession(secretary);
    const target = { kind: 'task', ref: task } as const;
    const linkRef = { aggregateType: 'SessionWorkLink', projectId: S6A_SCOPE.projectId,
      sessionId: secretary.ref.sessionId, target, relation: 'responsible' } as const;
    expect((await world.post('sessions/link', graphWrite(S6A_SCOPE, { sessionRef: secretary.ref, target,
      relation: 'responsible', active: true }, 's6b2-fence-stale-link', [
      { ref: { aggregateType: 'Session', projectId: S6A_SCOPE.projectId, sessionId: secretary.ref.sessionId },
        revision: card.record.revision }, { ref: linkRef, revision: 0 }]))).body).toMatchObject({ status: 'committed' });
    startHold.release();

    // The stale migration's own pins conflict: nothing is written and the frozen manifest stays the prepared one.
    expect(await started).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const after = await readQuery(world.ag2b, carrier.carrier);
    expect(after.job.revision).toBe(before.job.revision);
    expect(after.run.ref.runId).toBe(carrier.run.runId);
    expect(after.run.run.executionState?.prepared).toEqual(before.run.run.executionState?.prepared);
    expect(after.run.run.executionState?.phase).toBe('prepared');
    expect(after.job.job.understanding?.state).toBe('closed');
  });

  it('a closed carrier command migrates the attempt and the new attempt enters without the grant', async () => {
    const world = await openHostWorld('sqlite');
    const secretary = await world.createSecretary('fence-grants');
    const carrier = await s6b2UnderstandingCarrier(world, secretary, 'grants');
    await closeCarrier(world, carrier);

    // The frozen live grant set differs from the current one (the carrier command is closed): the attempt is stale.
    expect(await startPlain(world, carrier.prepared, 's6b2-fence-grants-start'))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    expect((await readRun(world, carrier.run)).run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    const after = await readQuery(world.ag2b, carrier.carrier);
    expect(after.run.ref.runId).not.toBe(carrier.run.runId);
    expect(after.run.run).toMatchObject({ status: 'pending', outcome: null });
    expect((await world.readSession(secretary)).record.occupancy).toBeNull();
    // The recovery: the closed carrier grants nothing, so the new attempt prepares without a grant and answers.
    const recovered = await prepareRound(world, carrier.carrier, secretary, 's6b2-fence-grants-recovered');
    expect(recovered.manifest.request?.understandingGrants).toEqual([]);
    const kind = recovered.manifest.request?.executionKind;
    await world.scripted.script(secretary, [{ kind: 'text', text: kind === 'initial_coordination'
      ? JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'S6B2 fence summary', questions: ['S6B2 fence question'] })
      : JSON.stringify({ schemaVersion: 1, body: 'S6B2 fence recovered answer', ideas: [], goalCardDrafts: [] }) }]);
    expect(await startPlain(world, recovered.prepared, 's6b2-fence-grants-recovered-start'))
      .toMatchObject({ status: 'ready' });
    expect((await readQuery(world.ag2b, carrier.carrier)).run.run.status).toBe('answered');
  });
});
