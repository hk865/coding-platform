/**
 * Exhaustive table test of the QueryRun recovery sub-machine and its record
 * constructors (docs/refactor/STATE-MACHINES-SPEC.md §8 QRR rows, §8.4, §14.1,
 * §15.2 step 2). Every (phase, event) pair is asserted; QRR-03 (已有) is legal
 * today, the 新增 rows QRR-01/02/04/05/06 still answer `illegal`.
 */
import { describe, expect, it } from 'vitest';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type { CoreError } from '../../src/contracts/core/results.js';
import type {
  QueryExecutionStateV1,
  QueryJobAnswerRef,
  QueryJobAnswerV1,
  QueryJobIntentV1,
  QueryJobSnapshot,
  QueryRunRef,
  QueryRunSnapshot,
} from '../../src/contracts/query-job.js';
import {
  advanceQueryExecutionRecord,
  markQueryRunUnknownRecord,
  newPendingQueryRecords,
  queryRecoveryStateOf,
  settleQueryRunRecord,
  transitionQueryRunRecovery,
  type QueryExecutionStep,
  type QueryLifecycleRecords,
  type QueryRecoveryEvent,
  type QueryRecoveryEventKind,
  type QueryRecoveryGuardContext,
  type QueryRecoveryPhase,
  type QueryRecoveryState,
  type QueryRecoveryTransition,
  type QueryTerminalFact,
} from '../../src/core/work-graph/state/query-run-recovery.js';
import type { TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';

const RUN_REF: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj1', runId: 'qr1' };
const OTHER_RUN_REF: QueryRunRef = { ...RUN_REF, runId: 'qr2' };
const JOB_REF = { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj1' } as const;
const ANSWER_REF: QueryJobAnswerRef = { aggregateType: 'QueryJobAnswer', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj1', answerId: 'a1' };
const SESSION_REF = { projectId: 'p1', sessionId: 's1' };
/** The occupancy generation the claim fixed (`executionState.sessionGeneration`). */
const SESSION_GENERATION = 5;
const KERNEL = { adapterId: 'kernel', kernelSessionId: 'ks1', runId: 'kr1', turnId: 'kt1' };

const PHASES: readonly QueryRecoveryPhase[] = ['claimed', 'prepared', 'entering', 'entered', 'unknown', 'settled'];
const EVENT_KINDS: readonly QueryRecoveryEventKind[] = [
  'query_terminal_observed', 'query_reconcile_terminal', 'query_reconcile_not_entered',
  'query_reconcile_interrupted_clean', 'query_reconcile_unknown', 'query_unknown_attested',
];

function history(endPosition: number | null = 7): RunExecutionHistoryV1 {
  return { schemaVersion: 1, sessionRef: { ...SESSION_REF }, kernel: { ...KERNEL }, startPosition: 3, observedThroughPosition: 7, endPosition };
}

function answer(overrides: Partial<QueryJobAnswerV1> = {}): QueryJobAnswerV1 {
  return {
    schemaVersion: 1, answerId: 'a1', queryJobRef: { ...JOB_REF }, runRef: { ...RUN_REF }, roundIndex: 0,
    answer: 'the answer', sources: [], followsAnswerRef: null, stale: false, staleReason: null,
    answeredAt: '2026-10-04T00:00:07.000Z',
    bodyRef: { kind: 'artifact', contentType: 'text/plain', digest: 'd'.repeat(64), sizeBytes: 10, source: { kind: 'query_run', ref: RUN_REF } } as unknown as QueryJobAnswerV1['bodyRef'],
    ...overrides,
  };
}

function terminal(overrides: Partial<QueryTerminalFact> = {}): QueryTerminalFact {
  return { outcome: 'failed', answer: null, reason: 'model failed', history: history(), source: { position: 7, cursor: 'cursor-7' }, ...overrides };
}

function stateAt(phase: QueryRecoveryPhase): QueryRecoveryState {
  switch (phase) {
    case 'claimed':
    case 'prepared':
      return { phase, runStatus: 'pending', jobStatus: 'pending', outcome: null, ended: false };
    case 'entering':
    case 'entered':
    case 'unknown':
      return { phase, runStatus: 'running', jobStatus: 'running', outcome: null, ended: false };
    case 'settled':
      return { phase, runStatus: 'closed', jobStatus: 'closed', outcome: 'failed', ended: true };
  }
}

/** The in-process owner call of today (`recordQueryObservation`). */
function serviceCtx(overrides: Partial<QueryRecoveryGuardContext> = {}): QueryRecoveryGuardContext {
  return {
    caller: 'service', hostLease: null, probe: null, kernel: null, inputsConfirmed: true,
    actor: 'system', reason: null, sessionOwned: true, sessionGeneration: SESSION_GENERATION, queryRunRef: RUN_REF, entryMatches: true,
    ...overrides,
  };
}

/** A start-up reconcile on the Host that holds the instance lease, Kernel readable. */
function reconcileCtx(overrides: Partial<QueryRecoveryGuardContext> = {}): QueryRecoveryGuardContext {
  return serviceCtx({
    caller: 'reconcile', hostLease: 'owned', probe: 'ready',
    kernel: { turn: 'present', mappedOutcome: 'failed', boundaryComplete: true, unresolvedToolCallIds: [] },
    ...overrides,
  });
}

function eventOf(kind: QueryRecoveryEventKind): QueryRecoveryEvent {
  switch (kind) {
    case 'query_terminal_observed': return { kind, terminal: terminal() };
    case 'query_reconcile_terminal': return { kind, hostInstanceId: 'host-1', terminal: terminal() };
    case 'query_reconcile_not_entered': return { kind, hostInstanceId: 'host-1' };
    case 'query_reconcile_interrupted_clean': return { kind, hostInstanceId: 'host-1', kernelStatus: 'running', history: history(null) };
    case 'query_reconcile_unknown': return { kind, hostInstanceId: 'host-1', cause: { kind: 'unresolved_tools', toolCallIds: ['call-1'] }, history: history(null) };
    case 'query_unknown_attested': return { kind };
  }
}

function ctxFor(kind: QueryRecoveryEventKind): QueryRecoveryGuardContext {
  return kind === 'query_terminal_observed' ? serviceCtx() : kind === 'query_unknown_attested'
    ? serviceCtx({ caller: 'host_entry', hostLease: 'owned', actor: 'human', reason: 'checked by hand' })
    : reconcileCtx();
}

function expectRejected(result: QueryRecoveryTransition, reason: TransitionRejectReason, code: CoreError): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect({ reason: result.reason, code: result.code }).toEqual({ reason, code });
  expect(result.detail.length).toBeGreaterThan(0);
}

/** The shared `SessionRelease` of SES-08: the claim holder and generation, the cursor of the complete boundary. */
const RELEASE = {
  kind: 'release_session', holder: RUN_REF, generation: SESSION_GENERATION,
  historyCursor: { kind: 'advance', cursor: 'cursor-7' }, kernelTurnOpen: false,
} as const;
const SETTLED_FAILED: QueryRecoveryState = { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'failed', ended: true };
const SETTLE_FAILED = { kind: 'settle_query', settlement: { outcome: 'failed', closeMessage: 'model failed' }, history: { kind: 'set', history: history() } };
const FAILED_EFFECTS = [SETTLE_FAILED, RELEASE];

type Expected = { legal: true } | { legal: false; reason: TransitionRejectReason; code: CoreError };
const LEGAL: Expected = { legal: true };
const illegal = (code: CoreError): Expected => ({ legal: false, reason: 'illegal', code });
/** A 新增 row before step 5: `notYet`, with the §1.2 default code like every other machine (§15.2 step 2). */
const NOT_YET: Expected = illegal('invalid');

/**
 * §8.3/§8.4 as of §15.2 step 2: QRR-03 legal; 新增 rows answer `NOT_YET`
 * outside the §8.4 phase entries. `unknown × query_reconcile_unknown` is final:
 * no row starts there (QRR-05 is entering/entered), so §1.2 gives `invalid`.
 */
const MATRIX: { readonly [E in QueryRecoveryEventKind]: { readonly [P in QueryRecoveryPhase]: Expected } } = {
  query_terminal_observed: {
    claimed: illegal('forbidden'), prepared: illegal('forbidden'),
    entering: LEGAL, entered: LEGAL, unknown: LEGAL, settled: illegal('busy'),
  },
  query_reconcile_terminal: {
    claimed: illegal('invalid'), prepared: illegal('invalid'),
    entering: LEGAL, entered: LEGAL, unknown: LEGAL, settled: illegal('busy'),
  },
  query_reconcile_not_entered: {
    claimed: NOT_YET, prepared: NOT_YET, entering: NOT_YET,
    entered: illegal('invalid'), unknown: illegal('busy'), settled: illegal('busy'),
  },
  query_reconcile_interrupted_clean: {
    claimed: illegal('invalid'), prepared: illegal('invalid'), entering: NOT_YET,
    entered: NOT_YET, unknown: illegal('busy'), settled: illegal('busy'),
  },
  query_reconcile_unknown: {
    claimed: illegal('invalid'), prepared: illegal('invalid'), entering: NOT_YET,
    entered: NOT_YET, unknown: illegal('invalid'), settled: illegal('busy'),
  },
  // §8.4 "非 unknown × query_unknown_attested → busy" (guard_failed once step 5 adds QRR-06).
  query_unknown_attested: {
    claimed: illegal('busy'), prepared: illegal('busy'), entering: illegal('busy'),
    entered: illegal('busy'), unknown: NOT_YET, settled: illegal('busy'),
  },
};

describe('transitionQueryRunRecovery: every (phase, event) pair', () => {
  for (const kind of EVENT_KINDS) {
    for (const phase of PHASES) {
      const expected = MATRIX[kind][phase];
      it(`${phase} × ${kind} → ${expected.legal ? 'QRR-03' : `${expected.reason}/${expected.code}`}`, () => {
        const result = transitionQueryRunRecovery(stateAt(phase), eventOf(kind), ctxFor(kind));
        if (expected.legal) {
          expect(result).toEqual({ ok: true, next: SETTLED_FAILED, effects: FAILED_EFFECTS });
        } else {
          expectRejected(result, expected.reason, expected.code);
        }
      });
    }
  }

  it('the 新增 rows answer the same phase-level result under any guard context', () => {
    const contexts = [serviceCtx(), reconcileCtx(), reconcileCtx({ hostLease: 'held_by_other', probe: 'missing', kernel: null }),
      serviceCtx({ caller: 'host_entry', hostLease: 'owned', actor: 'human', reason: 'why' })];
    for (const kind of ['query_reconcile_not_entered', 'query_reconcile_interrupted_clean', 'query_reconcile_unknown', 'query_unknown_attested'] as const) {
      for (const phase of PHASES) {
        const expected = MATRIX[kind][phase];
        if (expected.legal) throw new Error('a 新增 row is legal in step 2');
        for (const ctx of contexts) expectRejected(transitionQueryRunRecovery(stateAt(phase), eventOf(kind), ctx), expected.reason, expected.code);
      }
    }
  });

  it('QRR-05 alternative causes and QRR-04 Kernel states do not change the step-2 answer', () => {
    for (const kernelStatus of ['created', 'running', 'paused', 'yielded'] as const) {
      expectRejected(transitionQueryRunRecovery(stateAt('entered'),
        { kind: 'query_reconcile_interrupted_clean', hostInstanceId: 'host-1', kernelStatus, history: history(null) }, reconcileCtx()), 'illegal', 'invalid');
    }
    expectRejected(transitionQueryRunRecovery(stateAt('entering'),
      { kind: 'query_reconcile_unknown', hostInstanceId: 'host-1', cause: { kind: 'kernel_unreadable', verdict: 'damaged' }, history: null },
      reconcileCtx({ probe: 'damaged', kernel: null, inputsConfirmed: 'kernel_unreadable' })), 'illegal', 'invalid');
  });
});

describe('QRR-03 from the in-process observer (query_terminal_observed)', () => {
  const observed = (fact: QueryTerminalFact): QueryRecoveryEvent => ({ kind: 'query_terminal_observed', terminal: fact });

  it('books an answered terminal: settle, Answer@1 and the Session release at the boundary cursor', () => {
    for (const phase of ['entering', 'entered', 'unknown'] as const) {
      const result = transitionQueryRunRecovery(stateAt(phase), observed(terminal({ outcome: 'answered', answer: answer(), reason: null })), serviceCtx());
      expect(result).toEqual({
        ok: true,
        next: { phase: 'settled', runStatus: 'answered', jobStatus: 'answered', outcome: 'answered', ended: true },
        effects: [
          { kind: 'settle_query', settlement: { outcome: 'answered', answerRef: ANSWER_REF }, history: { kind: 'set', history: history() } },
          { kind: 'record_answer', ref: ANSWER_REF, answer: answer() },
          RELEASE,
        ],
      });
    }
  });

  it('closes every other outcome with closeReason code = outcome and message = reason ?? outcome', () => {
    for (const outcome of ['timeout', 'gap', 'failed', 'cancelled'] as const) {
      for (const reason of ['said why', null]) {
        const result = transitionQueryRunRecovery(stateAt('entered'), observed(terminal({ outcome, reason })), serviceCtx());
        expect(result).toEqual({
          ok: true,
          next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome, ended: true },
          effects: [
            { kind: 'settle_query', settlement: { outcome, closeMessage: reason ?? outcome }, history: { kind: 'set', history: history() } },
            RELEASE,
          ],
        });
      }
    }
  });

  it('settles without a Session release once the claim generation no longer owns the Session (query-execution.ts:1409-1421)', () => {
    expect(transitionQueryRunRecovery(stateAt('entered'), observed(terminal()), serviceCtx({ sessionOwned: false })))
      .toEqual({ ok: true, next: SETTLED_FAILED, effects: [SETTLE_FAILED] });
    const answered = transitionQueryRunRecovery(stateAt('entered'), observed(terminal({ outcome: 'answered', answer: answer(), reason: null })),
      serviceCtx({ sessionOwned: false }));
    expect(answered.ok && answered.effects.map(effect => effect.kind)).toEqual(['settle_query', 'record_answer']);
  });

  it('names the claim generation the context carries in the release', () => {
    const result = transitionQueryRunRecovery(stateAt('unknown'), observed(terminal()), serviceCtx({ sessionGeneration: 9 }));
    expect(result.ok && result.effects[1]).toEqual({ ...RELEASE, generation: 9 });
  });

  it('checks the fixed entry identity before the settled check (query-execution.ts:1311, :1360)', () => {
    for (const phase of ['entering', 'entered', 'unknown', 'settled'] as const) {
      expectRejected(transitionQueryRunRecovery(stateAt(phase), observed(terminal()), serviceCtx({ entryMatches: false })), 'guard_failed', 'forbidden');
    }
    for (const phase of ['claimed', 'prepared'] as const) {
      expectRejected(transitionQueryRunRecovery(stateAt(phase), observed(terminal()), serviceCtx({ entryMatches: false })), 'illegal', 'forbidden');
    }
  });

  it('rejects an Answer on a non-answered terminal, a missing Answer and a foreign Answer as invalid', () => {
    const cases: QueryTerminalFact[] = [
      terminal({ outcome: 'failed', answer: answer() }),
      terminal({ outcome: 'answered', answer: null }),
      terminal({ outcome: 'answered', answer: answer({ runRef: { ...OTHER_RUN_REF } }) }),
      terminal({ outcome: 'answered', answer: answer({ queryJobRef: { ...JOB_REF, queryJobId: 'qj2' } }) }),
    ];
    for (const fact of cases) expectRejected(transitionQueryRunRecovery(stateAt('entered'), observed(fact), serviceCtx()), 'guard_failed', 'invalid');
  });

  it('rejects a terminal without a complete end boundary as invalid (query-execution.ts:1371-1373)', () => {
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), observed(terminal({ history: history(null) })), serviceCtx()), 'guard_failed', 'invalid');
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), observed(terminal({ history: history(6) })), serviceCtx()), 'guard_failed', 'invalid');
  });

  it('does not release before the accepted inputs are confirmed (§10.3)', () => {
    for (const inputsConfirmed of [false, 'kernel_unreadable'] as const) {
      expectRejected(transitionQueryRunRecovery(stateAt('entered'), observed(terminal()), serviceCtx({ inputsConfirmed })), 'guard_failed', 'unavailable');
    }
  });

  it('honours a Kernel classification when one is supplied', () => {
    const kernel = { turn: 'present' as const, mappedOutcome: 'failed' as const, boundaryComplete: true, unresolvedToolCallIds: [] as string[] };
    expect(transitionQueryRunRecovery(stateAt('entered'), observed(terminal()), serviceCtx({ kernel })).ok).toBe(true);
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), observed(terminal()),
      serviceCtx({ kernel: { ...kernel, unresolvedToolCallIds: ['call-1'] } })), 'guard_failed', 'busy');
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), observed(terminal()),
      serviceCtx({ kernel: { ...kernel, mappedOutcome: null } })), 'guard_failed', 'invalid');
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), observed(terminal()),
      serviceCtx({ kernel: { ...kernel, boundaryComplete: false } })), 'guard_failed', 'invalid');
  });

  it('books a mapped answered Kernel status without answer text as gap (query-observation.ts:425-430)', () => {
    const kernel = { turn: 'present' as const, mappedOutcome: 'answered' as const, boundaryComplete: true, unresolvedToolCallIds: [] as string[] };
    const result = transitionQueryRunRecovery(stateAt('entered'), observed(terminal({ outcome: 'gap', answer: null, reason: 'no answer text' })), serviceCtx({ kernel }));
    expect(result).toEqual({
      ok: true,
      next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'gap', ended: true },
      effects: [
        { kind: 'settle_query', settlement: { outcome: 'gap', closeMessage: 'no answer text' }, history: { kind: 'set', history: history() } },
        RELEASE,
      ],
    });
  });
});

