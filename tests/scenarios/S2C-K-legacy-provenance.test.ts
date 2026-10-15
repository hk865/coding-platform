/**
 * Slice 2C row 2C-26 (LE4): a workspace whose only provenance-null Sessions are
 * seven old ones. Four are active and three archived; the archived P and the
 * active C are the one reliable continuation pair. Reading before maintenance
 * shows seven unchecked, P and C as separate lines and three archived rows;
 * running Workflow maintenance once backfills the four active Sessions
 * (C -> continuation of P, the other three -> `new`), so C joins P as a
 * two-segment chain, two archived rows remain, and the workspace still has three
 * unchecked archived Sessions. C's `executions` section stays `indexed` before
 * and after (a raw old QueryRun without `executionState` is never listed).
 *
 * Entry LE4 (spec §5.1, row 2C-26): the whole scenario runs on the real
 * `openHostScenario` framework. The maintenance pass is the Host composition's
 * own Workflow maintenance through `direct()` (`runMaintenance`), never a
 * separately assembled `createSessionMaintenanceService`; every assertion goes
 * through the real `lines/*` Host routes. The seven legacy Sessions themselves
 * are seeded at the storage boundary (spec §5 / §7 exception: today's writers
 * always write provenance), and one real requeue/claim sequence supplies C's
 * reliable predecessor evidence. One raw old QueryRun is likewise seeded at the
 * storage boundary.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkLinkRelation, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef, RuntimeEventV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas, RecordGuard, StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import type { SessionOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { encodeQueryRunSnapshotRecord } from '../../src/core/work-graph/queries/query-record-codecs.js';
import {
  encodeSessionOperationRecord, encodeSessionRecord, plainSessionRefToAggregate,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionRecord } from '../../src/core/work-graph/state/session-availability.js';
import { createExecutionEntryService, MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE_BINDING, AG2B_WORKSPACE_REF,
} from '../helpers/AG2b-collaboration-fixture.js';
import { crashedEvent, L_HOST } from '../helpers/S2C-L-runs-support.js';
import {
  archivedLineOf, lineArchived, lineList, lineOf, lineSection, ready, runMaintenance,
} from '../helpers/S2C-K-scenario-support.js';
import { platformRecordSchemas } from '../state/invariants.js';
import { cleanupScenarios, hostCtx, openHostScenario, SCENARIO_OPERATOR, type HostScenario, type Platform } from './harness.js';

/** The one seeded work Task every legacy Session relates to. */
const TASK_ID = 'implement-a';
/** The Host composition clock (`tests/scenarios/harness.ts` `openComposition`). */
const HOST_NOW = '2026-10-06T00:00:00.000Z';
const KERNEL_ADAPTER = 'ag2b-kernel';
const KERNEL_STORE = 'ag2b-kernel-store';
const LEGACY_ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: AG2B_SCOPE.projectId, planId: 'ag2b-plan' };
const TASK_REF = { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: TASK_ID };
const HOST_BUDGET: TaskBudgetV1 = { tokenBudget: 1_000_000, deadline: null };

type Records = GoalRecordTransactionPort & RecordLookupPort;

/**
 * The storage-boundary seed over the live Host files plus the real owner
 * services the Host composition publishes (`h.direct()`): raw record commits
 * for the legal old shapes today's writers cannot produce, and the Host's own
 * claim/requeue/session owners for everything else.
 */
type HostSeed = {
  records: Records;
  bodies: RawArtifactStorePort;
  platform: Platform;
  ctx: CoreCallContext;
  /** The Host workspace root, for the requeue's workspace host binding. */
  root: string;
  commitRaw(records: readonly EncodedRecord[], guards?: readonly RecordGuard[]): Promise<StoreCommitReceipt>;
  createLegacySession(requestId: string,
    initialLinks: readonly { target: WorkLinkTarget; relation: WorkLinkRelation }[]): Promise<SessionRef>;
  createBareLegacy(requestId: string): Promise<SessionRef>;
  workspaceRevision(): Promise<number>;
  close(): Promise<void>;
};

const openSeeds: HostSeed[] = [];

