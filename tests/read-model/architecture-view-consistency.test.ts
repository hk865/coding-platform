import { expect, it } from 'vitest';
import { architectureReviewView } from '../../src/data/read-model-index/architecture-review-view.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { architectureChangeDecisionRefFor } from '../../src/contracts/baseline-evolution.js';

// Minimized equivalent of the existing real-ledger stalePage regression:
// scan ends, human decision commits, snapshot load sees the new revision.
function fixture(advances: boolean) {
  const scope = { projectId: 'p', workspaceId: 'w' };
  const ref = { aggregateType: 'ArchitectureReview', ...scope, reviewId: 'r' };
  const proposalRef = { aggregateType: 'ArchitectureCandidateProposal', ...scope, proposalId: 'p1' };
  const briefRef = { aggregateType: 'ArchitectureDecisionBrief', ...scope, briefId: 'b1' };
  const candidateRef = { aggregateType: 'CandidateBaseline', ...scope, candidateId: 'c' };
  const decisionRef = architectureChangeDecisionRefFor('p', 'w', 'd');
  const review = { ref, revision: 2, status: 'accepted', recordedAt: '2026-09-16T00:00:00Z', reporterRunRef: { goalId: 'g' }, targets: [], proposalRef, briefRef, candidateRef, proposalDigest: 'digest', decisionRef };
  const decision = { ...scope, decisionId: 'd', outcome: 'accept', subject: { candidateRef }, authorizedTarget: { candidateDigest: 'digest' } };
  const opened = { cursor: '1', event: { ...scope, eventType: 'ArchitectureReviewRecorded', payload: { action: 'open', snapshot: { ref, summary: 'Original' } } } };
  const decided = { cursor: '2', event: { ...scope, eventType: 'ArchitectureChangeDecisionRecorded', payload: { decision } } };
  let scans = 0;
  const ledger = {
    async events(q: any) {
      if (q.afterCursor === null) return { events: ++scans > 1 && advances ? [opened, decided] : [opened], hasMore: false };
      return { events: q.afterCursor === '1' && advances ? [decided] : [], hasMore: false };
    },
    async load(r: any) {
      const snapshots: Array<[any, any]> = [[ref, review], [proposalRef, { proposal: { expectedCandidateDigest: 'digest', selectedOptionId: 'a' } }], [briefRef, { brief: {} }]];
      const found = snapshots.find(([key]) => canonicalJson(key) === canonicalJson(r));
      return found ? { status: 'found', snapshot: found[1] } : { status: 'not_found' };
    },
  };
  return { scope, ledger, scans: () => scans };
}
it('retries a stale event scan before reporting a missing decision authority', async () => {
  const f = fixture(true);
  const view = await architectureReviewView(f.ledger as any, f.scope);
  expect(f.scans()).toBe(2);
  expect(view.rows[0]?.decisionFacts?.acceptedProposal).toMatchObject({ status: 'ready', accepted: true });
});
it('still rejects a genuinely missing decision at a stable cursor', async () => {
  const f = fixture(false);
  await expect(architectureReviewView(f.ledger as any, f.scope)).rejects.toThrow('decision authority');
});
