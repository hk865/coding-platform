/**
 * K3 spec §3.2 (UCR-01..UCR-15), L7/L9/L12/L15/L16/L17 and M3: the pure
 * `UnknownCallReview` aggregate machine.
 *
 * A machine never reads storage, never mints ids and never reads a clock: the
 * owner service reads the current record, builds the guard context, calls
 * `newUnknownCallReview` / `transitionUnknownCallReview`, and writes `next`
 * plus the translated effects in ONE RecordStore commit. This file imports only
 * `src/contracts` and this directory (§14.4).
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalAutonomyV1 } from '../../../contracts/goal-decisions.js';
import type {
  CrashSuspicionV1,
  SaferMethodProposalV1,
  UnknownCallBlockedCommandV1,
  UnknownCallDecisionReasonV1,
  UnknownCallDispositionV1,
  UnknownCallEscalationCauseV1,
  UnknownCallInventoryProblemV1,
  UnknownCallObservationV1,
  UnknownCallReviewItemV1,
  UnknownCallReviewV1,
} from '../../../contracts/unknown-call-review.js';
import type { UnknownCallAdvicePhaseV1, UnknownCallAdviceV1 } from '../../../contracts/unknown-call-advice.js';
import { UNKNOWN_CALL_APPROVED_METHODS_MAX_BYTES } from '../../../contracts/unknown-call-review.js';
import { approvedMethodLinesZh } from '../../../contracts/continuation-brief.js';
import { accept, reject, unreachable, type Rejected, type Transition } from './transition.js';

// ------------------------------------------------------------------------ //
// Byte budgets (L7 M3)                                                       //
// ------------------------------------------------------------------------ //

/** The whole serialised record may never exceed 512 KiB (L7). */
export const UNKNOWN_CALL_REVIEW_MAX_BYTES = 524_288;
/** The creation budget B = 512 KiB - R; optional model text is admitted only at or under it (L7, M3). */
export const UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES = 158_720;
/** A record holds at most 8 rounds, even though the "two free slots" rule leaves the cap unused (L9). */
export const UNKNOWN_CALL_REVIEW_MAX_ROUNDS = 8;
/** A record holds at most 32 items (L7). */
export const UNKNOWN_CALL_REVIEW_MAX_ITEMS = 32;

/** L17: the fixed write order of `decisionReasons`. */
export const UNKNOWN_CALL_DECISION_REASON_ORDER: readonly UnknownCallDecisionReasonV1[] = [
  'inventory_incomplete', 'review_stopped', 'review_incomplete', 'review_unavailable',
  'partial', 'undetermined', 'crash_possible', 'crash_undetermined',
  'second_consecutive', 'confirm_each_step', 'proposal_missing', 'proposal_declined',
];

// ------------------------------------------------------------------------ //
// Constructor input and effects (UCR-01/UCR-02, `created`)                   //
// ------------------------------------------------------------------------ //

export type NewUnknownCallReviewInputV1 = Omit<
  UnknownCallReviewV1,
  | 'schemaVersion' | 'revision' | 'status' | 'open' | 'decisionReasons'
  | 'stateEntry' | 'activeRound' | 'updatedAt'
  | 'dispositionTargets' | 'proposalTargets' | 'blockedCommands' | 'disposition'
  | 'rounds' | 'proposals'
> & {
  /** Defaults to `createdAt`; the machine never reads a clock. */
  updatedAt?: string;
  rounds?: UnknownCallReviewV1['rounds'];
  proposals?: SaferMethodProposalV1[];
};

/** The creation truncation result (L7: keep Kernel order, mark `too_large`). */
export type UnknownCallReviewCreationTruncationV1 = {
  items: UnknownCallReviewItemV1[];
  itemsOmitted: number;
  inventory: 'incomplete';
  inventoryProblem: 'too_large';
};

export type UnknownCallReviewChangeV1 =
  | 'created' | 'round_claimed' | 'conclusion_recorded' | 'proposal_recorded'
  | 'round_unfinished' | 'settled' | 'disposition_applied' | 'approval_applied'
  | 'hold_applied' | 'hold_released' | 'adviser_answer_applied' | 'escalated';

export type UnknownCallReviewEffectV1 =
  | { kind: 'write_review'; review: UnknownCallReviewV1 }
  | { kind: 'emit_event'; change: UnknownCallReviewChangeV1 };

// ------------------------------------------------------------------------ //
// Events and guard context (UCR-03..UCR-15)                                  //
// ------------------------------------------------------------------------ //

export type UnknownCallApprovedMethodV1 = {
  proposalId: string;
  callId: string;
  alias: number;
  command: string;
  cwd: string | null;
};

export type UnknownCallReviewEventV1 =
  | { kind: 'round_claimed'; runRef: RunRef; phase: 'review' | 'proposal'; round: number }
  | {
      kind: 'conclusion_recorded';
      alias: number;
      verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
      evidence: string;
      roundRunRef: RunRef | null;
      crashSuspicion: CrashSuspicionV1;
    }
  | { kind: 'proposal_recorded'; proposal: SaferMethodProposalV1 }
  | { kind: 'round_unfinished' }
  | { kind: 'settled' }
  | {
      kind: 'disposition_applied';
      choice: UnknownCallDispositionV1['choice'];
      answerMessageRef: SessionMessageRef | null;
      answeredRevision: number;
      text: string | null;
    }
  | {
      kind: 'approval_applied';
      decision: 'approve' | 'decline';
      answerMessageRef: SessionMessageRef;
      answeredRevision: number;
      text: string | null;
      approvedMethods: UnknownCallApprovedMethodV1[] | null;
    }
  | { kind: 'hold_applied'; answeredRevision: number; text: string | null }
  | { kind: 'hold_released' }
  /** K3 layering: the adviser's parsed answer to the record's `advice.phase`. */
  | { kind: 'adviser_answer_applied'; answer: UnknownCallAdviceV1 }
  /** K3 layering: the Workflow puts an `awaiting_advice` record in front of the person. */
  | { kind: 'escalated'; cause: UnknownCallEscalationCauseV1; suggestion: UnknownCallAdviceV1 | null };

/**
 * The service supplies every guard fact the table needs; the machine reads no
 * Run, no lease and no Goal itself.
 */