describe('QRR-03 from the start-up reconcile (query_reconcile_terminal)', () => {
  const reconciled = (fact: QueryTerminalFact = terminal()): QueryRecoveryEvent => ({ kind: 'query_reconcile_terminal', hostInstanceId: 'host-1', terminal: fact });

  it('books the answered terminal of an unknown QueryRun', () => {
    const result = transitionQueryRunRecovery(stateAt('unknown'), reconciled(terminal({ outcome: 'answered', answer: answer(), reason: null })),
      reconcileCtx({ kernel: { turn: 'present', mappedOutcome: 'answered', boundaryComplete: true, unresolvedToolCallIds: [] } }));
    expect(result.ok && result.next).toEqual({ phase: 'settled', runStatus: 'answered', jobStatus: 'answered', outcome: 'answered', ended: true });
    expect(result.ok && result.effects.map(effect => effect.kind)).toEqual(['settle_query', 'record_answer', 'release_session']);
  });

  it('is accepted only from the reconcile caller', () => {
    for (const caller of ['service', 'host_entry'] as const) {
      expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(), reconcileCtx({ caller })), 'illegal', 'forbidden');
    }
  });

  it('answers busy without the instance lease, before any phase check (D-18, L-10)', () => {
    for (const hostLease of ['held_by_other', null] as const) {
      for (const phase of PHASES) {
        expectRejected(transitionQueryRunRecovery(stateAt(phase), reconciled(), reconcileCtx({ hostLease })), 'guard_failed', 'busy');
      }
    }
  });

  it('requires the fixed entry and a readable Kernel Turn', () => {
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(), reconcileCtx({ entryMatches: false })), 'guard_failed', 'forbidden');
    for (const probe of ['missing', 'damaged', 'host_config', 'transient', 'cancelled', null] as const) {
      expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(), reconcileCtx({ probe })), 'guard_failed', 'unavailable');
    }
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(), reconcileCtx({ kernel: null })), 'guard_failed', 'unavailable');
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(),
      reconcileCtx({ kernel: { turn: 'absent', mappedOutcome: null, boundaryComplete: false, unresolvedToolCallIds: [] } })), 'guard_failed', 'unavailable');
  });

  it('keeps the occupancy while a tool call has no result, and books only a mappable complete terminal', () => {
    const kernel = { turn: 'present' as const, mappedOutcome: 'failed' as const, boundaryComplete: true, unresolvedToolCallIds: [] as string[] };
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(),
      reconcileCtx({ kernel: { ...kernel, unresolvedToolCallIds: ['call-1'] } })), 'guard_failed', 'busy');
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(),
      reconcileCtx({ kernel: { ...kernel, mappedOutcome: null } })), 'guard_failed', 'invalid');
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(),
      reconcileCtx({ kernel: { ...kernel, boundaryComplete: false } })), 'guard_failed', 'invalid');
    expectRejected(transitionQueryRunRecovery(stateAt('entered'), reconciled(), reconcileCtx({ inputsConfirmed: false })), 'guard_failed', 'unavailable');
  });

  it('books a mapped answered Kernel status without answer text as gap (Q-03, query-observation.ts:425-430)', () => {
    for (const phase of ['entering', 'entered', 'unknown'] as const) {
      const result = transitionQueryRunRecovery(stateAt(phase), reconciled(terminal({ outcome: 'gap', answer: null, reason: null })),
        reconcileCtx({ kernel: { turn: 'present', mappedOutcome: 'answered', boundaryComplete: true, unresolvedToolCallIds: [] } }));
      expect(result).toEqual({
        ok: true,
        next: { phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'gap', ended: true },
        effects: [
          { kind: 'settle_query', settlement: { outcome: 'gap', closeMessage: 'gap' }, history: { kind: 'set', history: history() } },
          RELEASE,
        ],
      });
    }
  });
});

