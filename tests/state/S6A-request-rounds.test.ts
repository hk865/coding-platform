/**
 * 6A-1 group S: the pure round constructors of `W/state/request-rounds.ts`
 * (book-6a §3.6.1-3, §3.12's 6A-1 block, spec L1's routing-round rule).
 *
 * A5: a pure file. It imports no store, platform, Host, Workflow, Runtime or
 * stub port; every expected value is a literal from the book/spec or a
 * hand-computed example.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { VersionedRef } from '../../src/contracts/ledger.js';
import type {
  PendingQueryJobSnapshot,
  QueryJobIntentV1,
  QueryJobRef,
  QueryJobSnapshot,
  QueryRunRef,
  QueryRunSnapshot,
  QuerySubmissionBindingV1,
  RequestCommandReceiptV1,
} from '../../src/contracts/query-job.js';
import {
  absorbRound,
  endUnstartedRound,
  newAttempt,
  newRequestRound,
  newRoutingRound,
  recordAbsorbedRounds,
  recordEntered,
  setIntake,
} from '../../src/core/work-graph/state/request-rounds.js';
import type { PendingQueryLifecycleRecords, QueryExecutionStep, QueryLifecycleRecords } from '../../src/core/work-graph/state/query-run-recovery.js';
import { advanceQueryExecutionRecord } from '../../src/core/work-graph/state/query-run-recovery.js';

const SCOPE = { projectId: 'p1', workspaceId: 'w1' } as const;
const AT = '2026-10-23T00:00:00.000Z';
const SUBMITTED_AT = '2026-10-23T00:00:00.000Z';
/** A commit cursor the platform issued (opaque, zero-padded ten-digit sequence). */
const BOUND_SINCE = 'c00000000042' as CommitCursor;
const JOB_REF: QueryJobRef = { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-root' };
const RUN_REF: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-root', runId: 'qr-root' };
const SESSION_A: SessionRef = { projectId: 'p1', sessionId: 'sA' };
const SESSION_B: SessionRef = { projectId: 'p1', sessionId: 'sB' };
const INTENT = { schemaVersion: 1, intentId: 'intent-1', correlationId: 'corr-1', question: 'what next?' } as unknown as QueryJobIntentV1;
const SUBMISSION: QuerySubmissionBindingV1 = { schemaVersion: 1, identityKey: 'submit-key', fingerprint: 'f'.repeat(64), eventId: 'evt-1' };
const CARD_REF: VersionedRef = { ref: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-card' }, revision: 2 };
const RECEIPT: RequestCommandReceiptV1 = {
  kind: 'submit', requestRoot: JOB_REF, round: JOB_REF, assignment: 'assigned', secretary: SESSION_A, created: true,
};

function requestRound(overrides: Partial<Parameters<typeof newRequestRound>[0]> = {}): PendingQueryLifecycleRecords {
  return newRequestRound({
    queryJobId: 'qj-root', runId: 'qr-root', scope: SCOPE, intent: INTENT, kind: 'request', requestRoot: null,
    requestGoalId: 'g1', assignedSession: SESSION_A, intakeSession: SESSION_A, selectedIdea: null,
    relatedCardRefs: [CARD_REF], receipt: RECEIPT, submission: SUBMISSION, submittedAt: SUBMITTED_AT, ...overrides,
  });
}

/** The owner reads records back; only then does a transition see a bound `since`. */
function bound(records: PendingQueryLifecycleRecords): QueryLifecycleRecords {
  return { job: { ...records.job, since: BOUND_SINCE }, run: records.run };
}

/** A Job with every request field except `absorbedRounds` unchanged, bound for a transition. */
function boundJob(overrides: Partial<QueryJobSnapshot['job']> = {}): QueryJobSnapshot {
  const records = bound(requestRound());
  return { ...records.job, job: { ...records.job.job, ...overrides } };
}

describe('newRequestRound', () => {
  it('writes the pending root round: self requestRoot, every request field and since null', () => {
    const records = requestRound();
    expect(records.job).toEqual({
      ref: JOB_REF, revision: 1, schemaVersion: 1, submission: SUBMISSION, since: null,
      job: {
        schemaVersion: 1, queryJobId: 'qj-root', projectId: 'p1', workspaceId: 'w1', goalId: 'g1', intent: INTENT,
        status: 'pending', runRef: RUN_REF, answerRefs: [], closeReason: null,
        submittedAt: SUBMITTED_AT, updatedAt: SUBMITTED_AT,
        requestRoot: JOB_REF, roundKind: 'request', requestGoalId: 'g1', assignedSession: SESSION_A,
        routing: null, relatedMessageRef: null, absorbedInto: null, absorbedRounds: [], selectedIdea: null,
        goalAttribution: null, relatedCardRefs: [CARD_REF], enteredSession: null, intakeSession: SESSION_A,
        receipt: RECEIPT,
      },
    } satisfies PendingQueryJobSnapshot);
    expect(records.run).toEqual({
      ref: RUN_REF, revision: 1, schemaVersion: 1,
      run: { schemaVersion: 1, queryJobRef: JOB_REF, runId: 'qr-root', status: 'pending', startedAt: null, endedAt: null, outcome: null },
    } satisfies QueryRunSnapshot);
    expect(records.job.ref).not.toBe(JOB_REF);
    expect(records.run.ref).not.toBe(RUN_REF);
    expect(records.run.run.queryJobRef).toEqual(records.job.ref);
  });

  it('writes a follow-up on the given root, carrying the selected idea and no intake', () => {
    const root = requestRound();
    const follow = requestRound({
      queryJobId: 'qj-follow', runId: 'qr-follow', kind: 'followup', requestRoot: root.job.ref, assignedSession: null,
      intakeSession: null, selectedIdea: { round: JOB_REF, index: 1 },
    });
    expect(follow.job.job.requestRoot).toEqual(root.job.ref);
    expect(follow.job.job.roundKind).toBe('followup');
    expect(follow.job.job.requestGoalId).toBe('g1');
    expect(follow.job.job.assignedSession).toBeNull();
    expect(follow.job.job.intakeSession).toBeNull();
    expect(follow.job.job.selectedIdea).toEqual({ round: JOB_REF, index: 1 });
    expect(follow.job.job.status).toBe('pending');
    expect(follow.run.run.status).toBe('pending');
  });
});

describe('newRoutingRound', () => {
  it('writes spec L1 terminal routing round: no run, closed not_entered with detail null', () => {
    const root = bound(requestRound()).job;
    const routing = newRoutingRound({
      queryJobId: 'qj-routing', scope: SCOPE, root, routing: { from: null, to: SESSION_B, reason: 'assigned' },
      receipt: null, submission: SUBMISSION, submittedAt: SUBMITTED_AT,
    });
    expect(routing.ref).toEqual({ aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-routing' });
    expect(routing.revision).toBe(1);
    expect(routing.since).toBeNull();
    expect(routing.job).toEqual({
      schemaVersion: 1, queryJobId: 'qj-routing', projectId: 'p1', workspaceId: 'w1', goalId: 'g1', intent: INTENT,
      status: 'closed', runRef: null, answerRefs: [],
      closeReason: { code: 'not_entered', message: 'routing_round_created_closed', detail: null },
      submittedAt: SUBMITTED_AT, updatedAt: SUBMITTED_AT,
      requestRoot: JOB_REF, roundKind: 'routing', requestGoalId: 'g1', assignedSession: null,
      routing: { from: null, to: SESSION_B, reason: 'assigned' },
      relatedMessageRef: null, absorbedInto: null, absorbedRounds: [], selectedIdea: null,
      goalAttribution: null, relatedCardRefs: [], enteredSession: null, intakeSession: null, receipt: null,
    });
    // A routing round never creates a QueryRun: the constructor returns one Job snapshot.
    expect(routing.job.runRef).toBeNull();
  });
});

describe('endUnstartedRound', () => {
  it('ends a dropped unstarted round: Job cancelled/dropped, Run closed not_entered', () => {
    const before = bound(requestRound());
    const after = endUnstartedRound(before, { detail: 'dropped', message: 'the request was dropped', occurredAt: AT });
    expect(after.job.revision).toBe(before.job.revision + 1);
    expect(after.job.job.status).toBe('closed');
    expect(after.job.job.closeReason).toEqual({ code: 'cancelled', message: 'the request was dropped', detail: 'dropped' });
    // No other Job field changes (a stray absorbedInto would show here).
    expect(after.job.job).toEqual({ ...before.job.job, status: 'closed', closeReason: { code: 'cancelled', message: 'the request was dropped', detail: 'dropped' }, updatedAt: AT });
    expect(after.run.revision).toBe(before.run.revision + 1);
    expect(after.run.run.status).toBe('closed');
    expect(after.run.run.outcome).toBe('not_entered');
    expect(after.run.run.endedAt).toBe(AT);
    // The pending Run had no execution state; the constructor invents none.
    expect(after.run.run).not.toHaveProperty('executionState');
  });

  it('ends an unbound unstarted round with detail no_binding', () => {
    const after = endUnstartedRound(bound(requestRound()), { detail: 'no_binding', message: 'no secretary binding', occurredAt: AT });
    expect(after.job.job.closeReason).toEqual({ code: 'cancelled', message: 'no secretary binding', detail: 'no_binding' });
    expect(after.run.run.outcome).toBe('not_entered');
  });
});

/** QRR-02's real prior state comes from the same state module: claim → prepare → entering. */
const QRR_BUNDLE = {
  kind: 'artifact' as const, contentType: 'application/json', digest: 'b'.repeat(64), sizeBytes: 42,
  source: { kind: 'workspace' as const, refId: 'w1', revision: '1' },
};
const QRR_CLAIM: Extract<QueryExecutionStep, { phase: 'claimed' }> = {
  phase: 'claimed',
  claim: {
    sessionRef: SESSION_A, sessionGeneration: 1,
    role: { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' },
    roleBinding: { schemaVersion: 1, bindingId: 'b1', templateId: 'tpl', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'pol-1' },
    roleResolution: { status: 'absent', roleId: 'role-1', reason: 'no role spec' },
    priorHistoryCursor: null,
    requestProfile: null,
  },
};
const QRR_PREPARED: Extract<QueryExecutionStep, { phase: 'prepared' }> = {
  phase: 'prepared',
  prepared: { bundleRef: QRR_BUNDLE, inputDigest: 'i'.repeat(64) },
};
const QRR_ENTERING: Extract<QueryExecutionStep, { phase: 'entering' }> = {
  phase: 'entering',
  entry: {
    generation: 1, consumerId: 'consumer-1', hostConfigurationRevision: 'cfg-1',
    permissions: { tools: ['read'], writeScope: [] },
    budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 },
    kernel: { adapterId: 'adapter-1', kernelSessionId: 'kernel-session-1', runId: 'kernel-run-1', turnId: 'turn-1' },
  },
  request: { runRef: RUN_REF, bundleRef: QRR_BUNDLE, question: 'what next?', budget: { maxTokens: null } },
  occurredAt: AT,
};

function enteringAttempt(records: QueryLifecycleRecords): QueryLifecycleRecords {
  return advanceQueryExecutionRecord(
    advanceQueryExecutionRecord(advanceQueryExecutionRecord(records, QRR_CLAIM), QRR_PREPARED),
    QRR_ENTERING,
  );
}

describe('newAttempt', () => {
  it('abandons the old not_entered Run and moves runRef to a deterministic new pending Run', () => {
    const before = bound(requestRound());
    const first = newAttempt(before, { trigger: 'owner_changed', occurredAt: AT });
    expect(first.oldRun.run.status).toBe('closed');
    expect(first.oldRun.run.outcome).toBe('not_entered');
    expect(first.oldRun.run.endedAt).toBe(AT);
    expect(first.oldRun.revision).toBe(before.run.revision + 1);
    expect(first.job.revision).toBe(before.job.revision + 1);
    expect(first.job.job.status).toBe('pending');
    expect(first.job.job.runRef).toEqual(first.newRun.ref);
    // The whole new pending Run, with only its derived id taken out: a pending
    // Run carries no execution fields, so any extra field fails here.
    const { ref: { runId: newRefRunId, ...newRunRef }, run: { runId: newRunId, ...newRunBody }, ...newRunRecord } =
      first.newRun;
    expect(newRunRecord).toEqual({ revision: 1, schemaVersion: 1 });
    expect(newRunRef).toEqual({ aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-root' });
    expect(newRunBody).toEqual({
      schemaVersion: 1, queryJobRef: JOB_REF, status: 'pending', startedAt: null, endedAt: null, outcome: null,
    });
    // The id relations: a new id, the same in the ref and the body.
    expect(newRefRunId).not.toBe(before.run.ref.runId);
    expect(newRunId).toBe(newRefRunId);
  });

  it('derives the attempt id from the old run id and the trigger', () => {
    const first = newAttempt(bound(requestRound()), { trigger: 'owner_changed', occurredAt: AT });
    const sameInput = newAttempt(bound(requestRound()), { trigger: 'owner_changed', occurredAt: AT });
    const otherOldRun = newAttempt(bound(requestRound({ runId: 'qr-other' })), { trigger: 'owner_changed', occurredAt: AT });
    const otherTrigger = newAttempt(bound(requestRound()), { trigger: 'owner_archived', occurredAt: AT });
    expect(sameInput.newRun.ref.runId === first.newRun.ref.runId).toBe(true);
    expect(otherOldRun.newRun.ref.runId === first.newRun.ref.runId).toBe(false);
    expect(otherTrigger.newRun.ref.runId === first.newRun.ref.runId).toBe(false);
  });

  it("accepts QRR-02's entering prior state and returns the Job pending", () => {
    const entering = enteringAttempt(bound(requestRound()));
    expect(entering.job.job.status).toBe('running');
    expect(entering.run.run.status).toBe('running');
    expect(entering.run.run.executionState?.phase).toBe('entering');
    const after = newAttempt(entering, { trigger: 'not_entered', occurredAt: AT });
    expect(after.job.job.status).toBe('pending');
    expect(after.job.job.runRef).toEqual(after.newRun.ref);
    expect(after.oldRun.run.status).toBe('closed');
    expect(after.oldRun.run.outcome).toBe('not_entered');
    expect(after.oldRun.run.endedAt).toBe(AT);
    expect(after.oldRun.run.executionState?.phase).toBe('settled');
    expect(after.newRun.run.status).toBe('pending');
  });
});

describe('absorbRound and recordAbsorbedRounds', () => {
  it('ends the absorbed pair not_entered and records absorbedInto', () => {
    const before = bound(requestRound());
    const into: QueryJobRef = { ...JOB_REF, queryJobId: 'qj-executing' };
    const after = absorbRound(before, { into, occurredAt: AT });
    expect(after.job.revision).toBe(before.job.revision + 1);
    expect(after.job.job.status).toBe('closed');
    expect(after.job.job.absorbedInto).toEqual(into);
    expect(after.job.job.closeReason).toEqual({ code: 'not_entered', message: 'absorbed_into_execution_round', detail: null });
    expect(after.job.job).toEqual({ ...before.job.job, status: 'closed', absorbedInto: into,
      closeReason: { code: 'not_entered', message: 'absorbed_into_execution_round', detail: null }, updatedAt: AT });
    expect(after.run.revision).toBe(before.run.revision + 1);
    expect(after.run.run.status).toBe('closed');
    expect(after.run.run.outcome).toBe('not_entered');
    expect(after.run.run.endedAt).toBe(AT);
  });

  it('lists absorbed rounds once, in order, and changes nothing else', () => {
    const executing = boundJob({ absorbedRounds: [] });
    const into: QueryJobRef = { ...JOB_REF, queryJobId: 'qj-executing' };
    const once = recordAbsorbedRounds(executing, [JOB_REF, into]);
    expect(once.revision).toBe(executing.revision + 1);
    expect(once.job.absorbedRounds).toEqual([JOB_REF, into]);
    const twice = recordAbsorbedRounds(once, [JOB_REF]);
    expect(twice.revision).toBe(once.revision + 1);
    expect(twice.job.absorbedRounds).toEqual([JOB_REF, into]);
    expect(twice.job).toEqual({ ...once.job, absorbedRounds: [JOB_REF, into] });
    expect(executing.job.absorbedRounds).toEqual([]);
  });
});

describe('setIntake', () => {
  it('sets and clears intakeSession, revision +1, no other field changed', () => {
    const job = boundJob({ intakeSession: SESSION_A });
    const cleared = setIntake(job, null);
    expect(cleared.revision).toBe(job.revision + 1);
    expect(cleared.job.intakeSession).toBeNull();
    expect(cleared.job).toEqual({ ...job.job, intakeSession: null });
    const taken = setIntake(cleared, SESSION_B);
    expect(taken.revision).toBe(cleared.revision + 1);
    expect(taken.job.intakeSession).toEqual(SESSION_B);
    expect(taken.job).toEqual({ ...cleared.job, intakeSession: SESSION_B });
  });
});

describe('recordEntered', () => {
  it('writes enteredSession once and refuses a different Session later', () => {
    const job = boundJob({ enteredSession: null });
    const entered = recordEntered(job, SESSION_A);
    expect(entered.revision).toBe(job.revision + 1);
    expect(entered.job.enteredSession).toEqual(SESSION_A);
    expect(entered.job).toEqual({ ...job.job, enteredSession: SESSION_A });
    // The same Session again is no change; a different one is refused and never rewritten.
    expect(recordEntered(entered, SESSION_A).revision).toBe(entered.revision);
    expect(() => recordEntered(entered, SESSION_B)).toThrow(/enteredSession/);
    expect(entered.job.enteredSession).toEqual(SESSION_A);
  });
});
