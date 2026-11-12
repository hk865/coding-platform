/**
 * The right panel's shared read model (E3 Main B §2.3): the task/architecture
 * trees, the node detail, the file list, the changed rows, the file page and
 * the per-tab `AuxPanelData`. It touches no DOM, no network and no app module
 * (lead 11-12 ruling 1: the reads are `boot.ts`'s); the board keeps its own
 * layout and local tab state, and Plan B/Done-b reuse this module instead of a
 * second copy of these rules (ruling 2).
 */
import type { UncommittedFilesV1 } from '../../contracts/workspace-files.js';
import { catalogArchTree, goalTaskTree, type GoalsArchNode, type GoalsTaskNode } from './goals.js';
import { localShortAt, type TaskMapNodeDetailData } from './task-map.js';

export { catalogArchTree, goalTaskTree };
export type { GoalsArchNode, GoalsTaskNode };

export type AuxTab = 'task' | 'arch' | 'files' | 'file' | 'commands' | 'diff';

/** §2.4: an explicit demand; `null` withdraws the read, `workOnly` is the S12
 * switch, never a tri-state. */
export type AuxDemand = {
  auxTab: AuxTab | null;
  auxPath: string | null;
  detailTaskId: string | null;
  workOnly: boolean;
};

/** The route value the file page reads; only the fields this page uses are
 * named (the UI keeps its own boundary shapes at the JSON edge). */
export type AuxWorkspaceFile = {
  path: string;
  content: string;
  digest: string;
  digestBasis: 'raw_bytes' | 'decoded_utf8';
  sizeBytes: number;
  readAt: string;
};

export type AuxTaskData = {
  tree: GoalsTaskNode | null;
  /** `auxLeafCountsOf(tree, 'task')`: what each node of `tree` counts. */
  counts: Record<string, AuxLeafCount>;
  detail: TaskMapNodeDetailData | null;
  detailFor: string | null;
  moduleNames: Record<string, string>;
  /** Task id → the name of its `graph/hover` module (lead 11-12, T-B10); a task without one is absent. */
  taskModules: Record<string, string>;
  /** The one prototype `det` projection of `detail` and `tree`. */
  det: Record<string, unknown> | null;
};

export type AuxArchData = {
  tree: GoalsArchNode | null;
  /** `auxLeafCountsOf(tree, 'file')`: what each node of `tree` counts. */
  counts: Record<string, AuxLeafCount>;
  work: ReadonlySet<string> | null;
};

/** One tree node's leaves and their states, as the right panel counts them. */
export type AuxLeafCount = { leaves: number; cnt: Record<string, number> };

/**
 * Lead 11-12 item 3 / ruling 2: the right panel's counts. A node counts the
 * leaves of `leafKind` below it (a task of the task tree, a file of the
 * architecture tree) by state; a stage, goal or module without them counts
 * none, so an empty stage, a goal without a plan or a module without a file is
 * never a pending leaf. The board only maps these numbers onto its tree.
 */
export function auxLeafCountsOf(
  tree: GoalsTaskNode | GoalsArchNode, leafKind: 'task' | 'file',
): Record<string, AuxLeafCount> {
  const out: Record<string, AuxLeafCount> = {};
  const countBelow = (node: GoalsTaskNode | GoalsArchNode): AuxLeafCount => {
    const count: AuxLeafCount = { leaves: 0, cnt: {} };
    if (node.kind === leafKind) {
      const state = node.st ?? 'none';
      count.leaves = 1;
      count.cnt[state] = 1;
    }
    for (const kid of node.kids) {
      const below = countBelow(kid);
      count.leaves += below.leaves;
      for (const [state, n] of Object.entries(below.cnt)) count.cnt[state] = (count.cnt[state] ?? 0) + n;
    }
    out[node.id] = count;
    return count;
  };
  countBelow(tree);
  return out;
}

/** One row of the 文件 tree: a folder has `kids`, a file has `null`. */
export type AuxFileNode = { name: string; path: string; kids: AuxFileNode[] | null };

/** Ruling 2: one `files/list` listing as the 文件 tab draws it; `dirs` is every folder of `paths`. */
export type AuxFileList = { paths: string[]; tree: AuxFileNode[]; dirs: string[] };

/** One changed file of Main's 文件/Diff and Member's 改动; `added`/`deleted` are null when git gave no count. */
export type AuxChangedRow = { path: string; added: number | null; deleted: number | null; state: 'uncommitted' | 'unknown' };

/** A `files/read` value as the file page draws it (ruling 2, SPEC-15). */
export type AuxFilePage = AuxWorkspaceFile & { lines: string[]; eol: boolean; readAtText: string };

export type AuxPanelData = {
  tab: AuxTab;
  task: AuxTaskData | null;
  arch: AuxArchData | null;
  files: AuxFileList | null;
  file: AuxFilePage | null;
  /** `files` is null when the listing was empty and nothing was checked (READS-7). */
  diff: { files: UncommittedFilesV1 | null; checkedFirst: number | null; rows: AuxChangedRow[] } | null;
  error: { code: string; text: string } | null;
};

