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
 * - rework items 4 and 1: the pending buckets AND the pending notes' relation
 *   targets are read FIRST, so every anchor they need joins the ONE shared
 *   reader; the shared reader performs exactly one pointer batch and one
 *   pointed-head batch, the relation targets' head read is the only other batch,
 *   and the check reuses those read results plus the reader's triggers.
 * Any read failure (including `unsupported`) is `unavailable`, never a silently
 * shorter list.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { NoteHeadSnapshot } from '../../../contracts/note.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type {
  NoteHeadCheckPort, NoteScribeTodoPort, NoteScribeTodoV1, NoteScribeTodosV1, NoteUpdateDueTriggerV1,
} from '../model/note-contracts.js';
import { pendingUnderstandingOverridden, userReasonsOf, type NoteUserReasonTargetV1 } from '../state/note-machine.js';
import { S4_NOTE_BY_REVIEW_STATUS_LOOKUP } from '../persistence/note-record-codecs.js';
import { foldInputOf, readGoalUnderstandingAnchors,
  type GoalUnderstandingAnchorsReadV1 } from './note-update-due.js';
import { readHeadBatch } from './note-batch-reader.js';
import { readAllHeads } from './note-read-model.js';

export type NoteScribeTodosDeps = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  check: NoteHeadCheckPort;
};

function unavailable<T>(reason: string): ReadResult<T> {
  return { status: 'rejected', code: 'unavailable', reason };
}

type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };

/** A `pending_review` bucket: a real goal id, or the goal-less `null` slot. */
type PendingBucket = string | null;

type PendingEntry = { bucket: PendingBucket; head: NoteHeadSnapshot };

/**
 * Rework item 1: the relation-target rule of §11.5/§11.6, shared so the same
 * ids are read BEFORE the shared anchor reader and reused by the check.
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
   * The pre-read pending heads, the relation-target heads (read in
   * `readScribeTodos` before the shared reader), the shared reader's
   * pointer/head snapshots and the check are each used once for all buckets
   * together (§11.7 heartbeat row).
   */
  async function pendingTodosBatch(ctx: CoreCallContext, buckets: readonly PendingBucket[],
    allHeads: readonly PendingEntry[], anchors: GoalUnderstandingAnchorsReadV1,
    targetHeads: ReadonlyMap<string, NoteHeadSnapshot>):
  Promise<Outcome<Map<PendingBucket, NoteScribeTodoV1[]>>> {
    const result = new Map<PendingBucket, NoteScribeTodoV1[]>();
    for (const bucket of buckets) result.set(bucket, []);
    const relevant = allHeads.filter(entry => result.has(entry.bucket));
    if (relevant.length === 0) return { ok: true, value: result };

    // Rework item 1: the ONE relation-target head read already happened before the
    // shared reader; here only the ONE check gives their live status.
    const targets = new Map<string, NoteUserReasonTargetV1>();
    if (targetHeads.size > 0) {
      const items = [...targetHeads.values()].map(head => ({ head, version: head.version }));
      const planWindows = new Map<string, PlanRevisionSnapshot | null>();
      for (const row of anchors) planWindows.set(`${ctx.projectId}\u0000${row.goalId}`, row.plan);
      const understandingPointers = new Map<string, { pointer: { noteId: string | null; revision: number | null };
        head: NoteHeadSnapshot | null }>();
      for (const [anchorKey, pointer] of anchors.pointers) {
        understandingPointers.set(`${ctx.projectId}\u0000${anchorKey}`,
          { pointer, head: pointer.noteId === null ? null : anchors.heads.get(pointer.noteId) ?? null });
      }
      const understandingTriggers = new Map<string, { triggers: NoteUpdateDueTriggerV1[];
        claimedArchiveKeys: ReadonlySet<string> }>();
      for (const row of anchors) understandingTriggers.set(`${ctx.projectId}\u0000${row.goalId}`,
        { triggers: row.triggers, claimedArchiveKeys: row.claimedArchiveKeys });
      // Rework items 4 and 1: the check shares the plans, pointers/heads and
      // triggers the shared reader already read, so it reads none of them again.
      const checked = await deps.check.checkHeads(ctx,
        { items, planWindows, understandingPointers, understandingTriggers });
      if (checked.status !== 'ready') {
        const reason = checked.status === 'not_found' ? 'the note check target was not found'
          : checked.status === 'not_ready' ? 'the note check was not ready' : checked.reason;
        return { ok: false, reason };
      }
      const byId = new Map(checked.value.items.map(item => [item.noteId, item]));
      for (const [noteId, head] of targetHeads) {
        const item = byId.get(noteId);
        const retiredNonFile = item !== undefined && item.anchorStatus === 'retired'
          && item.anchorRetiredReasons.some(reason => reason !== 'file_deleted');
        targets.set(noteId, { noteId, version: head.version, state: head.state,
          userConfirmed: head.confirmedByUser, userWritten: head.source.kind === 'user',
          primaryAnchorRetiredNonFile: retiredNonFile });
      }
    }

    const targetList = [...targets.values()];
    for (const { bucket, head } of relevant) {
      let counts = userReasonsOf(head, targetList).length === 0;
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
      // Rework item 4: read every pending bucket first, so the anchors the
      // pending notes need join the ONE shared reader below.
      const allBuckets: PendingBucket[] = [...new Set(input.goalIds)];
      allBuckets.push(null); // EXACTLY ONE goal-less bucket.
      const pendingHeads = await readPendingHeads(ctx, allBuckets);
      if (!pendingHeads.ok) return unavailable(pendingHeads.reason);
      const pendingAnchorKeys = [...new Set(pendingHeads.value.map(entry => entry.head.anchorKey0))];

      // Rework item 1: the relation targets' heads are read FIRST, so any
      // understanding among them can add its anchor to the ONE shared reader
      // below instead of the check reading that old-stage pointer/head again.
      const targetIds = relationTargetIds(pendingHeads.value);
      const targetHeadsRead = await readHeadBatch(deps.records, ctx.projectId, [...targetIds], { requireAll: true });
      if (!targetHeadsRead.ok) return unavailable(targetHeadsRead.reason);
      const targetAnchorKeys: string[] = [];
      for (const head of targetHeadsRead.value.values()) {
        if (head.kind !== 'understanding') continue;
        if (!head.anchorKey0.startsWith('goal:') && !head.anchorKey0.startsWith('stage:')) continue;
        targetAnchorKeys.push(head.anchorKey0);
      }
      const extraAnchorKeys = [...new Set([...pendingAnchorKeys, ...targetAnchorKeys])];

      // ONE shared reader for the whole call: one plan window per goal, ONE
      // batched pointer read and ONE batched head read across all goals plus the
      // pending and relation-target anchors, and one trigger read per goal with a
      // plan (§11.7).
      const anchorsResult = await readGoalUnderstandingAnchors(deps.records, ctx, input.goalIds, extraAnchorKeys);
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
      const pending = await pendingTodosBatch(ctx, pendingBuckets, pendingHeads.value, anchorsResult.value,
        targetHeadsRead.value);
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
