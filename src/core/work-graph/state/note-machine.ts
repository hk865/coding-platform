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
  /**
   * C3.3 (§11.6): only the `contradicts` targets that are accepted or reviewed at
   * write time count. A note that only contradicts a no-longer-current target is
   * admitted like any other (D-04).
   */
  contradicts: readonly string[];
  /** C3.3 (§11.1 item 6): the superseded set holds a current user-confirmed note. */
  userNoteReplaced: boolean;
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
  // C3.4 (§11.1 item 7): only an `understanding` keeps the structural reason. An
  // agent's structural GENERAL note is admitted like any other (header keeps `!`).
  if (facts.structural && facts.kind === 'understanding') reviewReasons.push('structural');
  if (facts.contradicts.length > 0) reviewReasons.push('contradiction');
  if (facts.userNoteReplaced) reviewReasons.push('user_note_replaced');
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
// The pure scope of a secretary QueryRun's note
// --------------------------------------------------------------------------

/** The trusted facts one QueryRun note's scope is decided from. */
export type SecretaryNoteScopeFactsV1 = {
  kind: NoteKind;
  /** The understanding's main-anchor kind; `null` for a non-understanding. */
  target: 'goal' | 'stage' | 'project' | null;
  /** Every goal the main anchor and the extra anchors name, in order. */
  anchorGoalIds: readonly string[];
  mainAnchorGoalId: string | null;
  /** The round's frozen preparation; `null` in a no-goal round. */
  effectiveGoalId: string | null;
  /** The Goal set a still-live `request_understanding` command grants (never the effective goal). */
  grantedGoalIds: readonly string[];
};

const everyGoalIs = (anchorGoalIds: readonly string[], goalId: string): boolean =>
  anchorGoalIds.every(anchorGoalId => anchorGoalId === goalId);

const scopeRefusal = (code: 'forbidden' | 'invalid', detail: string): Extract<Rejected, { ok: false }> =>
  reject('guard_failed', code, detail) as Extract<Rejected, { ok: false }>;

/**
 * Where a secretary QueryRun's note may hang and what goal it stores. A plain
 * note's range and `storedGoalId` follow the round's frozen effective goal
 * (`null` in a no-goal round, whose anchors may only be project, module,
 * interface or file). A goal or stage understanding stays inside the effective
 * goal; only a Goal a live `request_understanding` command grants may be a goal
 * understanding's main anchor, with every anchor inside it. A repair, a project
 * understanding and an understanding on anything else are refused. A malformed
 * value never silently becomes a stored goal.
 */
export function secretaryNoteScope(facts: SecretaryNoteScopeFactsV1):
{ storedGoalId: string | null } | Extract<Rejected, { ok: false }> {
  if (facts.kind === 'repair') {
    // L5: the secretary's repair keeps the ONE authority refusal, not a copy of its text.
    const authority = noteWriteAuthority({ kind: facts.kind, isUser: false, duty: 'secretary' });
    if (authority !== null) return authority;
  }
  if (facts.kind === 'understanding') {
    if (facts.target === 'project') return scopeRefusal('forbidden', 'project_understanding_scribe_only');
    const main = facts.mainAnchorGoalId;
    if (facts.target === 'goal') {
      if (main !== null && facts.grantedGoalIds.includes(main)) {
        return everyGoalIs(facts.anchorGoalIds, main) ? { storedGoalId: main }
          : scopeRefusal('forbidden', 'anchor_out_of_goal');
      }
      if (main !== null && facts.effectiveGoalId !== null && main === facts.effectiveGoalId
        && everyGoalIs(facts.anchorGoalIds, main)) {
        return { storedGoalId: main };
      }
      return scopeRefusal('forbidden', 'anchor_out_of_goal');
    }
    if (facts.target === 'stage') {
      if (main !== null && main === facts.effectiveGoalId && everyGoalIs(facts.anchorGoalIds, main)) {
        return { storedGoalId: facts.effectiveGoalId };
      }
      return scopeRefusal('forbidden', 'anchor_out_of_goal');
    }
    return scopeRefusal('invalid', 'an understanding may only hang on a goal, a stage or the project');
  }
  if (facts.effectiveGoalId === null) {
    return facts.anchorGoalIds.length === 0 ? { storedGoalId: null }
      : scopeRefusal('forbidden', 'anchor_out_of_goal');
  }
  return everyGoalIs(facts.anchorGoalIds, facts.effectiveGoalId) ? { storedGoalId: facts.effectiveGoalId }
    : scopeRefusal('forbidden', 'anchor_out_of_goal');
}

// --------------------------------------------------------------------------
// C3.2 (§11.6): the live user-reason set, per actual disposition target
// --------------------------------------------------------------------------

/** One actual disposition target's live facts (read at read/commit time). */
export type NoteUserReasonTargetV1 = {
  noteId: string;
  version: number;
  state: NoteState;
  userConfirmed: boolean;
  userWritten: boolean;
  primaryAnchorRetiredNonFile: boolean;
};

