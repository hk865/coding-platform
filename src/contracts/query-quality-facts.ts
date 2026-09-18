import type { VerificationRoundMaterialIdentity, VerificationRoundScope } from './verification-context.js';
import type { ReviewRequestView } from './reviewer-verification.js';
import type { VerificationRoundRecord } from './verification-round.js';

export type QueryFactScope = { projectId: string; workspaceId: string; goalId: string };
/** Context-produced provenance from the captured Verification observation;
 * never a family label supplied in model tool arguments. */
export type QueryApplicabilityAuthority = {
  family: 'verification-applicability'; scope: QueryFactScope;
  observationVersion: string; observedAt: string; recordPointer: string;
  recordKind: 'tool-round' | 'independent-review'; recordId: string;
  recordVersion: string; recordedAt: string;
};
export type FactObservationStatus = 'ready' | 'ready-empty' | 'not_found' | 'unavailable' | 'stale' | 'failed';
/** Read observation only; never an authorization, task or acceptance command. */
export type QueryVerificationFacts = {
  schemaVersion: 1; scope: QueryFactScope; object: 'verification-stages';
  status: FactObservationStatus; observedAt: string; version: string;
  coverage: 'recorded-tool-rounds-and-independent-reviews'; issues: string[];
  rounds: Array<{
    scope: VerificationRoundScope; requestId: string; roundId: string;
    version: string; recordedAt: string; finishedAt: string | null;
    status: VerificationRoundRecord['status']; outcome: VerificationRoundRecord['outcome'];
    coverage: VerificationRoundRecord['coverage']; evidence: string[];
    applicability: { status: Exclude<FactObservationStatus, 'ready-empty'>; identity: VerificationRoundMaterialIdentity | null; issues: string[] };
  }>;
  reviews: Array<{
    scope: VerificationRoundScope; requestId: string; reviewId: string;
    version: string; recordedAt: string; phase: ReviewRequestView['phase'];
    execution: Pick<NonNullable<ReviewRequestView['execution']>, 'ref' | 'revision' | 'status' | 'outcome' | 'startedAt' | 'endedAt'> | null;
    formal: ReviewRequestView['formal'];
    applicability: { status: 'ready' | 'stale' | 'unavailable'; issues: string[] };
  }>;
};
export interface QueryVerificationFactsPort {
  queryFacts(scope: QueryFactScope, signal?: AbortSignal): Promise<QueryVerificationFacts>;
}

/** ArchitectureReview decisions bind a candidate bundle, not an arbitrary
 * alternative mentioned inside that bundle. InitialDesign option decisions
 * have a separate protocol and are outside this observation's coverage. */
export type QueryArchitectureDecisionFacts = {
  schemaVersion: 1; object: 'architecture-review-decision'; scope: QueryFactScope;
  ref: import('./architecture-review.js').ArchitectureReviewRef;
  revision: number; recordedAt: string; version: string;
  acceptedProposal: {
    status: 'ready' | 'not_found'; accepted: boolean | null;
    outcome: import('./baseline-evolution.js').ArchitectureChangeDecisionV1['outcome'] | null;
    decisionRef: import('./baseline-evolution.js').ArchitectureChangeDecisionRef | null;
    record: import('./baseline-evolution.js').ArchitectureChangeDecisionV1 | null;
  };
  selectedCandidate: {
    status: 'not_found'; coverage: 'explicit-human-option-choice-in-this-decision';
    reason: string;
    proposalSelection: {
      authority: 'proposal-author'; optionId: string;
      proposalRef: import('./architecture-inspection.js').ArchitectureCandidateProposalRef;
      proposalDigest: string;
      candidateRef: import('./baseline-evolution.js').CandidateArchitectureBaselineRef;
    };
  };
  activatedBaseline: {
    status: 'ready' | 'not_found'; coverage: 'recorded-activations-for-this-proposal-and-decision';
    records: import('./baseline-evolution.js').BaselineActivationV1[];
    authority: 'historical-activation-records-not-current-source-acceptance';
  };
};

export type HumanActionDomain = 'initial-design' | 'initial-planning' | 'execution-feedback' | 'plan-change' | 'architecture-review' | 'unknown-side-effect' | 'rework';
export type QueryHumanActionsFacts = {
  schemaVersion: 1; object: 'pending-human-items'; scope: QueryFactScope;
  status: FactObservationStatus; observedAt: string; version: string;
  /** Null whenever some category or record is not completely observed. */
  pendingCount: number | null;
  domains: Array<{
    domain: HumanActionDomain; status: FactObservationStatus; coverage: string; issues: string[];
    records: Array<{
      ref: import('./fingerprint.js').JsonValue; revision: number; recordedAt: string;
      status: FactObservationStatus; pendingHumanAction: boolean | null;
      authority: 'formal-proposal' | 'recorded-query-question' | 'formal-goal-phase' | 'current-rework-preview';
      value: import('./fingerprint.js').JsonValue;
    }>;
  }>;
  issues: string[];
};
export interface QueryHumanActionsPort {
  queryHumanActions(scope: QueryFactScope, signal?: AbortSignal): Promise<QueryHumanActionsFacts>;
}

