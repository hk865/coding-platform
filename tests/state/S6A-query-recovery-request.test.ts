/**
 * A request round's QueryRun recovery rows and the answer-check settlement,
 * through the pure machine and record constructors only (rule A5):
 * - QRR-01/02 on a request round: covered by a drop it ends unstarted, else the
 *   same Job waits for a new attempt; the Session release is the machine's own;
 * - entry evidence: QRR-03 (both sources), QRR-04 and QRR-05 with unresolved
 *   tools record the round's entry, QRR-05 with an unreadable Kernel and QRR-06
 *   do not; a plain Query's rows are today's;
 * - the answer check: only with a failed terminal; the settle closes
 *   `invalid_answer` with its detail and the reason cut to the close-message bound;
 * - the claim step always writes `requestProfile`.
 */
import { describe, expect, it } from 'vitest';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type { CoreError } from '../../src/contracts/core/results.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type {
  QueryExecutionStateV1, QueryJobAnswerV1, QueryJobIntentV1, QueryRunRef,
} from '../../src/contracts/query-job.js';
import {
  MAX_ATTESTATION_REASON_CHARS,
  advanceQueryExecutionRecord,
  newPendingQueryRecords,
  settleQueryRunRecord,
  transitionQueryRunRecovery,
  type QueryExecutionStep,
  type QueryLifecycleRecords,
  type QueryRecoveryEvent,
  type QueryRecoveryGuardContext,
  type QueryRecoveryPhase,
  type QueryRecoveryState,
  type QueryRecoveryTransition,
  type QueryTerminalFact,
} from '../../src/core/work-graph/state/query-run-recovery.js';
import type { TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';

const RUN_REF: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj1', runId: 'qr1' };
const JOB_REF = { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj1' } as const;
const SESSION_REF = { projectId: 'p1', sessionId: 's1' };
const GENERATION = 5;
const KERNEL = { adapterId: 'kernel', kernelSessionId: 'ks1', runId: 'kr1', turnId: 'kt1' };
const AT = '2026-10-24T00:00:09.000Z';

function history(endPosition: number | null = 7): RunExecutionHistoryV1 {
  return { schemaVersion: 1, sessionRef: { ...SESSION_REF }, kernel: { ...KERNEL }, startPosition: 3, observedThroughPosition: 7, endPosition };
}

function answer(): QueryJobAnswerV1 {
  return {
    schemaVersion: 1, answerId: 'a1', queryJobRef: { ...JOB_REF }, runRef: { ...RUN_REF }, roundIndex: 0,
    answer: 'the answer', sources: [], followsAnswerRef: null, stale: false, staleReason: null, ideas: [], goalCardDrafts: [], planDraftIndex: null,
    answeredAt: '2026-10-24T00:00:07.000Z',
    bodyRef: { kind: 'artifact', contentType: 'text/plain', digest: 'd'.repeat(64), sizeBytes: 10, source: { kind: 'query_run', ref: RUN_REF } } as unknown as QueryJobAnswerV1['bodyRef'],
  };
}

function terminal(overrides: Partial<QueryTerminalFact> = {}): QueryTerminalFact {
  return { outcome: 'failed', answer: null, reason: 'model failed', answerCheck: null, history: history(),
    source: { position: 7, cursor: 'cursor-7' }, ...overrides };
}

function stateAt(phase: QueryRecoveryPhase): QueryRecoveryState {
  return phase === 'claimed' || phase === 'prepared'
    ? { phase, runStatus: 'pending', jobStatus: 'pending', outcome: null, ended: false }
    : { phase, runStatus: 'running', jobStatus: 'running', outcome: null, ended: false };
}

function serviceCtx(overrides: Partial<QueryRecoveryGuardContext> = {}): QueryRecoveryGuardContext {
  return {
    caller: 'service', hostLease: null, probe: null, kernel: null, inputsConfirmed: true, actor: 'system', reason: null,
    sessionOwned: true, sessionGeneration: GENERATION, queryRunRef: RUN_REF, entryMatches: true, ...overrides,
  };
}

function reconcileCtx(overrides: Partial<QueryRecoveryGuardContext> = {}): QueryRecoveryGuardContext {
  return serviceCtx({ caller: 'reconcile', hostLease: 'owned', probe: 'ready',
    kernel: { turn: 'present', mappedOutcome: 'failed', boundaryComplete: true, unresolvedToolCallIds: [] }, ...overrides });
}

/** QRR-01 needs no Kernel; QRR-02 needs a readable Kernel without the Turn. */
function notEnteredCtx(phase: QueryRecoveryPhase, request: QueryRecoveryGuardContext['request']): QueryRecoveryGuardContext {
  return reconcileCtx({ ...(request === undefined ? {} : { request }), probe: phase === 'entering' ? 'ready' : null,
    kernel: phase === 'entering' ? { turn: 'absent', mappedOutcome: null, boundaryComplete: false, unresolvedToolCallIds: [] } : null });
}

function expectRejected(result: QueryRecoveryTransition, reason: TransitionRejectReason, code: CoreError): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect({ reason: result.reason, code: result.code }).toEqual({ reason, code });
}

const NOT_ENTERED: QueryRecoveryEvent = { kind: 'query_reconcile_not_entered', hostInstanceId: 'host-1' };
/** SES-09: the cursor is kept, no Turn is left open. */
const KEEP_RELEASE = { kind: 'release_session', holder: RUN_REF, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: false } as const;
/** SES-08: the Session moves to the terminal's complete boundary. */
const ADVANCE_RELEASE = { kind: 'release_session', holder: RUN_REF, generation: GENERATION,
  historyCursor: { kind: 'advance', cursor: 'cursor-7' }, kernelTurnOpen: false } as const;
const REQUEST = { coveredByDrop: null };

describe('QRR-01/02 on a request round', () => {
  it('not covered by a drop: the old attempt settles not_entered and the Job waits for a new attempt; the Session is released', () => {
    for (const phase of ['claimed', 'prepared', 'entering'] as const) {
      expect(transitionQueryRunRecovery(stateAt(phase), NOT_ENTERED, notEnteredCtx(phase, { coveredByDrop: false }))).toEqual({
        ok: true,
        next: { phase: 'settled', runStatus: 'closed', jobStatus: 'pending', outcome: 'not_entered', ended: true },
        effects: [{ kind: 'new_attempt' }, KEEP_RELEASE],
      });
    }
  });

  it('covered by a drop: the round ends unstarted; the Session is released', () => {
    for (const phase of ['claimed', 'prepared', 'entering'] as const) {
      expect(transitionQueryRunRecovery(stateAt(phase), NOT_ENTERED, notEnteredCtx(phase, { coveredByDrop: true }))).toEqual({
        ok: true,
        next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'not_entered', ended: true },
        effects: [{ kind: 'end_dropped_round' }, KEEP_RELEASE],
      });
    }
  });

  it('a Session this attempt no longer holds is not released', () => {
    expect(transitionQueryRunRecovery(stateAt('prepared'), NOT_ENTERED,
      { ...notEnteredCtx('prepared', { coveredByDrop: false }), sessionOwned: false }))
      .toEqual({ ok: true, next: { phase: 'settled', runStatus: 'closed', jobStatus: 'pending', outcome: 'not_entered', ended: true },
        effects: [{ kind: 'new_attempt' }] });
  });

  it('without the drop facts a request round is not closed', () => {
    expectRejected(transitionQueryRunRecovery(stateAt('claimed'), NOT_ENTERED, notEnteredCtx('claimed', REQUEST)), 'guard_failed', 'unavailable');
  });

  it("a plain Query keeps today's not_entered close", () => {
    for (const request of [null, undefined]) {
      const ctx = notEnteredCtx('prepared', request);
      expect(transitionQueryRunRecovery(stateAt('prepared'), NOT_ENTERED, ctx)).toEqual({
        ok: true,
        next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'not_entered', ended: true },
        effects: [
          { kind: 'settle_query', settlement: { outcome: 'not_entered', closeMessage: 'host_restart_before_entry' }, history: { kind: 'unchanged' } },
          KEEP_RELEASE,
        ],
      });
    }
  });
});

