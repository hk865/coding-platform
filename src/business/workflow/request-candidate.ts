/**
 * S1: one ended plan-turn request round becomes this request's plan candidate.
 *
 * The Host has already read the round and handed its exact facts here; this
 * entry reads the saved answer (never the Host), reuses the initial-plan
 * normalization and the existing `plans.proposePlan` commit, and keeps the
 * request's own candidate chain (`replaces` is the current head). It adds no
 * route, record, event or index: the candidate is read back through
 * `plans/request-candidate`.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { GoalRef } from '../../contracts/ledger.js';
import { messageOf } from '../../contracts/error-message.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { GoalDetail, PlanProposalRef } from '../../core/work-graph/model/plan-contracts.js';
import { planProposalIdFor } from '../../core/work-graph/tasks/plan-service.js';
import {
  normalizeInitialPlanningResponseV2, parseInitialPlanningResponseV2,
} from '../../core/work-graph/tasks/initial-plan.js';
import { mergeStageRefinement } from '../../core/work-graph/tasks/stage-segment.js';
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

/**
 * The plan-turn entry. A replay is the deterministic `requestId`/`proposalId`
 * read first; an answer that is not a plan-round plan writes nothing.
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
  // The request's first round points at itself; any later round of the request is the followup.
  if (turn.ref.queryJobId === turn.requestRoot.queryJobId) return skipped('not_followup');
  const goalId = turn.goalId as string | null;
  if (goalId === null || goalId === '') return skipped('no_goal');

  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
  const requestId = `request-candidate:${turn.ref.queryJobId}`;
  const proposalId = planProposalIdFor({ projectId: ctx.projectId, workspaceId,
    goalId, requestId });
  const proposalRef: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: ctx.projectId,
    workspaceId, proposalId };

  // The deterministic identity makes a round-end replay read its own candidate before writing.
  const existing = await deps.plans.readPlanProposal(ctx, proposalRef);
  if (existing.status === 'ready') return { status: 'done' };
  if (existing.status !== 'not_found') return failureOfRead(existing);

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
  if (proposed.status === 'committed') return { status: 'done' };
  return failureOf(proposed);
}
