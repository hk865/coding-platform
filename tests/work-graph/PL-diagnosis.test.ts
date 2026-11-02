/**
 * PL mechanical diagnosis (slice-PL-SPEC §6.2; ruling C.2): the pure diagnosis
 * over a candidate's required verification requirements. `null` coverage means
 * unknown; `[]` means checks are configured but none exist. An empty required
 * obligation belongs to plan validation and never becomes a finding.
 */
import { describe, expect, it } from 'vitest';
import type { AcceptanceObligation } from '../../src/contracts/plan.js';
import type { CheckCapabilityV1 } from '../../src/contracts/verification.js';
import { diagnosePlanCandidate } from '../../src/core/work-graph/state/plan-candidate.js';

const STATIC_CHECK: CheckCapabilityV1 = { checkId: 'check-static', kind: 'static', coversKinds: ['static'], replayable: false };
const DYNAMIC_CHECK: CheckCapabilityV1 = { checkId: 'check-dynamic', kind: 'dynamic', coversKinds: ['dynamic'], replayable: false };

function obligationOf(
  obligationId: string,
  requirementLevel: 'required' | 'optional',
  requirements: readonly { requirementId: string; kind: string; requirementLevel?: 'required' | 'optional' }[],
): AcceptanceObligation {
  return { obligationId, title: obligationId, requirementLevel, taskIds: [],
    verificationRequirements: requirements.map(row => ({ requirementId: row.requirementId,
      requirementLevel: row.requirementLevel ?? 'required', kind: row.kind, description: row.requirementId })) };
}

const uncoveredRows = [
  { name: 'reviewer requirement is unsupported', kind: 'reviewer', code: 'reviewer_not_supported' },
  { name: 'dynamic requirement has no check', kind: 'dynamic', code: 'no_registered_check' },
] as const;

describe('diagnosePlanCandidate', () => {
  it.each(uncoveredRows)('$name', ({ kind, code }) => {
    const findings = diagnosePlanCandidate({
      candidate: { obligations: [obligationOf('ob-1', 'required', [{ requirementId: `req-${kind}`, kind }])] },
      catalogPin: null, requirementKinds: ['static', 'dynamic', 'reviewer'], checks: [STATIC_CHECK],
    });
    expect(findings).toHaveLength(1);
    expect(findings?.[0]).toMatchObject({ obligationId: 'ob-1', requirementId: `req-${kind}`, kind, code });
    expect(findings?.[0]?.message.length).toBeGreaterThan(0);
  });

  it('full coverage reports no findings and ignores optional and empty required obligations', () => {
    const findings = diagnosePlanCandidate({
      candidate: { obligations: [
        obligationOf('ob-covered', 'required', [
          { requirementId: 'req-static', kind: 'static' },
          { requirementId: 'req-dynamic', kind: 'dynamic' },
          { requirementId: 'req-optional', kind: 'static', requirementLevel: 'optional' },
        ]),
        obligationOf('ob-optional', 'optional', [{ requirementId: 'req-ignored', kind: 'static' }]),
        obligationOf('ob-empty', 'required', []),
      ] },
      catalogPin: null, requirementKinds: ['static', 'dynamic'], checks: [STATIC_CHECK, DYNAMIC_CHECK],
    });
    expect(findings).toEqual([]);
  });

  it('checks: null means coverage is unknown and reports null', () => {
    const findings = diagnosePlanCandidate({
      candidate: { obligations: [obligationOf('ob-null', 'required', [{ requirementId: 'req-null', kind: 'static' }])] },
      catalogPin: null, requirementKinds: ['static'], checks: null,
    });
    expect(findings).toBeNull();
  });

  it('checks: [] reports one no_registered_check per required requirement in candidate order', () => {
    const findings = diagnosePlanCandidate({
      candidate: { obligations: [
        obligationOf('ob-empty-list', 'required', [
          { requirementId: 'req-static', kind: 'static' },
          { requirementId: 'req-dynamic', kind: 'dynamic' },
          { requirementId: 'req-optional', kind: 'static', requirementLevel: 'optional' },
        ]),
        obligationOf('ob-optional', 'optional', [{ requirementId: 'req-ignored', kind: 'static' }]),
      ] },
      catalogPin: null, requirementKinds: ['static', 'dynamic'], checks: [],
    });
    expect(findings).toEqual([
      { obligationId: 'ob-empty-list', requirementId: 'req-static', kind: 'static', code: 'no_registered_check', message: expect.any(String) },
      { obligationId: 'ob-empty-list', requirementId: 'req-dynamic', kind: 'dynamic', code: 'no_registered_check', message: expect.any(String) },
    ]);
  });
});
