/**
 * The taskbook markdown for one stage of a plan revision (spec §5.3.4).
 *
 * Pure: it reads only the plan it is handed. The stage is the file's subject;
 * a task belongs to the stage named by its own `stageId`, else by its stage or
 * module scope. A stage that is not in the plan renders nothing, which the
 * caller reports as a failure instead of inventing an empty book.
 *
 * The full instruction comes from `revisionAssignments`, the one assignment
 * reader, so the file and `{{task}}` cannot disagree about it.
 */
import {
  revisionAssignments,
  type PlanRevisionDraft,
  type PlanRevisionSnapshot,
  type TaskScope,
} from '../../../contracts/plan.js';
import { stageIdOf } from '../notes/note-related-scope.js';

function scopeText(scope: TaskScope): string {
  switch (scope.kind) {
    case 'goal': return 'goal';
    case 'stage': return `stage:${scope.stageId}`;
    case 'module': return `module:${scope.stageId}/${scope.moduleRef}`;
  }
}

export function renderTaskbookMarkdown(
  plan: PlanRevisionDraft | PlanRevisionSnapshot,
  stageId: string,
): string | null {
  const stage = plan.stages.find((candidate) => candidate.stageId === stageId);
  if (stage === undefined) return null;

  const lines: string[] = [
    `# ${stage.title}`,
    '',
    `- Stage: ${stage.stageId}`,
    `- Plan: ${plan.planId}`,
    `- Plan revision: ${plan.planRevision}`,
    '',
  ];
  if (stage.description !== undefined && stage.description !== '') {
    lines.push(stage.description, '');
  }

  const assignments = revisionAssignments(plan);
  for (const task of plan.tasks.filter((candidate) => stageIdOf(candidate) === stageId)) {
    lines.push(`## ${task.title}`, '');
    lines.push(`- Task: ${task.taskId}`);
    lines.push(`- Scope: ${scopeText(task.scope)}`);
    if (task.plannedFiles !== undefined) lines.push(`- Planned files: ${task.plannedFiles.join(', ')}`);
    lines.push(`- Estimated lines: ${task.estimatedLines === undefined ? '未预估' : String(task.estimatedLines)}`);
    lines.push('');

    lines.push('Dependencies:');
    const dependencies = plan.executionDag.dependsOn
      .filter((edge) => edge.taskId === task.taskId);
    if (dependencies.length === 0) lines.push('- 无');
    else {
      for (const edge of dependencies) {
        lines.push(`- ${edge.dependsOnId} (${edge.requires.label})`);
      }
    }
    lines.push('');

    lines.push('Acceptance:');
    const obligations = plan.obligations
      .filter((obligation) => obligation.taskIds.includes(task.taskId));
    if (obligations.length === 0) lines.push('- 无');
    else {
      for (const obligation of obligations) {
        lines.push(`- ${obligation.title}`);
        for (const requirement of obligation.verificationRequirements) {
          lines.push(`  - ${requirement.description}`);
        }
      }
    }

    const instruction = assignments.find((entry) => entry.taskId === task.taskId)?.instruction;
    if (instruction !== undefined) {
      lines.push('', 'Instruction:', '', instruction);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * The path relative to `<settingsDirectory>/taskbooks` (spec §5.3.4). Every id
 * is one URL-encoded segment, and `planId` is in the name because candidates
 * that share `basedOn` share goal, stage and `planRevision`.
 */
export function taskbookRelativePath(input: {
  projectId: string; workspaceId: string; goalId: string; stageId: string;
  planId: string; planRevision: number;
}): string {
  const projectId = encodeURIComponent(input.projectId);
  const workspaceId = encodeURIComponent(input.workspaceId);
  const goalId = encodeURIComponent(input.goalId);
  const stageId = encodeURIComponent(input.stageId);
  const planId = encodeURIComponent(input.planId);
  return `${projectId}/${workspaceId}/${goalId}/`
    + `goal-${goalId}__plan-${planId}__stage-${stageId}__rev-${input.planRevision}.md`;
}
