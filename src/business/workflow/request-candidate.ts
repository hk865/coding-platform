/**
 * S1: one ended plan-turn request round becomes this request's plan candidate.
 *
 * The Host has already read the round and handed its exact facts here; this
 * entry reads the saved answer (never the Host), reuses the initial-plan
 * normalization and the existing `plans.proposePlan` commit, and keeps the
 * request's own candidate chain (`replaces` is the current head). It adds no
 * route, record, event or index: the candidate is read back through
 * `plans/request-candidate`.
 *
 * 121-112: a small candidate a secretary arranged in its own round is adopted at
 * once under the platform identity; every other candidate waits for the person.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { GoalRef } from '../../contracts/ledger.js';
import { messageOf } from '../../contracts/error-message.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import { sameJson } from '../../contracts/fingerprint.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../contracts/plan.js';
import type {
  GoalDetail, PlanProposal, PlanProposalRef,
} from '../../core/work-graph/model/plan-contracts.js';
import { planProposalIdFor } from '../../core/work-graph/tasks/plan-service.js';
import {
  normalizeInitialPlanningResponseV2, parseInitialPlanningResponseV2,
} from '../../core/work-graph/tasks/initial-plan.js';
import { deriveFuturePlanDelta } from '../../core/work-graph/tasks/plan-validation.js';
import { mergeStageRefinement } from '../../core/work-graph/tasks/stage-segment.js';
import { automationContext, ownContext } from './workflow.js';
import type {
  PlanRoundEndResultV1, PlanTurnFactsV1, WorkflowDependencies,
} from './ports.js';

/** The Plan/request reads the entry takes; all are already on the injected Workflow bag. */
type PlanTurnDependencies = Pick<WorkflowDependencies, 'plans' | 'requestCandidates' | 'requests'>;

function skipped(reason: string, transient = false): PlanRoundEndResultV1 {
  return { status: 'skipped', reason, transient };
}

/** A real failure: `unavailable`/`incomplete`/conflict/busy may lift on the next pass. */
function failureOf(result: CoreRejection): PlanRoundEndResultV1 {
  const transient = result.code === 'unavailable' || result.code === 'incomplete'
    || result.code === 'cancelled' || result.code === 'revision_conflict'
    || result.code === 'idempotency_conflict' || result.code === 'busy';
  return { status: 'failed', reason: `${result.code}: ${result.reason}`, transient };
}

function failureOfRead(result: Exclude<ReadResult<unknown>, { status: 'ready' }>): PlanRoundEndResultV1 {
  if (result.status === 'rejected') return failureOf(result);
  if (result.status === 'not_found') return { status: 'failed', reason: 'not_found', transient: false };
  return { status: 'failed', reason: 'the read did not reach its required watermark', transient: true };
}

/** 121-112: at most 3 new Tasks, and no existing Task changes (108-3's narrow exception skips review only for this). */
const SMALL_ARRANGEMENT_MAX_NEW_TASKS = 3;

function smallArrangement(source: PlanRevisionSnapshot, target: PlanRevisionDraft): boolean {
  const result = deriveFuturePlanDelta(source, target);
  if (result.status !== 'supported') return false;
  const { addedTaskIds, changedTaskIds, dispositionOnlyTaskIds } = result.delta;
  // cancelledTaskIds also lists every old non-active Task, changed or not (plan-validation.ts:421): not used here.
  if (addedTaskIds.length < 1 || addedTaskIds.length > SMALL_ARRANGEMENT_MAX_NEW_TASKS
    || changedTaskIds.length !== 0 || dispositionOnlyTaskIds.length !== 0) return false;
  // "No existing Task changes" includes when it may start: an old Task must not gain a dependency on a new one.
  const oldTaskIds = new Set(source.tasks.map(task => task.taskId));
  const newTaskIds = new Set(addedTaskIds);
  return !target.executionDag.dependsOn.some(edge =>
    oldTaskIds.has(edge.taskId) && newTaskIds.has(edge.dependsOnId));
}

