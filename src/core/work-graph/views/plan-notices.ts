/**
 * `plan_notice` notice source (slice-PL-SPEC §5.8, §6.4.1, C-35), stage-end arm.
 *
 * A stage produces one "please be aware" item when its stage gate is satisfied
 * and that gate has a finalized `PASS` VerificationRound in this PlanRevision.
 * The item carries the six readings of §5.8, reusing `stageReadingOf` and
 * `stageOverLine`; a re-verification keeps the earliest round's `since`, so the
 * position never moves and a re-read never appends.
 *
 * The deviation arm ("the plan is not changed") is a later slice; this file
 * declares only the dependencies the stage-end read needs.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import {
  DEFAULT_PLAN_LOOP_LIMITS, type PlanLoopLimitsV1, type TaskSizeClassV1,
} from '../../../contracts/plan-loop-limits.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type {
  DecisionNoticeSourcePort, DecisionSourcePageV1, NoticeItemV1, S5RecordPort,
} from '../model/decision-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { PlanTaskPort, TaskRow } from '../model/plan-contracts.js';
import {
  stageOverLine, stageReadingOf, type StageReadingV1,
} from '../model/plan-loop-readings.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import {
  decodeVerificationRoundSnapshot, S2B_ROUND_BY_GOAL_LOOKUP,
} from '../persistence/evidence-record-codecs.js';
import {
  decodePlanRevisionSnapshot, planRevisionRefKey, S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
} from '../persistence/plan-record-codecs.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import type { ActivityReadPort, RunActivityViewV1 } from './activity-read-model.js';
import { readWatermark } from './activity-read-helpers.js';
import { paginateAssembled, readOrderedToEnd } from './automatic-rework-notices.js';
import { compareNoticePositions } from './notice-position.js';
import { idsTextOf, noticeUnavailableOf, planNoticeGoalRefs } from './plan-adoption-notices.js';
import { readGoal } from '../tasks/plan-readers.js';
import { stageIdOf } from '../notes/note-related-scope.js';

export type PlanNoticeDependencies = {
  records: S5RecordPort & RecordOrderedLookupPort;
  plans: Pick<PlanTaskPort, 'queryTaskGraph'>;
  runs: { listExecutions: NonNullable<ExecutionReadPort['listExecutions']> };
  activities: Pick<ActivityReadPort, 'readRunActivities'>;
};

/** §5.8: a next-stage placeholder without a size class is shown as 未分档. */
export type NextStageSizeClassV1 = TaskSizeClassV1 | 'unclassified';

/** The six readings of §5.8, ready for the one text constructor. */
export type StageEndSummaryInputV1 = {
  stageId: string;
  reading: StageReadingV1;
  completedTaskIds: readonly string[];
  replacedTaskIds: readonly string[];
  reworkCount: number;
  /** `null` = no next stage; empty classes = 未分档. */
  nextStage: { sizeClasses: readonly NextStageSizeClassV1[] } | null;
  overLine: boolean;
  limits: PlanLoopLimitsV1;
};

/** §10.5: one activity read takes at most 200 RunRefs. */
const ACTIVITY_BATCH = 200;
/** §10.5: one `listExecutions` page is at most 100 items. */
const RUN_PAGE_LIMIT = 100;

/** Builds the `plan_notice` notice source, stage-end arm only. */
export function createPlanNoticeSource(deps: PlanNoticeDependencies): DecisionNoticeSourcePort {
  return {
    category: 'plan_notice',
    async readPage(ctx, input): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
      try {
        return { status: 'ready', value: await readStageEndPage(deps, ctx, input) };
      } catch (error) {
        return storeFailureToRejection(error);
      }
    },
  };
}

/** The one stage-end text constructor (spec §5.8); pure. */
export function stageEndSummaryOf(input: StageEndSummaryInputV1): string {
  const reading = input.reading;
  const head = [
    `阶段 ${input.stageId} 结束`,
    `token ${tokenTextOf(reading.usage)}`,
    `增长 ${growthTextOf(reading.usage)}`,
    `行数 ${linesTextOf(reading.lines)}`,
    `已完成 ${idsTextOf(input.completedTaskIds)}`,
    `已替代 ${idsTextOf(input.replacedTaskIds)}`,
    `返工 ${String(input.reworkCount)} 次`,
    `下一阶段档位 ${classesTextOf(input.nextStage)}`,
  ].join(' · ');
  // 阶段线只提醒：只在超线时把真正超了的那几项数字带上。
  return head + overLineTextOf(input);
}