export type UnknownCallReviewContextV1 = {
  /** The record revision the command/event expected; a mismatch is `revision_conflict`. */
  expectedRevision: number;
  /** The write instant (`updatedAt`); the machine never reads a clock. */
  updatedAt: string;
  /** The operator; UCR-14/UCR-15 require `human`. */
  actor: ActorRef;
  /** L15: the active round's Run has already ended with a known result. */
  activeRunEnded: boolean;
  /** L15: that known result was Kernel `completed`. */
  activeRunCompleted: boolean;
  /** L15: `reworkFenceOf` for the active round is `human_only` (UCR-06b / UCR-08b). */
  fenceHumanOnly: boolean;
  /** L16 third trigger: read-only commands are unavailable and no round is active. */
  reviewUnavailable: boolean;
  /** The Goal autonomy read at settlement; `every_step` adds `confirm_each_step` (L17). */
  autonomy: GoalAutonomyV1;
  /** D6: aliases whose written conclusion read a truncated/unexpanded command. */
  incompleteCommandAliases: readonly number[];
  /** L16: process aliases whose conclusion has no self-check; `undetermined` at settlement. */
  missingSelfCheckAliases: readonly number[];
  /** L19a: the service-built blocked commands for a `skip_as_done` / approved write. */
  blockedCommands?: readonly UnknownCallBlockedCommandV1[];
  /** UCR-15: the original Run is still the Task's selected Run (D3). */
  originalRunSelected: boolean;
  /**
   * K3 layering: the Workflow found an adviser for this record at settlement
   * (passed in, not re-checked by the owner). Absent reads false.
   */
  adviserAvailable?: boolean;
};

// ------------------------------------------------------------------------ //
// Layering (user decision 11-12, lead rulings 2-6)                           //
// ------------------------------------------------------------------------ //

export type UnknownCallReviewRouteV1 =
  | { to: 'adviser' }
  | { to: 'adviser_then_person'; cause: 'second_consecutive' | 'advised_failed_again' }
  | { to: 'person'; cause: UnknownCallEscalationCauseV1 }
  | { to: 'person'; cause: null; escalation: 'clear' | 'keep' };

/**
 * Where an undecided record goes, first rule wins:
 * 1. every step confirmed -> the person, today's card (④);
 * 2. stopped by the person or inventory incomplete -> the person, today's card
 *    (L15: what the person stopped only the person continues);
 * 3. a missing or declined proposal follows the source of the safer-method
 *    disposition: the person's goes back to the person;
 * 4/5. the adviser's disposition interrupted again (② narrow) or the second
 *    consecutive interruption (①) -> the adviser answers, then the person sees
 *    the card with that answer as the suggestion;
 * 6. everything else (partial, undetermined, crash suspicion, unfinished or
 *    unavailable review, an approval) -> the adviser; with no adviser the
 *    person, `no_adviser` (③).
 * A person route with a `cause` writes that new escalation; today's card
 * (rules 1-2) clears an older one; the person's own method coming back (rule 3)
 * keeps the record's escalation as it is.
 */
export function unknownCallReviewRouteOf(input: {
  reasons: readonly UnknownCallDecisionReasonV1[];
  streak: UnknownCallReviewV1['streak'];
  autonomy: GoalAutonomyV1;
  adviserAvailable: boolean;
  dispositionSource: UnknownCallDispositionV1['source'] | null;
}): UnknownCallReviewRouteV1 {
  const { reasons } = input;
  if (input.autonomy === 'every_step') return { to: 'person', cause: null, escalation: 'clear' };
  if (reasons.includes('review_stopped') || reasons.includes('inventory_incomplete')) {
    return { to: 'person', cause: null, escalation: 'clear' };
  }
  if ((reasons.includes('proposal_missing') || reasons.includes('proposal_declined'))
    && input.dispositionSource !== 'adviser') {
    return { to: 'person', cause: null, escalation: 'keep' };
  }
  const streakCause = input.streak.priorAdvised === true ? 'advised_failed_again' as const
    : input.streak.priorUnknownProcess ? 'second_consecutive' as const : null;
  if (streakCause !== null) {
    return input.adviserAvailable ? { to: 'adviser_then_person', cause: streakCause } : { to: 'person', cause: streakCause };
  }
  return input.adviserAvailable ? { to: 'adviser' } : { to: 'person', cause: 'no_adviser' };
}

/** L18: `safer_method` needs a proposable target and two free round slots (the card and the adviser alike). */
export function unknownCallReviewSaferMethodOpen(record: Pick<UnknownCallReviewV1, 'proposalTargets' | 'rounds'>): boolean {
  return (record.proposalTargets ?? []).length > 0 && record.rounds.length <= UNKNOWN_CALL_REVIEW_MAX_ROUNDS - 2;
}

/** L20: the approved methods are the current proposals, kept alias-ascending by their only writer. */
export function approvedMethodsOf(proposals: readonly SaferMethodProposalV1[]): UnknownCallApprovedMethodV1[] {
  return proposals.map(proposal => ({ proposalId: proposal.proposalId, callId: proposal.callId,
    alias: proposal.alias, command: proposal.command, cwd: proposal.cwd }));
}

// ------------------------------------------------------------------------ //
// Constructor                                                                //
// ------------------------------------------------------------------------ //

/** UCR-01/UCR-02: builds the L9 creation record and returns a Transition. */
export function newUnknownCallReview(
  input: NewUnknownCallReviewInputV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const rounds = input.rounds ?? [];
  const roundProblem = validateRounds(rounds);
  if (roundProblem !== null) return roundProblem;
  const itemProblem = validateItemAliases(input.items);
  if (itemProblem !== null) return itemProblem;

  let record = buildRecord(input, input.items, input.itemsOmitted ?? 0, input.inventory, input.inventoryProblem);
  if (serializedBytes(record) > UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES) {
    const truncated = truncateUnknownCallReviewItems(input);
    record = buildRecord(input, truncated.items, truncated.itemsOmitted, truncated.inventory, truncated.inventoryProblem);
    if (serializedBytes(record) > UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES) {
      return reject('guard_failed', 'capacity',
        `even with no items the review serialises to ${serializedBytes(record)} bytes`);
    }
  }
  return accept(record, [
    { kind: 'write_review', review: record },
    { kind: 'emit_event', change: 'created' },
  ]);
}

/** L7 M3: keep items in Kernel order until one more would exceed B, mark the rest omitted. */
export function truncateUnknownCallReviewItems(
  input: NewUnknownCallReviewInputV1,
): UnknownCallReviewCreationTruncationV1 {
  const baseOmitted = input.itemsOmitted ?? 0;
  const total = input.items.length;
  let kept = 0;
  for (let count = 1; count <= total; count += 1) {
    const candidate = buildRecord(
      input, input.items.slice(0, count), baseOmitted + (total - count), 'incomplete', 'too_large',
    );
    if (serializedBytes(candidate) <= UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES) kept = count;
    else break;
  }
  return {
    items: input.items.slice(0, kept),
    itemsOmitted: baseOmitted + (total - kept),
    inventory: 'incomplete',
    inventoryProblem: 'too_large',
  };
}

