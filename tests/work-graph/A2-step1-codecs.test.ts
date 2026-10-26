/**
 * A.2 step 1 (spec §15.2 第 1 步) codec round trips.
 *
 * Step 1 only widens contracts and decoders: no service writes the new values
 * yet. These tests prove that the decoders accept every new value and optional
 * field, that records written before A.2 stay readable unchanged, and that the
 * malformed shapes the spec names are rejected. Where a record has a RecordStore
 * registration, the round trip goes through a real in-memory and SQLite backend
 * (commit → readMany / lookup → decode); receipt replays go through
 * `lookupCommit` → `eventAt`, the path every owner uses.
 *
 * - TaskRequeue@1 with non-empty and empty `supersededEvidenceIds` (L-3) and its
 *   `TaskRequeued` replay event; TaskReworkRefusal@1 at two consecutive revisions.
 * - Rounds with `chain` (ordinal 2, `reverify.requestedBy` an Agent) and
 *   `incompleteCause`; a pending/finished check without the optional cause; an
 *   interrupted check without a cause is rejected; an ordinal-1 chain with a
 *   predecessor is rejected (§9.1, C5).
 * - The chain row's root, real host_restart interruption and successor are
 *   produced by the public evidence owner on the real store (memory and SQLite),
 *   then read back through the round codec and the chain lookups.
 * - Runs with and without `terminalPayload` (C1); `interrupted_clean` without
 *   `kernelPaused` or `pausedIntentRef` is rejected (C4); a non-sha256
 *   `continuationBriefDigest` is rejected (C3).
 * - Goals with and without `desiredStateRequestedBy`, and a
 *   `GoalDesiredStateChanged` receipt replay that restores the original requester (LA-7).
 * - The other step-1 decoders: Attempt `requeueRef`, AD-2 outbox settlement,
 *   Session `healthConclusion`, QueryRun/QueryJob `not_entered`, platform control
 *   observations (CD-1..CD-3), `ExecutionEntryAuthorized.activePlanRef` (C6) and
 *   the compiler-owned `dispositionRecord` (C7).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import type { SessionHealthConclusion, SessionRecord } from '../../src/contracts/core/session.js';
import type { DelegatedWriteProvenanceV1 } from '../../src/contracts/delegated-write.js';
import {
  TERMINAL_PAYLOAD_TEXT_MAX_CHARS, TERMINAL_PAYLOAD_TRUNCATION_SUFFIX, type ModelRequestPermitRef,
  type RunRef, type RunSnapshot, type RuntimeEventV1,
  type RuntimeInputBindingV1, type TaskAttemptRef, type TaskAttemptSnapshot, type TaskTriple,
} from '../../src/contracts/dispatch.js';
import { PROMPT_TOOL_SPECS_CONTENT_TYPE, type ModelRequestPromptFactsV1 } from '../../src/contracts/prompts/prompt-set.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobSnapshot, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type {
  TaskRequeueRef, TaskRequeueSnapshotV1, TaskReworkRefusalSnapshotV1,
} from '../../src/contracts/task-requeue.js';
import { GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import {
  ROUND_CHAIN_MAX, type CheckProcessObservation, type ReverifyBasisV1, type RoundChainV1,
  type RoundCheckIncompleteCause, type RoundCheckSnapshot, type RoundSnapshot, type VerificationRoundRef,
} from '../../src/contracts/verification.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas, RecordGuard,
  StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import {
  EVIDENCE_RECORD_SCHEMAS, VERIFICATION_ROUND_BY_STATUS_LOOKUP, VERIFICATION_ROUND_BY_TASK_LOOKUP,
  VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT, VERIFICATION_ROUND_ORIGINAL_LOOKUP, decodeVerificationRoundSnapshot,
  encodeVerificationRoundSnapshot,
} from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import {
  CONTROL_RECORD_SCHEMAS, controlIntentSubmittedEventFromEvent, decodeControlIntentSnapshot,
} from '../../src/core/work-graph/persistence/control-record-codecs.js';
import {
  executionEntryAuthorizedEventFromEvent, inputBindingProblem,
} from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import {
  decodeGoalDesiredStateChangedEvent, decodeGoalSnapshot, encodeGoalDesiredStateChangedEvent, encodeGoalSnapshot,
  goalSnapshotFromDesiredStateChangedEvent, type GoalDesiredStateChangedEvent,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import {
  decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord, encodeQueryJobSnapshot, encodeQueryRunSnapshotRecord,
} from '../../src/core/work-graph/queries/query-record-codecs.js';
import {
  SESSION_LIFECYCLE_RECORD_SCHEMAS, encodeSessionHealthObservedEvent, sessionHealthObservedPayloadFromEvent,
} from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { decodeSessionRecord, encodeSessionRecord } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  TASK_CLAIM_RECORD_SCHEMAS, decodeDispatchOutboxEntry, decodeTaskAttemptSnapshot, decodeTaskRequeueSnapshot,
  decodeTaskReworkRefusalSnapshot, encodeTaskAttemptSnapshot, encodeTaskRequeueSnapshot, encodeTaskRequeuedEvent,
  encodeTaskReworkRefusalSnapshot, encodeTaskReworkRefusedEvent, taskRequeuedEventFromEvent,
  taskReworkRefusedEventFromEvent,
} from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import {
  MODEL_REQUEST_AUTHORIZED_EVENT_TYPE, MODEL_REQUEST_RECORD_SCHEMAS, decodeModelRequestPermitSnapshot,
  encodeModelRequestPermitSnapshot, encodeModelRequestRecordedEvent, modelRequestRecordedEventFromEvent,
  type ModelRequestRecordedEvent,
} from '../../src/core/work-graph/tasks/model-request-codecs.js';
import type { ModelRequestPermitV1 } from '../../src/core/work-graph/tasks/model-call-contracts.js';
import { decodeRun } from '../../src/core/work-graph/materials/run-snapshot-decoder.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { createR3eEvidenceFixture, R3E_HOST, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';

// ------------------------------------------------------------------------ //
// Shared vocabulary                                                         //
// ------------------------------------------------------------------------ //
const at = '2026-10-03T00:00:00.000Z';
const P = 'a2-project', W = 'a2-workspace', G = 'a2-goal', T = 'a2-task';
const sha = (c: string): string => c.repeat(64);
const key = (ref: unknown): string => canonicalJson(ref as JsonValue);
const task: TaskTriple = { projectId: P, goalId: G, taskId: T };
const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const attemptRef = (attemptId: string): TaskAttemptRef =>
  ({ aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId });
const roundRef = (runId: string, roundId: string, taskId = T): VerificationRoundRef =>
  ({ aggregateType: 'VerificationRound', projectId: P, workspaceId: W, goalId: G, taskId, runId, roundId });
const intentRef = (intentId: string): ControlIntentRef =>
  ({ aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId });
const requeueRef = (afterRunId: string): TaskRequeueRef =>
  ({ aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId });
const roleBinding = { schemaVersion: 1 as const, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1',
  bindingVersion: 1, policyRevision: 'p1' };
const artifact = (digest: string, contentType = 'text/markdown'): ArtifactRef =>
  ({ kind: 'artifact', contentType, digest, sizeBytes: 64, source: { kind: 'workspace', refId: W, revision: '4' } });
type HostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;
const human: HostActor = { kind: 'human', id: 'user-1' };
/** A Host started with a `kind:'system'` actor: still an operator. */
const operator: HostActor = { kind: 'system', id: 'local-host' };
const agentOf = (runId: string): ActorRef => ({ kind: 'agent', id: 'worker-agent', runRef: runRef(runId) });