export const QUERY_FACT_ASSERTION_KINDS = ['observation_status', 'goal_phase', 'task_phase', 'run_status', 'run_outcome', 'decision_outcome', 'selected_option', 'baseline_activation', 'current_baseline_activation', 'pending_human_action', 'source_applicability', 'verification_outcome', 'task_dependencies'] as const;
export type QueryFactAssertion = { kind: typeof QUERY_FACT_ASSERTION_KINDS[number]; expected: string };
/** This verifies a declared state predicate, never the meaning of free prose. */
export function queryFactAssertionMatches(value: import('./fingerprint.js').JsonValue, claim: QueryFactAssertion, authority?: QueryApplicabilityAuthority): boolean {
  const object = (v: unknown): Record<string, any> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : null;
  const v = object(value); if (!v) return false;
  const run = v['ref']?.aggregateType === 'Run' && ['projectId', 'goalId', 'runId'].every(key => typeof v['ref'][key] === 'string' && v['ref'][key].length > 0)
    && Number.isSafeInteger(v['revision']) && v['revision'] >= 1 && ['starting', 'running', 'ended'].includes(v['status'])
    && 'startedAt' in v && 'endedAt' in v && v['planRef']?.aggregateType === 'PlanRevision';
  switch (claim.kind) {
    case 'task_dependencies': return v['ref']?.aggregateType === 'PlanRevision' && typeof v['ref'].projectId === 'string' && typeof v['ref'].planId === 'string'
      && Number.isSafeInteger(v['planRevision']) && v['planRevision'] >= 1 && Array.isArray(v['tasks']) && v['tasks'].some((t: any) => t.taskId === claim.expected)
      && Array.isArray(v['executionDag']?.dependsOn) && v['executionDag'].dependsOn.every((e: any) =>
        typeof e.taskId === 'string' && typeof e.dependsOnId === 'string' && ['output-contract', 'artifact', 'decision', 'environment-revision', 'gate-result'].includes(e.requires?.kind));
    case 'observation_status': {
      const empty = v['status'] === 'ready' && ((Array.isArray(v['rows']) && v['rows'].length === 0) || (Array.isArray(v['records']) && v['records'].length === 0));
      const status = empty ? 'ready-empty' : v['status'];
      return ['ready', 'ready-empty', 'not_found', 'unavailable', 'stale', 'failed'].includes(status) && claim.expected === status;
    }
    case 'goal_phase': return v['ref']?.aggregateType === 'GoalPhase' && claim.expected === v['phase'];
    case 'run_status': return run && claim.expected === v['status'];
    case 'run_outcome': return run && v['status'] === 'ended'
      && ['completed', 'failed', 'cancelled', 'budget_exhausted', 'crashed', 'outcome_unknown'].includes(v['outcome']) && claim.expected === v['outcome'];
    case 'task_phase': return (typeof v['taskId'] === 'string' && claim.expected === (v['reduction']?.phase ?? (v['reduction'] === null ? 'unknown' : undefined)))
      || (v['ref']?.aggregateType === 'TaskReduction' && claim.expected === v['phase'])
      || (typeof v['reviewId'] === 'string' && claim.expected === v['formal']?.taskPhase);
    case 'decision_outcome': {
      if (v['proposalRef']?.aggregateType === 'InitialDesignProposal')
        return typeof v['decisionId'] === 'string' && typeof v['decidedAt'] === 'string'
          && typeof v['authorizedTarget']?.optionId === 'string'
          && ['accept', 'reject', 'defer'].includes(v['outcome']) && claim.expected === v['outcome'];
      const accepted = object(v['acceptedProposal']) ?? object(v['decisionFacts']?.acceptedProposal) ?? v;
      return accepted['status'] === 'ready' && ['accept', 'reject', 'defer'].includes(accepted['outcome'])
        && accepted['record']?.outcome === accepted['outcome'] && claim.expected === accepted['outcome'];
    }
    case 'selected_option': return v['proposalRef']?.aggregateType === 'InitialDesignProposal' && v['outcome'] === 'accept'
      && typeof v['authorizedTarget']?.optionId === 'string' && claim.expected === v['authorizedTarget'].optionId;
    case 'current_baseline_activation': return v['object'] === 'ArchitectureBaselineActivation' && v['status'] === 'ready'
      && v['active']?.ref?.aggregateType === 'ArchitectureBaselineRevision' && v['active'].ref.projectId === v['scope']?.projectId
      && typeof v['active'].activatedAt === 'string' && typeof v['active'].activatedBy?.kind === 'string'
      && claim.expected === v['active'].digest;
    case 'baseline_activation': return v['proposalRef']?.aggregateType === 'ArchitectureCandidateProposal' && v['decisionRef']?.aggregateType === 'ArchitectureChangeDecision'
      && typeof v['activationId'] === 'string' && typeof v['activatedAt'] === 'string' && claim.expected === v['toPin']?.digest;
    case 'pending_human_action': return v['status'] === 'ready' && typeof v['pendingHumanAction'] === 'boolean' && claim.expected === String(v['pendingHumanAction']);
    case 'source_applicability': {
      if (authority?.family !== 'verification-applicability') return false;
      const a = object(v['applicability']) ?? v;
      return ['ready', 'not_found', 'unavailable', 'stale', 'failed'].includes(a['status']) && claim.expected === a['status']
        && (a['status'] !== 'ready' || typeof a['identity']?.sourceDigest === 'string');
    }
    case 'verification_outcome': return typeof v['roundId'] === 'string' && Array.isArray(v['coverage'])
      && ['PASS', 'FAIL', 'INCONCLUSIVE'].includes(v['outcome']) && claim.expected === v['outcome'];
  }
}

