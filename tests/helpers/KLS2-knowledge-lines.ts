/**
 * KLS-2: the knowledge lines a test that builds an architecture or note service
 * directly hands it. It is the real `createKnowledgeLines` over the test's own
 * temporary root for one (project, workspace); any other workspace is not
 * registered there. Every service of one test world takes the same root, so a
 * write through one is read through another: the write queue and the memory
 * knowledge index are shared per (root, project) as well.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { KnowledgeIndex } from '../../src/core/record-store/knowledge-index-ports.js';
import { createKnowledgeIndex } from '../../src/core/record-store/sqlite-knowledge-index.js';
import { createKnowledgeLines } from '../../src/composition/line-knowledge.js';
import { createKnowledgeWriteQueue } from '../../src/core/work-graph/knowledge/write-queue.js';
import type { KnowledgeCaller, KnowledgeLines, KnowledgeWriteQueue } from '../../src/core/work-graph/model/line-knowledge.js';
import { indexKnowledgeFile } from '../../src/core/work-graph/notes/note-knowledge.js';
import { noteFileBytes } from '../../src/core/work-graph/notes/note-file.js';

const shared = new Map<string, { queue: KnowledgeWriteQueue; index: KnowledgeIndex }>();

export function knowledgeLinesFor(input: { root: string; projectId: string; workspaceId: string;
  records: Pick<GoalRecordTransactionPort, 'readMany'> }): KnowledgeLines {
  const key = JSON.stringify([input.root, input.projectId]);
  let world = shared.get(key);
  if (world === undefined) {
    world = { queue: createKnowledgeWriteQueue(), index: createKnowledgeIndex(input.projectId, null) };
    shared.set(key, world);
  }
  const { queue, index } = world;
  return createKnowledgeLines({
    resolveRoot: async workspace => workspace.projectId === input.projectId && workspace.workspaceId === input.workspaceId
      ? { status: 'ready', value: { root: input.root, workspaceRevision: 0 } }
      : { status: 'rejected', code: 'not_found', reason: 'the workspace is not the fixture workspace' },
  }, { records: input.records }, { queue, indexOf: () => index, indexFile: indexKnowledgeFile });
}

/**
 * KLS-2b: the knowledge lines over a fixture's own workspace host (an evidence service built directly takes
 * them); a fixture without a host has no knowledge files, and any line read is unavailable.
 */
export function knowledgeLinesOver(records: Pick<GoalRecordTransactionPort, 'readMany'>,
  host?: Pick<WorkspaceHostBindings, 'resolveRoot'>): KnowledgeLines {
  return createKnowledgeLines({
    resolveRoot: async workspace => host === undefined
      ? { status: 'rejected', code: 'not_found', reason: 'the fixture has no knowledge files' } : host.resolveRoot(workspace),
  }, { records }, memoryWriteDeps());
}

/** A write queue and one memory knowledge index per project, for one knowledge-lines instance. */
function memoryWriteDeps() {
  const indexes = new Map<string, KnowledgeIndex>();
  return { queue: createKnowledgeWriteQueue(), indexFile: indexKnowledgeFile, indexOf: (projectId: string) => {
    const index = indexes.get(projectId) ?? createKnowledgeIndex(projectId, null);
    indexes.set(projectId, index);
    return index;
  } };
}
/**
 * KLS-2b: the knowledge lines over a registry of roots keyed `JSON.stringify([projectId, workspaceId])`, read when a
 * line is used (a fixture registers a workspace it adds later). A project with registered workspaces lists them in
 * registration order, the first the main one; any other project has only the caller's workspace, as without a Host
 * (`knowledgeLinesOver` over the same roots). Only the listed lines need the workspace list neither helper takes.
 */
export function knowledgeLinesOfRoots(roots: ReadonlyMap<string, string>,
  records: Pick<GoalRecordTransactionPort, 'readMany'>): KnowledgeLines {
  const registered = (projectId: string): string[] => [...roots.keys()].map(key => JSON.parse(key) as [string, string])
    .filter(([owner]) => owner === projectId).map(([, workspaceId]) => workspaceId);
  const resolveRoot: WorkspaceHostBindings['resolveRoot'] = async workspace => {
    const root = roots.get(JSON.stringify([workspace.projectId, workspace.workspaceId]));
    return root === undefined ? { status: 'rejected', code: 'not_found', reason: 'no knowledge root for this workspace' }
      : { status: 'ready', value: { root, workspaceRevision: 0 } };
  };
  const listed = createKnowledgeLines({ resolveRoot, workspacesOf: registered }, { records }, memoryWriteDeps());
  const single = knowledgeLinesOver(records, { resolveRoot });
  const of = (caller: KnowledgeCaller): KnowledgeLines => registered(caller.projectId).length > 0 ? listed : single;
  return { write: listed.write, workspaces: caller => of(caller).workspaces(caller),
    line: (caller, workspaceId) => of(caller).line(caller, workspaceId), project: caller => of(caller).project(caller) };
}

/** The knowledge index of each project the platform opens, kept through the platform's `knowledgeIndexFactory` seam. */
export function capturedKnowledgeIndexes(): { factory: (projectId: string, path: string | null) => KnowledgeIndex;
  indexOf: (projectId: string) => KnowledgeIndex } {
  const indexes = new Map<string, KnowledgeIndex>();
  return {
    factory: (projectId, path) => {
      const index = createKnowledgeIndex(projectId, path);
      indexes.set(projectId, index);
      return index;
    },
    indexOf: projectId => {
      const index = indexes.get(projectId);
      if (index === undefined) throw new Error(`the platform has not opened the knowledge index of ${projectId}`);
      return index;
    },
  };
}

/**
 * Named F3 exception (KLS-2b ruling 10, F-37): a note file a person put in a line's knowledge folder, taken into the
 * platform's own index by the platform's indexer, so the note has a file and no record head ([2B-16]). 2b has no
 * public step that makes such a note; replace this with the public path once 2c-1's reconciliation lands. Returns the
 * indexer's answer.
 */
export async function fileNoteWithoutRecord(input: { root: string; caller: KnowledgeCaller; workspaceId: string;
  index: KnowledgeIndex; noteId: string; note: Parameters<typeof noteFileBytes>[0] }):
Promise<ReturnType<typeof indexKnowledgeFile>> {
  const lines = createKnowledgeLines(
    { resolveRoot: async () => ({ status: 'ready', value: { root: input.root, workspaceRevision: 1 } }) },
    { records: { readMany: async () => { throw new Error('opening a line reads no record'); } } },
    { queue: createKnowledgeWriteQueue(), indexOf: () => input.index, indexFile: indexKnowledgeFile });
  const line = await lines.line(input.caller, input.workspaceId);
  if (line.status !== 'ready') throw new Error(`fileNoteWithoutRecord line: ${JSON.stringify(line)}`);
  const path = `.workbench/notes/${input.workspaceId}/${input.noteId}.md`;
  const bytes = noteFileBytes(input.note, line.value.scope);
  if (bytes.status !== 'decoded') throw new Error(`fileNoteWithoutRecord note file: ${bytes.reason}`);
  await mkdir(dirname(join(input.root, path)), { recursive: true });
  await writeFile(join(input.root, path), bytes.value);
  return input.index.transaction(tx => indexKnowledgeFile(tx, line.value, path, bytes.value));
}