// --------------------------------------------------------------------------
// Record constructors (§14.1)
// --------------------------------------------------------------------------

const INTENT = { schemaVersion: 1, intentId: 'intent-1', correlationId: 'corr-1', question: 'why?' } as unknown as QueryJobIntentV1;
const SUBMISSION = { schemaVersion: 1 as const, identityKey: 'submit-key', fingerprint: 'f'.repeat(64), eventId: 'evt-1' };
const ROLE = { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' } as const;
const ROLE_BINDING = { schemaVersion: 1 as const, bindingId: 'b1', templateId: 'tpl', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'pol-1' };
const ROLE_RESOLUTION = { status: 'absent', roleId: 'role-1', reason: 'no role spec' } as QueryExecutionStateV1['roleResolution'];
const BUNDLE_REF = { kind: 'artifact', contentType: 'application/json', digest: 'b'.repeat(64), sizeBytes: 42 } as unknown as NonNullable<QueryExecutionStateV1['prepared']>['bundleRef'];
const ENTRY: NonNullable<QueryExecutionStateV1['entry']> = {
  generation: 1, consumerId: 'consumer-1', hostConfigurationRevision: 'cfg-1', permissions: { tools: ['read'], writeScope: [] },
  budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 },
  kernel: { ...KERNEL },
};
const STEPS: { readonly [P in QueryExecutionStep['phase']]: QueryExecutionStep } = {
  claimed: { phase: 'claimed', claim: { sessionRef: SESSION_REF, sessionGeneration: 5, role: ROLE, roleBinding: ROLE_BINDING, roleResolution: ROLE_RESOLUTION, priorHistoryCursor: 'cursor-2' } },
  prepared: { phase: 'prepared', prepared: { bundleRef: BUNDLE_REF, inputDigest: 'i'.repeat(64) } },
  entering: { phase: 'entering', entry: ENTRY, request: { runRef: RUN_REF, bundleRef: BUNDLE_REF, question: 'why?', budget: { maxTokens: null } }, occurredAt: '2026-10-04T00:00:03.000Z' },
  entered: { phase: 'entered', history: history(null) },
};

