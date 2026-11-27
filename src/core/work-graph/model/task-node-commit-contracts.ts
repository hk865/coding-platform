/**
 * Node-level review (decision 121-45): the review read, the person's commit/acknowledge write and the narrow git
 * port they use. The owner is `tasks/task-node-commit-service.ts`; the pure rules are `state/task-node-commit.ts`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../../contracts/ledger.js';
import type { Disposition, Phase, RequirementLevel, RuntimeTask, TaskKind } from '../../../contracts/plan.js';
import type { TaskReductionPhase } from '../../../contracts/reduction.js';
import type { TaskNodeCommitV1, TaskNodeReviewFileV1 } from '../../../contracts/task-node-commit.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type { TaskNodeReviewDraftV1 } from '../../../contracts/task-node-review-draft.js';
import type { TaskRequeueOutcomeV1 } from '../../../contracts/task-requeue.js';
import type { GraphWrite } from './task-contracts.js';

/** The git port's answer: its value, or why it failed (git's own words for a failed commit). */
export type NodeGitResult<T> = { status: 'ready'; value: T } | CoreRejection;

/**
 * 121-173: the secretary's draft of a pending node's note as the review page shows it. `drafting`: asked, no answer
 * yet; `ready`: `text` is the answer; `failed`: the platform could not ask, or the Query closed without an answer.
 */
export type NodeReviewDraftV1 = {
  status: 'drafting' | 'ready' | 'failed';
  /** The secretary's text; null unless `ready`. */
  text: string | null;
  /** The Query the platform opened; null when it could not ask. */
  request: QueryJobRef | null;
  requestedAt: string | null;
  failureReason: string | null;
};

/** One Task of the Goal's active Plan as the review page reads it. */
export type TaskNodeReviewRowV1 = {
  task: { taskId: string; title: string; taskKind: TaskKind; requirementLevel: RequirementLevel;
    disposition: Disposition; phase: Phase; sizeClass?: RuntimeTask['sizeClass'] };
  /** The applicable TaskReduction (NR-22: it may come from an older Plan); null when none applies. */
  reduction: { revision: number; phase: TaskReductionPhase; reducedAt: string } | null;
  runs: RunRef[];
  /** The node's files (`.workbench/` left out) with the working-tree blob now and the other Goals of this workspace
   *  whose conflict card names the same file (a hint; it never changes what is committed). */
  files: (TaskNodeReviewFileV1 & { sharedWithGoalRefs: GoalRef[] })[];
  /** The review fact of the applicable TaskReduction revision. */
  review: TaskNodeCommitV1 | null;
  pending: boolean;
  /** 121-173: the secretary's draft; only `goals/delivery` attaches it (pending rows only), the review rows carry none. */
  draft: NodeReviewDraftV1 | null;
};

/** One review fact as the main conversation keeps it (121-173): it stays after a refresh or a Host restart. */
export type NodeReviewReceiptV1 = {
  /** The title from the active Plan; null when the Plan no longer has the Task (the page shows the taskId). */
  taskRef: { taskId: string; title: string | null };
  decision: 'committed' | 'acknowledged';
  /** The commit of `committed`; null for `acknowledged`. */
  sha: string | null;
  /** The person's commit message of `committed`; null for `acknowledged`. */
  message: string | null;
  reviewedAt: string;
  reviewedBy: { kind: 'human' | 'system'; id: string };
  /** How many files the review covered. */
  files: number;
};

export interface TaskNodeCommitPort {
  readNodeRows(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<{ rows: TaskNodeReviewRowV1[]; pending: TaskNodeReviewRowV1[];
      /** A `starting|running` Run of the active Plan's Tasks, or a node still under an execution result review or an
       *  undecided unknown-call review (NR-24). */
      liveWork: boolean }>>;
  /** 121-45/121-93: whether any node of this Goal waits for the person, read from records only (no work-tree
   *  blob, no conflict graph). The decision queue's node_review source reads it, and the Host's draft ask
   *  (121-173) reads it before the review rows. */
  readPendingNodeReview(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<boolean>>;
  commitNode(ctx: CoreCallContext, request: GraphWrite<{
    goalRef: GoalRef; taskRef: TaskTriple;
    decision: 'commit' | 'acknowledge';
    /** The commit message the person settled on; null exactly for `acknowledge`. */
    message: string | null;
    /** The review read's paths and blobs; certainty comes from the executed-files read. */
    reviewed: readonly { path: string; blob: string | null }[];
  }>): Promise<WriteResult<TaskNodeCommitV1>>;
  /**
   * 121-173: the person sends the pending node back with a reason. The same Task goes back to pending (P4, a
   * `TaskRequeue` with the `node_review_rework` trigger); its changes stay in the work tree and nothing is committed.
   * When the next round completes, the node waits for the person again. `meta.expected` is `nodes/commit`'s two pins.
   */
  reworkNode(ctx: CoreCallContext, request: GraphWrite<{ goalRef: GoalRef; taskRef: TaskTriple; reason: string }>):
    Promise<WriteResult<TaskRequeueOutcomeV1>>;
  /**
   * 121-173: records the platform's one ask for a pending node's draft (the Query, or why it could not ask). Written
   * once per (node, reduction): the same input replays, another is `idempotency_conflict`. The Host's wake is its only
   * caller; there is no route.
   */
  recordNodeReviewDraft(ctx: CoreCallContext, input: { goalRef: GoalRef; taskId: string; reductionRevision: number;
    asked: { request: QueryJobRef; failureReason: null } | { request: null; failureReason: string } }):
    Promise<WriteResult<TaskNodeReviewDraftV1>>;
  /** 121-173: the Goal's draft records as stored, one per asked (node, reduction); the delivery page and the Host read
   *  them here. */
  readNodeReviewDrafts(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<TaskNodeReviewDraftV1[]>>;
  /** 121-173: who the platform asks for a node's draft: the secretary duty of the caller's workspace (the Goal's, as
   *  the node rows are read there); `null` when the workspace has none. */
  readNodeReviewDraftRecipient(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<SessionRef | null>>;
  /** 121-173: every review fact of the Goal, oldest first (the same instant by taskId); records only, no blob. */
  readNodeReceipts(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<{ receipts: NodeReviewReceiptV1[] }>>;
}

/**
 * The node commit's git, on the Goal's workspace root and only on the given paths. `commitTaskNodeChanges` adds the
 * three trailers `findTaskNodeCommit` looks for (NR-14): the record snapshot the commit is recovered from, the write's
 * identity and its fingerprint, in that order as the message's last three lines.
 */
export interface TaskNodeCommitWorkspacePort {
  readTaskNodeBlobs(input: { workspace: WorkspaceRef; paths: readonly string[] }):
    Promise<NodeGitResult<{ path: string; blob: string | null }[]>>;
  /** Whether committing these paths would record anything: their work-tree content against HEAD, untracked included. */
  hasTaskNodeChanges(input: { workspace: WorkspaceRef; paths: readonly string[] }): Promise<NodeGitResult<boolean>>;
  commitTaskNodeChanges(input: { workspace: WorkspaceRef; paths: readonly string[]; message: string;
    trailer: { record: string; identity: string; fingerprint: string } }): Promise<NodeGitResult<{ sha: string }>>;
  /** The reachable commit carrying this identity: with this fingerprint its sha and record snapshot, with another a
   *  conflict, none null. */
  findTaskNodeCommit(input: { workspace: WorkspaceRef; identity: string; fingerprint: string }):
    Promise<NodeGitResult<{ sha: string; record: string } | { conflict: true } | null>>;
}
