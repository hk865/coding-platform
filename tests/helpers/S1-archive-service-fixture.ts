/** Shared fx1 fixture. All platform histories use owners; only Kernel observations
 * cross the trusted B2 boundary. No Run, Attempt, message or Session is raw-seeded. */
import { expect, vi } from 'vitest';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, SessionWorkLinkRef, VersionPin, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { ArchiveStepRefV1, RequestSessionArchiveInput, SessionArchiveRequestV1 } from '../../src/contracts/core/session-archive.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { continuationBriefDigest, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { assembleAnomalySection, assembleContinuationBrief } from '../../src/core/agent-runtime/continuation-brief-assembly.js';
import { createRuntimeControlCoordinator } from '../../src/core/agent-runtime/execution-control.js';
import { terminalEventOf } from '../../src/core/agent-runtime/execution-observation.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import type { ControlIntentSnapshotV1, SubmitControlInput } from '../../src/contracts/control-intent.js';
import type { RunRef, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { SESSION_ARCHIVE_AUTOMATION_ACTOR, WORKFLOW_AUTOMATION_ACTOR, type TaskAutomationPolicyV1, type TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { PreparedCommit, EncodedRecord, StoreResult } from '../../src/core/record-store/ports.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { AuthorizeConfiguration, KernelExecutionBinding } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { RequeueTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import { deriveSessionInputId, type SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { readCanonicalTaskFacts, createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { checkAllInvariants, invariantStoreOf, readInvariantWorld, type InvariantWorld } from '../state/invariants.js';
import { B2_HOST, createB2ExecutionFixture, type B2Records } from './B2-execution-fixture.js';
import type { ClaimFixtureKind, ClaimConnection } from './task-claim-fixture.js';
import { ProviderRegistry, SqliteStores, runCodingAgent, type SessionRecord as KernelRecord } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel } from './B2-runtime-fixture.js';

export const t0 = '2026-10-08T00:00:00.000Z';
export const t1 = '2026-10-09T00:00:00.000Z';
export const CAP_THREE: TaskAutomationPolicyV1 = { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: false };
export const key = (value: object): string => canonicalJson(value as JsonValue);
export const CRASHED = { eventType: 'run_crashed', payload: { kind: 'crashed', error: 'ordinary tool failure' } } as const;
export const COMPLETED = { eventType: 'run_completed', payload: { kind: 'completed', exitCode: 0 } } as const;
export const CANCELLED = { eventType: 'run_cancelled', payload: { kind: 'cancelled', reason: 'archive stopped this Run' } } as const;
const GRANT = { ...B2_HOST.permissions, tools: [...B2_HOST.permissions.tools, 'send_session_message', 'respond_session_message'] };

export function committed<T>(result: WriteResult<T>) {
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') throw new Error(JSON.stringify(result));
  return result;
}
export function ready<T>(result: ReadResult<T> | StoreResult<T>): T {
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  return result.value;
}

export async function createArchiveServiceFixture(kind: ClaimFixtureKind) {
  // Lifecycle has no now dependency in its frozen declaration; §3.3 explicitly
  // permits setSystemTime there. Owners with a now dependency receive it below.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(t0));
  const groups = [SESSION_LIFECYCLE_RECORD_SCHEMAS, SESSION_MESSAGE_RECORD_SCHEMAS,
    SESSION_ANOMALY_RECORD_SCHEMAS, CONTROL_RECORD_SCHEMAS];
  const b2 = await createB2ExecutionFixture(kind, { records: groups.flatMap(g => g.records),
    events: groups.flatMap(g => g.events), lookups: groups.flatMap(g => g.lookups ?? []) });
  const base = b2.base;
  let backend = base.records;
  let reopened: ClaimConnection | undefined;
  let clock = t0;
  const now = () => clock;
  let sequence = 0;
  const id = () => `fx1-${++sequence}`;
  const S = b2.claim.sessionRef;
  const D = b2.secondClaim.sessionRef;
  const taskTarget = { kind: 'task' as const, ref: base.tasks.first };
  let previous: InvariantWorld | undefined;
  async function invariants() {
    // The supplied invariant reader supports SQLite only.
    if (kind === 'sqlite') {
      const world = await readInvariantWorld(invariantStoreOf(base.directory), base.scope.projectId);
      expect(checkAllInvariants(world, previous)).toEqual([]);
      previous = world;
    }
  }
  await invariants();
  const batches: { batch: PreparedCommit; cursor: string }[] = [];
  const writes = { commits: 0, records: 0, events: 0, receipts: 0 };
  const calls = { kernel: 0, provider: 0, check: 0, model: 0, capture: 0 };
  let failNext = false;
  const records: B2Records = {
    readMany: refs => backend.readMany(refs), lookup: request => backend.lookup(request),
    lookupCommit: request => backend.lookupCommit(request), eventAt: cursor => backend.eventAt(cursor),
    async commit(batch) {
      if (failNext) { failNext = false; return { status: 'rejected', code: 'unavailable', reason: 'fx1 injected commit failure' }; }
      const result = await backend.commit(batch);
      if (result.status === 'committed' && !result.replayed) {
        writes.commits++;
        writes.records += batch.records.length; writes.events += batch.events.length; writes.receipts++;
        batches.push({ batch: structuredClone(batch), cursor: result.cursor });
        await invariants();
      }
      return result;
    },
  };
  const reads = createRunStateReader({ records, bodies: b2.bodies });
  const roles = createRoleConfigurationService({ records, now, eventId: id });
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    if (ctx.projectId !== base.scope.projectId || ctx.workspaceId !== base.scope.workspaceId
      || input.configurationRevision !== B2_HOST.configurationRevision
      || key({ template: input.hostTemplate }) !== key({ template: B2_HOST.hostTemplate })
      || ![B2_HOST.permissions, GRANT].some(p => key(p) === key(input.permissions))) {
      return { status: 'rejected', code: 'forbidden', reason: 'fixture Host configuration mismatch' };
    }
    return { status: 'ready', value: { configurationRevision: B2_HOST.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(B2_HOST.hostTemplate) } };
  };
  const materials = createMaterialService({ bodies: b2.bodies,
    authority: createMaterialRecordReaders(records).authority, now });
  const entry = createExecutionEntryService({ records, reads, roles, bodies: b2.bodies,
    authorizeConfiguration, now, eventId: id, newId: id });
  const sessionFacts = createSessionFactsService({ records });
  const lifecycleOn = (port = records) => createSessionLifecycleService({ records: port, lookups: port, sessionFacts });
  const lifecycle = lifecycleOn();
  const responsibilities = createSessionResponsibilityService({ records, lookups: records,
    basis: createSessionResponsibilityBasisReader(records), now });
  const anomalies = createSessionAnomalyService({ records, lookups: records, sessionFacts, now });
  const controlsOn = (port = records) => createRunControlService({ records: port,
    authority: createMaterialRecordReaders(port).authority, reads: createRunStateReader({ records: port }), now, eventId: id });
  const controls = controlsOn();
  const sessions = createSessionDirectory({ records, lookups: records });
  const healthOn = (port = records) => createSessionHealthService({ records: port,
    hostInstance: { hostInstanceId: 'fx1-host', lease: 'owned' }, now, eventId: id });
  function mailboxOn() {
    const box = createSessionMailbox({ records, sessions, executions: reads, roles, materials,
      runtimeAdmission: { bodies: b2.bodies, authorizeConfiguration },
      systemActor: { kind: 'system', id: 'fx1-materials' }, now, newId: id });
    if (!box.disposeArchiveWait || !box.readUndeliveredReplies || !box.readRoutedReplies || !box.recordInputAccepted) {
      throw new Error('the slice-1 mailbox surface is absent');
    }
    return { ...box, disposeArchiveWait: box.disposeArchiveWait, readUndeliveredReplies: box.readUndeliveredReplies,
      readRoutedReplies: box.readRoutedReplies, recordInputAccepted: box.recordInputAccepted };
  }
  let mailbox = mailboxOn();
  const kernels = new Map<string, KernelExecutionBinding>();
  function hostCtx(actor: { kind: 'human' | 'system'; id: string } = { kind: 'human', id: 'fx1-operator' }): CoreCallContext {
    return { ...base.ctx, principal: { kind: 'host', actor },
      materialReader: { kind: 'host', ...base.scope, actor } };
  }
  const ctx = hostCtx();
  function workCtx(claim: TaskClaim): CoreCallContext {
    return { ...base.ctx, principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: base.roleBinding },
      materialReader: { kind: 'run', requester: claim.runRef } };
  }
  async function pin(ref: VersionPin['ref']): Promise<VersionPin> {
    const read = ready(await records.readMany([key(ref)]));
    return { ref, revision: read.records.find(r => r.refKey === key(ref))?.revision ?? 0 };
  }
  const sessionPin = (ref = S) => pin(plainSessionRefToAggregate(ref));
  const execution = async (claim = b2.claim) => ready(await reads.readExecution(ctx, claim.runRef));
  const session = async (ref = S) => ready(await sessions.readSession(ctx, ref));
  const encoded = async (ref: object): Promise<EncodedRecord | null> =>
    ready(await records.readMany([key(ref)])).records.find(r => r.refKey === key(ref)) ?? null;
  async function enter(claim = b2.claim) {
    const prepared = await b2.buildPrepared({ claim, permissions: GRANT });
    const facts = await execution(claim);
    if (facts.run.requeueRef) {
      const basis = ready(await reads.readContinuationBasis!(ctx, { runRef: claim.runRef }));
      if (basis.requeue.archiveOrigin?.kind === 'execution') {
        expect(basis.pendingAnomalies?.map(anchor => anchor.ref)).toContainEqual(basis.requeue.archiveOrigin.anchorRef);
      }
      const pending = basis.pendingAnomalies ?? [];
      const anomalies = pending.length === 0 ? null : assembleAnomalySection(pending);
      const brief = assembleContinuationBrief({ basis, factsRecord: basis.previous, factsHops: 0, factsTruncated: false,
        turn: { kernel: 'unavailable', reason: 'B2 observation fixture has no prior Kernel store' },
        workspace: { briefCheckpoint: { kind: 'brief', at: now(), workspaceRevision: 1,
          sourceDigest: null, unavailableReason: 'not captured in this service fixture' },
          uncommitted: { status: 'unavailable', baseCommit: null, paths: [], omitted: 0,
            reason: 'not captured in this service fixture' } }, claimSessionRef: claim.sessionRef, anomalies });
      const digest = continuationBriefDigest(brief);
      const body = ready(await b2.bodies.read(prepared.envelope.bundleRef));
      const manifest = JSON.parse(body.body) as PreparedTaskManifestV1;
      manifest.continuationBrief = brief;
      manifest.input += `\n\n${renderContinuationBriefZh(brief, digest)}`;
      manifest.inputDigest = sha256Hex(manifest.input);
      const json = JSON.stringify(manifest);
      const stored = ready(await b2.bodies.put({ body: json, contentType: body.ref.contentType,
        sourceRefs: body.sourceRefs, origin: { kind: 'run', owner: claim.runRef }, requestedAt: now() }));
      prepared.envelope.bundleRef = stored.ref;
      prepared.inputBinding = { ...prepared.inputBinding, inputDigest: manifest.inputDigest,
        manifestDigest: sha256Hex(json), continuationBriefDigest: digest,
        ...(brief.anomalies ? { anomalyAnchorRefs: brief.anomalies.anchors.map(anchor => anchor.ref) } : {}) };
    }
    const kernel: KernelExecutionBinding = { adapterId: facts.session.kernel.adapterId,
      kernelSessionId: facts.session.kernel.kernelSessionId, runId: `kernel-${claim.runRef.runId}`, turnId: `turn-${claim.runRef.runId}` };
    const authorized = committed(await entry.authorizeRuntimeEntry(ctx, { input: { prepared, consumerId: id() },
      meta: { requestId: id(), expected: [await pin(claim.runRef)] } }));
    const begun = committed(await entry.beginRuntimeEntry(ctx, { input: { permit: authorized.value, kernel },
      meta: { requestId: id(), expected: [await pin(claim.runRef)] } }));
    committed(await entry.recordExecutionEntered(ctx, { input: {
      permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision }, enteredAt: now(),
      kernelSource: { ...kernel, position: 3 }, history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: id(), expected: [await pin(claim.runRef)] } }));
    kernels.set(claim.runRef.runId, kernel);
    return kernel;
  }
  async function end(claim = b2.claim, event: Pick<RuntimeEventV1, 'eventType' | 'payload'>
    & Partial<Pick<RuntimeEventV1, 'eventId' | 'sequence' | 'occurredAt'>> = COMPLETED,
    messageRef?: SessionMessageRef, endPosition = 4) {
    const facts = await execution(claim);
    const auth = facts.run.executionAuthorization;
    if (!auth || !('schemaVersion' in auth) || auth.schemaVersion !== 2 || auth.kernel === null) throw new Error('Run has no entered identity');
    const kernel = auth.kernel;
    return committed(await entry.recordRunResult(ctx, { input: { claim,
      entry: { consumerId: auth.consumerId, entryGeneration: auth.generation },
      event: { ...b2.terminalEvent(), eventId: id(), runRef: claim.runRef, occurredAt: now(), ...event },
      kernelSource: { ...kernel, position: endPosition },
      completedHistoryBoundary: { source: { ...kernel, position: endPosition }, cursor: `${kernel.runId}:${endPosition}` },
      history: { kernel, startPosition: 2, observedThroughPosition: endPosition, endPosition },
      ...(messageRef ? { continuation: { schemaVersion: 1 as const, kind: 'wait_reply' as const,
        task: claim.task, sessionRef: claim.sessionRef, messageRef } } : {}) },
      meta: { requestId: id(), expected: [await pin(claim.runRef)] } }));
  }
  async function send(claim = b2.claim, recipient = D) {
    return committed(await mailbox.sendMessage(workCtx(claim), { input: { recipient, text: 'Which file should this work use?',
      intent: 'inquiry', needsReply: true, waitAfterSend: true }, meta: { requestId: id(), expected: [] } })).value;
  }
  async function yieldWait(message: SessionMessage, claim = b2.claim, endPosition = 4) {
    return end(claim, { eventType: 'run_yielded', payload: { kind: 'yielded', yield: {
      reason: 'reply_required', requestedBy: 'app', yieldedAt: now(), pendingToolCallId: null } } }, message.ref, endPosition);
  }
  async function respond(message: SessionMessage, claim = b2.secondClaim) {
    const current = ready(await mailbox.readMessage(ctx, message.ref));
    return committed(await mailbox.respondMessage(workCtx(claim), { input: { messageRef: message.ref, text: 'Use result.txt.' },
      meta: { requestId: id(), expected: [{ ref: message.ref, revision: current.revision }] } }));
  }
  async function archiveWrite(overrides: Partial<Omit<RequestSessionArchiveInput, 'sessionRef'>> = {}, requestId = 'a'):
    Promise<GraphWrite<RequestSessionArchiveInput>> {
    return { input: { sessionRef: S, reason: 'Archive this line', tasks: [], wait: null, confirmUnknownStopped: false, ...overrides },
      meta: { requestId, expected: [await sessionPin()] } };
  }
  async function register(overrides: Partial<Omit<RequestSessionArchiveInput, 'sessionRef'>> = {}, requestId = 'a') {
    const requester = overrides.mode === 'retired' ? hostCtx(SESSION_ARCHIVE_AUTOMATION_ACTOR) : ctx;
    const result = committed(await lifecycle.requestSessionArchive(requester, await archiveWrite(overrides, requestId)));
    const request = result.value.archiveRequest;
    if (!request) throw new Error('archive request missing from committed Session');
    return request;
  }
  const archiveCtx = (request: SessionArchiveRequestV1) => hostCtx(request.requestedBy);
  function step(request: SessionArchiveRequestV1, name: ArchiveStepRefV1['step'], subject: object = S): ArchiveStepRefV1 {
    return { sessionRef: S, archiveRequestId: request.requestId, requestReceipt: request.receipt, step: name, subjectKey: key(subject) };
  }
  function cancelRequest(request: SessionArchiveRequestV1, runRef: RunRef): GraphWrite<SubmitControlInput> {
    const original = request.executionPins.find(p => key(p.ref) === key(runRef));
    if (!original) throw new Error('archive request has no original Run pin');
    return { input: { runRef, kind: 'cancel', reason: request.reason }, meta: {
      requestId: 's1-archive-control:' + sha256Hex(canonicalJson({ requestReceipt: request.receipt, runRef, action: 'cancel' })),
      expected: [original] } };
  }
  async function cancel(request: SessionArchiveRequestV1, claim = b2.claim) {
    return committed(await controls.submitControl(hostCtx(request.requestedBy), cancelRequest(request, claim.runRef)));
  }
  async function observeCancel(intent: ControlIntentSnapshotV1, claim = b2.claim) {
    const delivered = await deliverControl(intent, claim);
    expect(delivered.controller.signal.aborted).toBe(true);
    try { await end(claim, CANCELLED); }
    finally { delivered.finish(); await delivered.coordinator.close(); }
    const facts = await execution(claim);
    const auth = facts.run.executionAuthorization;
    const history = facts.run.executionHistory;
    if (!auth || !('schemaVersion' in auth) || auth.schemaVersion !== 2 || !history) throw new Error('cancel lacks entered history');
    return committed(await controls.recordControlObservation(ctx, { input: { intentRef: intent.ref, runRef: claim.runRef,
      observation: { schemaVersion: 1, kind: 'cancelled', entry: { consumerId: auth.consumerId,
        entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration }, history,
        source: { ...history.kernel, position: history.endPosition! }, kernelEventId: facts.run.lastRuntimeEventId,
        kernelEventSequence: facts.run.lastEventSeq, observedAt: now() } },
      meta: { requestId: id(), expected: [await pin(intent.ref), await pin(claim.runRef)] } }));
  }
  async function deliverControl(intent: ControlIntentSnapshotV1, claim = b2.claim) {
    const facts = await execution(claim);
    const auth = facts.run.executionAuthorization;
    if (!auth || !('schemaVersion' in auth) || auth.schemaVersion !== 2 || !auth.kernel) throw new Error('delivery needs the entered identity');
    const controller = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; });
    const coordinator = createRuntimeControlCoordinator({ controls,
      sourceAuthority: () => createSourceAuthorityReader({ authority: createMaterialRecordReaders(records).authority }) });
    const handle = coordinator.register({ runRef: claim.runRef, done, controller, kernel: auth.kernel,
      entry: { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration },
      kernelExited: false });
    const delivered = ready(await coordinator.deliver(ctx, { intentRef: intent.ref }));
    expect(delivered).toEqual(intent);
    if (intent.kind === 'pause') expect(await coordinator.decide(ctx, claim.runRef)).toEqual({ kind: 'pause' });
    expect(coordinator.proof(claim.runRef)?.consumedIntentRef).toEqual(intent.ref);
    return { coordinator, controller, finish() { handle.kernelExited = true; finish(); } };
  }
  async function retire() {
    const result = await healthOn().recordSessionHealth(ctx, { sessionRef: S, probe: { verdict: 'missing', activeRunId: null } });
    expect(result).toMatchObject({ status: 'observed', session: { health: 'unavailable' } });
    if (result.status !== 'observed') throw new Error(JSON.stringify(result));
    return result.session;
  }
  async function pauseAndReconcile() {
    const paused = committed(await controls.submitControl(ctx, { input: { runRef: b2.claim.runRef, kind: 'pause', reason: 'operator pause' },
      meta: { requestId: id(), expected: [await pin(b2.claim.runRef)] } }));
    const delivered = await deliverControl(paused.value.intent);
    delivered.finish(); await delivered.coordinator.close();
    const service = createRunReconcileService({ records, reads, hostInstance: { hostInstanceId: 'fx1-host', lease: 'owned' }, now, eventId: id });
    committed(await service.reconcileRun(ctx, { input: { runRef: b2.claim.runRef,
      basis: { kind: 'host_instance_takeover', hostInstanceId: 'fx1-host' }, probe: 'ready',
      result: { kind: 'interrupted_clean', turn: { terminal: false, inFlightToolCallIds: [], lastPosition: 3,
        kernelPaused: true, entered: null, acceptedSteers: [], inputsConfirmed: true } } },
      meta: { requestId: id(), expected: [await pin(b2.claim.runRef)] } }));
    return paused.value.intent;
  }
  async function link(target: WorkLinkTarget = taskTarget, relation: SessionWorkLinkRef['relation'] = 'responsible') {
    const ref: SessionWorkLinkRef = { ...S, aggregateType: 'SessionWorkLink', target, relation };
    return committed(await lifecycle.linkSessionWork(ctx, { input: { sessionRef: S, target, relation, active: true },
      meta: { requestId: id(), expected: [await sessionPin(), await pin(ref)] } }));
  }
  async function anchor(request: SessionArchiveRequestV1, claim = b2.claim) {
    return committed(await anomalies.recordSessionAnomaly(archiveCtx(request), { step: step(request, 'anchor', claim.runRef), files: {
      source: 'kernel', status: 'known', confirmed: [], possible: [], omitted: 0,
      baseCommit: null, runBaselineKnown: false, reason: null } }));
  }
  function requeueService() {
    return createTaskRequeueService({ records, reads, materials, messages: mailbox,
      workspaceHost: { async resolveRoot() { return { status: 'ready', value: { root: base.directory, workspaceRevision: 1 } }; } },
      source: { async captureDigest() { calls.capture++; return { status: 'ready', sourceDigest: sha256Hex(`source-${calls.capture}`) }; } },
      automationPolicy: () => CAP_THREE, now, eventId: id });
  }
  async function requeueWrite(claim = b2.claim, extra: Partial<RequeueTaskInput> = {}, requestId = id()): Promise<GraphWrite<RequeueTaskInput>> {
    return { input: { taskRef: base.tasks.first, afterRunRef: claim.runRef, reason: 'Retry the work', ...extra },
      meta: { requestId, expected: [await base.goalPin(), await pin(claim.runRef)] } };
  }
  /** A claim after a requeue: buildRequest() drops `requeueRef`, so it is set here, with the pinned budget (TASK-03). */
  async function requeueClaimRequest(sessionRef: SessionRef, requeue: TaskRequeueSnapshotV1) {
    const request = await base.buildRequest({ requestId: id(), input: { sessionRef } });
    return { ...request, input: { ...request.input, requeueRef: requeue.ref, ...(requeue.budget === null ? {} : { budget: requeue.budget }) } };
  }
  async function growChain(count: number, finalRunning = false, sessionRef = S, first = b2.claim) {
    let claim = first;
    for (let index = 0; index < count; index++) {
      const queued = committed(await requeueService().requeueTask(hostCtx(WORKFLOW_AUTOMATION_ACTOR), await requeueWrite(claim)));
      if (queued.value.kind !== 'requeued') throw new Error(JSON.stringify(queued));
      claim = committed(await base.makeService(records, now).claimTask(ctx,
        await requeueClaimRequest(sessionRef, queued.value.requeue))).value;
      await enter(claim);
      if (index < count - 1 || !finalRunning) await end(claim, CRASHED);
    }
    return claim;
  }
  const taskFacts = async () => {
    const result = await readCanonicalTaskFacts(records, base.goalRef, base.plan, base.tasks.first.taskId);
    if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    return result.value;
  };
  async function continuation() {
    const admitted = committed(await sessions.admitSessionCreation(ctx, { input: { workspace: base.scope,
      kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' }, recommendedRefs: [], initialLinks: [],
      provenance: { schemaVersion: 1, kind: 'continuation', from: S, reason: 'interrupted', task: base.tasks.first } },
      meta: { requestId: id(), expected: [] } }));
    const created = committed(await sessions.recordSessionCreated(ctx, { input: { operationRef: admitted.value.ref,
      sessionRef: admitted.value.action.plannedSessionRef, adapterId: 'r4c-claim-kernel', kernelSessionId: id(),
      historyCursor: null, observedAt: now() }, meta: { requestId: id(), expected: [] } }));
    return { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
  }
  /** A real local Kernel safe point, followed by reading its persisted input event.
   * For SV54 this runs BEFORE the source's yielded result is booked. */
  async function kernelAccept(claim: TaskClaim, message: SessionMessage, yieldAfter = false) {
    const kernel = kernels.get(claim.runRef.runId);
    if (!kernel) throw new Error('acceptance needs the entered Kernel identity');
    const executionRecord = await execution(claim);
    const bundleRef = executionRecord.run.envelope?.bundleRef;
    if (!bundleRef) throw new Error('acceptance needs the saved execution manifest');
    const manifest = JSON.parse(ready(await b2.bodies.read(bundleRef)).body) as PreparedTaskManifestV1;
    const body = ready(await mailbox.readMessageBody(ctx, { messageRef: message.ref, part: 'response' }));
    const scripted = createScriptedModel(yieldAfter
      ? [{ kind: 'calls', calls: [{ callId: 'fx1-read', name: 'read', args: { path: 'unused.txt' } }] }]
      : [{ kind: 'text', text: 'Received the response.' }]);
    const registry = new ProviderRegistry().register({ id: 'deepseek', secretEnvironmentVariable: 'FX1_UNUSED_KEY',
      defaultBaseUrl: 'http://127.0.0.1', capabilities: { streaming: true, toolCalls: true, usage: true },
      create: () => scripted.client });
    const databasePath = join(base.directory, `kernel-${claim.runRef.runId}.sqlite`);
    const inputId = deriveSessionInputId(message.ref, 'response');
    calls.kernel++;
    const outcome = await runCodingAgent({ workspaceRoot: base.directory, sessionId: kernel.kernelSessionId,
      executionIdentity: { runId: kernel.runId, turnId: kernel.turnId }, input: manifest.input,
      config: { schemaVersion: 1, model: { provider: 'deepseek', model: 'fx1-scripted', options: {}, maxOutputTokens: 256 },
        runtime: { tokenBudget: 10000, maxModelRequests: 2, maxToolCalls: 2 }, tools: { enabledNames: ['read'] },
        workspace: { consistencyMode: 'session' }, storage: { databasePath },
        skills: { resourceRoot: base.directory, enabledIds: [] }, memory: { provider: 'empty' } },
      providerRegistry: registry, secretSource: { get: () => 'local-scripted-provider' },
      inputSupply: async point => point.acceptedInputIds.includes(inputId) ? [] : [{ inputId, text: body.text,
        sourceRef: { kind: 'SessionMessage', messageRef: message.ref, part: 'response' } }],
      ...(yieldAfter ? { toolGroupBarrier: async (invocation: { point: string }) => invocation.point === 'after_group'
        ? { kind: 'yield' as const, reason: 'reply_required' as const } : { kind: 'continue' as const } } : {}) });
    calls.provider += scripted.calls(); calls.model += scripted.calls();
    const store = await SqliteStores.open(databasePath);
    const saved: KernelRecord[] = [];
    try {
      let after = 0;
      for (;;) {
        const page = await store.read(kernel.kernelSessionId, after, 100, { signal: ctx.signal });
        saved.push(...page.records);
        if (page.nextPosition === null) break;
        after = page.nextPosition;
      }
    } finally { await store.close(); }
    const accepted = saved.filter(record => record.recordType === 'agent.event'
      && record.payload.event.type === 'run.input_accepted'
      && record.payload.event.payload.input.inputId === inputId);
    expect(accepted).toHaveLength(1);
    const fact = accepted[0];
    if (!fact || fact.recordType !== 'agent.event' || fact.payload.event.type !== 'run.input_accepted') {
      throw new Error('Kernel did not persist the acceptance');
    }
    expect({ runId: fact.payload.event.meta.runId, turnId: fact.payload.event.meta.turnId,
      inputId: fact.payload.event.payload.input.inputId, text: fact.payload.event.payload.input.text,
      sourceRef: fact.payload.event.payload.input.sourceRef }).toEqual({ runId: kernel.runId, turnId: kernel.turnId,
      inputId, text: body.text, sourceRef: { kind: 'SessionMessage', messageRef: message.ref, part: 'response' } });
    const terminal = saved.findLast(record => record.recordType === 'agent.event'
      && record.payload.event.type === (yieldAfter ? 'run.yielded' : 'run.completed'));
    if (!terminal || terminal.recordType !== 'agent.event') throw new Error('Kernel terminal is missing');
    const terminalEvent = terminalEventOf(outcome.state, claim.runRef, terminal.payload.event.meta.sequence,
      terminal.payload.event.meta.eventId, terminal.payload.event.meta.occurredAt);
    if (!terminalEvent) throw new Error('Kernel outcome has no platform terminal');
    return { kernel: { ...kernel, position: fact.position }, terminalPosition: terminal.position, terminal: terminalEvent };
  }
  return { b2, base, records, ctx, S, D, taskTarget, writes, calls, batches, entry, controls, controlsOn, requeueClaimRequest,
    sessionFacts, lifecycle, lifecycleOn, responsibilities, anomalies, healthOn, sessions,
    get mailbox() { return mailbox; }, now, id, hostCtx, workCtx, pin, sessionPin, session, execution, encoded,
    enter, end, send, yieldWait, respond, archiveWrite, register, archiveCtx, step, cancelRequest, cancel, observeCancel,
    retire, pauseAndReconcile, link, anchor, requeueService, requeueWrite, growChain, taskFacts, continuation,
    kernelAccept, invariants,
    snapshot: () => structuredClone({ writes, calls }),
    setNow(value: string) { clock = value; vi.setSystemTime(new Date(value)); },
    failNextCommit() { failNext = true; },
    async reopen() {
      if (kind === 'sqlite') {
        await base.closeBackend(); reopened = await base.reopenService(); backend = reopened.records;
      }
      // A NEW owner even for memory, on precisely the same backing store.
      mailbox = mailboxOn();
    },
    async close() {
      // Owners may recover a committed receipt after a thrown callback. Check
      // again outside their recovery boundary so an invariant failure survives.
      try { await invariants(); }
      finally {
        try { await reopened?.close(); await b2.close(); }
        finally { vi.useRealTimers(); }
      }
    },
  };
}

export type ArchiveServiceFixture = Awaited<ReturnType<typeof createArchiveServiceFixture>>;
