/**
 * R4c.2b behavior contract for the persisted execution-history locator.
 *
 * The suite drives ONLY the frozen `ExecutionHistoryWritePort` produced by
 * `createExecutionHistoryService` over the REAL Memory/SQLite backends and the
 * REAL formal TaskClaim written by `TaskClaimPort` (frozen in R4c.1). It reuses
 * `tests/helpers/task-claim-fixture.ts`; same-Session ownership cases explicitly
 * seed a second persisted historical Run chain rather than simulate a second
 * active claim. No successful port result is mocked. Replay is recovered from
 * the real Store through the registered `ExecutionHistoryRecorded@1` event.
 *
 * These cases were frozen RED against the R4c.2b skeleton before implementation.
 * They now exercise the accepted writer and shared codec, including independent
 * review regressions; no test assertion changes when documenting acceptance.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { RunRef, RunSnapshot, TaskAttemptSnapshot } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { seqOfCommitCursor } from '../../src/contracts/ledger.js';
import {
  encodeDispatchOutboxEntry,
  encodeTaskAttemptSnapshot,
} from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import type { TaskClaim, TaskClaimOutbox } from '../../src/core/work-graph/tasks/claim-contracts.js';
import {
  plainSessionRefToAggregate,
  sessionAggregateRefKey,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  EXECUTION_HISTORY_RECORD_SCHEMAS,
  EXECUTION_HISTORY_RECORDED_EVENT_TYPE,
  encodeExecutionHistoryRecordedEvent,
  executionHistoryRecordedEventFromEvent,
  isRunExecutionHistoryV1,
  type ExecutionHistoryRecordedEvent,
} from '../../src/core/work-graph/persistence/execution-history-codecs.js';
import type { RecordExecutionHistoryInput } from '../../src/core/work-graph/tasks/execution-history-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  CLAIM_FIXTURE_AT,
  createTaskClaimFixture,
  type ClaimFixtureKind,
  type Records,
  type TaskClaimFixture,
} from '../helpers/task-claim-fixture.js';

// --------------------------------------------------------------------------
// Fixture lifecycle
// --------------------------------------------------------------------------

const fixtures: TaskClaimFixture[] = [];
const connections: { close(): Promise<void> }[] = [];

async function open(kind: ClaimFixtureKind): Promise<TaskClaimFixture> {
  const fixture = await createTaskClaimFixture(kind);
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------

type KernelIdentity = RunExecutionHistoryV1['kernel'];
type HistoryService = ReturnType<typeof createExecutionHistoryService>;

const KERNEL_RUN_ID = 'kernel-run-1';
const KERNEL_TURN_ID = 'kernel-turn-1';

const key = (ref: object): string => canonicalJson(ref as unknown as JsonValue);

async function claimed(fixture: TaskClaimFixture, requestId = 'history-claim'): Promise<TaskClaim> {
  const result = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({ requestId }));
  expect(result).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') throw new Error('fixture claim failed');
  return result.value;
}

async function runPin(fixture: TaskClaimFixture, ref: RunRef): Promise<VersionPin> {
  const read = await fixture.records.readMany([key(ref)]);
  if (read.status !== 'ready') throw new Error('fixture Run read failed');
  const record = read.value.records.find(candidate => candidate.refKey === key(ref));
  if (record === undefined) throw new Error('fixture Run is absent');
  return { ref, revision: record.revision };
}

async function readRun(fixture: TaskClaimFixture, ref: RunRef): Promise<RunSnapshot> {
  const read = await fixture.records.readMany([key(ref)]);
  if (read.status !== 'ready') throw new Error('fixture Run read failed');
  const record = read.value.records.find(candidate => candidate.refKey === key(ref));
  if (record === undefined) throw new Error('fixture Run is absent');
  return JSON.parse(record.json) as RunSnapshot;
}

async function sessionKernel(
  fixture: TaskClaimFixture,
  ref: { projectId: string; sessionId: string },
): Promise<{ adapterId: string; kernelSessionId: string }> {
  const refKey = sessionAggregateRefKey(plainSessionRefToAggregate(ref));
  const read = await fixture.records.readMany([refKey]);
  if (read.status !== 'ready') throw new Error('fixture Session read failed');
  const record = read.value.records.find(candidate => candidate.refKey === refKey);
  if (record === undefined) throw new Error('fixture Session is absent');
  const body = JSON.parse(record.json) as { kernel: { adapterId: string; kernelSessionId: string } };
  return body.kernel;
}

function hostActorOf(fixture: TaskClaimFixture): { kind: 'human' | 'system'; id: string } {
  if (fixture.ctx.materialReader.kind === 'host') {
    const actor = fixture.ctx.materialReader.actor;
    return { kind: actor.kind, id: actor.id };
  }
  return { kind: 'human', id: 'history-operator' };
}

type HistoryOverrides = {
  requestId?: string;
  startPosition?: number;
  observedThroughPosition?: number;
  endPosition?: number | null;
  expected?: readonly VersionPin[];
};

function historyRequest(
  pin: VersionPin,
  runRef: RunRef,
  kernel: KernelIdentity,
  overrides: HistoryOverrides = {},
): GraphWrite<RecordExecutionHistoryInput> {
  return {
    input: {
      runRef,
      kernel,
      startPosition: overrides.startPosition ?? 1,
      observedThroughPosition: overrides.observedThroughPosition ?? 1,
      endPosition: overrides.endPosition === undefined ? null : overrides.endPosition,
    },
    meta: {
      requestId: overrides.requestId ?? 'history-request-1',
      expected: overrides.expected ?? [pin],
    },
  };
}

function historyOf(
  sessionRef: RunExecutionHistoryV1['sessionRef'],
  kernel: KernelIdentity,
  start: number,
  observed: number,
  end: number | null,
): RunExecutionHistoryV1 {
  return { schemaVersion: 1, sessionRef, kernel, startPosition: start,
    observedThroughPosition: observed, endPosition: end };
}

function serviceFor(
  fixture: TaskClaimFixture,
  records: Records = fixture.records,
  now: () => string = () => CLAIM_FIXTURE_AT,
): HistoryService {
  return createExecutionHistoryService({ records, now, eventId: () => `history-event-${randomUUID()}` });
}

/** Both writers must finish their reads before either reaches the real Store.
 * An early rejection also releases peers, so a broken implementation produces
 * an assertion failure instead of leaving the test stuck at the barrier. */