function pending(): QueryLifecycleRecords {
  return newPendingQueryRecords({ queryRunRef: RUN_REF, goalId: 'g1', intent: INTENT, submittedAt: '2026-10-04T00:00:00.000Z', submission: SUBMISSION });
}
function advancedTo(phase: QueryExecutionStep['phase']): QueryLifecycleRecords {
  const order: QueryExecutionStep['phase'][] = ['claimed', 'prepared', 'entering', 'entered'];
  let records = pending();
  for (const step of order.slice(0, order.indexOf(phase) + 1)) records = advanceQueryExecutionRecord(records, STEPS[step]);
  return records;
}
function withPhase(records: QueryLifecycleRecords, phase: QueryRecoveryPhase): QueryLifecycleRecords {
  const run: QueryRunSnapshot = { ...records.run, run: { ...records.run.run, executionState: { ...records.run.run.executionState!, phase } } };
  return { job: records.job, run };
}
function stateOf(records: QueryLifecycleRecords): QueryRecoveryState | null {
  return queryRecoveryStateOf(records.job.job, records.run.run);
}

describe('newPendingQueryRecords', () => {
  it('builds the pending@1 pair of today (query-job-service.ts:758-789)', () => {
    const records = pending();
    expect(records.job).toEqual({
      ref: JOB_REF, revision: 1, schemaVersion: 1, submission: SUBMISSION,
      job: {
        schemaVersion: 1, queryJobId: 'qj1', projectId: 'p1', workspaceId: 'w1', goalId: 'g1', intent: INTENT, status: 'pending',
        runRef: RUN_REF, answerRefs: [], closeReason: null, submittedAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z',
      },
    } satisfies QueryJobSnapshot);
    expect(records.run).toEqual({
      ref: RUN_REF, revision: 1, schemaVersion: 1,
      run: { schemaVersion: 1, queryJobRef: JOB_REF, runId: 'qr1', status: 'pending', startedAt: null, endedAt: null, outcome: null },
    } satisfies QueryRunSnapshot);
    expect(records.run.ref).not.toBe(RUN_REF);
    expect(stateOf(records)).toBeNull();
  });
});

