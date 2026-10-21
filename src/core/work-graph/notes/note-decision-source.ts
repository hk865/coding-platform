/**
 * Slice 4C-2 §2/L17, §11.6, lead rulings 1–3/5: the note-card decision source.
 *
 * The notes owner implements `NoteDecisionSourcePort` here; communication and
 * business consume it but never import `notes/`. It reads:
 * - the Goal's window (cancel gate) once per call;
 * - the Goal's `pending_review` bucket in ONE index scan;
 * - every pending note's ACTUAL relation targets in ONE batched head read;
 * - the anchors' current pointers and pointed heads in ONE batched read;
 * - the targets' live anchor status through the note service's batched
 *   `userReasonFacts` (ONE NoteCall, the SAME per-head facts the guard uses).
 *
 * Gate order (§11.6, the note card's own):
 *  (1) the Goal is cancelled -> no card (closed `goal_cancelled`);
 *  (2) answered/pending-application is the slice-5 adapter's state, so this
 *      port still returns the waiting projection for an answered card;
 *  (3) the live `userReasonsOf` set is empty, or a pending understanding is
 *      overridden by a newer current version -> no card (closed `source_resolved`);
 *  (4) otherwise one `NoteDecisionCardFactsV1` (the port's answer type; §2's
 *      `NoteDecisionCardV1` cannot carry pins/objects/options).
 * A note with `goalId: null` never gets a card (D-09). A failed read is
 * `unavailable`, never an empty list.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { NoteHeadSnapshot } from '../../../contracts/note.js';
import { renderNoteHeader } from '../../../contracts/note.js';
import type { DecisionObjectV1, DecisionOptionV1 } from '../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../contracts/goal-decisions.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { NoteDecisionApplicationInputV1, NoteDecisionApplyPort } from '../model/note-contracts.js';
import type {
  DecisionSourceAttempt, NoteDecisionCardFactsV1, NoteDecisionClosedReasonV1, NoteDecisionSourcePort,
} from '../model/decision-contracts.js';
import {
  actualDispositionTargets, pendingUnderstandingOverridden, userReasonsOf,
  type NoteUserReasonTargetV1,
} from '../state/note-machine.js';
import { S4_NOTE_BY_REVIEW_STATUS_LOOKUP } from '../persistence/note-record-codecs.js';
import { readAllHeads } from './note-base-reader.js';
import { readHeadBatch, readPointerAndHeadBatch } from './note-batch-reader.js';
import { readGoalPlanWindow } from '../tasks/plan-readers.js';
import type { NotePlanWindowFactsV1 } from './note-service.js';

/** The one pointer shape the batch read and `pendingUnderstandingOverridden` share. */
type PointerFacts = { noteId: string | null; revision: number | null };

export type NoteDecisionSourceDeps = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  /**
   * The note service's batched user-reason facts
   * (`createNoteService(...).userReasonFacts`): ONE NoteCall per card-collection
   * call, built on the SAME per-head facts the disposition guard uses.
   */
  userReasonFacts(ctx: CoreCallContext, heads: readonly NoteHeadSnapshot[],
    planWindows: readonly NotePlanWindowFactsV1[],
    attempt?: DecisionSourceAttempt): Promise<ReadResult<Map<string, NoteUserReasonTargetV1>>>;
  /** The note service's card-mode entry (`createNoteService(...).applyNoteDecision`). */
  apply: NoteDecisionApplyPort['applyNoteDecision'];
};

const OPTION_LABELS: Readonly<Record<'accept' | 'reject' | 'supersede' | 'coexist', string>> = {
  accept: '收下', reject: '拒绝', supersede: '取代', coexist: '并存',
};

function ready<T>(value: T): ReadResult<T> { return { status: 'ready', value }; }

function headPinOf(projectId: string, head: NoteHeadSnapshot): VersionPin {
  return { ref: { aggregateType: 'NoteHead', projectId, noteId: head.noteId }, revision: head.version };
}