async function openHostSeed(h: HostScenario): Promise<HostSeed> {
  const base = platformRecordSchemas();
  const schemas: RecordBackendSchemas = {
    ...base,
    events: [...base.events, { eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      validate: event => ({ status: 'decoded' as const, value: event }) }],
  };
  const backend = createSqliteRecordBackend({ path: join(h.database, 'ledger.sqlite'), schemas });
  const bodies = createSqliteRawArtifactStore(join(h.database, 'artifacts.sqlite'));
  const platform = await h.direct();
  const ctx = hostCtx();
  const records = backend.records;
  let seq = 0;

  async function commitRaw(recordsToWrite: readonly EncodedRecord[],
    guards: readonly RecordGuard[] = []): Promise<StoreCommitReceipt> {
    const n = ++seq;
    const eventId = `s2c26-seed-event-${n}`;
    const event = { eventId, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: HOST_NOW,
      json: JSON.stringify({ eventId, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: HOST_NOW }) };
    const guarded = new Set(guards.map(guard => guard.refKey));
    const allGuards: RecordGuard[] = [...guards,
      ...recordsToWrite.filter(record => !guarded.has(record.refKey))
        .map(record => ({ refKey: record.refKey, expectedRevision: null }))];
    const prepared: PreparedCommit = { identityKey: `s2c26-seed-${n}`, fingerprint: `s2c26-seed-fingerprint-${n}`,
      guards: allGuards, records: [...recordsToWrite], events: [event], claims: [], indexGuards: [], indexChanges: [] };
    return records.commit(prepared);
  }

  /** D4-style legacy creation: an old accepted CoreOperation with no provenance, then the real completion entry. */
  async function createLegacySession(requestId: string,
    initialLinks: readonly { target: WorkLinkTarget; relation: WorkLinkRelation }[]): Promise<SessionRef> {
    const digest = sha256Hex(canonicalJson({ actor: SCENARIO_OPERATOR, projectId: AG2B_SCOPE.projectId, requestId }));
    const ref: SessionRef = { projectId: AG2B_SCOPE.projectId, sessionId: `session-${digest}` };
    const operation: SessionOperationRecord = {
      ref: { aggregateType: 'CoreOperation', projectId: AG2B_SCOPE.projectId, operationId: `legacy-${requestId}` },
      revision: 1,
      action: { kind: 'create', plannedSessionRef: ref, workspace: AG2B_SCOPE,
        kernelStore: { adapterId: KERNEL_ADAPTER, storeKey: KERNEL_STORE }, role: LEGACY_ROLE,
        recommendedRefs: [], initialLinks: [...initialLinks] },
      phase: 'accepted', requestedAt: HOST_NOW, updatedAt: HOST_NOW, observation: null, failure: null,
    };
    // Serialize the old keys explicitly; today's encoder must not normalize the old action to new.
    const encoded = encodeSessionOperationRecord(operation);
    const old = { ...encoded, json: JSON.stringify(operation) };
    const seeded = await commitRaw([old]);
    if (seeded.status !== 'committed') throw new Error(`the legacy operation did not commit: ${JSON.stringify(seeded)}`);
    const registered = await platform.sessions.recordSessionCreated(ctx, {
      input: { operationRef: operation.ref, sessionRef: ref, adapterId: KERNEL_ADAPTER,
        kernelSessionId: `legacy-kernel-${requestId}`, historyCursor: null, observedAt: HOST_NOW },
      meta: { requestId: `${requestId}-register`, expected: [] },
    });
    if (registered.status !== 'committed') throw new Error(`the legacy Session did not register: ${JSON.stringify(registered)}`);
    if ((registered.value.provenance ?? null) !== null) throw new Error('the legacy Session unexpectedly carries provenance');
    return ref;
  }

  /** A bare legal Session record with no provenance and no creation operation (X1/X2/A2/A3 and `second`). */
  async function createBareLegacy(requestId: string): Promise<SessionRef> {
    const ref: SessionRef = { projectId: AG2B_SCOPE.projectId, sessionId: `legacy-${requestId}` };
    const record = createSessionRecord({
      ref: plainSessionRefToAggregate(ref),
      kernel: { adapterId: KERNEL_ADAPTER, kernelSessionId: `kernel-legacy-${requestId}` },
      role: LEGACY_ROLE, workspaceId: AG2B_SCOPE.workspaceId, createdAt: HOST_NOW,
    });
    const committed = await commitRaw([encodeSessionRecord(record)]);
    if (committed.status !== 'committed') throw new Error(`the bare legacy Session did not commit: ${JSON.stringify(committed)}`);
    return ref;
  }

  async function workspaceRevision(): Promise<number> {
    const key = canonicalRefKey(AG2B_WORKSPACE_REF);
    const read = await records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`the Workspace revision read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find(entry => entry.refKey === key);
    if (record === undefined) throw new Error('the Workspace record is absent');
    return (JSON.parse(record.json) as { revision: number }).revision;
  }

  return {
    records, bodies, platform, ctx, root: h.root, commitRaw, createLegacySession, createBareLegacy, workspaceRevision,
    close: async () => { await bodies.close(); await backend.close(); },
  };
}

/**
 * The real `TaskClaimPort.claimTask` over the Host's records with a chosen
 * clock. The setup clock is chosen (never the Host's fixed `2026-10-06` clock)
 * because `recordSessionCreated` stamps C's SessionCreated payload with the wall
 * clock: the derivation's ordering proof needs `creation <= claim`.
 */
async function claimTask(seed: HostSeed, sessionRef: SessionRef, requestId: string, claimAt: string,
  requeueRef?: TaskRequeueSnapshotV1['ref']): Promise<TaskClaim> {
  const goal = await seed.platform.plans.queryGoal(seed.ctx, AG2B_GOAL_REF);
  if (goal.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(goal)}`);
  const card = await seed.platform.sessions.readSession(seed.ctx, sessionRef);
  if (card.status !== 'ready') throw new Error(`the Session must be readable: ${JSON.stringify(card)}`);
  let seq = 0;
  const now = () => claimAt;
  const service = createTaskClaimService({ records: seed.records,
    roles: createRoleConfigurationService({ records: seed.records, now, eventId: () => `${requestId}-role-${++seq}` }),
    now, newId: () => `${requestId}-id-${++seq}` });
  const result = await service.claimTask(seed.ctx, {
    input: { goalRef: AG2B_GOAL_REF, planRef: PLAN_REF, taskId: TASK_ID, sessionRef,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget: HOST_BUDGET,
      ...(requeueRef === undefined ? {} : { requeueRef }) },
    meta: { requestId, expected: [
      { ref: AG2B_GOAL_REF, revision: goal.value.goal.revision },
      { ref: AG2B_WORKSPACE_REF, revision: await seed.workspaceRevision() },
      { ref: plainSessionRefToAggregate(sessionRef), revision: card.value.record.revision },
    ] },
  });
  if (result.status !== 'committed') throw new Error(`the claim did not commit: ${JSON.stringify(result)}`);
  return result.value;
}

