/**
 * Secretary selection's pure half (book-6a §3.4.2-§3.4.4, §3.12; spec §5.2
 * R-01a): `latestActivityAt` and `orderCandidates`, called with hand-built
 * facts. The expected literals are spec R-01a's own example (A/C/D/B and the
 * opening secretary S0). The two frozen types come from the module the frozen
 * interface names (`tasks/secretary-selection.ts`), never a copy.
 */
import { describe, expect, it } from 'vitest';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type {
  SecretaryCandidateFactsV1, SecretarySelectionFactsV1,
} from '../../src/core/work-graph/tasks/secretary-selection.js';
import { orderCandidates } from '../../src/core/work-graph/tasks/secretary-selection.js';
import { latestActivityAt } from '../../src/core/work-graph/tasks/line-clock.js';

const PROJECT = 's6a-selection-pure-project';

const BUDGET: RuntimeBudget = {
  contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 16,
  maxToolCalls: 16, timeoutMs: 60000, perResponseTokens: 512,
};

function profileOf(id: string): SecretaryCandidateFactsV1['profile'] {
  const role: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'test-secretary', templateRevision: '1' };
  const roleBinding: RoleBindingRefV1 = {
    schemaVersion: 1, bindingId: `${id}-binding`, templateId: 'test-secretary', templateRevision: '1',
    bindingVersion: 1, policyRevision: 'test-policy',
  };
  return {
    profileId: id, sessionRole: role, roleBinding, runtimeBudget: BUDGET,
    budget: { maxTokens: 1000, deadline: null }, consumerId: 'test-consumer',
  };
}

function candidate(sessionId: string, over: Partial<SecretaryCandidateFactsV1> = {}): SecretaryCandidateFactsV1 {
  return {
    session: { projectId: PROJECT, sessionId },
    revision: 1,
    scope: { kind: 'project' },
    profile: profileOf(sessionId),
    busy: false,
    ranGoal: false,
    lastInputTokens: null,
    tooLong: false,
    lastActivityAt: '2026-10-23T09:00:00.000Z',
    ...over,
  };
}

function factsOf(candidates: SecretaryCandidateFactsV1[]): SecretarySelectionFactsV1 {
  return { candidates, guards: [], watermark: null };
}

const ids = (facts: SecretaryCandidateFactsV1[]): string[] => facts.map((entry) => entry.session.sessionId);

// ------------------------------------------------------------------------ //
// latestActivityAt (pure)                                                   //
// ------------------------------------------------------------------------ //

describe('latestActivityAt', () => {
  it('takes the lexicographically greatest ISO instant', () => {
    expect(latestActivityAt('2026-10-23T09:00:00.000Z', [
      '2026-10-23T09:30:00.000Z', '2026-10-23T08:00:00.000Z',
    ])).toBe('2026-10-23T09:30:00.000Z');
  });

  it('ignores null and undefined and keeps a tie', () => {
    expect(latestActivityAt('2026-10-23T09:00:00.000Z', [
      null, '2026-10-23T10:00:00.000Z', undefined, '2026-10-23T10:00:00.000Z',
    ])).toBe('2026-10-23T10:00:00.000Z');
  });

  it('falls back to createdAt when nothing later exists', () => {
    expect(latestActivityAt('2026-10-23T09:00:00.000Z', [null, undefined])).toBe('2026-10-23T09:00:00.000Z');
    expect(latestActivityAt('2026-10-23T09:00:00.000Z', [])).toBe('2026-10-23T09:00:00.000Z');
    expect(latestActivityAt('2026-10-23T09:00:00.000Z', ['2026-10-23T08:59:59.999Z']))
      .toBe('2026-10-23T09:00:00.000Z');
  });
});

// ------------------------------------------------------------------------ //
// orderCandidates (pure, rule sheet A5)                                     //
// ------------------------------------------------------------------------ //