/** §13.2.3: a token reading is never written as a complete zero. */
function tokenTextOf(usage: StageReadingV1['usage']): string {
  if (usage.tokens === null) return `未知：${usage.reason ?? 'unknown'}`;
  return usage.complete ? String(usage.tokens) : `至少 ${String(usage.tokens)}，不全`;
}

/** §13.2.3: an unknown Run reads `未知：<reason>`; a request without usage only marks the growth incomplete. */
function growthTextOf(usage: StageReadingV1['usage']): string {
  const growth = usage.growth;
  if (growth.tokens === null) return usage.tokens === null ? tokenTextOf(usage) : '不全';
  return growth.complete ? String(growth.tokens) : `至少 ${String(growth.tokens)}，不全`;
}

/** §13.2.3: the line text is added + deleted, unknown or incomplete as such. */
function linesTextOf(lines: StageReadingV1['lines']): string {
  if (lines.added === null || lines.deleted === null) return `未知：${lines.reason ?? 'unknown'}`;
  const total = lines.added + lines.deleted;
  return lines.complete ? `${String(total)} 行` : `至少 ${String(total)} 行，不全`;
}

function classesTextOf(nextStage: StageEndSummaryInputV1['nextStage']): string {
  if (nextStage === null) return '没有下一阶段';
  if (nextStage.sizeClasses.length === 0) return '未分档';
  return nextStage.sizeClasses
    .map((sizeClass) => sizeClass === 'unclassified' ? '未分档' : sizeClass)
    .join('、');
}

function overLineTextOf(input: StageEndSummaryInputV1): string {
  if (!input.overLine) return '';
  const reading = input.reading;
  const parts: string[] = [];
  if (reading.estimatedLines !== null && reading.estimatedLines > input.limits.stageLineBudget) {
    parts.push(`预估 ${String(reading.estimatedLines)} 行 > ${String(input.limits.stageLineBudget)}`);
  }
  if (reading.usage.tokens !== null && reading.usage.tokens > input.limits.stageTokenBudget) {
    parts.push(`累计 token ${String(reading.usage.tokens)} > ${String(input.limits.stageTokenBudget)}`);
  }
  return parts.length === 0 ? '' : ` · 阶段线超线：${parts.join('；')}`;
}

type ReadPageInput = Parameters<DecisionNoticeSourcePort['readPage']>[1];

type RoundWithSince = { snapshot: RoundSnapshot; since: CommitCursor };

