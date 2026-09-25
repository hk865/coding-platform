import type { N0WorkflowDependencies, N0WorkflowPort } from './ports.js';

export function createWorkflow(_deps: N0WorkflowDependencies): N0WorkflowPort {
  const unsupported = async () => ({ status: 'rejected' as const, code: 'unsupported' as const,
    reason: 'N0 Workflow is a source boundary skeleton; no business action is implemented' });
  return { handleGoalInput: unsupported, advanceWork: unsupported };
}
