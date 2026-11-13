/**
 * The code-knowledge files under `<workspace root>/.workbench/`: the shapes that
 * cross the WorkGraph, the composition root and the pages.
 */
import { defineShape, f, type ShapeRule } from './data-format.js';

/** The knowledge directory, relative to a workspace root. */
export const KNOWLEDGE_DIRECTORY = '.workbench';
/** A line's architecture index file, relative to its folder. */
export const ARCHITECTURE_FILE_PATH = `${KNOWLEDGE_DIRECTORY}/architecture.json`;

/** A root-relative path that is the knowledge directory or inside it. */
export function withinKnowledgeDirectory(path: string): boolean {
  return path === KNOWLEDGE_DIRECTORY || path.startsWith(`${KNOWLEDGE_DIRECTORY}/`);
}

/**
 * A semantic conflict among one workspace's (one line's) module files. The
 * read-back gate and the reconcile notice use the same verdict. Only a
 * duplicate id and a dangling reference make a catalog unreadable; a path
 * claimed by two modules is reported but reads and writes go on.
 */
export type KnowledgeConflictV1 = {
  kind: 'duplicate_module_id' | 'path_claimed_by_two_modules' | 'dangling_reference';
  /** Project view; for `dangling_reference` the missing target id. */
  moduleId: string;
  /** The knowledge files involved, relative to the line's folder, sorted. */
  paths: readonly string[];
};

/** Who last wrote a knowledge file (ruling 4-2 A): the platform when its bytes are the projection of the catalog the
 *  records last adopted on that line; otherwise the person's, committed or not by git. */
export type KnowledgeFileSourceV1 = 'platform' | 'committed' | 'uncommitted';
/** Every place one line's knowledge files go wrong; `project_merge` and `other` are the whole-graph verdicts. */
export type KnowledgeProblemKindV1 = 'bad_file' | 'duplicate_module_id' | 'path_claimed_by_two_modules'
  | 'dangling_reference' | 'module_without_file' | 'unreachable' | 'partial_contains' | 'cycle' | 'project_merge' | 'other';
/** One place of a knowledge_conflict notice (KC-1 G3). */
export type KnowledgeProblemV1 = {
  /** 1.., the order of `knowledgeProblemsOf`. */
  itemNo: number;
  kind: KnowledgeProblemKindV1;
  /** The knowledge files involved, relative to the line's folder, sorted. */
  files: readonly { path: string; source: KnowledgeFileSourceV1 }[];
  /** The project view; a dangling reference is `[R, T]`, the others are sorted. */
  moduleIds: readonly string[];
  reason: string;
  /** KC-2: a bad_file row's source; absent when it has none or the row is another kind. */
  recovery?: KnowledgeRecoverySourceV1;
};
/** KC-2 (121-106 ④): where a bad file's "恢复" takes its bytes from, picked once when its notice's rows are written. */
export type KnowledgeRecoverySourceV1 =
  | { source: 'snapshot'; takenAt: string }                       // 快照的 key
  | { source: 'head'; takenAt: string; headBlob: string }         // 这个文件在 HEAD 里最后一次被提交的时间（§9-1）
  | { source: 'record'; moduleId: string | null };                // 模块文件：坏之前那份写的模块（项目视角）；架构和注记为 null
/** KC-1 G2: one file a structural proposal batch would change if approved now; a read-time hint (ruling 4-9). */
export type ProposalBatchFileV1 = {
  workspaceId: string;
  /** Null for a new module file: its name is chosen at approval (ruling 4-9, §9-5). */
  path: string | null;
  /** The project view; null for `architecture.json`. */
  moduleId: string | null;
  action: 'create' | 'modify' | 'delete';
  /** The file's writer now; null for a `create`. */
  source: KnowledgeFileSourceV1 | null;
};

