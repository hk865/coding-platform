/**
 * `plan_notice` notice source (slice-PL-SPEC §5.8, §6.4.1/§6.4.2, C-35).
 *
 * Stage-end arm: a stage produces one "please be aware" item when its stage
 * gate is satisfied and that gate has a finalized `PASS` VerificationRound in
 * this PlanRevision. The item carries the six readings of §5.8, reusing
 * `stageReadingOf` and `stageOverLine`; a re-verification keeps the earliest
 * round's `since`, so the position never moves and a re-read never appends.
 *
 * Deviation arm: the adviser answered a `deviation:` round with plain text, so
 * the plan is not changed. The arm enumerates the historical source messages R
 * of every adopted PlanRevision (never the current `deviationsOfGoal` result),
 * reuses the four facts R already stored, reads R's deterministic
 * `intervention_planning` Query/Answer, and takes the reply commit cursor from
 * the fixed `intervention:<messageKey>:respond` receipt. A legal plan/questions
 * answer produces no item; a read failure is `unavailable`, never empty.
 *
 * No-line arm (slice 9 §3.3): an open round whose command checks are done, whose plan has the review item and whose
 * `execreview:` message was never sent because its workspace has no review line gives one item, re-projected from
 * the current facts (no record, no cache): it names the Task and says to open a line through `role-lines/open`, or,
 * when the project's line is in another workspace, that joined-workspace exec review is not connected yet.
 * A failed read of this arm (the message, the line, the position) makes the source not available for that read: never
 * "no line", and never the whole queue (lead ruling s9g3 1, as 121-105); a cancelled read is returned whole.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { compareCursors } from '../../../contracts/ledger.js';
import { reviewPacketItemOf } from '../../../contracts/verification.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import {
  GROWTH_UNIT_TOKENS, growthUnitsOf, type PlanLoopLimitsV1, type TaskSizeClassV1,
} from '../../../contracts/plan-loop-limits.js';
import { interventionPlanningQueryRefs } from '../../../contracts/query-job.js';
import { parseInitialPlanningResponseV2 } from '../../../contracts/initial-planning-parse.js';
import { systemRoundMessageRef, systemRoundRequestId } from '../../../contracts/plan-round.js';
import { roundCommitIdentityOf } from '../evidence/evidence-service.js';
import { reviewLineOf, type DutyRecipientPort, type ReviewLineV1 } from '../sessions/duty-recipient.js';
import type { RecordCommitIdentityPort } from '../../record-store/ports.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type {
  DecisionNoticeSourcePort, DecisionSourcePageV1, NoticeItemV1, S5RecordPort,
} from '../model/decision-contracts.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
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
import { sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import type { QueryJobPort } from '../queries/contracts.js';
import type { ActivityReadPort } from './activity-read-model.js';
import { readWatermark } from './activity-read-helpers.js';
import { paginateAssembled, readOrderedToEnd } from './automatic-rework-notices.js';
import { compareNoticePositions } from './notice-position.js';
import { idsTextOf, noticeUnavailableOf, planNoticeGoalRefs } from './plan-adoption-notices.js';
import { readGoal } from '../tasks/plan-readers.js';
import { readTaskRunActivities } from '../tasks/goal-deviation-facts.js';
import { respondReceiptIdentityOf } from '../communication/mailbox-service.js';
import { stageIdOf } from '../notes/note-related-scope.js';

export type PlanNoticeDependencies = {
  records: S5RecordPort & RecordOrderedLookupPort;
  plans: Pick<PlanTaskPort, 'queryTaskGraph'>;
  runs: { listExecutions: NonNullable<ExecutionReadPort['listExecutions']> };
  activities: Pick<ActivityReadPort, 'readRunActivities'>;
  /** The source message R and its stored body (the four facts R already carries). */
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>;
  /** R's deterministic `intervention_planning` Query and its formal answer. */
  queries: Pick<QueryJobPort, 'readQueryJob' | 'readQueryAnswer'>;
  /** The reply commit cursor of `intervention:<messageKey>:respond`. */
  commitIdentities: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>;
  /** The Host's effective §10.3 value, read per page (never frozen at construction). */
  limits: () => PlanLoopLimitsV1;
  /** Slice 9: the one duty recipient read; the no-line arm decides through it with `reviewLineOf`, as Workflow does. */
  resolveDutyRecipient: DutyRecipientPort['resolveDutyRecipient'];
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