function commitBarrier(target: Records, participants: number) {
  let arrived = 0;
  let finished = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const maybeRelease = () => { if (arrived + finished >= participants) release(); };
  return {
    get arrivals() { return arrived; },
    records: {
      ...target,
      async commit(input) {
        arrived += 1;
        maybeRelease();
        await ready;
        return target.commit(input);
      },
    } satisfies Records,
    async run<T>(call: () => Promise<T>): Promise<T> {
      try { return await call(); }
      finally { finished += 1; maybeRelease(); }
    },
  };
}

type ReadSpy = { readMany: string[][]; lookup: number; lookupCommit: number; commit: number; eventAt: number };

function countingReader(target: Records): { records: Records; spy: ReadSpy } {
  const spy: ReadSpy = { readMany: [], lookup: 0, lookupCommit: 0, commit: 0, eventAt: 0 };
  const records: Records = {
    ...target,
    readMany(keys) { spy.readMany.push([...keys]); return target.readMany(keys); },
    lookup(request) { spy.lookup += 1; return target.lookup(request); },
    lookupCommit(input) { spy.lookupCommit += 1; return target.lookupCommit(input); },
    commit(input) { spy.commit += 1; return target.commit(input); },
    eventAt(cursor) { spy.eventAt += 1; return target.eventAt(cursor); },
  };
  return { records, spy };
}

function mutateRecord(
  target: Records,
  match: (refKey: string) => boolean,
  mutate: (body: Record<string, unknown>) => void,
): Records {
  return {
    ...target,
    async readMany(keys) {
      const read = await target.readMany(keys);
      if (read.status !== 'ready') return read;
      return { ...read, value: { ...read.value, records: read.value.records.map(record => {
        if (!match(record.refKey)) return record;
        const body = JSON.parse(record.json) as Record<string, unknown>;
        mutate(body);
        return { ...record, json: JSON.stringify(body) };
      }) } };
    },
  };
}

type HistoryContext = {
  fixture: TaskClaimFixture;
  claim: TaskClaim;
  kernel: KernelIdentity;
  service: HistoryService;
};

async function setup(kind: ClaimFixtureKind): Promise<HistoryContext> {
  const fixture = await open(kind);
  const claim = await claimed(fixture);
  const mapping = await sessionKernel(fixture, claim.sessionRef);
  const kernel: KernelIdentity = { adapterId: mapping.adapterId, kernelSessionId: mapping.kernelSessionId,
    runId: KERNEL_RUN_ID, turnId: KERNEL_TURN_ID };
  return { fixture, claim, kernel, service: serviceFor(fixture) };
}

/** A normal caller reads the current Run revision and pins it. */
async function write(h: HistoryContext, overrides: HistoryOverrides = {}) {
  const pin = await runPin(h.fixture, h.claim.runRef);
  return h.service.recordExecutionHistory(h.fixture.ctx, historyRequest(pin, h.claim.runRef, h.kernel, overrides));
}

/**
 * Craft a second Run whose claim-linked outbox names the SAME platform Session
 * as `source`, so its Kernel Session identity is the same. The claim-loop cannot
 * produce this (one Session cannot be claimed twice), so the fixture writes the
 * real Attempt/outbox records for a seeded Run. This is a real Store state, not
 * a mocked port result.
 */
async function seedLinkedRun(fixture: TaskClaimFixture, source: TaskClaim, taskId: string): Promise<RunRef> {
  const runRef = await fixture.seedRun(taskId, 'starting');
  const run = await readRun(fixture, runRef);
  const attemptRef = { aggregateType: 'TaskAttempt' as const, projectId: fixture.scope.projectId,
    goalId: fixture.goalRef.goalId, taskId, attemptId: run.attemptId };
  const outboxRef = { aggregateType: 'DispatchOutboxEntry' as const, projectId: fixture.scope.projectId,
    goalId: fixture.goalRef.goalId, taskId, attemptId: run.attemptId };
  const attempt: TaskAttemptSnapshot = { ref: attemptRef, revision: 1, schemaVersion: 1, runId: runRef.runId,
    planRef: run.planRef, status: 'claimed', startedAt: null, endedAt: null, endOutcome: null };
  const claim: TaskClaim = {
    task: { projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, taskId },
    planRef: run.planRef, workspaceId: fixture.scope.workspaceId, sessionRef: source.sessionRef,
    sessionRevision: source.sessionRevision, generation: source.generation,
    runRef, attemptRef, outboxRef, claimedAt: CLAIM_FIXTURE_AT,
  };
  const outbox: TaskClaimOutbox = { ref: outboxRef, revision: 1, schemaVersion: 1, status: 'pending', claim };
  const sessionRefKey = sessionAggregateRefKey(plainSessionRefToAggregate(source.sessionRef));
  const sessionRead = await fixture.records.readMany([sessionRefKey]);
  if (sessionRead.status !== 'ready') throw new Error('fixture Session read failed');
  const sessionRecord = sessionRead.value.records.find(candidate => candidate.refKey === sessionRefKey);
  const receipt = await fixture.commitRaw(
    [encodeTaskAttemptSnapshot(attempt), encodeDispatchOutboxEntry(outbox)],
    [{ refKey: sessionRefKey, expectedRevision: sessionRecord?.revision ?? null }]);
  expect(receipt).toMatchObject({ status: 'committed' });
  return runRef;
}

