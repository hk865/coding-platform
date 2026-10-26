/**
 * The request facts projections and the one owner rule (book §3.3, §3.12).
 *
 * A5: a pure file. The only platform inputs are the pure round constructors
 * below; the sessions/answers/attempt phases are the projection's own arguments,
 * never store state, and nothing is committed. Every expected value is a literal
 * from book §3.3/§3.12 or a hand-computed example.
 */
import { describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionProvenanceV1 } from '../../src/contracts/core/session.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type {
  QueryExecutionStateV1,
  QueryJobAnswerSnapshot,
  QueryJobIntentV1,
  QueryJobRef,
  PendingQueryJobSnapshot,
  QueryJobSnapshot,
  QueryRunRef,
  QueryRunSnapshot,
  QuerySubmissionBindingV1,
  RequestCommandReceiptV1,
} from '../../src/contracts/query-job.js';
import { newRequestRound, newRoutingRound } from '../../src/core/work-graph/state/request-rounds.js';
import type { PendingQueryLifecycleRecords } from '../../src/core/work-graph/state/query-run-recovery.js';
import {
  deriveCoveredByDrop, deriveEffectiveGoalId, deriveRequestOwner, oldestPendingRound,
  type RequestOwnerSessionFactV1, type RequestRoundsFactsV1,
} from '../../src/core/work-graph/queries/request-rounds-read.js';
import { deriveRequestCore, type RequestCoreFactsV1 } from '../../src/core/work-graph/tasks/request-facts.js';

