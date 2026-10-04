/**
 * §10 SessionMessage machine (docs/refactor/STATE-MACHINES-SPEC.md): every
 * (state, event) pair of MSG-01..MSG-10, the §10.4 forbidden rows, the record
 * constructors (§14.1) and the I-8 monotonicity property (§11.8). Pure: no
 * RecordStore, no Kernel.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { CoreError, CoreRejection } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RoleBindingRefV1, SourceRefV1 } from '../../src/contracts/dispatch.js';
import { deriveSessionInputId, type SessionMessage } from '../../src/core/work-graph/communication/contracts.js';
import { checkSessionMessageBody } from '../../src/core/work-graph/communication/message-record-codecs.js';
import {
  createSessionMessageRecord,
  inputObserverProblem,
  messageMachineStateOf,
  messagePinProblem,
  messagePrincipalProblem,
  messageRecipientProjectProblem,
  messageSatisfiesWait,
  messageSendFlagsProblem,
  nextSessionMessageRecord,
  transitionMessage,
  type MessageAcceptedInput,
  type MessageEffect,
  type MessageEvent,
  type MessageGuardContext,
  type MessageMachineState,
  type MessageQueryAnswerSenderRecord,
  type MessageResponseRecord,
  type MessageTransition,
  type MessageWorkRunSenderRecord,
  type NewSessionMessageInput,
  type SessionMessageRecord,
  type SessionMessageStatus,
} from '../../src/core/work-graph/state/message-machine.js';
import type { TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const PROJECT = 'p-msg';
const WORKSPACE = 'w-msg';
const MESSAGE_REF: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: PROJECT, workspaceId: WORKSPACE, messageId: 'm-1' };
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '7' };
const ANSWER_SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '5' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'sha256:body', sizeBytes: 11, source: SOURCE };
const REPLY_BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'sha256:reply', sizeBytes: 5, source: SOURCE };
const ANSWER_BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'sha256:answer', sizeBytes: 6, source: ANSWER_SOURCE };
const RECIPIENT: SessionRef = { projectId: PROJECT, sessionId: 's-recipient' };
const SENDER_SESSION: SessionRef = { projectId: PROJECT, sessionId: 's-sender' };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};
const HOST_SENDER = { kind: 'host', actor: { kind: 'human', id: 'operator' } } as const;
const WORK_RUN_SENDER: MessageWorkRunSenderRecord = {
  kind: 'work_run', sessionRef: SENDER_SESSION,
  runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'g-1', runId: 'run-sender' }, roleBinding: ROLE, generation: 2,
};
const RESPONDER: MessageWorkRunSenderRecord = {
  kind: 'work_run', sessionRef: RECIPIENT,
  runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'g-1', runId: 'run-recipient' }, roleBinding: ROLE, generation: 3,
};
const ANSWER_SENDER: MessageQueryAnswerSenderRecord = {
  kind: 'query_run', sessionRef: RECIPIENT,
  queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'qj-1', runId: 'qr-1' },
  answerRef: { aggregateType: 'QueryJobAnswer', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'qj-1', answerId: 'a-1' },
  generation: 4,
};
const KERNEL = { adapterId: 'fake', kernelSessionId: 'ks-1', runId: 'kr-1', turnId: 't-1', position: 3 };
const MESSAGE_INPUT = deriveSessionInputId(MESSAGE_REF, 'message');
const RESPONSE_INPUT = deriveSessionInputId(MESSAGE_REF, 'response');

const STATES = {
  absent: { status: 'absent' },
  pending: { status: 'pending', hasReadAt: false, hasResponse: false, acceptedInputIds: [], hasDerivation: false, revision: 1 },
  read: { status: 'read', hasReadAt: true, hasResponse: false, acceptedInputIds: [], hasDerivation: false, revision: 2 },
  responded: { status: 'responded', hasReadAt: true, hasResponse: true, acceptedInputIds: [], hasDerivation: false, revision: 3 },
  /** pending, with the A′ derivation fixed and the message part already delivered. */
  pendingDerivedDelivered: {
    status: 'pending', hasReadAt: false, hasResponse: false, acceptedInputIds: [MESSAGE_INPUT], hasDerivation: true, revision: 3,
  },
  /** responded, derivation fixed, both parts delivered. */
  respondedComplete: {
    status: 'responded', hasReadAt: true, hasResponse: true, acceptedInputIds: [MESSAGE_INPUT, RESPONSE_INPUT], hasDerivation: true, revision: 6,
  },
} as const satisfies Record<string, MessageMachineState>;
type StateName = keyof typeof STATES;
const STATE_NAMES = Object.keys(STATES) as StateName[];
const PRESENT_STATE_NAMES = STATE_NAMES.filter((name): name is Exclude<StateName, 'absent'> => name !== 'absent');
// Every machine status has at least one fixture.
const STATUS_COVERAGE: Record<MessageMachineState['status'], StateName> = {
  absent: 'absent', pending: 'pending', read: 'read', responded: 'responded',
};

const EVENTS = {
  sent: { type: 'message_sent' },
  read: { type: 'message_read' },
  respondText: { type: 'message_responded', via: 'text' },
  respondAnswer: { type: 'message_responded', via: 'query_answer' },
  acceptMessage: { type: 'input_accepted', part: 'message', inputId: MESSAGE_INPUT },
  acceptResponse: { type: 'input_accepted', part: 'response', inputId: RESPONSE_INPUT },
  derived: { type: 'consultation_derived' },
  claimed: { type: 'task_claimed' },
} as const satisfies Record<string, MessageEvent>;
type EventName = keyof typeof EVENTS;
const EVENT_NAMES = Object.keys(EVENTS) as EventName[];
// Every event type of the union has at least one fixture.
const EVENT_COVERAGE: Record<MessageEvent['type'], EventName> = {
  message_sent: 'sent', message_read: 'read', message_responded: 'respondText', input_accepted: 'acceptMessage',
  consultation_derived: 'derived', task_claimed: 'claimed',
};

function revisionOf(state: MessageMachineState): number {
  return state.status === 'absent' ? 1 : state.revision;
}

function baseCtx(): MessageGuardContext {
  return {
    principal: 'host', workRunAuthorization: null, callerIsRecipient: null, recipientScope: null, sendFlags: null,
    pins: { count: 0, matchesMessage: false, revision: null }, bodyBounded: null, queryAnswer: null, inputAccepted: null, consumedWait: null,
  };
}

function pinFor(state: MessageMachineState): MessageGuardContext['pins'] {
  return { count: 1, matchesMessage: true, revision: revisionOf(state) };
}

/** MSG-06's settled Query facts when every consultation check holds. */
const ANSWER_FACTS: NonNullable<MessageGuardContext['queryAnswer']> = {
  binding: 'matches', jobAnsweredWithAnswer: true, run: 'settled_answered', answeringSessionIsClaimSession: true,
  answerOfRun: true, sessionGenerationReadable: true,
};

/** Each failing MSG-06 fact in `respondFromQueryAnswer` order, with today's code and reason. */
const ANSWER_REFUSALS: ReadonlyArray<{ facts: Partial<NonNullable<MessageGuardContext['queryAnswer']>>; code: CoreError; detail: string }> = [
  { facts: { binding: 'not_consultation' }, code: 'forbidden', detail: 'the Query answer is not an explicit consultation answer' },
  { facts: { binding: 'other_message' }, code: 'forbidden', detail: 'the consultation answer belongs to another message' },
  { facts: { binding: 'other_recipient' }, code: 'forbidden', detail: 'the consultation answer recipient is not the original message recipient' },
  { facts: { binding: 'other_derivation_source' }, code: 'forbidden', detail: 'the derived answer source is not the original message recipient' },
  { facts: { binding: 'other_query_identity' }, code: 'forbidden', detail: 'the consultation answer does not match the deterministic message identity' },
  { facts: { jobAnsweredWithAnswer: false }, code: 'forbidden', detail: 'the QueryJob does not record this answer as its formal answered fact' },
  { facts: { run: 'not_settled' }, code: 'forbidden', detail: 'the QueryRun is not settled and cannot source a message reply' },
  { facts: { run: 'not_answered' }, code: 'forbidden', detail: 'the QueryRun did not settle as answered' },
  { facts: { answeringSessionIsClaimSession: false }, code: 'forbidden', detail: 'the QueryRun was not claimed by the formal answerer Session' },
  { facts: { answerOfRun: false }, code: 'forbidden', detail: 'the Query answer does not belong to the settled QueryRun' },
  { facts: { sessionGenerationReadable: false }, code: 'unavailable', detail: 'the QueryRun Session generation is not readable' },
];

