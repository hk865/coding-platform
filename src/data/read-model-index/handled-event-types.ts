import { reviewProjectionEventTypes } from './reviewer-projection.js';

/**
 * Events both adapters can advance past. This is a capability registry, not a
 * claim that every event produces a visible row; some events are deliberately
 * acknowledged because their canonical consumer lives in another Module.
 */
const handledEventTypes = new Set<string>([
  ...reviewProjectionEventTypes,
  'GoalCreated', 'ProjectBootstrapped', 'WorkspaceBootstrapped', 'WorkspaceRegistered',
  'CompletionPolicyInstalled', 'ArchitectureBaselineInstalled', 'CompletionPolicyActivated', 'ArchitectureBaselineActivated',
  'PlanRevisionAccepted', 'TaskClaimed', 'RunStarted', 'RunEventRecorded', 'RunOutcomeUnknown',
  'EvidenceAdmitted', 'TaskReductionUpdated', 'GoalPhaseUpdated', 'HandoffRecorded', 'ReplacementClaimed',
  'WorkspaceReadLeaseGranted', 'WorkspaceReadLeaseReleased', 'WorkspaceWriteLeaseGranted', 'WorkspaceWriteLeaseReleased',
  'IntegrationJoined', 'PatchRecorded', 'MaterialAccessGranted', 'MaterialAccessRevoked',
  'WorkContextBound', 'WorkRunLinked', 'ExecutionNoteRecorded', 'ContinuationRecorded',
  'ArchitectureInspectionRecorded', 'ArchitectureFindingRecorded', 'ArchitectureDecisionBriefRecorded', 'ArchitectureCandidateProposalRecorded',
  'ControlIntentRecorded', 'SafePointAcknowledged', 'QueryJobSubmitted', 'QueryRunStarted', 'QueryJobAnswerRecorded', 'QueryJobClosed',
  'ArchitectureEvolutionPolicyInstalled', 'ArchitectureEvolutionPolicyActivated', 'RemediationPlanPatchRecorded',
  'RemediationTaskCreated', 'RemediationTaskAdvanced', 'CandidateBaselineMaterialized', 'ArchitectureChangeDecisionRecorded',
  'MigrationGateRecorded', 'BaselineActivationRecorded', 'InitialDesignProposalRecorded', 'InitialDesignDecisionRecorded',
  'CoordinationPolicyInstalled', 'CoordinationPolicyActivated', 'RoleSpecInstalled', 'RoleSpecActivated',
  'PlanProposalRecorded', 'UserDecisionRecorded', 'GoalRevisionRecorded', 'PlanRevisionSuperseded',
  'AgentInstanceRegistered', 'WorkParticipationStarted', 'WorkParticipationEnded', 'DirectedRequestSent',
  'DirectedRequestResponded', 'DirectedRequestCancelled', 'SubscriptionCreated', 'SubscriptionCancelled',
  'SubscriptionCatchupPlanned', 'SubscriptionCatchupAdvanced', 'DeliveryRecorded', 'WaitConditionRegistered',
  'WaitConditionObserved', 'WaitConditionSatisfied', 'WaitConditionTimedOut', 'WaitConditionCancelled',
  'ModelRequestAuthorized', 'RunReconciled', 'ExecutionEntered', 'ExecutionRetryScheduled', 'RuntimeInputBound',
  'DispatchDeferred', 'ArchitectureReviewRecorded', 'ModelRequestEvidenceRecorded', 'CommunicationIntentRecorded',
  'CommunicationIntentClaimed', 'CommunicationIntentSettled', 'CommunicationAdmissionRecorded',
  'CoordinationRegistryUpdated', 'WorkMailboxUpdated',
]);

export function readModelHandlesEvent(eventType: string): boolean {
  return handledEventTypes.has(eventType);
}
