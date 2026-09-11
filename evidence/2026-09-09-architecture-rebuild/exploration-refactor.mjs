// One-time AR-05 migration, retaining existing report/review JSON identities.
import { readFileSync, writeFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8').replaceAll('\r\n', '\n');
const write = (p, s) => writeFileSync(p, s);
const between = (s, start, end) => {
  const a = s.indexOf(start), b = s.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw Error('Missing migration marker: ' + start);
  return s.slice(a, b);
};
const source = read('src/app/explorations.ts');
const utilities = between(source, 'const digest =', '/** Operator-authored');
const artifact = between(source, '  private async artifact(', '  private async reportArtifact(');
const reportArtifact = between(source, '  private async reportArtifact(', '  private async capture(').replace('private async reportArtifact', 'async reportArtifact');
let capture = between(source, '  private async capture(', '  async view(')
  .replace('private async capture(scope: Scope, record: RuntimeRecord)', 'async capture(scope: Scope, manifest: ExplorationPlan, record: ExplorationRunObservation)')
  .replace("    const existing = this.reports.find(r => scopeKey(r) === scopeKey(scope) && r.runId === record.spec.runId); if (existing) return existing;\n", '')
  .replace("const ctx = await this.context(scope), loaded = await this.h.ledger.load({ aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: record.spec.runId }); ensure(loaded.status === 'found', '探索运行没有正式记录'); const run = loaded.snapshot as RunSnapshot;", "const ctx = await this.deps.context.current(scope, manifest), run = await this.deps.context.run(scope, record.spec.runId); ensure(run, '探索运行没有正式记录');")
  .replace("const captured: ExplorationReport = { ...draft, artifactRef: await this.reportArtifact(draft) }; await this.save('report', digest(scopeKey(scope) + captured.runId), captured); this.reports.push(captured); return captured;", 'return { ...draft, artifactRef: await this.reportArtifact(draft) };');
let satisfiedReports = between(source, '  private async requireSatisfiedReports(', '  private async applyReview(')
  .replace('private async requireSatisfiedReports(scope: Scope, plan: ExplorationPlan)', 'async satisfiedReports(scope: Scope, plan: ExplorationPlan, availableReports: readonly ExplorationReport[], reviews: readonly Review[])')
  .replace("const reduction = await this.h.ledger.load({ aggregateType: 'TaskReduction', projectId: scope.projectId, goalId: scope.goalId, taskId: task.taskId }); ensure(reduction.status === 'found' && 'phase' in reduction.snapshot && reduction.snapshot.phase === 'satisfied',", "const phase = await this.deps.context.taskPhase(scope, task.taskId); ensure(phase === 'satisfied',")
  .replaceAll('this.reviews', 'reviews').replaceAll('this.reports', 'availableReports');
write('src/verification/exploration-report-verifier.ts', `import { createHash } from 'node:crypto';
import type { ArtifactPort, ArtifactRef } from '../contracts/artifact.js';
import type { ExplorationScope as Scope, ExplorationPlan, ExplorationReport, ExplorationReview as Review } from '../contracts/exploration.js';
import type { ExplorationSessionContextPort, ExplorationReportPort, ExplorationRunObservation } from '../contracts/exploration-session.js';
import { canonicalJson } from '../contracts/fingerprint.js';
${utilities}
/** Qualifies actual readonly observations and persists their source-bound report. No Task completion authority. */
export class ExplorationReportVerifier implements ExplorationReportPort {
  constructor(private readonly deps: { context: ExplorationSessionContextPort; vault: Pick<ArtifactPort, 'put'> }) {}
${artifact.replaceAll('this.h.vault', 'this.deps.vault')}${reportArtifact}${capture}${satisfiedReports}}
`);

write('src/context/exploration-session-context.ts', `import type { StateLedger, GoalSnapshot } from '../contracts/ledger.js';
import type { RunSnapshot } from '../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../contracts/plan.js';
import type { RuntimeBudget } from '../contracts/runtime-budget.js';
import type { ExplorationScope as Scope, ExplorationPlan } from '../contracts/exploration.js';
import type { ExplorationObservationPort, ExplorationRunObservation, ExplorationSessionContextPort } from '../contracts/exploration-session.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import { explorationSourceDigest } from '../data/exploration-source.js';
const scopeKey = (scope: Scope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
function ensure(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
/** Selects canonical scope/version and public execution materials; never judges trace evidence or prepares a Run. */
export class ExplorationSessionContextCompiler implements ExplorationSessionContextPort {
  constructor(private readonly deps: { ledger: StateLedger; runtime: ExplorationObservationPort; rootFor: (projectId: string, workspaceId: string) => string }) {}
  async current(scope: Scope, manifest: ExplorationPlan) {
    const g = await this.deps.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId }); ensure(g.status === 'found', '探索目标不存在');
    const goal = g.snapshot as GoalSnapshot; ensure(goal.workspaceRef.workspaceId === scope.workspaceId && goal.activePlanRevision?.planId === manifest.planId, '探索计划或工作区已改变');
    const p = await this.deps.ledger.load(goal.activePlanRevision); ensure(p.status === 'found', '正式探索计划不存在');
    const w = await this.deps.ledger.load(goal.workspaceRef); ensure(w.status === 'found', '探索工作区不存在');
    return { manifest, plan: p.snapshot as PlanRevisionSnapshot, workspaceRevision: w.snapshot.revision, root: this.deps.rootFor(scope.projectId, scope.workspaceId) };
  }
  async assertSource(scope: Scope, expected: string) {
    ensure(await explorationSourceDigest(this.deps.rootFor(scope.projectId, scope.workspaceId)) === expected, '探索来源快照已改变，请新建目标重新探索');
  }
  async run(scope: Scope, runId: string) {
    const loaded = await this.deps.ledger.load({ aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId });
    return loaded.status === 'found' ? loaded.snapshot as RunSnapshot : null;
  }
  record(scope: Scope, runId: string, taskId?: string) {
    return this.deps.runtime.all().find(r => scopeKey(r.spec) === scopeKey(scope) && r.spec.runId === runId && (taskId === undefined || r.spec.taskId === taskId));
  }
  async completedRuns(scope: Scope) {
    const records: ExplorationRunObservation[] = [];
    for (const record of this.deps.runtime.all().filter(r => scopeKey(r.spec) === scopeKey(scope) && r.spec.mode === 'explore' && r.status === 'completed')) {
      // Runtime completion can precede the terminal Control commit by one poll.
      const formal = await this.run(scope, record.spec.runId);
      if (formal?.status === 'ended') records.push(record);
    }
    return records;
  }
  async replaySpec(scope: Scope, runId: string, taskId: string, budget: RuntimeBudget) {
    const existing = await this.run(scope, runId);
    if (!existing) return null;
    const recorded = this.record(scope, runId);
    ensure(recorded && recorded.spec.mode === 'explore' && recorded.spec.taskId === taskId && recorded.spec.root === this.deps.rootFor(scope.projectId, scope.workspaceId) && canonicalJson(recorded.spec.budget) === canonicalJson(budget), '已登记探索请求的范围、节点或预算已改变');
    return { spec: structuredClone(recorded.spec), existing: existing.status };
  }
  async taskPhase(scope: Scope, taskId: string) {
    const reduction = await this.deps.ledger.load({ aggregateType: 'TaskReduction', projectId: scope.projectId, goalId: scope.goalId, taskId });
    return reduction.status === 'found' && 'phase' in reduction.snapshot ? reduction.snapshot.phase : null;
  }
}
`);

const startup = between(source, '    // Reconcile only obsolete RUNNING', '\n\n  }')
  .replace('this.planning.acceptedPlans()', 'plans').replaceAll('this.h.ledger', 'this.deps.ledger')
  .replace('const ctx = await this.context(scope);', `const g = await this.deps.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId }); ensure(g.status === 'found', '探索目标不存在');
      const goal = g.snapshot as GoalSnapshot; ensure(goal.workspaceRef.workspaceId === scope.workspaceId && goal.activePlanRevision?.planId === scope.planId, '探索计划或工作区已改变');
      const p = await this.deps.ledger.load(goal.activePlanRevision); ensure(p.status === 'found', '正式探索计划不存在');
      const w = await this.deps.ledger.load(goal.workspaceRef); ensure(w.status === 'found', '探索工作区不存在');
      const plan = p.snapshot as PlanRevisionSnapshot;`)
  .replace('goal: ctx.goal, plan: ctx.plan', 'goal, plan').replaceAll('this.h.reduceGoal', 'this.deps.control.reduceGoal')
  .replace('submittedAt: new Date().toISOString(), projectId:', "submittedAt: new Date().toISOString(), actor: { kind: 'system', id: 'control-engine' }, projectId:");
write('src/control/exploration-startup-reconciliation.ts', `import { createHash, randomUUID } from 'node:crypto';
import type { StateLedger, GoalSnapshot } from '../contracts/ledger.js';
import type { ControlEngine } from '../contracts/modules.js';
import type { ExplorationPlan, ExplorationScope as Scope } from '../contracts/exploration.js';
import type { PlanRevisionSnapshot } from '../contracts/plan.js';
import type { ExplorationStartupReconciliationPort } from '../contracts/exploration-session.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import { buildReduceGoalCommand } from '../contracts/commands/goal-phase.js';
import { buildGoalReductionInput } from './goal-reducer.js';
import { reduceGoalPhase } from './policies/goal-phase.js';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const scopeKey = (scope: Scope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
function ensure(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function accepted<T extends { status: string }>(value: T, label: string): T { ensure(value.status !== 'rejected', label + '：' + JSON.stringify(value)); return value; }
/** Repairs only obsolete RUNNING projections by submitting normal canonical reduction commands. */
export class ExplorationStartupReconciler implements ExplorationStartupReconciliationPort {
  constructor(private readonly deps: { ledger: StateLedger; control: Pick<ControlEngine, 'reduceGoal'> }) {}
  async reconcile(plans: readonly ExplorationPlan[]) {
${startup}
  }
}
`);

let session = source.slice(source.indexOf('/** Operator-authored'))
  .replace('export class Explorations {', 'export class ExplorationSession implements ExplorationSessionPort {')
  .replace(between(source, '  constructor(', '  async init()'), '  constructor(private readonly deps: ExplorationSessionDeps) {}\n')
  .replace(between(source, '    // Reconcile only obsolete RUNNING', '\n\n  }'), '    await this.deps.startup.reconcile(this.deps.planning.acceptedPlans());')
  .replace(between(source, '  private async context(scope: Scope)', '  install(scope: Scope'), '  private context(scope: Scope) { return this.deps.context.current(scope, this.planFor(scope)); }\n')
  .replace(between(source, "    const existing = await this.h.ledger.load({ aggregateType: 'Run'", '    const readiness ='), '    const replay = await this.deps.context.replaySpec(scope, runId, taskId, budget);\n    if (replay) return { ...replay, requestId };\n')
  .replace('    await this.runtime.prepare(spec);\n', '')
  .replace(reportArtifact.replace('async reportArtifact', 'private async reportArtifact'), '')
  .replace(between(source, '  private async capture(', '  async view('), `  private async capture(scope: Scope, record: ExplorationRunObservation) {
    const existing = this.reports.find(r => scopeKey(r) === scopeKey(scope) && r.runId === record.spec.runId); if (existing) return existing;
    const captured = await this.deps.verification.capture(scope, this.planFor(scope), record);
    await this.save('report', digest(scopeKey(scope) + captured.runId), captured);
    this.reports.push(captured); return captured;
  }
`)
  .replace(between(source, '    for (const record of this.runtime.all().filter(', '      try { await this.capture'), '    for (const record of await this.deps.context.completedRuns(scope)) {\n')
  .replace(between(source, '  private async requireSatisfiedReports(', '  private async applyReview('), '')
  .replaceAll('this.requireSatisfiedReports(scope, ctx.manifest)', 'this.deps.verification.satisfiedReports(scope, ctx.manifest, this.reports, this.reviews)')
  .replaceAll('this.requireSatisfiedReports(review, ctx.manifest)', 'this.deps.verification.satisfiedReports(review, ctx.manifest, this.reports, this.reviews)')
  .replace("this.runtime.all().find(r => scopeKey(r.spec) === scopeKey(scope) && r.spec.runId === runId && r.spec.taskId === taskId)", 'this.deps.context.record(scope, runId!, taskId)')
  .replaceAll('this.reportArtifact(report)', 'this.deps.verification.reportArtifact(report)')
  .replaceAll('this.assertSource(', 'this.deps.context.assertSource(')
  .replaceAll('this.rootFor(scope.projectId, scope.workspaceId)', 'ctx.root')
  .replaceAll('this.planning', 'this.deps.planning').replaceAll('this.directory', 'this.deps.directory')
  .replaceAll('this.contextDrive', 'this.deps.contextDrive').replaceAll('this.recordedVerification', 'this.deps.recordedVerification')
  .replaceAll('this.h.dispatchReadiness', 'this.deps.control.dispatchReadiness').replaceAll('this.h.vault', 'this.deps.vault');
write('src/interaction/exploration-session.ts', `import { writeAtomicFile } from '../storage/atomic-file.js';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunSpec } from '../contracts/runtime-preparation.js';
import type { RuntimeBudget } from '../contracts/runtime-budget.js';
import type { RuntimeContextMaterials } from '../contracts/runtime-context-materials.js';
import type { TaskEnvelopeV1 } from '../contracts/task-envelope.js';
import type { ArtifactRef } from '../contracts/artifact.js';
import type { ExplorationSessionDeps, ExplorationSessionPort, ExplorationRunObservation } from '../contracts/exploration-session.js';
import type { ExplorationScope as Scope, ExplorationPlan, ExplorationReport, ExplorationReview as Review } from '../contracts/exploration.js';
import { canonicalJson } from '../contracts/fingerprint.js';
${utilities}
${session}`);

write('src/app/explorations.ts', `/** Temporary route-only compatibility until the service composition is migrated. */
export { ExplorationSession as Explorations } from '../interaction/exploration-session.js';
export type { ExplorationTask, ExplorationReport } from '../contracts/exploration.js';
`);
