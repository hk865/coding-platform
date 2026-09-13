import { WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';
import type { QuerySourceRevisionPort } from '../../contracts/query-execution-context.js';
import { WORKSPACE_DENIED_PREFIXES } from './denied-prefixes.js';

/** Native WorkspaceReader source capture for historical query applicability.
 * This intentionally keeps the kernel baseline identity and denied prefixes;
 * it is not interchangeable with an exploration's complete source pin. */
export class QueryWorkspaceSourceReader implements QuerySourceRevisionPort {
  constructor(private readonly rootFor: (projectId: string, workspaceId: string) => string) {}
  async sourceRevision(projectId: string, workspaceId: string): Promise<string | null> {
    try {
      const workspace = await WorkspaceSandbox.create(this.rootFor(projectId, workspaceId), {
        // RC-02：同上，路径边界只有 denied-prefixes.ts 一个来源。
        deniedPrefixes: [...WORKSPACE_DENIED_PREFIXES],
      });
      return (await workspace.captureBaseline()).revision;
    } catch { return null; }
  }
}
