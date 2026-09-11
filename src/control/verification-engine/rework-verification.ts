import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { VerificationRoundScope } from '../../contracts/verification-context.js';
import type { VerificationRoundResult, VerificationRegisteredCheck } from '../../contracts/verification-round.js';
import type { VerificationServiceDeps } from "./verification-deps.js";
import { VerificationJournal } from './verification-journal.js';
import { VerificationRounds } from './verification-rounds.js';
import { digest, ensure } from './verification-input.js';
import type { ReviewerVerification } from './reviewer-verification.js';
import type { ReviewRequestResult } from '../../contracts/reviewer-verification.js';

const same = (a: unknown, b: unknown) => canonicalJson(a as JsonValue) === canonicalJson(b as JsonValue);
type ReworkResult = VerificationRoundResult | { status: 'not_rework' };

/** Transfer explicit check authorization only through an applied rework origin.
 * Child execution and recovery remain owned by the existing round/check journal. */
export class ReworkVerification {
  private readonly running = new Map<string, Promise<ReworkResult>>();
  constructor(private readonly deps: VerificationServiceDeps, private readonly journal: VerificationJournal, private readonly rounds: VerificationRounds, private readonly reviews?: ReviewerVerification) {}

  async prepareReview(scope: VerificationRoundScope, roundRequestId: string): Promise<ReviewRequestResult | null> {
    const requestId = 'rework-review-' + digest(canonicalJson({ scope, roundRequestId }));
    const prior = this.journal.reviews.find(review => review.requestId === requestId && same(review.scope, scope));
    if (prior) {
      ensure(this.reviews && prior.roundRequestId === roundRequestId, '返工审阅回执来源不匹配');
      // Resume the frozen profile; changing the host's current profile must not
      // authorize a new draw or replace a previously failed reviewer.
      return this.reviews.resumeReview(scope, { requestId });
    }
    ensure(this.deps.context.resolveRework, '正式返工来源读取尚未接线');
    const resolved = await this.deps.context.resolveRework(scope);
    if (resolved.status === 'not_rework') return null;
    ensure(resolved.status === 'ready', '返工审阅当前来源不可用：' + JSON.stringify(resolved));
    ensure(roundRequestId === 'rework-check-' + digest(canonicalJson({ scope, proposalId: resolved.proposalId })), '返工审阅必须绑定本次正式重验轮次');
    const round = await this.rounds.round(scope, roundRequestId);
    if (!round.coverage.some(coverage => coverage.kind === 'reviewer')) return null;
    if (round.status !== 'completed' || round.coverage.some(coverage => coverage.kind !== 'reviewer' && coverage.result !== 'PASS')) return null;
    const material = await this.rounds.reviewMaterial(scope, roundRequestId);
    ensure(material.status === 'ready', '返工审阅工具材料不可用：' + JSON.stringify(material));
    if (!material.descriptor.requiredReviewerCoverage.length) return null;
    ensure(this.deps.review && this.reviews, '独立 Reviewer 尚未接线');
    const profile = await this.deps.review.profiles.current(scope);
    ensure(profile.status === 'ready', '返工 Reviewer 配置不可用：' + JSON.stringify(profile));
    return this.reviews.startReview(scope, { requestId, roundRequestId, reviewerConfigRef: profile.ref, allowExecute: true });
  }

  async verify(scope: VerificationRoundScope): Promise<ReworkResult> {
    const key = canonicalJson(scope);
    const active = this.running.get(key);
    if (active) { await active; return this.verify(scope); }
    const operation = this.advance(scope);
    this.running.set(key, operation);
    try { return await operation; } finally { this.running.delete(key); }
  }

  private async advance(scope: VerificationRoundScope): Promise<ReworkResult> {
    ensure(this.deps.context.resolveRework, '正式返工来源读取尚未接线');
    const resolved = await this.deps.context.resolveRework(scope);
    if (resolved.status === 'not_rework') return resolved;
    ensure(resolved.status === 'ready', '正式返工材料不可用：' + JSON.stringify(resolved));
    ensure(same(resolved.material.identity.scope, scope), '返工材料作用域不匹配');
    const definitions = new Map<string, VerificationRegisteredCheck>();
    for (const issue of resolved.issues) {
      const source = issue.source;
      const review = source.kind === 'review_verdict' ? this.journal.reviews.find(review => review.scope.taskId + ':' + review.requestId === source.reviewId && review.requestId === source.requestId) : null;
      if (source.kind === 'review_verdict') ensure(review?.resultReceipt && review.resultReceipt.status !== 'rejected' && review.resultCommand?.decision.status === 'accepted' && (review.resultReceipt.resultRef?.reviewId ?? review.reviewId) === source.resultRef && same(review.resultCommand.output.runRef, issue.runRef), '返工审阅来源尚未正式接纳');
      const round = this.journal.rounds.find(round => source.kind === 'verification_round'
        ? round.roundId === source.roundId && round.requestId === source.requestId
        : same(round.scope, review?.scope) && round.requestId === review?.roundRequestId);
      ensure(round?.configuration && round.materialIdentity && round.status === 'completed', '返工来源缺少完整冻结工具轮次');
      ensure(round.scope.projectId === scope.projectId && round.scope.workspaceId === scope.workspaceId && round.scope.goalId === scope.goalId && round.scope.taskId === issue.taskId && (source.kind === 'review_verdict' || same(round.materialIdentity.runRef, issue.runRef)) && same(round.materialIdentity.planRef, issue.planRef), '返工来源版本或作用域不匹配');
      ensure(resolved.material.plan.planRevision > round.materialIdentity.planRevision && scope.taskId !== issue.taskId, '返工必须使用正式新版本承担者');
      if (source.kind === 'verification_round') ensure(round.outcome === source.outcome, '返工失败轮次身份不匹配');
      // Only checks that actually applied to the failed Task transfer. Narrow
      // even a historical all-Tasks registration to this one rework Task.
      for (const item of round.checks) {
        const definition = { ...structuredClone(item.definition), appliesTo: { workspaceId: scope.workspaceId, taskIds: [scope.taskId] } };
        const prior = definitions.get(definition.checkId);
        ensure(!prior || same(prior, definition), '多个返工来源的检查配置冲突，需明确新配置');
        definitions.set(definition.checkId, definition);
      }
    }
    ensure(definitions.size > 0, '正式返工没有可继承的显式检查');
    const requestId = 'rework-check-' + digest(canonicalJson({ scope, proposalId: resolved.proposalId }));
    const existing = await this.rounds.roundReceipt(scope, requestId);
    if (existing) {
      const current = await this.rounds.round(scope, requestId);
      ensure(current.current.status === 'current', '返工重验冻结材料已失效');
      return this.rounds.resumeRound(scope, { requestId, allowExecute: true });
    }
    return this.rounds.startRound(scope, { requestId, allowExecute: true, configuration: { checks: [...definitions.values()].sort((a, b) => a.checkId.localeCompare(b.checkId)) } });
  }
}
