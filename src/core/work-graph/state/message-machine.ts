/**
 * SessionMessage state machine (docs/refactor/STATE-MACHINES-SPEC.md §10,
 * rows MSG-01..MSG-10; forbidden transitions §10.4; invariant I-8 §11.8).
 *
 * A message is a received statement, not a task obligation: receiving never
 * wakes, preempts or creates a dependency (`communication/contracts.ts:6-11`).
 * Its status is only `pending < read < responded` and never moves back.
 * "Delivered into an execution" (`acceptedInputs`), the fixed A′ derivation
 * and "the wait is satisfied" (MSG-10) are other facts, never extra statuses.
 *
 * Pure: the owner service (`communication/mailbox-service.ts`) looks up the
 * receipt first, reads the message, resolves the work_run admission, the
 * recipient scope and the Query/Kernel facts into `MessageGuardContext`, calls
 * `transitionMessage`, then builds the record with `createSessionMessageRecord`
 * / `nextSessionMessageRecord` and translates the effects into ONE RecordStore
 * commit. The checks run in today's service order, so the first failing guard
 * returns today's CoreError (§1.2).
 *
 * Two kinds of rejection depend on the RecordStore as well as on the state, so the
 * service keeps today's receipt handling around them (§1.2):
 * - `stale` stands for today's commit CAS failure (`commitMessage`,
 *   `mailbox-service.ts:1017-1019`). The service does not return it verbatim:
 *   it first re-checks the receipt of the same identity (`recheckAfterMiss`,
 *   `:979-989`) and replays it on a hit; on a miss it returns
 *   `revision_conflict` with `current` naming the message at the revision it
 *   read, as `mapStoreFailure` reports the failed message guard (`:121-131`).
 * - The `illegal`/`invalid` rejections of an already read, responded or
 *   derived message are likewise preceded by `recheckAfterMiss` (`:1598-1604`,
 *   `:1670-1674`, `:1841-1843`, `:1918-1920`), so a concurrent request of the
 *   same identity replays its original receipt instead of being rejected.
 *
 * `SessionMessage` is declared in `communication/contracts.ts:95`, which this
 * directory may not import (§14.4). `SessionMessageRecord` below is the same
 * shape built from `src/contracts` types only; tests/state/message-machine.test.ts
 * asserts the two types are identical.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection } from '../../../contracts/core/results.js';
import type { SessionMessageIntentV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1 } from '../../../contracts/dispatch.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import { accept, reject, unreachable, type Transition } from './transition.js';

// --------------------------------------------------------------------------
// Persisted record (structurally identical to communication/contracts.ts:36-145)
// --------------------------------------------------------------------------

/** Trusted Host sender (`contracts.ts:36-39`). */
export type MessageHostSenderRecord = {
  kind: 'host';
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

/** Formal work_run sender (`contracts.ts:46-52`). */
export type MessageWorkRunSenderRecord = {
  kind: 'work_run';
  sessionRef: SessionRef;
  runRef: RunRef;
  roleBinding: RoleBindingRefV1;
  generation: number;
};

/** Derived formal Query Answer sender; only the response slot accepts it (`contracts.ts:67-73`). */
export type MessageQueryAnswerSenderRecord = {
  kind: 'query_run';
  sessionRef: SessionRef;
  queryRunRef: QueryRunRef;
  answerRef: QueryJobAnswerRef;
  generation: number;
};

/** The single response slot (`contracts.ts:81-86`); written once. */
export type MessageResponseRecord = {
  sender: MessageWorkRunSenderRecord | MessageQueryAnswerSenderRecord;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  respondedAt: string;
};

export type SessionMessageStatus = 'pending' | 'read' | 'responded';

/** One committed Kernel `run.input_accepted` observation (`contracts.ts:132-138`); append-only. */
export type MessageAcceptedInput = {
  inputId: string;
  part: 'message' | 'response';
  executionRef: RunRef | QueryRunRef;
  kernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string; position: number };
  acceptedAt: string;
};

/** The fixed A′ derivation (`contracts.ts:139-144`); the first writer wins. */
export type MessageConsultationDerivation = {
  childSessionRef: SessionRef;
  sourceSessionRef: SessionRef;
  sourceKernel: { adapterId: string; kernelSessionId: string };
  throughPosition: number | null;
};

