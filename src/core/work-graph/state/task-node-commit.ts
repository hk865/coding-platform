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
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { hostMessageId } from '../../../contracts/plan-round.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type {
  TaskNodeCommitRef, TaskNodeCommitV1, TaskNodeReviewFileV1,
} from '../../../contracts/task-node-commit.js';
import type { TaskNodeReviewDraftV1 } from '../../../contracts/task-node-review-draft.js';
import type { TaskRequeueSnapshotV1 } from '../../../contracts/task-requeue.js';
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
  /** That reduction's `reducedAt`; null when none applies. */
  reducedAt: string | null;
  /** `GoalSettingsV1.nodeReviewSince`; null when the Goal has none (every completed node is reviewed). */
  nodeReviewSince: string | null;
  hasFiles: boolean;
};

/**
 * NR-01/NR-02: why a Task is not a node the person reviews, or null when it is. Only under `every_step` (121-45: the
 * autonomy level decides which nodes), only a work Task that is not plan-only, only once its applicable reduction made
 * it satisfied (that reduction may come from an older Plan, NR-22), and only when it changed files: a gate, a read-only
 * node and an `after_plan_confirmation` Goal have nothing to commit. A node completed before the Goal switched to
 * `every_step` is not reviewed either (121-173): its changes stay in the work tree, uncommitted; a node completed at the
 * same instant counts as after the switch. ISO times of one clock compare as strings.
 */
export function nodeReviewProblem(facts: NodeReviewFactsV1): string | null {
  if (facts.autonomy !== 'every_step') return 'this Goal does not review each node';
  if (facts.taskKind !== 'work' || facts.executionIntent === 'plan_only') return 'only an executed work node is reviewed';
  if (facts.effectivePhase !== 'satisfied' || facts.reductionRevision === null) return 'the Task is not a completed node';
  if (!facts.hasFiles) return 'the Task has no changes to commit';
  if (facts.reducedAt !== null && facts.nodeReviewSince !== null && facts.reducedAt < facts.nodeReviewSince) {
    return 'the node was completed before this Goal started reviewing each node';
  }
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

/**
 * 121-173: the one constructor of the secretary draft record of a pending node: written once per (node, reduction),
 * with the Query it opened or why the platform could not ask (never both). The answer text is not copied.
 */
export function newTaskNodeReviewDraft(input: {
  goalRef: GoalRef; taskId: string; reductionRevision: number;
  asked: { request: QueryJobRef; failureReason: null } | { request: null; failureReason: string };
  requestedBy: TaskNodeReviewDraftV1['requestedBy']; requestedAt: string;
}): TaskNodeReviewDraftV1 {
  const goalRef = input.goalRef;
  return {
    ref: { aggregateType: 'TaskNodeReviewDraft', projectId: goalRef.projectId, goalId: goalRef.goalId,
      taskId: input.taskId, reductionRevision: input.reductionRevision },
    schemaVersion: 1, revision: 1,
    request: input.asked.request === null ? null : { ...input.asked.request },
    requestedAt: input.requestedAt, failureReason: input.asked.failureReason,
    requestedBy: { ...input.requestedBy },
  };
}

/**
 * 121-173: whether a TaskRequeue is the person's send-back of this reduction revision. That reduction then stops
 * applying (the record stays as history), and it can be neither sent back again nor reviewed.
 */
export function sendsBack(requeue: Pick<TaskRequeueSnapshotV1, 'trigger'>, reductionRevision: number): boolean {
  return requeue.trigger?.kind === 'node_review_rework' && requeue.trigger.reductionRevision === reductionRevision;
}

/**
 * 121-173: the one command id of a node's draft ask, shared by the ask and its record. The tuple is encoded whole, so
 * `('g:a','b',1)` and `('g','a:b',1)` stay two nodes.
 */
export function nodeReviewDraftCommandId(goalId: string, taskId: string, reductionRevision: number): string {
  return `node-review-draft:${canonicalKey([goalId, taskId, reductionRevision])}`;
}

/** The request id `queries/ask` saves its question under (`line-ask.ts`), the person's and the node draft's alike. */
export function lineAskRequestId(commandId: string): string {
  return `queries-ask:${commandId}`;
}

/**
 * 121-173 (round 3): the node draft's question M is the asking Host actor's `queries/ask` message under the draft
 * command id (`hostMessageId`, sent and received in the Goal's workspace), so M, and with it M's deterministic Query
 * (`consultationQueryRefs`), follow from the draft identity alone.
 */
export function nodeReviewDraftQuestionRef(workspace: { projectId: string; workspaceId: string },
  asker: { kind: 'human' | 'system'; id: string }, goalId: string, taskId: string, reductionRevision: number):
  SessionMessageRef {
  const requestId = lineAskRequestId(nodeReviewDraftCommandId(goalId, taskId, reductionRevision));
  const id = hostMessageId(workspace, asker, requestId);
  if (id.status !== 'ready') throw new Error(id.reason);
  return { aggregateType: 'SessionMessage', projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    messageId: id.value };
}

/**
 * 121-173: the question the secretary gets for one pending node: only literals the review read already has (the
 * Task's title, the node's paths, whether its checks passed), never a diff body; the secretary reads the files itself.
 */
export function nodeReviewDraftQuestion(node: { title: string; paths: readonly string[]; checksPassed: boolean }):
  string {
  return [
    `节点「${node.title}」做完了，正等人审核。请写这一步的说明草稿：做了什么、为什么，两三句话；人会据此写提交说明。`,
    `改动的文件：${node.paths.join('、')}`,
    `检查：${node.checksPassed ? '已通过' : '未通过'}`,
    '只回说明正文，不要改文件。',
  ].join('\n');
}

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
