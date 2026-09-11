import type { WorkContextBindingV1 } from '../../contracts/context-continuity.js';
import type { ReadModelIndex } from '../../contracts/goal-view.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

/** Only projected formal completion qualifies; Run termination and notes do not. */
export async function completedWorkCursor(binding: WorkContextBindingV1, index: Pick<ReadModelIndex, 'goalStatus'> & {
  taskVerification(query: import('../../contracts/verification-view.js').TaskVerificationViewQuery): Promise<import('../../contracts/verification-view.js').TaskVerificationViewResult>;
}): Promise<CommitCursor | null> {
  if (binding.goalId === null) return null;
  if (binding.taskId !== null) {
    const view = await index.taskVerification({ projectId: binding.projectId, goalId: binding.goalId, taskId: binding.taskId });
    if (view.status !== 'ready' || view.verification.reduction?.phase !== 'satisfied') return null;
    const current = view.verification.planRef;
    if (canonicalJson(view.verification.reduction.planRef) !== canonicalJson(current) ||
        (binding.planRef !== null && canonicalJson(binding.planRef) !== canonicalJson(current))) return null;
    return view.verification.reduction.sourceCursor;
  }
  const view = await index.goalStatus({ projectId: binding.projectId, goalId: binding.goalId });
  if (view.status !== 'ready' || view.goal.phase !== 'COMPLETED') return null;
  if (binding.planRef !== null && canonicalJson(binding.planRef) !== canonicalJson(view.goal.planRef)) return null;
  return view.goal.sourceCursor;
}
