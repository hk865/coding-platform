/**
 * R4c.2a behavior contract for the exact Task execution read.
 *
 * The suite drives ONLY the frozen `ExecutionReadPort` produced by
 * `createRunStateReader` over the REAL Memory/SQLite backends and the REAL
 * formal TaskClaim written by `TaskClaimPort` (frozen in R4c.1). No service
 * result is mocked and no claim bundle is fabricated: the expected records are
 * always the ones the real claim committed.
 *
 * The skeleton genuinely returns `unsupported`, so the `ready`/domain outcome
 * cases are RED here and frozen for the separate implementation phase.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import { encodeProjectSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import {
  plainSessionRefToAggregate,
  sessionAggregateRefKey,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { TaskClaim } from '../../src/core/work-graph/tasks/claim-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
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
// Canonical keys, spies and controlled store boundary
// --------------------------------------------------------------------------

const key = (ref: object): string => canonicalJson(ref as unknown as JsonValue);
const leaseKeyOf = (task: TaskTriple): string => key({ aggregateType: 'TaskLease', ...task });
const sessionKeyOf = (ref: { projectId: string; sessionId: string }): string =>
  sessionAggregateRefKey(plainSessionRefToAggregate(ref));
const aggregateTypeOf = (refKey: string): string | undefined =>
  (JSON.parse(refKey) as { aggregateType?: string }).aggregateType;

async function claimed(fixture: TaskClaimFixture, requestId = 'exec-read-claim'): Promise<TaskClaim> {
  const result = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({ requestId }));
  expect(result).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') throw new Error('fixture claim failed');
  return result.value;
}

function hostActorOf(fixture: TaskClaimFixture): { kind: 'human' | 'system'; id: string } {
  if (fixture.ctx.materialReader.kind === 'host') {
    const actor = fixture.ctx.materialReader.actor;
    return { kind: actor.kind, id: actor.id };
  }
  return { kind: 'human', id: 'exec-read-operator' };
}

type ReadSpy = { readMany: string[][]; lookup: number; lookupCommit: number; commit: number; eventAt: number };

function countingReader(target: Records): { records: Records; spy: ReadSpy } {
  const spy: ReadSpy = { readMany: [], lookup: 0, lookupCommit: 0, commit: 0, eventAt: 0 };
  const records: Records = {
    ...target,
    readMany(refKeys) { spy.readMany.push([...refKeys]); return target.readMany(refKeys); },
    lookup(request) { spy.lookup += 1; return target.lookup(request); },
    lookupCommit(input) { spy.lookupCommit += 1; return target.lookupCommit(input); },
    commit(input) { spy.commit += 1; return target.commit(input); },
    eventAt(cursor) { spy.eventAt += 1; return target.eventAt(cursor); },
  };
  return { records, spy };
}

type Batch = { records: EncodedRecord[]; missing: string[] };

function overrideReader(target: Records, override: (batch: Batch) => Batch): Records {
  return {
    ...target,
    async readMany(refKeys) {
      const read = await target.readMany(refKeys);
      if (read.status !== 'ready') return read;
      const next = override({ records: read.value.records, missing: read.value.missing });
      return { status: 'ready', value: { ...read.value, records: next.records, missing: next.missing } };
    },
  };
}

function dropRecords(target: Records, drop: (refKey: string) => boolean): Records {
  return overrideReader(target, batch => {
    const records: EncodedRecord[] = [];
    const missing = [...batch.missing];
    for (const record of batch.records) {
      if (drop(record.refKey)) missing.push(record.refKey);
      else records.push(record);
    }
    return { records, missing };
  });
}

function mutateRecord(
  target: Records,
  match: (refKey: string) => boolean,
  mutate: (body: Record<string, unknown>) => void,
): Records {
  return overrideReader(target, batch => ({
    records: batch.records.map(record => {
      if (!match(record.refKey)) return record;
      const body = JSON.parse(record.json) as Record<string, unknown>;
      mutate(body);
      return { ...record, json: JSON.stringify(body) };
    }),
    missing: batch.missing,
  }));
}

function corruptRecord(target: Records, match: (refKey: string) => boolean): Records {
  return overrideReader(target, batch => ({
    records: batch.records.map(record => (match(record.refKey) ? { ...record, json: '{"broken":' } : record)),
    missing: batch.missing,
  }));
}

// --------------------------------------------------------------------------
// Real Memory/SQLite behavior
// --------------------------------------------------------------------------

const KINDS = ['memory', 'sqlite'] as const;

describe.each(KINDS)('R4c.2a real %s execution read', kind => {
  it('reads the exact claimed set and cross-checks every reference', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const result = await createRunStateReader({ records: fixture.records }).readExecution(fixture.ctx, claim.runRef);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    const record = result.value;
    expect(record.run.ref).toEqual(claim.runRef);
    expect(record.run.task).toEqual(claim.task);
    expect(record.run.attemptId).toBe(claim.attemptRef.attemptId);
    expect(record.attempt.ref).toEqual(claim.attemptRef);
    expect(record.attempt.runId).toBe(claim.runRef.runId);
    expect(record.attempt.planRef).toEqual(claim.planRef);
    expect(record.outbox.ref).toEqual(claim.outboxRef);
    expect(record.outbox.claim).toMatchObject({
      task: claim.task,
      planRef: claim.planRef,
      workspaceId: fixture.scope.workspaceId,
      sessionRef: claim.sessionRef,
      runRef: claim.runRef,
      attemptRef: claim.attemptRef,
      outboxRef: claim.outboxRef,
    });
    expect(record.plan.ref).toEqual(claim.planRef);
    expect(record.plan.tasks.some(task => task.taskId === claim.task.taskId)).toBe(true);
    expect(record.session.ref).toMatchObject({ projectId: fixture.scope.projectId, sessionId: claim.sessionRef.sessionId });
    expect(record.session.workspaceId).toBe(fixture.scope.workspaceId);
    expect(record.lease).not.toBeNull();
    expect(record.lease?.ref).toEqual({ aggregateType: 'TaskLease', ...claim.task });
    expect(record.readThrough).not.toBeNull();
  });

  it('re-reads the six linked records in one final readMany window', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const { records, spy } = countingReader(fixture.records);
    const result = await createRunStateReader({ records }).readExecution(fixture.ctx, claim.runRef);
    expect(result).toMatchObject({ status: 'ready' });
    const expected = new Set([
      key(claim.runRef), key(claim.attemptRef), key(claim.outboxRef),
      key(claim.planRef), leaseKeyOf(claim.task), sessionKeyOf(claim.sessionRef),
    ]);
    const finalKeys = spy.readMany[spy.readMany.length - 1] ?? [];
    expect(new Set(finalKeys)).toEqual(expected);
  });

  it('returns current Session and Lease facts even when ownership has moved on', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    await fixture.overwriteSession(claim.sessionRef, record => ({
      ...record, lifecycle: 'archived', health: 'unavailable', occupancy: null, lastExecutionRef: null,
    }));
    const leaseRefKey = leaseKeyOf(claim.task);
    const leaseRead = await fixture.records.readMany([leaseRefKey]);
    expect(leaseRead.status).toBe('ready');
    if (leaseRead.status !== 'ready') return;
    const leaseRecord = leaseRead.value.records.find(record => record.refKey === leaseRefKey);
    expect(leaseRecord).toBeDefined();
    if (leaseRecord === undefined) return;
    const leaseBody = JSON.parse(leaseRecord.json) as Record<string, unknown>;
    leaseBody['revision'] = 2;
    leaseBody['holderRunId'] = 'a-different-holder';
    leaseBody['attemptId'] = 'a-different-attempt';
    expect(await fixture.commitRaw([{ ...leaseRecord, revision: 2, json: JSON.stringify(leaseBody) }],
      [{ refKey: leaseRefKey, expectedRevision: leaseRecord.revision }])).toMatchObject({ status: 'committed' });

    const result = await createRunStateReader({ records: fixture.records }).readExecution(fixture.ctx, claim.runRef);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.session).toMatchObject({ lifecycle: 'archived', health: 'unavailable', occupancy: null });
    expect(result.value.session.ref).toMatchObject({ sessionId: claim.sessionRef.sessionId });
    expect(result.value.lease).toMatchObject({ holderRunId: 'a-different-holder', attemptId: 'a-different-attempt' });
  });

  it('reads successfully when the current Lease is absent', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const records = dropRecords(fixture.records, refKey => refKey === leaseKeyOf(claim.task));
    const result = await createRunStateReader({ records }).readExecution(fixture.ctx, claim.runRef);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.lease).toBeNull();
  });

  it('reports incomplete, never a fabricated null Session, for an unmapped Run', async () => {
    const fixture = await open(kind);
    const runRef = await fixture.seedRun(fixture.tasks.first.taskId, 'running');
    const result = await createRunStateReader({ records: fixture.records }).readExecution(fixture.ctx, runRef);
    expect(result).toMatchObject({ status: 'rejected', code: 'incomplete' });
  });

  it('reports incomplete when a claim-linked record is missing', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const scenarios: { name: string; drop: (refKey: string) => boolean }[] = [
      { name: 'Attempt', drop: refKey => refKey === key(claim.attemptRef) },
      { name: 'outbox', drop: refKey => refKey === key(claim.outboxRef) },
      { name: 'Plan', drop: refKey => refKey === key(claim.planRef) },
      { name: 'Session', drop: refKey => refKey === sessionKeyOf(claim.sessionRef) },
    ];
    for (const scenario of scenarios) {
      const records = dropRecords(fixture.records, scenario.drop);
      const result = await createRunStateReader({ records }).readExecution(fixture.ctx, claim.runRef);
      expect(result, scenario.name).toMatchObject({ status: 'rejected', code: 'incomplete' });
    }
  });

  it('reports unavailable for damaged records and inconsistent cross-links', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const runKey = key(claim.runRef);
    const attemptKey = key(claim.attemptRef);
    const outboxKey = key(claim.outboxRef);
    const planKey = key(claim.planRef);
    const sessionKey = sessionKeyOf(claim.sessionRef);
    const scenarios: { name: string; records: Records }[] = [
      { name: 'damaged Run', records: corruptRecord(fixture.records, refKey => refKey === runKey) },
      { name: 'damaged Attempt', records: corruptRecord(fixture.records, refKey => refKey === attemptKey) },
      { name: 'damaged outbox', records: corruptRecord(fixture.records, refKey => refKey === outboxKey) },
      { name: 'outbox points at another Run', records: mutateRecord(fixture.records, refKey => refKey === outboxKey, body => {
        (body['claim'] as { runRef: { runId: string } }).runRef.runId = 'another-run';
      }) },
      { name: 'Run workspace disagrees', records: mutateRecord(fixture.records, refKey => refKey === runKey, body => {
        (body['workspaceSnapshot'] as { workspaceId: string }).workspaceId = 'another-workspace';
      }) },
      { name: 'Plan omits the Task', records: mutateRecord(fixture.records, refKey => refKey === planKey, body => {
        body['tasks'] = (body['tasks'] as { taskId: string }[]).filter(task => task.taskId !== claim.task.taskId);
      }) },
      { name: 'Session workspace disagrees', records: mutateRecord(fixture.records, refKey => refKey === sessionKey, body => {
        body['workspaceId'] = 'another-workspace';
      }) },
    ];
    for (const scenario of scenarios) {
      const result = await createRunStateReader({ records: scenario.records }).readExecution(fixture.ctx, claim.runRef);
      expect(result, scenario.name).toMatchObject({ status: 'rejected', code: 'unavailable' });
    }
  });

  it('returns not_found for a missing Run but honours atLeastCursor first', async () => {
    const fixture = await open(kind);
    const claimResult = await fixture.service.claimTask(fixture.ctx,
      await fixture.buildRequest({ requestId: 'read-missing-run' }));
    expect(claimResult).toMatchObject({ status: 'committed' });
    if (claimResult.status !== 'committed') return;
    const reader = createRunStateReader({ records: fixture.records });
    const missing: RunRef = { aggregateType: 'Run', projectId: fixture.scope.projectId,
      goalId: fixture.goalRef.goalId, runId: 'never-created' };
    expect(await reader.readExecution(fixture.ctx, missing)).toEqual({ status: 'not_found' });
    const future = makeCommitCursor(seqOfCommitCursor(claimResult.cursor) + 25);
    expect(await reader.readExecution(fixture.ctx, missing, { atLeastCursor: future }))
      .toMatchObject({ status: 'not_ready', required: { kind: 'platform', cursor: future } });
  });

  it('honours atLeastCursor against the final window watermark', async () => {
    const fixture = await open(kind);
    const claimResult = await fixture.service.claimTask(fixture.ctx,
      await fixture.buildRequest({ requestId: 'read-watermark' }));
    expect(claimResult).toMatchObject({ status: 'committed' });
    if (claimResult.status !== 'committed') return;
    const reader = createRunStateReader({ records: fixture.records });
    expect(await reader.readExecution(fixture.ctx, claimResult.value.runRef, { atLeastCursor: claimResult.cursor }))
      .toMatchObject({ status: 'ready' });
    const future = makeCommitCursor(seqOfCommitCursor(claimResult.cursor) + 25);
    const pending = await reader.readExecution(fixture.ctx, claimResult.value.runRef, { atLeastCursor: future });
    expect(pending).toMatchObject({ status: 'not_ready', required: { kind: 'platform', cursor: future } });
    if (pending.status === 'not_ready') expect(pending.observed).toMatchObject({ kind: 'platform' });
  });

  it('rejects invalid scope and cancellation before any store read', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const { records, spy } = countingReader(fixture.records);
    const reader = createRunStateReader({ records });
    const actor = hostActorOf(fixture);
    const withoutWorkspace = { ...fixture.ctx } as Record<string, unknown>;
    delete withoutWorkspace['workspaceId'];
    const cases: { name: string; ctx: CoreCallContext; ref: RunRef }[] = [
      { name: 'non-host principal',
        ctx: { ...fixture.ctx, principal: { kind: 'system' } } as unknown as CoreCallContext, ref: claim.runRef },
      { name: 'missing workspace', ctx: withoutWorkspace as unknown as CoreCallContext, ref: claim.runRef },
      { name: 'material reader actor mismatch',
        ctx: { ...fixture.ctx, materialReader: { kind: 'host', projectId: fixture.scope.projectId,
          workspaceId: fixture.scope.workspaceId, actor: { ...actor, id: 'other-actor' } } }, ref: claim.runRef },
      { name: 'material reader project mismatch',
        ctx: { ...fixture.ctx, materialReader: { kind: 'host', projectId: 'other-project',
          workspaceId: fixture.scope.workspaceId, actor } }, ref: claim.runRef },
      { name: 'cross-project scope', ctx: { ...fixture.ctx, projectId: 'other-project' }, ref: claim.runRef },
      { name: 'cross-project RunRef', ctx: fixture.ctx,
        ref: { aggregateType: 'Run', projectId: 'other-project', goalId: claim.runRef.goalId, runId: claim.runRef.runId } },
      { name: 'incomplete RunRef', ctx: fixture.ctx, ref: { ...claim.runRef, runId: '' } },
    ];
    for (const scenario of cases) {
      const outcome = await reader.readExecution(scenario.ctx, scenario.ref);
      expect(outcome, scenario.name).toMatchObject({ status: 'rejected' });
      if (outcome.status === 'rejected') expect(outcome.code, scenario.name).not.toBe('unsupported');
    }
    const controller = new AbortController();
    controller.abort();
    expect(await reader.readExecution({ ...fixture.ctx, signal: controller.signal }, claim.runRef))
      .toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(spy.readMany).toHaveLength(0);
    expect(spy.lookup).toBe(0);
    expect(spy.commit).toBe(0);
  });

  it('turns an abort during the read into cancelled', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const controller = new AbortController();
    const records: Records = {
      ...fixture.records,
      async readMany(refKeys) {
        const read = await fixture.records.readMany(refKeys);
        controller.abort();
        return read;
      },
    };
    const result = await createRunStateReader({ records })
      .readExecution({ ...fixture.ctx, signal: controller.signal }, claim.runRef);
    expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
  });

  it('binds ctx and ref before the first await', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let firstKeys: readonly string[] | null = null;
    const records: Records = {
      ...fixture.records,
      async readMany(refKeys) {
        if (firstKeys === null) { firstKeys = [...refKeys]; await blocked; }
        return fixture.records.readMany(refKeys);
      },
    };
    const ctx: CoreCallContext = { ...fixture.ctx, materialReader: { ...fixture.ctx.materialReader } };
    const ref: RunRef = { ...claim.runRef };
    const pending = createRunStateReader({ records }).readExecution(ctx, ref);
    ref.runId = 'mutated-run';
    ctx.projectId = 'mutated-project';
    if (ctx.materialReader.kind === 'host') ctx.materialReader.actor.id = 'mutated-actor';
    release();
    const result = await pending;
    expect(result).toMatchObject({ status: 'ready' });
    expect(firstKeys).toEqual([key(claim.runRef)]);
  });

  it('keeps directed readMany bounded as unrelated Tasks and commits grow, without lookup or event scans', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const readDirected = async () => {
      const { records, spy } = countingReader(fixture.records);
      expect(await createRunStateReader({ records }).readExecution(fixture.ctx, claim.runRef))
        .toMatchObject({ status: 'ready' });
      expect(spy.lookup).toBe(0);
      expect(spy.lookupCommit).toBe(0);
      expect(spy.commit).toBe(0);
      expect(spy.eventAt).toBe(0);
      expect(spy.readMany).toHaveLength(3);
      expect(spy.readMany.map(keys => keys.length)).toEqual([1, 1, 6]);
      for (const refKeys of spy.readMany) {
        expect(refKeys.length).toBeLessThanOrEqual(6);
        for (const refKey of refKeys) {
          expect(['Run', 'TaskAttempt', 'DispatchOutboxEntry', 'PlanRevision', 'Session', 'TaskLease'])
            .toContain(aggregateTypeOf(refKey));
        }
      }
      return spy;
    };
    const before = await readDirected();

    expect(await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({ requestId: 'other-claim',
      input: { taskId: fixture.tasks.second.taskId, sessionRef: fixture.sessions.second } })))
      .toMatchObject({ status: 'committed' });
    await fixture.seedRun(fixture.tasks.gate.taskId, 'running');
    for (let index = 0; index < 5; index += 1) {
      await fixture.commitRaw([encodeProjectSnapshot({ ref: { aggregateType: 'Project', projectId: `unrelated-${index}` }, revision: 1 })]);
    }

    const after = await readDirected();
    expect(after.readMany.length).toBe(before.readMany.length);
  });

  it('uses the final values and watermark after discovery, without gating on the older discovery watermark', async () => {
    const fixture = await open(kind);
    const result = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
    if (result.status !== 'committed') throw Error('claim required');
    const claim = result.value;
    const initial = await fixture.records.readMany([key(claim.runRef)]);
    if (initial.status !== 'ready' || !initial.value.records[0]) throw Error('Run required');
    const original = initial.value.records[0];
    let finalCursor: CommitCursor | null = null;
    const records: Records = { ...fixture.records, async readMany(keys) {
      if (keys.length === 6) {
        const body = JSON.parse(original.json) as { revision: number; budget: { tokenBudget: number } };
        body.revision += 1; body.budget.tokenBudget += 13;
        await fixture.commitRaw([{ ...original, revision: body.revision, json: JSON.stringify(body) }],
          [{ refKey: original.refKey, expectedRevision: original.revision }]);
        await fixture.overwriteSession(claim.sessionRef, session => ({ ...session, health: 'recoverable' }));
        const final = await fixture.records.readMany(keys);
        if (final.status === 'ready') finalCursor = final.value.readThrough;
        return final;
      }
      const discovery = await fixture.records.readMany(keys);
      return discovery.status === 'ready' ? { ...discovery, value: { ...discovery.value,
        readThrough: makeCommitCursor(seqOfCommitCursor(result.cursor) - 1) } } : discovery;
    } };
    const found = await createRunStateReader({ records }).readExecution(fixture.ctx, claim.runRef,
      { atLeastCursor: result.cursor });
    expect(found).toMatchObject({ status: 'ready', value: { run: { revision: original.revision + 1 },
      session: { health: 'recoverable' } } });
    if (found.status === 'ready') expect(found.value.readThrough).toBe(finalCursor);
  });

  it('rejects a consistently bound Host from a different workspace', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const actor = hostActorOf(fixture);
    const other: CoreCallContext = { ...fixture.ctx, workspaceId: 'other-workspace',
      materialReader: { kind: 'host', projectId: fixture.scope.projectId, workspaceId: 'other-workspace', actor } };
    expect(await createRunStateReader({ records: fixture.records }).readExecution(other, claim.runRef))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('ignores unrelated commits between discovery reads while returning the final window', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    let calls = 0;
    const records: Records = { ...fixture.records, async readMany(keys) {
      await fixture.commitRaw([encodeProjectSnapshot({ ref: { aggregateType: 'Project',
        projectId: `during-read-${++calls}` }, revision: 1 })]);
      return fixture.records.readMany(keys);
    } };
    expect(await createRunStateReader({ records }).readExecution(fixture.ctx, claim.runRef))
      .toMatchObject({ status: 'ready' });
    expect(calls).toBe(3);
  });

  it('does not interpret an unaccounted key or unavailable schema as confirmed absence', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    for (const lostKey of [key(claim.runRef), leaseKeyOf(claim.task), key(claim.attemptRef)]) {
      const lost = overrideReader(fixture.records, batch => ({ ...batch,
        records: batch.records.filter(record => record.refKey !== lostKey) }));
      expect(await createRunStateReader({ records: lost }).readExecution(fixture.ctx, claim.runRef))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
    }
    const unsupported: Records = { ...fixture.records, async readMany() {
      return { status: 'rejected', code: 'unsupported', reason: 'schema unavailable' };
    } };
    expect(await createRunStateReader({ records: unsupported }).readExecution(fixture.ctx, claim.runRef))
      .toMatchObject({ status: 'rejected', code: 'incomplete' });
  });

  it('rejects malformed atLeastCursor before reading the store', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    const { records, spy } = countingReader(fixture.records);
    const reader = createRunStateReader({ records });
    for (const bad of ['invalid-cursor', null, 12, {}, [makeCommitCursor(1)]]) {
      expect(await reader.readExecution(fixture.ctx, claim.runRef, { atLeastCursor: bad as CommitCursor }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    expect(spy.readMany).toHaveLength(0);
  });

  it('reports a required outbox missing in the final window as incomplete, not changing references', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    let finalReads = 0;
    const records: Records = { ...fixture.records, async readMany(keys) {
      const read = await fixture.records.readMany(keys);
      if (read.status !== 'ready' || keys.length !== 6) return read;
      finalReads += 1;
      return { ...read, value: { ...read.value,
        records: read.value.records.filter(record => record.refKey !== key(claim.outboxRef)),
        missing: [...read.value.missing, key(claim.outboxRef)],
      } };
    } };
    expect(await createRunStateReader({ records }).readExecution(fixture.ctx, claim.runRef))
      .toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect(finalReads).toBe(1);
  });

  it('retries a changing reference within a bounded budget and ends busy', async () => {
    const fixture = await open(kind);
    const claim = await claimed(fixture);
    let changes = 0;
    const records: Records = {
      ...fixture.records,
      async readMany(refKeys) {
        const read = await fixture.records.readMany(refKeys);
        if (read.status !== 'ready') return read;
        const next = read.value.records.map(record => {
          if (refKeys.length !== 6 || aggregateTypeOf(record.refKey) !== 'Run') return record;
          const body = JSON.parse(record.json) as Record<string, unknown>;
          body['attemptId'] = `changing-attempt-${++changes}`;
          return { ...record, json: JSON.stringify(body) };
        });
        return { ...read, value: { ...read.value, records: next } };
      },
    };
    const result = await createRunStateReader({ records }).readExecution(fixture.ctx, claim.runRef);
    expect(result).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(changes).toBe(4);
  });
});

describe('R4c.2a SQLite durability', () => {
  it('reads the same execution facts after reopening the ledger', async () => {
    const fixture = await createTaskClaimFixture('sqlite');
    fixtures.push(fixture);
    const claim = await claimed(fixture);
    await fixture.closeBackend();
    const reopened = await fixture.reopenService();
    connections.push(reopened);
    const result = await createRunStateReader({ records: reopened.records }).readExecution(fixture.ctx, claim.runRef);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.run.ref).toEqual(claim.runRef);
    expect(result.value.attempt.ref).toEqual(claim.attemptRef);
    expect(result.value.outbox.ref).toEqual(claim.outboxRef);
    expect(result.value.session.ref).toMatchObject({ sessionId: claim.sessionRef.sessionId });
  });
});
