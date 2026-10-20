/**
 * Slice 2C rows 2C-01, 2C-02, 2C-38 at entry LE1 (`state/line-status.ts`).
 *
 * LE1 is only for cases the public services cannot build (spec §5.1, §5.2):
 * - 2C-01: the T2 defensive branches (no writer today), T1 before T2 on a
 *   legacy `healthConclusion: null`, and the T0 binding to the exact
 *   `afterRunRef` Run;
 * - 2C-02: `round_ambiguous` / `origin_unresolvable` (P10/P15, only when a
 *   stored check record is ambiguous or the basis plan is unreadable);
 * - 2C-38: a goal-cause card with several task pins (today's cards carry one;
 *   the multi-pin shape is `required_task_deferred`, which falls on no line).
 *
 * Expected values are the literal words and codes of §3.2/§3.4/§3.9/L8, hand
 * computed; nothing is read back from the product.
 */
import { describe, expect, it } from 'vitest';
import type { ControlIntentRef, ControlIntentSnapshotV1, ControlPlatformObservationV1 } from '../../src/contracts/control-intent.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { RunReconciliationV1, RunRef, RunSnapshot, RuntimeEventV1, TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import {
  cardLineKeys, classifyTaskAttention, deriveLineControls, deriveLineStatus,
  type LineCardInputV1, type LineDoneEvidenceV1, type LineFactsV1, type LineOwnerIndexV1,
  type LineRunFactsV1, type LineTaskFactV1,
} from '../../src/core/work-graph/state/line-status.js';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const P = 'p';
const G = 'g';
const W = 'w';
const T0 = '2026-10-08T00:00:00.000Z';

const TASK_A: TaskTriple = { projectId: P, goalId: G, taskId: 'A' };
const TASK_B: TaskTriple = { projectId: P, goalId: G, taskId: 'B' };
const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};
const SESSION_H: SessionRef = { projectId: P, sessionId: 'h' };
const SESSION_A: SessionRef = { projectId: P, sessionId: 'sa' };
const SESSION_B: SessionRef = { projectId: P, sessionId: 'sb' };
const INTENT_REF: ControlIntentRef = { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId: 'i-pause' };

const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });
const RUN_R1 = runRef('r1');
const RUN_R2 = runRef('r2');

const refKey = (ref: unknown): string => canonicalJson(ref as never);
const taskKey = (task: TaskTriple): string => canonicalJson(task as never);

function sessionRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: { ...SESSION_H, aggregateType: 'Session' }, revision: 3,
    kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-h' },
    lifecycle: 'active', health: 'available', healthConclusion: null,
    role: { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' }, workspaceId: W,
    lastExecutionRef: null, occupancy: null, historyCursor: null, createdAt: T0, archivedAt: null,
    provenance: { schemaVersion: 1, kind: 'new' }, archiveRequest: null, unavailableSince: null,
    ...over,
  };
}

function runOf(ref: RunRef, over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    ref, revision: 4, schemaVersion: 1, task: TASK_A, attemptId: `${ref.runId}-attempt`, planRef: PLAN,
    roleBinding: ROLE_BINDING, budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 1 },
    status: 'ended', outcome: 'completed', exitCode: 0, lastEventSeq: 2, lastRuntimeEventId: `rt-${ref.runId}`,
    lastFactEventId: `ev-${ref.runId}`, envelope: null, startedAt: T0, endedAt: T0, ...over,
  };
}

const RUNTIME_CRASH: RuntimeEventV1 = {
  eventType: 'run_crashed', schemaVersion: 1, eventId: 'evt-crash', runRef: RUN_R1, sequence: 3, occurredAt: T0,
  payload: { kind: 'crashed', error: 'host restart' },
};

/** RUN-24: an `interrupted_clean` Run that names the pointer pause intent (C4). */
function run24(ref: RunRef = RUN_R1): RunSnapshot {
  const reconciliation: RunReconciliationV1 = {
    status: 'done', basis: { kind: 'live_clean' }, recordedAt: T0,
    observation: { kind: 'interrupted_clean', event: { ...RUNTIME_CRASH, runRef: ref }, lastPosition: null, kernelPaused: true, pausedIntentRef: INTENT_REF },
  };
  return runOf(ref, { outcome: 'crashed', reconciliation });
}

/** An applied, observed pause pointer (D-7 platform pause, or a live safe-point pause). */
function pauseApplied(): ControlIntentSnapshotV1 {
  const observation: ControlPlatformObservationV1 = {
    schemaVersion: 1, origin: 'platform_paused_stop', kind: 'paused', runRevision: 2,
    detail: { basis: 'live_clean', pausedBy: null }, observedAt: T0,
  };
  return {
    schemaVersion: 1, ref: INTENT_REF, runRef: RUN_R1, kind: 'pause', desiredState: 'paused',
    reason: null, requestedAt: T0, requestedBy: { kind: 'system', id: 'workflow' },
    revision: 2, status: 'applied', observation,
  };
}

