/**
 * Group L (slice 2C) real Run/Query phase support for the LE3 line fixtures.
 *
 * Everything here is produced through the real public WorkGraph owners over the
 * fixture's real records port:
 *  - Work Run phases: the real `ExecutionEntryPort` (`authorizeRuntimeEntry`,
 *    `beginRuntimeEntry`, `recordExecutionEntered`, `recordRunResult`), so a
 *    `starting`/`running`/`ended` Run is never patched into the store;
 *  - the safe-point pause: the real `RunControlPort.submitControl` plus the
 *    Runtime's `recordControlObservation`;
 *  - retirement: the real `RunReconcilePort.reconcileRun` and the Host
 *    `SessionHealthPort.recordSessionHealth`;
 *  - a claimed `QueryRun`: the real `submitQueryJob` + `QueryExecutionPort.claimQuery`.
 *
 * No record is written directly and no model is called.
 */
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { withBackendOrderedLookup } from './ordered-lookup-forward.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type { QueryJobAnswerV1 } from '../../src/contracts/query-job.js';
import type { QueryEntryIdentity } from '../../src/core/work-graph/queries/contracts.js';
import type { RunContinuationV1, RunRef, RunSnapshot, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { ControlIntentRef, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { TaskEntryPermit } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { ExecutionEntryPort } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { ControlObservationPort, RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import type { ControlObservationV1 } from '../../src/contracts/control-intent.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { consultationQueryRefs } from '../../src/contracts/query-job.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { preparationHost, prepareQueryForReal, prepareTaskForReal, type TaskClaimFixture } from './task-claim-fixture.js';

export const L_HOST = {
  configurationRevision: 's2c-l-host@1',
  permissions: { policyRevision: 'legacy-template', tools: ['read'], writeScope: [] as string[] },
  hostTemplate: { templateId: 'builder', revision: '1', digest: artifactBodyDigest('s2c-l trusted builder template') },
};

export type RunSupport = {
  bodies: RawArtifactStorePort;
  entry: ExecutionEntryPort;
  buildPrepared(claim: TaskClaim): Promise<PreparedTaskExecution>;
  enter(claim: TaskClaim, at?: string): Promise<{ prepared: PreparedTaskExecution; permit: TaskEntryPermit }>;
  recordResult(claim: TaskClaim, event: RuntimeEventV1, continuation?: RunContinuationV1): Promise<RunSnapshot>;
  readExecution(claim: TaskClaim): Promise<TaskExecutionRecord>;
  pin(claim: TaskClaim): Promise<VersionPin>;
  pauseAtSafePoint(claim: TaskClaim): Promise<ControlIntentRef>;
  /** 2C-10: submit the pause that is later observed at the safe point. */
  submitPause(claim: TaskClaim): Promise<ControlIntentRef>;
  /** 2C-10: record the real `paused` observation for an already-submitted pause. */
  observePause(claim: TaskClaim, intentRef: ControlIntentRef): Promise<void>;
  /** Submit a stop control on an already ended (yielded) Run (2C-11 T3b/T7/P17/P18). */
  submitControl(claim: TaskClaim, kind: 'pause' | 'cancel'): Promise<ControlIntentRef>;
  /** 2C-17: submit any Run control and return the real accepted/refused result (never throws). */
  submitResult(claim: TaskClaim, kind: 'pause' | 'cancel' | 'resume'): Promise<WriteResult<SubmittedControl>>;
  /** 2C-17: the real control service and the current Run pin (a submission's `expected`). */
  controlsFor(): RunControlPort & ControlObservationPort;
  reconcileInterrupt(claim: TaskClaim): Promise<RunSnapshot>;
  retire(session: SessionRef, verdict: 'missing' | 'damaged'): Promise<void>;
  /** A plan-less Goal (the `initial_coordination` Query admission). */
  bareGoal(goalId: string): Promise<GoalRef>;
  claimQuery(session: SessionRef, goalRef: GoalRef, suffix: string): Promise<QueryRunRef>;
  /** The real consultation Query on a fresh readonly copy of `asked` (M6 answering copy). */
  beginConsultationCopy(asked: SessionRef, requestId: string): Promise<{ copy: SessionRef; queryRunRef: QueryRunRef }>;
  /** Advance a claimed consultation Query to `answered` (settled) or `unknown`. */
  completeConsultation(queryRunRef: QueryRunRef, session: SessionRef, mode: 'answered' | 'unknown' | 'entered', suffix: string, at?: string, options?: { now?: () => string }): Promise<void>;
  /** The real SessionMailbox over the same records (2C-18 message states). */
  mailbox(): ReturnType<typeof createSessionMailbox>;
};

export function createRunSupport(base: TaskClaimFixture): RunSupport {
  const records = base.records as GoalRecordTransactionPort & RecordLookupPort;
  let seq = 0;
  const now = () => '2026-09-24T00:00:00.000Z';
  const eventId = () => `s2c-l-run-event-${++seq}`;
  const newId = () => `s2c-l-run-id-${++seq}`;
  const reads = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const bodies = new RawArtifactBodyStore();
  const hostInstance = { hostInstanceId: 's2c-l-host', lease: 'owned' as const };

  const entry = createExecutionEntryService({
    records, reads, roles, bodies, now, eventId, newId,
    authorizeConfiguration: async (_ctx, input) => ({ status: 'ready', value: {
      configurationRevision: input.configurationRevision, permissions: input.permissions, hostTemplate: input.hostTemplate } }),
  });

  async function readExecution(claim: TaskClaim): Promise<TaskExecutionRecord> {
    const read = await reads.readExecution(base.ctx, claim.runRef);
    if (read.status !== 'ready') throw new Error(`S2C-L execution read failed: ${JSON.stringify(read)}`);
    return read.value;
  }

  async function pin(claim: TaskClaim): Promise<VersionPin> {
    const current = await readExecution(claim);
    return { ref: claim.runRef, revision: current.run.revision };
  }

  async function buildPrepared(claim: TaskClaim): Promise<PreparedTaskExecution> {
    const real = await prepareTaskForReal(base, {
      bodies, runRef: claim.runRef, now, requestId: `s2c-l-prepare-${++seq}`,
      host: preparationHost({ configurationRevision: L_HOST.configurationRevision,
        permissions: L_HOST.permissions, hostTemplate: L_HOST.hostTemplate }),
    });
    return real.prepared;
  }

  async function kernelFor(claim: TaskClaim): Promise<{ adapterId: string; kernelSessionId: string; runId: string; turnId: string }> {
    const current = await readExecution(claim);
    return { adapterId: current.session.kernel.adapterId, kernelSessionId: current.session.kernel.kernelSessionId,
      runId: `s2c-l-kernel-run-${claim.runRef.runId}`, turnId: `s2c-l-kernel-turn-${claim.runRef.runId}` };
  }

  async function enter(claim: TaskClaim, at?: string): Promise<{ prepared: PreparedTaskExecution; permit: TaskEntryPermit }> {
    const prepared = await buildPrepared(claim);
    const authorized = await entry.authorizeRuntimeEntry(base.ctx, { input: { prepared, consumerId: 's2c-l-runtime' },
      meta: { requestId: `s2c-l-authorize-${++seq}`, expected: [await pin(claim)] } });
    if (authorized.status !== 'committed') throw new Error(`S2C-L authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(base.ctx, { input: { permit: authorized.value, kernel: await kernelFor(claim) },
      meta: { requestId: `s2c-l-begin-${++seq}`, expected: [await pin(claim)] } });
    if (begun.status !== 'committed') throw new Error(`S2C-L begin failed: ${JSON.stringify(begun)}`);
    const permit: TaskEntryPermit = { ...authorized.value, authorizationRevision: begun.value.authorization.revision };
    const entered = await entry.recordExecutionEntered(base.ctx, { input: { permit, enteredAt: at ?? now(),
      kernelSource: { ...(await kernelFor(claim)), position: 3 },
      history: { kernel: { ...(await kernelFor(claim)) }, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: `s2c-l-entered-${++seq}`, expected: [await pin(claim)] } });
    if (entered.status !== 'committed') throw new Error(`S2C-L entered failed: ${JSON.stringify(entered)}`);
    return { prepared, permit };
  }

  async function recordResult(claim: TaskClaim, event: RuntimeEventV1, continuation?: RunContinuationV1): Promise<RunSnapshot> {
    const current = await readExecution(claim);
    const auth = current.run.executionAuthorization;
    if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2) {
      throw new Error('S2C-L recordResult needs the V2 entry binding');
    }
    const kernel = await kernelFor(claim);
    const terminal: RuntimeEventV1 = { ...event, runRef: claim.runRef, sequence: current.run.lastEventSeq + 1,
      occurredAt: now() };
    const observation = {
      claim, entry: { consumerId: auth.consumerId, entryGeneration: auth.generation }, event: terminal,
      kernelSource: { ...kernel, position: 4 },
      completedHistoryBoundary: { source: { ...kernel, position: 4 }, cursor: `s2c-l-boundary-${claim.runRef.runId}` },
      history: { kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 },
      ...(continuation === undefined ? {} : { continuation }),
    };
    const result = await entry.recordRunResult(base.ctx, { input: observation,
      meta: { requestId: `s2c-l-result-${++seq}`, expected: [await pin(claim)] } });
    if (result.status !== 'committed') throw new Error(`S2C-L result failed: ${JSON.stringify(result)}`);
    return result.value;
  }

  function controlService(): RunControlPort & ControlObservationPort {
    return createRunControlService({ records, authority: createMaterialRecordReaders(records).authority,
      reads: createRunStateReader({ records }), now, eventId });
  }

  async function submitPause(claim: TaskClaim): Promise<ControlIntentRef> {
    const controls = controlService();
    const submitted = await controls.submitControl(base.ctx, { input: { runRef: claim.runRef, kind: 'pause', reason: 'S2C-L safe point' },
      meta: { requestId: `s2c-l-pause-${++seq}`, expected: [await pin(claim)] } });
    if (submitted.status !== 'committed') throw new Error(`S2C-L pause failed: ${JSON.stringify(submitted)}`);
    return submitted.value.intent.ref;
  }

  async function observePause(claim: TaskClaim, intentRef: ControlIntentRef): Promise<void> {
    const controls = controlService();
    const current = await readExecution(claim);
    const auth = current.run.executionAuthorization;
    const locator = current.run.executionHistory;
    if (auth === undefined || !('schemaVersion' in auth) || auth.schemaVersion !== 2 || locator === undefined) {
      throw new Error('S2C-L pause needs the entered history locator');
    }
    const observation: ControlObservationV1 = { schemaVersion: 1, kind: 'paused',
      entry: { consumerId: auth.consumerId, entryGeneration: auth.generation, sessionGeneration: auth.sessionGeneration },
      history: { ...locator, endPosition: null },
      source: { ...locator.kernel, position: locator.observedThroughPosition },
      kernelEventId: `s2c-l-paused-${claim.runRef.runId}`, kernelEventSequence: 3, observedAt: now() };
    const observed = await controls.recordControlObservation(base.ctx, {
      input: { intentRef, runRef: claim.runRef, observation },
      meta: { requestId: `s2c-l-observed-${++seq}`,
        expected: [{ ref: intentRef, revision: 1 }, await pin(claim)] } });
    if (observed.status !== 'committed') throw new Error(`S2C-L observation failed: ${JSON.stringify(observed)}`);
  }

  async function pauseAtSafePoint(claim: TaskClaim): Promise<ControlIntentRef> {
    const intentRef = await submitPause(claim);
    await observePause(claim, intentRef);
    return intentRef;
  }

  /** 2C-11: a pause/cancel pointer on an ended (yielded) Run; no observation is needed. */
  async function submitControl(claim: TaskClaim, kind: 'pause' | 'cancel'): Promise<ControlIntentRef> {
    const controls = controlService();
    const submitted = await controls.submitControl(base.ctx, { input: { runRef: claim.runRef, kind,
      reason: `S2C-L ${kind} while waiting` }, meta: { requestId: `s2c-l-control-${++seq}`, expected: [await pin(claim)] } });
    if (submitted.status !== 'committed') throw new Error(`S2C-L ${kind} failed: ${JSON.stringify(submitted)}`);
    return submitted.value.intent.ref;
  }

  /** 2C-17: the real submission result, accepted or refused, with no throw. */
  async function submitResult(claim: TaskClaim, kind: 'pause' | 'cancel' | 'resume'): Promise<WriteResult<SubmittedControl>> {
    return controlService().submitControl(base.ctx, { input: { runRef: claim.runRef, kind, reason: `S2C-L ${kind}` },
      meta: { requestId: `s2c-l-submit-${kind}-${++seq}`, expected: [await pin(claim)] } });
  }

  async function reconcileInterrupt(claim: TaskClaim): Promise<RunSnapshot> {
    const reconcile = createRunReconcileService({ records, reads: createRunStateReader({ records }), hostInstance, now, eventId });
    const result = await reconcile.reconcileRun(base.ctx, {
      input: { runRef: claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: hostInstance.hostInstanceId },
        probe: 'ready', result: { kind: 'interrupted_clean', turn: { terminal: false, inFlightToolCallIds: [],
          lastPosition: 3, kernelPaused: false, entered: null, acceptedSteers: [], inputsConfirmed: true } } },
      meta: { requestId: `s2c-l-interrupt-${++seq}`, expected: [await pin(claim)] } });
    if (result.status !== 'committed') throw new Error(`S2C-L interrupt failed: ${JSON.stringify(result)}`);
    return result.value;
  }

  async function retire(session: SessionRef, verdict: 'missing' | 'damaged'): Promise<void> {
    const health = createSessionHealthService({ records, hostInstance, now, eventId });
    const result = await health.recordSessionHealth(base.ctx, { sessionRef: session, probe: { verdict, activeRunId: null } });
    if (result.status !== 'observed' && result.status !== 'unchanged') {
      throw new Error(`S2C-L retire failed: ${JSON.stringify(result)}`);
    }
  }

  async function bareGoal(goalId: string): Promise<GoalRef> {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: base.scope.projectId, goalId };
    const created = await base.goals.createGoal(base.ctx, {
      meta: { requestId: `s2c-l-bare-goal-${goalId}`, expected: [
        { ref: base.projectRef, revision: 1 }, { ref: base.workspaceRef, revision: 1 }] },
      input: { goalId, workspace: base.scope, objective: `S2C-L bare goal ${goalId}` } });
    if (created.status !== 'committed') throw new Error(`S2C-L bare goal failed: ${JSON.stringify(created)}`);
    return goalRef;
  }

  async function claimQuery(session: SessionRef, goalRef: GoalRef, suffix: string): Promise<QueryRunRef> {
    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: base.scope.projectId,
      workspaceId: base.scope.workspaceId, queryJobId: `s2c-l-query-${suffix}` };
    const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: base.scope.projectId,
      workspaceId: base.scope.workspaceId, queryJobId: queryJobRef.queryJobId, runId: `s2c-l-query-run-${suffix}` };
    const goalRead = await base.plans.queryGoal(base.ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S2C-L query goal read failed');
    const sessionCard = await base.sessionsPort.readSession(base.ctx, session);
    if (sessionCard.status !== 'ready') throw new Error('S2C-L query session read failed');
    const sessionRole = sessionCard.value.record.role;
    const roleBinding = sessionRole.kind === 'legacy_template'
      ? { schemaVersion: 1 as const, bindingId: `s2c-l-role-${suffix}`, templateId: sessionRole.templateId,
        templateRevision: sessionRole.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template' }
      : base.roleBinding;
    const execution = createQueryExecution({ records: withBackendOrderedLookup(records, base.records), roles, bodies,
      authorizeConfiguration: async () => ({ status: 'rejected', code: 'forbidden', reason: 'S2C-L does not prepare a Query' }),
      now, eventId, sessionFacts: createSessionFactsService({ records }) });
    const jobs = createQueryJobService({ records, execution, now, eventId });
    const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };
    const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobRef.queryJobId,
      projectId: base.scope.projectId, workspaceId: base.scope.workspaceId, goalId: goalRef.goalId,
      question: `S2C-L query ${suffix}`, focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
      multiTurn: { maxRounds: 1 }, correlationId: `s2c-l-query-${suffix}`,
      execution: { kind: 'initial_coordination', roleBinding, runtimeBudget } };
    const projectPin: VersionPin = { ref: base.projectRef, revision: 1 };
    const workspacePin: VersionPin = { ref: base.workspaceRef, revision: 1 };
    const submitted = await jobs.submitQueryJob(base.ctx, { input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
      meta: { requestId: `s2c-l-query-submit-${suffix}`, expected: [projectPin, workspacePin,
        { ref: goalRef, revision: goalRead.value.goal.revision }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] } });
    if (submitted.status !== 'committed') throw new Error(`S2C-L query submit failed: ${JSON.stringify(submitted)}`);
    const claimed = await jobs.claimQuery(base.ctx, { input: { queryRunRef, sessionRef: session },
      meta: { requestId: `s2c-l-query-claim-${suffix}`, expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
        { ref: plainSessionRefToAggregate(session), revision: sessionCard.value.record.revision }] } });
    if (claimed.status !== 'committed') throw new Error(`S2C-L query claim failed: ${JSON.stringify(claimed)}`);
    return queryRunRef;
  }

  function mailboxService(): ReturnType<typeof createSessionMailbox> {
    const materials = createMaterialService({ bodies, authority: createMaterialRecordReaders(records).authority, now });
    return createSessionMailbox({ records, sessions: base.sessionsPort, executions: createRunStateReader({ records }),
      defaultInquiryDeadlineMs: 86_400_000,
      roles: createRoleConfigurationService({ records, now, eventId }), materials,
      systemActor: { kind: 'system', id: 's2c-l-query' }, now, newId: eventId });
  }

  async function beginConsultationCopy(asked: SessionRef, requestId: string): Promise<{ copy: SessionRef; queryRunRef: QueryRunRef }> {
    const materials = createMaterialService({ bodies, authority: createMaterialRecordReaders(records).authority, now });
    const mailbox = createSessionMailbox({ records, sessions: base.sessionsPort, executions: createRunStateReader({ records }),
      defaultInquiryDeadlineMs: 86_400_000,
      roles: createRoleConfigurationService({ records, now, eventId }), materials,
      systemActor: { kind: 'system', id: 's2c-l-query' }, now, newId: eventId });
    const sent = await mailbox.sendMessage(base.ctx, { input: { recipient: asked,
      text: `S2C-L consultation ${requestId}`, intent: 'inquiry', needsReply: true },
      meta: { requestId: `s2c-l-send-${requestId}`, expected: [] } });
    if (sent.status !== 'committed') throw new Error(`S2C-L consultation send failed: ${JSON.stringify(sent)}`);
    const messageRef = sent.value.ref;
    const admitted = await base.sessionsPort.admitSessionCreation(base.ctx, {
      meta: { requestId: `s2c-l-copy-admit-${requestId}`, expected: [] },
      input: { workspace: base.scope, kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
        role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
        recommendedRefs: [], initialLinks: [],
        provenance: { schemaVersion: 1, kind: 'readonly_copy', from: asked, messageRef } } });
    if (admitted.status !== 'committed') throw new Error(`S2C-L copy admission failed: ${JSON.stringify(admitted)}`);
    const registered = await base.sessionsPort.recordSessionCreated(base.ctx, {
      meta: { requestId: `s2c-l-copy-register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 'r4c-claim-kernel', kernelSessionId: `s2c-l-copy-kernel-${requestId}`,
        historyCursor: null, observedAt: now() } });
    if (registered.status !== 'committed') throw new Error(`S2C-L copy registration failed: ${JSON.stringify(registered)}`);
    const copy: SessionRef = { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
    const sourceCard = await base.sessionsPort.readSession(base.ctx, asked);
    if (sourceCard.status !== 'ready') throw new Error('S2C-L consultation source read failed');
    const derivation = { childSessionRef: copy, sourceSessionRef: asked,
      sourceKernel: { adapterId: sourceCard.value.record.kernel.adapterId,
        kernelSessionId: sourceCard.value.record.kernel.kernelSessionId }, throughPosition: 1 };

    const { queryJobRef, queryRunRef } = consultationQueryRefs(messageRef);
    const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };
    const execution = createQueryExecution({ records: withBackendOrderedLookup(records, base.records), roles, bodies, now, eventId,
      sessionFacts: createSessionFactsService({ records }),
      authorizeConfiguration: async () => ({ status: 'rejected', code: 'forbidden', reason: 'S2C-L does not prepare a Query' }) });
    const jobs = createQueryJobService({ records, now, eventId,
      execution: { claimQuery: execution.claimQuery, readQueryAnswer: execution.readQueryAnswer },
      consultations: { readMessage: mailbox.readMessage, readMessageBody: mailbox.readMessageBody } });
    const goalRef = base.goalRef;
    const goalRead = await base.plans.queryGoal(base.ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S2C-L consultation goal read failed');
    const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobRef.queryJobId,
      projectId: base.scope.projectId, workspaceId: base.scope.workspaceId, goalId: goalRef.goalId,
      question: `S2C-L consultation ${requestId}`, focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
      multiTurn: { maxRounds: 1 }, correlationId: queryJobRef.queryJobId,
      execution: { kind: 'semantic_query', roleBinding: base.roleBinding, runtimeBudget,
        consultation: { messageRef, recipient: asked, derivation } } };
    const submitted = await jobs.submitQueryJob(base.ctx, { input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
      meta: { requestId: `s2c-l-consult-submit-${requestId}`, expected: [
        { ref: base.projectRef, revision: 1 }, { ref: base.workspaceRef, revision: 1 },
        { ref: goalRef, revision: goalRead.value.goal.revision }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] } });
    if (submitted.status !== 'committed') throw new Error(`S2C-L consultation submit failed: ${JSON.stringify(submitted)}`);
    const claimed = await jobs.claimQuery(base.ctx, { input: { queryRunRef, sessionRef: copy },
      meta: { requestId: `s2c-l-consult-claim-${requestId}`, expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
        { ref: plainSessionRefToAggregate(copy), revision: registered.value.revision }] } });
    if (claimed.status !== 'committed') throw new Error(`S2C-L consultation claim failed: ${JSON.stringify(claimed)}`);
    return { copy, queryRunRef };
  }

  async function completeConsultation(queryRunRef: QueryRunRef, session: SessionRef,
    mode: 'answered' | 'unknown' | 'entered', suffix: string, at?: string, options: { now?: () => string } = {}): Promise<void> {
    const clock = options.now ?? now;
    const runtimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };
    const permissions = { tools: ['read'], writeScope: [] as [] };
    const execution = createQueryExecution({ records: withBackendOrderedLookup(records, base.records), roles, bodies, now: clock, eventId,
      sessionFacts: createSessionFactsService({ records }),
      authorizeConfiguration: async () => ({ status: 'ready', value: {
        configurationRevision: 's2c-l-query-host@1', permissions, hostTemplate: L_HOST.hostTemplate, budget: runtimeBudget } }) });
    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: queryRunRef.projectId,
      workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId };
    const queryPin = async (): Promise<VersionPin> => {
      const read = await execution.readQueryExecution(base.ctx, queryRunRef);
      if (read.status !== 'ready') throw new Error('S2C-L query read failed');
      return { ref: queryRunRef, revision: read.value.run.revision };
    };
    const facts = await execution.readPreparationFacts(base.ctx, queryRunRef);
    if (facts.status !== 'ready') throw new Error(`S2C-L query preparation facts failed: ${JSON.stringify(facts)}`);
    const prepared = (await prepareQueryForReal(base, {
      bodies, queryRunRef, queryExecution: execution, now, requestId: `s2c-l-qprepare-${suffix}-${++seq}`,
      host: preparationHost({ configurationRevision: 's2c-l-query-host@1', permissions,
        hostTemplate: L_HOST.hostTemplate, budget: runtimeBudget }),
    })).prepared;
    const preparedState = await execution.readQueryExecution(base.ctx, queryRunRef);
    if (preparedState.status !== 'ready') throw new Error('S2C-L query read failed');
    const kernel = { adapterId: preparedState.value.session.kernel.adapterId,
      kernelSessionId: preparedState.value.session.kernel.kernelSessionId,
      runId: `s2c-l-qkernel-${suffix}`, turnId: `s2c-l-qturn-${suffix}` };
    const ticket = await execution.beginQueryEntry(base.ctx, { input: { prepared, consumerId: `s2c-l-qconsumer-${suffix}`, kernel },
      meta: { requestId: `s2c-l-qbegin-${suffix}-${++seq}`, expected: [
        { ref: queryJobRef, revision: preparedState.value.job.revision },
        { ref: queryRunRef, revision: preparedState.value.run.revision },
        { ref: preparedState.value.session.ref, revision: preparedState.value.session.revision }] } });
    if (ticket.status !== 'committed') throw new Error(`S2C-L query begin failed: ${JSON.stringify(ticket)}`);
    const entry: QueryEntryIdentity = { queryRunRef, sessionRef: ticket.value.sessionRef,
      sessionGeneration: ticket.value.sessionGeneration, entryGeneration: 1, consumerId: ticket.value.consumerId, kernel: ticket.value.kernel };
    const history = { schemaVersion: 1 as const, sessionRef: ticket.value.sessionRef, kernel: ticket.value.kernel,
      startPosition: 1, observedThroughPosition: 2, endPosition: null };
    if (mode === 'unknown') {
      const observed = await execution.recordQueryObservation(base.ctx, { input: { entry, history,
        source: { position: 2, cursor: `s2c-l-qcursor-${suffix}` }, observation: { kind: 'unknown', reason: 'S2C-L unknown outcome' } },
        meta: { requestId: `s2c-l-qunknown-${suffix}-${++seq}`, expected: [await queryPin()] } });
      if (observed.status !== 'committed') throw new Error(`S2C-L query unknown failed: ${JSON.stringify(observed)}`);
      return;
    }
    const entered = await execution.recordQueryObservation(base.ctx, { input: { entry, history,
      source: { position: 2, cursor: `s2c-l-qentered-${suffix}` }, observation: { kind: 'entered', occurredAt: at ?? now() } },
      meta: { requestId: `s2c-l-qentered-${suffix}-${++seq}`, expected: [await queryPin()] } });
    if (entered.status !== 'committed') throw new Error(`S2C-L query entered failed: ${JSON.stringify(entered)}`);
    // 2C-17: stop at the real `entered` phase (a working Query).
    if (mode === 'entered') return;
    const sourceRefs = [{ kind: 'workspace' as const, refId: base.scope.workspaceId,
      revision: String(facts.value.workspace.revision) }];
    const answerText = `S2C-L answer ${suffix}`;
    const answerBody = await bodies.put({ body: answerText, contentType: 'text/plain; charset=utf-8', sourceRefs,
      origin: { kind: 'run', owner: queryRunRef }, requestedAt: now() });
    if (answerBody.status !== 'ready') throw new Error(`S2C-L answer body store failed: ${JSON.stringify(answerBody)}`);
    const answer: QueryJobAnswerV1 = { schemaVersion: 1, answerId: `s2c-l-answer-${suffix}`, queryJobRef,
      runRef: queryRunRef, roundIndex: 0, answer: answerText, sources: [], followsAnswerRef: null,
      stale: false, staleReason: null, answeredAt: now(), bodyRef: answerBody.value.ref, ideas: [], goalCardDrafts: [], planDraftIndex: null };
    const terminal = await execution.recordQueryObservation(base.ctx, { input: { entry,
      history: { ...history, observedThroughPosition: 3, endPosition: 3 },
      source: { position: 3, cursor: `s2c-l-qend-${suffix}` },
      observation: { kind: 'terminal', occurredAt: now(), outcome: 'answered', answer, reason: null, answerCheck: null,
        activity: {
          status: 'counted', ruleVersion: 1,
          window: { kernelRunId: 'inert-run', kernelTurnId: 'inert-turn', fromPosition: 1, throughPosition: 1,
            bound: 'end_position', turnTerminal: true, unresolvedCalls: 0,
            turnStartedAt: '2026-10-23T09:00:00.000Z', lastRecordAt: '2026-10-23T09:00:00.000Z' },
          quarters: [], overflow: null, totals: { steps: 0, edits: 0, editsUnknown: 0 },
          changedFiles: { definite: [], possible: [], definiteOmitted: 0, possibleOmitted: 0,
            possiblyIncomplete: false, incompleteBecause: [] },
          usage: { requests: [], omitted: 0, totals: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, complete: true },
        },
      } },
      meta: { requestId: `s2c-l-qterminal-${suffix}-${++seq}`, expected: [await queryPin()] } });
    if (terminal.status !== 'committed') throw new Error(`S2C-L query terminal failed: ${JSON.stringify(terminal)}`);
  }

  return { bodies, entry, buildPrepared, enter, recordResult, readExecution, pin,
    pauseAtSafePoint, submitPause, observePause, submitControl, submitResult, controlsFor: () => controlService(),
    reconcileInterrupt, retire, bareGoal, claimQuery, beginConsultationCopy, completeConsultation,
    mailbox: mailboxService };
}

