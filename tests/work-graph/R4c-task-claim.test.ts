/**
 * R4c.1 behavior acceptance for the atomic Task claim skeleton.
 *
 * Every case drives the formal `TaskClaimPort` over the real Memory/SQLite
 * backends built by `createTaskClaimFixture`. No service result is mocked; the
 * suite is expected to be RED while the production algorithm is absent and is
 * frozen as the behavior contract for the implementation phase.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { encodeProjectSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { TASK_ATTEMPT_SCHEMA_ID, TASK_CLAIM_OUTBOX_SCHEMA_ID } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import type { ClaimTaskInput, TaskClaim } from '../../src/core/work-graph/tasks/claim-contracts.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import { CLAIM_FIXTURE_EXPIRED_DEADLINE, createTaskClaimFixture,
  type ClaimFixtureKind, type Records, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;
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

const key = (ref: object) => canonicalJson(ref as unknown as JsonValue);
const leaseKey = (task: TaskTriple) => key({ aggregateType: 'TaskLease', ...task });
const reductionKey = (task: TaskTriple) => key({ aggregateType: 'TaskReduction', ...task });
const parsed = (record: { json: string } | undefined): unknown =>
  record === undefined ? null : JSON.parse(record.json) as unknown;

/** Both services must finish their reads and reach their real Store commit
 * before either can publish. This exposes stale-guard races rather than just
 * exercising a second request after the first one is already visible. */
function commitBarrier(targets: readonly Records[]): {
  records: Records[]; prepared: (PreparedCommit | undefined)[];
} {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const prepared: (PreparedCommit | undefined)[] = targets.map(() => undefined);
  let arrivals = 0;
  const records = targets.map((target, index): Records => ({
    ...target,
    async commit(input) {
      expect(prepared[index], 'one ownership admission must issue one atomic commit').toBeUndefined();
      prepared[index] = structuredClone(input);
      arrivals += 1;
      if (arrivals === targets.length) release();
      await ready;
      return target.commit(input);
    },
  }));
  return { records, prepared };
}

