import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  DecisionSourceV1, GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { decisionSubjectGoalRef } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import { isRecord } from '../../../../contracts/validation/common.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import { clonePins, samePinSet } from './read-support.js';
import type { SourceDependencies, SourceReadResult, SourceReadSupport } from './types.js';

/** The `note_review` decision source: the note head and the notes owner's card facts. */
export async function readNoteReviewSource(
  support: SourceReadSupport,
  ctx: CoreCallContext,
  source: DecisionSourceV1,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'note_review' }>,
  deps: SourceDependencies,
  goalRef: GoalRef | null,
): Promise<SourceReadResult> {
  // A goal subject loads and checks its Goal. A project subject (null) has no
  // Goal at all: the note head's own `goalId: null` decides.
  let goal: GoalSnapshot | null = null;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  let allowedReaderSessionRefs: SessionRef[] = [];
  // The source key pins the note head; the card facts come from the
  // notes owner's port. An absent port/stale read is never an empty source.
  const rawNoteRef: unknown = identity.note.ref;
  const noteProblem = support.scopeProblem(rawNoteRef);
  if (noteProblem !== null) return noteProblem;
  if (!isRecord(rawNoteRef)) return rejectedWithCurrent('invalid', 'the note_review source pin names no note');
  const noteId = rawNoteRef['noteId'];
  if (typeof noteId !== 'string' || noteId.length === 0) {
    return rejectedWithCurrent('invalid', 'the note_review source pin names no note');
  }
  if (goalRef !== null) {
    const goalProblem = support.scopeProblem(goalRef);
    if (goalProblem !== null) return goalProblem;
    const goalRead = await support.readGoal(goalRef);
    if (goalRead.status !== 'ready') return goalRead;
    goal = goalRead.value;
    if (goal.workspaceRef.projectId !== support.scope.projectId || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
      return rejectedWithCurrent('forbidden', 'the note_review source Goal is outside the bound scope');
    }
  }
  if (deps.noteDecisions === undefined) {
    return rejectedWithCurrent('unavailable', 'no note-decision reader is bound for a note_review source');
  }
  const noteRead = await deps.noteDecisions.readNoteDecision(ctx, {
    pin: { noteId, version: identity.note.revision },
  });
  if (noteRead.status !== 'ready') {
    return rejectedWithCurrent('unavailable', noteRead.status === 'rejected'
      ? noteRead.reason : 'the note decision is not readable');
  }
  const card = noteRead.value.card;
  const closedReason = noteRead.value.closedReason;
  const noteSubject = noteRead.value.subject;
  if (noteSubject === null || (card === null && closedReason === null)) {
    // §slice-4/L17: the note moved after the card was read; nothing
    // recorded. The code is the CoreRejection `source_stale`.
    return rejectedWithCurrent('source_stale', 'source_stale');
  }
  // The note's own subject decides, open or closed, before anything else: a
  // goal subject answers only its own Goal's note, a project subject only a
  // goal-less note, so another subject's closed reason never closes this one.
  const noteGoalId = decisionSubjectGoalRef({ subject: noteSubject })?.goalId ?? null;
  if (goalRef !== null) {
    if (noteGoalId !== goalRef.goalId) {
      return rejectedWithCurrent('invalid', 'the note decision card belongs to another Goal');
    }
  } else if (noteGoalId !== null) {
    return rejectedWithCurrent('invalid', 'the note decision card belongs to a Goal, not the project');
  }
  // Compare the REQUEST's captured pins (the head and,
  // for an understanding, the CurrentPointer) with the fresh card;
  // one set comparison catches a moved head, a moved pointer and a
  // new pointer. A mismatch is `source_stale`, never a silent
  // replacement of the request pins.
  if (card !== null && !samePinSet(source.pins, card.pins)) {
    return rejectedWithCurrent('source_stale', 'source_stale');
  }
  closed = closedReason !== null;
  if (card !== null) {
    pins = clonePins(card.pins);
    objects = card.objects.map((object) => structuredClone(object));
    options = card.options.map((option) => structuredClone(option));
  }
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