/**
 * M3 admission by the written record's serialised UTF-8 size (L7, ruling 9).
 * EVERY write is first held to the absolute 512 KiB ceiling; over it nothing is
 * written. A must-write class is otherwise always admitted; optional model text
 * is admitted only at or under 512 KiB - R. Over budget it returns
 * `reject('guard_failed','capacity',…)`, under budget `null` (the
 * `requeueClaimProblem` convention).
 */
export function admitUnknownCallReview(
  record: UnknownCallReviewV1,
  options: { required: boolean },
): Rejected | null {
  const size = serializedBytes(record);
  if (size > UNKNOWN_CALL_REVIEW_MAX_BYTES) {
    return reject('guard_failed', 'capacity',
      `the review serialises to ${size} bytes; it may never exceed `
      + `${UNKNOWN_CALL_REVIEW_MAX_BYTES} bytes`);
  }
  if (!options.required && size > UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES) {
    return reject('guard_failed', 'capacity',
      `the review serialises to ${size} bytes; optional model text is only admitted at or under `
      + `${UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES} bytes`);
  }
  return null;
}

/** L12: the most recent holder, or the origin Run when there are no rounds. */
export function lastHolderOf(review: Pick<UnknownCallReviewV1, 'runRef' | 'rounds'>): RunRef {
  const last = review.rounds[review.rounds.length - 1];
  return last === undefined ? review.runRef : last.runRef;
}

// ------------------------------------------------------------------------ //
// Transition table (UCR-03..UCR-15)                                          //
// ------------------------------------------------------------------------ //

export function transitionUnknownCallReview(
  current: UnknownCallReviewV1,
  event: UnknownCallReviewEventV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (ctx.expectedRevision !== current.revision) {
    return reject('stale', 'revision_conflict', `the review changed since revision ${ctx.expectedRevision}`);
  }
  switch (event.kind) {
    case 'round_claimed': return roundClaimed(current, event, ctx);
    case 'conclusion_recorded': return conclusionRecorded(current, event, ctx);
    case 'proposal_recorded': return proposalRecorded(current, event, ctx);
    case 'round_unfinished': return roundUnfinished(current, ctx);
    case 'settled': return settled(current, ctx);
    case 'disposition_applied': return dispositionApplied(current, event, ctx);
    case 'approval_applied': return approvalApplied(current, event, ctx);
    case 'hold_applied': return holdApplied(current, event, ctx);
    case 'hold_released': return holdReleased(current, ctx);
    case 'adviser_answer_applied': return adviserAnswerApplied(current, event, ctx);
    case 'escalated': return escalated(current, event, ctx);
  }
  return unreachable(event, 'UnknownCallReviewEvent');
}

/** UCR-03. */
function roundClaimed(
  current: UnknownCallReviewV1,
  event: Extract<UnknownCallReviewEventV1, { kind: 'round_claimed' }>,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (current.status !== 'pending_review' && current.status !== 'awaiting_proposal') {
    return reject('illegal', 'invalid', `round_claimed is not legal from ${current.status}`);
  }
  if (current.activeRound !== null) return reject('guard_failed', 'busy', 'a review round is already active');
  if (holdOf(current) === 'held') return reject('guard_failed', 'busy', 'the review is held by the human');
  if (current.rounds.length >= UNKNOWN_CALL_REVIEW_MAX_ROUNDS) {
    return reject('guard_failed', 'capacity', 'the review has no free round slot');
  }
  return write(current, {
    activeRound: {
      runRef: event.runRef, phase: event.phase, round: event.round,
      stateEntry: current.stateEntry, startedRevision: current.revision,
    },
  }, 'round_claimed', ctx);
}

/** UCR-04. */
function conclusionRecorded(
  current: UnknownCallReviewV1,
  event: Extract<UnknownCallReviewEventV1, { kind: 'conclusion_recorded' }>,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const target = current.items.find(entry => entry.alias === event.alias);
  if (target === undefined) return reject('illegal', 'invalid', `there is no item #${event.alias}`);
  if (target.kind !== 'process') return reject('illegal', 'invalid', `item #${event.alias} is not a process call`);
  if (current.activeRound === null) {
    if (current.status === 'resolved') {
      return reject('stale', 'source_stale', 'the review is settled; its conclusions are final');
    }
    return reject('illegal', 'invalid', 'conclusion_recorded needs an active review round');
  }
  const directHold = current.status === 'resolved' && holdOf(current) === 'held';
  if (current.status !== 'pending_review' && !directHold) {
    return reject('illegal', 'invalid', `conclusion_recorded is not legal from ${current.status}`);
  }
  if (ctx.activeRunEnded) return reject('stale', 'source_stale', 'the review round already ended; its conclusion is late');
  const observed: UnknownCallObservationV1 = {
    verdict: event.verdict, by: 'review_round', evidence: event.evidence,
    roundRunRef: event.roundRunRef, crashSuspicion: event.crashSuspicion, reviewerConclusion: null,
  };
  const items = current.items.map(entry => entry.alias === event.alias ? { ...entry, observed } : entry);
  return write(current, { items }, 'conclusion_recorded', ctx);
}

/** UCR-05. */
function proposalRecorded(
  current: UnknownCallReviewV1,
  event: Extract<UnknownCallReviewEventV1, { kind: 'proposal_recorded' }>,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (current.activeRound === null) {
    return reject('illegal', 'invalid', 'proposal_recorded needs an active proposal round');
  }
  const directHold = current.status === 'resolved' && holdOf(current) === 'held';
  if (current.status !== 'awaiting_proposal' && !directHold) {
    return reject('illegal', 'invalid', `proposal_recorded is not legal from ${current.status}`);
  }
  const { proposal } = event;
  if (current.proposalTargets === null || !current.proposalTargets.includes(proposal.callId)) {
    return reject('illegal', 'invalid', 'the proposal is not for an item in proposalTargets');
  }
  // Lead answer 5: proposals are kept in alias-ascending order (the record's
  // item order). The budget helper sorts too, so a replacement never makes the
  // stored order decide what is measured.
  const proposals = [...current.proposals.filter(existing => existing.callId !== proposal.callId), proposal]
    .sort((left, right) => left.alias - right.alias);
  if (approvedMethodsBytes(proposals) > UNKNOWN_CALL_APPROVED_METHODS_MAX_BYTES) {
    return reject('guard_failed', 'capacity',
      `the approved-method lines exceed ${UNKNOWN_CALL_APPROVED_METHODS_MAX_BYTES} bytes`);
  }
  return write(current, { proposals }, 'proposal_recorded', ctx);
}

