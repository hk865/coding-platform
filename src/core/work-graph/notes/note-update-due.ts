/**
 * Slice 4C §11.5/U-9: the pure "update due" fold and the one shared reader.
 *
 * It maps an already-read set of triggers (`readGoalTriggerRecords`'s output)
 * against the goal anchor and the current plan's stage anchors. It never reads
 * storage, a clock or a plan: the caller hands all three in.
 *
 * Rules (§11.5, U-9):
 * - ground truth is `trigger.at` strictly greater than `anchor.baseline`;
 *   `baseline === null` means negative infinity, so any trigger qualifies;
 * - a `plan` trigger applies only to the goal anchor and is ignored when
 *   `includePlanTrigger === false`;
 * - `task_end`/`rework`/`archive` apply to the goal anchor, and to a stage
 *   anchor only when `trigger.taskId` is in `plan.tasks` and that task's stage
 *   equals the anchor's `stageId`;
 * - `latestTriggerCursor` is the newest qualifying trigger by `at` descending,
 *   ties broken by `key` ascending (UTF-8 byte order), `null` when none qualify.
 *
 * Ruling 7: `readGoalUnderstandingAnchors` is the ONE reader
 * of an anchor set (goal + stage anchors, pointers, heads, triggers) shared by
 * the scribe to-dos and the view.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { NoteHeadSnapshot } from '../../../contracts/note.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { NoteUpdateDueTriggerV1 } from '../model/note-contracts.js';
import { readPointerAndHeadBatch } from './note-batch-reader.js';
import { stageIdOf } from './note-related-scope.js';
import { readGoalPlanWindow, readGoalTriggerRecords } from '../tasks/plan-readers.js';

export type NoteUpdateDueAnchorInputV1 = { anchorKey: string; baseline: string | null;
  stageId?: string | null; includePlanTrigger?: boolean };

/**
 * Ruling 4: the ONE baseline rule. `current` is
 * `head !== null && (accepted || reviewed)`.
 * - goal anchor (`stageId` null/undefined):
 *   `{ baseline: current ? createdAt : null, includePlanTrigger: current }`;
 * - stage anchor:
 *   `{ baseline: current ? createdAt : (plan === null ? null : plan.acceptedAt), stageId }`.
 */
export function foldInputOf(anchorKey: string, head: NoteHeadSnapshot | null, plan: PlanRevisionSnapshot | null,
  stageId?: string | null): NoteUpdateDueAnchorInputV1 {
  const current = head !== null && (head.state === 'accepted' || head.state === 'reviewed');
  if (stageId === null || stageId === undefined) {
    return { anchorKey, baseline: current ? head!.createdAt : null, includePlanTrigger: current };
  }
  return { anchorKey, baseline: current ? head!.createdAt : (plan === null ? null : plan.acceptedAt), stageId };
}

export function foldUpdateDue(input: { triggers: readonly NoteUpdateDueTriggerV1[];
  plan: PlanRevisionSnapshot | null;
  anchors: readonly NoteUpdateDueAnchorInputV1[] }): { anchorKey: string; updateDue: boolean;
    latestTriggerCursor: string | null }[] {
  const plan = input.plan;
  return input.anchors.map(anchor => {
    const stageId = anchor.stageId ?? null;
    const qualifying = plan === null ? [] : input.triggers.filter(trigger =>
      afterBaseline(trigger, anchor) && appliesTo(trigger, anchor, stageId, plan));
    return { anchorKey: anchor.anchorKey, updateDue: qualifying.length > 0,
      latestTriggerCursor: latestOf(qualifying) };
  });
}

function afterBaseline(trigger: NoteUpdateDueTriggerV1, anchor: NoteUpdateDueAnchorInputV1): boolean {
  return anchor.baseline === null || trigger.at > anchor.baseline;
}

function appliesTo(trigger: NoteUpdateDueTriggerV1, anchor: NoteUpdateDueAnchorInputV1, stageId: string | null,
  plan: PlanRevisionSnapshot): boolean {
  const isGoal = stageId === null;
  if (trigger.kind === 'plan') return isGoal && anchor.includePlanTrigger !== false;
  if (isGoal) return true;
  if (trigger.taskId === null) return false;
  const task = plan.tasks.find(candidate => candidate.taskId === trigger.taskId);
  if (task === undefined) return false;
  return stageIdOf(task) === stageId;
}

/** Newest by `at` descending; ties broken by `key` ascending (UTF-8 byte order). */
function latestOf(triggers: readonly NoteUpdateDueTriggerV1[]): string | null {
  let latest: NoteUpdateDueTriggerV1 | null = null;
  for (const trigger of triggers) {
    if (latest === null) { latest = trigger; continue; }
    if (trigger.at > latest.at) { latest = trigger; continue; }
    if (trigger.at === latest.at
      && Buffer.compare(Buffer.from(trigger.key, 'utf8'), Buffer.from(latest.key, 'utf8')) < 0) {
      latest = trigger;
    }
  }
  return latest === null ? null : latest.key;
}

// --------------------------------------------------------------------------
// §11.5/U-2: the one shared reader (one plan window, batched pointers/heads)
// --------------------------------------------------------------------------

