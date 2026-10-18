/**
 * Slice 1 §4.1 / §5.4 IT12–IT16, IT26, IT27: the Workflow's single Session
 * archive composition entry (`createWorkflow().archiveLine`) and the ordinary
 * Workflow re-dispatch that follows an archive anchor.
 *
 * Real memory/SQLite backends and the owner services the Workflow composes:
 * Session facts, the responsibility write owner (with the REAL
 * `createSessionResponsibilityBasisReader` basis), the anomaly owner, the
 * Session lifecycle, the Run control owner and the Run reconcile owner (the
 * real unknown-run attestation). The real ordinary dispatch path
 * (`createWorkflow().advanceWork`) selects the Session and claims; the real
 * AgentRuntime prepare step produces the continuation brief. The Host callbacks
 * and Kernel observations are trusted seams; IT13 additionally injects a
 * final-commit conflict without writing a fabricated record.
 *
 * Part 1 ships only throwing stubs, so every row is RED at its first
 * `not implemented:` call; the later brief/anchor assertions are reported as
 * unreached and are written for part 2.
 *
 * Fixed clock: `t0='2026-10-08T00:00:00.000Z'`, `t1='2026-10-09T00:00:00.000Z'`,
 * injected through every owner's `now`. An owner that reads `new Date()` gets
 * `vi.setSystemTime`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, SessionWorkLinkRef, WorkspaceScope, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { SessionRecord, SessionWorkLink } from '../../src/contracts/core/session.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import type { ArchiveSessionInput, LinkSessionWorkInput } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS, SESSION_ARCHIVED_EVENT } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { decodeSessionWorkLink, sessionWorkLinkRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { taskRequeueRefKey } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { AgentRuntimeService } from '../../src/core/agent-runtime/ports.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkflowPort } from '../../src/business/workflow/ports.js';
import { type SessionDutyResolver } from '../../src/business/workflow/ports.js';
import { createSessionArchiveService, type ArchiveLineInput, type SessionArchiveDependencies } from '../../src/business/workflow/session-archive.js';
import { beginConsultation, unknownWork, retireSession, workflowForFixture } from '../helpers/S1-workflow-archive-fixture.js';
import { loadPreparedManifest } from '../../src/core/agent-runtime/execution-preparation.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { createB2ExecutionFixture, type B2ExecutionFixture, type B2Records } from '../helpers/S1-workflow-archive-fixture.js';
import { createRuntimeHostDouble, createScriptedModel } from '../helpers/B2-runtime-fixture.js';

const T0 = '2026-10-08T00:00:00.000Z';
const T1 = '2026-10-09T00:00:00.000Z';

const AP = 'r4c-claim-kernel';
const AW = 'r4c-claim-kernel-store';
const SESSION_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };

/**
 * G2: every record/event/lookup bundle the real archive/ordinary path writes or
 * reads. `linkSessionWork` and the final archive write `SESSION_LIFECYCLE_*`;
 * the anchor owner writes `SESSION_ANOMALY_*`; the wait disposal writes
 * `SESSION_MESSAGE_*`; the Query path writes `QUERY_JOB_*`; the archive stop and
 * the re-dispatch read control records. TaskRequeue/Goal/Plan/Session/Role are
 * already registered by the claim fixture.
 */
const ADDITIONAL_SCHEMAS: RecordBackendSchemas = {
  records: [
    ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records,
    ...SESSION_ANOMALY_RECORD_SCHEMAS.records,
    ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records,
    ...SESSION_MESSAGE_RECORD_SCHEMAS.records,
    ...QUERY_JOB_RECORD_SCHEMAS.records,
    ...CONTROL_RECORD_SCHEMAS.records,
  ],
  events: [
    ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
    ...SESSION_ANOMALY_RECORD_SCHEMAS.events,
    ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events,
    ...SESSION_MESSAGE_RECORD_SCHEMAS.events,
    ...QUERY_JOB_RECORD_SCHEMAS.events,
    ...CONTROL_RECORD_SCHEMAS.events,
  ],
  lookups: [
    ...(SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? []),
    ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? []),
    ...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? []),
    ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []),
    ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []),
    ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
  ],
};

type AttestationOptions = Pick<SessionArchiveDependencies, 'attestUnknownRun' | 'attestUnknownQueryRun'>;
type ArchiveOverrides = Partial<ArchiveLineInput> & { requestId?: string };
type OpenOptions = { failFinalArchive?: boolean };