describe('advanceQueryExecutionRecord', () => {
  it('claimed: fresh execution state on the pending QueryRun; the QueryJob is untouched', () => {
    const before = pending();
    const after = advanceQueryExecutionRecord(before, STEPS.claimed);
    expect(after.job).toBe(before.job);
    expect(after.run.revision).toBe(2);
    expect(after.run.run.status).toBe('pending');
    expect(after.run.run.executionState).toEqual({
      schemaVersion: 1, phase: 'claimed', sessionRef: SESSION_REF, sessionGeneration: 5, role: ROLE, roleBinding: ROLE_BINDING,
      roleResolution: ROLE_RESOLUTION, priorHistoryCursor: 'cursor-2', prepared: null, entry: null, history: null, requests: [],
    });
    expect(stateOf(after)).toEqual({ phase: 'claimed', runStatus: 'pending', jobStatus: 'pending', outcome: null, ended: false });
  });

  it('prepared: binds the manifest only', () => {
    const after = advancedTo('prepared');
    expect(after.run.revision).toBe(3);
    expect(after.run.run.executionState?.prepared).toEqual({ bundleRef: BUNDLE_REF, inputDigest: 'i'.repeat(64) });
    expect(stateOf(after)).toEqual({ phase: 'prepared', runStatus: 'pending', jobStatus: 'pending', outcome: null, ended: false });
  });

  it('entering: QueryRun and QueryJob become running, startedAt and the execution binding are written', () => {
    const before = advancedTo('prepared');
    const after = advanceQueryExecutionRecord(before, STEPS.entering);
    expect(after.run.revision).toBe(4);
    expect(after.job.revision).toBe(2);
    expect(after.run.run).toMatchObject({ status: 'running', startedAt: '2026-10-04T00:00:03.000Z' });
    expect(after.run.run.execution).toEqual({
      schemaVersion: 1, roundIndex: 0, selectedSources: [],
      request: { runRef: RUN_REF, bundleRef: BUNDLE_REF, question: 'why?', budget: { maxTokens: null } },
    });
    expect(after.run.run.executionState?.entry).toEqual(ENTRY);
    expect(after.job.job).toMatchObject({ status: 'running', updatedAt: '2026-10-04T00:00:03.000Z', submittedAt: '2026-10-04T00:00:00.000Z' });
    expect(stateOf(after)).toEqual({ phase: 'entering', runStatus: 'running', jobStatus: 'running', outcome: null, ended: false });
    const restarted = { ...before, run: { ...before.run, run: { ...before.run.run, startedAt: '2026-10-04T00:00:01.000Z' } } };
    expect(advanceQueryExecutionRecord(restarted, STEPS.entering).run.run.startedAt).toBe('2026-10-04T00:00:01.000Z');
  });

  it('entered: records the observed history', () => {
    const after = advancedTo('entered');
    expect(after.run.revision).toBe(5);
    expect(after.run.run.executionState?.history).toEqual(history(null));
    expect(stateOf(after)).toEqual({ phase: 'entered', runStatus: 'running', jobStatus: 'running', outcome: null, ended: false });
  });

  it('refuses out-of-order steps', () => {
    expect(() => advanceQueryExecutionRecord(pending(), STEPS.prepared)).toThrow(/requires phase claimed/);
    expect(() => advanceQueryExecutionRecord(advancedTo('claimed'), STEPS.entering)).toThrow(/requires phase prepared/);
    expect(() => advanceQueryExecutionRecord(advancedTo('prepared'), STEPS.entered)).toThrow(/requires phase entering/);
    expect(() => advanceQueryExecutionRecord(advancedTo('entering'), STEPS.claimed)).toThrow(/pending QueryJob and QueryRun/);
    const fresh = pending();
    for (const status of ['running', 'answered', 'closed'] as const) {
      expect(() => advanceQueryExecutionRecord({ ...fresh, job: { ...fresh.job, job: { ...fresh.job.job, status } } }, STEPS.claimed))
        .toThrow(/pending QueryJob and QueryRun/);
    }
    const closedJob = advancedTo('prepared');
    expect(() => advanceQueryExecutionRecord({ ...closedJob, job: { ...closedJob.job, job: { ...closedJob.job.job, status: 'closed' } } }, STEPS.entering))
      .toThrow(/unsettled QueryJob/);
  });

  it('does not alias caller-owned values', () => {
    const step = structuredClone(STEPS.entered) as Extract<QueryExecutionStep, { phase: 'entered' }>;
    const after = advanceQueryExecutionRecord(advancedTo('entering'), step);
    step.history.startPosition = 99;
    expect(after.run.run.executionState?.history?.startPosition).toBe(3);
  });
});