/** Ruling 2: the 文件 tree of one listing, folders before files and each level by name. */
export function auxFileListOf(paths: string[]): AuxFileList {
  const tree: AuxFileNode[] = [];
  const levels = new Map<string, AuxFileNode[]>([['', tree]]);
  const levelOf = (dirPath: string): AuxFileNode[] => {
    const known = levels.get(dirPath);
    if (known !== undefined) return known;
    const cut = dirPath.lastIndexOf('/');
    const kids: AuxFileNode[] = [];
    levelOf(cut < 0 ? '' : dirPath.slice(0, cut)).push({ name: dirPath.slice(cut + 1), path: dirPath, kids });
    levels.set(dirPath, kids);
    return kids;
  };
  for (const path of paths) {
    const cut = path.lastIndexOf('/');
    levelOf(cut < 0 ? '' : path.slice(0, cut)).push({ name: path.slice(cut + 1), path, kids: null });
  }
  for (const level of levels.values()) {
    level.sort((a, b) => Number(b.kids !== null) - Number(a.kids !== null) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  return { paths, tree, dirs: [...levels.keys()].filter((path) => path !== '') };
}

/**
 * READS-8/SPEC-10, build §2.5: a changed file is every file whose state is not
 * `clean`, an `unknown` one too; its counts are git's only for an `uncommitted`
 * file with `lines`, else null and no number is drawn. Main's 文件/Diff and
 * Member's 改动 share this one rule.
 */
export function auxChangedRowsOf(files: UncommittedFilesV1 | null): AuxChangedRow[] {
  if (files === null || files.repository === 'not_git') return [];
  return files.files.flatMap((file) => (file.state === 'clean' ? [] : [{
    path: file.path,
    added: file.state === 'uncommitted' && file.lines !== null ? file.lines.added : null,
    deleted: file.state === 'uncommitted' && file.lines !== null ? file.lines.deleted : null,
    state: file.state,
  }]));
}

/** SPEC-15: the page's lines, whether the text ends in a newline (a save keeps it) and the read time. */
export function auxFilePageOf(file: AuxWorkspaceFile): AuxFilePage {
  const eol = file.content.endsWith('\n');
  const lines = file.content === '' ? [] : (eol ? file.content.slice(0, -1) : file.content).split('\n');
  return { ...file, lines, eol, readAtText: localShortAt(file.readAt) };
}

/** The node `id` of a `goalTaskTree` result; the one lookup `readAuxPanel` and the detail share. */
export function goalTreeNodeOf(tree: GoalsTaskNode | null, id: string): GoalsTaskNode | null {
  if (tree === null) return null;
  if (tree.id === id) return tree;
  for (const kid of tree.kids) {
    const found = goalTreeNodeOf(kid, id);
    if (found !== null) return found;
  }
  return null;
}

/**
 * §2.3: the node detail the prototype's `det` shape draws, from the one
 * `TaskMapNodeDetailData` projection and the tree the page already shows. The
 * crumbs are computed from the tree, never re-read from `graph/detail`.
 */
export function auxTaskDetailOf(
  detail: TaskMapNodeDetailData,
  tree: GoalsTaskNode,
  crumbsOf: (id: string) => Array<{ id: string; name: string }>,
): Record<string, unknown> {
  const node = goalTreeNodeOf(tree, detail.id);
  const state = node?.st ?? '';
  const crumbs = crumbsOf(detail.id).map((crumb, index, all) => ({
    name: crumb.name,
    sep: index > 0,
    cls: 'c' + (index === all.length - 1 ? ' is-on' : ''),
    id: crumb.id,
  }));
  const dep = (ids: string[]) => ids.map((id) => goalTreeNodeOf(tree, id))
    .filter((entry): entry is GoalsTaskNode => entry !== null)
    .map((entry) => ({ name: entry.name, sq: 'sq z8 s-' + (entry.st ?? 'pending'), id: entry.id }));
  const deps = dep(node?.deps ?? []);
  const next = node === null ? [] : dep(nextIdsOf(tree, node.id));
  const files = detail.files.flatMap((group) => group.files.map((file) => ({
    full: file.path,
    parts: file.path.split('/').map((part, index, all) => (index < all.length - 1 ? part + '/' : part)),
  })));
  const rel: Array<Record<string, unknown>> = [
    { k: '依赖', items: deps, files: [], lines: [], hasText: deps.length === 0, text: deps.length === 0 ? '无' : '' },
    { k: '后续', items: next, files: [], lines: [], hasText: next.length === 0, text: next.length === 0 ? '无' : '' },
  ];
  if (files.length > 0) rel.push({ k: '文件', items: [], files, lines: [], hasText: false, text: '' });
  if (detail.participants.length > 0) {
    rel.push({
      k: '参与', items: [], files: [], hasText: false,
      lines: detail.participants.map((entry) => entry.name + (entry.text === '' ? '' : ' · ' + entry.text)),
    });
  }
  if (detail.overlaps.length > 0) {
    rel.push({ k: '重叠', items: [], files: [], hasText: false, lines: detail.overlaps.map((entry) => entry.text) });
  }
  /* lead 11-12 items 12 and 17: 负责 and 语义 are "—" until a read names them. */
  return {
    kind: 'task', id: detail.id, sq: 'sq s-' + (state === '' ? 'pending' : state),
    name: node?.name ?? detail.id, tx: 'tx-' + (state === '' ? 'plain' : state),
    word: detail.word, why: detail.why === '' ? '' : '：' + detail.why,
    crumbs, agent: '—', sem: '—',
    rel, group: false,
  };
}

function nextIdsOf(tree: GoalsTaskNode, id: string): string[] {
  const out: string[] = [];
  const walk = (node: GoalsTaskNode): void => {
    if (node.kind === 'task' && (node.deps ?? []).includes(id)) out.push(node.id);
    node.kids.forEach(walk);
  };
  walk(tree);
  return out;
}
