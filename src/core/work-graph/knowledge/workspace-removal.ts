/**
 * KLS-2: removing one workspace's knowledge from a project.
 *
 * The four duties of a removal are split by what owns the data: the Workspace
 * record's `removedAt`, the region claims and the region links are one
 * WorkGraph registration commit (`registration.remove`, built by the caller);
 * the project index rows are a cache over the knowledge files and are deleted
 * afterwards in one index transaction. The index never joins the WorkGraph
 * transaction: a failure after the registration commit leaves the workspace
 * marked removed, and the same two-argument call is retried to finish the
 * index (WD-21).
 *
 * The index is per line (`lineRefKey` is the workspace and the branch), so a
 * workspace can have more than one line (E2): every line of the project whose
 * `scope.workspaceId` is the removed workspace loses all its file rows; every
 * other line loses the notes anchored under the removed workspace's project
 * view (`module:/@ws:<enc>/`, `interface:/@ws:<enc>/`, `file:/@ws:<enc>/`).
 * The files under `.workbench/` are never touched (WD-13).
 *
 * Every read happens before the index transaction; only `deleteFile` and
 * `clearNoteRows` write, and they write in one transaction. A read failure is
 * `unavailable` with its reason, never an empty deletion and never a partial
 * success.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { WorkspaceRef, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import { WORKSPACE_PROJECT_PATH_PREFIX } from '../../../contracts/workspace-path.js';
import type { KnowledgeFileRow, KnowledgeIndex } from '../../record-store/knowledge-index-ports.js';
import type { StoreFailure, StoreResult } from '../../record-store/ports.js';
import type { KnowledgeLines } from '../model/line-knowledge.js';
import { lineRefKey } from '../model/line-knowledge.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { CommitFragment } from '../persistence/command-executor.js';

/** What one removal reports: the registration's own receipt values plus what this call actually deleted. */
export type WorkspaceKnowledgeRemovalCountsV1 = {
  releasedClaims: number;
  deletedIndexRows: number;
  deletedLinks: number;
  /** The real cursor of the registration commit; a committed result always carries one. */
  cursor: CommitCursor;
  replayed: boolean;
};

/**
 * The frozen two-argument seam. `ctx`, `requestId` and the region
 * `contribution` are bound by the factory, so the owner only names the target.
 */
export type RemoveWorkspaceKnowledge = (
  projectRef: ProjectScope,
  workspaceRef: WorkspaceRef,
) => Promise<StoreResult<WorkspaceKnowledgeRemovalCountsV1>>;

type WorkspaceKnowledgeRemovalDeps = {
  /** The registration write arm the composition root injects; it stamps `removedAt` and joins the contribution. */
  registration: {
    remove(
      ctx: CoreCallContext,
      request: GraphWrite<{ workspace: WorkspaceScope }>,
      contribution: CommitFragment,
    ): Promise<WriteResult<{ workspace: WorkspaceSnapshot; releasedClaims: number }>>;
  };
  /** The project's lines, opened by the factory's caller. */
  lines: KnowledgeLines;
  /** The project's index (`KnowledgeLines.write.indexOf(projectId)`). */
  index: KnowledgeIndex;
};

/** One line whose own index rows all go: the workspace's checked-out lines. */
type OwnLineRows = { lineRef: string; files: readonly KnowledgeFileRow[]; noteIds: readonly string[] };
/** One line that keeps its files but loses the notes anchored in the removed workspace. */
type OtherLineRows = { lineRef: string; noteIds: readonly string[] };

/**
 * Build the removal seam for one bound call. `contribution` is the caller's
 * region fragment (empty for a withdrawal); it is committed unchanged with the
 * workspace record, and the index rows are deleted only after that commit.
 */
export function createWorkspaceKnowledgeRemoval(deps: WorkspaceKnowledgeRemovalDeps): {
  bind(ctx: CoreCallContext, requestId: string, contribution: CommitFragment): {
    removeWorkspaceKnowledge: RemoveWorkspaceKnowledge;
  };
} {
  return {
    bind: (ctx, requestId, contribution) => ({
      removeWorkspaceKnowledge: (projectRef, workspaceRef) =>
        removeWorkspaceKnowledge(deps, ctx, requestId, contribution, projectRef, workspaceRef),
    }),
  };
}

async function removeWorkspaceKnowledge(
  deps: WorkspaceKnowledgeRemovalDeps,
  ctx: CoreCallContext,
  requestId: string,
  contribution: CommitFragment,
  projectRef: ProjectScope,
  workspaceRef: WorkspaceRef,
): Promise<StoreResult<WorkspaceKnowledgeRemovalCountsV1>> {
  if (projectRef.projectId !== workspaceRef.projectId || projectRef.projectId !== ctx.projectId) {
    return unavailable('the workspace removal scope does not belong to the bound project');
  }
  const request: GraphWrite<{ workspace: WorkspaceScope }> = {
    input: { workspace: { projectId: projectRef.projectId, workspaceId: workspaceRef.workspaceId } },
    meta: { requestId, expected: [] },
  };
  // The four duties' WorkGraph half: the Workspace record, the region claims and the region links
  // commit together, before the index cache is touched.
  const receipt: WriteResult<{ workspace: WorkspaceSnapshot; releasedClaims: number }> = await deps.registration.remove(ctx, request, contribution)
    .catch((error: unknown): CoreRejection =>
      ({ status: 'rejected', code: 'unavailable', reason: messageOf(error) }));
  if (receipt.status !== 'committed') return storeFailureOf(receipt);
  const deleted = await deleteWorkspaceIndexRows(deps, ctx, workspaceRef);
  if (deleted.status !== 'ready') return deleted;
  return {
    status: 'ready',
    value: {
      releasedClaims: receipt.value.releasedClaims,
      deletedIndexRows: deleted.value.deletedIndexRows,
      deletedLinks: deleted.value.deletedLinks,
      cursor: receipt.cursor,
      replayed: receipt.replayed,
    },
  };
}