/** UCR-06. */
function roundUnfinished(
  current: UnknownCallReviewV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const activeRound = current.activeRound;
  if (activeRound === null) return reject('illegal', 'invalid', 'there is no active review round');
  if (current.status !== 'pending_review' && current.status !== 'awaiting_proposal') {
    return reject('illegal', 'invalid', `round_unfinished is not legal from ${current.status}`);
  }
  if (!ctx.activeRunEnded) return reject('guard_failed', 'busy', 'the review round Run has not ended');
  if (ctx.activeRunCompleted) return reject('illegal', 'invalid', 'a completed round is settled, never unfinished');
  if (ctx.fenceHumanOnly) {
    return reject('illegal', 'invalid', 'a human-stopped round settles with review_stopped (UCR-06b)');
  }
  if (unfinishedInStateEntry(current) > 0) {
    return reject('illegal', 'invalid', 'the second unfinished round in this stateEntry settles (UCR-07/UCR-08)');
  }
  return write(current, {
    activeRound: null,
    rounds: [...current.rounds, roundRecord(activeRound, 'unfinished')],
  }, 'round_unfinished', ctx);
}

/** UCR-06b, UCR-07, UCR-08, UCR-08b, UCR-08c. */
function settled(
  current: UnknownCallReviewV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (current.activeRound === null) {
    if (current.status !== 'pending_review' && current.status !== 'awaiting_proposal') {
      return reject('illegal', 'invalid', `settled is not legal from ${current.status}`);
    }
    if (!ctx.reviewUnavailable) {
      return reject('illegal', 'invalid', 'settled without an active round is the review_unavailable trigger (L16 3)');
    }
    return settleWithoutRound(current, ctx);
  }
  if (!ctx.activeRunEnded) return reject('guard_failed', 'busy', 'the review round Run has not ended');
  if (current.status === 'resolved' && holdOf(current) === 'held') return settleHeld(current, ctx);
  if (ctx.fenceHumanOnly) {
    if (current.status !== 'pending_review' && current.status !== 'awaiting_proposal') {
      return reject('illegal', 'invalid', `settled is not legal from ${current.status}`);
    }
    return settleStopped(current, ctx);
  }
  if (current.status === 'pending_review') return settlePendingReview(current, ctx);
  if (current.status === 'awaiting_proposal') return settleAwaitingProposal(current, ctx);
  return reject('illegal', 'invalid', `settled is not legal from ${current.status}`);
}

/** UCR-07 / UCR-08c: `review_unavailable` with no active round (L16 3). */
function settleWithoutRound(
  current: UnknownCallReviewV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const items = settleItems(current.items, 'review_unavailable', ctx);
  const reasons = decisionReasons(current, items, {
    reviewUnavailable: true,
    proposalMissing: current.status === 'awaiting_proposal',
    autonomy: ctx.autonomy,
  });
  return routed(current, {
    items, activeRound: null, decisionReasons: reasons,
    dispositionTargets: dispositionTargetsOf(items),
    proposalTargets: current.status === 'awaiting_proposal' ? current.proposalTargets : proposalTargetsOf(items),
  }, 'disposition', routeFor(current, reasons, ctx), 'settled', ctx);
}

/** UCR-06b: the round was stopped by the human. */
function settleStopped(
  current: UnknownCallReviewV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const activeRound = current.activeRound!;
  const items = settleItems(current.items, 'review_stopped', ctx);
  const rounds = [...current.rounds, roundRecord(activeRound, 'stopped')];
  const reasons = decisionReasons(current, items, { reviewStopped: true, autonomy: ctx.autonomy });
  return routed(current, {
    items, rounds, activeRound: null, decisionReasons: reasons,
    dispositionTargets: dispositionTargetsOf(items) ?? current.dispositionTargets,
    proposalTargets: proposalTargetsOf(items) ?? current.proposalTargets,
  }, 'disposition', routeFor(current, reasons, ctx), 'settled', ctx);
}

/** UCR-07: settle `pending_review`. */
function settlePendingReview(
  current: UnknownCallReviewV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const activeRound = current.activeRound!;
  const second = !ctx.activeRunCompleted;
  if (second && unfinishedInStateEntry(current) === 0) {
    return reject('illegal', 'invalid', 'the first unfinished round is UCR-06 (round_unfinished), not settlement');
  }
  const cause: SettlementCause = second ? 'review_incomplete' : 'finished';
  const items = settleItems(current.items, cause, ctx);
  const rounds = [...current.rounds, roundRecord(activeRound, second ? 'unfinished' : 'finished')];
  const reasons = decisionReasons(current, items, { reviewIncomplete: second, autonomy: ctx.autonomy });
  if (reasons.length === 0) {
    return write(current, { items, rounds, activeRound: null, status: 'resolved', decisionReasons: reasons }, 'settled', ctx);
  }
  return routed(current, {
    items, rounds, activeRound: null, decisionReasons: reasons,
    dispositionTargets: dispositionTargetsOf(items), proposalTargets: proposalTargetsOf(items),
  }, 'disposition', routeFor(current, reasons, ctx), 'settled', ctx);
}

/** UCR-08: settle `awaiting_proposal`. */
function settleAwaitingProposal(
  current: UnknownCallReviewV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const activeRound = current.activeRound!;
  const second = !ctx.activeRunCompleted;
  if (second && unfinishedInStateEntry(current) === 0) {
    return reject('illegal', 'invalid', 'the first unfinished round is UCR-06 (round_unfinished), not settlement');
  }
  const cause: SettlementCause = second ? 'review_incomplete' : 'finished';
  const items = settleItems(current.items, cause, ctx);
  const rounds = [...current.rounds, roundRecord(activeRound, second ? 'unfinished' : 'finished')];
  const everyTargetProposed = everyProposalTargetHasProposal(current);
  // UCR-08 / L15-D2: a second unfinished round always reaches the person, even
  // when every target already has a proposal; `proposal_missing` is added only
  // for a target that really lacks one.
  if (!second && everyTargetProposed) {
    // Lead ruling 6: who approves is judged again at this moment with the same
    // route, from the reasons the record still stands on.
    return routed(current, { items, rounds, activeRound: null, decisionReasons: [] }, 'approval',
      routeFor(current, standingReasons(current, items, rounds, ctx), ctx), 'settled', ctx);
  }
  const reasons = decisionReasons(current, items, {
    reviewIncomplete: second, proposalMissing: !everyTargetProposed, autonomy: ctx.autonomy,
  });
  return routed(current, {
    items, rounds, activeRound: null, decisionReasons: reasons,
    dispositionTargets: dispositionTargetsOf(items) ?? current.dispositionTargets,
    proposalTargets: current.proposalTargets,
  }, 'disposition', routeFor(current, reasons, ctx), 'settled', ctx);
}

