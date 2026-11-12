/**
 * KLS-2: the knowledge lines a test that builds an architecture or note service
 * directly hands it. It is the real `createKnowledgeLines` over the test's own
 * temporary root for one (project, workspace); any other workspace is not
 * registered there. Every service of one test world takes the same root, so a
 * write through one is read through another: the write queue and the memory
 * knowledge index are shared per (root, project) as well. The write logs'
 * completion commits to the records the test hands in; there is no Host, so the
 * checkout leases are always owned.
 */
import { randomBytes } from 'node:crypto';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { KnowledgeIndex } from '../../src/core/record-store/knowledge-index-ports.js';
import { createKnowledgeIndex } from '../../src/core/record-store/sqlite-knowledge-index.js';
import { openKnowledgeSnapshots } from '../../src/core/record-store/sqlite-knowledge-snapshots.js';
import { createKnowledgeLines, knowledgeLeaseOf } from '../../src/composition/line-knowledge.js';
import { knowledgeConflictsOf } from '../../src/core/work-graph/architecture/architecture-file.js';
import { readCatalogAdopted } from '../../src/core/work-graph/architecture/catalog-service.js';
import { notifyProject } from '../../src/core/work-graph/communication/project-notice-service.js';
import { createKnowledgeWriteQueue } from '../../src/core/work-graph/knowledge/write-queue.js';
import type { KnowledgeOpsPort } from '../../src/core/work-graph/model/knowledge-ops.js';
import type {
  KnowledgeCaller, KnowledgeLines, KnowledgeWriteDeps, KnowledgeWriteQueue,
} from '../../src/core/work-graph/model/line-knowledge.js';
import { knowledgeFileRules } from '../../src/core/work-graph/notes/knowledge-files.js';
import { indexKnowledgeFile } from '../../src/core/work-graph/notes/note-knowledge.js';
import { noteFileBytes } from '../../src/core/work-graph/notes/note-file.js';

/** The records a fixture's knowledge lines read note heads from and commit the write logs' completion to. */
export type KnowledgeFixtureRecords = GoalRecordTransactionPort & RecordLookupPort;

const shared = new Map<string, { queue: KnowledgeWriteQueue; index: KnowledgeIndex }>();

/** A fixture's knowledge write dependencies: its records, the platform's own file rules, no Host (leases owned), a
 *  memory snapshot store per project kept open. */
function writeDepsOver(records: KnowledgeFixtureRecords, queue: KnowledgeWriteQueue,
  indexOf: (projectId: string) => KnowledgeIndex): KnowledgeWriteDeps {
  const now = () => new Date().toISOString();
  const snapshots = new Map<string, ReturnType<typeof openKnowledgeSnapshots>>();
  const openSnapshots = (projectId: string) => {
    const kept = snapshots.get(projectId) ?? openKnowledgeSnapshots(null);
    snapshots.set(projectId, kept);
    return { ...kept, close: () => undefined };
  };
  return { queue, indexOf, indexFile: indexKnowledgeFile, openSnapshots, records, files: knowledgeFileRules,
    acquireLease: knowledgeLeaseOf(undefined), hold: null, newId: () => randomBytes(16).toString('hex'), now,
    notify: input => notifyProject({ records, now }, input), conflictsOf: knowledgeConflictsOf,
    catalogAdopted: projectId => readCatalogAdopted(records, projectId) };
}

export function knowledgeLinesFor(input: { root: string; projectId: string; workspaceId: string;
  records: KnowledgeFixtureRecords }): KnowledgeLines {
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
  }, { records: input.records }, writeDepsOver(input.records, queue, () => index));
}

/**
 * KLS-2b: the knowledge lines over a fixture's own workspace host (an evidence service built directly takes
 * them); a fixture without a host has no knowledge files, and any line read is unavailable.
 */
export function knowledgeLinesOver(records: KnowledgeFixtureRecords,
  host?: Pick<WorkspaceHostBindings, 'resolveRoot'>): KnowledgeLines {
  return createKnowledgeLines({
    resolveRoot: async workspace => host === undefined
      ? { status: 'rejected', code: 'not_found', reason: 'the fixture has no knowledge files' } : host.resolveRoot(workspace),
  }, { records }, memoryWriteDeps(records));
}

/** A write queue and one memory knowledge index per project, for one knowledge-lines instance. */
function memoryWriteDeps(records: KnowledgeFixtureRecords): KnowledgeWriteDeps {
  const indexes = new Map<string, KnowledgeIndex>();
  return writeDepsOver(records, createKnowledgeWriteQueue(), (projectId: string) => {
    const index = indexes.get(projectId) ?? createKnowledgeIndex(projectId, null);
    indexes.set(projectId, index);
    return index;
  });
}
/**
 * KLS-2b: the knowledge lines over a registry of roots keyed `JSON.stringify([projectId, workspaceId])`, read when a
 * line is used (a fixture registers a workspace it adds later). A project with registered workspaces lists them in
 * registration order, the first the main one; any other project has only the caller's workspace, as without a Host
 * (`knowledgeLinesOver` over the same roots). Only the listed lines need the workspace list neither helper takes.
 */
export function knowledgeLinesOfRoots(roots: ReadonlyMap<string, string>,
  records: KnowledgeFixtureRecords): KnowledgeLines {
  const registered = (projectId: string): string[] => [...roots.keys()].map(key => JSON.parse(key) as [string, string])
    .filter(([owner]) => owner === projectId).map(([, workspaceId]) => workspaceId);
  const resolveRoot: WorkspaceHostBindings['resolveRoot'] = async workspace => {
    const root = roots.get(JSON.stringify([workspace.projectId, workspace.workspaceId]));
    return root === undefined ? { status: 'rejected', code: 'not_found', reason: 'no knowledge root for this workspace' }
      : { status: 'ready', value: { root, workspaceRevision: 0 } };
  };
  const listed = createKnowledgeLines({ resolveRoot, workspacesOf: registered }, { records }, memoryWriteDeps(records));
  const single = knowledgeLinesOver(records, { resolveRoot });
  const of = (caller: KnowledgeCaller): KnowledgeLines => registered(caller.projectId).length > 0 ? listed : single;
  return { write: listed.write, workspaces: caller => of(caller).workspaces(caller),
    line: (caller, workspaceId) => of(caller).line(caller, workspaceId), project: caller => of(caller).project(caller) };
}

/**
 * A note file a person put in a single-workspace project's knowledge folder, taken into the platform's index the
 * public way, by the platform's knowledge reconciliation, so the note has a file and no record head ([2B-16]).
 * Returns the reconciliation's answer.
 */
export async function fileNoteWithoutRecord(input: { root: string; caller: CoreCallContext; workspaceId: string;
  knowledge: KnowledgeOpsPort; noteId: string; note: Parameters<typeof noteFileBytes>[0] }):
Promise<Awaited<ReturnType<KnowledgeOpsPort['reconcile']>>> {
  const path = `.workbench/notes/${input.workspaceId}/${input.noteId}.md`;
  const bytes = noteFileBytes(input.note, { workspaceId: input.workspaceId, mainWorkspaceId: input.workspaceId });
  if (bytes.status !== 'decoded') throw new Error(`fileNoteWithoutRecord note file: ${bytes.reason}`);
  await mkdir(dirname(join(input.root, path)), { recursive: true });
  await writeFile(join(input.root, path), bytes.value);
  return input.knowledge.reconcile(input.caller, input.workspaceId, 'idle');
}
