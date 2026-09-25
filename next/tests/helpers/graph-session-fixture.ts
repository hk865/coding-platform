/**
 * A1 shared behavior-test fixture.
 *
 * It builds a REAL scope (Project/Workspace + a CompletionPolicy) over the real
 * Memory/SQLite RecordStore, and exposes the REAL existing Session directory
 * plus the new (skeleton) architecture-catalog and Session-lifecycle services.
 *
 * The fixture never fabricates a successful lifecycle result: every link,
 * archive or reactivate goes through the formal service. Missing production
 * behavior stays RED; the fixture only seeds trusted scope and, when a test
 * explicitly asks, a legacy baseline without a catalog.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type {
  ModuleRef, SessionRef, VersionPin, WorkLinkRelation, WorkLinkTarget, WorkspaceScope,
} from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { ArchitectureBaselineRevisionRef, CompletionPolicyRevisionRef } from '../../src/contracts/governance.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalRef, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas, RecordGuard,
  StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import type { LookupValue, RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import {
  GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeGoalSnapshot, encodeProjectSnapshot, encodeWorkspaceSnapshot,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import {
  SESSION_RECORD_SCHEMAS, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/sessions/contracts.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type {
  AdoptedArchitecture, AdoptInitialArchitectureInput, ArchitectureCatalogPort, ArchitectureRevision,
  ReadArchitectureRevisionInput,
} from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { GraphWrite as ArchitectureGraphWrite } from '../../src/core/work-graph/architecture/contracts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import type { LinkSessionWorkInput, ArchiveSessionInput } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import type { SessionLifecyclePort } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import type { GraphWrite as SessionGraphWrite } from '../../src/core/work-graph/sessions/contracts.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';

export const GRAPH_FIXTURE_AT = '2026-09-24T00:00:00.000Z';
export const GRAPH_MODULE_ONE = 'work-graph';
export const GRAPH_MODULE_TWO = 'record-store';

export type GraphFixtureKind = 'memory' | 'sqlite';

/** Counts the physical calls made through the injected records port. Fixture
 * setup uses the raw backend, so a spy read after `resetSpy()` reflects one
 * measured operation alone. */
export type GraphRecordSpy = {
  readMany: string[][];
  lookups: { index: string; values: LookupValue[] }[];
  commits: number;
  lookupCommits: number;
  eventAt: number;
  lookupRecords: number;
  readManyRecords: number;
  prepared: PreparedCommit[];
};

export type GraphRecords = GoalRecordTransactionPort & RecordLookupPort;

export type GraphAcceptedTask = {
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  taskRef: { projectId: string; goalId: string; taskId: string };
};

export type GraphSessionConnection = {
  records: GraphRecords;
  catalog: ArchitectureCatalogPort;
  lifecycle: SessionLifecyclePort;
  sessionsPort: SessionDirectoryPort;
};

export type GraphSessionFixture = {
  kind: GraphFixtureKind;
  directory: string;
  ledgerPath: string;
  records: GraphRecords;
  spy: GraphRecordSpy;
  catalog: ArchitectureCatalogPort;
  lifecycle: SessionLifecyclePort;
  sessionsPort: SessionDirectoryPort;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  projectId: string;
  workspaceId: string;
  projectRef: ProjectSnapshot['ref'];
  workspaceRef: WorkspaceSnapshot['ref'];
  moduleRef(moduleId: string): ModuleRef;
  adopt(
    requestId: string,
    overrides?: Partial<AdoptInitialArchitectureInput>,
    ctxOverride?: CoreCallContext,
  ): Promise<WriteResult<ArchitectureRevision>>;
  readRevision(
    selection: 'current' | ArchitectureBaselineRevisionRef,
    ctxOverride?: CoreCallContext,
  ): Promise<ReadResult<ArchitectureRevision>>;
  createSession(
    requestId: string,
    initialLinks?: { target: WorkLinkTarget; relation: WorkLinkRelation }[],
  ): Promise<SessionRef>;
  /** Trusted fixture seed of a baseline + active pointer with NO catalog row;
   * used to prove the historical `catalog: null` read path. */
  seedLegacyArchitectureBaseline(baselineId?: string): Promise<ArchitectureBaselineRevisionRef>;
  /** Trusted fixture seed with a shape-valid but digest-inconsistent baseline;
   * such a record is stored successfully but must never be read as healthy. */
  seedTamperedArchitectureBaseline(baselineId?: string): Promise<ArchitectureBaselineRevisionRef>;
  seedAcceptedTask(): Promise<GraphAcceptedTask>;
  /** Test-only direct rewrite of one Session (e.g. to set occupancy); never used
   * to fabricate an archive/reactivate result. */
  overwriteSession(ref: SessionRef, mutate: (record: SessionRecord) => SessionRecord): Promise<SessionRecord>;
  commitRaw(records: readonly EncodedRecord[], guards?: readonly RecordGuard[]): Promise<StoreCommitReceipt>;
  resetSpy(): void;
  failNextWrite(): void;
  readonly injectedFailures: number;
  reopen(): Promise<GraphSessionConnection>;
  close(): Promise<void>;
};