/**
 * §11.6: the ACTUAL disposition target set of a pending note, in order:
 * `(replaces − coexistWith) ∪ contradicts`, deduplicated, never the note
 * itself. The scribe's resolution path narrows this to the live contradicted
 * targets; the user's card application uses the whole set (4C-2 item 4).
 */
export function actualDispositionTargets(head: Pick<NoteHeadSnapshot,
  'replaces' | 'contradicts' | 'coexistWith'>): string[] {
  const coexisting = new Set(head.coexistWith);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const noteId of head.replaces) {
    if (coexisting.has(noteId) || seen.has(noteId)) continue;
    seen.add(noteId);
    ids.push(noteId);
  }
  for (const noteId of head.contradicts) {
    if (seen.has(noteId)) continue;
    seen.add(noteId);
    ids.push(noteId);
  }
  return ids;
}

/**
 * §11.6/decision 68: the ONE pure function that decides whether a pending note
 * still concerns the user. It is computed from the ACTUAL disposition targets
 * (`replaces` minus `coexistWith`, plus `contradicts`) and their live facts —
 * never from the stored `reviewReasons` (those stay as history). A result that
 * is not empty means only the user may accept or reject it; the scribe's
 * reminders count only the notes with an empty result.
 *
 * - `structural`: only an `understanding` can carry it (C3.4).
 * - `contradiction`: a contradicted target is accepted/reviewed, its primary
 *   anchor is not retired for a non-file reason, and it is user-confirmed or
 *   user-written.
 * - `user_note_replaced`: the superseded set (replaces minus coexistWith) holds a
 *   current user-confirmed note; an understanding is excepted (§11.1 item 6).
 */
export function userReasonsOf(head: Pick<NoteHeadSnapshot,
  'kind' | 'structural' | 'replaces' | 'contradicts' | 'coexistWith'>,
  targets: readonly NoteUserReasonTargetV1[]): NoteReviewReason[] {
  const reasons: NoteReviewReason[] = [];
  if (head.structural && head.kind === 'understanding') reasons.push('structural');
  const byId = new Map(targets.map(target => [target.noteId, target]));
  const current = (target: NoteUserReasonTargetV1 | undefined): boolean =>
    target !== undefined && (target.state === 'accepted' || target.state === 'reviewed')
    && !target.primaryAnchorRetiredNonFile;
  if (head.contradicts.some(noteId => {
    const target = byId.get(noteId);
    return current(target) && (target!.userConfirmed || target!.userWritten);
  })) reasons.push('contradiction');
  if (head.kind !== 'understanding') {
    const coexisting = new Set(head.coexistWith);
    if (head.replaces.some(noteId => {
      if (coexisting.has(noteId)) return false;
      const target = byId.get(noteId);
      return current(target) && target!.userConfirmed;
    })) reasons.push('user_note_replaced');
  }
  return reasons;
}

// --------------------------------------------------------------------------
// C3.3/D-15 (§11.4, §11.6, U-8): the overridden pending understanding
// --------------------------------------------------------------------------

/**
 * §11.4/§11.5/D-15, ruling U-8: a pending understanding is overridden by a
 * NEWER current version of the same primary anchor. `userReasonsOf` returns
 * `structural` for a structural understanding unconditionally, so the reminder
 * count (and session B's card gate) must use this predicate, not "no user
 * reasons" alone: such a pending note stays a scribe to-do but produces no card.
 *
 * True iff `pending` is an `understanding` in `pending_review`, `current` is
 * non-null, is `accepted` or `reviewed`, has the same `anchorKey0`, and was
 * created strictly after the pending one. Otherwise false (including
 * `current === null`).
 */
