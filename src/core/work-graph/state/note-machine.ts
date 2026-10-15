/**
 * Slice 4 §3 (S4-NOTE-01…08, 10): the pure note state machine. It decides the
 * admission status of a new note and the target state of a disposition; it
 * never reads storage, mints ids or reads a clock. The owner service
 * (`notes/note-service.ts`) reads the current head and version, calls this
 * machine and writes the returned `next` plus the events in ONE RecordStore
 * commit (AGENTS.md rule 9). S4-NOTE-09 (`staged → accepted`) is slice 8 and is
 * deliberately absent.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type {
  NoteBodyV1, NoteHeadSnapshot, NoteKind, NoteReviewReason, NoteState, NoteVersionSnapshot, CurrentPointerSnapshot,
  PendingNoteHeadSnapshot, PendingNoteVersionSnapshot,
} from '../../../contracts/note.js';
import { accept, reject, type Rejected, type Transition } from './transition.js';

// --------------------------------------------------------------------------
// S4-NOTE-01/02/03: admission of a new note (L4, L5, L6, L7)
// --------------------------------------------------------------------------

export type NoteWriteFactsV1 = {
  kind: NoteKind;
  structural: boolean;
  contradicts: readonly string[];
  /** The projected anchor quota is full (general kinds only, L7/R6). */
  anchorFull: boolean;
  /** The projected goal activity quota is full (every kind, L7/R6). */
  goalFull: boolean;
  /** The trusted caller is the human user (L5); the user's write never waits on quota. */
  isUser: boolean;
};

export type NoteWriteAdmissionV1 =
  | { status: 'accepted'; state: 'accepted'; reviewReasons: readonly NoteReviewReason[]; overQuota: boolean;
      confirmedByUser: boolean }
  | { status: 'pending_review'; state: 'pending_review'; reviewReasons: NoteReviewReason[]; overQuota: boolean;
      confirmedByUser: false }
  | { status: 'staged'; state: 'staged'; reviewReasons: readonly NoteReviewReason[]; overQuota: boolean;
      confirmedByUser: false };

/**
 * S4-NOTE-01/02/03. A repair is always `staged`. For every other kind an agent's
 * note is `pending_review` when it is structural, contradicts a current note or
 * the projected quota is full (all hit reasons are kept, L7); the user's note is
 * always `accepted` and merely reports `overQuota` (L5, L6).
 *
 * R6 (item 8): each quota flags its own population. `overQuota = goalFull ||
 * (anchorFull && state === 'accepted')`, so a pending note at a full anchor
 * reports `overQuota: false` with reason `quota_full`, and a repair is staged
 * with `overQuota = goalFull`.
 */
export function admitNoteWrite(facts: NoteWriteFactsV1): NoteWriteAdmissionV1 {
  const quotaFull = facts.anchorFull || facts.goalFull;
  if (facts.kind === 'repair') {
    return { status: 'staged', state: 'staged', reviewReasons: [], overQuota: facts.goalFull, confirmedByUser: false };
  }
  if (facts.isUser) {
    return { status: 'accepted', state: 'accepted', reviewReasons: [],
      overQuota: facts.anchorFull || facts.goalFull, confirmedByUser: true };
  }
  const reviewReasons: NoteReviewReason[] = [];
  if (facts.structural) reviewReasons.push('structural');
  if (facts.contradicts.length > 0) reviewReasons.push('contradiction');
  if (quotaFull) reviewReasons.push('quota_full');
  if (reviewReasons.length > 0) {
    return { status: 'pending_review', state: 'pending_review', reviewReasons,
      overQuota: facts.goalFull, confirmedByUser: false };
  }
  return { status: 'accepted', state: 'accepted', reviewReasons: [],
    overQuota: facts.anchorFull || facts.goalFull, confirmedByUser: false };
}

/**
 * L5: only an agent or a scribe stages a repair. A human repair and a
 * secretary's repair are refused at the source step (L4 step 2), before any
 * record gate runs; `admitNoteWrite` never sees them (item 9a).
 */