/** §7.1.1: the four `DeviationKindV1` arms, each one `deviation:` request id. */
const DEVIATION_KINDS = ['growth', 'lines', 'budget', 'stop'] as const;

/** Builds the `plan_notice` notice source: the stage-end and deviation arms. */
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
  // §10.3: the one effective value this page judges with; the same getter the
  // shared deviation reader reads, never the construction-time defaults.
  const limits = deps.limits();
  // The ordered index is by Goal, so a project-wide read enumerates the
  // workspace's Goals first (the same helper the adoption source uses).
  const planRecords: Awaited<ReturnType<typeof readOrderedToEnd>> = [];
  for (const goalRef of await planNoticeGoalRefs(deps.records, input)) {
    planRecords.push(...await readOrderedToEnd(deps.records,
      S2B_PLAN_REVISION_BY_GOAL_LOOKUP, [projectId, goalRef.goalId], null));
  }

  const items: NoticeItemV1[] = [];
  // The page's one review-line decision (Workflow's `reviewLineOf`), made only when a round needs it. The rounds are
  // read by this page's workspace, so it is each round's own workspace.
  let reviewLine: ReviewLineV1 | undefined;
  const reviewLineHere = async (): Promise<ReviewLineV1> => {
    if (reviewLine === undefined) {
      const read = await reviewLineOf(deps, ctx, { projectId, workspaceId });
      if (read.status !== 'ready') throw noticeUnavailableOf(read);
      reviewLine = read.value;
    }
    return reviewLine;
  };
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
      const overLine = stageOverLine(reading, limits);
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
          limits,
        }),
        objects: [],
        rework: null,
      });
    }
    // §6.4.2: the same source projects "the plan is not changed" from this
    // PlanRevision's historical deviation source messages, not from the
    // current `deviationsOfGoal` result.
    items.push(...await deviationItemsOf(deps, ctx, plan, projectId, workspaceId));
    try {
      items.push(...await noReviewLineItemsOf(deps, ctx, plan, rounds, reviewLineHere));
    } catch (error) {
      if (ctx.signal?.aborted === true) throw error;
      return { availability: 'not_available', items: [], nextCursor: null, sourceCursor: null };
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

/** §5.8/§10.5: the stage's work Runs through the shared paging/activity reader. */
async function stageReadingOfTasks(
  deps: PlanNoticeDependencies,
  ctx: CoreCallContext,
  goalRef: GoalRef,
  workTasks: readonly TaskRow[],
): Promise<StageReadingV1> {
  const tasks: { estimatedLines?: number;
    readings: readonly { usage: StageReadingV1['usage']; lines: StageReadingV1['lines'] }[] }[] = [];
  for (const row of workTasks) {
    const read = await readTaskRunActivities(deps, ctx, goalRef, row.ref.taskId);
    if (read.status !== 'ready') throw noticeUnavailableOf(read);
    // A cancelled or superseded Task plans no lines: only a live Task without an estimate leaves the stage unknown.
    const estimate = row.definition.disposition === 'cancelled' || row.definition.disposition === 'superseded'
      ? 0 : row.definition.estimatedLines;
    tasks.push({
      ...(estimate === undefined ? {} : { estimatedLines: estimate }),
      readings: read.value.readings,
    });
  }
  return stageReadingOf(tasks);
}

/**
 * §6.4.2: the deviation arm. It enumerates the history of this adopted
 * PlanRevision (Task x the four kinds -> the deterministic request id), reads
 * the source message R it finds, and projects one item per text-fallback
 * answer. A legal plan/questions answer writes a candidate/card through the
 * goal loop and produces no item here; every read failure stays `unavailable`.
 */
async function deviationItemsOf(
  deps: PlanNoticeDependencies,
  ctx: CoreCallContext,
  plan: PlanRevisionSnapshot,
  projectId: string,
  workspaceId: string,
): Promise<NoticeItemV1[]> {
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: plan.goalRef.goalId };
  const scope = { projectId, workspaceId };
  const items: NoticeItemV1[] = [];
  for (const task of plan.tasks) {
    for (const kind of DEVIATION_KINDS) {
      const requestId = `deviation:${goalRef.goalId}:${task.taskId}:${kind}:${String(plan.planRevision)}`;
      const messageRef = systemRoundMessageRef(scope, requestId);
      if (messageRef.status !== 'ready') throw messageRef;
      const message = await deps.messages.readMessage(ctx, messageRef.value);
      if (message.status === 'not_found') continue;
      if (message.status !== 'ready') throw noticeUnavailableOf(message);
      const body = await deps.messages.readMessageBody(ctx,
        { messageRef: messageRef.value, part: 'message' });
      if (body.status !== 'ready') throw noticeUnavailableOf(body);
      const queryRefs = interventionPlanningQueryRefs(messageRef.value);
      const job = await deps.queries.readQueryJob(ctx, queryRefs.queryJobRef);
      if (job.status === 'not_found') continue;
      if (job.status !== 'ready') throw noticeUnavailableOf(job);
      const answerRef = job.value.job.job.answerRefs.at(-1);
      if (answerRef === undefined) continue;
      const answer = await deps.queries.readQueryAnswer(ctx, answerRef);
      if (answer.status !== 'ready') throw noticeUnavailableOf(answer);
      const answerText = answer.value.answer.answer;
      // §6.4.2: only the text fallback says "the plan is not changed"; an empty
      // stored answer has nothing to show.
      if (answerText.length === 0) continue;
      if (parseInitialPlanningResponseV2(answerText).status === 'parsed') continue;
      const identity = await respondReceiptIdentityOf(ctx, deps.records, messageRef.value,
        `intervention:${sessionMessageRefKey(messageRef.value)}:respond`);
      if (identity.status === 'not_found') continue;
      if (identity.status !== 'ready') throw noticeUnavailableOf(identity);
      const receipt = await deps.commitIdentities.readCommitByIdentity(identity.value);
      if (receipt.status !== 'ready') {
        if (receipt.code === 'not_found') continue;
        throw rejected('unavailable', receipt.reason);
      }
      const itemKey = `deviation-notice:${goalRef.goalId}:${requestId}`;
      items.push({
        itemKey,
        category: 'plan_notice',
        subject: { kind: 'goal', goalRef },
        position: { kind: 'commit', cursor: receipt.value.receipt.cursor, itemKey },
        summary: `${storedFactsOf(body.value.text)}${growthUnitsLineOf(body.value.text)}`
          + ` · 参谋不改计划 · ${answerText}`,
        objects: [],
        rework: null,
      });
    }
  }
  return items;
}

