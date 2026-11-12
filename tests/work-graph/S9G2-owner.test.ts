/**
 * Slice 9 G2 owner rows (lead ruling s9g2 #2): what the evidence owner decides about a review before the
 * Workflow (G3) calls it. Every prior state is reached through the R3e fixture's public owner steps.
 *
 * - The finalize fingerprint (F1): an empty `reviewerEvidence` is the omitted member, byte for byte, so it hits
 *   the same receipt. Receipt replay is storage, so the row runs on both backends (RULES S3).
 * - The finalize attribution (F2): a ref that is not this round's booked review is refused after the reads;
 *   nothing is written.
 * - The booking order (S1) as far as this tree reaches: an owner without the two review read ports answers
 *   `unsupported` after the terminal read. A finalized round's `busy` is E1's row (`tests/state/S9-vr16-pure.test.ts`).
 *   The answered exec review Query itself comes from G3's send chain, so the booking, its replay and the fold of a
 *   booked review are G3's E2/E4/E5.
 * - The commit identity export (S9-N6) takes only `open` and `record`; the interrupt and abandon identities stay
 *   inside the owner. Proved at the type level by one `@ts-expect-error` (typecheck fails if the export widens).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { EvidenceRef } from '../../src/contracts/evidence.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import { roundCommitIdentityOf } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createR3eEvidenceFixture, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';

const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

/** An open round on the fixture's ended work Run (its checks still pending). */
async function openRound(kind: 'memory' | 'sqlite' = 'memory'): Promise<{ fixture: R3eEvidenceFixture; round: RoundSnapshot }> {
  const fixture = await createR3eEvidenceFixture(kind);
  fixtures.push(fixture);
  const opened = await fixture.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error(`the round did not open: ${JSON.stringify(opened)}`);
  return { fixture, round: opened.value };
}

const evidenceRef = (fixture: R3eEvidenceFixture, evidenceId: string): EvidenceRef =>
  ({ aggregateType: 'Evidence', projectId: fixture.subject.projectId, evidenceId });

describe.each(['memory', 'sqlite'] as const)('F1 finalize fingerprint (%s)', (kind) => {
  it('an empty reviewerEvidence is the omitted member: the same request replays the same result', async () => {
    const { fixture, round } = await openRound(kind);
    const request = fixture.finalizeRequest(round);
    const first = await fixture.evidence.finalizeChecks(fixture.ctx, request);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    const again = await fixture.evidence.finalizeChecks(fixture.ctx,
      { ...request, input: { ...request.input, reviewerEvidence: [] } });
    expect(again).toEqual({ ...first, replayed: true });
  });
});

describe('rejects: F2 a finalize ref that is not the round\'s booked review', () => {
  // Before slice 9 the same request was refused up front as `unsupported`; now the refs are attributed after the reads.
  it('a ref with no booking → forbidden, the round unchanged', async () => {
    const { fixture, round } = await openRound();
    const request = fixture.finalizeRequest(round);
    const refused = await fixture.evidence.finalizeChecks(fixture.ctx,
      { ...request, input: { ...request.input, reviewerEvidence: [evidenceRef(fixture, 's9g2-not-booked')] } });
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await fixture.evidence.readVerification(fixture.ctx, round.ref)).toEqual({ status: 'ready', value: round });
  });
});

describe('rejects: S1 the booking before G3 wires the review reads', () => {
  it('an owner without the review read ports is unsupported', async () => {
    const { fixture, round } = await openRound();
    const book = fixture.evidence.recordReviewEvidence;
    expect(book).toBeDefined();
    expect(await book!(fixture.ctx, { input: { roundRef: round.ref }, meta: { requestId: 's9g2-book-1', expected: [] } }))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
  });
});

describe('S9-N6 the exported commit identity', () => {
  it('takes only open and record', () => {
    const actor = { kind: 'system', id: 'local-host' } as const;
    const scope = { projectId: 's9g2-project', workspaceId: 's9g2-workspace' };
    expect([roundCommitIdentityOf('open', actor, scope, 's9g2-id'), roundCommitIdentityOf('record', actor, scope, 's9g2-id')]
      .map((identity) => identity.split(':')[0])).toEqual(['r3e-open', 'r3e-record']);
    // @ts-expect-error interrupt (and abandon) identities are the owner's own, not part of the export
    roundCommitIdentityOf('interrupt', actor, scope, 's9g2-id');
  });
});
