/**
 * Exhaustive table tests for the pure ControlIntent machine
 * (docs/refactor/STATE-MACHINES-SPEC.md §7; A.2 step 2, §15.2).
 *
 * Every (state, event) combination is answered: legal ones assert `next` and
 * `effects`, illegal ones assert `reason` and `code` from §7.4. Rows whose 现状
 * is 改造 assert TODAY's result (`control-service.ts`, the codec pairing in
 * `control-record-codecs.ts`); the comments tagged `step 5.1 flip` name the
 * target the row changes to. Rows whose 现状 is 新增 (CTL-02, CTL-04, CTL-07,
 * CTL-08, CTL-10) still answer `illegal`/`invalid`.
 *
 * Small literal fixtures only: no RecordStore, no Kernel. The snapshot codec
 * (pure) cross-checks that the record constructors and the pairing rule agree
 * with what a commit accepts today.
 */
import { describe, expect, it } from 'vitest';
import type {
  ControlIntentKindV1, ControlIntentRef, ControlIntentRequestV1, ControlObservationV1, ControlPlatformObservationV1,
} from '../../src/contracts/control-intent.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type { CoreError } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import {
  decodeControlIntentSnapshot, encodeControlIntentSnapshot,
} from '../../src/core/work-graph/persistence/control-record-codecs.js';
import {
  controlIntentRecordOf, controlIntentRequestOf, controlIntentStateOf, controlSubmissionProblem, controlSubmitProblem,
  desiredStateOfKind, newControlIntentRequest, newQueuedControlIntentRecord, observationPairingProblem,
  observationStatusFor, observedIntentProblem, pointerAfterSubmit, submissionReadsPointerIntent, transitionControlIntent,
  type ControlGuardContext, type ControlIntentEffect, type ControlIntentEvent, type ControlIntentState,
  type ControlNode, type ControlObservationKind, type ControlPointerIntent, type ControlRunNode, type ControlTransition,
  type RunControlPointer,
} from '../../src/core/work-graph/state/control-intent-machine.js';
import type { TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';

// -------------------------------------------------------------------------- //
// Fixtures                                                                   //
// -------------------------------------------------------------------------- //

const PROJECT = 'p-control';
const WORKSPACE = 'w-control';
const RUN: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: 'g-1', runId: 'run-1' };
function intentRef(intentId: string): ControlIntentRef {
  return { aggregateType: 'ControlIntent', projectId: PROJECT, workspaceId: WORKSPACE, intentId };
}
const SELF = intentRef('self');
const OTHER = intentRef('other');
const AT = '2026-10-04T01:00:00.000Z';
const KERNEL = { adapterId: 'adapter-1', kernelSessionId: 'ks-1', runId: 'kr-1', turnId: 'kt-1' };
const LOCATOR: RunExecutionHistoryV1 = { schemaVersion: 1, sessionRef: { projectId: PROJECT, sessionId: 's-1' },
  kernel: { ...KERNEL }, startPosition: 3, observedThroughPosition: 10, endPosition: null };
const ENTRY = { consumerId: 'consumer-1', entryGeneration: 1, sessionGeneration: 2 };

const KINDS: readonly ControlIntentKindV1[] = ['pause', 'cancel', 'resume', 'steer'];
const KERNEL_KINDS: readonly ControlObservationV1['kind'][] = [
  'paused', 'cancelled', 'resumed', 'steered', 'terminal_without_cancel', 'outcome_unknown',
];
const PLATFORM_KINDS: readonly ControlPlatformObservationV1['kind'][] = [
  'paused', 'cancelled', 'resumed', 'superseded_by_newer', 'terminal_without_cancel', 'outcome_unknown',
];
/** `satisfies Record<…>` makes a node or pointer added to (or renamed in) the union fail typecheck here. */
const RUN_NODE_SET = {
  Absent: true, Claimed: true, Authorized: true, Entering: true, Revoked: true,
  Running: true, Ended: true, YieldedWait: true, EndedUnknown: true,
} satisfies Record<ControlRunNode, true>;
const RUN_NODES = Object.keys(RUN_NODE_SET) as ControlRunNode[];
const POINTER_SET = { none: true, running: true, paused: true, cancelled: true, steered: true } satisfies Record<RunControlPointer, true>;
const POINTERS = Object.keys(POINTER_SET) as RunControlPointer[];

function kernelObservation(kind: ControlObservationV1['kind'], patch: Partial<ControlObservationV1> = {}): ControlObservationV1 {
  return { schemaVersion: 1, kind, entry: { ...ENTRY },
    history: { ...LOCATOR, sessionRef: { ...LOCATOR.sessionRef }, kernel: { ...KERNEL } },
    source: { ...KERNEL, position: 5 }, kernelEventId: 'ke-1', kernelEventSequence: 7, observedAt: AT, ...patch };
}
function platformObservation(kind: ControlPlatformObservationV1['kind']): ControlPlatformObservationV1 {
  const base = { schemaVersion: 1 as const, kind, runRevision: 4, observedAt: AT };
  switch (kind) {
    case 'cancelled':
    case 'resumed':
      return { ...base, origin: 'platform_not_entered', detail: { entryPhase: 'authorized' } };
    case 'superseded_by_newer':
      return { ...base, origin: 'platform_superseded', detail: { supersededBy: OTHER } };
    case 'paused':
      return { ...base, origin: 'platform_reconcile', detail: { hostInstanceId: 'host-1', runOutcome: 'crashed' } };
    case 'terminal_without_cancel':
      return { ...base, origin: 'platform_reconcile', detail: { hostInstanceId: 'host-1', runOutcome: 'completed' } };
    case 'outcome_unknown':
      return { ...base, origin: 'platform_reconcile', detail: { hostInstanceId: 'host-1', runOutcome: 'outcome_unknown' } };
    default: throw new Error(`unknown platform kind ${String(kind)}`);
  }
}

function ctxWith(
  run: Partial<ControlGuardContext['run']> = {},
  rest: Partial<Omit<ControlGuardContext, 'run'>> = {},
): ControlGuardContext {
  return {
    run: { node: 'Running', pointer: 'none', pointsHere: true, inControlInputs: true, continuationConsumed: false,
      kernelPaused: false, pausedInterrupted: false, entry: { ...ENTRY },
      history: { ...LOCATOR, sessionRef: { ...LOCATOR.sessionRef }, kernel: { ...KERNEL } }, ...run },
    goal: { desiredState: 'active' }, pointerIntent: null, pinsMatch: { intent: true, run: true },
    exitProof: null, origin: 'live', ...rest,
  };
}

// -------------------------------------------------------------------------- //
// States                                                                     //
// -------------------------------------------------------------------------- //

const ABSENT: ControlIntentState = { node: 'Absent', kind: null, revision: 0, observation: null };
function queued(kind: ControlIntentKindV1): ControlIntentState {
  return { node: 'Queued', kind, revision: 1, observation: null };
}
const APPLIED_OBSERVATION: Record<ControlIntentKindV1, ControlObservationV1> = {
  pause: kernelObservation('paused'), cancel: kernelObservation('cancelled'),
  resume: kernelObservation('resumed'), steer: kernelObservation('steered'),
};
function applied(kind: ControlIntentKindV1): ControlIntentState {
  return { node: 'Applied', kind, revision: 2, observation: APPLIED_OBSERVATION[kind] };
}
function superseded(kind: ControlIntentKindV1): ControlIntentState {
  return { node: 'Superseded', kind, revision: 2,
    observation: kind === 'cancel' ? kernelObservation('terminal_without_cancel') : platformObservation('superseded_by_newer') };
}
function outcomeUnknown(kind: ControlIntentKindV1): ControlIntentState {
  return { node: 'OutcomeUnknown', kind, revision: 2,
    observation: kind === 'cancel' ? kernelObservation('outcome_unknown') : platformObservation('outcome_unknown') };
}