/**
 * Slice 9 §3.3: the no-line items of this version's rounds (a round belongs to the version it was opened under, so
 * each round is judged once). The condition is re-read every time: an open round with the review item, every command
 * check done, no `execreview:` message and no review line in the round's workspace. The text says which: no line in
 * the project, or a line only in another workspace (joined-workspace exec review is not connected yet).
 */
async function noReviewLineItemsOf(
  deps: PlanNoticeDependencies,
  ctx: CoreCallContext,
  plan: PlanRevisionSnapshot,
  rounds: readonly RoundWithSince[],
  reviewLineHere: () => Promise<ReviewLineV1>,
): Promise<NoticeItemV1[]> {
  const planKey = planRevisionRefKey(plan.ref);
  const items: NoticeItemV1[] = [];
  for (const { snapshot: round, since } of rounds) {
    if (round.status !== 'open' || planRevisionRefKey(round.adoptedPlanRef) !== planKey) continue;
    if (reviewPacketItemOf(round.verificationPlan) === undefined) continue;
    if (round.checks.some((check) => check.phase === 'pending' || check.phase === 'executing')) continue;
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: round.ref.projectId, goalId: round.ref.goalId };
    const scope = { projectId: round.ref.projectId, workspaceId: round.ref.workspaceId };
    const requestId = systemRoundRequestId({ kind: 'exec_review', goalRef, roundRef: round.ref });
    if (requestId.status !== 'ready') throw requestId;
    const messageRef = systemRoundMessageRef(scope, requestId.value);
    if (messageRef.status !== 'ready') throw messageRef;
    const message = await deps.messages.readMessage(ctx, messageRef.value);
    if (message.status === 'ready') continue;
    if (message.status !== 'not_found') throw noticeUnavailableOf(message);
    const line = await reviewLineHere();
    if (line.kind === 'here') continue;
    const itemKey = `exec-review-no-line:${goalRef.goalId}:${round.ref.roundId}`;
    const task = plan.tasks.find((candidate) => candidate.taskId === round.subject.taskId);
    items.push({
      itemKey,
      category: 'plan_notice',
      subject: { kind: 'goal', goalRef },
      position: { kind: 'commit', cursor: await noLinePositionOf(deps, round, since), itemKey },
      summary: `任务 ${round.subject.taskId}「${task?.title ?? round.subject.taskId}」的检查已跑完，执行结果审阅在等：`
        + (line.kind === 'none' ? '项目里没有审阅线；用 role-lines/open（duty: reviewer）开一条，同一轮接着审'
          : '审阅线不在这个工作区（角色线都开在主工作区）；加入的工作区的执行结果审阅还没接通，这一轮先停在这里'),
      objects: [],
      rework: null,
    });
  }
  return items;
}

