/**
 * K3 spec §3.2b (CRR-01..CRR-07), L19a and lead decisions K8-7 (2026-10-16):
 * the pure `CommandRerunRequest` machine and the one-alias-open-request helper.
 * The owner service reads the record, builds the guard context, calls
 * `newCommandRerunRequest` / `transitionCommandRerunRequest`, and writes the
 * `next` record plus the translated effects in ONE RecordStore commit. This
 * file imports only `src/contracts` and this directory (§14.4).
 *
 * Replay (B2-09, L19): the caller hands the last applied receipt in
 * `ctx.receipt`; the same identity with the same fingerprint replays
 * unchanged, and a different fingerprint is `idempotency_conflict`.
 *
 * Two layers (121-110): a request goes to the responsible adviser first
 * (`awaiting_advice`), whose answer allows one rerun, denies it for this Run or
 * escalates; the person's card (`pending`) is the second layer.
 */
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CommandRerunAdviceV1 } from '../../../contracts/command-rerun-advice.js';
import type { CommandRerunRequestV1 } from '../../../contracts/command-rerun-request.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import type { GoalAutonomyV1 } from '../../../contracts/goal-decisions.js';
import type { UnknownCallReviewRef, UnknownCallReviewV1 } from '../../../contracts/unknown-call-review.js';
import { accept, reject, type Transition } from './transition.js';

/** L19a: a request record holds at most 8 declared forms. */
export const COMMAND_RERUN_REQUEST_MAX_FORMS = 8;

/** L19a: one declared rewrite as stored (`text` is display-only, cut to 512 bytes). */
export type CommandRerunRequestFormV1 = { sha256: string; text: string };

/** The creation input; the machine owns `schemaVersion`, `revision`, `state`, `declared`, the answers, `updatedAt`. */
export type NewCommandRerunRequestInputV1 = Omit<
  CommandRerunRequestV1,
  | 'schemaVersion' | 'revision' | 'state' | 'declared' | 'declaredForms'
  | 'answerMessageRef' | 'allowedAt' | 'usedAt' | 'usedBy' | 'updatedAt' | 'advice' | 'escalation'
> & {
  /** Who answers first (`commandRerunAdviserStageOf`); absent is the person (`pending@1`). */
  stage?: 'adviser' | 'person' | 'no_adviser';
  /** The declared, unrecognised rewrite the record starts with (CRR-01); max 8 in total. */
  declaredForm?: CommandRerunRequestFormV1;
  /** A seed list of declared forms (defaults to none); capacity is checked on the whole list. */
  declaredForms?: readonly CommandRerunRequestFormV1[];
  /** Defaults to `createdAt`; the machine never reads a clock. */
  updatedAt?: string;
};

/** The one `CommandRerunRequestChanged@1` change per accepted transition. */
export type CommandRerunRequestChangeV1 =
  | 'created' | 'allowed' | 'used' | 'denied' | 'denied_final' | 'closed' | 'forms_added'
  | 'adviser_answer_applied' | 'escalated';

export type CommandRerunRequestEffectV1 =
  | { kind: 'write_request'; request: CommandRerunRequestV1 }
  | { kind: 'emit_event'; change: CommandRerunRequestChangeV1 };

/** `none` is the absent record; every other value is the stored record at its revision. */
export type CommandRerunRequestState = 'none' | CommandRerunRequestV1;

export type CommandRerunRequestEventV1 =
  | { kind: 'created'; identityKey: string; fingerprint: string; input: NewCommandRerunRequestInputV1 }
  | { kind: 'allowed'; identityKey: string; fingerprint: string;
      answerMessageRef: SessionMessageRef; allowedAt: string }
  | { kind: 'used'; identityKey: string; fingerprint: string; usedAt: string;
      usedBy: { runId: string; callId: string } }
  | { kind: 'denied'; identityKey: string; fingerprint: string; answerMessageRef: SessionMessageRef }
  | { kind: 'denied_final'; identityKey: string; fingerprint: string; answerMessageRef: SessionMessageRef }
  | { kind: 'closed'; identityKey: string; fingerprint: string }
  | { kind: 'forms_added'; identityKey: string; fingerprint: string; form: CommandRerunRequestFormV1 }
  /** `everyStep`: the Goal confirms every step now, so the answer only becomes the person's suggestion. */
  | { kind: 'adviser_answer_applied'; identityKey: string; fingerprint: string; answer: CommandRerunAdviceV1;
      everyStep: boolean }
  | { kind: 'escalated'; identityKey: string; fingerprint: string; cause: 'no_adviser' | 'adviser_failed' };

