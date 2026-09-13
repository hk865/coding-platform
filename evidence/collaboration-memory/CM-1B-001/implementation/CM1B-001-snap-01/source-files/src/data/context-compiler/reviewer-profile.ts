import type { StateLedger } from '../../contracts/ledger.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import { validateRuntimeBudget } from '../../contracts/runtime-budget.js';
import { INDEPENDENT_REVIEWER_ROLE } from '../../contracts/reviewer-context.js';
import type { ReviewerConfigRef, ReviewerModelMetadataPort, ReviewerProfilePort, ReviewerProfileResult, ReviewerProfileV1, ReviewerRuntimeObservations } from '../../contracts/reviewer-context.js';
import type { VerificationRoundScope } from '../../contracts/verification-context.js';
const same = (a: unknown, b: unknown) => canonicalJson(a as JsonValue) === canonicalJson(b as JsonValue);
const exactScope = (scope: VerificationRoundScope): VerificationRoundScope => ({ projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId, taskId: scope.taskId, runId: scope.runId });

/** Select the producer Task's persisted budget and host's saved public model identity. */
export class ReviewerProfileCompiler implements ReviewerProfilePort {
  constructor(private readonly deps: { ledger: StateLedger; observations: ReviewerRuntimeObservations; modelMetadata: ReviewerModelMetadataPort }) {}
  async current(request: VerificationRoundScope): Promise<ReviewerProfileResult> {
    try {
      const scope = exactScope(request);
      if (!Object.values(scope).every(v => typeof v === 'string' && v.length > 0 && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v))) return { status: 'rejected', code: 'scope_mismatch', issues: ['Complete Task/producer scope is required'] };
      const observations = this.deps.observations.all().filter(r => same(exactScope(r.spec), scope));
      if (observations.length !== 1) return { status: 'incomplete', missing: ['Exactly one persisted Task budget observation is required'] };
      const observation = observations[0]!;
      const loaded = await this.deps.ledger.load({ aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: scope.runId });
      if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'Run') return { status: 'incomplete', missing: ['Canonical producer Run is unavailable'] };
      const run = loaded.snapshot as RunSnapshot;
      if (run.work || observation.spec.mode === 'review' || run.status !== 'ended' || !run.envelope || run.task.taskId !== scope.taskId || run.workspaceSnapshot.workspaceId !== scope.workspaceId || run.envelope.budget.tokenBudget !== observation.spec.budget.contextWindowTokens) return { status: 'rejected', code: 'scope_mismatch', issues: ['Profile scope or saved Task budget is inconsistent'] };
      const model = await this.deps.modelMetadata.current();
      if (!model) return { status: 'incomplete', missing: ['Reviewer model is not configured'] };
      if (!Object.values(model).every(v => typeof v === 'string' && v.length > 0)) return { status: 'incomplete', missing: ['Saved public model metadata is incomplete'] };
      const publicModel = { configurationRevision: model.configurationRevision, provider: model.provider, model: model.model, baseUrl: model.baseUrl };
      const selectedBudget = validateRuntimeBudget(observation.spec.budget);
      if (!same(selectedBudget, observation.spec.budget)) return { status: 'incomplete', missing: ['Persisted Task budget is incomplete; Reviewer does not invent missing budget fields'] };
      const after = this.deps.observations.all().filter(r => same(exactScope(r.spec), scope));
      const canonicalAfter = await this.deps.ledger.load(run.ref);
      if (after.length !== 1 || !same(after[0]!.spec, observation.spec) || canonicalAfter.status !== 'found' || !same(canonicalAfter.snapshot, run)) return { status: 'rejected', code: 'scope_mismatch', issues: ['Task budget or canonical producer changed during profile capture'] };
      const stable = { schemaVersion: 1 as const, subjectScope: scope, roleBinding: structuredClone(INDEPENDENT_REVIEWER_ROLE), mode: 'review' as const,
        permissions: { tools: ['read'], writeScope: [] as [] }, model: publicModel, budget: selectedBudget };
      const digest = sha256Hex(canonicalJson(stable));
      const profile: ReviewerProfileV1 = { ...stable, profileId: 'reviewer-profile-' + digest, revision: 1, digest };
      return { status: 'ready', ref: { configId: profile.profileId, revision: profile.revision, digest }, profile };
    } catch (error) { return { status: 'incomplete', missing: [error instanceof Error ? error.message : 'Reviewer profile is unavailable'] }; }
  }
  async resolve(scope: VerificationRoundScope, ref: ReviewerConfigRef): Promise<ReviewerProfileResult> {
    const result = await this.current(scope);
    return result.status === 'ready' && !same(result.ref, ref) ? { status: 'rejected', code: 'stale_configuration', issues: ['Saved model configuration or Task budget has changed'] } : result;
  }
}