/** `SessionMessage` (`contracts.ts:95-145`). */
export type SessionMessageRecord = {
  ref: SessionMessageRef;
  schemaVersion: 1;
  revision: number;
  sender: MessageHostSenderRecord | MessageWorkRunSenderRecord;
  recipient: SessionRef;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  createdAt: string;
  status: SessionMessageStatus;
  readAt: string | null;
  response: MessageResponseRecord | null;
  replyMode?: 'wait';
  intent?: SessionMessageIntentV1;
  needsReply?: boolean;
  waitAfterSend?: boolean;
  acceptedInputs?: MessageAcceptedInput[];
  consultationDerivation?: MessageConsultationDerivation;
};

// --------------------------------------------------------------------------
// Machine state, events, guard context, effects (§10.1, §10.2)
// --------------------------------------------------------------------------

/** `absent | {status, hasReadAt, hasResponse, acceptedInputIds, hasDerivation, revision}` (§10.1). */
export type MessageMachineState =
  | { status: 'absent' }
  | {
    status: SessionMessageStatus;
    hasReadAt: boolean;
    hasResponse: boolean;
    acceptedInputIds: readonly string[];
    hasDerivation: boolean;
    revision: number;
  };

type PresentMessageState = Exclude<MessageMachineState, { status: 'absent' }>;

/**
 * §10.2. `message_responded.via`: `text` is the work_run reply (MSG-04/05),
 * `query_answer` the Host association of a formal Query Answer (MSG-06).
 * `input_accepted.inputId` is `deriveSessionInputId(messageRef, part)`
 * (`contracts.ts:57-59`), computed by the service. `task_claimed` is the
 * read-only continuation-claim check (MSG-10).
 */
export type MessageEvent =
  | { type: 'message_sent' }
  | { type: 'message_read' }
  | { type: 'message_responded'; via: 'text' | 'query_answer' }
  | { type: 'input_accepted'; part: 'message' | 'response'; inputId: string }
  | { type: 'consultation_derived' }
  | { type: 'task_claimed' };

/** §10.1. IO stays in the service; it fills in what it read and authorized. */
export type MessageGuardContext = {
  principal: 'host' | 'work_run' | 'other';
  /** `authorizeNewWorkRunAction` (`mailbox-service.ts:615-741`); `null` for a Host call. */
  workRunAuthorization: 'ok' | CoreRejection | null;
  /** ack/respond: the caller Session is the recipient. */
  callerIsRecipient: boolean | null;
  /** message_sent only. */
  recipientScope: 'same_workspace' | 'other_workspace' | 'other_project' | null;
  /** message_sent only: the normalized flags (`mailbox-service.ts:1072-1074`) and the pin count. */
  sendFlags: { needsReply: boolean; waitAfterSend: boolean; replyMode: 'wait' | null; pinCount: number } | null;
  /** ack/respond/derive need exactly one pin naming this message; `revision` is null when not a positive integer. */
  pins: { count: number; matchesMessage: boolean; revision: number | null };
  /**
   * respond only. Text reply (MSG-04/05, `normalizeText`, `mailbox-service.ts:261-267`):
   * `true` = a non-empty string within `SESSION_MESSAGE_MAX_TEXT_BYTES`; `false` = a
   * non-empty string over that bound (`capacity`); `null` = empty or not a string
   * (`invalid`). Formal Answer (MSG-06, `:1822-1823`): anything but `true` is `invalid`.
   * `message_sent` does not read it: the send text check (`:1052`) stays with the
   * service's request-shape checks, after the project check and before the flags.
   */
  bodyBounded: boolean | null;
  /** MSG-06 only. */
  queryAnswer: null | {
    /** The consultation binding names this message, the original recipient and the derivation source. */
    bindingMatches: boolean;
    jobAnsweredWithAnswer: boolean;
    runSettledAnswered: boolean;
    answeringSessionIsClaimSession: boolean;
  };
  /** MSG-07/08 only. */
  inputAccepted: null | {
    /** A work_run may confirm only its own Run; always true for the Host. */
    observerOwnsExecution: boolean;
    /** Equals the Kernel identity pinned on the execution record. */
    kernelMatches: boolean;
    /** part=message: the recipient; part=response: the original work_run sender Session. */
    executionSessionMatches: boolean;
    inputIdTakenByOtherEvent: boolean;
  };
  /** MSG-10 only. */
  consumedWait: null | { responseRefMatches: boolean; sameWorkspace: boolean };
};

