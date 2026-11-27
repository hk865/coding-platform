/**
 * The right panel's shared read model (E3 Main B §2.3): the task/architecture
 * trees, the node detail, the file list, the changed rows, the file page and
 * the per-tab `AuxPanelData`. It touches no DOM, no network and no app module
 * (lead 11-12 ruling 1: the reads are `boot.ts`'s); the board keeps its own
 * layout and local tab state, and Plan B/Done-b reuse this module instead of a
 * second copy of these rules (ruling 2).
 */
import { gitLines, lineEditScript, LINE_DIFF_MAX_DISTANCE } from '../../contracts/line-delta.js';
import type { UncommittedFileListV1, UncommittedFilesV1 } from '../../contracts/workspace-files.js';
import { catalogArchTree, goalTaskTree, type GoalsArchNode, type GoalsTaskNode } from './goals.js';
import type { ArchSemanticData } from './arch-overview.js';
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
  /** The semantic switch, forwarded only for the architecture tab (4-2 甲). */
  semantic?: boolean;
  /** `#flow=<id>`: the flow the page opens on. */
  flowPick?: string | null;
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
  /** The semantic layer; null when the switch is off. */
  semantic: ArchSemanticData | null;
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

/** 一段改动，形状同原型样例的 H(head, oldAt, newAt, rows)：head 是 git 的 @@ 行，oldAt/newAt 是这一段第一行的旧/新行号。 */
export type AuxDiffHunk = { head: string; oldAt: number; newAt: number; rows: Array<[' ' | '-' | '+', string]> };
/** Diff 页逐行区：选中的那一行文件；hunks 为 null 时 note 写原因。 */
export type AuxDiffView = { path: string; hunks: AuxDiffHunk[] | null; note: string };

/** A `files/read` value as the file page draws it (ruling 2, SPEC-15). */
export type AuxFilePage = AuxWorkspaceFile & { lines: string[]; eol: boolean; readAtText: string };

/** 命令页画的一条已装检查；`line` 是原型里那一行命令，目录不是工作区根时
 * 在后面接上目录。 */
export type AuxCommandRow = {
  checkId: string; line: string; command: string; cwd: string; timeoutMs: number;
};

/** 命令页一行的显示状态。页面只映射 `word`、`dot`、`out`。 */
export type AuxCommandView = {
  phase: 'idle' | 'running' | 'stopping' | 'ended';
  word: string; dot: string; out: string; outLines: number;
};

/** 页面要读的句柄字段；路由回答里其余的字段不进这一层。 */
export type AuxCommandHandle = {
  state: 'running' | 'stopping' | 'settled';
  stdout: string; stderr: string; outputTruncated: boolean;
  exitCode: number | null; signal: string | null; timedOut: boolean; cancelled: boolean;
  error: { code: string; reason: string } | null; executionMs: number | null;
};

export type AuxPanelData = {
  tab: AuxTab;
  task: AuxTaskData | null;
  arch: AuxArchData | null;
  files: AuxFileList | null;
  file: AuxFilePage | null;
  /** `files` is null when the listing was empty and nothing was checked (READS-7). */
  diff: { files: UncommittedFilesV1 | null; checkedFirst: number | null; rows: AuxChangedRow[]; view: AuxDiffView | null } | null;
  /** 只有命令页签填它：已装的检查、它们的运行状态，和还没运行时画的那个视图。 */
  commands: {
    rows: AuxCommandRow[]; allowed: boolean; idle: AuxCommandView;
    runs: Record<string, AuxCommandView>;
  } | null;
  error: { code: string; text: string } | null;
};

/** E3-UI-ITEMS:21：页面按码翻译；原始 reason 到不了页面。 */
const COMMAND_ERROR_TEXT: Record<string, string> = {
  sandbox_unavailable: '命令沙箱不可用',
  launch_failed: '没能启动',
  invalid_arguments: '目录或参数不对',
  command_failed: '命令执行失败',
};