/**
 * Slice 9 §3.3 / S9-N6: where the no-line item sits — the newest result commit of the round's finished command
 * checks, read by its identity, or the round's opening commit (the `since` the Store bound in that commit) when no
 * check finished. An interrupted check's commit has no identity this read can derive (its request names the
 * reconciling Host instance), so it is passed over (lead ruling s9g3, after hand-back #1: one notice never fails the
 * whole queue). A failed read is `unavailable`.
 */
async function noLinePositionOf(
  deps: PlanNoticeDependencies, round: RoundSnapshot, since: CommitCursor,
): Promise<CommitCursor> {
  const scope = { projectId: round.ref.projectId, workspaceId: round.ref.workspaceId };
  let newest = since;
  for (const check of round.checks) {
    if (check.phase !== 'finished') continue;
    if (check.invocationId === null) {
      throw rejected('unavailable', `round ${round.ref.roundId}: a finished check has no invocation`);
    }
    const read = await deps.commitIdentities.readCommitByIdentity(
      roundCommitIdentityOf('record', round.executor, scope, `r3e-check-result-${check.invocationId}`));
    if (read.status !== 'ready') throw rejected('unavailable', read.reason);
    if (compareCursors(read.value.receipt.cursor, newest) > 0) newest = read.value.receipt.cursor;
  }
  return newest;
}

/** §6.4.2: R's first line is the request id; the rest are its four stored facts. */
function storedFactsOf(body: string): string {
  const newline = body.indexOf('\n');
  return newline === -1 ? body : body.slice(newline + 1);
}

/**
 * §10.5: the 64-token growth-unit calibration is a conversion beside the token
 * figure, never a second threshold. A body whose growth is unknown gets none.
 */
function growthUnitsLineOf(body: string): string {
  const match = /^growth: (?:at least )?(\d+)/m.exec(body);
  if (match === null) return '';
  return ` · 增长当量 ${String(growthUnitsOf(Number(match[1])))}（${String(GROWTH_UNIT_TOKENS)} token/单位）`;
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