function cardFactsOf(projectId: string, head: NoteHeadSnapshot, pointer: PointerFacts,
  targetHeads: ReadonlyMap<string, NoteHeadSnapshot>, reasons: readonly string[]): NoteDecisionCardFactsV1 {
  const headPin = headPinOf(projectId, head);
  const isUnderstanding = head.kind === 'understanding';
  const pins: VersionPin[] = [headPin];
  if (isUnderstanding && pointer.revision !== null) {
    pins.push({ ref: { aggregateType: 'CurrentPointer', projectId, anchorKey: head.anchorKey0 },
      revision: pointer.revision });
  }
  const optionIds: NoteDecisionCardFactsV1['optionIds'] =
    reasons.includes('contradiction') || reasons.includes('user_note_replaced')
      ? ['supersede', 'coexist', 'reject'] : ['accept', 'reject'];
  const objects: DecisionObjectV1[] = [
    { kind: 'aggregate', pin: headPin, label: renderNoteHeader(head) },
  ];
  for (const targetId of actualDispositionTargets(head)) {
    const targetHead = targetHeads.get(targetId);
    if (targetHead === undefined) continue;
    objects.push({ kind: 'aggregate',
      pin: { ref: { aggregateType: 'NoteHead', projectId, noteId: targetId }, revision: targetHead.version },
      label: renderNoteHeader(targetHead) });
  }
  // D-01/NE6: every note-card option is a real state transition of the note
  // (reject included), so all four go through `applyNoteDecision` and the
  // coordinator records a formal application receipt for each.
  const options: DecisionOptionV1[] = optionIds.map(id => ({ id, label: OPTION_LABELS[id],
    effect: 'apply' }));
  return {
    cardId: decisionSourceKey({ kind: 'note_review', note: headPin }),
    source: 'note_review', noteId: head.noteId, version: head.version, kind: head.kind, goalId: head.goalId,
    optionIds, summary: renderNoteHeader(head),
    pointer: isUnderstanding ? { noteId: pointer.noteId, revision: pointer.revision } : null,
    pins, objects, options,
  };
}

