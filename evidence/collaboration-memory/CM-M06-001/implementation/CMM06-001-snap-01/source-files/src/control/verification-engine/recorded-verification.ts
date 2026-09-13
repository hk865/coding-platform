import { EvidenceAdmission, verificationAnchor } from './evidence-admission.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { RecordedVerificationPort } from '../../contracts/verification-service.js';
import type { RecordedVerificationDeps } from "./verification-deps.js";
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { ExplorationReview } from '../../contracts/exploration.js';
import type { VerificationAttempt, VerificationCandidate } from '../../contracts/verification-import.js';
import { buildEvidenceV1 } from '../../contracts/commands/evidence.js';
import { compileVerificationPlan } from './verification-plan-compiler.js';
function ensure(value: unknown, message: string): asserts value { if (!value)
    throw Error(message); }
/** Verification owns observation planning, evidence admission and reduction
 * requests. Exploration and benchmark keep distinct eligibility and identities;
 * Control remains the only authority that can satisfy a Task or Goal. */
export class RecordedVerification implements RecordedVerificationPort {
    constructor(private readonly deps: RecordedVerificationDeps) { }
    async exploration(input: ExplorationReview, plan: PlanRevisionSnapshot, artifactRef: ArtifactRef) {
        const review = structuredClone(input);
        const actor = {
            kind: 'human' as const, id: 'local-exploration-review'
        };
        const policy = await this.deps.context.policy(plan);
        ensure(policy.status === 'found', '探索完成策略无法解析');
        const compiled = compileVerificationPlan({
            schemaVersion: 1, taskRef: {
                projectId: review.projectId, goalId: review.goalId, taskId: review.taskId
            }, planRef: plan.ref, planSnapshot: plan, workspaceRevision: review.workspaceRevision, changeScope: {
                diffClass: 'project-exploration', changedFiles: [], writeSummary: '只读探索报告及来源由操作者核对；未执行构建或测试'
            }, semanticChange: 'none', risks: [], checkCapabilities: [{
                    checkId: 'operator-exploration-review', kind: 'static', coversKinds: ['static'], replayable: false
                }], policy: policy.snapshot.content
        });
        ensure(compiled.status === 'ready' && compiled.plan.checks.every(c => c.kind === 'static' && c.satisfactionPath === 'predicate'), '当前策略不能由探索报告核验覆盖');
        const evidenceId = 'explore-' + review.reviewId;
        const evidence = buildEvidenceV1({
            evidenceId, kind: 'observation', outcome: review.verdict, projectId: review.projectId, goalId: review.goalId, taskId: review.taskId, coverage: compiled.plan.checks.flatMap(c => c.coverage), anchor: verificationAnchor({
                plan: plan, workspaceRevision: review.workspaceRevision
            }), verificationPlanRef: {
                planId: compiled.plan.planId, planDigest: compiled.plan.planDigest
            }, runRef: review.runId ? {
                    aggregateType: 'Run' as const, projectId: review.projectId, goalId: review.goalId, runId: review.runId
                } : null, checkId: 'operator-exploration-review', actor, summaryText: '操作者审阅：' + review.verdict + '；报告 SHA-256：' + review.reportDigest + '；' + review.reviewText.slice(0, 300), artifactRef
        });
        const admission = new EvidenceAdmission(this.deps);
        const identity = {
            correlationId: review.reviewId, submittedAt: review.reviewedAt
        };
        review.control.taskPhase = await admission.task(evidence, actor, identity, evidenceId + '-task-');
        if (!review.control.evidenceIds.includes(evidenceId))
            review.control.evidenceIds.push(evidenceId);
        review.control.goalPhase = await admission.goal({
            projectId: review.projectId, goalId: review.goalId
        }, identity, evidenceId + '-goal-');
        review.control.status = 'applied';
        return review.control;
    }
    async benchmark(input: VerificationAttempt, c: VerificationCandidate, plan: PlanRevisionSnapshot, run: RunSnapshot, artifactRef: ArtifactRef) {
        const a = structuredClone(input);
        const actor = {
            kind: 'human' as const, id: 'local-benchmark-import'
        };
        const policy = await this.deps.context.policy(plan);
        const baseline = await this.deps.context.baseline(plan);
        ensure(policy.status === 'found' && baseline.status === 'found', '验收固定策略或架构版本无法解析');
        const tasks = plan.tasks.filter(t => t.taskId === run.envelope!.taskId || t.taskKind === 'gate');
        for (const task of tasks) {
            const compiled = compileVerificationPlan({
                schemaVersion: 1, taskRef: {
                    projectId: a.projectId, goalId: a.goalId, taskId: task.taskId
                }, planRef: plan.ref, planSnapshot: plan, workspaceRevision: c.workspaceRevision, changeScope: {
                    diffClass: 'code-change', changedFiles: c.changedPaths, writeSummary: '冻结候选的独立 benchmark 指定集合'
                }, semanticChange: 'semantic', risks: [], checkCapabilities: [{
                        checkId: 'external-benchmark', kind: 'dynamic', coversKinds: ['dynamic'], replayable: true
                    }], policy: policy.snapshot.content
            });
            ensure(compiled.status === 'ready' && compiled.plan.checks.every(check => check.kind === 'dynamic' && check.satisfactionPath === 'predicate'), '当前完成策略不能仅由 benchmark 覆盖');
            const evidenceId = a.verificationId + '-' + task.taskId;
            const evidence = buildEvidenceV1({
                evidenceId, kind: 'observation', outcome: a.verdict, projectId: a.projectId, goalId: a.goalId, taskId: task.taskId, coverage: compiled.plan.checks.flatMap(p => p.coverage), anchor: verificationAnchor({
                    plan: plan, workspaceRevision: c.workspaceRevision
                }), verificationPlanRef: {
                    planId: compiled.plan.planId, planDigest: compiled.plan.planDigest
                }, runRef: null, checkId: 'external-benchmark', actor, summaryText: a.purpose + ': ' + a.verdict + '; ' + a.counts.passed + '/' + (a.counts.failToPass + a.counts.passToPass) + '; report ' + a.source.reportDigest, artifactRef
            });
            const phase = await new EvidenceAdmission(this.deps).task(evidence, actor, {
                correlationId: a.verificationId, submittedAt: a.importedAt
            }, evidenceId + '-reduce-');
            if (!a.control.evidenceIds.includes(evidenceId))
                a.control.evidenceIds.push(evidenceId);
            if (task.taskKind === 'work')
                a.control.taskPhase = phase;
        }
        a.control.goalPhase = await new EvidenceAdmission(this.deps).goal({
            projectId: a.projectId, goalId: a.goalId
        }, {
            correlationId: a.verificationId, submittedAt: a.importedAt
        }, a.verificationId + '-goal-');
        a.control.status = 'applied';
        return a.control;
    }
}