export type SessionMessageEventType =
  | 'SessionMessageSent'
  | 'SessionMessageRead'
  | 'SessionMessageResponded'
  | 'SessionMessageInputAccepted'
  | 'SessionMessageConsultationDerived';

/**
 * Effects the owner service translates (§10.3 effects column):
 * - `store_body`: store the bounded body Artifact BEFORE the commit (outside the
 *   transaction; an orphan body is never published, `C1-session-mailbox.test.ts:417`).
 *   `source:'workspace'` uses the current workspace source; `'answer'` keeps the
 *   formal Answer's original source (MSG-06).
 * - `write_message`: the record from `createSessionMessageRecord` (`created`) or
 *   `nextSessionMessageRecord` (the other kinds).
 * - `append_event`: the durable event in the same commit.
 * - `guard_message`: the message CAS; `null` means "must not exist" (send CAS@0),
 *   otherwise the pinned revision (ack/respond/derive) or the read revision
 *   (input_accepted). A failure of this CAS at commit time is mapped exactly as
 *   a `stale` rejection (see the module comment): receipt re-check first, then
 *   `revision_conflict` with the store's `current` pins.
 * - `guard_work_run_facts`: join the Run, Session, Lease and role guards
 *   returned by `authorizeNewWorkRunAction`.
 */
export type MessageEffect =
  | { kind: 'store_body'; part: 'message' | 'response'; source: 'workspace' | 'answer' }
  | { kind: 'write_message'; change: 'created' | SessionMessageChange['kind'] }
  | { kind: 'append_event'; eventType: SessionMessageEventType }
  | { kind: 'guard_message'; expectedRevision: number | null }
  | { kind: 'guard_work_run_facts' };

export type MessageTransition = Transition<MessageMachineState, MessageEvent, MessageEffect>;

// --------------------------------------------------------------------------
// Projection
// --------------------------------------------------------------------------

/** The machine state of a decoded record (`null` = absent). */
export function messageMachineStateOf(message: SessionMessageRecord | null): MessageMachineState {
  if (message === null) return { status: 'absent' };
  return {
    status: message.status,
    hasReadAt: message.readAt !== null,
    hasResponse: message.response !== null,
    acceptedInputIds: (message.acceptedInputs ?? []).map((entry) => entry.inputId),
    hasDerivation: message.consultationDerivation !== undefined,
    revision: message.revision,
  };
}

// --------------------------------------------------------------------------
// Shared guards (each returns the rejection of today's service, or null)
// --------------------------------------------------------------------------

/** `normalizeMessagePin` (`mailbox-service.ts:282-288`): exactly one pin naming this message. */
function pinProblem(ctx: MessageGuardContext): MessageTransition | null {
  if (ctx.pins.count !== 1) return reject('illegal', 'invalid', 'ack/respond require exactly one SessionMessage version pin');
  if (ctx.pins.revision === null) return reject('illegal', 'invalid', 'the SessionMessage pin revision must be a positive integer');
  if (!ctx.pins.matchesMessage) return reject('illegal', 'invalid', 'the version pin does not name the requested message');
  return null;
}

/** The fresh work_run admission (`mailbox-service.ts:615-741`) keeps its own code. */
function workRunAuthorizationProblem(ctx: MessageGuardContext): MessageTransition | null {
  const verdict = ctx.workRunAuthorization;
  if (verdict === 'ok') return null;
  if (verdict === null) return reject('guard_failed', 'forbidden', 'a work_run mailbox write requires the fresh work_run admission verdict');
  return reject('guard_failed', verdict.code, verdict.reason);
}

/**
 * Store CAS on the pinned revision (§10.4 "版本钉 ≠ 当前 revision"). Today this
 * is caught only by the commit CAS, so the service handles `stale` as that
 * failure: `recheckAfterMiss` first (a same-identity receipt replays), then
 * `revision_conflict` carrying the `current` message pin (module comment).
 */
