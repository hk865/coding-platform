/**
 * The knowledge files of one line (a workspace's current checkout): the port a
 * service reads and writes `<folder>/.workbench/` through. Services get a
 * `KnowledgeLines` from the composition root and never resolve a line
 * themselves; the composition root implements both interfaces.
 */
import type { AdoptedArchitecture, ModuleContainment } from '../../../contracts/architecture-catalog.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { KnowledgeConflictV1 } from '../../../contracts/knowledge.js';
import type {
  CatalogRepairOpV1, FlowPayloadV1, LinkEvidenceRoleV1, LinkPayloadV1, NoteFactV1, NoteHeadSnapshot, NoteKind,
  NoteSectionsV1, NoteSourceV1, SemanticRelationV1, SymbolRequestV1,
} from '../../../contracts/note.js';
import type { NotifyProjectInputV1, ProjectNoticeV1 } from '../../../contracts/role-lines.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { DecodeResult, EncodedDomainEvent, GoalRecordTransactionPort, StoreResult } from '../../record-store/ports.js';
import type { KnowledgeFileKind, KnowledgeIndex, KnowledgeIndexTx } from '../../record-store/knowledge-index-ports.js';
import type { KnowledgeSnapshots } from '../../record-store/knowledge-snapshot-ports.js';

/** git: realpath(git rev-parse --git-common-dir); not git: realpath(the workspace root). */
export type RepoKey = string;
/** `folder` = realpath(the registered workspace root), `.workbench/` lives under it; `branch`: '' when not git, 'HEAD' when detached. */
export type LineRef = { repoKey: RepoKey; folder: string; branch: string };
export type KnowledgeLineScope = { workspaceId: string; mainWorkspaceId: string };

/** The line key of the index, snapshots, write log and pins: the workspace and the branch. */
export function lineRefKey(scope: KnowledgeLineScope, line: LineRef): string {
  return canonicalJson([scope.workspaceId, line.branch]);
}
/** The workspace of a line key (`lineRefKey`). */
export function lineRefWorkspaceId(lineRef: string): string {
  return (JSON.parse(lineRef) as [string, string])[0];
}

/** The baseline fields (only in the main workspace's `architecture.json`). */
export type KnowledgeBaselineV1 = {
  description: string;
  constraints: { name: string; scope: string }[];
  dependencyRules?: { ruleId: string; kind: 'forbid_dependency'; fromModule: string; toModule: string }[];
};
/** One line's architecture files read back in the project view. */
export type KnowledgeArchitecture = {
  /** This workspace's modules and their in-workspace dependencies and containment, validated on the raw ids. */
  catalog: AdoptedArchitecture;
  /** Edges from this workspace's modules to other workspaces (project view); the far end is checked at the merge. */
  crossWorkspace: { dependencies: AdoptedArchitecture['dependencies']; parentOf: ModuleContainment['parentOf'] };
  /** Only the main workspace's file has one; `null` for every other workspace. */
  baseline: KnowledgeBaselineV1 | null;
};

/** An anchor in a file: only the three knowledge anchors; a file anchor carries no resolved symbol. */
export type KnowledgeAnchorV1 =
  | { kind: 'module'; moduleId: string }
  | { kind: 'interface'; moduleId: string; interfaceId: string }
  | { kind: 'file'; path: string; deleted?: true };
/** A fact in a file: a file fact carries no digest, the others are `NoteFactV1` as they are. */
export type KnowledgeFactV1 = Exclude<NoteFactV1, { kind: 'file' }> | { kind: 'file'; path: string };
/** A link's locating input: no symbol, file digest, digest basis, analysis configuration or verification. */
export type KnowledgeLinkV1 = {
  relation: SemanticRelationV1;
  ends: LinkPayloadV1['ends'];
  key: { kind: 'symbol'; path: string; symbolRequest: SymbolRequestV1 } | { kind: 'literal'; text: string } | null;
  evidence: { role: LinkEvidenceRoleV1;
    at: { path: string; symbolRequest?: SymbolRequestV1; range?: { startLine: number; endLine: number } } }[];
};
/** A repair's intent: the ops only; the pin and responsibility moves stay in the record for the local activation. */
export type KnowledgeRepairV1 = { ops: CatalogRepairOpV1[] };
/** A note's knowledge fields (project view). */
export type NoteKnowledgeV1 = {
  kind: NoteKind; source: NoteSourceV1; topic: string; conclusion: string; body: string;
  sections?: NoteSectionsV1;
  anchor: KnowledgeAnchorV1; extraAnchors: KnowledgeAnchorV1[];
  structural: boolean; facts: KnowledgeFactV1[]; basisFiles: string[];
  replaces: string[]; contradicts: string[]; coexistWith: string[];
  link?: KnowledgeLinkV1; flow?: FlowPayloadV1; repair?: KnowledgeRepairV1;
};
/** One note file read back: its id, path, blob and knowledge. */
export type LineNoteFileV1 = {
  /** Only from the file name. */
  noteId: string;
  /** Relative to the line's folder: `.workbench/notes/<workspaceId>/<noteId>.md`. */
  path: string;
  /** The file bytes' git blob id in this line's object format. */
  blobSha: string;
  knowledge: NoteKnowledgeV1;
};
/** One note read back: the file plus this project's runtime state (`null` when it has none). */
export type LineNoteV1 = LineNoteFileV1 & { head: NoteHeadSnapshot | null };

