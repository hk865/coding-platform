/**
 * The reusable ref descriptions for field-table formats (`data-format.ts`). Each is the complete shape of the
 * hand-written ref type it mirrors (fields, literals and tag), so `InferShape` of its fields equals that type. A tagged
 * aggregate ref carries its `aggregateType` literal; a plain ref (`SessionRef`, `ModuleRef`, `TaskTriple`) has none and
 * is never a record's address. A ref a later format introduces is defined there.
 */
import { defineShape, f } from './data-format.js';

/** Every id inside a ref is a non-empty string, as the hand-written ref checks require. */
const id = f.string({ min: 1, unit: 'codePoints' });

export const ProjectRefShape = defineShape({ name: 'ProjectRef', fields: { aggregateType: f.literal('Project'), projectId: id } });
export const WorkspaceRefShape = defineShape({
  name: 'WorkspaceRef', fields: { aggregateType: f.literal('Workspace'), projectId: id, workspaceId: id },
});
export const GoalRefShape = defineShape({ name: 'GoalRef', fields: { aggregateType: f.literal('Goal'), projectId: id, goalId: id } });
export const SessionRefShape = defineShape({ name: 'SessionRef', fields: { projectId: id, sessionId: id } });
export const SessionAggregateRefShape = defineShape({
  name: 'SessionAggregateRef', fields: { projectId: id, sessionId: id, aggregateType: f.literal('Session') },
});
export const ModuleRefShape = defineShape({ name: 'ModuleRef', fields: { projectId: id, moduleId: id } });
export const QueryJobRefShape = defineShape({
  name: 'QueryJobRef',
  fields: { aggregateType: f.literal('QueryJob'), projectId: id, workspaceId: id, queryJobId: id },
});
export const QueryRunRefShape = defineShape({
  name: 'QueryRunRef',
  fields: { aggregateType: f.literal('QueryRun'), projectId: id, workspaceId: id, queryJobId: id, runId: id },
});
export const QueryJobAnswerRefShape = defineShape({
  name: 'QueryJobAnswerRef',
  fields: { aggregateType: f.literal('QueryJobAnswer'), projectId: id, workspaceId: id, queryJobId: id, answerId: id },
});
export const SessionMessageRefShape = defineShape({
  name: 'SessionMessageRef',
  fields: { aggregateType: f.literal('SessionMessage'), projectId: id, workspaceId: id, messageId: id },
});
export const TaskTripleShape = defineShape({ name: 'TaskTriple', fields: { projectId: id, goalId: id, taskId: id } });
export const RunRefShape = defineShape({
  name: 'RunRef', fields: { aggregateType: f.literal('Run'), projectId: id, goalId: id, runId: id },
});
export const OperationRefShape = defineShape({
  name: 'OperationRef', fields: { aggregateType: f.literal('CoreOperation'), projectId: id, operationId: id },
});
export const PlanProposalRefShape = defineShape({
  name: 'PlanProposalRef',
  fields: { aggregateType: f.literal('PlanProposal'), projectId: id, workspaceId: id, proposalId: id },
});
export const TaskRequeueRefShape = defineShape({
  name: 'TaskRequeueRef',
  fields: { aggregateType: f.literal('TaskRequeue'), projectId: id, goalId: id, taskId: id, afterRunId: id },
});
export const VerificationRoundRefShape = defineShape({
  name: 'VerificationRoundRef',
  fields: {
    aggregateType: f.literal('VerificationRound'), projectId: id, workspaceId: id, goalId: id, taskId: id, runId: id,
    roundId: id,
  },
});
