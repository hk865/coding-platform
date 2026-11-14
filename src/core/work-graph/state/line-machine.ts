/**
 * The only writer of the line record (`Line@1`, `src/contracts/line.ts`). A line is born `open` at revision 1 with
 * the HEAD it forked from; `merged` and `removed` are the line end's (KLS-3b), which writes them through a transition
 * added here, never by hand.
 */
import { lineKeyOf, type CheckoutIdentity, type LineSnapshot } from '../../../contracts/line.js';

export function newLineRecord(input: {
  projectId: string; workspaceId: string; line: CheckoutIdentity; forkPoint: string | null; now: string;
}): LineSnapshot {
  return {
    ref: { aggregateType: 'Line', projectId: input.projectId, workspaceId: input.workspaceId,
      lineRef: lineKeyOf(input.workspaceId, input.line.folder) },
    revision: 1,
    repoKey: input.line.repoKey,
    folder: input.line.folder,
    branch: input.line.branch,
    firstCommit: input.line.firstCommit,
    forkPoint: input.forkPoint,
    status: 'open',
    createdAt: input.now,
    closedAt: null,
  };
}