/** The context under which each event is legal from a state that allows it. */
function happyCtx(event: EventName, state: MessageMachineState): MessageGuardContext {
  const base = baseCtx();
  switch (event) {
    case 'sent':
      return { ...base, recipientScope: 'same_workspace', sendFlags: { needsReply: false, waitAfterSend: false, replyMode: null, pinCount: 0 } };
    case 'read':
      return { ...base, principal: 'work_run', workRunAuthorization: 'ok', callerIsRecipient: true, pins: pinFor(state) };
    case 'respondText':
      return { ...base, principal: 'work_run', workRunAuthorization: 'ok', callerIsRecipient: true, bodyBounded: true, pins: pinFor(state) };
    case 'respondAnswer':
      return { ...base, pins: pinFor(state), bodyBounded: true, queryAnswer: ANSWER_FACTS };
    case 'acceptMessage':
    case 'acceptResponse':
      return {
        ...base,
        inputAccepted: {
          observerOwnsExecution: true, kernelMatches: true, claimedSessionMatches: true, executionSessionMatches: true,
          inputIdTakenByOtherEvent: false,
        },
      };
    case 'derived':
      return { ...base, pins: pinFor(state) };
    case 'claimed':
      return { ...base, consumedWait: { responseRefMatches: true, sameWorkspace: true } };
  }
}

// --------------------------------------------------------------------------
// Expected results
// --------------------------------------------------------------------------

type Expected =
  | { ok: true; next: MessageMachineState; effects: readonly MessageEffect[] }
  | { ok: false; reason: TransitionRejectReason; code: CoreError };

const ok = (next: MessageMachineState, effects: readonly MessageEffect[]): Expected => ({ ok: true, next, effects });
const no = (reason: TransitionRejectReason, code: CoreError): Expected => ({ ok: false, reason, code });

const SEND_HOST: readonly MessageEffect[] = [
  { kind: 'store_body', part: 'message', source: 'workspace' },
  { kind: 'write_message', change: 'created' },
  { kind: 'append_event', eventType: 'SessionMessageSent' },
  { kind: 'guard_message', expectedRevision: null },
];
const READ_EFFECTS = (revision: number): readonly MessageEffect[] => [
  { kind: 'write_message', change: 'read' },
  { kind: 'append_event', eventType: 'SessionMessageRead' },
  { kind: 'guard_message', expectedRevision: revision },
  { kind: 'guard_work_run_facts' },
];
const TEXT_EFFECTS = (revision: number): readonly MessageEffect[] => [
  { kind: 'store_body', part: 'response', source: 'workspace' },
  { kind: 'write_message', change: 'responded' },
  { kind: 'append_event', eventType: 'SessionMessageResponded' },
  { kind: 'guard_message', expectedRevision: revision },
  { kind: 'guard_work_run_facts' },
];
const ANSWER_EFFECTS = (revision: number): readonly MessageEffect[] => [
  { kind: 'store_body', part: 'response', source: 'answer' },
  { kind: 'write_message', change: 'responded' },
  { kind: 'append_event', eventType: 'SessionMessageResponded' },
  { kind: 'guard_message', expectedRevision: revision },
];
const ACCEPT_EFFECTS = (revision: number): readonly MessageEffect[] => [
  { kind: 'write_message', change: 'input_accepted' },
  { kind: 'append_event', eventType: 'SessionMessageInputAccepted' },
  { kind: 'guard_message', expectedRevision: revision },
];
const DERIVE_EFFECTS = (revision: number): readonly MessageEffect[] => [
  { kind: 'write_message', change: 'consultation_derived' },
  { kind: 'append_event', eventType: 'SessionMessageConsultationDerived' },
  { kind: 'guard_message', expectedRevision: revision },
];

const S = STATES;
const NOT_FOUND = no('illegal', 'not_found');
const EXISTS = no('illegal', 'revision_conflict');

/** The full (state, event) table under `happyCtx`. */
const TABLE: Record<StateName, Record<EventName, Expected>> = {
  absent: {
    sent: ok({ status: 'pending', hasReadAt: false, hasResponse: false, acceptedInputIds: [], hasDerivation: false, revision: 1 }, SEND_HOST), // MSG-01
    read: NOT_FOUND,
    respondText: NOT_FOUND,
    respondAnswer: NOT_FOUND,
    acceptMessage: NOT_FOUND,
    acceptResponse: NOT_FOUND,
    derived: NOT_FOUND,
    claimed: no('guard_failed', 'busy'),
  },
  pending: {
    sent: EXISTS,
    read: ok({ ...S.pending, status: 'read', hasReadAt: true, revision: 2 }, READ_EFFECTS(1)), // MSG-03
    respondText: ok({ ...S.pending, status: 'responded', hasReadAt: true, hasResponse: true, revision: 2 }, TEXT_EFFECTS(1)), // MSG-04
    respondAnswer: ok({ ...S.pending, status: 'responded', hasReadAt: true, hasResponse: true, revision: 2 }, ANSWER_EFFECTS(1)), // MSG-06
    acceptMessage: ok({ ...S.pending, acceptedInputIds: [MESSAGE_INPUT], revision: 2 }, ACCEPT_EFFECTS(1)), // MSG-07
    acceptResponse: no('guard_failed', 'forbidden'),
    derived: ok({ ...S.pending, hasDerivation: true, revision: 2 }, DERIVE_EFFECTS(1)), // MSG-09
    claimed: no('guard_failed', 'busy'),
  },
  read: {
    sent: EXISTS,
    read: no('illegal', 'invalid'),
    respondText: ok({ ...S.read, status: 'responded', hasResponse: true, revision: 3 }, TEXT_EFFECTS(2)), // MSG-05
    respondAnswer: ok({ ...S.read, status: 'responded', hasResponse: true, revision: 3 }, ANSWER_EFFECTS(2)), // MSG-06
    acceptMessage: ok({ ...S.read, acceptedInputIds: [MESSAGE_INPUT], revision: 3 }, ACCEPT_EFFECTS(2)), // MSG-07
    acceptResponse: no('guard_failed', 'forbidden'),
    derived: ok({ ...S.read, hasDerivation: true, revision: 3 }, DERIVE_EFFECTS(2)), // MSG-09
    claimed: no('guard_failed', 'busy'),
  },
  responded: {
    sent: EXISTS,
    read: no('illegal', 'invalid'),
    respondText: no('illegal', 'invalid'),
    respondAnswer: no('illegal', 'invalid'),
    acceptMessage: ok({ ...S.responded, acceptedInputIds: [MESSAGE_INPUT], revision: 4 }, ACCEPT_EFFECTS(3)), // MSG-07
    acceptResponse: ok({ ...S.responded, acceptedInputIds: [RESPONSE_INPUT], revision: 4 }, ACCEPT_EFFECTS(3)), // MSG-08
    derived: ok({ ...S.responded, hasDerivation: true, revision: 4 }, DERIVE_EFFECTS(3)), // MSG-09
    claimed: ok(S.responded, []), // MSG-10 (SD-1)
  },
  pendingDerivedDelivered: {
    sent: EXISTS,
    read: ok({ ...S.pendingDerivedDelivered, status: 'read', hasReadAt: true, revision: 4 }, READ_EFFECTS(3)),
    respondText: ok({ ...S.pendingDerivedDelivered, status: 'responded', hasReadAt: true, hasResponse: true, revision: 4 }, TEXT_EFFECTS(3)),
    respondAnswer: ok({ ...S.pendingDerivedDelivered, status: 'responded', hasReadAt: true, hasResponse: true, revision: 4 }, ANSWER_EFFECTS(3)),
    acceptMessage: no('duplicate', 'invalid'),
    acceptResponse: no('guard_failed', 'forbidden'),
    derived: no('illegal', 'invalid'),
    claimed: no('guard_failed', 'busy'),
  },
  respondedComplete: {
    sent: EXISTS,
    read: no('illegal', 'invalid'),
    respondText: no('illegal', 'invalid'),
    respondAnswer: no('illegal', 'invalid'),
    acceptMessage: no('duplicate', 'invalid'),
    acceptResponse: no('duplicate', 'invalid'),
    derived: no('illegal', 'invalid'),
    claimed: ok(S.respondedComplete, []),
  },
};