describe('markQueryRunUnknownRecord', () => {
  it('sets phase unknown, keeps the statuses and writes or keeps the history', () => {
    const entered = advancedTo('entered');
    const replaced = markQueryRunUnknownRecord(entered.run, { history: { kind: 'set', history: history(9) } });
    expect(replaced.revision).toBe(entered.run.revision + 1);
    expect(replaced.run.status).toBe('running');
    expect(replaced.run.executionState).toMatchObject({ phase: 'unknown', history: history(9) });
    const kept = markQueryRunUnknownRecord(advancedTo('entering').run, { history: { kind: 'unchanged' } });
    expect(kept.run.executionState).toMatchObject({ phase: 'unknown', history: null });
    const again = markQueryRunUnknownRecord(replaced, { history: { kind: 'unchanged' } });
    expect(again.run.executionState).toMatchObject({ phase: 'unknown', history: history(9) });
  });

  it('refuses a QueryRun without a fixed entry, a settled one and a historical claim', () => {
    expect(() => markQueryRunUnknownRecord(pending().run, { history: { kind: 'unchanged' } })).toThrow(/not absent$/);
    for (const phase of ['claimed', 'prepared'] as const) {
      expect(() => markQueryRunUnknownRecord(advancedTo(phase).run, { history: { kind: 'unchanged' } })).toThrow(new RegExp(`not ${phase}$`));
    }
    expect(() => markQueryRunUnknownRecord(withPhase(advancedTo('entered'), 'settled').run, { history: { kind: 'unchanged' } })).toThrow(/not settled$/);
  });

  it('does not alias the caller-owned history', () => {
    const input = history(9);
    const marked = markQueryRunUnknownRecord(advancedTo('entered').run, { history: { kind: 'set', history: input } });
    input.startPosition = 99;
    expect(marked.run.executionState?.history).toEqual(history(9));
  });
});

