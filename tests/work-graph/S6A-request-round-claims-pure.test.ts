/**
 * The request-round plans the Query owner commits (`W/queries/request-round-claims.ts`),
 * called with records the state constructors build and facts shaped as
 * `readRequestRounds` returns them:
 * - the start check's owner rule;
 * - a passing start: the batch absorbed at its frozen revisions, the intakes
 *   released (one change per intake key), the request tail held still;
 * - an abandoned start: a new attempt, the intake released, the old attempt's
 *   Session occupancy released;
 * - QRR-01/02 on a request round: a new attempt keeping the intake, or the end of
 *   a round a drop covers; both hold the tail still.
 *
 * A5: a pure file. It imports no store, platform, Host, Workflow, Runtime or stub
 * port; expected keys, revisions and run ids are literals (the run ids are the
 * SHA-256 of the literal `{"runId":"qr-root","trigger":…}` text).
 */
import { describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type {
  QueryExecutionStateV1, QueryJobIntentV1, QueryJobRef, QueryJobSnapshot, QueryRunSnapshot, QuerySubmissionBindingV1,
  RequestCommandReceiptV1,
} from '../../src/contracts/query-job.js';
import {
  coveredByDrop, requestAbandon, requestDroppedEnd, requestRetry, requestStartCheck, requestStartPass,
} from '../../src/core/work-graph/queries/request-round-claims.js';
import type { RequestRoundsFactsV1 } from '../../src/core/work-graph/queries/request-rounds-read.js';
import { advanceQueryExecutionRecord, type QueryLifecycleRecords } from '../../src/core/work-graph/state/query-run-recovery.js';
import { newRequestRound, setIntake, type NewRequestRoundInput } from '../../src/core/work-graph/state/request-rounds.js';
import { createSessionRecord, occupySessionRecord } from '../../src/core/work-graph/state/session-availability.js';

const SCOPE = { projectId: 'p1', workspaceId: 'w1' } as const;
const AT = '2026-10-24T01:00:00.000Z';
const SESSION_A: SessionRef = { projectId: 'p1', sessionId: 'sA' };
const SESSION_B: SessionRef = { projectId: 'p1', sessionId: 'sB' };
const INTENT = { schemaVersion: 1, intentId: 'intent-1', correlationId: 'corr-1', question: 'what next?' } as unknown as QueryJobIntentV1;
const SUBMISSION: QuerySubmissionBindingV1 = { schemaVersion: 1, identityKey: 'submit-key', fingerprint: 'f'.repeat(64), eventId: 'evt-1' };
const ROOT_REF: QueryJobRef = { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-root' };
const RECEIPT: RequestCommandReceiptV1 = { kind: 'submit', requestRoot: ROOT_REF, round: ROOT_REF, assignment: 'assigned', secretary: SESSION_A, created: true };
const ROLE = { kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's3.1' } as const;
const ROLE_BINDING = { schemaVersion: 1 as const, bindingId: 'b1', templateId: 'platform-secretary', templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'pol-1' };
const ROLE_RESOLUTION = { status: 'absent', roleId: 'role-1', reason: 'no role spec' } as QueryExecutionStateV1['roleResolution'];
const RUNTIME_BUDGET = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null,
  timeoutMs: null, perResponseTokens: 4096 };
const PROFILE = { profileId: 'secretary', runtimeBudget: RUNTIME_BUDGET, budget: { maxTokens: null, deadline: null }, consumerId: 'secretary-consumer' };
const BUNDLE_REF = { kind: 'artifact', contentType: 'application/json', digest: 'b'.repeat(64), sizeBytes: 42 } as unknown as NonNullable<QueryExecutionStateV1['prepared']>['bundleRef'];

// Literal keys: the canonical JSON of each ref, keys sorted.
const jobKey = (id: string): string => `{"aggregateType":"QueryJob","projectId":"p1","queryJobId":"qj-${id}","workspaceId":"w1"}`;
const runKey = (id: string): string => `{"aggregateType":"QueryRun","projectId":"p1","queryJobId":"qj-${id}","runId":"qr-${id}","workspaceId":"w1"}`;
const TAIL_KEY = 'request-tail:{"aggregateType":"QueryJob","projectId":"p1","queryJobId":"qj-root","workspaceId":"w1"}';
const INTAKE_A = 'secretary-intake:{"aggregateType":"Session","projectId":"p1","sessionId":"sA"}';
const INTAKE_B = 'secretary-intake:{"aggregateType":"Session","projectId":"p1","sessionId":"sB"}';
const ATTEMPT_OWNER_CHANGED = 'attempt-7fd9c1aec147c3d178e45e642d247be76a921db85c3b6c26ede1a84a6ba4f64b';
const ATTEMPT_OWNER_ARCHIVED = 'attempt-65f31419b184a9f703471661246fcf59cc508e282150ada65551a902f5809e44';
const ATTEMPT_NOT_ENTERED = 'attempt-2e52980e92965ac087283be55ed12bae517dcd6dac62fb42fc7a1f1ab03bb7b4';

function refOf(id: string): QueryJobRef {
  return { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: `qj-${id}` };
}

/** A pending round as the owner reads it back (`since` bound by its creating commit). */
function round(id: string, since: number, overrides: Partial<NewRequestRoundInput> = {}): QueryLifecycleRecords {
  const root = id === 'root';
  const records = newRequestRound({
    queryJobId: `qj-${id}`, runId: `qr-${id}`, scope: SCOPE, intent: INTENT, kind: root ? 'request' : 'followup',
    requestRoot: root ? null : ROOT_REF, requestGoalId: null, assignedSession: root ? SESSION_A : null, intakeSession: null,
    selectedIdea: null, relatedCardRefs: [], receipt: RECEIPT, submission: SUBMISSION, submittedAt: AT, ...overrides,
  });
  return { job: { ...records.job, since: makeCommitCursor(since) }, run: records.run };
}

/** Claimed on Session A at generation 2, then prepared: the Run is at revision 3. */
function prepared(records: QueryLifecycleRecords): QueryLifecycleRecords {
  const claimed = advanceQueryExecutionRecord(records, { phase: 'claimed', claim: { sessionRef: SESSION_A, sessionGeneration: 2, role: ROLE,
    roleBinding: ROLE_BINDING, roleResolution: ROLE_RESOLUTION, priorHistoryCursor: null, requestProfile: PROFILE } });
  return advanceQueryExecutionRecord(claimed, { phase: 'prepared',
    prepared: { bundleRef: BUNDLE_REF, inputDigest: 'i'.repeat(64), requestEffectiveGoalId: null } });
}

function entering(records: QueryLifecycleRecords): QueryLifecycleRecords {
  return advanceQueryExecutionRecord(records, { phase: 'entering', occurredAt: AT,
    entry: { generation: 1, consumerId: 'secretary-consumer', hostConfigurationRevision: 'cfg-1', permissions: { tools: [], writeScope: [] },
      budget: RUNTIME_BUDGET, kernel: { adapterId: 'kernel', kernelSessionId: 'ks1', runId: 'kr1', turnId: 'kt1' } },
    request: { runRef: records.run.ref, bundleRef: BUNDLE_REF, question: 'what next?', budget: { maxTokens: null } } });
}

function guardOf(snapshot: QueryJobSnapshot | QueryRunSnapshot): { refKey: string; expectedRevision: number } {
  return { refKey: canonicalJson(snapshot.ref as unknown as JsonValue), expectedRevision: snapshot.revision };
}

type Owner = Pick<RequestRoundsFactsV1, 'owner' | 'ownerState'>;
const OWNED_BY_A: Owner = { owner: SESSION_A, ownerState: 'owned' };

/** The facts `readRequestRounds` returns for these rounds: each round and its current Run guarded at the revision read. */
function factsOf(rounds: QueryLifecycleRecords[], owner: Owner = OWNED_BY_A, covered: QueryJobRef[] = []): RequestRoundsFactsV1 {
  const jobs = rounds.map((records) => records.job);
  const runs = rounds.map((records) => records.run);
  return {
    rounds: jobs, runs, tail: jobs[jobs.length - 1]!, ...owner, lastOwner: owner.owner, effectiveGoalId: null, requestGoalId: null,
    initiator: { kind: 'human', id: 'person' }, coveredByDrop: covered,
    guards: [...jobs.map(guardOf), ...runs.map(guardOf)], watermark: null,
  };
}

function frozen(records: QueryLifecycleRecords): { ref: QueryJobRef; revision: number; runRef: QueryRunSnapshot['ref']; runRevision: number } {
  return { ref: records.job.ref, revision: records.job.revision, runRef: records.run.ref, runRevision: records.run.revision };
}

function expectRejected(result: object, code: string): void {
  expect(result).toMatchObject({ status: 'rejected', code });
}

/** Session A as the claim left it: occupied by the root's Run at generation 2. */
function occupiedA(): SessionRecord {
  const created = createSessionRecord({ ref: { aggregateType: 'Session', projectId: 'p1', sessionId: 'sA' },
    kernel: { adapterId: 'kernel', kernelSessionId: 'ks1' }, role: ROLE, workspaceId: 'w1', createdAt: AT, provenance: { schemaVersion: 1, kind: 'new' } });
  return occupySessionRecord(created, { holder: round('root', 1).run.ref, generation: 2 });
}

describe('the start check', () => {
  const rounds = [prepared(round('root', 1))];

  it('passes only on the request owner', () => {
    expect(requestStartCheck(factsOf(rounds), SESSION_A)).toEqual({ kind: 'pass' });
    // The claim keeps the caller's Session ref shape; only the project and Session ids are compared.
    expect(requestStartCheck(factsOf(rounds), { aggregateType: 'Session', projectId: 'p1', sessionId: 'sA' } as unknown as SessionRef))
      .toEqual({ kind: 'pass' });
  });

  it('abandons the attempt for another owner, a waiting request and an archived owner', () => {
    expect(requestStartCheck(factsOf(rounds, { owner: SESSION_B, ownerState: 'owned' }), SESSION_A)).toEqual({ kind: 'abandon', trigger: 'owner_changed' });
    expect(requestStartCheck(factsOf(rounds, { owner: null, ownerState: 'waiting' }), SESSION_A)).toEqual({ kind: 'abandon', trigger: 'owner_changed' });
    expect(requestStartCheck(factsOf(rounds, { owner: null, ownerState: 'owner_archived' }), SESSION_A))
      .toEqual({ kind: 'abandon', trigger: 'owner_archived' });
  });
});

describe('a passing start', () => {
  const root = prepared(round('root', 1, { intakeSession: SESSION_A }));
  const first = round('f1', 2);
  const second = round('f2', 3);

  it('absorbs the batch, releases the intake the executing round holds and holds the tail still', () => {
    const facts = factsOf([root, first, second]);
    const start = entering(root);
    const plan = requestStartPass({ entering: start, facts, batch: [frozen(first), frozen(second)], occurredAt: AT });
    if ('status' in plan) throw new Error(plan.reason);
    expect(plan.job).toEqual({ ...start.job, revision: 4,
      job: { ...start.job.job, intakeSession: null, absorbedRounds: [refOf('f1'), refOf('f2')] } });
    expect(plan.absorbed).toEqual([first, second].map((records) => ({
      job: { ...records.job, revision: 2, job: { ...records.job.job, status: 'closed', absorbedInto: ROOT_REF,
        closeReason: { code: 'not_entered', message: 'absorbed_into_execution_round', detail: null }, updatedAt: AT } },
      run: { ...records.run, revision: 2, run: { ...records.run.run, status: 'closed', outcome: 'not_entered', endedAt: AT } },
    })));
    expect(plan.claims).toEqual([
      { claimKey: TAIL_KEY, expectedOwner: jobKey('f2'), nextOwner: jobKey('f2') },
      { claimKey: INTAKE_A, expectedOwner: jobKey('root'), nextOwner: null },
    ]);
    expect(plan.guards).toEqual([
      { refKey: jobKey('root'), expectedRevision: 1 }, { refKey: jobKey('f1'), expectedRevision: 1 }, { refKey: jobKey('f2'), expectedRevision: 1 },
      { refKey: runKey('root'), expectedRevision: 3 }, { refKey: runKey('f1'), expectedRevision: 1 }, { refKey: runKey('f2'), expectedRevision: 1 },
    ]);
  });

  it('with an empty batch and no intake writes only the tail claim', () => {
    const plain = prepared(round('root', 1));
    const start = entering(plain);
    const plan = requestStartPass({ entering: start, facts: factsOf([plain, first]), batch: [], occurredAt: AT });
    if ('status' in plan) throw new Error(plan.reason);
    expect(plan.job).toEqual(start.job);
    expect(plan.absorbed).toEqual([]);
    expect(plan.claims).toEqual([{ claimKey: TAIL_KEY, expectedOwner: jobKey('f1'), nextOwner: jobKey('f1') }]);
  });

  it('releases an intake an absorbed round holds, one change per intake key', () => {
    const plain = prepared(round('root', 1));
    const holder = round('f1', 2, { intakeSession: SESSION_B });
    const plan = requestStartPass({ entering: entering(plain), facts: factsOf([plain, holder]), batch: [frozen(holder)], occurredAt: AT });
    if ('status' in plan) throw new Error(plan.reason);
    expect(plan.claims).toEqual([
      { claimKey: TAIL_KEY, expectedOwner: jobKey('f1'), nextOwner: jobKey('f1') },
      { claimKey: INTAKE_B, expectedOwner: jobKey('f1'), nextOwner: null },
    ]);
    expect(plan.absorbed[0]?.job.revision).toBe(3);
    expect(plan.absorbed[0]?.job.job.intakeSession).toBeNull();
    // Two rounds naming one intake key is a broken invariant: one key, one change.
    const twice = round('f1', 2, { intakeSession: SESSION_A });
    const both = prepared(round('root', 1, { intakeSession: SESSION_A }));
    expectRejected(requestStartPass({ entering: entering(both), facts: factsOf([both, twice]), batch: [frozen(twice)], occurredAt: AT }), 'invalid');
  });

  it('guards each batch round at its frozen revisions', () => {
    const moved = { ...first, job: setIntake(first.job, SESSION_B) };
    expect(moved.job.revision).toBe(2);
    expectRejected(requestStartPass({ entering: entering(root), facts: factsOf([root, moved]), batch: [frozen(first)], occurredAt: AT }),
      'revision_conflict');
  });

  it('refuses a batch that names the executing round, a round of no request here, a repeated round or a round no longer pending', () => {
    const facts = factsOf([root, first]);
    const start = entering(root);
    expectRejected(requestStartPass({ entering: start, facts: factsOf([first]), batch: [], occurredAt: AT }), 'invalid');
    expectRejected(requestStartPass({ entering: start, facts, batch: [frozen(root)], occurredAt: AT }), 'invalid');
    expectRejected(requestStartPass({ entering: start, facts: factsOf([root, first, second]),
      batch: [{ ...frozen(first), runRef: second.run.ref }], occurredAt: AT }), 'invalid');
    expectRejected(requestStartPass({ entering: start, facts, batch: [frozen(round('other', 9))], occurredAt: AT }), 'invalid');
    expectRejected(requestStartPass({ entering: start, facts, batch: [frozen(first), frozen(first)], occurredAt: AT }), 'invalid');
    const closed = { ...first, job: { ...first.job, job: { ...first.job.job, status: 'closed' as const } } };
    expectRejected(requestStartPass({ entering: start, facts: factsOf([root, closed]), batch: [frozen(closed)], occurredAt: AT }), 'invalid');
    // A claimed round is a live attempt, never a batch round; the executing round is one.
    const plain = prepared(round('root', 1));
    expectRejected(requestStartPass({ entering: entering(plain), facts: factsOf([plain, first]), batch: [frozen(plain)], occurredAt: AT }),
      'invalid');
  });
});

describe('an abandoned start', () => {
  const root = prepared(round('root', 1, { intakeSession: SESSION_A }));
  const follow = round('f1', 2);

  it('makes a new attempt, releases the intake and the old Session occupancy, and holds the tail still', () => {
    const session = occupiedA();
    const plan = requestAbandon({ records: root, facts: factsOf([root, follow], { owner: SESSION_B, ownerState: 'owned' }),
      trigger: 'owner_changed', session, occurredAt: AT });
    if ('status' in plan) throw new Error(plan.reason);
    const newRunRef = { ...root.run.ref, runId: ATTEMPT_OWNER_CHANGED };
    expect(plan.job).toEqual({ ...root.job, revision: 3,
      job: { ...root.job.job, status: 'pending', runRef: newRunRef, intakeSession: null, updatedAt: AT } });
    expect(plan.oldRun).toEqual({ ...root.run, revision: 4, run: { ...root.run.run, status: 'closed', outcome: 'not_entered', endedAt: AT,
      executionState: { ...root.run.run.executionState!, phase: 'settled' } } });
    expect(plan.newRun).toEqual({ ref: newRunRef, revision: 1, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef: ROOT_REF,
      runId: ATTEMPT_OWNER_CHANGED, status: 'pending', startedAt: null, endedAt: null, outcome: null } });
    expect(plan.session).toEqual({ ...session, revision: 3, occupancy: null });
    expect(plan.claims).toEqual([
      { claimKey: TAIL_KEY, expectedOwner: jobKey('f1'), nextOwner: jobKey('f1') },
      { claimKey: INTAKE_A, expectedOwner: jobKey('root'), nextOwner: null },
    ]);
    expect(plan.guards).toEqual([
      { refKey: jobKey('root'), expectedRevision: 1 }, { refKey: jobKey('f1'), expectedRevision: 1 },
      { refKey: runKey('root'), expectedRevision: 3 }, { refKey: runKey('f1'), expectedRevision: 1 },
      { refKey: `{"aggregateType":"QueryRun","projectId":"p1","queryJobId":"qj-root","runId":"${ATTEMPT_OWNER_CHANGED}","workspaceId":"w1"}`,
        expectedRevision: null },
    ]);
  });

  it('an archived owner names its own trigger; a round without an intake changes only the tail', () => {
    const plain = prepared(round('root', 1));
    const plan = requestAbandon({ records: plain, facts: factsOf([plain], { owner: null, ownerState: 'owner_archived' }),
      trigger: 'owner_archived', session: occupiedA(), occurredAt: AT });
    if ('status' in plan) throw new Error(plan.reason);
    expect(plan.newRun.ref.runId).toBe(ATTEMPT_OWNER_ARCHIVED);
    expect(plan.job.revision).toBe(2);
    expect(plan.claims).toEqual([{ claimKey: TAIL_KEY, expectedOwner: jobKey('root'), nextOwner: jobKey('root') }]);
  });

  it('releases no Session the attempt no longer holds', () => {
    const created = createSessionRecord({ ref: { aggregateType: 'Session', projectId: 'p1', sessionId: 'sA' },
      kernel: { adapterId: 'kernel', kernelSessionId: 'ks1' }, role: ROLE, workspaceId: 'w1', createdAt: AT, provenance: { schemaVersion: 1, kind: 'new' } });
    const plan = requestAbandon({ records: root, facts: factsOf([root]), trigger: 'owner_changed', session: created, occurredAt: AT });
    if ('status' in plan) throw new Error(plan.reason);
    expect(plan.session).toBeNull();
  });

  it('refuses a round that is not one of the request rounds', () => {
    expectRejected(requestAbandon({ records: root, facts: factsOf([follow]), trigger: 'owner_changed', session: occupiedA(), occurredAt: AT }), 'invalid');
  });
});

