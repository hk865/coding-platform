import { WorkspaceSandbox } from '../../../vendor/coding-agent/dist/public-api.js';
import type { ReadonlyReadWitnessPort, ReadonlySourceRead } from '../../contracts/verification-context.js';
import type { VerificationScope } from '../../contracts/verification-import.js';
import { WORKSPACE_DENIED_PREFIXES } from './denied-prefixes.js';

/** Reuse the actual native read boundary and content revision; no shell or writes. */
export class ReadonlyReadWitnessReader implements ReadonlyReadWitnessPort {
  constructor(private readonly rootFor: (projectId: string, workspaceId: string) => string) {}
  async assertCurrent(scope: VerificationScope, reads: readonly ReadonlySourceRead[]): Promise<{ completeReadPaths: string[] }> {
    if (reads.length > 1000) throw Error('Read witness capacity exceeded');
    const workspace = await WorkspaceSandbox.create(this.rootFor(scope.projectId, scope.workspaceId), { deniedPrefixes: [...WORKSPACE_DENIED_PREFIXES] });
    const lines = new Map<string, number>();
    for (const read of reads) {
      const file = await workspace.read(read.path, 256 * 1024);
      if (file.revision !== read.revision || !Number.isSafeInteger(read.startLine) || !Number.isSafeInteger(read.endLine) ||
          read.startLine < 1 || read.endLine < read.startLine || read.endLine > file.content.split('\n').length) {
        throw Error('Read source revision or line range changed: ' + read.path);
      }
      lines.set(read.path, file.content.split('\n').length);
    }
    const completeReadPaths = [...lines].filter(([path, total]) => {
      let covered = 0;
      for (const read of reads.filter(read => read.path === path).sort((a, b) => a.startLine - b.startLine)) {
        if (read.startLine > covered + 1) break;
        covered = Math.max(covered, read.endLine);
      }
      return covered === total;
    }).map(([path]) => path).sort();
    return { completeReadPaths };
  }
}
