/**
 * `plan_adoption` notice source (slice-PL-SPEC §6.4.1–§6.4.3, C-35): the one
 * "please be aware" item per adopted PlanRevision.
 *
 * It reads the Goal's adopted PlanRevisions from the ordered-by-`acceptedAt`
 * index, asks P5's `acceptedCandidatesOf` once per Goal for the accepted
 * candidate that targeted each revision, reads the review of the pre-accept
 * version (`proposal.revision - 1`), scans the Host's taskbook probe and
 * derives the future-only delta. Nothing here writes, sends or retries: a
 * failed probe is text on the item.
 *
 * The item position is the adoption cursor the candidate carries as `until`
 * (DR-P6-02). A candidate without `until` predates the plan loop and yields no
 * item; a damaged record is an `unavailable` read, never a skipped row.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { messageOf } from '../../../contracts/error-message.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { PlanReviewReadV1 } from '../../../contracts/plan-review.js';
import type { TaskbookExportReadV1, TaskbookExportReadPort, TaskbookFileStatusV1 } from '../../../contracts/plan-round.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type {
  DecisionNoticeSourcePort, DecisionSourcePageV1, NoticeItemV1, S5RecordPort,
} from '../model/decision-contracts.js';
import type { PlanProposal, PlanProposalRef } from '../model/plan-contracts.js';
import {
  decodePlanProposalOrigin, decodePlanRevisionSnapshot,
  planProposalRefKey, planRevisionRefKey, S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
} from '../persistence/plan-record-codecs.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { planRevisionTargetOf } from '../state/plan-machine.js';
import { deriveFuturePlanDelta, type FuturePlanDelta } from '../tasks/plan-validation.js';
import { readGoal, readPlan } from '../tasks/plan-readers.js';
import { readWatermark } from './activity-read-helpers.js';
import { paginateAssembled, readOrderedToEnd } from './automatic-rework-notices.js';
import { listWorkspaceGoals } from './goal-conflicts.js';
import { compareNoticePositions } from './notice-position.js';

export type PlanAdoptionNoticeDependencies = {
  records: S5RecordPort & RecordOrderedLookupPort;
  exports: TaskbookExportReadPort; // P1's type from contracts/plan-round.ts
  /** P5's shared accepted-candidate read, injected once per Goal by L. */
  acceptedCandidatesOf(goalRef: GoalRef): Promise<ReadResult<readonly PlanProposal[]>>;
  reviews: { read(ctx: CoreCallContext, input: {
    goalRef: GoalRef; proposalRef: PlanProposalRef; revision: number;
  }): Promise<ReadResult<PlanReviewReadV1>> };
};

/** The future-only change set. */
export type PlanAdoptionDeltaV1 = { status: 'supported'; taskIds: readonly string[] };

/** The four inputs of the one adoption text constructor. */
export type PlanAdoptionSummaryInputV1 = {
  planRevision: number;
  delta: PlanAdoptionDeltaV1;
  affectedTaskIds: readonly string[];
  review: ReadResult<PlanReviewReadV1>;
  exportRead: TaskbookExportReadV1;
};

/** Builds the `plan_adoption` notice source; the factory itself never throws. */
export function createPlanAdoptionNoticeSource(
  deps: PlanAdoptionNoticeDependencies,
): DecisionNoticeSourcePort {
  return {
    category: 'plan_adoption',
    async readPage(ctx, input): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
      try {
        return { status: 'ready', value: await readPlanAdoptionPage(deps, ctx, input) };
      } catch (error) {
        return storeFailureToRejection(error);
      }
    },
  };
}

/**
 * The one text constructor (spec §6.4.2): the adoption line, the delta, the
 * declared impact ids, the exact review clause and the taskbook state. Pure.
 */
export function planAdoptionSummaryOf(input: PlanAdoptionSummaryInputV1): string {
  const deltaIds = [...new Set(input.delta.taskIds)];
  const parts = [
    '已采用',
    `计划 v${String(input.planRevision)}`,
    `改 ${String(deltaIds.length)} 个任务（${idsTextOf(deltaIds)}）`,
    // §6.4.2: the impact list is only the candidate's declared ids, never merged
    // with the mechanical delta.
    `影响 ${idsTextOf(input.affectedTaskIds)}`,
    reviewClauseOf(input.review),
    taskbookTextOf(input.exportRead),
  ];
  return parts.filter((part) => part.length > 0).join(' · ');
}

