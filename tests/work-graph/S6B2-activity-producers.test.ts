/**
 * The per-Session activity record's producers on the request side: a submit,
 * a follow-up, a manual route and the drain's assigned route each write one
 * `input` record inside their own commit, and the Session clock advances once
 * per fact. The record is read back through the owner's real read port, over
 * the backend the platform itself committed to; nothing here reads or writes
 * the store.
 *
 * The real `SessionActivity` read is not injected in this wave, so the two
 * backend factories are wrapped only to keep the real backend the platform
 * built (A3/A4: the wrapper returns the real module and its real result), and
 * the owner read runs over `backend.records`. One row also wraps the real
 * commit to fail once, or always, on the activity key (A2 fault injection) to
 * show the request owner re-reads and retries its own guard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { SessionActivityStateV1 } from '../../src/core/work-graph/model/session-activity-contracts.js';
import type { HandoffBriefPort } from '../../src/core/work-graph/model/session-handoff-contracts.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import { createSessionActivityReader } from '../../src/core/work-graph/sessions/session-activity.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { driveS6BHandoff, holdS6BUnderstandingRound, openS6B2World } from '../helpers/S6B2-fixture.js';
import { s6b2Accept } from '../helpers/S6B2-handoff-scene.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
// The frozen commit barrier the fixture's gates use; the same pass-through
// keeps each real backend so the owner read can use the platform's own store.
const backendBox = vi.hoisted(() => ({ backends: [] as unknown[] }));
// The counting brief port: it answers only if the null briefRef wrongly reaches it; `omit` removes the dependency.
const briefBox = vi.hoisted(() => ({ current: undefined as unknown as HandoffBriefPort | undefined, omit: false }));
// The real QueryExecution owner's record port, for the missing-carrier fault.
const recordsBox = vi.hoisted(() => ({ current: undefined as unknown as GoalRecordTransactionPort | undefined }));
vi.mock('../../src/core/work-graph/queries/query-execution.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/work-graph/queries/query-execution.js')>();
  return { ...real, createQueryExecution: (deps: Parameters<typeof real.createQueryExecution>[0]) => {
    recordsBox.current = deps.records;
    if (briefBox.omit) {
      const without = { ...deps } as { brief?: unknown };
      delete without.brief;
      return real.createQueryExecution(without as Parameters<typeof real.createQueryExecution>[0]);
    }
    return real.createQueryExecution({ ...deps, ...(briefBox.current === undefined ? {} : { brief: briefBox.current }) });
  } };
});

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const module = await (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal);
  return { ...module, createInMemoryRecordBackend: (options: Parameters<typeof module.createInMemoryRecordBackend>[0]) => {
    const backend = module.createInMemoryRecordBackend(options);
    backendBox.backends.push(backend);
    return backend;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const module = await (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal);
  return { ...module, createSqliteRecordBackend: (options: Parameters<typeof module.createSqliteRecordBackend>[0]) => {
    const backend = module.createSqliteRecordBackend(options);
    backendBox.backends.push(backend);
    return backend;
  } };
});

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  briefBox.current = undefined;
  briefBox.omit = false;
  recordsBox.current = undefined;
  vi.restoreAllMocks();
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.all(open.map(world => world.close()));
  expect(left).toEqual([]);
});

type CapturedBackend = {
  records: GoalRecordTransactionPort;
  close(): Promise<void>;
};

/** The real backend the current Host built (A3/A4: captured, never replaced). */
function latestBackend(): CapturedBackend {
  const backend = backendBox.backends.at(-1) as CapturedBackend | undefined;
  if (backend === undefined) throw new Error('S6B2: no captured record backend');
  return backend;
}

async function openWorld(backend: 'memory' | 'sqlite',
  extraHostOptions: Record<string, unknown> = {},
  options: Partial<Parameters<typeof openS6B2World>[0]> = {}): Promise<S6AHostWorld> {
  const opened = await openS6B2World({ backend, extraHostOptions, ...options });
  worlds.push(opened.world);
  return opened.world;
}

/** The one shared setup: a world, its secretary created at `at`, and the clock at the fact time. */
async function requestScene(backend: 'memory' | 'sqlite' = 'memory', label = 'a',
  at = '2026-10-25T10:00:00.000Z', clock: string | null = '2026-10-25T10:05:00.000Z') {
  const world = await openWorld(backend);
  const a = await world.createSecretary(label, { at });
  if (clock !== null) world.clock.set(clock);
  return { world, a };
}

/** The owner read of one Session's activity, over the platform's own store. */
async function activityOf(world: S6AHostWorld, session: SessionRef): Promise<SessionActivityStateV1> {
  const reader = createSessionActivityReader({ records: latestBackend().records });
  const read = await reader.readSessionActivity(world.humanContext(), { session });
  if (read.status !== 'ready') throw new Error(`S6B2: the activity read failed: ${JSON.stringify(read)}`);
  return read.value;
}

async function ask(world: S6AHostWorld, input: {
  commandId: string; round: QueryJobRef; text: string;
}): Promise<QueryJobRef> {
  const body = (await world.post('requests/ask', plain(S6A_SCOPE, {
    commandId: input.commandId, round: input.round, regenerate: false, text: input.text,
    cardRefs: [{ ref: { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId },
      revision: 1 }],
  }))).body as { status: string; followupRound?: QueryJobRef };
  if (body.status !== 'queued' || body.followupRound === undefined) {
    throw new Error(`S6B2: the ask was refused: ${JSON.stringify(body)}`);
  }
  return body.followupRound;
}

