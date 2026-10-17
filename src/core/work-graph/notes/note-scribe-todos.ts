/**
 * Slice 4C-2 §11.5/U-4: the narrow scribe to-do port the Host reminder check
 * reads. It reuses the ONE shared anchor reader (`readGoalUnderstandingAnchors`
 * in `note-update-due.ts`) for the plan window, pointers, heads, triggers and
 * the `foldInputOf` baseline, and adds the `pending_review` bucket.
 *
 * §11.5 rules:
 * - a cancelled Goal (or one with no active Plan) contributes nothing, though
 *   the goal-less pending bucket still exists once per call;
 * - `updateDueTodos` = `anchorKey@latestTriggerCursor` for the goal anchor and
 *   every stage anchor of the current plan whose folded `updateDue` is true;
 * - `pending` = `noteId@version` for every `pending_review` head of the Goal
 *   (plus the goal-less bucket) that the scribe can actually act on: an empty
 *   live `userReasonsOf`, or a pending understanding overridden by a newer
 *   current version of the same anchor;
 * - `immediate` = an unclaimed `archive:` trigger whose `at` is after the GOAL
 *   anchor's baseline (`baseline === null` means negative infinity), so an
 *   archive already covered by a goal understanding is not immediate
 *   (rework missed 2 / ruling 8);
 * - rework items 4 and 1: the pending buckets are read FIRST, so the pending
 *   notes' own anchors join the ONE shared reader; the reader performs exactly
 *   one pointer batch and one pointed-head batch. Only the pending buckets that
 *   count (a cancelled Goal or a Goal with no active Plan is dropped, the
 *   goal-less bucket always counts) contribute relation-target ids, and those
 *   targets are read in ONE head batch. Their live user-reason facts come from
 *   the note service's `userReasonFacts` — the SAME function the note card
 *   source and the disposition guard use (§11.6/L23) — seeded with the reader's
 *   plan windows. Read-era "is it retired for a non-file reason" is never
 *   re-derived here.
 * Any read failure (including `unsupported`) is `unavailable`, never a silently
 * shorter list.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { NoteHeadSnapshot } from '../../../contracts/note.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { NoteScribeTodoPort, NoteScribeTodoV1, NoteScribeTodosV1 } from '../model/note-contracts.js';
import type { NotePlanWindowFactsV1, NoteUserReasonFactsPort } from './note-service.js';
import { actualDispositionTargets, pendingUnderstandingOverridden, userReasonsOf,
  type NoteUserReasonTargetV1 } from '../state/note-machine.js';
import { S4_NOTE_BY_REVIEW_STATUS_LOOKUP } from '../persistence/note-record-codecs.js';
import { foldInputOf, readGoalUnderstandingAnchors,
  type GoalUnderstandingAnchorsReadV1 } from './note-update-due.js';
import { readHeadBatch } from './note-batch-reader.js';
import { readAllHeads } from './note-read-model.js';

export type NoteScribeTodosDeps = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  userReasonFacts: NoteUserReasonFactsPort['userReasonFacts'];
};

function unavailable<T>(reason: string): ReadResult<T> {
  return { status: 'rejected', code: 'unavailable', reason };
}

type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };

/** A `pending_review` bucket: a real goal id, or the goal-less `null` slot. */
type PendingBucket = string | null;

type PendingEntry = { bucket: PendingBucket; head: NoteHeadSnapshot };

/**
 * Rework item 1: the relation-target rule of §11.5/§11.6. Only pending notes in
 * the buckets that COUNT contribute targets, so a cancelled Goal's notes (and
 * their relations) are neither read nor able to fail the call.
 */
function relationTargetIds(entries: readonly PendingEntry[]): Set<string> {
  const targetIds = new Set<string>();
  for (const { head } of entries) {
    const coexisting = new Set(head.coexistWith);
    for (const noteId of head.replaces) if (!coexisting.has(noteId)) targetIds.add(noteId);
    for (const noteId of head.contradicts) targetIds.add(noteId);
  }
  return targetIds;
}