type StateLabel = 'Absent' | `${Exclude<ControlNode, 'Absent'>}:${ControlIntentKindV1}`;
const STATES: Record<StateLabel, ControlIntentState> = {
  Absent: ABSENT,
  'Queued:pause': queued('pause'), 'Queued:cancel': queued('cancel'),
  'Queued:resume': queued('resume'), 'Queued:steer': queued('steer'),
  'Applied:pause': applied('pause'), 'Applied:cancel': applied('cancel'),
  'Applied:resume': applied('resume'), 'Applied:steer': applied('steer'),
  'Superseded:pause': superseded('pause'), 'Superseded:cancel': superseded('cancel'),
  'Superseded:resume': superseded('resume'), 'Superseded:steer': superseded('steer'),
  'OutcomeUnknown:pause': outcomeUnknown('pause'), 'OutcomeUnknown:cancel': outcomeUnknown('cancel'),
  'OutcomeUnknown:resume': outcomeUnknown('resume'), 'OutcomeUnknown:steer': outcomeUnknown('steer'),
};
const STATE_LABELS = Object.keys(STATES) as StateLabel[];

// -------------------------------------------------------------------------- //
// Expectation helpers                                                        //
// -------------------------------------------------------------------------- //

type Expected =
  | { ok: true; next: ControlIntentState; effects: ControlIntentEffect[] }
  | { ok: false; reason: TransitionRejectReason; code: CoreError };
function fail(reason: TransitionRejectReason, code: CoreError): Expected {
  return { ok: false, reason, code };
}
const ILLEGAL = fail('illegal', 'invalid');
const IDENTITY_REUSED = fail('duplicate', 'idempotency_conflict');

function check(actual: ControlTransition, expected: Expected): void {
  if (expected.ok) {
    expect(actual).toEqual(expected);
  } else {
    expect(actual.ok).toBe(false);
    expect(actual).toMatchObject({ reason: expected.reason, code: expected.code });
  }
}
function submitted(kind: ControlIntentKindV1, intent: ControlIntentRef = SELF): Expected {
  return { ok: true, next: queued(kind), effects: [{ kind: 'run_pointer', change: pointerAfterSubmit(kind, intent) }] };
}
function observedTo(state: ControlIntentState, node: Exclude<ControlNode, 'Absent' | 'Queued'>, observation: ControlObservationV1): Expected {
  return { ok: true, next: { node, kind: state.kind, revision: state.revision + 1, observation }, effects: [{ kind: 'guard_run' }] };
}

type SubmitEvent = Extract<ControlIntentEvent, { type: 'control_submitted' }>;
type ObservedEvent = Extract<ControlIntentEvent, { type: 'control_observed' }>;
function submitEvent(kind: ControlIntentKindV1, reason: string | null = 'operator reason',
  target: 'run' | 'query_run' = 'run'): SubmitEvent {
  return { type: 'control_submitted', target, intentRef: SELF, kind, reason };
}
function observedEvent(observation: ControlObservationV1): ObservedEvent {
  return { type: 'control_observed', observation };
}

/** One representative payload per event type; `satisfies` keeps the list complete. */
const EVENTS = {
  control_submitted: submitEvent('cancel', 'stop now'),
  control_applied_not_entered: { type: 'control_applied_not_entered', intentRef: SELF, kind: 'cancel', reason: null,
    entryPhase: 'none', runRevision: 4, observedAt: AT },
  control_superseded_by_newer: { type: 'control_superseded_by_newer', supersededBy: OTHER, runRevision: 4, observedAt: AT },
  control_observed: observedEvent(kernelObservation('cancelled')),
  control_applied_paused_stop: { type: 'control_applied_paused_stop', basis: 'live_clean', pausedBy: OTHER,
    runRevision: 4, observedAt: AT },
  control_reconciled: { type: 'control_reconciled', hostInstanceId: 'host-1', observation: platformObservation('terminal_without_cancel') },
} satisfies { [T in ControlIntentEvent['type']]: Extract<ControlIntentEvent, { type: T }> };
type EventType = keyof typeof EVENTS;
const EVENT_TYPES = Object.keys(EVENTS) as EventType[];

// -------------------------------------------------------------------------- //
// The full (state, event) matrix                                             //
// -------------------------------------------------------------------------- //

/**
 * Base context: an entered `Running` Run without a pointer, every pin current,
 * the pointer naming this intent and the steer listed in `controlInputs`.
 */
const MATRIX: Record<EventType, Record<StateLabel, Expected>> = {
  // CTL-01 from Absent; an existing intent at the same derived ref is the same identity with other content.
  control_submitted: {
    Absent: submitted('cancel'),
    'Queued:pause': IDENTITY_REUSED, 'Queued:cancel': IDENTITY_REUSED, 'Queued:resume': IDENTITY_REUSED, 'Queued:steer': IDENTITY_REUSED,
    'Applied:pause': IDENTITY_REUSED, 'Applied:cancel': IDENTITY_REUSED, 'Applied:resume': IDENTITY_REUSED, 'Applied:steer': IDENTITY_REUSED,
    'Superseded:pause': IDENTITY_REUSED, 'Superseded:cancel': IDENTITY_REUSED, 'Superseded:resume': IDENTITY_REUSED, 'Superseded:steer': IDENTITY_REUSED,
    'OutcomeUnknown:pause': IDENTITY_REUSED, 'OutcomeUnknown:cancel': IDENTITY_REUSED,
    'OutcomeUnknown:resume': IDENTITY_REUSED, 'OutcomeUnknown:steer': IDENTITY_REUSED,
  },
  // CTL-02 is 新增 everywhere (step 5.1 flip: Absent → Applied@2; an existing intent answers like CTL-01);
  // from Entering/Running it is also the §7.4 internal assertion.
  control_applied_not_entered: {
    Absent: ILLEGAL,
    'Queued:pause': ILLEGAL, 'Queued:cancel': ILLEGAL, 'Queued:resume': ILLEGAL, 'Queued:steer': ILLEGAL,
    'Applied:pause': ILLEGAL, 'Applied:cancel': ILLEGAL, 'Applied:resume': ILLEGAL, 'Applied:steer': ILLEGAL,
    'Superseded:pause': ILLEGAL, 'Superseded:cancel': ILLEGAL, 'Superseded:resume': ILLEGAL, 'Superseded:steer': ILLEGAL,
    'OutcomeUnknown:pause': ILLEGAL, 'OutcomeUnknown:cancel': ILLEGAL, 'OutcomeUnknown:resume': ILLEGAL, 'OutcomeUnknown:steer': ILLEGAL,
  },
  // CTL-04 is 新增 (step 5.1 flip: Queued → Superseded); §7.4: only a queued intent can be superseded.
  control_superseded_by_newer: {
    Absent: ILLEGAL,
    'Queued:pause': ILLEGAL, 'Queued:cancel': ILLEGAL, 'Queued:resume': ILLEGAL, 'Queued:steer': ILLEGAL,
    'Applied:pause': ILLEGAL, 'Applied:cancel': ILLEGAL, 'Applied:resume': ILLEGAL, 'Applied:steer': ILLEGAL,
    'Superseded:pause': ILLEGAL, 'Superseded:cancel': ILLEGAL, 'Superseded:resume': ILLEGAL, 'Superseded:steer': ILLEGAL,
    'OutcomeUnknown:pause': ILLEGAL, 'OutcomeUnknown:cancel': ILLEGAL, 'OutcomeUnknown:resume': ILLEGAL, 'OutcomeUnknown:steer': ILLEGAL,
  },
  // CTL-03 for the cancel; today's codec pairing rejects a Kernel `cancelled` on any other kind.
  // Recorded cancels are re-observed today (step 5.1 flip, CTL-09 / §7.4: duplicate or stale).
  control_observed: {
    Absent: fail('illegal', 'not_found'),
    'Queued:pause': ILLEGAL, 'Queued:cancel': observedTo(queued('cancel'), 'Applied', kernelObservation('cancelled')),
    'Queued:resume': ILLEGAL, 'Queued:steer': ILLEGAL,
    'Applied:pause': ILLEGAL, 'Applied:cancel': observedTo(applied('cancel'), 'Applied', kernelObservation('cancelled')),
    'Applied:resume': ILLEGAL, 'Applied:steer': ILLEGAL,
    'Superseded:pause': ILLEGAL, 'Superseded:cancel': observedTo(superseded('cancel'), 'Applied', kernelObservation('cancelled')),
    'Superseded:resume': ILLEGAL, 'Superseded:steer': ILLEGAL,
    'OutcomeUnknown:pause': ILLEGAL,
    'OutcomeUnknown:cancel': observedTo(outcomeUnknown('cancel'), 'Applied', kernelObservation('cancelled')),
    'OutcomeUnknown:resume': ILLEGAL, 'OutcomeUnknown:steer': ILLEGAL,
  },
  // CTL-10 is 新增 (step 5.6 flip: Queued cancel → Applied).
  control_applied_paused_stop: {
    Absent: ILLEGAL,
    'Queued:pause': ILLEGAL, 'Queued:cancel': ILLEGAL, 'Queued:resume': ILLEGAL, 'Queued:steer': ILLEGAL,
    'Applied:pause': ILLEGAL, 'Applied:cancel': ILLEGAL, 'Applied:resume': ILLEGAL, 'Applied:steer': ILLEGAL,
    'Superseded:pause': ILLEGAL, 'Superseded:cancel': ILLEGAL, 'Superseded:resume': ILLEGAL, 'Superseded:steer': ILLEGAL,
    'OutcomeUnknown:pause': ILLEGAL, 'OutcomeUnknown:cancel': ILLEGAL, 'OutcomeUnknown:resume': ILLEGAL, 'OutcomeUnknown:steer': ILLEGAL,
  },
  // CTL-07 / CTL-08 are 新增 (step 5.6 flip); §7.4: terminal intents are skipped by reconcile.
  control_reconciled: {
    Absent: ILLEGAL,
    'Queued:pause': ILLEGAL, 'Queued:cancel': ILLEGAL, 'Queued:resume': ILLEGAL, 'Queued:steer': ILLEGAL,
    'Applied:pause': ILLEGAL, 'Applied:cancel': ILLEGAL, 'Applied:resume': ILLEGAL, 'Applied:steer': ILLEGAL,
    'Superseded:pause': ILLEGAL, 'Superseded:cancel': ILLEGAL, 'Superseded:resume': ILLEGAL, 'Superseded:steer': ILLEGAL,
    'OutcomeUnknown:pause': ILLEGAL, 'OutcomeUnknown:cancel': ILLEGAL, 'OutcomeUnknown:resume': ILLEGAL, 'OutcomeUnknown:steer': ILLEGAL,
  },
};