/**
 * The real `TaskRequeuePort.requeueTask` over the Host's records with the wall
 * clock the current test used: the requeue must be stamped after P's run (the
 * Host clock) and at or before C's SessionCreated wall-clock stamp.
 */
async function requeueTask(seed: HostSeed, afterRunRef: RunRef, requestId: string): Promise<TaskRequeueSnapshotV1> {
  const goal = await seed.platform.plans.queryGoal(seed.ctx, AG2B_GOAL_REF);
  if (goal.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(goal)}`);
  const run = await seed.platform.executions.readExecution(seed.ctx, afterRunRef);
  if (run.status !== 'ready') throw new Error(`the afterRun must be readable: ${JSON.stringify(run)}`);
  let seq = 0;
  const now = () => new Date().toISOString();
  const service = createTaskRequeueService({
    records: seed.records, reads: createRunStateReader({ records: seed.records }),
    workspaceHost: { async resolveRoot() {
      return { status: 'ready', value: { root: seed.root, workspaceRevision: 1 } };
    } },
    source: { async captureDigest() { return { status: 'ready', sourceDigest: 'a'.repeat(64) }; } },
    materials: createMaterialService({ bodies: seed.bodies,
      authority: createMaterialRecordReaders(seed.records).authority, now }),
    messages: { async readMessage() { return { status: 'not_found' }; } },
    now, eventId: () => `s2c26-requeue-event-${++seq}`,
  });
  const result = await service.requeueTask(seed.ctx, {
    input: { taskRef: TASK_REF, afterRunRef, reason: 'retry the failed work for the continuation' },
    meta: { requestId, expected: [
      { ref: AG2B_GOAL_REF, revision: goal.value.goal.revision },
      { ref: afterRunRef, revision: run.value.run.revision },
    ] },
  });
  if (result.status !== 'committed' || result.value.kind !== 'requeued') {
    throw new Error(`the formal requeue did not commit a TaskRequeue: ${JSON.stringify(result)}`);
  }
  return result.value.requeue;
}

/** The real `SessionLifecyclePort.archiveSession` through the Host composition. */
async function archiveSession(seed: HostSeed, sessionRef: SessionRef, requestId: string, reason: string): Promise<void> {
  const card = await seed.platform.sessions.readSession(seed.ctx, sessionRef);
  if (card.status !== 'ready') throw new Error(`the Session must be readable: ${JSON.stringify(card)}`);
  const result = await seed.platform.sessions.archiveSession(seed.ctx, {
    input: { sessionRef, reason },
    meta: { requestId, expected: [
      { ref: plainSessionRefToAggregate(sessionRef), revision: card.value.record.revision },
    ] },
  });
  if (result.status !== 'committed') throw new Error(`the archive did not commit: ${JSON.stringify(result)}`);
}

/**
 * The real ExecutionEntry owners over the Host's records with the Host's own
 * artifact store, so the manifest body the legacy derivation later reads is the
 * one the Host composition can read too. Only P's ended Run is produced here;
 * C is left merely claimed (its Run carries the `requeueRef` without a manifest).
 */
function runEntryFor(seed: HostSeed): { enter(claim: TaskClaim): Promise<void>; recordResult(claim: TaskClaim, event: RuntimeEventV1): Promise<void> } {
  const { records, bodies, ctx } = seed;
  let seq = 0;
  const now = () => HOST_NOW;
  const eventId = () => `s2c26-run-event-${++seq}`;
  const newId = () => `s2c26-run-id-${++seq}`;
  const reads = createRunStateReader({ records, bodies });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const entry = createExecutionEntryService({ records, reads, roles, bodies, now, eventId, newId,
    authorizeConfiguration: async (_ctx, input) => ({ status: 'ready' as const, value: {
      configurationRevision: input.configurationRevision, permissions: input.permissions, hostTemplate: input.hostTemplate,
    } }) });

  async function readExecution(claim: TaskClaim) {
    const read = await reads.readExecution(ctx, claim.runRef);
    if (read.status !== 'ready') throw new Error(`the execution must be readable: ${JSON.stringify(read)}`);
    return read.value;
  }
  async function pin(claim: TaskClaim) {
    const current = await readExecution(claim);
    return { ref: claim.runRef, revision: current.run.revision };
  }
  async function kernelFor(claim: TaskClaim) {
    const current = await readExecution(claim);
    return { adapterId: current.session.kernel.adapterId, kernelSessionId: current.session.kernel.kernelSessionId,
      runId: `s2c26-kernel-run-${claim.runRef.runId}`, turnId: `s2c26-kernel-turn-${claim.runRef.runId}` };
  }

  async function buildPrepared(claim: TaskClaim): Promise<PreparedTaskExecution> {
    const target = await readExecution(claim);
    const workspaceRevision = await seed.workspaceRevision();
    const input = 'S2C-26 legacy provenance task input.';
    const inputDigest = artifactBodyDigest(input);
    const roleFacts = await roles.resolveRoleBindingFacts(ctx, { roleBinding: target.run.roleBinding,
      declaredPermissions: L_HOST.permissions });
    if (roleFacts.result.status !== 'ready') throw new Error(`the role facts are not ready: ${JSON.stringify(roleFacts.result)}`);
    const manifest: PreparedTaskManifestV1 = {
      schemaVersion: 1, kind: 'task_execution', claim, role: roleFacts.result.value, hostTemplate: L_HOST.hostTemplate,
      roleBinding: target.run.roleBinding, hostConfigurationRevision: L_HOST.configurationRevision,
      sessionRole: target.session.role, workspaceSnapshot: { workspaceId: claim.workspaceId, revision: workspaceRevision },
      permissions: L_HOST.permissions, budget: HOST_BUDGET, selectedTaskInputs: [], materialBasis: null,
      materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [], sourceRefs: [], input, inputDigest,
    };
    const manifestJson = JSON.stringify(manifest);
    const stored = await bodies.put({ body: manifestJson, contentType: MANIFEST_CONTENT_TYPE,
      sourceRefs: [{ kind: 'workspace', refId: claim.workspaceId, revision: String(workspaceRevision) }],
      origin: { kind: 'run', owner: claim.runRef }, requestedAt: HOST_NOW });
    if (stored.status !== 'ready') throw new Error(`the manifest body was not stored: ${JSON.stringify(stored)}`);
    const envelope: TaskEnvelopeV1 = {
      schemaVersion: 1, envelopeId: `s2c26-envelope-${++seq}`, projectId: claim.task.projectId,
      workspaceId: claim.workspaceId, goalId: claim.task.goalId, taskId: claim.task.taskId,
      runRef: claim.runRef, attemptRef: claim.attemptRef, planRef: claim.planRef, roleBinding: target.run.roleBinding,
      workspaceSnapshot: { workspaceId: claim.workspaceId, revision: workspaceRevision },
      permissions: L_HOST.permissions, budget: HOST_BUDGET, sourceRefs: [], bundleRef: stored.value.ref,
    };
    return { kind: 'task', claim, envelope, inputBinding: { schemaVersion: 1, inputDigest,
      manifestDigest: artifactBodyDigest(manifestJson), materialAccessRefs: [], deliveryRefs: [] } };
  }

  async function enter(claim: TaskClaim): Promise<void> {
    const prepared = await buildPrepared(claim);
    const authorized = await entry.authorizeRuntimeEntry(ctx, { input: { prepared, consumerId: `s2c26-consumer-${++seq}` },
      meta: { requestId: `s2c26-authorize-${++seq}`, expected: [await pin(claim)] } });
    if (authorized.status !== 'committed') throw new Error(`the entry authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(ctx, { input: { permit: authorized.value, kernel: await kernelFor(claim) },
      meta: { requestId: `s2c26-begin-${++seq}`, expected: [await pin(claim)] } });
    if (begun.status !== 'committed') throw new Error(`the entry begin failed: ${JSON.stringify(begun)}`);
    const permit = { ...authorized.value, authorizationRevision: begun.value.authorization.revision };
    const kernel = await kernelFor(claim);
    const entered = await entry.recordExecutionEntered(ctx, { input: { permit, enteredAt: now(),
      kernelSource: { ...kernel, position: 3 },
      history: { kernel: { ...kernel }, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: `s2c26-entered-${++seq}`, expected: [await pin(claim)] } });
    if (entered.status !== 'committed') throw new Error(`the execution did not enter: ${JSON.stringify(entered)}`);
  }

  async function recordResult(claim: TaskClaim, event: RuntimeEventV1): Promise<void> {
    const current = await readExecution(claim);
    const auth = current.run.executionAuthorization;
    if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2) {
      throw new Error('the result needs the V2 entry binding');
    }
    const kernel = await kernelFor(claim);
    const terminal: RuntimeEventV1 = { ...event, runRef: claim.runRef, sequence: current.run.lastEventSeq + 1, occurredAt: now() };
    const result = await entry.recordRunResult(ctx, { input: {
      claim, entry: { consumerId: auth.consumerId, entryGeneration: auth.generation }, event: terminal,
      kernelSource: { ...kernel, position: 4 },
      completedHistoryBoundary: { source: { ...kernel, position: 4 }, cursor: `s2c26-boundary-${claim.runRef.runId}` },
      history: { kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 } },
      meta: { requestId: `s2c26-result-${++seq}`, expected: [await pin(claim)] } });
    if (result.status !== 'committed') throw new Error(`the Run result did not commit: ${JSON.stringify(result)}`);
  }

  return { enter, recordResult };
}

