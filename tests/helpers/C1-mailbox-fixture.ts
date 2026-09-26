/** One real ledger for claims, Session, Role facts and mailbox. Running is a domain seed, never an entered-producer claim. */
import { join } from 'node:path';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { ExecutionAuthorizationV2 } from '../../src/contracts/dispatch.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { SESSION_MESSAGE_LOOKUP_INDEXES, SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/communication/message-record-codecs.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import type { SessionLifecyclePort } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/sessions/contracts.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import type { SessionMailboxDependencies, SessionMailboxPort } from '../../src/core/work-graph/communication/contracts.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import { MANIFEST_CONTENT_TYPE } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { createTaskClaimFixture, type ClaimFixtureKind, type TaskClaimFixture } from './task-claim-fixture.js';
import type { TaskClaim } from '../../src/core/work-graph/tasks/claim-contracts.js';

export const AT = '2026-09-26T00:00:00.000Z';
const systemActor = { kind: 'system' as const, id: 'c1-mailbox-body-system' };
const key = (ref: object): string => canonicalJson(ref as unknown as JsonValue);
const signal = () => new AbortController().signal;

type C1Records = GoalRecordTransactionPort & RecordLookupPort;
type C1Backend = { records: C1Records; close(): Promise<void> };

export type C1Harness = {
  fixture: TaskClaimFixture;
  claim: TaskClaim;
  backend: C1Backend;
  mailbox: SessionMailboxPort;
  sessions: SessionDirectoryPort;
  lifecycle: SessionLifecyclePort;
  materials: ReturnType<typeof createMaterialService>;
  ctxHost: CoreCallContext;
  ctxWork: CoreCallContext;
  busySession: SessionRef;
  idleSession: SessionRef;
  currentRun: RunSnapshot;
  commitRun(next: RunSnapshot): Promise<void>;
  commitSession(ref: SessionRef, mutate: (record: SessionRecord) => SessionRecord): Promise<void>;
  bodyPath: string;
  authorizeConfiguration: AuthorizeConfiguration;
  rawBodies(): Pick<RawArtifactStorePort, 'read'>;
  makeMailbox(records?: C1Records, materialPort?: ReturnType<typeof createMaterialService>,
    admission?: SessionMailboxDependencies['runtimeAdmission'] | null): SessionMailboxPort;
  reopen(): Promise<void>;
  close(): Promise<void>;
};

export function envelopeFor(run: RunSnapshot, tools: string[] = [...SESSION_MAILBOX_TOOL_NAMES]): TaskEnvelopeV1 {
  return {
    schemaVersion: 1,
    envelopeId: 'c1-envelope',
    projectId: run.ref.projectId,
    workspaceId: run.workspaceSnapshot.workspaceId,
    goalId: run.task.goalId,
    taskId: run.task.taskId,
    runRef: run.ref,
    attemptRef: { aggregateType: 'TaskAttempt', projectId: run.ref.projectId, goalId: run.task.goalId, taskId: run.task.taskId, attemptId: run.attemptId },
    planRef: run.planRef,
    roleBinding: run.roleBinding,
    workspaceSnapshot: run.workspaceSnapshot,
    permissions: { policyRevision: 'c1-policy', tools: [...tools], writeScope: [] },
    budget: run.budget,
    sourceRefs: [],
    // The C2 fixture stores a REAL prepared manifest; a rewritten envelope keeps
    // its exact ref instead of inventing a fake digest.
    bundleRef: run.envelope?.bundleRef ?? { kind: 'artifact', contentType: 'text/plain', digest: 'f'.repeat(64), sizeBytes: 1,
      source: { kind: 'workspace', refId: run.workspaceSnapshot.workspaceId, revision: String(run.workspaceSnapshot.revision) } },
  };
}

