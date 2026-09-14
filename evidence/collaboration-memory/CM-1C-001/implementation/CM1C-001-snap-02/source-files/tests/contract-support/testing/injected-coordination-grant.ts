import type {TaskEnvelopeV1} from '../../../src/contracts/task-envelope.js';
import type {CoordinationRuntimeGrantV1} from '../../../src/contracts/coordination-tools.js';
/** Deliberately injected host capability with valid shape; not a claim of canonical authorization. */
export function injectedCoordinationGrant(envelope:TaskEnvelopeV1,onCall:()=>never):Extract<CoordinationRuntimeGrantV1,{status:'granted'}>{
  const workContextRef={aggregateType:'WorkContextBinding' as const,projectId:envelope.projectId,workspaceId:envelope.workspaceId,workId:'injected-test-work'};
  const participationRef={aggregateType:'WorkParticipation' as const,projectId:envelope.projectId,workspaceId:envelope.workspaceId,workId:workContextRef.workId,participationId:'injected-test-part'};
  const principal={schemaVersion:1 as const,agentInstanceId:'injected-test-agent',workContextRef,participationRef,roleBinding:envelope.roleBinding,runRef:envelope.runRef};
  const denied=async()=>onCall();
  return {status:'granted',capability:'coordination',grant:{schemaVersion:1,capability:'coordination',runRef:envelope.runRef,workContextRef,participationRef,agentInstanceId:principal.agentInstanceId,roleBinding:envelope.roleBinding,basis:{kind:'work_current_participation',workContextRef,participationRef}},access:{principal,mailbox:denied,request:denied,respond:denied,subscribe:denied,wait:denied,cancel:denied,reportArchitecture:denied}};
}