// ------------------------------------------------------------------------ //
// RecordStore harness                                                       //
// ------------------------------------------------------------------------ //
type Store = { records: GoalRecordTransactionPort & RecordLookupPort; close(): Promise<void> };
const FIXTURE_EVENT = 'A2Step1FixtureSeeded';
const material = materialRecordSchemas();
const SCHEMAS: RecordBackendSchemas = {
  records: [...material.records, ...TASK_CLAIM_RECORD_SCHEMAS.records, ...EVIDENCE_RECORD_SCHEMAS.records],
  events: [...material.events, ...TASK_CLAIM_RECORD_SCHEMAS.events, ...EVIDENCE_RECORD_SCHEMAS.events,
    { eventType: FIXTURE_EVENT, schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
  lookups: [...(material.lookups ?? []), ...(EVIDENCE_RECORD_SCHEMAS.lookups ?? [])],
};
const dirs: string[] = [];
const stores: Store[] = [];
/** The R3e fixture owns a real B2 store/workspace; its close removes the temporary root. */
const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
  for (const store of stores.splice(0)) await store.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function openStore(kind: 'memory' | 'sqlite'): Promise<Store> {
  let store: Store;
  if (kind === 'memory') store = createInMemoryRecordBackend({ schemas: SCHEMAS });
  else {
    const dir = await mkdtemp(join(tmpdir(), 'a2-step1-codecs-'));
    dirs.push(dir);
    store = createSqliteRecordBackend({ path: join(dir, 'records.sqlite'), schemas: SCHEMAS });
  }
  stores.push(store);
  return store;
}
let seedCount = 0;
function fixtureEvent(): EncodedDomainEvent {
  const body = { eventId: `fixture-${String(++seedCount)}`, eventType: FIXTURE_EVENT, schemaVersion: 1, occurredAt: at };
  return { ...body, json: JSON.stringify(body) };
}
async function commit(store: Store, input: {
  identityKey: string; records: EncodedRecord[]; guards: RecordGuard[]; event?: EncodedDomainEvent;
}): Promise<StoreCommitReceipt> {
  const prepared: PreparedCommit = { identityKey: input.identityKey, fingerprint: `fp:${input.identityKey}`,
    guards: input.guards, records: input.records, claims: [], indexGuards: [], indexChanges: [],
    events: [input.event ?? fixtureEvent()] };
  return store.records.commit(prepared);
}
/** Commits records that do not exist yet (CAS null). */
async function create(store: Store, identityKey: string, records: EncodedRecord[], event?: EncodedDomainEvent): Promise<void> {
  const receipt = await commit(store, { identityKey, records, ...(event === undefined ? {} : { event }),
    guards: records.map(record => ({ refKey: record.refKey, expectedRevision: null })) });
  expect(receipt, identityKey).toMatchObject({ status: 'committed', replayed: false });
}
async function readBack(store: { records: GoalRecordTransactionPort & RecordLookupPort }, refKey: string): Promise<EncodedRecord> {
  const batch = await store.records.readMany([refKey]);
  if (batch.status !== 'ready') throw new Error(`readMany failed: ${batch.reason}`);
  const found = batch.value.records.find(record => record.refKey === refKey);
  if (found === undefined) throw new Error(`no record ${refKey}`);
  return found;
}
/** The receipt-replay source of a commit: its recorded event, found from the idempotency row. */
async function replayedEvent(store: Store, identityKey: string): Promise<EncodedDomainEvent> {
  const receipt = await store.records.lookupCommit({ identityKey, fingerprint: `fp:${identityKey}` });
  if (receipt.status !== 'ready') throw new Error(`lookupCommit failed: ${receipt.reason}`);
  const located = await store.records.eventAt(receipt.value.cursor);
  if (located.status !== 'ready') throw new Error(`eventAt failed: ${located.reason}`);
  return located.value.event;
}
function decoded<T>(result: { status: 'decoded'; value: T } | { status: 'invalid'; reason: string }): T {
  if (result.status !== 'decoded') throw new Error(`expected decoded, got invalid: ${result.reason}`);
  return result.value;
}
const KINDS = ['memory', 'sqlite'] as const;

// ------------------------------------------------------------------------ //
// TaskRequeue@1 and TaskReworkRefusal@1                                     //
// ------------------------------------------------------------------------ //
const provenance = (runId: string): DelegatedWriteProvenanceV1 => ({ schemaVersion: 1, runRef: runRef(runId),
  sessionRef: { projectId: P, sessionId: 'session-1' }, roleBinding, sessionGeneration: 2, entryGeneration: 1,
  authorizationRevision: 1, configurationRevision: 'config-1' });
function requeueBasis(outcome: NoProgressKeyV1['failure']['outcome'], origin: NoProgressKeyV1['failure']['origin'],
  checks: NoProgressKeyV1['failure']['checks'], digest: string): NoProgressKeyV1 {
  return { taskRef: task, actionKind: 'requeue',
    failure: { outcome, origin, exhaustedTokenBudget: null, checks, gapCodes: [] },
    source: { workspaceRevision: 4, sourceDigest: sha('5') }, plan: planRef, newInputDigest: null, digest };
}
/** An Agent's automatic rework after a FAIL round: the covered chain's evidence is superseded. */
function checkFailedRequeue(): TaskRequeueSnapshotV1 {
  return { ref: requeueRef('run-1'), revision: 1, schemaVersion: 1, task, planRef,
    afterRunRef: runRef('run-1'), afterAttemptRef: attemptRef('attempt-1'), afterOutcome: 'completed',
    afterRoundRef: roundRef('run-1', 'round-1'), failureClass: 'check_failed', interruption: null,
    stopIntentRef: null, stopRequester: 'none',
    basis: requeueBasis('completed', 'observed', [{ checkId: 'lint', phase: 'finished', outcome: 'FAIL', cause: null }], sha('b')),
    basisComparison: 'compared', supersededEvidenceIds: ['evidence-1', 'evidence-2'],
    newInputRefs: [{ kind: 'artifact', ref: artifact(sha('c')) }], budget: null, reason: 'lint fails on the new module',
    requestedBy: agentOf('run-1'), requestedAt: at, agentProvenance: provenance('run-1'),
    automation: { automatic: true, counted: true, autoCount: 1, cap: 3 },
    historySource: { sessionRef: { projectId: P, sessionId: 'session-1' }, adapterId: 'coding-agent',
      kernelSessionId: 'kernel-session-1', throughPosition: 57 } };
}
/** The Goal-resume continuation of a fan-out pause interrupted by a restart: no round, nothing superseded. */
function goalResumeRequeue(): TaskRequeueSnapshotV1 {
  return { ref: requeueRef('run-3'), revision: 1, schemaVersion: 1, task, planRef,
    afterRunRef: runRef('run-3'), afterAttemptRef: attemptRef('attempt-3'), afterOutcome: 'crashed',
    afterRoundRef: null, failureClass: 'interrupted', interruption: 'paused',
    stopIntentRef: intentRef('pause-3'), stopRequester: 'goal_fan_out',
    trigger: { kind: 'goal_resume', goalRef: { aggregateType: 'Goal', projectId: P, goalId: G }, resumedEpoch: 3, pausedEpoch: 2 },
    basis: requeueBasis('crashed', 'host_interrupted', [], sha('d')),
    basisComparison: 'skipped_interrupted', supersededEvidenceIds: [], newInputRefs: [],
    budget: { tokenBudget: 2000, deadline: null }, reason: 'goal resumed',
    requestedBy: { ...GOAL_FAN_OUT_ACTOR }, requestedAt: at, agentProvenance: null,
    automation: { automatic: true, counted: false, autoCount: 0, cap: 3 },
    historySource: { sessionRef: { projectId: P, sessionId: 'session-3' }, adapterId: 'coding-agent',
      kernelSessionId: 'kernel-session-3', throughPosition: null } };
}
function requeuedEvent(requeue: TaskRequeueSnapshotV1, identityKey: string): EncodedDomainEvent {
  return encodeTaskRequeuedEvent({ eventId: `ev-${identityKey}`, eventType: 'TaskRequeued', schemaVersion: 1,
    occurredAt: at, identityKey, actor: requeue.requestedBy, fingerprint: `fp:${identityKey}`, requeue });
}
/** A no-progress refusal of the requeue after run-2, matching the requeue after run-1. */
function refusal(revision: number): TaskReworkRefusalSnapshotV1 {
  return { ref: { aggregateType: 'TaskReworkRefusal', projectId: P, goalId: G, taskId: T, operation: 'requeue', subjectId: 'run-2' },
    revision, schemaVersion: 1, task, afterRunRef: runRef('run-2'), subjectRoundRef: roundRef('run-2', 'round-3'),
    failureClass: 'check_failed', code: 'no_new_basis', reason: `same failure, same source (refusal ${String(revision)})`,
    basisDigest: sha('b'), source: { workspaceRevision: 4 + revision, sourceDigest: sha('5') },
    matchedRequeueRef: requeueRef('run-1'), requestedBy: revision === 1 ? human : operator,
    refusedAt: `2026-10-03T00:0${String(revision)}:00.000Z`, goalEndedRunsAtRefusal: 2 + revision, configurationRevision: null };
}
function refusedEvent(value: TaskReworkRefusalSnapshotV1, identityKey: string): EncodedDomainEvent {
  return encodeTaskReworkRefusedEvent({ eventId: `ev-${identityKey}`, eventType: 'TaskReworkRefused', schemaVersion: 1,
    occurredAt: at, identityKey, actor: value.requestedBy, fingerprint: `fp:${identityKey}`, refusal: value });
}

describe('TaskRequeue@1 (spec §4.1, L-3)', () => {
  it('encodes and decodes losslessly with non-empty and empty supersededEvidenceIds', () => {
    for (const snapshot of [checkFailedRequeue(), goalResumeRequeue()]) {
      const encoded = encodeTaskRequeueSnapshot(snapshot);
      expect(encoded).toMatchObject({ refKey: key(snapshot.ref), schemaId: 'TaskRequeue@1', revision: 1 });
      expect(decodeTaskRequeueSnapshot(encoded)).toEqual({ status: 'decoded', value: snapshot });
    }
    expect(decoded(decodeTaskRequeueSnapshot(encodeTaskRequeueSnapshot(checkFailedRequeue()))).supersededEvidenceIds)
      .toEqual(['evidence-1', 'evidence-2']);
    expect(decoded(decodeTaskRequeueSnapshot(encodeTaskRequeueSnapshot(goalResumeRequeue()))).supersededEvidenceIds).toEqual([]);
  });

  it.each(KINDS)('%s: both requeues persist, read back and replay their TaskRequeued receipt', async kind => {
    const store = await openStore(kind);
    const withEvidence = checkFailedRequeue();
    const withoutEvidence = goalResumeRequeue();
    await create(store, 'requeue-run-1', [encodeTaskRequeueSnapshot(withEvidence)], requeuedEvent(withEvidence, 'requeue-run-1'));
    await create(store, 'requeue-run-3', [encodeTaskRequeueSnapshot(withoutEvidence)], requeuedEvent(withoutEvidence, 'requeue-run-3'));
    expect(decodeTaskRequeueSnapshot(await readBack(store, key(withEvidence.ref)))).toEqual({ status: 'decoded', value: withEvidence });
    expect(decodeTaskRequeueSnapshot(await readBack(store, key(withoutEvidence.ref)))).toEqual({ status: 'decoded', value: withoutEvidence });
    const replayed = decoded(taskRequeuedEventFromEvent(await replayedEvent(store, 'requeue-run-1')));
    expect(replayed.requeue).toEqual(withEvidence);
    expect(replayed.actor).toEqual(agentOf('run-1'));
    expect(decoded(taskRequeuedEventFromEvent(await replayedEvent(store, 'requeue-run-3'))).requeue.supersededEvidenceIds).toEqual([]);
    // Immutable: one TaskRequeue per covered Run, written with CAS null only.
    expect(await commit(store, { identityKey: 'requeue-run-1-again', records: [encodeTaskRequeueSnapshot(withEvidence)],
      guards: [{ refKey: key(withEvidence.ref), expectedRevision: null }] })).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  });

  it('rejects malformed requeues and receipts', () => {
    const value = checkFailedRequeue();
    const bad = (patch: Record<string, unknown>) => decodeTaskRequeueSnapshot(encodeTaskRequeueSnapshot({ ...value, ...patch } as TaskRequeueSnapshotV1));
    expect(bad({ revision: 2 })).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/revision must be 1/) });
    expect(bad({ afterRunRef: runRef('run-9') })).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/not the Run named by its ref/) });
    expect(bad({ supersededEvidenceIds: ['evidence-1', ''] })).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/supersededEvidenceIds/) });
    expect(bad({ supersededEvidenceIds: undefined })).toMatchObject({ status: 'invalid' });
    expect(bad({ failureClass: 'outcome_unknown' })).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/ReworkFailureClass/) });
    expect(bad({ afterOutcome: 'outcome_unknown' })).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/known RunOutcome/) });
    expect(bad({ extra: true })).toMatchObject({ status: 'invalid', reason: expect.stringMatching(/unknown fields/) });
    // The receipt actor is the recorded requester.
    expect(taskRequeuedEventFromEvent(encodeTaskRequeuedEvent({ eventId: 'ev-x', eventType: 'TaskRequeued', schemaVersion: 1,
      occurredAt: at, identityKey: 'x', actor: human, fingerprint: 'fp:x', requeue: value }))).toMatchObject({ status: 'invalid' });
  });
});