/**
 * The index half of a removal, run after the registration commit (WD-21). Every line and every
 * affected row is read outside a transaction; only `deleteFile` and `clearNoteRows` write, in one
 * transaction. The project is the caller's; a workspace with no checked-out line is `unavailable`,
 * never a zero-row success (WD-12).
 */
async function deleteWorkspaceIndexRows(
  deps: Pick<WorkspaceKnowledgeRemovalDeps, 'lines' | 'index'>,
  caller: CoreCallContext,
  workspaceRef: WorkspaceRef,
): Promise<StoreResult<{ deletedIndexRows: number; deletedLinks: number }>> {
  const project = await deps.lines.project(caller);
  if (project.status !== 'ready') return unavailable(project.reason);

  const ownLines = project.value.filter(line => line.scope.workspaceId === workspaceRef.workspaceId);
  if (ownLines.length === 0) {
    return unavailable(`the workspace ${workspaceRef.workspaceId} has no checked-out knowledge line`);
  }

  const own: OwnLineRows[] = [];
  const others: OtherLineRows[] = [];
  let deletedIndexRows = 0;
  let deletedLinks = 0;
  for (const line of ownLines) {
    const lineRef = lineRefKey(line.scope, line.line);
    const files = readIndexPort(() => deps.index.listFiles(lineRef));
    if (files.status !== 'ready') return unavailable(files.reason);
    // The anchor rows are the derived note rows; the range read's empty prefix names every note on
    // this line, so each note file's anchor, text and edge rows go with its file row.
    const noteIds = readIndexPort(() => deps.index.noteIdsByAnchorPrefix(lineRef, ''));
    if (noteIds.status !== 'ready') return unavailable(noteIds.reason);
    deletedIndexRows += files.value.length;
    own.push({ lineRef, files: files.value, noteIds: noteIds.value });
  }
  for (const line of project.value) {
    if (line.scope.workspaceId === workspaceRef.workspaceId) continue;
    const lineRef = lineRefKey(line.scope, line.line);
    const found = new Set<string>();
    for (const prefix of workspaceAnchorPrefixes(workspaceRef.workspaceId)) {
      const ids = readIndexPort(() => deps.index.noteIdsByAnchorPrefix(lineRef, prefix));
      if (ids.status !== 'ready') return unavailable(ids.reason);
      for (const noteId of ids.value) found.add(noteId);
    }
    if (found.size === 0) {
      others.push({ lineRef, noteIds: [] });
      continue;
    }
    const noteIds = [...found].sort();
    // The note head is the project's record, read through the line's own port; a missing head is not a
    // link, and a bad file/record is unavailable rather than a guarded count (WD-13).
    const notes = await line.readNotesById(noteIds);
    if (notes.status !== 'ready') return unavailable(notes.reason);
    deletedIndexRows += noteIds.length;
    deletedLinks += notes.value.filter(note => note.head?.kind === 'link').length;
    others.push({ lineRef, noteIds });
  }

  // A throw rolls the whole index transaction back; the registration stays committed and a retry
  // re-reads the index and continues from there (WD-21).
  try {
    deps.index.transaction(tx => {
      for (const rows of own) {
        for (const file of rows.files) tx.deleteFile(rows.lineRef, file.path);
        for (const noteId of rows.noteIds) tx.clearNoteRows(rows.lineRef, noteId);
      }
      for (const rows of others) {
        for (const noteId of rows.noteIds) tx.clearNoteRows(rows.lineRef, noteId);
      }
    });
  } catch (error) {
    return unavailable(messageOf(error));
  }
  return { status: 'ready', value: { deletedIndexRows, deletedLinks } };
}

/** The three project-view anchor prefixes that name the removed workspace. */
function workspaceAnchorPrefixes(workspaceId: string): readonly string[] {
  const at = `${WORKSPACE_PROJECT_PATH_PREFIX}${encodeURIComponent(workspaceId)}/`;
  return [`module:${at}`, `interface:${at}`, `file:${at}`];
}

/** A synchronous index read; its throw is the same `unavailable` a rejected read is. */
function readIndexPort<T>(read: () => T): StoreResult<T> {
  try {
    return { status: 'ready', value: read() };
  } catch (error) {
    return unavailable(messageOf(error));
  }
}

/**
 * The seam answers the Store result vocabulary. A registration refusal keeps
 * the store-shaped codes; the domain-only codes (a trusted-context or capacity
 * refusal) are `unavailable`, never a fabricated count.
 */
function storeFailureOf(rejection: CoreRejection): StoreFailure {
  switch (rejection.code) {
    case 'invalid':
    case 'not_found':
    case 'idempotency_conflict':
    case 'unsupported':
    case 'unavailable':
      return { status: 'rejected', code: rejection.code, reason: rejection.reason };
    case 'revision_conflict':
      return {
        status: 'rejected',
        code: 'revision_conflict',
        reason: rejection.reason,
        current: (rejection.current ?? []).map(pin => ({ refKey: canonicalKey(pin.ref), revision: pin.revision })),
      };
    default:
      return { status: 'rejected', code: 'unavailable', reason: rejection.reason };
  }
}

function unavailable(reason: string): StoreFailure {
  return { status: 'rejected', code: 'unavailable', reason };
}
