/** Product vocabulary, not evidence or a grant of authority. */
export const QUERY_CONTEXT_LABELS = {
  schemaVersion: 1,
  meaning: 'Definitions explain captured records; they do not establish that any record exists. Missing fields remain unobserved. Preserve object, relation, scope, time, stage and authority in every claim.',
  relations: {
    createdBy: 'Recorded author of content; installation and activation do not establish authorship.',
    proposedBy: 'Recorded proposer; not the decision maker.',
    decidedBy: 'Actor who recorded the specified formal decision; not every related choice.',
    activatedBy: 'Actor who activated this baseline revision; not its author.',
    pendingHumanAction: 'A currently outstanding action assigned to a human in the observed domain.',
    acceptedProposal: 'Acceptance of a proposal.',
    selectedCandidate: 'Explicit selection of an identified candidate.',
    activatedBaseline: 'Recorded activation of an identified baseline revision.'
  },
  records: {
    architectureActivation: { object: 'ArchitectureBaselineActivation', relation: 'activatedBy', coverage: 'current-project-baseline-activation', authority: 'ProjectArchitectureBaselineActive and committed activation event; not authorship' },
    architectureReviews: { object: 'ArchitectureReview', relation: 'recorded-review', coverage: 'recorded-architecture-reviews-in-this-goal', authority: 'ArchitectureReview and its referenced decision records' },
    humanActions: { object: 'PendingHumanAction', relation: 'pending-action', coverage: 'declared-pending-action-domains-in-this-goal', authority: 'Each domain observation; unavailable domains remain unknown' },
    acceptedPlan: { object: 'PlanRevision', relation: 'accepted-plan', coverage: 'accepted-plan-in-this-goal', authority: 'PlanRevision; baseline pins identify dependencies, not authors or activation actors' },
    goalPhase: { object: 'GoalPhase', relation: 'recorded-phase', coverage: 'last-recorded-goal-phase', authority: 'Independent GoalPhase reduction' },
    collaborationWork: { object: 'TaskObservation', relation: 'observed-task', coverage: 'bounded-accepted-plan-task-selection', authority: 'TaskReduction for acceptance; TaskLease-held Run for ordinary execution only' },
    verificationStages: { object: 'VerificationObservation', relation: 'recorded-verification', coverage: 'declared-verification-observation-scope', authority: 'Verification records and explicit applicability witnesses' }
  },
  observation: 'ready means the observation is readable; ready-empty means its declared collection is empty. not_found means only the addressed object/location was not found. unavailable, failed and stale cannot establish absence. A ready fact read can contain an unavailable observation.',
  scope: 'Current pending actions, recorded reviews and baseline activation are different collections. A Goal-scoped empty collection says nothing about all project history. Read permission never authorizes execution.'
} as const;

export type QueryFactMeaning = {
  object: string; relation: string; coverage: string; authority: string;
  scope: { projectId: string; workspaceId?: string; goalId?: string };
  inputDigest: string; observedAt: string; recordPointer: string;
  observationStatus: string;
};