export function sampleCatalog(projectId: string): AdoptedArchitecture {
  return {
    modules: [
      {
        ref: { projectId, moduleId: GRAPH_MODULE_ONE },
        name: 'WorkGraph',
        responsibility: 'Own work structures, links and queries',
        paths: ['src/core/work-graph'],
        interfaces: [{ id: 'sessions', description: 'Session directory', paths: ['src/core/work-graph/sessions'] }],
      },
      {
        ref: { projectId, moduleId: GRAPH_MODULE_TWO },
        name: 'RecordStore',
        responsibility: 'Own persistence, CAS and idempotency',
        paths: ['src/core/record-store'],
        interfaces: [],
      },
    ],
    dependencies: [
      {
        from: { projectId, moduleId: GRAPH_MODULE_ONE },
        to: { projectId, moduleId: GRAPH_MODULE_TWO },
        reason: 'WorkGraph persists through RecordStore',
      },
    ],
    requireDag: true,
  };
}

function emptySpy(): GraphRecordSpy {
  return { readMany: [], lookups: [], commits: 0, lookupCommits: 0, eventAt: 0, lookupRecords: 0, readManyRecords: 0, prepared: [] };
}

function wrapRecords(target: GraphRecords, spy: GraphRecordSpy): GraphRecords {
  return {
    async readMany(refKeys) {
      spy.readMany.push([...refKeys]);
      const result = await target.readMany(refKeys);
      if (result.status === 'ready') spy.readManyRecords += result.value.records.length;
      return result;
    },
    lookupCommit(input) { spy.lookupCommits += 1; return target.lookupCommit(input); },
    commit(input) { spy.commits += 1; spy.prepared.push(structuredClone(input)); return target.commit(input); },
    eventAt(cursor) { spy.eventAt += 1; return target.eventAt(cursor); },
    async lookup(request) {
      spy.lookups.push({ index: request.index, values: [...request.values] });
      const result = await target.lookup(request);
      if (result.status === 'ready') spy.lookupRecords += result.value.records.length;
      return result;
    },
  };
}

export const encodeGraphGovernance = (
  snapshot:
    | { ref: CompletionPolicyRevisionRef; revision: number; schemaVersion: number; policyId: string;
        contentRevision: number; contentDigest: string; content: unknown }
    | { ref: ArchitectureBaselineRevisionRef; revision: number; schemaVersion: number; baselineId: string;
        contentRevision: number; contentDigest: string; content: unknown }
    | { ref: { aggregateType: 'ProjectCompletionPolicyActive'; projectId: string }; projectId: string;
        revision: number; activeRevision: CompletionPolicyRevisionRef }
    | { ref: { aggregateType: 'ProjectArchitectureBaselineActive'; projectId: string }; projectId: string;
        revision: number; activeRevision: ArchitectureBaselineRevisionRef },
): EncodedRecord => ({
  refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
  schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
  revision: snapshot.revision,
  json: JSON.stringify(snapshot),
});

/** Caller pins, not writer-invented optimistic defaults. Revision zero denotes
 * an absent link in CommandMeta; the Store CAS translates it to null. */
