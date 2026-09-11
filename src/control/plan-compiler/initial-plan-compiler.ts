import type { ControlEngine } from '../../contracts/modules.js';
import type { QueryJobSnapshot } from '../../contracts/query-job.js';
import type { InitialPlanningRequest, InitialPlanningRequestResult, PlanningAcceptanceReport, PlanningAcceptanceTrigger, PlanningMaterialPort } from '../../contracts/planning.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import { normalizeInitialPlanProposal } from '../control-engine/policies/initial-plan-admission.js';
import { buildApplyPlanCommand } from '../../contracts/commands/plan.js';
import { validateRuntimeBudget } from '../../contracts/runtime-budget.js';

export type InitialPlanningControl = Pick<ControlEngine, 'submitQueryJob' | 'closeQueryJob' | 'applyPlan'>;
const sha = (value: unknown) => sha256Hex(canonicalJson(value as never)).slice(0, 32);

/** Internal initial-coordination workflow of PlanCompiler. All semantic facts
 * arrive through Context; mutations are requests to Control, never Ledger writes. */
export class InitialPlanCompiler {
  constructor(private readonly control: InitialPlanningControl, private readonly materials: PlanningMaterialPort, private readonly now: () => string) {}

  async request(request: InitialPlanningRequest): Promise<InitialPlanningRequestResult> {
    const { scope, input, referenceContext = '' } = request;
    const id = input?.['requestId'], instruction = input?.['instruction'];
    if (request.schemaVersion !== 1 || !scope || ![scope.projectId, scope.workspaceId, scope.goalId].every(value => typeof value === 'string' && value.length > 0) ||
      typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || typeof instruction !== 'string' || !instruction.trim() || instruction.length > 4096 || input['allowWrite'] !== true ||
      typeof referenceContext !== 'string' || Buffer.byteLength(referenceContext) > 131072)
      return { status: 'rejected', code: 'invalid_request', message: '需要有界需求、请求标识和明确写入授权' };
    let budget;
    try { budget = validateRuntimeBudget(input['budget']); }
    catch (error) { return { status: 'rejected', code: 'invalid_request', message: String(error) }; }
    const queryJobId = 'real-query-initial-' + id;
    const material = await this.materials.initialRequest(scope, queryJobId);
    if (material.status !== 'ready') return material;
    const submittedAt = material.prior?.job.submittedAt ?? this.now();
    const receipt = await this.control.submitQueryJob({
      schemaVersion: 1, commandType: 'SubmitQueryJob', commandId: queryJobId,
      identity: { projectId: scope.projectId, actor: { kind: 'human', id: 'local-gui' }, idempotencyKey: queryJobId },
      aggregateId: queryJobId, expectedRevision: 0, correlationId: queryJobId, submittedAt,
      payload: { runId: queryJobId, intent: {
        schemaVersion: 1, intentId: queryJobId, ...scope, question: instruction, focusTaskRefs: [],
        budget: { maxTokens: budget.contextWindowTokens, deadline: budget.timeoutMs === null ? null : new Date(Date.parse(submittedAt) + budget.timeoutMs).toISOString() },
        multiTurn: { maxRounds: 1 }, correlationId: queryJobId,
        execution: { kind: 'initial_coordination', runtimeBudget: budget,
          roleBinding: { schemaVersion: 1, bindingId: queryJobId, templateId: 'planner', templateRevision: '1', bindingVersion: 1, policyRevision: 'initial-read-only-v1' },
          implementationAuthorization: { requestId: id, instruction, writeScope: ['*'], ...(referenceContext ? { referenceContext } : {}) }
        }
      } }
    });
    if (receipt.status !== 'committed') return { status: 'rejected', code: receipt.code, message: '协调意图被拒绝：' + receipt.code };
    return { status: 'accepted', submission: { queryJobId, runId: 'real-' + id, status: 'planning', executor: 'coding-agent', receipt } };
  }

  async accept(trigger: PlanningAcceptanceTrigger): Promise<PlanningAcceptanceReport> {
    const report: Extract<PlanningAcceptanceReport, { status: 'processed' }> = { status: 'processed', accepted: [], needsDecision: [], issues: [] };
    const results = await this.materials.initialResults(trigger.resultRef);
    if (trigger.resultRef && results.length === 0) return { status: 'rejected', code: 'not_found', message: 'registered current planning result not found' };
    for (const { snapshot, answer, resultRef } of results) {
      const job = snapshot.job;
      const close = async (message: string) => {
        report.issues.push({ resultRef, message });
        const receipt = await this.recordIssue(snapshot, message);
        if (receipt.status !== 'committed') report.issues.push({ resultRef, message: '规划问题留痕被拒绝：' + receipt.code });
      };
      let proposed;
      try { proposed = normalizeInitialPlanProposal(job.intent, answer); }
      catch (error) { await close('规划提案无效：' + String(error)); continue; }
      if (proposed.status === 'needs_decision') { report.needsDecision.push(resultRef); continue; }
      const ref = { aggregateType: 'PlanRevision' as const, projectId: job.projectId, planId: proposed.plan.planId };
      const accepted = await this.materials.initialPlan(ref);
      // An already accepted exact result survives workspace edits and reopen.
      if (accepted) {
        if (canonicalJson(accepted.origin ?? null) !== canonicalJson(proposed.plan.origin ?? null)) await close('既受理计划与协调来源不一致');
        else report.accepted.push(accepted.ref);
        continue;
      }
      if (!await this.materials.initialCurrentness(snapshot)) { await close('协调来源已改变，需要重新形成提案'); continue; }
      const id = 'accept-' + sha(proposed.plan.origin);
      const receipt = await this.control.applyPlan(buildApplyPlanCommand(proposed.plan, {
        projectId: job.projectId, goalId: proposed.plan.goalId, actor: { kind: 'human', id: 'user-1' }, commandId: id, correlationId: job.intent.correlationId, idempotencyKey: id,
        expectedRevision: proposed.plan.origin!.goalRevision, submittedAt: job.submittedAt
      }));
      if (receipt.status !== 'committed') { await close('Control 拒绝规划：' + canonicalJson(receipt)); continue; }
      report.accepted.push(ref);
    }
    return report;
  }

  private recordIssue(snapshot: QueryJobSnapshot, message: string) {
    const job = snapshot.job, id = 'planning-close-' + sha(snapshot.ref);
    return this.control.closeQueryJob({
      schemaVersion: 1, commandType: 'CloseQueryJob', commandId: id,
      identity: { projectId: job.projectId, actor: { kind: 'system', id: 'initial-planning' }, idempotencyKey: id },
      aggregateId: job.queryJobId, expectedRevision: snapshot.revision, correlationId: job.intent.correlationId, submittedAt: this.now(),
      payload: { jobRef: snapshot.ref, runRef: job.runRef!, reason: { code: 'gap', message } }
    });
  }
}
