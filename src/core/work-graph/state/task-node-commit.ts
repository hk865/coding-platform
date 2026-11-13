/**
 * Node-level review (decision 121-45), the pure half: which completed node waits for the person, which of its files
 * are the node's, whether the person's read still matches the work tree, whether a node is still being reviewed
 * elsewhere (S9's execution result review, K3's unknown-call review), and the one `TaskNodeCommit@1` constructor. No
 * store, clock or git here; the owner reads the facts and passes them in.
 */
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalAutonomyV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { withinKnowledgeDirectory } from '../../../contracts/knowledge.js';
import type { Phase, PlanRevisionRef, TaskKind } from '../../../contracts/plan.js';
import type { TaskUnknownCallReview } from '../../../contracts/task-graph.js';
import type {
  TaskNodeCommitRef, TaskNodeCommitV1, TaskNodeReviewFileV1,
} from '../../../contracts/task-node-commit.js';
import { reviewPacketItemOf } from '../../../contracts/verification.js';
import type { RoundTaskSignalV1 } from './verification-machine.js';

/** One executed file of a Goal's Run, as `readGoalExecutedFiles` lists it. */
export type ExecutedFileV1 = { runRef: RunRef; path: string; certainty: 'definite' | 'possible' };

/**
 * The node's files (NR-10): the executed files of the Task's own Runs, `.workbench/` left out (the knowledge directory
 * is committed on its own, by the person's knowledge commit), definite before possible, one entry per path. `runRefs`
 * are the Runs that wrote a kept file, in first-seen order.
 */
export function taskNodeFilesOf(taskRunIds: ReadonlySet<string>, executed: readonly ExecutedFileV1[]):
{ files: { path: string; certainty: 'definite' | 'possible' }[]; runRefs: RunRef[] } {
  const own = executed.filter(file => taskRunIds.has(file.runRef.runId) && !withinKnowledgeDirectory(file.path));
  const certainty = new Map<string, 'definite' | 'possible'>();
  for (const file of own) if (file.certainty === 'definite') certainty.set(file.path, 'definite');
  for (const file of own) if (!certainty.has(file.path)) certainty.set(file.path, 'possible');
  const runRefs = new Map<string, RunRef>();
  for (const file of own) if (!runRefs.has(file.runRef.runId)) runRefs.set(file.runRef.runId, { ...file.runRef });
  return { files: [...certainty].map(([path, kind]) => ({ path, certainty: kind })), runRefs: [...runRefs.values()] };
}

/** The structural facts of one Task the review rules read (no model DTO). */
export type NodeReviewFactsV1 = {
  autonomy: GoalAutonomyV1;
  taskKind: TaskKind;
  executionIntent: 'plan_only' | 'request_execution' | undefined;
  effectivePhase: Phase;
  /** The canonical projection's applicable TaskReduction revision; null when none applies. */
  reductionRevision: number | null;
  hasFiles: boolean;
};

/**
 * NR-01/NR-02: why a Task is not a node the person reviews, or null when it is. Only under `every_step` (121-45: the
 * autonomy level decides which nodes), only a work Task that is not plan-only, only once its applicable reduction made
 * it satisfied (that reduction may come from an older Plan, NR-22), and only when it changed files: a gate, a read-only
 * node and an `after_plan_confirmation` Goal have nothing to commit.
 */
export function nodeReviewProblem(facts: NodeReviewFactsV1): string | null {
  if (facts.autonomy !== 'every_step') return 'this Goal does not review each node';
  if (facts.taskKind !== 'work' || facts.executionIntent === 'plan_only') return 'only an executed work node is reviewed';
  if (facts.effectivePhase !== 'satisfied' || facts.reductionRevision === null) return 'the Task is not a completed node';
  if (!facts.hasFiles) return 'the Task has no changes to commit';
  return null;
}

/** NR-03: a node under review with no review fact for its TaskReduction revision yet. */
export function taskNodePending(facts: NodeReviewFactsV1 & { reviewed: boolean }): boolean {
  return !facts.reviewed && nodeReviewProblem(facts) === null;
}