/** UCR-08b: settle the running round of a review already held via UCR-15. */
function settleHeld(
  current: UnknownCallReviewV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const activeRound = current.activeRound!;
  const result = ctx.activeRunCompleted ? 'finished' : ctx.fenceHumanOnly ? 'stopped' : 'unfinished';
  // UCR-08b / L16: a held review always names the fixed "no conclusion" evidence
  // for items still pending, whatever ended the round; the round's own `result`
  // still records finished/stopped/unfinished.
  const items = settleItems(current.items, 'finished', ctx);
  const rounds = [...current.rounds, roundRecord(activeRound, result)];
  // Status, disposition, hold, targets and reasons stay exactly as UCR-15 wrote them.
  return write(current, { items, rounds, activeRound: null, decisionReasons: [] }, 'settled', ctx);
}

/** UCR-09/UCR-10/UCR-11. */
function dispositionApplied(
  current: UnknownCallReviewV1,
  event: Extract<UnknownCallReviewEventV1, { kind: 'disposition_applied' }>,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (current.status !== 'needs_decision') {
    return reject('illegal', 'invalid', `disposition_applied is not legal from ${current.status}`);
  }
  return applyDispositionChoice(current,
    buildDisposition(current, event.choice, 'card', event.answerMessageRef, event.answeredRevision, event.text, ctx),
    'disposition_applied', ctx);
}

/** UCR-09/UCR-10/UCR-11 for one built disposition, whoever chose it (the person's card or the adviser). */
function applyDispositionChoice(
  current: UnknownCallReviewV1,
  base: UnknownCallDispositionV1,
  change: UnknownCallReviewChangeV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  switch (base.choice) {
    case 'safer_method': {
      if ((current.proposalTargets ?? []).length === 0) {
        return reject('illegal', 'invalid', 'safer_method needs a non-empty proposalTargets');
      }
      if (current.rounds.length > UNKNOWN_CALL_REVIEW_MAX_ROUNDS - 2) {
        return reject('illegal', 'invalid', 'safer_method needs at least two free round slots (L18)');
      }
      return write(current, {
        status: 'awaiting_proposal', stateEntry: current.stateEntry + 1, proposals: [],
        disposition: base, decisionReasons: [], blockedCommands: [], activeRound: null,
      }, change, ctx);
    }
    case 'skip_as_done':
      return write(current, {
        status: 'resolved', disposition: base, decisionReasons: [],
        blockedCommands: [...(ctx.blockedCommands ?? [])], activeRound: null,
      }, change, ctx);
    case 'handle_myself':
      return write(current, {
        status: 'resolved', disposition: { ...base, hold: 'held' }, decisionReasons: [],
        blockedCommands: [], activeRound: null,
      }, change, ctx);
    case 'rerun_as_is':
      return write(current, {
        status: 'resolved', disposition: base, decisionReasons: [],
        blockedCommands: [], activeRound: null,
      }, change, ctx);
  }
}

/** UCR-12/UCR-13. */
function approvalApplied(
  current: UnknownCallReviewV1,
  event: Extract<UnknownCallReviewEventV1, { kind: 'approval_applied' }>,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (current.status !== 'awaiting_approval') {
    return reject('illegal', 'invalid', `approval_applied is not legal from ${current.status}`);
  }
  return applyApprovalDecision(current, event.decision, event.answerMessageRef, event.answeredRevision,
    event.approvedMethods, 'approval_applied', ctx);
}

/** UCR-12/UCR-13 for one decision, whoever made it (the person's card or the adviser). */
function applyApprovalDecision(
  current: UnknownCallReviewV1,
  decision: 'approve' | 'decline',
  answerMessageRef: SessionMessageRef | null,
  answeredRevision: number,
  approvedMethods: UnknownCallApprovedMethodV1[] | null,
  change: UnknownCallReviewChangeV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const existing = current.disposition;
  if (existing === null) return reject('illegal', 'invalid', 'the review has no safer-method disposition to approve');
  const approval = { decision, answerMessageRef, answeredRevision, appliedBy: ctx.actor, appliedAt: ctx.updatedAt };
  if (decision === 'decline') {
    const reasons = decisionReasons(current, current.items, { proposalDeclined: true, autonomy: ctx.autonomy });
    return routed(current, {
      decisionReasons: reasons, disposition: { ...existing, approval, approvedMethods: null },
    }, 'disposition', routeFor(current, reasons, ctx), change, ctx);
  }
  return write(current, {
    status: 'resolved', decisionReasons: [],
    disposition: { ...existing, approval, approvedMethods },
    blockedCommands: [...(ctx.blockedCommands ?? [])],
  }, change, ctx);
}

/**
 * K3 layering: the adviser's answer to the record's `advice.phase`. The route
 * is judged again with the Goal's autonomy now: every step confirmed meanwhile
 * puts today's card in front of the person; a record that asks the adviser
 * first and the person second turns the answer into the card's suggestion. An
 * escalation, or a choice this record cannot take, reaches the person too;
 * otherwise the answer is applied exactly as the person's card would be, with
 * source `adviser` and the rationale as the 附言.
 */
