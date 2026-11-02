/**
 * PL-27: the pure plan-candidate decision (slice-PL-SPEC §6.1.3). The decision
 * table is checked row by row with literal expected decisions; the diagnosis
 * rule itself is proved once in `tests/work-graph/PL-diagnosis.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { PlanDiagnosisFindingV1 } from '../../src/contracts/plan-review.js';
import {
  decidePlanCandidate,
  type PlanCandidateDecisionV1,
  type PlanCandidateFactsV1,
} from '../../src/core/work-graph/state/plan-candidate.js';

/** A review opinion; `taskId: null` is a plan-level opinion. */
const REVIEW_FINDING = { taskId: null, text: 'tighten the acceptance line' } as const;

/** One mechanical-diagnosis finding; `message` is checked as non-empty. */
const DIAGNOSIS_FINDING: PlanDiagnosisFindingV1 = {
  obligationId: 'ob-1',
  requirementId: 'req-1',
  kind: 'static',
  code: 'no_registered_check',
  message: '没有已注册的检查能覆盖这条必需验证要求。',
};

const baseFacts: PlanCandidateFactsV1 = {
  proposal: {
    ref: {
      aggregateType: 'PlanProposal',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      proposalId: 'prop-1',
    },
    revision: 2,
    basedOn: null,
    source: 'agent_proposal',
    affectedTaskIds: [],
  },
  review: { status: 'not_sent' },
  fix: null,
  completedFixes: 0,
  adoptionPolicy: 'automatic',
  hasReviewLine: true,
  diagnosis: [],
};

/** `fix` verdict facts with the review verdict already decided. */
function fixVerdict(facts: Partial<PlanCandidateFactsV1>): Partial<PlanCandidateFactsV1> {
  return { ...facts, review: { status: 'decided', verdict: 'fix', findings: [REVIEW_FINDING] } };
}

/** `pass` verdict facts with no review findings. */
function passVerdict(facts: Partial<PlanCandidateFactsV1> = {}): Partial<PlanCandidateFactsV1> {
  return { review: { status: 'decided', verdict: 'pass', findings: [] }, ...facts };
}

const decisionRows: readonly {
  name: string;
  facts: Partial<PlanCandidateFactsV1>;
  expected: PlanCandidateDecisionV1;
}[] = [
  {
    name: 'not sent with a review line requests the review with the frozen id',
    facts: {},
    expected: { action: 'request_review', requestId: 'planreview:prop-1:2' },
  },
  {
    name: 'not sent without a review line cards no_review_line',
    facts: { hasReviewLine: false },
    expected: { action: 'card', reason: 'no_review_line' },
  },
  {
    name: 'waiting review waits, it is never re-sent',
    facts: { review: { status: 'waiting' } },
    expected: { action: 'wait', reason: 'review' },
  },
  {
    name: 'terminal invalid review cards review_invalid',
    facts: { review: { status: 'terminal_invalid', reason: 'unparseable answer' } },
    expected: { action: 'card', reason: 'review_invalid' },
  },
  {
    name: 'fix verdict at the cap cards fix_cap before the fix read',
    facts: fixVerdict({ completedFixes: 3, fix: { status: 'not_sent' } }),
    expected: { action: 'card', reason: 'fix_cap' },
  },
  {
    name: 'fix verdict above the cap cards fix_cap',
    facts: fixVerdict({ completedFixes: 4, fix: { status: 'not_sent' } }),
    expected: { action: 'card', reason: 'fix_cap' },
  },
  {
    name: 'fix verdict below the cap with no fix sent requests round completedFixes+1',
    facts: fixVerdict({ completedFixes: 2, fix: { status: 'not_sent' } }),
    expected: { action: 'request_fix', requestId: 'planfix:prop-1:2', rounds: 3 },
  },
  {
    name: 'fix verdict with the fix waiting waits, it is never re-sent',
    facts: fixVerdict({ completedFixes: 1, fix: { status: 'waiting' } }),
    expected: { action: 'wait', reason: 'fix' },
  },
  {
    name: 'fix verdict with the fix terminal cards fix_invalid',
    facts: fixVerdict({ completedFixes: 1, fix: { status: 'terminal' } }),
    expected: { action: 'card', reason: 'fix_invalid' },
  },
  {
    name: 'pass with empty diagnosis and automatic policy adopts',
    facts: passVerdict(),
    expected: { action: 'adopt' },
  },
  {
    name: 'pass with non-empty review findings and empty diagnosis still adopts',
    facts: passVerdict({ review: { status: 'decided', verdict: 'pass', findings: [REVIEW_FINDING] } }),
    expected: { action: 'adopt' },
  },
  {
    name: 'pass with a non-automatic policy cards not_automatic',
    facts: passVerdict({ adoptionPolicy: 'needs_decision' }),
    expected: { action: 'card', reason: 'not_automatic' },
  },
  {
    name: 'pass with a diagnosis finding cards diagnosis',
    facts: passVerdict({ diagnosis: [DIAGNOSIS_FINDING] }),
    expected: { action: 'card', reason: 'diagnosis' },
  },
  {
    name: 'pass with unknown diagnosis coverage cards diagnosis',
    facts: passVerdict({ diagnosis: null }),
    expected: { action: 'card', reason: 'diagnosis' },
  },
];

describe('decidePlanCandidate', () => {
  it.each(decisionRows)('$name', ({ facts, expected }) => {
    expect(decidePlanCandidate({ ...baseFacts, ...facts })).toEqual(expected);
  });
});
