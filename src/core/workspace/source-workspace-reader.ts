import { WorkspaceSandbox, DefaultPermissionPolicy } from '../../../vendor/coding-agent/dist/public-api.js';
import type { ArchitectureSourceCapturePort } from '../../contracts/architecture-source.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceCapturePort } from './ports.js';
import { WORKSPACE_DENIED_PREFIXES } from './denied-prefixes.js';
import { ProjectSourceIndex } from './project-source-index.js';
import { readSourceIdentity } from './source-identity.js';
import { captureArchitectureSource } from './architecture-source.js';

/** Low-level read-only factory kept for existing explicit consumers (paths/report tests). */
export async function workspaceProjectIndex(root:string) {
  // 路径边界归位：拒绝前缀只从本 Module 的 denied-prefixes.ts 取（唯一权威），不再自带字面量。
  const ws=await WorkspaceSandbox.create(root,{deniedPrefixes:[...WORKSPACE_DENIED_PREFIXES]});
  const policy=new DefaultPermissionPolicy({hiddenPrefixes:ws.deniedPrefixes});
  const allowed=(path:string)=>policy.evaluate({runId:'source-inspection',callId:'source-read',tool:'read',effectClass:'read_only',arguments:{path},paths:[path],cwd:null,commandPreview:null,
    capabilities:['workspace_read'],workspaceIdentity:ws.identity,workspaceRevision:'current',sandboxProfileVersion:'source-v1'}).decision==='allow';
  return new ProjectSourceIndex({read:(p,n)=>ws.read(p,n),allowed,inventory:signal=>ws.listFiles(60000,{signal}),sourceIdentity:()=>readSourceIdentity(root,ws.identity)});
}

/**
 * Real Host reader: the trusted context (real Run/RoleBinding/Workspace + Host lifecycle
 * signal) is bound once per scoped service, and capture/verify/release all run through the
 * shared capture registry. There is no rootFor-only identity fallback.
 */
export class ProjectArchitectureSourceReader implements ArchitectureSourceCapturePort {
  constructor(private readonly deps: { tools: WorkspaceCapturePort; context: CoreCallContext }) {}

  async capture(request: Parameters<ArchitectureSourceCapturePort['capture']>[0]) {
    const context = this.deps.context;
    if (request.projectId !== context.projectId || request.workspaceId !== context.workspaceId)
      throw Error('architecture source reader scope mismatch');
    const workspace = { aggregateType: 'Workspace' as const, projectId: request.projectId, workspaceId: request.workspaceId };
    const captured = await this.deps.tools.captureSourceChanges(context, { workspace, workspaceRevision: request.workspaceRevision, provider: 'typescript',
      ...(request.configPath ? { configPath: request.configPath } : {}) });
    if (captured.status !== 'ready') throw Error('architecture source capture rejected: ' + captured.code + ': ' + captured.reason);
    try {
      const graph = await this.deps.tools.captureArchitectureSource(context, { capture: captured.value.ref, mappings: request.mappings });
      if (graph.status !== 'ready') throw Error('architecture source mapping rejected: ' + graph.code + ': ' + graph.reason);
      return graph.value;
    } finally {
      // Best-effort release: the caller's context may already be cancelled, so use an
      // independent cleanup signal with the same principal/scope (a fresh authorize still runs).
      const cleanup: CoreCallContext = { ...context, signal: new AbortController().signal };
      try { await this.deps.tools.releaseCapture(cleanup, captured.value.ref); } catch { /* TTL or Host close reclaims the capture */ }
    }
  }
}