describe('entry evidence on a request round', () => {
  const ANSWERED = terminal({ outcome: 'answered', answer: answer(), reason: null });
  const ANSWER_REF = { aggregateType: 'QueryJobAnswer', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj1', answerId: 'a1' };

  it('QRR-03 from the observer and from the reconcile records the entry', () => {
    const cases: [QueryRecoveryEvent, QueryRecoveryGuardContext][] = [
      [{ kind: 'query_terminal_observed', terminal: ANSWERED }, serviceCtx({ request: REQUEST })],
      [{ kind: 'query_reconcile_terminal', hostInstanceId: 'host-1', terminal: ANSWERED }, reconcileCtx({ request: REQUEST })],
    ];
    for (const [event, ctx] of cases) {
      expect(transitionQueryRunRecovery(stateAt('entered'), event, ctx)).toEqual({
        ok: true,
        next: { phase: 'settled', runStatus: 'answered', jobStatus: 'answered', outcome: 'answered', ended: true },
        effects: [
          { kind: 'settle_query', settlement: { outcome: 'answered', answerRef: ANSWER_REF }, history: { kind: 'set', history: history() } },
          { kind: 'record_answer', ref: ANSWER_REF, answer: answer() },
          { kind: 'record_entered' },
          ADVANCE_RELEASE,
        ],
      });
    }
    expect(transitionQueryRunRecovery(stateAt('entering'), { kind: 'query_terminal_observed', terminal: terminal() }, serviceCtx({ request: REQUEST })))
      .toEqual({
        ok: true,
        next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'failed', ended: true },
        effects: [
          { kind: 'settle_query', settlement: { outcome: 'failed', closeMessage: 'model failed', answerCheck: null },
            history: { kind: 'set', history: history() } },
          { kind: 'record_entered' },
          ADVANCE_RELEASE,
        ],
      });
  });

  it('QRR-04 records the entry', () => {
    const event: QueryRecoveryEvent = { kind: 'query_reconcile_interrupted_clean', hostInstanceId: 'host-1', kernelStatus: 'running', history: history(null) };
    const ctx = reconcileCtx({ request: REQUEST, kernel: { turn: 'present', mappedOutcome: null, boundaryComplete: false, unresolvedToolCallIds: [] } });
    expect(transitionQueryRunRecovery(stateAt('entered'), event, ctx)).toEqual({
      ok: true,
      next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'failed', ended: true },
      effects: [
        { kind: 'settle_query', settlement: { outcome: 'failed', closeMessage: 'host_interrupted', answerCheck: null },
          history: { kind: 'set', history: history(null) } },
        { kind: 'record_entered' },
        { ...KEEP_RELEASE, kernelTurnOpen: true },
      ],
    });
  });

  it('QRR-05 records the entry only for tool calls without a result, never for an unreadable Kernel', () => {
    const unresolved: QueryRecoveryEvent = { kind: 'query_reconcile_unknown', hostInstanceId: 'host-1',
      cause: { kind: 'unresolved_tools', toolCallIds: ['call-1'] }, history: history(null) };
    expect(transitionQueryRunRecovery(stateAt('entering'), unresolved, reconcileCtx({ request: REQUEST, kernel: null }))).toEqual({
      ok: true,
      next: { phase: 'unknown', runStatus: 'running', jobStatus: 'running', outcome: null, ended: false },
      effects: [
        { kind: 'mark_query_unknown', history: { kind: 'set', history: history(null) }, cause: { kind: 'unresolved_tools', toolCallIds: ['call-1'] } },
        { kind: 'record_entered' },
      ],
    });
    const unreadable: QueryRecoveryEvent = { kind: 'query_reconcile_unknown', hostInstanceId: 'host-1',
      cause: { kind: 'kernel_unreadable', verdict: 'missing' }, history: null };
    expect(transitionQueryRunRecovery(stateAt('entering'), unreadable, reconcileCtx({ request: REQUEST, probe: 'missing', kernel: null }))).toEqual({
      ok: true,
      next: { phase: 'unknown', runStatus: 'running', jobStatus: 'running', outcome: null, ended: false },
      effects: [{ kind: 'mark_query_unknown', history: { kind: 'unchanged' }, cause: { kind: 'kernel_unreadable', verdict: 'missing' } }],
    });
  });

  it('QRR-06 never records the entry', () => {
    const ctx = serviceCtx({ caller: 'host_entry', hostLease: 'owned', actor: 'human', reason: 'checked by hand', request: REQUEST });
    expect(transitionQueryRunRecovery({ ...stateAt('entered'), phase: 'unknown' }, { kind: 'query_unknown_attested' }, ctx)).toEqual({
      ok: true,
      next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'failed', ended: true },
      effects: [
        { kind: 'settle_query', settlement: { outcome: 'failed', closeMessage: 'checked by hand', answerCheck: null }, history: { kind: 'unchanged' } },
        KEEP_RELEASE,
      ],
    });
  });

  it('a plain Query records no entry', () => {
    const event: QueryRecoveryEvent = { kind: 'query_terminal_observed', terminal: terminal() };
    for (const ctx of [serviceCtx(), serviceCtx({ request: null })]) {
      const result = transitionQueryRunRecovery(stateAt('entered'), event, ctx);
      expect(result.ok && result.effects.map((effect) => effect.kind)).toEqual(['settle_query', 'release_session']);
    }
    const unknown: QueryRecoveryEvent = { kind: 'query_reconcile_unknown', hostInstanceId: 'host-1',
      cause: { kind: 'unresolved_tools', toolCallIds: ['call-1'] }, history: null };
    const marked = transitionQueryRunRecovery(stateAt('entered'), unknown, reconcileCtx({ kernel: null }));
    expect(marked.ok && marked.effects.map((effect) => effect.kind)).toEqual(['mark_query_unknown']);
  });
});

