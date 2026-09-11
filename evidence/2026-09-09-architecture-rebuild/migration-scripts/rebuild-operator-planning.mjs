import { readFileSync, writeFileSync } from 'node:fs';
const old = readFileSync('src/app/explorations.ts', 'utf8');
let method = old.slice(old.indexOf('  async install('), old.indexOf('  async prepareRun('));
if (!method.includes('const manifest: ExplorationPlan')) throw Error('Exploration install block missing');
method = method.replace('async install(', 'async exploration(');
method = method.replace("const g = await this.h.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId }); ensure(g.status === 'found', '目标不存在'); const goal = g.snapshot as GoalSnapshot;", 'const goal = await this.deps.context.goal(scope);');
method = method.replaceAll('explorationSourceDigest(this.rootFor(scope.projectId, scope.workspaceId))', 'this.deps.context.sourceDigest(scope)').replaceAll('this.h.applyPlan', 'this.deps.control.applyPlan').replaceAll('new Date().toISOString()', 'this.deps.now()');
const service = readFileSync('src/app/service.ts', 'utf8');
const commandStart = service.indexOf('check(await h.applyPlan(buildApplyPlanCommand({ schemaVersion: 1, planId: `real-plan-${goalId}`');
const commandEnd = service.indexOf('\n      } else if', commandStart);
if (commandStart < 0 || commandEnd < 0) throw Error('Explicit task plan missing');
const command = service.slice(commandStart, commandEnd).replace('check(await h.applyPlan(', 'accepted(await this.deps.control.applyPlan(').replace('...deps(scope.projectId, `real-plan-${goalId}`)', '...this.identity(scope.projectId, `real-plan-${goalId}`)').replace('view.goal.aggregateRevision', 'goal.revision');
const code = `import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ControlEngine } from '../contracts/modules.js';
import type { OperatorPlanningPort, OperatorPlanningContextPort } from '../contracts/operator-planning.js';
import type { ExplorationScope as Scope, ExplorationPlan } from '../contracts/exploration.js';
import { canonicalJson } from '../contracts/fingerprint.js';
import { buildApplyPlanCommand } from '../contracts/fixtures/plan-fixtures.js';
import { writeAtomicFile } from '../storage/atomic-file.js';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const scopeKey = (scope: Scope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
function ensure(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function text(value: unknown, label: string, cap = 4096): string { ensure(typeof value === 'string' && value.trim() && value.length <= cap, '无效字段：' + label); return value.trim(); }
function id(value: unknown, label: string): string { const s = text(value, label, 64); ensure(/^[a-zA-Z0-9-]+$/.test(s), '无效标识：' + label); return s; }
function object(value: unknown): Record<string, unknown> { ensure(value && typeof value === 'object' && !Array.isArray(value), '需要探索任务对象'); return value as Record<string, unknown>; }
function accepted<T extends { status: string }>(value: T, label = '计划被拒绝'): T { ensure(value.status !== 'rejected', label + '：' + JSON.stringify(value)); return value; }

export class OperatorPlanCompiler implements OperatorPlanningPort {
  private plans: ExplorationPlan[] = [];
  constructor(private readonly deps: { directory: string; context: OperatorPlanningContextPort; control: Pick<ControlEngine, 'applyPlan'>; now: () => string }) {}
  async init() {
    await mkdir(this.deps.directory, { recursive: true, mode: 0o700 });
    for (const name of (await readdir(this.deps.directory)).sort()) {
      if (/^plan-[a-f0-9]{64}\\.json$/.test(name)) this.plans.push(JSON.parse(await readFile(join(this.deps.directory, name), 'utf8')) as ExplorationPlan);
    }
    for (const plan of this.plans) if (plan.status === 'pending') {
      accepted(await this.deps.control.applyPlan(plan.command), '探索计划恢复失败');
      plan.status = 'accepted'; await this.save('plan', digest(scopeKey(plan)), plan);
    }
  }
  private save(kind: string, key: string, body: unknown) { return writeAtomicFile(join(this.deps.directory, kind + '-' + key + '.json'), JSON.stringify(body)); }
  plan(scope: Scope) { const plan = this.plans.find(p => scopeKey(p) === scopeKey(scope)); ensure(plan && plan.status === 'accepted', '该目标没有已接受的探索计划'); return structuredClone(plan); }
  acceptedPlans() { return structuredClone(this.plans.filter(plan => plan.status === 'accepted')); }
${method}
  async ensureTaskPlan(scope: Scope, instruction: string) {
    const goal = await this.deps.context.goal(scope), goalId = scope.goalId, taskId = 'coding-task';
    if (!goal.activePlanRevision) {
      ${command}
    } else if (goal.activePlanRevision.planId !== 'real-plan-' + goalId) throw Error('请新建目标后执行真实任务，不要复用样例计划');
  }
  private identity(projectId: string, idempotencyKey: string) {
    return { projectId, idempotencyKey, commandId: randomUUID(), correlationId: randomUUID(), submittedAt: this.deps.now() };
  }
}
`;
writeFileSync('src/control/operator-plan-compiler.ts', code);
let app = old.replace('  private plans: ExplorationPlan[] = [];\r\n', '').replace('  private plans: ExplorationPlan[] = [];\n', '');
app = app.replace("import { buildApplyPlanCommand } from '../contracts/fixtures/plan-fixtures.js';", "import type { OperatorPlanningPort } from '../contracts/operator-planning.js';");
app = app.replace('private readonly recordedVerification: RecordedVerificationPort) {}', 'private readonly recordedVerification: RecordedVerificationPort, private readonly planning: OperatorPlanningPort) {}');
app = app.replace('    await mkdir(this.directory,', '    await this.planning.init();\n    await mkdir(this.directory,');
app = app.replace("      if (name.startsWith('plan-')) this.plans.push(body as ExplorationPlan);", '');
app = app.replace(/    for \(const plan of this.plans\) if \(plan.status === 'pending'\) \{[^\r\n]+\}\r?\n/, '');
app = app.replace("this.plans.filter(p => p.status === 'accepted')", 'this.planning.acceptedPlans()');
const planStart = app.indexOf('  private planFor(scope: Scope)');
const planEnd = app.indexOf('\n  private async context', planStart);
app = app.slice(0, planStart) + '  private planFor(scope: Scope) { return this.planning.plan(scope); }' + app.slice(planEnd);
const start = app.indexOf('  async install('), end = app.indexOf('  async prepareRun(', start);
app = app.slice(0, start) + '  install(scope: Scope, input: Record<string, unknown>) { return this.planning.exploration(scope, input); }\n' + method.slice(method.indexOf('  private publicPlan')) + app.slice(end);
app = app.replace("this.plans.find(p => scopeKey(p) === scopeKey(scope) && p.status === 'accepted')", 'this.planning.acceptedPlans().find(p => scopeKey(p) === scopeKey(scope))');
writeFileSync('src/app/explorations.ts', app);
const begin = service.indexOf('      if (!view.goal.activePlanRevision) {', commandStart - 100);
const finish = service.indexOf('      const existing = await h.ledger.load', commandEnd);
if (begin < 0 || finish < 0) throw Error('Single task plan body missing');
writeFileSync('src/app/service.ts', service.slice(0, begin) + '      await operatorPlans!.ensureTaskPlan({ ...scope, goalId }, instruction);\n' + service.slice(finish));
