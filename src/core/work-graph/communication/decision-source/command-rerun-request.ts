import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../../contracts/core/results.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import type { CommandRerunRequestV1 } from '../../../../contracts/command-rerun-request.js';
import { commandRerunRequestCardFacts } from '../../tasks/command-rerun-request-card.js';
import { readTaskClosure } from '../../tasks/plan-readers.js';
import { clonePins } from './read-support.js';
import type { SourceDependencies, SourceReadResult, SourceReadSupport } from './types.js';

/** The CRR ref names a stored aggregate even though AggregateRef does not include it. */
function requestPinOf(request: CommandRerunRequestV1): VersionPin {
  return { ref: structuredClone(request.ref) as unknown as VersionPin['ref'], revision: request.revision };
}

/** The `command_rerun_request` decision source: the real request, its review and the blocked command. */
export async function readCommandRerunRequestSource(
  support: SourceReadSupport,
  ctx: CoreCallContext,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'command_rerun_request' }>,
  deps: SourceDependencies,
  goalRef: GoalRef,
): Promise<SourceReadResult> {
  let goal: GoalSnapshot;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  let allowedReaderSessionRefs: SessionRef[] = [];
  // Re-derive the whole card from the real request, its review
  // record, the original Run's Kernel command and the Goal window. The
  // caller's pins are never trusted.
  const requestProblem = support.scopeProblem(identity.requestRef);
  if (requestProblem !== null) return requestProblem;
  const goalProblem = support.scopeProblem(goalRef);
  if (goalProblem !== null) return goalProblem;
  const goalRead = await support.readGoal(goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.workspaceRef.projectId !== support.scope.projectId || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the request source Goal is outside the bound scope');
  }
  if (deps.commandRerunRequests === undefined || deps.unknownCallReviews === undefined
    || deps.readKernelCommandFacts === undefined || deps.commandRerunExecutions === undefined) {
    return rejectedWithCurrent('unavailable', 'the CommandRerunRequest readers are not bound for a command_rerun_request source');
  }
  const requestRead = await deps.commandRerunRequests.readRequest(ctx, { ref: identity.requestRef });
  if (requestRead.status === 'not_found') return rejectedWithCurrent('not_found', 'the rerun request does not exist');
  if (requestRead.status !== 'ready') return requestRead;
  const request = requestRead.value;
  if (request.revision !== identity.revision) {
    return rejectedWithCurrent('revision_conflict', 'the rerun request moved since the card was read',
      [requestPinOf(request)]);
  }
  if (request.ref.goalId !== goal.ref.goalId) {
    return rejectedWithCurrent('invalid', 'the rerun request belongs to another Goal');
  }
  const reviewRead = await deps.unknownCallReviews.readReview(ctx, { ref: request.reviewRef });
  if (reviewRead.status === 'not_found') return rejectedWithCurrent('not_found', 'the request review record does not exist');
  if (reviewRead.status !== 'ready') return reviewRead;
  const record = reviewRead.value;
  if (record.task.goalId !== goal.ref.goalId) {
    return rejectedWithCurrent('invalid', 'the request review record belongs to another Goal');
  }
  // The ONE canonical Task closure, not the Plan disposition.
  const closure = await readTaskClosure(support.records, goal.ref, request.ref.taskId);
  if (closure.status !== 'ready') return closure;
  const taskActive = !closure.value.closed;
  const blocked = record.blockedCommands.find(entry =>
    entry.reviewRunId === request.reviewRef.runId && entry.alias === request.alias);
  if (blocked === undefined) {
    return rejectedWithCurrent('unavailable',
      `the blocked command #${String(request.alias)} of ${request.reviewRef.runId} is not recorded`);
  }
  let execution;
  try {
    execution = await deps.commandRerunExecutions.readExecution(ctx, record.runRef);
  } catch (error) {
    const failure = error as { status?: unknown; code?: unknown } | null;
    if (failure !== null && typeof failure === 'object' && failure.status === 'rejected'
      && typeof failure.code === 'string') {
      return failure as unknown as CoreRejection;
    }
    return rejectedWithCurrent('unavailable', 'the original Run is not readable for the blocked command');
  }
  if (execution.status !== 'ready') {
    return execution.status === 'rejected' ? execution
      : rejectedWithCurrent('unavailable', 'the original Run is not readable for the blocked command');
  }
  const factsRead = await deps.readKernelCommandFacts(ctx, { session: execution.value.session,
    calls: [blocked.kernelCallRef],
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }) });
  if (factsRead.status !== 'ready') {
    return factsRead.status === 'rejected' ? factsRead
      : rejectedWithCurrent('unavailable', 'the blocked command text is not readable from the Kernel');
  }
  const blockedText = factsRead.value.get(blocked.kernelCallRef.callId)?.command ?? null;
  if (blockedText === null) {
    return rejectedWithCurrent('unavailable', 'the blocked command text is not readable from the Kernel');
  }
  const siblings: CommandRerunRequestV1[] = [];
  let siblingCursor: string | undefined;
  for (;;) {
    const page = await deps.commandRerunRequests.listRequests(ctx, {
      workspace: { projectId: support.scope.projectId, workspaceId: support.scope.workspaceId },
      filter: { goalId: request.ref.goalId, taskId: request.ref.taskId },
      page: { limit: 200, ...(siblingCursor === undefined ? {} : { cursor: siblingCursor }) },
    });
    if (page.status !== 'ready') {
      return page.status === 'rejected' ? page
        : rejectedWithCurrent('unavailable', 'the alias rerun requests are not readable');
    }
    siblings.push(...page.value.items);
    if (page.value.nextCursor === null) break;
    siblingCursor = page.value.nextCursor;
  }
  const facts = commandRerunRequestCardFacts({ request, review: record, goal,
    blockedCommandText: blockedText, aliasRequests: siblings, taskActive });
  pins = clonePins(facts.source.pins);
  objects = facts.objects.map((object) => structuredClone(object));
  options = facts.closedReason === null ? facts.options.map((option) => structuredClone(option)) : [];
  goalBases = (facts.source.goalBases ?? []).map((basis) => structuredClone(basis));
  closed = facts.closedReason !== null;
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