/** A case: the Host, the storage-boundary seed, P (archived predecessor) and C (active continuation). */
type LegacyCase = { h: HostScenario; seed: HostSeed; P: SessionRef; C: SessionRef };

/**
 * Seven provenance-null old Sessions: P (archived), C (active continuation of
 * P), `second` (active), A2 and A3 (active), and X1/X2 (archived). One real
 * requeue/claim supplies C's reliable predecessor.
 */
async function openCase(): Promise<LegacyCase> {
  const h = await openHostScenario({ workIds: [TASK_ID] });
  const seed = await openHostSeed(h);
  openSeeds.push(seed);
  const taskTarget: WorkLinkTarget = { kind: 'task', ref: TASK_REF };

  // P: the legacy predecessor, claimed, crashed and archived.
  const P = await seed.createLegacySession('s2c26-p', []);
  const pClaim = await claimTask(seed, P, 's2c26-p-claim', HOST_NOW);
  const pEntry = runEntryFor(seed);
  await pEntry.enter(pClaim);
  await pEntry.recordResult(pClaim, crashedEvent(pClaim, 's2c26-p'));
  await archiveSession(seed, P, 's2c26-p-archive', 'predecessor archived');

  // The real requeue that points C's first claim at P.
  const requeue = await requeueTask(seed, pClaim.runRef, 's2c26-requeue');
  expect(requeue.historySource?.sessionRef).toEqual(P);

  // C: the legacy continuation Session, created with its initial responsible
  // link, then claimed from the requeue. The claim instant must be at or after
  // C's creation wall-clock stamp (the derivation's creation/requeue/claim
  // ordering proof).
  const C = await seed.createLegacySession('s2c26-c', [{ target: taskTarget, relation: 'responsible' }]);
  const cClaimAt = new Date(Date.now() + 60_000).toISOString();
  await claimTask(seed, C, 's2c26-c-claim', cClaimAt, requeue.ref);

  // The remaining old Sessions.
  await seed.createBareLegacy('s2c26-second');
  const X1 = await seed.createBareLegacy('s2c26-x1');
  const X2 = await seed.createBareLegacy('s2c26-x2');
  await archiveSession(seed, X1, 's2c26-x1-archive', 'old archived one');
  await archiveSession(seed, X2, 's2c26-x2-archive', 'old archived two');
  await seed.createBareLegacy('s2c26-a2');
  await seed.createBareLegacy('s2c26-a3');

  return { h, seed, P, C };
}