export function createNoteDecisionSource(deps: NoteDecisionSourceDeps): NoteDecisionSourcePort {
  /** The open-card facts of one pending head, or the shared closed verdict. */
  async function cardFor(ctx: CoreCallContext, head: NoteHeadSnapshot, planWindow: NotePlanWindowFactsV1):
  Promise<{ ok: true; card: NoteDecisionCardFactsV1 | null; closedReason: NoteDecisionClosedReasonV1 | null }
  | { ok: false; reason: string }> {
    const targetRead = await readHeadBatch(deps.records, ctx.projectId, actualDispositionTargets(head),
      { requireAll: true });
    if (!targetRead.ok) return { ok: false, reason: targetRead.reason };
    const facts = await deps.userReasonFacts(ctx, [...targetRead.value.values()], [planWindow]);
    if (facts.status !== 'ready') {
      return { ok: false, reason: facts.status === 'rejected' ? facts.reason : 'the user-reason facts are not readable' };
    }
    // Per head pass ONLY its own targets (never the whole goal's target set).
    const reasons = userReasonsOf(head, actualDispositionTargets(head)
      .flatMap(noteId => facts.value.get(noteId) ?? []));
    const pointerRead = await readPointerAndHeadBatch(deps.records, ctx.projectId, [head.anchorKey0]);
    if (!pointerRead.ok) return { ok: false, reason: pointerRead.reason };
    const pointer = pointerRead.value.pointers.get(head.anchorKey0) ?? { noteId: null, revision: null };
    const current = pointer.noteId === null ? null : (pointerRead.value.heads.get(pointer.noteId) ?? null);
    if (reasons.length === 0 || pendingUnderstandingOverridden(head, current)) {
      return { ok: true, card: null, closedReason: 'source_resolved' };
    }
    return { ok: true, card: cardFactsOf(ctx.projectId, head, pointer, targetRead.value, reasons),
      closedReason: null };
  }

  return {
    async readNoteDecisions(ctx, input): Promise<ReadResult<NoteDecisionCardFactsV1[]>> {
      const goalRef: GoalRef = input.goalRef;
      const window = await readGoalPlanWindow(deps.records, goalRef);
      if (window.status !== 'ready') return rejected('unavailable', window.reason);
      if (window.goal.desiredState === 'cancelled') return ready([]);
      const page = await readAllHeads(deps.records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP,
        [ctx.projectId, goalRef.goalId, 'pending_review']);
      if (!page.ok) return rejected('unavailable', page.reason);
      if (page.heads.length === 0) return ready([]);

      // ONE batched read of every pending note's relation targets, shared by
      // every card of the Goal (RW-12a / §11.7).
      const targetIds = new Set<string>();
      for (const head of page.heads) for (const noteId of actualDispositionTargets(head)) targetIds.add(noteId);
      const targetRead = await readHeadBatch(deps.records, ctx.projectId, [...targetIds], { requireAll: true });
      if (!targetRead.ok) return rejected('unavailable', targetRead.reason);
      const facts = await deps.userReasonFacts(ctx, [...targetRead.value.values()],
        [{ goalId: goalRef.goalId, window }], input.attempt);
      if (facts.status !== 'ready') {
        return rejected('unavailable', facts.status === 'rejected' ? facts.reason : 'the user-reason facts are not readable');
      }

      // ONE batched pointer + pointed-head read across every pending anchor.
      const anchorKeys = [...new Set(page.heads.map(head => head.anchorKey0))];
      const pointerRead = await readPointerAndHeadBatch(deps.records, ctx.projectId, anchorKeys);
      if (!pointerRead.ok) return rejected('unavailable', pointerRead.reason);

      const cards: NoteDecisionCardFactsV1[] = [];
      for (const head of page.heads) {
        const reasons = userReasonsOf(head, actualDispositionTargets(head)
          .flatMap(noteId => facts.value.get(noteId) ?? []));
        const pointer = pointerRead.value.pointers.get(head.anchorKey0) ?? { noteId: null, revision: null };
        const current = pointer.noteId === null ? null : (pointerRead.value.heads.get(pointer.noteId) ?? null);
        if (reasons.length === 0 || pendingUnderstandingOverridden(head, current)) continue;
        cards.push(cardFactsOf(ctx.projectId, head, pointer, targetRead.value, reasons));
      }
      return ready(cards);
    },

    async readNoteDecision(ctx, input): Promise<ReadResult<{
      card: NoteDecisionCardFactsV1 | null; closedReason: NoteDecisionClosedReasonV1 | null }>> {
      const headRead = await readHeadBatch(deps.records, ctx.projectId, [input.pin.noteId]);
      if (!headRead.ok) return rejected('unavailable', headRead.reason);
      const head = headRead.value.get(input.pin.noteId) ?? null;
      // A missing head, a moved version or a non-pending head is the
      // `source_stale` signal (null card and null closed reason).
      if (head === null || head.version !== input.pin.version || head.state !== 'pending_review') {
        return ready({ card: null, closedReason: null });
      }
      if (head.goalId === null) return ready({ card: null, closedReason: null });
      const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId: head.goalId };
      const window = await readGoalPlanWindow(deps.records, goalRef);
      if (window.status !== 'ready') return rejected('unavailable', window.reason);
      if (window.goal.desiredState === 'cancelled') {
        return ready({ card: null, closedReason: 'goal_cancelled' });
      }
      const carded = await cardFor(ctx, head, { goalId: goalRef.goalId, window });
      if (!carded.ok) return rejected('unavailable', carded.reason);
      return ready({ card: carded.card, closedReason: carded.closedReason });
    },

    async applyNoteDecision(ctx: CoreCallContext, input: NoteDecisionApplicationInputV1) {
      return deps.apply(ctx, input);
    },
  };
}
