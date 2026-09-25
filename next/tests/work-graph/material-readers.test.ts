import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { RunRef, RunSnapshot, SourceRefV1 } from '../../src/contracts/dispatch.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { MaterialAccessGrantSnapshot, MaterialAccessGrantV1 } from '../../src/contracts/material-access.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { materialRecordSchemas, createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';

type Snapshot = GoalSnapshot | WorkspaceSnapshot | RunSnapshot | QueryRunSnapshot | MaterialAccessGrantSnapshot;
type Backend = { records: GoalRecordTransactionPort & RecordLookupPort; close(): Promise<void> };
const at = '2026-09-24T00:00:00.000Z';
const projectId = 'materials-project';
const workspaceId = 'workspace-main';
const goalId = 'materials-goal';
const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
const goal: GoalSnapshot = { ref: { aggregateType: 'Goal', projectId, goalId }, workspaceRef: workspace.ref,
  objective: 'Preserve the original material', desiredState: 'active', activePlanRevision: null, revision: 1 };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'p1' };
const source: SourceRefV1 = { kind: 'workspace', refId: workspaceId, revision: '1' };
const runRef = (runId: string, project = projectId, goalName = goalId): RunRef =>
  ({ aggregateType: 'Run', projectId: project, goalId: goalName, runId });
function run(ref: RunRef, sourceWorkspace = workspaceId): RunSnapshot {
  return { ref, revision: 1, schemaVersion: 1, task: { projectId: ref.projectId, goalId: ref.goalId, taskId: 'task-1' },
    attemptId: 'attempt-1', planRef: { aggregateType: 'PlanRevision', projectId: ref.projectId, planId: 'plan-1' },
    roleBinding, budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId: sourceWorkspace, revision: 1 },
    status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
    envelope: null, startedAt: null, endedAt: null };
}
function queryRun(runId: string, workspaceName: string): QueryRunSnapshot {
  const queryJobRef = { aggregateType: 'QueryJob' as const, projectId, workspaceId: workspaceName, queryJobId: 'query-1' };
  return { ref: { aggregateType: 'QueryRun', projectId, workspaceId: workspaceName, queryJobId: 'query-1', runId },
    revision: 1, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef, runId, status: 'pending',
      startedAt: null, endedAt: null, outcome: null } };
}
function artifact(digest: string): ArtifactRef {
  return { kind: 'artifact', contentType: 'text/plain', digest, sizeBytes: 3, source };
}
function grant(id: string, reader: RunRef, owner: RunRef, material: ArtifactRef): MaterialAccessGrantSnapshot {
  const value: MaterialAccessGrantV1 = { schemaVersion: 1, grantId: id, scope: { projectId, workspaceId, goalId },
    materials: [material], reader, issuedBy: { aggregateType: 'Control', projectId, goalId },
    purpose: 'History review', basis: { planRef: null, workspaceRevision: 1, sourceDigest: null }, grantedAt: at,
    history: { owner, usage: 'historical_explanation' } };
  return { ref: { aggregateType: 'MaterialAccessGrant', projectId, workspaceId, goalId, grantId: id },
    revision: 1, schemaVersion: 1, grant: value };
}
const refKey = (ref: Snapshot['ref']) => canonicalJson(ref as unknown as JsonValue);
const encode = (snapshot: Snapshot): EncodedRecord => ({ refKey: refKey(snapshot.ref),
  schemaId: snapshot.ref.aggregateType + 'Snapshot@1', revision: snapshot.revision, json: JSON.stringify(snapshot) });