export function noteWriteAuthority(facts: { kind: NoteKind; isUser: boolean; duty: string | null }):
Extract<Rejected, { ok: false }> | null {
  if (facts.kind === 'repair' && (facts.isUser || facts.duty === 'secretary')) {
    return reject('guard_failed', 'forbidden',
      'only an agent or a scribe stages a repair') as Extract<Rejected, { ok: false }>;
  }
  return null;
}

// --------------------------------------------------------------------------
// Record constructors (the only writers of the protected lifecycle fields)
// --------------------------------------------------------------------------

export type NewNoteHeadInputV1 = {
  ref: NoteHeadSnapshot['ref'];
  noteId: string;
  body: NoteBodyV1;
  state: NoteState;
  goalId: string | null;
  source: NoteHeadSnapshot['source'];
  stagedRunKey: string | null;
  reviewReasons: readonly NoteReviewReason[];
  confirmedByUser: boolean;
  anchorKeys: readonly [string, string | null, string | null, string | null, string | null];
  createdAt: string;
  /** Pre-bind placeholder; the Store binds the creating commit cursor. */
  since: CommitCursor | null;
};

/** S4-NOTE-01/02/03 constructor: version 1. */
export function newNoteHeadRecord(input: NewNoteHeadInputV1): PendingNoteHeadSnapshot {
  return {
    ...input.body,
    ref: input.ref,
    noteId: input.noteId,
    version: 1,
    state: input.state,
    goalId: input.goalId,
    source: input.source,
    stagedRunKey: input.stagedRunKey,
    reviewReasons: [...input.reviewReasons],
    confirmedByUser: input.confirmedByUser,
    anchorKey0: input.anchorKeys[0],
    anchorKey1: input.anchorKeys[1],
    anchorKey2: input.anchorKeys[2],
    anchorKey3: input.anchorKeys[3],
    anchorKey4: input.anchorKeys[4],
    createdAt: input.createdAt,
    since: input.since,
  };
}

export type NoteVersionChangeV1 = NoteVersionSnapshot['change'];

/** Constructor of the immutable per-version row for one change of the head. */
export function newNoteVersionRecord(head: PendingNoteHeadSnapshot,
  change: NoteVersionChangeV1, at: string): PendingNoteVersionSnapshot {
  return {
    ...noteBodyOf(head),
    ref: { aggregateType: 'NoteVersion', projectId: head.ref.projectId, noteId: head.noteId, version: head.version },
    noteId: head.noteId,
    version: head.version,
    state: head.state,
    goalId: head.goalId,
    source: head.source,
    reviewReasons: [...head.reviewReasons],
    change,
    at,
    since: null,
  };
}

/** The body fields of a head, with `sections` kept only when the kind carries it. */
export function noteBodyOf(head: PendingNoteHeadSnapshot): NoteBodyV1 {
  const body: NoteBodyV1 = {
    kind: head.kind,
    topic: head.topic,
    topicKey: head.topicKey,
    conclusion: head.conclusion,
    body: head.body,
    anchor: head.anchor,
    extraAnchors: head.extraAnchors,
    facts: head.facts,
    basis: head.basis,
    structural: head.structural,
    replaces: head.replaces,
    contradicts: head.contradicts,
    coexistWith: head.coexistWith,
  };
  if (head.sections !== undefined) body.sections = head.sections;
  return body;
}

// --------------------------------------------------------------------------
// S4-NOTE-04…08, 10: disposition transitions
// --------------------------------------------------------------------------

export type NoteDispositionEventV1 =
  | { kind: 'review'; by: 'scribe' | 'user' }                                  // S4-NOTE-04
  | { kind: 'accept'; by: 'scribe' | 'user'; reasons: readonly NoteReviewReason[]; reason: string | null }   // S4-NOTE-05
  | { kind: 'reject'; by: 'scribe' | 'user'; reasons: readonly NoteReviewReason[]; reason: string | null }   // S4-NOTE-06
  | { kind: 'withdraw' }                                                        // S4-NOTE-07
  | { kind: 'supersede' }                                                       // S4-NOTE-08
  | { kind: 'coexist'; by: 'user' };                                            // S4-NOTE-10

const OPEN_STATES: readonly NoteState[] = ['staged', 'accepted', 'reviewed', 'pending_review'];