async function expectAtomicRaceLoser(
  fixture: TaskClaimFixture,
  submitted: readonly (PreparedCommit | undefined)[],
  results: readonly WriteResult<TaskClaim>[],
): Promise<{ winner: TaskClaim; loserIndex: number }> {
  expect(submitted.filter(Boolean)).toHaveLength(2);
  expect(results.filter(result => result.status === 'committed')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  const winnerResult = results.find(result => result.status === 'committed');
  const loserIndex = results.findIndex(result => result.status === 'rejected');
  expect(results[loserIndex]).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  if (winnerResult?.status !== 'committed' || loserIndex < 0) throw new Error('the atomic race has no winner/loser');
  const loser = submitted[loserIndex];
  if (loser === undefined) throw new Error('the losing contender never reached the commit boundary');
  const orphanTypes = new Set(['Run', 'TaskAttempt', 'DispatchOutboxEntry']);
  const loserKeys = loser.records.filter(record =>
    orphanTypes.has((JSON.parse(record.refKey) as { aggregateType: string }).aggregateType))
    .map(record => record.refKey).sort();
  expect(loserKeys).toHaveLength(3);
  const orphanRead = await fixture.records.readMany(loserKeys);
  expect(orphanRead).toMatchObject({ status: 'ready', value: { records: [], missing: loserKeys } });
  const winner = winnerResult.value;
  const leaseRead = await fixture.records.readMany([leaseKey(winner.task)]);
  expect(leaseRead.status).toBe('ready');
  if (leaseRead.status === 'ready') {
    expect(parsed(leaseRead.value.records[0])).toMatchObject({ holderRunId: winner.runRef.runId,
      attemptId: winner.attemptRef.attemptId });
  }
  return { winner, loserIndex };
}

describe.each(KINDS)('R4c.1 real %s atomic claim', kind => {
  it('commits one lease/attempt/run/outbox/session set atomically and restores it on read', async () => {
    const fixture = await open(kind);
    const request = await fixture.buildRequest();
    const result = await fixture.service.claimTask(fixture.ctx, request);
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') return;
    const claim = result.value;
    expect(claim.task).toEqual(fixture.tasks.first);
    expect(claim.planRef).toEqual(fixture.planRef);
    expect(claim.workspaceId).toBe(fixture.scope.workspaceId);
    expect(claim.sessionRef).toEqual(fixture.sessions.first);
    // The Session revision before the claim is 1; generation is the NEW revision.
    expect(claim.generation).toBe(2);
    expect(claim.sessionRevision).toBe(2);
    expect(claim.attemptRef).toMatchObject({ aggregateType: 'TaskAttempt', attemptId: claim.outboxRef.attemptId });

    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(claim.sessionRef));
    const refKeys = [leaseKey(claim.task), key(claim.attemptRef), key(claim.runRef), key(claim.outboxRef), sessionKey];
    const read = await fixture.records.readMany(refKeys);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.missing).toEqual([]);
    const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
    expect(byKey.get(key(claim.attemptRef))?.schemaId).toBe(TASK_ATTEMPT_SCHEMA_ID);
    expect(byKey.get(key(claim.outboxRef))?.schemaId).toBe(TASK_CLAIM_OUTBOX_SCHEMA_ID);
    expect(parsed(byKey.get(key(claim.outboxRef)))).toMatchObject({ status: 'pending', schemaVersion: 1,
      claim: { runRef: claim.runRef, attemptRef: claim.attemptRef, claimedAt: claim.claimedAt } });
    expect(parsed(byKey.get(key(claim.runRef)))).toMatchObject({ status: 'starting', outcome: null,
      startedAt: null, endedAt: null, lastEventSeq: 0 });
    expect(parsed(byKey.get(sessionKey))).toMatchObject({ revision: 2,
      occupancy: { kind: 'execution', generation: 2 },
      lastExecutionRef: { aggregateType: 'Run', runId: claim.runRef.runId } });

    const restored = await fixture.service.readTaskClaim(fixture.ctx, claim.outboxRef);
    expect(restored).toMatchObject({ status: 'ready', value: { outboxRef: claim.outboxRef,
      runRef: claim.runRef, task: claim.task, claimedAt: claim.claimedAt } });
    expect(await fixture.service.readTaskClaim({ ...fixture.ctx, projectId: 'other-project' }, claim.outboxRef))
      .toMatchObject({ status: 'rejected' });

    // Directed reads only: no whole-Goal Run scan and no material read.
    expect(fixture.spy.lookups.some(entry => entry.index === 'r3c-run-by-goal')).toBe(false);
    expect(fixture.materialsSpy.openArtifactCalls).toBe(0);
  });

  it('claims a Task whose predecessor is unfinished without reading predecessor facts', async () => {
    const fixture = await open(kind);
    const request = await fixture.buildRequest({ input: { taskId: fixture.tasks.second.taskId } });
    const result = await fixture.service.claimTask(fixture.ctx, request);
    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') return;
    expect(result.value.task).toEqual(fixture.tasks.second);
    const predecessorKeys = new Set([leaseKey(fixture.tasks.first), reductionKey(fixture.tasks.first)]);
    expect(fixture.spy.readMany.some(keys => keys.some(candidate => predecessorKeys.has(candidate)))).toBe(false);
    expect(fixture.spy.lookups.some(entry => entry.index === 'r3c-run-by-goal')).toBe(false);
  });

  it('replays the original claim and reports idempotency_conflict for different content', async () => {
    const fixture = await open(kind);
    const request = await fixture.buildRequest({ requestId: 'stable-replay' });
    const first = await fixture.service.claimTask(fixture.ctx, request);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    expect(await fixture.service.claimTask(fixture.ctx, request)).toMatchObject({ status: 'committed',
      replayed: true, value: { outboxRef: first.value.outboxRef, runRef: first.value.runRef,
        claimedAt: first.value.claimedAt, generation: first.value.generation } });
    const changed: GraphWrite<ClaimTaskInput> = { input: { ...request.input, taskId: fixture.tasks.second.taskId },
      meta: { ...request.meta } };
    expect(await fixture.service.claimTask(fixture.ctx, changed))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    // A replay or a conflict never takes a second occupancy.
    expect(fixture.spy.commits).toBe(1);
  });

  it('rejects stale/cross-scope/role/budget pins with zero records written', async () => {
    const fixture = await open(kind);
    const base = await fixture.buildRequest();
    let sequence = 0;
    const clone = (): GraphWrite<ClaimTaskInput> => ({ input: { ...base.input },
      meta: { requestId: `reject-${++sequence}`, expected: [...base.meta.expected] } });
    const unrelatedPlan: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: fixture.scope.projectId,
      planId: 'never-accepted' };
    const cases: { name: string; ctx: CoreCallContext; request: GraphWrite<ClaimTaskInput> }[] = [
      { name: 'plan-not-current', ctx: fixture.ctx,
        request: (() => { const request = clone(); request.input.planRef = unrelatedPlan; return request; })() },
      { name: 'task-not-in-plan', ctx: fixture.ctx,
        request: (() => { const request = clone(); request.input.taskId = 'not-in-plan'; return request; })() },
      { name: 'goal-pin-stale', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.meta = { ...request.meta, expected: [{ ref: fixture.goalRef, revision: 999 },
            ...request.meta.expected.slice(1)] }; return request; })() },
      { name: 'extra-pin', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.meta = { ...request.meta, expected: [...request.meta.expected,
            { ref: fixture.goalRef, revision: 1 }] }; return request; })() },
      { name: 'duplicate-pin', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.meta = { ...request.meta, expected: [...request.meta.expected,
            { ...request.meta.expected[0]! }] }; return request; })() },
      { name: 'cross-scope-pin', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.meta = { ...request.meta, expected: [{ ref: { aggregateType: 'Goal' as const,
            projectId: 'other-project', goalId: fixture.goalRef.goalId }, revision: 1 },
            ...request.meta.expected.slice(1)] }; return request; })() },
      { name: 'session-pin-stale', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.meta = { ...request.meta, expected: [...request.meta.expected.slice(0, 2),
            { ref: plainSessionRefToAggregate(fixture.sessions.first), revision: 0 }] }; return request; })() },
      { name: 'session-pin-missing', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.meta = { ...request.meta, expected: [...request.meta.expected.slice(0, 2)] }; return request; })() },
      { name: 'role-id-mismatch', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.input.roleBinding = { ...fixture.roleBinding, templateId: 'unassigned-role' }; return request; })() },
      { name: 'role-revision-mismatch', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.input.roleBinding = { ...fixture.roleBinding, templateRevision: '9' }; return request; })() },
      { name: 'budget-zero', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.input.budget = { ...fixture.budget, tokenBudget: 0 }; return request; })() },
      { name: 'budget-fractional', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.input.budget = { ...fixture.budget, tokenBudget: 1.5 }; return request; })() },
      { name: 'budget-expired', ctx: fixture.ctx,
        request: (() => { const request = clone();
          request.input.budget = { ...fixture.budget, deadline: CLAIM_FIXTURE_EXPIRED_DEADLINE }; return request; })() },
      { name: 'cross-project-ctx', ctx: { ...fixture.ctx, projectId: 'other-project' }, request: clone() },
    ];
    for (const scenario of cases) {
      const outcome = await fixture.service.claimTask(scenario.ctx, scenario.request);
      expect(outcome, scenario.name).toMatchObject({ status: 'rejected' });
      // A blanket `unsupported` skeleton is not a real rejection.
      if (outcome.status === 'rejected') expect(outcome.code, scenario.name).not.toBe('unsupported');
    }
    expect(fixture.spy.commits).toBe(0);
    expect(await fixture.records.readMany([leaseKey(fixture.tasks.first)]))
      .toMatchObject({ status: 'ready', value: { missing: [leaseKey(fixture.tasks.first)] } });
  });

  it('independently rejects archived, unhealthy, execution-busy and maintenance-busy Sessions', async () => {
    const fixture = await open(kind);
    const mutations: { name: string; mutate: (record: SessionRecord) => SessionRecord }[] = [
      { name: 'archived', mutate: record => ({ ...record, lifecycle: 'archived' }) },
      { name: 'unavailable', mutate: record => ({ ...record, health: 'unavailable' }) },
      { name: 'recoverable', mutate: record => ({ ...record, health: 'recoverable' }) },
      { name: 'run-busy', mutate: record => ({ ...record, occupancy: { kind: 'execution', generation: 1,
        executionRef: { aggregateType: 'Run', projectId: fixture.scope.projectId,
          goalId: fixture.goalRef.goalId, runId: 'foreign-run' } } }) },
      { name: 'query-busy', mutate: record => ({ ...record, occupancy: { kind: 'execution', generation: 1,
        executionRef: { aggregateType: 'QueryRun', projectId: fixture.scope.projectId,
          workspaceId: fixture.scope.workspaceId, queryJobId: 'active-query-job', runId: 'active-query-run' } } }) },
      { name: 'maintenance-busy', mutate: record => ({ ...record, occupancy: { kind: 'maintenance', generation: 1,
        operationRef: { aggregateType: 'CoreOperation', projectId: fixture.scope.projectId,
          operationId: 'active-maintenance' } } }) },
    ];
    for (const scenario of mutations) {
      // A fresh active/available Session prevents an earlier rejection condition
      // from hiding a missing check in a later case.
      const sessionRef = await fixture.createSession(`lifecycle-${scenario.name}`);
      await fixture.overwriteSession(sessionRef, scenario.mutate);
      const request = await fixture.buildRequest({ input: { sessionRef } });
      const outcome = await fixture.service.claimTask(fixture.ctx, request);
      expect(outcome, scenario.name).toMatchObject({ status: 'rejected' });
      if (outcome.status === 'rejected') expect(outcome.code, scenario.name).not.toBe('unsupported');
    }
    expect(fixture.spy.commits).toBe(0);
  });

  it('does not treat an ended Run without a lease as a fresh pending Task', async () => {
    const fixture = await open(kind);
    await fixture.seedRun(fixture.tasks.first.taskId, 'ended');
    const result = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
    expect(result).toMatchObject({ status: 'rejected' });
    if (result.status === 'rejected') expect(result.code).not.toBe('unsupported');
    expect(fixture.spy.commits).toBe(0);
  });

  it('writes nothing when the bound call signal is already aborted', async () => {
    const fixture = await open(kind);
    const controller = new AbortController();
    controller.abort();
    const request = await fixture.buildRequest();
    const result = await fixture.service.claimTask({ ...fixture.ctx, signal: controller.signal }, request);
    expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(fixture.spy.commits).toBe(0);
    expect(await fixture.records.readMany([leaseKey(fixture.tasks.first)]))
      .toMatchObject({ status: 'ready', value: { missing: [leaseKey(fixture.tasks.first)] } });
  });

  it('binds the request and context before the first await', async () => {
    const fixture = await open(kind);
    const request = await fixture.buildRequest({ requestId: 'mutation-guard' });
    const pending = fixture.service.claimTask(fixture.ctx, request);
    request.meta.requestId = 'changed-after-call';
    request.input.taskId = fixture.tasks.second.taskId;
    request.input.sessionRef = fixture.sessions.second;
    (fixture.ctx as { projectId: string }).projectId = 'changed-project';
    const result = await pending;
    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') return;
    expect(result.value.task).toEqual(fixture.tasks.first);
    expect(result.value.sessionRef).toEqual(fixture.sessions.first);
  });

  it('keeps a claim valid when an unrelated commit lands after all claim reads', async () => {
    const fixture = await open(kind);
    const request = await fixture.buildRequest();
    let reachedCommit = false;
    const service = fixture.makeService({
      ...fixture.records,
      async commit(prepared) {
        expect(reachedCommit).toBe(false);
        reachedCommit = true;
        const unrelated = await fixture.commitRaw([encodeProjectSnapshot({
          ref: { aggregateType: 'Project', projectId: 'unrelated-project' }, revision: 1 })]);
        expect(unrelated).toMatchObject({ status: 'committed' });
        return fixture.records.commit(prepared);
      },
    });
    expect(await service.claimTask(fixture.ctx, request)).toMatchObject({ status: 'committed' });
    expect(reachedCommit).toBe(true);
  });
});

