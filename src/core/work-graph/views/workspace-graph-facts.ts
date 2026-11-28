/**
 * One workspace's two graph facts: whether it is the project's main workspace and whether it owns a module in the
 * current adopted architecture. The main workspace is the caller's `main` (read once by `readMainWorkspace`, never
 * "the first workspace"); the graph membership is the one projection `catalogForWorkspace` over the adopted catalog.
 * Both readers below share that projection and the "nothing adopted is `inGraph: false`" rule, so they cannot drift.
 *
 * They differ only in the catalog window: the `role-lines/operations` row reads `readRecordedCatalogWindow`, which
 * reads no knowledge file, so a conflict that makes the knowledge files unavailable leaves the menu readable; a
 * workspace's withdraw/remove reads `readCurrentCatalogWindow`, which keeps the refusal the removal had before
 * (an unconfirmed write, a bad file or a file-side change fails it instead of being read from the record).
 * A project with no adopted catalog is `inGraph: false` (the reader's `not_found` is "nothing adopted", not a
 * failed read); every other read failure is returned as it is, never folded into an empty graph.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { catalogForWorkspace } from '../../../contracts/workspace-catalog.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { readCurrentCatalogWindow, readRecordedCatalogWindow,
  type CurrentCatalogWindow, type KnowledgeRead } from '../architecture/catalog-service.js';

export type WorkspaceGraphFactsV1 = {
  /** The workspace is the project's main workspace (the `start_lines` operation's). */
  main: boolean;
  /** The workspace has at least one module in the adopted architecture's project view. */
  inGraph: boolean;
};

type ReadyCatalogWindow = Extract<CurrentCatalogWindow, { status: 'ready' }>;

/** The one projection from a ready catalog window to the two facts. */
function graphFactsOfWindow(window: ReadyCatalogWindow, workspaceId: string, main: string | null): WorkspaceGraphFactsV1 {
  return { main: main === workspaceId,
    inGraph: catalogForWorkspace(window.catalog.catalog, workspaceId, main).modules.length > 0 };
}

/** The `role-lines/operations` row: the recorded catalog, never the knowledge files (KC-3 conflict repair). */
export async function workspaceGraphFacts(records: Pick<GoalRecordTransactionPort, 'readMany'>,
  ctx: CoreCallContext, projectId: string, workspaceId: string,
  main: string | null): Promise<ReadResult<WorkspaceGraphFactsV1>> {
  const window = await readRecordedCatalogWindow(records, projectId);
  if (window.status === 'not_found') return { status: 'ready', value: { main: main === workspaceId, inGraph: false } };
  if (window.status !== 'ready') return window;
  return { status: 'ready', value: graphFactsOfWindow(window, workspaceId, main) };
}

/** Withdraw/remove: the current catalog, so a pending or unreadable knowledge file still refuses the removal. */
export async function workspaceGraphCurrentFacts(records: Pick<GoalRecordTransactionPort, 'readMany'>,
  knowledge: KnowledgeRead, projectId: string, workspaceId: string,
  main: string | null): Promise<ReadResult<WorkspaceGraphFactsV1>> {
  const window = await readCurrentCatalogWindow(records, projectId, knowledge);
  if (window.status === 'not_found') return { status: 'ready', value: { main: main === workspaceId, inGraph: false } };
  if (window.status !== 'ready') return window;
  return { status: 'ready', value: graphFactsOfWindow(window, workspaceId, main) };
}
