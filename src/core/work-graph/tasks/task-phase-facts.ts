/**
 * The projection inputs (§4.1) of a completed Task, assembled from the
 * canonical task read. Pure: the caller supplies every fact it already read.
 */
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { Phase, TaskKind } from '../../../contracts/plan.js';
import type { TaskReductionSnapshot } from '../../../contracts/reduction.js';
import type { TaskPhaseFacts } from '../state/task-machine.js';

export function taskPhaseFactsOf(input: {
  taskKind: TaskKind;
  applicableReduction: Pick<TaskReductionSnapshot, 'phase'> | null;
  selectedRun: RunSnapshot | null;
  effectivePhase: Phase;
  round: TaskPhaseFacts['round'];
  coveringRequeue: TaskPhaseFacts['coveringRequeue'];
}): TaskPhaseFacts {
  return {
    taskKind: input.taskKind,
    applicableReduction: input.applicableReduction,
    selectedRun: input.selectedRun,
    originUnresolvable: input.selectedRun === null && input.applicableReduction === null
      && input.effectivePhase === 'blocked',
    round: input.round,
    coveringRequeue: input.coveringRequeue,
  };
}
