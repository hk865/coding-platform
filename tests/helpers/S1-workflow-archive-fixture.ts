/** FX3-only owners, injected clocks and commit-by-commit invariant observations.
 * The claim/entry builders follow the existing task-claim and B2 fixtures;
 * domain setup is performed through the production writers on both backends.
 */

import { join } from 'node:path';
import { type CoreCallContext } from '../../src/contracts/core/call-context.js';
import { type RoleConfigurationRef, type SessionRef, type VersionPin, type WorkspaceScope } from '../../src/contracts/core/identity.js';
import { type TaskLeaseSnapshot } from '../../src/contracts/dispatch.js';

import { type EncodedRecord, type RecordBackendSchemas, type EncodedDomainEvent } from '../../src/core/record-store/ports.js';
import {
  createTaskClaimFixture as createSharedTaskClaimFixture, type ClaimFixtureKind,
  type Records, type TaskClaimFixture as SharedTaskClaimFixture,
} from './task-claim-fixture.js';
import {
  B2_HOST, createB2ExecutionFixture as createSharedB2ExecutionFixture,
  type B2ExecutionFixture as SharedB2ExecutionFixture,
} from './B2-execution-fixture.js';
export { B2_HOST };
export type { ClaimFixtureKind };

import { decodeGoalCreatedEvent, decodeGoalDesiredStateChangedEvent, decodeGoalSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { decodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { readCanonicalTaskFacts, readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { decodeSessionRecord } from '../../src/core/work-graph/sessions/session-record-codecs.js';

import { decodeDispatchOutboxEntry, decodeTaskAttemptSnapshot, decodeTaskRequeueSnapshot, decodeTaskReworkRefusalSnapshot, taskClaimedEventFromEvent, taskRequeuedEventFromEvent, taskReworkRefusedEventFromEvent } from '../../src/core/work-graph/tasks/claim-record-codecs.js';

import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';

import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';

import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { expect } from 'vitest';

import { type TaskClaim } from '../../src/contracts/core/task-claim.js';

import type { TurnClosureDependencies } from '../../src/core/agent-runtime/execution-contracts.js';

import { executionEntryAuthorizedEventFromEvent } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';

import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { type TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import { type SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { decodeSessionMessageRecord } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { decodeEvidenceSnapshot, decodeTaskEvidenceIndexSnapshot, decodeVerificationRoundSnapshot, verificationRoundEventFromEvent } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { controlIntentSubmittedEventFromEvent, decodeControlIntentSnapshot } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { decodeQueryRunSnapshotRecord } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { decodeSessionAnomalyAnchor } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { decodeGoalPhaseSnapshot } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { decodeRun } from '../../src/core/work-graph/materials/run-snapshot-decoder.js';
import { preparationHost, prepareQueryForReal } from './task-claim-fixture.js';
import { checkAllInvariants, emptyInvariantWorld, refKey, type InvariantWorld, type InvariantTaskState, type InvariantEvent } from '../state/invariants.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { consultationQueryRefs, type QueryJobAnswerRef, type QueryJobAnswerV1, type QueryJobIntentV1 } from '../../src/contracts/query-job.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';

import type { QueryEntryIdentity } from '../../src/core/work-graph/queries/contracts.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import * as kernelApi from '../../vendor/coding-agent/dist/public-api.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createRuntimeHostDouble, createScriptedModel } from './B2-runtime-fixture.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';

import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY, type WorkflowDependencies, type WorkflowPort } from '../../src/business/workflow/ports.js';
const AT = '2026-10-08T00:00:00.000Z';
/** Observe the real backend, including bootstrap and writes made by all owners. */
type FixtureAudit = {
  check(label: string): Promise<void>;
  world(): Promise<InvariantWorld>;
  totals(): { records: number; events: number; receipts: number };
  events(): readonly { cursor: import('../../src/contracts/command-event.js').CommitCursor; event: EncodedDomainEvent }[];
};

function sameRef(left: object | null | undefined, right: object | null | undefined): boolean {
  return left == null || right == null ? left === right : refKey(left) === refKey(right);
}

function observeFixtureStore(records: Records, projectId: string): FixtureAudit {
  const keys = new Set<string>();
  const identities = new Set<string>();
  const events: Array<{ cursor: import('../../src/contracts/command-event.js').CommitCursor; event: EncodedDomainEvent }> = [];
  let previous: InvariantWorld | undefined;
  const worldTypes = new Set(['Run', 'TaskAttempt', 'DispatchOutboxEntry', 'TaskLease', 'Session', 'QueryRun',
    'ControlIntent', 'VerificationRound', 'Evidence', 'TaskEvidenceIndex', 'SessionMessage', 'Goal', 'GoalPhase',
    'TaskReduction', 'TaskRequeue', 'TaskReworkRefusal', 'PlanRevision', 'SessionAnomalyAnchor']);
  async function world(): Promise<InvariantWorld> {
    const read = await records.readMany([...keys].filter(key => {
      const ref = JSON.parse(key) as { aggregateType: string; projectId: string };
      return ref.projectId === projectId && worldTypes.has(ref.aggregateType);
    }));
    if (read.status !== 'ready') throw new Error(`FX3 invariant read: ${JSON.stringify(read)}`);
    expect(read.value.missing).toEqual([]);
    const result = decodeWorldRecords(projectId, read.value.records);
    result.events = events.flatMap(({ cursor, event }) => {
      const decodedEvent = worldEvent(seqOfCommitCursor(cursor), event, projectId);
      return decodedEvent === null ? [] : [decodedEvent];
    });
    result.taskStates = await readTaskStates(records, result);
    return result;
  }
  async function check(label: string): Promise<void> {
    const current = await world();
    expect(checkAllInvariants(current, previous), label).toEqual([]);
    previous = structuredClone(current);
  }
  const commit = records.commit.bind(records);
  records.commit = async batch => {
    const receipt = await commit(batch);
    if (receipt.status === 'committed' && !receipt.replayed) {
      for (const record of batch.records) keys.add(record.refKey);
      identities.add(receipt.identityKey);
      const end = seqOfCommitCursor(receipt.cursor);
      for (let seq = end - receipt.eventIds.length + 1; seq <= end; seq++) {
        const read = await records.eventAt(makeCommitCursor(seq));
        if (read.status !== 'ready') throw new Error(`FX3 event read: ${JSON.stringify(read)}`);
        events.push(read.value);
      }
      await check(batch.events.map(event => event.eventType).join(', '));
    }
    return receipt;
  };
  return { check, world, totals: () => ({ records: keys.size, events: events.length, receipts: identities.size }),
    events: () => structuredClone(events) };
}
export type TaskClaimFixture = SharedTaskClaimFixture & { audit: FixtureAudit };

export type B2Records = TaskClaimFixture['records'];

export type B2ExecutionFixture = SharedB2ExecutionFixture<TaskClaimFixture>;

/** The S1 claim fixture: the shared public bootstrap plus its commit-by-commit store audit. */
async function createAuditedClaimFixture(
  kind: ClaimFixtureKind,
  additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
  clock: () => string = () => AT,
): Promise<TaskClaimFixture> {
  const base = await createSharedTaskClaimFixture<FixtureAudit>(kind, additionalSchemas, {
    clock,
    audit: records => observeFixtureStore(records, 'r4c-claim-project'),
    bootstrapModule: { moduleId: 'fx3-work', name: 'FX3 work', responsibility: 'Fixture workspace',
      description: 'FX3 fixture' },
  });
  const audit = base.audit;
  if (audit === undefined) throw new Error('the S1 claim fixture requires its store audit');
  return { ...base, audit };
}

/** The S1 execution fixture: the shared fixture over the audited claim fixture, with the S1 clock and
 * a distinct Kernel run/turn identity for every claim after the first. */
export async function createB2ExecutionFixture(
  kind: ClaimFixtureKind = 'memory',
  additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
  clock: () => string = () => AT,
): Promise<B2ExecutionFixture> {
  return await createSharedB2ExecutionFixture<TaskClaimFixture>(kind, additionalSchemas, {
    clock,
    baseFactory: (fixtureKind, schemas) => createAuditedClaimFixture(fixtureKind, schemas, clock),
    perClaimKernelIdentity: true,
  });
}

function decoded<T>(result: { status: 'decoded'; value: T } | { status: 'invalid'; reason: string }, refKey: string): T {
  if (result.status !== 'decoded') throw new Error(`readInvariantWorld: ${refKey} does not decode: ${result.reason}`);
  return result.value;
}

function decodeWorldRecords(projectId: string, records: readonly EncodedRecord[]): InvariantWorld {
  const world = emptyInvariantWorld(projectId);
  for (const record of records) {
    const aggregateType = (JSON.parse(record.refKey) as { aggregateType: string }).aggregateType;
    switch (aggregateType) {
      case 'Run': {
        const run = decodeRun(record);
        if (!run.ok) throw new Error(`readInvariantWorld: ${record.refKey} does not decode: ${run.reason}`);
        world.runs.push(run.value);
        break;
      }
      case 'TaskAttempt': world.attempts.push(decoded(decodeTaskAttemptSnapshot(record), record.refKey)); break;
      case 'DispatchOutboxEntry': world.outboxes.push(decoded(decodeDispatchOutboxEntry(record), record.refKey)); break;
      // TaskLease and TaskReduction have no decoder of their own: `readMany` already ran the registered
      // `PLAN_STATE_RECORD_SCHEMAS` validators, as every production reader of these records relies on.
      case 'TaskLease': world.leases.push(JSON.parse(record.json) as TaskLeaseSnapshot); break;
      case 'TaskReduction': world.reductions.push(JSON.parse(record.json) as TaskReductionSnapshot); break;
      case 'Session': world.sessions.push(decoded(decodeSessionRecord(record), record.refKey)); break;
      case 'QueryRun': world.queryRuns.push(decoded(decodeQueryRunSnapshotRecord(record), record.refKey)); break;
      case 'ControlIntent': world.intents.push(decoded(decodeControlIntentSnapshot(record), record.refKey)); break;
      case 'VerificationRound': world.rounds.push(decoded(decodeVerificationRoundSnapshot(record), record.refKey)); break;
      case 'Evidence': world.evidence.push(decoded(decodeEvidenceSnapshot(record), record.refKey)); break;
      case 'TaskEvidenceIndex': world.evidenceIndexes.push(decoded(decodeTaskEvidenceIndexSnapshot(record), record.refKey)); break;
      case 'SessionMessage': world.messages.push(decoded(decodeSessionMessageRecord(record), record.refKey)); break;
      case 'Goal': world.goals.push(decoded(decodeGoalSnapshot(record), record.refKey)); break;
      case 'GoalPhase': world.goalPhases.push(decoded(decodeGoalPhaseSnapshot(record), record.refKey)); break;
      case 'TaskRequeue': world.requeues.push(decoded(decodeTaskRequeueSnapshot(record), record.refKey)); break;
      case 'TaskReworkRefusal': world.refusals.push(decoded(decodeTaskReworkRefusalSnapshot(record), record.refKey)); break;
      case 'PlanRevision': world.plans.push(decoded(decodePlanRevisionSnapshot(record), record.refKey)); break;
      case 'SessionAnomalyAnchor': {
        const anchors = world.anchors ?? (world.anchors = []);
        anchors.push(decoded(decodeSessionAnomalyAnchor(record), record.refKey));
        break;
      }
      default: throw new Error(`readInvariantWorld: unexpected aggregate type ${aggregateType}`);
    }
  }
  return world;
}

/** One §11.11 event in its world form, or null when it belongs to another project. */
function worldEvent(seq: number, event: EncodedDomainEvent, projectId: string): InvariantEvent | null {
  const base = { seq, goalStateTo: null, revision: null, controlKind: null, taskId: null };
  const where = `event ${event.eventId} (${event.eventType})`;
  switch (event.eventType) {
    case 'GoalCreated': {
      const value = decoded(decodeGoalCreatedEvent(event), where);
      return value.projectId !== projectId ? null : { ...base, eventType: 'GoalCreated', goalId: value.aggregateId,
        goalStateTo: 'active', subject: refKey({ aggregateType: 'Goal', projectId, goalId: value.aggregateId }) };
    }
    case 'GoalDesiredStateChanged': {
      const value = decoded(decodeGoalDesiredStateChangedEvent(event), where);
      return value.goal.ref.projectId !== projectId ? null : { ...base, eventType: 'GoalDesiredStateChanged',
        goalId: value.goal.ref.goalId, goalStateTo: value.to, subject: refKey(value.goal.ref) };
    }
    case 'TaskClaimed': {
      const claim = decoded(taskClaimedEventFromEvent(event), where).claim;
      return claim.task.projectId !== projectId ? null
        : { ...base, eventType: 'TaskClaimed', goalId: claim.task.goalId, subject: refKey(claim.runRef), taskId: claim.task.taskId };
    }
    case 'ExecutionEntryAuthorized': {
      const claim = decoded(executionEntryAuthorizedEventFromEvent(event), where).permit.claim;
      return claim.task.projectId !== projectId ? null : { ...base, eventType: 'ExecutionEntryAuthorized',
        goalId: claim.task.goalId, subject: refKey(claim.runRef), taskId: claim.task.taskId };
    }
    case 'VerificationRoundOpened':
    case 'VerificationCheckBegun':
    case 'VerificationRoundReverified': {
      const value = decoded(verificationRoundEventFromEvent(event), where);
      return value.roundRef.projectId !== projectId ? null
        : { ...base, eventType: event.eventType, goalId: value.roundRef.goalId, subject: refKey(value.roundRef),
          taskId: value.roundRef.taskId };
    }
    case 'TaskRequeued': {
      const requeue = decoded(taskRequeuedEventFromEvent(event), where).requeue;
      return requeue.ref.projectId !== projectId ? null : { ...base, eventType: 'TaskRequeued', goalId: requeue.ref.goalId,
        subject: refKey(requeue.ref), taskId: requeue.ref.taskId };
    }
    case 'TaskReworkRefused': {
      const refusal = decoded(taskReworkRefusedEventFromEvent(event), where).refusal;
      return refusal.ref.projectId !== projectId ? null : { ...base, eventType: 'TaskReworkRefused', goalId: refusal.ref.goalId,
        subject: refKey(refusal.ref), revision: refusal.revision, taskId: refusal.ref.taskId };
    }
    case 'ControlIntentSubmitted': {
      const intent = decoded(controlIntentSubmittedEventFromEvent(event), where).submitted.intent;
      return intent.ref.projectId !== projectId ? null : { ...base, eventType: 'ControlIntentSubmitted',
        goalId: intent.runRef.goalId, subject: refKey(intent.ref), controlKind: intent.kind };
    }
    default: return null;
  }
}

/** `phase(t)`, `cause(t)`, `selected(t)` of every Task of each Goal's active Plan, from the canonical reader. */
async function readTaskStates(
  records: Parameters<typeof readCanonicalTaskFacts>[0], world: InvariantWorld,
): Promise<InvariantTaskState[]> {
  const states: InvariantTaskState[] = [];
  for (const goal of world.goals) {
    const active = goal.activePlanRevision;
    if (active === null) continue;
    const plan = world.plans.find((candidate) => sameRef(candidate.ref, active));
    if (plan === undefined) throw new Error(`readInvariantWorld: the active Plan of Goal ${goal.ref.goalId} is not in the window`);
    const read = await readCanonicalTaskFacts(records, goal.ref, plan);
    for (const task of plan.tasks) {
      const base = { goalId: goal.ref.goalId, taskId: task.taskId, taskKind: task.taskKind };
      const state = read.status === 'ready' ? read.value.byTaskId.get(task.taskId) : undefined;
      if (state === undefined) {
        states.push({ ...base, phase: null, cause: null, selectedRunRef: null, coveringRequeueRef: null,
          problem: read.status === 'ready' ? `task ${task.taskId} has no canonical state` : `${read.code}: ${read.reason}` });
        continue;
      }
      states.push({ ...base, phase: state.effectivePhase, cause: state.phaseCause, selectedRunRef: state.execution,
        coveringRequeueRef: state.requeueRef, problem: null });
    }
  }
  return states;
}

/** No terminal was recovered from the old Host: RUN-20 also ends Attempt/Outbox. */
export async function unknownWork(f: B2ExecutionFixture, now: () => string): Promise<void> {
  let eventSeq = 0;
  const reconcile = createRunReconcileService({ records: f.base.records,
    reads: createRunStateReader({ records: f.base.records }),
    hostInstance: { hostInstanceId: 'fx3-host', lease: 'owned' }, now, eventId: () => `fx3-unknown-${++eventSeq}` });
  const result = await reconcile.reconcileRun(f.ctx, {
    input: { runRef: f.claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'fx3-host' },
      probe: 'missing', result: { kind: 'unknown', cause: 'kernel_unreadable',
        unresolvedToolCallIds: [], observedThroughPosition: null, turn: null } },
    meta: { requestId: 'fx3-unknown', expected: [await f.pin()] },
  });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'outcome_unknown' } });
  const read = await f.read();
  expect(read.attempt.endOutcome).toBe('outcome_unknown');
  expect(read.session.occupancy).toEqual({ kind: 'execution', executionRef: f.claim.runRef,
    generation: f.claim.generation });
}