export async function createC1Harness(kind: ClaimFixtureKind): Promise<C1Harness> {
  const fixture = await createTaskClaimFixture(kind, { ...SESSION_MESSAGE_RECORD_SCHEMAS, events: [...SESSION_MESSAGE_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events], lookups: SESSION_MESSAGE_RECORD_SCHEMAS.records.length ? SESSION_MESSAGE_LOOKUP_INDEXES : [] });
  const claimResult = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({ requestId: 'c1-claim' }));
  if (claimResult.status !== 'committed') throw new Error(`C1 fixture claim failed: ${JSON.stringify(claimResult)}`);
  const claim = claimResult.value;

  const sessions = createSessionDirectory({ records: fixture.records, lookups: fixture.records });
  const busySession: SessionRef = { projectId: claim.sessionRef.projectId, sessionId: claim.sessionRef.sessionId };
  const idleSession: SessionRef = { projectId: fixture.sessions.second.projectId, sessionId: fixture.sessions.second.sessionId };
  const runKey = key(claim.runRef);
  const base = await fixture.records.readMany([runKey]);
  if (base.status !== 'ready' || !base.value.records[0]) throw Error('Missing real claimed Run');
  const baseRun = JSON.parse(base.value.records[0].json) as RunSnapshot;
  // Explicit domain-rule seed ONLY. This does not exercise the Runtime entered producer.
  let currentRun: RunSnapshot = { ...baseRun, revision: baseRun.revision + 1, status: 'running', startedAt: AT,
    envelope: envelopeFor(baseRun), executionAuthorization: { schemaVersion: 2, generation: 1,
      sessionGeneration: claim.generation, revision: 3, consumerId: 'c1-domain-driver', inputDigest: 'f'.repeat(64),
      phase: 'entered', kernel: { adapterId: 'r4c-claim-kernel', kernelSessionId: 'r4c-claim-kernel-session-session-first',
        runId: 'c1-domain-kernel-run', turnId: 'c1-domain-turn' } } };
  const seeded = await fixture.commitRaw([{ refKey: runKey, schemaId: 'RunSnapshot@1', revision: currentRun.revision, json: JSON.stringify(currentRun) }], [{refKey: runKey, expectedRevision: baseRun.revision}]);
  if (seeded.status !== 'committed') throw Error(`C1 running domain seed failed: ${JSON.stringify(seeded)}`);
  const backend = { records: fixture.records, close: () => fixture.closeBackend() };
  const seedEvents = (suffix: string) => [{eventId: `c1-${suffix}`, eventType:'TrustedScopeSeeded', schemaVersion:1, occurredAt: AT, json:JSON.stringify({eventId:`c1-${suffix}`,eventType:'TrustedScopeSeeded',schemaVersion:1,occurredAt:AT})}];
  const now = () => AT;
  let eventSeq = 0;
  const eventId = () => `c1-message-event-${++eventSeq}`;
  let writeSeq = 0;
  const reads = createMaterialRecordReaders(backend.records);
  const grants = createMaterialAccessResolver(reads.authority, reads.index);
  const bodyPath = join(fixture.directory, 'c1-bodies.sqlite');
  let bodies = kind === 'sqlite' ? createSqliteRawArtifactStore(bodyPath) : new RawArtifactBodyStore();
  const materials = createMaterialService({ bodies: {put: input => bodies.put(input), read: ref => bodies.read(ref)}, authority: reads.authority, grants, now });
  // C2 migration: the old fixture carried a fake `'f'.repeat(64)` digest. The
  // fresh Host admission needs the real prepared manifest body and a real Host
  // binding, so store the manifest through the same body store and pin it in the
  // seeded Run envelope.
  const c1HostTemplate: PreparedTaskManifestV1['hostTemplate'] = { templateId: 'builder', revision: '1', digest: sha256Hex('c1-mailbox-fixture-trusted-host-template') };
  const c1SessionRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
  const c1ConfigurationRevision = 'c1-mailbox-host-config@1';
  const c1HostPermissions = structuredClone(envelopeFor(currentRun).permissions);
  const sameJson = (left: unknown, right: unknown): boolean => canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    if (ctx.projectId !== busySession.projectId || ctx.workspaceId !== currentRun.workspaceSnapshot.workspaceId
      || !sameJson(input.sessionRole, c1SessionRole) || !sameJson(input.hostTemplate, c1HostTemplate)
      || !sameJson(input.run.ref, claim.runRef) || !sameJson(input.permissions, c1HostPermissions)
      || input.configurationRevision !== c1ConfigurationRevision) {
      return { status: 'rejected', code: 'forbidden', reason: 'the C1 fixture Host binding does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: input.configurationRevision,
      permissions: structuredClone(c1HostPermissions), hostTemplate: structuredClone(c1HostTemplate) } };
  };
  const c1ManifestInput = 'C1 mailbox fixture prepared manifest input';
  const c1ManifestInputDigest = sha256Hex(c1ManifestInput);
  const c1Manifest: PreparedTaskManifestV1 = {
    schemaVersion: 1, kind: 'task_execution', claim, role: { status: 'absent', roleId: 'builder', reason: 'legacy template has no installed role spec' },
    hostTemplate: c1HostTemplate, roleBinding: currentRun.roleBinding, hostConfigurationRevision: c1ConfigurationRevision,
    sessionRole: c1SessionRole, workspaceSnapshot: currentRun.workspaceSnapshot,
    permissions: envelopeFor(currentRun).permissions, budget: currentRun.budget, selectedTaskInputs: [], materialBasis: null,
    materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [],
    sourceRefs: [{ kind: 'workspace', refId: currentRun.workspaceSnapshot.workspaceId, revision: '1' }],
    input: c1ManifestInput, inputDigest: c1ManifestInputDigest,
  };
  const storedManifest = await bodies.put({ body: JSON.stringify(c1Manifest), contentType: MANIFEST_CONTENT_TYPE,
    sourceRefs: c1Manifest.sourceRefs, origin: { kind: 'run', owner: claim.runRef }, requestedAt: AT });
  if (storedManifest.status !== 'ready') throw new Error(`C1 prepared manifest store failed: ${JSON.stringify(storedManifest)}`);
  {
    const nextRevision = currentRun.revision + 1;
    const nextRun: RunSnapshot = { ...currentRun, revision: nextRevision,
      envelope: { ...(currentRun.envelope as NonNullable<RunSnapshot['envelope']>), bundleRef: storedManifest.value.ref },
      // The seeded entered facts stay self-consistent: the exact manifest is the
      // Run input binding and the V2 authorization input digest.
      inputBinding: { schemaVersion: 1, inputDigest: c1ManifestInputDigest, manifestDigest: storedManifest.value.ref.digest,
        materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [] },
      executionAuthorization: { ...(currentRun.executionAuthorization as ExecutionAuthorizationV2), inputDigest: c1ManifestInputDigest } };
    const reseeded = await fixture.commitRaw([{ refKey: runKey, schemaId: 'RunSnapshot@1', revision: nextRevision, json: JSON.stringify(nextRun) }],
      [{ refKey: runKey, expectedRevision: currentRun.revision }]);
    if (reseeded.status !== 'committed') throw new Error(`C1 prepared manifest Run seed failed: ${JSON.stringify(reseeded)}`);
    currentRun = nextRun;
  }
  function makeMailbox(records: C1Records = backend.records, materialPort = materials,
    admission: SessionMailboxDependencies['runtimeAdmission'] | null | undefined = undefined): SessionMailboxPort {
    const runtimeAdmission = admission === undefined ? { bodies, authorizeConfiguration } : admission;
    return createSessionMailbox({ records, sessions: createSessionDirectory({records,lookups:records}), executions: createRunStateReader({records}),
      roles: createRoleConfigurationService({records,now,eventId}), materials: materialPort, systemActor,
      ...(runtimeAdmission === null ? {} : { runtimeAdmission }), now, newId: () => `c1-message-${++eventSeq}` });
  }
  const mailbox = makeMailbox();
  let secondary: Awaited<ReturnType<TaskClaimFixture['reopenService']>> | undefined;
  const lifecycle = createSessionLifecycleService({ records: backend.records, lookups: backend.records });
  const ctxHost: CoreCallContext = { projectId: busySession.projectId, workspaceId: currentRun.workspaceSnapshot.workspaceId,
    principal: { kind: 'host', actor: { kind: 'human', id: 'c1-host' } },
    materialReader: { kind: 'host', projectId: busySession.projectId, workspaceId: currentRun.workspaceSnapshot.workspaceId, actor: { kind: 'human', id: 'c1-host' } },
    signal: signal() };
  const ctxWork: CoreCallContext = { projectId: busySession.projectId, workspaceId: currentRun.workspaceSnapshot.workspaceId,
    principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: currentRun.roleBinding },
    materialReader: { kind: 'run', requester: claim.runRef }, signal: signal() };

  const harness: C1Harness = {
    fixture, claim, backend, mailbox, sessions, lifecycle, materials, ctxHost, ctxWork, busySession, idleSession, currentRun, bodyPath, makeMailbox,
    authorizeConfiguration, rawBodies: () => bodies,
    async reopen() {
      if (kind !== 'sqlite') throw Error('SQLite only');
      await fixture.closeBackend();
      if ('close' in bodies) await bodies.close();
      bodies = createSqliteRawArtifactStore(bodyPath);
      secondary = await fixture.reopenService();
      const reopenedReaders = createMaterialRecordReaders(secondary.records);
      harness.materials = createMaterialService({bodies, authority:reopenedReaders.authority, grants:createMaterialAccessResolver(reopenedReaders.authority,reopenedReaders.index), now});
      harness.mailbox = makeMailbox(secondary.records,harness.materials);
    },
    async commitRun(next) {
      const previous = harness.currentRun;
      const committed = await backend.records.commit({ identityKey: `c1-run-${next.revision}-${++writeSeq}`,
        fingerprint: `c1-run-${next.revision}-${writeSeq}`,
        guards: [{ refKey: runKey, expectedRevision: previous.revision }],
        records: [{ refKey: runKey, schemaId: 'RunSnapshot@1', revision: next.revision, json: JSON.stringify(next) }],
        events: seedEvents(`run-${next.revision}`), claims: [], indexGuards: [], indexChanges: [] });
      if (committed.status !== 'committed') throw new Error(`C1 Run rewrite failed: ${JSON.stringify(committed)}`);
      harness.currentRun = next;
    },
    async commitSession(ref, mutate) {
      const card = await sessions.readSession(ctxHost, ref);
      if (card.status !== 'ready') throw new Error(`C1 Session read failed: ${JSON.stringify(card)}`);
      const current = card.value.record;
      const next = { ...mutate(current), revision: current.revision + 1 };
      const committed = await backend.records.commit({ identityKey: `c1-session-${ref.sessionId}-${next.revision}`,
        fingerprint: `c1-session-${ref.sessionId}-${next.revision}`,
        guards: [{ refKey: sessionAggregateRefKey(plainSessionRefToAggregate(ref)), expectedRevision: current.revision }],
        records: [encodeSessionRecord(next)], events: seedEvents(`session-${ref.sessionId}-${next.revision}`),
        claims: [], indexGuards: [], indexChanges: [] });
      if (committed.status !== 'committed') throw new Error(`C1 Session rewrite failed: ${JSON.stringify(committed)}`);
    },
    async close() {
      await secondary?.close();
      if ('close' in bodies) await bodies.close();
      await backend.close();
      await fixture.close();
    },
  };
  return harness;
}