describe('ControlIntent machine: every (state, event) combination', () => {
  for (const type of EVENT_TYPES) {
    for (const label of STATE_LABELS) {
      it(`${label} × ${type}`, () => {
        check(transitionControlIntent(STATES[label], EVENTS[type], ctxWith()), MATRIX[type][label]);
      });
    }
  }
});

// -------------------------------------------------------------------------- //
// control_submitted (CTL-01, §7.4 Absent rows)                               //
// -------------------------------------------------------------------------- //

/** The intent the pointer names, as `submitControl` reads it for a resume. */
const POINTER_INTENT: Record<RunControlPointer, ControlGuardContext['pointerIntent']> = {
  none: null,
  running: { kind: 'resume', status: 'queued', observed: null },
  paused: { kind: 'pause', status: 'applied', observed: 'paused' },
  cancelled: { kind: 'cancel', status: 'queued', observed: null },
  steered: { kind: 'steer', status: 'queued', observed: null },
};
/** `controlSubmitProblem` over the pointer (`control-service.ts:125-140`); every refusal is busy. */
const POINTER_FENCE: Record<RunControlPointer, Record<ControlIntentKindV1, 'ok' | 'busy'>> = {
  none: { pause: 'ok', cancel: 'ok', resume: 'busy', steer: 'ok' },
  running: { pause: 'ok', cancel: 'ok', resume: 'busy', steer: 'ok' },
  paused: { pause: 'busy', cancel: 'ok', resume: 'ok', steer: 'ok' },
  cancelled: { pause: 'busy', cancel: 'busy', resume: 'busy', steer: 'busy' },
  steered: { pause: 'ok', cancel: 'ok', resume: 'busy', steer: 'ok' },
};