type Opened = {
  b2: B2ExecutionFixture;
  base: B2ExecutionFixture['base'];
  records: B2Records;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  goalRef: GoalRef;
  /** S: the first fixture Session, which the real claim already bound to r0. */
  session: SessionRef;
  /** D: a second, independent Session that never ran Task A. */
  target: SessionRef;
  taskA: TaskTriple;
  run: RunRef;
  anomalies: ReturnType<typeof createSessionAnomalyService>;
  lifecycle: ReturnType<typeof createSessionLifecycleService>;
  controls: ReturnType<typeof createRunControlService>;
  reconcile: ReturnType<typeof createRunReconcileService>;
  setClock(at: string): void;
  runtime(): Promise<AgentRuntimeService>;
  workflow(): Promise<WorkflowPort>;
  archive(options?: AttestationOptions): ReturnType<typeof createSessionArchiveService>;
  request(overrides?: ArchiveOverrides): Promise<GraphWrite<ArchiveLineInput>>;
  record(ref?: SessionRef): Promise<SessionRecord>;
  responsibleLink(ref: SessionRef, task: TaskTriple): Promise<SessionWorkLink | null>;
  openResponsibility(ref: SessionRef, task: TaskTriple): Promise<SessionWorkLink>;
  retire(ref: SessionRef): Promise<void>;
  stopArchiveWork(): Promise<void>;
  manifestOf(runRef: RunRef): Promise<PreparedTaskManifestV1>;
  markRunOutcomeUnknown(targetRun: RunRef): Promise<void>;
  reDispatch(taskId: string, flowId: string): Promise<TaskClaim>;
  briefOf(runRef: RunRef): Promise<ContinuationBriefV1>;
  sessionCount(): Promise<number>;
  readRevision(refKey: string): Promise<number | null>;
  invariantsHold(label: string): Promise<void>;
};

const opened: Opened[] = [];

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(async () => {
  vi.useRealTimers();
  for (const fixture of opened.splice(0)) await fixture.b2.close();
});

/** A committed write's value; a failing step fails the row with its own message. */
function committed<T>(result: unknown, label: string): T {
  if (result === null || typeof result !== 'object'
    || (result as { status?: string }).status !== 'committed') {
    throw new Error(`${label}: expected a committed write, got ${JSON.stringify(result)}`);
  }
  return (result as { value: T }).value;
}

function taskTarget(task: TaskTriple): Extract<WorkLinkTarget, { kind: 'task' }> {
  return { kind: 'task', ref: { ...task } };
}

/**
 * IT13's injected race: the final `SessionArchived` commit loses its CAS once.
 * This is a commit-boundary fault, never a fabricated state write.
 */
function failFinalArchiveCommit(backend: B2Records): B2Records {
  let failed = false;
  return {
    ...backend,
    async commit(prepared) {
      if (!failed && prepared.events.some((event) => event.eventType === SESSION_ARCHIVED_EVENT)) {
        failed = true;
        return { status: 'rejected', code: 'revision_conflict',
          reason: 'the injected final archive conflict', current: [] };
      }
      return backend.commit(prepared);
    },
  };
}