// --------------------------------------------------------------------------
// Pure shared codec
// --------------------------------------------------------------------------

describe('R4c.2b execution-history locator codec', () => {
  const valid: RunExecutionHistoryV1 = {
    schemaVersion: 1,
    sessionRef: { projectId: 'project-1', sessionId: 'session-1' },
    kernel: { adapterId: 'adapter-1', kernelSessionId: 'kernel-session-1', runId: 'kernel-run-1', turnId: 'kernel-turn-1' },
    startPosition: 2,
    observedThroughPosition: 5,
    endPosition: 4,
  };

  it('accepts a complete locator', () => {
    expect(isRunExecutionHistoryV1(valid)).toBe(true);
  });

  it('rejects malformed nested fields', () => {
    const bad: unknown[] = [
      null,
      { ...valid, schemaVersion: 2 },
      { ...valid, sessionRef: null },
      { ...valid, sessionRef: { projectId: 'project-1' } },
      { ...valid, kernel: { ...valid.kernel, turnId: '' } },
      { ...valid, kernel: { ...valid.kernel, runId: 7 } },
      { ...valid, kernel: null },
    ];
    for (const value of bad) expect(isRunExecutionHistoryV1(value)).toBe(false);
  });

  it('rejects non-positive and inconsistent ranges', () => {
    const bad: unknown[] = [
      { ...valid, startPosition: 0 },
      { ...valid, startPosition: -1 },
      { ...valid, startPosition: 1.5 },
      { ...valid, observedThroughPosition: 0 },
      { ...valid, observedThroughPosition: 1 },
      { ...valid, endPosition: 0 },
      { ...valid, endPosition: 6 },
      { ...valid, endPosition: 1 },
    ];
    for (const value of bad) expect(isRunExecutionHistoryV1(value)).toBe(false);
  });

  it('registers no record codec and exactly the replay event', () => {
    expect(EXECUTION_HISTORY_RECORD_SCHEMAS.records).toHaveLength(0);
    const registered = EXECUTION_HISTORY_RECORD_SCHEMAS.events.filter(
      event => event.eventType === EXECUTION_HISTORY_RECORDED_EVENT_TYPE && event.schemaVersion === 1);
    expect(registered).toHaveLength(1);
  });

  it('round-trips the replay event through its own encoder/decoder', () => {
    const event: ExecutionHistoryRecordedEvent = {
      eventId: 'event-1', eventType: 'ExecutionHistoryRecorded', schemaVersion: 1, occurredAt: CLAIM_FIXTURE_AT,
      identityKey: 'identity-1', actor: { kind: 'human', id: 'operator' }, fingerprint: 'fingerprint-1',
      recorded: { runRef: { aggregateType: 'Run', projectId: 'project-1', goalId: 'goal-1', runId: 'run-1' },
        runRevision: 2, history: valid },
    };
    const decoded = executionHistoryRecordedEventFromEvent(encodeExecutionHistoryRecordedEvent(event));
    expect(decoded).toMatchObject({ status: 'decoded' });
    if (decoded.status === 'decoded') expect(decoded.value).toEqual(event);
  });

  it('rejects a damaged replay event envelope', () => {
    const decoded = executionHistoryRecordedEventFromEvent({
      eventId: 'event-1', eventType: 'ExecutionHistoryRecorded', schemaVersion: 1,
      occurredAt: CLAIM_FIXTURE_AT, json: '{"not":"the event"}',
    });
    expect(decoded).toMatchObject({ status: 'invalid' });
  });

  it('rejects a valid replay body when its envelope or owning project disagrees', () => {
    const event: ExecutionHistoryRecordedEvent = {
      eventId: 'event-bound', eventType: 'ExecutionHistoryRecorded', schemaVersion: 1,
      occurredAt: CLAIM_FIXTURE_AT, identityKey: 'identity-bound',
      actor: { kind: 'human', id: 'operator' }, fingerprint: 'fingerprint-bound',
      recorded: { runRef: { aggregateType: 'Run', projectId: 'project-1', goalId: 'goal-1', runId: 'run-1' },
        runRevision: 2, history: valid },
    };
    const encoded = encodeExecutionHistoryRecordedEvent(event);
    const variants = [
      { name: 'eventId', value: { ...encoded, eventId: 'different-event' } },
      { name: 'eventType', value: { ...encoded, eventType: 'DifferentEvent' } },
      { name: 'schemaVersion', value: { ...encoded, schemaVersion: 2 } },
      { name: 'occurredAt', value: { ...encoded, occurredAt: '2026-09-25T01:00:00.000Z' } },
      { name: 'project binding', value: encodeExecutionHistoryRecordedEvent({ ...event,
        recorded: { ...event.recorded, runRef: { ...event.recorded.runRef, projectId: 'different-project' } } }) },
    ];
    for (const { name, value } of variants) {
      expect(executionHistoryRecordedEventFromEvent(value), name).toMatchObject({ status: 'invalid' });
    }
  });
});

// --------------------------------------------------------------------------
// Real Memory/SQLite behavior
// --------------------------------------------------------------------------

const KINDS = ['memory', 'sqlite'] as const;

