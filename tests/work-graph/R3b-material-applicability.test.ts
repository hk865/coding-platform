import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas, EncodedRecord } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { MaterialAccessGrantSnapshot, MaterialAccessGrantV1, MaterialBasisV1 } from '../../src/contracts/material-access.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ProjectSourceAccess } from '../../src/core/workspace/project-source-index.js';
import { WorkspaceSourceApplicability } from '../../src/core/workspace/source-applicability.js';
import { materialRecordSchemas, createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';

type Snapshot = GoalSnapshot | WorkspaceSnapshot | RunSnapshot | QueryRunSnapshot | MaterialAccessGrantSnapshot;
type Backend = { records: GoalRecordTransactionPort & RecordLookupPort; close(): Promise<void> };
const at = '2026-09-24T00:00:00.000Z', projectId = 'material-project';
const targetWorkspace = 'workspace-target', sourceWorkspace = 'workspace-source';
const targetGoal = 'goal-target', sourceGoal = 'goal-source';
const actor = { kind: 'human' as const, id: 'trusted-reviewer' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'binding', templateId: 'worker', templateRevision: '1', bindingVersion: 1, policyRevision: '1' };
const workspace = (workspaceId: string): WorkspaceSnapshot => ({ ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 });
const goal = (goalId: string, workspaceId: string): GoalSnapshot => ({ ref: { aggregateType: 'Goal', projectId, goalId },
  workspaceRef: workspace(workspaceId).ref, objective: 'Preserve material scope', desiredState: 'active', activePlanRevision: null, revision: 1 });
const runRef = (goalId: string, runId: string): RunRef => ({ aggregateType: 'Run', projectId, goalId, runId });
function run(ref: RunRef, workspaceId: string): RunSnapshot {
  return { ref, revision: 1, schemaVersion: 1, task: { projectId, goalId: ref.goalId, taskId: 'task-1' },
    attemptId: 'attempt-1', planRef: { aggregateType: 'PlanRevision', projectId, planId: 'plan-1' },
    roleBinding, budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId, revision: 1 },
    status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
    envelope: null, startedAt: null, endedAt: null };
}
const queryRef = (queryJobId: string): QueryRunRef => ({ aggregateType: 'QueryRun', projectId,
  workspaceId: targetWorkspace, queryJobId, runId: 'query-run' });
function queryRun(ref: QueryRunRef): QueryRunSnapshot {
  const queryJobRef = { aggregateType: 'QueryJob' as const, projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId };
  return { ref, revision: 1, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef, runId: ref.runId,
    status: 'pending', startedAt: null, endedAt: null, outcome: null } };
}
const key = (ref: Snapshot['ref']) => canonicalJson(ref as unknown as JsonValue);
const encode = (row: Snapshot): EncodedRecord => ({ refKey: key(row.ref),
  schemaId: row.ref.aggregateType + 'Snapshot@1', revision: row.revision, json: JSON.stringify(row) });