describe('control_submitted from Absent: pointer × kind × Run node (CTL-01)', () => {
  for (const node of RUN_NODES) {
    for (const pointer of POINTERS) {
      for (const kind of KINDS) {
        it(`${node} / pointer ${pointer} / ${kind}`, () => {
          const result = transitionControlIntent(ABSENT, submitEvent(kind),
            ctxWith({ node, pointer }, { pointerIntent: POINTER_INTENT[pointer] }));
          if (node === 'Absent') return check(result, fail('illegal', 'not_found'));
          // §7.4: an ended Run (not YieldedWait) refuses every kind.
          if (node === 'Ended' || node === 'EndedUnknown') return check(result, fail('illegal', 'busy'));
          // Not-entered Runs still queue today (step 5.1 flip: CTL-02 applied@2 for pause/cancel/resume).
          check(result, POINTER_FENCE[pointer][kind] === 'ok' ? submitted(kind) : fail('guard_failed', 'busy'));
        });
      }
    }
  }

  it('a QueryRunRef target is refused before anything else (7.4, `control-service.ts:96`)', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('pause', null, 'query_run'),
      ctxWith({ node: 'Absent' }, { pinsMatch: { intent: false, run: false } })))
      .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'the control submission requires a complete RunRef' });
  });

  it('a missing Run is not_found before the Run pin is compared', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('pause'), ctxWith({ node: 'Absent' }, { pinsMatch: { intent: true, run: false } })))
      .toEqual({ ok: false, reason: 'illegal', code: 'not_found', detail: 'the target Run does not exist' });
  });

  it('a stale Run pin is stale/revision_conflict before the ended-Run check (7.4)', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('cancel'), ctxWith({ node: 'Ended' }, { pinsMatch: { intent: true, run: false } })))
      .toEqual({ ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the Run changed since the caller read it' });
  });

  it('an ended Run refuses the control with busy (7.4, `control-service.ts:389-391`)', () => {
    for (const node of ['Ended', 'EndedUnknown'] as const) {
      expect(transitionControlIntent(ABSENT, submitEvent('steer'), ctxWith({ node })))
        .toEqual({ ok: false, reason: 'illegal', code: 'busy', detail: 'the Run already ended; no new control intent is accepted' });
    }
  });

  it('the ended-Run refusal precedes the steer-text check (`control-service.ts:389-392`)', () => {
    for (const node of ['Ended', 'EndedUnknown'] as const) {
      for (const reason of [null, '', '   ']) {
        expect(transitionControlIntent(ABSENT, submitEvent('steer', reason), ctxWith({ node })))
          .toEqual({ ok: false, reason: 'illegal', code: 'busy', detail: 'the Run already ended; no new control intent is accepted' });
      }
    }
  });

  it('a paused-interrupted Run keeps today\'s generic ended reason (step 5.6 flip: continue-the-Task reason, C4)', () => {
    for (const kind of KINDS) {
      expect(transitionControlIntent(ABSENT, submitEvent(kind), ctxWith({ node: 'Ended', pausedInterrupted: true, pointer: 'paused' },
        { pointerIntent: POINTER_INTENT.paused })))
        .toEqual({ ok: false, reason: 'illegal', code: 'busy', detail: 'the Run already ended; no new control intent is accepted' });
    }
  });

  it('a steer without text is guard_failed/invalid, before the pointer fence (7.4, `:392`)', () => {
    for (const reason of [null, '', '   \n']) {
      expect(transitionControlIntent(ABSENT, submitEvent('steer', reason),
        ctxWith({ pointer: 'cancelled' }, { pointerIntent: POINTER_INTENT.cancelled })))
        .toEqual({ ok: false, reason: 'guard_failed', code: 'invalid', detail: 'steer requires the actual directional input text' });
    }
  });

  it('pause, cancel and resume need no reason text', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('pause', null), ctxWith())).toEqual(submitted('pause'));
    expect(transitionControlIntent(ABSENT, submitEvent('cancel', null), ctxWith())).toEqual(submitted('cancel'));
    expect(transitionControlIntent(ABSENT, submitEvent('resume', null), ctxWith({ pointer: 'paused' },
      { pointerIntent: POINTER_INTENT.paused }))).toEqual(submitted('resume'));
  });

  it('resume of a non-yielded Run needs the pointer intent to be an applied, observed pause (7.4, `:393-397`)', () => {
    const notObserved: ControlGuardContext['pointerIntent'][] = [
      null,
      { kind: 'pause', status: 'queued', observed: null },
      { kind: 'pause', status: 'superseded', observed: 'terminal_without_cancel' },
      { kind: 'pause', status: 'outcome_unknown', observed: 'outcome_unknown' },
      { kind: 'pause', status: 'applied', observed: 'cancelled' },
      { kind: 'cancel', status: 'applied', observed: 'paused' },
    ];
    for (const node of ['Claimed', 'Authorized', 'Entering', 'Revoked', 'Running'] as const) {
      for (const pointerIntent of notObserved) {
        expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith({ node, pointer: 'paused' }, { pointerIntent })))
          .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'resume requires an observed paused original Turn' });
      }
    }
  });

  it('the resume pause check precedes the pointer fence (a cancelled pointer names a cancel)', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith({ pointer: 'cancelled' },
      { pointerIntent: POINTER_INTENT.cancelled })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'resume requires an observed paused original Turn' });
  });

  it('a YieldedWait resume skips the applied-pause check but keeps the pointer fence (RUN-14)', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith({ node: 'YieldedWait', pointer: 'paused' },
      { pointerIntent: { kind: 'pause', status: 'queued', observed: null } }))).toEqual(submitted('resume'));
    expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith({ node: 'YieldedWait', pointer: 'none' })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'resume requires a formal pause' });
    expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith({ node: 'YieldedWait', pointer: 'cancelled' },
      { pointerIntent: POINTER_INTENT.cancelled })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'the Run is already fenced by a queued cancel control intent' });
  });

  it('the pointer fence answers with today\'s busy reasons (7.4, `:127-137`)', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith()))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'resume requires a formal pause' });
    expect(transitionControlIntent(ABSENT, submitEvent('pause'), ctxWith({ pointer: 'paused' }, { pointerIntent: POINTER_INTENT.paused })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'the Run is already fenced by a queued pause control intent' });
    expect(transitionControlIntent(ABSENT, submitEvent('steer'), ctxWith({ pointer: 'cancelled' }, { pointerIntent: POINTER_INTENT.cancelled })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'the Run is already fenced by a queued cancel control intent' });
    expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith({ node: 'YieldedWait', pointer: 'running' },
      { pointerIntent: POINTER_INTENT.running })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'the Run is not fenced by a pause control intent' });
  });

  it('the accepted submission is Queued@1 and moves the pointer or appends the steer in the same commit', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('pause'), ctxWith())).toEqual({ ok: true,
      next: { node: 'Queued', kind: 'pause', revision: 1, observation: null },
      effects: [{ kind: 'run_pointer', change: { kind: 'set_pointer', controlState: { intentRef: SELF, desiredState: 'paused' } } }] });
    expect(transitionControlIntent(ABSENT, submitEvent('steer', 'look at foo.ts'), ctxWith({ pointer: 'paused' },
      { pointerIntent: POINTER_INTENT.paused }))).toEqual({ ok: true,
      next: { node: 'Queued', kind: 'steer', revision: 1, observation: null },
      effects: [{ kind: 'run_pointer', change: { kind: 'append_input', intentRef: SELF } }] });
  });

  it('a cancel after a queued pause only moves the pointer today (step 5.1 flip, CTL-04: supersede the pause)', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('cancel'), ctxWith({ pointer: 'paused' },
      { pointerIntent: { kind: 'pause', status: 'queued', observed: null } }))).toEqual(submitted('cancel'));
  });

  it('a resume while the Goal is not active is accepted today (step 5.1 flip, D-9: guard_failed/busy)', () => {
    for (const desiredState of ['paused', 'cancelled'] as const) {
      expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith({ pointer: 'paused' },
        { pointerIntent: POINTER_INTENT.paused, goal: { desiredState } }))).toEqual(submitted('resume'));
    }
  });

  it('a control on a YieldedWait whose continuation was consumed is accepted today (step 5.1 flip, RD-8: busy)', () => {
    for (const kind of ['pause', 'cancel', 'steer'] as const) {
      expect(transitionControlIntent(ABSENT, submitEvent(kind), ctxWith({ node: 'YieldedWait', continuationConsumed: true })))
        .toEqual(submitted(kind));
    }
  });

  it('a not-entered Run queues pause/cancel/resume today (step 5.1 flip, CTL-02: applied@2 platform_not_entered)', () => {
    for (const node of ['Claimed', 'Authorized', 'Revoked'] as const) {
      expect(transitionControlIntent(ABSENT, submitEvent('pause'), ctxWith({ node }))).toEqual(submitted('pause'));
      expect(transitionControlIntent(ABSENT, submitEvent('cancel'), ctxWith({ node }))).toEqual(submitted('cancel'));
      expect(transitionControlIntent(ABSENT, submitEvent('resume'), ctxWith({ node, pointer: 'paused' },
        { pointerIntent: POINTER_INTENT.paused }))).toEqual(submitted('resume'));
    }
  });

  it('every open Run node answers the submission checks exactly as the shared controlSubmissionProblem', () => {
    const pointerIntents: (ControlPointerIntent | null)[] = [
      null, ...Object.values(POINTER_INTENT), { kind: 'pause', status: 'queued', observed: null },
    ];
    for (const node of ['Claimed', 'Authorized', 'Entering', 'Revoked', 'Running', 'YieldedWait'] as const) {
      for (const pointer of POINTERS) {
        for (const kind of KINDS) {
          for (const reason of [null, '  ', 'look at foo.ts']) {
            for (const pointerIntent of pointerIntents) {
              const problem = controlSubmissionProblem({ kind, reason, pointer, yielded: node === 'YieldedWait', pointerIntent });
              expect(transitionControlIntent(ABSENT, submitEvent(kind, reason), ctxWith({ node, pointer }, { pointerIntent })))
                .toEqual(problem === null ? submitted(kind)
                  : { ok: false, reason: 'guard_failed', code: problem.code, detail: problem.reason });
            }
          }
        }
      }
    }
  });

  it('the same derived intent ref with different content is a duplicate identity (7.4, R4-control-intent.test.ts:133-135)', () => {
    for (const label of STATE_LABELS.filter(candidate => candidate !== 'Absent')) {
      expect(transitionControlIntent(STATES[label], submitEvent('pause'), ctxWith({ node: 'Ended' })))
        .toEqual({ ok: false, reason: 'duplicate', code: 'idempotency_conflict',
          detail: 'the control request identity was already used with different content' });
    }
  });
});

// -------------------------------------------------------------------------- //
// control_observed (CTL-03, CTL-05, CTL-06, CTL-09)                          //
// -------------------------------------------------------------------------- //

/** The codec pairing a commit enforces today for a Kernel observation (`control-record-codecs.ts:396-407`). */
const KERNEL_PAIRS: Record<ControlObservationV1['kind'], readonly ControlIntentKindV1[]> = {
  paused: ['pause'],
  resumed: ['resume'],
  steered: ['steer'],
  cancelled: ['cancel'],
  terminal_without_cancel: ['cancel'],
  outcome_unknown: ['cancel'],
};
const MAPPED_NODE: Record<ControlObservationV1['kind'], Exclude<ControlNode, 'Absent' | 'Queued'>> = {
  paused: 'Applied', resumed: 'Applied', steered: 'Applied', cancelled: 'Applied',
  terminal_without_cancel: 'Superseded', outcome_unknown: 'OutcomeUnknown',
};