function stalePinProblem(ctx: MessageGuardContext, state: PresentMessageState): MessageTransition | null {
  if (ctx.pins.revision !== state.revision) {
    return reject('stale', 'revision_conflict', 'the SessionMessage version pin is not the current revision');
  }
  return null;
}

/**
 * `normalizeText` (`mailbox-service.ts:261-267`) on a text reply: an empty or
 * non-string text is `invalid`, an oversized one `capacity`.
 */
function textBodyProblem(ctx: MessageGuardContext): MessageTransition | null {
  switch (ctx.bodyBounded) {
    case true:
      return null;
    case false:
      return reject('guard_failed', 'capacity', 'the response text exceeds the bounded message body size');
    case null:
      return reject('guard_failed', 'invalid', 'message text must be a non-empty string');
    default:
      return unreachable(ctx.bodyBounded, 'message body bound');
  }
}

/** `mapReadResult` (`mailbox-service.ts:139`) for a missing message. */
function absentMessage(): MessageTransition {
  return reject('illegal', 'not_found', 'the requested record does not exist');
}

function first(...checks: ReadonlyArray<() => MessageTransition | null>): MessageTransition | null {
  for (const check of checks) {
    const problem = check();
    if (problem !== null) return problem;
  }
  return null;
}

// --------------------------------------------------------------------------
// Rows
// --------------------------------------------------------------------------

/** MSG-01 (Host) / MSG-02 (work_run); checks in `sendMessage` order (`mailbox-service.ts:1040-1178`). */
function onMessageSent(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  // :1051 — the project check runs before everything else, before the workspace check.
  if (ctx.recipientScope === 'other_project') {
    return reject('guard_failed', 'forbidden', 'the recipient Session belongs to another project');
  }
  const flags = ctx.sendFlags;
  if (flags === null) return reject('illegal', 'invalid', 'message_sent requires the normalized send flags');
  // :1075-1077 (codec :325-327).
  if (flags.waitAfterSend && !flags.needsReply) {
    return reject('illegal', 'invalid', 'waitAfterSend requires needsReply to be true or omitted');
  }
  // :1078
  if (flags.pinCount !== 0) return reject('illegal', 'invalid', 'sendSessionMessage must not carry version pins');
  let workRun: boolean;
  switch (ctx.principal) {
    case 'host':
      workRun = false;
      break;
    case 'work_run': {
      // :1110-1124 — the fresh admission runs before the target Session read.
      const problem = workRunAuthorizationProblem(ctx);
      if (problem !== null) return problem;
      workRun = true;
      break;
    }
    case 'other':
      // :1091-1093
      return reject('illegal', 'unsupported', 'the mailbox sender principal is not supported');
    default:
      return unreachable(ctx.principal, 'message principal');
  }
  // :1126-1134 — busy or archived recipients still receive durable mail.
  if (ctx.recipientScope !== 'same_workspace') {
    return reject('guard_failed', 'not_found', ctx.recipientScope === null
      ? 'the recipient Session was not found'
      : 'the recipient Session is outside the bound workspace');
  }
  switch (state.status) {
    case 'absent':
      return accept<MessageMachineState, MessageEffect>(
        { status: 'pending', hasReadAt: false, hasResponse: false, acceptedInputIds: [], hasDerivation: false, revision: 1 },
        [
          { kind: 'store_body', part: 'message', source: 'workspace' },
          { kind: 'write_message', change: 'created' },
          { kind: 'append_event', eventType: 'SessionMessageSent' },
          { kind: 'guard_message', expectedRevision: null },
          ...(workRun ? [{ kind: 'guard_work_run_facts' } as const] : []),
        ],
      );
    case 'pending':
    case 'read':
    case 'responded':
      // The messageId is derived from the send identity; an existing record is
      // caught by the create CAS@0 and only the original receipt replays.
      return reject('illegal', 'revision_conflict', 'the message already exists; only the original send receipt replays');
    default:
      return unreachable(state, 'message state');
  }
}

