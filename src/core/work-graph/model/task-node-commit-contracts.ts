/**
 * Node-level review (decision 121-45): the review read, the person's commit/acknowledge write and the narrow git
 * port they use. The owner is `tasks/task-node-commit-service.ts`; the pure rules are `state/task-node-commit.ts`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import type { GoalRef, WorkspaceRef } from '../../../contracts/ledger.js';
import type { Disposition, Phase, RequirementLevel, RuntimeTask, TaskKind } from '../../../contracts/plan.js';
import type { TaskReductionPhase } from '../../../contracts/reduction.js';
import type { TaskNodeCommitV1, TaskNodeReviewFileV1 } from '../../../contracts/task-node-commit.js';
import type { GraphWrite } from './task-contracts.js';

/** The git port's answer: its value, or why it failed (git's own words for a failed commit). */
export type NodeGitResult<T> = { status: 'ready'; value: T } | CoreRejection;

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
};

export interface TaskNodeCommitPort {
  readNodeRows(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<{ rows: TaskNodeReviewRowV1[]; pending: TaskNodeReviewRowV1[];
      /** A `starting|running` Run of the active Plan's Tasks, or a node still under an execution result review or an
       *  undecided unknown-call review (NR-24). */
      liveWork: boolean }>>;
  commitNode(ctx: CoreCallContext, request: GraphWrite<{
    goalRef: GoalRef; taskRef: TaskTriple;
    decision: 'commit' | 'acknowledge';
    /** The commit message the person settled on; null exactly for `acknowledge`. */
    message: string | null;
    /** The review read's paths and blobs; certainty comes from the executed-files read. */
    reviewed: readonly { path: string; blob: string | null }[];
  }>): Promise<WriteResult<TaskNodeCommitV1>>;
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
