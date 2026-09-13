import { describe, expect, it, vi } from 'vitest';
import { ReworkVerification } from '../../src/control/verification-engine/rework-verification.js';
import { VerificationJournal } from '../../src/control/verification-engine/verification-journal.js';
import type { VerificationRounds } from '../../src/control/verification-engine/verification-rounds.js';
import type { VerificationServiceDeps } from "../../src/control/verification-engine/verification-deps.js";
import type { VerificationRoundRecord } from '../../src/contracts/verification-round.js';
import type { VerificationReworkMaterialResult } from '../../src/contracts/verification-context.js';
import type { ReviewJournalRecord } from '../../src/control/verification-engine/reviewer-record.js';
import type { ReviewerVerification } from '../../src/control/verification-engine/reviewer-verification.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';

// The existing real command/round suites own execution and reconciliation;
// these contract-seam cases isolate the automatic authorization transfer.
function fixture() {
  const scope = { projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 'repair', runId: 'new-run' };
  const runRef = { aggregateType: 'Run', projectId: 'p', runId: 'old-run' };
  const planRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'old-plan' };
  const journal = new VerificationJournal('unused');
  journal.rounds.push({ roundId: 'failed-round', requestId: 'original', status: 'completed', outcome: 'FAIL',
    scope: { ...scope, taskId: 'original-task', runId: 'old-run' },
    materialIdentity: { runRef, planRef, planRevision: 1 }, configuration: { checks: [] },
    checks: [{ definition: { checkId: 'test', kind: 'dynamic', command: 'npm test', cwd: '.', timeoutMs: 1000, appliesTo: { workspaceId: 'w', taskIds: 'all' } } }],
  } as unknown as VerificationRoundRecord);
  const resolved = { status: 'ready', proposalId: 'formal-proposal',
    material: { identity: { scope }, plan: { planRevision: 2 } },
    issues: [{ taskId: 'original-task', runRef, planRef, planRevision: 1,
      source: { kind: 'verification_round', roundId: 'failed-round', requestId: 'original', outcome: 'FAIL' } }],
  } as unknown as Extract<VerificationReworkMaterialResult, { status: 'ready' }>;
  const result = { round: { status: 'completed', current: { status: 'current' } }, replayed: false };
  const rounds = { startRound: vi.fn(async () => result), roundReceipt: vi.fn(async (): Promise<unknown> => null),
    round: vi.fn(async () => result.round), resumeRound: vi.fn(async () => ({ ...result, replayed: true })) };
  const resolveRework = vi.fn(async (): Promise<VerificationReworkMaterialResult> => resolved);
  const reopen = () => new ReworkVerification({ context: { resolveRework } } as unknown as VerificationServiceDeps, journal, rounds as unknown as VerificationRounds);
  return { service: reopen(), reopen, scope, journal, resolved, rounds, resolveRework };
}