async function open(kind: 'memory' | 'sqlite', options: OpenOptions = {}): Promise<Opened> {
  let clock = T0;
  const now = () => clock;
  vi.setSystemTime(new Date(clock));
  const b2 = await createB2ExecutionFixture(kind, ADDITIONAL_SCHEMAS, now);
  const base = b2.base;
  const records: B2Records = options.failFinalArchive === true
    ? failFinalArchiveCommit(base.records) : base.records;

  let eventSeq = 0;
  let idSeq = 0;
  const eventId = () => `s1-archive-event-${++eventSeq}`;
  const newId = () => `s1-archive-id-${++idSeq}`;

  const reads = createRunStateReader({ records });
  const sessionFacts = createSessionFactsService({ records });
  // The trusted basis is the REAL reader, never a fake.
  const responsibilities = createSessionResponsibilityService({
    records, lookups: records, basis: createSessionResponsibilityBasisReader(records), now,
  });
  const sessionAnomalies = createSessionAnomalyService({ records, lookups: records, sessionFacts, now });
  const sessionLifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts });
  const controls = createRunControlService({
    records, authority: createMaterialRecordReaders(records).authority, reads, now, eventId,
  });
  // The real unknown-run attestation owner (RUN-22); this is what IT26 binds.
  const reconcile = createRunReconcileService({
    records, reads, hostInstance: { hostInstanceId: 's1-archive-flow-host', lease: 'owned' }, now, eventId,
  });

  const session: SessionRef = base.sessions.first;
  const target: SessionRef = base.sessions.second;
  const goalRef = base.goalRef;
  const taskA = base.tasks.first;
  const run = b2.claim.runRef;

  const executorDuty: SessionDutyResolver = async (role: RoleConfigurationRef) => ({
    status: 'ready',
    value: role.kind === 'legacy_template' && role.templateId === 'builder' ? 'executor' : 'unknown',
  });
  const rejectAttestation = async () => ({ status: 'rejected' as const, code: 'unsupported' as const,
    reason: 'the fixed IT Host does not confirm this unknown execution in this row' });

  const allowedRuns = new Set<string>();
  const preparedRuns = new Map<string, PreparedTaskExecution>();
  let runtimeService: AgentRuntimeService | null = null;

  async function buildRuntime(): Promise<AgentRuntimeService> {
    const roles = createRoleConfigurationService({ records, now, eventId });
    const materialReads = createMaterialRecordReaders(records);
    const materials = createMaterialService({ bodies: b2.bodies, authority: materialReads.authority, now });
    const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: AP, storeKey: AW,
      workspace: base.scope, databasePath: join(base.directory, 'kernel.sqlite') }] });
    const sessionOperations = createSessionOperations({ sessions: base.sessionsPort, kernelStores });
    const activity = createExecutionHistoryReader({ history: sessionOperations });
    const scripted = createScriptedModel([{ kind: 'text', text: 's1-archive-flow scripted reply' }]);
    const host = createRuntimeHostDouble({ runRefs: allowedRuns, scripted, root: base.directory,
      skillRoot: join(base.directory, 'skills'), scope: base.scope, role: SESSION_ROLE });
    const deps: RuntimeExecutionDependencies = {
      claims: base.service,
      executions: reads,
      entry: b2.entry,
      modelRequests: b2.model,
      controls, runReconcile: reconcile,
      roles,
      // Rework 10 package R: the REQUIRED Task-review reader is the real owner
      // over this fixture's one real records store and Run reader.
      unknownCallReviews: createUnknownCallReviewService({ records, reads, now, eventId }),
      plans: base.plans,
      sessions: base.sessionsPort,
      materials,
      bodies: b2.bodies,
      historyWriter: createExecutionHistoryService({ records, now, eventId }),
      activity,
      graphHistory: createGraphExecutionHistoryReader({ executions: reads, history: activity }),
      sessionOperations,
      kernelStores,
      workspaceHost: {
        async resolveRoot(scope) {
          return scope.projectId === base.scope.projectId && scope.workspaceId === base.scope.workspaceId
            ? { status: 'ready', value: { root: base.directory, workspaceRevision: 1 } }
            : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace scope' };
        },
        async authorize(ctx, scope) {
          return ctx.projectId === base.scope.projectId && ctx.workspaceId === base.scope.workspaceId
            && scope.projectId === ctx.projectId && scope.workspaceId === ctx.workspaceId
            ? { status: 'ready', value: { subjectKey: canonicalJson(ctx.principal as unknown as JsonValue),
              permissionRevision: 's1-archive-flow-read@1', allowsRead: (path: string) => path === 'README.md' } }
            : { status: 'rejected', code: 'forbidden', reason: 'workspace scope mismatch' };
        },
      },
      sourceAuthority: () => createSourceAuthorityReader({ authority: materialReads.authority }),
      host,
      kernel,
      now,
      newId,
    };
    return createAgentRuntime(deps);
  }

  const fixture: Opened = {
    b2, base, records, ctx: base.ctx, scope: base.scope, goalRef, session, target, taskA, run,
    anomalies: sessionAnomalies, lifecycle: sessionLifecycle, controls, reconcile,
    setClock(at) { clock = at; vi.setSystemTime(new Date(at)); },
    async runtime() { runtimeService ??= await buildRuntime(); return runtimeService; },
    workflow: () => workflowForFixture(b2, { records, now, allowedRuns }),
    archive(attestation = {}) {
      const workflow = () => workflowForFixture(b2, { records, now, allowedRuns, ...attestation });
      return {
        async archiveLine(ctx, request) {
          const owner = await workflow();
          if (owner.archiveLine === undefined) throw new Error('Workflow archiveLine is absent');
          return owner.archiveLine(ctx, request);
        },
        async continueArchiveLine(ctx, request) {
          const owner = await workflow();
          if (owner.continueArchiveLine === undefined) throw new Error('Workflow continueArchiveLine is absent');
          return owner.continueArchiveLine(ctx, request);
        },
      };
    },
    async request(overrides = {}) {
      const { requestId, ...rest } = overrides;
      const sessionRef = rest.sessionRef ?? session;
      const pin = await base.sessionPin(sessionRef);
      return {
        input: { sessionRef, reason: rest.reason ?? 'S1 archive flow', tasks: rest.tasks ?? [],
          wait: rest.wait ?? null,
          ...(rest.confirmUnknownStopped === undefined ? {} : { confirmUnknownStopped: rest.confirmUnknownStopped }) },
        meta: { requestId: requestId ?? `s1-archive-request-${++idSeq}`, expected: [pin] },
      };
    },
    async record(ref = session) {
      const card = await base.sessionsPort.readSession(base.ctx, ref);
      if (card.status !== 'ready') throw new Error(`archive Session read failed: ${JSON.stringify(card)}`);
      return card.value.record;
    },
    async responsibleLink(ref, task) {
      const linkRef: SessionWorkLinkRef = { ...ref, aggregateType: 'SessionWorkLink',
        target: taskTarget(task), relation: 'responsible' };
      const key = sessionWorkLinkRefKey(linkRef);
      const read = await records.readMany([key]);
      if (read.status !== 'ready') throw new Error(`archive link read failed: ${JSON.stringify(read)}`);
      const encoded = read.value.records.find((record) => record.refKey === key);
      if (encoded === undefined) return null;
      const decoded = decodeSessionWorkLink(encoded);
      if (decoded.status !== 'decoded') throw new Error(`archive link decode failed: ${decoded.reason}`);
      return decoded.value;
    },
    async openResponsibility(ref, task) {
      const existing = await fixture.responsibleLink(ref, task);
      if (existing !== null && existing.until === null) return existing;
      const linkRef: SessionWorkLinkRef = { ...ref, aggregateType: 'SessionWorkLink',
        target: taskTarget(task), relation: 'responsible' };
      const linkRevision = (await fixture.readRevision(sessionWorkLinkRefKey(linkRef))) ?? 0;
      const request: GraphWrite<LinkSessionWorkInput> = {
        input: { sessionRef: ref, target: taskTarget(task), relation: 'responsible', active: true },
        meta: { requestId: `s1-archive-link-${ref.sessionId}-${task.taskId}`,
          expected: [await base.sessionPin(ref), { ref: linkRef, revision: linkRevision }] },
      };
      return committed<SessionWorkLink>(await sessionLifecycle.linkSessionWork(base.ctx, request), 'archive link setup');
    },
    retire: (ref) => retireSession(base, ref, now),
    async markRunOutcomeUnknown(targetRun) {
      expect(targetRun).toEqual(run);
      await unknownWork(b2, now);
    },
    async stopArchiveWork() {
      const before = await b2.read();
      const intentRef = before.run.controlState?.intentRef;
      if (intentRef === undefined) throw new Error('archive did not submit its cancel');
      const submitted = await controls.readControl(base.ctx, intentRef);
      if (submitted.status !== 'ready') throw new Error(JSON.stringify(submitted));
      expect({ kind: submitted.value.kind, status: submitted.value.status }).toEqual({ kind: 'cancel', status: 'queued' });
      const runtime = await fixture.runtime();
      const delivered = await runtime.port.deliverControl!(base.ctx, { intentRef });
      if (delivered.status !== 'ready') throw new Error(JSON.stringify(delivered));
      expect(delivered.value.ref).toEqual(intentRef);
      // The executor has gone at a Host takeover, and its Kernel Turn is clean.
      // RUN-23 records the real stop, settles the intent and releases the writer.
      const stopped = await reconcile.reconcileRun(base.ctx, {
        input: { runRef: run, basis: { kind: 'host_instance_takeover', hostInstanceId: 's1-archive-flow-host' },
          probe: 'ready', result: { kind: 'paused_stop', cancelIntentRef: intentRef, pausedBy: null,
            turn: { terminal: false, inFlightToolCallIds: [], lastPosition: 3, kernelPaused: false,
              entered: null, acceptedSteers: [], inputsConfirmed: true } } },
        meta: { requestId: 's1-archive-stop-observed', expected: [await b2.pin()] },
      });
      expect(stopped, JSON.stringify(stopped)).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'cancelled' } });
      expect((await b2.read()).session.occupancy).toBeNull();
    },
    async reDispatch(taskId, flowId) {
      const workflow = await fixture.workflow();
      let next = await workflow.advanceWork(fixture.ctx, { schemaVersion: 1, goalRef, flowId,
        sessionHint: null, kind: 'select_work', taskId });
      let claim: TaskClaim | null = null;
      for (let step = 0; step < 4; step += 1) {
        if (next.status !== 'ready') throw new Error(`archive re-dispatch did not advance: ${JSON.stringify(next)}`);
        if (next.value.next === null) throw new Error(`archive re-dispatch stopped: ${next.value.reason ?? 'no next step'}`);
        const performed = await workflow.advanceWork(fixture.ctx, next.value.next);
        if (performed.status !== 'ready') throw new Error(`archive re-dispatch perform failed: ${JSON.stringify(performed)}`);
        const receipt = performed.value.receipt;
        if (receipt !== null && receipt.kind === 'claim_task' && receipt.result.status === 'committed') {
          claim = receipt.result.value;
          allowedRuns.add(canonicalJson(claim.runRef as unknown as JsonValue));
        }
        // The real prepare pins the continuation brief; stop before `start`
        // (the row observes the brief, it does not run the Kernel).
        if (receipt !== null && receipt.kind === 'prepare' && receipt.result.status === 'ready' && claim !== null) {
          preparedRuns.set(canonicalJson(claim.runRef as unknown as JsonValue), receipt.result.value);
          return claim;
        }
        next = performed;
      }
      throw new Error('the ordinary Workflow re-dispatch did not reach a prepared claim');
    },
    async manifestOf(runRef) {
      const prepared = preparedRuns.get(canonicalJson(runRef as unknown as JsonValue));
      if (prepared === undefined) throw new Error('no real prepare receipt for this Run');
      const loaded = await loadPreparedManifest(b2.bodies, prepared);
      if (loaded.status !== 'ready') throw new Error(JSON.stringify(loaded));
      return loaded.value.manifest;
    },
    async briefOf(runRef) {
      const manifest = await fixture.manifestOf(runRef);
      if (manifest.continuationBrief === undefined) throw new Error('prepared manifest has no continuation brief');
      return manifest.continuationBrief;
    },
    async sessionCount() {
      const found = await base.sessionsPort.findSessions(base.ctx, {
        workspace: base.scope, role: SESSION_ROLE, includeArchived: true, page: { limit: 100 } });
      if (found.status !== 'ready') throw new Error(`archive Session directory read failed: ${JSON.stringify(found)}`);
      return found.value.items.length;
    },
    readRevision(refKey) { return readRevisionOf(records, refKey); },
    invariantsHold: (label) => base.audit.check(label),
  };
  opened.push(fixture);
  return fixture;
}