function runFacts(run: RunSnapshot, over: Partial<LineRunFactsV1> = {}): LineRunFactsV1 {
  return { run, pointer: null, pointerFromGoal: false, continuationConsumed: false, goalDesiredState: 'active', ...over };
}

function taskFact(over: Partial<LineTaskFactV1> = {}): LineTaskFactV1 {
  return {
    task: TASK_A, title: '任务 A', planOrder: 1, goalDesiredState: 'active',
    phase: 'blocked', phaseCause: null, disposition: 'active', everRan: true, terminal: false,
    lastRequeue: null, module: null, anomaly: null, anomalyComplete: true, cards: [],
    ...over,
  };
}

function facts(over: Partial<LineFactsV1> = {}): LineFactsV1 {
  return {
    head: sessionRecord(), chain: [], omitted: { status: 'exact', value: 0 }, duty: 'executor',
    holder: null, latestWork: null, responsibleOpen: [], responsibleOpenOther: [],
    doneEvidence: { status: 'not_applicable' }, pausedTasks: [], lineCards: [],
    writtenAnchorsPending: { status: 'exact', value: 0 }, copies: [], undelivered: { status: 'not_applicable' },
    partialParts: [], handoffFrom: null, handoffFromLine: null, handedTo: null,
    provenanceUnchecked: false, legacyUncheckedInWorkspace: { status: 'exact', value: 0 },
    unknownCallReviewsPending: 0, queueComplete: true, pinned: false, lastActivityAt: T0,
    ...over,
  };
}

// --------------------------------------------------------------------------
// 2C-01 — deriveLineStatus, the cases today's services cannot build
// --------------------------------------------------------------------------

describe('2C-01 deriveLineStatus', () => {
  it('2C-01 T2 defensive: health recoverable is 待核对 with health_recoverable', () => {
    const status = deriveLineStatus(facts({ head: sessionRecord({ health: 'recoverable' }) }));
    expect(status.own).toBe('unknown');
    expect(status.ownReason.code).toBe('health_recoverable');
  });

  it('2C-01 T2 defensive: a maintenance occupancy is 待核对 with occupancy_unexplained', () => {
    const status = deriveLineStatus(facts({ holder: { kind: 'maintenance' } }));
    expect(status.own).toBe('unknown');
    expect(status.ownReason.code).toBe('occupancy_unexplained');
  });

  it('2C-01 T0 binding: afterRunRef pointing at another Run is 已退役, not 已暂停', () => {
    const paused = taskFact({
      phaseCause: { code: 'paused_interrupted', detail: { afterRunRef: RUN_R2, pausedIntentRef: INTENT_REF, kernelPaused: true } },
    });
    const status = deriveLineStatus(facts({
      head: sessionRecord({ health: 'unavailable', healthConclusion: 'kernel_turn_open' }),
      latestWork: { ...runFacts(run24(), { pointer: pauseApplied(), pointerFromGoal: true, goalDesiredState: 'paused' }), waitRecipient: null },
      responsibleOpen: [paused],
    }));
    expect(status.own).toBe('retired');
    expect(status.ownReason.code).toBe('retired_turn_open');
  });

  it('2C-01 T0 binding: afterRunRef pointing at the latest Run is 已暂停 with by/goal params', () => {
    const paused = taskFact({
      phaseCause: { code: 'paused_interrupted', detail: { afterRunRef: RUN_R1, pausedIntentRef: INTENT_REF, kernelPaused: true } },
    });
    const status = deriveLineStatus(facts({
      head: sessionRecord({ health: 'unavailable', healthConclusion: 'kernel_turn_open' }),
      latestWork: { ...runFacts(run24(), { pointer: pauseApplied(), pointerFromGoal: true, goalDesiredState: 'paused' }), waitRecipient: null },
      responsibleOpen: [paused],
    }));
    expect(status.own).toBe('paused');
    expect(status.ownReason.code).toBe('paused_interrupted');
    expect(status.ownReason.params).toMatchObject({ by: 'goal', goal: 'paused' });
  });

  it('A2 an archived head never accepts DE1 inherited from an active predecessor', () => {
    const doneEvidence: LineDoneEvidenceV1 = {
      status: 'read', openTerminal: [{ task: TASK_A, title: '任务 A' }], recent: [],
      total: { status: 'exact', value: 0 }, budgetExhausted: false,
    };
    const status = deriveLineStatus(facts({
      head: sessionRecord({ lifecycle: 'archived', archivedAt: T0 }),
      doneEvidence,
    }));
    expect(status.own).toBe('standby');
    expect(status.doneEvidence).toBe('complete');
    expect(status.archivedTag).toBe('plain');
  });

  it('2C-17/RD-8 a consumed continuation takes no pause or cancel on the yielded Run', () => {
    const yielded = runOf(runRef('ry'), { status: 'ended', outcome: 'yielded',
      continuation: { schemaVersion: 1, kind: 'wait_reply', task: TASK_A, sessionRef: SESSION_H,
        messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'wait' } } });
    const lineFacts = facts({
      holder: null,
      latestWork: { ...runFacts(yielded, { continuationConsumed: true }), waitRecipient: null },
    });
    const status = deriveLineStatus(lineFacts);
    expect(status.own).toBe('waiting_reply');
    for (const kind of ['pause', 'cancel'] as const) {
      const control = deriveLineControls(lineFacts, status).find((entry) => entry.kind === kind);
      expect(control?.availability).toBe('unavailable');
      expect(control?.reasonCode).toBe('busy');
    }
  });
});