/** One knowledge file on disk as a reconciliation finds it. */
export type KnowledgeDiskFileV1 = {
  /** Relative to the line's folder, starting with `.workbench/`. */
  path: string;
  /** By its path (`knowledgeFileKindOf`). */
  kind: KnowledgeFileKind;
  bytes: Uint8Array;
  /** The bytes' git blob id in this line's object format. */
  blobSha: string;
  /** Clean and tracked in git; false when untracked, ignored, changed or staged, and always false when the folder is
   *  not git or git fails. */
  committed: boolean;
  /** The path's blob in HEAD; null when HEAD has none, the folder is not git or git fails. */
  headBlob: string | null;
};

/** One file change computed before the commit. */
export type KnowledgeFileChange = {
  /** Relative to the line's folder, starting with `.workbench/`. */
  path: string;
  /** The file's bytes when the change was computed; `null` when it did not exist. */
  before: Uint8Array | null;
  /** The complete bytes to write; `null` deletes the file. */
  after: Uint8Array | null;
};

export interface LineKnowledge {
  readonly projectId: string;
  readonly line: LineRef;
  readonly scope: KnowledgeLineScope;
  readonly objectFormat: 'sha1' | 'sha256';
  /** `architecture.json` and `modules/*.json` of this line: file frame in, project view out; one bad file or conflict makes the whole read unavailable with the paths. */
  readArchitecture(): Promise<StoreResult<KnowledgeArchitecture>>;
  /**
   * The note files of these ids on this line (no record read: a caller that holds the heads already); an id with no
   * file is left out. A bad file or one id with two files is unavailable with the ids and paths; with `leave_out`
   * (2c-1d: the decision queue's waiting notes) that note is left out instead. A notes directory that cannot be listed
   * is unavailable either way.
   */
  readNoteFiles(noteIds: readonly string[], unreadable?: 'unavailable' | 'leave_out'): Promise<StoreResult<LineNoteFileV1[]>>;
  /** `readNoteFiles` with this project's runtime state (one record `readMany`); an id with no file is left out (the caller judges it). */
  readNotesById(noteIds: readonly string[]): Promise<StoreResult<LineNoteV1[]>>;
  /** Before the commit: from the whole project view, the architecture file changes of this line (the partition and the file names are decided here). Writes nothing. */
  writeModule(input: AdoptedArchitecture, baseline: KnowledgeBaselineV1): Promise<StoreResult<KnowledgeFileChange[]>>;
  /** Before the commit: this note's file change (an empty list when the bytes are unchanged). Writes nothing. */
  writeNote(input: NoteKnowledgeV1, noteId: string): Promise<StoreResult<KnowledgeFileChange[]>>;
  /** After the commit: apply one change (write or delete). */
  applyChange(change: KnowledgeFileChange): Promise<StoreResult<void>>;
  /**
   * [2C1-11]: the line's knowledge files (`architecture.json`, `modules/*.json`, the note files; never `local/` or a
   * `*.tmp-*`), by path, each with its bytes, blob and git state; and the platform's leftover temporary files.
   * Unavailable when a directory or a file cannot be read (a file that reads but does not parse is not a failure
   * here: the index reports it).
   */
  readKnowledgeFiles(): Promise<StoreResult<{ files: KnowledgeDiskFileV1[]; temporaries: string[] }>>;
  /**
   * [2C1-17] step 8: `readArchitecture` over files `readKnowledgeFiles` already read, never the disk again, so one
   * reconciliation judges one state of the files (stk16: a person's edit landing mid-round made a second notice).
   */
  architectureOfDisk(files: readonly KnowledgeDiskFileV1[]): StoreResult<KnowledgeArchitecture>;
}

/** The caller a service holds; `CoreCallContext` is structurally one. */
export type KnowledgeCaller = { projectId: string; workspaceId?: string };
/** The in-process knowledge write queue: by project first, then by every folder (sorted). One per Host. */
export type KnowledgeWriteQueue = {
  run<T>(projectId: string, folders: readonly string[], work: () => Promise<T>): Promise<T>;
};
/**
 * The one file indexer (`indexKnowledgeFile`). The note and architecture file parsers live above `knowledge/`,
 * so the composition root hands it in and the write order calls it once the files landed.
 */