describe('the answer check on a terminal', () => {
  const CHECK = { detail: 'protocol', reason: 'the answer is not the v2 JSON object' } as const;

  it('a failed terminal carries it into its settlement', () => {
    expect(transitionQueryRunRecovery(stateAt('entered'),
      { kind: 'query_terminal_observed', terminal: terminal({ reason: CHECK.reason, answerCheck: CHECK }) }, serviceCtx({ request: REQUEST })))
      .toEqual({
        ok: true,
        next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'failed', ended: true },
        effects: [
          { kind: 'settle_query', settlement: { outcome: 'failed', closeMessage: CHECK.reason, answerCheck: CHECK },
            history: { kind: 'set', history: history() } },
          { kind: 'record_entered' },
          ADVANCE_RELEASE,
        ],
      });
  });

  it('comes only with a failed terminal', () => {
    for (const fact of [
      terminal({ outcome: 'gap', answerCheck: CHECK }),
      terminal({ outcome: 'timeout', answerCheck: CHECK }),
      terminal({ outcome: 'answered', answer: answer(), reason: null, answerCheck: CHECK }),
    ]) {
      expectRejected(transitionQueryRunRecovery(stateAt('entered'), { kind: 'query_terminal_observed', terminal: fact }, serviceCtx({ request: REQUEST })),
        'guard_failed', 'invalid');
    }
  });
});