/** A small candidate the secretary arranged is adopted at once under the platform identity; anything else waits. */
async function adoptSmall(deps: PlanTurnDependencies, ctx: CoreCallContext,
  candidate: PlanProposal): Promise<PlanRoundEndResultV1> {
  if (candidate.status !== 'candidate' || candidate.basedOn === null) return { status: 'done' };
  const goalRead = await deps.plans.queryGoal(ctx, candidate.goalRef);
  if (goalRead.status !== 'ready') return failureOfRead(goalRead);
  const goal = goalRead.value.goal;
  // A candidate whose base is no longer the active plan is stale: the person decides, and a retry ends here.
  if (!sameJson(goal.activePlanRevision, candidate.basedOn)) return { status: 'done' };
  const source = await deps.plans.queryTaskGraph(ctx, { goalRef: goal.ref, planRef: candidate.basedOn });
  if (source.status !== 'ready') return failureOfRead(source);
  if (!smallArrangement(source.value.plan, candidate.draft)) return { status: 'done' };
  const owned = ownContext(ctx);
  if ('rejection' in owned) return failureOf(owned.rejection);
  const adopted = await deps.plans.applyPlanChange(automationContext(owned), {
    input: { proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [] },
    meta: { requestId: `${candidate.ref.proposalId}:adopt`, expected: [
      { ref: goal.ref, revision: goal.revision }, { ref: candidate.ref, revision: candidate.revision }] },
  });
  if (adopted.status === 'committed') return { status: 'done' };
  // Owner refusals (every-step autonomy, a new objective, a cancelled Goal, guard 9) leave it for the person.
  const failed = failureOf(adopted);
  if (failed.status === 'failed' && failed.transient) return failed;
  return { status: 'done' };
}

/**
 * The plan-turn entry. A replay reads the deterministic `requestId`/`proposalId`
 * after its saved answer parses; an answer that is not a plan writes nothing.
 */