/** MSG-03; checks in `ackMessage` order (`mailbox-service.ts:1559-1624`). */
function onMessageRead(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const problem = first(
    () => ctx.principal === 'work_run' ? null : reject('guard_failed', 'forbidden', ctx.principal === 'host'
      ? 'a Host cannot acknowledge a message'
      : 'only a work_run may acknowledge a message'),
    () => pinProblem(ctx),
    () => workRunAuthorizationProblem(ctx),
  );
  if (problem !== null) return problem;
  switch (state.status) {
    case 'absent':
      return absentMessage();
    case 'pending': {
      const guard = first(
        () => ctx.callerIsRecipient === true ? null : reject('guard_failed', 'forbidden', 'this message is not addressed to the caller Session'),
        () => stalePinProblem(ctx, state),
      );
      if (guard !== null) return guard;
      return accept<MessageMachineState, MessageEffect>(
        { ...state, status: 'read', hasReadAt: true, revision: state.revision + 1 },
        [
          { kind: 'write_message', change: 'read' },
          { kind: 'append_event', eventType: 'SessionMessageRead' },
          { kind: 'guard_message', expectedRevision: state.revision },
          { kind: 'guard_work_run_facts' },
        ],
      );
    }
    case 'read':
    case 'responded':
      // :1597 runs before :1598-1605.
      if (ctx.callerIsRecipient !== true) return reject('guard_failed', 'forbidden', 'this message is not addressed to the caller Session');
      return reject('illegal', 'invalid', 'only a pending message can be acknowledged');
    default:
      return unreachable(state, 'message state');
  }
}

/** MSG-04 / MSG-05; checks in `respondMessage` order (`mailbox-service.ts:1629-1713`). */
function onTextResponse(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const problem = first(
    () => ctx.principal === 'work_run' ? null : reject('guard_failed', 'forbidden', ctx.principal === 'host'
      ? 'a Host cannot respond to a message'
      : 'only a work_run may respond to a message'),
    // :1642-1643 — text normalization runs before the pin and the receipt lookup.
    () => textBodyProblem(ctx),
    () => pinProblem(ctx),
    () => workRunAuthorizationProblem(ctx),
  );
  if (problem !== null) return problem;
  switch (state.status) {
    case 'absent':
      return absentMessage();
    case 'pending':
    case 'read': {
      const guard = first(
        () => ctx.callerIsRecipient === true ? null : reject('guard_failed', 'forbidden', 'this message is not addressed to the caller Session'),
        () => stalePinProblem(ctx, state),
      );
      if (guard !== null) return guard;
      return accept<MessageMachineState, MessageEffect>(respondedState(state), [
        { kind: 'store_body', part: 'response', source: 'workspace' },
        { kind: 'write_message', change: 'responded' },
        { kind: 'append_event', eventType: 'SessionMessageResponded' },
        { kind: 'guard_message', expectedRevision: state.revision },
        { kind: 'guard_work_run_facts' },
      ]);
    }
    case 'responded':
      // :1669 runs before :1670-1675; the single slot is first-come.
      if (ctx.callerIsRecipient !== true) return reject('guard_failed', 'forbidden', 'this message is not addressed to the caller Session');
      return reject('illegal', 'invalid', 'the message already has a response');
    default:
      return unreachable(state, 'message state');
  }
}

