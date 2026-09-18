import { expect, it } from 'vitest';
import { assertDecisionReport, deterministicReview } from './coding-collaboration-verification.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';

const recipients = ['reader-a-resume', 'reader-b-resume'];
const pendingReport = { readonlyReport: { report: 'The human decision is pending at this report frontier; no baseline activation is claimed.' } };

it('the deterministic Reviewer can assess a pre-decision original without fabricating a received decision', () => {
  const packet = { kind: 'independent-review-packet', workRef: { reviewId: 'review' }, descriptorDigest: 'descriptor',
    materialIdentity: { sourceDigest: 'source' }, materials: [{ kind: 'tool-report', materialId: 'report', ref: { digest: 'report-digest' } }], coverage: [{ obligationId: 'o', requirementId: 'r' }] };
  const source = { materialId: 'source:src/utils/grouping.mjs', truncated: false, sourceDigest: 'source', content: 'if (!t.due) {\n out.today.push(t)\n continue\n}' };
  const report = { ref: { digest: 'report-digest' }, complete: true, ...pendingReport };
  const request = { messages: [{ role: 'user', content: JSON.stringify([packet, { reviewId: 'review', packetDigest: 'packet' }]) },
    { role: 'tool', result: { output: [{ kind: 'json', value: source }, { kind: 'json', value: report }] } }] } as unknown as ModelRequest;
  expect(() => deterministicReview(request)).not.toThrow();
  expect(deterministicReview(request).answer).toBeDefined();
});

it('does not confuse a pre-decision report with a Run that actually received a decision', () => {
  expect(() => assertDecisionReport([pendingReport], 'coordinator-original', recipients)).not.toThrow();
});
it('still requires corroboration for an actual recipient regardless of its report wording', () => {
  expect(() => assertDecisionReport([{ readonlyReport: { report: 'Acknowledged.' } }], recipients[0]!, recipients)).toThrow();
});
it('cannot omit all reports for an actual recipient', () => {
  expect(() => assertDecisionReport([], recipients[0]!, recipients)).toThrow();
});
it('accepts the matching producer identity in the current report', () => {
  expect(() => assertDecisionReport([{ readonlyReport: { report: 'Acknowledged.', collaborationFacts: { kind: 'producer-collaboration-facts', producerRunRef: { runId: recipients[0] } } } }], recipients[0]!, recipients)).not.toThrow();
});
it('rejects copied corroboration from another producer even when no keyword appears', () => {
  expect(() => assertDecisionReport([{ readonlyReport: { report: 'Acknowledged.', collaborationFacts: { kind: 'producer-collaboration-facts', producerRunRef: { runId: 'different-run' } } } }], recipients[0]!, recipients)).toThrow();
});
