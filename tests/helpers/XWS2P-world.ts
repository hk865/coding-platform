/**
 * XWS2P: the two-workspace world where BOTH roots hold `src/a.ts` with different
 * contents. Every state comes from a public step:
 *
 * - the first workspace is `openS6AHostWorld`'s (the SE2 Host, memory), and its
 *   `src/a.ts` is a real file written under that root;
 * - the second workspace is the frozen `addS7D2SecondWorkspace` (a real root
 *   opened through the Host's `workspaces/open`, then a Goal there); its root is
 *   the Host snapshot's own fact, and `src/a.ts`/`src/b.ts` are real files;
 * - the second workspace's module is one human `architecture/revise` (the same
 *   public route S9UI1's `addCoreModule` uses) adding it with the canonical
 *   project path of the second workspace's `src`. The human, not a proposal,
 *   is used because the second workspace carries no Runtime/Workflow binding,
 *   so no exploration QueryRun can run there (`openS6ATwoWorkspaceWorld`'s
 *   header: the bindings stay the first workspace's).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHostCoreCallContext } from '../../src/app/core-call-context.js';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { NoteAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type {
  GraphReadPageV1, NodeCardV1,
} from '../../src/core/work-graph/model/graph-context-contracts.js';
import type {
  NoteItemV1, NoteListResultV1, WriteNoteEnvelopeV1,
} from '../../src/core/work-graph/model/note-contracts.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { readyValue } from './S6A-memory-fixture.js';
import { OPERATOR, S6A_SCOPE } from './S6A-request-fixture.js';
import { addS7D2SecondWorkspace } from './S7D2-role-line-world.js';

export const XWS2P_MAIN_TEXT = 'export const a = 1;\n';
export const XWS2P_SECOND_TEXT = 'export const a = 2;\n';
export const XWS2P_SECOND_B_TEXT = 'export const b = 2;\n';

export type XWS2PWorkspace = {
  readonly scope: WorkspaceScope;
  readonly root: string;
  readonly ctx: CoreCallContext;
};

export type XWS2PWorld = {
  readonly world: S6AHostWorld;
  readonly main: XWS2PWorkspace;
  readonly second: XWS2PWorkspace;
  close(): Promise<void>;
};

/** The canonical project path: the prefix and the encoded workspace id (hand-computed, not a product call). */
export const xws2pProjectPath = (workspaceId: string, path: string): string =>
  `/@ws:${encodeURIComponent(workspaceId)}${path === '.' ? '' : `/${path}`}`;

export async function openXWS2PWorld(): Promise<XWS2PWorld> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  let removeSecond: () => Promise<void> = async () => undefined;
  try {
    await ensureProjectPointers(world);
    await mkdir(join(world.root, 'src'), { recursive: true });
    await writeFile(join(world.root, 'src/a.ts'), XWS2P_MAIN_TEXT);
    const second = await addS7D2SecondWorkspace(world, 'xws2p-second');
    removeSecond = second.remove;
    const snapshot = await world.settings('snapshot', {});
    if (snapshot.status !== 'ready') throw new Error(`XWS2P: the Host snapshot is not ready: ${JSON.stringify(snapshot)}`);
    const root = snapshot.value.workspaces.find(entry => entry.scope.workspaceId === second.scope.workspaceId)?.root;
    if (root === undefined) throw new Error('XWS2P: the second workspace has no Host root');
    await writeFile(join(root, 'src/a.ts'), XWS2P_SECOND_TEXT);
    await writeFile(join(root, 'src/b.ts'), XWS2P_SECOND_B_TEXT);
    const main: XWS2PWorkspace = {
      scope: { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId },
      root: world.root, ctx: world.humanContext(),
    };
    const secondWorkspace: XWS2PWorkspace = {
      scope: { projectId: second.scope.projectId, workspaceId: second.scope.workspaceId },
      root,
      ctx: createHostCoreCallContext({ scope: second.scope, actor: { ...OPERATOR },
        signal: new AbortController().signal }),
    };
    return {
      world, main, second: secondWorkspace,
      async close() {
        try { await world.close(); } finally { await removeSecond(); }
      },
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    await removeSecond().catch(() => undefined);
    throw error;
  }
}