const SCOPE = { projectId: 'p1', workspaceId: 'w1' } as const;
const AT = '2026-10-23T00:00:00.000Z';
const ROOT_REF: QueryJobRef = { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-root' };
const SESSION_A: SessionRef = { projectId: 'p1', sessionId: 'sA' };
const SESSION_B: SessionRef = { projectId: 'p1', sessionId: 'sB' };
const INTENT = { schemaVersion: 1, intentId: 'intent-1', correlationId: 'corr-1', question: 'what next?' } as unknown as QueryJobIntentV1;
const SUBMISSION: QuerySubmissionBindingV1 = { schemaVersion: 1, identityKey: 'submit-key', fingerprint: 'f'.repeat(64), eventId: 'evt-1' };
const RECEIPT: RequestCommandReceiptV1 = {
  kind: 'submit', requestRoot: ROOT_REF, round: ROOT_REF, assignment: 'assigned', secretary: SESSION_A, created: true,
};

const NEW_PROVENANCE: SessionProvenanceV1 = { schemaVersion: 1, kind: 'new' };
const ARCHIVED_PROVENANCE: SessionProvenanceV1 = { schemaVersion: 1, kind: 'new' };

function handoffFrom(session: SessionRef, from: SessionRef): RequestOwnerSessionFactV1 {
  return { session, lifecycle: 'active', provenance: { schemaVersion: 1, kind: 'handoff', from } };
}

function continuationFrom(session: SessionRef, from: SessionRef): RequestOwnerSessionFactV1 {
  return {
    session, lifecycle: 'active',
    provenance: { schemaVersion: 1, kind: 'continuation', from, reason: 'archived', task: { projectId: 'p1', goalId: 'g1', taskId: 't1' } },
  };
}

const LIVE_A: RequestOwnerSessionFactV1 = { session: SESSION_A, lifecycle: 'active', provenance: NEW_PROVENANCE };
const LIVE_B: RequestOwnerSessionFactV1 = { session: SESSION_B, lifecycle: 'active', provenance: NEW_PROVENANCE };
const ARCHIVED_A: RequestOwnerSessionFactV1 = { session: SESSION_A, lifecycle: 'archived', provenance: ARCHIVED_PROVENANCE };

function pending(id: string, overrides: Partial<Parameters<typeof newRequestRound>[0]> = {}): PendingQueryLifecycleRecords {
  return newRequestRound({
    queryJobId: id, runId: `run-${id}`, scope: SCOPE, intent: INTENT, kind: id === 'qj-root' ? 'request' : 'followup',
    requestRoot: id === 'qj-root' ? null : ROOT_REF, requestGoalId: 'g1', assignedSession: SESSION_A,
    intakeSession: SESSION_A, selectedIdea: null, relatedCardRefs: [], receipt: RECEIPT, submission: SUBMISSION,
    submittedAt: AT, understanding: null, ...overrides,
  });
}

/** The owner reads records back before a projection sees a bound `since`. */
function bound(records: PendingQueryLifecycleRecords, sequence: number): QueryJobSnapshot {
  return { ...records.job, since: makeCommitCursor(sequence) };
}

function round(id: string, sequence: number, overrides: Partial<Parameters<typeof newRequestRound>[0]> = {}): QueryJobSnapshot {
  return bound(pending(id, overrides), sequence);
}

/** A routing round never creates a QueryRun, so it binds its Job directly. */
function boundRouting(job: PendingQueryJobSnapshot, sequence: number): QueryJobSnapshot {
  return { ...job, since: makeCommitCursor(sequence) };
}

function routingRound(sequence: number, to: SessionRef | null, reason: 'manual' | 'dropped' = 'manual'): QueryJobSnapshot {
  const root = round('qj-root', 1);
  return boundRouting(newRoutingRound({
    queryJobId: `qj-routing-${sequence}`, scope: SCOPE, root, routing: { from: SESSION_A, to, reason },
    receipt: null, submission: SUBMISSION, submittedAt: AT,
  }), sequence);
}

function runOf(job: QueryJobSnapshot): QueryRunSnapshot {
  const runRef = job.job.runRef!;
  return {
    ref: runRef, revision: 1, schemaVersion: 1,
    run: { schemaVersion: 1, queryJobRef: job.ref, runId: runRef.runId, status: 'pending', startedAt: null, endedAt: null, outcome: null },
  };
}

/** Only the fields the status projection reads; a full execution state is written by E, not by this file. */
function withPhase(
  run: QueryRunSnapshot, phase: QueryExecutionStateV1['phase'], session: SessionRef = SESSION_A,
): QueryRunSnapshot {
  return {
    ...run,
    run: { ...run.run, executionState: { schemaVersion: 1, phase, sessionRef: session } as unknown as QueryExecutionStateV1 },
  };
}

const ANSWER: QueryJobAnswerSnapshot = {
  ref: { aggregateType: 'QueryJobAnswer', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-root', answerId: 'a1' },
  revision: 1,
  schemaVersion: 1,
  answer: {
    schemaVersion: 1, answerId: 'a1', queryJobRef: ROOT_REF, runRef: { ...ROOT_REF, aggregateType: 'QueryRun', runId: 'run-qj-root' } as QueryRunRef,
    roundIndex: 0, answer: 'the answer', sources: [], followsAnswerRef: null, stale: false, staleReason: null, answeredAt: AT,
    bodyRef: { kind: 'artifact', contentType: 'text/plain', digest: 'd'.repeat(64), sizeBytes: 10,
      source: { kind: 'workspace', refId: 'w1', revision: '1' } },
    ideas: [{ title: 'first idea', detail: 'first detail' }, { title: 'second idea', detail: 'second detail' }],
    goalCardDrafts: [
      { objective: 'objective one', completion: ['done one'], autonomy: 'every_step', screening: null },
      { objective: 'objective two', completion: [], autonomy: 'every_step', screening: null },
    ],
    planDraftIndex: null,
  },
};

/** The pure projections the read layer feeds, one place in the test. */
function derive(
  rounds: QueryJobSnapshot[],
  runs: QueryRunSnapshot[],
  overrides: Partial<RequestCoreFactsV1> = {},
  sessions: RequestOwnerSessionFactV1[] = [LIVE_A, LIVE_B],
) {
  const root = rounds.find(candidate => candidate.job.roundKind === 'request');
  if (root === undefined) throw new Error('the fixture has no request root');
  const requestGoalId = root.job.requestGoalId;
  const { owner, ownerState } = deriveRequestOwner(rounds, sessions);
  return deriveRequestCore(rounds, runs, {
    requestRoot: root.ref,
    requestGoalId,
    effectiveGoalId: deriveEffectiveGoalId(rounds, requestGoalId),
    owner,
    ownerState,
    coveredByDrop: deriveCoveredByDrop(rounds),
    answers: [],
    candidate: null,
    ...overrides,
  });
}

function factsOf(rounds: QueryJobSnapshot[]): RequestRoundsFactsV1 {
  return {
    rounds,
    runs: [],
    tail: rounds[rounds.length - 1]!,
    owner: null,
    ownerState: 'waiting',
    lastOwner: null,
    effectiveGoalId: 'g1',
    requestGoalId: 'g1',
    initiator: { kind: 'human', id: 'operator-1' },
    coveredByDrop: deriveCoveredByDrop(rounds),
    guards: [],
    watermark: null,
  };
}

describe('deriveRequestCore: one round', () => {
  it('a pending round reads queued, still processing, and has no session before the claim', () => {
    const job = round('qj-root', 1);
    const view = derive([job], [runOf(job)]);
    expect(view.rounds[0]).toEqual({
      ref: ROOT_REF, kind: 'request', status: 'queued', input: 'what next?', answer: null, ideas: [],
      goalCardDrafts: [], selectedIdea: null, assignedSession: SESSION_A, session: null, absorbedInto: null,
      closeCode: null, closeDetail: null, since: makeCommitCursor(1),
    });
    expect(view).toMatchObject({ goalId: 'g1', effectiveGoalId: 'g1', owner: SESSION_A, ownerState: 'owned',
      assignment: 'assigned', waitReason: null, reasons: ['round'], processing: true });
  });

  it('an answered round reads ended and projects its ideas and zero-based goal-card drafts', () => {
    const pendingRoot = pending('qj-root');
    const job: QueryJobSnapshot = {
      ...bound(pendingRoot, 1),
      job: { ...pendingRoot.job.job, status: 'answered', answerRefs: [ANSWER.ref] },
    };
    const run = withPhase({
      ...runOf(job),
      run: { ...runOf(job).run, status: 'answered', outcome: 'answered', endedAt: AT },
    }, 'settled');
    const view = derive([job], [run], { answers: [ANSWER] });
    expect(view.rounds[0]).toMatchObject({
      status: 'ended', answer: 'the answer', session: SESSION_A,
      ideas: [{ title: 'first idea', detail: 'first detail' }, { title: 'second idea', detail: 'second detail' }],
      goalCardDrafts: [
        { index: 0, draft: ANSWER.answer.goalCardDrafts[0] },
        { index: 1, draft: ANSWER.answer.goalCardDrafts[1] },
      ],
    });
    expect(view.reasons).toEqual([]);
    expect(view.processing).toBe(false);
  });

  it('a stale candidate head keeps the request processing', () => {
    const pendingRoot = pending('qj-root');
    const job: QueryJobSnapshot = {
      ...bound(pendingRoot, 1),
      job: { ...pendingRoot.job.job, status: 'answered', answerRefs: [] },
    };
    const run = withPhase({ ...runOf(job), run: { ...runOf(job).run, status: 'answered', outcome: 'answered', endedAt: AT } }, 'settled');
    const candidate = {
      proposalRef: { aggregateType: 'PlanProposal', projectId: 'p1', workspaceId: 'w1', proposalId: 'u1' },
      state: 'stale', stale: true,
    } as const;
    const view = derive([job], [run], { candidate });
    expect(view.candidate).toEqual(candidate);
    expect(view.reasons).toEqual(['candidate']);
    expect(view.processing).toBe(true);
  });

  it('after a drop every earlier unstarted round is covered and reads ended with no processing', () => {
    const root = round('qj-root', 1);
    const drop = boundRouting(newRoutingRound({
      queryJobId: 'qj-drop', scope: SCOPE, root, routing: { from: SESSION_A, to: null, reason: 'dropped' },
      receipt: null, submission: SUBMISSION, submittedAt: AT,
    }), 2);
    expect(deriveCoveredByDrop([root, drop])).toEqual([ROOT_REF]);
    const view = derive([root, drop], [runOf(root)]);
    expect(view.rounds[0]!.status).toBe('ended');
    expect(view.rounds[1]!.status).toBe('ended');
    expect(view.owner).toBeNull();
    expect(view.ownerState).toBe('dropped');
    expect(view.assignment).toBe('unassigned');
    expect(view.reasons).toEqual([]);
    expect(view.processing).toBe(false);
  });

  it('a new round after the drop reads processing again once picked', () => {
    const root = round('qj-root', 1);
    const drop = boundRouting(newRoutingRound({
      queryJobId: 'qj-drop', scope: SCOPE, root, routing: { from: SESSION_A, to: null, reason: 'dropped' },
      receipt: null, submission: SUBMISSION, submittedAt: AT,
    }), 2);
    const next = round('qj-next', 3, { kind: 'followup', requestRoot: ROOT_REF, assignedSession: SESSION_B, intakeSession: null });
    expect(deriveCoveredByDrop([root, drop, next])).toEqual([ROOT_REF]);
    const view = derive([root, drop, next], [runOf(root), runOf(next)]);
    expect(view.owner).toEqual(SESSION_B);
    expect(view.ownerState).toBe('owned');
    expect(view.assignment).toBe('assigned');
    expect(view.rounds[2]!.status).toBe('queued');
    expect(view.reasons).toEqual(['round']);
    expect(view.processing).toBe(true);
  });

  it('a new round after the drop reads processing again once capacity-blocked', () => {
    const root = round('qj-root', 1);
    const drop = boundRouting(newRoutingRound({
      queryJobId: 'qj-drop', scope: SCOPE, root, routing: { from: SESSION_A, to: null, reason: 'dropped' },
      receipt: null, submission: SUBMISSION, submittedAt: AT,
    }), 2);
    const next = round('qj-next', 3, { kind: 'followup', requestRoot: ROOT_REF, assignedSession: null, intakeSession: null });
    const view = derive([root, drop, next], [runOf(root), runOf(next)]);
    expect(view.owner).toBeNull();
    expect(view.ownerState).toBe('waiting');
    expect(view.assignment).toBe('unassigned');
    expect(view.waitReason).toBe('secretary_open_cap');
    expect(view.rounds[2]!.status).toBe('queued');
    expect(view.reasons).toEqual(['round']);
    expect(view.processing).toBe(true);
  });
});

describe('deriveRequestOwner: the one owner rule', () => {
  it('a routing round hands ownership to its `to` session', () => {
    const root = round('qj-root', 1);
    const routing = routingRound(2, SESSION_B);
    expect(deriveRequestOwner([root, routing], [LIVE_A, LIVE_B]))
      .toEqual({ owner: SESSION_B, ownerState: 'owned', lastOwner: SESSION_B });
  });

  it('an archived owner resolves through a live handoff successor', () => {
    const root = round('qj-root', 1);
    expect(deriveRequestOwner([root], [ARCHIVED_A, handoffFrom(SESSION_B, SESSION_A)]))
      .toMatchObject({ owner: SESSION_B, ownerState: 'owned' });
  });

  it('a live continuation of an archived owner is not its successor: the request reads owner_archived', () => {
    const root = round('qj-root', 1);
    expect(deriveRequestOwner([root], [ARCHIVED_A, continuationFrom(SESSION_B, SESSION_A)]))
      .toEqual({ owner: null, ownerState: 'owner_archived', lastOwner: SESSION_A });
  });

  it('an archived owner with no live successor reads owner_archived', () => {
    const root = round('qj-root', 1);
    expect(deriveRequestOwner([root], [ARCHIVED_A]))
      .toMatchObject({ owner: null, ownerState: 'owner_archived' });
  });

  it('a routing round that drops the request clears ownership and lastOwner', () => {
    const root = round('qj-root', 1);
    const drop = routingRound(2, null, 'dropped');
    expect(deriveRequestOwner([root, drop], [LIVE_A, LIVE_B]))
      .toEqual({ owner: null, ownerState: 'dropped', lastOwner: null });
  });

  it('a latest round assigned to nobody reads waiting with no lastOwner', () => {
    const root = round('qj-root', 1);
    const next = round('qj-next', 2, { kind: 'followup', requestRoot: ROOT_REF, assignedSession: null, intakeSession: null });
    expect(deriveRequestOwner([root, next], [LIVE_A, LIVE_B]))
      .toEqual({ owner: null, ownerState: 'waiting', lastOwner: null });
  });
});

describe('lastOwner: the Session before successor resolution', () => {
  it('keeps the archived owner while the owner is its handoff successor', () => {
    const root = round('qj-root', 1);
    expect(deriveRequestOwner([root], [ARCHIVED_A, handoffFrom(SESSION_B, SESSION_A)]))
      .toEqual({ owner: SESSION_B, ownerState: 'owned', lastOwner: SESSION_A });
  });

  it('is the assigned Session itself when it is active, and null for waiting or a drop', () => {
    const root = round('qj-root', 1);
    expect(deriveRequestOwner([root], [LIVE_A]).lastOwner).toEqual(SESSION_A);
    const waiting = round('qj-next', 2, { kind: 'followup', requestRoot: ROOT_REF, assignedSession: null, intakeSession: null });
    expect(deriveRequestOwner([root, waiting], [LIVE_A]).lastOwner).toBeNull();
    expect(deriveRequestOwner([root, routingRound(2, null, 'dropped')], [LIVE_A]).lastOwner).toBeNull();
  });
});

describe('deriveEffectiveGoalId', () => {
  it('takes the latest non-empty goalAttribution over the request goal', () => {
    const root = round('qj-root', 1);
    // L11's attribution-only round: the constructor's shape with `routing: null` and the goal. Its
    // producer is 6B, so the pure input is the only way to reach this read today.
    const attributed = (id: string, goal: string, sequence: number): QueryJobSnapshot => {
      const built = boundRouting(newRoutingRound({
        queryJobId: id, scope: SCOPE, root, routing: { from: null, to: null, reason: 'assigned' },
        receipt: null, submission: SUBMISSION, submittedAt: AT,
      }), sequence);
      return { ...built, job: { ...built.job, routing: null, goalAttribution: goal } };
    };
    expect(deriveEffectiveGoalId([root], 'g1')).toBe('g1');
    expect(deriveEffectiveGoalId([root, attributed('qj-g2', 'g2', 2)], 'g1')).toBe('g2');
    expect(deriveEffectiveGoalId([root, attributed('qj-g2', 'g2', 2), attributed('qj-g3', 'g3', 3)], 'g1')).toBe('g3');
  });
});

describe('oldestPendingRound', () => {
  it('reads the oldest pending non-routing round by `since`', () => {
    const root = round('qj-root', 2);
    const older = round('qj-older', 1, { kind: 'followup', requestRoot: ROOT_REF });
    const newer = round('qj-newer', 3, { kind: 'followup', requestRoot: ROOT_REF });
    expect(oldestPendingRound(factsOf([newer, root, older]))?.ref)
      .toEqual({ aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-older' });
  });

  it('breaks a `since` tie by the canonical record key', () => {
    const left = round('qj-b', 4);
    const right = round('qj-a', 4);
    expect(oldestPendingRound(factsOf([left, right]))?.ref)
      .toEqual({ aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-a' });
  });

  it('ignores a routing round and a non-pending round, and reads null when nothing is pending', () => {
    const root = round('qj-root', 1);
    const answered: QueryJobSnapshot = { ...root, job: { ...root.job, status: 'answered' } };
    const routing = routingRound(2, SESSION_B);
    const pendingRouting: QueryJobSnapshot = { ...routing, job: { ...routing.job, status: 'pending' } };
    expect(oldestPendingRound(factsOf([answered, pendingRouting]))).toBeNull();
  });
});

describe('the round status projection', () => {
  it('reads queued, running, ended and unknown from the job and its attempt', () => {
    const queued = round('qj-root', 1);
    const runningJob = round('qj-running', 2, { kind: 'followup', requestRoot: ROOT_REF, assignedSession: SESSION_B });
    const endedPending = pending('qj-ended');
    const endedJob: QueryJobSnapshot = {
      ...bound(endedPending, 3),
      job: { ...endedPending.job.job, requestRoot: ROOT_REF, roundKind: 'followup', status: 'answered' },
    };
    const unknownJob = round('qj-unknown', 4, { kind: 'followup', requestRoot: ROOT_REF, assignedSession: SESSION_B });
    const view = derive(
      [queued, runningJob, endedJob, unknownJob],
      [
        runOf(queued),
        withPhase(runOf(runningJob), 'claimed', SESSION_B),
        withPhase({ ...runOf(endedJob), run: { ...runOf(endedJob).run, status: 'answered', outcome: 'answered' } }, 'settled'),
        withPhase(runOf(unknownJob), 'unknown', SESSION_B),
      ],
    );
    expect(view.rounds.map(entry => entry.status)).toEqual(['queued', 'running', 'ended', 'unknown']);
  });
});
