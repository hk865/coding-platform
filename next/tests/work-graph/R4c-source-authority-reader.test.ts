/**
 * R4c.2c behavior acceptance for the SourceAuthority exact-fact reader.
 *
 * The test reuses the real TaskClaim fixture (real RecordStore registration,
 * real Workspace/Run/Plan facts and the real commit path) and the existing
 * material record reader/decoder. No fixture, reader or codec is copied here.
 * Fault injection wraps the real `readMany` or its authority boundary; no successful end-to-end
 * result is mocked, and the exact reads stay on the real backend.
 */
import { afterEach, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { QueryJobRef, QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { ReviewWorkRef } from '../../src/contracts/reviewer-work.js';
import type { EncodedRecord, RecordBatchRead, StoreResult } from '../../src/core/record-store/ports.js';
import type { MaterialAuthorityReads, MaterialCanonicalRef } from '../../src/core/work-graph/materials/record-ports.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SourceCanonicalRef } from '../../src/core/work-graph/source-authority-ports.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createTaskClaimFixture, type ClaimFixtureKind, type Records, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

const openFixtures: TaskClaimFixture[] = [];
async function openFixture(kind: ClaimFixtureKind): Promise<TaskClaimFixture> {
  const fixture = await createTaskClaimFixture(kind);
  openFixtures.push(fixture);
  return fixture;
}
afterEach(async () => {
  await Promise.allSettled(openFixtures.splice(0).map(fixture => fixture.close()));
});

const canonical = (value: unknown): string => canonicalJson(value as JsonValue);

/** Counts one delegation per `load`; the reader under test may delegate but
 * never scans, and unrelated stored facts must not add delegations. */
function readerFor(authority: MaterialAuthorityReads) {
  const delegated: MaterialCanonicalRef[] = [];
  const port: MaterialAuthorityReads = {
    async load(ref) { delegated.push(ref); return authority.load(ref); },
  };
  return { reads: createSourceAuthorityReader({ authority: port }), delegations: () => delegated.length };
}
function readerForRecords(records: Records) {
  const physicalReads: string[][] = [];
  const observed = interceptReadMany(records, async (keys, real) => {
    physicalReads.push([...keys]);
    return real();
  });
  return { ...readerFor(createMaterialRecordReaders(observed).authority), physicalReads };
}

/** Overrides only the real `readMany`; every other port method stays intact. */
function interceptReadMany(
  base: Records,
  hook: (refKeys: readonly string[], real: () => Promise<StoreResult<RecordBatchRead>>) => Promise<StoreResult<RecordBatchRead>>,
): Records {
  return { ...base, readMany: refKeys => hook(refKeys, () => base.readMany(refKeys)) };
}

function manualRun(fixture: TaskClaimFixture, runId: string, options: { goalId?: string } = {}): RunSnapshot {
  const goalId = options.goalId ?? fixture.goalRef.goalId;
  return {
    ref: { aggregateType: 'Run', projectId: fixture.scope.projectId, goalId, runId },
    revision: 1, schemaVersion: 1,
    task: { projectId: fixture.scope.projectId, goalId, taskId: fixture.tasks.first.taskId },
    attemptId: `attempt-${runId}`,
    planRef: fixture.planRef, roleBinding: fixture.roleBinding, budget: fixture.budget,
    workspaceSnapshot: { workspaceId: fixture.scope.workspaceId, revision: 1 },
    status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0,
    lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null,
  };
}

function manualQueryRun(fixture: TaskClaimFixture, runId: string, options: { workspaceId?: string; queryJobId?: string } = {}): QueryRunSnapshot {
  const workspaceId = options.workspaceId ?? fixture.scope.workspaceId;
  const queryJobId = options.queryJobId ?? 'query-1';
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: fixture.scope.projectId, workspaceId, queryJobId };
  const ref: QueryRunRef = { aggregateType: 'QueryRun', projectId: fixture.scope.projectId, workspaceId, queryJobId, runId };
  return {
    ref, revision: 1, schemaVersion: 1,
    run: { schemaVersion: 1, queryJobRef, runId, status: 'pending', startedAt: null, endedAt: null, outcome: null },
  };
}

/** Seeds through the fixture's real commit path (schema + guards), never by
 * writing backend state directly. */
async function seedSnapshot(fixture: TaskClaimFixture, snapshot: { ref: { aggregateType: string }; revision: number }): Promise<void> {
  const record: EncodedRecord = {
    refKey: canonical(snapshot.ref),
    schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
  const receipt = await fixture.commitRaw([record]);
  expect(receipt, JSON.stringify(receipt)).toMatchObject({ status: 'committed' });
}

it.each(['memory', 'sqlite'] as const)('%s: loads the exact Workspace/Run/QueryRun facts through one authority read each', async kind => {
  const fixture = await openFixture(kind);
  const run = manualRun(fixture, 'exact-run');
  const queryRun = manualQueryRun(fixture, 'exact-query-run');
  await seedSnapshot(fixture, run);
  await seedSnapshot(fixture, queryRun);
  const { reads, delegations, physicalReads } = readerForRecords(fixture.records);

  await expect(reads.load(fixture.workspaceRef)).resolves.toMatchObject({ status: 'found', snapshot: { ref: fixture.workspaceRef } });
  await expect(reads.load(run.ref)).resolves.toMatchObject({ status: 'found', snapshot: { ref: run.ref } });
  await expect(reads.load(queryRun.ref)).resolves.toMatchObject({ status: 'found', snapshot: { ref: queryRun.ref } });
  expect(delegations()).toBe(3);
  expect(physicalReads).toEqual([[canonical(fixture.workspaceRef)], [canonical(run.ref)], [canonical(queryRun.ref)]]);
});

it.each(['memory', 'sqlite'] as const)('%s: a found result matches the full ref, not a same local id in another scope', async kind => {
  const fixture = await openFixture(kind);
  const here = manualRun(fixture, 'shared-run');
  const otherGoal = manualRun(fixture, 'shared-run', { goalId: 'other-goal' });
  // RunRef has no workspaceId: the same runId in another goal must stay a distinct fact.
  const queryHere = manualQueryRun(fixture, 'shared-query');
  const queryElsewhere = manualQueryRun(fixture, 'shared-query', { workspaceId: 'other-workspace' });
  for (const snapshot of [here, otherGoal, queryHere, queryElsewhere]) await seedSnapshot(fixture, snapshot);
  const { reads } = readerForRecords(fixture.records);

  const loaded = await reads.load(here.ref);
  expect(loaded).toMatchObject({ status: 'found', snapshot: { ref: here.ref, task: { goalId: here.ref.goalId } } });
  if (loaded.status !== 'found') return;
  expect(loaded.snapshot.ref).toEqual(here.ref);
  await expect(reads.load(otherGoal.ref)).resolves.toMatchObject({ status: 'found', snapshot: { ref: otherGoal.ref } });
  await expect(reads.load(queryHere.ref)).resolves.toMatchObject({ status: 'found', snapshot: { ref: queryHere.ref } });
  await expect(reads.load(queryElsewhere.ref)).resolves.toMatchObject({ status: 'found', snapshot: { ref: queryElsewhere.ref } });
});

it.each(['memory', 'sqlite'] as const)('%s: a genuinely absent exact ref stays not_found', async kind => {
  const fixture = await openFixture(kind);
  const { reads } = readerForRecords(fixture.records);
  const absent: RunRef = { aggregateType: 'Run', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, runId: 'absent-run' };
  await expect(reads.load(absent)).resolves.toMatchObject({ status: 'not_found', ref: absent });
});

it('ReviewWork and QueryJob have no provider here: unsupported with zero delegation', async () => {
  const fixture = await openFixture('memory');
  const { reads, delegations, physicalReads } = readerForRecords(fixture.records);
  const review: ReviewWorkRef = { aggregateType: 'ReviewWork', projectId: fixture.scope.projectId,
    workspaceId: fixture.scope.workspaceId, goalId: fixture.goalRef.goalId, reviewId: 'review-1' };
  const job: QueryJobRef = { aggregateType: 'QueryJob', projectId: fixture.scope.projectId,
    workspaceId: fixture.scope.workspaceId, queryJobId: 'query-1' };
  await expect(reads.load(review)).resolves.toMatchObject({ status: 'unsupported' });
  await expect(reads.load(job)).resolves.toMatchObject({ status: 'unsupported' });
  expect(delegations()).toBe(0);
  expect(physicalReads).toEqual([]);
});

const faultCases: { label: string; wrap: (records: Records) => Records }[] = [
  { label: 'a thrown RecordStore error', wrap: records => interceptReadMany(records, async () => { throw Error('injected store failure'); }) },
  { label: 'an unaccounted request key', wrap: records => interceptReadMany(records,
    async () => ({ status: 'ready', value: { records: [], missing: [], readThrough: null } })) },
  { label: 'a rejected unreadable record', wrap: records => interceptReadMany(records,
    async () => ({ status: 'rejected', code: 'corrupt', reason: 'injected unreadable record' })) },
  { label: 'a damaged record body', wrap: records => interceptReadMany(records,
    async refKeys => ({ status: 'ready', value: { records: [{ refKey: refKeys[0]!, schemaId: 'RunSnapshot@1',
      revision: 1, json: '{ not json' }], missing: [], readThrough: null } })) },
];

for (const kind of ['memory', 'sqlite'] as const) {
  for (const fault of faultCases) {
    it(`${kind}: ${fault.label} stays unavailable`, async () => {
      const fixture = await openFixture(kind);
      const run = manualRun(fixture, 'fault-run');
      await seedSnapshot(fixture, run);
      const { reads } = readerForRecords(fault.wrap(fixture.records));
      await expect(reads.load(run.ref)).resolves.toMatchObject({ status: 'unavailable' });
    });
  }
}

it('a direct authority provider throw becomes unavailable after a real backend read', async () => {
  const fixture = await openFixture('sqlite');
  const run = manualRun(fixture, 'provider-throw-run');
  await seedSnapshot(fixture, run);
  const authority = createMaterialRecordReaders(fixture.records).authority;
  let providerCalls = 0;
  let actualStatus: string | undefined;
  const { reads } = readerFor({
    async load(ref) {
      providerCalls += 1;
      const actual = await authority.load(ref);
      actualStatus = actual.status;
      // This exception is outside MaterialAuthority's readMany catch.
      throw Error('injected authority provider failure');
    },
  });
  await expect(reads.load(run.ref)).resolves.toMatchObject({ status: 'unavailable' });
  expect(providerCalls).toBe(1);
  expect(actualStatus).toBe('found');
});

it.each(['memory', 'sqlite'] as const)('%s: fixes the caller ref before its first await and returns an isolated copy', async kind => {
  const fixture = await openFixture(kind);
  const run = manualRun(fixture, 'copy-run');
  await seedSnapshot(fixture, run);
  const authority = createMaterialRecordReaders(fixture.records).authority;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const { reads } = readerFor({ async load(ref) { await waiting; return authority.load(ref); } });

  const mutable: RunRef = { ...run.ref };
  const pending = reads.load(mutable);
  mutable.runId = 'mutated-after-call';
  release();
  const loaded = await pending;
  expect(loaded).toMatchObject({ status: 'found', snapshot: { ref: run.ref } });
  if (loaded.status !== 'found') return;
  (loaded.snapshot as RunSnapshot).task.taskId = 'tampered-return';
  await expect(reads.load(run.ref)).resolves.toMatchObject({ status: 'found', snapshot: { task: { taskId: fixture.tasks.first.taskId } } });
});

it.each(['memory', 'sqlite'] as const)('%s: not_found retains the original complete ref after caller mutation', async kind => {
  const fixture = await openFixture(kind);
  const { reads, physicalReads } = readerForRecords(fixture.records);
  const original: RunRef = { aggregateType: 'Run', projectId: fixture.scope.projectId,
    goalId: fixture.goalRef.goalId, runId: 'missing-before-mutation' };
  const mutable = { ...original };
  const pending = reads.load(mutable);
  mutable.goalId = 'changed-goal';
  mutable.runId = 'changed-run';
  await expect(pending).resolves.toEqual({ status: 'not_found', ref: original });
  expect(physicalReads).toEqual([[canonical(original)]]);
});

it.each(['memory', 'sqlite'] as const)('%s: adding unrelated facts adds no read to an exact load', async kind => {
  const fixture = await openFixture(kind);
  const run = manualRun(fixture, 'count-run');
  await seedSnapshot(fixture, run);
  const { reads, delegations, physicalReads } = readerForRecords(fixture.records);

  const before = delegations();
  await reads.load(run.ref);
  const afterFirst = delegations();
  await seedSnapshot(fixture, manualRun(fixture, 'unrelated-run'));
  await seedSnapshot(fixture, manualQueryRun(fixture, 'unrelated-query'));
  await reads.load(run.ref);
  const afterSecond = delegations();
  expect(afterFirst - before).toBe(1);
  expect(afterSecond - afterFirst).toBe(1);
  expect(physicalReads).toEqual([[canonical(run.ref)], [canonical(run.ref)]]);
});

it('a non-serializable ref is unavailable, never another fact', async () => {
  const fixture = await openFixture('memory');
  const run = manualRun(fixture, 'legal-run');
  await seedSnapshot(fixture, run);
  const { reads } = readerForRecords(fixture.records);
  const nonSerializable = { ...run.ref, extra: Number.NaN } as unknown as SourceCanonicalRef;
  await expect(reads.load(nonSerializable)).resolves.toMatchObject({ status: 'unavailable' });
});

it('an illegal ref member type is unavailable, never another fact', async () => {
  const fixture = await openFixture('memory');
  const run = manualRun(fixture, 'legal-run');
  await seedSnapshot(fixture, run);
  const { reads } = readerForRecords(fixture.records);
  const illegalMember = { ...run.ref, runId: 42 } as unknown as SourceCanonicalRef;
  const illegal = await reads.load(illegalMember);
  expect(illegal).not.toMatchObject({ status: 'found' });
  expect(illegal).toMatchObject({ status: 'unavailable' });
});