describe('orderCandidates (R-01a)', () => {
  it('orders A, D, B: ran this goal first, known usage before none', () => {
    const A = candidate('a', { ranGoal: true, lastInputTokens: 100_000,
      lastActivityAt: '2026-10-23T10:00:00.000Z' });
    const D = candidate('d', { ranGoal: true, lastInputTokens: null,
      lastActivityAt: '2026-10-23T09:00:00.000Z' });
    const B = candidate('b', { ranGoal: false, lastInputTokens: 80_000,
      lastActivityAt: '2026-10-23T08:00:00.000Z' });
    const C = candidate('c', { ranGoal: false, lastInputTokens: 500_000, tooLong: true,
      lastActivityAt: '2026-10-23T09:30:00.000Z' });
    expect(ids(orderCandidates(factsOf([A, C, D, B]), { goalId: 'g1' }))).toEqual(['a', 'd', 'b']);
  });

  it('drops busy candidates: A busy leaves D before B', () => {
    const A = candidate('a', { ranGoal: true, lastInputTokens: 100_000, busy: true });
    const D = candidate('d', { ranGoal: true, lastInputTokens: null });
    const B = candidate('b', { ranGoal: false, lastInputTokens: 80_000 });
    expect(ids(orderCandidates(factsOf([A, D, B]), { goalId: 'g1' }))).toEqual(['d', 'b']);
  });

  it('drops busy candidates: A and D busy leaves B', () => {
    const A = candidate('a', { ranGoal: true, busy: true });
    const D = candidate('d', { ranGoal: true, busy: true });
    const B = candidate('b', { ranGoal: false, lastInputTokens: 80_000 });
    expect(ids(orderCandidates(factsOf([A, D, B]), { goalId: 'g1' }))).toEqual(['b']);
  });

  it('returns none when every candidate is busy or too long', () => {
    expect(orderCandidates(factsOf([
      candidate('a', { busy: true }), candidate('c', { tooLong: true }),
    ]), { goalId: 'g1' })).toEqual([]);
  });

  it('a goal-scope secretary that did not run the goal still follows one that did', () => {
    const A = candidate('a', { scope: { kind: 'goal', goalId: 'g1' }, ranGoal: true,
      lastActivityAt: '2026-10-23T10:00:00.000Z' });
    const S0 = candidate('s0', { scope: { kind: 'project' }, ranGoal: false,
      lastActivityAt: '2026-10-23T11:00:00.000Z' });
    expect(ids(orderCandidates(factsOf([S0, A]), { goalId: 'g1' }))).toEqual(['a', 's0']);
  });

  it('among candidates that ran the goal, later activity wins, then the canonical key', () => {
    const X = candidate('x', { ranGoal: true, lastInputTokens: 10, lastActivityAt: '2026-10-23T10:00:00.000Z' });
    const Y = candidate('y', { ranGoal: true, lastInputTokens: 10, lastActivityAt: '2026-10-23T09:00:00.000Z' });
    const same = candidate('s-b', { ranGoal: true, lastInputTokens: 10, lastActivityAt: '2026-10-23T11:00:00.000Z' });
    const sameOther = candidate('s-a', { ranGoal: true, lastInputTokens: 10, lastActivityAt: '2026-10-23T11:00:00.000Z' });
    expect(ids(orderCandidates(factsOf([Y, X, same, sameOther]), { goalId: 'g1' })))
      .toEqual(['s-a', 's-b', 'x', 'y']);
  });

  it('known usage comes before no usage when the ran-goal key ties', () => {
    const K = candidate('k', { ranGoal: true, lastInputTokens: 12, lastActivityAt: '2026-10-23T08:00:00.000Z' });
    const N = candidate('n', { ranGoal: true, lastInputTokens: null, lastActivityAt: '2026-10-23T12:00:00.000Z' });
    expect(ids(orderCandidates(factsOf([N, K]), { goalId: 'g1' }))).toEqual(['k', 'n']);
  });

  it('filters goal scope: g1 candidates plus project scope, never g2', () => {
    const G1 = candidate('g1-one', { scope: { kind: 'goal', goalId: 'g1' }, lastActivityAt: '2026-10-23T12:00:00.000Z' });
    const G2 = candidate('g2-one', { scope: { kind: 'goal', goalId: 'g2' }, lastActivityAt: '2026-10-23T13:00:00.000Z' });
    const P = candidate('p-one', { lastActivityAt: '2026-10-23T11:00:00.000Z' });
    expect(ids(orderCandidates(factsOf([G2, P, G1]), { goalId: 'g1' }))).toEqual(['g1-one', 'p-one']);
  });

  it('a no-goal request takes only project scope', () => {
    const G1 = candidate('g1-one', { scope: { kind: 'goal', goalId: 'g1' } });
    const P = candidate('p-one', {});
    expect(ids(orderCandidates(factsOf([G1, P]), { goalId: null }))).toEqual(['p-one']);
  });

  it('does not mutate the facts it was given', () => {
    const input = factsOf([candidate('b'), candidate('a')]);
    orderCandidates(input, { goalId: null });
    expect(ids(input.candidates)).toEqual(['b', 'a']);
  });
});
