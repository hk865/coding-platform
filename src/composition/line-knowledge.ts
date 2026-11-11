/**
 * The knowledge files of a line on disk: the one
 * resolution of (project, workspace) to a line, the line's reads and the
 * pre-commit change computation, and the post-commit file writes. `node:fs` for
 * knowledge lives only here; the WorkGraph services reach it through the
 * `KnowledgeLines` port the composition root injects.
 *
 * Only regular files under `.workbench/` are read (`local/` and anything else
 * is never touched); the platform writes only regular files. A read failure,
 * a missing `architecture.json`, a bad file or a conflict is `unavailable`
 * with the paths, never an empty catalog or no notes.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { rejected } from '../contracts/core/rejections.js';
import { messageOf } from '../contracts/error-message.js';
import { KNOWLEDGE_DIRECTORY } from '../contracts/knowledge.js';
import type { GoalRecordTransactionPort, StoreResult } from '../core/record-store/ports.js';
import type { WorkspaceHostBindings } from '../core/workspace/access.js';
import {
  gitBlobId, identifyCheckout, readCheckoutBranch, type CheckoutProbe,
} from '../core/workspace/workspace-change-capture.js';
import {
  ARCHITECTURE_FILE_PATH, architectureFilesOf, architectureOfFiles, moduleFileIdOf,
} from '../core/work-graph/architecture/architecture-file.js';
import type {
  KnowledgeCaller, KnowledgeFileChange, KnowledgeLineScope, KnowledgeLines, KnowledgeWriteDeps, LineKnowledge,
  LineNoteV1, LineRef,
} from '../core/work-graph/model/line-knowledge.js';
import { noteFileBytes, noteIdFromFilePath, noteOfFileBytes } from '../core/work-graph/notes/note-file.js';
import { decodeNoteHeadSnapshot, noteHeadRefKey } from '../core/work-graph/persistence/note-record-codecs.js';

export type KnowledgeWorkspaceSource = {
  resolveRoot: WorkspaceHostBindings['resolveRoot'];
  /** The Host's list (the main workspace first); a platform not built by a Host gives none. */
  workspacesOf?: (projectId: string) => readonly string[];
};
export type LineKnowledgeDeps = { records: Pick<GoalRecordTransactionPort, 'readMany'> };

const MODULES_DIRECTORY = `${KNOWLEDGE_DIRECTORY}/modules`;
const NOTES_DIRECTORY = `${KNOWLEDGE_DIRECTORY}/notes`;

function unavailable(reason: string): StoreResult<never> { return rejected('unavailable', reason); }
function ready<T>(value: T): StoreResult<T> { return { status: 'ready', value }; }

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(right);
}

function workspaceListOf(source: KnowledgeWorkspaceSource, caller: KnowledgeCaller): StoreResult<readonly string[]> {
  if (source.workspacesOf !== undefined) {
    const listed = source.workspacesOf(caller.projectId);
    return listed.length === 0 ? unavailable(`the project ${caller.projectId} has no registered workspace`) : ready(listed);
  }
  // A platform without the Host's list serves a single-workspace project: the caller's workspace is the main one.
  return caller.workspaceId === undefined
    ? unavailable('the knowledge line needs a workspace and the call context names none')
    : ready([caller.workspaceId]);
}

async function resolveWith(source: KnowledgeWorkspaceSource, caller: KnowledgeCaller, workspaceId: string,
  probe: (root: string) => Promise<CheckoutProbe>):
  Promise<StoreResult<{ line: LineRef; scope: KnowledgeLineScope; objectFormat: 'sha1' | 'sha256' }>> {
  const listed = workspaceListOf(source, caller);
  if (listed.status !== 'ready') return listed;
  if (!listed.value.includes(workspaceId)) {
    return unavailable(`the workspace ${workspaceId} is not registered in the project ${caller.projectId}`);
  }
  const resolved = await source.resolveRoot({ aggregateType: 'Workspace', projectId: caller.projectId, workspaceId });
  if (resolved.status !== 'ready') {
    return unavailable(`the root of the workspace ${workspaceId} cannot be resolved: ${resolved.code}: ${resolved.reason}`);
  }
  let checkout: CheckoutProbe;
  try {
    checkout = await probe(resolved.value.root);
  } catch (error) {
    return unavailable(`the workspace root ${resolved.value.root} cannot be read: ${messageOf(error)}`);
  }
  const scope = { workspaceId, mainWorkspaceId: listed.value[0]! };
  return ready(checkout.kind === 'git'
    ? { line: { repoKey: checkout.repoKey, folder: checkout.folder, branch: checkout.branch }, scope,
      objectFormat: checkout.objectFormat }
    : { line: { repoKey: checkout.folder, folder: checkout.folder, branch: '' }, scope, objectFormat: 'sha1' });
}