describe('control_observed: recorded node × intent kind × Kernel observation kind', () => {
  const recorded = STATE_LABELS.filter(label => label !== 'Absent');
  for (const label of recorded) {
    for (const observed of KERNEL_KINDS) {
      it(`${label} × ${observed}`, () => {
        const state = STATES[label];
        const observation = kernelObservation(observed);
        const result = transitionControlIntent(state, observedEvent(observation), ctxWith());
        const kind = state.kind as ControlIntentKindV1;
        // Pairs outside today's codec rule are illegal/invalid. Step 5.1 flips (CD-2): a Kernel
        // outcome_unknown (CTL-03) and terminal_without_cancel (CTL-06) close any kind.
        if (!KERNEL_PAIRS[observed].includes(kind)) return check(result, ILLEGAL);
        // Today a recorded Applied/Superseded/OutcomeUnknown intent is re-observed at revision + 1
        // (step 5.1 flip, CTL-09 / §7.4: same content → duplicate, other content → stale).
        check(result, observedTo(state, MAPPED_NODE[observed], observation));
      });
    }
  }

  it('the observed intent must exist (`control-service.ts:520-521`)', () => {
    expect(transitionControlIntent(ABSENT, observedEvent(kernelObservation('paused')), ctxWith()))
      .toEqual({ ok: false, reason: 'illegal', code: 'not_found', detail: 'the control intent does not exist' });
  });

  it('CTL-03: a queued intent the pointer names is applied, superseded or outcome_unknown by the mapping', () => {
    expect(transitionControlIntent(queued('pause'), observedEvent(kernelObservation('paused')), ctxWith()))
      .toEqual({ ok: true, next: { node: 'Applied', kind: 'pause', revision: 2, observation: kernelObservation('paused') },
        effects: [{ kind: 'guard_run' }] });
    expect(transitionControlIntent(queued('cancel'), observedEvent(kernelObservation('terminal_without_cancel')), ctxWith()))
      .toEqual(observedTo(queued('cancel'), 'Superseded', kernelObservation('terminal_without_cancel')));
    expect(transitionControlIntent(queued('cancel'), observedEvent(kernelObservation('outcome_unknown')), ctxWith()))
      .toEqual(observedTo(queued('cancel'), 'OutcomeUnknown', kernelObservation('outcome_unknown')));
  });

  it('a consumed pause with an unknown outcome is refused by today\'s pairing (step 5.1 flip, CTL-03: OutcomeUnknown)', () => {
    expect(transitionControlIntent(queued('pause'), observedEvent(kernelObservation('outcome_unknown')), ctxWith()))
      .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'a cancelled/unknown observation must belong to a cancel intent' });
  });

  it('a natural terminal over a queued pause/resume/steer is refused today (step 5.1 flip, CTL-06: Superseded)', () => {
    for (const kind of ['pause', 'resume', 'steer'] as const) {
      expect(transitionControlIntent(queued(kind), observedEvent(kernelObservation('terminal_without_cancel')),
        ctxWith({ node: 'Ended' }))).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    }
  });

  it('CTL-05: a pointer that moved keeps the real observation as Superseded', () => {
    for (const kind of ['pause', 'cancel', 'resume'] as const) {
      const observation = APPLIED_OBSERVATION[kind];
      expect(transitionControlIntent(queued(kind), observedEvent(observation), ctxWith({ pointsHere: false })))
        .toEqual(observedTo(queued(kind), 'Superseded', observation));
    }
    expect(transitionControlIntent(queued('steer'), observedEvent(kernelObservation('steered')), ctxWith({ inControlInputs: false })))
      .toEqual(observedTo(queued('steer'), 'Superseded', kernelObservation('steered')));
  });

  it('a steer is judged by controlInputs and the other kinds by the pointer', () => {
    expect(transitionControlIntent(queued('steer'), observedEvent(kernelObservation('steered')),
      ctxWith({ pointsHere: false, inControlInputs: true })))
      .toEqual(observedTo(queued('steer'), 'Applied', kernelObservation('steered')));
    expect(transitionControlIntent(queued('pause'), observedEvent(kernelObservation('paused')),
      ctxWith({ pointsHere: true, inControlInputs: false })))
      .toEqual(observedTo(queued('pause'), 'Applied', kernelObservation('paused')));
  });

  it('a moved pointer does not excuse an unpaired observation', () => {
    expect(transitionControlIntent(queued('pause'), observedEvent(kernelObservation('cancelled')), ctxWith({ pointsHere: false })))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('a recorded intent is re-observed today (step 5.1 flip, CTL-09: same content → duplicate; otherwise stale)', () => {
    expect(transitionControlIntent(applied('pause'), observedEvent(kernelObservation('paused')), ctxWith()))
      .toEqual(observedTo(applied('pause'), 'Applied', kernelObservation('paused')));
    expect(transitionControlIntent(superseded('cancel'), observedEvent(kernelObservation('outcome_unknown')), ctxWith()))
      .toEqual(observedTo(superseded('cancel'), 'OutcomeUnknown', kernelObservation('outcome_unknown')));
    expect(transitionControlIntent(outcomeUnknown('cancel'), observedEvent(kernelObservation('terminal_without_cancel')), ctxWith()))
      .toEqual(observedTo(outcomeUnknown('cancel'), 'Superseded', kernelObservation('terminal_without_cancel')));
  });

  const observation = kernelObservation('paused');
  const GUARDS: { name: string; ctx: ControlGuardContext; reason: TransitionRejectReason; code: CoreError; detail: string }[] = [
    { name: 'stale intent pin', ctx: ctxWith({}, { pinsMatch: { intent: false, run: true } }),
      reason: 'stale', code: 'revision_conflict', detail: 'the control intent changed since the caller read it' },
    { name: 'missing Run', ctx: ctxWith({ node: 'Absent' }),
      reason: 'illegal', code: 'not_found', detail: 'the target Run does not exist' },
    { name: 'stale Run pin', ctx: ctxWith({}, { pinsMatch: { intent: true, run: false } }),
      reason: 'stale', code: 'revision_conflict', detail: 'the Run changed since the caller read it' },
    { name: 'no V2 authorization', ctx: ctxWith({ entry: null }),
      reason: 'guard_failed', code: 'forbidden', detail: 'the observed Run has no formal V2 entry authorization' },
    ...([
      ['consumerId', { ...ENTRY, consumerId: 'consumer-2' }],
      ['entryGeneration', { ...ENTRY, entryGeneration: 2 }],
      ['sessionGeneration', { ...ENTRY, sessionGeneration: 3 }],
    ] as const).map(([field, entry]) => ({
      name: `entry ${field} differs`, ctx: ctxWith({ entry }),
      reason: 'guard_failed' as const, code: 'forbidden' as const, detail: 'the observed entry identity disagrees with the Run entry binding' })),
    { name: 'no locator', ctx: ctxWith({ history: null }),
      reason: 'guard_failed', code: 'forbidden', detail: 'the observed Run has no execution-history locator' },
    ...([
      ['session project', { ...LOCATOR, sessionRef: { projectId: 'p-other', sessionId: 's-1' } }],
      ['session id', { ...LOCATOR, sessionRef: { projectId: PROJECT, sessionId: 's-2' } }],
      ['adapter', { ...LOCATOR, kernel: { ...KERNEL, adapterId: 'adapter-2' } }],
      ['kernel session', { ...LOCATOR, kernel: { ...KERNEL, kernelSessionId: 'ks-2' } }],
      ['kernel run', { ...LOCATOR, kernel: { ...KERNEL, runId: 'kr-2' } }],
      ['kernel turn', { ...LOCATOR, kernel: { ...KERNEL, turnId: 'kt-2' } }],
      ['start position', { ...LOCATOR, startPosition: 4 }],
    ] as const).map(([field, history]) => ({
      name: `locator ${field} differs`, ctx: ctxWith({ history }),
      reason: 'guard_failed' as const, code: 'forbidden' as const, detail: 'the observation history disagrees with the Run locator' })),
  ];
  for (const guard of GUARDS) {
    it(`guard row: ${guard.name} (7.4)`, () => {
      expect(transitionControlIntent(queued('pause'), observedEvent(observation), guard.ctx))
        .toEqual({ ok: false, reason: guard.reason, code: guard.code, detail: guard.detail });
    });
  }

  it('the source must lie inside the persisted window: endPosition, else observedThroughPosition (7.4, `:566-570`)', () => {
    const outside = { ok: false, reason: 'guard_failed', code: 'unavailable',
      detail: 'the observation source is outside the persisted Run history window' };
    const at = (position: number) => observedEvent(kernelObservation('paused', { source: { ...KERNEL, position } }));
    expect(transitionControlIntent(queued('pause'), at(2), ctxWith())).toEqual(outside);
    expect(transitionControlIntent(queued('pause'), at(11), ctxWith())).toEqual(outside);
    expect(transitionControlIntent(queued('pause'), at(3), ctxWith())).toMatchObject({ ok: true });
    expect(transitionControlIntent(queued('pause'), at(10), ctxWith())).toMatchObject({ ok: true });
    const ended = ctxWith({ history: { ...LOCATOR, endPosition: 12 } });
    expect(transitionControlIntent(queued('pause'), at(12), ended)).toMatchObject({ ok: true });
    expect(transitionControlIntent(queued('pause'), at(13), ended)).toEqual(outside);
  });

  it('the observation window must not exceed the persisted window (7.4, `:571-573`)', () => {
    const wide = kernelObservation('paused', { history: { ...LOCATOR, observedThroughPosition: 11 } });
    expect(transitionControlIntent(queued('pause'), observedEvent(wide), ctxWith()))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'unavailable',
        detail: 'the observation window exceeds the persisted Run history window' });
    expect(transitionControlIntent(queued('pause'), observedEvent(wide), ctxWith({ history: { ...LOCATOR, endPosition: 11 } })))
      .toMatchObject({ ok: true });
  });

  it('the first failing row answers, in today\'s order (`control-service.ts:525-573`), before the pairing', () => {
    const intentChanged = { ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the control intent changed since the caller read it' };
    const runChanged = { ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the Run changed since the caller read it' };
    const entryDiffers = { ok: false, reason: 'guard_failed', code: 'forbidden',
      detail: 'the observed entry identity disagrees with the Run entry binding' };
    const sourceOutside = { ok: false, reason: 'guard_failed', code: 'unavailable',
      detail: 'the observation source is outside the persisted Run history window' };
    const observe = (ctx: ControlGuardContext, observed: ControlObservationV1 = observation, state = queued('pause')) =>
      transitionControlIntent(state, observedEvent(observed), ctx);
    // Every row fails at once: the intent pin answers (an unpaired `cancelled` on a steer as well).
    expect(observe(ctxWith({ node: 'Absent', entry: null, history: null }, { pinsMatch: { intent: false, run: false } }),
      kernelObservation('cancelled', { source: { ...KERNEL, position: 99 } }), queued('steer'))).toEqual(intentChanged);
    // The intent pin is compared before the Run is read (`:525-530`).
    expect(observe(ctxWith({ node: 'Absent' }, { pinsMatch: { intent: false, run: true } }))).toEqual(intentChanged);
    // The Run read precedes the Run pin (`:530-536`).
    expect(observe(ctxWith({ node: 'Absent' }, { pinsMatch: { intent: true, run: false } })))
      .toEqual({ ok: false, reason: 'illegal', code: 'not_found', detail: 'the target Run does not exist' });
    // The Run pin precedes the V2 entry (`:536-543`).
    expect(observe(ctxWith({ entry: null, history: null }, { pinsMatch: { intent: true, run: false } }))).toEqual(runChanged);
    // No V2 entry precedes the locator rows.
    expect(observe(ctxWith({ entry: null, history: null })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'the observed Run has no formal V2 entry authorization' });
    // The entry identity precedes a missing or a different locator (`:544-560`).
    for (const history of [null, { ...LOCATOR, kernel: { ...KERNEL, turnId: 'kt-2' } }]) {
      expect(observe(ctxWith({ entry: { ...ENTRY, consumerId: 'consumer-2' }, history }))).toEqual(entryDiffers);
    }
    // The locator identity precedes the source window: a moved start is a different locator, not a window miss.
    expect(observe(ctxWith({ history: { ...LOCATOR, startPosition: 6 } }), kernelObservation('paused', { source: { ...KERNEL, position: 99 } })))
      .toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'the observation history disagrees with the Run locator' });
    // The source window precedes the observation window (`:566-573`).
    expect(observe(ctxWith(), kernelObservation('paused', { source: { ...KERNEL, position: 11 },
      history: { ...LOCATOR, observedThroughPosition: 11 } }))).toEqual(sourceOutside);
    // Every window row precedes the kind pairing.
    expect(observe(ctxWith(), kernelObservation('cancelled', { source: { ...KERNEL, position: 99 } }), queued('steer'))).toEqual(sourceOutside);
  });

  it('a revision that would leave the safe-integer range is refused', () => {
    const state: ControlIntentState = { ...applied('pause'), revision: Number.MAX_SAFE_INTEGER };
    expect(transitionControlIntent(state, observedEvent(kernelObservation('paused')), ctxWith()))
      .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'the control intent revision would not be a safe integer' });
  });

  it('a recorded state without a kind is malformed', () => {
    expect(transitionControlIntent({ node: 'Queued', kind: null, revision: 1, observation: null },
      observedEvent(kernelObservation('paused')), ctxWith()))
      .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'a recorded control intent must have a kind' });
  });

  it('a stored locator that fails the locator codec is unavailable right after the missing-locator row (`control-service.ts:551`)', () => {
    const malformed = { ok: false, reason: 'guard_failed', code: 'unavailable', detail: 'the stored execution-history locator is malformed' };
    const observe = (ctx: ControlGuardContext, observed: ControlObservationV1 = observation, state = queued('pause')) =>
      transitionControlIntent(state, observedEvent(observed), ctx);
    expect(observe(ctxWith({ history: 'malformed' }))).toEqual(malformed);
    // The pins and the V2 entry identity come first (`:525-548`).
    expect(observe(ctxWith({ history: 'malformed' }, { pinsMatch: { intent: false, run: true } })))
      .toMatchObject({ reason: 'stale', detail: 'the control intent changed since the caller read it' });
    expect(observe(ctxWith({ history: 'malformed' }, { pinsMatch: { intent: true, run: false } })))
      .toMatchObject({ reason: 'stale', detail: 'the Run changed since the caller read it' });
    expect(observe(ctxWith({ history: 'malformed', entry: null })))
      .toMatchObject({ code: 'forbidden', detail: 'the observed Run has no formal V2 entry authorization' });
    expect(observe(ctxWith({ history: 'malformed', entry: { ...ENTRY, consumerId: 'consumer-2' } })))
      .toMatchObject({ code: 'forbidden', detail: 'the observed entry identity disagrees with the Run entry binding' });
    // It precedes the locator identity, the window rows and the kind pairing (`:552-573`).
    expect(observe(ctxWith({ history: 'malformed' }), kernelObservation('cancelled', { source: { ...KERNEL, position: 99 } }),
      queued('steer'))).toEqual(malformed);
  });
});

