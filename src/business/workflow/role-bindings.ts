import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type { WorkflowHostConfiguration } from './ports.js';

/**
 * A role is served only when exactly one trusted binding of the Goal's project
 * and workspace carries its `roleBinding.templateId` (the Workflow's rule).
 */
export function servingBinding(
  bindings: WorkflowHostConfiguration['bindings'], projectId: string, workspaceId: string, role: string,
): WorkflowHostConfiguration['bindings'][number] | null {
  const matches = bindings.filter((binding) => binding.workspace.projectId === projectId
    && binding.workspace.workspaceId === workspaceId && binding.roleBinding.templateId === role);
  return matches.length === 1 ? matches[0]! : null;
}

/** The distinct served `roleBinding.templateId` values of one workspace scope, sorted by UTF-16 code units. */
export function servedRoleIds(
  bindings: WorkflowHostConfiguration['bindings'], scope: WorkspaceScope,
): readonly string[] {
  const roles = new Set<string>();
  for (const binding of bindings) {
    if (binding.workspace.projectId !== scope.projectId
        || binding.workspace.workspaceId !== scope.workspaceId) continue;
    if (servingBinding(bindings, scope.projectId, scope.workspaceId, binding.roleBinding.templateId)) {
      roles.add(binding.roleBinding.templateId);
    }
  }
  return [...roles].sort((left, right) => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
}
