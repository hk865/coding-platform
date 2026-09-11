import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { selectContextMaterials, type ContextCandidate, type MaterialSelectionRequest } from '../../src/data/context-compiler/material-selection.js';
const candidate = (id: string, change: Partial<ContextCandidate> = {}): ContextCandidate => ({ id, kind: 'source', content: id, digest: createHash('sha256').update(id).digest('hex'), source: { ref: id, version: '1', authority: 'test' }, required: false, consumers: ['executor', 'reviewer'], topics: [], eligibility: 'current', permissionBasis: 'explicit-test-scope', ...change });
const request: MaterialSelectionRequest = { consumer: 'executor', topics: ['relevant'], capacity: { maxBytes: 1000, inputTokens: null } };
it('retains required obligations, ranks role/topic material and excludes unrelated history before capacity selection', () => {
  const result = selectContextMaterials([candidate('old', { kind: 'history', eligibility: 'historical_explanation' }), candidate('source', { topics: ['relevant'] }), candidate('must', { required: true, kind: 'obligation' })], request);
  expect(result.status).toBe('ready'); expect(result.selected.map(c => c.id)).toEqual(['must', 'source']);
  expect(result.entries.find(e => e.id === 'old')).toMatchObject({ selected: false, reason: 'unrelated', applicability: 'historical_explanation' });
  expect(result.tokens).toBeNull(); expect(result.summaryApplied).toBe(false);
});
it.each(['forbidden', 'stale', 'unknown'] as const)('returns an actionable gap for a required %s material without silently substituting history', eligibility => {
  const result = selectContextMaterials([candidate('must', { required: true, eligibility })], request);
  expect(result).toMatchObject({ status: 'needs_material', selected: [], gaps: [{ id: 'must', reason: eligibility }] });
});
it('rejects missing/corrupt bodies and conflicting current rules with source-level reasons', () => {
  const result = selectContextMaterials([candidate('missing', { required: true, content: null }), candidate('bad', { required: true, digest: 'wrong' }), candidate('first', { kind: 'rule', ruleKey: 'style' }), candidate('second', { kind: 'rule', ruleKey: 'style' })], request);
  expect(result.status).toBe('needs_material'); expect(result.selected).toEqual([]);
  expect(result.gaps.map(g => g.reason)).toEqual(expect.arrayContaining(['missing_body', 'digest_mismatch', 'conflicting_current_rules']));
});
it('checks byte and tokenizer capacities independently and never clips required content', () => {
  const materials = [candidate('mandatory', { required: true })];
  expect(selectContextMaterials(materials, { ...request, capacity: { maxBytes: 2, inputTokens: null } })).toMatchObject({ status: 'needs_material', selected: [], gaps: [{ reason: 'capacity' }] });
  expect(selectContextMaterials(materials, { ...request, capacity: { maxBytes: 1000, inputTokens: 2 } })).toMatchObject({ status: 'needs_material', gaps: [{ reason: 'tokenizer_unavailable' }] });
  expect(selectContextMaterials(materials, { ...request, capacity: { maxBytes: 1000, inputTokens: 2 }, countTokens: () => 1 })).toMatchObject({ status: 'ready', tokens: 1, bytes: 9 });
});
