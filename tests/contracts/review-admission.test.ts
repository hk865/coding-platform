/**
 * R4 / L13: the one shared review-round admission contract.
 *
 * The review round's tools are fixed by purpose (`RunSnapshot['purpose']`,
 * kind `unknown_call_review`): exactly `read`, `run_readonly_command` and
 * `record_unknown_call_review`, an empty write scope, a valid Role (its tool
 * ceiling is skipped) and Host layer 1 still holding.
 */
import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES,
  UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES,
  isReviewRoundPurpose,
  reviewHostLayerOneAccess,
  reviewRoundAdmissionProblem,
  type ReviewRoundAdmissionInput,
} from '../../src/contracts/review-admission.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';

const reviewPurpose: RunSnapshot['purpose'] = {
  kind: 'unknown_call_review',
  reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r-1' },
  phase: 'review',
  round: 1,
};

const admissible = (): ReviewRoundAdmissionInput => ({
  purpose: reviewPurpose,
  tools: [...UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES],
  writeScope: [],
  hostTools: ['read', 'run_readonly_command'],
  readonlyCommandAccess: 'all_except_denied',
  roleValid: true,
});

describe('UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES', () => {
  it('is exactly the L13 review-round set', () => {
    expect([...UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES]).toEqual([
      'read', 'run_readonly_command', 'record_unknown_call_review',
    ]);
  });
});

describe('UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES', () => {
  it('is exactly the L20 proposal-round set', () => {
    expect([...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES]).toEqual([
      'read', 'run_readonly_command', 'propose_safer_method',
    ]);
  });
});

describe('isReviewRoundPurpose', () => {
  it('is true only for a review-purpose Run', () => {
    expect(isReviewRoundPurpose(reviewPurpose)).toBe(true);
    expect(isReviewRoundPurpose(undefined)).toBe(false);
  });
});

describe('reviewHostLayerOneAccess', () => {
  it('A1 passes only when both Host tools and full read-only access are granted', () => {
    expect(reviewHostLayerOneAccess({
      hostTools: ['read', 'run_readonly_command'], readonlyCommandAccess: 'all_except_denied',
    })).toBeNull();
  });

  it('A1 reports host_tool_missing when read is not granted', () => {
    expect(reviewHostLayerOneAccess({
      hostTools: ['shell', 'run_readonly_command'], readonlyCommandAccess: 'all_except_denied',
    })).toBe('host_tool_missing');
  });

  it('A1 reports readonly_command_access_not_full when the access is narrowed', () => {
    expect(reviewHostLayerOneAccess({
      hostTools: ['read', 'run_readonly_command'], readonlyCommandAccess: null,
    })).toBe('readonly_command_access_not_full');
  });
});

describe('reviewRoundAdmissionProblem', () => {
  it('admits the exact set, empty write scope and Host layer 1', () => {
    expect(reviewRoundAdmissionProblem(admissible())).toBeNull();
  });

  it('compares the tool set order-insensitively', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), tools: ['record_unknown_call_review', 'read', 'run_readonly_command'],
    })).toBeNull();
  });

  it('rejects a missing tool', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), tools: ['read', 'run_readonly_command'],
    })).toBe('tool_set_mismatch');
  });

  it('rejects an extra tool', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), tools: [...UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES, 'shell'],
    })).toBe('tool_set_mismatch');
  });

  it('rejects a non-empty write scope', () => {
    expect(reviewRoundAdmissionProblem({ ...admissible(), writeScope: ['.'] })).toBe('write_scope_not_empty');
  });

  it('rejects hostTools missing run_readonly_command', () => {
    expect(reviewRoundAdmissionProblem({ ...admissible(), hostTools: ['read'] })).toBe('host_tool_missing');
  });

  it('rejects hostTools missing read', () => {
    expect(reviewRoundAdmissionProblem({ ...admissible(), hostTools: ['run_readonly_command'] })).toBe('host_tool_missing');
  });

  it('rejects a narrowed read-only command access', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), readonlyCommandAccess: null,
    })).toBe('readonly_command_access_not_full');
  });

  it('rejects an invalid Role resolution', () => {
    expect(reviewRoundAdmissionProblem({ ...admissible(), roleValid: false })).toBe('role_invalid');
  });

  it('does not treat a non-review Run as a review round', () => {
    expect(isReviewRoundPurpose(undefined)).toBe(false);
    expect(reviewRoundAdmissionProblem({ ...admissible(), purpose: undefined })).toBeNull();
  });

  it('L20: a proposal-phase review purpose with its own fixed set, empty write scope and Host layer 1 passes', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(),
      purpose: { ...reviewPurpose, phase: 'proposal' } as RunSnapshot['purpose'],
      tools: [...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES],
    })).toBeNull();
  });

  it('L20: a proposal-phase review purpose is refused the review phase\'s tool set', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(),
      purpose: { ...reviewPurpose, phase: 'proposal' } as RunSnapshot['purpose'],
      tools: [...UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES],
    })).toBe('tool_set_mismatch');
  });

  it('L20: a proposal-phase review purpose is refused a non-empty write scope', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(),
      purpose: { ...reviewPurpose, phase: 'proposal' } as RunSnapshot['purpose'],
      tools: [...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES],
      writeScope: ['.'],
    })).toBe('write_scope_not_empty');
  });

  it('L20: a proposal-phase review purpose still needs Host layer 1', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(),
      purpose: { ...reviewPurpose, phase: 'proposal' } as RunSnapshot['purpose'],
      tools: [...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES],
      hostTools: ['read'],
    })).toBe('host_tool_missing');
    expect(reviewRoundAdmissionProblem({
      ...admissible(),
      purpose: { ...reviewPurpose, phase: 'proposal' } as RunSnapshot['purpose'],
      tools: [...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES],
      readonlyCommandAccess: null,
    })).toBe('readonly_command_access_not_full');
  });

  it('still admits a review-phase review purpose with the fixed set', () => {
    expect(reviewRoundAdmissionProblem({ ...admissible(), purpose: { ...reviewPurpose, phase: 'review' } })).toBeNull();
  });

  it('still refuses a review-phase review purpose with the proposal tool set', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), tools: [...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES],
    })).toBe('tool_set_mismatch');
  });

  it('never rejects a non-review Run even with review-inadmissible facts', () => {
    expect(reviewRoundAdmissionProblem({
      purpose: undefined, tools: ['read', 'shell', 'edit'], writeScope: ['.'],
      hostTools: [], readonlyCommandAccess: null, roleValid: false,
    })).toBeNull();
  });
});