/** A continuation binding for a yielded Run; the message need not exist for the in-process terminal. */
export function waitContinuation(claim: TaskClaim, messageRef: SessionMessageRef): RunContinuationV1 {
  return { schemaVersion: 1, kind: 'wait_reply', task: claim.task, sessionRef: claim.sessionRef, messageRef };
}

/** The real `run_yielded` terminal event of a `reply_required` wait. */
export function yieldedEvent(claim: TaskClaim, runIdSeed = '1'): RuntimeEventV1 {
  return { eventType: 'run_yielded', schemaVersion: 1, eventId: `s2c-l-yielded-${runIdSeed}`, runRef: claim.runRef,
    sequence: 0, occurredAt: '2026-09-24T00:00:00.000Z',
    payload: { kind: 'yielded', yield: { reason: 'reply_required', requestedBy: 'runtime',
      yieldedAt: '2026-09-24T00:00:00.000Z', pendingToolCallId: null } } };
}

/** The real `run_completed` terminal event. */
export function completedEvent(claim: TaskClaim, runIdSeed = '1'): RuntimeEventV1 {
  return { eventType: 'run_completed', schemaVersion: 1, eventId: `s2c-l-completed-${runIdSeed}`, runRef: claim.runRef,
    sequence: 0, occurredAt: '2026-09-24T00:00:00.000Z', payload: { kind: 'completed', exitCode: 0 } };
}

/** The real `run_crashed` terminal event (2C-12: a failed Run). */
export function crashedEvent(claim: TaskClaim, runIdSeed = '1'): RuntimeEventV1 {
  return { eventType: 'run_crashed', schemaVersion: 1, eventId: `s2c-l-crashed-${runIdSeed}`, runRef: claim.runRef,
    sequence: 0, occurredAt: '2026-09-24T00:00:00.000Z',
    payload: { kind: 'crashed', error: 'S2C-L crashed task' } };
}

export function runKey(ref: RunRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