/** `architecture/revise` over the second workspace's own trusted context: M1 keeps `src`, M2 owns the second root's `src`. */
export async function addXWS2PSecondModule(world: XWS2PWorld, input: {
  readonly moduleId: string; readonly name: string; readonly summary: string;
}): Promise<unknown> {
  const current = readyValue<ArchitectureRevision>((await world.world.dispatch('architecture/read', world.main.ctx,
    plain(world.main.scope, { selection: { kind: 'current' } }))), 'the current architecture');
  const registration = readyValue<{ project: { revision: number }; workspace: { revision: number } }>(
    (await world.world.dispatch('workspaces/registration', world.second.ctx,
      plain(world.second.scope, world.second.scope))), 'the second workspace registration');
  const pin: ArchitectureCatalogPinV1 = { catalogRef: current.catalog.ref,
    baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } };
  const committed = await world.world.dispatch('architecture/revise', world.second.ctx,
    graphWrite(world.second.scope, {
      expected: pin,
      ops: [
        { op: 'set_module_name', moduleId: 's6a-core', name: 'first-mod' },
        { op: 'add_module', module: {
          ref: { projectId: world.second.scope.projectId, moduleId: input.moduleId },
          name: input.name, responsibility: input.summary,
          paths: [xws2pProjectPath(world.second.scope.workspaceId, 'src')], interfaces: [],
        } },
      ],
      responsibilityMoves: [], reason: 'XWS2P second workspace module',
    }, `xws2p-${input.moduleId}`, [
      { ref: { aggregateType: 'Project', projectId: world.second.scope.projectId }, revision: registration.project.revision },
      { ref: { aggregateType: 'Workspace', ...world.second.scope }, revision: registration.workspace.revision },
    ]));
  // The raw route body: the row asserts `committed`, so a refused setup is the
  // row's own first red, never a thrown fixture error.
  return committed;
}

/** The project's current catalog through `architecture/read`. */
export async function readXWS2PCatalog(world: XWS2PWorld): Promise<ArchitectureRevision> {
  return readyValue<ArchitectureRevision>((await world.world.dispatch('architecture/read', world.main.ctx,
    plain(world.main.scope, { selection: { kind: 'current' } }))), 'the current architecture');
}

/** One person note through `notes/write` in the given workspace; the raw envelope is returned for the row to assert. */
export async function writeXWS2PNote(world: XWS2PWorld, workspace: XWS2PWorkspace,
  note: NoteDraftV1, commandId: string): Promise<WriteNoteEnvelopeV1> {
  return await world.world.dispatch('notes/write', workspace.ctx, plain(workspace.scope, {
    commandId, note, expectedPointerRevision: null, goalId: null,
  })) as WriteNoteEnvelopeV1;
}

/** `notes/read` in the given workspace (the public owner, which includes the check's `observedFiles`). */
export async function readXWS2PNote(world: XWS2PWorld, workspace: XWS2PWorkspace,
  noteId: string): Promise<ReadResult<NoteItemV1>> {
  const notes = world.world.platform.notes;
  if (notes === undefined) throw new Error('XWS2P: the platform publishes no notes owner');
  return await notes.readNote(workspace.ctx, { noteId });
}

/** `notes/list` by one anchor in the given workspace. */
export async function listXWS2PNotes(world: XWS2PWorld, workspace: XWS2PWorkspace,
  anchor: NoteAnchorV1): Promise<ReadResult<NoteListResultV1>> {
  return await world.world.dispatch('notes/list', workspace.ctx,
    plain(workspace.scope, { anchor, limit: 20, cursor: null })) as ReadResult<NoteListResultV1>;
}

/** `graph/look` with a path target (the project branch) in one workspace. */
export async function lookXWS2P(world: XWS2PWorld, workspace: XWS2PWorkspace, path: string):
Promise<ReadResult<GraphReadPageV1<NodeCardV1>>> {
  return await world.world.dispatch('graph/look', workspace.ctx, plain(workspace.scope, {
    goalRef: null, target: { kind: 'path', path }, relation: 'card', page: { afterCursor: null, limit: 100 },
  })) as ReadResult<GraphReadPageV1<NodeCardV1>>;
}

/** `graph/find` (the project branch) in one workspace. */
export async function findXWS2P(world: XWS2PWorld, workspace: XWS2PWorkspace, needle: string):
Promise<ReadResult<GraphReadPageV1<NodeCardV1>>> {
  return await world.world.dispatch('graph/find', workspace.ctx, plain(workspace.scope, {
    goalRef: null, needle, page: { afterCursor: null, limit: 100 },
  })) as ReadResult<GraphReadPageV1<NodeCardV1>>;
}
