/**
 * The delivery page's read (decision 121-45, acc): one join, no reduction.
 *
 * ACC-08 order: the Goal display (`queryGoalDisplay`, reused), the current GoalPhase revision, the acceptance record
 * keyed by that revision, the node review rows (`readNodeRows`, reused) and the secretary (`resolveDutyRecipient`,
 * reused). ACC-09: the acceptance is returned only while that GoalPhase is the completed one of the Goal's active
 * Plan; no GoalPhase, a Goal not completed, or a Plan the active Plan has replaced all read `null`, and a new Plan is
 * a new delivery. Any failed read is returned unchanged: never a partial page and never an old record.
 *
 * 121-173: each pending node row carries the secretary's draft of its note: the Query of the draft's own question,
 * found from the draft identity (round 3), or else the Goal's `TaskNodeReviewDraft` failure record; with neither the
 * row has `draft: null`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { consultationBindingProblem, consultationQueryRefs } from '../../../contracts/query-job.js';
import type { TaskNodeReviewDraftV1 } from '../../../contracts/task-node-review-draft.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalDeliveryAcceptanceV1 } from '../../../contracts/goal-delivery.js';
import type { GoalPhaseRef } from '../../../contracts/goal-phase.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { GoalDeliveryPort } from '../model/goal-delivery-contracts.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import type { GoalDisplayRead } from '../model/plan-contracts.js';
import type {
  NodeReviewDraftV1, TaskNodeCommitPort, TaskNodeReviewRowV1,
} from '../model/task-node-commit-contracts.js';
import type { QueryJobPort, QueryJobRecord } from '../queries/contracts.js';
import type { DutyRecipientPort } from '../sessions/duty-recipient.js';
import { goalDeliveryProblem } from '../state/goal-delivery.js';
import { nodeReviewDraftQuestionRef } from '../state/task-node-commit.js';
import { readGoalPhase } from '../tasks/plan-readers.js';

/** The delivery page's one value: the Goal, its display, the current completion's acceptance, the node rows and the
 *  secretary. `phaseRevision: null` means no GoalPhase; the page then pins the Goal alone. */
export type GoalDeliveryReadV1 = {
  goal: GoalSnapshot;
  display: GoalDisplayRead['display'];
  /** The current GoalPhase revision; null when no GoalPhase exists. The page pins Goal@goal.revision and GoalPhase@phaseRevision. */
  phaseRevision: number | null;
  acceptance: GoalDeliveryAcceptanceV1 | null;
  nodes: TaskNodeReviewRowV1[];
  secretary: SessionRef | null;
};