/** MSG-06; checks in `respondFromQueryAnswer` order (`mailbox-service.ts:1726-1880`). */
function onAnswerResponse(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const problem = first(
    () => ctx.principal === 'host' ? null : reject('guard_failed', 'forbidden', 'only the Host may associate an official Query answer with a message'),
    () => pinProblem(ctx),
  );
  if (problem !== null) return problem;
  if (state.status === 'absent') return absentMessage();
  // :1780-1826 — the binding and the settled Query facts are checked before the slot.
  const answer = ctx.queryAnswer;
  const guard = first(
    () => answer !== null && answer.bindingMatches ? null
      : reject('guard_failed', 'forbidden', 'the consultation answer does not match this message, its recipient or the derivation source'),
    () => answer !== null && answer.jobAnsweredWithAnswer ? null
      : reject('guard_failed', 'forbidden', 'the QueryJob does not record this answer as its formal answered fact'),
    () => answer !== null && answer.runSettledAnswered ? null
      : reject('guard_failed', 'forbidden', 'the QueryRun did not settle as answered'),
    () => answer !== null && answer.answeringSessionIsClaimSession ? null
      : reject('guard_failed', 'forbidden', 'the QueryRun was not claimed by the formal answerer Session'),
    () => ctx.bodyBounded === true ? null
      : reject('guard_failed', 'invalid', 'the formal Query answer text is not a legal bounded message body'),
  );
  if (guard !== null) return guard;
  switch (state.status) {
    case 'pending':
    case 'read': {
      const stale = stalePinProblem(ctx, state);
      if (stale !== null) return stale;
      return accept<MessageMachineState, MessageEffect>(respondedState(state), [
        { kind: 'store_body', part: 'response', source: 'answer' },
        { kind: 'write_message', change: 'responded' },
        { kind: 'append_event', eventType: 'SessionMessageResponded' },
        { kind: 'guard_message', expectedRevision: state.revision },
      ]);
    }
    case 'responded':
      // :1841-1844 — first-come with MSG-04/05.
      return reject('illegal', 'invalid', 'the message already has a response');
    default:
      return unreachable(state, 'message state');
  }
}

/** `readAt ??= respondedAt` (I-8): a responded message always carries readAt. */
function respondedState(state: PresentMessageState): MessageMachineState {
  return { ...state, status: 'responded', hasReadAt: true, hasResponse: true, revision: state.revision + 1 };
}

/** MSG-07 / MSG-08; checks in `recordInputAccepted` order (`mailbox-service.ts:1947-2064`). */
function onInputAccepted(
  state: MessageMachineState,
  event: Extract<MessageEvent, { type: 'input_accepted' }>,
  ctx: MessageGuardContext,
): MessageTransition {
  const facts = ctx.inputAccepted;
  const problem = first(
    () => ctx.principal !== 'other' ? null
      : reject('guard_failed', 'forbidden', 'only the trusted observing Host or executing Run may confirm an accepted input'),
    () => facts !== null ? null : reject('guard_failed', 'forbidden', 'input_accepted requires the persisted execution facts'),
    // :1981-1983
    () => facts !== null && facts.observerOwnsExecution ? null
      : reject('guard_failed', 'forbidden', 'an execution may only confirm its own accepted inputs'),
  );
  if (problem !== null) return problem;
  if (state.status === 'absent') return absentMessage();
  // :2023-2036
  const guard = first(
    () => facts !== null && facts.kernelMatches ? null
      : reject('guard_failed', 'forbidden', 'accepted input does not match the persisted execution Kernel identity'),
    () => {
      if (event.part === 'response') {
        // :2030-2033 — a response part needs the slot and the original work_run sender Session.
        return state.hasResponse && facts !== null && facts.executionSessionMatches ? null
          : reject('guard_failed', 'forbidden', 'the accepted response does not belong to the executing Session');
      }
      return facts !== null && facts.executionSessionMatches ? null
        : reject('guard_failed', 'forbidden', 'the accepted message is not addressed to the executing Session');
    },
    // :2037-2042 — inputId uniqueness; another event has a different identity key.
    () => facts !== null && !facts.inputIdTakenByOtherEvent ? null
      : reject('guard_failed', 'invalid', 'this source input was accepted by another execution event'),
    // The same event already appended: the service replays its original receipt.
    () => !state.acceptedInputIds.includes(event.inputId) ? null
      : reject('duplicate', 'invalid', 'this source input is already recorded; only the original receipt replays'),
  );
  if (guard !== null) return guard;
  switch (state.status) {
    case 'pending':
    case 'read':
    case 'responded':
      // Delivery, read and processed are three facts (M3): status and readAt never change here.
      return accept<MessageMachineState, MessageEffect>(
        { ...state, acceptedInputIds: [...state.acceptedInputIds, event.inputId], revision: state.revision + 1 },
        [
          { kind: 'write_message', change: 'input_accepted' },
          { kind: 'append_event', eventType: 'SessionMessageInputAccepted' },
          { kind: 'guard_message', expectedRevision: state.revision },
        ],
      );
    default:
      return unreachable(state, 'message state');
  }
}