let nextSeed = 0;
function commitRows(rows: Snapshot[], priorRevision: number | null = null): PreparedCommit {
  const seedId = ++nextSeed;
  const event = { eventId: 'fixture-event-' + seedId, eventType: 'FixtureSeeded', schemaVersion: 1, occurredAt: at };
  return { identityKey: 'fixture-seed-' + seedId, fingerprint: 'fixture-seed-' + seedId,
    guards: rows.map(row => ({ refKey: refKey(row.ref), expectedRevision: priorRevision })),
    records: rows.map(encode), events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] };
}
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function backend(kind: 'memory' | 'sqlite'): Promise<Backend> {
  const materialSchemas = materialRecordSchemas();
  const schemas: RecordBackendSchemas = { ...materialSchemas, events: [...materialSchemas.events,
    { eventType: 'FixtureSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }] };
  if (kind === 'memory') return createInMemoryRecordBackend({ schemas }) as unknown as Backend;
  const dir = await mkdtemp(join(tmpdir(), 'next-material-readers-'));
  dirs.push(dir);
  return createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas }) as unknown as Backend;
}
async function seed(store: Backend, rows: Snapshot[], priorRevision: number | null = null): Promise<void> {
  expect(await store.records.commit(commitRows(rows, priorRevision))).toMatchObject({ status: 'committed', replayed: false });
}

it.each(['memory', 'sqlite'] as const)('%s: canonical material records use complete refs and returned values are isolated', async kind => {
  const store = await backend(kind);
  try {
    const owner = runRef('same-run');
    const otherProject = run(runRef('same-run', 'other-project'));
    const otherGoal = run(runRef('same-run', projectId, 'other-goal'));
    const firstQuery = queryRun('same-query', workspaceId);
    const secondQuery = queryRun('same-query', 'other-workspace');
    await seed(store, [workspace, goal, run(owner), otherProject, otherGoal, firstQuery, secondQuery]);
    const { authority } = createMaterialRecordReaders(store.records);
    for (const snapshot of [workspace, goal, run(owner), otherProject, otherGoal, firstQuery, secondQuery]) {
      expect(await authority.load(snapshot.ref)).toMatchObject({ status: 'found', snapshot });
    }
    expect(await authority.load(runRef('absent'))).toMatchObject({ status: 'not_found' });
    const first = await authority.load(owner);
    if (first.status !== 'found' || first.snapshot.ref.aggregateType !== 'Run') throw Error('Run missing');
    (first.snapshot as RunSnapshot).workspaceSnapshot.workspaceId = 'tampered';
    expect(await authority.load(owner)).toMatchObject({ status: 'found', snapshot: { workspaceSnapshot: { workspaceId } } });
  } finally { await store.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: candidate lookup uses full reader identity, exact artifact, and current grant revision', async kind => {
  const store = await backend(kind);
  try {
    const owner = runRef('owner');
    const reader = runRef('reader');
    const sameLocalIdElsewhere = runRef('reader', 'other-project');
    const target = artifact('a'.repeat(64));
    const other = artifact('b'.repeat(64));
    const selected = grant('selected', reader, owner, target);
    await seed(store, [workspace, goal, run(owner), run(reader), selected,
      grant('wrong-material', reader, owner, other), grant('wrong-reader', sameLocalIdElsewhere, owner, target)]);
    const { authority, index } = createMaterialRecordReaders(store.records);
    expect(await index.materialAccessCandidates({ reader, material: target }))
      .toMatchObject({ status: 'ready', grants: [selected] });
    expect(await index.materialAccessCandidates({ reader, material: other }))
      .toMatchObject({ status: 'ready', grants: [{ ref: { grantId: 'wrong-material' } }] });
    const first = await index.materialAccessCandidates({ reader, material: target });
    if (first.status !== 'ready') throw Error('candidate lookup unavailable');
    first.grants[0]!.grant.materials[0]!.digest = 'tampered';
    expect(await index.materialAccessCandidates({ reader, material: target }))
      .toMatchObject({ status: 'ready', grants: [selected] });
    const revoked: MaterialAccessGrantSnapshot = { ...selected, revision: 2,
      revocation: { reason: 'withdrawn', revokedAt: at, actor: { kind: 'human', id: 'reviewer' }, commandId: 'revoke-selected' } };
    await seed(store, [revoked], 1);
    expect(await authority.load(selected.ref)).toMatchObject({ status: 'found', snapshot: revoked });
    // Discovery may omit revoked rows; any row it does return must be current.
    const afterRevocation = await index.materialAccessCandidates({ reader, material: target });
    expect(afterRevocation.status).toBe('ready');
    if (afterRevocation.status === 'ready')
      expect(afterRevocation.grants.every(candidate => candidate.revision === 2)).toBe(true);
  } finally { await store.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: candidate pagination reaches a matching grant beyond the 200-row lookup limit', async kind => {
  const store = await backend(kind);
  try {
    const owner = runRef('owner');
    const reader = runRef('reader');
    const target = artifact('f'.repeat(64));
    const unrelated = artifact('0'.repeat(64));
    const rows = Array.from({ length: 205 }, (_, i) => grant(`grant-${String(i).padStart(3, '0')}`, reader, owner,
      i === 204 ? target : unrelated));
    await seed(store, [workspace, goal, run(owner), run(reader), ...rows]);
    const { index } = createMaterialRecordReaders(store.records);
    expect(await index.materialAccessCandidates({ reader, material: target }))
      .toMatchObject({ status: 'ready', grants: [{ ref: { grantId: 'grant-204' } }] });
  } finally { await store.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: persisted grant admits a real material read, then revocation blocks it', async kind => {
  const store = await backend(kind);
  try {
    const owner = runRef('owner');
    const reader = runRef('reader');
    const bodies = new RawArtifactBodyStore();
    const put = await bodies.put({ body: 'abc', contentType: 'text/plain', sourceRefs: [source],
      origin: { kind: 'run', owner }, requestedAt: at });
    if (put.status !== 'ready') throw Error('body seed failed');
    const ref = put.value.ref;
    const historyGrant = grant('history-1', reader, owner, ref);
    await seed(store, [workspace, goal, run(owner), run(reader), historyGrant]);
    const reads = createMaterialRecordReaders(store.records);
    const resolver = createMaterialAccessResolver(reads.authority, reads.index);
    const materials = createMaterialService({ bodies, authority: reads.authority, grants: resolver, now: () => at });
    const ctx: CoreCallContext = { projectId, workspaceId,
      principal: { kind: 'work_run', runRef: reader, roleBinding },
      materialReader: { kind: 'run', requester: reader, currentBasis: historyGrant.grant.basis },
      signal: new AbortController().signal };
    expect(await materials.openArtifact(ctx, { ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'ready', value: { body: 'abc', applicability: 'historical_explanation' } });
    const revoked: MaterialAccessGrantSnapshot = { ...historyGrant, revision: 2,
      revocation: { reason: 'withdrawn', revokedAt: at, actor: { kind: 'human', id: 'reviewer' }, commandId: 'revoke-history' } };
    await seed(store, [revoked], 1);
    expect(await materials.openArtifact(ctx, { ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  } finally { await store.close(); }
});

it('rejects a descending UTF-8 keyset cursor before a third candidate page', async () => {
  let lookups = 0;
  const fake: GoalRecordTransactionPort & RecordLookupPort = {
    async readMany() { throw Error('candidate discovery must not readMany'); },
    async lookupCommit() { throw Error('candidate discovery must not lookupCommit'); },
    async commit() { throw Error('candidate discovery must not commit'); },
    async eventAt() { throw Error('candidate discovery must not eventAt'); },
    async lookup() {
      lookups++;
      return { status: 'ready', value: { records: [], next: lookups === 1 ? 'z' : lookups === 2 ? 'a' : null,
        readThrough: null } };
    },
  };
  const { index } = createMaterialRecordReaders(fake);
  expect(await index.materialAccessCandidates({ reader: runRef('reader'), material: artifact('a'.repeat(64)) }))
    .toMatchObject({ status: 'unavailable' });
  expect(lookups).toBe(2);
});

it.each(['memory', 'sqlite'] as const)('%s: registration rejects an Agent revocation actor without its required RunRef', async kind => {
  const store = await backend(kind);
  try {
    const owner = runRef('owner');
    const reader = runRef('reader');
    const active = grant('agent-revocation', reader, owner, artifact('c'.repeat(64)));
    await seed(store, [active]);
    const validRevoked: MaterialAccessGrantSnapshot = { ...active, revision: 2,
      revocation: { reason: 'withdrawn', revokedAt: at,
        actor: { kind: 'human', id: 'reviewer' }, commandId: 'revoke-agent' } };
    const update = commitRows([validRevoked], 1);
    const malformedJson = JSON.stringify({ ...validRevoked, revocation: {
      ...validRevoked.revocation, actor: { kind: 'agent', id: 'agent-without-run' },
    } });
    const malformed: PreparedCommit = { ...update, records: [{ ...update.records[0]!, json: malformedJson }] };
    expect(await store.records.commit(malformed)).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await createMaterialRecordReaders(store.records).authority.load(active.ref))
      .toMatchObject({ status: 'found', snapshot: active });
  } finally { await store.close(); }
});