// --------------------------------------------------------------------------
// 2C-02 — classifyTaskAttention, the P10/P15 blocked causes
// --------------------------------------------------------------------------

describe('2C-02 classifyTaskAttention', () => {
  it('2C-02 round_ambiguous is 受阻', () => {
    const attention = classifyTaskAttention(taskFact({ phase: 'blocked', phaseCause: { code: 'round_ambiguous' } }));
    expect(attention).toEqual({ code: 'blocked', reason: { code: 'round_ambiguous', params: {}, refs: [] } });
  });

  it('2C-02 origin_unresolvable is 受阻', () => {
    const attention = classifyTaskAttention(taskFact({ phase: 'blocked', phaseCause: { code: 'origin_unresolvable' } }));
    expect(attention).toEqual({ code: 'blocked', reason: { code: 'origin_unresolvable', params: {}, refs: [] } });
  });
});

// --------------------------------------------------------------------------
// 2C-38 — cardLineKeys, the multi-task-pin goal cause card
// --------------------------------------------------------------------------

describe('2C-38 cardLineKeys', () => {
  const cardWith = (over: Partial<LineCardInputV1> = {}): LineCardInputV1 =>
    ({ senderSessionRef: null, forwardedFromSender: null, taskPins: [], excluded: false, ...over });

  it('2C-38 a card whose several task pins are all handled by one line yields it once', () => {
    const taskPins = [TASK_A, TASK_B];
    const owners: LineOwnerIndexV1 = {
      lineOfSession: new Map(),
      linesOfTask: new Map([[taskKey(TASK_A), [SESSION_A]], [taskKey(TASK_B), [SESSION_A]]]),
    };
    expect(cardLineKeys(cardWith({ taskPins }), owners).map(refKey)).toEqual([refKey(SESSION_A)]);
  });

  it('2C-38 two tasks handled by two lines yield both lines', () => {
    const owners: LineOwnerIndexV1 = {
      lineOfSession: new Map(),
      linesOfTask: new Map([[taskKey(TASK_A), [SESSION_A]], [taskKey(TASK_B), [SESSION_B]]]),
    };
    expect(cardLineKeys(cardWith({ taskPins: [TASK_A, TASK_B] }), owners).map(refKey).sort())
      .toEqual([refKey(SESSION_A), refKey(SESSION_B)].sort());
  });

  it('2C-38 a sender that is also on one of the lines does not double count it', () => {
    const owners: LineOwnerIndexV1 = {
      lineOfSession: new Map([[refKey(SESSION_A), [SESSION_A]]]),
      linesOfTask: new Map([[taskKey(TASK_A), [SESSION_A]], [taskKey(TASK_B), [SESSION_B]]]),
    };
    const lines = cardLineKeys(cardWith({ senderSessionRef: SESSION_A, taskPins: [TASK_A, TASK_B] }), owners).map(refKey).sort();
    expect(lines).toEqual([refKey(SESSION_A), refKey(SESSION_B)].sort());
  });

  it('2C-38 an excluded card falls on no line', () => {
    const owners: LineOwnerIndexV1 = {
      lineOfSession: new Map([[refKey(SESSION_A), [SESSION_A]]]),
      linesOfTask: new Map([[taskKey(TASK_A), [SESSION_A]]]),
    };
    expect(cardLineKeys(cardWith({ senderSessionRef: SESSION_A, taskPins: [TASK_A], excluded: true }), owners)).toEqual([]);
  });
});