/** One page of stage-end items, already sorted, filtered and paginated. */
async function readStageEndPage(
  deps: PlanNoticeDependencies,
  ctx: CoreCallContext,
  input: ReadPageInput,
): Promise<DecisionSourcePageV1<NoticeItemV1>> {
  const { projectId, workspaceId } = input.workspace;
  // The ordered index is by Goal, so a project-wide read enumerates the
  // workspace's Goals first (the same helper the adoption source uses).
  const planRecords: Awaited<ReturnType<typeof readOrderedToEnd>> = [];
  for (const goalRef of await planNoticeGoalRefs(deps.records, input)) {
    planRecords.push(...await readOrderedToEnd(deps.records,
      S2B_PLAN_REVISION_BY_GOAL_LOOKUP, [projectId, goalRef.goalId], null));
  }

  const items: NoticeItemV1[] = [];
  // §5.8: one item per adopted PlanRevision, so a stage finished on an older
  // version keeps its item after a newer version is adopted. The ordered read
  // already lists every version; each one reads its own TaskRows.
  for (const record of planRecords) {
    const decoded = decodePlanRevisionSnapshot(record);
    if (decoded.status !== 'decoded') {
      throw rejected('unavailable', `adopted plan ${record.refKey}: ${decoded.reason}`);
    }
    const planRecord = decoded.value;
    if (planRecord.goalRef.projectId !== projectId) continue;
    if (input.goalRef !== undefined && planRecord.goalRef.goalId !== input.goalRef.goalId) continue;
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: planRecord.goalRef.goalId };
    if (input.goalRef === undefined) {
      const goalRead = await readGoal(deps.records, goalRef);
      if (goalRead.status !== 'ready') throw noticeUnavailableOf(goalRead);
      if (goalRead.goal.workspaceRef.workspaceId !== workspaceId) continue;
    }
    const graphRead = await deps.plans.queryTaskGraph(ctx, { goalRef, planRef: planRecord.ref });
    if (graphRead.status !== 'ready') throw noticeUnavailableOf(graphRead);
    const graph = graphRead.value;
    const plan = graph.plan;
    const rounds = await goalRoundsOf(deps.records, projectId, workspaceId, goalRef);

    for (const [stageIndex, stage] of plan.stages.entries()) {
      const gate = graph.tasks.find((row) => row.definition.taskKind === 'gate'
        && row.definition.scope.kind === 'stage'
        && row.definition.scope.stageId === stage.stageId);
      if (gate === undefined || gate.effectivePhase !== 'satisfied') continue;
      const roundSince = roundSinceOf(rounds, plan, gate.ref.taskId);
      if (roundSince === undefined) continue;

      const workTasks = graph.tasks.filter((row) => row.definition.taskKind === 'work'
        && stageIdOf(row.definition) === stage.stageId);
      const reading = await stageReadingOfTasks(deps, ctx, goalRef, workTasks);
      const nextStage = plan.stages[stageIndex + 1];
      const nextStageClasses = nextStage === undefined
        ? null
        : planOnlyClassesOf(graph.tasks, nextStage.stageId);
      const overLine = stageOverLine(reading, DEFAULT_PLAN_LOOP_LIMITS);
      const itemKey = `stage-end:${plan.ref.planId}:${String(plan.planRevision)}:${stage.stageId}`;
      items.push({
        itemKey,
        category: 'plan_notice',
        subject: { kind: 'goal', goalRef: plan.goalRef },
        position: { kind: 'commit', cursor: roundSince, itemKey },
        summary: stageEndSummaryOf({
          stageId: stage.stageId,
          reading,
          completedTaskIds: workTasks
            .filter((row) => row.effectivePhase === 'satisfied')
            .map((row) => row.ref.taskId),
          replacedTaskIds: workTasks
            .filter((row) => row.definition.disposition === 'superseded')
            .map((row) => row.ref.taskId),
          // §5.8: the stage's rework count, never the cumulative autoCount.
          reworkCount: workTasks.reduce((sum, row) => sum
            + (row.rework?.entries.filter((entry) => entry.failureClass !== 'interrupted').length ?? 0), 0),
          nextStage: nextStageClasses === null ? null : { sizeClasses: nextStageClasses },
          overLine,
          limits: DEFAULT_PLAN_LOOP_LIMITS,
        }),
        objects: [],
        rework: null,
      });
    }
  }

  items.sort((left, right) => compareNoticePositions(left.position, right.position));
  const after = input.after;
  const remaining = after === undefined
    ? items
    : items.filter((item) => compareNoticePositions(item.position, after) > 0);
  const watermarkRead = await readWatermark(deps.records);
  if (watermarkRead.status !== 'ready') throw noticeUnavailableOf(watermarkRead);
  return paginateAssembled({ watermark: watermarkRead.value, remaining }, input).value;
}

/** Every round of one Goal, in `since` order; the origin decoder carries `since`. */
async function goalRoundsOf(
  records: PlanNoticeDependencies['records'],
  projectId: string,
  workspaceId: string,
  goalRef: GoalRef,
): Promise<RoundWithSince[]> {
  const roundRecords = await readOrderedToEnd(records,
    S2B_ROUND_BY_GOAL_LOOKUP, [projectId, workspaceId, goalRef.goalId], null);
  const rounds: RoundWithSince[] = [];
  for (const record of roundRecords) {
    const decoded = decodeVerificationRoundSnapshot(record);
    if (decoded.status !== 'decoded') {
      throw rejected('unavailable', `stage-end round ${record.refKey}: ${decoded.reason}`);
    }
    const snapshot = decoded.value;
    const origin = decodeNoticeOrigin(record);
    if (origin.status !== 'decoded') {
      throw rejected('unavailable', `stage-end round origin ${record.refKey}: ${origin.reason}`);
    }
    rounds.push({ snapshot, since: origin.value.since! });
  }
  return rounds;
}