export type KnowledgeFileIndexer = (tx: KnowledgeIndexTx, line: LineKnowledge, path: string, bytes: Uint8Array | null) =>
  DecodeResult<{ kind: KnowledgeFileKind; blobSha: string | null }>;
/** The cross-Host lease of one checkout (`HostInstanceLease` is structurally one). */
export type KnowledgeWriteLease = { lease: 'owned' | 'held_by_other'; reason: string; release(): Promise<void> };
/** The test seam's two named points: `committed` = the records committed, no file written yet; `applied` = every file
 *  landed, the completion not yet committed. */
export type KnowledgeWriteHoldPoint = 'committed' | 'applied';
/** The knowledge-file rules above `knowledge/` (`notes/knowledge-files.ts`), handed in by the composition root. */
export type KnowledgeFileRules = {
  /** The index in `events` of the event that carries this file's content; throws when none does (a programming error). */
  carrierEventIndex(events: readonly EncodedDomainEvent[], path: string): number;
  /** A write log's kind and, for a module file, the module (project view) its bytes name. */
  writeLogFileOf(scope: KnowledgeLineScope, path: string, bytes: Uint8Array): { kind: KnowledgeFileKind; moduleId: string | null };
  /**
   * [2C1-02]: a logged file (`target.moduleId` is the log's) rebuilt from the event that carries it, on the current
   * file (`current`, null when there is none); null deletes. Only a recovery calls it ([2C1-21]).
   */
  knowledgeFileOfEvent(event: EncodedDomainEvent, scope: KnowledgeLineScope, target: { path: string; moduleId: string | null },
    current: Uint8Array | null): DecodeResult<Uint8Array | null>;
};
/** The dependencies one knowledge write uses. */
export type KnowledgeWriteDeps = {
  readonly queue: KnowledgeWriteQueue;
  /** The project's index (one per project: a platform built without a Host may serve several). */
  readonly indexOf: (projectId: string) => KnowledgeIndex;
  readonly indexFile: KnowledgeFileIndexer;
  /**
   * The project store's records: the write logs' completion, the reconciliation's reads, the recovery's event read
   * and 2c-1d's in-flight checks (`pendingKnowledgeWrites`).
   */
  readonly records: Pick<GoalRecordTransactionPort, 'readMany' | 'commit' | 'eventAt'> & RecordLookupPort;
  readonly files: KnowledgeFileRules;
  /**
   * The checkout's cross-Host lease (its directory follows from the line). A platform built without a Host is always
   * `owned`; through a Host the lease directory is made first, and when it cannot be made the promise rejects (the
   * caller answers `unavailable`, never "another Host is writing").
   */
  acquireLease(line: LineRef): Promise<KnowledgeWriteLease>;
  /** Test seam; null in production. */
  readonly hold: ((point: KnowledgeWriteHoldPoint) => Promise<void>) | null;
  /** A write log id: 16 random bytes as hex. */
  newId(): string;
  now(): string;
  /** The project notice (`notifyProject` over this store's records). */
  readonly notify: (input: NotifyProjectInputV1) => Promise<WriteResult<ProjectNoticeV1>>;
  /**
   * The project's knowledge snapshots and recovery items. A memory store keeps one per project open with the
   * platform (its `close` keeps it open); a SQLite store opens the project store's file on each call, and the caller
   * closes it when done.
   */
  openSnapshots(projectId: string): KnowledgeSnapshots;
  /** The semantic conflicts of one line's module files (`knowledgeConflictsOf`, pure). */
  readonly conflictsOf: (modules: readonly { path: string; bytes: Uint8Array }[], scope: KnowledgeLineScope) =>
    readonly KnowledgeConflictV1[];
  /**
   * [2C1-17] step 8 (b2 Astra 1): whether the project's records ever adopted an architecture (`readCatalogAdopted`);
   * a failed read is a rejection, never `false`.
   */
  readonly catalogAdopted: (projectId: string) => Promise<{ status: 'ready'; value: boolean } | CoreRejection>;
};
/** The one knowledge entry a service gets (injected by the composition root, required in the service's dependencies). */
export interface KnowledgeLines {
  /** The project's workspace ids, the main one first; a platform without a Host list has only `caller.workspaceId`. */
  workspaces(caller: KnowledgeCaller): Promise<StoreResult<readonly string[]>>;
  /** The line a workspace has checked out now. */
  line(caller: KnowledgeCaller, workspaceId: string): Promise<StoreResult<LineKnowledge>>;
  /** The lines of every workspace of the project, in `workspaces` order. */
  project(caller: KnowledgeCaller): Promise<StoreResult<readonly LineKnowledge[]>>;
  readonly write: KnowledgeWriteDeps;
}