export interface GoalDeliveryReadPort {
  readGoalDelivery(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GoalDeliveryReadV1>>;
}

/** The owners this join reads: the Goal display, the delivery acceptance, the node rows, the secretary, and the
 *  records `readGoalPhase` reads the current GoalPhase through. */
export type GoalDeliveryReadDependencies = {
  readGoalDisplay: (ctx: CoreCallContext, input: { goalRef: GoalRef }) => Promise<ReadResult<GoalDisplayRead>>;
  delivery: GoalDeliveryPort;
  nodeCommits: Pick<TaskNodeCommitPort, 'readNodeRows' | 'readNodeReviewDrafts'>;
  duties: Pick<DutyRecipientPort, 'resolveDutyRecipient'>;
  records: GoalRecordTransactionPort & RecordLookupPort;
  /** 121-173: the draft's Query and its last answer. */
  queryAnswers: Pick<QueryJobPort, 'readQueryJob' | 'readQueryAnswer'>;
  /** 121-173 (round 3): the draft question M, for the consultation binding check of M's Query. */
  messages: Pick<SessionMailboxPort, 'readMessage'>;
  /** 121-173 (round 3): the Host actor that asks for node drafts (M's sender); null without one, then no draft has a
   *  question. */
  asker: { kind: 'human' | 'system'; id: string } | null;
};

export function createGoalDeliveryRead(deps: GoalDeliveryReadDependencies): GoalDeliveryReadPort {
  /**
   * 121-173 (round 3): a pending row's draft. A Query of the draft's question M that is bound to M (the consultation
   * entry's binding check) shows its own state; with none, the row's failure record (an ask that opened no Query) is
   * `failed` with its reason; with neither the row has no draft.
   */
  async function draftOf(ctx: CoreCallContext, goal: GoalSnapshot, taskId: string, reductionRevision: number,
    record: TaskNodeReviewDraftV1 | undefined): Promise<ReadResult<NodeReviewDraftV1 | null>> {
    if (deps.asker !== null) {
      const question = nodeReviewDraftQuestionRef({ projectId: goal.workspaceRef.projectId,
        workspaceId: goal.workspaceRef.workspaceId }, deps.asker, goal.ref.goalId, taskId, reductionRevision);
      const query = await boundQueryOf(ctx, question);
      if (query.status !== 'ready') return query;
      if (query.value !== null) return queryDraftOf(ctx, query.value);
    }
    if (record === undefined || record.request !== null) return { status: 'ready', value: null };
    return { status: 'ready', value: { status: 'failed', text: null, request: null, requestedAt: record.requestedAt,
      failureReason: record.failureReason } };
  }

  /** M's deterministic Query when it is bound to M; null when there is none, or the Job under M's id is not M's. */
  async function boundQueryOf(ctx: CoreCallContext, question: SessionMessageRef):
    Promise<ReadResult<QueryJobRecord | null>> {
    const job = await deps.queryAnswers.readQueryJob(ctx, consultationQueryRefs(question).queryJobRef);
    if (job.status === 'not_found') return { status: 'ready', value: null };
    if (job.status !== 'ready') return job;
    const message = await deps.messages.readMessage(ctx, question);
    if (message.status === 'not_found') return { status: 'ready', value: null };
    if (message.status !== 'ready') return message;
    const recipient = message.value.recipient;
    return { status: 'ready', value: !('kind' in recipient)
      && consultationBindingProblem(job.value, { ref: question, recipient }) === null ? job.value : null };
  }

  /** The bound Query's state: its last answer is `ready`; closed without one is `failed` with its reason; otherwise
   *  `drafting`. */
  async function queryDraftOf(ctx: CoreCallContext, query: QueryJobRecord): Promise<ReadResult<NodeReviewDraftV1>> {
    const base = { request: query.job.ref, requestedAt: query.job.job.submittedAt };
    const answerRef = query.job.job.answerRefs.at(-1);
    if (answerRef !== undefined) {
      const answer = await deps.queryAnswers.readQueryAnswer(ctx, answerRef);
      if (answer.status === 'not_found') return rejected('unavailable', "the node draft's answer does not exist");
      if (answer.status !== 'ready') return answer;
      return { status: 'ready', value: { status: 'ready', text: answer.value.answer.answer, ...base, failureReason: null } };
    }
    const closed = query.job.job.closeReason;
    return { status: 'ready', value: closed === null
      ? { status: 'drafting', text: null, ...base, failureReason: null }
      : { status: 'failed', text: null, ...base, failureReason: closed.message } };
  }

  async function readGoalDelivery(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<GoalDeliveryReadV1>> {
    const displayRead = await deps.readGoalDisplay(ctx, input);
    if (displayRead.status !== 'ready') return displayRead;
    const { goal, display } = displayRead.value;

    const phaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId: input.goalRef.projectId,
      goalId: input.goalRef.goalId };
    const phaseRead = await readGoalPhase(deps.records, phaseRef);
    if (phaseRead.status !== 'ready') return phaseRead;
    const phase = phaseRead.snapshot;
    let acceptance: GoalDeliveryAcceptanceV1 | null = null;
    if (phase !== null) {
      const acceptanceRead = await deps.delivery.readAcceptance(ctx,
        { goalRef: input.goalRef, phaseRevision: phase.revision });
      if (acceptanceRead.status !== 'ready') return acceptanceRead;
      // ACC-09: the ONE current-delivery predicate (completed phase + its Plan is the active Plan); a new Plan
      // makes the old acknowledgement not the new delivery's.
      if (goalDeliveryProblem(goal, phase) === null) acceptance = acceptanceRead.value;
    }

    const nodesRead = await deps.nodeCommits.readNodeRows(ctx, { goalRef: input.goalRef });
    if (nodesRead.status !== 'ready') return nodesRead;

    const secretaryRead = await deps.duties.resolveDutyRecipient(ctx,
      { workspace: goal.workspaceRef, duty: 'secretary' });
    if (secretaryRead.status !== 'ready') return secretaryRead;

    // The draft records are the node owner's (`readNodeReviewDrafts`), keyed `taskId:reductionRevision`.
    const draftsRead = await deps.nodeCommits.readNodeReviewDrafts(ctx, { goalRef: input.goalRef });
    if (draftsRead.status !== 'ready') return draftsRead;
    const drafts = new Map(draftsRead.value.map(draft => [`${draft.ref.taskId}:${draft.ref.reductionRevision}`, draft]));
    const nodes: TaskNodeReviewRowV1[] = [];
    for (const row of nodesRead.value.rows) {
      if (!row.pending || row.reduction === null) { nodes.push(row); continue; }
      const draft = await draftOf(ctx, goal, row.task.taskId, row.reduction.revision,
        drafts.get(`${row.task.taskId}:${row.reduction.revision}`));
      if (draft.status !== 'ready') return draft;
      nodes.push({ ...row, draft: draft.value });
    }

    return { status: 'ready', value: {
      goal,
      display,
      phaseRevision: phase === null ? null : phase.revision,
      acceptance,
      nodes,
      secretary: secretaryRead.value,
    } };
  }
  return { readGoalDelivery };
}