/** MSG-09; checks in `recordConsultationDerivation` order (`mailbox-service.ts:1885-1942`). */
function onConsultationDerived(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const problem = first(
    () => ctx.principal === 'host' ? null : reject('guard_failed', 'forbidden', 'only the Host may record a consultation derivation'),
    () => pinProblem(ctx),
  );
  if (problem !== null) return problem;
  switch (state.status) {
    case 'absent':
      return absentMessage();
    case 'pending':
    case 'read':
    case 'responded': {
      // :1918-1921 — the first derivation wins.
      if (state.hasDerivation) {
        return reject('illegal', 'invalid', 'the original request already carries a fixed consultation derivation');
      }
      const stale = stalePinProblem(ctx, state);
      if (stale !== null) return stale;
      return accept<MessageMachineState, MessageEffect>(
        { ...state, hasDerivation: true, revision: state.revision + 1 },
        [
          { kind: 'write_message', change: 'consultation_derived' },
          { kind: 'append_event', eventType: 'SessionMessageConsultationDerived' },
          { kind: 'guard_message', expectedRevision: state.revision },
        ],
      );
    }
    default:
      return unreachable(state, 'message state');
  }
}

export type MessageWaitVerdict =
  | { satisfied: true }
  | { satisfied: false; code: Extract<CoreError, 'busy' | 'forbidden'>; detail: string };

/**
 * MSG-10 read-only predicate (`claim-service.ts:619-638`): only a responded
 * message whose saved reply body is the claim's `responseRef`, in the bound
 * workspace, satisfies a wait. `read` or `acceptedInputs` never do (M3).
 */
export function messageSatisfiesWait(
  state: MessageMachineState,
  consumedWait: { responseRefMatches: boolean; sameWorkspace: boolean },
): MessageWaitVerdict {
  switch (state.status) {
    case 'absent':
      return { satisfied: false, code: 'busy', detail: 'the continuation wait message record does not exist' };
    case 'pending':
    case 'read':
      return { satisfied: false, code: 'busy', detail: 'the continuation wait has not been answered' };
    case 'responded':
      if (!state.hasResponse) return { satisfied: false, code: 'busy', detail: 'the continuation wait has not been answered' };
      if (!consumedWait.responseRefMatches) {
        return { satisfied: false, code: 'forbidden', detail: 'the continuation responseRef is not the formal saved reply body' };
      }
      if (!consumedWait.sameWorkspace) {
        return { satisfied: false, code: 'forbidden', detail: 'the continuation wait message is outside the bound workspace' };
      }
      return { satisfied: true };
    default:
      return unreachable(state, 'message state');
  }
}

/**
 * MSG-10 as a transition: no state change, so `effects: []` (SD-1). The claim
 * commit keeps guarding the message revision it read (`claim-service.ts:703`, `:731`).
 */
function onTaskClaimed(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  if (ctx.consumedWait === null) return reject('guard_failed', 'invalid', 'task_claimed requires the consumed wait facts');
  const verdict = messageSatisfiesWait(state, ctx.consumedWait);
  if (!verdict.satisfied) return reject('guard_failed', verdict.code, verdict.detail);
  return accept<MessageMachineState, MessageEffect>(state);
}

export function transitionMessage(state: MessageMachineState, event: MessageEvent, ctx: MessageGuardContext): MessageTransition {
  switch (event.type) {
    case 'message_sent':
      return onMessageSent(state, ctx);
    case 'message_read':
      return onMessageRead(state, ctx);
    case 'message_responded':
      switch (event.via) {
        case 'text':
          return onTextResponse(state, ctx);
        case 'query_answer':
          return onAnswerResponse(state, ctx);
        default:
          return unreachable(event.via, 'message response source');
      }
    case 'input_accepted':
      return onInputAccepted(state, event, ctx);
    case 'consultation_derived':
      return onConsultationDerived(state, ctx);
    case 'task_claimed':
      return onTaskClaimed(state, ctx);
    default:
      return unreachable(event, 'message event');
  }
}

// --------------------------------------------------------------------------
// Record constructors (§14.1: the only writers of status/readAt/response,
// acceptedInputs and consultationDerivation outside the codecs)
// --------------------------------------------------------------------------