export function pendingUnderstandingOverridden(pending: NoteHeadSnapshot, current: NoteHeadSnapshot | null): boolean {
  return pending.kind === 'understanding'
    && pending.state === 'pending_review'
    && current !== null
    && (current.state === 'accepted' || current.state === 'reviewed')
    && current.anchorKey0 === pending.anchorKey0
    && current.createdAt > pending.createdAt;
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

/**
 * 4C-2 §2/§11.6 item 5: the facts the ONE pure notice classifier reads. The
 * writer computes `userAffected`/`sideEffect` from the facts of ITS OWN commit
 * (the current targets it actually supersedes/withdraws); the classifier itself
 * reads no storage.
 */
export type NoteNoticeClassFactsV1 = {
  change: NoteVersionChangeV1;
  /** The version's resulting head state. */
  state: NoteState;
  kind: NoteKind;
  structural: boolean;
  /** This version superseded, withdrew or rewrote a note the user wrote or confirmed. */
  userAffected?: boolean;
  /** A side-effect version written for a superseded/withdrawn TARGET (never the acting version). */
  sideEffect?: boolean;
};

/**
 * 4C-2 U9 (task book §2 item 5, lead ruling 7): the ONE pure notice classifier,
 * precedence `user_affected` > `structural` > `scribe_result`:
 * - `user_affected`: any agent version that superseded, withdrew or rewrote a
 *   note the user wrote or confirmed (today: an agent's understanding replacing
 *   the user-confirmed current understanding);
 * - `structural`: an agent's structural ordinary note accepted (either the
 *   accepted write itself or its accept disposition); an understanding/repair is
 *   never "ordinary";
 * - `scribe_result`: any other disposition by a scribe (`accept`, `reject`,
 *   `withdraw`, `supersede`, `coexist`, `merge`; never `write`, never `review`);
 * - `null`: the user's own versions, reviews, the platform, and every side-effect
 *   version written for a superseded target.
 */
export function noticeClassOf(facts: NoteNoticeClassFactsV1): NoteVersionSnapshot['noticeClass'] {
  const by = facts.change.by;
  if (by.kind !== 'agent') return null;
  if (facts.sideEffect === true) return null;
  if (facts.userAffected === true) return 'user_affected';
  const ordinary = facts.kind !== 'understanding' && facts.kind !== 'repair';
  if (facts.structural && ordinary
    && (facts.change.kind === 'accept' || (facts.change.kind === 'write' && facts.state === 'accepted'))) {
    return 'structural';
  }
  const disposition = facts.change.kind === 'accept' || facts.change.kind === 'reject'
    || facts.change.kind === 'withdraw' || facts.change.kind === 'supersede'
    || facts.change.kind === 'coexist' || facts.change.kind === 'merge';
  if (by.duty === 'scribe' && disposition) return 'scribe_result';
  return null;
}

/** Constructor of the immutable per-version row for one change of the head. */
export function newNoteVersionRecord(head: PendingNoteHeadSnapshot,
  change: NoteVersionChangeV1, at: string,
  noticeClass: NoteVersionSnapshot['noticeClass'] = null): PendingNoteVersionSnapshot {
  return {
    ...noteBodyOf(head),
    ref: { aggregateType: 'NoteVersion', projectId: head.ref.projectId, noteId: head.noteId, version: head.version },
    noteId: head.noteId,
    version: head.version,
    state: head.state,
    goalId: head.goalId,
    source: head.source,
    reviewReasons: [...head.reviewReasons],
    noticeClass,
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
  | { kind: 'accept'; by: 'scribe' | 'user'; reasons: readonly NoteReviewReason[]; reason: string | null;
      resolution?: 'supersede' | 'coexist'; targets?: readonly string[] }        // S4-NOTE-05
  | { kind: 'reject'; by: 'scribe' | 'user'; reasons: readonly NoteReviewReason[]; reason: string | null }   // S4-NOTE-06
  | { kind: 'withdraw' }                                                        // S4-NOTE-07
  | { kind: 'supersede' }                                                       // S4-NOTE-08
  | { kind: 'coexist'; by: 'scribe' | 'user' };                                 // S4-NOTE-10

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
      return accept(applyAcceptResolution(bumped(head, 'accepted', [],
        event.by === 'user' ? true : head.confirmedByUser), event));
    case 'reject':
      return accept(bumped(head, 'rejected', [], event.by === 'user' ? true : head.confirmedByUser));
    case 'withdraw':
      return accept(bumped(head, 'withdrawn', [], head.confirmedByUser));
    case 'supersede':
      return accept(bumped(head, 'superseded', [], head.confirmedByUser));
    case 'coexist':
      return accept(bumped(head, 'accepted', [], event.by === 'user' ? true : head.confirmedByUser));
  }
}

/**
 * S4-NOTE-05/08/10: an accept with a `resolution` rewrites the accepted head's
 * relations in the SAME commit — `supersede` moves the live contradicted targets
 * into `replaces`, `coexist` into `coexistWith`, and in both cases removes them
 * from `contradicts`; the supersession builder then acts on the rewritten head.
 */
function applyAcceptResolution(head: PendingNoteHeadSnapshot,
  event: Extract<NoteDispositionEventV1, { kind: 'accept' }>): PendingNoteHeadSnapshot {
  if (event.resolution === undefined) return head;
  const targets = event.targets ?? [];
  const contradicts = head.contradicts.filter(noteId => !targets.includes(noteId));
  if (event.resolution === 'supersede') {
    // RW-4: a target that was also listed in `coexistWith` moves to `replaces`
    // and is removed from `coexistWith`, so `supersessionTargetsOf` supersedes it
    // instead of skipping it.
    const coexistWith = head.coexistWith.filter(noteId => !targets.includes(noteId));
    return { ...head, contradicts, coexistWith, replaces: dedupe([...head.replaces, ...targets]) };
  }
  return { ...head, contradicts, coexistWith: dedupe([...head.coexistWith, ...targets]) };
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
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
      // C3.2/§11.6: `event.reasons` is now the LIVE `userReasonsOf` set, never the
      // stored `reviewReasons`. Any user reason means only the user may decide.
      if (event.reasons.length > 0 && event.by !== 'user') {
        return reject('guard_failed', 'forbidden',
          'a note with a user reason is accepted or rejected only by the user');
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
