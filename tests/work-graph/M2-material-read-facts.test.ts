/**
 * M2 material read facts — independent target behaviour tests.
 *
 * These tests exercise the Stage-2 contract through the frozen
 * `MaterialReadFactsPort`. At Stage 1 the service is an explicit `unsupported`
 * skeleton, so every test must be RED on that skeleton and not on an invalid
 * fixture: each case first proves the real material chain is valid through the
 * ordinary services before asserting the facts behaviour.
 *
 * The ledger is the real Memory/SQLite RecordStore with the registered material
 * schemas; bodies go through the real RawArtifactBodyStore; authorization is
 * produced by the real candidate lookup + canonical reads. When the formal M1
 * grant writer is unavailable (it is itself still a Stage-1 skeleton) the grant
 * is placed with an explicit domain seed, exactly like material-readers.test.ts.
 * The source provider performs real WorkspaceSourceApplicability captures over a
 * real temporary directory; wrappers below only delay, cancel or corrupt the pin
 * and are clearly test-only.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, RecordBackendSchemas, RecordGuard, StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type {
  MaterialAccessGrantSnapshot, MaterialAccessGrantV1, MaterialBasisV1, MaterialSourcePinV1,
  MaterialSourceSetV1, SourceApplicabilityPort,
} from '../../src/contracts/material-access.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { materialRecordSchemas, createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialReadFactsService } from '../../src/core/work-graph/materials/material-facts-service.js';
import type { MaterialReadFactsPort } from '../../src/core/work-graph/materials/contracts.js';
import type { MaterialAuthorityReads, MaterialCandidateReads } from '../../src/core/work-graph/materials/record-ports.js';
import { WorkspaceSourceApplicability } from '../../src/core/workspace/source-applicability.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';

const AT = '2026-09-26T00:00:00.000Z';
const projectId = 'm2-facts-project';
const workspaceId = 'm2-facts-workspace';
const goalId = 'm2-facts-goal';
const actor = { kind: 'human' as const, id: 'm2-operator' };
const roleBinding = { schemaVersion: 1 as const, bindingId: 'm2-binding', templateId: 'worker',
  templateRevision: 'r1', bindingVersion: 1, policyRevision: 'p1' };
const sourceSet: MaterialSourceSetV1 = { kind: 'workspace_paths', paths: ['src/input.txt'] };

type Snapshot = GoalSnapshot | WorkspaceSnapshot | RunSnapshot | MaterialAccessGrantSnapshot;
type Backend = { records: GoalRecordTransactionPort & RecordLookupPort; close(): Promise<void> };
const keyOf = (ref: { aggregateType: string }): string => canonicalJson(ref as unknown as JsonValue);
const encode = (snapshot: Snapshot): EncodedRecord => ({ refKey: keyOf(snapshot.ref),
  schemaId: snapshot.ref.aggregateType + 'Snapshot@1', revision: snapshot.revision, json: JSON.stringify(snapshot) });
const guardMap = (guards: readonly RecordGuard[]): Map<string, number | null> => {
  const map = new Map<string, number | null>();
  for (const guard of guards) map.set(guard.refKey, guard.expectedRevision);
  return map;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(settle => { resolve = settle; });
  return { promise, resolve };
}

/** A test-only gate around the REAL capture: it enters, waits, then delegates. */
function gatedSource(real: SourceApplicabilityPort): { source: SourceApplicabilityPort; entered: Promise<void>; release: () => void } {
  const entered = deferred();
  const gate = deferred();
  const source: SourceApplicabilityPort = {
    async capture(query, signal) {
      entered.resolve();
      await gate.promise;
      return real.capture(query, signal);
    },
  };
  return { source, entered: entered.promise, release: gate.resolve };
}

