import { createHash } from 'node:crypto';
import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { ControlEngine } from '../../contracts/modules.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { RuntimePreparationPort } from '../../contracts/runtime-preparation.js';
import type { PlanningMaterialPort } from '../../contracts/planning.js';
import type { QueryJobSnapshot } from '../../contracts/query-job.js';
import type { AcceptedInitialPlan } from '../../contracts/initial-planning.js';
import { revisionAssignments } from '../../contracts/plan.js';
import type { PlanRevisionSnapshot, PlanTaskAssignment, RuntimeTask } from '../../contracts/plan.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { buildDispatchClaimCommand } from '../../contracts/commands/dispatch.js';
import { issueMatrixRoleBinding, LedgerRoleSpecRead } from './role-spec-read.js';
type Scope = {
    projectId: string;
    workspaceId: string;
    goalId: string;
};
const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value as never)).digest('hex').slice(0, 32);

/** Claims active required work from the Goal's current accepted PlanRevision.
 * Control owns dependency eligibility; the shared ordinary consumer owns execution
 * capacity, and workspace leases remain the durable concurrency authority.
 *
 * A scan admits every eligible assignment. Gate tasks and superseded/deferred work
 * are excluded. Role permissions are resolved from the active matrix and bounded
 * by the original human implementation authorization.
 *
 * Existing deterministic Run IDs are preserved for replay compatibility. Started
 * Runs require reconciliation; only an unstarted outbox may be prepared again.
 */