function adviserAnswerApplied(
  current: UnknownCallReviewV1,
  event: Extract<UnknownCallReviewEventV1, { kind: 'adviser_answer_applied' }>,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (current.status !== 'awaiting_advice' || current.advice === undefined) {
    return reject('illegal', 'invalid', `adviser_answer_applied is not legal from ${current.status}`);
  }
  const { answer } = event;
  const phase = current.advice.phase;
  if (answer.phase !== phase) return reject('illegal', 'invalid', `the adviser answered the ${answer.phase} phase, not ${phase}`);
  const reasons = phase === 'approval' ? standingReasons(current, current.items, current.rounds, ctx) : current.decisionReasons;
  const route = routeFor(current, reasons, { ...ctx, adviserAvailable: true });
  if (route.to === 'person') {
    // ④: today's card; L17 adds `confirm_each_step` to the reasons the card carries.
    return routed(current, {
      decisionReasons: phase === 'disposition'
        ? UNKNOWN_CALL_DECISION_REASON_ORDER.filter(reason => current.decisionReasons.includes(reason)
          || reason === 'confirm_each_step')
        : [],
    }, phase, route, 'escalated', ctx);
  }
  if (route.to === 'adviser_then_person') return escalate(current, phase, route.cause, answer, ctx);
  if (answer.choice === 'escalate') return escalate(current, phase, 'adviser_escalated', answer, ctx);
  const advised: UnknownCallReviewV1 = { ...current, advice: { phase, answer } };
  if (phase === 'approval') {
    const decision = answer.choice as 'approve' | 'decline';
    return applyApprovalDecision(advised, decision, null, current.revision,
      decision === 'approve' ? approvedMethodsOf(current.proposals) : null, 'adviser_answer_applied', ctx);
  }
  const choice = answer.choice as 'rerun_as_is' | 'safer_method' | 'skip_as_done';
  if (choice === 'safer_method' && !unknownCallReviewSaferMethodOpen(current)) {
    return escalate(current, phase, 'adviser_failed', null, ctx);
  }
  return applyDispositionChoice(advised,
    buildDisposition(current, choice, 'adviser', null, current.revision, answer.rationale, ctx),
    'adviser_answer_applied', ctx);
}

/** K3 layering: the Workflow's escalation of an `awaiting_advice` record (no line, failed round, the second layer). */
function escalated(
  current: UnknownCallReviewV1,
  event: Extract<UnknownCallReviewEventV1, { kind: 'escalated' }>,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (current.status !== 'awaiting_advice' || current.advice === undefined) {
    return reject('illegal', 'invalid', `escalated is not legal from ${current.status}`);
  }
  if (event.suggestion !== null && event.suggestion.phase !== current.advice.phase) {
    return reject('illegal', 'invalid', `the suggestion answers the ${event.suggestion.phase} phase, not ${current.advice.phase}`);
  }
  return escalate(current, current.advice.phase, event.cause, event.suggestion, ctx);
}

/** UCR-15: the direct "I'll handle it", human only. */
function holdApplied(
  current: UnknownCallReviewV1,
  event: Extract<UnknownCallReviewEventV1, { kind: 'hold_applied' }>,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (ctx.actor.kind !== 'human') return reject('guard_failed', 'forbidden', 'only a human can hold a review');
  const direct = current.status === 'pending_review' || current.status === 'awaiting_proposal'
    || current.status === 'awaiting_advice'
    || current.status === 'needs_decision' || current.status === 'awaiting_approval';
  if (!direct) {
    const fromResolved = current.status === 'resolved' && holdOf(current) !== 'held' && ctx.originalRunSelected;
    if (!fromResolved) return reject('illegal', 'invalid', `hold_applied is not legal from ${current.status}`);
  }
  const disposition: UnknownCallDispositionV1 = {
    choice: 'handle_myself', source: 'direct', targets: current.dispositionTargets ?? [],
    answerMessageRef: null, answeredRevision: event.answeredRevision,
    appliedBy: ctx.actor, appliedAt: ctx.updatedAt, text: event.text,
    annotations: [], approval: null, approvedMethods: null, hold: 'held',
  };
  // `activeRound` is untouched: the running round finishes by UCR-04 / UCR-08b.
  return write(current, { status: 'resolved', disposition, decisionReasons: [] }, 'hold_applied', ctx);
}

/** UCR-14: the human's "continue" releases a held review. */
function holdReleased(
  current: UnknownCallReviewV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (current.activeRound !== null) return reject('guard_failed', 'busy', 'the review round is not settled');
  if (current.status !== 'resolved' || current.disposition === null || holdOf(current) !== 'held') {
    return reject('illegal', 'invalid', 'hold_released needs a resolved review whose hold is held');
  }
  if (ctx.actor.kind !== 'human') return reject('guard_failed', 'forbidden', 'only a human can release the hold');
  return write(current, { disposition: { ...current.disposition, hold: 'released' } }, 'hold_released', ctx);
}

// ------------------------------------------------------------------------ //
// Settlement helpers (L16/L17)                                               //
// ------------------------------------------------------------------------ //

type SettlementCause = 'finished' | 'review_incomplete' | 'review_unavailable' | 'review_stopped';

const NO_CONCLUSION_EVIDENCE = '核对轮没有给出结论';
const REVIEW_INCOMPLETE_EVIDENCE = '核对轮两次没做完';
const REVIEW_UNAVAILABLE_EVIDENCE = '只读命令用不了';
const REVIEW_STOPPED_EVIDENCE = '核对轮被你停下了';
const D6_EVIDENCE = '核对说明里没有这条命令的全文，按判断不了处理';
const D6_SELF_CHECK_EVIDENCE = '命令没给全，自查同样没有依据。';
const MISSING_SELF_CHECK_EVIDENCE = '没有自查依据';

function settlementEvidence(cause: SettlementCause): string {
  switch (cause) {
    case 'finished': return NO_CONCLUSION_EVIDENCE;
    case 'review_incomplete': return REVIEW_INCOMPLETE_EVIDENCE;
    case 'review_unavailable': return REVIEW_UNAVAILABLE_EVIDENCE;
    case 'review_stopped': return REVIEW_STOPPED_EVIDENCE;
  }
}

function settleItems(
  items: readonly UnknownCallReviewItemV1[],
  cause: SettlementCause,
  ctx: UnknownCallReviewContextV1,
): UnknownCallReviewItemV1[] {
  return items.map(entry => entry.kind === 'process' ? settleProcessItem(entry, cause, ctx) : entry);
}