function runSnapshot(ref: RunRef): RunSnapshot {
  return { ref, revision: 1, schemaVersion: 1, task: { projectId, goalId, taskId: 'm2-task' },
    attemptId: 'm2-attempt', planRef: { aggregateType: 'PlanRevision', projectId, planId: 'm2-plan' },
    roleBinding, budget: { tokenBudget: 100, deadline: null }, workspaceSnapshot: { workspaceId, revision: 1 },
    status: 'starting', outcome: null, exitCode: null, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
    envelope: null, startedAt: null, endedAt: null };
}

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function buildFixture(kind: 'memory' | 'sqlite') {
  const directory = await mkdtemp(join(tmpdir(), `next-m2-facts-${kind}-`));
  dirs.push(directory);
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'src/input.txt'), 'source version one');

  const materialSchemas = materialRecordSchemas();
  const schemas: RecordBackendSchemas = { ...materialSchemas, events: [...materialSchemas.events,
    { eventType: 'M2FixtureSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }] };
  const backend: Backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas }) as unknown as Backend
    : createSqliteRecordBackend({ path: join(directory, 'records.sqlite'), schemas }) as unknown as Backend;

  // --- real registered bodies, some owned by the reader itself -----------------
  const bodies = new RawArtifactBodyStore();
  const putBody = async (body: string, owner: RunRef): Promise<ArtifactRef> => {
    const stored = await bodies.put({ body, contentType: 'text/plain',
      sourceRefs: [{ kind: 'workspace', refId: workspaceId, revision: '1' }],
      origin: { kind: 'run', owner }, requestedAt: AT });
    if (stored.status !== 'ready') throw Error('M2 body fixture put failed: ' + JSON.stringify(stored));
    return stored.value.ref;
  };

  // --- real source provider over the real temporary workspace ------------------
  const access = createWorkspaceAccessFactory({
    resolveRoot: async () => ({ status: 'ready', value: { root: directory, workspaceRevision: 1 } }),
    authorize: async () => ({ status: 'ready', value: { subjectKey: 'host:m2', permissionRevision: 'p1', allowsRead: () => true } }),
  });
  const source: SourceApplicabilityPort = {
    async capture(query, signal) {
      const use = signal ?? new AbortController().signal;
      const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
        materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: use };
      const opened = await access.open(ctx, { aggregateType: 'Workspace', projectId, workspaceId });
      if (opened.status !== 'ready') return { status: 'unavailable', issues: [opened.reason] };
      const a = opened.value;
      try {
        return await new WorkspaceSourceApplicability(() => ({ allowed: p => a.authorization.allowsRead(p),
          inventory: () => a.listFiles(60000), read: (p, max) => a.read(p, max), sourceIdentity: () => a.sourceIdentity() })).capture(query, use);
      } finally {
        await a.release();
      }
    },
  };
  const captured = await source.capture({ projectId, workspaceId, sourceSet });
  if (captured.status !== 'sourced') throw Error('M2 source fixture capture failed: ' + JSON.stringify(captured));
  const sourcePin: MaterialSourcePinV1 = captured.pin;

  // --- canonical scope facts ---------------------------------------------------
  const workspace: WorkspaceSnapshot = { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 };
  const goal: GoalSnapshot = { ref: { aggregateType: 'Goal', projectId, goalId }, workspaceRef: workspace.ref,
    objective: 'Exercise M2 material read facts', desiredState: 'active', activePlanRevision: null, revision: 1 };
  const ownerRef: RunRef = { aggregateType: 'Run', projectId, goalId, runId: 'm2-owner' };
  const readerRef: RunRef = { aggregateType: 'Run', projectId, goalId, runId: 'm2-reader' };
  const readerBRef: RunRef = { aggregateType: 'Run', projectId, goalId, runId: 'm2-reader-b' };
  const ownerSnapshot = runSnapshot(ownerRef);
  const readerSnapshot = runSnapshot(readerRef);
  const readerBSnapshot = runSnapshot(readerBRef);

  const material = await putBody('m2 body A', ownerRef);
  const materialB = await putBody('m2 body B', ownerRef);
  const selfMaterial = await putBody('m2 self owned body', readerRef);

  const basis: MaterialBasisV1 = { planRef: null, workspaceRevision: 1,
    sourceDigest: sourcePin.manifestDigest, sourcePin };

  const buildGrant = (grantId: string, reader: RunRef, target: ArtifactRef): MaterialAccessGrantSnapshot => {
    const value: MaterialAccessGrantV1 = { schemaVersion: 1, grantId,
      scope: { projectId, workspaceId, goalId }, materials: [target], reader,
      issuedBy: { aggregateType: 'Control', projectId, goalId }, purpose: 'M2 current material read',
      basis, grantedAt: AT };
    return { ref: { aggregateType: 'MaterialAccessGrant', projectId, workspaceId, goalId, grantId },
      revision: 1, schemaVersion: 1, grant: value };
  };
  const grant = buildGrant('m2-grant-a', readerRef, material);
  const grantB = buildGrant('m2-grant-b', readerBRef, materialB);

  let commitSeq = 0;
  const eventRow = (label: string): EncodedDomainEvent => {
    commitSeq += 1;
    const event = { eventId: `${label}-event-${commitSeq}`, eventType: 'M2FixtureSeeded', schemaVersion: 1, occurredAt: AT };
    return { ...event, json: JSON.stringify(event) };
  };
  const commit = async (recordsToWrite: EncodedRecord[], guards: RecordGuard[], label: string): Promise<StoreCommitReceipt> => {
    commitSeq += 1;
    return backend.records.commit({ identityKey: `m2-${label}-${commitSeq}`,
      fingerprint: `m2-${label}-${commitSeq}`, guards, records: recordsToWrite, events: [eventRow(label)],
      claims: [], indexGuards: [], indexChanges: [] });
  };

  const seed = [workspace, goal, ownerSnapshot, readerSnapshot, readerBSnapshot, grant, grantB];
  const seeded = await commit(seed.map(encode),
    seed.map(row => ({ refKey: keyOf(row.ref), expectedRevision: null })), 'scope-seed');
  if (seeded.status !== 'committed') throw Error('M2 scope seed failed: ' + JSON.stringify(seeded));

  const { authority, index } = createMaterialRecordReaders(backend.records);
  const ctxFor = (reader: RunRef, currentBasis: MaterialBasisV1,
    signal: AbortSignal = new AbortController().signal): CoreCallContext => ({ projectId, workspaceId,
    principal: { kind: 'work_run', runRef: reader, roleBinding },
    materialReader: { kind: 'run', requester: reader, currentBasis }, signal });

  const seedRevocation = async (target: MaterialAccessGrantSnapshot, commandId: string): Promise<StoreCommitReceipt> => {
    const revoked: MaterialAccessGrantSnapshot = { ...target, revision: 2,
      revocation: { reason: 'withdrawn', revokedAt: AT, actor, commandId } };
    return commit([encode(revoked)], [{ refKey: keyOf(target.ref), expectedRevision: 1 }], commandId);
  };

  // Prove the frozen domain seeds through the existing real material policy,
  // body integrity and source capture, before any M2 unsupported assertion.
  const ordinary = createMaterialService({ bodies, authority,
    grants: createMaterialAccessResolver(authority, index, source), now: () => AT });
  for (const [reader, target, text] of [[readerRef, material, 'm2 body A'], [readerBRef, materialB, 'm2 body B']] as const) {
    expect(await ordinary.openArtifact(ctxFor(reader, basis), { ref: target, usage: 'current' }))
      .toMatchObject({ status: 'ready', value: { ref: target, body: text, applicability: 'current' } });
  }

  return {
    kind, directory, records: backend.records, bodies, authority, index, source, sourcePin, sourceSet,
    workspace, goal, ownerRef, readerRef, readerBRef, ownerSnapshot, readerSnapshot, readerBSnapshot,
    material, materialB, selfMaterial, grant, grantB, basis, keyOf, encode, commit, eventRow, seedRevocation, ctxFor,
    async close() { await backend.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
type Fixture = Awaited<ReturnType<typeof buildFixture>>;

function factsService(fixture: Fixture,
  overrides: { authority?: MaterialAuthorityReads; index?: MaterialCandidateReads; source?: SourceApplicabilityPort } = {}): MaterialReadFactsPort {
  return createMaterialReadFactsService({ authority: overrides.authority ?? fixture.authority,
    index: overrides.index ?? fixture.index, bodies: fixture.bodies,
    ...(overrides.source !== undefined ? { sourceApplicability: overrides.source }
      : { sourceApplicability: fixture.source }), now: () => AT });
}

// 1. Exact current read returns the real body/current applicability and only the
//    canonical guards of that decision; an unrelated formal commit does not
//    invalidate a commit that carries exactly those guards.
it.each(['memory', 'sqlite'] as const)('%s: current facts carry exactly the guarded window and survive an unrelated commit', async kind => {
  const fixture = await buildFixture(kind);
  try {
    const ctx = fixture.ctxFor(fixture.readerRef, fixture.basis);
    // The ordinary chain is real and valid before the facts port is asked.
    const materials = createMaterialService({ bodies: fixture.bodies, authority: fixture.authority,
      grants: createMaterialAccessResolver(fixture.authority, fixture.index, fixture.source), now: () => AT });
    await expect(materials.openArtifact(ctx, { ref: fixture.material, usage: 'current' }))
      .resolves.toMatchObject({ status: 'ready', value: { body: 'm2 body A', applicability: 'current' } });

    const facts = await factsService(fixture).openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' });
    expect(facts.result).toMatchObject({ status: 'ready', value: { body: 'm2 body A', applicability: 'current' } });
    const guards = guardMap(facts.guards);
    expect(guards.size).toBe(4);
    expect(facts.guards).toHaveLength(4); // duplicate/conflicting keys may not be hidden by the projection
    expect(guards.get(fixture.keyOf(fixture.readerRef))).toBe(1);
    expect(guards.get(fixture.keyOf(fixture.goal.ref))).toBe(1);
    expect(guards.get(fixture.keyOf(fixture.workspace.ref))).toBe(1);
    expect(guards.get(fixture.keyOf(fixture.grant.ref))).toBe(1);
    expect(guards.has(fixture.keyOf(fixture.ownerRef))).toBe(false);
    expect(guards.has(fixture.keyOf(fixture.grantB.ref))).toBe(false);

    // An unrelated grant for the same reader advances the ledger and the index.
    const unrelated = (() => {
      const value: MaterialAccessGrantV1 = { schemaVersion: 1, grantId: 'm2-unrelated',
        scope: { projectId, workspaceId, goalId }, materials: [fixture.materialB], reader: fixture.readerRef,
        issuedBy: { aggregateType: 'Control', projectId, goalId }, purpose: 'unrelated', basis: fixture.basis, grantedAt: AT };
      return { ref: { aggregateType: 'MaterialAccessGrant' as const, projectId, workspaceId, goalId, grantId: 'm2-unrelated' },
        revision: 1 as const, schemaVersion: 1 as const, grant: value } satisfies MaterialAccessGrantSnapshot;
    })();
    await expect(fixture.commit([fixture.encode(unrelated)],
      [{ refKey: fixture.keyOf(unrelated.ref), expectedRevision: null }], 'unrelated-grant'))
      .resolves.toMatchObject({ status: 'committed' });

    // Only the facts guards: no global horizon or candidate-set version lock.
    const onlyGuards = await fixture.records.commit({ identityKey: 'm2-facts-only', fingerprint: 'm2-facts-only',
      guards: facts.guards, records: [], events: [fixture.eventRow('facts-only')], claims: [], indexGuards: [], indexChanges: [] });
    expect(onlyGuards).toMatchObject({ status: 'committed' });
  } finally { await fixture.close(); }
});

// 2. A revocation after the facts conflict the guarded commit and a fresh read
//    refuses current; the failed commit publishes neither record nor event.
it.each(['memory', 'sqlite'] as const)('%s: revocation after facts conflicts the guarded commit and fresh facts refuse', async kind => {
  const fixture = await buildFixture(kind);
  try {
    const ctx = fixture.ctxFor(fixture.readerRef, fixture.basis);
    const facts = await factsService(fixture).openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' });
    expect(facts.result).toMatchObject({ status: 'ready' });

    // The formal writer is still a skeleton, so the explicit domain seed is the
    // available revoker; it is a real CAS 1 -> 2 on the canonical record.
    const revoked = await fixture.seedRevocation(fixture.grant, 'm2-revoke');
    expect(revoked).toMatchObject({ status: 'committed' });

    const before = await fixture.records.readMany([]);
    if (before.status !== 'ready') throw Error('M2 cannot read ledger horizon');
    const target = (() => {
      const value: MaterialAccessGrantV1 = { schemaVersion: 1, grantId: 'm2-target',
        scope: { projectId, workspaceId, goalId }, materials: [fixture.materialB], reader: fixture.readerRef,
        issuedBy: { aggregateType: 'Control', projectId, goalId }, purpose: 'target', basis: fixture.basis, grantedAt: AT };
      return { ref: { aggregateType: 'MaterialAccessGrant' as const, projectId, workspaceId, goalId, grantId: 'm2-target' },
        revision: 1 as const, schemaVersion: 1 as const, grant: value } satisfies MaterialAccessGrantSnapshot;
    })();
    const targetKey = fixture.keyOf(target.ref);
    const attempt = await fixture.records.commit({ identityKey: 'm2-target-commit', fingerprint: 'm2-target-commit',
      guards: [...facts.guards, { refKey: targetKey, expectedRevision: null }], records: [fixture.encode(target)],
      events: [fixture.eventRow('target')], claims: [], indexGuards: [], indexChanges: [] });
    expect(attempt).toMatchObject({ status: 'rejected', code: 'revision_conflict' });

    const after = await fixture.records.readMany([]);
    if (after.status !== 'ready') throw Error('M2 cannot read ledger horizon');
    expect(after.value.readThrough).toBe(before.value.readThrough);
    await expect(fixture.records.readMany([targetKey]))
      .resolves.toMatchObject({ status: 'ready', value: { missing: [targetKey] } });

    const fresh = await factsService(fixture).openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' });
    expect(fresh.result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(fresh.guards).toEqual([]);
  } finally { await fixture.close(); }
});

// 3. Source capture happens before the final grant re-read: a revocation during
//    capture must not yield ready facts. Two versions of one key inside a single
//    real authority read window must conflict, never deliver mixed guards.
it('never returns ready facts when revocation lands during capture, and mixed versions conflict', async () => {
  const fixture = await buildFixture('memory');
  try {
    const ctx = fixture.ctxFor(fixture.readerRef, fixture.basis);
    await expect(factsService(fixture).openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' }))
      .resolves.toMatchObject({ result: { status: 'ready' } });

    const gated = gatedSource(fixture.source);
    const pending = factsService(fixture, { source: gated.source }).openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' });
    try {
      await Promise.race([gated.entered, pending.then(() => { throw Error('facts returned before capture'); })]);
      expect(await fixture.seedRevocation(fixture.grant, 'm2-revoke-during-capture')).toMatchObject({ status: 'committed' });
    } finally { gated.release(); }
    const duringCapture = await pending;
    expect(duringCapture.result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(duringCapture.guards).toEqual([]);

    // Same call, real authority reads: change the reader's canonical version
    // between the first and second load of that exact key. Use B's still-valid
    // grant, so this rejection cannot merely be A's preceding revocation.
    const readerKey = fixture.keyOf(fixture.readerBRef);
    let readerLoads = 0;
    const bumping: MaterialAuthorityReads = {
      async load(ref) {
        if (fixture.keyOf(ref) === readerKey) {
          readerLoads += 1;
          if (readerLoads === 2) {
            await fixture.commit([fixture.encode({ ...fixture.readerBSnapshot, revision: 2 })],
              [{ refKey: readerKey, expectedRevision: 1 }], 'bump-reader');
          }
        }
        return fixture.authority.load(ref);
      },
    };
    const mixed = await factsService(fixture, { authority: bumping }).openArtifactFacts(
      fixture.ctxFor(fixture.readerBRef, fixture.basis), { ref: fixture.materialB, usage: 'current' });
    expect(readerLoads).toBeGreaterThanOrEqual(2);
    expect(mixed.result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(mixed.guards).toEqual([]);
  } finally { await fixture.close(); }
});

// 4. Candidate/source matches never replace real currentness; failed authorities
//    stay unavailable instead of becoming missing/empty success; historical
//    ownership never bypasses a current grant.
it('candidate and source matches do not replace currentness and unavailable stays unavailable', async () => {
  const fixture = await buildFixture('memory');
  try {
    const ctx = fixture.ctxFor(fixture.readerRef, fixture.basis);
    await expect(factsService(fixture).openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' }))
      .resolves.toMatchObject({ result: { status: 'ready' } });

    // Missing trusted provider keeps the existing source_stale refusal.
    const noSource = createMaterialReadFactsService({ authority: fixture.authority, index: fixture.index,
      bodies: fixture.bodies, now: () => AT });
    await expect(noSource.openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' }))
      .resolves.toMatchObject({ result: { status: 'rejected', code: 'source_stale' }, guards: [] });

    // A provider that returns a valid-shaped but wrong pin is still not current.
    const wrongPin: SourceApplicabilityPort = {
      async capture(query, signal) {
        const capturedPin = await fixture.source.capture(query, signal);
        if (capturedPin.status !== 'sourced') return capturedPin;
        return { status: 'sourced', pin: { ...capturedPin.pin, manifestDigest: 'f'.repeat(64) } };
      },
    };
    await expect(factsService(fixture, { source: wrongPin }).openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' }))
      .resolves.toMatchObject({ result: { status: 'rejected', code: 'source_stale' }, guards: [] });

    // A ctx scope that does not match the canonical reader is forbidden.
    const scopeMismatch: CoreCallContext = { ...ctx, workspaceId: 'm2-other-workspace' };
    await expect(factsService(fixture).openArtifactFacts(scopeMismatch, { ref: fixture.material, usage: 'current' }))
      .resolves.toMatchObject({ result: { status: 'rejected', code: 'forbidden' }, guards: [] });

    // Canonical authority unavailable must not be projected to forbidden/[].
    const grantKey = fixture.keyOf(fixture.grant.ref);
    const unavailableAuthority: MaterialAuthorityReads = {
      async load(ref) {
        if (fixture.keyOf(ref) === grantKey) return { status: 'unavailable', reason: 'm2 authority unavailable' };
        return fixture.authority.load(ref);
      },
    };
    const unavailableGrant = await factsService(fixture, { authority: unavailableAuthority })
      .openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' });
    expect(unavailableGrant.result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(unavailableGrant.guards).toEqual([]);

    // Candidate provider unavailable must not become an empty successful grant.
    const unavailableIndex: MaterialCandidateReads = {
      async materialAccessCandidates() { return { status: 'unavailable', reason: 'm2 candidate unavailable' }; },
    };
    const unavailableCandidate = await factsService(fixture, { index: unavailableIndex })
      .openArtifactFacts(ctx, { ref: fixture.material, usage: 'current' });
    expect(unavailableCandidate.result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(unavailableCandidate.guards).toEqual([]);

    // Ownership only helps a historical read; usage=current still needs a grant.
    const selfCurrent = await factsService(fixture).openArtifactFacts(ctx, { ref: fixture.selfMaterial, usage: 'current' });
    expect(selfCurrent).toMatchObject({ result: { status: 'rejected', code: 'forbidden' }, guards: [] });
    await expect(factsService(fixture).openArtifactFacts(ctx, { ref: fixture.selfMaterial, usage: 'historical_explanation' }))
      .resolves.toMatchObject({ result: { status: 'ready', value: { applicability: 'historical_explanation' } } });
  } finally { await fixture.close(); }
});

// 5. Interleaved calls keep per-call guards; a cancellation during capture yields
//    no ready facts and never pollutes the other call.
it('interleaved calls keep local guards and a cancelled capture yields no ready facts', async () => {
  const fixture = await buildFixture('memory');
  let pending: Promise<Awaited<ReturnType<MaterialReadFactsPort['openArtifactFacts']>>> | undefined;
  let releasePending: (() => void) | undefined;
  try {
    const ctxA = fixture.ctxFor(fixture.readerRef, fixture.basis);
    const ctxB = fixture.ctxFor(fixture.readerBRef, fixture.basis);
    type CaptureGate = { entered: ReturnType<typeof deferred>; resume: ReturnType<typeof deferred>; signal?: AbortSignal };
    let nextGate: CaptureGate | undefined;
    const source: SourceApplicabilityPort = { async capture(query, signal) {
      const gate = nextGate;
      nextGate = undefined;
      if (gate) {
        if (signal !== undefined) gate.signal = signal;
        gate.entered.resolve();
        await gate.resume.promise;
      }
      return fixture.source.capture(query, signal);
    } };
    const port = factsService(fixture, { source });
    // Positive prerequisite keeps the Stage-1 RED at unsupported, without
    // waiting forever for a capture the skeleton deliberately never invokes.
    expect(await port.openArtifactFacts(ctxA, { ref: fixture.material, usage: 'current' }))
      .toMatchObject({ result: { status: 'ready' } });

    const first: CaptureGate = { entered: deferred(), resume: deferred() };
    nextGate = first; releasePending = first.resume.resolve;
    pending = port.openArtifactFacts(ctxA, { ref: fixture.material, usage: 'current' });
    await Promise.race([first.entered.promise, pending.then(() => { throw Error('facts returned before reaching source capture'); })]);
    // A already collected reader/grant facts. B completes on the SAME service
    // while A is suspended, exposing any instance-wide mutable read set.
    const factsB = await port.openArtifactFacts(ctxB, { ref: fixture.materialB, usage: 'current' });
    first.resume.resolve();
    const factsA = await pending;
    pending = undefined; releasePending = undefined;
    expect(factsA.result).toMatchObject({ status: 'ready', value: { body: 'm2 body A', applicability: 'current' } });
    expect(factsB.result).toMatchObject({ status: 'ready', value: { body: 'm2 body B', applicability: 'current' } });
    const aKeys = new Set(factsA.guards.map(guard => guard.refKey));
    const bKeys = new Set(factsB.guards.map(guard => guard.refKey));
    expect(aKeys.has(fixture.keyOf(fixture.grant.ref))).toBe(true);
    expect(bKeys.has(fixture.keyOf(fixture.grantB.ref))).toBe(true);
    expect(aKeys.has(fixture.keyOf(fixture.readerBRef))).toBe(false);
    expect(bKeys.has(fixture.keyOf(fixture.readerRef))).toBe(false);
    expect(aKeys.has(fixture.keyOf(fixture.grantB.ref))).toBe(false);
    expect(bKeys.has(fixture.keyOf(fixture.grant.ref))).toBe(false);
    expect(factsA.guards).toHaveLength(aKeys.size);
    expect(factsB.guards).toHaveLength(bKeys.size);

    const second: CaptureGate = { entered: deferred(), resume: deferred() };
    nextGate = second; releasePending = second.resume.resolve;
    const controller = new AbortController();
    pending = port.openArtifactFacts({ ...ctxA, signal: controller.signal }, { ref: fixture.material, usage: 'current' });
    await Promise.race([second.entered.promise, pending.then(() => { throw Error('facts returned before reaching cancellable capture'); })]);
    expect(second.signal).toBe(controller.signal);
    controller.abort();
    second.resume.resolve();
    const cancelled = await pending;
    pending = undefined; releasePending = undefined;
    expect(cancelled).toMatchObject({ result: { status: 'rejected', code: 'cancelled' }, guards: [] });
    // The same instance must remain usable and B's facts must still be local.
    const after = await port.openArtifactFacts(ctxB, { ref: fixture.materialB, usage: 'current' });
    expect(after.result).toEqual(factsB.result);
    expect(guardMap(after.guards)).toEqual(guardMap(factsB.guards));
    expect(after.guards).toHaveLength(factsB.guards.length);
  } finally {
    releasePending?.();
    await pending?.catch(() => undefined);
    await fixture.close();
  }
});
