/**
 * The `node_review` decision-card source (decision 121-45): one card per Goal while at least one of its work nodes
 * waits for the person. 121-93: the card is derived from records only, through the node-review owner's boolean read;
 * the rows and files the person reviews stay on `goals/delivery`, and the write stays on `nodes/commit`.
 */
import {
  decisionSourceKey, decisionSubjectGoalRef,
  type DecisionSubjectV1,
} from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { DecisionCardSourcePort, DecisionCardV1 } from '../model/decision-contracts.js';
import type { TaskNodeCommitPort } from '../model/task-node-commit-contracts.js';
import { createCollectionCardSource } from './decision-read-model.js';

export type TaskNodeReviewCardSourceDependencies = {
  nodeCommits: Pick<TaskNodeCommitPort, 'readPendingNodeReview'>;
};

/** One Goal, no Task/Run/time in the key: two pending nodes are one card and it disappears with the last review. */
function nodeReviewCard(goalRef: GoalRef): DecisionCardV1 {
  const subject: DecisionSubjectV1 = { kind: 'goal', goalRef: { ...goalRef } };
  const key = decisionSourceKey({ kind: 'node_review', goalRef });
  return {
    cardKey: key,
    source: { kind: 'node_review', key, subject, pins: [] },
    state: 'waiting_answer',
    subject,
    senderSessionRef: null,
    requestRef: null,
    objects: [],
    options: [],
    answerMessageRef: null,
    answer: null,
    application: null,
    candidateStatus: null,
    staleReason: null,
    closedReason: null,
    openedAt: null,
    taskRef: null,
    runRef: null,
    readOnly: true,
    actions: [],
  };
}

export function createTaskNodeReviewCardSource(
  deps: TaskNodeReviewCardSourceDependencies,
): DecisionCardSourcePort {
  return createCollectionCardSource<GoalRef>({
    kind: 'node_review',
    serves: ['goal'],
    async readCollection(ctx, { subject }) {
      const goalRef = decisionSubjectGoalRef({ subject });
      if (goalRef === null) return { status: 'ready', value: [] };
      const pending = await deps.nodeCommits.readPendingNodeReview(ctx, { goalRef });
      if (pending.status !== 'ready') return pending;
      return { status: 'ready', value: pending.value ? [goalRef] : [] };
    },
    project: (goalRef) => nodeReviewCard(goalRef),
    async readByKey(ctx, { source }) {
      const goalRef = decisionSubjectGoalRef(source);
      if (goalRef === null || source.key !== decisionSourceKey({ kind: 'node_review', goalRef })) {
        return { status: 'ready', value: null };
      }
      const pending = await deps.nodeCommits.readPendingNodeReview(ctx, { goalRef });
      if (pending.status !== 'ready') return pending;
      return { status: 'ready', value: pending.value ? { item: goalRef } : null };
    },
  });
}
