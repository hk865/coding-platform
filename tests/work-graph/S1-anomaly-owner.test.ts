/**
 * Slice 1 service rows SV26–SV29 (spec §5.3), run on both backends.
 *
 * The only new formal aggregate is `SessionAnomalyAnchor@1`: one immutable
 * anchor per Run, keyed by the full RunRef identity (not taskId, not
 * requestId). The owner is `tasks/session-anomaly-service.ts`. Every branch
 * reaches the owner through its real methods over the real RecordStore and
 * builds its row's given first (CORRECTION G1):
 *
 *  - the Run is claimed and then really stopped through the formal
 *    execution-result entry (an archive cancel is a `run_cancelled` terminal
 *    observation, DESIGN §4.5);
 *  - the archive request is registered through the new
 *    `requestSessionArchive` owner, whose recorded receipt (not a fabricated
 *    one) is what every `ArchiveStepRefV1` carries;
 *  - SV29's Task is satisfied through the real verification/`completeTask`
 *    path on the R3e evidence fixture.
 *
 * The new production bodies are stubs, so the rows are RED at their first
 * new-owner call. G2: the backend registers every bundle the real path reads
 * or writes (`SESSION_LIFECYCLE_RECORD_SCHEMAS` for the request/link writes,
 * `SESSION_ANOMALY_RECORD_SCHEMAS` for the anchor and its two lookups, and
 * `COMPLETION_RECORD_SCHEMAS` for SV29). G3: the owner's clock is the injected
 * `t0`/`t1`, never `B2_AT`. G4: the SQLite row runs the
 * `tests/state/invariants.ts` checker after every real mutation. G5: a failing
 * step throws its own message; there is no early `return` and no `.every` over
 * a possibly empty array.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type {
  ArchiveStepRefV1, RequestSessionArchiveInput, SessionArchiveRequestV1,
} from '../../src/contracts/core/session-archive.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { ArchiveChangedFilesV1 } from '../../src/contracts/session-anomaly.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { CheckProcessObservation } from '../../src/contracts/verification.js';
import type { EncodedRecord, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import {
  SESSION_ANOMALY_BY_GOAL_LOOKUP, SESSION_ANOMALY_BY_TASK_LOOKUP,
} from '../../src/core/work-graph/model/session-facts-contracts.js';
import {
  createSessionAnomalyService, type SessionAnomalyPort,
} from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import type { SessionLifecyclePort } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { taskRequeueRefKey } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import {
  createB2ExecutionFixture, type B2ExecutionFixture, type B2Records,
} from '../helpers/B2-execution-fixture.js';
import { createR3eEvidenceFixture, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';
import type { ClaimFixtureKind, TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { checkAllInvariants, invariantStoreOf, readInvariantWorld } from '../state/invariants.js';

/** Frozen service-fixture clock values (spec §5.1); `B2_AT` is NOT `t0`. */
const t0 = '2026-10-08T00:00:00.000Z';
const t1 = '2026-10-09T00:00:00.000Z';

/** G2: every bundle the real path writes/reads. */
const S1_ANOMALY_ADDITIONAL_SCHEMAS: RecordBackendSchemas = {
  records: [...SESSION_LIFECYCLE_RECORD_SCHEMAS.records, ...SESSION_ANOMALY_RECORD_SCHEMAS.records,
    ...COMPLETION_RECORD_SCHEMAS.records],
  events: [...SESSION_LIFECYCLE_RECORD_SCHEMAS.events, ...SESSION_ANOMALY_RECORD_SCHEMAS.events,
    ...COMPLETION_RECORD_SCHEMAS.events],
  lookups: [...(SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? []),
    ...(COMPLETION_RECORD_SCHEMAS.lookups ?? [])],
};

type ArchiveOverrides = Partial<Omit<RequestSessionArchiveInput, 'sessionRef'>>;
type RequestReceipt = SessionArchiveRequestV1['receipt'];