describe('TaskReworkRefusal@1 (spec §4.1; versioned per Task/operation/subject)', () => {
  it.each(KINDS)('%s: two consecutive revisions round-trip and each receipt replays its own revision', async kind => {
    const store = await openStore(kind);
    const first = refusal(1);
    const second = refusal(2);
    expect(encodeTaskReworkRefusalSnapshot(first).refKey).toBe(encodeTaskReworkRefusalSnapshot(second).refKey);
    await create(store, 'refuse-1', [encodeTaskReworkRefusalSnapshot(first)], refusedEvent(first, 'refuse-1'));
    expect(decodeTaskReworkRefusalSnapshot(await readBack(store, key(first.ref)))).toEqual({ status: 'decoded', value: first });
    expect(await commit(store, { identityKey: 'refuse-2', records: [encodeTaskReworkRefusalSnapshot(second)],
      guards: [{ refKey: key(second.ref), expectedRevision: 1 }], event: refusedEvent(second, 'refuse-2') }))
      .toMatchObject({ status: 'committed', replayed: false });
    expect(decodeTaskReworkRefusalSnapshot(await readBack(store, key(second.ref)))).toEqual({ status: 'decoded', value: second });
    // Replaying the first request returns the original refusal@1, not the current @2.
    expect(decoded(taskReworkRefusedEventFromEvent(await replayedEvent(store, 'refuse-1'))).refusal).toEqual(first);
    expect(decoded(taskReworkRefusedEventFromEvent(await replayedEvent(store, 'refuse-2'))).refusal).toEqual(second);
  });

  it('accepts a configuration-dependent reverify refusal and rejects codes and fields of the other operation', () => {
    const reverify: TaskReworkRefusalSnapshotV1 = { ...refusal(1),
      ref: { aggregateType: 'TaskReworkRefusal', projectId: P, goalId: G, taskId: T, operation: 'reverify', subjectId: 'round-3' },
      code: 'verification_uncovered', failureClass: 'check_incomplete', matchedRequeueRef: null, basisDigest: null, source: null,
      configurationRevision: 'checks-config-7' };
    expect(decodeTaskReworkRefusalSnapshot(encodeTaskReworkRefusalSnapshot(reverify))).toEqual({ status: 'decoded', value: reverify });
    const bad = (value: TaskReworkRefusalSnapshotV1) => decodeTaskReworkRefusalSnapshot(encodeTaskReworkRefusalSnapshot(value)).status;
    expect(bad({ ...refusal(1), code: 'source_unchanged' })).toBe('invalid');
    expect(bad({ ...refusal(1), code: 'verification_uncovered' })).toBe('invalid');
    expect(bad({ ...refusal(1), configurationRevision: 'checks-config-7' })).toBe('invalid');
    expect(bad({ ...reverify, code: 'budget_not_increased' })).toBe('invalid');
    expect(bad({ ...reverify, code: 'no_new_basis', matchedRequeueRef: requeueRef('run-1') })).toBe('invalid');
    expect(bad({ ...refusal(1), revision: 0 })).toBe('invalid');
    expect(bad({ ...refusal(1), ref: { ...refusal(1).ref, subjectId: 'run-9' } })).toBe('invalid');
  });
});

// ------------------------------------------------------------------------ //
// VerificationRound chain and incompleteCause                               //
// ------------------------------------------------------------------------ //
const lintCheck = { checkId: 'lint', kind: 'static' as const, command: 'npm run lint', cwd: '.', timeoutMs: 60_000, taskIds: 'all' as const };
const unitCheck = { checkId: 'unit', kind: 'dynamic' as const, command: 'npm test', cwd: '.', timeoutMs: 60_000, taskIds: 'all' as const };
const pins = {
  completionPolicyPin: { ref: { aggregateType: 'CompletionPolicyRevision' as const, projectId: P, policyId: 'policy-1', revision: 1 }, digest: sha('e') },
  architectureBaselinePin: { ref: { aggregateType: 'ArchitectureBaselineRevision' as const, projectId: P, baselineId: 'baseline-1', revision: 1 }, digest: sha('f') },
};
/** Checks that do not carry an `incompleteCause` (pending/finished may omit it; interrupted may not). */
function legacyCheck(definition: typeof lintCheck | typeof unitCheck, phase: RoundCheckSnapshot['phase'],
  outcome: RoundCheckSnapshot['outcome']): RoundCheckSnapshot {
  return { checkId: definition.checkId, definition, coverage: [], phase, invocationId: phase === 'pending' ? null : `inv-${definition.checkId}`,
    outcome, reportRef: null, sourceStatus: phase === 'finished' ? 'matched' : null };
}
function openRound(ref: VerificationRoundRef, checks: RoundCheckSnapshot[], chain: RoundChainV1): RoundSnapshot {
  return { ref, revision: 1, schemaVersion: 1, subject: task,
    subjectRunRef: runRef(ref.runId), adoptedPlanRef: planRef, taskBasisRef: planRef, executor: operator,
    configuration: { configurationRevision: 'checks-config-1', workspace: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
      executor: operator, permissionRevision: 'perm-1', sourceAccess: 'verification_workspace', processAccess: 'all_except_denied',
      deniedPrefixes: [], checks: [lintCheck, unitCheck] },
    configurationDigest: sha('7'),
    // Opaque to the round codec; the open path pins them.
    identity: { schemaVersion: 1, sourceDigest: sha('5') } as unknown as RoundSnapshot['identity'],
    sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
    verificationPlan: { schemaVersion: 1, planId: sha('8') } as unknown as RoundSnapshot['verificationPlan'],
    checks, status: 'open', outcome: null, gaps: [], evidenceRefs: [], chain };
}
const reverifyBasis: ReverifyBasisV1 = { subject: task, subjectRunId: 'run-1', actionKind: 'reverify',
  failure: { checks: [{ checkId: 'unit', phase: 'interrupted', outcome: null, cause: null }], gapCodes: ['interrupted_check'] },
  source: { workspaceRevision: 4, sourceDigest: sha('5') },
  configuration: { configurationRevision: 'checks-config-1', configurationDigest: sha('7') },
  verificationInputs: { basisPlanRef: planRef, ...pins }, newInputDigest: null, digest: sha('9') };
/** The Agent-requested successor of the current root round (ordinal 2). */
const successorChain = (): RoundChainV1 => ({ schemaVersion: 1, ordinal: 2, predecessorRoundRef: roundRef('run-1', 'round-1'),
  predecessorRevision: 3, supersededEvidenceIds: ['evidence-1'], basisDigests: [sha('9')], autoCount: 1,
  reverify: { requestedBy: agentOf('run-1'), actorClass: 'agent', failureClass: 'check_incomplete', requestedAt: at,
    basis: reverifyBasis, exemption: 'host_interruption', sourceChanged: false, newInputRefs: [], reason: null } });
const successorRound = (): RoundSnapshot => openRound(roundRef('run-1', 'round-2'), [
  { ...legacyCheck(lintCheck, 'finished', 'INCONCLUSIVE'), incompleteCause: 'process_timed_out' },
  { ...legacyCheck(unitCheck, 'interrupted', null), incompleteCause: 'host_restart' },
], successorChain());
const rootChain: RoundChainV1 = { schemaVersion: 1, ordinal: 1, predecessorRoundRef: null, predecessorRevision: null,
  supersededEvidenceIds: [], basisDigests: [], autoCount: 0, reverify: null };

// ------------------------------------------------------------------------ //
// The row's root, interruption and successor through the public owner       //
// ------------------------------------------------------------------------ //
type EvidenceOwner = ReturnType<typeof createEvidenceService>;

