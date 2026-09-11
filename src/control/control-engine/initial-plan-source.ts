import type { StateLedger, GoalSnapshot } from '../../contracts/ledger.js';
import type { ApplyPlanRevisionCommand } from '../../contracts/plan.js';
import type { QueryJobAnswerSnapshot, QueryJobSnapshot, QueryRunSnapshot } from '../../contracts/query-job.js';
import { normalizeInitialPlanProposal } from './policies/initial-plan-admission.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

/** Control's canonical source guard: a caller cannot relabel a hand-written
 * plan as a model proposal. It shares Control's deterministic admission policy. */
export async function validateInitialPlanSource(ledger: StateLedger, command: ApplyPlanRevisionCommand, goal: GoalSnapshot): Promise<boolean> {
  const origin = command.payload.plan.origin;
  if (!origin) return true;
  try {
    if (origin.kind !== 'model_coordination' || origin.answerRef.aggregateType !== 'QueryJobAnswer' || origin.answerRef.projectId !== command.identity.projectId || origin.answerRef.workspaceId !== goal.workspaceRef.workspaceId || origin.goalRevision !== command.expectedRevision) return false;
    const source = await ledger.load(origin.answerRef);
    if (source.status !== 'found') return false;
    const answer = (source.snapshot as QueryJobAnswerSnapshot).answer;
    const job = await ledger.load(answer.queryJobRef), run = await ledger.load(answer.runRef);
    if (job.status !== 'found' || run.status !== 'found' || (run.snapshot as QueryRunSnapshot).run.status !== 'answered') return false;
    const intent = (job.snapshot as QueryJobSnapshot).job.intent;
    if (intent.goalId !== goal.ref.goalId || intent.execution?.kind !== 'initial_coordination') return false;
    const compiled = normalizeInitialPlanProposal(intent, answer);
    if (compiled.status !== 'plan' || canonicalJson(compiled.plan) !== canonicalJson(command.payload.plan)) return false;
    // Replaying an already accepted exact plan preserves the original receipt.
    const accepted = await ledger.load({ aggregateType: 'PlanRevision', projectId: command.identity.projectId, planId: compiled.plan.planId });
    if (accepted.status === 'found') return canonicalJson((accepted.snapshot as import('../../contracts/plan.js').PlanRevisionSnapshot).origin ?? null) === canonicalJson(origin);
    const workspace = await ledger.load(goal.workspaceRef);
    return goal.activePlanRevision === null && goal.revision === origin.goalRevision && workspace.status === 'found' && workspace.snapshot.revision === origin.workspaceRevision;
  } catch { return false; }
}