// -------------------------------------------------------------------------- //
// The reads control-service.ts makes before CTL-01 / CTL-03 answer (step 3)  //
// -------------------------------------------------------------------------- //

describe('submissionReadsPointerIntent and observedIntentProblem (A.2 step 3)', () => {
  it('reads the pointer intent only for a resume past the target-Run rows, not yielded, with a pointer', () => {
    for (const node of RUN_NODES) {
      for (const pointer of POINTERS) {
        for (const kind of KINDS) {
          for (const runPinned of [true, false]) {
            const ctx = ctxWith({ node, pointer }, { pinsMatch: { intent: true, run: runPinned } });
            const label = `${node}/${pointer}/${kind}/${String(runPinned)}`;
            const reads = submissionReadsPointerIntent(submitEvent(kind), ctx);
            const open = node !== 'Absent' && node !== 'Ended' && node !== 'EndedUnknown' && node !== 'YieldedWait';
            expect(reads, label).toBe(kind === 'resume' && runPinned && open && pointer !== 'none');
            // A submission that does not read it is answered the same whatever the pointer names.
            if (!reads) {
              const unread = transitionControlIntent(ABSENT, submitEvent(kind), ctx);
              for (const pointerIntent of Object.values(POINTER_INTENT)) {
                expect(transitionControlIntent(ABSENT, submitEvent(kind), { ...ctx, pointerIntent }), label).toEqual(unread);
              }
            }
          }
        }
      }
    }
    expect(submissionReadsPointerIntent(submitEvent('resume', null, 'query_run'), ctxWith({ pointer: 'paused' }))).toBe(false);
  });

  it('a resume that reads it is answered by it, before the pointer fence', () => {
    for (const node of ['Claimed', 'Authorized', 'Entering', 'Revoked', 'Running'] as const) {
      const ctx = ctxWith({ node, pointer: 'cancelled' });
      expect(submissionReadsPointerIntent(submitEvent('resume'), ctx), node).toBe(true);
      expect(transitionControlIntent(ABSENT, submitEvent('resume'), { ...ctx, pointerIntent: POINTER_INTENT.cancelled }), node)
        .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'resume requires an observed paused original Turn' });
    }
  });

  it('observedIntentProblem is the intent pin alone, and the transition answers it first', () => {
    const event = observedEvent(kernelObservation('paused'));
    const stale = { ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the control intent changed since the caller read it' };
    expect(observedIntentProblem(event, { pinsMatch: { intent: true, run: false } })).toBeNull();
    expect(observedIntentProblem(event, { pinsMatch: { intent: false, run: true } })).toEqual(stale);
    for (const label of STATE_LABELS.filter(candidate => candidate !== 'Absent')) {
      expect(transitionControlIntent(STATES[label], event, ctxWith({ node: 'Absent', entry: null, history: 'malformed' },
        { pinsMatch: { intent: false, run: false } })), label).toEqual(stale);
    }
  });
});