function expectResult(result: MessageTransition, expected: Expected): void {
  if (expected.ok) {
    expect(result).toEqual({ ok: true, next: expected.next, effects: expected.effects });
    return;
  }
  expect(result).toMatchObject({ ok: false, reason: expected.reason, code: expected.code });
  if (!result.ok) expect(result.detail.length).toBeGreaterThan(0);
}

function rejection(result: MessageTransition): { reason: TransitionRejectReason; code: CoreError; detail: string } {
  if (result.ok) throw new Error(`expected a rejection, got ${JSON.stringify(result)}`);
  return { reason: result.reason, code: result.code, detail: result.detail };
}

/** The message CAS revision an accepted write commits against (`null` = must not exist). */
function guardRevisionOf(result: MessageTransition): number | null {
  if (!result.ok) throw new Error(`expected an accepted write, got ${JSON.stringify(result)}`);
  const guard = result.effects.find((effect) => effect.kind === 'guard_message');
  if (guard === undefined || guard.kind !== 'guard_message') throw new Error('an accepted message write names its message CAS');
  return guard.expectedRevision;
}

// --------------------------------------------------------------------------
// Exhaustive (state, event) table
// --------------------------------------------------------------------------

describe('transitionMessage: every (state, event) pair', () => {
  it('covers every status and every event type', () => {
    expect(Object.keys(STATUS_COVERAGE).sort()).toEqual(['absent', 'pending', 'read', 'responded']);
    expect(Object.keys(EVENT_COVERAGE).sort()).toEqual(
      ['consultation_derived', 'input_accepted', 'message_read', 'message_responded', 'message_sent', 'task_claimed'],
    );
    expect(Object.keys(TABLE)).toEqual(STATE_NAMES);
    for (const name of STATE_NAMES) expect(Object.keys(TABLE[name])).toEqual(EVENT_NAMES);
  });

  for (const stateName of STATE_NAMES) {
    for (const eventName of EVENT_NAMES) {
      const expected = TABLE[stateName][eventName];
      const label = expected.ok ? 'legal' : `${expected.reason}/${expected.code}`;
      it(`${stateName} × ${eventName} → ${label}`, () => {
        const state = STATES[stateName];
        expectResult(transitionMessage(state, EVENTS[eventName], happyCtx(eventName, state)), expected);
      });
    }
  }

  it('MSG-02: a work_run send also joins the work_run admission guards', () => {
    const ctx = { ...happyCtx('sent', S.absent), principal: 'work_run' as const, workRunAuthorization: 'ok' as const };
    expectResult(transitionMessage(S.absent, EVENTS.sent, ctx), ok(
      { status: 'pending', hasReadAt: false, hasResponse: false, acceptedInputIds: [], hasDerivation: false, revision: 1 },
      [...SEND_HOST, { kind: 'guard_work_run_facts' }],
    ));
  });

  it('is pure: the input state and context are not mutated', () => {
    for (const stateName of STATE_NAMES) {
      for (const eventName of EVENT_NAMES) {
        const state = structuredClone(STATES[stateName]) as MessageMachineState;
        const ctx = happyCtx(eventName, state);
        const before = structuredClone({ state, ctx });
        transitionMessage(state, EVENTS[eventName], ctx);
        expect({ state, ctx }).toEqual(before);
      }
    }
  });
});

// --------------------------------------------------------------------------
// §10.4 forbidden transitions and guard precedence
// --------------------------------------------------------------------------

