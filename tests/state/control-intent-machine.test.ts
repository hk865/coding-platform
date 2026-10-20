/**
 * Exhaustive table tests for the pure ControlIntent machine
 * (docs/refactor/STATE-MACHINES-SPEC.md §7; A.2 step 2, flipped in step 5.1).
 *
 * Every (state, event) combination is answered: legal ones assert `next` and
 * `effects`, illegal ones assert `reason` and `code` from §7.4. Step 5.1 rows:
 * CTL-01 with the D-9 Goal and RD-8 consumed-continuation guards, CTL-02 (D-7,
 * `∅ → applied@2` with a `platform_not_entered` observation), CTL-04 (D-8,
 * `platform_superseded`), CTL-03/CTL-06 with the CD-2 pairing and the CTL-06
 * known-terminal guard, CTL-09 (an observed intent is never re-observed). The
 * rows that stay 新增 (CTL-07, CTL-08, CTL-10) still answer `illegal`/`invalid`.
 *
 * Small literal fixtures only: no RecordStore, no Kernel. The snapshot codec
 * (pure) cross-checks that the record constructors and the pairing rule agree
 * with what a commit accepts.
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
  desiredStateOfKind, newControlIntentRequest, newQueuedControlIntentRecord, notEnteredEntryPhase, observationPairingProblem,
  observationStatusFor, observedIntentAnswer, pointerAfterSubmit, submissionReadsGoal, submissionReadsPointerIntent,
  transitionControlIntent,
  type ControlGuardContext, type ControlIntentEffect, type ControlIntentEvent, type ControlIntentState,
  type ControlNode, type ControlObservationKind, type ControlPointerIntent, type ControlRunNode, type ControlSubmissionEvent,
  type ControlTransition, type NotEnteredEntryPhase, type RunControlPointer,
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
/** The Run nodes that never entered and the entry phase CTL-02 names for each (RD-1). */
const NOT_ENTERED: Readonly<Record<'Claimed' | 'Authorized' | 'Revoked', NotEnteredEntryPhase>> = {
  Claimed: 'none', Authorized: 'authorized', Revoked: 'revoked',
};
const NOT_ENTERED_NODES = Object.keys(NOT_ENTERED) as (keyof typeof NOT_ENTERED)[];
function isNotEntered(node: ControlRunNode): node is keyof typeof NOT_ENTERED {
  return node === 'Claimed' || node === 'Authorized' || node === 'Revoked';
}

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

type AbsentIntentState = Extract<ControlIntentState, { node: 'Absent' }>;
type PresentIntentState = Exclude<ControlIntentState, AbsentIntentState>;