function settleProcessItem(
  entry: UnknownCallReviewItemV1,
  cause: SettlementCause,
  ctx: UnknownCallReviewContextV1,
): UnknownCallReviewItemV1 {
  const observed = entry.observed;
  if (isConcludedProcessObservation(observed)) {
    // D6: a truncated/unexpanded command is re-judged undetermined; the model's
    // original conclusion and self-check move to `reviewerConclusion`.
    if (ctx.incompleteCommandAliases.includes(entry.alias)) {
      return { ...entry, observed: {
        verdict: 'undetermined', by: 'settlement', evidence: D6_EVIDENCE,
        roundRunRef: observed.roundRunRef,
        crashSuspicion: { verdict: 'undetermined', evidence: D6_SELF_CHECK_EVIDENCE },
        reviewerConclusion: {
          verdict: observed.verdict, evidence: observed.evidence, crashSuspicion: observed.crashSuspicion,
        },
      } };
    }
    if (ctx.missingSelfCheckAliases.includes(entry.alias)) {
      return { ...entry, observed: {
        ...observed,
        crashSuspicion: { verdict: 'undetermined', evidence: MISSING_SELF_CHECK_EVIDENCE },
      } };
    }
    return entry;
  }
  return { ...entry, observed: {
    verdict: 'undetermined', by: 'settlement', evidence: settlementEvidence(cause),
    roundRunRef: null,
    crashSuspicion: { verdict: 'undetermined', evidence: MISSING_SELF_CHECK_EVIDENCE },
    reviewerConclusion: null,
  } };
}

type DecisionReasonFlags = {
  reviewStopped?: boolean;
  reviewIncomplete?: boolean;
  reviewUnavailable?: boolean;
  proposalMissing?: boolean;
  proposalDeclined?: boolean;
  autonomy: GoalAutonomyV1;
};

/** L17: every applicable reason, written in the fixed order. */
function decisionReasons(
  review: UnknownCallReviewV1,
  items: readonly UnknownCallReviewItemV1[],
  flags: DecisionReasonFlags,
): UnknownCallDecisionReasonV1[] {
  const found = new Set<UnknownCallDecisionReasonV1>();
  const processItems = items.filter(entry => entry.kind === 'process');
  const platformUndetermined = items.some(entry => entry.kind === 'platform' && entry.observed.verdict === 'undetermined');
  if (review.inventory === 'incomplete') found.add('inventory_incomplete');
  if (flags.reviewStopped === true) found.add('review_stopped');
  if (flags.reviewIncomplete === true) found.add('review_incomplete');
  if (flags.reviewUnavailable === true) found.add('review_unavailable');
  if (processItems.some(entry => entry.observed.verdict === 'partial')) found.add('partial');
  if (processItems.some(entry => entry.observed.verdict === 'undetermined') || platformUndetermined) found.add('undetermined');
  if (processItems.some(entry => selfCheckVerdict(entry) === 'possible')) found.add('crash_possible');
  if (processItems.some(entry => selfCheckVerdict(entry) === 'undetermined')) found.add('crash_undetermined');
  if (review.streak.priorUnknownProcess && processItems.length > 0) found.add('second_consecutive');
  if (flags.autonomy === 'every_step' && processItems.length > 0) found.add('confirm_each_step');
  if (flags.proposalMissing === true) found.add('proposal_missing');
  if (flags.proposalDeclined === true) found.add('proposal_declined');
  return UNKNOWN_CALL_DECISION_REASON_ORDER.filter(reason => found.has(reason));
}

function selfCheckVerdict(entry: UnknownCallReviewItemV1): CrashSuspicionV1['verdict'] | null {
  return isConcludedProcessObservation(entry.observed) ? entry.observed.crashSuspicion.verdict : null;
}

function isConcludedProcessObservation(
  observed: UnknownCallObservationV1,
): observed is Extract<UnknownCallObservationV1, { by: 'review_round' | 'settlement' }> {
  return observed.by === 'review_round' || observed.by === 'settlement';
}

function unfinishedInStateEntry(review: UnknownCallReviewV1): number {
  return review.rounds.filter(round => round.stateEntry === review.stateEntry && round.result === 'unfinished').length;
}

function everyProposalTargetHasProposal(review: UnknownCallReviewV1): boolean {
  const targets = review.proposalTargets ?? [];
  return targets.every(callId => review.proposals.some(proposal => proposal.callId === callId));
}

function roundRecord(
  activeRound: NonNullable<UnknownCallReviewV1['activeRound']>,
  result: 'finished' | 'unfinished' | 'stopped',
): UnknownCallReviewV1['rounds'][number] {
  return {
    runRef: activeRound.runRef, phase: activeRound.phase, round: activeRound.round,
    stateEntry: activeRound.stateEntry, result,
  };
}

// ------------------------------------------------------------------------ //
// Shared helpers                                                             //
// ------------------------------------------------------------------------ //

function write(
  current: UnknownCallReviewV1,
  patch: Partial<UnknownCallReviewV1>,
  change: UnknownCallReviewChangeV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const next: UnknownCallReviewV1 = { ...current, ...patch, revision: current.revision + 1, updatedAt: ctx.updatedAt };
  next.open = openOf(next);
  return accept(next, [
    { kind: 'write_review', review: next },
    { kind: 'emit_event', change },
  ]);
}