type Opened = {
  b2: B2ExecutionFixture;
  /** Non-null only for SV29: the real verification/completion path. */
  r3e: R3eEvidenceFixture | null;
  base: TaskClaimFixture;
  records: B2Records;
  anomaly: SessionAnomalyPort;
  lifecycle: SessionLifecyclePort;
  directory: string;
  goalRef: GoalRef;
  /** Task A (`implement-a`), owned by Session S and Run r0. */
  task: TaskTriple;
  /** Run r0 (Task A, Session S). */
  run: RunRef;
  /** Source Session S. */
  session: SessionRef;
  hostCtx(): CoreCallContext;
  setNow(value: string): void;
  step(ref: SessionRef, requestId: string, receipt: RequestReceipt,
    kind: ArchiveStepRefV1['step'], subject: JsonValue): ArchiveStepRefV1;
  files(overrides?: Partial<ArchiveChangedFilesV1>): ArchiveChangedFilesV1;
  page(): { limit: number };
  /** The formal entry path that ends r0 as a cancelled (archive-stopped) Run. */
  stopRun(): Promise<void>;
  archiveRequest(ref: SessionRef, requestId: string, overrides?: ArchiveOverrides):
    Promise<GraphWrite<RequestSessionArchiveInput>>;
  registerArchive(request: GraphWrite<RequestSessionArchiveInput>): Promise<SessionArchiveRequestV1>;
  finishArchive(ref: SessionRef, request: SessionArchiveRequestV1): Promise<void>;
  /** SV29: the Session of the R3e subject Run. */
  subjectSession(): Promise<SessionRef>;
  /** SV29: satisfy the R3e work Task through the real round + completion path. */
  satisfyR3eWork(): Promise<void>;
  /** The anchor records actually stored, by the goal or task index (never the list result). */
  storedAnchors(goalRef: GoalRef, taskId?: string): Promise<EncodedRecord[]>;
  /** G4: the §11 invariants over the SQLite ledger; the memory backend has no read window. */
  invariantsHold(label: string): Promise<void>;
  close(): Promise<void>;
};

const opened: Opened[] = [];
afterEach(async () => {
  for (const fixture of opened.splice(0)) await fixture.close();
});

