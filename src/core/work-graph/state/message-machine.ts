/**
 * SessionMessage state machine (docs/refactor/STATE-MACHINES-SPEC.md §10,
 * rows MSG-01..MSG-10; forbidden transitions §10.4; invariant I-8 §11.8).
 *
 * A message is a received statement, not a task obligation: receiving never
 * wakes, preempts or creates a dependency (`model/communication-contracts.ts:6-11`).
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
 * returns today's CoreError (§1.2). The `:N` comments in the rows cite the
 * pre-step-3 service (the tree the spec cites), whose checks now run here.
 * The request checks that name the receipt identity run in the service before
 * its receipt lookup, so they hold here when asked: this machine's exported
 * principal, recipient project, pin, send flag and observer guards
 * (`messagePrincipalProblem`, `messageRecipientProjectProblem`,
 * `messagePinProblem`, `messageSendFlagsProblem`, `inputObserverProblem`),
 * which the rows ask again with the same facts, and the service's own text
 * check (`normalizeText`; a known exception, see `textBodyProblem`).
 *
 * Two kinds of rejection depend on the RecordStore as well as on the state, so the
 * service keeps today's receipt handling around them (§1.2):
 * - A stale pin (§10.4 "版本钉 ≠ 当前 revision") is refused only by the commit
 *   CAS, as today: an accepted ack/respond/derive carries the caller's pin in
 *   `guard_message`, never the revision read, so the doomed write still does
 *   everything before its commit (workspace read, body store, clock, abort
 *   check, commit planning) and the store refuses it. The service maps that
 *   failure as today (`writeMessage`): `recheckAfterMiss` first (a
 *   same-identity receipt replays), then `mapStoreFailure`'s
 *   `revision_conflict` with the store's `current` pins. So this machine never
 *   answers `stale`.
 * - The `illegal`/`invalid` rejections of an already read, responded or
 *   derived message, and the inputId uniqueness rejections of an accepted
 *   input, are likewise preceded by `recheckAfterMiss`, so a concurrent request
 *   of the same identity replays its original receipt instead of being rejected.
 *
 * `SessionMessage` is declared in `model/communication-contracts.ts:95`, which this
 * directory may not import (§14.4). `SessionMessageRecord` below is the same
 * shape built from `src/contracts` types only; tests/state/message-machine.test.ts
 * asserts the two types are identical.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection } from '../../../contracts/core/results.js';
import type {
  DecisionApplicationV1,
  DecisionMessageMetadataV1,
  MessageRecipient,
  SessionMessageIntentV1,
  SessionMessageRef,
  UserMessageResponseV1,
} from '../../../contracts/core/session-message.js';
import type { ArchiveWaitChoiceV1 } from '../../../contracts/core/session-archive.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1 } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import { accept, reject, unreachable, type Rejected, type Transition } from './transition.js';

// --------------------------------------------------------------------------
// Persisted record (structurally identical to model/communication-contracts.ts:36-145)
// --------------------------------------------------------------------------

/** Trusted Host sender (`communication-contracts.ts:36-39`). */
export type MessageHostSenderRecord = {
  kind: 'host';
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

/** Formal work_run sender (`communication-contracts.ts:46-52`). */
export type MessageWorkRunSenderRecord = {
  kind: 'work_run';
  sessionRef: SessionRef;
  runRef: RunRef;
  roleBinding: RoleBindingRefV1;
  generation: number;
};

/** Derived formal Query Answer sender; only the response slot accepts it (`communication-contracts.ts:67-73`). */
export type MessageQueryAnswerSenderRecord = {
  kind: 'query_run';
  sessionRef: SessionRef;
  queryRunRef: QueryRunRef;
  answerRef: QueryJobAnswerRef;
  generation: number;
};

/** The single response slot (`communication-contracts.ts:81-86`); written once. */
export type MessageResponseRecord = {
  sender: MessageWorkRunSenderRecord | MessageQueryAnswerSenderRecord;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  respondedAt: string;
};

export type SessionMessageStatus = 'pending' | 'read' | 'responded';

/** One committed Kernel `run.input_accepted` observation (`communication-contracts.ts:132-138`); append-only. */
export type MessageAcceptedInput = {
  inputId: string;
  part: 'message' | 'response';
  executionRef: RunRef | QueryRunRef;
  kernel: { adapterId: string; kernelSessionId: string; runId: string; turnId: string; position: number };
  acceptedAt: string;
};

/** The fixed A′ derivation (`communication-contracts.ts:139-144`); the first writer wins. */
export type MessageConsultationDerivation = {
  childSessionRef: SessionRef;
  sourceSessionRef: SessionRef;
  sourceKernel: { adapterId: string; kernelSessionId: string };
  throughPosition: number | null;
};

/** `SessionMessage` (`communication-contracts.ts:96-152`). */
export type SessionMessageRecord = {
  ref: SessionMessageRef;
  schemaVersion: 1;
  revision: number;
  sender: MessageHostSenderRecord | MessageWorkRunSenderRecord;
  recipient: MessageRecipient;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  createdAt: string;
  status: SessionMessageStatus;
  readAt: string | null;
  response: MessageResponseRecord | UserMessageResponseV1 | null;
  /**
   * Wiring package 2 (spec §2.3, L10): the commit cursor of the first saved
   * response on a work_run message; `null` is the pending placeholder bound in
   * the same mailbox commit, absent on other senders and legacy messages.
   */
  responseSince?: CommitCursor | null;
  /** Slice 5: the owning Goal; absent/null keeps the historical message shape. */
  goalRef?: GoalRef | null;
  /** Slice 5: decision metadata, only on a user decision request or synthetic answer. */
  decision?: DecisionMessageMetadataV1;
  /** Slice 5: the recorded application of the user's answer, when requirements demanded one. */
  application?: DecisionApplicationV1 | null;
  replyMode?: 'wait';
  intent?: SessionMessageIntentV1;
  needsReply?: boolean;
  waitAfterSend?: boolean;
  acceptedInputs?: MessageAcceptedInput[];
  consultationDerivation?: MessageConsultationDerivation;
  /** Slice 1 §2.5: the effective reply handler; absent and null both mean the original sender. */
  replyHandler?: {
    sessionRef: SessionRef;
    archiveSessionRef: SessionRef;
    archiveRequestId: string;
    changedAt: string;
  } | null;
  /** Slice 1 §2.5: the recorded disposal of this wait during an archive; absent and null mean none. */
  archiveWaitDisposition?: {
    kind: 'cancel' | 'transfer';
    runRef: RunRef;
    archiveSessionRef: SessionRef;
    archiveRequestId: string;
    recordedAt: string;
  } | null;
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
 * (`communication-contracts.ts:57-59`), computed by the service. `task_claimed` is the
 * read-only continuation-claim check (MSG-10).
 */
export type MessageEvent =
  | { type: 'message_sent' }
  | { type: 'message_read' }
  | { type: 'message_responded'; via: 'text' | 'query_answer' }
  | { type: 'input_accepted'; part: 'message' | 'response'; inputId: string }
  | { type: 'consultation_derived' }
  | { type: 'task_claimed' }
  | { type: 'archive_wait_disposed' }
  // Slice 5 §3.1: the user-decision rows (S5-MSG-02/03/04; S5-MSG-05 is the
  // same `decision_application_recorded` event when `requiresApplication=false`).
  | { type: 'user_decision_answered' }
  | { type: 'synthetic_decision_answered' }
  | { type: 'decision_application_recorded' };

/**
 * S5-MSG-01 extension (`user_message_sent`) guard facts (spec §3.1 guard column).
 * UNSPECIFIED-GUARDS: the lead freezes these field names at the part-1 review.
 */
export type MessageUserSendFacts = {
  /** The named Goal is the real owning Goal of the recipient user workspace. */
  goalScopeMatches: boolean;
  /** S5-AU-04: the sender's trusted duties admit the requested user-message intent. */
  dutiesAllowSend: boolean;
  /** The `decision_request` object/option/annotation parameters are legal. */
  decisionParamsValid: boolean;
};

/** S5-MSG-02/03/06 guard facts (spec §3.1 guard column). */
export type MessageDecisionAnswerFacts = {
  /** The caller is the composition's configured operator (never `actor.kind` alone). */
  operatorMatches: boolean;
  /** The caller's pin names the original message version read in this call. */
  messagePinMatches: boolean;
  /** The owning Goal is not `cancelled` (S5-MSG-06). */
  goalNotCancelled: boolean;
  /** A valid stored option id or the explicit `other` selection. */
  selectionValid: boolean;
  /** Every annotation key comes from the card's objects. */
  annotationsFromObjects: boolean;
  /** The canonical source facts/pins read in this call (S5-MSG-03). */
  sourceFactsMatch: boolean;
  /** The source is a formal reader result, not a UI-only self-report (S5-MSG-03). */
  sourceNotUiOnly: boolean;
  /** The single answer slot is still empty (S5-MSG-03). */
  answerSlotEmpty: boolean;
};

/** S5-MSG-04/05 guard facts (spec §3.1 guard column). */
export type MessageDecisionApplicationFacts = {
  /** The formal receipt/event is readable and self-consistent. */
  receiptReadable: boolean;
  /** Every changed object's before pin equals the answer's captured source pin (or §2.8 rebase proof). */
  changedBeforeMatchesReceipt: boolean;
  /** The receipt's after versions match the formal versions. */
  receiptAfterMatches: boolean;
  /** This answer is associated with the acknowledgement the receipt names. */
  answerAssociationExists: boolean;
  /** The caller is the actual modifier or the configured operator. */
  modifierOrOperator: boolean;
  /** `requiresApplication`; when false the row is `invalid` (S5-MSG-05). */
  requiresApplication: boolean;
};

/** §10.1. IO stays in the service; it fills in what it read and authorized. */
export type MessageGuardContext = {
  principal: 'host' | 'work_run' | 'other';
  /** `authorizeNewWorkRunAction` (`mailbox-service.ts:782-908`); `null` for a Host call. */
  workRunAuthorization: 'ok' | CoreRejection | null;
  /** ack/respond: the caller Session is the recipient. */
  callerIsRecipient: boolean | null;
  /** message_sent only. */
  recipientScope: 'same_workspace' | 'other_workspace' | 'other_project' | null;
  /** message_sent only: the normalized flags (`mailbox-service.ts:1356-1358`) and the pin count. */
  sendFlags: { needsReply: boolean; waitAfterSend: boolean; replyMode: 'wait' | null; pinCount: number } | null;
  /** ack/respond/derive need exactly one pin naming this message; `revision` is null when not a positive integer. */
  pins: { count: number; matchesMessage: boolean; revision: number | null };
  /**
   * respond only. Text reply (MSG-04/05): `true` = a non-empty string within
   * `SESSION_MESSAGE_MAX_TEXT_BYTES`; `false` = a non-empty string over that bound
   * (`capacity`, with this machine's own reason, see `textBodyProblem`); `null` = empty or
   * not a string (`invalid`). The service passes `true`: its `normalizeText` already refused
   * the others. Formal Answer (MSG-06, `readQueryAnswerFacts`): anything but `true` is `invalid`.
   * `message_sent` does not read it: the send text check (`:1336`) stays with the
   * service's request-shape checks, after the project check and before the flags.
   */
  bodyBounded: boolean | null;
  /** MSG-06 only: the settled Query facts, each naming today's first failing check (`respondFromQueryAnswer`). */
  queryAnswer: null | {
    /**
     * `matches`: the Query is an explicit consultation of this message, for its original
     * recipient, a derivation (if any) is sourced at that recipient, and the QueryJob/QueryRun
     * are the message's deterministic consultation identity; otherwise the first mismatch.
     */
    binding: QueryAnswerBinding;
    jobAnsweredWithAnswer: boolean;
    /** The QueryRun `executionState.phase` is settled, and its status and outcome are answered. */
    run: 'settled_answered' | 'not_settled' | 'not_answered';
    answeringSessionIsClaimSession: boolean;
    /** The Answer names this settled QueryRun. */
    answerOfRun: boolean;
    /** The claimed Session generation is a positive integer; it becomes the reply sender's generation. */
    sessionGenerationReadable: boolean;
  };
  /**
   * MSG-07/08 only. `null` while the execution facts are unread: the service reads them only
   * for an existing message, so an absent one is refused first.
   */
  inputAccepted: null | {
    /** A work_run may confirm only its own Run; always true for the Host. */
    observerOwnsExecution: boolean;
    /** Equals the Kernel identity pinned on the execution record. */
    kernelMatches: boolean;
    /** The caller's optional `executionSessionRef` is the execution's claimed Session (true when omitted). */
    claimedSessionMatches: boolean;
    /** part=message: the recipient; part=response: the original work_run sender Session. */
    executionSessionMatches: boolean;
    inputIdTakenByOtherEvent: boolean;
  };
  /** MSG-10 only. */
  consumedWait: null | { responseRefMatches: boolean; sameWorkspace: boolean };
  /** Slice 1 §3.5: `archive_wait_disposed` only. */
  archiveWait?: {
    choice: ArchiveWaitChoiceV1; archiveSessionRef: SessionRef; archiveRequestId: string; now: string;
    requestMatches: boolean; waitMatches: boolean; targetEligible: boolean; responseAccepted: boolean;
  };
  /** S5-MSG-01 extension only. */
  userSend?: MessageUserSendFacts | null;
  /** S5-MSG-02/03/06 only. */
  decisionAnswer?: MessageDecisionAnswerFacts | null;
  /** S5-MSG-04/05 only. */
  decisionApplication?: MessageDecisionApplicationFacts | null;
};

/** MSG-06 consultation binding verdict, in today's check order. */
export type QueryAnswerBinding =
  | 'matches'
  | 'not_consultation'
  | 'other_message'
  | 'other_recipient'
  | 'other_derivation_source'
  | 'other_query_identity';

export type SessionMessageEventType =
  | 'SessionMessageSent'
  | 'SessionMessageRead'
  | 'SessionMessageResponded'
  | 'SessionMessageInputAccepted'
  | 'SessionMessageConsultationDerived'
  | 'ArchiveWaitDisposed'
  // Slice 5 §3.1 rows S5-MSG-03/04 (spec §2.8 event bodies).
  | 'SessionMessageDecisionAnswered'
  | 'SessionMessageDecisionApplied';

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
 *   otherwise the caller's pin (ack/respond/derive; a stale pin fails here, as
 *   today) or the read revision (input_accepted). A failure of this CAS at
 *   commit time is mapped as today's commit failure (see the module comment):
 *   receipt re-check first, then `revision_conflict` with the store's `current` pins.
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

/**
 * The first guard of MSG-03..06 and MSG-09: the principal the row admits, with today's reason
 * (pre-step-3 `:1561`, `:1631`, `:1728`, `:1887`). The service asks it before anything else of
 * the write and compares the kind itself only to narrow the principal it holds.
 */
export function messagePrincipalProblem(
  event: Extract<MessageEvent, { type: 'message_read' | 'message_responded' | 'consultation_derived' }>,
  principal: MessageGuardContext['principal'],
): Rejected | null {
  switch (event.type) {
    case 'message_read':
      return principal === 'work_run' ? null : reject('guard_failed', 'forbidden', principal === 'host'
        ? 'a Host cannot acknowledge a message'
        : 'only a work_run may acknowledge a message');
    case 'message_responded':
      if (event.via === 'query_answer') {
        return principal === 'host' ? null
          : reject('guard_failed', 'forbidden', 'only the Host may associate an official Query answer with a message');
      }
      return principal === 'work_run' ? null : reject('guard_failed', 'forbidden', principal === 'host'
        ? 'a Host cannot respond to a message'
        : 'only a work_run may respond to a message');
    case 'consultation_derived':
      return principal === 'host' ? null : reject('guard_failed', 'forbidden', 'only the Host may record a consultation derivation');
    default:
      return unreachable(event, 'message event');
  }
}

/** MSG-01/02's first check (pre-step-3 `:1051`): the recipient is in the caller's project. The service asks it with the request. */
export function messageRecipientProjectProblem(sameProject: boolean): Rejected | null {
  return sameProject ? null : reject('guard_failed', 'forbidden', 'the recipient Session belongs to another project');
}

/**
 * Pre-step-3 `normalizeMessagePin` (`mailbox-service.ts:296-302`): exactly one pin naming this
 * message (MSG-03..06, MSG-09). The service asks it with the request, before its receipt lookup.
 */
export function messagePinProblem(pins: MessageGuardContext['pins']): Rejected | null {
  if (pins.count !== 1) return reject('illegal', 'invalid', 'ack/respond require exactly one SessionMessage version pin');
  if (pins.revision === null) return reject('illegal', 'invalid', 'the SessionMessage pin revision must be a positive integer');
  if (!pins.matchesMessage) return reject('illegal', 'invalid', 'the version pin does not name the requested message');
  return null;
}

/**
 * MSG-01/02's send flags and pins (pre-step-3 `:1075-1078`, codec `:325-327`): `waitAfterSend`
 * without `needsReply`, then any version pin, is illegal. The service asks it with the request.
 */
export function messageSendFlagsProblem(flags: NonNullable<MessageGuardContext['sendFlags']>): Rejected | null {
  if (flags.waitAfterSend && !flags.needsReply) return reject('illegal', 'invalid', 'waitAfterSend requires needsReply to be true or omitted');
  if (flags.pinCount !== 0) return reject('illegal', 'invalid', 'sendSessionMessage must not carry version pins');
  return null;
}

/** MSG-07/08 (pre-step-3 `:1981-1983`): a work_run confirms only its own execution. The service asks it with the request. */
export function inputObserverProblem(observerOwnsExecution: boolean): Rejected | null {
  return observerOwnsExecution ? null : reject('guard_failed', 'forbidden', 'an execution may only confirm its own accepted inputs');
}

/** The fresh work_run admission (`mailbox-service.ts:782-908`) keeps its own code. */
function workRunAuthorizationProblem(ctx: MessageGuardContext): MessageTransition | null {
  const verdict = ctx.workRunAuthorization;
  if (verdict === 'ok') return null;
  if (verdict === null) return reject('guard_failed', 'forbidden', 'a work_run mailbox write requires the fresh work_run admission verdict');
  return reject('guard_failed', verdict.code, verdict.reason);
}

/**
 * The message CAS revision of an accepted ack/respond/derive: the caller's pin,
 * never the revision read. §10.4 "版本钉 ≠ 当前 revision" is that store CAS, which
 * today is the only check of a stale pin (module comment). `messagePinProblem` held,
 * so the pin is a positive integer.
 */
function pinnedRevision(ctx: MessageGuardContext): number {
  if (ctx.pins.revision === null) throw new Error('the message CAS needs the version pin that messagePinProblem accepted');
  return ctx.pins.revision;
}

/**
 * MSG-04/05's text check, the same codes as the service's `normalizeText`: an
 * empty or non-string text is `invalid`, an oversized one `capacity`. Known
 * exception: the service keeps `normalizeText` and asks the row with its result
 * (`bodyBounded: true`), because its capacity reason names
 * `SESSION_MESSAGE_MAX_TEXT_BYTES` ("message text exceeds 16384 UTF-8 bytes"),
 * a codec bound this directory may not import (§14.4). This row's capacity
 * reason is NOT today's; do not drop the service check in its favour.
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

/** `mapReadResult` (`mailbox-service.ts:153`) for a missing message. */
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

/** MSG-01 (Host) / MSG-02 (work_run); checks in the pre-step-3 `sendMessage` order (`mailbox-service.ts:1040-1178`). */
function onMessageSent(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  // :1051 — the project check runs before everything else, before the workspace check.
  const projectProblem = messageRecipientProjectProblem(ctx.recipientScope !== 'other_project');
  if (projectProblem !== null) return projectProblem;
  if (ctx.sendFlags === null) return reject('illegal', 'invalid', 'message_sent requires the normalized send flags');
  const flagProblem = messageSendFlagsProblem(ctx.sendFlags);
  if (flagProblem !== null) return flagProblem;
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
  // S5-MSG-01 / S5-AU-04: a user-recipient message carries its trusted facts.
  // Sending does NOT consult the Goal start policy (the user message itself is
  // never a work change); only the scope, the duties admission and the decision
  // request parameters are checked.
  if (ctx.userSend !== undefined && ctx.userSend !== null) {
    const userSend = ctx.userSend;
    const userSendProblem = first(
      () => userSend.goalScopeMatches ? null
        : reject('guard_failed', 'forbidden', 'the user message does not belong to its recipient workspace Goal'),
      () => userSend.dutiesAllowSend ? null
        : reject('guard_failed', 'forbidden', 'the sender trusted duties do not allow this user message'),
      () => userSend.decisionParamsValid ? null
        : reject('guard_failed', 'invalid', 'the decision request parameters are invalid'),
    );
    if (userSendProblem !== null) return userSendProblem;
  }
  // :1126-1134 — busy or archived recipients still receive durable mail. An
  // unresolved recipient is today's `mapReadResult` refusal of the Session read.
  if (ctx.recipientScope !== 'same_workspace') {
    return reject('guard_failed', 'not_found', ctx.recipientScope === null
      ? 'the requested record does not exist'
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

/** MSG-03; checks in the pre-step-3 `ackMessage` order (`mailbox-service.ts:1559-1624`). */
function onMessageRead(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const problem = first(
    () => messagePrincipalProblem({ type: 'message_read' }, ctx.principal),
    () => messagePinProblem(ctx.pins),
    () => workRunAuthorizationProblem(ctx),
  );
  if (problem !== null) return problem;
  switch (state.status) {
    case 'absent':
      return absentMessage();
    case 'pending':
      if (ctx.callerIsRecipient !== true) return reject('guard_failed', 'forbidden', 'this message is not addressed to the caller Session');
      return accept<MessageMachineState, MessageEffect>(
        { ...state, status: 'read', hasReadAt: true, revision: state.revision + 1 },
        [
          { kind: 'write_message', change: 'read' },
          { kind: 'append_event', eventType: 'SessionMessageRead' },
          { kind: 'guard_message', expectedRevision: pinnedRevision(ctx) },
          { kind: 'guard_work_run_facts' },
        ],
      );
    case 'read':
    case 'responded':
      // :1597 runs before :1598-1605.
      if (ctx.callerIsRecipient !== true) return reject('guard_failed', 'forbidden', 'this message is not addressed to the caller Session');
      return reject('illegal', 'invalid', 'only a pending message can be acknowledged');
    default:
      return unreachable(state, 'message state');
  }
}

/** MSG-04 / MSG-05; checks in the pre-step-3 `respondMessage` order (`mailbox-service.ts:1629-1713`). */
function onTextResponse(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const problem = first(
    () => messagePrincipalProblem({ type: 'message_responded', via: 'text' }, ctx.principal),
    // :1642-1643 — text normalization runs before the pin and the receipt lookup.
    () => textBodyProblem(ctx),
    () => messagePinProblem(ctx.pins),
    () => workRunAuthorizationProblem(ctx),
  );
  if (problem !== null) return problem;
  switch (state.status) {
    case 'absent':
      return absentMessage();
    case 'pending':
    case 'read':
      if (ctx.callerIsRecipient !== true) return reject('guard_failed', 'forbidden', 'this message is not addressed to the caller Session');
      return accept<MessageMachineState, MessageEffect>(respondedState(state), [
        { kind: 'store_body', part: 'response', source: 'workspace' },
        { kind: 'write_message', change: 'responded' },
        { kind: 'append_event', eventType: 'SessionMessageResponded' },
        { kind: 'guard_message', expectedRevision: pinnedRevision(ctx) },
        { kind: 'guard_work_run_facts' },
      ]);
    case 'responded':
      // :1669 runs before :1670-1675; the single slot is first-come.
      if (ctx.callerIsRecipient !== true) return reject('guard_failed', 'forbidden', 'this message is not addressed to the caller Session');
      return reject('illegal', 'invalid', 'the message already has a response');
    default:
      return unreachable(state, 'message state');
  }
}

/**
 * MSG-06's consultation guards in `respondFromQueryAnswer` order, each with
 * today's reason: the binding, the answered QueryJob, the settled answered
 * QueryRun, the claimed answerer Session, the Answer's own QueryRun, then the
 * readable claim generation (`unavailable`).
 */
function queryAnswerProblem(answer: MessageGuardContext['queryAnswer']): MessageTransition | null {
  if (answer === null) {
    return reject('guard_failed', 'forbidden', 'the consultation answer does not match this message, its recipient or the derivation source');
  }
  switch (answer.binding) {
    case 'matches':
      break;
    case 'not_consultation':
      return reject('guard_failed', 'forbidden', 'the Query answer is not an explicit consultation answer');
    case 'other_message':
      return reject('guard_failed', 'forbidden', 'the consultation answer belongs to another message');
    case 'other_recipient':
      return reject('guard_failed', 'forbidden', 'the consultation answer recipient is not the original message recipient');
    case 'other_derivation_source':
      // A derived A′ answer is answered by the child Session; the original recipient stays the source.
      return reject('guard_failed', 'forbidden', 'the derived answer source is not the original message recipient');
    case 'other_query_identity':
      return reject('guard_failed', 'forbidden', 'the consultation answer does not match the deterministic message identity');
    default:
      return unreachable(answer.binding, 'consultation binding');
  }
  if (!answer.jobAnsweredWithAnswer) {
    return reject('guard_failed', 'forbidden', 'the QueryJob does not record this answer as its formal answered fact');
  }
  switch (answer.run) {
    case 'settled_answered':
      break;
    case 'not_settled':
      return reject('guard_failed', 'forbidden', 'the QueryRun is not settled and cannot source a message reply');
    case 'not_answered':
      return reject('guard_failed', 'forbidden', 'the QueryRun did not settle as answered');
    default:
      return unreachable(answer.run, 'QueryRun settlement');
  }
  if (!answer.answeringSessionIsClaimSession) {
    return reject('guard_failed', 'forbidden', 'the QueryRun was not claimed by the formal answerer Session');
  }
  if (!answer.answerOfRun) return reject('guard_failed', 'forbidden', 'the Query answer does not belong to the settled QueryRun');
  if (!answer.sessionGenerationReadable) return reject('guard_failed', 'unavailable', 'the QueryRun Session generation is not readable');
  return null;
}

/** MSG-06; checks in the pre-step-3 `respondFromQueryAnswer` order (`mailbox-service.ts:1726-1880`). */
function onAnswerResponse(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const problem = first(
    () => messagePrincipalProblem({ type: 'message_responded', via: 'query_answer' }, ctx.principal),
    () => messagePinProblem(ctx.pins),
  );
  if (problem !== null) return problem;
  if (state.status === 'absent') return absentMessage();
  // The binding and the settled Query facts are checked before the slot, and
  // before the receipt lookup that needs the derived query_run sender.
  const guard = first(
    () => queryAnswerProblem(ctx.queryAnswer),
    () => ctx.bodyBounded === true ? null
      : reject('guard_failed', 'invalid', 'the formal Query answer text is not a legal bounded message body'),
  );
  if (guard !== null) return guard;
  switch (state.status) {
    case 'pending':
    case 'read':
      return accept<MessageMachineState, MessageEffect>(respondedState(state), [
        { kind: 'store_body', part: 'response', source: 'answer' },
        { kind: 'write_message', change: 'responded' },
        { kind: 'append_event', eventType: 'SessionMessageResponded' },
        { kind: 'guard_message', expectedRevision: pinnedRevision(ctx) },
      ]);
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

/** MSG-07 / MSG-08; checks in the pre-step-3 `recordInputAccepted` order (`mailbox-service.ts:1947-2064`). */
function onInputAccepted(
  state: MessageMachineState,
  event: Extract<MessageEvent, { type: 'input_accepted' }>,
  ctx: MessageGuardContext,
): MessageTransition {
  const facts = ctx.inputAccepted;
  const problem = first(
    () => ctx.principal !== 'other' ? null
      : reject('guard_failed', 'forbidden', 'only the trusted observing Host or executing Run may confirm an accepted input'),
    // :1981-1983 — checked with the request, before the receipt lookup and the message read.
    () => facts === null ? null : inputObserverProblem(facts.observerOwnsExecution),
  );
  if (problem !== null) return problem;
  if (state.status === 'absent') return absentMessage();
  // :2023-2036 — the execution facts are read after the message.
  const guard = first(
    () => facts !== null ? null : reject('guard_failed', 'forbidden', 'input_accepted requires the persisted execution facts'),
    () => facts !== null && facts.kernelMatches ? null
      : reject('guard_failed', 'forbidden', 'accepted input does not match the persisted execution Kernel identity'),
    () => facts !== null && facts.claimedSessionMatches ? null
      : reject('guard_failed', 'forbidden', 'claimed acceptance Session differs from the execution'),
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
    // The same event already appended: the service replays its original receipt;
    // without one it keeps today's single uniqueness refusal.
    () => !state.acceptedInputIds.includes(event.inputId) ? null
      : reject('duplicate', 'invalid', 'this source input was accepted by another execution event'),
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

/** MSG-09; checks in the pre-step-3 `recordConsultationDerivation` order (`mailbox-service.ts:1885-1942`). */
function onConsultationDerived(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const problem = first(
    () => messagePrincipalProblem({ type: 'consultation_derived' }, ctx.principal),
    () => messagePinProblem(ctx.pins),
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
      return accept<MessageMachineState, MessageEffect>(
        { ...state, hasDerivation: true, revision: state.revision + 1 },
        [
          { kind: 'write_message', change: 'consultation_derived' },
          { kind: 'append_event', eventType: 'SessionMessageConsultationDerived' },
          { kind: 'guard_message', expectedRevision: pinnedRevision(ctx) },
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

/**
 * S1-MSG-01/02: the archive disposes the original wait by transferring the
 * reply handler or recording a cancel. The message status, response, sender and
 * recipient never change; only the handler/disposition (and the revision) do.
 * An already accepted response consumes the wait, so it is `busy`.
 */
function onArchiveWaitDisposed(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  if (state.status === 'absent') return absentMessage();
  const facts = ctx.archiveWait;
  if (facts === undefined) return reject('illegal', 'invalid', 'archive_wait_disposed requires the archive wait facts');
  if (facts.responseAccepted) {
    return reject('guard_failed', 'busy', 'the wait response was already accepted into an execution');
  }
  if (!facts.requestMatches) {
    return reject('guard_failed', 'invalid', 'archive_input_invalid: the archive request does not match this wait disposal');
  }
  if (!facts.waitMatches) {
    return reject('guard_failed', 'invalid', 'the wait disposal does not match the original wait');
  }
  if (!facts.targetEligible) {
    return reject('guard_failed', 'unavailable', 'the reply-handler target Session is not eligible');
  }
  return accept<MessageMachineState, MessageEffect>(
    { ...state, revision: state.revision + 1 },
    [
      { kind: 'write_message', change: 'archive_wait_disposed' },
      { kind: 'append_event', eventType: 'ArchiveWaitDisposed' },
      { kind: 'guard_message', expectedRevision: state.revision },
    ],
  );
}

/**
 * S5-MSG-02/06: an operator answers a user decision card. Answering changes the
 * response slot only: no Plan, Task or Run effect (rule 3). A paused Goal may
 * still answer (`goalNotCancelled` is not `active`); a cancelled Goal refuses
 * `invalid` (S5-MSG-06).
 */
function onUserDecisionAnswered(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const facts = ctx.decisionAnswer;
  if (facts === null || facts === undefined) {
    return reject('illegal', 'invalid', 'user_decision_answered requires the decision answer facts');
  }
  const problem = first(
    () => facts.operatorMatches ? null
      : reject('guard_failed', 'forbidden', 'only the configured operator may answer a user decision card'),
    () => messagePinProblem(ctx.pins),
    () => facts.messagePinMatches ? null
      : reject('stale', 'revision_conflict', 'the answer pin does not name the message version read in this call'),
    () => facts.goalNotCancelled ? null : reject('illegal', 'invalid', 'goal_cancelled'),
    () => facts.selectionValid ? null
      : reject('guard_failed', 'invalid', 'the answer names neither a stored option nor the explicit other selection'),
    () => facts.annotationsFromObjects ? null
      : reject('guard_failed', 'invalid', 'an annotation names an object outside the card'),
  );
  if (problem !== null) return problem;
  switch (state.status) {
    case 'absent':
      return absentMessage();
    case 'pending':
    case 'read':
      // The ordinary answer writes the ORIGINAL response slot and appends
      // `SessionMessageResponded`; the decision-answer event is only for the
      // synthetic non-message card (S5-MSG-03).
      return accept<MessageMachineState, MessageEffect>(respondedState(state), [
        { kind: 'store_body', part: 'response', source: 'workspace' },
        { kind: 'write_message', change: 'decision_answered' },
        { kind: 'append_event', eventType: 'SessionMessageResponded' },
        { kind: 'guard_message', expectedRevision: pinnedRevision(ctx) },
      ]);
    case 'responded':
      return reject('illegal', 'invalid', 'the message already has a response');
    default:
      return unreachable(state, 'message state');
  }
}

/**
 * S5-MSG-03/06: the answer of a NON-message card creates the synthetic user
 * message directly at `responded@1`. The `s5-decision-answer:` claim and the
 * service-side persistence stay with the owner.
 */
function onSyntheticDecisionAnswered(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const facts = ctx.decisionAnswer;
  if (facts === null || facts === undefined) {
    return reject('illegal', 'invalid', 'synthetic_decision_answered requires the decision answer facts');
  }
  const problem = first(
    () => facts.operatorMatches ? null
      : reject('guard_failed', 'forbidden', 'only the configured operator may answer a user decision card'),
    () => facts.goalNotCancelled ? null : reject('illegal', 'invalid', 'goal_cancelled'),
    () => facts.sourceFactsMatch ? null
      : reject('stale', 'revision_conflict', 'the canonical source facts changed since they were read'),
    () => facts.sourceNotUiOnly ? null
      : reject('guard_failed', 'invalid', 'the decision source is only a UI self-report'),
    () => facts.answerSlotEmpty ? null
      : reject('stale', 'revision_conflict', 'the answer slot is already written for this source'),
    () => facts.selectionValid ? null
      : reject('guard_failed', 'invalid', 'the answer names neither a stored option nor the explicit other selection'),
    () => facts.annotationsFromObjects ? null
      : reject('guard_failed', 'invalid', 'an annotation names an object outside the card'),
  );
  if (problem !== null) return problem;
  if (state.status !== 'absent') {
    return reject('illegal', 'revision_conflict', 'the synthetic answer message already exists; only its original receipt replays');
  }
  return accept<MessageMachineState, MessageEffect>(
    { status: 'responded', hasReadAt: true, hasResponse: true, acceptedInputIds: [], hasDerivation: false, revision: 1 },
    [
      { kind: 'store_body', part: 'message', source: 'workspace' },
      { kind: 'store_body', part: 'response', source: 'workspace' },
      { kind: 'write_message', change: 'created' },
      { kind: 'append_event', eventType: 'SessionMessageDecisionAnswered' },
      { kind: 'guard_message', expectedRevision: null },
    ],
  );
}

/**
 * S5-MSG-04/05: records the formal application proof on a responded decision
 * card. `requiresApplication=false` is the same event refused `invalid`
 * (S5-MSG-05); a false "current version"/PASS is `revision_conflict`.
 */
function onDecisionApplicationRecorded(state: MessageMachineState, ctx: MessageGuardContext): MessageTransition {
  const facts = ctx.decisionApplication;
  if (facts === null || facts === undefined) {
    return reject('illegal', 'invalid', 'decision_application_recorded requires the application facts');
  }
  const problem = first(
    () => facts.receiptReadable ? null
      : reject('guard_failed', 'incomplete', 'the formal receipt and its event were not found'),
    () => facts.requiresApplication ? null
      : reject('guard_failed', 'invalid', 'a requiresApplication=false answer needs no application (S5-MSG-05)'),
    () => facts.changedBeforeMatchesReceipt ? null
      : reject('stale', 'revision_conflict', 'a changed object does not match the captured source pin'),
    () => facts.receiptAfterMatches ? null
      : reject('stale', 'revision_conflict', 'the receipt after versions do not match the formal versions'),
    () => facts.answerAssociationExists ? null
      : reject('guard_failed', 'invalid', 'the receipt is not associated with this answer'),
    () => facts.modifierOrOperator ? null
      : reject('guard_failed', 'forbidden', 'only the actual modifier or the configured operator may record the application'),
    () => messagePinProblem(ctx.pins),
  );
  if (problem !== null) return problem;
  switch (state.status) {
    case 'absent':
      return absentMessage();
    case 'pending':
    case 'read':
      return reject('illegal', 'invalid', 'only a responded decision card can record an application');
    case 'responded':
      if (!state.hasResponse) return reject('illegal', 'invalid', 'only a responded decision card can record an application');
      return accept<MessageMachineState, MessageEffect>({ ...state, revision: state.revision + 1 }, [
        { kind: 'write_message', change: 'decision_applied' },
        { kind: 'append_event', eventType: 'SessionMessageDecisionApplied' },
        { kind: 'guard_message', expectedRevision: pinnedRevision(ctx) },
      ]);
    default:
      return unreachable(state, 'message state');
  }
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
    case 'archive_wait_disposed':
      return onArchiveWaitDisposed(state, ctx);
    // Slice 5 §3.1: the user-decision rows (S5-MSG-02/03/04; S5-MSG-05 is the
    // same `decision_application_recorded` event refused when `requiresApplication=false`).
    case 'user_decision_answered':
      return onUserDecisionAnswered(state, ctx);
    case 'synthetic_decision_answered':
      return onSyntheticDecisionAnswered(state, ctx);
    case 'decision_application_recorded':
      return onDecisionApplicationRecorded(state, ctx);
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
  recipient: MessageRecipient;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  createdAt: string;
  /** Normalized send flags (`mailbox-service.ts:1356-1358`); `null` = omitted. */
  replyMode: 'wait' | null;
  intent: SessionMessageIntentV1 | null;
  needsReply: boolean;
  waitAfterSend: boolean;
  /**
   * [lead S5-T3-D7] S5-MSG-01 (spec §2.3, §2.7): the owning Goal and the
   * decision metadata of a new user-recipient message. Written only when
   * present, so a historical message keeps its shape; only this constructor
   * writes them (protected fields).
   */
  goalRef?: GoalRef;
  decision?: DecisionMessageMetadataV1;
};

/**
 * [lead S5-T3-D7] S5-MSG-03 (spec §0.2 T06, §2.3, §3.1): the synthetic user
 * message that holds the answer of a NON-message card. `sender` is the
 * configured operator as Host sender; `decision.syntheticAnswer` is true;
 * `response` is the answer (its `decision.source` is the card source).
 */
export type NewSyntheticDecisionAnswerInput = {
  ref: SessionMessageRef;
  sender: MessageHostSenderRecord;
  recipient: MessageRecipient;
  bodyRef: ArtifactRef;
  sourceRef: SourceRefV1;
  createdAt: string;
  goalRef: GoalRef;
  decision: DecisionMessageMetadataV1;
  response: UserMessageResponseV1;
};

/**
 * [lead S5-T3-D7] S5-MSG-03: the synthetic answer record, written directly as
 * `responded` at revision 1 with `intent: 'notify'` (spec §2.3), `readAt` =
 * the answer time, `application` null.
 * The service adds the `s5-decision-answer:` unique claim (spec §2.5) and the
 * `SessionMessageDecisionAnswered` event.
 */
export function createSyntheticDecisionAnswerRecord(input: NewSyntheticDecisionAnswerInput): SessionMessageRecord {
  return {
    ref: input.ref,
    schemaVersion: 1,
    revision: 1,
    sender: input.sender,
    recipient: input.recipient,
    bodyRef: input.bodyRef,
    sourceRef: input.sourceRef,
    createdAt: input.createdAt,
    status: 'responded',
    readAt: input.createdAt,
    response: input.response,
    intent: 'notify',
    goalRef: input.goalRef,
    // §2.7 protected field: this constructor alone establishes the synthetic
    // marker, so a caller can never save a synthetic answer card as a normal one.
    decision: { ...input.decision, syntheticAnswer: true },
    application: null,
  };
}

/**
 * MSG-01/02: `pending` at revision 1 (send CAS@0). Optional fields are written
 * only when present, exactly as the pre-step-3 literal (`mailbox-service.ts:1149-1165`),
 * so a historical fire-and-forget message keeps its shape.
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
    // [lead S5-T3-D7] S5-MSG-01: the owning Goal and the decision metadata are
    // written only when present, so a historical message keeps its exact shape.
    ...(input.goalRef === undefined ? {} : { goalRef: input.goalRef }),
    ...(input.decision === undefined ? {} : { decision: input.decision }),
  };
}

/** One accepted change of an existing message; time comes from the service clock. */
export type SessionMessageChange =
  | { kind: 'read'; readAt: string }
  | { kind: 'responded'; response: MessageResponseRecord }
  | { kind: 'input_accepted'; input: MessageAcceptedInput }
  | { kind: 'consultation_derived'; derivation: MessageConsultationDerivation }
  | { kind: 'archive_wait_disposed'; choice: ArchiveWaitChoiceV1; archiveSessionRef: SessionRef;
      archiveRequestId: string; now: string }
  // Slice 5 §3.1: the user-decision rows.
  | { kind: 'decision_answered'; response: UserMessageResponseV1 }
  | { kind: 'decision_applied'; application: DecisionApplicationV1 };

/**
 * MSG-03..09: the next revision of `message`. Every change bumps the revision
 * by one and keeps the I-8 triple consistent; a change the machine would have
 * rejected throws (a service bug, never a caller error).
 */
export function nextSessionMessageRecord(message: SessionMessageRecord, change: SessionMessageChange): SessionMessageRecord {
  const revision = message.revision + 1;
  switch (change.kind) {
    case 'read':
      // MSG-03 (pre-step-3 `mailbox-service.ts:1608`).
      if (message.status !== 'pending') throw new Error('nextSessionMessageRecord: only a pending message can be read');
      return { ...message, revision, status: 'read', readAt: change.readAt };
    case 'responded': {
      // MSG-04/05/06 (pre-step-3 `:1691-1697`, `:1857-1863`): one slot; readAt ??= respondedAt.
      if (message.status === 'responded' || message.response !== null) {
        throw new Error('nextSessionMessageRecord: the response slot is already written');
      }
      const response: MessageResponseRecord = {
        sender: change.response.sender,
        bodyRef: change.response.bodyRef,
        sourceRef: change.response.sourceRef,
        respondedAt: change.response.respondedAt,
      };
      const next: SessionMessageRecord = { ...message, revision, status: 'responded',
        readAt: message.readAt ?? response.respondedAt, response };
      // Spec §2.3 P02: the first reply on a work_run message marks the pending
      // reply position; other senders never gain the field.
      return message.sender.kind === 'work_run' ? { ...next, responseSince: null } : next;
    }
    case 'input_accepted': {
      // MSG-07/08 (pre-step-3 `:2045-2047`): append only; status and readAt are untouched.
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
      // MSG-09 (pre-step-3 `:1924-1925`): written once.
      if (message.consultationDerivation !== undefined) {
        throw new Error('nextSessionMessageRecord: the consultation derivation is already fixed');
      }
      return { ...message, revision, consultationDerivation: change.derivation };
    case 'archive_wait_disposed': {
      const choice = change.choice;
      const disposition = {
        kind: choice.kind,
        runRef: choice.runRef,
        archiveSessionRef: change.archiveSessionRef,
        archiveRequestId: change.archiveRequestId,
        recordedAt: change.now,
      };
      if (choice.kind === 'transfer') {
        return {
          ...message,
          revision,
          replyHandler: {
            sessionRef: choice.to,
            archiveSessionRef: change.archiveSessionRef,
            archiveRequestId: change.archiveRequestId,
            changedAt: change.now,
          },
          archiveWaitDisposition: disposition,
        };
      }
      // S1-MSG-02: a cancel records the disposition and keeps the original handler.
      return { ...message, revision, archiveWaitDisposition: disposition };
    }
    // Slice 5 §3.1: the user-decision rows.
    case 'decision_answered': {
      // S5-MSG-02: the ORIGINAL response slot, filled once; readAt ??= respondedAt.
      if (message.status === 'responded' || message.response !== null) {
        throw new Error('nextSessionMessageRecord: the response slot is already written');
      }
      const next: SessionMessageRecord = { ...message, revision, status: 'responded',
        readAt: message.readAt ?? change.response.respondedAt, response: change.response, application: null };
      // Spec §2.3 P02: a user answer to a work_run message also marks the pending
      // reply position; other senders never gain the field.
      return message.sender.kind === 'work_run' ? { ...next, responseSince: null } : next;
    }
    case 'decision_applied': {
      // S5-MSG-04/05: the application proof is recorded once on an answered card.
      if (message.application !== undefined && message.application !== null) {
        throw new Error('nextSessionMessageRecord: the application is already recorded');
      }
      if (message.response === null) {
        throw new Error('nextSessionMessageRecord: an application needs an answered message');
      }
      return { ...message, revision, application: change.application };
    }
    default:
      return unreachable(change, 'message change');
  }
}

/**
 * Spec §2.3 P02: the record-store's mechanical commit tail replaces the explicit
 * `null` reply placeholder with the cursor of the commit that saved the first
 * response. It never fills an absent (non-work_run/legacy) or already-bound
 * field, and never parses a cursor.
 */
export function bindMessageResponseCursor(message: SessionMessageRecord, cursor: CommitCursor): SessionMessageRecord {
  if (message.responseSince !== null) return message;
  return { ...message, responseSince: cursor };
}