async function readRevisionOf(records: B2Records, refKey: string): Promise<number | null> {
  const read = await records.readMany([refKey]);
  if (read.status !== 'ready') throw new Error(`archive revision read failed: ${JSON.stringify(read)}`);
  return read.value.records.find((record) => record.refKey === refKey)?.revision ?? null;
}

function requeueKeyFor(f: Opened): string {
  return taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: f.run.projectId,
    goalId: f.run.goalId, taskId: f.taskA.taskId, afterRunId: f.run.runId });
}

describe.each(['sqlite'] as const)('S1 archive flow (%s)', (kind) => {
  it('IT12 a real entered Work still running leaves the archive pending with its request and no disposition', async () => {
    const f = await open(kind);
    await f.b2.enter();
    await f.openResponsibility(f.session, f.taskA);
    await f.invariantsHold('after the entered Work and its open responsibility');
    const linkBefore = await f.responsibleLink(f.session, f.taskA);
    const transfersBefore = f.base.audit.events().filter(({ event }) => event.eventType === 'SessionResponsibilityChanged').length;
    const result = await f.archive().archiveLine(f.ctx, await f.request({ requestId: 'it12',
      reason: 'IT12 stop the running Work',
      tasks: [{ target: taskTarget(f.taskA), disposition: { kind: 'drop' } }] }));
    expect(result).toMatchObject({ status: 'ready', value: { state: 'pending', message: '归档中 · 停止中' } });
    const record = await f.record(f.session);
    expect(record.archiveRequest).toMatchObject({ requestId: 'it12' });
    expect(record.occupancy).toEqual({ kind: 'execution', executionRef: f.run, generation: f.b2.claim.generation });
    const running = await f.b2.read();
    expect({ status: running.run.status, outcome: running.run.outcome }).toEqual({ status: 'running', outcome: null });
    const intentRef = running.run.controlState?.intentRef;
    if (intentRef === undefined) throw new Error('IT12 no durable cancel');
    const runtime = await f.runtime();
    const delivered = await runtime.port.deliverControl!(f.ctx, { intentRef });
    expect(delivered).toMatchObject({ status: 'ready', value: { kind: 'cancel', status: 'queued' } });
    // The stop is still in flight: the open responsibility is not disposed and
    // no TaskRequeue is written.
    expect(await f.responsibleLink(f.session, f.taskA)).toEqual(linkBefore);
    expect(f.base.audit.events().filter(({ event }) => event.eventType === 'SessionResponsibilityChanged').length).toBe(transfersBefore);
    expect(await f.readRevision(requeueKeyFor(f))).toBeNull();
    await f.invariantsHold('after the pending archive');
  });

  it('IT13 stop/anchor/drop already committed survive an injected final conflict as a partial archive', async () => {
    const f = await open(kind, { failFinalArchive: true });
    await f.b2.enter();
    await f.openResponsibility(f.session, f.taskA);
    await f.invariantsHold('after the entered Work before the injected final conflict');
    const archive = f.archive();
    const pending = await archive.archiveLine(f.ctx, await f.request({ requestId: 'it13',
      reason: 'IT13 injected final conflict',
      tasks: [{ target: taskTarget(f.taskA), disposition: { kind: 'drop' } }] }));
    expect(pending).toMatchObject({ status: 'ready', value: { state: 'pending', message: '归档中 · 停止中' } });
    await f.stopArchiveWork();
    const result = await archive.continueArchiveLine(f.ctx, { sessionRef: f.session, archiveRequestId: 'it13' });
    expect(result).toMatchObject({ status: 'ready', value: { state: 'partial',
      message: '处置已完成，归档没成功', rejection: { status: 'rejected', code: 'revision_conflict' } } });
    // The already-disposed responsibility link stays closed; it is never reopened.
    if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    const disposal = result.value.receipts.find(receipt => receipt.step === 'responsibility');
    if (disposal === undefined) throw new Error('IT13 missing committed responsibility receipt');
    expect((await f.responsibleLink(f.session, f.taskA))?.until).toBe(disposal.cursor);
    expect((await f.base.audit.world()).anchors?.map(anchor => anchor.runRef)).toEqual([f.run]);
    expect((await f.b2.read()).run.outcome).toBe('cancelled');
    expect(result.value.session.lifecycle).toBe('active');
    expect(result.value.receipts.map(receipt => receipt.step)).toEqual(expect.arrayContaining(['stop', 'anchor', 'responsibility']));
    await f.invariantsHold('after the final archive conflict');
  });

  it('IT14 an answering Query keeps the archive pending without a cancel or anchor, then archives after the answer', async () => {
    const f = await open(kind);
    // D is the row's S: it has no Work occupancy, and answers in its own Session.
    const query = await beginConsultation(f.b2, 'it14', f.target, () => T0, false);
    const sessionRef = query.sessionRef;
    await f.invariantsHold('after the answering Query');
    const controlsBefore = (await f.base.audit.world()).intents;
    const pending = await f.archive().archiveLine(f.ctx, await f.request({ requestId: 'it14',
      sessionRef, reason: 'IT14 Query answering' }));
    expect(pending).toMatchObject({ status: 'ready', value: { state: 'pending', message: '归档中' } });
    const listed = await f.anomalies.listSessionAnomalies(f.ctx, { goalRef: f.goalRef, page: { limit: 20 } });
    expect(listed).toMatchObject({ status: 'ready', value: { items: [] } });
    expect((await f.base.audit.world()).intents).toEqual(controlsBefore);
    expect((await f.base.audit.world()).anchors).toEqual([]);
    // The Query's own path saves the answer, then the durable request archives.
    const saved = await query.answer();
    const answered = await query.queryExecution.readQueryExecution(f.ctx, query.queryRunRef);
    if (answered.status !== 'ready') throw new Error(JSON.stringify(answered));
    expect(answered.value.answer?.answer).toEqual(saved.answer);
    expect(answered.value.run.run.outcome).toBe('answered');
    expect(answered.value.session.occupancy).toBeNull();
    const done = await f.archive().continueArchiveLine(f.ctx, { sessionRef, archiveRequestId: 'it14' });
    expect(done).toMatchObject({ status: 'ready', value: { state: 'archived', message: '已归档' } });
    expect((await f.base.audit.world()).intents).toEqual(controlsBefore);
    expect((await f.base.audit.world()).anchors).toEqual([]);
  });

  it('IT15 a real unknown Work without the explicit confirmation is busy, writes nothing and keeps occupancy', async () => {
    const f = await open(kind);
    await f.b2.enter();
    await f.markRunOutcomeUnknown(f.run);
    await f.openResponsibility(f.session, f.taskA);
    await f.invariantsHold('after the unknown-occupancy line');
    const before = await f.record(f.session);
    const totalsBefore = f.base.audit.totals();
    const result = await f.archive().archiveLine(f.ctx,
      await f.request({ requestId: 'it15', reason: 'IT15 no confirmation', confirmUnknownStopped: false,
        tasks: [{ target: taskTarget(f.taskA), disposition: { kind: 'drop' } }] }));
    expect(result).toMatchObject({ status: 'rejected', code: 'busy' });
    if (result.status !== 'rejected') throw new Error(`IT15 archive did not reject: ${JSON.stringify(result)}`);
    expect(result.reason.startsWith('archive_unknown_confirmation_required:')).toBe(true);
    const after = await f.record(f.session);
    expect(f.base.audit.totals()).toEqual(totalsBefore);
    expect(after).toEqual(before);
    expect(after.revision).toBe(before.revision);
    expect(after.archiveRequest ?? null).toBeNull();
    expect(after.occupancy).toEqual(before.occupancy);
    expect((await f.responsibleLink(f.session, f.taskA))?.until ?? null).toBeNull();
    expect((await f.b2.read()).run.outcome).toBe('outcome_unknown');
  });

  it('IT16 after the anchor the ordinary Workflow re-dispatch claims in D, keeps D history and starts no new Session', async () => {
    const f = await open(kind);
    const dQuery = await beginConsultation(f.b2, 'it16-d-history', f.target, () => T0, false);
    const dAnswer = await dQuery.answer();
    const historyBefore = await dQuery.queryExecution.readQueryExecution(f.ctx, dQuery.queryRunRef);
    if (historyBefore.status !== 'ready') throw new Error(JSON.stringify(historyBefore));
    const dBefore = await f.record(f.target);
    await f.b2.enter();
    await f.openResponsibility(f.session, f.taskA);
    await f.invariantsHold('after the entered Work and its open responsibility');
    const archive = f.archive();
    const pending = await archive.archiveLine(f.ctx, await f.request({ requestId: 'it16',
      reason: 'IT16 anchor then re-dispatch',
      tasks: [{ target: taskTarget(f.taskA), disposition: { kind: 'drop' } }] }));
    expect(pending).toMatchObject({ status: 'ready', value: { state: 'pending', message: '归档中 · 停止中' } });
    await f.stopArchiveWork();
    const archived = await archive.continueArchiveLine(f.ctx, { sessionRef: f.session, archiveRequestId: 'it16' });
    expect(archived).toMatchObject({ status: 'ready', value: { state: 'archived', message: '已归档' } });
    const sessionsBefore = await f.sessionCount();
    const claim = await f.reDispatch(f.taskA.taskId, 'it16');
    expect(claim.sessionRef).toEqual(f.target);
    expect(claim.sessionRef).not.toEqual(f.session);
    expect(await f.sessionCount()).toBe(sessionsBefore);
    const brief = await f.briefOf(claim.runRef);
    expect({ continuity: brief.session.continuity, sessionRef: brief.session.sessionRef, seededFrom: brief.session.seededFrom,
      sessionBasis: (await f.manifestOf(claim.runRef)).sessionBasis ?? null })
      .toEqual({ continuity: 'other_session', sessionRef: f.target, seededFrom: null, sessionBasis: null });
    expect(brief.anomalies?.anchors).toEqual((await f.base.audit.world()).anchors);
    expect(brief.anomalies?.anchors.map(anchor => anchor.runRef)).toEqual([f.run]);
    const historyAfter = await dQuery.queryExecution.readQueryExecution(f.ctx, dQuery.queryRunRef);
    if (historyAfter.status !== 'ready') throw new Error(JSON.stringify(historyAfter));
    expect({ job: historyAfter.value.job, run: historyAfter.value.run, answer: historyAfter.value.answer })
      .toEqual({ job: historyBefore.value.job, run: historyBefore.value.run, answer: historyBefore.value.answer });
    expect(historyAfter.value.answer?.answer).toEqual(dAnswer.answer);
    expect((await f.record(f.target)).historyCursor).toBe(dBefore.historyCursor);
    expect((await f.record(f.target)).provenance).toEqual(dBefore.provenance);
  });

  it('IT26 the real unknown-run attestation releases the occupancy, then one anchor and the archive; the Run is never completed', async () => {
    const f = await open(kind);
    await f.b2.enter();
    await f.markRunOutcomeUnknown(f.run);
    await f.openResponsibility(f.session, f.taskA);
    await f.invariantsHold('after the unknown-occupancy line before the attestation');
    // The Host attests the unknown end on the next day; every owner clock is injected.
    f.setClock(T1);
    const confirming = f.archive({
      attestUnknownRun: async (ctx, request) => {
        const attested = await f.reconcile.resolveUnknownRun(ctx, { input: {
        runRef: request.input.runRef, reason: request.input.reason, kernelTurnOpen: true, inputsConfirmed: null,
        review: { inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', items: [], itemsOmitted: 0,
          workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'IT26' } },
        }, meta: request.meta });
        expect(attested, JSON.stringify(attested)).toMatchObject({ status: 'committed', value: { outcome: 'crashed' } });
        expect((await f.record()).occupancy).toBeNull();
        expect((await f.base.audit.world()).anchors).toEqual([]);
        return attested;
      },
    });
    const result = await confirming.archiveLine(f.ctx,
      await f.request({ requestId: 'it26', reason: 'IT26 explicit confirmation', confirmUnknownStopped: true,
        tasks: [{ target: taskTarget(f.taskA), disposition: { kind: 'drop' } }] }));
    expect(result).toMatchObject({ status: 'ready', value: { state: 'archived', message: '已归档' } });
    expect(await f.record(f.session)).toMatchObject({ lifecycle: 'archived', archiveRequest: null });
    const runAfter = (await f.b2.read()).run;
    expect({ status: runAfter.status, outcome: runAfter.outcome }).toEqual({ status: 'ended', outcome: 'crashed' });
    expect((await f.base.audit.world()).anchors?.map(anchor => anchor.runRef)).toEqual([f.run]);
    expect(await f.readRevision(requeueKeyFor(f))).not.toBeNull();
  });

  it('IT27 with no other available Session the ordinary Workflow creates exactly one new Session with provenance new', async () => {
    const f = await open(kind);
    await f.b2.enter();
    await f.openResponsibility(f.session, f.taskA);
    // No other Session is available: D is archived through the real lifecycle entry.
    const dArchive = await f.lifecycle.archiveSession(f.ctx, {
      input: { sessionRef: f.target, reason: 'IT27 no reusable Session' },
      meta: { requestId: 'it27-retire-d', expected: [await f.base.sessionPin(f.target)] },
    } satisfies GraphWrite<ArchiveSessionInput>);
    expect(dArchive, JSON.stringify(dArchive)).toMatchObject({ status: 'committed', value: { lifecycle: 'archived' } });
    await f.invariantsHold('after D was archived through the real lifecycle entry');
    const archive = f.archive();
    const pending = await archive.archiveLine(f.ctx, await f.request({ requestId: 'it27',
      reason: 'IT27 anchor then create',
      tasks: [{ target: taskTarget(f.taskA), disposition: { kind: 'drop' } }] }));
    expect(pending).toMatchObject({ status: 'ready', value: { state: 'pending', message: '归档中 · 停止中' } });
    await f.stopArchiveWork();
    const archived = await archive.continueArchiveLine(f.ctx, { sessionRef: f.session, archiveRequestId: 'it27' });
    expect(archived).toMatchObject({ status: 'ready', value: { state: 'archived', message: '已归档' } });
    const sessionsBefore = await f.sessionCount();
    const claim = await f.reDispatch(f.taskA.taskId, 'it27');
    expect(claim.sessionRef).not.toEqual(f.target);
    expect(claim.sessionRef).not.toEqual(f.session);
    expect(await f.sessionCount()).toBe(sessionsBefore + 1);
    const created = await f.record(claim.sessionRef);
    expect(created.provenance).toEqual({ schemaVersion: 1, kind: 'new' });
    const brief = await f.briefOf(claim.runRef);
    expect(brief.session).toMatchObject({ continuity: 'other_session', seededFrom: null });
    expect((await f.manifestOf(claim.runRef)).sessionBasis ?? null).toBeNull();
    expect(brief.anomalies?.anchors).toEqual((await f.base.audit.world()).anchors);
    expect(brief.anomalies?.anchors.map(anchor => anchor.runRef)).toEqual([f.run]);
    const successors = await createSessionFactsService({ records: f.records }).findSessionSuccessors(f.ctx,
      { sessionRef: f.session, page: { limit: 100 } });
    if (successors.status !== 'ready') throw new Error(JSON.stringify(successors));
    expect(successors.value.items).toEqual([]);
  });
});


