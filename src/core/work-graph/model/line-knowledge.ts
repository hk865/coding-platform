/**
 * The knowledge files of one line (a workspace's current checkout): the port a
 * service reads and writes `<folder>/.workbench/` through. Services get a
 * `KnowledgeLines` from the composition root and never resolve a line
 * themselves; the composition root implements both interfaces.
 */
import type { AdoptedArchitecture, ModuleContainment } from '../../../contracts/architecture-catalog.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type {
  CatalogRepairOpV1, FlowPayloadV1, LinkEvidenceRoleV1, LinkPayloadV1, NoteFactV1, NoteHeadSnapshot, NoteKind,
  NoteSectionsV1, NoteSourceV1, SemanticRelationV1, SymbolRequestV1,
} from '../../../contracts/note.js';
import type { StoreResult } from '../../record-store/ports.js';

/** git: realpath(git rev-parse --git-common-dir); not git: realpath(the workspace root). */
export type RepoKey = string;
/** `folder` = realpath(the registered workspace root), `.workbench/` lives under it; `branch`: '' when not git, 'HEAD' when detached. */
export type LineRef = { repoKey: RepoKey; folder: string; branch: string };
export type KnowledgeLineScope = { workspaceId: string; mainWorkspaceId: string };

/** The line key of the index, snapshots, write log and pins: the workspace and the branch. */
export function lineRefKey(scope: KnowledgeLineScope, line: LineRef): string {
  return canonicalJson([scope.workspaceId, line.branch]);
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
/** One note read back: the file's knowledge plus this project's runtime state (`null` when it has none). */
export type LineNoteV1 = {
  /** Only from the file name. */
  noteId: string;
  /** Relative to the line's folder: `.workbench/notes/<workspaceId>/<noteId>.md`. */
  path: string;
  /** The file bytes' git blob id in this line's object format. */
  blobSha: string;
  knowledge: NoteKnowledgeV1;
  head: NoteHeadSnapshot | null;
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
  /** The notes of these ids that have a file on this line, with this project's runtime state; an id with no file is left out (the caller judges it). A bad file or one id with two files is unavailable with the ids and paths. */
  readNotesById(noteIds: readonly string[]): Promise<StoreResult<LineNoteV1[]>>;
  /** Before the commit: from the whole project view, the architecture file changes of this line (the partition and the file names are decided here). Writes nothing. */
  writeModule(input: AdoptedArchitecture, baseline: KnowledgeBaselineV1): Promise<StoreResult<KnowledgeFileChange[]>>;
  /** Before the commit: this note's file change (an empty list when the bytes are unchanged). Writes nothing. */
  writeNote(input: NoteKnowledgeV1, noteId: string): Promise<StoreResult<KnowledgeFileChange[]>>;
  /** After the commit: apply one change (write or delete). */
  applyChange(change: KnowledgeFileChange): Promise<StoreResult<void>>;
}

/** The caller a service holds; `CoreCallContext` is structurally one. */
export type KnowledgeCaller = { projectId: string; workspaceId?: string };
/** The dependencies one knowledge write uses; empty until the write queue and the write log add theirs. */
export type KnowledgeWriteDeps = Readonly<Record<never, never>>;
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