/** A real observed PASS check at the row clock (the R3e fixture's source of truth). */
function passObservation(): CheckProcessObservation {
  const text = 'S1_ANOMALY_OK\n';
  return { kind: 'executed', startedAt: t0, finishedAt: t0, exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 's1-anomaly-revision-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

/**
 * The backend is opened exactly as `tests/work-graph/A2-requeue-service.test.ts:74`
 * opens it, with the slice-1 registrations (G2). `withCompletion` composes the
 * real R3e evidence fixture over the same store for SV29's satisfied Task.
 */
async function open(kind: ClaimFixtureKind, withCompletion = false): Promise<Opened> {
  const r3e = withCompletion ? await createR3eEvidenceFixture(kind, S1_ANOMALY_ADDITIONAL_SCHEMAS) : null;
  const b2 = r3e === null ? await createB2ExecutionFixture(kind, S1_ANOMALY_ADDITIONAL_SCHEMAS) : r3e.b2;
  const base = b2.base;
  const records = base.records;
  let clock = t0;
  const now = () => clock;
  const sessionFacts = createSessionFactsService({ records });
  const anomaly = createSessionAnomalyService({ records, lookups: records, sessionFacts, now });
  const lifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts });
  const reads = createRunStateReader({ records });
  const session: SessionRef = { projectId: base.scope.projectId, sessionId: base.sessions.first.sessionId };

  async function stopRun(): Promise<void> {
    const admitted = await b2.enter();
    const kernel = await b2.kernelFor(b2.claim);
    const cancelled = b2.terminalEvent({ eventType: 'run_cancelled', eventId: 's1-anomaly-run-cancelled',
      payload: { kind: 'cancelled', reason: 'the operator archive stopped this execution' } });
    const ended = await b2.entry.recordRunResult(base.ctx, {
      input: { claim: b2.claim,
        entry: { consumerId: admitted.permit.consumerId, entryGeneration: admitted.permit.entryGeneration },
        event: cancelled,
        kernelSource: { ...kernel, position: 4 },
        completedHistoryBoundary: { source: { ...kernel, position: 4 }, cursor: 's1-anomaly-boundary-4' },
        history: { kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 } },
      meta: { requestId: 's1-anomaly-stop-run', expected: [await b2.runPin()] },
    });
    expect(ended, 'the archive stop ends r0 as cancelled').toMatchObject({ status: 'committed', value: { outcome: 'cancelled' } });
    if (ended.status !== 'committed') throw new Error(`r0 was not stopped: ${JSON.stringify(ended)}`);
  }

  async function archiveRequest(ref: SessionRef, requestId: string, overrides: ArchiveOverrides = {}): Promise<GraphWrite<RequestSessionArchiveInput>> {
    return { input: { sessionRef: ref,
        reason: overrides.reason ?? 'the operator archives this line',
        tasks: overrides.tasks ?? [], wait: overrides.wait ?? null,
        confirmUnknownStopped: overrides.confirmUnknownStopped ?? false,
        ...(overrides.mode === undefined ? {} : { mode: overrides.mode }) },
      meta: { requestId, expected: [await base.sessionPin(ref)] } };
  }

  async function registerArchive(request: GraphWrite<RequestSessionArchiveInput>): Promise<SessionArchiveRequestV1> {
    const registered = await lifecycle.requestSessionArchive(base.ctx, request);
    expect(registered, 'the archive request is registered').toMatchObject({ status: 'committed' });
    if (registered.status !== 'committed') throw new Error(`the archive request was not registered: ${JSON.stringify(registered)}`);
    const recorded = registered.value.archiveRequest;
    if (recorded === null || recorded === undefined) throw new Error('the registered Session has no archive request');
    return recorded;
  }

  async function finishArchive(ref: SessionRef, request: SessionArchiveRequestV1): Promise<void> {
    const archiveStep: ArchiveStepRefV1 = { sessionRef: ref, archiveRequestId: request.requestId,
      requestReceipt: request.receipt, step: 'archive', subjectKey: canonicalJson(ref as unknown as JsonValue) };
    const finished = await lifecycle.finishSessionArchive(base.ctx, archiveStep);
    expect(finished, 'the final archive commits').toMatchObject({ status: 'committed', value: { lifecycle: 'archived' } });
    if (finished.status !== 'committed') throw new Error(`the final archive did not commit: ${JSON.stringify(finished)}`);
  }

  async function subjectSession(): Promise<SessionRef> {
    if (r3e === null) throw new Error('the completion fixture was not opened');
    const read = await reads.readExecution(r3e.ctx, r3e.subjectRunRef);
    if (read.status !== 'ready') throw new Error(`the R3e subject Run read failed: ${JSON.stringify(read)}`);
    return read.value.session.ref;
  }

  async function satisfyR3eWork(): Promise<void> {
    if (r3e === null) throw new Error('the completion fixture was not opened');
    const openedRound = await r3e.evidence.openVerification(r3e.ctx, r3e.openRequest());
    if (openedRound.status !== 'committed') throw new Error(`the verification round did not open: ${JSON.stringify(openedRound)}`);
    let round = openedRound.value;
    for (const check of round.checks) {
      const begun = await r3e.evidence.beginCheck(r3e.ctx, r3e.beginRequest(round, check.checkId));
      if (begun.status !== 'committed') throw new Error(`check ${check.checkId} did not begin: ${JSON.stringify(begun)}`);
      const latest = await r3e.evidence.readVerification(r3e.ctx, round.ref);
      if (latest.status !== 'ready') throw new Error(`the round read failed: ${JSON.stringify(latest)}`);
      round = latest.value;
      const recorded = await r3e.evidence.recordCheckResult(r3e.ctx,
        r3e.recordRequest(round, check.checkId, begun.value.invocationId, passObservation()));
      if (recorded.status !== 'committed') throw new Error(`check ${check.checkId} was not recorded: ${JSON.stringify(recorded)}`);
      round = recorded.value;
    }
    const finalized = await r3e.evidence.finalizeChecks(r3e.ctx, r3e.finalizeRequest(round));
    expect(finalized, 'the formal round finalizes PASS').toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
    if (finalized.status !== 'committed') throw new Error(`the round did not finalize: ${JSON.stringify(finalized)}`);
    const goalRead = await r3e.b2.base.plans.queryGoal(r3e.ctx, r3e.goalRef);
    if (goalRead.status !== 'ready') throw new Error(`the completion Goal read failed: ${JSON.stringify(goalRead)}`);
    const reductionRef = { aggregateType: 'TaskReduction' as const, projectId: r3e.scope.projectId,
      goalId: r3e.goalRef.goalId, taskId: r3e.subject.taskId };
    const completed = await r3e.b2.base.goals.completeTask(r3e.ctx, {
      input: { taskRef: r3e.subject, planRef: r3e.planRef, roundRef: finalized.value.snapshot.ref },
      meta: { requestId: 's1-anomaly-satisfy-work', expected: [
        { ref: r3e.goalRef, revision: goalRead.value.goal.revision },
        { ref: reductionRef, revision: 0 }] } });
    expect(completed, 'the work Task satisfies').toMatchObject({ status: 'committed', value: { phase: 'satisfied' } });
    if (completed.status !== 'committed') throw new Error(`the work Task was not satisfied: ${JSON.stringify(completed)}`);
  }

  async function storedAnchors(goalRef: GoalRef, taskId?: string): Promise<EncodedRecord[]> {
    const values = taskId === undefined
      ? [base.scope.projectId, base.scope.workspaceId, goalRef.goalId]
      : [base.scope.projectId, base.scope.workspaceId, goalRef.goalId, taskId];
    const index = taskId === undefined ? SESSION_ANOMALY_BY_GOAL_LOOKUP : SESSION_ANOMALY_BY_TASK_LOOKUP;
    const found = await records.lookup({ index, values, limit: 100 });
    if (found.status !== 'ready') throw new Error(`the ${index} lookup failed: ${JSON.stringify(found)}`);
    return found.value.records;
  }

  async function invariantsHold(label: string): Promise<void> {
    if (base.kind !== 'sqlite') return;
    const world = await readInvariantWorld(invariantStoreOf(base.directory), base.scope.projectId);
    expect(checkAllInvariants(world), `${label}: invariant violations`).toEqual([]);
  }

  const fixture: Opened = {
    b2, r3e, base, records, anomaly, lifecycle, directory: base.directory,
    goalRef: base.goalRef, task: base.tasks.first, run: b2.claim.runRef, session,
    hostCtx(): CoreCallContext {
      const actor = { kind: 'human' as const, id: 's1-anomaly-operator' };
      return { projectId: base.scope.projectId, workspaceId: base.scope.workspaceId,
        principal: { kind: 'host', actor },
        materialReader: { kind: 'host', projectId: base.scope.projectId, workspaceId: base.scope.workspaceId, actor },
        signal: new AbortController().signal };
    },
    setNow(value: string) { clock = value; },
    step(ref, requestId, receipt, kind, subject): ArchiveStepRefV1 {
      return { sessionRef: ref, archiveRequestId: requestId, requestReceipt: receipt,
        step: kind, subjectKey: canonicalJson(subject) };
    },
    files(overrides = {}): ArchiveChangedFilesV1 {
      return { source: 'kernel', status: 'known', confirmed: [], possible: [], omitted: 0,
        baseCommit: null, runBaselineKnown: false, reason: null, ...overrides };
    },
    page() { return { limit: 20 }; },
    stopRun, archiveRequest, registerArchive, finishArchive, subjectSession, satisfyR3eWork,
    storedAnchors, invariantsHold,
    close: r3e === null ? () => b2.close() : () => r3e.close(),
  };
  opened.push(fixture);
  return fixture;
}