/** Offer only declarations supported by this record. These are structured
 * values to cite, not suggested prose or a verdict about Task/Goal completion. */
export function queryFactSupportedAssertions(value: import('./fingerprint.js').JsonValue, authority?: QueryApplicabilityAuthority): QueryFactAssertion[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const v = value as Record<string, any>;
  const accepted = v['acceptedProposal'] ?? v['decisionFacts']?.acceptedProposal ?? v;
  const empty = v['status'] === 'ready' && ((Array.isArray(v['rows']) && !v['rows'].length) || (Array.isArray(v['records']) && !v['records'].length));
  const values: Partial<Record<QueryFactAssertion['kind'], unknown>> = {
    observation_status: empty ? 'ready-empty' : v['status'], goal_phase: v['phase'],
    task_phase: v['ref']?.aggregateType === 'TaskReduction' ? v['phase'] : v['formal']?.taskPhase ?? v['reduction']?.phase ?? (v['reduction'] === null ? 'unknown' : undefined),
    run_status: v['status'], run_outcome: v['outcome'], decision_outcome: accepted['outcome'],
    current_baseline_activation: v['active']?.digest, selected_option: v['authorizedTarget']?.optionId, baseline_activation: v['toPin']?.digest,
    pending_human_action: typeof v['pendingHumanAction'] === 'boolean' ? String(v['pendingHumanAction']) : undefined,
    source_applicability: authority ? v['applicability']?.status ?? v['status'] : undefined,
    verification_outcome: v['outcome'],
  };
  const supported = QUERY_FACT_ASSERTION_KINDS.flatMap(kind => {
    const expected = values[kind];
    return typeof expected === 'string' && expected.length > 0 && expected.length <= 256 && queryFactAssertionMatches(value, { kind, expected }, authority) ? [{ kind, expected }] : [];
  });
  for (const task of Array.isArray(v['tasks']) ? v['tasks'] : []) {
    if (typeof task.taskId === 'string' && task.taskId.length <= 256 && queryFactAssertionMatches(value, { kind: 'task_dependencies', expected: task.taskId }))
      supported.push({ kind: 'task_dependencies', expected: task.taskId });
  }
  return supported;
}

/** Known authority locations require a typed assertion before their citation
 * is published. This is not a classifier for arbitrary natural-language claims. */
export function queryFactNeedsAssertion(pointer: string, value: import('./fingerprint.js').JsonValue): boolean {
  if (pointer === '/material' || /^\/material\/architectureActivation(\/|$)/.test(pointer)) return true;
  if (/^\/material\/acceptedPlan(\/|$)/.test(pointer)) return true;
  // A missing reduction is still a scoped formal-state observation. Do not
  // issue an unchecked marker merely because this work has no phase yet.
  if (/^\/material\/collaborationWork\/\d+$/.test(pointer)
    || /^\/material\/collaborationWork\/\d+\/reduction(\/|$)/.test(pointer)) return true;
  if (!/^\/material\/(goalPhase|collaborationWork|architectureReviews|verificationStages|humanActions)(\/|$)/.test(pointer)) return false;
  // These containers have no shared top-level status field. Their descendants
  // still carry decisions or formal state; narrowing the pointer cannot bypass
  // the requirement to cite a complete, checkable authority record.
  if (/^\/material\/architectureReviews\/rows\/\d+\/decisionFacts(\/|$)/.test(pointer)
    || /^\/material\/verificationStages\/reviews\/\d+\/formal(\/|$)/.test(pointer)) return true;
  if (/\/(status|phase|outcome|decisionRef|pendingHumanAction|pendingCount)$/.test(pointer)) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Array.isArray(value);
  return ['status', 'phase', 'outcome', 'pendingHumanAction', 'decisionFacts', 'applicability', 'activatedAt', 'authorizedTarget'].some(key => key in value);
}
