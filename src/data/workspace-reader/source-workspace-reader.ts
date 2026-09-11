import { WorkspaceSandbox, DefaultPermissionPolicy } from '../../../vendor/coding-agent/dist/public-api.js';
import type { ArchitectureSourceCapturePort } from '../../contracts/architecture-source.js';
import { WORKSPACE_DENIED_PREFIXES } from './denied-prefixes.js';
import { ProjectSourceIndex } from './project-source-index.js';
import { readSourceIdentity } from './source-identity.js';
import { captureArchitectureSource } from './architecture-source.js';
export async function workspaceProjectIndex(root:string) {
  // RC-02：拒绝前缀只从本 Module 的 denied-prefixes.ts 取（唯一权威），不再自带字面量。
  const ws=await WorkspaceSandbox.create(root,{deniedPrefixes:[...WORKSPACE_DENIED_PREFIXES]});
  const policy=new DefaultPermissionPolicy({hiddenPrefixes:ws.deniedPrefixes});
  const allowed=(path:string)=>policy.evaluate({runId:'source-inspection',callId:'source-read',tool:'read',effectClass:'read_only',arguments:{path},paths:[path],cwd:null,commandPreview:null,
    capabilities:['workspace_read'],workspaceIdentity:ws.identity,workspaceRevision:'current',sandboxProfileVersion:'source-v1'}).decision==='allow';
  return new ProjectSourceIndex({read:(p,n)=>ws.read(p,n),allowed,inventory:signal=>ws.listFiles(60000,{signal}),sourceIdentity:()=>readSourceIdentity(root,ws.identity)});
}


export class ProjectArchitectureSourceReader implements ArchitectureSourceCapturePort {
  constructor(private readonly rootFor: (projectId: string, workspaceId: string) => string) {}
  async capture(request: Parameters<ArchitectureSourceCapturePort['capture']>[0]) {
    const index = await workspaceProjectIndex(this.rootFor(request.projectId, request.workspaceId));
    try { return await captureArchitectureSource(index, request, request.mappings, request.configPath); }
    finally { index.dispose(); }
  }
}