const RUN_ID = (f: Opened) => f.run.runId;

describe.each(['memory', 'sqlite'] as const)('the Session anomaly owner (%s)', (kind) => {
  it('SV26 r0 was stopped by an archive: a repeat write with the same or another request has exactly one anchor; '
    + 'the original recordedAt, files and receipt stay, and the second call replays the original record and cursor', async () => {
    const f = await open(kind);
    await f.stopRun();
    await f.invariantsHold('after r0 was stopped by the archive');
    // G1: the archive request really exists; its recorded receipt is the one
    // every step carries.
    const request = await f.registerArchive(await f.archiveRequest(f.session, 'a'));
    const first = await f.anomaly.recordSessionAnomaly(f.hostCtx(), {
      step: f.step(f.session, request.requestId, request.receipt, 'anchor', f.run as unknown as JsonValue),
      files: f.files() });
    expect(first).toMatchObject({ status: 'committed', replayed: false,
      value: { revision: 1, ref: { runId: RUN_ID(f) }, recordedAt: t0,
        archiveRequestReceipt: request.receipt,
        changedFiles: { source: 'kernel', status: 'known', confirmed: [], possible: [] } } });
    if (first.status !== 'committed') throw new Error(JSON.stringify(first));
    const original = first.value;
    await f.invariantsHold('after the first anchor');
    // The final archive clears the original durable request; the second call
    // uses another request id and only the same Run identity.
    await f.finishArchive(f.session, request);
    await f.invariantsHold('after the final archive cleared the original request');
    // The repeat happens on the next day; the original recordedAt must stay t0.
    f.setNow(t1);
    const replay = await f.anomaly.recordSessionAnomaly(f.hostCtx(),
      { step: f.step(f.session, 'b', { identityKey: 'b-identity', fingerprint: 'b-fingerprint' }, 'anchor',
          f.run as unknown as JsonValue),
        files: f.files({ source: 'worktree', status: 'partial', possible: ['src/other.ts'], reason: 'another read' }) });
    expect(replay).toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor, value: original });
    expect(await f.storedAnchors(f.goalRef, f.task.taskId)).toHaveLength(1);
  });

  it('SV27 neither the Kernel read nor the workspace capture is available: unknown/unavailable, empty arrays, '
    + 'a non-empty reason, and still exactly one anchor', async () => {
    const f = await open(kind);
    await f.stopRun();
    await f.invariantsHold('after r0 was stopped by the archive');
    const request = await f.registerArchive(await f.archiveRequest(f.session, 'a'));
    const written = await f.anomaly.recordSessionAnomaly(f.hostCtx(), {
      step: f.step(f.session, request.requestId, request.receipt, 'anchor', f.run as unknown as JsonValue),
      files: f.files({ source: 'unknown', status: 'unavailable', confirmed: [], possible: [],
        reason: 'the Kernel window is unreadable' }) });
    expect(written).toMatchObject({ status: 'committed', value: { revision: 1, changedFiles: {
      source: 'unknown', status: 'unavailable', confirmed: [], possible: [], omitted: 0,
      runBaselineKnown: false, reason: 'the Kernel window is unreadable' } } });
    await f.invariantsHold('after the unknown-changes anchor');
    expect(await f.storedAnchors(f.goalRef, f.task.taskId)).toHaveLength(1);
  });

  it('SV28 the formal Task and Goal indexes read the same anchor: both return the identical ref/body and there is no second record', async () => {
    const f = await open(kind);
    await f.stopRun();
    await f.invariantsHold('after r0 was stopped by the archive');
    const request = await f.registerArchive(await f.archiveRequest(f.session, 'a'));
    const written = await f.anomaly.recordSessionAnomaly(f.hostCtx(), {
      step: f.step(f.session, request.requestId, request.receipt, 'anchor', f.run as unknown as JsonValue),
      files: f.files() });
    if (written.status !== 'committed') throw new Error(`the anchor did not commit: ${JSON.stringify(written)}`);
    await f.invariantsHold('after the anchor');
    const byGoal = await f.anomaly.listSessionAnomalies(f.hostCtx(), { goalRef: f.goalRef, page: f.page() });
    const byTask = await f.anomaly.listSessionAnomalies(f.hostCtx(),
      { goalRef: f.goalRef, taskId: f.task.taskId, page: f.page() });
    expect(byGoal).toMatchObject({ status: 'ready' });
    expect(byTask).toMatchObject({ status: 'ready' });
    if (byGoal.status !== 'ready' || byTask.status !== 'ready') throw new Error('both indexes must read');
    expect(byTask.value.items).toHaveLength(1);
    expect(byGoal.value.items).toHaveLength(1);
    expect(byTask.value.items[0]?.anchor).toEqual(byGoal.value.items[0]?.anchor);
    expect(byTask.value.items[0]?.anchor).toEqual(written.value);
    // The store itself holds exactly one record on each index, not only the list.
    expect(await f.storedAnchors(f.goalRef)).toHaveLength(1);
    expect(await f.storedAnchors(f.goalRef, f.task.taskId)).toHaveLength(1);
  });

  it('SV29 a stopped Run whose Task is already satisfied is invalid, writes no anchor and does not requeue the satisfied Task', async () => {
    const f = await open(kind, true);
    const r3e = f.r3e;
    if (r3e === null) throw new Error('the completion fixture was not opened');
    // G1: the Task is satisfied before the archive tries to record the
    // interruption, through the real verification + completion path.
    await f.satisfyR3eWork();
    await f.invariantsHold('after the Task was satisfied');
    const subjectSession = await f.subjectSession();
    const request = await f.registerArchive(await f.archiveRequest(subjectSession, 'a',
      { tasks: [{ target: { kind: 'task', ref: r3e.subject }, disposition: { kind: 'drop' } }] }));
    const result = await f.anomaly.recordSessionAnomaly(f.hostCtx(), {
      step: f.step(subjectSession, request.requestId, request.receipt, 'anchor',
        r3e.subjectRunRef as unknown as JsonValue),
      files: f.files() });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    const listed = await f.anomaly.listSessionAnomalies(f.hostCtx(),
      { goalRef: r3e.goalRef, taskId: r3e.subject.taskId, page: f.page() });
    expect(listed).toMatchObject({ status: 'ready', value: { items: [] } });
    // §3.5: with no pending view the label and the next step are both null; the
    // satisfied Task is never read back as "waiting for dispatch".
    const archiveState = await f.anomaly.readTaskArchiveState(f.hostCtx(), r3e.subject);
    expect(archiveState).toMatchObject({ status: 'ready', value: { pending: [], label: null, next: null } });
    expect(await f.storedAnchors(r3e.goalRef, r3e.subject.taskId)).toHaveLength(0);
    // No TaskRequeue was written for the satisfied Task's covered Run.
    const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: r3e.scope.projectId,
      goalId: r3e.goalRef.goalId, taskId: r3e.subject.taskId, afterRunId: r3e.subjectRunRef.runId };
    const requeue = await f.records.readMany([taskRequeueRefKey(requeueRef)]);
    expect(requeue, 'the satisfied Task has no requeue record').toMatchObject({ status: 'ready',
      value: { missing: [taskRequeueRefKey(requeueRef)] } });
    await f.invariantsHold('after the refused anchor for a satisfied Task');
  });
});
