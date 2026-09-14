import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../contracts/plan.js';
import type { RuntimeBudget } from '../../contracts/runtime-budget.js';
import type { ExplorationScope as Scope, ExplorationPlan } from '../../contracts/exploration.js';
import type { ExplorationObservationPort, ExplorationRunObservation, ExplorationSessionContextPort, ExplorationSessionMaterial } from '../../contracts/exploration-session.js';
import type { RunSpec } from '../../contracts/runtime-preparation.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { explorationSourceDigest } from '../workspace-reader/exploration-source.js';
const scopeKey = (scope: Scope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
function ensure(value: unknown, message: string): asserts value {
  if (!value)
    throw Error(message);
}
/** Selects canonical scope/version and public execution materials; never judges trace evidence or prepares a Run. */
export class ExplorationSessionContextCompiler implements ExplorationSessionContextPort {
  constructor(private readonly deps: {
    ledger: StateLedger;
    runtime: ExplorationObservationPort;
    rootFor: (projectId: string, workspaceId: string) => string;
  }) { }
  async current(scope: Scope, manifest: ExplorationPlan) {
    ensure(scopeKey(scope) === scopeKey(manifest), '探索清单作用域不匹配');
    const g = await this.deps.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
    ensure(g.status === 'found', '探索目标不存在');
    const goal = g.snapshot as GoalSnapshot;
    ensure(goal.workspaceRef.workspaceId === scope.workspaceId && goal.activePlanRevision?.planId === manifest.planId, '探索计划或工作区已改变');
    const p = await this.deps.ledger.load(goal.activePlanRevision);
    ensure(p.status === 'found', '正式探索计划不存在');
    const w = await this.deps.ledger.load(goal.workspaceRef);
    ensure(w.status === 'found', '探索工作区不存在');
    return {
      manifest,
      plan: p.snapshot as PlanRevisionSnapshot,
      workspaceRevision: w.snapshot.revision,
      root: this.deps.rootFor(scope.projectId, scope.workspaceId)
    };
  }
  async assertSource(scope: Scope, expected: string) {
    ensure(await explorationSourceDigest(this.deps.rootFor(scope.projectId, scope.workspaceId)) === expected, '探索来源快照已改变，请新建目标重新探索');
  }
  compileRunSpec(material: ExplorationSessionMaterial, request: { runId: string; taskId: string; budget: RuntimeBudget }): RunSpec {
    const task = material.manifest.tasks.find(task => task.taskId === request.taskId);
    ensure(task, '节点不是此探索计划的工作任务');
    const instruction = '这是项目只读探索任务。平台会注入已接受任务、适用规则和已正式验收的直接前驱材料。先使用 list_files/search/symbols 定位，随后 read 核对事实与行号；不运行项目代码。当前节点由操作者配置，不是自动规划的证明。\n\n任务：' + task.title + '\n' + task.instruction + '\n\n来源快照 SHA-256：' + material.manifest.sourceDigest;
    return {
      projectId: material.manifest.projectId,
      workspaceId: material.manifest.workspaceId,
      goalId: material.manifest.goalId,
      runId: request.runId,
      taskId: request.taskId,
      root: material.root,
      instruction,
      budget: request.budget,
      mode: 'explore',
    };
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
      if (formal?.status === 'ended')
        records.push(record);
    }
    return records;
  }
  async replaySpec(scope: Scope, runId: string, taskId: string, budget: RuntimeBudget) {
    const existing = await this.run(scope, runId);
    if (!existing)
      return null;
    const recorded = this.record(scope, runId);
    ensure(
      recorded && recorded.spec.mode === 'explore' && recorded.spec.taskId === taskId && recorded.spec.root === this.deps.rootFor(scope.projectId, scope.workspaceId) && canonicalJson(recorded.spec.budget) === canonicalJson(budget),
      '已登记探索请求的范围、节点或预算已改变'
    );
    return { spec: structuredClone(recorded.spec), existing: existing.status };
  }
  async taskPhase(scope: Scope, taskId: string) {
    const reduction = await this.deps.ledger.load({ aggregateType: 'TaskReduction', projectId: scope.projectId, goalId: scope.goalId, taskId });
    return reduction.status === 'found' && 'phase' in reduction.snapshot ? reduction.snapshot.phase : null;
  }
}