describe('2C-26 legacy provenance set (LE4)', () => {
  afterEach(async () => {
    for (const seed of openSeeds.splice(0)) await seed.close();
    await cleanupScenarios();
  });

  it('2C-26 before maintenance: seven unchecked, P and C are separate checked-when-read lines, three archived rows; reading again backfills nothing', async () => {
    const { h, P, C } = await openCase();
    const list = ready(await lineList(h), 'lines/list');
    expect(list.legacyUnchecked).toEqual({ status: 'exact', value: 7 });
    expect(list.counts.archived).toMatchObject({ status: 'partial', atLeast: 0, atMost: 3 });

    const cRow = lineOf(list, C.sessionId);
    expect(cRow, 'C is an active line head before maintenance').toBeDefined();
    expect(cRow?.chainSessions).toEqual([C]);
    expect(cRow?.status.markers).toContainEqual({ kind: 'provenance_unchecked' });

    const archived = ready(await lineArchived(h), 'lines/archived');
    expect(archived.rows).toHaveLength(3);
    const pRow = archivedLineOf(archived, P.sessionId);
    expect(pRow, 'P is an archived line head before maintenance').toBeDefined();
    expect(pRow?.status.markers).toContainEqual({ kind: 'provenance_unchecked' });

    // A second read is the same: reads never backfill provenance.
    const again = ready(await lineList(h), 'lines/list again');
    expect(again.legacyUnchecked).toEqual({ status: 'exact', value: 7 });
    expect(again.rows.map((row) => row.key.sessionId)).toEqual(list.rows.map((row) => row.key.sessionId));
    const archivedAgain = ready(await lineArchived(h), 'lines/archived again');
    expect(archivedAgain.rows.map((row) => row.key.sessionId)).toEqual(archived.rows.map((row) => row.key.sessionId));
  }, 240_000);

  it('2C-26 after one maintenance pass C joins P, three unchecked remain and the archived page has two rows', async () => {
    const { h, P, C } = await openCase();
    await runMaintenance(h, 's2c26-maintenance');

    const list = ready(await lineList(h), 'lines/list');
    expect(list.legacyUnchecked).toEqual({ status: 'exact', value: 3 });
    expect(list.counts.archived).toMatchObject({ status: 'partial', atLeast: 0, atMost: 2 });
    const cRow = lineOf(list, C.sessionId);
    expect(cRow, 'C is still the active line head after maintenance').toBeDefined();
    expect(cRow?.chainSessions).toEqual([C, P]);

    const archived = ready(await lineArchived(h), 'lines/archived');
    expect(archived.rows).toHaveLength(2);
    expect(archivedLineOf(archived, P.sessionId), 'P is no longer an archived head').toBeUndefined();
    // The two remaining archived old Sessions are each still an unchecked line.
    for (const row of archived.rows) {
      expect(row.status.markers).toContainEqual({ kind: 'provenance_unchecked' });
    }
  }, 240_000);

  it('2C-26 the executions section stays indexed: the old no-dispatch QueryRun is never listed', async () => {
    const { h, seed, C } = await openCase();
    const legacyQueryRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: AG2B_SCOPE.projectId,
      workspaceId: AG2B_SCOPE.workspaceId, queryJobId: 's2c26-legacy-qjob', runId: 's2c26-legacy-qrun' };
    const legacyQuery: QueryRunSnapshot = { ref: legacyQueryRef, revision: 1, schemaVersion: 1,
      run: { schemaVersion: 1, queryJobRef: { aggregateType: 'QueryJob', projectId: AG2B_SCOPE.projectId,
        workspaceId: AG2B_SCOPE.workspaceId, queryJobId: 's2c26-legacy-qjob' }, runId: 's2c26-legacy-qrun',
        status: 'pending', startedAt: null, endedAt: null, outcome: null } };
    const committed = await seed.commitRaw([encodeQueryRunSnapshotRecord(legacyQuery)]);
    if (committed.status !== 'committed') throw new Error(`legacy Query commit failed: ${JSON.stringify(committed)}`);

    const before = ready(await lineSection(h, C, 'executions', { limit: 100 }), 'lines/page executions before');
    if (before.section !== 'executions') throw new Error('expected the executions section');
    expect(before.scope).toBe('indexed');
    // C's own line: only the dispatch-recorded Work claim; the old QueryRun
    // without `executionState` is not an indexed execution.
    expect(before.items).toHaveLength(1);
    expect(before.items[0]).toMatchObject({ kind: 'execution', task: { taskId: TASK_ID } });
    expect(before.items.some((item) => item.kind === 'query')).toBe(false);

    await runMaintenance(h, 's2c26-maintenance');

    const after = ready(await lineSection(h, C, 'executions', { limit: 100 }), 'lines/page executions after');
    if (after.section !== 'executions') throw new Error('expected the executions section');
    expect(after.scope).toBe('indexed');
    // The scope is still "indexed executions only": the old no-dispatch QueryRun
    // stays absent. The line now has two segments (C and its predecessor P), so
    // the list additionally carries P's dispatch-recorded Work claim.
    expect(after.items.every((item) => item.kind === 'execution')).toBe(true);
    expect(after.items.map((item) => item.kind === 'execution' ? item.task.taskId : item.queryRunRef.runId))
      .toEqual([TASK_ID, TASK_ID]);
  }, 240_000);
});
