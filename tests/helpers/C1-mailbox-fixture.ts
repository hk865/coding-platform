/** One real ledger for claims, Session, Role facts and mailbox. Running/entered facts come from the real Runtime start. */
import { join } from 'node:path';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { SESSION_MESSAGE_LOOKUP_INDEXES, SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import type { SessionLifecyclePort } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import type { SessionMailboxDependencies, SessionMailboxPort } from '../../src/core/work-graph/model/communication-contracts.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { createTaskClaimFixture, type ClaimFixtureKind, type TaskClaimFixture } from './task-claim-fixture.js';
import { createS2BRuntimeSteps } from './S2B-runtime-steps-fixture.js';
import type { TaskClaim } from '../../src/core/work-graph/model/claim-contracts.js';

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
  const fixture = await createTaskClaimFixture(kind, {
    records: [...SESSION_MESSAGE_RECORD_SCHEMAS.records, ...EXECUTION_ENTRY_RECORD_SCHEMAS.records,
      ...MODEL_REQUEST_RECORD_SCHEMAS.records],
    events: [...SESSION_MESSAGE_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events],
    lookups: [...(SESSION_MESSAGE_RECORD_SCHEMAS.records.length ? SESSION_MESSAGE_LOOKUP_INDEXES : []),
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [], ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []],
  });
  const claimResult = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({ requestId: 'c1-claim' }));
  if (claimResult.status !== 'committed') throw new Error(`C1 fixture claim failed: ${JSON.stringify(claimResult)}`);
  const claim = claimResult.value;

  const sessions = createSessionDirectory({ records: fixture.records, lookups: fixture.records });
  const busySession: SessionRef = { projectId: claim.sessionRef.projectId, sessionId: claim.sessionRef.sessionId };
  const idleSession: SessionRef = { projectId: fixture.sessions.second.projectId, sessionId: fixture.sessions.second.sessionId };
  const runKey = key(claim.runRef);
  const backend = { records: fixture.records, close: () => fixture.closeBackend() };
  const seedEvents = (suffix: string) => [{eventId: `c1-${suffix}`, eventType:'TrustedScopeSeeded', schemaVersion:1, occurredAt: AT, json:JSON.stringify({eventId:`c1-${suffix}`,eventType:'TrustedScopeSeeded',schemaVersion:1,occurredAt:AT})}];
  const now = () => AT;
  let eventSeq = 0;
  const eventId = () => `c1-message-event-${++eventSeq}`;
  const newId = () => `c1-id-${++eventSeq}`;
  let writeSeq = 0;
  const bodyPath = join(fixture.directory, 'c1-bodies.sqlite');
  let bodies = kind === 'sqlite' ? createSqliteRawArtifactStore(bodyPath) : new RawArtifactBodyStore();
  const materialReads = createMaterialRecordReaders(backend.records);
  const materials = createMaterialService({ bodies, authority: materialReads.authority, now });
  const executions = createRunStateReader({ records: backend.records, bodies });
  // The trusted Host grant, the same one the entry owner re-checks.
  const c1HostTemplate: PreparedTaskManifestV1['hostTemplate'] = { templateId: 'builder', revision: '1', digest: sha256Hex('c1-mailbox-fixture-trusted-host-template') };
  const c1SessionRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
  const c1ConfigurationRevision = 'c1-mailbox-host-config@1';
  const c1HostPermissions = { policyRevision: fixture.roleBinding.policyRevision,
    tools: [...SESSION_MAILBOX_TOOL_NAMES], writeScope: [] as string[] };
  const sameJson = (left: unknown, right: unknown): boolean => canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    if (ctx.projectId !== busySession.projectId || ctx.workspaceId !== claim.workspaceId
      || !sameJson(input.sessionRole, c1SessionRole) || !sameJson(input.hostTemplate, c1HostTemplate)
      || !sameJson(input.run.ref, claim.runRef) || !sameJson(input.permissions, c1HostPermissions)
      || input.configurationRevision !== c1ConfigurationRevision) {
      return { status: 'rejected', code: 'forbidden', reason: 'the C1 fixture Host binding does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: input.configurationRevision,
      permissions: structuredClone(c1HostPermissions), hostTemplate: structuredClone(c1HostTemplate) } };
  };
  // TP-081: the running/entered facts come from the real Runtime prepare and
  // start over this fixture's own stores. The scripted model's first request is
  // held at an A3 gate, so the Run stays running/entered while the mailbox rows
  // below exercise it; the held request is released as a crash at close.
  const steps = await createS2BRuntimeSteps({ base: fixture, bodies, ctx: fixture.ctx,
    directory: fixture.directory, scope: fixture.scope, now, setClock: () => undefined,
    eventId, newId, consumerId: 'c1-runtime', withMailbox: true,
    host: { configurationRevision: c1ConfigurationRevision,
      permissions: c1HostPermissions, hostTemplate: c1HostTemplate } });
  const handle = await steps.start(claim, { at: AT,
    replies: [{ kind: 'text', text: 'C1 mailbox fixture held request' }],
    tools: [...SESSION_MAILBOX_TOOL_NAMES] });
  await handle.entered;
  const started = await executions.readExecution(fixture.ctx, claim.runRef);
  if (started.status !== 'ready') throw Error(`C1 execution read failed: ${JSON.stringify(started)}`);
  let currentRun: RunSnapshot = started.value.run;
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
      harness.materials = createMaterialService({bodies, authority:reopenedReaders.authority, now});
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
      await steps.close();
      await secondary?.close();
      if ('close' in bodies) await bodies.close();
      await backend.close();
      await fixture.close();
    },
  };
  return harness;
}