export class PlannedTaskDispatch {
    constructor(private readonly h: Pick<ControlEngine, 'claimTask' | 'dispatchReadiness' | 'closeQueryJob'> & {
        ledger: Pick<StateLedger, 'load'>;
    }, private readonly runtime: RuntimePreparationPort, private readonly rootFor: (projectId: string, workspaceId: string) => string, private readonly launch: (scope: Scope, runId: string) => void,
    private readonly materials: Pick<PlanningMaterialPort, 'acceptedInitialPlans'>, private readonly now: () => string) { }
    async drivePending() {
        const issues: { queryJobId: string; message: string }[] = [];
        for (const accepted of await this.materials.acceptedInitialPlans()) {
            const issue = await this.drive(accepted);
            if (!issue) continue;
            const receipt = await this.recordIssue(accepted.snapshot, issue);
            issues.push({ queryJobId: accepted.snapshot.job.queryJobId, message: issue });
            if (receipt.status !== 'committed') throw Error('派发问题登记被拒绝：' + canonicalJson(receipt));
        }
        return { issues };
    }
    /** Goal 当前生效的 PlanRevision（canonical 只读；缺失即 null，不猜、不回退旧版本）。 */
    private async activePlan(scope: Scope): Promise<PlanRevisionSnapshot | null> {
        const loaded = await this.h.ledger.load({ aggregateType: 'Goal', projectId: scope.projectId, goalId: scope.goalId });
        if (loaded.status !== 'found' || loaded.snapshot.ref.aggregateType !== 'Goal')
            return null;
        const goal = loaded.snapshot as GoalSnapshot;
        if (goal.activePlanRevision === null)
            return null;
        const plan = await this.h.ledger.load(goal.activePlanRevision);
        return plan.status === 'found' && plan.snapshot.ref.aggregateType === 'PlanRevision'
            ? plan.snapshot as PlanRevisionSnapshot
            : null;
    }
    private recordIssue(snapshot: QueryJobSnapshot, message: string) {
        const job = snapshot.job, id = 'planning-close-' + sha(snapshot.ref);
        return this.h.closeQueryJob({
            schemaVersion: 1, commandType: 'CloseQueryJob', commandId: id,
            identity: { projectId: job.projectId, actor: { kind: 'system', id: 'initial-planning' }, idempotencyKey: id },
            aggregateId: job.queryJobId, expectedRevision: snapshot.revision, correlationId: job.intent.correlationId, submittedAt: this.now(),
            payload: { jobRef: snapshot.ref, runRef: job.runRef!, reason: { code: 'gap', message } },
        });
    }
    async drive({ snapshot }: AcceptedInitialPlan): Promise<string | null> {
        const job = snapshot.job, scope = {
            projectId: job.projectId, workspaceId: job.workspaceId, goalId: job.goalId!
        };
        const authorization = job.intent.execution!.implementationAuthorization!;
        // 当前生效 revision：以 Goal 的 canonical activePlanRevision 为准。读不到就没有可派发的
        // 任务（不退回"初始 origin 的那份快照"，否则会拿已经失效的版本当派发依据）。
        const active = await this.activePlan(scope);
        if (active === null)
            return null;
        const taskById = new Map(active.tasks.map(task => [task.taskId, task]));
        const candidates = revisionAssignments(active)
            .map((assignment, position) => ({ assignment, position, task: taskById.get(assignment.taskId) }))
            .filter((entry): entry is { assignment: PlanTaskAssignment; position: number; task: RuntimeTask } => entry.task !== undefined &&
            entry.task.requirementLevel === 'required' && entry.task.taskKind === 'work' && entry.task.disposition === 'active');
        for (const { assignment, position } of candidates) {
            const runId = 'real-' + authorization.requestId + (position === 0 ? '' : '-' + sha(assignment.taskId).slice(0, 12));
            const loaded = await this.h.ledger.load({
                aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId
            });
            const prior = loaded.status === 'found' ? loaded.snapshot as RunSnapshot : null;
            // Only an outbox that has never started can be resumed automatically.
            // A persisted runtime side effect or started envelope requires recovery.
            if (prior && (prior.status !== 'starting' || prior.envelope !== null))
                continue;
            // Readiness determines task dependencies; the shared dispatch consumer and
            // durable workspace leases determine execution capacity and write conflicts.
            // A local active-run list must not serialize independent planned tasks.
            const readiness = await this.h.dispatchReadiness({
                projectId: scope.projectId, goalId: scope.goalId, taskId: assignment.taskId
            });
            if (!prior && (readiness.status !== 'ready' || !readiness.eligibility.eligible))
                continue;
            const budget = job.intent.execution!.runtimeBudget;
            const spec = {
                ...scope, runId, taskId: assignment.taskId, root: this.rootFor(scope.projectId, scope.workspaceId), instruction: assignment.instruction + (authorization.referenceContext ?? ''), budget
            };
            try {
                await this.runtime.preflight(spec);
            }
            catch (error) {
                return '执行预检失败：' + String(error);
            }
            if (prior) {
                await this.runtime.prepare(spec);
                this.launch(scope, runId);
                continue;
            }
            // 角色绑定由当前生效矩阵的 pin 签发；没有矩阵时逐字使用既有绑定。
            const issued = await issueMatrixRoleBinding({ ledger: this.h.ledger }, {
                projectId: scope.projectId, roleId: assignment.role,
                fallback: {
                    schemaVersion: 1, bindingId: runId, templateId: assignment.role, templateRevision: '1', bindingVersion: 1, policyRevision: 'human-implementation-v1'
                },
            });
            let declaredPermissions: { tools: string[]; writeScope: string[] } = { tools: ['read', 'write', 'shell'], writeScope: authorization.writeScope };
            if (issued.source === 'matrix') {
                const pin = issued.matrixPin!;
                const loadedSpec = await this.h.ledger.load(pin.ref);
                if (loadedSpec.status !== 'found' || loadedSpec.snapshot.ref.aggregateType !== 'RoleSpecRevision') return '角色模板不存在';
                const content = (loadedSpec.snapshot as import('../../contracts/role-spec.js').RoleSpecRevisionSnapshot).content;
                declaredPermissions = { tools: declaredPermissions.tools.filter(tool => content.permissions.tools.includes(tool)),
                    writeScope: content.permissions.writeScope === 'none' ? [] : authorization.writeScope };
                const resolved = await new LedgerRoleSpecRead({ ledger: this.h.ledger }).resolve({ projectId: scope.projectId, roleBinding: issued.roleBinding, declaredPermissions });
                if (resolved.status !== 'resolved') return '角色模板当前不可用于派发：' + canonicalJson(resolved);
            } else if (!['executor', 'integrator'].includes(assignment.role)) {
                return '自定义 Agent 模板必须在当前角色矩阵中登记并激活';
            }
            const claim = await this.h.claimTask(buildDispatchClaimCommand({
                projectId: scope.projectId, goalId: scope.goalId, taskId: assignment.taskId, runId, attemptId: 'attempt-' + runId,
                commandId: 'claim-' + runId, correlationId: job.intent.correlationId, idempotencyKey: 'claim-' + runId, actor: {
                    kind: 'system', id: 'initial-planning'
                }, submittedAt: job.submittedAt, roleBinding: issued.roleBinding,
                declaredPermissions, budget: {
                    tokenBudget: budget.contextWindowTokens, deadline: null
                }
            }));
            if (claim.status === 'committed') {
                await this.runtime.prepare(spec);
                this.launch(scope, runId);
            }
            else
                return 'Control 拒绝派发：' + canonicalJson(claim);
        }
        return null;
    }
}