/**
 * The earliest finalized `PASS` round of this stage gate in this PlanRevision.
 * The ordered read is by `since`, so the first match is the earliest; a later
 * re-verification never moves it.
 */
function roundSinceOf(
  rounds: readonly RoundWithSince[],
  plan: PlanRevisionSnapshot,
  gateTaskId: string,
): CommitCursor | undefined {
  const planKey = planRevisionRefKey(plan.ref);
  for (const round of rounds) {
    if (round.snapshot.subject.taskId !== gateTaskId) continue;
    if (round.snapshot.status !== 'finalized' || round.snapshot.outcome !== 'PASS') continue;
    if (planRevisionRefKey(round.snapshot.adoptedPlanRef) !== planKey) continue;
    return round.since;
  }
  return undefined;
}

/** §5.8/§10.5: the stage's work Runs, in pages and 200-ref activity batches. */
async function stageReadingOfTasks(
  deps: PlanNoticeDependencies,
  ctx: CoreCallContext,
  goalRef: GoalRef,
  workTasks: readonly TaskRow[],
): Promise<StageReadingV1> {
  const tasks: { estimatedLines?: number; readings: RunActivityViewV1['readings'][] }[] = [];
  for (const row of workTasks) {
    const runRefs = await listTaskRuns(deps.runs, ctx, goalRef, row.ref.taskId);
    const viewByRef = new Map<string, RunActivityViewV1>();
    for (let index = 0; index < runRefs.length; index += ACTIVITY_BATCH) {
      const batch = runRefs.slice(index, index + ACTIVITY_BATCH);
      const read = await deps.activities.readRunActivities(ctx, { runRefs: batch });
      if (read.status !== 'ready') throw noticeUnavailableOf(read);
      for (const view of read.value) viewByRef.set(canonicalKey(view.runRef), view);
    }
    const readings: RunActivityViewV1['readings'][] = [];
    for (const runRef of runRefs) {
      const view = viewByRef.get(canonicalKey(runRef));
      if (view === undefined) {
        throw rejected('unavailable', `stage-end Run activity ${canonicalKey(runRef)} is missing`);
      }
      readings.push(view.readings);
    }
    // A cancelled or superseded Task plans no lines: only a live Task without an estimate leaves the stage unknown.
    const estimate = row.definition.disposition === 'cancelled' || row.definition.disposition === 'superseded'
      ? 0 : row.definition.estimatedLines;
    tasks.push({
      ...(estimate === undefined ? {} : { estimatedLines: estimate }),
      readings,
    });
  }
  return stageReadingOf(tasks);
}

/** §10.5: page `listExecutions` to the end; a failed page is not an empty list. */
async function listTaskRuns(
  runs: PlanNoticeDependencies['runs'],
  ctx: CoreCallContext,
  goalRef: GoalRef,
  taskId: string,
): Promise<RunRef[]> {
  const refs: RunRef[] = [];
  let afterCursor: string | null = null;
  for (;;) {
    const page = await runs.listExecutions(ctx, {
      goalRef, taskId, page: { afterCursor, limit: RUN_PAGE_LIMIT },
    });
    if (page.status !== 'ready') throw noticeUnavailableOf(page);
    for (const item of page.value.items) refs.push(item.run.ref);
    if (page.value.nextCursor === null) break;
    afterCursor = page.value.nextCursor;
  }
  return refs;
}

/** The next stage's `plan_only` placeholders, unique size classes in task order. */
function planOnlyClassesOf(tasks: readonly TaskRow[], stageId: string): NextStageSizeClassV1[] {
  const classes: NextStageSizeClassV1[] = [];
  for (const row of tasks) {
    if (row.definition.executionIntent !== 'plan_only') continue;
    if (stageIdOf(row.definition) !== stageId) continue;
    // Missing class is the explicit 未分档 marker, kept beside the known classes.
    const sizeClass: NextStageSizeClassV1 = row.definition.sizeClass ?? 'unclassified';
    if (!classes.includes(sizeClass)) classes.push(sizeClass);
  }
  return classes;
}