// -------------------------------------------------------------------------- //
// 新增 events: still illegal until step 5                                    //
// -------------------------------------------------------------------------- //

describe('rows that A.2 step 5 adds answer illegal/invalid today', () => {
  it('CTL-02 control_applied_not_entered: not yet; an internal assertion from Entering/Running', () => {
    const event = EVENTS.control_applied_not_entered;
    for (const node of ['Absent', 'Claimed', 'Authorized', 'Revoked', 'YieldedWait', 'Ended', 'EndedUnknown'] as const) {
      expect(transitionControlIntent(ABSENT, event, ctxWith({ node })))
        .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'CTL-02 is not implemented before A.2 step 5' });
    }
    for (const node of ['Entering', 'Running'] as const) {
      expect(transitionControlIntent(ABSENT, event, ctxWith({ node })))
        .toEqual({ ok: false, reason: 'illegal', code: 'invalid',
          detail: 'from Entering on only the Kernel, RUN-23 or reconcile can apply a control (D-7)' });
    }
    // An existing intent is not yet answered like CTL-01's identity check either (step 5.1 adds it with the row).
    for (const label of STATE_LABELS.filter(candidate => candidate !== 'Absent')) {
      for (const node of RUN_NODES) {
        expect(transitionControlIntent(STATES[label], event, ctxWith({ node })))
          .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'CTL-02 is not implemented before A.2 step 5' });
      }
    }
  });

  it('CTL-04 control_superseded_by_newer: not yet for a queued intent; never for another node (7.4)', () => {
    for (const label of STATE_LABELS) {
      const node = STATES[label].node;
      expect(transitionControlIntent(STATES[label], EVENTS.control_superseded_by_newer, ctxWith())).toEqual({
        ok: false, reason: 'illegal', code: 'invalid',
        detail: node === 'Queued' ? 'CTL-04 is not implemented before A.2 step 5' : 'only a queued control intent can be superseded' });
    }
  });

  it('CTL-10 control_applied_paused_stop: not yet for a queued cancel, whatever the exit proof (7.4)', () => {
    for (const exitProof of [null, 'live_clean', 'host_instance_takeover'] as const) {
      for (const kernelPaused of [false, true]) {
        expect(transitionControlIntent(queued('cancel'), EVENTS.control_applied_paused_stop, ctxWith({ kernelPaused }, { exitProof })))
          .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'CTL-10 is not implemented before A.2 step 5' });
      }
    }
    for (const label of STATE_LABELS.filter(candidate => candidate !== 'Queued:cancel')) {
      expect(transitionControlIntent(STATES[label], EVENTS.control_applied_paused_stop, ctxWith({}, { exitProof: 'live_clean' })))
        .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'only a queued cancel can be applied by a paused stop' });
    }
  });

  it('CTL-07 / CTL-08 control_reconciled: not yet; terminal intents are skipped (7.4)', () => {
    const reconcile = (observation: ControlObservationV1 | ControlPlatformObservationV1): ControlIntentEvent =>
      ({ type: 'control_reconciled', hostInstanceId: 'host-1', observation });
    const restart = ctxWith({ node: 'Ended', pausedInterrupted: true, pointer: 'paused' }, { origin: 'reconcile', exitProof: 'host_instance_takeover' });
    // Includes the C4 rows: a queued pause on a RUN-24 Run never takes a Kernel `paused` or a supersede.
    for (const observation of [kernelObservation('paused'), platformObservation('terminal_without_cancel'), platformObservation('paused')]) {
      expect(transitionControlIntent(queued('pause'), reconcile(observation), restart))
        .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'CTL-08 is not implemented before A.2 step 5' });
    }
    expect(transitionControlIntent(outcomeUnknown('cancel'), reconcile(kernelObservation('cancelled')), restart))
      .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'CTL-07 is not implemented before A.2 step 5' });
    for (const label of STATE_LABELS.filter(candidate => candidate.startsWith('Applied') || candidate.startsWith('Superseded'))) {
      expect(transitionControlIntent(STATES[label], reconcile(platformObservation('outcome_unknown')), restart))
        .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'the control intent is already terminal; reconcile skips it' });
    }
    expect(transitionControlIntent(ABSENT, reconcile(platformObservation('outcome_unknown')), restart))
      .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'reconcile only settles a recorded control intent' });
  });
});

// -------------------------------------------------------------------------- //
// Pure helpers and record constructors                                       //
// -------------------------------------------------------------------------- //