/** The ONE resolution of (projectId, workspaceId) to its line (the root and its current branch) and its place in the project. */
export async function resolveKnowledgeLine(source: KnowledgeWorkspaceSource, caller: KnowledgeCaller,
  workspaceId: string): Promise<StoreResult<{ line: LineRef; scope: KnowledgeLineScope; objectFormat: 'sha1' | 'sha256' }>> {
  return resolveWith(source, caller, workspaceId, identifyCheckout);
}

export async function openLineKnowledge(projectId: string, line: LineRef, scope: KnowledgeLineScope,
  objectFormat: 'sha1' | 'sha256', deps: LineKnowledgeDeps): Promise<StoreResult<LineKnowledge>> {
  const absolute = (path: string): string => join(line.folder, path);

  async function bytesAt(path: string): Promise<StoreResult<Uint8Array | null>> {
    try {
      return ready(new Uint8Array(await readFile(absolute(path))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ready(null);
      return unavailable(`${path} cannot be read: ${messageOf(error)}`);
    }
  }
  /** The regular files (or directories) directly in a directory; a missing directory has none. */
  async function entriesOf(directory: string, kind: 'file' | 'directory'): Promise<StoreResult<string[]>> {
    try {
      const entries = await readdir(absolute(directory), { withFileTypes: true });
      return ready(entries.filter(entry => kind === 'file' ? entry.isFile() : entry.isDirectory())
        .map(entry => entry.name).sort());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ready([]);
      return unavailable(`${directory} cannot be listed: ${messageOf(error)}`);
    }
  }
  async function moduleFiles(): Promise<StoreResult<{ path: string; bytes: Uint8Array }[]>> {
    const names = await entriesOf(MODULES_DIRECTORY, 'file');
    if (names.status !== 'ready') return names;
    const files: { path: string; bytes: Uint8Array }[] = [];
    for (const name of names.value.filter(entry => entry.endsWith('.json'))) {
      const path = `${MODULES_DIRECTORY}/${name}`;
      const bytes = await bytesAt(path);
      if (bytes.status !== 'ready') return bytes;
      if (bytes.value !== null) files.push({ path, bytes: bytes.value });
    }
    return ready(files);
  }

  async function readArchitecture(): ReturnType<LineKnowledge['readArchitecture']> {
    const index = await bytesAt(ARCHITECTURE_FILE_PATH);
    if (index.status !== 'ready') return index;
    if (index.value === null) return unavailable(`${ARCHITECTURE_FILE_PATH} does not exist in ${line.folder}`);
    const modules = await moduleFiles();
    if (modules.status !== 'ready') return modules;
    const decoded = architectureOfFiles(index.value, modules.value, scope, projectId);
    return decoded.status === 'decoded' ? ready(decoded.value) : unavailable(decoded.reason);
  }

  async function readNotesById(noteIds: readonly string[]): Promise<StoreResult<LineNoteV1[]>> {
    const wanted = new Set(noteIds);
    if (wanted.size === 0) return ready([]);
    const directories = await entriesOf(NOTES_DIRECTORY, 'directory');
    if (directories.status !== 'ready') return directories;
    const pathsOf = new Map<string, string[]>();
    for (const directory of directories.value) {
      const names = await entriesOf(`${NOTES_DIRECTORY}/${directory}`, 'file');
      if (names.status !== 'ready') return names;
      for (const name of names.value) {
        const path = `${NOTES_DIRECTORY}/${directory}/${name}`;
        const noteId = noteIdFromFilePath(path);
        if (noteId === null || !wanted.has(noteId)) continue;
        pathsOf.set(noteId, [...(pathsOf.get(noteId) ?? []), path]);
      }
    }
    const twice = [...pathsOf].filter(([, paths]) => paths.length > 1);
    if (twice.length > 0) {
      return unavailable(twice.map(([noteId, paths]) => `the note ${noteId} has two files: ${paths.join(', ')}`).join('; '));
    }
    const found = noteIds.filter((noteId, index) => pathsOf.has(noteId) && noteIds.indexOf(noteId) === index);
    const keys = found.map(noteId => noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId }));
    const heads = keys.length === 0 ? null : await deps.records.readMany(keys);
    if (heads !== null && heads.status !== 'ready') return heads;
    const byKey = new Map((heads?.value.records ?? []).map(record => [record.refKey, record]));
    const notes: LineNoteV1[] = [];
    for (const [index, noteId] of found.entries()) {
      const path = pathsOf.get(noteId)![0]!;
      const bytes = await bytesAt(path);
      if (bytes.status !== 'ready') return bytes;
      if (bytes.value === null) return unavailable(`${path} disappeared while it was read`);
      const knowledge = noteOfFileBytes(bytes.value, scope);
      if (knowledge.status !== 'decoded') return unavailable(`${path}: ${knowledge.reason}`);
      const record = byKey.get(keys[index]!);
      const head = record === undefined ? null : decodeNoteHeadSnapshot(record);
      if (head !== null && head.status !== 'decoded') return unavailable(`the note ${noteId} record is damaged: ${head.reason}`);
      notes.push({ noteId, path, blobSha: gitBlobId(bytes.value, objectFormat), knowledge: knowledge.value,
        head: head === null ? null : head.value });
    }
    return ready(notes);
  }

  async function writeModule(input: Parameters<LineKnowledge['writeModule']>[0],
    baseline: Parameters<LineKnowledge['writeModule']>[1]): Promise<StoreResult<KnowledgeFileChange[]>> {
    const files = architectureFilesOf(input, baseline, scope);
    if (files.status !== 'decoded') return rejected('invalid', files.reason);
    const existing = await moduleFiles();
    if (existing.status !== 'ready') return existing;
    // An existing id keeps its file name; a bad file or two files of one id is not guessed around.
    const byId = new Map<string, { path: string; bytes: Uint8Array }>();
    for (const file of existing.value) {
      const read = moduleFileIdOf(file.path, file.bytes);
      if (read.status !== 'decoded') return unavailable(read.reason);
      const id = read.value;
      const other = byId.get(id);
      if (other !== undefined) return unavailable(`two module files carry the id ${id}: ${other.path}, ${file.path}`);
      byId.set(id, file);
    }
    const changes: KnowledgeFileChange[] = [];
    for (const module of files.value.modules) {
      const old = byId.get(module.moduleId);
      byId.delete(module.moduleId);
      if (old !== undefined && sameBytes(old.bytes, module.bytes)) continue;
      changes.push({ path: old?.path ?? `${MODULES_DIRECTORY}/${randomBytes(16).toString('hex')}.json`,
        before: old?.bytes ?? null, after: module.bytes });
    }
    const index = await bytesAt(ARCHITECTURE_FILE_PATH);
    if (index.status !== 'ready') return index;
    if (index.value === null || !sameBytes(index.value, files.value.architecture)) {
      changes.push({ path: ARCHITECTURE_FILE_PATH, before: index.value, after: files.value.architecture });
    }
    for (const gone of byId.values()) changes.push({ path: gone.path, before: gone.bytes, after: null });
    return ready(changes);
  }

  async function writeNote(input: Parameters<LineKnowledge['writeNote']>[0],
    noteId: string): Promise<StoreResult<KnowledgeFileChange[]>> {
    const bytes = noteFileBytes(input, scope);
    if (bytes.status !== 'decoded') return rejected('invalid', bytes.reason);
    const path = `${NOTES_DIRECTORY}/${scope.workspaceId}/${noteId}.md`;
    const before = await bytesAt(path);
    if (before.status !== 'ready') return before;
    if (before.value !== null && sameBytes(before.value, bytes.value)) return ready([]);
    return ready([{ path, before: before.value, after: bytes.value }]);
  }

  async function applyChange(change: KnowledgeFileChange): Promise<StoreResult<void>> {
    const target = absolute(change.path);
    try {
      if (change.after === null) {
        await rm(target, { force: true });
      } else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, change.after);
      }
      return ready(undefined);
    } catch (error) {
      return unavailable(`${change.path} could not be written: ${messageOf(error)}`);
    }
  }

  return ready({ projectId, line, scope, objectFormat,
    readArchitecture, readNotesById, writeModule, writeNote, applyChange });
}