describe('formal rework check authorization transfer', () => {
  it('returns not_rework without executing or creating a round for an ordinary Run', async () => {
    const f = fixture();
    f.resolveRework.mockResolvedValue({ status: 'not_rework' });
    expect(await f.service.verify(f.scope)).toEqual({ status: 'not_rework' });
    expect(f.rounds.startRound).not.toHaveBeenCalled();
  });
  it('inherits exact applicable commands and narrows all-Tasks authorization to the formal carrier', async () => {
    const f = fixture();
    await f.service.verify(f.scope);
    expect(f.rounds.startRound).toHaveBeenCalledWith(f.scope, expect.objectContaining({ allowExecute: true,
      configuration: { checks: [{ checkId: 'test', kind: 'dynamic', command: 'npm test', cwd: '.', timeoutMs: 1000, appliesTo: { workspaceId: 'w', taskIds: ['repair'] } }] } }));
  });
  it('resumes the same durable identity after repeat or service reconstruction without issuing another start', async () => {
    const f = fixture();
    await f.service.verify(f.scope);
    f.rounds.roundReceipt.mockResolvedValue({ roundId: 'existing' });
    await f.reopen().verify(f.scope);
    expect(f.rounds.startRound).toHaveBeenCalledTimes(1);
    expect(f.rounds.resumeRound).toHaveBeenCalledWith(f.scope, expect.objectContaining({ requestId: expect.stringMatching(/^rework-check-/) }));
  });
  it('refuses an old plan or a changed frozen workspace even for a repeated request', async () => {
    const f = fixture();
    f.resolved.material.plan.planRevision = 1;
    await expect(f.service.verify(f.scope)).rejects.toThrow('新版本');
    f.resolved.material.plan.planRevision = 2;
    f.rounds.roundReceipt.mockResolvedValue({ roundId: 'existing' });
    f.rounds.round.mockResolvedValue({ status: 'completed', current: { status: 'stale' } });
    await expect(f.service.verify(f.scope)).rejects.toThrow('已失效');
    expect(f.rounds.startRound).not.toHaveBeenCalled();
    expect(f.rounds.resumeRound).not.toHaveBeenCalled();
  });
  it('never inherits an interrupted source with unknown command effects', async () => {
    const f = fixture();
    f.journal.rounds[0]!.status = 'interrupted';
    await expect(f.service.verify(f.scope)).rejects.toThrow('完整冻结');
    expect(f.rounds.startRound).not.toHaveBeenCalled();
  });
  it('resolves Reviewer issue identity to its producer tool round while checking the independent output Run', async () => {
    const f = fixture(), issue = f.resolved.issues[0]!;
    issue.source = { kind: 'review_verdict', reviewId: 'original-task:review-request', requestId: 'review-request', resultRef: 'formal-review-result' };
    issue.runRef = { ...issue.runRef, runId: 'independent-reviewer-run' };
    issue.planRevision = 0; // Historical Reviewer issue view has no numeric plan revision.
    f.journal.reviews.push({ reviewId: 'journal-review-id', requestId: 'review-request', scope: f.journal.rounds[0]!.scope,
      roundRequestId: 'original', resultReceipt: { status: 'replayed', resultRef: { reviewId: 'formal-review-result' } },
      resultCommand: { decision: { status: 'accepted' }, output: { runRef: issue.runRef } },
    } as unknown as ReviewJournalRecord);
    await f.service.verify(f.scope);
    expect(f.rounds.startRound).toHaveBeenCalledTimes(1);
    issue.source.resultRef = 'different';
    await expect(f.service.verify(f.scope)).rejects.toThrow('正式接纳');
  });
  it('refuses a forged source Run', async () => {
    const f = fixture();
    f.resolved.issues[0]!.runRef = { ...f.resolved.issues[0]!.runRef, runId: 'foreign' };
    await expect(f.service.verify(f.scope)).rejects.toThrow('版本或作用域');
    expect(f.rounds.startRound).not.toHaveBeenCalled();
  });
  it('only prepares Reviewer after qualified tools and resumes its frozen request without selecting a new profile', async () => {
    const f = fixture();
    const roundRequestId = 'rework-check-' + sha256Hex(canonicalJson({ scope: f.scope, proposalId: f.resolved.proposalId }));
    const profile = vi.fn(async () => ({ status: 'ready', ref: { configId: 'profile', revision: 1, digest: 'a'.repeat(64) } }));
    const startReview = vi.fn(async () => ({ review: { phase: 'awaiting_result' }, replayed: false }));
    const resumeReview = vi.fn(async () => ({ review: { phase: 'awaiting_result' }, replayed: true }));
    const round = { status: 'completed', coverage: [{ kind: 'dynamic', result: 'PASS' }, { kind: 'reviewer', result: null }] };
    const rounds = { ...f.rounds, round: vi.fn(async () => round), reviewMaterial: vi.fn(async () => ({ status: 'ready', descriptor: { requiredReviewerCoverage: [{}] } })) };
    const service = new ReworkVerification({ context: { resolveRework: f.resolveRework }, review: { profiles: { current: profile } } } as unknown as VerificationServiceDeps,
      f.journal, rounds as unknown as VerificationRounds, { startReview, resumeReview } as unknown as ReviewerVerification);
    round.coverage[0]!.result = 'FAIL';
    expect(await service.prepareReview(f.scope, roundRequestId)).toBeNull();
    expect(profile).not.toHaveBeenCalled();
    round.coverage[0]!.result = 'PASS';
    await service.prepareReview(f.scope, roundRequestId);
    expect(startReview).toHaveBeenCalledWith(f.scope, expect.objectContaining({ roundRequestId, reviewerConfigRef: { configId: 'profile', revision: 1, digest: 'a'.repeat(64) } }));
    const requestId = 'rework-review-' + sha256Hex(canonicalJson({ scope: f.scope, roundRequestId }));
    f.journal.reviews.push({ scope: f.scope, requestId, roundRequestId } as ReviewJournalRecord);
    await service.prepareReview(f.scope, roundRequestId);
    expect(profile).toHaveBeenCalledTimes(1);
    expect(resumeReview).toHaveBeenCalledWith(f.scope, { requestId });
  });
});