/** 原型里唯一的用时写法：不到一分钟写秒，否则写几分几秒。 */
function commandDurationText(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.round(ms / 1000);
  return ' · 用时 ' + (s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`);
}

/** R3：一个命令句柄这一行怎么画。按表从上往下第一条成立的为准，
 * 所以取消或超时的结束句柄不会读成成功。 */
export function auxCommandViewOf(handle: AuxCommandHandle | 'gone' | null): AuxCommandView {
  if (handle === null) return { phase: 'idle', word: '未运行', dot: 'dot s-idle', out: '', outLines: 0 };
  if (handle === 'gone') {
    return {
      phase: 'idle', word: 'Host 重启过，这次运行的记录没有了', dot: 'dot s-idle', out: '', outLines: 0,
    };
  }
  const outParts = [handle.stdout.replace(/\n$/, ''), handle.stderr.replace(/\n$/, '')]
    .filter((text) => text !== '');
  if (handle.outputTruncated) outParts.push('（输出超过上限，只保留了一部分）');
  const out = outParts.join('\n');
  const outLines = out === '' ? 0 : out.split('\n').length;
  if (handle.state === 'running') {
    return {
      phase: 'running', word: '运行中 · 输出在结束后显示', dot: 'dot s-running', out, outLines,
    };
  }
  if (handle.state === 'stopping') {
    return { phase: 'stopping', word: '正在停止', dot: 'dot s-running', out, outLines };
  }
  if (handle.error !== null) {
    return {
      phase: 'ended',
      word: '没跑起来：' + (COMMAND_ERROR_TEXT[handle.error.code] ?? COMMAND_ERROR_TEXT.command_failed),
      dot: 'dot s-failed', out, outLines,
    };
  }
  if (handle.cancelled) {
    return { phase: 'ended', word: '已取消，输出保留', dot: 'dot s-cancelled', out, outLines };
  }
  const took = commandDurationText(handle.executionMs);
  if (handle.timedOut) {
    return { phase: 'ended', word: '超时停下' + took, dot: 'dot s-failed', out, outLines };
  }
  if (handle.exitCode === 0) {
    return { phase: 'ended', word: '已结束 · 退出码 0' + took, dot: 'dot s-satisfied', out, outLines };
  }
  if (handle.exitCode !== null) {
    return {
      phase: 'ended', word: '已结束 · 退出码 ' + handle.exitCode + took, dot: 'dot s-failed', out, outLines,
    };
  }
  return {
    phase: 'ended', word: '已结束 · 被信号 ' + handle.signal + ' 停下' + took, dot: 'dot s-failed', out, outLines,
  };
}

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
export function auxChangedRowsOf(files: UncommittedFileListV1 | null): AuxChangedRow[] {
  if (files === null || files.repository === 'not_git') return [];
  return files.files.flatMap((file) => (file.state === 'clean' ? [] : [{
    path: file.path,
    added: file.state === 'uncommitted' && file.lines !== null ? file.lines.added : null,
    deleted: file.state === 'uncommitted' && file.lines !== null ? file.lines.deleted : null,
    state: file.state,
  }]));
}

/**
 * R3：Diff 页唯一的逐行 diff，按原型的 H 形状给 hunk。切行用 `files/uncommitted` 的
 * 同一种切法（`gitLines`）；脚本用 `lineEditScript`，超过 Myers 上限回 `null`（N2）。
 * 上下文 3 行；两处改动之间保留不超过 6 行就并成一段。
 */
export function auxDiffHunksOf(before: string | null, after: string | null): AuxDiffHunk[] | null {
  const a = gitLines(before ?? '');
  const b = gitLines(after ?? '');
  const script = lineEditScript(a, b, LINE_DIFF_MAX_DISTANCE);
  if (script === null) return null;
  const changed: number[] = [];
  for (let index = 0; index < script.length; index += 1) if (script[index] !== ' ') changed.push(index);
  if (changed.length === 0) return [];
  const runs: Array<[number, number]> = [];
  let start = changed[0]!;
  let end = start;
  for (const index of changed.slice(1)) {
    if (index === end + 1) { end = index; continue; }
    runs.push([start, end]);
    start = index;
    end = index;
  }
  runs.push([start, end]);
  const merged: Array<[number, number]> = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last !== undefined && run[0] - last[1] - 1 <= 6) { last[1] = run[1]; continue; }
    merged.push([run[0], run[1]]);
  }
  const rangeText = (at: number, n: number): string => (n === 0 ? `${at - 1},0` : n === 1 ? `${at}` : `${at},${n}`);
  const hunks: AuxDiffHunk[] = [];
  let oldLine = 0;
  let newLine = 0;
  let index = 0;
  for (const [changeStart, changeEnd] of merged) {
    const from = Math.max(0, changeStart - 3);
    const to = Math.min(script.length - 1, changeEnd + 3);
    while (index < from) {
      const token = script[index]!;
      if (token !== '+') oldLine += 1;
      if (token !== '-') newLine += 1;
      index += 1;
    }
    const oldAt = oldLine + 1;
    const newAt = newLine + 1;
    let oldCount = 0;
    let newCount = 0;
    const rows: Array<[' ' | '-' | '+', string]> = [];
    for (; index <= to; index += 1) {
      const token = script[index]!;
      const line = token === '+' ? b[newLine]! : a[oldLine]!;
      rows.push([token, line.endsWith('\n') ? line.slice(0, -1) : line + '（文件末尾没有换行）']);
      if (token !== '+') { oldLine += 1; oldCount += 1; }
      if (token !== '-') { newLine += 1; newCount += 1; }
    }
    hunks.push({ head: `@@ -${rangeText(oldAt, oldCount)} +${rangeText(newAt, newCount)} @@`, oldAt, newAt, rows });
  }
  return hunks;
}

/** B2：哪一侧不是 UTF-8 文本；那一侧不画，能读的一侧整段画成加或删。 */
export type AuxDiffRead = {
  before: string | null; after: string | null; notText?: 'before' | 'after';
};

/**
 * R3：选中那一行的逐行区。`unknown` 是 N1；没读、两侧都不是文本是 N2；脚本超限是 N2、
 * 空脚本是 N3（两者都让 `hunks` 为 null，画板走 `hunks === null` 那一支画原因）；
 * 恰好一侧不是文本（B2）时，可读的那一侧整段画而说明行写那一句；其余给 hunks、note 为空。
 */
export function auxDiffViewOf(
  row: AuxChangedRow,
  read: AuxDiffRead | 'not_text' | null,
): AuxDiffView {
  const path = row.path;
  if (row.state === 'unknown') {
    return { path, hunks: null, note: '这个文件比较不了：读不到、不是普通文件或超过 1 MiB' };
  }
  const noLineDiff = '这个文件没有逐行内容：二进制或不是 UTF-8 文本、超过 1 MiB，或改动超过 1000 行';
  if (read === null || read === 'not_text') return { path, hunks: null, note: noLineDiff };
  const hunks = auxDiffHunksOf(read.before, read.after);
  if (read.notText !== undefined) {
    return { path, hunks, note: '另一侧不是 UTF-8 文本，只画能读的一侧' };
  }
  if (hunks === null) return { path, hunks: null, note: noLineDiff };
  if (hunks.length === 0) {
    return { path, hunks: null, note: '逐行看没有差别（可能只差文件开头的 BOM，或文件刚又改回去了）' };
  }
  return { path, hunks, note: '' };
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