function buildRecord(
  input: NewUnknownCallReviewInputV1,
  items: UnknownCallReviewItemV1[],
  itemsOmitted: number,
  inventory: 'complete' | 'incomplete',
  inventoryProblem: UnknownCallInventoryProblemV1 | null,
): UnknownCallReviewV1 {
  const derived = deriveCreationStatus(inventory, items);
  const record: UnknownCallReviewV1 = {
    ...input,
    schemaVersion: 1,
    revision: 1,
    inventory,
    inventoryProblem,
    items,
    itemsOmitted,
    status: derived.status,
    open: 'yes',
    decisionReasons: derived.decisionReasons,
    dispositionTargets: dispositionTargetsOf(items),
    proposalTargets: proposalTargetsOf(items),
    stateEntry: 1,
    activeRound: null,
    rounds: input.rounds ?? [],
    proposals: input.proposals ?? [],
    blockedCommands: [],
    disposition: null,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
  return { ...record, open: openOf(record) };
}

/** L9: inventory incomplete -> needs_decision; process items -> pending_review; undecided platform -> needs_decision. */
function deriveCreationStatus(
  inventory: 'complete' | 'incomplete',
  items: readonly UnknownCallReviewItemV1[],
): { status: UnknownCallReviewV1['status']; decisionReasons: UnknownCallDecisionReasonV1[] } {
  if (inventory === 'incomplete') {
    return { status: 'needs_decision', decisionReasons: ['inventory_incomplete'] };
  }
  if (items.some(entry => entry.kind === 'process')) {
    return { status: 'pending_review', decisionReasons: [] };
  }
  if (items.some(entry => entry.kind === 'platform' && entry.observed.verdict === 'undetermined')) {
    return { status: 'needs_decision', decisionReasons: ['undetermined'] };
  }
  return { status: 'resolved', decisionReasons: [] };
}

/** D7: the process items plus the platform items still undetermined. */
function dispositionTargetsOf(items: readonly UnknownCallReviewItemV1[]): string[] | null {
  const targets = items
    .filter(entry => entry.kind === 'process'
      || (entry.kind === 'platform' && entry.observed.verdict === 'undetermined'))
    .map(entry => entry.callId);
  return targets.length === 0 ? null : targets;
}

/** D7: the process items, the only ones a safer method may target. */
function proposalTargetsOf(items: readonly UnknownCallReviewItemV1[]): string[] | null {
  const targets = items.filter(entry => entry.kind === 'process').map(entry => entry.callId);
  return targets.length === 0 ? null : targets;
}

/** L7/D4: the only writer of `open`. */
function openOf(review: Pick<UnknownCallReviewV1, 'status' | 'activeRound'>): 'yes' | 'no' {
  return review.status !== 'resolved' || review.activeRound !== null ? 'yes' : 'no';
}

function holdOf(review: UnknownCallReviewV1): 'held' | 'released' | null {
  return review.disposition?.hold ?? null;
}

function buildDisposition(
  current: UnknownCallReviewV1,
  choice: UnknownCallDispositionV1['choice'],
  source: 'card' | 'adviser',
  answerMessageRef: SessionMessageRef | null,
  answeredRevision: number,
  text: string | null,
  ctx: UnknownCallReviewContextV1,
): UnknownCallDispositionV1 {
  return {
    choice, source, targets: current.dispositionTargets ?? [],
    answerMessageRef, answeredRevision,
    appliedBy: ctx.actor, appliedAt: ctx.updatedAt, text,
    annotations: [], approval: null, approvedMethods: null, hold: null,
  };
}

/** K3 layering: the route of this record from `reasons`, its streak and its disposition's source. */
function routeFor(
  current: UnknownCallReviewV1,
  reasons: readonly UnknownCallDecisionReasonV1[],
  ctx: UnknownCallReviewContextV1,
): UnknownCallReviewRouteV1 {
  return unknownCallReviewRouteOf({ reasons, streak: current.streak, autonomy: ctx.autonomy,
    adviserAvailable: ctx.adviserAvailable === true, dispositionSource: current.disposition?.source ?? null });
}

/**
 * Lead ruling 6: the reasons an approval is routed by are those the record
 * still stands on (its items, inventory, streak and autonomy), plus
 * `review_stopped` when the person stopped one of its rounds.
 */
function standingReasons(
  current: UnknownCallReviewV1,
  items: readonly UnknownCallReviewItemV1[],
  rounds: UnknownCallReviewV1['rounds'],
  ctx: UnknownCallReviewContextV1,
): UnknownCallDecisionReasonV1[] {
  return decisionReasons(current, items, {
    reviewStopped: rounds.some(round => round.result === 'stopped'), autonomy: ctx.autonomy,
  });
}

/**
 * K3 layering: one routed write. The adviser routes enter `awaiting_advice`
 * for `phase`; the person's route is written by `toPerson` with the route's
 * escalation.
 */
function routed(
  current: UnknownCallReviewV1,
  patch: Partial<UnknownCallReviewV1>,
  phase: UnknownCallAdvicePhaseV1,
  route: UnknownCallReviewRouteV1,
  change: UnknownCallReviewChangeV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  if (route.to !== 'person') {
    return write(current, { ...patch, status: 'awaiting_advice', advice: { phase, answer: null } }, change, ctx);
  }
  return toPerson(current, patch, phase,
    route.cause === null ? route.escalation : { cause: route.cause, suggestion: null }, change, ctx);
}

/** K3 layering: the second layer, written from `awaiting_advice` for `phase`. */
function escalate(
  current: UnknownCallReviewV1,
  phase: UnknownCallAdvicePhaseV1,
  cause: UnknownCallEscalationCauseV1,
  suggestion: UnknownCallAdviceV1 | null,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  return toPerson(current, {}, phase, { cause, suggestion }, 'escalated', ctx);
}

/**
 * K3 layering: the one write that puts the record in front of the person,
 * `needs_decision` for a disposition or `awaiting_approval` for an approval.
 * Today's card drops an older escalation (`clear`), so a card the person
 * reaches again by stopping a round is not shown as the second layer; the
 * person's own method coming back keeps the record's (`keep`); the second
 * layer writes its new escalation.
 */
function toPerson(
  current: UnknownCallReviewV1,
  patch: Partial<UnknownCallReviewV1>,
  phase: UnknownCallAdvicePhaseV1,
  escalation: 'clear' | 'keep' | NonNullable<UnknownCallReviewV1['escalation']>,
  change: UnknownCallReviewChangeV1,
  ctx: UnknownCallReviewContextV1,
): Transition<UnknownCallReviewV1, UnknownCallReviewEventV1, UnknownCallReviewEffectV1> {
  const status = phase === 'disposition' ? 'needs_decision' : 'awaiting_approval';
  if (escalation === 'keep') return write(current, { ...patch, status }, change, ctx);
  if (escalation !== 'clear') return write(current, { ...patch, status, escalation }, change, ctx);
  const cleared: UnknownCallReviewV1 = { ...current };
  delete cleared.escalation;
  return write(cleared, { ...patch, status }, change, ctx);
}

/**
 * L20/lead answer 5: the byte budget is measured in alias-ascending order (the
 * record's item order), whatever order the caller's array happens to have.
 */
function approvedMethodsBytes(
  methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>,
): number {
  const ordered = [...methods].sort((left, right) => left.alias - right.alias);
  return Buffer.byteLength(approvedMethodLinesZh(ordered).join('\n'), 'utf8');
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function validateRounds(rounds: readonly unknown[]): Rejected | null {
  if (rounds.length > UNKNOWN_CALL_REVIEW_MAX_ROUNDS) {
    return reject('illegal', 'invalid', `a review holds at most ${UNKNOWN_CALL_REVIEW_MAX_ROUNDS} rounds`);
  }
  return null;
}

function validateItemAliases(items: readonly UnknownCallReviewItemV1[]): Rejected | null {
  if (items.length > UNKNOWN_CALL_REVIEW_MAX_ITEMS) {
    return reject('illegal', 'invalid', `a review holds at most ${UNKNOWN_CALL_REVIEW_MAX_ITEMS} items`);
  }
  for (const [index, entry] of items.entries()) {
    if (entry.alias !== index + 1) {
      return reject('illegal', 'invalid',
        `item aliases must be 1..n in Kernel order (got #${entry.alias} at position ${index})`);
    }
  }
  return null;
}