/**
 * NR-24 (S9-N8): a node still under review elsewhere is live work for the `every_step` gate, so the Goal selects no
 * new work node until it ends. Two reviews count: S9's execution result review (a work Task's ended selected Run,
 * not satisfied, its round chain head open with a review-packet item and every check settled) and K3's unknown-call
 * review while it waits for the adviser, the person's approval or the person's decision (`awaiting_advice`,
 * `awaiting_approval`, `needs_decision`: under every_step the settle and an applied adviser answer go before the
 * person, lead ruling 11-13).
 */
export function taskAwaitsReview(input: {
  taskKind: TaskKind; effectivePhase: Phase; round: RoundTaskSignalV1 | undefined;
  unknownCallReview: TaskUnknownCallReview | null;
}): boolean {
  const round = input.round;
  const executionReview = input.taskKind === 'work' && input.effectivePhase !== 'satisfied'
    && round?.kind === 'open' && !round.unsettled && reviewPacketItemOf(round.head.verificationPlan) !== undefined;
  const status = input.unknownCallReview?.status;
  return executionReview || status === 'awaiting_approval' || status === 'awaiting_advice' || status === 'needs_decision';
}

/**
 * N1 (`every_step` takes one work node at a time): a work node whose Run ended is still in flight until its checks
 * and completion settle into a reduction (`verifying`: no round yet, a round open, or a passed round awaiting
 * completion). Its own round chain keeps advancing; the Goal claims no other work meanwhile.
 */
export function nodeInFlight(input: { taskKind: TaskKind; effectivePhase: Phase }): boolean {
  return input.taskKind === 'work' && input.effectivePhase === 'verifying';
}

/**
 * NR-09 step 7 (N1: what is committed is what the person saw): the reviewed paths must be exactly the node's current
 * paths, and each reviewed blob the one read now. The reason names the first path that differs; null when they match.
 */
export function reviewedContentProblem(
  current: readonly { path: string; blob: string | null }[],
  reviewed: readonly { path: string; blob: string | null }[],
): string | null {
  const seen = new Map(reviewed.map(entry => [entry.path, entry.blob]));
  for (const entry of current) {
    if (!seen.has(entry.path)) return `the node's path ${entry.path} was not in the reviewed set; re-read the node`;
    if (seen.get(entry.path) !== entry.blob) {
      return `the reviewed content changed since the person read it: ${entry.path}; re-read the node`;
    }
  }
  if (seen.size !== current.length) return "the reviewed set names a path that is not the node's; re-read the node";
  return null;
}

/** The record's address. */
export function taskNodeCommitRefOf(goalRef: GoalRef, taskId: string, reductionRevision: number): TaskNodeCommitRef {
  return { aggregateType: 'TaskNodeCommit', projectId: goalRef.projectId, goalId: goalRef.goalId, taskId,
    reductionRevision };
}

/** Everything of a review fact but its outcome: what a node commit carries in its trailer and is recovered from. */
export type TaskNodeCommitDraftV1 = {
  goalRef: GoalRef; taskId: string; reductionRevision: number; planRef: PlanRevisionRef; planRevision: number;
  runRefs: RunRef[]; files: TaskNodeReviewFileV1[];
  reviewedBy: TaskNodeCommitV1['reviewedBy']; reviewedAt: string; requestId: string;
};

/** NR-13: the one constructor of the immutable review fact (`committed` with its commit, or `acknowledged`). */
export function taskNodeCommitOf(draft: TaskNodeCommitDraftV1, review: TaskNodeCommitV1['review']): TaskNodeCommitV1 {
  const goalRef = draft.goalRef;
  return {
    ref: taskNodeCommitRefOf(goalRef, draft.taskId, draft.reductionRevision), schemaVersion: 1, revision: 1,
    goalRef: { ...goalRef }, planRef: { ...draft.planRef }, planRevision: draft.planRevision,
    taskRef: { projectId: goalRef.projectId, goalId: goalRef.goalId, taskId: draft.taskId },
    runRefs: draft.runRefs.map(run => ({ ...run })), files: draft.files.map(file => ({ ...file })),
    review: { ...review }, reviewedBy: { ...draft.reviewedBy }, reviewedAt: draft.reviewedAt,
    requestId: draft.requestId,
  };
}