/** The real evidence owner over the fixture ledger, with this Host's owned instance lease (VR-04). */
function evidenceWithRestart(fixture: R3eEvidenceFixture): EvidenceOwner {
  let sequence = 0;
  return createEvidenceService({
    records: fixture.records, materials: fixture.materials,
    executions: createRunStateReader({ records: fixture.records }),
    workspaceHost: fixture.workspaceHost, source: new VerificationWorkspaceReader(),
    configuration: fixture.configuration,
    hostInstance: { hostInstanceId: 'a2-step1-reconciler', lease: 'owned' },
    now: () => B2_AT, newId: () => `a2-step1-${String(++sequence)}`,
  });
}

/** The runner's observation input (no process runs: this row is about the stored round). */
function executedCheck(): CheckProcessObservation {
  const text = 'A2_STEP1_OK\n';
  return { kind: 'executed', startedAt: at, finishedAt: at, exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: '1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

async function latestRound(evidence: EvidenceOwner, fixture: R3eEvidenceFixture, ref: VerificationRoundRef): Promise<RoundSnapshot> {
  const read = await evidence.readVerification(fixture.ctx, ref);
  if (read.status !== 'ready') throw new Error(`the round must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

/**
 * The row's three states through the real owner, never a record built by the
 * test: `openVerification` → a real PASS check recorded through
 * `beginCheck`/`recordCheckResult` → a real `host_restart` interruption of the
 * other check under the owned instance lease → `finalizeChecks` (a PASS beside
 * an interrupted check) → the public `reverifyRound` (operator) successor.
 */
async function publicInterruptedChain(fixture: R3eEvidenceFixture): Promise<{ root: RoundSnapshot; successor: RoundSnapshot }> {
  const evidence = evidenceWithRestart(fixture);
  const opened = await evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error(`the root round must open: ${JSON.stringify(opened)}`);
  let round = opened.value;
  const passBegin = await evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, fixture.passCheck.checkId));
  if (passBegin.status !== 'committed') throw new Error(`the pass check must begin: ${JSON.stringify(passBegin)}`);
  round = await latestRound(evidence, fixture, round.ref);
  const recorded = await evidence.recordCheckResult(fixture.ctx,
    fixture.recordRequest(round, fixture.passCheck.checkId, passBegin.value.invocationId, executedCheck()));
  if (recorded.status !== 'committed') throw new Error(`the pass check must record: ${JSON.stringify(recorded)}`);
  round = recorded.value;
  const interruptBegin = await evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, fixture.interruptCheck.checkId));
  if (interruptBegin.status !== 'committed') throw new Error(`the interrupted check must begin: ${JSON.stringify(interruptBegin)}`);
  round = await latestRound(evidence, fixture, round.ref);
  const interrupted = await evidence.interruptCheck!(fixture.ctx, {
    input: { roundRef: round.ref, checkId: fixture.interruptCheck.checkId,
      invocationId: interruptBegin.value.invocationId, cause: 'host_restart', hostInstanceId: 'a2-step1-reconciler' },
    meta: { requestId: 'a2-step1-interrupt', expected: [{ ref: round.ref, revision: round.revision }] },
  });
  if (interrupted.status !== 'committed') throw new Error(`the check must interrupt: ${JSON.stringify(interrupted)}`);
  round = interrupted.value;
  const finalized = await evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  if (finalized.status !== 'committed') throw new Error(`the root must finalize: ${JSON.stringify(finalized)}`);
  const root = finalized.value.snapshot;
  const reverified = await evidence.reverifyRound!(fixture.ctx, {
    input: { predecessorRoundRef: root.ref },
    meta: { requestId: 'a2-step1-reverify', expected: [{ ref: root.ref, revision: root.revision }] },
  });
  if (reverified.status !== 'committed' || reverified.value.kind !== 'reverified') {
    throw new Error(`the successor must open: ${JSON.stringify(reverified)}`);
  }
  return { root, successor: reverified.value.round };
}

describe('VerificationRound chain and incompleteCause (spec §9.1, C5)', () => {
  it('a successor round (ordinal 2, Agent reverify) with incompleteCause and a chain root round-trip', () => {
    const successor = successorRound();
    expect(successor.chain.reverify?.requestedBy.kind).toBe('agent');
    expect(decodeVerificationRoundSnapshot(encodeVerificationRoundSnapshot(successor))).toEqual({ status: 'decoded', value: successor });
    const root = openRound(roundRef('run-1', 'round-1'), [{ ...legacyCheck(lintCheck, 'pending', null), incompleteCause: null }], rootChain);
    expect(decodeVerificationRoundSnapshot(encodeVerificationRoundSnapshot(root))).toEqual({ status: 'decoded', value: root });
  });

  it.each(KINDS)('%s: the public root interruption and its successor survive the store and the chain lookups', async kind => {
    const fixture = await createR3eEvidenceFixture(kind, COMPLETION_RECORD_SCHEMAS);
    fixtures.push(fixture);
    const { root, successor } = await publicInterruptedChain(fixture);
    // The root's real interruption carries its cause, and the fold appends it.
    expect(root.chain).toEqual(rootChain);
    expect(root.checks.find(check => check.checkId === fixture.interruptCheck.checkId)).toMatchObject({
      phase: 'interrupted', outcome: null, incompleteCause: 'host_restart' });
    expect(root.gaps).toContainEqual(expect.objectContaining({ code: 'interrupted_check',
      message: `the required check ${fixture.interruptCheck.checkId} was interrupted (host_restart)` }));
    // The successor is the owner's public reverify of that real interruption. VR-09: it supersedes the evidence
    // of the chain so far. The root supersedes nothing (rootChain) and holds the evidence of its one executed
    // check (the PASS); the interrupted check left none. So the successor supersedes exactly that one id.
    expect(root.chain.supersededEvidenceIds).toEqual([]);
    expect(root.evidenceRefs).toHaveLength(1);
    expect(successor.chain).toMatchObject({ ordinal: 2, predecessorRoundRef: root.ref, predecessorRevision: root.revision,
      supersededEvidenceIds: [root.evidenceRefs[0]!.evidenceId], autoCount: 0,
      reverify: { requestedBy: R3E_HOST, actorClass: 'human', failureClass: 'check_incomplete',
        exemption: 'host_interruption', sourceChanged: false, newInputRefs: [], reason: null } });
    expect(successor.checks.every(check => check.phase === 'pending')).toBe(true);
    // The codec round trip over the records the owner wrote.
    expect(decodeVerificationRoundSnapshot(await readBack(fixture, key(root.ref)))).toEqual({ status: 'decoded', value: root });
    expect(decodeVerificationRoundSnapshot(await readBack(fixture, key(successor.ref)))).toEqual({ status: 'decoded', value: successor });
    expect(VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT).toBe(ROUND_CHAIN_MAX + 1);
    const lookup = async (index: string, values: (string | number)[]) => {
      const page = await fixture.records.lookup({ index, values, limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT });
      if (page.status !== 'ready') throw new Error(page.reason);
      return page.value.records.map(record => decoded(decodeVerificationRoundSnapshot(record)).ref.roundId).sort();
    };
    const scope = [fixture.scope.projectId, fixture.scope.workspaceId, fixture.goalRef.goalId, fixture.subject.taskId];
    const chainIds = [root.ref.roundId, successor.ref.roundId].sort();
    expect(await lookup(VERIFICATION_ROUND_ORIGINAL_LOOKUP, [...scope, fixture.subjectRunRef.runId])).toEqual(chainIds);
    expect(await lookup(VERIFICATION_ROUND_BY_TASK_LOOKUP, scope)).toEqual(chainIds);
    expect(await lookup(VERIFICATION_ROUND_BY_TASK_LOOKUP, [...scope.slice(0, 3), 'other-task'])).toEqual([]);
    expect(await lookup(VERIFICATION_ROUND_BY_STATUS_LOOKUP, [fixture.scope.projectId, fixture.scope.workspaceId, 'open']))
      .toEqual([successor.ref.roundId]);
    expect(await lookup(VERIFICATION_ROUND_BY_STATUS_LOOKUP, [fixture.scope.projectId, fixture.scope.workspaceId, 'finalized']))
      .toEqual([root.ref.roundId]);
  });

  it.each(KINDS)('%s: an ordinal-1 chain with a predecessor is rejected by the codec and the store', async kind => {
    const store = await openStore(kind);
    const malformed = openRound(roundRef('run-1', 'round-2'), [legacyCheck(lintCheck, 'pending', null)],
      { ...rootChain, predecessorRoundRef: roundRef('run-1', 'round-1') });
    expect(decodeVerificationRoundSnapshot(encodeVerificationRoundSnapshot(malformed)))
      .toMatchObject({ status: 'invalid', reason: expect.stringMatching(/chain root \(ordinal 1\) has no predecessor/) });
    expect(await commit(store, { identityKey: 'malformed-round', records: [encodeVerificationRoundSnapshot(malformed)],
      guards: [{ refKey: key(malformed.ref), expectedRevision: null }] })).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('rejects other malformed chains and an interrupted check without a cause', () => {
    const status = (value: RoundSnapshot) => decodeVerificationRoundSnapshot(encodeVerificationRoundSnapshot(value)).status;
    const successor = successorRound();
    const withChain = (patch: Partial<RoundChainV1>) => ({ ...successor, chain: { ...successorChain(), ...patch } });
    expect(status(withChain({ reverify: null }))).toBe('invalid');
    expect(status(withChain({ predecessorRoundRef: null }))).toBe('invalid');
    expect(status(withChain({ predecessorRoundRef: roundRef('run-2', 'round-1') }))).toBe('invalid');
    expect(status(withChain({ autoCount: 2 }))).toBe('invalid');
    expect(status(withChain({ ordinal: ROUND_CHAIN_MAX + 1 }))).toBe('invalid');
    expect(status({ ...successor, checks: [{ ...legacyCheck(unitCheck, 'interrupted', null),
      incompleteCause: 'power_cut' as unknown as RoundCheckIncompleteCause }] })).toBe('invalid');
    // VR-04/VR-13: every interrupted check the writer stores names its cause.
    expect(status({ ...successor, checks: [legacyCheck(unitCheck, 'interrupted', null)] })).toBe('invalid');
    expect(status({ ...successor, checks: [{ ...legacyCheck(unitCheck, 'interrupted', null), incompleteCause: null }] }))
      .toBe('invalid');
    // A non-interrupted check keeps the optional cause (it may be absent or null).
    expect(status({ ...successor, checks: [legacyCheck(lintCheck, 'pending', null)] })).toBe('decoded');
  });
});

// ------------------------------------------------------------------------ //
// Run: terminalPayload, reconciliation, continuationBriefDigest             //
// ------------------------------------------------------------------------ //
function endedRun(runId: string, outcome: RunSnapshot['outcome']): RunSnapshot {
  return { ref: runRef(runId), revision: 4, schemaVersion: 1, task, attemptId: `attempt-${runId}`, planRef, roleBinding,
    budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 4 },
    status: 'ended', outcome, exitCode: outcome === 'completed' ? 0 : null, lastEventSeq: 3, lastRuntimeEventId: 'rt-3',
    lastFactEventId: 'fact-3', envelope: null, startedAt: at, endedAt: at };
}
const encodeRun = (run: RunSnapshot): EncodedRecord =>
  ({ refKey: key(run.ref), schemaId: 'RunSnapshot@1', revision: run.revision, json: JSON.stringify(run) });
const synthesizedCrash = (runId: string): RuntimeEventV1 => ({ eventType: 'run_crashed', schemaVersion: 1, eventId: `rt-${runId}-crash`,
  runRef: runRef(runId), sequence: 4, occurredAt: at, payload: { kind: 'crashed', error: 'interrupted by a Host restart' } });
type InterruptedClean = Extract<NonNullable<RunSnapshot['reconciliation']>['observation'], { kind: 'interrupted_clean' }>;
function reconciled(run: RunSnapshot, observation: NonNullable<RunSnapshot['reconciliation']>['observation']): RunSnapshot {
  return { ...run, reconciliation: { status: 'done', observation, basis: { kind: 'host_instance_takeover', hostInstanceId: 'host-2' }, recordedAt: at } };
}
const binding: RuntimeInputBindingV1 = { schemaVersion: 1, inputDigest: sha('1'), manifestDigest: sha('2'),
  materialAccessRefs: [], deliveryRefs: [] };

describe('Run terminalPayload, reconciliation and input binding (spec §6.1)', () => {
  it.each(KINDS)('%s: an ended Run with and without terminalPayload round-trips through the one Run decoder', async kind => {
    const store = await openStore(kind);
    const legacy = endedRun('run-1', 'crashed');
    const withPayload: RunSnapshot = { ...endedRun('run-2', 'crashed'), terminalPayload: { kind: 'crashed', error: 'provider closed the stream' },
      requeueRef: requeueRef('run-1') };
    await create(store, 'runs', [encodeRun(legacy), encodeRun(withPayload)]);
    expect(decodeRun(await readBack(store, key(legacy.ref)))).toEqual({ ok: true, value: legacy });
    expect(decodeRun(await readBack(store, key(withPayload.ref)))).toEqual({ ok: true, value: withPayload });
  });

  it('accepts every terminal payload kind that matches the outcome and bounds its text', () => {
    const accepted: RunSnapshot[] = [
      { ...endedRun('run-2', 'completed'), terminalPayload: { kind: 'completed', exitCode: 0 } },
      { ...endedRun('run-2', 'cancelled'),
        terminalPayload: { kind: 'cancelled', reason: 'x'.repeat(TERMINAL_PAYLOAD_TEXT_MAX_CHARS) + TERMINAL_PAYLOAD_TRUNCATION_SUFFIX } },
      { ...endedRun('run-2', 'budget_exhausted'), terminalPayload: { kind: 'budget_exhausted', exhaustedAt: at } },
    ];
    for (const run of accepted) expect(decodeRun(encodeRun(run)), run.outcome ?? 'null').toEqual({ ok: true, value: run });
    const rejected: RunSnapshot[] = [
      { ...endedRun('run-2', 'crashed'), terminalPayload: { kind: 'completed', exitCode: 0 } },
      { ...endedRun('run-2', 'crashed'),
        terminalPayload: { kind: 'crashed', error: 'x'.repeat(TERMINAL_PAYLOAD_TEXT_MAX_CHARS + TERMINAL_PAYLOAD_TRUNCATION_SUFFIX.length + 1) } },
      { ...endedRun('run-2', 'outcome_unknown'), terminalPayload: { kind: 'crashed', error: 'unknown' } },
      { ...endedRun('run-2', 'crashed'), status: 'running', terminalPayload: { kind: 'crashed', error: 'early' } },
    ];
    for (const run of rejected) expect(decodeRun(encodeRun(run)), JSON.stringify(run.terminalPayload)).toMatchObject({ ok: false });
  });

  it('accepts interrupted_clean only with both kernelPaused and pausedIntentRef', () => {
    const run = endedRun('run-3', 'crashed');
    const paused: InterruptedClean = { kind: 'interrupted_clean', event: synthesizedCrash('run-3'), lastPosition: 57,
      kernelPaused: true, pausedIntentRef: intentRef('pause-3') };
    const executing: InterruptedClean = { ...paused, kernelPaused: false, pausedIntentRef: null };
    expect(decodeRun(encodeRun(reconciled(run, paused)))).toMatchObject({ ok: true });
    expect(decodeRun(encodeRun(reconciled(run, executing)))).toMatchObject({ ok: true });
    const { kernelPaused: _kernelPaused, ...withoutKernelPaused } = paused;
    const { pausedIntentRef: _pausedIntentRef, ...withoutPausedIntentRef } = paused;
    const missing = (observation: unknown) => decodeRun(encodeRun(reconciled(run, observation as InterruptedClean)));
    expect(missing(withoutKernelPaused)).toMatchObject({ ok: false, reason: expect.stringMatching(/requires a kernelPaused boolean/) });
    expect(missing(withoutPausedIntentRef)).toMatchObject({ ok: false, reason: expect.stringMatching(/requires pausedIntentRef/) });
    expect(missing({ ...paused, kernelPaused: null })).toMatchObject({ ok: false });
    expect(missing({ ...paused, event: synthesizedCrash('run-9') })).toMatchObject({ ok: false });
  });

  it('reads the other reconciliation observations with their basis', () => {
    const run = endedRun('run-3', 'outcome_unknown');
    const observations: NonNullable<RunSnapshot['reconciliation']>['observation'][] = [
      { kind: 'unresolved', reason: 'a write tool call has no result', observedThroughPosition: 57, unresolvedToolCallIds: ['call-7'] },
      { kind: 'human_attested', attestedBy: human, reason: 'the process is gone' },
      { kind: 'runtime_terminal', event: synthesizedCrash('run-3'), digest: sha('3') },
    ];
    for (const observation of observations) {
      expect(decodeRun(encodeRun(reconciled(run, observation))), observation.kind).toMatchObject({ ok: true });
    }
    // The attester is an operator: a kind:'system' Host actor qualifies, platform automation and Agents do not.
    const attested = (attestedBy: unknown) => decodeRun(encodeRun(reconciled(run,
      { kind: 'human_attested', attestedBy, reason: 'the process is gone' } as NonNullable<RunSnapshot['reconciliation']>['observation'])));
    expect(attested(operator)).toMatchObject({ ok: true });
    for (const actor of [GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR, agentOf('run-3')]) {
      expect(attested(actor), actor.id).toMatchObject({ ok: false, reason: expect.stringMatching(/Host operator actor/) });
    }
    const { basis: _basis, ...withoutBasis } = reconciled(run, observations[0]!).reconciliation!;
    expect(decodeRun(encodeRun({ ...run, reconciliation: withoutBasis as NonNullable<RunSnapshot['reconciliation']> }))).toMatchObject({ ok: false });
  });

  it('accepts a sha256 continuationBriefDigest and rejects any other value', () => {
    expect(inputBindingProblem(binding)).toBeNull();
    expect(inputBindingProblem({ ...binding, continuationBriefDigest: sha('3') })).toBeNull();
    for (const digest of [`sha256:${sha('3')}`, sha('A'), sha('3').slice(1), '', 42, null]) {
      expect(inputBindingProblem({ ...binding, continuationBriefDigest: digest }), String(digest))
        .toBe('inputBinding continuationBriefDigest must be a sha256 hex');
    }
    const run = { ...endedRun('run-2', 'completed'), inputBinding: binding };
    expect(decodeRun(encodeRun({ ...run, inputBinding: { ...binding, continuationBriefDigest: sha('3') } }))).toMatchObject({ ok: true });
    expect(decodeRun(encodeRun({ ...run, inputBinding: { ...binding, continuationBriefDigest: 'not-a-digest' } })))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/continuationBriefDigest must be a sha256 hex/) });
  });
});

// ------------------------------------------------------------------------ //
// Goal desired state (D-9, GOAL-05, LA-7)                                   //
// ------------------------------------------------------------------------ //
const legacyGoal: GoalSnapshot = { ref: { aggregateType: 'Goal', projectId: P, goalId: G },
  workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: W }, objective: 'Ship the module',
  desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null, activePlanRevision: null, revision: 1,
  settings: { schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 0, waitForGoalRef: null, parallelRisks: [] },
  continuedFrom: null, copiedInterventions: [], since: 'c0000000001' as GoalSnapshot['since'] };
const pausedGoal: GoalSnapshot = { ...legacyGoal, desiredState: 'paused', revision: 2, desiredStateRevision: 2,
  desiredStateRequestedBy: human };
const resumedGoal: GoalSnapshot = { ...legacyGoal, desiredState: 'active', revision: 3, desiredStateRevision: 3,
  desiredStateRequestedBy: operator };
function desiredStateChanged(identityKey: string, goal: GoalSnapshot, change: Pick<GoalDesiredStateChangedEvent,
  'control' | 'from' | 'to' | 'pausedEpoch' | 'reason'> & { actor: GoalDesiredStateChangedEvent['actor'] }): GoalDesiredStateChangedEvent {
  return { eventId: `ev-${identityKey}`, eventType: 'GoalDesiredStateChanged', schemaVersion: 1, occurredAt: at, identityKey,
    fingerprint: `fp:${identityKey}`, desiredStateRevision: goal.revision, goal, ...change };
}

describe('Goal desiredState, desiredStateRevision and desiredStateRequestedBy (D-9, LA-7)', () => {
  it('round-trips the three desired states with and without a requester', () => {
    const cancelled: GoalSnapshot = { ...legacyGoal, desiredState: 'cancelled', revision: 4, desiredStateRevision: 4,
      desiredStateRequestedBy: human };
    const explicitNull: GoalSnapshot = { ...legacyGoal, revision: 2, desiredStateRevision: 1, desiredStateRequestedBy: null };
    for (const goal of [pausedGoal, resumedGoal, cancelled, explicitNull]) {
      expect(decodeGoalSnapshot(encodeGoalSnapshot(goal)), goal.desiredState).toEqual({ status: 'decoded', value: goal });
    }
  });

  it('rejects an Agent requester and a desiredStateRevision beyond the Goal revision', () => {
    expect(decodeGoalSnapshot(encodeGoalSnapshot({ ...pausedGoal, desiredStateRequestedBy: agentOf('run-1') })).status).toBe('invalid');
    expect(decodeGoalSnapshot(encodeGoalSnapshot({ ...pausedGoal, desiredStateRevision: 3 })).status).toBe('invalid');
    expect(decodeGoalSnapshot(encodeGoalSnapshot({ ...pausedGoal, desiredStateRevision: 0 })).status).toBe('invalid');
    expect(decodeGoalSnapshot(encodeGoalSnapshot({ ...pausedGoal, desiredState: 'stopped' as GoalSnapshot['desiredState'] })).status).toBe('invalid');
  });

  it('rejects a GoalDesiredStateChanged whose written Goal disagrees with the event', () => {
    const pause = desiredStateChanged('goal-pause', pausedGoal,
      { control: 'pause', from: 'active', to: 'paused', pausedEpoch: null, reason: null, actor: human });
    const status = (event: GoalDesiredStateChangedEvent) => decodeGoalDesiredStateChangedEvent(encodeGoalDesiredStateChangedEvent(event)).status;
    expect(status(pause)).toBe('decoded');
    expect(status({ ...pause, goal: { ...pausedGoal, desiredStateRequestedBy: operator } })).toBe('invalid');
    expect(status({ ...pause, goal: { ...pausedGoal, desiredStateRequestedBy: null } })).toBe('invalid');
    expect(status({ ...pause, to: 'cancelled' })).toBe('invalid');
    expect(status({ ...pause, pausedEpoch: 1 })).toBe('invalid');
    // The replay returns the carried Goal as written, so it must have exactly the snapshot fields.
    expect(status({ ...pause, goal: { ...pausedGoal, phase: 'x' } as GoalSnapshot })).toBe('invalid');
    expect(status({ ...pause, goal: { ...pausedGoal, ref: { ...pausedGoal.ref, extra: 1 } } as GoalSnapshot })).toBe('invalid');
    const { desiredStateRevision: _revision, ...withoutRevision } = pausedGoal;
    expect(status({ ...pause, goal: withoutRevision as GoalSnapshot })).toBe('invalid');
    const replayed = goalSnapshotFromDesiredStateChangedEvent(pause);
    expect(replayed).toEqual(pausedGoal);
    expect(replayed).not.toBe(pause.goal);
  });
});

// ------------------------------------------------------------------------ //
// The other step-1 decoders                                                 //
// ------------------------------------------------------------------------ //
/** A raw record body the step-1 decoders must judge (no typed encoder takes it). */
const asRecord = (ref: unknown, schemaId: string, body: unknown): EncodedRecord =>
  ({ refKey: key(ref), schemaId, revision: (body as { revision: number }).revision, json: JSON.stringify(body) });
type RawEvent = { eventId: string; eventType: string; schemaVersion: number; occurredAt: string; [field: string]: unknown };
const asEvent = (body: RawEvent): EncodedDomainEvent =>
  ({ eventId: body.eventId, eventType: body.eventType, schemaVersion: body.schemaVersion, occurredAt: body.occurredAt, json: JSON.stringify(body) });

describe('other step-1 decoders', () => {
  it('reads an Attempt with and without requeueRef (TASK-03)', () => {
    const attempt: TaskAttemptSnapshot = { ref: attemptRef('attempt-2'), revision: 1, schemaVersion: 1, runId: 'run-2', planRef,
      status: 'claimed', startedAt: null, endedAt: null, endOutcome: null };
    const requeued: TaskAttemptSnapshot = { ...attempt, requeueRef: requeueRef('run-1') };
    expect(decodeTaskAttemptSnapshot(encodeTaskAttemptSnapshot(attempt))).toEqual({ status: 'decoded', value: attempt });
    expect(decodeTaskAttemptSnapshot(encodeTaskAttemptSnapshot(requeued))).toEqual({ status: 'decoded', value: requeued });
    expect(decodeTaskAttemptSnapshot(encodeTaskAttemptSnapshot({ ...attempt, requeueRef: requeueRef('run-2') })).status).toBe('invalid');
    expect(decodeTaskAttemptSnapshot(encodeTaskAttemptSnapshot({ ...attempt,
      requeueRef: { ...requeueRef('run-1'), taskId: 'other-task' } })).status).toBe('invalid');
  });

  it('reads the AD-2 not-entered outbox settlement beside the V1 phases', () => {
    const outboxRef = { aggregateType: 'DispatchOutboxEntry' as const, projectId: P, goalId: G, taskId: T, attemptId: 'attempt-2' };
    const claim = { task, planRef, workspaceId: W, sessionRef: { projectId: P, sessionId: 'session-1' }, runRef: runRef('run-2'),
      attemptRef: attemptRef('attempt-2'), outboxRef, sessionRevision: 2, generation: 2, claimedAt: at };
    const settlement = { schemaVersion: 2, phase: 'settled', settlement: 'not_entered', consumerId: null, entryGeneration: null,
      sessionGeneration: 2, eventId: 'ev-settle' };
    const outbox = { ref: outboxRef, revision: 2, schemaVersion: 1, status: 'settled', dispatchState: settlement, claim };
    expect(decodeDispatchOutboxEntry(asRecord(outboxRef, 'DispatchOutboxEntrySnapshot@1', outbox)))
      .toMatchObject({ status: 'decoded', value: { dispatchState: settlement } });
    expect(decodeDispatchOutboxEntry(asRecord(outboxRef, 'DispatchOutboxEntrySnapshot@1',
      { ...outbox, status: 'entered', dispatchState: { ...settlement, phase: 'entered' } })).status).toBe('invalid');
    expect(decodeDispatchOutboxEntry(asRecord(outboxRef, 'DispatchOutboxEntrySnapshot@1',
      { ...outbox, dispatchState: { ...settlement, settlement: 'entered' } })).status).toBe('invalid');
  });

  it('reads Session healthConclusion (absent, null or one of three) and its SessionHealthObserved event', () => {
    const session: SessionRecord = { ref: { aggregateType: 'Session', projectId: P, sessionId: 'session-1' }, revision: 2,
      kernel: { adapterId: 'coding-agent', kernelSessionId: 'kernel-session-1' }, lifecycle: 'active', health: 'available',
      role: { kind: 'legacy_template', templateId: 'worker', templateRevision: 'r1' }, workspaceId: W, lastExecutionRef: null,
      occupancy: null, historyCursor: null, createdAt: at, archivedAt: null,
      provenance: { schemaVersion: 1, kind: 'new' } };
    const unavailable: SessionRecord = { ...session, health: 'unavailable', healthConclusion: 'damaged' };
    for (const value of [session, { ...session, healthConclusion: null }, unavailable,
      { ...unavailable, healthConclusion: 'missing' as const }, { ...unavailable, healthConclusion: 'kernel_turn_open' as const }]) {
      // Slice 1 §2.9: the stored Session's provenance is required and kept;
      // only the optional archive request decodes with its null default.
      expect(decodeSessionRecord(encodeSessionRecord(value))).toEqual({ status: 'decoded',
        value: { ...value, archiveRequest: null } });
    }
    expect(decodeSessionRecord(encodeSessionRecord({ ...unavailable,
      healthConclusion: 'gone' as unknown as SessionHealthConclusion })).status).toBe('invalid');
    const observed = encodeSessionHealthObservedEvent({ eventId: 'ev-health', eventType: 'SessionHealthObserved', schemaVersion: 1,
      occurredAt: at, projectId: P, hostInstanceId: 'host-2', observed: 'unavailable', probe: 'damaged', kernelHeader: null,
      session: unavailable });
    expect(sessionHealthObservedPayloadFromEvent(observed).status).toBe('decoded');
    const schema = SESSION_LIFECYCLE_RECORD_SCHEMAS.events.find(entry => entry.eventType === 'SessionHealthObserved');
    expect(schema?.validate(observed).status).toBe('decoded');
    // The stored conclusion must be the probe's.
    expect(sessionHealthObservedPayloadFromEvent(encodeSessionHealthObservedEvent({ eventId: 'ev-health-2',
      eventType: 'SessionHealthObserved', schemaVersion: 1, occurredAt: at, projectId: P, hostInstanceId: 'host-2',
      observed: 'unavailable', probe: 'missing', kernelHeader: null, session: unavailable })).status).toBe('invalid');
  });

  it('reads not_entered on QueryRun outcome and QueryJob closeReason (SD-4)', () => {
    const queryJobRef = { aggregateType: 'QueryJob' as const, projectId: P, workspaceId: W, queryJobId: 'query-1' };
    const queryRunRef = { aggregateType: 'QueryRun' as const, projectId: P, workspaceId: W, queryJobId: 'query-1', runId: 'query-run-1' };
    const queryRun: QueryRunSnapshot = { ref: queryRunRef, revision: 2, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef,
      runId: 'query-run-1', status: 'closed', startedAt: null, endedAt: at, outcome: 'not_entered' } };
    expect(decodeQueryRunSnapshotRecord(encodeQueryRunSnapshotRecord(queryRun))).toEqual({ status: 'decoded', value: queryRun });
    const queryJob: QueryJobSnapshot = { ref: queryJobRef, revision: 3, schemaVersion: 1,
      submission: { schemaVersion: 1, identityKey: 'query-submission-1', fingerprint: sha('a'), eventId: 'query-submit-event-1' },
      since: 'c0000000001' as QueryJobSnapshot['since'],
      job: { schemaVersion: 1,
      queryJobId: 'query-1', projectId: P, workspaceId: W, goalId: G,
      intent: { schemaVersion: 1, intentId: 'intent-1', projectId: P, workspaceId: W, goalId: G, question: 'Which module owns X?',
        focusTaskRefs: [{ aggregateType: 'Task', ...task }], budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'corr-1',
        execution: { kind: 'semantic_query', roleBinding, runtimeBudget: DEFAULT_RUNTIME_BUDGET } },
      status: 'closed', runRef: queryRunRef, answerRefs: [],
      requestRoot: null, roundKind: null, requestGoalId: null, assignedSession: null, routing: null,
      relatedMessageRef: null, absorbedInto: null, absorbedRounds: [], selectedIdea: null, goalAttribution: null,
      relatedCardRefs: [], enteredSession: null, intakeSession: null, receipt: null, understanding: null,
      closeReason: { code: 'not_entered', message: 'settled at start-up without entering the Kernel', detail: null },
      submittedAt: at, updatedAt: at } };
    expect(decodeQueryJobSnapshot(encodeQueryJobSnapshot(queryJob))).toEqual({ status: 'decoded', value: queryJob });
    const unknownClose = { ...queryJob, job: { ...queryJob.job, closeReason: { code: 'vanished', message: '', detail: null } } } as unknown as QueryJobSnapshot;
    expect(decodeQueryJobSnapshot(encodeQueryJobSnapshot(unknownClose)).status).toBe('invalid');
  });

  it('reads platform control observations (CD-1, CD-2) and a not-entered applied@2 submission (CD-3)', () => {
    const ref = intentRef('pause-2');
    const appliedPause: ControlIntentSnapshotV1 = { schemaVersion: 1, ref, revision: 2, runRef: runRef('run-2'), kind: 'pause',
      desiredState: 'paused', reason: null, requestedAt: at, requestedBy: human, status: 'applied',
      observation: { schemaVersion: 1, origin: 'platform_not_entered', kind: 'paused', runRevision: 4,
        detail: { entryPhase: 'authorized' }, observedAt: at } };
    const encode = (value: unknown) => asRecord(ref, 'ControlIntentSnapshot@1', value);
    expect(decodeControlIntentSnapshot(encode(appliedPause))).toMatchObject({ status: 'decoded' });
    const unknownPause = { ...appliedPause, status: 'outcome_unknown', revision: 3, observation: { schemaVersion: 1,
      origin: 'platform_reconcile', kind: 'outcome_unknown', runRevision: 5, detail: { hostInstanceId: 'host-2', runOutcome: 'outcome_unknown' },
      observedAt: at } };
    expect(decodeControlIntentSnapshot(encode(unknownPause))).toMatchObject({ status: 'decoded' });
    const superseded = { ...appliedPause, status: 'superseded', observation: { schemaVersion: 1, origin: 'platform_superseded',
      kind: 'superseded_by_newer', runRevision: 4, detail: { supersededBy: intentRef('cancel-2') }, observedAt: at } };
    expect(decodeControlIntentSnapshot(encode(superseded))).toMatchObject({ status: 'decoded' });
    expect(decodeControlIntentSnapshot(encode({ ...superseded, observation: { ...superseded.observation,
      detail: { supersededBy: { ...intentRef('cancel-2'), workspaceId: 'other-workspace' } } } })).status).toBe('invalid');
    expect(decodeControlIntentSnapshot(encode({ ...appliedPause, kind: 'cancel', desiredState: 'cancelled' })).status).toBe('invalid');
    expect(decodeControlIntentSnapshot(encode({ ...appliedPause, observation: { ...appliedPause.observation,
      kernelEventId: 'k-1' } })).status).toBe('invalid');
    // CD-2 (relaxed in A.2 5.1, §7 CTL-03/CTL-06): a Kernel outcome_unknown and
    // terminal_without_cancel close any intent kind; a Kernel cancelled only a cancel.
    const kernel = { adapterId: 'adapter-1', kernelSessionId: 'kernel-session-1', runId: 'kernel-run-1', turnId: 'turn-1' };
    const kernelUnknown = { schemaVersion: 1, kind: 'outcome_unknown',
      entry: { consumerId: 'consumer-1', entryGeneration: 1, sessionGeneration: 0 },
      history: { schemaVersion: 1, sessionRef: { projectId: P, sessionId: 'session-1' }, kernel,
        startPosition: 1, observedThroughPosition: 5, endPosition: null },
      source: { ...kernel, position: 3 }, kernelEventId: 'kernel-event-3', kernelEventSequence: 3, observedAt: at };
    const kernelOn = (kind: string, desiredState: string, observation: Record<string, unknown>) =>
      decodeControlIntentSnapshot(encode({ ...appliedPause, kind, desiredState, status: 'outcome_unknown', observation })).status;
    expect(kernelOn('cancel', 'cancelled', kernelUnknown)).toBe('decoded');
    expect(kernelOn('pause', 'paused', kernelUnknown)).toBe('decoded');
    expect(kernelOn('pause', 'paused', { ...kernelUnknown, kind: 'terminal_without_cancel' })).toBe('decoded');
    expect(kernelOn('steer', 'steered', kernelUnknown)).toBe('decoded');
    expect(kernelOn('pause', 'paused', { ...kernelUnknown, kind: 'cancelled' })).toBe('invalid');
    const submitted = (intent: unknown) => controlIntentSubmittedEventFromEvent(asEvent({ eventId: 'ev-submit', eventType: 'ControlIntentSubmitted',
      schemaVersion: 1, occurredAt: at, identityKey: 'submit-1', actor: human, fingerprint: 'fp:submit-1',
      submitted: { intent, runRevision: 4 } }));
    expect(submitted(appliedPause).status).toBe('decoded');
    expect(submitted(unknownPause).status).toBe('invalid');
    expect(CONTROL_RECORD_SCHEMAS.events.map(entry => entry.eventType)).toContain('ControlIntentSubmitted');
  });

  it('reads ExecutionEntryAuthorized with and without activePlanRef (C6)', () => {
    const body: RawEvent = { eventId: 'ev-auth', eventType: 'ExecutionEntryAuthorized', schemaVersion: 1, occurredAt: at, identityKey: 'auth-1',
      actor: operator, fingerprint: 'fp:auth-1',
      permit: { claim: { runRef: runRef('run-2') }, consumerId: 'consumer-1', entryGeneration: 1, authorizationRevision: 1, inputDigest: sha('1') } };
    expect(executionEntryAuthorizedEventFromEvent(asEvent(body)).status).toBe('decoded');
    expect(executionEntryAuthorizedEventFromEvent(asEvent({ ...body, activePlanRef: { ...planRef, planId: 'plan-2' } })))
      .toMatchObject({ status: 'decoded', value: { activePlanRef: { ...planRef, planId: 'plan-2' } } });
    expect(executionEntryAuthorizedEventFromEvent(asEvent({ ...body, activePlanRef: { ...planRef, projectId: 'other-project' } })).status)
      .toBe('invalid');
  });

  it('rejects the compiler-owned dispositionRecord on a proposal draft (C7)', () => {
    const validate = PLAN_RECORD_SCHEMAS.records.find(schema => schema.aggregateType === 'PlanProposal')?.validate;
    if (validate === undefined) throw new Error('PlanProposal schema is not registered');
    const draft = { schemaVersion: 2, planId: 'plan-2', planRevision: 2, goalId: G, stages: [], tasks: [], obligations: [],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
    const proposalRef = { aggregateType: 'PlanProposal', projectId: P, workspaceId: W, proposalId: 'proposal-1' };
    const proposal = { kind: 'candidate_v2', ref: proposalRef, revision: 1, schemaVersion: 2,
      goalRef: { aggregateType: 'Goal', projectId: P, goalId: G }, basedOn: planRef, draft,
      reason: { text: 'split the module', sources: [] }, status: 'candidate', issues: [], catalogPin: null };
    const status = (value: unknown) => validate(asRecord(proposalRef, 'PlanProposal@2', value)).status;
    expect(status(proposal)).toBe('decoded');
    expect(status({ ...proposal, draft: { ...draft, dispositionRecord: { schemaVersion: 1, entries: [] } } })).toBe('invalid');
    expect(status({ ...proposal, reason: { text: 'split the module', sources: [], affectedTaskIds: ['not-a-draft-task'] } })).toBe('invalid');
  });
});

// ------------------------------------------------------------------------ //
// ModelRequest permit prompt facts and sequence (PC-1b, ruling 26)          //
// ------------------------------------------------------------------------ //
const modelPermitRef: ModelRequestPermitRef = { aggregateType: 'ModelRequestPermit', projectId: P, workspaceId: W, permitId: 'permit-1' };
function modelPrompt(): ModelRequestPromptFactsV1 & { maxOutputTokens: number } {
  return {
    systemDigest: sha('1'), toolsDigest: sha('2'),
    toolSpecsRef: artifact(sha('3'), PROMPT_TOOL_SPECS_CONTENT_TYPE),
    maxOutputTokens: 512,
    selection: { inputTokens: 128, budget: 128000,
      removed: { memory: 1, skillReference: 2, additionalInstruction: 3, toolResultBody: 4,
        historyExchange: 5, historyConclusion: 6, currentExchange: 7 } },
  };
}
function modelPermit(overrides: Partial<ModelRequestPermitV1> = {}): ModelRequestPermitV1 {
  return {
    schemaVersion: 1, permitId: modelPermitRef.permitId, runRef: runRef('run-1'), requestId: 'model-request-1',
    requestDigest: sha('4'), contextInputDigest: sha('5'), manifestDigest: sha('6'), deliveryRefs: [],
    permissions: { policyRevision: 'policy-1', tools: ['read'], writeScope: [] },
    prompt: modelPrompt(), sequence: 1, consumedByAttemptId: null, issuedAt: at, consumedAt: null,
    ...overrides,
  };
}
function modelPermitEvent(permit = modelPermit()): ModelRequestRecordedEvent {
  return { eventId: 'ev-model-1', eventType: MODEL_REQUEST_AUTHORIZED_EVENT_TYPE, schemaVersion: 1, occurredAt: at,
    identityKey: 'model-identity-1', actor: human, fingerprint: 'fp:model-1', permitRef: modelPermitRef,
    permit, runRevision: 4 };
}

describe('ModelRequest permit prompt facts and sequence (PC-1b, ruling 26)', () => {
  it('round-trips the prompt facts and sequence through the permit snapshot and the authorized event', () => {
    const snapshot = { ref: modelPermitRef, revision: 1 as const, schemaVersion: 1 as const, permit: modelPermit(), recordedAt: at };
    const encoded = encodeModelRequestPermitSnapshot(snapshot);
    expect(decodeModelRequestPermitSnapshot(encoded)).toEqual({ status: 'decoded', value: snapshot });
    expect(MODEL_REQUEST_RECORD_SCHEMAS.records[0]?.validate(encoded).status).toBe('decoded');
    // The Runtime may freeze a zero cap when the cumulative output is spent; the
    // codec accepts the number and the meter, not this codec, refuses the call.
    const zeroCap = { ...snapshot, permit: { ...snapshot.permit, prompt: { ...modelPrompt(), maxOutputTokens: 0 } } };
    expect(decodeModelRequestPermitSnapshot(encodeModelRequestPermitSnapshot(zeroCap))).toEqual({ status: 'decoded', value: zeroCap });
    // Consumption changes only the two consumption fields; the facts and sequence stay.
    const consumed = { ...snapshot, revision: 2 as const,
      permit: { ...snapshot.permit, consumedByAttemptId: 'attempt-1', consumedAt: at } };
    expect(decodeModelRequestPermitSnapshot(encodeModelRequestPermitSnapshot(consumed))).toEqual({ status: 'decoded', value: consumed });
    const event = modelPermitEvent();
    expect(modelRequestRecordedEventFromEvent(encodeModelRequestRecordedEvent(event))).toEqual({ status: 'decoded', value: event });
    expect(MODEL_REQUEST_RECORD_SCHEMAS.events[0]?.validate(encodeModelRequestRecordedEvent(event)).status).toBe('decoded');
  });

  it('rejects a missing, unknown or ill-typed prompt fact, sequence or selection field', () => {
    const snapshotOf = (permit: ModelRequestPermitV1) =>
      ({ ref: modelPermitRef, revision: 1 as const, schemaVersion: 1 as const, permit, recordedAt: at });
    const status = (permit: ModelRequestPermitV1) =>
      decodeModelRequestPermitSnapshot(encodeModelRequestPermitSnapshot(snapshotOf(permit))).status;
    const withPrompt = (patch: Record<string, unknown>) => modelPermit({ prompt: { ...modelPrompt(), ...patch } as ModelRequestPermitV1['prompt'] });
    const prompt = modelPrompt();
    expect(status(withPrompt({ extra: true }))).toBe('invalid');
    expect(status(withPrompt({ prompt: 1 }))).toBe('invalid');
    const { maxOutputTokens: _maxOutputTokens, ...withoutMax } = prompt;
    expect(status(modelPermit({ prompt: withoutMax as ModelRequestPermitV1['prompt'] }))).toBe('invalid');
    for (const maxOutputTokens of [-1, 1.5, '512', null]) {
      expect(status(withPrompt({ maxOutputTokens }))).toBe('invalid');
    }
    expect(status(withPrompt({ systemDigest: 'not-a-digest' }))).toBe('invalid');
    expect(status(withPrompt({ toolsDigest: sha('A') }))).toBe('invalid');
    expect(status(withPrompt({ toolSpecsRef: { ...prompt.toolSpecsRef, kind: 'other' } }))).toBe('invalid');
    expect(status(withPrompt({ selection: { ...prompt.selection, extra: true } }))).toBe('invalid');
    expect(status(withPrompt({ selection: { ...prompt.selection, removed: { ...prompt.selection.removed, extra: 1 } } }))).toBe('invalid');
    for (const key of Object.keys(prompt.selection.removed) as (keyof typeof prompt.selection.removed)[]) {
      expect(status(withPrompt({ selection: { ...prompt.selection,
        removed: { ...prompt.selection.removed, [key]: -1 } } })), key).toBe('invalid');
      expect(status(withPrompt({ selection: { ...prompt.selection,
        removed: { ...prompt.selection.removed, [key]: '1' } } })), key).toBe('invalid');
    }
    for (const inputTokens of [-1, 1.5, '128']) {
      expect(status(withPrompt({ selection: { ...prompt.selection, inputTokens } }))).toBe('invalid');
    }
    const { budget: _budget, ...withoutBudget } = prompt.selection;
    expect(status(withPrompt({ selection: withoutBudget }))).toBe('invalid');
    for (const budget of [-1, 1.5, '2000', null]) {
      expect(status(withPrompt({ selection: { ...prompt.selection, budget } }))).toBe('invalid');
    }
    // Nested unknown keys: the tool-spec ref and its source accept exactly
    // their own fields in the snapshot, the event and the authorization input.
    const refExtra = { ...prompt, toolSpecsRef: { ...prompt.toolSpecsRef, extra: true } };
    const sourceExtra = { ...prompt,
      toolSpecsRef: { ...prompt.toolSpecsRef, source: { ...prompt.toolSpecsRef.source, extra: true } } };
    expect(status(modelPermit({ prompt: refExtra }))).toBe('invalid');
    expect(status(modelPermit({ prompt: sourceExtra }))).toBe('invalid');
    for (const sequence of [0, -1, 1.5, null]) {
      expect(status(modelPermit({ sequence: sequence as number }))).toBe('invalid');
    }
    expect(status(modelPermit({ extra: true } as unknown as Partial<ModelRequestPermitV1>))).toBe('invalid');
    const eventStatus = (permit: ModelRequestPermitV1) =>
      modelRequestRecordedEventFromEvent(encodeModelRequestRecordedEvent(modelPermitEvent(permit))).status;
    expect(eventStatus(modelPermit({ prompt: undefined } as unknown as ModelRequestPermitV1))).toBe('invalid');
    expect(eventStatus(modelPermit({ sequence: 0 }))).toBe('invalid');
    expect(eventStatus(modelPermit({ prompt: { ...prompt, selection: withoutBudget } as ModelRequestPermitV1['prompt'] })))
      .toBe('invalid');
    for (const budget of [-1, '2000']) {
      expect(eventStatus(modelPermit({ prompt: { ...prompt,
        selection: { ...prompt.selection, budget } } as ModelRequestPermitV1['prompt'] }))).toBe('invalid');
    }
    expect(eventStatus(modelPermit({ prompt: refExtra as ModelRequestPermitV1['prompt'] }))).toBe('invalid');
    expect(eventStatus(modelPermit({ prompt: sourceExtra as ModelRequestPermitV1['prompt'] }))).toBe('invalid');
  });
});