/** The service supplies every guard fact the table needs; the machine reads no Task, Run or review record itself. */
export type CommandRerunRequestContextV1 = {
  /** The record revision the answer/form event expected; a mismatch is `revision_conflict`. */
  expectedRevision: number;
  /** The commit instant (`updatedAt`); the machine never reads a clock. */
  updatedAt: string;
  /** B2-09 (L19 replay): the identity/fingerprint of the last applied change, when known. */
  receipt?: { identityKey: string; fingerprint: string } | null;
  /** CRR-02/04/05: the answer names this request's card. */
  cardMatches: boolean;
  /** CRR-02/04/05: the Task is still active; a paused Goal is `busy`, the answer waits for it to continue. */
  taskActive: boolean;
  /** CRR-07: the `denied` record belongs to the requesting Run (`denied_in_this_run`). */
  sameRun: boolean;
};

/**
 * 121-110: who answers a new rerun request first, all four cases in one place. Every-step confirmation and the review
 * record's second consecutive interruption (its streak) go to the person at once; a request with no responsible
 * adviser goes to the person with the cause `no_adviser`; everything else goes to the adviser.
 */
export function commandRerunAdviserStageOf(input: {
  autonomy: GoalAutonomyV1;
  streak: UnknownCallReviewV1['streak'];
  adviserAvailable: boolean;
}): 'adviser' | 'person' | 'no_adviser' {
  if (input.autonomy === 'every_step') return 'person';
  if (input.streak.priorUnknownProcess || input.streak.priorAdvised === true) return 'person';
  return input.adviserAvailable ? 'adviser' : 'no_adviser';
}

/**
 * CRR-01 (L19a): builds the `pending@1` record, or `awaiting_advice@1` when the adviser answers first (121-110; with
 * no adviser the person's `pending@1` carries the escalation cause `no_adviser`); `declaredForms` starts with the
 * declared rewrite when one is given.
 */
export function newCommandRerunRequest(
  input: NewCommandRerunRequestInputV1,
): Transition<CommandRerunRequestV1, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  const { declaredForm, declaredForms, updatedAt, stage, ...fields } = input;
  const forms = declaredForm === undefined
    ? [...(declaredForms ?? [])]
    : [declaredForm, ...(declaredForms ?? [])];
  if (forms.length > COMMAND_RERUN_REQUEST_MAX_FORMS) {
    return reject('guard_failed', 'capacity',
      `a request holds at most ${COMMAND_RERUN_REQUEST_MAX_FORMS} declared forms`);
  }
  const record: CommandRerunRequestV1 = {
    ...fields,
    schemaVersion: 1,
    revision: 1,
    state: stage === 'adviser' ? 'awaiting_advice' : 'pending',
    ...(stage === 'adviser' ? { advice: { answer: null } } : {}),
    ...(stage === 'no_adviser' ? { escalation: { cause: 'no_adviser' as const, suggestion: null } } : {}),
    declared: declaredForm !== undefined || fields.match.kind === 'declared',
    declaredForms: forms,
    answerMessageRef: null,
    allowedAt: null,
    usedAt: null,
    usedBy: null,
    updatedAt: updatedAt ?? fields.createdAt,
  };
  return accept(record, [
    { kind: 'write_request', request: record },
    { kind: 'emit_event', change: 'created' },
  ]);
}

/** CRR-01..CRR-07 (spec §3.2b): the pure transition table. The adviser's two events (121-110) start from a stored
 *  record, so their result is the record's next. */
export function transitionCommandRerunRequest(current: CommandRerunRequestV1,
  event: Extract<CommandRerunRequestEventV1, { kind: 'adviser_answer_applied' | 'escalated' }>,
  ctx: CommandRerunRequestContextV1): Transition<CommandRerunRequestV1, CommandRerunRequestEventV1, CommandRerunRequestEffectV1>;
export function transitionCommandRerunRequest(current: CommandRerunRequestState, event: CommandRerunRequestEventV1,
  ctx: CommandRerunRequestContextV1): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1>;