/** §6.4.2: exactly one of the four review states, or the read-failure clause. */
function reviewClauseOf(review: ReadResult<PlanReviewReadV1>): string {
  switch (review.status) {
    case 'rejected':
      return `审阅结论读不到：${review.reason}`;
    case 'not_found':
      return '审阅结论读不到：not_found';
    case 'not_ready':
      return '审阅结论读不到：not_ready';
    case 'ready':
      break;
  }
  const value = review.value;
  switch (value.status) {
    case 'decided':
      return value.verdict === 'pass' ? '审阅 pass' : '审阅要求返修';
    case 'not_sent':
      return '尚未审阅';
    case 'waiting':
      return '审阅中';
    case 'terminal_invalid':
      return `审阅结论无效：${value.reason}`;
  }
}

/** §6.4.3: one line per stage, joined by `；`; failures are text, never a new card. */
function taskbookTextOf(read: TaskbookExportReadV1): string {
  switch (read.status) {
    case 'not_configured':
      return '任务书未导出：没有设置目录';
    case 'unavailable':
      return `任务书状态读不到：${read.reason}`;
    case 'ready':
      return read.stages.map(taskbookStageTextOf).join('；');
  }
}

function taskbookStageTextOf(stage: TaskbookFileStatusV1): string {
  switch (stage.state) {
    case 'written':
      return `任务书 ${stage.stageId} 已导出（${stage.path}）`;
    case 'missing':
      return `任务书 ${stage.stageId} 导出失败：未写出（${stage.path}）；采用不受影响，不自动重试`;
    case 'incomplete':
      return `任务书 ${stage.stageId} 导出不完整（${stage.path}，${String(stage.actualBytes)}/${String(stage.expectedBytes)} 字节）；采用不受影响`;
  }
}

type ReadPageInput = Parameters<DecisionNoticeSourcePort['readPage']>[1];

/**
 * The Goal set of one injected notice read: the filtered Goal itself, or every
 * Goal of this workspace through the existing project index. Both notice
 * sources share this enumeration; a failed or truncated read is `unavailable`,
 * never a silently empty notice list.
 */
export async function planNoticeGoalRefs(
  records: PlanAdoptionNoticeDependencies['records'],
  input: ReadPageInput,
): Promise<readonly GoalRef[]> {
  if (input.goalRef !== undefined) return [input.goalRef];
  let listed: Awaited<ReturnType<typeof listWorkspaceGoals>>;
  try {
    listed = await listWorkspaceGoals(records, input.workspace);
  } catch (error) {
    throw rejected('unavailable', `the notice Goal enumeration failed: ${messageOf(error)}`);
  }
  if (listed.truncated) throw rejected('unavailable', 'the workspace Goal enumeration was truncated');
  return listed.goals.map((goal) => goal.ref);
}