export async function proposeFromPlanTurn(
  deps: PlanTurnDependencies,
  ctx: CoreCallContext,
  turn: PlanTurnFactsV1,
): Promise<PlanRoundEndResultV1> {
  if (deps.requestCandidates === undefined) return skipped('unsupported');
  if (deps.requests === undefined) return skipped('unsupported');
  const readFacts = deps.plans.readInitialPlanAnswerFacts;
  if (readFacts === undefined) return skipped('unsupported');
  const workspaceId = ctx.workspaceId;
  if (workspaceId === undefined || workspaceId === '') return skipped('no_plan');
  const goalId = turn.goalId as string | null;
  if (goalId === null || goalId === '') return skipped('no_goal');

  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
  const requestId = `request-candidate:${turn.ref.queryJobId}`;
  const proposalId = planProposalIdFor({ projectId: ctx.projectId, workspaceId,
    goalId, requestId });
  const proposalRef: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: ctx.projectId,
    workspaceId, proposalId };

  let factsRead;
  try {
    factsRead = await readFacts.call(deps.plans, ctx, turn.answerRef,
      { kind: 'request_followup', answerRef: turn.answerRef });
  } catch (error) {
    return { status: 'failed', reason: `the plan answer read failed: ${messageOf(error)}`, transient: true };
  }
  if (factsRead.status !== 'ready') {
    // A missing/foreign answer or a round that is not the plan-round preparation writes nothing.
    if (factsRead.status === 'not_found') return skipped('no_plan');
    if (factsRead.status === 'rejected'
      && (factsRead.code === 'source_stale' || factsRead.code === 'invalid'
        || factsRead.code === 'forbidden' || factsRead.code === 'unsupported')) return skipped('no_plan');
    return failureOfRead(factsRead);
  }
  const facts = factsRead.value;
  const parsed = parseInitialPlanningResponseV2(facts.answerText);
  if (parsed.status !== 'parsed') return skipped('no_plan');
  const normalized = normalizeInitialPlanningResponseV2(parsed.response, facts);
  if (normalized.status !== 'plan') return skipped('no_plan');

  // The secretary arranged the change in its own round; every other round still waits for the person.
  const direct = facts.manifest.answerShape === 'secretary';
  // The deterministic identity makes a round-end replay read its own candidate before writing. A replay also
  // retries a transient adoption failure; a candidate the person already decided reads `done`.
  const existing = await deps.plans.readPlanProposal(ctx, proposalRef);
  if (existing.status === 'ready') return direct ? await adoptSmall(deps, ctx, existing.value) : { status: 'done' };
  if (existing.status !== 'not_found') return failureOfRead(existing);

  let goalRead: ReadResult<GoalDetail>;
  try {
    goalRead = await deps.plans.queryGoal(ctx, goalRef);
  } catch (error) {
    return { status: 'failed', reason: `the Goal read failed: ${messageOf(error)}`, transient: true };
  }
  if (goalRead.status !== 'ready') return failureOfRead(goalRead);
  const goal = goalRead.value.goal;
  const basedOn = goal.activePlanRevision;

  // A candidate written against a source Plan merges this round's segment into it; a first candidate keeps its
  // own request-followup origin. Only an adopted source makes `basedOn` non-null.
  let draft = normalized.draft;
  if (basedOn !== null) {
    const graphRead = await deps.plans.queryTaskGraph(ctx, { goalRef, planRef: basedOn });
    if (graphRead.status !== 'ready') return failureOfRead(graphRead);
    const { origin: _segmentOrigin, ...segment } = normalized.draft;
    const merged = mergeStageRefinement(graphRead.value.plan,
      { ...segment, planRevision: graphRead.value.plan.planRevision + 1 });
    if (merged.status !== 'merged') return skipped('no_plan', false);
    draft = merged.draft;
  }

  const headRead = await deps.requestCandidates.readRequestCandidate(ctx, { goalRef, requestRef: turn.requestRoot });
  if (headRead.status !== 'ready') return failureOfRead(headRead);
  const head = headRead.value.head;
  // The request's own round order decides whether the head came from a later round: a retry of an
  // earlier round must not replace it (the later version replaces the earlier one).
  if (head !== null) {
    const requestRead = await deps.requests.readRequest(ctx, { requestRoot: turn.requestRoot });
    if (requestRead.status !== 'ready') return failureOfRead(requestRead);
    const headIndex = requestRead.value.rounds.findIndex((round) => planProposalIdFor({
      projectId: ctx.projectId, workspaceId, goalId, requestId: `request-candidate:${round.ref.queryJobId}`,
    }) === head.ref.proposalId);
    const thisIndex = requestRead.value.rounds.findIndex((round) => round.ref.queryJobId === turn.ref.queryJobId);
    if (thisIndex >= 0 && headIndex > thisIndex) {
      return { status: 'skipped', reason: 'superseded_by_later_round', transient: false };
    }
  }
  const answerReason = parsed.response.kind === 'plan' ? parsed.response.reason : undefined;

  const proposed = await deps.plans.proposePlan(ctx, {
    input: {
      goalRef,
      basedOn,
      draft,
      reason: {
        text: normalized.summary,
        sources: [facts.answer.bodyRef],
        affectedTaskIds: answerReason?.affectedTaskIds ?? [],
        ...(answerReason?.objective === undefined ? {} : { objective: answerReason.objective }),
      },
      requestRef: turn.requestRoot,
      sourceMessageRef: null,
      replaces: head === null ? null : { proposalRef: head.ref, revision: head.revision },
    },
    meta: { requestId, expected: [{ ref: goal.ref, revision: goal.revision }] },
  });
  if (proposed.status !== 'committed') return failureOf(proposed);
  return direct ? await adoptSmall(deps, ctx, proposed.value) : { status: 'done' };
}