export function transitionCommandRerunRequest(
  current: CommandRerunRequestState,
  event: CommandRerunRequestEventV1,
  ctx: CommandRerunRequestContextV1,
): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  // B2-09 replay first: an already-applied change has already moved the revision.
  if (current !== 'none' && ctx.receipt != null && ctx.receipt.identityKey === event.identityKey) {
    return ctx.receipt.fingerprint === event.fingerprint
      ? accept<CommandRerunRequestState, CommandRerunRequestEffectV1>(current)
      : reject('duplicate', 'idempotency_conflict', 'the request identity was already applied with different content');
  }
  if (current === 'none') {
    if (event.kind !== 'created') {
      return reject('illegal', 'invalid', `${event.kind} is not legal before the request exists`);
    }
    return newCommandRerunRequest(event.input);
  }
  if (ctx.expectedRevision !== current.revision) {
    return reject('stale', 'revision_conflict', `the request changed since revision ${ctx.expectedRevision}`);
  }
  switch (event.kind) {
    case 'allowed': return answer(current, event, ctx, 'allowed');
    case 'denied': return answer(current, event, ctx, 'denied');
    case 'denied_final': return answer(current, event, ctx, 'denied_final');
    case 'used': return used(current, event, ctx);
    case 'closed': return closed(current, ctx);
    case 'forms_added': return formsAdded(current, event, ctx);
    case 'adviser_answer_applied': return rerunAdviserAnswer(current, event, ctx);
    case 'escalated': return rerunEscalated(current, event, ctx);
    case 'created':
      return reject('illegal', 'invalid', 'created is only legal before the request exists');
  }
}

/** The alias key (project, goal, task, review run, alias) of `openRequestForAlias`. */
export type OpenCommandRerunRequestForAliasInputV1 = {
  task: TaskTriple;
  reviewRef: UnknownCallReviewRef;
  alias: number;
};

/**
 * The invariant "one alias has at most one open request" (L19a, K8-7 item 3):
 * the first `awaiting_advice`, `pending` or `allowed` record for the same (task,
 * review record, alias), or `null`. `denied`/`denied_final`/`used`/`closed` are
 * never open.
 */
export function openRequestForAlias(
  records: readonly CommandRerunRequestV1[],
  input: OpenCommandRerunRequestForAliasInputV1,
): CommandRerunRequestV1 | null {
  for (const record of records) {
    if (record.state !== 'awaiting_advice' && record.state !== 'pending' && record.state !== 'allowed') continue;
    if (record.alias !== input.alias) continue;
    if (!sameTask(record.task, input.task)) continue;
    if (!sameReviewRef(record.reviewRef, input.reviewRef)) continue;
    return record;
  }
  return null;
}

/** CRR-02/CRR-04/CRR-05: the three answers from `pending`, sharing their guards. */
function answer(
  current: CommandRerunRequestV1,
  event: Extract<CommandRerunRequestEventV1, { kind: 'allowed' | 'denied' | 'denied_final' }>,
  ctx: CommandRerunRequestContextV1,
  state: 'allowed' | 'denied' | 'denied_final',
): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  if (current.state !== 'pending') {
    return reject('illegal', 'invalid', `${event.kind} is not legal from ${current.state}`);
  }
  if (!ctx.cardMatches) return reject('guard_failed', 'invalid', 'the answer does not name this request card');
  if (!ctx.taskActive) {
    return reject('guard_failed', 'busy', 'the Task is not active; the answer waits for it to continue');
  }
  const patch = event.kind === 'allowed'
    ? { state, answerMessageRef: event.answerMessageRef, allowedAt: event.allowedAt }
    : { state, answerMessageRef: event.answerMessageRef };
  return write(current, patch, state, ctx);
}

/** CRR-03: the hook consumed the one-time allowance for the allowed form. */
function used(
  current: CommandRerunRequestV1,
  event: Extract<CommandRerunRequestEventV1, { kind: 'used' }>,
  ctx: CommandRerunRequestContextV1,
): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  if (current.state !== 'allowed') {
    return reject('illegal', 'invalid', `used is not legal from ${current.state}`);
  }
  return write(current, { state: 'used', usedAt: event.usedAt, usedBy: event.usedBy }, 'used', ctx);
}