/** What started one reconciliation of a line's knowledge files with the index. */
export type ReconcileTrigger = 'run_end' | 'before_adopt' | 'idle' | 'startup' | 'after_commit' | 'recovery' | 'joined';
/** A knowledge file that could not be read as one (R8): its path and why. */
export type KnowledgeIssueV1 = { path: string; reason: string };
/** One reconciliation of one line. */
export type ReconcileResult = {
  lineRef: string;
  trigger: ReconcileTrigger;
  /** The knowledge files this round found new, changed or deleted against the index. */
  changed: number;
  issues: readonly KnowledgeIssueV1[];
  conflicts: readonly KnowledgeConflictV1[];
  /** The places of this round's `knowledge_conflict` notice; `[]` when it has none (KC-1 G3). */
  problems: readonly KnowledgeProblemV1[];
  /** The recovery items of unconfirmed platform writes this round added. */
  unconfirmed: number;
  /** The recovery items of reverted files this round added. */
  reverted: number;
};
/** One recovery item of a knowledge notice as the page reads it: never the file's content. */
export type KnowledgeRecoveryItemV1 = { itemNo: number; kind: 'write_unconfirmed' | 'reverted' | 'unreadable'; path: string };
/** What a recovery wrote: the file and its blob now; `blobSha` is null when the recovery deleted the file. */
export type KnowledgeRecoverResult = { path: string; blobSha: string | null };

/**
 * Git's view of one line's knowledge directory (`local/` left out). `dirty` counts places: an untracked file is
 * one, any other entry one for each of its index and work-tree sides that changed; `files` counts paths (a rename's
 * new path).
 */
export type KnowledgeLineStatusV1 = { branch: string; head: string | null; dirty: number; files: number };
/** What the prompt and the confirmation of "commit the architecture and notes" read. */
export type KnowledgeCommitStatus = { branch: string; dirty: number; files: number; localOnly: boolean };
/** One commit of the knowledge directory: the full commit id, its branch and the files it took. */
export type KnowledgeCommitResult = { commit: string; branch: string; files: number };
/** L3: one module's smallest fields in a pin (project view); `contains` and `dependsOn` keep only the ids they name. */
export type KnowledgePinModuleV1 = {
  moduleId: string; paths: readonly string[]; responsibility: string;
  contains: readonly string[]; dependsOn: readonly { to: string; reason: string }[];
};
/** L3: one line's pin, from its working-tree bytes. */
export type KnowledgeLinePinV1 = {
  /** `lineRefKey`. */
  lineRef: string;
  /** sha256 of the sorted `<path>\0<gitBlobId>\n` lines of `architecture.json` and `modules/*.json` only. */
  contentHash: string;
  /** Null when the folder is not git (or has no commit yet). */
  head: string | null;
  /** One of those files is not committed (an ignored untracked one too); always true when not git. */
  dirty: boolean;
  /** Null when clean; when dirty, the modules on this line the plan uses. */
  modules: readonly KnowledgePinModuleV1[] | null;
};
/** L3: a plan record's pin, every line it uses sorted by `lineRef`, each once; never read back (third round). */
export type KnowledgePinV1 = { lines: readonly KnowledgeLinePinV1[] };

const knowledgePinModuleField = f.object({
  moduleId: f.string(), paths: f.array(f.string()), responsibility: f.string(),
  contains: f.array(f.string()), dependsOn: f.array(f.object({ to: f.string(), reason: f.string() })),
});
/** A clean line carries no modules and a dirty one its list; runs after the fields hold. */
const modulesFollowDirty: ShapeRule = value => {
  const { dirty, modules } = value as KnowledgeLinePinV1;
  return dirty === (modules !== null) ? null : 'KnowledgeLinePinV1.modules must be null exactly when the line is clean';
};
const knowledgeLinePinShape = defineShape({ name: 'KnowledgeLinePinV1', fields: {
  lineRef: f.string(), contentHash: f.sha256(), head: f.nullable(f.string()), dirty: f.boolean(),
  modules: f.nullable(f.array(knowledgePinModuleField)),
}, rules: [modulesFollowDirty] });
/** Strictly ascending `lineRef`, so each line is there once. */
const linesInOrder: ShapeRule = value => {
  const { lines } = value as KnowledgePinV1;
  return lines.every((line, index) => index === 0 || lines[index - 1]!.lineRef < line.lineRef) ? null
    : 'KnowledgePinV1.lines must be sorted by lineRef, each line once';
};
/** [2C2-04]: the plan record's pin; the old `{catalogRef, baseline}` and a single line's fields are refused (79-1). */
export const KnowledgePinShape = defineShape({ name: 'KnowledgePinV1', fields: {
  lines: f.array(f.ref(knowledgeLinePinShape), { min: 1 }),
}, rules: [linesInOrder] });