// --------------------------------------------------------------------------
// Record constructors
// --------------------------------------------------------------------------

const INTENT = { schemaVersion: 1, intentId: 'intent-1', correlationId: 'corr-1', question: 'why?' } as unknown as QueryJobIntentV1;
const SUBMISSION = { schemaVersion: 1 as const, identityKey: 'submit-key', fingerprint: 'f'.repeat(64), eventId: 'evt-1' };
const ROLE = { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' } as const;
const ROLE_BINDING = { schemaVersion: 1 as const, bindingId: 'b1', templateId: 'tpl', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'pol-1' };
const ROLE_RESOLUTION = { status: 'absent', roleId: 'role-1', reason: 'no role spec' } as QueryExecutionStateV1['roleResolution'];
const RUNTIME_BUDGET = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null,
  timeoutMs: null, perResponseTokens: 4096 };
const PROFILE = { profileId: 'secretary-profile', runtimeBudget: RUNTIME_BUDGET, budget: { maxTokens: 9000, deadline: null }, consumerId: 'secretary-consumer' };
const BUNDLE_REF = { kind: 'artifact', contentType: 'application/json', digest: 'b'.repeat(64), sizeBytes: 42 } as unknown as NonNullable<QueryExecutionStateV1['prepared']>['bundleRef'];

