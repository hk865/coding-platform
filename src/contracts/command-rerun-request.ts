/**
 * K3 contracts: the `CommandRerunRequest` aggregate (spec §2, L19a). Pure data:
 * the state machine is `core/work-graph/state/command-rerun-request.ts`.
 */
import type { SessionMessageRef } from './core/session-message.js';
import type { CommandRerunAdviceV1 } from './command-rerun-advice.js';
import type { RunRef, TaskTriple } from './dispatch.js';
import type { UnknownCallReviewRef } from './unknown-call-review.js';

export type CommandRerunRequestRef = {
  aggregateType: 'CommandRerunRequest';
  projectId: string;
  goalId: string;
  taskId: string;
  requestId: string;
};

/**
 * `awaiting_advice` (121-110): the responsible adviser answers first; `pending` is the person's card. Every-step
 * confirmation and the review record's second consecutive interruption go to the person at once.
 */
export type CommandRerunRequestStateV1 =
  | 'awaiting_advice' | 'pending' | 'allowed' | 'used' | 'denied' | 'denied_final' | 'closed';

/**
 * 121-110: why a request that went to the adviser reached the person: no adviser line, the adviser round ended
 * without an answer, the adviser escalated, or the Goal was switched to every-step confirmation before the answer
 * was applied.
 */
export const COMMAND_RERUN_ESCALATION_CAUSES = ['no_adviser', 'adviser_failed', 'adviser_escalated', 'every_step'] as const;
export type CommandRerunEscalationCauseV1 = typeof COMMAND_RERUN_ESCALATION_CAUSES[number];

export type CommandRerunRequestV1 = {
  ref: CommandRerunRequestRef;
  schemaVersion: 1;
  revision: number;
  workspaceId: string;
  task: TaskTriple;
  reviewRef: UnknownCallReviewRef;
  /** The Work Run that raised the request. */
  runRef: RunRef;
  /** The alias of the blocked command (#n); a declared rewrite also names it. */
  alias: number;
  /** The raw text, 1..4000 UTF-8 bytes. */
  command: string;
  /** sha256 of the normalised text of THIS request; the one-time allowance is keyed by it. */
  commandSha256: string;
  /** true when the agent declared it with `rewriteOf` (unrecognised but treated as the alias). */
  declared: boolean;
  /** <=8; `text` cut to 512 bytes for display only; a ninth entry -> capacity. */
  declaredForms: Array<{ sha256: string; text: string }>;
  match: {
    kind: 'exact' | 'action' | 'declared';
    action?: { text: string; sha256: string };
    /** The card reads this; it never re-expands (K8-7). */
    viaScript?: { scriptName: string; dir: string };
  };
  reason: string /* 1..2000 code points */;
  state: CommandRerunRequestStateV1;
  /**
   * Written on entry into `awaiting_advice` (`answer: null`); `answer` keeps the adviser answer once applied. Absent
   * on a request that went to the person at once. An `allowed`/`denied` request with an answer was decided by the
   * adviser (its `answerMessageRef` stays null: there is no person's answer message).
   */
  advice?: { answer: CommandRerunAdviceV1 | null };
  /** Written when a request that went to the adviser reaches the person; `suggestion` is the adviser's answer, if any. */
  escalation?: { cause: CommandRerunEscalationCauseV1; suggestion: CommandRerunAdviceV1 | null };
  answerMessageRef: SessionMessageRef | null;
  allowedAt: string | null;
  usedAt: string | null;
  /** Lead ruling 2: the exact Run call that consumed the one-time allowance. */
  usedBy: { runId: string; callId: string } | null;
  createdAt: string;
  updatedAt: string;
};

// Indexes (L19a, §3.2b):
//   k3-crr-by-task-alias (ref.projectId, ref.goalId, ref.taskId, reviewRef.runId, alias)
//     equality index for the alias: pending / denied / denied_final all read from
//     here, then filtered by state (state is not in the key); denied_in_this_run
//     further compares the record's own runRef.
//   k3-crr-by-goal-state (ref.projectId, workspaceId, ref.goalId, state)
//     the card source's per-goal pending read.
//   k3-crr-by-task (ref.projectId, ref.goalId, ref.taskId)
//     the hook's per-task paged request read (declared forms, one-time allowance).
export const K3_CRR_BY_TASK_ALIAS_INDEX = 'k3-crr-by-task-alias';
export const K3_CRR_BY_GOAL_STATE_INDEX = 'k3-crr-by-goal-state';
export const K3_CRR_BY_TASK_INDEX = 'k3-crr-by-task';