export async function linkRequest(f: GraphSessionFixture, sessionRef: SessionRef, target: WorkLinkTarget,
  relation: WorkLinkRelation, active: boolean, requestId: string,
  expected?: readonly VersionPin[]): Promise<SessionGraphWrite<LinkSessionWorkInput>> {
  const linkRef = { ...sessionRef, aggregateType: 'SessionWorkLink' as const, target, relation };
  const sessionRefWithType = plainSessionRefToAggregate(sessionRef);
  const refs = [sessionRefWithType, linkRef];
  const read = await f.records.readMany(refs.map(ref => canonicalJson(ref as unknown as JsonValue)));
  if (read.status !== 'ready') throw new Error('cannot build exact lifecycle pins');
  const pins = refs.map(ref => ({ ref, revision: read.value.records.find(record =>
    record.refKey === canonicalJson(ref as unknown as JsonValue))?.revision ?? 0 }));
  if (pins[0]!.revision === 0) throw new Error('fixture Session is absent');
  return { input: { sessionRef, target, relation, active }, meta: { requestId, expected: expected ?? pins } };
}

export async function lifecycleRequest(f: GraphSessionFixture, sessionRef: SessionRef, requestId: string,
  reason = 'explicit lifecycle transition', expected?: readonly VersionPin[]): Promise<SessionGraphWrite<ArchiveSessionInput>> {
  const ref = plainSessionRefToAggregate(sessionRef);
  const read = await f.records.readMany([sessionAggregateRefKey(ref)]);
  if (read.status !== 'ready' || read.value.records.length !== 1) throw new Error('fixture Session unavailable');
  return { input: { sessionRef, reason }, meta: { requestId,
    expected: expected ?? [{ ref, revision: read.value.records[0]!.revision }] } };
}

/** Every writer reaches commit before release; early rejection also releases
 * peers, yielding an assertion failure rather than hanging a broken skeleton. */
export function commitBarrier(target: GraphRecords, participants = 2) {
  let arrived = 0;
  let finished = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const maybeRelease = () => { if (arrived + finished >= participants) release(); };
  return {
    get arrivals() { return arrived; },
    records: { ...target, async commit(batch) {
      arrived += 1; maybeRelease(); await ready; return target.commit(batch);
    } } satisfies GraphRecords,
    async run<T>(call: () => Promise<T>) {
      try { return await call(); } finally { finished += 1; maybeRelease(); }
    },
  };
}