export type NewSessionMessageInput = {
  ref: SessionMessageRef;
  sender: MessageHostSenderRecord | MessageWorkRunSenderRecord;
  recipient: SessionRef;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  createdAt: string;
  /** Normalized send flags (`mailbox-service.ts:1072-1074`); `null` = omitted. */
  replyMode: 'wait' | null;
  intent: SessionMessageIntentV1 | null;
  needsReply: boolean;
  waitAfterSend: boolean;
};

/**
 * MSG-01/02: `pending` at revision 1 (send CAS@0). Optional fields are written
 * only when present, exactly as `mailbox-service.ts:1149-1165`, so a historical
 * fire-and-forget message keeps its shape.
 */
export function createSessionMessageRecord(input: NewSessionMessageInput): SessionMessageRecord {
  if (input.waitAfterSend && !input.needsReply) {
    throw new Error('createSessionMessageRecord: waitAfterSend requires needsReply');
  }
  return {
    ref: input.ref,
    schemaVersion: 1,
    revision: 1,
    sender: input.sender,
    recipient: input.recipient,
    bodyRef: input.bodyRef,
    sourceRef: input.sourceRef,
    createdAt: input.createdAt,
    status: 'pending',
    readAt: null,
    response: null,
    ...(input.replyMode === null ? {} : { replyMode: input.replyMode }),
    ...(input.intent === null ? {} : { intent: input.intent }),
    ...(input.needsReply ? { needsReply: true } : {}),
    ...(input.waitAfterSend ? { waitAfterSend: true } : {}),
  };
}

/** One accepted change of an existing message; time comes from the service clock. */
export type SessionMessageChange =
  | { kind: 'read'; readAt: string }
  | { kind: 'responded'; response: MessageResponseRecord }
  | { kind: 'input_accepted'; input: MessageAcceptedInput }
  | { kind: 'consultation_derived'; derivation: MessageConsultationDerivation };

/**
 * MSG-03..09: the next revision of `message`. Every change bumps the revision
 * by one and keeps the I-8 triple consistent; a change the machine would have
 * rejected throws (a service bug, never a caller error).
 */
export function nextSessionMessageRecord(message: SessionMessageRecord, change: SessionMessageChange): SessionMessageRecord {
  const revision = message.revision + 1;
  switch (change.kind) {
    case 'read':
      // MSG-03 (`mailbox-service.ts:1608`).
      if (message.status !== 'pending') throw new Error('nextSessionMessageRecord: only a pending message can be read');
      return { ...message, revision, status: 'read', readAt: change.readAt };
    case 'responded': {
      // MSG-04/05/06 (`:1691-1697`, `:1857-1863`): one slot; readAt ??= respondedAt.
      if (message.status === 'responded' || message.response !== null) {
        throw new Error('nextSessionMessageRecord: the response slot is already written');
      }
      const response: MessageResponseRecord = {
        sender: change.response.sender,
        bodyRef: change.response.bodyRef,
        sourceRef: change.response.sourceRef,
        respondedAt: change.response.respondedAt,
      };
      return { ...message, revision, status: 'responded', readAt: message.readAt ?? response.respondedAt, response };
    }
    case 'input_accepted': {
      // MSG-07/08 (`:2045-2047`): append only; status and readAt are untouched.
      const existing = message.acceptedInputs ?? [];
      if (existing.some((entry) => entry.inputId === change.input.inputId)) {
        throw new Error('nextSessionMessageRecord: the input is already accepted');
      }
      if (change.input.part === 'response' && message.response === null) {
        throw new Error('nextSessionMessageRecord: a response part needs a written response');
      }
      const entry: MessageAcceptedInput = {
        inputId: change.input.inputId,
        part: change.input.part,
        executionRef: { ...change.input.executionRef },
        kernel: { ...change.input.kernel },
        acceptedAt: change.input.acceptedAt,
      };
      return { ...message, revision, acceptedInputs: [...existing, entry] };
    }
    case 'consultation_derived':
      // MSG-09 (`:1924-1925`): written once.
      if (message.consultationDerivation !== undefined) {
        throw new Error('nextSessionMessageRecord: the consultation derivation is already fixed');
      }
      return { ...message, revision, consultationDerivation: change.derivation };
    default:
      return unreachable(change, 'message change');
  }
}