/**
 * 121-110: the adviser's answer to an `awaiting_advice` request. `allow_rerun` is the one-time allowance (CRR-03
 * consumes it as a person's), `deny` refuses this Run, `escalate` and every-step confirmation put the request in front
 * of the person with the answer as the suggestion. The answer is kept either way.
 */
function rerunAdviserAnswer(
  current: CommandRerunRequestV1,
  event: Extract<CommandRerunRequestEventV1, { kind: 'adviser_answer_applied' }>,
  ctx: CommandRerunRequestContextV1,
): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  if (current.state !== 'awaiting_advice') {
    return reject('illegal', 'invalid', `an adviser answer is not legal from ${current.state}`);
  }
  const advice = { answer: event.answer };
  const cause = event.everyStep ? 'every_step' as const
    : event.answer.choice === 'escalate' ? 'adviser_escalated' as const : null;
  const patch: Partial<CommandRerunRequestV1> = cause !== null
    ? { state: 'pending', advice, escalation: { cause, suggestion: event.answer } }
    : event.answer.choice === 'allow_rerun' ? { state: 'allowed', advice, allowedAt: ctx.updatedAt }
      : { state: 'denied', advice };
  return write(current, patch, 'adviser_answer_applied', ctx);
}

/** 121-110: an `awaiting_advice` request goes to the person without a suggestion (no adviser, or no answer). */
function rerunEscalated(
  current: CommandRerunRequestV1,
  event: Extract<CommandRerunRequestEventV1, { kind: 'escalated' }>,
  ctx: CommandRerunRequestContextV1,
): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  if (current.state !== 'awaiting_advice') {
    return reject('illegal', 'invalid', `escalated is not legal from ${current.state}`);
  }
  return write(current, { state: 'pending', escalation: { cause: event.cause, suggestion: null } }, 'escalated', ctx);
}

/** CRR-06: the Task ended; only an unfinished request is closed. */
function closed(
  current: CommandRerunRequestV1,
  ctx: CommandRerunRequestContextV1,
): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  if (current.state !== 'awaiting_advice' && current.state !== 'pending' && current.state !== 'allowed') {
    return reject('illegal', 'invalid', `closed is not legal from ${current.state}`);
  }
  return write(current, { state: 'closed' }, 'closed', ctx);
}

/** CRR-07: append a declared rewrite; the state never moves. */
function formsAdded(
  current: CommandRerunRequestV1,
  event: Extract<CommandRerunRequestEventV1, { kind: 'forms_added' }>,
  ctx: CommandRerunRequestContextV1,
): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  if (current.state !== 'awaiting_advice' && current.state !== 'pending' && current.state !== 'denied'
    && current.state !== 'denied_final') {
    return reject('illegal', 'invalid', `forms_added is not legal from ${current.state}`);
  }
  if (current.state === 'denied' && !ctx.sameRun) {
    return reject('illegal', 'invalid', 'the denied request belongs to another Run');
  }
  if (current.declaredForms.length >= COMMAND_RERUN_REQUEST_MAX_FORMS) {
    return reject('guard_failed', 'capacity',
      `a request holds at most ${COMMAND_RERUN_REQUEST_MAX_FORMS} declared forms`);
  }
  return write(current, {
    declaredForms: [...current.declaredForms, event.form],
  }, 'forms_added', ctx);
}

function write(
  current: CommandRerunRequestV1,
  patch: Partial<CommandRerunRequestV1>,
  change: CommandRerunRequestChangeV1,
  ctx: CommandRerunRequestContextV1,
): Transition<CommandRerunRequestState, CommandRerunRequestEventV1, CommandRerunRequestEffectV1> {
  const next: CommandRerunRequestV1 = {
    ...current,
    ...patch,
    revision: current.revision + 1,
    updatedAt: ctx.updatedAt,
  };
  return accept(next, [
    { kind: 'write_request', request: next },
    { kind: 'emit_event', change },
  ]);
}

function sameTask(left: TaskTriple, right: TaskTriple): boolean {
  return left.projectId === right.projectId && left.goalId === right.goalId && left.taskId === right.taskId;
}

function sameReviewRef(left: UnknownCallReviewRef, right: UnknownCallReviewRef): boolean {
  return left.projectId === right.projectId && left.goalId === right.goalId && left.runId === right.runId;
}
