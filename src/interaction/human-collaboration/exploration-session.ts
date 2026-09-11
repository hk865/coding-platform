import { writeAtomicFile } from '../../storage/atomic-file.js';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { ExplorationSessionDeps, ExplorationSessionPort, ExplorationRunObservation } from '../../contracts/exploration-session.js';
import type { ExplorationScope as Scope, ExplorationPlan, ExplorationReport, ExplorationReview as Review } from '../../contracts/exploration.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const scopeKey = (scope: Scope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
function ensure(value: unknown, message: string): asserts value {
  if (!value)
    throw Error(message);
}
function text(value: unknown, label: string, cap = 4096): string {
  ensure(typeof value === 'string' && value.trim() && value.length <= cap, '无效字段：' + label);
  return value.trim();
}
function id(value: unknown, label: string): string {
  const s = text(value, label, label === 'runId' ? 128 : 64);
  ensure(/^[a-zA-Z0-9-]+$/.test(s), '无效标识：' + label);
  return s;
}
/** Operator-authored exploration plans and reviews; all live state is reduced by Control. */
export class ExplorationSession implements ExplorationSessionPort {
  private reports: ExplorationReport[] = [];
  private reviews: Review[] = [];
  constructor(private readonly deps: ExplorationSessionDeps) { }
  async init() {
    await this.deps.planning.init();
    await mkdir(this.deps.directory, { recursive: true, mode: 0o700 });
    for (const name of (await readdir(this.deps.directory)).sort()) {
      if (!/^(plan|report|review)-[a-f0-9]{64}\.json$/.test(name))
        continue;
      const body = JSON.parse(await readFile(join(this.deps.directory, name), 'utf8'));
      if (name.startsWith('report-'))
        this.reports.push(body as ExplorationReport);
      if (name.startsWith('review-'))
        this.reviews.push(body as Review);
    }
    for (const report of this.reports)
      await this.deps.verification.reportArtifact(report);
    for (const review of this.reviews)
      await this.reviewArtifact(review);
    await this.deps.startup.reconcile(this.deps.planning.acceptedPlans());
  }
  private async save(kind: string, key: string, body: unknown) {
    await writeAtomicFile(join(this.deps.directory, kind + '-' + key + '.json'), JSON.stringify(body));
  }
  private planFor(scope: Scope) {
    return this.deps.planning.plan(scope);
  }
  private context(scope: Scope) {
    return this.deps.context.current(scope, this.planFor(scope));
  }
  install(scope: Scope, input: Record<string, unknown>) {
    return this.deps.planning.exploration(scope, input);
  }
  private publicPlan(plan: ExplorationPlan) {
    return {
      planOrigin: plan.planOrigin,
      planId: plan.planId,
      tasks: plan.tasks,
      gateTaskId: plan.gateTaskId,
      sourceDigest: plan.sourceDigest,
      createdAt: plan.createdAt
    };
  }
  async prepareRun(scope: Scope, input: Record<string, unknown>, budget: RuntimeBudget) {
    const requestId = id(input['requestId'], 'requestId'),
      taskId = id(input['taskId'], 'taskId'),
      ctx = await this.context(scope);
    const runId = 'real-explore-' + requestId;
    const spec = this.deps.context.compileRunSpec(ctx, { runId, taskId, budget });
    const replay = await this.deps.context.replaySpec(scope, runId, taskId, budget);
    if (replay)
      return { ...replay, requestId };
    const readiness = await this.deps.control.dispatchReadiness({ projectId: scope.projectId, goalId: scope.goalId, taskId });
    ensure(readiness.status === 'ready' && readiness.eligibility.eligible, '当前节点尚不可执行：' + JSON.stringify(readiness));
    await this.deps.context.assertSource(scope, ctx.manifest.sourceDigest);
    this.deps.contextDrive.prerequisites(ctx.manifest, taskId, this.reports, this.reviews);
    return { spec, requestId, existing: null };
  }
  private async artifact(scope: Scope, ownerRunId: string, body: string, at: string): Promise<ArtifactRef> {
    const stored = await this.deps.vault.put({
      ownerRef: { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: ownerRunId },
      body,
      contentType: 'text/plain',
      requestedAt: at,
      sourceRefs: [{ kind: 'artifact', refId: digest(body), revision: '1', digest: digest(body) }]
    });
    ensure(stored.status === 'stored', '探索材料保存失败');
    return stored.ref;
  }
  private async capture(scope: Scope, record: ExplorationRunObservation) {
    const existing = this.reports.find(r => scopeKey(r) === scopeKey(scope) && r.runId === record.spec.runId);
    if (existing)
      return existing;
    const captured = await this.deps.verification.capture(scope, this.planFor(scope), record);
    await this.save('report', digest(scopeKey(scope) + captured.runId), captured);
    this.reports.push(captured);
    return captured;
  }
  async view(scope: Scope) {
    const manifest = this.deps.planning.acceptedPlans().find(p => scopeKey(p) === scopeKey(scope));
    if (!manifest)
      return null;
    const reportErrors: Array<{
      runId: string;
      error: string;
    }> = [];
    for (const record of await this.deps.context.completedRuns(scope)) {
      try {
        await this.capture(scope, record);
      }
      catch (e) {
        reportErrors.push({ runId: record.spec.runId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return {
      ...this.publicPlan(manifest),
      reports: this.reports.filter(r => scopeKey(r) === scopeKey(scope)).sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.runId.localeCompare(b.runId)),
      reviews: this.reviews.filter(r => scopeKey(r) === scopeKey(scope)).sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || a.reviewId.localeCompare(b.reviewId)).map(({ fingerprint: _f, ...r }) => r),
      reportErrors
    };
  }
  private async reviewArtifact(review: Review) {
    return this.artifact(review, review.runId ?? 'exploration-gate-' + review.goalId, canonicalJson({ ...review, control: null }), review.reviewedAt);
  }
  async review(scope: Scope, input: Record<string, unknown>) {
    const requestId = id(input['requestId'], 'requestId'),
      taskId = id(input['taskId'], 'taskId'),
      verdict = input['reviewVerdict'];
    ensure(verdict === 'PASS' || verdict === 'FAIL', '审阅结论必须为 PASS 或 FAIL');
    ensure(input['reviewOrigin'] === 'operator', '必须明确这是操作者审阅');
    const reviewText = text(input['reviewText'], 'reviewText', 8192),
      runId = taskId === 'gate-goal' ? null : id(input['runId'], 'runId');
    const reviewId = digest(canonicalJson([scopeKey(scope), requestId])),
      fingerprint = digest(canonicalJson({ scope, taskId, runId, verdict, reviewText }));
    const prior = this.reviews.find(r => r.reviewId === reviewId);
    if (prior) {
      ensure(prior.fingerprint === fingerprint, '同一审阅请求材料已改变');
      if (prior.control.status === 'pending')
        await this.applyReview(prior);
      return { review: prior, replayed: true };
    }
    const ctx = await this.context(scope);
    await this.deps.context.assertSource(scope, ctx.manifest.sourceDigest);
    ensure(!this.reviews.some(r => scopeKey(r) === scopeKey(scope) && r.taskId === taskId && r.runId === runId), '此报告已审阅，不能覆盖既有审阅结论');
    let reportDigest: string;
    if (taskId === 'gate-goal') {
      const reports = await this.deps.verification.satisfiedReports(scope, ctx.manifest, this.reports, this.reviews);
      reportDigest = digest(canonicalJson(reports.map(r => [r.taskId, r.runId, r.reportDigest])));
    }
    else {
      ensure(ctx.manifest.tasks.some(t => t.taskId === taskId), '审阅节点不属于当前探索计划');
      const record = this.deps.context.record(scope, runId!, taskId);
      ensure(record, '当前节点没有此真实运行');
      const report = await this.capture(scope, record);
      reportDigest = report.reportDigest;
    }
    const review: Review = {
      ...scope,
      reviewId,
      taskId,
      runId,
      reportDigest,
      sourceDigest: ctx.manifest.sourceDigest,
      workspaceRevision: ctx.workspaceRevision,
      planRef: ctx.plan.ref,
      verdict,
      reviewOrigin: 'operator',
      reviewText,
      reviewedAt: new Date().toISOString(),
      fingerprint,
      control: { status: 'pending', taskPhase: null, goalPhase: null, evidenceIds: [] }
    };
    await this.save('review', reviewId, review);
    this.reviews.push(review);
    await this.applyReview(review);
    return { review, replayed: false };
  }
  private async applyReview(review: Review) {
    const ctx = await this.context(review);
    ensure(ctx.workspaceRevision === review.workspaceRevision && canonicalJson(ctx.plan.ref) === canonicalJson(review.planRef), '审阅锚点已过期');
    await this.deps.context.assertSource(review, review.sourceDigest);
    if (review.taskId === 'gate-goal')
      await this.deps.verification.satisfiedReports(review, ctx.manifest, this.reports, this.reviews);
    review.control = await this.deps.recordedVerification.exploration(review, ctx.plan, await this.reviewArtifact(review));
    await this.save('review', review.reviewId, review);
  }
}
