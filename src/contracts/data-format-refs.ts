/**
 * The reusable ref descriptions for field-table formats (`data-format.ts`). Each is the complete shape of the
 * hand-written ref type it mirrors (fields, literals and tag), so `InferShape` of its fields equals that type. A tagged
 * aggregate ref carries its `aggregateType` literal; a plain ref (`SessionRef`, `ModuleRef`, `TaskTriple`) has none and
 * is never a record's address. Later refs live here too: `DispatchCounterRefShape` and `PlanRevisionRefShape`.
 */
import { defineShape, f } from './data-format.js';

/** Every id inside a ref is a non-empty string, as the hand-written ref checks require. */
export const id = f.string({ min: 1, unit: 'codePoints' });

export const ProjectRefShape = defineShape({ name: 'ProjectRef', fields: { aggregateType: f.literal('Project'), projectId: id } });
export const WorkspaceRefShape = defineShape({
  name: 'WorkspaceRef', fields: { aggregateType: f.literal('Workspace'), projectId: id, workspaceId: id },
});
export const GoalRefShape = defineShape({ name: 'GoalRef', fields: { aggregateType: f.literal('Goal'), projectId: id, goalId: id } });
export const DispatchCounterRefShape = defineShape({ name: 'DispatchCounterRef', fields: {
  aggregateType: f.literal('DispatchCounter'), projectId: id, goalId: id,
} });
export const SessionRefShape = defineShape({ name: 'SessionRef', fields: { projectId: id, sessionId: id } });
export const HandoffBriefRefShape = defineShape({ name: 'HandoffBriefRef', fields: {
  aggregateType: f.literal('HandoffBrief'), projectId: id, sessionId: id, operationId: id,
} });
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
export const PlanRevisionRefShape = defineShape({
  name: 'PlanRevisionRef', fields: { aggregateType: f.literal('PlanRevision'), projectId: id, planId: id },
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
export const ReworkRequestRefShape = defineShape({ name: 'ReworkRequestRef', fields: {
  aggregateType: f.literal('ReworkRequest'), projectId: id, goalId: id, taskId: id, requestId: id,
} });
export const ModuleOverlapGateRefShape = defineShape({ name: 'ModuleOverlapGateRef', fields: {
  aggregateType: f.literal('ModuleOverlapGate'), projectId: id, goalId: id, taskId: id, moduleId: id,
} });
export const ProjectScopeShape = defineShape({ name: 'ProjectScope', fields: { projectId: id } });
export const WorkspaceScopeShape = defineShape({ name: 'WorkspaceScope', fields: { projectId: id, workspaceId: id } });
export const CurrentPointerRefShape = defineShape({
  name: 'CurrentPointerRef', fields: { aggregateType: f.literal('CurrentPointer'), projectId: id, anchorKey: id },
});

const HumanActorFields = { kind: f.literal('human'), id };
const SystemActorFields = { kind: f.literal('system'), id };
/** `ActorRef` (`src/contracts/command-event.ts`): a saved command actor, never a filter. */
export const ActorRefField = f.union('kind', {
  human: HumanActorFields, system: SystemActorFields,
  agent: { kind: f.literal('agent'), id, runRef: f.ref(RunRefShape) },
});
/** The `WorkContextBinding` wire shape a `work` link target carries. */
export const WorkContextRefField = f.object({ aggregateType: f.literal('WorkContextBinding'), projectId: id,
  workspaceId: id, workId: id });
/** `WorkLinkTarget` (`src/contracts/core/identity.ts`) in the order task, module, work, goal, project. */
export const WorkLinkTargetField = f.union('kind', {
  task: { kind: f.literal('task'), ref: f.ref(TaskTripleShape) }, module: { kind: f.literal('module'), ref: f.ref(ModuleRefShape) },
  work: { kind: f.literal('work'), ref: WorkContextRefField }, goal: { kind: f.literal('goal'), ref: f.ref(GoalRefShape) },
  project: { kind: f.literal('project'), ref: f.ref(ProjectScopeShape) } });