describe('pure helpers', () => {
  it('desiredStateOfKind and pointerAfterSubmit (RUN-12..15)', () => {
    expect(KINDS.map(desiredStateOfKind)).toEqual(['paused', 'cancelled', 'running', 'steered']);
    expect(pointerAfterSubmit('pause', SELF)).toEqual({ kind: 'set_pointer', controlState: { intentRef: SELF, desiredState: 'paused' } });
    expect(pointerAfterSubmit('cancel', SELF)).toEqual({ kind: 'set_pointer', controlState: { intentRef: SELF, desiredState: 'cancelled' } });
    expect(pointerAfterSubmit('resume', SELF)).toEqual({ kind: 'set_pointer', controlState: { intentRef: SELF, desiredState: 'running' } });
    expect(pointerAfterSubmit('steer', SELF)).toEqual({ kind: 'append_input', intentRef: SELF });
  });

  it('controlSubmitProblem is freshSubmitControlProblem over the pointer', () => {
    for (const pointer of POINTERS) {
      for (const kind of KINDS) {
        const problem = controlSubmitProblem(pointer, kind);
        if (POINTER_FENCE[pointer][kind] === 'ok') expect(problem).toBeNull();
        else expect(problem).toMatchObject({ status: 'rejected', code: 'busy' });
      }
    }
  });

  it('controlSubmissionProblem: steer text, then the applied-pause resume check, then controlSubmitProblem (`control-service.ts:392-399`)', () => {
    // The steer text is checked first, whatever the pointer.
    for (const reason of [null, '', '  \n']) {
      for (const pointer of POINTERS) {
        expect(controlSubmissionProblem({ kind: 'steer', reason, pointer, yielded: false, pointerIntent: POINTER_INTENT[pointer] }))
          .toEqual({ status: 'rejected', code: 'invalid', reason: 'steer requires the actual directional input text' });
      }
    }
    // Only a non-yielded resume with a pointer needs an applied, observed pause.
    const notObserved: ControlPointerIntent[] = [
      { kind: 'pause', status: 'queued', observed: null },
      { kind: 'pause', status: 'applied', observed: 'cancelled' },
      { kind: 'cancel', status: 'applied', observed: 'paused' },
    ];
    for (const pointerIntent of [null, ...notObserved]) {
      expect(controlSubmissionProblem({ kind: 'resume', reason: null, pointer: 'paused', yielded: false, pointerIntent }))
        .toEqual({ status: 'rejected', code: 'busy', reason: 'resume requires an observed paused original Turn' });
      expect(controlSubmissionProblem({ kind: 'resume', reason: null, pointer: 'paused', yielded: true, pointerIntent })).toBeNull();
    }
    expect(controlSubmissionProblem({ kind: 'resume', reason: null, pointer: 'none', yielded: false, pointerIntent: null }))
      .toEqual(controlSubmitProblem('none', 'resume'));
    // Otherwise it is exactly the pointer fence.
    for (const pointer of POINTERS) {
      for (const kind of KINDS) {
        for (const yielded of [false, true]) {
          const resumeCheck = kind === 'resume' && !yielded && pointer !== 'none' && pointer !== 'paused';
          expect(controlSubmissionProblem({ kind, reason: 'text', pointer, yielded, pointerIntent: POINTER_INTENT[pointer] }))
            .toEqual(resumeCheck
              ? { status: 'rejected', code: 'busy', reason: 'resume requires an observed paused original Turn' }
              : controlSubmitProblem(pointer, kind));
        }
      }
    }
  });

  it('observationStatusFor maps every observation kind (§7.1)', () => {
    const kinds: ControlObservationKind[] = [...KERNEL_KINDS, 'superseded_by_newer'];
    expect(Object.fromEntries(kinds.map(kind => [kind, observationStatusFor(kind)]))).toEqual({
      paused: 'applied', cancelled: 'applied', resumed: 'applied', steered: 'applied',
      terminal_without_cancel: 'superseded', outcome_unknown: 'outcome_unknown', superseded_by_newer: 'superseded',
    });
  });

  const REQUEST_BASE = { runRef: RUN, reason: 'because', requestedAt: AT, requestedBy: { kind: 'human' as const, id: 'operator' } };
  function requestFor(kind: ControlIntentKindV1): ControlIntentRequestV1 {
    return newControlIntentRequest({ ref: SELF, kind, ...REQUEST_BASE });
  }
  it('observationPairingProblem accepts exactly what the snapshot codec accepts today', () => {
    // The codec checks the canonical ref key, so encode one valid record to learn it.
    const refKey = encodeControlIntentSnapshot(newQueuedControlIntentRecord(requestFor('pause'))).refKey;
    const decodes = (kind: ControlIntentKindV1, observation: ControlObservationV1 | ControlPlatformObservationV1) => {
      const raw = { ...requestFor(kind), revision: 2, status: 'applied', observation };
      return decodeControlIntentSnapshot({ refKey, schemaId: 'ControlIntentSnapshot@1', revision: 2, json: JSON.stringify(raw) });
    };
    for (const kind of KINDS) {
      for (const observed of KERNEL_KINDS) {
        const observation = kernelObservation(observed);
        const problem = observationPairingProblem(kind, observation);
        expect(problem === null).toBe(KERNEL_PAIRS[observed].includes(kind));
        const decoded = decodes(kind, observation);
        expect(decoded.status).toBe(problem === null ? 'decoded' : 'invalid');
        if (decoded.status === 'invalid') expect(decoded.reason).toBe(problem);
      }
      for (const observed of PLATFORM_KINDS) {
        const observation = platformObservation(observed);
        const problem = observationPairingProblem(kind, observation);
        const own = { paused: 'pause', cancelled: 'cancel', resumed: 'resume' } as const;
        const expectedOk = observed === 'paused' || observed === 'cancelled' || observed === 'resumed'
          ? kind === own[observed] : true;
        expect(problem === null).toBe(expectedOk);
        const decoded = decodes(kind, observation);
        expect(decoded.status).toBe(problem === null ? 'decoded' : 'invalid');
        if (decoded.status === 'invalid') expect(decoded.reason).toBe(problem);
      }
    }
  });

  it('newQueuedControlIntentRecord writes queued@1 in today\'s field order and decodes', () => {
    for (const kind of KINDS) {
      const record = newQueuedControlIntentRecord(requestFor(kind));
      expect(Object.keys(record)).toEqual(['schemaVersion', 'ref', 'revision', 'runRef', 'kind', 'desiredState',
        'status', 'reason', 'requestedAt', 'requestedBy']);
      expect(record).toMatchObject({ revision: 1, status: 'queued', kind, desiredState: desiredStateOfKind(kind) });
      expect(decodeControlIntentSnapshot(encodeControlIntentSnapshot(record))).toEqual({ status: 'decoded', value: record });
      expect(controlIntentStateOf(record)).toEqual(queued(kind));
      expect(controlIntentRequestOf(record)).toEqual(requestFor(kind));
    }
  });

  it('every accepted transition writes a record that decodes back to `next` (controlIntentRecordOf)', () => {
    const accepted: { request: ControlIntentRequestV1; next: ControlIntentState }[] = [];
    for (const kind of KINDS) {
      const submit = transitionControlIntent(ABSENT, submitEvent(kind), ctxWith({ pointer: 'paused' }, { pointerIntent: POINTER_INTENT.paused }));
      if (submit.ok) accepted.push({ request: requestFor(kind), next: submit.next });
      for (const label of STATE_LABELS.filter(candidate => candidate.endsWith(`:${kind}`))) {
        for (const observed of KERNEL_KINDS) {
          for (const pointsHere of [true, false]) {
            const result = transitionControlIntent(STATES[label], observedEvent(kernelObservation(observed)),
              ctxWith({ pointsHere, inControlInputs: pointsHere }));
            if (result.ok) accepted.push({ request: requestFor(kind), next: result.next });
          }
        }
      }
    }
    expect(accepted.length).toBeGreaterThan(40);
    for (const { request, next } of accepted) {
      const record = controlIntentRecordOf(request, next);
      expect(decodeControlIntentSnapshot(encodeControlIntentSnapshot(record))).toEqual({ status: 'decoded', value: record });
      expect(controlIntentStateOf(record)).toEqual(next);
      expect(controlIntentRequestOf(record)).toEqual(request);
      if (next.node !== 'Queued') {
        expect(Object.keys(record)).toEqual(['schemaVersion', 'ref', 'runRef', 'kind', 'desiredState', 'reason',
          'requestedAt', 'requestedBy', 'revision', 'status', 'observation']);
      }
    }
  });

  it('controlIntentRecordOf only produces legal combinations', () => {
    const pause = requestFor('pause');
    expect(() => controlIntentRecordOf(pause, ABSENT)).toThrow('an Absent control intent has no record');
    expect(() => controlIntentRecordOf(pause, queued('cancel'))).toThrow('disagrees with the request kind');
    expect(() => controlIntentRecordOf(pause, { ...queued('pause'), revision: 2 })).toThrow('revision 1 without an observation');
    expect(() => controlIntentRecordOf(pause, { ...queued('pause'), observation: kernelObservation('paused') }))
      .toThrow('revision 1 without an observation');
    expect(() => controlIntentRecordOf(pause, { ...applied('pause'), observation: null })).toThrow('revision >= 2');
    expect(() => controlIntentRecordOf(pause, { ...applied('pause'), revision: 1 })).toThrow('revision >= 2');
    expect(() => controlIntentRecordOf(pause, { ...applied('pause'), observation: kernelObservation('cancelled') }))
      .toThrow('a cancelled/unknown observation must belong to a cancel intent');
    expect(() => controlIntentRecordOf({ ...pause, desiredState: 'running' }, applied('pause'))).toThrow('must desire paused');
    expect(() => newQueuedControlIntentRecord({ ...pause, desiredState: 'cancelled' })).toThrow('must desire paused');
  });

  it('controlIntentStateOf reads Absent from no record', () => {
    expect(controlIntentStateOf(null)).toEqual(ABSENT);
  });
});