/** The existing clean-crash path stops the writer and retires its open Kernel Turn. */
export async function interruptWork(f: B2ExecutionFixture, now: () => string): Promise<void> {
  let eventSeq = 0;
  const reconcile = createRunReconcileService({ records: f.base.records,
    reads: createRunStateReader({ records: f.base.records }),
    hostInstance: { hostInstanceId: 'fx3-host', lease: 'owned' }, now, eventId: () => `fx3-interrupted-${++eventSeq}` });
  const result = await reconcile.reconcileRun(f.ctx, {
    input: { runRef: f.claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'fx3-host' },
      probe: 'ready', result: { kind: 'interrupted_clean', turn: { terminal: false, inFlightToolCallIds: [],
        lastPosition: 3, kernelPaused: false, entered: null, acceptedSteers: [], inputsConfirmed: true } } },
    meta: { requestId: 'fx3-interrupted', expected: [await f.pin()] },
  });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', value: { status: 'ended' } });
  const read = await f.read();
  expect(read.session.occupancy).toBeNull();
  expect(read.session.health).toBe('unavailable');
  expect(read.session.healthConclusion).toBe('kernel_turn_open');
}

export async function retireSession(base: TaskClaimFixture, sessionRef: SessionRef, now: () => string): Promise<void> {
  const health = createSessionHealthService({ records: base.records,
    hostInstance: { hostInstanceId: 'fx3-host', lease: 'owned' }, now,
    eventId: () => `fx3-missing-${sessionRef.sessionId}` });
  const result = await health.recordSessionHealth(base.ctx, { sessionRef, probe: { verdict: 'missing', activeRunId: null } });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'observed', session: { health: 'unavailable' } });
}