const ABSENT: AbsentIntentState = { node: 'Absent', kind: null, revision: 0, observation: null };
function queued(kind: ControlIntentKindV1): PresentIntentState {
  return { node: 'Queued', kind, revision: 1, observation: null };
}
const APPLIED_OBSERVATION: Record<ControlIntentKindV1, ControlObservationV1> = {
  pause: kernelObservation('paused'), cancel: kernelObservation('cancelled'),
  resume: kernelObservation('resumed'), steer: kernelObservation('steered'),
};
function applied(kind: ControlIntentKindV1): PresentIntentState {
  return { node: 'Applied', kind, revision: 2, observation: APPLIED_OBSERVATION[kind] };
}
function superseded(kind: ControlIntentKindV1): PresentIntentState {
  return { node: 'Superseded', kind, revision: 2,
    observation: kind === 'cancel' ? kernelObservation('terminal_without_cancel') : platformObservation('superseded_by_newer') };
}
function outcomeUnknown(kind: ControlIntentKindV1): PresentIntentState {
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
/** CTL-09 / §7.4: a later observation of an already observed intent with other content. */
const STALE = fail('stale', 'revision_conflict');

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
const NOT_ENTERED_OBSERVED = { pause: 'paused', cancel: 'cancelled', resume: 'resumed' } as const;
/** CTL-02: `applied@2` with the platform's own observation, and the one pointer move (D-7, CD-1, CD-3). */
function appliedNotEntered(kind: 'pause' | 'cancel' | 'resume', entryPhase: NotEnteredEntryPhase, runRevision = 4): Expected {
  return { ok: true,
    next: { node: 'Applied', kind, revision: 2, observation: { schemaVersion: 1, origin: 'platform_not_entered',
      kind: NOT_ENTERED_OBSERVED[kind], runRevision, detail: { entryPhase }, observedAt: AT } },
    effects: [{ kind: 'run_pointer', change: pointerAfterSubmit(kind, SELF) }] };
}
/** CTL-04: `Superseded` at revision + 1 with the platform's `platform_superseded` observation, no effect (D-8). */
function supersededBy(state: PresentIntentState, by: ControlIntentRef = OTHER): Expected {
  return { ok: true, next: { node: 'Superseded', kind: state.kind, revision: state.revision + 1,
    observation: { schemaVersion: 1, origin: 'platform_superseded', kind: 'superseded_by_newer', runRevision: 4,
      detail: { supersededBy: by }, observedAt: AT } }, effects: [] };
}
function observedTo(state: PresentIntentState, node: Exclude<ControlNode, 'Absent' | 'Queued'>, observation: ControlObservationV1): Expected {
  return { ok: true, next: { node, kind: state.kind, revision: state.revision + 1, observation }, effects: [{ kind: 'guard_run' }] };
}
/** CTL-07 / CTL-08 (step 5.6): settled at revision + 1 with the reconcile's observation; the Run is the CAS guard. */
function reconciledTo(state: PresentIntentState, node: Exclude<ControlNode, 'Absent' | 'Queued'>,
  observation: ControlObservationV1 | ControlPlatformObservationV1 = platformObservation('terminal_without_cancel')): Expected {
  return { ok: true, next: { node, kind: state.kind, revision: state.revision + 1, observation }, effects: [{ kind: 'guard_run' }] };
}
/** CTL-09 (SD-1): the same Kernel fact again is an idempotent no-op. */
function unchanged(state: ControlIntentState): Expected {
  return { ok: true, next: state, effects: [] };
}

type SubmitEvent = Extract<ControlIntentEvent, { type: 'control_submitted' }>;
type AppliedEvent = Extract<ControlIntentEvent, { type: 'control_applied_not_entered' }>;
type ObservedEvent = Extract<ControlIntentEvent, { type: 'control_observed' }>;
function submitEvent(kind: ControlIntentKindV1, reason: string | null = 'operator reason',
  target: 'run' | 'query_run' = 'run'): SubmitEvent {
  return { type: 'control_submitted', target, intentRef: SELF, kind, reason };
}
function appliedEvent(kind: 'pause' | 'cancel' | 'resume', entryPhase: NotEnteredEntryPhase, reason: string | null = null): AppliedEvent {
  return { type: 'control_applied_not_entered', intentRef: SELF, kind, reason, entryPhase, runRevision: 4, observedAt: AT };
}
/** The event `control-service.ts` sends for a submission on this node (`submissionEventOf`, D-7). */
function submissionFor(node: ControlRunNode, kind: ControlIntentKindV1, reason: string | null = 'operator reason'): ControlSubmissionEvent {
  return isNotEntered(node) && kind !== 'steer' ? appliedEvent(kind, NOT_ENTERED[node], reason) : submitEvent(kind, reason);
}
function acceptedFor(node: ControlRunNode, kind: ControlIntentKindV1): Expected {
  return isNotEntered(node) && kind !== 'steer' ? appliedNotEntered(kind, NOT_ENTERED[node]) : submitted(kind);
}
function observedEvent(observation: ControlObservationV1): ObservedEvent {
  return { type: 'control_observed', observation };
}
const SUPERSEDED_EVENT: Extract<ControlIntentEvent, { type: 'control_superseded_by_newer' }> = {
  type: 'control_superseded_by_newer', supersededBy: OTHER, runRevision: 4, observedAt: AT,
};

/** One representative payload per event type; `satisfies` keeps the list complete. */
const EVENTS = {
  control_submitted: submitEvent('cancel', 'stop now'),
  control_applied_not_entered: appliedEvent('cancel', 'none'),
  control_superseded_by_newer: SUPERSEDED_EVENT,
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
  // CTL-02 from Absent is the §7.4 internal assertion on an entered Run (D-7); an existing intent answers like CTL-01.
  control_applied_not_entered: {
    Absent: ILLEGAL,
    'Queued:pause': IDENTITY_REUSED, 'Queued:cancel': IDENTITY_REUSED, 'Queued:resume': IDENTITY_REUSED, 'Queued:steer': IDENTITY_REUSED,
    'Applied:pause': IDENTITY_REUSED, 'Applied:cancel': IDENTITY_REUSED, 'Applied:resume': IDENTITY_REUSED, 'Applied:steer': IDENTITY_REUSED,
    'Superseded:pause': IDENTITY_REUSED, 'Superseded:cancel': IDENTITY_REUSED, 'Superseded:resume': IDENTITY_REUSED, 'Superseded:steer': IDENTITY_REUSED,
    'OutcomeUnknown:pause': IDENTITY_REUSED, 'OutcomeUnknown:cancel': IDENTITY_REUSED,
    'OutcomeUnknown:resume': IDENTITY_REUSED, 'OutcomeUnknown:steer': IDENTITY_REUSED,
  },
  // CTL-04: a queued intent the pointer (a steer: `controlInputs`) names is superseded; §7.4: only a queued one.
  control_superseded_by_newer: {
    Absent: ILLEGAL,
    'Queued:pause': supersededBy(queued('pause')), 'Queued:cancel': supersededBy(queued('cancel')),
    'Queued:resume': supersededBy(queued('resume')), 'Queued:steer': supersededBy(queued('steer')),
    'Applied:pause': ILLEGAL, 'Applied:cancel': ILLEGAL, 'Applied:resume': ILLEGAL, 'Applied:steer': ILLEGAL,
    'Superseded:pause': ILLEGAL, 'Superseded:cancel': ILLEGAL, 'Superseded:resume': ILLEGAL, 'Superseded:steer': ILLEGAL,
    'OutcomeUnknown:pause': ILLEGAL, 'OutcomeUnknown:cancel': ILLEGAL, 'OutcomeUnknown:resume': ILLEGAL, 'OutcomeUnknown:steer': ILLEGAL,
  },
  // CTL-03 for the cancel; a Kernel `cancelled` pairs only with a cancel. CTL-09: an observed intent is not
  // re-observed: the same Kernel fact is a no-op (Applied:cancel), any other content is stale.
  control_observed: {
    Absent: fail('illegal', 'not_found'),
    'Queued:pause': ILLEGAL, 'Queued:cancel': observedTo(queued('cancel'), 'Applied', kernelObservation('cancelled')),
    'Queued:resume': ILLEGAL, 'Queued:steer': ILLEGAL,
    'Applied:pause': STALE, 'Applied:cancel': unchanged(applied('cancel')), 'Applied:resume': STALE, 'Applied:steer': STALE,
    'Superseded:pause': STALE, 'Superseded:cancel': STALE, 'Superseded:resume': STALE, 'Superseded:steer': STALE,
    'OutcomeUnknown:pause': STALE, 'OutcomeUnknown:cancel': STALE, 'OutcomeUnknown:resume': STALE, 'OutcomeUnknown:steer': STALE,
  },
  // CTL-10 (step 5.6): only a queued cancel, and only on the proven exit (the base context has none).
  control_applied_paused_stop: {
    Absent: ILLEGAL,
    'Queued:pause': ILLEGAL, 'Queued:cancel': fail('guard_failed', 'incomplete'), 'Queued:resume': ILLEGAL, 'Queued:steer': ILLEGAL,
    'Applied:pause': ILLEGAL, 'Applied:cancel': ILLEGAL, 'Applied:resume': ILLEGAL, 'Applied:steer': ILLEGAL,
    'Superseded:pause': ILLEGAL, 'Superseded:cancel': ILLEGAL, 'Superseded:resume': ILLEGAL, 'Superseded:steer': ILLEGAL,
    'OutcomeUnknown:pause': ILLEGAL, 'OutcomeUnknown:cancel': ILLEGAL, 'OutcomeUnknown:resume': ILLEGAL, 'OutcomeUnknown:steer': ILLEGAL,
  },
  // CTL-08 (step 5.6): only the start-up reconcile settles a queued intent (the base context is live);
  // CTL-07: an outcome_unknown intent settles with a known observation only on the ended Run of RUN-21, never
  // on the base `Running` Run (7.4, the node guard). §7.4: terminal intents are skipped by reconcile.
  control_reconciled: {
    Absent: ILLEGAL,
    'Queued:pause': fail('illegal', 'forbidden'), 'Queued:cancel': fail('illegal', 'forbidden'),
    'Queued:resume': fail('illegal', 'forbidden'), 'Queued:steer': fail('illegal', 'forbidden'),
    'Applied:pause': ILLEGAL, 'Applied:cancel': ILLEGAL, 'Applied:resume': ILLEGAL, 'Applied:steer': ILLEGAL,
    'Superseded:pause': ILLEGAL, 'Superseded:cancel': ILLEGAL, 'Superseded:resume': ILLEGAL, 'Superseded:steer': ILLEGAL,
    'OutcomeUnknown:pause': ILLEGAL, 'OutcomeUnknown:cancel': ILLEGAL, 'OutcomeUnknown:resume': ILLEGAL,
    'OutcomeUnknown:steer': ILLEGAL,
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
// control_submitted / control_applied_not_entered (CTL-01, CTL-02, §7.4)     //
// -------------------------------------------------------------------------- //

/** The intent the pointer names, as `submitControl` reads it. */
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

describe('a submission from Absent: pointer × kind × Run node (CTL-01, CTL-02)', () => {
  for (const node of RUN_NODES) {
    for (const pointer of POINTERS) {
      for (const kind of KINDS) {
        it(`${node} / pointer ${pointer} / ${kind}`, () => {
          const ctx = ctxWith({ node, pointer }, { pointerIntent: POINTER_INTENT[pointer] });
          const result = transitionControlIntent(ABSENT, submissionFor(node, kind), ctx);
          if (node === 'Absent') return check(result, fail('illegal', 'not_found'));
          // §7.4: an ended Run (not YieldedWait) refuses every kind.
          if (node === 'Ended' || node === 'EndedUnknown') return check(result, fail('illegal', 'busy'));
          // D-7: a pause/cancel/resume of a Run that never entered is applied at once (CTL-02).
          check(result, POINTER_FENCE[pointer][kind] === 'ok' ? acceptedFor(node, kind) : fail('guard_failed', 'busy'));
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
    for (const event of [submitEvent('pause'), appliedEvent('pause', 'none')]) {
      expect(transitionControlIntent(ABSENT, event, ctxWith({ node: 'Absent' }, { pinsMatch: { intent: true, run: false } })))
        .toEqual({ ok: false, reason: 'illegal', code: 'not_found', detail: 'the target Run does not exist' });
    }
  });

  it('a stale Run pin is stale/revision_conflict before the ended-Run check and the D-7 route (7.4)', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('cancel'), ctxWith({ node: 'Ended' }, { pinsMatch: { intent: true, run: false } })))
      .toEqual({ ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the Run changed since the caller read it' });
    expect(transitionControlIntent(ABSENT, submitEvent('cancel'), ctxWith({ node: 'Claimed' }, { pinsMatch: { intent: true, run: false } })))
      .toEqual({ ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the Run changed since the caller read it' });
  });

  it('an ended Run refuses the control with busy (7.4, `control-service.ts:389-391`)', () => {
    for (const node of ['Ended', 'EndedUnknown'] as const) {
      expect(transitionControlIntent(ABSENT, submitEvent('steer'), ctxWith({ node })))
        .toEqual({ ok: false, reason: 'illegal', code: 'busy', detail: 'the Run already ended; no new control intent is accepted' });
      expect(transitionControlIntent(ABSENT, appliedEvent('cancel', 'none'), ctxWith({ node })))
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

  it('a paused-interrupted Run points to continuing the Task (step 5.6, C4)', () => {
    for (const kind of KINDS) {
      expect(transitionControlIntent(ABSENT, submitEvent(kind), ctxWith({ node: 'Ended', pausedInterrupted: true, pointer: 'paused' },
        { pointerIntent: POINTER_INTENT.paused })))
        .toEqual({ ok: false, reason: 'illegal', code: 'busy', detail: 'the paused Run ended at the Host restart; continue the Task' });
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
        expect(transitionControlIntent(ABSENT, submissionFor(node, 'resume'), ctxWith({ node, pointer: 'paused' }, { pointerIntent })))
          .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'resume requires an observed paused original Turn' });
      }
    }
    // The platform's own not-entered pause is an observed pause (CTL-02).
    expect(transitionControlIntent(ABSENT, appliedEvent('resume', 'authorized'), ctxWith({ node: 'Authorized', pointer: 'paused' },
      { pointerIntent: { kind: 'pause', status: 'applied', observed: 'paused' } }))).toEqual(appliedNotEntered('resume', 'authorized'));
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

  it('the pointer fence answers with the busy reasons of `freshSubmitControlProblem` (7.4, `:127-137`)', () => {
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

  it('D-8: the new cancel is queued; the queued pause it moves off is superseded by CTL-04 in the same commit', () => {
    expect(transitionControlIntent(ABSENT, submitEvent('cancel'), ctxWith({ pointer: 'paused' },
      { pointerIntent: { kind: 'pause', status: 'queued', observed: null } }))).toEqual(submitted('cancel'));
    expect(transitionControlIntent(queued('pause'), { ...SUPERSEDED_EVENT, supersededBy: SELF }, ctxWith({ pointer: 'paused' })))
      .toEqual(supersededBy(queued('pause'), SELF));
  });

  it('D-9: a resume while the Goal is not active is guard_failed/busy; pause, cancel and steer are not refused', () => {
    for (const desiredState of ['paused', 'cancelled'] as const) {
      for (const node of ['Authorized', 'Running', 'YieldedWait'] as const) {
        expect(transitionControlIntent(ABSENT, submissionFor(node, 'resume'), ctxWith({ node, pointer: 'paused' },
          { pointerIntent: POINTER_INTENT.paused, goal: { desiredState } })))
          .toEqual({ ok: false, reason: 'guard_failed', code: 'busy',
            detail: `the Goal is ${desiredState}; a single Run is not resumed while its Goal is not active` });
      }
      for (const kind of ['pause', 'cancel', 'steer'] as const) {
        expect(transitionControlIntent(ABSENT, submitEvent(kind), ctxWith({}, { goal: { desiredState } }))).toEqual(submitted(kind));
      }
    }
  });

  it('RD-8: a control on a YieldedWait whose continuation a successor consumed is guard_failed/busy', () => {
    for (const kind of KINDS) {
      expect(transitionControlIntent(ABSENT, submitEvent(kind), ctxWith({ node: 'YieldedWait', pointer: 'paused', continuationConsumed: true },
        { pointerIntent: { kind: 'pause', status: 'queued', observed: null } })))
        .toEqual({ ok: false, reason: 'guard_failed', code: 'busy',
          detail: 'a successor Run already consumed the yielded wait continuation; no new control intent is accepted' });
    }
    // A continuation not yet consumed keeps accepting the wait-window control.
    expect(transitionControlIntent(ABSENT, submitEvent('cancel'), ctxWith({ node: 'YieldedWait' }))).toEqual(submitted('cancel'));
  });

  it('D-7 route: CTL-02 for a Run that never entered, CTL-01 otherwise; the other event is an internal assertion', () => {
    for (const node of NOT_ENTERED_NODES) {
      for (const kind of ['pause', 'cancel'] as const) {
        expect(transitionControlIntent(ABSENT, appliedEvent(kind, NOT_ENTERED[node]), ctxWith({ node })))
          .toEqual(appliedNotEntered(kind, NOT_ENTERED[node]));
        expect(transitionControlIntent(ABSENT, submitEvent(kind), ctxWith({ node }))).toEqual({ ok: false, reason: 'illegal',
          code: 'invalid', detail: `a Run that never entered takes ${kind} through control_applied_not_entered (CTL-02)` });
      }
      // The entry phase must be the Run's own.
      const other = NOT_ENTERED[node] === 'none' ? 'revoked' : 'none';
      expect(transitionControlIntent(ABSENT, appliedEvent('pause', other), ctxWith({ node }))).toEqual({ ok: false, reason: 'illegal',
        code: 'invalid', detail: 'the not-entered entry phase disagrees with the Run' });
      // A steer is queued on a Run that never entered as on any open Run.
      expect(transitionControlIntent(ABSENT, submitEvent('steer'), ctxWith({ node }))).toEqual(submitted('steer'));
    }
    for (const node of ['Entering', 'Running'] as const) {
      expect(transitionControlIntent(ABSENT, appliedEvent('cancel', 'none'), ctxWith({ node }))).toEqual({ ok: false, reason: 'illegal',
        code: 'invalid', detail: 'from Entering on only the Kernel, RUN-23 or reconcile can apply a control (D-7)' });
    }
    expect(transitionControlIntent(ABSENT, appliedEvent('cancel', 'none'), ctxWith({ node: 'YieldedWait' }))).toEqual({ ok: false,
      reason: 'illegal', code: 'invalid', detail: 'a yielded wait keeps its control queued as the continuation fence' });
  });

  it('CTL-02 writes applied@2 with the observation of the platform (CD-1, CD-3), naming the Run revision of the commit', () => {
    expect(transitionControlIntent(ABSENT, { ...appliedEvent('cancel', 'revoked'), runRevision: 9 }, ctxWith({ node: 'Revoked' })))
      .toEqual(appliedNotEntered('cancel', 'revoked', 9));
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
              for (const goal of ['active', 'paused'] as const) {
                for (const continuationConsumed of [false, true]) {
                  const problem = controlSubmissionProblem({ kind, reason, pointer, yielded: node === 'YieldedWait',
                    continuationConsumed, pointerIntent, goal });
                  expect(transitionControlIntent(ABSENT, submissionFor(node, kind, reason),
                    ctxWith({ node, pointer, continuationConsumed }, { pointerIntent, goal: { desiredState: goal } })))
                    .toEqual(problem === null ? acceptedFor(node, kind)
                      : { ok: false, reason: 'guard_failed', code: problem.code, detail: problem.reason });
                }
              }
            }
          }
        }
      }
    }
  });

  it('the same derived intent ref with different content is a duplicate identity (7.4, R4-control-intent.test.ts:133-135)', () => {
    for (const label of STATE_LABELS.filter(candidate => candidate !== 'Absent')) {
      for (const event of [submitEvent('pause'), appliedEvent('pause', 'none')]) {
        expect(transitionControlIntent(STATES[label], event, ctxWith({ node: 'Ended' })))
          .toEqual({ ok: false, reason: 'duplicate', code: 'idempotency_conflict',
            detail: 'the control request identity was already used with different content' });
      }
    }
  });
});

// -------------------------------------------------------------------------- //
// control_superseded_by_newer (CTL-04, D-8)                                  //
// -------------------------------------------------------------------------- //

describe('control_superseded_by_newer (CTL-04)', () => {
  it('(a) supersedes the queued intent the pre-commit pointer names; (b) a queued steer of the Run', () => {
    for (const kind of ['pause', 'cancel', 'resume'] as const) {
      expect(transitionControlIntent(queued(kind), SUPERSEDED_EVENT, ctxWith({ pointsHere: true, inControlInputs: false })))
        .toEqual(supersededBy(queued(kind)));
      expect(transitionControlIntent(queued(kind), SUPERSEDED_EVENT, ctxWith({ pointsHere: false, inControlInputs: true })))
        .toEqual({ ok: false, reason: 'illegal', code: 'invalid',
          detail: 'only the intent the newer commit moves off the Run pointer, or a queued steer of the Run, is superseded' });
    }
    expect(transitionControlIntent(queued('steer'), SUPERSEDED_EVENT, ctxWith({ pointsHere: false, inControlInputs: true })))
      .toEqual(supersededBy(queued('steer')));
    expect(transitionControlIntent(queued('steer'), SUPERSEDED_EVENT, ctxWith({ pointsHere: true, inControlInputs: false })))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('only a queued intent can be superseded (7.4)', () => {
    for (const label of STATE_LABELS.filter(candidate => !candidate.startsWith('Queued'))) {
      expect(transitionControlIntent(STATES[label], SUPERSEDED_EVENT, ctxWith()))
        .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'only a queued control intent can be superseded' });
    }
  });

});

// -------------------------------------------------------------------------- //
// control_observed (CTL-03, CTL-05, CTL-06, CTL-09)                          //
// -------------------------------------------------------------------------- //

/** The CD-2 pairing a commit enforces for a Kernel observation (`control-record-codecs.ts`). */
const KERNEL_PAIRS: Record<ControlObservationV1['kind'], readonly ControlIntentKindV1[]> = {
  paused: ['pause'],
  resumed: ['resume'],
  steered: ['steer'],
  cancelled: ['cancel'],
  terminal_without_cancel: KINDS,
  outcome_unknown: KINDS,
};
const MAPPED_NODE: Record<ControlObservationV1['kind'], Exclude<ControlNode, 'Absent' | 'Queued'>> = {
  paused: 'Applied', resumed: 'Applied', steered: 'Applied', cancelled: 'Applied',
  terminal_without_cancel: 'Superseded', outcome_unknown: 'OutcomeUnknown',
};
/** CTL-06: a terminal that came first is recorded only for a Run that ended with a known outcome. */
function observationCtx(observed: ControlObservationV1['kind']): ControlGuardContext {
  return observed === 'terminal_without_cancel' ? ctxWith({ node: 'Ended' }) : ctxWith();
}

describe('control_observed: recorded node × intent kind × Kernel observation kind', () => {
  const recorded = STATE_LABELS.filter(label => label !== 'Absent');
  for (const label of recorded) {
    for (const observed of KERNEL_KINDS) {
      it(`${label} × ${observed}`, () => {
        const state = STATES[label];
        const observation = kernelObservation(observed);
        const result = transitionControlIntent(state, observedEvent(observation), observationCtx(observed));
        const kind = state.kind as ControlIntentKindV1;
        if (state.node !== 'Queued') {
          // CTL-09: the same Kernel fact again is a no-op; any other content is stale.
          // §7.4: an outcome_unknown intent is stale for every in-process observation.
          const same = state.node !== 'OutcomeUnknown' && state.observation !== null && !('origin' in state.observation)
            && state.observation.kind === observed;
          return check(result, same ? unchanged(state) : STALE);
        }
        // CD-2: a Kernel outcome_unknown (CTL-03) and terminal_without_cancel (CTL-06) close any kind.
        if (!KERNEL_PAIRS[observed].includes(kind)) return check(result, ILLEGAL);
        check(result, observedTo(state as PresentIntentState, MAPPED_NODE[observed], observation));
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
    expect(transitionControlIntent(queued('cancel'), observedEvent(kernelObservation('terminal_without_cancel')), ctxWith({ node: 'Ended' })))
      .toEqual(observedTo(queued('cancel'), 'Superseded', kernelObservation('terminal_without_cancel')));
    expect(transitionControlIntent(queued('cancel'), observedEvent(kernelObservation('outcome_unknown')), ctxWith()))
      .toEqual(observedTo(queued('cancel'), 'OutcomeUnknown', kernelObservation('outcome_unknown')));
  });

  it('CTL-03 (CD-2): a consumed pause that meets an unknown tool result is OutcomeUnknown', () => {
    for (const kind of KINDS) {
      expect(transitionControlIntent(queued(kind), observedEvent(kernelObservation('outcome_unknown')), ctxWith()))
        .toEqual(observedTo(queued(kind), 'OutcomeUnknown', kernelObservation('outcome_unknown')));
    }
  });

  it('CTL-06 (CD-2): a natural terminal over a queued pause/resume/steer supersedes it on a Run that ended', () => {
    for (const kind of ['pause', 'resume', 'steer'] as const) {
      expect(transitionControlIntent(queued(kind), observedEvent(kernelObservation('terminal_without_cancel')), ctxWith({ node: 'Ended' })))
        .toEqual(observedTo(queued(kind), 'Superseded', kernelObservation('terminal_without_cancel')));
    }
  });

  it('CTL-06 guard: not for a yielded wait (the continuation fence), an unknown end or an open Run', () => {
    for (const node of ['YieldedWait', 'EndedUnknown', 'Running', 'Entering'] as const) {
      expect(transitionControlIntent(queued('pause'), observedEvent(kernelObservation('terminal_without_cancel')), ctxWith({ node })), node)
        .toEqual({ ok: false, reason: 'guard_failed', code: 'busy',
          detail: 'terminal_without_cancel is recorded only after a known terminal that is not a yielded wait' });
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

  it('CTL-09: an observed intent is never re-observed; the same Kernel fact is a no-op, other content is stale', () => {
    for (const label of STATE_LABELS.filter(candidate => candidate !== 'Absent' && !candidate.startsWith('Queued'))) {
      const state = STATES[label];
      const recorded = state.observation;
      if (state.node === 'OutcomeUnknown') {
        // §7.4: only control_reconciled moves an outcome_unknown intent; the same fact again is stale too.
        const again = recorded !== null && !('origin' in recorded) ? recorded : kernelObservation('outcome_unknown');
        for (const observation of [again, { ...again, kernelEventId: 'ke-2' }]) {
          expect(transitionControlIntent(state, observedEvent(observation), ctxWith()), label).toEqual({ ok: false,
            reason: 'stale', code: 'revision_conflict', detail: 'the control intent is outcome_unknown; only the start-up reconcile settles it' });
        }
      } else if (recorded !== null && !('origin' in recorded)) {
        // Same kind, source position and Kernel event id: no write (SD-1), even with another window.
        expect(transitionControlIntent(state, observedEvent({ ...recorded, observedAt: '2026-10-04T02:00:00.000Z' }), ctxWith()), label)
          .toEqual(unchanged(state));
        for (const patch of [{ source: { ...KERNEL, position: 6 } }, { kernelEventId: 'ke-2' }]) {
          expect(transitionControlIntent(state, observedEvent({ ...recorded, ...patch }), ctxWith()), label).toEqual({ ok: false,
            reason: 'stale', code: 'revision_conflict',
            detail: `the control intent is already ${state.node.toLowerCase()}; a later observation does not change it` });
        }
      } else {
        // A platform-observed intent never matches a Kernel fact.
        expect(transitionControlIntent(state, observedEvent(kernelObservation(KERNEL_KINDS[0]!)), ctxWith()), label).toMatchObject(STALE);
      }
    }
    // The state guard comes before the Run is read: a missing Run does not change the answer.
    expect(transitionControlIntent(applied('pause'), observedEvent(kernelObservation('paused')), ctxWith({ node: 'Absent', entry: null })))
      .toEqual(unchanged(applied('pause')));
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

  it('the first failing row answers, in `control-service.ts:525-573` order, before the pairing', () => {
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
    // Every window row precedes the CTL-06 guard and the kind pairing.
    expect(observe(ctxWith(), kernelObservation('cancelled', { source: { ...KERNEL, position: 99 } }), queued('steer'))).toEqual(sourceOutside);
    expect(observe(ctxWith({ node: 'YieldedWait' }), kernelObservation('terminal_without_cancel', { source: { ...KERNEL, position: 99 } })))
      .toEqual(sourceOutside);
    // The CTL-06 guard precedes the pairing.
    expect(observe(ctxWith({ node: 'YieldedWait' }), kernelObservation('terminal_without_cancel')))
      .toMatchObject({ reason: 'guard_failed', code: 'busy' });
  });

  it('a revision that would leave the safe-integer range is refused', () => {
    const state: ControlIntentState = { ...queued('pause'), revision: Number.MAX_SAFE_INTEGER };
    expect(transitionControlIntent(state, observedEvent(kernelObservation('paused')), ctxWith()))
      .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'the control intent revision would not be a safe integer' });
    expect(transitionControlIntent(state, SUPERSEDED_EVENT, ctxWith()))
      .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'the control intent revision would not be a safe integer' });
  });
});

// -------------------------------------------------------------------------- //
// The reads control-service.ts makes before the machine answers              //
// -------------------------------------------------------------------------- //

describe('submissionReadsPointerIntent, submissionReadsGoal and observedIntentAnswer', () => {
  it('reads the pointer intent for a pause, cancel or resume past the target-Run rows that moves an existing pointer', () => {
    for (const node of RUN_NODES) {
      for (const pointer of POINTERS) {
        for (const kind of KINDS) {
          for (const runPinned of [true, false]) {
            const ctx = ctxWith({ node, pointer }, { pinsMatch: { intent: true, run: runPinned } });
            const label = `${node}/${pointer}/${kind}/${String(runPinned)}`;
            const event = submissionFor(node, kind);
            const reads = submissionReadsPointerIntent(event, ctx);
            const open = node !== 'Absent' && node !== 'Ended' && node !== 'EndedUnknown';
            expect(reads, label).toBe(kind !== 'steer' && runPinned && open && pointer !== 'none');
            // A submission that does not read it is answered the same whatever the pointer names.
            if (!reads) {
              const unread = transitionControlIntent(ABSENT, event, ctx);
              for (const pointerIntent of Object.values(POINTER_INTENT)) {
                expect(transitionControlIntent(ABSENT, event, { ...ctx, pointerIntent }), label).toEqual(unread);
              }
            }
            // The Goal is read for a resume past the same rows, and only then.
            const readsGoal = submissionReadsGoal(event, ctx);
            expect(readsGoal, label).toBe(kind === 'resume' && runPinned && open);
            if (!readsGoal) {
              expect(transitionControlIntent(ABSENT, event, { ...ctx, goal: { desiredState: 'paused' } }), label)
                .toEqual(transitionControlIntent(ABSENT, event, ctx));
            }
          }
        }
      }
    }
    expect(submissionReadsPointerIntent(submitEvent('resume', null, 'query_run'), ctxWith({ pointer: 'paused' }))).toBe(false);
    expect(submissionReadsGoal(submitEvent('resume', null, 'query_run'), ctxWith({ pointer: 'paused' }))).toBe(false);
  });

  it('a resume that reads it is answered by it, before the pointer fence', () => {
    for (const node of ['Claimed', 'Authorized', 'Entering', 'Revoked', 'Running'] as const) {
      const ctx = ctxWith({ node, pointer: 'cancelled' });
      const event = submissionFor(node, 'resume');
      expect(submissionReadsPointerIntent(event, ctx), node).toBe(true);
      expect(transitionControlIntent(ABSENT, event, { ...ctx, pointerIntent: POINTER_INTENT.cancelled }), node)
        .toEqual({ ok: false, reason: 'guard_failed', code: 'busy', detail: 'resume requires an observed paused original Turn' });
    }
  });

  it('observedIntentAnswer: the intent pin, then CTL-09 for an observed intent; null when the Run must be read', () => {
    const event = observedEvent(kernelObservation('paused'));
    const stale = { ok: false, reason: 'stale', code: 'revision_conflict', detail: 'the control intent changed since the caller read it' };
    expect(observedIntentAnswer(queued('pause'), event, { pinsMatch: { intent: true, run: false } })).toBeNull();
    expect(observedIntentAnswer(queued('pause'), event, { pinsMatch: { intent: false, run: true } })).toEqual(stale);
    expect(observedIntentAnswer(applied('pause'), event, { pinsMatch: { intent: true, run: true } })).toEqual(unchanged(applied('pause')));
    expect(observedIntentAnswer(applied('cancel'), event, { pinsMatch: { intent: true, run: true } })).toMatchObject(STALE);
    for (const label of STATE_LABELS.filter(candidate => candidate !== 'Absent')) {
      expect(transitionControlIntent(STATES[label], event, ctxWith({ node: 'Absent', entry: null, history: null },
        { pinsMatch: { intent: false, run: false } })), label).toEqual(stale);
    }
  });
});

// -------------------------------------------------------------------------- //
// CTL-07 / CTL-08 / CTL-10 (A.2 step 5.6)                                    //
// -------------------------------------------------------------------------- //

describe('the reconcile and paused-stop rows (CTL-07, CTL-08, CTL-10; A.2 step 5.6)', () => {
  it('CTL-10 control_applied_paused_stop: a queued cancel on the proven exit; in process only at a paused safe point (7.4)', () => {
    const stop = EVENTS.control_applied_paused_stop;
    expect(transitionControlIntent(queued('cancel'), stop, ctxWith({ kernelPaused: true }, { exitProof: null })))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'incomplete' });
    expect(transitionControlIntent(queued('cancel'), stop, ctxWith({ kernelPaused: false }, { exitProof: 'live_clean' })))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'incomplete' });
    // The stop names the exit it was proven on.
    expect(transitionControlIntent(queued('cancel'), stop, ctxWith({ kernelPaused: true }, { exitProof: 'host_instance_takeover' })))
      .toMatchObject({ ok: false, reason: 'guard_failed', code: 'incomplete' });
    expect(transitionControlIntent(queued('cancel'), stop, ctxWith({ kernelPaused: true, pointsHere: false }, { exitProof: 'live_clean' })))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    expect(transitionControlIntent(queued('cancel'), stop, ctxWith({ kernelPaused: true }, { exitProof: 'live_clean' }))).toEqual({
      ok: true, effects: [], next: { node: 'Applied', kind: 'cancel', revision: 2, observation: { schemaVersion: 1,
        origin: 'platform_paused_stop', kind: 'cancelled', runRevision: 4, detail: { basis: 'live_clean', pausedBy: OTHER }, observedAt: AT } },
    });
    // LA-7: at a restart the queued cancel stops a clean Turn whether or not the Kernel paused it.
    const restartStop = { ...stop, basis: 'host_instance_takeover' as const, pausedBy: null };
    expect(transitionControlIntent(queued('cancel'), restartStop, ctxWith({ kernelPaused: false }, { exitProof: 'host_instance_takeover' })))
      .toMatchObject({ ok: true, next: { node: 'Applied', kind: 'cancel', observation: { origin: 'platform_paused_stop',
        detail: { basis: 'host_instance_takeover', pausedBy: null } } } });
    for (const label of STATE_LABELS.filter(candidate => candidate !== 'Queued:cancel')) {
      expect(transitionControlIntent(STATES[label], stop, ctxWith({ kernelPaused: true }, { exitProof: 'live_clean' })))
        .toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail: 'only a queued cancel can be applied by a paused stop' });
    }
  });

  it('CTL-08 control_reconciled: the start-up reconcile settles a queued intent with its observation', () => {
    const reconcile = (observation: ControlObservationV1 | ControlPlatformObservationV1): ControlIntentEvent =>
      ({ type: 'control_reconciled', hostInstanceId: 'host-1', observation });
    const restart = ctxWith({ node: 'Ended', pausedInterrupted: true, pointer: 'paused' }, { origin: 'reconcile', exitProof: 'host_instance_takeover' });
    const ended = ctxWith({ node: 'Ended' }, { origin: 'reconcile', exitProof: 'host_instance_takeover' });
    // CTL-08(f), C4: a queued pause on a RUN-24 Run never takes a Kernel `paused` or the end's supersede.
    for (const observation of [kernelObservation('paused'), platformObservation('terminal_without_cancel')]) {
      expect(transitionControlIntent(queued('pause'), reconcile(observation), restart))
        .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    }
    expect(transitionControlIntent(queued('pause'), reconcile(platformObservation('paused')), restart))
      .toEqual(reconciledTo(queued('pause'), 'Applied', platformObservation('paused')));
    // The platform `paused` conclusion belongs only to a paused-interrupted Run.
    expect(transitionControlIntent(queued('pause'), reconcile(platformObservation('paused')), ended))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    // CTL-08(b): a steer the Kernel accepted; (c): the end came first; (d): an unknown end.
    expect(transitionControlIntent(queued('steer'), reconcile(kernelObservation('steered')), ended))
      .toEqual(reconciledTo(queued('steer'), 'Applied', kernelObservation('steered')));
    expect(transitionControlIntent(queued('resume'), reconcile(platformObservation('terminal_without_cancel')), ended))
      .toEqual(reconciledTo(queued('resume'), 'Superseded'));
    const endedUnknown = ctxWith({ node: 'EndedUnknown' }, { origin: 'reconcile', exitProof: 'host_instance_takeover' });
    expect(transitionControlIntent(queued('cancel'), reconcile(platformObservation('outcome_unknown')), endedUnknown))
      .toEqual(reconciledTo(queued('cancel'), 'OutcomeUnknown', platformObservation('outcome_unknown')));
    // 7.4, the node guard: each conclusion belongs to the Run node the same commit leaves (CTL-08(a)..(f)).
    const notEntered = (node: 'Claimed' | 'Authorized' | 'Revoked' | 'Ended') =>
      ctxWith({ node }, { origin: 'reconcile', exitProof: 'host_instance_takeover' });
    expect(transitionControlIntent(queued('cancel'), reconcile(platformObservation('outcome_unknown')), ended))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    for (const node of ['Running', 'Entering', 'Claimed', 'YieldedWait'] as const) {
      const context = ctxWith({ node }, { origin: 'reconcile', exitProof: 'host_instance_takeover' });
      expect(transitionControlIntent(queued('cancel'), reconcile(platformObservation('outcome_unknown')), context), node)
        .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
      expect(transitionControlIntent(queued('resume'), reconcile(platformObservation('terminal_without_cancel')), context), node)
        .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
      expect(transitionControlIntent(queued('steer'), reconcile(kernelObservation('steered')), context), node)
        .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    }
    expect(transitionControlIntent(queued('resume'), reconcile(platformObservation('terminal_without_cancel')), endedUnknown))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    // CTL-08(a): the not-entered conclusion only on a Run that never entered (a cancel ends it in the same commit).
    for (const node of ['Claimed', 'Authorized', 'Revoked'] as const) {
      expect(transitionControlIntent(queued('resume'), reconcile(platformObservation('resumed')), notEntered(node)), node)
        .toEqual(reconciledTo(queued('resume'), 'Applied', platformObservation('resumed')));
    }
    expect(transitionControlIntent(queued('cancel'), reconcile(platformObservation('cancelled')), notEntered('Ended')))
      .toEqual(reconciledTo(queued('cancel'), 'Applied', platformObservation('cancelled')));
    expect(transitionControlIntent(queued('resume'), reconcile(platformObservation('resumed')), notEntered('Ended')))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    for (const node of ['Entering', 'Running', 'EndedUnknown'] as const) {
      expect(transitionControlIntent(queued('cancel'), reconcile(platformObservation('cancelled')),
        ctxWith({ node }, { origin: 'reconcile', exitProof: 'host_instance_takeover' })), node)
        .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    }
    // Only the start-up reconcile settles a queued intent.
    expect(transitionControlIntent(queued('cancel'), reconcile(platformObservation('outcome_unknown')), ctxWith({ node: 'Ended' })))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'forbidden' });
    // The observation pairs with the intent kind.
    expect(transitionControlIntent(queued('steer'), reconcile(kernelObservation('cancelled')), ended))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
  });

  it('CTL-07 control_reconciled: an outcome_unknown intent leaves only with a known observation; terminal intents are skipped (7.4)', () => {
    const reconcile = (observation: ControlObservationV1 | ControlPlatformObservationV1): ControlIntentEvent =>
      ({ type: 'control_reconciled', hostInstanceId: 'host-1', observation });
    const restart = ctxWith({ node: 'Ended', pausedInterrupted: true, pointer: 'paused' }, { origin: 'reconcile', exitProof: 'host_instance_takeover' });
    expect(transitionControlIntent(outcomeUnknown('cancel'), reconcile(platformObservation('outcome_unknown')), restart))
      .toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
    // RUN-21 settles it in process too (the live origin).
    expect(transitionControlIntent(outcomeUnknown('cancel'), reconcile(kernelObservation('cancelled')), ctxWith({ node: 'Ended' })))
      .toEqual(reconciledTo(outcomeUnknown('cancel'), 'Applied', kernelObservation('cancelled')));
    // A yielded RUN-21 leaves the Run a yielded wait: the end came first (7.4 node guard); never on a live Run.
    expect(transitionControlIntent(outcomeUnknown('steer'), reconcile(platformObservation('terminal_without_cancel')),
      ctxWith({ node: 'YieldedWait' }))).toEqual(reconciledTo(outcomeUnknown('steer'), 'Superseded'));
    expect(transitionControlIntent(outcomeUnknown('steer'), reconcile(platformObservation('terminal_without_cancel')),
      ctxWith({ node: 'EndedUnknown' }))).toMatchObject({ ok: false, reason: 'illegal', code: 'invalid' });
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
  it('desiredStateOfKind and pointerAfterSubmit (RUN-09..15)', () => {
    expect(KINDS.map(desiredStateOfKind)).toEqual(['paused', 'cancelled', 'running', 'steered']);
    expect(pointerAfterSubmit('pause', SELF)).toEqual({ kind: 'set_pointer', controlState: { intentRef: SELF, desiredState: 'paused' } });
    expect(pointerAfterSubmit('cancel', SELF)).toEqual({ kind: 'set_pointer', controlState: { intentRef: SELF, desiredState: 'cancelled' } });
    expect(pointerAfterSubmit('resume', SELF)).toEqual({ kind: 'set_pointer', controlState: { intentRef: SELF, desiredState: 'running' } });
    expect(pointerAfterSubmit('steer', SELF)).toEqual({ kind: 'append_input', intentRef: SELF });
  });

  it('notEnteredEntryPhase names the entry phase of exactly the nodes that never entered (RD-1)', () => {
    expect(Object.fromEntries(RUN_NODES.map(node => [node, notEnteredEntryPhase(node)]))).toEqual({
      Absent: null, Claimed: 'none', Authorized: 'authorized', Entering: null, Revoked: 'revoked', Running: null, Ended: null,
      YieldedWait: null, EndedUnknown: null,
    });
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

  it('controlSubmissionProblem: RD-8, steer text, the applied-pause resume check, D-9 Goal, then controlSubmitProblem', () => {
    const base = { continuationConsumed: false, goal: 'active' as const };
    // A consumed continuation answers first, whatever the submission.
    for (const kind of KINDS) {
      expect(controlSubmissionProblem({ ...base, kind, reason: null, pointer: 'cancelled', yielded: true, pointerIntent: null,
        continuationConsumed: true, goal: 'paused' }))
        .toEqual({ status: 'rejected', code: 'busy',
          reason: 'a successor Run already consumed the yielded wait continuation; no new control intent is accepted' });
      // Only a yielded wait has a continuation to consume.
      expect(controlSubmissionProblem({ ...base, kind: 'steer', reason: 'text', pointer: 'none', yielded: false, pointerIntent: null,
        continuationConsumed: true })).toBeNull();
    }
    // The steer text is checked next, whatever the pointer.
    for (const reason of [null, '', '  \n']) {
      for (const pointer of POINTERS) {
        expect(controlSubmissionProblem({ ...base, kind: 'steer', reason, pointer, yielded: false, pointerIntent: POINTER_INTENT[pointer] }))
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
      expect(controlSubmissionProblem({ ...base, kind: 'resume', reason: null, pointer: 'paused', yielded: false, pointerIntent, goal: 'paused' }))
        .toEqual({ status: 'rejected', code: 'busy', reason: 'resume requires an observed paused original Turn' });
      expect(controlSubmissionProblem({ ...base, kind: 'resume', reason: null, pointer: 'paused', yielded: true, pointerIntent })).toBeNull();
    }
    // D-9 after the resume rule and before the pointer fence.
    for (const goal of ['paused', 'cancelled'] as const) {
      expect(controlSubmissionProblem({ kind: 'resume', reason: null, pointer: 'none', yielded: false, pointerIntent: null,
        continuationConsumed: false, goal }))
        .toEqual({ status: 'rejected', code: 'busy', reason: `the Goal is ${goal}; a single Run is not resumed while its Goal is not active` });
      expect(controlSubmissionProblem({ kind: 'cancel', reason: null, pointer: 'none', yielded: false, pointerIntent: null,
        continuationConsumed: false, goal })).toBeNull();
    }
    expect(controlSubmissionProblem({ ...base, kind: 'resume', reason: null, pointer: 'none', yielded: false, pointerIntent: null }))
      .toEqual(controlSubmitProblem('none', 'resume'));
    // Otherwise it is exactly the pointer fence.
    for (const pointer of POINTERS) {
      for (const kind of KINDS) {
        for (const yielded of [false, true]) {
          const resumeCheck = kind === 'resume' && !yielded && pointer !== 'none' && pointer !== 'paused';
          expect(controlSubmissionProblem({ ...base, kind, reason: 'text', pointer, yielded, pointerIntent: POINTER_INTENT[pointer] }))
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
  it('observationPairingProblem accepts exactly what the snapshot codec accepts (CD-2)', () => {
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
      if (kind !== 'steer') {
        for (const node of NOT_ENTERED_NODES) {
          const appliedAt = transitionControlIntent(ABSENT, appliedEvent(kind, NOT_ENTERED[node]),
            ctxWith({ node, pointer: kind === 'resume' ? 'paused' : 'none' }, { pointerIntent: kind === 'resume' ? POINTER_INTENT.paused : null }));
          if (appliedAt.ok) accepted.push({ request: requestFor(kind), next: appliedAt.next });
        }
      }
      const supersede = transitionControlIntent(queued(kind), SUPERSEDED_EVENT, ctxWith());
      if (supersede.ok) accepted.push({ request: requestFor(kind), next: supersede.next });
      for (const label of STATE_LABELS.filter(candidate => candidate.endsWith(`:${kind}`))) {
        for (const observed of KERNEL_KINDS) {
          for (const pointsHere of [true, false]) {
            const result = transitionControlIntent(STATES[label], observedEvent(kernelObservation(observed)),
              { ...observationCtx(observed), run: { ...observationCtx(observed).run, pointsHere, inControlInputs: pointsHere } });
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
      .toThrow('a cancelled observation must belong to a cancel intent');
    expect(() => controlIntentRecordOf({ ...pause, desiredState: 'running' }, applied('pause'))).toThrow('must desire paused');
    expect(() => newQueuedControlIntentRecord({ ...pause, desiredState: 'cancelled' })).toThrow('must desire paused');
  });

  it('controlIntentStateOf reads Absent from no record', () => {
    expect(controlIntentStateOf(null)).toEqual(ABSENT);
  });
});
