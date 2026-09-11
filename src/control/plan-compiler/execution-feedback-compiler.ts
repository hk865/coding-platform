import type { ControlEngine } from '../../contracts/modules.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { ExecutionFeedbackContext } from '../../data/context-compiler/execution-feedback-context.js';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';

/** Coordination work uses the existing durable QueryJob outbox. The semantic
 * response remains a proposal/material; it never directly advances a Task. */
export class ExecutionFeedbackCompiler {
  constructor(private readonly deps: { control: Pick<ControlEngine,'submitQueryJob'>;
    materials: Pick<ExecutionFeedbackContext,'prepare'|'jobs'>; now:()=>string }) {}
  async request(ref:RunRef) {
    const id = 'feedback-' + sha256Hex(canonicalJson(ref)).slice(0,32);
    const prior = (await this.deps.materials.jobs()).find(j => j.job.queryJobId === id && j.job.projectId === ref.projectId);
    if (prior) return prior.ref;
    const material = await this.deps.materials.prepare(ref);
    if (!material) return null;
    const {scope,feedback,source,budget} = material;
    const receipt = await this.deps.control.submitQueryJob({schemaVersion:1,commandType:'SubmitQueryJob',commandId:id,
      identity:{projectId:scope.projectId,actor:{kind:'system',id:'execution-coordination'},idempotencyKey:id},
      aggregateId:id,expectedRevision:0,correlationId:id,submittedAt:this.deps.now(),payload:{runId:id,intent:{
        schemaVersion:1,intentId:id,...scope,question:feedback.question,
        focusTaskRefs:[{aggregateType:'Task',projectId:scope.projectId,goalId:scope.goalId,taskId:source.taskId}],
        budget:{maxTokens:budget.contextWindowTokens,deadline:null},multiTurn:{maxRounds:1},correlationId:id,
        execution:{kind:'execution_coordination',feedback:source,runtimeBudget:budget,
          roleBinding:{schemaVersion:1,bindingId:id,templateId:'planner',templateRevision:'1',bindingVersion:1,policyRevision:'execution-feedback-read-only-v1'}}}}});
    if(receipt.status!=='committed') throw Error('Feedback coordination rejected: '+receipt.code);
    return receipt.queryJobRef;
  }
}