/**
 * The composition root's `KnowledgeLines`. The repo key and object format of a
 * checkout are kept per (project, workspace, real root); the branch is read on
 * every `line()` (one `git symbolic-ref`), since a person may switch it any time.
 */
export function createKnowledgeLines(source: KnowledgeWorkspaceSource, deps: LineKnowledgeDeps,
  write: KnowledgeWriteDeps): KnowledgeLines {
  const checkouts = new Map<string, CheckoutProbe>();
  async function line(caller: KnowledgeCaller, workspaceId: string): Promise<StoreResult<LineKnowledge>> {
    const resolved = await resolveWith(source, caller, workspaceId, async root => {
      const folder = await realpath(root);
      const key = JSON.stringify([caller.projectId, workspaceId, folder]);
      const known = checkouts.get(key);
      if (known === undefined) {
        const probe = await identifyCheckout(folder);
        checkouts.set(key, probe);
        return probe;
      }
      return known.kind === 'git' ? { ...known, branch: await readCheckoutBranch(folder) } : known;
    });
    if (resolved.status !== 'ready') return resolved;
    return openLineKnowledge(caller.projectId, resolved.value.line, resolved.value.scope, resolved.value.objectFormat, deps);
  }
  return {
    workspaces: async caller => workspaceListOf(source, caller),
    line,
    async project(caller) {
      const listed = workspaceListOf(source, caller);
      if (listed.status !== 'ready') return listed;
      const lines: LineKnowledge[] = [];
      for (const workspaceId of listed.value) {
        const opened = await line(caller, workspaceId);
        if (opened.status !== 'ready') return opened;
        lines.push(opened.value);
      }
      return ready(lines);
    },
    write,
  };
}

/** The one maker of `<root>/.workbench/` lives with the workspace layer, so a Work Run's start can call it too. */
export { ensureKnowledgeDirectory } from '../core/workspace/knowledge-exclude.js';
