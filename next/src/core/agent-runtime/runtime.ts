import type { N0AgentRuntimeService } from './ports.js';

export function createAgentRuntime(): N0AgentRuntimeService {
  const unsupported = async () => ({ status: 'rejected' as const, code: 'unsupported' as const,
    reason: 'N0 AgentRuntime is a source boundary skeleton; no Kernel capability is wired' });
  return { port: { capabilities: unsupported, prepareExecution: unsupported, startRun: unsupported } };
}