describe('request activity producers (memory)', () => {
  it('a submit commit writes the assigned Session input with the round as source', async () => {
    const { world, a } = await requestScene();
    const result = await world.submit({ commandId: 's6b2-act-submit', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 activity submit', recipient: a });
    if (result.status !== 'queued') throw new Error(`S6B2: the submit was refused: ${JSON.stringify(result)}`);
    expect(await activityOf(world, a.ref)).toMatchObject({
      session: a.ref, revision: 1, lastActivityAt: '2026-10-25T10:05:00.000Z',
      record: { revision: 1, kind: 'input', session: a.ref, lastActivityAt: '2026-10-25T10:05:00.000Z',
        source: result.round },
    });
  });

  it('a follow-up commit writes the owner input with the follow-up round', async () => {
    const { world, a } = await requestScene();
    const submitted = await world.submit({ commandId: 's6b2-act-follow-submit', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 activity follow-up', recipient: a });
    if (submitted.status !== 'queued') throw new Error('S6B2: the submit was refused');
    world.clock.set('2026-10-25T10:06:00.000Z');
    const followup = await ask(world, { commandId: 's6b2-act-ask', round: submitted.round, text: 'S6B2 ask' });
    expect(await activityOf(world, a.ref)).toMatchObject({
      revision: 2, lastActivityAt: '2026-10-25T10:06:00.000Z',
      record: { revision: 2, kind: 'input', source: followup },
    });
  });

  it('a manual route writes only the target input with the routing round', async () => {
    const world = await openWorld('memory');
    const a = await world.createSecretary('a', { at: '2026-10-25T10:00:00.000Z' });
    const b = await world.createSecretary('b', { at: '2026-10-25T10:01:00.000Z' });
    world.clock.set('2026-10-25T10:05:00.000Z');
    const submitted = await world.submit({ commandId: 's6b2-act-route-submit', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 activity route', recipient: a });
    if (submitted.status !== 'queued') throw new Error('S6B2: the submit was refused');
    world.clock.set('2026-10-25T10:06:00.000Z');
    const routed = await world.route({ commandId: 's6b2-act-route', round: submitted.round, to: b });
    expect(routed.status).toBe('routed');
    if (routed.status !== 'routed') return;
    expect(await activityOf(world, a.ref)).toMatchObject({ revision: 1, record: { source: submitted.round } });
    expect(await activityOf(world, b.ref)).toMatchObject({
      revision: 1, lastActivityAt: '2026-10-25T10:06:00.000Z',
      record: { kind: 'input', source: routed.routingRound },
    });
  });

  it('the drain writes the assigned owner input with the routing round', async () => {
    const world = await openWorld('memory', { secretaryOpenCap: 2 });
    const { waiting, b, committer, secretary } = await drainScene(world);
    expect(secretary).toBeNull();
    const drained = await drainOf(world);
    expect(drained).toMatchObject({ progressed: 1, blocked: 0 });
    const routing = (await world.readRequest(waiting)).rounds.find(round => round.kind === 'routing');
    if (routing === undefined) throw new Error('S6B2: the drain wrote no routing round');
    expect(await activityOf(world, committer.ref)).toMatchObject({
      revision: 1, lastActivityAt: '2026-10-25T10:06:00.000Z',
      record: { kind: 'input', source: routing.ref },
    });
    expect(await activityOf(world, b.ref)).toMatchObject({ revision: 0, record: null });
  });

  it('an absent record reads revision 0 at the Session creation time', async () => {
    const { world, a } = await requestScene('memory', 'a', '2026-10-25T10:00:00.000Z', null);
    expect(await activityOf(world, a.ref)).toEqual({
      session: a.ref, revision: 0, lastActivityAt: '2026-10-25T10:00:00.000Z', record: null,
    });
  });

  it('two producers in one millisecond each advance the revision', async () => {
    const { world, a } = await requestScene();
    const submitted = await world.submit({ commandId: 's6b2-act-same-ms', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 activity same millisecond', recipient: a });
    if (submitted.status !== 'queued') throw new Error('S6B2: the submit was refused');
    const followup = await ask(world, { commandId: 's6b2-act-same-ms-ask', round: submitted.round, text: 'S6B2 ask' });
    expect(await activityOf(world, a.ref)).toMatchObject({
      revision: 2, lastActivityAt: '2026-10-25T10:05:00.000Z',
      record: { revision: 2, kind: 'input', lastActivityAt: '2026-10-25T10:05:00.000Z', source: followup },
    });
  });

  it('an older fact advances the revision and keeps kind, source and lastActivityAt', async () => {
    const { world, a } = await requestScene();
    const submitted = await world.submit({ commandId: 's6b2-act-older', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 activity older', recipient: a });
    if (submitted.status !== 'queued') throw new Error('S6B2: the submit was refused');
    const followup = await ask(world, { commandId: 's6b2-act-older-ask', round: submitted.round, text: 'S6B2 ask' });
    world.clock.set('2026-10-25T10:04:59.000Z');
    await ask(world, { commandId: 's6b2-act-older-ask-2', round: submitted.round, text: 'S6B2 ask again' });
    expect(await activityOf(world, a.ref)).toMatchObject({
      revision: 3, lastActivityAt: '2026-10-25T10:05:00.000Z',
      record: { revision: 3, kind: 'input', source: followup, lastActivityAt: '2026-10-25T10:05:00.000Z' },
    });
  });

  it('not_entered endings, a replay, a route away and a drop write no activity', async () => {
    const world = await openWorld('memory');
    const a = await world.createSecretary('a', { at: '2026-10-25T10:00:00.000Z' });
    const b = await world.createSecretary('b', { at: '2026-10-25T10:01:00.000Z' });
    world.clock.set('2026-10-25T10:05:00.000Z');
    const submitted = await world.submit({ commandId: 's6b2-act-none-submit', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 activity none', recipient: a });
    if (submitted.status !== 'queued') throw new Error('S6B2: the submit was refused');
    // The same command replays; it adds no round and no activity.
    const again = await world.submit({ commandId: 's6b2-act-none-submit', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 activity none', recipient: a });
    expect(again).toEqual(submitted);
    expect(await activityOf(world, a.ref)).toMatchObject({ revision: 1, record: { source: submitted.round } });
    // A route away gives the target the routing input and leaves the source alone.
    world.clock.set('2026-10-25T10:06:00.000Z');
    expect(await world.route({ commandId: 's6b2-act-none-route', round: submitted.round, to: b }))
      .toMatchObject({ status: 'routed' });
    expect(await activityOf(world, a.ref)).toMatchObject({ revision: 1 });
    expect(await activityOf(world, b.ref)).toMatchObject({ revision: 1, record: { kind: 'input' } });
    // A drop closes the pending round not_entered and writes no activity.
    world.clock.set('2026-10-25T10:07:00.000Z');
    expect(await world.drop({ commandId: 's6b2-act-none-drop', round: submitted.round }))
      .toMatchObject({ status: 'routed' });
    expect(await activityOf(world, a.ref)).toMatchObject({ revision: 1 });
    expect(await activityOf(world, b.ref)).toMatchObject({ revision: 1 });
    const closed = await readQuery(world.ag2b, submitted.round);
    expect(closed.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
  });
});

describe.each(['memory', 'sqlite'] as const)('request activity storage (%s)', backend => {
  it('the record reads back after the normal close and reopen', async () => {
    const { world, a } = await requestScene(backend);
    const submitted = await world.submit({ commandId: `s6b2-act-storage-${backend}`, goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 activity storage', recipient: a });
    if (submitted.status !== 'queued') throw new Error('S6B2: the submit was refused');
    const before = await activityOf(world, a.ref);
    expect(before).toMatchObject({ revision: 1, record: { kind: 'input', source: submitted.round } });
    if (backend === 'sqlite') await world.reopen();
    expect(await activityOf(world, a.ref)).toEqual(before);
  });
});

/** Fail the real backend's commit once (or always) when it writes a SessionActivity record. */
function failActivityCommit(backend: CapturedBackend, mode: 'once' | 'always'): { attempts(): number } {
  const real = backend.records;
  const original = real.commit.bind(real);
  let attempts = 0;
  let failed = false;
  (real as unknown as { commit: GoalRecordTransactionPort['commit'] }).commit = async (commit) => {
    const activity = commit.records.find(record => record.schemaId === 'SessionActivity@1');
    if (activity !== undefined) {
      attempts += 1;
      if (mode === 'always' || !failed) {
        failed = true;
        return { status: 'rejected', code: 'revision_conflict', reason: 'S6B2 injected activity conflict',
          current: [{ refKey: activity.refKey, revision: null }] };
      }
    }
    return await original(commit);
  };
  return { attempts: () => attempts };
}

/** Fail the real backend's commit once when it writes the round's `round_ended` activity record (A2). */
function failRoundEndedCommit(backend: CapturedBackend): { attempts(): number } {
  const real = backend.records;
  const original = real.commit.bind(real);
  let attempts = 0;
  let failed = false;
  (real as unknown as { commit: GoalRecordTransactionPort['commit'] }).commit = async (commit) => {
    const ended = commit.records.some(record => record.schemaId === 'SessionActivity@1'
      && record.json.includes('"kind":"round_ended"'));
    if (ended) {
      attempts += 1;
      if (!failed) {
        failed = true;
        return { status: 'rejected', code: 'revision_conflict', reason: 'S6B2 injected round-end conflict',
          current: [{ refKey: commit.records.find(record => record.schemaId === 'SessionActivity@1')!.refKey, revision: null }] };
      }
    }
    return await original(commit);
  };
  return { attempts: () => attempts };
}

/** A waiting request and one free line: the drain's `assigned` append is the only commit that can write activity. */
async function drainScene(world: S6AHostWorld): Promise<{
  waiting: QueryJobRef; a: S6ASession; b: S6ASession; committer: S6ASession; secretary: SessionRef | null;
}> {
  const a = await world.createSecretary('a', { at: '2026-10-25T10:00:00.000Z' });
  const b = await world.createSecretary('b', { at: '2026-10-25T10:01:00.000Z' });
  const aBusy = await world.occupy(a);
  await world.occupy(b);
  world.clock.set('2026-10-25T10:05:00.000Z');
  const waiting = await world.submit({ commandId: `s6b2-act-drain-${a.label}-${b.label}`, goalId: S6A_GOAL_1.goalId,
    text: 'S6B2 activity drain retry' });
  if (waiting.status !== 'queued' || waiting.assignment !== 'unassigned') {
    throw new Error(`S6B2: the request did not wait: ${JSON.stringify(waiting)}`);
  }
  const secretary: SessionRef | null = waiting.secretary;
  await world.finishQuery(aBusy);
  world.clock.set('2026-10-25T10:06:00.000Z');
  return { waiting: waiting.requestRoot, a, b, committer: a, secretary };
}

async function drainOf(world: S6AHostWorld) {
  const drained = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
    { maxRequests: 20, continuation: null });
  if (drained.status !== 'ready') throw new Error(`S6B2: the drain failed: ${JSON.stringify(drained)}`);
  return drained.value;
}

describe('request activity retry (memory)', () => {
  it('a one-shot activity-key revision conflict is re-read and retried by the request owner', async () => {
    const world = await openWorld('memory', { secretaryOpenCap: 2 });
    const { waiting, a } = await drainScene(world);
    const injections = failActivityCommit(latestBackend(), 'once');
    const drained = await drainOf(world);
    expect(drained).toMatchObject({ progressed: 1, blocked: 0 });
    expect(injections.attempts()).toBe(2);
    expect(await activityOf(world, a.ref)).toMatchObject({ revision: 1, record: { kind: 'input' } });
    expect((await world.readRequest(waiting)).owner).toEqual(a.ref);
  });

  it('only an exhausted activity-key conflict returns the failure', async () => {
    const world = await openWorld('memory', { secretaryOpenCap: 2 });
    const { a } = await drainScene(world);
    const injections = failActivityCommit(latestBackend(), 'always');
    const drained = await drainOf(world);
    expect(drained).toMatchObject({ progressed: 0, blocked: 1 });
    expect(injections.attempts()).toBe(4);
    expect(await activityOf(world, a.ref)).toMatchObject({ revision: 0, record: null });
  });
});

/**
 * The real entry scene: one submitted round, its claim, preparation and start,
 * held after the start commit and before the Kernel entry. The frozen manifest
 * is opened through `materials/open`; the commit barrier catches the entered
 * and ending commits whole.
 */
async function briefScene(afterSubmit?: (world: S6AHostWorld, a: S6ASession, round: QueryJobRef) => Promise<void>) {
  const calls: unknown[] = [];
  // The port is present but must never be consulted: a null briefRef consumes no brief.
  briefBox.current = { async consume(_ctx, input) { calls.push(input); throw new Error('S6B2: the null briefRef reached the port'); } };
  const world = await openWorld('memory');
  const a = await world.createSecretary('a');
  const submitted = await world.submit({ commandId: 's6b2-brief-null', goalId: S6A_GOAL_1.goalId,
    text: 'S6B2 brief null', recipient: a });
  if (submitted.status !== 'queued') throw new Error(`S6B2: the submit was refused: ${JSON.stringify(submitted)}`);
  if (afterSubmit !== undefined) await afterSubmit(world, a, submitted.round);
  expect(await claimWithSecretaryProfile(world, submitted.round, a, 's6b2-brief-null-claim')).toMatchObject({ status: 'committed' });
  const prepared = (await world.post('queries/prepare', plain(S6A_SCOPE, { requestId: 's6b2-brief-null-prepare',
    queryRunRef: (await readQuery(world.ag2b, submitted.round)).run.ref }))).body as { status: string; value?: PreparedQueryExecution };
  if (prepared.status !== 'ready' || prepared.value === undefined) {
    throw new Error(`S6B2: the preparation was refused: ${JSON.stringify(prepared)}`);
  }
  const gate = await world.gates.beforeKernel(a);
  const started = world.post('queries/start', plain(S6A_SCOPE, { prepared: prepared.value, consumerId: 's6b2-consumer',
    requestId: 's6b2-brief-null-start' }));
  started.catch(() => undefined); await gate.reached;
  return { world, a, gate, started, calls, prepared: prepared.value, before: await readQuery(world.ag2b, submitted.round) };
}

/** A2: the brief operation's own read throws once; the entered confirmation answers unavailable, never missing. */
function failOperationReadOnce(key: string): void {
  const real = recordsBox.current!;
  const original = real.readMany.bind(real);
  let failed = false;
  (real as unknown as { readMany: GoalRecordTransactionPort['readMany'] }).readMany = async (keys) => {
    if (!failed && keys.includes(key)) { failed = true; throw new Error('S6B2: the operation read failed once'); }
    return await original(keys);
  };
}

async function claimPrepare(world: S6AHostWorld, round: QueryJobRef, session: S6ASession, id: string) {
  expect(await claimWithSecretaryProfile(world, round, session, `${id}-claim`)).toMatchObject({ status: 'committed' });
  const run = (await readQuery(world.ag2b, round)).run.ref;
  const prepared = (await world.post('queries/prepare', plain(S6A_SCOPE, { queryRunRef: run,
    requestId: `${id}-prepare` }))).body as { status: string; value?: PreparedQueryExecution };
  if (prepared.status !== 'ready' || prepared.value === undefined) throw new Error(`S6B2: the ${id} preparation was refused`);
  return { run, prepared: prepared.value };
}

/** Claim and prepare one routed successor round; its frozen manifest must name the handoff's brief. */
async function preparedSuccessor(world: S6AHostWorld, routed: QueryJobRef, target: S6ASession,
  operation: OperationRef, id: string) {
  const { run, prepared } = await claimPrepare(world, routed, target, id);
  const opened = (await world.post('materials/open', plain(S6A_SCOPE, { ref: prepared.bundleRef,
    usage: 'historical_explanation' }))).body as { status: string; value?: { body: string } };
  expect(JSON.parse(opened.value?.body ?? '{}').request?.briefRef).toEqual(operation);
  return { run, prepared };
}

/** The successor round after a real hand-off; `absent`/`reject` are A2 faults at the real seams. */
async function successorScene(mode: 'ready' | 'absent' | 'reject') {
  briefBox.omit = mode === 'absent';
  const world = await openWorld('memory', {}, { secretaryTools: ['read', 'record_note'] });
  const source = await world.createSecretary(`bd01-${mode}-source`);
  // The successor exists before the hand-off, so the readiness rule needs no understanding round: a no-goal root
  // routed to the existing successor makes its brief ready.
  const target = await world.createSecretary(`bd01-${mode}-target`);
  const owned = await world.submit({ commandId: `bd01-${mode}-owned`, goalId: null,
    text: 'S6B2 BD-01 owned root', recipient: source });
  expect(owned.status).toBe('queued');
  const operation = await s6b2Accept(world, { commandId: `bd01-${mode}-accept`,
    source: source.ref, target: target.ref });
  expect(await driveS6BHandoff(world, { operation })).toMatchObject({ progress: { stage: 'finished' } });
  const record = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
  const routed = record.status === 'ready' && record.value.action.kind === 'handoff'
    ? record.value.action.progress.routing?.roots[0]?.requestRoot : undefined;
  if (routed === undefined) throw new Error('S6B2: the hand-off routed no request to the successor');
  const { run, prepared } = await preparedSuccessor(world, routed, target, operation, `bd01-${mode}`);
  if (mode === 'reject') failOperationReadOnce(canonicalJson(operation as unknown as JsonValue));
  const gate = await world.gates.beforeKernel(target);
  const started = world.post('queries/start', plain(S6A_SCOPE, { prepared,
    consumerId: 's6b2-consumer', requestId: `bd01-${mode}-start` })).then(answer => answer.body);
  started.catch(() => undefined);
  await gate.reached;
  return { world, routed, operation, run, gate, started, before: await readQuery(world.ag2b, routed) };
}

async function guardScene() {
  const world = await openWorld('memory', {}, { secretaryTools: ['read', 'record_note'] });
  const source = await world.createSecretary('bd01-guard-source');
  const [first, second] = await Promise.all(['first', 'second'].map(label => world.createSecretary(`bd01-guard-${label}`)));
  expect((await world.submit({ commandId: 'bd01-guard-owned', goalId: null,
    text: 'S6B2 BD-01 guard owned root', recipient: source })).status).toBe('queued');
  const accepted = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
    commandId: 'bd01-guard-accept', workspace: { ...S6A_SCOPE }, source: source.ref, trigger: 'manual',
    assignments: [first!, second!].map(target => ({ target: { kind: 'existing' as const, session: target.ref }, tasks: [] })) });
  if (accepted.status !== 'committed') throw new Error('S6B2: the two-successor accept was refused');
  const operation = accepted.value.operation;
  expect(await driveS6BHandoff(world, { operation })).toMatchObject({ progress: { stage: 'finished' } });
  const record = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
  const roots = record.status === 'ready' && record.value.action.kind === 'handoff' ? record.value.action.progress.routing?.roots ?? [] : [];
  const routed = roots.find(root => root.input?.to.sessionId === first!.ref.sessionId)?.requestRoot;
  if (routed === undefined) throw new Error('S6B2: the hand-off routed no request to its first successor');
  const pending = await s6aCardsWorkspace(world, S6A_SCOPE).submit({ label: 'bd01-guard-second', goalId: null, recipient: second!.ref });
  return { world, operation, entries: [
    { round: routed, ...await preparedSuccessor(world, routed, first!, operation, 'bd01-guard-first') },
    { round: pending.round, ...await preparedSuccessor(world, pending.round, second!, operation, 'bd01-guard-second') } ] };
}

describe('the entered confirmation consumes the hand-off brief (BD-01)', () => {
  it.each(['ready', 'absent', 'reject'] as const)(
    '%s: the successor entry consumes or refuses as one', async (mode) => {
      const scene = await successorScene(mode);
      if (mode === 'ready') {
        // The consumed brief record, the Run and the Job (when it moved) are one entered commit.
        const entered = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entered:'), 'entered');
        scene.gate.release();
        const held = await entered.reached;
        expect(held.records.map(item => item.schemaId))
          .toEqual(expect.arrayContaining(['QueryRunSnapshot@1', 'QueryJobSnapshot@1', 'CoreOperation@1']));
        entered.release();
        expect(await scene.started).toMatchObject({ status: 'ready' });
        const record = await scene.world.platform.sessions.getSessionOperation(
          scene.world.humanContext(), scene.operation);
        expect(record.status === 'ready' && record.value.action.kind === 'handoff'
          ? record.value.action.progress.brief : null).toMatchObject({ ready: true, consumedBy: scene.run });
        return;
      }
      scene.gate.release();
      expect(await scene.started).toMatchObject({ status: 'rejected', code: 'unavailable' });
      // Nothing entered and nothing consumed: the Job, the Run's phase and the ready brief are unchanged.
      const after = await readQuery(scene.world.ag2b, scene.routed);
      expect(after.job.revision).toBe(scene.before.job.revision);
      expect(after.run.run.executionState?.phase).toBe('entering');
      // The one-shot read fault is gone: this read shows the real ready brief the refused entry left untouched.
      const record = await scene.world.platform.sessions.getSessionOperation(
        scene.world.humanContext(), scene.operation);
      expect(record.status === 'ready' && record.value.action.kind === 'handoff'
        ? record.value.action.progress.brief : null).toMatchObject({ ready: true, consumedBy: null });
    });

  it('guard: the second successor consumes the brief first and the held entry loses the real CAS', async () => {
    const { world, operation, entries } = await guardScene();
    const entered = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entered:'), 'entered');
    const first = world.post('queries/start', plain(S6A_SCOPE, { prepared: entries[0]!.prepared,
      consumerId: 's6b2-consumer', requestId: 'bd01-guard-first-start' })).then(answer => answer.body);
    first.catch(() => undefined);
    expect((await entered.reached).records.map(item => item.schemaId)).toContain('CoreOperation@1');
    const second = await world.post('queries/start', plain(S6A_SCOPE, { prepared: entries[1]!.prepared, consumerId: 's6b2-consumer', requestId: 'bd01-guard-second-start' }));
    expect(second.body).toMatchObject({ status: 'ready' });
    entered.release();
    // The real CAS refuses A's pinned revision; its one retry finds the brief consumed and refuses too.
    expect(await first).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect((await readQuery(world.ag2b, entries[0]!.round)).run.run.executionState?.phase).toBe('entering');
    const record = await world.platform.sessions.getSessionOperation(world.humanContext(), operation);
    expect(record.status === 'ready' && record.value.action.kind === 'handoff'
      ? record.value.action.progress.brief : null).toMatchObject({ ready: true, consumedBy: entries[1]!.run });
  });

  it('null: a null briefRef never consults the port and enters without a second record', async () => {
    const scene = await briefScene();
    const entered = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entered:'), 'entered');
    scene.gate.release();
    // A production change that refuses the null-brief entry answers the start instead of committing.
    const settled = await Promise.race([
      entered.reached.then(commit => ({ commit })),
      scene.started.then(body => ({ body })),
    ]);
    if (!('commit' in settled)) throw new Error(`S6B2: the entered commit was not reached: ${JSON.stringify(settled.body)}`);
    entered.release();
    expect(scene.calls).toEqual([]);
    expect(settled.commit.records.map(item => item.schemaId))
      .toEqual(expect.arrayContaining(['QueryRunSnapshot@1', 'QueryJobSnapshot@1']));
  });
});


describe('the internal understanding input', () => {
  it('the append case writes one input activity with the appended round as source', async () => {
    const world = await openWorld('memory', {}, { secretaryTools: ['read', 'record_note'] });
    const a = await world.createSecretary('understanding-append');
    const root = await world.submit({ commandId: 's6b2-understanding-append-root', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 append root', recipient: a });
    if (root.status !== 'queued') throw new Error(`S6B2: the root request was refused: ${JSON.stringify(root)}`);
    const accepted = await world.platform.sessionHandoff.acceptHandoff(world.systemContext(), {
      commandId: 's6b2-understanding-append', workspace: { ...S6A_SCOPE }, source: a.ref, trigger: 'too_long',
      assignments: [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] }] });
    if (accepted.status !== 'committed') throw new Error('the append accept failed');
    const advanced = await world.platform.workflow.sessionHandoff!.advance(world.systemContext(),
      { operation: accepted.value.operation });
    if (advanced.status !== 'ready') throw new Error('the append advance was refused');
    const record = await world.post('sessions/operation', plain(S6A_SCOPE, accepted.value.operation));
    const operation = record.body as { value?: { action?: { progress?: { understanding?: { round: QueryJobRef }[] } } } };
    const appended = operation.value?.action?.progress?.understanding?.at(-1)?.round;
    expect(appended).toBeDefined();
    if (appended === undefined) return;
    // The append is one real activity advance: the source's record names the appended round.
    expect(await activityOf(world, a.ref)).toMatchObject({ record: { kind: 'input', source: appended } });
  });
});

const END_ANSWER = JSON.stringify({ schemaVersion: 1, body: 'S6B2 end answer', ideas: [], goalCardDrafts: [] });

/** Hold the model request of the entered round and script the terminal answer, then release the Kernel entry. */
async function atModelGate(scene: Awaited<ReturnType<typeof briefScene>>) {
  const gate = await scene.world.gates.modelRequest(scene.a);
  await scene.world.scripted.script(scene.a, [{ kind: 'text', text: END_ANSWER }]);
  scene.gate.release(); await gate.reached; return gate;
}

/** Make the owner's real carrier read omit one key and report it missing (A2 fault injection). */
function hideCarrier(key: string): void {
  const real = recordsBox.current!, original = real.readMany.bind(real);
  (real as unknown as { readMany: GoalRecordTransactionPort['readMany'] }).readMany = async (keys) => {
    const read = await original(keys);
    if (read.status !== 'ready' || !keys.includes(key)) return read;
    return { status: 'ready', value: { ...read.value, records: read.value.records.filter(r => r.refKey !== key),
      missing: [...read.value.missing, key] } };
  };
}

describe('the entered end commits consume carriers and write round_ended (row 16)', () => {
  it('a normal terminal writes round_ended, folds the moved carrier once and re-reads after a conflict', async () => {
    // A2: the first round-end activity commit conflicts once; the owner re-reads and retries the same atomic commit.
    const world = await openWorld('memory', {}, { secretaryTools: ['read', 'record_note'] });
    const a = await world.createSecretary('end-normal');
    const root = await world.submit({ commandId: 's6b2-end-normal-root', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 end normal root', recipient: a });
    if (root.status !== 'queued') throw new Error(`S6B2: the root request was refused: ${JSON.stringify(root)}`);
    const injections = failRoundEndedCommit(latestBackend());
    const round = await holdS6BUnderstandingRound(world, { secretary: a, goals: [S6A_GOAL_1] });
    expect(injections.attempts()).toBe(2);
    const query = await readQuery(world.ag2b, round.round);
    expect(query.job.job.understanding).toMatchObject({ state: 'consumed' });
    expect(query.run.run.status).toBe('answered');
    expect(await activityOf(world, a.ref)).toMatchObject({
      record: { kind: 'round_ended', source: round.queryRun },
    });
  });
  // The gates are per Session: the root round answers, then an unfinished Goal root brings the understanding round.
  /** The root round answered, then an unfinished Goal root keeps coverage short, so a real understanding round appears. */
  async function carrierScene(label: string) {
    const world = await openWorld('sqlite');
    const a = await world.createSecretary(label);
    const root = await world.submit({ commandId: `${label}-root`, goalId: S6A_GOAL_1.goalId,
      text: `S6B2 ${label} root`, recipient: a });
    if (root.status !== 'queued') throw new Error(`S6B2: the ${label} root was refused`);
    const { prepared } = await claimPrepare(world, root.round, a, `${label}-root`);
    await world.scripted.script(a, [{ kind: 'text', text: END_ANSWER }]);
    expect((await world.post('queries/start', plain(S6A_SCOPE, { prepared, consumerId: 's6b2-consumer',
      requestId: `${label}-root-start` }))).body).toMatchObject({ status: 'ready' });
    expect((await world.submit({ commandId: `${label}-unfinished`, goalId: S6A_GOAL_1.goalId,
      text: `S6B2 ${label} unfinished`, recipient: a })).status).toBe('queued');
    const accepted = await world.platform.sessionHandoff.acceptHandoff(world.systemContext(), { commandId: `${label}-accept`,
      workspace: { ...S6A_SCOPE }, source: a.ref, trigger: 'too_long',
      assignments: [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] }] });
    if (accepted.status !== 'committed') throw new Error(`S6B2: the ${label} accept was refused`);
    expect(await world.platform.workflow.sessionHandoff!.advance(world.systemContext(),
      { operation: accepted.value.operation })).toMatchObject({ status: 'ready', value: { stage: 'understanding' } });
    const operation = await world.platform.sessions.getSessionOperation(world.systemContext(), accepted.value.operation);
    const round = operation.status === 'ready' && operation.value.action.kind === 'handoff'
      ? operation.value.action.progress.understanding.at(-1)?.round : undefined;
    if (round === undefined || round === null) throw new Error(`S6B2: the ${label} hand-off appended no round`);
    const carrier = await claimPrepare(world, round, a, `${label}-carrier`);
    return { world, a, operation: accepted.value.operation, round, prepared: carrier.prepared };
  }

  async function expectRecoveredCarrier(scene: Awaited<ReturnType<typeof carrierScene>>) {
    const closed = await readQuery(scene.world.ag2b, scene.round);
    expect(closed.run.run).toMatchObject({ status: 'closed', outcome: 'failed' });
    expect(closed.job.job.understanding).toMatchObject({ state: 'consumed' });
    expect(await activityOf(scene.world, scene.a.ref)).toMatchObject({ record: { kind: 'round_ended', source: closed.run.ref } });
    expect(await scene.world.platform.workflow.sessionHandoff!.advance(scene.world.systemContext(), { operation: scene.operation })).toMatchObject({ status: 'ready' });
    expect((await readQuery(scene.world.ag2b, scene.round)).job.revision).toBe(closed.job.revision);
  }

  it.each(['reconcile', 'attest'] as const)('QRR-%s (SQLite only): the ending recovery consumes the carrier once',
    async (mode) => {
      const scene = await carrierScene(`qrr-${mode}`);
      const calls = [{ callId: `qrr-${mode}-list`, name: 'list_files', args: { prefix: '.' } }];
      await scene.world.scripted.script(scene.a, mode === 'reconcile'
        ? [{ kind: 'calls', calls }, { kind: 'text', text: END_ANSWER }] : [{ kind: 'calls', calls }]);
      const gate = mode === 'reconcile'
        ? await scene.world.gates.modelRequest(scene.a) : await scene.world.gates.toolCall(scene.a, 'list_files');
      const next = mode === 'reconcile' ? await scene.world.gates.modelRequest(scene.a) : null;
      scene.world.post('queries/start', plain(S6A_SCOPE, { prepared: scene.prepared,
        consumerId: 's6b2-consumer', requestId: `qrr-${mode}-start` })).catch(() => undefined);
      await gate.reached;
      if (next !== null) { gate.release(); await next.reached; }
      await scene.world.crash({ extraHostOptions: { requestDriver: 'on' } });
      if (mode === 'attest') {
        const unknown = await readQuery(scene.world.ag2b, scene.round);
        expect(unknown.run.run.executionState).toMatchObject({ phase: 'unknown' });
        expect((await scene.world.post('queries/resolve-unknown', graphWrite(S6A_SCOPE,
          { queryRunRef: unknown.run.ref, reason: 'the carrier round was checked by hand' }, 'qrr-06-attest',
          [{ ref: unknown.run.ref, revision: unknown.run.revision }]))).body).toMatchObject({ status: 'committed' });
      }
      await expectRecoveredCarrier(scene);
      if (next === null) gate.release();
    }, 60_000);

  it('an already consumed carrier is not transitioned a second time', async () => {
    const world = await openWorld('memory', {}, { secretaryTools: ['read', 'record_note'] });
    const a = await world.createSecretary('consumed-carrier');
    expect((await world.submit({ commandId: 'consumed-carrier-root', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 consumed carrier root', recipient: a })).status).toBe('queued');
    const held = await holdS6BUnderstandingRound(world, { secretary: a, goals: [S6A_GOAL_1] });
    const ended = await readQuery(world.ag2b, held.round);
    expect(ended.job.job.understanding).toMatchObject({ state: 'consumed' });
    // The next real advance tries the same close; an already consumed command writes no second revision.
    expect(await world.platform.workflow.sessionHandoff!.advance(world.systemContext(), { operation: held.operation }))
      .toMatchObject({ status: 'ready' });
    expect((await readQuery(world.ag2b, held.round)).job.revision).toBe(ended.job.revision);
  });

  it('a not_entered ending consumes nothing and writes no activity', async () => {
    const world = await openWorld('memory', {}, { secretaryTools: ['read', 'record_note'] });
    const a = await world.createSecretary('not-entered');
    expect((await world.submit({ commandId: 'not-entered-root', goalId: S6A_GOAL_1.goalId,
      text: 'S6B2 not entered root', recipient: a })).status).toBe('queued');
    const accepted = await world.platform.sessionHandoff.acceptHandoff(world.systemContext(), {
      commandId: 'not-entered-handoff', workspace: { ...S6A_SCOPE }, source: a.ref, trigger: 'too_long',
      assignments: [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] }] });
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed') return;
    expect(await world.platform.workflow.sessionHandoff!.advance(world.systemContext(),
      { operation: accepted.value.operation })).toMatchObject({ status: 'ready', value: { stage: 'understanding' } });
    const record = await world.platform.sessions.getSessionOperation(world.systemContext(), accepted.value.operation);
    const appended = record.status === 'ready' && record.value.action.kind === 'handoff'
      ? record.value.action.progress.understanding.at(-1)?.round : undefined;
    if (appended === undefined || appended === null) throw new Error('S6B2: the hand-off appended no round');
    const before = await activityOf(world, a.ref);
    expect(await world.drop({ commandId: 'not-entered-drop', round: appended })).toMatchObject({ status: 'routed' });
    const closed = await readQuery(world.ag2b, appended);
    expect(closed.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    // A not-entered ending consumes no carrier command and writes no `round_ended`.
    expect(closed.job.job.understanding).toMatchObject({ state: 'live' });
    expect(await activityOf(world, a.ref)).toEqual(before);
  });

  it('a missing batch carrier is unavailable and the end commit writes nothing', async () => {
    let hidden = '';
    const scene = await briefScene(async (world, a, round) => {
      const batch = await world.submit({ commandId: 's6b2-end-missing-batch', goalId: S6A_GOAL_1.goalId,
        text: 'S6B2 missing carrier', continues: round, recipient: a });
      if (batch.status !== 'queued') throw new Error('S6B2: the batch round was refused');
      hidden = canonicalJson((await readQuery(world.ag2b, batch.round)).job.ref as unknown as JsonValue);
    });
    const opened = (await scene.world.post('materials/open', plain(S6A_SCOPE, {
      ref: scene.prepared.bundleRef, usage: 'historical_explanation' }))).body as { status: string; value?: { body: string } };
    if (opened.status !== 'ready' || opened.value === undefined) {
      throw new Error(`S6B2: the frozen manifest is not readable: ${JSON.stringify(opened)}`);
    }
    const manifest = JSON.parse(opened.value.body) as { request: { batch: { ref: unknown }[] } };
    // The batch is the platform's own frozen material, not a rewritten one: it names the pending round.
    expect(manifest.request.batch.map(item => canonicalJson(item.ref as unknown as JsonValue))).toContain(hidden);
    hideCarrier(hidden);
    const modelGate = await atModelGate(scene);
    const before = await readQuery(scene.world.ag2b, scene.before.job.ref);
    modelGate.release();
    expect((await scene.started).body).toMatchObject({ status: 'rejected', code: 'unavailable' });
    const after = await readQuery(scene.world.ag2b, scene.before.job.ref);
    expect(after.job.revision).toBe(before.job.revision);
    expect(after.run.run.executionState?.phase).toBe('entered');
  });
});