/**
 * The pure guard. `next` is the head after the change: version + 1, the target
 * state, cleared/retained reasons and the `confirmedByUser` rule of L1 (the user
 * reviews, accepts or rejects → true).
 */
export function transitionNote(head: NoteHeadSnapshot, event: NoteDispositionEventV1):
Transition<PendingNoteHeadSnapshot, NoteDispositionEventV1, never> {
  const shared = sharedProblem(head, event);
  if (shared !== null) return shared;
  switch (event.kind) {
    case 'review':
      return accept(bumped(head, 'reviewed', [], event.by === 'user' ? true : head.confirmedByUser));
    case 'accept':
      return accept(bumped(head, 'accepted', [], event.by === 'user' ? true : head.confirmedByUser));
    case 'reject':
      return accept(bumped(head, 'rejected', [], event.by === 'user' ? true : head.confirmedByUser));
    case 'withdraw':
      return accept(bumped(head, 'withdrawn', [], head.confirmedByUser));
    case 'supersede':
      return accept(bumped(head, 'superseded', [], head.confirmedByUser));
    case 'coexist':
      return accept(bumped(head, 'accepted', [], true));
  }
}

/** Row/authority guards, in the order of §3. */
function sharedProblem(head: NoteHeadSnapshot, event: NoteDispositionEventV1): Rejected | null {
  switch (event.kind) {
    case 'review':
      if (head.state !== 'accepted') return illegal(head, 'review', 'accepted');
      return null;
    case 'accept':
    case 'reject': {
      if (head.state !== 'pending_review') return illegal(head, event.kind, 'pending_review');
      const userOnly = event.reasons.some(reason => reason === 'structural' || reason === 'contradiction');
      if (userOnly && event.by !== 'user') {
        return reject('guard_failed', 'forbidden',
          'a structural/contradiction note is accepted or rejected only by the user');
      }
      if (event.reason === null || event.reason.trim().length === 0) {
        return reject('guard_failed', 'invalid', 'accepting or rejecting a pending note requires a reason');
      }
      return null;
    }
    case 'withdraw':
      if (!OPEN_STATES.includes(head.state)) return illegal(head, 'withdraw', OPEN_STATES.join('|'));
      return null;
    case 'supersede':
      if (head.state !== 'accepted' && head.state !== 'reviewed') return illegal(head, 'supersede', 'accepted|reviewed');
      return null;
    case 'coexist':
      if (head.state !== 'pending_review') return illegal(head, 'coexist', 'pending_review');
      return null;
  }
}

function illegal(head: NoteHeadSnapshot, event: string, allowed: string): Rejected {
  return reject('illegal', 'invalid', `cannot ${event} a ${head.state} note (allowed: ${allowed})`);
}

/** S4-NOTE end: version + 1, target state, reasons and confirmation. */
function bumped(head: NoteHeadSnapshot, state: NoteState, reviewReasons: readonly NoteReviewReason[],
  confirmedByUser: boolean): PendingNoteHeadSnapshot {
  // Item 11(a): the decoded head still carries the wire-only envelope `revision`;
  // drop it so an event snapshot has the stable NoteHead shape. L3: only a
  // `staged` head keeps its staging run, every other state clears it.
  const { revision: _revision, ...rest } = head as NoteHeadSnapshot & { revision?: number };
  return { ...rest, version: head.version + 1, state, stagedRunKey: state === 'staged' ? head.stagedRunKey : null,
    reviewReasons: [...reviewReasons], confirmedByUser, since: null };
}

// --------------------------------------------------------------------------
// CurrentPointer (L8)
// --------------------------------------------------------------------------

/** The first pointer record has revision 1; an absent pointer reads `{ null, null }`. */
export function newCurrentPointerRecord(ref: CurrentPointerSnapshot['ref'], anchorKey: string,
  noteId: string | null): CurrentPointerSnapshot {
  return { ref, anchorKey, noteId, revision: 1 };
}

/** Each move adds 1 (L8); the guard is the caller's `expectedPointerRevision`. */
export function moveCurrentPointerRecord(pointer: CurrentPointerSnapshot, noteId: string | null): CurrentPointerSnapshot {
  return { ...pointer, noteId, revision: pointer.revision + 1 };
}