describe('R4c.1 real SQLite races and durability', () => {
  it('lets only one of two connections claim the same Task through different Sessions', async () => {
    const fixture = await createTaskClaimFixture('sqlite');
    fixtures.push(fixture);
    const second = await fixture.openConnection();
    connections.push(second);
    const first = await fixture.buildRequest({ input: { sessionRef: fixture.sessions.first } });
    const other = await fixture.buildRequest({ input: { sessionRef: fixture.sessions.second } });
    const barrier = commitBarrier([fixture.records, second.records]);
    const services = barrier.records.map(records => fixture.makeService(records));
    const results = await Promise.all([
      services[0]!.claimTask(fixture.ctx, first),
      services[1]!.claimTask(fixture.ctx, other),
    ]);
    const { loserIndex } = await expectAtomicRaceLoser(fixture, barrier.prepared, results);
    const loserSession = [first.input.sessionRef, other.input.sessionRef][loserIndex]!;
    const unchanged = await fixture.sessionsPort.readSession(fixture.ctx, loserSession);
    expect(unchanged).toMatchObject({ status: 'ready', value: { record: {
      revision: 1, occupancy: null, lastExecutionRef: null,
    } } });
  });

  it('lets only one of two connections claim two Tasks through the same Session', async () => {
    const fixture = await createTaskClaimFixture('sqlite');
    fixtures.push(fixture);
    const second = await fixture.openConnection();
    connections.push(second);
    const first = await fixture.buildRequest({ input: { taskId: fixture.tasks.first.taskId,
      sessionRef: fixture.sessions.first } });
    const other = await fixture.buildRequest({ input: { taskId: fixture.tasks.second.taskId,
      sessionRef: fixture.sessions.first } });
    const barrier = commitBarrier([fixture.records, second.records]);
    const services = barrier.records.map(records => fixture.makeService(records));
    const results = await Promise.all([
      services[0]!.claimTask(fixture.ctx, first),
      services[1]!.claimTask(fixture.ctx, other),
    ]);
    const { winner, loserIndex } = await expectAtomicRaceLoser(fixture, barrier.prepared, results);
    const loserTask = [fixture.tasks.first, fixture.tasks.second][loserIndex]!;
    expect(await fixture.records.readMany([leaseKey(loserTask)]))
      .toMatchObject({ status: 'ready', value: { records: [], missing: [leaseKey(loserTask)] } });
    expect(await fixture.sessionsPort.readSession(fixture.ctx, fixture.sessions.first))
      .toMatchObject({ status: 'ready', value: { record: { revision: 2,
        occupancy: { kind: 'execution', executionRef: winner.runRef, generation: 2 } } } });
  });

  it('lets two connections claim different Tasks through different Sessions', async () => {
    const fixture = await createTaskClaimFixture('sqlite');
    fixtures.push(fixture);
    const second = await fixture.openConnection();
    connections.push(second);
    const first = await fixture.buildRequest({ input: { taskId: fixture.tasks.first.taskId,
      sessionRef: fixture.sessions.first } });
    const other = await fixture.buildRequest({ input: { taskId: fixture.tasks.second.taskId,
      sessionRef: fixture.sessions.second } });
    const barrier = commitBarrier([fixture.records, second.records]);
    const services = barrier.records.map(records => fixture.makeService(records));
    const results = await Promise.all([
      services[0]!.claimTask(fixture.ctx, first),
      services[1]!.claimTask(fixture.ctx, other),
    ]);
    expect(barrier.prepared.filter(Boolean)).toHaveLength(2);
    expect(results.map(result => result.status)).toEqual(['committed', 'committed']);
  });

  it('replays the original claim after reopening the same SQLite ledger', async () => {
    const fixture = await createTaskClaimFixture('sqlite');
    fixtures.push(fixture);
    const request = await fixture.buildRequest({ requestId: 'durable-replay' });
    const first = await fixture.service.claimTask(fixture.ctx, request);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    await fixture.closeBackend();
    const reopened = await fixture.reopenService();
    connections.push(reopened);
    expect(await reopened.service.claimTask(fixture.ctx, request)).toMatchObject({ status: 'committed',
      replayed: true, value: { outboxRef: first.value.outboxRef, claimedAt: first.value.claimedAt } });
  });
});
