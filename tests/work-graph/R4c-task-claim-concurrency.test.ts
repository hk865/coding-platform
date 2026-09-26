/** Independent review: same service instance concurrency and Store replay race. */
import { expect, it } from 'vitest';
import { createTaskClaimFixture, CLAIM_FIXTURE_AT } from '../helpers/task-claim-fixture.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';

it.each(['memory', 'sqlite'] as const)('%s: simultaneous identical requests return the first committed claim', async kind => {
  const f = await createTaskClaimFixture(kind);
  try {
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const commits: PreparedCommit[] = [];
    const service = f.makeService({ ...f.records, async commit(batch) {
      commits.push(structuredClone(batch)); if (commits.length === 2) release();
      await barrier; return f.records.commit(batch);
    } });
    const request = await f.buildRequest({ requestId: 'concurrent-same-request' });
    const outcomes = await Promise.all([service.claimTask(f.ctx, request), service.claimTask(f.ctx, request)]);
    expect(commits).toHaveLength(2);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['committed', 'committed']);
    const [a, b] = outcomes;
    if (a?.status !== 'committed' || b?.status !== 'committed') throw Error('same request was not replayed');
    expect(a.value).toEqual(b.value); expect(a.cursor).toBe(b.cursor);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const lost = commits.find(batch => batch.records.some(record => {
      const ref = JSON.parse(record.refKey); return ref.aggregateType === 'Run' && ref.runId !== a.value.runRef.runId;
    }));
    expect(lost).toBeDefined();
    const unpublished = lost!.records.filter(record =>
      ['Run', 'TaskAttempt', 'DispatchOutboxEntry'].includes(JSON.parse(record.refKey).aggregateType));
    expect(unpublished).toHaveLength(3);
    expect(await f.records.readMany(unpublished.map(record => record.refKey)))
      .toMatchObject({ status: 'ready', value: { records: [] } });
  } finally { await f.close(); }
});

it('one role resolver keeps concurrent projects read guards request-local', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    let arrivals = 0;
    const roles = createRoleConfigurationService({ records: { ...f.records, async readMany(keys) {
      const batch = await f.records.readMany(keys); arrivals++;
      if (arrivals === 2) release(); await barrier; return batch;
    } }, now: () => CLAIM_FIXTURE_AT, eventId: () => 'unused-read-event' });
    const other = { ...f.ctx, projectId: 'other-project', materialReader: {
      ...f.ctx.materialReader, projectId: 'other-project',
    } };
    const results = await Promise.all([f.ctx, other].map(ctx => roles.resolveRoleBindingFacts(ctx, {
      roleBinding: f.roleBinding, declaredPermissions: { tools: [], writeScope: [] },
    })));
    for (const [index, result] of results.entries()) {
      expect(result.result).toMatchObject({ status: 'ready', value: { status: 'absent' } });
      expect(result.guards.length).toBeGreaterThan(0);
      expect(new Set(result.guards.map(guard => JSON.parse(guard.refKey).projectId)))
        .toEqual(new Set([index === 0 ? f.scope.projectId : 'other-project']));
    }
  } finally { await f.close(); }
});

it('directed and whole-plan queries share the same current-plan task fold', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    await f.seedRun(f.tasks.first.taskId, 'running');
    const old = await f.seedRun(f.tasks.first.taskId, 'running');
    const { canonicalJson } = await import('../../src/contracts/fingerprint.js');
    const { readCanonicalTaskFacts } = await import('../../src/core/work-graph/tasks/plan-readers.js');
    const key = canonicalJson(old); const read = await f.records.readMany([key]);
    if (read.status !== 'ready') throw Error('Run read failed');
    const row = read.value.records[0]!; const body = JSON.parse(row.json);
    body.planRef = { ...f.planRef, planId: 'older-plan' }; body.revision = 2;
    expect(await f.commitRaw([{ ...row, revision: 2, json: JSON.stringify(body) }],
      [{ refKey: key, expectedRevision: row.revision }])).toMatchObject({ status: 'committed' });
    const whole = await readCanonicalTaskFacts(f.records, f.goalRef, f.plan);
    const directed = await readCanonicalTaskFacts(f.records, f.goalRef, f.plan, f.tasks.first.taskId);
    expect(whole.status).toBe('ready'); expect(directed.status).toBe('ready');
    if (whole.status !== 'ready' || directed.status !== 'ready') throw Error('task facts unavailable');
    expect(directed.value.byTaskId.get(f.tasks.first.taskId))
      .toEqual(whole.value.byTaskId.get(f.tasks.first.taskId));
    expect(directed.value.byTaskId.size).toBe(1);
  } finally { await f.close(); }
});

it('a missing matrix does not allow an unaccounted role pointer to become an absence guard', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const roles = createRoleConfigurationService({ records: { ...f.records, async readMany(keys) {
      const read = await f.records.readMany(keys); if (read.status !== 'ready') return read;
      return { ...read, value: { ...read.value,
        missing: read.value.missing.filter(key => JSON.parse(key).aggregateType !== 'ProjectRoleSpecActive'),
      } };
    } }, now: () => CLAIM_FIXTURE_AT, eventId: () => 'unused-read-event' });
    const facts = await roles.resolveRoleBindingFacts(f.ctx, {
      roleBinding: f.roleBinding, declaredPermissions: { tools: [], writeScope: [] },
    });
    expect(facts.result).toMatchObject({ status: 'rejected', code: 'unavailable' });
  } finally { await f.close(); }
});

it('malformed non-JSON request metadata rejects rather than throwing through the port', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const request = await f.buildRequest();
    Object.assign(request.meta.expected[0]!.ref, { malformed: 1n });
    await expect(f.service.claimTask(f.ctx, request)).resolves.toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(f.spy.commits).toBe(0);
  } finally { await f.close(); }
});

it('replay verifies the returned event cursor against the original receipt', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const request = await f.buildRequest();
    expect(await f.service.claimTask(f.ctx, request)).toMatchObject({ status: 'committed' });
    const { makeCommitCursor, seqOfCommitCursor } = await import('../../src/contracts/ledger.js');
    const service = f.makeService({ ...f.records, async eventAt(cursor) {
      const event = await f.records.eventAt(cursor); if (event.status !== 'ready') return event;
      return { ...event, value: { ...event.value, cursor: makeCommitCursor(seqOfCommitCursor(cursor) + 1) } };
    } });
    expect(await service.claimTask(f.ctx, request)).toMatchObject({ status: 'rejected', code: 'unavailable' });
  } finally { await f.close(); }
});

it('cyclic request/ref values reject at the JSON boundary without escaping the port', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const request = await f.buildRequest();
    const pin = request.meta.expected[0]!.ref; Object.assign(pin, { self: pin });
    await expect(f.service.claimTask(f.ctx, request)).resolves.toMatchObject({ status: 'rejected', code: 'invalid' });
    const ref = { aggregateType: 'DispatchOutboxEntry' as const, projectId: f.scope.projectId,
      goalId: f.tasks.first.goalId, taskId: f.tasks.first.taskId, attemptId: 'never-created' };
    Object.assign(ref, { self: ref });
    await expect(f.service.readTaskClaim(f.ctx, ref)).resolves.toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(f.spy.commits).toBe(0);
  } finally { await f.close(); }
});