let seedNo = 0;
function seedCommit(rows: Snapshot[], prior: number | null = null): PreparedCommit {
  const n = ++seedNo, event = { eventId: 'material-seed-event-' + n, eventType: 'MaterialFixtureSeeded', schemaVersion: 1, occurredAt: at };
  return { identityKey: 'material-seed-' + n, fingerprint: 'material-seed-' + n,
    guards: rows.map(row => ({ refKey: key(row.ref), expectedRevision: prior })), records: rows.map(encode),
    events: [{ ...event, json: JSON.stringify(event) }], claims: [], indexGuards: [], indexChanges: [] };
}
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function open(kind: 'memory' | 'sqlite'): Promise<Backend> {
  const registered = materialRecordSchemas();
  const schemas: RecordBackendSchemas = { ...registered, events: [...registered.events,
    { eventType: 'MaterialFixtureSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }] };
  if (kind === 'memory') return createInMemoryRecordBackend({ schemas });
  const dir = await mkdtemp(join(tmpdir(), 'next-r3b-applicability-')); dirs.push(dir);
  return createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas });
}
async function seed(store: Backend, rows: Snapshot[], prior: number | null = null) {
  expect(await store.records.commit(seedCommit(rows, prior))).toMatchObject({ status: 'committed', replayed: false });
}
async function bodyFor(owner: RunRef, body: string) {
  const bodies = new RawArtifactBodyStore();
  const stored = await bodies.put({ body, contentType: 'text/plain',
    sourceRefs: [{ kind: 'workspace', refId: sourceWorkspace, revision: '1' }],
    origin: { kind: 'run', owner }, requestedAt: at });
  if (stored.status !== 'ready') throw Error('raw body unavailable');
  return { bodies, ref: stored.value.ref };
}
function grant(id: string, reader: RunRef | QueryRunRef, owner: RunRef, ref: ArtifactRef,
  basis: MaterialBasisV1, historical: boolean, crossWorkspace: boolean): MaterialAccessGrantSnapshot {
  const value: MaterialAccessGrantV1 = { schemaVersion: 1, grantId: id,
    scope: { projectId, workspaceId: targetWorkspace, goalId: targetGoal }, materials: [ref], reader,
    issuedBy: { aggregateType: 'Control', projectId, goalId: targetGoal }, purpose: 'material review', basis, grantedAt: at,
    ...(historical ? { history: { owner, usage: 'historical_explanation' as const,
      ...(crossWorkspace ? { crossWorkspace: { sourceWorkspaceId: sourceWorkspace, authorizedBy: actor } } : {}) } } : {}),
  };
  return { ref: { aggregateType: 'MaterialAccessGrant', projectId, workspaceId: targetWorkspace, goalId: targetGoal, grantId: id },
    revision: 1, schemaVersion: 1, grant: value };
}
const queryCtx = (reader: QueryRunRef, basis: MaterialBasisV1): CoreCallContext => ({ projectId, workspaceId: targetWorkspace,
  principal: { kind: 'query_run', queryRunRef: reader, initiator: actor },
  materialReader: { kind: 'run', requester: reader, currentBasis: basis }, signal: new AbortController().signal });
const workCtx = (reader: RunRef, basis: MaterialBasisV1): CoreCallContext => ({ projectId, workspaceId: targetWorkspace,
  principal: { kind: 'work_run', runRef: reader, roleBinding },
  materialReader: { kind: 'run', requester: reader, currentBasis: basis }, signal: new AbortController().signal });

it.each(['memory', 'sqlite'] as const)('%s: exact QueryRun history needs a recorded human cross-workspace grant and respects revocation', async kind => {
  const store = await open(kind);
  try {
    const owner = runRef(sourceGoal, 'source-run');
    const reader = queryRef('query-1');
    const wrongReader = queryRef('query-2');
    const { bodies, ref } = await bodyFor(owner, 'historical source material');
    const basis: MaterialBasisV1 = { planRef: null, workspaceRevision: 1, sourceDigest: null };
    const missingCross = grant('missing-cross', reader, owner, ref, basis, true, false);
    await seed(store, [workspace(sourceWorkspace), workspace(targetWorkspace), goal(sourceGoal, sourceWorkspace),
      goal(targetGoal, targetWorkspace), run(owner, sourceWorkspace), queryRun(reader), queryRun(wrongReader), missingCross]);
    const reads = createMaterialRecordReaders(store.records);
    const materials = createMaterialService({ bodies, authority: reads.authority,
      grants: createMaterialAccessResolver(reads.authority, reads.index), now: () => at });
    expect(await materials.openArtifact(queryCtx(reader, basis), { ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    const authorized = grant('authorized-cross', reader, owner, ref, basis, true, true);
    await seed(store, [authorized]);
    expect(await materials.openArtifact(queryCtx(reader, basis), { ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'ready', value: { body: 'historical source material', applicability: 'historical_explanation' } });
    expect(await materials.openArtifact(queryCtx(wrongReader, basis), { ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    const revoked: MaterialAccessGrantSnapshot = { ...authorized, revision: 2,
      revocation: { reason: 'withdrawn', revokedAt: at, actor, commandId: 'revoke-cross' } };
    await seed(store, [revoked], 1);
    expect(await materials.openArtifact(queryCtx(reader, basis), { ref, usage: 'historical_explanation' }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  } finally { await store.close(); }
});

it.each(['memory', 'sqlite'] as const)('%s: current material read rechecks a real source manifest and rejects an edited file', async kind => {
  const store = await open(kind);
  const dir = await mkdtemp(join(tmpdir(), 'next-r3b-source-pin-')); dirs.push(dir);
  const file = join(dir, 'src/note.txt'); await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'original verified source');
  try {
    const owner = runRef(targetGoal, 'owner-run'), reader = runRef(targetGoal, 'reader-run');
    const { bodies, ref } = await bodyFor(owner, 'current shared material');
    const access: ProjectSourceAccess = {
      allowed: path => path === 'src/note.txt',
      inventory: async () => ({ paths: ['src/note.txt'], truncated: false }),
      read: async (path, maxBytes) => {
        if (path !== 'src/note.txt') throw Error('ungranted path');
        const content = await readFile(file, 'utf8');
        if (Buffer.byteLength(content) > maxBytes) throw Error('capacity');
        return { content };
      },
      sourceIdentity: async () => ({ workspace: dir, commit: null }),
    };
    const source = new WorkspaceSourceApplicability(scope => scope.projectId === projectId && scope.workspaceId === targetWorkspace ? access : null);
    const captured = await source.capture({ projectId, workspaceId: targetWorkspace,
      sourceSet: { kind: 'workspace_paths', paths: ['src/note.txt'] } });
    expect(captured.status).toBe('sourced');
    if (captured.status !== 'sourced') throw Error('source pin not captured');
    const basis: MaterialBasisV1 = { planRef: null, workspaceRevision: 1, sourceDigest: null, sourcePin: captured.pin };
    const currentGrant = grant('current', reader, owner, ref, basis, false, false);
    await seed(store, [workspace(targetWorkspace), goal(targetGoal, targetWorkspace), run(owner, targetWorkspace),
      run(reader, targetWorkspace), currentGrant]);
    const reads = createMaterialRecordReaders(store.records);
    const materials = createMaterialService({ bodies, authority: reads.authority,
      grants: createMaterialAccessResolver(reads.authority, reads.index, source), now: () => at });
    expect(await materials.openArtifact(workCtx(reader, basis), { ref, usage: 'current' }))
      .toMatchObject({ status: 'ready', value: { body: 'current shared material', applicability: 'current' } });
    await writeFile(file, 'edited verified source');
    expect(await materials.openArtifact(workCtx(reader, basis), { ref, usage: 'current' }))
      .toMatchObject({ status: 'rejected', code: 'source_stale' });
  } finally { await store.close(); }
});