/** One page of adoption items, already sorted, filtered and paginated. */
async function readPlanAdoptionPage(
  deps: PlanAdoptionNoticeDependencies,
  ctx: CoreCallContext,
  input: ReadPageInput,
): Promise<DecisionSourcePageV1<NoticeItemV1>> {
  const { projectId, workspaceId } = input.workspace;
  // The ordered index is by Goal, so a project-wide read enumerates the
  // workspace's Goals first and then reads each one's revisions.
  const planRecords: Awaited<ReturnType<typeof readOrderedToEnd>> = [];
  for (const goalRef of await planNoticeGoalRefs(deps.records, input)) {
    planRecords.push(...await readOrderedToEnd(deps.records,
      S2B_PLAN_REVISION_BY_GOAL_LOOKUP, [projectId, goalRef.goalId], null));
  }
  const acceptedByGoal = new Map<string, ReadResult<readonly PlanProposal[]>>();

  const items: NoticeItemV1[] = [];
  for (const record of planRecords) {
    const decoded = decodePlanRevisionSnapshot(record);
    if (decoded.status !== 'decoded') {
      throw rejected('unavailable', `adopted plan ${record.refKey}: ${decoded.reason}`);
    }
    const plan = decoded.value;
    if (plan.goalRef.projectId !== projectId) continue;
    if (input.goalRef !== undefined && plan.goalRef.goalId !== input.goalRef.goalId) continue;
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: plan.goalRef.goalId };
    const goalRead = await readGoal(deps.records, goalRef);
    if (goalRead.status !== 'ready') throw noticeUnavailableOf(goalRead);
    const goal = goalRead.goal;
    if (input.goalRef === undefined && goal.workspaceRef.workspaceId !== workspaceId) continue;

    // P5's accepted-candidate read is called once per Goal, never re-scanned here.
    let accepted = acceptedByGoal.get(goalRef.goalId);
    if (accepted === undefined) {
      accepted = await deps.acceptedCandidatesOf(goalRef);
      acceptedByGoal.set(goalRef.goalId, accepted);
    }
    if (accepted.status !== 'ready') throw noticeUnavailableOf(accepted);
    // `acceptedCandidatesOf` already returns only accepted candidates; the
    // adoption target alone selects this PlanRevision's one candidate.
    const proposal = accepted.value.find((candidate) =>
      planRevisionRefKey(planRevisionTargetOf(candidate.ref, candidate.draft)) === planRevisionRefKey(plan.ref));
    if (proposal === undefined) continue;

    const proposalKey = planProposalRefKey(proposal.ref);
    const proposalRead = await deps.records.readMany([proposalKey]);
    if (proposalRead.status !== 'ready') throw rejected('unavailable', proposalRead.reason);
    const proposalRecord = proposalRead.value.records.find((candidate) => candidate.refKey === proposalKey);
    if (proposalRecord === undefined) {
      throw rejected('unavailable', `adopted plan candidate ${proposalKey} is missing`);
    }
    const origin = decodePlanProposalOrigin(proposalRecord);
    if (origin.status !== 'decoded') {
      throw rejected('unavailable', `adopted plan candidate origin ${proposalKey}: ${origin.reason}`);
    }
    // DR-P6-02 / P1b: `until` is the adoption commit cursor. Before P1b lands it
    // is not on the decoded origin yet; this frozen line is the known break.
    const cursor: CommitCursor | undefined = origin.value.until;
    // 没有 until 的已采用候选是本片之前采用的：不产生项，也不是读失败。
    if (cursor === undefined || cursor === null) continue;

    const review = await deps.reviews.read(ctx, {
      goalRef, proposalRef: proposal.ref, revision: proposal.revision - 1,
    });
    const exportRead = await deps.exports.read({
      plan, scope: { projectId, workspaceId, goalId: goalRef.goalId },
    });
    const delta = await adoptionDeltaOf(deps.records, plan, proposal);
    const itemKey = `plan-adoption:${plan.ref.planId}:${String(plan.planRevision)}`;
    items.push({
      itemKey,
      category: 'plan_adoption',
      subject: { kind: 'goal', goalRef },
      position: { kind: 'commit', cursor, itemKey },
      summary: planAdoptionSummaryOf({
        planRevision: plan.planRevision,
        delta,
        affectedTaskIds: proposal.reason.affectedTaskIds ?? [],
        review,
        exportRead,
      }),
      objects: [
        { kind: 'aggregate', pin: { ref: plan.ref, revision: plan.revision }, label: 'adopted-plan' },
        { kind: 'aggregate', pin: { ref: proposal.ref, revision: proposal.revision }, label: 'candidate' },
        { kind: 'aggregate', pin: { ref: goalRef, revision: goal.revision }, label: 'goal' },
      ],
      rework: null,
    });
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

/**
 * The one notice failure mapping: a non-ready read is `unavailable`; the
 * notice's failures never fall back to an empty item list.
 */
export function noticeUnavailableOf(result: ReadResult<unknown>) {
  if (result.status === 'rejected') return rejected('unavailable', result.reason);
  if (result.status === 'not_ready') return rejected('unavailable', 'the notice read is not ready');
  return rejected('unavailable', 'the notice fact is not available');
}

/**
 * §6.4.2: the delta source is the candidate's `basedOn` snapshot and the target
 * is the candidate draft. The first plan has no source: every one of its tasks
 * is "changed". A missing/damaged source is a read failure; a delta the machine
 * cannot represent is the same `unavailable` exit, never a second notice type.
 */
async function adoptionDeltaOf(
  records: PlanAdoptionNoticeDependencies['records'],
  plan: PlanRevisionSnapshot,
  proposal: PlanProposal,
): Promise<PlanAdoptionDeltaV1> {
  if (proposal.basedOn === null) {
    return { status: 'supported', taskIds: plan.tasks.map((task) => task.taskId) };
  }
  const sourceRead = await readPlan(records, proposal.basedOn);
  if (sourceRead.status !== 'ready') throw noticeUnavailableOf(sourceRead);
  const result = deriveFuturePlanDelta(sourceRead.plan, proposal.draft);
  if (result.status === 'unsupported') throw rejected('unavailable', result.reason);
  return { status: 'supported', taskIds: deltaTaskIdsOf(result.delta) };
}

/** The four groups in the spec's order, each task once. */
function deltaTaskIdsOf(delta: FuturePlanDelta): string[] {
  return [...new Set([
    ...delta.addedTaskIds,
    ...delta.changedTaskIds,
    ...delta.cancelledTaskIds,
    ...delta.dispositionOnlyTaskIds,
  ])];
}

export function idsTextOf(ids: readonly string[]): string {
  return ids.length === 0 ? '无' : ids.join('、');
}