export type GoalUnderstandingAnchorsV1 = {
  goalId: string;
  goal: GoalSnapshot;
  plan: PlanRevisionSnapshot | null;
  /** The plan window's ledger watermark, carried so callers can seed the SAME window. */
  readThrough: CommitCursor | null;
  triggers: NoteUpdateDueTriggerV1[];
  claimedArchiveKeys: ReadonlySet<string>;
  anchors: {
    anchorKey: string;
    pointer: { noteId: string | null; revision: number | null };
    head: NoteHeadSnapshot | null;
    updateDue: boolean;
    latestTriggerCursor: string | null;
  }[];
};

/**
 * The returned array also carries the ONE pointer batch and the
 * ONE head batch the reader performed (goal/stage anchors plus any extra
 * anchors), so a caller (the scribe to-dos) never reads them again.
 */
export type GoalUnderstandingAnchorsReadV1 = GoalUnderstandingAnchorsV1[] & {
  pointers: ReadonlyMap<string, { noteId: string | null; revision: number | null }>;
  heads: ReadonlyMap<string, NoteHeadSnapshot>;
};

/**
 * §11.5/§11.7: one plan window read per goal; anchors = `goal:<goalId>` plus one
 * `stage:<goalId>/<planRevision>/<stageId>` per current-plan stage; ONE batched
 * pointer read and ONE batched head read across ALL goals (and any
 * `extraAnchorKeys` the caller needs); one trigger read per goal with a non-null
 * plan (skipped when the plan is null). No current plan means the goal is
 * `updateDue: false` and there are no stage anchors. Any failed (including
 * `unsupported`) read anywhere rejects the whole call with `unavailable`.
 */
export async function readGoalUnderstandingAnchors(
  records: GoalRecordTransactionPort & RecordLookupPort,
  ctx: CoreCallContext, goalIds: readonly string[],
  extraAnchorKeys: readonly string[] = [],
): Promise<ReadResult<GoalUnderstandingAnchorsReadV1>> {
  type GoalWindow = {
    goalId: string;
    goal: GoalSnapshot;
    plan: PlanRevisionSnapshot | null;
    readThrough: CommitCursor | null;
    anchorKeys: string[];
    stageIds: Map<string, string>;
  };
  const windows: GoalWindow[] = [];
  for (const goalId of goalIds) {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return rejected('unavailable', window.reason);
    const plan = window.plan;
    const anchorKeys: string[] = [`goal:${goalId}`];
    const stageIds = new Map<string, string>();
    if (plan !== null) {
      for (const stage of plan.stages) {
        const key = `stage:${goalId}/${String(plan.planRevision)}/${stage.stageId}`;
        anchorKeys.push(key);
        stageIds.set(key, stage.stageId);
      }
    }
    windows.push({ goalId, goal: window.goal, plan, readThrough: window.readThrough, anchorKeys, stageIds });
  }

  // ONE batched pointer read and ONE batched pointed-head read for every goal's
  // anchors plus the caller's extra anchors.
  const allAnchorKeys = windows.flatMap(window => window.anchorKeys);
  for (const anchorKey of extraAnchorKeys) {
    if (!allAnchorKeys.includes(anchorKey)) allAnchorKeys.push(anchorKey);
  }
  const batch = await readPointerAndHeadBatch(records, ctx.projectId, allAnchorKeys);
  if (!batch.ok) return rejected('unavailable', batch.reason);
  const pointers = batch.value.pointers;
  const heads = batch.value.heads;

  const goals: GoalUnderstandingAnchorsV1[] = [];
  for (const window of windows) {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId: window.goalId };
    let triggers: NoteUpdateDueTriggerV1[] = [];
    let claimedArchiveKeys: ReadonlySet<string> = new Set();
    if (window.plan !== null) {
      // U-9: one trigger read per goal with a current plan.
      const triggerRead = await readGoalTriggerRecords(records, goalRef, window.plan);
      if (triggerRead.status !== 'ready') return rejected('unavailable', triggerRead.reason);
      triggers = triggerRead.triggers;
      claimedArchiveKeys = triggerRead.claimedArchiveKeys;
    }
    const foldAnchors = window.anchorKeys.map(anchorKey => {
      const pointer = pointers.get(anchorKey) ?? { noteId: null, revision: null };
      const head = pointer.noteId === null ? null : (heads.get(pointer.noteId) ?? null);
      return foldInputOf(anchorKey, head, window.plan, window.stageIds.get(anchorKey) ?? null);
    });
    const folded = foldUpdateDue({ triggers, plan: window.plan, anchors: foldAnchors });
    const byAnchor = new Map(folded.map(row => [row.anchorKey, row]));
    goals.push({ goalId: window.goalId, goal: window.goal, plan: window.plan, readThrough: window.readThrough,
      triggers, claimedArchiveKeys,
      anchors: window.anchorKeys.map(anchorKey => {
        const pointer = pointers.get(anchorKey) ?? { noteId: null, revision: null };
        const head = pointer.noteId === null ? null : (heads.get(pointer.noteId) ?? null);
        const row = byAnchor.get(anchorKey)!;
        return { anchorKey, pointer, head, updateDue: row.updateDue,
          latestTriggerCursor: row.latestTriggerCursor };
      }) });
  }
  const value = goals as GoalUnderstandingAnchorsReadV1;
  value.pointers = pointers;
  value.heads = heads;
  return { status: 'ready', value };
}