function claimStep(requestProfile: QueryExecutionStateV1['requestProfile']): QueryExecutionStep {
  return { phase: 'claimed', claim: { sessionRef: SESSION_REF, sessionGeneration: GENERATION, role: ROLE, roleBinding: ROLE_BINDING,
    roleResolution: ROLE_RESOLUTION, priorHistoryCursor: 'cursor-2', requestProfile } };
}

function pending(): QueryLifecycleRecords {
  const records = newPendingQueryRecords({ queryRunRef: RUN_REF, goalId: 'g1', intent: INTENT, submittedAt: '2026-10-24T00:00:00.000Z', submission: SUBMISSION });
  return { job: { ...records.job, since: makeCommitCursor(1) }, run: records.run };
}

/** An entered attempt: claimed, prepared, entering, entered. */
function entered(): QueryLifecycleRecords {
  let records = advanceQueryExecutionRecord(pending(), claimStep(null));
  records = advanceQueryExecutionRecord(records, { phase: 'prepared',
    prepared: { bundleRef: BUNDLE_REF, inputDigest: 'i'.repeat(64), requestEffectiveGoalId: null } });
  records = advanceQueryExecutionRecord(records, { phase: 'entering', occurredAt: '2026-10-24T00:00:03.000Z',
    entry: { generation: 1, consumerId: 'consumer-1', hostConfigurationRevision: 'cfg-1', permissions: { tools: [], writeScope: [] },
      budget: RUNTIME_BUDGET, kernel: { ...KERNEL } },
    request: { runRef: RUN_REF, bundleRef: BUNDLE_REF, question: 'why?', budget: { maxTokens: null } } });
  return advanceQueryExecutionRecord(records, { phase: 'entered', history: history(null) });
}

describe('the claim step writes the profile', () => {
  it('a request round keeps its profile; every other Query writes null', () => {
    expect(advanceQueryExecutionRecord(pending(), claimStep(PROFILE)).run.run.executionState?.requestProfile).toEqual(PROFILE);
    const plain = advanceQueryExecutionRecord(pending(), claimStep(null)).run.run.executionState;
    expect(plain !== undefined && 'requestProfile' in plain && plain.requestProfile).toBeNull();
  });
});

describe('settleQueryRunRecord with an answer check', () => {
  const failed = (closeMessage: string, answerCheck: { detail: 'too_long' | 'empty' | 'protocol'; reason: string } | null) =>
    settleQueryRunRecord(entered(), { settlement: { outcome: 'failed', closeMessage, answerCheck }, history: { kind: 'unchanged' }, occurredAt: AT });

  it("without a check a failed settle keeps today's close", () => {
    const after = failed('model failed', null);
    expect(after.job.job.closeReason).toEqual({ code: 'failed', message: 'model failed', detail: null });
    expect(after.run.run).toMatchObject({ status: 'closed', outcome: 'failed', endedAt: AT });
  });

  it('a check closes invalid_answer with its detail and reason; the Run outcome stays failed', () => {
    for (const detail of ['too_long', 'empty', 'protocol'] as const) {
      const after = failed('model text', { detail, reason: `the answer is ${detail}` });
      expect(after.job.job).toMatchObject({ status: 'closed', closeReason: { code: 'invalid_answer', message: `the answer is ${detail}`, detail } });
      expect(after.run.run).toMatchObject({ status: 'closed', outcome: 'failed', endedAt: AT });
    }
  });

  it('cuts the reason to the close-message bound without splitting a character', () => {
    expect(MAX_ATTESTATION_REASON_CHARS).toBe(2000);
    const at2000 = 'a'.repeat(2000);
    expect(failed('x', { detail: 'protocol', reason: at2000 }).job.job.closeReason?.message).toBe(at2000);
    expect(failed('x', { detail: 'protocol', reason: 'a'.repeat(1999) + 'bc' }).job.job.closeReason?.message).toBe('a'.repeat(1999) + 'b');
    // U+1F600 is two UTF-16 units; the cut would leave half of it, so it ends before it.
    expect(failed('x', { detail: 'protocol', reason: 'a'.repeat(1999) + '\u{1F600}' }).job.job.closeReason?.message).toBe('a'.repeat(1999));
  });
});