/** Complete the actual entered claim through WG's result owner (not a phase patch). */
export async function completeWork(f: B2ExecutionFixture, claim: TaskClaim = f.claim): Promise<void> {
  const admitted = await f.enter({ prepared: await f.buildPrepared({ claim }) });
  const observation = f.terminalObservation(admitted);
  const kernel = await f.kernelFor(claim);
  observation.event = { ...observation.event, eventId: `fx3-completed-${claim.runRef.runId}`, runRef: claim.runRef };
  observation.kernelSource = { ...kernel, position: 4 };
  observation.completedHistoryBoundary = { source: observation.kernelSource, cursor: `fx3-completed-${claim.runRef.runId}` };
  observation.history = { ...observation.history, kernel };
  const result = await f.entry.recordRunResult(f.ctx, { input: observation,
    meta: { requestId: `fx3-completed-${claim.runRef.runId}`, expected: [await f.pin(claim)] } });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'completed' } });
  expect((await f.read(claim)).session.occupancy).toBeNull();
}
export async function beginConsultation(b2: B2ExecutionFixture, requestId: string, from: SessionRef,
  now: () => string, isolatedCopy = true) {
    const base = b2.base;
    const records = base.records;
    const goalRef = base.goalRef;
    let seq = 0;
    const eventId = () => `fx3-query-${requestId}-${++seq}`;
    const materialReads = createMaterialRecordReaders(records);
    const mailbox = createSessionMailbox({ records, sessions: base.sessionsPort,
      executions: createRunStateReader({ records }), roles: createRoleConfigurationService({ records, now, eventId }),
      materials: createMaterialService({ bodies: b2.bodies, authority: materialReads.authority, now }),
      systemActor: { kind: 'system', id: 'fx3-query' }, now, newId: eventId });
    const pinOf = async (ref: VersionPin['ref']): Promise<VersionPin> => {
      const read = await records.readMany([refKey(ref)]);
      if (read.status !== 'ready') throw new Error(JSON.stringify(read));
      return { ref, revision: read.value.records[0]?.revision ?? 0 };
    };
    const sessionPin = (ref: SessionRef) => base.sessionPin(ref);
    const KERNEL_ADAPTER = 'r4c-claim-kernel';
    const KERNEL_STORE = 'r4c-claim-kernel-store';
    const DEFAULT_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
    const question = `consultation ${requestId}`;
    const sent = await mailbox.sendMessage(base.ctx, {
      meta: { requestId: `s1-maintenance-send-${requestId}`, expected: [] },
      input: { recipient: from, text: question, intent: 'inquiry', needsReply: true },
    });
    if (sent.status !== 'committed') throw new Error(`maintenance inquiry send failed: ${JSON.stringify(sent)}`);
    const messageRef = sent.value.ref;

    let copy = from;
    let derivation: NonNullable<SessionMessage['consultationDerivation']> | undefined;
    if (isolatedCopy) {
    const admitted = await base.sessionsPort.admitSessionCreation(base.ctx, {
      meta: { requestId: `s1-maintenance-copy-admit-${requestId}`, expected: [] },
      input: { workspace: base.scope, kernelStore: { adapterId: KERNEL_ADAPTER, storeKey: KERNEL_STORE },
        role: DEFAULT_ROLE, recommendedRefs: [], initialLinks: [],
        provenance: { schemaVersion: 1, kind: 'readonly_copy', from, messageRef } },
    });
    if (admitted.status !== 'committed') throw new Error(`maintenance copy admission failed: ${JSON.stringify(admitted)}`);
    const registered = await base.sessionsPort.recordSessionCreated(base.ctx, {
      meta: { requestId: `s1-maintenance-copy-register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: KERNEL_ADAPTER, kernelSessionId: `s1-maintenance-copy-kernel-${requestId}`,
        historyCursor: null, observedAt: now() },
    });
    if (registered.status !== 'committed') throw new Error(`maintenance copy registration failed: ${JSON.stringify(registered)}`);
    copy = { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };

    const sourceCard = await base.sessionsPort.readSession(base.ctx, from);
    if (sourceCard.status !== 'ready') throw new Error(`maintenance copy source read failed: ${JSON.stringify(sourceCard)}`);
    const foundMessage = await mailbox.readMessage(base.ctx, messageRef);
    if (foundMessage.status !== 'ready') throw new Error(`maintenance copy message read failed: ${JSON.stringify(foundMessage)}`);
    derivation = {
      childSessionRef: copy, sourceSessionRef: from,
      sourceKernel: { adapterId: sourceCard.value.record.kernel.adapterId,
        kernelSessionId: sourceCard.value.record.kernel.kernelSessionId },
      throughPosition: 1,
    };
    const derived = await mailbox.recordConsultationDerivation!(base.ctx, {
      meta: { requestId: `s1-maintenance-derivation-${requestId}`,
        expected: [{ ref: messageRef, revision: foundMessage.value.revision }] },
      input: { messageRef, derivation },
    });
    if (derived.status !== 'committed') throw new Error(`maintenance copy derivation failed: ${JSON.stringify(derived)}`);

    }
    const { queryJobRef, queryRunRef } = consultationQueryRefs(messageRef);
    const queryBudget = { maxTokens: null, deadline: null };
    const queryRuntimeBudget = structuredClone(DEFAULT_RUNTIME_BUDGET);
    const queryHostRevision = 's1-maintenance-query-host@1';
    const queryPermissions: { tools: string[]; writeScope: [] } = { tools: ['read'], writeScope: [] };
    const queryHostTemplate = B2_HOST.hostTemplate;
    const queryExecution = createQueryExecution({
      records, roles: createRoleConfigurationService({ records, now, eventId }), bodies: b2.bodies, now, eventId,
      sessionFacts: createSessionFactsService({ records }),
      authorizeConfiguration: async () => ({ status: 'ready', value: {
        configurationRevision: queryHostRevision, permissions: queryPermissions,
        hostTemplate: queryHostTemplate, budget: queryRuntimeBudget } }),
    });
    const queryJobs = createQueryJobService({ records, now, eventId,
      execution: { claimQuery: queryExecution.claimQuery, readQueryAnswer: queryExecution.readQueryAnswer },
      consultations: { readMessage: mailbox.readMessage, readMessageBody: mailbox.readMessageBody } });

    const goalRead = await base.plans.queryGoal(base.ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`maintenance copy goal read failed: ${JSON.stringify(goalRead)}`);
    const goal = goalRead.value.goal;
    const intent: QueryJobIntentV1 = {
      schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: base.scope.projectId,
      workspaceId: base.scope.workspaceId, goalId: goalRef.goalId, question, focusTaskRefs: [],
      budget: queryBudget, multiTurn: { maxRounds: 1 }, correlationId: queryJobRef.queryJobId,
      execution: { kind: 'semantic_query', roleBinding: base.roleBinding, runtimeBudget: queryRuntimeBudget,
        consultation: { messageRef, recipient: from, ...(derivation === undefined ? {} : { derivation }) } },
    };
    const submitted = await queryJobs.submitQueryJob(base.ctx, {
      meta: { requestId: `s1-maintenance-query-submit-${requestId}`, expected: [
        await pinOf(base.projectRef), await pinOf(base.workspaceRef), { ref: goalRef, revision: goal.revision },
        { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
      input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
    });
    if (submitted.status !== 'committed') throw new Error(`maintenance copy query submit failed: ${JSON.stringify(submitted)}`);

    const claimed = await queryExecution.claimQuery(base.ctx, {
      input: { queryRunRef, sessionRef: copy },
      meta: { requestId: `s1-maintenance-query-claim-${requestId}`, expected: [
        await pinOf(queryJobRef), await pinOf(queryRunRef), await sessionPin(copy)] },
    });
    if (claimed.status !== 'committed') throw new Error(`maintenance copy query claim failed: ${JSON.stringify(claimed)}`);

    const claimRead = await queryExecution.readQueryExecution(base.ctx, queryRunRef);
    if (claimRead.status !== 'ready') throw new Error(`maintenance copy query read failed: ${JSON.stringify(claimRead)}`);
    const prepared = (await prepareQueryForReal(base, {
      bodies: b2.bodies, queryRunRef, queryExecution, now,
      requestId: `s1-maintenance-query-prepare-${requestId}`,
      host: preparationHost({ configurationRevision: queryHostRevision, permissions: queryPermissions,
        hostTemplate: queryHostTemplate, budget: queryRuntimeBudget }),
    })).prepared;

    const copyCard = await base.sessionsPort.readSession(base.ctx, copy);
    if (copyCard.status !== 'ready') throw new Error(`maintenance copy Session read failed: ${JSON.stringify(copyCard)}`);
    const kernel = { adapterId: copyCard.value.record.kernel.adapterId,
      kernelSessionId: copyCard.value.record.kernel.kernelSessionId,
      runId: `s1-maintenance-copy-run-${requestId}`, turnId: `s1-maintenance-copy-turn-${requestId}` };
    const begun = await queryExecution.beginQueryEntry(base.ctx, {
      input: { prepared, consumerId: `s1-maintenance-copy-consumer-${requestId}`, kernel },
      meta: { requestId: `s1-maintenance-query-begin-${requestId}`, expected: [
        await pinOf(queryJobRef), await pinOf(queryRunRef), await sessionPin(copy)] },
    });
    if (begun.status !== 'committed') throw new Error(`maintenance copy query begin failed: ${JSON.stringify(begun)}`);
    const entry: QueryEntryIdentity = {
      queryRunRef: begun.value.queryRunRef, sessionRef: begun.value.sessionRef,
      sessionGeneration: begun.value.sessionGeneration, entryGeneration: begun.value.entryGeneration,
      consumerId: begun.value.consumerId, kernel: begun.value.kernel,
    };
    const source = { position: 1, cursor: `s1-maintenance-copy-cursor-${requestId}` };
    const baseHistory: RunExecutionHistoryV1 = { schemaVersion: 1, sessionRef: copy, kernel: entry.kernel,
      startPosition: 1, observedThroughPosition: 1, endPosition: null };
    const entered = await queryExecution.recordQueryObservation(base.ctx, {
      input: { entry, source, history: baseHistory,
        observation: { kind: 'entered', occurredAt: now() } },
      meta: { requestId: `s1-maintenance-query-entered-${requestId}`, expected: [await pinOf(queryRunRef)] },
    });
    if (entered.status !== 'committed') throw new Error(`maintenance copy query entered failed: ${JSON.stringify(entered)}`);

    // query-execution.ts excludes derived copies from mailbox input supply:
    // their question is in the manifest, so they never accept the source's inputId.
    if (!isolatedCopy) {
      const accepted = await mailbox.recordInputAccepted!(base.ctx, {
        input: { messageRef, part: 'message', executionRef: queryRunRef, executionSessionRef: copy,
          kernel: { ...kernel, position: 2 } },
        meta: { requestId: `fx3-query-accepted-${requestId}`, expected: [await pinOf(messageRef)] },
      });
      if (accepted.status !== 'committed') throw new Error(`Query input acceptance failed: ${JSON.stringify(accepted)}`);
    }
    return { sessionRef: copy, queryRunRef, messageRef, mailbox, queryExecution, async answer() {
    const answerText = `answer ${requestId}`;
    const answerBody = await b2.bodies.put({ body: answerText, contentType: 'text/plain; charset=utf-8',
      sourceRefs: [prepared.bundleRef.source], origin: { kind: 'run', owner: queryRunRef }, requestedAt: now() });
    if (answerBody.status !== 'ready') throw new Error(`maintenance copy answer body store failed: ${JSON.stringify(answerBody)}`);
    const answer: QueryJobAnswerV1 = {
      schemaVersion: 1, answerId: `s1-maintenance-answer-${requestId}`, queryJobRef, runRef: queryRunRef, roundIndex: 0,
      answer: answerText, sources: [], followsAnswerRef: null, stale: false, staleReason: null, answeredAt: now(),
      bodyRef: answerBody.value.ref,
    };
    const settled = await queryExecution.recordQueryObservation(base.ctx, {
      input: { entry, source: { position: 3, cursor: `fx3-query-terminal-${requestId}` }, history: { ...baseHistory, observedThroughPosition: 3, endPosition: 3 },
        observation: { kind: 'terminal', occurredAt: now(), outcome: 'answered', answer, reason: null } },
      meta: { requestId: `s1-maintenance-query-answered-${requestId}`, expected: [await pinOf(queryRunRef)] },
    });
    if (settled.status !== 'committed') throw new Error(`maintenance copy query answer failed: ${JSON.stringify(settled)}`);

    const answerRef: QueryJobAnswerRef = { aggregateType: 'QueryJobAnswer', projectId: base.scope.projectId,
      workspaceId: base.scope.workspaceId, queryJobId: queryJobRef.queryJobId, answerId: answer.answerId };
    const currentMessage = await mailbox.readMessage(base.ctx, messageRef);
    if (currentMessage.status !== 'ready') throw new Error(`maintenance copy message re-read failed: ${JSON.stringify(currentMessage)}`);
    const respond = mailbox.respondFromQueryAnswer;
    if (respond === undefined) throw new Error('the mailbox does not expose respondFromQueryAnswer');
    const answered = await respond.call(mailbox, base.ctx, {
      input: { messageRef, answerRef },
      meta: { requestId: `s1-maintenance-answer-${requestId}`, expected: [{ ref: messageRef, revision: currentMessage.value.revision }] },
    });
    if (answered.status !== 'committed') throw new Error(`maintenance copy answer failed: ${JSON.stringify(answered)}`);
    return { answer, answerRef, message: answered.value };
    } };
  }

let workflowFixtureId = 0;
/** Full production wiring: archive/maintenance need Runtime, requeue, directory and Plan ports too. */
export async function workflowForFixture(b2: B2ExecutionFixture, options: {
  now: () => string; records?: B2Records; allowedRuns?: Set<string>;
  /** Additive maintenance-only override; the Runtime keeps `base.plans`. */
  plans?: WorkflowDependencies['plans'];
  /** Additive: publish the real `closeOpenTurn` seam; absent keeps today's fallback. */
  turnClosure?: TurnClosureDependencies;
} & Pick<WorkflowDependencies, 'sessionDuty' | 'archivePolicy' | 'attestUnknownRun' | 'attestUnknownQueryRun'>): Promise<WorkflowPort> {
  const base = b2.base;
  const records = options.records ?? base.records;
  const now = options.now;
  const prefix = `fx3-workflow-${++workflowFixtureId}`;
  let seq = 0;
  const eventId = () => `${prefix}-${++seq}`;
  const reads = createRunStateReader({ records, bodies: b2.bodies });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const authority = createMaterialRecordReaders(records).authority;
  const materials = createMaterialService({ bodies: b2.bodies, authority, now });
  const messages = createSessionMailbox({ records, sessions: base.sessionsPort, executions: reads, roles, materials,
    systemActor: { kind: 'system', id: prefix }, now, newId: eventId });
  const controls = createRunControlService({ records, authority, reads, now, eventId });
  const workspaceHost = {
    async resolveRoot(scope: WorkspaceScope) {
      if (scope.projectId !== base.scope.projectId || scope.workspaceId !== base.scope.workspaceId) {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'unknown fixture workspace' };
      }
      return { status: 'ready' as const, value: { root: base.directory, workspaceRevision: 1 } };
    },
    async authorize(ctx: CoreCallContext, scope: WorkspaceScope) {
      if (scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'unknown fixture scope' };
      }
      return { status: 'ready' as const, value: { subjectKey: refKey(ctx.principal), permissionRevision: prefix,
        allowsRead: () => true } };
    },
  };
  const requeue = createTaskRequeueService({ records, reads, workspaceHost,
    source: { captureDigest: async () => ({ status: 'ready', sourceDigest: sha256Hex('unchanged FX3 workspace') }) },
    materials, messages, now, eventId });
  const claims = { ...base.service, ...requeue };
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
    storeKey: 'r4c-claim-kernel-store', workspace: base.scope, databasePath: join(base.directory, 'kernel.sqlite') }] });
  const sessionOperations = createSessionOperations({ sessions: base.sessionsPort, kernelStores });
  const activity = createExecutionHistoryReader({ history: sessionOperations });
  const scripted = createScriptedModel([{ kind: 'text', text: 'FX3 must stop before start' }]);
  { // The Host double below selects b2-trusted-skill from <dir>/skills; write it as B2-runtime-fixture does.
    const fs = await import('node:fs/promises');
    const skillDir = join(base.directory, 'skills', 'b2-trusted-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(join(skillDir, 'skill.json'), JSON.stringify({ schemaVersion: 1, id: 'b2-trusted-skill', title: 'B2 trusted skill', kind: 'instruction', priority: 10, contentFile: 'content.md' }));
    await fs.writeFile(join(skillDir, 'content.md'), 'B2_SKILL_FROM_REAL_FILE');
  }
  const runtime = createAgentRuntime({ claims, executions: reads, entry: b2.entry, modelRequests: b2.model,
    roles, plans: base.plans, messages, sessions: base.sessionsPort, materials, bodies: b2.bodies,
    // Rework 10 package R: the REQUIRED Task-review reader is the real owner over
    // this workflow's one real records store and Run reader.
    unknownCallReviews: createUnknownCallReviewService({ records, reads, now, eventId }),
    historyWriter: createExecutionHistoryService({ records, now, eventId }), activity,
    graphHistory: createGraphExecutionHistoryReader({ executions: reads, history: activity }),
    sessionOperations, kernelStores, workspaceHost,
    sourceAuthority: () => createSourceAuthorityReader({ authority }),
    host: createRuntimeHostDouble({ runRefs: options.allowedRuns ?? new Set<string>(), scripted,
      root: base.directory, skillRoot: join(base.directory, 'skills'), scope: base.scope,
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' } }),
    kernel: kernelApi, controls, now, newId: eventId,
    readTaskClosure: async (_ctx: CoreCallContext, task: { projectId: string; goalId: string; taskId: string }) =>
      readTaskClosure(records, { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
    ...(options.turnClosure === undefined ? {} : { turnClosure: options.turnClosure }),
  });
  const sessionFacts = createSessionFactsService({ records });
  const forbiddenCheck = async () => { throw new Error('archive/maintenance must not start a check'); };
  const deps: WorkflowDependencies = {
    tasks: base.goals, plans: options.plans ?? base.plans, sessions: base.sessionsPort, claims, executions: reads,
    runtime: { ...runtime.port, createSession: sessionOperations.createSession },
    evidence: { openVerification: forbiddenCheck, readVerification: forbiddenCheck, beginCheck: forbiddenCheck,
      recordCheckResult: forbiddenCheck, finalizeChecks: forbiddenCheck },
    checks: { runRegisteredCheck: forbiddenCheck }, sourceAuthority: createSourceAuthorityReader({ authority }),
    configuration: { consumerId: prefix, bindings: [{ workspace: base.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: base.roleBinding, budget: base.budget }] },
    sessionLifecycle: createSessionLifecycleService({ records, lookups: records, sessionFacts }), sessionFacts,
    responsibilities: createSessionResponsibilityService({ records, lookups: records,
      basis: createSessionResponsibilityBasisReader(records), now }),
    sessionAnomalies: createSessionAnomalyService({ records, lookups: records, sessionFacts, now }), controls,
    archivePolicy: options.archivePolicy ?? DEFAULT_SESSION_ARCHIVE_POLICY,
    // S1-AUTO-03 / §4.1 step 7 (lead fix 2026-10-09): the SAME mailbox instance the Runtime uses, as the real
    // composition wires it (create-platform `messages: mailbox`); it reads the copy's answer facts.
    messages,
    // §4.2 (lead fix 2026-10-09): the executor due clock is read from the terminal close event through
    // link.until -> eventAt, as the real composition wires it; never from the last Run.endedAt.
    records: {
      async eventAt(cursor) {
        const at = await records.eventAt(cursor);
        return at.status === 'ready'
          ? { status: 'ready' as const, value: { cursor: at.value.cursor, event: at.value.event } }
          : { status: 'rejected' as const, code: 'unavailable' as const, reason: at.reason };
      },
    },
    sessionDuty: options.sessionDuty ?? (async role => ({ status: 'ready', value:
      role.kind === 'legacy_template' && role.templateId === 'builder' ? 'executor' : 'unknown' })),
    ...(options.attestUnknownRun === undefined ? {} : { attestUnknownRun: options.attestUnknownRun }),
    ...(options.attestUnknownQueryRun === undefined ? {} : { attestUnknownQueryRun: options.attestUnknownQueryRun }),
  };
  return createWorkflow(deps);
}