describe('QRR-01/02 on a request round', () => {
  const root = prepared(round('root', 1, { intakeSession: SESSION_A }));

  it('refuses a round that is not one of the request rounds', () => {
    expectRejected(requestRetry({ records: root, facts: factsOf([round('f1', 2)]), occurredAt: AT }), 'invalid');
  });

  it('not covered by a drop: a new attempt that keeps the intake; the tail is held still', () => {
    const plan = requestRetry({ records: root, facts: factsOf([root]), occurredAt: AT });
    if ('status' in plan) throw new Error(plan.reason);
    const newRunRef = { ...root.run.ref, runId: ATTEMPT_NOT_ENTERED };
    expect(plan.job).toEqual({ ...root.job, revision: 2, job: { ...root.job.job, status: 'pending', runRef: newRunRef, updatedAt: AT } });
    expect(plan.job.job.intakeSession).toEqual(SESSION_A);
    expect(plan.oldRun.run).toMatchObject({ status: 'closed', outcome: 'not_entered', endedAt: AT });
    expect(plan.newRun.ref).toEqual(newRunRef);
    expect(plan.claims).toEqual([{ claimKey: TAIL_KEY, expectedOwner: jobKey('root'), nextOwner: jobKey('root') }]);
    expect(plan.guards).toEqual([
      { refKey: jobKey('root'), expectedRevision: 1 }, { refKey: runKey('root'), expectedRevision: 3 },
      { refKey: `{"aggregateType":"QueryRun","projectId":"p1","queryJobId":"qj-root","runId":"${ATTEMPT_NOT_ENTERED}","workspaceId":"w1"}`,
        expectedRevision: null },
    ]);
  });

  it('covered by a drop: an entering round ends cancelled/dropped; the tail is held still', () => {
    const started = entering(prepared(round('root', 1)));
    const facts = factsOf([started], { owner: null, ownerState: 'dropped' }, [ROOT_REF]);
    expect(coveredByDrop(facts, ROOT_REF)).toBe(true);
    expect(coveredByDrop(factsOf([started]), ROOT_REF)).toBe(false);
    const plan = requestDroppedEnd({ records: started, facts, occurredAt: AT });
    if ('status' in plan) throw new Error(plan.reason);
    expect(plan.job).toEqual({ ...started.job, revision: 3, job: { ...started.job.job, status: 'closed',
      closeReason: { code: 'cancelled', message: 'request_dropped', detail: 'dropped' }, updatedAt: AT } });
    expect(plan.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered', endedAt: AT });
    expect(plan.run.run.executionState?.phase).toBe('settled');
    expect(plan.claims).toEqual([{ claimKey: TAIL_KEY, expectedOwner: jobKey('root'), nextOwner: jobKey('root') }]);
    expect(plan.guards).toEqual([{ refKey: jobKey('root'), expectedRevision: 2 }, { refKey: runKey('root'), expectedRevision: 4 }]);
    expectRejected(requestDroppedEnd({ records: started, facts: factsOf([round('f1', 2)]), occurredAt: AT }), 'invalid');
  });
});