export function createNoteScribeTodos(deps: NoteScribeTodosDeps): NoteScribeTodoPort {
  /**
   * Rework item 4: every bucket's `pending_review` heads in one pass. The
   * buckets are read before the shared anchor reader so the anchors they need
   * can join its single pointer/head batch.
   */
  async function readPendingHeads(ctx: CoreCallContext, buckets: readonly PendingBucket[]):
  Promise<Outcome<PendingEntry[]>> {
    const all: PendingEntry[] = [];
    for (const bucket of buckets) {
      const page = await readAllHeads(deps.records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP,
        [ctx.projectId, bucket, 'pending_review']);
      if (!page.ok) return { ok: false, reason: page.reason };
      for (const head of page.heads) all.push({ bucket, head });
    }
    return { ok: true, value: all };
  }

  /**
   * §11.5/§11.6: the `pending_review` scribe to-dos of every bucket in ONE pass.
   * The pre-read pending heads, the shared reader's pointer/head snapshots and
   * the service's batched user-reason facts are each used once for all buckets
   * together (§11.7 heartbeat row).
   */
  async function pendingTodosBatch(buckets: readonly PendingBucket[],
    allHeads: readonly PendingEntry[], anchors: GoalUnderstandingAnchorsReadV1,
    targets: ReadonlyMap<string, NoteUserReasonTargetV1>):
  Promise<Outcome<Map<PendingBucket, NoteScribeTodoV1[]>>> {
    const result = new Map<PendingBucket, NoteScribeTodoV1[]>();
    for (const bucket of buckets) result.set(bucket, []);
    const relevant = allHeads.filter(entry => result.has(entry.bucket));
    if (relevant.length === 0) return { ok: true, value: result };

    for (const { bucket, head } of relevant) {
      // 4C-2 rework item 6 (verify §6 aside): pass ONLY this head's own targets;
      // handing it the whole bucket's target map rebuilds it per head (O(H×T)).
      let counts = userReasonsOf(head, actualDispositionTargets(head)
        .flatMap(noteId => {
          const target = targets.get(noteId);
          return target === undefined ? [] : [target];
        })).length === 0;
      if (!counts) {
        const pointer = anchors.pointers.get(head.anchorKey0) ?? { noteId: null, revision: null };
        // This caller requires the pointed current head: a pointer that names a
        // head the shared reader did not return is an error, not an absent one.
        if (pointer.noteId !== null && !anchors.heads.has(pointer.noteId)) {
          return { ok: false, reason: `the note head ${pointer.noteId} cannot be read` };
        }
        const current = pointer.noteId === null ? null : (anchors.heads.get(pointer.noteId) ?? null);
        counts = pendingUnderstandingOverridden(head, current);
      }
      if (!counts) continue;
      result.get(bucket)!.push({ identity: `${head.noteId}@${String(head.version)}`, anchorKey: head.anchorKey0,
        noteId: head.noteId, version: head.version, latestTriggerCursor: null, updateDue: false });
    }
    return { ok: true, value: result };
  }

  return {
    async readScribeTodos(ctx, input): Promise<ReadResult<NoteScribeTodosV1[]>> {
      // Rework item 4: read every pending bucket first, so the pending notes'
      // OWN anchors join the ONE shared reader below.
      const allBuckets: PendingBucket[] = [...new Set(input.goalIds)];
      allBuckets.push(null); // EXACTLY ONE goal-less bucket.
      const pendingHeads = await readPendingHeads(ctx, allBuckets);
      if (!pendingHeads.ok) return unavailable(pendingHeads.reason);
      const pendingAnchorKeys = [...new Set(pendingHeads.value.map(entry => entry.head.anchorKey0))];

      // ONE shared reader for the whole call: one plan window per goal, ONE
      // batched pointer read and ONE batched head read across all goals plus the
      // pending notes' own anchors, and one trigger read per goal with a plan
      // (§11.7). Relation targets do NOT join it: they are read only for the
      // buckets that count, in the one batch below.
      const anchorsResult = await readGoalUnderstandingAnchors(deps.records, ctx, input.goalIds, pendingAnchorKeys);
      if (anchorsResult.status !== 'ready') {
        return unavailable(anchorsResult.status === 'rejected' ? anchorsResult.reason
          : 'the goal understanding anchors are not available');
      }
      const byGoal = new Map(anchorsResult.value.map(row => [row.goalId, row]));

      // A cancelled Goal and a Goal with no active Plan contribute no bucket.
      const pendingBuckets: PendingBucket[] = [];
      for (const goalId of input.goalIds) {
        const row = byGoal.get(goalId)!;
        if (row.goal.desiredState !== 'cancelled' && row.plan !== null) pendingBuckets.push(goalId);
      }
      pendingBuckets.push(null); // EXACTLY ONE goal-less bucket.

      // Rework item 1: only the pending entries in a bucket that counts can
      // contribute relation targets; they are read in ONE batch, and their LIVE
      // user-reason facts come from the service's `userReasonFacts` (the same
      // function the card source and the guard use), seeded with the shared
      // reader's plan windows. A target understanding therefore needs no anchor
      // in the shared reader.
      const relevantHeads = pendingHeads.value.filter(entry => pendingBuckets.includes(entry.bucket));
      const targetIds = relationTargetIds(relevantHeads);
      const targetHeadsRead = await readHeadBatch(deps.records, ctx.projectId, [...targetIds], { requireAll: true });
      if (!targetHeadsRead.ok) return unavailable(targetHeadsRead.reason);
      const targets = new Map<string, NoteUserReasonTargetV1>();
      if (targetHeadsRead.value.size > 0) {
        const planWindows: NotePlanWindowFactsV1[] = anchorsResult.value.map(row => ({ goalId: row.goalId,
          window: { status: 'ready', goal: row.goal, plan: row.plan, readThrough: row.readThrough } }));
        const facts = await deps.userReasonFacts(ctx, [...targetHeadsRead.value.values()], planWindows);
        if (facts.status !== 'ready') {
          return unavailable(facts.status === 'rejected' ? facts.reason
            : 'the user reason facts are not available');
        }
        for (const [noteId, target] of facts.value) targets.set(noteId, target);
      }

      const pending = await pendingTodosBatch(pendingBuckets, pendingHeads.value, anchorsResult.value, targets);
      if (!pending.ok) return unavailable(pending.reason);

      const results: NoteScribeTodosV1[] = [];
      for (const goalId of input.goalIds) {
        const row = byGoal.get(goalId)!;
        if (row.goal.desiredState === 'cancelled' || row.plan === null) {
          results.push({ goalId, pending: [], updateDueTodos: [], immediate: false });
          continue;
        }
        const updateDueTodos: NoteScribeTodoV1[] = [];
        for (const anchor of row.anchors) {
          if (!anchor.updateDue || anchor.latestTriggerCursor === null) continue;
          updateDueTodos.push({ identity: `${anchor.anchorKey}@${anchor.latestTriggerCursor}`,
            anchorKey: anchor.anchorKey, noteId: null, version: null,
            latestTriggerCursor: anchor.latestTriggerCursor, updateDue: true });
        }
        // Missed 2 / ruling 8: the goal anchor's baseline, folded by the ONE rule.
        const goalAnchor = row.anchors.find(anchor => anchor.anchorKey === `goal:${goalId}`);
        const baseline = goalAnchor === undefined ? null
          : foldInputOf(goalAnchor.anchorKey, goalAnchor.head, row.plan).baseline;
        const immediate = row.triggers.some(trigger => trigger.kind === 'archive'
          && !row.claimedArchiveKeys.has(trigger.key) && (baseline === null || trigger.at > baseline));
        results.push({ goalId, pending: pending.value.get(goalId) ?? [], updateDueTodos, immediate });
      }
      results.push({ goalId: null, pending: pending.value.get(null) ?? [], updateDueTodos: [], immediate: false });
      return { status: 'ready', value: results };
    },

    /** §11.7: the ledger cursor is a bare commit cursor, `null` before any commit. */
    async readLedgerCursor(ctx): Promise<ReadResult<string | null>> {
      const read = await deps.records.readMany([]);
      if (read.status !== 'ready') return unavailable(read.reason);
      return { status: 'ready', value: read.value.readThrough };
    },
  };
}