describe('settleQueryRunRecord', () => {
  const at = '2026-10-04T00:00:08.000Z';

  it('settles an answer: both statuses answered, the Answer ref appended, no closeReason (query-execution.ts:1377-1408)', () => {
    const before = advancedTo('entered');
    const after = settleQueryRunRecord(before, { settlement: { outcome: 'answered', answerRef: ANSWER_REF }, history: { kind: 'set', history: history() }, occurredAt: at });
    expect(after.job.revision).toBe(before.job.revision + 1);
    expect(after.run.revision).toBe(before.run.revision + 1);
    expect(after.job.job).toMatchObject({ status: 'answered', answerRefs: [ANSWER_REF], closeReason: null, updatedAt: at });
    expect(after.run.run).toMatchObject({ status: 'answered', outcome: 'answered', endedAt: at });
    expect(after.run.run.executionState).toMatchObject({ phase: 'settled', history: history() });
  });

  it('closes not_entered from claimed/prepared/entering only (QRR-01/02) and keeps the stored history', () => {
    for (const phase of ['claimed', 'prepared', 'entering'] as const) {
      const before = advancedTo(phase);
      const after = settleQueryRunRecord(before, { settlement: { outcome: 'not_entered', closeMessage: 'host_restart_before_entry' }, history: { kind: 'unchanged' }, occurredAt: at });
      expect(after.job.revision).toBe(before.job.revision + 1);
      expect(after.job.job).toMatchObject({ status: 'closed', answerRefs: [], closeReason: { code: 'not_entered', message: 'host_restart_before_entry' }, updatedAt: at });
      expect(after.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered', endedAt: at });
      expect(after.run.run.executionState?.phase).toBe('settled');
      expect(after.run.run.executionState?.history).toBeNull();
    }
    for (const phase of ['entered', 'unknown'] as const) {
      expect(() => settleQueryRunRecord(withPhase(advancedTo('entered'), phase),
        { settlement: { outcome: 'not_entered', closeMessage: 'x' }, history: { kind: 'unchanged' }, occurredAt: at }))
        .toThrow(new RegExp(`requires phase claimed/prepared/entering, not ${phase}$`));
    }
  });

  it('settles a known outcome from entering/entered/unknown only (QRR-03/04/06), keeping the stored history on request', () => {
    for (const phase of ['entering', 'entered', 'unknown'] as const) {
      const after = settleQueryRunRecord(withPhase(advancedTo('entered'), phase),
        { settlement: { outcome: 'failed', closeMessage: 'host_interrupted' }, history: { kind: 'unchanged' }, occurredAt: at });
      expect(after.run.run).toMatchObject({ status: 'closed', outcome: 'failed', endedAt: at });
      expect(after.run.run.executionState?.history).toEqual(history(null));
    }
    const settlements = [
      { outcome: 'answered', answerRef: ANSWER_REF },
      { outcome: 'failed', closeMessage: 'x' },
      { outcome: 'cancelled', closeMessage: 'x' },
    ] as const;
    for (const phase of ['claimed', 'prepared'] as const) {
      for (const settlement of settlements) {
        expect(() => settleQueryRunRecord(advancedTo(phase), { settlement, history: { kind: 'unchanged' }, occurredAt: at }))
          .toThrow(new RegExp(`requires phase entering/entered/unknown, not ${phase}$`));
      }
    }
  });

  it('refuses a QueryJob that is already settled', () => {
    const records = advancedTo('entered');
    for (const status of ['answered', 'closed'] as const) {
      const job: QueryJobSnapshot = { ...records.job, job: { ...records.job.job, status } };
      expect(() => settleQueryRunRecord({ job, run: records.run }, { settlement: { outcome: 'failed', closeMessage: 'x' }, history: { kind: 'unchanged' }, occurredAt: at }))
        .toThrow(new RegExp(`QueryJob is already ${status}`));
    }
  });

  it('does not alias the caller-owned history', () => {
    const input = history();
    const after = settleQueryRunRecord(advancedTo('entered'), { settlement: { outcome: 'failed', closeMessage: 'x' }, history: { kind: 'set', history: input }, occurredAt: at });
    input.startPosition = 99;
    expect(after.run.run.executionState?.history).toEqual(history());
  });

  it('writes the §8.1 invariant and agrees with the machine next state of QRR-03', () => {
    for (const outcome of ['timeout', 'gap', 'failed', 'cancelled'] as const) {
      const fact = terminal({ outcome });
      const result = transitionQueryRunRecovery(stateAt('entered'), { kind: 'query_terminal_observed', terminal: fact }, serviceCtx());
      if (!result.ok) throw new Error(result.detail);
      const settle = result.effects[0];
      if (settle?.kind !== 'settle_query') throw new Error('QRR-03 starts with settle_query');
      const after = settleQueryRunRecord(advancedTo('entered'), { settlement: settle.settlement, history: settle.history, occurredAt: at });
      expect(stateOf(after)).toEqual(result.next);
      expect(after.job.job.closeReason).toEqual({ code: outcome, message: 'model failed' });
    }
  });

  it('refuses a QueryRun that is already settled or has no execution state', () => {
    const settled = settleQueryRunRecord(advancedTo('entered'), { settlement: { outcome: 'failed', closeMessage: 'x' }, history: { kind: 'unchanged' }, occurredAt: at });
    expect(() => settleQueryRunRecord(settled, { settlement: { outcome: 'failed', closeMessage: 'y' }, history: { kind: 'unchanged' }, occurredAt: at })).toThrow(/not settled$/);
    expect(() => settleQueryRunRecord(settled, { settlement: { outcome: 'not_entered', closeMessage: 'y' }, history: { kind: 'unchanged' }, occurredAt: at })).toThrow(/not settled$/);
    expect(() => settleQueryRunRecord(pending(), { settlement: { outcome: 'failed', closeMessage: 'y' }, history: { kind: 'unchanged' }, occurredAt: at })).toThrow(/not absent$/);
  });
});

describe('queryRecoveryStateOf', () => {
  it('reads phase, both statuses, outcome and endedAt', () => {
    const records = settleQueryRunRecord(advancedTo('entered'), { settlement: { outcome: 'cancelled', closeMessage: 'stop' }, history: { kind: 'unchanged' }, occurredAt: '2026-10-04T00:00:09.000Z' });
    expect(stateOf(records)).toEqual({ phase: 'settled', runStatus: 'closed', jobStatus: 'closed', outcome: 'cancelled', ended: true });
  });
});
