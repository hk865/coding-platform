import type { VerificationServicePort } from '../../contracts/verification-service.js';
import type { QueryFactScope, QueryVerificationFacts } from '../../contracts/query-quality-facts.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { VerificationServiceDeps } from "./verification-deps.js";
import type { VerificationScope } from '../../contracts/verification-import.js';
import { VerificationJournal } from './verification-journal.js';
import { VerificationReports } from './verification-reports.js';
import { CommandCheckLifecycle } from './command-check-lifecycle.js';
import { BenchmarkVerification } from './benchmark-verification.js';
import { RecordedVerification } from './recorded-verification.js';
import { VerificationRounds } from './verification-rounds.js';
import type { VerificationRoundScope } from '../../contracts/verification-context.js';
import type { VerificationRoundStartInput, VerificationRoundResumeInput } from '../../contracts/verification-round.js';
import type { VerificationRequestV1 } from '../../contracts/verification.js';
import { ReviewerVerification } from './reviewer-verification.js';
import { VerificationOpenIssues } from './verification-open-issues.js';
import { ReworkVerification } from './rework-verification.js';
import type { OpenIssuesRequestV1, OpenIssuesViewV1 } from '../../contracts/rework/issues.js';
import type { ReviewResumeInput, ReviewStartInput, ReviewRecoverInput } from '../../contracts/reviewer-verification.js';
/** Public lifecycle facade. The application does not orchestrate protocol storage or Control sequencing. */
export class VerificationService implements VerificationServicePort {
  readonly recorded: RecordedVerification;
  private readonly journal: VerificationJournal;
  private readonly checks: CommandCheckLifecycle;
  private readonly benchmarks: BenchmarkVerification;
  private readonly rounds: VerificationRounds;
  private readonly reviews: ReviewerVerification;
  private readonly issues: VerificationOpenIssues;
  private readonly rework: ReworkVerification;
  constructor(private readonly deps: VerificationServiceDeps) {
    this.journal = new VerificationJournal(deps.directory);
    this.recorded = new RecordedVerification(deps);
    this.checks = new CommandCheckLifecycle(deps, this.journal);
    this.rounds = new VerificationRounds(deps, this.journal, this.checks);
    this.reviews = new ReviewerVerification(deps, this.journal, this.rounds);
    this.rework = new ReworkVerification(deps, this.journal, this.rounds, this.reviews);
    this.benchmarks = new BenchmarkVerification(deps, this.journal, new VerificationReports(deps.vault), this.recorded);
    // 失败事实的 exitCode／timedOut／stderr 摘要只存在于原始检查报告正文里；
    // 这里注入本模块既有的报告读取端口（同一 owner 授权校验），不复制正文。
    this.issues = new VerificationOpenIssues({ journal: this.journal, disposition: deps.disposition,
      reports: (ref, owner) => deps.context.openReport(ref, owner) });
  }
  async init() {
    await this.journal.init();
    await this.benchmarks.restoreArtifacts();
  }
  forRun(scope: VerificationScope) {
    return this.journal.forRun(scope);
  }
  /** Observe persisted stages and existing currentness witnesses; no resume or reduction. */
  async queryFacts(input: QueryFactScope, signal?: AbortSignal): Promise<QueryVerificationFacts> {
    signal?.throwIfAborted();
    const scope = { projectId: input.projectId, workspaceId: input.workspaceId, goalId: input.goalId };
    const observedAt = new Date().toISOString();
    const match = (s: QueryFactScope) => s.projectId === scope.projectId && s.workspaceId === scope.workspaceId && s.goalId === scope.goalId;
    const rounds = this.journal.rounds.filter(r => match(r.scope));
    const reviews = this.journal.reviews.filter(r => match(r.scope));
    const versionOf = (value: unknown) => sha256Hex(canonicalJson(JSON.parse(JSON.stringify(value))));
    const journalVersion = versionOf({ rounds, reviews });
    const facts: QueryVerificationFacts = { schemaVersion: 1, object: 'verification-stages', scope, observedAt, version: '',
      status: rounds.length || reviews.length ? 'ready' : 'ready-empty', coverage: 'recorded-tool-rounds-and-independent-reviews', rounds: [], reviews: [], issues: [] };
    try {
      if (Object.values(scope).some(value => typeof value !== 'string' || !value)) throw Error('Explicit verification scope required');
      if (rounds.length + reviews.length > 128) throw Error('Verification observation exceeds complete-result capacity');
      // Read each existing public view, including its source and report authority checks.
      for (const record of rounds) {
        signal?.throwIfAborted();
        const view = await this.round(record.scope, record.requestId, signal);
        signal?.throwIfAborted();
        let applicabilityStatus: QueryVerificationFacts['rounds'][number]['applicability']['status'] = view.current.status === 'current' ? 'ready' : view.current.status;
        if (view.current.status === 'stale' && view.materialIdentity) {
          // The legacy display view groups all failures under stale. Preserve
          // the typed authority result when exposing the new fact interface.
          const current = await this.deps.context.resolveRound(view.scope, view.materialIdentity);
          signal?.throwIfAborted();
          if (current.status === 'incomplete') applicabilityStatus = 'unavailable';
          else if (current.status === 'rejected') applicabilityStatus = current.code === 'not_found' ? 'not_found'
            : ['stale_material','source_changed','run_unsettled'].includes(current.code) ? 'stale' : 'failed';
        }
        const row = { scope: view.scope, requestId: view.requestId, roundId: view.roundId,
          recordedAt: view.createdAt, finishedAt: view.finishedAt, status: view.status, outcome: view.outcome,
          coverage: view.coverage, evidence: view.aggregate?.admissions.filter(a => a.status === 'admitted').map(a => a.evidenceId) ?? [],
          applicability: { status: applicabilityStatus, identity: view.materialIdentity, issues: view.current.issues } };
        facts.rounds.push({ ...row, version: versionOf(row) });
      }
      for (const record of reviews) {
        signal?.throwIfAborted();
        const view = await this.review(record.scope, record.requestId, signal);
        signal?.throwIfAborted();
        const run = view.execution;
        const row = { scope: view.scope, requestId: view.requestId, reviewId: view.reviewId, recordedAt: record.createdAt, phase: view.phase,
          execution: run ? { ref: run.ref, revision: run.revision, status: run.status, outcome: run.outcome, startedAt: run.startedAt, endedAt: run.endedAt } : null,
          formal: view.formal, applicability: { status: view.current.status === 'current' ? 'ready' as const : view.current.status, issues: view.current.issues } };
        facts.reviews.push({ ...row, version: versionOf(row) });
      }
      facts.rounds.sort((a,b) => a.roundId.localeCompare(b.roundId));
      facts.reviews.sort((a,b) => a.reviewId.localeCompare(b.reviewId));
      if (journalVersion !== versionOf({ rounds: this.journal.rounds.filter(r => match(r.scope)), reviews: this.journal.reviews.filter(r => match(r.scope)) })) {
        facts.status = 'stale'; facts.rounds = []; facts.reviews = [];
        facts.issues = ['Verification stages changed during observation; no mixed inventory returned.'];
      }
    } catch (error) {
      signal?.throwIfAborted();
      facts.status = 'failed'; facts.rounds = []; facts.reviews = []; facts.issues = [String(error)];
    }
    // Observation time is metadata; merely looking again does not stale an answer.
    facts.version = versionOf({ scope, status: facts.status, rounds: facts.rounds, reviews: facts.reviews, issues: facts.issues });
    return facts;
  }
  startRound(scope: VerificationRoundScope, input: VerificationRoundStartInput) { return this.rounds.startRound(scope, input); }
  reverifyRework(scope: VerificationRoundScope) { return this.rework.verify(scope); }
  prepareReworkReview(scope: VerificationRoundScope, roundRequestId: string) { return this.rework.prepareReview(scope, roundRequestId); }
  round(scope: VerificationRoundScope, requestId: string, signal?: AbortSignal) { return this.rounds.round(scope, requestId, signal); }
  roundReceipt(scope: Omit<VerificationScope, 'runId'>, requestId: string) { return this.rounds.roundReceipt(scope, requestId); }
  resumeRound(scope: VerificationRoundScope, input: VerificationRoundResumeInput) { return this.rounds.resumeRound(scope, input); }
  verify(request: VerificationRequestV1) { return this.rounds.verify(request); }
  openIssues(request: OpenIssuesRequestV1): Promise<OpenIssuesViewV1> { return this.issues.openIssues(request); }
  reviewMaterial(scope: VerificationRoundScope, roundRequestId: string) { return this.reviews.reviewMaterial(scope, roundRequestId); }
  startReview(scope: VerificationRoundScope, input: ReviewStartInput) { return this.reviews.startReview(scope, input); }
  recoverReview(scope: VerificationRoundScope, input: ReviewRecoverInput) { return this.reviews.recoverReview(scope, input); }
  review(scope: VerificationRoundScope, requestId: string, signal?: AbortSignal) { return this.reviews.review(scope, requestId, signal); }
  reviewReceipt(scope: Pick<VerificationRoundScope, 'projectId' | 'workspaceId' | 'goalId'>, requestId: string) { return this.reviews.reviewReceipt(scope, requestId); }
  resumeReview(scope: VerificationRoundScope, input: ReviewResumeInput) { return this.reviews.resumeReview(scope, input); }
  checkReportMaterials(scope?: VerificationScope) {
    return this.checks.checkReportMaterials(scope);
  }
  runChecks(scope: VerificationScope, input: Record<string, unknown>) {
    return this.checks.runChecks(scope, input);
  }
  checkReceipt(scope: Omit<VerificationScope, 'runId'>, requestId: string) {
    return this.checks.checkReceipt(scope, requestId);
  }
  checkReports(scope: VerificationScope, requestId: string) {
    return this.checks.checkReports(scope, requestId);
  }
  admitCheckEvidence(scope: VerificationScope, input: Record<string, unknown>) {
    return this.checks.admitCheckEvidence(scope, input);
  }
  reconcileCheck(scope: VerificationScope, requestId: string) {
    return this.checks.reconcileCheck(scope, requestId);
  }
  register(scope: VerificationScope, input: Record<string, unknown>) {
    return this.benchmarks.register(scope, input);
  }
  import(scope: VerificationScope, input: Record<string, unknown>) {
    return this.benchmarks.import(scope, input);
  }
}
