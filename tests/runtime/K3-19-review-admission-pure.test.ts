/**
 * K3 U5 / R4 / L13 / L20: the inconsistent review-admission combinations that
 * the real path cannot produce, as a PURE input -> output test of
 * `reviewRoundAdmissionProblem` (src/contracts/review-admission.ts).
 *
 * The real review/proposal prepare always derives the phase's fixed tool set
 * and an empty write scope from the trusted purpose (`execution-preparation.ts`
 * `reviewPurpose` branch), so no public claim/prepare/start can hand admission
 * an ordinary manifest, a mixed-phase manifest or a non-empty write scope. Host
 * layer 1 off is likewise a Host-configuration fact, not a Run the public path
 * produces. Each row below constructs the input directly and pins the exact
 * stable reason.
 *
 * This file is also the equivalent of the old "refused before the model (zero
 * model calls)" assertion: there is no store, Runtime, model or tool call here
 * at all, so the refusal is a total function of the admission input.
 */
import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES,
  UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES,
  reviewRoundAdmissionProblem,
  type ReviewRoundAdmissionInput,
} from '../../src/contracts/review-admission.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';

type ReviewPurpose = NonNullable<RunSnapshot['purpose']>;

const reviewRef = { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r-1' } as const;

const reviewPurpose: ReviewPurpose = { kind: 'unknown_call_review', reviewRef, phase: 'review', round: 1 };
const proposalPurpose: ReviewPurpose = { ...reviewPurpose, phase: 'proposal' };

/** The exact facts the real prepare + Host layer 1 produce for a review/proposal Run. */
const admissible = (purpose: ReviewPurpose = reviewPurpose): ReviewRoundAdmissionInput => ({
  purpose,
  tools: purpose.phase === 'proposal'
    ? [...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES]
    : [...UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES],
  writeScope: [],
  hostTools: ['read', 'run_readonly_command'],
  readonlyCommandAccess: 'all_except_denied',
  roleValid: true,
});

describe('reviewRoundAdmissionProblem: real review/proposal facts (positive half)', () => {
  it('admits a review-phase purpose with exactly the L13 fixed set', () => {
    expect(reviewRoundAdmissionProblem(admissible())).toBeNull();
  });

  it('admits a proposal-phase purpose with exactly the L20 fixed set', () => {
    expect(reviewRoundAdmissionProblem(admissible(proposalPurpose))).toBeNull();
  });
});

describe('reviewRoundAdmissionProblem: combinations the real path cannot produce', () => {
  it('refuses an ordinary prepared manifest under a review purpose', () => {
    // An ordinary Work prepare would carry exploration/shell/edit names; a
    // review purpose can never be paired with that manifest by the real path.
    expect(reviewRoundAdmissionProblem({
      ...admissible(), tools: ['read', 'run_readonly_command', 'shell', 'edit'],
    })).toBe('tool_set_mismatch');
  });

  it('refuses a review-phase purpose with a proposal-phase manifest', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), tools: [...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES],
    })).toBe('tool_set_mismatch');
  });

  it('refuses a proposal-phase purpose with a review-phase manifest (the old L20 injected combination)', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(proposalPurpose), tools: [...UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES],
    })).toBe('tool_set_mismatch');
  });

  it('refuses a review-purpose manifest that misses the review write tool', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), tools: ['read', 'run_readonly_command'],
    })).toBe('tool_set_mismatch');
  });

  it('refuses a proposal-purpose manifest that misses the proposal write tool', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(proposalPurpose), tools: ['read', 'run_readonly_command'],
    })).toBe('tool_set_mismatch');
  });

  it('refuses a review-purpose manifest with one extra tool', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), tools: [...UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES, 'shell'],
    })).toBe('tool_set_mismatch');
  });

  it('refuses a proposal-purpose manifest with one extra tool', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(proposalPurpose), tools: [...UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES, 'shell'],
    })).toBe('tool_set_mismatch');
  });

  it('refuses a review-purpose manifest with a non-empty write scope', () => {
    expect(reviewRoundAdmissionProblem({ ...admissible(), writeScope: ['.'] })).toBe('write_scope_not_empty');
  });

  it('refuses a proposal-purpose manifest with a non-empty write scope', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(proposalPurpose), writeScope: ['.'],
    })).toBe('write_scope_not_empty');
  });

  it('refuses a Host layer 1 that does not grant run_readonly_command', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), hostTools: ['read'],
    })).toBe('host_tool_missing');
  });

  it('refuses a Host layer 1 whose read-only command access is narrowed', () => {
    expect(reviewRoundAdmissionProblem({
      ...admissible(), readonlyCommandAccess: null,
    })).toBe('readonly_command_access_not_full');
  });
});