describe.each(KINDS)('R4c.2b real %s execution-history index', kind => {
  it('binds the locator on the first call and returns the new Run revision', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const result = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(pin, h.claim.runRef, h.kernel, { requestId: 'history-first', observedThroughPosition: 3 }));
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') return;
    expect(result.value.runRef).toEqual(h.claim.runRef);
    expect(result.value.runRevision).toBe(pin.revision + 1);
    expect(result.value.history).toEqual(historyOf(h.claim.sessionRef, h.kernel, 1, 3, null));
  });

  it('preserves every original Run field while adding the locator', async () => {
    const h = await setup(kind);
    const before = await readRun(h.fixture, h.claim.runRef);
    const result = await write(h, { requestId: 'history-preserve', observedThroughPosition: 2 });
    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') return;
    const after = await readRun(h.fixture, h.claim.runRef);
    expect(after.executionHistory).toEqual(historyOf(h.claim.sessionRef, h.kernel, 1, 2, null));
    expect(after.status).toBe(before.status);
    expect(after.task).toEqual(before.task);
    expect(after.attemptId).toBe(before.attemptId);
    expect(after.planRef).toEqual(before.planRef);
    expect(after.roleBinding).toEqual(before.roleBinding);
    expect(after.budget).toEqual(before.budget);
    expect(after.workspaceSnapshot).toEqual(before.workspaceSnapshot);
    expect(after.outcome).toBeNull();
    expect(after.startedAt).toBeNull();
    expect(after.endedAt).toBeNull();
    expect(after.exitCode).toBeNull();
    expect(after.revision).toBe(before.revision + 1);
  });

  it('lets WG11 readExecution return the persisted locator', async () => {
    const h = await setup(kind);
    const result = await write(h, { requestId: 'history-wg11', observedThroughPosition: 4, endPosition: 3 });
    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') return;
    const read = await createRunStateReader({ records: h.fixture.records })
      .readExecution(h.fixture.ctx, h.claim.runRef);
    expect(read).toMatchObject({ status: 'ready' });
    if (read.status !== 'ready') return;
    expect(read.value.run.executionHistory).toEqual(result.value.history);
  });

  it('grows observedThroughPosition without changing identity or start', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-grow-1', observedThroughPosition: 3 });
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const pin = await runPin(h.fixture, h.claim.runRef);
    const second = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(pin, h.claim.runRef, h.kernel, { requestId: 'history-grow-2', observedThroughPosition: 8 }));
    expect(second).toMatchObject({ status: 'committed', replayed: false });
    if (second.status !== 'committed') return;
    expect(second.value.runRevision).toBe(pin.revision + 1);
    expect(second.value.history.startPosition).toBe(1);
    expect(second.value.history.kernel).toEqual(h.kernel);
    expect(second.value.history.observedThroughPosition).toBe(8);
  });

  it('sets a terminal endPosition once and refuses to clear or change it', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-end-1', observedThroughPosition: 8 });
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const pin = await runPin(h.fixture, h.claim.runRef);
    const ended = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(pin, h.claim.runRef, h.kernel, { requestId: 'history-end-2', observedThroughPosition: 8, endPosition: 5 }));
    expect(ended).toMatchObject({ status: 'committed', replayed: false });
    if (ended.status !== 'committed') return;
    expect(ended.value.history.endPosition).toBe(5);

    const clearing = await write(h, { requestId: 'history-end-clear', observedThroughPosition: 8, endPosition: null });
    expect(clearing).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const changing = await write(h, { requestId: 'history-end-change', observedThroughPosition: 8, endPosition: 6 });
    expect(changing).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  });

  it('refuses to lower the inspected watermark', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-observed-1', observedThroughPosition: 6 });
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const second = await write(h, { requestId: 'history-observed-2', observedThroughPosition: 4 });
    expect(second).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  });

  it('refuses to change the fixed kernel identity or start position', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-identity-1', observedThroughPosition: 3 });
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const pin = await runPin(h.fixture, h.claim.runRef);
    const cases: { name: string; kernel: KernelIdentity; startPosition: number }[] = [
      { name: 'runId', kernel: { ...h.kernel, runId: 'another-kernel-run' }, startPosition: 1 },
      { name: 'turnId', kernel: { ...h.kernel, turnId: 'another-kernel-turn' }, startPosition: 1 },
      { name: 'start', kernel: h.kernel, startPosition: 2 },
    ];
    for (const scenario of cases) {
      const request = historyRequest(pin, h.claim.runRef, scenario.kernel,
        { requestId: `history-identity-${scenario.name}`, observedThroughPosition: 3, startPosition: scenario.startPosition });
      const outcome = await h.service.recordExecutionHistory(h.fixture.ctx, request);
      expect(outcome, scenario.name).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    }
  });

  it('rejects a Kernel session that disagrees with the claim Session mapping', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const outcome = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(pin, h.claim.runRef, { ...h.kernel, kernelSessionId: 'another-kernel-session' },
        { requestId: 'history-session-mismatch' }));
    expect(outcome).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('rejects non-positive or inconsistent positions as invalid', async () => {
    const h = await setup(kind);
    const cases: { startPosition: number; observedThroughPosition: number; endPosition: number | null }[] = [
      { startPosition: 0, observedThroughPosition: 1, endPosition: null },
      { startPosition: 1, observedThroughPosition: 0, endPosition: null },
      { startPosition: 3, observedThroughPosition: 2, endPosition: null },
      { startPosition: 1, observedThroughPosition: 2, endPosition: 3 },
      { startPosition: 2, observedThroughPosition: 3, endPosition: 1 },
      { startPosition: 1, observedThroughPosition: 3, endPosition: 0 },
      { startPosition: 1.5, observedThroughPosition: 3, endPosition: null },
    ];
    for (const [index, positions] of cases.entries()) {
      const outcome = await write(h, { requestId: `history-range-${index}`, ...positions });
      expect(outcome, `range case ${index}`).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
  });

  it('requires exactly one positive Run revision pin and never replaces it', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const cases: { name: string; expected: unknown }[] = [
      { name: 'empty', expected: [] },
      { name: 'duplicate', expected: [pin, pin] },
      { name: 'another-run', expected: [{ ref: { ...h.claim.runRef, runId: 'other-run' }, revision: pin.revision }] },
      { name: 'zero', expected: [{ ref: h.claim.runRef, revision: 0 }] },
      { name: 'negative', expected: [{ ref: h.claim.runRef, revision: -1 }] },
      { name: 'fractional', expected: [{ ref: h.claim.runRef, revision: 1.5 }] },
    ];
    for (const scenario of cases) {
      const request = {
        input: { runRef: h.claim.runRef, kernel: h.kernel, startPosition: 1, observedThroughPosition: 1, endPosition: null },
        meta: { requestId: `history-pin-${scenario.name}`, expected: scenario.expected },
      } as unknown as GraphWrite<RecordExecutionHistoryInput>;
      const outcome = await h.service.recordExecutionHistory(h.fixture.ctx, request);
      expect(outcome, scenario.name).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
  });

  it('replays the original result from the real Store even after the Run grew', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const original = historyRequest(pin, h.claim.runRef, h.kernel,
      { requestId: 'history-replay', observedThroughPosition: 3 });
    const first = await h.service.recordExecutionHistory(h.fixture.ctx, original);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    const grown = await write(h, { requestId: 'history-replay-growth', observedThroughPosition: 6 });
    expect(grown).toMatchObject({ status: 'committed', replayed: false });
    if (grown.status !== 'committed') return;
    expect(grown.value.runRevision).toBe(first.value.runRevision + 1);

    const replay = await h.service.recordExecutionHistory(h.fixture.ctx, original);
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    if (replay.status !== 'committed') return;
    expect(replay.value.runRevision).toBe(first.value.runRevision);
    expect(replay.value.history).toEqual(first.value.history);
  });

  it('reports idempotency_conflict for the same requestId with different content', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-conflict', observedThroughPosition: 3 });
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const pin = await runPin(h.fixture, h.claim.runRef);
    const changed = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(pin, h.claim.runRef, h.kernel, { requestId: 'history-conflict', observedThroughPosition: 4 }));
    expect(changed).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it('commits the same content under a new requestId as a fresh CAS write', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-fresh-1', observedThroughPosition: 3 });
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    const second = await write(h, { requestId: 'history-fresh-2', observedThroughPosition: 3 });
    expect(second).toMatchObject({ status: 'committed', replayed: false });
    if (second.status !== 'committed') return;
    expect(second.value.runRevision).toBe(first.value.runRevision + 1);
    expect(second.value.history).toEqual(first.value.history);
  });

  it('admits exactly one concurrent update at the same Run revision', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const barrier = commitBarrier(h.fixture.records, 2);
    const service = serviceFor(h.fixture, barrier.records);
    const results = await Promise.all([3, 5].map((observedThroughPosition, index) =>
      barrier.run(() => service.recordExecutionHistory(h.fixture.ctx, historyRequest(pin, h.claim.runRef, h.kernel,
        { requestId: `history-concurrent-${index}`, observedThroughPosition })))));
    expect(results.filter(result => result.status === 'committed')).toHaveLength(1);
    expect(barrier.arrivals).toBe(2);
    expect(results.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ code: 'revision_conflict' }),
    ]);
    expect((await readRun(h.fixture, h.claim.runRef)).revision).toBe(pin.revision! + 1);
  });

  it('atomically grants an unowned Kernel identity to one of two different Runs', async () => {
    const h = await setup(kind);
    const runB = await seedLinkedRun(h.fixture, h.claim, h.fixture.tasks.second.taskId);
    const refs = [h.claim.runRef, runB];
    const pins = await Promise.all(refs.map(ref => runPin(h.fixture, ref)));
    const requests = refs.map((ref, index) => historyRequest(pins[index]!, ref, h.kernel,
      { requestId: `history-slot-race-${index}`, observedThroughPosition: 3 }));
    const barrier = commitBarrier(h.fixture.records, 2);
    const service = serviceFor(h.fixture, barrier.records);
    const results = await Promise.all(requests.map(request =>
      barrier.run(() => service.recordExecutionHistory(h.fixture.ctx, request))));
    expect(results.filter(result => result.status === 'committed')).toHaveLength(1);
    expect(barrier.arrivals).toBe(2);
    expect(results.filter(result => result.status === 'rejected')).toEqual([
      expect.objectContaining({ code: 'busy' }),
    ]);
    const winner = results.findIndex(result => result.status === 'committed');
    const loser = winner === 0 ? 1 : 0;
    expect((await readRun(h.fixture, refs[winner]!)).executionHistory).toBeDefined();
    const losingRun = await readRun(h.fixture, refs[loser]!);
    expect(losingRun.executionHistory).toBeUndefined();
    expect(losingRun.revision).toBe(pins[loser]!.revision);
    // A failed claim must not have committed a receipt that later replays.
    expect(await h.service.recordExecutionHistory(h.fixture.ctx, requests[loser]!))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    expect(await h.service.recordExecutionHistory(h.fixture.ctx, requests[winner]!))
      .toMatchObject({ status: 'committed', replayed: true });
  });

  it('rejects a stale expected revision as a CAS conflict', async () => {
    const h = await setup(kind);
    const stalePin = await runPin(h.fixture, h.claim.runRef);
    const first = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(stalePin, h.claim.runRef, h.kernel, { requestId: 'history-cas-1', observedThroughPosition: 3 }));
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const loser = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(stalePin, h.claim.runRef, h.kernel, { requestId: 'history-cas-2', observedThroughPosition: 5 }));
    expect(loser).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  });

  it('reports busy when another Run already owns the Kernel identity slot', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-slot-owner', observedThroughPosition: 3 });
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const runB = await seedLinkedRun(h.fixture, h.claim, h.fixture.tasks.second.taskId);
    const before = await h.fixture.records.readMany([key(runB)]);
    if (before.status !== 'ready') throw new Error('Run B read failed');
    const cursorBefore = before.value.readThrough;
    const pinB = await runPin(h.fixture, runB);
    const intruder = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(pinB, runB, h.kernel, { requestId: 'history-slot-intruder', observedThroughPosition: 3 }));
    expect(intruder).toMatchObject({ status: 'rejected', code: 'busy' });
    expect((await readRun(h.fixture, runB)).executionHistory).toBeUndefined();
    const after = await h.fixture.records.readMany([key(runB)]);
    if (after.status === 'ready') expect(after.value.readThrough).toBe(cursorBefore);
  });

  it('leaves zero new state when a commit conflicts (full rollback)', async () => {
    const h = await setup(kind);
    const firstPin = await runPin(h.fixture, h.claim.runRef);
    const first = await h.service.recordExecutionHistory(h.fixture.ctx,
      historyRequest(firstPin, h.claim.runRef, h.kernel, { requestId: 'history-rollback-1', observedThroughPosition: 3 }));
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const runBefore = await readRun(h.fixture, h.claim.runRef);
    const before = await h.fixture.records.readMany([key(h.claim.runRef)]);
    if (before.status !== 'ready') throw new Error('Run read failed');
    const cursorBefore = before.value.readThrough;

    const losing = historyRequest(firstPin, h.claim.runRef, h.kernel,
      { requestId: 'history-rollback-2', observedThroughPosition: 5 });
    const failed = await h.service.recordExecutionHistory(h.fixture.ctx, losing);
    expect(failed).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    // If the failed transaction had persisted its idempotency row, this verbatim
    // retry would replay; instead it must fail the same way and leave no state.
    const retry = await h.service.recordExecutionHistory(h.fixture.ctx, losing);
    expect(retry).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await readRun(h.fixture, h.claim.runRef)).toEqual(runBefore);
    const after = await h.fixture.records.readMany([key(h.claim.runRef)]);
    if (after.status === 'ready') expect(after.value.readThrough).toBe(cursorBefore);
  });

  it('treats an unindexed legacy Run as readable and lets a starting Run record history', async () => {
    const h = await setup(kind);
    const before = await createRunStateReader({ records: h.fixture.records })
      .readExecution(h.fixture.ctx, h.claim.runRef);
    expect(before).toMatchObject({ status: 'ready' });
    if (before.status !== 'ready') return;
    expect(before.value.run.executionHistory).toBeUndefined();
    expect(before.value.run.status).toBe('starting');

    const result = await write(h, { requestId: 'history-starting', observedThroughPosition: 2 });
    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') return;
    const after = await readRun(h.fixture, h.claim.runRef);
    expect(after.status).toBe('starting');
    expect(after.startedAt).toBeNull();
    expect(after.endedAt).toBeNull();
    expect(after.outcome).toBeNull();
    expect(after.exitCode).toBeNull();
    expect(after.executionHistory).toEqual(result.value.history);
  });

  it('does not require the current Session occupancy to still belong to the old Run', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-occupancy-1', observedThroughPosition: 2 });
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    await h.fixture.overwriteSession(h.claim.sessionRef,
      record => ({ ...record, occupancy: null, lastExecutionRef: null }));
    const second = await write(h, { requestId: 'history-occupancy-2', observedThroughPosition: 4 });
    expect(second).toMatchObject({ status: 'committed', replayed: false });
    if (second.status !== 'committed') return;
    expect(second.value.history.observedThroughPosition).toBe(4);
    const card = await h.fixture.sessionsPort.readSession(h.fixture.ctx, h.claim.sessionRef);
    expect(card).toMatchObject({ status: 'ready' });
    if (card.status === 'ready') expect(card.value.record.occupancy).toBeNull();
  });

  it('does not guard the current Lease version changed after the final read', async () => {
    const h = await setup(kind);
    const first = await write(h, { requestId: 'history-lease-1', observedThroughPosition: 2 });
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;
    const leaseRefKey = key({ aggregateType: 'TaskLease', ...h.claim.task });
    const leaseRead = await h.fixture.records.readMany([leaseRefKey]);
    if (leaseRead.status !== 'ready') throw new Error('Lease read failed');
    const record = leaseRead.value.records.find(candidate => candidate.refKey === leaseRefKey);
    if (record === undefined) throw new Error('Lease is absent');
    const body = JSON.parse(record.json) as Record<string, unknown>;
    body['revision'] = record.revision + 1;
    body['holderRunId'] = 'another-holder';
    let intervened = false;
    const records: Records = {
      ...h.fixture.records,
      async commit(input) {
        // This update happens only after the service prepared its guards. It
        // also advances the global ledger, so either extra guard would fail.
        expect(await h.fixture.commitRaw([{ ...record, revision: record.revision + 1, json: JSON.stringify(body) }],
          [{ refKey: leaseRefKey, expectedRevision: record.revision }])).toMatchObject({ status: 'committed' });
        intervened = true;
        return h.fixture.records.commit(input);
      },
    };
    const second = await serviceFor(h.fixture, records).recordExecutionHistory(h.fixture.ctx,
      historyRequest(await runPin(h.fixture, h.claim.runRef), h.claim.runRef, h.kernel,
        { requestId: 'history-lease-2', observedThroughPosition: 5 }));
    expect(second).toMatchObject({ status: 'committed', replayed: false });
    expect(intervened).toBe(true);
  });

  it('reports a malformed stored locator as unavailable', async () => {
    const h = await setup(kind);
    const result = await write(h, { requestId: 'history-damaged', observedThroughPosition: 3 });
    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') return;
    const records = mutateRecord(h.fixture.records, refKey => refKey === key(h.claim.runRef), body => {
      (body['executionHistory'] as { observedThroughPosition: number }).observedThroughPosition = 0;
    });
    const damaged = await serviceFor(h.fixture, records).recordExecutionHistory(h.fixture.ctx,
      historyRequest(await runPin(h.fixture, h.claim.runRef), h.claim.runRef, h.kernel,
        { requestId: 'history-damaged-2', observedThroughPosition: 4 }));
    expect(damaged).toMatchObject({ status: 'rejected', code: 'unavailable' });
  });

  it('rejects invalid scope and identity before any store read', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const base = historyRequest(pin, h.claim.runRef, h.kernel, { requestId: 'history-scope' });
    const actor = hostActorOf(h.fixture);
    const withoutWorkspace = { ...h.fixture.ctx } as Record<string, unknown>;
    delete withoutWorkspace['workspaceId'];
    const cases: { name: string; ctx: CoreCallContext; request: GraphWrite<RecordExecutionHistoryInput> }[] = [
      { name: 'non-host principal',
        ctx: { ...h.fixture.ctx, principal: { kind: 'system' } } as unknown as CoreCallContext, request: base },
      { name: 'work_run principal',
        ctx: { ...h.fixture.ctx, principal: { kind: 'work_run' } } as unknown as CoreCallContext, request: base },
      { name: 'query_run principal',
        ctx: { ...h.fixture.ctx, principal: { kind: 'query_run' } } as unknown as CoreCallContext, request: base },
      { name: 'missing workspace', ctx: withoutWorkspace as unknown as CoreCallContext, request: base },
      { name: 'material reader actor mismatch',
        ctx: { ...h.fixture.ctx, materialReader: { kind: 'host', projectId: h.fixture.scope.projectId,
          workspaceId: h.fixture.scope.workspaceId, actor: { ...actor, id: 'other-actor' } } }, request: base },
      { name: 'cross-project ctx',
        ctx: { ...h.fixture.ctx, projectId: 'other-project' }, request: base },
      { name: 'cross-project runRef', ctx: h.fixture.ctx,
        request: historyRequest(pin, { ...h.claim.runRef, projectId: 'other-project' }, h.kernel,
          { requestId: 'history-scope-run' }) },
      { name: 'empty kernel runId', ctx: h.fixture.ctx,
        request: historyRequest(pin, h.claim.runRef, { ...h.kernel, runId: '' }, { requestId: 'history-scope-kernel' }) },
      { name: 'empty requestId', ctx: h.fixture.ctx, request: { input: base.input, meta: { requestId: '', expected: [pin] } } },
    ];
    const counted = countingReader(h.fixture.records);
    const service = serviceFor(h.fixture, counted.records);
    for (const scenario of cases) {
      const outcome = await service.recordExecutionHistory(scenario.ctx, scenario.request);
      expect(outcome, scenario.name).toMatchObject({ status: 'rejected' });
      if (outcome.status === 'rejected') expect(outcome.code, scenario.name).not.toBe('unsupported');
    }
    expect(counted.spy.readMany).toHaveLength(0);
    expect(counted.spy.lookupCommit).toBe(0);
    expect(counted.spy.commit).toBe(0);
  });

  it('rejects a pre-aborted call and writes nothing', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const controller = new AbortController();
    controller.abort();
    const counted = countingReader(h.fixture.records);
    const outcome = await serviceFor(h.fixture, counted.records).recordExecutionHistory(
      { ...h.fixture.ctx, signal: controller.signal },
      historyRequest(pin, h.claim.runRef, h.kernel, { requestId: 'history-cancel' }));
    expect(outcome).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(counted.spy.readMany).toHaveLength(0);
    expect(counted.spy.commit).toBe(0);
  });

  it('turns an abort during the read into cancelled and does not commit', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const controller = new AbortController();
    const counted = countingReader(h.fixture.records);
    const records: Records = {
      ...counted.records,
      async readMany(keys) {
        const read = await counted.records.readMany(keys);
        controller.abort();
        return read;
      },
    };
    const outcome = await serviceFor(h.fixture, records).recordExecutionHistory(
      { ...h.fixture.ctx, signal: controller.signal },
      historyRequest(pin, h.claim.runRef, h.kernel, { requestId: 'history-cancel-mid' }));
    expect(outcome).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(counted.spy.commit).toBe(0);
  });

  it('binds ctx and request before the first await', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const request = historyRequest(pin, h.claim.runRef, h.kernel,
      { requestId: 'history-mutation', observedThroughPosition: 4 });
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const records: Records = {
      ...h.fixture.records,
      async readMany(keys) {
        if (first) { first = false; await blocked; }
        return h.fixture.records.readMany(keys);
      },
    };
    const ctx: CoreCallContext = { ...h.fixture.ctx, materialReader: { ...h.fixture.ctx.materialReader } };
    const pending = serviceFor(h.fixture, records).recordExecutionHistory(ctx, request);
    request.input.observedThroughPosition = 99;
    request.input.kernel.runId = 'mutated-run';
    ctx.projectId = 'mutated-project';
    if (ctx.materialReader.kind === 'host') ctx.materialReader.actor.id = 'mutated-actor';
    release();
    const result = await pending;
    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') return;
    expect(result.value.history.observedThroughPosition).toBe(4);
    expect(result.value.history.kernel.runId).toBe(KERNEL_RUN_ID);
  });

  it('uses directed readMany plus one commit and one replay read only', async () => {
    const h = await setup(kind);
    const pin = await runPin(h.fixture, h.claim.runRef);
    const original = historyRequest(pin, h.claim.runRef, h.kernel,
      { requestId: 'history-directed', observedThroughPosition: 3 });
    const counted = countingReader(h.fixture.records);
    const first = await serviceFor(h.fixture, counted.records).recordExecutionHistory(h.fixture.ctx, original);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    expect(counted.spy.lookup).toBe(0);
    expect(counted.spy.lookupCommit).toBe(1);
    expect(counted.spy.commit).toBe(1);
    expect(counted.spy.eventAt).toBe(0);
    expect(counted.spy.readMany).toHaveLength(3);
    for (const keys of counted.spy.readMany) expect(keys.length).toBeLessThanOrEqual(6);

    const replayCounted = countingReader(h.fixture.records);
    const replay = await serviceFor(h.fixture, replayCounted.records).recordExecutionHistory(h.fixture.ctx, original);
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    expect(replayCounted.spy.readMany).toHaveLength(0);
    expect(replayCounted.spy.lookupCommit).toBe(1);
    expect(replayCounted.spy.eventAt).toBe(1);
    expect(replayCounted.spy.commit).toBe(0);
  });

  it('keeps the write query size stable as unrelated Runs and commits grow', async () => {
    const h = await setup(kind);
    const baseline = countingReader(h.fixture.records);
    expect(await serviceFor(h.fixture, baseline.records).recordExecutionHistory(h.fixture.ctx,
      historyRequest(await runPin(h.fixture, h.claim.runRef), h.claim.runRef, h.kernel,
        { requestId: 'history-scale-0', observedThroughPosition: 2 })))
      .toMatchObject({ status: 'committed' });
    const firstCount = baseline.spy.readMany.length;

    expect(await h.fixture.service.claimTask(h.fixture.ctx, await h.fixture.buildRequest({ requestId: 'history-scale-other',
      input: { taskId: h.fixture.tasks.second.taskId, sessionRef: h.fixture.sessions.second } })))
      .toMatchObject({ status: 'committed' });
    await h.fixture.seedRun(h.fixture.tasks.gate.taskId, 'starting');
    for (let index = 0; index < 5; index += 1) {
      await h.fixture.seedRun(`unrelated-${index}`, 'starting');
    }

    const after = countingReader(h.fixture.records);
    expect(await serviceFor(h.fixture, after.records).recordExecutionHistory(h.fixture.ctx,
      historyRequest(await runPin(h.fixture, h.claim.runRef), h.claim.runRef, h.kernel,
        { requestId: 'history-scale-1', observedThroughPosition: 3 })))
      .toMatchObject({ status: 'committed' });
    expect(after.spy.readMany.length).toBe(firstCount);
  });
});