export async function createGraphSessionFixture(kind: GraphFixtureKind = 'memory'): Promise<GraphSessionFixture> {
  const directory = await mkdtemp(join(tmpdir(), `next-a1-graph-${kind}-`));
  const ledgerPath = join(directory, 'ledger.sqlite');
  const schemas: RecordBackendSchemas = {
    records: [
      ...GOAL_RECORD_SCHEMAS.records,
      ...PLAN_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
      ...SESSION_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records,
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records,
      ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...TASK_CLAIM_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records,
      ...materialRecordSchemas().records.filter(schema => schema.aggregateType === 'Run'),
    ],
    events: [
      ...GOAL_RECORD_SCHEMAS.events,
      ...PLAN_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events,
      ...SESSION_RECORD_SCHEMAS.events,
      ...ARCHITECTURE_CATALOG_SCHEMAS.events,
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
      ...TASK_CLAIM_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events,
      { eventType: 'TrustedScopeSeeded', schemaVersion: 1,
        validate: event => ({ status: 'decoded', value: event }) },
    ],
    lookups: [
      ...(SESSION_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? []),
      ...(ROLE_RECORD_SCHEMAS.lookups ?? []),
    ],
  };
  let failWrite = false;
  let injectedFailures = 0;
  const beforeWrite = () => {
    if (!failWrite) return;
    failWrite = false;
    injectedFailures += 1;
    throw new Error('A1 injected transaction failure');
  };
  let backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas, beforeWrite })
    : createSqliteRecordBackend({ path: ledgerPath, schemas, beforeWrite });

  const projectId = 'a1-graph-project';
  const workspaceId = 'a1-graph-workspace';
  const scope: WorkspaceScope = { projectId, workspaceId };
  const projectRef: ProjectSnapshot['ref'] = { aggregateType: 'Project', projectId };
  const workspaceRef: WorkspaceSnapshot['ref'] = { aggregateType: 'Workspace', projectId, workspaceId };
  const actor = { kind: 'human' as const, id: 'a1-graph-operator' };
  const ctx: CoreCallContext = {
    projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
  };
  const role = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
  const kernelAdapterId = 'a1-graph-kernel';
  const kernelStoreKey = 'a1-graph-kernel-store';

  // ---- trusted scope seed: Project/Workspace + CompletionPolicy only ---------
  const policyRef: CompletionPolicyRevisionRef = {
    aggregateType: 'CompletionPolicyRevision', projectId, policyId: 'a1-policy', revision: 1,
  };
  const policyFixture = { schemaVersion: 1, identity: { policyId: 'a1-policy' }, revision: 1,
    content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } };
  const policySnapshot = { ref: policyRef, revision: 1, schemaVersion: 1, policyId: policyRef.policyId,
    contentRevision: 1, contentDigest: sha256Hex(canonicalJson(policyFixture as unknown as JsonValue)),
    content: policyFixture.content };
  const policyActive = { ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId },
    projectId, revision: 1, activeRevision: policyRef };
  const project: ProjectSnapshot = { ref: projectRef, revision: 1 };
  const workspace: WorkspaceSnapshot = { ref: workspaceRef, revision: 1 };
  const seedEvent = { eventId: 'a1-graph-scope-seed', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: GRAPH_FIXTURE_AT, json: JSON.stringify({ eventId: 'a1-graph-scope-seed',
      eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: GRAPH_FIXTURE_AT }) };
  const scopeSeed: PreparedCommit = {
    identityKey: 'a1-graph-scope-seed', fingerprint: 'a1-graph-scope-seed-v1',
    guards: [
      { refKey: canonicalRefKey(projectRef), expectedRevision: null },
      { refKey: canonicalRefKey(workspaceRef), expectedRevision: null },
      { refKey: canonicalJson(policyRef as unknown as JsonValue), expectedRevision: null },
      { refKey: canonicalJson(policyActive.ref as unknown as JsonValue), expectedRevision: null },
    ],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace),
      encodeGraphGovernance(policySnapshot), encodeGraphGovernance(policyActive)],
    claims: [], events: [seedEvent], indexGuards: [], indexChanges: [],
  };
  const seeded = await backend.records.commit(scopeSeed);
  if (seeded.status !== 'committed') throw new Error(`A1 scope seed failed: ${seeded.reason}`);

  // ---- real services over the real backend ----------------------------------
  const spy = emptySpy();
  let wrapped = wrapRecords(backend.records, spy);
  let catalog: ArchitectureCatalogPort = createArchitectureCatalogService({ records: wrapped });
  let lifecycle: SessionLifecyclePort = createSessionLifecycleService({ records: wrapped, lookups: wrapped });
  let sessionsPort: SessionDirectoryPort = createSessionDirectory({ records: wrapped, lookups: wrapped });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: kernelAdapterId, storeKey: kernelStoreKey, workspace: scope,
    databasePath: join(directory, 'kernel.sqlite'),
  }] });

  let seedSeq = 0;
  let requestSeq = 0;

  async function commitRaw(recordsToWrite: readonly EncodedRecord[],
    guards: readonly RecordGuard[] = []): Promise<StoreCommitReceipt> {
    const sequence = ++seedSeq;
    const guarded = new Set(guards.map(guard => guard.refKey));
    const allGuards: RecordGuard[] = [...guards,
      ...recordsToWrite.filter(record => !guarded.has(record.refKey))
        .map(record => ({ refKey: record.refKey, expectedRevision: null }))];
    const event = { eventId: `a1-graph-seed-event-${sequence}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      occurredAt: GRAPH_FIXTURE_AT, json: JSON.stringify({ eventId: `a1-graph-seed-event-${sequence}`,
        eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: GRAPH_FIXTURE_AT }) };
    return backend.records.commit({ identityKey: `a1-graph-seed-${sequence}`,
      fingerprint: `a1-graph-seed-fingerprint-${sequence}`, guards: allGuards,
      records: [...recordsToWrite], events: [event], claims: [], indexGuards: [], indexChanges: [] });
  }

  async function createSession(requestId: string,
    initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[] = []): Promise<SessionRef> {
    const admitted = await sessionsPort.admitSessionCreation(ctx, {
      meta: { requestId: `admit-${requestId}`, expected: [] },
      input: { workspace: scope, kernelStore: { adapterId: kernelAdapterId, storeKey: kernelStoreKey },
        role, recommendedRefs: [], initialLinks },
    });
    if (admitted.status !== 'committed') throw new Error(`A1 session admission failed: ${JSON.stringify(admitted)}`);
    const kernelSessionId = `a1-graph-kernel-session-${requestId}`;
    await kernelStores.withStore(kernelAdapterId, store => store.create({
      sessionId: kernelSessionId, recordId: `a1-graph-kernel-record-${requestId}`, createdAt: GRAPH_FIXTURE_AT,
    }, { signal: ctx.signal }));
    const registered = await sessionsPort.recordSessionCreated(ctx, {
      meta: { requestId: `register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: kernelAdapterId, kernelSessionId, historyCursor: null, observedAt: GRAPH_FIXTURE_AT },
    });
    if (registered.status !== 'committed') throw new Error(`A1 session registration failed: ${JSON.stringify(registered)}`);
    return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
  }

  async function seedLegacyArchitectureBaseline(baselineId = 'a1-legacy-baseline'): Promise<ArchitectureBaselineRevisionRef> {
    const baselineRef: ArchitectureBaselineRevisionRef = {
      aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId, revision: 1,
    };
    const fixture = { schemaVersion: 1, identity: { baselineId }, revision: 1,
      content: { schemaVersion: 1, description: 'Legacy baseline without a catalog', constraints: [] } };
    const snapshot = { ref: baselineRef, revision: 1, schemaVersion: 1, baselineId,
      contentRevision: 1, contentDigest: sha256Hex(canonicalJson(fixture as unknown as JsonValue)),
      content: fixture.content };
    const active = { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId },
      projectId, revision: 1, activeRevision: baselineRef };
    const committed = await commitRaw([encodeGraphGovernance(snapshot), encodeGraphGovernance(active)]);
    if (committed.status !== 'committed') throw new Error(`A1 legacy baseline seed failed: ${JSON.stringify(committed)}`);
    return baselineRef;
  }

  async function seedTamperedArchitectureBaseline(baselineId = 'a1-tampered-baseline'): Promise<ArchitectureBaselineRevisionRef> {
    const baselineRef: ArchitectureBaselineRevisionRef = {
      aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId, revision: 1,
    };
    const snapshot = { ref: baselineRef, revision: 1, schemaVersion: 1, baselineId,
      contentRevision: 1, contentDigest: sha256Hex('a1-tampered-digest'),
      content: { schemaVersion: 1, description: 'Digest does not match the body', constraints: [] } };
    const active = { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId },
      projectId, revision: 1, activeRevision: baselineRef };
    const committed = await commitRaw([encodeGraphGovernance(snapshot), encodeGraphGovernance(active)]);
    if (committed.status !== 'committed') throw new Error(`A1 tampered baseline seed failed: ${JSON.stringify(committed)}`);
    return baselineRef;
  }

  async function seedAcceptedTask(): Promise<GraphAcceptedTask> {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'a1-goal' };
    const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId, planId: 'a1-plan' };
    const goalWorkspaceRef = { aggregateType: 'Workspace' as const, projectId, workspaceId };
    const firstGoal = { ref: goalRef, workspaceRef: goalWorkspaceRef, objective: 'Deliver the A1 work',
      desiredState: 'active' as const, activePlanRevision: null, revision: 1 };
    const goalSeed = await commitRaw([encodeGoalSnapshot(firstGoal)]);
    if (goalSeed.status !== 'committed') throw new Error(`A1 goal seed failed: ${JSON.stringify(goalSeed)}`);
    const architecturePin = { ref: { aggregateType: 'ArchitectureBaselineRevision' as const, projectId,
      baselineId: 'a1-plan-baseline', revision: 1 }, digest: sha256Hex('a1-plan-baseline') };
    const plan: PlanRevisionSnapshot = {
      ref: planRef, revision: 1, schemaVersion: 1, goalRef, planId: planRef.planId, planRevision: 1,
      acceptedAt: GRAPH_FIXTURE_AT,
      effectiveCompletionPolicy: { ref: policyRef, digest: policySnapshot.contentDigest },
      effectiveArchitectureBaseline: architecturePin,
      stages: [],
      tasks: [
        { taskId: 'implement', title: 'Implement', requirementLevel: 'required', taskKind: 'work',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        { taskId: 'goal-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
          disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      assignments: [{ taskId: 'implement', role: 'builder', instruction: 'Implement the accepted work' }],
      obligations: [{ obligationId: 'obligation-1', title: 'Deliver implementation', requirementLevel: 'required',
        taskIds: ['implement', 'goal-gate'],
        verificationRequirements: [{ requirementId: 'check-1', requirementLevel: 'required', kind: 'test',
          description: 'Tests pass' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    };
    const acceptedGoal = { ...firstGoal, activePlanRevision: planRef, revision: 2 };
    const planKey = canonicalJson(planRef as unknown as JsonValue);
    const accepted = await commitRaw([
      encodeGoalSnapshot(acceptedGoal),
      { refKey: planKey, schemaId: 'PlanRevisionSnapshot@1', revision: 1, json: JSON.stringify(plan) },
    ], [{ refKey: canonicalRefKey(goalRef), expectedRevision: 1 }]);
    if (accepted.status !== 'committed') throw new Error(`A1 plan seed failed: ${JSON.stringify(accepted)}`);
    return { goalRef, planRef, taskRef: { projectId, goalId: goalRef.goalId, taskId: 'implement' } };
  }

  async function overwriteSession(ref: SessionRef,
    mutate: (record: SessionRecord) => SessionRecord): Promise<SessionRecord> {
    const card = await sessionsPort.readSession(ctx, ref);
    if (card.status !== 'ready') throw new Error(`A1 Session rewrite read failed: ${JSON.stringify(card)}`);
    const current = card.value.record;
    const next: SessionRecord = { ...mutate(current), revision: current.revision + 1 };
    const committed = await commitRaw([encodeSessionRecord(next)],
      [{ refKey: sessionAggregateRefKey(current.ref), expectedRevision: current.revision }]);
    if (committed.status !== 'committed') throw new Error(`A1 Session rewrite failed: ${JSON.stringify(committed)}`);
    return next;
  }

  function buildConnection(): GraphSessionConnection {
    return { records: wrapped, catalog, lifecycle, sessionsPort };
  }

  const fixture: GraphSessionFixture = {
    kind, directory, ledgerPath, records: wrapped, spy, catalog, lifecycle, sessionsPort,
    ctx, scope, projectId, workspaceId, projectRef, workspaceRef,
    moduleRef(moduleId: string): ModuleRef { return { projectId, moduleId }; },
    async adopt(requestId, overrides = {}, ctxOverride) {
      const input: AdoptInitialArchitectureInput = {
        baselineId: overrides.baselineId ?? 'a1-baseline',
        catalog: overrides.catalog ?? sampleCatalog(projectId),
        description: overrides.description ?? 'A1 initial architecture',
        constraints: overrides.constraints ?? [{ name: 'formal module DAG', scope: 'project' }],
      };
      const request: ArchitectureGraphWrite<AdoptInitialArchitectureInput> = {
        input, meta: { requestId, expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
      };
      return catalog.adoptInitialArchitecture(ctxOverride ?? ctx, request);
    },
    async readRevision(selection, ctxOverride) {
      const input: ReadArchitectureRevisionInput = selection === 'current'
        ? { selection: { kind: 'current' } }
        : { selection: { kind: 'revision', ref: selection } };
      return catalog.readArchitectureRevision(ctxOverride ?? ctx, input);
    },
    createSession,
    seedLegacyArchitectureBaseline,
    seedTamperedArchitectureBaseline,
    seedAcceptedTask,
    overwriteSession,
    commitRaw,
    resetSpy() { Object.assign(spy, emptySpy()); },
    failNextWrite() { failWrite = true; },
    get injectedFailures() { return injectedFailures; },
    async reopen() {
      if (kind !== 'sqlite') return buildConnection();
      await backend.close();
      backend = createSqliteRecordBackend({ path: ledgerPath, schemas, beforeWrite });
      wrapped = wrapRecords(backend.records, spy);
      catalog = createArchitectureCatalogService({ records: wrapped });
      lifecycle = createSessionLifecycleService({ records: wrapped, lookups: wrapped });
      sessionsPort = createSessionDirectory({ records: wrapped, lookups: wrapped });
      // Keep the top-level fixture accessors pointing at the reopened backend.
      fixture.records = wrapped;
      fixture.catalog = catalog;
      fixture.lifecycle = lifecycle;
      fixture.sessionsPort = sessionsPort;
      return buildConnection();
    },
    async close() {
      await backend.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
  return fixture;
}