describe('§10.4 forbidden transitions', () => {
  const ORDER: Record<SessionMessageStatus, number> = { pending: 0, read: 1, responded: 2 };

  it('I-8: no event moves read/responded back (to pending, or responded to read)', () => {
    for (const stateName of PRESENT_STATE_NAMES) {
      const state = STATES[stateName];
      for (const eventName of EVENT_NAMES) {
        const result = transitionMessage(state, EVENTS[eventName], happyCtx(eventName, state));
        if (!result.ok || result.next.status === 'absent') continue;
        expect(ORDER[result.next.status]).toBeGreaterThanOrEqual(ORDER[state.status]);
      }
    }
  });

  it('input_accepted and consultation_derived never change status or readAt', () => {
    for (const stateName of PRESENT_STATE_NAMES) {
      const state = STATES[stateName];
      for (const eventName of ['acceptMessage', 'acceptResponse', 'derived'] as const) {
        const result = transitionMessage(state, EVENTS[eventName], happyCtx(eventName, state));
        if (!result.ok || result.next.status === 'absent') continue;
        expect(result.next.status).toBe(state.status);
        expect(result.next.hasReadAt).toBe(state.hasReadAt);
        expect(result.next.hasResponse).toBe(state.hasResponse);
      }
    }
  });

  it('a Host cannot ack or write a text reply in any state (forbidden)', () => {
    for (const stateName of STATE_NAMES) {
      const state = STATES[stateName];
      for (const eventName of ['read', 'respondText'] as const) {
        const ctx = { ...happyCtx(eventName, state), principal: 'host' as const, workRunAuthorization: null };
        expect(rejection(transitionMessage(state, EVENTS[eventName], ctx))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
        const other = { ...ctx, principal: 'other' as const };
        expect(rejection(transitionMessage(state, EVENTS[eventName], other))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
      }
    }
  });

  it('a work_run cannot associate a Query Answer (MSG-06) or record a derivation (MSG-09) in any state (forbidden)', () => {
    for (const stateName of STATE_NAMES) {
      const state = STATES[stateName];
      for (const eventName of ['respondAnswer', 'derived'] as const) {
        for (const principal of ['work_run', 'other'] as const) {
          const ctx = { ...happyCtx(eventName, state), principal, workRunAuthorization: 'ok' as const };
          expect(rejection(transitionMessage(state, EVENTS[eventName], ctx))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
        }
      }
    }
  });

  it('a caller Session that is not the recipient cannot ack or respond (forbidden; not_found when absent)', () => {
    for (const stateName of STATE_NAMES) {
      const state = STATES[stateName];
      for (const eventName of ['read', 'respondText'] as const) {
        for (const callerIsRecipient of [false, null]) {
          const ctx = { ...happyCtx(eventName, state), callerIsRecipient };
          const expected = stateName === 'absent' ? NOT_FOUND : no('guard_failed', 'forbidden');
          expectResult(transitionMessage(state, EVENTS[eventName], ctx), expected);
        }
      }
    }
  });

  it('a work_run whose Run/Session/Lease admission fails cannot send, ack or respond (the admission code is kept)', () => {
    const failures: CoreRejection[] = [
      { status: 'rejected', code: 'forbidden', reason: 'the Run is not running' },
      { status: 'rejected', code: 'forbidden', reason: 'the TaskLease has been released' },
      { status: 'rejected', code: 'unsupported', reason: 'a new work_run mailbox write requires the fresh Host admission dependency' },
      { status: 'rejected', code: 'unavailable', reason: 'the saved prepared manifest could not be read' },
    ];
    for (const stateName of STATE_NAMES) {
      const state = STATES[stateName];
      for (const eventName of ['sent', 'read', 'respondText'] as const) {
        for (const failure of failures) {
          const ctx = { ...happyCtx(eventName, state), principal: 'work_run' as const, workRunAuthorization: failure };
          expect(rejection(transitionMessage(state, EVENTS[eventName], ctx)))
            .toEqual({ reason: 'guard_failed', code: failure.code, detail: failure.reason });
        }
        const missing = { ...happyCtx(eventName, state), principal: 'work_run' as const, workRunAuthorization: null };
        expect(rejection(transitionMessage(state, EVENTS[eventName], missing))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
      }
    }
  });

  it('MSG-06: an unsettled, unanswered or mismatched Query Answer is refused with today\'s code and reason, even on a responded message', () => {
    for (const stateName of PRESENT_STATE_NAMES) {
      const state = STATES[stateName];
      const happy = happyCtx('respondAnswer', state);
      for (const refusal of ANSWER_REFUSALS) {
        const ctx = { ...happy, queryAnswer: { ...ANSWER_FACTS, ...refusal.facts } };
        expect(rejection(transitionMessage(state, EVENTS.respondAnswer, ctx)))
          .toEqual({ reason: 'guard_failed', code: refusal.code, detail: refusal.detail });
      }
      expect(rejection(transitionMessage(state, EVENTS.respondAnswer, { ...happy, queryAnswer: null })))
        .toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
      // An unbounded formal Answer body keeps today's `invalid`.
      for (const bodyBounded of [false, null]) {
        expect(rejection(transitionMessage(state, EVENTS.respondAnswer, { ...happy, bodyBounded })))
          .toMatchObject({ reason: 'guard_failed', code: 'invalid' });
        // The binding and Query facts are checked before the body bound.
        for (const refusal of ANSWER_REFUSALS) {
          const ctx = { ...happy, bodyBounded, queryAnswer: { ...ANSWER_FACTS, ...refusal.facts } };
          expect(rejection(transitionMessage(state, EVENTS.respondAnswer, ctx))).toMatchObject({ reason: 'guard_failed', code: refusal.code });
        }
        expect(rejection(transitionMessage(state, EVENTS.respondAnswer, { ...happy, bodyBounded, queryAnswer: null })))
          .toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
      }
    }
    // Absent: not_found comes first (`:1763-1764`).
    expectResult(transitionMessage(S.absent, EVENTS.respondAnswer, { ...happyCtx('respondAnswer', S.absent), queryAnswer: null }), NOT_FOUND);
  });

  it('MSG-06: the consultation checks keep respondFromQueryAnswer\'s order (first failing fact wins)', () => {
    // Every later fact fails too; the earlier one must still be the refusal.
    for (let index = 0; index < ANSWER_REFUSALS.length; index += 1) {
      const facts = { ...ANSWER_FACTS };
      for (const later of ANSWER_REFUSALS.slice(index + 1)) Object.assign(facts, later.facts);
      // `binding` is a single fact: later binding refusals do not override an earlier one.
      Object.assign(facts, ANSWER_REFUSALS[index]!.facts);
      const ctx = { ...happyCtx('respondAnswer', S.pending), queryAnswer: facts, bodyBounded: false };
      expect(rejection(transitionMessage(S.pending, EVENTS.respondAnswer, ctx)).detail).toBe(ANSWER_REFUSALS[index]!.detail);
    }
  });

  it('MSG-04: an oversized text reply is capacity, an empty one invalid, in every state (before the pin and the record)', () => {
    // `normalizeText` (`mailbox-service.ts:261-267`).
    for (const stateName of STATE_NAMES) {
      const state = STATES[stateName];
      const happy = happyCtx('respondText', state);
      expect(rejection(transitionMessage(state, EVENTS.respondText, { ...happy, bodyBounded: false })))
        .toMatchObject({ reason: 'guard_failed', code: 'capacity' });
      expect(rejection(transitionMessage(state, EVENTS.respondText, { ...happy, bodyBounded: null })))
        .toMatchObject({ reason: 'guard_failed', code: 'invalid' });
    }
  });

  it('ack/respond/derive without exactly one pin naming this message are illegal (invalid) in every state', () => {
    const badPins: MessageGuardContext['pins'][] = [
      { count: 0, matchesMessage: false, revision: null },
      { count: 2, matchesMessage: true, revision: 1 },
      { count: 1, matchesMessage: true, revision: null },
      { count: 1, matchesMessage: false, revision: 1 },
    ];
    for (const stateName of STATE_NAMES) {
      const state = STATES[stateName];
      for (const eventName of ['read', 'respondText', 'respondAnswer', 'derived'] as const) {
        for (const pins of badPins) {
          const ctx = { ...happyCtx(eventName, state), pins };
          expect(rejection(transitionMessage(state, EVENTS[eventName], ctx))).toMatchObject({ reason: 'illegal', code: 'invalid' });
        }
      }
    }
  });

  it('a stale pin is left to the commit CAS: the otherwise legal write guards the caller\'s pin, never the revision read', () => {
    // §10.4 "版本钉 ≠ 当前 revision" is the store CAS. Today nothing checks the pin
    // earlier, so the write keeps its body store, clock and commit planning and
    // the RecordStore refuses it (revision_conflict); the machine never answers stale.
    for (const stateName of STATE_NAMES) {
      const state = STATES[stateName];
      for (const eventName of ['read', 'respondText', 'respondAnswer', 'derived'] as const) {
        const expected = TABLE[stateName][eventName];
        const pinned = revisionOf(state) + 7;
        const ctx = { ...happyCtx(eventName, state), pins: { count: 1, matchesMessage: true, revision: pinned } };
        const result = transitionMessage(state, EVENTS[eventName], ctx);
        if (expected.ok) {
          expectResult(result, ok(expected.next, expected.effects.map((effect): MessageEffect => effect.kind === 'guard_message'
            ? { kind: 'guard_message', expectedRevision: pinned }
            : effect)));
          expect(guardRevisionOf(result)).not.toBe(revisionOf(state));
        } else {
          expectResult(result, expected); // status or slot rejections come before the CAS
        }
      }
    }
  });

  it('two reply writers: the loser that read before the winner committed meets the CAS, after it invalid', () => {
    // The winner moved pending@1 → responded@2; the loser still pins @1.
    const loserPin = { count: 1, matchesMessage: true, revision: 1 };
    const winner = transitionMessage(S.pending, EVENTS.respondText, happyCtx('respondText', S.pending));
    expect(winner.ok).toBe(true);
    // The loser read pending@1 before the winner committed: its write is planned with the
    // message CAS @1, which today's commit refuses against @2 (revision_conflict)...
    const loser = transitionMessage(S.pending, EVENTS.respondAnswer, { ...happyCtx('respondAnswer', S.pending), pins: loserPin });
    expect(guardRevisionOf(loser)).toBe(1);
    if (winner.ok) expect(revisionOf(winner.next)).toBe(2);
    // ...as does a loser whose pin is older than the pending/read revision it read.
    const readAt2 = { ...S.read, revision: 2 };
    expect(guardRevisionOf(transitionMessage(readAt2, EVENTS.respondAnswer, { ...happyCtx('respondAnswer', readAt2), pins: loserPin }))).toBe(1);
    // A loser that reads the responded message gets invalid; the winner's slot is never overwritten.
    if (!winner.ok) return;
    expectResult(transitionMessage(winner.next, EVENTS.respondAnswer, { ...happyCtx('respondAnswer', winner.next), pins: loserPin }), no('illegal', 'invalid'));
    expectResult(transitionMessage(winner.next, EVENTS.respondText, happyCtx('respondText', winner.next)), no('illegal', 'invalid'));
  });

  describe('message_sent', () => {
    const happy = happyCtx('sent', S.absent);
    const send = (ctx: MessageGuardContext) => transitionMessage(S.absent, EVENTS.sent, ctx);

    it('the send flag table: only waitAfterSend without needsReply is illegal', () => {
      for (const needsReply of [false, true]) {
        for (const waitAfterSend of [false, true]) {
          for (const replyMode of [null, 'wait'] as const) {
            const result = send({ ...happy, sendFlags: { needsReply, waitAfterSend, replyMode, pinCount: 0 } });
            if (waitAfterSend && !needsReply) expectResult(result, no('illegal', 'invalid'));
            else expectResult(result, TABLE.absent.sent);
          }
        }
      }
      expectResult(send({ ...happy, sendFlags: null }), no('illegal', 'invalid'));
    });

    it('a send carrying version pins is illegal (invalid)', () => {
      for (const pinCount of [1, 2]) {
        expectResult(send({ ...happy, sendFlags: { ...happy.sendFlags!, pinCount } }), no('illegal', 'invalid'));
      }
    });

    it('a sender principal other than host/work_run is unsupported', () => {
      expectResult(send({ ...happy, principal: 'other' }), no('illegal', 'unsupported'));
    });

    it('a recipient in another project is forbidden; outside the workspace or unresolved is not_found', () => {
      expectResult(send({ ...happy, recipientScope: 'other_project' }), no('guard_failed', 'forbidden'));
      expectResult(send({ ...happy, recipientScope: 'other_workspace' }), no('guard_failed', 'not_found'));
      expectResult(send({ ...happy, recipientScope: null }), no('guard_failed', 'not_found'));
      // Today's reasons: the workspace check, and `mapReadResult` of the missing Session.
      expect(rejection(send({ ...happy, recipientScope: 'other_workspace' })).detail).toBe('the recipient Session is outside the bound workspace');
      expect(rejection(send({ ...happy, recipientScope: null })).detail).toBe('the requested record does not exist');
    });

    it('precedence follows sendMessage: project → flags → pins → principal → admission → workspace → existing record', () => {
      const badFlags = { needsReply: false, waitAfterSend: true, replyMode: null, pinCount: 2 };
      expect(rejection(send({ ...happy, recipientScope: 'other_project', sendFlags: badFlags })).code).toBe('forbidden');
      expect(rejection(send({ ...happy, sendFlags: badFlags })).detail).toContain('waitAfterSend');
      expect(rejection(send({ ...happy, principal: 'other', sendFlags: { ...happy.sendFlags!, pinCount: 1 } })).code).toBe('invalid');
      const denied: CoreRejection = { status: 'rejected', code: 'forbidden', reason: 'the Run is not running' };
      expect(rejection(send({ ...happy, principal: 'work_run', workRunAuthorization: denied, recipientScope: 'other_workspace' })).detail)
        .toBe('the Run is not running');
      expect(rejection(transitionMessage(S.read, EVENTS.sent, { ...happy, recipientScope: 'other_workspace' })).code).toBe('not_found');
    });
  });

  describe('input_accepted', () => {
    const part = ['acceptMessage', 'acceptResponse'] as const;

    it('only the observing Host or the executing Run may confirm (forbidden for other principals, in every state)', () => {
      for (const stateName of STATE_NAMES) {
        for (const eventName of part) {
          const state = STATES[stateName];
          const ctx = { ...happyCtx(eventName, state), principal: 'other' as const };
          expect(rejection(transitionMessage(state, EVENTS[eventName], ctx))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
        }
      }
    });

    it('a work_run confirming another execution is forbidden, in every state; work_run confirming its own is legal', () => {
      for (const stateName of STATE_NAMES) {
        for (const eventName of part) {
          const state = STATES[stateName];
          const happy = happyCtx(eventName, state);
          const ctx = { ...happy, principal: 'work_run' as const, inputAccepted: { ...happy.inputAccepted!, observerOwnsExecution: false } };
          expect(rejection(transitionMessage(state, EVENTS[eventName], ctx))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
          expectResult(transitionMessage(state, EVENTS[eventName], { ...happy, principal: 'work_run' }), TABLE[stateName][eventName]);
        }
      }
      expect(rejection(transitionMessage(S.pending, EVENTS.acceptMessage, { ...happyCtx('acceptMessage', S.pending), inputAccepted: null })))
        .toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
    });

    it('a Kernel identity, claimed Session or execution Session mismatch is forbidden (present states)', () => {
      for (const stateName of PRESENT_STATE_NAMES) {
        for (const eventName of part) {
          const state = STATES[stateName];
          const happy = happyCtx(eventName, state);
          for (const flag of ['kernelMatches', 'claimedSessionMatches', 'executionSessionMatches'] as const) {
            const ctx = { ...happy, inputAccepted: { ...happy.inputAccepted!, [flag]: false } };
            expect(rejection(transitionMessage(state, EVENTS[eventName], ctx))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
          }
        }
      }
    });

    it('recordInputAccepted order and reasons: Kernel → claimed Session → executing Session → inputId', () => {
      const happy = happyCtx('acceptMessage', S.pending);
      const facts = happy.inputAccepted!;
      const refuse = (overrides: Partial<typeof facts>) =>
        rejection(transitionMessage(S.pending, EVENTS.acceptMessage, { ...happy, inputAccepted: { ...facts, ...overrides } })).detail;
      const allBad = { kernelMatches: false, claimedSessionMatches: false, executionSessionMatches: false, inputIdTakenByOtherEvent: true };
      expect(refuse(allBad)).toBe('accepted input does not match the persisted execution Kernel identity');
      expect(refuse({ ...allBad, kernelMatches: true })).toBe('claimed acceptance Session differs from the execution');
      expect(refuse({ ...allBad, kernelMatches: true, claimedSessionMatches: true }))
        .toBe('the accepted message is not addressed to the executing Session');
      expect(refuse({ inputIdTakenByOtherEvent: true })).toBe('this source input was accepted by another execution event');
      // This event's own entry without its receipt keeps today's single uniqueness reason.
      expect(rejection(transitionMessage(S.pendingDerivedDelivered, EVENTS.acceptMessage, happyCtx('acceptMessage', S.pendingDerivedDelivered))))
        .toEqual({ reason: 'duplicate', code: 'invalid', detail: 'this source input was accepted by another execution event' });
    });

    it('an absent message is not_found before the execution facts are read (null facts)', () => {
      for (const eventName of part) {
        expectResult(transitionMessage(S.absent, EVENTS[eventName], { ...happyCtx(eventName, S.absent), inputAccepted: null }), NOT_FOUND);
      }
    });

    it('an inputId already recorded by another execution event is guard_failed/invalid (present states)', () => {
      for (const stateName of PRESENT_STATE_NAMES) {
        const state = STATES[stateName];
        const happy = happyCtx('acceptMessage', state);
        const ctx = { ...happy, inputAccepted: { ...happy.inputAccepted!, inputIdTakenByOtherEvent: true } };
        expectResult(transitionMessage(state, EVENTS.acceptMessage, ctx), no('guard_failed', 'invalid'));
      }
    });

    it('the Kernel identity and execution Session checks (:2023-2036) come before the inputId uniqueness check (:2037-2042)', () => {
      for (const stateName of PRESENT_STATE_NAMES) {
        for (const eventName of part) {
          const state = STATES[stateName];
          const happy = happyCtx(eventName, state);
          for (const flag of ['kernelMatches', 'claimedSessionMatches', 'executionSessionMatches'] as const) {
            const ctx = { ...happy, inputAccepted: { ...happy.inputAccepted!, [flag]: false, inputIdTakenByOtherEvent: true } };
            expect(rejection(transitionMessage(state, EVENTS[eventName], ctx))).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
          }
        }
      }
    });

    it('a response part needs the written response slot (MSG-08; forbidden before responded)', () => {
      for (const stateName of PRESENT_STATE_NAMES) {
        const state = STATES[stateName];
        const result = transitionMessage(state, EVENTS.acceptResponse, happyCtx('acceptResponse', state));
        if (state.hasResponse) expect(result.ok || rejection(result).reason === 'duplicate').toBe(true);
        else expect(rejection(result)).toMatchObject({ reason: 'guard_failed', code: 'forbidden' });
      }
    });

    it('a replayed observation (restart reconcile) never appends a second entry', () => {
      const first = transitionMessage(S.read, EVENTS.acceptMessage, happyCtx('acceptMessage', S.read));
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expectResult(transitionMessage(first.next, EVENTS.acceptMessage, happyCtx('acceptMessage', first.next)), no('duplicate', 'invalid'));
    });
  });

  describe('task_claimed (MSG-10)', () => {
    it('only a responded message whose saved reply is the claimed responseRef, in the workspace, satisfies the wait', () => {
      for (const stateName of STATE_NAMES) {
        const state = STATES[stateName];
        const verdict = messageSatisfiesWait(state, { responseRefMatches: true, sameWorkspace: true });
        expect(verdict.satisfied).toBe(state.status === 'responded');
        if (!verdict.satisfied) expect(verdict.code).toBe('busy');
      }
      expect(messageSatisfiesWait(S.responded, { responseRefMatches: false, sameWorkspace: true }))
        .toMatchObject({ satisfied: false, code: 'forbidden' });
      expect(messageSatisfiesWait(S.responded, { responseRefMatches: true, sameWorkspace: false }))
        .toMatchObject({ satisfied: false, code: 'forbidden' });
      // read state or delivery-only never satisfies the wait, whatever the other facts say.
      expect(messageSatisfiesWait(S.pendingDerivedDelivered, { responseRefMatches: true, sameWorkspace: true }))
        .toMatchObject({ satisfied: false, code: 'busy' });
    });

    it('maps the predicate to guard_failed with the same code; missing facts are invalid', () => {
      const claim = (state: MessageMachineState, consumedWait: MessageGuardContext['consumedWait']) =>
        transitionMessage(state, EVENTS.claimed, { ...baseCtx(), consumedWait });
      expectResult(claim(S.responded, { responseRefMatches: false, sameWorkspace: true }), no('guard_failed', 'forbidden'));
      expectResult(claim(S.respondedComplete, { responseRefMatches: true, sameWorkspace: false }), no('guard_failed', 'forbidden'));
      expectResult(claim(S.read, { responseRefMatches: false, sameWorkspace: false }), no('guard_failed', 'busy'));
      expectResult(claim(S.absent, { responseRefMatches: true, sameWorkspace: true }), no('guard_failed', 'busy'));
      expectResult(claim(S.responded, null), no('guard_failed', 'invalid'));
    });
  });

  it('precedence of ack/respond: principal → body → pins → admission → record → recipient → status → CAS', () => {
    const badPins = { count: 0, matchesMessage: false, revision: null };
    const denied: CoreRejection = { status: 'rejected', code: 'forbidden', reason: 'the Run is not running' };
    expect(rejection(transitionMessage(S.pending, EVENTS.read, { ...happyCtx('read', S.pending), principal: 'host', pins: badPins })).code).toBe('forbidden');
    expect(rejection(transitionMessage(S.pending, EVENTS.read, { ...happyCtx('read', S.pending), pins: badPins, workRunAuthorization: denied })).code).toBe('invalid');
    expect(rejection(transitionMessage(S.absent, EVENTS.read, { ...happyCtx('read', S.absent), workRunAuthorization: denied })).detail).toBe('the Run is not running');
    expect(rejection(transitionMessage(S.pending, EVENTS.respondText, { ...happyCtx('respondText', S.pending), bodyBounded: false, pins: badPins })).code)
      .toBe('capacity');
    expect(rejection(transitionMessage(S.responded, EVENTS.read, { ...happyCtx('read', S.responded), callerIsRecipient: false })).code).toBe('forbidden');
    const stale = { count: 1, matchesMessage: true, revision: 1 };
    expect(rejection(transitionMessage(S.read, EVENTS.read, { ...happyCtx('read', S.read), pins: stale })).code).toBe('invalid');
    expect(rejection(transitionMessage(S.pendingDerivedDelivered, EVENTS.derived, { ...happyCtx('derived', S.pendingDerivedDelivered), pins: stale })).code)
      .toBe('invalid');
  });
});

describe('request guards the service asks before its receipt lookup', () => {
  it('messagePinProblem is the pin check of ack, respond, MSG-06 and MSG-09, with today\'s reasons', () => {
    const cases: ReadonlyArray<{ pins: MessageGuardContext['pins']; detail: string | null }> = [
      { pins: { count: 0, matchesMessage: false, revision: null }, detail: 'ack/respond require exactly one SessionMessage version pin' },
      { pins: { count: 2, matchesMessage: true, revision: 1 }, detail: 'ack/respond require exactly one SessionMessage version pin' },
      { pins: { count: 1, matchesMessage: false, revision: null }, detail: 'the SessionMessage pin revision must be a positive integer' },
      { pins: { count: 1, matchesMessage: false, revision: 1 }, detail: 'the version pin does not name the requested message' },
      { pins: { count: 1, matchesMessage: true, revision: 1 }, detail: null },
    ];
    for (const { pins, detail } of cases) {
      const guard = messagePinProblem(pins);
      if (detail === null) {
        expect(guard).toBeNull();
        continue;
      }
      expect(guard).toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail });
      for (const stateName of STATE_NAMES) {
        for (const eventName of ['read', 'respondText', 'respondAnswer', 'derived'] as const) {
          const state = STATES[stateName];
          expect(transitionMessage(state, EVENTS[eventName], { ...happyCtx(eventName, state), pins })).toEqual(guard);
        }
      }
    }
  });

  it('messageSendFlagsProblem is MSG-01/02\'s flag check, then its pin check', () => {
    const happy = happyCtx('sent', S.absent);
    const flags = happy.sendFlags!;
    const cases: ReadonlyArray<{ flags: typeof flags; detail: string | null }> = [
      { flags: { ...flags, waitAfterSend: true, needsReply: false, pinCount: 1 }, detail: 'waitAfterSend requires needsReply to be true or omitted' },
      { flags: { ...flags, pinCount: 1 }, detail: 'sendSessionMessage must not carry version pins' },
      { flags: { ...flags, waitAfterSend: true, needsReply: true, replyMode: 'wait' }, detail: null },
      { flags, detail: null },
    ];
    for (const { flags: sendFlags, detail } of cases) {
      const guard = messageSendFlagsProblem(sendFlags);
      if (detail === null) {
        expect(guard).toBeNull();
        expectResult(transitionMessage(S.absent, EVENTS.sent, { ...happy, sendFlags }), TABLE.absent.sent);
        continue;
      }
      expect(guard).toEqual({ ok: false, reason: 'illegal', code: 'invalid', detail });
      expect(transitionMessage(S.absent, EVENTS.sent, { ...happy, sendFlags })).toEqual(guard);
    }
  });

  it('inputObserverProblem is MSG-07/08\'s check that a work_run confirms only its own execution', () => {
    expect(inputObserverProblem(true)).toBeNull();
    const guard = inputObserverProblem(false);
    expect(guard).toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'an execution may only confirm its own accepted inputs' });
    for (const stateName of PRESENT_STATE_NAMES) {
      for (const eventName of ['acceptMessage', 'acceptResponse'] as const) {
        const state = STATES[stateName];
        const happy = happyCtx(eventName, state);
        const ctx = { ...happy, principal: 'work_run' as const, inputAccepted: { ...happy.inputAccepted!, observerOwnsExecution: false } };
        expect(transitionMessage(state, EVENTS[eventName], ctx)).toEqual(guard);
      }
    }
  });

  it('messagePrincipalProblem is the first guard of ack, respond, MSG-06 and MSG-09, with today\'s reasons', () => {
    type Principal = MessageGuardContext['principal'];
    const cases: ReadonlyArray<{
      eventName: 'read' | 'respondText' | 'respondAnswer' | 'derived'; admitted: Principal; refused: ReadonlyArray<[Principal, string]>;
    }> = [
      { eventName: 'read', admitted: 'work_run', refused: [
        ['host', 'a Host cannot acknowledge a message'], ['other', 'only a work_run may acknowledge a message']] },
      { eventName: 'respondText', admitted: 'work_run', refused: [
        ['host', 'a Host cannot respond to a message'], ['other', 'only a work_run may respond to a message']] },
      { eventName: 'respondAnswer', admitted: 'host', refused: [
        ['work_run', 'only the Host may associate an official Query answer with a message'],
        ['other', 'only the Host may associate an official Query answer with a message']] },
      { eventName: 'derived', admitted: 'host', refused: [
        ['work_run', 'only the Host may record a consultation derivation'], ['other', 'only the Host may record a consultation derivation']] },
    ];
    for (const { eventName, admitted, refused } of cases) {
      expect(messagePrincipalProblem(EVENTS[eventName], admitted)).toBeNull();
      for (const [principal, detail] of refused) {
        const guard = messagePrincipalProblem(EVENTS[eventName], principal);
        expect(guard).toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail });
        // The row asks it first: the later facts failing too never change the refusal.
        for (const stateName of STATE_NAMES) {
          const state = STATES[stateName];
          const ctx = { ...happyCtx(eventName, state), principal, pins: { count: 0, matchesMessage: false, revision: null }, bodyBounded: null };
          expect(transitionMessage(state, EVENTS[eventName], ctx)).toEqual(guard);
        }
      }
    }
  });

  it('messageRecipientProjectProblem is MSG-01/02\'s first check', () => {
    expect(messageRecipientProjectProblem(true)).toBeNull();
    const guard = messageRecipientProjectProblem(false);
    expect(guard).toEqual({ ok: false, reason: 'guard_failed', code: 'forbidden', detail: 'the recipient Session belongs to another project' });
    // It runs before the flags and the principal: those failing too never change the refusal.
    for (const stateName of STATE_NAMES) {
      for (const principal of ['host', 'work_run', 'other'] as const) {
        const ctx = { ...happyCtx('sent', STATES[stateName]), principal, recipientScope: 'other_project' as const, sendFlags: null };
        expect(transitionMessage(STATES[stateName], EVENTS.sent, ctx)).toEqual(guard);
      }
    }
  });
});

// --------------------------------------------------------------------------
// Record constructors
// --------------------------------------------------------------------------

function newInput(overrides: Partial<NewSessionMessageInput> = {}): NewSessionMessageInput {
  return {
    ref: MESSAGE_REF, sender: HOST_SENDER, recipient: RECIPIENT, bodyRef: BODY, sourceRef: BODY.source, createdAt: '2026-10-04T00:00:00.000Z',
    replyMode: null, intent: null, needsReply: false, waitAfterSend: false, ...overrides,
  };
}

function textReply(respondedAt: string): MessageResponseRecord {
  return { sender: RESPONDER, bodyRef: REPLY_BODY, sourceRef: REPLY_BODY.source, respondedAt };
}

function answerReply(respondedAt: string): MessageResponseRecord {
  return { sender: ANSWER_SENDER, bodyRef: ANSWER_BODY, sourceRef: ANSWER_BODY.source, respondedAt };
}

function accepted(part: 'message' | 'response', acceptedAt: string): MessageAcceptedInput {
  return {
    inputId: part === 'message' ? MESSAGE_INPUT : RESPONSE_INPUT, part,
    executionRef: part === 'message' ? RESPONDER.runRef : WORK_RUN_SENDER.runRef, kernel: { ...KERNEL }, acceptedAt,
  };
}

const DERIVATION = {
  childSessionRef: { projectId: PROJECT, sessionId: 's-child' }, sourceSessionRef: RECIPIENT,
  sourceKernel: { adapterId: 'fake', kernelSessionId: 'ks-recipient' }, throughPosition: null,
};

function codecProblem(record: SessionMessageRecord): string | null {
  return checkSessionMessageBody(record as unknown as Record<string, unknown>);
}

describe('record constructors', () => {
  it('SessionMessageRecord is exactly the mailbox SessionMessage type', () => {
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    const same: Equal<SessionMessageRecord, SessionMessage> = true;
    expect(same).toBe(true);
  });

  it('createSessionMessageRecord writes pending@1 in the historical field order, optional fields only when present', () => {
    const plain = createSessionMessageRecord(newInput());
    expect(plain).toEqual({
      ref: MESSAGE_REF, schemaVersion: 1, revision: 1, sender: HOST_SENDER, recipient: RECIPIENT, bodyRef: BODY, sourceRef: SOURCE,
      createdAt: '2026-10-04T00:00:00.000Z', status: 'pending', readAt: null, response: null,
    });
    expect(Object.keys(plain)).toEqual(
      ['ref', 'schemaVersion', 'revision', 'sender', 'recipient', 'bodyRef', 'sourceRef', 'createdAt', 'status', 'readAt', 'response'],
    );
    expect(codecProblem(plain)).toBeNull();
    expect(messageMachineStateOf(plain)).toEqual(TABLE.absent.sent.ok ? TABLE.absent.sent.next : null);

    const waiting = createSessionMessageRecord(newInput({
      sender: WORK_RUN_SENDER, replyMode: 'wait', intent: 'inquiry', needsReply: true, waitAfterSend: true,
    }));
    expect(Object.keys(waiting).slice(11)).toEqual(['replyMode', 'intent', 'needsReply', 'waitAfterSend']);
    expect(waiting).toMatchObject({ replyMode: 'wait', intent: 'inquiry', needsReply: true, waitAfterSend: true });
    expect(codecProblem(waiting)).toBeNull();

    // needsReply=false / waitAfterSend=false are omitted, not written as false.
    const notify = createSessionMessageRecord(newInput({ intent: 'notify' }));
    expect('needsReply' in notify || 'waitAfterSend' in notify || 'replyMode' in notify).toBe(false);
    expect(() => createSessionMessageRecord(newInput({ waitAfterSend: true }))).toThrow(/needsReply/);
  });

  it('read (MSG-03): pending → read with readAt, revision +1; only from pending', () => {
    const sent = createSessionMessageRecord(newInput());
    const read = nextSessionMessageRecord(sent, { kind: 'read', readAt: 'T-read' });
    expect(read).toEqual({ ...sent, revision: 2, status: 'read', readAt: 'T-read' });
    expect(Object.keys(read)).toEqual(Object.keys(sent));
    expect(codecProblem(read)).toBeNull();
    expect(() => nextSessionMessageRecord(read, { kind: 'read', readAt: 'T-again' })).toThrow();
    const responded = nextSessionMessageRecord(read, { kind: 'responded', response: textReply('T-reply') });
    expect(() => nextSessionMessageRecord(responded, { kind: 'read', readAt: 'T-late' })).toThrow();
  });

  it('responded (MSG-04/05/06): one slot; readAt ??= respondedAt (I-8)', () => {
    const sent = createSessionMessageRecord(newInput({ sender: WORK_RUN_SENDER, needsReply: true }));
    const direct = nextSessionMessageRecord(sent, { kind: 'responded', response: textReply('T-reply') });
    expect(direct).toMatchObject({ revision: 2, status: 'responded', readAt: 'T-reply', response: textReply('T-reply') });
    expect(codecProblem(direct)).toBeNull();

    const read = nextSessionMessageRecord(sent, { kind: 'read', readAt: 'T-read' });
    const answered = nextSessionMessageRecord(read, { kind: 'responded', response: answerReply('T-answer') });
    expect(answered).toMatchObject({ revision: 3, status: 'responded', readAt: 'T-read', response: answerReply('T-answer') });
    expect(Object.keys(answered.response!)).toEqual(['sender', 'bodyRef', 'sourceRef', 'respondedAt']);
    expect(codecProblem(answered)).toBeNull();

    expect(() => nextSessionMessageRecord(answered, { kind: 'responded', response: textReply('T-late') })).toThrow(/slot/);
  });

  it('input_accepted (MSG-07/08): append only, status and readAt untouched; response part needs a response; no duplicate inputId', () => {
    const sent = createSessionMessageRecord(newInput({ sender: WORK_RUN_SENDER, needsReply: true }));
    const delivered = nextSessionMessageRecord(sent, { kind: 'input_accepted', input: accepted('message', 'T-1') });
    expect(delivered).toEqual({ ...sent, revision: 2, acceptedInputs: [accepted('message', 'T-1')] });
    expect(codecProblem(delivered)).toBeNull();
    expect(() => nextSessionMessageRecord(delivered, { kind: 'input_accepted', input: accepted('message', 'T-2') })).toThrow(/already/);
    expect(() => nextSessionMessageRecord(delivered, { kind: 'input_accepted', input: accepted('response', 'T-2') })).toThrow(/response/);

    const responded = nextSessionMessageRecord(delivered, { kind: 'responded', response: textReply('T-reply') });
    const consumed = nextSessionMessageRecord(responded, { kind: 'input_accepted', input: accepted('response', 'T-3') });
    expect(consumed).toMatchObject({ revision: 4, status: 'responded', readAt: 'T-reply', response: textReply('T-reply') });
    expect(consumed.acceptedInputs).toEqual([accepted('message', 'T-1'), accepted('response', 'T-3')]);
    expect(codecProblem(consumed)).toBeNull();
    // The appended entry is a copy, not the caller's object.
    const input = accepted('message', 'T-9');
    const copy = nextSessionMessageRecord(sent, { kind: 'input_accepted', input });
    input.kernel.position = 99;
    expect(copy.acceptedInputs![0]!.kernel.position).toBe(KERNEL.position);
  });

  it('consultation_derived (MSG-09): written once', () => {
    const sent = createSessionMessageRecord(newInput({ sender: WORK_RUN_SENDER, intent: 'inquiry', needsReply: true }));
    const derived = nextSessionMessageRecord(sent, { kind: 'consultation_derived', derivation: DERIVATION });
    expect(derived).toEqual({ ...sent, revision: 2, consultationDerivation: DERIVATION });
    expect(codecProblem(derived)).toBeNull();
    expect(() => nextSessionMessageRecord(derived, { kind: 'consultation_derived', derivation: { ...DERIVATION, throughPosition: 4 } }))
      .toThrow(/derivation/);
  });

  it('messageMachineStateOf projects a record (null is absent)', () => {
    expect(messageMachineStateOf(null)).toEqual({ status: 'absent' });
    const sent = createSessionMessageRecord(newInput({ sender: WORK_RUN_SENDER, needsReply: true }));
    const delivered = nextSessionMessageRecord(sent, { kind: 'input_accepted', input: accepted('message', 'T-1') });
    const derived = nextSessionMessageRecord(delivered, { kind: 'consultation_derived', derivation: DERIVATION });
    expect(messageMachineStateOf(derived)).toEqual(S.pendingDerivedDelivered);
  });
});

// --------------------------------------------------------------------------
// I-8 property: random event sequences through machine + constructors
// --------------------------------------------------------------------------

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Apply an accepted transition to the record exactly as the owner service will in step 3. */
function applyToRecord(record: SessionMessageRecord | null, event: EventName, at: string): SessionMessageRecord {
  switch (event) {
    case 'sent':
      return createSessionMessageRecord(newInput({ sender: WORK_RUN_SENDER, needsReply: true, waitAfterSend: true, createdAt: at }));
    case 'read':
      return nextSessionMessageRecord(record!, { kind: 'read', readAt: at });
    case 'respondText':
      return nextSessionMessageRecord(record!, { kind: 'responded', response: textReply(at) });
    case 'respondAnswer':
      return nextSessionMessageRecord(record!, { kind: 'responded', response: answerReply(at) });
    case 'acceptMessage':
      return nextSessionMessageRecord(record!, { kind: 'input_accepted', input: accepted('message', at) });
    case 'acceptResponse':
      return nextSessionMessageRecord(record!, { kind: 'input_accepted', input: accepted('response', at) });
    case 'derived':
      return nextSessionMessageRecord(record!, { kind: 'consultation_derived', derivation: DERIVATION });
    case 'claimed':
      return record!;
  }
}

describe('I-8: status monotone, reply complete, appends only (property)', () => {
  const ORDER: Record<SessionMessageStatus, number> = { pending: 0, read: 1, responded: 2 };
  /** The events whose message CAS is the caller's version pin. */
  const PINNED_EVENTS: ReadonlySet<EventName> = new Set(['read', 'respondText', 'respondAnswer', 'derived']);

  it('holds for 300 seeded random sequences, and the constructors agree with the machine state', () => {
    const random = prng(0x5e55_1009);
    let legalSteps = 0;
    for (let sequence = 0; sequence < 300; sequence += 1) {
      let record: SessionMessageRecord | null = null;
      for (let step = 0; step < 14; step += 1) {
        const eventName: EventName = record === null && random() < 0.7
          ? 'sent'
          : EVENT_NAMES[Math.floor(random() * EVENT_NAMES.length)]!;
        const state = messageMachineStateOf(record);
        const ctx = happyCtx(eventName, state);
        const stalePin = random() < 0.15 && PINNED_EVENTS.has(eventName);
        if (stalePin) ctx.pins = { count: 1, matchesMessage: true, revision: revisionOf(state) + 1 };
        const result = transitionMessage(state, EVENTS[eventName], ctx);
        if (!result.ok) {
          expect(['illegal', 'guard_failed', 'duplicate']).toContain(result.reason);
          continue;
        }
        if (stalePin) {
          // The commit's message CAS on the stale pin refuses the write; the record is unchanged.
          expect(guardRevisionOf(result)).toBe(revisionOf(state) + 1);
          continue;
        }
        const previous = record;
        record = applyToRecord(record, eventName, `T-${sequence}-${step}`);
        legalSteps += 1;
        expect(messageMachineStateOf(record)).toEqual(result.next);
        expect(codecProblem(record)).toBeNull();
        // Triple consistency, including responded ⇒ readAt ≠ null.
        if (record.status === 'pending') expect([record.readAt, record.response]).toEqual([null, null]);
        if (record.status === 'read') expect(record.readAt !== null && record.response === null).toBe(true);
        if (record.status === 'responded') expect(record.readAt !== null && record.response !== null).toBe(true);
        if (previous === null) continue;
        expect(ORDER[record.status]).toBeGreaterThanOrEqual(ORDER[previous.status]);
        expect(record.revision - previous.revision).toBe(eventName === 'claimed' ? 0 : 1);
        if (previous.response !== null) expect(record.response).toEqual(previous.response);
        if (previous.readAt !== null) expect(record.readAt).toBe(previous.readAt);
        const before = previous.acceptedInputs ?? [];
        expect((record.acceptedInputs ?? []).slice(0, before.length)).toEqual(before);
        if (previous.consultationDerivation !== undefined) expect(record.consultationDerivation).toEqual(previous.consultationDerivation);
      }
    }
    expect(legalSteps).toBeGreaterThan(1000);
  });
});