// --------------------------------------------------------------------------
// SQLite durability
// --------------------------------------------------------------------------

describe('R4c.2b SQLite durability', () => {
  it('rejects replay when the stored event Run revision disagrees with the committed receipt', async () => {
    const h = await setup('sqlite');
    const pin = await runPin(h.fixture, h.claim.runRef);
    const request = historyRequest(pin, h.claim.runRef, h.kernel,
      { requestId: 'history-corrupt-replay-revision', observedThroughPosition: 4 });
    const first = await h.service.recordExecutionHistory(h.fixture.ctx, request);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    expect(first.value.runRevision).toBe(pin.revision + 1);

    const database = new DatabaseSync(h.fixture.ledgerPath);
    try {
      // Keep the event identity, fingerprint, locator and real receipt intact.
      // The changed field still passes shape validation: cross-record replay
      // consistency must reject it instead of reporting revision 999.
      const receiptBefore = database.prepare('SELECT * FROM idempotency ORDER BY identity_key').all();
      const changed = database.prepare(
        "UPDATE events SET event_json = json_set(event_json, '$.recorded.runRevision', ?) WHERE id = ?",
      ).run(999, seqOfCommitCursor(first.cursor));
      expect(Number(changed.changes)).toBe(1);
      expect(database.prepare('SELECT * FROM idempotency ORDER BY identity_key').all()).toEqual(receiptBefore);
      expect((await readRun(h.fixture, h.claim.runRef)).revision).toBe(first.value.runRevision);

      const replay = await h.service.recordExecutionHistory(h.fixture.ctx, request);
      expect(replay).toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { database.close(); }
  });

  it('rolls back records, events, binding and receipt when storage fails at receipt insertion', async () => {
    const h = await setup('sqlite');
    const database = new DatabaseSync(h.fixture.ledgerPath);
    try {
      const counts = () => ['snapshots', 'events', 'identity_claims', 'idempotency'].map(table =>
        database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!['n']);
      const beforeCounts = counts();
      const beforeRun = await readRun(h.fixture, h.claim.runRef);
      const request = historyRequest(await runPin(h.fixture, h.claim.runRef), h.claim.runRef, h.kernel,
        { requestId: 'history-storage-fault', observedThroughPosition: 4 });
      database.exec("CREATE TRIGGER fail_history_receipt BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'history receipt write failure'); END");
      const failed = await h.service.recordExecutionHistory(h.fixture.ctx, request);
      expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(counts()).toEqual(beforeCounts);
      expect(await readRun(h.fixture, h.claim.runRef)).toEqual(beforeRun);
      database.exec('DROP TRIGGER fail_history_receipt');
      expect(await h.service.recordExecutionHistory(h.fixture.ctx, request))
        .toMatchObject({ status: 'committed', replayed: false });
    } finally { database.close(); }
  });

  it('preserves the locator and the replay event across a reopen', async () => {
    const fixture = await createTaskClaimFixture('sqlite');
    fixtures.push(fixture);
    const claim = await claimed(fixture);
    const mapping = await sessionKernel(fixture, claim.sessionRef);
    const kernel: KernelIdentity = { adapterId: mapping.adapterId, kernelSessionId: mapping.kernelSessionId,
      runId: KERNEL_RUN_ID, turnId: KERNEL_TURN_ID };
    const pin = await runPin(fixture, claim.runRef);
    const original = historyRequest(pin, claim.runRef, kernel,
      { requestId: 'history-sqlite', observedThroughPosition: 4 });
    const first = await serviceFor(fixture).recordExecutionHistory(fixture.ctx, original);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;

    await fixture.closeBackend();
    const reopened = await fixture.reopenService();
    connections.push(reopened);

    const read = await createRunStateReader({ records: reopened.records })
      .readExecution(fixture.ctx, claim.runRef);
    expect(read).toMatchObject({ status: 'ready' });
    if (read.status === 'ready') expect(read.value.run.executionHistory).toEqual(first.value.history);

    const replay = await serviceFor(fixture, reopened.records).recordExecutionHistory(fixture.ctx, original);
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    if (replay.status === 'committed') expect(replay.value.history).toEqual(first.value.history);
  });
});
